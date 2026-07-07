// NarChat — Profil (görünen ad + avatar) FAZ C E2E (Playwright, gerçek app.js)
// İddialar:
//   1) Kullanıcı Ayarlar'dan görünen ad + avatar foto ayarlar (POST /api/profil).
//   2) Görünen ad + avatar KİŞİLERDE görünür: alice'in listesinde bob "Mustafa Hoca" + foto avatar.
//   3) 1:1 sohbet başlığı görünen adı kullanır.
//   4) Görünen ad kalıcı: reload sonrası Ayarlar'da geri yüklenir. Kullanıcı adı (@bob) DEĞİŞMEZ.
//
// Çalıştır:  HEADLESS=1 node test/profil.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8114;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-profil-'));
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
  log('🪪  NarChat "Profil (görünen ad + avatar)" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 120 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt; bob Ayarlar\'dan görünen ad + avatar ayarlar:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await b.click('#altNav button[data-gor="ayarlar"]');
  await b.fill('#adIn', 'Mustafa Hoca');
  await b.locator('#avatarIn').setInputFiles({ name: 'bob.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await b.waitForFunction(() => document.getElementById('benAvatar')?.classList.contains('foto'), null, { timeout: 6000 });
  await b.click('#profilKaydetBtn');
  // sunucuda doğrula
  await b.waitForFunction(async () => {
    const liste = await (await fetch('/api/kullanicilar', { credentials: 'same-origin' })).json();
    const x = liste.find(u => u.kullanici === 'bob');
    return x && x.ad === 'Mustafa Hoca' && x.avatar === true;
  }, null, { timeout: 8000 });
  const avDurum = await b.evaluate(async () => (await fetch('/api/avatar?u=bob', { credentials: 'same-origin' })).status);
  if (avDurum !== 200) throw new Error('❌ /api/avatar?u=bob → ' + avDurum + ' (200 beklenir)');
  log('  ✅ bob profili kaydedildi (ad=Mustafa Hoca, avatar 200) + kullanıcı adı @bob sabit');

  log('\n2) alice bob\'u ekler → kişilerde GÖRÜNEN AD + foto avatar:');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const satir = a.locator('#kisiler .oda', { hasText: 'Mustafa Hoca' });
  await satir.waitFor({ timeout: 10000 });
  await satir.locator('.avatar.foto').waitFor({ timeout: 6000 });
  log('  ✅ alice kişilerinde "Mustafa Hoca" + foto avatar görünüyor (@bob yerine görünen ad)');

  log('\n3) 1:1 sohbet başlığı görünen adı kullanır:');
  await satir.click();
  await a.waitForFunction(() => document.getElementById('odaBaslik')?.textContent === 'Mustafa Hoca', null, { timeout: 10000 });
  log('  ✅ sohbet başlığı: "Mustafa Hoca"');

  log('\n4) Görünen ad kalıcı (alice kendi adını ayarlar → reload sonrası geri yüklenir):');
  await a.click('#geriBtn');
  await a.click('#altNav button[data-gor="ayarlar"]');
  await a.fill('#adIn', 'Ben Alice');
  await a.click('#profilKaydetBtn');
  await sleep(400);
  await a.reload(); await uygulamaHazir(a);
  await a.click('#altNav button[data-gor="ayarlar"]');
  await a.waitForFunction(() => document.getElementById('adIn')?.value === 'Ben Alice', null, { timeout: 8000 });
  log('  ✅ reload sonrası alice görünen adı "Ben Alice" korundu');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ PROFİL (GÖRÜNEN AD + AVATAR) E2E GEÇTİ:');
  log('   • Ayarlar\'dan ad + avatar → POST /api/profil (kullanıcı adı sabit)');
  log('   • kişiler/sohbet başlığında görünen ad + foto avatar');
  log('   • görünen ad reload sonrası kalıcı');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
