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
// GET ?t= renvoie aussi { answers } : ce que CE client a lui-même répondu (voir ci-dessous).
// POST { t, answers }  (lien personnel seulement) → le client dit son heure d'arrivée, la composition
//   (couples / personnes seules) et ses repas. Enregistré tel quel dans details.guest_answers, et
//   recopié dans les champs que l'équipe lit (details.arrival_time, details.beds, meals) SEULEMENT
//   s'ils sont vides : jamais écrasé ce que le propriétaire a saisi, jamais traduit, jamais complété.
// POST { t, orders: [{ id, q }] }  (lien personnel seulement, 15/10/2026) → la commande du client avant
//   l'arrivée : repas chiffrés de la fiche (id « m<n> », prix par service selon la taille du groupe) et
//   extras (id « x<n> », fiche EXTRAS). Les prix sont TOUJOURS recalculés ici depuis la fiche, jamais pris
//   de la page. Enregistrée dans details.guest_orders (la dernière remplace la précédente) ; le résumé des
//   repas va dans meals seulement s'il est vide. Rien n'est payé : le propriétaire confirme.
//   Une commande nouvelle ou modifiée (total > 0) laisse une ligne dans guest_notices : push-notify
//   en fait une alerte « Claire a commandé · 2 500 MAD » sur le téléphone du propriétaire.
// POST { t, travellers: [...] }  (lien personnel, villa dont la fiche a VILLA.guest_registration = true) →
//   les fiches voyageurs pour la déclaration aux autorités (ex. Maroc, loi 80-14 art. 36-38 : pièce d'identité
//   et fiche individuelle à l'arrivée, déclaration électronique, fiches gardées un an). Chiffrées ici
//   (AES-256-GCM, clé dans Vault, jamais dans la page), rangées dans guest_registrations (la dernière
//   remplace la précédente), JAMAIS renvoyées au lien : un lien transféré ne montre pas les passeports.
//   Le propriétaire les lit par la fonction guest-registrations. Effacées un an après le départ.
// Rien d'autre n'est renvoyé (ni nom, ni prix, ni séjour). Limite par adresse IP.
// verify_jwt : off (le client n'a pas de compte) — l'accès, c'est le jeton.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const LEGACY_BEFORE = "2026-10-14T00:00:00Z";
export const GRACE_DAYS = 7;

const H = { apikey: SRK, Authorization: "Bearer " + SRK };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
async function db(path: string, init: RequestInit = {}): Promise<Row[]> {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error("db " + r.status);
  const txt = await r.text(); // 201/204 avec Prefer: return=minimal → corps vide
  return txt ? JSON.parse(txt) : [];
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "apikey, content-type" };
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

// Réponses du client : texte court, chiffres bornés, rien d'autre. Un champ vide reste vide.
const LIM = { arrival_time: 120, meals: 600, note: 300 };
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown): number | null => (v === "" || v == null ? null : (Number.isInteger(+v) && +v >= 0 && +v <= 20 ? +v : null));
export function cleanAnswers(a: unknown, lang: unknown): Row | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Row;
  const out: Row = { arrival_time: txt(o.arrival_time, LIM.arrival_time), couples: num(o.couples), singles: num(o.singles), meals: txt(o.meals, LIM.meals), note: txt(o.note, LIM.note) };
  if (!out.arrival_time && out.couples == null && out.singles == null && !out.meals && !out.note) return null;
  out.lang = lang === "en" ? "en" : "fr";
  out.at = new Date().toISOString();
  return out;
}
// « 3 couples + 2 personnes seules » — pour le champ couchages de l'équipe (lu en français par l'équipe).
export function bedsLine(a: Row): string {
  const p: string[] = [];
  if (a.couples) p.push(a.couples + (a.couples > 1 ? " couples" : " couple"));
  if (a.singles) p.push(a.singles + (a.singles > 1 ? " personnes seules" : " personne seule"));
  return p.join(" + ");
}
// Ce que la réponse du client change sur le séjour : la réponse elle-même, et les champs équipe s'ils sont vides.
export function applyAnswers(stay: Row, a: Row): Row {
  const det = { ...(stay.details && typeof stay.details === "object" ? stay.details : {}), guest_answers: a };
  if (!String(det.arrival_time || "").trim() && a.arrival_time) det.arrival_time = a.arrival_time;
  const beds = bedsLine(a);
  if (!String(det.beds || "").trim() && beds) det.beds = beds;
  const body: Row = { details: det };
  if (!String(stay.meals || "").trim() && a.meals) body.meals = a.meals;
  return body;
}

// ── Commande (carte des extras) ─────────────────────────────────────────
// Prix lu dans un texte de la fiche (« 850 MAD », « 1 500 MAD ») ; « Inclus » → null.
export function priceOf(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
  const m = /(\d+(?:[.,]\d{1,2})?)/.exec(String(Array.isArray(v) ? v[0] : v ?? "").replace(/\s/g, ""));
  const n = m ? parseFloat(m[1].replace(",", ".")) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}
export function curOf(f: Row): string {
  const v = f && f.VILLA && typeof f.VILLA.currency === "string" ? f.VILLA.currency.trim() : "";
  if (v) return v.slice(0, 4);
  for (const m of (Array.isArray(f && f.MEALS) ? f.MEALS : [])) {
    const x = /\d\s*([A-Za-z€$£]{1,4})\b|\d\s*([€$£])/.exec(String(Array.isArray(m && m.a) ? m.a[0] : m && m.a || ""));
    if (x) return (x[1] || x[2]).slice(0, 4);
  }
  return "";
}
const pairOf = (v: unknown): string[] => Array.isArray(v) ? [String(v[0] ?? ""), String(v[1] ?? "")] : [String(v ?? ""), ""];
// La carte : repas chiffrés (prix du groupe selon sa taille : 1–6 → a, 7 et plus → b) puis extras.
export function orderMenu(f: Row, pax: number): Row[] {
  const out: Row[] = [];
  (Array.isArray(f && f.MEALS) ? f.MEALS : []).forEach((m: Row, i: number) => {
    const unit = priceOf(pax >= 7 ? (m.b ?? m.a) : m.a) ?? priceOf(m.a);
    if (unit) out.push({ id: "m" + i, kind: "meal", n: pairOf(m.n), unit });
  });
  (Array.isArray(f && f.EXTRAS) ? f.EXTRAS : []).forEach((x: Row, i: number) => {
    const unit = priceOf(x && x.price);
    if (unit && x && x.n) out.push({ id: "x" + i, kind: "extra", n: pairOf(x.n), unit });
  });
  return out;
}
export function paxOf(stay: Row): number {
  const ad = parseInt(stay && stay.adults, 10) || 0, ch = parseInt(stay && stay.children, 10) || 0;
  return (ad + ch) || parseInt(stay && stay.guests, 10) || 0;
}
// Lignes envoyées par la page → commande propre. Seuls id et quantité comptent ; tout le reste vient de la fiche.
export function cleanOrders(raw: unknown, f: Row, pax: number): Row | null {
  if (!Array.isArray(raw) || raw.length > 40) return null;
  const menu = orderMenu(f, pax), qty: Record<string, number> = {};
  for (const l of raw) {
    const id = l && typeof l.id === "string" ? l.id : "", q = Number(l && l.q);
    if (!/^[mx]\d{1,2}$/.test(id) || !Number.isInteger(q) || q < 0 || q > 30) continue;
    qty[id] = q;
  }
  const items = menu.filter((m) => qty[m.id] > 0).map((m) => ({ id: m.id, kind: m.kind, n: m.n, q: qty[m.id], unit: m.unit, sub: Math.round(m.unit * qty[m.id] * 100) / 100 }));
  const total = Math.round(items.reduce((t, x) => t + x.sub, 0) * 100) / 100;
  return { items, total, cur: curOf(f), at: new Date().toISOString() };
}
// La commande sur le séjour : details.guest_orders, et le résumé des repas dans meals s'il est vide (l'équipe le lit).
export function applyOrders(stay: Row, body: Row, o: Row): Row {
  const det = { ...(body.details || (stay.details && typeof stay.details === "object" ? stay.details : {})), guest_orders: o };
  const out: Row = { ...body, details: det };
  const meals = o.items.filter((x: Row) => x.kind === "meal").map((x: Row) => x.q + " × " + x.n[0]).join(", ");
  if (meals && !String(stay.meals || "").trim()) out.meals = [body.meals, meals].filter(Boolean).join(" · ");
  return out;
}

// Même commande qu'avant (mêmes lignes, mêmes quantités) : pas de nouvelle alerte.
export function sameOrder(a: Row | null, b: Row | null): boolean {
  const k = (o: Row | null) => o && Array.isArray(o.items) ? o.items.map((x: Row) => x.id + "×" + x.q).sort().join(",") : "";
  return k(a) === k(b);
}
/** « Thibaut Vauclare » → « Thibaut V. » : le nom complet d'un client ne part pas dans une notification. */
export function shortName(n: unknown): string {
  const p = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "";
  return p.length > 1 ? p[0] + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : p[0];
}
export function orderNotice(owner: string, stay: Row, o: Row): Row {
  return { owner_id: owner, client_id: String(stay.id), kind: "order",
    payload: { guest: shortName(stay.name), total: o.total, cur: o.cur, items: o.items.map((x: Row) => ({ n: x.n, q: x.q })) } };
}

// ── Fiches voyageurs ─────────────────────────────────────────────────────────
export const REG_FIELDS: Record<string, number> = { last: 60, first: 60, birth_date: 10, birth_place: 80, nationality: 60, doc_type: 12, doc_no: 30, profession: 60, address: 160 };
export const regOn = (f: Row | null) => !!(f && f.VILLA && f.VILLA.guest_registration === true);
// Une fiche par voyageur : champs connus seulement, texte court, date AAAA-MM-JJ, fiche sans nom ignorée.
export function cleanTravellers(raw: unknown): Row[] | null {
  if (!Array.isArray(raw) || raw.length > 30) return null;
  const res: Row[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o: Row = {};
    for (const k of Object.keys(REG_FIELDS)) o[k] = txt((t as Row)[k], REG_FIELDS[k]);
    if (o.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(o.birth_date)) o.birth_date = "";
    if (!["passport", "id_card", "other"].includes(o.doc_type)) o.doc_type = "";
    if (!o.last && !o.first) continue;
    res.push(o);
  }
  return res.length ? res : null;
}
export const plusDays = (iso: string, n: number) => day(Date.parse(String(iso || "").slice(0, 10) + "T12:00:00Z") + n * 86400000);
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
/** Chiffre avec la clé (32 octets base64) : « v1: » + base64(iv 12 octets + texte chiffré AES-GCM). */
export async function sealWith(keyB64: string, obj: unknown): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return "v1:" + toB64(all);
}
async function regKey(): Promise<string> {
  const k = await db("rpc/guest_reg_key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }) as unknown;
  if (typeof k !== "string" || !k) throw new Error("guest_reg_key");
  return k;
}
async function saveReg(owner: string, stay: Row, travellers: Row[]): Promise<Row> {
  const at = new Date().toISOString();
  const row = { enc: await sealWith(await regKey(), { v: 1, travellers }), travellers: travellers.length, submitted_at: at, purge_after: plusDays(stay.departure, 365), purged_at: null };
  const cur = await db(`guest_registrations?select=id&owner_id=eq.${owner}&client_id=eq.${encodeURIComponent(stay.id)}&deleted_at=is.null&limit=1`);
  const W = { "Content-Type": "application/json", Prefer: "return=minimal" };
  if (cur.length) await db(`guest_registrations?id=eq.${cur[0].id}`, { method: "PATCH", headers: W, body: JSON.stringify(row) });
  else await db(`guest_registrations`, { method: "POST", headers: W, body: JSON.stringify({ owner_id: owner, client_id: String(stay.id), ...row }) });
  return { count: travellers.length, at };
}
async function regOf(owner: string, stayId: string): Promise<Row | null> {
  const r = await db(`guest_registrations?select=travellers,submitted_at&owner_id=eq.${owner}&client_id=eq.${encodeURIComponent(stayId)}&deleted_at=is.null&purged_at=is.null&limit=1`);
  return r.length ? { count: r[0].travellers, at: r[0].submitted_at } : null;
}

async function factsOf(owner: string): Promise<Row | null> {
  const v = await db(`villa_settings?select=house_facts&owner_id=eq.${owner}&limit=1`);
  const f = v[0] && v[0].house_facts;
  return f && typeof f === "object" && f.VILLA ? f : null;
}

// Le séjour d'un jeton (lien non retiré, séjour pas terminé depuis plus de 7 jours), sinon le code d'erreur.
async function stayOfToken(t: string, today: string): Promise<{ stay?: Row; owner?: string; err?: number }> {
  const l = await db(`livret_links?select=owner_id,client_id&token=eq.${t}&deleted_at=is.null&limit=1`);
  if (!l.length) return { err: 404 };
  const s = await db(`crm_clients?select=id,name,departure,deleted_at,details,meals,adults,children,guests&id=eq.${encodeURIComponent(l[0].client_id)}&user_id=eq.${l[0].owner_id}&limit=1`);
  const graceEnd = day(Date.parse(today + "T12:00:00Z") - GRACE_DAYS * 86400000);
  if (!s.length || s[0].deleted_at || String(s[0].departure || "").slice(0, 10) < graceEnd) return { err: 410 };
  return { stay: s[0], owner: String(l[0].owner_id) };
}
const answersOf = (stay: Row) => (stay.details && typeof stay.details === "object" && stay.details.guest_answers) || null;
const ordersOf = (stay: Row) => (stay.details && typeof stay.details === "object" && stay.details.guest_orders) || null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const q = new URL(req.url).searchParams;
  const today = day(Date.now());
  try {
    if (req.method === "POST") {
      // deno-lint-ignore no-explicit-any
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const t = body && body.t;
      if (!validToken(t)) return out({ error: "not_found" }, 404);
      if (limited("p:" + ip, 20, 60 * 60_000)) return out({ error: "rate_limited" }, 429);
      const a = cleanAnswers(body.answers, body.lang);
      const wantsOrder = Array.isArray(body.orders), wantsReg = Array.isArray(body.travellers);
      if (!a && !wantsOrder && !wantsReg) return out({ error: "empty" }, 400);
      const r = await stayOfToken(t, today);
      if (r.err || !r.stay) return out({ error: r.err === 410 ? "expired" : "not_found" }, r.err || 404);
      if (String(r.stay.departure || "").slice(0, 10) < today) return out({ error: "expired" }, 410); // séjour terminé : plus rien à transmettre
      let patch: Row = a ? applyAnswers(r.stay, a) : {};
      const f = wantsOrder || wantsReg ? await factsOf(String(r.owner)) : null;
      const o = f && wantsOrder ? cleanOrders(body.orders, f, paxOf(r.stay)) : null;
      if (o) patch = applyOrders(r.stay, patch, o);
      const tr = wantsReg && regOn(f) ? cleanTravellers(body.travellers) : null;
      if (!Object.keys(patch).length && !tr) return out({ error: "empty" }, 400);
      if (Object.keys(patch).length) await db(`crm_clients?id=eq.${encodeURIComponent(r.stay.id)}&user_id=eq.${r.owner}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      // Alerte au propriétaire : seulement une commande nouvelle ou modifiée, jamais pour un simple renvoi.
      if (o && o.total > 0 && !sameOrder(ordersOf(r.stay), o)) {
        await db(`guest_notices`, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(orderNotice(String(r.owner), r.stay, o)) }).catch((e) => console.error("[livret-view] notice", String(e).slice(0, 120)));
      }
      const reg = tr ? await saveReg(String(r.owner), r.stay, tr) : null;
      return out({ ok: true, answers: a || answersOf(r.stay), orders: o || ordersOf(r.stay), ...(reg ? { reg } : {}) });
    }
    const t = q.get("t");
    if (t) {
      if (!validToken(t)) return out({ error: "not_found" }, 404);
      if (limited("t:" + ip, 120, 10 * 60_000)) return out({ error: "rate_limited" }, 429);
      const r = await stayOfToken(t, today);
      if (r.err || !r.stay) return out({ error: r.err === 410 ? "expired" : "not_found" }, r.err || 404);
      const f = await factsOf(String(r.owner));
      if (!f) return out({ error: "not_found" }, 404);
      return out({ facts: f, answers: answersOf(r.stay), orders: ordersOf(r.stay), ...(regOn(f) ? { reg: await regOf(String(r.owner), String(r.stay.id)).catch(() => null) } : {}) }); // une panne ici ne bloque jamais le livret
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
