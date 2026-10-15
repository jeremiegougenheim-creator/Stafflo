// wa-webhook — WhatsApp Business de la villa → Stafflo (16/10/2026).
//
// Le propriétaire garde l'app WhatsApp Business (téléphone, web.whatsapp.com) ; son numéro est relié à
// l'API Cloud de Meta en « coexistence » par le bouton de Maison › Réglages (fonction wa-connect).
// Meta envoie ici :
//   • messages             — ce que les clients écrivent au numéro de la villa (direction « in ») ;
//   • smb_message_echoes   — ce que le propriétaire envoie depuis l'app (direction « out ») ;
//   • history              — l'historique des conversations 1:1 (jusqu'à 6 mois), à la connexion ;
//   • account_update       — déconnexion (PARTNER_REMOVED…).
// Rangé dans wa_messages, sur le compte propriétaire du numéro (wa_numbers). Aucun envoi, aucun
// téléchargement de média (photos de passeports…) : seulement le type et la légende éventuelle.
// L'Espace relie une conversation au séjour par le numéro du client (jamais ici : un séjour créé plus
// tard doit pouvoir la retrouver). Pas d'alerte : le téléphone reçoit déjà la notification WhatsApp.
//
// GET  : vérification Meta (hub.verify_token = secret WA_VERIFY_TOKEN).
// POST : en-tête X-Hub-Signature-256 = HMAC-SHA256(WA_APP_SECRET, corps brut) — sinon 401.
//        { action: "purge" } + x-sync-key (cron mensuel) → texte effacé après 13 mois.
// verify_jwt : off — l'accès, c'est la signature de Meta.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const VERIFY = Deno.env.get("WA_VERIFY_TOKEN") || "";
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + path.split("?")[0] + ": " + txt.slice(0, 160));
  return txt ? JSON.parse(txt) : null;
}
const out = (b: unknown, s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s, headers: { "Content-Type": typeof b === "string" ? "text/plain" : "application/json" } });

export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^00/, "");
function hex(buf: ArrayBuffer) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""); }
/** Signature Meta : « sha256=<hex> », comparée en temps constant. */
export async function signed(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const got = header.slice(7).toLowerCase();
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
const MEDIA = ["image", "video", "document", "audio", "sticker"];
/** Texte lisible d'un message ; null = rien à garder (réaction, message système, type inconnu). */
export function bodyOf(m: Row): { type: string; body: string | null } | null {
  const t = String(m?.type || "");
  if (t === "text") return { type: t, body: String(m.text?.body ?? "").slice(0, 4000) };
  if (MEDIA.includes(t)) { const x = m[t] || {}; return { type: t, body: x.caption ? String(x.caption).slice(0, 4000) : (t === "document" && x.filename ? String(x.filename).slice(0, 200) : null) }; }
  if (t === "interactive") { const r = m.interactive?.button_reply || m.interactive?.list_reply; return r ? { type: t, body: String(r.title || "").slice(0, 400) } : null; }
  if (t === "button") return { type: t, body: String(m.button?.text || "").slice(0, 400) };
  if (t === "location") { const l = m.location || {}; return { type: t, body: [l.name, l.address].filter(Boolean).join(" · ").slice(0, 400) || null }; }
  if (t === "contacts") return { type: t, body: (m.contacts || []).map((c: Row) => c?.name?.formatted_name).filter(Boolean).join(", ").slice(0, 400) || null };
  return null; // reaction, unsupported, system, ephemeral…
}
const isoOf = (ts: unknown) => { const n = Number(ts); return isFinite(n) && n > 1e9 ? new Date(n * 1000).toISOString() : new Date().toISOString(); };

/** Toutes les lignes à ranger d'une notification Meta, et les mises à jour des numéros. */
export function rowsOf(payload: Row, owners: Map<string, { owner: string; display: string }>) {
  const rows: Row[] = [], numbers: Row[] = [];
  for (const e of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const ch of Array.isArray(e?.changes) ? e.changes : []) {
      const v = ch?.value || {}, field = String(ch?.field || ""), pid = String(v?.metadata?.phone_number_id || "");
      const own = owners.get(pid);
      if (!own) continue; // numéro inconnu : ignoré (200, Meta ne renvoie pas)
      const biz = digits(v?.metadata?.display_phone_number || own.display);
      const base = { owner_id: own.owner, phone_number_id: pid };
      if (field === "messages") {
        const names = new Map<string, string>();
        for (const c of v.contacts || []) if (c?.wa_id) names.set(digits(c.wa_id), String(c?.profile?.name || "").slice(0, 120));
        for (const m of v.messages || []) {
          const b = bodyOf(m); if (!b || !m?.id || !m?.from) continue;
          const g = digits(m.from);
          rows.push({ ...base, wamid: String(m.id), guest_wa: g, guest_name: names.get(g) || null, direction: "in", source: "live", type: b.type, body: b.body, sent_at: isoOf(m.timestamp) });
        }
      } else if (field === "smb_message_echoes") {
        for (const m of v.message_echoes || []) {
          const b = bodyOf(m); if (!b || !m?.id || !m?.to) continue;
          rows.push({ ...base, wamid: String(m.id), guest_wa: digits(m.to), guest_name: null, direction: "out", source: "echo", type: b.type, body: b.body, sent_at: isoOf(m.timestamp) });
        }
      } else if (field === "history") {
        for (const h of v.history || []) {
          if (Array.isArray(h?.errors) && h.errors.length) { numbers.push({ phone_number_id: pid, history_status: "declined" }); continue; }
          const p = Number(h?.metadata?.progress);
          if (isFinite(p)) numbers.push({ phone_number_id: pid, history_status: p >= 100 ? "done" : "syncing", history_progress: Math.max(0, Math.min(100, Math.round(p))) });
          for (const t of h.threads || []) {
            const g = digits(t?.id);
            for (const m of t?.messages || []) {
              const b = bodyOf(m); if (!b || !m?.id) continue;
              const fromBiz = !!m.to || (biz && digits(m.from) === biz);
              rows.push({ ...base, wamid: String(m.id), guest_wa: g || digits(fromBiz ? m.to : m.from), guest_name: null, direction: fromBiz ? "out" : "in", source: "history", type: b.type, body: b.body, sent_at: isoOf(m.timestamp) });
            }
          }
        }
      } else if (field === "account_update") {
        const ev = String(v?.event || "");
        if (/PARTNER_REMOVED|ACCOUNT_OFFBOARDED|DISCONNECT/i.test(ev)) numbers.push({ phone_number_id: pid, history_status: "disconnected" });
      }
    }
  }
  return { rows: rows.filter((r) => r.guest_wa && r.guest_wa.length >= 6), numbers };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && VERIFY && url.searchParams.get("hub.verify_token") === VERIFY) return out(url.searchParams.get("hub.challenge") || "");
    return out({ error: "forbidden" }, 403);
  }
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  try {
    // Purge mensuelle (cron) : le texte des messages de plus de 13 mois est effacé.
    if (req.headers.get("x-sync-key")) {
      const ok = await db("rpc/gmail_sync_key_ok", { method: "POST", body: JSON.stringify({ k: req.headers.get("x-sync-key") }) }).catch(() => false);
      if (ok !== true) return out({ error: "unauthorized" }, 401);
      const before = new Date(Date.now() - 395 * 86400000).toISOString();
      const r = await db(`wa_messages?sent_at=lt.${before}&purged_at=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ body: null, purged_at: new Date().toISOString() }) });
      return out({ purged: (r || []).length });
    }
    if (!APP_SECRET) return out({ error: "not_configured" }, 503);
    if (!(await signed(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) return out({ error: "unauthorized" }, 401);
    let payload: Row = {};
    try { payload = JSON.parse(raw); } catch { return out({ error: "bad_request" }, 400); }
    const pids = new Set<string>();
    for (const e of payload?.entry || []) for (const ch of e?.changes || []) if (ch?.value?.metadata?.phone_number_id) pids.add(String(ch.value.metadata.phone_number_id));
    if (!pids.size) return out({ ok: true, rows: 0 });
    const nums: Row[] = await db(`wa_numbers?select=owner_id,phone_number_id,display_phone&deleted_at=is.null&phone_number_id=in.(${[...pids].map((p) => '"' + p.replace(/"/g, "") + '"').join(",")})`) || [];
    const owners = new Map(nums.map((n) => [String(n.phone_number_id), { owner: String(n.owner_id), display: String(n.display_phone || "") }]));
    const { rows, numbers } = rowsOf(payload, owners);
    for (let i = 0; i < rows.length; i += 500) {
      await db("wa_messages?on_conflict=wamid", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });
    }
    for (const n of numbers) {
      const { phone_number_id, ...rest } = n;
      await db(`wa_numbers?phone_number_id=eq.${encodeURIComponent(phone_number_id)}&deleted_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...rest, updated_at: new Date().toISOString() }) });
    }
    return out({ ok: true, rows: rows.length });
  } catch (e) {
    console.error("[wa-webhook]", String(e).slice(0, 200));
    return out({ error: "unavailable" }, 500); // Meta réessaie
  }
});
