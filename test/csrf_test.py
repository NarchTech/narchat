#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — D1/L2 (CSRF özel-başlığı) kanıtı. İzole sunucu, yalnız stdlib + cryptography.
Durum-değiştiren AUTHLU uçlar X-NarChat:1 başlığı ister (özel başlık → cross-site'te preflight zorlar →
SameSite=None çerezli bundled oturumlardaki teorik CSRF yüzeyi kapanır). Muaf: giriş-öncesi uçlar
(kayıt/giriş — çerez tüketmez) ve GET (durum değiştirmez).

Doğrulanan:
  1. Authlu durum-değiştiren POST (/api/profil) X-NarChat OLMADAN → 403
  2. Aynı POST X-NarChat:1 İLE → 200 (davranış korunur)
  3. Authlu GET (/api/ben) başlıksız → 200 (GET muaf, durum değiştirmez)
  4. Giriş-öncesi POST (/api/kayit) başlıksız → 200 (pre-auth muaf, CSRF yüzeyi yok)
  5. Authlu medya yükleme (/api/medya) X-NarChat OLMADAN → 403
Çalıştır:  python3 test/csrf_test.py
"""
import base64, json, os, sys, subprocess, tempfile, time
import urllib.request, urllib.error, http.cookiejar
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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


def istek(op, B, yol, govde=None, yontem=None, basliklar=None, ham=None, tip=None):
    if ham is not None:
        veri = ham
    else:
        veri = json.dumps(govde).encode() if govde is not None else None
    headers = {}
    if veri is not None: headers["Content-Type"] = tip or "application/json"
    if basliklar: headers.update(basliklar)
    r = urllib.request.Request(B + yol, data=veri, headers=headers,
                               method=yontem or ("POST" if veri is not None else "GET"))
    try:
        resp = op.open(r)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def b64(x): return base64.b64encode(x).decode()
CSRF = {"X-NarChat": "1"}


def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-csrf-")
    p, B = sunucu_baslat(8156, veri)
    try:
        # kayıt (pre-auth) → oturum çerezi al. Başlıksız yapılır (madde 4 aynı zamanda burada kanıtlanır).
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        priv = Ed25519PrivateKey.generate()
        dog = b64(priv.public_key().public_bytes(RAW, RAWFMT))
        st, _ = istek(op, B, "/api/kayit", {"kullanici": "csrfli", "dogrulayici": dog, "kdf": 2})
        assert st == 200, "giriş-öncesi kayıt başlıksız 200 olmalı (pre-auth muaf), geldi %s" % st
        gecti.append("giriş-öncesi POST /api/kayit (başlıksız) → 200 (pre-auth muaf)")

        # 1) authlu durum-değiştiren POST başlıksız → 403
        st, _ = istek(op, B, "/api/profil", {"ad": "Deneme"})
        assert st == 403, "authlu POST başlıksız 403 olmalı (CSRF), geldi %s" % st
        gecti.append("authlu POST /api/profil (X-NarChat YOK) → 403")

        # 2) aynı POST başlıkla → 200
        st, gov = istek(op, B, "/api/profil", {"ad": "Deneme"}, basliklar=CSRF)
        assert st == 200, "authlu POST başlıkla 200 olmalı, geldi %s: %r" % (st, gov[:120])
        gecti.append("authlu POST /api/profil (X-NarChat:1) → 200 (davranış korunur)")

        # 3) authlu GET başlıksız → 200 (GET muaf)
        st, gov = istek(op, B, "/api/ben")
        assert st == 200, "authlu GET başlıksız 200 olmalı (GET muaf), geldi %s" % st
        assert json.loads(gov).get("kullanici") == "csrfli"
        gecti.append("authlu GET /api/ben (başlıksız) → 200 (GET muaf)")

        # 5) authlu medya yükleme başlıksız → 403
        st, _ = istek(op, B, "/api/medya", ham=b"x" * 32, tip="application/octet-stream")
        assert st == 403, "authlu medya yükleme başlıksız 403 olmalı (CSRF), geldi %s" % st
        # başlıkla ise 403 DEĞİL (200 medya_id döner)
        st, gov = istek(op, B, "/api/medya", ham=b"x" * 32, tip="application/octet-stream", basliklar=CSRF)
        assert st == 200 and b"medya_id" in gov, "medya başlıkla 200 olmalı, geldi %s: %r" % (st, gov[:120])
        gecti.append("authlu medya yükleme (/api/medya): başlıksız → 403, başlıkla → 200")
    finally:
        p.terminate()

    print("✅ D1/L2 (CSRF özel-başlığı) GEÇTİ:")
    for i, g in enumerate(gecti, 1):
        print("  %d. %s" % (i, g))


if __name__ == "__main__":
    main()
