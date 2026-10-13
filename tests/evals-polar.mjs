// Paiement Polar (supabase/functions/polar-webhook) — garde-fous.
//   node tests/evals-polar.mjs   (nécessite esbuild : PUSH_TEST_MODULES=… comme evals-push ;
//   POLAR_TEST_MODULES=<dossier avec standardwebhooks> ajoute le contrôle de compatibilité)
//
// Un paiement doit toujours atterrir sur la ligne de l'utilisateur, une signature
// fausse ou périmée doit toujours être refusée, et une erreur d'écriture doit
// faire répondre 500 (Polar renvoie l'événement) — jamais un 202 qui perd le paiement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/polar-webhook/index.ts'), 'utf8');
check('plus de SDK Polar (subpath ./webhooks absent en 1.x → BOOT_ERROR)', !/@polar-sh\/sdk/.test(src.replace(/^\/\/.*$/gm, '')));
check('secret absent → refus explicite', /if \(!SECRET\)/.test(src));

// ── Banc d'essai : base en mémoire, serveur capturé ─────────────────────────
const ENV = { POLAR_WEBHOOK_SECRET: 'polar_whs_test_0123456789', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x' };
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const DB = { rows: [], fail: false, writes: 0 };
const USERS = [{ id: 'u-paid', email: 'Owner@Example.com' }, { id: 'u-other', email: 'other@example.com' }];
function q(table) {
  const st = { filters: [], table };
  const run = () => DB.rows.filter((r) => st.filters.every(([c, v]) => r[c] === v));
  const api = {
    select() { return api; },
    eq(c, v) { st.filters.push([c, v]); return api; },
    order() { return api; },
    limit(n) { return Promise.resolve({ data: run().slice(0, n), error: null }); },
    update(row) { st.patch = row; return { eq: (c, v) => { if (DB.fail) return Promise.resolve({ error: { message: 'boom' } }); DB.writes++; DB.rows.filter((r) => r[c] === v).forEach((r) => Object.assign(r, row)); return Promise.resolve({ error: null }); } }; },
    insert(row) {
      if (DB.fail) return Promise.resolve({ error: { message: 'boom' } });
      if (DB.rows.some((r) => r.user_email && r.user_email === row.user_email)) return Promise.resolve({ error: { message: 'duplicate user_email' } });
      if (row.polar_subscription_id && DB.rows.some((r) => r.polar_subscription_id === row.polar_subscription_id)) return Promise.resolve({ error: { message: 'duplicate sub' } });
      DB.writes++; DB.rows.push({ id: 'r' + (DB.rows.length + 1), ...row }); return Promise.resolve({ error: null });
    },
  };
  return api;
}
globalThis.__mockCreateClient = () => ({ from: q, auth: { admin: { listUsers: async ({ page }) => ({ data: { users: page === 1 ? USERS : [] }, error: null }) } } });

const patched = src.replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m, 'const createClient = globalThis.__mockCreateClient;');
check('import supabase-js remplaçable pour le test', patched !== src);
const js = esbuild.transformSync(patched, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// Signature Standard Webhooks, comme Polar : clé = octets UTF-8 du secret.
const sign = (secret, id, ts, body) => 'v1,' + crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64');
const now = Math.floor(Date.now() / 1000);
const H = (body, o = {}) => {
  const id = o.id || 'msg_1', ts = String(o.ts ?? now);
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': o.sig || sign(o.secret || ENV.POLAR_WEBHOOK_SECRET, id, ts, body) };
};

// ── Signature ────────────────────────────────────────────────────────────────
const b0 = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_1' } });
check('signature valide acceptée', await M.verifySignature(b0, H(b0), ENV.POLAR_WEBHOOK_SECRET, now));
check('mauvais secret refusé', !(await M.verifySignature(b0, H(b0, { secret: 'autre' }), ENV.POLAR_WEBHOOK_SECRET, now)));
check('corps modifié refusé', !(await M.verifySignature(b0 + ' ', H(b0), ENV.POLAR_WEBHOOK_SECRET, now)));
check('horodatage de plus de 5 min refusé (rejeu)', !(await M.verifySignature(b0, H(b0, { ts: now - 301 }), ENV.POLAR_WEBHOOK_SECRET, now)));
check('plusieurs signatures, une valide → acceptée', await M.verifySignature(b0, { ...H(b0), 'webhook-signature': 'v1,AAAA ' + H(b0)['webhook-signature'] }, ENV.POLAR_WEBHOOK_SECRET, now));
check('en-têtes absents refusés', !(await M.verifySignature(b0, {}, ENV.POLAR_WEBHOOK_SECRET, now)));
check('version de signature inconnue refusée', !(await M.verifySignature(b0, { ...H(b0), 'webhook-signature': H(b0)['webhook-signature'].replace('v1,', 'v2,') }, ENV.POLAR_WEBHOOK_SECRET, now)));
const ref = tryReq('standardwebhooks', [process.env.POLAR_TEST_MODULES || '/tmp/']);
if (ref) {
  const wh = new ref.Webhook(Buffer.from(ENV.POLAR_WEBHOOK_SECRET, 'utf8').toString('base64'));
  const d = new Date();
  const sig = wh.sign('msg_ref', d, b0);
  check('compatible avec la bibliothèque Standard Webhooks (chemin du SDK Polar)', await M.verifySignature(b0, { 'webhook-id': 'msg_ref', 'webhook-timestamp': String(Math.floor(d / 1000)), 'webhook-signature': sig }, ENV.POLAR_WEBHOOK_SECRET));
}

// ── Gestionnaire ─────────────────────────────────────────────────────────────
const call = (body, h) => handler(new Request('http://x/', { method: 'POST', body, headers: h }));
const ev = (type, data) => JSON.stringify({ type, data });

let r = await call(b0, { 'webhook-id': 'x', 'webhook-timestamp': String(now), 'webhook-signature': 'v1,faux' });
check('signature fausse → 403, rien écrit', r.status === 403 && DB.writes === 0);

// Essai existant (ensure_trial) : même email, UNIQUE user_email.
DB.rows.push({ id: 'trial', user_id: 'u-paid', user_email: 'owner@example.com', status: 'trialing', tier: 'trial', polar_subscription_id: null });
const paid = ev('subscription.active', { id: 'sub_A', status: 'active', customer_id: 'cus_1', product_id: 'prod_solo', current_period_end: '2026-11-13T00:00:00Z', customer: { email: 'owner@example.com' }, metadata: { user_id: 'u-paid' } });
r = await call(paid, H(paid));
let row = DB.rows.find((x) => x.id === 'trial');
check('paiement : la ligne d’essai devient l’abonnement (pas de doublon)', r.status === 202 && DB.rows.length === 1 && row.status === 'active' && row.polar_subscription_id === 'sub_A' && row.tier === 'solo');

const canceled = ev('subscription.canceled', { id: 'sub_A', status: 'canceled', current_period_end: '2026-11-13T00:00:00Z', cancel_at_period_end: true, metadata: { user_id: 'u-paid' } });
r = await call(canceled, H(canceled, { id: 'msg_2' }));
row = DB.rows.find((x) => x.id === 'trial');
check('résiliation : même ligne mise à jour', r.status === 202 && DB.rows.length === 1 && row.status === 'canceled' && row.cancel_at_period_end === true);
check('événement partiel : client Polar et produit conservés', row.polar_customer_id === 'cus_1' && row.product_id === 'prod_solo');

const byEmail = ev('subscription.created', { id: 'sub_B', status: 'active', customer: { email: 'OTHER@example.com' } });
r = await call(byEmail, H(byEmail, { id: 'msg_3' }));
check('sans metadata : relié par email exact (casse ignorée)', r.status === 202 && DB.rows.some((x) => x.polar_subscription_id === 'sub_B' && x.user_id === 'u-other'));

const orderPaid = ev('order.paid', { id: 'ord_1', subscription: { id: 'sub_A', status: 'active', metadata: { user_id: 'u-paid' } } });
r = await call(orderPaid, H(orderPaid, { id: 'msg_4' }));
check('order.paid : réactive le même abonnement', r.status === 202 && DB.rows.find((x) => x.id === 'trial').status === 'active');

const writes = DB.writes;
const other = ev('checkout.created', { id: 'co_1' });
r = await call(other, H(other, { id: 'msg_5' }));
check('événement sans abonnement ignoré, rien écrit', r.status === 202 && DB.writes === writes);

DB.fail = true;
const again = ev('subscription.updated', { id: 'sub_A', status: 'active', metadata: { user_id: 'u-paid' } });
r = await call(again, H(again, { id: 'msg_6' }));
check('erreur d’écriture → 500 (Polar renverra l’événement)', r.status === 500);
DB.fail = false;

ENV.POLAR_WEBHOOK_SECRET = ''; // le secret est lu au chargement : on recharge le module
await import('data:text/javascript;base64,' + Buffer.from(js + '\n// sans secret').toString('base64'));
r = await call(paid, H(paid, { secret: 'polar_whs_test_0123456789' }));
check('secret non configuré → 500, jamais accepté', r.status === 500);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
