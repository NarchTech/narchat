// NarChat — FAZ N2: NARC- kod self-servis, GERÇEK tarayıcı UI üzerinden (kod.html + kayıt formu).
// davet_test.py sunucu-tarafı mantığı (tavan/TTL/replay) zaten kanıtlıyor; bu test UÇTAN UCA UI akışını kanıtlar:
//   1) musluk KAPALIYKEN (varsayılan) kod.html nazikçe "kapalı" mesajı gösterir.
//   2) musluk AÇIKKEN: kod.html'den "kod al" → NARC-XXXX-XXXX görünür → ana uygulamada o kodla kayıt olunur.
// Çalıştır:  HEADLESS=1 node test/narc_kod_ui.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sunucuBaslat(port, extraEnv){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-narckod-'));
  if (extraEnv && extraEnv.SILAHLI){
    await mkdir(veri, { recursive: true });
    await writeFile(join(veri, 'davetler.json'), JSON.stringify({ kodlar: [], kullanilmis: {}, otokodlar: {} }));
  }
  const env = { ...process.env, NARCHAT_PORT: String(port), NARCHAT_VERI: veri };
  if (extraEnv?.NARCHAT_KOD_ACIK) env.NARCHAT_KOD_ACIK = extraEnv.NARCHAT_KOD_ACIK;
  const p = spawn('python3', [join(KOK,'mesaj_server.py')], { env, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  const BASE = `http://127.0.0.1:${port}`;
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri, BASE };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }

let s1, s2;
async function main(){
  const HEADLESS = process.env.HEADLESS === '1';
  log('🎫 NarChat "NARC- kod self-servis" — GERÇEK UI (Playwright' + (HEADLESS?', headless':', HEADFUL') + ')\n');
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });

  log('1) musluk KAPALIYKEN (varsayılan): kod.html "kapalı" mesajı gösterir:');
  s1 = await sunucuBaslat(8142, { SILAHLI:true });
  const p1 = await browser.newPage();
  await p1.goto(s1.BASE + '/kod.html');
  await p1.click('#kodAlBtn');
  await p1.waitForSelector('#kodAlBtn:not([disabled])', { timeout: 8000 });   // istek tamamlandı (finally bloğu)
  const durum1 = await p1.textContent('#kodDurum');
  if (!durum1.includes('kapalı')) carp('musluk kapalıyken beklenen "kapalı" mesajı yok: ' + durum1);
  const kutuGizli = await p1.evaluate(()=>document.getElementById('kodKutu').classList.contains('gizli'));
  if (!kutuGizli) carp('musluk kapalıyken kod kutusu görünür olmamalı');
  await p1.close();
  log('  ✅ musluk kapalıyken kod.html nazikçe "kapalı" mesajı gösterdi, kod üretmedi');

  log('\n2) musluk AÇIKKEN: kod.html\'den kod al → ana uygulamada o kodla kayıt ol:');
  s2 = await sunucuBaslat(8143, { SILAHLI:true, NARCHAT_KOD_ACIK:'1' });
  const p2 = await browser.newPage();
  await p2.goto(s2.BASE + '/kod.html');
  await p2.click('#kodAlBtn');
  await p2.waitForSelector('#kodKutu:not(.gizli)', { timeout: 10000 });
  const kod = await p2.textContent('#kodMetin');
  if (!kod || !kod.startsWith('NARC-')) carp('kod.html kod üretmedi: ' + kod);
  log('  ✅ kod.html kod üretti: ' + kod);

  await p2.goto(s2.BASE + '/'); await uygulamaHazir(p2);
  await p2.fill('#gKullanici', 'yenikullanici');
  await p2.fill('#gParola', 'parola1234');
  await p2.fill('#gDavet', kod);
  await p2.click('#kayitBtn');
  await p2.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ üretilen kodla ana uygulamada kayıt başarılı (sohbet ekranına girdi)');

  // aynı kod tekrar kullanılamaz (UI üzerinden de doğrula)
  await p2.click('#altNav button[data-gor="ayarlar"]');
  await p2.click('#cikisBtn');
  await p2.waitForSelector('#girisEkran:not(.gizli)', { timeout: 10000 });
  await p2.fill('#gKullanici', 'ikincikullanici');
  await p2.fill('#gParola', 'parola1234');
  await p2.fill('#gDavet', kod);
  await p2.click('#kayitBtn');
  await p2.waitForFunction(()=>document.getElementById('gHata')?.textContent?.length>0, null, {timeout:8000});
  const hata = await p2.textContent('#gHata');
  if (!hata) carp('kullanılmış kodla tekrar kayıt reddedilmedi');
  log('  ✅ aynı kod ikinci kez reddedildi (UI): "' + hata + '"');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ NARC- KOD SELF-SERVİS (UI) GEÇTİ:');
  log('   • musluk kapalıyken kod.html sessizce nazik mesaj verir, kod üretmez');
  log('   • musluk açıkken kod.html\'den alınan kodla ana uygulamada uçtan-uca kayıt olunur');
  log('   • aynı kod ikinci kez reddedilir (tek-kullanımlık, UI üzerinden de doğrulandı)');
  log('══════════════════════════════════════════');
}
main().then(()=>{ s1?.proc?.kill('SIGKILL'); s2?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); s1?.proc?.kill('SIGKILL'); s2?.proc?.kill('SIGKILL'); process.exit(1); });
