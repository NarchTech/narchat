#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — path-traversal kanıtı (D1 Fable denetimi, bulgu H1 — YÜKSEK). İzole sunucu.
Bulgu: _kayit kullanıcı-adını karakter-denetimsiz kabul ediyordu + _profil'in avatar-yazma
yolunda _avatar_indir'deki (indirme) gibi bir normpath/containment koruması YOKTU → kötü niyetli
bir kullanıcı adıyla (ör. "../../../tmp/evil") AVATARDIR dışına keyfi dosya yazılabilirdi.
Doğrulanan:
  1. Kayıtta ".."/"/" içeren kullanıcı adı → 400 (whitelist reddeder)
  2. Boş, çok kısa (1 harf) ve çok uzun (33+ harf) kullanıcı adı → 400
  3. Normal (harf/rakam/_) kullanıcı adı → 200 (regresyon yok)
  4. Savunma-derinliği: _kayit'i bilerek atlayıp (mesaj_server._oturum_uret ile) doğrudan
     kötü-niyetli-adlı bir oturum token'ı sahtelenip /api/profil'e avatar yollanırsa →
     yazma-yolu containment kontrolü de reddeder (400) VE AVATARDIR dışında dosya OLUŞMAZ.
Çalıştır:  python3 test/yol_asimi_test.py
"""
import base64, json, os, sys, subprocess, tempfile, time
import urllib.request, urllib.error, http.cookiejar

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import mesaj_server as ms   # noqa: E402 — sys.path ayarından SONRA


def sunucu_baslat(port, veri):
    p = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
        env={**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri},
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


def istek(op, B, yol, govde=None, cookie=None):
    veri = json.dumps(govde).encode() if govde is not None else None
    headers = {"Content-Type": "application/json"} if veri else {}
    headers["X-NarChat"] = "1"   # D1/L2: authlu durum-değiştiren uçlar CSRF başlığı ister
    if cookie: headers["Cookie"] = "narchat_oturum=%s" % cookie
    r = urllib.request.Request(B + yol, data=veri, headers=headers,
                               method="POST" if veri is not None else "GET")
    try:
        resp = op.open(r)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def istemci():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def b64(x):
    return base64.b64encode(x).decode()


def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-yolasimi-")
    p, B = sunucu_baslat(8149, veri)
    try:
        # ── 1) ".."/"/" içeren kullanıcı adı → 400 ──
        kotu_adlar = ["../../../tmp/evil", "a/b", "..", "a..b/c", "kullanici\x00.bin"]
        for kad in kotu_adlar:
            st, d = istek(istemci(), B, "/api/kayit", {"kullanici": kad, "dogrulayici": b64(os.urandom(32))})
            assert st == 400, "kötü ad %r 400 olmalı, geldi %s: %r" % (kad, st, d)
        gecti.append("path-traversal/özel karakter içeren kullanıcı adları → 400 (whitelist reddetti)")

        # ── 1b) D1: Unicode-homograf adlar → 400 (str.isalnum() UNICODE'a açıktı; artık ASCII-kısıtlı) ──
        homograf = ["аdmin", "ɡoogle", "tayfun​", "adｍin"]  # Kiril а, Latin-küçük ɡ, ZWSP, fullwidth d
        for kad in homograf:
            st, d = istek(istemci(), B, "/api/kayit", {"kullanici": kad, "dogrulayici": b64(os.urandom(32))})
            assert st == 400, "homograf ad %r 400 olmalı (ASCII-kısıt), geldi %s: %r" % (kad, st, d)
        gecti.append("D1: Unicode-homograf/gizli-karakter kullanıcı adları → 400 (ASCII-kısıt)")

        # ── 2) boş, çok kısa, çok uzun ──
        st, d = istek(istemci(), B, "/api/kayit", {"kullanici": "a", "dogrulayici": b64(os.urandom(32))})
        assert st == 400, "1 harfli ad 400 olmalı: %s" % st
        st, d = istek(istemci(), B, "/api/kayit", {"kullanici": "x" * 33, "dogrulayici": b64(os.urandom(32))})
        assert st == 400, "33 harfli ad 400 olmalı: %s" % st
        gecti.append("çok kısa (<2) / çok uzun (>32) kullanıcı adı → 400")

        # ── 3) normal kullanıcı adı → 200 (regresyon yok) ──
        st, d = istek(istemci(), B, "/api/kayit", {"kullanici": "gulperi_92", "dogrulayici": b64(os.urandom(32))})
        assert st == 200, "geçerli kullanıcı adı 200 olmalı: %s %r" % (st, d)
        gecti.append("normal kullanıcı adı (harf/rakam/_) → 200 (regresyon yok)")

        # ── 4) savunma-derinliği: _kayit'i atla, kötü-niyetli-adlı sahte oturum token'ı üret ──
        kotu_kullanici = "../../../../tmp/narchat-yolasimi-pwn"
        # testin kendi sürecinde SIR hiç dolmaz (init() ayrı sunucu sürecinde çalıştı) — sunucuyla
        # AYNI .gizli dosyasını (aynı veri dizini) okuyup aynı imza sırrıyla token üret.
        with open(os.path.join(veri, ".gizli"), "rb") as f:
            ms.SIR = f.read()
        sahte_tok = ms._oturum_uret(kotu_kullanici)
        st, d = istek(istemci(), B, "/api/profil", {"avatar": b64(b"PWNED"), "avatar_mime": "image/png"}, cookie=sahte_tok)
        # kayıt dışından gelen bu kullanıcı kull.json'da YOK → 404 "yok" beklenir (kim not in kull)
        assert st == 404, "kayıtsız (sahte) kullanıcı 404 vermeli, geldi %s: %r" % (st, d)
        gecti.append("sahte oturum + kayıtsız kötü-niyetli kullanıcı → 404 (kull.json'da yok)")

        # kayıtsız kullanıcı zaten 404'te durduruluyor; şimdi containment'ı GERÇEKTEN test etmek için
        # kull.json'a doğrudan (bir _kayit atlanarak) kötü-adlı bir hesap enjekte et — güvenlik açığının
        # KENDİSİ olmasa da savunma-derinliği katmanının (yazma-yolu containment) bağımsız çalıştığını kanıtlar.
        kull_yolu = os.path.join(veri, "kullanicilar.json")
        kull = json.load(open(kull_yolu, encoding="utf-8")) if os.path.exists(kull_yolu) else {}
        kull[kotu_kullanici] = {"surum": 2, "dogrulayici": b64(os.urandom(32)), "olusturma": int(time.time())}
        with open(kull_yolu, "w", encoding="utf-8") as f:
            json.dump(kull, f)
        st, d = istek(istemci(), B, "/api/profil", {"avatar": b64(b"PWNED"), "avatar_mime": "image/png"}, cookie=sahte_tok)
        assert st == 400, "containment kontrolü kötü-niyetli kim'i reddetmeli, geldi %s: %r" % (st, d)
        disari_yol = os.path.normpath(os.path.join(veri, "avatar", "..", "..", "..", "..", "tmp", "narchat-yolasimi-pwn.bin"))
        assert not os.path.exists(disari_yol), "AVATARDIR dışına dosya YAZILMAMALIYDI: %s" % disari_yol
        gecti.append("savunma-derinliği: containment kontrolü kötü-niyetli kim'i reddetti — AVATARDIR dışına dosya YAZILMADI")
    finally:
        p.terminate()

    print("✅ PATH-TRAVERSAL (D1 bulgu H1) YAMASI GEÇTİ:")
    for i, g in enumerate(gecti, 1):
        print("  %d. %s" % (i, g))


if __name__ == "__main__":
    main()
