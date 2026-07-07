# NarChat — Android APK Build (Capacitor) · FAZ N3 güncel (H4'ten devraldı)

**FAZ N3 (5 Tem) mimari değişikliği:** APK artık canlı URL'yi saran bir WebView DEĞİL —
**bundled**: `static/`'in tam bir kopyası APK'nın içine gömülür (`npm run build:www` →
`www/` → `npx cap sync android`), uygulama **kendi dosyalarından** (`https://localhost`
sabit origin) açılır. API sunucusu (`https://narchat.narchviz.com`) **farklı bir origin**
olduğu için istemci `API_KOK` öneki (native'de gerçek sunucu adresi, webde boş — bkz
`static/kok.js`) ile **cross-origin** istek atar; sunucu tarafında yeni bir **CORS katmanı**
(SABİT allowlist: `https://localhost` + `capacitor://localhost`, preflight/OPTIONS +
`SameSite=None; Secure` çerez — yalnız bu origin'ler için) bunu karşılar. Mağazasız,
kendi sitemizden imzalı APK dağıtımı hedefi böyle mümkün oluyor (internet olmadan da
uygulama açılır — yalnız API çağrıları başarısız olur). PWA ve APK **tek kaynaktan**
(`static/`) türetilir; web'de davranış hiç değişmedi (aynı-origin, `API_KOK` boş kalır).

## Üretilen
- `capacitor.config.json` — appId `com.narchviz.narchat`, `server.url` YOK (webDir'den açılır)
- `www/` — **build artifact**, git'e girmez (`npm run build:www` = `static/`'in birebir kopyası)
- `android/` — native proje; izinler `android/app/src/main/AndroidManifest.xml`'de
  (INTERNET·CAMERA·RECORD_AUDIO·MODIFY_AUDIO_SETTINGS·VIBRATE·POST_NOTIFICATIONS·ACCESS_NETWORK_STATE)
- nar logosu → adaptive launcher ikon + splash (light/dark), `@capacitor/assets` ile

## Araç zinciri (29 Haz, bu Mac'te kuruldu — sudo'suz)
- **JDK 21** (Capacitor 8 şartı; 17 ile `invalid source release: 21` hatası):
  `brew install openjdk@21` → `/opt/homebrew/opt/openjdk@21`
- **Android SDK** (command-line tools, homebrew prefix):
  `brew install --cask android-commandlinetools` → `/opt/homebrew/share/android-commandlinetools`
- **SDK paketleri:** `platform-tools` · `platforms;android-36` · `build-tools;36.0.0`

## APK'yı yeniden üret (debug)
```bash
cd CIKTILAR/NarChat
npm run build:www                          # static/'i www/'e kopyala (tek kaynak)
npx cap sync android                       # web assets + config'i native projeye taşı
cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "sdk.dir=$ANDROID_HOME" > local.properties     # (gitignore'lu)
./gradlew assembleDebug --no-daemon
# çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

## Telefona kur (demo)
1. APK'yı telefona aktar (USB / Drive / WhatsApp-kendine).
2. Ayarlar → "Bilinmeyen kaynaklara izin ver" (sadece bu yükleme için).
3. APK'ya dokun → Kur → aç. İlk açılışta kamera/mikrofon/bildirim izinlerini ver.

## İmzalı RELEASE build (FAZ N4, 5 Tem — Tayfun GO verdi)
Keystore `<keystore-dizini>/narchat-release.keystore` (repo-DIŞI, gitignore'lu; **PKCS12** —
store/key parolası AYNI). Parola: `<keystore-dizini>/narchat-release-keystore-SIFRELER.txt`
(600, repo-dışı — **bu dosyayı bir parola yöneticisine taşı, sonra diskten sil**). Yol+parola
`android/keystore.properties`'te (gitignore'lu) — dosya yoksa release derlemesi imzasız kalır,
debug ETKİLENMEZ.
```bash
cd CIKTILAR/NarChat
npm run build:www && npx cap sync android
cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon
# çıktı: android/app/build/outputs/apk/release/app-release.apk (imzalı)
# doğrula: $ANDROID_HOME/build-tools/<surum>/apksigner verify --print-certs app-release.apk
```
**🚨 KEYSTORE KAYBOLURSA gelecekteki güncellemeler İMZALANAMAZ** (Android aynı imzayı ister —
yeni keystore = kullanıcılar için "farklı uygulama", herkes yeniden kurmak zorunda kalır).
**Tayfun: `<keystore-dizini>` klasörünü (2 dosya) GÜVENLİ bir yere (parola yöneticisi/şifreli
yedek) taşı, sonra bu Mac'teki düz-metin parola dosyasını sil.**

**Dağıtım mekanizması hazır ama KAPALI:** `mesaj_server.py` `.apk` MIME tipini tanır
(`application/vnd.android.package-archive`); `static/apk/` gitignore'lu ve **şu an BOŞ**.
Cihaz-testi geçmeden APK oraya konmaz/`kod.html`den bağlanmaz (kamuya-dağıtım = Tayfun-kapısı,
bkz aşağı). Teslim kopyası: `CIKTILAR/NarChat-APK/NarChat-release.apk` (yalnız yerel, web'den
erişilmez) — Tayfun buradan alıp kendi cihazına USB/Drive ile kurar.

## Notlar
- **Debug imza** demo için yeter; **release imza** yukarıdaki N4 bölümünde.
- **iOS:** $99 Apple hesabı + Xcode gelince `npx cap add ios` ile aynı yaklaşım (aynı bundled+CORS deseni).
- **Native push** (kilitli-telefon arama zili) Web Push WebView'da kısıtlı olabilir →
  ileride `@capacitor/push-notifications` + FCM (yatırım/zaman sonrası). Demo için app-içi/Web Push yeter.
- **Web Push tamamen yok bundled'da:** SW kaydı native'de bilerek atlanır (`app.js`: `if (!API_KOK && ...)`) —
  app açıkken SSE zili çalışır, kapalıyken bildirim gelmez (N3 bilinen sınır, FCM ertelendi).
- **CORS allowlist'i GENİŞLETME:** yalnız `https://localhost`/`capacitor://localhost`. Yeni bir native
  origin (ör. farklı appId/scheme) eklenirse `mesaj_server.py`'deki `CORS_ALLOWLIST`'e BİLİNÇLİ eklenmeli.

## 🚪 Tayfun-kapıları (N3 + N4)
1. **E2 cihaz-testi (N3):** `CIKTILAR/NarChat-APK/NarChat-debug.apk` (ya da release) **gerçek
   cihazda henüz test edilmedi**. Doğrulanacaklar: açılış (kendi dosyalarından, internet
   gerekmeden UI görünür) · kayıt/giriş (cross-origin CORS+cookie gerçekten çalışıyor mu) ·
   mesaj gönder/al · kamera-mikrofon izin promptu. Sorun çıkarsa `adb logcat` ile CORS/network
   hatası ara (`chrome://inspect` ile WebView konsolu da bağlanabilir).
2. **Keystore yedeği (N4):** `<keystore-dizini>` (keystore + parola dosyası) güvenli bir yere
   taşınmalı — kaybolursa gelecekteki güncellemeler imzalanamaz.
3. **Kamuya-dağıtım (N4):** E2 geçmeden `static/apk/`'ye dosya konmaz. E2 geçtikten SONRA:
   `CIKTILAR/NarChat-APK/NarChat-release.apk`'yi `static/apk/`'ye kopyala + `kod.html`'deki
   "yakında" notunu gerçek indirme linkine çevir + kickstart + edge doğrula.
