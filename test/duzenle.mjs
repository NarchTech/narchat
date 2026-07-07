// NarChat — Mesaj düzenleme (edit, E2E) FAZ G9 (Playwright, gerçek app.js)
// İddialar:
//   1) alice→bob şifreli mesaj; bob ÇÖZER (E2E akış sağlam).
//   2) GÜVENLİK: bob (gönderen DEĞİL) alice'in mesajını düzenleyemez → 403.
//   3) alice kendi baloncuğuna sağ-tık → menü → "✏️ Düzenle" → komp eski metinle dolar →
//        metni değiştir → gönder:
//        - alice'te baloncuk YENİ metni + "düzenlendi" işareti gösterir; eski metin gider
//        - bob'ta da CANLI (SSE) yeni metin + "düzenlendi"; eski düz-metin artık YOK
//   4) Sunucu jsonl: kayıt {duzenlendi:true} + govde YENİ opak blob; ESKİ ve YENİ düz-metin
//      sunucuda YOK (E2E korunur — yalnız ciphertext).
//
// Çalıştır:  HEADLESS=1 node test/duzenle.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8126;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const ESKI = 'DUZENLENECEK_ESKI_' + PORT;
const YENI = 'DUZENLENDI_YENI_' + PORT;

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-duzenle-'));
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
const duzenliMi = (id) => {
  const el = document.querySelector(`.msg[data-id="${id}"]`);
  return !!el && !!el.querySelector('.meta .duzenli-im');
};

let server;
async function main() {
  log('✏️  NarChat "Mesaj düzenleme (edit, E2E)" G9 (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
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
  await a.fill('#mesajIn', ESKI); await a.click('#gonderBtn');
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), ESKI, { timeout: 12000 });
  log('  ✓ alice gönderdi');

  // bob odayı açar → düz-metni çözer (E2E sağlam)
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), ESKI, { timeout: 12000 });
  log('  ✅ bob mesajı çözdü (E2E akış sağlam)');

  // mesaj id + oda
  const mid = await a.locator('#akis .msg.ben').last().getAttribute('data-id');
  const oda = await a.evaluate(async () => (await (await fetch('/api/odalar', { credentials: 'same-origin' })).json())[0].oda);
  if (!mid || !oda) throw new Error('❌ mesaj id / oda alınamadı: ' + mid + ' / ' + oda);

  log('\n2) GÜVENLİK: bob (gönderen değil) alice\'in mesajını düzenlemeye çalışır → 403 beklenir:');
  const durum = await b.evaluate(async ({ oda, mid }) => (await fetch('/api/mesaj-duzenle', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-NarChat': '1' },
    body: JSON.stringify({ oda, id: mid, govde: { sema: 'e2e1', msg: 'x', n: 'y', gonderenPub: 'z', anahtarlar: [] } }),
  })).status, { oda, mid });
  if (durum !== 403) throw new Error('❌ bob alice\'in mesajını düzenleyebildi (beklenen 403, gelen ' + durum + ')');
  if (!(await b.locator('#akis').textContent()).includes(ESKI)) throw new Error('❌ yetkisiz istek mesajı bozdu');
  log('  ✅ 403 — yalnızca gönderen düzenleyebilir (bob\'ta mesaj duruyor)');

  log('\n3) alice baloncuğa sağ-tık → menü → "✏️ Düzenle" → komp eski metinle dolar → değiştir → gönder:');
  await a.locator(`#akis .msg[data-id="${mid}"]`).dispatchEvent('contextmenu');   // mesaj eylem menüsü
  await a.waitForSelector('#mesajMenu', { timeout: 5000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Düzenle' }).click();
  await a.waitForFunction((s) => document.getElementById('mesajIn')?.value === s, ESKI, { timeout: 5000 });
  if (await a.locator('#duzenleBar').evaluate(el => el.classList.contains('gizli')))
    throw new Error('❌ düzenleme barı görünmüyor');
  log('  ✓ komp eski metinle doldu + düzenleme barı açıldı');
  await a.fill('#mesajIn', YENI); await a.click('#gonderBtn');

  // alice: baloncuk yeni metin + "düzenlendi" işareti; eski metin gitti
  await a.waitForFunction(duzenliMi, mid, { timeout: 10000 });
  const aliceBaloncuk = await a.locator(`#akis .msg[data-id="${mid}"]`).textContent();
  if (!aliceBaloncuk.includes(YENI)) throw new Error('❌ alice baloncuğu yeni metni göstermiyor');
  if (aliceBaloncuk.includes(ESKI)) throw new Error('❌ alice baloncuğunda eski metin HÂLÂ var');
  log('  ✅ alice: baloncuk YENİ metin + "düzenlendi" işareti (eski metin gitti)');

  // bob tarafı CANLI (SSE) yeni metin + işaret; eski düz-metin artık yok
  await b.waitForFunction(duzenliMi, mid, { timeout: 10000 });
  const bobMetin = await b.locator('#akis').textContent();
  if (!bobMetin.includes(YENI)) throw new Error('❌ bob\'ta yeni metin görünmüyor');
  if (bobMetin.includes(ESKI)) throw new Error('❌ bob\'ta eski düz-metin HÂLÂ görünüyor!');
  log('  ✅ bob: canlı SSE ile YENİ metin + "düzenlendi" — eski metin GİTTİ');

  log('\n4) Sunucu jsonl: {duzenlendi:true} + yeni opak blob; ESKİ/YENİ düz-metin sunucuda YOK:');
  const msgDir = join(server.veri, 'mesajlar');
  const dosyalar = await readdir(msgDir);
  let ham = '', kayit = null;
  for (const f of dosyalar) {
    const icerik = await readFile(join(msgDir, f), 'utf8'); ham += icerik;
    for (const satir of icerik.split('\n')) { if (!satir.trim()) continue; const m = JSON.parse(satir); if (m.id === mid) kayit = m; }
  }
  if (!kayit) throw new Error('❌ jsonl\'de mesaj kaydı yok');
  if (kayit.duzenlendi !== true) throw new Error('❌ kayıt duzenlendi:true değil: ' + JSON.stringify(kayit));
  if (!kayit.govde || kayit.govde.sema !== 'e2e1') throw new Error('❌ yeni govde opak e2e1 blob değil');
  if (ham.includes(ESKI)) throw new Error('❌ ESKİ düz-metin sunucuda! (E2E ihlali)');
  if (ham.includes(YENI)) throw new Error('❌ YENİ düz-metin sunucuda! (E2E ihlali)');
  log('  ✅ jsonl: {duzenlendi:true} + opak yeni blob; ESKİ/YENİ düz-metin sunucuda YOK (E2E korunur)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ MESAJ DÜZENLEME (G9) E2E GEÇTİ:');
  log('   • yalnızca gönderen düzenleyebilir (bob → 403)');
  log('   • menü → Düzenle → komp eski metinle dolar → değiştir → iki tarafta canlı (SSE)');
  log('   • baloncukta "düzenlendi" işareti; sunucuda yalnız opak yeni ciphertext (E2E)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
