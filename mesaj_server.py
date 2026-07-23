#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — mesaj_server.py  (Faz-1 iskelet, Marcus bootstrap)

TASARIM İLKESİ: SUNUCU = APTAL RELAY + CIPHERTEXT DEPOSU.
  Sunucu mesaj içeriğini ASLA çözmez/anlamaz. Sadece opak şifreli blob saklar + iletir.
  E2E tüm istemcide (libsodium). Bu dosyada hiçbir yerde mesaj düz-metni geçmez.

Yığın: Python stdlib (ekosistem deseni — pusula_server.py mirası). Harici bağımlılık YOK.
Bağlanma: 127.0.0.1:8101 (izole-port; canlı 8095/8096/8796'ya dokunmaz).
Veri: ./veri/ (JSON + jsonl, atomik yazma). Oturum sırrı ./veri/.gizli (mode 600, repo-dışı).

Endpointler (hepsi auth-gerekli, kayit/giris/giris-meydan hariç):
  POST /api/kayit        {kullanici, dogrulayici, pubkey?}  -> hesap (v2 sıfır-bilgi; parola sunucuya gitmez)
  GET  /api/giris-meydan?kullanici=       -> {surum, meydan} (v1=eski parola-hash göç fallback'i, v2=Ed25519)
  POST /api/giris        v1:{kullanici,parola} | v2:{kullanici,meydan,imza} -> Set-Cookie oturum
  POST /api/auth-yukselt {dogrulayici}                    -> v1 hesabı v2'ye yükselt (göç, auth-gerekli)
  POST /api/narc-kod                                      -> {kod} (FAZ N2 self-servis; NARCHAT_KOD_ACIK=1 şart)
  POST /api/cikis                                        -> oturum sil
  GET  /api/ben                                          -> {kullanici, pubkey}
  POST /api/anahtar      {pubkey}                         -> public key güncelle
  GET  /api/kullanicilar                                 -> [{kullanici, pubkey}]
  POST /api/oda          {tip, ad?, uyeler:[...]}        -> {oda}
  GET  /api/odalar                                       -> benim odalarım
  POST /api/mesaj        {oda, govde}                    -> govde = OPAK E2E blob (sunucu çözmez)
  GET  /api/mesajlar?oda=&since=                         -> ciphertext mesaj listesi
  GET  /api/akis?oda=                                    -> SSE (yeni-mesaj olayları)
"""
import json, os, sys, time, hmac, hashlib, secrets, threading, base64, queue
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from auth_modul import SEMALAR, Ed25519Sema, KDF_PROFILLERI, KDF_VARSAYILAN   # FAZ N1: pluggable auth şeması (v1 PBKDF2 göç · v2 sıfır-bilgi) · D1/M1 KDF profilleri

KOK = os.path.dirname(os.path.abspath(__file__))
# VERI: izole test/çoklu-örnek için NARCHAT_VERI ile geçersiz kılınabilir (varsayılan ./veri).
VERI = os.environ.get("NARCHAT_VERI") or os.path.join(KOK, "veri")
STATIK = os.path.join(KOK, "static")
MSGDIR = os.path.join(VERI, "mesajlar")
OKUDIR = os.path.join(VERI, "okundu")               # mesaj id -> [okuyan kullanıcılar] (oda başına dosya)
MEDYADIR = os.path.join(VERI, "medya")              # E2E opak medya blob'ları (sunucu içeriği BİLMEZ)
MEDYA_MAX = 15 * 1024 * 1024                          # 15 MB üst sınır
AVATARDIR = os.path.join(VERI, "avatar")            # profil fotoğrafı (yarı-genel, küçük)
AVATAR_MAX = 256 * 1024                              # 256 KB üst sınır
MAX_JSON_BODY = 1024 * 1024                           # D1: JSON gövde üst sınırı (medya HARİÇ; en büyük meşru
                                                      # JSON = avatar base64 ~350KB). Sınırsız/negatif
                                                      # Content-Length okumasını (bellek-şişme + engelleyici
                                                      # read(-1) askısı) engeller.
F_KULL = os.path.join(VERI, "kullanicilar.json")
F_ODA  = os.path.join(VERI, "odalar.json")
F_KISI = os.path.join(VERI, "kisiler.json")         # {kullanici: [eklenen_kullanici, ...]} — kişi defteri
F_DAVET = os.path.join(VERI, "davetler.json")       # varsa kayıt davet-kodu ZORUNLU ("silahlı"); yoksa açık
                                                     # şema: {kodlar:[süresiz], kullanilmis:{kod:{kullanici,ts}},
                                                     #        otokodlar:{kod:{olusturma,kullanildi}}}  (N2 self-servis, 72s TTL)
F_GIZLI = os.path.join(VERI, ".gizli")
F_VAPID = os.path.join(VERI, ".vapid.pem")     # Web Push VAPID özel anahtar (mode 600, repo-dışı)
F_PUSH  = os.path.join(VERI, "push_aboneler.json")  # {kullanici: [subscription, ...]}
F_TEPKI = os.path.join(VERI, "tepkiler.json")       # {oda: {mid: {kim: blob}}} — emoji E2E (opak); sunucu OKUYAMAZ
F_DUYURU = os.path.join(VERI, "duyurular.json")     # N5: NarcOsystem vitrin içeriği — {surum,urunler:[{ad,aciklama,url,ikon,etiket}]}
                                                     # dosya yoksa boş liste (içerik güncellemesiyle değişir, deploy gerekmez)
PORT = int(os.environ.get("NARCHAT_PORT", "8101"))
VAPID_SUB = os.environ.get("NARCHAT_VAPID_SUB", "mailto:admin@example.com")
OTURUM_GUN = 365   # güvenilen cihazda oturum açık kalsın (her açılışta yeniden giriş istemesin)

# FAZ N2: NARC- kod self-servis musluğu. Varsayılan KAPALI — kamuya açılış hukuk kapısına bağlı
# (bkz OTONOM-GOREV.md v7 "KAMUYA AÇILIŞ HUKUK KAPISI"). Açıkken bile üretim günlük tavanla sınırlı.
NARCHAT_KOD_ACIK = os.environ.get("NARCHAT_KOD_ACIK", "0") == "1"
NARCHAT_KOD_GUNLUK = int(os.environ.get("NARCHAT_KOD_GUNLUK", "50"))
# D1 (musluk-öncesi ertelenen): tek IP tüm global kotayı tüketmesin diye per-IP günlük tavan.
# İnsan-cömert (paylaşımlı NAT/ofis 8'e kadar sığar), kötüye-kullanım-tight (bir IP global 50'nin
# en çok %16'sını alabilir → global kotayı tüketmek için ≥7 ayrı IP gerekir).
NARCHAT_KOD_IP_GUNLUK = int(os.environ.get("NARCHAT_KOD_IP_GUNLUK", "8"))

# ── UYUMLU SÜRÜM / WP1: 5651 m.2/1-j trafik-bilgisi kaydı (bkz. trafik_kayit.py) ──
# Varsayılan KAPALI -> referans davranış birebir korunur (test [E1]); chat.narch.tech dağıtımı 1 yapar.
# Kayıt İÇERİK TAŞIYAMAZ (modül imza+şema kilitli; test [2]/[3b]/[E3]). IP burada HAM yazılır — referans
# sürümün HMAC-anonimleştirmesinden bilinçli sapma, kanun gereği; aydınlatma metninde beyan edilir (WP2).
NARCHAT_TRAFIK_KAYIT = os.environ.get("NARCHAT_TRAFIK_KAYIT", "0") == "1"
TRAFIK = None
if NARCHAT_TRAFIK_KAYIT:
    # Fail-fast BİLİNÇLİ (ikinci-göz 🟠-3/🟡-3): env açıkken modül eksikse ya da saklama süresi
    # yasal aralık (365-730) dışındaysa servis HİÇ BAŞLAMAZ — kayıt yükümlülüğü sessizce yok olamaz.
    from trafik_kayit import TrafikKayit
    TRAFIK = TrafikKayit(os.environ.get("NARCHAT_TRAFIK_DIZIN") or os.path.join(VERI, "trafik"),
                         saklama_gun=int(os.environ.get("NARCHAT_TRAFIK_SAKLAMA_GUN", "365")))
    TRAFIK.imha()   # 🟠-4: açılışta bekleyen imha (atıl/kapalı geçen sürenin telafisi)

    def _trafik_imha_dongusu():
        while True:
            time.sleep(86400)
            try:
                TRAFIK.imha()
            except Exception as e:
                print("TRAFIK-IMHA HATASI:", e, file=sys.stderr)
    threading.Thread(target=_trafik_imha_dongusu, daemon=True).start()   # 🟠-4: atıl sunucuda da imha işler

# 🟠-2: kalıcı kayıt-hatası izlemesi — ardışık hata eşiğinde yüksek-sesli alarm (+ ops. operatör komutu).
TRAFIK_HATA_ESIK = 10
_trafik_hata = {"n": 0}
# 🟠-1: SSE per-IP bağlantı kovası — YALNIZ kayıt-modu açıkken uygulanır (kapalıyken referans davranış
# birebir). Gerekçe: referansta /api/akis iz bırakmaz; kayıt-modunda her bağlantı kalıcı satır yazar →
# authlu istemciden sınırsız log-amplifikasyonu/disk-doldurma. EventSource ~3sn retry meşru → kova cömert.
SSE_LIMIT = int(os.environ.get("NARCHAT_SSE_LIMIT", "60"))
SSE_PENCERE = int(os.environ.get("NARCHAT_SSE_PENCERE", "60"))
_SSE_KOVA, _SSE_KILIT = {}, threading.Lock()

def _sse_oran_asildi(ip):
    simdi = int(time.time())
    with _SSE_KILIT:
        v = _SSE_KOVA.get(ip)
        if not v or simdi - v[0] >= SSE_PENCERE:
            if len(_SSE_KOVA) > 4096:   # bellek emniyeti: süresi geçen pencereleri süpür
                for k in [k for k, w in _SSE_KOVA.items() if simdi - w[0] >= SSE_PENCERE]:
                    _SSE_KOVA.pop(k, None)
            _SSE_KOVA[ip] = [simdi, 1]
            return False
        v[1] += 1
        return v[1] > SSE_LIMIT
NARC_KOD_TTL = 72 * 3600   # tek-kullanımlık + 72 saat ömür

# Oran-sınırı (Adım 5c): IP başına auth (kayıt/giriş) denemesi — kaba-kuvvet/kayıt-spam'i hafifletir.
# Tünel arkasında gerçek IP CF-Connecting-IP başlığında gelir (yerel istek = 127.0.0.1 tek kova).
# Eşik cömert: meşru kullanıcı/izole-test takılmaz; 0 = kapalı.
RATE_LIMIT = int(os.environ.get("NARCHAT_RATE_LIMIT", "30"))     # pencere başına izinli deneme
RATE_PENCERE = int(os.environ.get("NARCHAT_RATE_PENCERE", "60")) # saniye
_RATE = {}                      # ip -> [zaman damgaları]
RATE_KILIT = threading.Lock()

KILIT = threading.Lock()
# SSE aboneleri: oda -> set(Queue)
ABONELER = {}
# Kişisel kanal aboneleri: kullanici -> set(Queue) — oturum boyu açık; gelen ARAMA sinyali
# kullanıcının hangi odayı açık tuttuğundan bağımsız buraya gider (her ekranda zil çalsın).
ABONE_KISI = {}
ABONE_KILIT = threading.Lock()
# Arama bildirimi "yeniden uyarma": re-offer döngüsü (~3sn) süresince kilitli telefon TEKRAR
# titresin/uyarsın diye her ARAMA_PUSH_ARALIK sn'de bir yeniden push at; bir çağrı için en çok
# ARAMA_PUSH_SURE sn. (Kesintisiz zil değil — "telefon çalıyor" hissi veren tekrarlı uyarı.)
ARAMA_PUSH_ARALIK = int(os.environ.get("NARCHAT_ARAMA_PUSH_ARALIK", "5"))
ARAMA_PUSH_SURE   = int(os.environ.get("NARCHAT_ARAMA_PUSH_SURE", "45"))
SON_ARAMA_PUSH = {}      # (oda, arayan) -> {"ilk": ts, "son": ts} : tekrarlı arama-uyarı penceresi
# Çevrimiçi/son-görülme (hafif, bellek-içi): kullanici -> son aktif ts
SON_GORULME = {}
GORULME_KILIT = threading.Lock()
CEVRIMICI_ESIK = 40   # saniye: bu süre içinde aktifse "çevrimiçi"

# Cihaz bağlama (çok-cihaz): bir cihaz, özel anahtarını PAROLA-cümlesiyle şifreleyip (opak blob)
# kısa süreli bir kanala koyar; AYNI kullanıcının başka cihazı tek-kullanımlık çekip çözer.
# Sunucu yalnız ciphertext görür (parola-cümlesi sunucuya GİTMEZ) → anahtar düz halde asla sunucuda durmaz.
_AKTARIM = {}                    # kanal -> {"owner": kullanici, "blob": str, "ts": int}
AKTARIM_KILIT = threading.Lock()
AKTARIM_TTL = int(os.environ.get("NARCHAT_AKTARIM_TTL", "600"))   # 10 dk (tek-kullanımlık + süreli)
AKTARIM_MAX_BLOB = 20000         # base64 blob üst sınırı

def _aktarim_temizle():
    son = _now() - AKTARIM_TTL
    for k in [k for k, v in _AKTARIM.items() if v["ts"] < son]:
        _AKTARIM.pop(k, None)

# ---------- yardımcılar ----------
def _now(): return int(time.time())

def _kullanici_gecerli(k):
    """Kullanıcı adı güvenli mi (D1/H1): yalnız ASCII harf/rakam/_, 2-32 karakter.
    Kullanıcı adı AVATARDIR gibi dosya-yollarında ham kullanılıyor — burada reddedilmezse
    path-traversal (ör. "../../..") sonradan dosya yazma yolunda risk olur.
    D1: str.isalnum() UNICODE-farkındadır (Kiril "а" gibi homograflar geçerdi → görsel taklit riski) —
    bu yüzden c.isascii() ile ASCII'ye kısıtlandı ([a-z0-9_], girdi zaten .lower()'lanmış)."""
    return 2 <= len(k) <= 32 and all(c.isascii() and (c.isalnum() or c == "_") for c in k)

def _oran_asildi(ip):
    """IP bu pencerede sınırı aştı mı? Aşmadıysa denemeyi kaydeder. RATE_LIMIT<=0 → kapalı."""
    if RATE_LIMIT <= 0:
        return False
    simdi = time.time()
    with RATE_KILIT:
        q = [t for t in _RATE.get(ip, ()) if simdi - t < RATE_PENCERE]
        if len(q) >= RATE_LIMIT:
            _RATE[ip] = q
            return True
        q.append(simdi)
        _RATE[ip] = q
        if len(_RATE) > 4096:                 # ara-sıra temizlik (bellek sınırı)
            for k in list(_RATE):
                _RATE[k] = [t for t in _RATE[k] if simdi - t < RATE_PENCERE]
                if not _RATE[k]:
                    del _RATE[k]
        return False

def _atomik_yaz(yol, veri):
    tmp = yol + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(veri, f, ensure_ascii=False, indent=2)
    os.replace(tmp, yol)

def _oku(yol, varsayilan):
    try:
        with open(yol, encoding="utf-8") as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return varsayilan

def _gizli():
    """Oturum imzası için sır — ilk koşuda üret, repo-dışı, mode 600."""
    if os.path.exists(F_GIZLI):
        with open(F_GIZLI, "rb") as f: return f.read()
    s = secrets.token_bytes(32)
    fd = os.open(F_GIZLI, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f: f.write(s)
    return s

SIR = None  # init()'te dolar
# Not: parola-hash artık auth_modul.PbkdfSema içinde (v1 göç fallback'i) — burada tekrarlanmaz.

# FAZ N2: NARC-XXXX-XXXX kod üretimi — elle-seedlenmiş davetler.json kodlarıyla AYNI alfabe/desen.
_KOD_ALFABE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
def _narc_kod_uret():
    parca = lambda: "".join(secrets.choice(_KOD_ALFABE) for _ in range(4))
    return f"NARC-{parca()}-{parca()}"

def _oturum_uret(kullanici, nesil=0):
    # D1/M3: token'a hesabın "oturum nesli" gömülür — sunucu durumsuz kalır (nesil kullanicilar.json'da
    # zaten tutulan bir alan) ama artık İPTAL mümkün: nesil artınca o ana dek çıkmış TÜM token'lar
    # (365 gün boyunca hâlâ geçerli olsalar bile) tek seferde geçersiz olur.
    exp = _now() + OTURUM_GUN * 86400
    govde = f"{kullanici}.{nesil}.{exp}"
    sig = hmac.new(SIR, govde.encode(), hashlib.sha256).hexdigest()
    return f"{govde}.{sig}"

def _oturum_coz(tok):
    try:
        kullanici, nesil, exp, sig = tok.rsplit(".", 3)
        govde = f"{kullanici}.{nesil}.{exp}"
        beklenen = hmac.new(SIR, govde.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(beklenen, sig): return None
        if _now() > int(exp): return None
        rec = _oku(F_KULL, {}).get(kullanici, {})
        if int(nesil) != rec.get("oturum_nesli", 0): return None   # nesil artırıldıysa (iptal) eski token artık geçersiz
        if rec.get("askiya"): return None   # WP3: askıya alınan hesap her authlu uçtan kilitlenir (derinlemesine savunma)
        return kullanici
    except Exception:
        return None

def _yayinla(oda, olay):
    with ABONE_KILIT:
        for q in list(ABONELER.get(oda, ())):
            try: q.put_nowait(olay)
            except Exception: pass

def _yayinla_kisi(kullanici, olay):
    """Bir kullanıcının kişisel kanalına (tüm açık SSE'lerine) olay it — açık oda fark etmez."""
    with ABONE_KILIT:
        for q in list(ABONE_KISI.get(kullanici, ())):
            try: q.put_nowait(olay)
            except Exception: pass

def _gorundu(kullanici):
    """Kullanıcının son aktif zamanını tazele (çevrimiçi göstergesi)."""
    if not kullanici: return
    with GORULME_KILIT:
        SON_GORULME[kullanici] = _now()

def _cevrimici(kullanici):
    return (_now() - SON_GORULME.get(kullanici, 0)) <= CEVRIMICI_ESIK

def _turn_ice():
    """WebRTC ICE sunucuları. TURN cred ENV'den okunur (statik pakete GİRMEZ; paylaşımlı
    coturn cred'i yalnız authlu kullanıcıya, sunucu üstünden verilir). Env yoksa STUN-only."""
    sunucular = [{"urls": "stun:stun.l.google.com:19302"}]
    host = os.environ.get("NARCHAT_TURN_HOST")
    user = os.environ.get("NARCHAT_TURN_USERNAME")
    cred = os.environ.get("NARCHAT_TURN_CRED")
    port = os.environ.get("NARCHAT_TURN_PORT", "3478")
    if host and user and cred:
        sunucular.append({"urls": [f"turn:{host}:{port}?transport=udp", f"turn:{host}:{port}?transport=tcp"],
                          "username": user, "credential": cred})
        sunucular.append({"urls": f"stun:{host}:{port}"})
    return sunucular

# ---------- okundu izi (hafif: oda başına {mesaj_id: [okuyanlar]}) ----------
def _okundu_yol(oda): return os.path.join(OKUDIR, oda + ".json")
def _okundu_oku(oda): return _oku(_okundu_yol(oda), {})
def _okundu_isaretle(oda, ids, kim):
    with KILIT:
        os.makedirs(OKUDIR, exist_ok=True)
        d = _okundu_oku(oda); degisti = False
        for i in ids:
            lst = d.setdefault(i, [])
            if kim not in lst: lst.append(kim); degisti = True
        if degisti: _atomik_yaz(_okundu_yol(oda), d)

# ---------- Web Push (kendi VAPID — 3.parti servis YOK; RFC 8292 + 8291) ----------
# Push GÖVDESİ push servisine (Apple/Google/Mozilla) RFC 8291 ile ŞİFRELİ gider — onlar
# içeriği göremez. Biz de zaten yalnız genel "Yeni mesaj" koyuyoruz (sunucu E2E içeriği bilmez).
# Köken: ELCI-PORTAL pusula_server.py (kanıtlı). Bağımlılık: cryptography (kurulu).
import urllib.request as _urlreq
import urllib.error as _urlerr

_VAPID_KILIT = threading.Lock()
_vapid_priv = None

def _b64e(b): return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")
def _b64d(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def _vapid_anahtar():
    """VAPID özel anahtarı (EC P-256); yoksa üret + F_VAPID'e PEM kaydet (0600)."""
    global _vapid_priv
    if _vapid_priv is not None: return _vapid_priv
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    with _VAPID_KILIT:
        if _vapid_priv is not None: return _vapid_priv
        if os.path.exists(F_VAPID):
            with open(F_VAPID, "rb") as f:
                _vapid_priv = serialization.load_pem_private_key(f.read(), password=None)
        else:
            priv = ec.generate_private_key(ec.SECP256R1())
            pem = priv.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            fd = os.open(F_VAPID, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f: f.write(pem)
            _vapid_priv = priv
        return _vapid_priv

def _vapid_acik_b64():
    """Frontend applicationServerKey: 65B X9.62 uncompressed nokta → base64url."""
    from cryptography.hazmat.primitives import serialization
    pub = _vapid_anahtar().public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64e(pub)

def _vapid_jwt(audience):
    """RFC 8292 VAPID JWT (ES256). audience = push endpoint origin (path YOK)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, utils as asym_utils
    header = _b64e(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    payload = _b64e(json.dumps({"aud": audience, "exp": _now() + 12*3600, "sub": VAPID_SUB},
                               separators=(",", ":")).encode())
    der = _vapid_anahtar().sign((header + "." + payload).encode("ascii"), ec.ECDSA(hashes.SHA256()))
    r, s = asym_utils.decode_dss_signature(der)
    return header + "." + payload + "." + _b64e(r.to_bytes(32, "big") + s.to_bytes(32, "big"))

def _push_sifrele(p256dh_b64, auth_b64, plaintext):
    """RFC 8291 aes128gcm gövde: salt(16)+rs(4BE)+idlen(1)+as_pub(65)+ct."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives import hashes, serialization
    ua_pub_bytes = _b64d(p256dh_b64); auth = _b64d(auth_b64)
    ua_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub_bytes)
    as_priv = ec.generate_private_key(ec.SECP256R1())
    as_pub = as_priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    ecdh = as_priv.exchange(ec.ECDH(), ua_pub)
    salt = secrets.token_bytes(16)
    def hkdf(salt_, ikm, info, length):
        return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt_, info=info).derive(ikm)
    prk = hkdf(auth, ecdh, b"WebPush: info\x00" + ua_pub_bytes + as_pub, 32)
    cek = hkdf(salt, prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, prk, b"Content-Encoding: nonce\x00", 12)
    ct = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + b"\x41" + as_pub + ct

def _push_abonelik_gonder(sub, payload_bytes):
    """Tek aboneliğe şifreli push. True=ok/koru, False=öl(sil)."""
    endpoint = sub.get("endpoint"); keys = sub.get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not (endpoint and p256dh and auth): return False
    try:
        parsed = urlparse(endpoint); origin = "%s://%s" % (parsed.scheme, parsed.netloc)
        govde = _push_sifrele(p256dh, auth, payload_bytes)
        req = _urlreq.Request(endpoint, data=govde, method="POST", headers={
            "Authorization": "vapid t=%s, k=%s" % (_vapid_jwt(origin), _vapid_acik_b64()),
            "TTL": "86400", "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream", "Content-Length": str(len(govde))})
        with _urlreq.urlopen(req, timeout=10) as r:
            return 200 <= r.status < 300
    except _urlerr.HTTPError as e:
        return e.code not in (404, 410)   # ölü abonelik → sil
    except Exception:
        return True                        # geçici/ağ → koru

def _push_oku(): return _oku(F_PUSH, {})

def _push_abone_ekle(kullanici, sub):
    endpoint = (sub or {}).get("endpoint")
    if not endpoint: return False
    with KILIT:
        d = _push_oku(); liste = d.setdefault(kullanici, [])
        liste[:] = [s for s in liste if s.get("endpoint") != endpoint]  # endpoint başına tek
        liste.append(sub); _atomik_yaz(F_PUSH, d)
    return True

def _push_abone_sil(endpoint):
    if not endpoint: return
    with KILIT:
        d = _push_oku(); degisti = False
        for k in list(d):
            yeni = [s for s in d[k] if s.get("endpoint") != endpoint]
            if len(yeni) != len(d[k]): d[k] = yeni; degisti = True
        if degisti: _atomik_yaz(F_PUSH, d)

def _push_gonder(kullanici, mesaj):
    """kullanici'nin tüm aboneliklerine push (ayrı thread, best-effort, ana isteği bloklamaz)."""
    def _calistir():
        try:
            subs = _push_oku().get(kullanici, [])
            if not subs: return
            payload = json.dumps(mesaj, ensure_ascii=False).encode("utf-8")
            for s in list(subs):
                if not _push_abonelik_gonder(s, payload):
                    _push_abone_sil(s.get("endpoint"))
        except Exception:
            pass
    threading.Thread(target=_calistir, daemon=True).start()

# FAZ N3: bundled Capacitor origin'leri (mağazasız, kendi sitemizden imzalı APK). SABİT allowlist —
# GENİŞLETME (CSRF): yalnız native uygulamanın kendi WebView origin'leri, başka hiçbir şey.
CORS_ALLOWLIST = {"https://localhost", "capacitor://localhost"}
# YALNIZ TEST: gerçek tarayıcıda "farklı origin" senaryosunu sahtesiz doğrulamak için (bkz
# test/bundled_smoke.mjs) — canlı launchd plist'inde bu env ASLA set edilmez, allowlist orada sabit kalır.
# D1/L3: kanca artık AÇIK bir test-bayrağına kilitli — NARCHAT_CORS_TEST_ORIGIN tek başına yetmez,
# NARCHAT_TEST_HOOKS=1 de gerekir. Böylece env yanlışlıkla prod'a sızsa bile keyfi credential'lı origin
# allowlist'e giremez (savunma-derinliği: iki bağımsız bayrak aynı anda set edilmeli).
_CORS_TEST_ORIGIN = os.environ.get("NARCHAT_CORS_TEST_ORIGIN")
if _CORS_TEST_ORIGIN and os.environ.get("NARCHAT_TEST_HOOKS") == "1":
    CORS_ALLOWLIST = CORS_ALLOWLIST | {_CORS_TEST_ORIGIN}

# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    server_version = "NarChat/0.1"
    def log_message(self, *a): pass  # sessiz

    # --- düşük seviye ---
    def _govde(self):
        # D1: Content-Length'i OKUMADAN önce doğrula — negatif (read(-1) → EOF'a dek engelleyici askı)
        # ve aşırı-büyük (bellek-şişme) değerleri baştan reddet. Geçersizse gövde boş sayılır (uç 400/401 döner).
        try: n = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError: return {}
        if n <= 0 or n > MAX_JSON_BODY: return {}
        try: return json.loads(self.rfile.read(n).decode())
        except Exception: return {}

    def _cors_origin(self):
        o = self.headers.get("Origin")
        return o if o in CORS_ALLOWLIST else None

    def _cors_basliklari_ekle(self):
        # Yalnız allowlist'teki origin'e (varsa) yansıt — asla "*" (credentials ile birlikte yasak zaten).
        o = self._cors_origin()
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _cors_samesite(self):
        # Web (aynı-origin) davranışı DEĞİŞMEZ (SameSite=Lax); yalnız allowlist'teki bundled origin
        # için çerez cross-origin XHR'da taşınsın diye SameSite=None; Secure gerekir.
        return "SameSite=None; Secure" if self._cors_origin() else "SameSite=Lax"

    def _csrf_ok(self):
        # D1/L2: durum-değiştiren authlu isteklerde özel başlık ZORUNLU. Özel başlık "basit istek"
        # olmayı bozar → tarayıcı cross-site'te preflight tetikler → do_OPTIONS yalnız allowlist origin'e
        # izin verdiğinden saldırgan-origin'in isteği tarayıcıda düşer. SameSite=None çerezli (bundled)
        # oturumlardaki teorik CSRF yüzeyini kapatır. İstemci bunu tek choke-point'te (app.js api()) yollar.
        return self.headers.get("X-NarChat") == "1"

    def do_OPTIONS(self):
        # CORS preflight — yalnız allowlist'teki origin'e izin başlıkları döner, aksi halde sade 204.
        o = self._cors_origin()
        self.send_response(204)
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            # X-NarChat: bundled app (allowlist origin) TÜM authlu çağrılarda + N2 musluk faucet'inde bu CSRF
            # başlığını cross-origin yollar → preflight'ta izin verilmezse uyumlu WebView isteği düşürür.
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-NarChat")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, kod, veri, ekstra=None):
        gov = json.dumps(veri, ensure_ascii=False).encode()
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(gov)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self._cors_basliklari_ekle()
        if ekstra:
            for k, v in ekstra: self.send_header(k, v)
        self.end_headers()
        self.wfile.write(gov)

    def _ham(self, kod, veri_bytes, tip="application/octet-stream", ekstra=None):
        self.send_response(kod)
        self.send_header("Content-Type", tip)
        self.send_header("Content-Length", str(len(veri_bytes)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self._cors_basliklari_ekle()
        if ekstra:
            for k, v in ekstra: self.send_header(k, v)
        self.end_headers()
        self.wfile.write(veri_bytes)

    def _cookie(self):
        c = self.headers.get("Cookie", "")
        for parca in c.split(";"):
            parca = parca.strip()
            if parca.startswith("narchat_oturum="):
                return parca[len("narchat_oturum="):]
        return None

    def _istemci_ip(self):
        # Üretim: gerçek istemci IP'si CF-Connecting-IP'de gelir (Cloudflare tünel edge yazar, client
        # SPOOF EDEMEZ). XFF ise en-sol değeri client-kontrollü olduğundan güvenilmez → yalnız açık
        # test-kancasıyla (NARCHAT_TEST_HOOKS=1) kabul edilir (ikinci-göz 🟠 savunma-derinliği). CF başlığı
        # yoksa client-XFF'ye DEĞİL soket IP'sine düşülür → per-IP musluk-tavanı + rate-limit prod'da
        # başlık-enjeksiyonuyla atlanamaz (sunucu zaten yalnız 127.0.0.1'e bağlı, tünel-dışı inbound yok).
        h = self.headers
        cf = h.get("CF-Connecting-IP")
        if cf: return cf
        if os.environ.get("NARCHAT_TEST_HOOKS") == "1":
            xff = (h.get("X-Forwarded-For") or "").split(",")[0].strip()
            if xff: return xff
        return self.client_address[0]

    def _trafik(self, olay, kimlik, bayt=0):
        # WP1 kancası: uyumlu sürümde yasal kayıt üretir; kapalıyken (referans davranış) no-op.
        # Kayıt hatası istek akışını KESMEZ ama sessizce de yutulmaz (stderr -> servis logu):
        # 5651-kaydı servis-kesintisi pahasına değildir; kalıcı kayıt-hatası ayrı bir alarm konusudur.
        if TRAFIK is None: return
        try:
            # 🔴-1: CDN/tünel istemci kaynak-portunu origin'e İLETMEZ — cloudflared'in yerel geçici
            # portunu "istemci portu" diye yazmak yasal kayda YANLIŞ veri sokar. CF-yolunda 0 =
            # "yapısal olarak ölçülemedi" (aydınlatma metni + runbook beyanı; A3 CF-çıkışında gerçeğe kavuşur).
            port = 0 if self.headers.get("CF-Connecting-IP") else self.client_address[1]
            TRAFIK.olay(olay, kimlik=kimlik, ip=self._istemci_ip(), bayt=int(bayt or 0), port=port)
            _trafik_hata["n"] = 0
        except Exception as e:
            _trafik_hata["n"] += 1
            print("TRAFIK-KAYIT HATASI:", e, file=sys.stderr)
            if _trafik_hata["n"] == TRAFIK_HATA_ESIK:   # 🟠-2: izlemesiz fail-open olmaz
                print("🔴 TRAFIK-KAYIT: %d ARDIŞIK HATA — 5651 kayıt yükümlülüğü AKSIYOR; "
                      "disk/izin denetleyin (runbook: yasal-talep)." % TRAFIK_HATA_ESIK, file=sys.stderr)
                kmt = os.environ.get("NARCHAT_TRAFIK_ALARM_KOMUT")
                if kmt:
                    try:
                        import subprocess
                        subprocess.Popen(kmt, shell=True)
                    except Exception:
                        pass

    def _kim(self):
        tok = self._cookie()
        k = _oturum_coz(tok) if tok else None
        if k: _gorundu(k)   # her authlu istek = son-görülme tazele (hafif çevrimiçi)
        return k

    # --- statik dosya ---
    # WP2 uyum sayfaları: temiz-URL (uzantısız) erişim. Yalnız bu bilinen sabit adlar eşlenir
    # (keyfî uzantı-ekleme YOK → path-traversal yüzeyi büyümez).
    _UYUM_SAYFALARI = {"/iletisim": "/iletisim.html", "/aydinlatma": "/aydinlatma.html",
                       "/kosullar": "/kosullar.html"}

    def _statik(self, yol):
        if yol == "/" or yol == "": yol = "/index.html"
        yol = self._UYUM_SAYFALARI.get(yol, yol)
        tam = os.path.normpath(os.path.join(STATIK, yol.lstrip("/")))
        if not tam.startswith(STATIK + os.sep) or not os.path.isfile(tam):   # D1: prefix-bypass'a karşı os.sep (yazma yoluyla tutarlı)
            self._json(404, {"hata": "yok"}); return
        tip = {".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",
               ".css":"text/css;charset=utf-8",".json":"application/json;charset=utf-8",
               ".webmanifest":"application/manifest+json",".svg":"image/svg+xml",
               ".apk":"application/vnd.android.package-archive"}.get(   # FAZ N4: imzalı release dağıtımı
               os.path.splitext(tam)[1], "application/octet-stream")
        with open(tam, "rb") as f: gov = f.read()
        self.send_response(200)
        self.send_header("Content-Type", tip)
        self.send_header("Content-Length", str(len(gov)))
        self.send_header("Service-Worker-Allowed", "/")
        # Kabuk (html/js/sw) taze kalmalı: Cloudflare/tarayıcı eski kripto kodunu sunmasın.
        # no-cache = sakla ama her seferinde doğrula (CF bunu görünce cache'lemez).
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(gov)

    # ---------- GET ----------
    def do_GET(self):
        u = urlparse(self.path); yol = u.path
        if not yol.startswith("/api/"):
            return self._statik(yol)
        kim = self._kim()
        if yol == "/api/vapid":
            return self._json(200, {"pubkey": _vapid_acik_b64()})   # açık anahtar — auth gerekmez
        if yol == "/api/giris-meydan":
            # auth gerekmez — giriş ÖNCESİ çağrılır.
            # D1/L1: bu GET de auth-yüzeyi (nonce-hasat + kaba-kuvvet + enumeration) → hız-sınırına TABİ.
            if _oran_asildi(self._istemci_ip()):
                return self._json(429, {"hata": "çok fazla deneme — biraz sonra tekrar deneyin"},
                                  ekstra=[("Retry-After", str(RATE_PENCERE))])
            q = parse_qs(u.query); kullanici = (q.get("kullanici") or [""])[0].strip().lower()
            rec = _oku(F_KULL, {}).get(kullanici)
            # D1/L1 (enumeration): var-olmayan hesap, TAZE bir v2 hesabı gibi görünür (varsayılan surum+kdf) —
            # böylece "surum:2 → hesap var" sızıntısı kapanır. (Göç-öncesi v1 hesaplar surum:1 döner; bu
            # geçici ayrım küçük/davet-kapılı takım için düşük risk, migrasyon bitince tamamen kapanır.)
            # D1/M1: v2 hesabın KDF profili de bildirilir (kdf alanı yoksa = eski INTERACTIVE = profil 1).
            if rec is None:
                surum, kdf = 2, KDF_VARSAYILAN
            else:
                surum = rec.get("surum", 1)
                kdf = rec.get("kdf", 1)
            return self._json(200, {"surum": surum, "kdf": kdf, "meydan": Ed25519Sema.meydan_uret(kullanici, SIR)})
        if yol == "/api/ben":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            k = _oku(F_KULL, {}).get(kim, {})
            return self._json(200, {"kullanici": kim, "pubkey": k.get("pubkey"),
                                    "engelli": k.get("engelli", []),    # G7: engellediklerim
                                    "yildiz": k.get("yildiz", []),       # G12: yıldızladıklarım [{oda,id}] (kişisel, cihazlar arası)
                                    # G8: gizlilik (True = açık/görünür). Varsayılan ikisi de açık.
                                    "gizlilik": {"son": not k.get("gizli_son"), "okundu": not k.get("gizli_okundu")}})
        if yol == "/api/kullanicilar":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            kull = _oku(F_KULL, {})
            return self._json(200, [{"kullanici": u_, "pubkey": d.get("pubkey"),
                                     "ad": d.get("ad"), "avatar": bool(d.get("avatar"))}
                                    for u_, d in kull.items()])
        if yol == "/api/avatar":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            q = parse_qs(u.query)
            return self._avatar_indir((q.get("u") or [""])[0])
        if yol == "/api/turn":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            return self._json(200, {"iceServers": _turn_ice()})
        if yol == "/api/duyurular":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            return self._json(200, _oku(F_DUYURU, {"surum": 0, "urunler": []}))
        if yol == "/api/kisiler":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            kull = _oku(F_KULL, {})
            benim = _oku(F_KISI, {}).get(kim, [])
            ben_gizli = bool(kull.get(kim, {}).get("gizli_son"))   # G8: ben gizlersem başkasınınkini de görmem (karşılıklı)
            # Çevrimiçi/son-görülme yalnız EKLEDİĞİN kişiler için (gizlilik: herkese değil)
            return self._json(200, [{"kullanici": u_, "pubkey": kull.get(u_, {}).get("pubkey"),
                                     "ad": kull.get(u_, {}).get("ad"), "avatar": bool(kull.get(u_, {}).get("avatar")),
                                     "cevrimici": (not ben_gizli and not kull.get(u_, {}).get("gizli_son") and _cevrimici(u_)),
                                     "son": (0 if (ben_gizli or kull.get(u_, {}).get("gizli_son")) else SON_GORULME.get(u_, 0))}
                                    for u_ in benim if u_ in kull])
        if yol == "/api/odalar":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            odalar = _oku(F_ODA, {})
            benim = []
            for oid, od in odalar.items():
                if kim not in od.get("uyeler", []): continue
                self._kaybolan_supur(oid)                    # G6: liste önizlemesi de süresi dolanı göstermesin
                son = self._son_mesaj(oid)
                benim.append({"oda": oid, **od,
                              "son": son.get("govde") if son else None,
                              "son_ts": son.get("ts") if son else 0,
                              "son_gonderen": son.get("gonderen") if son else None,
                              "son_silindi": bool(son.get("silindi")) if son else False})
            return self._json(200, benim)
        if yol == "/api/medya":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            q = parse_qs(u.query)
            return self._medya_indir((q.get("id") or [""])[0])
        if yol == "/api/mesajlar":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            q = parse_qs(u.query); oda = (q.get("oda") or [""])[0]
            since = int((q.get("since") or ["0"])[0])
            limit = int((q.get("limit") or ["0"])[0])       # H3: sayfalama — son N mesaj (açılış hızı)
            if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
            self._kaybolan_supur(oda)                       # G6: süresi dolanları temizle (oku öncesi)
            msgs = self._mesaj_oku(oda, since)
            if limit > 0: msgs = msgs[-limit:]              # son N (jsonl zaman sırasında; since=0 ile birlikte = son N mesaj)
            oku = _okundu_oku(oda)
            for m in msgs: m["okuyanlar"] = oku.get(m.get("id"), [])
            return self._json(200, msgs)
        if yol == "/api/tepkiler":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            q = parse_qs(u.query); oda = (q.get("oda") or [""])[0]
            if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
            return self._json(200, _oku(F_TEPKI, {}).get(oda, {}))
        if yol == "/api/akis":
            return self._sse(kim, u)
        if yol == "/api/cihaz-aktar":
            if not kim: return self._json(401, {"hata": "oturum yok"})
            q = parse_qs(u.query); kanal = (q.get("kanal") or [""])[0].strip()
            return self._cihaz_aktar_oku(kim, kanal)
        return self._json(404, {"hata": "yok"})

    # ---------- POST ----------
    def do_POST(self):
        yol = urlparse(self.path).path
        if yol == "/api/medya":
            return self._medya_yukle()   # ham ikili gövde — _govde() (JSON) ile okunmaz
        gov = self._govde()
        if yol in ("/api/kayit", "/api/giris", "/api/narc-kod"):
            if _oran_asildi(self._istemci_ip()):
                return self._json(429, {"hata": "çok fazla deneme — biraz sonra tekrar deneyin"},
                                  ekstra=[("Retry-After", str(RATE_PENCERE))])
            if yol == "/api/narc-kod":
                # go-public sertleştirme (bağımsız ikinci-göz 🔴): musluk = kimlik-doğrulamasız kaynak
                # üretimi → CSRF özel-başlığı ZORUNLU. Başlık olmadan kötü-niyetli bir sayfa, ziyaretçinin
                # tarayıcısından (her ziyaretçi FARKLI gerçek IP → per-IP tavan hiç devreye girmez) sessizce
                # kod üretip global günlük kotayı tüketir → meşru kullanıcılar kilitlenir (DoS). Özel başlık
                # isteği "basit-olmayan" yapar → cross-site preflight allowlist-dışı origin'de düşer; kod.html
                # aynı-origin olduğundan header'ı sorunsuz yollar (kayit/giris zaten app.js api()'den yollar).
                if not self._csrf_ok(): return self._json(403, {"hata": "eksik istek başlığı"})
                return self._narc_kod()
            return self._kayit(gov) if yol == "/api/kayit" else self._giris(gov)
        if yol == "/api/cikis":
            return self._json(200, {"ok": True},
                ekstra=[("Set-Cookie", f"narchat_oturum=; Path=/; {self._cors_samesite()}; Max-Age=0")])
        kim = self._kim()
        if not kim: return self._json(401, {"hata": "oturum yok"})
        # D1/L2: bu noktadan sonrası authlu durum-değiştiren uçlar → CSRF özel-başlığı zorunlu.
        # (Kayıt/giriş/narc-kod = giriş-öncesi, çerez TÜKETMEZ → CSRF yüzeyi yok, muaf.)
        if not self._csrf_ok(): return self._json(403, {"hata": "eksik istek başlığı"})
        if yol == "/api/auth-yukselt":
            return self._auth_yukselt(kim, gov)
        if yol == "/api/anahtar":
            return self._anahtar(kim, gov)
        if yol == "/api/kisi-ekle":
            return self._kisi_ekle(kim, gov)
        if yol == "/api/kisi-sil":
            return self._kisi_sil(kim, gov)
        if yol == "/api/engelle":
            return self._engelle(kim, gov, True)
        if yol == "/api/engel-kaldir":
            return self._engelle(kim, gov, False)
        if yol == "/api/gizlilik":
            return self._gizlilik(kim, gov)
        if yol == "/api/oda":
            return self._oda_kur(kim, gov)
        if yol == "/api/mesaj":
            return self._mesaj_gonder(kim, gov)
        if yol == "/api/mesaj-sil":
            return self._mesaj_sil(kim, gov)
        if yol == "/api/mesaj-duzenle":
            return self._mesaj_duzenle(kim, gov)
        if yol == "/api/sabitle":
            return self._sabitle(kim, gov)
        if yol == "/api/yildizla":
            return self._yildizla(kim, gov)
        if yol == "/api/yaziyor":
            return self._yaziyor(kim, gov)
        if yol == "/api/tepki":
            return self._tepki(kim, gov)
        if yol == "/api/profil":
            return self._profil(kim, gov)
        if yol == "/api/push-abone":
            sub = gov.get("subscription") or {}
            if not sub.get("endpoint"): return self._json(400, {"hata": "subscription gerek"})
            _push_abone_ekle(kim, sub)
            return self._json(200, {"ok": True})
        if yol == "/api/push-cik":
            _push_abone_sil(gov.get("endpoint"))
            return self._json(200, {"ok": True})
        if yol == "/api/okundu":
            return self._okundu(kim, gov)
        if yol == "/api/oda-ad":
            return self._oda_ad(kim, gov)
        if yol == "/api/oda-uye":
            return self._oda_uye(kim, gov)
        if yol == "/api/oda-foto":
            return self._oda_foto(kim, gov)
        if yol == "/api/sinyal":
            return self._sinyal(kim, gov)
        if yol == "/api/cihaz-aktar":
            return self._cihaz_aktar_yaz(kim, gov)
        return self._json(404, {"hata": "yok"})

    # ---------- iş mantığı ----------
    def _narc_kod(self):
        # FAZ N2: musluk kapalıyken (varsayılan) VEYA "silahsız" (davetler.json yok = zaten açık kayıt)
        # sunucuda anlamsız — 404 (özellik yokmuş gibi davran, kamuya açılış hukuk kapısı beklerken sızdırma).
        if not NARCHAT_KOD_ACIK or not os.path.exists(F_DAVET):
            return self._json(404, {"hata": "yok"})
        # Gizlilik-namusu: ham IP diske YAZILMAZ. Per-IP tavan için IP'yi sunucu-sırrıyla (SIR)
        # HMAC'leyip 16-hex'e kısaltarak geri-döndürülemez "kova anahtarı" (ipk) türetiriz —
        # dosyayı ele geçiren biri hangi IP'nin kaç kod aldığını çıkaramaz, biz de saklamıyoruz.
        ipk = hmac.new(SIR, self._istemci_ip().encode(), hashlib.sha256).hexdigest()[:16]
        with KILIT:
            dd = _oku(F_DAVET, {"kodlar": [], "kullanilmis": {}, "otokodlar": {}})
            oto = dd.setdefault("otokodlar", {})
            simdi = _now()
            # Süresi geçmiş (kullanılmış ya da değil, artık asla geçerli olamaz) kodları ara-sıra süpür —
            # dosya süresiz büyümesin (bkz _aktarim_temizle aynı desen).
            for k in [k for k, v in oto.items() if simdi - v.get("olusturma", 0) > NARC_KOD_TTL]:
                oto.pop(k, None)
            # Global günlük tavan: yuvarlanan 24 saatlik pencerede üretilmiş kod sayısı (takvim-günü
            # sıfırlaması değil — basit + gece-yarısı kenar durumu yok).
            son_24s = sum(1 for v in oto.values() if simdi - v.get("olusturma", 0) < 86400)
            if son_24s >= NARCHAT_KOD_GUNLUK:
                return self._json(429, {"hata": "günlük kod üretim sınırı doldu — yarın tekrar deneyin"})
            # Per-IP günlük tavan (D1): tek bir IP global kotayı tek başına tüketmesin. Eski kayıtlarda
            # ipk yok → gerçek 16-hex ipk ile eşleşmez, per-IP sayıma girmez (geriye uyumlu, göç gerekmez).
            ip_24s = sum(1 for v in oto.values()
                         if v.get("ipk") == ipk and simdi - v.get("olusturma", 0) < 86400)
            if ip_24s >= NARCHAT_KOD_IP_GUNLUK:
                return self._json(429, {"hata": "bu ağdan günlük kod üretim sınırı doldu — yarın tekrar deneyin"})
            for _ in range(20):
                kod = _narc_kod_uret()
                if kod not in dd.get("kodlar", []) and kod not in oto:
                    break
            else:
                return self._json(500, {"hata": "kod üretilemedi, tekrar deneyin"})
            oto[kod] = {"olusturma": simdi, "kullanildi": None, "ipk": ipk}
            _atomik_yaz(F_DAVET, dd)
        return self._json(200, {"kod": kod})

    def _kayit(self, gov):
        # FAZ N1: yeni kayıtlar hep v2 (sıfır-bilgi) — parola sunucuya HİÇ gitmez, yalnız
        # istemcinin (static/auth.js) paroladan türettiği Ed25519 public "doğrulayıcı" gelir.
        kullanici = (gov.get("kullanici") or "").strip().lower()
        pubkey = gov.get("pubkey")
        if not kullanici:
            return self._json(400, {"hata": "kullanıcı gerek"})
        # D1/H1 güvenlik yaması: kullanıcı adı sonradan AVATARDIR gibi dosya-yollarında kullanılıyor
        # (_profil). Karakter kümesi denetlenmezse "../../etc/..." gibi bir ad path-traversal'a
        # açık olurdu — burada ENGELLENİYOR (yalnız harf/rakam/_, 2-32 karakter).
        if not _kullanici_gecerli(kullanici):
            return self._json(400, {"hata": "kullanıcı adı yalnız harf/rakam/_ olabilir (2-32 karakter)"})
        # Davet kodu: yalnız davetler.json VARSA zorunlu ("silahlı" mod). Yoksa açık kayıt (test/ilk kurulum).
        # İki kod kaynağı kabul edilir: elle-seedlenmiş "kodlar" (süresiz, tek-kullanımlık) VE
        # FAZ N2 self-servis "otokodlar" (72 saat ömürlü, tek-kullanımlık) — geriye uyumlu.
        davet_gerek = os.path.exists(F_DAVET)
        davet = (gov.get("davet") or "").strip()
        with KILIT:
            dd = None
            if davet_gerek:
                dd = _oku(F_DAVET, {"kodlar": [], "kullanilmis": {}, "otokodlar": {}})
                elle = davet in dd.get("kodlar", []) and davet not in dd.get("kullanilmis", {})
                oto = dd.get("otokodlar", {}).get(davet)
                oto_gecerli = bool(oto) and not oto.get("kullanildi") and _now() - oto.get("olusturma", 0) <= NARC_KOD_TTL
                if not (elle or oto_gecerli):
                    return self._json(403, {"hata": "geçersiz veya kullanılmış davet kodu"})
            kull = _oku(F_KULL, {})
            if kullanici in kull:
                return self._json(409, {"hata": "kullanıcı var"})
            kayit_gov, hata = Ed25519Sema.kayit(gov)
            if hata: return self._json(400, {"hata": hata})
            kayit_gov["pubkey"] = pubkey
            kayit_gov["olusturma"] = _now()
            kull[kullanici] = kayit_gov
            _atomik_yaz(F_KULL, kull)
            if davet_gerek:
                if oto_gecerli:
                    dd["otokodlar"][davet]["kullanildi"] = {"kullanici": kullanici, "ts": _now()}
                else:
                    dd.setdefault("kullanilmis", {})[davet] = {"kullanici": kullanici, "ts": _now()}
                _atomik_yaz(F_DAVET, dd)
        tok = _oturum_uret(kullanici, kayit_gov.get("oturum_nesli", 0))
        self._trafik("kayit", kullanici)   # WP1
        return self._json(200, {"ok": True, "kullanici": kullanici},
            ekstra=[("Set-Cookie", f"narchat_oturum={tok}; Path=/; HttpOnly; {self._cors_samesite()}; Max-Age={OTURUM_GUN*86400}")])

    def _giris(self, gov):
        # v1 hesap (henüz yükselmemiş) → gov={kullanici,parola} (eski göç fallback'i).
        # v2 hesap → gov={kullanici,meydan,imza} (parola hiç gelmez; bkz /api/giris-meydan).
        kullanici = (gov.get("kullanici") or "").strip().lower()
        kull = _oku(F_KULL, {})
        k = kull.get(kullanici)
        if not k: return self._json(401, {"hata": "hatalı giriş"})
        if k.get("askiya"):   # WP3: operatör idari tedbiri (yasal talep/bildirim üzerine); dayanak operatör-günlüğünde
            return self._json(403, {"hata": "hesap askıya alındı"})
        surum = k.get("surum", 1)
        sema = SEMALAR.get(surum, SEMALAR[1])
        if not sema.dogrula(gov, k, SIR):
            return self._json(401, {"hata": "hatalı giriş"})
        # D1/M1: giriş-bağlı KDF profil rotasyonu. İstemci ESKİ profille imzaladı (parola kanıtı BU istekte
        # tüketildi) ve YENİ profille türetilmiş bir doğrulayıcı da yolladıysa, imza geçerliyse profili yükselt.
        # GÜVENLİ: yalnız geçerli imza (=parola bilgisi) tetikler — çalıntı çerez TETİKLEYEMEZ (giriş çerezsiz).
        # Yalnız YUKARI (profil artışı); downgrade reddedilir. Yükseltme bir güvenlik olayı → oturum nesli artar.
        yeni_dog = gov.get("yeni_dogrulayici")
        yeni_kdf = gov.get("yeni_kdf")
        if surum == 2 and yeni_dog and yeni_kdf in KDF_PROFILLERI and yeni_kdf > k.get("kdf", 1):
            try:
                gecerli = len(base64.b64decode(yeni_dog, validate=True)) == 32
            except Exception:
                gecerli = False
            if gecerli:
                with KILIT:
                    kull2 = _oku(F_KULL, {})
                    if kullanici in kull2:
                        kull2[kullanici]["dogrulayici"] = yeni_dog
                        kull2[kullanici]["kdf"] = yeni_kdf
                        kull2[kullanici]["oturum_nesli"] = kull2[kullanici].get("oturum_nesli", 0) + 1
                        _atomik_yaz(F_KULL, kull2)
                        k = kull2[kullanici]
        tok = _oturum_uret(kullanici, k.get("oturum_nesli", 0))
        self._trafik("oturum", kullanici)   # WP1
        return self._json(200, {"ok": True, "kullanici": kullanici, "pubkey": k.get("pubkey"), "surum": surum, "kdf": k.get("kdf", 1)},
            ekstra=[("Set-Cookie", f"narchat_oturum={tok}; Path=/; HttpOnly; {self._cors_samesite()}; Max-Age={OTURUM_GUN*86400}")])

    def _auth_yukselt(self, kim, gov):
        # Göç: v1 hesap girişten hemen sonra istemci aynı paroladan v2 doğrulayıcı türetip buraya yollar.
        # D1/M2: eski salt/hash artık HEMEN silinir (eskiden "bir paket boyu emniyet payı" ile N3'e
        # kadar tutulurdu — D1 bunu kalıcı risk olarak işaretledi: dosya N3-öncesi sızarsa en kolay
        # kırılma yolu hâlâ zayıf v1 hash'ti). D1/M3: yükseltme bir güvenlik olayı sayılır — oturum
        # nesli artırılır (bu hesabın başka yerdeki TÜM eski token'ları iptal olur); bu isteğin kendi
        # oturumu kesintiye uğramasın diye YENİ nesille taze bir çerez hemen geri verilir.
        with KILIT:
            kull = _oku(F_KULL, {})
            k = kull.get(kim)
            if not k: return self._json(404, {"hata": "yok"})
            if k.get("surum", 1) == 2:
                return self._json(200, {"ok": True, "zatenYukseldi": True})
            yeni, hata = Ed25519Sema.kayit(gov)
            if hata: return self._json(400, {"hata": hata})
            k["surum"] = 2
            k["dogrulayici"] = yeni["dogrulayici"]
            k["kdf"] = yeni["kdf"]   # D1/M1: doğrulayıcının türetildiği KDF profili kaydedilir (giriş bunu okur)
            k.pop("salt", None)
            k.pop("hash", None)
            k["oturum_nesli"] = k.get("oturum_nesli", 0) + 1
            kull[kim] = k
            _atomik_yaz(F_KULL, kull)
        tok = _oturum_uret(kim, k["oturum_nesli"])
        return self._json(200, {"ok": True},
            ekstra=[("Set-Cookie", f"narchat_oturum={tok}; Path=/; HttpOnly; {self._cors_samesite()}; Max-Age={OTURUM_GUN*86400}")])

    def _anahtar(self, kim, gov):
        pub = gov.get("pubkey")
        if not pub: return self._json(400, {"hata": "pubkey gerek"})
        with KILIT:
            kull = _oku(F_KULL, {})
            if kim not in kull: return self._json(404, {"hata": "yok"})
            kull[kim]["pubkey"] = pub
            _atomik_yaz(F_KULL, kull)
        return self._json(200, {"ok": True})

    def _kisi_ekle(self, kim, gov):
        # Kişi defterine kullanıcı adıyla ekle (yalnız var olan + kendisi-değil). Kişi listesi = bunlar.
        hedef = (gov.get("kullanici") or "").strip().lower()
        if not hedef: return self._json(400, {"hata": "kullanıcı adı gerek"})
        if hedef == kim: return self._json(400, {"hata": "kendini ekleyemezsin"})
        kull = _oku(F_KULL, {})
        if hedef not in kull: return self._json(404, {"hata": "böyle bir kullanıcı yok"})
        with KILIT:
            kisiler = _oku(F_KISI, {})
            liste = kisiler.setdefault(kim, [])
            if hedef not in liste: liste.append(hedef)
            _atomik_yaz(F_KISI, kisiler)
        return self._json(200, {"ok": True, "kullanici": hedef, "pubkey": kull[hedef].get("pubkey")})

    def _kisi_sil(self, kim, gov):
        hedef = (gov.get("kullanici") or "").strip().lower()
        with KILIT:
            kisiler = _oku(F_KISI, {})
            if kim in kisiler and hedef in kisiler[kim]:
                kisiler[kim] = [u for u in kisiler[kim] if u != hedef]
                _atomik_yaz(F_KISI, kisiler)
        return self._json(200, {"ok": True})

    def _oda_kur(self, kim, gov):
        tip = gov.get("tip", "ikili")
        uyeler = gov.get("uyeler") or []
        if kim not in uyeler: uyeler.append(kim)
        uyeler = sorted(set(u.strip().lower() for u in uyeler))
        if len(uyeler) < 2: return self._json(400, {"hata": "en az 2 üye"})
        if tip == "ikili" and len(uyeler) > 2: return self._json(400, {"hata": "ikili = 2 üye"})
        if len(uyeler) > 4: return self._json(400, {"hata": "grup max 4 (mesh sınırı)"})
        # G7: engellenen biriyle yeni 1:1 başlatılamaz (karşı taraf beni engellediyse ya da ben onu)
        for u in uyeler:
            if u == kim: continue
            if self._engelledi_mi(u, kim) or self._engelledi_mi(kim, u):
                return self._json(403, {"hata": "engelli kullanıcı"})
        ad = gov.get("ad") or (", ".join(uyeler))
        with KILIT:
            odalar = _oku(F_ODA, {})
            # ikili oda zaten varsa onu döndür (idempotent)
            if tip == "ikili":
                for oid, od in odalar.items():
                    if od.get("tip") == "ikili" and sorted(od.get("uyeler", [])) == uyeler:
                        return self._json(200, {"oda": oid, **od})
            oid = "oda_" + secrets.token_hex(6)
            odalar[oid] = {"tip": tip, "ad": ad, "uyeler": uyeler, "olusturma": _now()}
            _atomik_yaz(F_ODA, odalar)
        return self._json(200, {"oda": oid, **odalar[oid]})

    def _engelle(self, kim, gov, ekle):
        # G7: kişi engelle/engel-kaldır. Engellediğim kişi → bana bildirim/yeni-1:1 gelmez;
        # mesajlarını istemcim gizler. Kendi engel listemde tutulur (cihazlar arası senkron).
        hedef = (gov.get("kullanici") or "").strip().lower()
        if not hedef or hedef == kim: return self._json(400, {"hata": "geçersiz kullanıcı"})
        with KILIT:
            kull = _oku(F_KULL, {})
            if kim not in kull: return self._json(404, {"hata": "kullanıcı yok"})
            lst = kull[kim].get("engelli", [])
            if ekle:
                if hedef not in lst: lst.append(hedef)
            else:
                lst = [u for u in lst if u != hedef]
            kull[kim]["engelli"] = lst
            _atomik_yaz(F_KULL, kull)
        return self._json(200, {"ok": True, "engelli": lst})

    def _engelledi_mi(self, sahip, hedef):
        # sahip, hedef'i engelledi mi?
        return hedef in _oku(F_KULL, {}).get(sahip, {}).get("engelli", [])

    def _gizlilik(self, kim, gov):
        # G8: gizlilik tercihleri (son-görülme/çevrimiçi + okundu). Gelen değer True=AÇIK/görünür.
        with KILIT:
            kull = _oku(F_KULL, {})
            if kim not in kull: return self._json(404, {"hata": "kullanıcı yok"})
            if "son" in gov:    kull[kim]["gizli_son"] = not bool(gov.get("son"))
            if "okundu" in gov: kull[kim]["gizli_okundu"] = not bool(gov.get("okundu"))
            _atomik_yaz(F_KULL, kull)
            k = kull[kim]
        return self._json(200, {"ok": True, "gizlilik": {"son": not k.get("gizli_son"), "okundu": not k.get("gizli_okundu")}})

    def _uye_mi(self, kim, oda):
        od = _oku(F_ODA, {}).get(oda)
        return bool(od and kim in od.get("uyeler", []))

    def _mesaj_yol(self, oda):
        return os.path.join(MSGDIR, oda + ".jsonl")

    def _mesaj_oku(self, oda, since):
        yol = self._mesaj_yol(oda); out = []
        try:
            with open(yol, encoding="utf-8") as f:
                for satir in f:
                    try: m = json.loads(satir)
                    except Exception: continue
                    if m.get("ts", 0) > since: out.append(m)
        except FileNotFoundError:
            pass
        return out

    def _son_mesaj(self, oda):
        """Oda dosyasının son geçerli kaydı (sohbet listesi önizlemesi için)."""
        son = None
        try:
            with open(self._mesaj_yol(oda), encoding="utf-8") as f:
                for satir in f:
                    satir = satir.strip()
                    if not satir: continue
                    try: son = json.loads(satir)
                    except Exception: pass
        except FileNotFoundError:
            pass
        return son

    def _okundu(self, kim, gov):
        oda = gov.get("oda"); ids = gov.get("ids") or []
        if not oda or not isinstance(ids, list): return self._json(400, {"hata": "oda + ids gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        _okundu_isaretle(oda, ids, kim)
        _yayinla(oda, {"tip": "okundu", "oda": oda, "ids": ids, "okuyan": kim})
        return self._json(200, {"ok": True})

    def _oda_ad(self, kim, gov):
        oda = gov.get("oda"); ad = (gov.get("ad") or "").strip()[:80]
        if not oda or not ad: return self._json(400, {"hata": "oda + ad gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        with KILIT:
            odalar = _oku(F_ODA, {})
            if oda not in odalar: return self._json(404, {"hata": "oda yok"})
            odalar[oda]["ad"] = ad
            _atomik_yaz(F_ODA, odalar)
        _yayinla(oda, {"tip": "oda-ad", "oda": oda, "ad": ad})
        return self._json(200, {"ok": True, "ad": ad})

    def _oda_uye(self, kim, gov):
        # H3: grup üye yönetimi — ekle / cikar / ayril. Yalnız grup + yalnız üye değiştirir.
        # E2E ileri-gizlilik: yeni üyeye GEÇMİŞ açılmaz (eski mesajlar onun anahtarına şifrelenmemişti);
        # yeni mesajlar gönderilirken istemci güncel üye listesine fan-out şifreler. Sunucu yalnız üyelik (metadata) tutar.
        oda = gov.get("oda"); eylem = gov.get("eylem")
        hedef = (gov.get("kullanici") or "").strip().lower()
        if not oda or eylem not in ("ekle", "cikar", "ayril"): return self._json(400, {"hata": "oda + eylem gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        with KILIT:
            odalar = _oku(F_ODA, {})
            od = odalar.get(oda)
            if not od: return self._json(404, {"hata": "oda yok"})
            if od.get("tip") != "grup": return self._json(400, {"hata": "yalnız grup"})
            oncekiler = list(od.get("uyeler", []))
            uyeler = list(oncekiler)
            if eylem == "ekle":
                if not hedef: return self._json(400, {"hata": "kullanıcı gerek"})
                if hedef not in _oku(F_KULL, {}): return self._json(404, {"hata": "kullanıcı yok"})
                if hedef in uyeler: return self._json(200, {"ok": True, "uyeler": uyeler})
                if len(uyeler) >= 4: return self._json(400, {"hata": "grup max 4 (mesh sınırı)"})
                uyeler.append(hedef)
            elif eylem == "cikar":
                if hedef not in uyeler: return self._json(400, {"hata": "üye değil"})
                uyeler = [u for u in uyeler if u != hedef]
            else:  # ayril
                hedef = kim
                uyeler = [u for u in uyeler if u != kim]
            uyeler = sorted(set(uyeler))
            od["uyeler"] = uyeler
            odalar[oda] = od
            _atomik_yaz(F_ODA, odalar)
        # tüm ESKİ üyelere (çıkarılan/ayrılan dahil) kişisel kanaldan haber → liste tazelensin
        olay = {"tip": "oda-uye", "oda": oda, "uyeler": uyeler, "eylem": eylem, "kim": kim, "hedef": hedef}
        for u in set(oncekiler) | {hedef}:
            _yayinla_kisi(u, olay)
        return self._json(200, {"ok": True, "uyeler": uyeler})

    def _oda_foto(self, kim, gov):
        # H3: grup fotoğrafı (metadata; ad gibi). Üye değiştirir; data-URL od kaydında. boş/None → kaldır.
        oda = gov.get("oda"); avatar = gov.get("avatar")
        if not oda: return self._json(400, {"hata": "oda gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        if avatar is not None and (not isinstance(avatar, str) or len(avatar) > 400000):
            return self._json(400, {"hata": "avatar geçersiz / çok büyük (≤300KB)"})
        with KILIT:
            odalar = _oku(F_ODA, {})
            od = odalar.get(oda)
            if not od: return self._json(404, {"hata": "oda yok"})
            if od.get("tip") != "grup": return self._json(400, {"hata": "yalnız grup"})
            if avatar: od["avatar"] = avatar
            else: od.pop("avatar", None)
            uyeler = list(od.get("uyeler", []))
            odalar[oda] = od
            _atomik_yaz(F_ODA, odalar)
        for u in uyeler: _yayinla_kisi(u, {"tip": "oda-foto", "oda": oda})
        return self._json(200, {"ok": True})

    def _tepki(self, kim, gov):
        # Emoji tepkisi (E2E): emoji OPAK blob olarak gelir/saklanır — sunucu okumaz. mid+kim metadata.
        # Her kullanıcının bir mesaja en çok BİR tepkisi (toggle); kaldir=true → tepkiyi sil.
        oda = gov.get("oda"); mid = gov.get("mid")
        if not oda or not mid: return self._json(400, {"hata": "oda + mid gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        kaldir = bool(gov.get("kaldir")); blob = gov.get("blob")
        if not kaldir and blob is None: return self._json(400, {"hata": "blob gerek"})
        with KILIT:
            t = _oku(F_TEPKI, {})
            odat = t.setdefault(oda, {}); midt = odat.setdefault(mid, {})
            if kaldir: midt.pop(kim, None)
            else: midt[kim] = blob
            if not midt: odat.pop(mid, None)
            if not odat: t.pop(oda, None)
            _atomik_yaz(F_TEPKI, t)
        olay = {"tip": "tepki", "oda": oda, "mid": mid, "kim": kim}
        if kaldir: olay["kaldir"] = True
        else: olay["blob"] = blob
        _yayinla(oda, olay)
        return self._json(200, {"ok": True})

    def _sinyal(self, kim, gov):
        # Faz 2: WebRTC sinyalizasyon (offer/answer/ICE) — sunucu OPAK taşır, çözmez.
        # Medya zaten E2E (DTLS-SRTP); SDP/ICE oda SSE'si üzerinden ilgili eşe relay edilir.
        oda = gov.get("oda"); sinyal = gov.get("sinyal")
        if not oda or sinyal is None: return self._json(400, {"hata": "oda + sinyal gerek"})
        od = _oku(F_ODA, {}).get(oda)
        if not (od and kim in od.get("uyeler", [])): return self._json(403, {"hata": "üye değil"})
        # Sinyali oda üyelerinin KİŞİSEL kanalına yolla → alıcı o odayı açık tutmasa da
        # (sohbet listesi/ayarlar/başka oda) gelen arama zil çalar. SDP/ICE opak kalır.
        olay = {"tip": "sinyal", "oda": oda, "gonderen": kim, "sinyal": sinyal}
        for u in od.get("uyeler", []):
            if u != kim: _yayinla_kisi(u, olay)
        # Gelen arama = offer → alıcıya Web Push (telefon kilitli / app kapalı olsa da bildirim gelsin).
        # Re-offer süresince ~ARAMA_PUSH_ARALIK sn'de bir TEKRAR push → kilitli telefon tekrar titresin
        # ("telefon çalıyor" hissi). Bir çağrı penceresi ARAMA_PUSH_SURE sn ile sınırlı; >60sn sessizlik = yeni çağrı.
        if isinstance(sinyal, dict) and sinyal.get("t") == "offer":
            simdi = _now()
            with KILIT:
                rec = SON_ARAMA_PUSH.get((oda, kim))
                if not rec or simdi - rec["son"] > 60:
                    rec = {"ilk": simdi, "son": 0.0}
                gonder = (simdi - rec["son"] >= ARAMA_PUSH_ARALIK) and (simdi - rec["ilk"] <= ARAMA_PUSH_SURE)
                if gonder: rec["son"] = simdi
                SON_ARAMA_PUSH[(oda, kim)] = rec
            if gonder:
                ad = _oku(F_KULL, {}).get(kim, {}).get("ad") or ("@" + kim)
                for u in od.get("uyeler", []):
                    if u != kim:
                        _push_gonder(u, {"title": "📞 Gelen arama", "body": ad + " seni arıyor…",
                                         "url": "/", "tip": "arama"})
        return self._json(200, {"ok": True})

    def _cihaz_aktar_yaz(self, kim, gov):
        # Çok-cihaz: anahtarı-olan cihaz, PRIV'i parola-cümlesiyle şifreleyip (blob) bir kanala koyar.
        # Sunucu blob'u OPAK tutar; parola-cümlesi sunucuya gelmez. Sahibi = yükleyen kullanıcı.
        kanal = (gov.get("kanal") or "").strip()
        blob = gov.get("blob")
        if not kanal or not isinstance(blob, str) or not (0 < len(blob) <= AKTARIM_MAX_BLOB):
            return self._json(400, {"hata": "kanal + blob gerek"})
        with AKTARIM_KILIT:
            _aktarim_temizle()
            _AKTARIM[kanal] = {"owner": kim, "blob": blob, "ts": _now()}
        return self._json(200, {"ok": True})

    def _cihaz_aktar_oku(self, kim, kanal):
        # AYNI kullanıcının yeni cihazı tek-kullanımlık çeker (okununca silinir; TTL ile zaten dolar).
        if not kanal: return self._json(400, {"hata": "kanal gerek"})
        with AKTARIM_KILIT:
            _aktarim_temizle()
            rec = _AKTARIM.get(kanal)
            if not rec or rec["owner"] != kim:
                return self._json(404, {"hata": "kanal yok ya da süresi doldu"})
            _AKTARIM.pop(kanal, None)
        return self._json(200, {"blob": rec["blob"]})

    def _mesaj_gonder(self, kim, gov):
        oda = gov.get("oda"); govde = gov.get("govde")
        if not oda or govde is None: return self._json(400, {"hata": "oda + govde gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        # govde = OPAK E2E blob. Sunucu İÇİNE BAKMAZ, sadece saklar.
        # (Düz-metin reddi: govde içinde beklenen şifreli alanlar olmalı; içerik çözülmez.)
        kayit = {"id": secrets.token_hex(8), "oda": oda, "gonderen": kim,
                 "ts": _now(), "govde": govde}
        # G6 kaybolan mesaj: istemci TTL (saniye) damgalar — METADATA (sayı), içerik DEĞİL → E2E korunur.
        # Süre dolunca sunucu ciphertext'i siler (tombstone). 1sn..30gün arası.
        try:
            kaybol = int(gov.get("kaybol") or 0)
            if 1 <= kaybol <= 2592000:
                kayit["kaybol"] = kaybol; kayit["sil_ts"] = kayit["ts"] + kaybol
        except (TypeError, ValueError):
            pass
        with KILIT:
            os.makedirs(MSGDIR, exist_ok=True)
            with open(self._mesaj_yol(oda), "a", encoding="utf-8") as f:
                f.write(json.dumps(kayit, ensure_ascii=False) + "\n")
        self._trafik("mesaj-aktarim", kim, bayt=self.headers.get("Content-Length"))   # WP1: miktar, içerik değil (int-parse helper try'ında)
        _yayinla(oda, {"tip": "yeni-mesaj", "mesaj": kayit})
        # offline üyelere Web Push (gönderen hariç) — best-effort, içerik genel ("Yeni mesaj")
        try:
            for uye in _oku(F_ODA, {}).get(oda, {}).get("uyeler", []):
                if uye != kim and not self._engelledi_mi(uye, kim):   # G7: engelleyene bildirim gitmez
                    # N7: oda (opak id) push gövdesine eklenir → alıcı SW'si sessize-alınmış odayı SESSİZ gösterir.
                    # Gövde RFC8291 ile şifreli (yalnız alıcı çözer); oda içerik DEĞİL, opak metadata.
                    _push_gonder(uye, {"title": "📡 NarChat", "body": "Yeni mesaj", "url": "/", "oda": oda})
        except Exception:
            pass
        return self._json(200, {"ok": True, "id": kayit["id"], "ts": kayit["ts"]})

    def _mesaj_sil(self, kim, gov):
        # "Herkesten sil": YALNIZ gönderen + oda üyesi silebilir. Mesajı tombstone'lar —
        # ciphertext (govde) sunucudan da kalkar (E2E namusu), kayıt {silindi:True} ile kalır
        # (sıra/önizleme bozulmasın). SSE 'silindi' ile iki tarafta canlı baloncuk değişir.
        oda = gov.get("oda"); mid = gov.get("id")
        if not oda or not mid: return self._json(400, {"hata": "oda + id gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        bulundu = False; yetkili = True
        with KILIT:
            yol = self._mesaj_yol(oda)
            try:
                with open(yol, encoding="utf-8") as f:
                    satirlar = f.readlines()
            except FileNotFoundError:
                satirlar = []
            yeni = []
            for satir in satirlar:
                try: m = json.loads(satir)
                except Exception:
                    yeni.append(satir); continue
                if m.get("id") == mid:
                    bulundu = True
                    if m.get("gonderen") != kim:
                        yetkili = False; yeni.append(satir); continue
                    mezar = {"id": m.get("id"), "oda": oda, "gonderen": m.get("gonderen"),
                             "ts": m.get("ts"), "govde": None, "silindi": True}
                    yeni.append(json.dumps(mezar, ensure_ascii=False) + "\n")
                else:
                    yeni.append(satir)
            if bulundu and yetkili:
                tmp = yol + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write("".join(yeni))
                os.replace(tmp, yol)
        if not bulundu: return self._json(404, {"hata": "mesaj yok"})
        if not yetkili: return self._json(403, {"hata": "yalnızca gönderen silebilir"})
        _yayinla(oda, {"tip": "silindi", "oda": oda, "id": mid})
        return self._json(200, {"ok": True})

    def _mesaj_duzenle(self, kim, gov):
        # G9 mesaj düzenleme (edit, E2E): YALNIZ gönderen + oda üyesi. Yeni "govde" = istemcide
        # oda üyeleri için YENİDEN şifrelenmiş OPAK blob — sunucu DÜZ-METİN GÖRMEZ (E2E korunur).
        # Kayıt govde'si yerinde güncellenir + duzenlendi=True + duzenlendi_ts (diğer alanlar korunur).
        # Silinmiş ya da medya/sesli mesaj DÜZENLENEMEZ (yalnız metin). SSE 'duzenlendi' ile iki tarafta canlı.
        oda = gov.get("oda"); mid = gov.get("id"); govde = gov.get("govde")
        if not oda or not mid or govde is None: return self._json(400, {"hata": "oda + id + govde gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        bulundu = False; yetkili = True; uygun = True; dts = _now()
        with KILIT:
            yol = self._mesaj_yol(oda)
            try:
                with open(yol, encoding="utf-8") as f:
                    satirlar = f.readlines()
            except FileNotFoundError:
                satirlar = []
            yeni = []
            for satir in satirlar:
                try: m = json.loads(satir)
                except Exception:
                    yeni.append(satir); continue
                if m.get("id") == mid:
                    bulundu = True
                    if m.get("gonderen") != kim:
                        yetkili = False; yeni.append(satir); continue
                    eski = m.get("govde")
                    if m.get("silindi") or (isinstance(eski, dict) and eski.get("sema") == "e2e1m"):
                        uygun = False; yeni.append(satir); continue   # silinmiş/medya düzenlenemez
                    m["govde"] = govde; m["duzenlendi"] = True; m["duzenlendi_ts"] = dts
                    yeni.append(json.dumps(m, ensure_ascii=False) + "\n")
                else:
                    yeni.append(satir)
            if bulundu and yetkili and uygun:
                tmp = yol + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write("".join(yeni))
                os.replace(tmp, yol)
        if not bulundu: return self._json(404, {"hata": "mesaj yok"})
        if not yetkili: return self._json(403, {"hata": "yalnızca gönderen düzenleyebilir"})
        if not uygun:   return self._json(400, {"hata": "bu mesaj düzenlenemez"})
        _yayinla(oda, {"tip": "duzenlendi", "oda": oda, "id": mid, "govde": govde, "duzenlendi_ts": dts})
        return self._json(200, {"ok": True, "duzenlendi_ts": dts})

    def _sabitle(self, kim, gov):
        # G12: mesaj sabitle (oda başına, ÜYELERE görünür, cihazlar arası). sabit=True→sabitle, False→kaldır.
        # id = sabitlenen mesaj (METADATA; içerik E2E, sunucu okumaz). Oda kaydında `sabit` alanında tutulur.
        oda = gov.get("oda"); mid = gov.get("id"); sabit = bool(gov.get("sabit"))
        if not oda or (sabit and not mid): return self._json(400, {"hata": "oda + id gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        with KILIT:
            odalar = _oku(F_ODA, {})
            if oda not in odalar: return self._json(404, {"hata": "oda yok"})
            if sabit: odalar[oda]["sabit"] = mid
            else: odalar[oda].pop("sabit", None)
            _atomik_yaz(F_ODA, odalar)
        yeni = mid if sabit else None
        _yayinla(oda, {"tip": "sabit", "oda": oda, "id": yeni})
        return self._json(200, {"ok": True, "sabit": yeni})

    def _yildizla(self, kim, gov):
        # G12: mesaj yıldızla (KİŞİSEL yer-imi, cihazlar arası senkron). {oda,id} = METADATA — içerik
        # SAKLANMAZ (E2E; istemci yerel çözer). yildiz=True→ekle, False→çıkar. Kendi kaydımda tutulur.
        oda = gov.get("oda"); mid = gov.get("id"); yildiz = bool(gov.get("yildiz"))
        if not oda or not mid: return self._json(400, {"hata": "oda + id gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        with KILIT:
            kull = _oku(F_KULL, {})
            if kim not in kull: return self._json(404, {"hata": "kullanıcı yok"})
            lst = [x for x in kull[kim].get("yildiz", []) if not (x.get("oda") == oda and x.get("id") == mid)]
            if yildiz: lst.append({"oda": oda, "id": mid})
            kull[kim]["yildiz"] = lst
            _atomik_yaz(F_KULL, kull)
        return self._json(200, {"ok": True, "yildiz": lst})

    def _kaybolan_supur(self, oda):
        # G6: süresi dolan (sil_ts geçmiş) mesajları tombstone'lar — ciphertext SUNUCUDAN da kalkar.
        # Tembel süpürme: okuma/listeleme anında çağrılır (arka-plan thread yok). Süren ids → SSE.
        simdi = _now(); suresi_dolan = []
        with KILIT:
            yol = self._mesaj_yol(oda)
            try:
                with open(yol, encoding="utf-8") as f:
                    satirlar = f.readlines()
            except FileNotFoundError:
                return []
            yeni = []; degisti = False
            for satir in satirlar:
                try: m = json.loads(satir)
                except Exception:
                    yeni.append(satir); continue
                st = m.get("sil_ts")
                if st and not m.get("silindi") and st <= simdi:
                    mezar = {"id": m.get("id"), "oda": oda, "gonderen": m.get("gonderen"),
                             "ts": m.get("ts"), "govde": None, "silindi": True, "kaybolan": True}
                    yeni.append(json.dumps(mezar, ensure_ascii=False) + "\n")
                    suresi_dolan.append(m.get("id")); degisti = True
                else:
                    yeni.append(satir)
            if degisti:
                tmp = yol + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write("".join(yeni))
                os.replace(tmp, yol)
        for mid in suresi_dolan:
            _yayinla(oda, {"tip": "silindi", "oda": oda, "id": mid, "kaybolan": True})
        return suresi_dolan

    def _yaziyor(self, kim, gov):
        # "Yazıyor…" — geçici, DEPOLANMAZ; yalnız oda üyelerine SSE ile relay edilir.
        oda = gov.get("oda")
        if not oda: return self._json(400, {"hata": "oda gerek"})
        if not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        _yayinla(oda, {"tip": "yaziyor", "oda": oda, "kim": kim})
        return self._json(200, {"ok": True})

    @staticmethod
    def _medya_id_gecerli(mid):
        return bool(mid) and 16 <= len(mid) <= 64 and all(c in "0123456789abcdef" for c in mid)

    def _medya_yukle(self):
        # E2E OPAK medya blob'u (ciphertext) saklar. Sunucu İÇİNE BAKMAZ — anahtar mesajda E2E taşınır.
        kim = self._kim()
        if not kim: return self._json(401, {"hata": "oturum yok"})
        if not self._csrf_ok(): return self._json(403, {"hata": "eksik istek başlığı"})   # D1/L2
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n <= 0: return self._json(400, {"hata": "boş gövde"})
        if n > MEDYA_MAX:
            kalan = n                       # gövdeyi boşalt (keep-alive bozulmasın), sonra reddet
            while kalan > 0:
                parca = self.rfile.read(min(kalan, 65536))
                if not parca: break
                kalan -= len(parca)
            return self._json(413, {"hata": "medya çok büyük (max 15MB)"})
        data = self.rfile.read(n)
        mid = secrets.token_hex(16)
        os.makedirs(MEDYADIR, exist_ok=True)
        tmp = os.path.join(MEDYADIR, mid + ".bin.tmp")
        with open(tmp, "wb") as f: f.write(data)
        os.replace(tmp, os.path.join(MEDYADIR, mid + ".bin"))
        self._trafik("mesaj-aktarim", kim, bayt=len(data))   # WP1: medya = asıl büyük aktarım; 🟡-2: beyan değil yazılan-boyut
        return self._json(200, {"medya_id": mid})

    def _medya_indir(self, mid):
        # Auth + geçerli id yeten yetenek-tabanlı erişim (id yalnız E2E mesajla üyelere ulaşır).
        if not self._medya_id_gecerli(mid): return self._json(400, {"hata": "geçersiz id"})
        yol = os.path.normpath(os.path.join(MEDYADIR, mid + ".bin"))
        if not yol.startswith(MEDYADIR + os.sep) or not os.path.isfile(yol):   # D1: prefix-bypass'a karşı os.sep
            return self._json(404, {"hata": "yok"})
        with open(yol, "rb") as f: data = f.read()
        # opak ciphertext; sunucu mime'i bilmez (octet-stream) + cache yok (gizlilik)
        return self._ham(200, data, "application/octet-stream", ekstra=[("Cache-Control", "no-store")])

    def _profil(self, kim, gov):
        # Görünen ad (kullanıcı adı DEĞİŞMEZ) + avatar foto (yarı-genel, ≤256KB). Kendi profili.
        ad = gov.get("ad")
        avatar = gov.get("avatar")            # base64 (prefixsiz) ya da None
        mime = (gov.get("avatar_mime") or "image/png")[:40]
        with KILIT:
            kull = _oku(F_KULL, {})
            if kim not in kull: return self._json(404, {"hata": "yok"})
            if ad is not None:
                ad = ad.strip()[:40]
                if ad: kull[kim]["ad"] = ad
                else: kull[kim].pop("ad", None)
            if avatar:
                try: ham = base64.b64decode(avatar)
                except Exception: return self._json(400, {"hata": "avatar çözülemedi"})
                if len(ham) > AVATAR_MAX: return self._json(413, {"hata": "avatar çok büyük (max 256KB)"})
                # D1/H1 güvenlik yaması: _avatar_indir'deki (indirme) ile AYNI containment koruması
                # yazma yoluna da eklendi — kim artık _kullanici_gecerli ile garantili ama savunma-derinliği.
                os.makedirs(AVATARDIR, exist_ok=True)
                hedef = os.path.normpath(os.path.join(AVATARDIR, kim + ".bin"))
                if not hedef.startswith(AVATARDIR + os.sep):
                    return self._json(400, {"hata": "geçersiz kullanıcı"})
                tmp = hedef + ".tmp"
                with open(tmp, "wb") as f: f.write(ham)
                os.replace(tmp, hedef)
                kull[kim]["avatar"] = True
                kull[kim]["avatar_mime"] = mime
            _atomik_yaz(F_KULL, kull)
        return self._json(200, {"ok": True, "ad": kull[kim].get("ad"), "avatar": bool(kull[kim].get("avatar"))})

    def _avatar_indir(self, u):
        u = (u or "").strip().lower()
        if not u or not all(c.isalnum() or c == "_" for c in u): return self._json(400, {"hata": "geçersiz"})
        kull = _oku(F_KULL, {})
        if u not in kull or not kull[u].get("avatar"): return self._json(404, {"hata": "yok"})
        yol = os.path.normpath(os.path.join(AVATARDIR, u + ".bin"))
        if not yol.startswith(AVATARDIR + os.sep) or not os.path.isfile(yol): return self._json(404, {"hata": "yok"})   # D1: os.sep
        with open(yol, "rb") as f: data = f.read()
        return self._ham(200, data, kull[u].get("avatar_mime", "image/png"),
                         ekstra=[("Cache-Control", "private, max-age=60")])

    def _sse(self, kim, u):
        if not kim:
            return self._json(401, {"hata": "oturum yok"})
        q = parse_qs(u.query); oda = (q.get("oda") or [""])[0]
        kisisel = not oda                      # oda YOK = kişisel çağrı kanalı (oturum boyu açık)
        if not kisisel and not self._uye_mi(kim, oda): return self._json(403, {"hata": "üye değil"})
        if TRAFIK is not None and _sse_oran_asildi(self._istemci_ip()):   # 🟠-1: yalnız kayıt-modunda
            return self._json(429, {"hata": "çok sık bağlantı — biraz sonra tekrar deneyin"},
                              ekstra=[("Retry-After", str(SSE_PENCERE))])
        kuyruk = queue.Queue(maxsize=100)
        with ABONE_KILIT:
            (ABONE_KISI.setdefault(kim, set()) if kisisel else ABONELER.setdefault(oda, set())).add(kuyruk)
        self._trafik("baglanti", kim)   # WP1
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._cors_basliklari_ekle()
            self.end_headers()
            self.wfile.write(b": baglandi\n\n"); self.wfile.flush()
            while True:
                try:
                    olay = kuyruk.get(timeout=25)
                    self.wfile.write(f"data: {json.dumps(olay, ensure_ascii=False)}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # keepalive
                _gorundu(kim)   # açık SSE = kullanıcı çevrimiçi (idle olsa da)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with ABONE_KILIT:
                (ABONE_KISI.get(kim, set()) if kisisel else ABONELER.get(oda, set())).discard(kuyruk)

def init():
    global SIR
    os.makedirs(VERI, exist_ok=True)
    os.makedirs(MSGDIR, exist_ok=True)
    os.makedirs(OKUDIR, exist_ok=True)
    os.makedirs(MEDYADIR, exist_ok=True)
    os.makedirs(AVATARDIR, exist_ok=True)
    SIR = _gizli()

def main():
    init()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"NarChat mesaj_server :{PORT} — ciphertext-relay (sunucu içeriği çözmez)")
    print(f"  statik: {STATIK}  veri: {VERI}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nkapatılıyor…"); srv.shutdown()

if __name__ == "__main__":
    main()
