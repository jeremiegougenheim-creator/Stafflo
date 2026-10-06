// Évals de planning.html — générateur des plannings équipe (Saïd, Léa).
//   node tests/evals-planning.mjs
//
// Écrites AVANT l'implémentation. Rejouent les dates et compositions réelles
// d'octobre 2026, ANONYMISÉES (le dépôt est public : aucun nom de client ici).
// Les sorties attendues sont reprises des plannings validés à la main le
// 06/10/2026 ; chaque écart qui avait été corrigé ce jour-là a sa propre éval.
//
// Règle produit testée en premier : la page n'invente rien. Un champ absent
// de la fiche ou des réglages sort en « ? », jamais en valeur plausible.
import { spawnSync } from 'node:child_process';
if (process.env.TZ !== 'UTC') {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { TZ: 'UTC' })
  });
  process.exit(r.status == null ? 1 : r.status);
}

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'planning.html'), 'utf8');
const m = src.match(/<script id="logic">([\s\S]*?)<\/script>/);
if (!m) { console.error('bloc <script id="logic"> introuvable'); process.exit(1); }
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const PL = ctx.PL;
if (!PL) { console.error('PL non exposé par le bloc logic'); process.exit(1); }

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL — ' + label + (detail ? '\n       ' + detail : '')); }
}
const has = (txt, needle, label) => ok(txt.includes(needle), label, 'attendu : ' + JSON.stringify(needle));
const hasNot = (txt, needle, label) => ok(!txt.includes(needle), label, 'interdit : ' + JSON.stringify(needle));

// ── Fixture : fiches CRM (forme réelle de crm_clients, noms anonymisés) ─────
const ROWS = [
  { id: 'a', name: 'Alpha Un',   arrival: '2026-10-07', departure: '2026-10-10', guests: 5,  adults: null, children: null, infants: null, details: { livretSentAt: '2026-09-20T22:43:20.649Z' } },
  { id: 'b', name: 'Bravo Deux', arrival: '2026-10-13', departure: '2026-10-16', guests: 7,  adults: 7, children: 0, infants: 0, details: { livretSentAt: '2026-10-05T13:20:20.414Z' } },
  { id: 'c', name: 'Charlie',    arrival: '2026-10-19', departure: '2026-10-23', guests: 10, adults: 10, children: 0, infants: 0, details: { livretSentAt: '2026-10-05T12:18:55.499Z' } },
  { id: 'd', name: 'Delta',      arrival: '2026-10-25', departure: '2026-11-01', guests: 11, adults: 10, children: 0, infants: 1, details: { livretSentAt: '2026-09-27T15:27:53.023Z' } },
  { id: 'e', name: 'Echo',       arrival: '2026-12-22', departure: '2026-12-27', guests: 10, adults: 7, children: 3, infants: null, details: { livretSentAt: '2026-09-25T20:06:11.726Z' } },
  { id: 'f', name: 'Foxtrot',    arrival: '2026-12-29', departure: '2027-01-03', guests: 9,  adults: 7, children: 2, infants: 0, details: {} },
  { id: 'g', name: 'Golf',       arrival: '2027-03-26', departure: '2027-04-03', guests: 4,  adults: 4, children: 0, infants: 0, details: null },
  { id: 'h', name: 'Hotel',      arrival: '2027-04-10', departure: '2027-04-17', guests: 11, adults: 6, children: 2, infants: 3, details: { livretSentAt: '2026-09-27T10:42:58.397Z' } },
  { id: 'i', name: 'India',      arrival: '2027-04-27', departure: '2027-05-04', guests: 9,  adults: 8, children: 1, infants: 1, details: {} },
];

const OPS = {
  a: { nom: 'Groupe A', heure: '13h', depart: '15h30', chambres: 'les 5 en lit double',
       petitdej: "jben, olives, huile d'olive et yaourt",
       repas: [
         { date: '2026-10-07', moment: 'brunch',   heure: '13h',   statut: 'confirmé' },
         { date: '2026-10-07', moment: 'dîner',    heure: '19h30', statut: 'confirmé' },
         { date: '2026-10-10', moment: 'déjeuner', heure: '13h',   statut: 'confirmé' } ] },
  b: { nom: 'Groupe B' },
  c: { nom: 'Groupe C', heure: '15h30', chambres: 'répartition validée avec eux',
       repas: [
         { date: '2026-10-21', moment: 'dîner',    statut: 'en attente' },
         { date: '2026-10-22', moment: 'déjeuner', statut: 'en attente' } ] },
  d: { nom: 'Groupe D', heure: '21h30', chambres: '4 couples + 2 lits simples (ch. 4)', petitdej: 'yaourt' },
  e: { nom: 'Groupe E' }, f: { nom: 'Groupe F' }, g: { nom: 'Groupe G' },
  h: { nom: 'Groupe H' }, i: { nom: 'Groupe I' },
};

const TODAY = '2026-10-06';
const cfg = PL.defaultCfg();
const all = PL.buildStays(ROWS, OPS);
const win = PL.inWindow(all, TODAY, '2026-11-01');

// ── 1. Découpage Saïd : un message général + un par séjour ──────────────────
const said = PL.saidMessages(win, all, cfg);
ok(said.length === 5, 'Saïd : 5 messages pour 4 séjours (1 général + 4)', 'obtenu : ' + said.length);
const [g, mA, mB, mC, mD] = said.map(x => x.text);

// ── 2. Message général ──────────────────────────────────────────────────────
has(g, '*LES 4 GROUPES*', 'général : titre groupes');
has(g, '• Mer. 7 → sam. 10 · Groupe A · 5 voyageurs (composition ?)', 'général : composition absente → « ? », pas « 5 adultes »');
has(g, '• Dim. 25 → dim. 1er nov. · Groupe D · 10 adultes + 1 bébé', 'général : séjour à cheval sur deux mois, « 1er »');
has(g, '• Sam. 10, 16h : enlèvement → retour dim. 11, 13h · ménage complet le 11 ou le 12', 'général : rotation à deux jours');
has(g, '• Ven. 23, 16h : enlèvement → retour sam. 24, 13h · ménage complet le 24 — *une seule journée avant le groupe suivant*', 'général : rotation serrée');
has(g, '• Jeu. 29, 16h : enlèvement en cours de séjour → retour ven. 30, 13h', 'général : changement en cours de séjour (7 nuits)');
has(g, '• Dim. 1er nov., 16h : enlèvement → retour lun. 2, 13h · ménage complet le 2', 'général : dernier départ, mois affiché');
has(g, 'sauf le 19 et le 25 octobre', 'général : exceptions d\'horaires calculées (pause, après 21h)');
// Dépôt public : les rappels viennent uniquement des réglages (navigateur),
// plus la ligne d'horaires calculée — aucune consigne codée en dur.
const rappelsCfg = cfg.rappels.split('\n').filter(l => l.trim()).length;
const rappelsMsg = g.split('*RAPPELS POUR TOUS LES GROUPES*')[1].split('\n').filter(l => l.startsWith('• ')).length;
ok(rappelsMsg === rappelsCfg + 1, 'général : rappels = réglages + ligne horaires, rien d\'autre', rappelsMsg + ' vs ' + (rappelsCfg + 1));

// ── 3. Champs absents → « ? » (règle zéro invention) ────────────────────────
has(mB, '_Chambres_ : ?', 'B : chambres absentes → ?');
has(mB, '_Arrivée_ : ?', 'B : arrivée absente → ?');
has(mB, '_Repas_ : ?', 'B : repas absents → ?');
has(mB, '_Transport_ : ?', 'B : transport absent → ?');
for (const [k, t] of [['général', g], ['A', mA], ['B', mB], ['C', mC], ['D', mD]]) {
  for (const bad of ['undefined', 'null', 'NaN', '[object']) hasNot(t, bad, k + ' : pas de « ' + bad + ' »');
}

// ── 4. Messages par séjour ──────────────────────────────────────────────────
has(mC, '*GROUPE 3 (4/5) — GROUPE C*', 'C : en-tête numéroté');
has(mC, '*Lundi 19 → vendredi 23 octobre · 10 adultes*', 'C : dates longues');
has(mC, 'vers 15h30', 'C : heure d\'arrivée normalisée');
has(mC, 'pendant la pause', 'C : arrivée pendant la pause signalée à Saïd');
has(mC, '*APRÈS LEUR DÉPART — une seule journée avant le groupe suivant*', 'C : rotation serrée dans le message');
has(mC, 'Lits pour Groupe D : 4 couples + 2 lits simples (ch. 4).', 'C : lits du groupe suivant repris de sa fiche');
has(mC, "Si le linge n'est pas là à 13h", 'C : consigne linge sur rotation serrée');
has(mA, "Lits selon la répartition de Groupe B, que je t'envoie.", 'A : répartition suivante inconnue → pas inventée');
has(mA, "jben, olives, huile d'olive et yaourt", 'A : petit-déjeuner à acheter repris tel quel');
has(mD, '*JEUDI 29 — CHANGEMENT DU LINGE*', 'D : bloc changement de linge (jeux de draps non renseignés)');
has(mD, 'après les horaires', 'D : arrivée tardive signalée à Saïd');

// ── 5. Points à vérifier ────────────────────────────────────────────────────
const chk = PL.checks(all, cfg, TODAY);
const find = (id, needle, lvl) => chk.find(c => c.id === id && c.txt.includes(needle) && (!lvl || c.lvl === lvl));
ok(!chk.some(c => c.lvl === 'err'), 'aucune erreur bloquante sur les données réelles', JSON.stringify(chk.filter(c => c.lvl === 'err')));
ok(find('c', 'une seule journée', 'warn'), 'C → D : rotation serrée signalée');
ok(find('c', 'Heure de départ', 'warn'), 'C : heure de départ inconnue sur rotation serrée');
ok(find('e', 'une seule journée', 'warn'), 'E → F : rotation serrée du 28 décembre');
ok(find('c', 'pause', 'warn'), 'C : arrivée pendant la pause');
ok(find('d', 'après les horaires', 'warn'), 'D : arrivée après 21h');
ok(find('d', 'jeudi 29 octobre', 'warn'), 'D : changement de linge, nombre de jeux inconnu');
ok(find('d', 'samedi 31 octobre', null) && find('d', "Fête de l'Unité", null), 'D : 31 octobre férié (Fête de l\'Unité)');
ok(find('f', 'vendredi 1er janvier', null), 'F : 1er janvier férié');
ok(find('i', 'samedi 1er mai', null), 'I : 1er mai férié');
ok(find('a', 'Composition', 'warn'), 'A : composition absente');
ok(find('h', '3 bébés', 'warn'), 'H : 3 bébés au-delà des 2 berceaux');
ok(!find('a', 'Livret', null), 'A : petit-déjeuner renseigné → plus d\'alerte livret');
ok(find('c', 'yaourt', 'warn'), 'C : livret enregistré avant le retrait du yaourt');
ok(!find('c', 'jben', null), 'C : jben retiré avant son livret → pas cité');
ok(find('e', 'jben', 'warn') && find('e', 'yaourt', 'warn'), 'E : livret ancien, tout le petit-déjeuner retiré');
ok(!find('b', 'Livret', null), 'B : livret récent → aucune alerte');
ok(find('f', 'Aucun livret', 'info'), 'F : aucun livret enregistré');
ok(!find('c', 'dîner', 'warn'), 'C : repas dans 15 jours → pas d\'alerte de délai');

// Délai : un repas en attente à moins de 2 jours est signalé, le goûter à la veille seulement
const late = PL.checks(PL.buildStays(ROWS, { c: { repas: [
  { date: '2026-10-20', moment: 'dîner', statut: 'en attente' },
  { date: '2026-10-20', moment: 'goûter', statut: 'en attente' } ] } }), cfg, '2026-10-19');
ok(late.some(c => c.id === 'c' && c.txt.includes('Dîner') && c.lvl === 'warn'), 'délai : dîner du lendemain non confirmé → alerte');
ok(!late.some(c => c.id === 'c' && c.txt.includes('Goûter')), 'délai : goûter du lendemain → la veille suffit, pas d\'alerte');

// Repas hors séjour → erreur
const out = PL.checks(PL.buildStays(ROWS, { c: { repas: [{ date: '2026-10-30', moment: 'dîner', statut: 'confirmé' }] } }), cfg, TODAY);
ok(out.some(c => c.id === 'c' && c.lvl === 'err' && c.txt.includes('hors du séjour')), 'repas daté hors du séjour → erreur');

// Un seul jeu de draps → erreur, et le bloc impossible disparaît du message
const cfg1 = Object.assign({}, cfg, { jeux: 1 });
ok(PL.checks(all, cfg1, TODAY).some(c => c.id === 'd' && c.lvl === 'err'), 'un seul jeu de draps + 7 nuits → erreur');
const saidD1 = PL.saidMessages(win, all, cfg1)[4].text;
hasNot(saidD1, 'CHANGEMENT DU LINGE', 'un seul jeu : pas de consigne impossible envoyée à Saïd');

// Chevauchement → erreur
const clash = PL.checks(PL.buildStays([
  { id: 'x', name: 'X', arrival: '2026-11-10', departure: '2026-11-12', adults: 2, children: 0, infants: 0 },
  { id: 'y', name: 'Y', arrival: '2026-11-13', departure: '2026-11-15', adults: 2, children: 0, infants: 0 } ], {}), cfg, TODAY);
ok(clash.some(c => c.id === 'x' && c.lvl === 'err'), 'aucun jour de battement → erreur');

// ── 6. Message Léa ──────────────────────────────────────────────────────────
const lea = PL.leaMessage(win, all, cfg, TODAY);
has(lea, '*RÉSERVATIONS CONFIRMÉES*', 'Léa : liste des réservations');
has(lea, '• 7 → 10 oct. · Groupe A · 5 voyageurs (composition ?)', 'Léa : composition absente → ?');
has(lea, '• 22 → 27 déc. · Groupe E · 7 adultes + 3 enfants', 'Léa : enfants');
has(lea, '• 29 déc. → 3 janv. · Groupe F · 7 adultes + 2 enfants', 'Léa : à cheval sur deux années');
has(lea, '• 26 mars → 3 avril 2027 · Groupe G · 4 adultes', 'Léa : année affichée hors année courante');
has(lea, '• 10 → 17 avril 2027 · Groupe H · 6 adultes + 2 enfants + 3 bébés', 'Léa : bébés');
has(lea, "Deux rotations n'ont qu'une journée entre deux groupes : le samedi 24 octobre et le lundi 28 décembre.", 'Léa : rotations serrées');
has(lea, '• Mer. 7 oct., 13h · brunch · ? couverts · confirmé', 'Léa : couverts inconnus → ?');
has(lea, '• Mer. 21 oct. · dîner · 10 couverts · en attente de confirmation du client', 'Léa : repas en attente');
has(lea, '• 13 → 16 oct. · 7 couverts · en attente du client', 'Léa : séjour sans repas renseigné');
has(lea, '• Ven. 23 oct., 16h → retour sam. 24 oct., 13h — sans marge, le groupe suivant arrive le 25', 'Léa : linge serré');
has(lea, '• Jeu. 29 oct., 16h → retour ven. 30 oct., 13h — changement en cours de séjour', 'Léa : linge en cours de séjour');
has(lea, '• Dim. 1er nov., 16h → retour lun. 2 nov., 13h', 'Léa : dernier linge');
has(lea, "• Entre le dim. 11 et le lun. 12 oct. — avant l'arrivée du 13", 'Léa : ménage sur deux jours');
has(lea, "• Sam. 24 oct. — une seule journée avant l'arrivée du 25 : ménage le matin, lits faits l'après-midi dès le retour du linge", 'Léa : ménage serré');
has(lea, '• Lun. 2 nov. — après le départ du 1er', 'Léa : dernier ménage');
for (const bad of ['undefined', 'null', 'NaN', '[object']) hasNot(lea, bad, 'Léa : pas de « ' + bad + ' »');

// ── 7. Réservations fermes : même règle que isFirmBooking() d'app.html ─────
for (const [bs, want] of [['confirmed', true], ['pending', true], ['', true], [null, true], [undefined, true],
                          ['inquiry', false], ['quoted', false], ['lead', false], ['declined', false], ['cancelled', false], ['current', false]]) {
  ok(PL.isFirm({ booking_status: bs }) === want, 'isFirm(' + JSON.stringify(bs) + ') = ' + want);
}
ok(PL.isFirm({ bookingStatus: 'pending' }) === true, 'isFirm : casse camelCase acceptée comme dans l\'app');
ok(PL.isFirm(null) === false, 'isFirm(null) = false');

// ── 8. Férié pendant un séjour proche : visible même sans repas prévu ─────
ok(find('d', 'samedi 31 octobre', 'warn'), 'D : 31 octobre férié signalé en alerte (séjour dans moins de 30 jours)');
ok(find('f', 'vendredi 1er janvier', 'info'), 'F : férié lointain reste une information');

// ── 9. Livret vérifié à la main → plus d'alerte ────────────────────────────
const verifie = PL.checks(PL.buildStays(ROWS, { c: { livretOk: true } }), cfg, TODAY);
ok(!verifie.some(c => c.id === 'c' && c.txt.includes('Livret')), 'livret coché « vérifié » → alerte retirée');

// ── 10. Ponctuation : la saisie libre finit souvent par un point ──────────
const PONCT = { a: { precision: '5 femmes', chambres: 'Les 5 en lit double.', heure: '13h', arrivee: 'Vol du matin.' },
                b: { chambres: 'Deux doubles et une simple.' },
                c: { heure: '15h30', arrivee: 'Atterrissage à 14h.' },
                d: { heure: '21h', arrivee: 'Le gros du groupe arrive tard.' } };
const allP = PL.buildStays(ROWS, PONCT), msgsP = PL.saidMessages(PL.inWindow(allP, TODAY, '2026-11-01'), allP, cfg).map(x => x.text);
for (const t of msgsP) { hasNot(t, '..', 'ponctuation : pas de double point'); ok(!/\) \(/.test(t), 'en-tête : pas de double parenthèse'); }
has(msgsP[1], '*Mercredi 7 → samedi 10 octobre · 5 voyageurs (composition ?), 5 femmes*', 'en-tête : précision après une virgule');
has(msgsP[1], 'Lits pour Bravo : Deux doubles et une simple.', 'lits du suivant : un seul point final');
has(msgsP[3], "Atterrissage à 14h. C'est pendant la pause : tu restes pour l'accueil.", 'arrivée : phrase propre après un point');
has(msgsP[4], "Le gros du groupe arrive tard. C'est après les horaires : tu restes pour les accueillir.", 'arrivée tardive : phrase propre');

// ── 11. Lien WhatsApp ───────────────────────────────────────────────────────
ok(PL.waLink('+212 (0)6 00 00 00 01', 'a b') === 'https://wa.me/212600000001?text=a%20b', 'wa.me : numéro nettoyé, texte encodé');
ok(PL.waLink('', 'x') === null, 'wa.me : pas de numéro → pas de lien inventé');

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
