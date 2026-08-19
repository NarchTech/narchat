// NarChat — Sohbet içi arama (yerel) E2E (Playwright, gerçek app.js)
// İddialar:
//   1) alice 3 mesaj gönderir (2'si "ELMABAHCESI" içerir).
//   2) 🔍 ile arama açılır, "ELMABAHCESI" yazılır → 2 eşleşme vurgulanır (mark), sayaç "2 / 2",
//      gezinme (sonraki) sarmalla "1 / 2"ye geçer.
//   3) Eşleşmeyen terim → "0".
//   4) Kapat → vurgular temizlenir, çubuk gizlenir.
// (Tamamen istemci-tarafı; sunucuya/E2E'ye dokunmaz — açık sohbetteki çözülmüş baloncuklarda arar.)
//
// Çalıştır:  HEADLESS=1 node test/sohbet_ara.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8113;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const TERIM = 'ELMABAHCESI';
const MESAJLAR = [`${TERIM} birinci mesaj`, 'ARMUTBAHCESI ikinci mesaj', `${TERIM} ucuncu mesaj`];

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-ara-'));
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
const durumOku = (page) => page.evaluate(() => ({
  barAcik: !document.getElementById('sohbetAraBar').classList.contains('gizli'),
  eslesme: document.querySelectorAll('#akis .msg.ara-eslesme').length,
  mark: document.querySelectorAll('#akis mark.ara-im').length,
  say: document.getElementById('sohbetAraSay').textContent,
}));

let server;
async function main() {
  log('🔍 NarChat "Sohbet içi arama" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');

  log('1) alice + bob kayıt, alice → bob 3 mesaj:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  for (const msg of MESAJLAR) {
    await a.fill('#mesajIn', msg); await a.click('#gonderBtn');
    await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), msg, { timeout: 12000 });
  }
  log('  ✓ 3 mesaj gönderildi (2× ' + TERIM + ')');

  log('\n2) 🔍 arama aç → "' + TERIM + '" → 2 eşleşme, sayaç, gezinme:');
  await a.click('#sohbetAraBtn');
  await a.waitForSelector('#sohbetAraBar:not(.gizli)', { timeout: 8000 });
  await a.fill('#sohbetAraIn', TERIM);
  await a.waitForFunction(() => document.getElementById('sohbetAraSay').textContent.includes('/'), null, { timeout: 8000 });
  let r = await durumOku(a);
  if (!r.barAcik) throw new Error('❌ arama çubuğu açılmadı');
  if (r.eslesme !== 2) throw new Error('❌ eşleşme sayısı 2 değil: ' + r.eslesme);
  if (r.mark < 2) throw new Error('❌ vurgu (mark) yok: ' + r.mark);
  if (r.say !== '2 / 2') throw new Error('❌ sayaç "2 / 2" değil (en yeni eşleşmeye gitmeli): ' + r.say);
  log('  ✅ 2 eşleşme vurgulandı · sayaç "2 / 2" (en yeni eşleşme aktif)');

  await a.click('#sohbetAraSonra');          // sarmal: 2/2 → 1/2 (başa döner)
  await a.waitForFunction(() => document.getElementById('sohbetAraSay').textContent === '1 / 2', null, { timeout: 5000 });
  log('  ✅ "sonraki" sarmal gezinme → "1 / 2"');

  log('\n3) eşleşmeyen terim → "0":');
  await a.fill('#sohbetAraIn', 'YOKBOYLEKELIME_' + PORT);
  await a.waitForFunction(() => document.getElementById('sohbetAraSay').textContent === '0', null, { timeout: 8000 });
  r = await durumOku(a);
  if (r.eslesme !== 0 || r.mark !== 0) throw new Error('❌ eşleşmesiz terimde vurgu kaldı: ' + JSON.stringify(r));
  log('  ✅ eşleşmesiz terim "0" · vurgu yok');

  log('\n4) kapat → vurgular temizlenir, çubuk gizlenir:');
  await a.click('#sohbetAraKapat');
  await a.waitForSelector('#sohbetAraBar.gizli', { state: 'attached', timeout: 5000 });
  r = await durumOku(a);
  if (r.barAcik || r.eslesme !== 0 || r.mark !== 0) throw new Error('❌ kapatınca temizlenmedi: ' + JSON.stringify(r));
  // mesaj metni bozulmadan duruyor mu (mark kaldırıldı, düz metin geri geldi)
  const saglam = await a.evaluate((s) => document.getElementById('akis').textContent.includes(s), MESAJLAR[0]);
  if (!saglam) throw new Error('❌ kapatınca mesaj metni bozuldu');
  log('  ✅ çubuk gizli · vurgular temiz · mesaj metni sağlam');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ SOHBET İÇİ ARAMA E2E GEÇTİ:');
  log('   • terim vurgusu (mark) + eşleşme sayacı + sarmal gezinme');
  log('   • eşleşmesiz "0" · kapatınca temiz geri-dönüş (metin bozulmaz)');
  log('   • tamamen istemci-tarafı — sunucuya/E2E\'ye dokunmaz');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
