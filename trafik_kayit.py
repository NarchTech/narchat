#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat UYUMLU SÜRÜM — trafik_kayit.py (WP1: 5651 m.2/1-j trafik-bilgisi kaydı).
Referans sürümde BU MODÜL YOKTUR; uyumlu sürümün tek gerçek mimari eklemesidir
(spes: MERKUR/CIKTILAR/MASTER-YAYIN-2026-07-22/01-EGEMEN-MIMARI §4 WP1; fark listesi = F3 diff raporu).

TASARIM İLKESİ — İÇERİK BU MODÜLDEN GEÇEMEZ:
  olay() imzasında içerik-sınıfı parametre yoktur ve kayıt şeması ALANLAR ile KAPALIDIR
  (test/trafik_kayit_test.py [2],[3b],[7],[E3] bunu kalıcı kırmızı-bekçi yapar).
  Kaydedilen, kanunun trafik-bilgisi tanımının birebir haritasıdır:
    ts (epoch sn) · olay (kapalı liste) · kimlik (sistem takma-adı) · ip (HAM — uyumlu
    sürümde kanun gereği; referans sürümün HMAC-anonimleştirmesinden BİLİNÇLİ sapma,
    aydınlatma metninde beyan edilir [WP2]) · bayt (aktarılan miktar; içerik DEĞİL) · port.

SAKLAMA/İMHA: append-only günlük dosya (trafik-YYYY-MM-DD.jsonl, dizin 0700 / dosya 0600,
  yalnız servis kullanıcısı okur) · gün değişince otomatik rotasyon · yaşı saklama_gun'u
  AŞAN dosyalar otomatik imha edilir (KVKK veri-minimizasyonu: kanunun istediğinden bir gün
  fazla tutulmaz; m.5/3 aralığı 1-2 yıl — kesin süre avukat teyidi [WP4], varsayılan alt-uç 365,
  NARCHAT_TRAFIK_SAKLAMA_GUN ile ayarlanır). İmha gün-değişimindeki ilk olay() ile VE
  sunucunun günlük imha-döngüsüyle tetiklenir (atıl-sunucuda da işler — ikinci-göz 🟠-4).

ALAN TANIMLARI (ikinci-göz 🟡-2): "bayt" = istek gövdesinin üst-beyanı (Content-Length /
  medyada yazılan blob boyutu); 0 = "bu olay için ölçülmedi" (kayıt/oturum/bağlantı).
  "port" = TCP eş-portu YALNIZ doğrudan sokette; CDN/tünel arkasında istemci kaynak-portu
  origin'e ulaşmadığından 0 yazılır = "yapısal olarak ölçülemedi" (ikinci-göz 🔴-1; aydınlatma
  metni + runbook bunu beyan eder; A3 CF-çıkışında alan kendiliğinden gerçek değere kavuşur).

EMNİYETLER (ikinci-göz): yasal_sinir=True iken saklama_gun [365,730] dışıysa AÇILIŞTA reddedilir
  (🟠-3: tek env değeriyle sessiz "en az 1 yıl" ihlali imkânsızlaşır; kesin süre avukattan gelince
  aralık sabitlenir). İmha, koşu başına İMHA_TAVANI dosyayla sınırlıdır (🟠-5: saat-sıçraması tek
  olayda yıllık delili silemez; tavana çarpınca stderr'e anomali uyarısı düşer, kalan ertesi koşuya).
"""
import datetime
import json
import os
import threading
import time

OLAYLAR = ("baglanti", "kayit", "oturum", "mesaj-aktarim")
ALANLAR = ("ts", "olay", "kimlik", "ip", "bayt", "port")

_ONEK, _UZANTI = "trafik-", ".jsonl"
IMHA_TAVANI = 3   # koşu başına en çok bu kadar dosya silinir (saat-anomalisi emniyeti, 🟠-5)


class TrafikKayit:
    def __init__(self, dizin, saklama_gun=365, bugun_fn=None, yasal_sinir=True):
        self.dizin = dizin
        self.saklama_gun = int(saklama_gun)
        if self.saklama_gun < 1:
            raise ValueError("saklama_gun >= 1 olmalı")
        if yasal_sinir and not (365 <= self.saklama_gun <= 730):
            # 🟠-3: fail-fast — yasal aralık (m.5/3: 1-2 yıl) dışı yapılandırmayla servis HİÇ başlamaz.
            raise ValueError("saklama_gun yasal aralık dışı (365-730 gün; m.5/3). "
                             "Test/simülasyon için yasal_sinir=False kullanılır.")
        self._bugun = bugun_fn or datetime.date.today   # test enjeksiyonu (deterministik rotasyon/imha)
        self._kilit = threading.Lock()
        self._son_gun = None

    def _yol(self, g):
        return os.path.join(self.dizin, _ONEK + g.isoformat() + _UZANTI)

    def olay(self, olay, *, kimlik, ip, bayt, port):
        if olay not in OLAYLAR:
            raise ValueError("bilinmeyen olay türü: %r (kapalı liste: %s)" % (olay, ", ".join(OLAYLAR)))
        kayit = {"ts": int(time.time()), "olay": olay, "kimlik": str(kimlik),
                 "ip": str(ip), "bayt": int(bayt), "port": int(port)}
        satir = (json.dumps(kayit, ensure_ascii=False) + "\n").encode("utf-8")
        with self._kilit:
            g = self._bugun()
            if g != self._son_gun:          # gün değişimi: rotasyon doğal (dosya adı günden), imha tetiklenir
                self._imha_kilitli(g)
                self._son_gun = g
            os.makedirs(self.dizin, mode=0o700, exist_ok=True)
            os.chmod(self.dizin, 0o700)   # 🟡-1: makedirs mevcut/umask'lı dizine mode uygulamaz — koşulsuz daralt
            fd = os.open(self._yol(g), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try:
                os.write(fd, satir)
            finally:
                os.close(fd)

    def imha(self):
        with self._kilit:
            return self._imha_kilitli(self._bugun())

    def _imha_kilitli(self, bugun):
        silinen = []
        if not os.path.isdir(self.dizin):
            return silinen
        for ad in sorted(os.listdir(self.dizin)):   # eskiden yeniye — tavan varsa en eskiler önce gider
            if not (ad.startswith(_ONEK) and ad.endswith(_UZANTI)):
                continue
            try:
                g = datetime.date.fromisoformat(ad[len(_ONEK):-len(_UZANTI)])
            except ValueError:
                continue                     # şema-dışı ada dokunma (yanlışlıkla-silme emniyeti)
            if (bugun - g).days > self.saklama_gun:
                if len(silinen) >= IMHA_TAVANI:
                    # 🟠-5: normal akış günde ~1 dosya yaşlandırır; tavana çarpmak = saat-anomalisi
                    # ya da uzun kesinti sonrası birikim. Delil geri-dönüşsüz — durup uyarı bırakılır;
                    # kalan, sonraki imha koşularında (günlük döngü) tavan-tavan erir.
                    import sys
                    print("TRAFIK-IMHA UYARI: koşu tavanı (%d) doldu — imha bekleyen başka dosya var; "
                          "sistem saati doğruysa sonraki koşular tamamlar." % IMHA_TAVANI, file=sys.stderr)
                    break
                os.remove(os.path.join(self.dizin, ad))
                silinen.append(ad)
        return silinen
