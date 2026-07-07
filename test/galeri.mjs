// NarChat — N7: MEDYA GALERİSİ kanıtı (izole). Sohbet bilgi sheet'inden "🖼 Medya galerisi"
// → tüm geçmişteki görsel + dosyalar (sesli notalar HARİÇ) grid+liste; görsele dokun → lightbox.
// Canlıya DOKUNMAZ. Çalıştır: node test/galeri.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8165, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// minik geçerli WAV (RIFF başlık + 1 örnek) — audio/wav MIME ile gönderilir → galeriye GİRMEMELİ
const WAV_MINI = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=', 'base64');
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-gal-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola','parola1234'); await p.click('#kayitBtn'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
let server;
async function main(){
  log('🖼 NarChat N7 — MEDYA GALERİSİ (izole)\n');
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

  // [1] MEDYA YOKKEN boş-durum
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu .galeri-ac', {timeout:5000});
  await A.click('#mesajMenu .galeri-ac');
  await A.waitForSelector('#galeri .galeri-bos-kap', {timeout:6000});
  const bosMetin = await A.textContent('#galeri .galeri-bos-kap .galeri-bos');
  if (!/henüz medya/i.test(bosMetin||'')) carp('boş-durum metni beklenmedik: '+bosMetin);
  await A.click('#galeri .galeri-kapat');
  await A.waitForSelector('#galeri', {state:'detached', timeout:5000});
  log('  ✅ [1] medya yokken boş-durum ("henüz medya paylaşılmadı")');

  // 3 medya + 1 metin gönder: görsel (image) + dosya (text) + ses (audio→galeri HARİÇ) + metin (galeri HARİÇ)
  await A.locator('#medyaIn').setInputFiles({ name:'foto.png', mimeType:'image/png', buffer: PNG_1x1 });
  await A.waitForSelector('#akis img.medya-resim', {timeout:15000});
  await A.locator('#medyaIn').setInputFiles({ name:'notlar.txt', mimeType:'text/plain', buffer: Buffer.from('merhaba dosya') });
  await A.waitForSelector('#akis a.medya-dosya', {timeout:15000});
  await A.locator('#medyaIn').setInputFiles({ name:'ses.wav', mimeType:'audio/wav', buffer: WAV_MINI });
  await A.waitForSelector('#akis .ses-mesaj', {timeout:15000});
  await A.fill('#mesajIn','merhaba dünya'); await A.click('#gonderBtn');
  await A.waitForFunction(()=>[...document.querySelectorAll('#akis .metin')].some(e=>/merhaba dünya/.test(e.textContent||'')), null, {timeout:10000});
  log('  ✓ görsel + dosya + ses + metin gönderildi');

  // [2] galeriyi aç → görsel grid = 1, dosya liste = 1 (ses HARİÇ)
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu .galeri-ac', {timeout:5000});
  await A.click('#mesajMenu .galeri-ac');
  await A.waitForSelector('#galeri .galeri-grid .galeri-gorsel img', {timeout:8000});
  await A.waitForFunction(()=>{ const i=document.querySelector('#galeri .galeri-gorsel img'); return i && i.complete && i.naturalWidth>0; }, null, {timeout:8000});
  const nGorsel = await A.locator('#galeri .galeri-grid .galeri-gorsel').count();
  if (nGorsel !== 1) carp('görsel sayısı 1 olmalı, gelen: '+nGorsel);
  log('  ✅ [2] görseller bölümü = 1 (foto.png)');

  // [3] dosya = 1 (notlar.txt); ses.wav galeriye GİRMEDİ
  const nDosya = await A.locator('#galeri .galeri-dosyalar .galeri-dosya').count();
  if (nDosya !== 1) carp('dosya sayısı 1 olmalı (ses hariç), gelen: '+nDosya);
  const dosyaAd = await A.textContent('#galeri .galeri-dosya .galeri-dosya-ad');
  if (!/notlar\.txt/.test(dosyaAd||'')) carp('dosya adı notlar.txt olmalı, gelen: '+dosyaAd);
  const sesVar = await A.evaluate(()=>[...document.querySelectorAll('#galeri .galeri-dosya-ad, #galeri .galeri-gorsel')].some(e=>/ses\.wav/.test(e.getAttribute('aria-label')||e.textContent||'')));
  if (sesVar) carp('sesli/audio dosya galeriye SIZDI (girmemeli)');
  log('  ✅ [3] dosyalar = 1 (notlar.txt) · ses.wav galeriye GİRMEDİ');

  // [4] görsele dokun → lightbox açılır
  await A.click('#galeri .galeri-gorsel');
  await A.waitForSelector('#lightbox .lightbox-img', {timeout:5000});
  // [4b] ikinci-göz fix: galeri üstünde lightbox açıkken ESC → lightbox kapanır AMA galeri kalır + görsel URL'i geçerli kalır
  await A.keyboard.press('Escape');
  await A.waitForSelector('#lightbox', {state:'detached', timeout:5000});
  if (!(await A.locator('#galeri').count())) carp('ESC lightbox yerine galeriyi kapattı (URL revoke riski)');
  const urlGecerli = await A.evaluate(async ()=>{ const i=document.querySelector('#galeri .galeri-gorsel img'); if(!i) return false; try{ const r=await fetch(i.src); return r.ok; }catch{ return false; } });
  if (!urlGecerli) carp('galeri görsel objectURL ESC sonrası geçersizleşti (revoke edilmiş)');
  log('  ✅ [4] görsele dokun → lightbox · ESC lightboxı kapatır, galeri+URL sağlam');
  // lightbox tekrar aç → ✕ ile kapat
  await A.click('#galeri .galeri-gorsel');
  await A.waitForSelector('#lightbox .lightbox-img', {timeout:5000});
  await A.click('#lightbox .lightbox-kapat');
  await A.waitForSelector('#lightbox', {state:'detached', timeout:5000});

  // [5] galeri kapanır
  await A.click('#galeri .galeri-kapat');
  await A.waitForSelector('#galeri', {state:'detached', timeout:5000});
  log('  ✅ [5] galeri kapandı');

  await browser.close();
  log('\n✅ N7 MEDYA GALERİSİ GEÇTİ (izole): boş-durum · görsel grid · dosya liste · ses-hariç · lightbox');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
