// NarChat — N7: sesli mesaj DALGA FORMU + özel oynatıcı (izole, fake mic).
// Doğrular: kayıt→baloncukta dalga (32 bar) + ▶ butonu · bara tıkla→seek+ilerleme highlight · ▶/⏸ toggle
// · native controls KALDIRILDI ama audio motoru (blob src + playbackRate) + hız butonu KORUNDU (regresyon).
// Canlıya DOKUNMAZ. Çalıştır: HEADLESS=1 node test/ses_dalga.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8167, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-sesdalga-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola',PAROLA); await p.click('#kayitBtn'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
let server;
async function main(){
  log('🌊 NarChat N7 — Sesli mesaj DALGA FORMU (izole)\n');
  server = await sunucuBaslat(); log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');
  await A.click('#altNav button[data-gor="kisiler"]'); await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn','bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda',{hasText:'@bob'}).click(); await A.waitForSelector('#mesajIn:not([disabled])');
  // sesli mesaj kaydet + gönder
  await A.click('#sesBtn'); await A.waitForSelector('#sesKayitBar:not(.gizli)', {timeout:8000});
  await sleep(1500); await A.click('#sesKayitGonder');
  await A.waitForSelector('#akis .ses-mesaj .ses-oynat', {timeout:15000});
  log('  ✓ sesli mesaj gönderildi');

  const ses = A.locator('#akis .ses-mesaj').last();

  // [1] dalga (32 bar) + ▶ butonu var
  const barSay = await ses.locator('.ses-dalga .ses-dalga-bar').count();
  if (barSay !== 32) carp('[1] dalga bar sayısı 32 değil: '+barSay);
  if ((await ses.locator('.ses-oynat').textContent()).trim() !== '▶') carp('[1] oynat butonu ▶ değil');
  log('  ✅ [1] dalga formu 32 bar + ▶ oynat butonu');

  // [2] bara tıkla → seek (currentTime>0) + ilerleme highlight (bazı bar .calindi)
  await A.waitForFunction(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && isFinite(a.duration) && a.duration>0; }, null, {timeout:10000});
  await ses.locator('.ses-dalga').click();   // merkeze tıkla ≈ %50
  await A.waitForFunction(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && a.currentTime>0.05; }, null, {timeout:5000}).catch(()=>carp('[2] seek currentTime>0 olmadı'));
  // timeupdate handler'ı .calindi'yi uygulayana dek bekle (seek→timeupdate async)
  await A.waitForFunction(()=> document.querySelectorAll('#akis .ses-mesaj .ses-dalga-bar.calindi').length>0, null, {timeout:5000}).catch(()=>carp('[2] seek sonrası ilerleme highlight (.calindi) yok'));
  log('  ✅ [2] bara tıkla → seek (currentTime>0) + ilerleme highlight');

  // [3] ▶ → oynat (buton ⏸ olur / audio çalar)
  await ses.locator('.ses-oynat').click();
  await A.waitForFunction(()=>{ const b=document.querySelector('#akis .ses-mesaj .ses-oynat'); const a=document.querySelector('#akis .ses-mesaj audio'); return (b && b.textContent.trim()==='⏸') || (a && !a.paused); }, null, {timeout:6000}).catch(()=>carp('[3] oynat sonrası ⏸/çalma durumu olmadı'));
  log('  ✅ [3] ▶ tıkla → oynatılıyor (⏸)');

  // [4] ⏸ → duraklat (buton ▶ olur)
  await ses.locator('.ses-oynat').click();
  await A.waitForFunction(()=>{ const b=document.querySelector('#akis .ses-mesaj .ses-oynat'); const a=document.querySelector('#akis .ses-mesaj audio'); return b && b.textContent.trim()==='▶' && a && a.paused; }, null, {timeout:6000}).catch(()=>carp('[4] duraklat sonrası ▶/paused olmadı'));
  log('  ✅ [4] ⏸ tıkla → duraklatıldı (▶)');

  // [5] REGRESYON: native controls KALDIRILDI ama motor (blob src + playbackRate) + hız butonu KORUNDU
  const reg = await A.evaluate(()=>{ const a=document.querySelector('#akis .ses-mesaj audio');
    return { controls:a?a.controls:null, blob:!!(a&&a.src&&a.src.startsWith('blob:')), rate:a?a.playbackRate:null,
             hiz:!!document.querySelector('#akis .ses-mesaj .ses-hiz') }; });
  if (reg.controls !== false) carp('[5] native controls hâlâ açık: '+reg.controls);
  if (!reg.blob) carp('[5] audio blob src kayıp (motor bozuldu)');
  if (!reg.hiz) carp('[5] hız butonu (.ses-hiz) kayboldu');
  log('  ✅ [5] regresyon: controls kaldırıldı · audio motoru (blob src, rate='+reg.rate+') + .ses-hiz korundu');

  // [6] a11y (ikinci-göz): dalga klavye-erişilebilir slider — role=slider + tabindex + ok tuşları seek
  const dalgaRol = await ses.locator('.ses-dalga').getAttribute('role');
  const dalgaTab = await ses.locator('.ses-dalga').getAttribute('tabindex');
  if (dalgaRol !== 'slider' || dalgaTab !== '0') carp('[6] .ses-dalga slider/tabindex değil: '+dalgaRol+'/'+dalgaTab);
  await ses.locator('.ses-dalga').focus();
  await A.keyboard.press('Home');
  await A.waitForFunction(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && a.currentTime<0.05; }, null, {timeout:4000}).catch(()=>carp('[6] Home ile başa sarmadı'));
  await A.keyboard.press('ArrowRight');
  await A.waitForFunction(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && a.currentTime>0.02; }, null, {timeout:4000}).catch(()=>carp('[6] ArrowRight ile ilerlemedi'));
  log('  ✅ [6] a11y: klavye seek (role=slider · Home/ArrowRight ile currentTime değişir)');

  await browser.close();
  log('\n✅ N7 SESLİ MESAJ DALGA FORMU GEÇTİ (izole): 32-bar dalga · seek+ilerleme · ▶/⏸ · motor+hız korundu');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
