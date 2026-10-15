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
const CALLS = [], PATCHES = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init) => {
  url = decodeURIComponent(String(url)); CALLS.push(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (init && init.method === 'PATCH') { PATCHES.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
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
const post = (body, ip = '3.3.3.3') => h(new Request('https://x/livret-view', { method: 'POST', headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' }, body: JSON.stringify(body) }));

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
check('lien personnel valide → la fiche et les réponses du client, rien d’autre (ni nom, ni séjour, ni prix)', r.status === 200 && b.facts && b.facts.VILLA.name === 'Villa Test' && Object.keys(b).sort().join() === 'answers,facts' && b.answers === null);
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
check('une seule écriture en base : la réponse du client (PATCH), jamais de POST ni de DELETE', (src.match(/method:\s*"PATCH"/g) || []).length === 1 && !/method:\s*"(POST|DELETE)"/.test(src));

// 5. Le client répond (POST) : heure d'arrivée, composition, repas — dans les deux sens.
{
  const A = { arrival_time: '  vol AT801,   à la villa vers 16h ', couples: '3', singles: 2, meals: 'Dîner le 1er soir, tajine', note: '' };
  r = await post({ t: 'A'.repeat(43), lang: 'en', answers: A });
  b = await r.json();
  const p = PATCHES[PATCHES.length - 1];
  check('réponse du client → 200, réponse renvoyée telle qu’enregistrée (nettoyée, bornée)', r.status === 200 && b.ok && b.answers.arrival_time === 'vol AT801, à la villa vers 16h' && b.answers.couples === 3 && b.answers.singles === 2 && b.answers.lang === 'en' && /^\d{4}-/.test(b.answers.at));
  check('écriture sur CE séjour (id + propriétaire), details.guest_answers + champs équipe vides remplis', p && /crm_clients\?id=eq\.s1&user_id=eq\.o1/.test(p.url) && p.body.details.guest_answers.couples === 3 && p.body.details.arrival_time === 'vol AT801, à la villa vers 16h' && p.body.details.beds === '3 couples + 2 personnes seules' && p.body.meals === 'Dîner le 1er soir, tajine');
  check('la réponse ne touche à rien d’autre (ni nom, ni dates, ni prix, ni livretSentAt)', Object.keys(p.body).sort().join() === 'details,meals' && p.body.details.livretSentAt === '2026-10-10T09:00:00Z');
  const full = { ...DB.stays[0], meals: 'Repas déjà saisis par le propriétaire', details: { ...DB.stays[0].details, arrival_time: '14h (WhatsApp)', beds: 'ch. 4 en 2 lits' } };
  const body2 = M.applyAnswers(full, M.cleanAnswers({ arrival_time: '16h', couples: 1, meals: 'autre' }, 'fr'));
  check('champs déjà remplis par le propriétaire : jamais écrasés — la réponse reste visible dans guest_answers', body2.details.arrival_time === '14h (WhatsApp)' && body2.details.beds === 'ch. 4 en 2 lits' && !('meals' in body2) && body2.details.guest_answers.arrival_time === '16h');
  check('composition : « 1 couple », « 2 couples + 1 personne seule », rien si rien', M.bedsLine({ couples: 1 }) === '1 couple' && M.bedsLine({ couples: 2, singles: 1 }) === '2 couples + 1 personne seule' && M.bedsLine({}) === '');
  check('réponse vide → 400, rien n’est écrit', (await post({ t: 'A'.repeat(43), answers: { arrival_time: '  ', couples: '' } })).status === 400 && PATCHES.length === 1);
  check('texte trop long borné (120 / 600 / 300), nombres hors bornes ignorés', M.cleanAnswers({ arrival_time: 'x'.repeat(500), meals: 'y'.repeat(900), couples: 99, singles: -1 }, 'fr').arrival_time.length === 120 && M.cleanAnswers({ meals: 'y'.repeat(900) }, 'fr').meals.length === 600 && M.cleanAnswers({ couples: 99, singles: -1, meals: 'm' }, 'fr').couples === null);
  check('jeton inconnu → 404, jeton mal formé → 404 sans toucher la base', (await post({ t: 'Z'.repeat(43), answers: A })).status === 404 && (await post({ t: "x'", answers: A })).status === 404 && PATCHES.length === 1);
  check('séjour terminé → 410, rien n’est écrit', (await post({ t: 'B'.repeat(43), answers: A })).status === 410 && PATCHES.length === 1);
  DB.stays[0].details.guest_answers = b.answers;
  r = await get('t=' + 'A'.repeat(43)); b = await r.json();
  check('GET avec jeton renvoie les réponses déjà données (pour pré-remplir)', b.answers && b.answers.couples === 3);
  let lim2 = false; for (let k = 0; k < 25; k++) { const x = await post({ t: 'A'.repeat(43), answers: A }, '8.8.8.8'); if (x.status === 429) lim2 = true; }
  check('réponses limitées par adresse IP (20 / heure)', lim2);
}
check('réponse jamais mise en cache', /"Cache-Control": "no-store"/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
