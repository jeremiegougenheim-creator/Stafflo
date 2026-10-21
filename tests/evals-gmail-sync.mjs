// Synchronisation Gmail → CRM (supabase/functions/gmail-sync) — parseur et garde-fous.
//   node tests/evals-gmail-sync.mjs
//
// Le parseur Airbnb est du regex pur. Règle produit (aria-no-invention) :
// une valeur absente du texte source reste VIDE — jamais 0, jamais estimée.
// Le corpus ci-dessous reprend le format réel des emails Airbnb, anonymisé.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'supabase/functions/gmail-sync/index.ts'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

// ── Extraction du parseur (bloc pur, sans réseau) ──────────────────────────
const a = src.indexOf('const MONTHS'), b = src.indexOf('// ── CRM');
let esbuild;
try { esbuild = createRequire(import.meta.url)('esbuild'); }
catch { esbuild = createRequire('/opt/npm-tools/')('esbuild'); }
const js = esbuild.transformSync(src.slice(a, b).replace(/^export /gm, ''), { loader: 'ts' }).code;
const ctx = {};
vm.runInNewContext(js + '\nthis.parseAirbnb = parseAirbnb;', ctx);
const P = ctx.parseAirbnb;

const LINK = (code) => `[https://www.airbnb.com/hosting/reservations/details/${code}]`;
const CONF_BODY = `New booking confirmed! Ana arrives 13 Oct. Send a message to confirm check-in details. Ana Ruiz Prieto ${LINK('HMABCD1234')} Identity verified · 3 reviews Hola, we are a family of seven, thank you! Send Ana a Message Check-in Checkout Tue, 13 Oct 2026 Fri, 16 Oct 2026 4:00 pm 11:00 am GUESTS 5 adults, 2 children CONFIRMATION CODE HMABCD1234 GUEST PAID €1,862.40 HOST PAYOUT 3 nights room fee €1,800.00 YOU EARN €1,735.20`;

// 1. Confirmation nominale
let p = P('Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY);
check('confirmation : type', p.type === 'confirmation', p.type);
check('confirmation : code', p.code === 'HMABCD1234', p.code);
check('confirmation : nom complet', p.name === 'Ana Ruiz Prieto', p.name);
check('confirmation : dates', p.checkin === '2026-10-13' && p.checkout === '2026-10-16', [p.checkin, p.checkout]);
check('confirmation : voyageurs', p.adults === 5 && p.children === 2 && p.infants === 0, [p.adults, p.children, p.infants]);
check('confirmation : versement net', p.payout_eur === 1735.2, p.payout_eur);

// 2. Montant absent → vide, jamais 0 ni estimation (classe la plus importante)
p = P('Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY.replace(/ YOU EARN €1,735\.20/, ''));
check('montant absent : payout_eur null', p.payout_eur === null, p.payout_eur);
check('montant absent : pas de total inventé', p.guest_total_eur === null, p.guest_total_eur);

// 3. Voyageurs absents → vides
p = P('Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY.replace(/GUESTS 5 adults, 2 children /, ''));
check('voyageurs absents : null', p.adults === null && p.children === null && p.infants === null, [p.adults, p.children, p.infants]);

// 4. Dates incohérentes (départ avant arrivée) → vides
p = P('Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY.replace('Fri, 16 Oct 2026', 'Fri, 10 Oct 2026'));
check('dates incohérentes : null', p.checkin === null && p.checkout === null, [p.checkin, p.checkout]);

// 5. Demande d'information (lead) — jamais une réservation ferme
p = P('Enquiry for Villa Dar J for 13–16 Oct 2026', 'Daniel Booker Hi, is the villa available for 9 adults? Reply [https://www.airbnb.com/hosting/thread/1234567890] Check-in Checkout 13 Oct 2026 16 Oct 2026 GUESTS 9 adults');
check('enquiry : type inquiry', p.type === 'inquiry', p.type);
check('enquiry : aucun code inventé', p.code === null, p.code);
check('enquiry : fil', p.thread_id === '1234567890', p.thread_id);
check('enquiry : message client', /available for 9 adults/.test(p.guest_message || ''), p.guest_message);

// 6. Réponse dans un fil → message, pas inquiry
p = P('RE: Enquiry for Villa Dar J for 13–16 Oct 2026', 'Daniel Booker Thanks, we will book tomorrow. Reply [https://www.airbnb.com/hosting/thread/1234567890]');
check('RE: enquiry → message', p.type === 'message', p.type);
check('message : prénom depuis « Booker »', p.first_name === 'Daniel', p.first_name);

// 7. Rappel d'arrivée
p = P('Reservation reminder: Ana Ruiz Prieto is coming soon', 'Ana arrives in 3 days.');
check('rappel : type', p.type === 'reminder', p.type);
check('rappel : nom', p.name === 'Ana Ruiz Prieto', p.name);

// 8. Annulation
p = P('Reservation HMABCD1234 has been cancelled', `Your reservation ${LINK('HMABCD1234')} was cancelled.`);
check('annulation : type', p.type === 'cancellation', p.type);
check('annulation : code', p.code === 'HMABCD1234', p.code);

// 9. Demande de réservation (request)
p = P('Reservation request for Villa Dar J', 'Pending: respond within 24 hours.');
check('request : type', p.type === 'request', p.type);

// 10. Hors sujet → other, aucun champ
p = P('You’ve hit a full year as a Superhost, Jeremie.', 'Congratulations on 12 months of great hosting. Your rating is 4.9.');
check('hors sujet : type other', p.type === 'other', p.type);
check('hors sujet : aucun champ rempli', !p.code && !p.name && !p.checkin && p.payout_eur === null && p.adults === null, p);

// 11. Dates en français
p = P('Réservation confirmée', 'Check-in Check-out 13 oct. 2026 16 oct. 2026');
check('dates FR', p.checkin === '2026-10-13' && p.checkout === '2026-10-16', [p.checkin, p.checkout]);

// 12. Montant au format européen (Airbnb .fr)
p = P('Réservation confirmée', 'Check-in Check-out 13 oct. 2026 16 oct. 2026 VOUS GAGNEZ 1 549,86 €');
check('montant FR « 1 549,86 € » → 1549.86', p.payout_eur === 1549.86, p.payout_eur);

// 13. Versement Airbnb (format réel .co.uk, anonymisé)
const PAYOUT = `€ 1,549.86 EUR was sent today Your money was sent on 8 October and should arrive by 15 October 2026. View earnings [https://www.airbnb.co.uk/users/transaction_history/1] Bank account Jean Dupont, IBAN 1234 (EUR) Payout ID M-6KIKMHXFSXEXN6 We share this unique identifier with your bank. Airbnb account ID 1 Details Clara Whitfield € 1,549.86 EUR Home • 07/10/2026 - 10/10/2026 1-hectare estate, pool, butler & home-cooked meals (756889438032872685) HMTEST0004 Total paid: € 1,549.86 EUR Get help with payouts`;
p = P('We sent a payout of € 1,549.86 EUR', PAYOUT);
check('versement : type payout', p.type === 'payout', p.type);
check('versement : identifiant', p.payout && p.payout.id === 'M-6KIKMHXFSXEXN6', p.payout);
check('versement : total', p.payout && p.payout.total_eur === 1549.86, p.payout);
check('versement : arrivée prévue', p.payout && p.payout.expected_by === '2026-10-15', p.payout);
check('versement : une ligne, code exact', p.payout && p.payout.items.length === 1 && p.payout.items[0].code === 'HMTEST0004', p.payout && p.payout.items);
check('versement : montant de la ligne', p.payout && p.payout.items[0].amount_eur === 1549.86, p.payout && p.payout.items);
check('versement : nom sans « Details »', p.payout && p.payout.items[0].name === 'Clara Whitfield', p.payout && p.payout.items);

// 14. Versement groupé (deux réservations)
const PAYOUT2 = PAYOUT.replace('Total paid:', 'Ana Ruiz € 980.00 EUR Home • 01/11/2026 - 04/11/2026 Villa (1) HMABCD1234 Total paid:');
p = P('We sent a payout of € 2,529.86 EUR', PAYOUT2);
check('versement groupé : deux lignes', p.payout && p.payout.items.length === 2 && p.payout.items[1].code === 'HMABCD1234' && p.payout.items[1].amount_eur === 980, p.payout && p.payout.items);

// 15. Versement sans code de réservation → aucune ligne (rien à relier)
p = P('We sent a payout of € 100.00 EUR', '€ 100.00 EUR was sent today. Details Resolution € 100.00 EUR Adjustment');
check('versement sans code : payout null', p.payout === null, p.payout);

// 16. Un email qui n'est pas un versement n'a jamais de bloc payout
p = P('Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY);
check('confirmation : pas de bloc payout', p.payout === null, p.payout);

// ── Compléter un séjour créé depuis un calendrier (ical-sync, 21/10) ──────
// Le séjour existe déjà (nom = code HM…, montant vide, details.pending = ['name', 'price']) ; l'email de
// confirmation du même code le finit : nom, voyageurs, net. Un nom déjà saisi n'est jamais remplacé.
{
  const c = src.indexOf('// ── CRM'), d = src.indexOf('// ── Google');
  const js2 = esbuild.transformSync(src.slice(c, d).replace(/^export /gm, ''), { loader: 'ts' }).code;
  const run = async (stay, subject, body) => {
    const calls = [];
    const ctx2 = { db: async (path, init) => { calls.push({ path, init: init || {} }); if (/reservation_code=eq\.HMABCD1234/.test(path)) return [stay]; return init && init.method === 'PATCH' ? null : []; } };
    vm.runInNewContext(js2 + '\nthis.applyToCrm = applyToCrm;', ctx2);
    const log = [];
    const id = await ctx2.applyToCrm(P(subject, body), 'em-1', false, log, 'o1');
    const patch = calls.find((x) => x.init.method === 'PATCH');
    return { id, log, body: patch ? JSON.parse(patch.init.body) : null, posts: calls.filter((x) => x.init.method === 'POST').length };
  };
  let r = await run({ id: 'ical-1', name: 'HMABCD1234', arrival: '2026-10-13', departure: '2026-10-16', guests: null, adults: null, children: null, infants: null, price: null, source: 'Airbnb', booking_status: 'confirmed',
    details: { reservation_code: 'HMABCD1234', origin: 'ical_sync', ical_event_id: 'ev-1', pending: ['name', 'price'] } }, 'Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY);
  check('séjour du calendrier (nom = code, à compléter) + email de confirmation du même code → complété : nom, voyageurs, net, plus rien à compléter ; aucun séjour créé en double',
    r.id === 'ical-1' && r.posts === 0 && r.body && r.body.name === 'Ana Ruiz Prieto' && r.body.adults === 5 && r.body.children === 2 && r.body.guests === 7 && r.body.price === 1735.2 && r.body.commission === 0 &&
    r.body.details.pending.length === 0 && r.body.details.origin === 'ical_sync' && r.body.details.ical_event_id === 'ev-1' && r.body.details.payout_eur === 1735.2 && r.log[0].action === 'complete', r.body);
  r = await run({ id: 'man-1', name: 'Ana R.', arrival: '2026-10-13', departure: '2026-10-16', guests: 7, adults: 5, children: 2, infants: 0, price: 1700, source: 'Airbnb', booking_status: 'confirmed',
    details: { reservation_code: 'HMABCD1234', origin: 'espace' } }, 'Reservation confirmed - Ana Ruiz Prieto arrives 13 Oct', CONF_BODY);
  check('séjour saisi à la main (nom, montant déjà là) : le nom et le montant ne sont jamais remplacés par l’email', r.id === 'man-1' && (!r.body || (r.body.name === undefined && r.body.price === undefined)), r.body);
}

// ── Garde-fous du code ─────────────────────────────────────────────────────
check('versement relié par code exact, résultat unique', /reservation_code=eq\.\$\{it\.code\}&limit=2/.test(src) && /rows\?\.length !== 1/.test(src));
check('versement : prix rempli seulement s\'il est vide et < 28 nuits', /!\(\+stay\.price > 0\) && it\.amount_eur != null && list\.length === 1 && nights > 0 && nights < 28/.test(src));
check('versement : jamais compté deux fois', /list\.some\(\(x\) => x\.key === key\)/.test(src));
check('lecture seule Gmail (aucun envoi)', !/gmail\.send|messages\/send/.test(src));
check('aucune suppression en base', !/method:\s*["']DELETE["']/.test(src));
check('clé de synchro vérifiée côté base', /gmail_sync_key_ok/.test(src));
check('annulation seulement sur code exact', /cancellation/.test(src) && /reservation_code/.test(src));
check('chaque passage journalisé (sync_runs)', /sync_runs/.test(src));
// v5 — multi-propriétaire : aucun compte en dur, chaque lecture/écriture rattachée au propriétaire du passage
check('multi-propriétaire : aucun identifiant de compte ni villa en dur', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(src) && !/"villadarj"/.test(src));
check('multi-propriétaire : boucle sur les boîtes connectées (villa_settings)', /email_connection->>refresh_token=not\.is\.null/.test(src) && /await runOwner\(/.test(src));
check('multi-propriétaire : un compte = un passage (dédoublonné)', /done\.has\(String\(o\.owner_id\)\)/.test(src));
check('multi-propriétaire : toute lecture de séjour filtrée par propriétaire', (src.match(/crm_clients\?select=/g) || []).length === (src.match(/crm_clients\?select=\$\{SEL\}&user_id=eq\.\$\{owner\}/g) || []).length);
check('multi-propriétaire : séjour créé au nom du propriétaire', /id, user_id: owner, name: p\.name/.test(src));
check('multi-propriétaire : email rangé et journal écrits au nom du propriétaire', /owner_id: OWNER_ID, user_id: OWNER_ID, villa_key: VILLA_KEY/.test(src) && /owner_id: OWNER_ID, source: "gmail_sync:" \+ mode/.test(src));
check('multi-propriétaire : un compte en erreur n’arrête pas les autres (207)', /okAll \? 200 : 207/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
