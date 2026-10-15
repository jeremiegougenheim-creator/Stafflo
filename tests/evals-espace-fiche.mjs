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

async function open({ villa, staff = [], ai = null, stays = [], links = [], regs = [], regFn = null, inbound = [], inMails = [], emailIn = false, tab = 'maison', width = 390 } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR', viewport: { width, height: 900 } });
  const calls = [];
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
    if (u.includes('/rest/v1/crm_clients') && m === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'insert', body: b, prefer: req.headers().prefer }); stays.push({ ...b }); return json([b], 201); }
    if (u.includes('/rest/v1/crm_clients') && m === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'stay', url: u, body: b }); const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || ''); const row = stays.find((x) => String(x.id) === id) || stays[0]; if (row) Object.assign(row, b); return json([{ ...row }]); }
    if (u.includes('/rest/v1/crm_clients')) return json(stays);
    if (u.includes('/rest/v1/')) return json([]);
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(([s, on]) => { localStorage.setItem('stafflo_session', JSON.stringify(s)); localStorage.setItem('stafflo_espace_lang', 'fr'); if (on) localStorage.setItem('stafflo_email_in', 'on'); }, [SESSION, emailIn]);
  await page.goto(`http://127.0.0.1:${PORT}/espace.html#${tab}`);
  await page.waitForSelector(tab === 'maison' ? '[data-a="feopen"]' : 'article, .card', { timeout: 8000 });
  return { page, ctx, calls, errs };
}
const txt = (page) => page.evaluate(() => document.getElementById('main').innerText);
const unfold = (page) => page.evaluate(() => { document.querySelectorAll('details.fold').forEach((d) => { d.open = true; }); }); // l'utilisateur déplie la section avant d'y écrire

// ── 1. Compte neuf : fiche vide, remplie ici, sauvegardée sur sa ligne ────────────────
let r = await open({ villa: { villa_name: 'Riad Zina', city: 'Marrakech', owner_name: 'nadia', house_facts_ref: null, house_facts: null }, staff: [{ name: 'Omar', role: 'gardien', wa: '+212600000000' }] });
check('compte neuf : 0 erreur, bouton « Remplir la fiche maison », plus de « demandez-le à Claude »', !r.errs.length && /Remplir la fiche maison/.test(await txt(r.page)) && !/demandez-le à Claude/.test(await txt(r.page)), r.errs);
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name');
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
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name');
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(200);
check('sans nom de villa : message, aucun envoi', !r.calls.length && /Indiquez le nom de la villa/.test(await r.page.evaluate(() => document.getElementById('toastHost').innerText)));
// Compte sans ligne villa_settings : la sauvegarde crée la ligne (clé neutre), jamais une clé dérivée du nom
await r.page.fill('#fe-VILLA\\.name', 'Villa Test');
await r.ctx.close();
r = await open({ villa: null });
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name');
await r.page.fill('#fe-VILLA\\.name', 'Villa Test'); await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const ins = r.calls.filter((c) => c.kind === 'POST')[0];
check('sans ligne villa_settings : PATCH vide puis création avec owner_id et villa_key = villa_<id>', !!r.calls.filter((c) => c.kind === 'PATCH').length && !!ins && ins.body.owner_id === UID && ins.body.villa_key === 'villa_' + UID && ins.body.house_facts_ref === 'villa-facts.js');
await r.ctx.close();

// ── 3. Pilote : une modification ne touche que ce qui a changé, QR conservé ───────────
r = await open({ villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT } });
check('fiche en place : bouton « Modifier la fiche maison »', /Modifier la fiche maison/.test(await txt(r.page)));
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
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
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('[data-fe="RULES.0.1"]', { state: 'attached' }); await unfold(r.page);
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
  await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
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
await r.page.click('[data-a="feopen"]'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
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
