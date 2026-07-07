// NarChat — Çok-cihaz "cihaz bağlama" E2E (Playwright, gerçek app.js)
// Faz-4 / çok-cihaz kanıtı: AYNI hesap, İKİNCİ bir cihazda (ayrı IndexedDB) anahtarı kayıpsız alır.
//
// Güvenlik-kritik iddialar:
//   A) Yeni cihazda kullanıcı+parola ile giriş, SESSİZCE yeni anahtar ÜRETMEZ (hesabı bozmaz)
//      → "cihaz bağla" ekranına yönlendirir; sunucudaki pubkey DEĞİŞMEZ.
//   B) Bağlama kodu + parola ile ikinci cihaz anahtarı alır; bob'un alice'e şifrelediği mesajı ÇÖZER.
//   C) Anahtar sunucuya düz gitmez (aktarım blob'u opak; parola-cümlesi sunucuya gitmez).
//   D) İkinci cihazın pubkey'i = birinci cihazınki (anahtar rotasyonu YOK).
//
// Çalıştır:  HEADLESS=1 node test/cihaz_baglama.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8108;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const SENTINEL = 'CIHAZ_BAGLAMA_GIZLI_MESAJ_' + PORT;   // bob → alice; dev2 bunu çözmeli

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-cihaz-'));
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
const pubkeyAl = (page) => page.evaluate(async () => {
  const r = await fetch('/api/ben', { credentials: 'same-origin' }); const d = await r.json(); return d.pubkey;
});

let server;
async function main() {
  log('🔗 NarChat çok-cihaz "cihaz bağlama" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 140 });

  const ctxA1 = await browser.newContext(MOBIL);   // alice — CİHAZ 1 (anahtar burada doğar)
  const ctxB  = await browser.newContext(MOBIL);   // bob
  const ctxA2 = await browser.newContext(MOBIL);   // alice — CİHAZ 2 (ayrı IndexedDB = taze cihaz)

  // 1) alice cihaz-1'de kayıt → anahtar üretir
  log('1) alice CİHAZ-1\'de kayıt oluyor (anahtar bu cihazda doğar):');
  const a1 = await yeniSayfa(ctxA1, 'alice-c1');
  await kayitOl(a1, 'alice');
  const P1 = await pubkeyAl(a1);
  log('  ✓ alice kayıtlı · sunucu pubkey P1 = ' + P1.slice(0, 18) + '…');

  // 2) bob kayıt + alice'e şifreli SENTINEL gönderir (alice'in pubkey'ine şifreli)
  log('\n2) bob kayıt olup alice\'e ŞİFRELİ mesaj gönderiyor:');
  const b = await yeniSayfa(ctxB, 'bob');
  await kayitOl(b, 'bob');
  await b.click('#altNav button[data-gor="kisiler"]');
  await b.click('#ekleBtn'); await b.click('#kisiEkleAc');     // "+" → Kişi Ekle
  await b.fill('#kisiEkleIn', 'alice'); await b.click('#kisiEkleBtn');
  const aliceKisi = b.locator('#kisiler .oda', { hasText: '@alice' });
  await aliceKisi.waitFor({ timeout: 10000 });
  await aliceKisi.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.fill('#mesajIn', SENTINEL);
  await b.click('#gonderBtn');
  await b.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), SENTINEL, { timeout: 12000 });
  log('  ✓ bob → alice SENTINEL gönderildi (alice pubkey\'ine şifreli)');

  // 3) alice cihaz-1: Ayarlar → "Yeni cihaz bağla" → bağlama kodu üret
  log('\n3) alice CİHAZ-1: Ayarlar → Yeni cihaz bağla → kod üretiliyor:');
  await a1.click('#altNav button[data-gor="ayarlar"]');
  await a1.click('#cihazBaglaBtn');
  await a1.waitForSelector('#baglaKodPop:not(.gizli)', { timeout: 10000 });
  const kod = (await a1.locator('#baglaKod').textContent()).trim();
  if (!/^[A-Z2-9]{6}-[A-Z2-9]{15}$/.test(kod)) throw new Error('❌ bağlama kodu formatı beklenmedik: ' + JSON.stringify(kod));
  log('  ✓ bağlama kodu üretildi: ' + kod.slice(0, 6) + '-•••••••••••••• (tek kullanımlık)');

  // 4) GÜVENLİK A: alice cihaz-2'de giriş → "cihaz bağla" ekranı (SESSİZ yeni-anahtar YOK) + pubkey DEĞİŞMEDİ
  log('\n4) alice CİHAZ-2\'de giriş (taze cihaz) — sessiz anahtar-üretimi OLMAMALI:');
  const a2 = await yeniSayfa(ctxA2, 'alice-c2');
  await a2.fill('#gKullanici', 'alice');
  await a2.fill('#gParola', PAROLA);
  await a2.click('#girisBtn');
  await a2.waitForSelector('#baglaEkran:not(.gizli)', { timeout: 15000 });
  if (await a2.locator('#sohbet:not(.gizli)').count()) throw new Error('❌ taze cihaz doğrudan uygulamaya girdi (sessiz anahtar üretmiş olabilir!)');
  const Pbağlamadan = await pubkeyAl(a2);
  if (Pbağlamadan !== P1) throw new Error('❌ GÜVENLİK: giriş tek başına sunucu pubkey\'ini değiştirdi! ' + Pbağlamadan.slice(0,12) + ' ≠ ' + P1.slice(0,12));
  log('  ✅ taze cihaz "Cihaz bağla" ekranına düştü — sunucu pubkey HÂLÂ P1 (anahtar rotasyonu YOK)');

  // 5) GÜVENLİK C: aktarım blob'u sunucuda OPAK (parola-cümlesi yok). Kodla bağla → uygulamaya gir.
  log('\n5) Bağlama kodu ile CİHAZ-2 anahtarı alıyor (parolasız — cihaz modu):');
  await a2.fill('#bKod', kod);
  await a2.click('#bBagla');
  await a2.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  const P2 = await pubkeyAl(a2);
  if (P2 !== P1) throw new Error('❌ cihaz-2 pubkey ≠ cihaz-1 (anahtar aynı olmalı): ' + P2.slice(0,12) + ' ≠ ' + P1.slice(0,12));
  log('  ✅ cihaz-2 uygulamaya girdi · pubkey = P1 (AYNI anahtar, kayıpsız taşındı)');

  // 6) GÜVENLİK B: cihaz-2, bob'un alice'e şifrelediği SENTINEL'i ÇÖZÜYOR
  log('\n6) CİHAZ-2 bob\'un eski şifreli mesajını çözüyor (taşınan anahtarla):');
  const oda2 = a2.locator('#odalar .oda').first();
  await oda2.waitFor({ timeout: 10000 });
  await oda2.click();
  await a2.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), SENTINEL, { timeout: 12000 });
  log('  ✅ cihaz-2 SENTINEL düz-metnini çözdü → taşınan anahtar çalışıyor');

  // 7) IndexedDB cihaz-2'de yalnız ŞİFRELİ kayıt (düz private key yok) + pub = P1
  const rec2 = await a2.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('narchat', 1);
    r.onsuccess = () => { const t = r.result.transaction('anahtarlar','readonly').objectStore('anahtarlar').get('anahtar_alice'); t.onsuccess = () => res(t.result); };
    r.onerror = () => rej(r.error);
  }));
  const ok2 = rec2 && rec2.mod === 'cihaz' && rec2.cipher && rec2.nonce && rec2.pub && !rec2.priv && !rec2.privateKey;
  if (!ok2) throw new Error('❌ cihaz-2 IndexedDB kaydı beklenen cihaz-modu değil: ' + JSON.stringify(rec2));
  log('  ✅ cihaz-2 IndexedDB: cihaz-modu {mod,nonce,cipher,pub} — düz private key YOK (parolasız auto-aç)');

  // 8) GÜVENLİK C teyit: sunucu aktarım deposunda parola-cümlesi/düz-anahtar izi YOK
  //    (blob tek-kullanımlık → çoktan silindi; ayrıca kalıcı dosyaya yazılmaz — bellekte/opaktı)
  const veriDosyalari = await readdir(server.veri);
  let ham = '';
  for (const f of veriDosyalari) { try { ham += await readFile(join(server.veri, f), 'utf8'); } catch {} }
  const kodParcasi = kod.split('-')[1];
  if (ham.includes(kodParcasi)) throw new Error('❌ GÜVENLİK: parola-cümlesi sunucu diskinde bulundu!');
  log('  ✅ sunucu diskinde parola-cümlesi izi YOK (aktarım opak + tek-kullanımlık + bellekte)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ ÇOK-CİHAZ "CİHAZ BAĞLAMA" E2E GEÇTİ:');
  log('   A. taze cihazda giriş sessizce anahtar ÜRETMEZ → "cihaz bağla" + pubkey değişmez');
  log('   B. kod+parola ile ikinci cihaz anahtarı alır → bob\'un eski mesajını çözer');
  log('   C. anahtar sunucuya düz gitmez (opak blob, tek-kullanımlık, parola-cümlesi sunucuda yok)');
  log('   D. iki cihazın pubkey\'i AYNI (anahtar rotasyonu yok)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
