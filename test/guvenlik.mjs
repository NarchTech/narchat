// NarChat — G5 Güvenlik numarası (safety number / parmak izi) + anahtar değişimi (MITM) tespiti
// İddialar:
//   1) alice + bob 1:1 sohbet; başlığa dokun → "Güvenlik numarası" alt-sayfası açılır (12 grup × 5 hane).
//   2) SİMETRİ: alice'in gördüğü numara, bob'un gördüğü numara ile AYNI (anahtarlar kanonik sıralı).
//   3) DOĞRULAMA: alice "doğrulandı işaretle" → başlık alt-satırı "✓ doğrulandı".
//   4) MITM TESPİTİ: bob sunucudaki açık anahtarını değiştirir → alice yenilenince
//      "⚠️ güvenlik numarası değişti" uyarısı (alt-satır + alt-sayfada uyarı bloğu) + doğrulama düşer.
//
// Çalıştır:  HEADLESS=1 node test/guvenlik.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8121;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-guv-'));
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
// güvenlik numarasını alt-sayfadan oku: başlığa dokun → 12 grubu birleştir
async function guvNumOku(page) {
  await page.click('#odaBaslikSar');
  await page.waitForSelector('#mesajMenu.guv-sheet .guv-num', { timeout: 8000 });
  const num = await page.evaluate(() =>
    [...document.querySelectorAll('#mesajMenu .guv-num span')].map(s => s.textContent).join(''));
  return num;
}

let server;
async function main() {
  log('🔒 NarChat "Güvenlik numarası + MITM tespiti" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt; alice bob\'u ekler + 1:1 sohbet açar:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.fill('#mesajIn', 'merhaba bob'); await a.click('#gonderBtn');
  await a.waitForFunction(() => document.getElementById('akis')?.textContent.includes('merhaba bob'), null, { timeout: 12000 });
  log('  ✓ 1:1 oda kuruldu');

  // bob odayı açar
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');

  log('\n2) Güvenlik numarası alt-sayfası + SİMETRİ (alice == bob):');
  const numA = await guvNumOku(a);
  const numB = await guvNumOku(b);
  if (!/^\d{60}$/.test(numA)) throw new Error('❌ alice numarası 60 hane değil: "' + numA + '"');
  if (!/^\d{60}$/.test(numB)) throw new Error('❌ bob numarası 60 hane değil: "' + numB + '"');
  if (numA !== numB) throw new Error('❌ SİMETRİ kırık — alice ≠ bob:\n   ' + numA + '\n   ' + numB);
  log('  ✅ 60 haneli numara + alice ve bob AYNI numarayı görüyor (simetrik)');
  // bob'un sayfasını kapat
  await b.click('#mesajMenuOrt');

  log('\n3) DOĞRULAMA: alice "doğrulandı işaretle" → alt-satır "✓ doğrulandı":');
  await a.click('#mesajMenu .guv-dogrula');
  await a.waitForFunction(() => document.getElementById('odaUyeler')?.textContent.includes('doğrulandı'), null, { timeout: 8000 });
  log('  ✅ alice tarafında @bob doğrulandı (alt-satır işaretli)');

  log('\n4) MITM TESPİTİ: bob sunucudaki açık anahtarını değiştirir → alice uyarır:');
  // bob yeni rastgele bir açık anahtar yükler (anahtar rotasyonu / araya-girme senaryosu)
  const yeniDurum = await b.evaluate(async () => {
    const yeni = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const r = await fetch('/api/anahtar', { method: 'POST', headers: { 'content-type': 'application/json', 'X-NarChat': '1' },
      body: JSON.stringify({ pubkey: yeni }) });
    return r.status;
  });
  if (yeniDurum !== 200) throw new Error('❌ bob anahtar değişimi başarısız: HTTP ' + yeniDurum);
  // alice yeniden yüklenir → yenile() taban(localStorage) ile yeni anahtarı kıyaslar → değişti
  await a.reload(); await uygulamaHazir(a);
  const aliceOda = a.locator('#odalar .oda').first();
  await aliceOda.waitFor({ timeout: 12000 }); await aliceOda.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.waitForFunction(() => document.getElementById('odaUyeler')?.textContent.includes('değişti'), null, { timeout: 10000 });
  log('  ✅ alt-satır: "⚠️ güvenlik numarası değişti"');
  // alt-sayfada uyarı bloğu + doğrulama düşmüş olmalı
  await a.click('#odaBaslikSar');
  await a.waitForSelector('#mesajMenu.guv-sheet', { timeout: 8000 });
  const uyariVar = await a.evaluate(() => !!document.querySelector('#mesajMenu .guv-uyari'));
  if (!uyariVar) throw new Error('❌ alt-sayfada "değişti" uyarı bloğu yok');
  const onayli = await a.evaluate(() => {
    const d = document.querySelector('#mesajMenu .guv-dogrula'); return d ? d.classList.contains('onayli') : false;
  });
  if (onayli) throw new Error('❌ anahtar değişince doğrulama düşmedi (hâlâ onaylı görünüyor)');
  log('  ✅ alt-sayfada uyarı bloğu var + önceki doğrulama düştü (anahtar değişti)');

  if (!HEADLESS) await sleep(1500);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ GÜVENLİK NUMARASI (G5) E2E GEÇTİ:');
  log('   • başlığa dokun → 60 haneli güvenlik numarası');
  log('   • simetrik: iki taraf da AYNI numarayı görür (karşılaştırılabilir)');
  log('   • doğrulandı işareti alt-satırda görünür');
  log('   • karşı anahtar değişince MITM uyarısı + doğrulama düşer');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
