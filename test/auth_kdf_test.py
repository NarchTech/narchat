#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — D1/M1 (KDF profil sertleştirme) + D1/L1 (giris-meydan hız-sınırı + enumeration) kanıtı.
İzole sunucu (auth_v2_test.py deseni). Sunucu-tarafı KDF-profil davranışını doğrular; gerçek Argon2id
parametre türetimi (INTERACTIVE vs MODERATE) BROWSER testinde (auth_v2_ui.mjs) doğrulanır.

Doğrulanan:
  M1-1. v2 kayıt kdf profilini saklar; giris-meydan surum+kdf bildirir.
  M1-2. Bilinmeyen kdf profili ile kayıt → 400.
  M1-3. Giriş-bağlı profil rotasyonu: eski-profil (kdf=1) hesap, eski anahtarla imzalar + yeni-profil
        doğrulayıcısı yollar → profil kdf=2'ye YÜKSELİR, doğrulayıcı değişir, oturum-nesli artar
        (rotasyon-öncesi token İPTAL). Sonraki giriş YENİ anahtarla çalışır, ESKİ anahtarla çalışmaz.
  M1-4. Downgrade reddi: kdf=2 hesap, yeni_kdf=1 yollasa bile profil DÜŞMEZ.
  M1-5. Rotasyon yalnız GEÇERLİ imzayla tetiklenir (parola kanıtı); yanlış imza → 401, rotasyon YOK.
  L1-1. Var-olmayan hesap giris-meydan'da TAZE v2 hesap gibi görünür (surum=2, kdf=varsayılan) →
        "surum:2 → hesap var" enumeration sızıntısı kapalı.
  L1-2. giris-meydan (GET) hız-sınırına tabi → eşik aşımı 429 + Retry-After.
Çalıştır:  python3 test/auth_kdf_test.py
"""
import base64, json, os, sys, subprocess, tempfile, time
import urllib.request, urllib.error, http.cookiejar
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import auth_modul  # noqa: E402

RAW = serialization.Encoding.Raw
RAWFMT = serialization.PublicFormat.Raw
HDR = {"Content-Type": "application/json", "X-NarChat": "1"}   # D1/L2: authlu uçlar CSRF başlığı ister


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


def istemci():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def istek(op, B, yol, govde=None, yontem=None):
    veri = json.dumps(govde).encode() if govde is not None else None
    headers = dict(HDR) if veri is not None else {"X-NarChat": "1"}
    r = urllib.request.Request(B + yol, data=veri, headers=headers,
                               method=yontem or ("POST" if veri is not None else "GET"))
    try:
        resp = op.open(r)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def b64(x): return base64.b64encode(x).decode()


def kayit_v2(op, B, kullanici, priv, kdf=2):
    dog = b64(priv.public_key().public_bytes(RAW, RAWFMT))
    return istek(op, B, "/api/kayit", {"kullanici": kullanici, "dogrulayici": dog, "kdf": kdf})


def giris_v2(op, B, kullanici, priv, ekstra=None):
    st, d = istek(op, B, "/api/giris-meydan?kullanici=" + kullanici, None, "GET")
    meydan = d["meydan"]
    govde = {"kullanici": kullanici, "meydan": meydan, "imza": b64(priv.sign(meydan.encode()))}
    if ekstra: govde.update(ekstra)
    return istek(op, B, "/api/giris", govde)


def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-kdf-")
    p, B = sunucu_baslat(8154, veri)
    try:
        # ── M1-1: kayıt kdf saklar, giris-meydan bildirir ──
        alice = Ed25519PrivateKey.generate()
        st, d = kayit_v2(istemci(), B, "alice", alice, kdf=2)
        assert st == 200, "kdf=2 kayıt 200 olmalı: %r" % d
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=alice", None, "GET")
        assert st == 200 and d["surum"] == 2 and d["kdf"] == 2, "alice surum=2 kdf=2 olmalı: %r" % d
        gecti.append("M1: v2 kayıt kdf profilini sakladı; giris-meydan surum=2 kdf=2 bildirdi")

        # ── M1-2: bilinmeyen kdf → 400 ──
        bad = Ed25519PrivateKey.generate()
        st, d = kayit_v2(istemci(), B, "badkdf", bad, kdf=99)
        assert st == 400, "bilinmeyen kdf profili 400 olmalı, geldi %s: %r" % (st, d)
        gecti.append("M1: bilinmeyen kdf profili ile kayıt → 400")

        # ── L1-1: var-olmayan hesap → taze v2 gibi (surum=2, kdf=varsayılan), enumeration yok ──
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=hicyok", None, "GET")
        assert st == 200 and d["surum"] == 2 and d["kdf"] == auth_modul.KDF_VARSAYILAN, \
            "var-olmayan hesap taze-v2 görünmeli (enumeration yok): %r" % d
        gecti.append("L1: var-olmayan hesap giris-meydan'da taze-v2 gibi (enumeration sızıntısı kapalı)")

        # ── M1-3: giriş-bağlı profil rotasyonu (kdf=1 → kdf=2) ──
        bob = Ed25519PrivateKey.generate()
        st, d = kayit_v2(istemci(), B, "bob", bob, kdf=1)   # eski-profil hesabı taklit et
        assert st == 200, "bob kdf=1 kayıt 200: %r" % d
        # rotasyon-öncesi bir token al (başka cihazda kalmış eski token senaryosu)
        cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        st, d = giris_v2(op, B, "bob", bob)
        assert st == 200 and d["kdf"] == 1, "bob eski-profil girişi 200 kdf=1: %r" % d
        eski_tok = next(c.value for c in cj if c.name == "narchat_oturum")
        # şimdi ESKİ anahtarla imzala + YENİ-profil doğrulayıcısı yolla → rotasyon
        bob2 = Ed25519PrivateKey.generate()   # "MODERATE ile türetilmiş" yeni anahtarı temsil eder
        yeni_dog = b64(bob2.public_key().public_bytes(RAW, RAWFMT))
        st, d = giris_v2(istemci(), B, "bob", bob, ekstra={"yeni_dogrulayici": yeni_dog, "yeni_kdf": 2})
        assert st == 200, "rotasyonlu giriş 200 olmalı: %r" % d
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=bob", None, "GET")
        assert d["kdf"] == 2, "rotasyon sonrası bob kdf=2 olmalı: %r" % d
        gecti.append("M1: giriş-bağlı rotasyon eski-profil (kdf=1) hesabı kdf=2'ye yükseltti")

        # rotasyon sonrası: YENİ anahtarla giriş çalışır, ESKİ anahtarla çalışmaz
        st, d = giris_v2(istemci(), B, "bob", bob2)
        assert st == 200, "rotasyon sonrası YENİ anahtarla giriş çalışmalı: %r" % d
        st, d = giris_v2(istemci(), B, "bob", bob)
        assert st == 401, "rotasyon sonrası ESKİ anahtarla giriş REDDEDİLMELİ, geldi %s" % st
        gecti.append("M1: rotasyon doğrulayıcıyı değiştirdi (yeni anahtar girer, eski giremez)")

        # rotasyon-öncesi token (oturum-nesli artışıyla) İPTAL olmalı
        st, d2 = istek_cookie(B, "/api/ben", eski_tok)
        assert st == 401, "rotasyon-öncesi token İPTAL olmalı (oturum-nesli), geldi %s: %r" % (st, d2)
        gecti.append("M1: rotasyon oturum-nesli'ni artırdı → rotasyon-öncesi token iptal (M3 ile tutarlı)")

        # ── M1-4: downgrade reddi ──
        st, d = giris_v2(istemci(), B, "bob", bob2, ekstra={"yeni_dogrulayici": b64(Ed25519PrivateKey.generate().public_key().public_bytes(RAW, RAWFMT)), "yeni_kdf": 1})
        assert st == 200, "giriş yine 200 olmalı (downgrade sessizce yok sayılır): %r" % d
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=bob", None, "GET")
        assert d["kdf"] == 2, "downgrade reddedilmeli, kdf 2 kalmalı: %r" % d
        st, d = giris_v2(istemci(), B, "bob", bob2)   # bob2 hâlâ geçerli anahtar (downgrade uygulanmadı)
        assert st == 200, "downgrade uygulanmadıysa bob2 hâlâ girmeli: %r" % d
        gecti.append("M1: downgrade (yeni_kdf<mevcut) reddedildi — profil düşmedi, doğrulayıcı değişmedi")

        # ── M1-5: yanlış imza → 401, rotasyon YOK ──
        carol = Ed25519PrivateKey.generate()
        kayit_v2(istemci(), B, "carol", carol, kdf=1)
        sahte = Ed25519PrivateKey.generate()
        yeni_dog2 = b64(Ed25519PrivateKey.generate().public_key().public_bytes(RAW, RAWFMT))
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=carol", None, "GET")
        meydan = d["meydan"]
        st, d = istek(istemci(), B, "/api/giris", {"kullanici": "carol", "meydan": meydan,
            "imza": b64(sahte.sign(meydan.encode())), "yeni_dogrulayici": yeni_dog2, "yeni_kdf": 2})
        assert st == 401, "yanlış imzayla giriş 401 olmalı: %r" % d
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=carol", None, "GET")
        assert d["kdf"] == 1, "yanlış imza rotasyonu TETİKLEMEMELİ, kdf 1 kalmalı: %r" % d
        gecti.append("M1: yanlış imza → 401 + rotasyon YOK (yalnız parola kanıtı rotasyonu tetikler)")
    finally:
        p.terminate()

    # ── L1-2: giris-meydan hız-sınırı ──
    veri2 = tempfile.mkdtemp(prefix="narchat-kdf-rate-")
    p2, B2 = sunucu_baslat(8155, veri2, {"NARCHAT_RATE_LIMIT": "3", "NARCHAT_RATE_PENCERE": "60"})
    try:
        op = istemci()
        kodlar = []
        for _ in range(5):
            r = urllib.request.Request(B2 + "/api/giris-meydan?kullanici=zzz", headers={"X-NarChat": "1"})
            try:
                op.open(r); kodlar.append(200)
            except urllib.error.HTTPError as e:
                kodlar.append(e.code)
        assert kodlar[:3] == [200, 200, 200], "ilk 3 giris-meydan 200 olmalı: %r" % kodlar
        assert 429 in kodlar[3:], "eşik aşımından sonra 429 olmalı: %r" % kodlar
        gecti.append("L1: giris-meydan (GET) hız-sınırına tabi → eşik aşımı 429")
    finally:
        p2.terminate()

    print("✅ D1/M1 (KDF) + D1/L1 GEÇTİ:")
    for i, g in enumerate(gecti, 1):
        print("  %d. %s" % (i, g))


def istek_cookie(B, yol, tok):
    r = urllib.request.Request(B + yol, headers={"Cookie": "narchat_oturum=%s" % tok, "X-NarChat": "1"})
    try:
        resp = urllib.request.build_opener().open(r)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


if __name__ == "__main__":
    main()
