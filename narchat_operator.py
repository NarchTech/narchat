#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat UYUMLU SÜRÜM — narchat_operator.py (WP3: operatör müdahale araçları).
Spesifikasyon: MASTER-YAYIN-2026-07-22/01-EGEMEN-MIMARI §4 WP3 + RUNBOOK-YASAL-TALEP.md.

NEDEN AĞ-UCU DEĞİL, CLI: müdahale yetkisi (askıya alma, blob silme) kamu yüzeyine yeni bir
authlu-mutasyon ucu AÇMAZ — yalnızca sunucuya SHELL erişimi olan operatör, veri dizini üstünde
doğrudan çalıştırır. Böylece D1-güvenlik yüzeyi büyümez; müdahale yetkisi işletim-sistemi
erişimiyle sınırlıdır. İÇERİĞE DOKUNMAZ: blob'lar zaten şifreli (sunucu okuyamaz); bu araç yalnız
hesap-bayrağı koyar ya da bir opak nesneyi SİLER — hiçbir mesajı çözmez/okumaz.

HER EYLEM KAYITLIDIR: append-only operatör-günlüğü (veri/operator-gunlugu.jsonl, 0600) —
zaman · eylem · hedef · dayanak (yasal talep referansı) · operatör-notu. Dayanak ZORUNLUDUR
(--dayanak boş geçilemez): "hangi yargı kararı / bildirim" yazılmadan tedbir uygulanmaz.

Komutlar:
  askiya-al   --kullanici AD --dayanak "..."      hesabı askıya alır (giriş 403 + tüm oturumlar iptal)
  askiya-kaldir --kullanici AD --dayanak "..."    askıyı kaldırır
  blob-sil    --id MEDYA_ID --dayanak "..."       tek bir opak medya blob'unu siler (geçerli yargı kararı)
  mesaj-sil   --oda ODA --mid MID --dayanak "..." tek bir mesajın ciphertext'ini siler (tombstone bırakır)
  durum       --kullanici AD                       hesabın askı durumunu gösterir (salt-okur)
  gunluk                                           operatör-günlüğünü yazdırır (salt-okur)

Örnek:  NARCHAT_VERI=/path/veri python3 narchat_operator.py askiya-al --kullanici ali \
          --dayanak "İst. 5. Sulh Ceza, 2026/1234 D.İş" --not "temsilci bildirimi"
"""
import argparse, json, os, sys, tempfile, time

VERI = os.environ.get("NARCHAT_VERI") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "veri")
F_KULL = os.path.join(VERI, "kullanicilar.json")
F_ODA = os.path.join(VERI, "odalar.json")
MSGDIR = os.path.join(VERI, "mesajlar")
MEDYADIR = os.path.join(VERI, "medya")
F_GUNLUK = os.path.join(VERI, "operator-gunlugu.jsonl")


def _oku(yol, varsayilan):
    try:
        with open(yol, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return varsayilan


def _atomik_yaz(yol, veri):
    tmp = yol + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(veri, f, ensure_ascii=False, indent=2)
    os.replace(tmp, yol)


def _gunluge_yaz(eylem, hedef, dayanak, notu):
    # Append-only denetim izi. İçerik-sınıfı hiçbir alan yoktur (yalnız idari-tedbir üstverisi).
    kayit = {"ts": int(time.time()), "eylem": eylem, "hedef": hedef,
             "dayanak": dayanak, "not": notu or ""}
    os.makedirs(VERI, exist_ok=True)
    fd = os.open(F_GUNLUK, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(kayit, ensure_ascii=False) + "\n").encode("utf-8"))
    finally:
        os.close(fd)
    return kayit


def _dayanak_gerek(a):
    if not (a.dayanak or "").strip():
        sys.exit("HATA: --dayanak zorunludur (hangi yargı kararı / bildirim). Tedbir dayanaksız uygulanmaz.")


def askiya(a, deger):
    _dayanak_gerek(a)
    kull = _oku(F_KULL, {})
    k = kull.get(a.kullanici)
    if not k:
        sys.exit("HATA: kullanıcı yok: %s" % a.kullanici)
    if deger:
        k["askiya"] = {"ts": int(time.time()), "dayanak": a.dayanak}
    else:
        k.pop("askiya", None)
    k["oturum_nesli"] = k.get("oturum_nesli", 0) + 1   # mevcut TÜM oturumları anında iptal eder
    _atomik_yaz(F_KULL, kull)
    kayit = _gunluge_yaz("askiya-al" if deger else "askiya-kaldir", a.kullanici, a.dayanak, a.notu)
    print(("✓ askıya alındı" if deger else "✓ askı kaldırıldı") + ": %s (oturumlar iptal)" % a.kullanici)
    print("  günlük:", json.dumps(kayit, ensure_ascii=False))


def blob_sil(a):
    _dayanak_gerek(a)
    if not a.id or "/" in a.id or "\\" in a.id or ".." in a.id:
        sys.exit("HATA: geçersiz medya id")
    yol = os.path.join(MEDYADIR, a.id + ".bin")
    if not os.path.isfile(yol):
        sys.exit("HATA: blob yok: %s" % a.id)
    os.remove(yol)
    kayit = _gunluge_yaz("blob-sil", a.id, a.dayanak, a.notu)
    print("✓ opak blob silindi: %s" % a.id)
    print("  günlük:", json.dumps(kayit, ensure_ascii=False))


def mesaj_sil(a):
    _dayanak_gerek(a)
    if not a.oda or "/" in a.oda or ".." in a.oda:
        sys.exit("HATA: geçersiz oda")
    yol = os.path.join(MSGDIR, a.oda + ".jsonl")
    if not os.path.isfile(yol):
        sys.exit("HATA: oda dosyası yok: %s" % a.oda)
    satirlar, bulundu = [], False
    for s in open(yol, encoding="utf-8"):
        s = s.rstrip("\n")
        if not s:
            continue
        try:
            kayit = json.loads(s)
        except ValueError:
            satirlar.append(s); continue
        if kayit.get("id") == a.mid:
            # ciphertext kaldırılır, tombstone bırakılır (referans _mesaj_sil davranışıyla tutarlı)
            bulundu = True
            satirlar.append(json.dumps({"id": kayit["id"], "oda": kayit.get("oda"),
                                        "gonderen": kayit.get("gonderen"), "ts": kayit.get("ts"),
                                        "silindi": True}, ensure_ascii=False))
        else:
            satirlar.append(json.dumps(kayit, ensure_ascii=False))
    if not bulundu:
        sys.exit("HATA: mesaj bulunamadı: %s (oda %s)" % (a.mid, a.oda))
    tmp = yol + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(satirlar) + "\n")
    os.replace(tmp, yol)
    kayit = _gunluge_yaz("mesaj-sil", "%s/%s" % (a.oda, a.mid), a.dayanak, a.notu)
    print("✓ mesaj ciphertext'i silindi (tombstone kaldı): %s" % a.mid)
    print("  günlük:", json.dumps(kayit, ensure_ascii=False))


def durum(a):
    k = _oku(F_KULL, {}).get(a.kullanici)
    if not k:
        sys.exit("HATA: kullanıcı yok: %s" % a.kullanici)
    ask = k.get("askiya")
    print("%s: %s" % (a.kullanici, ("ASKIDA — " + json.dumps(ask, ensure_ascii=False)) if ask else "aktif"))


def gunluk(a):
    if not os.path.isfile(F_GUNLUK):
        print("(operatör günlüğü boş)"); return
    for s in open(F_GUNLUK, encoding="utf-8"):
        s = s.strip()
        if s:
            print(s)


def main():
    p = argparse.ArgumentParser(description="NarChat operatör müdahale aracı (WP3)")
    alt = p.add_subparsers(dest="komut", required=True)
    for ad in ("askiya-al", "askiya-kaldir"):
        s = alt.add_parser(ad); s.add_argument("--kullanici", required=True)
        s.add_argument("--dayanak", required=True); s.add_argument("--not", dest="notu", default="")
    s = alt.add_parser("blob-sil"); s.add_argument("--id", required=True)
    s.add_argument("--dayanak", required=True); s.add_argument("--not", dest="notu", default="")
    s = alt.add_parser("mesaj-sil"); s.add_argument("--oda", required=True); s.add_argument("--mid", required=True)
    s.add_argument("--dayanak", required=True); s.add_argument("--not", dest="notu", default="")
    s = alt.add_parser("durum"); s.add_argument("--kullanici", required=True)
    alt.add_parser("gunluk")
    a = p.parse_args()
    if a.komut == "askiya-al": askiya(a, True)
    elif a.komut == "askiya-kaldir": askiya(a, False)
    elif a.komut == "blob-sil": blob_sil(a)
    elif a.komut == "mesaj-sil": mesaj_sil(a)
    elif a.komut == "durum": durum(a)
    elif a.komut == "gunluk": gunluk(a)


if __name__ == "__main__":
    main()
