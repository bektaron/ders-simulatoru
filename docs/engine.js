/**
 * Not simülatörü hesap motoru.
 *
 * Saf fonksiyonlar: DOM'a, localStorage'a veya ağa dokunmaz. Aynı dosya
 * tarayıcıda ES module olarak, Node'da `node --test` ile kullanılır.
 *
 * Sözleşme (bkz. README):
 *   weightedAverage(items)                         [{note, outOf, coef}] → /20 ölçeğinde number | null
 *   finalBac(config, notes)                        → {final, lockedAvg, restAvg, totalCoef, ...}
 *   mention(final, mentionsOrConfig)               → {label, level, threshold, tone} | null
 *   nextThreshold(final, config)                   → {threshold, label, gapPoints, gapWeighted} | null
 *   requiredNote(config, notes, subjectId, target) → number | 'unreachable' | 'safe'
 *   leverage(config, opts)                         → [{subjectId, label, coef, deltaPerPoint}]
 *   termAverage(config, gradesBySubject)           → {subjects, general}
 *   specialiteScenarios(config, baseNotes, candidates) → [{dropped, kept, final, mention}]
 *
 * Veri dosyası yardımcıları (şema: schema/notes.schema.json):
 *   gradesBySubject(grades, {period, defaultPeriod})
 *   subjectAverages(grades, opts)
 *   lockedToNotes(locked)
 *   deriveScenario(config, grades, opts)
 *   buildBacNotes(config, data, scenarioName)
 *   withLabels(config, subjectLabels) · withOptions(config, enabledOptions)
 *
 * Notlar 0–20 ölçeğinde sayıdır. Eksik (null/undefined) not, hem paydan hem
 * paydadan düşülür ve `missing` listesinde raporlanır.
 */

const EPS = 1e-9;

export const SCENARIO_NAMES = ['kotu', 'gercekci', 'hedef'];

export const DEFAULT_MENTIONS = [
  { min: 0, level: 'refuse', label: 'Ajourné', tone: 'bad' },
  { min: 8, level: 'rattrapage', label: 'Rattrapage (sözlü telafi)', tone: 'bad' },
  { min: 10, level: 'admis', label: 'Admis · mention yok', short: 'Bac', tone: 'warn' },
  { min: 12, level: 'assez-bien', label: 'Assez bien', short: 'Assez bien', tone: 'acc' },
  { min: 14, level: 'bien', label: 'Bien', short: 'Bien', tone: 'good' },
  { min: 16, level: 'tres-bien', label: 'Très bien', short: 'Très bien', tone: 'good' },
  { min: 18, level: 'felicitations', label: 'Très bien · félicitations', short: 'Félicitations', tone: 'good' },
];

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

export function isNote(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** İki ondalığa yuvarlar (yarım yukarı). */
export function round2(x) {
  if (!isNote(x)) return x == null ? null : x;
  return Math.round(x * 100 + (x >= 0 ? EPS : -EPS)) / 100;
}

/** num/den bölümünü iki ondalığa yuvarlar; ara çarpım kayan nokta hatasını azaltır. */
function divRound2(num, den) {
  return Math.round((num * 100) / den + EPS) / 100;
}

export function snapToStep(x, step = 0.25) {
  return Math.round(x / step) * step;
}

export function ceilToStep(x, step = 0.25) {
  return Math.ceil(x / step - EPS) * step;
}

export function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** Ham notu /20 ölçeğine çevirir (outOf varsayılan 20). */
export function noteOn20(note, outOf = 20) {
  if (!isNote(note)) return null;
  const d = isNote(outOf) && outOf > 0 ? outOf : 20;
  return (note / d) * 20;
}

function normalizeMentions(m) {
  const list = Array.isArray(m) ? m : (m && Array.isArray(m.mentions) ? m.mentions : DEFAULT_MENTIONS);
  return [...list].sort((a, b) => a.min - b.min);
}

/* ------------------------------------------------------------------ */
/* Config / opsiyonlar / etiketler                                     */
/* ------------------------------------------------------------------ */

/**
 * Temel dersler + açık opsiyonların dersleri.
 * enabledOptions: { lvc: true } gibi.
 */
export function resolveSubjects(config, enabledOptions = {}) {
  const base = Array.isArray(config.subjects) ? config.subjects : [];
  const extra = [];
  for (const opt of config.options || []) {
    if (enabledOptions[opt.id]) {
      for (const s of opt.subjects || []) extra.push({ ...s, option: opt.id });
    }
  }
  return [...base, ...extra];
}

/** Opsiyonları çözümlenmiş yeni bir config döndürür; girdi değişmez. */
export function withOptions(config, enabledOptions = {}) {
  return {
    ...config,
    subjects: resolveSubjects(config, enabledOptions),
    enabledOptions: { ...enabledOptions },
  };
}

/** Veri dosyasındaki subjectLabels ile ders etiketlerini değiştirir; girdi değişmez. */
export function withLabels(config, subjectLabels = {}) {
  if (!subjectLabels || typeof subjectLabels !== 'object') return config;
  const relabel = (s) => (typeof subjectLabels[s.id] === 'string' && subjectLabels[s.id].trim()
    ? { ...s, label: subjectLabels[s.id].trim(), genericLabel: s.label }
    : s);
  return {
    ...config,
    subjects: (config.subjects || []).map(relabel),
    options: (config.options || []).map((o) => ({ ...o, subjects: (o.subjects || []).map(relabel) })),
  };
}

/** Tüm dersler (tüm opsiyonlar açık sayılarak) — kimlik denetimi için. */
export function allSubjectIds(config) {
  const all = Object.fromEntries((config.options || []).map((o) => [o.id, true]));
  return new Set(resolveSubjects(config, all).map((s) => s.id));
}

/** Katsayı toplamları: tümü / kilitli / kalan. Config'ten okunur, sabit kodlanmaz. */
export function coefTotals(config) {
  const t = { total: 0, locked: 0, rest: 0 };
  for (const s of config.subjects || []) {
    const c = isNote(s.coef) ? s.coef : 0;
    t.total += c;
    if (s.locked) t.locked += c;
    else t.rest += c;
  }
  return t;
}

/** Grup bazında katsayı toplamı: { groupId: toplam }. */
export function groupTotals(config) {
  const out = {};
  for (const s of config.subjects || []) {
    if (!s.group) continue;
    out[s.group] = (out[s.group] || 0) + (isNote(s.coef) ? s.coef : 0);
  }
  return out;
}

/** Config tutarlılık kontrolü; hata mesajları listesi döner (boşsa geçerli). */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['config bir nesne değil'];
  const all = resolveSubjects(config, Object.fromEntries((config.options || []).map((o) => [o.id, true])));
  const ids = new Set();
  const groups = new Set((config.groups || []).map((g) => g.id));
  for (const s of all) {
    if (!s.id) errors.push('id eksik olan ders var');
    else if (ids.has(s.id)) errors.push(`tekrarlayan ders id: ${s.id}`);
    ids.add(s.id);
    if (!isNote(s.coef) || s.coef <= 0) errors.push(`geçersiz katsayı: ${s.id}`);
    if (s.group && groups.size && !groups.has(s.group)) errors.push(`bilinmeyen grup: ${s.id} → ${s.group}`);
  }
  const ms = normalizeMentions(config.mentions);
  for (let i = 1; i < ms.length; i++) {
    if (!(ms[i].min > ms[i - 1].min)) errors.push('mention eşikleri artan sırada değil');
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Hesaplar                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ağırlıklı ortalama, /20 ölçeğinde. Kalem: {note, outOf?, coef?}.
 * Notu olmayan (null) veya katsayısı ≤ 0 olan kalemler atlanır.
 * Hiç geçerli kalem yoksa null döner.
 */
export function weightedAverage(items) {
  let num = 0;
  let den = 0;
  for (const it of items || []) {
    if (!it) continue;
    const n = noteOn20(it.note, it.outOf);
    if (n == null) continue;
    const coef = isNote(it.coef) ? it.coef : 1;
    if (coef <= 0) continue;
    num += n * coef;
    den += coef;
  }
  return den > 0 ? num / den : null;
}

/**
 * Bac final ortalaması.
 * notes: { subjectId: number }
 * Dönen: { final, raw, lockedAvg, restAvg, lockedSum, restSum, totalCoef, lockedCoef, restCoef, countedCoef, weightedSum, missing }
 * final / lockedAvg / restAvg iki ondalığa yuvarlıdır; raw yuvarlanmamış değerdir.
 */
export function finalBac(config, notes = {}) {
  const subjects = config.subjects || [];
  const totals = coefTotals(config);
  let num = 0, den = 0, lnum = 0, lden = 0, rnum = 0, rden = 0;
  const missing = [];
  for (const s of subjects) {
    const n = notes[s.id];
    if (!isNote(n)) { missing.push(s.id); continue; }
    num += n * s.coef;
    den += s.coef;
    if (s.locked) { lnum += n * s.coef; lden += s.coef; } else { rnum += n * s.coef; rden += s.coef; }
  }
  return {
    final: den > 0 ? divRound2(num, den) : null,
    raw: den > 0 ? num / den : null,
    lockedAvg: lden > 0 ? divRound2(lnum, lden) : null,
    restAvg: rden > 0 ? divRound2(rnum, rden) : null,
    lockedSum: lnum,
    restSum: rnum,
    totalCoef: totals.total,
    lockedCoef: totals.locked,
    restCoef: totals.rest,
    countedCoef: den,
    weightedSum: num,
    missing,
  };
}

/** Ortalamaya karşılık gelen mention. İkinci argüman mention listesi veya config olabilir. */
export function mention(final, mentionsOrConfig = DEFAULT_MENTIONS) {
  if (!isNote(final)) return null;
  const list = normalizeMentions(mentionsOrConfig);
  let cur = list[0];
  for (const m of list) if (final + EPS >= m.min) cur = m;
  return { label: cur.label, level: cur.level, threshold: cur.min, tone: cur.tone || 'acc' };
}

/**
 * Bir üst eşik ve ona kalan puan. gapPoints ortalama puanı, gapWeighted
 * katsayı-ağırlıklı puan (eşik × toplam katsayı − mevcut toplam). En üstteyse null.
 */
export function nextThreshold(final, mentionsOrConfig = DEFAULT_MENTIONS, totalCoef) {
  if (!isNote(final)) return null;
  const list = normalizeMentions(mentionsOrConfig);
  const K = isNote(totalCoef) ? totalCoef
    : (mentionsOrConfig && Array.isArray(mentionsOrConfig.subjects) ? coefTotals(mentionsOrConfig).total : null);
  for (const m of list) {
    if (m.min > 0 && m.min > final + EPS) {
      const gap = m.min - final;
      return {
        threshold: m.min,
        label: m.label,
        short: m.short || m.label,
        level: m.level,
        gapPoints: round2(gap),
        gapWeighted: K ? round2(gap * K) : null,
      };
    }
  }
  return null;
}

/**
 * Diğer notlar sabitken `subjectId` dersinde `target` ortalamasına ulaşmak için
 * gereken en düşük not. 20'yi aşarsa 'unreachable', 0 veya altındaysa 'safe'.
 */
export function requiredNote(config, notes = {}, subjectId, target) {
  const subjects = config.subjects || [];
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new Error(`Bilinmeyen ders: ${subjectId}`);
  let othersNum = 0;
  let den = subject.coef;
  for (const s of subjects) {
    if (s.id === subjectId) continue;
    const n = notes[s.id];
    if (!isNote(n)) continue;
    othersNum += n * s.coef;
    den += s.coef;
  }
  const n = (target * den - othersNum) / subject.coef;
  if (n > 20 + EPS) return 'unreachable';
  if (n <= EPS) return 'safe';
  return n;
}

/**
 * "+1 puan"ın genel ortalamaya katkısı, katsayıya göre azalan sırada.
 * Varsayılan olarak yalnız değişken (kilitsiz) dersler.
 */
export function leverage(config, { includeLocked = false } = {}) {
  const subjects = config.subjects || [];
  const total = coefTotals(config).total;
  return subjects
    .filter((s) => includeLocked || !s.locked)
    .map((s) => ({
      subjectId: s.id,
      label: s.label,
      coef: s.coef,
      locked: !!s.locked,
      deltaPerPoint: total > 0 ? s.coef / total : 0,
    }))
    .sort((a, b) => b.coef - a.coef);
}

/* ------------------------------------------------------------------ */
/* Veri dosyası yardımcıları                                           */
/* ------------------------------------------------------------------ */

/**
 * Ham not listesini ders bazında gruplar.
 * period verilirse yalnız o dönemin notları (notun `period` alanı yoksa
 * defaultPeriod sayılır); verilmezse tümü.
 */
export function gradesBySubject(grades, { period, defaultPeriod } = {}) {
  const out = {};
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g || typeof g.subjectId !== 'string') continue;
    if (period != null) {
      const p = isNote(g.period) ? g.period : defaultPeriod;
      if (p !== period) continue;
    }
    (out[g.subjectId] ||= []).push(g);
  }
  return out;
}

/** Ders bazında /20 ortalama: { subjectId: number } (notu olmayan ders yer almaz). */
export function subjectAverages(grades, opts = {}) {
  const by = gradesBySubject(grades, opts);
  const out = {};
  for (const [id, list] of Object.entries(by)) {
    const avg = weightedAverage(list);
    if (avg != null) out[id] = avg;
  }
  return out;
}

/** Veri dosyasındaki locked dizisini { id: note } haritasına çevirir. */
export function lockedToNotes(locked) {
  const out = {};
  for (const l of Array.isArray(locked) ? locked : []) {
    if (l && typeof l.id === 'string' && isNote(l.note)) out[l.id] = l.note;
  }
  return out;
}

/**
 * "Gerçekçi" senaryoyu mevcut ders ortalamalarından türetir.
 * Değişken (kilitsiz) her ders için: notu varsa ortalaması; yoksa mevcut
 * ortalamaların ortalaması (hiç yoksa 10). Doldurulanlar `estimated`'da.
 */
export function deriveScenario(config, grades, opts = {}) {
  const avgs = subjectAverages(grades, opts);
  const variable = (config.subjects || []).filter((s) => !s.locked);
  const known = variable.filter((s) => avgs[s.id] != null).map((s) => avgs[s.id]);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 10;
  const notes = {};
  const estimated = [];
  for (const s of variable) {
    if (avgs[s.id] != null) notes[s.id] = snapToStep(avgs[s.id], 0.25);
    else { notes[s.id] = snapToStep(fallback, 0.25); estimated.push(s.id); }
  }
  return { notes, estimated, averages: avgs };
}

/**
 * Bir senaryo için tam not haritası: kilitli notlar (veri `locked`) +
 * değişken notlar (veri `scenarios[name]`, eksikler türetilmişten tamamlanır;
 * dosyada senaryo yoksa türetilmiş gerçekçi ±2).
 * Dönen: { notes, source: 'file'|'derived'|'mixed', estimated: [...] }
 */
export function buildBacNotes(config, data, scenarioName = 'gercekci') {
  const locked = lockedToNotes(data && data.locked);
  const derived = deriveScenario(config, data && data.grades, {
    period: data && data.period ? data.period.index : undefined,
    defaultPeriod: data && data.period ? data.period.index : undefined,
  });
  const offset = scenarioName === 'kotu' ? -2 : scenarioName === 'hedef' ? 2 : 0;
  const fileScen = data && data.scenarios && data.scenarios[scenarioName];
  const notes = { ...locked };
  const estimated = [];
  let fromFile = 0;
  for (const s of (config.subjects || []).filter((x) => !x.locked)) {
    const v = fileScen && isNote(fileScen[s.id]) ? fileScen[s.id] : null;
    if (v != null) { notes[s.id] = v; fromFile++; continue; }
    notes[s.id] = clamp(snapToStep(derived.notes[s.id] + offset, 0.25), 0, 20);
    estimated.push(s.id);
  }
  const source = fromFile === 0 ? 'derived' : estimated.length === 0 ? 'file' : 'mixed';
  return { notes, source, estimated, averages: derived.averages };
}

/* ------------------------------------------------------------------ */
/* Seconde: trimestre ortalaması                                       */
/* ------------------------------------------------------------------ */

/**
 * bySubject: { subjectId: [{note, outOf, coef}] } (bkz. gradesBySubject)
 * Ders ortalaması = notların ağırlıklı ortalaması (/20); genel ortalama = ders
 * ortalamalarının config katsayılarıyla ağırlıklı ortalaması. Notu olmayan
 * ders genel ortalamaya girmez.
 */
export function termAverage(config, bySubject = {}) {
  const subjects = config.subjects || [];
  const perSubject = [];
  const items = [];
  for (const s of subjects) {
    const list = Array.isArray(bySubject[s.id]) ? bySubject[s.id] : [];
    const avg = weightedAverage(list);
    const coef = isNote(s.coef) ? s.coef : 1;
    perSubject.push({
      subjectId: s.id,
      label: s.label,
      coef,
      optional: !!s.optional,
      average: avg == null ? null : round2(avg),
      count: list.filter((g) => g && isNote(g.note)).length,
    });
    if (avg != null) items.push({ note: avg, coef });
  }
  const g = weightedAverage(items);
  return {
    subjects: perSubject,
    general: g == null ? null : round2(g),
    countedCoef: items.reduce((a, b) => a + b.coef, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Bac projeksiyonu: spécialité bırakma senaryoları                    */
/* ------------------------------------------------------------------ */

/**
 * Üç spécialité adayından her birinin "1ère sonunda bırakılması" senaryosu.
 * Config'te role: 'spe-dropped' (1 ders) ve role: 'spe-kept' (2 ders) yuvaları olmalı.
 * candidates: [{id, label, note}] — her aday için tahmini not.
 */
export function specialiteScenarios(config, baseNotes = {}, candidates = []) {
  const subjects = config.subjects || [];
  const dropped = subjects.find((s) => s.role === 'spe-dropped');
  const kept = subjects.filter((s) => s.role === 'spe-kept');
  if (!dropped || kept.length < 2) {
    throw new Error('Config içinde spécialité yuvaları eksik (role: spe-dropped / spe-kept).');
  }
  const valid = candidates.filter((c) => c && isNote(c.note)).slice(0, 3);
  if (valid.length < 3) return [];
  return valid.map((c, i) => {
    const others = valid.filter((_, j) => j !== i);
    const notes = {
      ...baseNotes,
      [dropped.id]: c.note,
      [kept[0].id]: others[0].note,
      [kept[1].id]: others[1].note,
    };
    const result = finalBac(config, notes);
    return {
      dropped: c,
      kept: others,
      final: result.final,
      mention: mention(result.final, config),
      result,
    };
  });
}
