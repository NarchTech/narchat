# NarChat

**Sadece güvenilsin diye değil, anlaşılsın diye inşa edilmiş uçtan uca şifrelemeli bir mesajlaşma uygulaması.**

Mesajlarınızı okuyamayacak kadar kasıtlı olarak aptal bırakılmış bir sunucu için elle yazılmış tek bir Python dosyası, tüm şifreleme işlemlerini yapan bir tarayıcı istemcisi ve sunucunun kendi diskini okuyup herhangi bir düz metin bulursa hata vererek bu iddiayı kanıtlayan bir test.

Tüketici donanımı üzerinde, yaklaşık sıfır altyapı maliyetiyle, yapay zeka uygulamasını yönlendiren tek bir kişi tarafından inşa edilmiştir. Bu bir ürün değil, bir **pilot**tur; ve bu depo, [makale](#makale) ile birlikte uygulamanın tamamıdır ve bilerek tüm açıklığıyla sunulmuştur.

> **Neden açık?** Çünkü küçük, şifreli bir sistem için herkes tarafından görülebilir olmak ve herkes için olduğunu göstermek başlı başına bir güvenlik özelliğidir. Makale bunun nedenini açıklıyor; bu, öğrendiğimiz en şaşırtıcı şeydi. **Bize değil, koda güvenin.**

---

## Dürüstçe, bu sistem nedir

- **Sunucu sadece opak veri yığınlarının bir taşıyıcısıdır.** Açacak anahtarı olmayan şifreli metinleri depolar ve iletir. Bu sadece bir vaat değildir: `test/e2e_roundtrip.py` çalışan bir sunucu üzerinden gerçek bir mesaj geçirir, ardından sunucunun diskteki depolama dosyalarını açar ve **eğer herhangi bir yerde bir nöbetçi (sentinel) düz metin belirirse hata verir**.
- **Uçtan uca şifrelemeli** metin ve medya (libsodium; X25519 + XSalsa20-Poly1305 fan-out), birebir ve küçük gruplar.
- **Kayıt aşamasında kişisel veri yok.** Sadece bir kullanıcı adı ve bir parola, başka hiçbir şey yok. Telefon numarası yok, e-posta adresi yok. Parola cihazınızdan asla dışarı çıkmaz; giriş işlemi bir meydan okuma-imza takasıdır.
- **Sesli ve görüntülü aramalar** (WebRTC, DTLS-SRTP), progresif bir web uygulaması ve imzalanmış bir Android APK'sı.
- **Veritabanı yok, framework yok, CDN'den sunulan kaynaklar yok, analiz araçları yok.** Sadece Python standart kütüphanesi ve bir bağımlılık.

## Sağlamadığı özellikler — lütfen bunu da okuyun

Amaç dürüstlük, bu yüzden sınırlar özellikler kadar açık bir şekilde belirtilmiştir. Tüm detaylar makalenin §4 bölümündedir.

- **İleri gizlilik yok.** Anahtarlar statiktir; ele geçirilen bir anahtar geçmiş mesajları açar. Bu, sistemin en belirgin zayıflığıdır.
- **Üstveri (metadata) gizliliği yok.** Sunucu kimin kiminle, ne zaman ve ne kadar konuştuğunu görür — yalnızca *ne* konuştuğunu göremez.
- **Arama sinyalleşmesi şifrelenmemiştir.** Kötü niyetli bir sunucu arama kurulumuna müdahale etmeye çalışabilir. Mesajlaşma garantisi ile arama garantisi aynı garanti değildir; lütfen birinin itibarının diğerine ödünç verilmesine izin vermeyin.
- **Pilot ölçek.** Haftalarca gerçek kişilerle, gerçek cihazlarda çalıştı. Ancak sertleştirilmiş bir hizmet (hardened service) değildir.

Eğer bu ödünleşimler sistemi tehdit modeliniz için yetersiz kılıyorsa, vaatlere değil, sınırlara inanın.

---

## Beş dakikada çalıştırın

Python 3.10+ ve bir bağımlılık (`cryptography`, Web Push ve imza doğrulaması için).

```bash
# 1. sunucuyu ayağa kaldır — gerisini standart kütüphane hallediyor
python3 -m venv .venv && .venv/bin/pip install cryptography
NARCHAT_PORT=8101 .venv/bin/python mesaj_server.py        # → http://127.0.0.1:8101

# 2. iki ayrı tarayıcı profilinde aç, iki kullanıcı kaydet, kendi kendinle konuş.

# 3. sunucunun seni okuyamadığını kanıtla — negatif test:
.venv/bin/pip install pynacl
.venv/bin/python test/e2e_roundtrip.py
```

Bu üçüncü komut aslında tüm tezin tek bir çalışmada kanıtlanmasıdır: **Bağımsız** bir uygulama (PyNaCl, istemcininkinden farklı bir bağlayıcı) canlı sunucu üzerinden bir şifreli metni gönderip alır, üye olmayan biri reddedilir ve sunucunun depolama alanı düz metin sızıntısına karşı kontrol edilir. Tarayıcı seviyesindeki versiyonu `node test/browser_e2e.mjs`'dir.

*(Test kendi hesaplarını kaydeder, bu yüzden temiz bir `veri/` dizini olan bir sunucuya ihtiyaç duyar; bu hesapları halihazırda barındıran bir sunucuya karşı çalıştırıldığında bir kayıt çakışmasında durur. Sunucuyu durdurun, `rm -rf veri` komutunu çalıştırın, tekrar başlatın ve çalışacaktır.)*

Durum verileri `veri/` altındaki düz dosyalarda yaşar (git tarafından yok sayılır; oturum sırlarını ve kullanıcı verilerini tutar). Temiz bir başlangıç yapmak için o dizini silin.

**Gerçekten çalıştırmak** — boşta duran bir makinede, kendi çevrenizdeki insanlar için — [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md)'dir: ilk hesap ve davet kodları, systemd, sistemi erişilebilir yapmanın üç yolu ve her birinin size üstveri olarak maliyeti, kendi TURN sunucunuz, yedeklemeler ve öz-barındırma işleminin neleri çözüp neleri çözmediğine dair dürüst bir liste.

---

## İki dal

| Dal / etiket | Nedir |
|---|---|
| `main` | Mevcut pilot: referans sürüm ve sistemi fiilen çalıştırmaktan doğan düzeltmeler ile eklemeler. **Bağlantı kayıtları tutmaz** — bunları tutacak kod hiçbir zaman yazılmadı. |
| `paper-reference` (etiket) | Eşlik eden makalenin 7 Temmuz 2026'da kanıt tabanını dayandırdığı tam durum. |
| `compliant` | Aynı sistemin, bazı yargı alanlarındaki işletmeci yükümlülüklerinin talep ettiği bağlantı kayıtlarını — kim, ne zaman bağlandı, kaç bayt — tutacak şekilde donatılmış hali; üstelik **hala bir mesajı okumaktan aciz**. `NARCHAT_TRAFIK_KAYIT=1` olmadığı sürece kapalıdır; bu bayrak ayarlanmadığında tamamen referans sürüm gibi davranır. |
| `compliance-fork` (etiket) | Aynı varyantın, bu yayın belgeleri iki dala da eklenmeden önceki, çatallandığı andaki hali. Aşağıdaki ölçümün yalnızca kodla ilgili kalması için var. |

Aralarındaki fark bir prodüksiyon dosyası (`+91 / −2` satır), sekiz yeni dosya ve tek bir baytı bile değişmemiş kriptografik bir çekirdektir. Buna da körü körüne inanmak zorunda değilsiniz:

```bash
git diff paper-reference compliance-fork --stat
```

**Neden iki versiyonun var olduğu** — uyumlu sürüm çatallanmasını üreten yasal araştırma, bu versiyonun neyi kaydettiği ve varsayılanın neden hala hiçbir şey kaydetmeyen olduğu — [`docs/WHY-TWO-VERSIONS.md`](docs/WHY-TWO-VERSIONS.md) dosyasındadır. Kısa versiyon: İncelediğimiz yükümlülükler içerik değil bağlantı verilerini talep ediyor ve istediklerini kaydetmek şifrelemeyi zayıflatmayı gerektirmedi. O belge, ifadenin gerçekten belirsiz olduğu o tek yer de dâhil olmak üzere okuduklarımızı raporlar. Bunların hiçbiri hukuki tavsiye değildir.

## Depo haritası

| Yol | Ne İşe Yarar |
|---|---|
| `mesaj_server.py` | Tüm sunucu — aptal bir röle ve şifreli metin deposu. |
| `auth_modul.py` | Sıfır bilgi kimlik doğrulaması (Ed25519 meydan okuma–imza). |
| `static/` | PWA istemcisi: arayüz, uçtan uca şifreleme, servis çalışanı (service worker), aramalar. |
| `test/` | Doğruladığı sistemden daha büyük olan test paketi — diski okuyan nöbetçi testi de dahil. |
| `deploy/` | Genel servis ve ingress şablonları. |
| `docs/` | Öz-barındırma kılavuzu ve iki versiyonun arkasındaki mantık. |
| `android/` | İmzalı APK için Capacitor sarmalayıcısı; derleme talimatları depo kökündeki `BUILD-ANDROID.md` dosyasındadır. |

## Makale

Tasarım, şifreleme, dürüst sınırlar, geliştirme yöntemi (insan yönlendirmeli, yapay zeka tarafından uygulanan, bağımsız denetimli) ve uyumlu sürüm çatallanmasını üreten hukuki araştırma eşlik eden bir makalede belgelenmiştir:

> *Content-Blind by Construction: Building, Auditing, and Legally Situating a Zero-Budget End-to-End Encrypted Messenger* — Melikoğlu, Altınbaş ve Tanrıöver, 2026. İngilizce ve Türkçe: [doi:10.5281/zenodo.22017687](https://doi.org/10.5281/zenodo.22017687)
>
> Bu depo, tam geçmişiyle birlikte [doi:10.5281/zenodo.22017587](https://doi.org/10.5281/zenodo.22017587) adresinde arşivlenmiştir — yazılıma atıf yapacaksanız bunu kullanın.

Makaledeki her teknik iddia, bu depodaki bir unsura — bir dosya ve satıra, isimlendirilmiş bir teste, bir denetim günlüğü kaydına — bağlanır; asla çalışan bir servise bağlanmaz. Servisler ölür, kod ölmez.

---

## Okuduğunuz metin üzerine birkaç not

**Geliştirme geçmişi yayımlanmamıştır.** Bu depo, makalenin dondurulduğu noktada başlar. Projenin orijinal işleme geçmişi — 76 işleme — pilot kullanıcılarının ayrıntılarını ve işletim makinesinin yerleşimini üstveri olarak barındırır; bu nedenle, makalenin Kullanılabilirlik (Availability) bölümünde belirtildiği gibi özel bir arşivde tutulmaktadır. Yayımlanan şey, ömrünün üç noktasındaki eksiksiz kaynak kodudur.

**Operasyonel yapılandırmaların yerini şablonlar almıştır.** Pilot dağıtımın tünel tanımlayıcıları, kimlik bilgisi yolları ve ana makine yerleşimi burada yer almaz. Bir işletmecinin altyapısını yayımlamak ile yazılımını yayımlamak aynı eylem değildir.

**Ekran görüntüleri kurgulanmıştır**, uydurulmuş hesaplar ve uydurulmuş konuşmalar kullanılarak izole edilmiş bir sunucuda oluşturulmuştur. Bu deponun hiçbir yerinde gerçek bir kullanıcı, kullanıcı adı veya mesaj yer almaz.

**Kodun yorumları Türkçedir**, aynı şekilde arayüz de öyle. Pilot Türkçe konuşan bir gruptu ve metin dizgileri hiçbir zaman uluslararasılaştırılmadı — bu gizlenmek yerine kaydedilmiş, gerçek bir sınırlamadır. Dokümantasyon İngilizcedir; bu belgelerin Türkçe çevirisi onlarla yan yana bulunmaktadır.

## Bunu birlikte inşa etmek

Bu, tek geliştiricili, sıfır bütçeli bir pilottur ve geriye kalan zor kısım şifreleme değildir; onun etrafındaki her şeydir: ileri gizlilik, üstveri minimizasyonu ve hiçbir şifreleme kodunun çözemeyeceği dağıtım problemi. Eğer bu sizin çözmeyi sevdiğiniz türden bir problemse, kod burada ve davetimiz herkese açıktır. [`MANIFESTO.md`](MANIFESTO.md) ve [`CONTRIBUTING.md`](CONTRIBUTING.md) dosyalarına bakın.

## Lisans

**MIT.** Kullanın, değiştirin, çalıştırın, yayımlayın. [`LICENSE`](LICENSE) dosyasına bakın.

---

### Türkçe

Bu belgelerin Türkçesi: [`README.tr.md`](README.tr.md) · [`MANIFESTO.tr.md`](MANIFESTO.tr.md) · [`docs/SELF-HOSTING.tr.md`](docs/SELF-HOSTING.tr.md) · [`docs/WHY-TWO-VERSIONS.tr.md`](docs/WHY-TWO-VERSIONS.tr.md)
