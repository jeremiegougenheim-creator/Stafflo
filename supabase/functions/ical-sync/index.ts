// ical-sync — lit les calendriers iCal d'une villa côté serveur et range leurs dates en base (17/10/2026).
//
// Pourquoi : dans l'ancienne version (app.html), les liens iCal vivaient sur UN appareil (cfg.icalFeeds) et
// n'étaient lus que page ouverte. Ici, les liens sont sur le compte (villa_settings.ical_feeds, propriétaire
// seulement, RLS) et le serveur les lit toutes les heures. Le lien contient un jeton privé : il ne part que
// vers la plateforme elle-même (liste fermée, même règle qu'ical-fetch), jamais vers un proxy.
//
// Ce qui est gardé (table ical_events, lue par le propriétaire) : pour chaque événement du calendrier, ses
// dates, « réservé » ou « bloqué », le code de réservation Airbnb (HM…) s'il est écrit, le nom du calendrier.
// Jamais le texte de l'événement (Airbnb y met les 4 derniers chiffres du téléphone du voyageur).
// Depuis le 21/10/2026, une réservation lue sans séjour crée le séjour (createStays, ci-dessous) : avant, l'Espace
// la proposait seulement (« Créer le séjour ») — et le propriétaire du pilote créait tout à la main. Ce qui n'est
// pas créé (événement bloqué, interrupteur coupé) reste proposé par l'Espace. La base reste la seule vérité.
//
// POST {}  + x-sync-key (cron, clé vérifiée par gmail_sync_key_ok) → tous les comptes qui ont des calendriers.
// POST {}  + session du propriétaire (« Lire maintenant », après un ajout) → SON compte seulement (6 / heure).
// Un événement qui disparaît du calendrier (annulation) reçoit gone_at ; un calendrier retiré des réglages aussi.
// Une ligne par compte et par passage dans sync_runs (source 'ical'). Une erreur sur un calendrier n'arrête
// pas les autres. verify_jwt : off — la clé ou la session sont vérifiées ici.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];
const HOSTS = /(^|\.)(airbnb\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})|booking\.com|vrbo\.com|abritel\.fr|homeaway\.(?:com|[a-z]{2}|co\.uk|com\.au)|bookabach\.co\.nz|hostfully\.com|lodgify\.com|hospitable\.com|smartbnb\.io|google\.com|calendar\.google\.com|icloud\.com|outlook\.(live|office365)\.com|beds24\.com|guesty\.com|smoobu\.com|tokeet\.com|ownerrez\.com|hostaway\.com)$/i;
const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_FEEDS = 8;

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

/** Lien accepté ? (même règle qu'ical-fetch) */
export function allowed(raw: unknown): URL | null {
  let s = String(raw || "").trim();
  if (s.startsWith("webcal://")) s = "https://" + s.slice(9);
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!HOSTS.test(u.hostname)) return null;
  return u;
}

// ── Lecture du calendrier (pure, testée par tests/evals-ical-sync.mjs) ─────────────────────────
const unesc = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const isoOf = (v: string): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(+d) || d.getUTCDate() !== +m[3] ? null : d.toISOString().slice(0, 10);
};
const plusDay = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export type IcalEvent = { uid: string; start: string; end: string; kind: "reserved" | "blocked"; code: string | null };
/** Événements d'un calendrier : dates (fin exclusive = jour de départ), réservé / bloqué, code HM… s'il est écrit. */
export function parseIcal(text: string): IcalEvent[] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcalEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) { cur = {}; continue; }
    if (/^END:VEVENT$/i.test(line.trim())) {
      if (cur) {
        const start = isoOf(cur.DTSTART || "");
        let end = isoOf(cur.DTEND || "");
        if (start && (!end || end <= start)) end = plusDay(start, 1);
        const uid = String(cur.UID || "").trim().slice(0, 300);
        const st = String(cur.STATUS || "").toUpperCase();
        if (start && end && uid && st !== "CANCELLED") {
          const sum = unesc(cur.SUMMARY || ""), desc = unesc(cur.DESCRIPTION || "") + " " + String(cur.URL || "");
          const code = (/\b(HM[A-Z0-9]{8})\b/.exec(desc) || [])[1] || null;
          const reserved = !!code || /\b(reserved|booked|reservation|réservé|réservation)\b/i.test(sum) || /reservations?\/details|reservation url/i.test(desc);
          out.push({ uid, start, end, kind: reserved && !/not available|unavailable|blocked|indisponible/i.test(sum) ? "reserved" : "blocked", code });
        }
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).split(";")[0].toUpperCase();
    if (!(key in cur)) cur[key] = line.slice(i + 1);
  }
  return out;
}
/** Calendriers du compte, nettoyés : id, nom, lien accepté ; 8 au plus. */
export function feedsOf(raw: unknown): { id: string; label: string; url: string }[] {
  return (Array.isArray(raw) ? raw : []).map((f: Row) => ({
    id: String(f && f.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40),
    label: String(f && f.label || "").replace(/\s+/g, " ").trim().slice(0, 40),
    url: String(f && f.url || "").trim(),
  })).filter((f) => f.id && allowed(f.url)).slice(0, MAX_FEEDS);
}
/** Garde seulement ce qui sert : du séjour en cours (départ ≥ hier) à 18 mois. */
export function inWindow(e: IcalEvent, today: string): boolean {
  return e.end >= plusDay(today, -1) && e.start <= plusDay(today, 548);
}

async function fetchFeed(url: string): Promise<string> {
  const u = allowed(url);
  if (!u) throw new Error("url_not_allowed");
  const r = await fetch(u.href, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "Stafflo-iCal/1.0" } });
  if (!r.ok) throw new Error("upstream_" + r.status);
  if (!HOSTS.test(new URL(r.url || u.href).hostname)) throw new Error("redirect_not_allowed");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("too_large");
  const text = new TextDecoder("utf-8").decode(buf);
  if (text.indexOf("BEGIN:VCALENDAR") === -1) throw new Error("not_ical");
  return text;
}

// ── Séjours créés depuis les calendriers (21/10/2026) ───────────────────────────────────────────
// Une réservation lue (kind « reserved » : Airbnb « Reserved » avec son code HM…, Vrbo…), pas masquée, pas
// disparue, départ ≥ aujourd'hui, qu'aucun séjour ferme ne couvre (même code, ou dates qui se chevauchent — mêmes
// règles que l'Espace) → séjour créé : dates, source (plateforme du lien, jamais le nom donné au calendrier), code.
// Le nom est le code (sinon « <source> <arrivée> ») et le montant reste vide : tous deux marqués à compléter
// (details.pending = ['name', 'price']) — l'email de confirmation Airbnb les remplit par le code (gmail-sync), ou
// le propriétaire (Modifier). Rien n'est inventé. Jamais pour un événement « bloqué » (Booking.com exporte tout
// en « CLOSED - Not available »). Interrupteur : villa_settings.ical_auto_create (vrai par défaut ; Réglages).
export const FIRM_OUT = ["inquiry", "lead", "quoted", "declined", "cancelled", "canceled"];
export function sourceOf(url: string): string {
  let h = ""; try { h = new URL(String(url || "")).hostname; } catch { h = ""; }
  return /airbnb/i.test(h) ? "Airbnb" : /booking\.com/i.test(h) ? "Booking" : /vrbo|abritel|homeaway|bookabach/i.test(h) ? "Vrbo" : "Autre";
}
/** Réservations à créer : pas couvertes par un séjour ferme (code ou dates), une seule par plage de dates. */
export function uncovered(events: Row[], stays: Row[], today: string): Row[] {
  const firm = (stays || []).filter((s) => !FIRM_OUT.includes(String(s.booking_status || "").toLowerCase()) && s.arrival && s.departure);
  const covers = (s: Row, e: Row) => (e.code && String((s.details || {}).reservation_code || "") === e.code) || (s.arrival < e.end_date && e.start_date < s.departure);
  const out: Row[] = [];
  for (const e of (events || []).slice().sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))) {
    if (e.kind !== "reserved" || e.hidden_at || e.gone_at || !(e.end_date >= today)) continue;
    if (firm.some((s) => covers(s, e)) || out.some((o) => o.start_date < e.end_date && e.start_date < o.end_date)) continue;
    out.push(e);
  }
  return out;
}
export function stayRow(e: Row, owner: string, source: string, started: string, i: number): Row {
  const code = /^HM[A-Z0-9]{8}$/.test(String(e.code || "")) ? String(e.code) : null;
  return {
    id: String(Date.parse(started) + i), user_id: owner, name: code || `${source} ${e.start_date}`, arrival: e.start_date, departure: e.end_date,
    source, booking_status: "confirmed", price: null, commission: null, guests: null,
    details: { ...(code ? { reservation_code: code } : {}), origin: "ical_sync", ical_event_id: e.id, ical_feed_id: e.feed_id, created_from_ical_at: started, pending: ["name", "price"] },
  };
}
async function createStays(owner: string, feeds: { id: string; url: string }[], today: string, started: string): Promise<number> {
  const ids: Record<string, string> = {}; feeds.forEach((f) => { ids[f.id] = sourceOf(f.url); });
  const evs: Row[] = (await db(`ical_events?select=id,feed_id,uid,start_date,end_date,kind,code,hidden_at,gone_at&owner_id=eq.${owner}&kind=eq.reserved&gone_at=is.null&hidden_at=is.null&end_date=gte.${today}&order=start_date.asc&limit=200`) || [])
    .filter((e) => ids[e.feed_id]);
  if (!evs.length) return 0;
  const codes = evs.map((e) => e.code).filter((c) => /^HM[A-Z0-9]{8}$/.test(String(c || "")));
  // Séjours qui peuvent couvrir : en cours ou à venir, ou portant un de ces codes (dates déplacées sur Airbnb).
  const or = `or=(departure.gte.${plusDay(today, -1)}${codes.length ? `,details->>reservation_code.in.(${codes.join(",")})` : ""})`;
  const stays: Row[] = await db(`crm_clients?select=id,arrival,departure,booking_status,details&user_id=eq.${owner}&deleted_at=is.null&${or}&limit=500`) || [];
  const rows = uncovered(evs, stays, today).map((e, i) => stayRow(e, owner, ids[e.feed_id], started, i));
  if (rows.length) await db("crm_clients", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  return rows.length;
}

/** Un compte : chaque calendrier lu, rangé ; ce qui a disparu marqué gone_at ; les réservations sans séjour créées. */
export async function syncOwner(owner: string, rawFeeds: unknown, now = new Date(), auto = true): Promise<Row> {
  const started = now.toISOString(), today = started.slice(0, 10);
  const feeds = feedsOf(rawFeeds), stats: Row = { feeds: feeds.length, events: 0, reserved: 0, blocked: 0, gone: 0, created: 0, errors: [] as Row[] };
  const okIds: string[] = [];
  for (const f of feeds) {
    try {
      const evs = parseIcal(await fetchFeed(f.url)).filter((e) => inWindow(e, today));
      const rows = evs.map((e) => ({ owner_id: owner, feed_id: f.id, uid: e.uid, start_date: e.start, end_date: e.end, kind: e.kind, code: e.code, label: f.label || null, seen_at: started, gone_at: null }));
      for (let i = 0; i < rows.length; i += 200) {
        await db("ical_events?on_conflict=owner_id,feed_id,uid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
      }
      // Ce calendrier ne montre plus ces dates (annulation, déblocage) : elles ne comptent plus.
      const gone: Row[] = await db(`ical_events?owner_id=eq.${owner}&feed_id=eq.${encodeURIComponent(f.id)}&gone_at=is.null&seen_at=lt.${encodeURIComponent(started)}&end_date=gte.${plusDay(today, -1)}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ gone_at: started }) }) || [];
      stats.events += rows.length; stats.reserved += rows.filter((r) => r.kind === "reserved").length; stats.blocked += rows.filter((r) => r.kind === "blocked").length; stats.gone += gone.length;
      okIds.push(f.id);
    } catch (e) {
      // Calendrier illisible : ses dates restent telles quelles (mieux que tout effacer sur une panne passagère).
      stats.errors.push({ feed: f.id, label: f.label, error: String((e as Error).message || e).slice(0, 80) });
      okIds.push(f.id);
    }
  }
  // Calendriers retirés des réglages : leurs dates ne comptent plus.
  const keep = okIds.length ? `&feed_id=not.in.(${okIds.map((x) => encodeURIComponent(x)).join(",")})` : "";
  const dropped: Row[] = await db(`ical_events?owner_id=eq.${owner}&gone_at=is.null${keep}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ gone_at: started }) }) || [];
  stats.gone += dropped.length;
  // Réservations sans séjour → séjours (interrupteur du compte). Une erreur ici n'efface rien de ce qui précède.
  if (auto && feeds.length) {
    try { stats.created = await createStays(owner, feeds, today, started); }
    catch (e) { stats.errors.push({ feed: null, label: "stays", error: String((e as Error).message || e).slice(0, 80) }); }
  }
  await db("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner_id: owner, source: "ical", started_at: started, finished_at: new Date().toISOString(), ok: !stats.errors.length, stats }) }).catch(() => {});
  return stats;
}

const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number, t = Date.now()): boolean {
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(key) || []).filter((x) => t - x < windowMs);
  recent.push(t); hits.set(key, recent);
  return recent.length > max;
}
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
  try {
    const key = req.headers.get("x-sync-key") || "";
    if (key) {
      const ok = await fetch(SB_URL + "/rest/v1/rpc/gmail_sync_key_ok", { method: "POST", headers: H, body: JSON.stringify({ k: key }) }).then((r) => r.json()).catch(() => false);
      if (ok !== true) return out({ error: "unauthorized" }, 401);
      const rows: Row[] = await db("villa_settings?select=owner_id,ical_feeds,ical_auto_create&ical_feeds=neq.%5B%5D&owner_id=not.is.null&limit=500") || [];
      const results: Row[] = [];
      for (const r of rows) {
        try { results.push({ owner: r.owner_id, ...(await syncOwner(String(r.owner_id), r.ical_feeds, new Date(), r.ical_auto_create !== false)) }); }
        catch (e) { results.push({ owner: r.owner_id, error: String((e as Error).message || e).slice(0, 120) }); }
      }
      return out({ ok: true, owners: results.length, results }, results.some((x) => x.error) ? 207 : 200);
    }
    const uid = await userFrom(req);
    if (!uid) return out({ error: "unauthorized" }, 401);
    if (limited("u:" + uid, 6, 60 * 60000)) return out({ error: "rate_limited" }, 429);
    const v: Row[] = await db(`villa_settings?select=ical_feeds,ical_auto_create&owner_id=eq.${uid}&limit=1`) || [];
    const stats = await syncOwner(uid, v[0] && v[0].ical_feeds, new Date(), !!v[0] && v[0].ical_auto_create !== false);
    return out({ ok: true, ...stats });
  } catch (e) {
    console.error("[ical-sync]", String(e).slice(0, 200));
    return out({ error: "unavailable" }, 503);
  }
});
