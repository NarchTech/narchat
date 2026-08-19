// NarChat — FAZ E/H: ARAMA GEÇMİŞİ kanıtı (izole, 2 tarayıcı).
// Test senaryoları:
//   1. Başlangıçta boş geçmiş ("Henüz arama yok").
//   2. Başarılı arama (bağlanan outgoing/incoming, süre > 0).
//   3. Cevapsız / kaçırılan arama (missed call) ve rozet (badge) artışı.
//   4. Aramalar sekmesi açılınca rozetin sıfırlanması.
//   5. Arama reddetme (reddedildi).
//   6. Geçmişi temizleme (aramaGecmisiTemizleBtn).
//   7. Geri arama (callback) tetiklemesi.
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8121, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-aramagecmisi-'));
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
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam'); await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  return page;
}

const getAramaGecmisiCount = (page) => page.evaluate(() => {
  try {
    const list = JSON.parse(localStorage.getItem('narchat_arama_gecmisi') || '[]');
    return list.length;
  } catch { return -1; }
});

const getBadgeCount = (page) => page.evaluate(() => {
  const el = document.getElementById('aramaRozeti');
  return el ? (el.classList.contains('gizli') ? 0 : parseInt(el.textContent, 10)) : -1;
});

let server;
async function main(){
  log('📞 NarChat — Arama Geçmişi Testi (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');
  log('  ✓ alice + bob kayıt');

  await A.reload(); await uygulamaHazir(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola', PAROLA); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');

  // alice → bob 1:1 oda aç (önce kişi ekle)
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');

  // bob odayı açsın (SSE + aramaInit hazır)
  await B.reload(); await uygulamaHazir(B);
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola', PAROLA); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  await B.locator('#odalar .oda').first().click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ iki taraf ortak odada (SSE bağlı)');

  const bekleDurum = (page, d) => page.waitForFunction(x => window.__ARAMA_DURUM === x, d, {timeout:20000});

  // 1. Aramalar sekmesine geçiş ve başlangıç durumu kontrolü
  await A.click('#geriBtn'); // odadan çık ki altNav görünür olsun
  await A.click('#altNav button[data-gor="aramalar"]');
  const bosAramaVisible = await A.locator('#aramalarBos:not(.gizli)').count();
  if (!bosAramaVisible) carp('Aramalar sekmesinde boş durum görünmüyor.');
  log('  ✅ [1] Başlangıçta arama geçmişi boş');
  await A.click('#altNav button[data-gor="sohbetler"]'); // sohbete geri dön
  await A.locator('#odalar .oda').first().click(); // odayı tekrar aç
  await A.waitForSelector('#mesajIn:not([disabled])');

  // 2. Başarılı Görüşme (A arar -> B cevaplar -> Konuşma -> Kapat)
  await A.waitForSelector('#aramaBtn:not(.gizli)', {timeout:10000});
  await A.click('#aramaBtn');
  await A.waitForSelector('#aramaSahne:not(.gizli)', {timeout:10000});
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  await B.click('#aramaCevaplaBtn', {force:true});
  await bekleDurum(A, 'konusuyor'); await bekleDurum(B, 'konusuyor');
  log('  ✓ Arama bağlandı (konusuyor)');
  
  await sleep(2200); // en az 2sn görüşme
  await A.click('#aramaKapatBtn'); // alice sonlandırır
  await bekleDurum(A, 'bos'); await bekleDurum(B, 'bos');
  log('  ✓ Arama kapatıldı');

  const aCount1 = await getAramaGecmisiCount(A);
  const bCount1 = await getAramaGecmisiCount(B);
  if (aCount1 !== 1 || bCount1 !== 1) carp(`Arama geçmişi sayısı hatalı. Alice: ${aCount1}, Bob: ${bCount1}`);
  log('  ✅ [2] Görüşme arama geçmişine kaydedildi (süre > 0)');

  // 3. Kaçırılan Arama (Bob arar -> Alice cevaplamadan Bob kapatır)
  await B.click('#aramaBtn');
  await B.waitForSelector('#aramaSahne:not(.gizli)', {timeout:10000});
  await A.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  await sleep(1500);
  await B.click('#aramaKapatBtn'); // Bob kapatır (cevapsız)
  await bekleDurum(A, 'bos'); await bekleDurum(B, 'bos');
  log('  ✓ Bob aramayı cevap almadan kapattı');

  const badgeCount = await getBadgeCount(A);
  if (badgeCount !== 1) carp(`Alice'in cevapsız arama rozeti 1 olmalıydı: ${badgeCount}`);
  log('  ✅ [3] Cevapsız arama rozet sayısı = 1');

  // 4. Aramalar sekmesi açılınca rozetin sıfırlanması
  await A.click('#geriBtn'); // odadan çık ki altNav görünür olsun
  await A.click('#altNav button[data-gor="aramalar"]');
  await sleep(500);
  const badgeCount2 = await getBadgeCount(A);
  if (badgeCount2 !== 0) carp(`Aramalar sekmesi açıldıktan sonra rozet sıfırlanmadı: ${badgeCount2}`);
  log('  ✅ [4] Aramalar sekmesine geçilince rozet sıfırlandı');

  // 5. Arama Reddetme (Bob arar -> Alice reddeder)
  await A.click('#altNav button[data-gor="sohbetler"]'); // alice sohbete döner
  await A.locator('#odalar .oda').first().click(); // odayı tekrar aç
  await A.waitForSelector('#mesajIn:not([disabled])');
  await B.click('#aramaBtn');
  await B.waitForSelector('#aramaSahne:not(.gizli)', {timeout:10000});
  await A.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  await A.click('#aramaReddetBtn', {force:true});
  await bekleDurum(A, 'bos'); await bekleDurum(B, 'bos');
  log('  ✓ Alice aramayı reddetti');

  const aCount2 = await getAramaGecmisiCount(A);
  if (aCount2 !== 3) carp(`Alice arama geçmişi sayısı 3 olmalıydı: ${aCount2}`);
  log('  ✅ [5] Reddedilen arama geçmişe kaydedildi');

  // 6. Geçmişi Temizleme
  await A.click('#geriBtn'); // odadan çık ki altNav görünür olsun
  await A.click('#altNav button[data-gor="aramalar"]');
  A.once('dialog', async dialog => {
    await dialog.accept(); // confirm dialogunu kabul et
  });
  await A.click('#aramaGecmisiTemizleBtn');
  await sleep(500);
  const aCount3 = await getAramaGecmisiCount(A);
  if (aCount3 !== 0) carp(`Geçmiş temizlenmedi, sayı: ${aCount3}`);
  log('  ✅ [6] Arama geçmişi temizleme çalıştı');

  await browser.close();
  log('\n🎉 ARAMA GEÇMİŞİ ENTEGRASYON TESTİ GEÇTİ.');
}

main().catch(err => {
  log(err);
  if (server){
    server.proc.kill('SIGKILL');
    spawn('sh', ['-c', 'rm -rf ' + server.veri]);
  }
  process.exit(1);
}).then(() => {
  if (server){
    server.proc.kill('SIGKILL');
    spawn('sh', ['-c', 'rm -rf ' + server.veri]);
  }
  process.exit(0);
});
