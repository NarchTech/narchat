// NarChat — sıfır-bilgi auth v2, GERÇEK tarayıcı UI üzerinden (FAZ N1).
// auth_v2_test.py sunucu tarafını kanıtlar; bu test istemci tarafını (auth.js + girisYap) kanıtlar:
//   1) UI'dan kayıt (yeni hesap = v2) → çıkış → AYNI parolayla yeniden giriş → sohbete girer.
//   2) Ağ üzerinde /api/giris isteğinin gövdesinde PAROLA YOK (yalnız meydan+imza) — gerçek ağ trafiği taranarak.
// Çalıştır:  HEADLESS=1 node test/auth_v2_ui.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8148;   // 8137 başka bir filo projesiyle (ANI/mvp) çakıştı — bkz N3 ders notu
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const KULLANICI = 'ayse';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-authui-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await new Promise(r=>setTimeout(r,100)); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }

let server;
async function main(){
  log('🔐 NarChat "Sıfır-bilgi auth v2" — GERÇEK UI (Playwright' + (HEADLESS?', headless':', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);

  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const page = await browser.newPage();

  // Ağ trafiğini izle: /api/kayit ve /api/giris isteklerinin HAM gövdesinde parola metni görünmemeli.
  const gozlenenler = [];
  page.on('request', req => {
    if (req.url().includes('/api/kayit') || req.url().includes('/api/giris')){
      gozlenenler.push({ url: req.url(), govde: req.postData() || '' });
    }
  });

  await page.goto(BASE + '/'); await uygulamaHazir(page);

  log('1) UI\'dan yeni hesap oluştur (v2 kayıt):');
  await page.fill('#gKullanici', KULLANICI);
  await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ kayıt oldu, sohbet ekranına girdi');

  const kayitIstek = gozlenenler.find(g => g.url.includes('/api/kayit'));
  if (!kayitIstek) carp('/api/kayit isteği yakalanamadı');
  if (kayitIstek.govde.includes(PAROLA)) carp('KAYIT gövdesinde PAROLA metni bulundu — sıfır-bilgi ihlali!');
  if (!kayitIstek.govde.includes('dogrulayici')) carp('kayıt gövdesinde doğrulayıcı yok: ' + kayitIstek.govde);
  log('  ✅ [gizlilik] /api/kayit gövdesinde parola YOK, yalnız doğrulayıcı var');

  log('\n2) Çıkış yap → yeniden AYNI parolayla giriş (v2 meydan/imza akışı):');
  await page.click('#altNav button[data-gor="ayarlar"]');
  await page.click('#cikisBtn');
  await page.waitForSelector('#girisEkran:not(.gizli)', { timeout: 10000 });
  gozlenenler.length = 0;   // yeni ölçüm penceresi — yalnız girişi izleyeceğiz
  await page.fill('#gKullanici', KULLANICI);
  await page.fill('#gParola', PAROLA);
  await page.click('#girisBtn');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  log('  ✅ yeniden giriş başarılı (sohbet ekranına döndü)');

  const girisIstek = gozlenenler.find(g => g.url.includes('/api/giris') && !g.url.includes('meydan'));
  if (!girisIstek) carp('/api/giris isteği yakalanamadı');
  if (girisIstek.govde.includes(PAROLA)) carp('GİRİŞ gövdesinde PAROLA metni bulundu — sıfır-bilgi ihlali!');
  const gb = JSON.parse(girisIstek.govde);
  if (!gb.meydan || !gb.imza) carp('giriş gövdesinde meydan/imza yok: ' + girisIstek.govde);
  log('  ✅ [gizlilik] /api/giris gövdesinde parola YOK — yalnız {kullanici,meydan,imza} gitti');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ SIFIR-BİLGİ AUTH v2 (UI) GEÇTİ:');
  log('   • UI\'dan kayıt → v2 (doğrulayıcı) — parola sunucuya gitmedi');
  log('   • çıkış + yeniden giriş → meydan/imza ile — parola YİNE gitmedi');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
