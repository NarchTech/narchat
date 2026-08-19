// NarChat — Açılış splash / giriş-flash regresyon kanıtı (izole).
// Hata (önce): #girisEkran varsayılan GÖRÜNÜR → boot oturum kontrolü biterken (~1sn) giriş
//   ekranı flash'lıyordu (Tayfun 27 Haz). Fix: markalı #splash + #girisEkran varsayılan gizli;
//   boot doğru ekranı açar. Bu test: (1) ham HTML'de giriş 'gizli' + splash var (flash imkânsız),
//   (2) oturumsuz boot → giriş açılır, (3) cihaz modunda reload → app açılır, giriş HİÇ görünmez.
// Çalıştır: node test/acilis_splash.mjs  (HEADLESS=1 sessiz)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8116, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-splash-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }

let server;
async function main(){
  log('🎬 NarChat — Açılış splash / flash regresyon (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);

  // (1) HAM HTML: giriş varsayılan gizli + splash var → flash yapısal olarak imkânsız
  const ham = await (await fetch(BASE+'/')).text();
  if (!/id="splash"/.test(ham)) throw new Error('❌ #splash ham HTML\'de yok');
  if (!/class="orta gizli" id="girisEkran"/.test(ham)) throw new Error('❌ #girisEkran varsayılan gizli değil (flash riski)');
  log('  ✅ ham HTML: #splash var + #girisEkran varsayılan "gizli" (raw login flash yok)');

  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });

  // (2) oturumsuz boot → splash sonrası GİRİŞ açılır
  const c1 = await browser.newContext();
  const p1 = await c1.newPage();
  await p1.goto(BASE+'/');
  await p1.waitForSelector('#girisEkran:not(.gizli)', {timeout:15000});
  const splashGizli = await p1.evaluate(()=>document.getElementById('splash').classList.contains('gizli'));
  if (!splashGizli) throw new Error('❌ giriş açıldı ama splash kapanmadı');
  log('  ✅ oturumsuz: boot → giriş ekranı açıldı, splash kapandı');

  // kayıt ol (cihaz modu — anahtar IndexedDB'de, parolasız açılır)
  await uygulamaHazir(p1);
  await p1.fill('#gKullanici', 'alice'); await p1.fill('#gParola', PAROLA);
  await p1.click('#kayitBtn'); await p1.click('#kayitOnayTamam'); await p1.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  log('  ✓ alice kayıt (cihaz modu)');

  // (3) reload (cihaz modu) → app açılır, giriş ekranı HİÇ görünmez (flash yok)
  let girisGorundu = false;
  p1.on('framenavigated', ()=>{});
  await p1.reload();
  // boot bitene dek sık sık yokla: #girisEkran asla görünür olmamalı
  const t0 = Date.now();
  while (Date.now() - t0 < 6000){
    const g = await p1.evaluate(()=>{
      const ge=document.getElementById('girisEkran');
      const sh=document.getElementById('sohbet');
      return { girisAcik: ge && !ge.classList.contains('gizli'), sohbetAcik: sh && !sh.classList.contains('gizli') };
    });
    if (g.girisAcik) girisGorundu = true;
    if (g.sohbetAcik) break;
    await sleep(60);
  }
  await p1.waitForSelector('#sohbet:not(.gizli)', {timeout:10000});
  if (girisGorundu) throw new Error('❌ reload sırasında giriş ekranı FLASH yaptı (cihaz modunda görünmemeliydi)');
  log('  ✅ cihaz-modu reload: app açıldı, giriş ekranı HİÇ flash yapmadı');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ AÇILIŞ SPLASH / FLASH FIX GEÇTİ (izole):');
  log('   • ham HTML: giriş varsayılan gizli + splash var (yapısal flash yok)');
  log('   • oturumsuz: splash → giriş (temiz geçiş)');
  log('   • cihaz-modu reload: splash → app, giriş ekranı hiç görünmedi');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
