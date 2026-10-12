// Web Push (supabase/functions/push-notify/webpush.ts) — chiffrement et VAPID
// vérifiés contre les bibliothèques de référence (http_ece, web-push).
//   node tests/evals-push.mjs   (nécessite esbuild ; http_ece et web-push si présents)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const ALT = [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/'];
const esbuild = tryReq('esbuild', ALT);
const ece = tryReq('http_ece', ALT);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : String(detail)); } };

const src = fs.readFileSync(path.join(root, 'supabase/functions/push-notify/webpush.ts'), 'utf8');
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// Abonnement simulé (ce que fait le navigateur)
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const p256dh = mod.b64u(ua.getPublicKey());
const auth = mod.b64u(authSecret);
const msg = { title: 'Nouvelle demande', body: 'Daniel · 13–16 oct · 9 adultes', url: '/espace.html' };

const body = await mod.encryptPayload(p256dh, auth, new TextEncoder().encode(JSON.stringify(msg)));
check('en-tête aes128gcm : sel 16 + rs 4096 + clé 65', body.length > 86 && body[20] === 65 && body[16] === 0 && body[18] === 0x10, body.length);

if (ece) {
  const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret });
  check('déchiffré par http_ece (référence RFC 8188/8291)', out.toString() === JSON.stringify(msg), out.toString());
} else {
  check('http_ece disponible pour la vérification croisée', false, 'npm i http_ece dans ' + ALT[0]);
}

// Deux envois → sels et clés éphémères différents
const body2 = await mod.encryptPayload(p256dh, auth, new TextEncoder().encode('x'));
check('sel aléatoire à chaque envoi', Buffer.compare(Buffer.from(body.slice(0, 16)), Buffer.from(body2.slice(0, 16))) !== 0);

// VAPID : JWT ES256 vérifiable avec la clé publique annoncée
const keys = await mod.generateVapidKeys();
check('clé publique VAPID : 65 octets non compressés', mod.unb64u(keys.publicKey).length === 65 && mod.unb64u(keys.publicKey)[0] === 4);
const authz = await mod.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys.publicKey, keys.privateJwk, 'mailto:test@example.com');
const m = authz.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
check('en-tête Authorization « vapid t=…, k=… »', !!m && m[4] === keys.publicKey, authz.slice(0, 60));
const payload = JSON.parse(Buffer.from(m[2], 'base64url').toString());
check('aud = origine du service push', payload.aud === 'https://fcm.googleapis.com', payload.aud);
check('exp ≤ 24 h', payload.exp - Date.now() / 1000 <= 86400 && payload.exp > Date.now() / 1000);
const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.privateJwk.x, y: keys.privateJwk.y }, format: 'jwk' });
const okSig = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
check('signature ES256 valide', okSig);

// ── Textes des alertes (push-notify/index.ts → buildAlert) ─────────────────
const idx = fs.readFileSync(path.join(root, 'supabase/functions/push-notify/index.ts'), 'utf8');
const seg = idx.slice(idx.indexOf('// ── Textes des alertes'), idx.indexOf('async function subsOf'));
const segJs = esbuild.transformSync(seg.replace(/^export /gm, ''), { loader: 'ts' }).code;
const A = (await import('data:text/javascript;base64,' + Buffer.from(segJs + '\nexport { buildAlert };').toString('base64'))).buildAlert;
let a = A({ type: 'inquiry', first_name: 'Daniel', checkin: '2026-10-13', checkout: '2026-10-16', adults: 9, children: 0, infants: 0, guest_message: 'Is the villa available?', thread_id: '123' }, 'fr');
check('demande : titre et délai 24 h', a && a.title === 'Nouvelle demande — Daniel' && /13 oct\. → 16 oct\. · 9 adultes · 24 h pour répondre/.test(a.body), a && a.body);
check('demande : message du client cité', a && /« Is the villa available\? »/.test(a.body));
a = A({ type: 'inquiry', first_name: 'Daniel' }, 'fr');
check('demande sans dates ni voyageurs : rien d\'inventé', a && a.body === '24 h pour répondre', a && a.body);
a = A({ type: 'message', first_name: 'Felipe', guest_message: 'Reacted 👍 to your message' }, 'fr');
check('réaction « Reacted » : pas d\'alerte', a === null);
a = A({ type: 'message', first_name: 'Felipe', guest_message: '' }, 'fr');
check('message vide : pas d\'alerte', a === null);
a = A({ type: 'confirmation', name: 'Ana Ruiz', first_name: 'Ana', checkin: '2026-10-13', checkout: '2026-10-16', adults: 5, children: 2, infants: 0, payout_eur: 1735.2 }, 'fr');
check('confirmation : net lu dans l\'email', a && a.title === 'Réservation confirmée — Ana Ruiz' && /5 adultes, 2 enfants · net 1\s?735,2 €/.test(a.body), a && a.body);
a = A({ type: 'confirmation', name: 'Ana Ruiz', checkin: '2026-10-13', checkout: '2026-10-16' }, 'en');
check('confirmation sans montant : pas de net', a && !/net/.test(a.body) && /Oct 13 → Oct 16/.test(a.body), a && a.body);
a = A({ type: 'payout', payout: { id: 'M-1', total_eur: 1549.86, expected_by: '2026-10-15', items: [{ code: 'HMY5', name: 'Helen Twelvetrees', amount_eur: 1549.86 }] } }, 'fr');
check('versement : montant et date d\'arrivée', a && /1\s?549,86 €/.test(a.title) && /Helen Twelvetrees · en banque vers le 15 oct\./.test(a.body), a && (a.title + ' | ' + a.body));
check('rappel, avis, autre : pas d\'alerte', ['reminder', 'review', 'other'].every((t) => A({ type: t, first_name: 'X' }, 'fr') === null));
check('cron : chaque email marqué notified_at (jamais deux fois)', /notified_at=is\.null/.test(idx) && /notified_at: new Date/.test(idx));
check('abonnement expiré (404/410) : désactivé en douceur', /r\.gone \? \{ deleted_at/.test(idx));
check('clé privée VAPID jamais renvoyée au navigateur', /action === "public_key"\) return out\(\{ publicKey: \(await vapid\(\)\)\.publicKey \}\)/.test(idx) && !/privateJwk[^\n]*out\(/.test(idx));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
