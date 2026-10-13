// Site public (Cloudflare Workers) — le build ne publie que les fichiers servis, et tous ceux qu'il faut.
//   node tests/evals-site-build.mjs
//
// 1. scripts/build-site.sh construit dist/ dans un dossier temporaire.
// 2. Aucun fichier privé n'y est (CLAUDE.md, tests, supabase, rapports, .git).
// 3. Chaque fichier local cité par une page, un script ou une feuille de style existe dans dist/.
// 4. La config Cloudflare garde les URL en .html (html_handling "none").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stafflo-dist-'));
execFileSync('bash', [path.join(root, 'scripts/build-site.sh'), out], { stdio: 'pipe' });
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(out, p)); } })(out);
const has = new Set(files);

check('build : pages et ressources publiées', ['index.html', 'app.html', 'espace.html', 'livret.html', 'equipe.html', 'sw.js', '_headers', 'fonts/tabler-icons.css', 'assets/icon-192.png'].every((f) => has.has(f)));
const priv = files.filter((f) => /^(CLAUDE\.md|RAPPORT|tests\/|supabase\/|scripts\/|site\/|\.git|wrangler|_archive|docs\/)/.test(f) || /\.(md|ts|mjs|tsv)$/.test(f));
check('build : aucun fichier privé publié (manuel, tests, fonctions serveur, rapports)', priv.length === 0, priv);

// Références locales : attributs src/href, url(...) CSS, chaînes 'fichier.ext' dans le JS.
const missing = new Set();
const NOT_FILES = new Set(['inject.js']); // noms cités dans du code (filtre d'erreurs d'extensions navigateur), pas des fichiers du site
const isLocal = (u) => u && !/^(https?:|mailto:|tel:|sms:|data:|blob:|javascript:|#|\/\/|\{|\$)/i.test(u) && !/[+'"\s]/.test(u) && (/\.[a-z0-9]{2,11}([?#]|$)/i.test(u) || u.includes('/')) && !NOT_FILES.has(u);
const norm = (u) => decodeURIComponent(u.split(/[?#]/)[0].replace(/^\.?\//, ''));
for (const f of files.filter((x) => /\.(html|js|css|json|webmanifest)$/.test(x))) {
  const txt = fs.readFileSync(path.join(out, f), 'utf8');
  const refs = [];
  for (const m of txt.matchAll(/\b(?:src|href)\s*=\s*["']([^"'<>]+)["']/g)) refs.push(m[1]);
  for (const m of txt.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push(m[1]);
  for (const m of txt.matchAll(/["']((?:\.\/|\/)?(?:assets\/|fonts\/)?[\w.-]+\.(?:html|js|css|png|jpg|jpeg|svg|woff2|webmanifest|json))(?:[?#][^"']*)?["']/g)) refs.push(m[1]);
  for (const r of refs) {
    if (!isLocal(r)) continue;
    const n = norm(r);
    if (!n || /^(api|functions|rest|auth)\//.test(n) || /\.supabase\.co/.test(n)) continue;
    const base = f.includes('/') ? path.posix.join(path.posix.dirname(f), n) : n;
    if (!has.has(n) && !has.has(base)) missing.add(f + ' → ' + r);
  }
}
check('build : chaque fichier local cité par le site existe dans dist/', missing.size === 0, [...missing].slice(0, 15));

const wr = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
check('Cloudflare : URL en .html servies telles quelles (pas de redirection vers /app)', /"html_handling":\s*"none"/.test(wr) && /"directory":\s*"\.\/dist"/.test(wr));
check('Cloudflare : « / » sert la page d’accueil', /"not_found_handling":\s*"single-page-application"/.test(wr));
const hd = fs.readFileSync(path.join(root, 'site/_headers'), 'utf8');
check('en-têtes : service worker et Espace jamais servis périmés', /\/sw\.js\n\s+Cache-Control: no-cache/.test(hd) && /\/espace\.html\n\s+Cache-Control: no-cache/.test(hd));
check('dist/ jamais versionné', /^dist\/$/m.test(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
