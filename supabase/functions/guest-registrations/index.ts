// guest-registrations — les fiches voyageurs d'un séjour, en clair, pour SON propriétaire seulement.
//
// Les fiches sont remplies par le client depuis son lien personnel (livret-view), chiffrées
// AES-256-GCM avec la clé de Vault (guest_reg_key) et rangées dans guest_registrations. Personne
// d'autre ne lit la colonne chiffrée (ni le lien, ni l'équipe, ni la clé anon).
//
// POST { action: "get", client_id } + JWT du propriétaire → { travellers, at, purge_after, stay }
//   (null si aucune fiche, ou fiches déjà effacées). Le séjour doit être à lui.
// POST { action: "purge" } + en-tête x-sync-key (cron quotidien) → efface les fiches dont la date
//   d'effacement (départ + 1 an) est passée : enc = null, purged_at = maintenant. La ligne reste
//   (suppression douce), le contenu disparaît.
// verify_jwt : off — l'utilisateur est vérifié ici (GET /auth/v1/user), la purge par la clé de synchro.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
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
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-sync-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
/** Inverse de sealWith (livret-view) : « v1: » + base64(iv 12 octets + texte chiffré AES-GCM). */
export async function openWith(keyB64: string, sealed: string): Promise<Row> {
  if (!/^v1:/.test(String(sealed || ""))) throw new Error("format");
  const all = fromB64(sealed.slice(3));
  const key = await crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
export const validClientId = (v: unknown) => /^[A-Za-z0-9_.:-]{1,80}$/.test(String(v || ""));

async function userFrom(req: Request): Promise<string | null> {
  const a = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(a)) return null;
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: a } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id || null;
}

Deno.serve(async (req: Request) => {
  const ch = cors(req);
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === "purge") {
      const key = req.headers.get("x-sync-key") || "";
      const ok = key && await fetch(SB_URL + "/rest/v1/rpc/gmail_sync_key_ok", { method: "POST", headers: H, body: JSON.stringify({ k: key }) }).then((r) => r.json()).catch(() => false);
      if (ok !== true) return out({ error: "unauthorized" }, 401);
      const today = new Date().toISOString().slice(0, 10);
      const gone: Row[] = await db(`guest_registrations?purge_after=lt.${today}&purged_at=is.null&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ enc: null, purged_at: new Date().toISOString() }) }) || [];
      return out({ ok: true, purged: gone.length });
    }
    if (body.action === "get") {
      const uid = await userFrom(req);
      if (!uid) return out({ error: "unauthorized" }, 401);
      if (!validClientId(body.client_id)) return out({ error: "bad_request" }, 400);
      const cid = encodeURIComponent(String(body.client_id));
      const rows: Row[] = await db(`guest_registrations?select=enc,travellers,submitted_at,purge_after&owner_id=eq.${uid}&client_id=eq.${cid}&deleted_at=is.null&purged_at=is.null&limit=1`) || [];
      if (!rows.length || !rows[0].enc) return out({ reg: null });
      const stay: Row = ((await db(`crm_clients?select=name,arrival,departure&id=eq.${cid}&user_id=eq.${uid}&limit=1`)) || [])[0] || null;
      const k = await db("rpc/guest_reg_key", { method: "POST", body: "{}" });
      const data = await openWith(String(k), rows[0].enc);
      return out({ reg: { travellers: Array.isArray(data.travellers) ? data.travellers : [], at: rows[0].submitted_at, purge_after: rows[0].purge_after, stay } });
    }
    return out({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[guest-registrations]", String(e).slice(0, 200));
    return out({ error: "unavailable" }, 503);
  }
});
