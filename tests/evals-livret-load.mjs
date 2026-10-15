// Livret (livret.html) — d'où vient la fiche maison, et ce que voit le client quand elle ne vient pas.
//   node tests/evals-livret-load.mjs        (Chromium headless, réseau entièrement simulé)
//
// La fiche n'est plus un fichier public (villa-facts.js) : le livret la demande à livret-view
// avec le lien personnel du séjour (?t=), ou à la base pour le propriétaire connecté, ou —
// anciens liens seulement — avec le nom et les dates. Le rendu doit être celui d'avant :
// prouvé le 13/10/2026 (6 combinaisons de paramètres, HTML identique au caractère près).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACTS = fs.readFileSync(path.join(root, '_private/house-facts-pilot.json'), 'utf8');
const html = fs.readFileSync(path.join(root, 'livret.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

// ── Statique : plus aucune donnée de la villa dans la page ─────────────────
check('la page ne charge plus villa-facts.js', !html.includes('villa-facts.js'));
check('plus de QR WhatsApp (numéros) en dur dans la page', !/<svg class="qr-svg"/.test(html) && /QR_SAID = \(window\.VILLA_FACTS\.QR \|\| \{\}\)\.staff/.test(html));
check('le script du livret attend la fiche (type text/plain, lancé après chargement)', /<script type="text\/plain" id="livret-main">/.test(html) && html.indexOf('house-facts.js') < html.indexOf('id="livret-main"'));

// ── Navigateur ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch();
const TOK = 'A'.repeat(43);
const UID = '00000000-0000-4000-8000-000000000001';
const sessionFor = (expiresInS) => JSON.stringify({ access_token: 'jwt-test', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: UID } });

// view: (url) => {status, body}   rest: idem pour /rest/v1/villa_settings
async function open(qs, { view = () => ({ status: 404, body: '{"error":"not_found"}' }), rest = () => ({ status: 200, body: '[]' }), session = null, post = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const calls = [];
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url();
    if (u.includes('/functions/v1/livret-view') && req.method() === 'POST') { const body = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'post', body }); const r = post ? post(body) : { status: 200, body: JSON.stringify({ ok: true, answers: { ...body.answers, couples: +body.answers.couples || null, singles: +body.answers.singles || null, at: '2026-10-15T09:00:00Z' } }) }; return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: r.body }); }
    if (u.includes('/functions/v1/livret-view')) { calls.push({ kind: 'view', u }); const r = view(u); return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: r.body }); }
    if (u.includes('/rest/v1/villa_settings')) { calls.push({ kind: 'rest', u, auth: req.headers().authorization }); const r = rest(u); return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: r.body }); }
    if (u.includes('villa-facts.js')) calls.push({ kind: 'villa-facts' });
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  if (session) await ctx.addInitScript((s) => { localStorage.setItem('stafflo_session', s); }, session);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/livret.html?${qs}`);
  await page.waitForFunction(() => { const s = document.getElementById('sheet'); return s.innerHTML.length > 1000 || s.querySelector('[role=status]'); }, null, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => { const s = document.getElementById('sheet'); const bar = document.querySelector('.bar'); return { len: s.innerHTML.length, msg: (s.querySelector('[role=status]') || {}).innerText || '', qr: s.querySelectorAll('svg.qr-svg').length, bar: !!(bar && bar.offsetParent !== null), form: !!document.getElementById('arrive') }; });
  return { ...r, calls, errs, page, ctx };
}
const ok200 = () => ({ status: 200, body: '{"facts":' + FACTS + '}' });
const msgOnly = (r) => r.len < 2000 && r.qr === 0;

let r = await open('t=' + TOK + '&guest=Ana&lang=fr', { view: ok200 });
check('lien personnel → livret complet (QR compris), une seule demande, sans erreur', r.len > 30000 && r.qr === 2 && r.calls.filter((c) => c.kind === 'view').length === 1 && r.calls[0].u.includes('t=' + TOK) && !r.errs.length, { len: r.len, qr: r.qr, errs: r.errs });
check('villa-facts.js jamais demandé', !r.calls.some((c) => c.kind === 'villa-facts'));
check('client (lien personnel, pas de session) : la barre d’édition du propriétaire est cachée', r.bar === false);
// « Votre arrivée » : le client répond, ça part sur SON séjour avec le jeton
check('lien personnel → bloc « Votre arrivée » dans le livret (jamais à l’impression)', r.form === true && /\.bar,\.hint,\.arrive\{display:none !important\}/.test(html));
await r.page.fill('#ar-time', 'vol AT801, à la villa vers 16h'); await r.page.fill('#ar-c', '3'); await r.page.fill('#ar-s', '2'); await r.page.fill('#ar-m', 'Dîner le 1er soir');
await r.page.click('#ar-send'); await r.page.waitForTimeout(400);
const sent = r.calls.find((c) => c.kind === 'post');
check('envoi : jeton du séjour + langue + les 4 réponses, rien d’autre', sent && sent.body.t === TOK && sent.body.lang === 'fr' && sent.body.answers.arrival_time === 'vol AT801, à la villa vers 16h' && sent.body.answers.couples === '3' && sent.body.answers.singles === '2' && sent.body.answers.meals === 'Dîner le 1er soir' && Object.keys(sent.body).sort().join() === 'answers,lang,t');
check('après envoi : « transmis à l’équipe », formulaire toujours modifiable', /transmis à l’équipe/.test(await r.page.evaluate(() => document.getElementById('ar-st').innerText)) && !(await r.page.evaluate(() => document.getElementById('ar-send').disabled)));
await r.ctx.close();

r = await open('t=' + TOK + '&lang=en', { view: () => ({ status: 200, body: '{"facts":' + FACTS + ',"answers":{"arrival_time":"around 4 pm","couples":2,"singles":1,"meals":"","at":"2026-10-14T10:00:00Z","lang":"en"}}' }) });
check('réponses déjà données → formulaire pré-rempli, « Sent on 14 October »', (await r.page.evaluate(() => [document.getElementById('ar-time').value, document.getElementById('ar-c').value, document.getElementById('ar-s').value, document.getElementById('ar-st').innerText].join('|'))) === 'around 4 pm|2|1|Sent on 14 October');
await r.ctx.close();

r = await open('t=' + TOK + '&lang=fr', { view: ok200, post: () => ({ status: 503, body: '{}' }) });
await r.page.fill('#ar-time', '16h'); await r.page.click('#ar-send'); await r.page.waitForTimeout(400);
check('serveur indisponible à l’envoi → message clair, on peut réessayer', /connexion/.test(await r.page.evaluate(() => document.getElementById('ar-st').innerText)) && !(await r.page.evaluate(() => document.getElementById('ar-send').disabled)));
await r.ctx.close();

r = await open('t=' + TOK + '&lang=fr', { view: ok200 });
await r.page.click('#ar-send'); await r.page.waitForTimeout(300);
check('formulaire vide → rien n’est envoyé', !r.calls.some((c) => c.kind === 'post'));
await r.ctx.close();

// ── Commande avant l'arrivée (15/10/2026) : repas chiffrés + extras, prix de la fiche ──────────
const ordRows = (page) => page.$$eval('#ord .ord-row', (rs) => rs.map((x) => x.querySelector('b').innerText + ' | ' + x.querySelector('span').innerText.split('\n')[0]));
const ORDER_OK = (body) => ({ status: 200, body: JSON.stringify({ ok: true, answers: null, orders: { items: body.orders.map((x) => ({ id: x.id, q: x.q })), total: 2100, cur: 'MAD', at: '2026-10-15T10:00:00Z' } }) });
r = await open('t=' + TOK + '&pax=9&lang=fr', { view: ok200, post: ORDER_OK });
let rows = await ordRows(r.page);
check('pilote, groupe de 9 : carte = service et goûter au tarif 7–10 (850 / 400 MAD), puis les transferts de la fiche (300 / 600 MAD par trajet), jamais le petit-déjeuner inclus', rows.length === 4 && /Brunch, déjeuner ou dîner/.test(rows[0]) && /850 MAD · par service, pour tout le groupe/.test(rows[0]) && /Goûter/.test(rows[1]) && /400 MAD/.test(rows[1]) && /voiture.*300 MAD · par trajet/.test(rows[2]) && /van.*600 MAD · par trajet/.test(rows[3]) && !rows.some((x) => /Petit-déjeuner/.test(x)), rows);
await r.page.click('[data-ord="1"][data-id="m1"]'); await r.page.click('[data-ord="1"][data-id="m1"]'); await r.page.click('[data-ord="1"][data-id="m2"]'); await r.page.click('[data-ord="1"][data-id="m2"]'); await r.page.click('[data-ord="-1"][data-id="m2"]');
check('le client compte : 2 services + 1 goûter → total indicatif 2 100 MAD, sans recharger la page', /2\s?100 MAD/.test(await r.page.innerText('#ord-tot')) && (await r.page.innerText('#oq-m1')) === '2' && (await r.page.innerText('#oq-m2')) === '1');
await r.page.click('#ar-send'); await r.page.waitForTimeout(400);
let ps = r.calls.filter((c) => c.kind === 'post').pop();
check('envoi : seulement id et quantité (jamais un prix), sans réponses vides', ps && JSON.stringify(ps.body.orders) === '[{"id":"m1","q":2},{"id":"m2","q":1}]' && !('answers' in ps.body) && ps.body.t === TOK, ps && ps.body);
check('après envoi : « Commande transmise · total 2 100 MAD »', /Commande transmise · total 2\s?100 MAD/.test(await r.page.innerText('#ar-st')));
await r.ctx.close();
r = await open('t=' + TOK + '&pax=4&lang=fr', { view: ok200 });
rows = await ordRows(r.page);
check('pilote, groupe de 4 : tarif 1–6 (650 / 300 MAD)', /650 MAD/.test(rows[0]) && /300 MAD/.test(rows[1]), rows);
await r.ctx.close();
// Autre villa : extras de la fiche, devise de la villa, commande déjà envoyée relue
const XF = JSON.stringify({ VILLA: { name: 'Riad Zina', host: 'Nadia', currency: '€' }, EXTRAS: [{ n: ['Transfert aéroport', 'Airport transfer'], price: 40, unit: ['par trajet', 'per trip'] }, { n: ['Massage', ''], price: 60, unit: ['par personne', ''], d: ['Au riad, 1 h', ''] }, { n: ['Sans prix', ''] }] });
r = await open('t=' + TOK + '&lang=fr', { view: () => ({ status: 200, body: '{"facts":' + XF + ',"orders":{"items":[{"id":"x1","q":2}],"total":120,"cur":"€"}}' }) });
rows = await ordRows(r.page);
check('autre villa : extras avec prix et unité (« 40 € · par trajet »), sans prix = pas proposé', rows.length === 2 && /Transfert aéroport \| 40 € · par trajet/.test(rows[0]) && /Massage \| 60 € · par personne/.test(rows[1]), rows);
check('commande déjà envoyée → compteurs pré-remplis et « Commande transmise · total 120 € »', (await r.page.innerText('#oq-x1')) === '2' && /Commande transmise · total 120 €/.test(await r.page.innerText('#ar-st')) && !r.errs.length);
await r.ctx.close();
r = await open('t=' + TOK + '&lang=fr', { view: () => ({ status: 200, body: '{"facts":' + JSON.stringify({ VILLA: { name: 'Riad Zina' } }) + '}' }) });
check('fiche sans repas chiffré ni extra : pas de carte', !(await r.page.$('#ord')) && r.form === true);
await r.ctx.close();

r = await open('guest=Ana&dates=1%20JAN%20%E2%80%93%205%20JAN%2027&lang=fr', { session: sessionFor(3600), rest: () => ({ status: 200, body: '[{"house_facts":' + FACTS + '}]' }) });
const rc = r.calls.find((c) => c.kind === 'rest');
check('propriétaire connecté (sans jeton) → sa fiche, lue avec SA session et son id', r.len > 30000 && rc && rc.auth === 'Bearer jwt-test' && rc.u.includes('owner_id=eq.' + UID) && !r.calls.some((c) => c.kind === 'view'), { len: r.len });
check('propriétaire connecté : la barre d’édition est là', r.bar === true);
check('sans jeton (ancien lien, propriétaire) : pas de bloc « Votre arrivée » — personne à qui transmettre', r.form === false);
await r.ctx.close();

r = await open('t=' + TOK + '&lang=fr', { session: sessionFor(3600), view: ok200 });
check('propriétaire connecté qui ouvre un lien personnel (depuis l’app) : barre d’édition visible', r.len > 30000 && r.bar === true);
await r.ctx.close();
r = await open('t=' + TOK + '&lang=fr&edit=1', { view: ok200 });
check('?edit=1 : barre d’édition visible même sans session', r.len > 30000 && r.bar === true);
await r.page.fill('#g', 'Zélie Martin'); await r.page.waitForTimeout(100);
check('le livret reste éditable après chargement (le nom saisi s’affiche)', (await r.page.evaluate(() => document.getElementById('sheet').innerText)).includes('Zélie'));
await r.ctx.close();

r = await open('guest=Ana&dates=1%20JAN%20%E2%80%93%205%20JAN%2027&lang=fr', { session: sessionFor(-60), view: (u) => (u.includes('guest=Ana') ? ok200() : { status: 404, body: '{}' }) });
check('session expirée : jamais utilisée (ni rafraîchie) → ancien lien (nom + dates)', r.len > 30000 && !r.calls.some((c) => c.kind === 'rest') && r.calls.some((c) => c.kind === 'view' && /guest=Ana&dates=/.test(c.u)));
await r.ctx.close();

r = await open('t=' + TOK + '&guest=Ana&dates=x&lang=fr', { view: () => ({ status: 410, body: '{"error":"expired"}' }) });
check('lien expiré → message clair en français, aucune fiche', msgOnly(r) && /plus disponible/.test(r.msg) && !/available/.test(r.msg) && r.calls.filter((c) => c.kind === 'view').length === 1, r.msg);
check('lien avec jeton : jamais de repli sur nom + dates', !r.calls.some((c) => /guest=/.test(c.u) && !/t=/.test(c.u)));
await r.ctx.close();

r = await open('t=' + TOK + '&lang=en', { view: () => ({ status: 404, body: '{}' }) });
check('lien inconnu, client anglophone → message en anglais seulement', msgOnly(r) && /no longer available/.test(r.msg) && !/plus disponible/.test(r.msg), r.msg);
await r.ctx.close();

r = await open('t=' + TOK + '&lang=bi', { view: () => ({ status: 404, body: '{}' }) });
check('livret bilingue → message FR puis EN', /plus disponible[\s\S]*no longer available/.test(r.msg), r.msg);
await r.ctx.close();

r = await open('lang=fr');
check('sans lien → « ouvrez avec le lien reçu », aucune demande au serveur', msgOnly(r) && /lien reçu/.test(r.msg) && !r.calls.length, r.msg);
await r.ctx.close();

r = await open('t=' + TOK + '&lang=fr', { view: () => ({ status: 503, body: '{}' }) });
check('serveur indisponible → un seul nouvel essai, puis « vérifiez votre connexion »', msgOnly(r) && /connexion/.test(r.msg) && r.calls.filter((c) => c.kind === 'view').length === 2, { msg: r.msg, n: r.calls.length });
await r.ctx.close();

let n = 0;
r = await open('t=' + TOK + '&lang=fr', { view: () => (++n === 1 ? { status: 503, body: '{}' } : ok200()) });
check('coupure passagère → le nouvel essai affiche le livret', r.len > 30000 && n === 2);
await r.ctx.close();

r = await open('t=' + TOK + '&lang=fr', { view: () => ({ status: 200, body: '{"facts":{"TEAM":[]}}' }) });
check('fiche incomplète → message, jamais un livret à moitié vide', msgOnly(r) && !r.errs.length, { msg: r.msg, errs: r.errs });
await r.ctx.close();

// ── Toute villa (15/10/2026) : le livret ne nomme plus le pilote ──────────────────────
// 1. Fiche complète (pilote) : rendu identique au caractère près (empreintes du 15/10/2026, hors
//    bloc « Votre arrivée » et signature Stafflo). Si le livret est modifié VOLONTAIREMENT, recalculer.
const crypto = await import('node:crypto');
const sheetHash = async (page) => crypto.createHash('sha256').update(await page.evaluate(() => { const s = document.getElementById('sheet').cloneNode(true); s.querySelectorAll('#arrive, .foot-stafflo').forEach((e) => e.remove()); return s.innerHTML; })).digest('hex').slice(0, 16);
for (const [qs, h] of [['guest=Felipe%20Villalobos&dates=13%20OCT%20%E2%80%93%2016%20OCT%2026&pax=7&groupe=famille&lang=bi', '723c0835fdcab1fa'], ['guest=Hugo&dates=20%20DEC%20%E2%80%93%2027%20DEC%2026&pax=10&groupe=amis&lang=fr&tarifs=400/400/500', '02270c66b3eb6dd2'], ['guest=Se%C3%A1n&dates=23%20OCT%20%E2%80%93%2026%20OCT%2026&pax=6&lang=en&tarifs=500/500/600/350', 'fb54de2d5c14395b']]) {
  r = await open('t=' + TOK + '&' + qs, { view: ok200 });
  const got = await sheetHash(r.page);
  check('fiche complète : rendu inchangé (' + qs.slice(6, 20) + '…)', got === h && !r.errs.length, got);
  if (qs.startsWith('guest=Felipe')) check('pilote : onglet inchangé « Livret d’accueil — Villa Dar J »', (await r.page.title()) === "Livret d'accueil — Villa Dar J", await r.page.title());
  check('signature « Livret préparé avec Stafflo » au pied', /stafflo\.app/.test(await r.page.evaluate(() => (document.querySelector('.foot-stafflo') || {}).innerHTML || '')));
  await r.ctx.close();
}
// 2. Fiche minimale d'une autre villa (remplie dans l'Espace, français seulement) : un livret
//    complet et propre — rien du pilote, pas de section vide, pas de blanc là où l'anglais manque.
const MINI = JSON.stringify({ VILLA: { name: 'Riad Zina', host: 'Nadia', hostPhone: '+33 6 00 00 00 00', address: 'Derb Sidi Bouloukat, Marrakech', staff: 'Omar', said: '+212 600 000 000' },
  TEAM: [{ name: 'Omar', role: ['gardien — sur place tous les jours', ''], brief: true }], PRACTICAL: [['Arrivée et départ : chambres prêtes à partir de 15h, départ avant 11h.', '']], RULES: [['Non-fumeur à l’intérieur.', 'No smoking inside.']] });
r = await open('t=' + TOK + '&guest=Ana&lang=bi', { view: () => ({ status: 200, body: '{"facts":' + MINI + '}' }) });
let txt = await r.page.evaluate(() => document.getElementById('sheet').innerText);
check('autre villa : livret rendu sans erreur, nom et ville depuis la fiche (« au Riad Zina », Marrakech)', r.len > 1500 && !r.errs.length && /RIAD ZINA|Riad Zina/.test(txt) && /accueillir au Riad Zina/.test(txt) && /welcome you to Riad Zina/.test(txt), r.errs);
check('autre villa : premier contact et hôte depuis la fiche, rôle lu dans l’équipe (« Omar, gardien »), jamais « majordome », « Saïd » ni « Jérémie »', /Omar, gardien — votre premier contact/.test(txt) && /si Omar n'est pas joignable/.test(txt) && /Nadia, votre hôte/.test(txt) && !/majordome|Saïd|Jérémie|Dar J/.test(txt));
check('autre villa : pas de Wi-Fi, pas de QR, pas de chambres, repas, menus ni « Découvrir » quand la fiche n’en a pas ; pas de Majorelle', !/Wi-Fi/.test(txt) && r.qr === 0 && !/Les \d chambres|La chambre|Bedrooms|Repas & horaires|Menu & spécialités|Découvrir|Majorelle|Petit-déjeuner/.test(txt));
check('autre villa : anglais vide → le français est repris, jamais un blanc (bilingue : une seule ligne)', /Arrivée et départ : chambres prêtes/.test(txt) && (txt.match(/chambres prêtes à partir de 15h/g) || []).length === 1 && /No smoking inside/.test(txt));
check('autre villa : pied de page = nom · ville, signature Stafflo', /Riad Zina · Marrakech/i.test(txt) && /Livret préparé avec/i.test(txt));
check('autre villa : onglet « Livret d’accueil — Riad Zina », jamais « Villa Dar J »', (await r.page.title()) === "Livret d'accueil — Riad Zina" && !/Dar J/.test(await r.page.content()), await r.page.title());
await r.ctx.close();

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
