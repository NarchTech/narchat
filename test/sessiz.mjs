// NarChat — N7: sohbeti sessize al (per-oda mute). İzole, 2 tarayıcı.
// Doğrular: kişi sheet'ten sessize al → localStorage + listede 🔕 + reload'da kalıcı · sessiz odada gelen mesaj
//           BADGE sayısına girer ama SES kararına GİRMEZ (okunmamisToplam(true) hariç tutar) · sesi aç → geri döner.
// Yalnız YEREL — sunucuya/E2E'ye dokunmaz. Çalıştır: HEADLESS=1 node test/sessiz.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8164, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-sessiz-'));
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
const bobSatir = (A) => A.locator('#odalar .oda', { hasText:'@bob' });
// SW'nin Web Push mute için okuduğu IndexedDB aynasını oku (narchat/anahtarlar/'sessiz')
const idbSessizOku = (A) => A.evaluate(()=> new Promise((res)=>{
  try { const r=indexedDB.open('narchat',1);
    r.onupgradeneeded=()=>{ try{ r.result.createObjectStore('anahtarlar'); }catch(_){} };
    r.onerror=()=>res([]);
    r.onsuccess=()=>{ try{ const rq=r.result.transaction('anahtarlar','readonly').objectStore('anahtarlar').get('sessiz'); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>res([]); }catch(_){ res([]); } };
  } catch(_){ res([]); }
}));

let server;
async function main(){
  log('🔕 NarChat N7 — Sohbeti sessize al (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext(), 'alice');
  const B = await kayit(await browser.newContext(), 'bob');
  // alice bob'u ekler + oda açar
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  // bob da alice ile odaya girsin (mesaj gönderebilsin)
  await B.click('#altNav button[data-gor="kisiler"]');
  await B.click('#ekleBtn'); await B.click('#kisiEkleAc');
  await B.fill('#kisiEkleIn', 'alice'); await B.click('#kisiEkleBtn');
  await B.locator('#kisiler .oda', { hasText:'@alice' }).click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice & bob ortak odada');

  // [1] alice başlığa dokun → kişi sheet → "🔕 Sessize al"
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu', {timeout:5000});
  const sesBtn = A.locator('#mesajMenu .mesaj-menu-btn', { hasText:'Sessize al' });
  if (!await sesBtn.count()) carp('[1] "Sessize al" butonu yok');
  await sesBtn.click();
  await sleep(150);
  const ls1 = await A.evaluate(()=>localStorage.getItem('narchat_sessiz'));
  if (!ls1 || !ls1.includes('oda_')) carp('[1] localStorage narchat_sessiz yazılmadı: '+ls1);
  log('  ✅ [1] kişi sheet → Sessize al → localStorage yazıldı');

  // [1b] SW Web Push mute veri kaynağı: IndexedDB aynası da yazıldı (SW localStorage okuyamaz)
  const idb1 = await idbSessizOku(A);
  if (!Array.isArray(idb1) || !idb1.some(x=>String(x).startsWith('oda_'))) carp('[1b] IndexedDB aynası yazılmadı: '+JSON.stringify(idb1));
  log('  ✅ [1b] IndexedDB aynası yazıldı (SW Web Push mute veri kaynağı)');

  // [2] sohbet listesinde 🔕 imi
  await A.click('#geriBtn');   // odadan çık (altNav görünsün)
  await A.click('#altNav button[data-gor="sohbetler"]');
  await A.waitForFunction(()=>{ const r=[...document.querySelectorAll('#odalar .oda')].find(x=>/@bob/.test(x.textContent)); return r && r.querySelector('.sessiz-im'); }, null, {timeout:8000});
  log('  ✅ [2] sohbet listesinde 🔕 (sessiz-im) göründü');

  // [3] reload → kalıcı (🔕 durur)
  await A.reload(); await uygulamaHazir(A);
  await A.waitForSelector('#altNav:not(.gizli)', {timeout:15000});
  await A.waitForFunction(()=>{ const r=[...document.querySelectorAll('#odalar .oda')].find(x=>/@bob/.test(x.textContent)); return r && r.querySelector('.sessiz-im'); }, null, {timeout:8000});
  log('  ✅ [3] reload sonrası sessiz durumu korundu');

  // [4] SES KARARI: bob mesaj gönderir → (arka-oda mesajı listeye canlı düşmez; reload ile tazele) → BADGE sayar ama SES kararına girmez
  await B.fill('#mesajIn', 'sessiz test mesajı'); await B.click('#gonderBtn');
  await sleep(400);
  await A.reload(); await uygulamaHazir(A);
  await A.waitForSelector('#altNav:not(.gizli)', {timeout:15000});
  await A.waitForFunction(()=>{ const r=[...document.querySelectorAll('#odalar .oda')].find(x=>/@bob/.test(x.textContent)); return r && r.querySelector('.rozet'); }, null, {timeout:10000});
  const oku = await A.evaluate(()=>window.__okunmamis);
  if (!oku || oku.toplam < 1) carp('[4] okunmamış toplam bob mesajını saymadı: '+JSON.stringify(oku));
  if (oku.sesli !== 0) carp('[4] sessiz oda SES kararına girdi (sesli!=0): '+JSON.stringify(oku));
  log(`  ✅ [4] sessiz oda: BADGE sayar (toplam=${oku.toplam}) ama SES kararına GİRMEZ (sesli=${oku.sesli})`);

  // [5] Sesi aç → 🔕 kalkar + localStorage boşalır
  await bobSatir(A).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  await A.click('#odaBaslikSar');
  await A.waitForSelector('#mesajMenu', {timeout:5000});
  await A.locator('#mesajMenu .mesaj-menu-btn', { hasText:'Sesi aç' }).click();
  await sleep(150);
  await A.click('#geriBtn');   // odadan çık
  await A.click('#altNav button[data-gor="sohbetler"]');
  const ls2 = await A.evaluate(()=>localStorage.getItem('narchat_sessiz'));
  if (ls2 && ls2.includes('oda_')) carp('[5] sesi açınca localStorage temizlenmedi: '+ls2);
  const imVar = await A.evaluate(()=>{ const r=[...document.querySelectorAll('#odalar .oda')].find(x=>/@bob/.test(x.textContent)); return r && !!r.querySelector('.sessiz-im'); });
  if (imVar) carp('[5] sesi açınca 🔕 imi kalkmadı');
  const idb2 = await idbSessizOku(A);
  if (Array.isArray(idb2) && idb2.some(x=>String(x).startsWith('oda_'))) carp('[5] sesi açınca IndexedDB aynası temizlenmedi: '+JSON.stringify(idb2));
  log('  ✅ [5] Sesi aç → 🔕 kalktı + localStorage + IndexedDB aynası boşaldı');

  await browser.close();
  log('\n✅ N7 SESSİZE AL GEÇTİ (izole): sheet-toggle · localStorage · liste 🔕 · reload-kalıcı · ses-kararından-hariç · geri-al');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n'+(e.message||e)); server?.proc.kill(); process.exit(1); });
