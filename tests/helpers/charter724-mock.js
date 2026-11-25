'use strict';
// Mock Charter724 provider built ONLY from docs/charter724-openapi.json (paths, request fields, envelope, documented error codes).
// It proves OUR code follows the documentation. It is NOT evidence of how the real server behaves.
const fs = require('fs'), path = require('path'), http = require('http');
const FX = path.join(__dirname, '..', 'fixtures', 'charter724');
const fx = n => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'charter724-openapi.json'), 'utf8'));

// Minimal OpenAPI 3.0 schema checker: $ref, type, required, enum, nullable, items, properties.
function check(schema, v, at = '$', errs = []) {
  if (schema.$ref) return check(SPEC.components.schemas[schema.$ref.split('/').pop()], v, at, errs);
  if (v === null || v === undefined) { if (!schema.nullable) errs.push(at + ': null/undefined not allowed'); return errs; }
  const t = schema.type;
  if (t === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) { errs.push(at + ': expected object'); return errs; }
    for (const r of schema.required || []) if (!(r in v)) errs.push(at + '.' + r + ': required field missing');
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) check(s, v[k], at + '.' + k, errs);
  } else if (t === 'array') { if (!Array.isArray(v)) errs.push(at + ': expected array'); else v.forEach((x, i) => check(schema.items || {}, x, at + '[' + i + ']', errs)); }
  else if (t === 'string') { if (typeof v !== 'string') errs.push(at + ': expected string'); }
  else if (t === 'integer') { if (!Number.isInteger(v)) errs.push(at + ': expected integer'); }
  else if (t === 'number') { if (typeof v !== 'number') errs.push(at + ': expected number'); }
  if (schema.enum && !schema.enum.includes(v)) errs.push(at + ': not in enum');
  return errs;
}
const requestSchema = p => SPEC.paths[p].post.requestBody.content['application/json'].schema;
const responseData = p => SPEC.paths[p].get ? SPEC.paths[p].get.responses['200'].content['application/json'].schema : SPEC.paths[p].post.responses['200'].content['application/json'].schema;

// Behaviour of the documented endpoints. opts: { token, tokenExpires, availBy(body) -> fixture name, failLogin, expireTokenOnce }
function provider(opts = {}) {
  const st = { logins: 0, calls: [], expiredOnce: false };
  const issued = new Set();
  const handle = (method, url, headers, body) => {
    const p = new URL(url).pathname; st.calls.push({ method, path: p, body, auth: headers.Authorization || headers.authorization });
    const jsonErr = (status, f) => ({ status, body: fx(f) });
    if (p === '/api/userPassBase64' && method === 'POST') {
      const e = check(requestSchema(p), body); if (e.length) return { status: 422, body: { Result: 'true', Msg: 'validation', Data: e } };
      if (opts.failEncode || (opts.validCreds && (body.username !== opts.validCreds[0] || body.password !== opts.validCreds[1]))) return { status: 401, body: { Result: 'true', Msg: 'Unauthorized', Data: null } };
      return { status: 200, body: fx('encode.json') };
    }
    if (p === '/api/Login' && method === 'POST') {
      const e = check(requestSchema(p), body); if (e.length) return { status: 422, body: { Result: 'true', Msg: 'validation', Data: e } };
      if (opts.failLogin || body.userPassBase64 !== 'Basic ZGVtbzpkZW1v') return jsonErr(400, 'err-104.json');
      st.logins++; const t = fx('login.json'); t.Data.access_token = 'TOKEN-' + st.logins; if (opts.tokenExpires) t.Data.expires_Utc = opts.tokenExpires; issued.add(t.Data.access_token); return { status: 200, body: t };
    }
    if (p === '/api/showmyip' && method === 'GET') return { status: 200, body: { Result: 'true', Msg: 'showmyip', Data: '203.0.113.10' } };
    if (p.startsWith('/api/WebService/')) {
      const m = /^Bearer (.+)$/.exec(headers.Authorization || headers.authorization || '');
      if (!m || !issued.has(m[1]) || (opts.expireTokenOnce && !st.expiredOnce && (st.expiredOnce = true))) return jsonErr(401, 'err-105.json');
      if (p === '/api/WebService/Airportlist' && method === 'GET') return { status: 200, body: fx('airports.json') };
      if (p === '/api/WebService/Available' && method === 'POST') {
        const e = check(requestSchema(p), body); if (e.length) return { status: 422, body: { Result: 'true', Msg: 'validation', Data: e } };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date_flight)) return { status: 422, body: { Result: 'true', Msg: 'validation', Data: 'date' } };
        if (opts.today && body.date_flight < opts.today) return jsonErr(400, 'err-203.json');
        const name = opts.availBy ? opts.availBy(body) : 'avail-mixed.json'; return { status: 200, body: typeof name === 'string' ? fx(name) : name };
      }
    }
    return { status: 404, body: { Result: 'true', Msg: '-404', Data: null } };
  };
  return { st, handle };
}
// fetch-compatible stub (same shape as the unit tests' fakeFetch).
function fakeFetchFor(prov) {
  const f = async (url, opt) => { const r = prov.handle(opt.method, String(url), opt.headers || {}, opt.body ? JSON.parse(opt.body) : undefined); return { status: r.status, json: async () => r.body }; };
  f.calls = prov.st.calls; return f;
}
// A real local HTTP server speaking the documented endpoints (so the real fetch path is exercised).
function listen(prov) {
  const s = http.createServer((req, res) => { let d = ''; req.on('data', x => d += x); req.on('end', () => { const r = prov.handle(req.method, 'http://x' + req.url, req.headers, d ? JSON.parse(d) : undefined); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body)); }); });
  return new Promise(ok => s.listen(0, '127.0.0.1', () => ok({ port: s.address().port, close: () => new Promise(r => s.close(r)) })));
}
module.exports = { fx, SPEC, check, requestSchema, responseData, provider, fakeFetchFor, listen };
