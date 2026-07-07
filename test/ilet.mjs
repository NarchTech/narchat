// NarChat — FAZ F2: MESAJ İLETME (forward, E2E re-encrypt) kanıtı (izole, 3 tarayıcı).
// alice'in bob'la odasında (AB) bir mesaj var → alice onu carol'la odasına (AC) İLETİR.
// carol mesajı ÇÖZER = ileti hedef üyeler için YENİDEN şifrelendi (E2E korunur; sunucu düz-metin görmez).
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/ilet.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8120, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const carp = (m) => { throw new Error('❌ ' + m); };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-ilet-'));
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
async function kisiEkle(page, ad){
  await page.click('#altNav button[data-gor="kisiler"]');
  await page.click('#ekleBtn'); await page.click('#kisiEkleAc');
  await page.fill('#kisiEkleIn', ad); await page.click('#kisiEkleBtn');
  await page.waitForSelector(`#kisiler .oda:has-text("@${ad}")`, {timeout:10000});
}

let server;
async function main(){
  log('↪ NarChat FAZ F2 — MESAJ İLETME (forward, E2E, 3 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext({ ...iPhone }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone }), 'bob');
  const C = await kayit(await browser.newContext({ ...iPhone }), 'carol');
  log('  ✓ alice + bob + carol kayıt');

  await A.reload(); await uygulamaHazir(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola', PAROLA); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');
  await kisiEkle(A, 'bob'); await kisiEkle(A, 'carol');
  // her iki 1:1 odayı da OLUŞTUR (kişiye tıkla → ikiliBaslat → /api/oda)
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])'); await A.click('#geriBtn');
  await A.locator('#kisiler .oda', { hasText:'@carol' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])'); await A.click('#geriBtn');
  log('  ✓ alice bob + carol odalarını oluşturdu (AB + AC)');

  // alice AB odasını aç + mesaj gönder
  await A.click('#altNav button[data-gor="sohbetler"]');
  await A.locator('#odalar .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  const METIN = 'selam-bob-iletilecek-mesaj';
  await A.fill('#mesajIn', METIN); await A.click('#gonderBtn');
  await A.waitForSelector(`#akis .msg .metin:has-text("${METIN}")`, {timeout:10000});
  log('  ✓ alice→bob mesaj gönderdi: "'+METIN+'"');

  // carol AC odasını açsın (SSE ile iletiyi canlı alsın)
  await C.reload(); await uygulamaHazir(C);
  if (await C.locator('#kilitEkran:not(.gizli)').count()){ await C.fill('#kParola', PAROLA); await C.click('#kAc'); }
  await C.waitForSelector('#sohbet:not(.gizli)');
  await C.locator('#odalar .oda', { hasText:'@alice' }).click();
  await C.waitForSelector('#mesajIn:not([disabled])');
  const cOnce = await C.locator('#akis .msg').count();
  log('  ✓ carol alice ile odasını açtı (mevcut msj: '+cOnce+')');

  // ── alice mesajı İLETİR → carol ──
  await A.locator('#akis .msg').first().dispatchEvent('contextmenu');
  await A.waitForSelector('#mesajMenu', {timeout:5000});
  await A.click('#mesajMenu .mesaj-menu-btn:has-text("İlet")');
  await A.waitForSelector('#mesajMenu.ilet-sec', {timeout:5000});
  await A.click('#mesajMenu .ilet-hedef:has-text("@carol")');
  log('  ✓ alice mesajı carol\'a İLETTİ (menü → İlet → @carol)');

  // carol iletiyi alır + ÇÖZER
  await C.waitForFunction((t)=>{
    return [...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent.includes(t));
  }, METIN, {timeout:20000}).catch(()=>{});
  const cVar = await C.evaluate((t)=>[...document.querySelectorAll('#akis .msg .metin')].some(e=>e.textContent.includes(t)), METIN);
  if (!cVar) carp('carol iletilen mesajı çözemedi/almadı');
  log('  ✅ carol iletilen mesajı ÇÖZDÜ: "'+METIN+'" (E2E yeniden-şifreleme doğru)');

  // SUNUCU OPAKLIK: AC odasının mesajında düz-metin yok (e2e1, msg ciphertext)
  const opak = await C.evaluate(async (t)=>{
    const lst = await (await fetch('/api/odalar',{credentials:'same-origin'})).json();
    const ac = lst.find(o=>(o.uyeler||[]).includes('alice'));
    if (!ac) return {hata:'AC yok'};
    const mlist = await (await fetch('/api/mesajlar?oda='+encodeURIComponent(ac.oda)+'&since=0',{credentials:'same-origin'})).json();
    const ileti = mlist[mlist.length-1];
    const ham = JSON.stringify(ileti.govde||{});
    return { sema: ileti.govde && ileti.govde.sema, duzMetinVar: ham.includes(t) };
  }, METIN);
  if (opak.hata) carp(opak.hata);
  if (opak.sema !== 'e2e1') carp('ileti şeması e2e1 değil: '+opak.sema);
  if (opak.duzMetinVar) carp('🔓 SUNUCUDA DÜZ METİN! ileti şifresiz saklanmış');
  log('  ✅ SUNUCU OPAK: ileti e2e1 ciphertext, depoda düz metin YOK');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ F2 MESAJ İLETME GEÇTİ (izole):');
  log('   • mesaj başka sohbete iletildi (menü → İlet → hedef seç)');
  log('   • hedef üye (carol) için YENİDEN şifrelendi → carol çözdü');
  log('   • sunucu deposunda düz metin YOK (E2E korundu)');
}
main().then(()=>{ server?.proc?.kill('SIGKILL'); process.exit(0); })
      .catch(e=>{ console.error(e); server?.proc?.kill('SIGKILL'); process.exit(1); });
