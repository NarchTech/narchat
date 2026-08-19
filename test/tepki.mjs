// NarChat — Emoji tepkileri (E2E) E2E (Playwright, gerçek app.js)
// İddialar:
//   1) alice→bob mesaj; bob açar.
//   2) bob, alice'in mesajına 🙂→👍 tepkisi verir → alice'te çip "👍" canlı (SSE) görünür.
//   3) GİZLİLİK: sunucu tepkiler.json'da emoji ŞİFRELİ — düz "👍" YOK; yapı oda→mid→{bob: blob}.
//   4) bob kendi çipine basar → tepki kalkar → alice'te çip kaybolur (toggle).
//
// Çalıştır:  HEADLESS=1 node test/tepki.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8115;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const HEDEF = 'TEPKI_HEDEF_MESAJI_' + PORT;
const EMOJI = '👍';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-tepki-'));
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
  await page.waitForFunction(() => { const b = document.getElementById('kayitBtn'); return !!b && typeof b.onclick === 'function'; }, null, { timeout: 25000 });
}
async function yeniSayfa(ctx, ad) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${ad} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/'); await uygulamaHazir(page);
  return page;
}
async function kayitOl(page, kullanici) {
  await page.fill('#gKullanici', kullanici); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam'); await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}

let server;
async function main() {
  log('😊 NarChat "Emoji tepkileri (E2E)" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const a = await yeniSayfa(await browser.newContext(MOBIL), 'alice');
  const b = await yeniSayfa(await browser.newContext(MOBIL), 'bob');

  log('1) alice + bob kayıt, alice → bob mesaj, bob açar:');
  await kayitOl(a, 'alice'); await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', HEDEF); await a.click('#gonderBtn');
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), HEDEF, { timeout: 12000 });
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first(); await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), HEDEF, { timeout: 12000 });
  const mid = await b.locator('#akis .msg:not(.ben)').last().getAttribute('data-id');
  if (!mid) throw new Error('❌ hedef mesaj id alınamadı');
  log('  ✓ kurulum tamam (mid=' + mid + ')');

  log('\n2) bob 🙂→👍 tepkisi verir → alice\'te çip canlı görünür:');
  await b.locator(`#akis .msg[data-id="${mid}"] .tepkiBtn`).click();
  await b.waitForSelector('.tepki-sec-pop', { timeout: 8000 });
  await b.locator('.tepki-sec-pop button', { hasText: EMOJI }).click();
  await a.waitForFunction((mid) => {
    const el = document.querySelector(`#akis .msg[data-id="${mid}"] .tepki-satiri`);
    return el && el.textContent.includes('👍');
  }, mid, { timeout: 12000 });
  log('  ✅ alice: "👍" çipi canlı (SSE)');

  log('\n3) GİZLİLİK: sunucu tepkiler.json — emoji ŞİFRELİ, düz "👍" YOK:');
  const ham = await readFile(join(server.veri, 'tepkiler.json'), 'utf8');
  const t = JSON.parse(ham);
  const odalar = Object.keys(t);
  const midVar = odalar.some(o => t[o][mid] && t[o][mid]['bob']);
  if (!midVar) throw new Error('❌ tepki kaydı (oda→mid→bob) yok: ' + ham.slice(0,200));
  if (ham.includes('👍')) throw new Error('❌ düz emoji "👍" sunucuda görünüyor (E2E ihlali)!');
  log('  ✅ oda→mid→{bob: blob} var · düz "👍" YOK (emoji E2E şifreli)');

  log('\n4) bob çipine basar → toggle kaldır → alice\'te çip kaybolur:');
  await b.locator(`#akis .msg[data-id="${mid}"] .tepki-chip.benim`).click();
  await a.waitForFunction((mid) => {
    const el = document.querySelector(`#akis .msg[data-id="${mid}"] .tepki-satiri`);
    return !el || !el.textContent.includes('👍');
  }, mid, { timeout: 12000 });
  log('  ✅ alice: çip kalktı (toggle)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ EMOJİ TEPKİLERİ (E2E) E2E GEÇTİ:');
  log('   • 🙂→👍 → karşı tarafta canlı çip (SSE)');
  log('   • emoji sunucuda ŞİFRELİ (opak blob) — düz emoji yok');
  log('   • toggle: kendi çipine basınca kalkar');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
