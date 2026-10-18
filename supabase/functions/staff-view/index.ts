// staff-view — la vue équipe (equipe.html) : arrivées, départs, composition des
// groupes, heure d'arrivée, couchages, repas et consigne, pour Saïd, Bouchra ou
// la cuisinière. Sans compte : chaque personne a un lien personnel.
//
// POST { k } → { name, lang, today, stays, reports }
//   k = jeton du lien (jamais stocké : seule son empreinte sha-256 est en base,
//       table staff_links). Un lien retiré (deleted_at) ne répond plus.
// POST { k, action: "report", kind, client_id?, text? } → { ok, report }
//   L'équipe renvoie quelque chose (table staff_reports) : « chambres prêtes » pour un
//   séjour (kind rooms_ready, client_id d'un séjour visible), ou un problème (kind issue,
//   texte ≤ 300). Le propriétaire le voit dans l'Espace et reçoit une alerte. 30 par heure
//   et par lien. Rien d'autre n'est modifiable depuis ce lien.
//
// Données minimales, en lecture seule : prénom + initiale, dates, nombre de
// personnes, et trois champs écrits POUR l'équipe dans l'Espace
// (details.arrival_time, details.beds, details.staff_note ; depuis le 17/10/2026 details.departure_time et details.drinks) + les repas, + les extras
// commandés par le client dans son livret (quoi et combien, sans prix).
// Jamais : prix, versements, notes du propriétaire, téléphone, email,
// nationalité, code de réservation. Les demandes (leads) n'apparaissent pas.
//
// Lisible et en arabe (18/10/2026) : chaque séjour porte aussi `lines` — repas, consigne (une phrase par ligne),
// boissons, extras (un article par ligne), même règle que les briefs de l'Espace. Quand la page lit en arabe
// (body.lang = "ar", sinon la langue du lien), `ar` porte les mêmes champs traduits (Mistral UE, un seul appel
// pour tout ce qui manque, lignes alignées une à une), gardés dans staff_i18n par empreinte du texte français :
// un texte modifié dans l'Espace est retraduit au passage suivant, un texte inchangé ne repasse jamais par l'IA.
// Sans clé, en panne ou trop long (12 s) : la page montre le français, comme avant.

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
export type Lines = { arrival_time: string[]; departure_time: string[]; beds: string[]; meals: string[]; drinks: string[]; note: string[]; extras: string[] };
export type StaffStay = {
  id: string; name: string; a: string; d: string; nights: number;
  adults: number | null; children: number | null; infants: number | null; pax: number | null;
  arrival_time: string; departure_time: string; beds: string; meals: string; drinks: string; note: string; extras: string; same_day: boolean;
  lines: Lines; ar?: Partial<Lines>;
};
// ── Lisibilité : une phrase par ligne (repas, consigne), un article par ligne (boissons, extras) — mêmes règles que l'Espace ──
export function sentences(line: string): string[] { // coupe après « . ! ? » suivis d'une majuscule ou d'un chiffre
  const out: string[] = []; let last = 0; const rx = /[.!?]\s+(?=[A-ZÀ-ÝÉÈÊ0-9«])/g; let m: RegExpExecArray | null;
  while ((m = rx.exec(line))) { out.push(line.slice(last, m.index + 1)); last = m.index + m[0].length; }
  out.push(line.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}
export function listItems(line: string): string[] { // « 2 vins rouges (marocains, choisis par nous) » : la virgule entre parenthèses ne coupe pas
  const out: string[] = []; let cur = "", depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === ";" || (ch === "·" && /\s/.test(line[i - 1] || "")))) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function bulletsOf(text: string, mode: "list" | "sentences"): string[] {
  const raw = String(text || "").trim(); if (!raw) return [];
  const parts: string[] = [];
  raw.split(/\n+/).forEach((ln) => {
    const line = ln.replace(/^\s*[-•*·]\s*/, "").trim(); if (!line) return;
    (mode === "list" ? listItems(line) : sentences(line)).forEach((x) => parts.push(x));
  });
  return parts.map((x) => x.slice(0, 400));
}
export const LINE_FIELDS: (keyof Lines)[] = ["arrival_time", "departure_time", "beds", "meals", "drinks", "note", "extras"];
export function linesOf(s: Omit<StaffStay, "lines">): Lines {
  return { arrival_time: s.arrival_time ? [s.arrival_time] : [], departure_time: s.departure_time ? [s.departure_time] : [], beds: s.beds ? [s.beds] : [],
    meals: bulletsOf(s.meals, "sentences"), drinks: bulletsOf(s.drinks, "list"), note: bulletsOf(s.note, "sentences"), extras: s.extras ? s.extras.split(" · ").map((x) => x.trim()).filter(Boolean) : [] };
}
// Heure tirée de WhatsApp (17/10/2026, même règle que les briefs de l'Espace, teamTxt) : « « - nous atterrissons à
// 14h. » (WhatsApp, lun. 5 oct. 18:26) » → « « nous atterrissons à 14h » ». Le moment du message ne reste que pour
// une heure relative (« in about 1hr15 »), qui ne veut rien dire sans lui.
const REL = /\b(?:in|within|dans|d['’]ici)\s+(?:about\s+|around\s+|approx\.?\s+|environ\s+|à peu près\s+|moins d['’]\s*)?\d/i;
export function teamTxt(v: string): string {
  const s = String(v || "").replace(/«\s*[-–•*·]\s*/g, "« ").replace(/\s*\.\s*»/g, " »");
  return s.replace(/\s*\(WhatsApp, ([^)]*)\)/g, (_all, w) => (REL.test(s) ? " (message du " + w + ")" : "")).trim();
}
// L'essentiel (même règle que les briefs de l'Espace, teamTime) : « nous atterrissons à 14h » → « atterrissage 14h » ;
// « Notre vol retour est à 9h. On partira de la villa (6h30) » → « 6h30 (vol 9h) ». Seulement une phrase citée dont
// chaque morceau a au plus une heure et un rôle clair ; sinon le texte nettoyé (teamTxt). Rien n'est calculé.
const TM_RX = /(?:\b(vers|around|about|approx\.?|environ)\s+)?(?:\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b|\b(\d{1,2})\s?(?:h(?!r)|:)\s?(\d{2})?(?!\d))/i;
const TM_FLY = /\b(atterri\w*|land(?:ing|s|ed)?|vols?|flights?|avion|plane|d[ée]coll\w*|take ?off|takes off)\b/i;
const TM_HOME: Record<string, RegExp> = { a: /\b(arriv\w*|villa|maison|house|chez vous|there|sur place)\b/i, d: /\b(parti\w*|partons|quitt\w*|leav\w*|check[- ]?out|d[ée]part\w*)\b/i };
function tmFmt(x: RegExpExecArray | null): string {
  if (!x) return "";
  let h = +(x[2] || x[5]);
  const mi = x[3] || x[6] || "";
  if (x[4]) { if (/p/i.test(x[4]) && h < 12) h += 12; if (/a/i.test(x[4]) && h === 12) h = 0; }
  if (h > 23 || (mi && +mi > 59)) return "";
  return (x[1] ? "vers " : "") + h + "h" + (mi && mi !== "00" ? mi : "");
}
export function teamTime(v: string, kind: "a" | "d"): string {
  const s = String(v || "").trim(), m = /^(?:Vol ([A-Z0-9]{2,3}\d{2,4}) · )?«\s*([^«»]+?)\s*»(?:\s*\(WhatsApp, [^)]*\))?$/.exec(s);
  if (!m || REL.test(m[2])) return teamTxt(s);
  const fly: string[] = [], home: string[] = [];
  const ok = (m[2].match(/[^.!?…\n,;]+[.!?…]*/g) || []).map((x) => x.trim()).filter(Boolean).every((cl) => {
    const all = cl.match(new RegExp(TM_RX.source, "gi")) || [];
    if (!all.length) return true;
    const t = all.length === 1 ? tmFmt(TM_RX.exec(cl)) : "";
    if (!t) return false;
    if (TM_FLY.test(cl)) fly.push(t); else if (TM_HOME[kind].test(cl)) home.push(t); else return false;
    return true;
  });
  if (!ok || (!fly.length && !home.length)) return teamTxt(s);
  const code = m[1] ? "vol " + m[1] : "";
  const f = fly.length ? (kind === "a" ? (code ? code + ", atterrissage " : "atterrissage ") : (code ? code + " " : "vol ")) + fly.join(", ") : code;
  return home.length ? home.join(", ") + (f ? " (" + f + ")" : "") : f;
}
// Même liste que l'Espace (espace.html, FIRM_OUT) : l'équipe voit les séjours que voit le propriétaire.
const FIRM_OUT = ["inquiry", "lead", "quoted", "declined", "cancelled", "canceled"];

export function validToken(k: unknown): k is string {
  return typeof k === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(k);
}
export async function sha256hex(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** « Tomas Herrera » → « Tomas H. » ; un seul mot → tel quel. */
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
const REPORT_KINDS = ["rooms_ready", "issue"];
/** Un retour de l'équipe, nettoyé : genre connu, séjour parmi ceux qu'elle voit, texte court. null si rien à garder. */
export function cleanReport(body: Row, visibleIds: string[]): { kind: string; client_id: string | null; text: string | null } | null {
  const kind = String(body.kind || "");
  if (!REPORT_KINDS.includes(kind)) return null;
  const cid = body.client_id == null || body.client_id === "" ? null : String(body.client_id);
  if (cid && !visibleIds.includes(cid)) return null;
  const text = txt(body.text, 300).replace(/\s+/g, " ") || null;
  if (kind === "rooms_ready" && !cid) return null;
  if (kind === "issue" && !text) return null;
  return { kind, client_id: cid, text };
}
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now); hits.set(key, recent);
  return recent.length > max;
}
export function extrasLine(o: unknown): string {
  const items = o && typeof o === "object" && Array.isArray((o as Row).items) ? (o as Row).items : [];
  return items.filter((x: Row) => x && x.kind === "extra" && Number.isInteger(x.q) && x.q > 0)
    .map((x: Row) => x.q + " × " + String(Array.isArray(x.n) ? x.n[0] : x.n || "").trim().slice(0, 80)).join(" · ").slice(0, 300);
}
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
      const base = {
        id: String(c.id || ""), name: shortName(c.name), a: iso(a), d: iso(d), nights: d - a,
        adults, children, infants, pax: pax || null,
        arrival_time: teamTime(txt(det.arrival_time, 300), "a"), departure_time: teamTime(txt(det.departure_time, 300), "d"), beds: txt(det.beds, 300),
        meals: txt(c.meals, 600), drinks: txt(det.drinks, 600), note: txt(det.staff_note, 600),
        // Extras commandés par le client dans son livret (transfert, massage…) : quoi et combien, jamais le prix.
        extras: extrasLine(det.guest_orders),
        same_day: departures.has(a),
      };
      return { ...base, lines: linesOf(base) };
    });
}

// ── Arabe (18/10/2026) ───────────────────────────────────────────────────
export const AR_MAX_CHARS = 6000; // au-delà, le reste attend le passage suivant (le français s'affiche entre-temps)
const SYS_AR = "Tu traduis en arabe, pour le personnel d'une maison d'hôtes au Maroc (arabe standard simple, compris à Marrakech), des lignes écrites en français par le propriétaire : repas, consignes, boissons, heures, couchages. " +
  "Règles : une ligne traduite par ligne reçue, dans le même ordre ; ne rien ajouter, ne rien résumer, ne rien commenter ; garder les chiffres, les quantités, les heures (écris-les 14:00, 6:30), les prénoms, les marques et les noms de plats (tajine, msemen, pastilla, kefta) tels quels ou translittérés ; une ligne déjà en arabe ou sans texte reste identique. " +
  "Réponds UNIQUEMENT par un objet JSON {\"lines\": {\"<id>\": \"<traduction>\"}} avec exactement les mêmes id.";
export async function hashOf(s: string): Promise<string> { return (await sha256hex(s)).slice(0, 16); }
/** Ce qui manque au cache : une entrée par (séjour, champ) dont le texte a changé ou n'a jamais été traduit. */
export function missingAr(stays: StaffStay[], cache: Row[], hashes: Record<string, string>): { id: string; field: keyof Lines; lines: string[] }[] {
  const have = new Map(cache.map((r) => [r.client_id + "|" + r.field, r]));
  const out: { id: string; field: keyof Lines; lines: string[] }[] = [];
  for (const s of stays) for (const f of LINE_FIELDS) {
    const src = s.lines[f]; if (!src.length) continue;
    const r = have.get(s.id + "|" + f);
    if (r && r.src_hash === hashes[s.id + "|" + f] && Array.isArray(r.lines) && r.lines.length === src.length) continue;
    out.push({ id: s.id, field: f, lines: src });
  }
  return out;
}
/** Un seul appel Mistral pour toutes les lignes manquantes ; lignes alignées par id « <séjour>|<champ>|<n> ». null si rien, en panne, ou pas de clé. */
export async function translateAr(items: { id: string; field: keyof Lines; lines: string[] }[], call = mistral): Promise<Record<string, string> | null> {
  const req: Record<string, string> = {}; let chars = 0;
  for (const it of items) for (let i = 0; i < it.lines.length; i++) { if (chars + it.lines[i].length > AR_MAX_CHARS) break; req[it.id + "|" + it.field + "|" + i] = it.lines[i]; chars += it.lines[i].length; }
  if (!Object.keys(req).length) return null;
  const raw = await call(SYS_AR, JSON.stringify({ lines: req })).catch((e) => { console.error("[staff-view] ar call", String(e).slice(0, 120)); return null; });
  if (!raw) return null;
  let j: Row = {}; try { j = JSON.parse(raw); } catch { console.error("[staff-view] ar json", raw.slice(0, 160)); return null; }
  const got = j && typeof j.lines === "object" && j.lines ? j.lines : null; if (!got) { console.error("[staff-view] ar shape", raw.slice(0, 160)); return null; }
  const out: Record<string, string> = {};
  for (const k of Object.keys(req)) { const v = got[k]; if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 500); }
  console.log("[staff-view] ar", Object.keys(req).length, "demandées,", Object.keys(out).length, "reçues");
  return out;
}
// Comme ai-proxy : plusieurs modèles. Deux passes : chaque modèle une fois (un 429 — limite de débit du compte Mistral —
// passe tout de suite au suivant), puis, si rien n'a répondu, une pause et une seconde passe. Un modèle refusé (403) est sauté.
// Vu le 18/10 : medium et small en 429 persistant sur ce compte, ministral-14b répond — d'où la seconde passe plutôt que des attentes.
export const AR_MODELS = ["mistral-medium-latest", "mistral-small-latest", "ministral-14b-2512"];
const AR_BUDGET_MS = 14000;
async function mistral(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get("MISTRAL_API_KEY"); if (!key) { console.error("[staff-view] ar: MISTRAL_API_KEY absente"); return null; }
  const t0 = Date.now(), tries: string[] = [], skip = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((ok) => setTimeout(ok, 1500));
    for (const model of AR_MODELS) {
      if (skip.has(model)) continue;
      const left = AR_BUDGET_MS - (Date.now() - t0); if (left < 2500) break;
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), Math.min(left, 10000));
      try {
        const r = await fetch("https://api.mistral.ai/v1/chat/completions", { method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
        if (r.ok) {
          const j = await r.json();
          const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
          if (txt) { if (tries.length) console.log("[staff-view] ar ok", model, "après", tries.join(", ")); return txt; }
          tries.push(model + " vide");
        } else {
          const err = (await r.text().catch(() => "")).slice(0, 120);
          tries.push(model + " " + r.status);
          if (r.status === 403 || r.status === 404 || r.status === 400) { skip.add(model); console.error("[staff-view] ar mistral", model, r.status, err); }
          else if (r.status !== 429) console.error("[staff-view] ar mistral", model, r.status, err);
        }
      } catch (e) { tries.push(model + " " + String(e).slice(0, 40)); } finally { clearTimeout(tm); }
    }
  }
  console.error("[staff-view] ar: aucune réponse —", tries.join(", "));
  return null;
}
/** Pose `ar` sur chaque séjour : lignes du cache, complétées par la traduction du jour (écrite au cache). Jamais d'erreur : sans traduction, pas de `ar`. */
export async function withArabic(stays: StaffStay[], owner: string, read: (ids: string[]) => Promise<Row[]>, write: (rows: Row[]) => Promise<void>, call = mistral): Promise<StaffStay[]> {
  if (!stays.length) return stays;
  const hashes: Record<string, string> = {};
  for (const s of stays) for (const f of LINE_FIELDS) if (s.lines[f].length) hashes[s.id + "|" + f] = await hashOf(s.lines[f].join("\n"));
  const cache = await read(stays.map((s) => s.id)).catch((e) => { console.error("[staff-view] ar read", String(e).slice(0, 120)); return [] as Row[]; });
  const miss = missingAr(stays, cache, hashes);
  const fresh = miss.length ? await translateAr(miss, call) : null;
  const rows: Row[] = [];
  if (fresh) for (const it of miss) {
    const lines = it.lines.map((_x, i) => fresh[it.id + "|" + it.field + "|" + i]);
    if (lines.every((x) => typeof x === "string")) rows.push({ owner_id: owner, client_id: it.id, lang: "ar", field: it.field, src_hash: hashes[it.id + "|" + it.field], lines, updated_at: new Date().toISOString() });
  }
  if (rows.length) await write(rows).catch((e) => console.error("[staff-view] ar write", String(e).slice(0, 120)));
  const all = cache.filter((r) => hashes[r.client_id + "|" + r.field] === r.src_hash).concat(rows);
  return stays.map((s) => {
    const ar: Partial<Lines> = {};
    for (const r of all) if (r.client_id === s.id && LINE_FIELDS.includes(r.field) && Array.isArray(r.lines) && r.lines.length === s.lines[r.field as keyof Lines].length) ar[r.field as keyof Lines] = r.lines;
    return Object.keys(ar).length ? { ...s, ar } : s;
  });
}

// ── Service ───────────────────────────────────────────────────────────────
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error("db " + r.status);
  const body = await r.text(); // 201/204 avec Prefer: return=minimal → corps vide
  return body ? JSON.parse(body) : null;
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
    const rows = await db(`crm_clients?select=id,name,arrival,departure,guests,adults,children,infants,booking_status,meals,details` +
      `&user_id=eq.${link.owner_id}&deleted_at=is.null&departure=gte.${iso(t - 1)}&arrival=lte.${iso(t + WINDOW_DAYS)}&order=arrival.asc&limit=200`) || [];
    let stays = staffView(rows, todayIso);
    if (body.action === "report") {
      if (limited("r:" + link.id, 30, 60 * 60000)) return out({ error: "rate_limited" }, 429);
      const rep = cleanReport(body, stays.map((s) => s.id));
      if (!rep) return out({ error: "invalid_report" }, 400);
      const ins = await db(`staff_reports`, { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ owner_id: link.owner_id, link_id: link.id, client_id: rep.client_id, kind: rep.kind, text: rep.text }) });
      const row = Array.isArray(ins) ? ins[0] : ins;
      return out({ ok: true, report: { id: row?.id, kind: rep.kind, client_id: rep.client_id, text: rep.text, created_at: row?.created_at } });
    }
    // « Ouvert » (18/10/2026) : last_seen_at + une ligne staff_link_opens, au plus toutes les 30 min. Le propriétaire qui
    // ouvre le lien sur un appareil où il est connecté à Stafflo (body.owner, envoyé par equipe.html) ne compte pas :
    // la question est « quand la personne de l'équipe regarde sa page », pas « quand j'ai vérifié le lien ».
    if (body.owner !== true && (!link.last_seen_at || Date.now() - Date.parse(link.last_seen_at) > 30 * 60000)) {
      await db(`staff_links?id=eq.${link.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_seen_at: new Date().toISOString() }) }).catch(() => {});
      await db(`staff_link_opens`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner_id: link.owner_id, link_id: link.id }) }).catch(() => {});
    }
    // Les retours récents de CE lien (7 jours) : « chambres prêtes » déjà envoyé reste coché.
    const reports = await db(`staff_reports?select=id,kind,client_id,text,created_at&link_id=eq.${link.id}&deleted_at=is.null&created_at=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&order=created_at.desc&limit=50`).catch(() => []) || [];
    // Arabe : la langue affichée par la page (body.lang), sinon celle du lien. Cache staff_i18n, un appel Mistral pour ce qui manque.
    const lang = body.lang === "ar" || body.lang === "fr" ? body.lang : link.lang;
    if (lang === "ar") {
      stays = await withArabic(stays, String(link.owner_id), (ids) => db(`staff_i18n?select=client_id,field,src_hash,lines&owner_id=eq.${link.owner_id}&lang=eq.ar&client_id=in.(${ids.map((x) => '"' + encodeURIComponent(x) + '"').join(",")})&limit=500`).then((r: Row[] | null) => r || []),
        (rws) => db(`staff_i18n?on_conflict=client_id,lang,field`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rws) }).then(() => {})).catch(() => stays);
    }
    return out({ name: link.name, lang: link.lang, today: todayIso, stays, reports, at: new Date().toISOString() });
  } catch (_e) {
    return out({ error: "unavailable" }, 503);
  }
});
