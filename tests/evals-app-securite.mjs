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

// ── 2. Suppressions : douces partout, sauf deux exceptions assumées ────────
//   · runDiagnostic efface la ligne de test qu'il vient de créer (__DIAG_TEST__) ;
//   · « Supprimer définitivement » depuis la corbeille (droit à l'effacement).
const dels = [...app.matchAll(/method:\s*'DELETE'/g)].map((m) => app.slice(Math.max(0, m.index - 800), m.index));
check('2 suppressions définitives au plus (diagnostic + effacement volontaire)', dels.length === 2, dels.length);
check('exception 1 : ligne de test du diagnostic', dels.some((c) => /testId/.test(c)));
check('exception 2 : effacement depuis la corbeille', dels.some((c) => /function forgetClient/.test(c)));
for (const t of ['client_context', 'chat_history', 'prestataires']) {
  check(`${t} : suppression douce (deleted_at)`, new RegExp(t + "[^\\n]{0,200}\\n[^\\n]*method: 'PATCH'[\\s\\S]{0,260}deleted_at: new Date", 'm').test(app) || new RegExp(t + "[\\s\\S]{0,400}method: 'PATCH'[\\s\\S]{0,200}deleted_at: new Date").test(app));
}
check('client_context : lectures filtrées (2)', (app.match(/client_context\?client_id=(?:in\.\(' \+ ids\.join\(','\) \+ '\)|eq\.' \+ clientId \+ ')&deleted_at=is\.null/g) || []).length === 2);
check('client_context : ré-ajouter une clé la fait revivre', /updated_at: new Date\(\)\.toISOString\(\),\n\s*deleted_at: null/.test(app));
check('chat_history : lectures filtrées (2)', (app.match(/chat_history\?(?:deleted_at=is\.null&order|session_id=eq\.' \+ encodeURIComponent\(sessionId\) \+ '&deleted_at=is\.null)/g) || []).length === 2);
check('prestataires : lecture filtrée et id présent (bouton supprimer)', /prestataires\?select=id,name,[^']*&deleted_at=is\.null/.test(app));
check('annuler un ajout de client : suppression douce', /crm_clients\?id=eq\.'\+id, \{ method:'PATCH'[^\n]*deleted_at/.test(app));

// ── 3. Bugs ────────────────────────────────────────────────────────────────
const flights = topFn(app, 'fetchLiveFlights') || '';
check('fetchLiveFlights : fr défini avant usage', /const fr = \(typeof lang !== 'undefined' && lang === 'fr'\);/.test(flights) && flights.indexOf('const fr =') < flights.indexOf('fr?'));

// ── 4. Faits figés ─────────────────────────────────────────────────────────
const code = app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('« Faiza » absente du code (hors commentaires)', !/Faiza/.test(code));
check('« Briefer Bouchra » absent', !/Briefer Bouchra/.test(app));
check('« 28°C » absent des prompts', !/28°C/.test(code));
const mem = topFn(app, 'loadAriaMemoryTemplate') || '';
check('modèle mémoire ARIA sans valeur inventée (aucun prix, wifi, caution)', mem && !/\d[\d\s]*€|DarJ_Guest|Hassan|1 500|24-28/.test(mem));
check('exemple du classifieur sans montant ni nom inventé', !/Paiement Saïd 3000 MAD/.test(app) && /"amount":null,"due_date":null\}\]\} — montant/.test(app));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
