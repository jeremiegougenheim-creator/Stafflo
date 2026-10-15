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
import vm from 'node:vm';
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
check('charge le moteur de la fiche (house-facts.js), plus le fichier public villa-facts.js', esp.includes('<script src="house-facts.js"></script>') && !esp.includes('<script src="villa-facts.js">'));
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
check('décompte : prix lus dans la fiche (F.MEALS), sans erreur si la fiche n’a pas ces lignes', /unitPrice\(F\.MEALS\[1\] \|\| \{\}, col\)/.test(script) && /unitPrice\(F\.MEALS\[2\] \|\| \{\}, col\)/.test(script));
check('décompte enregistré dans details.billing (fusion, rien d’écrasé)', /setDetail\(c, 'billing'/.test(script));
check('modification : seuls les champs changés sont envoyés', /if \(!Object\.keys\(body\)\.length\)/.test(script));
check('alertes : la clé publique vient du serveur (jamais de clé privée côté page)', /pushCall\('public_key'\)/.test(script) && !/priv/i.test(script.replace(/private|privée|privé/g, '')));
check('alertes : désactiver = suppression douce de l’abonnement', /push_subscriptions\?endpoint=eq\.[\s\S]{0,200}deleted_at/.test(script));
check('installable : manifeste et icône écran d’accueil', esp.includes('<link rel="manifest" href="espace.webmanifest">') && esp.includes('<link rel="apple-touch-icon" href="assets/icon-180.png">'));
check('pastille de synchro : seulement les passages gmail-sync', /sync_runs\?select=finished_at,ok&source=like\.gmail_sync\*/.test(script));
// v4 — « À faire » : une ligne par action, tous séjours confondus
check('« À faire » en tête du Jour (après la mise en route d’un compte neuf), puis les retours de l’équipe', /h \+= setup;\s*h \+= todoCard\(\);\s*h \+= teamCard\(\);/.test(script));
check('« À faire » : messages et commandes à confirmer d’abord, puis les retards', /var rank = function \(x\) \{ return x\.k === 'msg' \|\| x\.k === 'order' \? 0 : x\.late \? 1 : 2; \}/.test(script));
check('« À faire » ouvre le séjour sur le bon panneau', /a === 'goto' && \(c = c \|\| pastById\(id\)\)/.test(script) && /id="st-' \+ esc\(c\.id\)/.test(script));
check('une arrivée du jour n’apparaît qu’une fois', /c\.a > t && c\.a - t <= 21/.test(script));
// v5 — départ, avis, décompte complet, planning équipe
check('message de départ tiré de la fiche maison (pas de texte figé)', /function departFacts\(i\)/.test(script) && /F\.PRACTICAL\.filter/.test(script));
check('pas de lookbehind regex (Safari iOS < 16.4)', !/\(\?<[=!]/.test(script));
check('avis Airbnb : fenêtre de 14 jours, jamais pour un séjour offert', /return c\.d \+ 14;/.test(script) && /!c\.is_comp && !c\.details\.reviewDoneAt/.test(script));
check('avis hôte ARIA : 3e personne, jamais « X’s group », rien d’inventé', /N’écris jamais « ' \+ firstName\(c\) \+ '’s group »/.test(script) && /N’invente aucun détail/.test(script));
check('« À faire » : message de départ et avis', /k: 'depart'/.test(script) && /k: 'review'/.test(script));
check('logistique des courses lue dans la fiche maison', /MAD de logistique/.test(script) && /function logiUnit\(\)/.test(script));
check('décompte : avance déduite, équivalent € seulement au taux saisi', /var rest = Math\.max\(0, total - adv\);/.test(script) && /isFinite\(rate\) && rate > 0 \? rate : 0/.test(script));
check('Maison : lien vers le planning équipe', /href="planning\.html"/.test(script));
check('séjour commencé : plus de vérifications « en retard »', /if \(c\.a < t\) ck = \[\];/.test(script));
// v6 — dates fortes (table events, sourcée)
check('dates fortes : lues dans la base, suppressions douces exclues', /events\?select=[^']*deleted_at=is\.null/.test(script));
check('dates fortes : aucune date d’événement en dur', !/20\d\d-\d\d-\d\d/.test(script));
check('dates fortes : nuits sans séjour calculées en code', /function eventNights\(e\)/.test(script) && /c\.a <= x && x < c\.d/.test(script));
check('dates fortes : dates lunaires signalées approximatives', /e\.category === 'religious'/.test(script) && /evApprox:/.test(script));
check('ARIA : dates fortes sans prix chiffré', /ne propose jamais de prix chiffré ni de hausse en %/.test(script) && /eventsForAI\(\)/.test(script));
// v7 — accès équipe (equipe.html) et champs lus par l'équipe
check('accès équipe : jeton aléatoire 32 octets, seule l’empreinte sha-256 part en base', /crypto\.getRandomValues\(new Uint8Array\(32\)\)/.test(script) && /token_hash: h/.test(script) && !/token_hash: tok/.test(script));
check('accès équipe : retirer = suppression douce', /staff_links\?id=eq\.[\s\S]{0,200}deleted_at/.test(script));
check('accès équipe : liens retirés non listés', /staff_links\?select=[^']*deleted_at=is\.null/.test(script));
check('accès équipe : personnes de la fiche maison (pilote) ou de la table staff du compte', /function teamNames\(\) \{ return teamList\(\)/.test(script) && /HAS_FACTS \? F\.TEAM\.filter/.test(script) && /\(D\.staff \|\| \[\]\)/.test(script));
check('champs équipe : fusion dans details, rien d’autre écrasé', /var nd = Object\.assign\(\{\}, c\.details\)/.test(script) && /\['arrival', 'arrival_time'\], \['beds', 'beds'\], \['staffnote', 'staff_note'\]/.test(script));
check('brief équipe : la consigne remplace les notes privées', /if \(sn\) lines\.push\('Consigne : '/.test(script) && /else if \(notes\) lines\.push\('Notes : '/.test(script));
// v8 — ARIA identifiée : le jeton de session part avec chaque appel ai-proxy
check('ARIA : jeton de session envoyé à ai-proxy (quota et journal par propriétaire)', /function aiPost\(payload\)/.test(script) && /h\.Authorization = 'Bearer ' \+ s\.access_token/.test(script) && !/fetch\(PROXY, \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}/.test(script));
// v9 — multi-villa : chaque compte voit SA villa, jamais celle du pilote
check('multi-villa : aucun nom de villa écrit en dur', !/Villa Dar J|Dar J ·/.test(esp) && !/'Jérémie'/.test(script));
check('multi-villa : fiche maison du compte, lue en base (house_facts), drapeau house_facts_ref', /var built = D\.villa && D\.villa\.house_facts_ref === 'villa-facts\.js' && HF \? HF\.build\(D\.villa\.house_facts\) : null;/.test(script) && /HAS_FACTS = !!built;/.test(script) && /F = built \|\| EMPTY_F;/.test(script) && /house_facts_ref,house_facts&/.test(script));
check('multi-villa : en-tête = villa et ville du compte', /kk\.textContent = D\.loaded && D\.user \? \(villaName\(\)/.test(script));
check('multi-villa : sans fiche, ARIA reçoit les bases et « à confirmer »', /HAS_FACTS \? F\.digest\(fr \? 'fr' : 'en'\) : basicsForAI\(fr\)/.test(script) && /jamais inventée/.test(script));
check('multi-villa : livret, décompte et messages d’avant arrivée seulement avec une fiche maison', /HAS_FACTS && LINKS && LINKS\.get\(c\.id\) \? '<button type="button" class="act" data-a="panel" data-id="' \+ esc\(c\.id\) \+ '" data-v="livret"/.test(script) && /HAS_FACTS && mealsOn\(\) \? '<button type="button" class="act" data-a="panel" data-id="' \+ esc\(c\.id\) \+ '" data-v="bill"/.test(script) && /if \(!HAS_FACTS\) return viewMaisonBasics\(\);/.test(script));
check('multi-villa : « Envoyer à » la personne de l’équipe, pas un prénom écrit en dur', /sendTo: function \(n\)/.test(script) && !/sendSaid:/.test(script));
// v10 — compte neuf : « Mise en route » cochée d'après les vraies données, disparaît une fois le compte prêt
check('mise en route : Gmail (synchro serveur), premier séjour, équipe — cochés d’après les données', /var gmail = !!D\.sync, stay = \(D\.stays\.length \+ \(D\.past \|\| \[\]\)\.length\) > 0, team = teamList\(\)\.length > 0;/.test(script));
check('mise en route : disparaît quand Gmail, séjours et équipe sont là (jamais pour un compte établi)', /if \(gmail && stay && team\) return '';/.test(script));
check('mise en route : chaque étape mène au bon écran de l’app (?open=)', /href: 'app\.html\?open=gmail'/.test(script) && /href: 'app\.html\?open=stay'/.test(script) && /href: 'app\.html\?open=settings'/.test(script));
check('mise en route : pas de doublon avec l’invitation aux alertes', /if \(!setup\) h \+= nudgeCard\(\);/.test(script));
check('compte sans aucun séjour : pas de tuiles « 0 / 0 / 0 € » (tuiles dans Séjours, v12)', /if \(D\.stays\.length \+ \(D\.past \|\| \[\]\)\.length\) \{\s*var up = D\.stays/.test(script) && (script.match(/<div class="tiles">/g) || []).length === 1);
const appH = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
check('app : ?open=gmail|settings|stay ouvre l’écran une fois la session prête', /\[\?&\]open=\(gmail\|settings\|stay\)\\b/.test(appH) && /what === 'gmail' && typeof showEmailConnectModal === 'function'/.test(appH));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
check('sw.js ne met pas espace.html en cache', sw.includes("url.includes('espace.html')"));
check('sw.js affiche les alertes et ouvre l’Espace au clic', /addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw) && /espace\.html/.test(sw));
const man = JSON.parse(fs.readFileSync(path.join(root, 'espace.webmanifest'), 'utf8'));
check('manifeste : démarre sur l’Espace, plein écran, icônes PNG', man.start_url === '/espace.html' && man.display === 'standalone' && man.icons.every((i) => fs.existsSync(path.join(root, i.src))));

// ── v11 (15/10/2026) — revue UX par intervenant ───────────────────────────
// Ce que la vue équipe affiche en « ? » (heure d'arrivée, couchages) devient une vérification du propriétaire,
// avec sa ligne « À faire » qui ouvre Modifier.
check('v11 : « Infos équipe » = heure d’arrivée ET couchages, due J-2', /mk\('team', !!\(String\(c\.details\.arrival_time \|\| ''\)\.trim\(\) && String\(c\.details\.beds \|\| ''\)\.trim\(\)\), c\.a - 2\)/.test(script));
check('v11 : « À faire » → Infos équipe ouvre le panneau Modifier', /depart: 'depart', team: 'edit'[^}]*\}\[v\]/.test(script) && /team: 'Heure d’arrivée et couchages pour l’équipe'/.test(script) && /team: 'Arrival time and beds for the team'/.test(script) && /team: 'clock'/.test(script));
// Citation d'un message : sans les adresses web qu'Airbnb glisse dans le texte.
{
  const i = script.indexOf('  function cleanQuote('), j = script.indexOf('\n', i);
  const ctx = {}; vm.createContext(ctx); vm.runInContext(script.slice(i, j) + '\nthis.f = cleanQuote;', ctx);
  check('v11 : citation sans URL (« Review enquiry [https://…] » → « Review enquiry »)', ctx.f('Thank you! Review enquiry [https://www.airbnb.co.uk/hosting/thread/26944?thread_type=home_booking&c=.pi80.x] ') === 'Thank you! Review enquiry' && ctx.f('see https://a.b/c now') === 'see now' && ctx.f('') === '' && ctx.f(null) === '');
  check('v11 : la citation affichée et le brouillon ARIA utilisent le texte nettoyé', /text: cleanQuote\(p\.guest_message\)/.test(script));
}
// Dates hors de l'année en cours : avec l'année.
{
  const i = script.indexOf('  function fmtDay('), j = script.indexOf('\n  }\n', i);
  const ctx = { U: { lang: 'fr' }, Date }; vm.createContext(ctx); vm.runInContext(script.slice(i, j + 5) + '\nthis.f = fmtDay;', ctx);
  const y = new Date().getFullYear(), d = (yy) => Date.UTC(yy, 5, 10) / 86400000;
  check('v11 : « 10 juin » dans l’année en cours, « 10 juin 2027 » l’année suivante', !/\d{4}/.test(ctx.f(d(y))) && new RegExp(String(y + 1)).test(ctx.f(d(y + 1))));
}
check('v11 : notes longues — la suite se déplie, rien n’est coupé net', /notes\.length > 300 \? '<details class="more"><summary>' \+ esc\(l\.more\) \+ '<\/summary>' \+ esc\(notes\.slice\(300\)\)/.test(script));
check('v11 : pastille Jour = lignes urgentes de « À faire » + messages sans séjour', /todoItems\(\)\.filter\(function \(x\) \{ return x\.k === 'msg' \|\| x\.late \|\| x\.due <= t; \}\)\.length/.test(script));
check('v11 : carte Départs sans recopier le texte de la fiche', !/departures, deps\.map[\s\S]{0,400}Arrivée et départ/.test(script));
check('v11 : ancien générateur de planning derrière interrupteur (données jamais vues par l’équipe)', /stafflo_planning_old/.test(script) && /if \(oldPlanning\) h \+= card\('calendar-user', l\.mPlanning/.test(script));
check('v11 : « Ce qu’ARIA sait de la maison » se présente comme dépliable (chevron)', /<details class="dig"><summary><i class="ti ti-chevron-right"/.test(script));
check('v11 : écran de connexion titré « Espace Stafflo »', /textContent = 'Espace Stafflo'; return; \}/.test(script));

// ── v12 (15/10/2026) — allègement : moins à l'écran, grammaire v19 ─────────
check('v12 : une ligne d’état par séjour (ce qui manque), plus de rangée de pastilles', /<p class="state (alert|wait|go)">/.test(script) && !/ck\.map\(function \(x\) \{\s*var cls = x\.done \? 't-go'/.test(script));
check('v12 : séjour à plus de 14 jours → rien à signaler (ce n’est pas encore à faire)', /if \(missCk\.length && c\.a - t <= 14\)/.test(script));
check('v12 : actions en grille carrée de 4 (règle v19), icône au-dessus du mot', /\.acts\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(esp) && /\.act\{[^}]*flex-direction:column/.test(esp));
check('v12 : ARIA hors de la barre d’onglets (3 onglets), bouton dans l’en-tête', /var TABS = \[\['jour', 'sun'\], \['sejours', 'calendar-event'\], \['maison', 'home'\]\]/.test(script) && /id="ariaBtn" data-a="tab" data-v="aria"/.test(esp) && /grid-template-columns:repeat\(3,1fr\)/.test(esp));
check('v12 : Jour = à faire, à répondre, en ce moment, arrivées, départs — tuiles et dates fortes dans Séjours', /h \+= teamCard\(\);[^\n]*\n\s*\/\/ v12/.test(script) && !/eventsCard\(75, 3, false\)/.test(script) && /var h = '';\s*\/\/ v12 — les trois chiffres/.test(script));
check('v12 : Maison — alertes, accès équipe (et emails sans Gmail, derrière interrupteur) d’abord, la fiche repliée (6 sections)', /h = pushCard\(\) \+ eqCard\(\) \+ inCard\(\);/.test(script) && (script.match(/, '', true\);/g) || []).length === 6 && /<details class="card fold"><summary class="h">/.test(script));

// ── v12 — livret dans les deux sens : la réponse du client s'affiche telle quelle ───
check('v12 : la réponse du client (details.guest_answers) s’affiche dans le séjour, datée, jamais réécrite', /var ga = c\.details\.guest_answers;/.test(script) && /l\.guestAns \+ ' · ' \+ fmtDay\(dayNum\(String\(ga\.at\)\.slice\(0, 10\)\)\)/.test(script) && /flat\(ga\.arrival_time\)/.test(script));

// ── v13 — équipe → base : retours de l'équipe (staff_reports) ─────────────
check('v13 : retours de l’équipe lus avec les données (7 jours, RLS), carte « De l’équipe » = non vus, « Vu » = seen_at', /staff_reports\?select=id,link_id,client_id,kind,text,created_at,seen_at&deleted_at=is\.null/.test(script) && /filter\(function \(r\) \{ return !r\.seen_at; \}\)/.test(script) && /staff_reports\?id=eq\.' \+ encodeURIComponent\(r\.id\), \{ method: 'PATCH'[^\n]*seen_at: new Date/.test(script));
check('v13 : « Chambres prêtes · qui · quand » sur le séjour, jamais inventé (seulement si un retour existe)', /var rr = readyReport\(c\);\s*if \(rr\) h \+= '<p class="state go">/.test(script));

// ── v13 — fiche maison modifiable dans l'Espace (tout compte) — comportement : evals-espace-fiche.mjs (Chromium)
check('v13 : fiche maison modifiable ici — plus « demandez-le à Claude »', !/demandez-le à Claude/.test(script) && /data-a="feopen"/.test(script) && /function feView\(\)/.test(script));
check('v13 : la sauvegarde pose house_facts + house_facts_ref sur la ligne du compte (owner_id), jamais une clé dérivée du nom', /villa_settings\?owner_id=eq\.' \+ encodeURIComponent\(uid\)/.test(script) && /house_facts: d, house_facts_ref: 'villa-facts\.js'/.test(script) && /villa_key: 'villa_' \+ uid/.test(script));
check('v13 : un anglais vide reste vide (jamais traduit en silence) ; la traduction est explicite, par ai-proxy write_en', /return \[S\(a\[0\]\), S\(a\[1\]\)\];/.test(script) && /task: 'write_en', system: sys/.test(script) && /if \(!it \|\| S\(feGet\(it\.path\)\)\) return;/.test(script));
check('v13 : une fiche neuve est vide — aucune valeur par défaut d’une autre villa', /function feBlank\(\) \{ return \{ VILLA: \{ name: '', host: ''/.test(script));
check('v13 : les clés que l’éditeur ne montre pas (QR…) sont conservées', /clés inconnues de l'éditeur \(QR…\) conservées/.test(script));
check('v13 : l’écran n’est pas redessiné pendant la saisie (le clavier reste ouvert) ; pas de rechargement périodique pendant l’édition', /fePut\(fp, e\.target\.value\);/.test(script) && /!U\.busy && !FE\.on\) load\(\)/.test(script));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
