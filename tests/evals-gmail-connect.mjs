// Relier Gmail depuis l'Espace : supabase/functions/gmail-connect.
// Session obligatoire, pages de retour déjà déclarées seulement, lecture de Gmail accordée,
// jeton de rafraîchissement exigé, écrit sur la ligne du BON compte, jamais renvoyé au navigateur.
//   PUSH_TEST_MODULES=… node tests/evals-gmail-connect.mjs   (esbuild)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODS = process.env.PUSH_TEST_MODULES || '/tmp/';
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [MODS, '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); } };

const USERS = { 'Bearer jwt-o1': 'o1', 'Bearer jwt-o2': 'o2' };
const VILLAS = { o1: { owner_id: 'o1', email_connection: null } }; // o2 n'a pas de ligne
const GOOGLE = [];
let grant = {}; // code → réponse de Google
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK', SUPABASE_ANON_KEY: 'ANON', GOOGLE_CLIENT_SECRET: 'GSECRET' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.endsWith('/auth/v1/user')) { const u = USERS[init.headers.Authorization]; return u ? ok({ id: u }) : ok({}, 401); }
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(init.body); GOOGLE.push({ kind: 'token', p: Object.fromEntries(p) });
    const g = grant[p.get('code')]; delete grant[p.get('code')];
    return g ? ok(g) : ok({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) { GOOGLE.push({ kind: 'userinfo', auth: init.headers.Authorization }); return ok({ email: 'villa.test@example.com' }); }
  if (url.startsWith('https://sb.test/rest/v1/villa_settings')) {
    const o = (url.match(/owner_id=eq\.(\w+)/) || [])[1];
    if (init.method === 'PATCH') { const v = VILLAS[o]; if (!v) return ok([]); Object.assign(v, JSON.parse(init.body)); return ok([{ owner_id: o }]); }
  }
  throw new Error('inattendu ' + url);
};
const src = fs.readFileSync(path.join(root, 'supabase/functions/gmail-connect/index.ts'), 'utf8');
await import('data:text/javascript;base64,' + Buffer.from(esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code).toString('base64'));
const h = globalThis.__h;
const RU = 'https://stafflo.app/app.html?oauth_callback=1';
const call = (body, { auth = 'Bearer jwt-o1', origin = 'https://stafflo.app' } = {}) => h(new Request('https://x/gmail-connect', { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
const READ = 'https://www.googleapis.com/auth/gmail.readonly';

let r = await call({ code: 'c1', redirect_uri: RU }, { auth: null });
check('sans session → 401, rien demandé à Google', r.status === 401 && GOOGLE.length === 0);
r = await call({ code: 'c1', redirect_uri: RU }, { auth: 'Bearer ANON' });
check('la clé publique n’est pas un utilisateur → 401', r.status === 401 && GOOGLE.length === 0);
r = await call({ code: 'c1', redirect_uri: RU }, { origin: 'https://evil.example' });
check('autre site → 403, rien demandé à Google', r.status === 403 && GOOGLE.length === 0);
r = await call({ code: 'c1', redirect_uri: 'https://evil.example/app.html?oauth_callback=1' });
check('page de retour inconnue → 400, rien demandé à Google', r.status === 400 && GOOGLE.length === 0);

grant = { c1: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3599, scope: 'openid ' + READ + ' https://www.googleapis.com/auth/userinfo.email' } };
r = await call({ code: 'c1', redirect_uri: RU });
let j = await r.json();
const t1 = GOOGLE.find((g) => g.kind === 'token');
check('flux normal : code échangé avec le secret et la MÊME page de retour ; réponse { ok, email } seulement', r.status === 200 && j.ok === true && j.email === 'villa.test@example.com' && Object.keys(j).sort().join() === 'email,ok' && t1.p.client_secret === 'GSECRET' && t1.p.redirect_uri === RU && t1.p.grant_type === 'authorization_code', j);
check('aucun jeton Google dans la réponse au navigateur', !/AT1|RT1/.test(JSON.stringify(j)));
const ec = VILLAS.o1.email_connection || {};
check('villa_settings.email_connection du compte : Google, adresse, jeton de rafraîchissement, date (lue par gmail-sync)', ec.provider === 'Google' && ec.email === 'villa.test@example.com' && ec.refresh_token === 'RT1' && ec.access_token === 'AT1' && ec.expires_at > Date.now() && /^\d{4}-\d\d-\d\dT/.test(ec.connected_at) && ec.source === 'espace' && ec.scope.includes(READ), ec);

// Le même code rejoué → refus de Google, rien écrit
const before = JSON.stringify(VILLAS.o1);
r = await call({ code: 'c1', redirect_uri: RU });
check('code déjà utilisé → 502 « google_refused », rien écrit', r.status === 502 && (await r.json()).error === 'google_refused' && JSON.stringify(VILLAS.o1) === before);
// Case « lire vos emails » décochée dans la fenêtre Google
grant = { c2: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3599, scope: 'openid https://www.googleapis.com/auth/userinfo.email' } };
r = await call({ code: 'c2', redirect_uri: RU });
check('lecture de Gmail non accordée → 400 « scope_missing », rien écrit', r.status === 400 && (await r.json()).error === 'scope_missing' && JSON.stringify(VILLAS.o1) === before);
// Pas de jeton de rafraîchissement → la synchro serveur ne pourrait pas tourner
grant = { c3: { access_token: 'AT3', expires_in: 3599, scope: READ } };
r = await call({ code: 'c3', redirect_uri: RU });
check('pas de jeton de rafraîchissement → 502 « no_refresh_token », rien écrit', r.status === 502 && (await r.json()).error === 'no_refresh_token' && JSON.stringify(VILLAS.o1) === before);
// Un compte sans ligne villa_settings : rien créé
grant = { c4: { access_token: 'AT4', refresh_token: 'RT4', expires_in: 3599, scope: READ } };
r = await call({ code: 'c4', redirect_uri: RU }, { auth: 'Bearer jwt-o2' });
check('compte sans villa → 404, aucune ligne créée, rien écrit chez un autre', r.status === 404 && !VILLAS.o2 && JSON.stringify(VILLAS.o1) === before);
r = await call({ code: 'c5', redirect_uri: 'https://jeremiegougenheim-creator.github.io/Stafflo/?oauth_callback=1' });
check('ancienne page de retour (github.io) acceptée', r.status === 502); // code inconnu de Google, mais la page est admise
check('lecture seule : aucun envoi, aucune suppression dans le code', !/gmail\.send|gmail\.modify|"DELETE"|\/messages\/send/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
