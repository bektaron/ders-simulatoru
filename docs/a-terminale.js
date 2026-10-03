import { E, Mode, boot, el, fmt, fmt1, fmtDate, fmtNote, renderBanner, renderEmptyState, buildGauge, setPill, noteRow, segButtons, sessionState, initTheme, $ } from './ui.js';

initTheme($('#theme'));

const SCENARIOS = [
  { id: 'kotu', label: 'Kötü gidiş' },
  { id: 'gercekci', label: 'Gerçekçi (1ère eğilimi)' },
  { id: 'hedef', label: 'Hedef' },
];
const GENERIC_NOTES = [
  'Katsayılar: kontrol continu 40 + sınavlar 60 = 100 (okul sunumu). Terminale kontrol continu notlarının yıllık ortalamadan alındığı varsayıldı.',
  'Eşikler: 10 bac · 12 Assez bien · 14 Bien · 16 Très bien · 18 Très bien + félicitations du jury. 8–10 arası sözlü telafi (rattrapage) bölgesidir.',
  'Parcoursup bu hesaptan ayrıdır: dosyaya 1ère karneleri + Terminale 1. dönem karnesi + öğretmen yorumları gider.',
];

function pick(notes, subjects) {
  const out = {};
  for (const s of subjects) if (E.isNote(notes[s.id])) out[s.id] = notes[s.id];
  return out;
}

async function main() {
  let ctx;
  try {
    ctx = await boot({ student: 'A', configs: { bac: 'config/bac-2027.json' }, validateWith: 'bac' });
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
    const main = $('#main');
    const empty = $('#empty');
    if (!result || !result.data) {
      main.classList.add('hidden');
      empty.classList.remove('hidden');
      renderEmptyState(empty, result, { onDemo: async () => render(await client.loadDemo('A')) });
      return;
    }
    empty.classList.add('hidden');
    main.classList.remove('hidden');
    buildPage(result.data, result.mode === Mode.DEMO);
  }

  function buildPage(data, isDemo) {
    const session = sessionState('ds:v1:session:A', {});
    const base = E.withLabels(configs.bac, data.subjectLabels);
    const lockedFromFile = E.lockedToNotes(data.locked);
    const lockedSources = [...new Set((data.locked || []).map((l) => l.source).filter(Boolean))];
    const state = {
      options: { ...(data.options || {}), ...(session.get().options || {}) },
      lockedEdits: { ...(session.get().lockedEdits || {}) },
      scenario: session.get().scenario || 'gercekci',
      var: {},
      estimated: new Set(),
      source: 'file',
      target: session.get().target || 14,
    };
    let cfg = E.withOptions(base, state.options);
    const labelOf = (id) => { const s = cfg.subjects.find((x) => x.id === id); return s ? s.label : id; };
    const lockedNotes = () => ({ ...lockedFromFile, ...state.lockedEdits });

    /* başlık */
    $('#title').textContent = `${data.displayName} — Bac Simülatörü`;
    $('#lead').textContent = `Kalan derslerdeki notları değiştir, bac genel ortalamasının ve mention'ın nasıl oynadığını gör. Katsayılar okulun Ekim 2026 veli toplantısı slaytlarından; 1ère notları ${lockedSources.length ? lockedSources.join(', ') : 'veri dosyasından'}.${isDemo ? ' Şu an ÖRNEK veri gösteriliyor.' : ''}`;

    /* gösterge */
    const gauge = buildGauge($('#gauge'), { min: cfg.gauge?.min ?? 6, max: cfg.gauge?.max ?? 20, mentions: cfg.mentions });

    /* defter satırları (temel, kilitsiz dersler) */
    const ledger = $('#ledger');
    ledger.textContent = '';
    const rows = {};
    const gTot = E.groupTotals(base);
    for (const g of (base.groups || []).filter((x) => !x.locked)) {
      const subjects = base.subjects.filter((s) => s.group === g.id && !s.locked);
      if (!subjects.length) continue;
      ledger.append(el('div', { class: 'grp' }, el('span', { class: 'eyebrow', text: g.label }), el('span', { class: 'sub num', text: `${gTot[g.id] || 0} katsayı` })));
      for (const s of subjects) {
        rows[s.id] = noteRow({ id: s.id, name: s.label, hint: s.hint, coef: s.coef, value: 10, step: cfg.scale?.step ?? 0.25, onInput: (v) => onEdit(s.id, v) });
        ledger.append(rows[s.id].el);
      }
    }

    /* opsiyon (LVC) */
    const opt = (base.options || [])[0];
    const optWrap = $('#optWrap');
    const optBox = $('#optLvc');
    const lvcRowWrap = $('#lvcRow');
    let lvcRow = null;
    if (opt) {
      const lvc1 = opt.subjects.find((s) => s.locked);
      const lvcT = opt.subjects.find((s) => !s.locked);
      const lab = $('#optLabel');
      lab.textContent = '';
      const note1 = E.isNote(lockedFromFile[lvc1?.id]) ? `1ère ${fmt(lockedFromFile[lvc1.id])}` : '1ère notu dosyada yok';
      lab.append(`Opsiyonu hesaba kat: ${lvcT ? lvcT.label : opt.label} (${note1}), 1ère + Tle katsayı ${lvc1?.coef ?? 2} + ${lvcT?.coef ?? 2}`,
        el('span', { class: 'tag', text: opt.verified ? 'teyitli' : 'teyitsiz' }), el('br'), el('span', { class: 'sub', text: opt.note || '' }));
      if (lvcT) {
        lvcRow = noteRow({ id: lvcT.id, name: lvcT.label, hint: lvcT.hint, coef: lvcT.coef, value: 10, onInput: (v) => onEdit(lvcT.id, v) });
        lvcRowWrap.textContent = '';
        lvcRowWrap.append(lvcRow.el);
        rows[lvcT.id] = lvcRow;
      }
      optBox.checked = !!state.options[opt.id];
      lvcRowWrap.hidden = !optBox.checked;
      optBox.addEventListener('change', () => {
        state.options = { ...state.options, [opt.id]: optBox.checked };
        session.patch({ options: state.options });
        cfg = E.withOptions(base, state.options);
        lvcRowWrap.hidden = !optBox.checked;
        if (optBox.checked && lvcT && !E.isNote(state.var[lvcT.id])) {
          const built = E.buildBacNotes(cfg, data, state.scenario === 'custom' ? 'gercekci' : state.scenario);
          state.var[lvcT.id] = built.notes[lvcT.id];
          if (built.estimated.includes(lvcT.id)) state.estimated.add(lvcT.id);
          lvcRow.set(state.var[lvcT.id]);
        }
        calc();
      });
    } else {
      optWrap.hidden = true;
    }

    /* kilitli notlar */
    const lockedBox = $('#locked');
    lockedBox.textContent = '';
    const lockedInputs = {};
    for (const s of base.subjects.filter((x) => x.locked)) {
      const inp = el('input', { type: 'number', id: `l-${s.id}`, min: 0, max: 20, step: 0.05, inputmode: 'decimal' });
      inp.value = E.isNote(lockedNotes()[s.id]) ? String(lockedNotes()[s.id]) : '';
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        state.lockedEdits[s.id] = E.clamp(v, 0, 20);
        session.patch({ lockedEdits: state.lockedEdits });
        $('#lockedResetWrap').classList.remove('hidden');
        calc();
      });
      lockedInputs[s.id] = inp;
      lockedBox.append(el('label', { for: `l-${s.id}` }, el('span', {}, s.label, ' ', el('small', { class: 'num', text: `×${s.coef}` })), inp));
    }
    $('#lockedResetWrap').classList.toggle('hidden', Object.keys(state.lockedEdits).length === 0);
    $('#lockedReset').onclick = () => {
      state.lockedEdits = {};
      session.patch({ lockedEdits: {} });
      for (const [id, inp] of Object.entries(lockedInputs)) inp.value = E.isNote(lockedFromFile[id]) ? String(lockedFromFile[id]) : '';
      $('#lockedResetWrap').classList.add('hidden');
      calc();
    };
    const missingLocked = base.subjects.filter((s) => s.locked && !E.isNote(lockedFromFile[s.id]));
    $('#lockedNote').textContent = (missingLocked.length
      ? `Dosyada notu olmayan kilitli dersler: ${missingLocked.map((s) => s.label).join(', ')} (hesaba girmez). `
      : '') + 'Resmî notlar; değiştirilebilir ama değişmez — yalnız denetim için açık. Değişiklikler sekme kapanınca silinir.';

    /* hedef eşik düğmeleri */
    const targets = cfg.mentions.filter((m) => ['assez-bien', 'bien', 'tres-bien'].includes(m.level));
    if (!targets.some((t) => t.min === state.target)) state.target = targets[1] ? targets[1].min : targets[0].min;
    segButtons($('#segT'), targets.map((t) => ({ id: String(t.min), label: `${t.short || t.label} (${t.min})` })), String(state.target), (id) => {
      state.target = Number(id);
      session.patch({ target: state.target });
      calc();
    });

    /* senaryolar */
    const customNote = el('span', { class: 'sub', text: 'Özel — elle değiştirildi', hidden: true });
    const seg = segButtons($('#scen'), SCENARIOS, state.scenario, (id) => applyScenario(id));
    $('#scen').append(customNote);

    function syncRows() {
      for (const [id, r] of Object.entries(rows)) if (E.isNote(state.var[id])) r.set(state.var[id]);
      for (const [id, r] of Object.entries(rows)) {
        const tag = r.el.querySelector('.tag.est');
        if (state.estimated.has(id) && !tag) r.el.querySelector('.name').insertBefore(el('span', { class: 'tag est', text: 'tahmin' }), r.el.querySelector('.name small'));
        if (!state.estimated.has(id) && tag) tag.remove();
      }
    }
    function describeSource() {
      const src = state.source === 'file' ? 'veri dosyasındaki senaryo' : state.source === 'derived' ? 'dosyada senaryo yok; ders ortalamalarından türetildi' : 'veri dosyası + ders ortalamalarından tamamlandı';
      const est = state.estimated.size ? ` · "tahmin" etiketli dersler için henüz not yok (${[...state.estimated].map(labelOf).join(', ')}).` : '';
      $('#scenSource').textContent = `Kaynak: ${src}${est}`;
    }
    function applyScenario(name) {
      const built = E.buildBacNotes(cfg, data, name);
      state.var = pick(built.notes, cfg.subjects.filter((s) => !s.locked));
      state.estimated = new Set(built.estimated);
      state.source = built.source;
      state.scenario = name;
      session.patch({ scenario: name, custom: null });
      seg.set(name);
      customNote.hidden = true;
      syncRows();
      describeSource();
      calc();
    }
    function onEdit(id, v) {
      state.var[id] = v;
      state.scenario = 'custom';
      seg.clear();
      customNote.hidden = false;
      session.patch({ scenario: 'custom', custom: state.var });
      calc();
    }

    /* hesap */
    function calc() {
      const notes = { ...lockedNotes(), ...state.var };
      const T = E.finalBac(cfg, notes);
      $('#final').textContent = fmt(T.final);
      setPill($('#mention'), E.mention(T.raw, cfg));
      $('#lockedAvg').textContent = fmt(T.lockedAvg);
      $('#lockedCoef').textContent = `${T.lockedCoef} katsayı · ${fmt1(T.lockedSum)} puan`;
      $('#restAvg').textContent = fmt(T.restAvg);
      $('#restCoef').textContent = `${T.restCoef} katsayı · ${fmt1(T.restSum)} puan`;
      $('#restTitle').textContent = `Kalan ${T.restCoef} katsayı`;
      $('#lockedSummary').textContent = `1ère'den kilitli ${T.lockedCoef} katsayı${lockedSources.length ? ` (${lockedSources.join(', ')})` : ''}`;
      const nx = E.nextThreshold(T.raw, cfg, T.countedCoef);
      const top = E.leverage(cfg)[0];
      if (nx) {
        $('#nextGap').textContent = `+${fmt1(nx.gapWeighted)} puan`;
        $('#nextLabel').textContent = `${nx.short} (${nx.threshold}) için · ≈ +${fmt(nx.gapWeighted / top.coef)} ${top.label}'de`;
      } else {
        $('#nextGap').textContent = '—';
        $('#nextLabel').textContent = 'En üst eşik aşıldı';
      }
      gauge.update(T.raw);
      for (const [id, r] of Object.entries(rows)) r.update(E.isNote(state.var[id]) ? state.var[id] : r.value, { totalCoef: T.countedCoef });

      const lv = $('#lever');
      lv.textContent = '';
      const items = E.leverage(cfg);
      const maxCoef = items.length ? items[0].coef : 1;
      for (const it of items) {
        const bar = el('span', { class: 'lev' }); bar.style.width = `${(it.coef / maxCoef) * 100}%`;
        lv.append(el('tr', {}, el('td', { text: it.label }), el('td', { class: 'r', text: String(it.coef) }), el('td', { class: 'r', text: `+${fmt(it.coef / T.countedCoef)}` }), el('td', { class: 'lev-cell' }, bar)));
      }

      const sv = $('#solve');
      sv.textContent = '';
      const order = cfg.subjects.filter((s) => !s.locked).sort((a, b) => (a.group === 'exam-tle' ? 0 : 1) - (b.group === 'exam-tle' ? 0 : 1) || b.coef - a.coef);
      for (const s of order) {
        const cur = notes[s.id];
        const need = E.requiredNote(cfg, notes, s.id, state.target);
        let txt, cls;
        if (need === 'unreachable') { txt = 'ulaşılamaz'; cls = 'bad'; }
        else if (need === 'safe') { txt = 'zaten güvende'; cls = 'good'; }
        else { const n = E.ceilToStep(need, 0.25); txt = fmt(n); cls = n > cur ? 'warn' : 'good'; }
        sv.append(el('tr', {}, el('td', { text: s.label }), el('td', { class: 'r', text: fmt(cur) }), el('td', { class: `r ${cls}`, text: txt })));
      }
      if (T.missing.length) $('#scenSource').append(el('span', { class: 'tag', text: `${T.missing.length} not eksik` }));
    }

    /* bu dönemin notları */
    const by = E.gradesBySubject(data.grades);
    const gradesBox = $('#grades');
    gradesBox.textContent = '';
    const periodText = data.period ? `${data.period.index}. ${data.period.type}` : 'dönem';
    const gradeCount = (data.grades || []).length;
    $('#gradesTitle').textContent = `Bu dönemin notları — ${periodText}`;
    $('#gradesSub').textContent = gradeCount ? `${gradeCount} not · ders ortalaması notların katsayılı ortalamasıdır (/20).` : 'Bu dönem için henüz not yok.';
    for (const s of cfg.subjects) {
      const list = by[s.id];
      if (!list) continue;
      const avg = E.weightedAverage(list);
      const tbody = el('tbody');
      for (const g of [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        tbody.append(el('tr', {},
          el('td', { class: 'num', text: fmtDate(g.date) }), el('td', { text: g.label || '' }),
          el('td', { class: 'r', text: fmtNote(g) }), el('td', { class: 'r', text: E.isNote(g.coef) ? String(g.coef) : '1' }),
          el('td', { class: 'r', text: E.isNote(g.classAvg) ? fmt(g.classAvg) : '–' })));
      }
      gradesBox.append(el('article', { class: 'card' },
        el('header', {}, el('h3', { text: s.label }), el('span', { class: 'avg', text: fmt(avg) })),
        el('div', { class: 'tablebox' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Tarih' }), el('th', { text: 'Değerlendirme' }), el('th', { class: 'r', text: 'Not' }), el('th', { class: 'r', text: 'Kats.' }), el('th', { class: 'r', text: 'Sınıf' }))), tbody))));
    }
    const up = (data.upcoming || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $('#upcomingWrap').classList.toggle('hidden', up.length === 0);
    const ul = $('#upcoming');
    ul.textContent = '';
    for (const u of up) ul.append(el('li', { text: `${fmtDate(u.date)} · ${labelOf(u.subjectId)}${u.label ? ` — ${u.label}` : ''}` }));

    /* okuma notları */
    const notesUl = $('#notes');
    notesUl.textContent = '';
    for (const n of [...(data.notes || []), ...GENERIC_NOTES]) notesUl.append(el('li', { text: n }));

    /* başlangıç */
    if (state.scenario === 'custom' && session.get().custom) {
      const built = E.buildBacNotes(cfg, data, 'gercekci');
      state.var = { ...pick(built.notes, cfg.subjects.filter((s) => !s.locked)), ...session.get().custom };
      state.estimated = new Set(built.estimated);
      state.source = built.source;
      seg.clear();
      customNote.hidden = false;
      syncRows();
      describeSource();
      calc();
    } else {
      applyScenario(SCENARIOS.some((s) => s.id === state.scenario) ? state.scenario : 'gercekci');
    }
  }
}

main();
