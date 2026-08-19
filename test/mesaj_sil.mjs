// NarChat — Mesaj sil (herkesten) FAZ A2 E2E (Playwright, gerçek app.js)
// İddialar:
//   1) alice→bob şifreli mesaj; bob ÇÖZER (E2E akış sağlam).
//   2) GÜVENLİK: bob (gönderen DEĞİL) alice'in mesajını silemez → 403.
//   3) alice kendi baloncuğuna uzun-bas → onay → "herkesten sil":
//        - alice'te baloncuk tombstone ("🚫 Bu mesaj silindi")
//        - bob'ta da CANLI (SSE) tombstone, düz-metin artık YOK
//   4) Sunucu jsonl: kayıt {silindi:true, govde:null} — ciphertext sunucudan da kalktı.
//
// Çalıştır:  HEADLESS=1 node test/mesaj_sil.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8111;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const SENTINEL = 'SILINECEK_GIZLI_MESAJ_' + PORT;
const TOMBSTONE = 'Bu mesaj silindi';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-mesajsil-'));
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
const tombstoneMu = (id) => {
  const el = document.querySelector(`.msg[data-id="${id}"]`);
  return !!el && el.classList.contains('silindi');
};

let server;
async function main() {
  log('🗑  NarChat "Mesaj sil (herkesten)" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 120 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');
  a.on('dialog', d => d.accept());   // silme onayını otomatik kabul et

  log('1) alice + bob kayıt, alice → bob 1:1 şifreli mesaj:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', SENTINEL); await a.click('#gonderBtn');
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), SENTINEL, { timeout: 12000 });
  log('  ✓ alice gönderdi');

  // bob odayı açar → düz-metni çözer (E2E sağlam)
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), SENTINEL, { timeout: 12000 });
  log('  ✅ bob mesajı çözdü (E2E akış sağlam)');

  // mesaj id + oda
  const mid = await a.locator('#akis .msg.ben').last().getAttribute('data-id');
  const oda = await a.evaluate(async () => (await (await fetch('/api/odalar', { credentials: 'same-origin' })).json())[0].oda);
  if (!mid || !oda) throw new Error('❌ mesaj id / oda alınamadı: ' + mid + ' / ' + oda);

  log('\n2) GÜVENLİK: bob (gönderen değil) alice\'in mesajını silmeye çalışır → 403 beklenir:');
  const durum = await b.evaluate(async ({ oda, mid }) => (await fetch('/api/mesaj-sil', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-NarChat': '1' },
    body: JSON.stringify({ oda, id: mid }),
  })).status, { oda, mid });
  if (durum !== 403) throw new Error('❌ bob alice\'in mesajını silebildi (beklenen 403, gelen ' + durum + ')');
  // hâlâ çözülebilir olmalı (silinmedi)
  if (!(await b.locator('#akis').textContent()).includes(SENTINEL)) throw new Error('❌ yetkisiz istek mesajı bozdu');
  log('  ✅ 403 — yalnızca gönderen silebilir (bob\'ta mesaj duruyor)');

  log('\n3) alice kendi baloncuğuna uzun-bas → menü → "🗑 Sil" → onay → herkesten sil:');
  await a.locator(`#akis .msg[data-id="${mid}"]`).dispatchEvent('contextmenu');   // mesaj eylem menüsü (FAZ F2)
  await a.waitForSelector('#mesajMenu', { timeout: 5000 });
  await a.click('#mesajMenu .mesaj-menu-btn.tehlike');                            // "🗑 Sil (herkesten)" → onay (auto-accept)
  await a.waitForFunction(tombstoneMu, mid, { timeout: 10000 });
  if (!(await a.locator(`#akis .msg[data-id="${mid}"]`).textContent()).includes(TOMBSTONE))
    throw new Error('❌ alice baloncuğu tombstone metnini göstermiyor');
  log('  ✅ alice: baloncuk "🚫 Bu mesaj silindi"');

  // bob tarafı CANLI (SSE) tombstone + düz-metin artık yok
  await b.waitForFunction(tombstoneMu, mid, { timeout: 10000 });
  const bobMetin = await b.locator('#akis').textContent();
  if (bobMetin.includes(SENTINEL)) throw new Error('❌ bob\'ta silinen mesajın düz-metni HÂLÂ görünüyor!');
  if (!bobMetin.includes(TOMBSTONE)) throw new Error('❌ bob\'ta tombstone metni yok');
  log('  ✅ bob: canlı SSE ile tombstone — düz-metin GİTTİ (herkesten silindi)');

  log('\n4) Sunucu jsonl: kayıt {silindi:true, govde:null} — ciphertext sunucudan da kalktı:');
  const msgDir = join(server.veri, 'mesajlar');
  const dosyalar = await readdir(msgDir);
  let ham = '', kayit = null;
  for (const f of dosyalar) {
    const icerik = await readFile(join(msgDir, f), 'utf8'); ham += icerik;
    for (const satir of icerik.split('\n')) { if (!satir.trim()) continue; const m = JSON.parse(satir); if (m.id === mid) kayit = m; }
  }
  if (!kayit) throw new Error('❌ jsonl\'de mesaj kaydı yok');
  if (kayit.silindi !== true || kayit.govde !== null) throw new Error('❌ tombstone beklenen biçimde değil: ' + JSON.stringify(kayit));
  if (ham.includes(SENTINEL)) throw new Error('❌ düz-metin sunucuda (zaten olmamalı)');
  log('  ✅ jsonl: {silindi:true, govde:null} — ciphertext sunucudan kalktı, düz-metin yok');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ MESAJ SİL (HERKESTEN) E2E GEÇTİ:');
  log('   • yalnızca gönderen silebilir (bob → 403)');
  log('   • uzun-bas → onay → iki tarafta canlı tombstone (SSE)');
  log('   • sunucu kaydı {silindi:true, govde:null} — ciphertext de kalktı');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
