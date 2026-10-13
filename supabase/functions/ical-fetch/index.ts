// ical-fetch — lit un calendrier iCal (Airbnb, Booking, VRBO…) côté serveur.
//
// Pourquoi : le navigateur ne peut pas lire ces calendriers directement (CORS).
// L'app passait par des proxys publics (allorigins, corsproxy.io, cors-anywhere) :
// le lien iCal, qui contient un jeton privé donnant accès au calendrier, partait
// chez des tiers inconnus. Ici, il ne sort que vers la plateforme elle-même.
//
// POST { url } + JWT utilisateur → texte iCal. Pas un proxy ouvert : utilisateur
// connecté obligatoire, https uniquement, liste fermée de plateformes, 2 Mo max.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];
const HOSTS = /(^|\.)(airbnb\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})|booking\.com|vrbo\.com|abritel\.fr|homeaway\.(?:com|[a-z]{2}|co\.uk|com\.au)|bookabach\.co\.nz|hostfully\.com|lodgify\.com|hospitable\.com|smartbnb\.io|google\.com|calendar\.google\.com|icloud\.com|outlook\.(live|office365)\.com|beds24\.com|guesty\.com|smoobu\.com|tokeet\.com|ownerrez\.com|hostaway\.com)$/i;
const MAX = 2 * 1024 * 1024;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

/** Lien accepté ? Exportée pour les tests. */
export function allowed(raw: string): URL | null {
  let s = String(raw || "").trim();
  if (s.startsWith("webcal://")) s = "https://" + s.slice(9);
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!HOSTS.test(u.hostname)) return null;
  return u;
}

Deno.serve(async (req: Request) => {
  const ch = cors(req);
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  const a = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(a)) return out({ error: "unauthorized" }, 401);
  const who = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: a } });
  if (!who.ok) return out({ error: "unauthorized" }, 401);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const u = allowed(body.url);
  if (!u) return out({ error: "url_not_allowed" }, 400);
  try {
    const r = await fetch(u.href, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "Stafflo-iCal/1.0" } });
    if (!r.ok) return out({ error: "upstream_" + r.status }, 502);
    const finalHost = new URL(r.url || u.href).hostname;
    if (!HOSTS.test(finalHost)) return out({ error: "redirect_not_allowed" }, 502);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX) return out({ error: "too_large" }, 502);
    const text = new TextDecoder("utf-8").decode(buf);
    if (text.indexOf("BEGIN:VCALENDAR") === -1) return out({ error: "not_ical" }, 502);
    return new Response(text, { status: 200, headers: { ...ch, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return out({ error: "fetch_failed", detail: String(e).slice(0, 120) }, 502);
  }
});
