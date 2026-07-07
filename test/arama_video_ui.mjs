// NarChat — FAZ H1: GÖRÜNTÜLÜ arama CANLI + sahne kontrolleri (izole, 2 tarayıcı).
// webrtc_video.mjs P2P video akışını kanıtladı; bu test H1'in CANLI + UI cilasını doğrular:
//   1) görüntülü buton 1:1 sohbette CANLI (manuel gizli-kaldırma YOK — odaAc gösterir; grupta gizli)
//   2) alice GÖRÜNTÜLÜ arar → bob "Görüntülü arama" görür → cevaplar → iki tarafta video sahnesi
//   3) MUTE toggle (track.enabled) · KAMERA aç/kapa (track.enabled) · ÖN/ARKA ÇEVİR (facingMode→replaceTrack)
//   4) bitir → iki taraf "bos", sahne kapanır
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: HEADLESS=1 node test/arama_video_ui.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8130, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-vidui-'));
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
  await page.click('#kayitBtn'); await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  return page;
}
async function odayaGir(page){
  await page.reload(); await uygulamaHazir(page);
  if (await page.locator('#kilitEkran:not(.gizli)').count()){ await page.fill('#kParola', PAROLA); await page.click('#kAc'); }
  await page.waitForSelector('#sohbet:not(.gizli)');
}
const gizliMi = (page, id) => page.evaluate(x => document.getElementById(x).classList.contains('gizli'), id);

let server;
async function main(){
  log('📹 NarChat FAZ H1 — Görüntülü arama CANLI + sahne kontrolleri (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone','camera'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone','camera'] }), 'bob');
  log('  ✓ alice + bob kayıt (mic+kamera izni)');

  await odayaGir(A);
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  await odayaGir(B);
  await B.locator('#odalar .oda').first().click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ iki taraf da ortak 1:1 odada (SSE bağlı)');

  // [1] görüntülü buton 1:1'de CANLI (manuel gizli-kaldırma YOK)
  log('\n  [1] Görüntülü buton 1:1\'de CANLI (otomatik görünür):');
  if (await gizliMi(A, 'aramaVideoBtn')) throw new Error('❌ aramaVideoBtn 1:1 sohbette GİZLİ (H1 açmalı)');
  if (await gizliMi(A, 'aramaBtn'))      throw new Error('❌ aramaBtn 1:1 sohbette gizli');
  log('  ✅ #aramaVideoBtn + #aramaBtn 1:1 sohbette görünür (canlı, manuel açma gerekmedi)');

  const bekleDurum = (page, d) => page.waitForFunction(x => window.__ARAMA_DURUM === x, d, {timeout:20000});
  const uzakVideoTrackVar = (page) => page.evaluate(()=>{
    const v = document.getElementById('uzakVideo'); const s = v && v.srcObject;
    return !!(s && typeof s.getVideoTracks === 'function' && s.getVideoTracks().length > 0);
  });

  // [2] alice GÖRÜNTÜLÜ arar → bob cevaplar → iki tarafta sahne açık
  log('\n  [2] alice GÖRÜNTÜLÜ arıyor → bob cevaplıyor → karşılıklı video sahnesi:');
  await A.click('#aramaVideoBtn');
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  const gelenAlt = (await B.locator('#gelenAlt').textContent()).trim();
  if (!gelenAlt.includes('Görüntülü')) throw new Error('❌ bob "Görüntülü arama" etiketi görmedi: '+gelenAlt);
  await B.click('#aramaCevaplaBtn', {force:true});
  await bekleDurum(A,'konusuyor'); await bekleDurum(B,'konusuyor');
  await A.waitForFunction(()=>window.__ARAMA_UZAK_VIDEO===true, null, {timeout:20000});
  await B.waitForFunction(()=>window.__ARAMA_UZAK_VIDEO===true, null, {timeout:20000});
  if (!(await uzakVideoTrackVar(A)) || !(await uzakVideoTrackVar(B))) throw new Error('❌ karşı video track <video> sink\'ine bağlanmadı');
  if (await gizliMi(A,'videoSahne') || await gizliMi(B,'videoSahne')) throw new Error('❌ görüntülü sahne açılmadı');
  log('  ✅ "konusuyor" + karşılıklı video track + sahne iki tarafta açık');

  // [3a] MUTE toggle (track.enabled)
  log('\n  [3] Sahne kontrolleri (alice):');
  await A.click('#videoMuteBtn');
  await A.waitForFunction(()=>window.__ARAMA_MIK_ENABLED===false, null, {timeout:5000});
  const muteAktif = await A.evaluate(()=>document.getElementById('videoMuteBtn').classList.contains('aktif'));
  if (!muteAktif) throw new Error('❌ mute butonu aktif görünmedi');
  await A.click('#videoMuteBtn');   // geri aç
  await A.waitForFunction(()=>window.__ARAMA_MIK_ENABLED===true, null, {timeout:5000});
  log('  ✅ MUTE: track.enabled false→true toggle + buton durumu');

  // [3b] KAMERA aç/kapa (track.enabled)
  await A.click('#videoKameraBtn');
  await A.waitForFunction(()=>window.__ARAMA_KAM_ENABLED===false, null, {timeout:5000});
  const kamAktif = await A.evaluate(()=>document.getElementById('videoKameraBtn').classList.contains('aktif'));
  if (!kamAktif) throw new Error('❌ kamera-kapalı butonu aktif görünmedi');
  await A.click('#videoKameraBtn');   // geri aç
  await A.waitForFunction(()=>window.__ARAMA_KAM_ENABLED===true, null, {timeout:5000});
  log('  ✅ KAMERA aç/kapa: video track.enabled toggle + buton durumu');

  // [3c] ÖN/ARKA ÇEVİR (facingMode → replaceTrack); akış kesilmez (durum hâlâ konuşuyor)
  const yuz0 = await A.evaluate(()=>window.__ARAMA_YUZ || 'user');
  await A.click('#videoCevirBtn');
  await A.waitForFunction(()=>window.__ARAMA_YUZ==='environment', null, {timeout:8000});
  const arkaSinif = await A.evaluate(()=>document.getElementById('yerelVideo').classList.contains('arka'));
  if (!arkaSinif) throw new Error('❌ arka kameraya geçince yerelVideo .arka (ayna kapalı) sınıfı yok');
  if (await A.evaluate(()=>window.__ARAMA_DURUM)!=='konusuyor') throw new Error('❌ kamera çevirince çağrı düştü (replaceTrack akışı kesti)');
  if (!(await uzakVideoTrackVar(B))) throw new Error('❌ çevirme sonrası bob karşı videoyu kaybetti');
  await A.click('#videoCevirBtn');    // tekrar öne
  await A.waitForFunction(()=>window.__ARAMA_YUZ==='user', null, {timeout:8000});
  if (await A.evaluate(()=>document.getElementById('yerelVideo').classList.contains('arka'))) throw new Error('❌ öne dönünce .arka sınıfı kalkmadı');
  log('  ✅ ÇEVİR: ön→arka→ön (facingMode replaceTrack, akış KESİLMEDİ) + ayna sınıfı');

  // [4] bitir → iki taraf bos + sahne kapanır
  log('\n  [4] alice bitirir → iki taraf temiz:');
  await A.click('#videoKapatBtn');
  await bekleDurum(A,'bos'); await bekleDurum(B,'bos');
  if (!(await gizliMi(A,'videoSahne')) || !(await gizliMi(B,'videoSahne'))) throw new Error('❌ video sahnesi kapanmadı');
  log('  ✅ iki taraf "bos", sahne kapandı');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ H1 GÖRÜNTÜLÜ ARAMA UI GEÇTİ (izole):');
  log('   • görüntülü buton 1:1\'de CANLI (grupta gizli — grup arama=H2)');
  log('   • karşılıklı video + sahne iki tarafta açık');
  log('   • mute · kamera aç/kapa (track.enabled) · ön/arka çevir (facingMode replaceTrack, akış kesilmez)');
  log('   • bitir → temiz; canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
