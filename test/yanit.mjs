// NarChat — Alıntılı yanıt (reply/quote) E2E (Playwright, gerçek app.js)
// İddialar:
//   1) alice→bob şifreli mesaj; bob ÇÖZER (E2E akış sağlam).
//   2) bob, alice'in baloncuğundaki "↩ yanıtla" butonuna basar → yanıt barı açılır + orijinal önizleme görünür.
//   3) bob yanıt yazıp gönderir → alice'te bob'un baloncuğunda ALINTI (orijinal gönderen @alice + orijinal metin)
//      + yanıt metni görünür (önizleme alıcıda doğru çözülür).
//   4) GİZLİLİK: sunucu jsonl'inde yanıt kaydının önizlemesi ŞİFRELİ (govde.yanit.on ciphertext);
//      orijinal/yanıt düz-metni sunucuda YOK. id+kim metadata (sunucu zaten bilir).
//
// Çalıştır:  HEADLESS=1 node test/yanit.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8112;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const ORIG = 'ORIJINAL_GIZLI_SORU_' + PORT;
const REPLY = 'ALINTILI_YANIT_METNI_' + PORT;

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-yanit-'));
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

let server;
async function main() {
  log('↩  NarChat "Alıntılı yanıt" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 120 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt, alice → bob 1:1 şifreli mesaj:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', ORIG); await a.click('#gonderBtn');
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), ORIG, { timeout: 12000 });
  log('  ✓ alice gönderdi');

  // bob odayı açar → orijinali çözer (E2E sağlam)
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), ORIG, { timeout: 12000 });
  log('  ✅ bob orijinali çözdü (E2E akış sağlam)');

  const mid = await b.locator(`#akis .msg:not(.ben)`).last().getAttribute('data-id');
  if (!mid) throw new Error('❌ orijinal mesaj id alınamadı');

  log('\n2) bob, alice baloncuğundaki "↩ yanıtla"ya basar → yanıt barı + önizleme:');
  await b.locator(`#akis .msg[data-id="${mid}"] .yanitBtn`).click();
  await b.waitForSelector('#yanitBar:not(.gizli)', { timeout: 8000 });
  const barOn = await b.locator('#yanitBarOn').textContent();
  if (!barOn.includes(ORIG)) throw new Error('❌ yanıt barı orijinal önizlemeyi göstermiyor: ' + barOn);
  const barKim = await b.locator('#yanitBarKim').textContent();
  if (!barKim.includes('alice')) throw new Error('❌ yanıt barı orijinal göndereni (@alice) göstermiyor: ' + barKim);
  log('  ✅ yanıt barı: @alice + orijinal metin önizlemesi');

  log('\n3) bob yanıt yazıp gönderir → alice\'te ALINTI + yanıt metni:');
  await b.fill('#mesajIn', REPLY); await b.click('#gonderBtn');
  // bob tarafında yanıt barı kapanmalı (gönderince temizlenir) — .gizli = display:none, sınıfı kontrol et
  await b.waitForFunction(() => document.getElementById('yanitBar')?.classList.contains('gizli'), null, { timeout: 8000 });
  // optimistik baloncuk önce data-id'siz çizilir, sunucu echo'su (SSE/yanıt) geldiğinde gerçek id iliştirilir —
  // bar kapanması ile id atanması arasında ufak bir yarış var; id'yi POLLAYARAK bekle (anlık okuma değil).
  await b.waitForFunction(() => {
    const list = document.querySelectorAll('#akis .msg.ben');
    const last = list[list.length - 1];
    return !!(last && last.dataset.id);
  }, null, { timeout: 12000 });
  const ridB = await b.locator('#akis .msg.ben').last().getAttribute('data-id');
  if (!ridB) throw new Error('❌ yanıt mesajı id alınamadı');

  // alice: bob'un yanıt baloncuğu = yanıt metni + alıntı (orijinal @alice + ORIG)
  await a.waitForFunction((r) => {
    return [...document.querySelectorAll('#akis .msg:not(.ben)')]
      .some(e => e.querySelector('.metin') && e.querySelector('.metin').textContent.includes(r));
  }, REPLY, { timeout: 12000 });
  const sonuc = await a.evaluate(({ REPLY, ORIG }) => {
    const el = [...document.querySelectorAll('#akis .msg:not(.ben)')]
      .find(e => e.querySelector('.metin') && e.querySelector('.metin').textContent.includes(REPLY));
    if (!el) return { found: false };
    const q = el.querySelector('.yanit-onizle');
    return {
      found: true,
      hasQuote: !!q,
      quoteKim: q ? (q.querySelector('.yanit-onizle-kim')?.textContent || '') : '',
      quoteOn: q ? (q.querySelector('.yanit-onizle-on')?.textContent || '') : '',
    };
  }, { REPLY, ORIG });
  if (!sonuc.found) throw new Error('❌ alice\'te bob\'un yanıt baloncuğu bulunamadı');
  if (!sonuc.hasQuote) throw new Error('❌ yanıt baloncuğunda alıntı (.yanit-onizle) yok');
  if (!sonuc.quoteKim.includes('alice')) throw new Error('❌ alıntı orijinal göndereni göstermiyor: ' + sonuc.quoteKim);
  if (!sonuc.quoteOn.includes(ORIG)) throw new Error('❌ alıntı orijinal metni göstermiyor (alıcıda çözülmedi): ' + sonuc.quoteOn);
  log('  ✅ alice: yanıt baloncuğunda alıntı (@alice + orijinal metin) + yanıt metni doğru');

  log('\n4) GİZLİLİK: sunucu jsonl — yanıt önizlemesi ŞİFRELİ, düz-metin YOK:');
  const msgDir = join(server.veri, 'mesajlar');
  let ham = '', yanitKaydi = null;
  for (const f of await readdir(msgDir)) {
    const icerik = await readFile(join(msgDir, f), 'utf8'); ham += icerik;
    for (const satir of icerik.split('\n')) { if (!satir.trim()) continue; const m = JSON.parse(satir); if (m.id === ridB) yanitKaydi = m; }
  }
  if (!yanitKaydi) throw new Error('❌ jsonl\'de yanıt kaydı yok');
  const y = yanitKaydi.govde && yanitKaydi.govde.yanit;
  if (!y || !y.on || !y.nOn) throw new Error('❌ yanıt kaydında şifreli önizleme (govde.yanit.on) yok: ' + JSON.stringify(yanitKaydi.govde));
  if (y.id !== mid) throw new Error('❌ yanıt, orijinal mesaj id\'sine bağlı değil (metadata): ' + y.id + ' ≠ ' + mid);
  if (ham.includes(ORIG)) throw new Error('❌ orijinal düz-metin sunucuda görünüyor!');
  if (ham.includes(REPLY)) throw new Error('❌ yanıt düz-metni sunucuda görünüyor!');
  log('  ✅ govde.yanit.on = ciphertext · yanit.id orijinale bağlı (metadata) · düz-metin (orijinal+yanıt) YOK');

  if (!HEADLESS) await sleep(1500);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ ALINTILI YANIT (REPLY/QUOTE) E2E GEÇTİ:');
  log('   • "↩ yanıtla" → yanıt barı + orijinal önizleme');
  log('   • karşı tarafta alıntı (orijinal gönderen + metin) doğru çözülür');
  log('   • önizleme metni AYNI mesaj anahtarıyla şifreli — sunucuda düz-metin YOK (E2E korunur)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
