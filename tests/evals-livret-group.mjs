// Évals de detectLivretGroup() — rejouées contre le code réel d'app.html.
//   node tests/evals-livret-group.mjs
// Règle produit : jamais de groupe inventé. Aucun signal, ou signaux
// contradictoires → null (le livret salue alors par le prénom seul).
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
vm.runInContext(fnSource('detectLivretGroup') + '\nthis.detectLivretGroup = detectLivretGroup;', ctx);
const g = ctx.detectLivretGroup;

const evals = [];
const ev = (name, fn) => evals.push({ name, fn });

// Positifs
ev('Thibaut (message Airbnb réel) → famille', () =>
  g({ guestMessage: "Bonjour Jeremie, nous sommes une famille du Sud de la France qui venons à Marrakech pour fêter les 50 ans de mariage de nos parents." }) === 'famille');
ev('notes « GROUPE : 10 adultes, famille du Sud » → famille', () =>
  g({ notes: 'GROUPE : 10 adultes, famille du Sud de la France.' }) === 'famille');
ev('anglais « family reunion » → famille', () =>
  g({ message: 'Hi! We are coming for a family reunion.' }) === 'famille');
ev('« entre amis » → amis', () =>
  g({ message: 'Nous sommes un groupe de 8 amis pour un anniversaire.' }) === 'amis');
ev('anglais « group of friends » → amis', () =>
  g({ message: 'We are a group of friends celebrating a birthday.' }) === 'amis');
ev('« entre copines » → amis', () =>
  g({ message: 'Week-end entre copines !' }) === 'amis');

// Contradictions → null
ev('« deux familles d\'amis » → null', () =>
  g({ message: "Nous sommes deux familles d'amis." }) === null);
ev('message famille + notes amis → null', () =>
  g({ message: 'Voyage en famille', notes: 'groupe de friends' }) === null);

// Aucun signal → null (jamais une valeur par défaut)
ev('aucun texte → null', () => g({}) === null);
ev('message sans signal → null', () =>
  g({ message: 'Bonjour, nous arriverons vers 15h, merci !' }) === null);
ev('singulier « un ami nous a conseillé » → null', () =>
  g({ message: 'Un ami nous a conseillé votre villa.' }) === null);
ev('« amicalement » ne déclenche pas amis', () =>
  g({ message: 'Bien amicalement, Paul' }) === null);
ev('« familier » ne déclenche pas famille', () =>
  g({ message: 'Le quartier nous est familier.' }) === null);
ev('nom de famille seul (« Vauclare ») → null', () =>
  g({ message: 'Thibaut Vauclare' }) === null);

let fail = 0;
for (const { name, fn } of evals) {
  let ok = false;
  try { ok = !!fn(); } catch (e) { ok = false; }
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) fail++;
}
console.log(`\n${evals.length - fail}/${evals.length} PASS`);
process.exit(fail ? 1 : 0);
