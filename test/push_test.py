#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat Web Push tam-hat kanıtı — 3.parti servis YOK, deterministik (mock endpoint).

Akış: NarChat sunucusu (izole) başlat → 2 kullanıcı (ali3,veli3) → veli3 SAHTE push
endpoint'ine abone (gerçek UA P-256 keypair) → ali3 mesaj atar → sunucu veli3'e push'lar.
Sahte endpoint isteği yakalar. Doğrulanan:
  1. Authorization: vapid t=<JWT>, k=<key>  ·  Content-Encoding: aes128gcm
  2. VAPID JWT imzası sunucunun /api/vapid açık anahtarıyla DOĞRULANIR (ES256, aud=origin)
  3. RFC 8291 gövde veli3'ün UA özel anahtarıyla ÇÖZÜLÜR → {title,body,url}, body="Yeni mesaj"
  4. Ham (şifreli) gövdede "Yeni mesaj" düz-metni YOK (push servisi içeriği göremez)
  5. veli3'e gitti, gönderen ali3'e GİTMEDİ

Çalıştır (cryptography gerekli, sistemde kurulu):  python3 test/push_test.py
"""
import json, os, sys, time, base64, secrets, subprocess, threading, urllib.request, http.cookiejar, tempfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from cryptography.hazmat.primitives.asymmetric import ec, utils as asym_utils
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes, serialization

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8135
MOCK_PORT = 8136
B = "http://127.0.0.1:%d" % PORT
b64e = lambda x: base64.urlsafe_b64encode(x).decode().rstrip("=")
b64d = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

# ---------- sahte push endpoint ----------
_yakalanan = {}
_olay = threading.Event()
class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        _yakalanan["headers"] = dict(self.headers)
        _yakalanan["body"] = self.rfile.read(n)
        _yakalanan["path"] = self.path
        self.send_response(201); self.end_headers()
        _olay.set()

def mock_baslat():
    srv = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), Mock)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ---------- istemci yardımcıları ----------
def istemci():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def post(op, yol, veri):
    r = urllib.request.Request(B+yol, data=json.dumps(veri).encode(),
        headers={'Content-Type':'application/json', 'X-NarChat':'1'}, method='POST')   # D1/L2: CSRF başlığı
    return json.load(op.open(r))
def get(op, yol):
    return json.load(op.open(B+yol))

# ---------- RFC 8291 alıcı-taraf çöz (mirror of _push_sifrele) ----------
def push_coz(body, ua_priv, auth_bytes):
    salt = body[:16]; idlen = body[20]
    as_pub_bytes = body[21:21+idlen]; ct = body[21+idlen:]
    ua_pub_bytes = ua_priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    as_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub_bytes)
    ecdh = ua_priv.exchange(ec.ECDH(), as_pub)
    def hkdf(salt_, ikm, info, length):
        return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt_, info=info).derive(ikm)
    prk = hkdf(auth_bytes, ecdh, b"WebPush: info\x00" + ua_pub_bytes + as_pub_bytes, 32)
    cek = hkdf(salt, prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, prk, b"Content-Encoding: nonce\x00", 12)
    return AESGCM(cek).decrypt(nonce, ct, None).rstrip(b"\x02")

def jwt_dogrula(jwt, vapid_pub_b64, beklenen_aud):
    vp = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b64d(vapid_pub_b64))
    h, p, sig = jwt.split(".")
    raw = b64d(sig); r = int.from_bytes(raw[:32], "big"); s = int.from_bytes(raw[32:], "big")
    der = asym_utils.encode_dss_signature(r, s)
    vp.verify(der, (h + "." + p).encode("ascii"), ec.ECDSA(hashes.SHA256()))  # geçersizse atar
    claims = json.loads(b64d(p))
    assert claims["aud"] == beklenen_aud, "aud: %r != %r" % (claims["aud"], beklenen_aud)
    return claims

def main():
    gecti = []
    mock_baslat()
    veri = tempfile.mkdtemp(prefix="narchat-push-")
    srv = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
        env={**os.environ, "NARCHAT_PORT": str(PORT), "NARCHAT_VERI": veri},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(B + "/api/ben"); break
            except Exception: time.sleep(0.1)

        # 1) iki kullanıcı
        ali, veli = istemci(), istemci()
        # N1: kayıt artık v2 (sıfır-bilgi) — sahte bir doğrulayıcı yeter, bu test parolayı ilgilendirmez.
        post(ali, "/api/kayit", {"kullanici": "ali3", "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()})
        post(veli, "/api/kayit", {"kullanici": "veli3", "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()})
        gecti.append("2 kullanıcı kayıt")

        # 2) VAPID açık anahtar geçerli mi (65B uncompressed nokta, 0x04)
        vapid_pub = get(ali, "/api/vapid")["pubkey"]
        raw = b64d(vapid_pub)
        assert len(raw) == 65 and raw[0] == 0x04, "VAPID açık anahtar 65B/0x04 olmalı"
        gecti.append("/api/vapid geçerli P-256 açık anahtar")

        # 3) veli3 SAHTE endpoint'e abone (gerçek UA keypair)
        ua_priv = ec.generate_private_key(ec.SECP256R1())
        ua_pub = ua_priv.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        auth_bytes = secrets.token_bytes(16)
        endpoint = "http://127.0.0.1:%d/push/veli3" % MOCK_PORT
        post(veli, "/api/push-abone", {"subscription": {
            "endpoint": endpoint, "keys": {"p256dh": b64e(ua_pub), "auth": b64e(auth_bytes)}}})
        gecti.append("veli3 push aboneliği kaydedildi")

        # 4) ali3 oda + mesaj → sunucu veli3'e push'lar
        oda = post(ali, "/api/oda", {"tip": "ikili", "uyeler": ["veli3"]})["oda"]
        post(ali, "/api/mesaj", {"oda": oda, "govde": {"sema": "e2e1", "msg": "x", "n": "y",
            "gonderenPub": "z", "anahtarlar": [{"uye": "veli3"}]}})
        if not _olay.wait(timeout=10):
            raise AssertionError("sahte endpoint push ALMADI (10s)")
        gecti.append("ali3 mesaj attı → veli3 endpoint'i push aldı")

        # 5) başlıklar
        h = {k.lower(): v for k, v in _yakalanan["headers"].items()}
        assert h.get("content-encoding") == "aes128gcm", "Content-Encoding aes128gcm olmalı: %r" % h.get("content-encoding")
        authz = h.get("authorization", "")
        assert authz.startswith("vapid t=") and ", k=" in authz, "VAPID Authorization eksik: %r" % authz
        gecti.append("başlıklar: aes128gcm + VAPID Authorization")

        # 6) VAPID JWT imzası DOĞRULANIR
        t = authz.split("t=", 1)[1].split(",", 1)[0].strip()
        claims = jwt_dogrula(t, vapid_pub, "http://127.0.0.1:%d" % MOCK_PORT)
        gecti.append("VAPID JWT imzası doğrulandı (ES256, aud=%s)" % claims["aud"])

        # 7) gövde ÇÖZÜLÜR + içerik genel
        body = _yakalanan["body"]
        assert b"Yeni mesaj" not in body, "ham gövdede DÜZ-METİN sızıntısı!"
        coz = json.loads(push_coz(body, ua_priv, auth_bytes))
        assert coz.get("body") == "Yeni mesaj" and "NarChat" in coz.get("title", ""), "çözülen içerik: %r" % coz
        gecti.append("gövde çözüldü: %r — ham gövdede düz-metin YOK" % coz)

        print("✅ WEB PUSH TAM-HAT GEÇTİ:")
        for i, g in enumerate(gecti, 1): print("  %d. %s" % (i, g))
    finally:
        srv.terminate()

if __name__ == "__main__":
    main()
