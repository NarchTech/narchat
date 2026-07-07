#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — davet-kodlu kayıt kanıtı (Adım 5) + FAZ N2 NARC- kod self-servis. İzole sunucu.
Doğrulanan (elle-seedlenmiş kodlar):
  1. Kodsuz kayıt → 403
  2. Geçersiz kod → 403
  3. Geçerli kod → 200 (hesap açılır)
  4. AYNI kod tekrar → 403 (tek-kullanımlık)
  5. İkinci geçerli kod → 200
  6. davetler.json YOKKEN kayıt açık (geriye-uyum / izole test) → 200
Doğrulanan (FAZ N2 — /api/narc-kod self-servis, otokodlar):
  7. NARCHAT_KOD_ACIK kapalıyken (varsayılan) → 404
  8. Açıkken: kod üret → 200 + NARC-XXXX-XXXX deseni → o kodla kayıt → 200
  9. AYNI otokod tekrar → 403 (tek-kullanımlık)
  10. Süresi dolmuş (72s+) otokod → 403
  11. Günlük tavan (NARCHAT_KOD_GUNLUK) aşılınca → 429
Çalıştır:  python3 test/davet_test.py   (yalnız stdlib + cryptography — sunucu zaten kullanıyor)
"""
import json, os, sys, time, subprocess, tempfile, urllib.request, urllib.error, http.cookiejar, base64, secrets

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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

def narc_kod(B, ip=None):
    """(status, kod-veya-None) döndürür. ip verilirse X-Forwarded-For ile ayrı bir istemci-IP taklit eder."""
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    hdr = {"Content-Type": "application/json", "X-NarChat": "1"}   # CSRF özel-başlığı (musluk go-public sertleştirme)
    if ip: hdr["X-Forwarded-For"] = ip
    r = urllib.request.Request(B + "/api/narc-kod", data=b"{}", headers=hdr, method="POST")
    try:
        resp = op.open(r); return resp.status, json.loads(resp.read().decode()).get("kod")
    except urllib.error.HTTPError as e:
        return e.code, None

def narc_kod_msg(B, ip=None):
    """(status, hata-mesaji) döndürür — hangi tavan çarptığını (global vs per-IP) ayırt etmek için."""
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    hdr = {"Content-Type": "application/json", "X-NarChat": "1"}   # CSRF özel-başlığı (musluk go-public sertleştirme)
    if ip: hdr["X-Forwarded-For"] = ip
    r = urllib.request.Request(B + "/api/narc-kod", data=b"{}", headers=hdr, method="POST")
    try:
        resp = op.open(r); return resp.status, json.loads(resp.read().decode()).get("hata", "")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode()).get("hata", "")

def narc_kod_csrfsiz(B):
    """X-NarChat başlığı OLMADAN /api/narc-kod POST — CSRF gate'i doğrular (cross-site DoS savunması)."""
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    r = urllib.request.Request(B + "/api/narc-kod", data=b"{}",
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        resp = op.open(r); return resp.status
    except urllib.error.HTTPError as e:
        return e.code

def kayit(B, kullanici, davet=None):
    # N1: kayıt artık v2 (sıfır-bilgi) — sahte bir doğrulayıcı (public anahtar) yeter, bu test parolayı ilgilendirmez.
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    govde = {"kullanici": kullanici, "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()}
    if davet is not None: govde["davet"] = davet
    r = urllib.request.Request(B + "/api/kayit", data=json.dumps(govde).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        op.open(r); return 200
    except urllib.error.HTTPError as e:
        return e.code

def main():
    gecti = []
    # ── silahlı sunucu (davetler.json var) ──
    veri = tempfile.mkdtemp(prefix="narchat-davet-")
    os.makedirs(veri, exist_ok=True)
    with open(os.path.join(veri, "davetler.json"), "w", encoding="utf-8") as f:
        json.dump({"kodlar": ["NARC-AAAA", "NARC-BBBB"], "kullanilmis": {}}, f)
    p, B = sunucu_baslat(8107, veri)
    try:
        assert kayit(B, "u1") == 403, "kodsuz kayıt reddedilmeli"
        gecti.append("kodsuz kayıt → 403")
        assert kayit(B, "u2", davet="YANLIS") == 403, "geçersiz kod reddedilmeli"
        gecti.append("geçersiz kod → 403")
        assert kayit(B, "u3", davet="NARC-AAAA") == 200, "geçerli kod kabul edilmeli"
        gecti.append("geçerli kod (NARC-AAAA) → 200")
        assert kayit(B, "u4", davet="NARC-AAAA") == 403, "kullanılmış kod reddedilmeli"
        gecti.append("aynı kod tekrar → 403 (tek-kullanımlık)")
        assert kayit(B, "u5", davet="NARC-BBBB") == 200, "ikinci geçerli kod kabul"
        gecti.append("ikinci geçerli kod (NARC-BBBB) → 200")

        # FAZ N2: NARCHAT_KOD_ACIK ortam değişkeni verilmedi → varsayılan kapalı, "silahlı" sunucuda bile 404.
        st, _ = narc_kod(B)
        assert st == 404, "NARCHAT_KOD_ACIK kapalıyken /api/narc-kod 404 olmalı, geldi %s" % st
        gecti.append("NARCHAT_KOD_ACIK kapalıyken (varsayılan) → 404")
    finally:
        p.terminate()

    # ── silahsız sunucu (davetler.json YOK) → açık kayıt ──
    veri2 = tempfile.mkdtemp(prefix="narchat-acik-")
    p2, B2 = sunucu_baslat(8108, veri2)
    try:
        assert kayit(B2, "acik1") == 200, "davetler.json yokken kayıt açık olmalı"
        gecti.append("davetler.json YOK → kayıt açık (200)")
    finally:
        p2.terminate()

    # ── FAZ N2: musluk AÇIK (NARCHAT_KOD_ACIK=1) + "silahlı" sunucu — self-servis kod üretimi ──
    veri3 = tempfile.mkdtemp(prefix="narchat-otokod-")
    with open(os.path.join(veri3, "davetler.json"), "w", encoding="utf-8") as f:
        json.dump({"kodlar": [], "kullanilmis": {}, "otokodlar": {}}, f)
    p3, B3 = sunucu_baslat(8140, veri3, {"NARCHAT_KOD_ACIK": "1"})
    try:
        st, kod = narc_kod(B3)
        assert st == 200 and kod and kod.startswith("NARC-") and len(kod) == 14, \
            "açıkken kod üretimi 200 + NARC-XXXX-XXXX olmalı, geldi %s %r" % (st, kod)
        gecti.append("musluk AÇIK: /api/narc-kod → 200 + NARC-XXXX-XXXX deseni (%s)" % kod)

        # CSRF gate (go-public sertleştirme, ikinci-göz 🔴): musluk açık olsa bile X-NarChat başlığı
        # olmayan istek 403 — cross-site sayfanın ziyaretçi tarayıcısından sessizce kod üretip kotayı
        # tüketmesini engeller. (200 dönseydi DoS vektörü açık kalırdı → red-first: yamasız kodda 200'dü.)
        assert narc_kod_csrfsiz(B3) == 403, "X-NarChat'siz narc-kod isteği 403 olmalı (CSRF gate)"
        gecti.append("CSRF gate: X-NarChat'siz /api/narc-kod → 403 (cross-site DoS savunması)")

        assert kayit(B3, "oto1", davet=kod) == 200, "otokodla kayıt kabul edilmeli"
        gecti.append("self-servis kodla kayıt → 200")

        assert kayit(B3, "oto2", davet=kod) == 403, "kullanılmış otokod tekrar reddedilmeli"
        gecti.append("aynı otokod tekrar → 403 (tek-kullanımlık)")

        # süresi dolmuş otokod: dosyaya doğrudan geçmiş zamanlı bir kayıt enjekte et
        dd = json.load(open(os.path.join(veri3, "davetler.json"), encoding="utf-8"))
        eski_kod = "NARC-ESKI-KODD"
        dd["otokodlar"][eski_kod] = {"olusturma": int(time.time()) - 73 * 3600, "kullanildi": None}
        with open(os.path.join(veri3, "davetler.json"), "w", encoding="utf-8") as f:
            json.dump(dd, f)
        assert kayit(B3, "oto3", davet=eski_kod) == 403, "süresi dolmuş (72s+) otokod reddedilmeli"
        gecti.append("süresi dolmuş (72s) otokod → 403")
    finally:
        p3.terminate()

    # ── FAZ N2: günlük tavan (NARCHAT_KOD_GUNLUK) ──
    veri4 = tempfile.mkdtemp(prefix="narchat-otokod-tavan-")
    with open(os.path.join(veri4, "davetler.json"), "w", encoding="utf-8") as f:
        json.dump({"kodlar": [], "kullanilmis": {}, "otokodlar": {}}, f)
    p4, B4 = sunucu_baslat(8141, veri4, {"NARCHAT_KOD_ACIK": "1", "NARCHAT_KOD_GUNLUK": "2"})
    try:
        for i in range(1, 3):
            st, kod = narc_kod(B4)
            assert st == 200, "tavan-altı %d. kod üretimi 200 olmalı, geldi %s" % (i, st)
        st, _ = narc_kod(B4)
        assert st == 429, "günlük tavan aşımı 429 olmalı, geldi %s" % st
        gecti.append("günlük tavan (NARCHAT_KOD_GUNLUK=2) aşılınca → 429")
    finally:
        p4.terminate()

    # ── FAZ N2 / D1: per-IP günlük tavan (NARCHAT_KOD_IP_GUNLUK) ──
    # RED-FIRST TASARIM: global tavan CÖMERT (50), per-IP tavan DÜŞÜK (2). Tek IP'nin 3. isteği 429
    # dönüyorsa bu YALNIZCA per-IP mantığıyla mümkün — per-IP kodu olmasa global 50 dolmadığı için
    # 3. istek 200 dönerdi (yamasız kodda bu blok FAIL eder). Mesaj metni de global'den ("bu ağdan…")
    # ayrılır, böylece doğru tavanın çarptığı kanıtlanır. Ayrı IP (B) hâlâ 200 alır → kova gerçekten per-IP.
    veri5 = tempfile.mkdtemp(prefix="narchat-otokod-ipcap-")
    with open(os.path.join(veri5, "davetler.json"), "w", encoding="utf-8") as f:
        json.dump({"kodlar": [], "kullanilmis": {}, "otokodlar": {}}, f)
    # NARCHAT_TEST_HOOKS=1: _istemci_ip prod'da XFF'e güvenmez (client-spoof), yalnız test-kancasıyla; bu
    # blok ayrı IP'leri XFF ile taklit ettiğinden kancayı açar (prod'da gerçek IP CF-Connecting-IP'den gelir).
    p5, B5 = sunucu_baslat(8142, veri5,
                           {"NARCHAT_KOD_ACIK": "1", "NARCHAT_KOD_IP_GUNLUK": "2", "NARCHAT_KOD_GUNLUK": "50",
                            "NARCHAT_TEST_HOOKS": "1"})
    try:
        for i in range(1, 3):
            st, kod = narc_kod(B5, ip="203.0.113.7")
            assert st == 200, "per-IP tavan-altı %d. kod 200 olmalı, geldi %s" % (i, st)
        st, msg = narc_kod_msg(B5, ip="203.0.113.7")
        assert st == 429, "per-IP tavan (IP başına 2) aşımı 429 olmalı (global 50 dolmadan), geldi %s" % st
        assert "bu ağdan" in msg, "429 per-IP mesajı olmalı (global değil), geldi %r" % msg
        gecti.append("per-IP tavan (NARCHAT_KOD_IP_GUNLUK=2, global 50) IP-A 3. istek → 429 'bu ağdan'")
        # Farklı IP hâlâ üretebiliyor → kova gerçekten per-IP, global-değil.
        st2, kod2 = narc_kod(B5, ip="198.51.100.9")
        assert st2 == 200 and kod2, "ayrı IP hâlâ 200 almalı (per-IP kova), geldi %s" % st2
        gecti.append("ayrı IP (198.51.100.9) hâlâ → 200 (kova per-IP, global-değil)")
    finally:
        p5.terminate()

    print("✅ DAVET-KODLU KAYIT GEÇTİ:")
    for i, g in enumerate(gecti, 1): print("  %d. %s" % (i, g))

if __name__ == "__main__":
    main()
