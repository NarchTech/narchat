// NarChat — FAZ G1: ÇEVRİMDIŞI GÖNDERİM KUYRUĞU kanıtı (izole, 2 tarayıcı).
// alice offline iken mesaj yazar → optimistik baloncuk (🕓 .iyimser) + yerel kuyruk; bob HENÜZ almaz.
// alice online olunca → kuyruk boşalır → mesaj gider → alice baloncuğu gerçeğe döner (data-id) → bob alır.
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/cevrimdisi_kuyruk.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8122, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kuyruk-'));
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
const kuyrukUz = (page) => page.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('narchat_kuyruk')||'[]').length; } catch { return -1; } });

let server;
async function main(){
  log('📭 NarChat FAZ G1 — ÇEVRİMDIŞI GÖNDERİM KUYRUĞU (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const ctxA = await browser.newContext({ ...iPhone });
  const ctxB = await browser.newContext({ ...iPhone });
  const A = await kayit(ctxA, 'alice');
  const B = await kayit(ctxB, 'bob');
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
  const bOnce = await B.locator('#akis .msg').count();
  log('  ✓ iki taraf ortak odada (bob mevcut msj: '+bOnce+')');

  // ── alice ÇEVRİMDIŞI → mesaj yaz ──
  const METIN = 'cevrimdisi-yazilan-mesaj';
  await ctxA.setOffline(true);
  log('  ⚡ alice çevrimdışı');
  await A.fill('#mesajIn', METIN); await A.click('#gonderBtn');
  // optimistik baloncuk anında görünmeli (🕓 .iyimser)
  await A.waitForSelector(`#akis .msg.iyimser .metin:has-text("${METIN}")`, {timeout:8000});
  await sleep(600);   // fetch'in başarısız olup kuyruğa düşmesi
  const iyimserVar = await A.evaluate((t)=>{
    const el=[...document.querySelectorAll('#akis .msg.iyimser .metin')].find(e=>e.textContent.includes(t));
    return !!el && !el.closest('.msg').hasAttribute('data-id'); }, METIN);
  if (!iyimserVar) carp('optimistik (gönderilmemiş) baloncuk yok');
  const k1 = await kuyrukUz(A);
  if (k1 !== 1) carp('kuyrukta 1 mesaj bekleniyordu, var: '+k1);
  log('  ✅ [1] çevrimdışı: optimistik baloncuk (🕓) + yerel kuyruk='+k1);

  // bob HENÜZ almamalı
  await sleep(800);
  const bSonra = await B.locator('#akis .msg').count();
  if (bSonra !== bOnce) carp('bob çevrimdışı mesajı aldı (olmamalı): '+bOnce+'→'+bSonra);
  log('  ✅ [2] bob henüz almadı (mesaj sunucuya gitmedi)');

  // ── alice ÇEVRİMİÇİ → kuyruk boşalır, mesaj gider ──
  await ctxA.setOffline(false);
  log('  ⚡ alice çevrimiçi → kuyruk gönderiliyor');
  // alice baloncuğu gerçeğe dönmeli: data-id kazanır + .iyimser kalkar
  await A.waitForFunction((t)=>{
    const el=[...document.querySelectorAll('#akis .msg .metin')].find(e=>e.textContent.includes(t));
    return el && el.closest('.msg').hasAttribute('data-id') && !el.closest('.msg').classList.contains('iyimser');
  }, METIN, {timeout:20000});
  log('  ✅ [3] alice baloncuğu gerçeğe döndü (data-id + ✓, optimistik kalktı)');

  await A.waitForFunction(()=>{ try{ return JSON.parse(localStorage.getItem('narchat_kuyruk')||'[]').length===0; }catch{return false;} }, null, {timeout:10000});
  log('  ✅ [4] yerel kuyruk boşaldı');

  // bob artık almalı (E2E çözüldü)
  await B.waitForFunction((t)=>[...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent.includes(t)), METIN, {timeout:20000});
  log('  ✅ [5] bob mesajı aldı + çözdü (online sonrası teslim, E2E korundu)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ G1 ÇEVRİMDIŞI KUYRUK GEÇTİ (izole):');
  log('   • offline yazılan mesaj optimistik baloncuk + kalıcı yerel kuyruk');
  log('   • online olunca otomatik gönderildi → gerçek baloncuk (✓)');
  log('   • karşı taraf online sonrası aldı (E2E korundu)');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
