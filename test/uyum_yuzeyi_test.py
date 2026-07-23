#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat UYUMLU SÜRÜM — F2 kanıtı: WP2 uyum-yüzeyi (statik sayfalar) + WP3 müdahale araçları.
İzole sunucu (davet_test deseni). RED-FIRST: WP3 askı-kilidi, aracı çalıştırmadan ÖNCE aynı
hesabın giriş yapabildiğini gösterir (kilit yokken YEŞİL giriş = kırmızı zemin), sonra askı → 403.

WP2:
  1. /iletisim /aydinlatma /kosullar temiz-URL 200 + text/html
  2. .html uzantılı de erişilir (aynı içerik)
  3. Aydınlatma metni zorunlu beyanları içerir (trafik bilgisi · 5651 · Cloudflare-transit · ham-IP · KVKK m.11)
  4. Bilinmeyen temiz-URL 404 (alias yalnız 3 sabit ada)
WP3:
  5. RED-FIRST: askı öncesi hesap giriş yapabiliyor (200)
  6. operator askiya-al → dayanak ZORUNLU (dayanaksız çağrı hata)
  7. askıdan sonra giriş 403 + operatör-günlüğü satırı yazıldı (0600)
  8. askiya-kaldir → giriş yine 200 (oturum-nesli değişti, taze giriş gerekti)
  9. blob-sil: yüklenen opak medya silinir + günlük; içerik hiç okunmaz
Çalıştır:  python3 test/uyum_yuzeyi_test.py
"""
import base64, json, os, stat, subprocess, sys, tempfile, time, urllib.request, urllib.error, http.cookiejar, secrets

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gecti = []


def dogrula(no, kosul, aciklama):
    if not kosul:
        print(f"❌ [{no}] {aciklama}"); sys.exit(1)
    gecti.append(no); print(f"✓ [{no}] {aciklama}")


def sunucu_baslat(port, veri):
    env = {**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri}
    env.pop("NARCHAT_TRAFIK_KAYIT", None)
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


def get(op, B, yol):
    try:
        r = op.open(B + yol)
        return r.status, r.read().decode("utf-8", "replace"), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, "", ""


def post(op, B, yol, govde, ham=None):
    if ham is not None:
        r = urllib.request.Request(B + yol, data=ham,
                                   headers={"Content-Type": "application/octet-stream", "X-NarChat": "1"}, method="POST")
    else:
        r = urllib.request.Request(B + yol, data=json.dumps(govde).encode(),
                                   headers={"Content-Type": "application/json", "X-NarChat": "1"}, method="POST")
    try:
        resp = op.open(r); return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {}


def operator(veri, *args):
    return subprocess.run([sys.executable, os.path.join(KOK, "narchat_operator.py"), *args],
                          env={**os.environ, "NARCHAT_VERI": veri}, capture_output=True, text=True)


def main():
    port = 8400 + (os.getpid() % 280)
    with tempfile.TemporaryDirectory() as veri:
        p, B = sunucu_baslat(port, veri)
        try:
            op = istemci()
            # [1] temiz-URL uyum sayfaları
            ok = True
            for yol in ("/iletisim", "/aydinlatma", "/kosullar"):
                st, govde, tip = get(op, B, yol)
                ok = ok and st == 200 and "text/html" in tip and len(govde) > 200
            dogrula(1, ok, "/iletisim /aydinlatma /kosullar temiz-URL 200 + text/html")

            # [2] .html uzantı de erişilir
            st2, g2, _ = get(op, B, "/aydinlatma.html")
            dogrula(2, st2 == 200 and "Aydınlatma" in g2, ".html uzantılı erişim de çalışır")

            # [3] zorunlu beyanlar
            _, ay, _ = get(op, B, "/aydinlatma")
            beyanlar = ["Trafik bilgisi", "5651", "Cloudflare", "ham", "m.11"]
            eksik = [b for b in beyanlar if b not in ay]
            dogrula(3, not eksik, "aydınlatma zorunlu beyanları içeriyor (trafik/5651/Cloudflare/ham-IP/KVKK-m.11)")

            # [4] bilinmeyen temiz-URL 404
            st4, _, _ = get(op, B, "/gizli-yonetim")
            dogrula(4, st4 == 404, "bilinmeyen temiz-URL 404 (alias yalnız 3 sabit ad)")

            # hesap aç (gerçek v2)
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from cryptography.hazmat.primitives import serialization
            sk = Ed25519PrivateKey.generate()
            pub = base64.b64encode(sk.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
            st, _ = post(op, B, "/api/kayit", {"kullanici": "ali", "dogrulayici": pub})
            assert st == 200

            def giris():
                o2 = istemci()
                r = o2.open(B + "/api/giris-meydan?kullanici=ali")
                m = json.loads(r.read().decode())["meydan"]
                imza = base64.b64encode(sk.sign(m.encode())).decode()
                st, gv = post(o2, B, "/api/giris", {"kullanici": "ali", "meydan": m, "imza": imza})
                return st, o2   # oturumlu opener döndür (medya yükleme için)

            # [5] RED-FIRST: askı YOKKEN giriş 200
            st5, _ = giris()
            dogrula(5, st5 == 200, "RED-FIRST: askı öncesi giriş 200 (kilit gerçekten askıdan geliyor)")
            _ = st5

            # [6] dayanak zorunlu
            r6 = operator(veri, "askiya-al", "--kullanici", "ali", "--dayanak", "")
            dogrula(6, r6.returncode != 0 and "dayanak" in (r6.stderr + r6.stdout).lower(),
                    "askiya-al dayanaksız reddedilir (--dayanak zorunlu)")

            # [7] askı → giriş 403 + günlük 0600
            r7 = operator(veri, "askiya-al", "--kullanici", "ali", "--dayanak", "TEST 2026/1 D.İş")
            assert r7.returncode == 0, r7.stderr
            st7, _ = giris()
            gyol = os.path.join(veri, "operator-gunlugu.jsonl")
            gmode = stat.S_IMODE(os.stat(gyol).st_mode) if os.path.exists(gyol) else -1
            gsatir = [json.loads(s) for s in open(gyol, encoding="utf-8") if s.strip()] if os.path.exists(gyol) else []
            dogrula(7, st7 == 403 and gmode == 0o600
                    and any(x["eylem"] == "askiya-al" and x["hedef"] == "ali" and x["dayanak"] == "TEST 2026/1 D.İş" for x in gsatir),
                    "askı sonrası giriş 403 + operatör-günlüğü (0600) dayanaklı kayıt")

            # [8] askı kaldır → giriş yine 200
            r8 = operator(veri, "askiya-kaldir", "--kullanici", "ali", "--dayanak", "TEST kaldırma")
            assert r8.returncode == 0
            st8, oturumlu = giris()
            dogrula(8, st8 == 200, "askiya-kaldir sonrası giriş yine 200")

            # [9] blob-sil: opak medya yükle → sil (taze oturumlu opener'la)
            st9u, mv = post(oturumlu, B, "/api/medya", None, ham=b"\x00OPAK-BLOB" + secrets.token_bytes(64))
            assert st9u == 200, "medya yükleme 200 bekleniyordu: %s" % st9u
            mid = mv["medya_id"]
            blobyol = os.path.join(veri, "medya", mid + ".bin")
            r9 = operator(veri, "blob-sil", "--id", mid, "--dayanak", "TEST blob 2026/2")
            gsatir2 = [json.loads(s) for s in open(gyol, encoding="utf-8") if s.strip()]
            dogrula(9, r9.returncode == 0 and not os.path.exists(blobyol)
                    and any(x["eylem"] == "blob-sil" and x["hedef"] == mid for x in gsatir2),
                    "blob-sil: opak medya silindi + dayanaklı günlük (içerik hiç okunmadı)")
        finally:
            p.terminate(); p.wait()

    print(f"\n🟢 UYUM-YÜZEYİ (F2/WP2+WP3): {len(gecti)}/9 doğrulama GEÇTİ")


if __name__ == "__main__":
    main()
