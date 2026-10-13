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
async function open(qs, { view = () => ({ status: 404, body: '{"error":"not_found"}' }), rest = () => ({ status: 200, body: '[]' }), session = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const calls = [];
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url();
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
  const r = await page.evaluate(() => { const s = document.getElementById('sheet'); return { len: s.innerHTML.length, msg: (s.querySelector('[role=status]') || {}).innerText || '', qr: s.querySelectorAll('svg.qr-svg').length }; });
  return { ...r, calls, errs, page, ctx };
}
const ok200 = () => ({ status: 200, body: '{"facts":' + FACTS + '}' });
const msgOnly = (r) => r.len < 2000 && r.qr === 0;

let r = await open('t=' + TOK + '&guest=Ana&lang=fr', { view: ok200 });
check('lien personnel → livret complet (QR compris), une seule demande, sans erreur', r.len > 30000 && r.qr === 2 && r.calls.filter((c) => c.kind === 'view').length === 1 && r.calls[0].u.includes('t=' + TOK) && !r.errs.length, { len: r.len, qr: r.qr, errs: r.errs });
check('villa-facts.js jamais demandé', !r.calls.some((c) => c.kind === 'villa-facts'));
await r.page.fill('#g', 'Zélie Martin'); await r.page.waitForTimeout(100);
check('le livret reste éditable après chargement (le nom saisi s’affiche)', (await r.page.evaluate(() => document.getElementById('sheet').innerText)).includes('Zélie'));
await r.ctx.close();

r = await open('guest=Ana&dates=1%20JAN%20%E2%80%93%205%20JAN%2027&lang=fr', { session: sessionFor(3600), rest: () => ({ status: 200, body: '[{"house_facts":' + FACTS + '}]' }) });
const rc = r.calls.find((c) => c.kind === 'rest');
check('propriétaire connecté (sans jeton) → sa fiche, lue avec SA session et son id', r.len > 30000 && rc && rc.auth === 'Bearer jwt-test' && rc.u.includes('owner_id=eq.' + UID) && !r.calls.some((c) => c.kind === 'view'), { len: r.len });
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

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
