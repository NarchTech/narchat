// NarChat — G7 Kişi engelleme (block) Playwright
// İddialar:
//   1) Normal akış: bob → alice mesaj alice'e ULAŞIR (kontrol).
//   2) alice bob'u ENGELLER → bob'un yeni mesajı alice'te GÖRÜNMEZ (istemci filtreler).
//   3) alice kişi listesinde bob "engellendi" (🚫) işaretli; başlık alt-satırı "engellendi".
//   4) SUNUCU: engelliyle yeni 1:1 başlatılamaz (bob → /api/oda{alice} = 403).
//   5) Engeli kaldır → bob'un yeni mesajı yeniden GÖRÜNÜR.
//
// Çalıştır:  HEADLESS=1 node test/engelle.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-engel-'));
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

let server;
async function main() {
  log('🚫 NarChat "Kişi engelleme" (G7) E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');
  a.on('dialog', d => d.accept());   // engelle onayı (confirm)

  log('1) alice+bob 1:1; bob→alice mesaj ULAŞIR (kontrol):');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', 'merhaba'); await a.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('merhaba'), null, { timeout: 12000 });
  await b.reload(); await uygulamaHazir(b);
  await b.locator('#odalar .oda').first().click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.fill('#mesajIn', 'kontrol1'); await b.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('kontrol1'), null, { timeout: 12000 });
  log('  ✅ bob mesajı alice\'e ulaştı (engel öncesi)');

  log('\n2) alice bob\'u ENGELLER → bob\'un yeni mesajı alice\'te GÖRÜNMEZ:');
  await a.click('#odaBaslikSar');
  await a.waitForSelector('#mesajMenu.guv-sheet', { timeout: 8000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Engelle' }).click();
  await a.waitForFunction(() => document.getElementById('odaUyeler')?.textContent.includes('engellendi'), null, { timeout: 8000 });
  log('  ✅ başlık alt-satırı: "engellendi"');
  await b.fill('#mesajIn', 'gizli2'); await b.click('#gonderBtn');
  await b.waitForFunction(() => document.getElementById('akis')?.textContent.includes('gizli2'), null, { timeout: 8000 });
  await sleep(1500);   // SSE'ye (gelmeyecek olana) zaman tanı
  if (await a.evaluate(() => document.getElementById('akis')?.textContent.includes('gizli2')))
    throw new Error('❌ engellenen kullanıcının mesajı alice ekranında görünüyor');
  log('  ✅ "gizli2" alice ekranında YOK (engellendi)');

  log('\n3) alice kişi listesinde bob "engellendi" (🚫):');
  await a.click('#geriBtn');   // sohbetten çık → alt-nav görünür
  await a.click('#altNav button[data-gor="kisiler"]');
  const engelliSatir = a.locator('#kisiler .oda.engelli', { hasText: '@bob' });
  await engelliSatir.waitFor({ timeout: 8000 });
  if (!(await a.locator('#kisiler .oda.engelli .engel-im').count()))
    throw new Error('❌ engelli kişi 🚫 işareti yok');
  log('  ✅ bob satırı .engelli + 🚫');

  log('\n4) SUNUCU: bob engelliyken alice ile yeni 1:1 başlatamaz (403):');
  const durum = await b.evaluate(async () => {
    const r = await fetch('/api/oda', { method: 'POST', headers: { 'content-type': 'application/json', 'X-NarChat': '1' },
      body: JSON.stringify({ tip: 'ikili', uyeler: ['alice'] }) });
    return r.status;
  });
  if (durum !== 403) throw new Error('❌ engelliyken 1:1 başlatma 403 değil: ' + durum);
  log('  ✅ /api/oda → 403 (engelli kullanıcı)');

  log('\n5) Engeli kaldır → bob\'un yeni mesajı yeniden GÖRÜNÜR:');
  await a.click('#altNav button[data-gor="sohbetler"]');
  await a.locator('#odalar .oda').first().click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.click('#odaBaslikSar');
  await a.waitForSelector('#mesajMenu.guv-sheet', { timeout: 8000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Engeli kaldır' }).click();
  await a.waitForFunction(() => !document.getElementById('odaUyeler')?.textContent.includes('engellendi'), null, { timeout: 8000 });
  await b.fill('#mesajIn', 'geri3'); await b.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('geri3'), null, { timeout: 12000 });
  log('  ✅ engel kalktı, bob mesajı yeniden görünüyor');

  if (!HEADLESS) await sleep(1500);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ KİŞİ ENGELLEME (G7) E2E GEÇTİ:');
  log('   • engellenen kullanıcının mesajları istemcide gizlenir');
  log('   • kişi listesinde 🚫 + başlıkta "engellendi"');
  log('   • sunucu engelliyle yeni 1:1 başlatmayı reddeder (403)');
  log('   • engel kaldırılınca mesajlar yeniden görünür');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
