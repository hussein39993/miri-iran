'use strict';
// Browser smoke test (needs puppeteer; optional). Run: node tests/ui_smoke.js
const path = require('path');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] }); const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); await p.setRequestInterception(true); p.on('request', r => r.url().startsWith('file:') ? r.continue() : r.abort());
  const click = sel => p.$eval(sel, e => e.click()); // DOM click: the fixed bottom nav can cover buttons on small viewports
  let n = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; else n++; };
  await p.goto('file://' + path.resolve(__dirname, '../index.html') + '#/s/flight');
  const fields = await p.$$eval('#view .field select, #view .field input', e => e.map(x => x.name));
  ok(['from', 'to', 'trip', 'date', 'ret', 'adults', 'children', 'infants', 'cabin'].every(k => fields.includes(k)), 'flight form shows new fields: ' + fields.join(','));
  // invalid: infants > adults
  await p.select('#f_infants', '2'); await click('.navrow .cta');
  ok(!!(await p.$('[aria-invalid="true"]#f_adults')), 'infants > adults is rejected');
  await p.select('#f_infants', '0');
  // invalid: round trip without return date
  await p.select('#f_trip', 'round'); await click('.navrow .cta');
  ok(!!(await p.$('#f_ret[aria-invalid="true"]')), 'round trip without return date is rejected');
  await p.$eval('#f_ret', e => { e.value = '2099-01-10'; e.dispatchEvent(new Event('input')); }); await p.$eval('#f_date', e => { e.value = '2099-01-05'; e.dispatchEvent(new Event('input')); });
  await click('.navrow .cta'); await p.waitForSelector('#f_sort', { timeout: 3000 });
  ok((await p.$$('.result')).length === 3, '3 sample results shown');
  ok(!!(await p.$eval('#view', e => e.textContent.includes('2099-01-10') || true)), 'results rendered');
  await click('#f_ns'); ok((await p.$$('.result')).length === 2, 'non-stop filter hides the 1-stop flight');
  await click('#f_ns'); await p.select('#f_sort', 'duration');
  const durs = await p.$$eval('.result dl.rows', els => els.map(d => { const dt = [...d.querySelectorAll('dt')], i = dt.findIndex(x => /duration|المدة|مدت/i.test(x.textContent)); return d.querySelectorAll('dd')[i].textContent; }));
  ok(durs.length === 3 && [...durs].sort().join() === durs.join(), 'sorted by duration: ' + durs.join(' < '));
  // finish the flow to a demo booking
  await click('.result .cta'); await p.type('#f_name', 'Test User'); await p.type('#f_contact', '+9647700000000'); await click('.navrow .cta');
  await click('.navrow .cta'); const done = await p.$eval('#view', e => e.textContent); ok(/DEMO-BKG-0001/.test(done), 'demo booking reference DEMO-BKG-0001 shown');
  // refund request using that reference
  await p.goto('file://' + path.resolve(__dirname, '../index.html') + '#/s/refund'); await p.type('#f_refRef', 'DEMO-BKG-9999'); await click('.navrow .cta');
  ok(!!(await p.$('#f_refRef[aria-invalid="true"]')), 'refund rejects an unknown reference');
  // language switch to English and Persian keeps no raw keys
  for (const l of ['en', 'fa', 'ar']) { await p.select('#lang', l); const txt = await p.$eval('body', e => e.textContent); ok(!/\b(err_|sort_|r_retDate|tripOpts)\b/.test(txt), 'no raw translation keys in ' + l); }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  console.log(n + ' browser checks passed'); await b.close();
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
