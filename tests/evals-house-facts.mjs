// Fiche maison hors du site public — moteur (house-facts.js) + données en base.
//   node tests/evals-house-facts.mjs
//
// Le moteur public ne contient AUCUNE donnée de villa. Les données du pilote vivent en
// base (villa_settings.house_facts) ; leur copie de référence est _private/house-facts-pilot.json
// (jamais publiée : dossier en « _ » ignoré par GitHub Pages, absent du build Cloudflare).
// Modifier la fiche = modifier ce JSON puis le recopier en base (scripts/house-facts-sql.mjs).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const engine = read('house-facts.js');
const data = JSON.parse(read('_private/house-facts-pilot.json'));
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(engine, ctx);
const HF = ctx.window.StaffloHouseFacts;

// 1. Le moteur public ne contient aucune valeur de la fiche (comparé aux vraies valeurs, jamais affichées).
const secrets = [data.VILLA.wifi && data.VILLA.wifi.net, data.VILLA.wifi && data.VILLA.wifi.pass, data.VILLA.hostPhone, data.VILLA.said, data.VILLA.address, String(data.VILLA.pin && data.VILLA.pin.lat)]
  .concat((data.TEAM || []).map((m) => m.name)).filter((x) => x && String(x).length >= 3);
check('moteur public : aucune valeur de la fiche (wifi, téléphones, adresse, position, équipe)', secrets.every((s) => !engine.includes(String(s))), `${secrets.filter((s) => engine.includes(String(s))).length} valeur(s) trouvée(s)`);
check('moteur public : aucun QR code ni numéro', !/<svg|\+\d{3}\s?\d/.test(engine));
const legacy = read('villa-facts.js');
check('villa-facts.js (encore servi pour les pages en cache) : plus aucune donnée', secrets.every((s) => !legacy.includes(String(s))) && !/VILLA_FACTS\s*=|<svg|\+\d{3}\s?\d/.test(legacy));

// 2. build(data) rend l'objet attendu, gelé, avec le résumé ARIA.
const F = HF && HF.build(data);
check('build : toutes les clés de la fiche + QR + digest', !!F && HF.KEYS.every((k) => k in F) && typeof F.digest === 'function' && Object.isFrozen(F));
check('build : sans données → null (jamais une fiche d’une autre villa)', HF.build(null) === null && HF.build({}) === null);
check('QR WhatsApp du livret : dans les données, plus dans la page', !!(F.QR && /^<svg/.test(F.QR.staff) && /^<svg/.test(F.QR.host)));

// 3. Résumé ARIA : identique, au caractère près, à celui de l'ancien villa-facts.js (empreintes du 13/10/2026).
//    Si la fiche a été modifiée VOLONTAIREMENT, recalculer les empreintes.
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
check('résumé ARIA (fr) inchangé', h(F.digest('fr')) === '2a607cca53abc6da', h(F.digest('fr')));
check('résumé ARIA (en) inchangé', h(F.digest('en')) === '7e1c81e0b9c59549', h(F.digest('en')));
check('équipe actuelle seulement (jamais l’ancienne cuisinière)', !/Faiza/.test(F.digest('fr')) && !/Faiza/.test(JSON.stringify(data.TEAM)));

// 4. Le JSON de référence n'est jamais publié.
check('données de référence hors du site (dossier « _ », absent du build)', !/_private/.test(read('scripts/build-site.sh')) && !fs.existsSync(path.join(root, '.nojekyll')));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
