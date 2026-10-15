// Vue équipe (equipe.html) dans Chromium — « Chambres prêtes » et « Signaler un problème » partent vers la base.
//   node tests/evals-equipe-load.mjs        (réseau entièrement simulé)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch();
const K = 'K'.repeat(43);
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const DATA = { name: 'Saïd', lang: 'fr', today: iso(0), at: new Date().toISOString(), reports: [], stays: [
  { id: 's-now', name: 'Felipe V.', a: iso(-2), d: iso(1), nights: 3, adults: 7, children: null, infants: null, pax: 7, arrival_time: '', beds: '', meals: '', note: '', same_day: false },
  { id: 's-next', name: 'Thibaut V.', a: iso(4), d: iso(8), nights: 4, adults: 10, children: null, infants: null, pax: 10, arrival_time: 'vers 15h30', beds: '4 couples + 2 personnes seules', meals: '', note: '', extras: '1 × Transfert aéroport', same_day: false },
] };

async function open({ lang = 'fr', data = DATA, report = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR' });
  const posts = [], stored = [...(data.reports || [])]; // le serveur relit les retours du lien avec les séjours
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url();
    if (u.includes('/functions/v1/staff-view')) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'report') {
        posts.push(body);
        const rec = { id: 'r' + (stored.length + 1), kind: body.kind, client_id: body.client_id, text: body.text, created_at: new Date().toISOString() };
        const r = report ? report(body) : (stored.unshift(rec), { status: 200, body: JSON.stringify({ ok: true, report: rec }) });
        return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: r.body });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ...data, lang, reports: stored }) });
    }
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript((l) => { localStorage.setItem('stafflo_equipe_lang', l); }, lang);
  await page.goto(`http://127.0.0.1:${PORT}/equipe.html#k=${K}`);
  await page.waitForSelector('article.card', { timeout: 8000 });
  await page.waitForTimeout(150);
  return { page, ctx, posts, errs };
}

let r = await open();
const txt = await r.page.evaluate(() => document.getElementById('app').innerText);
check('page chargée, 0 erreur', !r.errs.length, r.errs);
check('« Chambres prêtes » sur l’arrivée à venir, pas sur le séjour déjà là', (await r.page.$$('[data-a="ready"]')).length === 1 && (await r.page.getAttribute('[data-a="ready"]', 'data-id')) === 's-next');
check('« Signaler un problème » en bas, texte libre', /Signaler un problème/.test(txt) && !!(await r.page.$('#issueTxt')));
check('rien de nouveau ne fuit : aucun prix, téléphone ni note du propriétaire', !/€|MAD|\+212|\+33|Notes/.test(txt));
check('extras commandés par le client : « Commandé par le client · 1 × Transfert aéroport », sans prix', /Commandé par le client\s*1 × Transfert aéroport/.test(txt));
await r.page.click('[data-a="ready"]'); await r.page.waitForTimeout(300);
const t2 = await r.page.evaluate(() => document.getElementById('app').innerText);
check('un geste → envoi { k, action: report, kind: rooms_ready, client_id } et rien d’autre', r.posts.length === 1 && r.posts[0].k === K && r.posts[0].action === 'report' && r.posts[0].kind === 'rooms_ready' && r.posts[0].client_id === 's-next' && r.posts[0].text === null && Object.keys(r.posts[0]).sort().join() === 'action,client_id,k,kind,text');
check('après envoi : « Chambres prêtes · HH:MM », le bouton ne revient pas', /Chambres prêtes · \d{2}:\d{2}/.test(t2) && !(await r.page.$('[data-a="ready"]')));
await r.page.fill('#issueTxt', 'Fuite dans la salle de bain de la suite'); await r.page.click('#issue button[type="submit"]'); await r.page.waitForTimeout(300);
check('problème → envoi du texte seul (pas de séjour), « Envoyé, merci », champ vidé', r.posts.length === 2 && r.posts[1].kind === 'issue' && r.posts[1].text === 'Fuite dans la salle de bain de la suite' && r.posts[1].client_id === null && /Envoyé, merci/.test(await r.page.evaluate(() => document.getElementById('issueSt').innerText)) && (await r.page.inputValue('#issueTxt')) === '');
await r.page.click('#issue button[type="submit"]'); await r.page.waitForTimeout(200);
check('problème vide → rien n’est envoyé', r.posts.length === 2);
await r.page.reload(); await r.page.waitForSelector('article.card'); await r.page.waitForTimeout(150);
check('après rechargement : « chambres prêtes » reste coché (retours relus avec les séjours ou gardés en cache)', /Chambres prêtes · \d{2}:\d{2}/.test(await r.page.evaluate(() => document.getElementById('app').innerText)));
await r.ctx.close();

r = await open({ report: () => ({ status: 503, body: '{}' }) });
await r.page.click('[data-a="ready"]'); await r.page.waitForTimeout(400);
check('serveur indisponible → message, le bouton reste (on peut réessayer)', !!(await r.page.$('[data-a="ready"]')) && !(await r.page.evaluate(() => document.querySelector('[data-a="ready"]').disabled)) && /vérifiez la connexion/.test(await r.page.evaluate(() => document.getElementById('app').innerText)));
await r.ctx.close();

r = await open({ lang: 'ar' });
const ar = await r.page.evaluate(() => document.getElementById('app').innerText);
check('arabe : boutons et aide traduits, sens RTL, extras sous « طلبات الضيف »', /طلبات الضيف/.test(ar) && /الغرف جاهزة/.test(ar) && /الإبلاغ عن مشكلة/.test(ar) && (await r.page.evaluate(() => document.documentElement.dir)) === 'rtl');
await r.ctx.close();

r = await open({ data: { ...DATA, reports: [{ id: 'r0', kind: 'rooms_ready', client_id: 's-next', text: null, created_at: new Date().toISOString() }] } });
check('retour déjà envoyé depuis un autre appareil → coché au chargement', /Chambres prêtes · \d{2}:\d{2}/.test(await r.page.evaluate(() => document.getElementById('app').innerText)) && !(await r.page.$('[data-a="ready"]')));
await r.ctx.close();

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
