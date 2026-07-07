// NarChat — FAZ F1: SESLİ MESAJ kanıtı (izole, 2 tarayıcı).
// alice 🎤 ile sesli mesaj kaydeder (WAV 16kHz mono, fake mic) → gönderir → bob baloncukta <audio> alır.
// Doğrular: kayıt barı açılır · gönderince iki tarafta .ses-mesaj baloncuğu + <audio> · govde.sesli=true + süre
// · SUNUCU OPAK: /api/medya ciphertext'i WAV değil (RIFF ile başlamaz) = düz ses sunucuda YOK.
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/ses_mesaj.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8119, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-ses-'));
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

let server;
async function main(){
  log('🎤 NarChat FAZ F1 — SESLİ MESAJ (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');
  log('  ✓ alice + bob kayıt');

  await A.reload(); await uygulamaHazir(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola', PAROLA); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  await B.reload(); await uygulamaHazir(B);
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola', PAROLA); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  await B.locator('#odalar .oda').first().click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ iki taraf ortak odada');

  // ── alice sesli mesaj kaydeder + gönderir ──
  await A.click('#sesBtn');
  await A.waitForSelector('#sesKayitBar:not(.gizli)', {timeout:8000});
  if (await A.evaluate(()=>!document.getElementById('komp').classList.contains('kayitta'))) carp('komp kayıt moduna geçmedi');
  log('  ✅ [1] kayıt barı açıldı (komp.kayitta)');
  await sleep(1800);                                 // ~1.8sn kayıt (fake mic tonu)
  await A.click('#sesKayitGonder');

  // alice tarafında ses baloncuğu
  await A.waitForSelector('#akis .ses-mesaj .ses-oynat', {timeout:15000});
  const aSrc = await A.evaluate(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && a.src; });
  if (!aSrc || !aSrc.startsWith('blob:')) carp('alice ses baloncuğu audio src yok: '+aSrc);
  log('  ✅ [2] alice ekranında sesli mesaj baloncuğu + <audio> (blob URL)');

  // bob tarafında ses baloncuğu (SSE ile düştü, çözüldü)
  await B.waitForSelector('#akis .ses-mesaj .ses-oynat', {timeout:20000});
  const bSrc = await B.evaluate(()=>{ const a=document.querySelector('#akis .ses-mesaj audio'); return a && a.src; });
  if (!bSrc || !bSrc.startsWith('blob:')) carp('bob ses baloncuğu audio src yok: '+bSrc);
  log('  ✅ [3] bob sesli mesajı aldı + çözdü (<audio> blob URL)');

  // govde.sesli + süre + SUNUCU OPAKLIK kanıtı
  const meta = await A.evaluate(async ()=>{
    const r = await fetch('/api/mesajlar?oda='+encodeURIComponent(window.__ODA_TEST||'')+'&since=0', {credentials:'same-origin'});
    return null;   // (oda id'sini DOM'dan almak daha güvenilir — aşağıda)
  });
  // oda id'siz: mesajları doğrudan çek (tek oda var)
  const bilgi = await A.evaluate(async ()=>{
    // aktif oda id'sini app'ten al
    const odaSatir = document.querySelector('#odalar .oda, #kisiler .oda');
    // mesajları API'den çek: önce oda listesini al
    const lst = await (await fetch('/api/odalar',{credentials:'same-origin'})).json().catch(()=>null);
    const oda = (lst && lst[0] && (lst[0].oda||lst[0].id)) || null;
    if (!oda) return {hata:'oda yok'};
    const mlist = await (await fetch('/api/mesajlar?oda='+encodeURIComponent(oda)+'&since=0',{credentials:'same-origin'})).json();
    const sesli = mlist.find(m=>m.govde && m.govde.sema==='e2e1m' && m.govde.sesli);
    if (!sesli) return {hata:'sesli mesaj API\'de yok'};
    // medya ciphertext'ini çek → WAV mı (RIFF) yoksa opak mı?
    const buf = new Uint8Array(await (await fetch('/api/medya?id='+encodeURIComponent(sesli.govde.medya_id),{credentials:'same-origin'})).arrayBuffer());
    const magic = String.fromCharCode(buf[0],buf[1],buf[2],buf[3]);
    return { sesli:!!sesli.govde.sesli, sure:sesli.govde.sure||0, mime:sesli.govde.mime, uzunluk:buf.length, magic };
  });
  if (bilgi.hata) carp('meta okunamadı: '+bilgi.hata);
  if (bilgi.sesli !== true) carp('govde.sesli true değil');
  if (!(bilgi.sure >= 1)) carp('süre < 1sn: '+bilgi.sure);
  log('  ✅ [4] govde.sesli=true · süre='+bilgi.sure+'sn · mime='+bilgi.mime);
  if (bilgi.uzunluk < 1000) carp('medya ciphertext çok küçük ('+bilgi.uzunluk+'B) — ses yakalanmadı?');
  if (bilgi.magic === 'RIFF') carp('🔓 SUNUCUDA DÜZ WAV! (ciphertext RIFF ile başlıyor) — E2E kırık!');
  log('  ✅ [5] SUNUCU OPAK: depo ciphertext WAV değil (magic="'+bilgi.magic+'", '+bilgi.uzunluk+'B) — düz ses YOK');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ F1 SESLİ MESAJ GEÇTİ (izole):');
  log('   • 🎤 kaydet→gönder; iki tarafta <audio> baloncuğu (WAV, cross-platform çalar)');
  log('   • mevcut E2E medya pipeline (secretbox+fan-out, /api/medya opak)');
  log('   • sunucu deposunda DÜZ SES YOK (ciphertext, RIFF değil)');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
