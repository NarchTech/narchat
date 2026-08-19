// NarChat — G8 Gizlilik ayarları (son-görülme + okundu kapatma) Playwright
// İddialar:
//   1) Okundu AÇIK (varsayılan): bob alice'in mesajını okur → alice ✓✓ görür.
//   2) bob "Okundu bilgisi"ni KAPATIR → alice'in yeni mesajını bob okusa da alice ✓✓ GÖRMEZ.
//   3) Son-görülme AÇIK: alice /api/kisiler'de bob'u çevrimiçi görür.
//   4) bob "Son görülme"yi KAPATIR → alice bob'u çevrimiçi GÖRMEZ (cevrimici=false, son=0).
//
// Çalıştır:  HEADLESS=1 node test/gizlilik.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8124;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-gizli-'));
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
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}
async function odadanCikAyarlar(page) {   // sohbetten çık → Ayarlar sekmesi
  await page.click('#geriBtn');
  await page.click('#altNav button[data-gor="ayarlar"]');
}

let server;
async function main() {
  log('🔏 NarChat "Gizlilik ayarları" (G8) E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) Okundu AÇIK: bob okur → alice ✓✓ görür:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', 'msg_a1'); await a.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('msg_a1'), null, { timeout: 12000 });
  // bob okur
  await b.reload(); await uygulamaHazir(b);
  await b.locator('#odalar .oda').first().click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.waitForFunction(() => document.getElementById('akis')?.textContent.includes('msg_a1'), null, { timeout: 12000 });
  // alice ✓✓ görür
  await a.waitForFunction(() =>
    [...document.querySelectorAll('#akis .msg.ben')].some(e =>
      e.querySelector('.metin')?.textContent.includes('msg_a1') && e.querySelector('.tik.okundu')),
    null, { timeout: 12000 });
  log('  ✅ alice msg_a1 baloncuğunda ✓✓ (okundu)');

  log('\n2) bob "Okundu bilgisi"ni KAPATIR → alice yeni mesajda ✓✓ GÖRMEZ:');
  await odadanCikAyarlar(b);
  await b.click('#gizliOkunduBtn');
  await b.waitForFunction(() => document.getElementById('gizliOkunduBtn')?.textContent.includes('Kapalı'), null, { timeout: 8000 });
  log('  ✓ bob okundu = Kapalı');
  await b.click('#altNav button[data-gor="sohbetler"]');
  await b.locator('#odalar .oda').first().click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', 'msg_a2'); await a.click('#gonderBtn');
  await b.waitForFunction(() => document.getElementById('akis')?.textContent.includes('msg_a2'), null, { timeout: 12000 });
  await sleep(1800);   // okundu sinyali (gelmeyecek olana) zaman tanı
  const durum = await a.evaluate(() => {
    const e = [...document.querySelectorAll('#akis .msg.ben')].find(x => x.querySelector('.metin')?.textContent.includes('msg_a2'));
    return e ? { found: true, okundu: !!e.querySelector('.tik.okundu') } : { found: false };
  });
  if (!durum.found) throw new Error('❌ alice msg_a2 baloncuğu bulunamadı');
  if (durum.okundu) throw new Error('❌ okundu kapalıyken alice ✓✓ görüyor');
  log('  ✅ msg_a2 tek ✓ (okundu kapalı — ✓✓ yok)');

  log('\n3) Son-görülme AÇIK: alice bob\'u çevrimiçi görür:');
  const once = await a.evaluate(async () => {
    const j = await (await fetch('/api/kisiler')).json();
    return (j.find(x => x.kullanici === 'bob') || {}).cevrimici;
  });
  if (once !== true) throw new Error('❌ son-görülme açıkken bob çevrimiçi değil: ' + once);
  log('  ✅ /api/kisiler: bob.cevrimici = true');

  log('\n4) bob "Son görülme"yi KAPATIR → alice bob\'u çevrimiçi GÖRMEZ:');
  await odadanCikAyarlar(b);
  await b.click('#gizliSonBtn');
  await b.waitForFunction(() => document.getElementById('gizliSonBtn')?.textContent.includes('Kapalı'), null, { timeout: 8000 });
  log('  ✓ bob son-görülme = Kapalı');
  await sleep(400);
  const sonra = await a.evaluate(async () => {
    const j = await (await fetch('/api/kisiler')).json();
    const x = j.find(y => y.kullanici === 'bob') || {};
    return { cevrimici: x.cevrimici, son: x.son };
  });
  if (sonra.cevrimici !== false || sonra.son !== 0)
    throw new Error('❌ son-görülme kapalıyken hâlâ görünüyor: ' + JSON.stringify(sonra));
  log('  ✅ /api/kisiler: bob.cevrimici = false + son = 0 (gizlendi)');

  if (!HEADLESS) await sleep(1500);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ GİZLİLİK AYARLARI (G8) E2E GEÇTİ:');
  log('   • okundu açık → ✓✓ görünür');
  log('   • okundu kapalı → ✓✓ gönderilmez/görünmez (karşılıklı)');
  log('   • son-görülme açık → çevrimiçi görünür');
  log('   • son-görülme kapalı → çevrimiçi/son gizlenir');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
