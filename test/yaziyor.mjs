// NarChat — "Yazıyor…" + çevrimiçi (FAZ A3) E2E (Playwright, gerçek app.js)
// İddialar:
//   1) alice yazarken → POST /api/yaziyor → bob'un sohbet başlığında "@alice yazıyor…" (canlı SSE, geçici).
//   2) Çevrimiçi: aktif kullanıcı için /api/kisiler → cevrimici:true; kişi avatarında yeşil nokta.
//   3) "yazıyor…" geçicidir (depolanmaz) — ~4s sonra alt-başlık eski haline döner.
//
// Çalıştır:  HEADLESS=1 node test/yaziyor.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8112;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-yaziyor-'));
  const p = spawn('python3', [join(KOK, 'mesaj_server.py')], {
    env: { ...process.env, NARCHAT_PORT: String(PORT), NARCHAT_VERI: veri },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/ben'); if (r.status === 401 || r.ok) break; } catch {}
    await sleep(100);
  }
  return { proc: p, veri };
}
async function uygulamaHazir(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('kayitBtn');
    return !!b && typeof b.onclick === 'function';
  }, null, { timeout: 25000 });
}
async function yeniSayfa(ctx, ad) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${ad} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/');
  await uygulamaHazir(page);
  return page;
}
async function kayitOl(page, kullanici) {
  await page.fill('#gKullanici', kullanici);
  await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}
const altText = (page) => page.evaluate(() => document.getElementById('odaUyeler')?.textContent || '');

let server;
async function main() {
  log('✍️  NarChat "Yazıyor… + çevrimiçi" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 120 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt, alice → bob 1:1 oda kurar:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', 'selam'); await a.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('selam'), null, { timeout: 12000 });
  log('  ✓ oda kuruldu');

  // bob odayı açar → SSE'ye abone olur
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await sleep(1500);   // bob'un EventSource'u bağlanana kadar (geçici yazıyor sinyali kaçmasın)
  log('  ✓ bob oda açık (SSE abone)');

  log('\n2) alice yazıyor → bob başlığında "@alice yazıyor…" beklenir:');
  // Kısma (throttle) ~2.5s; SSE bağlanma yarışına karşı 3 deneme (her biri yeni pencerede).
  let yz = '';
  for (let i = 0; i < 3; i++) {
    await a.locator('#mesajIn').fill('');
    await a.locator('#mesajIn').pressSequentially('merhaba bob ' + i, { delay: 25 });
    try {
      await b.waitForFunction(() => (document.getElementById('odaUyeler')?.textContent || '').includes('yazıyor'), null, { timeout: 3000 });
      break;
    } catch { await sleep(2600); }   // throttle penceresi geçsin, tekrar dene
  }
  yz = await altText(b);
  if (!yz.includes('yazıyor')) throw new Error('❌ bob "yazıyor…" görmedi: ' + JSON.stringify(yz));
  if (!yz.includes('alice')) throw new Error('❌ yazan kişi adı beklenmedik: ' + JSON.stringify(yz));
  log('  ✅ bob: "' + yz + '" (canlı SSE)');

  log('\n3) Çevrimiçi: /api/kisiler → bob cevrimici:true:');
  const bobOnline = await a.evaluate(async () => {
    const liste = await (await fetch('/api/kisiler', { credentials: 'same-origin' })).json();
    const x = liste.find(u => u.kullanici === 'bob'); return !!(x && x.cevrimici);
  });
  if (!bobOnline) throw new Error('❌ aktif bob cevrimici:false döndü');
  log('  ✅ /api/kisiler bob.cevrimici = true');

  log('\n4) Kişi avatarında yeşil çevrimiçi noktası (taze render):');
  await a.reload(); await uygulamaHazir(a);
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.locator('#kisiler .oda', { hasText: '@bob' }).locator('.cevrimici-nokta').waitFor({ timeout: 8000 });
  log('  ✅ @bob satırında çevrimiçi noktası görünüyor');

  log('\n5) "yazıyor…" geçici — ~4s sonra başlık eski haline döner (bob):');
  await b.waitForFunction(() => !(document.getElementById('odaUyeler')?.textContent || '').includes('yazıyor'), null, { timeout: 9000 });
  log('  ✅ "yazıyor…" söndü (alt-başlık çevrimiçi/şifreli\'ye döndü) — depolanmaz');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ "YAZIYOR… + ÇEVRİMİÇİ" E2E GEÇTİ:');
  log('   • yazarken → /api/yaziyor → karşı tarafta canlı "@x yazıyor…" (SSE, geçici)');
  log('   • çevrimiçi: /api/kisiler cevrimici:true + avatar yeşil nokta');
  log('   • yazıyor… depolanmaz, süreyle söner');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
