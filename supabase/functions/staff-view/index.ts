// staff-view — la vue équipe (equipe.html) : arrivées, départs, composition des
// groupes, heure d'arrivée, couchages, repas et consigne, pour Saïd, Bouchra ou
// la cuisinière. Sans compte : chaque personne a un lien personnel.
//
// POST { k } → { name, lang, today, stays, reports }
//   k = jeton du lien (jamais stocké : seule son empreinte sha-256 est en base,
//       table staff_links). Un lien retiré (deleted_at) ne répond plus.
// POST { k, action: "report", kind, client_id?, text? } → { ok, report }
//   L'équipe renvoie quelque chose (table staff_reports) : « chambres prêtes » pour un
//   séjour (kind rooms_ready, client_id d'un séjour visible), « repas confirmés » (kind
//   meals_ok, lien prestataire), ou un problème (kind issue, texte ≤ 300). Le propriétaire
//   le voit dans l'Espace et reçoit une alerte. 30 par heure et par lien. Rien d'autre
//   n'est modifiable depuis ce lien.
//
// Lien prestataire (20/10/2026, staff_links.role = 'kitchen' — Lea, le prestataire repas) :
//   la même page, mais ce qui le concerne : couverts, repas et commande du livret jour par
//   jour (ses repas seulement — un repas « maison » de la fiche lui est montré « préparé par
//   la maison, pas par vous »), heures d'arrivée et de départ, interlocation (la prochaine
//   arrivée après chaque départ, « le jour même »), consigne. Jamais couchages, boissons,
//   extras. Le lien maison (role 'house', défaut) garde tout ce qu'il avait, plus les repas
//   « maison » commandés dans le livret (house_orders) et la prochaine arrivée (next).
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
// 20/10/2026 : même chose en français (`fr`) pour ce que le client a écrit dans une autre langue ; la traduction de ce
// qui manque part en arrière-plan (waitUntil), la réponse dit `pending` et la page se recharge quelques secondes après.
// 22/10/2026 : troisième langue, l'anglais (`en`, body.lang ou lang du lien) — tout ce qui n'est pas en anglais est traduit
// (le français du propriétaire compris), même cache staff_i18n, même règle zéro invention. La page lit FR · EN · عربية.

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

// ── Calcul (pur, testé par tests/evals-staff.mjs) ─────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
export type Lines = { arrival_time: string[]; departure_time: string[]; beds: string[]; meals: string[]; drinks: string[]; note: string[]; extras: string[]; orders: string[]; house_orders: string[]; next_time: string[] };
export type StaffStay = {
  id: string; name: string; a: string; d: string; nights: number;
  adults: number | null; children: number | null; infants: number | null; pax: number | null;
  arrival_time: string; departure_time: string; beds: string; meals: string; drinks: string; note: string; extras: string; same_day: boolean;
  /* 20/10 : commande du livret jour par jour — repas du prestataire (orders) et repas « maison » (house_orders), une ligne par
     repas ; la prochaine arrivée après ce départ (next : date, « le jour même ») et son heure (next_time), pour l'interlocation. */
  orders: string; house_orders: string; next: { d: string; same_day: boolean } | null; next_time: string;
  lines: Lines; ar?: Partial<Lines>; fr?: Partial<Lines>;
};
export type LinkRole = "house" | "kitchen";
// ── Lisibilité : une phrase par ligne (repas, consigne), un article par ligne (boissons, extras) — mêmes règles que l'Espace ──
// 20/10 (parcours réel) : « ven. 23 midi, sam. 24 soir » n'est pas trois phrases — le point d'une abréviation (jour, mois, env., min.) ne coupe pas.
const ABBR_RX = /(?:^|[\s(—–-])(?:lun|mar|mer|jeu|ven|sam|dim|janv|f[ée]vr|avr|juil|sept|oct|nov|d[ée]c|env|approx|min|max|tel|t[ée]l|etc)\.$/i;
export function sentences(line: string): string[] { // coupe après « . ! ? » suivis d'une majuscule ou d'un chiffre
  const out: string[] = []; let last = 0; const rx = /[.!?]\s+(?=[A-ZÀ-ÝÉÈÊ0-9«])/g; let m: RegExpExecArray | null;
  while ((m = rx.exec(line))) { if (line[m.index] === "." && ABBR_RX.test(line.slice(last, m.index + 1))) continue; out.push(line.slice(last, m.index + 1)); last = m.index + m[0].length; }
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
// 19/10 (mêmes règles que l'Espace) : un menu d'un bloc (« Entrées - … Plats - … Desserts - … ») → une ligne par plat ;
// « Pour les boissons, serait-il possible d'avoir : … » → les boissons seules (introduction de 3 mots ou plus, sans chiffre).
const COURSE_RX = /\s+(?=(?:Starters?|Mains?|Main courses?|Desserts?|Entr[ée]es?|Plats?(?: principaux)?|Boissons|Drinks)\s*[-–:]\s)/; // majuscule : « …, semoule ; dessert : pâtisseries » reste avec son dîner
function colonAt(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && !depth && !(/\d/.test(line[i - 1] || "") && /\d/.test(line[i + 1] || ""))) return i;
  }
  return -1;
}
const isIntro = (t: string) => { t = String(t || "").trim(); return t.split(/\s+/).length >= 3 && !/\d/.test(t); };
export function bulletsOf(text: string, mode: "list" | "sentences"): string[] {
  const raw = String(text || "").trim(); if (!raw) return [];
  const parts: string[] = [], lns = raw.split(/\n+/);
  lns.forEach((ln, li) => {
    let line = ln.replace(/^\s*[-•*·]\s*/, "").trim(); if (!line) return;
    if (mode === "list") {
      const ci = colonAt(line);
      if (ci > 0 && isIntro(line.slice(0, ci))) {
        const rest = line.slice(ci + 1).trim();
        if (rest) line = rest; else if (li < lns.length - 1) return;
      }
      listItems(line).forEach((x) => parts.push(x));
    } else line.split(/\s+·\s+/).forEach((seg) => sentences(seg).forEach((x) => x.split(COURSE_RX).forEach((y) => { if (y.trim()) parts.push(y.trim()); }))); // « · » sépare des éléments (résumé de commande du livret), jamais une phrase
  });
  return parts.map((x) => x.slice(0, 400));
}
/** 20/10 : le résumé que le livret écrit dans « repas » reprend les lignes de la commande ; une ligne déjà montrée à part (orders / house_orders) n'est pas répétée sous Repas. */
const orderKey = (x: string) => String(x || "").toLowerCase().replace(/\s*\((?:sur demande|on request)\)/g, "").replace(/\s+/g, " ").trim();
export function orderDedup(lines: string[], drop: string[]): string[] {
  if (!drop.length) return lines;
  const set = new Set(drop.map(orderKey));
  return lines.filter((x) => !set.has(orderKey(x)));
}
export const LINE_FIELDS: (keyof Lines)[] = ["arrival_time", "departure_time", "beds", "meals", "drinks", "note", "extras", "orders", "house_orders", "next_time"];
const nl = (t: string) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
export function linesOf(s: Omit<StaffStay, "lines">): Lines {
  return { arrival_time: s.arrival_time ? [s.arrival_time] : [], departure_time: s.departure_time ? [s.departure_time] : [], beds: s.beds ? [s.beds] : [],
    meals: bulletsOf(s.meals, "sentences"), drinks: bulletsOf(s.drinks, "list"), note: bulletsOf(s.note, "sentences"), extras: s.extras ? s.extras.split(" · ").map((x) => x.trim()).filter(Boolean) : [],
    orders: nl(s.orders), house_orders: nl(s.house_orders), next_time: s.next_time ? [s.next_time] : [] };
}
/** Ce qu'un lien ne doit pas voir, selon son rôle (20/10) : vidé AVANT toute traduction, rien ne part. Prestataire : ni couchages,
 *  ni boissons, ni extras. Maison : pas la commande du prestataire (elle a la sienne, house_orders, et les extras). */
export function forRole(stays: StaffStay[], role: LinkRole): StaffStay[] {
  const drop: (keyof Lines)[] = role === "kitchen" ? ["beds", "drinks", "extras"] : ["orders"];
  return stays.map((s) => {
    const o: StaffStay = { ...s, lines: { ...s.lines } };
    for (const f of drop) { (o as Row)[f] = ""; o.lines[f] = []; }
    // les lignes de commande montrées à part ne se répètent pas sous Repas (prestataire : les siennes et celles de la maison ; maison : les siennes)
    o.lines.meals = orderDedup(o.lines.meals, role === "kitchen" ? s.lines.orders.concat(s.lines.house_orders) : s.lines.house_orders);
    return o;
  });
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
// 19/10 : « la plupart du groupe arrivera après 21h » ne dit pas l'heure de tout le groupe — la phrase reste entière.
const TM_PART = /\b(most|some|part|half|rest|others?|la plupart|certain(?:e)?s|une partie|la moiti[ée]|les autres|le reste|majorit[ée])\b/i;
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
  if (!m || REL.test(m[2]) || TM_PART.test(m[2])) return teamTxt(s);
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

// Fuseau de la villa (22/10/2026) : même table que push-notify (tzFor). Avant : « Africa/Casablanca » en dur, faux pour
// toute villa hors du Maroc (le pilote est au Maroc : inchangé pour lui). Pays inconnu → "" : la page garde le jour du téléphone.
const TZ: [RegExp, string][] = [
  [/\b(maroc|morocco)\b/, "Africa/Casablanca"], [/\bfrance\b/, "Europe/Paris"], [/\bportugal\b/, "Europe/Lisbon"],
  [/\b(espagne|spain|espana)\b/, "Europe/Madrid"], [/\b(italie|italy|italia)\b/, "Europe/Rome"], [/\b(grece|greece)\b/, "Europe/Athens"],
  [/\b(royaume-uni|united kingdom|uk|england|angleterre)\b/, "Europe/London"], [/\b(suisse|switzerland)\b/, "Europe/Zurich"],
  [/\b(belgique|belgium)\b/, "Europe/Brussels"], [/\b(croatie|croatia)\b/, "Europe/Zagreb"], [/\b(turquie|turkey|turkiye)\b/, "Europe/Istanbul"],
  [/\b(tunisie|tunisia)\b/, "Africa/Tunis"], [/\b(thailande|thailand)\b/, "Asia/Bangkok"], [/\b(indonesie|indonesia|bali)\b/, "Asia/Makassar"],
  [/\b(maurice|mauritius)\b/, "Indian/Mauritius"], [/\b(emirats|uae|united arab emirates|dubai)\b/, "Asia/Dubai"],
  [/\b(afrique du sud|south africa)\b/, "Africa/Johannesburg"], [/\b(mexique|mexico)\b/, "America/Mexico_City"],
];
export function villaTz(country: unknown, city: unknown): string {
  const k = (String(country || "") + " " + String(city || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [re, tz] of TZ) if (re.test(k)) return tz;
  return "";
}
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(now);
}
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
  // Séjour créé depuis un calendrier (ical-sync, 21/10) : le nom est encore le code de réservation — pour l'équipe, « ? ».
  if (!p.length || (p.length === 1 && /^HM[A-Z0-9]{8}$/.test(p[0])) || (p.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(p[1]))) return "?";
  return p.length > 1 ? p[0] + " " + p[p.length - 1].charAt(0).toUpperCase() + "." : p[0];
}
const day = (iso: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
};
const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** 19/10 : ce que le client a écrit dans une autre langue, traduit en français par l'Espace (details.fr[k] = {src, fr}) — tant que l'original n'a pas changé. */
export function frv(det: Row, k: string, src: unknown): unknown {
  const s = typeof src === "string" ? src.trim() : "", e = det && det.fr && typeof det.fr === "object" ? det.fr[k] : null;
  return s && e && typeof e.fr === "string" && e.fr.trim() && e.src === s ? e.fr : src;
}
const REPORT_KINDS = ["rooms_ready", "issue", "meals_ok"];
/** Un retour de l'équipe, nettoyé : genre connu, séjour parmi ceux qu'elle voit, texte court. null si rien à garder. */
export function cleanReport(body: Row, visibleIds: string[]): { kind: string; client_id: string | null; text: string | null } | null {
  const kind = String(body.kind || "");
  if (!REPORT_KINDS.includes(kind)) return null;
  const cid = body.client_id == null || body.client_id === "" ? null : String(body.client_id);
  if (cid && !visibleIds.includes(cid)) return null;
  const text = txt(body.text, 300).replace(/\s+/g, " ") || null;
  if ((kind === "rooms_ready" || kind === "meals_ok") && !cid) return null;
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
// 22/10 : un extra daté dit son jour et son moment (« 2 × Massage 60 min — mer. 21 après-midi ») ; « (2 par créneau) » quand
// le même nombre revient sur plusieurs cases. Toujours sans prix.
export function extrasLine(o: unknown): string {
  const items = o && typeof o === "object" && Array.isArray((o as Row).items) ? (o as Row).items : [];
  return items.filter((x: Row) => x && x.kind === "extra" && Number.isInteger(x.q) && x.q > 0)
    .map((x: Row) => { const w = whenTxt(x.when), cells = Array.isArray(x.when) ? x.when.length : 0;
      return x.q + " × " + String(Array.isArray(x.n) ? x.n[0] : x.n || "").trim().slice(0, 80) + (w ? " — " + w : "") + (cells > 1 && Number(x.per) > 1 ? " (" + x.per + " par créneau)" : ""); })
    .join(" · ").slice(0, 600);
}
const int = (v: unknown): number | null => (v == null || v === "" || !isFinite(+v) || +v < 0 ? null : Math.round(+v));

// ── Commande du livret, par destinataire (20/10/2026 — mêmes règles que l'Espace : orderSplit, houseMeal, bigMode) ──
// Un repas commandé (details.guest_orders.items, id m<i> → MEALS[i] de la fiche) va au prestataire, sauf s'il est marqué
// « maison » dans la fiche (house) — et, à partir de 7 personnes, selon big : 'house' (la maison), 'kitchen' (le prestataire),
// 'off' (plus proposé : absent). Une ligne par repas : « 2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi ». Sans fiche :
// tout au prestataire. Les extras ne sont pas des repas (extrasLine).
const SVC: Record<string, string> = { b: "brunch", l: "midi", d: "soir", am: "matin", pm: "après-midi", ev: "soir" }; // am/pm/ev : extras datés (22/10)
export function whenTxt(w: unknown): string {
  return (Array.isArray(w) ? w : []).filter((x: Row) => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.d || ""))).map((x: Row) =>
    new Date(x.d + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" }) + (SVC[x.s] ? " " + SVC[x.s] : "")).join(", ");
}
const mealName = (n: unknown) => String(Array.isArray(n) ? n[0] : n || "").replace(/\s*\((?:sur demande|on request)\)\s*$/i, "").trim().slice(0, 80);
export function orderLines(o: unknown, facts: Row | null, pax: number | null): { kitchen: string[]; house: string[] } {
  const out = { kitchen: [] as string[], house: [] as string[] };
  const items = o && typeof o === "object" && Array.isArray((o as Row).items) ? (o as Row).items : [];
  const meals: Row[] = facts && Array.isArray(facts.MEALS) ? facts.MEALS : [];
  for (const x of items) {
    if (!x || x.kind !== "meal" || !Number.isInteger(x.q) || x.q <= 0) continue;
    const m = /^m(\d+)$/.exec(String(x.id || "")), row = m ? meals[+m[1]] : null;
    const big = row && (row.big === "kitchen" || row.big === "off") ? row.big : "house";
    let to: "kitchen" | "house" = "kitchen";
    if (row && row.house) { if (pax != null && pax >= 7) { if (big === "off") continue; to = big === "kitchen" ? "kitchen" : "house"; } else to = "house"; }
    const w = whenTxt(x.when), line = x.q + " × " + mealName(x.n) + (w ? " — " + w : "");
    if (out[to].length < 20) out[to].push(line.slice(0, 200));
  }
  return out;
}

export function staffView(rows: Row[], todayIso: string, facts: Row | null = null): StaffStay[] {
  const t = day(todayIso);
  if (t == null) return [];
  const firm = (rows || []).filter((c) => !FIRM_OUT.includes(String(c.booking_status || "").toLowerCase()))
    .map((c) => ({ c, a: day(c.arrival), d: day(c.departure) }))
    .filter((x) => x.a != null && x.d != null && (x.d as number) > (x.a as number)) as { c: Row; a: number; d: number }[];
  const departures = new Set(firm.map((x) => x.d));
  const detOf = (c: Row) => (c.details && typeof c.details === "object" ? c.details : {});
  // Interlocation (20/10) : le premier séjour ferme qui commence le jour de ce départ ou après (même règle que le brief de l'Espace).
  const nextOf = (d: number) => firm.filter((x) => x.a >= d).sort((x, y) => x.a - y.a)[0] || null;
  return firm
    .filter((x) => x.d >= t && x.a <= t + WINDOW_DAYS)
    .sort((x, y) => x.a - y.a)
    .map(({ c, a, d }) => {
      const det = detOf(c);
      const adults = int(c.adults), children = int(c.children), infants = int(c.infants);
      const pax = adults != null || children != null ? (adults || 0) + (children || 0) : int(c.guests);
      const ord = orderLines(det.guest_orders, facts, pax || null), nx = nextOf(d);
      const base = {
        id: String(c.id || ""), name: shortName(c.name), a: iso(a), d: iso(d), nights: d - a,
        adults, children, infants, pax: pax || null,
        arrival_time: teamTime(txt(frv(det, "arrival_time", det.arrival_time), 400), "a"), departure_time: teamTime(txt(frv(det, "departure_time", det.departure_time), 400), "d"),
        beds: txt(frv(det, "beds", det.beds), 400), meals: txt(frv(det, "meals", c.meals), 1500), drinks: txt(frv(det, "drinks", det.drinks), 800), note: txt(det.staff_note, 1200),
        // Extras commandés par le client dans son livret (transfert, massage…) : quoi et combien, jamais le prix.
        extras: extrasLine(det.guest_orders),
        same_day: departures.has(a),
        orders: ord.kitchen.join("\n"), house_orders: ord.house.join("\n"),
        next: nx ? { d: iso(nx.a), same_day: nx.a === d } : null,
        next_time: nx ? teamTime(txt(frv(detOf(nx.c), "arrival_time", detOf(nx.c).arrival_time), 400), "a") : "",
      };
      return { ...base, lines: linesOf(base) };
    });
}

// ── Traductions de la vue équipe (18/10/2026, revu le 20/10) ─────────────────────────
// Une page, une seule langue. En arabe : tout en darija marocaine. En français : ce que le client a écrit dans une autre
// langue (souvent l'anglais) est traduit en français — jusqu'au 20/10 il ne l'était que si le propriétaire avait ouvert
// le brief dans l'Espace (details.fr), d'où des lignes en anglais sur le lien de Saïd (cas réel : Seán).
// Cache staff_i18n par (séjour, langue, champ) et empreinte du texte : un texte inchangé ne repasse jamais par l'IA.
// 20/10 : la traduction ne bloque plus la réponse. Constat (journaux du 20/10, 8 ouvertures) : medium et small en 429
// permanent sur ce compte, ministral-14b coupé à 10 s sur un seul gros appel (repas de Seán + Thibaut) → rien de traduit,
// jamais. Désormais : ce qui est en cache part tout de suite ; ce qui manque est traduit en arrière-plan (waitUntil), par
// morceaux d'environ 1 800 caractères, ministral d'abord (le modèle qui répond), chaque morceau écrit au cache dès qu'il
// arrive ; la page reçoit `pending` et se recharge quelques secondes plus tard.
export const AR_MAX_CHARS = 6000; // un appel : au-delà, le reste part dans l'appel suivant (jamais une ligne coupée)
export const TR_CHUNK = 1800;
export type TrLang = "ar" | "fr" | "en"; // 22/10 : anglais (équipe qui ne lit ni le français ni la darija)
// 19/10/2026 : darija marocaine (« en arabe marocain tout doit être en arabe marocain »), plus l'arabe standard. Exemples
// tirés des essais réels (ministral-14b) : sans eux, futur égyptien (« هتصلو »), « décaféiné » → « sans café ».
// 20/10 (essai réel, ministral-14b) : « marocain » → « موريتاني » (mauritanien !), « Starters » → « مودع », « Pas d'entrées »
// → « مايكونش مودع », « la cuisinière repart » → « الطاهية غادي تنصرو » — d'où des exemples tirés de ces phrases mêmes.
const SYS_AR = "Tu traduis en darija marocaine — écrite en lettres arabes, comme dans un message WhatsApp entre Marocains ; pas l'arabe standard, pas l'égyptien : le futur se dit « غادي » — " +
  "pour l'équipe d'une maison d'hôtes à Marrakech, des lignes écrites en français ou dans la langue du client (souvent l'anglais) : repas, consignes, boissons, heures, couchages, commande du livret (« 2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi » → « 2 × الغدا ولا العشا — الأربعاء 21 العشية، الخميس 22 الغدا »). " +
  "« marocain, marocaine, Moroccan » se dit « مغربي, مغربية » (jamais موريتاني). " +
  "Exemples : « atterrissage 14h » → « وصول الطيارة 14:00 » ; « 6h30 (vol 9h) » → « 6:30 (الطيارة 9:00) » ; « Most of the group will arrive late (after 9pm) » → « أغلبية المجموعة غادي يوصلو معطلين (من بعد 21:00) » ; " +
  "« 2 couples et 1 personne seule » → « 2 كوبلات و 1 بوحدو » ; « thé et café décaféinés » → « أتاي و قهوة بلا كافيين » ; « iced tea » → « أتاي بارد » ; « eaux » → « الما » ; " +
  "« Mercredi 21, dîner vers 19h30 : tajine de kefta » → « نهار الأربعاء 21، العشا تقريبا مع 19:30 : طاجين ديال الكفتة » ; « dessert : assortiment de pâtisseries marocaines » → « الديسير : حلويات مغربية منوعة » ; " +
  "« Starters - mechouia salad » → « المقبلات - شلاضة مشوية » ; « Mains - lamb tajine » → « الأطباق - طاجين ديال لحم الغنمي » ; « Desserts - gazelle horns » → « الديسير - كعب غزال » ; « un goûter au bord de la piscine » → « أتاي ديال العشية حدا البيسين » ; " +
  "« Pas d'entrées. » → « بلا مقبلات. » ; « Pas d'allergie. » → « ما كاين حتى حساسية. » ; « Départ vendredi 23 à 6h30 » → « الخروج نهار الجمعة 23 مع 6:30 » ; « la cuisinière repart à 20h, Saïd sert et débarrasse » → « الطباخة غادي تمشي مع 20:00، سعيد هو اللي غادي يسربي و يهز الطبلة » ; " +
  "« Would it be possible to do this around 2pm? » → « واش ممكن نديروها تقريبا مع 14:00؟ » ; « semoule en accompagnement » → « مع السميدة » ; « frites maison » → « فريت ديال الدار » ; « pumpkin salad with cinnamon » → « شلاضة ديال القرعة بالقرفة » ; « 12 eaux plates, 6 eaux gazeuses » → « 12 ديال الما العادي، 6 ديال الما الغازي ». " +
  "Règles : une ligne traduite par ligne reçue ; ne rien ajouter, ne rien résumer, ne rien commenter, pas de mise en forme ; tous les nombres restent en chiffres (0-9), exactement ceux de l'original ; les heures s'écrivent 14:00, 6:30 ; " +
  "prénoms, marques et noms de plats (tajine, msemen, pastilla, kefta, zaalouk, chermoula) tels quels ou translittérés ; une ligne déjà en arabe ou sans texte reste identique. " +
  "Réponds UNIQUEMENT par un objet JSON {\"lines\": {\"<id>\": \"<traduction>\"}} avec exactement les mêmes id.";
// 20/10 : même consigne que l'Espace (SYS_FR_FIELDS) — ce que le client a écrit, en français simple et fidèle.
const SYS_FR = "Tu traduis en français des lignes écrites par un client (dans sa langue, souvent l'anglais) pour l'équipe d'une maison d'hôtes à Marrakech : repas, boissons, couchages, heures d'arrivée. " +
  "Traduis chaque ligne en français simple et fidèle : ne rien ajouter, ne rien résumer, ne rien retirer, ne rien commenter, pas de mise en forme (pas de gras). " +
  "Garde tous les nombres en chiffres (jours, dates, quantités, heures — 9pm devient 21h), les prénoms, les marques, les noms de plats (tajine, zaalouk, pastilla, msemen, chermoula) et les tirets qui séparent les plats ; garde les guillemets « » s'il y en a. " +
  "Une ligne déjà en français est renvoyée telle quelle. Réponds UNIQUEMENT par un objet JSON {\"lines\": {\"<id>\": \"<traduction>\"}} avec exactement les mêmes id.";
// 22/10 : anglais — pour une équipe qui ne lit ni le français ni la darija (villa hors du Maroc). Mêmes règles : rien d'ajouté, nombres gardés.
const SYS_EN = "You translate into plain, faithful English lines written in French (by the owner, for the team) or in the guest's language, for the team of a guest house: meals, drinks, beds, arrival and departure times, instructions, booklet orders (« 2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi » → « 2 × Lunch or dinner — Wed 21 evening, Thu 22 lunch »). " +
  "Translate each line into simple English: add nothing, summarise nothing, remove nothing, no comments, no formatting (no bold). " +
  "Keep every number as digits (days, dates, quantities, times — 14h becomes 14:00, 6h30 becomes 06:30), first names, brands, dish names (tajine, zaalouk, pastilla, msemen, chermoula, kefta) and the dashes separating dishes; keep « » quotes if present. " +
  "A line already in English is returned unchanged. Answer ONLY with a JSON object {\"lines\": {\"<id>\": \"<translation>\"}} with exactly the same ids.";
const SYS: Record<TrLang, string> = { ar: SYS_AR, fr: SYS_FR, en: SYS_EN };
/** Version de la traduction, dans l'empreinte : la changer refait le cache (19/10 : arabe standard → darija). */
export const AR_V = "darija-3|"; // 20/10 : exemples ajoutés (« marocain » ≠ « موريتاني »), seconde chance des nombres → retraduit une fois
export const TR_V: Record<TrLang, string> = { ar: AR_V, fr: "fr-1|", en: "en-1|" };
// Zéro invention : les nombres d'une ligne traduite sont exactement ceux de l'original (chiffres arabes orientaux compris,
// « 9pm » = 21 ; 0 et 1 ne comptent pas : « 14h » / « 14:00 », « un » / « 1 ») — sinon la ligne reste dans sa langue d'origine.
const NUM_W: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, deux: 2, trois: 3, quatre: 4, cinq: 5, huit: 8, dix: 10, onze: 11, douze: 12 };
export function numsOf(t: string): string {
  let s = String(t || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
  s = s.replace(/\+\d[\d\s().-]{5,}\d/g, (p) => " " + p.replace(/\D/g, "") + " ");
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s?([ap])\.?m\b\.?/gi, (_a, h, mi, ap) => { let x = +h; if (/p/i.test(ap) && x < 12) x += 12; if (/a/i.test(ap) && x === 12) x = 0; return " " + x + " " + (mi || "") + " "; });
  const out = new Set<string>();
  for (const n of s.match(/\d+/g) || []) { const v = String(+n); if (v !== "0" && v !== "1") out.add(v); }
  for (const w of s.toLowerCase().match(/[a-zà-ÿ]+/g) || []) if (NUM_W[w]) out.add(String(NUM_W[w]));
  return [...out].sort().join(",");
}
export const sameNums = (a: string, b: string) => numsOf(a) === numsOf(b);
// Pas français ? Même détecteur que l'Espace (notFrench) : mots outils anglais / espagnols / italiens / allemands contre
// mots outils français et accents ; moins de 3 mots (« 15h30 », « 2 lits ») → rien à traduire.
const wordSet = (x: string) => new Set(x.split(" "));
const LANG_FR = wordSet("le la les un une des du de et à au aux en est sont nous vous pour avec sur dans pas que qui ce cette il elle par mais ou où se sa son ses leur leurs très bien merci bonjour avoir être fait faire notre nos votre vos je mon ma mes chez vers après avant puis aussi");
const LANG_X = wordSet("the and of to we you would could please with for is are will be have has our us it this that there can my i they what which if do does not some any from by an as was were been into about after before around should also but or so than then their them these those just very much many most like want need thanks thank hi hello el los las del al es por para con una pero como muy gracias hola somos estamos vamos queremos gli che per sono siamo grazie ciao der die das und ist wir sie mit für bitte danke nicht tea teas coffee coffees iced decaf water waters juice juices milk wine wines beer beers soda sodas dinner dinners lunch breakfast brunch snack snacks cake please chicken fish lamb beef salad salads pastries horns room rooms bed beds single double twin couple couples siblings kids children child baby babies arrive arriving arrival late early flight lands landing pool birthday flavoured flavored");
const arCount = (s: string) => (s.match(/[؀-ۿ]/g) || []).length;
const latCount = (s: string) => (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
export function notFrench(t: string): boolean {
  const s = String(t || ""), ar = arCount(s), lat = latCount(s);
  if (ar > 8 && ar > lat) return true;
  const w = s.toLowerCase().match(/[a-zà-ÿœ]+/g) || [];
  if (w.length < 3) return false;
  let fr = 0, x = 0;
  for (const y of w) { if (LANG_FR.has(y) || /[àâçèêëîïôûùœ]/.test(y)) fr++; else if (LANG_X.has(y)) x++; }
  return x >= 2 && x > fr;
}
// 22/10 : pas anglais ? Mots outils anglais contre mots outils français / espagnols / italiens / allemands et accents ; arabe → oui.
const LANG_EN = wordSet("the and of to we you would could please with for is are will be have has our us it this that there can my i they what which if do does not some any from by an as was were been into about after before around should also but or so than then their them these those just very much many most like want need thanks thank hi hello");
const LANG_OTH = wordSet("le la les un une des du de et à au aux en est sont nous vous pour avec sur dans pas que qui ce cette il elle par mais ou où se sa son ses leur leurs très bien merci bonjour avoir être fait faire notre nos votre vos je mon ma mes chez vers après avant puis aussi el los las del al es por para con una pero como muy gracias hola somos estamos vamos queremos gli che per sono siamo grazie ciao der die das und ist wir sie mit für bitte danke nicht");
export function notEnglish(t: string): boolean {
  const s = String(t || ""), ar = arCount(s), lat = latCount(s);
  if (ar > 8 && ar > lat) return true;
  const w = s.toLowerCase().match(/[a-zà-ÿœ]+/g) || [];
  if (w.length < 3) return false;
  let en = 0, x = 0;
  for (const y of w) { if (LANG_EN.has(y)) en++; else if (LANG_OTH.has(y) || /[àâçèêëîïôûùœ]/.test(y)) x++; }
  return x >= 2 && x > en;
}
/** Un champ à traduire dans cette langue ? Arabe : tout texte qui n'est pas déjà en arabe ; français : ce qui n'est pas en français. */
export function needsTr(lang: TrLang, lines: string[]): boolean {
  const s = lines.join(" ");
  if (!latCount(s) && !arCount(s)) return false; // chiffres seuls
  return lang === "ar" ? !(arCount(s) > latCount(s)) : lang === "en" ? notEnglish(s) : notFrench(s);
}
export async function hashOf(s: string): Promise<string> { return (await sha256hex(s)).slice(0, 16); }
type Item = { id: string; field: keyof Lines; lines: string[] };
/** Ce qui manque au cache : une entrée par (séjour, champ) à traduire dont le texte a changé ou n'a jamais été traduit. */
/** 22/10 : une traduction déjà en cache pour le MÊME texte (même empreinte, même langue) sert à tout champ qui le porte — la
 *  « prochaine arrivée après ce départ » (next_time) est l'heure d'arrivée du séjour suivant, déjà traduite sur son propre
 *  séjour : elle s'affiche tout de suite, sans second appel (cas réel : la page française de Saïd montrait l'anglais de Seán). */
export function cachedFor(cache: Row[], hash: string, n: number): Row | null {
  return cache.find((r) => r.src_hash === hash && Array.isArray(r.lines) && r.lines.length === n) || null;
}
export function missingTr(lang: TrLang, stays: StaffStay[], cache: Row[], hashes: Record<string, string>): Item[] {
  const out: Item[] = [];
  for (const s of stays) for (const f of LINE_FIELDS) {
    const src = s.lines[f]; if (!src.length || !needsTr(lang, src)) continue;
    if (cachedFor(cache, hashes[s.id + "|" + f], src.length)) continue;
    out.push({ id: s.id, field: f, lines: src });
  }
  return out;
}
export const missingAr = (stays: StaffStay[], cache: Row[], hashes: Record<string, string>) => missingTr("ar", stays, cache, hashes);
/** Un appel pour un lot de lignes (≤ AR_MAX_CHARS), alignées par id « <séjour>|<champ>|<n> ». null si rien, en panne, ou pas de clé. */
export async function translateLines(lang: TrLang, items: Item[], call = mistral, max = AR_MAX_CHARS): Promise<Record<string, string> | null> {
  const req: Record<string, string> = {}; let chars = 0;
  outer: for (const it of items) for (let i = 0; i < it.lines.length; i++) { if (chars + it.lines[i].length > max && chars) break outer; req[it.id + "|" + it.field + "|" + i] = it.lines[i]; chars += it.lines[i].length; }
  return askLines(lang, req, call);
}
/** Un appel : { id: texte } → { id: traduction } (les id manquants sont absents). `strict` : seconde chance, nombres rappelés. */
export async function askLines(lang: TrLang, req: Record<string, string>, call = mistral, strict = false): Promise<Record<string, string> | null> {
  if (!Object.keys(req).length) return null;
  const sys = SYS[lang] + (strict ? " ATTENTION : recopie chaque nombre de la ligne d'origine, en chiffres, sans en oublier ni en ajouter." : "");
  const raw = await call(sys, JSON.stringify({ lines: req })).catch((e) => { console.error("[staff-view] " + lang + " call", String(e).slice(0, 120)); return null; });
  if (!raw) return null;
  let j: Row = {}; try { j = JSON.parse(String(raw).replace(/^\s*```\w*\s*|\s*```\s*$/g, "")); } catch { console.error("[staff-view] " + lang + " json", String(raw).slice(0, 160)); return null; }
  const got = j && typeof j.lines === "object" && j.lines ? j.lines : null; if (!got) { console.error("[staff-view] " + lang + " shape", String(raw).slice(0, 160)); return null; }
  const out: Record<string, string> = {};
  for (const k of Object.keys(req)) { const v = got[k]; if (typeof v === "string" && v.trim()) out[k] = fixAr(req[k], v.replace(/\*\*/g, "").trim()).slice(0, 500); }
  console.log("[staff-view] " + lang, Object.keys(req).length, "demandées,", Object.keys(out).length, "reçues");
  return out;
}
export const translateAr = (items: Item[], call = mistral) => translateLines("ar", items, call);
/** 20/10 (essai réel) : ministral-14b écrit « موريتاني » (mauritanien) pour « marocain » — corrigé quand l'original dit marocain. */
export function fixAr(src: string, v: string): string {
  return /maroc|mor+oc/i.test(src) && !/mauritan/i.test(src) ? v.replace(/موريتان/g, "مغرب") : v;
}
/** Lignes d'un champ depuis la réponse : une clé manquante → le champ attend (null) ; un nombre changé → cette ligne reste
 *  dans sa langue d'origine ; aucune ligne traduite → null (rien n'est gardé). */
export function fieldLines(it: Item, fresh: Record<string, string>): string[] | null {
  const got = it.lines.map((_x, i) => fresh[it.id + "|" + it.field + "|" + i]);
  if (!got.every((x) => typeof x === "string")) return null;
  let ok = 0;
  const lines = got.map((x, i) => { if (sameNums(it.lines[i], x as string)) { ok++; return x as string; } console.warn("[staff-view] ligne écartée (nombres)", it.field); return it.lines[i]; });
  return ok ? lines : null;
}
// Le modèle qui répond sur ce compte d'abord (ai_usage_log, 17–20/10 : seul ministral-14b réussit ; medium et small en 429).
export const AR_MODELS = ["ministral-14b-2512", "ministral-8b-2512", "mistral-small-latest"];
const CALL_MS = 45000;
async function mistral(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get("MISTRAL_API_KEY"); if (!key) { console.error("[staff-view] tr: MISTRAL_API_KEY absente"); return null; }
  const tries: string[] = [], skip = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((ok) => setTimeout(ok, 2500));
    for (const model of AR_MODELS) {
      if (skip.has(model)) continue;
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), CALL_MS);
      try {
        const r = await fetch("https://api.mistral.ai/v1/chat/completions", { method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
        if (r.ok) {
          const j = await r.json();
          const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
          if (txt) { if (tries.length) console.log("[staff-view] tr ok", model, "après", tries.join(", ")); return txt; }
          tries.push(model + " vide");
        } else {
          const err = (await r.text().catch(() => "")).slice(0, 120);
          tries.push(model + " " + r.status);
          if (r.status === 403 || r.status === 404 || r.status === 400) { skip.add(model); console.error("[staff-view] tr mistral", model, r.status, err); }
          else if (r.status !== 429) console.error("[staff-view] tr mistral", model, r.status, err);
        }
      } catch (e) { tries.push(model + " " + String(e).slice(0, 40)); } finally { clearTimeout(tm); }
    }
  }
  console.error("[staff-view] tr: aucune réponse —", tries.join(", "));
  return null;
}
/** Morceaux d'au plus `size` caractères, un champ jamais coupé (sauf s'il dépasse seul). */
export function chunks(items: Item[], size = TR_CHUNK): Item[][] {
  const out: Item[][] = []; let cur: Item[] = [], n = 0;
  for (const it of items) {
    const len = it.lines.join("").length;
    if (cur.length && n + len > size) { out.push(cur); cur = []; n = 0; }
    cur.push(it); n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}
// Une traduction en cours ou ratée récemment ne repart pas à chaque rechargement de la page (par instance du serveur).
// run : en cours (la page doit se recharger) ; sinon raté récemment (on n'insiste pas avant `t`).
const INFLIGHT = new Map<string, { t: number; run: boolean }>();
const keyOf = (owner: string, lang: TrLang, it: Item, h: string) => owner + "|" + lang + "|" + it.id + "|" + it.field + "|" + h;
/** Pose `ar` ou `fr` sur chaque séjour depuis le cache et renvoie `job`, la traduction de ce qui manque (à lancer en
 *  arrière-plan, ou à attendre) ; `pending` = nombre de champs en attente. Jamais d'erreur : sans traduction, la langue d'origine. */
export async function withTr(lang: TrLang, stays: StaffStay[], owner: string, read: (ids: string[]) => Promise<Row[]>, write: (rows: Row[]) => Promise<void>,
  call = mistral): Promise<{ stays: StaffStay[]; pending: number; job: Promise<Row[]> | null }> {
  if (!stays.length) return { stays, pending: 0, job: null };
  const hashes: Record<string, string> = {};
  for (const s of stays) for (const f of LINE_FIELDS) if (s.lines[f].length) hashes[s.id + "|" + f] = await hashOf(TR_V[lang] + s.lines[f].join("\n"));
  const cache = await read(stays.map((s) => s.id)).catch((e) => { console.error("[staff-view] tr read", String(e).slice(0, 120)); return [] as Row[]; });
  const attach = (rows: Row[]) => stays.map((s) => {
    const tr: Partial<Lines> = {};
    for (const f of LINE_FIELDS) { // le cache du champ, sinon celui d'un autre champ portant le même texte (même empreinte)
      const src = s.lines[f]; if (!src.length || !needsTr(lang, src)) continue;
      const r = cachedFor(rows, hashes[s.id + "|" + f], src.length);
      if (r) tr[f] = r.lines;
    }
    return Object.keys(tr).length ? { ...s, [lang]: tr } : s;
  });
  const now = Date.now(), all = missingTr(lang, stays, cache, hashes), K = (it: Item) => keyOf(owner, lang, it, hashes[it.id + "|" + it.field]);
  const busy = all.filter((it) => { const e = INFLIGHT.get(K(it)); return !!e && e.run && e.t > now; }).length;
  const miss = all.filter((it) => { const e = INFLIGHT.get(K(it)); return !e || e.t <= now; });
  if (!miss.length) return { stays: attach(cache), pending: busy, job: null };
  if (INFLIGHT.size > 2000) INFLIGHT.clear();
  const fail = (it: Item, min: number) => INFLIGHT.set(K(it), { t: Date.now() + min * 60000, run: false });
  for (const it of miss) INFLIGHT.set(K(it), { t: now + 3 * 60000, run: true }); // en cours : 3 min au plus
  const job = (async () => {
    const done: Row[] = [];
    for (const part of chunks(miss)) { // un morceau ≤ TR_CHUNK (+ un champ ≤ 1 500) tient toujours dans un appel (AR_MAX_CHARS)
      const fresh = await translateLines(lang, part, call);
      if (!fresh) { for (const it of part) fail(it, 10); continue; } // en panne : réessai dans 10 min
      // 20/10 (essai réel) : une ligne dont un nombre a bougé restait dans sa langue — une seconde chance, cette ligne seule.
      const again: Record<string, string> = {};
      for (const it of part) it.lines.forEach((x, i) => { const k = it.id + "|" + it.field + "|" + i; if (typeof fresh[k] === "string" && !sameNums(x, fresh[k])) again[k] = x; });
      if (Object.keys(again).length) {
        const fix = await askLines(lang, again, call, true);
        if (fix) for (const k of Object.keys(again)) if (typeof fix[k] === "string" && sameNums(again[k], fix[k])) fresh[k] = fix[k];
      }
      const rows: Row[] = [];
      for (const it of part) {
        const lines = fieldLines(it, fresh);
        if (lines) { rows.push({ owner_id: owner, client_id: it.id, lang, field: it.field, src_hash: hashes[it.id + "|" + it.field], lines, updated_at: new Date().toISOString() }); INFLIGHT.delete(K(it)); }
        else fail(it, 30); // incomplète, ou chiffres changés partout : pas avant 30 min
      }
      if (rows.length) { await write(rows).catch((e) => console.error("[staff-view] tr write", String(e).slice(0, 120))); done.push(...rows); }
    }
    return done;
  })().catch((e) => { console.error("[staff-view] tr job", String(e).slice(0, 120)); return [] as Row[]; });
  return { stays: attach(cache), pending: miss.length + busy, job };
}
/** Compatibilité (tests, appels d'avant le 20/10) : l'arabe, en attendant la traduction. */
export async function withArabic(stays: StaffStay[], owner: string, read: (ids: string[]) => Promise<Row[]>, write: (rows: Row[]) => Promise<void>, call = mistral): Promise<StaffStay[]> {
  INFLIGHT.clear();
  const r = await withTr("ar", stays, owner, read, write, call);
  if (!r.job) return r.stays;
  const fresh = await r.job;
  const cache = await read(stays.map((s) => s.id)).catch(() => [] as Row[]);
  const merged = cache.filter((c) => !fresh.some((f) => f.client_id === c.client_id && f.field === c.field)).concat(fresh);
  const again = await withTr("ar", stays, owner, async () => merged, async () => {}, async () => null);
  return again.stays;
}

// ── Service ─────────────────────────────────────────────────────────────────────
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
    const link = ((await db(`staff_links?select=id,owner_id,name,lang,role,last_seen_at&token_hash=eq.${h}&deleted_at=is.null&limit=1`)) || [])[0];
    if (!link) return out({ error: "invalid_link" }, 404);
    const role: LinkRole = link.role === "kitchen" ? "kitchen" : "house";
    // La fiche maison du compte (repas « maison » / prestataire) — seulement si elle est en place (même drapeau que l'Espace).
    // Lue d'abord (22/10) : le pays et la ville donnent le fuseau, donc « aujourd'hui » chez la villa.
    const vs = ((await db(`villa_settings?select=house_facts,house_facts_ref,country,city&owner_id=eq.${link.owner_id}&order=created_at.asc&limit=1`).catch(() => [])) || [])[0];
    const tz = villaTz(vs && vs.country, vs && vs.city);
    const todayIso = todayIn(tz);
    const t = day(todayIso) as number;
    // 20/10 : 31 jours de plus pour connaître la prochaine arrivée après un départ en fin de fenêtre (staffView n'affiche que WINDOW_DAYS).
    const rows = await db(`crm_clients?select=id,name,arrival,departure,guests,adults,children,infants,booking_status,meals,details` +
      `&user_id=eq.${link.owner_id}&deleted_at=is.null&departure=gte.${iso(t - 1)}&arrival=lte.${iso(t + WINDOW_DAYS + 31)}&order=arrival.asc&limit=300`) || [];
    const facts: Row | null = vs && vs.house_facts_ref === "villa-facts.js" && vs.house_facts && typeof vs.house_facts === "object" ? vs.house_facts : null;
    let stays = forRole(staffView(rows, todayIso, facts), role);
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
    // Langue affichée par la page (body.lang), sinon celle du lien. Arabe : tout en darija ; français : ce que le client a
    // écrit dans une autre langue. Cache staff_i18n ; ce qui manque part en arrière-plan (la page se recharge : `pending`).
    const lang: TrLang = body.lang === "ar" || body.lang === "fr" || body.lang === "en" ? body.lang : (link.lang === "ar" ? "ar" : link.lang === "en" ? "en" : "fr");
    const owner = String(link.owner_id);
    const read = (ids: string[]) => db(`staff_i18n?select=client_id,field,src_hash,lines&owner_id=eq.${link.owner_id}&lang=eq.${lang}&client_id=in.(${ids.map((x) => '"' + encodeURIComponent(x) + '"').join(",")})&limit=500`).then((r: Row[] | null) => r || []);
    const write = (rws: Row[]) => db(`staff_i18n?on_conflict=client_id,lang,field`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rws) }).then(() => {});
    let pending = 0;
    const tr = await withTr(lang, stays, owner, read, write).catch(() => null);
    if (tr) {
      stays = tr.stays; pending = tr.pending;
      if (tr.job) {
        // deno-lint-ignore no-explicit-any
        const er = (globalThis as any).EdgeRuntime;
        if (er && typeof er.waitUntil === "function") er.waitUntil(tr.job);
        // Une petite traduction arrive souvent en quelques secondes : on l'attend un peu, la page l'a tout de suite.
        let fin = false; tr.job.then(() => { fin = true; });
        await Promise.race([tr.job, new Promise((ok) => setTimeout(ok, 6000))]);
        if (fin) { const again = await withTr(lang, forRole(staffView(rows, todayIso, facts), role), owner, read, write, async () => null).catch(() => null); if (again) { stays = again.stays; pending = again.pending; } }
      }
    }
    return out({ name: link.name, lang: link.lang, role, tr: lang, pending, today: todayIso, tz, stays, reports, at: new Date().toISOString() });
  } catch (_e) {
    return out({ error: "unavailable" }, 503);
  }
});
