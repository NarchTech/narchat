// SVG → PNG ikon üretici (Playwright/Chrome ile rasterleştirme; harici araç gerekmez).
// ikon.svg'yi 192/512/180 px PNG'ye çevirir (manifest + apple-touch). Çalıştır: node deploy/ikon-uret.mjs
import { chromium } from 'playwright-core';
import { writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIK = join(KOK, 'static');
const HEDEFLER = [['ikon-192.png', 192], ['ikon-512.png', 512], ['ikon-180.png', 180]];

const sarmal = join(STATIK, '_ikon-sarmal.html');
await writeFile(sarmal,
  `<!doctype html><meta charset=utf-8><style>html,body{margin:0;padding:0}
   img{width:100vw;height:100vh;display:block}</style><img src="ikon.svg">`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [ad, boy] of HEDEFLER) {
  const page = await browser.newPage({ viewport: { width: boy, height: boy }, deviceScaleFactor: 1 });
  await page.goto('file://' + sarmal);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(STATIK, ad), omitBackground: false });
  await page.close();
  console.log('✓', ad, boy + 'px');
}
await browser.close();
await unlink(sarmal);
console.log('Tüm ikonlar üretildi.');
