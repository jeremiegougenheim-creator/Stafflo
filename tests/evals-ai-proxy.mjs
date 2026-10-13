// ai-proxy (supabase/functions/ai-proxy) — garde-fous SaaS : identité, quotas, UE, journal.
//   node tests/evals-ai-proxy.mjs   (nécessite esbuild : PUSH_TEST_MODULES=… comme evals-push)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/ai-proxy/index.ts'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
check('aucun fournisseur hors UE (Gemini, Groq, DeepSeek, OpenAI)', !/generativelanguage|api\.groq\.com|deepseek|api\.openai\.com|GEMINI_API_KEY|GROQ_API_KEY/i.test(code));
check('vision routée chez Mistral', /vision:\s*\['mistral'\]/.test(code));

// ── Banc d'essai ─────────────────────────────────────────────────────────────
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'ANON', SUPABASE_SERVICE_ROLE_KEY: 'SVC', MISTRAL_API_KEY: 'mk' };
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] } };
const CALLS = { auth: 0, mistral: [], log: [] };
let mistralMode = 'ok';
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://sb.test/auth/v1/user') {
    CALLS.auth++;
    const tok = (init.headers.Authorization || '').replace('Bearer ', '');
    return tok === 'good' ? new Response(JSON.stringify({ id: 'owner-1' }), { status: 200 }) : new Response('{}', { status: 401 });
  }
  if (url === 'https://sb.test/rest/v1/ai_usage_log') { CALLS.log.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
  if (url === 'https://api.mistral.ai/v1/chat/completions') {
    const b = JSON.parse(init.body); CALLS.mistral.push(b);
    if (mistralMode === 'tier' && b.model === 'mistral-large-2512') return new Response('{"code":"1910","message":"tier_not_allowed"}', { status: 403 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Réponse de test suffisamment longue pour passer la validation.' } }] }), { status: 200 });
  }
  throw new Error('appel réseau inattendu : ' + url);
};
const patched = src.replace(/^import \{ serve \} from .*$/m, 'const serve = (h) => { globalThis.__h = h; };');
const js = esbuild.transformSync(patched, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
handler = globalThis.__h;
const flush = () => new Promise((r) => setTimeout(r, 5));
const call = (body, o = {}) => handler(new Request('https://x/ai-proxy', {
  method: 'POST',
  headers: { origin: o.origin ?? 'https://stafflo.app', 'content-type': 'application/json', 'x-forwarded-for': o.ip || '1.1.1.1', ...(o.auth ? { authorization: 'Bearer ' + o.auth } : {}) },
  body: JSON.stringify(body),
}));

let r = await call({ task: 'chat_fr', user: 'bonjour' }, { origin: 'https://evil.example' });
check('origine inconnue → 403', r.status === 403);

// Propriétaire connecté
r = await call({ task: 'chat_fr', user: 'Qui arrive demain ?', max_tokens: 900 }, { auth: 'good' });
let d = await r.json(); await flush();
check('connecté : réponse Mistral', r.status === 200 && /Réponse de test/.test(d.text));
check('connecté : max_tokens respecté (900)', CALLS.mistral.at(-1).max_tokens === 900);
check('journal : une ligne avec le propriétaire, la tâche et le modèle', CALLS.log.at(-1)?.owner_id === 'owner-1' && CALLS.log.at(-1).task === 'chat_fr' && CALLS.log.at(-1).success === true && !!CALLS.log.at(-1).model_used);
await call({ task: 'chat_fr', user: 'encore' }, { auth: 'good' });
check('jeton vérifié une fois puis mis en cache', CALLS.auth === 1);

// Anonyme (onboarding, démo)
r = await call({ task: 'write_fr', user: 'Rédige un message de bienvenue', max_tokens: 3000 }, { ip: '2.2.2.2' });
await flush();
check('anonyme : réponses plafonnées à 700 tokens', r.status === 200 && CALLS.mistral.at(-1).max_tokens === 700);
check('anonyme : journalisé sans propriétaire', CALLS.log.at(-1)?.owner_id === null);
const anonJwt = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'anon', ref: 'x' })).toString('base64url') + '.sig';
check('JWT de rôle anon (clé de l’app) reconnu comme public', M.isPublicKey(anonJwt) && M.isPublicKey('sb_publishable_abc') && !M.isPublicKey('good'));
r = await call({ task: 'write_fr', user: 'x' }, { auth: anonJwt, ip: '2.2.2.2' });
check('clé anon publique = anonyme (pas un compte)', r.status === 200 && CALLS.mistral.at(-1).max_tokens === 700);
for (let i = 0; i < 13; i++) await call({ task: 'fast_classify', user: 'x' }, { ip: '2.2.2.2' });
r = await call({ task: 'fast_classify', user: 'x' }, { ip: '2.2.2.2' });
d = await r.json();
check('anonyme : 16e appel de l’heure refusé (429, connexion demandée)', r.status === 429 && d.login_required === true);
r = await call({ task: 'fast_classify', user: 'x' }, { ip: '3.3.3.3' });
check('autre IP : non concernée', r.status === 200);
const nm = CALLS.mistral.length;
r = await call({ task: 'chat_fr', user: 'x' }, { auth: 'expired', ip: '4.4.4.4', });
check('jeton expiré → 401 (l’app rafraîchit et rejoue), aucun appel modèle', r.status === 401 && CALLS.mistral.length === nm);

// Vision
r = await call({ task: 'vision', user: 'Analyse ce fichier', attachment: { media_type: 'image/jpeg', data: 'QUJD' } }, { ip: '5.5.5.5' });
check('vision sans session → 401', r.status === 401);
const before = CALLS.mistral.length;
r = await call({ task: 'vision', user: 'Analyse ce fichier', attachment: { media_type: 'image/jpeg', data: 'QUJD' } }, { auth: 'good' });
const vb = CALLS.mistral.at(-1);
check('vision : image envoyée chez Mistral en data URL', r.status === 200 && CALLS.mistral.length === before + 1 && Array.isArray(vb.messages.at(-1).content) && vb.messages.at(-1).content[1].image_url === 'data:image/jpeg;base64,QUJD');
const n0 = CALLS.mistral.length;
r = await call({ task: 'vision', user: 'Analyse ce fichier', attachment: { media_type: 'application/pdf', data: 'JVBERi0x' } }, { auth: 'good' });
d = await r.json();
check('vision PDF : réponse honnête, aucun appel modèle', r.status === 200 && /PDF/.test(d.text) && CALLS.mistral.length === n0);
check('imageFromAttachment : préfixe data: nettoyé', M.imageFromAttachment({ media_type: 'image/png', data: 'data:image/png;base64,AAA' }).image === 'data:image/png;base64,AAA');

// Cascade de modèles conservée
mistralMode = 'tier';
r = await call({ task: 'write_fr', user: 'Rédige la réponse' }, { auth: 'good' });
d = await r.json();
check('cascade : modèle refusé par l’abonnement → suivant', r.status === 200 && d.model_id === 'ministral-14b-2512');

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
