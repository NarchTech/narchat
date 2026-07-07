// NarChat — N7: RENK TEMASI VARYANTLARI (nar/okyanus/orman). İzole, tek tarayıcı (görsel tercih, sunucu-nötr).
// Doğrular: Ayarlar'da 3 seçenek · seç → data-palet + --primary değişir + .aktif · reload'da KALICI · nar'a dön → sıfırlar.
// Canlıya DOKUNMAZ. Çalıştır: HEADLESS=1 node test/renk_temasi.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8169, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const NAR='#a51d35', OKYANUS='#0e7490', ORMAN='#15803d';
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-palet-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
const primary = (p) => p.evaluate(()=> getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase());
const palet   = (p) => p.evaluate(()=> document.documentElement.getAttribute('data-palet'));
let server;
async function main(){
  log('🎨 NarChat N7 — RENK TEMASI VARYANTLARI (izole)\n');
  server = await sunucuBaslat(); log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const ctx = await browser.newContext({ ...iPhone, colorScheme:'light' });   // light sabitle → --primary deterministik
  const A = await ctx.newPage(); await A.goto(BASE+'/'); await uyg(A);
  await A.fill('#gKullanici','alice'); await A.fill('#gParola','parola1234'); await A.click('#kayitBtn');
  await A.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  await A.click('#altNav button[data-gor="ayarlar"]');
  await A.waitForSelector('#paletSegment', {timeout:6000});

  // [1] 3 seçenek + varsayılan nar (data-palet yok, --primary nar bordosu)
  if (await A.locator('#paletSegment button').count() !== 3) carp('[1] palet seçeneği 3 değil');
  if (await palet(A) !== null) carp('[1] varsayılan data-palet null olmalı (nar), gelen: '+await palet(A));
  if (await primary(A) !== NAR) carp('[1] varsayılan --primary nar değil: '+await primary(A));
  log('  ✅ [1] 3 seçenek · varsayılan nar (--primary='+NAR+')');

  // [2] Okyanus seç → data-palet=okyanus + --primary okyanus + buton .aktif
  await A.locator('#paletSegment button[data-palet="okyanus"]').click();
  if (await palet(A) !== 'okyanus') carp('[2] data-palet okyanus değil: '+await palet(A));
  if (await primary(A) !== OKYANUS) carp('[2] --primary okyanus değil: '+await primary(A));
  if (!await A.locator('#paletSegment button[data-palet="okyanus"].aktif').count()) carp('[2] okyanus butonu .aktif değil');
  log('  ✅ [2] Okyanus → data-palet=okyanus · --primary='+OKYANUS+' · .aktif');

  // [3] reload → KALICI
  await A.reload(); await uyg(A);
  if (await palet(A) !== 'okyanus') carp('[3] reload sonrası okyanus kaybı: '+await palet(A));
  if (await primary(A) !== OKYANUS) carp('[3] reload sonrası --primary okyanus değil: '+await primary(A));
  log('  ✅ [3] reload → okyanus kalıcı (localStorage)');

  // [4] Nar'a dön → data-palet sıfırlanır + --primary nar
  await A.click('#altNav button[data-gor="ayarlar"]');
  await A.locator('#paletSegment button[data-palet="nar"]').click();
  if (await palet(A) !== null) carp('[4] nar seçilince data-palet kalkmadı: '+await palet(A));
  if (await primary(A) !== NAR) carp('[4] --primary nar\'a dönmedi: '+await primary(A));
  log('  ✅ [4] Nar → data-palet sıfırlandı · --primary='+NAR);

  // [5] Orman seç → 2. varyant da çalışır
  await A.locator('#paletSegment button[data-palet="orman"]').click();
  if (await primary(A) !== ORMAN) carp('[5] --primary orman değil: '+await primary(A));
  log('  ✅ [5] Orman → --primary='+ORMAN);

  // [6] KOYU tema × palet cascade doğru: dark okyanus değeri gelir (light okyanus/nar-dark DEĞİL)
  const ctxD = await browser.newContext({ ...iPhone, colorScheme:'dark' });
  const D = await ctxD.newPage(); await D.goto(BASE+'/'); await uyg(D);
  await D.fill('#gKullanici','aylin'); await D.fill('#gParola','parola1234'); await D.click('#kayitBtn');
  await D.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  await D.click('#altNav button[data-gor="ayarlar"]'); await D.waitForSelector('#paletSegment', {timeout:6000});
  await D.locator('#paletSegment button[data-palet="okyanus"]').click();
  const pD = await primary(D);
  if (pD === OKYANUS) carp('[6] koyu temada LIGHT okyanus değeri geldi (cascade hatası): '+pD);
  if (pD !== '#1b93ad') carp('[6] koyu okyanus --primary #1b93ad değil: '+pD);
  log('  ✅ [6] koyu tema × palet cascade doğru (--primary=#1b93ad, light/nar-dark değil)');

  await browser.close();
  log('\n✅ N7 RENK TEMASI VARYANTLARI GEÇTİ (izole): 3 seçenek · seç→--primary değişir · reload-kalıcı · nar-sıfırla');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
