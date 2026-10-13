import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// v16 : l'origine etait figee sur github.io ; depuis le passage a stafflo.app,
// le preflight CORS renvoyait la mauvaise valeur et l'echange OAuth Gmail
// echouait. Liste blanche des deux domaines legitimes, l'en-tete renvoie
// l'origine reelle de la requete quand elle est autorisee.
const ALLOWED_ORIGINS = [
  "https://stafflo.app",
  "https://www.stafflo.app",
  "https://jeremiegougenheim-creator.github.io",
];

// ── Accès (13/10/2026, audit SaaS) : un propriétaire connecté (jeton de session vérifié
// auprès de Supabase Auth) — la clé anon publique ne suffit plus. Avant : seul l'en-tête Origin (falsifiable hors navigateur) — n'importe qui pouvait
// faire rafraîchir un jeton Google avec le secret client de Stafflo.
const __SB_URL = Deno.env.get('SUPABASE_URL') || ''
const __SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
const __users = new Map<string, { uid: string | null; exp: number }>()
async function callerId(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')
  if (!m || !__SB_URL) return null
  const token = m[1].trim()
  if (!token || token === __SB_ANON) return null
  
  const now = Date.now(), hit = __users.get(token)
  if (hit && hit.exp > now) return hit.uid
  let uid: string | null = null
  try {
    const r = await fetch(`${__SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: __SB_ANON } })
    if (r.ok) { const u = await r.json(); uid = u?.id ? String(u.id) : null }
  } catch { uid = null }
  if (__users.size > 2000) __users.clear()
  __users.set(token, { uid, exp: now + (uid ? 300_000 : 30_000) })
  return uid
}
const __hits = new Map<string, number[]>()
function overLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  if (__hits.size > 5000) __hits.clear()
  const recent = (__hits.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) { __hits.set(key, recent); return true }
  recent.push(now); __hits.set(key, recent); return false
}

const CLIENT_ID = "657823663741-b34rdmlb08obva72vcibt34mp49iqlom.apps.googleusercontent.com";

function corsFor(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsFor(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  // Origin check — only allow requests from our known app domains
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "forbidden_origin" }, 403, origin);
  }

  const uid = await callerId(req);
  if (!uid) return json({ error: "login_required" }, 401, origin);
  if (overLimit("u:" + uid, 60 * 60_000, 60)) return json({ error: "rate_limited" }, 429, origin);

  let payload: { code?: string; redirect_uri?: string; refresh_token?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const { code, redirect_uri, refresh_token } = payload || {};

  const isRefresh = !!refresh_token;
  if (!isRefresh && (!code || !redirect_uri)) {
    return json({ error: "missing_code_or_refresh_token" }, 400, origin);
  }

  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientSecret) {
    return json({ error: "server_misconfigured", detail: "GOOGLE_CLIENT_SECRET not set" }, 500, origin);
  }

  const tokenBody = isRefresh
    ? new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        refresh_token: refresh_token!,
        grant_type: "refresh_token",
      })
    : new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        code: code!,
        redirect_uri: redirect_uri!,
        grant_type: "authorization_code",
      });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  const body = await tokenRes.text();
  return new Response(body, {
    status: tokenRes.status,
    headers: { ...corsFor(origin), "Content-Type": "application/json" },
  });
});
