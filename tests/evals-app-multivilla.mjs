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
check('aucune adresse email du pilote en dur', !/jergoug@|marrakech\.villadarj@/.test(app));
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
  const a = run({ email_connection: { email: 'Boite.Villa@gmail.com' } }, { email: 'proprio@example.com' });
  check('expéditeurs : Airbnb + boîte connectée + email du compte', a === 'in.(automated%40airbnb.com,boite.villa%40gmail.com,proprio%40example.com)', a);
  const b = run({}, null);
  check('expéditeurs : sans compte ni boîte → Airbnb seulement (jamais une adresse d\'un autre compte)', b === 'in.(automated%40airbnb.com)', b);
  const c = run({ email_connection: { email: 'x@y.com,z@w.com' } }, { email: 'a@b.com)' });
  check('expéditeurs : une valeur qui casserait le filtre est ignorée', c === 'in.(automated%40airbnb.com)', c);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
