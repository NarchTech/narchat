// NarChat — Sabitlenen + yıldızlı mesajlar FAZ G12 (Playwright, gerçek app.js)
// İddialar:
//   1) SABİT (pin): alice mesajı sabitler → alice + bob (üye) başlık altında sabit şeridi
//        (önizleme + canlı SSE). Kaldır → iki tarafta şerit gider.
//   2) YILDIZ (kişisel): alice yıldızlar → alice baloncuğunda ⭐; bob'ta YOK (kişisel).
//   3) LİSTE: Ayarlar → "Yıldızlı mesajlar" → yıldızlanan mesaj listede.
//   4) KALICI: alice reload → ⭐ hâlâ duruyor (sunucu-senkron, cihazlar arası).
//   5) GİZLİLİK: sabit/yıldız = METADATA (id) — sunucu deposunda düz-metin YOK.
//
// Çalıştır:  HEADLESS=1 node test/sabit_yildiz.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8129;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADLESS = process.env.HEADLESS === '1';
const PAROLA = 'parola1234';
const PINMSG = 'PIN_GIZLI_' + PORT;
const STARMSG = 'YILDIZ_GIZLI_' + PORT;

const log = (s) => console.log(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOBIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function sunucuBaslat() {
  const veri = await mkdtemp(join(tmpdir(), 'narchat-sabityildiz-'));
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
    const b = document.getElementById('kayitBtn'); return !!b && typeof b.onclick === 'function';
  }, null, { timeout: 25000 });
}
async function yeniSayfa(ctx, ad) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [${ad} konsol-hata] ${m.text()}`); });
  await page.goto(BASE + '/'); await uygulamaHazir(page); return page;
}
async function kayitOl(page, kullanici) {
  await page.fill('#gKullanici', kullanici); await page.fill('#gParola', PAROLA);
  await page.click('#kayitBtn'); await page.click('#kayitOnayTamam'); await page.waitForSelector('#sohbet:not(.gizli)', { timeout: 20000 });
}
const baloncuk = (page, metin) => page.locator('#akis .msg', { hasText: metin }).first();
async function menuAc(page, metin) {
  await baloncuk(page, metin).dispatchEvent('contextmenu');
  await page.waitForSelector('#mesajMenu', { timeout: 5000 });
}

let server;
async function main() {
  log('📌⭐ NarChat "Sabitlenen + yıldızlı mesajlar" G12 (Playwright' + (HEADLESS ? ', headless' : ', HEADFUL') + ')\n');
  server = await sunucuBaslat();
  log(`  ✓ izole sunucu :${PORT}  (veri: ${server.veri})\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, slowMo: HEADLESS ? 0 : 100 });
  const a = await yeniSayfa(await browser.newContext(MOBIL), 'alice');
  const b = await yeniSayfa(await browser.newContext(MOBIL), 'bob');

  log('1) Kurulum: alice→bob iki mesaj, bob sohbeti açar:');
  await kayitOl(a, 'alice'); await kayitOl(b, 'bob');
  await a.click('#altNav button[data-gor="kisiler"]');
  await a.click('#ekleBtn'); await a.click('#kisiEkleAc');
  await a.fill('#kisiEkleIn', 'bob'); await a.click('#kisiEkleBtn');
  const bobKisi = a.locator('#kisiler .oda', { hasText: '@bob' }); await bobKisi.waitFor({ timeout: 10000 }); await bobKisi.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  for (const t of [PINMSG, STARMSG]){ await a.fill('#mesajIn', t); await a.click('#gonderBtn');
    await a.waitForFunction((s)=>document.getElementById('akis')?.textContent.includes(s), t, { timeout: 12000 }); }
  await b.reload(); await uygulamaHazir(b);
  const bobOda = b.locator('#odalar .oda').first(); await bobOda.waitFor({ timeout: 12000 }); await bobOda.click();
  await b.waitForSelector('#mesajIn:not([disabled])');
  await b.waitForFunction((s)=>document.getElementById('akis')?.textContent.includes(s), STARMSG, { timeout: 12000 });
  log('  ✓ iki mesaj iki tarafta hazır');

  log('\n2) SABİT: alice mesajı sabitler → alice + bob (canlı) sabit şeridi:');
  await menuAc(a, PINMSG);
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Sabitle' }).click();
  await a.waitForSelector('#sabitBar:not(.gizli)', { timeout: 5000 });
  if (!(await a.locator('#sabitOn').textContent()).includes(PINMSG)) throw new Error('❌ alice sabit şeridi önizlemesi yanlış');
  await b.waitForSelector('#sabitBar:not(.gizli)', { timeout: 8000 });   // bob CANLI (SSE)
  if (!(await b.locator('#sabitOn').textContent()).includes(PINMSG)) throw new Error('❌ bob sabit şeridi önizlemesi yanlış');
  log('  ✅ alice sabitledi → bob başlık altında sabit şeridi (canlı SSE, önizleme doğru)');

  log('\n3) YILDIZ (kişisel): alice yıldızlar → alice ⭐, bob\'ta YOK:');
  await menuAc(a, STARMSG);
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Yıldızla' }).click();
  await a.waitForFunction((s) => {
    const el = [...document.querySelectorAll('#akis .msg')].find(e => e.textContent.includes(s));
    return !!el && !!el.querySelector('.yildiz-im');
  }, STARMSG, { timeout: 6000 });
  const bobYildiz = await b.evaluate((s) => {
    const el = [...document.querySelectorAll('#akis .msg')].find(e => e.textContent.includes(s));
    return !!el && !!el.querySelector('.yildiz-im');
  }, STARMSG);
  if (bobYildiz) throw new Error('❌ bob alice\'in kişisel yıldızını görüyor (kişisel olmalı)');
  log('  ✅ alice baloncuğunda ⭐; bob\'ta YOK (yıldız kişisel)');

  log('\n4) LİSTE: Ayarlar → "Yıldızlı mesajlar" → mesaj listede:');
  if (await a.locator('#geriBtn').isVisible().catch(() => false)) await a.click('#geriBtn');   // oda görünümünden çık (altNav görünür)
  await a.click('#altNav button[data-gor="ayarlar"]');
  await a.click('#yildizliMsgBtn');
  await a.waitForSelector('#yildizliPanel', { timeout: 5000 });
  await a.waitForFunction((s) => document.getElementById('yildizliPanel')?.textContent.includes(s), STARMSG, { timeout: 8000 });
  if ((await a.locator('#yildizliPanel .satir').count()) < 1) throw new Error('❌ yıldızlı listede satır yok');
  log('  ✅ yıldızlı mesaj Ayarlar listesinde görünüyor');
  await a.locator('#yildizliPanel .bar-btn').click();   // ✕ kapat

  log('\n5) KALICI: alice reload → ⭐ hâlâ duruyor (sunucu-senkron):');
  await a.reload(); await uygulamaHazir(a);
  const aOda = a.locator('#odalar .oda').first(); await aOda.waitFor({ timeout: 12000 }); await aOda.click();
  await a.waitForSelector('#mesajIn:not([disabled])');
  await a.waitForFunction((s) => {
    const el = [...document.querySelectorAll('#akis .msg')].find(e => e.textContent.includes(s));
    return !!el && !!el.querySelector('.yildiz-im');
  }, STARMSG, { timeout: 10000 }).catch(() => { throw new Error('❌ reload sonrası ⭐ kayboldu (senkron değil)'); });
  // sabit şeridi de reload sonrası duruyor (oda kaydından)
  await a.waitForSelector('#sabitBar:not(.gizli)', { timeout: 6000 });
  log('  ✅ reload → ⭐ + sabit şeridi korundu (sunucuda saklı, cihazlar arası)');

  log('\n6) SABİTİ KALDIR: alice kaldırır → alice + bob şerit gizlenir:');
  await menuAc(a, PINMSG);
  await a.locator('#mesajMenu .mesaj-menu-btn', { hasText: 'Sabiti kaldır' }).click();
  await a.waitForFunction(() => document.getElementById('sabitBar')?.classList.contains('gizli'), null, { timeout: 6000 });
  await b.waitForFunction(() => document.getElementById('sabitBar')?.classList.contains('gizli'), null, { timeout: 8000 });
  log('  ✅ sabit kaldırıldı → iki tarafta şerit gizlendi (canlı)');

  log('\n7) GİZLİLİK: sabit/yıldız = metadata (id); sunucuda düz-metin YOK:');
  // kullanıcı kaydında yıldız (id) var; mesaj depolarında düz-metin yok
  const kullHam = await readFile(join(server.veri, 'kullanicilar.json'), 'utf8').catch(() => '');
  if (!/"yildiz"\s*:\s*\[\s*{/.test(kullHam)) throw new Error('❌ kullanıcı kaydında yıldız metadata yok');
  if (kullHam.includes(STARMSG)) throw new Error('❌ yıldız kaydında düz-metin var (olmamalı)');
  let msgHam = '';
  const msgDir = join(server.veri, 'mesajlar');
  for (const f of await readdir(msgDir)) msgHam += await readFile(join(msgDir, f), 'utf8');
  if (msgHam.includes(PINMSG) || msgHam.includes(STARMSG)) throw new Error('❌ mesaj deposunda düz-metin var (E2E ihlali)');
  log('  ✅ yıldız = id metadata; sunucuda PIN/STAR düz-metni YOK (E2E korunur)');

  if (!HEADLESS) await sleep(1200);
  await browser.close();

  log('\n══════════════════════════════════════════');
  log('✅ SABİTLENEN + YILDIZLI MESAJLAR (G12) E2E GEÇTİ:');
  log('   • sabit: üyelere görünür şerit, canlı SSE, kaldırılabilir');
  log('   • yıldız: kişisel (bob görmez), Ayarlar listesi, reload-kalıcı (senkron)');
  log('   • metadata-only → sunucuda düz-metin yok (E2E korunur)');
  log('══════════════════════════════════════════');
}

main()
  .then(() => { server?.proc.kill(); process.exit(0); })
  .catch((e) => { console.error('\n❌ HATA:', e.message); server?.proc.kill(); process.exit(1); });
