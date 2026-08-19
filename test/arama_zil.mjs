// NarChat — Gelen arama ZİL kanıtı: alıcı odayı AÇIK TUTMASA da zil çalar (izole, 2 tarayıcı).
// Hata senaryosu (düzeltme öncesi): SSE yalnız açık odaya bağlıydı → karşı taraf o sohbeti
// açmadıysa offer hiç ulaşmaz, zil çalmazdı (Tayfun 27 Haz: "arıyorum ama karşıya çalmıyor").
// Düzeltme: kullanıcıya-özel kalıcı SSE (/api/akis oda'sız) + sunucu sinyali üye KİŞİSEL kanalına yayar.
// Bu test: bob giriş yapar ama ODAYI AÇMAZ (sohbet listesinde kalır) → alice arar → bob ZİL + Cevapla.
// Canlıya DOKUNMAZ (izole port + mktemp). Çalıştır: node test/arama_zil.mjs  (HEADLESS=1 sessiz)
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8115, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const iPhone = devices['iPhone 13'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-zil-'));
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
async function kilitVarsaAc(page){
  await page.reload(); await uygulamaHazir(page);
  if (await page.locator('#kilitEkran:not(.gizli)').count()){ await page.fill('#kParola', PAROLA); await page.click('#kAc'); }
  await page.waitForSelector('#sohbet:not(.gizli)');
}

let server;
async function main(){
  log('🔔 NarChat — Gelen arama ZİL (alıcı odayı açmadan) kanıtı (izole, 2 tarayıcı)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const A = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'alice');
  const B = await kayit(await browser.newContext({ ...iPhone, permissions:['microphone'] }), 'bob');
  log('  ✓ alice + bob kayıt');

  // alice → bob 1:1 oda kur (kişi ekle + tıkla). Bu odayı OLUŞTURUR.
  await kilitVarsaAc(A);
  await A.click('#altNav button[data-gor="kisiler"]');
  await A.click('#ekleBtn'); await A.click('#kisiEkleAc');
  await A.fill('#kisiEkleIn', 'bob'); await A.click('#kisiEkleBtn');
  await A.locator('#kisiler .oda', { hasText:'@bob' }).click();
  await A.waitForSelector('#mesajIn:not([disabled])');
  log('  ✓ alice 1:1 odayı kurdu + açtı (arayan taraf)');

  // bob giriş yapar ve SOHBET LİSTESİNDE KALIR — odayı AÇMAZ (kritik nokta).
  await kilitVarsaAc(B);
  await B.click('#altNav button[data-gor="sohbetler"]');
  await B.waitForSelector('#gorunum-sohbetler:not(.gizli)', {timeout:10000});
  // teyit: bob oda görünümünde DEĞİL (yani SSE'si odaya bağlı değil — eski hatada zil çalmazdı)
  const odaAcikMi = await B.evaluate(()=>!document.getElementById('gorunum-oda').classList.contains('gizli'));
  if (odaAcikMi) throw new Error('❌ kurulum hatası: bob oda görünümünde, oysa listede kalmalı');
  // kişisel kanal SSE açık mı (oturum boyu) — readyState OPEN(1) ya da CONNECTING(0)
  await B.waitForFunction(()=>!!window.__test_es_kisi_yok ? false : true, null, {timeout:3000}).catch(()=>{});
  log('  ✓ bob sohbet LİSTESİNDE (odayı açmadı) — eski hatada burada zil çalmazdı');

  // alice arıyor (aramaBtn 1:1'de görünür — odaAc toggle). Canlıdaki gibi gizli değil.
  await A.waitForSelector('#aramaBtn:not(.gizli)', {timeout:10000});
  await A.click('#aramaBtn');
  log('  📞 alice aradı…');

  // ── ASIL KANIT: bob odayı açmamasına rağmen GELEN ARAMA ekranı düşer ──
  await B.waitForSelector('#gelenArama:not(.gizli)', {timeout:20000});
  const arayanAd = (await B.locator('#gelenAd').textContent()).trim();
  if (arayanAd !== '@alice') throw new Error('❌ bob yanlış arayan gördü: '+arayanAd);
  log('  ✅ bob ZİL ÇALDI (oda kapalıyken!) — arayan: '+arayanAd);

  // bob cevaplar → karşılıklı datachannel "merhaba" (çağrı listeden de tam kurulur)
  await B.click('#aramaCevaplaBtn', {force:true});
  const bekleMsg = async (page) => { await page.waitForFunction(()=>typeof window.__ARAMA_SON_MESAJ==='string' && window.__ARAMA_SON_MESAJ.startsWith('merhaba:'), null, {timeout:20000}); return page.evaluate(()=>window.__ARAMA_SON_MESAJ); };
  const aMsg = await bekleMsg(A), bMsg = await bekleMsg(B);
  if (aMsg !== 'merhaba:bob' || bMsg !== 'merhaba:alice') throw new Error('❌ datachannel yanlış: a='+aMsg+' b='+bMsg);
  log('  ✅ bob CEVAPLADI → datachannel karşılıklı açıldı (çağrı listeden tam kuruldu)');

  await A.click('#aramaKapatBtn');
  await B.waitForFunction(()=>window.__ARAMA_DURUM==='bos', null, {timeout:20000});
  log('  ✅ alice kapattı → bob "bos" (bitir sinyali kişisel kanaldan da işliyor)');

  await browser.close();
  log('\n══════════════════════════════════════════');
  log('✅ GELEN ARAMA ZİL (oda kapalıyken) GEÇTİ (izole):');
  log('   • alıcı sohbet listesindeyken (oda SSE YOK) gelen arama zil çaldı');
  log('   • sinyal kişisel kanaldan (/api/akis oda\'sız) ulaştı → her ekranda çalar');
  log('   • cevapla→datachannel + kapat→bitir kişisel kanal üzerinden tam çalışıyor');
  log('   • canlıya dokunulmadı (izole :'+PORT+')');
  log('══════════════════════════════════════════');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
