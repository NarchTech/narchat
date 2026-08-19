# NarChat — patron paneli birim testi (izole; canlı veri/'ye DOKUNMAZ).
# Hata (önce): işletmecinin "kaç üye, kim aktif, sunucu ayakta mı?" sorusuna panel yoktu (Tayfun 24 Tem).
# Bu test: sahte veri/ ile ozet()'in doğru saydığını (üye · aktif-pencereleri · mesaj · davet-bekleyen/
# kullanılmış ayrımı [kodlar listesinde kullanılan da kalır — mesaj_server.py:754 kuralı] · medya) ve
# panelin YALNIZ 127.0.0.1'e bağlandığını (kamu-yüzeyi ilkesi) doğrular.
# Çalıştır: python3 test/patron_panel_test.py
import json, os, sys, tempfile, time

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import patron_panel as pp

def main():
    simdi = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "mesajlar"))
        os.makedirs(os.path.join(tmp, "medya"))
        J = lambda ad, d: open(os.path.join(tmp, ad), "w").write(json.dumps(d))
        J("kullanicilar.json", {
            "ali":  {"pubkey": "PK", "olusturma": simdi - 90*86400, "ad": "Ali"},
            "veli": {"pubkey": "PK", "olusturma": simdi - 5*86400},
            "issiz": {"pubkey": "",  "olusturma": simdi - 5*86400},   # anahtar üretememiş yarım-kayıt
        })
        J("odalar.json", {"oda_x": {"tip": "ikili", "ad": "", "uyeler": ["ali", "veli"], "olusturma": simdi}})
        # kodlar: A kullanılmış ama listede KALIR (sunucu kuralı) → bekleyen=B(+oto C), kullanılan=A
        J("davetler.json", {"kodlar": ["NARC-A", "NARC-B"], "kullanilmis": {"NARC-A": "ali"},
                            "otokodlar": {"NARC-C": simdi}})
        J("push_aboneler.json", {"ali": [{"ep": "x"}]})
        with open(os.path.join(tmp, "mesajlar", "oda_x.jsonl"), "w") as f:
            f.write(json.dumps({"id": "1", "oda": "oda_x", "gonderen": "ali",  "ts": simdi - 3600,     "govde": "…"}) + "\n")
            f.write(json.dumps({"id": "2", "oda": "oda_x", "gonderen": "veli", "ts": simdi - 10*86400, "govde": "…"}) + "\n")
        open(os.path.join(tmp, "medya", "blob1"), "wb").write(b"x" * 2048)

        pp.VERI = tmp
        pp.LOG = os.path.join(tmp, "yok.log")
        o = pp.ozet()

    assert o["kullanici_toplam"] == 3, o["kullanici_toplam"]
    assert o["aktif"] == {"g1": 1, "g7": 1, "g30": 2}, o["aktif"]          # ali bugün; veli 10 gün önce
    assert o["mesaj_toplam"] == 2 and o["oda_toplam"] == 1
    assert o["davet"] == {"uretilen": 3, "bekleyen": 2, "kullanilan": 1}, o["davet"]
    assert o["medya"] == {"adet": 1, "bayt": 2048}
    assert o["push_abone"] == 1
    yarim = [k for k in o["kullanicilar"] if k["kullanici"] == "issiz"][0]
    assert yarim["anahtar"] is False, "yarım-kayıt (pubkey'siz) 'anahtar yok' görünmeli"
    kaynak = open(os.path.join(KOK, "patron_panel.py"), encoding="utf-8").read()
    assert 'HTTPServer(("127.0.0.1"' in kaynak, "panel 127.0.0.1 dışına bağlanmamalı (kamu-yüzeyi ilkesi)"
    print("✅ patron_panel_test: 8/8 doğrulama yeşil (izole veri; canlıya dokunulmadı)")

if __name__ == "__main__":
    main()
