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
// Séjour créé depuis un calendrier (ical-sync, 21/10) : le nom est encore le code, ou « Airbnb 2026-11-02 » — l'équipe voit « ? », jamais le code
check('nom pas encore connu (code HM… ou « Airbnb <date> ») → « ? »', M.shortName('HMABCD1234') === '?' && M.shortName('Airbnb 2026-11-02') === '?' && M.shortName('Ana Ruiz') === 'Ana R.');

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
const KEYS = ['id', 'name', 'a', 'd', 'nights', 'adults', 'children', 'infants', 'pax', 'arrival_time', 'departure_time', 'beds', 'meals', 'drinks', 'note', 'extras', 'same_day', 'orders', 'house_orders', 'next', 'next_time', 'lines'];
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
check('22/10 — extras datés pour l’équipe : jour et moment, « (2 par créneau) » quand le même nombre revient, jamais un prix',
  M.extrasLine({ items: [{ kind: 'extra', n: ['Massage 60 min'], q: 2, per: 2, unit: 550, when: [{ d: '2026-10-21', s: 'pm' }] }, { kind: 'extra', n: ['Transfert — van'], q: 2, per: 1, unit: 600, when: [{ d: '2026-10-20', s: 'pm' }, { d: '2026-10-23', s: 'am' }] }, { kind: 'extra', n: ['Massage 90 min'], q: 4, per: 2, when: [{ d: '2026-10-21', s: 'am' }, { d: '2026-10-22', s: 'ev' }] }, { kind: 'extra', n: ['Panier'], q: 1 }] })
    === '2 × Massage 60 min — mer. 21 après-midi · 2 × Transfert — van — mar. 20 après-midi, ven. 23 matin · 4 × Massage 90 min — mer. 21 matin, jeu. 22 soir (2 par créneau) · 1 × Panier',
  M.extrasLine({ items: [{ kind: 'extra', n: ['Massage 60 min'], q: 2, per: 2, when: [{ d: '2026-10-21', s: 'pm' }] }] }));
check('nuits calculées', f.nights === 3 && V.find((s) => s.name === 'Seán').nights === 7);
const th = V.find((s) => s.name === 'Arnaud D.');
check('personnes = adultes + enfants (bébés à part)', th.pax === 10 && th.infants === 1);
check('sans composition : nombre de voyageurs', V.find((s) => s.name === 'Seán').pax === 11);
check('details absent ou invalide : champs vides, pas d’erreur', th.beds === '' && V.find((s) => s.name === 'Seán').note === '');
check('rotation : arrivée le jour d’un départ signalée', V.find((s) => s.name === 'Rotation J.').same_day === true && V.find((s) => s.name === 'Seán').same_day === true && f.same_day === true, JSON.stringify(V.map((s) => [s.name, s.same_day])));
check('pas de rotation inventée', th.same_day === false);
const long = M.staffView([{ name: 'X Y', arrival: T, departure: '2026-10-14', booking_status: 'confirmed', meals: 'm'.repeat(2000), details: { staff_note: 'n'.repeat(2000) } }], T)[0];
check('textes plafonnés (repas 1500, consigne 1200 — le français traduit est plus long que l’anglais du client, 19/10)', long.meals.length === 1500 && long.note.length === 1200);
check('date du jour invalide → rien', M.staffView(ROWS, 'hier').length === 0);

// ── Lien prestataire (20/10) : commande du livret par destinataire, prochaine arrivée, rôle du lien ──
{
  const FACTS = { MEALS: [{ n: ['Petit-déjeuner', 'Breakfast'] }, { n: ['Déjeuner ou dîner (sur demande)', 'Lunch or dinner'] }, { n: ['Goûter (sur demande)'], house: true }, { n: ['Déjeuner léger (sur demande)'], house: true, big: 'off' }, { n: ['Brunch (sur demande)'], house: true, big: 'kitchen' }] };
  const ORD = { total: 3000, items: [
    { id: 'm1', kind: 'meal', n: ['Déjeuner ou dîner (sur demande)', 'Lunch or dinner (on request)'], q: 2, unit: 850, when: [{ d: '2026-10-21', s: 'd' }, { d: '2026-10-22', s: 'l' }] },
    { id: 'm2', kind: 'meal', n: ['Goûter (sur demande)', 'Afternoon tea'], q: 1, unit: 450, when: [{ d: '2026-10-22', s: 'd' }] },
    { id: 'm3', kind: 'meal', n: ['Déjeuner léger (sur demande)'], q: 1, unit: 450 },
    { id: 'm4', kind: 'meal', n: ['Brunch (sur demande)'], q: 1, unit: 850, when: [{ d: '2026-10-23', s: 'b' }] },
    { id: 'x0', kind: 'extra', n: ['Transfert aéroport'], q: 1, unit: 300 }] };
  const small = M.orderLines(ORD, FACTS, 6), big = M.orderLines(ORD, FACTS, 10), none = M.orderLines(ORD, null, 10);
  check('1–6 personnes : déjeuner/dîner au prestataire ; goûter, déjeuner léger et brunch (« maison ») à la maison ; jamais les extras ; « (sur demande) » retiré ; jour et service', small.kitchen.join('|') === '2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi' && small.house.join('|') === '1 × Goûter — jeu. 22 soir|1 × Déjeuner léger|1 × Brunch — ven. 23 brunch', small);
  check('7 personnes et plus : le brunch suit la fiche (big kitchen → prestataire), le déjeuner léger n’est plus proposé (off → absent), le goûter reste à la maison', big.kitchen.join('|') === '2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi|1 × Brunch — ven. 23 brunch' && big.house.join('|') === '1 × Goûter — jeu. 22 soir', big);
  check('sans fiche : tout au prestataire ; commande absente ou invalide : rien', none.kitchen.length === 4 && none.house.length === 0 && M.orderLines(null, FACTS, 4).kitchen.length === 0 && M.orderLines({ items: 'x' }, FACTS, 4).kitchen.length === 0);
  check('rien ne fuit par la commande : aucun prix dans les lignes', !/850|450|300/.test(JSON.stringify(small)) && !/850|450|300/.test(JSON.stringify(big)));
  const rows2 = [
    { id: 'k1', name: 'Thibaut Vauclare', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed', meals: 'Dîner du 21 : tajine.', details: { guest_orders: ORD, beds: '4 couples', drinks: 'coca', staff_note: 'Clés sous le pot.', arrival_time: '« nous atterrissons à 14h »' } },
    { id: 'k2', name: 'Seán', arrival: '2026-10-23', departure: '2026-11-01', adults: 2, booking_status: 'confirmed', details: { arrival_time: 'vers 15h30', guest_orders: { total: 300, items: [{ id: 'x0', kind: 'extra', n: ['Massage'], q: 1, unit: 300 }] } } },
    { id: 'k3', name: 'Loin', arrival: '2026-12-10', departure: '2026-12-12', adults: 2, booking_status: 'confirmed' },
  ];
  const kv = M.staffView(rows2, '2026-10-20', FACTS);
  const t1 = kv.find((s) => s.id === 'k1'), t2 = kv.find((s) => s.id === 'k2');
  check('séjour : orders / house_orders une ligne par repas, prochaine arrivée après le départ (le jour même) avec son heure', t1.orders === '2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi\nBrunch'.replace('\nBrunch', '\n1 × Brunch — ven. 23 brunch') && t1.house_orders === '1 × Goûter — jeu. 22 soir' && !!t1.next && t1.next.d === '2026-10-23' && t1.next.same_day === true && t1.next_time === 'vers 15h30' && t1.lines.orders.length === 2 && t1.lines.house_orders.length === 1 && t1.lines.next_time[0] === 'vers 15h30', t1);
  check('prochaine arrivée au-delà des 30 jours (lue, pas affichée) ; sans suivant → null', !!t2.next && t2.next.d === '2026-12-10' && t2.next.same_day === false && t2.next_time === '' && !kv.some((s) => s.id === 'k3') && M.staffView(rows2.slice(0, 1), '2026-10-20', FACTS)[0].next === null);
  const kit = M.forRole(kv, 'kitchen'), hs = M.forRole(kv, 'house');
  check('prestataire : ni couchages, ni boissons, ni extras (vidés avant toute traduction) ; ses repas, ceux de la maison, la consigne', kit[0].beds === '' && kit[0].drinks === '' && kit[0].extras === '' && kit[0].lines.beds.length === 0 && kit[0].lines.drinks.length === 0 && kit[0].lines.extras.length === 0 && kit[0].orders === t1.orders && kit[0].house_orders === t1.house_orders && kit[0].note === 'Clés sous le pot.');
  check('maison : tout comme avant, plus les repas « maison » commandés ; pas la commande du prestataire', hs[0].beds === '4 couples' && hs[0].drinks === 'coca' && hs[0].orders === '' && hs[0].lines.orders.length === 0 && hs[0].house_orders === t1.house_orders && hs[1].extras === '1 × Massage');
  check('le rôle ne modifie pas l’original', kv[0].beds === '4 couples' && kv[0].orders === t1.orders);
  check('retour « repas confirmés » : séjour visible obligatoire ; genre accepté', JSON.stringify(M.cleanReport({ kind: 'meals_ok', client_id: 'k1' }, ['k1'])) === JSON.stringify({ kind: 'meals_ok', client_id: 'k1', text: null }) && M.cleanReport({ kind: 'meals_ok' }, ['k1']) === null && M.cleanReport({ kind: 'meals_ok', client_id: 'zz' }, ['k1']) === null);
  check('fonction : rôle du lien lu et renvoyé, fiche du compte lue pour le partage, fenêtre élargie pour la prochaine arrivée ; la relecture après traduction garde le rôle', /select=id,owner_id,name,lang,role,last_seen_at/.test(fnSrc) && (fnSrc.match(/forRole\(staffView\(rows, todayIso, facts\), role\)/g) || []).length === 2 && /villa_settings\?select=house_facts,house_facts_ref/.test(fnSrc) && /WINDOW_DAYS \+ 31/.test(fnSrc) && /lang: link\.lang, role,/.test(fnSrc));
  check('traduction : commande et heure de la prochaine arrivée traduites comme le reste (LINE_FIELDS)', M.LINE_FIELDS.includes('orders') && M.LINE_FIELDS.includes('house_orders') && M.LINE_FIELDS.includes('next_time'));
  // 20/10 (parcours réel) : « ven. 23 midi, sam. 24 soir » n'est pas trois phrases ; « · » sépare des éléments ; une ligne de commande déjà montrée à part n'est pas répétée sous Repas
  check('abréviations : le point de « ven. », « sam. », « env. » ne coupe pas une phrase ; une vraie fin de phrase coupe encore', M.sentences('2 × Dîner — ven. 23 midi, sam. 24 soir').length === 1 && M.sentences('Vers 14h env. Dîner à 20h.').length === 1 && M.sentences('Pas d’allergie. Dîner à 20h.').length === 2);
  const mb = M.bulletsOf('Dîner samedi : tajine de poulet. Pas d’allergie. · 2 × Déjeuner ou dîner (sur demande) — ven. 23 midi, sam. 24 soir · 1 × Goûter (sur demande) — dim. 25', 'sentences');
  check('résumé du livret : une puce par élément « · », les dates entières', JSON.stringify(mb) === JSON.stringify(['Dîner samedi : tajine de poulet.', 'Pas d’allergie.', '2 × Déjeuner ou dîner (sur demande) — ven. 23 midi, sam. 24 soir', '1 × Goûter (sur demande) — dim. 25']), mb);
  const rows3 = [{ id: 'd1', name: 'Ana Ruiz', arrival: '2026-10-23', departure: '2026-10-26', adults: 2, booking_status: 'confirmed', meals: 'Dîner samedi : tajine de poulet. Pas d’allergie. · 2 × Déjeuner ou dîner (sur demande) — ven. 23 midi, sam. 24 soir · 1 × Goûter (sur demande) — dim. 25',
    details: { guest_orders: { total: 1750, items: [{ id: 'm1', kind: 'meal', n: ['Déjeuner ou dîner (sur demande)'], q: 2, when: [{ d: '2026-10-23', s: 'l' }, { d: '2026-10-24', s: 'd' }] }, { id: 'm2', kind: 'meal', n: ['Goûter (sur demande)'], q: 1, when: [{ d: '2026-10-25' }] }] } } }];
  const dv = M.staffView(rows3, '2026-10-20', FACTS), dk = M.forRole(dv, 'kitchen')[0], dh = M.forRole(dv, 'house')[0];
  check('prestataire : sous Repas, seulement les mots du client (ses lignes de commande sont dans orders / house_orders)', JSON.stringify(dk.lines.meals) === '["Dîner samedi : tajine de poulet.","Pas d’allergie."]' && dk.lines.orders.length === 1 && dk.lines.house_orders.length === 1, dk.lines);
  check('maison : garde la ligne du prestataire sous Repas (le service), pas le goûter déjà dans house_orders', JSON.stringify(dh.lines.meals) === '["Dîner samedi : tajine de poulet.","Pas d’allergie.","2 × Déjeuner ou dîner (sur demande) — ven. 23 midi, sam. 24 soir"]', dh.lines);
}

// ── Retours de l'équipe (staff_reports) ────────────────────────────────────
const VIS = ['s1', 's2'];
check('retour « chambres prêtes » : séjour visible obligatoire', JSON.stringify(M.cleanReport({ kind: 'rooms_ready', client_id: 's1' }, VIS)) === JSON.stringify({ kind: 'rooms_ready', client_id: 's1', text: null }) && M.cleanReport({ kind: 'rooms_ready' }, VIS) === null && M.cleanReport({ kind: 'rooms_ready', client_id: 'autre' }, VIS) === null);
check('retour « problème » : texte obligatoire, ≤ 300, espaces repliés, séjour facultatif', M.cleanReport({ kind: 'issue', text: '  fuite   salle de bain ' }, VIS).text === 'fuite salle de bain' && M.cleanReport({ kind: 'issue', text: 'x'.repeat(900), client_id: 's2' }, VIS).text.length === 300 && M.cleanReport({ kind: 'issue', text: '   ' }, VIS) === null);
check('genre inconnu refusé (rien d’autre n’est modifiable depuis ce lien)', M.cleanReport({ kind: 'price', text: '1' }, VIS) === null && M.cleanReport({ kind: 'delete', client_id: 's1' }, VIS) === null);
check('30 retours par heure et par lien, pas plus', (() => { let lim = false; for (let i = 0; i < 35; i++) if (M.limited('r:L1', 30, 3600000)) lim = true; return lim && !M.limited('r:L2', 30, 3600000); })());
check('fonction : le retour part dans staff_reports avec le propriétaire et le lien ; les seules autres écritures sont le cache des traductions (staff_i18n) et les ouvertures (staff_link_opens)', /staff_reports`, \{ method: "POST"/.test(fnSrc) && /owner_id: link\.owner_id, link_id: link\.id, client_id: rep\.client_id, kind: rep\.kind, text: rep\.text/.test(fnSrc) && (fnSrc.match(/method: "POST"/g) || []).length === 4 && /staff_i18n\?on_conflict=client_id,lang,field`, \{ method: "POST"/.test(fnSrc) && /api\.mistral\.ai\/v1\/chat\/completions", \{ method: "POST"/.test(fnSrc));
check('fonction : les retours récents du lien reviennent avec les séjours (chambres prêtes reste coché)', /staff_reports\?select=id,kind,client_id,text,created_at&link_id=eq\.\$\{link\.id\}&deleted_at=is\.null/.test(fnSrc) && /stays, reports, at:/.test(fnSrc));

// ── Fonction : requêtes ──────────────────────────────────────────────────
const sel = (fnSrc.match(/crm_clients\?select=([^&`]+)/) || [])[1] || '';
check('colonnes lues : jamais prix, notes, téléphone, email, nationalité', sel && !/price|notes|remarks|phone|email|nat\b|payout/.test(sel), sel);
check('lien retiré = plus d’accès (deleted_at)', /staff_links\?select=[^`]*token_hash=eq\.\$\{h\}&deleted_at=is\.null/.test(fnSrc));
check('jeton jamais stocké : seule l’empreinte est cherchée', !/token_hash=eq\.\$\{body\.k\}/.test(fnSrc) && /sha256hex\(body\.k\)/.test(fnSrc));
check('séjours du propriétaire du lien seulement', /user_id=eq\.\$\{link\.owner_id\}&deleted_at=is\.null/.test(fnSrc));
check('réponse jamais en cache', /"Cache-Control": "no-store"/.test(fnSrc));
check('ouverture (18/10) : last_seen_at + une ligne staff_link_opens (propriétaire, lien), au plus toutes les 30 min ; jamais quand le propriétaire ouvre lui-même le lien (owner)', /if \(body\.owner !== true && \(!link\.last_seen_at \|\| Date\.now\(\) - Date\.parse\(link\.last_seen_at\) > 30 \* 60000\)\) \{/.test(fnSrc) && /staff_link_opens`, \{ method: "POST"[^\n]*JSON\.stringify\(\{ owner_id: link\.owner_id, link_id: link\.id \}\)/.test(fnSrc));
check('écritures : last_seen_at (PATCH), les ouvertures (POST staff_link_opens), le retour de l’équipe (POST staff_reports), le cache arabe (POST staff_i18n) — jamais de DELETE, jamais crm_clients', (fnSrc.match(/method: "PATCH"/g) || []).length === 1 && !/method: "(DELETE|PUT)"/.test(fnSrc) && /last_seen_at: new Date/.test(fnSrc) && !/crm_clients[^\n]*method: "(POST|PATCH)"/.test(fnSrc));
check('même exclusion des demandes que l’Espace', (() => {
  const esp = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');
  const a = (fnSrc.match(/FIRM_OUT = \[([^\]]+)\]/) || [])[1], b = (esp.match(/FIRM_OUT = \[([^\]]+)\]/) || [])[1];
  return a && b && a.replace(/["'\s]/g, '') === b.replace(/["'\s]/g, '');
})());

// ── Page ─────────────────────────────────────────────────────────────────
const page = fs.readFileSync(path.join(root, 'equipe.html'), 'utf8');
const script = page.slice(page.indexOf('<script>'));
check('page non indexée, sans referrer', page.includes('<meta name="robots" content="noindex, nofollow">') && page.includes('<meta name="referrer" content="no-referrer">'));
check('jeton lu dans le fragment (#k=), jamais dans l’URL envoyée', /location\.hash/.test(script) && !/location\.search/.test(script) && /body: JSON\.stringify\(\{ k: S\.k, lang: isLang\(S\.lang\) \? S\.lang : 'fr', owner: ownerHere\(\) \}\)/.test(script));
check('page : le propriétaire connecté sur cet appareil (stafflo_session) est signalé (owner) — ses vérifications ne comptent pas comme des ouvertures', /function ownerHere\(\) \{ try \{ var o = JSON\.parse\(localStorage\.getItem\('stafflo_session'\)/.test(script) && /lang: isLang\(S\.lang\) \? S\.lang : 'fr', owner: ownerHere\(\) \}/.test(script));
check('tout texte échappé', /var esc = function/.test(script) && !/innerHTML = [^;]*s\.(name|meals|note|beds)/.test(script));
check('arabe : sens de lecture RTL et dates marocaines', /dir = S\.lang === 'ar' \? 'rtl' : 'ltr'/.test(script) && /'ar-MA'/.test(script));
check('noms latins isolés en arabe (<bdi>)', /<bdi>' \+ esc\(s\.name\)/.test(script));
for (const bad of ['650', '850', 'Faiza', 'Saïd', 'Bouchra', '+212', '14h', '18h', 'Palmeraie'])
  check(`aucun fait en dur : « ${bad} »`, !script.includes(bad));
check('pluriels en darija (1, 2, 3–10, 11+)', /n === 1 \? 'ليلة وحدة' : n === 2 \? 'جوج ليالي' : n <= 10/.test(script));
check('hors connexion : dernières informations gardées', /C_KEY/.test(script) && /S\.state = S\.data \? 'offline'/.test(script));
check('lien invalide : message clair, cache effacé', /x\.status === 404/.test(script) && /store\.set\(C_KEY, null\)/.test(script));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
check('sw.js ne met pas equipe.html en cache', sw.includes("url.includes('equipe.html')"));

// ── Lisible et en arabe (18/10/2026) ──────────────────────────────────────
{
  const st = M.staffView([{ id: 'c1', name: 'Thibaut Vauclare', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed',
    meals: 'Mercredi 21, dîner vers 19h30 : tajine de kefta, semoule ; dessert : pâtisseries. Jeudi 22, déjeuner : kebabs. Pas d’allergie.',
    details: { arrival_time: '« nous atterrissons à 14h »', drinks: '12 eaux plates, 2 vins rouges (vins marocains, choisis par nous)', staff_note: 'Départ à 6h30 : petit-déjeuner préparé la veille. Pas de transfert.',
      guest_orders: { items: [{ kind: 'extra', n: ['Transfert aéroport', 'Airport transfer'], q: 1 }, { kind: 'extra', n: ['Massage', 'Massage'], q: 2 }] } } }], '2026-10-17');
  const L = st[0].lines;
  check('lines : repas une phrase par ligne, boissons un article par ligne (parenthèses respectées), consigne par phrase, extras un par ligne, heure nettoyée',
    L.meals.length === 3 && L.meals[0] === 'Mercredi 21, dîner vers 19h30 : tajine de kefta, semoule ; dessert : pâtisseries.' && L.drinks.join('|') === '12 eaux plates|2 vins rouges (vins marocains, choisis par nous)' &&
    L.note.length === 2 && L.extras.join('|') === '1 × Transfert aéroport|2 × Massage' && L.arrival_time.join('|') === 'atterrissage 14h' && L.beds.length === 0 && L.departure_time.length === 0, JSON.stringify(L));
  check('bulletsOf : lignes à puces déjà écrites gardées une par une, 400 caractères au plus', M.bulletsOf('- un\n• deux\n' + 'x'.repeat(500), 'sentences').length === 3 && M.bulletsOf('- un\n• deux', 'sentences').join('|') === 'un|deux' && M.bulletsOf('', 'list').length === 0);
  // Traduction : un seul appel pour tout ce qui manque, lignes alignées, cache par empreinte
  const calls = [], writes = [];
  const fake = async (_sys, user) => { calls.push(JSON.parse(user)); const req = JSON.parse(user).lines; const o = {}; for (const k of Object.keys(req)) o[k] = 'AR[' + req[k] + ']'; return JSON.stringify({ lines: o }); };
  let out = await M.withArabic(st, 'o1', async () => [], async (rows) => { writes.push(...rows); }, fake);
  check('cache vide : un seul appel Mistral pour tous les champs, chaque ligne traduite et alignée', calls.length === 1 && Object.keys(calls[0].lines).length === 3 + 2 + 2 + 2 + 1 && out[0].ar && out[0].ar.meals.length === 3 && out[0].ar.meals[1] === 'AR[Jeudi 22, déjeuner : kebabs.]' && out[0].ar.drinks[1] === 'AR[2 vins rouges (vins marocains, choisis par nous)]' && out[0].ar.arrival_time[0] === 'AR[atterrissage 14h]', JSON.stringify(out[0].ar));
  check('cache écrit : une ligne par (séjour, champ), lang ar, empreinte du français, propriétaire', writes.length === 5 && writes.every((w) => w.owner_id === 'o1' && w.client_id === 'c1' && w.lang === 'ar' && /^[0-9a-f]{16}$/.test(w.src_hash) && Array.isArray(w.lines)) && writes.map((w) => w.field).sort().join() === 'arrival_time,drinks,extras,meals,note', JSON.stringify(writes.map((w) => w.field)));
  check('la demande à Mistral ne contient ni nom de client, ni prix, ni téléphone', !/Thibaut|Vauclare|MAD|€|\+44/.test(JSON.stringify(calls[0])));
  const cache = writes.map((w) => ({ client_id: w.client_id, field: w.field, src_hash: w.src_hash, lines: w.lines }));
  calls.length = 0; writes.length = 0;
  out = await M.withArabic(st, 'o1', async () => cache, async (rows) => { writes.push(...rows); }, fake);
  check('cache complet : aucun appel, rien d’écrit, les traductions viennent du cache', calls.length === 0 && writes.length === 0 && out[0].ar.meals[2] === 'AR[Pas d’allergie.]');
  const st2 = M.staffView([{ id: 'c1', name: 'Thibaut Vauclare', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed', meals: 'Nouveau menu.', details: { arrival_time: '« nous atterrissons à 14h »', drinks: '12 eaux plates, 2 vins rouges (vins marocains, choisis par nous)', staff_note: 'Départ à 6h30 : petit-déjeuner préparé la veille. Pas de transfert.' } }], '2026-10-17');
  calls.length = 0; writes.length = 0;
  out = await M.withArabic(st2, 'o1', async () => cache, async (rows) => { writes.push(...rows); }, fake);
  check('repas modifié dans l’Espace : seul ce champ repasse par Mistral et est réécrit ; les autres restent du cache ; l’extra disparu n’est pas traduit', calls.length === 1 && Object.keys(calls[0].lines).join() === 'c1|meals|0' && writes.length === 1 && writes[0].field === 'meals' && out[0].ar.meals[0] === 'AR[Nouveau menu.]' && out[0].ar.drinks.length === 2 && !out[0].ar.extras, JSON.stringify({ calls, w: writes.map((w) => w.field), ar: out[0].ar }));
  out = await M.withArabic(st2, 'o1', async () => [], async () => {}, async () => null);
  check('Mistral en panne ou sans clé : pas de `ar`, le français reste, aucune erreur', !out[0].ar && out[0].lines.meals[0] === 'Nouveau menu.');
  out = await M.withArabic(st2, 'o1', async () => [], async () => {}, async () => '{"lines":{"c1|meals|0":"ok"}}');
  check('réponse partielle : seuls les champs entièrement traduits sont gardés (lignes alignées une à une)', out[0].ar && out[0].ar.meals[0] === 'ok' && !out[0].ar.drinks && !out[0].ar.note);
  const tr = await M.translateAr([{ id: 'c9', field: 'note', lines: Array.from({ length: 30 }, (_x, i) => 'Phrase numéro ' + i + ' ' + 'a'.repeat(300) + '.') }], fake);
  check('plus de 6 000 caractères : le reste attend le passage suivant (coupe nette, jamais une ligne tronquée)', Object.keys(tr).length < 30 && Object.keys(tr).length > 10 && Object.values(tr).every((v) => /^AR\[Phrase numéro \d+ a+\.\]$/.test(v)));
}

// ── Une seule langue (20/10/2026) : la version française de l'Espace (details.fr), la darija, le garde-fou des nombres ──
{
  const EN = 'There are 4 couples and then 2 siblings.', FRB = 'Il y a 4 couples puis 2 frères et sœurs.', DR = 'For drinks, would it be possible to have: Coke Zero, Iced tea';
  const rows = [{ id: 'c2', name: 'Elias Moreau', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed', meals: 'Could we do dinner on Monday 26th?',
    details: { beds: EN, drinks: DR, arrival_time: '« Most of the group will arrive late (likely after 9pm) »',
      fr: { beds: { src: EN, fr: FRB }, meals: { src: 'Une autre version', fr: 'Ancienne traduction' }, drinks: { src: DR, fr: "Pour les boissons, serait-il possible d'avoir : Coca Zéro, thé glacé" } } } }];
  const s3 = M.staffView(rows, '2026-10-17')[0];
  check('vue équipe : la version française de l’Espace (details.fr) quand l’original n’a pas changé, sinon l’original ; boissons sans la phrase d’introduction',
    s3.beds === FRB && s3.meals === 'Could we do dinner on Monday 26th?' && s3.lines.drinks.join('|') === 'Coca Zéro|thé glacé', JSON.stringify(s3.lines));
  check('« la plupart du groupe … après 9pm » : la phrase entière, jamais l’heure seule', /Most of the group will arrive late/.test(s3.arrival_time), s3.arrival_time);
  check('menu d’un bloc : une ligne par plat', M.bulletsOf('Pour les 3 dîners : Entrées - salade, zaalouk Plats - tajine Desserts - cornes de gazelle', 'sentences').join('|') === 'Pour les 3 dîners :|Entrées - salade, zaalouk|Plats - tajine|Desserts - cornes de gazelle');
  let sys = '';
  const fake2 = async (sy, user) => { sys = sy; const req = JSON.parse(user).lines; const o = {}; for (const k of Object.keys(req)) o[k] = /beds/.test(k) ? 'كاين 5 كوبلات و 2 خوت' : 'د ' + req[k]; return JSON.stringify({ lines: o }); };
  const w2 = []; const o2 = await M.withArabic([s3], 'o1', async () => [], async (r) => { w2.push(...r); }, fake2);
  check('darija marocaine (futur « غادي »), plus l’arabe standard, dans la consigne de traduction', /darija/.test(sys) && /غادي/.test(sys) && !/arabe standard simple/.test(sys));
  check('zéro invention : une traduction qui change un nombre (4 → 5 couples) est écartée — ce champ reste en français, les autres traduits', !!o2[0].ar && !o2[0].ar.beds && !!o2[0].ar.drinks && !w2.some((w) => w.field === 'beds'), JSON.stringify(o2[0].ar));
  check('nombres : chiffres arabes orientaux, « 9pm » = 21, 14h = 14:00 ; un nombre changé se voit', M.sameNums('après 21h, 4 couples', 'بعد ٢١:٠٠، ٤ كوبلات') && M.sameNums('after 9pm', 'après 21h') && M.sameNums('vers 14h', 'تقريبا 14:00') && !M.sameNums('4 couples', '5 كوبلات'));
  const old = [{ client_id: 'c2', field: 'drinks', src_hash: await M.hashOf(s3.lines.drinks.join('\n')), lines: ['قديم', 'قديم'] }];
  sys = ''; const o3 = await M.withArabic([s3], 'o1', async () => old, async () => {}, fake2);
  check('cache d’avant (arabe standard, empreinte sans version) : retraduit en darija au passage suivant', !!sys && !!o3[0].ar && o3[0].ar.drinks[0] !== 'قديم');
}

// ── Lien de l'équipe dans UNE langue (20/10/2026, cas réel Seán) : en français, l'anglais du client traduit ; en arabe, tout ;
//    la traduction ne bloque plus la page (arrière-plan, `pending`), par morceaux, ministral d'abord ──
{
  const rows = [{ id: 's1', name: 'Seán', arrival: '2026-10-25', departure: '2026-11-01', adults: 10, infants: 1, booking_status: 'confirmed',
    meals: 'Could we do dinner on Monday 26th, Friday 30th and Saturday 31st? For the 3 dinners could we have: Starters - mechouia salad, zaalouk Mains - lamb tajine Desserts - gazelle horns',
    details: { beds: 'There are 4 couples and then 2 siblings, who would be sharing the room with the single beds.', drinks: 'Coke Zero, Iced tea, Waters', arrival_time: '« Most of the group will arrive quite late on the 25th (likely after 9pm) »', staff_note: 'Berceau dans la chambre du jardin.' } },
    { id: 't1', name: 'Thibaut Vauclare', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed', meals: 'Mercredi 21, dîner vers 19h30 : tajine de kefta. Pas d’allergie.', details: {} }];
  const st = M.staffView(rows, '2026-10-20').sort((x, y) => (x.id === 's1' ? -1 : 1)); // Seán d'abord (la vue trie par arrivée)
  check('détecteur : anglais → à traduire en français ; français, heure seule → non ; tout texte latin → à traduire en arabe, l’arabe → non',
    M.needsTr('fr', st[0].lines.meals) && M.needsTr('fr', st[0].lines.beds) && M.needsTr('fr', ['Coke Zero', 'Iced tea', 'Waters']) && !M.needsTr('fr', st[0].lines.note) && !M.needsTr('fr', st[1].lines.meals) && !M.needsTr('fr', ['15h30']) &&
    M.needsTr('ar', st[1].lines.meals) && !M.needsTr('ar', ['غادي يوصلو مع 21:00']) && !M.needsTr('ar', ['12']), '');
  let sys = '', calls = 0; const writes = [];
  const fr = async (sy, user) => { sys = sy; calls++; const req = JSON.parse(user).lines, o = {}; for (const k of Object.keys(req)) o[k] = 'FR ' + req[k].replace('9pm', '21h'); return JSON.stringify({ lines: o }); };
  let r = await M.withTr('fr', st, 'o1', async () => [], async (w) => { writes.push(...w); }, fr);
  check('français : la page reçoit tout de suite ce qui est en cache (rien encore), `pending` = champs anglais à traduire, la traduction part à côté (job)',
    r.pending === 5 && !!r.job && !r.stays[0].fr && calls <= 1, r.pending); // 5 : les 4 champs de Seán + l'heure de la prochaine arrivée (Seán, en anglais) sur la carte de Thibaut (20/10)
  const done = await r.job;
  check('français : SEULS les champs du client en anglais partent (repas, couchages, boissons, arrivée) — pas la consigne ni les repas en français de Thibaut ; jamais le nom',
    /Tu traduis en français/.test(sys) && done.length === 5 && done.every((w) => w.lang === 'fr') && done.filter((w) => w.client_id === 's1').map((w) => w.field).sort().join() === 'arrival_time,beds,drinks,meals' && writes.filter((w) => w.client_id === 't1').map((w) => w.field).join() === 'next_time', done.map((w) => w.client_id + ':' + w.field));
  r = await M.withTr('fr', st, 'o1', async () => writes, async () => {}, async () => { throw new Error('ne doit pas être appelé'); });
  check('rechargement : les traductions françaises viennent du cache, pending 0, la consigne (déjà en français) sans `fr`',
    r.pending === 0 && !r.job && r.stays[0].fr && r.stays[0].fr.beds[0].startsWith('FR There are') && r.stays[0].fr.arrival_time[0].includes('21h') && !r.stays[0].fr.note && Object.keys(r.stays[1].fr || {}).join() === 'next_time', JSON.stringify(r.stays[0].fr));
  // une traduction qui change un nombre : cette ligne reste en anglais, les autres lignes du champ sont traduites
  const bad = async (_sy, user) => { const req = JSON.parse(user).lines, o = {}; for (const k of Object.keys(req)) o[k] = /Monday 26th/.test(req[k]) ? 'Dîner lundi 27' : 'FR ' + req[k]; return JSON.stringify({ lines: o }); };
  const w3 = []; r = await M.withTr('fr', M.staffView(rows.slice(0, 1).map((x) => ({ ...x, id: 's2' })), '2026-10-20'), 'o1', async () => [], async (w) => { w3.push(...w); }, bad); await r.job;
  const ml = (w3.find((w) => w.field === 'meals') || {}).lines || [];
  check('nombre changé (26 → 27) : cette ligne reste celle du client, les autres lignes du même champ sont traduites', ml.length === 5 && /Monday 26th/.test(ml[0]) && ml.slice(1).every((x) => x.startsWith('FR ')), JSON.stringify(ml));
  // gros séjours : plusieurs morceaux, chaque morceau écrit dès qu'il arrive
  const big = M.staffView([{ id: 'b1', name: 'X Y', arrival: '2026-10-25', departure: '2026-11-01', adults: 2, booking_status: 'confirmed', meals: Array.from({ length: 12 }, (_x, i) => 'Could we have dinner number ' + (i + 2) + ' with ' + 'a lot of food '.repeat(8) + '.').join(' '), details: { staff_note: Array.from({ length: 6 }, (_x, i) => 'Please prepare room ' + (i + 2) + ' ' + 'with care and flowers '.repeat(6) + '.').join(' ') } }], '2026-10-20');
  const parts = M.chunks([{ id: 'b1', field: 'meals', lines: big[0].lines.meals }, { id: 'b1', field: 'note', lines: big[0].lines.note }, { id: 'b2', field: 'beds', lines: ['x'.repeat(50)] }], 1800);
  check('morceaux : jamais un champ coupé, plusieurs appels si besoin', parts.length === 2 && parts[0].length === 1 && parts[1].length === 2, parts.map((p) => p.map((x) => x.field)));
  check('modèles : ministral-14b d’abord (le seul qui répond sur ce compte), medium plus essayé', M.AR_MODELS[0] === 'ministral-14b-2512' && !M.AR_MODELS.includes('mistral-medium-latest'));
  // en panne : pending puis plus d'appel à chaque rechargement (réessai plus tard), la langue d'origine reste
  let n = 0; const down = async () => { n++; return null; };
  const sd = M.staffView(rows.slice(0, 1).map((x) => ({ ...x, id: 's9' })), '2026-10-20');
  r = await M.withTr('ar', sd, 'o9', async () => [], async () => {}, down); await r.job;
  const n1 = n; r = await M.withTr('ar', sd, 'o9', async () => [], async () => {}, down);
  check('Mistral en panne : un essai, puis pas de nouvel appel à chaque rechargement (réessai dans 10 min) ; pas de `ar`, aucune erreur', n1 >= 1 && !r.job && n === n1 && !r.stays[0].ar && r.pending === 0, { n1, n, p: r.pending });
  // pendant qu'une traduction tourne, un autre rechargement dit `pending` sans relancer
  let release; const slow = (sy, user) => new Promise((ok) => { release = () => ok(fr(sy, user)); });
  const ss = M.staffView(rows.slice(0, 1).map((x) => ({ ...x, id: 's8' })), '2026-10-20');
  const r1 = await M.withTr('ar', ss, 'o8', async () => [], async () => {}, slow);
  const r2 = await M.withTr('ar', ss, 'o8', async () => [], async () => {}, slow);
  check('traduction en cours : le rechargement suivant dit `pending` (la page réessaiera) sans lancer un second appel', !!r1.job && !r2.job && r2.pending === r1.pending && r1.pending === 5, { p1: r1.pending, p2: r2.pending });
  release(); await r1.job;
  // seconde chance : une ligne dont un nombre a bougé repart seule, avec les nombres rappelés ; réussie → traduite
  let tries2 = 0;
  const flaky = async (sy, user) => { tries2++; const req = JSON.parse(user).lines, o = {}; for (const k of Object.keys(req)) o[k] = /Monday 26th/.test(req[k]) && !/ATTENTION/.test(sy) ? 'Dîner lundi 27' : 'FR ' + req[k]; return JSON.stringify({ lines: o }); };
  const w4 = []; r = await M.withTr('fr', M.staffView(rows.slice(0, 1).map((x) => ({ ...x, id: 's3' })), '2026-10-20'), 'o1', async () => [], async (w) => { w4.push(...w); }, flaky); await r.job;
  const m4 = (w4.find((w) => w.field === 'meals') || {}).lines || [];
  check('nombre changé : seconde chance pour cette ligne seule (nombres rappelés) → traduite cette fois, sans rien inventer', tries2 === 2 && m4.length === 5 && m4.every((x) => x.startsWith('FR ')), { tries2, m4 });
  check('« marocain » traduit « موريتاني » (mauritanien, vu le 20/10) : corrigé en « مغربي » ; un vrai « mauritanien » reste', M.fixAr('assortiment de pâtisseries marocaines', 'حلويات موريتانية') === 'حلويات مغربية' && M.fixAr('kebabs marocains', 'كباب الموريتاني') === 'كباب المغربي' && M.fixAr('thé mauritanien', 'أتاي موريتاني') === 'أتاي موريتاني' && M.fixAr('assorted Morrocon pastries', 'حلويات موريتانية') === 'حلويات مغربية');
}

// 22/10/2026 — troisième langue : l'anglais (équipe qui ne lit ni le français ni la darija, ex. villa en Thaïlande)
{
  const rows = [{ id: 'e1', name: 'Seán Hickey', arrival: '2026-10-25', departure: '2026-10-30', adults: 8, booking_status: 'confirmed',
    meals: 'Mercredi 21, dîner vers 19h30 : tajine de kefta. Pas d’allergie.', details: { beds: 'There are 4 couples and 2 siblings.', drinks: 'Coke Zero, Iced tea, Waters', staff_note: 'Berceau dans la chambre du jardin.' } }];
  const st = M.staffView(rows, '2026-10-20');
  check('anglais : détecteur — le français (repas, consigne) est à traduire, l’anglais (couchages, boissons) non, l’arabe oui, une heure seule non',
    M.notEnglish('Mercredi 21, dîner vers 19h30 : tajine de kefta.') && M.needsTr('en', st[0].lines.meals) && M.needsTr('en', st[0].lines.note) && !M.needsTr('en', st[0].lines.beds) && !M.needsTr('en', st[0].lines.drinks) &&
    M.needsTr('en', ['غادي يوصلو مع 21:00 الليل']) && !M.needsTr('en', ['14:00']) && !M.notEnglish('tea coffee water'));
  let sys = ''; const writes = [];
  const en = async (sy, user) => { sys = sy; const req = JSON.parse(user).lines, o = {}; for (const k of Object.keys(req)) o[k] = 'EN ' + req[k].replace('19h30', '19:30'); return JSON.stringify({ lines: o }); };
  const r = await M.withTr('en', st, 'o1', async () => [], async (w) => { writes.push(...w); }, en);
  await r.job;
  check('anglais : consigne anglaise, cache staff_i18n en lang en, empreinte versionnée en-1|, lignes reçues', /plain, faithful English/.test(sys) && writes.length === 2 && writes.every((w) => w.lang === 'en') && writes.find((w) => w.field === 'meals').lines[0] === 'EN Mercredi 21, dîner vers 19:30 : tajine de kefta.' && M.TR_V.en === 'en-1|', writes.map((w) => w.field));
  check('service : body.lang = en accepté, lien créé en anglais → en', /body\.lang === "ar" \|\| body\.lang === "fr" \|\| body\.lang === "en" \? body\.lang : \(link\.lang === "ar" \? "ar" : link\.lang === "en" \? "en" : "fr"\)/.test(fnSrc));
  check('page : trois langues (FR · EN · عربية), libellés anglais écrits à la main, locale en-GB', /var LANGS = \['fr', 'en', 'ar'\]/.test(script) && /title: 'Villa schedule'/.test(script) && /S\.lang === 'en' \? 'en-GB'/.test(script) && /data-l="' \+ x \+ '"/.test(page));
}

// 22/10/2026 — même texte, même traduction : la « prochaine arrivée » (next_time) reprend la traduction de l'heure d'arrivée du séjour suivant (cas réel : page française de Saïd, anglais de Seán)
{
  const q = '« Most of the group will arrive quite late on the 25th (likely after 9pm) »';
  const rows = [{ id: 'th', name: 'Thibaut V', arrival: '2026-10-19', departure: '2026-10-23', adults: 10, booking_status: 'confirmed', meals: 'Mercredi 21, dîner.', details: {} },
    { id: 'se', name: 'Seán', arrival: '2026-10-25', departure: '2026-11-01', adults: 8, booking_status: 'confirmed', details: { arrival_time: q } }];
  const st = M.staffView(rows, '2026-10-22');
  const h = await M.hashOf(M.TR_V.fr + q);
  const cache = [{ client_id: 'se', field: 'arrival_time', lang: 'fr', src_hash: h, lines: ['« La plupart du groupe arrivera tard le 25 (probablement après 21h) »'] }];
  let calls = 0;
  const r = await M.withTr('fr', st, 'o1', async () => cache, async () => {}, async (sy, u) => { calls++; return null; });
  const th = r.stays.find((x) => x.id === 'th'), se = r.stays.find((x) => x.id === 'se');
  check('next_time de Thibaut traduit tout de suite depuis l’heure d’arrivée de Seán (même empreinte), aucun appel', !r.job && calls === 0 && th.fr && th.fr.next_time[0] === '« La plupart du groupe arrivera tard le 25 (probablement après 21h) »' && se.fr && se.fr.arrival_time[0].startsWith('« La plupart'), th.fr);
  const r2 = await M.withTr('fr', st, 'o1', async () => [], async () => {}, async () => null);
  check('sans cache : les deux champs partent (une seule fois chacun), rien d’inventé', r2.pending === 2 && !th.en);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
