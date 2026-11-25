'use strict';
// Charter724 integration tests. Every provider answer here comes from tests/fixtures/charter724 (built from docs/charter724-openapi.json).
// They prove that OUR code follows the documented API. They are NOT proof that the real server behaves the same way.
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const { loadConfig } = require('../server/config');
const { Charter724Adapter } = require('../server/charter724/adapter');
const { createApp } = require('../server/app');
const { createLogger } = require('../server/redact');
const { todayIn } = require('../server/validate');
const H = require('./helpers/charter724-mock.js');
const MAPPING = require('../server/charter724/mapping.json');
let pass = 0, fail = 0; const queue = []; const ok = (n, fn) => queue.push([n, fn]);
const silent = { info() { }, warn() { }, error() { } };
const liveCfg = (extra = {}) => loadConfig({ APP_MODE: 'live', CHARTER724_BASE_URL: 'https://prov.example', CHARTER724_USERNAME: 'user1', CHARTER724_PASSWORD: 'SECRETPW', ...extra }, null);
const mk = (opts = {}, o = {}) => { const prov = H.provider(opts); const ad = new Charter724Adapter({ cfg: o.cfg || liveCfg(), mapping: o.mapping || MAPPING, fetchImpl: o.fetchImpl || H.fakeFetchFor(prov), logger: silent, now: o.now }); return { prov, ad }; };
const Q = (o = {}) => ({ from: 'MHD', to: 'KIH', trip: 'oneway', date: '2026-11-20', adults: 1, children: 0, infants: 0, cabin: 'economy', ...o });
const paths = prov => prov.st.calls.map(c => c.method + ' ' + c.path);

// ---------- mapping.json follows the documentation ----------
ok('mapping.json: every path/method exists in the OpenAPI spec and request bodies use documented field names', () => {
  const has = (p, m) => assert(H.SPEC.paths[p] && H.SPEC.paths[p][m.toLowerCase()], m + ' ' + p + ' is not in the spec');
  for (const s of MAPPING.auth.steps) has(s.path, s.method); has(MAPPING.airports.path, MAPPING.airports.method); has(MAPPING.flightSearch.path, MAPPING.flightSearch.method); has(MAPPING.diagnostics.myIp.path, MAPPING.diagnostics.myIp.method);
  const sch = n => H.SPEC.components.schemas[n].properties;
  assert.deepStrictEqual(Object.keys(MAPPING.auth.steps[0].body).sort(), Object.keys(sch('AcountInfo')).sort());
  assert.deepStrictEqual(Object.keys(MAPPING.auth.steps[1].body), Object.keys(sch('LoginInfo')));
  assert.deepStrictEqual(Object.keys(MAPPING.flightSearch.body).sort(), Object.keys(sch('AvailInfo')).sort());
  for (const p of Object.values(MAPPING.flightSearch.response.fields)) assert(p in sch('FlightItem'), 'FlightItem has no field ' + p);
  for (const p of Object.values(MAPPING.airports.response.fields)) assert(p in sch('AirportItem'), 'AirportItem has no field ' + p);
  assert.strictEqual(H.SPEC.servers[0].url, 'https://api724.ir');
});
ok('fixtures: every mock answer conforms to the documented response schema (types, required fields, enums)', () => {
  const chk = (p, f) => { const e = H.check(H.responseData(p), H.fx(f)); assert.deepStrictEqual(e, [], f + ': ' + e.slice(0, 3).join('; ')); };
  chk('/api/userPassBase64', 'encode.json'); chk('/api/Login', 'login.json'); chk('/api/WebService/Airportlist', 'airports.json');
  for (const f of ['avail-mixed.json', 'avail-return.json', 'avail-empty.json']) chk('/api/WebService/Available', f);
});

// ---------- two-step JWT authentication ----------
ok('auth: userPassBase64 then Login, then Bearer token on WebService calls; token cached for later searches', async () => {
  const { prov, ad } = mk(); await ad.searchFlights(Q()); await ad.searchFlights(Q());
  assert.deepStrictEqual(paths(prov), ['POST /api/userPassBase64', 'POST /api/Login', 'POST /api/WebService/Available', 'POST /api/WebService/Available']);
  assert.deepStrictEqual(prov.st.calls[0].body, { username: 'user1', password: 'SECRETPW' }); assert.deepStrictEqual(prov.st.calls[1].body, { userPassBase64: 'Basic ZGVtbzpkZW1v' });
  assert.strictEqual(prov.st.calls[0].auth, undefined); assert.strictEqual(prov.st.calls[1].auth, undefined); assert.strictEqual(prov.st.calls[2].auth, 'Bearer TOKEN-1'); assert.strictEqual(prov.st.logins, 1);
});
ok('auth: token lifetime comes from expires_Utc (UTC even without a zone suffix); re-login only after it ends', async () => {
  let t = Date.parse('2099-01-01T00:00:00Z'); const { prov, ad } = mk({ tokenExpires: '2099-01-01T01:00:00' }, { now: () => t });
  await ad.searchFlights(Q()); t += 59 * 60000 - 40000; await ad.searchFlights(Q()); assert.strictEqual(prov.st.logins, 1); t += 120000; await ad.searchFlights(Q()); assert.strictEqual(prov.st.logins, 2);
});
ok('auth: an invalid or past expires_Utc falls back to a short default; a very distant one is capped at 24h', () => {
  const { ad } = mk({}, { now: () => Date.parse('2099-01-01T00:00:00Z') });
  assert.strictEqual(ad._ttl({ expiresAt: 'garbage' }), undefined); assert.strictEqual(ad._ttl({ expiresAt: '2098-01-01T00:00:00Z' }), undefined); assert.strictEqual(ad._ttl({}), undefined);
  assert.strictEqual(ad._ttl({ expiresAt: '2099-01-01T02:00:00Z' }), 7200000); assert.strictEqual(ad._ttl({ expiresAt: '2099-02-01T00:00:00Z' }), 24 * 3600000);
});
ok('auth: login rejected (-104) or encode step rejected (401) gives PROVIDER_LOGIN_FAILED with the provider code, no retry, no secrets in the message', async () => {
  for (const [o, code] of [[{ failLogin: true }, '-104'], [{ failEncode: true }, 'Unauthorized']]) {
    const { prov, ad } = mk(o); const e = await ad.searchFlights(Q()).then(() => null, x => x);
    assert.strictEqual(e.code, 'PROVIDER_LOGIN_FAILED'); assert.strictEqual(e.providerCode, code); assert.strictEqual(e.status, 502); assert(!/SECRETPW|Basic /.test(e.message)); assert(!paths(prov).some(p => p.includes('Available')));
    assert.strictEqual(prov.st.calls.filter(c => /userPassBase64|Login/.test(c.path)).length, o.failEncode ? 1 : 2);
  }
});
ok('auth: a Login answer without access_token is a bad-response error', async () => {
  const ff = async (u, o) => ({ status: 200, json: async () => (String(u).includes('userPassBase64') ? H.fx('encode.json') : { Result: 'true', Msg: 'login', Data: { token_type: 'Bearer' } }) });
  await assert.rejects(mk({}, { fetchImpl: ff }).ad.searchFlights(Q()), e => e.code === 'PROVIDER_BAD_RESPONSE');
});
ok('auth: token rejected (-105) triggers exactly one re-login and one retry; a second -105 is reported with a helpful, honest message', async () => {
  const a = mk({ expireTokenOnce: true }); const r = await a.ad.searchFlights(Q()); assert(r.outbound.length > 0); assert.strictEqual(a.prov.st.logins, 2);
  const e = await mk({}, { fetchImpl: H.fakeFetchFor({ st: { calls: [] }, handle: (() => { const p = H.provider(); return (m, u, h, b) => (new URL(u).pathname.startsWith('/api/WebService') ? { status: 401, body: H.fx('err-105.json') } : p.handle(m, u, h, b)); })() }) }).ad.searchFlights(Q()).then(() => null, x => x);
  assert.strictEqual(e.code, 'PROVIDER_UNAUTHORIZED'); assert.strictEqual(e.providerCode, '-105'); assert.strictEqual(e.status, 502); assert(/IP/.test(e.message) && /may/.test(e.message));
});

// ---------- API error messages ----------
ok('errors: documented -203 (date must be today or later) becomes DATE_IN_PAST (400) with providerCode', async () => {
  const { ad } = mk({ today: '2026-11-25' }); const e = await ad.searchFlights(Q({ date: '2026-11-20' })).then(() => null, x => x);
  assert.strictEqual(e.code, 'DATE_IN_PAST'); assert.strictEqual(e.status, 400); assert.strictEqual(e.providerCode, '-203'); assert(/today or later/.test(e.message));
});
ok('errors: 422 "validation" becomes PROVIDER_VALIDATION; unknown provider codes keep a generic safe error; Result "false" on HTTP 200 is an error', async () => {
  const run = async (st, body) => mk({}, { fetchImpl: async (u, o) => (/WebService/.test(String(u)) ? { status: st, json: async () => body } : H.fakeFetchFor(H.provider())(u, o)) }).ad.searchFlights(Q()).then(() => null, x => x);
  let e = await run(422, { Result: 'true', Msg: 'validation', Data: ['x'] }); assert.strictEqual(e.code, 'PROVIDER_VALIDATION'); assert.strictEqual(e.providerCode, 'validation');
  e = await run(400, { Result: 'true', Msg: '-999', Data: 'secret detail' }); assert.strictEqual(e.code, 'PROVIDER_REJECTED'); assert.strictEqual(e.providerCode, '-999'); assert(!/secret detail/.test(JSON.stringify(e.message)));
  e = await run(200, { Result: 'false', Msg: '-203', Data: [] }); assert.strictEqual(e.code, 'DATE_IN_PAST');
  e = await run(200, { Result: 'false', Msg: 'oops', Data: [] }); assert.strictEqual(e.code, 'PROVIDER_REJECTED');
  e = await run(400, null); assert.strictEqual(e.code, 'PROVIDER_REJECTED'); assert.strictEqual(e.providerCode, undefined);
});
ok('errors: network failure, timeout, 429, 5xx, unreadable body map to distinct safe errors', async () => {
  const login = (u, o) => (/WebService/.test(String(u)) ? null : H.fakeFetchFor(H.provider())(u, o));
  const run = h => mk({}, { fetchImpl: async (u, o) => (await login(u, o)) || h() }).ad.searchFlights(Q()).then(() => null, x => x);
  assert.strictEqual((await run(() => { throw new TypeError('ECONNREFUSED SECRETPW'); })).code, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual((await run(() => { const e = new Error('t'); e.name = 'AbortError'; throw e; })).code, 'PROVIDER_TIMEOUT');
  assert.strictEqual((await run(() => ({ status: 429, json: async () => null }))).code, 'PROVIDER_RATE_LIMITED'); assert.strictEqual((await run(() => ({ status: 503, json: async () => null }))).code, 'PROVIDER_ERROR');
  assert.strictEqual((await run(() => ({ status: 200, json: async () => { throw new Error('x'); } }))).code, 'PROVIDER_BAD_RESPONSE');
});
ok('errors: a real timeout fires when the provider hangs', async () => {
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; rej(e); }));
  const ad = new Charter724Adapter({ cfg: liveCfg({ CHARTER724_TIMEOUT_MS: '50' }), mapping: MAPPING, fetchImpl: hang, logger: silent }); const t0 = Date.now();
  await assert.rejects(ad.searchFlights(Q()), e => e.code === 'PROVIDER_TIMEOUT'); assert(Date.now() - t0 < 1500);
});
ok('errors: an empty mapping refuses to work and a missing template variable is a clear MAPPING_ERROR', async () => {
  const empty = new Charter724Adapter({ cfg: liveCfg(), mapping: { auth: { steps: [] }, flightSearch: null }, fetchImpl: () => { throw new Error('must not be called'); }, logger: silent });
  assert.strictEqual(empty.isConfigured(), false); await assert.rejects(empty.searchFlights(Q()), e => e.code === 'PROVIDER_NOT_CONFIGURED'); await assert.rejects(empty.getAirports(), e => e.code === 'PROVIDER_NOT_CONFIGURED');
  const m = JSON.parse(JSON.stringify(MAPPING)); m.flightSearch.body.x = '{{doesNotExist}}';
  await assert.rejects(mk({}, { mapping: m }).ad.searchFlights(Q()), e => e.code === 'MAPPING_ERROR');
});

// ---------- flight search: cabins, passengers, prices, currency, identifiers ----------
ok('search (economy, 1 adult): documented fields are mapped; other cabins, zero capacity, unknown cabin labels and unsupported currencies are excluded and counted', async () => {
  const { prov, ad } = mk(); const r = await ad.searchFlights(Q()); const f = r.outbound[0];
  assert.deepStrictEqual(r.outbound.map(x => x.flightNumber), ['4523', '4700', '4900', '4523']); assert.strictEqual(r.inbound, undefined);
  assert.deepStrictEqual(r.meta.excluded, { otherCabin: 1, noCapacity: 1, unknownCabin: 1, unsupportedCurrency: 1 }); assert.deepStrictEqual(r.meta.unclassifiedCabins, ['Premium Economy Business / ویژه']); assert.deepStrictEqual(r.meta.currencies.sort(), ['IRR', 'USD']);
  assert.deepStrictEqual(prov.st.calls.at(-1).body, { from_flight: 'MHD', to_flight: 'KIH', date_flight: '2026-11-20' });
  assert.strictEqual(f.source, 'charter724'); assert.strictEqual(f.fictional, false); assert.strictEqual(f.airline, 'IranAir'); assert.strictEqual(f.airlineCode, 'IR'); assert.strictEqual(f.flightNumber, '4523'); assert.strictEqual(f.cabin, 'economy'); assert.strictEqual(f.cabinLabel, 'Economy / اکونومی');
  assert.strictEqual(f.departureDate, '2026-11-20'); assert.strictEqual(f.departure, '13:01'); assert.strictEqual(f.arrival, '14:36'); assert.strictEqual(f.arrivalDate, '2026-11-20'); assert.strictEqual(f.durationMinutes, 95);
  assert.strictEqual(f.hasStop, false); assert.strictEqual(f.stops, 0); assert.strictEqual(f.baggageKg, 20); assert.strictEqual(f.baggage, '20kg'); assert.strictEqual(f.capacity, 9); assert.strictEqual(f.providerType, 'charter');
  assert.deepStrictEqual(f.cancellationRules, [{ percent: 30, description: 'از ۲۴ ساعت قبل از پرواز' }]);
});
ok('search: price is converted rial -> toman (÷10) from the documented currency field; the original amount is kept; unit prices per passenger type are given', async () => {
  const f = (await mk().ad.searchFlights(Q())).outbound[0];
  assert.strictEqual(f.price.amountToman, 1250000); assert.strictEqual(f.price.currency, 'IRT'); assert.strictEqual(f.price.converted, true); assert.deepStrictEqual(f.price.original, { amount: 12500000, currency: 'IRR' });
  assert.deepStrictEqual(f.price.unitToman, { adult: 1250000, child: 937500, infant: 125000 }); assert.deepStrictEqual(f.price.passengers, { adults: 1, children: 0, infants: 0 });
});
ok('search: total uses the REAL adult / child / infant prices per passenger type (not example factors); infants take no seat', async () => {
  const r = await mk().ad.searchFlights(Q({ adults: 2, children: 1, infants: 1 })); const f = r.outbound[0];
  assert.strictEqual(f.price.amountToman, (2 * 12500000 + 9375000 + 1250000) / 10); assert.deepStrictEqual(f.price.original, { amount: 35625000, currency: 'IRR' }); assert.deepStrictEqual(f.price.passengers, { adults: 2, children: 1, infants: 1 });
  assert.strictEqual(r.meta.excluded.insufficientSeats, 1); assert(!r.outbound.some(x => x.flightNumber === '4900')); // capacity 2 < 3 seats (2 adults + 1 child)
  const infOnly = await mk().ad.searchFlights(Q({ adults: 2, infants: 2 })); assert(infOnly.outbound.some(x => x.flightNumber === '4900')); // capacity 2 is enough for 2 adults; the 2 infants need no seats
});
ok('search: a flight missing the child/infant price (or with currency missing) is excluded instead of being priced wrongly', async () => {
  const one = (o) => { const e = JSON.parse(JSON.stringify(H.fx('avail-mixed.json'))); e.Data = [Object.assign(e.Data[0], o)]; return e; };
  let r = await mk({ availBy: () => one({ price_final_chd: 0 }) }).ad.searchFlights(Q({ children: 1 })); assert.strictEqual(r.outbound.length, 0); assert.strictEqual(r.meta.excluded.missingChildPrice, 1);
  r = await mk({ availBy: () => one({ price_final_inf: null }) }).ad.searchFlights(Q({ infants: 1 })); assert.strictEqual(r.meta.excluded.missingInfantPrice, 1);
  r = await mk({ availBy: () => one({ price_final_chd: 0 }) }).ad.searchFlights(Q({ children: 0 })); assert.strictEqual(r.outbound.length, 1); // child price not needed
  r = await mk({ availBy: () => one({ currency: undefined }) }).ad.searchFlights(Q()); assert.strictEqual(r.meta.excluded.unsupportedCurrency, 1);
  r = await mk({ availBy: () => one({ currency: 'IRT', price_final: 1250000 }) }).ad.searchFlights(Q()); assert.strictEqual(r.outbound[0].price.amountToman, 1250000); assert.strictEqual(r.outbound[0].price.converted, false);
});
ok('search (business): only business flights are returned and priced', async () => {
  const r = await mk().ad.searchFlights(Q({ cabin: 'business' })); assert.strictEqual(r.outbound.length, 1); const f = r.outbound[0];
  assert.strictEqual(f.flightNumber, '4601'); assert.strictEqual(f.cabin, 'business'); assert.strictEqual(f.cabinLabel, 'Business / بیزینس'); assert.strictEqual(f.price.amountToman, 3000000); assert.strictEqual(f.baggage, '30kg'); assert.strictEqual(f.alternatives.length, 0);
});
ok('search: stop flights have hasStop=true, stops=null and no arrival; missing cancellation rules become []', async () => {
  const f = (await mk().ad.searchFlights(Q())).outbound.find(x => x.flightNumber === '4700');
  assert.strictEqual(f.hasStop, true); assert.strictEqual(f.stops, null); assert.strictEqual(f.arrival, null); assert.strictEqual(f.arrivalDate, null); assert.strictEqual(f.durationMinutes, null); assert.deepStrictEqual(f.cancellationRules, []);
});
ok('search: flight ids are stable, unique (even for duplicate rows) and URL/DOM safe; providerRef keeps the identifiers the documented GetCaptcha step will need', async () => {
  const r = await mk().ad.searchFlights(Q()); const ids = r.outbound.map(x => x.id);
  assert.strictEqual(ids[0], 'C724-446-MHD-KIH-2026-11-20-1301-4523-Y'); assert.strictEqual(ids[3], ids[0] + '-2'); assert.strictEqual(new Set(ids).size, ids.length); assert(ids.every(i => /^[A-Za-z0-9-]+$/.test(i)));
  assert.deepStrictEqual(r.outbound[0].providerRef, { ajency_online_ID: 446, from_flight: 'MHD', to_flight: 'KIH', date_flight: '2026-11-20', time_flight: '13:01:00', number_flight: '4523', airline: 'IranAir', cabinclass: 'Y', sellingType: 'All' });
  assert.deepStrictEqual((await mk().ad.searchFlights(Q())).outbound.map(x => x.id), ids);
});
ok('search: alternatives (other_flights) are informational only, in toman, and marked not bookable', async () => {
  const a = (await mk().ad.searchFlights(Q())).outbound[0].alternatives; assert.deepStrictEqual(a, [{ providerType: 'system', cabinLabel: 'Economy', capacity: 5, adultPriceToman: 1300000, bookable: false }]);
});
ok('search: empty list, empty-string Data and missing Data are []; a non-array Data is a bad-response error', async () => {
  const w = d => mk({ availBy: () => ({ Result: 'true', Msg: 'avail', Data: d }) }).ad.searchFlights(Q());
  assert.deepStrictEqual((await mk({ availBy: () => 'avail-empty.json' }).ad.searchFlights(Q())).outbound, []); assert.deepStrictEqual((await w('')).outbound, []); assert.deepStrictEqual((await w(null)).outbound, []);
  await assert.rejects(w({ a: 1 }), e => e.code === 'PROVIDER_BAD_RESPONSE');
});
ok('search (round trip): two Available calls (outbound day, then return day with swapped airports), separate result lists', async () => {
  const { prov, ad } = mk({ availBy: b => (b.from_flight === 'MHD' ? 'avail-mixed.json' : 'avail-return.json') });
  const r = await ad.searchFlights(Q({ trip: 'round', returnDate: '2026-11-27' })); const av = prov.st.calls.filter(c => c.path.endsWith('/Available'));
  assert.deepStrictEqual(av.map(c => c.body), [{ from_flight: 'MHD', to_flight: 'KIH', date_flight: '2026-11-20' }, { from_flight: 'KIH', to_flight: 'MHD', date_flight: '2026-11-27' }]); assert.strictEqual(prov.st.logins, 1);
  assert.strictEqual(r.outbound.length, 4); assert.strictEqual(r.inbound.length, 1); assert.strictEqual(r.inbound[0].flightNumber, '4524'); assert.strictEqual(r.inbound[0].providerRef.from_flight, 'KIH'); assert.strictEqual(r.inbound[0].departureDate, '2026-11-27'); assert(r.inbound[0].id.startsWith('C724-446-KIH-MHD-2026-11-27'));
  assert.strictEqual((await mk().ad.searchFlights(Q())).inbound, undefined);
});
ok('search (round trip): if the return leg fails, the whole search fails (no half results)', async () => {
  await assert.rejects(mk({ today: '2026-11-25', availBy: () => 'avail-mixed.json' }).ad.searchFlights(Q({ trip: 'round', date: '2026-11-26', returnDate: '2026-11-20' })), e => e.code === 'DATE_IN_PAST');
});

// ---------- airports ----------
ok('airports: Airportlist is mapped, invalid/duplicate codes dropped, cached for 6 hours', async () => {
  let t = 1000; const { prov, ad } = mk({}, { now: () => t }); const a = await ad.getAirports();
  assert.deepStrictEqual(a.map(x => x.code), ['MHD', 'KIH', 'THR']); assert.deepStrictEqual(a[0], { code: 'MHD', codeInt: 1, nameEn: 'Mashhad', nameFa: 'مشهد' });
  await ad.getAirports(); assert.strictEqual(prov.st.calls.filter(c => c.path.endsWith('/Airportlist')).length, 1); t += 6 * 3600000 + 1; await ad.getAirports(); assert.strictEqual(prov.st.calls.filter(c => c.path.endsWith('/Airportlist')).length, 2);
  assert.strictEqual(prov.st.calls.find(c => c.path.endsWith('/Airportlist')).auth, 'Bearer TOKEN-1');
});

// ---------- end to end over real HTTP (local documented mock server, real fetch) ----------
const req = (port, method, p, body) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, text: d, json: () => JSON.parse(d) })); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
ok('end to end: our server (live mode) -> real fetch -> local mock Charter724: airports, one-way and round-trip search, safe errors, no secrets in responses or logs', async () => {
  const prov = H.provider({ availBy: b => (b.from_flight === 'MHD' ? 'avail-mixed.json' : 'avail-return.json') }), up = await H.listen(prov), logs = [];
  const cfg = liveCfg({ CHARTER724_BASE_URL: 'http://127.0.0.1:' + up.port }), logger = createLogger(s => logs.push(s));
  const app = createApp(cfg, { logger }), srv = http.createServer(app.handler); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  try {
    assert.strictEqual(app.state.liveReady, true);
    const a = await req(port, 'GET', '/api/airports'); assert.strictEqual(a.status, 200); assert.strictEqual(a.json().source, 'charter724'); assert.deepStrictEqual(a.json().airports.map(x => x.code), ['MHD', 'KIH', 'THR']);
    const ow = await req(port, 'POST', '/api/flights/search', { from: 'MHD', to: 'KIH', date: '2099-11-20', adults: 1 }); assert.strictEqual(ow.status, 200); const j = ow.json();
    assert.strictEqual(j.source, 'charter724'); assert.strictEqual(j.fictional, false); assert.strictEqual(j.trip, 'oneway'); assert.strictEqual(j.empty, false); assert.strictEqual(j.results.length, 4); assert.strictEqual(j.returnResults, undefined); assert(j.meta.excluded.otherCabin === 1);
    const rt = await req(port, 'POST', '/api/flights/search', { from: 'MHD', to: 'KIH', trip: 'round', date: '2099-11-20', returnDate: '2099-11-27', adults: 1, cabin: 'economy' }); const k = rt.json(); assert.strictEqual(rt.status, 200); assert.strictEqual(k.trip, 'round'); assert.strictEqual(k.results.length, 4); assert.strictEqual(k.returnResults.length, 1);
    const bz = await req(port, 'POST', '/api/flights/search', { from: 'MHD', to: 'KIH', date: '2099-11-20', adults: 1, cabin: 'business' }); assert.strictEqual(bz.json().results.length, 1);
    const none = await req(port, 'POST', '/api/flights/search', { from: 'KIH', to: 'MHD', trip: 'round', date: '2099-11-20', returnDate: '2099-11-27', adults: 1 }); assert.strictEqual(none.status, 200);
    const past = await req(port, 'POST', '/api/flights/search', { from: 'MHD', to: 'KIH', date: '2000-01-01' }); assert.strictEqual(past.status, 400); assert.strictEqual(past.json().error.code, 'VALIDATION_ERROR');
    assert.strictEqual(prov.st.logins, 1); assert(prov.st.calls.filter(c => c.path.includes('WebService')).every(c => /^Bearer TOKEN-1$/.test(c.auth)));
    const all = a.text + ow.text + rt.text + bz.text + logs.join('\n'); assert(!/SECRETPW|TOKEN-1|ZGVtbzpkZW1v|FAKE\.JWT/.test(all), 'secret found in a response or log');
  } finally { await new Promise(r => srv.close(r)); await up.close(); }
});
ok('end to end: provider -203 / login failure / token problems reach the caller as safe, readable errors with providerCode', async () => {
  const run = async (opts, body) => { const prov = H.provider(opts), up = await H.listen(prov), cfg = liveCfg({ CHARTER724_BASE_URL: 'http://127.0.0.1:' + up.port }), app = createApp(cfg, { logger: silent }), srv = http.createServer(app.handler); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try { return await req(srv.address().port, 'POST', '/api/flights/search', body); } finally { await new Promise(r => srv.close(r)); await up.close(); } };
  const good = { from: 'MHD', to: 'KIH', date: '2099-11-20', adults: 1 };
  let r = await run({ failLogin: true }, good); assert.strictEqual(r.status, 502); assert.strictEqual(r.json().error.code, 'PROVIDER_LOGIN_FAILED'); assert.strictEqual(r.json().error.providerCode, '-104'); assert(!/SECRETPW/.test(r.text));
  r = await run({ today: '2100-01-01' }, good); assert.strictEqual(r.status, 400); assert.strictEqual(r.json().error.code, 'DATE_IN_PAST'); assert.strictEqual(r.json().error.providerCode, '-203');
});
ok('diagnostics: myIp reads the documented showmyip answer without a token', async () => { const { prov, ad } = mk(); assert.strictEqual(await ad.myIp(), '203.0.113.10'); assert.strictEqual(prov.st.calls[0].auth, undefined); assert.deepStrictEqual(paths(prov), ['GET /api/showmyip']); });

// ---------- reservations, payments, tickets and refunds stay disabled ----------
ok('disabled: the booking/ticket/refund routes never reach the provider, even with live mode, transactions enabled and a non-demo account', async () => {
  const prov = H.provider(), cfg = liveCfg({ ALLOW_LIVE_TRANSACTIONS: 'true' }), ad = new Charter724Adapter({ cfg, mapping: MAPPING, fetchImpl: H.fakeFetchFor(prov), logger: silent }), srv = http.createServer(createApp(cfg, { logger: silent, charter724: ad }).handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { for (const p of ['/api/bookings', '/api/tickets/issue', '/api/refunds']) { const r = await req(srv.address().port, 'POST', p, {}); assert.strictEqual(r.status, 501); assert.strictEqual(r.json().error.code, 'NOT_IMPLEMENTED'); } assert.strictEqual(prov.st.calls.length, 0); }
  finally { await new Promise(r => srv.close(r)); }
});
ok('disabled: no code or mapping refers to the documented reservation, payment, ticketing, cancellation or charge endpoints', () => {
  const banned = ['GetCaptcha', 'Reservation', 'BuyTicket', 'PayAndBuyTicket', 'CheckTransaction', 'CheckPenalti', 'CancelTicket', 'GetCharge', 'Available15Days'];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(__dirname, '..', 'server'))) { const s = fs.readFileSync(f, 'utf8'); for (const b of banned) assert(!s.includes('/' + b) && !(f.endsWith('mapping.json') && s.includes(b)), f + ' mentions ' + b); }
  const allowed = [MAPPING.auth.steps[0].path, MAPPING.auth.steps[1].path, MAPPING.airports.path, MAPPING.flightSearch.path, MAPPING.diagnostics.myIp.path].sort();
  assert.deepStrictEqual(allowed, ['/api/Login', '/api/WebService/Airportlist', '/api/WebService/Available', '/api/showmyip', '/api/userPassBase64'].sort());
});
ok('tools/check-live.js: runs against the local documented mock, prints IP / airports / flights, never prints secrets, calls only read-only endpoints', async () => {
  const { execFile } = require('child_process'), prov = H.provider({ validCreds: ['user1', 'SECRETPW'] }), up = await H.listen(prov);
  const run = (args, env) => new Promise(res => execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'check-live.js'), ...args], { env: { ...process.env, ...env }, timeout: 20000 }, (err, so, se) => res({ code: err ? err.code : 0, out: so + se })));
  try {
    const r = await run(['MHD', 'KIH', '2099-11-20'], { CHARTER724_BASE_URL: 'http://127.0.0.1:' + up.port, CHARTER724_USERNAME: 'user1', CHARTER724_PASSWORD: 'SECRETPW' });
    assert.strictEqual(r.code, 0, r.out); for (const s of ['203.0.113.10', 'Login', 'OK: 3 airports', '4 flight(s) kept', 'IranAir', 'Premium Economy Business', 'read-only']) assert(r.out.includes(s), 'missing: ' + s + '\n' + r.out);
    assert(!/SECRETPW|TOKEN-|FAKE\.JWT|ZGVtbzpkZW1v/.test(r.out)); assert.deepStrictEqual([...new Set(prov.st.calls.map(c => c.path))].sort(), ['/api/Login', '/api/WebService/Airportlist', '/api/WebService/Available', '/api/showmyip', '/api/userPassBase64']);
    const bad = await run([], { CHARTER724_BASE_URL: 'http://127.0.0.1:' + up.port, CHARTER724_USERNAME: '', CHARTER724_PASSWORD: '' }); assert.strictEqual(bad.code, 1); assert(/MISSING/.test(bad.out));
    const f = await run([], { CHARTER724_BASE_URL: 'http://127.0.0.1:' + up.port, CHARTER724_USERNAME: 'x', CHARTER724_PASSWORD: 'y' }); // wrong credentials still reach the documented login and fail cleanly
    assert.strictEqual(f.code, 1); assert(/PROVIDER_LOGIN_FAILED/.test(f.out) && /Stopped at: login/.test(f.out)); assert(!/SECRETPW/.test(f.out));
  } finally { await up.close(); }
});
ok('timezone: "today" for date checks is the calendar date in Asia/Tehran (UTC+3:30), with a safe fallback', () => {
  assert.strictEqual(todayIn('Asia/Tehran', new Date('2026-11-25T21:00:00Z')), '2026-11-26'); assert.strictEqual(todayIn('UTC', new Date('2026-11-25T21:00:00Z')), '2026-11-25'); assert.strictEqual(todayIn('Not/AZone', new Date('2026-11-25T21:00:00Z')), '2026-11-25');
});
(async () => { for (const [n, fn] of queue) { try { await fn(); pass++; console.log('PASS', n); } catch (e) { fail++; process.exitCode = 1; console.log('FAIL', n, '-', (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } } console.log(pass + ' passed, ' + fail + ' failed'); })();
