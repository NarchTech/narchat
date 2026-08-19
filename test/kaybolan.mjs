// NarChat — G6 Kaybolan mesajlar (disappearing / süreli oto-sil, E2E) Playwright
// İddialar:
//   1) alice 1:1 sohbette başlıktaki ⏱ → "1 saat" seçer → buton aktif (vurgu) + gönderdiği
//      mesaj sunucuda kaybol=3600 + sil_ts ile damgalanır (TTL = METADATA, içerik DEĞİL).
//   2) EXPIRY: kaybol=1sn'lik mesaj → ~1.5sn sonra okuma anında sunucu TOMBSTONE'lar:
//      ciphertext (govde) SUNUCUDAN da kalkar (govde=null, silindi, kaybolan).
//   3) VANISH: alice yeniden yükleyince o mesaj baloncuğu HİÇ görünmez (tombstone izi YOK).
//
// Çalıştır:  HEADLESS=1 node test/kaybolan.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8122;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kaybol-'));
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
async function kayitlariOku(veri) {
  const dir = join(veri, 'mesajlar'); const out = [];
  for (const f of await readdir(dir)) {
    for (const satir of (await readFile(join(dir, f), 'utf8')).split('\n')) {
      if (satir.trim()) { try { out.push(JSON.parse(satir)); } catch {} }
    }
  }
  return out;
}

let server;
async function main() {
  log('⏱  NarChat "Kaybolan mesajlar" (G6) E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice bob\'u ekler + 1:1 sohbet:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ oda açık');

  log('\n2) ⏱ → "1 saat" seç → buton aktif + gönderilen mesaj kaybol=3600 damgalı:');
  await a.click('#kaybolanBtn');
  await a.waitForSelector('#mesajMenu.kaybolan-sheet', { timeout: 8000 });
  await a.locator('#mesajMenu .kaybolan-sec', { hasText: '1 saat' }).click();
  await a.waitForFunction(() => document.getElementById('kaybolanBtn')?.classList.contains('vurgu'), null, { timeout: 8000 });
  log('  ✅ ⏱ butonu aktif (vurgu)');
  await a.fill('#mesajIn', 'bu mesaj bir saat sonra silinecek'); await a.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('bir saat sonra'), null, { timeout: 12000 });
  await sleep(400);
  let kayitlar = await kayitlariOku(server.veri);
  const damgali = kayitlar.find(m => m.kaybol === 3600 && m.sil_ts);
  if (!damgali) throw new Error('❌ kaybol=3600 + sil_ts damgalı kayıt yok: ' + JSON.stringify(kayitlar.map(m=>({k:m.kaybol}))));
  if (damgali.sil_ts !== damgali.ts + 3600) throw new Error('❌ sil_ts = ts+3600 değil');
  log('  ✅ sunucu kaydı: kaybol=3600 + sil_ts=ts+3600 (TTL metadata, içerik şifreli)');

  log('\n3) EXPIRY: kaybol=1sn mesaj → ~1.5sn sonra okuma anında sunucu ciphertext\'i siler:');
  const oda = await a.evaluate(async () => { const j = await (await fetch('/api/odalar')).json(); return j[0] && j[0].oda; });
  if (!oda) throw new Error('❌ oda id alınamadı');
  const gon = await a.evaluate(async (oda) => {
    const r = await fetch('/api/mesaj', { method: 'POST', headers: { 'content-type': 'application/json', 'X-NarChat': '1' },
      body: JSON.stringify({ oda, govde: { sema: 'e2e1', msg: 'QUFB', n: 'QUFB', gonderenPub: 'QUFB', anahtarlar: [] }, kaybol: 1 }) });
    return r.json();
  }, oda);
  if (!gon.id) throw new Error('❌ kaybol=1 mesaj gönderilemedi');
  await sleep(1500);
  // okuma → sunucu süpürür (lazy sweep)
  await a.evaluate(async (oda) => { await fetch('/api/mesajlar?oda=' + encodeURIComponent(oda) + '&since=0'); }, oda);
  await sleep(200);
  kayitlar = await kayitlariOku(server.veri);
  const mezar = kayitlar.find(m => m.id === gon.id);
  if (!mezar) throw new Error('❌ kaybol=1 kaydı bulunamadı');
  if (mezar.govde !== null || !mezar.silindi || !mezar.kaybolan)
    throw new Error('❌ süresi dolan mesaj tombstone değil: ' + JSON.stringify(mezar));
  log('  ✅ sunucu: govde=null + silindi + kaybolan (ciphertext SUNUCUDAN kalktı)');

  log('\n4) VANISH: alice yeniden yükler → kaybolan mesaj baloncuğu HİÇ yok (iz yok):');
  await a.reload(); await uygulamaHazir(a);
  const aliceOda = a.locator('#odalar .oda').first();
  await aliceOda.waitFor({ timeout: 12000 }); await aliceOda.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('bir saat sonra'), null, { timeout: 12000 });
  const varMi = await a.evaluate((id) => !!document.querySelector(`#akis .msg[data-id="${id}"]`), gon.id);
  if (varMi) throw new Error('❌ kaybolan mesaj baloncuğu hâlâ görünüyor');
  // tombstone "🚫 silindi" izi de OLMAMALI (kaybolan = tamamen yok olur)
  const izVar = await a.evaluate(() => document.querySelectorAll('#akis .msg.silindi').length);
  if (izVar > 0) throw new Error('❌ kaybolan mesaj tombstone izi bıraktı (🚫)');
  log('  ✅ baloncuk yok + tombstone izi yok (tam vanish) · kalıcı mesaj duruyor');

  if (!HEADLESS) await sleep(1500);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ KAYBOLAN MESAJLAR (G6) E2E GEÇTİ:');
  log('   • ⏱ → süre seç → gönderilen mesaj TTL (kaybol) ile damgalanır');
  log('   • süre dolunca sunucu ciphertext\'i SİLER (govde=null, tombstone)');
  log('   • istemcide iz bırakmadan vanish (tombstone bile yok)');
  log('   • TTL = metadata; mesaj içeriği şifreli kalır (E2E korunur)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
