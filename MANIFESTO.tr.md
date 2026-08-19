# NarChat Manifestosu

## Bilgi insanlık içindir. Gizlilik herkesin hakkıdır.

Bu iki cümle birer süs değil. Bu deponun herkese açık olmasının nedeni onlardır ve o kadar sık çatışırlar ki, bunu nasıl çözdüğümüzü söylemeye değer: *bildiğimiz* her şey — sistemin nasıl çalıştığı, neyi koruduğu, nerede başarısız olduğu — herkese aittir, ve bu yüzden hepsi burada. *Söyledikleriniz* ise yalnızca size aittir; işte bu yüzden onu okuyamayacak bir şey inşa ettik ve sonra bir vaat yerine kanıtını yayınladık.

## Koda güvenin. Bize değil.

Bir gizlilik aracının size sunabileceği en dürüst şey, ona güvenmemeniz için bir nedendir.

Sizden mesajlarınızı asla okumayacak iyi insanlar olduğumuza inanmanızı istemiyoruz. Bunu isteyen herkesten şüphelenin — kontrol edemeyeceğiniz bir vaat vaat değil, bir dilektir. Bunun yerine size kodu, testleri ve sınırları veriyoruz. **İnancınızı istemiyoruz. Doğrulamanızı istiyoruz.**

Bu depoda, iki gerçek tarayıcı arasında gerçek bir mesaj gönderen, ardından sunucunun diskteki kendi deposunu açıp o mesajı düz metin olarak arayan bir test var. Bulursa, test başarısız olur. Kendiniz çalıştırın: `python3 test/e2e_roundtrip.py`. Bütün tezimiz budur ve yaklaşık otuz saniye sürer.

## Nereden çıktı

Bu bir ürün planı olarak başlamadı. Birbirine güvenen ve sıradan tek bir şey isteyen küçük bir grupla başladı: birbirlerine söylediklerini yalnızca kendilerinin görmesi. Basit bir istek — ve bugünün internetinde şaşırtıcı derecede nadir.

O yüzden onu evde yaptık. Sıradan bir bilgisayarda; veri merkezi olmadan, yatırımcı olmadan ve aylık abonelik olmadan. Bir alan adı ve elektrik faturası dışında, maliyeti neredeyse sıfırdı. Bunu bir özür olarak söylemiyoruz. Bir iddia olarak söylüyoruz: **iletişim gizliliği çözülmüş bir mühendislik problemidir.** Onu nadir kılan matematiği değil. Birinin oturup bunu açıkça, kontrol edilebileceği bir yerde yapması gerekmesidir.

Bunun bir geleneği var — meraklı amatörlerin elektriği kendi evlerinde çözdükleri o gelenek. Faraday'ın laboratuvarı mütevazıydı; yaptığı iş değildi. Biz de o geleneğe ait olmak istiyoruz: **kendin yap, kanıtla, herkese aç.**

## Neye inanıyoruz ve ne inşa ettik

**Sunucu, taşıdığını açamayan bir kurye olmalıdır.** Mesajlarınız cihazınızda şifrelenir ve yalnızca alıcının cihazında çözülür. Onları okuyacak anahtar sunucuya hiç ulaşmaz. Bu bizim lütfedip seçtiğimiz bir ayar değil; mimarinin kendisidir ve bizim sözümüzle değil, yukarıdaki testle kanıtlanabilir.

**Sizden kim olduğunuzu sormuyoruz, çünkü cevabı koyacak hiçbir yer inşa etmedik.** Telefon numarası yok, e-posta adresi yok, rehber taraması yok, konum yok, reklam kimliği yok, analitik yok. Bunlar kapattığımız düğmeler değil. Bu alanlar kodda hiç yok. Onlara yönelik bir talebe uyamayız, çünkü onlara hiç sahip olmadık. Bize verdiğiniz tek şey, uydurduğunuz bir kullanıcı adı ve cihazınızdan asla çıkmayan bir paroladır.

**Açıklık bizim için bir güvenlik stratejisidir, bir pazarlama jesti değil.** Kimsenin inceleyemediği küçük, şifreli bir sistem gizlenerek güvenli hale gelmez — gizlenerek *şüpheli* hale gelir. Görünür olmak ve herkes için görünür olmak, bir gizlilik aracını ve onu kullanan insanları koruyan şeyin bir parçasıdır. Bu öğrendiğimiz en aykırı şeydi ve eşlik eden makale bunun nedenini belgeliyor.

## Size yalan söylemeyeceğiz

Dürüstlük güvenin motorudur, bu yüzden sınırlar da en az özellikler kadar açıkça belirtilmiştir:

- **İçerik: kimse okuyamaz, biz dahil.** Bunda taviz yok, ve bunun bir testi var.
- **İleri gizlilik yok.** Eğer bugünün anahtarı çalınırsa, geçmiş mesajlar açılabilir. Bunun üzerinde çalışıyoruz ve olana kadar "var" demeyeceğiz.
- **Sunucu kimin kiminle, ne zaman konuştuğunu görür.** Ne konuştuğunu değil — asla ne konuştuğunu değil — ama iletişim modeli, sunucuyu kim işletiyorsa ona görünürdür. Bunu saklamıyoruz; bunu azaltmak yol haritasındadır, şimdiki zamanda değil.
- **Arama sinyalleşmesi şifreli değildir.** Ses ve görüntü akışları şifrelidir, ancak kurulum trafiği değildir ve kötü niyetli bir sunucu bir aramaya müdahale etmeye çalışabilir. Mesajlaşma güvencelerimiz ile arama güvencelerimiz aynı güvence değildir ve birinin diğerinin itibarını ödünç almasına izin vermeyeceğiz.
- **Bu bir pilottur.** Haftalarca gerçek insanlar arasında, gerçek cihazlarda gerçek konuşmalar taşıdı. Operasyon ekibi olan, sağlamlaştırılmış bir hizmet değildir.

Mükemmellik iddia eden bir sistem yerine kendi sınırlarını sayabilen bir sistemi tercih edin. İlk kesintide çökecek bir anlatı kurmuyoruz.

## Neden burada iki sürüm var

Size sadece ilkini vermeyi tercih ederdik.

Varsayılan dal, sistemin tasarlandığı halidir: hiçbir bağlantı kaydı tutmaz, çünkü onları tutacak kodu hiç yazmadık. O sürüm eksiksizdir, çalışır ve bu deponun açıldığı sürümdür.

Sonra pek çok gizlilik projesinin kaçındığı bir soruyu sorduk: başkaları için böyle bir hizmeti *işleten* birinden gerçekte ne istenir? Yasayı varsaymak yerine okuduk. Bulduğumuz şey bizi şaşırttı. Okuduğumuz yükümlülükler mesajlarınızı istemiyor. Bağlantı kayıtlarını — birinin bağlandığını, ne zaman bağlandığını ve ne kadar verinin hareket ettiğini — istiyor. İstedikleri şey hiçbir zaman şifreleme değildi.

Bu yüzden şifrelemeyi zayıflatmadık. Ayrı bir dalda uç noktaları araçlandırdık ve farkı ölçtük: **üretimde çalışan bir dosya değişti, doksan bir satır eklendi, iki satır değiştirildi ve kriptografik çekirdek tek bir baytına kadar aynı kaldı.** Bunu tek bir komutla — `git diff paper-reference compliance-fork` — kontrol edebilirsiniz, ki bunu bu şekilde yayınlamanın amacı da budur.

İkisi de burada, çünkü ikisi de gerçek. Farklı ülkeler ve farklı roller farklı yükümlülükler taşır ve hangisinin sizin için geçerli olduğunu size söyleyemeyiz — biz mühendisiz, bu hukuki tavsiye değildir ve makale de hüküm vermeksizin yasanın ne dediğini aktarır. Size söyleyebileceğimiz şey şudur: **hiçbir şey toplamayan sürüm, sakladığımız bir düşünce deneyi değildir. Varsayılan daldır. İndirin. Boştaki herhangi bir makinede çalıştırın. Tam olarak seçtiğiniz insanlarla konuşun ve başka hiç kimseyle konuşmayın.** Bu depodaki hiçbir şey, bunun için kimseden izin istemez.

## Alın

[`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) içinde, boşta duran bir bilgisayardan, sizin ve seçtiğiniz insanlar için çalışan özel bir mesajlaşma uygulamasına giden yolu adım adım anlatan bir rehber var. Eski bir dizüstü bilgisayar yeterlidir — bizimki 2012 model bir masaüstü bilgisayardı ve makale bunu saklamak yerine model numarasıyla söylüyor.

Bunların hiçbirisi için bize ihtiyacınız yok. Bizde açılacak bir hesap, istenecek bir anahtar, satın alınacak bir paket ya da alınacak bir izin yok. Lisans MIT'dir: kullanın, değiştirin, çalıştırın, dağıtın. Proje yarın ortadan kaybolsa bile kopyanız çalışmaya devam eder, çünkü o her zaman sadece bir kopyaydı.

## Kalanını bizimle inşa edin

Bu, tek kişilik, sıfır bütçeli bir pilottur ve geriye kalan zor kısım kriptografi değil. İleri gizliliktir. Üstveriyi küçültmektir. Ve hiçbir kripto satırının bugüne dek çözemediği o sorundur: **insanları gerçekten aynı yerde buluşturmak.** Çalışan güvenli iletişimi kurmak işin kolay yarısıymış; zaten başka bir yerde yaşayan konuşmaları taşımak ise zor olanı.

Eğer bu sizin de derdinizse — kod açık, kapı da açık. Bunu bir mutfak masasında tek bir kişinin yapabileceğinden daha ileriye taşımak isteyen geliştiriciler, araştırmacılar ve destekçiler arıyoruz.

## Bağlantılar

- **Kaynak kodu:** https://github.com/NarchTech/narchat
- **Makale (EN + TR):** [doi:10.5281/zenodo.22017687](https://doi.org/10.5281/zenodo.22017687)
- **Bu yazılımın arşivi:** [doi:10.5281/zenodo.22017587](https://doi.org/10.5281/zenodo.22017587)
- **Lisans:** MIT
- **Kendiniz çalıştırın:** [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md), veya [README](README.md) içindeki üç komut.
- **İletişim:** [depoda](https://github.com/NarchTech/narchat/issues) bir konu açın; güvenlik konuları için [SECURITY.md](SECURITY.md).

---

*Koda güvenin, bize değil. İnanmayın — kurun, okuyun, kırın. Bir gizlilik aracının size gösterebileceği en büyük saygı budur.*
