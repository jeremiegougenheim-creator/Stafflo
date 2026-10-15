// email-in — entrée des emails SANS connecter Gmail (15/10/2026).
//
// Le propriétaire fait suivre ses emails Airbnb (règle de transfert Gmail, Outlook, iCloud…) à SON
// adresse Stafflo « in-<jeton>@stafflo.app » (rpc inbound_address). Cloudflare Email Routing remet le
// message au Worker workers/email-in, qui l'envoie ici (en-tête x-inbound-key, secret Vault
// « inbound_key »). On range l'email dans email_inbox (source « email_in ») sur le compte du jeton ;
// le re-parse serveur (gmail-sync mode reparse, cron 30 min) le lit avec le même parseur que la
// synchro Gmail, le relie au séjour, et push-notify envoie l'alerte. Rien d'autre n'est fait ici.
//
// Seuls sont gardés : les emails d'Airbnb, et la confirmation de transfert de Gmail (le code
// s'affiche dans l'Espace pour que le propriétaire valide l'adresse). Le reste est ignoré (202).
// POST JSON { to, from, from_name, subject, text, html, message_id, date, fwd, auth }
//   200 { ok }  · 202 { ignored }  · 404 adresse inconnue (le Worker refuse le message) · 401 clé.
// verify_jwt : off — l'accès, c'est la clé partagée avec le Worker.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const H = { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" };
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + " " + path.split("?")[0] + ": " + txt.slice(0, 160));
  return txt ? JSON.parse(txt) : null;
}
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** « in-7f3k9q2m1a2b@stafflo.app » → « 7f3k9q2m1a2b » ; autre chose → "". */
export function tokenOf(to: unknown): string {
  const m = /^in-([a-z0-9]{10,16})@stafflo\.app$/.exec(String(to || "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1"));
  return m ? m[1] : "";
}
export const isAirbnb = (from: unknown) => /@([a-z0-9-]+\.)*airbnb\.(com|fr|de|es|it|nl|be|ch|pt|ie|ca|co\.uk|com\.au|co\.nz|com\.br|mx|ma|ae|gr|at|dk|se|no|fi|pl|cz|hu|jp|co\.in)$/i.test(String(from || "").trim());
export const isGmailConfirm = (from: unknown) => /^forwarding-noreply@google\.com$/i.test(String(from || "").trim());
/** Texte lisible d'un email HTML (le parseur Airbnb lit du texte). */
export function textOf(text: unknown, html: unknown): string {
  const t = String(text || "").trim();
  if (t) return t;
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
async function idOf(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now); hits.set(key, recent);
  return recent.length > max;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  const key = req.headers.get("x-inbound-key") || "";
  if (key.length < 32) return out({ error: "unauthorized" }, 401);
  try {
    const ok = await db("rpc/inbound_key_ok", { method: "POST", body: JSON.stringify({ k: key }) }).catch(() => false);
    if (ok !== true) return out({ error: "unauthorized" }, 401);
    // deno-lint-ignore no-explicit-any
    let m: any = {};
    try { m = await req.json(); } catch { return out({ error: "bad_request" }, 400); }
    const token = tokenOf(m.to);
    if (!token) return out({ error: "unknown_address" }, 404);
    const a: Row[] = await db(`inbound_addresses?select=owner_id&token=eq.${token}&limit=1`) || [];
    if (!a.length) return out({ error: "unknown_address" }, 404);
    const owner = String(a[0].owner_id);
    if (limited(token, 200, 60 * 60_000)) return out({ error: "rate_limited" }, 429);
    const from = String(m.from || "").trim().toLowerCase().slice(0, 200);
    if (!isAirbnb(from) && !isGmailConfirm(from)) return out({ ignored: true }, 202); // rien d'autre n'est gardé
    const subject = String(m.subject || "").slice(0, 500);
    const body = textOf(m.text, m.html).slice(0, 12000);
    const when = Date.parse(String(m.date || "")), received = isFinite(when) ? new Date(when).toISOString() : new Date().toISOString();
    const gid = "in:" + await idOf(String(m.message_id || "") || [from, subject, received].join("|"));
    const vs: Row[] = await db(`villa_settings?select=villa_key&owner_id=eq.${owner}&limit=1`) || [];
    await db("email_inbox?on_conflict=gmail_id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ owner_id: owner, user_id: owner, villa_key: vs[0]?.villa_key || null, gmail_id: gid,
        from_name: String(m.from_name || "").slice(0, 200), from_email: from, subject, body: body || "(vide)", received_at: received,
        status: "new", source: "email_in",
        extracted: { inbound: { fwd: String(m.fwd || "").slice(0, 200), auth: String(m.auth || "").slice(0, 300) } } }),
    });
    return out({ ok: true });
  } catch (e) {
    console.error("[email-in]", String(e).slice(0, 200));
    return out({ error: "unavailable" }, 503); // le Worker échoue : Cloudflare réessaie plus tard
  }
});
