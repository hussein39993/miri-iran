'use strict';
// Read-only check of the Charter724 connection from THIS computer. Usage: node tools/check-live.js [FROM TO [YYYY-MM-DD]]
// Calls only: showmyip, userPassBase64, Login, Airportlist, Available. It never reserves, pays, issues, cancels or refunds.
// Credentials are read from .env / environment and are never printed.
const { loadConfig } = require('../server/config');
const { Charter724Adapter } = require('../server/charter724/adapter');
const { createLogger } = require('../server/redact');
const { todayIn } = require('../server/validate');
const mapping = require('../server/charter724/mapping.json');
const cfg = loadConfig(), c = cfg.charter724, out = s => process.stdout.write(s + '\n');
const [from = 'MHD', to = 'KIH', dateArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const tomorrow = () => { const t = todayIn(cfg.timezone), d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const date = dateArg || tomorrow();
const fail = (step, e) => { out('  FAILED: ' + (e.code || e.name) + (e.providerCode ? ' (provider code ' + e.providerCode + ')' : '') + ' - ' + e.message); out('\nStopped at: ' + step); process.exit(1); };
(async () => {
  out('Charter724 read-only check  (' + new Date().toISOString() + ')');
  out('1) Settings: base URL ' + (c.baseUrl || '(missing)') + ' | username ' + (c.username ? 'set' : 'MISSING') + ' | password ' + (c.password ? 'set' : 'MISSING'));
  if (!c.baseUrl || !c.username || !c.password) { out('  Fill CHARTER724_BASE_URL, CHARTER724_USERNAME and CHARTER724_PASSWORD in the .env file (see .env.example).'); process.exit(1); }
  if (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(c.baseUrl)) { out('  CHARTER724_BASE_URL must start with https://'); process.exit(1); }
  const ad = new Charter724Adapter({ cfg, mapping, logger: createLogger(() => { }) });
  out('2) Public IP address that Charter724 sees (GET /api/showmyip):');
  try { out('  ' + await ad.myIp() + '   <- this is the address to whitelist if your account is IP-restricted'); } catch (e) { out('  could not read it: ' + e.code + ' - ' + e.message); }
  out('3) Login (userPassBase64 then Login):');
  try { await ad.tokens.getToken(); out('  OK (token received; it is not printed)'); } catch (e) { fail('login', e); }
  out('4) Airport list (Airportlist):');
  let airports; try { airports = await ad.getAirports(); out('  OK: ' + airports.length + ' airports. First ones: ' + airports.slice(0, 10).map(a => a.code + ' ' + (a.nameEn || '')).join(', ')); } catch (e) { fail('airports', e); }
  out('5) Flight search ' + from.toUpperCase() + ' -> ' + to.toUpperCase() + ' on ' + date + ', 1 adult, economy (Available):');
  try {
    const q = { from: from.toUpperCase(), to: to.toUpperCase(), trip: 'oneway', date, adults: 1, children: 0, infants: 0, cabin: 'economy' };
    const r = await ad.searchFlights(q), m = r.meta;
    out('  OK: ' + r.outbound.length + ' flight(s) kept. Currencies seen: ' + (m.currencies.join(', ') || '-') + '. Excluded: ' + (JSON.stringify(m.excluded) === '{}' ? 'none' : JSON.stringify(m.excluded)));
    if (m.unclassifiedCabins.length) out('  NOTE: cabin labels we could not classify (send these to me): ' + JSON.stringify(m.unclassifiedCabins));
    for (const f of r.outbound.slice(0, 5)) out('   - ' + [f.airline, f.airlineCode + f.flightNumber, f.departure + (f.arrival ? '->' + f.arrival : ''), f.price.amountToman.toLocaleString('en-US') + ' toman (' + f.price.original.amount.toLocaleString('en-US') + ' ' + f.price.original.currency + ')', f.cabinLabel, 'seats ' + f.capacity].join(' | '));
    if (!r.outbound.length) out('  No flights for that day/route. Try another date or route.');
  } catch (e) { fail('search', e); }
  out('\nDone. Only read-only endpoints were called. Nothing was reserved, paid, issued, cancelled or refunded.');
})();
