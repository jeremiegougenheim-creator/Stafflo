// price-intelligence (supabase/functions/price-intelligence) — garde-fous multi-propriétaire.
//   node tests/evals-price-intel.mjs   (nécessite esbuild : PUSH_TEST_MODULES=… comme evals-push)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/price-intelligence/index.ts'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
check('propriétaire tiré du JWT (auth.getUser), 401 sinon', /auth\.getUser\(\)/.test(code) && /error: 'unauthorized' \}, 401/.test(code));
check('owner_id du corps ignoré', !/body\.owner_id/.test(code) && !/owner_id\?:/.test(code));
check('aucune grille par défaut inventée (grid_missing)', !/DEFAULT_GRID/.test(code) && /error:'grid_missing'/.test(code));
check('aucune date d’événement en dur', !/m===10&&d>=9/.test(code) && /from\('events'\)/.test(code) && /is\('deleted_at', null\)/.test(code));
check('plafond max_price respecté', /data\.max_price/.test(code));
check('pas de CORS « * »', !/Allow-Origin':\s*'\*'/.test(code));

const patched = src.replace(/^import .*$/gm, '');
globalThis.Deno = { env: { get: () => '' }, serve: () => {} };
const js = esbuild.transformSync('const createClient = null;\n' + patched, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
check('ville « Marrakech, Maroc » → marrakech', M.cityKey('Marrakech, Maroc') === 'marrakech');
check('ville vide → clé vide', M.cityKey(null) === '' && M.cityKey('') === '');
const EV = [
  { name: 'Toussaint', start_date: '2026-10-17', end_date: '2026-11-02', demand_impact: 1 },
  { name: 'Ramadan', start_date: '2027-02-08', end_date: '2027-03-09', demand_impact: 0 },
  { name: 'Noël', start_date: '2026-12-19', end_date: '2027-01-04', demand_impact: 2 },
  { name: 'Réveillon', start_date: '2026-12-28', end_date: '2027-01-02', demand_impact: 1 },
];
check('événement du jour trouvé', M.pickEvent(EV, '2026-10-20').name === 'Toussaint');
check('impact neutre (0) ignoré', !M.pickEvent(EV, '2027-02-20').isEvent);
check('chevauchement : le plus fort gagne', M.pickEvent(EV, '2026-12-30').name === 'Noël');
check('jour sans événement', !M.pickEvent(EV, '2026-10-13').isEvent && M.pickEvent([], '2026-10-13').mult === 1);
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
