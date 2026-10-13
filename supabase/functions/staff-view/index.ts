// staff-view — la vue équipe (equipe.html) : arrivées, départs, composition des
// groupes, heure d'arrivée, couchages, repas et consigne, pour Saïd, Bouchra ou
// la cuisinière. Sans compte : chaque personne a un lien personnel.
//
// POST { k } → { name, lang, today, stays }
//   k = jeton du lien (jamais stocké : seule son empreinte sha-256 est en base,
//       table staff_links). Un lien retiré (deleted_at) ne répond plus.
//
// Données minimales, en lecture seule : prénom + initiale, dates, nombre de
// personnes, et trois champs écrits POUR l'équipe dans l'Espace
// (details.arrival_time, details.beds, details.staff_note) + les repas.
// Jamais : prix, versements, notes du propriétaire, téléphone, email,
// nationalité, code de réservation. Les demandes (leads) n'apparaissent pas.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
const WINDOW_DAYS = 30;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

// ── Calcul (pur, testé par tests/evals-staff.mjs) ─────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
export type StaffStay = {
  name: string; a: string; d: string; nights: number;
  adults: number | null; children: number | null; infants: number | null; pax: number | null;
  arrival_time: string; beds: string; meals: string; note: string; same_day: boolean;
};
// Même liste que l'Espace (espace.html, FIRM_OUT) : l'équipe voit les séjours que voit le propriétaire.
const FIRM_OUT = ["inquiry", "lead", "quoted", "declined", "cancelled", "canceled"];

export function validToken(k: unknown): k is string {
  return typeof k === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(k);
}
export async function sha256hex(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** « Felipe Villalobos » → « Felipe V. » ; un seul mot → tel quel. */
export function shortName(n: unknown): string {
  const p = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return p.length > 1 ? p[0] + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : p[0];
}
const day = (iso: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
};
const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown): number | null => (v == null || v === "" || !isFinite(+v) || +v < 0 ? null : Math.round(+v));

export function staffView(rows: Row[], todayIso: string): StaffStay[] {
  const t = day(todayIso);
  if (t == null) return [];
  const firm = (rows || []).filter((c) => !FIRM_OUT.includes(String(c.booking_status || "").toLowerCase()))
    .map((c) => ({ c, a: day(c.arrival), d: day(c.departure) }))
    .filter((x) => x.a != null && x.d != null && (x.d as number) > (x.a as number)) as { c: Row; a: number; d: number }[];
  const departures = new Set(firm.map((x) => x.d));
  return firm
    .filter((x) => x.d >= t && x.a <= t + WINDOW_DAYS)
    .sort((x, y) => x.a - y.a)
    .map(({ c, a, d }) => {
      const det = c.details && typeof c.details === "object" ? c.details : {};
      const adults = int(c.adults), children = int(c.children), infants = int(c.infants);
      const pax = adults != null || children != null ? (adults || 0) + (children || 0) : int(c.guests);
      return {
        name: shortName(c.name), a: iso(a), d: iso(d), nights: d - a,
        adults, children, infants, pax: pax || null,
        arrival_time: txt(det.arrival_time, 120), beds: txt(det.beds, 300),
        meals: txt(c.meals, 600), note: txt(det.staff_note, 600),
        same_day: departures.has(a),
      };
    });
}

// ── Service ───────────────────────────────────────────────────────────────
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error("db " + r.status);
  return r.status === 204 ? null : await r.json();
}

Deno.serve(async (req: Request) => {
  const ch = cors(req);
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  if (!validToken(body.k)) return out({ error: "invalid_link" }, 404);
  try {
    const h = await sha256hex(body.k);
    const link = ((await db(`staff_links?select=id,owner_id,name,lang,last_seen_at&token_hash=eq.${h}&deleted_at=is.null&limit=1`)) || [])[0];
    if (!link) return out({ error: "invalid_link" }, 404);
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
    const t = day(todayIso) as number;
    const rows = await db(`crm_clients?select=name,arrival,departure,guests,adults,children,infants,booking_status,meals,details` +
      `&user_id=eq.${link.owner_id}&deleted_at=is.null&departure=gte.${iso(t - 1)}&arrival=lte.${iso(t + WINDOW_DAYS)}&order=arrival.asc&limit=200`) || [];
    if (!link.last_seen_at || Date.now() - Date.parse(link.last_seen_at) > 30 * 60000) {
      await db(`staff_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_seen_at: new Date().toISOString() }) }).catch(() => {});
    }
    return out({ name: link.name, lang: link.lang, today: todayIso, stays: staffView(rows, todayIso), at: new Date().toISOString() });
  } catch (_e) {
    return out({ error: "unavailable" }, 503);
  }
});
