// NarChat — N7: sesli mesaj oynatma hızı (1× → 1.5× → 2× → 1×). İzole, 1 tarayıcı (kendi baloncuğu yeter).
// Doğrular: hız butonu var · tıkla → döngü + audio.playbackRate değişir · son hız GLOBAL+KALICI (yeni nota + reload o hızda başlar).
// Çalıştır: HEADLESS=1 node test/ses_hiz.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8163, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-seshiz-'));
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
async function sesliMesajGonder(A){
  await A.click('#sesBtn');
  await A.waitForSelector('#sesKayitBar:not(.gizli)', {timeout:8000});
  await sleep(1500);
  await A.click('#sesKayitGonder');
  await A.waitForSelector('#akis .ses-mesaj .ses-oynat', {timeout:15000});
}
const sonHizBtn = (A) => A.locator('#akis .ses-mesaj .ses-hiz').last();
const sonRate  = (A) => A.evaluate(()=>{ const els=document.querySelectorAll('#akis .ses-mesaj audio'); const a=els[els.length-1]; return a ? a.playbackRate : null; });

let server;
async function main(){
  log('⏩ NarChat N7 — Sesli mesaj oynatma hızı (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');   // bob var olmalı (kişi eklenebilsin)
  // bob'u ekle (oda için) + sesli mesaj gönder
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  await sesliMesajGonder(A);
  log('  ✓ sesli mesaj gönderildi + baloncuk göründü');

  // [1] hız butonu var, başlangıç 1× ve audio.playbackRate=1
  const btn = sonHizBtn(A);
  if (!await btn.count()) carp('[1] .ses-hiz butonu yok');
  if ((await btn.textContent()).trim() !== '1×') carp('[1] başlangıç etiketi 1× değil: '+(await btn.textContent()));
  if (Math.abs(await sonRate(A) - 1) > 0.01) carp('[1] başlangıç playbackRate 1 değil: '+await sonRate(A));
  log('  ✅ [1] hız butonu var, başlangıç 1× (playbackRate=1)');

  // [2] tıkla → 1.5× ; playbackRate=1.5
  await btn.click(); await sleep(80);
  if ((await btn.textContent()).trim() !== '1.5×') carp('[2] etiket 1.5× değil: '+(await btn.textContent()));
  if (Math.abs(await sonRate(A) - 1.5) > 0.01) carp('[2] playbackRate 1.5 değil: '+await sonRate(A));
  log('  ✅ [2] tıkla → 1.5× (playbackRate=1.5)');

  // [3] tıkla → 2× ; sonra tıkla → 1× (döngü)
  await btn.click(); await sleep(80);
  if ((await btn.textContent()).trim() !== '2×' || Math.abs(await sonRate(A) - 2) > 0.01) carp('[3] 2× değil: '+(await btn.textContent())+'/'+await sonRate(A));
  await btn.click(); await sleep(80);
  if ((await btn.textContent()).trim() !== '1×' || Math.abs(await sonRate(A) - 1) > 0.01) carp('[3] döngü başa (1×) dönmedi: '+(await btn.textContent())+'/'+await sonRate(A));
  log('  ✅ [3] döngü 1×→1.5×→2×→1× (playbackRate izliyor)');

  // [4] GLOBAL+KALICI: hızı 2× yap → YENİ sesli mesaj o hızda başlar + localStorage yazıldı
  await btn.click(); await btn.click();   // 1×→1.5×→2×
  const ls = await A.evaluate(()=>localStorage.getItem('narchat_ses_hiz'));
  if (ls !== '2') carp('[4] localStorage narchat_ses_hiz=2 değil: '+ls);
  await sesliMesajGonder(A);
  const yeniBtn = sonHizBtn(A);
  if ((await yeniBtn.textContent()).trim() !== '2×' || Math.abs(await sonRate(A) - 2) > 0.01)
    carp('[4] yeni nota son hızda (2×) başlamadı: '+(await yeniBtn.textContent())+'/'+await sonRate(A));
  log('  ✅ [4] son hız global + kalıcı (yeni nota 2× başlar, localStorage=2)');

  // [5] reload sonrası da 2× (kalıcı)
  await A.reload(); await uygulamaHazir(A);
  await A.waitForSelector('#altNav:not(.gizli)', {timeout:15000});
  await A.locator('#odalar .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#akis .ses-mesaj .ses-oynat', {timeout:15000});
  if ((await sonHizBtn(A).textContent()).trim() !== '2×' || Math.abs(await sonRate(A) - 2) > 0.01)
    carp('[5] reload sonrası 2× değil: '+(await sonHizBtn(A).textContent())+'/'+await sonRate(A));
  log('  ✅ [5] reload sonrası hız korundu (2×)');

  await browser.close();
  log('\n✅ N7 SESLİ MESAJ HIZI GEÇTİ (izole): buton + döngü 1×/1.5×/2× + playbackRate + global-kalıcı + reload');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n'+(e.message||e)); server?.proc.kill(); process.exit(1); });
