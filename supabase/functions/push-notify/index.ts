// push-notify — alertes instantanées sur le téléphone (Web Push), sans service tiers.
//
// Trois usages (POST, JSON) :
//   { action: "run" }        + en-tête x-sync-key  → cron toutes les 5 min : envoie une
//                              alerte pour chaque nouvel email Airbnb utile (demande,
//                              demande de réservation, message, confirmation,
//                              modification, annulation, versement) puis le marque
//                              notified_at. Rien n'est jamais envoyé deux fois.
//   { action: "public_key" } + JWT utilisateur   → clé publique VAPID (créée au premier
//                              appel et rangée dans Vault ; la clé privée ne quitte
//                              jamais la base et cette fonction).
//   { action: "test" }       + JWT utilisateur   → alerte d'essai sur les appareils de
//                              l'utilisateur.
//   { action: "brief" }      + en-tête x-sync-key → cron du matin : une notification
//                              « aujourd'hui » (arrivées, départs, à faire, messages,
//                              avis), seulement s'il y a quelque chose. { dry: true } = aperçu.
// Les textes des alertes reprennent UNIQUEMENT ce que le parseur a lu dans l'email
// (extracted.airbnb) : un champ absent n'apparaît pas, rien n'est deviné.
//
// v2 (13/10/2026, audit SaaS) — MULTI-PROPRIÉTAIRE. Plus aucun compte en dur :
//   · « run » : un seul passage sur les nouveaux emails de TOUS les comptes ; chaque
//     alerte part sur les appareils du propriétaire de l'email, jamais ailleurs.
//   · « brief » : cron toutes les heures (:30). Pour chaque compte qui a des alertes
//     actives, le point part quand il est 8 h dans le fuseau de SA villa (déduit du
//     pays, UTC sinon) → 8 h 30 locales. Titre = nom de la villa du compte. Livret,
//     repas et message de départ ne sont comptés que pour un compte avec une fiche
//     maison (comme l'Espace). { dry: true } = aperçu de tous les comptes, sans envoi.
import { generateVapidKeys, sendPush, type Sub } from "./webpush.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
// Contact de l'exploitant du service (exigé par les services push) : Stafflo, pas une villa.
const SUBJECT = "mailto:hello@stafflo.app";
const ORIGINS = ["https://stafflo.app", "https://www.stafflo.app", "https://jeremiegougenheim-creator.github.io"];

const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + path.split("?")[0] + ": " + txt.slice(0, 200));
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

// ── Clés VAPID (Vault) ───────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
let VAPID: any = null;
async function vapid() {
  if (VAPID) return VAPID;
  let k = await db("rpc/push_vapid_private", { method: "POST", body: "{}" });
  if (!k?.pub || !k?.priv) {
    const g = await generateVapidKeys();
    await db("rpc/push_vapid_init", { method: "POST", body: JSON.stringify({ pub: g.publicKey, priv: JSON.stringify(g.privateJwk) }) });
    k = await db("rpc/push_vapid_private", { method: "POST", body: "{}" });
  }
  VAPID = { publicKey: k.pub, privateJwk: JSON.parse(k.priv), subject: SUBJECT };
  return VAPID;
}

// ── Textes des alertes ───────────────────────────────────────────────────
const MON = { fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."], en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] };
function day(iso: string | null | undefined, lang: "fr" | "en"): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return lang === "fr" ? `${+m[3]} ${MON.fr[+m[2] - 1]}` : `${MON.en[+m[2] - 1]} ${+m[3]}`;
}
function euros(n: number | null | undefined, lang: "fr" | "en"): string {
  if (n == null || !isFinite(+n)) return "";
  return (+n).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
}
function group(p: Row, lang: "fr" | "en"): string {
  if (p.adults == null) return "";
  const fr = lang === "fr";
  const parts = [p.adults + (fr ? (p.adults > 1 ? " adultes" : " adulte") : (p.adults > 1 ? " adults" : " adult"))];
  if (p.children) parts.push(p.children + (fr ? (p.children > 1 ? " enfants" : " enfant") : (p.children > 1 ? " children" : " child")));
  if (p.infants) parts.push(p.infants + (fr ? (p.infants > 1 ? " bébés" : " bébé") : (p.infants > 1 ? " infants" : " infant")));
  return parts.join(", ");
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
/** « Thibaut Vauclare » → « Thibaut V. » (le nom complet d'un client ne part pas dans une notification). */
export function shortName(n: unknown): string {
  const p = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "";
  return p.length > 1 ? p[0] + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : p[0];
}
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Alerte pour un email déjà analysé. null = pas d'alerte pour ce type. Exportée pour les tests. */
export function buildAlert(p: Row, lang: "fr" | "en"): { title: string; body: string; tag: string } | null {
  if (!p || !p.type) return null;
  const fr = lang === "fr";
  const who = p.first_name || (p.name ? String(p.name).split(/\s+/)[0] : "") || (fr ? "Un voyageur" : "A guest");
  const dates = p.checkin && p.checkout ? day(p.checkin, lang) + " → " + day(p.checkout, lang) : "";
  const msg = String(p.guest_message || "").replace(/\s+/g, " ").trim();
  if (/^Reacted\b/i.test(msg)) return null;
  const line = (...xs: string[]) => xs.filter(Boolean).join(" · ");
  const tag = "airbnb-" + (p.thread_id || p.code || p.type);
  switch (p.type) {
    case "inquiry":
      return { tag, title: fr ? `Nouvelle demande — ${who}` : `New enquiry — ${who}`,
        body: line(dates, group(p, lang), fr ? "24 h pour répondre" : "24 h to reply") + (msg ? "\n« " + clip(msg, 140) + " »" : "") };
    case "request":
      return { tag, title: fr ? `Demande de réservation — ${who}` : `Booking request — ${who}`,
        body: line(dates, group(p, lang), fr ? "à accepter sous 24 h" : "accept within 24 h") };
    case "message":
      if (!msg) return null;
      return { tag, title: fr ? `Message de ${who}` : `Message from ${who}`, body: clip(msg, 180) };
    case "confirmation":
      return { tag, title: fr ? `Réservation confirmée — ${p.name || who}` : `Booking confirmed — ${p.name || who}`,
        body: line(dates, group(p, lang), p.payout_eur != null ? (fr ? "net " : "net ") + euros(p.payout_eur, lang) : "") };
    case "alteration":
      return { tag, title: fr ? `Modification de réservation — ${who}` : `Booking change — ${who}`, body: line(dates, group(p, lang)) || (fr ? "À vérifier sur Airbnb" : "Check on Airbnb") };
    case "cancellation":
      return { tag, title: fr ? `Annulation — ${p.name || who}` : `Cancellation — ${p.name || who}`, body: line(p.code || "", dates) || (fr ? "À vérifier sur Airbnb" : "Check on Airbnb") };
    case "payout": {
      const po = p.payout || {};
      const total = po.total_eur != null ? po.total_eur : (po.items || []).reduce((s: number, it: Row) => s + (+it.amount_eur || 0), 0) || null;
      if (total == null) return null;
      return { tag: "payout-" + (po.id || ""), title: fr ? `Versement Airbnb — ${euros(total, lang)}` : `Airbnb payout — ${euros(total, lang)}`,
        body: line((po.items || []).map((it: Row) => it.name).filter(Boolean).join(", "), po.expected_by ? (fr ? "en banque vers le " : "in the bank by ") + day(po.expected_by, lang) : "") };
    }
    default:
      return null;
  }
}

// ── Retour de l'équipe (staff_reports) : « Saïd : chambres prêtes pour Thibaut V. », « Saïd signale : … » ──
export function buildTeamAlert(r: Row, who: string, guest: string, lang: "fr" | "en"): { title: string; body: string; tag: string } | null {
  if (!r || !r.kind) return null;
  const fr = lang === "fr", name = who || (fr ? "L'équipe" : "The team"), tag = "team-" + (r.id || r.kind);
  if (r.kind === "rooms_ready") return { tag, title: fr ? `${name} : chambres prêtes` : `${name}: rooms ready`, body: guest ? (fr ? "pour " : "for ") + guest : "" };
  if (r.kind === "issue") { const t = String(r.text || "").replace(/\s+/g, " ").trim(); if (!t) return null; return { tag, title: fr ? `${name} signale un problème` : `${name} reports a problem`, body: clip(t, 180) + (guest ? (fr ? " · " : " · ") + guest : "") }; }
  return null;
}

// ── Point du matin (cron :30 chaque heure → 8 h 30 heure de la villa) ────
// Même logique que l'Espace : vérifications avant arrivée (téléphone et livret
// J-3, repas J-2, brief J-1), message de départ, avis Airbnb (14 jours), messages
// clients en attente. Tout est compté depuis la base, rien n'est estimé.
const FIRM_OUT = ["inquiry", "lead", "quoted", "declined", "cancelled", "canceled", "archived", "expired"];
const dn = (iso: string | null | undefined) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
// opts.facts : le compte a une fiche maison (livret, repas, message de départ) ; opts.name : nom de SA villa.
export function buildBrief(stays: Row[], msgCount: number, todayIso: string, lang: "fr" | "en", opts: { name?: string; facts?: boolean } = {}): { title: string; body: string; tag: string } | null {
  const fr = lang === "fr", t = dn(todayIso)!, facts = !!opts.facts;
  const firm = (stays || []).filter((c) => !c.deleted_at && !FIRM_OUT.includes(String(c.booking_status || "").toLowerCase()) && dn(c.arrival) != null && dn(c.departure) != null);
  const first = (c: Row) => String(c.name || "").split(/\s+/)[0] || "?";
  const pax = (c: Row) => { const n = (+c.adults || 0) + (+c.children || 0) || +c.guests || 0; return n ? (fr ? ` (${n} pers.)` : ` (${n} guests)`) : ""; };
  const arr = firm.filter((c) => dn(c.arrival) === t), dep = firm.filter((c) => dn(c.departure) === t);
  let late = 0, today = 0;
  firm.filter((c) => { const a = dn(c.arrival)!; return a >= t && a - t <= 3; }).forEach((c) => {
    const a = dn(c.arrival)!, d = c.details || {};
    ([[!!String(c.phone || "").trim(), a - 3], facts ? [!!d.livretSentAt, a - 3] : null, facts ? [!!String(c.meals || "").trim(), a - 2] : null, [!!c.staff_briefed_at, a - 1]]
      .filter(Boolean) as [boolean, number][])
      .forEach(([done, due]) => { if (!done) { if (t > due) late++; else if (t === due) today++; } });
  });
  const departMsg = !facts ? 0 : firm.filter((c) => { const d = dn(c.departure)!; return d >= t && d - t <= 1 && !(c.details || {}).departMsgAt; }).length;
  const reviews = firm.filter((c) => { const d = dn(c.departure)!; return /airbnb/i.test(String(c.source || "")) && !c.is_comp && !(c.details || {}).reviewDoneAt && t > d && t <= d + 14; }).length;
  const parts: string[] = [];
  if (arr.length) parts.push((fr ? "Arrivée : " : "Arriving: ") + arr.map((c) => first(c) + pax(c)).join(", "));
  if (dep.length) parts.push((fr ? "Départ : " : "Leaving: ") + dep.map(first).join(", "));
  const todo = late + today + departMsg;
  if (todo) parts.push(fr ? `${todo} à faire` + (late ? `, dont ${late} en retard` : "") : `${todo} to do` + (late ? `, ${late} overdue` : ""));
  if (msgCount) parts.push(fr ? `${msgCount} message${msgCount > 1 ? "s" : ""} client${msgCount > 1 ? "s" : ""} à traiter` : `${msgCount} guest message${msgCount > 1 ? "s" : ""} to handle`);
  if (reviews) parts.push(fr ? `${reviews} avis Airbnb à laisser` : `${reviews} Airbnb review${reviews > 1 ? "s" : ""} to leave`);
  if (!parts.length) return null; // rien à signaler : pas de notification
  const name = String(opts.name || "").trim() || "Stafflo";
  return { tag: "brief-" + todayIso, title: name + (fr ? " — aujourd’hui" : " — today"), body: clip(parts.join(" · "), 230) };
}

// Fuseau de la villa, déduit du pays saisi (ou de la ville « Marrakech, Maroc »). Inconnu → UTC.
const TZ: [RegExp, string][] = [
  [/\b(maroc|morocco)\b/, "Africa/Casablanca"], [/\bfrance\b/, "Europe/Paris"], [/\bportugal\b/, "Europe/Lisbon"],
  [/\b(espagne|spain|espana)\b/, "Europe/Madrid"], [/\b(italie|italy|italia)\b/, "Europe/Rome"], [/\b(grece|greece)\b/, "Europe/Athens"],
  [/\b(royaume-uni|united kingdom|uk|england|angleterre)\b/, "Europe/London"], [/\b(suisse|switzerland)\b/, "Europe/Zurich"],
  [/\b(belgique|belgium)\b/, "Europe/Brussels"], [/\b(croatie|croatia)\b/, "Europe/Zagreb"], [/\b(turquie|turkey|turkiye)\b/, "Europe/Istanbul"],
  [/\b(tunisie|tunisia)\b/, "Africa/Tunis"], [/\b(thailande|thailand)\b/, "Asia/Bangkok"], [/\b(indonesie|indonesia|bali)\b/, "Asia/Makassar"],
  [/\b(maurice|mauritius)\b/, "Indian/Mauritius"], [/\b(emirats|uae|united arab emirates|dubai)\b/, "Asia/Dubai"],
  [/\b(afrique du sud|south africa)\b/, "Africa/Johannesburg"], [/\b(mexique|mexico)\b/, "America/Mexico_City"],
];
export function tzFor(country: unknown, city: unknown): string {
  const k = (String(country || "") + " " + String(city || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [re, tz] of TZ) if (re.test(k)) return tz;
  return "UTC";
}
export function localDay(tz: string, now: Date): { iso: string; hour: number } {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now);
  return { iso, hour };
}
export const BRIEF_HOUR = 8; // cron à :30 → 8 h 30 heure de la villa

async function subsOf(owner: string): Promise<(Sub & { id: string; lang: string })[]> {
  return await db(`push_subscriptions?select=id,endpoint,p256dh,auth,lang&owner_id=eq.${owner}&deleted_at=is.null`) || [];
}
async function deliver(subs: (Sub & { id: string; lang: string })[], make: (lang: "fr" | "en") => Row | null) {
  const v = await vapid();
  let sent = 0, failed = 0;
  for (const s of subs) {
    const m = make(s.lang === "en" ? "en" : "fr");
    if (!m) continue;
    try {
      const r = await sendPush(s, { ...m, url: "/espace.html" }, v);
      if (r.ok) { sent++; await db(`push_subscriptions?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_ok_at: new Date().toISOString(), last_error: null }) }); }
      else {
        failed++;
        await db(`push_subscriptions?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(r.gone ? { deleted_at: new Date().toISOString(), last_error: "gone " + r.status } : { last_error: r.status + " " + (r.text || "") }) });
      }
    } catch (e) { failed++; console.error("push", String(e).slice(0, 200)); }
  }
  return { sent, failed };
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
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...ch, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === "run") {
      const key = req.headers.get("x-sync-key") || "";
      const ok = key && await fetch(SB_URL + "/rest/v1/rpc/gmail_sync_key_ok", { method: "POST", headers: H, body: JSON.stringify({ k: key }) }).then((r) => r.json()).catch(() => false);
      if (ok !== true) return out({ error: "unauthorized" }, 401);
      await vapid(); // crée les clés au premier passage, avant tout abonnement
      const since = new Date(Date.now() - 12 * 3600000).toISOString();
      // Tous les comptes : chaque email part sur les appareils de SON propriétaire.
      const rows: Row[] = await db(`email_inbox?select=id,owner_id,from_email,received_at,extracted&notified_at=is.null&received_at=gte.${since}&order=received_at.asc&limit=100`) || [];
      const subsBy = new Map<string, (Sub & { id: string; lang: string })[]>();
      const stats = { pending: rows.length, owners: 0, alerts: 0, sent: 0, failed: 0, waiting_parse: 0 };
      for (const r of rows) {
        const p = r.extracted?.airbnb;
        if (/airbnb\./i.test(r.from_email || "") && !p) { stats.waiting_parse++; continue; } // la ré-analyse passera
        const owner = String(r.owner_id || "");
        if (owner && !subsBy.has(owner)) { subsBy.set(owner, await subsOf(owner)); stats.owners++; }
        const subs = owner ? subsBy.get(owner)! : [];
        const make = (lang: "fr" | "en") => (p ? buildAlert(p, lang) : null);
        if (make("fr") && subs.length) { stats.alerts++; const d = await deliver(subs, make); stats.sent += d.sent; stats.failed += d.failed; }
        await db(`email_inbox?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
      }
      // Retours de l'équipe (chambres prêtes, problème) : une alerte par ligne, au propriétaire du lien, jamais deux fois.
      const reps: Row[] = await db(`staff_reports?select=id,owner_id,link_id,client_id,kind,text,created_at&notified_at=is.null&deleted_at=is.null&created_at=gte.${since}&order=created_at.asc&limit=50`).catch(() => []) || [];
      const teamStats = { pending: reps.length, alerts: 0, sent: 0, failed: 0 };
      for (const r of reps) {
        const owner = String(r.owner_id || "");
        if (owner && !subsBy.has(owner)) { subsBy.set(owner, await subsOf(owner)); }
        const subs = owner ? subsBy.get(owner)! : [];
        const link = (await db(`staff_links?select=name&id=eq.${r.link_id}&limit=1`).catch(() => []) || [])[0];
        const stay = r.client_id ? (await db(`crm_clients?select=name&id=eq.${encodeURIComponent(r.client_id)}&user_id=eq.${owner}&limit=1`).catch(() => []) || [])[0] : null;
        const guest = stay ? shortName(stay.name) : "";
        const make = (lang: "fr" | "en") => buildTeamAlert(r, link?.name || "", guest, lang);
        if (make("fr") && subs.length) { teamStats.alerts++; const d = await deliver(subs, make); teamStats.sent += d.sent; teamStats.failed += d.failed; }
        await db(`staff_reports?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
      }
      return out({ ok: true, stats, team: teamStats });
    }
    if (body.action === "brief") {
      const key = req.headers.get("x-sync-key") || "";
      const ok = key && await fetch(SB_URL + "/rest/v1/rpc/gmail_sync_key_ok", { method: "POST", headers: H, body: JSON.stringify({ k: key }) }).then((r) => r.json()).catch(() => false);
      if (ok !== true) return out({ error: "unauthorized" }, 401);
      const now = new Date(), dry = !!body.dry;
      const only = /^[0-9a-f-]{36}$/i.test(String(body.owner || "")) ? String(body.owner) : null;
      // Comptes avec au moins un appareil abonné (un aperçu dry les montre tous).
      const live: Row[] = await db(`push_subscriptions?select=owner_id&deleted_at=is.null${only ? "&owner_id=eq." + only : ""}`) || [];
      const ids = [...new Set(live.map((x) => String(x.owner_id || "")).filter(Boolean))];
      const vs: Row[] = ids.length ? await db(`villa_settings?select=owner_id,villa_name,country,city,house_facts_ref&owner_id=in.(${ids.join(",")})`) || [] : [];
      // deno-lint-ignore no-explicit-any
      const results: any[] = [];
      for (const owner of ids) {
        const v = vs.find((x) => x.owner_id === owner) || {};
        const tz = tzFor(v.country, v.city), here = localDay(tz, now), todayIso = here.iso;
        if (!dry && here.hour !== BRIEF_HOUR) continue; // pas encore 8 h chez cette villa
        const opts = { name: String(v.villa_name || ""), facts: v.house_facts_ref === "villa-facts.js" };
        const lo = new Date(Date.parse(todayIso) - 16 * 86400000).toISOString().slice(0, 10), hi = new Date(Date.parse(todayIso) + 4 * 86400000).toISOString().slice(0, 10);
        const stays: Row[] = await db(`crm_clients?select=name,arrival,departure,guests,adults,children,phone,meals,staff_briefed_at,details,source,is_comp,booking_status,deleted_at&user_id=eq.${owner}&deleted_at=is.null&departure=gte.${lo}&arrival=lte.${hi}`) || [];
        const since48 = new Date(now.getTime() - 48 * 3600000).toISOString(), since24 = now.getTime() - 24 * 3600000;
        const mails: Row[] = await db(`email_inbox?select=received_at,extracted&owner_id=eq.${owner}&archived_at=is.null&from_email=ilike.*airbnb.com&received_at=gte.${since48}`) || [];
        const threads = new Set<string>();
        mails.forEach((m) => {
          const p = m.extracted?.airbnb; if (!p || !["message", "inquiry", "request"].includes(p.type)) return;
          if (p.type !== "message" && Date.parse(m.received_at) < since24) return; // demande expirée
          if (/^Reacted\b/i.test(String(p.guest_message || ""))) return;
          threads.add(p.thread_id || m.received_at);
        });
        const subs = await subsOf(owner);
        const preview = buildBrief(stays, threads.size, todayIso, "fr", opts);
        const res: Row = { owner: owner.slice(0, 8), tz, today: todayIso, brief: preview, subs: subs.length };
        if (!dry && preview && subs.length) Object.assign(res, await deliver(subs, (lang) => buildBrief(stays, threads.size, todayIso, lang, opts)));
        results.push(res);
      }
      return out({ ok: true, dry, owners: results.length, results });
    }
    const uid = await userFrom(req);
    if (!uid) return out({ error: "unauthorized" }, 401);
    if (body.action === "public_key") return out({ publicKey: (await vapid()).publicKey });
    if (body.action === "test") {
      const subs = await subsOf(uid);
      if (!subs.length) return out({ ok: false, error: "no_subscription" }, 400);
      const d = await deliver(subs, (lang) => ({ tag: "test", title: lang === "fr" ? "Stafflo — alertes activées" : "Stafflo — alerts on", body: lang === "fr" ? "Vous recevrez ici les demandes, messages et réservations Airbnb." : "Airbnb enquiries, messages and bookings will show up here." }));
      return out({ ok: d.sent > 0, ...d });
    }
    return out({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("push-notify", String(e).slice(0, 300));
    return out({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});
