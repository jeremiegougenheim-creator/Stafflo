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
// Les textes des alertes reprennent UNIQUEMENT ce que le parseur a lu dans l'email
// (extracted.airbnb) : un champ absent n'apparaît pas, rien n'est deviné.
import { generateVapidKeys, sendPush, type Sub } from "./webpush.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || SRK;
const OWNER_ID = "0f25a319-8cbb-44ae-96e3-7befcda16c9b"; // Villa DarJ (mono-locataire)
const SUBJECT = "mailto:marrakech.villadarj@gmail.com";
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
      const rows: Row[] = await db(`email_inbox?select=id,from_email,received_at,extracted&owner_id=eq.${OWNER_ID}&notified_at=is.null&received_at=gte.${since}&order=received_at.asc&limit=25`) || [];
      const subs = await subsOf(OWNER_ID);
      const stats = { pending: rows.length, alerts: 0, sent: 0, failed: 0, subs: subs.length, waiting_parse: 0 };
      for (const r of rows) {
        const p = r.extracted?.airbnb;
        if (/airbnb\./i.test(r.from_email || "") && !p) { stats.waiting_parse++; continue; } // la ré-analyse passera
        const make = (lang: "fr" | "en") => (p ? buildAlert(p, lang) : null);
        if (make("fr") && subs.length) { stats.alerts++; const d = await deliver(subs, make); stats.sent += d.sent; stats.failed += d.failed; }
        await db(`email_inbox?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
      }
      return out({ ok: true, stats });
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
