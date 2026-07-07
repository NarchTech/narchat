// NarChat — ekran görüntüsü vitrini (Playwright, iPhone viewport, açık + koyu tema).
// İzole sunucu kurar, gerçek E2E sohbet verisi tohumlar, her ana ekranı çeker.
// Çıktı: CIKTILAR/NarChat/ekran-goruntuleri/{tema}-{ekran}.png   ·   Çalıştır: node test/ekran-goruntu.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8106, BASE = `http://127.0.0.1:${PORT}`;
const CIKTI = join(KOK, 'ekran-goruntuleri');
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-shot-'));
  const p = spawn('python3', [join(KOK, 'mesaj_server.py')],
    { env: { ...process.env, NARCHAT_PORT: String(PORT), NARCHAT_VERI: veri }, stdio: ['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc: p, veri };
}
async function uygulamaHazir(page){
  await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000});
}
async function kayit(ctx, kullanici){
  const page = await ctx.newPage();
  await page.goto(BASE+'/'); await uygulamaHazir(page);
  await page.fill('#gKullanici', kullanici); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn');
  await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  return page;
}
async function yenidenUnlock(page){
  await page.reload(); await uygulamaHazir(page);
  await page.waitForSelector('#kilitEkran:not(.gizli), #sohbet:not(.gizli)', {timeout:20000});
  if (await page.locator('#kilitEkran:not(.gizli)').count()){ await page.fill('#kParola', PAROLA); await page.click('#kAc'); }
  await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
}
const temaSet = (page, t) => page.evaluate((t)=>{ document.documentElement.setAttribute('data-theme', t); try{localStorage.setItem('narchat_tema',t);}catch{} }, t);
async function cek(page, ad){ await sleep(450); await page.screenshot({ path: join(CIKTI, ad+'.png') }); log('  📸 '+ad+'.png'); }

let server;
async function main(){
  await mkdir(CIKTI, { recursive: true });
  server = await sunucuBaslat();
  log('🌐 izole sunucu :'+PORT+'  (veri: '+server.veri+')');
  const browser = await chromium.launch({ channel:'chrome', headless:true });

  // tohum: 4 kullanıcı (alice = vitrin sahibi)
  const ctxA = await browser.newContext({ ...iPhone });
  const ctxM = await browser.newContext({ ...iPhone });
  const A = await kayit(ctxA, 'alice');
  const M = await kayit(ctxM, 'mehmet');
  const Z = await kayit(await browser.newContext({ ...iPhone }), 'zeynep');
  const D = await kayit(await browser.newContext({ ...iPhone }), 'deniz');
  log('  ✓ alice, mehmet, zeynep, deniz kayıt');

  // herkes kayıt olduktan sonra alice'in kişi listesi tazelensin (reload→unlock)
  await yenidenUnlock(A);

  // alice → mehmet 1:1
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.locator('#kisiler .oda', { hasText:'@mehmet' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  // mehmet odayı görsün + açsın (canlı)
  await yenidenUnlock(M);
  await M.locator('#odalar .oda').first().click();
  await M.waitForSelector('#mesajIn:not([disabled])');

  const yaz = async (page, metin) => { await page.fill('#mesajIn', metin); await page.click('#gonderBtn'); await sleep(500); };
  await yaz(A, 'Selam Mehmet! 👋');
  await yaz(A, 'Akşam ekip toplantısı 21:00 sana uyar mı?');
  await yaz(M, 'Olur, hazırım 🙌');
  await yaz(M, 'Sunumu da getiririm, merak etme.');
  await yaz(A, 'Süper, o zaman görüşürüz ☕️');
  await sleep(600);

  // alice grup kursun (alice+mehmet+zeynep)
  await A.locator('#geriBtn').click();
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#grupModBtn');
  await A.selectOption('#grupUye', ['mehmet','zeynep']);
  await A.click('#grupBtn');
  await A.waitForSelector('#mesajIn:not([disabled])');
  await yaz(A, 'Çekirdek ekip kanalı açıldı 🎉 Buradan koordine oluruz.');
  await sleep(500);
  await A.locator('#geriBtn').click();   // sohbet listesine dön

  // ── her tema için vitrin ──
  for (const tema of ['light','dark']) {
    log('\n🎨 tema: '+tema);
    await temaSet(A, tema);
    // 1) sohbet listesi
    await A.click('#altNav button[data-gor="sohbetler"]'); await cek(A, tema+'-1-sohbet-listesi');
    // 2) sohbet ekranı (mehmet odası — ilk sıradaki ikili)
    await A.locator('#odalar .oda', { hasText:'@mehmet' }).first().click();
    await A.waitForSelector('#mesajIn:not([disabled])'); await cek(A, tema+'-2-sohbet-ekrani');
    await A.locator('#geriBtn').click();
    // 3) kişiler
    await A.click('#altNav button[data-gor="kisiler"]'); await cek(A, tema+'-3-kisiler');
    // 4) ayarlar
    await A.click('#altNav button[data-gor="ayarlar"]'); await cek(A, tema+'-4-ayarlar');
    // 5) giriş ekranı (taze bağlam)
    const ctxL = await browser.newContext({ ...iPhone });
    await ctxL.addInitScript((t)=>{ try{localStorage.setItem('narchat_tema',t);}catch{} }, tema);
    const L = await ctxL.newPage(); await L.goto(BASE+'/'); await uygulamaHazir(L);
    await temaSet(L, tema); await cek(L, tema+'-5-giris');
    await ctxL.close();
    await A.click('#altNav button[data-gor="sohbetler"]');
  }

  // 6) gelen arama ekranı (Faz 2 — overlay'i mock göster; gerçek WebRTC gerekmez, tema-bağımsız koyu vitrin)
  await A.click('#altNav button[data-gor="sohbetler"]');
  await A.evaluate(()=>{
    document.getElementById('gelenAd').textContent = '@mehmet';
    const av = document.getElementById('gelenAvatar');
    av.textContent = 'M'; av.style.setProperty('--av', '#e23b56');   // yakut aksan
    document.getElementById('gelenArama').classList.remove('gizli');
  });
  await cek(A, 'gelen-arama');
  await A.evaluate(()=>document.getElementById('gelenArama').classList.add('gizli'));

  await browser.close();
  log('\n✅ Ekran görüntüleri hazır: '+CIKTI);
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
