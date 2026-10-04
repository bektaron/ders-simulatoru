# CLAUDE.md — bu klasörde çalışan Claude için el kitabı

Bu klasör (`simulator/`) iki öğrenci için not / bac simülatörüdür: statik site, bağımlılıksız,
yerel sunucudan çalışır. Kod public `bektaron/ders-simulatoru` reposundan türedi; **artık
yerel kullanım esastır**, web yayını (GitHub Pages + token) terk edildi ama kod hâlâ destekler.

Üstadım'a "Üstadım" diye hitap et; varsayılan dil Türkçe.

## 1. Senin işin (Cowork Claude)

1. Pronote'tan elle okunan notları **`data/a.json`** (Öğrenci A, Terminale) ve **`data/b.json`**
   (Öğrenci B, Seconde) dosyalarına yazmak. Simülatör bu dosyaları doğrudan okur.
2. Her yazımdan önce `npm run validate` (= `node scripts/validate-data.mjs data/a.json data/b.json`)
   çalıştır; hata varsa dosyayı kaydetme.
3. Her güncellemede `updatedAt` alanını o anki zamana çek (ISO 8601, `+03:00`). Site 7 günden
   eski veriyi sarı bantla gösterir.
4. Gerçek notları Üstadım'a göstermeden dosyaya yazma (memo §5 kuralı).
5. **Hesaplanmış alan yazma**: ders ortalaması, genel ortalama, mention dosyaya girmez;
   simülatör hesaplar. Dosya yalnız ham not taşır (not / baraj / katsayı / sınıf ortalaması).

## 2. Gizlilik kuralları (pazarlık dışı)

- Gerçek ad, not, okul adı, öğretmen adı yalnız `data/` altında olur. `data/*.json` `.gitignore`
  ile git dışıdır; **asla commit edilmez.**
- `docs/examples/*.example.json` uydurma kalır; gerçek değer kopyalanmaz.
- Config'lerde (`docs/config/*.json`) gerçek spécialité adı yazılmaz; yuvalar `spe1`, `spe2`,
  `spe_drop`'tur. Gerçek adlar `data/a.json` → `subjectLabels` ile verilir.
- Bu klasör GitHub'a push edilmeyecek. Yine de bir gün push gerekirse önce
  `PRIVACY_TERMS="…" node scripts/privacy-check.mjs --history` çalıştır (terimler memoda; dosyaya yazılmaz).
- Pronote'a bağlanma, otomatik not çekme, giriş bilgisi saklama yok. Pronote salt-okunur ve elle.

## 3. Çalıştırma

```sh
npm run serve      # http://localhost:8080/  → docs/ (Python 3; Windows: python -m http.server 8080)
npm test           # node --test — motor, şema, veri katmanı (31 test)
npm run validate   # data/a.json ve data/b.json şema + config kontrolü
npm run check      # test + gizlilik denetimi
```

Sayfalar `file://` ile açılmaz (ES module + fetch); sunucu şart. Okuma sırası:
**`data/<a|b>.json` → GitHub veri reposu (token varsa) → `docs/examples` (ÖRNEK VERİ bandı)**.

## 4. Veri dosyası — `data/a.json` iskeleti

```json
{
  "schemaVersion": 1,
  "student": "A",
  "displayName": "<görünen ad>",
  "track": "bac",
  "updatedAt": "2026-10-04T18:30:00+03:00",
  "source": "Pronote · elle okuma",
  "period": { "type": "semestre", "index": 1 },
  "subjectLabels": { "spe1": "<spécialité 1 adı>", "spe2": "<spécialité 2 adı>", "spe_drop": "<bırakılan spécialité>", "lvb": "<LVB dili>", "lvb1": "<LVB dili> 1ère", "lvc": "<LVC dili>", "lvc1": "<LVC dili> 1ère" },
  "options": { "lvc": false },
  "locked": [
    { "id": "fr_e", "note": 0, "coef": 5, "source": "Cyclades <tarih>" },
    { "id": "fr_o", "note": 0, "coef": 5, "source": "Cyclades <tarih>" },
    { "id": "ma_a", "note": 0, "coef": 2, "source": "Cyclades <tarih>" },
    { "id": "hg1",  "note": 0, "coef": 3, "source": "Cyclades <tarih>" },
    { "id": "lva1", "note": 0, "coef": 3, "source": "Cyclades <tarih>" },
    { "id": "lvb1", "note": 0, "coef": 3, "source": "Cyclades <tarih>" },
    { "id": "es1",  "note": 0, "coef": 3, "source": "Cyclades <tarih>" },
    { "id": "emc1", "note": 0, "coef": 1, "source": "Cyclades <tarih>" },
    { "id": "spe_drop", "note": 0, "coef": 8, "source": "Cyclades <tarih>" },
    { "id": "lvc1", "note": 0, "coef": 2, "source": "Cyclades <tarih>" }
  ],
  "grades": [
    { "date": "2026-09-21", "subjectId": "spe1", "label": "DS 1", "note": 0, "outOf": 20, "coef": 1, "classAvg": 0, "period": 1 }
  ],
  "upcoming": [ { "date": "2026-10-09", "subjectId": "spe1", "label": "DS 2" } ],
  "scenarios": { "kotu": { "spe1": 0 }, "gercekci": { "spe1": 0 }, "hedef": { "spe1": 0 } },
  "notes": [ "Okuma notu (sayfanın altında madde olarak görünür)." ]
}
```

- `locked` yalnız A'da (1ère'nin kesinleşmiş 33 katsayısı). B'de `locked` olmaz.
- `grades[].note` ham nottur; baraj 20 değilse `outOf` yaz (ör. 8,5/10 → `"note": 8.5, "outOf": 10`).
  Abs/Disp → `"note": null`. `coef` not katsayısı (varsayılan 1), `classAvg` varsa sınıf ortalaması.
- `period` yoksa dosyadaki `period.index` sayılır. B'de trimestre karşılaştırması için her nota
  `period` (1–3) yazmak iyi olur. A'da `period.type` = `semestre`, B'de `trimestre`.
- `scenarios` isteğe bağlı: yoksa "gerçekçi" ders ortalamalarından türetilir, "kötü/hedef" ∓ 2.
  Dosyada verilirse yalnız değişken (kilitsiz) dersler yazılır.
- `options.lvc: true` LVC opsiyonunu varsayılan açık yapar (katsayısı okulca teyitsiz).
- `track: "ib"` yazılırsa B'nin bac 2029 sekmesi gizlenir.

## 5. Ders kimlikleri (subjectId) — Pronote adından eşleme

**A — Terminale (bac 2027, `docs/config/bac-2027.json`)**

| Pronote'ta görünen (genel) | subjectId | katsayı | durum |
|---|---|---|---|
| Français écrit / oral (1ère, Cyclades) | `fr_e` / `fr_o` | 5 / 5 | kilitli |
| Maths anticipées (1ère) | `ma_a` | 2 | kilitli |
| Histoire-géo · LVA · LVB · Ens. scientifique · EMC (1ère yıllık) | `hg1` · `lva1` · `lvb1` · `es1` · `emc1` | 3·3·3·3·1 | kilitli |
| Bırakılan spécialité (1ère yıllık) | `spe_drop` | 8 | kilitli |
| Spécialité 1 / 2 (Tle) | `spe1` / `spe2` | 16 / 16 | değişken |
| Philosophie · Grand oral | `philo` · `go` | 8 · 8 | değişken |
| EPS · Histoire-géo · LVA · LVB · Ens. scientifique · EMC (Tle) | `eps` · `hg` · `lva` · `lvb` · `es` · `emc` | 6·3·3·3·3·1 | değişken |
| LVC (opsiyon) 1ère / Tle | `lvc1` / `lvc` | 2 / 2 | teyitsiz, varsayılan kapalı |

Hangi spécialité'nin `spe1`, hangisinin `spe2` olduğu `subjectLabels` ile belirlenir; tutarlı kal.

**B — Seconde (`docs/config/seconde-2026.json`)**: Français `fr` · Mathématiques `maths` ·
Histoire-géographie `hg` · Anglais LVA `lva` · LVB `lvb` · SES `ses` · SNT `snt` ·
Physique-chimie `pc` · SVT `svt` · EPS `eps` · EMC `emc` · LVC `lvc` · Section européenne / DNL `euro` ·
Sciences et laboratoire `sl`. Katsayılar hepsi 1 (**okuldan teyitsiz**).

## 6. Kod haritası (değişiklik gerekirse)

| Dosya | Rol |
|---|---|
| `docs/engine.js` | Saf hesap motoru: `weightedAverage` (/20, `outOf` destekli), `finalBac`, `mention`, `nextThreshold`, `requiredNote`, `leverage`, `termAverage`, `specialiteScenarios`, `buildBacNotes`, `withLabels`, `withOptions` |
| `docs/data.js` | Okuma katmanı: yerel dosya → token → demo; önbellek; modlar |
| `docs/validate.js` + `docs/schema/notes.schema.json` | Şema doğrulayıcı (bağımlılıksız) + config çapraz kontrolü |
| `docs/ui.js`, `docs/styles.css` | Ortak bileşenler, açık/koyu tema |
| `docs/a-terminale.js` / `docs/b-seconde.js` | Sayfa mantığı |
| `docs/config/*.json` | Katsayılar. `bac-2029.json` `verified:false`; `seconde-2026.json` katsayılar teyitsiz |
| `tests/*.test.mjs` | `node --test`; A örnek verisinde final = 12,25 elle hesaplı sabit |
| `scripts/` | gizlilik denetimi, salt-okunur denetimi, veri doğrulama |

Kurallar: `innerHTML` kullanma (veri metinleri `textContent`); kodda veri reposuna yazan çağrı
olmaz (`PUT/POST/PATCH/DELETE` → `scripts/readonly-check.mjs` kırar); yeni bağımlılık ekleme;
katsayı değişikliği kodda değil config'te yapılır ve testteki elle hesaplı değerler güncellenir.

## 7. Açık sorular (varsayma, Üstadım'a sor)

- Seconde ders katsayıları (karneden okunacak, `seconde-2026.json`).
- LVC opsiyonunun bac'a girip girmediği ve katsayısı (okul cevabı).
- Okulun sunduğu spécialité listesi (`bac-2029.json` ulusal listeyi taşır).
- 2029 katsayıları (şimdilik 2027 kopyası, `verified:false`).
