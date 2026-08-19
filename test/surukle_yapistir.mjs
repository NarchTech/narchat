// NarChat — N7: SÜRÜKLE-BIRAK + YAPIŞTIR ile medya gönderme kanıtı (izole).
// Panoya kopyalanan görsel yapıştırılınca + dosya sohbete bırakılınca mevcut E2E medya pipeline'ından gider.
// Canlıya DOKUNMAZ. Çalıştır: node test/surukle_yapistir.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8166, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const PNG_1x1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-sy-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola','parola1234'); await p.click('#kayitBtn'); await p.click('#kayitOnayTamam'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
// tarayıcı-içinde base64→Uint8Array + DataTransfer kur + olay dispatch et (paste/drop programatik)
const B64_TO_U8 = `(b64)=>{ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }`;
let server;
async function main(){
  log('📥 NarChat N7 — SÜRÜKLE-BIRAK + YAPIŞTIR (izole)\n');
  server = await sunucuBaslat(); log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  await kayit(await browser.newContext({ ...iPhone }), 'bob');
  await A.reload(); await uyg(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola','parola1234'); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');
  await A.click('#altNav button[data-gor="kisiler"]'); await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn','bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda',{hasText:'@bob'}).click(); await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice @bob odasında');

  // [1] YAPIŞTIR: panoda görsel varken #mesajIn'e paste → E2E medya mesajı olarak gider
  await A.evaluate(({b64, toU8})=>{
    const u8 = (new Function('b64', 'return ('+toU8+')(b64)'))(b64);
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'pano.png', {type:'image/png'}));
    const ev = new Event('paste', {bubbles:true, cancelable:true});
    Object.defineProperty(ev, 'clipboardData', {value: dt});
    document.getElementById('mesajIn').dispatchEvent(ev);
  }, {b64:PNG_1x1_B64, toU8:B64_TO_U8});
  await A.waitForSelector('#akis img.medya-resim', {timeout:15000});
  const n1 = await A.locator('#akis img.medya-resim').count();
  if (n1 !== 1) carp('yapıştırma sonrası görsel sayısı 1 olmalı, gelen: '+n1);
  log('  ✅ [1] görsel YAPIŞTIR → E2E medya mesajı gönderildi');

  // [1b] düz METİN yapıştırma medyaya dönüşmemeli (görsel sayısı artmamalı)
  await A.evaluate(()=>{
    const dt = new DataTransfer(); dt.setData('text/plain', 'sadece yazı');
    const ev = new Event('paste', {bubbles:true, cancelable:true});
    Object.defineProperty(ev, 'clipboardData', {value: dt});
    document.getElementById('mesajIn').dispatchEvent(ev);
  });
  await sleep(400);
  if (await A.locator('#akis img.medya-resim').count() !== 1) carp('düz metin yapıştırma yanlışlıkla medya gönderdi');
  log('  ✅ [1b] düz metin yapıştırma medya göndermez (dokunmadı)');

  // [2] SÜRÜKLE-BIRAK: dosya #gorunum-oda üzerine drop → E2E medya mesajı olarak gider
  await A.evaluate(({b64, toU8})=>{
    const u8 = (new Function('b64', 'return ('+toU8+')(b64)'))(b64);
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'birakilan.png', {type:'image/png'}));
    const ev = new Event('drop', {bubbles:true, cancelable:true});
    Object.defineProperty(ev, 'dataTransfer', {value: dt});
    document.getElementById('gorunum-oda').dispatchEvent(ev);
  }, {b64:PNG_1x1_B64, toU8:B64_TO_U8});
  await A.waitForFunction(()=>document.querySelectorAll('#akis img.medya-resim').length===2, null, {timeout:15000});
  log('  ✅ [2] görsel SÜRÜKLE-BIRAK → E2E medya mesajı gönderildi');

  // [3] E2E kanıtı: bob (karşı taraf) her iki görseli de çözer (drop/paste mevcut E2E medya pipeline'ından geçti)
  const B = browser.contexts()[1].pages()[0];
  await B.bringToFront();
  await B.reload(); await uyg(B);                        // taze oda listesi (idle SSE'ye güvenme — medya.mjs deseni)
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola','parola1234'); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  await B.waitForSelector('#odalar .oda', {timeout:15000});
  await B.locator('#odalar .oda').first().click();
  await B.waitForFunction(()=>document.querySelectorAll('#akis img.medya-resim').length>=2, null, {timeout:15000});
  log('  ✅ [3] bob 2 görseli de ÇÖZDÜ (E2E korunur; drop/paste mevcut medya pipeline\'ından geçti)');

  // [4] İKİNCİ-GÖZ F1 guard: sohbet KAPALIYKEN (gorunum-oda gizli / overlay açık) drop gönderim YAPMAZ
  await A.bringToFront();
  await A.click('#geriBtn');
  await A.waitForSelector('#gorunum-oda.gizli', {timeout:5000});
  await A.evaluate(({b64, toU8})=>{
    const u8 = (new Function('b64', 'return ('+toU8+')(b64)'))(b64);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'olmaz.png', {type:'image/png'}));
    const ev = new Event('drop', {bubbles:true, cancelable:true});
    Object.defineProperty(ev, 'dataTransfer', {value: dt});
    document.dispatchEvent(ev);
  }, {b64:PNG_1x1_B64, toU8:B64_TO_U8});
  await sleep(500);
  await A.click('#altNav button[data-gor="sohbetler"]');   // sohbet listesine geç (oda kisiler'den açılmıştı)
  await A.locator('#odalar .oda').first().click();
  await A.waitForSelector('#akis img.medya-resim');
  const n4 = await A.locator('#akis img.medya-resim').count();
  if (n4 !== 2) carp('sohbet kapalıyken drop yanlışlıkla gönderdi (F1 guard); görsel sayısı: '+n4);
  log('  ✅ [4] sohbet kapalıyken drop gönderim yapmaz (F1 overlay/kapalı-view guard)');

  await browser.close();
  log('\n✅ N7 SÜRÜKLE-BIRAK + YAPIŞTIR GEÇTİ (izole): paste görsel · metin-dokunmaz · drop görsel · E2E karşı-çözüm');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
