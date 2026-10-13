// Dictée (supabase/functions/transcribe) — UE et compte obligatoire.
//   node tests/evals-transcribe.mjs   (nécessite esbuild : PUSH_TEST_MODULES=… comme evals-push)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/transcribe/index.ts'), 'utf8');
const code = src.replace(/^\s*\/\/.*$/gm, '');
check('aucun fournisseur hors UE (Groq, OpenAI)', !/groq|openai|GROQ_API_KEY/i.test(code));
check('transcription Mistral (Voxtral)', /api\.mistral\.ai\/v1\/audio\/transcriptions/.test(code) && /voxtral-mini-latest/.test(code));
check('modèle choisi par le serveur, pas par le client', !/form\.get\("model"\)/.test(code));

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'ANON', MISTRAL_API_KEY: 'mk' };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { globalThis.__h = h; } };
const SENT = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://sb.test/auth/v1/user') return (init.headers.Authorization === 'Bearer good') ? new Response('{"id":"owner-1"}', { status: 200 }) : new Response('{}', { status: 401 });
  if (url === 'https://api.mistral.ai/v1/audio/transcriptions') { SENT.push(init.body); return new Response('{"text":" Felipe arrive à 15 h "}', { status: 200 }); }
  throw new Error('inattendu ' + url);
};
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const h = globalThis.__h;
const form = (lang) => { const f = new FormData(); f.append('file', new File([new Uint8Array([1, 2, 3])], 'audio.webm', { type: 'audio/webm' })); f.append('model', 'whisper-large-v3-turbo'); if (lang) f.append('language', lang); return f; };
const call = (o) => h(new Request('https://x/transcribe', { method: 'POST', headers: { origin: o.origin || 'https://stafflo.app', ...(o.auth ? { authorization: 'Bearer ' + o.auth } : {}) }, body: form(o.lang) }));

let r = await call({});
check('sans compte → 401', r.status === 401 && SENT.length === 0);
r = await call({ auth: 'ANON' });
check('clé anon publique → 401', r.status === 401 && SENT.length === 0);
r = await call({ auth: 'good', origin: 'https://evil.example' });
check('origine inconnue → 403', r.status === 403);
r = await call({ auth: 'good', lang: 'fr-FR' });
const d = await r.json();
check('connecté : texte transcrit, espaces retirés', r.status === 200 && d.text === 'Felipe arrive à 15 h');
check('modèle voxtral imposé, langue « fr »', SENT.at(-1).get('model') === 'voxtral-mini-latest' && SENT.at(-1).get('language') === 'fr');
check('langue illisible → détection automatique', M.langCode('n\'importe') === '' && M.langCode('en') === 'en' && M.langCode('ar_MA') === 'ar');
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
