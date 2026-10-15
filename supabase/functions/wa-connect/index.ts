// wa-connect — relier le WhatsApp Business de la villa à Stafflo (coexistence, 16/10/2026).
//
// L'Espace (Maison › Réglages › « Relier WhatsApp Business ») ouvre l'inscription intégrée de Meta
// (Embedded Signup) ; le propriétaire scanne un QR code depuis l'app WhatsApp Business de son
// téléphone. Meta rend un code (valable 30 secondes) et les identifiants du compte (waba_id,
// phone_number_id). Ici, avec la session du propriétaire :
//   1. code → jeton d'intégration (jamais gardé : il ne sert qu'aux trois appels suivants) ;
//   2. numéro affiché ; l'app Stafflo abonnée aux notifications du compte WhatsApp (subscribed_apps) ;
//   3. synchronisation demandée tout de suite (contacts, puis historique — Meta laisse 24 h, une fois) ;
//   4. wa_numbers : le numéro rattaché à CE compte Stafflo (un numéro n'appartient qu'à un compte).
// Les messages arrivent ensuite par wa-webhook. Stafflo n'envoie rien.
// POST { code, waba_id, phone_number_id? }  (JWT du propriétaire)
//   200 { ok, display_phone } · 401 · 409 numéro déjà relié à un autre compte · 502 refus de Meta.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
const APP_ID = Deno.env.get("WA_APP_ID") || "";
const APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const GV = Deno.env.get("WA_GRAPH_VERSION") || "v25.0";
const G = "https://graph.facebook.com/" + GV;
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + path.split("?")[0] + ": " + txt.slice(0, 160));
  return txt ? JSON.parse(txt) : null;
}
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
async function userFrom(req: Request): Promise<string | null> {
  const a = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(a)) return null;
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: a } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id || null;
}
const okId = (s: unknown) => /^[0-9]{5,25}$/.test(String(s || ""));
/** Appel Graph avec le jeton d'intégration ; une erreur de Meta remonte avec son message. */
async function graph(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(G + path, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error("meta " + (j?.error?.code || r.status) + ": " + String(j?.error?.message || "").slice(0, 160));
  return j;
}

Deno.serve(async (req: Request) => {
  const ch = cors(req);
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!APP_ID || !APP_SECRET) return out({ error: "not_configured" }, 503);
  const owner = await userFrom(req);
  if (!owner) return out({ error: "unauthorized" }, 401);
  let b: Row = {};
  try { b = await req.json(); } catch { return out({ error: "bad_request" }, 400); }
  const code = String(b.code || "");
  if (!code || code.length > 2000 || !okId(b.waba_id) || (b.phone_number_id && !okId(b.phone_number_id))) return out({ error: "bad_request" }, 400);
  try {
    // 1. Code → jeton (une fois, 30 s).
    const tk = await fetch(`${G}/oauth/access_token?client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}&code=${encodeURIComponent(code)}`).then((r) => r.json()).catch(() => ({}));
    const token = String(tk?.access_token || "");
    if (!token) return out({ error: "meta_refused", detail: String(tk?.error?.message || "code").slice(0, 160) }, 502);
    // 2. Le numéro (celui du flux, sinon le premier du compte), son affichage.
    let pid = String(b.phone_number_id || "");
    if (!pid) { const l = await graph(`/${b.waba_id}/phone_numbers?fields=id,display_phone_number`, token); pid = String(l?.data?.[0]?.id || ""); }
    if (!okId(pid)) return out({ error: "no_number" }, 502);
    const info = await graph(`/${pid}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`, token);
    // Un numéro n'appartient qu'à un compte Stafflo.
    const taken: Row[] = await db(`wa_numbers?select=owner_id&phone_number_id=eq.${pid}&deleted_at=is.null`) || [];
    if (taken.some((x) => String(x.owner_id) !== owner)) return out({ error: "number_taken" }, 409);
    // 3. Notifications du compte vers l'app Stafflo, puis synchronisation (contacts, historique).
    await graph(`/${b.waba_id}/subscribed_apps`, token, { method: "POST", body: "{}" });
    const sync: Row = {};
    for (const t of ["smb_app_state_sync", "history"]) {
      try { const r = await graph(`/${pid}/smb_app_data`, token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type: t }) }); sync[t] = r?.request_id || true; }
      catch (e) { sync[t] = "error: " + String(e).slice(0, 120); }
    }
    console.log("[wa-connect]", owner, pid, JSON.stringify(sync));
    // 4. Le numéro sur CE compte (l'ancienne ligne du même compte est remplacée).
    if (taken.length) await db(`wa_numbers?phone_number_id=eq.${pid}&owner_id=eq.${owner}&deleted_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
    await db("wa_numbers", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      owner_id: owner, phone_number_id: pid, waba_id: String(b.waba_id), display_phone: String(info?.display_phone_number || "").slice(0, 40),
      history_status: "pending" }) }); // l'historique (ou son refus) arrive ensuite par wa-webhook
    return out({ ok: true, display_phone: info?.display_phone_number || "", on_biz_app: info?.is_on_biz_app === true, history_requested: !String(sync.history || "").startsWith("error") });
  } catch (e) {
    console.error("[wa-connect]", String(e).slice(0, 200));
    return out({ error: "meta_refused", detail: String(e).slice(0, 160) }, 502);
  }
});
