// gmail-sync — v1 (12/10/2026). Synchronisation SERVEUR des emails Airbnb.
//
// Pourquoi : jusqu'ici les emails n'entraient dans Stafflo que quand l'app
// était ouverte (syncGmailDirect, côté navigateur). App fermée = rien. Depuis
// mi-septembre, 0 email relié à un séjour. Cette fonction tourne toute seule
// (pg_cron, toutes les 10 min) :
//   1. rafraîchit le jeton Google stocké (villa_settings.email_connection) ;
//   2. lit les nouveaux emails Airbnb de marrakech.villadarj@gmail.com ;
//   3. les range dans email_inbox (dédoublonné par gmail_id) ;
//   4. les relie au bon séjour et met à jour le CRM :
//        · confirmation → séjour créé (ou complété) : dates, voyageurs,
//          net « YOU EARN », code de réservation, fil Airbnb ;
//        · rappel / message / demande → relié au séjour (code, fil, ou
//          prénom + dates exactes) ;
//        · annulation → séjour marqué annulé, UNIQUEMENT si le code correspond.
//
// Règle ARIA « zéro invention » : tout est extrait par REGEX sur un format
// Airbnb stable. Un champ non trouvé reste vide (jamais estimé, jamais un 0
// déguisé). Aucun appel IA ici. Aucun rapprochement approximatif : code exact,
// fil exact, ou prénom + arrivée + départ exacts — sinon l'email reste non relié.
//
// Accès : en-tête x-sync-key comparé au secret Vault « gmail_sync_key » via la
// RPC gmail_sync_key_ok (service_role uniquement). Fail closed.
// Paramètres (JSON) : { dry?: bool, days?: 1..30, mode?: 'sync' | 'reparse', limit? }
//   mode 'reparse' : relit les emails Airbnb DÉJÀ en base (aucun appel Gmail)
//   — sert à tester le parseur et à rattraper les emails jamais reliés.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Client OAuth qui a émis le jeton (le même que gmail-token-exchange) — identifiant public, pas un secret.
const GID = "657823663741-b34rdmlb08obva72vcibt34mp49iqlom.apps.googleusercontent.com";
const GSEC = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const OWNER_ID = "0f25a319-8cbb-44ae-96e3-7befcda16c9b"; // Villa DarJ (mono-locataire)
const VILLA_KEY = "villadarj";

const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + path.split("?")[0] + ": " + txt.slice(0, 200));
  return txt ? JSON.parse(txt) : null;
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// ── Texte ────────────────────────────────────────────────────────────────
function b64urlToUtf8(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function htmlToText(h: string): string {
  return h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h\d|li)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&euro;/g, "€").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
// deno-lint-ignore no-explicit-any
function bodyOf(payload: any): string {
  let plain = "", html = "";
  // deno-lint-ignore no-explicit-any
  const walk = (p: any) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = b64urlToUtf8(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64urlToUtf8(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (!plain && !html && payload?.body?.data) plain = b64urlToUtf8(payload.body.data);
  return (plain || htmlToText(html)).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Parseur Airbnb (regex uniquement) ────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janv: 1, fevr: 2, févr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, août: 8, déc: 12,
};
function isoDate(d: string, m: string, y: string): string | null {
  const k = m.toLowerCase().replace(/\.$/, "");
  const mo = MONTHS[k] ?? MONTHS[k.slice(0, 4)] ?? MONTHS[k.slice(0, 3)];
  if (!mo) return null;
  const dd = +d, yy = +y;
  if (!(dd >= 1 && dd <= 31 && yy >= 2024 && yy <= 2035)) return null;
  return yy + "-" + String(mo).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
}
const num = (s: string) => { const v = parseFloat(s.replace(/[\s,]/g, "")); return isFinite(v) ? v : null; };

export type Parsed = {
  type: "confirmation" | "request" | "inquiry" | "message" | "reminder" | "cancellation" | "alteration" | "review" | "other";
  code: string | null; thread_id: string | null; name: string | null; first_name: string | null;
  checkin: string | null; checkout: string | null; adults: number | null; children: number | null; infants: number | null;
  payout_eur: number | null; guest_total_eur: number | null; guest_message: string | null;
};
export function parseAirbnb(subject: string, text: string): Parsed {
  const s = subject || "", t = (text || "").replace(/\s+/g, " ");
  const type: Parsed["type"] =
    /cancel+ed|annul/i.test(s) ? "cancellation" :
    /reservation confirmed|réservation confirmée|new booking confirmed/i.test(s) ? "confirmation" :
    /(alteration|modification|change).*(reservation|request)|reservation (was )?(altered|changed)/i.test(s) ? "alteration" :
    /reservation request|pending:|demande de réservation/i.test(s) ? "request" :
    /^(re:\s*)?(enquiry|inquiry) for|demande d'information|respond to .* enquiry/i.test(s) && !/^re:/i.test(s) ? "inquiry" :
    /^re:|new message|message from|nouveau message/i.test(s) ? "message" :
    /reminder|is coming soon|arrive bientôt/i.test(s) ? "reminder" :
    /review/i.test(s) ? "review" : "other";
  const code = (t.match(/CONFIRMATION CODE\s+(HM[A-Z0-9]{6,12})\b/) || t.match(/reservations\/details\/(HM[A-Z0-9]{6,12})\b/) || t.match(/\b(HM[A-Z0-9]{8})\b/) || [])[1] || null;
  const thread_id = (t.match(/hosting\/thread\/(\d{6,})/) || [])[1] || null;
  let name: string | null = null;
  const mConf = s.match(/Reservation confirmed\s*[-–—]\s*(.+?)\s+arrives\b/i);
  const mRem = s.match(/Reservation reminder:\s*(.+?)\s+is coming soon/i);
  if (mConf) name = mConf[1].trim();
  else if (mRem) name = mRem[1].trim();
  if (!name && type === "confirmation") {
    const mm = t.match(/\]\s*([A-ZÀ-Ý][\p{L}'’ -]{1,60}?)\s+\[https:\/\/www\.airbnb\.[a-z.]+\/hosting\/reservations\/details\//u);
    if (mm) name = mm[1].trim();
  }
  // Nom complet présent dans le corps (« Felipe Villalobos [https://…/reservations/details/HM…] »)
  const mFull = t.match(/\s([A-ZÀ-Ý][\p{L}'’-]+(?: [A-ZÀ-Ý][\p{L}'’-]+){1,3}) \[https:\/\/www\.airbnb\.[a-z.]+\/hosting\/reservations\/details\/HM/u);
  if (mFull && (!name || mFull[1].startsWith(name))) name = mFull[1].trim();
  let first_name = name ? name.split(/\s+/)[0] : null;
  // Fil de messages : « JEREMIE Booker … » — prénom seul, sert au rapprochement prénom + dates exactes.
  if (!first_name) {
    const fb = t.match(/\b([A-ZÀ-Ý][\p{L}'’-]{1,30})\s+(?:Booker|Voyageur)\b/u);
    if (fb) first_name = fb[1].charAt(0) + fb[1].slice(1).toLowerCase();
  }
  // Dates : deux premières dates « 29 Dec 2026 » après « Check-in Checkout »
  let checkin: string | null = null, checkout: string | null = null;
  const ci = t.search(/Check-in\s+Check-?out/i);
  if (ci > -1) {
    const seg = t.slice(ci, ci + 220);
    const ds = [...seg.matchAll(/\b(\d{1,2})\s+([A-Za-zéû]{3,9})\.?\s+(\d{4})\b/g)].map((m) => isoDate(m[1], m[2], m[3])).filter(Boolean) as string[];
    if (ds.length >= 2) { checkin = ds[0]; checkout = ds[1]; }
  }
  if (checkin && checkout && checkout <= checkin) { checkin = null; checkout = null; }
  let adults: number | null = null, children: number | null = null, infants: number | null = null;
  const g = t.match(/GUESTS\s+((?:\d+\s+(?:adults?|child(?:ren)?|infants?|pets?)(?:,\s*)?)+)/i);
  if (g) {
    const part = g[1];
    const a = part.match(/(\d+)\s+adults?/i), c = part.match(/(\d+)\s+child(?:ren)?/i), i = part.match(/(\d+)\s+infants?/i);
    adults = a ? +a[1] : null; children = c ? +c[1] : (a ? 0 : null); infants = i ? +i[1] : (a ? 0 : null);
  }
  const payout = t.match(/YOU EARN\s*€\s?([\d.,]+)/i) || t.match(/VOUS GAGNEZ\s*([\d\s.,]+)\s?€/i);
  const total = t.match(/TOTAL \(EUR\)\s*€\s?([\d.,]+)/i);
  // Message du client : fil de discussion (« Booker … Reply ») ou texte de réservation
  let guest_message: string | null = null;
  const mb = t.match(/\b(?:Booker|Guest|Voyageur)\s+(.{2,1200}?)\s+(?:Reply \[|Répondre \[|You can also respond)/);
  if (mb) guest_message = mb[1].replace(/Automatically translated from original message:.*$/i, "").trim();
  if (!guest_message) {
    const mr = t.match(/(?:reviews?|Identity verified)\s+(.{2,1200}?)\s+(?:Send \S+ a Message|Pre-approve|Envoyer un message)/);
    if (mr) guest_message = mr[1].replace(/^[·\s\d]*(?:reviews?)?\s*/i, "").trim();
  }
  return {
    type, code, thread_id, name, first_name, checkin, checkout, adults, children, infants,
    payout_eur: payout ? num(payout[1]) : null, guest_total_eur: total ? num(total[1]) : null,
    guest_message: guest_message ? guest_message.slice(0, 1200) : null,
  };
}

// ── CRM : rapprochement strict ───────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const SEL = "id,name,arrival,departure,guests,adults,children,infants,price,commission,source,booking_status,details,deleted_at";
async function findStay(p: Parsed): Promise<Row | null> {
  const base = `crm_clients?select=${SEL}&user_id=eq.${OWNER_ID}&deleted_at=is.null`;
  if (p.code) {
    const r = await db(`${base}&details->>reservation_code=eq.${p.code}&limit=1`);
    if (r?.length) return r[0];
  }
  if (p.thread_id) {
    const r = await db(`${base}&details->>airbnb_thread_id=eq.${p.thread_id}&limit=1`);
    if (r?.length) return r[0];
  }
  // La villa ne loue qu'à un groupe à la fois : arrivée ET départ exacts, avec un
  // seul séjour actif sur ces dates, c'est le bon séjour (annulés exclus).
  if (p.checkin && p.checkout) {
    const r: Row[] = await db(`${base}&arrival=eq.${p.checkin}&departure=eq.${p.checkout}&limit=3`);
    const live = (r || []).filter((x) => !/cancel|declin/i.test(String(x.booking_status || "")));
    if (live.length === 1) return live[0];
  }
  // Rappel « Felipe is coming soon » : pas de dates dans l'email → nom complet
  // exact, séjour à venir, un seul résultat.
  if (p.type === "reminder" && p.name && p.name.includes(" ")) {
    const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const r: Row[] = await db(`${base}&name=ilike.${encodeURIComponent(p.name)}&arrival=gte.${since}&limit=2`);
    if (r?.length === 1) return r[0];
  }
  return null;
}
async function patchStay(id: string, body: Row) {
  return db(`crm_clients?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
}

// deno-lint-ignore no-explicit-any
async function applyToCrm(p: Parsed, emailId: string | null, dry: boolean, log: any[]): Promise<string | null> {
  const stay = await findStay(p);
  if (p.type === "confirmation" || (p.type === "reminder" && stay)) {
    if (stay) {
      // Compléter sans jamais écraser une valeur existante (le CRM a pu être corrigé à la main).
      const d = { ...(stay.details || {}) };
      const up: Row = {};
      if (p.code && !d.reservation_code) d.reservation_code = p.code;
      if (p.thread_id && !d.airbnb_thread_id) d.airbnb_thread_id = p.thread_id;
      if (p.payout_eur != null && d.payout_eur == null) { d.payout_eur = p.payout_eur; d.payout_source = "gmail_sync"; }
      if (p.guest_message && !d.guest_message) d.guest_message = p.guest_message;
      if (JSON.stringify(d) !== JSON.stringify(stay.details || {})) up.details = d;
      if (stay.adults == null && p.adults != null) up.adults = p.adults;
      if (stay.children == null && p.children != null) up.children = p.children;
      if (stay.infants == null && p.infants != null) up.infants = p.infants;
      if (!(+stay.guests > 0) && p.adults != null) up.guests = p.adults + (p.children || 0);
      if (!(+stay.price > 0) && p.payout_eur != null) { up.price = p.payout_eur; up.commission = 0; }
      if (["inquiry", "quoted", "lead", "request"].includes(String(stay.booking_status || "").toLowerCase())) up.booking_status = "confirmed";
      if (Object.keys(up).length) { log.push({ action: "complete", id: stay.id, fields: Object.keys(up) }); if (!dry) await patchStay(stay.id, up); }
      return stay.id;
    }
    if (!(p.name && p.checkin && p.checkout)) { log.push({ action: "skip_incomplete_confirmation", code: p.code }); return null; }
    const id = String(Date.now());
    const row: Row = {
      id, user_id: OWNER_ID, name: p.name, arrival: p.checkin, departure: p.checkout,
      guests: p.adults != null ? p.adults + (p.children || 0) : null, adults: p.adults, children: p.children, infants: p.infants,
      price: p.payout_eur, commission: p.payout_eur != null ? 0 : null, source: "Airbnb", booking_status: "confirmed",
      details: {
        reservation_code: p.code, airbnb_thread_id: p.thread_id, payout_eur: p.payout_eur, payout_source: p.payout_eur != null ? "gmail_sync" : undefined,
        guest_message: p.guest_message, origin: "gmail_sync", confirmed_via_email_id: emailId,
        ...(p.payout_eur == null ? { pending: ["price"] } : {}),
      },
    };
    log.push({ action: "create", id, name: p.name, arrival: p.checkin });
    if (!dry) {
      try { await db("crm_clients", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }); }
      catch (e) { log.push({ action: "create_failed", name: p.name, error: String(e).slice(0, 160) }); return null; }
    }
    return id;
  }
  if (!stay) return null;
  const d = { ...(stay.details || {}) };
  let changed = false;
  if (p.thread_id && !d.airbnb_thread_id) { d.airbnb_thread_id = p.thread_id; changed = true; }
  if (p.code && !d.reservation_code) { d.reservation_code = p.code; changed = true; }
  if (p.type === "cancellation" && p.code && d.reservation_code === p.code) {
    log.push({ action: "cancel", id: stay.id });
    if (!dry) await patchStay(stay.id, { booking_status: "cancelled", details: { ...d, cancelled_at: new Date().toISOString(), cancelled_via: "gmail_sync" } });
    return stay.id;
  }
  if (changed) { log.push({ action: "link_ids", id: stay.id }); if (!dry) await patchStay(stay.id, { details: d }); }
  return stay.id;
}

// ── Google ───────────────────────────────────────────────────────────────
async function googleToken(refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GID, client_secret: GSEC, refresh_token: refresh, grant_type: "refresh_token" }).toString(),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error("google_token " + (d.error || r.status));
  return { token: d.access_token as string, scope: (d.scope || "") as string };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = req.headers.get("x-sync-key") || "";
  if (!SRK || !key) return json({ error: "unauthorized" }, 401);
  const ok = await fetch(SB_URL + "/rest/v1/rpc/gmail_sync_key_ok", { method: "POST", headers: H, body: JSON.stringify({ k: key }) }).then((r) => r.json()).catch(() => false);
  if (ok !== true) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let opts: any = {};
  try { opts = await req.json(); } catch { opts = {}; }
  const dry = !!opts.dry, mode = opts.mode === "reparse" ? "reparse" : "sync";
  const days = Math.min(30, Math.max(1, +opts.days || 3)), limit = Math.min(60, Math.max(1, +opts.limit || 40));
  const started = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const log: any[] = [];
  const stats = { listed: 0, new: 0, parsed: 0, linked: 0, created: 0, scope: "" };
  try {
    if (mode === "reparse") {
      const rows: Row[] = await db(`email_inbox?select=id,subject,body,client_id,extracted&owner_id=eq.${OWNER_ID}&from_email=ilike.*airbnb.com&received_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}&order=received_at.asc&limit=${limit}`);
      for (const r of rows) {
        const p = parseAirbnb(r.subject, r.body);
        stats.parsed++;
        const cid = await applyToCrm(p, r.id, dry, log);
        if (cid) stats.linked++;
        log.push({ email: r.id, subject: String(r.subject).slice(0, 70), type: p.type, code: p.code, name: p.name, in: p.checkin, out: p.checkout, a: p.adults, c: p.children, i: p.infants, earn: p.payout_eur, client: cid });
        if (!dry) await db(`email_inbox?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ extracted: { ...(r.extracted || {}), airbnb: p, parsed_by: "gmail_sync_v1" }, ...(cid && !r.client_id ? { client_id: cid } : {}) }) });
      }
    } else {
      const vs: Row[] = await db(`villa_settings?select=email_connection&villa_key=eq.${VILLA_KEY}&owner_id=eq.${OWNER_ID}&limit=1`);
      const refresh = vs?.[0]?.email_connection?.refresh_token;
      if (!refresh) throw new Error("no_refresh_token");
      const { token, scope } = await googleToken(refresh);
      stats.scope = scope;
      const q = encodeURIComponent(`from:(airbnb.com) newer_than:${days}d`);
      const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=${q}`, { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
      const ids: string[] = (list.messages || []).map((m: Row) => m.id);
      stats.listed = ids.length;
      const known: Row[] = ids.length ? await db(`email_inbox?select=gmail_id&gmail_id=in.(${ids.join(",")})`) : [];
      const seen = new Set(known.map((k) => k.gmail_id));
      for (const gid of ids.filter((i) => !seen.has(i)).reverse()) {
        const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gid}?format=full`, { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
        const hdr = (n: string) => (m.payload?.headers || []).find((h: Row) => h.name.toLowerCase() === n)?.value || "";
        const subject = hdr("subject"), from = hdr("from"), date = hdr("date");
        const fm = from.match(/^(.*?)\s*<([^>]+)>/);
        const body = bodyOf(m.payload).slice(0, 12000);
        const p = parseAirbnb(subject, body);
        stats.new++; stats.parsed++;
        const rowId = crypto.randomUUID();
        if (!dry) {
          await db("email_inbox?on_conflict=gmail_id", {
            method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
            body: JSON.stringify({ id: rowId, owner_id: OWNER_ID, user_id: OWNER_ID, villa_key: VILLA_KEY, gmail_id: gid,
              from_name: (fm ? fm[1].replace(/"/g, "") : from).slice(0, 200), from_email: (fm ? fm[2] : from).slice(0, 200),
              subject: subject.slice(0, 500), body, received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
              status: "new", source: "gmail_sync", extracted: { airbnb: p, parsed_by: "gmail_sync_v1" } }),
          });
        }
        const cid = await applyToCrm(p, rowId, dry, log);
        if (cid) {
          stats.linked++;
          if (!dry) await db(`email_inbox?gmail_id=eq.${gid}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ client_id: cid }) });
        }
        log.push({ gmail: gid, subject: subject.slice(0, 70), type: p.type, code: p.code, name: p.name, in: p.checkin, out: p.checkout, client: cid });
      }
    }
    stats.created = log.filter((l) => l.action === "create").length;
    if (!dry) await db("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner_id: OWNER_ID, source: "gmail_sync:" + mode, started_at: started, finished_at: new Date().toISOString(), ok: true, stats }) }).catch(() => {});
    return json({ ok: true, dry, mode, stats, log });
  } catch (e) {
    if (!dry) await db("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner_id: OWNER_ID, source: "gmail_sync:" + mode, started_at: started, finished_at: new Date().toISOString(), ok: false, stats, error: String(e).slice(0, 300) }) }).catch(() => {});
    return json({ ok: false, error: String(e).slice(0, 300), stats, log }, 500);
  }
});
