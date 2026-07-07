#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — auth oran-sınırı (rate limit) kanıtı (Adım 5c). İzole sunucu.
Doğrulanan:
  1. Sınır altındaki kayıt denemeleri geçer (200)
  2. Sınır aşılınca → 429 + Retry-After başlığı
  3. Kova kayıt+giriş için ORTAK → giriş de aynı pencerede 429 olur (kaba-kuvvet kapanır)
  4. NARCHAT_RATE_LIMIT=0 → sınır KAPALI (meşru akış/izole test takılmaz)
Çalıştır:  python3 test/oran_test.py   (yalnız stdlib)
Not: ana 5 test takımı varsayılan cömert eşikle (30/60s) zaten <30 çağrı yaptığı için takılmaz;
     bu test sınırı düşürerek (3) davranışı hızlı+deterministik kanıtlar.
"""
import json, os, sys, time, subprocess, tempfile, urllib.request, urllib.error, http.cookiejar, base64, secrets

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def sunucu_baslat(port, veri, limit):
    p = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
        env={**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri,
             "NARCHAT_RATE_LIMIT": str(limit), "NARCHAT_RATE_PENCERE": "60"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    B = "http://127.0.0.1:%d" % port
    for _ in range(50):
        try:
            urllib.request.urlopen(B + "/api/ben"); break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(0.1)
    return p, B

def dene(B, yol, kullanici, parola="1234"):
    """(status, retry_after) döndürür. N1: kayıt v2 — sahte doğrulayıcı de eklenir (giriş yolunu etkilemez)."""
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    govde = {"kullanici": kullanici, "parola": parola, "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()}
    r = urllib.request.Request(B + yol, data=json.dumps(govde).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        resp = op.open(r); return resp.status, resp.headers.get("Retry-After")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Retry-After")

def main():
    gecti = []
    # ── sınırlı sunucu: limit=3 / 60s ──
    veri = tempfile.mkdtemp(prefix="narchat-oran-")
    p, B = sunucu_baslat(8110, veri, limit=3)
    try:
        for i in range(1, 4):                       # ilk 3 deneme geçmeli
            st, _ = dene(B, "/api/kayit", "kul%d" % i)
            assert st == 200, "sınır-altı kayıt %d 200 olmalı, geldi %s" % (i, st)
        gecti.append("sınır-altı 3 kayıt → 200")

        st, ra = dene(B, "/api/kayit", "kul4")      # 4. → 429
        assert st == 429, "sınır aşımı 429 olmalı, geldi %s" % st
        assert ra == "60", "429 Retry-After=60 olmalı, geldi %s" % ra
        gecti.append("sınır aşıldı → 429 + Retry-After:60")

        st, _ = dene(B, "/api/giris", "kul1")       # giriş de ORTAK kovada → 429
        assert st == 429, "ortak kova: giriş de 429 olmalı, geldi %s" % st
        gecti.append("kayıt+giriş ortak kova → giriş de 429 (kaba-kuvvet kapanır)")
    finally:
        p.terminate()

    # ── sınır KAPALI: limit=0 ──
    veri2 = tempfile.mkdtemp(prefix="narchat-oran0-")
    p2, B2 = sunucu_baslat(8111, veri2, limit=0)
    try:
        for i in range(1, 7):                        # 6 deneme, hiçbiri 429 olmamalı
            st, _ = dene(B2, "/api/kayit", "acik%d" % i)
            assert st != 429, "limit=0 iken 429 OLMAMALI (deneme %d), geldi %s" % (i, st)
        gecti.append("NARCHAT_RATE_LIMIT=0 → sınır kapalı (6 deneme, 429 yok)")
    finally:
        p2.terminate()

    print("✅ AUTH ORAN-SINIRI GEÇTİ:")
    for i, g in enumerate(gecti, 1): print("  %d. %s" % (i, g))

if __name__ == "__main__":
    main()
