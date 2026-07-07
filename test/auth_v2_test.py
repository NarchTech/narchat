#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — sıfır-bilgi auth v2 kanıtı (FAZ N1). İzole sunucu (davet_test.py deseni).
Doğrulanan:
  1. v2 kayıt (yalnız doğrulayıcı/public-anahtar gider) + meydan/imza ile giriş → 200
  2. Yanlış imza (başka anahtarla imzalanmış) → 401
  3. Aynı meydan tekrar gönderilirse (replay) → 401 (tek-kullanımlık)
  4. Süresi dolmuş meydan → 401
  5. v1 (eski, göç-öncesi) hesap: parola ile giriş HÂLÂ çalışır (fallback) → giriş sonrası
     /api/auth-yukselt ile v2'ye yükselir → sonraki girişler v2 (imza) ile çalışır;
     eski salt/hash kaydı D1/M2 gereği HEMEN silinir (artık bekletilmiyor).
  6. D1/M3: yükseltme bir güvenlik olayı sayılır — oturum nesli artar, yükseltme ANINDA yeni
     çerez döner (bu oturum kesintisiz sürer) AMA yükseltme-ÖNCESİ eski çerez artık GEÇERSİZDİR
     (başka bir yerde ele geçmiş bir token varsa yükseltmeyle otomatik iptal olur).
Çalıştır:  python3 test/auth_v2_test.py   (yalnız stdlib + cryptography — sunucu zaten kullanıyor)
"""
import base64, json, os, sys, subprocess, tempfile, time
import urllib.request, urllib.error, http.cookiejar
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import auth_modul   # noqa: E402 — sys.path ayarından SONRA (kök dizindeki gerçek modül)

RAW = serialization.Encoding.Raw
RAWFMT = serialization.PublicFormat.Raw


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


def istemci():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def istek(op, B, yol, govde=None, yontem=None, cookie=None):
    """(status, json) döndürür — HTTPError'ı da yakalar (durum kodu lazım)."""
    veri = json.dumps(govde).encode() if govde is not None else None
    headers = {"Content-Type": "application/json"} if veri else {}
    headers["X-NarChat"] = "1"   # D1/L2: authlu durum-değiştiren uçlar CSRF başlığı ister
    if cookie: headers["Cookie"] = "narchat_oturum=%s" % cookie
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


def b64(x):
    return base64.b64encode(x).decode()


def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-authv2-")
    p, B = sunucu_baslat(8138, veri)
    try:
        # ── 1) v2 kayıt + meydan/imza ile giriş ──
        priv = Ed25519PrivateKey.generate()
        dogrulayici = b64(priv.public_key().public_bytes(RAW, RAWFMT))
        st, d = istek(istemci(), B, "/api/kayit", {"kullanici": "alice", "dogrulayici": dogrulayici})
        assert st == 200, "v2 kayıt 200 olmalı, geldi %s: %r" % (st, d)
        gecti.append("v2 kayıt (yalnız doğrulayıcı, parola gitmedi) → 200")

        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=alice", None, "GET")
        assert st == 200 and d["surum"] == 2, "alice v2 olmalı: %r" % d
        meydan = d["meydan"]
        imza = b64(priv.sign(meydan.encode()))
        st, d = istek(istemci(), B, "/api/giris", {"kullanici": "alice", "meydan": meydan, "imza": imza})
        assert st == 200 and d.get("kullanici") == "alice", "v2 imzalı giriş 200 olmalı: %r" % d
        gecti.append("v2 giriş: meydan imzalandı, parola hiç gönderilmedi → 200")

        # ── 2) yanlış imza (başka anahtarla) → 401 ──
        yanlis_priv = Ed25519PrivateKey.generate()
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=alice", None, "GET")
        meydan2 = d["meydan"]
        yanlis_imza = b64(yanlis_priv.sign(meydan2.encode()))
        st, d = istek(istemci(), B, "/api/giris", {"kullanici": "alice", "meydan": meydan2, "imza": yanlis_imza})
        assert st == 401, "yanlış imza 401 olmalı, geldi %s" % st
        gecti.append("yanlış imza (başka anahtar) → 401")

        # ── 3) aynı meydanı tekrar kullan (replay) → 401 ──
        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=alice", None, "GET")
        meydan3 = d["meydan"]
        imza3 = b64(priv.sign(meydan3.encode()))
        st1, d1 = istek(istemci(), B, "/api/giris", {"kullanici": "alice", "meydan": meydan3, "imza": imza3})
        assert st1 == 200, "ilk kullanım 200 olmalı: %r" % d1
        st2, d2 = istek(istemci(), B, "/api/giris", {"kullanici": "alice", "meydan": meydan3, "imza": imza3})
        assert st2 == 401, "aynı meydan tekrar → 401 olmalı (replay), geldi %s" % st2
        gecti.append("aynı meydan tekrar gönderilirse (replay) → 401 (tek-kullanımlık)")

        # ── 4) süresi dolmuş meydan → 401 (sunucunun kendi SIR'ıyla geçmiş-ömürlü bir meydan üret) ──
        with open(os.path.join(veri, ".gizli"), "rb") as f:
            sir = f.read()
        eski_meydan = auth_modul.Ed25519Sema.meydan_uret("alice", sir, omur=-5)   # -5s → zaten geçmiş
        eski_imza = b64(priv.sign(eski_meydan.encode()))
        st, d = istek(istemci(), B, "/api/giris", {"kullanici": "alice", "meydan": eski_meydan, "imza": eski_imza})
        assert st == 401, "süresi dolmuş meydan 401 olmalı, geldi %s" % st
        gecti.append("süresi dolmuş meydan → 401")

        # ── 5) v1 (göç-öncesi) hesap: parola ile giriş çalışır → auth-yukselt → v2 olur ──
        salt, h = auth_modul._parola_hash("eskiParola123")
        kull_yolu = os.path.join(veri, "kullanicilar.json")
        kull = json.load(open(kull_yolu, encoding="utf-8")) if os.path.exists(kull_yolu) else {}
        kull["v1kullanici"] = {"surum": 1, "salt": salt, "hash": h, "olusturma": int(time.time())}
        with open(kull_yolu, "w", encoding="utf-8") as f:
            json.dump(kull, f)

        cj_v1 = http.cookiejar.CookieJar()
        opv1 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj_v1))
        st, d = istek(opv1, B, "/api/giris-meydan?kullanici=v1kullanici", None, "GET")
        assert st == 200 and d["surum"] == 1, "v1kullanici hâlâ surum=1 olmalı: %r" % d
        st, d = istek(opv1, B, "/api/giris", {"kullanici": "v1kullanici", "parola": "eskiParola123"})
        assert st == 200 and d.get("surum") == 1, "v1 fallback girişi 200+surum:1 olmalı: %r" % d
        gecti.append("v1 (göç-öncesi) hesap: eski parola ile giriş hâlâ çalışır (fallback)")

        # D1/M3 kanıtı için yükseltme-ÖNCESİ çerezi sakla (bu bir "başka cihazda/tarayıcıda kalmış
        # eski token" senaryosunu taklit eder — yükseltme sonrası GEÇERSİZ olmalı).
        yukseltme_oncesi_tok = next(c.value for c in cj_v1 if c.name == "narchat_oturum")
        st, d = istek(urllib.request.build_opener(), B, "/api/ben", None, "GET", cookie=yukseltme_oncesi_tok)
        assert st == 200 and d.get("kullanici") == "v1kullanici", "yükseltme-öncesi token henüz geçerli olmalı: %r" % d

        v2_priv = Ed25519PrivateKey.generate()
        v2_dogrulayici = b64(v2_priv.public_key().public_bytes(RAW, RAWFMT))
        st, d = istek(opv1, B, "/api/auth-yukselt", {"dogrulayici": v2_dogrulayici})
        assert st == 200, "auth-yukselt 200 olmalı: %r" % d
        gecti.append("giriş sonrası /api/auth-yukselt ile v2'ye yükseltildi")

        # D1/M3: yükseltme SONRASI opv1'in KENDİ çerezi (taze nesille yenilendi) kesintisiz çalışmalı —
        # ama yükseltme-ÖNCESİ (eski nesil) token artık İPTAL olmalı.
        yukseltme_sonrasi_tok = next(c.value for c in cj_v1 if c.name == "narchat_oturum")
        assert yukseltme_sonrasi_tok != yukseltme_oncesi_tok, "yükseltme çerezi YENİLEMELİYDİ (yeni nesil)"
        st, d = istek(opv1, B, "/api/ben", None, "GET")
        assert st == 200 and d.get("kullanici") == "v1kullanici", "yükseltmenin KENDİ oturumu kesintisiz sürmeli: %r" % d
        gecti.append("D1/M3: yükseltme kendi oturumunu kesmedi (taze çerez otomatik yenilendi)")

        st, d = istek(urllib.request.build_opener(), B, "/api/ben", None, "GET", cookie=yukseltme_oncesi_tok)
        assert st == 401, "D1/M3: yükseltme-ÖNCESİ (eski nesil) token artık İPTAL olmalı, geldi %s: %r" % (st, d)
        gecti.append("D1/M3: yükseltme-öncesi eski token yükseltmeyle otomatik İPTAL oldu (oturum-nesli)")

        st, d = istek(istemci(), B, "/api/giris-meydan?kullanici=v1kullanici", None, "GET")
        assert st == 200 and d["surum"] == 2, "yükseltme sonrası surum=2 olmalı: %r" % d
        meydan_v2 = d["meydan"]
        imza_v2 = b64(v2_priv.sign(meydan_v2.encode()))
        st, d = istek(istemci(), B, "/api/giris", {"kullanici": "v1kullanici", "meydan": meydan_v2, "imza": imza_v2})
        assert st == 200, "yükseltme sonrası v2 imzalı giriş 200 olmalı: %r" % d
        gecti.append("yükseltme sonrası giriş v2 (imza) ile çalışır")

        # D1/M2: eskiden burada salt/hash'in KORUNDUĞU doğrulanırdı ("bir paket boyu emniyet payı").
        # D1 bunu kalıcı risk işaretledi (dosya N3-öncesi sızarsa en kolay kırılma yolu hâlâ zayıf
        # v1 hash) — artık TERSİNE, HEMEN SİLİNDİĞİ doğrulanıyor.
        kull2 = json.load(open(kull_yolu, encoding="utf-8"))
        assert "salt" not in kull2["v1kullanici"] and "hash" not in kull2["v1kullanici"], \
            "D1/M2: eski v1 salt/hash yükseltmede HEMEN silinmeliydi: %r" % kull2["v1kullanici"]
        gecti.append("D1/M2: eski v1 salt/hash yükseltmede HEMEN silindi (artık bekletilmiyor)")
    finally:
        p.terminate()

    print("✅ SIFIR-BİLGİ AUTH v2 GEÇTİ:")
    for i, g in enumerate(gecti, 1):
        print("  %d. %s" % (i, g))


if __name__ == "__main__":
    main()
