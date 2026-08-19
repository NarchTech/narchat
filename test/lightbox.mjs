// NarChat — FAZ G3: FOTO LIGHTBOX kanıtı (izole). Görsele dokun → tam ekran; ✕ → kapanır.
// Canlıya DOKUNMAZ. Çalıştır: node test/lightbox.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8124, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-lb-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola','parola1234'); await p.click('#kayitBtn'); await p.click('#kayitOnayTamam'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
let server;
async function main(){
  log('🖼 NarChat FAZ G3 — FOTO LIGHTBOX (izole)\n');
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
  log('  ✓ alice odada');
  await A.locator('#medyaIn').setInputFiles({ name:'f.png', mimeType:'image/png', buffer: PNG_1x1 });
  await A.waitForSelector('#akis img.medya-resim', {timeout:15000});
  // görsel TAM yüklenip boyutu oturana kadar bekle — yoksa img yük sırasında yeniden boyutlanırken
  // tıklama tam o anda gelirse üstteki <span> tıklamayı yer (element "not stable") kırılganlığı olur.
  await A.waitForFunction(()=>{ const i=document.querySelector('#akis img.medya-resim'); return i && i.complete && i.naturalWidth>0; }, null, {timeout:10000});
  log('  ✓ foto gönderildi');
  // [1] görsele tıkla → lightbox açılır
  await A.click('#akis img.medya-resim');
  await A.waitForSelector('#lightbox .lightbox-img', {timeout:5000});
  log('  ✅ [1] görsele dokun → tam ekran lightbox açıldı');
  // [2] yakınlaştır toggle
  await A.click('#lightbox .lightbox-img');
  if (!(await A.evaluate(()=>document.querySelector('#lightbox .lightbox-img').classList.contains('zoom')))) carp('yakınlaştırma çalışmadı');
  log('  ✅ [2] tıkla → yakınlaştır (zoom)');
  // [3] ✕ → kapanır
  await A.click('#lightbox .lightbox-kapat');
  await A.waitForSelector('#lightbox', {state:'detached', timeout:5000});
  log('  ✅ [3] ✕ → lightbox kapandı');
  await browser.close();
  log('\n✅ FAZ G3 LIGHTBOX GEÇTİ (izole): aç · yakınlaştır · kapat');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
