// NarChat — kurulum.js (PWA kurulum yardımcısı). Amaç: "Ana ekrana ekle"yi bilmeyen/bulamayan
// kullanıcıyı tek tuşa indirmek. Chrome/Edge/Android → beforeinstallprompt ile GERÇEK tek-tuş
// kurulum; iOS → Apple programatik kurulumu engeller (API yok) → adım-adım görsel rehber.
// iOS rehberinin kalbi: Safari, sekmede kalan sitelerin verisini 7 gün kullanılmayınca silebilir;
// E2E anahtarı o veride durur → silinirse konuşmalar GERİ GETİRİLEMEZ. Ana-ekran kurulumu bu
// silmeden muaf + Safari sekmesiyle kurulu uygulama AYRI depo kullanır → "önce kur, sonra kayıt ol".
// E2E çekirdeğinden (app.js) tamamen bağımsızdır; yalnız görünürlük + kurulum-akışı yönetir.

const $ = (id) => document.getElementById(id);

const nativeMi = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const standaloneMi = () =>
  (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

const ua = navigator.userAgent;
// iPadOS 13+ kendini "MacIntel" olarak tanıtır → dokunmatik nokta sayısıyla ayırt edilir.
const iosMu = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const androidMi = /Android/i.test(ua);
const iosSafariMi = iosMu && !/CriOS|FxiOS|EdgiOS|OPT\//.test(ua);   // iOS'ta Safari-dışı tarayıcılar UA'ya kendi imzasını ekler

let kurulumSozu = null;   // beforeinstallprompt olayı (Chrome/Edge/Android) — geldiyse tek-tuş mümkün

// ── giriş-ekranı banner'ı: platforma göre TEK uygun eylemi göster ──
function bannerCiz(){
  const b = $('kurulumBanner');
  if (!b) return;
  if (nativeMi || standaloneMi()){ b.classList.add('gizli'); return; }
  b.classList.remove('gizli');

  if (kurulumSozu){
    // Chrome/Edge/Android: gerçek tek-tuş — işletim sisteminin kendi kurulum penceresi açılır.
    b.innerHTML = '<button id="tekTusKurBtn" class="tam kurulum-btn">📲 Uygulamayı kur — tek tuş</button>' +
      '<p class="ince">Ana ekranına/masaüstüne eklenir, kendi penceresinde uygulama gibi açılır.</p>';
    $('tekTusKurBtn').onclick = tekTusKur;
  } else if (iosMu){
    // iOS: tek-tuş YOK (Apple engeli) → dürüst uyarı + detaylı rehber.
    b.innerHTML = '<button id="iosRehberBtn" class="tam kurulum-btn">📲 iPhone/iPad\'e kur — adım adım rehber</button>' +
      '<p class="ince kurulum-uyari-satir">⚠️ iPhone\'da <b>önce kur, sonra kayıt ol</b> — Safari sekmesinde kalan hesabın ' +
      'verisi 7 gün kullanılmayınca silinebilir ve konuşmalar <b>geri getirilemez</b>. Rehber 1 dakikanı alır.</p>';
    $('iosRehberBtn').onclick = () => rehberAc('iosRehber');
  } else if (androidMi){
    // Android ama beforeinstallprompt (henüz) yok (ör. Firefox) → hazır APK'ya yönlendir.
    b.innerHTML = '<a href="/apk/NarChat.apk" class="tam kurulum-btn kurulum-apk" download>🤖 Android uygulamasını indir (APK)</a>' +
      '<p class="ince">İndirilen dosyaya dokun → kur. Chrome kullanıyorsan sayfayı yenileyince tek-tuş kurulum da çıkabilir.</p>';
  } else {
    // Masaüstü, kurulum-API'siz tarayıcı (Safari/Firefox) → kısa rehber.
    b.innerHTML = '<button id="masaRehberBtn" class="tam kurulum-btn">🖥️ Bilgisayara uygulama gibi kur — nasıl?</button>';
    $('masaRehberBtn').onclick = () => rehberAc('masaRehber');
  }
}

async function tekTusKur(){
  const e = kurulumSozu;
  if (!e) return;
  kurulumSozu = null;
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') { kurulumSozu = e; bannerCiz(); }   // vazgeçti → düğme kalsın
  } catch (_) { bannerCiz(); }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // tarayıcının kendi mini-çubuğu yerine bizim belirgin düğmemiz
  kurulumSozu = e;
  bannerCiz(); ayarKartCiz();
});
window.addEventListener('appinstalled', () => {
  kurulumSozu = null;
  const b = $('kurulumBanner');
  if (b){ b.classList.remove('gizli'); b.innerHTML = '<p class="ince">✅ Kuruldu! Artık NarChat\'i ana ekranındaki / menündeki simgeden aç.</p>'; }
  ayarKartCiz();
});

// ── rehber overlay'leri ──
function rehberAc(id){ const r = $(id); if (r) r.classList.remove('gizli'); }
function rehberKapat(id){ const r = $(id); if (r) r.classList.add('gizli'); }
['iosRehber', 'masaRehber'].forEach(id => {
  const kapat = $(id + 'Kapat');
  if (kapat) kapat.onclick = () => rehberKapat(id);
  const r = $(id);
  if (r) r.addEventListener('click', (e) => { if (e.target === r) rehberKapat(id); });
});
// iOS rehberinde Safari-dışı tarayıcı notu yalnız gerekince görünür.
if (iosMu && !iosSafariMi){ const n = $('iosSafariDegilNot'); if (n) n.classList.remove('gizli'); }

// ── Ayarlar kartı: kurulum durumu + aynı eylemler uygulama içinden de erişilebilir ──
function ayarKartCiz(){
  const kart = $('kurulumAyarKart'), durum = $('kurulumAyarDurum'), btn = $('kurulumAyarBtn');
  if (!kart) return;
  if (nativeMi){ kart.classList.add('gizli'); return; }            // APK'da kurulum konusu yok
  if (standaloneMi()){
    durum.textContent = 'Kurulu ✓ — bu pencere kurulu uygulama';
    btn.classList.add('gizli');
    return;
  }
  btn.classList.remove('gizli');
  if (kurulumSozu){ durum.textContent = 'Tek tuşla ana ekranına/masaüstüne ekle'; btn.textContent = 'Kur'; btn.onclick = tekTusKur; }
  else if (iosMu){ durum.textContent = '⚠️ Kurulu değil — Safari verisi 7 günde silinebilir'; btn.textContent = 'Rehber'; btn.onclick = () => rehberAc('iosRehber'); }
  else if (androidMi){ durum.textContent = 'Android uygulaması hazır'; btn.textContent = 'APK indir'; btn.onclick = () => { location.href = '/apk/NarChat.apk'; }; }
  else { durum.textContent = 'Tarayıcından uygulama gibi kur'; btn.textContent = 'Nasıl?'; btn.onclick = () => rehberAc('masaRehber'); }
}

bannerCiz();
ayarKartCiz();
