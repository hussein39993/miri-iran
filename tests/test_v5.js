'use strict';
// Run: node tests/test_v5.js  (no dependencies). V5 features: round trip, passenger types, sort/filter, refund request.
const assert = require('assert');
let pass = 0, fail = 0; const ok = (n, fn) => { try { fn(); pass++; console.log('PASS', n); } catch (e) { fail++; console.log('FAIL', n, '-', e.message); process.exitCode = 1; } };
const MI = require('../js/core.js'), P = require('../js/providers.js');
global.window = {}; ['i18n', 'i18n3', 'i18n4', 'i18n5'].forEach(f => require('../js/' + f + '.js')); const T = global.window.T;

ok('version is 5.0.0', () => assert.strictEqual(MI.VERSION, '5.0.0'));
ok('pax rule: valid and invalid combinations', () => {
  const v = MI.rules.pax; assert(v(1, 0, 0)); assert(v(2, 3, 2)); assert(v(9, 0, 4)); assert(v('2', '1', '1'));
  assert(!v(0, 1, 0)); assert(!v(1, 0, 2)); assert(!v(5, 5, 0)); assert(!v(1.5, 0, 0)); assert(!v(-1, 0, 0)); assert(!v(1, -1, 0)); assert(!v(9, 0, 5)); assert(!v('x', 0, 0));
});
ok('return date rule', () => { const r = MI.rules.returnDate; assert(r('2026-12-01', '2026-12-01')); assert(r('2026-12-01', '2026-12-09')); assert(!r('2026-12-05', '2026-12-01')); assert(!r('2026-12-05', '')); assert(!r('2026-12-05', 'abc')); });
ok('refund reference format rule', () => { const r = MI.rules.refRef; assert(r('DEMO-BKG-0001')); assert(r('DEMO-RIDE-0123')); assert(!r('PNR123')); assert(!r('DEMO-BKG-1')); assert(!r('')); });
ok('passenger price factors are frozen examples', () => { assert(Object.isFrozen(MI.FARE_FACTOR)); assert.strictEqual(MI.paxEquivalent(2, 1, 1), 2 + 0.75 + 0.1); });
const base = { from: '0', to: '2', date: '2026-12-01' };
ok('round trip costs double one way for same passengers', () => {
  const a = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '0', infants: '0' }), b = P.search('flight', { ...base, trip: 'round', ret: '2026-12-08', adults: '1', children: '0', infants: '0' });
  a.forEach((x, i) => assert.strictEqual(b[i].price, x.price * 2)); assert.strictEqual(b[0].rows.retDate, '2026-12-08'); assert(!('retDate' in a[0].rows));
});
ok('children and infants cost less than adults', () => {
  const ad = P.search('flight', { ...base, trip: 'oneway', adults: '2', children: '0', infants: '0' })[0].price, ch = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '1', infants: '0' })[0].price, inf = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '0', infants: '1' })[0].price, one = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '0', infants: '0' })[0].price;
  assert(ch < ad && inf < ch && inf > one);
});
ok('legacy pax field still works (hotel/train/V4 flight)', () => { const r = P.search('flight', { from: '0', to: '2', pax: '2' }); assert.strictEqual(r.length, 3); assert(r.every(x => x.fictional && x.price > 0)); });
ok('sort by price, duration and departure; original list untouched', () => {
  const l = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '0', infants: '0' }), copy = JSON.stringify(l);
  const p = MI.sortResults(l, 'price').map(x => x.price); assert.deepStrictEqual(p, [...p].sort((a, b) => a - b));
  const d = MI.sortResults(l, 'duration').map(x => x.rows.duration); assert.deepStrictEqual(d, [...d].sort());
  const t = MI.sortResults(l, 'dep').map(x => x.rows.dep); assert.deepStrictEqual(t, [...t].sort()); assert.strictEqual(JSON.stringify(l), copy);
});
ok('non-stop filter keeps only 0-stop flights; empty filter keeps all', () => {
  const l = P.search('flight', { ...base, trip: 'oneway', adults: '1', children: '0', infants: '0' }), n = MI.filterResults(l, { nonstop: true });
  assert(n.length > 0 && n.length < l.length && n.every(x => x.rows.stops === 0)); assert.strictEqual(MI.filterResults(l, {}).length, l.length);
});
ok('refund service exists and is a demo finance flow with names in all languages', () => {
  const s = MI.SERVICES.find(x => x.id === 'refund'); assert(s && s.flow === 'fin' && s.group === 'digital');
  for (const l of ['ar', 'fa', 'en']) { assert(T[l].svc.refund); assert(T[l].finDesc.refund); }
});
ok('refund request moves no money and is a demo reference', () => { const r = P.submitFinance('refund', { refRef: 'DEMO-BKG-0001', refReason: '0' }); assert.strictEqual(r.moved, 0); assert.strictEqual(r.status, 'demo_not_sent'); assert(/^DEMO-/.test(r.ref)); });
ok('V5 translation keys exist and are identical in ar/fa/en', () => {
  const ks = ['trip', 'tripOpts', 'retDate', 'adults', 'children', 'infants', 'cabin', 'cabinOpts', 'err_returnDate', 'err_pax', 'err_refRef', 'sortBy', 'sort_price', 'sort_duration', 'sort_dep', 'onlyNonstop', 'noResults', 'paxNote', 'r_retDate', 'refRef', 'refReason', 'refReasons'];
  for (const l of ['ar', 'fa', 'en']) for (const k of ks) assert(T[l][k] !== undefined && T[l][k] !== '', l + ':' + k);
  assert.strictEqual(T.ar.tripOpts.length, T.en.tripOpts.length); assert.strictEqual(T.fa.refReasons.length, T.en.refReasons.length);
  assert(!/[\u0600-\u06FF]/.test(JSON.stringify(T.en)));
});
ok('flight form uses the new field set (wizard spec f)', () => assert.strictEqual(MI.SERVICES.find(x => x.id === 'flight').spec, 'f'));
console.log(pass + ' passed, ' + fail + ' failed');
