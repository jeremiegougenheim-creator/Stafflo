// Fiche maison modifiable dans l'Espace (espace.html › Maison), dans Chromium, réseau simulé.
//   node tests/evals-espace-fiche.mjs
//
// Ce que ça protège :
//   1. un compte neuf remplit sa fiche ici (plus « demandez-le à Claude ») et la sauvegarde
//      pose house_facts + house_facts_ref = 'villa-facts.js' sur SA ligne villa_settings ;
//   2. un anglais vide reste vide en base (jamais traduit en silence) ; la traduction est un
//      geste explicite, par ai-proxy, et ne remplit que les champs vides ;
//   3. la fiche du pilote survit à une modification : les clés que l'éditeur ne montre pas
//      (QR) sont renvoyées telles quelles, rien d'autre ne change ;
//   4. aucune valeur d'une autre villa dans une fiche neuve (pas de défaut recopié).
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); } };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : p.endsWith('.css') ? 'text/css' : p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch();
const UID = '11111111-2222-4333-8444-555555555555';
const PILOT = JSON.parse(fs.readFileSync(path.join(root, '_private/house-facts-pilot.json'), 'utf8'));
const SESSION = { access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, email: 'x@y.z' } };

async function open({ villa, staff = [], ai = null, stays = [], links = [], regs = [], regFn = null, inbound = [], inMails = [], emailIn = false, tab = 'maison', width = 390, bill = null, sync = [], once = false, files = [], waNum = [], waMsgs = [], waMeta = null, fbEvil = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR', viewport: { width, height: 900 } });
  const calls = [], reads = [];
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url(), m = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(b) });
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    if (m === 'OPTIONS') return json({}, 204);
    if (u.includes('/functions/v1/ai-proxy')) { calls.push({ kind: 'ai', body: JSON.parse(req.postData() || '{}') }); return json(ai ? ai(JSON.parse(req.postData() || '{}')) : { text: '' }); }
    if (u.includes('/rest/v1/villa_settings')) {
      if (m === 'PATCH' || m === 'POST') { calls.push({ kind: m, url: u, body: JSON.parse(req.postData() || '{}') }); return json(villa ? [{ id: 'vs1' }] : []); }
      return json(villa ? [villa] : []);
    }
    if (u.includes('/rest/v1/staff?')) return json(staff);
    if (u.includes('/rest/v1/livret_links')) return json(links);
    if (u.includes('/rest/v1/guest_registrations')) return json(regs);
    if (u.includes('/rest/v1/inbound_addresses')) return json(inbound);
    if (u.includes('/rest/v1/rpc/inbound_address')) { calls.push({ kind: 'inaddr' }); return json('in-abcdefghij12@stafflo.app'); }
    if (u.includes('/rest/v1/email_inbox') && u.includes('source=eq.email_in')) return json(inMails);
    if (u.includes('/functions/v1/guest-registrations')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'regfn', body: b, auth: req.headers().authorization }); return json(regFn ? regFn(b) : { reg: null }); }
    if (u.includes('/rest/v1/rpc/billing_status')) return json(bill || []);
    if (u.includes('/rest/v1/wa_numbers')) return json(waNum);
    if (u.startsWith('https://connect.facebook.net/')) {
      reads.push({ kind: 'fbsdk', url: u });
      const ev = (origin, data) => `window.dispatchEvent(new MessageEvent('message', { origin: ${JSON.stringify(origin)}, data: ${JSON.stringify(JSON.stringify(data))} }));`;
      const fin = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '5550001', phone_number_id: '106540352242922' } };
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.FB = { init: function (o) { window.__fbInit = o; }, login: function (cb, o) { window.__fbLogin = o; ${fbEvil ? ev('https://evil.example.com', fin) : ev('https://www.facebook.com', fin)} cb({ authResponse: { code: 'CODE1' } }); } }; window.fbAsyncInit && window.fbAsyncInit();` });
    }
    if (u.includes('/functions/v1/wa-connect')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'waconnect', body: b, auth: req.headers().authorization }); return b.waba_id ? json({ ok: true, display_phone: '+212 600-000111', on_biz_app: true }) : json({ error: 'bad_request' }, 400); }
    if (u.includes('/rest/v1/wa_messages')) {
      if (m === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'wapatch', url: decodeURIComponent(u), body: b }); return json([{}]); }
      reads.push({ kind: 'waget', url: decodeURIComponent(u) }); return json(waMsgs.slice().sort((a, b) => b.sent_at.localeCompare(a.sent_at)));
    }
    if (u.includes('/rest/v1/stay_files')) {
      if (m === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'sfinsert', body: b }); const row = { id: 'f' + (files.length + 1), created_at: new Date().toISOString(), ...b }; files.push(row); return json([row], 201); }
      if (m === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'sfpatch', url: u, body: b }); return json([{}]); }
      calls.push({ kind: 'sfget', url: u }); return json(files.filter((f) => !f.deleted_at));
    }
    if (u.includes('/storage/v1/object/sign/stay-files') && m === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    if (u.includes('/storage/v1/object/sign/stay-files')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'sign', body: b, auth: req.headers().authorization }); return json(b.paths.map((p) => ({ path: p, signedURL: '/object/sign/stay-files/' + p + '?token=t', error: null }))); }
    if (u.includes('/storage/v1/object/stay-files/')) { calls.push({ kind: 'upload', url: u, type: req.headers()['content-type'], auth: req.headers().authorization, size: (req.postDataBuffer() || Buffer.alloc(0)).length }); return json({ Key: 'k' }); }
    if (u.includes('/rest/v1/sync_runs')) return json(sync);
    if (u.includes('/functions/v1/polar-')) { calls.push({ kind: 'polar', url: u, auth: req.headers().authorization }); return json({ url: 'https://checkout.example.com/s/1' }); }
    if (u.startsWith('https://checkout.example.com/')) { calls.push({ kind: 'nav', url: u }); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>checkout</title>' }); }
    if (u.includes('/auth/v1/logout')) { calls.push({ kind: 'logout', auth: req.headers().authorization }); return route.fulfill({ status: 204, body: '' }); }
    if (u.includes('/rest/v1/crm_clients') && m === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'insert', body: b, prefer: req.headers().prefer }); stays.push({ ...b }); return json([b], 201); }
    if (u.includes('/rest/v1/crm_clients') && m === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'stay', url: u, body: b }); const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || ''); const row = stays.find((x) => String(x.id) === id) || stays[0]; if (row) Object.assign(row, b); return json([{ ...row }]); }
    if (u.includes('/rest/v1/crm_clients')) return json(stays);
    if (u.includes('/rest/v1/')) return json([]);
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(([s, on, one, wm]) => { if (one) { if (sessionStorage.getItem('__init')) return; sessionStorage.setItem('__init', '1'); } localStorage.setItem('stafflo_session', JSON.stringify(s)); localStorage.setItem('stafflo_espace_lang', 'fr'); if (on) localStorage.setItem('stafflo_email_in', 'on'); if (wm) localStorage.setItem('stafflo_wa_meta', JSON.stringify(wm)); }, [SESSION, emailIn, once, waMeta]);
  await page.goto(`http://127.0.0.1:${PORT}/espace.html#${tab}`);
  await page.waitForSelector(tab === 'maison' ? '[data-a="feopen"]:not([data-v])' : 'article, .card', { timeout: 8000 });
  return { page, ctx, calls, errs, reads };
}
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
const unfold = (page) => page.evaluate(() => { document.querySelectorAll('details.fold').forEach((d) => { d.open = true; }); }); // l'utilisateur déplie la section avant d'y écrire

// ── 1. Compte neuf : fiche vide, remplie ici, sauvegardée sur sa ligne ────────────────
let r = await open({ villa: { villa_name: 'Riad Zina', city: 'Marrakech', owner_name: 'nadia', house_facts_ref: null, house_facts: null }, staff: [{ name: 'Omar', role: 'gardien', wa: '+212600000000' }] });
check('compte neuf : 0 erreur, bouton « Remplir la fiche maison », plus de « demandez-le à Claude »', !r.errs.length && /Remplir la fiche maison/.test(await txt(r.page)) && !/demandez-le à Claude/.test(await txt(r.page)), r.errs);
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name');
let t = await txt(r.page);
check('éditeur ouvert : nom et hôte pré-remplis depuis le compte, équipe depuis la table staff (prénom seulement), rien du pilote', (await r.page.inputValue('#fe-VILLA\\.name')) === 'Riad Zina' && (await r.page.inputValue('#fe-VILLA\\.host')) === 'Nadia' && (await r.page.inputValue('#fe-TEAM\\.0\\.name')) === 'Omar' && !/Dar J|Saïd|Douar|650/.test(t));
check('rien n’est envoyé à l’ouverture', !r.calls.length);
// Ajouter une ligne « Pratique » et une règle, en français seulement
await unfold(r.page);
await r.page.click('[data-a="feadd"][data-v="PRACTICAL"]'); await r.page.waitForSelector('[data-fe="PRACTICAL.0.0"]');
await r.page.fill('[data-fe="PRACTICAL.0.0"]', 'Arrivée et départ : chambres prêtes à partir de 15h, départ avant 11h.');
await r.page.click('[data-a="feadd"][data-v="RULES"]'); await r.page.fill('[data-fe="RULES.0.0"]', 'Non-fumeur à l’intérieur.');
await r.page.fill('#fe-VILLA\\.address', 'Derb Sidi Bouloukat, Marrakech');
await r.page.fill('#fe-VILLA\\.pin\\.lat', '31.62'); await r.page.fill('#fe-VILLA\\.pin\\.lng', '-7.98');
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const save = r.calls.filter((c) => c.kind === 'PATCH')[0];
check('enregistrement : PATCH villa_settings sur la ligne du compte (owner_id), house_facts + drapeau « fiche en place »', !!save && /villa_settings\?owner_id=eq\.1111/.test(save.url) && save.body.house_facts_ref === 'villa-facts.js' && save.body.house_facts && save.body.house_facts.VILLA.name === 'Riad Zina');
const hf = save && save.body.house_facts;
check('anglais vide → reste vide en base (jamais traduit en silence) ; GPS typé ; équipe gardée', !!hf && hf.PRACTICAL.length === 1 && hf.PRACTICAL[0][0].startsWith('Arrivée et départ') && hf.PRACTICAL[0][1] === '' && hf.RULES[0][1] === '' && hf.VILLA.pin.lat === 31.62 && hf.VILLA.pin.lng === -7.98 && hf.TEAM[0].name === 'Omar' && hf.TEAM[0].phone === '+212600000000');
check('sections non remplies = listes vides, pas de valeur inventée', !!hf && hf.MEALS.length === 0 && hf.ROOMS.length === 0 && Object.keys(hf.TEXT).length === 0 && !hf.VILLA.wifi && !hf.VILLA.extraGuest && !hf.QR);
check('après enregistrement : retour à la fiche, « Fiche enregistrée »', /Fiche enregistrée/.test(await r.page.evaluate(() => document.getElementById('toastHost').innerText)) && !(await r.page.$('[data-a="fesave"]')));
await r.ctx.close();

// ── 2. Nom manquant : rien n'est envoyé ───────────────────────────────────────────────
r = await open({ villa: { villa_name: '', owner_name: '', house_facts: null } });
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name');
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(200);
check('sans nom de villa : message, aucun envoi', !r.calls.length && /Indiquez le nom de la villa/.test(await r.page.evaluate(() => document.getElementById('toastHost').innerText)));
// Compte sans ligne villa_settings : la sauvegarde crée la ligne (clé neutre), jamais une clé dérivée du nom
await r.page.fill('#fe-VILLA\\.name', 'Villa Test');
await r.ctx.close();
r = await open({ villa: null });
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name');
await r.page.fill('#fe-VILLA\\.name', 'Villa Test'); await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const ins = r.calls.filter((c) => c.kind === 'POST')[0];
check('sans ligne villa_settings : PATCH vide puis création avec owner_id et villa_key = villa_<id>', !!r.calls.filter((c) => c.kind === 'PATCH').length && !!ins && ins.body.owner_id === UID && ins.body.villa_key === 'villa_' + UID && ins.body.house_facts_ref === 'villa-facts.js');
await r.ctx.close();

// ── 3. Pilote : une modification ne touche que ce qui a changé, QR conservé ───────────
r = await open({ villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT } });
check('fiche en place : bouton « Modifier la fiche maison »', /Modifier la fiche maison/.test(await txt(r.page)));
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
check('éditeur : la fiche du pilote est chargée (repas, équipe, chambres)', (await r.page.inputValue('#fe-MEALS\\.1\\.a')) === PILOT.MEALS[1].a[0] && (await r.page.$$('[data-fe^="TEAM."][data-fe$=".name"]')).length === PILOT.TEAM.length && (await r.page.$$('[data-fe^="ROOMS."][data-fe$=".t.0"]')).length === PILOT.ROOMS.length);
await r.page.fill('#fe-MEALS\\.1\\.a', '700 MAD');
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const s2 = r.calls.filter((c) => c.kind === 'PATCH')[0], got = s2 && s2.body.house_facts;
// Comparaison insensible à l'ordre des clés (jsonb n'en a pas).
const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
const same = (k) => canon(got[k]) === canon(PILOT[k]);
check('pilote : seul le prix modifié change ; QR, TEXT, PRACTICAL, ROOMS, TEAM, alentours identiques au caractère près', !!got && got.MEALS[1].a[0] === '700 MAD' && got.MEALS[1].a[1] === '700 MAD' && got.MEALS[0].a[0] === PILOT.MEALS[0].a[0] &&
  ['QR', 'TEXT', 'PRACTICAL', 'ROOMS', 'TEAM', 'RULES', 'GOOD_TO_KNOW', 'MEAL_NOTES', 'LEISURE', 'BREAKFAST', 'GOUTER', 'STARTERS', 'MAINS', 'SIMPLE', 'DESSERTS', 'MEDINA', 'GOLF', 'ACTIVITIES', 'RESTAURANTS', 'VILLA'].every(same),
  got && ['QR', 'TEXT', 'PRACTICAL', 'ROOMS', 'TEAM', 'VILLA', 'MEDINA', 'ACTIVITIES'].filter((k) => !same(k)));
check('pilote : extras et devise renvoyés tels quels (rien ajouté, rien perdu)', !!got && canon(got.EXTRAS) === canon(PILOT.EXTRAS) && got.VILLA.currency === PILOT.VILLA.currency);
check('pilote : CAFES = [nom, site facultatif], jamais transformés en paire fr/en (le livret y lit un lien)', !!got && canon(got.CAFES) === canon(PILOT.CAFES));
await r.ctx.close();

// ── 4. Traduction explicite : ne remplit que les champs anglais vides, via ai-proxy ────
r = await open({ villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, RULES: [['Non-fumeur.', ''], ['Pas de fête.', 'No parties.']], TEXT: { kidsBox: ['Avec des enfants : parc à 5 min.', ''] } } },
  ai: (b) => ({ text: b.user.split('\n').map((l) => l.replace(/^(\d+) \|\|\| .*/, '$1 ||| EN:' + l.split(' ||| ')[1])).join('\n') }) });
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('[data-fe="RULES.0.1"]', { state: 'attached' }); await unfold(r.page);
await r.page.click('[data-a="fetr"]'); await r.page.waitForTimeout(500);
const aiCall = r.calls.filter((c) => c.kind === 'ai')[0];
check('traduction : un appel ai-proxy write_en, texte numéroté, seulement les champs vides', !!aiCall && aiCall.body.task === 'write_en' && /1 \|\|\| Non-fumeur\./.test(aiCall.body.user) && /2 \|\|\| Avec des enfants/.test(aiCall.body.user) && !/Pas de fête/.test(aiCall.body.user));
check('traduction : champs vides remplis, champ déjà traduit intact, rien d’enregistré avant relecture', (await r.page.inputValue('[data-fe="RULES.0.1"]')) === 'EN:Non-fumeur.' && (await r.page.inputValue('[data-fe="RULES.1.1"]')) === 'No parties.' && (await r.page.inputValue('[data-fe="TEXT.kidsBox.1"]')) === 'EN:Avec des enfants : parc à 5 min.' && !r.calls.filter((c) => c.kind === 'PATCH').length);
await r.page.click('[data-a="fecancel"]'); await r.page.waitForTimeout(100);
await r.page.click('.langsw [data-v="en"]'); await r.page.waitForTimeout(100); await unfold(r.page);
check('fiche affichée en anglais : le français est repris quand l’anglais manque, jamais un blanc', /Non-fumeur\./.test(await txt(r.page)) && /No parties\./.test(await txt(r.page)));
await r.page.click('.langsw [data-v="fr"]'); await r.page.waitForTimeout(100);
check('annuler : retour à la fiche sans envoi', !(await r.page.$('[data-a="fesave"]')) && !r.calls.filter((c) => c.kind === 'PATCH').length);
await r.ctx.close();

// ── 5. Toute villa : une fiche partielle ne casse aucun message, rien du pilote ────────
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ZINA = { VILLA: { name: 'Riad Zina', host: 'Nadia', address: 'Derb Sidi Bouloukat, Marrakech' }, TEAM: [{ name: 'Omar', role: ['gardien — sur place tous les jours', ''], phone: '+212600000000', brief: true }],
  PRACTICAL: [['Arrivée et départ : chambres prêtes à partir de 15h. Départ avant 11h.', '']], MEALS: [{ n: ['Petit-déjeuner', 'Breakfast'], a: ['Inclus', 'Inclus'], b: ['Inclus', 'Inclus'], h: ['8h – 10h', ''] }] };
r = await open({ tab: 'sejours', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: ZINA },
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(8), adults: 2, children: 0, infants: 0, booking_status: 'confirmed', source: 'airbnb', nat: 'France', details: {} }] });
await r.page.waitForTimeout(200);
const tg = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (tg) { await tg.click(); await r.page.waitForTimeout(100); }
const acts = await r.page.$$eval('[data-a="panel"][data-id="s1"]', (b) => b.map((x) => x.getAttribute('data-v')));
check('fiche partielle : pas de bouton repas ni décompte sans service chiffré, pas de passeports sans règle ; arrivée et brief présents', acts.includes('arrival') && acts.includes('brief') && !acts.includes('meals') && !acts.includes('bill') && !acts.includes('passports'), acts);
await r.page.click('[data-a="panel"][data-v="arrival"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
const arrMsg = await r.page.inputValue('#tx-s1');
check('fiche partielle : message d’arrivée sans erreur, rôle lu dans l’équipe (« Omar, notre gardien »), adresse, pas de position inventée, jamais « majordome »', !r.errs.length && /Omar, notre gardien, vous accueille/.test(arrMsg) && /Adresse : Derb Sidi Bouloukat/.test(arrMsg) && !/Position exacte|undefined|majordome|Saïd|Dar J/.test(arrMsg), { errs: r.errs, arrMsg });
await r.ctx.close();
r = await open({ tab: 'sejours', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: ZINA },
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(8), adults: 2, booking_status: 'confirmed', source: 'airbnb', nat: 'United Kingdom', details: {} }] });
await r.page.waitForTimeout(200);
{ const tg3 = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (tg3) { await tg3.click(); await r.page.waitForTimeout(100); } }
await r.page.click('[data-a="panel"][data-v="arrival"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
const arrEn = await r.page.inputValue('#tx-s1');
check('fiche partielle, client anglophone : rôle sans traduction → pas de mot français (« Omar will welcome you »)', /On site, Omar will welcome you/.test(arrEn) && !/gardien/.test(arrEn), arrEn);
await r.ctx.close();
// Pilote : le message d'arrivée garde « notre majordome » (rôle de la fiche) et la position exacte.
r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT },
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(8), adults: 8, children: 0, infants: 0, booking_status: 'confirmed', source: 'airbnb', nat: 'France', details: {} }] });
await r.page.waitForTimeout(200);
const tg2 = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (tg2) { await tg2.click(); await r.page.waitForTimeout(100); }
const acts2 = await r.page.$$eval('[data-a="panel"][data-id="s1"]', (b) => b.map((x) => x.getAttribute('data-v')));
await r.page.click('[data-a="panel"][data-v="arrival"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
const arr2 = await r.page.inputValue('#tx-s1');
check('pilote : tous les boutons (repas, arrivée, passeports, brief, décompte) ; « Saïd, notre majordome » et position exacte', ['meals', 'arrival', 'passports', 'brief', 'bill'].every((k) => acts2.includes(k)) && /Saïd, notre majordome, vous accueille/.test(arr2) && /Position exacte : https:\/\/www\.google\.com\/maps/.test(arr2) && !r.errs.length, { acts2, errs: r.errs });
await r.page.click('[data-a="panel"][data-v="meals"][data-id="s1"]'); await r.page.waitForTimeout(100);
const mm = await r.page.inputValue('#tx-s1');
check('pilote : message repas inchangé (service, goûter, logistique, boissons)', /par service pour tout le groupe/.test(mm) && /Goûter/.test(mm) && /logistique/.test(mm) && /Courses au prix réel/.test(mm), mm.slice(0, 300));
await r.ctx.close();

// ── 5 bis. Message « Livret » : lien personnel absolu + ce que le client peut commander ──
const TK = 'T'.repeat(43);
r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT }, links: [{ client_id: 's1', token: TK }],
  stays: [{ id: 's1', name: 'Thibaut Vauclare', arrival: iso(4), departure: iso(8), adults: 10, booking_status: 'confirmed', source: 'airbnb', nat: 'France', phone: '+33600000000', details: {} }] });
await r.page.waitForTimeout(250);
{ const t = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (t) { await t.click(); await r.page.waitForTimeout(100); } }
await r.page.click('[data-a="panel"][data-v="livret"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
const lv = await r.page.inputValue('#tx-s1');
const see = await r.page.$eval('a.btn[href*="livret.html"]', (a) => a.getAttribute('href')).catch(() => '');
check('Msg livret (pilote, FR) : lien absolu avec le jeton, « Votre arrivée », à commander : repas + transfert, rien à payer, fiches voyageurs (villa qui les demande), signé Jérémie',
  new RegExp('http://127\\.0\\.0\\.1:' + PORT + '/livret\\.html\\?[^\\s]*t=' + TK).test(lv) && /Dans « Votre arrivée »/.test(lv) && /réservez à l’avance : repas, transfert aéroport ↔ villa\. Rien à payer en ligne/.test(lv) && /Jérémie$/.test(lv) && /^Bonjour Thibaut,/.test(lv) && /Merci aussi de remplir les « Fiches voyageurs », une par personne/.test(lv) && !r.errs.length, { lv, errs: r.errs });
check('Msg livret : « Voir le livret » ouvre le même lien, WhatsApp proposé', /t=T{43}/.test(see) && !!(await r.page.$('[data-a="sendwa"][data-id="s1"]')), see);
await r.ctx.close();
r = await open({ tab: 'sejours', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: ZINA }, links: [{ client_id: 's1', token: TK }],
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(8), adults: 2, booking_status: 'confirmed', source: 'airbnb', nat: 'United Kingdom', details: {} }] });
await r.page.waitForTimeout(250);
{ const t = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (t) { await t.click(); await r.page.waitForTimeout(100); } }
await r.page.click('[data-a="panel"][data-v="livret"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
const lv2 = await r.page.inputValue('#tx-s1');
check('Msg livret (fiche partielle, EN, rien de chiffré, pas de fiches) : pas de « book ahead », ni de « Guest registration », pas de français', /^Hello Ana,/.test(lv2) && /Under “Your arrival”/.test(lv2) && !/book ahead|Guest registration/.test(lv2) && !/Bonjour|réservez/.test(lv2) && !r.errs.length, { lv2, errs: r.errs });
await r.ctx.close();

// ── 5 ter. Fiches voyageurs : nombre sur le séjour, contenu lu à la demande, impression, CSV, déclaré ──
{
  const PR = JSON.parse(JSON.stringify(PILOT)); PR.VILLA.guest_registration = true;
  const TRV = [{ last: 'Ruiz', first: 'Ana', birth_date: '1990-04-02', birth_place: 'Sevilla', nationality: 'Espagnole', doc_type: 'passport', doc_no: 'PAE123456', profession: 'Architecte', address: 'Madrid, Espagne' }, { last: 'Ruiz', first: 'Leo', birth_date: '2015-03-02', nationality: 'Espagnole', doc_type: 'passport', doc_no: 'PAE654321' }];
  const REGS = [{ client_id: 's1', travellers: 2, submitted_at: new Date(Date.now() - 86400e3).toISOString(), purge_after: iso(370) }];
  r = await open({ tab: 'jour', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PR }, links: [{ client_id: 's1', token: 'T'.repeat(43) }], regs: REGS, regFn: () => ({ reg: { travellers: TRV, at: REGS[0].submitted_at, purge_after: REGS[0].purge_after } }),
    stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(0), departure: iso(4), adults: 2, booking_status: 'confirmed', source: 'airbnb', nat: 'Spain', phone: '+34600000000', details: {} }] });
  await r.page.waitForTimeout(250);
  check('jour d’arrivée, fiches reçues, pas déclarées → « Déclarer les voyageurs » dans À faire', /Déclarer les voyageurs/.test(await txt(r.page)) && !r.errs.length, r.errs);
  check('rien n’est déchiffré tant que le propriétaire n’ouvre pas les fiches', !r.calls.some((x) => x.kind === 'regfn'));
  await r.page.click('[data-a="goto"][data-v="reg"]'); await r.page.waitForTimeout(400);
  let t5 = await txt(r.page);
  check('séjour : « Fiches voyageurs : 2 reçues le … » ; À faire ouvre les fiches, lues avec SA session', /Fiches voyageurs : 2 reçues le/.test(t5) && r.calls.some((x) => x.kind === 'regfn' && x.body.action === 'get' && x.body.client_id === 's1' && /^Bearer /.test(x.auth || '')), t5.slice(0, 500));
  check('panneau : une ligne par voyageur (NOM Prénom — naissance · nationalité · pièce), date d’effacement', /1\. RUIZ Ana — 02\/04\/1990 · Sevilla · Espagnole · Passeport PAE123456 · Architecte · Madrid, Espagne/.test(t5) && /2\. RUIZ Leo — 02\/03\/2015/.test(t5) && /Effacées automatiquement le/.test(t5), t5.slice(0, 900));
  const [dl] = await Promise.all([r.page.waitForEvent('download'), r.page.click('[data-a="regcsv"][data-id="s1"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('CSV : en-tête, une ligne par voyageur, séparateur « ; », dates du séjour', dl.suggestedFilename() === 'fiches-voyageurs-ana-ruiz-' + iso(0) + '.csv' && csv.split('\r\n').length === 3 && /^﻿nom;prenom;date_naissance/.test(csv) && csv.includes('Ruiz;Ana;1990-04-02;Sevilla;Espagnole;passport;PAE123456;Architecte;Madrid, Espagne;' + iso(0) + ';' + iso(4)), csv.slice(0, 300));
  const [pop] = await Promise.all([r.ctx.waitForEvent('page'), r.page.click('[data-a="regprint"][data-id="s1"]')]);
  await pop.waitForLoadState(); const ph = await pop.content();
  check('impression : une fiche individuelle par voyageur, villa, exploitant, ligne de signature', (ph.match(/<h1>Fiche individuelle<\/h1>/g) || []).length === 2 && /Villa Dar J/.test(ph) && /Signature du voyageur/.test(ph) && /Jérémie/.test(ph) && /PAE654321/.test(ph));
  await pop.close();
  await r.page.click('[data-a="regdecl"][data-id="s1"]'); await r.page.waitForTimeout(250);
  const dc = r.calls.filter((x) => x.kind === 'stay').pop();
  check('fiches reçues → plus de bouton « Passeports » (rien à redemander)', !(await r.page.$('[data-a="panel"][data-v="passports"][data-id="s1"]')));
  check('« Marquer déclarées » → details.regDeclaredAt seulement (aucune donnée de voyageur écrite sur le séjour)', !!dc && !!dc.body.details.regDeclaredAt && !JSON.stringify(dc.body).includes('PAE123456'));
  await r.ctx.close();
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PR }, links: [{ client_id: 's1', token: 'T'.repeat(43) }],
    stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(6), departure: iso(9), adults: 2, booking_status: 'confirmed', source: 'airbnb', nat: 'France', details: {} }] });
  await r.page.waitForTimeout(250);
  { const tg = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (tg) { await tg.click(); await r.page.waitForTimeout(100); } }
  const t6 = await txt(r.page);
  check('pas encore reçues : « Fiches voyageurs : pas encore reçues », pas de bouton Fiches, pas dans À faire avant l’arrivée', /Fiches voyageurs : pas encore reçues/.test(t6) && !(await r.page.$('[data-a="panel"][data-v="reg"]')), t6.slice(0, 400));
  await r.page.click('[data-a="panel"][data-v="passports"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
  const pm = await r.page.inputValue('#tx-s1');
  check('Msg passeports → le livret (« Fiches voyageurs ») avec le lien personnel, plus de photos par WhatsApp', /remplir une fiche par personne dans votre livret/.test(pm) && /t=T{43}/.test(pm) && !/photo/.test(pm), pm);
  await r.ctx.close();
  const NOREG = JSON.parse(JSON.stringify(PILOT)); delete NOREG.VILLA.guest_registration;
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: NOREG }, links: [{ client_id: 's1', token: 'T'.repeat(43) }],
    stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(6), departure: iso(9), adults: 2, booking_status: 'confirmed', source: 'airbnb', nat: 'France', details: {} }] });
  await r.page.waitForTimeout(250);
  { const tg = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (tg) { await tg.click(); await r.page.waitForTimeout(100); } }
  await r.page.click('[data-a="panel"][data-v="passports"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
  check('villa qui ne demande pas les fiches : pas de ligne, message passeports inchangé (règle de la fiche)', !/Fiches voyageurs/.test(await txt(r.page)) && /photo du passeport/.test(await r.page.inputValue('#tx-s1')));
  await r.ctx.close();
  // Éditeur : la case « Demander les fiches voyageurs » se coche et s'enregistre sur la fiche (VILLA), décochée = absente.
  r = await open({ villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' } } } });
  await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
  await r.page.check('[data-fe="VILLA.guest_registration"]'); await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
  const sv = r.calls.filter((x) => x.kind === 'PATCH').pop();
  check('éditeur : « Demander les fiches voyageurs » → VILLA.guest_registration = true', sv && sv.body.house_facts.VILLA.guest_registration === true, sv && sv.body.house_facts.VILLA);
  await r.ctx.close();
}

// ── 5 quater. Emails Airbnb sans Gmail : derrière interrupteur, adresse du compte, code de confirmation Gmail ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' } } };
  r = await open({ villa: V });
  check('interrupteur coupé (par défaut) : pas de carte « Emails Airbnb sans Gmail »', !/Emails Airbnb sans Gmail/i.test(await txt(r.page)) && !r.errs.length);
  await r.ctx.close();
  r = await open({ villa: V, emailIn: true });
  await r.page.waitForTimeout(250);
  check('interrupteur : carte avec « Obtenir mon adresse », aucune adresse créée sans geste', /Emails Airbnb sans Gmail/i.test(await txt(r.page)) && !!(await r.page.$('[data-a="inget"]')) && !r.calls.some((x) => x.kind === 'inaddr'), { t: (await txt(r.page)).slice(0, 400), errs: r.errs, calls: r.calls.map((x) => x.kind) });
  await r.page.click('[data-a="inget"]'); await r.page.waitForTimeout(300);
  const t7 = await txt(r.page);
  check('« Obtenir mon adresse » → in-<jeton>@stafflo.app affichée, étapes Gmail et autres boîtes', r.calls.some((x) => x.kind === 'inaddr') && /in-abcdefghij12@stafflo\.app/.test(t7) && /Ajouter une adresse de transfert/.test(t7) && /Outlook, iCloud/.test(t7) && /Pas encore de code/.test(t7), t7.slice(0, 600));
  await r.ctx.close();
  r = await open({ villa: V, emailIn: true, inbound: [{ token: 'abcdefghij12' }], inMails: [
    { from_email: 'forwarding-noreply@google.com', subject: '(#123456789) Confirmation de transfert Gmail', body: 'Pour confirmer : https://mail-settings.google.com/mail/vf-%5BABC%5D-xyz ou le code 123456789', received_at: new Date().toISOString() },
    { from_email: 'automated@airbnb.com', subject: 'Réservation confirmée', body: 'x', received_at: new Date().toISOString() },
    { from_email: 'express@airbnb.com', subject: 'Message', body: 'y', received_at: new Date().toISOString() }] });
  await r.page.waitForTimeout(300);
  const t8 = await txt(r.page);
  check('adresse existante + confirmation Gmail reçue → code affiché, lien de confirmation, 2 emails Airbnb comptés', /in-abcdefghij12@stafflo\.app/.test(t8) && /Code de confirmation Gmail : 123456789/.test(t8) && /2 emails Airbnb reçus/.test(t8) && !!(await r.page.$('a[href^="https://mail-settings.google.com/mail/vf-"]')) && !r.errs.length, t8.slice(0, 700));
  await r.ctx.close();
}

// ── 5 quinquies. Une vraie app : calendrier du mois, nouveau séjour, mise en page ordinateur ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia', currency: 'MAD' } } };
  const d0 = new Date(), ym = (k) => { const x = new Date(Date.UTC(d0.getFullYear(), d0.getMonth(), k)); return x.toISOString().slice(0, 10); };
  const S = [{ id: 'c1', name: 'Ana Ruiz', arrival: ym(10), departure: ym(13), adults: 2, booking_status: 'confirmed', source: 'Airbnb', details: {} }];
  r = await open({ tab: 'sejours', villa: V, stays: S.slice() });
  await r.page.waitForTimeout(250);
  const cells = await r.page.$$eval('.cal .d:not(.x)', (cs) => cs.map((x) => x.className.replace(/\s+/g, ' ').trim() + '|' + x.innerText.replace(/\n/g, ' ')));
  check('calendrier : le mois réel, arrivée (nom), nuits du séjour, départ — et pas un seul prix', cells.length === new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate() && /^d arr[^|]*\|10 Ana$/.test(cells[9]) && /^d in/.test(cells[10]) && /^d in/.test(cells[11]) && /^d dep/.test(cells[12]) && !/€|MAD/.test(cells.join(' ')) && !r.errs.length, cells.slice(8, 14));
  check('calendrier : nuits libres à venir comptées depuis les séjours', /nuits? libres? à venir ce mois-ci|Plus aucune nuit libre/.test(await txt(r.page)));
  await r.page.click('[data-a="calm"][data-v="1"]'); await r.page.waitForTimeout(100);
  check('calendrier : mois suivant', new RegExp(new Date(d0.getFullYear(), d0.getMonth() + 1, 1).toLocaleDateString('fr-FR', { month: 'long' }), 'i').test(await r.page.innerText('.cal-h b')));
  await r.page.click('[data-a="calm"][data-v="-1"]');
  await r.page.click('[data-a="nsopen"]'); await r.page.waitForSelector('#ns-name');
  check('nouveau séjour : montants en euros (comme les versements et les tuiles), jamais dans la devise des repas', /Ce que vous recevez \(net\) \(€\)/.test(await txt(r.page)));
  await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(100);
  check('nouveau séjour : nom requis, rien n’est envoyé', /Le nom du client est requis/.test(await txt(r.page)) && !r.calls.some((x) => x.kind === 'insert'));
  await r.page.fill('#ns-name', 'Léa Martin'); await r.page.fill('#ns-arr', ym(12)); await r.page.fill('#ns-dep', ym(15));
  await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(100);
  check('nouveau séjour : dates qui chevauchent un séjour → refusé, avec le nom du séjour', /chevauchent le séjour de Ana Ruiz/.test(await txt(r.page)) && !r.calls.some((x) => x.kind === 'insert'));
  await r.page.fill('#ns-arr', ym(20)); await r.page.fill('#ns-dep', ym(23)); await r.page.fill('#ns-adults', '4'); await r.page.fill('#ns-children', '1');
  await r.page.fill('#ns-net', '3000'); await r.page.fill('#ns-paid', '3200'); await r.page.selectOption('#ns-source', 'Direct'); await r.page.fill('#ns-phone', '+33600000000');
  await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(500);
  const ins = r.calls.filter((x) => x.kind === 'insert').pop();
  check('nouveau séjour : enregistré — net dans price, payé par le client à part (details.financial), jamais confondus', ins && ins.body.name === 'Léa Martin' && ins.body.arrival === ym(20) && ins.body.price === 3000 && ins.body.commission === 0 && ins.body.details.financial.guestTotal === 3200 && ins.body.details.financial.net === 3000 && ins.body.guests === 5 && ins.body.adults === 4 && ins.body.source === 'Direct' && ins.body.booking_status === 'confirmed' && /return=representation/.test(ins.prefer || ''), ins);
  check('nouveau séjour : apparaît dans la liste et le calendrier, formulaire refermé', /Léa Martin/.test(await txt(r.page)) && !(await r.page.$('#ns-name')) && !!(await r.page.$('.cal .d.arr[data-id="' + ins.body.id + '"]')) && !r.errs.length, r.errs);
  await r.ctx.close();
  // Ordinateur : menu à gauche, deux colonnes, plus de cadre de téléphone ; téléphone : menu en bas.
  r = await open({ tab: 'jour', villa: V, stays: S.slice(), width: 1366 });
  await r.page.waitForTimeout(250);
  const desk = await r.page.evaluate(() => { const app = document.getElementById('app').getBoundingClientRect(), nav = getComputedStyle(document.getElementById('tabs')), st = getComputedStyle(document.querySelector('main .stack')); return { w: app.width, dir: nav.flexDirection, pos: nav.position, cols: st.columnCount, cw: st.columnWidth }; });
  check('ordinateur (1366 px) : largeur pleine, menu vertical à gauche, contenu en deux colonnes', desk.w >= 1200 && desk.dir === 'column' && desk.pos === 'sticky' && (desk.cols === '2' || desk.cw === '420px'), desk);
  await r.ctx.close();
  r = await open({ tab: 'jour', villa: V, stays: S.slice(), width: 390 });
  await r.page.waitForTimeout(200);
  const mob = await r.page.evaluate(() => ({ pos: getComputedStyle(document.getElementById('tabs')).position, cols: getComputedStyle(document.querySelector('main .stack')).columnCount }));
  check('téléphone (390 px) : menu en bas, une colonne', mob.pos === 'fixed' && (mob.cols === 'auto' || mob.cols === '1'), mob);
  await r.ctx.close();
}

// ── 5 sexies. Modifier un séjour : nom, dates, source, montants ──────────────────────
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null };
  const S = [
    { id: 'e1', name: 'Sean Byrne', arrival: iso(5), departure: iso(9), adults: 2, booking_status: 'confirmed', source: 'Airbnb', price: 3533.9, commission: 15.5, comm_mode: 'percent',
      details: { financial: { net: 3533.9, guestTotal: 4000, bookingRef: 'HMTEST0001', source: 'confirmation_email', reconciled: true }, reservation_code: 'HMTEST0001' } },
    { id: 'e2', name: 'Léo Petit', arrival: iso(20), departure: iso(24), adults: 3, booking_status: 'confirmed', source: 'WhatsApp', price: 0, commission: 0, details: {} },
  ];
  r = await open({ tab: 'sejours', villa: V, stays: S });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="e1"]'); await r.page.click('[data-a="panel"][data-id="e1"][data-v="edit"]'); await r.page.waitForSelector('#ed-name-e1');
  const pre = { name: await r.page.inputValue('#ed-name-e1'), arr: await r.page.inputValue('#ed-arr-e1'), dep: await r.page.inputValue('#ed-dep-e1'), src: await r.page.inputValue('#ed-source-e1'), net: await r.page.inputValue('#ed-net-e1'), paid: await r.page.inputValue('#ed-paid-e1') };
  check('modifier : nom, dates, source, net et payé par le client pré-remplis depuis le séjour', pre.name === 'Sean Byrne' && pre.arr === iso(5) && pre.dep === iso(9) && pre.src === 'Airbnb' && pre.net === '3533.9' && pre.paid === '4000', pre);
  const cl = await r.page.innerText('#ed-comm-e1').catch(() => '');
  check('commission saisie autrefois dans l’app complète : montrée (15,5 %, soit 2 986 € net), le propriétaire tranche', /15,5 %/.test(cl) && /2\s?986 €/.test(cl) && /c’est mon net/.test(cl), cl);
  await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(150);
  check('rien changé → rien envoyé', !r.calls.some((x) => x.kind === 'stay'));
  await r.page.click('[data-a="panel"][data-id="e1"][data-v="edit"]'); await r.page.waitForSelector('#ed-name-e1');
  await r.page.fill('#ed-name-e1', '  '); await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(100);
  check('nom vidé → refusé, rien envoyé, formulaire gardé', /Le nom du client est requis/.test(await r.page.innerText('#toastHost')) && !r.calls.some((x) => x.kind === 'stay') && !!(await r.page.$('#ed-name-e1')));
  await r.page.fill('#ed-name-e1', 'Seán Byrne'); await r.page.fill('#ed-dep-e1', iso(21));
  await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(100);
  check('dates qui chevauchent un autre séjour → refusé avec son nom, rien envoyé', /chevauchent le séjour de Léo Petit/.test(await r.page.innerText('#toastHost')) && !r.calls.some((x) => x.kind === 'stay'));
  await r.page.fill('#ed-dep-e1', iso(4)); await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(100);
  check('départ avant l’arrivée → refusé', /Dates invalides/.test(await r.page.innerText('#toastHost')) && !r.calls.some((x) => x.kind === 'stay'));
  await r.page.fill('#ed-arr-e1', iso(6)); await r.page.fill('#ed-dep-e1', iso(10)); await r.page.selectOption('#ed-source-e1', 'Direct');
  await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(500);
  let pc = r.calls.filter((x) => x.kind === 'stay').pop();
  check('nom, dates décalées (sur ses propres anciennes dates : pas un chevauchement), source → envoyés ; montants intacts', !!pc && /id=eq\.e1/.test(pc.url) && pc.body.name === 'Seán Byrne' && pc.body.arrival === iso(6) && pc.body.departure === iso(10) && pc.body.source === 'Direct' && !('price' in pc.body) && !('commission' in pc.body) && !('details' in pc.body), pc && pc.body);
  check('après le changement de dates : séjour rechargé, nouvelles dates affichées, 0 erreur', /Seán Byrne/.test(await txt(r.page)) && !r.errs.length, r.errs);
  // Montants : net → price + commission 0 ; payé → details.financial.guestTotal ; le relevé de l'email reste.
  await r.page.click('[data-a="panel"][data-id="e1"][data-v="edit"]').catch(() => {});
  if (!(await r.page.$('#ed-net-e1'))) { await r.page.click('[data-a="toggle"][data-id="e1"]'); await r.page.click('[data-a="panel"][data-id="e1"][data-v="edit"]'); }
  await r.page.waitForSelector('#ed-net-e1');
  await r.page.fill('#ed-net-e1', '2986'); await r.page.fill('#ed-paid-e1', '4100');
  await r.page.click('[data-a="editsave"][data-id="e1"]'); await r.page.waitForTimeout(400);
  pc = r.calls.filter((x) => x.kind === 'stay').pop();
  const fin = pc && pc.body.details && pc.body.details.financial;
  check('net modifié → price = net, commission 0 ; payé → financial.guestTotal ; bookingRef, code et relevé gardés', !!pc && pc.body.price === 2986 && pc.body.commission === 0 && !!fin && fin.net === 2986 && fin.guestTotal === 4100 && fin.bookingRef === 'HMTEST0001' && fin.source === 'confirmation_email' && fin.reconciled === true && !!fin.editedAt && pc.body.details.reservation_code === 'HMTEST0001' && !('name' in pc.body), pc && pc.body);
  // Le séjour WhatsApp : sa source est gardée dans la liste (pas remplacée par « Direct » à l'enregistrement)
  await r.page.click('[data-a="toggle"][data-id="e2"]'); await r.page.click('[data-a="panel"][data-id="e2"][data-v="edit"]'); await r.page.waitForSelector('#ed-source-e2');
  check('source hors liste (WhatsApp) : proposée et sélectionnée, net vide quand 0', (await r.page.inputValue('#ed-source-e2')) === 'WhatsApp' && (await r.page.inputValue('#ed-net-e2')) === '' && !(await r.page.$('#ed-comm-e2')));
  const before = r.calls.filter((x) => x.kind === 'stay').length;
  await r.page.fill('#ed-adults-e2', '4'); await r.page.click('[data-a="editsave"][data-id="e2"]'); await r.page.waitForTimeout(300);
  pc = r.calls.filter((x) => x.kind === 'stay').pop();
  check('autre champ seulement (adultes) : ni source, ni montant, ni dates envoyés', r.calls.filter((x) => x.kind === 'stay').length === before + 1 && Object.keys(pc.body).sort().join() === 'adults,guests' && pc.body.adults === 4, pc && pc.body);
  await r.ctx.close();
  // « C'est mon net » : commission 0, montant inchangé.
  const S2 = [{ id: 'e3', name: 'Lea Roy', arrival: iso(3), departure: iso(6), adults: 2, booking_status: 'confirmed', source: 'Airbnb', price: 1200, commission: 15.5, comm_mode: 'percent', details: {} }];
  r = await open({ tab: 'sejours', villa: V, stays: S2 });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="e3"]'); await r.page.click('[data-a="panel"][data-id="e3"][data-v="edit"]'); await r.page.waitForSelector('#ed-comm-e3');
  await r.page.click('[data-a="netok"][data-id="e3"]'); await r.page.waitForTimeout(300);
  pc = r.calls.filter((x) => x.kind === 'stay').pop();
  check('« c’est mon net » → commission 0 seulement, le montant ne bouge pas, la ligne disparaît', !!pc && Object.keys(pc.body).join() === 'commission' && pc.body.commission === 0 && !(await r.page.$('#ed-comm-e3')) && !r.errs.length, pc && pc.body);
  await r.ctx.close();
}

// ── 5 septies. Retrouver un client : recherche sur tous les séjours, historique ─────────
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null };
  const S = [
    { id: 'h1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(9), adults: 2, booking_status: 'confirmed', source: 'Airbnb', price: 2000, details: {} },
    { id: 'h2', name: 'Anä  RUIZ', arrival: iso(-200), departure: iso(-196), adults: 2, booking_status: 'confirmed', source: 'Airbnb', price: 1800, details: { reservation_code: 'HMTEST0002', payouts: [{ amount_eur: 1800, expected_by: iso(-195) }] } },
    { id: 'h3', name: 'Bob Stone', arrival: iso(-100), departure: iso(-97), adults: 4, booking_status: 'confirmed', source: 'Direct', phone: '+33 6 11 22 33 44', price: 2500, details: {} },
    { id: 'h4', name: 'Robert S.', arrival: iso(30), departure: iso(33), adults: 4, booking_status: 'confirmed', source: 'Direct', phone: '+33611223344', price: 2600, details: {} },
    { id: 'h5', name: 'Capucine', arrival: iso(-60), departure: iso(-57), booking_status: 'confirmed', source: 'Airbnb', details: {} },
    { id: 'h6', name: 'Capucine', arrival: iso(60), departure: iso(63), booking_status: 'confirmed', source: 'Airbnb', details: {} },
    { id: 'h7', name: 'Ana Lead', arrival: iso(70), departure: iso(73), booking_status: 'inquiry', source: 'Airbnb', details: {} },
  ];
  r = await open({ tab: 'sejours', villa: V, stays: S });
  await r.page.waitForTimeout(250);
  await r.page.click('#q-stays'); await r.page.keyboard.type('ana ruíz', { delay: 10 }); await r.page.waitForTimeout(150);
  const res = await r.page.$$eval('#q-res article', (as) => as.map((a) => a.id));
  const vis = await r.page.evaluate(() => ({ cal: !!document.querySelector('.cal') && getComputedStyle(document.querySelector('.cal').closest('.stack > *')).display, focus: document.activeElement && document.activeElement.id }));
  check('recherche « ana ruíz » : les deux séjours d’Ana (accents, casse, espaces ignorés), le plus récent d’abord ; ni Bob ni une simple demande', res.join() === 'st-h1,st-h2', res);
  check('pendant la frappe : le reste de la page est masqué, le champ garde le clavier (pas de redessin complet)', vis.cal === 'none' && vis.focus === 'q-stays', vis);
  await r.page.fill('#q-stays', ''); await r.page.keyboard.type('611 22', { delay: 10 }); await r.page.waitForTimeout(100);
  check('recherche par téléphone (chiffres) : Bob et Robert (même numéro écrit autrement)', (await r.page.$$eval('#q-res article', (as) => as.map((a) => a.id).sort().join())) === 'st-h3,st-h4');
  await r.page.fill('#q-stays', 'hmtest0002'); await r.page.waitForTimeout(100);
  check('recherche par code de réservation', (await r.page.$$eval('#q-res article', (as) => as.map((a) => a.id).join())) === 'st-h2');
  await r.page.fill('#q-stays', 'zzz'); await r.page.waitForTimeout(100);
  check('rien trouvé : message clair', /Aucun séjour ne correspond/.test(await r.page.innerText('#q-res')));
  await r.page.fill('#q-stays', ''); await r.page.waitForTimeout(100);
  check('recherche vidée : la page Séjours revient (calendrier visible)', await r.page.evaluate(() => getComputedStyle(document.querySelector('.cal').closest('.stack > *')).display !== 'none') && (await r.page.innerText('#q-res')) === '');
  // Historique : sur le séjour à venir, l'autre séjour du même client ; jamais par prénom seul.
  await r.page.click('[data-a="toggle"][data-id="h1"]'); await r.page.waitForTimeout(100);
  let th = await r.page.innerText('#st-h1');
  check('historique : « Un autre séjour » sur le séjour d’Ana (nom complet identique) ; montant du séjour dans le détail', /Un autre séjour\s*:/.test(th) && /Net reçu :\s*2\s?000 €/.test(th), th.slice(0, 300));
  await r.page.click('[data-a="toggle"][data-id="h4"]'); await r.page.waitForTimeout(100);
  check('historique : même téléphone, nom différent → reconnu', /Un autre séjour\s*:/.test(await r.page.innerText('#st-h4')));
  await r.page.click('[data-a="toggle"][data-id="h6"]'); await r.page.waitForTimeout(100);
  check('prénom seul (« Capucine ») : jamais rapproché d’un autre séjour', !/autre séjour/i.test(await r.page.innerText('#st-h6')));
  // Un séjour ancien, ouvert depuis la recherche : versement visible, rien à envoyer, modifiable.
  await r.page.fill('#q-stays', 'bob'); await r.page.waitForTimeout(100);
  await r.page.click('#q-res [data-a="toggle"][data-id="h3"]'); await r.page.waitForTimeout(150);
  const tp = await r.page.innerText('#q-res');
  check('séjour terminé ouvert depuis la recherche : dates, autre séjour du client, aucun message à envoyer (brief, départ)', /Un autre séjour/.test(tp) && !(await r.page.$('#q-res [data-v="brief"]')) && !(await r.page.$('#q-res [data-v="depart"]')) && !!(await r.page.$('#q-res [data-v="edit"]')), tp.slice(0, 300));
  await r.page.click('#q-res [data-a="panel"][data-id="h3"][data-v="edit"]'); await r.page.waitForSelector('#q-res #ed-net-h3');
  await r.page.fill('#q-res #ed-net-h3', '2400'); await r.page.click('#q-res [data-a="editsave"][data-id="h3"]'); await r.page.waitForTimeout(300);
  const pe = r.calls.filter((x) => x.kind === 'stay').pop();
  check('séjour terminé : montant corrigé (price, commission 0), sur le bon séjour', !!pe && /id=eq\.h3/.test(pe.url) && pe.body.price === 2400 && pe.body.commission === 0, pe);
  check('0 erreur', !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── 5 octies. Réglages dans Maison : la villa, les emails, l'abonnement, le compte ─────
{
  const V = { villa_name: 'Riad Zina', owner_name: 'nadia', city: 'Marrakech, Maroc', country: 'Maroc', bedrooms: 4, max_guests: 8, house_facts_ref: null, house_facts: null, gmail: 'riad@example.com' };
  const fin = new Date(Date.now() - 8 * 60000).toISOString();
  r = await open({ villa: V, sync: [{ finished_at: fin, ok: true }], bill: { entitled: true, status: 'trialing', trial_ends_at: iso(12) + 'T10:00:00Z' } });
  await r.page.waitForTimeout(200);
  let ts = await r.page.innerText('#settings');
  check('Maison › Réglages : la villa (nom, ville, chambres, capacité), Gmail relié + dernière synchro, iCal, abonnement, compte', /Riad Zina · Marrakech · 4 chambres · 8 pers\./.test(ts) && /Gmail relié : riad@example\.com · synchronisé il y a 8 min/.test(ts) && /Calendriers \(iCal\)/.test(ts) && /Essai : 12 jours restants/.test(ts) && /x@y\.z/.test(ts) && /Se déconnecter/.test(ts) && !r.errs.length, ts);
  check('Gmail : « Reconnecter » ouvre la connexion dans l’app complète (lien profond, pas d’aiguillage vers l’Espace)', !!(await r.page.$('#settings a[href="app.html?open=gmail"]')) && !!(await r.page.$('#settings a[href="app.html?open=settings"]')));
  await r.page.click('[data-a="vsedit"]'); await r.page.waitForSelector('#vs-villa_name');
  check('modifier la villa : champs pré-remplis depuis la base', (await r.page.inputValue('#vs-villa_name')) === 'Riad Zina' && (await r.page.inputValue('#vs-city')) === 'Marrakech, Maroc' && (await r.page.inputValue('#vs-bedrooms')) === '4');
  await r.page.fill('#vs-bedrooms', '4.5'); await r.page.click('[data-a="vssave"]'); await r.page.waitForTimeout(100);
  check('chambres non entières → refusé, rien envoyé', /un nombre entier/.test(await r.page.innerText('#settings')) && !r.calls.some((x) => x.kind === 'PATCH'));
  await r.page.fill('#vs-bedrooms', '5'); await r.page.fill('#vs-villa_name', ''); await r.page.click('[data-a="vssave"]'); await r.page.waitForTimeout(100);
  check('nom vidé → refusé, rien envoyé', /nom de la villa est requis/.test(await r.page.innerText('#settings')) && !r.calls.some((x) => x.kind === 'PATCH'));
  await r.page.fill('#vs-villa_name', 'Riad Zina'); await r.page.fill('#vs-city', 'Essaouira, Maroc');
  await r.page.click('[data-a="vssave"]'); await r.page.waitForTimeout(400);
  const vp = r.calls.filter((x) => x.kind === 'PATCH').pop();
  check('enregistrer : PATCH sur SA ligne (owner_id), seulement ce qui a changé (ville, chambres)', !!vp && /villa_settings\?owner_id=eq\.1111/.test(vp.url) && Object.keys(vp.body).sort().join() === 'bedrooms,city' && vp.body.city === 'Essaouira, Maroc' && vp.body.bedrooms === 5, vp && vp.body);
  ts = await r.page.innerText('#settings');
  check('après enregistrement : la ligne de la villa montre les nouvelles valeurs, formulaire refermé', /Riad Zina · Essaouira · 5 chambres · 8 pers\./.test(ts) && !(await r.page.$('#vs-villa_name')));
  await r.page.click('[data-a="billcheckout"]'); await r.page.waitForTimeout(600);
  const pol = r.calls.filter((x) => x.kind === 'polar').pop();
  check('« S’abonner » : polar-checkout avec la session du propriétaire, puis la page de paiement', !!pol && /polar-checkout$/.test(pol.url) && pol.auth === 'Bearer tok' && /checkout\.example\.com/.test(r.page.url()), { pol, url: r.page.url() });
  await r.ctx.close();
  // Gmail pas relié, synchro ancienne, abonnement actif, accès offert
  r = await open({ villa: { ...V, gmail: null }, bill: { entitled: true, status: 'comp' } });
  await r.page.waitForTimeout(200);
  ts = await r.page.innerText('#settings');
  check('Gmail pas relié → « Relier Gmail » ; accès offert → aucun bouton de paiement', /Gmail pas relié/.test(ts) && /Relier Gmail/.test(ts) && /Accès offert/.test(ts) && !(await r.page.$('[data-a="billcheckout"]')) && !(await r.page.$('[data-a="billportal"]')));
  await r.ctx.close();
  r = await open({ villa: V, sync: [{ finished_at: new Date(Date.now() - 3 * 3600e3).toISOString(), ok: true }], bill: [] });
  await r.page.waitForTimeout(200);
  ts = await r.page.innerText('#settings');
  check('synchro Gmail ancienne (3 h) → signalée ; état de l’abonnement illisible → rien affiché (jamais un statut inventé)', /pas de synchronisation récente/.test(ts) && !/Abonnement/.test(ts));
  await r.ctx.close();
  // Échec d'enregistrement (aucune ligne touchée) : message, et ce qui a été tapé reste dans le formulaire.
  r = await open({ villa: null });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="vsedit"]'); await r.page.waitForSelector('#vs-villa_name');
  await r.page.fill('#vs-villa_name', 'Villa Neuve'); await r.page.fill('#vs-city', 'Agadir'); await r.page.click('[data-a="vssave"]'); await r.page.waitForTimeout(400);
  check('échec d’enregistrement : message, saisie gardée (rien de perdu)', /Enregistrement impossible/.test(await r.page.innerText('#settings')) && (await r.page.inputValue('#vs-villa_name')) === 'Villa Neuve' && (await r.page.inputValue('#vs-city')) === 'Agadir');
  await r.ctx.close();
  // Fiche en place (pilote) : les Réglages sont aussi là.
  r = await open({ villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT } });
  await r.page.waitForTimeout(200);
  check('fiche en place : Réglages en bas de Maison aussi', !!(await r.page.$('#settings [data-a="vsedit"]')) && !!(await r.page.$('#settings [data-a="signout"]')));
  await r.ctx.close();
  // Déconnexion : jeton révoqué, données locales effacées, écran de connexion.
  r = await open({ villa: V, once: true });
  await r.page.waitForTimeout(200);
  await r.page.evaluate(() => { localStorage.setItem('stafflo_cfg', '{"villa":"x"}'); localStorage.setItem('stafflo_house_facts', '{}'); });
  await r.page.click('[data-a="signout"]'); await r.page.waitForTimeout(3500);
  const left = await r.page.evaluate(() => ['stafflo_session', 'stafflo_cfg', 'stafflo_house_facts'].filter((k) => localStorage.getItem(k) != null));
  const lo = r.calls.filter((x) => x.kind === 'logout').pop();
  check('se déconnecter : jeton révoqué (auth/v1/logout), session et données locales effacées, écran de connexion', !!lo && lo.auth === 'Bearer tok' && !left.length && !!(await r.page.$('#loginForm')), { lo, left });
  await r.ctx.close();
}

// ── 5 nonies. WhatsApp → séjour : export lu sur l'appareil, propositions citées, rien sans validation ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null };
  const dmy = (d, sep = '/') => { const x = new Date(Date.now() + d * 86400000); return String(x.getUTCDate()).padStart(2, '0') + sep + String(x.getUTCMonth() + 1).padStart(2, '0') + sep + x.getUTCFullYear(); };
  const IOS = [
    `[${dmy(-9)}, 18:29:01] Ana Ruiz: Hi, thank you for the message. Sending you on here so you also have my number`,
    `[${dmy(-6)}, 11:49:10] Nadia: Hi Ana, could you send me your flight numbers and arrival time, and who shares each bedroom? We are 12 people max at the villa.`,
    `[${dmy(-6)}, 15:20:33] Ana Ruiz: Hi! Thank you so much for sending this over, it has been hectic with the final preparations for the wedding so apologies I didn't respond earlier.`,
    `This looks amazing, the booklet is very useful. A minor update, in the end only 4 of us will stay at the villa, I will attach passports shortly, looking at the booklet this would change the price of our meals?`,
    `[${dmy(-6)}, 15:38:02] Ana Ruiz: ‎<attached: 00000012-PHOTO-2026-10-09-15-38-02.jpg>`,
    `[${dmy(-2)}, 14:02:11] Nadia: Our driver is waiting at the airport`,
    `[${dmy(-2)}, 14:05:40] Ana Ruiz: Ah perfect thank you, hoping to arrive in about 1hr15`,
  ].join('\n');
  const S = [{ id: 'w1', name: 'Ana Ruiz', arrival: iso(3), departure: iso(7), adults: 7, booking_status: 'confirmed', source: 'Airbnb', price: 3000, details: { reservation_code: 'HMTEST0003' }, notes: 'Arrivée tardive possible' }];
  r = await open({ tab: 'sejours', villa: V, stays: S, ai: (b) => ({ text: JSON.stringify({ party: { adults: 5, children: null, quote: 'in the end only 4 of us will stay at the villa' }, arrival: null, meals: null, requests: [
    { value: 'Mariage du couple', quote: 'final preparations for the wedding' }, { value: 'Végétarien', quote: 'we are all vegetarian' }] }) }) });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]');
  await r.page.click('#st-w1 [data-a="panel"][data-v="wa"]'); await r.page.waitForSelector('#wa-paste-w1');
  check('Modifier › « Remplir depuis WhatsApp » : étapes d’export, dépôt de fichier, coller, mention de confidentialité', /Exporter la discussion/.test(await r.page.innerText('#st-w1')) && !!(await r.page.$('#st-w1 input[type=file][data-file="wa"]')) && /lue sur cet appareil/.test(await r.page.innerText('#st-w1')));
  await r.page.fill('#wa-paste-w1', IOS); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(150);
  let tw = await r.page.innerText('#st-w1');
  check('export iPhone collé : 6 messages lus, 1 photo non importée, client reconnu (Ana Ruiz)', /6 messages/.test(tw) && /1 photo ou document non importé/.test(tw) && (await r.page.$eval('[data-a="waguest"][aria-pressed="true"]', (b) => b.innerText)) === 'Ana Ruiz', tw.slice(0, 400));
  check('composition : 4 (phrase du client citée), jamais les « 12 people » de l’hôte', (await r.page.inputValue('#wa-ad-w1-0')) === '4' && /« in the end only 4 of us will stay at the villa »/.test(tw));
  const arrV = await r.page.inputValue('#wa-v-w1-1');
  check('arrivée : la phrase du client avec la date et l’heure du message, rien de calculé', /^« hoping to arrive in about 1hr15 » \(WhatsApp, .+ 14:05\)$/.test(arrV), arrV);
  check('une question n’est pas une commande : pas de « repas » tiré de « would change the price of our meals? » ; le mariage proposé en note', (await r.page.$$('#st-w1 .wa-p')).length === 3 && !/meals\?/.test(await r.page.$$eval('#st-w1 .wa-p textarea', (ts) => ts.map((t) => t.value).join('|'))) && /À noter \(privé\)/.test(tw) && /wedding/.test(await r.page.$$eval('#st-w1 .wa-p textarea', (ts) => ts.map((x) => x.value).join('|'))));
  check('rien d’envoyé à ce stade (ni base, ni ARIA)', !r.calls.some((x) => x.kind === 'stay' || x.kind === 'ai'));
  await r.page.click('[data-a="waaria"][data-id="w1"]'); await r.page.waitForTimeout(300);
  const ai = r.calls.filter((x) => x.kind === 'ai').pop();
  tw = await r.page.innerText('#st-w1');
  check('« Lire avec ARIA » : tâche extract, seulement les messages du client (pas ceux de l’hôte) ; citation absente des messages → jetée ; nombre absent de la citation → jeté', !!ai && ai.body.task === 'extract' && /only 4 of us/.test(ai.body.user) && !/12 people/.test(ai.body.user) && /Mariage du couple/.test(await r.page.$$eval('#st-w1 .wa-p textarea', (ts) => ts.map((t) => t.value).join('|'))) && !/Végétarien/.test(await r.page.$$eval('#st-w1 .wa-p textarea', (ts) => ts.map((t) => t.value).join('|'))) && (await r.page.$$('#st-w1 .wa-p')).length === 4, { n: (await r.page.$$('#st-w1 .wa-p')).length, task: ai && ai.body.task, tw: tw.slice(tw.indexOf('Remplir depuis'), tw.indexOf('Remplir depuis') + 900) });
  await r.page.uncheck('#wa-on-w1-2'); // la note « wedding » tirée par expression régulière : décochée
  await r.page.click('[data-a="waapply"][data-id="w1"]'); await r.page.waitForTimeout(400);
  const wp = r.calls.filter((x) => x.kind === 'stay').pop();
  check('enregistrer : adultes 4, arrivée, note ARIA ajoutée (pas la décochée), code de réservation gardé, aucun message stocké', !!wp && wp.body.adults === 4 && wp.body.guests === 4 && /hoping to arrive in about 1hr15/.test(wp.body.details.arrival_time) && wp.body.notes === 'Arrivée tardive possible\nWhatsApp : Mariage du couple' && wp.body.details.reservation_code === 'HMTEST0003' && wp.body.details.whatsapp.messages === 6 && !/thank you so much/i.test(JSON.stringify(wp.body)), wp && wp.body);
  await r.ctx.close();
  // Android, .zip avec média ; vol et heure ; adultes + enfants
  const crc = (b) => (zlib.crc32 ? zlib.crc32(b) : 0) >>> 0;
  const mkzip = (entries) => {
    const parts = [], central = []; let off = 0;
    for (const e of entries) {
      const name = Buffer.from(e.name), data = Buffer.from(e.data), comp = e.deflate ? zlib.deflateRawSync(data) : data, c32 = crc(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.deflate ? 8 : 0, 8); lh.writeUInt32LE(c32, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.deflate ? 8 : 0, 10); ch.writeUInt32LE(c32, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, name, comp); central.push(ch, name); off += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, end]);
  };
  const AND = [`${dmy(-5)}, 10:00 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.`,
    `${dmy(-5)}, 10:01 - Ana Ruiz: Hello! We will be 6 people including 2 kids, flight AT801 landing at 16:40`,
    `${dmy(-5)}, 10:02 - Ana Ruiz: For dinner on the first night we would love the tajine.`,
    `${dmy(-5)}, 10:03 - Ana Ruiz: IMG-20261009-WA0001.jpg (file attached)`].join('\n');
  const Z = mkzip([{ name: 'WhatsApp Chat with Ana Ruiz.txt', data: AND, deflate: true }, { name: 'IMG-20261009-WA0001.jpg', data: 'xx', deflate: false }]);
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0], notes: null }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 [data-a="panel"][data-v="wa"]');
  await r.page.setInputFiles('#st-w1 input[data-file="wa"]', { name: 'WhatsApp Chat with Ana Ruiz.zip', mimeType: 'application/zip', buffer: Z });
  await r.page.waitForSelector('#wa-ad-w1-0', { timeout: 4000 }).catch(() => {});
  tw = await r.page.innerText('#st-w1');
  check('export Android (.zip, deflate) : lu sur l’appareil, message système ignoré, 1 média non importé', /3 messages/.test(tw) && /1 photo ou document non importé/.test(tw) && !/end-to-end/.test(tw.split('Voir les')[0]), tw.slice(0, 500));
  check('« 6 people including 2 kids » → 4 adultes + 2 enfants ; vol AT801 et heure dans l’arrivée ; dîner proposé en repas', (await r.page.inputValue('#wa-ad-w1-0')) === '4' && (await r.page.inputValue('#wa-ch-w1-0')) === '2' && /^Vol AT801 · « flight AT801 landing at 16:40 »/.test(await r.page.inputValue('#wa-v-w1-1')) && /tajine/.test(await r.page.inputValue('#wa-v-w1-2')));
  await r.ctx.close();
  // Format US (mois/jour, AM/PM) ; contact enregistré sous son numéro : le propriétaire désigne le client
  const x0 = new Date(Date.now() - 2 * 86400000), us = (x0.getUTCMonth() + 1) + '/' + x0.getUTCDate() + '/' + String(x0.getUTCFullYear()).slice(2);
  const USX = [`${us}, 3:38 PM - +33 6 00 00 00 01: we're 5 adults now`, `${us}, 3:40 PM - Nadia: Noted!`].join('\n');
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0] }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 [data-a="panel"][data-v="wa"]');
  await r.page.fill('#wa-paste-w1', USX); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(100);
  check('client pas reconnu (numéro) : rien proposé tant que le propriétaire ne l’a pas désigné', /Touchez le nom du client/.test(await r.page.innerText('#st-w1')) && !(await r.page.$('#wa-ad-w1-0')));
  await r.page.click('[data-a="waguest"][data-v="0"]'); await r.page.waitForTimeout(100);
  check('format US (10/13/26, 3:38 PM) : 5 adultes, heure 15:38', (await r.page.inputValue('#wa-ad-w1-0')) === '5' && /15:38/.test(await r.page.innerText('#st-w1')));
  await r.page.click('[data-a="wareset"][data-id="w1"]');
  await r.page.fill('#wa-paste-w1', 'Hi! We are now 3 adults and 1 baby, see you soon'); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(100);
  check('un message copié sans date : lu tel quel (3 adultes, 1 enfant)', (await r.page.inputValue('#wa-ad-w1-0')) === '3' && (await r.page.inputValue('#wa-ch-w1-0')) === '1' && !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── 5 decies. Décompte : tickets et factures (photos, PDF), privés, suppression douce ──
{
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const F0 = [{ id: 'f0', path: UID + '/b1/0000.pdf', name: 'facture-marche.pdf', mime: 'application/pdf', size: 1200, created_at: new Date().toISOString() }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT }, files: F0.slice(),
    stays: [{ id: 'b1', name: 'Ana Ruiz', arrival: iso(-2), departure: iso(1), adults: 6, booking_status: 'confirmed', source: 'Airbnb', details: {} }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="b1"]'); await r.page.click('[data-a="panel"][data-id="b1"][data-v="bill"]'); await r.page.waitForTimeout(300);
  const get = r.calls.find((x) => x.kind === 'sfget'), sg = r.calls.find((x) => x.kind === 'sign');
  check('décompte : « Tickets et factures » liste les pièces du séjour (non retirées), ouvertes par lien signé d’une heure (jamais public)', !!get && /client_id=eq\.b1/.test(get.url) && /deleted_at=is\.null/.test(get.url) && !!sg && sg.body.expiresIn === 3600 && sg.auth === 'Bearer tok' &&
    !!(await r.page.$('#st-b1 .bf-it a[href^="https://rcjhgilpmojohmrqzokx.supabase.co/storage/v1/object/sign/stay-files/' + UID + '/b1/0000.pdf?token="]')) && /facture-marche\.pdf/.test(await r.page.innerText('#st-b1 .bf-grid')));
  await r.page.setInputFiles('#st-b1 input[data-file="bill"]', [{ name: 'ticket.png', mimeType: 'image/png', buffer: PNG1 }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await r.page.waitForTimeout(800);
  const up = r.calls.filter((x) => x.kind === 'upload'), ins = r.calls.filter((x) => x.kind === 'sfinsert');
  check('ajout : une photo envoyée dans le dossier du compte et du séjour, ligne stay_files ; un .txt refusé avec un message', up.length === 1 && new RegExp('/storage/v1/object/stay-files/' + UID + '/b1/[^/]+\\.(png|jpg)$').test(up[0].url) && up[0].auth === 'Bearer tok' && /^image\//.test(up[0].type) &&
    ins.length === 1 && ins[0].body.client_id === 'b1' && ins[0].body.path.startsWith(UID + '/b1/') && ins[0].body.size === up[0].size && /Photos \(JPEG, PNG, HEIC\) ou PDF seulement/.test(await r.page.innerText('#st-b1')) && (await r.page.$$('#st-b1 .bf-it')).length === 2, { up, ins });
  await r.page.click('#st-b1 [data-a="bfdel"][data-v="f0"]'); await r.page.waitForTimeout(300);
  const del = r.calls.filter((x) => x.kind === 'sfpatch').pop();
  check('retirer : suppression douce (deleted_at), jamais de DELETE ; la pièce disparaît', !!del && /stay_files\?id=eq\.f0/.test(del.url) && Object.keys(del.body).join() === 'deleted_at' && (await r.page.$$('#st-b1 .bf-it')).length === 1 && !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── 5 undecies. Équipe dans Maison : un seul endroit, la fiche maison ──────────────────
{
  // Compte sans fiche ni table staff, équipe saisie à l'inscription dans l'app (villa_settings.staff_members)
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null, staff_members: [{ name: 'Omar', role: 'gardien', wa: '+212600000001' }, { name: '', role: 'x' }] };
  r = await open({ villa: V });
  await r.page.waitForTimeout(200);
  let tt = await txt(r.page);
  check('sans fiche : l’équipe saisie à l’inscription (app) s’affiche dans Maison, avec « Modifier l’équipe »', /Omar/.test(tt) && !!(await r.page.$('[data-a="feopen"][data-v="team"]')) && !/Ajoutez votre équipe dans Réglages/.test(tt));
  await r.page.click('[data-a="feopen"][data-v="team"]'); await r.page.waitForSelector('[data-fe="TEAM.0.name"]');
  const teamOpen = await r.page.evaluate(() => { const d = document.querySelector('details[data-fold="fe:Équipe"]'); return !!d && d.open; });
  check('« Modifier l’équipe » : éditeur de la fiche, section Équipe ouverte, pré-remplie (prénom, téléphone)', teamOpen && (await r.page.inputValue('[data-fe="TEAM.0.name"]')) === 'Omar' && (await r.page.inputValue('#fe-TEAM\\.0\\.phone')) === '+212600000001', teamOpen);
  await r.page.click('[data-a="feadd"][data-v="TEAM"]'); await r.page.waitForSelector('[data-fe="TEAM.1.name"]');
  await r.page.fill('[data-fe="TEAM.1.name"]', 'Khadija'); await r.page.fill('[data-fe="TEAM.1.role.0"]', 'ménage');
  await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
  const ts = r.calls.filter((c) => c.kind === 'PATCH').pop(), T = ts && ts.body.house_facts && ts.body.house_facts.TEAM;
  check('enregistrer : l’équipe va dans la fiche maison du compte (Omar + Khadija)', !!T && T.length === 2 && T[0].name === 'Omar' && T[1].name === 'Khadija' && T[1].role[0] === 'ménage', T);
  await r.ctx.close();
  // Compte neuf sans personne : « Ajouter votre équipe » ; la mise en route y mène aussi (plus vers l’app)
  r = await open({ villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null }, tab: 'jour' });
  await r.page.waitForTimeout(200);
  check('mise en route : « Ajouter votre équipe » ouvre la section Équipe de la fiche (plus de détour par l’app)', !!(await r.page.$('button.todo.setup[data-a="feopen"][data-v="team"]')) && !(await r.page.$('a.todo.setup[href="app.html?open=settings"]')));
  await r.page.click('button.todo.setup[data-a="feopen"][data-v="team"]'); await r.page.waitForTimeout(150);
  check('… et l’éditeur s’ouvre dans Maison, section Équipe ouverte', await r.page.evaluate(() => { const d = document.querySelector('details[data-fold="fe:Équipe"]'); return !!d && d.open; }) && !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── 5 duodecies. WhatsApp Business relié : conversations rangées sur le séjour, sans séjour → relier ──
{
  const at = (d, h, mi) => { const x = new Date(Date.now() + d * 86400000); x.setHours(h, mi, 0, 0); return x.toISOString(); };
  const S = [
    { id: 'k1', name: 'Felipe Villalobos', phone: '+44 7700 900123', arrival: iso(3), departure: iso(6), adults: 7, booking_status: 'confirmed', source: 'Airbnb', details: {} },
    { id: 'k2', name: 'Sara Benali', phone: null, arrival: iso(10), departure: iso(14), adults: 2, booking_status: 'confirmed', source: 'Direct', details: {} },
    { id: 'k3', name: 'Marc Petit', phone: '06 00 00 00 98', arrival: iso(20), departure: iso(23), adults: 2, booking_status: 'confirmed', source: 'Direct', details: {} },
  ];
  const W = [
    { id: 'w1', guest_wa: '447700900123', guest_name: 'Felipe', direction: 'in', type: 'text', body: 'Hi! A minor update, in the end only 4 of us will stay at the villa, looking at the booklet this would change the price of our meals?', sent_at: at(-5, 15, 20), client_id: null },
    { id: 'w2', guest_wa: '447700900123', guest_name: null, direction: 'out', type: 'text', body: 'Noted, see you Tuesday! We are 12 max at the villa.', sent_at: at(-5, 15, 30), client_id: null },
    { id: 'w3', guest_wa: '447700900123', guest_name: 'Felipe', direction: 'in', type: 'image', body: null, sent_at: at(-5, 15, 38), client_id: null },
    { id: 'w4', guest_wa: '447700900123', guest_name: 'Felipe', direction: 'in', type: 'text', body: 'Ah perfect thank you, hoping to arrive in about 1hr15', sent_at: at(-1, 14, 5), client_id: null },
    { id: 'w5', guest_wa: '212600000099', guest_name: 'Sara', direction: 'in', type: 'text', body: 'Bonjour, nous arrivons à 2, merci pour le livret', sent_at: at(-2, 9, 0), client_id: null },
    { id: 'w6', guest_wa: '212600000098', guest_name: 'Marc', direction: 'in', type: 'text', body: 'On arrive vers 16h', sent_at: at(-1, 10, 0), client_id: null },
    { id: 'w7', guest_wa: '212600000077', guest_name: 'Saïd', direction: 'in', type: 'text', body: 'Les chambres sont prêtes', sent_at: at(-1, 11, 0), client_id: null },
    { id: 'w8', guest_wa: '33600000055', guest_name: 'Vieux contact', direction: 'in', type: 'text', body: 'Hello', sent_at: at(-60, 11, 0), client_id: null },
  ];
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, TEAM: [{ name: 'Saïd', role: ['gardien', ''], phone: '+212 6 00 00 00 77', brief: true }] } };
  r = await open({ tab: 'jour', villa: V, stays: S.map((x) => ({ ...x })), waNum: [{ display_phone: '+212 775 000 000', history_status: 'done', history_progress: 100 }], waMsgs: W.map((x) => ({ ...x })) });
  await r.page.waitForTimeout(300);
  const wg = r.reads.find((x) => x.kind === 'waget');
  let tj = await txt(r.page);
  check('chargement : messages des 400 derniers jours, les plus récents, non masqués', !!wg && /deleted_at=is\.null/.test(wg.url) && /order=sent_at\.desc/.test(wg.url) && /sent_at=gte\./.test(wg.url));
  check('Jour › « WhatsApp sans séjour » : seulement Sara (numéro sur aucun séjour) — ni Felipe ni Marc (reliés par leur numéro, même écrit 06…), ni Saïd (équipe), ni un contact de plus de 30 jours', /WhatsApp sans séjour/i.test(tj) && /Sara · \+212600000099/.test(tj) && !/Felipe · \+447700900123/.test(tj) && !/\+212600000098/.test(tj) && !/Les chambres sont prêtes/.test(tj) && !/Vieux contact/.test(tj), tj.slice(0, 300));
  await r.page.click('[data-a="tab"][data-v="sejours"]'); await r.page.waitForTimeout(150);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.waitForTimeout(100);
  let tk = await r.page.innerText('#st-k1');
  check('séjour de Felipe : « WhatsApp · 4 messages », les deux derniers (photo sans texte → ‹photo›)', /WhatsApp · 4 messages · dernier/.test(tk) && /‹photo›/.test(tk) && /hoping to arrive in about 1hr15/.test(tk), tk.slice(0, 700));
  await r.page.click('[data-a="panel"][data-id="k1"][data-v="wat"]'); await r.page.waitForTimeout(100);
  check('« Voir la conversation » : les 4 messages, client et « Vous », lecture seule', (await r.page.$$('#st-k1 .panel .wa-log p')).length === 4 && /Vous · /.test(await r.page.innerText('#st-k1 .panel')) && /Lecture seule/.test(await r.page.innerText('#st-k1 .panel')));
  await r.page.click('[data-a="wlfill"][data-id="k1"]'); await r.page.waitForTimeout(150);
  tk = await r.page.innerText('#st-k1');
  check('« Remplir depuis ces messages » : propositions citées tirées des seuls messages du client (4, pas les « 12 » de l’hôte), arrivée, pas de choix d’expéditeur', (await r.page.inputValue('#wa-ad-k1-0')) === '4' && /hoping to arrive in about 1hr15/.test(await r.page.inputValue('#wa-v-k1-1')) && !(await r.page.$('#st-k1 [data-a="waguest"]')) && /1 photo ou document non importé/.test(tk), tk.slice(0, 600));
  await r.page.click('[data-a="waapply"][data-id="k1"]'); await r.page.waitForTimeout(300);
  const kp = r.calls.filter((x) => x.kind === 'stay').pop();
  check('enregistrer : adultes 4 et arrivée sur le séjour de Felipe', !!kp && /id=eq\.k1/.test(kp.url) && kp.body.adults === 4 && /1hr15/.test(kp.body.details.arrival_time));
  // Relier Sara à son séjour : numéro noté sur le séjour, messages rattachés ; la carte se vide.
  await r.page.click('[data-a="tab"][data-v="jour"]'); await r.page.waitForTimeout(150);
  await r.page.selectOption('#wl-to-212600000099', 'k2'); await r.page.click('[data-a="wllink"][data-v="212600000099"]'); await r.page.waitForTimeout(400);
  const wp = r.calls.filter((x) => x.kind === 'wapatch').pop(), sp = r.calls.filter((x) => x.kind === 'stay').pop();
  check('relier : messages de Sara rattachés au séjour (client_id), numéro noté sur le séjour (il n’en avait pas), carte vidée', !!wp && /wa_messages\?id=in\.\(w5\)/.test(wp.url) && wp.body.client_id === 'k2' && !!sp && /id=eq\.k2/.test(sp.url) && sp.body.phone === '+212600000099' && !/WhatsApp sans séjour/i.test(await txt(r.page)) && !r.errs.length, { wp, sp, e: r.errs });
  await r.ctx.close();
  // Masquer
  r = await open({ tab: 'jour', villa: V, stays: S.map((x) => ({ ...x })), waNum: [{ display_phone: '+212 775 000 000', history_status: 'done' }], waMsgs: W.map((x) => ({ ...x })) });
  await r.page.waitForTimeout(300);
  await r.page.click('[data-a="wlhide"][data-v="212600000099"]'); await r.page.waitForTimeout(300);
  const hp = r.calls.filter((x) => x.kind === 'wapatch').pop();
  check('masquer : suppression douce des messages de ce numéro (deleted_at), carte vidée', !!hp && Object.keys(hp.body).join() === 'deleted_at' && !/WhatsApp sans séjour/i.test(await txt(r.page)));
  await r.ctx.close();
}

// ── 5 terdecies. Relier WhatsApp Business : bouton, SDK de Meta chargé au clic seulement, code → wa-connect ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null };
  r = await open({ villa: V });
  await r.page.waitForTimeout(200);
  check('compte non ouvert par la base (wa_connect_enabled absent) : aucune ligne WhatsApp Business dans Réglages (rien à promettre)', !(await r.page.$('[data-a="waconnect"]')) && !/WhatsApp Business/.test(await r.page.innerText('#settings')));
  await r.ctx.close();
  r = await open({ villa: { ...V, wa_connect_enabled: true } });
  await r.page.waitForTimeout(200);
  const esrc = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');
  check('compte ouvert (villa_settings.wa_connect_enabled) : « Relier » avec les identifiants publiés de l’app Meta de Stafflo, SDK pas chargé', !!(await r.page.$('#settings [data-a="waconnect"]')) && !r.reads.some((x) => x.kind === 'fbsdk') && /appId: '4788920158094935', configId: '2570136620077692'/.test(esrc) && /wa_connect_enabled&order=/.test(esrc));
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' } });
  await r.page.waitForTimeout(200);
  check('identifiants présents : « Relier » dans Réglages ; le SDK de Meta n’est PAS chargé avant le clic', !!(await r.page.$('#settings [data-a="waconnect"]')) && !r.reads.some((x) => x.kind === 'fbsdk'));
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(1200);
  const wc = r.calls.filter((x) => x.kind === 'waconnect').pop();
  const lo = await r.page.evaluate(() => ({ init: window.__fbInit, login: window.__fbLogin }));
  check('clic : SDK chargé, FB.init (app, v25.0), FB.login (configuration, code, coexistence)', r.reads.some((x) => x.kind === 'fbsdk') && lo.init && lo.init.appId === '123456' && lo.init.version === 'v25.0' && lo.login.config_id === '654321' && lo.login.response_type === 'code' && lo.login.extras.featureType === 'whatsapp_business_app_onboarding', lo);
  check('code et identifiants du compte (message de facebook.com) envoyés à wa-connect avec la session ; « relié » affiché', !!wc && wc.body.code === 'CODE1' && wc.body.waba_id === '5550001' && wc.body.phone_number_id === '106540352242922' && wc.auth === 'Bearer tok' && /WhatsApp Business relié : \+212 600-000111/.test(await r.page.innerText('#toastHost')) && !r.errs.length, { wc, e: r.errs });
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' }, fbEvil: true });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(4000);
  const we = r.calls.filter((x) => x.kind === 'waconnect').pop();
  check('un message qui ne vient pas de facebook.com est ignoré (pas d’identifiants volés), erreur affichée', !!we && !we.body.waba_id && /Connexion impossible/.test(await r.page.innerText('#settings')));
  await r.ctx.close();
  r = await open({ villa: V, waNum: [{ display_phone: '+212 600-000111', history_status: 'syncing', history_progress: 55 }] });
  await r.page.waitForTimeout(200);
  check('relié : « Relié : +212 600-000111 · historique 55 % »', /Relié : \+212 600-000111 · historique 55 %/.test(await r.page.innerText('#settings')));
  await r.ctx.close();
}

// ── 6. Commande du client (livret) : visible, à confirmer, chiffre « extras commandés » ────
const ORD = { items: [{ id: 'm1', kind: 'meal', n: ['Dîner', 'Dinner'], q: 2, unit: 850, sub: 1700 }, { id: 'x0', kind: 'extra', n: ['Transfert aéroport', 'Airport transfer'], q: 1, unit: 400, sub: 400 }], total: 2100, cur: 'MAD', at: new Date(Date.now() - 3600e3).toISOString() };
r = await open({ tab: 'jour', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT },
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(12), departure: iso(15), adults: 8, booking_status: 'confirmed', source: 'airbnb', nat: 'France', phone: '+33600000000', details: { guest_orders: ORD } }] });
await r.page.waitForTimeout(200);
check('Jour › À faire : « Confirmer la commande du client » en tête, même à 12 jours de l’arrivée', /Confirmer la commande du client/.test(await txt(r.page)) && !r.errs.length, r.errs);
await r.page.click('[data-a="goto"][data-v="order"]'); await r.page.waitForTimeout(150);
let tx6 = await txt(r.page);
check('Séjours : chiffre « Extras commandés par vos clients · 1 séjour — 2 100 MAD » et ligne de commande sur le séjour', /Extras commandés par vos clients · 1 séjour\s*2\s?100 MAD/.test(tx6) && /Commande du client · [^:]+: 2 × Dîner · 1 × Transfert aéroport — 2\s?100 MAD/.test(tx6), tx6.slice(0, 600));
await r.page.click('[data-a="ordok"][data-id="s1"]'); await r.page.waitForTimeout(250);
const okc = r.calls.filter((c) => c.kind === 'stay').pop();
check('« Commande confirmée au client » → details.orderConfirmedAt, la commande reste, rien d’autre', !!okc && Object.keys(okc.body).join() === 'details' && !!okc.body.details.orderConfirmedAt && okc.body.details.guest_orders.total === 2100);
await r.ctx.close();
r = await open({ tab: 'jour', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT },
  stays: [{ id: 's1', name: 'Ana Ruiz', arrival: iso(12), departure: iso(15), adults: 8, booking_status: 'confirmed', source: 'airbnb', nat: 'France', details: { guest_orders: ORD, orderConfirmedAt: new Date().toISOString() } }] });
await r.page.waitForTimeout(200);
check('commande confirmée : plus dans « À faire » ; une nouvelle commande du client la remet', !/Confirmer la commande du client/.test(await txt(r.page)));
await r.ctx.close();

// ── 7. Extras à commander : saisis dans l'éditeur, prix numérique, devise de la villa ──
r = await open({ villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' } } } });
await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
await r.page.fill('#fe-VILLA\\.currency', '€');
await r.page.click('[data-a="feadd"][data-v="EXTRAS"]'); await r.page.waitForSelector('[data-fe="EXTRAS.0.n.0"]');
await r.page.fill('[data-fe="EXTRAS.0.n.0"]', 'Transfert aéroport'); await r.page.fill('#fe-EXTRAS\\.0\\.price', '40'); await r.page.fill('[data-fe="EXTRAS.0.unit.0"]', 'par trajet');
await r.page.click('[data-a="feadd"][data-v="EXTRAS"]'); // rangée laissée vide : ignorée
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const s7 = r.calls.filter((c) => c.kind === 'PATCH').pop(), h7 = s7 && s7.body.house_facts;
check('extras : enregistrés avec prix numérique et unité, rangée vide ignorée, devise sur la villa', !!h7 && h7.VILLA.currency === '€' && h7.EXTRAS.length === 1 && h7.EXTRAS[0].price === 40 && h7.EXTRAS[0].n[0] === 'Transfert aéroport' && h7.EXTRAS[0].unit[0] === 'par trajet' && !r.errs.length, h7 && h7.EXTRAS);
await r.ctx.close();

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
