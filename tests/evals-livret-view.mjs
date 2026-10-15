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
const CALLS = [], PATCHES = [], NOTICES = [], ERRS = [];
const _err = console.error; console.error = (...a) => { ERRS.push(a.join(' ')); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init) => {
  url = decodeURIComponent(String(url)); CALLS.push(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (init && init.method === 'PATCH') { const ct = Object.entries(init.headers || {}).find(([k]) => k.toLowerCase() === 'content-type'); if (!ct || !/application\/json/.test(ct[1])) return new Response('{"code":"PGRST102"}', { status: 400 }); PATCHES.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
  if (init && init.method === 'POST' && url.includes('/rest/v1/guest_notices')) { NOTICES.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
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
check('lien personnel valide → la fiche et les réponses du client, rien d’autre (ni nom, ni séjour, ni prix)', r.status === 200 && b.facts && b.facts.VILLA.name === 'Villa Test' && Object.keys(b).sort().join() === 'answers,facts,orders' && b.answers === null && b.orders === null);
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
check('écritures en base : la réponse du client (un PATCH du séjour) et l’alerte de commande (un POST dans guest_notices), jamais de DELETE', (src.match(/method:\s*"PATCH"/g) || []).length === 1 && (src.match(/method:\s*"POST"/g) || []).length === 1 && /db\(`guest_notices`, \{ method: "POST"/.test(src) && !/method:\s*"DELETE"/.test(src));

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

// 6. Commande avant l'arrivée (carte des extras) — prix recalculés depuis la fiche, jamais ceux de la page.
{
  const F2 = { VILLA: { name: 'Villa Test' }, MEALS: [
    { n: ['Petit-déjeuner', 'Breakfast'], a: ['Inclus', 'Included'], b: ['Inclus', 'Included'] },
    { n: ['Dîner', 'Dinner'], a: ['650 MAD', '650 MAD'], b: ['850 MAD', '850 MAD'] },
    { n: ['Goûter', 'Afternoon tea'], a: ['300 MAD', '300 MAD'], b: ['400 MAD', '400 MAD'] }],
    EXTRAS: [{ n: ['Transfert aéroport', 'Airport transfer'], price: 400, unit: ['par trajet', 'per trip'] }, { n: ['Sans prix', ''], price: '' }] };
  DB.facts.o2 = F2;
  DB.links.push({ token: 'C'.repeat(43), owner_id: 'o2', client_id: 's2' });
  DB.stays.push({ id: 's2', user_id: 'o2', name: 'Big Group', arrival: iso(4), departure: iso(9), adults: 8, children: 1, details: { livretSentAt: '2026-10-15T09:00:00Z' } });
  check('carte : repas chiffrés seulement (« Inclus » exclu), prix du groupe selon sa taille, extras avec prix', JSON.stringify(M.orderMenu(F2, 4).map((x) => x.id + ':' + x.unit)) === '["m1:650","m2:300","x0:400"]' && JSON.stringify(M.orderMenu(F2, 9).map((x) => x.id + ':' + x.unit)) === '["m1:850","m2:400","x0:400"]');
  check('devise : celle de la villa, sinon lue dans le prix des repas ; prix « 1 500 MAD » lu 1500', M.curOf(F2) === 'MAD' && M.curOf({ VILLA: { currency: '€' } }) === '€' && M.priceOf('1 500 MAD') === 1500 && M.priceOf('Inclus') === null && M.priceOf(0) === null);
  const n0 = PATCHES.length;
  r = await post({ t: 'C'.repeat(43), orders: [{ id: 'm1', q: 2, unit: 1 }, { id: 'x0', q: 1, unit: 0 }, { id: 'm0', q: 3 }, { id: 'x1', q: 2 }, { id: 'zz', q: 5 }, { id: 'm2', q: 99 }] }, '4.4.4.4');
  b = await r.json();
  const p2 = PATCHES[PATCHES.length - 1];
  check('commande → prix de la fiche pour un groupe de 9 (2 × 850 + 1 × 400 = 2 100 MAD), jamais le prix envoyé, lignes inconnues ou hors bornes ignorées', r.status === 200 && b.orders && b.orders.total === 2100 && b.orders.cur === 'MAD' && b.orders.items.map((x) => x.id + '×' + x.q).join() === 'm1×2,x0×1', b.orders);
  check('commande écrite sur CE séjour : details.guest_orders, repas résumés dans meals (vide), rien d’autre', PATCHES.length === n0 + 1 && /crm_clients\?id=eq\.s2&user_id=eq\.o2/.test(p2.url) && p2.body.details.guest_orders.total === 2100 && p2.body.meals === '2 × Dîner' && Object.keys(p2.body).sort().join() === 'details,meals' && p2.body.details.livretSentAt === '2026-10-15T09:00:00Z');
  const withMeals = M.applyOrders({ meals: 'Saisi par le propriétaire', details: {} }, {}, b.orders);
  check('repas déjà saisis par le propriétaire : jamais écrasés (la commande reste dans guest_orders)', !('meals' in withMeals) && withMeals.details.guest_orders.total === 2100);
  check('réponses + commande ensemble : les deux enregistrés, résumé ajouté au texte libre', (() => { const a = M.cleanAnswers({ meals: 'tajine le 1er soir' }, 'fr'); const x = M.applyOrders({ details: {} }, M.applyAnswers({ details: {} }, a), b.orders); return x.meals === 'tajine le 1er soir · 2 × Dîner' && x.details.guest_answers && x.details.guest_orders; })());
  r = await post({ t: 'C'.repeat(43), orders: [] }, '4.4.4.5'); b = await r.json();
  check('commande vidée par le client → total 0 enregistré (la dernière remplace la précédente)', r.status === 200 && b.orders.total === 0 && b.orders.items.length === 0);
  DB.stays[DB.stays.length - 1].details.guest_orders = { items: [{ id: 'm1', q: 1 }], total: 850, cur: 'MAD' };
  r = await get('t=' + 'C'.repeat(43), '4.4.4.6'); b = await r.json();
  check('GET avec jeton renvoie la commande déjà envoyée (pour pré-remplir)', b.orders && b.orders.total === 850);
  check('commande sur un séjour terminé → 410 ; jeton inconnu → 404', (await post({ t: 'B'.repeat(43), orders: [{ id: 'm1', q: 1 }] }, '4.4.4.7')).status === 410 && (await post({ t: 'Z'.repeat(43), orders: [{ id: 'm1', q: 1 }] }, '4.4.4.7')).status === 404);
  check('trop de lignes (> 40) → rien', M.cleanOrders(Array.from({ length: 41 }, () => ({ id: 'm1', q: 1 })), F2, 4) === null);
  {
    const s2 = DB.stays[DB.stays.length - 1]; s2.name = 'Big Group'; s2.details = {};
    const n0 = NOTICES.length;
    await post({ t: 'C'.repeat(43), orders: [{ id: 'm1', q: 2 }] }, '4.4.5.1');
    const nt = NOTICES[NOTICES.length - 1];
    check('commande nouvelle → une alerte (guest_notices) : propriétaire, séjour, prénom + initiale, total, lignes sans prix unitaire', NOTICES.length === n0 + 1 && nt.owner_id === 'o2' && nt.client_id === 's2' && nt.kind === 'order' && nt.payload.guest === 'Big G.' && nt.payload.total === 1700 && nt.payload.cur === 'MAD' && JSON.stringify(nt.payload.items) === '[{"n":["Dîner","Dinner"],"q":2}]', nt);
    s2.details = { guest_orders: { items: [{ id: 'm1', q: 2 }], total: 1700 } };
    await post({ t: 'C'.repeat(43), orders: [{ id: 'm1', q: 2 }], answers: { arrival_time: '17h' } }, '4.4.5.2');
    check('même commande renvoyée (ex. pour ajouter l’heure d’arrivée) → pas de deuxième alerte', NOTICES.length === n0 + 1);
    await post({ t: 'C'.repeat(43), orders: [{ id: 'm1', q: 3 }] }, '4.4.5.3');
    check('commande modifiée → nouvelle alerte', NOTICES.length === n0 + 2 && NOTICES[NOTICES.length - 1].payload.total === 2550);
    await post({ t: 'C'.repeat(43), orders: [] }, '4.4.5.4');
    check('commande vidée → pas d’alerte', NOTICES.length === n0 + 2);
    check('alerte écrite sans erreur (réponse 201 vide de PostgREST lue proprement)', !ERRS.some((e) => /notice/.test(e)), ERRS);
    check('le nom complet du client ne part jamais : prénom + initiale', M.shortName('Claire Vasseur') === 'Claire V.' && M.shortName('Seán') === 'Seán');
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
