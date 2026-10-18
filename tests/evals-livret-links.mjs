// Liens personnels du livret + fiche maison en base, côté app et Espace.
//   node tests/evals-livret-links.mjs
//
// 1. StaffloHouseFacts.livretLinks (house-facts.js) : jeton venu de la base (rpc livret_token),
//    copie locale PAR COMPTE, jamais d'invention, un seul appel par séjour.
// 2. app.html au démarrage : la fiche ne vient que de la copie du MÊME compte, puis de la base.
// 3. Les liens montrés ou envoyés portent le jeton ; sans jeton, aucun lien mort n'est envoyé.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const engine = read('house-facts.js');
const DATA = JSON.parse(read('_private/house-facts-pilot.json'));
function sandbox(store = {}) {
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ctx = { window: {}, localStorage: ls, JSON, Promise, String, Object, Array };
  vm.createContext(ctx); vm.runInContext(engine, ctx);
  return { ctx, store, HF: ctx.window.StaffloHouseFacts };
}
const T1 = 'a'.repeat(43), T2 = 'b'.repeat(43);

// ── 1. livretLinks ─────────────────────────────────────────────────────────
{
  const { HF, store } = sandbox();
  let who = 'u1', calls = 0;
  const L = HF.livretLinks({ owner: () => who, list: async () => [{ client_id: 's1', token: T1 }, { client_id: 's2', token: 'court' }], create: async (id) => { calls++; return id === 'bad' ? 'pas un jeton' : T2; } });
  check('sans lien connu : rien (jamais de jeton inventé côté navigateur)', L.get('s1') === '');
  await L.load();
  check('chargement : liens actifs du compte, jetons invalides ignorés', L.get('s1') === T1 && L.get('s2') === '');
  const [a, b] = await Promise.all([L.ensure('s9'), L.ensure('s9')]);
  check('séjour sans lien : un seul appel à la base, même si demandé deux fois', a === T2 && b === T2 && calls === 1);
  check('réponse de la base qui n’est pas un jeton → aucun lien', (await L.ensure('bad')) === '' && L.get('bad') === '');
  check('copie locale rattachée au compte', JSON.parse(store.stafflo_livret_tokens).owner === 'u1');
  who = 'u2';
  check('autre compte connecté : aucun lien du compte précédent', L.get('s1') === '' && L.get('s9') === '');
  who = '';
  check('sans session : aucun appel, aucun lien', (await L.ensure('s1')) === '' && calls === 2);
  who = 'u1';
  check('retour du premier compte : sa copie locale revient', L.get('s1') === T1 && L.get('s9') === T2);
}
{
  const { HF } = sandbox({ stafflo_livret_tokens: JSON.stringify({ owner: 'u1', map: { s1: T1 } }) });
  let who = '';
  const L = HF.livretLinks({ owner: () => who, list: async () => { throw new Error('réseau'); }, create: async () => { throw new Error('réseau'); } });
  who = 'u1';
  check('session ouverte après le chargement de la page : la copie locale sert tout de suite', L.get('s1') === T1);
  check('réseau coupé : ensure et load ne cassent rien (lien vide, copie gardée)', (await L.ensure('s7')) === '' && (await L.load()) === false && L.get('s1') === T1);
}

// ── 2. app.html : fiche au démarrage ───────────────────────────────────────
const app = read('app.html');
const bi = app.indexOf('<script src="house-facts.js"></script>\n<script>');
const boot = bi > 0 ? app.slice(app.indexOf('<script>', bi) + 8, app.indexOf('</script>', bi + 50)) : '';
check('app : moteur house-facts.js chargé en premier, script de démarrage juste après', bi > 0 && bi < app.indexOf('<script>') && /staffloHouseFactsHydrate/.test(boot));
function bootWith(store) {
  const s = sandbox(store);
  vm.runInContext(boot, s.ctx);
  return s;
}
const sess = (id) => JSON.stringify({ access_token: 'x', user: { id } });
let s = bootWith({ stafflo_session: sess('u1'), stafflo_house_facts: JSON.stringify({ owner: 'u1', facts: DATA }) });
check('démarrage, même compte : fiche prête tout de suite', !!s.ctx.window.VILLA_FACTS && typeof s.ctx.window.VILLA_FACTS.digest === 'function');
s = bootWith({ stafflo_session: sess('u2'), stafflo_house_facts: JSON.stringify({ owner: 'u1', facts: DATA }) });
check('démarrage, autre compte sur l’appareil : aucune fiche', s.ctx.window.VILLA_FACTS === undefined);
s = bootWith({ stafflo_house_facts: JSON.stringify({ owner: 'u1', facts: DATA }) });
check('démarrage sans session : aucune fiche', s.ctx.window.VILLA_FACTS === undefined);
s = bootWith({ stafflo_session: sess('u1') });
s.ctx.window.staffloHouseFactsHydrate(DATA);
check('fiche reçue de la base : utilisée et gardée pour CE compte', !!s.ctx.window.VILLA_FACTS && JSON.parse(s.store.stafflo_house_facts).owner === 'u1');
s.ctx.window.staffloHouseFactsHydrate(null);
check('compte sans fiche en base : fiche retirée, copie effacée', s.ctx.window.VILLA_FACTS === undefined && !('stafflo_house_facts' in s.store));
check('app : la fiche n’est jamais copiée dans cfg (ne repart pas avec pushVillaSettings)', !/cfg\.house_?[fF]acts\s*=/.test(app) && !/cfg\.houseFacts\s*=/.test(app));
check('app : déconnexion → fiche et liens effacés de l’appareil', /localStorage\.removeItem\('stafflo_house_facts'\);\s*localStorage\.removeItem\('stafflo_livret_tokens'\);\s*delete window\._demoMode;/.test(app));

// ── 3. Liens montrés / envoyés ─────────────────────────────────────────────
check('app : livretUrl ajoute le jeton du séjour (sinon le prépare)', /var tk = window\.livretLinks \? window\.livretLinks\.get\(c\.id\) : '';\s*if \(tk\) p\.set\('t', tk\); else if \(window\.livretLinks && c\.id\) window\.livretLinks\.ensure\(c\.id\);/.test(app));
check('app : liens créés par la base (rpc livret_token), jamais dans le navigateur', /rest\/v1\/rpc\/livret_token/.test(app) && !/getRandomValues[\s\S]{0,200}livret/.test(app));
check('app : ouverture du livret sans lien prêt → fenêtre ouverte tout de suite, marqué « envoyé » seulement avec le lien',
  /var w = window\.open\('', '_blank'\);\s*window\.livretLinks\.ensure\(c\.id\)\.then\(function\(tk\)\{\s*if \(!tk \|\| !w\) \{[\s\S]{0,400}return; \/\/ pas de lien → pas marqué « envoyé »/.test(app));
check('app : message de bienvenue sans jeton → aucun lien (jamais un lien mort)', /if \(window\.livretLinks && !window\.livretLinks\.get\(a\.guest\.id\)\) \{ window\.livretLinks\.ensure\(a\.guest\.id\); return content; \}/.test(app));
check('app : le lien se prépare pendant la rédaction ARIA (2 chemins)', (app.match(/if \(_lk\) await _lk;/g) || []).length === 2);
check('app : liens des séjours à venir préparés au démarrage', /window\.livretLinks\.load\(\)\.then\(function\(\)\{ staffloEnsureLivretLinks\(\); \}\)/.test(app));

const esp = read('espace.html');
check('Espace : livretUrl ajoute le jeton du séjour — lien court, sans nom ni dates (18/10)', /var tk = LINKS \? LINKS\.get\(c\.id\) : '';[^\n]*\n\s*if \(tk\) \{[^\n]*\n\s*var ps = new URLSearchParams\(\); ps\.set\('t', tk\); ps\.set\('lang', p\.get\('lang'\)\);/.test(esp));
check('Espace : liens chargés avec les données, puis préparés avant le rendu', /LINKS \? LINKS\.load\(\) : null/.test(esp) && /if \(HAS_FACTS && LINKS\) return Promise\.all\(D\.stays\.map\(function \(c\) \{ return LINKS\.ensure\(c\.id\); \}\)\);/.test(esp));
check('Espace : bouton livret seulement avec un lien personnel', /HAS_FACTS && LINKS && LINKS\.get\(c\.id\) \? '<button type="button" class="act" data-a="panel" data-id="' \+ esc\(c\.id\) \+ '" data-v="livret"/.test(esp) && /pn === 'livret' \? '<a class="btn ghost" href="' \+ esc\(livretUrl\(c\)\)/.test(esp));
check('Espace : liens créés par la base (rpc livret_token)', /api\('rpc\/livret_token'/.test(esp));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
