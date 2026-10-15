// Une seule app (15/10/2026) : un compte connecté et configuré qui ouvre app.html arrive sur l'Espace ;
// connexion, inscription, mise en route, liens profonds et « app complète » restent sur app.html.
//   node tests/evals-une-app.mjs   (Chromium)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); } };

// Pages servies telles quelles ; espace.html remplacé par une page témoin (on ne teste que l'aiguillage).
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/espace.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>ESPACE</title><p id="ok">espace</p>'); }
  const p = path.join(root, u);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch();
const SESSION = JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1' } });

async function visit(qs, { session = true, onboarded = true, off = false } = {}, then) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(([s, on, o]) => {
    if (sessionStorage.getItem('__init')) return; sessionStorage.setItem('__init', '1');
    if (s) localStorage.setItem('stafflo_session', s);
    localStorage.setItem('stafflo_cfg', JSON.stringify({ onboarded: on }));
    if (o) localStorage.setItem('stafflo_espace_home', 'off');
  }, [session ? SESSION : '', onboarded, off]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/app.html${qs}`, { waitUntil: 'commit' });
  await page.waitForTimeout(700);
  const out = { url: page.url(), lang: await page.evaluate(() => localStorage.getItem('stafflo_espace_lang')).catch(() => null) };
  if (then) out.after = await then(page);
  await ctx.close();
  return out;
}
const onEspace = (u) => /\/espace\.html$/.test(u);

let r = await visit('');
check('compte connecté et configuré : app.html → l’Espace', onEspace(r.url), r.url);
r = await visit('?lang=en');
check('lien « Se connecter » du site (?lang=en) → l’Espace, en anglais', onEspace(r.url) && r.lang === 'en', r);
r = await visit('', { onboarded: false });
check('compte pas encore configuré : reste sur app.html (mise en route)', !onEspace(r.url), r.url);
r = await visit('', { session: false });
check('pas connecté : reste sur app.html (connexion / inscription)', !onEspace(r.url), r.url);
for (const qs of ['?open=settings', '?open=stay', '?signup=1', '?onboarding=1', '?oauth_callback=1&code=x', '?demo=1']) {
  r = await visit(qs);
  check('lien profond ' + qs + ' : reste sur app.html', !onEspace(r.url), r.url);
}
r = await visit('#access_token=abc');
check('retour de lien magique (#access_token) : reste sur app.html', !onEspace(r.url), r.url);
r = await visit('?app=1', {}, async (page) => { await page.goto(`http://127.0.0.1:${PORT}/app.html`, { waitUntil: 'commit' }); await page.waitForTimeout(700); return page.url(); });
check('« Ouvrir l’app complète » (?app=1) : reste sur app.html, même après rechargement dans cet onglet', !onEspace(r.url) && !onEspace(r.after), r);
r = await visit('', { off: true });
check('interrupteur stafflo_espace_home = off : app.html redevient l’accueil', !onEspace(r.url), r.url);

const esp = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');
check('Espace : aucun lien nu vers app.html (il renverrait à l’Espace) — « app complète » = app.html?app=1', !/href="app\.html"/.test(esp) && /href="app\.html\?app=1"/.test(esp));

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
