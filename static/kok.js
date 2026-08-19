// NarChat — kok.js (FAZ N3: bundled Capacitor). Bundled APK'da capacitor.config.json'dan
// server.url kaldırıldığı için istemci kendi bundled dosyalarından (https://localhost) açılır ama
// API sunucusu FARKLI bir origin'de (https://chat.narchtech.com — sabit backend) kalır — bu yüzden native'de
// tüm /api/ isteklerine gerçek sunucu adresi önekli gitmesi gerekir. Webde (PWA/tarayıcı) API_KOK
// boş kalır — davranış DEĞİŞMEZ (aynı-origin, mevcut Cloudflare tüneli üzerinden).
// window.Capacitor native WebView tarafından sayfa yüklenmeden ÖNCE otomatik enjekte edilir
// (script include gerekmez); web'de bu global hiç var olmaz.
export const API_KOK =
  (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? 'https://chat.narchtech.com' : '';
