'use strict';
// Run: node tests/test.js  (no dependencies)
const fs = require('fs'), path = require('path'), assert = require('assert');
let pass = 0; const ok = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };
const MI = require('../js/core.js'), P = require('../js/providers.js');
global.window = {}; require('../js/i18n.js'); require('../js/i18n3.js'); require('../js/i18n4.js'); require('../js/i18n5.js'); const T = global.window.T; delete global.window;

ok('local date is not UTC-shifted (Nov 24 00:30 local)', () => assert.strictEqual(MI.isoLocal(new Date(2026, 10, 24, 0, 30)), '2026-11-24'));
ok('past date rejected, today/future accepted', () => { assert(MI.rules.pastDate('2026-11-23', '2026-11-24')); assert(!MI.rules.pastDate('2026-11-24', '2026-11-24')); assert(!MI.rules.pastDate('2026-12-01', '2026-11-24')); assert(MI.rules.pastDate('', '2026-11-24')); });
ok('same origin/destination rejected', () => { assert(MI.rules.sameCity({ from: '0', to: '0' })); assert(!MI.rules.sameCity({ from: '0', to: '2' })); });
ok('phone/amount/bill validators', () => { assert(MI.rules.phone('09123456789')); assert(!MI.rules.phone('9123456789')); assert(MI.rules.amount('100000')); assert(!MI.rules.amount('0')); assert(!MI.rules.amount('-5')); assert(!MI.rules.amount('1.5')); assert(MI.rules.bill('123456')); assert(!MI.rules.bill('12')); });
ok('translation keys identical in ar/fa/en (incl. nested)', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? keys(v, p + k + '.') : [p + k + (Array.isArray(v) ? '[' + v.length + ']' : '')]).sort().join();
  assert.strictEqual(keys(T.fa), keys(T.ar)); assert.strictEqual(keys(T.en), keys(T.ar));
});
ok('every service has a name in all languages', () => { for (const l of ['ar', 'fa', 'en']) for (const s of MI.SERVICES) assert(T[l].svc[s.id], l + ':' + s.id); });
ok('no untranslated Arabic letters in English strings', () => { const bad = JSON.stringify(T.en).match(/[\u0600-\u06FF]/); assert(!bad); });
ok('flight results carry all required fields and are flagged fictional', () => {
  const r = P.search('flight', { from: '0', to: '2', pax: '2', date: '2026-12-01' }); assert.strictEqual(r.length, 3);
  for (const x of r) { assert(x.fictional && x.title && x.price > 0); for (const k of ['depAirport', 'arrAirport', 'dep', 'arr', 'duration', 'stops', 'baggage', 'fare', 'cancel']) assert(k in x.rows, k); }
});
ok('wallet balance is frozen and sample requests never change it', () => {
  const before = JSON.stringify(P.WALLET); P.addSampleRequest('deposit'); P.addSampleRequest('transfer'); P.addSampleRequest('refund');
  try { 'use strict'; P.WALLET.balance = 1; } catch { } assert.strictEqual(JSON.stringify(P.WALLET), before); assert(Object.isFrozen(P.WALLET)); assert(P.store.activity.length >= 6);
});
ok('finance submit is demo-only and moves nothing', () => { const r = P.submitFinance('cardtransfer', { bank: '1', amount: '1000' }); assert.strictEqual(r.moved, 0); assert.strictEqual(r.status, 'demo_not_sent'); assert(r.ref.startsWith('DEMO-')); });
ok('booking confirmation is an obvious demo reference', () => { const r = P.submitBooking('flight', {}, { title: 'x', price: 1 }, { name: 'Test' }); assert(/^DEMO-BKG-/.test(r.ref)); assert.strictEqual(r.status, 'demo_not_issued'); });
const Map_ = require('../js/map.js');
const pt = (lat, lon) => ({ lat, lon, label: 'x' });
ok('snapp demo: quote validation, example fare, lifecycle, cancel', () => {
  const p = P.getSnappProvider(), a = pt(36.2126, 57.6819), b = pt(36.2352, 59.641);
  assert.throws(() => p.quote({ pickup: a, dest: a, km: 1, min: 3, vehicle: 'eco' }), /INVALID_ROUTE/);
  assert.throws(() => p.quote({ pickup: pt(51.5, -0.12), dest: b, km: 1, min: 3, vehicle: 'eco' }), /INVALID_ROUTE/);
  assert.throws(() => p.quote({ pickup: a, dest: b, km: 5, min: 9, vehicle: 'xyz' }), /INVALID_ROUTE/);
  const q = p.quote({ pickup: a, dest: b, km: 5.2, min: 11, vehicle: 'pre', source: 'osrm' }), e = p.quote({ pickup: a, dest: b, km: 5.2, min: 11, vehicle: 'eco' });
  assert(q.isDemo && q.arrival === null && Number.isInteger(q.price) && q.price > e.price);
  const r = p.create(q, 'cash', 'x'.repeat(500), { pickup: 'A', dest: 'B' }); assert.strictEqual(r.note.length, 140); const seen = [r.status];
  for (let i = 0; i < 8; i++) { p.advance(r.id); if (seen[seen.length - 1] !== r.status) seen.push(r.status); }
  assert.deepStrictEqual(seen, ['created', 'searching', 'assigned', 'arriving', 'started', 'completed']); assert.throws(() => p.cancel(r.id), /CANNOT_CANCEL/);
  const r2 = p.create(q, 'cash'); assert.strictEqual(p.cancel(r2.id).status, 'cancelled'); p.advance(r2.id); assert.strictEqual(r2.status, 'cancelled');
});
ok('snapp wallet payment and official mode are disabled', () => {
  const p = P.getSnappProvider(), q = p.quote({ pickup: pt(35.7, 51.3), dest: pt(35.8, 51.4), km: 3, min: 8, vehicle: 'eco' }); assert.throws(() => p.create(q, 'wallet'), /WALLET_PAYMENT_NOT_AUTHORIZED/);
  const o = P.getSnappProvider('official'); assert.strictEqual(o.enabled, false); for (const m of ['quote', 'create', 'track', 'cancel', 'verifyWebhook']) assert.throws(() => o[m](), /SNAPP_OFFICIAL_NOT_AUTHORIZED/);
});
ok('geo helpers: haversine and Iran bounding box', () => {
  const d = MI.haversineKm({ lat: 35.6997, lon: 51.338 }, { lat: 36.288, lon: 59.6157 }); assert(d > 700 && d < 800, String(d));
  assert(MI.inArea(36.21, 57.68)); assert(!MI.inArea(51.5, -0.12)); assert(!MI.inArea(NaN, 50));
});
ok('nominatim parsing keeps only valid in-area results', () => {
  const r = Map_.parseNominatim([{ lat: '36.25', lon: '57.69', display_name: 'Uni' }, { lat: '51.5', lon: '-0.1', display_name: 'London' }, { lat: 'x', lon: '1', display_name: 'bad' }, { lat: '36', lon: '57', display_name: '' }]);
  assert.deepStrictEqual(r, [{ lat: 36.25, lon: 57.69, label: 'Uni' }]); assert.deepStrictEqual(Map_.parseNominatim(null), []);
});
ok('osrm parsing and failure handling', () => {
  const r = Map_.parseOsrm({ routes: [{ distance: 5234, duration: 612, geometry: { coordinates: [[57.68, 36.21], [57.7, 36.22]] } }] });
  assert.deepStrictEqual([r.km, r.min, r.source, r.coords[0]], [5.2, 10, 'osrm', [36.21, 57.68]]);
  assert.throws(() => Map_.parseOsrm({}), /ROUTE_PARSE/); assert.throws(() => Map_.parseOsrm({ routes: [{ distance: -1 }] }), /ROUTE_PARSE/);
});
(async () => { const f = global.fetch; global.fetch = async () => { throw new Error('offline'); };
  try { const r = await Map_.route({ lat: 36.2, lon: 57.7 }, { lat: 36.3, lon: 57.8 }); assert.strictEqual(r.source, 'line'); assert(r.km > 0 && r.min > 0); pass++; console.log('PASS route falls back to straight-line approximation when routing fails'); }
  catch (e) { console.log('FAIL route fallback -', e.message); process.exitCode = 1; } finally { global.fetch = f; } })();
ok('presets are inside the supported area', () => { assert.strictEqual(Map_.PRESETS.length, T.en.ppl.length); Map_.PRESETS.forEach(p => assert(MI.inArea(p.lat, p.lon))); });
ok('no eval/innerHTML; fetch only in map.js and only to documented hosts', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '../js'))) { const s = fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'); assert(!/XMLHttpRequest|WebSocket|eval\(|innerHTML|document\.write/.test(s), f); if (f !== 'map.js') assert(!/\bfetch\(/.test(s), f + ' must not call fetch'); }
});
const hosts = [...fs.readFileSync(path.join(__dirname, '../js/map.js'), 'utf8').matchAll(/https:\/\/([a-z.-]+)/g)].map(m => m[1]); ok('map.js hosts are the documented ones', () => assert.deepStrictEqual([...new Set(hosts)].sort(), ['cdnjs.cloudflare.com', 'nominatim.openstreetmap.org', 'router.project-osrm.org', 'tile.openstreetmap.org', 'www.openstreetmap.org']));
setTimeout(() => console.log(pass + ' passed'), 50);
