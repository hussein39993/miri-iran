'use strict';
// Usage: node tools/summarize-swagger.js swagger.json > docs/CHARTER724-ENDPOINTS.md
// Reads an OpenAPI/Swagger JSON file and prints every endpoint with auth, parameters, request fields, response codes.
const fs = require('fs');
const file = process.argv[2]; if (!file) { console.error('Usage: node tools/summarize-swagger.js <swagger.json>'); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const ref = r => r.split('/').slice(1).reduce((a, k) => a && a[k], doc);
const schemaOf = s => { if (!s) return null; if (s.$ref) { const t = ref(s.$ref); return { name: s.$ref.split('/').pop(), ...(schemaOf(t) || {}) }; } return s; };
function fields(s, d = 0) {
  s = schemaOf(s); if (!s || d > 3) return []; if (s.type === 'array') return fields(s.items, d + 1).map(x => '[]' + x);
  const req = new Set(s.required || []); return Object.entries(s.properties || {}).flatMap(([k, v]) => { const sv = schemaOf(v), sub = sv && (sv.properties || sv.type === 'array') ? fields(sv, d + 1) : []; const line = `${k}${req.has(k) ? '*' : ''}: ${sv.type || 'object'}${sv.format ? '(' + sv.format + ')' : ''}${sv.enum ? ' enum=' + sv.enum.join('|') : ''}`; return [line, ...sub.map(x => k + '.' + x)]; });
}
const globalSec = (doc.security || []).flatMap(o => Object.keys(o));
const out = [`# ${(doc.info && doc.info.title) || 'API'} ${(doc.info && doc.info.version) || ''}`, '', `Servers: ${(doc.servers || []).map(s => s.url).join(', ') || '(none listed)'}`, `Security schemes: ${Object.keys((doc.components && doc.components.securitySchemes) || {}).join(', ') || '(none listed)'}`, ''];
for (const [p, item] of Object.entries(doc.paths || {})) for (const [method, op] of Object.entries(item)) {
  if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
  const sec = (op.security || doc.security || []).flatMap(o => Object.keys(o)); const body = op.requestBody && op.requestBody.content && Object.values(op.requestBody.content)[0];
  out.push(`## ${method.toUpperCase()} ${p}`, op.summary ? `Summary: ${op.summary}` : '', `Auth: ${sec.length ? sec.join(', ') : 'none declared'}`);
  const params = (op.parameters || item.parameters || []).map(q => { q = q.$ref ? ref(q.$ref) : q; return `${q.name}${q.required ? '*' : ''} (${q.in}, ${(q.schema && q.schema.type) || '?'})`; });
  if (params.length) out.push('Parameters: ' + params.join('; '));
  if (body) out.push('Request fields:', ...fields(body.schema).map(x => '  - ' + x));
  out.push('Responses:'); for (const [code, r] of Object.entries(op.responses || {})) { const c = r.content && Object.values(r.content)[0]; out.push(`  - ${code}: ${r.description || ''}`, ...(c ? fields(c.schema).slice(0, 40).map(x => '      ' + x) : [])); }
  out.push('Safe to test with demo account: UNKNOWN (ask Charter724; do NOT assume)', '');
}
console.log(out.filter(x => x !== '').join('\n'));
