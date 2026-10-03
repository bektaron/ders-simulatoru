# Not Simülatörleri

İki öğrenci için not / bac simülatörü. **Hangi derste kaç puan, genel ortalamayı ve mention'ı nasıl değiştirir?** sorusunu canlı yanıtlar. Statik site, bağımlılıksız (vanilla HTML/CSS/JS), GitHub Pages'ten yayınlanır.

- **Öğrenci A — Terminale** (`docs/a-terminale.html`): bac 2027. Kilitli 1ère notları + Terminale senaryoları, 6–20 eşik göstergesi, "Emek nereye?", "Eşiğe ne lazım?", bu dönemin notları.
- **Öğrenci B — Seconde** (`docs/b-seconde.html`): trimestre ortalaması (geçici "ya şu sınavdan X alırsa" notlarıyla) + bac 2029 projeksiyonu (üç spécialité, üç "bırakma" senaryosu yan yana).

## Gizlilik modeli — iki repo

| Repo | Görünürlük | İçerik |
|---|---|---|
| **bu repo** (`ders-simulatoru`) | public, Pages açık | kod, katsayı config'leri, JSON şeması, **uydurma** örnek veri |
| **veri reposu** (`ders-simulatoru-veri`) | private, Pages kapalı | `a.json`, `b.json` — gerçek notlar |

- Bu repoda gerçek not, ad, okul veya öğretmen adı **bulunmaz**. Öğrenciler arayüzde "Öğrenci A / B" olarak anılır; görünen ad yalnız veri dosyasındaki `displayName`'den gelir.
- Site veri reposunu tarayıcıdan **GitHub REST API + fine-grained salt-okunur token** ile okur. Token cihaz başına bir kez `index.html` kurulum ekranından girilir, yalnız tarayıcıda (localStorage ya da sessionStorage) tutulur; URL'ye, konsola, hata metnine yazılmaz.
- Site veri reposuna **asla yazmaz**. `scripts/readonly-check.mjs` kodda `PUT/POST/PATCH/DELETE` görürse CI kırılır. Veri reposuna yalnız Cowork'teki Claude yazar; bu repo ve Claude Code veri reposuna dokunmaz.
- Token yoksa site **demo modunda** açılır (örnek veri, "ÖRNEK VERİ" bandı). Ağ yoksa son başarılı okuma önbellekten gösterilir ("çevrimdışı" bandı). Veri 7 günden eskiyse bant sarıya döner.
- ⚠ `kullanici.github.io` tek bir origin'dir: aynı hesabın **diğer Pages siteleri** localStorage'daki token'ı okuyabilir. Bu yüzden token salt-okunur, tek repoya kısıtlı ve 90 günlüktür; kurulum ekranındaki "yalnız bu sekme" seçeneği token'ı sessionStorage'a koyar. Özel alan adı bu riski kaldırır.

## Yapı

```
docs/                       GitHub Pages kaynağı (main → /docs)
  index.html + index.js     giriş, durum kartları, token kurulumu
  a-terminale.html/.js      Öğrenci A
  b-seconde.html/.js        Öğrenci B (iki sekme)
  engine.js                 hesap motoru — saf, DOM'suz, Node ile test edilir
  data.js                   veri katmanı — salt-okunur GitHub API, token, önbellek, modlar
  validate.js               JSON Schema alt-küme doğrulayıcı + config çapraz kontrolü
  ui.js · styles.css        ortak bileşenler, açık/koyu tema
  config/                   bac-2027.json · seconde-2026.json · bac-2029.json · data-source.json
  schema/notes.schema.json  veri dosyası şeması (draft 2020-12)
  examples/                 a.example.json · b.example.json — UYDURMA, "example": true
tests/                      engine.test.mjs · data.test.mjs (node --test)
scripts/                    privacy-check.mjs · readonly-check.mjs
.github/workflows/ci.yml    test + gizlilik grep'i + salt-okunur denetimi
```

## Çalıştırma

- **Yayın:** repo Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
- **Yerel:** `npm run serve` (→ http://localhost:8080). Sayfalar ES module + `fetch` kullanır; `file://` ile açılmaz.
- **Test ve denetimler:** `npm run check` (= `npm test` + gizlilik denetimi). Geçmiş dahil: `npm run privacy:history`. Salt-okunur denetimi: `node scripts/readonly-check.mjs`.

Gereksinim: Node ≥ 22. Bağımlılık yok.

## Veri reposu kurulumu

1. `ders-simulatoru-veri` adıyla **private** repo açın (Pages kapalı). İçerik: `a.json`, `b.json`, tek satırlık `README.md` ("Kişisel veri. Paylaşmayın.").
2. Her güncelleme ayrı commit: `notlar: A+B · Pronote 2026-10-03 10:35`.
3. Dosyalar `docs/schema/notes.schema.json`'a uymalı; `subjectId` değerleri aşağıdaki kimlik tablosuyla birebir eşleşmeli. Yerelde doğrulamak için:
   ```sh
   node --input-type=module -e "
   import { validateNotes } from './docs/validate.js';
   import { readFileSync } from 'node:fs';
   const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
   console.log(validateNotes(j(process.argv[1]), j(process.argv[2]), j('docs/schema/notes.schema.json')));
   " /yol/a.json docs/config/bac-2027.json
   ```
4. Veri kaynağı (`owner`, `repo`, `branch`, dosya adları) `docs/config/data-source.json`'da.

### Token (veli üretir, siteye kendisi girer)

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**: Repository access **Only select repositories → yalnız veri reposu**; Permissions → **Contents: Read-only**; Expiration **90 gün**. Token'ı `index.html` kurulum ekranına yapıştırın. "Bu cihazdan çık" düğmesi token'ı ve önbelleği siler.

## Veri dosyası şeması (özet)

```json
{
  "schemaVersion": 1, "student": "A", "displayName": "…", "track": "bac",
  "updatedAt": "2026-10-03T10:35:00+03:00", "source": "Pronote · elle okuma",
  "period": { "type": "semestre", "index": 1 },
  "locked":   [ { "id": "fr_e", "note": 12, "coef": 5, "source": "Cyclades 2026-07-03" } ],
  "grades":   [ { "date": "2026-09-21", "subjectId": "spe1", "label": "DS 1", "note": 14, "outOf": 20, "coef": 1, "classAvg": 11.2 } ],
  "upcoming": [ { "date": "2026-10-09", "subjectId": "spe1", "label": "DS 2" } ],
  "scenarios": { "kotu": { "spe1": 9 }, "gercekci": { "spe1": 12 }, "hedef": { "spe1": 15 } },
  "subjectLabels": { "spe1": "…", "spe2": "…", "spe_drop": "…", "lvb": "…" },
  "options": { "lvc": false },
  "notes": [ "Okuma notu…" ]
}
```

Kurallar: `grades` ham Pronote notudur (`note`/`outOf`, not katsayısı, varsa sınıf ortalaması; `null` = Abs). Ders ortalaması ve mention **dosyaya yazılmaz**, simülatör hesaplar. `locked` yalnız A'da. `scenarios` isteğe bağlı: yoksa "gerçekçi" ders ortalamalarından türetilir; "kötü/hedef" yoksa gerçekçi ∓ 2. `subjectLabels` genel yuva adlarının yerine görünen adı verir (gerçek spécialité adları yalnız private dosyada). `grades[].period` yoksa `period.index` sayılır (B'de trimestre karşılaştırması için). `track: "ib"` ise B'nin bac sekmesi gizlenir.

### Ders kimlikleri

**A — bac-2027** (ve bac-2029 aynı yapı)

| id | ders | kats. | durum |
|---|---|---|---|
| `fr_e` · `fr_o` · `ma_a` | Français écrit · oral · Maths anticipées | 5 · 5 · 2 | kilitli (1ère sınavları) |
| `hg1` · `lva1` · `lvb1` · `es1` · `emc1` | HG · LVA · LVB · Ens. sci. · EMC (1ère) | 3 · 3 · 3 · 3 · 1 | kilitli |
| `spe_drop` | bırakılan spécialité (1ère) | 8 | kilitli |
| `spe1` · `spe2` | spécialité 1 · 2 (Tle sınavı) | 16 · 16 | değişken |
| `philo` · `go` | Philosophie · Grand oral | 8 · 8 | değişken |
| `eps` · `hg` · `lva` · `lvb` · `es` · `emc` | Tle kontrol continu | 6 · 3 · 3 · 3 · 3 · 1 | değişken |
| `lvc1` · `lvc` | LVC opsiyonu (1ère · Tle) | 2 · 2 | opsiyon, teyitsiz, varsayılan kapalı |

Toplam 100 = 33 kilitli + 67 değişken (config'ten okunur). Kaynak: okulun Ekim 2026 veli toplantısı sunumu.

**B — seconde-2026**: `fr maths hg lva lvb ses snt pc svt eps emc` + opsiyon `lvc euro sl`. Tüm katsayılar 1 (**okuldan teyit edilmeli**; `docs/config/seconde-2026.json`'da düzenlenir).

## Motor sözleşmesi (`docs/engine.js`)

```js
weightedAverage([{note, outOf, coef}])          // → /20 ölçeğinde number | null
finalBac(config, notes)                         // → {final, lockedAvg, restAvg, totalCoef, …}
mention(final, config)                          // → {label, level, threshold, tone}
nextThreshold(final, config)                    // → {threshold, gapPoints, gapWeighted} | null
requiredNote(config, notes, subjectId, target)  // → number | 'unreachable' | 'safe'
leverage(config)                                // → [{subjectId, coef, deltaPerPoint}] katsayıya göre azalan
termAverage(config, gradesBySubject)            // → {subjects, general}
specialiteScenarios(config, baseNotes, candidates)
buildBacNotes(config, data, 'kotu'|'gercekci'|'hedef')
```

Mention eşikleri config'ten: 10 Admis · 12 Assez bien · 14 Bien · 16 Très bien · 18 Très bien + félicitations; 8–10 rattrapage. Final ortalama iki ondalığa yuvarlanır.

## CI gizlilik denetimi

`scripts/privacy-check.mjs` yasaklı kişisel terimleri **repoya yazmadan** arar: terimler GitHub Actions secret'ı **`PRIVACY_TERMS`** (virgülle ayrılmış) ve yerelde gitignored `.privacy-terms.local` dosyasından okunur; diakritik/büyük-küçük harften bağımsız eşleşir. Secret tanımlı değilse adım uyarı verir ve geçer. Her zaman çalışanlar: e-posta, okul Pronote sunucu adı ve telefon desenleri; not verisi taşıyan JSON'ın yalnız `docs/examples/*.example.json` içinde ve `"example": true` ile olması; `*.local.*` dosyalarının izlenmemesi. CI `--history` ile tüm geçmişi de tarar.

**Kurulum:** repo Settings → Secrets and variables → Actions → `PRIVACY_TERMS`.

## Açık sorular

- Seconde ders katsayıları (karneden okunacak).
- LVC opsiyonunun bac katsayısı ve bac'a girip girmediği (okul cevabı).
- Okulun sunduğu spécialité listesi (`bac-2029.json` ulusal listeyi taşır).

## Kapsam dışı

Pronote entegrasyonu · otomatik not çekme · sunucu / backend · analitik veya izleme · üniversite başvuru takibi · IB simülasyonu · not trendi grafiği.
