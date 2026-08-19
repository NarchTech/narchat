// NarChat — FAZ N3: bundled Capacitor "farklı-origin" taklidi (Playwright).
// Gerçek native WebView'ı (Capacitor bridge + sabit https://localhost origin, port yok) Playwright'ta
// BİREBİR taklit edemeyiz (gerçek Chromium; https://localhost'u port'suz taklit etmek 443'e bind + sertifika
// ister) — bu yüzden dürüst bir yaklaşım: SAHTE Origin göndermek yerine, sunucunun bu testin GERÇEK
// app-origin'ini (APP_BASE) YALNIZ test-env değişkeniyle (NARCHAT_CORS_TEST_ORIGIN) allowlist'ine almasını
// sağlıyoruz — canlıda bu env HİÇ set edilmez, gerçek allowlist sabit kalır. Böylece:
//   1) window.Capacitor sahte enjekte edilir (isNativePlatform()=true) → app.js'in API_KOK'u
//      gerçek koddaki gibi 'https://narchat.narchviz.com' döner (kok.js'e hiç dokunulmaz).
//   2) O sabit prod URL'ye giden istekler page.route ile YAKALANIR → yerel izole API sunucusuna proxy'lenir
//      (protokol https→http değişimi route.continue'da yasak olduğu için gerçek fetch+fulfill kullanılır);
//      Origin başlığına DOKUNULMAZ — tarayıcının GERÇEKTEN gönderdiği origin sunucuya öyle gider.
//   3) Uygulama dosyaları (app.js/index.html) AYRI bir origin'den (farklı port) servis edilir —
//      gerçek bundled senaryodaki gibi app ve API FARKLI origin'lerde.
// Doğrular: tarayıcının KENDİ CORS denetimi (sahte değil, gerçek) + credentialed cookie (SameSite=None)
// ile cross-origin kayıt+giriş+mesaj tam çalışır. cors_test.py ise tam allowlist string'lerini (https://
// localhost / capacitor://localhost) + preflight'ı raw HTTP ile ayrıca doğruluyor.
//
// Çalıştır:  HEADLESS=1 node test/bundled_smoke.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const API_PORT = 8145;         // "gerçek sunucu" (izole)
const APP_PORT = 8146;         // "bundled app origin" (statik dosyalar farklı port'tan)
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const PROD_URL = 'https://chat.narchtech.com';   // kok.js'teki HARDCODED native API_KOK (24 Tem domain göçü)
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let apiProc, appProc;
async function sunucularBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-bundled-'));
  apiProc = spawn('python3', [join(KOK,'mesaj_server.py')],
    // YALNIZ TEST: NARCHAT_CORS_TEST_ORIGIN, sunucunun SABİT allowlist'ine bu testin GERÇEK app-origin'ini
    // (APP_BASE) ekler — canlıda bu env HİÇ set edilmez (mesaj_server.py'deki uyarı yorumuna bkz).
    // Böylece tarayıcının kendi CORS denetimi SAHTE değil, GERÇEKTEN eşleşen bir origin'e karşı çalışır.
    // D1/L3: test-kancası artık NARCHAT_TEST_HOOKS=1 gerektiriyor (env prod'a sızsa bile inert kalsın diye).
    { env:{...process.env, NARCHAT_PORT:String(API_PORT), NARCHAT_VERI:veri, NARCHAT_CORS_TEST_ORIGIN:APP_BASE, NARCHAT_TEST_HOOKS:'1'}, stdio:['ignore','pipe','pipe'] });
  apiProc.stderr.on('data', d => process.stderr.write('[api] ' + d));
  appProc = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '--directory', join(KOK,'static')],
    { stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(API_BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  for (let i=0;i<50;i++){ try{ const r=await fetch(APP_BASE+'/index.html'); if(r.ok) break; }catch{} await sleep(100); }
}

// app.js'in sabit-kodlu native API_KOK'unu (PROD_URL, https) yerel izole API sunucusuna (http) yönlendir.
// route.continue({url}) protokol değişikliğine (https→http) izin vermediği için gerçek bir proxy-fetch +
// fulfill kullanılır. Origin başlığı DOKUNULMADAN (tarayıcının gerçekten gönderdiği APP_BASE) sunucuya iletilir —
// sahte değil: sunucu bu origin'i NARCHAT_CORS_TEST_ORIGIN ile allowlist'ine aldığı için tarayıcının kendi
// CORS denetimi GERÇEKTEN geçer. /api/akis (SSE) akış-tabanlı olduğu için fulfill ile yeniden üretilemez →
// abort edilir (EventSource sessizce yeniden dener; cors_test.py SSE'nin CORS başlıklarını ayrıca doğruluyor).
async function nativeYonlendirmeKur(ctx){
  await ctx.route(PROD_URL + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/api/akis') return route.abort();
    const headers = await req.allHeaders();
    delete headers['host'];
    const govde = req.postDataBuffer();
    let resp;
    try {
      resp = await fetch(API_BASE + u.pathname + u.search, { method: req.method(), headers, body: govde || undefined });
    } catch (e) { console.error('[proxy-hata]', u.pathname, e); return route.abort(); }
    const buf = Buffer.from(await resp.arrayBuffer());
    const outHeaders = {};
    resp.headers.forEach((v, k) => { if (!['content-encoding','transfer-encoding','content-length'].includes(k.toLowerCase())) outHeaders[k] = v; });
    await route.fulfill({ status: resp.status, headers: outHeaders, body: buf });
  });
  await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }; });
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }

let browser;
async function main(){
  log('📦 NarChat "Bundled Capacitor — farklı-origin taklidi" (Playwright' + (HEADLESS?', headless':', HEADFUL') + ')\n');
  await sunucularBaslat();
  log(`  ✓ API sunucu :${API_PORT} (izole) — "gerçek sunucu" taklidi`);
  log(`  ✓ app statik sunucu :${APP_PORT} — "bundled webview origin" taklidi\n`);

  browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await nativeYonlendirmeKur(ctxA);
  await nativeYonlendirmeKur(ctxB);

  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  alice.on('pageerror', e => log('  [alice pageerror] ' + e));
  bob.on('pageerror', e => log('  [bob pageerror] ' + e));

  log('1) alice + bob, APP origin\'inden (' + APP_BASE + ') açıp API\'ye (' + PROD_URL + '→yerel) cross-origin kayıt olur:');
  await alice.goto(APP_BASE + '/'); await uygulamaHazir(alice);
  await alice.fill('#gKullanici', 'alice'); await alice.fill('#gParola', PAROLA); await alice.click('#kayitBtn'); await alice.click('#kayitOnayTamam');
  await alice.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ alice cross-origin kayıt oldu (sohbet ekranına girdi)');

  await bob.goto(APP_BASE + '/'); await uygulamaHazir(bob);
  await bob.fill('#gKullanici', 'bob'); await bob.fill('#gParola', PAROLA); await bob.click('#kayitBtn'); await bob.click('#kayitOnayTamam');
  await bob.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ bob cross-origin kayıt oldu');

  log('\n2) alice bob\'u ekler + 1:1 mesaj gönderir (cross-origin fetch+cookie):');
  await alice.click('#altNav button[data-gor="kisiler"]');
  await alice.click('#ekleBtn'); await alice.click('#kisiEkleAc');
  await alice.fill('#kisiEkleIn', 'bob'); await alice.click('#kisiEkleBtn');
  await alice.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await alice.waitForSelector('#mesajIn:not([disabled])');
  const MSG = 'CROSS_ORIGIN_MERHABA_' + APP_PORT;
  await alice.fill('#mesajIn', MSG); await alice.click('#gonderBtn');
  await alice.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), MSG, { timeout: 12000 });
  log('  ✅ alice gönderdi (kendi baloncuğunda görünüyor)');

  // /api/akis (SSE) bu testte abort edilir (fulfill akış-tabanlı endpoint'i taklit edemez — cors_test.py
  // SSE'nin CORS başlıklarını ayrıca doğruluyor) → bob reload ile GET /api/mesajlar üzerinden çeker.
  await bob.reload(); await uygulamaHazir(bob);
  const bobOda = bob.locator('#odalar .oda').first();
  await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await bob.waitForFunction((s) => document.getElementById('akis')?.textContent.includes(s), MSG, { timeout: 12000 });
  log('  ✅ bob mesajı çözüp gördü (cross-origin E2E akış + credentialed cookie sağlam)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ BUNDLED CAPACITOR (FARKLI-ORİGİN TAKLİDİ) GEÇTİ:');
  log('   • app farklı origin\'den servis edildi, API_KOK (native) ile gerçek sunucuya cross-origin gitti');
  log('   • kayıt + giriş + 1:1 mesaj cross-origin CORS preflight + credentialed cookie (SameSite=None) ile çalıştı');
  log('══════════════════════════════════════════');
}
main().then(()=>{ apiProc?.kill('SIGKILL'); appProc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); apiProc?.kill('SIGKILL'); appProc?.kill('SIGKILL'); process.exit(1); });
