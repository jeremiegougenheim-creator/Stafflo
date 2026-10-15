// Fiches voyageurs côté propriétaire (supabase/functions/guest-registrations) : lecture en clair pour
// SON propriétaire seulement, effacement un an après le départ.
//   PUSH_TEST_MODULES=… node tests/evals-guest-registrations.mjs   (esbuild, comme evals-livret-view)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); } };
const load = async (rel) => { const js = esbuild.transformSync(fs.readFileSync(path.join(root, rel), 'utf8'), { loader: 'ts', format: 'esm' }).code; return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64')); };

const KEY = Buffer.alloc(32, 9).toString('base64');
const USERS = { 'tok-o1': 'o1', 'tok-o2': 'o2' };
const ROWS = [], CALLS = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK', SUPABASE_ANON_KEY: 'ANON' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  url = decodeURIComponent(String(url)); CALLS.push({ url, method: init.method || 'GET' });
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.endsWith('/auth/v1/user')) { const t = String((init.headers || {}).Authorization || '').replace(/^Bearer\s+/, ''); return USERS[t] ? ok({ id: USERS[t] }) : new Response('{}', { status: 401 }); }
  if (url.includes('/rpc/gmail_sync_key_ok')) return ok(JSON.parse(init.body).k === 'SYNC');
  if (url.includes('/rpc/guest_reg_key')) return ok(KEY);
  if (url.includes('/rest/v1/crm_clients')) return ok([{ name: 'Ana Ruiz', arrival: '2026-10-20', departure: '2026-10-24' }]);
  if (url.includes('/rest/v1/guest_registrations')) {
    if (init.method === 'PATCH') {
      const lt = url.match(/purge_after=lt\.([^&]+)/)[1], body = JSON.parse(init.body);
      const hit = ROWS.filter((r) => r.purge_after < lt && !r.purged_at); hit.forEach((r) => Object.assign(r, body));
      return ok(hit.map((r) => ({ id: r.id })));
    }
    const o = url.match(/owner_id=eq\.([^&]+)/)[1], c = url.match(/client_id=eq\.([^&]+)/)[1];
    return ok(ROWS.filter((r) => r.owner_id === o && r.client_id === c && !r.deleted_at && !r.purged_at));
  }
  throw new Error('inattendu ' + url);
};

const LV = await load('supabase/functions/livret-view/index.ts');
const GR = await load('supabase/functions/guest-registrations/index.ts');
const h = globalThis.__h;
const call = (body, headers = {}) => h(new Request('https://x/guest-registrations', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

const TR = [{ last: 'Ruiz', first: 'Ana', birth_date: '1990-04-02', nationality: 'Espagnole', doc_type: 'passport', doc_no: 'PAE123456' }];
ROWS.push({ id: 'r1', owner_id: 'o1', client_id: 's1', enc: await LV.sealWith(KEY, { v: 1, travellers: TR }), travellers: 1, submitted_at: '2026-10-15T10:00:00Z', purge_after: '2027-10-24', purged_at: null, deleted_at: null });
ROWS.push({ id: 'r2', owner_id: 'o1', client_id: 's-old', enc: await LV.sealWith(KEY, { v: 1, travellers: TR }), travellers: 1, submitted_at: '2025-01-01T10:00:00Z', purge_after: '2025-06-01', purged_at: null, deleted_at: null });

// 1. Chiffrement : le format de livret-view s'ouvre ici ; une autre clé ou un octet changé → échec.
check('chiffré par livret-view, ouvert ici (même format v1)', (await GR.openWith(KEY, ROWS[0].enc)).travellers[0].doc_no === 'PAE123456');
let bad = 0;
try { await GR.openWith(Buffer.alloc(32, 1).toString('base64'), ROWS[0].enc); } catch { bad++; }
try { const s = ROWS[0].enc; await GR.openWith(KEY, s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA')); } catch { bad++; }
check('mauvaise clé ou texte modifié → refus (AES-GCM authentifié)', bad === 2);
check('deux chiffrements du même contenu diffèrent (iv aléatoire)', (await LV.sealWith(KEY, { a: 1 })) !== (await LV.sealWith(KEY, { a: 1 })));

// 2. Lecture : le propriétaire seulement.
let r = await call({ action: 'get', client_id: 's1' }, { authorization: 'Bearer tok-o1' }); let b = await r.json();
check('propriétaire → ses fiches en clair, date d’effacement, séjour', r.status === 200 && b.reg && b.reg.travellers[0].doc_no === 'PAE123456' && b.reg.purge_after === '2027-10-24' && b.reg.stay.name === 'Ana Ruiz', b);
check('réponse jamais mise en cache', r.headers.get('cache-control') === 'no-store');
r = await call({ action: 'get', client_id: 's1' }, { authorization: 'Bearer tok-o2' }); b = await r.json();
check('autre compte → rien (la requête est filtrée sur SON owner_id)', r.status === 200 && b.reg === null && CALLS.some((c) => /guest_registrations\?.*owner_id=eq\.o2&client_id=eq\.s1/.test(c.url)));
check('sans session → 401 ; jeton inconnu → 401', (await call({ action: 'get', client_id: 's1' })).status === 401 && (await call({ action: 'get', client_id: 's1' }, { authorization: 'Bearer nope' })).status === 401);
check('identifiant de séjour mal formé → 400', (await call({ action: 'get', client_id: "s1'&owner_id=eq.o2" }, { authorization: 'Bearer tok-o1' })).status === 400);

// 3. Effacement : clé de synchro exigée, seulement les fiches dont la date est passée, la ligne reste.
check('purge sans clé de synchro → 401, rien d’effacé', (await call({ action: 'purge' })).status === 401 && !ROWS[1].purged_at);
r = await call({ action: 'purge' }, { 'x-sync-key': 'SYNC' }); b = await r.json();
check('purge → seulement les fiches dont la date (départ + 1 an) est passée : contenu effacé, ligne gardée', b.purged === 1 && ROWS[1].enc === null && !!ROWS[1].purged_at && ROWS[0].enc && ROWS.length === 2, b);
r = await call({ action: 'get', client_id: 's-old' }, { authorization: 'Bearer tok-o1' }); b = await r.json();
check('fiches effacées → plus rien à lire', b.reg === null);
const src = fs.readFileSync(path.join(root, 'supabase/functions/guest-registrations/index.ts'), 'utf8');
check('jamais de DELETE ; la clé n’est lue que côté serveur (rpc guest_reg_key)', !/"DELETE"/.test(src) && /rpc\/guest_reg_key/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
