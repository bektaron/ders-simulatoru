import { boot, el, fmtDateTime, initTheme, Mode, $ } from './ui.js';

initTheme($('#theme'));

const statusBox = $('#status');
const msg = $('#setup-msg');
const form = $('#setup-form');
const tokenInput = $('#token');
const remember = $('#remember');
const setupState = $('#setup-state');

function showMsg(text, kind = '') {
  msg.textContent = text;
  msg.className = `msg ${kind}`.trim();
}
function tokenStateText(client) {
  return client.hasToken()
    ? 'Bu tarayıcıda bir token kayıtlı. Yenisini girerseniz eskisinin yerine geçer.'
    : 'Henüz token yok: sayfalar örnek veriyle açılır.';
}

function statusCard(result, page, label) {
  const mode = result ? result.mode : Mode.ERROR;
  const tone = mode === Mode.LIVE && !result.stale ? 'good' : mode === Mode.DEMO || (result && result.stale) || mode === Mode.CACHED ? 'warn' : mode === Mode.LIVE ? 'good' : 'bad';
  const modeText = {
    [Mode.DEMO]: 'Örnek veri', [Mode.LIVE]: result && result.stale ? 'Güncel değil (7+ gün)' : 'Güncel', [Mode.CACHED]: 'Çevrimdışı önbellek',
    [Mode.AUTH_ERROR]: 'Token geçersiz', [Mode.FORBIDDEN]: 'Erişim reddedildi', [Mode.NOT_FOUND]: 'Dosya bulunamadı',
    [Mode.INVALID_DATA]: 'Dosya şemaya uymuyor', [Mode.ERROR]: 'Okunamadı', [Mode.SETUP]: 'Kurulum gerekli',
  }[mode] || mode;
  return el('div', { class: 'sheet' },
    el('div', { class: 'eyebrow', text: label }),
    el('div', { class: 'mid', text: result && result.data ? result.data.displayName : '–' }),
    el('span', { class: `pill ${tone}`, text: modeText }),
    el('p', { class: 'sub mt', text: result && result.updatedAt ? `Son güncelleme: ${fmtDateTime(result.updatedAt)}` : (result ? result.message : '') }),
    el('p', { class: 'mt' }, el('a', { class: 'btn small', href: page, text: 'Aç' })),
  );
}

async function refreshStatus(client) {
  statusBox.textContent = '';
  const [a, b] = await Promise.all([client.load('A'), client.load('B')]);
  statusBox.append(statusCard(a, 'a-terminale.html', 'Öğrenci A — Terminale'), statusCard(b, 'b-seconde.html', 'Öğrenci B — Seconde'));
  setupState.textContent = tokenStateText(client);
  return { a, b };
}

async function main() {
  let ctx;
  try {
    ctx = await boot({ student: null, configs: { A: 'config/bac-2027.json', B: 'config/seconde-2026.json' }, validateWith: { A: 'A', B: 'B' } });
  } catch (e) {
    statusBox.append(el('div', { class: 'banner error' }, el('span', { class: 'label', text: 'Sorun' }), el('span', { text: 'Yapılandırma dosyaları yüklenemedi. Sayfa bir HTTP sunucusundan açılmalı (file:// çalışmaz).' })));
    return;
  }
  const { client, source } = ctx;
  $('#repo-name').textContent = `${source.owner}/${source.repo}`;
  await refreshStatus(client);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const token = tokenInput.value;
    tokenInput.value = '';
    $('#connect').disabled = true;
    showMsg('Bağlanıyor…');
    try {
      const a = await client.verifyToken(token, 'A');
      if (!a.ok) {
        showMsg(`a.json: ${a.message}`, 'bad');
        return;
      }
      client.setToken(token, { remember: remember.checked });
      const b = await client.verifyToken(token, 'B');
      showMsg(b.ok
        ? 'Bağlantı başarılı: a.json ve b.json okundu. Token bu tarayıcıya kaydedildi.'
        : `a.json okundu ve token kaydedildi. b.json: ${b.message}`, b.ok ? 'ok' : '');
      await refreshStatus(client);
    } catch {
      showMsg('Beklenmeyen bir hata oluştu.', 'bad');
    } finally {
      $('#connect').disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    client.logout();
    showMsg('Token ve önbellek bu tarayıcıdan silindi. Sayfalar örnek veriyle açılır.', 'ok');
    await refreshStatus(client);
  });

  if (location.hash === '#kurulum') tokenInput.focus();
}

main();
