// Web Push sans dépendance : chiffrement aes128gcm (RFC 8291 / RFC 8188) et
// signature VAPID (RFC 8292), uniquement avec WebCrypto (Deno, Node ≥ 20,
// navigateurs). Testé contre la bibliothèque de référence http_ece
// (tests/evals-push.mjs).

const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

/** Paire de clés VAPID (P-256). Publique : 65 octets bruts en base64url. Privée : JWK. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u(raw), privateJwk: jwk };
}

/** En-tête Authorization VAPID pour un point de terminaison donné. */
export async function vapidAuth(endpoint: string, publicKey: string, privateJwk: JsonWebKey, subject: string, ttlSec = 12 * 3600): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + payload));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${publicKey}`;
}

/** Chiffre un message pour un abonnement (p256dh, auth en base64url). Corps aes128gcm prêt à envoyer. */
export async function encryptPayload(p256dh: string, auth: string, data: Uint8Array, salt?: Uint8Array, asKeys?: CryptoKeyPair): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const as = asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(s, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(data, new Uint8Array([2])); // délimiteur du dernier enregistrement
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(s, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
export type PushResult = { ok: boolean; status: number; gone: boolean; text?: string };

/** Envoie une notification. gone = abonnement expiré (404/410), à désactiver. */
export async function sendPush(sub: Sub, message: unknown, vapid: { publicKey: string; privateJwk: JsonWebKey; subject: string }, ttl = 86400): Promise<PushResult> {
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(message)));
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body,
  });
  const text = r.ok ? undefined : (await r.text()).slice(0, 200);
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, text };
}
