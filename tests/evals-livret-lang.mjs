// Rejoue tests/evals-livret-lang.md contre le code réel d'app.html.
//   node tests/evals-livret-lang.mjs
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
vm.runInContext(fnSource('resolveLivretPax') + '\nthis.resolveLivretPax = resolveLivretPax;', ctx);
const detectLivretLang = ctx.detectLivretLang;
const resolveLivretPax = ctx.resolveLivretPax;

const evals = [];
const ev = (name, fn) => evals.push({ name, fn });

ev('téléphone français, aucun message → fr', () =>
  detectLivretLang({ phone: '+33 6 12 34 56 78' }) === 'fr');

ev('téléphone britannique, aucun message → en', () =>
  detectLivretLang({ phone: '+44 7700 900123' }) === 'en');

ev('téléphone marocain, aucun message → bi', () =>
  detectLivretLang({ phone: '+212 6 12 34 56 78' }) === 'bi');

ev('téléphone belge, suisse, canadien → bi', () =>
  detectLivretLang({ phone: '+32 470 12 34 56' }) === 'bi' &&
  detectLivretLang({ phone: '+41 79 123 45 67' }) === 'bi' &&
  detectLivretLang({ phone: '+1 416 555 0123' }) === 'bi');

ev('aucun téléphone, aucun message → bi', () =>
  detectLivretLang({}) === 'bi');

ev('premier message en français → fr', () =>
  detectLivretLang({ message: 'Bonjour, nous arriverons vers 15h, merci !' }) === 'fr');

ev('premier message en anglais → en', () =>
  detectLivretLang({ message: 'Hi, we will arrive around 3pm, thank you!' }) === 'en');

ev('téléphone +33 mais message en anglais → conflit → bi', () =>
  detectLivretLang({ phone: '+33 6 12 34 56 78', message: 'Hi, we will arrive around 3pm, thank you!' }) === 'bi');

ev('nom seul (Felipe Villalobos) — jamais un signal → bi', () => {
  // detectLivretLang ne prend même pas de paramètre "name" : impossible d'en
  // faire un signal par construction. On vérifie que le nom seul, passé par
  // erreur dans un champ non lu par la fonction, n'influence rien.
  const out = detectLivretLang({ name: 'Felipe Villalobos' });
  return out === 'bi';
});

ev('nombre de voyageurs présent (guests=5) → 5', () =>
  resolveLivretPax({ guests: 5 }) === 5);

ev('nombre de voyageurs présent (adults+children) → total', () =>
  resolveLivretPax({ adults: 2, children: 3 }) === 5);

ev('nombre de voyageurs absent → null, jamais 10', () =>
  resolveLivretPax({}) === null && resolveLivretPax({ adults: 0, children: 0, guests: 0 }) === null);

let fails = 0;
for (const { name, fn } of evals) {
  let ok = false, err = '';
  try { ok = !!fn(); } catch (e) { err = ' — ' + (e && e.message); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + err);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} échec(s)` : `\n${evals.length}/${evals.length} PASS`);
process.exit(fails ? 1 : 0);
