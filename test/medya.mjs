// NarChat — Medya paylaşımı (E2E foto/dosya) FAZ B E2E (Playwright, gerçek app.js)
// İddialar (headline):
//   1) alice foto seçer → secretbox(K)+K fan-out → POST /api/medya (opak) → tip:'medya' mesaj.
//   2) bob ciphertext'i çeker, K'yı kendi anahtarıyla çözer → GEÇERLİ görseli render eder (<img>, naturalWidth>0).
//   3) GİZLİLİK: sunucu blob'unda ne SENTINEL düz-metni ne de ham PNG imzası var (opak ciphertext).
//   4) 15MB sınırı: >15MB ham gövde → 413.
//
// Çalıştır:  HEADLESS=1 node test/medya.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8113;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const SENTINEL = 'MEDYA_GIZLI_FOTO_' + PORT;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// geçerli 1x1 PNG + sentinel kuyruğu (PNG çözücüler kuyruğu yok sayar → <img> yine render eder)
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FOTO = Buffer.concat([PNG_1x1, Buffer.from('\n' + SENTINEL + '\n')]);

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-medya-'));
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
  log('🖼  NarChat "Medya paylaşımı (E2E foto)" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 120 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt, alice → bob 1:1 oda + FOTO gönderir:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.locator('#medyaIn').setInputFiles({ name: 'gizli.png', mimeType: 'image/png', buffer: FOTO });
  // alice kendi baloncuğunda görseli görsün (gönderim tamam)
  await a.locator('#akis img.medya-resim').first().waitFor({ timeout: 15000 });
  log('  ✓ alice fotoyu gönderdi (kendi baloncuğunda görsel)');

  log('\n2) bob ciphertext\'i çözüp GEÇERLİ görseli render eder:');
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  const img = b.locator('#akis img.medya-resim').first();
  await img.waitFor({ timeout: 15000 });
  const nw = await img.evaluate(el => el.complete && el.naturalWidth ? el.naturalWidth
    : new Promise(r => { el.onload = () => r(el.naturalWidth); el.onerror = () => r(0); setTimeout(() => r(el.naturalWidth || 0), 4000); }));
  if (!nw || nw < 1) throw new Error('❌ bob görseli çözüp render edemedi (naturalWidth=' + nw + ')');
  log('  ✅ bob: <img> çözüldü ve render edildi (naturalWidth=' + nw + ')');

  log('\n3) GİZLİLİK: sunucu medya blob\'u OPAK (düz foto/sentinel YOK):');
  const medyaDir = join(server.veri, 'medya');
  const dosyalar = (await readdir(medyaDir)).filter(f => f.endsWith('.bin'));
  if (!dosyalar.length) throw new Error('❌ sunucuda medya blob\'u yok');
  for (const f of dosyalar) {
    const buf = await readFile(join(medyaDir, f));
    if (buf.includes(Buffer.from(SENTINEL))) throw new Error('❌ GÜVENLİK: SENTINEL düz-metni blob içinde!');
    if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('❌ GÜVENLİK: ham PNG imzası blob başında (şifreli değil!)');
  }
  log(`  ✅ ${dosyalar.length} blob tarandı — sentinel yok + ham PNG imzası yok (opak ciphertext)`);

  log('\n4) 15MB sınırı: >15MB ham gövde → 413:');
  const durum = await a.evaluate(async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 4096);
    const r = await fetch('/api/medya', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream', 'X-NarChat': '1' }, body: big });   // D1/L2: CSRF başlığı (app.js api()/medya yolu da yollar)
    return r.status;
  });
  if (durum !== 413) throw new Error('❌ 15MB üstü için 413 beklenirken ' + durum + ' geldi');
  log('  ✅ >15MB → 413 (sunucu reddetti)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ MEDYA PAYLAŞIMI (E2E FOTO) E2E GEÇTİ:');
  log('   • alice foto → secretbox(K)+fan-out → opak /api/medya blob + tip:medya mesaj');
  log('   • bob ciphertext\'i çözüp geçerli görseli render etti');
  log('   • sunucu blob\'u opak (sentinel yok + ham PNG imzası yok)');
  log('   • >15MB → 413');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
