import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../docs/engine.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const cfg2027 = read('../docs/config/bac-2027.json');
const cfg2029 = read('../docs/config/bac-2029.json');
const cfgSec = read('../docs/config/seconde-2026.json');
const exA = read('../docs/examples/a.example.json');
const exB = read('../docs/examples/b.example.json');

test('config dosyaları tutarlı', () => {
  for (const c of [cfg2027, cfg2029, cfgSec]) assert.deepEqual(E.validateConfig(c), [], c.id);
});

test('weightedAverage: katsayı, outOf ve null not', () => {
  assert.equal(E.weightedAverage([{ note: 12, coef: 1 }, { note: 14, coef: 2 }]), 40 / 3);
  assert.equal(E.weightedAverage([{ note: 8.5, outOf: 10 }]), 17);
  assert.equal(E.weightedAverage([{ note: null }, { note: 15 }]), 15);
  assert.equal(E.weightedAverage([]), null);
  assert.equal(E.weightedAverage([{ note: 10, coef: 0 }]), null);
});

test('A: katsayı toplamları config\'ten okunur: 33 kilitli + 67 kalan = 100', () => {
  const t = E.coefTotals(cfg2027);
  assert.equal(t.locked, 33);
  assert.equal(t.rest, 67);
  assert.equal(t.total, 100);
  const g = E.groupTotals(cfg2027);
  assert.equal(g['exam-tle'], 48);
  assert.equal(g['cc-tle'], 19);
  const withLvc = E.withOptions(cfg2027, { lvc: true });
  assert.equal(E.coefTotals(withLvc).total, 104);
});

test('A örnek verisi: final ortalama iki ondalığa kadar (elle hesap)', () => {
  // Kilitli: 5·12 + 5·14 + 2·11 + 3·13,5 + 3·15 + 3·12,5 + 3·11 + 1·15 + 8·12 = 419 (33 katsayı)
  // Gerçekçi: 16·12 + 16·11,5 + 8·10 + 8·13 + 6·14 + 3·12,5 + 3·14 + 3·12 + 3·11 + 1·13,5 = 806 (67 katsayı)
  // Final = (419 + 806) / 100 = 12,25
  const { notes } = E.buildBacNotes(cfg2027, exA, 'gercekci');
  const r = E.finalBac(cfg2027, notes);
  assert.equal(r.final, 12.25);
  assert.equal(r.lockedAvg, 12.7); // 419/33 = 12,6969… → 12,70
  assert.equal(r.restAvg, 12.03); // 806/67 = 12,0298… → 12,03
  assert.equal(r.lockedSum, 419);
  assert.equal(r.restSum, 806);
  assert.deepEqual(r.missing, []);
  // Kötü: 639 → (419 + 639)/100 = 10,58 · Hedef: 985 → 14,04
  assert.equal(E.finalBac(cfg2027, E.buildBacNotes(cfg2027, exA, 'kotu').notes).final, 10.58);
  assert.equal(E.finalBac(cfg2027, E.buildBacNotes(cfg2027, exA, 'hedef').notes).final, 14.04);
});

test('A örnek verisi + LVC opsiyonu: (419 + 806 + 2·13 + 2·14) / 104 = 12,2980… → 12,30', () => {
  const cfg = E.withOptions(cfg2027, { lvc: true });
  const { notes } = E.buildBacNotes(cfg, exA, 'gercekci');
  const r = E.finalBac(cfg, notes);
  assert.equal(r.totalCoef, 104);
  assert.equal(r.final, 12.3);
});

test('mention ve nextThreshold', () => {
  assert.equal(E.mention(7.9, cfg2027).level, 'refuse');
  assert.equal(E.mention(8, cfg2027).level, 'rattrapage');
  assert.equal(E.mention(10, cfg2027).level, 'admis');
  assert.equal(E.mention(12.25, cfg2027).level, 'assez-bien');
  assert.equal(E.mention(14, cfg2027).level, 'bien');
  assert.equal(E.mention(16, cfg2027).level, 'tres-bien');
  assert.equal(E.mention(18, cfg2027).level, 'felicitations');
  assert.equal(E.mention(null), null);
  const nx = E.nextThreshold(12.25, cfg2027);
  assert.equal(nx.threshold, 14);
  assert.equal(nx.gapPoints, 1.75);
  assert.equal(nx.gapWeighted, 175); // 1,75 × 100 katsayı
  assert.equal(E.nextThreshold(18.5, cfg2027), null);
  assert.equal(E.nextThreshold(7, cfg2027).threshold, 8);
});

test('requiredNote: unreachable / safe / sayı', () => {
  const { notes } = E.buildBacNotes(cfg2027, exA, 'gercekci');
  // Bien (14) için spe1 tek başına: (1400 − (1225 − 192)) / 16 = 22,94 → ulaşılamaz
  assert.equal(E.requiredNote(cfg2027, notes, 'spe1', 14), 'unreachable');
  // Admis (10) için emc tek başına: 1000 − (1225 − 13,5) < 0 → güvende
  assert.equal(E.requiredNote(cfg2027, notes, 'emc', 10), 'safe');
  // Assez bien (12) için spe1: (1200 − 1033) / 16 = 10,4375
  assert.equal(E.requiredNote(cfg2027, notes, 'spe1', 12), 10.4375);
  assert.throws(() => E.requiredNote(cfg2027, notes, 'yok', 12));
});

test('leverage: katsayıya göre azalan, yalnız değişken dersler', () => {
  const lv = E.leverage(cfg2027);
  assert.equal(lv.length, 10);
  assert.equal(lv[0].coef, 16);
  assert.equal(lv[0].deltaPerPoint, 0.16);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i - 1].coef >= lv[i].coef);
  assert.ok(lv.every((x) => !x.locked));
  assert.equal(E.leverage(cfg2027, { includeLocked: true }).length, 19);
});

test('withLabels: veri dosyası etiketleri config\'i değiştirmeden uygular', () => {
  const c = E.withLabels(cfg2027, { spe1: 'Örnek spé', bogus: 'x' });
  assert.equal(c.subjects.find((s) => s.id === 'spe1').label, 'Örnek spé');
  assert.equal(cfg2027.subjects.find((s) => s.id === 'spe1').label, 'Spécialité 1');
});

test('gradesBySubject / subjectAverages / deriveScenario', () => {
  const by = E.gradesBySubject(exA.grades, { period: 1, defaultPeriod: 1 });
  assert.equal(by.spe1.length, 2);
  const avgs = E.subjectAverages(exA.grades);
  assert.equal(avgs.spe1, (11.5 * 2 + 13) / 3);
  assert.equal(avgs.lva, 14); // 7/10 → 14/20
  assert.equal(avgs.emc, undefined); // tek not null
  const d = E.deriveScenario(cfg2027, exA.grades);
  assert.ok(d.estimated.includes('go'));
  assert.ok(d.estimated.includes('emc'));
  assert.ok(!d.estimated.includes('spe1'));
  assert.equal(d.notes.lva, 14);
});

test('buildBacNotes: dosyada senaryo yoksa türetilir ve ±2 uygulanır', () => {
  const data = { ...exA, scenarios: undefined };
  const g = E.buildBacNotes(cfg2027, data, 'gercekci');
  const k = E.buildBacNotes(cfg2027, data, 'kotu');
  const h = E.buildBacNotes(cfg2027, data, 'hedef');
  assert.equal(g.source, 'derived');
  assert.equal(k.notes.lva, 12);
  assert.equal(g.notes.lva, 14);
  assert.equal(h.notes.lva, 16);
  assert.equal(g.notes.fr_e, 12); // kilitli notlar dosyadan
  const mixed = E.buildBacNotes(cfg2027, { ...exA, scenarios: { gercekci: { spe1: 13 } } }, 'gercekci');
  assert.equal(mixed.source, 'mixed');
  assert.equal(mixed.notes.spe1, 13);
});

test('B örnek verisi: trimestre ortalaması (elle hesap)', () => {
  const by = E.gradesBySubject(exB.grades, { period: 1, defaultPeriod: 1 });
  const t = E.termAverage(cfgSec, by);
  const avg = Object.fromEntries(t.subjects.map((s) => [s.subjectId, s.average]));
  assert.equal(avg.fr, 13.33);     // (12 + 2·14)/3
  assert.equal(avg.maths, 14.33);  // (2·15 + 13)/3
  assert.equal(avg.snt, 17);       // 8,5/10
  assert.equal(avg.lvc, null);
  // Genel: (13,333 + 14,333 + 11,5 + 15,5 + 12 + 13 + 17 + 10,5 + 12,5 + 14 + 15 + 13) / 12 = 13,4722 → 13,47
  assert.equal(t.general, 13.47);
  assert.equal(t.countedCoef, 12);
  assert.equal(E.termAverage(cfgSec, {}).general, null);
});

test('specialiteScenarios: üç bırakma senaryosu', () => {
  const base = { fr_e: 12, fr_o: 13, ma_a: 13, hg1: 12, lva1: 15, lvb1: 12, es1: 12, emc1: 14, philo: 11, go: 13, eps: 14, hg: 12, lva: 15, lvb: 12, es: 12, emc: 14 };
  const sc = E.specialiteScenarios(cfg2029, base, [
    { id: 'maths', label: 'Maths', note: 14 },
    { id: 'pc', label: 'PC', note: 11 },
    { id: 'ses', label: 'SES', note: 13 },
  ]);
  assert.equal(sc.length, 3);
  const best = [...sc].sort((a, b) => b.final - a.final)[0];
  assert.equal(best.dropped.id, 'pc'); // en düşük not bırakılınca ortalama en yüksek
  assert.deepEqual(sc[0].result.missing, []);
  assert.deepEqual(E.specialiteScenarios(cfg2029, base, [{ id: 'maths', note: 14 }]), []);
});

test('yardımcılar: round2, snapToStep, ceilToStep, noteOn20', () => {
  assert.equal(E.round2(12.345), 12.35);
  assert.equal(E.round2(null), null);
  assert.equal(E.snapToStep(12.3), 12.25);
  assert.equal(E.ceilToStep(12.26), 12.5);
  assert.equal(E.ceilToStep(12.25), 12.25);
  assert.equal(E.noteOn20(15, 30), 10);
  assert.equal(E.noteOn20(null), null);
});
