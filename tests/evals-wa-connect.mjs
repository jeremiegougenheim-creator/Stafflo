// Relier WhatsApp Business (coexistence) : supabase/functions/wa-connect.
// Session obligatoire, code échangé une fois et jamais gardé, abonnement + synchronisation demandés,
// numéro rattaché au BON compte, jamais à deux comptes.
//   PUSH_TEST_MODULES=… node tests/evals-wa-connect.mjs   (esbuild)
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

const WABA = '5550001', PID = '106540352242922';
const USERS = { 'Bearer jwt-o1': 'o1', 'Bearer jwt-o2': 'o2' };
const NUMS = [], GRAPH = [];
let codes = {};
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK', SUPABASE_ANON_KEY: 'ANON', WA_APP_ID: 'APPID', WA_APP_SECRET: 'APPSECRET' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.endsWith('/auth/v1/user')) { const u = USERS[init.headers.Authorization]; return u ? ok({ id: u }) : ok({}, 401); }
  if (url.startsWith('https://graph.facebook.com/')) {
    GRAPH.push({ url, method: init.method || 'GET', auth: init.headers && init.headers.Authorization, body: init.body });
    if (url.includes('/oauth/access_token')) { const c = new URL(url).searchParams.get('code'); const t = codes[c]; delete codes[c]; return t ? ok({ access_token: t }) : ok({ error: { message: 'This authorization code has been used' } }, 400); }
    if (url.includes('/' + WABA + '/phone_numbers')) return ok({ data: [{ id: PID, display_phone_number: '+212 600-000111' }] });
    if (url.includes('/' + PID + '?fields=')) return ok({ display_phone_number: '+212 600-000111', is_on_biz_app: true, platform_type: 'CLOUD_API' });
    if (/\/subscribed_apps$/.test(url)) return ok({ success: true });
    if (/\/smb_app_data$/.test(url)) return ok({ request_id: 'req-' + JSON.parse(init.body).sync_type });
    return ok({ error: { message: 'unexpected' } }, 400);
  }
  if (url.includes('/rest/v1/wa_numbers')) {
    if (!init.method || init.method === 'GET') { const pid = (url.match(/phone_number_id=eq\.(\d+)/) || [])[1]; return ok(NUMS.filter((n) => n.phone_number_id === pid && !n.deleted_at)); }
    if (init.method === 'POST') { NUMS.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    if (init.method === 'PATCH') { const o = (url.match(/owner_id=eq\.(\w+)/) || [])[1]; NUMS.filter((n) => n.owner_id === o && !n.deleted_at).forEach((n) => Object.assign(n, JSON.parse(init.body))); return new Response(null, { status: 204 }); }
  }
  throw new Error('inattendu ' + url);
};
const src = fs.readFileSync(path.join(root, 'supabase/functions/wa-connect/index.ts'), 'utf8');
await import('data:text/javascript;base64,' + Buffer.from(esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code).toString('base64'));
const h = globalThis.__h;
const call = (body, auth = 'Bearer jwt-o1') => h(new Request('https://x/wa-connect', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://stafflo.app', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));

let r = await call({ code: 'c1', waba_id: WABA }, null);
check('sans session → 401, rien demandé à Meta', r.status === 401 && GRAPH.length === 0);
r = await call({ code: 'c1', waba_id: '55; drop' });
check('identifiant de compte invalide → 400, rien demandé à Meta', r.status === 400 && GRAPH.length === 0);

codes = { c1: 'TOKEN1' };
r = await call({ code: 'c1', waba_id: WABA });
let j = await r.json();
const tok = GRAPH.find((g) => g.url.includes('/oauth/access_token')), sub = GRAPH.find((g) => /subscribed_apps$/.test(g.url)), syn = GRAPH.filter((g) => /smb_app_data$/.test(g.url));
check('flux normal : code échangé (id + secret de l’app), numéro trouvé sur le compte, numéro affiché renvoyé', r.status === 200 && j.ok && j.display_phone === '+212 600-000111' && j.on_biz_app === true && /client_id=APPID/.test(tok.url) && /client_secret=APPSECRET/.test(tok.url) && /code=c1/.test(tok.url), j);
check('Stafflo abonné aux notifications du compte (subscribed_apps), avec le jeton d’intégration', !!sub && sub.method === 'POST' && sub.auth === 'Bearer TOKEN1' && sub.url.includes('/' + WABA + '/'));
check('synchronisation demandée tout de suite : contacts PUIS historique (Meta : 24 h, une seule fois)', syn.length === 2 && JSON.parse(syn[0].body).sync_type === 'smb_app_state_sync' && JSON.parse(syn[1].body).sync_type === 'history' && syn.every((g) => g.url.includes('/' + PID + '/') && JSON.parse(g.body).messaging_product === 'whatsapp') && j.history_requested === true);
const row = NUMS[0];
check('wa_numbers : le numéro sur CE compte, historique « en attente » ; le jeton n’est gardé nulle part', NUMS.length === 1 && row.owner_id === 'o1' && row.phone_number_id === PID && row.waba_id === WABA && row.history_status === 'pending' && !JSON.stringify(NUMS).includes('TOKEN1'), NUMS);
check('versions : Graph API v25.0', GRAPH.every((g) => g.url.startsWith('https://graph.facebook.com/v25.0/')));

// Le même code rejoué → refus de Meta, rien écrit
r = await call({ code: 'c1', waba_id: WABA });
check('code déjà utilisé → 502 « meta_refused », rien écrit', r.status === 502 && (await r.json()).error === 'meta_refused' && NUMS.length === 1);
// Un autre compte Stafflo ne peut pas prendre ce numéro
codes = { c2: 'TOKEN2' }; GRAPH.length = 0;
r = await call({ code: 'c2', waba_id: WABA, phone_number_id: PID }, 'Bearer jwt-o2');
check('numéro déjà relié à un autre compte → 409, ni abonnement ni synchronisation', r.status === 409 && !GRAPH.some((g) => /subscribed_apps|smb_app_data/.test(g.url)) && NUMS.filter((n) => !n.deleted_at).length === 1 && NUMS[0].owner_id === 'o1');
// Le même compte se reconnecte : l'ancienne ligne est remplacée
codes = { c3: 'TOKEN3' };
r = await call({ code: 'c3', waba_id: WABA, phone_number_id: PID });
check('même compte qui se reconnecte → l’ancienne ligne est retirée (suppression douce), une seule active', r.status === 200 && NUMS.length === 2 && !!NUMS[0].deleted_at && !NUMS[1].deleted_at);
check('aucun envoi de message, aucune suppression dans le code', !/\/messages\b|"DELETE"/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
