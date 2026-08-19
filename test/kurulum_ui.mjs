// NarChat — PWA kurulum yardımcısı + kayıt-onayı testi (izole).
// Hata (önce): kurulum tamamen tarayıcının minik adres-çubuğu ikonuna kalmıştı — kullanıcılar
//   "Ana Ekrana Ekle"yi bulamıyordu (Tayfun 24 Tem); iOS'ta Safari 7-gün depolama silmesi
//   anahtar kaybı = konuşmaların GERİ GETİRİLEMEZ kaybı demekti ve hiçbir uyarı yoktu; kayıt,
//   geri-dönüşsüz kurallar (parola kurtarılamaz / anahtar cihazda) kabul ettirilmeden açılıyordu.
// RED-KANIT: HEAD~'de kurulumBanner/kayitOnay/iosRehber/kayitOnayIste YOK (grep=0) → bu test eski kodda kırmızı.
// Bu test: (1) ham HTML'de banner+onay+rehberler+sürümler, (2) sw.js KABUK listesi index.html
//   sürümleriyle SENKRON (drift bekçisi), (3) masaüstünde banner→masaüstü rehberi açılır,
//   (4) iOS UA'da banner→iOS rehberi (7-gün + önce-kur metinleri) açılır,
//   (5) kayıt düğmesi /api/kayit'a GİTMEDEN önce onay modalı; Vazgeç=istek yok, Anladım=istek gider.
// Çalıştır: node test/kurulum_ui.mjs  (HEADLESS=1 sessiz)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8127, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kurulum-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }

let server;
async function main(){
  log('🎬 NarChat — PWA kurulum yardımcısı + kayıt-onayı (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);

  // (1) HAM HTML: yeni öğeler + sürümler
  const ham = await (await fetch(BASE+'/')).text();
  for (const [ne, desen] of [
    ['#kurulumBanner (varsayılan gizli)', /class="kurulum-banner gizli" id="kurulumBanner"/],
    ['#kayitOnay modalı',                 /id="kayitOnay"/],
    ['#iosRehber overlay',                /id="iosRehber"/],
    ['#masaRehber overlay',               /id="masaRehber"/],
    ['iOS 7-gün uyarısı',                 /7 gün[\s\S]*?silebilir/],
    ['geri-getirilemezlik cümlesi',       /hiç kimse, hiçbir teknoloji geri getiremez/],
    ['önce-kur-sonra-kayıt sırası',       /ÖNCE kur[\s\S]*?KURULU uygulamada/],
    ['Safari-kurtarma yolu (cihaz bağla)',/yanlışlıkla önce Safari/],
    ['hesap-detay açıklayıcısı',          /id="hesapDetay"/],
    ['kurulum.js include',                /src="\/kurulum\.js\?v=\d+"/],
  ]){
    if (!desen.test(ham)) throw new Error('❌ ham HTML: ' + ne + ' yok');
  }
  log('  ✓ (1) ham HTML: banner + onay modalı + iOS/masaüstü rehberleri + uyarı metinleri');

  // (2) sw.js KABUK ↔ index.html sürüm SENKRONU (bayat-önbellek drift bekçisi)
  const sw = await readFile(join(KOK,'static','sw.js'),'utf8');
  const kabuk = (sw.match(/KABUK = \[([\s\S]*?)\]/)||[])[1] || '';
  for (const m of ham.matchAll(/(?:src|href)="\/([\w.-]+\.(?:js|css))\?v=(\d+)"/g)){
    const [, dosya, v] = m;
    if (!kabuk.includes(`/${dosya}?v=${v}`)) throw new Error(`❌ sw.js KABUK bayat: /${dosya}?v=${v} listede yok`);
  }
  log('  ✓ (2) sw.js KABUK listesi index.html sürümleriyle senkron');

  const browser = await chromium.launch({ headless: HEADLESS });

  // (3) MASAÜSTÜ: banner görünür → masaüstü rehberi açılır
  {
    const page = await browser.newPage();
    await page.goto(BASE); await uygulamaHazir(page);
    await page.waitForSelector('#kurulumBanner:not(.gizli)', {timeout:8000});
    await page.click('#masaRehberBtn');
    await page.waitForSelector('#masaRehber:not(.gizli)', {timeout:4000});
    await page.click('#masaRehberKapat');
    await page.waitForFunction(() => document.getElementById('masaRehber').classList.contains('gizli'), null, {timeout:4000});
    log('  ✓ (3) masaüstü: kurulum banner\'ı + rehber aç/kapa');
    await page.close();
  }

  // (4) iOS UA: iOS rehber düğmesi → rehber açılır, kritik metinler görünür
  {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      viewport: {width:390, height:844}, hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto(BASE); await uygulamaHazir(page);
    await page.waitForSelector('#iosRehberBtn', {timeout:8000});
    const bannerMetin = await page.textContent('#kurulumBanner');
    if (!/önce kur, sonra kayıt ol/.test(bannerMetin)) throw new Error('❌ iOS banner\'ında sıra-uyarısı yok');
    await page.click('#iosRehberBtn');
    await page.waitForSelector('#iosRehber:not(.gizli)', {timeout:4000});
    const rehber = await page.textContent('#iosRehber');
    for (const metin of ['7 gün', 'geri getiremez', 'Ana Ekrana Ekle', 'ayrı depolama', 'Yeni cihaz bağla']){
      if (!rehber.includes(metin)) throw new Error('❌ iOS rehberinde eksik: ' + metin);
    }
    // Safari UA'dayız → "Safari değilsin" notu GİZLİ kalmalı
    const notGizli = await page.$eval('#iosSafariDegilNot', el => el.classList.contains('gizli'));
    if (!notGizli) throw new Error('❌ Safari UA\'da "Safari değilsin" notu yanlışlıkla görünür');
    await page.click('#iosRehberKapat');
    await page.waitForFunction(() => document.getElementById('iosRehber').classList.contains('gizli'), null, {timeout:4000});
    log('  ✓ (4) iOS: rehber düğmesi + 7-gün/geri-getirilemez/adımlar/kurtarma metinleri');
    await ctx.close();
  }

  // (5) KAYIT-ONAYI: modal /api/kayit'tan ÖNCE; Vazgeç=istek yok, Anladım=istek gider
  {
    const page = await browser.newPage();
    let kayitIstek = 0;
    page.on('request', r => { if (r.url().includes('/api/kayit')) kayitIstek++; });
    await page.goto(BASE); await uygulamaHazir(page);
    await page.fill('#gKullanici', 'onaytest');
    await page.fill('#gParola', 'parola1234');
    await page.click('#kayitBtn');
    await page.waitForSelector('#kayitOnay:not(.gizli)', {timeout:4000});
    if (kayitIstek !== 0) throw new Error('❌ onay modalından ÖNCE /api/kayit isteği gitti');
    await page.click('#kayitOnayVazgec');
    await page.waitForFunction(() => document.getElementById('kayitOnay').classList.contains('gizli'), null, {timeout:4000});
    await sleep(300);
    if (kayitIstek !== 0) throw new Error('❌ Vazgeç\'e rağmen /api/kayit isteği gitti');
    await page.click('#kayitBtn');
    await page.waitForSelector('#kayitOnay:not(.gizli)', {timeout:4000});
    await page.click('#kayitOnayTamam');
    await page.waitForFunction(() => document.getElementById('kayitOnay').classList.contains('gizli'), null, {timeout:4000});
    for (let i=0;i<20 && kayitIstek===0;i++) await sleep(100);
    if (kayitIstek === 0) throw new Error('❌ Anladım\'a rağmen /api/kayit isteği GİTMEDİ');
    log('  ✓ (5) kayıt-onayı: modal önce, Vazgeç istek-yok, Anladım → kayıt akışı');
    await page.close();
  }

  await browser.close();
  log('\n✅ TÜM KURULUM-UI TESTLERİ YEŞİL');
}

main().then(() => { server?.proc.kill(); process.exit(0); })
  .catch(e => { console.error('\n' + (e?.message || e)); server?.proc.kill(); process.exit(1); });
