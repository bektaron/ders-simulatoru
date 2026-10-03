/**
 * Veri katmanı: private veri reposundan SALT-OKUNUR okuma, token ve önbellek.
 *
 * Site veri reposuna hiçbir zaman yazmaz; bu dosyada yalnız GET vardır.
 * Token hiçbir zaman URL'ye, konsola veya hata metnine yazılmaz: mesajlar
 * yalnız HTTP durum kodundan üretilir.
 *
 *   createDataClient({ fetch, storage, sessionStorage, now, source, demoBase, validateData })
 *     .hasToken() .setToken(t, {remember}) .clearToken()
 *     .verifyToken(t, student) → { ok, mode, status, message, errors }
 *     .load(student)           → Result
 *     .readCache(student) .clearCache(student?) .logout()
 *
 *   Result = { student, mode, status, data|null, fetchedAt, updatedAt, stale,
 *              fromCache, errors, message, rateLimited }
 */

export const Mode = Object.freeze({
  SETUP: 'setup',             // token yok ve demo da yüklenemedi
  DEMO: 'demo',               // token yok → örnek veri
  LIVE: 'live',               // veri reposundan taze okuma (veya 304 → önbellek güncel)
  CACHED: 'cached',           // ağ yok → önbellekteki son veri
  AUTH_ERROR: 'auth-error',   // 401: token geçersiz / süresi dolmuş (token silinir)
  FORBIDDEN: 'forbidden',     // 403: yetki yok veya oran sınırı
  NOT_FOUND: 'not-found',     // 404: dosya yok ya da token bu repoyu göremiyor
  INVALID_DATA: 'invalid-data', // 200 ama JSON/şema hatalı
  ERROR: 'error',             // diğer
});

export const KEYS = Object.freeze({
  token: 'ds:v1:token',
  cache: (student) => `ds:v1:cache:${student}`,
  session: (student) => `ds:v1:session:${student}`,
});

export const API_VERSION = '2022-11-28';
export const STALE_DAYS = 7;

/* ------------------------------------------------------------------ */
/* Saf yardımcılar                                                     */
/* ------------------------------------------------------------------ */

/** Fine-grained (github_pat_…) veya klasik (ghp_…) PAT biçimi. */
export function isValidTokenFormat(t) {
  if (typeof t !== 'string') return false;
  const s = t.trim();
  return /^github_pat_[A-Za-z0-9_]{30,}$/.test(s) || /^ghp_[A-Za-z0-9]{30,}$/.test(s);
}

/** updatedAt `days` günden eskiyse (veya okunamıyorsa) true. */
export function isStale(updatedAt, nowMs = Date.now(), days = STALE_DAYS) {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > days * 86400000;
}

export function buildRequest(source, file, token, etag) {
  const url = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${encodeURI(file)}?ref=${encodeURIComponent(source.branch || 'main')}`;
  const headers = {
    Accept: 'application/vnd.github.raw+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (etag) headers['If-None-Match'] = etag;
  return { url, init: { method: 'GET', headers, cache: 'no-store' } };
}

function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : null;
}

/** HTTP durumunu moda çevirir; 403'te oran sınırı ayrımı yapar. */
export function classifyResponse(status, headers) {
  if (status === 200 || status === 304) return { mode: Mode.LIVE, rateLimited: false };
  if (status === 401) return { mode: Mode.AUTH_ERROR, rateLimited: false };
  if (status === 403) {
    const remaining = headerOf(headers, 'x-ratelimit-remaining');
    return { mode: Mode.FORBIDDEN, rateLimited: remaining === '0' };
  }
  if (status === 404) return { mode: Mode.NOT_FOUND, rateLimited: false };
  return { mode: Mode.ERROR, rateLimited: false };
}

/** Kullanıcıya gösterilecek metin. Yalnız mod ve durum kodundan üretilir. */
export function safeMessage(mode, { status, rateLimited, fromCache } = {}) {
  switch (mode) {
    case Mode.DEMO: return 'ÖRNEK VERİ — token girilmediği için uydurma örnek notlar gösteriliyor.';
    case Mode.LIVE: return 'Veri reposundan okundu.';
    case Mode.CACHED: return 'Çevrimdışı — önbellekteki son veri gösteriliyor.';
    case Mode.AUTH_ERROR: return 'Token geçersiz ya da süresi dolmuş. Yeni bir salt-okunur token oluşturup kurulum ekranından girin.';
    case Mode.FORBIDDEN: return rateLimited
      ? 'GitHub API istek sınırına ulaşıldı; biraz sonra yeniden deneyin.'
      : 'Erişim reddedildi (403). Token yetkilerini kontrol edin.';
    case Mode.NOT_FOUND: return 'Veri dosyası bulunamadı (404): dosya henüz yok ya da token bu repoyu göremiyor.';
    case Mode.INVALID_DATA: return 'Veri dosyası okunabildi ama şemaya uymuyor. Ayrıntılar aşağıda.';
    case Mode.SETUP: return 'Henüz token girilmedi.';
    default: return `Veri okunamadı${status ? ` (HTTP ${status})` : ''}${fromCache ? '; önbellek gösteriliyor' : ''}.`;
  }
}

/* ------------------------------------------------------------------ */
/* Güvenli depolama                                                    */
/* ------------------------------------------------------------------ */

export function safeStorage(store) {
  return {
    get(key) {
      try { return store ? store.getItem(key) : null; } catch { return null; }
    },
    set(key, value) {
      try { if (store) { store.setItem(key, value); return true; } } catch { /* yoksay */ }
      return false;
    },
    remove(key) {
      try { if (store) store.removeItem(key); } catch { /* yoksay */ }
    },
  };
}

/* ------------------------------------------------------------------ */
/* İstemci                                                             */
/* ------------------------------------------------------------------ */

export function createDataClient({
  fetch: fetchFn,
  storage,
  sessionStorage: sessionStore,
  now = () => Date.now(),
  source,
  demoBase = './examples/',
  validateData = () => [],
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch gerekli');
  if (!source || !source.owner || !source.repo || !source.files) throw new Error('data-source config gerekli');
  const local = safeStorage(storage);
  const session = safeStorage(sessionStore);

  function getToken() {
    const s = session.get(KEYS.token);
    if (s) return s;
    return local.get(KEYS.token);
  }
  function hasToken() { return !!getToken(); }
  function setToken(token, { remember = true } = {}) {
    const t = String(token || '').trim();
    if (!isValidTokenFormat(t)) return false;
    session.remove(KEYS.token);
    local.remove(KEYS.token);
    return remember ? local.set(KEYS.token, t) : session.set(KEYS.token, t);
  }
  function clearToken() {
    session.remove(KEYS.token);
    local.remove(KEYS.token);
  }

  function readCache(student) {
    const raw = local.get(KEYS.cache(student));
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      return c && c.data ? c : null;
    } catch { return null; }
  }
  function writeCache(student, entry) {
    return local.set(KEYS.cache(student), JSON.stringify(entry));
  }
  function clearCache(student) {
    const list = student ? [student] : Object.keys(source.files);
    for (const s of list) local.remove(KEYS.cache(s));
  }
  function logout() {
    clearToken();
    clearCache();
    for (const s of Object.keys(source.files)) session.remove(KEYS.session(s));
  }

  function result(student, mode, extra = {}) {
    const data = extra.data || null;
    const updatedAt = data && typeof data.updatedAt === 'string' ? data.updatedAt : null;
    const liveish = mode === Mode.LIVE || mode === Mode.CACHED;
    return {
      student,
      mode,
      status: extra.status ?? null,
      data,
      fetchedAt: extra.fetchedAt ?? null,
      updatedAt,
      stale: liveish && updatedAt ? isStale(updatedAt, now()) : false,
      fromCache: !!extra.fromCache,
      errors: extra.errors || [],
      rateLimited: !!extra.rateLimited,
      message: extra.message || safeMessage(mode, { status: extra.status, rateLimited: extra.rateLimited, fromCache: extra.fromCache }),
    };
  }

  async function parseBody(res, student) {
    let text;
    try { text = await res.text(); } catch { return { errors: [{ path: '', keyword: 'read', message: 'gövde okunamadı' }] }; }
    let data;
    try { data = JSON.parse(text); } catch { return { errors: [{ path: '', keyword: 'json', message: 'geçerli JSON değil' }] }; }
    const errors = validateData(student, data) || [];
    return errors.length ? { errors, data: null } : { errors: [], data };
  }

  async function loadDemo(student) {
    const file = `${demoBase}${student.toLowerCase()}.example.json`;
    try {
      const res = await fetchFn(file, { method: 'GET', cache: 'no-store' });
      if (!res.ok) return result(student, Mode.SETUP, { status: res.status, message: 'Örnek veri yüklenemedi.' });
      const parsed = await parseBody(res, student);
      if (!parsed.data) return result(student, Mode.INVALID_DATA, { status: res.status, errors: parsed.errors });
      return result(student, Mode.DEMO, { status: res.status, data: parsed.data, fetchedAt: now() });
    } catch {
      return result(student, Mode.SETUP, { message: 'Örnek veri yüklenemedi (ağ).' });
    }
  }

  /** Veriyi okur. Token yoksa demo; ağ yoksa önbellek. */
  async function load(student) {
    const file = source.files[student];
    if (!file) throw new Error(`Bilinmeyen öğrenci: ${student}`);
    const token = getToken();
    if (!token) return loadDemo(student);

    const cached = readCache(student);
    const { url, init } = buildRequest(source, file, token, cached ? cached.etag : null);
    let res;
    try {
      res = await fetchFn(url, init);
    } catch {
      if (cached) return result(student, Mode.CACHED, { data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true });
      return result(student, Mode.ERROR, { message: 'Ağa ulaşılamadı ve önbellekte veri yok.' });
    }

    const { mode, rateLimited } = classifyResponse(res.status, res.headers);
    if (res.status === 304 && cached) {
      const entry = { ...cached, fetchedAt: now() };
      writeCache(student, entry);
      return result(student, Mode.LIVE, { status: 304, data: cached.data, fetchedAt: entry.fetchedAt, fromCache: true });
    }
    if (res.status === 200 || res.status === 304) {
      // 304 ama önbellek yok: etag'sız yeniden iste.
      if (res.status === 304) {
        const plain = buildRequest(source, file, token, null);
        try { res = await fetchFn(plain.url, plain.init); } catch { return result(student, Mode.ERROR); }
        if (res.status !== 200) return result(student, classifyResponse(res.status, res.headers).mode, { status: res.status });
      }
      const parsed = await parseBody(res, student);
      if (!parsed.data) {
        return result(student, Mode.INVALID_DATA, {
          status: 200, errors: parsed.errors,
          data: cached ? cached.data : null, fromCache: !!cached, fetchedAt: cached ? cached.fetchedAt : null,
        });
      }
      const etag = headerOf(res.headers, 'etag');
      const entry = { fetchedAt: now(), etag: etag || null, data: parsed.data };
      writeCache(student, entry);
      return result(student, Mode.LIVE, { status: 200, data: parsed.data, fetchedAt: entry.fetchedAt });
    }
    if (mode === Mode.AUTH_ERROR) clearToken();
    return result(student, mode, {
      status: res.status,
      rateLimited,
      data: cached ? cached.data : null,
      fromCache: !!cached,
      fetchedAt: cached ? cached.fetchedAt : null,
    });
  }

  /** Kurulum ekranı: token'ı saklamadan dener. */
  async function verifyToken(token, student = 'A') {
    const t = String(token || '').trim();
    if (!isValidTokenFormat(t)) {
      return { ok: false, mode: Mode.AUTH_ERROR, status: null, message: 'Token biçimi tanınmadı. Fine-grained token "github_pat_" ile başlar.', errors: [] };
    }
    const file = source.files[student];
    const { url, init } = buildRequest(source, file, t, null);
    let res;
    try { res = await fetchFn(url, init); } catch {
      return { ok: false, mode: Mode.ERROR, status: null, message: 'Ağa ulaşılamadı.', errors: [] };
    }
    const { mode, rateLimited } = classifyResponse(res.status, res.headers);
    if (res.status !== 200) return { ok: false, mode, status: res.status, message: safeMessage(mode, { status: res.status, rateLimited }), errors: [] };
    const parsed = await parseBody(res, student);
    if (!parsed.data) return { ok: false, mode: Mode.INVALID_DATA, status: 200, message: safeMessage(Mode.INVALID_DATA), errors: parsed.errors };
    return { ok: true, mode: Mode.LIVE, status: 200, message: 'Bağlantı başarılı.', errors: [], data: parsed.data };
  }

  return { hasToken, setToken, clearToken, verifyToken, load, loadDemo, readCache, clearCache, logout };
}
