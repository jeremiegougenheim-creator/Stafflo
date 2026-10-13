// app.html — multi-villa : un compte ne lit, n'écrit et n'affiche que SA villa.
//   node tests/evals-app-multivilla.mjs
//
// Villa Dar J n'est que le pilote. Aucun identifiant, adresse, numéro ou annonce du
// pilote ne doit servir de valeur par défaut à un autre compte.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 3);
}

// ── v508 : réglages, connexion Gmail, emails, annonce Airbnb ─────────────
// Aucune vraie adresse ni vrai numéro dans le code public : seulement des domaines d'exemple ou de service,
// et des numéros de fiction (séries « 1234567 », Ofcom 07700 900xxx, zéros).
{
  const mails = [...new Set(app.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || [])];
  const badMails = mails.filter((m) => !/@(example\.[a-z.]+|exemple\.com|email\.com|airbnb\.com|booking\.com|stafflo\.app)$/i.test(m));
  check('aucune vraie adresse email dans app.html (exemples et services seulement)', badMails.length === 0, badMails);
  const phones = [...new Set(app.match(/\+\d{2,3}[ \d]{7,14}/g) || [])];
  const badPhones = phones.filter((n) => !/1234567|0123456|7700 ?900|600000000/.test(n.replace(/ /g, (x) => x)) && !/1234567|0123456|7700900|600000000/.test(n.replace(/ /g, '')));
  check('aucun vrai numéro de téléphone dans app.html (numéros de fiction seulement)', badPhones.length === 0, badPhones);
}
check('aucune annonce Airbnb du pilote par défaut', !/756889438032872685/.test(app));
check('réglages : enregistrés sur la ligne du compte (owner_id), pas sur « villadarj »',
  /villa_settings\?' \+ _own, \{/.test(app) && /'owner_id=eq\.' \+ _stafflo_user\.id : 'villa_key=eq\.'/.test(app));
check('réglages : relus sur la ligne du compte', /villa_settings\?' \+ _ownP \+ '&select=\*'/.test(app));
check('déconnexion Gmail : sur la ligne du compte, avec le jeton de session (le serveur arrête de lire la boîte)',
  /\(_dUid \? 'owner_id=eq\.' \+ _dUid : 'villa_key=eq\.' \+ villaKey\)/.test(app) && /Authorization: 'Bearer ' \+ _dTok/.test(app));
check('connexion Gmail : villa_key n\'est plus réécrite depuis le nom de la villa', !/villa_key: villaKey,\s*\n\s*email_connection: conn/.test(app));
check('emails lus : Airbnb + adresses du compte, aux 4 endroits',
  (app.match(/from_email=['"] \+ inboxSendersIn\(\) \+ ['"]&/g) || []).length === 4);

const src = fnSource(app, 'inboxSendersIn');
check('inboxSendersIn extraite', !!src);
if (src) {
  const run = (cfg, user) => {
    const ctx = { getCfg: () => cfg, _stafflo_user: user, encodeURIComponent, String };
    vm.runInNewContext(src + '\nthis.r = inboxSendersIn();', ctx);
    return ctx.r;
  };
  const a = run({ email_connection: { email: 'Boite.Villa@example.org' } }, { email: 'proprio@example.com' });
  check('expéditeurs : Airbnb + boîte connectée + email du compte', a === 'in.(automated%40airbnb.com,boite.villa%40example.org,proprio%40example.com)', a);
  const b = run({}, null);
  check('expéditeurs : sans compte ni boîte → Airbnb seulement (jamais une adresse d\'un autre compte)', b === 'in.(automated%40airbnb.com)', b);
  const c = run({ email_connection: { email: 'x@y.com,z@w.com' } }, { email: 'a@b.com)' });
  check('expéditeurs : une valeur qui casserait le filtre est ignorée', c === 'in.(automated%40airbnb.com)', c);
}

// ── v509 : identité — fiche maison, nom, propriétaire, WhatsApp ─────────
const code = app.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // hors commentaires
check('fiche maison choisie par la base (house_facts_ref), plus par le nom de la villa',
  /return c\.houseFactsRef === 'villa-facts\.js';/.test(app) && !/dar\\s\*-\?\\s\*j/.test(app));
check('drapeau fiche maison relu à chaque démarrage, avant les sorties anticipées',
  /cfg\.houseFactsRef = _hf;[\s\S]{0,400}if \(!row\.onboarded\) return;/.test(app));
check('aucun indicatif de Hong Kong (numéro perso du pilote) dans app.html', !/\+852/.test(app));
check('aucun repli sur le prénom du pilote', !/'Jérémie'/.test(code));
check('aucun repli sur le nom de la villa pilote', !/'Villa DarJ|'DarJ'|Villa DarJ \(vous\)|de Villa DarJ|saison Villa DarJ/.test(code));
check('modèles de messages : identité du compte aux deux endroits', (app.match(/ownerTemplateCtx\(\)/g) || []).length >= 2 && !/owner_whatsapp: '/.test(app));
check('bulles d’aide Prix : ni chiffres ni événements du pilote', !/Net ≥ 700|Festival du Film, Marathon, Marrakech du Rire|Film Festival, Marathon, Marrakech du Rire|capacité Villa DarJ/.test(app));
check('ville vide ≠ Marrakech (seul le pilote garde l’ancien repli)', /if \(!city\) return c\.houseFactsRef === 'villa-facts\.js';/.test(app));
{
  const helpers = fnSource(app, 'villaNameOr') + '\n' + fnSource(app, 'ownerNameOr');
  const run = (cfg, lng, expr) => { const ctx = { getCfg: () => cfg, lang: lng, String }; vm.runInNewContext(helpers + '\nthis.r = ' + expr + ';', ctx); return ctx.r; };
  check('villaNameOr : nom du compte', run({ villa: 'Casa Lumi' }, 'fr', 'villaNameOr()') === 'Casa Lumi');
  check('villaNameOr : vide → « la villa » / « the villa », jamais le pilote', run({}, 'fr', 'villaNameOr()') === 'la villa' && run({ villa: '  ' }, 'en', 'villaNameOr()') === 'the villa');
  check('ownerNameOr : vide → repli demandé ou « le propriétaire »', run({}, 'fr', "ownerNameOr('?')") === '?' && run({}, 'fr', 'ownerNameOr()') === 'le propriétaire' && run({ owner: 'Ana' }, 'en', 'ownerNameOr()') === 'Ana');
}
{
  const i = app.indexOf('  function ownerTemplateCtx(){'), j = app.indexOf('\n  }\n', i);
  const src2 = app.slice(i, j + 5);
  const run = (cfg) => { const ctx = { getCfg: () => cfg, String }; vm.runInNewContext(src2 + '\nthis.r = ownerTemplateCtx();', ctx); return ctx.r; };
  check('modèles : réglages vides → aucun champ rempli (les {trous} restent signalés)', JSON.stringify(run({})) === '{}');
  check('modèles : nom, propriétaire et WhatsApp du compte', JSON.stringify(run({ villa: 'Casa Lumi', owner: 'Ana', wa: '+351 900' })) === JSON.stringify({ villa_name: 'Casa Lumi', owner_name: 'Ana', owner_whatsapp: '+351 900' }));
}

// ── v510 : livret, vols, événements, séjour ─────────────────────────────
const MKG = "(typeof isMarrakechVilla === 'function' && !isMarrakechVilla())";
check('livret : jamais ouvert sans fiche maison (il ne décrit que la villa pilote)', /function openLivretAction\(c\)\{\s*if \(!c\) return;[\s\S]{0,400}if \(typeof villaFactsActive === 'function' && !villaFactsActive\(\)\) \{/.test(app));
check('livret : ni carte de rappel, ni lien dans le message d’accueil, ni bouton sans fiche maison',
  /livretSentAt\) return; \/\/ déjà envoyé, aucune carte\s*\n\s*if \(typeof villaFactsActive === 'function' && !villaFactsActive\(\)\) return;/.test(app)
  && /typeof window\.livretUrl !== 'function'\) return content;\s*\n\s*if \(typeof villaFactsActive === 'function' && !villaFactsActive\(\)\) return content;/.test(app)
  && /livretBtn\.style\.display = \(firm && _hasFacts\)/.test(app));
check('vols RAK : seulement pour une villa à Marrakech (affichage et appel en direct)', app.includes('if ' + MKG + ' {\n    var _fl = document.getElementById(\'factorFlights\')') && app.includes('if ' + MKG + ' return; // v510 : vols RAK'));
check('événements de Marrakech (ancien moteur de prix, +15 %) : seulement à Marrakech', app.includes('if ' + MKG + ' { MARRAKECH_EVENTS = []; return; }') && app.includes('if ' + MKG + ' return null; // v510'));
check('séjour (décompte) : villa du compte, MAD seulement au Maroc', !/villa_name: 'DarJ Marrakech'/.test(app) && /devise: \(\/maroc\|morocco\/i\.test/.test(app));

check('concurrents : « Suggestions Marrakech » seulement pour une villa à Marrakech', app.includes("if (!document.getElementById('compSuggestions') && !(typeof isMarrakechVilla === 'function' && !isMarrakechVilla())) {"));

check('démo sur un vrai compte : aucun client de démo envoyé en base, par les deux chemins', /async function pushToSupabase\(client\) \{\n  if \(client && client\._demo\) return;/.test(app) && /async function safePushToSupabase\(client\)\{\n    if \(client && client\._demo\) return false;/.test(app));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
