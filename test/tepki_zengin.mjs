// NarChat — N7: emoji tepki ZENGİNLEŞTİRME (izole). Tepki seçicide ➕ → genişleyen grid → HERHANGİ emoji ile tepki.
// Doğrular: hızlı-6 + ➕ var · ➕→geniş grid açılır · genişten '🔥' seç → karşı tarafta '🔥' çipi (E2E, SSE).
// Canlıya DOKUNMAZ. Çalıştır: HEADLESS=1 node test/tepki_zengin.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8168, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-tepkiz-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p };
}
async function uyg(p){ await p.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
async function kayit(ctx, u){ const p=await ctx.newPage(); await p.goto(BASE+'/'); await uyg(p); await p.fill('#gKullanici',u); await p.fill('#gParola','parola1234'); await p.click('#kayitBtn'); await p.click('#kayitOnayTamam'); await p.waitForSelector('#sohbet:not(.gizli)',{timeout:20000}); return p; }
let server;
async function main(){
  log('😀 NarChat N7 — Emoji tepki ZENGİNLEŞTİRME (izole)\n');
  server = await sunucuBaslat(); log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const a = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const b = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  await a.click('#altNav button[data-gor="kisiler"]'); await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn','bob'); await a.click('#kisiEkleBtn');
  await a.locator('#kisiler .oda',{hasText:'@bob'}).click(); await a.waitForSelector('#mesajIn:not([disabled])');
  const HEDEF='zengin tepki testi';
  await a.fill('#mesajIn', HEDEF); await a.click('#gonderBtn');
  await a.waitForFunction((s)=>document.getElementById('akis')?.textContent.includes(s), HEDEF, {timeout:12000});
  await b.reload(); await uyg(b);
  const bobOda = b.locator('#odalar .oda').first(); await bobOda.waitFor({timeout:12000}); await bobOda.click();
  await b.waitForFunction((s)=>document.getElementById('akis')?.textContent.includes(s), HEDEF, {timeout:12000});
  const mid = await b.locator('#akis .msg:not(.ben)').last().getAttribute('data-id');
  if (!mid) carp('hedef mesaj id alınamadı');
  log('  ✓ kurulum tamam (mid='+mid+')');

  // tepki seçiciyi aç
  await b.locator(`#akis .msg[data-id="${mid}"] .tepkiBtn`).click();
  await b.waitForSelector('.tepki-sec-pop', {timeout:8000});

  // [1] hızlı-6 + ➕ var; genişletilmiş grid başta GİZLİ
  const hizli = await b.locator('.tepki-sec-hizli button:not(.tepki-sec-arti)').count();
  if (hizli !== 6) carp('[1] hızlı tepki sayısı 6 değil: '+hizli);
  if (!await b.locator('.tepki-sec-arti').count()) carp('[1] ➕ (daha fazla) butonu yok');
  if (await b.locator('.tepki-sec-genis:not(.gizli)').count()) carp('[1] genişletilmiş grid başta açık olmamalı');
  log('  ✅ [1] hızlı-6 + ➕ butonu · genişletilmiş grid başta gizli');

  // [2] ➕ → genişletilmiş grid açılır (butonlu)
  await b.locator('.tepki-sec-arti').click();
  await b.waitForSelector('.tepki-sec-genis:not(.gizli)', {timeout:4000});
  const genisSay = await b.locator('.tepki-sec-genis button').count();
  if (genisSay < 10) carp('[2] genişletilmiş grid yetersiz emoji: '+genisSay);
  if (await b.locator('.tepki-sec-arti').getAttribute('aria-expanded') !== 'true') carp('[2] aria-expanded true değil');
  log('  ✅ [2] ➕ → genişletilmiş grid açıldı ('+genisSay+' emoji, aria-expanded=true)');

  // [3] genişten '🔥' seç → karşı tarafta (alice) '🔥' çipi (E2E, SSE)
  await b.locator('.tepki-sec-genis button', {hasText:'🔥'}).click();
  await a.waitForFunction((mid)=>{ const el=document.querySelector(`#akis .msg[data-id="${mid}"] .tepki-satiri`); return el && el.textContent.includes('🔥'); }, mid, {timeout:12000});
  log('  ✅ [3] genişletilmiş "🔥" tepkisi → alice\'te çip canlı (E2E/SSE)');

  await browser.close();
  log('\n✅ N7 EMOJİ TEPKİ ZENGİNLEŞTİRME GEÇTİ (izole): hızlı-6 + ➕ genişleyen grid + herhangi-emoji tepki (E2E)');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); }).catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
