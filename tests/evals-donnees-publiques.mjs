// Dépôt public — aucune donnée réelle de client dans les fichiers publiés.
//   node tests/evals-donnees-publiques.mjs
//
// Le dépôt (et le site GitHub Pages) sont publics : un vrai code de réservation,
// un vrai nom de client ou un email personnel dans un test, un commentaire ou un
// exemple de prompt devient lisible par tous. Les exemples utilisent des données
// fictives (codes HMTEST0001…, noms inventés).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail || ''); } };
const files = execSync('git ls-files', { cwd: root }).toString().split('\n')
  .filter((f) => f && !f.startsWith('_archive/') && /\.(html|js|mjs|ts|md|json|css)$/.test(f));

const codes = new Set();
for (const f of files) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of s.matchAll(/\bHM[A-Z0-9]{8}\b/g)) if (!/^HM(TEST\d{4}|ABCD[A-Z0-9]{4})$/.test(m[0])) codes.add(f + ':' + m[0]);
}
check('codes de réservation : uniquement fictifs (HMTEST…, HMABCD…)', codes.size === 0, [...codes].slice(0, 5).join(' '));

const testMails = new Set();
for (const f of files.filter((x) => x.startsWith('tests/'))) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of s.matchAll(/[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud|live|orange|free|wanadoo)\.[a-z.]+/gi)) testMails.add(f + ':' + m[0]);
}
check('tests : aucun email personnel', testMails.size === 0, [...testMails].slice(0, 5).join(' '));
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
