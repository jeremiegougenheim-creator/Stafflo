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
  links: [{ token: 'A'.repeat(43), owner_id: 'o1', client_id: 's1' }, { token: 'B'.repeat(43), owner_id: 'o1', client_id: 's-old' },
    { id: 'L4', token: 'D'.repeat(43), owner_id: 'o1', client_id: 's1', opens: 0, first_opened_at: null, last_opened_at: null }], // colonnes d'ouverture (22/10)
  stays: [
    { id: 's1', user_id: 'o1', name: 'Ana Ruiz', arrival: iso(2), departure: iso(5), details: { livretSentAt: '2026-10-10T09:00:00Z' } },
    { id: 's-old', user_id: 'o1', name: 'Old Guest', arrival: iso(-20), departure: iso(-10), details: {} },
  ],
  facts: { o1: FACTS },
};
const CALLS = [], PATCHES = [], NOTICES = [], ERRS = [], REGS = [], REG_WRITES = [];
const KEY = Buffer.alloc(32, 7).toString('base64');
const _err = console.error; console.error = (...a) => { ERRS.push(a.join(' ')); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init) => {
  url = decodeURIComponent(String(url)); CALLS.push(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes('/rest/v1/rpc/guest_reg_key')) return ok(KEY);
  if (url.includes('/rest/v1/guest_registrations')) {
    const ct = Object.entries((init && init.headers) || {}).find(([k]) => k.toLowerCase() === 'content-type');
    if (init && (init.method === 'POST' || init.method === 'PATCH')) {
      if (!ct || !/application\/json/.test(ct[1])) return new Response('{"code":"PGRST102"}', { status: 400 });
      const body = JSON.parse(init.body); REG_WRITES.push({ method: init.method, url, raw: init.body });
      if (init.method === 'POST') { REGS.push({ id: 'r' + REGS.length, deleted_at: null, ...body }); return new Response(null, { status: 201 }); }
      const id = url.match(/id=eq\.([^&]+)/)[1]; Object.assign(REGS.find((x) => x.id === id), body); return new Response(null, { status: 204 });
    }
    const o = url.match(/owner_id=eq\.([^&]+)/)[1], cl = url.match(/client_id=eq\.([^&]+)/)[1];
    return ok(REGS.filter((x) => x.owner_id === o && x.client_id === cl && !x.deleted_at && (!/purged_at=is\.null/.test(url) || !x.purged_at)));
  }
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
check('lien personnel valide → la fiche, les réponses du client, les dates du séjour (pour dater les repas) et l’en-tête du livret (nom, nombre — lien court, 18/10), rien d’autre (ni prix, ni téléphone)', r.status === 200 && b.facts && b.facts.VILLA.name === 'Villa Test' && Object.keys(b).sort().join() === 'answers,days,facts,orders,stay' && b.answers === null && b.orders === null && b.days.from === iso(2) && b.days.to === iso(5) && b.stay.name === 'Ana Ruiz' && b.stay.pax === null && Object.keys(b.stay).sort().join() === 'name,pax', b);
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
check('écritures en base : le séjour (PATCH), l’ouverture du livret (livret_links, PATCH — 22/10), l’alerte de commande (guest_notices), les fiches voyageurs (guest_registrations, POST ou PATCH) et la lecture de la clé — jamais de DELETE', (src.match(/method:\s*"PATCH"/g) || []).length === 3 && /db\(`livret_links\?id=eq\.\$\{r\.link!\.id\}`, \{ method: "PATCH"/.test(src) && (src.match(/method:\s*"POST"/g) || []).length === 3 && /db\(`guest_notices`, \{ method: "POST"/.test(src) && /db\(`guest_registrations`, \{ method: "POST"/.test(src) && /db\(`guest_registrations\?id=eq\.\$\{cur\[0\]\.id\}`, \{ method: "PATCH"/.test(src) && /db\("rpc\/guest_reg_key", \{ method: "POST"/.test(src) && !/method:\s*"DELETE"/.test(src));

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
  { // 17/10/2026 — deux versions de la carte : un repas « maison » 'off' n'est proposé qu'aux groupes de 1 à 6 ; 'kitchen' l'est à 7+ au prix 7–10
    const F3 = { MEALS: F2.MEALS.concat([
      { n: ['Déjeuner léger', 'Light lunch'], a: ['450 MAD', '450 MAD'], b: ['450 MAD', '450 MAD'], house: true, big: 'off' },
      { n: ['Brunch', 'Brunch'], a: ['450 MAD', '450 MAD'], b: ['850 MAD', '850 MAD'], house: true, big: 'kitchen' }]) };
    check('deux versions : 1–6 → déjeuner léger et brunch à 450 ; 7+ → pas de déjeuner léger, brunch à 850 ; une commande du déjeuner léger à 7+ est ignorée',
      JSON.stringify(M.orderMenu(F3, 6).map((x) => x.id + ':' + x.unit)) === '["m1:650","m2:300","m3:450","m4:450"]' &&
      JSON.stringify(M.orderMenu(F3, 8).map((x) => x.id + ':' + x.unit)) === '["m1:850","m2:400","m4:850"]' &&
      M.mealOff(F3.MEALS[3], 7) && !M.mealOff(F3.MEALS[3], 6) && !M.mealOff(F3.MEALS[4], 10) &&
      !JSON.stringify(M.cleanOrders([{ id: 'm3', q: 1 }, { id: 'm1', q: 2 }], F3, 8) || {}).includes('"m3"'));
  }
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
  { // 17/10/2026 — commande datée : un jour du séjour et, si la ligne en a plusieurs, le service
    const FD = { MEALS: [
      { n: ['Petit-déjeuner', 'Breakfast'], a: ['Inclus', 'Included'], b: ['Inclus', 'Included'] },
      { n: ['Déjeuner ou dîner', 'Lunch or dinner'], a: ['650 MAD', '650 MAD'], b: ['850 MAD', '850 MAD'] },
      { n: ['Goûter', 'Afternoon tea'], a: ['450 MAD', '450 MAD'], b: ['450 MAD', '450 MAD'] }] };
    const R = { from: '2026-10-20', to: '2026-10-23' };
    check('services lus dans le nom de la ligne : « Déjeuner ou dîner » → midi / soir, « Brunch, déjeuner ou dîner » → les trois, un seul service → aucun choix',
      M.svcOf(FD.MEALS[1]).join() === 'l,d' && M.svcOf({ n: ['Brunch, déjeuner ou dîner', 'Brunch, lunch or dinner'] }).join() === 'b,l,d' && M.svcOf(FD.MEALS[2]).join() === '' && M.svcOf({ n: ['Dîner', 'Dinner'] }).join() === '');
    const o = M.cleanOrders([
      { id: 'm1', q: 9, when: [{ d: '2026-10-22', s: 'l' }, { d: '2026-10-21', s: 'd' }, { d: '2026-10-21', s: 'd' }, { d: '2026-10-25', s: 'd' }, { d: '2026-10-21', s: 'x' }, { d: '2026-10-21' }, { d: 'demain', s: 'd' }] },
      { id: 'm2', when: [{ d: '2026-10-22', s: 'd' }, { d: '2026-10-23' }] }], FD, 4, R);
    check('cases datées : hors séjour, service inconnu ou absent, doublon → jetés ; quantité = nombre de cases (jamais celle envoyée) ; triées par jour ; prix de la fiche',
      o && o.total === 2 * 650 + 450 && JSON.stringify(o.items.map((x) => [x.id, x.q, x.when])) === JSON.stringify([['m1', 2, [{ d: '2026-10-21', s: 'd' }, { d: '2026-10-22', s: 'l' }]], ['m2', 1, [{ d: '2026-10-23' }]]]), o && o.items);
    check('sans dates de séjour, ou aucune case valable → la ligne datée est ignorée (pas de repli sur la quantité envoyée)',
      M.cleanOrders([{ id: 'm1', q: 3, when: [{ d: '2026-10-21', s: 'd' }] }], FD, 4, null).items.length === 0 && M.cleanOrders([{ id: 'm1', q: 3, when: [{ d: '2026-11-30', s: 'd' }] }], FD, 4, R).items.length === 0);
    check('ancienne page (quantités sans dates) → acceptée comme avant', M.cleanOrders([{ id: 'm1', q: 2 }], FD, 4, R).items[0].q === 2 && !('when' in M.cleanOrders([{ id: 'm1', q: 2 }], FD, 4, R).items[0]));
    check('repas résumés pour l’équipe avec le jour et le service, en français', M.applyOrders({ details: {} }, {}, o).meals === '2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi · 1 × Goûter — ven. 23', M.applyOrders({ details: {} }, {}, o).meals);
    // 22/10 — extras datés : q = nombre par case, cases jour × moment (am / pm / ev) du séjour seulement
    const FX = { ...FD, VILLA: { name: 'X', currency: 'MAD' }, EXTRAS: [{ n: ['Massage 60 min', ''], price: 550, cat: ['Bien-être', 'Wellness'] }, { n: ['Transfert — van', ''], price: 600 }, { n: ['Panier', ''], price: 150 }] };
    const ox = M.cleanOrders([
      { id: 'x0', q: 2, when: [{ d: '2026-10-21', s: 'pm' }, { d: '2026-10-21', s: 'pm' }, { d: '2026-10-25', s: 'pm' }, { d: '2026-10-22', s: 'd' }] },
      { id: 'x1', q: 1, when: [{ d: '2026-10-23', s: 'am' }, { d: '2026-10-20', s: 'pm' }] },
      { id: 'x2', q: 1 }], FX, 4, R);
    const xi = ox && Object.fromEntries(ox.items.map((x) => [x.id, x]));
    check('extras datés : nombre par case × cases valables (doublon, hors séjour, moment de repas → jetés), per et when gardés, prix de la fiche ; extra sans case = compteur comme avant',
      ox && xi.x0.q === 2 && xi.x0.per === 2 && JSON.stringify(xi.x0.when) === JSON.stringify([{ d: '2026-10-21', s: 'pm' }]) && xi.x0.sub === 1100 &&
      xi.x1.q === 2 && xi.x1.per === 1 && JSON.stringify(xi.x1.when) === JSON.stringify([{ d: '2026-10-20', s: 'pm' }, { d: '2026-10-23', s: 'am' }]) && xi.x1.sub === 1200 &&
      xi.x2.q === 1 && !('when' in xi.x2) && !('per' in xi.x2) && ox.total === 1100 + 1200 + 150, ox && ox.items);
    check('extra daté sans case valable → pas perdu : le compteur seul (sans when) ; nombre 0 → rien',
      JSON.stringify(M.cleanOrders([{ id: 'x0', q: 2, when: [{ d: '2026-11-30', s: 'pm' }] }], FX, 4, R).items.map((x) => [x.q, 'when' in x])) === '[[2,false]]' && M.cleanOrders([{ id: 'x0', q: 0, when: [{ d: '2026-10-21', s: 'pm' }] }], FX, 4, R).items.length === 0);
    check('extras datés : les extras ne vont jamais dans le résumé des repas de l’équipe ; même commande, autre moment → commande modifiée',
      !/Massage|Transfert/.test(M.applyOrders({ details: {} }, {}, ox).meals || '') && !M.sameOrder(ox, M.cleanOrders([{ id: 'x0', q: 2, when: [{ d: '2026-10-21', s: 'ev' }] }, { id: 'x1', q: 1, when: [{ d: '2026-10-23', s: 'am' }, { d: '2026-10-20', s: 'pm' }] }, { id: 'x2', q: 1 }], FX, 4, R)));
    check('publicFacts garde la rubrique (cat) : elle est faite pour le livret', JSON.stringify(M.publicFacts(FX).EXTRAS[0].cat) === '["Bien-être","Wellness"]');
    const o2 = M.cleanOrders([{ id: 'm1', when: [{ d: '2026-10-21', s: 'l' }, { d: '2026-10-22', s: 'l' }] }, { id: 'm2', when: [{ d: '2026-10-23' }] }], FD, 4, R);
    check('mêmes quantités, autres jours → commande modifiée (nouvelle alerte) ; mêmes cases → identique', !M.sameOrder(o, o2) && M.sameOrder(o, JSON.parse(JSON.stringify(o))));
    const s2 = DB.stays[DB.stays.length - 1]; s2.details = {}; s2.meals = '';
    r = await post({ t: 'C'.repeat(43), orders: [{ id: 'm1', when: [{ d: iso(5) }, { d: iso(6) }, { d: iso(30) }] }] }, '4.4.6.1'); b = await r.json();
    const pd = PATCHES[PATCHES.length - 1];
    check('par la fonction : jours du séjour seulement (arrivée → départ), quantité recalculée, écrite avec ses jours', r.status === 200 && b.orders.items.length === 1 && b.orders.items[0].q === 2 && b.orders.total === 1700 && pd.body.details.guest_orders.items[0].when.map((w) => w.d).join() === iso(5) + ',' + iso(6), b.orders);
    r = await get('t=' + 'C'.repeat(43), '4.4.6.2'); b = await r.json();
    check('GET : les dates du séjour pour proposer les jours', b.days && b.days.from === iso(4) && b.days.to === iso(9), b.days);
    check('GET : en-tête du livret — nom et nombre (adultes + enfants), pour le lien court', b.stay && b.stay.name === 'Big Group' && b.stay.pax === 9, b.stay);
    s2.details = {};
  }
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

// 7. Fiches voyageurs : seulement si la villa les demande, chiffrées, jamais renvoyées au lien.
{
  const unseal = async (s) => { const all = Buffer.from(s.slice(3), 'base64'); const key = await crypto.subtle.importKey('raw', Buffer.from(KEY, 'base64'), 'AES-GCM', false, ['decrypt']); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12)))); };
  const T1 = { last: 'Ruiz', first: 'Ana', birth_date: '1990-04-02', birth_place: 'Sevilla', nationality: 'Espagnole', doc_type: 'passport', doc_no: 'PAE123456', profession: 'Architecte', address: 'Calle Mayor 1, Madrid, Espagne', secret: 'x' };
  const T2 = { last: 'Ruiz', first: 'Leo', birth_date: '02/03/2015', doc_type: 'visa', doc_no: 'X9' };
  r = await post({ t: 'A'.repeat(43), travellers: [T1] }, '5.5.5.1');
  check('villa qui ne demande pas les fiches → 400, rien d’écrit', r.status === 400 && REG_WRITES.length === 0);
  DB.facts.o2.VILLA.guest_registration = true;
  r = await post({ t: 'C'.repeat(43), travellers: [T1, T2, { last: '', first: '  ' }] }, '5.5.5.2'); b = await r.json();
  const w = REG_WRITES[REG_WRITES.length - 1];
  check('fiches → 200, { count, at } seulement : aucune donnée de voyageur renvoyée', r.status === 200 && b.reg && b.reg.count === 2 && !JSON.stringify(b).includes('PAE123456') && !JSON.stringify(b).includes('Sevilla'), b);
  check('écrites chiffrées (« v1: … ») : ni numéro de passeport ni nom en clair dans la ligne', w && w.method === 'POST' && /^v1:/.test(REGS[0].enc) && !w.raw.includes('PAE123456') && !w.raw.includes('Ruiz') && REGS[0].owner_id === 'o2' && REGS[0].client_id === 's2' && REGS[0].travellers === 2, w && w.raw.slice(0, 200));
  const dec = await unseal(REGS[0].enc);
  check('déchiffrées avec la clé : champs connus seulement, date invalide vidée, pièce inconnue vidée, fiche vide ignorée', dec.travellers.length === 2 && dec.travellers[0].doc_no === 'PAE123456' && !('secret' in dec.travellers[0]) && dec.travellers[1].birth_date === '' && dec.travellers[1].doc_type === '', dec);
  check('effacement prévu un an après le départ', REGS[0].purge_after === M.plusDays(DB.stays.find((s) => s.id === 's2').departure, 365) && REGS[0].purge_after > iso(370));
  r = await post({ t: 'C'.repeat(43), travellers: [T1] }, '5.5.5.3');
  check('renvoi → la même ligne est remplacée (PATCH), pas une deuxième', REGS.length === 1 && REG_WRITES[REG_WRITES.length - 1].method === 'PATCH' && REGS[0].travellers === 1);
  r = await get('t=' + 'C'.repeat(43), '5.5.5.4'); b = await r.json();
  check('GET avec jeton : seulement « fiches reçues · nombre · date », jamais les fiches', b.reg && b.reg.count === 1 && !!b.reg.at && !JSON.stringify(b).includes('PAE123456'), b.reg);
  REGS[0].purged_at = new Date().toISOString(); REGS[0].enc = null;
  r = await get('t=' + 'C'.repeat(43), '5.5.5.5'); b = await r.json();
  check('fiches effacées → plus rien d’annoncé', b.reg === null);
  check('trop de voyageurs (> 30) → rien ; champs bornés', M.cleanTravellers(Array.from({ length: 31 }, () => T1)) === null && M.cleanTravellers([{ last: 'x'.repeat(200), first: 'y' }])[0].last.length === 60);
  r = await post({ t: 'B'.repeat(43), travellers: [T1] }, '5.5.5.6');
  check('séjour terminé → 410, aucune fiche écrite', r.status === 410 && REGS.length === 1);
}

// Ouvertures du livret par le client (22/10/2026) : livret_links.opens / first_opened_at / last_opened_at, écrites par GET ?t=.
{
  const now = Date.parse('2026-10-22T10:00:00Z');
  check('openPatch : première ouverture → opens 1, first et last posés', JSON.stringify(M.openPatch({ id: 'L', opens: 0, first_opened_at: null, last_opened_at: null }, now)) === JSON.stringify({ opens: 1, last_opened_at: '2026-10-22T10:00:00.000Z', first_opened_at: '2026-10-22T10:00:00.000Z' }));
  check('openPatch : rechargement 10 min après → rien (une lecture, pas deux)', M.openPatch({ id: 'L', opens: 1, first_opened_at: '2026-10-22T10:00:00Z', last_opened_at: '2026-10-22T10:00:00Z' }, now + 10 * 60000) === null);
  const p2 = M.openPatch({ id: 'L', opens: 1, first_opened_at: '2026-10-22T10:00:00Z', last_opened_at: '2026-10-22T10:00:00Z' }, now + 31 * 60000);
  check('openPatch : 31 min après → opens 2, first inchangé, last avancé', p2 && p2.opens === 2 && p2.first_opened_at === '2026-10-22T10:00:00Z' && p2.last_opened_at === '2026-10-22T10:31:00.000Z');
  check('openPatch : colonnes absentes (migration pas passée) → rien, le livret marche comme avant', M.openPatch({ owner_id: 'o1', client_id: 's1' }, now) === null && M.openPatch(undefined, now) === null);
  const n0 = PATCHES.length;
  let r = await get('t=' + 'D'.repeat(43), '7.7.7.1');
  const pl = PATCHES.filter((x) => x.url.includes('/rest/v1/livret_links'));
  check('GET ?t= par le client → une ouverture écrite sur CE lien (id), rien d’autre', r.status === 200 && pl.length === 1 && pl[0].url.includes('id=eq.L4') && pl[0].body.opens === 1 && !!pl[0].body.first_opened_at && PATCHES.length === n0 + 1, pl);
  r = await get('t=' + 'D'.repeat(43) + '&o=1', '7.7.7.2');
  check('GET ?t=&o=1 (le propriétaire vérifie le lien) → rien d’écrit', r.status === 200 && PATCHES.length === n0 + 1);
  r = await get('t=' + 'A'.repeat(43), '7.7.7.3');
  check('lien sans colonnes d’ouverture → rien d’écrit, livret servi', r.status === 200 && PATCHES.length === n0 + 1);
  check('la réponse ne renvoie pas les compteurs au client', !JSON.stringify(await r.json()).includes('opens'));
}

// ── 22/10 — ce qui reste entre le propriétaire et sa maison ne part jamais au client ──
{
  const FP = { VILLA: { name: 'Riad Zina', said: '+212 600 000 001' }, TEAM: [{ name: 'Omar', role: ['gardien', ''], phone: '+212600000000', brief: true }],
    EXTRAS: [{ n: ['Massage 60 min', ''], price: 550, unit: ['par personne', ''], who: 'Houda', wa: '+212 649 967 722', take: 100 }, { n: ['Panier', ''], price: 150 }], MEALS: [{ n: ['Dîner', ''], a: 650 }] };
  const pub = M.publicFacts(FP);
  check('publicFacts : TEAM sans téléphone, EXTRAS sans prestataire (who / wa) ni « ce que vous gardez » (take) ; prix, unité, nom gardés ; le contact public VILLA.said reste',
    !('phone' in pub.TEAM[0]) && pub.TEAM[0].name === 'Omar' && !('who' in pub.EXTRAS[0]) && !('wa' in pub.EXTRAS[0]) && !('take' in pub.EXTRAS[0]) && pub.EXTRAS[0].price === 550 && pub.EXTRAS[0].unit[0] === 'par personne' && pub.VILLA.said === '+212 600 000 001' && !JSON.stringify(pub).includes('649 967'), JSON.stringify(pub));
  check('publicFacts : la fiche d’origine n’est pas modifiée (l’Espace du propriétaire la lit entière)', FP.TEAM[0].phone === '+212600000000' && FP.EXTRAS[0].who === 'Houda' && FP.EXTRAS[0].take === 100);
  check('publicFacts : la carte de commande (prix recalculés) est la même avant et après', JSON.stringify(M.orderMenu(pub, 4)) === JSON.stringify(M.orderMenu(FP, 4)));
  check('factsOf passe par publicFacts, et c’est la seule lecture de house_facts du service', /return f && typeof f === "object" && f\.VILLA \? publicFacts\(f\) : null;/.test(src) && (src.match(/select=house_facts/g) || []).length === 1 && (src.match(/await factsOf\(/g) || []).length >= 3);
}

// 22/10/2026 (v14) — contact ≠ réservant (Lise pour Seán) ; heure notée par l'hôte gardée quand le client renvoie sa commande
{
  check('en-tête du livret : le prénom du contact (details.contact), seul — rien d’autre du séjour', JSON.stringify(M.stayHead({ name: 'Seán', adults: 10, details: { contact: { name: '~Lise Hickey', at: 'x' }, notes: 'privé' } })) === JSON.stringify({ name: 'Seán', pax: 10, contact: 'Lise' }) &&
    JSON.stringify(M.stayHead({ name: 'Seán', adults: 2, details: {} })) === JSON.stringify({ name: 'Seán', pax: 2 }) && M.contactFirst({ details: { contact: 'Lise' } }) === '');
  const prev = { by: 'owner', items: [{ id: 'm2', kind: 'meal', q: 1, when: [{ d: '2026-10-26', t: '14:00' }] }, { id: 'm1', kind: 'meal', q: 3, when: [{ d: '2026-10-26', s: 'd' }, { d: '2026-10-30', s: 'd' }] }] };
  const now = { items: [{ id: 'm2', kind: 'meal', q: 1, when: [{ d: '2026-10-26' }] }, { id: 'm1', kind: 'meal', q: 2, when: [{ d: '2026-10-26', s: 'd' }, { d: '2026-10-31', s: 'd' }] }, { id: 'x0', kind: 'extra', q: 1 }], total: 1, cur: 'MAD' };
  const kt = M.keepTimes(prev, now);
  check('le client renvoie sa commande : la case identique garde l’heure notée (goûter lun. 26 · 14h), une case nouvelle n’en invente pas, le reste inchangé',
    kt.items[0].when[0].t === '14:00' && !kt.items[1].when.some((w) => w.t) && kt.items[2].q === 1 && kt.total === 1 && M.keepTimes(null, now) === now && !now.items[0].when[0].t);
  check('POST : keepTimes appliqué à la commande nettoyée, avant l’enregistrement et l’alerte', /const o = o0 \? keepTimes\(ordersOf\(r\.stay\), o0\) : null;/.test(src));
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
