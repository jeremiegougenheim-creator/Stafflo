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
const PDFLib = require(path.join(root, 'assets/vendor/pdf-lib-1.17.1.min.js'));
const PDF1 = Buffer.from(await (async () => { const d = await PDFLib.PDFDocument.create(); d.addPage([200, 300]); return d.save(); })());
const JPG1 = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
let SIGNED_DELAY = 0; // ms avant de servir un fichier signé (préparation longue du PDF)
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

async function open({ villa, staff = [], ai = null, stays = [], links = [], regs = [], regFn = null, inbound = [], inMails = [], emailIn = false, tab = 'maison', width = 390, bill = null, sync = [], once = false, files = [], waNum = [], waMsgs = [], waMeta = null, fbEvil = false, fbMode = 'ok', rvReq = [], opens = [], rvMails = [], ical = [], icalRun = [], icalFn = null, teamLinks = [], reports = [], share = false, clock = false, vis = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR', viewport: { width, height: 900 } });
  const calls = [], reads = [];
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url(), m = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(b) });
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    if (m === 'OPTIONS') return json({}, 204);
    if (u.includes('/functions/v1/ai-proxy')) { calls.push({ kind: 'ai', body: JSON.parse(req.postData() || '{}') }); return json(ai ? ai(JSON.parse(req.postData() || '{}')) : { text: '' }); }
    if (u.includes('/rest/v1/villa_settings')) {
      if (m === 'PATCH' || m === 'POST') { const vb = JSON.parse(req.postData() || '{}'); calls.push({ kind: m, url: u, body: vb }); if (villa && vb.ical_feeds) villa.ical_feeds = vb.ical_feeds; return json(villa ? [{ id: 'vs1' }] : []); }
      return json(villa ? [villa] : []);
    }
    if (u.includes('/rest/v1/staff?')) return json(staff);
    if (u.includes('/rest/v1/livret_links')) return json(links);
    if (u.includes('/rest/v1/staff_links')) { if (m === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'eqcreate', body: b }); return json([{ id: 'nl1', ...b, created_at: new Date().toISOString() }], 201); } return json(teamLinks); }
    if (u.includes('/rest/v1/staff_link_opens')) { reads.push({ kind: 'opens', url: decodeURIComponent(u) }); return json(opens); }
    if (u.includes('/rest/v1/staff_reports')) { if (m === 'PATCH') { calls.push({ kind: 'seen', url: u }); return json([{}]); } return json(reports); }
    if (u.includes('/rest/v1/guest_registrations')) return json(regs);
    if (u.includes('/rest/v1/inbound_addresses')) return json(inbound);
    if (u.includes('/rest/v1/rpc/inbound_address')) { calls.push({ kind: 'inaddr' }); return json('in-abcdefghij12@stafflo.app'); }
    if (u.includes('/rest/v1/email_inbox') && u.includes('source=eq.email_in')) return json(inMails);
    if (u.includes('/rest/v1/email_inbox') && decodeURIComponent(u).includes('/hosting/reviews/')) { reads.push({ kind: 'rvreq', url: decodeURIComponent(u) }); return json(rvReq); }
    if (u.includes('/rest/v1/email_inbox') && u.includes('client_id=eq.')) { reads.push({ kind: 'rvmails', url: decodeURIComponent(u) }); return json(rvMails); }
    if (u.includes('/functions/v1/guest-registrations')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'regfn', body: b, auth: req.headers().authorization }); return json(regFn ? regFn(b) : { reg: null }); }
    if (u.includes('/rest/v1/rpc/billing_status')) return json(bill || []);
    if (u.includes('/rest/v1/wa_numbers')) return json(waNum);
    if (u.startsWith('https://connect.facebook.net/')) {
      reads.push({ kind: 'fbsdk', url: u });
      if (fbMode === 'block') return route.abort('blockedbyclient');
      const ev = (origin, data) => `window.dispatchEvent(new MessageEvent('message', { origin: ${JSON.stringify(origin)}, data: ${JSON.stringify(JSON.stringify(data))} }));`;
      const fin = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '5550001', phone_number_id: '106540352242922' } };
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.FB = { init: function (o) { window.__fbInit = o; }, login: function (cb, o) { window.__fbLogin = o; window.__fbInClick = !!(window.event && window.event.type === 'click'); ${fbMode === 'hang' ? '' : fbMode === 'refuse' ? ev('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { error_message: "Stafflo can't onboard customers at the moment.", error_id: '1', session_id: 's' } }) : (fbEvil ? ev('https://evil.example.com', fin) : ev('https://www.facebook.com', fin)) + " cb({ authResponse: { code: 'CODE1' } });"} } }; window.fbAsyncInit && window.fbAsyncInit();` });
    }
    if (u.includes('/functions/v1/gmail-connect')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'gmconnect', body: b, auth: req.headers().authorization }); return b.code === 'GSCOPE' ? json({ error: 'scope_missing' }, 400) : json({ ok: true, email: 'riad.neuf@example.com' }); }
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
    if (u.includes('/storage/v1/object/sign/stay-files') && m === 'GET') {
      // Le fichier servi suit l'extension du chemin ; « download=nom » = pièce jointe nommée (comme Supabase)
      const pth = decodeURIComponent(u.split('?')[0]), q = new URL(u).searchParams, dlName = q.get('download');
      const ext = (pth.match(/\.([a-z0-9]+)$/i) || [])[1] || '', body = ext === 'pdf' ? PDF1 : ext === 'jpg' ? JPG1 : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      if (req.resourceType() === 'fetch') calls.push({ kind: 'sfdl', url: u });
      if (dlName !== null) calls.push({ kind: 'sfnative', url: u, name: dlName });
      const headers = { 'Access-Control-Allow-Origin': '*' }; if (dlName !== null) headers['Content-Disposition'] = 'attachment; filename="' + dlName + '"';
      const send = () => route.fulfill({ status: 200, contentType: ext === 'pdf' ? 'application/pdf' : ext === 'jpg' ? 'image/jpeg' : 'image/png', headers, body });
      return SIGNED_DELAY && req.resourceType() === 'fetch' ? new Promise((ok) => setTimeout(ok, SIGNED_DELAY)).then(send) : send();
    }
    if (u.includes('/storage/v1/object/sign/stay-files')) { const b = JSON.parse(req.postData() || '{}'); calls.push({ kind: 'sign', body: b, auth: req.headers().authorization }); return json(b.paths.map((p) => ({ path: p, signedURL: '/object/sign/stay-files/' + p + '?token=t', error: null }))); }
    if (u.includes('/storage/v1/object/stay-files/')) { calls.push({ kind: 'upload', url: u, type: req.headers()['content-type'], auth: req.headers().authorization, size: (req.postDataBuffer() || Buffer.alloc(0)).length }); return json({ Key: 'k' }); }
    if (u.includes('/rest/v1/ical_events')) {
      if (m === 'PATCH') { calls.push({ kind: 'icpatch', url: decodeURIComponent(u), body: JSON.parse(req.postData() || '{}') }); return json([{}]); }
      reads.push({ kind: 'icget', url: decodeURIComponent(u) }); return json(ical);
    }
    if (u.includes('/rest/v1/sync_runs') && u.includes('source=eq.ical')) return json(icalRun);
    if (u.includes('/functions/v1/ical-sync')) { calls.push({ kind: 'icsync', auth: req.headers().authorization }); const x = icalFn ? icalFn() : { status: 200, body: { ok: true, errors: [] } }; return json(x.body, x.status); }
    if (u.includes('/rest/v1/sync_runs')) { reads.push({ kind: 'sync' }); return json(sync); }
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
  await page.addInitScript(([s, on, one, wm, sh]) => { if (one) { if (sessionStorage.getItem('__init')) return; sessionStorage.setItem('__init', '1'); } localStorage.setItem('stafflo_session', JSON.stringify(s)); localStorage.setItem('stafflo_espace_lang', 'fr'); if (on) localStorage.setItem('stafflo_email_in', 'on'); if (wm) localStorage.setItem('stafflo_wa_meta', JSON.stringify(wm));
    // share : un téléphone qui propose la feuille de partage (navigator.share, fichiers compris) ; ce qui est partagé est noté dans window.__shared
    if (sh) { window.__shared = []; navigator.share = function (d) { window.__shared.push({ text: d.text || '', title: d.title || '', files: (d.files || []).map(function (f) { return { name: f.name, type: f.type, size: f.size }; }) }); return Promise.resolve(); }; navigator.canShare = function () { return true; }; } }, [clock ? { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 8 * 3600 } : SESSION, emailIn, once, waMeta, share]); // horloge avancée : une session qui couvre le saut
  // clock : horloge de la page simulée (onglet laissé des heures) ; vis : visibilité de l'onglet pilotée par window.__vis
  if (clock) await page.clock.install({ time: new Date() });
  if (vis) await page.addInitScript(() => { Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__vis || 'visible'; } }); });
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
check('éditeur : rubrique « Brunch (sur demande) » parmi les menus, entre petit-déjeuner et goûter', !!(await r.page.$('[data-a="feadd"][data-v="BRUNCH"]')) && /Petit-déjeuner[\s\S]*Brunch \(sur demande\)[\s\S]*Goûter/.test(await txt(r.page)));
await r.page.click('[data-a="feadd"][data-v="BRUNCH"]'); await r.page.fill('[data-fe="BRUNCH.0.0"]', 'Msemen et pain marocain'); await r.page.fill('[data-fe="BRUNCH.0.1"]', 'Msemen and Moroccan bread');
await r.page.fill('#fe-VILLA\\.address', 'Derb Sidi Bouloukat, Marrakech');
await r.page.fill('#fe-VILLA\\.pin\\.lat', '31.62'); await r.page.fill('#fe-VILLA\\.pin\\.lng', '-7.98');
await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
const save = r.calls.filter((c) => c.kind === 'PATCH')[0];
check('enregistrement : PATCH villa_settings sur la ligne du compte (owner_id), house_facts + drapeau « fiche en place »', !!save && /villa_settings\?owner_id=eq\.1111/.test(save.url) && save.body.house_facts_ref === 'villa-facts.js' && save.body.house_facts && save.body.house_facts.VILLA.name === 'Riad Zina');
const hf = save && save.body.house_facts;
check('anglais vide → reste vide en base (jamais traduit en silence) ; GPS typé ; équipe gardée', !!hf && hf.PRACTICAL.length === 1 && hf.PRACTICAL[0][0].startsWith('Arrivée et départ') && hf.PRACTICAL[0][1] === '' && hf.RULES[0][1] === '' && hf.VILLA.pin.lat === 31.62 && hf.VILLA.pin.lng === -7.98 && hf.TEAM[0].name === 'Omar' && hf.TEAM[0].phone === '+212600000000');
check('brunch enregistré en paire [fr, en] dans la fiche', !!hf && Array.isArray(hf.BRUNCH) && hf.BRUNCH.length === 1 && hf.BRUNCH[0][0] === 'Msemen et pain marocain' && hf.BRUNCH[0][1] === 'Msemen and Moroccan bread', hf && hf.BRUNCH);
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
check('fiche en place : « Voir mon livret » ouvre livret.html avec la session du propriétaire (18/10)', (await r.page.getAttribute('#main a[href="livret.html?lang=fr"]', 'target')) === '_blank' && /Voir mon livret/.test(await txt(r.page)));
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
const iso = (d) => { const x = new Date(Date.now() + d * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }; // date locale, comme la page (todayNum) — jamais l’UTC
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
// 18/10 — « au Riad Zina », jamais « à le Riad Zina » ; « à la Villa … » inchangé
r = await open({ tab: 'sejours', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: ZINA }, links: [{ client_id: 's1', token: TK }],
  stays: [{ id: 's1', name: 'Léa Martin', arrival: iso(5), departure: iso(8), adults: 2, booking_status: 'confirmed', source: 'direct', nat: 'France', phone: '+33611111111', details: {} }] });
await r.page.waitForTimeout(250);
{ const t = await r.page.$('[data-a="toggle"][data-id="s1"]'); if (t) { await t.click(); await r.page.waitForTimeout(100); } }
await r.page.click('[data-a="panel"][data-v="livret"][data-id="s1"]'); await r.page.waitForSelector('#tx-s1');
check('Msg livret FR, villa « Riad Zina » : « votre séjour au Riad Zina »', /Voici le livret de votre séjour au Riad Zina \(/.test(await r.page.inputValue('#tx-s1')) && !/à le /.test(await r.page.inputValue('#tx-s1')), (await r.page.inputValue('#tx-s1')).slice(0, 120));
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
  check('calendrier : nuits libres à venir comptées depuis les séjours', /nuits? libres? ce mois-ci|Plus aucune nuit libre/.test(await txt(r.page)));
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
  check('Gmail : « Reconnecter » ici (bouton, plus de détour par l’app complète) ; iCal aussi ici depuis le 17/10', !!(await r.page.$('#settings [data-a="gmconnect"]')) && !(await r.page.$('#settings a[href="app.html?open=gmail"]')) && !(await r.page.$('#settings a[href="app.html?open=settings"]')) && !!(await r.page.$('#settings [data-a="icadd"]')));
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
  check('Gmail pas relié : « lecture seule » dit ce que Stafflo fait de la boîte', /Lecture seule : Stafflo lit vos emails Airbnb, n’envoie et ne supprime rien/.test(ts));
  check('essai en cours : rien en tête de Jour', !(await r.page.$('#main [data-a="billcheckout"]')) || !/abonnez-vous/.test(await txt(r.page)));
  await r.ctx.close();
  // 17/10 — essai terminé (la base refuse les modifications) : dit en tête de Jour, avant le premier « Enregistrement impossible »
  r = await open({ tab: 'jour', villa: V, bill: { entitled: false, status: 'trial_expired', trial_ends_at: iso(-2) + 'T10:00:00Z' } });
  await r.page.waitForTimeout(200);
  const tj0 = await txt(r.page);
  check('essai terminé : carte en tête de Jour — « Essai terminé · … abonnez-vous » avec le bouton S’abonner', /^Essai terminé · Vos données restent lisibles/m.test(tj0.replace(/\n/g, ' ').replace(/MISE EN ROUTE.*$/, '')) || /Essai terminé · Vos données restent lisibles ; pour modifier un séjour, la fiche ou envoyer un livret, abonnez-vous\./.test(tj0), tj0.slice(0, 300));
  check('essai terminé : le bouton S’abonner est dans cette carte, avant « Mise en route »', tj0.indexOf('S’abonner') > -1 && tj0.indexOf('S’abonner') < tj0.indexOf('MISE EN ROUTE'));
  await r.ctx.close();
  // 18/10 — essai qui se termine dans 3 jours au plus : le prix et « S'abonner » en tête de Jour, avant la coupure
  r = await open({ tab: 'jour', villa: V, bill: { entitled: true, status: 'trialing', trial_ends_at: iso(2) + 'T10:00:00Z' } });
  await r.page.waitForTimeout(200);
  const tj1 = await txt(r.page);
  check('essai : 2 jours restants → carte douce en tête de Jour avec le prix et S’abonner, sans parler de données bloquées', /Essai : 2 jours restants · Pour continuer après l’essai : 79 € par mois, résiliable chaque mois\./.test(tj1) && !/restent lisibles/.test(tj1) && tj1.indexOf('S’abonner') < tj1.indexOf('MISE EN ROUTE'), tj1.slice(0, 300));
  await r.ctx.close();
  r = await open({ tab: 'jour', villa: V, bill: { entitled: true, status: 'trialing', trial_ends_at: iso(4) + 'T10:00:00Z' } });
  await r.page.waitForTimeout(200);
  check('essai : 4 jours restants → rien en tête de Jour', !/Pour continuer après l’essai/.test(await txt(r.page)));
  await r.ctx.close();
  r = await open({ villa: { ...V, gmail: null }, bill: { entitled: true, status: 'comp' } });
  await r.page.waitForTimeout(200);
  // Relier Gmail depuis l'Espace : fenêtre Google (lecture seule), retour par la page déjà déclarée, code → gmail-connect
  await r.page.evaluate(() => { window.__opens = []; window.open = (u, n) => { window.__opens.push({ u, n }); return { closed: false }; }; });
  await r.page.click('#settings [data-a="gmconnect"]'); await r.page.waitForTimeout(100);
  const go = await r.page.evaluate(() => window.__opens[0]);
  const gq = go ? new URL(go.u).searchParams : new URLSearchParams();
  check('clic : fenêtre de consentement Google — lecture seule, code + jeton de rafraîchissement, retour sur app.html?oauth_callback=1, état tiré au hasard', !!go && /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(go.u) && gq.get('client_id') === '657823663741-b34rdmlb08obva72vcibt34mp49iqlom.apps.googleusercontent.com' && /\/app\.html\?oauth_callback=1$/.test(gq.get('redirect_uri')) && gq.get('response_type') === 'code' && gq.get('access_type') === 'offline' && gq.get('prompt') === 'consent' && gq.get('scope').split(' ').includes('https://www.googleapis.com/auth/gmail.readonly') && !/gmail\.(send|modify|compose)|mail\.google\.com/.test(gq.get('scope')) && /^espace\.[0-9a-f]{24}$/.test(gq.get('state') || '') && /Connexion…/.test(await r.page.innerText('#settings')), go);
  await r.page.evaluate((st) => { window.postMessage({ type: 'stafflo_oauth_code', code: 'GBAD', state: st + 'x' }, location.origin); }, gq.get('state')); await r.page.waitForTimeout(300);
  check('un code avec un autre état est ignoré (rien envoyé)', !r.calls.some((x) => x.kind === 'gmconnect'));
  await r.page.evaluate((st) => { window.postMessage({ type: 'stafflo_oauth_code', code: 'G1', state: st }, location.origin); }, gq.get('state')); await r.page.waitForTimeout(600);
  const gc = r.calls.filter((x) => x.kind === 'gmconnect').pop();
  check('le bon code → gmail-connect avec la session, la même page de retour ; « Gmail relié » affiché, rechargé depuis la base', !!gc && gc.body.code === 'G1' && gc.body.redirect_uri === gq.get('redirect_uri') && gc.auth === 'Bearer tok' && /Gmail relié : riad\.neuf@example\.com/.test(await r.page.innerText('#toastHost')) && !r.errs.length, { gc, e: r.errs });
  await r.page.evaluate((st) => { window.postMessage({ type: 'stafflo_oauth_code', code: 'G1', state: st }, location.origin); }, gq.get('state')); await r.page.waitForTimeout(300);
  check('le même code rejoué : ignoré (état consommé)', r.calls.filter((x) => x.kind === 'gmconnect').length === 1);
  // Case « lire vos emails » décochée chez Google
  await r.page.click('#settings [data-a="gmconnect"]'); await r.page.waitForTimeout(100);
  const st2 = await r.page.evaluate(() => new URL(window.__opens[1].u).searchParams.get('state'));
  await r.page.evaluate((st) => { window.postMessage({ type: 'stafflo_oauth_code', code: 'GSCOPE', state: st }, location.origin); }, st2); await r.page.waitForTimeout(500);
  check('droit de lecture refusé dans la fenêtre Google → explication claire + secours par l’ancienne version', /cochez « Consulter vos messages et vos paramètres de messagerie »/.test(await r.page.innerText('#settings')) && !!(await r.page.$('#settings .err a[href="app.html?open=gmail"]')));
  // Fenêtre bloquée par le navigateur
  await r.page.evaluate(() => { window.open = () => null; });
  await r.page.click('#settings [data-a="gmconnect"]'); await r.page.waitForTimeout(100);
  check('fenêtre bloquée → message, rien envoyé', /La fenêtre Google a été bloquée/.test(await r.page.innerText('#settings')) && r.calls.filter((x) => x.kind === 'gmconnect').length === 2);
  await r.ctx.close();
  r = await open({ villa: V, sync: [{ finished_at: new Date(Date.now() - 3 * 3600e3).toISOString(), ok: true }], bill: [] });
  await r.page.waitForTimeout(200);
  ts = await r.page.innerText('#settings');
  check('synchro Gmail ancienne (3 h) → signalée ; état de l’abonnement illisible → rien affiché (jamais un statut inventé)', /pas de synchronisation récente/.test(ts) && !/Abonnement/.test(ts));
  await r.ctx.close();
  // Fausse alerte du 19/10 : la synchro tournait toutes les 10 min, mais l'onglet de l'Espace était resté des heures
  // en arrière-plan ; au retour, un passage « vieux de 5 min » comparé à l'heure actuelle → « pas de synchronisation
  // récente — reconnectez Gmail » et bouton doré. L'âge se juge à la lecture de la base ; au retour sur l'onglet, la base est relue.
  {
    const SYNC = [{ finished_at: new Date(Date.now() - 5 * 60000).toISOString(), ok: true }];
    r = await open({ villa: V, sync: SYNC, bill: [], clock: true, vis: true });
    await r.page.waitForTimeout(200);
    let st = await r.page.innerText('#settings');
    check('onglet frais, synchro de 5 min : « synchronisé il y a 5 min », pas d’alerte', /synchronisé il y a 5 min/.test(st) && !/pas de synchronisation récente/.test(st) && !r.errs.length, { st: st.slice(0, 300), errs: r.errs });
    const n0 = r.reads.filter((x) => x.kind === 'sync').length;
    await r.page.evaluate(() => { window.__vis = 'hidden'; });
    await r.page.clock.fastForward('03:00:00'); // trois heures en arrière-plan : le minuteur de 5 min ne relit rien
    await r.page.click('#tabs [data-a="tab"][data-v="maison"]'); await r.page.waitForTimeout(150); // un geste qui redessine sans relire
    st = await r.page.innerText('#settings');
    const chip = await r.page.evaluate(() => { const n = document.getElementById('net'); return { t: n.textContent, off: n.classList.contains('off') }; });
    const gold = await r.page.evaluate(() => { const b = document.querySelector('#settings [data-a="gmconnect"]'); return !!(b && b.classList.contains('gold')); });
    check('onglet resté 3 h en arrière-plan : PAS de « pas de synchronisation récente », ni bouton doré, ni puce « en retard » — la base n’a pas été relue en arrière-plan',
      !/pas de synchronisation récente/.test(st) && !gold && !chip.off && !/en retard/.test(chip.t) && r.reads.filter((x) => x.kind === 'sync').length === n0, { st: st.slice(0, 300), chip, gold, reads: r.reads.filter((x) => x.kind === 'sync').length - n0 });
    // Retour sur l'onglet : la base est relue tout de suite (passage d'il y a 4 min à l'heure de la page)
    const pageNow = await r.page.evaluate(() => Date.now());
    SYNC[0].finished_at = new Date(pageNow - 4 * 60000).toISOString();
    await r.page.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await r.page.waitForTimeout(500);
    st = await r.page.innerText('#settings');
    check('retour sur l’onglet : la base est relue aussitôt → « synchronisé il y a 4 min »', r.reads.filter((x) => x.kind === 'sync').length === n0 + 1 && /synchronisé il y a 4 min/.test(st) && !r.errs.length, { reads: r.reads.filter((x) => x.kind === 'sync').length - n0, st: st.slice(0, 300), errs: r.errs });
    await r.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await r.page.waitForTimeout(300);
    check('retour répété dans la minute : pas de relecture en double', r.reads.filter((x) => x.kind === 'sync').length === n0 + 1);
    await r.ctx.close();
    // Une vraie panne reste signalée, même relue à l'instant : dernier passage il y a 2 h à la lecture
    r = await open({ villa: V, sync: [{ finished_at: new Date(Date.now() - 2 * 3600e3).toISOString(), ok: true }], bill: [], vis: true });
    await r.page.waitForTimeout(200);
    check('vraie panne (dernier passage il y a 2 h à la lecture) : toujours signalée, bouton doré', /pas de synchronisation récente/.test(await r.page.innerText('#settings')) && await r.page.evaluate(() => !!document.querySelector('#settings [data-a="gmconnect"].gold')));
    await r.ctx.close();
  }
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
  await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]'); await r.page.waitForSelector('#wa-paste-w1');
  check('sans téléphone : le panneau dit qu’il manque le numéro et propose quand même l’import', /remplir le séjour depuis la conversation/i.test(await r.page.innerText('#st-w1')) && !(await r.page.$('#st-w1 .panel a[href^="https://wa.me/"]')));
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
  // 17/10/2026 — messages copiés depuis WhatsApp Mac : « Read more » coupe les longs messages ; une commande de
  // repas sur plusieurs lignes (« jeudi midi », « kebabs & frites », desserts) ; réimporter ne double rien.
  {
    const RM = '‎Read more';
    const PASTE = [`[${dmy(-11)}, 22:53:43] Nadia: Bonjour Paul,`, '', 'Aucun dérangement, au contraire. Merci pour vos réponses : votr…', RM,
      `[${dmy(-6)}, 08:15:53] Paul Marchal Marrakech: Nous venons de nous mettre tous d’accord : `,
      'Pour le mercredi soir, pas d’entrées mais un plat commun de tajine de Kefta avec en accompagnement de la semoule si possible. ',
      'En dessert: assortiment de pâtisseries marocaines.', 'Pour le jeudi midi: pas d’entrées. ', 'Nous voudrions tous des kebabs marocains & frites. ',
      'En dessert, pastilla au lait. ', 'J’imagine que le tarif sera don…', RM,
      `[${dmy(-6)}, 11:44:32] Nadia: Bonjour Paul,`, '', 'Mercredi 21, dîner vers 19h30', '•⁠  ⁠Kebabs marocains et frites…', RM,
      `[${dmy(-5)}, 04:36:57] Paul Marchal Marrakech: Bonjour Nadia `, 'Sur les allergies alimentaires ras.', 'Notre vol retour est à 9h vendredi. On partira donc très tôt de la villa (6h30).',
      'Pour les boissons on aura besoin :', 'Eau plate (12 bouteilles)', '12 bières', 'On souhaite organiser un massage pour les filles … pouvez-vous me donner le tarif ?',
      `[${dmy(-4)}, 10:43:44] Paul Marchal Marrakech: Bonjour,`, 'Je viens de vous faire un virement de 420 €.'].join('\n');
    const OLD = 'Pour le mercredi soir, pas d’entrées mais un plat commun de tajine de Kefta avec en accompagnement de la semoule si possible.';
    r = await open({ tab: 'sejours', villa: V, stays: [{ id: 'w1', name: 'Paul Marchal', arrival: iso(3), departure: iso(7), adults: 10, booking_status: 'confirmed', source: 'Airbnb', details: {}, meals: OLD, notes: 'Famille du sud\nWhatsApp : Sur les allergies alimentaires ras.' }] });
    await r.page.waitForTimeout(250);
    await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]');
    await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]'); await r.page.waitForSelector('#wa-paste-w1');
    await r.page.fill('#wa-paste-w1', PASTE); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(150);
    const vals = await r.page.$$eval('#st-w1 .wa-p textarea', (ts) => ts.map((t) => t.value)), mv = vals.filter((v) => /tajine/.test(v))[0] || '';
    check('repas copiés : toute la commande — mercredi soir, desserts, jeudi midi, « kebabs & frites » — sans l’introduction ni la phrase coupée',
      /^Pour le mercredi soir, .* tajine de Kefta .* En dessert: assortiment de pâtisseries marocaines\. Pour le jeudi midi: pas d’entrées\. Nous voudrions tous des kebabs marocains & frites\. En dessert, pastilla au lait\.$/.test(mv) && !/Nous venons|J’imagine/.test(mv), vals);
    check('« Read more » : messages coupés comptés et signalés (export conseillé), « Read more » absent du texte', /3 messages coupés par WhatsApp/.test(await r.page.innerText('#st-w1')) && !vals.some((v) => /Read more/.test(v)));
    check('boissons et virement ne sont pas des repas ; la question sur le massage n’est pas une demande', !/bières|boissons/.test(mv) && !vals.some((v) => /virement|massage/.test(v)));
    const kinds = await r.page.$$eval('#st-w1 .wa-p', (ps) => ps.map((p) => p.querySelector('b').innerText + '=' + (p.querySelector('[id^="wa-v-"]') || {}).value));
    const depV = (kinds.find((x) => /^Départ=/.test(x)) || '').slice(7), drV = (kinds.find((x) => /^Boissons=/.test(x)) || '').slice(9);
    check('départ (17/10) : « vol retour à 9h » et « on partira (6h30) » cités tels quels — une heure dite, donc pas la date du message ; pas pris pour l’arrivée',
      depV === '« Notre vol retour est à 9h vendredi. On partira donc très tôt de la villa (6h30) »' && !kinds.some((x) => /^Arrivée=/.test(x)), kinds);
    check('boissons (17/10) : la liste entière en une proposition', drV === 'Pour les boissons on aura besoin : Eau plate (12 bouteilles), 12 bières', kinds);
    await r.page.click('[data-a="waapply"][data-id="w1"]'); await r.page.waitForTimeout(400);
    const rp = r.calls.filter((x) => x.kind === 'stay').pop();
    check('réimport : la version complète des repas remplace l’ancienne (pas de doublon), note déjà présente pas recopiée', !!rp && rp.body.meals === mv && rp.body.notes === undefined && !r.errs.length, rp && { meals: rp.body.meals, notes: rp.body.notes, errs: r.errs });
    check('enregistrer : heure de départ et boissons dans le séjour (champs de l’équipe)', !!rp && rp.body.details.departure_time === depV && rp.body.details.drinks === drV, rp && rp.body.details);
    await r.ctx.close();
  }
  // 19/10/2026 — [REGRESSION — import WhatsApp, séjour au nom du réservant, c'est sa femme qui écrit]
  // Cas réel (noms changés) : séjour « Élias », la cliente « ~Ana Martin » commande par questions polies, en plusieurs
  // messages d'affilée ; export iPhone .txt (fins de ligne mêlées \r\n / \n, U+200E, « <This message was edited> »).
  // Avant : client pas reconnu (aucun mot commun), jours des dîners perdus (« Could we do dinner on Monday 26th…? »),
  // goûter + gâteau d'anniversaire absent, boissons coupées à « Coke Zero », couchages pas proposés.
  // Interdit : toute valeur absente du texte source ; une question d'information n'est jamais une commande.
  {
    const LRM = '‎', CR = '\r';
    const T = [
      `[${dmy(-25)}, 12:55:52] ~Ana Martin: ${LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.${CR}`,
      `[${dmy(-25)}, 11:45:08] ~Ana Martin: Hi Nadia, ${CR}`, `This is Ana. We are staying at your home for a family birthday.${CR}`,
      `[${dmy(-25)}, 12:04:26] Nadia BENALI: hello Ana thank you, I will send you information by tomorrow${CR}`,
      `[${dmy(-23)}, 17:24:48] ~Ana Martin: Thank you so much! Is there anything missing off your message that’s not already in the pack?`,
      `[${dmy(-23)}, 17:25:51] ~Ana Martin: We were considering renting cars, is parking near the medina possible? I have seen online that it can be quite difficult`,
      `[${dmy(-23)}, 17:36:02] Nadia BENALI: Bedroom 4 is two single beds by default and can become a double, for dinner on arrival tell me`,
      `[${dmy(-23)}, 18:33:56] ~Ana Martin: In response to your queries: `, '',
      'That would be great for the ramp, thank you so much. I note this bedroom has a bath, does it have a shower also? ', '',
      'The bedrooms as they are made up would be perfect. There are 4 couples and then 2 siblings, who would be sharing the room with the single beds. ', '',
      'Most of the group will arrive quite late on the first day (likely after 9pm), so we won’t do dinner on arrival. ',
      `${LRM}[${dmy(-8)}, 10:16:50] ~Ana Martin: ${LRM}image omitted${CR}`,
      `[${dmy(-8)}, 10:19:35] ~Ana Martin: Hi Nadia - here are all our passports${CR}`,
      `[${dmy(-8)}, 10:32:52] ~Ana Martin: I have had a look at the pack you have sent us, and please could we do the afternoon tea by the pool on Monday 26th with a birthday cake (something either vanilla or lemon flavoured)? Would it be possible do this closer to lunch time around 2pm? ${LRM}<This message was edited>${CR}`,
      `[${dmy(-8)}, 10:33:30] ~Ana Martin: Also, can you recommend a good restaurant for dinner in the medina one evening?${CR}`,
      `[${dmy(-8)}, 10:34:16] ~Ana Martin: Could we do dinner on Monday 26th, Friday 30th and Saturday 31st? ${CR}`, `For the 3 dinners could we have: ${CR}`,
      `Starters - mechouia salad, zaalouk, pumpkin salad with cinnamon${CR}`, `Mains - fish with chermoula, lamb tajine, chicken couscous${CR}`,
      `Desserts - assorted Moroccan pastries, pastilla au lait, gazelle horns${CR}`,
      `[${dmy(-8)}, 10:35:40] ~Ana Martin: For drinks, would it be possible to have: ${CR}`, `Coke Zero${CR}`, `Iced tea ${CR}`, `Waters${CR}`, `Decaf tea and coffee${CR}`,
      `[${dmy(-8)}, 10:35:48] ~Ana Martin: Thank you so much in advance!${CR}`,
    ].join('\n');
    // Texte source « à plat » : ce contre quoi chaque valeur proposée doit se retrouver mot pour mot.
    const SRC = T.replace(/‎/g, '').replace(/\r/g, '').replace(/\s+/g, ' ');
    const literal = (v) => String(v).replace(/[«»]/g, ' ').split(/(?<=[.!?:])\s+|,\s+/).map((x) => x.trim()).filter((x) => x.length >= 3).every((x) => SRC.indexOf(x) > -1);
    const VZ = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, TEAM: [{ name: 'Omar', role: ['gardien', ''], phone: '+212600000000', brief: true }] } };
    r = await open({ tab: 'sejours', villa: VZ, stays: [{ id: 'e1', name: 'Élias', arrival: iso(5), departure: iso(12), adults: 10, children: 0, infants: 1, booking_status: 'confirmed', source: 'Airbnb', phone: '', details: {}, meals: '', notes: 'Contact : Ana (WhatsApp), épouse d’Élias.' }] });
    await r.page.waitForTimeout(250);
    await r.page.click('[data-a="toggle"][data-id="e1"]'); await r.page.click('[data-a="panel"][data-id="e1"][data-v="wa"]');
    await r.page.waitForSelector('#st-e1 input[type=file][data-file="wa"]', { state: 'attached' });
    await r.page.setInputFiles('#st-e1 input[type=file][data-file="wa"]', { name: '_chat 62.txt', mimeType: 'text/plain', buffer: Buffer.from(T, 'utf8') });
    await r.page.waitForTimeout(400);
    const who = await r.page.$eval('#st-e1 [data-a="waguest"][aria-pressed="true"]', (b) => b.innerText).catch(() => '');
    check('client deviné sans geste : « ~Ana Martin » — le séjour s’appelle « Élias », mais l’autre expéditeur est l’hôte (Nadia)', who === '~Ana Martin', who);
    const P = await r.page.$$eval('#st-e1 .wa-p', (ps) => ps.map((p) => ({ k: p.querySelector('b').innerText, v: (p.querySelector('[id^="wa-v-"]') || {}).value || '' })));
    const get = (k) => (P.find((x) => x.k === k) || {}).v || '';
    const mv = get('Repas'), dv = get('Boissons'), bv = get('Couchages'), av = get('Arrivée');
    check('repas : les jours des dîners (question polie « Could we do dinner on… ») ET le menu, dans l’ordre', /Could we do dinner on Monday 26th, Friday 30th and Saturday 31st\?/.test(mv) && /For the 3 dinners could we have:/.test(mv) && /Starters - mechouia salad, zaalouk, pumpkin salad with cinnamon/.test(mv) && /Desserts - assorted Moroccan pastries, pastilla au lait, gazelle horns/.test(mv) && mv.indexOf('Could we do dinner') < mv.indexOf('Starters'), mv);
    check('repas : le goûter + gâteau d’anniversaire envoyé 2 min avant (même rafale) — et l’heure demandée', /please could we do the afternoon tea by the pool on Monday 26th with a birthday cake \(something either vanilla or lemon flavoured\)\?/.test(mv) && /closer to lunch time around 2pm\?/.test(mv) && mv.indexOf('afternoon tea') < mv.indexOf('Could we do dinner'), mv);
    check('repas : ni « <This message was edited> », ni la demande de restaurant (« can you recommend » n’est pas une commande), ni l’ancien message « won’t do dinner on arrival »', !/edited/.test(mv) && !/recommend|restaurant/.test(mv) && !/won’t do dinner/.test(mv), mv);
    check('boissons : la liste entière annoncée par « : », sans le remerciement', dv === 'For drinks, would it be possible to have: Coke Zero, Iced tea, Waters, Decaf tea and coffee', dv);
    check('couchages (nouveau) : la phrase de la cliente, telle quelle', bv === 'There are 4 couples and then 2 siblings, who would be sharing the room with the single beds.', bv);
    check('arrivée : inchangée (« arrive quite late on the first day (likely after 9pm) »)', /arrive quite late on the first day \(likely after 9pm\)/.test(av), av);
    check('questions d’information jamais proposées : parking, douche, « anything missing », restaurant ; rien de l’hôte (« Bedroom 4… »)', !P.some((x) => /parking|shower|anything missing|recommend|Bedroom 4|by default/.test(x.v)), P);
    check('le gâteau (« birthday ») n’est pas proposé deux fois : il est dans les repas, pas en note privée', !P.some((x) => /^À noter/.test(x.k) && /birthday cake/.test(x.v)), P);
    check('zéro invention : chaque morceau de chaque valeur proposée est mot pour mot dans la conversation', P.every((x) => literal(x.v)), P.filter((x) => !literal(x.v)));
    await r.page.click('[data-a="waapply"][data-id="e1"]'); await r.page.waitForTimeout(400);
    const ep = r.calls.filter((x) => x.kind === 'stay').pop();
    check('enregistrer : repas, boissons, couchages et arrivée écrits sur le séjour ; aucun message stocké', !!ep && ep.body.meals === mv && ep.body.details.drinks === dv && ep.body.details.beds === bv && ep.body.details.arrival_time === av && ep.body.details.whatsapp && !JSON.stringify(ep.body).includes('parking') && !r.errs.length, ep && { meals: ep.body.meals, det: ep.body.details, errs: r.errs });
    await r.ctx.close();
  }
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
    `${dmy(-5)}, 10:02 - Ana Ruiz: Our return flight is AT802 on Sunday at 18:05.`,
    `${dmy(-5)}, 10:03 - Ana Ruiz: IMG-20261009-WA0001.jpg (file attached)`].join('\n');
  const Z = mkzip([{ name: 'WhatsApp Chat with Ana Ruiz.txt', data: AND, deflate: true }, { name: 'IMG-20261009-WA0001.jpg', data: 'xx', deflate: false }]);
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0], notes: null }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]');
  await r.page.setInputFiles('#st-w1 input[data-file="wa"]', { name: 'WhatsApp Chat with Ana Ruiz.zip', mimeType: 'application/zip', buffer: Z });
  await r.page.waitForSelector('#wa-ad-w1-0', { timeout: 4000 }).catch(() => {});
  tw = await r.page.innerText('#st-w1');
  check('export Android (.zip, deflate) : lu sur l’appareil, message système ignoré, 1 média non importé', /4 messages/.test(tw) && /1 photo ou document non importé/.test(tw) && !/end-to-end/.test(tw.split('Voir les')[0]), tw.slice(0, 500));
  check('« 6 people including 2 kids » → 4 adultes + 2 enfants ; vol AT801 et heure dans l’arrivée ; dîner proposé en repas', (await r.page.inputValue('#wa-ad-w1-0')) === '4' && (await r.page.inputValue('#wa-ch-w1-0')) === '2' && /^Vol AT801 · « flight AT801 landing at 16:40 »/.test(await r.page.inputValue('#wa-v-w1-1')) && /tajine/.test(await r.page.inputValue('#wa-v-w1-3')));
  check('vol retour : AT802 proposé en départ, jamais pris pour le vol d’arrivée', (await r.page.inputValue('#wa-v-w1-2')) === 'Vol AT802 · « Our return flight is AT802 on Sunday at 18:05 »' && !/AT802/.test(await r.page.inputValue('#wa-v-w1-1')), await r.page.inputValue('#wa-v-w1-2'));
  await r.ctx.close();
  // Format US (mois/jour, AM/PM) ; contact enregistré sous son numéro : le propriétaire désigne le client
  const x0 = new Date(Date.now() - 2 * 86400000), us = (x0.getUTCMonth() + 1) + '/' + x0.getUTCDate() + '/' + String(x0.getUTCFullYear()).slice(2);
  const USX = [`${us}, 3:38 PM - +33 6 00 00 00 01: we're 5 adults now`, `${us}, 3:40 PM - Nadia: Noted!`].join('\n');
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0] }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]');
  await r.page.fill('#wa-paste-w1', USX); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(100);
  // 19/10/2026 : conversation à deux, l'hôte (Nadia) et un numéro → le numéro est le client, choisi d'office (même règle
  // que « ~Lise Hickey » pour le séjour « Seán ») ; le propriétaire peut toujours en désigner un autre.
  check('contact sous son numéro, seul expéditeur autre que l’hôte : choisi d’office, propositions affichées ; les noms restent à toucher', (await r.page.$eval('[data-a="waguest"][aria-pressed="true"]', (b) => b.innerText).catch(() => '')) === '+33 6 00 00 00 01' && !!(await r.page.$('#wa-ad-w1-0')) && !!(await r.page.$('[data-a="waguest"][data-v="1"]')));
  await r.page.click('[data-a="waguest"][data-v="0"]'); await r.page.waitForTimeout(100);
  check('format US (10/13/26, 3:38 PM) : 5 adultes, heure 15:38', (await r.page.inputValue('#wa-ad-w1-0')) === '5' && /15:38/.test(await r.page.innerText('#st-w1')));
  await r.ctx.close();
  // Intention d'origine gardée : deux inconnus (groupe avec le chauffeur) → aucun choix d'office, rien proposé avant le geste.
  const USG = [`${us}, 3:38 PM - +33 6 00 00 00 01: we're 5 adults now`, `${us}, 3:39 PM - +212 6 00 00 00 02: I am the driver, I will be at the airport at 4 PM`, `${us}, 3:40 PM - Nadia: Noted!`].join('\n');
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0] }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]');
  await r.page.fill('#wa-paste-w1', USG); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(100);
  check('deux expéditeurs inconnus (groupe) : rien deviné, rien proposé tant que le propriétaire n’a pas désigné le client', /Touchez le nom du client/.test(await r.page.innerText('#st-w1')) && !(await r.page.$('#wa-ad-w1-0')) && !(await r.page.$('[data-a="waguest"][aria-pressed="true"]')));
  await r.ctx.close();
  // L'import était caché dans Modifier (16/10) : « WhatsApp » de la carte ouvre les deux gestes au même endroit
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0], phone: '+212 6 00 00 00 01' }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]');
  check('carte : « WhatsApp » est un bouton qui ouvre le panneau, plus un lien qui part droit sur wa.me', !(await r.page.$('#st-w1 .acts a[href^="https://wa.me/"]')) && !!(await r.page.$('#st-w1 .acts button[data-a="panel"][data-v="wa"]')));
  await r.page.click('#st-w1 .acts [data-a="panel"][data-v="wa"]'); await r.page.waitForSelector('#wa-paste-w1');
  const wtxt = await r.page.innerText('#st-w1'), wlink = await r.page.$('#st-w1 .panel a[href="https://wa.me/212600000001"]');
  check('panneau : « Écrire au client » (lien natif) puis « Remplir le séjour depuis la conversation » (même lecteur)', !!wlink && /écrire au client/i.test(wtxt) && /remplir le séjour depuis la conversation/i.test(wtxt) && /Exporter la discussion/.test(wtxt) && !r.errs.length, r.errs);
  await r.page.fill('#wa-paste-w1', 'Hi! We are now 3 adults and 1 baby, see you soon'); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(150);
  check('depuis la carte, l’import marche comme depuis Modifier (3 adultes, 1 enfant)', (await r.page.inputValue('#wa-ad-w1-0')) === '3' && (await r.page.inputValue('#wa-ch-w1-0')) === '1' && !r.errs.length, r.errs);
  await r.ctx.close();
  r = await open({ tab: 'sejours', villa: V, stays: [{ ...S[0] }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="w1"]'); await r.page.click('[data-a="panel"][data-id="w1"][data-v="edit"]'); await r.page.click('#st-w1 .panel [data-a="panel"][data-v="wa"]'); await r.page.waitForSelector('#wa-paste-w1');
  await r.page.fill('#wa-paste-w1', USX); await r.page.click('[data-a="waread"][data-id="w1"]'); await r.page.waitForTimeout(100);
  await r.page.click('[data-a="waguest"][data-v="0"]'); await r.page.waitForTimeout(100);
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
  // Télécharger (16/10) : WhatsApp ne joint rien par lien ; « Tout » = UN seul PDF (plusieurs téléchargements
  // enchaînés restaient en .crdownload dans Chrome), une pièce = téléchargement natif nommé par le serveur
  const dls = []; r.page.on('download', (d) => dls.push(d));
  const sign0 = r.calls.filter((x) => x.kind === 'sign').length;
  check('télécharger : un bouton par pièce et « Tout en un seul PDF (2 pièces) »', (await r.page.$$('#st-b1 .bf-it [data-a="bfdl"]')).length === 2 && /Tout en un seul PDF \(2 pièces\)/.test(await r.page.innerText('#st-b1')) && /Un seul fichier à joindre dans WhatsApp/.test(await r.page.innerText('#st-b1')));
  await r.page.click('#st-b1 button.btn[data-a="bfdl"][data-v=""]'); await r.page.waitForTimeout(2500);
  const pdf0 = dls[0], pdfDoc = pdf0 ? await PDFLib.PDFDocument.load(fs.readFileSync(await pdf0.path())) : null;
  check('un seul PDF : un téléchargement, nommé d’après le séjour, une page par photo + les pages du PDF ; liens signés refaits', dls.length === 1 && pdf0.suggestedFilename() === 'Justificatifs - Ana Ruiz - ' + iso(-2).slice(0, 10) + '.pdf' &&
    !!pdfDoc && pdfDoc.getPageCount() === 2 && r.calls.filter((x) => x.kind === 'sign').length === sign0 + 1 && r.calls.filter((x) => x.kind === 'sfdl').length === 2 &&
    /PDF dans Téléchargements/.test(await r.page.innerText('body')) && !r.errs.length, { n: dls.length, name: pdf0 && pdf0.suggestedFilename(), pages: pdfDoc && pdfDoc.getPageCount(), errs: r.errs });
  const sign1 = r.calls.filter((x) => x.kind === 'sign').length;
  await r.page.click('#st-b1 .bf-it [data-a="bfdl"][data-v="f0"]'); await r.page.waitForTimeout(800);
  const nat = r.calls.filter((x) => x.kind === 'sfnative');
  check('une pièce : téléchargement natif (download=nom), lien encore valable réutilisé, la page reste ouverte', dls.length === 2 && dls[1].suggestedFilename() === 'facture-marche.pdf' && nat.length === 1 && nat[0].name === 'facture-marche.pdf' &&
    r.calls.filter((x) => x.kind === 'sign').length === sign1 && !!(await r.page.$('#st-b1 .bf-grid')) && !r.errs.length, { nat, errs: r.errs });
  await r.page.click('#st-b1 [data-a="bfdel"][data-v="f0"]'); await r.page.waitForTimeout(300);
  const del = r.calls.filter((x) => x.kind === 'sfpatch').pop();
  check('retirer : suppression douce (deleted_at), jamais de DELETE ; la pièce disparaît', !!del && /stay_files\?id=eq\.f0/.test(del.url) && Object.keys(del.body).join() === 'deleted_at' && (await r.page.$$('#st-b1 .bf-it')).length === 1 && !r.errs.length, r.errs);
  await r.ctx.close();
  // L'iPhone nomme toutes ses photos « image.jpg » : deux pièces, deux noms ; un nom sans extension la reçoit
  const F2 = [{ id: 'g1', path: UID + '/b1/a.jpg', name: 'image.jpg', mime: 'image/jpeg', size: 9, created_at: new Date().toISOString() },
    { id: 'g2', path: UID + '/b1/b.jpg', name: 'image.jpg', mime: 'image/jpeg', size: 9, created_at: new Date().toISOString() },
    { id: 'g3', path: UID + '/b1/c.pdf', name: 'facture', mime: 'application/pdf', size: 9, created_at: new Date().toISOString() }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT }, files: F2.slice(),
    stays: [{ id: 'b1', name: 'Ana Ruiz', arrival: iso(-2), departure: iso(1), adults: 6, booking_status: 'confirmed', source: 'Airbnb', details: {} }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="b1"]'); await r.page.click('[data-a="panel"][data-id="b1"][data-v="bill"]'); await r.page.waitForTimeout(300);
  const dl2 = []; r.page.on('download', (d) => dl2.push(d));
  await r.page.click('#st-b1 .bf-it [data-a="bfdl"][data-v="g3"]'); await r.page.waitForTimeout(800);
  check('une pièce sans extension la reçoit (« facture.pdf »)', dl2.length === 1 && dl2[0].suggestedFilename() === 'facture.pdf', dl2.map((d) => d.suggestedFilename()));
  SIGNED_DELAY = 1700; // trois pièces → plus de 4 s : le clic ne compte plus, la page propose « Enregistrer le PDF »
  await r.page.click('#st-b1 button.btn[data-a="bfdl"][data-v=""]'); await r.page.waitForTimeout(800);
  const busy = /Préparation du PDF… \(\d\/3\)/.test(await r.page.innerText('#st-b1'));
  await r.page.waitForSelector('#st-b1 [data-a="bfpdfsave"]', { timeout: 15000 }).catch(() => {});
  SIGNED_DELAY = 0;
  const saveBtn = await r.page.$('#st-b1 [data-a="bfpdfsave"]'), nBefore = dl2.length;
  if (saveBtn) { await saveBtn.click(); await r.page.waitForTimeout(800); }
  const pdf2 = dl2[1], doc2 = pdf2 ? await PDFLib.PDFDocument.load(fs.readFileSync(await pdf2.path())) : null;
  check('préparation longue : « Préparation du PDF… », puis « Enregistrer le PDF » ; deux photos JPEG + un PDF = 3 pages', busy && !!saveBtn && nBefore === 1 && dl2.length === 2 && /\.pdf$/.test(pdf2.suggestedFilename()) && !!doc2 && doc2.getPageCount() === 3 &&
    !(await r.page.$('#st-b1 [data-a="bfpdfsave"]')) && !r.errs.length, { busy, save: !!saveBtn, n: dl2.length, pages: doc2 && doc2.getPageCount(), errs: r.errs });
  await r.ctx.close();
  // Partage natif (18/10) : sur un téléphone, « Partager en PDF (WhatsApp, Mail…) » → un seul fichier dans la feuille de partage, rien n'est téléchargé
  r = await open({ tab: 'sejours', share: true, villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT }, files: F2.slice(0, 2),
    stays: [{ id: 'b1', name: 'Ana Ruiz', arrival: iso(-2), departure: iso(1), adults: 6, booking_status: 'confirmed', source: 'Airbnb', details: {} }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="b1"]'); await r.page.click('[data-a="panel"][data-id="b1"][data-v="bill"]'); await r.page.waitForTimeout(300);
  const dl3 = []; r.page.on('download', (d) => dl3.push(d));
  check('partage : bouton « Partager en PDF (WhatsApp, Mail…) » quand le navigateur partage des fichiers ; « Tout en un seul PDF » reste', /Partager en PDF \(WhatsApp, Mail…\)/.test(await r.page.innerText('#st-b1')) && /Tout en un seul PDF \(2 pièces\)/.test(await r.page.innerText('#st-b1')) && /un seul PDF, directement dans l’application choisie/.test(await r.page.innerText('#st-b1')));
  await r.page.click('#st-b1 [data-a="bfshare"]'); await r.page.waitForTimeout(2500);
  const shared = await r.page.evaluate(() => window.__shared);
  check('partage : navigator.share reçoit UN fichier PDF nommé d’après le séjour, 2 pages — aucun téléchargement', shared.length === 1 && shared[0].files.length === 1 && shared[0].files[0].name === 'Justificatifs - Ana Ruiz - ' + iso(-2).slice(0, 10) + '.pdf' && shared[0].files[0].type === 'application/pdf' && shared[0].files[0].size > 500 && dl3.length === 0 && !r.errs.length, { shared, dl: dl3.length, errs: r.errs });
  await r.ctx.close();
  // Sans feuille de partage (ordinateur, Firefox) : pas de bouton, le téléchargement comme avant
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: PILOT }, files: F2.slice(0, 2),
    stays: [{ id: 'b1', name: 'Ana Ruiz', arrival: iso(-2), departure: iso(1), adults: 6, booking_status: 'confirmed', source: 'Airbnb', details: {} }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="b1"]'); await r.page.click('[data-a="panel"][data-id="b1"][data-v="bill"]'); await r.page.waitForTimeout(300);
  check('sans partage natif : ni « Partager en PDF » ni « Partager », « Un seul fichier à joindre dans WhatsApp » comme avant', !(await r.page.$('#st-b1 [data-a="bfshare"]')) && !(await r.page.$('[data-a="share"]')) && /Un seul fichier à joindre dans WhatsApp/.test(await r.page.innerText('#st-b1')) && !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── Partager (18/10) : la feuille de partage du téléphone pour tout message affiché ; QR du lien de l'équipe ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, TEAM: [{ name: 'Omar', role: ['gardien', ''], phone: '+212600000000', brief: true }] } };
  const S = [{ id: 'p1', name: 'Ana Ruiz', arrival: iso(3), departure: iso(6), adults: 2, booking_status: 'confirmed', source: 'Airbnb', phone: '+33600000000', details: {} }];
  r = await open({ tab: 'sejours', share: true, villa: V, stays: S.slice(), links: [{ client_id: 'p1', token_hash: 'h', created_at: iso(-1) }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="p1"]'); await r.page.click('[data-a="panel"][data-id="p1"][data-v="brief"]'); await r.page.waitForTimeout(300);
  const brief = await r.page.inputValue('#tx-p1');
  check('brief : « Copier » puis « Partager » côte à côte quand le téléphone propose la feuille de partage', !!(await r.page.$('#st-p1 [data-a="copy"][data-id="p1"]')) && !!(await r.page.$('#st-p1 [data-a="share"][data-id="p1"]')) && brief.length > 20);
  await r.page.click('#st-p1 [data-a="share"][data-id="p1"]'); await r.page.waitForTimeout(200);
  const sh = await r.page.evaluate(() => window.__shared);
  check('partager : navigator.share reçoit exactement le texte affiché (le brief), rien d’autre, sans erreur', sh.length === 1 && sh[0].text === brief && !sh[0].files.length && !r.errs.length, { sh, errs: r.errs });
  await r.ctx.close();
  // Lien de l'équipe : QR calculé sur l'appareil (moteur servi par le site), montré une seule fois avec le lien ; « Partager » aussi
  r = await open({ tab: 'maison', share: true, villa: V });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="eqcreate"]'); await r.page.waitForSelector('#eq-qr svg', { timeout: 8000 }).catch(() => {});
  const eq = await r.page.evaluate(() => { const q = document.getElementById('eq-qr'), m = document.getElementById('eq-msg'); return { qr: !!(q && q.querySelector('svg')), cap: q ? q.innerText : '', lib: typeof window.qrcode === 'function', url: (m && (m.value.match(/https?:\/\/\S+/) || [])[0]) || '', share: !!document.querySelector('[data-a="eqshare"]') }; });
  const made = r.calls.find((x) => x.kind === 'eqcreate');
  check('lien équipe : QR du lien sous le message (moteur chargé à la demande), légende « À scanner avec l’appareil photo du téléphone de Omar », bouton Partager', eq.qr && eq.lib && /appareil photo du téléphone de Omar/.test(eq.cap) && /montré qu’ici/.test(eq.cap) && /equipe\.html#k=/.test(eq.url) && eq.share && !r.errs.length, { ...eq, errs: r.errs });
  check('lien équipe : la base reçoit l’empreinte (sha-256), jamais le jeton du lien', !!made && /^[0-9a-f]{64}$/.test(made.body.token_hash) && made.body.name === 'Omar' && eq.url.indexOf(made.body.token_hash) < 0 && !JSON.stringify(made.body).includes(eq.url.split('#k=')[1] || '§'), made && made.body);
  await r.page.click('[data-a="eqshare"]'); await r.page.waitForTimeout(200);
  const sh2 = await r.page.evaluate(() => window.__shared);
  check('lien équipe : « Partager » envoie le message avec le lien, tel qu’affiché', sh2.length === 1 && sh2[0].text.indexOf(eq.url) > -1 && /Omar/.test(sh2[0].text), sh2);
  await r.ctx.close();
}

// ── 5 duodecies. Lien prestataire (20/10) : le rôle suit la fiche (membre « kitchen ») ; « Repas confirmés » visible ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, MEALS: [{ n: ['Déjeuner ou dîner', 'Lunch or dinner'], a: ['650 MAD', ''], b: ['850 MAD', ''] }],
    TEAM: [{ name: 'Omar', role: ['gardien', ''], phone: '+212600000000', brief: true }, { name: 'Lea', role: ['prestataire repas', ''], brief: true, kitchen: true }] } };
  const S = [{ id: 'p1', name: 'Ana Ruiz', arrival: iso(3), departure: iso(6), adults: 2, booking_status: 'confirmed', source: 'Airbnb', phone: '+33600000000', details: {} }];
  r = await open({ tab: 'maison', villa: V, teamLinks: [{ id: 'l1', name: 'Omar', lang: 'fr', role: 'house', created_at: iso(-3) }, { id: 'l2', name: 'Lea', lang: 'fr', role: 'kitchen', created_at: iso(-2) }] });
  await r.page.waitForTimeout(250);
  let tm = await txt(r.page);
  check('Accès équipe : l’aide du lien prestataire (la fiche a un prestataire) ; le lien de Lea porte « prestataire », pas celui d’Omar', /Lien prestataire : couverts, repas/.test(tm) && /Lea · FR · prestataire/.test(tm) && !/Omar · FR · prestataire/.test(tm), tm.slice(0, 600));
  await r.page.selectOption('#eq-who', 'Lea'); await r.page.click('[data-a="eqcreate"]'); await r.page.waitForSelector('#eq-msg', { timeout: 8000 });
  const mk = r.calls.find((x) => x.kind === 'eqcreate');
  check('créer le lien de Lea → role: kitchen envoyé avec l’empreinte ; le panneau dit « Lea · FR · prestataire »', !!mk && mk.body.role === 'kitchen' && mk.body.name === 'Lea' && /Lea · FR · prestataire/.test(await r.page.$eval('#eq-msg', (x) => x.closest('.panel').querySelector('.ttl').textContent)), mk && mk.body);
  await r.ctx.close();
  r = await open({ tab: 'maison', villa: V });
  await r.page.waitForTimeout(250);
  await r.page.selectOption('#eq-who', 'Omar'); await r.page.click('[data-a="eqcreate"]'); await r.page.waitForSelector('#eq-msg', { timeout: 8000 });
  const mk2 = r.calls.find((x) => x.kind === 'eqcreate');
  check('créer le lien d’Omar → role: house', !!mk2 && mk2.body.role === 'house');
  await r.ctx.close();
  // Le retour « repas confirmés » de Lea : carte De l'équipe, ligne sur le séjour (Jour)
  const REP = [{ id: 'rp1', link_id: 'l2', client_id: 'p1', kind: 'meals_ok', text: null, created_at: new Date().toISOString(), seen_at: null }];
  r = await open({ tab: 'jour', villa: V, stays: S.slice(), teamLinks: [{ id: 'l2', name: 'Lea', lang: 'fr', role: 'kitchen', created_at: iso(-2) }], reports: REP });
  await r.page.waitForTimeout(250);
  tm = await txt(r.page);
  check('Jour : « De l’équipe · Lea · repas confirmés pour Ana » et, sur le séjour, « Repas confirmés · Lea · date »', /Lea · repas confirmés pour Ana/.test(tm) && /Repas confirmés · Lea · /.test(tm), tm.slice(0, 900));
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
  check('compte ouvert (villa_settings.wa_connect_enabled) : « Relier » avec les identifiants publiés de l’app Meta de Stafflo, SDK pas chargé', !!(await r.page.$('#settings [data-a="waconnect"]')) && !r.reads.some((x) => x.kind === 'fbsdk') && /appId: '4788920158094935', configId: '2570136620077692'/.test(esrc) && /wa_connect_enabled[,&]/.test(esrc));
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' } });
  await r.page.waitForTimeout(200);
  check('identifiants présents : « Relier » dans Réglages ; le SDK de Meta n’est PAS chargé avant le clic', !!(await r.page.$('#settings [data-a="waconnect"]')) && !r.reads.some((x) => x.kind === 'fbsdk'));
  // 18/10 : le script de Meta se charge au 1er clic, la fenêtre s'ouvre au 2e — FB.login DANS le clic (Safari/Orion bloquaient la fenêtre, bouton coincé sur « Connexion… »)
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(600);
  const lo1 = await r.page.evaluate(() => ({ init: window.__fbInit, login: window.__fbLogin }));
  check('1er clic : script de Meta chargé et initialisé (app, v25.0), aucune fenêtre ouverte ; le bouton dit « Ouvrir la fenêtre Meta »', r.reads.some((x) => x.kind === 'fbsdk') && lo1.init && lo1.init.appId === '123456' && lo1.init.version === 'v25.0' && !lo1.login && /Ouvrir la fenêtre Meta/.test(await r.page.innerText('#settings')), lo1);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(1200);
  const wc = r.calls.filter((x) => x.kind === 'waconnect').pop();
  const lo = await r.page.evaluate(() => ({ init: window.__fbInit, login: window.__fbLogin, inClick: window.__fbInClick }));
  check('2e clic : FB.login appelé pendant le clic lui-même (fenêtre de Meta non bloquée) — configuration, code, coexistence', lo.inClick === true && lo.login && lo.login.config_id === '654321' && lo.login.response_type === 'code' && lo.login.extras.featureType === 'whatsapp_business_app_onboarding', lo);
  check('code et identifiants du compte (message de facebook.com) envoyés à wa-connect avec la session ; « relié » affiché', !!wc && wc.body.code === 'CODE1' && wc.body.waba_id === '5550001' && wc.body.phone_number_id === '106540352242922' && wc.auth === 'Bearer tok' && /WhatsApp Business relié : \+212 600-000111/.test(await r.page.innerText('#toastHost')) && !r.errs.length, { wc, e: r.errs });
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' }, fbEvil: true });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(600);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(4000);
  const we = r.calls.filter((x) => x.kind === 'waconnect').pop();
  check('un message qui ne vient pas de facebook.com est ignoré (pas d’identifiants volés), erreur affichée', !!we && !we.body.waba_id && /Connexion impossible/.test(await r.page.innerText('#settings')));
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' }, fbMode: 'block' });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(800);
  const bk = await r.page.innerText('#settings');
  check('script de Meta bloqué (bloqueur de contenu) : message clair, bouton revenu à « Relier », jamais coincé', /bloqueur de contenu/.test(bk) && /Relier/.test(bk) && !/Préparation…|Connexion…/.test(bk) && !(await r.page.$('[data-a="waconnect"][disabled]')), bk.slice(0, 400));
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' }, fbMode: 'refuse' });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(600);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(400);
  const rf = await r.page.innerText('#settings');
  check('Meta refuse (CANCEL + error_message de facebook.com) : le refus de Meta affiché tel quel, bouton libéré, rien envoyé à wa-connect', /Meta refuse la connexion : « Stafflo can't onboard customers at the moment\. »/.test(rf) && !/Connexion…/.test(rf) && !(await r.page.$('[data-a="wacancel"]')) && !r.calls.some((x) => x.kind === 'waconnect'), rf.slice(0, 500));
  await r.ctx.close();
  r = await open({ villa: V, waMeta: { appId: '123456', configId: '654321' }, fbMode: 'hang' });
  await r.page.waitForTimeout(200);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(600);
  await r.page.click('[data-a="waconnect"]'); await r.page.waitForTimeout(300);
  const hg = await r.page.innerText('#settings');
  check('fenêtre de Meta sans réponse : « Connexion… » + « Annuler » + que faire si rien ne s’est ouvert', /Connexion…/.test(hg) && !!(await r.page.$('[data-a="wacancel"]')) && /Autorisez les fenêtres pour stafflo\.app/.test(hg), hg.slice(0, 500));
  await r.page.click('[data-a="wacancel"]'); await r.page.waitForTimeout(200);
  const hc = await r.page.innerText('#settings');
  check('« Annuler » : bouton libéré (« Ouvrir la fenêtre Meta »), plus de « Connexion… »', /Ouvrir la fenêtre Meta/.test(hc) && !/Connexion…/.test(hc) && !(await r.page.$('[data-a="waconnect"][disabled]')) && !r.errs.length, { hc: hc.slice(0, 300), e: r.errs });
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
check('Séjours : ligne de commande sur le séjour, et le parcours du livret (22/10 : « livret pas envoyé » puis la commande à confirmer)', /Commande du client · [^:]+: 2 × Dîner · 1 × Transfert aéroport — 2\s?100 MAD/.test(tx6) && /Livret : livret pas envoyé · commande 2\s?100 MAD · à confirmer/.test(tx6), tx6.slice(0, 600));
// 22/10 : la carte « Extras » du mois (Séjours) — le séjour arrive dans 12 jours : ce mois-ci ou le suivant
for (let k = 0; k < 2 && !/Ana Ruiz[^\n]*\n?commande 2\s?100 MAD · à confirmer/.test(await r.page.innerText('#main')); k++) { await r.page.click('[data-a="exm"][data-v="1"]'); await r.page.waitForTimeout(120); }
tx6 = await r.page.innerText('#main');
check('Séjours › Extras du mois : séjours 1, livret envoyé 0/1, commande 1/1, commandé 2 100 MAD, la ligne du séjour « commande 2 100 MAD · à confirmer », mention des ouvertures suivies',
  /EXTRAS[\s\S]*Séjours\s*1\s*Livret envoyé\s*0\/1[\s\S]*Commande\s*1\/1\s*Commandé\s*2\s?100 MAD[\s\S]*Ana Ruiz[^\n]*\n?commande 2\s?100 MAD · à confirmer[\s\S]*Ouvertures suivies depuis le 22 octobre 2026/.test(tx6), tx6.slice(0, 900));
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

// Briefs WhatsApp (18/10) : « *Titre* » en gras WhatsApp, une section par sujet séparée d'une ligne vide, une puce par élément.
const sect = (txt, title) => { const m = new RegExp('(?:^|\\n)[^\\n]*\\*' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\*([^\\n]*)\\n?((?:• [^\\n]*\\n?)*)').exec(txt); return m ? { head: m[1].trim(), items: m[2].split('\n').filter(Boolean).map((x) => x.replace(/^• /, '')) } : null; };
// 19/10 : seul le texte libre d'un brief part à la traduction, élément par élément — {"lines": {"0": "…"}} ; la réponse, même forme
const linesOf = (b) => { try { return JSON.parse(b.user).lines || null; } catch (e) { return null; } };
const mapLines = (b, f) => ({ text: '```json\n' + JSON.stringify({ lines: Object.fromEntries(Object.entries(linesOf(b) || {}).map(([k, v]) => [k, f(v)])) }) + '\n```' });
// ── 5 duodecies. Deux briefs : la maison (majordome, ménage) et la cuisine (prestataire repas) ──────
{
  // Le contact de la maison est le majordome ; la cuisine passe par le prestataire repas (drapeau kitchen)
  const KF = JSON.parse(JSON.stringify(PILOT));
  KF.TEAM = [{ name: 'Saïd', brief: true, phone: '+212 600 000 011', role: ['majordome', 'house manager'] },
    { name: 'Bouchra', brief: true, role: ['ménage', 'housekeeping'] },
    { name: 'Léa', brief: true, kitchen: true, phone: '+33 6 20 80 11 27', role: ['prestataire repas', 'meal provider'] }];
  const ST = [{ id: 'k1', name: 'Felipe Villalobos', arrival: iso(2), departure: iso(5), adults: 6, children: 1, booking_status: 'confirmed', source: 'Airbnb', price: 2000, phone: '+44 7700 900123',
    meals: 'Mardi dîner, mercredi déjeuner et dîner · 1 végétarien, rien de pimenté',
    details: { arrival_time: '15h30', staff_note: 'Tajine de kefta le mercredi soir, semoule en accompagnement',
      guest_orders: { at: new Date().toISOString(), total: 2600, cur: 'MAD', items: [{ n: ['Dîner cuisinière', 'Cook dinner'], q: 3 }, { n: ['Déjeuner léger', 'Light lunch'], q: 2 }] } } }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF }, stays: ST });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]');
  check('deux briefs dans la grille : « Brief prestataire » et « Brief maison »', !!(await r.page.$('#st-k1 [data-a="panel"][data-v="chef"]')) && !!(await r.page.$('#st-k1 [data-a="panel"][data-v="brief"]')) &&
    /Brief prestataire/.test(await r.page.innerText('#st-k1')) && /Brief maison/.test(await r.page.innerText('#st-k1')));
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kt = await r.page.inputValue('#tx-k1');
  check('brief prestataire : couverts, services, commande du livret, consigne — jamais un prix ni le téléphone du client',
    /^\*Brief prestataire — Felipe Villalobos\*\npour Léa\n\n/.test(kt) && /\*Couverts\* : 7 personnes \(6 adultes, 1 enfant\)/.test(kt) && /\*Repas\*\n• Mardi dîner, mercredi déjeuner et dîner\n• 1 végétarien, rien de pimenté/.test(kt) && // 20/10 : « · » sépare deux éléments
    JSON.stringify(sect(kt, 'Commande du livret').items) === '["3 × Dîner cuisinière","2 × Déjeuner léger"]' && /\*Consigne\*\n• Tajine de kefta/.test(kt) && /\*Arrivée\* : .*\n• 15h30/.test(kt) &&
    !/2 600|MAD|€|7700 900123/.test(kt), kt);
  check('envoi : « Envoyer à Léa » sur SON numéro, jamais celui de la maison ni celui du client', !!(await r.page.$('#st-k1 [data-a="sendchef"]')) && /Envoyer à Léa/.test(await r.page.innerText('#st-k1')) &&
    !(await r.page.$('#st-k1 [data-a="sendwa"]')) && !/· EN|· FR/.test(await r.page.innerText('#st-k1 .panel .ttl')));
  check('interlocation : aucune arrivée après ce départ → dit tel quel, jamais une date supposée', /\*Interlocation\* : aucune arrivée prévue après ce départ/.test(kt));
  check('WhatsApp : une ligne vide entre les sections, une puce par élément, titres en gras', /\n\n👥 \*Couverts\*/.test(kt) && /\n\n📍 \*Arrivée\*/.test(kt) && !/\n\n\n/.test(kt) && /\n• /.test(kt), kt);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const bt = await r.page.inputValue('#tx-k1');
  check('brief maison : pour le majordome et le ménage, jamais le prestataire repas ; couchages et contact client gardés',
    /^\*Brief maison — Felipe Villalobos\*\npour Saïd, Bouchra$/m.test(bt) && !/Léa/.test(bt) && /\*Client\* : \+44 7700 900123/.test(bt) && /\*Couchages\* : à confirmer$/m.test(bt) &&
    /Envoyer à Saïd/.test(await r.page.innerText('#st-k1')), bt);
  check('sans lien personnel actif pour Saïd : le brief ne parle pas de lien', !/lien Stafflo/.test(bt) && !/lien Stafflo/.test(kt));
  const fit = await r.page.$eval('#tx-k1', (x) => ({ h: x.getBoundingClientRect().height, s: x.scrollHeight, cap: Math.round(window.innerHeight * 0.7) }));
  check('le brief se lit en entier : la zone prend la taille du texte (au plus 70 % de l’écran), pas une boîte de 150 px à faire défiler (18/10)', fit.h > 200 && (fit.h >= fit.s || fit.h >= fit.cap - 2), fit);
  await r.ctx.close();
  // 18/10 — le destinataire a un lien personnel actif (Accès équipe) : le brief finit par le rappel de son lien, jamais l'adresse (jeton non stocké)
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF }, stays: ST,
    teamLinks: [{ id: 'l1', name: 'saïd', lang: 'ar', created_at: iso(-3) }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const bl = await r.page.inputValue('#tx-k1');
  check('Saïd a un lien (casse ignorée) → dernière ligne « 🔗 *Détail à jour* : sur votre lien Stafflo … », sans adresse', /\n\n🔗 \*Détail à jour\* : sur votre lien Stafflo \(arrivées, repas, chambres prêtes\)$/.test(bl) && !/equipe\.html|#k=/.test(bl), bl.slice(-200));
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  check('Léa n’a pas de lien → le brief prestataire n’en parle pas', !/lien Stafflo/.test(await r.page.inputValue('#tx-k1')));
  await r.ctx.close();
  // 18/10 — brief en arabe : un geste « العربية », le texte arabe remplace le français dans la zone (c'est lui qu'on envoie), « Français » y revient.
  // 19/10 : en darija marocaine ; titres, destinataires, groupe, dates, heures et téléphone écrits par l'Espace (prénoms intacts) —
  // seul le texte libre (repas, consigne, commande) part à l'IA (write_staff), élément par élément, chaque nombre gardé.
  let arFail = false;
  const DJ = (x) => 'د ' + x; // traduction factice : reconnaissable, garde chaque nombre
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF }, stays: ST,
    ai: (b) => (b.task === 'write_staff' && /darija/.test(b.system) && !arFail ? mapLines(b, DJ) : { text: '' }) });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const frTxt = await r.page.inputValue('#tx-k1');
  check('brief maison : bouton « العربية » ; rien n’est traduit sans geste', !!(await r.page.$('#st-k1 [data-a="briefar"][data-v="brief"]')) && !r.calls.some((x) => x.kind === 'ai'));
  await r.page.click('#st-k1 [data-a="briefar"]'); await r.page.waitForTimeout(400);
  const aiq = r.calls.filter((x) => x.kind === 'ai').pop(), sentK = Object.values((aiq && linesOf(aiq.body)) || {}), AR_TXT = await r.page.inputValue('#tx-k1');
  check('un geste → ai-proxy write_staff (darija) avec SEULEMENT le texte libre — repas, consigne ; jamais un titre, un prénom, une date ni le téléphone',
    !!aiq && aiq.body.task === 'write_staff' && /darija/.test(aiq.body.system) && sentK.some((x) => /1 végétarien/.test(x)) && sentK.some((x) => /Tajine de kefta/.test(x)) &&
    !sentK.some((x) => /Felipe|Saïd|Bouchra|\*|7700|Brief|Arrivée|octobre|novembre|15h30/.test(x)), sentK);
  check('zone en darija (RTL) : titre, destinataires, groupe, heure, client écrits par l’Espace, prénoms intacts ; titre « · arabe », bouton « Français »',
    AR_TXT.startsWith('*معلومات الدار — Felipe Villalobos*\nلـ Saïd، Bouchra\n\n👥 *المجموعة* : 7 ديال الناس (6 كبار، 1 صغير)') && /📍 \*الوصول\* : [^\n]+\n• 15:30/.test(AR_TXT) &&
    /🛏 \*النعاس\* : مازال ما تأكدش/.test(AR_TXT) && /📞 \*الكليان\* : \+44 7700 900123/.test(AR_TXT) && /\n• د Tajine de kefta/.test(AR_TXT) && !/Arrivée|Groupe|Couchages|Client|pour |à confirmer/.test(AR_TXT) &&
    (await r.page.getAttribute('#tx-k1', 'dir')) === 'rtl' && /BRIEF MAISON · ARABE/i.test(await r.page.innerText('#st-k1 .panel .ttl')) && !!(await r.page.$('#st-k1 [data-a="briefpfr"]')), AR_TXT.slice(0, 400));
  await r.page.click('#st-k1 [data-a="briefpfr"]'); await r.page.waitForTimeout(150);
  check('« Français » : le brief français revient, sans nouvel appel ; « العربية » à nouveau sans appel (gardé en mémoire)', (await r.page.inputValue('#tx-k1')) === frTxt && r.calls.filter((x) => x.kind === 'ai').length === 1 && !(await r.page.getAttribute('#tx-k1', 'dir')));
  await r.page.click('#st-k1 [data-a="briefar"]'); await r.page.waitForTimeout(200);
  check('retour à l’arabe : depuis la mémoire, aucun nouvel appel', (await r.page.inputValue('#tx-k1')) === AR_TXT && r.calls.filter((x) => x.kind === 'ai').length === 1);
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  check('brief prestataire : son propre bouton ; l’IA ne répond pas → le français reste, un mot d’erreur', !!(await r.page.$('#st-k1 [data-a="briefar"][data-v="chef"]')) && /Brief prestataire — Felipe/.test(await r.page.inputValue('#tx-k1')));
  arFail = true;
  await r.page.click('#st-k1 [data-a="briefar"][data-v="chef"]'); await r.page.waitForTimeout(400);
  check('traduction impossible → brief prestataire inchangé, en français, bouton toujours là', /^\*Brief prestataire — Felipe/.test(await r.page.inputValue('#tx-k1')) && /Traduction impossible/.test(await r.page.innerText('#toastHost')) && !!(await r.page.$('#st-k1 [data-a="briefar"][data-v="chef"]')));
  await r.ctx.close();
  // 19/10/2026 — [REGRESSION — une sortie, une seule langue] Cas réel : le brief de Saïd pour « Seán » mêlait le français de l'Espace
  // et l'anglais de Lise. En français, tout est en français : ce que le client a écrit dans une autre langue est traduit (une fois,
  // gardé dans details.fr tant que l'original ne change pas) ; « English » → tout en anglais ; « العربية » → tout en darija.
  // Zéro invention : une traduction dont les nombres ne sont pas ceux de l'original est écartée. Et : pas de prix dans le brief
  // de l'équipe (lit bébé), boissons sans la phrase d'introduction, menu en puces, « la plupart du groupe » gardé.
  {
    const EN = {
      meals: 'I have had a look at the pack you have sent us, and please could we do the afternoon tea by the pool on Monday 26th with a birthday cake (something either vanilla or lemon flavoured)? Would it be possible do this closer to lunch time around 2pm? Could we do dinner on Monday 26th, Friday 30th and Saturday 31st? For the 3 dinners could we have: Starters - mechouia salad, zaalouk, pumpkin salad with cinnamon Mains - fish with chermoula, lamb tajine, chicken couscous Desserts - assorted Moroccan pastries, pastilla au lait, gazelle horns',
      drinks: 'For drinks, would it be possible to have: Coke Zero, Iced tea, Waters, Decaf tea and coffee',
      beds: 'There are 4 couples and then 2 siblings, who would be sharing the room with the single beds.',
      arrival_time: '« Most of the group will arrive quite late on the first day (likely after 9pm) »',
    };
    const FRV = {
      meals: "J'ai regardé le livret que vous nous avez envoyé : pourrions-nous avoir le goûter au bord de la piscine le lundi 26 avec un gâteau d'anniversaire (vanille ou citron) ? Serait-il possible de le faire plutôt vers l'heure du déjeuner, vers 14h ? Pourrions-nous dîner le lundi 26, le vendredi 30 et le samedi 31 ? Pour les 3 dîners, pourrions-nous avoir : Entrées - salade méchouia, zaalouk, salade de potiron à la cannelle Plats - poisson à la chermoula, tajine d'agneau, couscous au poulet Desserts - assortiment de pâtisseries marocaines, pastilla au lait, cornes de gazelle",
      drinks: "Pour les boissons, serait-il possible d'avoir : Coca Zéro, thé glacé, eaux, thé et café décaféinés",
      beds: 'Il y a 4 couples puis 2 frères et sœurs, qui partageront la chambre aux lits simples.',
      arrival_time: '« La plupart du groupe arrivera assez tard le premier jour (probablement après 21h) »',
    };
    let badArrival = false, enBad = false, dropLine = false;
    const ai = (b) => {
      if (b.task === 'write_staff' && /Tu traduis en français/.test(b.system)) {
        const req = JSON.parse(b.user).lines, out = {};
        for (const k of Object.keys(req)) { const f = k.split('|')[0]; let v = f === 'arrival_time' && badArrival ? FRV.arrival_time.replace('21h', '22h') : FRV[f]; if (!/«/.test(req[k])) v = v.replace(/^«\s*|\s*»$/g, '');
          // comme ministral-14b le 19/10 (essai réel sur les textes de Lise) : du gras markdown, un retour à la ligne après « : »
          if (f === 'meals') v = v.replace('le lundi 26, le vendredi 30', 'le **lundi 26**, le **vendredi 30**'); if (f === 'drinks') v = v.replace(" d'avoir : ", " d'avoir :\n");
          out[k] = v; }
        return { text: '```json\n' + JSON.stringify({ lines: out }) + '\n```' }; // réponse entourée de ``` : lue quand même
      }
      if (b.task === 'write_staff' && /into English/.test(b.system)) return mapLines(b, (x) => (enBad ? x.replace(/26/, '27') : 'EN ' + x));
      if (b.task === 'write_staff' && /darija/i.test(b.system) && dropLine) { const o = linesOf(b); delete o['1']; return { text: JSON.stringify({ lines: o }) }; }
      if (b.task === 'write_staff' && /darija/i.test(b.system)) return mapLines(b, (x) => '• د ' + x); // puce ajoutée par le modèle : retirée
      return { text: '' };
    };
    const VF = { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF };
    const S2 = [{ id: 'e2', name: 'Élias', arrival: iso(5), departure: iso(12), adults: 10, children: 0, infants: 1, booking_status: 'confirmed', source: 'Airbnb', phone: '', meals: EN.meals, details: { drinks: EN.drinks, beds: EN.beds, arrival_time: EN.arrival_time } }];
    r = await open({ tab: 'sejours', villa: VF, stays: S2, ai });
    await r.page.waitForTimeout(250);
    await r.page.click('[data-a="toggle"][data-id="e2"]');
    const ai0 = r.calls.filter((x) => x.kind === 'ai').length;
    await r.page.click('#st-e2 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(700);
    const tq = r.calls.filter((x) => x.kind === 'ai').slice(ai0);
    check('brief ouvert : UN appel de traduction en français, avec seulement ce que le client a écrit (4 champs) — jamais son nom, jamais un prix',
      tq.length === 1 && /Tu traduis en français/.test(tq[0].body.system) && Object.keys(JSON.parse(tq[0].body.user).lines).map((k) => k.split('|')[0]).sort().join() === 'arrival_time,beds,drinks,meals' && !/Élias|MAD/.test(tq[0].body.user), tq.map((x) => x.body.user.slice(0, 160)));
    const bt = await r.page.inputValue('#tx-e2'), rep = sect(bt, 'Repas') || { items: [] }, boi = sect(bt, 'Boissons') || { items: [] };
    check('repas en français, une puce par demande, puis Entrées / Plats / Desserts chacun sur sa ligne',
      rep.items.includes('Pourrions-nous dîner le lundi 26, le vendredi 30 et le samedi 31 ?') && rep.items.includes('Entrées - salade méchouia, zaalouk, salade de potiron à la cannelle') &&
      rep.items.includes("Plats - poisson à la chermoula, tajine d'agneau, couscous au poulet") && rep.items.includes('Desserts - assortiment de pâtisseries marocaines, pastilla au lait, cornes de gazelle') &&
      rep.items.some((x) => /gâteau d'anniversaire \(vanille ou citron\)/.test(x)), rep.items);
    check('boissons : une puce par boisson, sans la phrase d’introduction', JSON.stringify(boi.items) === '["Coca Zéro","thé glacé","eaux","thé et café décaféinés"]', boi.items);
    check('couchages en français', /\*Couchages\* : Il y a 4 couples puis 2 frères et sœurs, qui partageront la chambre aux lits simples\.$/m.test(bt), bt);
    check('arrivée : « La plupart du groupe … après 21h » en entier — jamais « 21h » seul (pas tout le groupe)', /La plupart du groupe arrivera assez tard le premier jour \(probablement après 21h\)/.test(bt) && !/^• 21h$/m.test(bt), (sect(bt, 'Arrivée') || {}).items);
    check('aucun mot anglais dans le brief français', !/\b(the|and|would|could|please|drinks|dinner|Most|There)\b/.test(bt), (bt.match(/\b(the|and|would|could|please|drinks|dinner|Most|There)\b/g) || []));
    check('la date de départ est dans le brief même sans heure de départ (elle disparaissait depuis le 18/10)', new RegExp('\\n\\n🚪 \\*Départ\\* : [a-zé]+ \\d{1,2} [a-zéû]+\\n\\n').test(bt), (bt.match(/^.*Départ.*$/m) || [])[0]);
    check('pas de prix dans le brief de l’équipe : « lit bébé et chaise haute à installer », sans « 400 MAD »', /\*Bébés \(1\)\* : lit bébé et chaise haute à installer$/m.test(bt) && !/MAD/.test(bt), (bt.match(/^.*Bébés.*$/m) || [])[0]);
    const fp = r.calls.filter((x) => x.kind === 'stay').pop();
    check('traduction gardée sur le séjour (details.fr : original + français) ; les mots du client intacts',
      !!fp && fp.body.details.fr.meals.src === EN.meals && fp.body.details.fr.meals.fr === FRV.meals && fp.body.details.fr.arrival_time.fr === FRV.arrival_time && fp.body.details.drinks === EN.drinks && fp.body.details.beds === EN.beds && fp.body.meals === undefined, fp && fp.body);
    check('la fiche du séjour montre toujours les mots du client (preuve) ; le panneau dit que c’est traduit', /There are 4 couples and then 2 siblings/.test(await r.page.innerText('#st-e2')) && /traduit en français/.test(await r.page.innerText('#st-e2 .panel')));
    await r.page.click('#st-e2 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(300);
    const kt = await r.page.inputValue('#tx-e2');
    check('brief prestataire : les mêmes textes en français, sans nouvel appel (traduction gardée)', /Pourrions-nous dîner le lundi 26/.test(kt) && !/\b(Could|dinner|the)\b/.test(kt) && r.calls.filter((x) => x.kind === 'ai').length === ai0 + 1, kt.slice(0, 300));
    await r.page.click('#st-e2 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(200);
    await r.page.click('#st-e2 [data-a="briefen"]'); await r.page.waitForTimeout(400);
    let q = r.calls.filter((x) => x.kind === 'ai').pop(), sentE = Object.values(linesOf(q.body) || {}), et = await r.page.inputValue('#tx-e2');
    check('« English » : le brief en anglais (un geste) — libellés, dates, groupe par l’Espace ; seul le texte libre (français) part à l’IA ; titre « · anglais »',
      /into English/.test(q.body.system) && sentE.includes('Pourrions-nous dîner le lundi 26, le vendredi 30 et le samedi 31 ?') && sentE.includes('Coca Zéro') && !sentE.some((x) => /\*|Élias|Saïd|Brief|Arrivée|octobre/.test(x)) &&
      et.startsWith('*House brief — Élias*\nfor Saïd, Bouchra\n\n👥 *Group*: 10 people (10 adults, 1 infant)') && /👶 \*Babies \(1\)\*: cot and high chair to set up/.test(et) && /📞 \*Guest\*: no number yet/.test(et) &&
      /\n• EN Pourrions-nous dîner le lundi 26/.test(et) && /· ANGLAIS/i.test(await r.page.innerText('#st-e2 .panel .ttl')), { sentE, et: et.slice(0, 400) });
    await r.page.click('#st-e2 [data-a="briefar"]'); await r.page.waitForTimeout(400);
    q = r.calls.filter((x) => x.kind === 'ai').pop();
    const sentA = Object.values(linesOf(q.body) || {}), at = await r.page.inputValue('#tx-e2');
    check('« العربية » : darija marocaine (plus l’arabe standard), seul le texte libre en français part à l’IA ; titres en darija, zone RTL',
      /darija/i.test(q.body.system) && !/arabe standard simple/.test(q.body.system) && sentA.includes('Pourrions-nous dîner le lundi 26, le vendredi 30 et le samedi 31 ?') && (await r.page.getAttribute('#tx-e2', 'dir')) === 'rtl' &&
      at.startsWith('*معلومات الدار — Élias*\nلـ Saïd، Bouchra\n\n👥 *المجموعة* : 10 ديال الناس (10 كبار، 1 بيبي)') && /👶 \*البيبي \(1\)\* : الناموسية/.test(at) && /\n• د Pourrions-nous dîner/.test(at) && !/• •/.test(at) &&
      !/Arrivée|Groupe|Couchages|Boissons|Repas|Client/.test(at), at.slice(0, 400));
    await r.page.click('#st-e2 [data-a="briefpfr"]'); await r.page.waitForTimeout(150);
    check('« Français » : retour au brief français, à l’identique', (await r.page.inputValue('#tx-e2')) === bt && !r.errs.length, r.errs);
    await r.ctx.close();
    // Garde-fou chiffres : une traduction qui change une heure (21h → 22h) est écartée — l'original reste, et c'est dit ;
    // une traduction anglaise qui change un nombre (26 → 27) aussi : le brief reste en français, un mot d'erreur.
    badArrival = true; enBad = true;
    r = await open({ tab: 'sejours', villa: VF, stays: [{ ...S2[0], id: 'e3', meals: EN.meals, details: { drinks: EN.drinks, beds: EN.beds, arrival_time: EN.arrival_time } }], ai });
    await r.page.waitForTimeout(250);
    await r.page.click('[data-a="toggle"][data-id="e3"]'); await r.page.click('#st-e3 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(700);
    const bt3 = await r.page.inputValue('#tx-e3');
    check('traduction qui change une heure (21h → 22h) : écartée — l’arrivée reste celle du client, le reste est en français, et le panneau le dit',
      /Most of the group will arrive quite late/.test(bt3) && !/22h/.test(bt3) && /Pourrions-nous dîner/.test(bt3) && /Laissé tel quel.*arrivée/i.test(await r.page.innerText('#st-e3 .panel')), bt3.slice(0, 400));
    await r.page.click('#st-e3 [data-a="briefen"]'); await r.page.waitForTimeout(400);
    check('traduction anglaise qui change un nombre (lundi 26 → 27) : écartée, le brief reste en français, un mot d’erreur', (await r.page.inputValue('#tx-e3')) === bt3 && /chiffre/.test(await r.page.innerText('#toastHost')) && !r.errs.length, r.errs);
    dropLine = true; // cas réel (ministral-14b, 19/10, brief entier) : une ligne avait disparu de la traduction
    await r.page.click('#st-e3 [data-a="briefar"]'); await r.page.waitForTimeout(400);
    check('traduction qui oublie une ligne : écartée, le brief reste en français, « Traduction impossible »', (await r.page.inputValue('#tx-e3')) === bt3 && /Traduction impossible/.test(await r.page.innerText('#toastHost')) && !(await r.page.getAttribute('#tx-e3', 'dir')));
    await r.ctx.close();
  }
  // 17/10/2026 — briefs nettoyés (brief de Thibaut) : l'heure dite par le client sur la ligne Arrivée, sans « (WhatsApp, date) »
  // ni tiret ; départ et boissons ; « 10 adultes » ; pas de nuits, pas de « à demander au client », jamais les notes privées.
  {
    const SC = [{ ...ST[0], adults: 10, children: 0, phone: '+33615185187', notes: 'TARIFS APPLICABLES 850 MAD — privé', meals: '',
      details: { arrival_time: '« - nous atterrissons à 14h à Marrakech. » (WhatsApp, lun. 5 oct. 18:26)', departure_time: '« Notre vol retour est à 9h vendredi. On partira donc très tôt de la villa (6h30) »', drinks: 'Eau plate (12 bouteilles), 12 bières' } }];
    r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF }, stays: SC });
    await r.page.waitForTimeout(250);
    await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
    const bc = await r.page.inputValue('#tx-k1');
    check('brief maison nettoyé : l’heure seulement — « atterrissage 14h », départ « 6h30 (vol 9h) » —, « Groupe : 10 adultes », couchages et repas sans consigne au propriétaire, boissons',
      /\*Arrivée\* : .+\n• atterrissage 14h\n(• chambres prêtes [^\n]+\n)?\n/.test(bc) && /\*Départ\* : .+\n• 6h30 \(vol 9h\)\n\n/.test(bc) &&
      /\*Groupe\* : 10 adultes$/m.test(bc) && /\*Couchages\* : à confirmer$/m.test(bc) && /\*Repas\* : pas encore reçus$/m.test(bc) && JSON.stringify(sect(bc, 'Boissons').items) === '["Eau plate (12 bouteilles)","12 bières"]' &&
      !/WhatsApp,|nuits|à demander|Heure d’arrivée|TARIFS|850|privé/.test(bc) && /\*Client\* : \+33615185187$/m.test(bc), bc);
    await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
    const kc = await r.page.inputValue('#tx-k1');
    check('brief prestataire nettoyé : mêmes heures, « Couverts : 10 adultes », pas de boissons ni de téléphone', /\*Arrivée\* : .+\n• atterrissage 14h\n\n/.test(kc) && /\*Départ\* : .+\n• 6h30 \(vol 9h\)\n\n/.test(kc) && /\*Couverts\* : 10 adultes$/m.test(kc) && !/Boissons|WhatsApp,|nuits|33615185187|TARIFS/.test(kc) && !r.errs.length, kc);
    await r.ctx.close();
  }
  // Deux séjours qui s'enchaînent : les deux briefs disent de combien de temps dispose l'équipe
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KF },
    stays: ST.concat([{ id: 'k2', name: 'Thibaut Vauclare', arrival: iso(5), departure: iso(9), adults: 10, booking_status: 'confirmed', source: 'Airbnb', details: { arrival_time: '15h30' } },
      { id: 'k3', name: 'Ana Ruiz', arrival: iso(20), departure: iso(24), adults: 4, booking_status: 'confirmed', source: 'Airbnb', details: {} }]) });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kt2 = await r.page.inputValue('#tx-k1');
  check('interlocation : la prochaine arrivée (le séjour ferme le plus proche, avec son heure), le jour même du départ', /\*Interlocation\* : prochaine arrivée [^\n]*15h30 \(le jour même\)/.test(kt2) && !/Ana Ruiz/.test(kt2), kt2);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  check('le brief maison la porte aussi ; la remise en état (tous les 3–4 mois) n’est jamais dans un brief de séjour', /\*Interlocation\* : prochaine arrivée/.test(await r.page.inputValue('#tx-k1')) &&
    !/[Rr]emise en état/.test(await r.page.inputValue('#tx-k1')) && !r.errs.length, r.errs);
  await r.ctx.close();
  // Déjeuner léger marqué « maison » dans la fiche (16/10) : la commande du livret part chez celui qui la prépare
  const KH = JSON.parse(JSON.stringify(KF));
  KH.MEALS = KH.MEALS.slice(0, 3).concat([{ n: ['Déjeuner léger (sur demande)', 'Light lunch (on request)'], a: ['450 MAD', '450 MAD'], b: ['450 MAD', '450 MAD'], h: ['12h30 – 14h30', '12:30 – 2:30 pm'], house: true }]);
  // 6 personnes : la maison prépare son déjeuner léger (à partir de 7, le prestataire — contrôlé plus bas)
  const SH = [{ ...ST[0], adults: 5, children: 1, details: { ...ST[0].details, guest_orders: { at: new Date().toISOString(), total: 3450, cur: 'MAD', items: [
    { id: 'm1', kind: 'meal', n: KH.MEALS[1].n, q: 3, unit: 850, sub: 2550 }, { id: 'm3', kind: 'meal', n: KH.MEALS[3].n, q: 2, unit: 450, sub: 900 }] } } }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KH }, stays: SH });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kh = await r.page.inputValue('#tx-k1');
  check('brief prestataire : ses repas seulement ; le déjeuner léger est signalé « préparé par la maison, pas par vous »',
    JSON.stringify(sect(kh, 'Commande du livret').items) === '["3 × Brunch, déjeuner ou dîner (sur demande)"]' && JSON.stringify(sect(kh, 'Préparé par la maison, pas par vous').items) === '["2 × Déjeuner léger (sur demande)"]' && !/450|850|MAD/.test(kh), kh);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const bh = await r.page.inputValue('#tx-k1');
  check('brief maison : « À préparer par la maison : 2 × Déjeuner léger », jamais les repas de la cuisinière ni un prix',
    JSON.stringify(sect(bh, 'À préparer par la maison').items) === '["2 × Déjeuner léger (sur demande)"]' && !/3 × Brunch/.test(bh) && !/450|850 MAD/.test(bh) && !r.errs.length, bh);
  await r.ctx.close();
  // 17/10/2026 — à partir de 7 personnes, un repas « maison » part chez le prestataire ; le goûter reste à la maison
  const KG = JSON.parse(JSON.stringify(KH)); KG.MEALS[2].house = true; KG.MEALS[3].big = 'kitchen'; // goûter : maison (défaut) ; déjeuner léger : prestataire à 7+
  const SG = [{ ...ST[0], details: { ...ST[0].details, guest_orders: { at: new Date().toISOString(), total: 3850, cur: 'MAD', items: [
    { id: 'm1', kind: 'meal', n: KG.MEALS[1].n, q: 3, unit: 850, sub: 2550 }, { id: 'm3', kind: 'meal', n: KG.MEALS[3].n, q: 2, unit: 450, sub: 900 }, { id: 'm2', kind: 'meal', n: KG.MEALS[2].n, q: 1, unit: 400, sub: 400 }] } } }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KG }, stays: SG });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]'); await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kg = await r.page.inputValue('#tx-k1');
  check('7 personnes et plus : un repas « maison » marqué « par le prestataire » y part ; le goûter (toujours la maison) reste à la maison',
    JSON.stringify(sect(kg, 'Commande du livret').items) === '["3 × Brunch, déjeuner ou dîner (sur demande)","2 × Déjeuner léger (sur demande)"]' && JSON.stringify(sect(kg, 'Préparé par la maison, pas par vous').items) === JSON.stringify(['1 × ' + KG.MEALS[2].n[0]]), kg);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const bg = await r.page.inputValue('#tx-k1');
  check('7 personnes et plus : le brief maison n’a plus que le goûter', JSON.stringify(sect(bg, 'À préparer par la maison').items) === JSON.stringify(['1 × ' + KG.MEALS[2].n[0]]) && !/Déjeuner léger/.test(bg) && !r.errs.length, bg);
  await r.ctx.close();
  // 17/10/2026 — commande datée dans le livret : chaque brief dit le jour et le service
  const SD = [{ ...ST[0], details: { ...ST[0].details, guest_orders: { at: new Date().toISOString(), total: 2100, cur: 'MAD', items: [
    { id: 'm1', kind: 'meal', n: KG.MEALS[1].n, q: 2, unit: 850, sub: 1700, when: [{ d: '2026-10-21', s: 'd' }, { d: '2026-10-22', s: 'l' }] }, { id: 'm2', kind: 'meal', n: KG.MEALS[2].n, q: 1, unit: 400, sub: 400, when: [{ d: '2026-10-23' }] }] } } }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KG }, stays: SD });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]');
  const sdTxt = await r.page.innerText('#st-k1');
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kd = await r.page.inputValue('#tx-k1');
  check('commande datée : le brief prestataire dit le jour et le service (« — mer. 21 soir, jeu. 22 midi »), jamais un prix',
    JSON.stringify(sect(kd, 'Commande du livret').items) === '["2 × Brunch, déjeuner ou dîner (sur demande) — mer. 21 soir, jeu. 22 midi"]' && /^• 1 × .* — ven\. 23$/m.test(sect(kd, 'Préparé par la maison, pas par vous') ? '• ' + sect(kd, 'Préparé par la maison, pas par vous').items[0] : '') && !/850|MAD/.test(kd), kd);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const bd = await r.page.inputValue('#tx-k1');
  check('commande datée : le brief maison aussi (« À préparer par la maison : 1 × Goûter … — ven. 23 »)', /^• 1 × .* — ven\. 23$/m.test((sect(bd, 'À préparer par la maison') || { items: [''] }).items.map((x) => '• ' + x).join('\n')) && !r.errs.length, bd);
  check('commande datée : la carte du séjour montre les jours au propriétaire', /2 × Brunch, déjeuner ou dîner \(sur demande\) — mer\. 21 soir, jeu\. 22 midi/.test(sdTxt), sdTxt.slice(0, 800));
  await r.ctx.close();
  // 20/10 (parcours réel, compte neuf) : le livret écrit dans « repas » le texte du client + le résumé de sa commande (« … · 2 × … — ven. 23 midi, sam. 24 soir »).
  // Avant : « ven. 23 » coupait les phrases (puces « 23 midi, sam. », « 24 soir ») et la commande se répétait sous Repas et sous 🧺.
  const SE = [{ ...SD[0], meals: 'Dîner samedi : tajine de poulet. Pas d’allergie. · 2 × ' + KG.MEALS[1].n[0] + ' — mer. 21 soir, jeu. 22 midi · 1 × ' + KG.MEALS[2].n[0] + ' — ven. 23' }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KG }, stays: SE });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]');
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const ke = await r.page.inputValue('#tx-k1');
  check('résumé du livret dans « repas » : les abréviations ne coupent plus (« ven. 23 »), et sous 🍽 Repas du brief prestataire il ne reste que les mots du client — la commande est dans 🧺 et 🏠',
    JSON.stringify(sect(ke, 'Repas').items) === '["Dîner samedi : tajine de poulet.","Pas d’allergie."]' && sect(ke, 'Commande du livret').items.length === 1 && sect(ke, 'Préparé par la maison, pas par vous').items.length === 1, ke);
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  const be = await r.page.inputValue('#tx-k1');
  check('brief maison : garde la ligne du prestataire sous Repas (le service du dîner), pas le goûter déjà sous 🏠',
    JSON.stringify(sect(be, 'Repas').items) === JSON.stringify(['Dîner samedi : tajine de poulet.', 'Pas d’allergie.', '2 × ' + KG.MEALS[1].n[0] + ' — mer. 21 soir, jeu. 22 midi']) && sect(be, 'À préparer par la maison').items.length === 1, be);
  await r.ctx.close();
  // seulement le résumé de commande dans « repas » : la section Repas disparaît (tout est dans 🧺), pas de « pas encore reçus » mensonger
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KG }, stays: [{ ...SD[0], meals: '2 × ' + KG.MEALS[1].n[0] + ' — mer. 21 soir, jeu. 22 midi · 1 × ' + KG.MEALS[2].n[0] + ' — ven. 23' }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]');
  await r.page.click('#st-k1 [data-a="panel"][data-v="chef"]'); await r.page.waitForTimeout(150);
  const kf = await r.page.inputValue('#tx-k1');
  check('repas = seulement la commande : pas de section Repas ni « pas encore reçus » dans le brief prestataire, la commande reste', !/\*Repas\*/.test(kf) && !/pas encore reçus/.test(kf) && sect(kf, 'Commande du livret').items.length === 1, kf);
  await r.ctx.close();
  // Éditeur : la case « Préparé par la maison » sur chaque repas (fiche avec prestataire), gardée à l'enregistrement
  r = await open({ villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KH } });
  await r.page.click('[data-a="feopen"]:not([data-v])'); await r.page.waitForSelector('#fe-VILLA\\.name'); await unfold(r.page);
  const ck3 = await r.page.$('input[type="checkbox"][data-fe="MEALS.3.house"]'), ck1 = await r.page.$('input[type="checkbox"][data-fe="MEALS.1.house"]');
  check('éditeur : case « Préparé par la maison » sur chaque repas, cochée pour le déjeuner léger seulement', !!ck3 && !!ck1 && (await ck3.isChecked()) && !(await ck1.isChecked()) && /Préparé par la maison \(brief maison/.test(await txt(r.page)));
  check('éditeur : « à partir de 7 personnes » — toujours la maison (défaut), par le prestataire, ou pas proposé', (await r.page.inputValue('select[data-fe="MEALS.3.big"]')) === 'house' && (await r.page.$$eval('select[data-fe="MEALS.3.big"] option', (os) => os.map((o) => o.value).join('|'))) === 'house|kitchen|off');
  await r.page.selectOption('select[data-fe="MEALS.3.big"]', 'off');
  await r.page.click('[data-a="fesave"]'); await r.page.waitForTimeout(400);
  const sv = r.calls.filter((c) => c.kind === 'PATCH').pop(), hm = sv && sv.body.house_facts && sv.body.house_facts.MEALS;
  check('enregistrement : la marque « maison » est gardée (et seulement là), avec « pas proposé à 7+ »', !!hm && hm.length === 4 && hm[3].house === true && hm[3].big === 'off' && !hm[1].house && !hm[1].big && !r.errs.length, hm && hm.map((m) => [m.house, m.big]));
  await r.ctx.close();
  // Brunch fait par la maison (16/10) : décompte et message repas comptent chaque repas à son prix, jamais au tarif de la cuisinière
  const KB = JSON.parse(JSON.stringify(KH));
  KB.MEALS[1] = { ...KB.MEALS[1], n: ['Déjeuner ou dîner (sur demande)', 'Lunch or dinner (on request)'] };
  KB.MEALS.push({ n: ['Brunch (sur demande)', 'Brunch (on request)'], a: ['450 MAD', '450 MAD'], b: ['450 MAD', '450 MAD'], h: ['Dès 10h30', 'From 10:30 am'], house: true });
  r = await open({ tab: 'sejours', villa: { villa_name: 'Villa Dar J', owner_name: 'Jérémie', house_facts_ref: 'villa-facts.js', house_facts: KB },
    stays: [{ id: 'k9', name: 'Felipe Villalobos', arrival: iso(2), departure: iso(5), adults: 7, booking_status: 'confirmed', source: 'Direct', details: {} }] });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k9"]'); await r.page.click('#st-k9 [data-a="panel"][data-v="bill"]'); await r.page.waitForTimeout(200);
  const bp = await r.page.innerText('#st-k9');
  check('décompte : un compteur par repas — « Déjeuner ou dîner », « Déjeuner léger (450 MAD) », « Brunch (450 MAD) » — plus de « Brunchs, déjeuners, dîners »',
    /Déjeuner ou dîner — nombre servi/.test(bp) && /Déjeuner léger — nombre servi \(450 MAD\)/.test(bp) && /Brunch — nombre servi \(450 MAD\)/.test(bp) && !/Brunchs, déjeuners, dîners/.test(bp) &&
    !!(await r.page.$('#st-k9 input[data-bill="xm3"]')) && !!(await r.page.$('#st-k9 input[data-bill="xm4"]')), bp.slice(0, 600));
  await r.page.fill('#st-k9 input[data-bill="services"]', '3'); await r.page.fill('#st-k9 input[data-bill="xm3"]', '2'); await r.page.fill('#st-k9 input[data-bill="xm4"]', '1'); await r.page.waitForTimeout(150);
  const btot = await r.page.innerText('#bt-k9'), bmsg = await r.page.inputValue('#tx-k9');
  check('décompte : 3 × 850 + 2 × 450 + 1 × 450 = 3 900 MAD ; le message détaille chaque repas à son prix',
    /^3\s?900 MAD$/.test(btot) && /3 × déjeuner ou dîner \(850 MAD|3 × lunch or dinner \(850 MAD/.test(bmsg) && /2 × (déjeuner léger|light lunch) \(450 MAD\) : 900 MAD/.test(bmsg) && /1 × brunch \(450 MAD\) : 450 MAD/.test(bmsg), { btot, bmsg });
  await r.page.click('#st-k9 [data-a="billsave"]'); await r.page.waitForTimeout(300);
  const bs = r.calls.filter((x) => x.kind === 'stay').pop(), bil = bs && bs.body.details && bs.body.details.billing;
  check('décompte enregistré : compteurs des repas de la maison gardés (xm3, xm4), total 3 900', !!bil && bil.xm3 === 2 && bil.xm4 === 1 && bil.services === 3 && bil.total === 3900 && !r.errs.length, bil);
  await r.page.click('#st-k9 [data-a="panel"][data-v="meals"]'); await r.page.waitForTimeout(150);
  const mm = await r.page.inputValue('#tx-k9');
  check('message repas au client : le brunch et le déjeuner léger annoncés à 450 MAD pour tout le groupe', /(Brunch \(sur demande\) : 450 MAD pour tout le groupe|Brunch \(on request\): 450 MAD for the whole group)/.test(mm) && /(Déjeuner léger \(sur demande\) : 450 MAD|Light lunch \(on request\): 450 MAD)/.test(mm), mm);
  await r.ctx.close();
  // Une villa sans prestataire repas : un seul brief, inchangé
  const NK = JSON.parse(JSON.stringify(PILOT));
  NK.TEAM = [{ name: 'Omar', brief: true, phone: '+212 600 000 012', role: ['gardien', 'caretaker'] }];
  r = await open({ tab: 'sejours', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: NK }, stays: ST });
  await r.page.waitForTimeout(250);
  await r.page.click('[data-a="toggle"][data-id="k1"]');
  check('sans prestataire repas : pas de « Brief prestataire », le brief maison part chez le seul contact', !(await r.page.$('#st-k1 [data-a="panel"][data-v="chef"]')) && !/Brief prestataire/.test(await r.page.innerText('#st-k1')));
  await r.page.click('#st-k1 [data-a="panel"][data-v="brief"]'); await r.page.waitForTimeout(150);
  check('brief maison : le seul membre de l’équipe est le destinataire', /^pour Omar$/m.test(await r.page.inputValue('#tx-k1')) && /Envoyer à Omar/.test(await r.page.innerText('#st-k1')) && !r.errs.length, r.errs);
  await r.ctx.close();
}

// ── Accès équipe (18/10/2026) : quand la personne ouvre son lien — heure exacte et ouvertures des 7 derniers jours ──
{
  const now = Date.now(), at = (h) => new Date(now - h * 3600000).toISOString();
  r = await open({ villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null },
    teamLinks: [{ id: 'l1', name: 'Omar', lang: 'ar', created_at: at(72), last_seen_at: at(0.2) }, { id: 'l2', name: 'Aya', lang: 'fr', created_at: at(5) }],
    opens: [{ link_id: 'l1', opened_at: at(0.2) }, { link_id: 'l1', opened_at: at(30) }, { link_id: 'l9', opened_at: at(1) }] });
  await r.page.waitForTimeout(250);
  const tx = await r.page.innerText('body');
  const hm = await r.page.evaluate((iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }, at(0.2));
  const oq = r.reads.find((x) => x.kind === 'opens');
  check('accès équipe : « ouvert aujourd’hui à HH:MM » — l’heure exacte, plus « il y a 9 h »', new RegExp('ouvert (aujourd’hui|hier) à ' + hm).test(tx) && !/ouvert il y a/.test(tx), tx.slice(0, 600));
  check('accès équipe : « 2 ouvertures ces 7 jours : … » pour ce lien seulement (les autres liens ne comptent pas) ; « jamais ouvert » pour un lien neuf', /2 ouvertures ces 7 jours : (aujourd’hui|hier) \d\d:\d\d, /.test(tx) && !/3 ouvertures/.test(tx) && /jamais ouvert/.test(tx) && !r.errs.length, { tx: tx.slice(0, 600), e: r.errs });
  check('accès équipe : ouvertures lues sur 7 jours (staff_link_opens, RLS du propriétaire)', !!oq && /staff_link_opens\?select=link_id,opened_at&opened_at=gte\.\d{4}-/.test(oq.url), oq);
  await r.ctx.close();
}

// ── Avis hôte (17/10/2026) : sur les voyageurs, depuis toute la conversation du séjour — jamais une annonce pour la villa ──
{
  const dmy = (d) => { const x = new Date(Date.now() + d * 86400000); return String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0') + '/' + x.getUTCFullYear(); };
  const BOOK = 'Hi! We would love to stay at your home to celebrate our engagement. Anna & Tom';
  const ST = () => [{ id: 'r1', name: 'Anna Berg', arrival: iso(-6), departure: iso(-3), adults: 4, booking_status: 'confirmed', source: 'Airbnb', phone: '+44 7700 900123', price: 1300,
    notes: 'OCCASION : ils fêtent leurs fiançailles.\nTARIFS APPLICABLES : repas 850 MAD par repas, van 600 MAD par trajet.', details: { guest_message: BOOK } }];
  const MAILS = [
    { received_at: iso(-20) + 'T10:00:00Z', extracted: { airbnb: { type: 'request', guest_message: BOOK + ' [https://www.airbnb.com/hosting/thread/1]' } } },
    { received_at: iso(-7) + 'T09:00:00Z', extracted: { airbnb: { type: 'message', guest_message: 'We land at 3pm and will text you from the taxi. Anna' } } },
    { received_at: iso(-2) + 'T09:00:00Z', extracted: { airbnb: { type: 'payout' } } }];
  const WAM = [{ id: 'wm1', guest_wa: '447700900123', guest_name: 'Anna', direction: 'in', type: 'text', body: 'Thank you so much, we left the keys on the table as asked.', sent_at: iso(-3) + 'T10:30:00Z', client_id: null }];
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: 'villa-facts.js', house_facts: PILOT };
  const RVQ = [{ subject: 'Write a review for Felipe’s group', body: 'Leave a review https://www.airbnb.co.uk/hosting/reviews/1111111111111111111/edit?c=x' },
    { subject: 'Write a review for Anna’s group', body: 'Tell other hosts about Anna.\nWrite a review [https://www.airbnb.co.uk/hosting/reviews/1797697914543417560/edit?c=.pi80.pkaG9&euid=fc40]' },
    { subject: 'Anna is waiting for your review', body: 'Write a review https://www.airbnb.co.uk/hosting/reviews/1797697914543417560/edit?euid=ab' }];
  r = await open({ tab: 'sejours', villa: V, stays: ST(), rvMails: MAILS, waMsgs: WAM, rvReq: RVQ, ai: () => ({ text: 'Here is a draft:\n\n**Anna and Tom** were *lovely* guests.' }) });
  await r.page.waitForTimeout(250);
  await r.page.click('#pa-r1 [data-a="rv"][data-v="host"]');
  await r.page.waitForFunction(() => { const t = document.getElementById('tx-r1'); return t && t.value; }, null, { timeout: 5000 });
  const call = r.calls.filter((x) => x.kind === 'ai').pop(), b = call ? call.body : {};
  check('avis hôte : cadre à part — ni fiche maison, ni séjours, ni messages en attente', /^You write the public review an Airbnb host leaves about their guests/.test(b.system || '') && !/UPCOMING AND CURRENT STAYS|SÉJOURS À VENIR|UNHANDLED AIRBNB MESSAGES/.test(b.system || '') && !(b.system || '').includes(PILOT.VILLA.name), (b.system || '').slice(0, 300));
  check('avis hôte : toute la conversation — message de réservation (une fois), message Airbnb, WhatsApp relié', (b.user || '').split('celebrate our engagement').length === 2 && /We land at 3pm/.test(b.user || '') && /\[WhatsApp · [^\]]+\] Guest : Thank you so much, we left the keys/.test(b.user || '') && !/airbnb\.com\/hosting/.test(b.user || '') && r.reads.some((x) => x.kind === 'rvmails' && /client_id=eq\.r1/.test(x.url) && !/archived_at/.test(x.url)), (b.user || '').slice(0, 600));
  check('avis hôte : les notes passent sans leurs lignes de prix', /OCCASION : ils fêtent leurs fiançailles/.test(b.user || '') && !/850 MAD|600 MAD|TARIFS/.test(b.user || ''));
  const tv = await r.page.inputValue('#tx-r1'), pa = await r.page.innerText('#pa-r1');
  check('avis hôte : texte brut prêt à coller (ni « Here is », ni astérisques)', tv === 'Anna and Tom were lovely guests.', tv);
  check('avis hôte : ce qu’ARIA a lu est affiché ; WhatsApp déjà là → pas d’import proposé ; « Réécrire »', /ARIA a lu 2 messages Airbnb et 1 message WhatsApp de ce séjour\./.test(pa) && !(await r.page.$('#pa-r1 input[data-file="rvwa"]')) && !!(await r.page.$('#pa-r1 [data-a="rvre"]')) && !r.errs.length, { pa, errs: r.errs });
  await r.page.click('#pa-r1 [data-a="rvre"]'); await r.page.waitForTimeout(300);
  check('« Réécrire » : un nouvel appel, même conversation', r.calls.filter((x) => x.kind === 'ai').length === 2);
  // 18/10 : airbnb.com/hosting/reviews est une page 404 chez Airbnb — le lien est le formulaire de CET avis, lu dans l'email d'Airbnb
  const rq = r.reads.find((x) => x.kind === 'rvreq'), rvA = await r.page.$eval('#pa-r1 a[href*="airbnb"][href*="review"]', (a) => ({ href: a.href, t: a.innerText })).catch(() => null);
  check('avis hôte : « Écrire l’avis sur Airbnb » ouvre le formulaire de cet avis (email au prénom du séjour, sans le pistage), jamais /hosting/reviews seul', !!rvA && rvA.href === 'https://www.airbnb.co.uk/hosting/reviews/1797697914543417560/edit' && /Écrire l’avis sur Airbnb/.test(rvA.t) &&
    !!rq && /received_at\.gte\.[0-9-]+T/.test(rq.url) && /received_at\.lte\./.test(rq.url) && !/airbnb\.com\/hosting\/reviews"/.test(await r.page.innerHTML('#pa-r1')), { rvA, rq });
  await r.ctx.close();
  // WhatsApp privé : l'export s'ajoute dans le panneau de l'avis, lu sur l'appareil, et l'avis est réécrit avec
  const EXP = [`[${dmy(-8)}, 18:29:01] Anna Berg: Hi Nadia, sending you on here so you have my number`, `[${dmy(-8)}, 18:40:12] Nadia: Welcome Anna!`, `[${dmy(-3)}, 10:31:00] Anna Berg: We left the keys on the table, thank you for everything`].join('\n');
  r = await open({ tab: 'sejours', villa: V, stays: ST(), rvMails: MAILS, rvReq: [{ subject: 'Write a review for Anna’s group', body: 'https://www.airbnb.co.uk/hosting/reviews/1797697914543417560/edit' }, { subject: 'Write a review for Anna', body: 'https://www.airbnb.co.uk/hosting/reviews/1797697914543417999/edit' }], ai: (bb) => ({ text: /left the keys on the table, thank you/.test(bb.user) ? 'Anna and Tom were great guests and left everything tidy.' : 'Anna and Tom were lovely guests.' }) });
  await r.page.waitForTimeout(250);
  await r.page.click('#pa-r1 [data-a="rv"][data-v="host"]');
  await r.page.waitForSelector('#pa-r1 input[data-file="rvwa"]', { timeout: 5000 });
  const rvB = await r.page.$eval('#pa-r1 a[href*="airbnb"][href*="review"]', (a) => ({ href: a.href, t: a.innerText })).catch(() => null);
  check('deux avis possibles pour ce prénom : aucun deviné — « Ouvrir les avis Airbnb » (page des avis du compte, pas la 404)', !!rvB && rvB.href === 'https://www.airbnb.com/users/reviews' && /Ouvrir les avis Airbnb/.test(rvB.t), rvB);
  check('sans WhatsApp enregistré : « Ajouter la discussion WhatsApp », lue sur cet appareil', /ARIA a lu 2 messages Airbnb et 0 message WhatsApp/.test(await r.page.innerText('#pa-r1')) && /Ajouter la discussion WhatsApp/.test(await r.page.innerText('#pa-r1')));
  await r.page.setInputFiles('#pa-r1 input[data-file="rvwa"]', { name: 'WhatsApp Chat with Anna Berg.txt', mimeType: 'text/plain', buffer: Buffer.from(EXP) });
  await r.page.waitForFunction(() => { const t = document.getElementById('tx-r1'); return t && /left everything tidy/.test(t.value); }, null, { timeout: 5000 }).catch(() => {});
  const b2 = (r.calls.filter((x) => x.kind === 'ai').pop() || {}).body || {};
  check('export ajouté : avis réécrit avec la discussion (client et hôte nommés), rien d’écrit en base', /left everything tidy/.test(await r.page.inputValue('#tx-r1')) && /\] Guest : We left the keys on the table/.test(b2.user || '') && /\] Nadia : Welcome Anna!/.test(b2.user || '') &&
    /ARIA a lu 2 messages Airbnb et 3 messages WhatsApp/.test(await r.page.innerText('#pa-r1')) && !r.calls.some((x) => x.kind === 'stay' || x.kind === 'insert') && !r.errs.length, { user: (b2.user || '').slice(-400), errs: r.errs });
  await r.ctx.close();
}

// ── 5 sexdecies. Calendriers iCal (17/10/2026) : liens sur le compte, lus par le serveur, jamais un séjour sans geste ──
{
  const isoD = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null, ical_feeds: [] };
  r = await open({ villa: V });
  await r.page.waitForSelector('#settings');
  let st = await r.page.innerText('#settings');
  check('Réglages : plus de renvoi vers l’ancienne version pour iCal ; « Aucun calendrier relié » et « Ajouter un calendrier »', /Aucun calendrier relié/.test(st) && !!(await r.page.$('#settings [data-a="icadd"]')) && !(await r.page.$('#settings a[href="app.html?open=settings"]')) && /Ancienne version \(prix\)/.test(st), st.slice(0, 600));
  await r.page.click('#settings [data-a="icadd"]'); await r.page.waitForSelector('#ic-url');
  await r.page.fill('#ic-url', 'https://evil.example.com/cal.ics'); await r.page.click('[data-a="icsave"]'); await r.page.waitForTimeout(100);
  check('lien d’un autre site refusé avant tout envoi (liste fermée de plateformes)', /Lien non reconnu/.test(await r.page.innerText('#settings')) && !r.calls.some((c) => c.kind === 'PATCH') && (await r.page.inputValue('#ic-url')) === 'https://evil.example.com/cal.ics');
  await r.page.fill('#ic-url', 'webcal://www.airbnb.fr/calendar/ical/123.ics?s=SECRET'); await r.page.fill('#ic-label', ''); await r.page.click('[data-a="icsave"]'); await r.page.waitForTimeout(500);
  const pv = r.calls.filter((c) => c.kind === 'PATCH').pop(), f0 = pv && pv.body.ical_feeds && pv.body.ical_feeds[0];
  check('relier : écrit sur SA ligne (owner_id) seulement ical_feeds — lien en https, nom déduit (Airbnb), id ; puis lecture serveur avec la session',
    !!pv && /owner_id=eq\./.test(pv.url) && Object.keys(pv.body).join() === 'ical_feeds' && pv.body.ical_feeds.length === 1 && f0.url === 'https://www.airbnb.fr/calendar/ical/123.ics?s=SECRET' && f0.label === 'Airbnb' && /^f[a-z0-9]+$/.test(f0.id) &&
    r.calls.some((c) => c.kind === 'icsync' && c.auth === 'Bearer tok') && !r.errs.length, { pv, errs: r.errs });
  st = await r.page.innerText('#settings');
  check('le lien (son jeton) n’est jamais affiché : seulement le nom et la plateforme', /1 calendrier relié/.test(st) && !/SECRET|calendar\/ical/.test(st), st.slice(0, 500));
  await r.page.click('#settings [data-a="icadd"]'); await r.page.fill('#ic-url', 'https://www.airbnb.fr/calendar/ical/123.ics?s=SECRET'); await r.page.click('[data-a="icsave"]'); await r.page.waitForTimeout(100);
  check('le même calendrier deux fois → refusé', /déjà relié/.test(await r.page.innerText('#settings')) && r.calls.filter((c) => c.kind === 'PATCH').length === 1);
  await r.ctx.close();

  // Un compte avec deux calendriers : nuits prises hachurées, réservation sans séjour signalée, une couverte par un séjour (même code)
  const FEEDS = [{ id: 'fa', label: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics?s=x' }, { id: 'fb', label: 'Booking.com', url: 'https://admin.booking.com/ical.html?t=y' }];
  const EV = [
    { id: 'e1', feed_id: 'fa', start_date: isoD(3), end_date: isoD(6), kind: 'reserved', code: 'HMTEST0012', label: 'Airbnb', hidden_at: null },
    { id: 'e2', feed_id: 'fa', start_date: isoD(9), end_date: isoD(12), kind: 'reserved', code: 'HMTEST0099', label: 'Airbnb', hidden_at: null },
    { id: 'e3', feed_id: 'fb', start_date: isoD(1), end_date: isoD(2), kind: 'blocked', code: null, label: 'Booking.com', hidden_at: null },
    { id: 'e4', feed_id: 'gone', start_date: isoD(14), end_date: isoD(16), kind: 'reserved', code: null, label: 'Ancien', hidden_at: null }];
  const SS = [{ id: 'z1', name: 'Léa Martin', arrival: isoD(9), departure: isoD(12), adults: 2, booking_status: 'confirmed', source: 'Airbnb', details: { reservation_code: 'HMTEST0099' } }];
  const RUN = [{ finished_at: new Date(Date.now() - 20 * 60000).toISOString(), ok: false, stats: { errors: [{ feed: 'fb', error: 'upstream_404' }] } }];
  r = await open({ tab: 'jour', villa: { ...V, ical_feeds: FEEDS }, stays: SS.map((x) => ({ ...x })), ical: EV, icalRun: RUN });
  await r.page.waitForTimeout(300);
  let tj = await txt(r.page);
  check('Jour : « réservations sans séjour » — la réservation Airbnb sans séjour (dates, nuits, code), pas celle couverte par le séjour de Léa, pas un blocage, pas un calendrier retiré',
    /Calendriers : réservations sans séjour/i.test(tj) && /Airbnb · .+ → .+ · 3\u00a0nuits · HMTEST0012/.test(tj) && !/HMTEST0099/.test(tj) && !/Ancien/.test(tj) && (await r.page.$$('[data-a="icnew"]')).length === 1, tj.slice(0, 900));
  check('l’Espace lit les calendriers en base (dates seulement, non disparues)', r.reads.some((x) => x.kind === 'icget' && /gone_at=is\.null/.test(x.url) && /select=id,feed_id,start_date,end_date,kind,code,label,hidden_at/.test(x.url)));
  await r.page.click('[data-a="icnew"][data-v="e1"]'); await r.page.waitForSelector('#ns-name');
  check('« Créer le séjour » : formulaire avec les dates et la source remplies, le nom à saisir', (await r.page.inputValue('#ns-arr')) === isoD(3) && (await r.page.inputValue('#ns-dep')) === isoD(6) && (await r.page.inputValue('#ns-source')) === 'Airbnb' && (await r.page.inputValue('#ns-name')) === '');
  check('rien n’est créé tant que le propriétaire n’a pas enregistré', !r.calls.some((c) => c.kind === 'insert'));
  await r.page.fill('#ns-name', 'Tom Durand'); await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(500);
  const ins = r.calls.find((c) => c.kind === 'insert');
  check('enregistré : séjour Airbnb aux dates du calendrier, rattaché par son code (reservation_code)', !!ins && ins.body.arrival === isoD(3) && ins.body.departure === isoD(6) && ins.body.source === 'Airbnb' && ins.body.details.reservation_code === 'HMTEST0012' && ins.body.name === 'Tom Durand', ins && ins.body);
  await r.ctx.close();
  r = await open({ tab: 'jour', villa: { ...V, ical_feeds: FEEDS }, stays: SS.map((x) => ({ ...x })), ical: EV, icalRun: RUN });
  await r.page.waitForTimeout(300);
  await r.page.click('[data-a="ichide"][data-v="e1"]'); await r.page.waitForTimeout(300);
  const hp = r.calls.find((c) => c.kind === 'icpatch');
  check('« Masquer » : seulement hidden_at sur cet événement, carte vidée', !!hp && /ical_events\?id=eq\.e1/.test(hp.url) && Object.keys(hp.body).join() === 'hidden_at' && !/réservations sans séjour/i.test(await txt(r.page)), hp);
  await r.ctx.close();
  // Calendrier : nuits prises par un calendrier relié, hachurées, pas comptées libres
  r = await open({ tab: 'sejours', villa: { ...V, ical_feeds: FEEDS }, stays: SS.map((x) => ({ ...x })), ical: EV, icalRun: RUN });
  await r.page.waitForTimeout(300);
  const extDays = await r.page.$$eval('.cal .d.ext', (ds) => ds.map((d) => d.getAttribute('title')));
  const inMonth = (d) => new Date(Date.now() + d * 86400000).getMonth() === new Date().getMonth();
  const want = [1, 3, 4, 5].filter(inMonth).length;
  check('calendrier : nuits du calendrier relié sans séjour hachurées (Airbnb réservé, Booking bloqué), légende « calendrier relié »', extDays.length === want && (want === 0 || extDays.some((x) => /Airbnb · réservé|Booking\.com · bloqué/.test(x))) && (want === 0 || /calendrier relié/.test(await txt(r.page))), { extDays, want });
  await r.ctx.close();
  // Réglages : état de la lecture, calendrier illisible signalé, retirer, lire maintenant
  r = await open({ villa: { ...V, ical_feeds: FEEDS }, ical: EV, icalRun: RUN });
  await r.page.waitForSelector('#settings');
  st = await r.page.innerText('#settings');
  check('Réglages : « 2 calendriers reliés · lus il y a 20 min », Booking.com signalé illisible', /2 calendriers reliés · lus il y a 20 min · un calendrier n’a pas pu être lu/.test(st) && /Booking\.com\s*· illisible/.test(st) && !/Booking\.com\s*· Booking\.com/.test(st), st.slice(0, 700));
  await r.page.click('#settings [data-a="icsync"]'); await r.page.waitForTimeout(400);
  check('« Lire maintenant » : la fonction serveur avec la session, puis rechargement', r.calls.filter((c) => c.kind === 'icsync').length === 1 && r.reads.filter((x) => x.kind === 'icget').length >= 2);
  await r.page.click('#settings [data-a="icdel"][data-v="fb"]'); await r.page.waitForTimeout(400);
  const dp = r.calls.filter((c) => c.kind === 'PATCH').pop();
  check('« Retirer » : la liste sans ce calendrier, rien d’autre', !!dp && JSON.stringify(dp.body) === JSON.stringify({ ical_feeds: [FEEDS[0]] }) && /1 calendrier relié/.test(await r.page.innerText('#settings')) && !r.errs.length, { dp, errs: r.errs });
  await r.ctx.close();
}

// ── 21/10 — Nouveau séjour depuis un message collé (WhatsApp, SMS, email Airbnb) : formulaire pré-rempli, cité, rien enregistré ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', city: 'Marrakech', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina', host: 'Nadia' }, TEAM: [{ name: 'Omar', brief: true, role: ['gardien', 'caretaker'] }] }, ical_feeds: [] };
  const yr = new Date().getFullYear() + 1; // dates à venir, écrites avec l'année : lues telles quelles
  const WA = [`[12/10/${yr - 1}, 10:02:11] Nadia: Bonjour Pablo, avec plaisir !`,
    `[12/10/${yr - 1}, 10:05:40] ~ Pablo Serrano: Merci ! Nous serions du 25 au 30 mars ${yr}, nous sommes 6 adultes et 2 enfants.`,
    `[12/10/${yr - 1}, 10:06:02] ~ Pablo Serrano: Mon numéro : +34 612 345 678. 2 400 € pour le séjour c'est bon pour nous.`,
    `[12/10/${yr - 1}, 10:07:00] Nadia: Parfait, je bloque les dates.`].join('\n');
  r = await open({ tab: 'sejours', villa: V, stays: [] });
  await r.page.click('[data-a="nsopen"]'); await r.page.waitForSelector('#ns-name');
  check('Nouveau séjour : bouton « Coller un message (WhatsApp, SMS, email) », rien d’autre tant qu’il n’est pas ouvert', !!(await r.page.$('[data-a="nspaste"]')) && !(await r.page.$('#ns-paste')));
  await r.page.click('[data-a="nspaste"]'); await r.page.waitForSelector('#ns-paste');
  await r.page.fill('#ns-paste', WA); await r.page.click('[data-a="nsread"]'); await r.page.waitForTimeout(150);
  const vals = async () => ({ name: await r.page.inputValue('#ns-name'), arr: await r.page.inputValue('#ns-arr'), dep: await r.page.inputValue('#ns-dep'), ad: await r.page.inputValue('#ns-adults'), ch: await r.page.inputValue('#ns-children'), src: await r.page.inputValue('#ns-source'), net: await r.page.inputValue('#ns-net'), paid: await r.page.inputValue('#ns-paid'), phone: await r.page.inputValue('#ns-phone') });
  let v = await vals(), tf = await r.page.innerText('#ns-paste-box');
  check('WhatsApp collé (export iPhone, Nadia + « ~ Pablo Serrano ») : client = l’expéditeur qui n’est ni l’hôte ni l’équipe ; dates « du 25 au 30 mars », 6 adultes, 2 enfants, téléphone (sans le montant qui suit), 2 400 € (direct : net et payé), source Direct',
    v.name === 'Pablo Serrano' && v.arr === `${yr}-03-25` && v.dep === `${yr}-03-30` && v.ad === '6' && v.ch === '2' && v.src === 'Direct' && v.net === '2400' && v.paid === '2400' && v.phone === '+34612345678', v);
  check('chaque valeur citée (« Lu dans le message ») : la phrase du client, pas une invention ; rien d’enregistré, aucun appel IA', /Lu dans le message/.test(tf) && /Arrivée : .*— « Nous serions du 25 au 30 mars/.test(tf) && /Adultes : 6 — « nous sommes 6 adultes et 2 enfants/.test(tf) && /Téléphone : \+34612345678/.test(tf) && !r.calls.some((c) => c.kind === 'insert' || c.kind === 'ai') && !r.errs.length, { tf: tf.slice(0, 700), errs: r.errs });
  // Enregistrer : le séjour tel que lu, origine espace
  await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(400);
  const ins = r.calls.find((c) => c.kind === 'insert');
  check('« Créer le séjour » : le séjour enregistré avec ce qui a été lu (et relu dans le formulaire), rien de plus', !!ins && ins.body.name === 'Pablo Serrano' && ins.body.arrival === `${yr}-03-25` && ins.body.departure === `${yr}-03-30` && ins.body.adults === 6 && ins.body.children === 2 && ins.body.guests === 8 && ins.body.price === 2400 && ins.body.phone === '+34612345678' && ins.body.source === 'Direct' && ins.body.details.origin === 'espace' && !r.errs.length, ins && ins.body);
  await r.ctx.close();
  // SMS / message direct en anglais : « Oct 25 – Nov 1 », « we are 4 adults and 2 kids », airbnb mentionné → source Airbnb ; pas de montant
  r = await open({ tab: 'sejours', villa: V, stays: [] });
  await r.page.click('[data-a="nsopen"]'); await r.page.waitForSelector('#ns-name'); await r.page.click('[data-a="nspaste"]'); await r.page.waitForSelector('#ns-paste');
  await r.page.fill('#ns-paste', `Hi Nadia, my name is Clara Whitfield. We would love to book the riad Oct 25 – Nov 1 ${yr} via airbnb, we are 4 adults and 2 kids. Arriving around 3pm.`); await r.page.click('[data-a="nsread"]'); await r.page.waitForTimeout(150);
  v = await vals(); tf = await r.page.innerText('#ns-paste-box');
  check('SMS en anglais : « my name is Clara Whitfield », « Oct 25 – Nov 1 », 4 adultes 2 enfants, source Airbnb ; montant et téléphone vides (pas écrits), dits « Pas trouvé » nulle part puisque les quatre champs clés sont là',
    v.name === 'Clara Whitfield' && v.arr === `${yr}-10-25` && v.dep === `${yr}-11-01` && v.ad === '4' && v.ch === '2' && v.src === 'Airbnb' && v.net === '' && v.paid === '' && v.phone === '' && !/Pas trouvé/.test(tf), v);
  // Texte sans rien de lisible → formulaire vide, message honnête ; puis ARIA : seules les valeurs mot pour mot sont reprises
  await r.page.fill('#ns-paste', 'Bonjour, est-ce que la villa est libre pour les vacances de la Toussaint ? Nous serions une famille.'); await r.page.click('[data-a="nsread"]'); await r.page.waitForTimeout(150);
  v = await vals(); tf = await r.page.innerText('#ns-paste-box');
  check('texte sans dates ni nombre : rien de rempli (la lecture précédente n’est pas gardée à tort… le nom tapé avant reste), « Rien de lisible »', v.arr === '' && v.dep === '' && v.ad === '' && /Rien de lisible/.test(tf), { v, tf: tf.slice(0, 300) });
  await r.ctx.close();
  const ARIA_TXT = `Hello, this is Jon and Mia. We land on the 2nd of December and fly back home on the 6th. We'll be 2 adults plus our little one (1 child). Budget around 1500 euros.`;
  r = await open({ tab: 'sejours', villa: V, stays: [], ai: (b) => ({ text: JSON.stringify({ name: { value: 'Jon and Mia', quote: 'this is Jon and Mia' }, arrival: { value: `${yr}-12-02`, quote: 'We land on the 2nd of December' }, departure: { value: `${yr}-12-06`, quote: 'fly back home on the 6th' }, party: { adults: 2, children: 1, quote: "We'll be 2 adults plus our little one (1 child)" }, phone: { value: '+33600000000', quote: 'Hello' }, amount_eur: { value: 1500, quote: 'Budget around 1500 euros' } }) }) });
  await r.page.click('[data-a="nsopen"]'); await r.page.waitForSelector('#ns-name'); await r.page.click('[data-a="nspaste"]'); await r.page.waitForSelector('#ns-paste');
  await r.page.fill('#ns-paste', ARIA_TXT); await r.page.click('[data-a="nsread"]'); await r.page.waitForTimeout(150);
  v = await vals();
  check('règles d’abord : « 2nd of December » n’est pas une forme lue par les règles (arrivée vide), « 2 adults » et « 1 child » et « 1500 euros » le sont', v.arr === '' && v.ad === '2' && v.ch === '1' && v.paid === '1500' && !r.calls.some((c) => c.kind === 'ai'), v);
  await r.page.click('[data-a="nsaria"]'); await r.page.waitForTimeout(400);
  v = await vals(); tf = await r.page.innerText('#ns-paste-box');
  const ai = r.calls.find((c) => c.kind === 'ai');
  check('« Lire avec ARIA » : un appel extract avec le texte ; le nom et les dates dont le jour et le mois sont dans la phrase citée sont repris ; le téléphone, dont la citation ne porte pas le numéro, est refusé ; ce que les règles avaient lu n’est pas réécrit',
    !!ai && ai.body.task === 'extract' && v.name === 'Jon and Mia' && v.arr === `${yr}-12-02` && v.dep === '' && v.ad === '2' && v.ch === '1' && v.phone === '' && /Nom : Jon and Mia — « this is Jon and Mia »/.test(tf) && !r.errs.length, { v, tf: tf.slice(0, 600), errs: r.errs });
  await r.ctx.close();
  // Email Airbnb collé : mêmes règles que gmail-sync — nom complet, code, dates Check-in / Checkout, voyageurs, net « YOU EARN », total payé
  const MAIL = `Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct\nNew booking confirmed! Ana arrives 13 Oct. Send a message to confirm check-in details.\nAna Ruiz Prieto [https://www.airbnb.com/hosting/reservations/details/HMABCD1234]\nIdentity verified · 3 reviews\nCheck-in\nTue, 13 Oct ${yr}\nCheckout\nFri, 16 Oct ${yr}\n4:00 pm\n11:00 am\nGUESTS\n5 adults, 2 children\nCONFIRMATION CODE\nHMABCD1234\nGUEST PAID\nTOTAL (EUR) €1,862.40\nHOST PAYOUT\n3 nights room fee €1,800.00\nYOU EARN €1,735.20`;
  r = await open({ tab: 'sejours', villa: V, stays: [] });
  await r.page.click('[data-a="nsopen"]'); await r.page.waitForSelector('#ns-name'); await r.page.click('[data-a="nspaste"]'); await r.page.waitForSelector('#ns-paste');
  await r.page.fill('#ns-paste', MAIL); await r.page.click('[data-a="nsread"]'); await r.page.waitForTimeout(150);
  v = await vals(); tf = await r.page.innerText('#ns-paste-box');
  check('email Airbnb collé : Ana Ruiz Prieto, 13 → 16 oct., 5 adultes 2 enfants, Airbnb, net 1 735,20 (YOU EARN), payé 1 862,40, code HMABCD1234 cité', v.name === 'Ana Ruiz Prieto' && v.arr === `${yr}-10-13` && v.dep === `${yr}-10-16` && v.ad === '5' && v.ch === '2' && v.src === 'Airbnb' && v.net === '1735.2' && v.paid === '1862.4' && /Code Airbnb : HMABCD1234/.test(tf), v);
  await r.page.click('[data-a="nssave"]'); await r.page.waitForTimeout(400);
  const ins2 = r.calls.find((c) => c.kind === 'insert');
  check('enregistré : séjour Airbnb rattaché par son code (reservation_code), net dans price, payé dans financial.guestTotal', !!ins2 && ins2.body.source === 'Airbnb' && ins2.body.details.reservation_code === 'HMABCD1234' && ins2.body.price === 1735.2 && ins2.body.details.financial.guestTotal === 1862.4 && ins2.body.guests === 7 && !r.errs.length, ins2 && ins2.body);
  await r.ctx.close();
}

// ── 21/10 — Séjour créé par le serveur depuis un calendrier (ical-sync) : « à compléter », À faire, Modifier, interrupteur ──
{
  const V = { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null, ical_feeds: [{ id: 'fa', label: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics?s=x' }, { id: 'fb', label: 'airbnb', url: 'https://ical.booking.com/v1/export?t=y' }], ical_auto_create: true };
  const EV = [{ id: 'e10', feed_id: 'fa', start_date: iso(12), end_date: iso(15), kind: 'reserved', code: 'HMTEST0021', label: 'Airbnb', hidden_at: null }];
  const SS = [
    { id: 'ic1', name: 'HMTEST0021', arrival: iso(12), departure: iso(15), adults: null, guests: null, price: null, booking_status: 'confirmed', source: 'Airbnb', details: { reservation_code: 'HMTEST0021', origin: 'ical_sync', ical_event_id: 'e10', ical_feed_id: 'fa', pending: ['name', 'price'] } },
    { id: 'ic2', name: 'Airbnb ' + iso(30), arrival: iso(30), departure: iso(33), price: null, booking_status: 'confirmed', source: 'Airbnb', details: { origin: 'ical_sync', ical_event_id: 'e-vanished', ical_feed_id: 'fa', pending: ['name', 'price'] } },
    { id: 'ic3', name: 'Ana Ruiz', arrival: iso(40), departure: iso(43), price: 900, booking_status: 'confirmed', source: 'Airbnb', details: { origin: 'gmail_sync', pending: [] } },
  ];
  r = await open({ tab: 'jour', villa: V, stays: SS.map((x) => ({ ...x, details: { ...x.details } })), ical: EV });
  await r.page.waitForTimeout(300);
  let tj = await txt(r.page);
  check('Jour › À faire : « Compléter le séjour (nom, montant) » pour les deux séjours du calendrier, pas pour Ana ; aucune « réservation sans séjour » (le serveur l’a créée)',
    (tj.match(/Compléter le séjour \(nom, montant\)/g) || []).length === 2 && /HMTEST0021 · dans 12 jours/.test(tj) && !/Ana Ruiz · /.test(tj.split('Compléter le séjour')[2] || '') && !/réservations sans séjour/i.test(tj) && !r.errs.length, tj.slice(0, 900));
  await r.page.click('[data-a="goto"][data-id="ic1"][data-v="complete"]'); await r.page.waitForSelector('#ed-name-ic1');
  check('« Compléter » ouvre le séjour dans Séjours, panneau Modifier, nom = le code (rien d’inventé)', (await r.page.inputValue('#ed-name-ic1')) === 'HMTEST0021' && (await r.page.inputValue('#ed-net-ic1')) === '' && !!(await r.page.$('[data-a="nsopen"]')));
  let ts = await txt(r.page);
  check('carte : « À compléter : nom, montant · réservation lue dans le calendrier Airbnb », en attente (pas « prêt ») ; le séjour dont la réservation a disparu du calendrier est signalé',
    /À compléter : nom, montant · réservation lue dans le calendrier Airbnb/.test(ts) && !/Prêt — rien ne manque/.test(ts) && /Plus dans le calendrier Airbnb — annulée \?/.test(ts) && (await r.page.$$('article.stay.alert')).length === 1 && (await r.page.$eval('#st-ic2', (e) => e.className)) === 'stay alert', ts.slice(0, 1200));
  // Modifier : le nom saisi, le montant saisi → plus rien à compléter ; les traces du calendrier restent
  await r.page.fill('#ed-name-ic1', 'Pablo Serrano'); await r.page.fill('#ed-net-ic1', '1250'); await r.page.click('[data-a="editsave"][data-id="ic1"]'); await r.page.waitForTimeout(300);
  let up = r.calls.filter((c) => c.kind === 'stay').pop();
  check('Modifier (nom + montant) : name, price, et details sans « pending » — code, origine et événement du calendrier gardés',
    !!up && /id=eq\.ic1/.test(up.url) && up.body.name === 'Pablo Serrano' && up.body.price === 1250 && up.body.details && !('pending' in up.body.details) && up.body.details.reservation_code === 'HMTEST0021' && up.body.details.ical_event_id === 'e10' && up.body.details.origin === 'ical_sync', up && up.body);
  ts = await txt(r.page);
  check('après : plus de « à compléter » pour Pablo, un seul « Compléter le séjour » reste (le séjour disparu)', !/Pablo Serrano[\s\S]{0,200}À compléter/.test(ts) && !r.errs.length, ts.slice(0, 600));
  await r.ctx.close();
  // Seulement le nom saisi : le montant reste à compléter
  r = await open({ tab: 'sejours', villa: V, stays: SS.map((x) => ({ ...x, details: { ...x.details } })), ical: EV });
  await r.page.waitForTimeout(300);
  await r.page.click('[data-a="toggle"][data-id="ic1"]'); await r.page.click('[data-a="panel"][data-id="ic1"][data-v="edit"]'); await r.page.waitForSelector('#ed-name-ic1');
  await r.page.fill('#ed-name-ic1', 'Pablo Serrano'); await r.page.click('[data-a="editsave"][data-id="ic1"]'); await r.page.waitForTimeout(300);
  up = r.calls.filter((c) => c.kind === 'stay').pop();
  check('Modifier (nom seul) : pending = [\'price\'], la carte dit « À compléter : montant »', !!up && up.body.name === 'Pablo Serrano' && JSON.stringify(up.body.details.pending) === '["price"]' && /À compléter : montant · réservation lue dans le calendrier Airbnb/.test(await txt(r.page)), up && up.body);
  await r.ctx.close();
  // Réglages : interrupteur et note Booking.com
  r = await open({ villa: { ...V } });
  await r.page.waitForSelector('#settings');
  let st = await r.page.innerText('#settings');
  check('Réglages › Calendriers : « Créer les séjours automatiquement · Oui … » avec « Couper » ; le calendrier nommé « airbnb » dit « · Booking.com » et la note « Booking.com n’exporte que des blocages »',
    /Créer les séjours automatiquement\s*Oui : une réservation lue sans séjour crée le séjour/.test(st) && !!(await r.page.$('#settings [data-a="icauto"][data-v="0"]')) && /airbnb\s*· Booking\.com/.test(st) && /Booking\.com n’exporte que des blocages/.test(st), st.slice(0, 900));
  await r.page.click('#settings [data-a="icauto"][data-v="0"]'); await r.page.waitForTimeout(300);
  const ap = r.calls.filter((c) => c.kind === 'PATCH').pop();
  check('« Couper » : PATCH villa_settings (sa ligne) { ical_auto_create: false } seulement ; « Non : … seulement signalée » et « Activer »',
    !!ap && /owner_id=eq\./.test(ap.url) && JSON.stringify(ap.body) === '{"ical_auto_create":false}' && /Non : une réservation sans séjour vous est seulement signalée/.test(await r.page.innerText('#settings')) && !!(await r.page.$('#settings [data-a="icauto"][data-v="1"]')) && !r.errs.length, { ap, errs: r.errs });
  await r.ctx.close();
  // Sans calendrier relié : pas d'interrupteur
  r = await open({ villa: { ...V, ical_feeds: [] } });
  await r.page.waitForSelector('#settings');
  check('sans calendrier relié : pas d’interrupteur, « chaque réservation Airbnb devient un séjour, à compléter »', !(await r.page.$('#settings [data-a="icauto"]')) && /chaque réservation Airbnb devient un séjour, à compléter/.test(await r.page.innerText('#settings')));
  await r.ctx.close();
}

// ── 18/10 — Mise en route : un calendrier iCal vaut Gmail ; « Masquer » une fois la fiche et un séjour en place ──
{
  const VF = { villa_name: 'Riad Zina', owner_name: 'Nadia', city: 'Marrakech', house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina' }, TEAM: [{ name: 'Omar', brief: true, role: ['gardien', 'caretaker'] }] }, ical_feeds: [] };
  const ST1 = [{ id: 's1', name: 'Ana Ruiz', arrival: iso(5), departure: iso(8), adults: 2, booking_status: 'confirmed', source: 'direct', details: {} }];
  r = await open({ tab: 'jour', villa: VF, stays: ST1 });
  await r.page.waitForTimeout(200);
  let tj = await txt(r.page);
  check('fiche + séjour + équipe, pas de Gmail : la mise en route reste (Gmail à faire, « ou un calendrier iCal »), avec « Masquer la mise en route »', /MISE EN ROUTE/.test(tj) && /Ou un calendrier iCal/.test(tj) && !!(await r.page.$('[data-a="setuphide"]')));
  await r.page.click('[data-a="setuphide"]'); await r.page.waitForTimeout(200);
  check('masquée : plus de carte, un mot qui dit où retrouver Gmail, iCal, alertes ; gardé sur l’appareil', !/MISE EN ROUTE/.test(await txt(r.page)) && /Réglages reste là/.test(await r.page.innerText('#toastHost')) && (await r.page.evaluate(() => localStorage.getItem('stafflo_setup_hidden'))) === '1');
  await r.ctx.close();
  r = await open({ tab: 'jour', villa: { ...VF, ical_feeds: [{ id: 'f1', label: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics?s=abc', added_at: '2026-10-17T10:00:00Z' }] }, stays: ST1 });
  await r.page.waitForTimeout(200);
  check('un calendrier iCal relié vaut Gmail : tout est fait, la carte disparaît', !/MISE EN ROUTE/.test(await txt(r.page)));
  await r.ctx.close();
  r = await open({ tab: 'jour', villa: { villa_name: 'Riad Zina', owner_name: 'Nadia', house_facts_ref: null, house_facts: null } });
  await r.page.waitForTimeout(200);
  check('compte neuf (ni fiche ni séjour) : pas de « Masquer » — la mise en route reste devant', /MISE EN ROUTE/.test(await txt(r.page)) && !(await r.page.$('[data-a="setuphide"]')));
  await r.ctx.close();
}

// ── 18/10 — Accès équipe sans équipe : pas de « Créer le lien » pour personne, d'abord l'équipe (fiche maison) ──
{
  const V0 = { villa_name: 'Riad Zina', owner_name: 'Nadia', city: 'Marrakech', house_facts_ref: null, house_facts: null, staff_members: null };
  r = await open({ villa: V0 });
  await r.page.waitForTimeout(200);
  const tm = await txt(r.page);
  check('sans équipe : la carte Accès équipe explique et mène à « Ajouter votre équipe » (fiche), sans sélecteur vide ni « Créer le lien »', /Ajoutez d’abord votre équipe/.test(tm) && !(await r.page.$('#eq-who')) && !(await r.page.$('[data-a="eqcreate"]')) && !!(await r.page.$('[data-a="feopen"][data-v="team"]')));
  await r.ctx.close();
  r = await open({ villa: { ...V0, house_facts_ref: 'villa-facts.js', house_facts: { VILLA: { name: 'Riad Zina' }, TEAM: [{ name: 'Omar', brief: true, phone: '+212 600 000 000', role: ['gardien', 'caretaker'] }] } } });
  await r.page.waitForTimeout(200);
  check('avec une équipe : sélecteur « Pour » (Omar) et « Créer le lien »', (await r.page.$eval('#eq-who', (x) => x.value)) === 'Omar' && !!(await r.page.$('[data-a="eqcreate"]')));
  await r.ctx.close();
}

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
