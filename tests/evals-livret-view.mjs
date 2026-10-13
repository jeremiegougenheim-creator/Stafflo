// Livret par lien personnel (supabase/functions/livret-view) — accès à la fiche maison.
//   PUSH_TEST_MODULES=… node tests/evals-livret-view.mjs   (esbuild, comme evals-transcribe)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/livret-view/index.ts'), 'utf8');
const FACTS = { VILLA: { name: 'Villa Test', wifi: { net: 'n', pass: 'p' } }, TEAM: [] };
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const DB = {
  links: [{ token: 'A'.repeat(43), owner_id: 'o1', client_id: 's1' }, { token: 'B'.repeat(43), owner_id: 'o1', client_id: 's-old' }],
  stays: [
    { id: 's1', user_id: 'o1', name: 'Ana Ruiz', arrival: iso(2), departure: iso(5), details: { livretSentAt: '2026-10-10T09:00:00Z' } },
    { id: 's-old', user_id: 'o1', name: 'Old Guest', arrival: iso(-20), departure: iso(-10), details: {} },
  ],
  facts: { o1: FACTS },
};
const CALLS = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url) => {
  url = decodeURIComponent(String(url)); CALLS.push(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes('/rest/v1/livret_links')) { const t = url.match(/token=eq\.([^&]+)/)[1]; return ok(DB.links.filter((l) => l.token === t)); }
  if (url.includes('/rest/v1/crm_clients') && url.includes('id=eq.')) { const id = url.match(/[?&]id=eq\.([^&]+)/)[1]; return ok(DB.stays.filter((s) => s.id === id)); }
  if (url.includes('/rest/v1/crm_clients') && url.includes('name=eq.')) { const n = url.match(/name=eq\.([^&]+)/)[1]; return ok(DB.stays.filter((s) => s.name === n)); }
  if (url.includes('/rest/v1/villa_settings')) { const o = url.match(/owner_id=eq\.([^&]+)/)[1]; return ok(DB.facts[o] ? [{ house_facts: DB.facts[o] }] : []); }
  throw new Error('inattendu ' + url);
};
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const h = globalThis.__h;
const get = (qs, ip = '1.1.1.1') => h(new Request('https://x/livret-view?' + qs, { headers: { 'x-forwarded-for': ip } }));

// 1. Le texte des dates des anciens liens = celui de l'app, jour par jour sur deux ans.
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const i = app.indexOf('  function fmtStayDates('), j = app.indexOf('\n  }\n', i);
const ctx = { MONTHS_FR: ['JAN', 'FEV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOU', 'SEP', 'OCT', 'NOV', 'DEC'], Date, isNaN, String };
vm.createContext(ctx); vm.runInContext(app.slice(i, j + 5) + '\nthis.f = fmtStayDates;', ctx);
let same = 0, total = 0;
for (let k = 0; k < 730; k++) { const a = new Date(Date.UTC(2026, 0, 1) + k * 86400000).toISOString().slice(0, 10), d = new Date(Date.UTC(2026, 0, 1) + (k + 4) * 86400000).toISOString().slice(0, 10); total++; if (ctx.f(a, d) === M.fmtStayDates(a, d)) same++; }
check('dates des anciens liens : identiques à fmtStayDates de l’app (730 jours)', same === total, `${same}/${total}`);

// 2. Jeton
check('jeton : 32 à 64 caractères base64url seulement', M.validToken('A'.repeat(43)) && !M.validToken('short') && !M.validToken("A'or'1'='1".padEnd(40, 'x')));
let r = await get('t=' + 'A'.repeat(43));
let b = await r.json();
check('lien personnel valide → la fiche, et rien d’autre (ni nom, ni séjour, ni prix)', r.status === 200 && b.facts && b.facts.VILLA.name === 'Villa Test' && Object.keys(b).join() === 'facts');
r = await get('t=' + 'Z'.repeat(43));
check('jeton inconnu → 404', r.status === 404);
r = await get('t=' + 'B'.repeat(43));
check('séjour terminé depuis plus de 7 jours → 410 (lien expiré)', r.status === 410);
const before = CALLS.length; r = await get('t=bad%27token');
check('jeton mal formé → 404 sans toucher la base', r.status === 404 && CALLS.length === before);

// 3. Anciens liens (sans jeton) — seulement ceux envoyés avant la bascule, nom et dates exacts.
const st = DB.stays[0], dt = M.fmtStayDates(st.arrival, st.departure);
r = await get('guest=' + encodeURIComponent('Ana Ruiz') + '&dates=' + encodeURIComponent(dt), '2.2.2.2');
b = await r.json();
check('ancien lien (nom + dates exacts, livret envoyé avant la bascule) → la fiche', r.status === 200 && b.facts && b.legacy === true);
r = await get('guest=' + encodeURIComponent('Ana Ruiz') + '&dates=' + encodeURIComponent('1 JAN – 2 JAN 26'), '2.2.2.2');
check('ancien lien, mauvaises dates → 404', r.status === 404);
r = await get('guest=' + encodeURIComponent('ana ruiz') + '&dates=' + encodeURIComponent(dt), '2.2.2.2');
check('ancien lien, nom approximatif → 404 (jamais de rapprochement)', r.status === 404);
const today = new Date().toISOString().slice(0, 10);
check('ancien lien : livret envoyé après la bascule → refusé', M.legacyMatch([{ ...st, details: { livretSentAt: '2026-10-20T00:00:00Z' } }], 'Ana Ruiz', dt, today) === null);
check('ancien lien : deux séjours identiques → refusé', M.legacyMatch([st, { ...st }], 'Ana Ruiz', dt, today) === null);
check('ancien lien : séjour supprimé → refusé', M.legacyMatch([{ ...st, deleted_at: '2026-10-01' }], 'Ana Ruiz', dt, today) === null);
let lim = false; for (let k = 0; k < 25; k++) { const x = await get('guest=X&dates=Y', '9.9.9.9'); if (x.status === 429) lim = true; }
check('ancien lien : essais limités par adresse IP (20 / heure)', lim);

// 4. Garde-fous statiques
check('aucune écriture en base', !/method:\s*["'](POST|PATCH|DELETE)["']/.test(src));
check('réponse jamais mise en cache', /"Cache-Control": "no-store"/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
