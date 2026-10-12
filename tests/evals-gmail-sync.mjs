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
p = P('Your payout of €1,735.20 was sent', 'We sent a payout to your bank account.');
check('hors sujet : type other', p.type === 'other', p.type);
check('hors sujet : aucun champ rempli', !p.code && !p.name && !p.checkin && p.payout_eur === null && p.adults === null, p);

// 11. Dates en français
p = P('Réservation confirmée', 'Check-in Check-out 13 oct. 2026 16 oct. 2026');
check('dates FR', p.checkin === '2026-10-13' && p.checkout === '2026-10-16', [p.checkin, p.checkout]);

// ── Garde-fous du code ─────────────────────────────────────────────────────
check('lecture seule Gmail (aucun envoi)', !/gmail\.send|messages\/send/.test(src));
check('aucune suppression en base', !/method:\s*["']DELETE["']/.test(src));
check('clé de synchro vérifiée côté base', /gmail_sync_key_ok/.test(src));
check('annulation seulement sur code exact', /cancellation/.test(src) && /reservation_code/.test(src));
check('chaque passage journalisé (sync_runs)', /sync_runs/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
