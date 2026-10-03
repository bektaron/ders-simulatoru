import { E, Mode, boot, el, fmt, fmt1, fmtDate, fmtNote, fmtSigned, renderBanner, renderEmptyState, setPill, noteRow, segButtons, initTabs, sessionState, initTheme, $ } from './ui.js';

initTheme($('#theme'));

const GENERIC_NOTES = [
  'Seconde notları bac\'a girmez; karne ortalaması ve 1ère spécialité seçimi için önemlidir.',
  'Okulun moyenne générale hesabındaki ders katsayıları teyit edilmedi; tüm dersler 1 sayılır.',
  'Bac 2029 katsayıları 2027 yapısının kopyasıdır; keşif amaçlıdır, resmî değildir.',
];

let tempSeq = 0;

async function main() {
  let ctx;
  try {
    ctx = await boot({ student: 'B', configs: { sec: 'config/seconde-2026.json', bac: 'config/bac-2029.json' }, validateWith: 'sec' });
  } catch {
    const b = $('#banner'); b.classList.remove('hidden'); b.className = 'banner error';
    b.append(el('span', { class: 'label', text: 'Sorun' }), el('span', { text: 'Yapılandırma yüklenemedi. Sayfa bir HTTP sunucusundan açılmalı (file:// çalışmaz).' }));
    return;
  }
  const { client, configs } = ctx;
  render(ctx.result);

  function render(result) {
    const banner = $('#banner');
    banner.classList.remove('hidden');
    renderBanner(banner, result);
    if (!result || !result.data) {
      $('#main').classList.add('hidden');
      $('#empty').classList.remove('hidden');
      renderEmptyState($('#empty'), result, { onDemo: async () => render(await client.loadDemo('B')) });
      return;
    }
    $('#empty').classList.add('hidden');
    $('#main').classList.remove('hidden');
    buildPage(result.data, result.mode === Mode.DEMO);
  }

  function buildPage(data, isDemo) {
    const session = sessionState('ds:v1:session:B', {});
    const sec = configs.sec;
    const bacBase = E.withLabels(configs.bac, data.subjectLabels);
    const defaultPeriod = data.period ? data.period.index : 1;
    const periods = sec.periods || [{ index: 1, label: '1. trimestre', short: 'T1' }];
    const state = {
      period: session.get().period || defaultPeriod,
      temp: session.get().temp || [],
      proj: session.get().proj || { candidates: [{}, {}, {}], notes: {}, options: { ...(data.options || {}) } },
    };
    tempSeq = state.temp.reduce((m, t) => Math.max(m, t.id || 0), 0);

    $('#title').textContent = `${data.displayName} — Seconde Simülatörü`;
    $('#lead').textContent = `Trimestre ortalaması ve 1ère spécialité seçimi için bac 2029 keşif aracı.${isDemo ? ' Şu an ÖRNEK veri gösteriliyor.' : ''}`;
    $('#coefNote').textContent = sec.coefficientsNote || 'Ders katsayıları okuldan teyit edilmeli.';
    $('#bacNote').textContent = `2029 katsayıları teyitsiz — ${configs.bac.source || ''}`;

    const allGrades = () => [...(data.grades || []), ...state.temp.map((t) => ({ ...t, temp: true }))];
    const labelOf = (id) => { const s = sec.subjects.find((x) => x.id === id); return s ? s.label : id; };

    /* ---------------- sekme 1: trimestre ---------------- */
    const periodSeg = segButtons($('#periods'), periods.map((p) => ({ id: String(p.index), label: p.label })), String(state.period), (id) => {
      state.period = Number(id);
      session.patch({ period: state.period });
      renderTrim();
    });
    void periodSeg;

    function renderTrim() {
      const by = E.gradesBySubject(allGrades(), { period: state.period, defaultPeriod });
      const T = E.termAverage(sec, by);
      const pLabel = (periods.find((p) => p.index === state.period) || {}).label || `${state.period}. dönem`;
      $('#genTitle').textContent = `Genel ortalama — ${pLabel}`;
      $('#general').textContent = fmt(T.general);
      const withAvg = T.subjects.filter((s) => s.average != null);
      setPill($('#genSub'), T.general == null ? null : { label: `${withAvg.length} ders · ${T.countedCoef} katsayı`, tone: 'acc' });
      const total = Object.values(by).reduce((a, l) => a + l.length, 0);
      $('#gradeCount').textContent = String(total);
      const tmp = state.temp.filter((t) => (t.period || defaultPeriod) === state.period).length;
      $('#tempCount').textContent = tmp ? `${tmp} geçici not dahil` : '';
      const sorted = [...withAvg].sort((a, b) => b.average - a.average);
      $('#bestSubj').textContent = sorted.length ? fmt(sorted[0].average) : '–';
      $('#bestLabel').textContent = sorted.length ? sorted[0].label : '';
      $('#worstSubj').textContent = sorted.length ? fmt(sorted[sorted.length - 1].average) : '–';
      $('#worstLabel').textContent = sorted.length ? sorted[sorted.length - 1].label : '';

      const cards = $('#cards');
      cards.textContent = '';
      for (const s of sec.subjects) {
        const list = (by[s.id] || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const avg = E.weightedAverage(list);
        if (s.optional && !list.length) continue;
        const tbody = el('tbody');
        for (const g of list) {
          tbody.append(el('tr', {},
            el('td', { class: 'num', text: fmtDate(g.date) }),
            el('td', {}, g.label || '', g.temp ? el('span', { class: 'tag tmp', text: 'geçici' }) : null),
            el('td', { class: 'r', text: fmtNote(g) }), el('td', { class: 'r', text: E.isNote(g.coef) ? String(g.coef) : '1' }),
            el('td', { class: 'r', text: E.isNote(g.classAvg) ? fmt(g.classAvg) : '–' }),
            el('td', {}, g.temp ? el('button', { type: 'button', class: 'btn small', 'aria-label': 'Geçici notu sil', text: '×', onclick: () => removeTemp(g.id) }) : null)));
        }
        const lbl = el('input', { type: 'text', placeholder: 'DS 2', 'aria-label': `${s.label} geçici not adı`, maxlength: 40 });
        const num = el('input', { type: 'number', min: 0, max: 20, step: 0.25, placeholder: 'not', 'aria-label': `${s.label} geçici not`, inputmode: 'decimal' });
        const coef = el('input', { type: 'number', min: 0, max: 10, step: 0.5, value: 1, 'aria-label': `${s.label} geçici not katsayısı`, inputmode: 'decimal' });
        const add = el('button', { type: 'button', class: 'btn small', text: '+ geçici', onclick: () => {
          const v = parseFloat(num.value);
          if (!Number.isFinite(v)) { num.focus(); return; }
          addTemp({ subjectId: s.id, label: lbl.value.trim() || 'geçici', note: E.clamp(v, 0, 20), outOf: 20, coef: Number.isFinite(parseFloat(coef.value)) ? parseFloat(coef.value) : 1, period: state.period });
        } });
        cards.append(el('article', { class: 'card' },
          el('header', {}, el('h3', {}, s.label, s.optional ? el('span', { class: 'tag', text: 'opsiyon' }) : null, ' ', el('small', { class: 'sub num', text: `×${s.coef}` })), el('span', { class: 'avg', text: fmt(avg) })),
          list.length
            ? el('div', { class: 'tablebox' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Tarih' }), el('th', { text: 'Değerlendirme' }), el('th', { class: 'r', text: 'Not' }), el('th', { class: 'r', text: 'Kats.' }), el('th', { class: 'r', text: 'Sınıf' }), el('th'))), tbody))
            : el('p', { class: 'sub mt', text: 'Bu dönemde not yok.' }),
          el('div', { class: 'addgrade' }, lbl, num, coef, add)));
      }
      renderCompare();
      seedProjectionDefaults();
      renderProjection();
    }
    function addTemp(t) { state.temp.push({ ...t, id: ++tempSeq, date: new Date().toISOString().slice(0, 10) }); session.patch({ temp: state.temp }); renderTrim(); }
    function removeTemp(id) { state.temp = state.temp.filter((t) => t.id !== id); session.patch({ temp: state.temp }); renderTrim(); }

    function renderCompare() {
      const head = $('#cmpHead');
      const body = $('#cmpBody');
      head.textContent = ''; body.textContent = '';
      head.append(el('tr', {}, el('th', { text: 'Ders' }), ...periods.map((p) => el('th', { class: 'r', text: p.short || p.label }))));
      const per = periods.map((p) => E.termAverage(sec, E.gradesBySubject(allGrades(), { period: p.index, defaultPeriod })));
      for (const s of sec.subjects) {
        const vals = per.map((t) => t.subjects.find((x) => x.subjectId === s.id).average);
        if (vals.every((v) => v == null)) continue;
        body.append(el('tr', {}, el('td', { text: s.label }), ...vals.map((v) => el('td', { class: 'r', text: fmt(v) }))));
      }
      body.append(el('tr', {}, el('td', {}, el('strong', { text: 'Genel ortalama' })), ...per.map((t) => el('td', { class: 'r' }, el('strong', { text: fmt(t.general) })))));
    }

    const up = (data.upcoming || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $('#upcomingWrap').classList.toggle('hidden', up.length === 0);
    const ul = $('#upcoming');
    ul.textContent = '';
    for (const u of up) ul.append(el('li', { text: `${fmtDate(u.date)} · ${labelOf(u.subjectId)}${u.label ? ` — ${u.label}` : ''}` }));

    /* ---------------- sekme 2: bac 2029 ---------------- */
    const ibTrack = data.track === 'ib';
    $('#tab-bac').hidden = ibTrack;
    if (ibTrack) $('#panel-bac').hidden = true;

    let bacCfg = E.withOptions(bacBase, state.proj.options || {});
    const baseRows = {};
    const seedAverages = () => E.subjectAverages(allGrades(), {}); // tüm dönemler
    function seedValue(seedFrom, avgs) {
      const vals = (seedFrom || []).map((id) => avgs[id]).filter((v) => E.isNote(v));
      return vals.length ? E.snapToStep(vals.reduce((a, b) => a + b, 0) / vals.length, 0.25) : null;
    }
    function seedProjectionDefaults() {
      const avgs = seedAverages();
      const notes = { ...state.proj.notes };
      for (const s of bacCfg.subjects) {
        if (s.role || E.isNote(notes[s.id])) continue;
        const v = seedValue(s.seedFrom, avgs);
        notes[s.id] = v == null ? 12 : v;
      }
      state.proj.notes = notes;
    }
    function saveProj() { session.patch({ proj: state.proj }); }

    /* adaylar */
    const cands = $('#cands');
    const specs = configs.bac.specialites || [];
    function renderCands() {
      cands.textContent = '';
      const avgs = seedAverages();
      state.proj.candidates.forEach((c, i) => {
        const sel = el('select', { 'aria-label': `${i + 1}. spécialité adayı` });
        sel.append(el('option', { value: '', text: '— seç —' }));
        for (const sp of specs) sel.append(el('option', { value: sp.id, text: sp.label, selected: sp.id === c.id || null }));
        const num = el('input', { type: 'number', min: 0, max: 20, step: 0.25, 'aria-label': `${i + 1}. aday tahmini not`, inputmode: 'decimal' });
        if (E.isNote(c.note)) num.value = String(c.note);
        sel.addEventListener('change', () => {
          const sp = specs.find((x) => x.id === sel.value);
          const seeded = sp ? seedValue(sp.seedFrom, avgs) : null;
          state.proj.candidates[i] = { id: sel.value || undefined, note: E.isNote(c.note) && c.id === sel.value ? c.note : (seeded ?? 12) };
          num.value = E.isNote(state.proj.candidates[i].note) ? String(state.proj.candidates[i].note) : '';
          saveProj(); renderProjection();
        });
        num.addEventListener('input', () => {
          const v = parseFloat(num.value);
          if (!Number.isFinite(v)) return;
          state.proj.candidates[i] = { ...state.proj.candidates[i], note: E.clamp(v, 0, 20) };
          saveProj(); renderProjection();
        });
        cands.append(sel, num);
      });
    }

    /* diğer dersler */
    const opt = (bacBase.options || [])[0];
    const optBox = $('#optLvc');
    if (opt) {
      const lab = $('#optLabel');
      lab.textContent = '';
      lab.append(`Opsiyonu hesaba kat: ${opt.label}, 1ère + Tle katsayı 2 + 2`, el('span', { class: 'tag', text: opt.verified ? 'teyitli' : 'teyitsiz' }), el('br'), el('span', { class: 'sub', text: opt.note || '' }));
      optBox.checked = !!(state.proj.options || {})[opt.id];
      optBox.addEventListener('change', () => {
        state.proj.options = { ...(state.proj.options || {}), [opt.id]: optBox.checked };
        bacCfg = E.withOptions(bacBase, state.proj.options);
        seedProjectionDefaults();
        saveProj();
        renderBaseLedger();
        renderProjection();
      });
    } else {
      $('#optWrap').hidden = true;
    }
    function renderBaseLedger() {
      const ledger = $('#baseLedger');
      ledger.textContent = '';
      const avgs = seedAverages();
      const gTot = E.groupTotals(bacCfg);
      for (const g of bacCfg.groups || []) {
        const subjects = bacCfg.subjects.filter((s) => s.group === g.id && !s.role);
        if (!subjects.length) continue;
        ledger.append(el('div', { class: 'grp' }, el('span', { class: 'eyebrow', text: g.label }), el('span', { class: 'sub num', text: `${gTot[g.id] || 0} katsayı (spécialité dahil)` })));
        for (const s of subjects) {
          const seeded = seedValue(s.seedFrom, avgs);
          const hint = seeded != null ? `Seconde ort. ${fmt(seeded)} (${(s.seedFrom || []).map(labelOf).join(' + ')})` : 'veri yok · varsayılan 12';
          baseRows[s.id] = noteRow({ id: `p-${s.id}`, name: s.label, hint, coef: s.coef, value: state.proj.notes[s.id], estimated: seeded == null, onInput: (v) => { state.proj.notes[s.id] = v; saveProj(); renderProjection(); } });
          ledger.append(baseRows[s.id].el);
        }
      }
    }

    function renderProjection() {
      if (ibTrack) return;
      const box = $('#scenCards');
      box.textContent = '';
      const chosen = state.proj.candidates.map((c) => ({ ...c, label: (specs.find((x) => x.id === c.id) || {}).label }));
      const ids = chosen.filter((c) => c.id).map((c) => c.id);
      const dup = new Set(ids).size !== ids.length;
      const ready = chosen.every((c) => c.id && E.isNote(c.note)) && !dup;
      $('#candsNote').textContent = dup ? 'Aynı spécialité iki kez seçilemez.' : (ready ? `${configs.bac.specialitesNote || ''}` : 'Üç farklı spécialité seçip tahmini notlarını girin.');
      if (!ready) { box.append(el('p', { class: 'sub', text: 'Üç aday seçilince bırakma senaryoları burada yan yana görünür.' })); return; }
      const T = E.coefTotals(bacCfg).total;
      const sc = E.specialiteScenarios(bacCfg, state.proj.notes, chosen);
      const best = Math.max(...sc.map((s) => s.final));
      for (const s of sc) {
        const pill = el('span', { class: 'pill' });
        setPill(pill, s.mention);
        box.append(el('article', { class: `card${s.final === best ? ' best' : ''}` },
          el('div', { class: 'eyebrow', text: `${s.dropped.label} bırakılırsa` }),
          el('div', { class: 'big mt', text: fmt(s.final) }),
          pill,
          el('p', { class: 'sub mt', text: `Tle'de kalan: ${s.kept.map((k) => `${k.label} (${fmt(k.note)})`).join(' + ')}` }),
          el('p', { class: 'sub', text: `1ère'de bırakılan ${s.dropped.label}: ${fmt(s.dropped.note)} × 8` }),
          el('p', { class: 'sub num', text: s.final === best ? 'En iyi senaryo' : `En iyiye fark: ${fmtSigned(s.final - best)}` }),
          s.result.missing.length ? el('p', { class: 'sub', text: `${s.result.missing.length} not eksik` }) : null));
      }
      for (const [id, r] of Object.entries(baseRows)) r.update(state.proj.notes[id], { totalCoef: T });
    }

    /* okuma notları */
    const notesUl = $('#notes');
    notesUl.textContent = '';
    for (const n of [...(data.notes || []), ...GENERIC_NOTES]) notesUl.append(el('li', { text: n }));

    /* başlangıç */
    initTabs($('#main'), { active: session.get().tab, onChange: (id) => session.patch({ tab: id }) });
    seedProjectionDefaults();
    renderCands();
    renderBaseLedger();
    renderTrim();
  }
}

main();
