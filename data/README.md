# data/ — gerçek notlar (yerel)

`a.json` (Öğrenci A) ve `b.json` (Öğrenci B) bu klasöre konur. Site yerel sunucudan
(`npm run serve`) açıldığında önce bu dosyalara bakar; varsa token gerekmez.

- Şema: `docs/schema/notes.schema.json` · ders kimlikleri: `README.md` → "Ders kimlikleri".
- Bu klasördeki `*.json` dosyaları `.gitignore` ile git dışıdır; asla commit edilmez.
- Doğrulama: `node scripts/validate-data.mjs data/a.json`
