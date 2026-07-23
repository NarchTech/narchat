#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat UYUMLU SÜRÜM — WP1 trafik-bilgisi kayıt modülü kanıtı (F1).
Spesifikasyon: MERKUR/CIKTILAR/MASTER-YAYIN-2026-07-22/01-EGEMEN-MIMARI §4 WP1
(5651 m.2/1-j alan haritası: ts · olay · kimlik · ip[HAM, uyumlu sürümde] · bayt · port).

RED-FIRST KANITI: Bu takım 23 Tem 2026'da modül (trafik_kayit.py) HENÜZ YOKKEN koşuldu ve
ImportError ile KIRMIZI yandı; modül + sunucu kancaları yazıldıktan sonra yeşerdi. Ayrıca
[2] imza-kilidi ve [7]/[E3] şema-kilidi, ileride birinin modüle içerik-alanı eklemesi
durumunda KALICI kırmızı-bekçidir ("içerik asla loglanmaz" negatif kanıtı).

BİRİM (modül doğrudan):
  1. Bilinmeyen olay türü -> ValueError (olay listesi KAPALIDIR — m.2/1-j haritası dışına sessiz genişleme yok)
  2. olay() 'icerik'/'govde'/'msg' parametresi KABUL ETMEZ -> TypeError (imza-kilidi)
  3. Kayıt üretimi: 1 olay -> bugünün dosyasında 1 JSONL satır; anahtar kümesi TAM OLARAK
     {ts,olay,kimlik,ip,bayt,port} (fazla anahtar = kırmızı); değerler birebir
  4. Disk izolasyonu: dizin 0700, dosya 0600 (yalnız servis kullanıcısı okur)
  5. Gün rotasyonu: gün değişince yeni dosya (bugun_fn enjeksiyonuyla deterministik)
  6. Otomatik imha: yaş > saklama_gun dosya SİLİNİR, yaş == saklama_gun DURUR
     ("kanunun istediğinden bir gün fazla tutulmaz" — KVKK minimizasyonu); imha olay()
     üzerinden gün-değişiminde OTOMATİK tetiklenir (dış cron'suz)
  7. Sentinel taraması: yazılan hiçbir satırda mesaj-içeriği sınıfından veri yok
  8. Yasal saklama sınırı (ikinci-göz 🟠-3): [365,730] dışı -> ValueError (fail-fast);
     test/simülasyon yolu yalnız açık yasal_sinir=False ile
  9. İmha koşu-tavanı (ikinci-göz 🟠-5): saat-sıçraması tek koşuda en çok IMHA_TAVANI dosya
     silebilir (en eskiler önce); kalan sonraki koşuda gider
ENTEGRASYON (izole sunucu, davet_test deseni; portlar pid-türevi — paralel koşu çakışmaz):
  E1. Varsayılan (NARCHAT_TRAFIK_KAYIT yok) -> trafik dizini HİÇ OLUŞMAZ (referans davranış birebir;
      asıl korunum kanıtı davet_test regresyonudur)
  E2. Açıkken UÇTAN, KESİN-SAYIM: kayıt(ali) · oturum(gerçek Ed25519 girişi) · kayıt(veli) ·
      baglanti(SSE) · mesaj(port>0) · medya(bayt==blob-boyu) · CF-başlıklı mesaj(ip==CF, port==0
      — ikinci-göz 🔴-1: tünel arkasında istemci portu yapısal ölçülemez, 0="ölçülemedi") ->
      TAM 7 kayıt (çifte-log regresyon bekçisi), 5/5 kanca noktası, şema-kilidi hepsinde
  E3. SENTINEL-govde'li mesaj sonrası TÜM log satırları taranır: sentinel YOK, govde/oda
      anahtarı YOK, şema-dışı anahtar YOK ("içerik asla loglanmaz" uçtan negatif kanıtı)
Çalıştır:  python3 test/trafik_kayit_test.py   (stdlib + cryptography — sunucu zaten kullanıyor)
"""
import base64, datetime, json, os, stat, sys, tempfile, time, subprocess, urllib.request, urllib.error, http.cookiejar, secrets

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)

gecti = []


def dogrula(no, kosul, aciklama):
    if not kosul:
        print(f"❌ [{no}] {aciklama}")
        sys.exit(1)
    gecti.append(no)
    print(f"✓ [{no}] {aciklama}")


# ─────────────────────────── BİRİM ───────────────────────────
from trafik_kayit import TrafikKayit, OLAYLAR, ALANLAR, IMHA_TAVANI   # RED-FIRST: modül yokken burada ImportError

SENTINEL = "BULUSMA_SAAT_3_TRAFIK_GIZLI"
PORT_E1 = 8300 + (os.getpid() % 380)   # 🟡-3: pid-türevi port — paralel koşular çakışmaz
PORT_E2 = PORT_E1 + 1


def gun(offset):
    return datetime.date(2026, 7, 1) + datetime.timedelta(days=offset)


def birim():
    with tempfile.TemporaryDirectory() as tmp:
        dizin = os.path.join(tmp, "trafik")
        simdi = {"g": 0}
        tk = TrafikKayit(dizin, saklama_gun=2, bugun_fn=lambda: gun(simdi["g"]), yasal_sinir=False)

        # [1] kapalı olay listesi
        try:
            tk.olay("dns-sorgusu", kimlik="ali", ip="1.2.3.4", bayt=0, port=1)
            dogrula(1, False, "bilinmeyen olay türü ValueError vermeliydi")
        except ValueError:
            dogrula(1, True, "bilinmeyen olay türü -> ValueError (kapalı liste)")

        # [2] imza-kilidi: içerik-sınıfı parametre kabul edilmez
        kilit_ok = True
        for p in ("icerik", "govde", "msg"):
            try:
                tk.olay("kayit", kimlik="ali", ip="1.2.3.4", bayt=0, port=1, **{p: SENTINEL})
                kilit_ok = False
            except TypeError:
                pass
        dogrula(2, kilit_ok, "olay() içerik-sınıfı parametre kabul etmiyor (TypeError imza-kilidi)")

        # [3] kayıt üretimi + şema-kilidi
        tk.olay("kayit", kimlik="ali", ip="203.0.113.7", bayt=0, port=51234)
        yol = os.path.join(dizin, "trafik-%s.jsonl" % gun(0).isoformat())
        dogrula("3a", os.path.exists(yol), "bugünün günlük dosyası oluştu")
        satirlar = open(yol, encoding="utf-8").read().strip().splitlines()
        k = json.loads(satirlar[0])
        dogrula("3b", len(satirlar) == 1 and set(k) == set(ALANLAR),
                "1 satır + anahtar kümesi TAM {ts,olay,kimlik,ip,bayt,port} (şema-kilidi)")
        dogrula("3c", k["olay"] == "kayit" and k["kimlik"] == "ali" and k["ip"] == "203.0.113.7"
                and k["bayt"] == 0 and k["port"] == 51234 and isinstance(k["ts"], int),
                "alan değerleri birebir")

        # [4] disk izolasyonu
        dmode = stat.S_IMODE(os.stat(dizin).st_mode)
        fmode = stat.S_IMODE(os.stat(yol).st_mode)
        dogrula(4, dmode == 0o700 and fmode == 0o600, f"izinler dizin=0{dmode:o} dosya=0{fmode:o} (0700/0600)")

        # [5] gün rotasyonu
        simdi["g"] = 1
        tk.olay("baglanti", kimlik="veli", ip="203.0.113.8", bayt=0, port=40000)
        yol1 = os.path.join(dizin, "trafik-%s.jsonl" % gun(1).isoformat())
        dogrula(5, os.path.exists(yol1) and len(open(yol, encoding="utf-8").read().strip().splitlines()) == 1,
                "gün değişti -> yeni dosya; eski dosya büyümedi (rotasyon)")

        # [6] otomatik imha (saklama_gun=2): gün-3'te gün-0 (yaş 3 > 2) silinir, gün-1 (yaş 2) durur
        simdi["g"] = 3
        tk.olay("oturum", kimlik="ali", ip="203.0.113.7", bayt=0, port=51235)   # gün-değişimi imhayı tetikler
        dogrula(6, (not os.path.exists(yol)) and os.path.exists(yol1),
                "yaş>saklama silindi, yaş==saklama duruyor (otomatik imha, olay-tetiklemeli)")

        # [7] sentinel taraması (birim düzeyi)
        tk.olay("mesaj-aktarim", kimlik="ali", ip="203.0.113.7", bayt=4242, port=51236)
        hepsi = ""
        for ad in os.listdir(dizin):
            hepsi += open(os.path.join(dizin, ad), encoding="utf-8").read()
        dogrula(7, SENTINEL not in hepsi and '"govde"' not in hepsi and '"msg"' not in hepsi,
                "log havuzunda içerik-sınıfı veri yok (sentinel + alan taraması)")

    # [8] yasal saklama sınırı (🟠-3)
    with tempfile.TemporaryDirectory() as tmp:
        d8 = os.path.join(tmp, "t8")
        sinir_ok = True
        for kotu in (30, 364, 731):
            try:
                TrafikKayit(d8, saklama_gun=kotu)
                sinir_ok = False
            except ValueError:
                pass
        try:
            TrafikKayit(d8, saklama_gun=365) and TrafikKayit(d8, saklama_gun=730)
        except ValueError:
            sinir_ok = False
        dogrula(8, sinir_ok, "saklama_gun [365,730] dışı ValueError (fail-fast); aralık-içi kabul")

    # [9] imha koşu-tavanı (🟠-5): 6 imha-yaşında dosya (elle üretilir — olay-tetiklemeli imha
    # araya girmesin; ilk kurgu olay()'la üretmişti ve ara-gün imhaları birikimi sildiğinden test
    # kırmızı yandı: tavanın gerçek hedefi tam da böyle "aniden hepsi yaşlı" saat-sıçramasıdır)
    with tempfile.TemporaryDirectory() as tmp:
        d9 = os.path.join(tmp, "t9")
        os.makedirs(d9, mode=0o700)
        for g in range(6):
            with open(os.path.join(d9, "trafik-%s.jsonl" % gun(g).isoformat()), "w") as f:
                f.write("{}\n")
        tk9 = TrafikKayit(d9, saklama_gun=2, bugun_fn=lambda: gun(60), yasal_sinir=False)
        sil1 = tk9.imha()
        kalan1 = sorted(a for a in os.listdir(d9) if a.startswith("trafik-"))
        sil2 = tk9.imha()
        dogrula(9, len(sil1) == IMHA_TAVANI and len(kalan1) == 3
                and sil1 == sorted(sil1) and gun(0).isoformat() in sil1[0]
                and len(sil2) == 3 and not [a for a in os.listdir(d9) if a.startswith("trafik-")],
                f"imha koşu başına ≤{IMHA_TAVANI} dosya (en eskiler önce); kalan sonraki koşuda")


# ─────────────────────── ENTEGRASYON ───────────────────────
def sunucu_baslat(port, veri, extra_env=None):
    env = {**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri}
    env.pop("NARCHAT_TRAFIK_KAYIT", None)   # test ortam-sızıntısına kapalı; extra_env açıkça verir
    if extra_env:
        env.update(extra_env)
    p = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
                         env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    B = "http://127.0.0.1:%d" % port
    hazir = False
    for _ in range(50):
        try:
            urllib.request.urlopen(B + "/api/ben"); hazir = True; break
        except urllib.error.HTTPError:
            hazir = True; break
        except Exception:
            time.sleep(0.1)
    if not hazir:   # 🟡-3: sessiz-devam yerine net teşhis
        p.terminate()
        print(f"❌ sunucu {B} 5 sn'de ayağa kalkmadı (port çakışması?)", file=sys.stderr)
        sys.exit(1)
    return p, B


def istemci():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def post(op, B, yol, govde, csrf=True):
    hdr = {"Content-Type": "application/json"}
    if csrf:
        hdr["X-NarChat"] = "1"
    r = urllib.request.Request(B + yol, data=json.dumps(govde).encode(), headers=hdr, method="POST")
    try:
        resp = op.open(r)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def entegrasyon():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization

    # E1 — varsayılan: modül tamamen devre dışı, referans davranış birebir
    with tempfile.TemporaryDirectory() as veri:
        p, B = sunucu_baslat(PORT_E1, veri)
        try:
            op = istemci()
            st, _ = post(op, B, "/api/kayit",
                         {"kullanici": "refkul", "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()},
                         csrf=False)
            dogrula("E1", st == 200 and not os.path.exists(os.path.join(veri, "trafik")),
                    "varsayılanda (env yok) trafik dizini HİÇ oluşmadı — referans davranış birebir")
        finally:
            p.terminate(); p.wait()

    # E2+E3 — açıkken 5/5 kanca + kesin-sayım + CF-port-0 + uçtan sentinel-negatifi
    with tempfile.TemporaryDirectory() as veri:
        trafik_dizin = os.path.join(veri, "trafik")
        p, B = sunucu_baslat(PORT_E2, veri, {"NARCHAT_TRAFIK_KAYIT": "1", "NARCHAT_TEST_HOOKS": "1"})
        try:
            sk = Ed25519PrivateKey.generate()
            pub_b64 = base64.b64encode(sk.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()

            ali = istemci()
            st, _ = post(ali, B, "/api/kayit", {"kullanici": "ali", "dogrulayici": pub_b64}, csrf=False)
            assert st == 200, "kayıt 200 bekleniyordu: %s" % st

            # gerçek v2 giriş: meydan al -> Ed25519 ile imzala
            r = ali.open(B + "/api/giris-meydan?kullanici=ali")
            meydan = json.loads(r.read().decode())["meydan"]
            imza = base64.b64encode(sk.sign(meydan.encode())).decode()
            st, _ = post(ali, B, "/api/giris", {"kullanici": "ali", "meydan": meydan, "imza": imza}, csrf=False)
            assert st == 200, "giriş 200 bekleniyordu: %s" % st

            veli = istemci()
            post(veli, B, "/api/kayit",
                 {"kullanici": "veli", "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()},
                 csrf=False)

            # SSE (kişisel kanal) -> "baglanti"
            akis = ali.open(B + "/api/akis", timeout=5); akis.close()

            st, oda = post(ali, B, "/api/oda", {"tip": "ikili", "uyeler": ["ali", "veli"]})
            assert st == 200, "oda 200 bekleniyordu: %s" % st
            st, _ = post(ali, B, "/api/mesaj", {"oda": oda["oda"], "govde": {"msg": SENTINEL, "n": "AAAA"}})
            assert st == 200, "mesaj 200 bekleniyordu: %s" % st

            # medya kancası (5. çağrı noktası): ham ikili gövde
            MEDYA = b"\x89MEDYA-BLOB-" + SENTINEL.encode() + b"-" * 100
            rq = urllib.request.Request(B + "/api/medya", data=MEDYA,
                                        headers={"Content-Type": "application/octet-stream", "X-NarChat": "1"},
                                        method="POST")
            assert ali.open(rq).status == 200, "medya 200 bekleniyordu"

            # CF-arkası mesaj (🔴-1): ip=CF-başlığı, port=0 ("yapısal olarak ölçülemedi")
            rq = urllib.request.Request(B + "/api/mesaj",
                                        data=json.dumps({"oda": oda["oda"], "govde": {"msg": "x", "n": "B"}}).encode(),
                                        headers={"Content-Type": "application/json", "X-NarChat": "1",
                                                 "CF-Connecting-IP": "198.51.100.77"}, method="POST")
            assert ali.open(rq).status == 200, "CF-mesaj 200 bekleniyordu"
            time.sleep(0.3)

            dosyalar = os.listdir(trafik_dizin) if os.path.isdir(trafik_dizin) else []
            hepsi = ""
            for ad in dosyalar:
                hepsi += open(os.path.join(trafik_dizin, ad), encoding="utf-8").read()
            olaylar = [json.loads(s) for s in hepsi.strip().splitlines() if s.strip()]
            turler = [o["olay"] for o in olaylar]
            mesaj_o = [o for o in olaylar if o["olay"] == "mesaj-aktarim"]
            dogrula("E2", len(olaylar) == 7                                # kesin sayım = çifte-log bekçisi
                    and {"kayit", "oturum", "baglanti", "mesaj-aktarim"} <= set(turler)
                    and turler.count("kayit") == 2 and len(mesaj_o) == 3
                    and any(o["bayt"] > 0 and o["port"] > 0 and o["ip"] != "198.51.100.77" for o in mesaj_o)
                    and any(o["bayt"] == len(MEDYA) for o in mesaj_o)      # medya: yazılan-boyut, beyan değil
                    and any(o["ip"] == "198.51.100.77" and o["port"] == 0 for o in mesaj_o)   # CF: port=0
                    and all(set(o) == set(ALANLAR) for o in olaylar),
                    f"TAM 7 kayıt · 5/5 kanca (medya bayt==blob, CF ip+port=0, doğrudan port>0) · şema-kilidi")
            dogrula("E3", SENTINEL not in hepsi and '"govde"' not in hepsi and "oda_" not in hepsi,
                    "SENTINEL (mesaj + medya-blob içinde) logda YOK; govde/oda izi YOK (uçtan negatif kanıt)")
        finally:
            p.terminate(); p.wait()


if __name__ == "__main__":
    birim()
    entegrasyon()
    print(f"\n🟢 TRAFİK-KAYIT (WP1/F1): {len(gecti)}/14 doğrulama GEÇTİ")
