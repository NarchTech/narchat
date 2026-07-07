#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — auth_modul.py (FAZ N1: sıfır-bilgi auth çekirdeği, pluggable şema).
mesaj_server.py _kayit/_giris/_auth_yukselt buraya delege eder (kayıt kaydındaki "surum" alanına göre).

  v1 = eski PBKDF2 parola-hash (sunucu parolayı GÖRÜR) — YALNIZ göç fallback'i, N3'te silinir.
  v2 = sıfır-bilgi Ed25519 imza doğrulaması. İstemci (static/auth.js) paroladan Argon2id ile
       DETERMİNİSTİK bir Ed25519 anahtar çifti türetir; sunucuya YALNIZ public anahtar
       ("doğrulayıcı") gider — parola/parola-türevi sır sunucuya HİÇ gitmez.
       Giriş: meydan_uret() durumsuz nonce (HMAC imzalı, 60sn ömür) → istemci kendi özel
       anahtarıyla imzalar → dogrula() imzayı `cryptography` ile doğrular + meydanı tek-kullanımlık
       tüketir (tekrar-oynatma/replay engeli).
"""
import base64, hashlib, hmac, secrets, threading, time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

# D1/M1: geçerli KDF profil id'leri (static/auth.js KDF_PROFILLERI ile AYNI küme). Bir hesap hangi
# profille açıldıysa "kdf" alanında tutulur; sunucu parametreleri bilmez (istemci-tarafı türetme) —
# yalnız hangi profilin kullanıldığını taşır ki giriş-öncesi istemci doğru parametreyi seçebilsin.
KDF_PROFILLERI = {1, 2}
KDF_VARSAYILAN = 2   # yeni v2 kayıtların varsayılan profili (mevcut en güçlü)


def _now():
    return int(time.time())


def _parola_hash(parola, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", parola.encode(), bytes.fromhex(salt), 200_000)
    return salt, h.hex()


# ---------- v1: eski PBKDF2 parola-hash (yalnız göç fallback'i) ----------
class PbkdfSema:
    surum = 1

    @staticmethod
    def kayit(gov):
        parola = gov.get("parola") or ""
        if len(parola) < 4:
            return None, "kullanıcı + en az 4 hane parola"
        salt, h = _parola_hash(parola)
        return {"surum": 1, "salt": salt, "hash": h}, None

    @staticmethod
    def dogrula(gov, kayit, sir):
        parola = gov.get("parola")
        if not parola:
            return False
        _, h = _parola_hash(parola, kayit["salt"])
        return hmac.compare_digest(h, kayit["hash"])


# ---------- v2: sıfır-bilgi Ed25519 (meydan/imza) ----------
_MEYDAN_KULLANILDI = {}   # meydan-token -> son_kullanma (tek-kullanımlık takip; lazy süpürme)
_MEYDAN_KILIT = threading.Lock()


def _meydan_supur():
    simdi = _now()
    for k in [k for k, son in _MEYDAN_KULLANILDI.items() if son < simdi]:
        _MEYDAN_KULLANILDI.pop(k, None)


class Ed25519Sema:
    surum = 2

    @staticmethod
    def kayit(gov):
        dogrulayici = gov.get("dogrulayici") or ""
        try:
            raw = base64.b64decode(dogrulayici, validate=True)
        except Exception:
            return None, "geçersiz doğrulayıcı"
        if len(raw) != 32:
            return None, "geçersiz doğrulayıcı"
        # D1/M1: istemcinin türetimde kullandığı KDF profili — hesapla birlikte saklanır (giris-meydan
        # bunu geri bildirir ki istemci girişte AYNI profille imzalasın). Bilinmeyen profil reddedilir.
        kdf = gov.get("kdf", KDF_VARSAYILAN)
        if kdf not in KDF_PROFILLERI:
            return None, "geçersiz kdf profili"
        return {"surum": 2, "dogrulayici": dogrulayici, "kdf": kdf}, None

    @staticmethod
    def meydan_uret(kullanici, sir, omur=60):
        rastgele = secrets.token_hex(16)
        son = _now() + omur
        govde = f"{kullanici}.{rastgele}.{son}"
        imza = hmac.new(sir, govde.encode(), hashlib.sha256).hexdigest()
        return f"{govde}.{imza}"

    @staticmethod
    def dogrula(gov, kayit, sir):
        meydan = gov.get("meydan") or ""
        imza_b64 = gov.get("imza") or ""
        if not meydan or not imza_b64:
            return False
        try:
            kullanici, rastgele, son, imza = meydan.rsplit(".", 3)
            govde = f"{kullanici}.{rastgele}.{son}"
            beklenen = hmac.new(sir, govde.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(beklenen, imza):
                return False
            if _now() > int(son):
                return False
        except Exception:
            return False
        if kullanici != (gov.get("kullanici") or "").strip().lower():
            return False   # başka bir hesap için üretilmiş meydan burada geçersiz
        with _MEYDAN_KILIT:
            _meydan_supur()
            if meydan in _MEYDAN_KULLANILDI:
                return False   # tekrar-oynatma (replay)
            _MEYDAN_KULLANILDI[meydan] = int(son)
        try:
            pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(kayit["dogrulayici"]))
            pub.verify(base64.b64decode(imza_b64), meydan.encode())
            return True
        except (InvalidSignature, Exception):
            return False


SEMALAR = {1: PbkdfSema, 2: Ed25519Sema}
