#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — CORS kanıtı (FAZ N3, bundled Capacitor). İzole sunucu, yalnız stdlib.
Doğrulanan:
  1. OPTIONS preflight, allowlist'teki origin (https://localhost) → 204 + Allow-Origin/Credentials/Methods/Headers
  2. OPTIONS preflight, allowlist-DIŞI origin → 204 ama CORS başlıkları YOK (tarayıcı asıl isteği engeller)
  3. GET (auth-siz /api/vapid), allowlist origin → yanıtta Access-Control-Allow-Origin + Allow-Credentials var
  4. Aynı GET, allowlist-dışı origin → CORS başlıkları YOK
  5. Aynı GET, Origin header YOK (normal aynı-origin tarayıcı davranışı) → CORS başlıkları YOK, davranış değişmedi
  6. Giriş sonrası Set-Cookie: allowlist origin → SameSite=None; Secure ; allowlist-dışı/Origin'siz → SameSite=Lax (DEĞİŞMEDİ)
Çalıştır:  python3 test/cors_test.py
"""
import json, os, sys, time, base64, secrets, subprocess, tempfile
import urllib.request, urllib.error, http.cookiejar

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOW = "https://localhost"
DENY = "https://evil.example"

def sunucu_baslat(port, veri, extra_env=None):
    env = {**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri}
    if extra_env: env.update(extra_env)
    p = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    B = "http://127.0.0.1:%d" % port
    for _ in range(50):
        try:
            urllib.request.urlopen(B + "/api/ben"); break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(0.1)
    return p, B

def istek(B, yol, yontem="GET", origin=None, govde=None):
    """(status, headers) döndürür — headers bir email.message.Message (case-insensitive .get)."""
    veri = json.dumps(govde).encode() if govde is not None else None
    headers = {"Content-Type": "application/json"} if veri is not None else {}
    if origin: headers["Origin"] = origin
    r = urllib.request.Request(B + yol, data=veri, headers=headers, method=yontem)
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.headers

def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-cors-")
    p, B = sunucu_baslat(8144, veri)
    try:
        # ── 1) OPTIONS preflight, izinli origin ──
        st, h = istek(B, "/api/kayit", "OPTIONS", origin=ALLOW)
        assert st == 204, "izinli origin preflight 204 olmalı, geldi %s" % st
        assert h.get("Access-Control-Allow-Origin") == ALLOW, "Allow-Origin yansıtılmalı: %r" % h.get("Access-Control-Allow-Origin")
        assert h.get("Access-Control-Allow-Credentials") == "true", "Allow-Credentials true olmalı"
        assert "POST" in (h.get("Access-Control-Allow-Methods") or ""), "Allow-Methods POST içermeli"
        assert "Content-Type" in (h.get("Access-Control-Allow-Headers") or ""), "Allow-Headers Content-Type içermeli"
        # Bundled app CSRF başlığını (X-NarChat) cross-origin yollar → preflight izin vermezse uyumlu WebView düşürür.
        assert "X-NarChat" in (h.get("Access-Control-Allow-Headers") or ""), \
            "Allow-Headers X-NarChat içermeli (bundled app tüm authlu + N2 faucet çağrılarında yollar)"
        gecti.append("OPTIONS preflight (izinli origin %s) → 204 + tam CORS başlıkları (X-NarChat dahil)" % ALLOW)

        # ── 2) OPTIONS preflight, izinsiz origin ──
        st, h = istek(B, "/api/kayit", "OPTIONS", origin=DENY)
        assert st == 204, "izinsiz origin'de bile preflight yanıtı 204 olmalı (başlıksız), geldi %s" % st
        assert h.get("Access-Control-Allow-Origin") is None, "izinsiz origin'e Allow-Origin YANSITILMAMALI"
        gecti.append("OPTIONS preflight (izinsiz origin %s) → 204 ama CORS başlığı YOK" % DENY)

        # ── 3) GET /api/vapid (auth-siz), izinli origin ──
        st, h = istek(B, "/api/vapid", "GET", origin=ALLOW)
        assert st == 200
        assert h.get("Access-Control-Allow-Origin") == ALLOW, "GET yanıtında Allow-Origin yansıtılmalı"
        assert h.get("Access-Control-Allow-Credentials") == "true"
        gecti.append("GET /api/vapid (izinli origin) → Access-Control-Allow-Origin/Credentials var")

        # ── 4) GET /api/vapid, izinsiz origin ──
        st, h = istek(B, "/api/vapid", "GET", origin=DENY)
        assert st == 200
        assert h.get("Access-Control-Allow-Origin") is None, "izinsiz origin'e CORS başlığı sızmamalı"
        gecti.append("GET /api/vapid (izinsiz origin %s) → CORS başlığı YOK" % DENY)

        # ── 5) GET /api/vapid, Origin YOK (normal aynı-origin tarayıcı) ──
        st, h = istek(B, "/api/vapid", "GET", origin=None)
        assert st == 200
        assert h.get("Access-Control-Allow-Origin") is None, "Origin yokken CORS başlığı olmamalı (davranış değişmemeli)"
        gecti.append("GET /api/vapid (Origin header yok — normal web) → CORS başlığı yok, değişiklik yok")

        # ── 6) Set-Cookie SameSite: izinli origin → None; Secure ; izinsiz/yok → Lax (DEĞİŞMEDİ) ──
        dogrulayici = base64.b64encode(secrets.token_bytes(32)).decode()
        st, h = istek(B, "/api/kayit", "POST", origin=ALLOW,
                      govde={"kullanici": "corsli", "dogrulayici": dogrulayici})
        assert st == 200, "kayıt 200 olmalı: %s" % st
        sc = h.get("Set-Cookie") or ""
        assert "SameSite=None" in sc and "Secure" in sc, "izinli origin'de SameSite=None; Secure olmalı: %r" % sc
        gecti.append("giriş sonrası Set-Cookie (izinli origin) → SameSite=None; Secure")

        dogrulayici2 = base64.b64encode(secrets.token_bytes(32)).decode()
        st, h = istek(B, "/api/kayit", "POST", origin=None,
                      govde={"kullanici": "webli", "dogrulayici": dogrulayici2})
        assert st == 200
        sc2 = h.get("Set-Cookie") or ""
        assert "SameSite=Lax" in sc2 and "SameSite=None" not in sc2, "normal web girişinde SameSite=Lax KORUNMALI: %r" % sc2
        gecti.append("giriş sonrası Set-Cookie (Origin yok — normal web) → SameSite=Lax (DEĞİŞMEDİ)")
    finally:
        p.terminate()

    # ── D1/L3: CORS test-kancası AÇIK bayrağa kilitli ──
    # NARCHAT_CORS_TEST_ORIGIN tek başına (NARCHAT_TEST_HOOKS olmadan) allowlist'i DEĞİŞTİRMEMELİ →
    # env yanlışlıkla prod'a sızsa bile keyfi credential'lı origin enjekte edilemez.
    veri2 = tempfile.mkdtemp(prefix="narchat-cors-l3a-")
    p2, B2 = sunucu_baslat(8145, veri2, {"NARCHAT_CORS_TEST_ORIGIN": DENY})   # hooks YOK
    try:
        st, h = istek(B2, "/api/vapid", "GET", origin=DENY)
        assert st == 200 and h.get("Access-Control-Allow-Origin") is None, \
            "L3: TEST_HOOKS olmadan test-origin allowlist'e GİRMEMELİ: %r" % h.get("Access-Control-Allow-Origin")
        gecti.append("L3: NARCHAT_CORS_TEST_ORIGIN tek başına (hooks yok) → kanca inert, origin reddedildi")
    finally:
        p2.terminate()

    # İki bayrak da set → kanca çalışır (test yolunun hâlâ işlevsel olduğunu doğrula).
    veri3 = tempfile.mkdtemp(prefix="narchat-cors-l3b-")
    p3, B3 = sunucu_baslat(8146, veri3, {"NARCHAT_CORS_TEST_ORIGIN": DENY, "NARCHAT_TEST_HOOKS": "1"})
    try:
        st, h = istek(B3, "/api/vapid", "GET", origin=DENY)
        assert st == 200 and h.get("Access-Control-Allow-Origin") == DENY, \
            "L3: iki bayrak da set iken test-origin allowlist'e girmeli (test yolu işlevsel): %r" % h.get("Access-Control-Allow-Origin")
        gecti.append("L3: NARCHAT_CORS_TEST_ORIGIN + NARCHAT_TEST_HOOKS=1 → kanca çalışır (test yolu korunur)")
    finally:
        p3.terminate()

    print("✅ CORS (FAZ N3) + D1/L3 GEÇTİ:")
    for i, g in enumerate(gecti, 1): print("  %d. %s" % (i, g))

if __name__ == "__main__":
    main()
