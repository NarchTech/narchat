// NarChat — FAZ H2: GRUP arama (mesh) kanıtı (izole, 3 tarayıcı: alice + bob + carol).
// alice grup GÖRÜNTÜLÜ arama başlatır → bob + carol "Grup araması" GELEN ekranı görür → katılır →
// FULL-MESH kurulur (her çift için ayrı RTCPeerConnection; per-eş sinyal `hedef` + `g:1` etiketi; sunucu OPAK relay).
// Doğrular: 3 katılımcı birbirini görür (her birinde 2 uzak video) · mute · kamera aç/kapa · ayrıl (tile düşer) · 1:1 bozulmaz (ayrı test).
// Medya uçtan-uca DTLS-SRTP. Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: HEADLESS=1 node test/grup_arama.mjs
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8131, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-grup-'));
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
async function odayaGir(page){
  await page.reload(); await uygulamaHazir(page);
  if (await page.locator('#kilitEkran:not(.gizli)').count()){ await page.fill('#kParola', PAROLA); await page.click('#kAc'); }
  await page.waitForSelector('#sohbet:not(.gizli)');
}
const gd = (page) => page.evaluate(()=>window.__GRUP_DURUM);
const bekleGrup = (page, d) => page.waitForFunction(x => window.__GRUP_DURUM === x, d, {timeout:30000});

let server;
async function main(){
  log('👥 NarChat FAZ H2 — GRUP arama (mesh, izole, 3 tarayıcı: alice+bob+carol)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const ctxOpt = { ...iPhone, permissions:['microphone','camera'] };
  const A = await kayit(await browser.newContext(ctxOpt), 'alice');
  const B = await kayit(await browser.newContext(ctxOpt), 'bob');
  const C = await kayit(await browser.newContext(ctxOpt), 'carol');
  log('  ✓ alice + bob + carol kayıt (mic+kamera izni)');

  // alice grup odası kurar (bob + carol)
  const grupKuruldu = await A.evaluate(async ()=>{
    const r = await fetch('/api/oda', {method:'POST', headers:{'Content-Type':'application/json','X-NarChat':'1'},
      credentials:'same-origin', body: JSON.stringify({tip:'grup', uyeler:['bob','carol']})});
    return r.ok;
  });
  if (!grupKuruldu) throw new Error('❌ grup odası kurulamadı');
  log('  ✓ grup odası kuruldu (alice+bob+carol)');

  // herkes oturuma girsin (ES_KISI = kişisel kanal bağlı → gelen grup araması her ekranda zil)
  await odayaGir(A); await odayaGir(B); await odayaGir(C);
  await A.locator('#odalar .oda').first().click();      // alice grup odasını açar (arama butonu için)
  await A.waitForSelector('#mesajIn:not([disabled])');
  await sleep(800);                                       // ES_KISI bağlansın
  log('  ✓ üçü de oturumda (alice grup odası açık)');

  // ── alice GRUP GÖRÜNTÜLÜ arama başlatır ──
  log('\n  [1] alice grup görüntülü arama başlatıyor:');
  if (await A.evaluate(()=>document.getElementById('aramaVideoBtn').classList.contains('gizli')))
    throw new Error('❌ grup sohbetinde görüntülü arama butonu gizli (H2 açmalı)');
  await A.click('#aramaVideoBtn');
  await bekleGrup(A, 'ariyor');
  log('  ✓ alice "ariyor" (grup katil duyuruldu)');

  // bob + carol GELEN grup araması ekranı görür → katılır
  log('\n  [2] bob + carol "Grup araması" görüp katılıyor:');
  for (const [P, ad] of [[B,'bob'],[C,'carol']]){
    await P.waitForSelector('#gelenArama:not(.gizli)', {timeout:25000});
    const alt = (await P.locator('#gelenAlt').textContent()).trim();
    if (!alt.includes('Grup')) throw new Error('❌ '+ad+' "Grup araması" etiketi görmedi: '+alt);
    await P.click('#aramaCevaplaBtn', {force:true});
    log('  ✓ '+ad+' katıldı ("'+alt+'")');
  }

  // ── MESH: üçü de "konusuyor" + her birinde 2 uzak eş + 2 uzak video ──
  log('\n  [3] full-mesh kuruluyor (her çift ayrı PeerConnection):');
  await bekleGrup(A,'konusuyor'); await bekleGrup(B,'konusuyor'); await bekleGrup(C,'konusuyor');
  for (const [P, ad] of [[A,'alice'],[B,'bob'],[C,'carol']]){
    await P.waitForFunction(()=>window.__GRUP_ES_SAYI===2, null, {timeout:30000});
    await P.waitForFunction(()=>window.__GRUP_UZAK_VIDEO_SAYI===2, null, {timeout:30000});
    const tiles = await P.evaluate(()=>document.querySelectorAll('#grupGrid .grup-tile').length);
    if (tiles !== 3) throw new Error('❌ '+ad+' grid 3 tile beklerken '+tiles+' gördü (kendi+2 eş)');
    log('  ✅ '+ad+': 2 eş bağlı + 2 uzak video + 3 tile (kendi+bob+carol)');
  }

  // ── kontroller (alice): mute + kamera aç/kapa ──
  log('\n  [4] alice kontrolleri:');
  await A.click('#grupMuteBtn');
  await A.waitForFunction(()=>window.__GRUP_MIK_ENABLED===false, null, {timeout:5000});
  await A.click('#grupMuteBtn');
  await A.waitForFunction(()=>window.__GRUP_MIK_ENABLED===true, null, {timeout:5000});
  await A.click('#grupKameraBtn');
  await A.waitForFunction(()=>window.__GRUP_KAM_ENABLED===false, null, {timeout:5000});
  await A.click('#grupKameraBtn');
  await A.waitForFunction(()=>window.__GRUP_KAM_ENABLED===true, null, {timeout:5000});
  log('  ✅ mute (mik enabled false→true) + kamera aç/kapa (kam enabled false→true)');

  // ── carol AYRILIR → alice + bob 1 eşe düşer, hâlâ "konusuyor" ──
  log('\n  [5] carol ayrılıyor → kalanlar 1 eşe düşer:');
  await C.click('#grupKapatBtn');
  await bekleGrup(C,'bos');
  await A.waitForFunction(()=>window.__GRUP_ES_SAYI===1, null, {timeout:15000});
  await B.waitForFunction(()=>window.__GRUP_ES_SAYI===1, null, {timeout:15000});
  if (await gd(A)!=='konusuyor' || await gd(B)!=='konusuyor') throw new Error('❌ carol ayrılınca alice/bob düştü');
  log('  ✅ carol ayrıldı (ayril sinyali) → alice+bob 1 eş, hâlâ konuşuyor');

  // ── alice ayrılır → bob 0 eş ──
  log('\n  [6] alice ayrılıyor → temiz:');
  await A.click('#grupKapatBtn');
  await bekleGrup(A,'bos');
  await B.waitForFunction(()=>window.__GRUP_ES_SAYI===0, null, {timeout:15000});
  log('  ✅ alice ayrıldı → bob 0 eş (sahne kalan tek kişide)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ H2 GRUP ARAMA (MESH) GEÇTİ (izole):');
  log('   • grup sohbette arama butonu açık · "Grup araması" gelen ekranı + katıl');
  log('   • full-mesh: 3 kişi, her çift ayrı PeerConnection (g:1 + hedef ile per-eş sinyal, sunucu opak)');
  log('   • her katılımcı 2 uzak video + grid 3 tile · mute + kamera aç/kapa');
  log('   • ayrıl → kalanların tile\'ı düşer (ayril sinyali); canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
