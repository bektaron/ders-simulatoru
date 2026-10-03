import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataClient, Mode, KEYS, isStale, isValidTokenFormat, classifyResponse, buildRequest } from '../docs/data.js';
import { validate, validateNotes, assertSupported, checkAgainstConfig } from '../docs/validate.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('../docs/schema/notes.schema.json');
const cfgA = read('../docs/config/bac-2027.json');
const cfgB = read('../docs/config/seconde-2026.json');
const source = read('../docs/config/data-source.json');
const exA = read('../docs/examples/a.example.json');
const exB = read('../docs/examples/b.example.json');

const TOKEN = 'github_pat_' + 'A'.repeat(40);
const NOW = Date.parse('2026-10-03T12:00:00Z');

function memStorage({ throwOnSet = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceeded'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

function fakeFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('kuyruk boş: ' + url);
    if (next.throw) throw new TypeError('Failed to fetch');
    const headers = new Map(Object.entries(next.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const validateData = (student, data) => validateNotes(data, student === 'A' ? cfgA : cfgB, schema).errors;

function client(queue, { storage = memStorage(), session = memStorage(), token } = {}) {
  const fetch = fakeFetch(queue);
  const c = createDataClient({ fetch, storage, sessionStorage: session, now: () => NOW, source, validateData, demoBase: './examples/' });
  if (token) c.setToken(token);
  return { c, fetch, storage, session };
}

test('şema: desteklenen anahtarlar, örnekler geçerli, bozuk veri yakalanır', () => {
  assertSupported(schema);
  assert.equal(validateNotes(exA, cfgA, schema).valid, true);
  assert.equal(validateNotes(exB, cfgB, schema).valid, true);
  const bad = { ...exA, grades: [{ date: '2026-13-40', subjectId: 'Yok!', note: 125 }], extra: 1 };
  const r = validate(schema, bad);
  assert.equal(r.valid, false);
  const kws = r.errors.map((e) => e.keyword);
  assert.ok(kws.includes('format'));
  assert.ok(kws.includes('pattern'));
  assert.ok(kws.includes('maximum'));
  assert.ok(kws.includes('additionalProperties'));
  assert.ok(validate(schema, { ...exA, updatedAt: 'dün' }).errors.some((e) => e.path === '/updatedAt'));
  assert.ok(validate(schema, { ...exA, grades: [{ date: '2026-09-01', subjectId: 'spe1', note: null }] }).valid);
});

test('config çapraz kontrol: bilinmeyen ders, B\'de locked, katsayı uyuşmazlığı, not > baraj', () => {
  const e1 = checkAgainstConfig({ ...exA, grades: [{ date: '2026-09-01', subjectId: 'bilinmeyen', note: 10 }] }, cfgA);
  assert.ok(e1.some((e) => e.path === '/grades/0/subjectId'));
  const e2 = checkAgainstConfig({ ...exB, locked: [{ id: 'fr', note: 12 }] }, cfgB);
  assert.ok(e2.some((e) => e.path === '/locked'));
  const e3 = checkAgainstConfig({ ...exA, locked: [{ id: 'fr_e', note: 12, coef: 4 }] }, cfgA);
  assert.ok(e3.some((e) => e.path === '/locked/0/coef'));
  const e4 = checkAgainstConfig({ ...exA, grades: [{ date: '2026-09-01', subjectId: 'spe1', note: 9, outOf: 5 }] }, cfgA);
  assert.ok(e4.some((e) => e.path === '/grades/0/note'));
  const e5 = checkAgainstConfig({ ...exA, scenarios: { kotu: { fr_e: 10 } } }, cfgA);
  assert.ok(e5.some((e) => e.path === '/scenarios/kotu/fr_e'));
  assert.deepEqual(checkAgainstConfig(exA, cfgA), []);
});

test('saf yardımcılar: token biçimi, isStale, classifyResponse, buildRequest', () => {
  assert.equal(isValidTokenFormat(TOKEN), true);
  assert.equal(isValidTokenFormat('ghp_' + 'x'.repeat(36)), true);
  assert.equal(isValidTokenFormat('hello'), false);
  assert.equal(isValidTokenFormat(' github_pat_' + 'B'.repeat(40) + ' '), true);
  assert.equal(isStale('2026-09-25T12:00:00Z', NOW), true);  // 8 gün
  assert.equal(isStale('2026-09-27T12:00:00Z', NOW), false); // 6 gün
  assert.equal(isStale('garbage', NOW), true);
  assert.equal(classifyResponse(401).mode, Mode.AUTH_ERROR);
  assert.equal(classifyResponse(404).mode, Mode.NOT_FOUND);
  assert.deepEqual(classifyResponse(403, { get: () => '0' }), { mode: Mode.FORBIDDEN, rateLimited: true });
  assert.equal(classifyResponse(500).mode, Mode.ERROR);
  const { url, init } = buildRequest(source, 'a.json', TOKEN, 'W/"abc"');
  assert.equal(url, 'https://api.github.com/repos/bektaron/ders-simulatoru-veri/contents/a.json?ref=main');
  assert.equal(init.method, 'GET');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers.Accept, 'application/vnd.github.raw+json');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers['If-None-Match'], 'W/"abc"');
  assert.ok(!url.includes(TOKEN));
});

test('token yok → DEMO: örnek dosya istenir, önbellek yazılmaz', async () => {
  const { c, fetch, storage } = client([{ status: 200, body: exA }]);
  const r = await c.load('A');
  assert.equal(r.mode, Mode.DEMO);
  assert.equal(fetch.calls[0].url, './examples/a.example.json');
  assert.equal(r.data.displayName, 'Öğrenci A');
  assert.equal(r.stale, false);
  assert.equal(storage.getItem(KEYS.cache('A')), null);
});

test('200 geçerli → LIVE, önbellek yazılır, başlıklar doğru', async () => {
  const { c, fetch, storage } = client([{ status: 200, body: exA, headers: { ETag: 'W/"e1"' } }], { token: TOKEN });
  const r = await c.load('A');
  assert.equal(r.mode, Mode.LIVE);
  assert.equal(r.status, 200);
  assert.equal(r.fetchedAt, NOW);
  assert.equal(r.updatedAt, exA.updatedAt);
  assert.equal(r.stale, false); // 2026-09-28 → 2026-10-03: 5 gün
  const call = fetch.calls[0];
  assert.ok(call.url.startsWith('https://api.github.com/repos/bektaron/ders-simulatoru-veri/contents/a.json'));
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(call.init.cache, 'no-store');
  const cached = JSON.parse(storage.getItem(KEYS.cache('A')));
  assert.equal(cached.etag, 'W/"e1"');
  assert.equal(cached.fetchedAt, NOW);
  assert.equal(cached.data.student, 'A');
});

test('7 günden eski updatedAt → stale true (yalnız LIVE/CACHED)', async () => {
  const old = { ...exA, updatedAt: '2026-09-20T10:00:00+03:00' };
  const { c } = client([{ status: 200, body: old }], { token: TOKEN });
  assert.equal((await c.load('A')).stale, true);
  const { c: demo } = client([{ status: 200, body: old }]);
  assert.equal((await demo.load('A')).stale, false);
});

test('200 ama şema hatalı → INVALID_DATA, önbellek bozulmaz', async () => {
  const { c, storage } = client([{ status: 200, body: exA }, { status: 200, body: { hello: 1 } }], { token: TOKEN });
  await c.load('A');
  const r = await c.load('A');
  assert.equal(r.mode, Mode.INVALID_DATA);
  assert.ok(r.errors.length > 0);
  assert.equal(r.fromCache, true);
  assert.equal(JSON.parse(storage.getItem(KEYS.cache('A'))).data.student, 'A');
});

test('304 → önbellek, fetchedAt yenilenir, If-None-Match gönderilir', async () => {
  const { c, fetch } = client([{ status: 200, body: exA, headers: { ETag: 'W/"e1"' } }, { status: 304 }], { token: TOKEN });
  await c.load('A');
  const r = await c.load('A');
  assert.equal(r.mode, Mode.LIVE);
  assert.equal(r.status, 304);
  assert.equal(r.fromCache, true);
  assert.equal(fetch.calls[1].init.headers['If-None-Match'], 'W/"e1"');
});

test('401 → AUTH_ERROR, token silinir, önbellek kalır', async () => {
  const { c, storage } = client([{ status: 200, body: exA }, { status: 401 }], { token: TOKEN });
  await c.load('A');
  const r = await c.load('A');
  assert.equal(r.mode, Mode.AUTH_ERROR);
  assert.equal(c.hasToken(), false);
  assert.equal(storage.getItem(KEYS.token), null);
  assert.equal(r.fromCache, true);
  assert.equal(r.data.student, 'A');
});

test('403 oran sınırı → FORBIDDEN rateLimited, token kalır', async () => {
  const { c } = client([{ status: 403, headers: { 'X-RateLimit-Remaining': '0' } }], { token: TOKEN });
  const r = await c.load('A');
  assert.equal(r.mode, Mode.FORBIDDEN);
  assert.equal(r.rateLimited, true);
  assert.match(r.message, /sınır/);
  assert.equal(c.hasToken(), true);
});

test('404 → NOT_FOUND, token kalır', async () => {
  const { c } = client([{ status: 404 }], { token: TOKEN });
  const r = await c.load('B');
  assert.equal(r.mode, Mode.NOT_FOUND);
  assert.equal(c.hasToken(), true);
});

test('ağ hatası + önbellek → CACHED; önbelleksiz → ERROR', async () => {
  const { c } = client([{ status: 200, body: exA }, { throw: true }], { token: TOKEN });
  await c.load('A');
  const r = await c.load('A');
  assert.equal(r.mode, Mode.CACHED);
  assert.equal(r.fromCache, true);
  assert.equal(r.fetchedAt, NOW);
  const { c: c2 } = client([{ throw: true }], { token: TOKEN });
  const r2 = await c2.load('A');
  assert.equal(r2.mode, Mode.ERROR);
  assert.equal(r2.data, null);
});

test('logout: token + önbellekler + oturum verisi silinir', async () => {
  const { c, storage, session } = client([{ status: 200, body: exA }, { status: 200, body: exB }], { token: TOKEN });
  await c.load('A');
  await c.load('B');
  session.setItem(KEYS.session('A'), '{"x":1}');
  c.logout();
  assert.equal(c.hasToken(), false);
  assert.equal(storage.getItem(KEYS.cache('A')), null);
  assert.equal(storage.getItem(KEYS.cache('B')), null);
  assert.equal(session.getItem(KEYS.session('A')), null);
});

test('setItem fırlatsa da LIVE döner; remember=false token\'ı sessionStorage\'a koyar', async () => {
  const storage = memStorage({ throwOnSet: true });
  const session = memStorage();
  const { c } = client([{ status: 200, body: exA }], { storage, session });
  assert.equal(c.setToken(TOKEN, { remember: false }), true);
  assert.equal(session.getItem(KEYS.token), TOKEN);
  const r = await c.load('A');
  assert.equal(r.mode, Mode.LIVE);
  assert.equal(c.setToken('kötü'), false);
});

test('verifyToken: biçim reddi fetch yapmaz; 404 → ok:false; 200 → ok:true; token saklanmaz', async () => {
  const { c, fetch } = client([{ status: 404 }, { status: 200, body: exA }]);
  const bad = await c.verifyToken('abc');
  assert.equal(bad.ok, false);
  assert.equal(fetch.calls.length, 0);
  const nf = await c.verifyToken(TOKEN);
  assert.equal(nf.ok, false);
  assert.equal(nf.mode, Mode.NOT_FOUND);
  const ok = await c.verifyToken(TOKEN);
  assert.equal(ok.ok, true);
  assert.equal(c.hasToken(), false);
});

test('token hiçbir sonuç metninde görünmez', async () => {
  const results = [];
  for (const q of [[{ status: 200, body: exA }], [{ status: 401 }], [{ status: 403 }], [{ status: 404 }], [{ status: 500 }], [{ throw: true }], [{ status: 200, body: 'not json' }]]) {
    const { c } = client(q, { token: TOKEN });
    results.push(await c.load('A'));
  }
  const { c } = client([{ status: 401 }]);
  results.push(await c.verifyToken(TOKEN));
  for (const r of results) assert.ok(!JSON.stringify(r).includes(TOKEN));
});
