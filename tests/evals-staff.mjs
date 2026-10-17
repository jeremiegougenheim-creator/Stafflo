// Vue équipe (equipe.html + supabase/functions/staff-view) — garde-fous.
//   node tests/evals-staff.mjs   (nécessite esbuild : PUSH_TEST_MODULES=… comme evals-push)
//
// Ce que l'équipe voit est volontairement minimal : prénom + initiale, dates,
// composition, heure d'arrivée, couchages, repas, consigne. Jamais de prix,
// de téléphone, d'email, de nationalité ni les notes du propriétaire.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const fnSrc = fs.readFileSync(path.join(root, 'supabase/functions/staff-view/index.ts'), 'utf8');
globalThis.Deno = { env: { get: () => '' }, serve: () => {} }; // le serveur n'est pas lancé pendant les tests
const js = esbuild.transformSync(fnSrc, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// ── Jeton ────────────────────────────────────────────────────────────────
const tok = crypto.randomBytes(32).toString('base64url');
check('jeton 32 octets base64url accepté', M.validToken(tok));
check('jeton court, avec symboles ou non texte refusé', !M.validToken('abc') && !M.validToken(tok.slice(0, 20) + '/+=' + tok.slice(23)) && !M.validToken(null) && !M.validToken({}));
check('empreinte sha-256 (vecteur « abc »)', await M.sha256hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('empreinte du jeton = sha-256 standard', await M.sha256hex(tok) === crypto.createHash('sha256').update(tok).digest('hex'));

// ── Noms ─────────────────────────────────────────────────────────────────
check('prénom + initiale', M.shortName('Tomas Herrera') === 'Tomas H.');
check('un seul mot tel quel', M.shortName('Seán') === 'Seán');
check('nom vide → « ? »', M.shortName('') === '?' && M.shortName(null) === '?');
check('nom composé : dernière initiale', M.shortName('  jean  de la fontaine ') === 'jean F.');

// ── Séjours visibles ─────────────────────────────────────────────────────
const T = '2026-10-13';
const ROWS = [
  { name: 'Tomas Herrera', arrival: '2026-10-13', departure: '2026-10-16', adults: 7, children: 0, infants: 0, guests: 7, booking_status: 'confirmed', price: 1298, notes: 'TARIFS APPLICABLES 850 MAD', phone: '+44 7000', email: 'f@x.com', nat: 'Royaume-Uni', meals: '  Dîner du 13 : tajine  ', details: { arrival_time: 'Vol AT801 · 15h20', beds: '3 couples + 1 seul', staff_note: 'Mariage : prévoir des fleurs', payouts: [{ amount_eur: 1298 }], reservation_code: 'HMX', conversation: 'privé' } },
  { name: 'Arnaud Delorme', arrival: '2026-10-19', departure: '2026-10-23', adults: 8, children: 2, infants: 1, guests: 10, booking_status: 'confirmed', details: null },
  { name: 'Seán', arrival: '2026-10-25', departure: '2026-11-01', guests: 11, booking_status: 'confirmed', details: 'pas un objet' },
  { name: 'Lead Demande', arrival: '2026-10-20', departure: '2026-10-22', booking_status: 'inquiry', guests: 4 },
  { name: 'Refus', arrival: '2026-10-20', departure: '2026-10-22', booking_status: 'declined', guests: 4 },
  { name: 'Parti Hier', arrival: '2026-10-09', departure: '2026-10-12', booking_status: 'confirmed', guests: 4 },
  { name: 'Part Aujourdhui', arrival: '2026-10-10', departure: '2026-10-13', booking_status: 'confirmed', guests: 5 },
  { name: 'Trop Loin', arrival: '2026-11-20', departure: '2026-11-25', booking_status: 'confirmed', guests: 6 },
  { name: 'Dates Fausses', arrival: '2026-10-20', departure: '2026-10-20', booking_status: 'confirmed', guests: 2 },
  { name: 'Rotation Meme Jour', arrival: '2026-10-23', departure: '2026-10-25', booking_status: 'confirmed', guests: 3 },
];
const V = M.staffView(ROWS, T);
const names = V.map((s) => s.name);
check('demandes et refus exclus', !names.includes('Lead D.') && !names.includes('Refus'), names);
check('séjour terminé hier exclu, départ du jour inclus', !names.includes('Parti H.') && names.includes('Part A.'), names);
check('au-delà de 30 jours exclu', !names.includes('Trop L.'), names);
check('dates incohérentes exclues', !names.includes('Dates F.'), names);
check('ordre par arrivée', names.join('|') === 'Part A.|Tomas H.|Arnaud D.|Rotation J.|Seán', names.join('|'));
const KEYS = ['id', 'name', 'a', 'd', 'nights', 'adults', 'children', 'infants', 'pax', 'arrival_time', 'departure_time', 'beds', 'meals', 'drinks', 'note', 'extras', 'same_day'];
check('champs exactement ceux prévus (aucun prix, note, téléphone, email, code)', V.every((s) => Object.keys(s).join(',') === KEYS.join(',')), Object.keys(V[0]).join(','));
const flat = JSON.stringify(V);
for (const bad of ['1298', 'TARIFS', '+44', 'f@x.com', 'Royaume', 'HMX', 'privé', 'Herrera'])
  check(`rien ne fuit : « ${bad} »`, !flat.includes(bad));
const f = V.find((s) => s.name === 'Tomas H.');
check('champs équipe lus dans details', f.arrival_time === 'Vol AT801 · 15h20' && f.beds === '3 couples + 1 seul' && f.note === 'Mariage : prévoir des fleurs');
check('heure tirée de WhatsApp nettoyée pour l’équipe : tiret et point retirés, moment du message gardé seulement pour une heure relative',
  M.teamTxt('« - nous atterrissons à 14h à Marrakech. » (WhatsApp, lun. 5 oct. 18:26)') === '« nous atterrissons à 14h à Marrakech »' &&
  M.teamTxt('« hoping to arrive in about 1hr15 » (WhatsApp, sam. 17 oct. 14:05)') === '« hoping to arrive in about 1hr15 » (message du sam. 17 oct. 14:05)' && M.teamTxt('15h30') === '15h30');
check('l’heure seulement, avec son rôle : atterrissage, départ de la villa (vol) — une heure relative, deux heures dans un morceau ou un texte du propriétaire restent tels quels',
  M.teamTime('« - nous atterrissons à 14h à Marrakech. » (WhatsApp, lun. 5 oct. 18:26)', 'a') === 'atterrissage 14h' &&
  M.teamTime('« Notre vol retour est à 9h vendredi. On partira donc très tôt de la villa (6h30) »', 'd') === '6h30 (vol 9h)' &&
  M.teamTime('Vol AT801 · « flight AT801 landing at 16:40 »', 'a') === 'vol AT801, atterrissage 16h40' &&
  M.teamTime('Vol AT802 · « Our return flight is AT802 on Sunday at 6:05 pm »', 'd') === 'vol AT802 18h05' &&
  M.teamTime('« We land at 2pm, and should be at the villa around 3:30pm »', 'a') === 'vers 15h30 (atterrissage 14h)' &&
  M.teamTime('« hoping to arrive in about 1hr15 » (WhatsApp, sam. 17 oct. 14:05)', 'a') === '« hoping to arrive in about 1hr15 » (message du sam. 17 oct. 14:05)' &&
  M.teamTime('« we leave the villa at 10am for our 1pm flight »', 'd') === '« we leave the villa at 10am for our 1pm flight »' &&
  M.teamTime('vol AT801, à la villa vers 16h', 'a') === 'vol AT801, à la villa vers 16h',
  [M.teamTime('« We land at 2pm, and should be at the villa around 3:30pm »', 'a'), M.teamTime('Vol AT802 · « Our return flight is AT802 on Sunday at 6:05 pm »', 'd')]);
check('repas nettoyés', f.meals === 'Dîner du 13 : tajine');
check('extras commandés par le client : quoi et combien, jamais le prix ni les repas (déjà dans « repas »)', M.extrasLine({ items: [{ kind: 'meal', n: ['Dîner'], q: 2, unit: 850 }, { kind: 'extra', n: ['Transfert aéroport', 'Airport transfer'], q: 1, unit: 400, sub: 400 }, { kind: 'extra', n: ['Massage'], q: 2, unit: 600 }] }) === '1 × Transfert aéroport · 2 × Massage' && M.extrasLine(null) === '' && M.extrasLine({ items: 'x' }) === '' && !/400|600|MAD/.test(M.extrasLine({ items: [{ kind: 'extra', n: ['Transfert'], q: 1, unit: 400 }] })));
check('nuits calculées', f.nights === 3 && V.find((s) => s.name === 'Seán').nights === 7);
const th = V.find((s) => s.name === 'Arnaud D.');
check('personnes = adultes + enfants (bébés à part)', th.pax === 10 && th.infants === 1);
check('sans composition : nombre de voyageurs', V.find((s) => s.name === 'Seán').pax === 11);
check('details absent ou invalide : champs vides, pas d’erreur', th.beds === '' && V.find((s) => s.name === 'Seán').note === '');
check('rotation : arrivée le jour d’un départ signalée', V.find((s) => s.name === 'Rotation J.').same_day === true && V.find((s) => s.name === 'Seán').same_day === true && f.same_day === true, JSON.stringify(V.map((s) => [s.name, s.same_day])));
check('pas de rotation inventée', th.same_day === false);
const long = M.staffView([{ name: 'X Y', arrival: T, departure: '2026-10-14', booking_status: 'confirmed', meals: 'm'.repeat(900), details: { staff_note: 'n'.repeat(900) } }], T)[0];
check('textes plafonnés (600)', long.meals.length === 600 && long.note.length === 600);
check('date du jour invalide → rien', M.staffView(ROWS, 'hier').length === 0);

// ── Retours de l'équipe (staff_reports) ────────────────────────────────────
const VIS = ['s1', 's2'];
check('retour « chambres prêtes » : séjour visible obligatoire', JSON.stringify(M.cleanReport({ kind: 'rooms_ready', client_id: 's1' }, VIS)) === JSON.stringify({ kind: 'rooms_ready', client_id: 's1', text: null }) && M.cleanReport({ kind: 'rooms_ready' }, VIS) === null && M.cleanReport({ kind: 'rooms_ready', client_id: 'autre' }, VIS) === null);
check('retour « problème » : texte obligatoire, ≤ 300, espaces repliés, séjour facultatif', M.cleanReport({ kind: 'issue', text: '  fuite   salle de bain ' }, VIS).text === 'fuite salle de bain' && M.cleanReport({ kind: 'issue', text: 'x'.repeat(900), client_id: 's2' }, VIS).text.length === 300 && M.cleanReport({ kind: 'issue', text: '   ' }, VIS) === null);
check('genre inconnu refusé (rien d’autre n’est modifiable depuis ce lien)', M.cleanReport({ kind: 'price', text: '1' }, VIS) === null && M.cleanReport({ kind: 'delete', client_id: 's1' }, VIS) === null);
check('30 retours par heure et par lien, pas plus', (() => { let lim = false; for (let i = 0; i < 35; i++) if (M.limited('r:L1', 30, 3600000)) lim = true; return lim && !M.limited('r:L2', 30, 3600000); })());
check('fonction : le retour part dans staff_reports avec le propriétaire et le lien, rien d’autre n’est écrit', /staff_reports`, \{ method: "POST"/.test(fnSrc) && /owner_id: link\.owner_id, link_id: link\.id, client_id: rep\.client_id, kind: rep\.kind, text: rep\.text/.test(fnSrc) && (fnSrc.match(/method: "POST"/g) || []).length === 1);
check('fonction : les retours récents du lien reviennent avec les séjours (chambres prêtes reste coché)', /staff_reports\?select=id,kind,client_id,text,created_at&link_id=eq\.\$\{link\.id\}&deleted_at=is\.null/.test(fnSrc) && /stays, reports, at:/.test(fnSrc));

// ── Fonction : requêtes ──────────────────────────────────────────────────
const sel = (fnSrc.match(/crm_clients\?select=([^&`]+)/) || [])[1] || '';
check('colonnes lues : jamais prix, notes, téléphone, email, nationalité', sel && !/price|notes|remarks|phone|email|nat\b|payout/.test(sel), sel);
check('lien retiré = plus d’accès (deleted_at)', /staff_links\?select=[^`]*token_hash=eq\.\$\{h\}&deleted_at=is\.null/.test(fnSrc));
check('jeton jamais stocké : seule l’empreinte est cherchée', !/token_hash=eq\.\$\{body\.k\}/.test(fnSrc) && /sha256hex\(body\.k\)/.test(fnSrc));
check('séjours du propriétaire du lien seulement', /user_id=eq\.\$\{link\.owner_id\}&deleted_at=is\.null/.test(fnSrc));
check('réponse jamais en cache', /"Cache-Control": "no-store"/.test(fnSrc));
check('deux écritures seulement : last_seen_at (PATCH) et le retour de l’équipe (POST staff_reports) — jamais de DELETE', (fnSrc.match(/method: "PATCH"/g) || []).length === 1 && (fnSrc.match(/method: "POST"/g) || []).length === 1 && !/method: "(DELETE|PUT)"/.test(fnSrc) && /last_seen_at: new Date/.test(fnSrc));
check('même exclusion des demandes que l’Espace', (() => {
  const esp = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');
  const a = (fnSrc.match(/FIRM_OUT = \[([^\]]+)\]/) || [])[1], b = (esp.match(/FIRM_OUT = \[([^\]]+)\]/) || [])[1];
  return a && b && a.replace(/["'\s]/g, '') === b.replace(/["'\s]/g, '');
})());

// ── Page ─────────────────────────────────────────────────────────────────
const page = fs.readFileSync(path.join(root, 'equipe.html'), 'utf8');
const script = page.slice(page.indexOf('<script>'));
check('page non indexée, sans referrer', page.includes('<meta name="robots" content="noindex, nofollow">') && page.includes('<meta name="referrer" content="no-referrer">'));
check('jeton lu dans le fragment (#k=), jamais dans l’URL envoyée', /location\.hash/.test(script) && !/location\.search/.test(script) && /body: JSON\.stringify\(\{ k: S\.k \}\)/.test(script));
check('tout texte échappé', /var esc = function/.test(script) && !/innerHTML = [^;]*s\.(name|meals|note|beds)/.test(script));
check('arabe : sens de lecture RTL et dates marocaines', /dir = S\.lang === 'ar' \? 'rtl' : 'ltr'/.test(script) && /'ar-MA'/.test(script));
check('noms latins isolés en arabe (<bdi>)', /<bdi>' \+ esc\(s\.name\)/.test(script));
for (const bad of ['650', '850', 'Faiza', 'Saïd', 'Bouchra', '+212', '14h', '18h', 'Palmeraie'])
  check(`aucun fait en dur : « ${bad} »`, !script.includes(bad));
check('pluriels arabes (1, 2, 3–10, 11+)', /n === 1 \? 'ليلة واحدة' : n === 2 \? 'ليلتان' : n <= 10/.test(script));
check('hors connexion : dernières informations gardées', /C_KEY/.test(script) && /S\.state = S\.data \? 'offline'/.test(script));
check('lien invalide : message clair, cache effacé', /x\.status === 404/.test(script) && /store\.set\(C_KEY, null\)/.test(script));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
check('sw.js ne met pas equipe.html en cache', sw.includes("url.includes('equipe.html')"));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
