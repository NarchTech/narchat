// NarChat — FAZ H3 cila: mesajda tıklanabilir link (XSS-güvenli). İzole, 1 tarayıcı (kendi baloncuğu yeter).
// Doğrular: http(s) URL → <a href esc, target=_blank, rel=noopener> · HTML/<script>/javascript: ESCAPE (XSS yok).
// Çalıştır: HEADLESS=1 node test/link.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8132, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-link-'));
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

let server;
async function main(){
  log('🔗 NarChat FAZ H3 — tıklanabilir link (XSS-güvenli, izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  // alice → bob 1:1
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice→bob sohbet açık');

  // [1] http link → tıklanabilir <a>
  await A.fill('#mesajIn', 'bak şu site https://example.com/yol?a=1&b=2 güzel');
  await A.click('#gonderBtn');
  await A.waitForSelector('#akis .msg .metin a', {timeout:8000});
  const a = await A.evaluate(()=>{ const x=document.querySelector('#akis .msg .metin a'); return {href:x.getAttribute('href'), rel:x.getAttribute('rel'), tgt:x.getAttribute('target'), txt:x.textContent}; });
  if (a.href !== 'https://example.com/yol?a=1&b=2') throw new Error('❌ link href yanlış: '+a.href);
  if (!/noopener/.test(a.rel||'') || a.tgt!=='_blank') throw new Error('❌ link güvenlik attr eksik: rel='+a.rel+' target='+a.tgt);
  log('  ✅ http link tıklanabilir: '+a.href+' (rel="'+a.rel+'" target='+a.tgt+')');

  // [2] XSS: HTML + javascript: şema → ESCAPE, link DEĞİL
  await A.fill('#mesajIn', "tehlike <img src=x onerror=alert(1)> javascript:alert(2) <b>kalın</b>");
  await A.click('#gonderBtn');
  await sleep(600);
  const son = await A.evaluate(()=>{
    const ms = document.querySelectorAll('#akis .msg .metin'); const el = ms[ms.length-1];
    return { html: el.innerHTML, imgVar: !!el.querySelector('img'), bVar: !!el.querySelector('b'), aVar: !!el.querySelector('a') };
  });
  if (son.imgVar || son.bVar) throw new Error('❌ XSS! HTML escape edilmedi: '+son.html);
  if (son.aVar) throw new Error('❌ javascript: şema link yapıldı (güvensiz): '+son.html);
  if (!son.html.includes('&lt;img')) throw new Error('❌ < karakteri esc edilmedi: '+son.html);
  log('  ✅ XSS güvenli: HTML/<script>/javascript: kaçışlandı, link yapılmadı');

  await browser.close();
  log('\n✅ FAZ H3 LİNK GEÇTİ (izole): http(s) tıklanabilir + XSS güvenli');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
