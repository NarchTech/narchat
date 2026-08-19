// NarChat — Tarayıcı E2E (Playwright, GERÇEK app.js'i headful sürer)
// Faz-1 / Adım 1 kanıtı: UI akışı + libsodium E2E tarayıcıda uçtan-uca çalışıyor mu?
//
// Akış:
//   1) Kendi sunucusunu izole NARCHAT_VERI + :8102 ile başlatır (gerçek veriye dokunmaz).
//   2) İki AYRI tarayıcı bağlamı (= iki ayrı cihaz/localStorage): alice + bob → gerçek UI'dan kayıt.
//   3) alice bob ile 1:1 oda açar; bob odayı dinler (canlı SSE).
//   4) alice UI'dan SENTINEL mesaj gönderir → bob'un EKRANINDA düz-metin çözülür (canlı).
//   5) Sunucu deposu (jsonl) açılır: SENTINEL düz-metin BULUNMAMALI (yalnız ciphertext).
//   6) Üye-olmayan carol /api/mesajlar'a vurur → 403.
//
// Çalıştır:  node test/browser_e2e.mjs        (headful, izlenebilir)
//            HEADLESS=1 node test/browser_e2e.mjs   (CI/sessiz)

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));   // .../NarChat
const PORT = 8139;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const SENTINEL = 'BULUSMA_SAAT_3_COK_GIZLI_' + PORT;  // sunucuya ASLA düz gitmemeli
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- sunucuyu izole veri diziniyle başlat ---
async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-e2e-'));
  const p = spawn('python3', [join(KOK, 'mesaj_server.py')], {
    env: { ...process.env, NARCHAT_PORT: String(PORT), NARCHAT_VERI: veri },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  // hazır olana kadar bekle
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/ben'); if (r.status === 401 || r.ok) break; } catch {}
    await sleep(100);
  }
  return { proc: p, veri };
}

// app.js modülü (esm.sh'den libsodium) yüklenip olay-dinleyicileri bağlanana kadar bekle
async function uygulamaHazir(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('kayitBtn');
    return !!b && typeof b.onclick === 'function';
  }, null, { timeout: 25000 });
}

// reload sonrası kilit ekranı çıkarsa parolayla aç; sonra sohbete geç
async function kilidiAc(page, parola) {
  await page.waitForSelector('#kilitEkran:not(.gizli), #sohbet:not(.gizli)', { timeout: 20000 });
  if (await page.locator('#kilitEkran:not(.gizli)').count()) {
    await page.fill('#kParola', parola);
    await page.click('#kAc');
  }
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}

async function kayitOl(ctx, kullanici) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${kullanici} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/');
  await uygulamaHazir(page);
  await page.fill('#gKullanici', kullanici);
  await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });  // sohbet ekranı = keypair üretildi (Argon2id sarmalı) + pubkey yüklendi
  log(`  ✓ @${kullanici} kayıt oldu + cihaz anahtarı üretti (pubkey sunucuya yüklendi)`);
  return page;
}

let server;
async function main() {
  log('🌐 NarChat tarayıcı E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL — izle') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({
    channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 180,
    args: ['--window-size=420,900'],
  });

  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, permissions: ['notifications'] });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, permissions: ['notifications'] });
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, permissions: ['notifications'] });

  log('1) İki ayrı cihaz (bağlam) gerçek UI\'dan kayıt oluyor:');
  const pageA = await kayitOl(ctxA, 'alice');
  const pageB = await kayitOl(ctxB, 'bob');

  // alice'in kişi listesi bob kaydolmadan dolmuştu → tazele (reload → oturum çerezi kalıcı)
  log('\n2) alice listeyi tazeliyor → bob görünüyor → 1:1 oda açıyor:');
  await pageA.reload();
  await uygulamaHazir(pageA);
  await kilidiAc(pageA, PAROLA);   // reload → kilit ekranı → parolayla aç (IndexedDB'den çöz)
  log('  ✓ alice reload sonrası parolayla kilidi açtı (anahtar IndexedDB\'den çözüldü)');
  await pageA.click('#altNav button[data-gor="kisiler"]');   // mobil alt-nav: Kişiler sekmesine geç
  // yeni model: kişi listesi yalnız EKLENENLER → önce bob'u kullanıcı adıyla ekle ("+" → Kişi Ekle)
  await pageA.click('#ekleBtn');
  await pageA.click('#kisiEkleAc');
  await pageA.fill('#kisiEkleIn', 'bob');
  await pageA.click('#kisiEkleBtn');
  const bobKisi = pageA.locator('#kisiler .oda', { hasText: '@bob' });
  await bobKisi.waitFor({ timeout: 10000 });
  await bobKisi.click();                              // ikiliBaslat('bob') → oda kur → odaAc
  log('  ✓ alice "Kişi Ekle" ile @bob ekledi → kişi listesinde göründü');
  await pageA.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice→bob 1:1 oda açık (alice mesaj kutusu aktif)');

  // bob odayı açıp CANLI dinlesin (SSE)
  log('\n3) bob odayı açıp canlı dinliyor (SSE):');
  await pageB.reload();
  await uygulamaHazir(pageB);
  await kilidiAc(pageB, PAROLA);   // reload → kilit ekranı → parolayla aç
  const bobOda = pageB.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 10000 });
  await bobOda.click();
  await pageB.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ bob oda akışını dinliyor');

  // alice gönderir → bob'un EKRANINDA çözülür
  log('\n4) alice şifreli mesaj gönderiyor → bob\'un ekranında çözülmesi bekleniyor:');
  log(`     SENTINEL düz-metin: "${SENTINEL}"`);
  await pageA.fill('#mesajIn', SENTINEL);
  await pageA.click('#gonderBtn');
  await pageB.waitForFunction(
    (s) => document.getElementById('akis')?.textContent.includes(s),
    SENTINEL, { timeout: 15000 });
  log('  ✅ bob\'un GERÇEK arayüzünde düz-metin çözüldü (canlı SSE üzerinden)');
  // alice kendi ekranında da görüyor mu (kendi mesajı)
  await pageA.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), SENTINEL, { timeout: 8000 });
  log('  ✓ alice de kendi gönderdiğini görüyor');

  // 4b) Adım 4 — sıcak-modern UI öğeleri: zaman damgası · avatar · okundu (✓✓)
  log('\n4b) Adım 4 UI: zaman damgası + avatar + okundu makbuzu:');
  const zaman = await pageB.locator('#akis .msg .meta').first().textContent();
  if (!/\d{1,2}:\d{2}/.test(zaman || '')) throw new Error('❌ baloncukta HH:MM zaman damgası yok: ' + JSON.stringify(zaman));
  log('  ✅ zaman damgası baloncukta: "' + zaman.trim() + '"');
  const avSay = await pageB.locator('.avatar').count();
  if (avSay < 1) throw new Error('❌ hiç avatar render edilmedi');
  log('  ✅ avatar render edildi (' + avSay + ' adet)');
  // bob mesajı gördü → otomatik /api/okundu → alice tarafında ✓✓ (okundu) belirir
  await pageA.waitForSelector('.msg.ben .tik.okundu', { timeout: 15000 });
  log('  ✅ okundu makbuzu: alice\'in mesajı ✓✓ (bob gördü → SSE okundu)');

  if (!HEADLESS) await sleep(1500);  // izlemek için kısa duraklama

  // 5) sunucu deposunda düz-metin var mı?
  log('\n5) Sunucu deposu (ciphertext olmalı, düz-metin OLMAMALI):');
  const msgDir = join(server.veri, 'mesajlar');
  const dosyalar = await readdir(msgDir);
  let hamHepsi = '';
  for (const f of dosyalar) hamHepsi += await readFile(join(msgDir, f), 'utf8');
  if (hamHepsi.includes(SENTINEL)) throw new Error('❌ GÜVENLİK İHLALİ: SENTINEL düz-metin sunucu deposunda BULUNDU!');
  log(`  ✅ ${dosyalar.length} oda dosyası tarandı — SENTINEL düz-metin YOK (sunucu yalnız ciphertext tutuyor)`);
  log('     örnek ham kayıt (ilk 220 karakter): ' + hamHepsi.replace(/\s+/g, ' ').slice(0, 220) + '…');

  // 6) üye-olmayan carol → 403
  log('\n6) Üye-olmayan erişim reddi:');
  const pageC = await kayitOl(ctxC, 'carol');
  // alice'in açtığı gizli odanın id'sini /api/odalar ile al (carol bunu kendi listesinde göremez)
  const odaId = await pageA.evaluate(async () => {
    const r = await fetch('/api/odalar', { credentials: 'same-origin' });
    const d = await r.json();
    return (d[0] && d[0].oda) || null;
  });
  const kod = await pageC.evaluate(async (oid) => {
    const r = await fetch('/api/mesajlar?oda=' + encodeURIComponent(oid) + '&since=0', { credentials: 'same-origin' });
    return r.status;
  }, odaId);
  if (kod !== 403) throw new Error(`❌ carol ${kod} aldı (403 beklendi) — üye-olmayan mesajları görebiliyor!`);
  log(`  ✅ carol (üye değil) → ${kod} (sunucu reddetti)`);

  // 7) Anahtar saklama — varsayılan CİHAZ modu (açılışta parola YOK) + OPSİYONEL uygulama kilidi
  log('\n7) Açılışta parola yok (cihaz modu) + opsiyonel uygulama kilidi:');
  await pageA.reload();
  await uygulamaHazir(pageA);
  // 7a) reload → kilit ekranı GELMEMELİ, doğrudan sohbet (parolasız auto-aç)
  await pageA.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  if (await pageA.locator('#kilitEkran:not(.gizli)').count()) throw new Error('❌ varsayılan modda açılışta parola soruldu (kilit ekranı çıktı)');
  log('  ✅ reload → parolasız doğrudan sohbete girildi (cihaz modu — her-açılış parola yok)');
  // 7b) IndexedDB: cihaz-modu kayıt + düz private key YOK
  const recA = await pageA.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('narchat', 1);
    r.onsuccess = () => { const t = r.result.transaction('anahtarlar', 'readonly').objectStore('anahtarlar').get('anahtar_alice'); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); };
    r.onerror = () => rej(r.error);
  }));
  if (!(recA && recA.mod === 'cihaz' && recA.cipher && recA.nonce && recA.pub && !recA.priv && !recA.privateKey)) throw new Error('❌ IndexedDB cihaz-modu değil: ' + JSON.stringify(recA));
  log('  ✅ IndexedDB cihaz-modu {mod,nonce,cipher,pub} — düz private key YOK');
  const sizinti = await pageA.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('narchat_priv_')));
  if (sizinti.length) throw new Error('❌ localStorage düz-key sızıntısı: ' + sizinti);
  log('  ✅ localStorage\'da düz private key yok');
  // 7c) OPSİYONEL uygulama kilidi: Ayarlar'dan aç → reload → kilit ekranı → yanlış/doğru parola
  await pageA.click('#altNav button[data-gor="ayarlar"]');
  await pageA.click('#kilitToggleBtn');                       // "Aç" → parola belirleme paneli
  await pageA.fill('#kilitParolaIn', PAROLA);
  await pageA.click('#kilitKaydetBtn');
  await pageA.waitForFunction(() => document.getElementById('kilitDurum')?.textContent.includes('Açık'), null, { timeout: 8000 });
  log('  ✅ Ayarlar → uygulama kilidi AÇILDI (parola modu)');
  await pageA.reload();
  await uygulamaHazir(pageA);
  await pageA.waitForSelector('#kilitEkran:not(.gizli)', { timeout: 20000 });   // artık kilitli açılır
  log('  ✅ kilit açıkken reload → kilit ekranı geldi (açılışta parola istendi)');
  await pageA.fill('#kParola', 'YANLIS-parola-123');
  await pageA.click('#kAc');
  await pageA.waitForFunction(() => document.getElementById('kHata').textContent.includes('hatalı'), null, { timeout: 10000 });
  if (!(await pageA.locator('#sohbet.gizli').count())) throw new Error('❌ yanlış parolayla kilit açıldı!');
  log('  ✅ yanlış parola reddedildi (kilitli kaldı)');
  await pageA.fill('#kParola', PAROLA);
  await pageA.click('#kAc');
  await pageA.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ doğru parola kilidi açtı (sohbete girildi)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ TARAYICI E2E TAM-AKIŞ GEÇTİ — gerçek app.js, gerçek UI:');
  log('   1. iki cihaz UI\'dan kayıt + cihazda keypair (IndexedDB, Argon2id sarmalı)');
  log('   2. reload → cihaz modu: parolasız doğrudan sohbet (anahtar diskte cihaz-sarmalı)');
  log('   3. 1:1 oda + canlı SSE → bob\'un EKRANINDA çözüldü');
  log('   4. sunucu deposunda düz-metin YOK (yalnız ciphertext)');
  log('   5. üye-olmayan carol → 403');
  log('   6. açılışta parola YOK (varsayılan) + opsiyonel uygulama kilidi açılınca parola istenir/yanlış reddedilir · IndexedDB\'de düz key yok');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
