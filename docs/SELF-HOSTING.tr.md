# NarChat Öz-barındırma

*Atıl bir bilgisayardan, siz ve seçtiğiniz insanlar için özel bir mesajlaşma uygulamasına.*

Bu rehber, bir terminal kullanabildiğinizi ve sistem yöneticisi olmadığınızı varsayar. Buradaki her komut kopyalanıp çalıştırılmak üzere tasarlanmıştır. Bir şeyin adım olmaktan ziyade bir ödünleşim (takas) olduğu yerlerde, bir ödünleşim olarak yazılmıştır, çünkü öz-barındırma konusundaki ilginç kararlar teknik değildir.

---

## 1. Üstlenmek üzere olduğunuz şey

Bunu kendiniz çalıştırmanız, denklemin içinde kimlerin olduğunu değiştirir. Bugün, başkasının mesajlaşma uygulamasını kullandığınızda, 23:40'ta biriyle konuştuğunuzu bilen kişilerin listesinde bir şirket, onun barındırma sağlayıcısı ve bu ikisinden herhangi birini zorlayabilecek herkes bulunur. NarChat'i kendi makinenizde çalıştırdığınızda ise bu liste şundan ibarettir: siz.

Tüm teklif budur ve neleri içerip içermediği konusunda kesin konuşmaya değer. Sizi anonim yapmaz. Sistemi kriptografik olarak daha güçlü hale getirmez — şifreleme her iki durumda da aynıdır ve sınırları da öyle (bkz. §11). Değiştirdiği şey *muhafaza*dır: şifreli metin sahibi olduğunuz bir diskte durur, bağlantı kayıtları — eğer varlarsa — size aittir ve hiçbir üçüncü taraf asla sahip olmadığı bir şeyi teslim edebilecek konumda değildir.

Muhafazanın diğer yarısını da üstlenmiş olursunuz: Eğer makineyi veya veri dizinini kaybederseniz, kimse onu sizin için kurtaramaz. Bu tasarımda bir destek masası yoktur. Bu bir gözden kaçırma değildir; bu, sistemin güvenilir olmasını sağlayan özelliğin diğer taraftan görünüşüdür.

**Donanım:** Python çalıştırabilen herhangi bir şey. Beraberindeki makalede açıklanan kurulum, 2012 yapımı bir masaüstü bilgisayarda (Intel i5-3470, 16 GB RAM) çalıştırıldı ve hiçbir zaman darboğaz yaratmadı. Bir Raspberry Pi 4, ekranı kırık eski bir dizüstü bilgisayar, küçük bir VPS — hepsi uygundur. Sunucu, veritabanı olmayan tek bir Python sürecidir.

---

## 2. Beş dakikada çalışan bir sunucu

Python 3.10 veya daha yenisine ve bir bağımlılığa ihtiyacınız var.

```bash
git clone https://github.com/NarchTech/narchat narchat
cd narchat

python3 -m venv .venv
.venv/bin/pip install cryptography

NARCHAT_PORT=8101 .venv/bin/python mesaj_server.py
```

`http://127.0.0.1:8101` adresini açın. Bu çalışan bir sunucudur. İlk başlatmada kendi oturum sırrını ve Web Push anahtarını oluşturdu, bunları `600` moduyla `veri/` dizinine yazdı ve şu anda birinin kaydolmasını bekliyor.

Buraya kadar gelmek için hiçbir şeyi yapılandırmak zorunda değilsiniz. §4'teki her ayarın çalışan bir varsayılan değeri vardır.

---

## 3. İlk hesabınız ve arkanızdan kapıyı kapatmak

Kaydın iki modu vardır ve hangisinde olduğunuz tek bir dosyaya bağlıdır:

| `veri/davetler.json` | Kayıt davranışı |
|---|---|
| **Yok** | Açık: sunucuya ulaşabilen herkes hesap oluşturabilir. Yeni bir kurulumda durum budur. |
| **Var** | Sadece davetle: kayıt olmak için o dosyadan geçerli bir kod gerekir. |

Dolayısıyla olağan sıra şudur: Sunucuyu başlatın, kapı açıkken kendi hesabınızı kaydedin, sonra kapıyı kapatın.

```bash
# 1. Önce tarayıcıda kendinizi kaydedin. Sonra, bundan böyle davetleri zorunlu kılmak için:
cat > veri/davetler.json <<'EOF'
{"kodlar": ["NARC-A1B2-C3D4", "NARC-E5F6-G7H8"], "kullanilmis": {}, "otokodlar": {}}
EOF
```

`kodlar` içindeki her davet kodu tam olarak bir kayıt için geçerlidir; kullanılmış kodlar `kullanilmis` içine taşınır. `NARC-XXXX-XXXX` yapısında kendi kodlarınızı uydurun ve istediğiniz gibi dağıtın — yüz yüze dağıtım, birbirini zaten tanıyan insanlar için tasarlanmış bir sistemde mükemmel bir dağıtım kanalıdır.

Bunun yerine küçük, herkese açık bir sunucu istiyorsanız, `NARCHAT_KOD_ACIK=1` ayarlayın; sunucu talep üzerine kendi hız-sınırlamalı kodlarını verecektir (küresel olarak günde `NARCHAT_KOD_GUNLUK`, adres başına `NARCHAT_KOD_IP_GUNLUK`). Bu kararı vermeden önce düşünün: Açık bir kapı aynı zamanda bir sunucunun seçmediği kullanıcıları edinme yoludur ve gelen her neyse onun operatörü sizsiniz.

**Parolalar üzerine bir not.** Parola sıfırlama yoktur, çünkü sıfırlanacak hiçbir şey yoktur — parola asla sunucuya ulaşmaz ve anahtarlar tarayıcıda yaşar. Hem parolasını hem de cihazını kaybeden bir kullanıcı o hesabı kaybetmiştir ve onlara yardım edemezsiniz. İnsanlarınıza bunu katıldıkları *sonra* değil, katılmadan *önce* söyleyin.

---

## 4. Yapılandırma

Her ayar bir ortam değişkenidir ve hepsinin varsayılanları vardır. Aşağıdaki tablo bu sürüm itibarıyla eksiksizdir; nihai kaynak her zaman koddur.

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `NARCHAT_PORT` | `8101` | TCP portu. |
| `NARCHAT_VERI` | `veri` (göreceli) | Durum dizini. Üretimde mutlak bir yol ayarlayın, böylece veriler asla çalışma dizinine bağlı olmaz. |
| `NARCHAT_VAPID_SUB` | `mailto:admin@example.com` | Web Push hizmetlerine gönderilen iletişim konusu. Gerçekten okuduğunuz bir adres kullanın. |
| `NARCHAT_KOD_ACIK` | `0` | `1` olması self-servis davet kodu musluğunu etkinleştirir (bkz. §3). |
| `NARCHAT_KOD_GUNLUK` | `50` | Musluk: tüm kaynaklar için günlük verilen kod sayısı. |
| `NARCHAT_KOD_IP_GUNLUK` | `8` | Musluk: adres başına günlük verilen kod sayısı. |
| `NARCHAT_RATE_LIMIT` | `30` | Pencere başına, adres başına izin verilen kimlik doğrulama denemeleri; `0` devre dışı bırakır. |
| `NARCHAT_RATE_PENCERE` | `60` | Hız-sınırı penceresi, saniye cinsinden. |
| `NARCHAT_ARAMA_PUSH_ARALIK` | `5` | "Çalıyor" push bildirimleri arasındaki süre, saniye cinsinden. |
| `NARCHAT_ARAMA_PUSH_SURE` | `45` | Cevapsız bir aramanın ne kadar süreyle çalmaya devam edeceği, saniye cinsinden. |
| `NARCHAT_AKTARIM_TTL` | `600` | Tek seferlik cihaz bağlama yükünün ömrü, saniye cinsinden. |
| `NARCHAT_TURN_HOST` | *(ayarlanmamış)* | Katı NAT'lar arası aramalar için TURN sunucunuz (§8). |
| `NARCHAT_TURN_PORT` | `3478` | TURN portu. |
| `NARCHAT_TURN_USERNAME` | *(ayarlanmamış)* | TURN kullanıcı adı. |
| `NARCHAT_TURN_CRED` | *(ayarlanmamış)* | **Sır.** TURN parolası. Yapılandırma olarak dışarıdan verdiğiniz tek sır. |
| `NARCHAT_TEST_HOOKS` | *(ayarlanmamış)* | Test-paketi kancaları. Sunucunun istemci adresleri için `X-Forwarded-For` başlığına güvenmesini sağlar ve aşağıdaki değişkenin geçerli olmasına izin verir. **Bunu üretimde asla ayarlamayın.** |
| `NARCHAT_CORS_TEST_ORIGIN` | *(ayarlanmamış)* | CORS aracılığıyla izin verilen ekstra bir köken — yalnızca `NARCHAT_TEST_HOOKS` da ayarlandığında dikkate alınır. Test paketi içindir; dağıtımlar için değildir. |

Sadece uyumlu dal üzerinde, iki tane daha mevcuttur — `NARCHAT_TRAFIK_KAYIT` ve `NARCHAT_TRAFIK_SAKLAMA_GUN`. Bkz. §10.

---

## 5. Veri dizini

Sunucunun bildiği her şey tek bir dizinde yaşar. Bir veritabanı yoktur ve başka hiçbir yerde hiçbir şey saklanmaz.

| Yol | İçerik |
|---|---|
| `kullanicilar.json` | Hesaplar: kullanıcı adı, açık anahtar, parola doğrulayıcı. E-posta yok, telefon numarası yok — bu alanlar mevcut değildir. |
| `odalar.json`, `kisiler.json` | Konuşmalar ve kişi listeleri. |
| `mesajlar/`, `okundu/`, `tepkiler.json` | Sunucunun hiçbir anahtara sahip olmadığı şifreli metin olarak mesajlar ve tepkiler. |
| `medya/` | Şifrelenmiş medya blobları — aynı şekilde okunaksız. |
| `avatar/` | Profil resimleri. **Uçtan uca şifreleme ile korunmaz** — onlara yarı-açıkmış gibi davranın. |
| `davetler.json` | Davet kodları, eğer oluşturduysanız (§3). |
| `duyurular.json` | Eğer kullanırsanız, isteğe bağlı uygulama içi duyuru içeriği. |
| `.gizli`, `.vapid.pem` | İlk çalıştırmada oluşturulan sunucu sırları, mod `600`. |
| `push_aboneler.json` | Web Push abonelikleri. |

**Yedekleme, sadece bu dizinin bir kopyasıdır ve başka hiçbir şey değildir.** Sunucu durdurulmuşken veya size tutarlı bir kopya veren herhangi bir anlık görüntü aracıyla:

```bash
sudo systemctl stop narchat
tar czf narchat-backup-$(date +%F).tar.gz -C /opt/narchat veri
sudo systemctl start narchat
```

Bu arşivi şifrelenmiş bir yerde tutun — `.vapid.pem` dosyasını ve her kullanıcının saklanan verilerini içerir. **Geri yüklemek, onu geri çıkartmaktır.** Sunucuyu tamamen sıfırlamak `rm -rf veri` komutudur, bu sizinki de dahil olmak üzere her hesabı geri döndürülemez şekilde yok eder.

---

## 6. Onu bir hizmet olarak çalıştırmak

`deploy/systemd/narchat.service` içinde bir unit dosyası gelir. Kurmadan önce okuyun: yapılandırma onun içinde yaşar ve bu kasıtlıdır — tek bir dosyada yaşayan bir hizmet tanımı ve yapılandırması birbirinden kopup uzaklaşamaz.

```bash
sudo useradd --system --home /opt/narchat narchat
sudo mkdir -p /opt/narchat && sudo cp -r . /opt/narchat/
sudo chown -R narchat:narchat /opt/narchat

sudo cp deploy/systemd/narchat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now narchat
sudo systemctl status narchat
```

Günlükler journal'a gider:

```bash
sudo journalctl -fu narchat
```

*(Pilot uygulama macOS launchd altında çalıştırıldı. O dosyalar burada sunulmamaktadır — onlar sadece bir makinenin düzenini kodluyordu ve belgelenmeye değer olan yol systemd'dir.)*

---

## 7. Erişim merdiveni

Varsayılan olarak sunucu yalnızca `127.0.0.1` üzerinde dinler. Bu bir ayar olarak sunulmak yerine koda sabitlenmiştir ve bunun bir amacı vardır: yeni başlatılmış bir sunucu kazara açık internette olamaz. Bu nedenle ona başka bir makineden ulaşmak, her zaman sizin açıkça verdiğiniz bir karardır — ve bu merdivenin her basamağı, biraz daha erişim için bir miktar egemenlikten takas yapar.

### 1. Basamak — Yalnızca özel ağ (en egemen olanı)

Ağınızın dışından hiç kimse yolda değildir, çünkü bir yol yoktur. İki yöntem:

**Bir VPN üzerinden (önerilen).** Sunucuyu ve herkesin cihazını bir WireGuard ağına koyun ve bağlama adresini olduğu gibi bırakarak yalnızca VPN arayüzünde dinlemesini sağlayın. Kullanıcılarınız dünyanın her yerinden `http://10.0.0.1:8101` adresine ulaşır ve internetin geri kalanı için sunucunuz mevcut değildir.

**LAN üzerinde.** Kendi ağınızdaki diğer makinelere doğrudan yanıt vermesi gereken bir sunucu için tek bir satırı değiştirin — `mesaj_server.py`, alt kısımlara doğru:

```python
# şundan:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
# şuna:
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
```

Sonra gerçekte neyi dışa açtığınızı doğrulayın, çünkü "0.0.0.0", yönlendiricinize bakan da dahil olmak üzere her arayüz anlamına gelir:

```bash
sudo ss -lntp | grep 8101      # ne, neyin üzerinde dinliyor
sudo ufw status                # güvenlik duvarınızın içeri girmesine izin verdikleri
```

Tarayıcılar bazı özellikleri (özellikle mikrofon ve kamera erişimi ile PWA kurulumu) güvenli kökenlerle sınırlandırır. Özel bir adreste `http://` mesajlaşma için işe yarar; aramalar için TLS isteyeceksiniz, ki bu da 2. basamak demektir.

### 2. Basamak — Kendi alan adınız ve kendi ters vekil sunucu (reverse proxy)

TLS'yi siz sonlandırırsınız. Sertifikayı siz tutarsınız. Erişim günlükleri diskinizdedir. Bu, hala tamamen size ait olan en yüksek basamaktır ve bağlantınız gelen trafiğe izin veriyorsa hedeflenmesi gereken basamaktır.

Caddy, bütünüyle:

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8101
}
```

nginx, burada bir yönerge diğerlerinden daha önemlidir — canlı mesaj akışı sunucu-gönderimli olaylardır ve tamponlama yapan bir vekil sunucu bunu sessizce durduracaktır:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8101;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;          # gerekli: SSE tamponlanmamalıdır
        proxy_read_timeout 24h;       # uzun ömürlü akış bağlantıları
    }
}
```

### 3. Basamak — Bir tünel (Cloudflare Tunnel ve benzerleri)

Eğer bağlantınız CGNAT arkasındaysa — çoğu ev geniş bantı ve her mobil ağ böyledir — gelen bağlantılar imkansızdır ve bu basamak işe yarayan tek seçenek olabilir. Tünel dışarıyı arar; hiçbir şey içeriği aramaz; bir port açmadan genel bir HTTPS adresi alırsınız. Örnek bir yapılandırma `deploy/cloudflared-example.yml` içindedir.

**Bedeli yüksek sesle söyleyin:** artık kullanıcılarınızın kurduğu her bağlantıyı üçüncü bir taraf sonlandırıyor. Birinin bağlandığını, kabaca nereden ve ne zaman bağlandığını görüyor — ki bu tam olarak, sistemin kendisinin toplamamaya özen gösterdiği bağlantı üstverisidir. Mesaj içeriğini görmez: o, uçtan uca şifrelenmiştir ve ne tünel ne de kendi sunucunuz bunu okuyabilir. Ancak "operatör mesajlarınızı okuyamaz" ve "hiçbir yerde hiç kimse hiçbir şey göremez" farklı iddialardır ve bu basamakla temastan yalnızca ilki sağ kurtulur.

Pilot kurulum bu şekilde çalıştırıldı ve makale, sahip olmadığı bir egemenliği iddia etmek yerine bunu bu sözlerle belirtmektedir. Eğer bu takas sizin için yanlışsa, 1. ve 2. basamaklar mevcuttur.

---

## 8. Aramalar

Aramalar eşler arası WebRTC'dir. Ses ve görüntü iki cihaz arasında aktarım sırasında şifrelenir (DTLS-SRTP).

**Yapılandırma olmadan, arama kurulumu Google'ın genel STUN sunucusuyla iletişim kurar** (`static/arama.js` içindeki `stun.l.google.com:19302`). Google, adresinizdeki bir cihazın bir arama kurduğunu öğrenir — kiminle olduğunu veya içeriği değil, sızdırmak istemeyebileceğiniz bir gerçeği. Kendi TURN sunucunuzu çalıştırmak bu bağımlılığı ortadan kaldırır ve aynı zamanda katı NAT'ların arkasında başarısız olan aramaları düzeltir. Minimal bir `coturn` yapılandırması:

```ini
listening-port=3478
realm=turn.example.com
fingerprint
lt-cred-mech
user=narchat:choose-a-real-password
# Temel aramalar çalıştıktan sonra TLS eklemeye değer:
# tls-listening-port=5349
# cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

Sonra sunucuyu buna yönlendirin (komut satırında değil, unit dosyasında yapın, böylece kimlik bilgisi kabuk geçmişinize düşmez):

```
NARCHAT_TURN_HOST=turn.example.com
NARCHAT_TURN_USERNAME=narchat
NARCHAT_TURN_CRED=choose-a-real-password
```

**Açıkça belirtilmiş dürüst bir sınır:** medya şifrelenmiştir, ancak **arama sinyalleşmesi şifrelenmemiştir**. Düşmanca veya ele geçirilmiş bir sunucu, arama kurulumuna, mesajlara karşı girişemeyeceği şekillerde müdahale etmeye yeltenebilir. Mesajlaşma garantisi ve arama garantisi aynı garanti değildir ve bu belgelendirme, birinin diğerinin itibarını ödünç almasına izin vermeyecektir.

---

## 9. Kendiniz kanıtlayın

Ana iddia da dahil olmak üzere yukarıdakilerin hiçbirine güvenerek yaklaşmamalısınız. Depo, bu kontrolü beraberinde sunar.

```bash
.venv/bin/pip install pynacl
.venv/bin/python test/e2e_roundtrip.py
```

Bu test, gidiş-dönüş yolculuğunu *bağımsız* bir kriptografik uygulamayla (tarayıcı istemcisinin kullandığından farklı bir bağlama olan PyNaCl) gerçekleştirir: Bir mesajı şifreler, çalışan sunucunuz üzerinden iter, onu alıcı olarak şifresini çözer, üye olmayan birinin reddedildiğini doğrular — ve ardından sunucunun kendi depolama dosyalarını açar, diskte herhangi bir yerde düz metin görünürse başarısız olur.

İlerledikçe kendi hesaplarını kaydeder, bu yüzden temiz bir veri dizinine sahip bir sunucuda çalıştırın — zaten bu hesapları tutan bir sunucuda, herhangi bir şeyi kanıtlamak yerine kayıt çakışması nedeniyle duracaktır. Sunucuyu durdurun, `rm -rf veri` yapın, tekrar başlatın ve çalışacaktır. Bunu açıkçası test kurulumunda yapın, arkadaşlarınızın kullandığında değil.

Tarayıcı düzeyindeki eşdeğeri, gerçek tarayıcıları bir konuşma boyunca yönlendirir ve aynı disk kontrolünü uygular:

```bash
npm install                      # Sadece tarayıcı testleri için Playwright
node test/browser_e2e.mjs
```

Test paketinin geri kalanı `test/` içindedir. Doğruladığı sistemden daha büyüktür, bu kasıtlı bir seçimdi ve makalede belgelenmiştir.

---

## 10. Hangi dalı çalıştırmalısınız?

| Dal | Ne yapar |
|---|---|
| `main` | Referans sürüm. Hiçbir bağlantı kayıtları tutmaz, çünkü bunları tutacak kod asla yazılmadı. |
| `compliant` | Aynı sistem, ancak bağlantı olaylarını kaydedebilen ek bir modül ile — kim, ne zaman bağlandı, kaç bayt taşındı — ve asla okuyamayacağı mesaj içeriğini değil. Kayıtlar `NARCHAT_TRAFIK_KAYIT=1` olmadıkça kapalıdır; bu bayrak ayarlanmamışken modül içe bile aktarılmaz ve dal `main` ile tamamen aynı şekilde davranır. |

Aralarındaki fark bir üretim dosyası (+91/−2 satır), sekiz yeni dosya ve baytına kadar değiştirilmemiş kriptografik bir çekirdektir. Bunu tek bir komutla kendiniz ölçebilirsiniz:

```bash
git diff paper-reference compliance-fork --stat
```

**Hangisini çalıştıracağınız, bu belgenin sizin için cevaplayabileceği bir soru değildir.** Yükümlülükler ülkeye göre farklılık gösterir ve ne yaptığınıza göre değişir — kendiniz ve bir düzine arkadaşınız için bir örnek çalıştırmak ile yabancılara bir hizmet sunmak aynı durum değildir. Kodun ne yaptığını ve incelediğimiz hukukun ne söylediğini raporluyoruz; her ikisi hakkında da bir hüküm vermiyoruz. **Bu hukuki tavsiye değildir.** İki sürümün arkasındaki gerekçe için bkz. [WHY-TWO-VERSIONS.md](WHY-TWO-VERSIONS.md) ve beraberindeki makale.

---

## 11. Öz-barındırma neleri çözer, neleri çözmez

| Çözdükleri | Çözemedikleri |
|---|---|
| **Üçüncü taraf transit** — 1. ve 2. basamaklarda, yolda başka kimse yoktur. | **İleri gizlilik yoktur.** Anahtarlar statiktir: çalınmış bir anahtar geçmiş mesajları açar. Bu, sistemdeki en önemli sınırlamadır. |
| **Muhafaza** — diskler sizindir, şifreli metin kopyalarının her biri de öyle. | **Üstveri.** Sunucunuz kimin kimle, ne zaman konuştuğunu görür. Öz-barındırma bu görünürlüğü size taşır; onu ortadan kaldırmaz. |
| **Zorlama** — başka hiç kimse asla kendilerine verilmeyen bir veriyi sunmaya zorlanamaz. | **Arama sinyalleşmesi** şifrelenmemiştir (§8). |
| **Süreklilik** — bu projeye ne olursa olsun kopyanız çalışmaya devam eder. | **Olgunluk.** Bu, operasyon ekibi olan sağlamlaştırılmış bir hizmet değil, haftalarca gerçek konuşmaları taşımış olan pilot bir yazılımdır. |

Doğru sütuna da sol sütuna inandığınız kadar inanın. Kendi sınırlarını sayabilen bir sistem, çalıştırmaya değer tek sistemdir.

---

## 12. Android

Kendi APK'nızı derleyip imzalayabilirsiniz — bkz. [`../BUILD-ANDROID.md`](../BUILD-ANDROID.md). Önce değiştirmeniz gereken iki şey var, yoksa derlemeniz sizinki yerine pilot uygulamanın sunucusuyla konuşacaktır:

- `static/kok.js` — yerel derleme tarafından kullanılan API kök sabiti (şu anda pilot sunucu).
- `capacitor.config.json` — `appId` ve izin verilen gezinme sunucusu.

Kendi imzaladığınız bir APK, başkasının anahtarıyla güncellenemez, ki istediğiniz özellik de budur. Keystore'u iki yıl sonra hala sahip olacağınız bir yerde tutun; eğer kaybolursa, kullanıcılarınızın bir güncellemeyi alabilmesi için uygulamayı kaldırıp yeniden yüklemeleri gerekecektir.

---

*Bu rehberin cevaplayamadığı sorular veya makinenizde çalışmayan bir adım sorun izleyiciye aittir — sadece yazarı için çalışan bir öz-barındırma rehberi başarısız bir belgedir.*
