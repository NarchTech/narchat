// NarChat — Android WebView kamera-çevirme bug'ı (24-Tem native APK): facingMode { exact } fallback zinciri.
// SORUN: `facingMode: { ideal }` Android WebView'de ZAYIF kısıt — telefon ön+arka kamerayı aynı anda
//   açamayınca getUserMedia hata vermez, sessizce MEVCUT (ön) kamerayı döndürür → "çevir" butonu çalışmaz.
//   iOS eşzamanlı akışı yönettiği için iPhone-PWA'da sorun görülmez (kullanıcı bunu doğruladı).
// ÇÖZÜM (arama.js/kameraTrackAl + grup-arama.js/_grupKameraTrackAl): 4 katman —
//   (1) { exact } zorla · (2) exact eşzamanlı açılamazsa eski kamerayı bırak+exact tekrar · (3) { ideal } · (4) geri-yükle.
// Bu test getUserMedia'yı Android-tuzağı simülatörüyle değiştirir (gerçek donanım/fake-device GEREKMEZ);
//   canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: HEADLESS=1 node test/kamera_cevir_facing.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8131, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kamcevir-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}

let server;
async function main(){
  log('🔄 NarChat — Android kamera-çevirme facingMode fallback (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE+'/');
  // arama.js modülünü yükle → kameraTrackAl'ı window'a bağla (top-level ağ çağrısı yok, güvenli)
  await page.addScriptTag({ type:'module', content:
    `import { kameraTrackAl } from '/arama.js?v=11'; window.__kameraTrackAl = kameraTrackAl;` });
  await page.waitForFunction(()=>typeof window.__kameraTrackAl === 'function', null, {timeout:10000});
  log('  ✓ kameraTrackAl yüklendi');

  // Android-tuzağı simülatörü: getUserMedia'yı senaryoya göre değiştirir; çağrıları kaydeder.
  // Dönen "track" _facing etiketiyle GERÇEKTEN hangi kameranın geldiğini taşır (eski kod 'user' verirdi).
  const senaryoKur = async (kip) => page.evaluate((kip)=>{
    window.__cagrilar = [];
    let exactSay = 0;
    const track = (facing) => ({ kind:'video', enabled:true, _facing:facing, stop(){ this._stopped=true; } });
    const akis = (facing) => ({ getVideoTracks:()=>[track(facing)], getTracks(){ return this.getVideoTracks(); } });
    const eskiStop = { calls:0 };
    window.__eskiMedya = { getVideoTracks:()=>[{ stop(){ eskiStop.calls++; window.__eskiStopCalls = eskiStop.calls; } }] };
    if (!navigator.mediaDevices) navigator.mediaDevices = {};
    navigator.mediaDevices.getUserMedia = async (c) => {
      const fm = (c && c.video && c.video.facingMode) || {};
      const exact = fm.exact, ideal = fm.ideal;
      window.__cagrilar.push(exact ? {exact} : {ideal});
      if (kip === 'ideal-tuzagi') {
        // Android tuzağı: ideal her zaman ön kamerada kalır; exact hedefi gerçekten verir.
        if (exact) return akis(exact);
        return akis('user');
      }
      if (kip === 'donanim-mesgul') {
        // İlk exact (kamera açıkken) donanım-meşgul → throw; eski kamera bırakılınca exact başarılı.
        if (exact) { exactSay++; if (exactSay === 1) throw new DOMException('busy','NotReadableError'); return akis(exact); }
        return akis('user');
      }
      if (kip === 'arka-yok') {
        // Arka kamera yok: her environment isteği (exact+ideal) throw; yalnız user açılır (geri-yükleme).
        if ((exact||ideal) === 'environment') throw new DOMException('yok','OverconstrainedError');
        return akis('user');
      }
    };
    return true;
  }, kip);

  const cevir = () => page.evaluate(()=> window.__kameraTrackAl('environment','user',false,window.__eskiMedya));

  // [1] Android ideal-tuzağı: exact ilk denemede hedefi verir → GERÇEK arka kamera gelir
  await senaryoKur('ideal-tuzagi');
  let r = await cevir();
  let c = await page.evaluate(()=>window.__cagrilar);
  if (!r) carp('[1] track null döndü');
  if (r.yuz !== 'environment') carp('[1] yuz environment değil: '+r.yuz);
  if (r.track._facing !== 'environment') carp('[1] GERÇEK kamera arka değil (Android ideal-tuzağı): '+r.track._facing+' — ideal kullanılıyor olabilir');
  if (!c.length || !c[0].exact) carp('[1] ilk çağrı exact değil: '+JSON.stringify(c[0]));
  log('  ✅ [1] ideal-tuzağı: ilk çağrı { exact } + gerçek kamera=environment (Android bug\'ı kapandı)');

  // [2] donanım-meşgul: ilk exact throw → eski kamera bırakılır → exact tekrar başarılı
  await senaryoKur('donanim-mesgul');
  r = await cevir();
  c = await page.evaluate(()=>window.__cagrilar);
  const eskiStopCalls = await page.evaluate(()=>window.__eskiStopCalls||0);
  if (!r || r.yuz !== 'environment') carp('[2] meşgul sonrası environment\'a geçilemedi: '+(r&&r.yuz));
  if (r.track._facing !== 'environment') carp('[2] gerçek kamera arka değil: '+r.track._facing);
  if (eskiStopCalls < 1) carp('[2] eski kamera serbest bırakılmadı (donanım-meşgul yolu çalışmadı)');
  if (c.filter(x=>x.exact).length < 2) carp('[2] exact ikinci kez denenmedi: '+JSON.stringify(c));
  log('  ✅ [2] donanım-meşgul: eski kamera bırakıldı → exact tekrar → arka kamera (2. katman)');

  // [3] arka-yok: tüm environment throw → user geri-yüklenir; kullanıcı KAMERASIZ KALMAZ, yüz değişmez
  await senaryoKur('arka-yok');
  r = await cevir();
  if (!r) carp('[3] geri-yükleme başarısız — kullanıcı kamerasız kaldı (KABUL EDİLEMEZ)');
  if (r.yuz !== 'user') carp('[3] arka yokken yüz environment sanıldı (UI yanılır): '+r.yuz);
  if (r.track._facing !== 'user') carp('[3] geri-yüklenen kamera ön değil: '+r.track._facing);
  log('  ✅ [3] arka-yok: ön kameraya geri-yükleme, yüz=user (UI yanılmaz, kamera kaybolmaz — 4. katman)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ KAMERA-ÇEVİRME facingMode GEÇTİ (izole):');
  log('   • { exact } ile hedef kamera ZORLANIYOR (Android ideal-tuzağı kapandı)');
  log('   • donanım eşzamanlı-açamazsa eski kamerayı bırakıp tekrar dener');
  log('   • hiçbiri olmazsa eski kameraya geri döner (kamerasız kalmaz) + yüz doğru raporlanır');
  log('   • canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc?.kill('SIGKILL'); process.exit(1); });
