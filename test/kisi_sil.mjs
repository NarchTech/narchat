// NarChat — Kişi sil (FAZ A1) E2E (Playwright, gerçek app.js)
// İddia: Kişiler satırındaki ✕ → onay → /api/kisi-sil → kişi listeden çıkar (canlı yenile).
//        Yalnız kişi defterinden çıkarır; kullanıcı/oda sunucuda durur (tekrar eklenebilir).
//
// Çalıştır:  HEADLESS=1 node test/kisi_sil.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8109;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-kisisil-'));
  const p = spawn('python3', [join(KOK, 'mesaj_server.py')], {
    env: { ...process.env, NARCHAT_PORT: String(PORT), NARCHAT_VERI: veri },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/ben'); if (r.status === 401 || r.ok) break; } catch {}
    await sleep(100);
  }
  return { proc: p, veri };
}
async function uygulamaHazir(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('kayitBtn');
    return !!b && typeof b.onclick === 'function';
  }, null, { timeout: 25000 });
}
async function yeniSayfa(ctx, ad) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${ad} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/');
  await uygulamaHazir(page);
  return page;
}
async function kayitOl(page, kullanici) {
  await page.fill('#gKullanici', kullanici);
  await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn');
  await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}

let server;
async function main() {
  log('🗑  NarChat "Kişi sil" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  // bob'u doğrudan API'den kaydet (alice kişi olarak ekleyebilsin diye var olması yeter)
  // N1: kayıt artık v2 (sıfır-bilgi) — gerçek parola yerine sahte bir doğrulayıcı (public anahtar) yeter.
  const rb = await fetch(BASE + '/api/kayit', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kullanici: 'bob', dogrulayici: Buffer.alloc(32, 7).toString('base64'), pubkey: 'Ym9iLXRlc3QtcHVia2V5LXBsYWNlaG9sZGVy' }),
  });
  if (!rb.ok) throw new Error('❌ bob kaydı başarısız: ' + rb.status);
  log('1) bob kayıtlı (API) — alice eklemek için var\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 140 });
  const ctx = await browser.newContext(MOBIL);
  const a = await yeniSayfa(ctx, 'alice');

  // onay diyaloğunu otomatik kabul et
  a.on('dialog', d => d.accept());

  log('2) alice kayıt → Kişiler → "+" → Kişi Ekle: bob');
  await kayitOl(a, 'alice');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');

  const bobSatir = a.locator('#kisiler .oda', { hasText: '@bob' });
  await bobSatir.waitFor({ timeout: 10000 });
  log('  ✓ @bob kişilerde görünüyor');

  // sunucu kişi defterinde bob VAR
  let kis = await a.evaluate(async () => (await (await fetch('/api/kisiler', { credentials: 'same-origin' })).json()).map(x => x.kullanici));
  if (!kis.includes('bob')) throw new Error('❌ ekleme sonrası sunucu kişilerinde bob yok: ' + JSON.stringify(kis));

  log('\n3) @bob satırındaki ✕ → onay → silinmeli');
  await bobSatir.locator('.sil-btn').click();
  await a.locator('#kisiler .oda', { hasText: '@bob' }).waitFor({ state: 'detached', timeout: 10000 });
  log('  ✅ @bob kişiler listesinden kalktı (canlı yenile)');

  // sunucu kişi defterinde bob YOK
  kis = await a.evaluate(async () => (await (await fetch('/api/kisiler', { credentials: 'same-origin' })).json()).map(x => x.kullanici));
  if (kis.includes('bob')) throw new Error('❌ silmeden sonra sunucu hâlâ bob\'u kişi tutuyor: ' + JSON.stringify(kis));
  log('  ✅ sunucu /api/kisiler artık bob içermiyor');

  // bob KULLANICI olarak hâlâ var (sadece defterden çıktı) — tekrar eklenebilir
  const kull = await a.evaluate(async () => (await (await fetch('/api/kullanicilar', { credentials: 'same-origin' })).json()).map(x => x.kullanici));
  if (!kull.includes('bob')) throw new Error('❌ bob kullanıcı kaydı da silinmiş (yalnız defterden çıkmalıydı): ' + JSON.stringify(kull));
  log('  ✅ bob kullanıcı kaydı duruyor (yalnız kişi defterinden çıktı, tekrar eklenebilir)');

  if (!HEADLESS) await sleep(1000);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ KİŞİ SİL E2E GEÇTİ:');
  log('   • Kişiler satırında ✕ → onay → /api/kisi-sil → canlı yenile');
  log('   • kişi defterinden çıkar; kullanıcı + oda sunucuda durur (geri eklenebilir)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
