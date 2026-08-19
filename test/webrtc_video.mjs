// NarChat — Faz 2 WebRTC GÖRÜNTÜLÜ arama kanıtı (izole, 2 tarayıcı).
// İki ayrı bağlam (alice/bob) ortak 1:1 odaya girer → alice GÖRÜNTÜLÜ arama başlatır (video butonu) →
// offer'da video:true taşınır → bob'a "Görüntülü arama…" GELEN ekranı düşer → bob CEVAPLAR (simetrik kamera) →
// iki RTCPeerConnection localhost ICE ile bağlanır → KARŞILIKLI VIDEO track akar (<video> sink) + datachannel.
// Canlıya DOKUNMAZ (izole port + mktemp veri; arama butonları zaten canlıda gizli). Çalıştır: node test/webrtc_video.mjs (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8151, BASE = `http://127.0.0.1:${PORT}`;   // 8110 artık canlı landing-sunucusunun (24 Tem) — çakışmasın
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-video-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, kullanici){
  const page = await ctx.newPage();
  await page.goto(BASE+'/'); await uygulamaHazir(page);
  await page.fill('#gKullanici', kullanici); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam'); await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  return page;
}
async function odayaGir(page){
  await page.reload(); await uygulamaHazir(page);
  if (await page.locator('#kilitEkran:not(.gizli)').count()){ await page.fill('#kParola', PAROLA); await page.click('#kAc'); }
  await page.waitForSelector('#sohbet:not(.gizli)');
}

let server;
async function main(){
  log('📹 NarChat Faz 2 — WebRTC GÖRÜNTÜLÜ arama (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  // görüntülü arama için kamera İZNİ de gerekli (mic + camera)
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone','camera'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone','camera'] }), 'bob');
  log('  ✓ alice + bob kayıt (mic+kamera izni)');

  // alice'in kişi listesi bob'u görsün
  await odayaGir(A);
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  // bob odayı açsın (SSE + aramaInit hazır)
  await odayaGir(B);
  await B.locator('#odalar .oda').first().click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ iki taraf da ortak odada (SSE bağlı)');

  // arama butonları canlıda gizli (Faz 2 kapalı) — izole testte video butonunu aç
  await A.evaluate(()=>document.getElementById('aramaVideoBtn').classList.remove('gizli'));

  const bekleDurum = (page, d) => page.waitForFunction(x => window.__ARAMA_DURUM === x, d, {timeout:20000});
  const bekleMsg = async (page) => {
    await page.waitForFunction(()=>typeof window.__ARAMA_SON_MESAJ==='string' && window.__ARAMA_SON_MESAJ.startsWith('merhaba:'), null, {timeout:20000});
    return page.evaluate(()=>window.__ARAMA_SON_MESAJ);
  };
  // <video id=uzakVideo>'da gerçek video track var mı (srcObject + getVideoTracks)
  const uzakVideoTrackVar = (page) => page.evaluate(()=>{
    const v = document.getElementById('uzakVideo');
    const s = v && v.srcObject;
    return !!(s && typeof s.getVideoTracks === 'function' && s.getVideoTracks().length > 0);
  });

  // ── SENARYO: alice GÖRÜNTÜLÜ arar → bob CEVAPLIYOR → karşılıklı VIDEO + datachannel ──
  log('\n  [1] alice GÖRÜNTÜLÜ arıyor → bob CEVAPLIYOR → P2P video+ses+datachannel:');
  await A.click('#aramaVideoBtn');

  // bob'a GELEN ekranı + "Görüntülü arama…" etiketi
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  const arayanAd = (await B.locator('#gelenAd').textContent()).trim();
  if (arayanAd !== '@alice') throw new Error('❌ bob yanlış arayan gördü: '+arayanAd);
  const gelenAlt = (await B.locator('#gelenAlt').textContent()).trim();
  if (!gelenAlt.includes('Görüntülü')) throw new Error('❌ bob "Görüntülü arama" etiketi görmedi: '+gelenAlt);
  log('  ✓ bob GELEN görüntülü-arama ekranı: '+arayanAd+' · "'+gelenAlt+'"');
  await B.click('#aramaCevaplaBtn', {force:true});

  // datachannel "merhaba" iki yönde (P2P bağlandı)
  const aMsg = await bekleMsg(A), bMsg = await bekleMsg(B);
  if (aMsg !== 'merhaba:bob')   throw new Error('❌ alice yanlış datachannel mesajı: '+aMsg);
  if (bMsg !== 'merhaba:alice') throw new Error('❌ bob yanlış datachannel mesajı: '+bMsg);
  log('  ✅ datachannel KARŞILIKLI: alice←"'+aMsg+'" · bob←"'+bMsg+'"');

  // karşı tarafın VIDEO track'i iki yönde alındı + <video> sink'ine bağlandı mı?
  await A.waitForFunction(()=>window.__ARAMA_UZAK_VIDEO===true, null, {timeout:20000});
  await B.waitForFunction(()=>window.__ARAMA_UZAK_VIDEO===true, null, {timeout:20000});
  if (!(await uzakVideoTrackVar(A))) throw new Error('❌ alice <video id=uzakVideo> video track yok');
  if (!(await uzakVideoTrackVar(B))) throw new Error('❌ bob <video id=uzakVideo> video track yok');
  log('  ✅ karşı VIDEO track iki yönde alındı + <video> sink\'ine bağlandı (alice+bob)');

  // kendi kameramız da gönderildi mi (yerel video track)?
  const aYerel = await A.evaluate(()=>window.__ARAMA_YEREL_VIDEO===true);
  const bYerel = await B.evaluate(()=>window.__ARAMA_YEREL_VIDEO===true);
  if (!aYerel || !bYerel) throw new Error('❌ yerel kamera gönderilmedi: alice='+aYerel+' bob='+bYerel);
  log('  ✅ iki taraf da kendi kamerasını gönderdi (simetrik görüntülü)');

  // görüntülü sahne iki tarafta da açık (gizli değil)
  const aSahne = await A.evaluate(()=>!document.getElementById('videoSahne').classList.contains('gizli'));
  const bSahne = await B.evaluate(()=>!document.getElementById('videoSahne').classList.contains('gizli'));
  if (!aSahne || !bSahne) throw new Error('❌ video sahnesi açılmadı: alice='+aSahne+' bob='+bSahne);
  log('  ✅ görüntülü arama sahnesi iki tarafta açık (uzak tam-ekran + yerel PiP)');

  // ses track'i de iki yönde (görüntülüde ses yine <audio>'dan)
  await A.waitForFunction(()=>window.__ARAMA_UZAK_TRACK===true, null, {timeout:20000});
  await B.waitForFunction(()=>window.__ARAMA_UZAK_TRACK===true, null, {timeout:20000});
  await bekleDurum(A,'konusuyor'); await bekleDurum(B,'konusuyor');
  log('  ✅ iki taraf da "konusuyor" (ses+video)');

  // alice video-kapat → ikisi de "bos" + sahne kapanır
  await A.click('#videoKapatBtn');
  await bekleDurum(A,'bos'); await bekleDurum(B,'bos');
  const aKapand = await A.evaluate(()=>document.getElementById('videoSahne').classList.contains('gizli'));
  const bKapand = await B.evaluate(()=>document.getElementById('videoSahne').classList.contains('gizli'));
  if (!aKapand || !bKapand) throw new Error('❌ video sahnesi kapanmadı: alice-gizli='+aKapand+' bob-gizli='+bKapand);
  log('  ✅ alice kapattı → iki taraf "bos", sahne kapandı (bitir sinyali)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ 2 GÖRÜNTÜLÜ ARAMA GEÇTİ (izole):');
  log('   • görüntülü arama: offer.video=true opak relay (sunucu SDP/medyayı yorumlamaz)');
  log('   • GELEN ekran "Görüntülü arama…" etiketi + simetrik kamera kabulü');
  log('   • karşı VIDEO track iki yönde <video> sink\'ine bağlandı');
  log('   • iki taraf kendi kamerasını gönderdi (P2P, localhost ICE)');
  log('   • ses+datachannel yine çalışıyor (görüntülüde ses <audio>\'dan)');
  log('   • bitir → sahne kapanır, oturum temiz; canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
