# Neden iki sürüm var

*Bir yargı alanı, bir mimari üzerinde parmak izi bırakır. Bu, bizimkinin ölçümüdür.*

Bu depoyu yeni klonladıysanız, iki dalla karşılaştınız: referans sürüm olan `main` ve bağlantı kayıtları tutmak üzere donatılmış bir varyant olan `compliant` (uyumlu sürüm). Sunucusunun hiçbir şeyi okuyamayacağı iddiasını merkeze alan bir proje için, *herhangi bir şeyi* kaydeden ikinci bir sürüm bir dipnottan ziyade gerçek bir açıklamayı hak ediyor. Bu belge işte o açıklamadır ve aynı zamanda deponun geri kalanının dayandığı gerekçedir.

**Bir kez belirtilen ve kastedilen bir uyarı: bunların hiçbiri hukuki tavsiye değildir.** Yükümlülükler ülkeye göre ve role göre değişir — bir geliştirici, arkadaşları için bir sunucu çalıştıran biri ve kamuya açık bir hizmet yürüten bir şirket üç farklı durumdadır. Aşağıdakiler, ne bulduğumuzu ve ne inşa ettiğimizi raporlamaktadır. Size ne yapıp ne yapamayacağınızı söylemez ve kendi ülkemiz dahil hiçbir ülkenin kanunları üzerinde hüküm vermez.

---

## 1. İlk olarak ne inşa edildi

Referans sürüm, sistemin tasarlandığı halidir: açmak için hiçbir anahtara sahip olmadığı mesajları saklayan ve ileten bir sunucu. Şifreleme göndericinin cihazında, şifre çözme ise alıcının cihazında gerçekleşir; sunucu şifreli metin işler ve başka hiçbir şey işlemez.

Bu bir iddiadır ve iddialarda bulunmak kolaydır, bu yüzden proje buna bir sözle değil bir testle cevap verir. `test/e2e_roundtrip.py` bağımsız bir kriptografik uygulamayla bir mesajı şifreler, onu canlı bir sunucu üzerinden gönderir, alıcı olarak şifresini çözer, üye olmayan birinin reddedildiğini doğrular — ve ardından sunucunun diskteki kendi depolama dosyalarını açar; eğer düz metin herhangi bir yerde görünürse test başarısız olur. Kendiniz çalıştırın; yaklaşık otuz saniye sürer ve bize güvenmek zorunda kalmamanın en kısa yoludur.

Bunun ne *sağlamadığı* konusunda da eşit derecede net olalım. İleri gizlilik yoktur: anahtarlar statiktir ve çalınan bir anahtar geçmiş mesajları açar. Sunucu zorunlu olarak yönlendirme üstverisini görür — kime ait olduğunu bilmeden bir mesajı teslim edemez. Trafik analizi yapan bir hasma karşı bu sistem çok az şey sunar. Sunduğu ve kanıtlayabildiği şey, bir konuşmanın *içeriğinin* sunucuda okunabilir bir biçimde bulunmadığıdır.

## 2. Ardından gelen soru

Kullanıcılarını okuyamayan bir sistem bir yazılımdır. Onu başkaları için çalıştırmak başka bir şeydir ve birçok gizlilik projesinin yüksek sesle sormamayı tercih ettiği bir soruyu gündeme getirir: **böyle bir hizmeti yürüten birinden gerçekte ne talep edilir?**

Varsaymak yerine okumaya karar verdik. Bu depoyla birlikte gelen makale, vaka çalışması olarak Türkiye'yi kullanarak bu araştırmayı tam olarak belgelemektedir — Türkiye, yazarların tabi olduğu yargı alanı olduğu için ve küçük bir şifreli mesajlaşma uygulaması hakkında alışılmadık derecede geniş bir içtihat sunduğu için seçilmiştir.

Bulgu, projeyi yeniden düzenledi.

**İncelediğimiz yükümlülükler içerikle değil, bağlantı verileri ile ilgilidir.** Kimin bağlandığını, ne zaman, ne kadar süreyle ve ne kadar veri aktarıldığını soruyorlar. Kanun bu verileri kapalı bir liste olarak tanımlar ve mesaj içeriği bu listede yer almaz.

Dürüst bir belirsizlik varlığını sürdürüyor ve makale bunu geçiştirmek yerine olduğu gibi aktarıyor: 2007 tarihli bir uygulama yönetmeliği, bir yer sağlayıcının trafik verilerini kanunun yaptığından daha geniş bir şekilde tanımlıyor ve buna — POST gövdeleri veri taşıdığı için teorik olarak içeriğe uzanabilecek — bir ifadeyi, "işlem bilgisi (GET, POST komut detayları)", dâhil ediyor. Birkaç şey bunu daraltıyor: kanun yönetmelikten üstündür, yönetmelik ona karşı bariz şekilde güncelliğini yitirmiştir ve Danıştay, kanunun kendi listesinin kapalı olduğu gerekçesiyle yönetmeliğin ucu açık torba hükümlerini zaten iptal etmiştir. Ancak ifadenin kendisi hiçbir zaman yargıya taşınmamıştır ve pratikteki okuması, makalenin hukuk müşavirleri için bekleyen sorularından biridir. Bunu makalenin yaptığı aynı nedenle burada işaretliyoruz: işaretlenmiş bir belirsizlik bir bulgudur ve sessizce geçiştirilmiş bir belirsizlik başkasının başına kalmayı bekleyen bir hatadır.

Bunu mimariyle karşılaştırdığınızda ortaya çıkan tablo neredeyse komik bir hal alıyor. Yükümlülüklerin istediği veriler, içerik-kör bir tasarımın herhangi bir şeyi yönlendirebilmek için zaten ürettiği üstverinin ta kendisidir. Tasarımın tutmayı reddettiği veriler ise tam olarak kimsenin istemediği verilerdir. "Şifreli" ile "uyumlu" arasında herkesin beklediği çarpışma, beklenilen yerde gerçekleşmedi — şifreleyicide gerçekleşmedi.

## 3. Çatallanma ve ölçüm

Bu bulgu, herhangi bir şeyi zayıflatmayı içermeyen bir çatallanmayı mümkün kıldı. Kriptografiye dokunmak yerine, bu varyant uç noktaları donatır: bağlantıların ve aktarımların gerçekleştiğini kaydeder ve bunların ne içerdiğini yapısal olarak kaydedemez durumda kalır.

Her iki dalı da yayınlamanın amacı, bunun iddia edilebilir olmaktan çıkıp ölçülebilir hale gelmesidir. Tek bir komut:

```bash
git diff paper-reference compliance-fork --stat
```

Gösterdiği şey:

- **Bir üretim dosyası değişti** — `mesaj_server.py`, `+91 / −2` satır: altı kanca çağrısı ve üç altyapı bloğu.
- **Sekiz yeni dosya** — kayıt modülü, bir operatör aracı, üç uyumluluk sayfası, iki test dosyası ve bir işletim kılavuzu (runbook).
- **Uçtan uca kriptografik çekirdek baytı baytına değişmemiştir** — `static/auth.js`, `static/app.js` ve `auth_modul.py` sıfır fark gösterir ve git bunu sizin için doğrulayacaktır.
- **Hiçbir şey silinmedi.** Çıkarılan ("removed") iki satır, aslında bir satırın ikiye genişletilmiş halidir. Yargı alanı bu mimariden hiçbir şey eksiltmedi; sadece uçlara eklemeler yaptı.

Üzerinde durulmaya değer olan o son özelliktir. Buradaki uyumluluk bir yeniden tasarım, bir zayıflatma veya bir anahtar emanet planı değildi. Sadece, orada olduğundan haberi bile olmayan bir kriptografik çekirdeğin yanında duran bir bayrak ve bir günlükleme modülüydü.

## 4. Uyumlu sürüm neyi kaydeder ve neyi hala göremez

Kayıt modülü `trafik_kayit.py`'dir ve tek oturuşta okunabilecek kadar kısadır — ki bu da aşağıdakileri kontrol etmek için amaçlanan yoldur.

**Kapalı bir olaylar listesini kaydeder:** bir kayıt, bir oturum açma, bir bağlantı ve bir mesaj veya medya aktarımı. Kancalar yalnızca bir işlem halihazırda başarılı olduktan sonra tetiklenir ve yalnızca üstveri alırlar.

**Şeması yapısal olarak kapalıdır.** Bir kayıt; bir zaman damgası, olay türü, sunucu tarafından zaten görülebilen hesap adı, bağlanan adres, gözlemlenebildiği yerde bir bağlantı noktası ve bir bayt sayısı içerir. Hiçbir içerik alanı yoktur — boş bırakılmış bir alan da değil, hiç var olmayan bir alan. Günlükleyiciye mesaj metni aktarmaya çalışan bir geliştirici, modülün bunu reddettiğini görecektir ve test paketinde bunun kalıcı olarak böyle kalmasını sağlayan bir test mevcuttur.

**Kayıtların süresi dolar ve imha edilir.** Saklama süresi gün cinsinden yapılandırılır ve her iki uçtan sınırlandırılır; süresi dolan dosyalar günlük döngüde ve başlangıçta tekrar silinir, böylece bir ay kapalı kalan bir sunucu arayı kapatmayı öylece unutmaz. Silme geçişi kasıtlı olarak hız sınırlandırmasına tabidir — her çalışmada en fazla birkaç dosya — çünkü ileriye sıçrayan bir sistem saati, naif bir temizleyici için bir yılın geçmesinden ayırt edilemezdir ve güvenli başarısızlık (safe failure), bir arşivi tek bir geçişte silip atmak yerine yavaşça silmek ve anomaliyi günlüğe kaydetmektir. Uzun süre çevrimdışı kalmış bir sunucu bu nedenle arayı anında değil, ardışık çalışmalar boyunca kapatır ve bunu yaparken standart hata üzerinden bunu belirtir.

**Yönetimsel eylemler iz bırakır.** Operatör aracı (`narchat_operator.py`) çevrimdışı çalışır, yazılı bir gerekçe olmadan hareket etmeyi reddeder ve her eylemi bir denetim günlüğüne yazar. Bir hesabı askıya alabilir veya depolanan bir blobu silebilir. Bir mesajı okuyamaz, çünkü bu sistemdeki hiçbir şey bunu yapamaz.

Bir okuyucunun buradan çıkarması gereken özet: **uyumlu sürüm, bir mesajın taşındığını ve kaç bayt olduğunu kaydeder. Ne söylediğine dair tek bir baytı bile asla kaydetmemiştir ve yapısal olarak kaydedemez.**

## 5. Bu neyi ölçer

Genel iddia mütevazıdır ve bizce faydalıdır: **bir yargı alanı bir mimari üzerinde parmak izi bırakır ve bu parmak izi üzerinde tartışılmak yerine ölçülebilir.**

Bizim durumumuzda bunun küçük, tamamen eklemeli ve içerik-kör olduğu ortaya çıktı. Bu, tek bir ülkeden ve küçük bir sistemden elde edilen tek bir veri noktasıdır ve gereğinden fazla anlam çıkarılmamalıdır — farklı bir yargı alanı veya aynı yargı alanının farklı bir okuması çok daha ağır bir iz bırakabilir. Ancak iddianın yanlışlanabilir versiyonu, herkesin kontrol edebileceği bir biçimde buradadır ki bu da tartışmanın genellikle sunduğundan çok daha fazlasıdır.

## 6. Peki hangisini çalıştırmalısınız?

Dürüst olmak gerekirse: bu, nerede olduğunuza ve ne yaptığınıza bağlıdır ve bu sorunun en önemli kısımları bizim cevap vermeye yetkili olmadığımız kısımlarıdır. Kendiniz ve tanıdığınız bir düzine insan için bir sunucu çalıştırmak ile yabancılara bir hizmet sunmak, incelediğimiz her yargı alanında farklı durumlardır.

Ancak işte en önemli olan ve bir belgenin en altına gömülmemesi gereken kısım:

**Hiçbir kayıt tutmayan sürüm bir düşünce deneyi değildir ve tarihi bir eser değildir. O, varsayılan daldır.** Eksiksizdir, çalışır, `git clone`'un size verdiği şeydir ve lisansı MIT'dir. İndirin, yedek bir makineye kurun ve tam olarak seçtiğiniz kişilerle konuşun. Bu depodaki hiçbir şey bunun için kimsenin iznini gerektirmez ve ikinci dalın hiçbir kısmı bunu geri almaz.

Uyumlu sürüm bir geri adım atma ve bir taviz değildir. Bu bir araştırma sonucudur: ülkesinin yükümlülüklerine karşı hesap verebilir olmak isteyen bir operatörün, kullanıcılarından gizlilikten vazgeçmelerini istemeden bu hesap verebilirliği inşa ettiğinde neye benzediğidir. Onu yayınladık çünkü asıl ilginç olan kısım bu ölçümdür ve çünkü diğer seçenek — sessizce tek bir sürüm sunmak ve insanların diğerinin imkansız olduğunu varsaymasına izin vermek — daha az dürüstçe bir davranış olurdu.

---

*Daha fazla okuma için: her iki dalı da kendiniz çalıştırmak için [SELF-HOSTING.md](SELF-HOSTING.md), bunların neden var olduğunu anlamak için [../MANIFESTO.md](../MANIFESTO.md) ve hukuki araştırmanın tamamını, alıntılarıyla ve belirsizlikleri belirsizlik olarak işaretlenmiş şekilde okumak için eşlik eden makale.*
