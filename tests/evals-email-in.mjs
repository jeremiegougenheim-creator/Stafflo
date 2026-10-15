// Entrée sans Gmail (supabase/functions/email-in + workers/email-in) : un email Airbnb transféré à
// in-<jeton>@stafflo.app arrive dans email_inbox du BON compte ; rien d'autre n'est gardé.
//   PUSH_TEST_MODULES=… node tests/evals-email-in.mjs   (esbuild ; postal-mime pour le Worker si présent)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODS = process.env.PUSH_TEST_MODULES || '/tmp/';
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [MODS, '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); } };

const KEY = 'k'.repeat(64);
const ADDR = { '7f3k9q2m1a2b': 'o1', 'aaaaaaaaaa11': 'o2' };
const INBOX = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  url = decodeURIComponent(String(url));
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.includes('/rpc/inbound_key_ok')) return ok(JSON.parse(init.body).k === KEY);
  if (url.includes('/rest/v1/inbound_addresses')) { const t = url.match(/token=eq\.([^&]+)/)[1]; return ok(ADDR[t] ? [{ owner_id: ADDR[t] }] : []); }
  if (url.includes('/rest/v1/villa_settings')) return ok([{ villa_key: 'villa_' + url.match(/owner_id=eq\.([^&]+)/)[1] }]);
  if (url.includes('/rest/v1/email_inbox')) {
    const ct = Object.entries(init.headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
    if (!ct || !/application\/json/.test(ct[1])) return new Response('{"code":"PGRST102"}', { status: 400 });
    const row = JSON.parse(init.body);
    if (!/on_conflict=gmail_id/.test(url) || !/ignore-duplicates/.test(String((init.headers || {}).Prefer))) throw new Error('doublons non protégés');
    if (!INBOX.some((r) => r.gmail_id === row.gmail_id)) INBOX.push(row);
    return new Response(null, { status: 201 });
  }
  throw new Error('inattendu ' + url);
};
const js = esbuild.transformSync(fs.readFileSync(path.join(root, 'supabase/functions/email-in/index.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const h = globalThis.__h;
const send = (body, key = KEY) => h(new Request('https://x/email-in', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-inbound-key': key } : {}) }, body: JSON.stringify(body) }));
const AIR = { to: 'in-7f3k9q2m1a2b@stafflo.app', from: 'automated@airbnb.com', from_name: 'Airbnb', subject: 'Réservation confirmée - Ana Ruiz arrive le 20 nov.', text: '', html: '<p>Nouvelle réservation confirmée !</p><p>Code de confirmation<br>HMTEST0451</p><script>x()</script>', message_id: '<abc@airbnb.com>', date: 'Thu, 15 Oct 2026 10:00:00 +0000', fwd: 'owner@example.com in-7f3k9q2m1a2b@stafflo.app' };

// 1. Adresse et expéditeurs
check('adresse : seulement in-<jeton>@stafflo.app (aussi « Nom <adresse> »), jeton en minuscules', M.tokenOf('in-7f3k9q2m1a2b@stafflo.app') === '7f3k9q2m1a2b' && M.tokenOf('Stafflo <IN-7F3K9Q2M1A2B@stafflo.app>') === '7f3k9q2m1a2b' && M.tokenOf('hello@stafflo.app') === '' && M.tokenOf('in-7f3k9q2m1a2b@evil.com') === '' && M.tokenOf('in-short@stafflo.app') === '');
check('expéditeurs gardés : Airbnb (tous domaines airbnb.*) et la confirmation de transfert Gmail ; jamais « airbnb.com.evil.io »', M.isAirbnb('automated@airbnb.com') && M.isAirbnb('express@airbnb.fr') && M.isAirbnb('x@email.airbnb.com') && !M.isAirbnb('x@airbnb.com.evil.io') && !M.isAirbnb('x@airbnb.com.ev.io') && !M.isAirbnb('x@notairbnb.com') && !M.isAirbnb('airbnb@mail-example.com') && M.isGmailConfirm('forwarding-noreply@google.com') && !M.isGmailConfirm('x@google.com'));
check('HTML → texte lisible (balises, scripts et entités retirés, lignes gardées)', M.textOf('', '<p>Code de confirmation<br>HM1&nbsp;&amp; co</p><script>evil()</script>') === 'Code de confirmation\nHM1 & co');

// 2. Fonction
check('sans clé ou mauvaise clé → 401, rien d’écrit', (await send(AIR, '')).status === 401 && (await send(AIR, 'x'.repeat(64))).status === 401 && INBOX.length === 0);
check('adresse inconnue → 404 (le Worker refuse le message)', (await send({ ...AIR, to: 'in-zzzzzzzzzz99@stafflo.app' })).status === 404 && (await send({ ...AIR, to: 'hello@stafflo.app' })).status === 404);
let r = await send(AIR);
const row = INBOX[0];
check('email Airbnb → email_inbox du compte du jeton, source « email_in », texte lisible, en attente du parseur', r.status === 200 && row && row.owner_id === 'o1' && row.user_id === 'o1' && row.villa_key === 'villa_o1' && row.source === 'email_in' && row.from_email === 'automated@airbnb.com' && /HMTEST0451/.test(row.body) && !/script|evil|<p>/.test(row.body) && !row.extracted.airbnb && row.received_at === '2026-10-15T10:00:00.000Z', row);
await send(AIR);
check('même message reçu deux fois → une seule ligne (identifiant tiré du Message-ID)', INBOX.length === 1 && /^in:[0-9a-f]{32}$/.test(row.gmail_id));
r = await send({ ...AIR, from: 'promo@shop.com', message_id: '<p@shop>' });
check('autre expéditeur → 202 ignoré, rien gardé', r.status === 202 && INBOX.length === 1);
r = await send({ to: 'in-aaaaaaaaaa11@stafflo.app', from: 'forwarding-noreply@google.com', subject: '(#123456789) Confirmation de transfert Gmail', text: 'Code de confirmation : 123456789', message_id: '<g@google>' });
check('confirmation de transfert Gmail → gardée sur l’AUTRE compte (o2), pour afficher le code dans son Espace', r.status === 200 && INBOX[1].owner_id === 'o2' && /123456789/.test(INBOX[1].body));
check('une adresse ne remplit jamais un autre compte', INBOX.filter((x) => x.owner_id === 'o1').length === 1 && INBOX.filter((x) => x.owner_id === 'o2').length === 1);
const src = fs.readFileSync(path.join(root, 'supabase/functions/email-in/index.ts'), 'utf8');
check('jamais de DELETE ni de PATCH ; l’email est seulement rangé (le parseur serveur fait le reste)', !/"DELETE"|"PATCH"/.test(src) && !/crm_clients/.test(src));

// 3. Worker Cloudflare : refuse les adresses inconnues, transmet le message analysé, ne garde aucun secret dans le code.
const wsrc = fs.readFileSync(path.join(root, 'workers/email-in/src/index.js'), 'utf8');
check('Worker : clé lue dans env.INBOUND_KEY (jamais en dur), URL de la fonction en variable', /env\.INBOUND_KEY/.test(wsrc) && !/[0-9a-f]{40,}/.test(wsrc) && /EMAIL_IN_URL = "https:\/\/rcjhgilpmojohmrqzokx\.supabase\.co\/functions\/v1\/email-in"/.test(fs.readFileSync(path.join(root, 'workers/email-in/wrangler.toml'), 'utf8')));
const pmDir = [MODS, '/tmp/'].map((d) => path.join(d, 'node_modules/postal-mime')).find((d) => fs.existsSync(d));
if (pmDir) {
  const bundle = await esbuild.build({ entryPoints: [path.join(root, 'workers/email-in/src/index.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.dirname(pmDir)], platform: 'neutral', mainFields: ['module', 'main'] });
  const W = (await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;
  const raw = 'From: Airbnb <automated@airbnb.com>\r\nTo: owner@example.com\r\nSubject: =?UTF-8?Q?R=C3=A9servation_confirm=C3=A9e?=\r\nMessage-ID: <m1@airbnb.com>\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\nX-Forwarded-For: owner@example.com in-7f3k9q2m1a2b@stafflo.app\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCode de confirmation HMTEST0452\r\n';
  const mk = (to) => ({ to, from: 'bounce@example.net', rawSize: raw.length, raw: new Response(raw).body, headers: new Headers({ 'x-forwarded-for': 'owner@example.com' }), rejected: null, setReject(m) { this.rejected = m; } });
  const posts = []; const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posts.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}', { status: /zzzz/.test(init.body) ? 404 : 200 }); };
  const env = { EMAIL_IN_URL: 'https://sb.test/functions/v1/email-in', INBOUND_KEY: KEY };
  const m1 = mk('In-7f3k9q2m1a2b@stafflo.app'); await W.email(m1, env);
  const p = posts[0];
  check('Worker : message transmis (en-tête x-inbound-key), sujet décodé, texte, Message-ID, expéditeur d’origine', !m1.rejected && p && p.init.headers['x-inbound-key'] === KEY && p.body.to === 'in-7f3k9q2m1a2b@stafflo.app' && p.body.from === 'automated@airbnb.com' && p.body.subject === 'Réservation confirmée' && /HMTEST0452/.test(p.body.text) && p.body.message_id === '<m1@airbnb.com>', p && p.body);
  const m2 = mk('hello@stafflo.app'); await W.email(m2, env);
  check('Worker : autre adresse du domaine → refusée sans appel', m2.rejected === 'Unknown address' && posts.length === 1);
  const m3 = mk('in-zzzzzzzzzz99@stafflo.app'); await W.email(m3, env);
  check('Worker : adresse inconnue en base (404) → message refusé', m3.rejected === 'Unknown address');
  globalThis.fetch = prevFetch;
} else console.log('note : postal-mime absent (npm i postal-mime dans ' + MODS + ') — Worker vérifié en lecture seulement');

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
