// NarChat — Bağlantı durumu göstergesi + yeniden bağlanma E2E (Playwright)
// İddialar:
//   1) Giriş sonrası kişisel SSE bağlanır → banner GİZLİ (bağlı).
//   2) Ağ kesilince (context.setOffline) → banner GÖRÜNÜR (çevrimdışı/yeniden-bağlanıyor).
//   3) Ağ gelince → banner yeniden GİZLİ (otomatik yeniden bağlandı).
// (Banner durumu ES_KISI onopen/onerror + online/offline olaylarıyla sürülür.)
//
// Çalıştır:  HEADLESS=1 node test/baglanti.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8114;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-baglanti-'));
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
const bannerGizli = () => { const el = document.getElementById('baglantiBanner'); return !!el && el.classList.contains('gizli'); };
const bannerGorunur = () => { const el = document.getElementById('baglantiBanner'); return !!el && !el.classList.contains('gizli'); };

let server;
async function main() {
  log('🔌 NarChat "Bağlantı durumu + yeniden bağlanma" E2E (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const ctx = await browser.newContext(MOBIL);
  const a = await ctx.newPage();
  a.on('console', m => { if (m.type() === 'error') console.log('  [konsol-hata] ' + m.text()); });
  await a.goto(BASE + '/'); await uygulamaHazir(a);

  log('1) alice kayıt → kişisel SSE bağlanır → banner gizli (bağlı):');
  await a.fill('#gKullanici', 'alice'); await a.fill('#gParola', PAROLA); await a.click('#kayitBtn');
  await a.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
  await a.waitForFunction(bannerGizli, null, { timeout: 12000 });
  log('  ✅ bağlı: banner gizli');

  log('\n2) ağ kesilir (setOffline) → banner görünür:');
  await ctx.setOffline(true);
  await a.waitForFunction(bannerGorunur, null, { timeout: 15000 });
  const durum = await a.evaluate(() => {
    const el = document.getElementById('baglantiBanner');
    return { sinif: el.className, metin: el.textContent };
  });
  if (!/cevrimdisi|baglaniyor/.test(durum.sinif)) throw new Error('❌ banner kesik durumu göstermiyor: ' + JSON.stringify(durum));
  log('  ✅ kopuk: banner görünür → "' + durum.metin.trim() + '"');

  log('\n3) ağ geri gelir → otomatik yeniden bağlan → banner gizli:');
  await ctx.setOffline(false);
  await a.waitForFunction(bannerGizli, null, { timeout: 25000 });
  log('  ✅ yeniden bağlandı: banner gizli');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ BAĞLANTI DURUMU + YENİDEN BAĞLANMA E2E GEÇTİ:');
  log('   • bağlıyken gizli · koptuğunda uyarı banner\'ı · gelince otomatik toparlar');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
