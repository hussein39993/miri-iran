'use strict';
// Backend tests. NOTE: tests that use a fake provider (documented mock provider, see tests/helpers/charter724-mock.js) verify OUR code's behaviour
// (token cache, retry, error mapping, normalisation). They are NOT evidence of how the real Charter724 API behaves.
const assert = require('assert'), http = require('http');
const { loadConfig, liveProblems, parseEnv } = require('../server/config');
const { redact, createLogger } = require('../server/redact');
const { toToman } = require('../server/currency');
const { validateFlightSearch } = require('../server/validate');
const { TokenManager } = require('../server/charter724/tokens');
const { Charter724Adapter } = require('../server/charter724/adapter');
const { createApp } = require('../server/app');
const { execFileSync } = require('child_process'), path = require('path');
let pass = 0, fail = 0, queue = []; const ok = (n, fn) => queue.push([n, fn]);
const cfgOf = (o = {}) => loadConfig({ ...o }, null);
const H = require('./helpers/charter724-mock.js'); // documented mock provider (built from docs/charter724-openapi.json)
const EMPTY_MAPPING = { auth: { steps: [] }, flightSearch: null, airports: null };
const liveCfg = (extra = {}) => cfgOf({ APP_MODE: 'live', CHARTER724_BASE_URL: 'https://prov.example', CHARTER724_USERNAME: 'user1', CHARTER724_PASSWORD: 'SECRETPW', ...extra });
function fakeFetch(handler) { const calls = []; const f = async (url, opt) => { const c = { url: String(url), method: opt.method, headers: opt.headers, body: opt.body ? JSON.parse(opt.body) : undefined }; calls.push(c); const r = await handler(c, calls.length); return { status: r.status || 200, json: async () => { if (r.bad) throw new Error('bad json'); return r.body; } }; }; f.calls = calls; return f; }
const silent = { info() { }, warn() { }, error() { } };
async function serve(app) { const s = http.createServer(app.handler); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; return { port, close: () => new Promise(r => s.close(r)), req: (method, p, body, raw) => new Promise((res, rej) => { const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {} }, r => { let d = ''; r.on('data', x => d += x); r.on('end', () => res({ status: r.statusCode, headers: r.headers, text: d, json: () => JSON.parse(d) })); }); rq.on('error', rej); if (body !== undefined) rq.write(raw ? body : JSON.stringify(body)); rq.end(); }) }; }
const goodQ = { from: 'THR', to: 'NJF', date: '2099-05-01', adults: 1 };

ok('config: defaults to demo; only exact "live" enables live; .env parser works', () => {
  assert.strictEqual(cfgOf().mode, 'demo'); assert.strictEqual(cfgOf({ APP_MODE: 'LIVE ' }).mode, 'demo'); assert.strictEqual(cfgOf({ APP_MODE: 'live' }).mode, 'live');
  assert.deepStrictEqual(parseEnv('# c\nA=1\nB="two words"\n\nC=x=y'), { A: '1', B: 'two words', C: 'x=y' }); assert.strictEqual(cfgOf().allowLiveTransactions, false);
});
ok('config: live problems list missing items and rejects non-https', () => {
  assert(liveProblems(cfgOf({ APP_MODE: 'live' }), false).length >= 4);
  assert(liveProblems(liveCfg({ CHARTER724_BASE_URL: 'http://evil.example' }), true).some(x => /https/.test(x)));
  assert.deepStrictEqual(liveProblems(liveCfg(), true), []);
});
ok('redact: removes passwords, tokens and bearer strings, keeps normal data', () => {
  const r = redact({ password: 'p', nested: { access_token: 't', Authorization: 'Bearer abc.def', ok: 'fine' }, list: [{ apiKey: 'k' }], msg: 'sent Bearer xyz123 now' });
  const s = JSON.stringify(r); assert(!/"p"|"t"|abc\.def|"k"|xyz123/.test(s)); assert.strictEqual(r.nested.ok, 'fine');
});
ok('logger output never contains secrets', () => { const out = []; const l = createLogger(s => out.push(s)); l.info('login', { password: 'TOPSECRET', headers: { Authorization: 'Bearer TOPSECRET' } }); assert(!out.join('').includes('TOPSECRET')); });
ok('currency: rial is divided by 10, toman untouched, unknown flagged, never equal', () => {
  assert.strictEqual(toToman(25000000, 'IRR').amountToman, 2500000); assert.strictEqual(toToman(2500000, 'IRT').amountToman, 2500000); assert.strictEqual(toToman(2500000, 'toman').converted, false);
  assert.strictEqual(toToman(10, 'USD').amountToman, null); assert.strictEqual(toToman(10, 'USD').reason, 'unsupported_currency'); assert.strictEqual(toToman(-1, 'IRR').amountToman, null); assert.strictEqual(toToman('abc', 'IRR').amountToman, null);
});
ok('validation: accepts a good request and normalises codes', () => { const v = validateFlightSearch({ ...goodQ, from: ' thr ' }, '2099-01-01'); assert.strictEqual(v.from, 'THR'); assert.strictEqual(v.cabin, 'economy'); assert.strictEqual(v.trip, 'oneway'); });
ok('validation: rejects invalid airports, same airport, bad/past dates, bad pax, bad cabin, round trip without return', () => {
  const bad = (o, field) => { try { validateFlightSearch({ ...goodQ, ...o }, '2099-01-01'); } catch (e) { assert.strictEqual(e.status, 400); assert(e.fields[field], field + ' expected in ' + JSON.stringify(e.fields)); return; } assert.fail('accepted: ' + JSON.stringify(o)); };
  bad({ from: 'TEHRAN' }, 'from'); bad({ to: '12' }, 'to'); bad({ to: 'THR' }, 'to'); bad({ date: '2099-02-30' }, 'date'); bad({ date: '2098-12-31' }, 'date'); bad({ date: 'tomorrow' }, 'date');
  bad({ adults: 0 }, 'passengers'); bad({ adults: 1, infants: 2 }, 'passengers'); bad({ adults: '1' }, 'passengers'); bad({ adults: 5, children: 5 }, 'passengers'); bad({ cabin: 'first' }, 'cabin');
  bad({ trip: 'round' }, 'returnDate'); bad({ trip: 'round', returnDate: '2099-04-01', date: '2099-05-01' }, 'returnDate'); bad({ trip: 'multi' }, 'trip');
  assert.throws(() => validateFlightSearch(null, '2099-01-01'));
});
ok('tokens: cached until near expiry, then refreshed', async () => {
  let n = 0, t = 1000; const tm = new TokenManager({ login: async () => ({ token: 'T' + (++n), ttlMs: 100000 }), now: () => t });
  assert.strictEqual(await tm.getToken(), 'T1'); assert.strictEqual(await tm.getToken(), 'T1'); t += 60000; assert.strictEqual(await tm.getToken(), 'T1'); t += 20000; assert.strictEqual(await tm.getToken(), 'T2'); assert.strictEqual(n, 2);
});
ok('tokens: concurrent callers share ONE login; invalidate forces a new one; failures are not cached', async () => {
  let n = 0; const tm = new TokenManager({ login: async () => { n++; await new Promise(r => setTimeout(r, 20)); return { token: 'T' + n }; } });
  const r = await Promise.all([1, 2, 3, 4, 5].map(() => tm.getToken())); assert(r.every(x => x === 'T1')); assert.strictEqual(n, 1); tm.invalidate(); assert.strictEqual(await tm.getToken(), 'T2');
  let fails = 0; const t2 = new TokenManager({ login: async () => { if (fails++ < 1) throw new Error('x'); return { token: 'OK' }; } }); await assert.rejects(t2.getToken()); assert.strictEqual(await t2.getToken(), 'OK');
});
ok('HTTP demo mode: health/config expose no secrets; search returns flagged demo results; prices are toman examples', async () => {
  const s = await serve(createApp(cfgOf({ CHARTER724_PASSWORD: 'SECRETPW', CHARTER724_USERNAME: 'demo' }), { logger: silent }));
  try {
    const h = await s.req('GET', '/api/health'); assert.strictEqual(h.status, 200); assert.strictEqual(h.json().mode, 'demo'); assert.strictEqual(h.json().liveFlights, false); assert(!h.text.includes('SECRETPW') && !h.text.includes('demo"'.slice(0, 0) + 'password'));
    const c = await s.req('GET', '/api/config'); assert(!c.text.includes('SECRETPW'));
    const r = await s.req('POST', '/api/flights/search', goodQ); assert.strictEqual(r.status, 200); const j = r.json(); assert.strictEqual(j.source, 'demo'); assert.strictEqual(j.fictional, true); assert.strictEqual(j.results.length, 3);
    assert(j.results.every(x => x.fictional && x.source === 'demo' && x.price.example && x.price.currency === 'IRT' && x.price.amountToman > 0 && /^Demo Air/.test(x.airline)));
    const rt = await s.req('POST', '/api/flights/search', { ...goodQ, trip: 'round', returnDate: '2099-05-09' }); assert.strictEqual(rt.json().results[0].price.amountToman, j.results[0].price.amountToman * 2);
    const bz = await s.req('POST', '/api/flights/search', { ...goodQ, cabin: 'business' }); assert(bz.json().results[0].price.amountToman > j.results[0].price.amountToman);
  } finally { await s.close(); }
});
ok('HTTP: validation errors are 400 with field names; invalid JSON 400; oversize 413; wrong method 405; unknown route 404', async () => {
  const s = await serve(createApp(cfgOf(), { logger: silent }));
  try {
    const a = await s.req('POST', '/api/flights/search', { ...goodQ, from: 'XX' }); assert.strictEqual(a.status, 400); assert.strictEqual(a.json().error.code, 'VALIDATION_ERROR'); assert(a.json().error.fields.from);
    assert.strictEqual((await s.req('POST', '/api/flights/search', '{bad', true)).status, 400); assert.strictEqual((await s.req('POST', '/api/flights/search', JSON.stringify({ pad: 'x'.repeat(20000) }), true).catch(() => ({ status: 413 }))).status, 413);
    assert.strictEqual((await s.req('GET', '/api/flights/search')).status, 405); assert.strictEqual((await s.req('GET', '/api/nope')).status, 404); assert.strictEqual((await s.req('GET', '/api/bookings')).status, 405);
  } finally { await s.close(); }
});
ok('HTTP live mode with an EMPTY mapping: search and airports are 503 (never silently falls back to demo data); health says not ready', async () => {
  const s = await serve(createApp(liveCfg(), { logger: silent, mapping: EMPTY_MAPPING }));
  try { for (const [m, p, b] of [['POST', '/api/flights/search', goodQ], ['GET', '/api/airports']]) { const r = await s.req(m, p, b); assert.strictEqual(r.status, 503); assert.strictEqual(r.json().error.code, 'PROVIDER_NOT_CONFIGURED'); assert(!r.text.includes('fictional')); }
    const h = (await s.req('GET', '/api/health')).json(); assert.strictEqual(h.liveFlights, false); assert.strictEqual(h.providerConfigured, false); } finally { await s.close(); }
});
ok('HTTP live mode with the documented mapping and mock provider: provider-sourced results, round trip, airports; provider failure becomes a safe 502 without leaking secrets', async () => {
  const prov = H.provider(), cfg = liveCfg(), ad = new Charter724Adapter({ cfg, mapping: require('../server/charter724/mapping.json'), fetchImpl: H.fakeFetchFor(prov), logger: silent });
  const s = await serve(createApp(cfg, { logger: silent, charter724: ad }));
  try {
    const r = await s.req('POST', '/api/flights/search', goodQ); assert.strictEqual(r.status, 200); const j = r.json(); assert.strictEqual(j.source, 'charter724'); assert.strictEqual(j.fictional, false); assert(j.results.length >= 1); assert(!r.text.includes('SECRETPW')); assert(!/TOKEN-/.test(r.text));
    const a = await s.req('GET', '/api/airports'); assert.strictEqual(a.status, 200); assert.strictEqual(a.json().source, 'charter724'); assert(a.json().airports.some(x => x.code === 'MHD'));
    assert.strictEqual((await s.req('POST', '/api/airports', {})).status, 405);
  } finally { await s.close(); }
  const down = new Charter724Adapter({ cfg, mapping: require('../server/charter724/mapping.json'), fetchImpl: async () => { throw new TypeError('ECONNREFUSED SECRETPW'); }, logger: silent }); const s2 = await serve(createApp(cfg, { logger: silent, charter724: down }));
  try { const r = await s2.req('POST', '/api/flights/search', goodQ); assert.strictEqual(r.status, 502); assert.strictEqual(r.json().error.code, 'PROVIDER_UNAVAILABLE'); assert(!r.text.includes('SECRETPW')); } finally { await s2.close(); }
});
ok('HTTP live mode with a mapping but incomplete credentials: 503 and the provider is never contacted', async () => {
  const ff = async () => { throw new Error('provider must not be contacted'); }, cfg = liveCfg({ CHARTER724_PASSWORD: '' }), ad = new Charter724Adapter({ cfg, mapping: require('../server/charter724/mapping.json'), fetchImpl: ff, logger: silent }), s = await serve(createApp(cfg, { logger: silent, charter724: ad }));
  try { for (const [m, p, b] of [['POST', '/api/flights/search', goodQ], ['GET', '/api/airports']]) { const r = await s.req(m, p, b); assert.strictEqual(r.status, 503); } assert.strictEqual((await s.req('GET', '/api/health')).json().liveFlights, false); } finally { await s.close(); }
});
ok('HTTP transactions guard: demo mode 403; live without flag 403; demo account without sandbox confirmation 403; even fully enabled it is 501 (intentionally not implemented)', async () => {
  const run = async (cfg) => { const s = await serve(createApp(cfg, { logger: silent })); try { const out = {}; for (const p of ['/api/bookings', '/api/tickets/issue', '/api/refunds']) { const r = await s.req('POST', p, { x: 1 }); out[p] = [r.status, r.json().error.code]; } return out; } finally { await s.close(); } };
  for (const v of Object.values(await run(cfgOf()))) assert.deepStrictEqual(v, [403, 'DEMO_MODE']);
  for (const v of Object.values(await run(liveCfg()))) assert.deepStrictEqual(v, [403, 'TRANSACTIONS_DISABLED']);
  for (const v of Object.values(await run(liveCfg({ CHARTER724_USERNAME: 'demo', ALLOW_LIVE_TRANSACTIONS: 'true' })))) assert.deepStrictEqual(v, [403, 'SANDBOX_NOT_CONFIRMED']);
  for (const v of Object.values(await run(liveCfg({ ALLOW_LIVE_TRANSACTIONS: 'true' })))) assert.deepStrictEqual(v, [501, 'NOT_IMPLEMENTED']);
});
ok('HTTP static: serves the site; blocks .env, server code, tests, traversal and unknown files', async () => {
  const s = await serve(createApp(cfgOf(), { logger: silent }));
  try {
    const i = await s.req('GET', '/'); assert.strictEqual(i.status, 200); assert(/<html/i.test(i.text)); assert.strictEqual(i.headers['x-content-type-options'], 'nosniff'); assert.strictEqual((await s.req('GET', '/js/core.js')).status, 200); assert.strictEqual((await s.req('GET', '/styles.css')).status, 200);
    for (const p of ['/.env', '/.env.example', '/server/config.js', '/server/charter724/mapping.json', '/package.json', '/tests/test.js', '/js/../server/config.js', '/%2e%2e/server/config.js', '/js/%2e%2e/.env', '/README-AR.md']) assert.strictEqual((await s.req('GET', p)).status, 404, p);
  } finally { await s.close(); }
});
ok('HTTP rate limit: requests over the limit get 429', async () => {
  const s = await serve(createApp(cfgOf({ RATE_LIMIT_PER_MIN: '3' }), { logger: silent }));
  try { const codes = []; for (let i = 0; i < 5; i++) codes.push((await s.req('GET', '/api/health')).status); assert.deepStrictEqual(codes, [200, 200, 200, 429, 429]); } finally { await s.close(); }
});
ok('no secrets or credentials are present in shipped source files', () => {
  const fs = require('fs'); const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', '.git'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const files = walk(path.join(__dirname, '..')).filter(f => /\.(js|json|html|md|example)$/.test(f) && !/test_server\.js$/.test(f));
  for (const f of files) { const s = fs.readFileSync(f, 'utf8'); assert(!/Bearer\s+eyJ/.test(s), f); assert(!/CHARTER724_PASSWORD=\S/.test(s), f); assert(!/password\s*[:=]\s*['"]demo['"]/i.test(s), f); }
  assert(!fs.existsSync(path.join(__dirname, '..', '.env')));
});
ok('swagger summarizer prints endpoints, auth, parameters, required fields and response codes (synthetic fixture)', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'summarize-swagger.js'), path.join(__dirname, 'fixtures', 'sample-openapi.json')]).toString();
  for (const s of ['POST /api/x/login', 'GET /api/x/items', 'Auth: Bearer', 'from* (query, string)', 'user*: string', 'pass: string', '401: bad credentials', 'UNKNOWN']) assert(out.includes(s), 'missing: ' + s);
});
(async () => { for (const [n, fn] of queue) { try { await fn(); pass++; console.log('PASS', n); } catch (e) { fail++; process.exitCode = 1; console.log('FAIL', n, '-', (e && e.message || e).toString().split('\n')[0]); } } console.log(pass + ' passed, ' + fail + ' failed'); })();
