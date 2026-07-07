// NarChat — Re-offer (push-uyandırma) kanıtı: alıcının çağrı kanalı çağrı BAŞLARKEN
// kapalıyken bile, kanal açılınca arayanın tekrar-offer'ı yakalanıp zil çalar (izole, 2 tarayıcı).
// Bu, "ekran kilitliyken Web Push gelir → dokunup app açılır → bağlanır" akışının test edilebilir
// çekirdeğidir (push servisi gerçek değil; burada kişisel /api/akis'i route ile kapatıp simüle ederiz).
// Çalıştır: node test/arama_reoffer.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8117, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);
const kisiselAkis = (url) => { try { const u = new URL(url); return u.pathname === '/api/akis' && !u.search; } catch { return false; } };

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-reoffer-'));
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
  log('📡 NarChat — Re-offer (push-uyandırma) çağrı kurtarma (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const ctxA = await browser.newContext({ ...iPhone, permissions:['microphone'] });
  const ctxB = await browser.newContext({ ...iPhone, permissions:['microphone'] });
  const A = await kayit(ctxA, 'alice');
  const B = await kayit(ctxB, 'bob');
  log('  ✓ alice + bob kayıt');

  // alice → bob 1:1 oda kur + aç (arayan; aramaBtn 1:1'de görünür)
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice odayı kurdu + açtı');

  // bob'un ÇAĞRI KANALINI kapat (simüle: telefon kilitli/app uykuda) → kişisel /api/akis abort + reload
  await ctxB.route(kisiselAkis, route => route.abort());
  await B.reload(); await uygulamaHazir(B);
  if (await B.locator('#kilitEkran:not(.gizli)').count()){ await B.fill('#kParola', PAROLA); await B.click('#kAc'); }
  await B.waitForSelector('#sohbet:not(.gizli)');
  log('  ✓ bob çağrı kanalı KAPALI (offline simülasyonu)');

  // alice arıyor — bob offline, ilk offer DÜŞER; alice re-offer döngüsüne girer
  await A.waitForSelector('#aramaBtn:not(.gizli)', {timeout:10000});
  await A.click('#aramaBtn');
  log('  📞 alice arıyor (bob offline → ilk offer kayıp, re-offer başladı)');

  // kanıt 1: bob offline'ken ~4sn zil ÇALMAZ
  await sleep(4000);
  if (await B.locator('#gelenArama:not(.gizli)').count()) throw new Error('❌ bob offline iken zil çaldı (olmamalı)');
  // alice hâlâ arıyor mu (re-offer döngüsü canlı, vazgeçmedi)
  const aliceAriyor = await A.evaluate(()=>window.__ARAMA_DURUM==='ariyor');
  if (!aliceAriyor) throw new Error('❌ alice arama durumunu bıraktı (re-offer beklenirdi)');
  log('  ✅ bob offline: ~4sn zil çalmadı; alice hâlâ "ariyor" (re-offer canlı)');

  // bob çağrı kanalını AÇ (simüle: bildirime dokundu, app uyandı) → EventSource reconnect → re-offer yakalanır
  await ctxB.unroute(kisiselAkis);
  log('  🔓 bob çağrı kanalı açıldı (bildirime dokunma simülasyonu)');

  // kanıt 2: re-offer yakalandı → bob ZİL çalar (oda kapalı, sadece re-offer ile)
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:25000});
  const arayanAd = (await B.locator('#gelenAd').textContent()).trim();
  if (arayanAd !== '@alice') throw new Error('❌ bob yanlış arayan: '+arayanAd);
  log('  ✅ kanal açılınca RE-OFFER yakalandı → bob zil çaldı, arayan: '+arayanAd);

  // bob cevaplar → datachannel karşılıklı (çağrı uyandırmadan sonra tam kuruldu)
  await B.click('#aramaCevaplaBtn', {force:true});
  const bekleMsg = async (page) => { await page.waitForFunction(()=>typeof window.__ARAMA_SON_MESAJ==='string' && window.__ARAMA_SON_MESAJ.startsWith('merhaba:'), null, {timeout:20000}); return page.evaluate(()=>window.__ARAMA_SON_MESAJ); };
  const aMsg = await bekleMsg(A), bMsg = await bekleMsg(B);
  if (aMsg !== 'merhaba:bob' || bMsg !== 'merhaba:alice') throw new Error('❌ datachannel yanlış: a='+aMsg+' b='+bMsg);
  log('  ✅ bob cevapladı → datachannel KARŞILIKLI (çağrı uyandırmadan tam kuruldu)');

  await A.click('#aramaKapatBtn');
  await B.waitForFunction(()=>window.__ARAMA_DURUM==='bos', null, {timeout:20000});
  log('  ✅ alice kapattı → bob "bos"');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ RE-OFFER (PUSH-UYANDIRMA) GEÇTİ (izole):');
  log('   • alıcı offline iken ilk offer düştü, alice re-offer döngüsüne girdi (45sn vazgeçme)');
  log('   • alıcı kanalı açılınca (bildirime dokunma) re-offer yakalandı → zil çaldı');
  log('   • cevapla → datachannel karşılıklı (çağrı uyandırmadan tam kuruldu)');
  log('   • not: gerçek push gönderimi push_test.py + canlı; burada kanal kapatma ile simüle edildi');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
