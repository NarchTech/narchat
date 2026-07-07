// NarChat — N7: oda-başına mesaj taslağı (yarım kalan yazı korunur, yalnız yerel). İzole, çok-oda tek tarayıcı.
// Doğrular: yaz→başka odaya geç→dön = taslak geri gelir · her oda AYRI taslak · gönderince taslak silinir ·
//           reload'da kalıcı · sohbet listesinde "✎ Taslak:" göstergesi · sunucuya/E2E'ye dokunmaz (yalnız localStorage).
// Çalıştır: HEADLESS=1 node test/taslak.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8162, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-taslak-'));
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
// Oda açıldığını başlık DEĞİŞİMİYLE bekle — #mesajIn odalar arası enabled kaldığından tek başına yetersiz (yarış).
async function odaBaslikBekle(page, kim){
  await page.waitForSelector('#gorunum-oda:not(.gizli)', {timeout:8000});
  await page.waitForFunction((k)=>((document.getElementById('odaBaslik')||{}).textContent||'').toLowerCase().includes(k), kim.toLowerCase(), {timeout:8000});
  await page.waitForSelector('#mesajIn:not([disabled])');
}
async function kisiEkleVeAc(page, kim){
  await page.click('#altNav button[data-gor="kisiler"]');
  await page.click('#ekleBtn'); await page.click('#kisiEkleAc');
  await page.fill('#kisiEkleIn', kim); await page.click('#kisiEkleBtn');
  await page.locator('#kisiler .oda', { hasText:'@'+kim }).click();
  await odaBaslikBekle(page, kim);
}

let server;
async function main(){
  log('📝 NarChat N7 — Mesaj taslağı (oda-başına, izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext(), 'alice');
  // iki kişi: bob + carol (iki ayrı oda)
  await kayit(await browser.newContext(), 'bob');
  await kayit(await browser.newContext(), 'carol');
  log('  ✓ alice/bob/carol kayıtlı');

  // alice bob ile oda açar, taslak yazar (GÖNDERMEDEN)
  await kisiEkleVeAc(A, 'bob');
  await A.fill('#mesajIn', 'bob için yarım mesaj');
  await sleep(150);
  // [1] carol ile oda aç → taslak alanı BOŞ (her oda ayrı)
  await A.click('#geriBtn');
  await kisiEkleVeAc(A, 'carol');
  const carolBox = await A.inputValue('#mesajIn');
  if (carolBox !== '') throw new Error(`❌ [1] yeni odada taslak sızdı: "${carolBox}"`);
  log('  ✅ [1] carol odası boş açıldı (bob taslağı sızmadı — oda-başına ayrım)');
  await A.fill('#mesajIn', 'carol taslağı 42');
  await sleep(150);

  // [2] bob odasına dön → bob taslağı GERİ gelir
  await A.click('#geriBtn');
  await A.click('#altNav button[data-gor="sohbetler"]');   // carol'a kisiler'den girmiştik → sohbet listesine geç
  await A.locator('#odalar .oda', { hasText:'@bob' }).click();
  await odaBaslikBekle(A, 'bob');
  const bobBox = await A.inputValue('#mesajIn');
  if (bobBox !== 'bob için yarım mesaj') throw new Error(`❌ [2] bob taslağı geri gelmedi: "${bobBox}"`);
  log('  ✅ [2] bob odasına dönünce taslak geri geldi: "'+bobBox+'"');

  // [3] sohbet listesinde "✎ Taslak:" göstergesi (carol satırında — açık oda bob) — yenile() async, bekle
  await A.click('#geriBtn');
  await A.click('#altNav button[data-gor="sohbetler"]');
  await A.waitForFunction(()=>{
    const r = [...document.querySelectorAll('#odalar .oda')].find(x=>/@carol/.test(x.textContent));
    return r && /✎\s*Taslak:/.test(r.querySelector('.onizle')?.textContent||'');
  }, null, {timeout:8000});
  const carolOnizle = await A.locator('#odalar .oda', { hasText:'@carol' }).locator('.onizle').textContent();
  if (!/carol taslağı 42/.test(carolOnizle))
    throw new Error(`❌ [3] listede carol taslak metni yanlış: "${carolOnizle}"`);
  log('  ✅ [3] sohbet listesinde "✎ Taslak: …" göstergesi (carol): "'+carolOnizle.trim()+'"');

  // [4] reload sonrası taslak KALICI (localStorage)
  await A.reload(); await uygulamaHazir(A);
  await A.waitForSelector('#altNav:not(.gizli)', {timeout:15000});
  await A.locator('#odalar .oda', { hasText:'@bob' }).click();
  await odaBaslikBekle(A, 'bob');
  const bobReload = await A.inputValue('#mesajIn');
  if (bobReload !== 'bob için yarım mesaj') throw new Error(`❌ [4] reload'da bob taslağı kaybı: "${bobReload}"`);
  log('  ✅ [4] reload sonrası bob taslağı korundu');

  // [5] GÖNDER → taslak silinir (kutu boş + listede gösterge yok)
  await A.click('#gonderBtn');
  await sleep(400);
  const gonderSonra = await A.inputValue('#mesajIn');
  if (gonderSonra !== '') throw new Error(`❌ [5] gönderince kutu temizlenmedi: "${gonderSonra}"`);
  await A.click('#geriBtn');
  await A.click('#altNav button[data-gor="sohbetler"]');
  // yenile() async redraw → bob satırının Taslak göstergesi kalkana dek bekle
  await A.waitForFunction(()=>{
    const r = [...document.querySelectorAll('#odalar .oda')].find(x=>/@bob/.test(x.textContent));
    return r && !/Taslak:/.test(r.querySelector('.onizle')?.textContent||'');
  }, null, {timeout:8000});
  log('  ✅ [5] gönderince taslak silindi (kutu boş + liste göstergesi kalktı)');

  // [6] taslak SUNUCUYA gitmez — localStorage-only (sunucuda hiçbir taslak izi yok, yalnız gönderilen 1 mesaj)
  const ls = await A.evaluate(()=>localStorage.getItem('narchat_taslak'));
  const carolHalaVar = ls && ls.includes('carol taslağı 42');
  if (!carolHalaVar) throw new Error('❌ [6] carol taslağı localStorage\'da bulunamadı (gönderilmemişti, durmalıydı)');
  log('  ✅ [6] taslaklar yalnız localStorage\'da (sunucuya/E2E\'ye dokunmadı; gönderilmeyen carol taslağı duruyor)');

  // [7] DÜZENLEME taslağı BOZMAZ (ikinci-göz bulgusu #1): bob'ta "gizli taslak" yaz → gönderilmiş mesajı düzenle+yaz+iptal → carol'a geç-dön → taslak HÂLÂ "gizli taslak"
  await A.locator('#odalar .oda', { hasText:'@bob' }).click();
  await odaBaslikBekle(A, 'bob');
  await A.fill('#mesajIn', 'gizli taslak');
  await sleep(150);
  const mid = await A.locator('#akis .msg[data-id]').first().getAttribute('data-id');
  await A.locator(`#akis .msg[data-id="${mid}"]`).dispatchEvent('contextmenu');
  await A.waitForSelector('#mesajMenu', {timeout:5000});
  await A.locator('#mesajMenu .mesaj-menu-btn', { hasText:'Düzenle' }).click();
  await A.waitForSelector('#duzenleBar:not(.gizli)', {timeout:5000});
  await A.type('#mesajIn', 'X');   // düzenleme sırasında yaz (input olayı) — taslağı EZMEMELİ (DUZENLE guard)
  await sleep(150);
  await A.click('#duzenleIptalBtn');
  await sleep(150);
  const editBox = await A.inputValue('#mesajIn');
  if (editBox !== 'gizli taslak') throw new Error(`❌ [7] düzenleme taslağı bozdu: "${editBox}" (beklenen: "gizli taslak")`);
  // carol'a geç-dön: taslak hâlâ korunmalı
  await A.click('#geriBtn'); await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda', { hasText:'@carol' }).click(); await odaBaslikBekle(A, 'carol');
  await A.click('#geriBtn'); await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda', { hasText:'@bob' }).click(); await odaBaslikBekle(A, 'bob');
  const editBox2 = await A.inputValue('#mesajIn');
  if (editBox2 !== 'gizli taslak') throw new Error(`❌ [7] düzenleme sonrası oda-değişiminde taslak kaybı: "${editBox2}"`);
  log('  ✅ [7] düzenleme taslağı bozmuyor (DUZENLE guard) + düzenleme-sonrası taslak geri geliyor');

  // [8] YANIT bağlamı taslakla KALICI (ikinci-göz bulgusu #2): bob mesajına yanıtla+yaz → carol'a geç-dön → hem metin hem #yanitBar geri gelir
  // önce bob'un taslağını temizle (gönder)
  await A.fill('#mesajIn', 'x'); await A.click('#gonderBtn'); await sleep(300);
  const mid2 = await A.locator('#akis .msg[data-id]').first().getAttribute('data-id');
  await A.locator(`#akis .msg[data-id="${mid2}"]`).dispatchEvent('contextmenu');
  await A.waitForSelector('#mesajMenu', {timeout:5000});
  await A.locator('#mesajMenu .mesaj-menu-btn', { hasText:'Yanıtla' }).click();
  await A.waitForSelector('#yanitBar:not(.gizli)', {timeout:5000});
  await A.fill('#mesajIn', 'yanıt taslağı');
  await sleep(150);
  await A.click('#geriBtn'); await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda', { hasText:'@carol' }).click(); await odaBaslikBekle(A, 'carol');
  await A.click('#geriBtn'); await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda', { hasText:'@bob' }).click(); await odaBaslikBekle(A, 'bob');
  const yBox = await A.inputValue('#mesajIn');
  const yBarGizli = await A.locator('#yanitBar').evaluate(el=>el.classList.contains('gizli'));
  if (yBox !== 'yanıt taslağı') throw new Error(`❌ [8] yanıt taslağı metni kayıp: "${yBox}"`);
  if (yBarGizli) throw new Error('❌ [8] yanıt bağlamı (yanitBar) geri gelmedi — sessizce düştü');
  log('  ✅ [8] yanıt taslağı: metin + yanıt bağlamı (#yanitBar) birlikte geri geldi');

  await browser.close();
  log('\n✅ N7 MESAJ TASLAĞI GEÇTİ (izole): oda-başına ayrım · geri-gel · liste göstergesi · reload-kalıcı · gönderince-sil · yerel-only · düzenleme-korumalı · yanıt-bağlamı-kalıcı');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
