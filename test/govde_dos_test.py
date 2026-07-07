#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — D1 (gövde-okuma DoS sertleştirme) kanıtı. İzole sunucu, ham soket.
_govde() Content-Length'i OKUMADAN doğrular:
  - negatif CL (read(-1) → EOF'a dek engelleyici askı) → gövde boş sayılır, uç HIZLI 400 döner
  - aşırı-büyük CL (bellek-şişme; gönderilmeyen N baytı beklemek) → HIZLI 400 döner (askı YOK)
Sertleştirme ÖNCESİ bu iki istek sunucu iş-parçacığını gelmeyen/EOF-bekleyen okumada ASARDI.
Çalıştır:  python3 test/govde_dos_test.py
"""
import os, sys, socket, subprocess, tempfile, time
import urllib.request, urllib.error

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


def ham_istek(port, content_length, govde=b"{}", timeout=6):
    """Ham HTTP POST gönderir; sunucu YANIT satırını timeout içinde döndürürse (kod, sure) verir,
    aksi halde ('HANG', sure). Gövde CL'den KISA gönderilir (aşırı-CL'de sunucu gelmeyen baytı beklerse asar)."""
    s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    s.settimeout(timeout)
    istek = ("POST /api/kayit HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
             "Content-Length: %s\r\nConnection: close\r\n\r\n" % content_length).encode() + govde
    t0 = time.time()
    try:
        s.sendall(istek)
        veri = s.recv(64)
        sure = time.time() - t0
        if veri.startswith(b"HTTP/"):
            return int(veri.split()[1]), sure
        return "BOZUK", sure
    except socket.timeout:
        return "HANG", time.time() - t0
    finally:
        s.close()


def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-govdedos-")
    p, B = sunucu_baslat(8157, veri)
    port = 8157
    try:
        # negatif CL → sertleştirme öncesi read(-1) EOF'a dek asardı; artık hızlı 400
        kod, sure = ham_istek(port, "-1")
        assert kod != "HANG", "negatif Content-Length sunucuyu ASTI (%.1fs) — DoS!" % sure
        assert kod == 400, "negatif CL hızlı 400 vermeli (gövde boş → 'kullanıcı gerek'), geldi %r (%.2fs)" % (kod, sure)
        gecti.append("negatif Content-Length (-1) → askı YOK, hızlı 400 (%.2fs)" % sure)

        # aşırı-büyük CL, kısa gövde → sertleştirme öncesi gelmeyen ~5MB'ı beklerdi; artık hızlı 400
        kod, sure = ham_istek(port, str(5_000_000))
        assert kod != "HANG", "aşırı Content-Length sunucuyu ASTI (%.1fs) — DoS!" % sure
        assert kod == 400, "aşırı CL hızlı 400 vermeli (sınır üstü → gövde boş sayılır), geldi %r (%.2fs)" % (kod, sure)
        gecti.append("aşırı Content-Length (5MB), kısa gövde → askı YOK, hızlı 400 (%.2fs)" % sure)

        # regresyon: normal geçerli gövde hâlâ çalışır (bu yol bozulmadı)
        kod, sure = ham_istek(port, "2", govde=b"{}")
        assert kod == 400, "boş {} gövde 'kullanıcı gerek' 400 vermeli, geldi %r" % kod
        gecti.append("normal (sınır-içi) gövde okuması bozulmadı → 400 (kullanıcı gerek)")
    finally:
        p.terminate()

    print("✅ D1 (gövde-okuma DoS sertleştirme) GEÇTİ:")
    for i, g in enumerate(gecti, 1):
        print("  %d. %s" % (i, g))


if __name__ == "__main__":
    main()
