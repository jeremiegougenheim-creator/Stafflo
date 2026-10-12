// app.html — garde-fous de sécurité et de vérité.
//   node tests/evals-app-securite.mjs
//
// 1. IA : aucun appel direct à un fournisseur hors UE depuis le navigateur
//    (« Données traitées en Europe »). Mistral (Paris) reste autorisé.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

function topFn(src, name) {
  const i = src.indexOf('\nasync function ' + name + '(') >= 0 ? src.indexOf('\nasync function ' + name + '(') : src.indexOf('\nfunction ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n}\n', i);
  return src.slice(i + 1, j + 3);
}

// ── 1. IA hors UE ──────────────────────────────────────────────────────────
const cpa = topFn(app, 'callProviderAPI');
check('callProviderAPI trouvée', !!cpa);
async function runProvider(provider, flag) {
  const calls = [];
  const store = flag ? { stafflo_direct_ai: flag } : {};
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    AbortController, setTimeout, clearTimeout, console,
    fetch: async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }], content: [{ text: 'ok' }], candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), text: async () => '' }; },
  };
  vm.createContext(ctx);
  vm.runInContext(cpa + '\nthis.cpa = callProviderAPI;', ctx);
  let err = null;
  try { await ctx.cpa(provider, 'k', 's', 'u', 10); } catch (e) { err = String(e.message || e); }
  return { calls, err };
}
for (const p of ['openai', 'groq', 'deepseek', 'perplexity', 'gemini', 'anthropic']) {
  const r = await runProvider(p);
  check(`${p} : aucun appel direct par défaut`, r.calls.length === 0 && /direct_ai_disabled/.test(r.err || ''), r);
}
{
  const r = await runProvider('mistral');
  check('mistral (UE) : autorisé', r.calls.length === 1 && /api\.mistral\.ai/.test(r.calls[0]), r);
}
{
  const r = await runProvider('openai', 'on');
  check('réactivation volontaire possible (stafflo_direct_ai = on)', r.calls.length === 1, r);
}
const endpoints = (app.match(/https:\/\/(api\.openai\.com|api\.groq\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.perplexity\.ai)/g) || []).length;
const inside = (cpa.match(/https:\/\/(api\.openai\.com|api\.groq\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.perplexity\.ai)/g) || []).length;
check('aucun autre point d’appel IA hors UE dans app.html', endpoints === inside, { endpoints, inside });

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
