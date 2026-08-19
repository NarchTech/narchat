// NarChat — N7 Erişilebilirlik (universal tasarım): yazı boyu + yüksek kontrast + ARIA. İzole, 1 tarayıcı.
// Doğrular: yazı boyu segment → --f-N ölçeklenir (gerçek font-size değişir) + reload'da kalıcı ·
//           yüksek kontrast → data-kontrast=yuksek + text-2==text + reload'da kalıcı · ARIA öznitelikleri.
// Çalıştır: HEADLESS=1 node test/erisilebilirlik.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8161, BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (s) => console.log(s);

async function sunucuBaslat(){
  const veri = await mkdtemp(join(tmpdir(), 'narchat-erisim-'));
  const p = spawn('python3', [join(KOK,'mesaj_server.py')],
    { env:{...process.env, NARCHAT_PORT:String(PORT), NARCHAT_VERI:veri}, stdio:['ignore','pipe','pipe'] });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/api/ben'); if(r.status===401||r.ok) break; }catch{} await sleep(100); }
  return { proc:p, veri };
}
async function uygulamaHazir(page){ await page.waitForFunction(()=>{ const b=document.getElementById('kayitBtn'); return !!b && typeof b.onclick==='function'; }, null, {timeout:25000}); }
const govdeFont = (page) => page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize));

let server;
async function main(){
  log('♿ NarChat N7 — Erişilebilirlik (yazı boyu + yüksek kontrast + ARIA, izole)\n');
  server = await sunucuBaslat();
  log('  ✓ izole sunucu :'+PORT);
  const browser = await chromium.launch({ channel:'chrome', headless:HEADLESS });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE+'/'); await uygulamaHazir(page);
  await page.fill('#gKullanici', 'alice'); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam'); await page.waitForSelector('#sohbet:not(.gizli)', {timeout:20000});
  log('  ✓ alice giriş yaptı');

  await page.click('#altNav button[data-gor="ayarlar"]');
  await page.waitForSelector('#yaziSegment', {timeout:8000});

  // [1] YAZI BOYU: normal → büyük → gerçek font-size ARTAR + data-yazi=buyuk + buton aktif
  const normalPx = await govdeFont(page);
  await page.click('#yaziSegment button[data-yazi="buyuk"]');
  await sleep(150);
  const buyukPx = await govdeFont(page);
  if (!(buyukPx > normalPx + 1)) throw new Error(`❌ [1] büyük yazı font-size artmadı: normal=${normalPx} büyük=${buyukPx}`);
  const yaziAttr = await page.evaluate(()=>document.documentElement.getAttribute('data-yazi'));
  const buyukAktif = await page.evaluate(()=>document.querySelector('#yaziSegment button[data-yazi="buyuk"]').classList.contains('aktif'));
  if (yaziAttr !== 'buyuk' || !buyukAktif) throw new Error(`❌ [1] data-yazi/aktif yanlış: attr=${yaziAttr} aktif=${buyukAktif}`);
  log(`  ✅ [1] Büyük → font-size ${normalPx}px→${buyukPx}px (ölçekleniyor) + data-yazi=buyuk + buton aktif`);

  // [2] KALICI: reload sonrası yazı boyu korunur (yaziYukle boot'ta koşar, auth durumundan bağımsız)
  await page.reload(); await uygulamaHazir(page);
  const reloadAttr = await page.evaluate(()=>document.documentElement.getAttribute('data-yazi'));
  const reloadPx = await govdeFont(page);
  if (reloadAttr !== 'buyuk' || !(reloadPx > normalPx + 1)) throw new Error(`❌ [2] reload'da yazı boyu kaybı: attr=${reloadAttr} px=${reloadPx}`);
  log(`  ✅ [2] reload sonrası Büyük korundu (attr=${reloadAttr}, ${reloadPx}px)`);

  // [3] KÜÇÜK: font-size normalin ALTINA iner
  await page.waitForSelector('#altNav:not(.gizli)', {timeout:15000});   // cihaz-modu reload sonrası oto-açılışı bekle
  await page.click('#altNav button[data-gor="ayarlar"]');
  await page.waitForSelector('#yaziSegment', {timeout:8000});
  await page.click('#yaziSegment button[data-yazi="kucuk"]');
  await sleep(150);
  const kucukPx = await govdeFont(page);
  if (!(kucukPx < normalPx - 0.5)) throw new Error(`❌ [3] küçük yazı font-size azalmadı: normal=${normalPx} küçük=${kucukPx}`);
  log(`  ✅ [3] Küçük → font-size ${normalPx}px→${kucukPx}px (küçülüyor)`);

  // [4] YÜKSEK KONTRAST: toggle → data-kontrast=yuksek + aria-pressed + text-2 hesaplanan == text (ana yazı)
  const kontrastBtn = '#kontrastBtn';
  await page.click(kontrastBtn);
  await sleep(120);
  const kon = await page.evaluate(()=>{
    const root = document.documentElement, cs = getComputedStyle(root);
    return {
      attr: root.getAttribute('data-kontrast'),
      pressed: document.getElementById('kontrastBtn').getAttribute('aria-pressed'),
      metin: document.getElementById('kontrastBtn').textContent.trim(),
      t: cs.getPropertyValue('--text').trim(), t2: cs.getPropertyValue('--text-2').trim(),
    };
  });
  if (kon.attr !== 'yuksek' || kon.pressed !== 'true') throw new Error(`❌ [4] kontrast attr/pressed yanlış: ${JSON.stringify(kon)}`);
  if (kon.t2 !== kon.t) throw new Error(`❌ [4] yüksek kontrastta --text-2 ana yazıya çekilmedi: text=${kon.t} text-2=${kon.t2}`);
  if (kon.metin !== 'Açık') throw new Error(`❌ [4] buton metni 'Açık' değil: ${kon.metin}`);
  log('  ✅ [4] Yüksek kontrast → data-kontrast=yuksek · aria-pressed=true · --text-2==--text · buton "Açık"');

  // [5] KONTRAST KALICI: reload sonrası korunur
  await page.reload(); await uygulamaHazir(page);
  const konReload = await page.evaluate(()=>document.documentElement.getAttribute('data-kontrast'));
  if (konReload !== 'yuksek') throw new Error(`❌ [5] reload'da kontrast kaybı: ${konReload}`);
  log('  ✅ [5] reload sonrası yüksek kontrast korundu');

  // [6] ARIA: segment role=group + aria-label, kontrast butonu aria-pressed, toast role=status aria-live
  const aria = await page.evaluate(()=>{
    const seg = document.getElementById('yaziSegment');
    return {
      segRole: seg.getAttribute('role'), segLabel: seg.getAttribute('aria-label'),
      konPressed: document.getElementById('kontrastBtn').hasAttribute('aria-pressed'),
    };
  });
  if (aria.segRole !== 'group' || !aria.segLabel) throw new Error(`❌ [6] yaziSegment ARIA eksik: ${JSON.stringify(aria)}`);
  if (!aria.konPressed) throw new Error('❌ [6] kontrastBtn aria-pressed eksik');
  // toast: GERÇEK toast tetikle (window.__toast test-kancası), role=status/aria-live doğrula (artık atlanmıyor)
  const toastAria = await page.evaluate(()=>{
    if (typeof window.__toast !== 'function') return { yok:true };
    window.__toast('deneme'); const t=document.querySelector('.toast');
    return t ? { role:t.getAttribute('role'), live:t.getAttribute('aria-live') } : { bulunamadi:true };
  });
  if (toastAria.yok) throw new Error('❌ [6] window.__toast test-kancası yok (toast ARIA doğrulanamıyor)');
  if (toastAria.role !== 'status' || toastAria.live !== 'polite') throw new Error(`❌ [6] toast ARIA yanlış: ${JSON.stringify(toastAria)}`);
  log('  ✅ [6] ARIA: segment role=group+label · kontrast aria-pressed · toast role=status/aria-live (gerçek toast doğrulandı)');

  // [7] YÜKSEK KONTRAST PLACEHOLDER: renk ana-yazıya çekilince biçimle (italik) ayırt edilir kalmalı (a11y: renge güvenme)
  const ph = await page.evaluate(()=>{
    const el = document.getElementById('gKullanici');   // her zaman DOM'da
    const style = getComputedStyle(el, '::placeholder');
    return { italik: style.fontStyle, opak: parseFloat(style.opacity) };
  });
  if (ph.italik !== 'italic') throw new Error(`❌ [7] yüksek kontrastta placeholder biçim-ayrımı yok (font-style=${ph.italik}) — dolu/boş ayırt edilemez`);
  log(`  ✅ [7] yüksek kontrast placeholder italik (biçimle ayırt edilebilir, renge güvenmiyor; opacity=${ph.opak})`);

  await browser.close();
  log('\n✅ N7 ERİŞİLEBİLİRLİK GEÇTİ (izole): yazı boyu ölçekli+kalıcı · yüksek kontrast+kalıcı+placeholder-ayrımı · ARIA(gerçek toast)');
}
main().then(()=>{ server?.proc.kill(); process.exit(0); })
      .catch(e=>{ console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
