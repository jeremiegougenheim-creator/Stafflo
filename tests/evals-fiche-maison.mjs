// Fiche maison (en base, house_facts) : une seule source de faits pour le livret,
// ARIA et les réponses types. Rejoue contre le code réel.
//   node tests/evals-fiche-maison.mjs
//
// Ce que ça protège :
//   1. le résumé IA contient les faits du jour (prix, équipe, horaires, règles)
//      et aucun fait périmé (Faiza, la Palmeraie, prix « par personne ») ;
//   2. l'injection n'ajoute la fiche qu'aux RÉDACTIONS, jamais aux extractions,
//      seulement pour la Villa Dar J, une seule fois, avec coupe-circuit ;
//   3. les réponses types Direct / Airbnb sont construites depuis la fiche ;
//   4. les anciennes copies figées ne reviennent pas dans app.html.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
// 13/10/2026 : la fiche est en base (villa_settings.house_facts). Copie de référence hors du
// site : _private/house-facts-pilot.json ; moteur public sans données : house-facts.js.
const engineSrc = fs.readFileSync(path.join(root, 'house-facts.js'), 'utf8');
const pilotData = JSON.parse(fs.readFileSync(path.join(root, '_private/house-facts-pilot.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail ? '— ' + detail : ''); }
}

// ── 1. Résumé IA ───────────────────────────────────────────────────────
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(engineSrc, ctx);
const F = ctx.window.StaffloHouseFacts.build(pilotData);
check('VILLA_FACTS (fiche construite par house-facts.js) gelé', F && Object.isFrozen(F));
const fr = F.digest('fr'), en = F.digest('en');
for (const [label, txt, must] of [
  ['FR', fr, ['650 MAD', '850 MAD', '300 MAD', 'Saïd', 'Bouchra', 'Léa', '23h et 7h', '14h', 'Douar Sabba', 'Deux jours avant']],
  ['EN', en, ['650 MAD', '850 MAD', '300 MAD', 'Saïd', 'Bouchra', 'Léa', '11 pm and 7 am', '2 pm', 'Douar Sabba', 'Two days before']]
]) {
  for (const m of must) check(`résumé ${label} contient « ${m} »`, txt.includes(m));
  for (const bad of ['Faiza', 'Palmeraie', 'MAD/personne', 'MAD/person', 'après minuit', 'after midnight'])
    check(`résumé ${label} sans « ${bad} »`, !txt.includes(bad));
}
check('résumé FR raisonnable (< 14 000 caractères)', fr.length < 14000, fr.length + ' car.');

// ── 2. Injection dans les requêtes ai-proxy ───────────────────────────
function slice(startMarker, endMarker) {
  const a = app.indexOf(startMarker);
  if (a < 0) throw new Error('introuvable: ' + startMarker);
  const b = app.indexOf(endMarker, a);
  if (b < 0) throw new Error('fin introuvable: ' + endMarker);
  return app.slice(a, b + endMarker.length);
}
const helpers = slice('function villaFactsActive() {', '})();\nfunction proxyHeaders() {').replace(/\nfunction proxyHeaders\(\) \{$/, '');

// v509 : le pilote est reconnu par villa_settings.house_facts_ref (relu dans cfg.houseFactsRef), plus par son nom.
function harness({ villa = 'Villa DarJ', facts = 'villa-facts.js', demo = false, killed = false } = {}) {
  const seen = [];
  const store = killed ? { stafflo_facts_ai: 'off' } : {};
  const sandbox = {
    window: { VILLA_FACTS: F },
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    STAFFLO_AUTH: { mode: demo ? 'demo' : 'auth' },
    STAFFLO_PROXY: 'https://x.supabase.co/functions/v1/ai-proxy',
    getCfg: () => ({ villa, houseFactsRef: facts }),
    lang: 'fr',
    JSON, String, Object, Array, RegExp
  };
  sandbox.window.fetch = (input, init) => { seen.push(init ? JSON.parse(init.body) : null); return Promise.resolve({}); };
  vm.createContext(sandbox);
  vm.runInContext(helpers.replace(/window\.fetch/g, 'window.fetch') + '\nthis.__f = window.fetch;', sandbox);
  const send = body => { sandbox.window.fetch(sandbox.STAFFLO_PROXY, { method: 'POST', body: JSON.stringify(body) }); return seen[seen.length - 1]; };
  return { send, sandbox };
}

{
  const h = harness();
  const w = h.send({ task: 'write_fr', system: 'SYS', user: 'U' });
  check('write_fr : fiche ajoutée au system', w.system.startsWith('SYS\n\n=== FICHE MAISON') && w.user === 'U');
  const w2 = h.send({ task: 'chat_fr', system: '', user: 'Question' });
  check('system vide : fiche préfixée au message, system laissé vide', w2.system === '' && w2.user.startsWith('=== FICHE MAISON') && w2.user.endsWith('=== DEMANDE ===\nQuestion'));
  const w3 = h.send({ task: 'write_guest_en', system: 'SYS', user: 'U' });
  check('write_guest_en : fiche en anglais', w3.system.includes('=== HOUSE FACTS'));
  for (const t of ['extract', 'fast_classify', 'vision', 'alerts'])
    check(`${t} : jamais de fiche`, JSON.stringify(h.send({ task: t, system: 'S', user: 'U' })) === JSON.stringify({ task: t, system: 'S', user: 'U' }));
  const twice = h.send({ task: 'reason', system: 'SYS\n=== FICHE MAISON déjà là', user: 'U' });
  check('pas de double injection', twice.system.split('=== FICHE MAISON').length === 2);
  check('brief : fiche ajoutée', h.send({ task: 'brief', system: 'S', user: 'U' }).system.includes('FICHE MAISON'));
  check('villaStaffNames = Saïd, Bouchra, Léa', JSON.stringify(vm.runInContext('villaStaffNames()', h.sandbox)) === JSON.stringify(['Saïd', 'Bouchra', 'Léa']));
  check('villaTeamLine sans Faiza', !/Faiza/.test(vm.runInContext("villaTeamLine('fr')", h.sandbox)));
}
check('autre villa : rien ajouté', !harness({ villa: 'Villa Les Oliviers', facts: '' }).send({ task: 'write_fr', system: 'S', user: 'U' }).system.includes('FICHE'));
check('villa nommée « Dar Jnane » sans fiche en base : rien ajouté (plus de test sur le nom)', !harness({ villa: 'Riad Dar Jnane', facts: '' }).send({ task: 'write_fr', system: 'S', user: 'U' }).system.includes('FICHE'));
check('pilote renommé : la fiche suit le compte, pas le nom', harness({ villa: 'Maison Atlas', facts: 'villa-facts.js' }).send({ task: 'write_fr', system: 'S', user: 'U' }).system.includes('FICHE'));
check('mode démo : rien ajouté', !harness({ demo: true }).send({ task: 'write_fr', system: 'S', user: 'U' }).system.includes('FICHE'));
check('coupe-circuit stafflo_facts_ai=off', !harness({ killed: true }).send({ task: 'write_fr', system: 'S', user: 'U' }).system.includes('FICHE'));
check('autre villa : villaStaffNames() = null', vm.runInContext('villaStaffNames()', harness({ villa: 'Autre', facts: '' }).sandbox) === null);

// ── 3. Réponses types Direct / Airbnb ─────────────────────────────────
const tmplBlock = slice('          if ((isDirect || isAirbnb) && villaFactsActive()) {', '\n          }\n          if (tmplText) {').replace(/\n          if \(tmplText\) \{$/, '');
function tmpl({ fr: isFr, direct }) {
  const sb = {
    window: { VILLA_FACTS: F }, villaFactsActive: () => true,
    fr: isFr, isDirect: direct, isAirbnb: !direct, tmplText: '',
    g: { arrival: '2027-06-10', departure: '2027-06-13', guests: 9, price: 0 }, nights: 3,
    _fn: 'Daniel', _weather: isFr ? 'Météo.' : 'Weather.', ownerName: 'Jérémie', String, Array
  };
  vm.createContext(sb);
  vm.runInContext(tmplBlock, sb);
  return sb.tmplText;
}
for (const [label, opt] of [['Airbnb FR', { fr: true, direct: false }], ['Airbnb EN', { fr: false, direct: false }],
                             ['Direct FR', { fr: true, direct: true }], ['Direct EN', { fr: false, direct: true }]]) {
  const t = tmpl(opt);
  check(`${label} : 650 et 850 MAD`, t.includes('650 MAD') && t.includes('850 MAD'), t.slice(0, 200));
  check(`${label} : ni Faiza ni Palmeraie`, !/Faiza|Palmeraie/.test(t));
  check(`${label} : pas de prix par personne`, !/MAD\s*\/\s*(personne|person)/.test(t));
  check(`${label} : calme 23h–7h`, opt.fr ? t.includes('entre 23h et 7h') : t.includes('between 11 pm and 7 am'));
  check(`${label} : équipe Saïd + Bouchra`, t.includes('Saïd') && t.includes('Bouchra'));
  check(`${label} : bloc repas reconnu par l'option combinée`, /\n(?:Notre service repas|Repas|Our food service|Food service)\s*:[\s\S]*$/i.test(t));
  check(`${label} : non-fumeur ET animaux (règle entière)`, opt.fr ? /Animaux non acceptés/.test(t) : /No pets/.test(t));
}
check('Direct FR : plus de « ~200 MAD » pour le transfert', !tmpl({ fr: true, direct: true }).includes('200 MAD'));

// ── 4. Les copies figées ne reviennent pas ────────────────────────────
for (const bad of ["Staff : Said, Faiza, Bouchra", "Briefer Said + Faiza", "Brief Said + Faiza + Bouchra",
                   "return ['Said','Faiza','Bouchra']", "'Said, Faiza, Bouchra'", "Piscine 28°C",
                   "au cœur de la Palmeraie", "Brunch : 300 MAD pour le groupe"])
  check(`app.html sans « ${bad} »`, !app.includes(bad));
check('app.html charge le moteur de la fiche (house-facts.js) avant tout script, plus villa-facts.js', app.indexOf('<script src="house-facts.js"></script>') > 0 &&
  app.indexOf('<script src="house-facts.js"></script>') < app.indexOf('<script>') && !app.includes('<script src="villa-facts.js">'));
const livret = fs.readFileSync(path.join(root, 'livret.html'), 'utf8');
// 13/10/2026 : la fiche n'est plus un fichier public ; le livret la reçoit de livret-view (tests/evals-livret-load.mjs).
check('livret.html lit la fiche maison (house-facts.js → window.VILLA_FACTS)', livret.includes('<script src="house-facts.js"></script>') && livret.includes('= window.VILLA_FACTS;'));
check('livret.html ne redéfinit plus les données', !/^const (MEALS|RULES|PRACTICAL|VILLA) = /m.test(livret));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
