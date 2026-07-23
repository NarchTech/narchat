# RUNBOOK — Yasal Talep ve İdari Tedbir (uyumlu sürüm, WP3)

> Bu belge, işletmeciye gelen bir adli/idari talebin nasıl karşılanacağını **ezberden değil dosyadan**
> okunacak biçimde tanımlar. Hukuki nitelendirme içermez; usul akışıdır. Nihai sürüm işletmeci +
> hukuk danışmanı onayıyla kesinleşir (yer-tutucu alanlar).

## 0. Değişmez ilke — ne verilebilir, ne verilemez

- **İçerik VERİLEMEZ** — teknik olarak yok. Mesajlar uçtan uca şifreli; sunucuda yalnız açılamayan
  ciphertext bulunur. Bu bir politika değil, mimarinin sonucudur (bkz. makale §3, §6.3). Şifre çözme
  külfeti kanunen talep edende/savcılıktadır (CMK m.137/2 — makale §6.3).
- **Trafik (bağlantı) bilgisi VERİLEBİLİR** — yalnız usulüne uygun bir yargı kararı üzerine ve
  yalnız kanunun tanımladığı alanlar (zaman · takma-ad kimliği · IP · aktarılan bayt · port). Bu
  kayıtlar `veri/trafik/` altındadır (`trafik_kayit.py`). ⚠ CDN arkasında `port=0` = "ölçülemedi".

## 1. Talep geldiğinde — doğrulama (önce dur, doğrula)

1. Talebin **kaynağını ve türünü** belirle: mahkeme kararı mı, savcılık talebi mi, idari yazı mı?
2. **Yetki kontrolü:** trafik bilgisi için hâkim/mahkeme kararı aranır. (Makale §6.3'teki bulgu:
   AYM, hâkim kararı olmaksızın trafik bilgisi istenmesini iptal etmiştir — dayanak yoksa talep
   eksiktir; hukuk danışmanına yönlendir.) İçerik talebi geldiyse §0'daki teknik-imkânsızlık
   cevabını hukuk danışmanı imzasıyla ilet.
3. Talebi ve eklerini **kayıt altına al** (giden/gelen evrak). Karar numarası runbook adımlarında
   "dayanak" olarak kullanılacak — operatör aracı bunu **zorunlu** tutar.

## 2. Ne sunulabilir — trafik bilgisi çıkarma

- İlgili takma-ad kimliği ve/veya tarih aralığı için `veri/trafik/trafik-YYYY-MM-DD.jsonl`
  dosyalarından **yalnız kararın kapsadığı** satırları süz. (İçerik yoktur; her satır
  {ts, olay, kimlik, ip, bayt, port}'tur.)
- Süzülen kaydı, karar referansıyla birlikte tutanağa bağla. **Kapsam dışına çıkma** — kararın
  istemediği kişiye/döneme ait satır paylaşılmaz (veri-minimizasyonu).
- ⚠ Saklama: kayıtlar yasal süre (1-2 yıl) sonunda otomatik imha edilir; talep bu pencerenin
  dışındaysa kayıt bulunmayabilir — bu bir eksiklik değil, kanunun öngördüğü imhadır.

## 3. İdari tedbir — operatör aracı (`narchat_operator.py`)

Müdahale **ağ üzerinden değil**, sunucuya shell erişimiyle yapılır (kamu yüzeyinde yeni yetki ucu yok).
Her komut **--dayanak** ister (hangi karar/bildirim) ve `veri/operator-gunlugu.jsonl`'e denetim izi yazar.

```
# Hesabı askıya al (giriş 403 + tüm oturumlar iptal):
NARCHAT_VERI=<veri-yolu> python3 narchat_operator.py askiya-al \
    --kullanici <ad> --dayanak "<mahkeme/karar no>" --not "<kısa açıklama>"

# Askıyı kaldır:
... askiya-kaldir --kullanici <ad> --dayanak "<karar no>"

# Geçerli yargı kararına istinaden tek bir opak medya blob'unu sil:
... blob-sil --id <medya_id> --dayanak "<karar no>"

# Tek bir mesajın ciphertext'ini sil (tombstone kalır):
... mesaj-sil --oda <oda> --mid <mesaj_id> --dayanak "<karar no>"

# Durum / denetim izi (salt-okur):
... durum --kullanici <ad>
... gunluk
```

- **İçerik silme ≠ içerik okuma:** `blob-sil`/`mesaj-sil` opak nesneyi kaldırır; hiçbir mesajı çözmez.
- Askı, mevcut tüm oturumları anında geçersizler (oturum-nesli artışı) ve girişi 403 yapar.

## 4. Kayıt ve geri bildirim

- Yapılan her işlem `operator-gunlugu.jsonl`'de (zaman · eylem · hedef · dayanak · not) durur —
  bu, "kararın gereğini yaptık" kanıtıdır. Talep edene verilecek cevabı hukuk danışmanı hazırlar.
- Karara **itiraz** ya da **kapsam sorunu** varsa: uygulamadan önce hukuk danışmanına. Runbook
  aceleye değil, doğru usule hizmet eder.

## 5. Eskalasyon / iletişim

- İşletmeci: <span>[İŞLETMECİ ADI]</span> · Hukuk danışmanı: <span>[AVUKAT]</span>
- Teknik: sunucu shell erişimi olan operatör. Reboot/kernel sınıfı işlemler makine sahibinin
  onay ritüeline tabidir (ayrı belge).

---
*Bu runbook WP3 kapsamındadır; F2 paketinde `narchat_operator.py` + `test/uyum_yuzeyi_test.py` ile
birlikte gelir. Avukat-devir soruları `MASTER-YAYIN-2026-07-22/_F1-NOTLAR.md`'de listelidir.*
