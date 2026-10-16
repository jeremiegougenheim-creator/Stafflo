// gmail-connect — relier la boîte Gmail de la villa depuis l'Espace (16/10/2026).
//
// L'Espace (Maison › Réglages › « Relier Gmail », ou la mise en route) ouvre la fenêtre de
// consentement Google (lecture seule : gmail.readonly). Google renvoie un code sur la page de
// retour déjà déclarée (app.html?oauth_callback=1, qui le passe à l'Espace). Ici, avec la session
// du propriétaire :
//   1. code → jetons Google (secret client côté serveur) ;
//   2. le droit de LIRE Gmail doit avoir été accordé (case de la fenêtre Google), et un jeton de
//      rafraîchissement doit exister (sinon la synchro serveur ne pourrait pas tourner) ;
//   3. adresse Gmail (userinfo) ;
//   4. villa_settings.email_connection de CE compte (owner_id) — lu ensuite par gmail-sync toutes les
//      10 minutes. Les jetons ne repartent JAMAIS vers le navigateur : réponse { ok, email }.
// Différence avec gmail-token-exchange (app.html, gardée telle quelle) : celle-ci renvoie les jetons
// au navigateur, qui les écrit lui-même ; gmail-connect les écrit en base et ne les montre pas.
// POST { code, redirect_uri }  (JWT du propriétaire)
//   200 { ok, email } · 400 bad_request | scope_missing · 401 · 403 · 404 no_villa · 429 · 502 google_refused | no_refresh_token

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
const SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CLIENT_ID = "657823663741-b34rdmlb08obva72vcibt34mp49iqlom.apps.googleusercontent.com"; // le même que l'app (public)
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];
// Pages de retour acceptées : celles que l'app utilise déjà (déclarées chez Google).
const REDIRECT = /^https:\/\/((www\.)?stafflo\.app\/app\.html|jeremiegougenheim-creator\.github\.io\/Stafflo\/(app\.html)?)\?oauth_callback=1$/;
const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
async function userFrom(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (!m || m[1] === ANON) return null; // la clé publique n'est pas un utilisateur
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + m[1] } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id ? String(u.id) : null;
}
const hits = new Map<string, number[]>();
function overLimit(key: string, max: number): boolean {
  const now = Date.now(), recent = (hits.get(key) || []).filter((t) => now - t < 3_600_000);
  if (hits.size > 5000) hits.clear();
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent); return false;
}

Deno.serve(async (req: Request) => {
  const ch = cors(req);
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!ORIGINS.includes(req.headers.get("origin") || "")) return out({ error: "forbidden_origin" }, 403);
  if (!SECRET || !SRK) return out({ error: "not_configured" }, 503);
  const owner = await userFrom(req);
  if (!owner) return out({ error: "unauthorized" }, 401);
  if (overLimit(owner, 10)) return out({ error: "rate_limited" }, 429);
  let b: Row = {};
  try { b = await req.json(); } catch { return out({ error: "bad_request" }, 400); }
  const code = String(b.code || ""), redirect = String(b.redirect_uri || "");
  if (!code || code.length > 2000 || !REDIRECT.test(redirect)) return out({ error: "bad_request" }, 400);

  // 1. Code → jetons (une seule fois).
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, code, redirect_uri: redirect, grant_type: "authorization_code" }).toString(),
  });
  const tok: Row = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) return out({ error: "google_refused", detail: String(tok.error_description || tok.error || tr.status).slice(0, 160) }, 502);
  // 2. Lecture de Gmail accordée ? Jeton de rafraîchissement présent ?
  const scope = String(tok.scope || "");
  if (!scope.split(/\s+/).includes(GMAIL_READ)) return out({ error: "scope_missing" }, 400);
  if (!tok.refresh_token) return out({ error: "no_refresh_token" }, 502);
  // 3. L'adresse.
  const ui: Row = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + tok.access_token } }).then((r) => r.json()).catch(() => ({}));
  const email = String(ui.email || "").slice(0, 200);
  // 4. Sur la ligne du compte, rien d'autre.
  const conn = {
    provider: "Google", email, access_token: String(tok.access_token), refresh_token: String(tok.refresh_token),
    expires_at: Date.now() + (parseInt(String(tok.expires_in || 3600), 10) * 1000), connected_at: new Date().toISOString(),
    scope, source: "espace",
  };
  const w = await fetch(SB_URL + "/rest/v1/villa_settings?owner_id=eq." + owner + "&select=owner_id", {
    method: "PATCH",
    headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ email_connection: conn, updated_at: new Date().toISOString() }),
  });
  const rows = await w.json().catch(() => null);
  if (!w.ok) { console.error("[gmail-connect] db", w.status); return out({ error: "db" }, 500); }
  if (!Array.isArray(rows) || !rows.length) return out({ error: "no_villa" }, 404);
  console.log("[gmail-connect]", owner, email ? "ok" : "ok (adresse inconnue)");
  return out({ ok: true, email });
});
