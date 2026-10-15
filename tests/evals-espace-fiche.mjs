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

async function open({ villa, staff = [], ai = null, stays = [], tab = 'maison' } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR', viewport: { width: 390, height: 844 } });
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
    if (u.includes('/rest/v1/crm_clients') && m === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'stay', url: u, body: b }); return json([{ ...stays[0], ...b }]); }
    if (u.includes('/rest/v1/crm_clients')) return json(stays);
    if (u.includes('/rest/v1/')) return json([]);
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript((s) => { localStorage.setItem('stafflo_session', JSON.stringify(s)); localStorage.setItem('stafflo_espace_lang', 'fr'); }, SESSION);
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
check('pilote : pas d’extras ajoutés en silence, pas de devise inventée', !!got && !('EXTRAS' in got) && !('currency' in got.VILLA));
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
