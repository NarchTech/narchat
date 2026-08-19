// NarChat — FAZ N5: NarcOsystem vitrini (GET /api/duyurular). İzole, 1 tarayıcı.
// Doğrular: authsız 401 · dosya yokken boş-durum · veri/duyurular.json fixture → kartlar (ad/açıklama/etiket).
// Çalıştır: HEADLESS=1 node test/duyuru.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8160, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-duyuru-'));
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
  log('🪐 NarChat FAZ N5 — NarcOsystem vitrini (izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);

  // [0] authsız istek → 401 (auth-gated, diğer basit GET uçlarıyla aynı disiplin)
  const r0 = await fetch(BASE+'/api/duyurular');
  if (r0.status !== 401) throw new Error('❌ authsız /api/duyurular 401 dönmedi: '+r0.status);
  log('  ✅ [0] authsız → 401');

  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const A = await kayit(await browser.newContext(), 'alice');
  log('  ✓ alice giriş yaptı');

  // [1] duyurular.json YOK → panel açılır ama boş-durum görünür
  await A.click('#narcosystemBtn');
  await A.waitForSelector('#gorunum-narcosystem:not(.gizli)', {timeout:8000});
  await A.waitForFunction(()=>!document.getElementById('narcosystemBos').classList.contains('gizli'), null, {timeout:8000});
  const bosSayim = await A.evaluate(()=>document.querySelectorAll('#narcosystemListe .satir').length);
  if (bosSayim !== 0) throw new Error('❌ dosya yokken kart göründü: '+bosSayim);
  log('  ✅ [1] duyurular.json yok → boş-durum + 0 kart');
  await A.click('#narcosystemGeriBtn');
  await A.waitForFunction(()=>document.getElementById('gorunum-narcosystem').classList.contains('gizli'), null, {timeout:8000});

  // [2] fixture yaz → yeniden aç → kartlar dolu, boş-durum gizli
  await writeFile(join(server.veri, 'duyurular.json'), JSON.stringify({
    surum: 1,
    urunler: [
      { ad:'NarcOsystem Stüdyo', aciklama:'Diğer nar ürünlerimiz burada', url:'https://example.com/studyo', ikon:'🪐', etiket:'YENİ' },
      { ad:'İkinci Ürün', aciklama:'Kısa açıklama', url:'https://example.com/ikinci', ikon:'✨' },
    ],
  }));
  await A.click('#narcosystemBtn');
  await A.waitForFunction(()=>document.querySelectorAll('#narcosystemListe .satir').length === 2, null, {timeout:8000});
  const kartlar = await A.evaluate(()=>[...document.querySelectorAll('#narcosystemListe .satir')].map(el=>({
    ad: el.querySelector('.ad')?.textContent, href: el.getAttribute('href'),
    rel: el.getAttribute('rel'), etiket: el.querySelector('.saat')?.textContent || null,
  })));
  if (kartlar[0].ad !== 'NarcOsystem Stüdyo' || kartlar[0].href !== 'https://example.com/studyo' || kartlar[0].etiket !== 'YENİ')
    throw new Error('❌ [2] ilk kart yanlış: '+JSON.stringify(kartlar[0]));
  if (!/noopener/.test(kartlar[0].rel||'')) throw new Error('❌ [2] rel=noopener eksik: '+kartlar[0].rel);
  if (kartlar[1].ad !== 'İkinci Ürün' || kartlar[1].etiket !== null)
    throw new Error('❌ [2] ikinci kart yanlış: '+JSON.stringify(kartlar[1]));
  const bosGizliMi = await A.evaluate(()=>document.getElementById('narcosystemBos').classList.contains('gizli'));
  if (!bosGizliMi) throw new Error('❌ [2] kartlar varken boş-durum hâlâ görünür');
  log('  ✅ [2] fixture → 2 kart doğru render (ad/url/etiket/rel=noopener), boş-durum gizlendi');

  // [3] GERÇEK OVERLAY: panel açıkken altındaki view'ı KAPLAMALI (bölünmüş ekran DEĞİL — #gorunum-oda deseni)
  const kaplama = await A.evaluate(()=>{
    const p = document.getElementById('gorunum-narcosystem').getBoundingClientRect();
    const k = document.getElementById('sohbet').getBoundingClientRect();
    return { panelH: p.height, kapH: k.height };
  });
  if (kaplama.panelH < kaplama.kapH * 0.9)
    throw new Error('❌ [3] panel kabı KAPLAMIYOR (bölünmüş ekran): panel='+Math.round(kaplama.panelH)+' kap='+Math.round(kaplama.kapH));
  log('  ✅ [3] panel altındaki view\'ı tam kaplıyor (gerçek overlay, split-screen yok)');
  await A.click('#narcosystemGeriBtn');
  await A.waitForFunction(()=>document.getElementById('gorunum-narcosystem').classList.contains('gizli'), null, {timeout:8000});

  // [4] DÜŞMANCA fixture: javascript: şema url → href '#' (metinYaz/link.mjs disiplini); null öğe → çökme yok (atlanır)
  await writeFile(join(server.veri, 'duyurular.json'), JSON.stringify({
    surum: 2,
    urunler: [
      { ad:'Kötü', aciklama:'zararlı şema', url:"javascript:alert(document.cookie)", ikon:'😈' },
      null,
      { ad:'İyi', aciklama:'temiz', url:'https://ok.example.com/x', ikon:'✅' },
    ],
  }));
  await A.click('#narcosystemBtn');
  // çökme olmadan İKİ kart (null atlandı) — OLD kodda map null'da patlar → bu waitForFunction TIMEOUT eder (red-first)
  await A.waitForFunction(()=>{
    const ks = document.querySelectorAll('#narcosystemListe .satir');
    return ks.length === 2 && [...ks].some(k=>k.querySelector('.ad')?.textContent==='Kötü');
  }, null, {timeout:8000});
  const dusman = await A.evaluate(()=>[...document.querySelectorAll('#narcosystemListe .satir')].map(el=>({
    ad: el.querySelector('.ad')?.textContent, href: el.getAttribute('href'),
  })));
  const kotu = dusman.find(k=>k.ad==='Kötü'), iyi = dusman.find(k=>k.ad==='İyi');
  if (!kotu || /^javascript:/i.test(kotu.href)) throw new Error('❌ [4] javascript: şema href\'e sızdı: '+JSON.stringify(kotu));
  if (kotu.href !== '#') throw new Error('❌ [4] güvensiz url "#"e düşmedi: '+kotu.href);
  if (!iyi || iyi.href !== 'https://ok.example.com/x') throw new Error('❌ [4] meşru https url bozuldu: '+JSON.stringify(iyi));
  log('  ✅ [4] javascript: şema → href="#" · null öğe atlandı (çökme yok) · https url korundu');

  await browser.close();
  log('\n✅ FAZ N5 NARCOSYSTEM VİTRİNİ GEÇTİ (izole): authsız-401 · boş-durum · fixture→kartlar · gerçek-overlay · javascript-şema-red · null-güvenli');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
