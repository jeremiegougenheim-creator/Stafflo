// livret-view — la fiche maison d'une villa, pour le livret d'UN séjour (lien personnel).
//
// Pourquoi : la fiche (wifi, téléphones de l'équipe, adresse, QR WhatsApp) était un fichier
// public du site (villa-facts.js), lisible par n'importe qui. Elle vit maintenant en base
// (villa_settings.house_facts, propriétaire seulement) ; le livret la demande ici.
//
// GET ?t=<jeton>  → { facts }  si le jeton existe (livret_links, non retiré) et que le séjour
//   n'est pas terminé depuis plus de 7 jours. Le jeton est aléatoire (32 octets), créé par
//   l'app ou l'Espace du propriétaire, un par séjour.
// GET ?guest=…&dates=…  (liens envoyés AVANT le passage au lien personnel, sans jeton) →
//   seulement si le livret de ce séjour a été envoyé avant LEGACY_BEFORE, séjour pas encore
//   terminé (départ ≥ hier), nom ET dates exacts, et un seul séjour correspond. S'éteint de
//   lui-même avec le dernier de ces séjours.
// Rien d'autre n'est renvoyé (ni nom, ni prix, ni séjour). Limite par adresse IP.
// verify_jwt : off (le client n'a pas de compte) — l'accès, c'est le jeton.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const LEGACY_BEFORE = "2026-10-14T00:00:00Z";
export const GRACE_DAYS = 7;

const H = { apikey: SRK, Authorization: "Bearer " + SRK };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
async function db(path: string): Promise<Row[]> {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { headers: H });
  if (!r.ok) throw new Error("db " + r.status);
  return await r.json();
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "apikey, content-type" };
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Copie de fmtStayDates (app.html / espace.html) : c'est ce texte que portent les anciens liens.
const MONTHS_FR = ["JAN", "FEV", "MAR", "AVR", "MAI", "JUN", "JUL", "AOU", "SEP", "OCT", "NOV", "DEC"];
export function fmtStayDates(arrival: string, departure: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}/;
  if (!arrival || !departure || !iso.test(arrival) || !iso.test(departure)) return "";
  const a = new Date(arrival.slice(0, 10) + "T12:00:00Z");
  const d = new Date(departure.slice(0, 10) + "T12:00:00Z");
  if (isNaN(+a) || isNaN(+d)) return "";
  const yy = String(d.getUTCFullYear()).slice(-2);
  return a.getUTCDate() + " " + MONTHS_FR[a.getUTCMonth()] + " – " + d.getUTCDate() + " " + MONTHS_FR[d.getUTCMonth()] + " " + yy;
}
export const validToken = (t: unknown) => /^[A-Za-z0-9_-]{32,64}$/.test(String(t || ""));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Ancien lien : un seul séjour, livret envoyé avant la bascule, nom et dates exacts, pas terminé.
export function legacyMatch(rows: Row[], guest: string, dates: string, todayIso: string): Row | null {
  const g = String(guest || "").trim(), dt = String(dates || "").trim();
  if (!g || !dt) return null;
  const yesterday = day(Date.parse(todayIso + "T12:00:00Z") - 86400000);
  const hits = (rows || []).filter((c) =>
    !c.deleted_at && String(c.name || "").trim() === g && String(c.departure || "").slice(0, 10) >= yesterday &&
    c.details && c.details.livretSentAt && String(c.details.livretSentAt) < LEGACY_BEFORE &&
    fmtStayDates(String(c.arrival || ""), String(c.departure || "")) === dt);
  return hits.length === 1 ? hits[0] : null;
}

const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now); hits.set(key, recent);
  return recent.length > max;
}

async function factsOf(owner: string): Promise<Row | null> {
  const v = await db(`villa_settings?select=house_facts&owner_id=eq.${owner}&limit=1`);
  const f = v[0] && v[0].house_facts;
  return f && typeof f === "object" && f.VILLA ? f : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return out({ error: "method_not_allowed" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const q = new URL(req.url).searchParams;
  const today = day(Date.now());
  try {
    const t = q.get("t");
    if (t) {
      if (!validToken(t)) return out({ error: "not_found" }, 404);
      if (limited("t:" + ip, 120, 10 * 60_000)) return out({ error: "rate_limited" }, 429);
      const l = await db(`livret_links?select=owner_id,client_id&token=eq.${t}&deleted_at=is.null&limit=1`);
      if (!l.length) return out({ error: "not_found" }, 404);
      const s = await db(`crm_clients?select=departure,deleted_at&id=eq.${encodeURIComponent(l[0].client_id)}&user_id=eq.${l[0].owner_id}&limit=1`);
      const graceEnd = day(Date.parse(today + "T12:00:00Z") - GRACE_DAYS * 86400000);
      if (!s.length || s[0].deleted_at || String(s[0].departure || "").slice(0, 10) < graceEnd) return out({ error: "expired" }, 410);
      const f = await factsOf(l[0].owner_id);
      return f ? out({ facts: f }) : out({ error: "not_found" }, 404);
    }
    const guest = q.get("guest") || "", dates = q.get("dates") || "";
    if (!guest || !dates) return out({ error: "not_found" }, 404);
    if (limited("g:" + ip, 20, 60 * 60_000)) return out({ error: "rate_limited" }, 429);
    const yesterday = day(Date.parse(today + "T12:00:00Z") - 86400000);
    const rows = await db(`crm_clients?select=user_id,name,arrival,departure,details,deleted_at&name=eq.${encodeURIComponent(guest.trim())}&deleted_at=is.null&departure=gte.${yesterday}&limit=5`);
    const c = legacyMatch(rows, guest, dates, today);
    if (!c) return out({ error: "not_found" }, 404);
    const f = await factsOf(String(c.user_id));
    return f ? out({ facts: f, legacy: true }) : out({ error: "not_found" }, 404);
  } catch (e) {
    console.error("[livret-view]", String(e).slice(0, 200));
    return out({ error: "unavailable" }, 503);
  }
});
