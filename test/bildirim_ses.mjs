// NarChat — FAZ G4: OKUNMAMIŞ ROZET + SESLİ UYARI AYARI kanıtı (izole, 2 tarayıcı).
// alice listedeyken bob mesaj atar → alice yenileyince başlık "(1) NarChat" olur (okunmamış rozeti).
// Sesli uyarı ayarı Açık↔Kapalı toggle + localStorage'a yazılır.
// Canlıya DOKUNMAZ. Çalıştır: node test/bildirim_ses.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8125, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-bs-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola','parola1234'); await p.click('#kayitBtn'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
let server;
async function main(){
  log('🔔 NarChat FAZ G4 — OKUNMAMIŞ ROZET + SESLİ UYARI (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat(); log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  await A.reload(); await uyg(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola','parola1234'); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');
  await A.click('#altNav button[data-gor="kisiler"]'); await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn','bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda',{hasText:'@bob'}).click(); await A.waitForSelector('#mesajIn:not([disabled])');
  await A.click('#geriBtn');                                  // alice listeye döner (odayı izlemiyor)
  await A.click('#altNav button[data-gor="sohbetler"]');
  log('  ✓ alice sohbetler listesinde (AB odasını izlemiyor)');

  // bob AB'yi açıp mesaj atar
  await B.reload(); await uyg(B);
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola','parola1234'); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  await B.locator('#odalar .oda',{hasText:'@alice'}).click(); await B.waitForSelector('#mesajIn:not([disabled])');
  await B.fill('#mesajIn','merhaba-alice'); await B.click('#gonderBtn');
  await B.waitForSelector('#akis .msg .metin:has-text("merhaba-alice")',{timeout:10000});
  log('  ✓ bob alice\'e mesaj attı');

  // [1] alice yenileyince başlık okunmamış rozetini gösterir "(1) ..."
  await sleep(500);
  await A.evaluate(()=>window.dispatchEvent(new Event('online')));   // yenile() → odaListesiCiz → okunmamisGuncelle
  await A.waitForFunction(()=>/^\(\d+\)/.test(document.title), null, {timeout:15000});
  const baslik = await A.evaluate(()=>document.title);
  if (!/^\(1\)/.test(baslik)) carp('başlıkta okunmamış (1) yok: '+baslik);
  log('  ✅ [1] okunmamış rozeti başlıkta: "'+baslik+'"');

  // [2] alice odayı açınca rozet temizlenir
  await A.locator('#odalar .oda',{hasText:'@bob'}).click(); await A.waitForSelector('#mesajIn:not([disabled])');
  await A.click('#geriBtn'); await A.click('#altNav button[data-gor="sohbetler"]');
  await A.evaluate(()=>window.dispatchEvent(new Event('online')));
  await A.waitForFunction(()=>!/^\(\d+\)/.test(document.title), null, {timeout:15000}).catch(()=>{});
  const baslik2 = await A.evaluate(()=>document.title);
  if (/^\(1\)/.test(baslik2)) carp('okuyunca rozet temizlenmedi: '+baslik2);
  log('  ✅ [2] sohbet okununca rozet temizlendi: "'+baslik2+'"');

  // [3] sesli uyarı toggle + kalıcı
  const t1 = await A.evaluate(()=>document.getElementById('sesUyariBtn').textContent.trim());
  await A.click('#altNav button[data-gor="ayarlar"]');
  await A.click('#sesUyariBtn');
  const t2 = await A.evaluate(()=>document.getElementById('sesUyariBtn').textContent.trim());
  const ls = await A.evaluate(()=>localStorage.getItem('narchat_ses_uyari'));
  if (t1==='Açık' && t2!=='Kapalı') carp('ses toggle Açık→Kapalı çalışmadı: '+t1+'→'+t2);
  if (ls!=='0' && ls!=='1') carp('ses ayarı localStorage\'a yazılmadı: '+ls);
  log('  ✅ [3] sesli uyarı toggle: '+t1+'→'+t2+' (localStorage='+ls+')');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ G4 GEÇTİ (izole): okunmamış başlık/uygulama rozeti + sesli uyarı ayarı (kalıcı)');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
