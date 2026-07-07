// NarChat — FAZ H3: mesaj sayfalama (performans). İzole, 1 tarayıcı.
// 55 mesaj gönder → sohbeti yeniden aç: açılışta SON 50 yüklenir + "↑ daha eski" butonu → tıkla → tümü (55) yüklenir.
// Sunucu /api/mesajlar?limit=N son N'i döner (E2E ciphertext; içerik değişmez). Çalıştır: HEADLESS=1 node test/sayfalama.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8134, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-syf-'));
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
const msgSay = (page) => page.evaluate(()=>document.querySelectorAll('#akis .msg').length);

let server;
async function main(){
  log('📄 NarChat FAZ H3 — mesaj sayfalama (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  await kayit(await browser.newContext({ ...iPhone }), 'bob');
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice→bob sohbet açık');

  // 55 mesaj gönder
  const N = 55;
  for (let i=1;i<=N;i++){ await A.fill('#mesajIn', 'mesaj '+i); await A.click('#gonderBtn'); await sleep(45); }
  await sleep(600);
  log('  ✓ '+N+' mesaj gönderildi');

  // sohbeti yeniden aç (geri → sohbetler sekmesi → tekrar gir) → ilkSayfaYukle (son 50)
  await A.click('#geriBtn');
  await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda').first().click();
  await A.waitForSelector('#akis .msg', {timeout:8000});
  await sleep(400);
  const ilk = await msgSay(A);
  if (ilk > SAYFA_BEK) throw new Error('❌ açılışta '+ilk+' mesaj yüklendi (≤'+SAYFA_BEK+' bekleniyor — sayfalama çalışmıyor)');
  const btnVar = await A.evaluate(()=>!!document.getElementById('dahaEskiBtn'));
  if (!btnVar) throw new Error('❌ "daha eski" butonu yok (55>50 olduğu hâlde)');
  log('  ✅ açılışta yalnız son '+ilk+' mesaj + "↑ daha eski" butonu (tümü değil)');

  // son mesaj (mesaj 55) görünür, ilk mesaj (mesaj 1) henüz DEĞİL
  const son55 = await A.evaluate(()=>[...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent==='mesaj 55'));
  const ilk1yok = await A.evaluate(()=>![...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent==='mesaj 1'));
  if (!son55) throw new Error('❌ en yeni mesaj (55) görünmüyor');
  if (!ilk1yok) throw new Error('❌ en eski mesaj (1) sayfalanmadan yüklendi');
  log('  ✅ en yeni (55) yüklü, en eski (1) henüz yüklü değil');

  // [daha eski] → tüm geçmiş
  await A.click('#dahaEskiBtn');
  await A.waitForFunction(()=>[...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent==='mesaj 1'), null, {timeout:8000});
  const hepsi = await msgSay(A);
  if (hepsi !== N) throw new Error('❌ daha-eski sonrası '+hepsi+' mesaj ('+N+' bekleniyor)');
  if (await A.evaluate(()=>!!document.getElementById('dahaEskiBtn'))) throw new Error('❌ tümü yüklenince buton kalkmadı');
  log('  ✅ "daha eski" → tüm '+hepsi+' mesaj yüklendi + buton kalktı');

  await browser.close();
  log('\n✅ FAZ H3 SAYFALAMA GEÇTİ (izole): açılış son 50 (hız) · daha-eski → tümü · E2E içerik korunur');
}
const SAYFA_BEK = 50;
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
