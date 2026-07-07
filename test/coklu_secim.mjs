// NarChat — Çoklu mesaj seçimi (toplu ilet/sil) FAZ G11 (Playwright, gerçek app.js)
// İddialar:
//   1) Baloncuğa sağ-tık → menü "☑️ Seç" → seçim modu; başka baloncuklara tıkla → çoklu seçim;
//        üst bar "N seçili" gösterir.
//   2) TOPLU İLET: 3 seçili mesaj carol sohbetine iletilir → carol ÜÇÜNÜ DE çözer
//        (her biri hedef için YENİDEN şifrelendi — E2E korunur).
//   3) SAHİP-KORUMASI: yalnız karşının mesajı seçiliyken "Sil" düğmesi GİZLİ (kendi yok).
//   4) TOPLU SİL: kendi 2 mesajını seç → sil → alice + bob'ta canlı tombstone (herkesten silindi).
//
// Çalıştır:  HEADLESS=1 node test/coklu_secim.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8128;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const M1 = 'MSEL_BIR_' + PORT, M2 = 'MSEL_IKI_' + PORT, M3 = 'MSEL_UC_' + PORT;
const B1 = 'BOBMSG_' + PORT;

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-coklusecim-'));
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
    const b = document.getElementById('kayitBtn'); return !!b && typeof b.onclick === 'function';
  }, null, { timeout: 25000 });
}
async function yeniSayfa(ctx, ad) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${ad} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/'); await uygulamaHazir(page); return page;
}
async function kayitOl(page, kullanici) {
  await page.fill('#gKullanici', kullanici); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}
async function listeyeDon(page) {
  if (await page.locator('#geriBtn').isVisible().catch(() => false)) await page.click('#geriBtn');
  await page.click('#altNav button[data-gor="sohbetler"]').catch(() => {});
  await page.waitForSelector('#aramaIn:visible', { timeout: 8000 });
}
async function kisiAc(page, kullanici) {
  await page.click('#altNav button[data-gor="kisiler"]');
  await page.click('#ekleBtn'); await page.click('#kisiEkleAc');
  await page.fill('#kisiEkleIn', kullanici); await page.click('#kisiEkleBtn');
  const kisi = page.locator('#kisiler .oda', { hasText: '@' + kullanici });
  await kisi.waitFor({ timeout: 10000 }); await kisi.click();
  await page.waitForFunction((k) => document.getElementById('odaBaslik')?.textContent.includes(k), kullanici, { timeout: 10000 });
  await page.waitForSelector('#mesajIn:not([disabled])');
}
async function yaz(page, metin) {
  await page.fill('#mesajIn', metin); await page.click('#gonderBtn');
  await page.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), metin, { timeout: 12000 });
}
async function odaAcAd(page, ad) {
  await page.locator('#odalar .oda', { hasText: ad }).first().click();
  await page.waitForFunction((a) => document.getElementById('odaBaslik')?.textContent.includes(a), ad, { timeout: 8000 });
  await page.waitForSelector('#mesajIn:not([disabled])');
}
const baloncuk = (page, metin) => page.locator('#akis .msg', { hasText: metin }).first();
const secimSay = (page) => page.locator('#secimSay').textContent();
const tombstone = (id) => { const el = document.querySelector(`.msg[data-id="${id}"]`); return !!el && el.classList.contains('silindi'); };

let server;
async function main() {
  log('☑️  NarChat "Çoklu mesaj seçimi (toplu ilet/sil)" G11 (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const a = await yeniSayfa(await browser.newContext(MOBIL), 'alice');
  const b = await yeniSayfa(await browser.newContext(MOBIL), 'bob');
  const c = await yeniSayfa(await browser.newContext(MOBIL), 'carol');
  a.on('dialog', d => d.accept());   // toplu sil onayı

  log('1) Kurulum: alice→bob (3 mesaj), alice carol sohbeti (ilet hedefi), bob→alice (1 mesaj):');
  await kayitOl(a, 'alice'); await kayitOl(b, 'bob'); await kayitOl(c, 'carol');
  await kisiAc(a, 'bob'); await yaz(a, M1); await yaz(a, M2); await yaz(a, M3);
  await listeyeDon(a);
  await kisiAc(a, 'carol'); await listeyeDon(a);     // carol odası oluşur (ilet hedefi)
  // bob alice'e yazar (alice'in mesajları geldi → liste için reload)
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first(); await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])'); await yaz(b, B1);
  // alice bob sohbetini taze açar (M1,M2,M3,B1 yüklensin)
  await a.reload(); await uygulamaHazir(a);
  await odaAcAd(a, 'bob');
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), B1, { timeout: 12000 });
  log('  ✓ bob sohbetinde 3 kendi + 1 karşı mesaj hazır');

  log('\n2) Seçim modu: sağ-tık → "Seç" → 3 mesaj seç → "3 seçili":');
  await baloncuk(a, M1).dispatchEvent('contextmenu');
  await a.waitForSelector('#mesajMenu', { timeout: 5000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Seç' }).click();
  await a.waitForSelector('#secimBar:not(.gizli)', { timeout: 5000 });
  if ((await secimSay(a)) !== '1 seçili') throw new Error('❌ seçim başında "1 seçili" değil: ' + await secimSay(a));
  await baloncuk(a, M2).click(); await baloncuk(a, M3).click();
  await a.waitForFunction(() => document.getElementById('secimSay')?.textContent === '3 seçili', null, { timeout: 5000 });
  if ((await a.locator('#akis .msg.secili').count()) !== 3) throw new Error('❌ 3 baloncuk .secili değil');
  log('  ✅ "Seç" → 3 mesaj seçildi (3 seçili, baloncuklar işaretli)');

  log('\n3) TOPLU İLET → carol: 3 mesaj iletilir; carol üçünü de çözer (E2E re-encrypt):');
  await a.click('#secimIletBtn');
  await a.waitForSelector('#mesajMenu .ilet-hedef', { timeout: 5000 });
  await a.locator('#mesajMenu .ilet-hedef', { hasText: 'carol' }).click();
  await a.waitForFunction(() => document.getElementById('secimBar')?.classList.contains('gizli'), null, { timeout: 8000 });   // ilet sonrası seçim modu kapanır
  // carol kendi sohbetini açar → 3 mesajı da görür
  await c.reload(); await uygulamaHazir(c);
  const carolOda = c.locator('#odalar .oda').first(); await carolOda.waitFor({ timeout: 12000 }); await carolOda.click();
  await c.waitForSelector('#mesajIn:not([disabled])');
  for (const mm of [M1, M2, M3])
    await c.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), mm, { timeout: 12000 })
      .catch(() => { throw new Error('❌ carol iletilen mesajı çözemedi: ' + mm); });
  log('  ✅ carol 3 iletilen mesajı da çözdü (her biri hedef için yeniden şifrelendi — E2E)');

  log('\n4) SAHİP-KORUMASI: yalnız bob\'un mesajı seçiliyken "Sil" gizli:');
  await baloncuk(a, B1).dispatchEvent('contextmenu');
  await a.waitForSelector('#mesajMenu', { timeout: 5000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Seç' }).click();
  await a.waitForSelector('#secimBar:not(.gizli)', { timeout: 5000 });
  if (!(await a.locator('#secimSilBtn').evaluate(el => el.classList.contains('gizli'))))
    throw new Error('❌ karşının mesajı seçiliyken Sil düğmesi görünüyor (sahip-koruması yok)');
  log('  ✅ karşı mesaj seçili → "Sil" gizli (yalnız kendi mesajın silinebilir)');
  await a.click('#secimKapat');   // seçimi bırak

  log('\n5) TOPLU SİL: kendi 2 mesajını seç → sil → alice + bob canlı tombstone:');
  const id1 = await baloncuk(a, M1).getAttribute('data-id');
  const id2 = await baloncuk(a, M2).getAttribute('data-id');
  await baloncuk(a, M1).dispatchEvent('contextmenu');
  await a.waitForSelector('#mesajMenu', { timeout: 5000 });
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Seç' }).click();
  await baloncuk(a, M2).click();
  await a.waitForFunction(() => document.getElementById('secimSay')?.textContent === '2 seçili', null, { timeout: 5000 });
  await a.click('#secimSilBtn');   // confirm → dialog auto-accept
  await a.waitForFunction(tombstone, id1, { timeout: 10000 });
  await a.waitForFunction(tombstone, id2, { timeout: 10000 });
  // bob tarafı canlı tombstone + düz-metin gitti
  await b.waitForFunction(tombstone, id1, { timeout: 10000 });
  await b.waitForFunction(tombstone, id2, { timeout: 10000 });
  const bobMetin = await b.locator('#akis').textContent();
  if (bobMetin.includes(M1) || bobMetin.includes(M2)) throw new Error('❌ bob\'ta silinen mesajların düz-metni hâlâ var');
  log('  ✅ 2 mesaj herkesten silindi — alice + bob canlı tombstone, düz-metin gitti');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ ÇOKLU MESAJ SEÇİMİ (G11) E2E GEÇTİ:');
  log('   • Seç → çoklu seçim + "N seçili" sayaç');
  log('   • toplu ilet → hedef için yeniden şifrelenir, karşı taraf çözer (E2E)');
  log('   • sahip-koruması: karşı mesaj seçiliyken Sil gizli');
  log('   • toplu sil (kendi) → iki tarafta canlı tombstone');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
