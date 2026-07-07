// NarChat — Faz 2 WebRTC sinyalizasyon kanıtı (izole, 2 tarayıcı).
// İki ayrı bağlam (alice/bob) ortak 1:1 odaya girer → alice sesli arama başlatır →
// sinyal (offer/answer/ICE) sunucu SSE'si üstünden relay olur → iki RTCPeerConnection
// localhost ICE ile bağlanır → datachannel üzerinden "merhaba" KARŞILIKLI geçer.
// Canlıya DOKUNMAZ (izole port + mktemp veri). Çalıştır: node test/webrtc_sinyal.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8109, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-rtc-'));
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

let server;
async function main(){
  log('📞 NarChat Faz 2 — WebRTC sinyalizasyon (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');
  log('  ✓ alice + bob kayıt');

  // alice'in kişi listesi bob'u görsün (reload→unlock)
  await A.reload(); await uygulamaHazir(A);
  if (await A.locator('#kilitEkran:not(.gizli)').count()){ await A.fill('#kParola', PAROLA); await A.click('#kAc'); }
  await A.waitForSelector('#sohbet:not(.gizli)');

  // alice → bob 1:1 oda aç (yeni model: önce kişi ekle)
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
  log('  ✓ iki taraf da ortak odada (SSE bağlı)');

  // arama butonu canlıda gizli (Faz 2 kapalı) — izole testte aç
  await A.evaluate(()=>document.getElementById('aramaBtn').classList.remove('gizli'));

  const bekleDurum = (page, d) => page.waitForFunction(x => window.__ARAMA_DURUM === x, d, {timeout:20000});
  const bekleMsg = async (page) => {
    await page.waitForFunction(()=>typeof window.__ARAMA_SON_MESAJ==='string' && window.__ARAMA_SON_MESAJ.startsWith('merhaba:'), null, {timeout:20000});
    return page.evaluate(()=>window.__ARAMA_SON_MESAJ);
  };

  // ── SENARYO 1: alice arar → bob CEVAPLAR → karşılıklı ses + datachannel ──
  log('\n  [1] alice arıyor → bob CEVAPLIYOR (otomatik değil) → P2P ses+datachannel:');
  await A.click('#aramaBtn');
  // bob'a GELEN ARAMA ekranı düşmeli (skeleton'daki otomatik-cevap KALDIRILDI) + arayan adı doğru
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  const arayanAd = (await B.locator('#gelenAd').textContent()).trim();
  if (arayanAd !== '@alice') throw new Error('❌ bob yanlış arayan gördü: '+arayanAd);
  log('  ✓ bob GELEN arama ekranı açıldı, arayan: '+arayanAd+' (otomatik cevaplamadı)');
  await B.click('#aramaCevaplaBtn', {force:true});   // sürekli "zıpla" animasyonu var → force

  // datachannel "merhaba" iki yönde
  const aMsg = await bekleMsg(A), bMsg = await bekleMsg(B);
  if (aMsg !== 'merhaba:bob')   throw new Error('❌ alice yanlış datachannel mesajı aldı: '+aMsg);
  if (bMsg !== 'merhaba:alice') throw new Error('❌ bob yanlış datachannel mesajı aldı: '+bMsg);
  log('  ✅ datachannel KARŞILIKLI açıldı: alice←"'+aMsg+'" · bob←"'+bMsg+'"');

  // karşı tarafın SES track'i iki yönde alındı + <audio autoplay>'e bağlandı mı (ontrack)?
  await A.waitForFunction(()=>window.__ARAMA_UZAK_TRACK===true, null, {timeout:20000});
  await B.waitForFunction(()=>window.__ARAMA_UZAK_TRACK===true, null, {timeout:20000});
  const aSink = await A.evaluate(()=>!!document.getElementById('uzakSes').srcObject);
  const bSink = await B.evaluate(()=>!!document.getElementById('uzakSes').srcObject);
  if (!aSink || !bSink) throw new Error('❌ uzak ses <audio> bağlanmadı: alice='+aSink+' bob='+bSink);
  log('  ✅ karşı ses track iki yönde alındı + <audio autoplay>\'e bağlandı (alice+bob)');

  // ikisi de "konusuyor"
  await bekleDurum(A,'konusuyor'); await bekleDurum(B,'konusuyor');
  log('  ✅ iki taraf da "konusuyor"');

  // alice kapatır → ikisi de "bos"
  await A.click('#aramaKapatBtn');
  await bekleDurum(A,'bos'); await bekleDurum(B,'bos');
  log('  ✅ alice kapattı → iki taraf "bos" (bitir sinyali)');

  // ── SENARYO 2: alice arar → bob REDDEDER → alice "reddedildi" ──
  log('\n  [2] alice arıyor → bob REDDEDİYOR:');
  await A.evaluate(()=>window.__ARAMA_LOG=[]);
  await A.click('#aramaBtn');
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  await B.click('#aramaReddetBtn');
  await A.waitForFunction(()=>(window.__ARAMA_LOG||[]).includes('reddedildi'), null, {timeout:20000});
  await bekleDurum(A,'bos');
  await B.waitForSelector('#gelenArama', {state:'hidden', timeout:20000});
  log('  ✅ alice "reddedildi" aldı → "bos"; bob gelen-ekranı kapandı');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ FAZ 2 SESLİ ARAMA (gerçek UI) GEÇTİ (izole):');
  log('   • /api/sinyal opak relay (offer/answer/ICE/reddet/bitir) — sunucu SDP\'yi yorumlamaz');
  log('   • iki RTCPeerConnection localhost ICE ile bağlandı');
  log('   • GELEN arama: zil/Cevapla-Reddet ekranı (otomatik-cevap yok)');
  log('   • karşı ses track\'i iki yönde <audio autoplay>\'e bağlandı (ses oynatma)');
  log('   • datachannel iki yönde "merhaba" geçti (P2P kanıtı)');
  log('   • Reddet akışı: arayan "reddedildi" aldı, oturum temiz kapandı');
  log('   • canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
