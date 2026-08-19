# 📡 NarChat — Özel Ekip Sohbet Uygulaması

> Faz-1 **iskelet** (Marcus bootstrap, 2026-06-26). Çekirdek **E2E yazışma KANITLANDI**.
> Sahip: MERKÜR vault (`Kaynak/MERKUR/`). Plan: `~/.claude/plans/cryptic-discovering-valiant.md`.

## Ne çalışıyor (kanıtlı)
- **Sunucu = aptal relay + ciphertext deposu.** İçeriği ASLA çözmez (`mesaj_server.py`).
- **Uçtan-uca şifreli yazışma** (libsodium, şema `e2e1`): 1:1 + grup (3-4), uniform fan-out.
- Auth (pbkdf2-200k + HMAC oturum çerezi), oda modeli, SSE gerçek-zaman, PWA kabuğu (sw+manifest).
- **E2E TAM-AKIŞ TESTİ GEÇTİ** (`test/e2e_roundtrip.py`, PyNaCl=libsodium wire-uyumlu):
  üye doğru çözer · üye-olmayan çözemez+403 · **sunucu deposunda düz-metin YOK.**

## Mimari (e2e1 şeması)
İstemci: keypair cihazda (private→localStorage [prod: IndexedDB], public→sunucu).
Mesaj: `K=secretbox_keygen()` → `msg=secretbox(metin,n,K)`; her üye M için `encKey_M=box(K,n2,M.pub,gonderenPriv)`.
Blob `{sema,msg,n,gonderenPub,anahtarlar:[{uye,n2,anahtar}]}` sunucuya gider — sunucu opak saklar.
Çözme: `K=box_open(encKey_me,...)` → `metin=secretbox_open(msg,n,K)`. 1:1 ve grup AYNI yol.

## Çalıştırma (yerel, izole-port)
```bash
cd Kaynak/MERKUR/CIKTILAR/NarChat
NARCHAT_PORT=8101 python3 mesaj_server.py      # http://127.0.0.1:8101
# Test (izole venv + pynacl):
python3 -m venv /tmp/e2e && /tmp/e2e/bin/pip -q install pynacl
/tmp/e2e/bin/python test/e2e_roundtrip.py
```
`veri/` = oturum sırrı + kullanıcı/mesaj (gitignore'lu, GİZLİ). Silersen temiz başlar.

## Dosyalar
- `mesaj_server.py` — sunucu (stdlib + Web Push için `cryptography`).
- `static/{index.html,app.js,sw.js,manifest.webmanifest,ikon.svg}` — PWA istemci + E2E + push.
- `test/e2e_roundtrip.py` — Python tam-akış E2E kanıtı (wire-uyum, PyNaCl). `NARCHAT_PORT` ile izole.
- `test/browser_e2e.mjs` — **tarayıcı tam-akış E2E** (Playwright, gerçek app.js + gerçek UI).
- `test/push_test.py` — **Web Push tam-hat** kanıtı (mock endpoint; VAPID JWT + RFC8291 çöz).
- `deploy/` — Cloudflare tünel config + başlat/durdur script + deploy notları.

## ⏭ Faz-1 KALAN (MERKÜR/ASA devralır)
1. ✅ **Web Push GEÇTİ** (offline bildirim): kendi VAPID'imiz (RFC 8292 ES256) + RFC 8291 aes128gcm — **3.parti servis YOK**. Push gövdesi push servisine ŞİFRELİ gider (Apple/Google içeriği göremez); biz zaten yalnız genel "Yeni mesaj" koyuyoruz. `crypto` bağımlılığı: `cryptography` (kurulu). Köken: ELCI-PORTAL deseni. Kanıt: `test/push_test.py` (mock endpoint: VAPID JWT imza doğrulandı + gövde çözüldü + düz-metin sızıntısı yok). NOT: Push API tarayıcı incognito'da yok (test bağlamı) — gerçek tarayıcı/telefonda çalışır.
2. ✅ **IndexedDB + parola-koruması GEÇTİ:** özel anahtar artık IndexedDB'de **Argon2id'den türetilen anahtarla secretbox'lanıp** saklanıyor (düz-metin YOK). Reload'da kilit ekranı → parolayla açılır; yanlış parola reddedilir. libsodium **-sumo** build (pwhash içerir). Kanıt: `test/browser_e2e.mjs` adım 7.
3. ✅ **Tarayıcı E2E testi GEÇTİ** (`test/browser_e2e.mjs`, Playwright headful/headless): 2 ayrı cihaz-bağlamı gerçek UI'dan kayıt → 1:1 oda + canlı SSE → alice gönderdi, bob'un EKRANINDA çözüldü → depoda düz-metin YOK → üye-olmayan 403. Çalıştır: `node test/browser_e2e.mjs` (izole :8102, gerçek `veri/`'ye dokunmaz).
4. **UI cilası** (okundu/iletildi, zaman, avatar, oda-adı düzenleme) — kayıt sonrası 404 (manifest ikon yolu) burada giderilecek.
5. **Deploy** (Tayfun-kapısı): launchd + Cloudflare tünel → narchat.narchviz.com + APK (PUSULA boru hattı).

## ⏭ Faz-2+ (sonra)
WebRTC 1:1 ses/görüntü (STUN+coturn) → grup mesh 3-4. Aramalar zaten E2E (DTLS-SRTP).

## Güvenlik notları
- `veri/.gizli` (oturum HMAC sırrı) repo-dışı, mode 600. Asla commit etme.
- Sunucu mesaj içeriğini görmez; gizlilik istemci E2E'sinde. Kripto kütüphanesini (libsodium) DEĞİŞTİRME, kendi kripto yazma.
- Çok-cihaz: private key cihazda; yeni cihaz eski geçmişi anahtar taşınmadan okuyamaz (Faz-4 parola-yedek).
