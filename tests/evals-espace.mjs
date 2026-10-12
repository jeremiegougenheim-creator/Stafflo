// Espace Stafflo (espace.html) — garde-fous statiques.
//   node tests/evals-espace.mjs
//
// 1. Les fonctions du lien livret sont des COPIES EXACTES de celles d'app.html
//    (couvertes par evals-livret-lang / evals-livret-group) : aucune dérive.
// 2. Aucun fait de la villa recopié en dur : prix, équipe, horaires viennent
//    de villa-facts.js.
// 3. L'Espace charge la fiche maison, et ARIA reçoit la fiche + les séjours.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const esp = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail || ''); } };

function fnSource(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n  }\n', i);
  return src.slice(i, j + 5);
}
for (const n of ['fmtStayDates', 'resolveLivretPax', 'detectLivretGroup', 'detectLivretLang', 'firstLivretMessageText']) {
  const a = fnSource(app, n), e = fnSource(esp, n);
  check(`${n} identique à app.html`, a && e && a === e);
}
check('MONTHS_FR identique', /var MONTHS_FR = \['JAN','FEV','MAR','AVR','MAI','JUN','JUL','AOU','SEP','OCT','NOV','DEC'\];/.test(esp));

const script = esp.slice(esp.indexOf('ESPACE STAFFLO'));
for (const bad of ['650', '850', 'Faiza', 'Palmeraie', 'Bouchra', '+212', '14h00', '8h30'])
  check(`aucun fait en dur : « ${bad} »`, !script.includes(bad));
check('charge villa-facts.js', esp.includes('<script src="villa-facts.js"></script>'));
check('ARIA reçoit la fiche', /F\.digest\(/.test(script));
check('ARIA reçoit les séjours calculés', /staysForAI\(\)/.test(script));
check('nuits calculées en code', /c\.n = c\.d - c\.a/.test(script));
check('leads exclus', /FIRM_OUT = \['inquiry', 'lead', 'quoted'/.test(script));
check('session partagée avec l’app', /SESSION_KEY = 'stafflo_session'/.test(script));
check('noindex', esp.includes('<meta name="robots" content="noindex, nofollow">'));
// v2 — messages Airbnb (email_inbox, rempli par gmail-sync)
check('messages : seulement les non archivés', /archived_at=is\.null/.test(script));
check('« Traité » archive (soft), jamais de suppression', /archived_at:/.test(script) && !/method:\s*'DELETE'/.test(script));
check('ARIA voit les messages en attente', /msgsFor\(/.test(script));
check('état de la synchro affiché (sync_runs)', /sync_runs\?select=finished_at,ok/.test(script));
check('versements Airbnb lus dans details.payouts (gmail-sync)', /c\.details\.payouts/.test(script) && /payoutLines\(c\)/.test(script));
check('nuits du mois comptent aussi les séjours terminés', /D\.stays\.concat\(D\.past/.test(script));
// v3 — alertes, modification d'un séjour, décompte
for (const bad of ['14h', '400 MAD', 'MAD par article'])
  check(`aucun horaire ni prix recopié : « ${bad} »`, !script.includes(bad));
check('décompte : prix lus dans la fiche (F.MEALS)', /unitPrice\(F\.MEALS\[1\], col\)/.test(script) && /unitPrice\(F\.MEALS\[2\], col\)/.test(script));
check('décompte enregistré dans details.billing (fusion, rien d’écrasé)', /setDetail\(c, 'billing'/.test(script));
check('modification : seuls les champs changés sont envoyés', /if \(!Object\.keys\(body\)\.length\)/.test(script));
check('alertes : la clé publique vient du serveur (jamais de clé privée côté page)', /pushCall\('public_key'\)/.test(script) && !/priv/i.test(script.replace(/private|privée|privé/g, '')));
check('alertes : désactiver = suppression douce de l’abonnement', /push_subscriptions\?endpoint=eq\.[\s\S]{0,200}deleted_at/.test(script));
check('installable : manifeste et icône écran d’accueil', esp.includes('<link rel="manifest" href="espace.webmanifest">') && esp.includes('<link rel="apple-touch-icon" href="assets/icon-180.png">'));
check('pastille de synchro : seulement les passages gmail-sync', /sync_runs\?select=finished_at,ok&source=like\.gmail_sync\*/.test(script));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
check('sw.js ne met pas espace.html en cache', sw.includes("url.includes('espace.html')"));
check('sw.js affiche les alertes et ouvre l’Espace au clic', /addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw) && /espace\.html/.test(sw));
const man = JSON.parse(fs.readFileSync(path.join(root, 'espace.webmanifest'), 'utf8'));
check('manifeste : démarre sur l’Espace, plein écran, icônes PNG', man.start_url === '/espace.html' && man.display === 'standalone' && man.icons.every((i) => fs.existsSync(path.join(root, i.src))));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
