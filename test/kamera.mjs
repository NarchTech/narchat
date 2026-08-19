// NarChat — FAZ G2: KAMERA ile foto kanıtı (izole, 2 tarayıcı).
// 📷 butonu = capture'lu dosya girişi (mobilde native kamera). #kameraIn'e foto verilince mevcut E2E
// medya pipeline'ından gider → bob foto baloncuğunu alır. capture attribute'u da doğrulanır.
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/kamera.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8123, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kam-'));
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

let server;
async function main(){
  log('📷 NarChat FAZ G2 — KAMERA foto (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  log('  ✓ alice + bob kayıt');

  await A.reload(); await uygulamaHazir(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola', PAROLA); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  await B.reload(); await uygulamaHazir(B);
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola', PAROLA); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  await B.locator('#odalar .oda').first().click();
  await B.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ iki taraf ortak odada');

  // [1] kamera girişi + capture attribute
  const capt = await A.evaluate(()=>{ const el=document.getElementById('kameraIn'); return el && el.getAttribute('capture'); });
  if (capt !== 'environment') carp('#kameraIn capture="environment" değil: '+capt);
  const btnVar = await A.evaluate(()=>!!document.getElementById('kameraBtn'));
  if (!btnVar) carp('📷 kamera butonu yok');
  log('  ✅ [1] 📷 buton + #kameraIn capture="environment" (mobilde native kamera)');

  // [2] kamerayla foto gönder (capture girişine foto ver → medyaGonder)
  await A.locator('#kameraIn').setInputFiles({ name:'kamera-foto.jpg', mimeType:'image/jpeg', buffer: PNG_1x1 });
  await A.waitForSelector('#akis img.medya-resim', {timeout:15000});
  log('  ✅ [2] alice kamerayla foto gönderdi (baloncukta görsel)');

  // [3] bob fotoyu aldı + çözdü (canlı SSE; ağır yüklü ortamda push gecikirse reload+tazele'ye düş —
  // aynı kurtarma yolu app.js'te de var: sekme-görünür/online olunca SSE yeniden kurulur + kaçanlar tazelenir)
  try {
    await B.waitForSelector('#akis img.medya-resim', {timeout:12000});
  } catch {
    log('  ⏳ canlı SSE 12sn içinde gelmedi (ortam yükü) — reload ile tazeleniyor');
    await B.reload(); await uygulamaHazir(B);
    if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola', PAROLA); await B.click('#kAc'); }
    await B.waitForSelector('#sohbet:not(.gizli)');
    await B.locator('#odalar .oda').first().click();
    await B.waitForSelector('#akis img.medya-resim', {timeout:20000});
  }
  const bSrc = await B.evaluate(()=>{ const i=document.querySelector('#akis img.medya-resim'); return i && i.src; });
  if (!bSrc || !bSrc.startsWith('blob:')) carp('bob foto baloncuğu yok: '+bSrc);
  log('  ✅ [3] bob fotoyu aldı + çözdü (E2E medya pipeline)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ G2 KAMERA GEÇTİ (izole):');
  log('   • 📷 capture\'lı giriş (mobilde native kamera, masaüstünde dosya)');
  log('   • çekilen foto mevcut E2E medya pipeline\'ından gitti → bob aldı');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
