// Rejoue les cas du brief CC "Fiches de réservation : voyageurs, pays et langue
// retenus durablement depuis Airbnb" contre le code réel d'app.html.
//   node tests/evals-airbnb-guests.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

function fnSource(name) {
  const m = src.indexOf('function ' + name + '(');
  if (m < 0) throw new Error('fonction introuvable: ' + name);
  const lineStart = src.lastIndexOf('\n', m) + 1;
  const indent = src.slice(lineStart, m);
  const endMarker = '\n' + indent + '}';
  const e = src.indexOf(endMarker, m);
  return src.slice(m, e + endMarker.length);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fnSource('detectLivretLang') + '\nthis.detectLivretLang = detectLivretLang;', ctx);
vm.runInContext(fnSource('parseAirbnbConfirmationEmail') + '\nthis.parseAirbnbConfirmationEmail = parseAirbnbConfirmationEmail;', ctx);
vm.runInContext(fnSource('parseAirbnbReservationPage') + '\nthis.parseAirbnbReservationPage = parseAirbnbReservationPage;', ctx);
const detectLivretLang = ctx.detectLivretLang;
const parseAirbnbConfirmationEmail = ctx.parseAirbnbConfirmationEmail;
const parseAirbnbReservationPage = ctx.parseAirbnbReservationPage;

const evals = [];
const ev = (name, fn) => evals.push({ name, fn });

// ─── Confirmation Felipe (e-mail réel, HMWXHRPEHR) ───
const FELIPE_EMAIL = `
Reservation confirmed - Felipe arrives Jun 17
CONFIRMATION CODE HMWXHRPEHR
Identity verified · 21 reviews
Tackley, United Kingdom
Hi Jeremie,
Looking forward to our stay, we will arrive around 4pm.
Send Felipe a Message
GUESTS
7 adults
`;

ev('Confirmation Felipe : total 7, country United Kingdom, lang en', () => {
  const out = parseAirbnbConfirmationEmail(FELIPE_EMAIL);
  const lang = detectLivretLang({ nat: out.country });
  return out.total === 7 && out.code === 'HMWXHRPEHR'
    && out.country === 'United Kingdom' && lang === 'en';
});

// ─── Fiche Gautier complète (texte collé, HMPFEE5KAW) ───
const GAUTIER_FICHE_COMPLETE = `
Gautier Giffard
Lieu de résidence : Cannes, France
Groupe de 10 réservé par Gautier
+9
6 adultes, 3 enfants
Confirmation code
HMPFEE5KAW
`;

ev('Fiche Gautier complète : total 10, adults/children 1+6+3, country France, lang fr, code', () => {
  const out = parseAirbnbReservationPage(GAUTIER_FICHE_COMPLETE);
  const lang = detectLivretLang({ nat: out.country });
  return out.total === 10 && out.adults === 7 && out.children === 3
    && out.country === 'France' && lang === 'fr' && out.code === 'HMPFEE5KAW';
});

// ─── Fiche sans "Groupe de N" ───
ev('Fiche sans Groupe de N : +9 / 6 adultes, 3 enfants → total 10, pas 9', () => {
  const out = parseAirbnbReservationPage('+9\n6 adultes, 3 enfants');
  return out.total === 10;
});

// ─── Conflit Groupe de N vs accompagnants ───
ev('Conflit : Groupe de 10 et +8 · 6 adultes, 3 enfants → total 10 + drapeau', () => {
  const out = parseAirbnbReservationPage('Groupe de 10 réservé par X\n+8 · 6 adultes, 3 enfants');
  return out.total === 10 && out.flags.length > 0;
});

// ─── Bébés ───
ev('Bébés : 2 adults, 1 infant → total 2, infants 1', () => {
  const out = parseAirbnbConfirmationEmail('GUESTS\n2 adults, 1 infant');
  return out.total === 2 && out.infants === 1;
});

// ─── Total absent ───
ev('Total absent : e-mail sans bloc GUESTS → total null + drapeau', () => {
  const out = parseAirbnbConfirmationEmail('Reservation confirmed - John arrives\nCONFIRMATION CODE HMABCDEFGH\nHi Jeremie,\nSee you soon.\nSend John a Message');
  return out.total === null && out.flags.length > 0;
});

// ─── Pays francophone hors France ───
ev('Pays francophone hors France : Bruxelles, Belgique → country Belgique, lang bi', () => {
  const out = parseAirbnbReservationPage('Lieu de résidence : Bruxelles, Belgique');
  const lang = detectLivretLang({ nat: out.country });
  return out.country === 'Belgique' && lang === 'bi';
});

// ─── Pays inconnu ───
ev('Pays inconnu : Atlantis → country conservé, lang signal null (repli bi, jamais fr/en)', () => {
  const out = parseAirbnbReservationPage('Lieu de résidence : Atlantis');
  const lang = detectLivretLang({ nat: out.country });
  return out.country === 'Atlantis' && lang === 'bi';
});

// ─── E-mail de modification ───
ev('E-mail de modification : sans chiffres → aucun champ, drapeau "modifiée"', () => {
  const out = parseAirbnbConfirmationEmail('Your reservation change has been accepted\nHi Jeremie, all set.');
  return out.total === null && out.code === null && out.country === null
    && out.flags.some(f => /modifi/i.test(f));
});

// ─── Nom seul ───
ev('Nom seul : aucun autre champ → aucun pays, aucune langue déduits', () => {
  const out = parseAirbnbReservationPage('Gautier Giffard');
  const lang = detectLivretLang({ nat: out.country });
  return out.country === null && lang === 'bi';
});

// ─── Non-régression fromNat() sur les drapeaux existants ───
ev('Non-régression : fromNat() par drapeau emoji marche toujours (via detectLivretLang)', () =>
  detectLivretLang({ nat: '🇫🇷 Français' }) === 'fr' &&
  detectLivretLang({ nat: '🇬🇧 Britannique' }) === 'en' &&
  detectLivretLang({ nat: '🇲🇦 Marocain' }) === 'bi');

let fails = 0;
for (const { name, fn } of evals) {
  let ok = false, err = '';
  try { ok = !!fn(); } catch (e) { err = ' — ' + (e && e.message); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + err);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} échec(s)` : `\n${evals.length}/${evals.length} PASS`);
process.exit(fails ? 1 : 0);
