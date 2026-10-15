// WhatsApp Business (coexistence) → Stafflo : supabase/functions/wa-webhook.
// Signature Meta obligatoire, numéro inconnu ignoré, messages du client / de l'hôte / historique rangés
// sur le BON compte, rien téléchargé (médias : type et légende seulement), purge du texte à 13 mois.
//   PUSH_TEST_MODULES=… node tests/evals-wa-webhook.mjs   (esbuild)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODS = process.env.PUSH_TEST_MODULES || '/tmp/';
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [MODS, '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); } };

const SECRET = 'app-secret-test', VERIFY = 'verify-test', SYNC = 's'.repeat(40);
const NUMS = [{ owner_id: 'o1', phone_number_id: '111', display_phone: '+212 600 000 001' }, { owner_id: 'o2', phone_number_id: '222', display_phone: '+33 6 00 00 00 02' }];
const ROWS = [], PATCHES = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK', WA_APP_SECRET: SECRET, WA_VERIFY_TOKEN: VERIFY })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  url = decodeURIComponent(String(url));
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.includes('/rpc/gmail_sync_key_ok')) return ok(JSON.parse(init.body).k === SYNC);
  if (url.includes('/rest/v1/wa_numbers') && (!init.method || init.method === 'GET')) { const ids = (url.match(/in\.\(([^)]*)\)/) || [])[1] || ''; return ok(NUMS.filter((n) => ids.includes('"' + n.phone_number_id + '"'))); }
  if (url.includes('/rest/v1/wa_numbers') && init.method === 'PATCH') { PATCHES.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
  if (url.includes('/rest/v1/wa_messages') && init.method === 'POST') {
    if (!/on_conflict=wamid/.test(url) || !/ignore-duplicates/.test(String(init.headers.Prefer))) throw new Error('doublons non protégés');
    for (const r of JSON.parse(init.body)) if (!ROWS.some((x) => x.wamid === r.wamid)) ROWS.push(r);
    return new Response(null, { status: 201 });
  }
  if (url.includes('/rest/v1/wa_messages') && init.method === 'PATCH') { PATCHES.push({ url, body: JSON.parse(init.body) }); return ok([{ id: 'x' }, { id: 'y' }]); }
  throw new Error('inattendu ' + url);
};
const src = fs.readFileSync(path.join(root, 'supabase/functions/wa-webhook/index.ts'), 'utf8');
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const h = globalThis.__h;
const sig = (raw, s = SECRET) => 'sha256=' + crypto.createHmac('sha256', s).update(raw).digest('hex');
const post = (obj, { signature, raw } = {}) => { const body = raw ?? JSON.stringify(obj); return h(new Request('https://x/wa-webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature === null ? {} : { 'x-hub-signature-256': signature || sig(body) }) }, body })); };
const wrap = (pid, field, value) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: NUMS.find((n) => n.phone_number_id === pid)?.display_phone.replace(/\D/g, '') || '1', phone_number_id: pid }, ...value } }] }] });
const T = Math.floor(Date.UTC(2026, 9, 13, 14, 5) / 1000);

// 1. Vérification Meta
let r = await h(new Request('https://x/wa-webhook?hub.mode=subscribe&hub.verify_token=' + VERIFY + '&hub.challenge=12345'));
const r2 = await h(new Request('https://x/wa-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345'));
check('vérification Meta : bon jeton → renvoie hub.challenge ; mauvais → 403', r.status === 200 && (await r.text()) === '12345' && r2.status === 403);

// 2. Signature
const live = wrap('111', 'messages', { contacts: [{ profile: { name: 'Felipe' }, wa_id: '447700900123' }], messages: [{ from: '447700900123', id: 'wamid.A1', timestamp: String(T), type: 'text', text: { body: 'Ah perfect thank you, hoping to arrive in about 1hr15' } }] });
check('sans signature, mauvaise signature, ou signée avec un autre secret → 401, rien rangé', (await post(live, { signature: null })).status === 401 && (await post(live, { signature: 'sha256=00' })).status === 401 && (await post(live, { signature: sig(JSON.stringify(live), 'autre') })).status === 401 && ROWS.length === 0);

// 3. Message du client
r = await post(live);
let row = ROWS[0];
check('message du client → wa_messages du compte du numéro (o1), « in », nom de profil, chiffres seulement, heure du message', r.status === 200 && row && row.owner_id === 'o1' && row.phone_number_id === '111' && row.direction === 'in' && row.source === 'live' && row.guest_wa === '447700900123' && row.guest_name === 'Felipe' && row.body.startsWith('Ah perfect') && row.sent_at === '2026-10-13T14:05:00.000Z', row);
await post(live);
check('même message reçu deux fois → une ligne (wamid unique)', ROWS.length === 1);
r = await post(wrap('999', 'messages', { messages: [{ from: '33600000000', id: 'wamid.X', timestamp: String(T), type: 'text', text: { body: 'x' } }] }));
check('numéro inconnu (pas relié) → 200, rien rangé', r.status === 200 && ROWS.length === 1);

// 4. Ce que l'hôte envoie depuis l'app (écho)
await post(wrap('111', 'smb_message_echoes', { message_echoes: [{ from: '212600000001', to: '447700900123', id: 'wamid.E1', timestamp: String(T + 60), type: 'text', text: { body: 'Our driver is waiting at the airport' } }] }));
row = ROWS.find((x) => x.wamid === 'wamid.E1');
check('écho (envoyé depuis l’app WhatsApp Business) → « out », rattaché au client (to)', !!row && row.direction === 'out' && row.source === 'echo' && row.guest_wa === '447700900123');

// 5. Médias : jamais téléchargés ; légende gardée ; réaction ignorée
await post(wrap('111', 'messages', { messages: [
  { from: '447700900123', id: 'wamid.M1', timestamp: String(T), type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'passport Regina' } },
  { from: '447700900123', id: 'wamid.M2', timestamp: String(T), type: 'image', image: { id: 'MEDIA2', mime_type: 'image/jpeg' } },
  { from: '447700900123', id: 'wamid.M3', timestamp: String(T), type: 'document', document: { id: 'MEDIA3', filename: 'flights.pdf' } },
  { from: '447700900123', id: 'wamid.M4', timestamp: String(T), type: 'reaction', reaction: { message_id: 'wamid.E1', emoji: '👍' } }] }));
const m1 = ROWS.find((x) => x.wamid === 'wamid.M1'), m2 = ROWS.find((x) => x.wamid === 'wamid.M2'), m3 = ROWS.find((x) => x.wamid === 'wamid.M3');
check('photo : type + légende, sans légende → texte vide ; document → nom du fichier ; réaction ignorée ; aucun identifiant de média gardé', m1 && m1.type === 'image' && m1.body === 'passport Regina' && m2 && m2.body === null && m3 && m3.body === 'flights.pdf' && !ROWS.some((x) => x.wamid === 'wamid.M4') && !JSON.stringify(ROWS).includes('MEDIA'));
check('aucun téléchargement, aucun envoi, aucune suppression dans le code', !/graph\.facebook\.com|\/media\b|"DELETE"/.test(src));

// 6. Historique (connexion) : messages du client et de l'hôte, progression, refus
const n0 = ROWS.length;
await post(wrap('222', 'history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: '34600111222', messages: [
  { from: '34600111222', id: 'wamid.H1', timestamp: String(T - 86400 * 30), type: 'text', text: { body: 'We are 6 people including 2 kids' }, history_context: { status: 'READ' } },
  { from: '33600000002', to: '34600111222', id: 'wamid.H2', timestamp: String(T - 86400 * 30 + 60), type: 'text', text: { body: 'Noted!' }, history_context: { status: 'READ' } }] }] }] }));
const h1 = ROWS.find((x) => x.wamid === 'wamid.H1'), h2 = ROWS.find((x) => x.wamid === 'wamid.H2');
check('historique : rangé sur l’autre compte (o2), client « in », hôte « out », même conversation', ROWS.length === n0 + 2 && h1.owner_id === 'o2' && h1.direction === 'in' && h1.source === 'history' && h2.direction === 'out' && h2.guest_wa === '34600111222', { h1, h2 });
check('historique : progression notée sur le numéro (55 % → en cours)', PATCHES.some((p) => /wa_numbers\?phone_number_id=eq\.222/.test(p.url) && p.body.history_status === 'syncing' && p.body.history_progress === 55));
await post(wrap('222', 'history', { history: [{ metadata: { phase: 2, chunk_order: 9, progress: 100 }, threads: [] }] }));
await post(wrap('111', 'history', { history: [{ errors: [{ code: 2593109, title: 'History sharing is turned off' }] }] }));
check('historique terminé → « done » ; partage refusé dans l’app → « declined »', PATCHES.some((p) => /eq\.222/.test(p.url) && p.body.history_status === 'done' && p.body.history_progress === 100) && PATCHES.some((p) => /eq\.111/.test(p.url) && p.body.history_status === 'declined'));
await post(wrap('111', 'account_update', { event: 'PARTNER_REMOVED' }));
check('déconnexion par le propriétaire (PARTNER_REMOVED) → « disconnected »', PATCHES.some((p) => /eq\.111/.test(p.url) && p.body.history_status === 'disconnected'));

// 7. Purge mensuelle
const pr = await h(new Request('https://x/wa-webhook', { method: 'POST', headers: { 'x-sync-key': SYNC }, body: '{}' }));
const pp = PATCHES.filter((p) => /wa_messages\?sent_at=lt\./.test(p.url)).pop();
const bad = await h(new Request('https://x/wa-webhook', { method: 'POST', headers: { 'x-sync-key': 'x'.repeat(40) }, body: '{}' }));
check('purge (cron, clé de synchro) : texte effacé après 13 mois (body null, purged_at) ; mauvaise clé → 401', pr.status === 200 && !!pp && pp.body.body === null && !!pp.body.purged_at && Math.abs(Date.parse(decodeURIComponent(pp.url.match(/lt\.([^&]+)/)[1])) - (Date.now() - 395 * 86400000)) < 60000 && bad.status === 401);
check('chiffres : 00 initial retiré, « + » et espaces ignorés', M.digits('+44 7700 900123') === '447700900123' && M.digits('0044 7700900123') === '447700900123');

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
