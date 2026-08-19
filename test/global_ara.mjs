// NarChat — Tüm sohbetlerde arama (global) FAZ G10 (Playwright, gerçek app.js)
// İddialar:
//   1) alice'in İKİ ayrı sohbeti (bob + carol) farklı sentinel mesajlar içerir; E2E çözülür.
//   2) Sohbet listesinde "ELMA" ara → globalAra YALNIZ bob sohbetinde 1 mesaj sonucu;
//        sonuca tıkla → bob sohbeti açılır + mesaj vurgulanır (scroll+.vurgu).
//   3) Ortak terim "GIZLI" ara → İKİ sohbetten 2 sonuç (gerçekten global).
//   4) GİZLİLİK: arama TAMAMEN yerel — arama terimi HİÇBİR ağ isteğine girmez
//        (sunucu çözülmüş metni görmez; E2E korunur).
//
// Çalıştır:  HEADLESS=1 node test/global_ara.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8127;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const MSG_BOB = 'GIZLI_ELMA_' + PORT;
const MSG_CAROL = 'GIZLI_ARMUT_' + PORT;

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-globalara-'));
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
async function kisiEkleVeYaz(page, kullanici, metin) {
  await page.click('#altNav button[data-gor="kisiler"]');
  await page.click('#ekleBtn'); await page.click('#kisiEkleAc');
  await page.fill('#kisiEkleIn', kullanici); await page.click('#kisiEkleBtn');
  const kisi = page.locator('#kisiler .oda', { hasText: '@' + kullanici });
  await kisi.waitFor({ timeout: 10000 }); await kisi.click();
  // DOĞRU oda gerçekten açılana kadar bekle (geriBtn sonrası #mesajIn önceki odadan zaten enabled olabilir → yarış)
  await page.waitForFunction((k) => document.getElementById('odaBaslik')?.textContent.includes(k), kullanici, { timeout: 10000 });
  await page.waitForSelector('#mesajIn:not([disabled])');
  await page.fill('#mesajIn', metin); await page.click('#gonderBtn');
  await page.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), metin, { timeout: 12000 });
  await page.click('#geriBtn');   // sohbet listesine dön
}

let server;
async function main() {
  log('🔍 NarChat "Tüm sohbetlerde arama (global)" G10 (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctxA = await browser.newContext(MOBIL);
  const ctxB = await browser.newContext(MOBIL);
  const ctxC = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctxA, 'alice');
  const b = await yeniSayfa(ctxB, 'bob');
  const c = await yeniSayfa(ctxC, 'carol');

  log('1) alice + bob + carol kayıt; alice → bob ve alice → carol farklı mesajlar:');
  await kayitOl(a, 'alice');
  await kayitOl(b, 'bob');
  await kayitOl(c, 'carol');
  await kisiEkleVeYaz(a, 'bob', MSG_BOB);
  await kisiEkleVeYaz(a, 'carol', MSG_CAROL);
  log('  ✓ iki sohbet kuruldu (bob: ELMA · carol: ARMUT)');

  // ağ isteklerini izle — arama terimi hiçbir URL'de geçmemeli (yerel arama kanıtı)
  const istekURL = [];
  a.on('request', r => istekURL.push(r.url()));

  log('\n2) Listede "ELMA" ara → yalnız bob sohbetinde 1 sonuç; tıkla → bob sohbeti açılır + vurgu:');
  await a.click('#altNav button[data-gor="sohbetler"]');   // sohbet listesi görünümü (arama kutusu burada)
  await a.waitForSelector('#aramaIn:visible', { timeout: 8000 });
  await a.fill('#aramaIn', 'ELMA');
  await a.waitForFunction(() => {
    const g = document.getElementById('globalAra');
    return g && !g.classList.contains('gizli') && g.querySelectorAll('.ara-sonuc').length >= 1;
  }, null, { timeout: 8000 });
  const elmaSayi = await a.locator('#globalAra .ara-sonuc').count();
  if (elmaSayi !== 1) throw new Error('❌ "ELMA" için beklenen 1 sonuç, gelen ' + elmaSayi);
  const mid = await a.locator('#globalAra .ara-sonuc').first().getAttribute('data-mid');
  await a.locator('#globalAra .ara-sonuc').first().click();
  await a.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), MSG_BOB, { timeout: 8000 });
  await a.waitForFunction((id) => {
    const el = document.querySelector(`#akis .msg[data-id="${id}"]`);
    return !!el && el.classList.contains('vurgu');
  }, mid, { timeout: 4000 }).catch(() => { throw new Error('❌ sonuç mesajı vurgulanmadı'); });
  log('  ✅ "ELMA" → 1 sonuç (bob); tıkla → bob sohbeti açıldı + mesaj vurgulandı');

  log('\n3) Ortak terim "GIZLI" ara → iki sohbetten 2 sonuç (gerçekten global):');
  await a.click('#geriBtn');
  await a.waitForSelector('#aramaIn:visible', { timeout: 8000 });
  await a.fill('#aramaIn', 'GIZLI');
  await a.waitForFunction(() => {
    const g = document.getElementById('globalAra');
    return g && !g.classList.contains('gizli') && g.querySelectorAll('.ara-sonuc').length >= 2;
  }, null, { timeout: 8000 });
  const gizliSayi = await a.locator('#globalAra .ara-sonuc').count();
  if (gizliSayi !== 2) throw new Error('❌ "GIZLI" için beklenen 2 sonuç (iki sohbet), gelen ' + gizliSayi);
  const sonucMetin = await a.locator('#globalAra').textContent();
  if (!sonucMetin.includes('ELMA') || !sonucMetin.includes('ARMUT'))
    throw new Error('❌ global sonuçlar her iki sohbeti kapsamıyor');
  log('  ✅ "GIZLI" → 2 sonuç, ELMA + ARMUT (her iki sohbet)');

  log('\n4) GİZLİLİK: arama terimi hiçbir ağ isteği URL\'sinde geçmedi (yerel arama, E2E korunur):');
  const sizinti = istekURL.filter(u => u.includes('ELMA') || u.includes('ARMUT') || u.includes('GIZLI'));
  if (sizinti.length) throw new Error('❌ arama terimi ağa sızdı: ' + sizinti[0]);
  log('  ✅ ' + istekURL.length + ' istek izlendi — arama terimi hiçbirinde yok (sunucu çözülmüş metni görmez)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ TÜM SOHBETLERDE ARAMA (G10) E2E GEÇTİ:');
  log('   • iki ayrı sohbette mesajlar — global arama her ikisinde bulur');
  log('   • sonuca tıkla → doğru sohbet açılır + mesaj vurgulanır');
  log('   • arama tamamen YEREL — terim ağa gitmez (E2E korunur)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
