// NarChat — FAZ H3: GRUP YÖNETİMİ (üye ekle/çıkar/ayrıl + grup fotoğrafı) izole, 3 tarayıcı.
// Doğrular: başlığa dokun→grup sheet · üye ekle (carol gruba gelir) · grup fotoğrafı (yayılır) ·
//   üye çıkar (carol'un grubu kaybolur) · gruptan ayrıl · E2E ileri-gizlilik (yeni üye sonraki mesajı okur).
// Sunucu /api/oda-uye + /api/oda-foto opak metadata; mesaj içeriği E2E. Çalıştır: HEADLESS=1 node test/grup_yonetim.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8133, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-gy-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, kullanici){
  const page = await ctx.newPage();
  page.on('dialog', d=>d.accept());          // confirm() → otomatik onayla
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
const odaSay = (page) => page.evaluate(()=>document.querySelectorAll('#odalar .oda').length);

let server;
async function main(){
  log('🛠 NarChat FAZ H3 — GRUP YÖNETİMİ (izole, 3 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  const C = await kayit(await browser.newContext({ ...iPhone }), 'carol');
  // alice herkesi kişi ekler (üye-ekle adayları KISILER'den gelir)
  await A.click('#altNav button[data-gor="kisiler"]');
  for (const u of ['bob','carol']){
    await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
    await A.fill('#kisiEkleIn', u); await A.click('#kisiEkleBtn'); await sleep(200);
  }
  log('  ✓ alice kayıt + bob/carol kişi eklendi');

  // alice grup kurar (başta yalnız alice+bob)
  const oda = await A.evaluate(async ()=>{
    const r = await fetch('/api/oda', {method:'POST', headers:{'Content-Type':'application/json','X-NarChat':'1'},
      credentials:'same-origin', body: JSON.stringify({tip:'grup', ad:'Takım', uyeler:['bob']})});
    return (await r.json()).oda;
  });
  await odayaGir(A); await odayaGir(B); await odayaGir(C);
  await sleep(500);
  await A.locator('#odalar .oda').first().click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ grup "Takım" kuruldu (alice+bob), alice açtı');

  // [1] başlığa dokun → grup sheet, 2 üye
  log('\n  [1] grup yönetimi sheet:');
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu .grup-uye-liste', {timeout:5000});
  let n = await A.evaluate(()=>document.querySelectorAll('#mesajMenu .grup-uye').length);
  if (n !== 2) throw new Error('❌ sheet 2 üye beklerken '+n);
  log('  ✅ başlığa dokun → grup sheet açıldı (2 üye)');

  // [2] üye ekle: carol
  log('\n  [2] carol\'u gruba ekle:');
  await A.click('#mesajMenu button:has-text("Üye ekle")');
  await A.click('#mesajMenu button:has-text("@carol")');
  // grupUyeEkle → ekle + yenile + grupBilgiAc (sheet OTOMATİK yeniden açılır, 3 üye)
  await A.waitForFunction(()=>document.querySelectorAll('#mesajMenu .grup-uye').length===3, null, {timeout:8000});
  await C.waitForFunction(()=>document.querySelectorAll('#odalar .oda').length>=1, null, {timeout:8000});
  log('  ✅ carol eklendi → alice sheet 3 üye + carol\'un listesinde grup belirdi');
  await A.evaluate(()=>document.getElementById('mesajMenuOrt')?.click());   // sheet kapat (overlay engellemesin)

  // [3] grup fotoğrafı (sunucu + alice'e SSE ile yansır → başlık avatarı arka-plan görseli olur)
  log('\n  [3] grup fotoğrafı:');
  const minik = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  const fok = await A.evaluate(async (p)=>{ const r=await fetch('/api/oda-foto',{method:'POST',headers:{'Content-Type':'application/json','X-NarChat':'1'},credentials:'same-origin',body:JSON.stringify({oda:p.oda, avatar:p.av})}); return r.ok; }, {oda, av:minik});
  if (!fok) throw new Error('❌ /api/oda-foto başarısız');
  // alice oda-foto SSE → odaDegistiOlayi → #odaAvatar arka-plan görseli olur
  await A.waitForFunction(()=>{ const s=document.getElementById('odaAvatar'); return s && /data:image|url\(/.test(s.style.backgroundImage||''); }, null, {timeout:8000});
  log('  ✅ grup fotoğrafı kaydedildi + SSE ile başlık avatarına yansıdı');

  // [4] E2E ileri-gizlilik: alice yeni mesaj → carol (yeni üye) OKUR
  log('\n  [4] E2E: yeni üye sonraki mesajı çözer:');
  await A.fill('#mesajIn', 'merhaba carol grup'); await A.click('#gonderBtn'); await sleep(300);
  await C.locator('#odalar .oda').first().click();
  await C.waitForSelector('#mesajIn:not([disabled])');
  await C.waitForFunction(()=>[...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent.includes('merhaba carol grup')), null, {timeout:8000});
  log('  ✅ carol eklendikten SONRAki mesajı çözüp okudu (E2E güncel üyeye fan-out)');

  // [5] carol'u çıkar → carol\'un grubu kaybolur
  log('\n  [5] carol\'u çıkar:');
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu .grup-uye-liste', {timeout:5000});
  await A.click('#mesajMenu .grup-uye:has-text("carol") .grup-uye-cikar');
  await sleep(800);
  await C.waitForFunction(()=>document.querySelectorAll('#odalar .oda').length===0, null, {timeout:8000});
  log('  ✅ carol çıkarıldı → carol\'un sohbet listesinden grup kalktı');
  await A.evaluate(()=>document.getElementById('mesajMenuOrt')?.click());

  // [6] bob gruptan ayrılır → grupta yalnız alice
  log('\n  [6] bob ayrılır:');
  const uyeKalan = await B.evaluate(async (oda)=>{
    const r=await fetch('/api/oda-uye',{method:'POST',headers:{'Content-Type':'application/json','X-NarChat':'1'},credentials:'same-origin',body:JSON.stringify({oda, eylem:'ayril'})});
    return (await r.json()).uyeler;
  }, oda);
  if (!uyeKalan || uyeKalan.length!==1 || uyeKalan[0]!=='alice') throw new Error('❌ bob ayrıldıktan sonra üyeler: '+JSON.stringify(uyeKalan));
  log('  ✅ bob ayrıldı → grupta yalnız alice');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ H3 GRUP YÖNETİMİ GEÇTİ (izole):');
  log('   • başlığa dokun → grup sheet (üye listesi) · üye ekle/çıkar · gruptan ayrıl · grup fotoğrafı');
  log('   • üyelik/foto = opak metadata (kişisel kanal SSE ile yayılır); mesaj içeriği E2E');
  log('   • E2E ileri-gizlilik: yeni üye eklendikten SONRAki mesajı çözer (güncel üyeye fan-out)');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
