# Panjur Kesim Optimizasyonu

`PanjurKesim.html` — çift tıklayıp açılan, kurulum ve internet gerektirmeyen tek dosyalık araç.
İmalat programından gelen proje dosyalarını okur; lamel, dikme, alt parça ve tambur borusu için
**demet kesim planı** üretir ve ustanın alıştığı düzende Excel verir.

## Kullanım

1. `PanjurKesim.html` dosyasını tarayıcıda açın (Chrome/Edge).
2. Proje dosyalarını sürükleyip bırakın — **birden fazla proje birlikte optimize edilir**:
   - `000000000021542_İmalat.csv` (imalat programının ham çıktısı; proje no dosya adından okunur)
   - aynı yapıdaki `.xlsx`
   - elle düzenlenmiş, bölüm başlıklı `İMALAT LİSTESİ.xls`
   Aynı proje ikinci kez eklenirse atlanır.
3. **Müşteri adı, tarih ve not** (DETAY/MNB gibi) elle girilir — bu bilgiler dosyada yoktur; bir kez
   girilen bilgiler aynı proje no için hatırlanır ve çıktının sağ üst köşesine yazılır.
4. **Parçalar ve demet** tablosunda ne kesileceğini seçin. Lamel / dikme / alt parça / tambur
   otomatik işaretli gelir; fitil ve tanınmayan profiller kapalı gelir. Her parça için çubuk boyu ve
   demet (tek seferde kesilen en fazla adet) ayrı ayrı ayarlanır ve hatırlanır.
5. **Optimize et** → her parça için ilerleme; ardından sonuç tabloları. Bir parça
   optimize edilemezse diğerleri yine de çalışır; sebebi "Optimize et"in altındaki
   uyarı panelinde kalıcı olarak yazar.
6. **Excel indir** → `MÜŞTERİ KESİM PLANI.xlsx`.

Sağ üstteki düğme temayı değiştirir (sistem → açık → koyu) ve seçimi hatırlar.

### Dosya biçimleri

ERP ham çıktısı başlıksız 7 sütundur ve noktalı virgülle ayrılır (Windows-1254 kodlaması):

```
74;TAP.P.SD.B06.55E;AS 55 EKO ALÜMINYUM LAMEL;BEJ GRİ;39;1.274;6,59932
poz;stok kodu;açıklama;renk;adet;ölçü;ağırlık
```

Ölçüdeki nokta **binlik ayırıcıdır** (`1.274` → 1274 mm). Ölçüsü olmayan satırlar (motor, kaset,
rulman, tapa, askı…) optimize edilmez; dosya kartında "ölçüsüz" olarak listelenir.
Eski Excel dosyalarındaki `46143 → 1005` tarih bozulmaları otomatik düzeltilir ve uyarı olarak gösterilir.

Parça türü **stok kodundan değil açıklamadan** belirlenir; böylece stok kodu projeden projeye
değişse de (renk kodu kodun içinde: `…B06…` / `…V16…`) aynı profil doğru eşleşir. Birleştirme
anahtarı **profil adı + renk**tir: aynı profilin farklı renkleri ayrı optimize edilir, renksiz
parçalar (tambur borusu) projeler arasında birleşir.

## Kesim modeli

- **Grup** = bir demetle yapılan sıralı kesimler. Demet, gruptaki en büyük adetle başlar (≤ demet
  sınırı) ve yalnızca **küçülür**; kenara ayrılan çubuklar aynı boyda **artık demetleri** oluşturur.
- Sığma şartı: `Σ ölçü + kesim sayısı × testere payı ≤ çubuk boyu − emniyet payı`.
- Aynı ölçüdeki pozlar tek kesimde birleşir (`6 + 105 | 39 + 11 | 1494`), aynı poz aynı grupta
  birden çok adımda kesilebilir (`34 → 17 + 17`). Bir poz varsayılan olarak tek grupta kalır
  (deneysel "poz bölme" seçeneği kapalı).
- **KALANLAR**: gruba girmeyen pozlar; grupların artık demetlerinden kesilir. Araç bunun gerçekten
  mümkün olduğunu doğrular ve "ARTIK PLANI" sayfasında hangi artıktan ne kesileceğini yazar.
- Amaç: `10·kesim + 4·çubuk + 1·demet bozma + 3·KALANLAR pozu` (+ küçük fire cezası).
- **Sınırlar.** Bir grubun bütün adımları aynı çubuklardan kesilir, yani
  `adım sayısı × (ölçü + testere payı)` çubuğa sığmak zorundadır. Bir pozun adedi
  bu sınırı aşarsa (özellikle demet küçültüldüğünde) poz **zorunlu olarak** ayrı
  demetlere bölünür — fiziksel olarak zaten ayrı demetlerdir — ve bu durum uyarı
  panelinde poz poz bildirilir. Çubuğa hiç sığmayan bir ölçü varsa araç tahmin
  yürütmez: hangi pozun kaç mm olduğunu ve o çubuktan en fazla kaç mm kesilebileceğini
  yazıp durur.

### Öncelik ağırlıkları

Dört sayı neyin pahalı sayılacağını belirler; önemli olan **oranlarıdır**:

| Ağırlık | Ne sayılıyor | Büyütünce |
|---|---|---|
| Kesim | Testerenin her inişi (50 lameli tek seferde kesmek de 1 kesim) | Gruplar kalabalıklaşır, toplam kesim azalır |
| Çubuk | Kullanılan her tam boy çubuk | Çubuklar daha dolu kullanılır, fire düşer, kesim artar |
| Demet bozma | Grup içinde çubuk kenara ayırma (50 → 35) | Adetleri yakın pozlar aynı gruba toplanır |
| KALANLAR | Gruba girmeyip artıklardan kesilecek her poz | KALANLAR listesi kısalır |

Arayüz dört hazır ayar sunar (Dengeli 10/4/1/3 · İşçilik öncelikli 30/2/1/3 · Malzeme öncelikli
4/12/1/3 · KALANLAR olmasın 10/4/1/15), girilen değerleri "1 kesimden kaçınmak için en fazla 2,5
çubuk harcanır" gibi cümlelere çevirir ve **Ağırlıkları karşılaştır** düğmesiyle en büyük parçayı
her ayarla kısa süre çözüp sonuçları yan yana koyar. 21542 projesinde (lamel, tam koşu) uçlar:

| Ayar | Çubuk | Kesim | Fire |
|---|---|---|---|
| İşçilik öncelikli 30/2 | 1.452 | 148 | %4,0 |
| Dengeli 10/4 | 1.436 | 156 | %2,9 |
| Malzeme öncelikli 4/12 | 1.423 | 166 | %2,1 |

Yani uçlar arası fark ≈ 18 kesim ↔ 29 çubuk (≈190 m lamel). Sonuç ekranında maliyetin kalemlere
dağılımı da yazılır.

## Excel çıktısı

| Sayfa | İçerik |
|---|---|
| LAMEL / DİKME / ALT PARÇA / TAMBUR … | Gruplar (POZ · ADET · ÖLÇÜ, `=SUM` satırı, çubuk/kesim notları), sonda KALANLAR. Sağ üstte proje bloğu. Dikme ve tekli parçalar iki sütunlu. Aynı türden birden fazla renk varsa sayfa adına renk eklenir. |
| ÖZET | Parça başına çubuk boyu, demet, çubuk, alt sınır, fire %, kesim, demet bozma, grup, KALANLAR; parametreler ve projeler. |
| POZ LİSTESİ | Her pozun hangi grupta kesildiği (filtrelenebilir). |
| ARTIK PLANI | KALANLAR için artık demeti → kesim eşleşmesi. |

## Örnek sonuçlar

21542 numaralı proje (156 poz) — `ÖRNEK ÇIKTI - 21542 (araç).xlsx`:

| Parça | Parça adedi | Çubuk | Alt sınır | Fire | Kesim |
|---|---|---|---|---|---|
| Lamel | 5.916 | 1.429 | 1.394 | %2,5 | 154 |
| Dikme | 312 | 104 | 101 | %3,7 | 156 |
| Alt parça | 156 | 38 | 37 | %3,3 | 156 |
| Tambur | 156 | 48 | 44 | %9,1 | 156 |

Elle yapılmış eski örnekle karşılaştırma (3 proje, 158 lamel pozu): insan 962 çubuk / 184 kesim /
≈%10 fire → araç ≈900 çubuk / ≈130 kesim / ≈%4 fire.

## Geliştirme

```
src/
  optimizer.js   çekirdek motor (grup derleyici, artık planlayıcı, tavlama benzetimi, doğrulayıcı)
  parser.js      dosya ayrıştırıcı (CSV + Excel, ERP ham ve başlıklı düzen)
  excel-out.js   Excel yazıcı (ExcelJS)
  app.js         arayüz, paralel Web Worker koşuları
  index.html     arayüz şablonu (geliştirme için; worker ve dosya okuma için http gerekir)
  build.py       tek dosyalık PanjurKesim.html üretir  →  py build.py
  test/run.sh    headless Chrome ile testler  →  bash run.sh "iters=100000"
                 (Windows / Linux / macOS; tarayıcı CHROME=... ile verilebilir)
                 "xlsx=1" örnek Excel, "csvxlsx=1" CSV projesinden Excel, "only=csv&mat=lamel" tek parça
  test/000000000021999_İmalat.csv   birleştirme testleri için türetilmiş sahte proje
  lib/           xlsx.full.min.js (SheetJS 0.18.5), exceljs.min.js (4.4.0)
```

Arayüz `PanjurKesim.html?selftest=1` ile kendi kendini test eder; `?debug=1` ile iç durum
`window.__panjur` üzerinden okunabilir.
