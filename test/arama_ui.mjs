// NarChat — FAZ E: ARAMA UI kanıtı (izole, 2 tarayıcı).
// alice → bob sesli arar → bob cevaplar → 'konusuyor'. Sonra UI sözleşmesini doğrular:
//   • TAM EKRAN arama ekranı (#aramaSahne) açılır, kiminle (@bob) + durum görünür
//   • SÜRE sayacı 'konusuyor'da başlar ve artar (#aramaSahneSure)
//   • MUTE: track.enabled toggle (gerçek medya kanıtı: window.__ARAMA_MIK_ENABLED)
//   • HOPARLÖR/AHİZE butonu hata vermez (en-iyi-çaba; platform sınırı)
//   • KÜÇÜLT: arama mini şeride iner (#aramaMini) — arama SÜRER ('konusuyor')
//   • GERİ BUG FIX: oda #geriBtn aramayı KAPATMAZ (odadan çıkar, çağrı mini şeritte sürer)
//   • mini şerit tıkla → arama ekranına DÖN, süre DEVAM
//   • Bitir → iki taraf 'bos', tüm arama UI gizli
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/arama_ui.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8118, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-aramaui-'));
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
const gizliMi = (page, sel) => page.evaluate(s => { const el=document.querySelector(s); return !el || el.classList.contains('gizli'); }, sel);
const durum   = (page) => page.evaluate(()=>window.__ARAMA_DURUM);

let server;
async function main(){
  log('📞 NarChat FAZ E — ARAMA UI (izole, 2 tarayıcı)\n');
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

  // ── arama kur: alice arar → bob cevaplar → konuşuyor ──
  await A.waitForSelector('#aramaBtn:not(.gizli)', {timeout:10000});   // 1:1'de aramaBtn görünür
  await A.click('#aramaBtn');
  // alice'te TAM EKRAN arama ekranı açıldı mı (çağrı başlar başlamaz)
  await A.waitForSelector('#aramaSahne:not(.gizli)', {timeout:10000});
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  await B.click('#aramaCevaplaBtn', {force:true});
  await bekleDurum(A,'konusuyor'); await bekleDurum(B,'konusuyor');
  log('  ✅ arama kuruldu: iki taraf "konusuyor"');

  // [1] kiminle + tam ekran
  if (await gizliMi(A,'#aramaSahne')) carp('alice arama ekranı (#aramaSahne) görünmüyor');
  const ad = (await A.locator('#aramaSahneAd').textContent()).trim();
  if (ad !== '@bob') carp('arama ekranında yanlış kişi: '+ad);
  log('  ✅ [1] tam ekran arama ekranı + kiminle = '+ad);

  // [2] süre sayacı başladı + artıyor
  if (await gizliMi(A,'#aramaSahneSure')) carp('süre sayacı görünmüyor (#aramaSahneSure)');
  const s1 = (await A.locator('#aramaSahneSure').textContent()).trim();
  await sleep(2200);
  const s2 = (await A.locator('#aramaSahneSure').textContent()).trim();
  if (!/^\d\d:\d\d$/.test(s2)) carp('süre formatı mm:ss değil: '+s2);
  if (s2 === s1 && s2 === '00:00') carp('süre sayacı artmadı: '+s1+' → '+s2);
  log('  ✅ [2] süre sayacı çalışıyor: '+s1+' → '+s2);

  // [3] MUTE: track.enabled toggle (gerçek medya kanıtı)
  await A.click('#muteBtn');
  const sustur1 = await A.evaluate(()=>window.__ARAMA_MIK_ENABLED);
  if (sustur1 !== false) carp('mute sonrası ses track enabled hâlâ: '+sustur1);
  const muteAktif = await A.evaluate(()=>document.getElementById('muteBtn').classList.contains('aktif'));
  if (!muteAktif) carp('mute butonu aktif görünmedi');
  await A.click('#muteBtn');
  const sustur2 = await A.evaluate(()=>window.__ARAMA_MIK_ENABLED);
  if (sustur2 !== true) carp('mute geri-açma sonrası track enabled değil: '+sustur2);
  log('  ✅ [3] mute: track.enabled false→true toggle (gerçek medya)');

  // [4] hoparlör/ahize butonu hata vermez (en-iyi-çaba)
  await A.click('#hoparlorBtn');
  await sleep(150);
  if (await durum(A) !== 'konusuyor') carp('hoparlör butonu aramayı bozdu');
  log('  ✅ [4] hoparlör/ahize butonu çalıştı (arama bozulmadı)');

  // [5] KÜÇÜLT: mini şeride in — arama SÜRER
  await A.click('#aramaKucultBtn');
  await A.waitForSelector('#aramaMini:not(.gizli)', {timeout:5000});
  if (!(await gizliMi(A,'#aramaSahne'))) carp('küçültünce arama ekranı hâlâ görünür');
  if (await durum(A) !== 'konusuyor') carp('küçültme aramayı kapattı');
  log('  ✅ [5] küçült → mini şerit, arama "konusuyor" sürüyor');

  // [6] GERİ BUG FIX: oda #geriBtn aramayı KAPATMAZ
  await A.click('#geriBtn');
  await A.waitForSelector('#gorunum-oda.gizli', {timeout:5000});   // odadan çıktı
  if (await durum(A) !== 'konusuyor') carp('🐞 GERİ aramayı kapattı (bug geri geldi!)');
  if (await gizliMi(A,'#aramaMini')) carp('geri sonrası mini şerit kayboldu');
  log('  ✅ [6] GERİ aramayı KAPATMADI (bug fix) — mini şerit + "konusuyor" sürüyor');

  // [7] mini şeritten DÖN → arama ekranı + süre DEVAM
  const sOnce = (await A.locator('#aramaMiniSure').textContent()).trim();
  await sleep(1500);
  await A.click('#aramaMini');
  await A.waitForSelector('#aramaSahne:not(.gizli)', {timeout:5000});
  if (await durum(A) !== 'konusuyor') carp('dönünce arama kapandı');
  const sSonra = (await A.locator('#aramaSahneSure').textContent()).trim();
  const sn = (t)=>{ const [m,s]=t.split(':').map(Number); return m*60+s; };
  if (sn(sSonra) < sn(sOnce)) carp('süre geri gitti: '+sOnce+' → '+sSonra);
  log('  ✅ [7] mini şeritten DÖN → arama ekranı, süre devam: '+sOnce+' → '+sSonra);

  // [8] Bitir → iki taraf bos + tüm arama UI gizli
  await A.click('#aramaKapatBtn');
  await bekleDurum(A,'bos'); await bekleDurum(B,'bos');
  if (!(await gizliMi(A,'#aramaSahne'))) carp('kapatınca arama ekranı gizlenmedi');
  if (!(await gizliMi(A,'#aramaMini')))  carp('kapatınca mini şerit gizlenmedi');
  log('  ✅ [8] Bitir → iki taraf "bos", arama UI temizlendi');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ E ARAMA UI GEÇTİ (izole):');
  log('   • tam ekran arama ekranı: kiminle + durum + mm:ss süre sayacı');
  log('   • mute = track.enabled toggle (gerçek medya kanıtı)');
  log('   • hoparlör/ahize butonu güvenli (en-iyi-çaba, platform sınırı)');
  log('   • küçült → mini şerit, arama sürer');
  log('   • GERİ artık aramayı KAPATMIYOR (bug fix)');
  log('   • mini şeritten dön → süre devam; Bitir → temiz kapanış');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
