// polar-webhook — Polar → table subscriptions. verify_jwt = false : l'accès est
// la signature Standard Webhooks (POLAR_WEBHOOK_SECRET), refusée si absente.
//
// v10 (13/10/2026) — les paiements n'étaient jamais enregistrés :
//   - l'upsert visait `polar_subscription_id`, qui n'avait pas de contrainte
//     d'unicité (Postgres refuse ON CONFLICT) — contrainte ajoutée en base ;
//   - la ligne d'essai créée par ensure_trial porte déjà l'email du client
//     (UNIQUE user_email) : une nouvelle ligne échouait. On met désormais à jour
//     la ligne existante de l'utilisateur ;
//   - une erreur d'écriture répond 500 : Polar renvoie l'événement plus tard,
//     au lieu d'un 202 qui perdait le paiement en silence.
//
// v11 — plus de SDK Polar : @polar-sh/sdk 1.x n'exporte plus « ./webhooks »
//   (BOOT_ERROR). La signature Standard Webhooks est vérifiée ici en WebCrypto,
//   comme le faisait le SDK : clé HMAC = octets UTF-8 du secret Polar, message
//   signé = « webhook-id.webhook-timestamp.corps », en-tête « v1,<base64> ».
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const SECRET = Deno.env.get("POLAR_WEBHOOK_SECRET") ?? "";

const TOLERANCE_S = 5 * 60;
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifySignature(body: string, headers: Record<string, string>, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sigs = headers["webhook-signature"];
  if (!id || !ts || !sigs || !secret) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return sigs.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    return v === "v1" && !!sig && sameString(sig, expected);
  });
}

// deno-lint-ignore no-explicit-any
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};

// L'identifiant posé par polar-checkout (metadata.user_id, tiré du JWT) fait foi.
// À défaut, l'email du client Polar doit correspondre exactement à un compte.
async function resolveUserId(metaUserId: string | null, email: string | null): Promise<string | null> {
  if (metaUserId) return metaUserId;
  if (!email) return null;
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    // deno-lint-ignore no-explicit-any
    const hit = data.users.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (!SECRET) {
    console.error("[polar-webhook] POLAR_WEBHOOK_SECRET absent — refus");
    return new Response("not configured", { status: 500 });
  }
  const body = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  if (!(await verifySignature(body, headers, SECRET))) return new Response("invalid signature", { status: 403 });
  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const type: string = event.type ?? "";
  if (!(type.startsWith("subscription.") || type === "order.paid")) return new Response("ignored", { status: 202 });

  const data = event.data ?? {};
  const sub = type.startsWith("subscription.") ? data : (data.subscription ?? null);
  if (!sub || !pick(sub, "id")) return new Response("no subscription", { status: 202 });

  const cust = sub.customer ?? data.customer ?? {};
  const email = pick(cust, "email") ?? pick(sub, "customer_email", "customerEmail") ?? null;
  const meta = sub.metadata ?? data.metadata ?? {};
  const userId = await resolveUserId(pick(meta, "user_id", "userId"), email);

  const row: Record<string, unknown> = {
    polar_subscription_id: pick(sub, "id"),
    polar_customer_id: pick(sub, "customer_id", "customerId"),
    status: pick(sub, "status"),
    product_id: pick(sub, "product_id", "productId"),
    current_period_end: pick(sub, "current_period_end", "currentPeriodEnd"),
    cancel_at_period_end: pick(sub, "cancel_at_period_end", "cancelAtPeriodEnd") ?? false,
    updated_at: new Date().toISOString(),
  };
  if (userId) { row.user_id = userId; row.tier = "solo"; }
  // Un événement partiel ne doit jamais effacer ce qu'on sait déjà (ex. polar_customer_id, lu par le portail).
  for (const k of Object.keys(row)) if (row[k] === null) delete row[k];

  try {
    // 1. Même abonnement Polar déjà connu → mise à jour.
    const { data: bySub } = await supabase.from("subscriptions").select("id").eq("polar_subscription_id", row.polar_subscription_id).limit(1);
    let targetId: string | null = bySub?.[0]?.id ?? null;
    // 2. Sinon, la ligne existante de l'utilisateur (essai) devient son abonnement.
    if (!targetId && userId) {
      const { data: byUser } = await supabase.from("subscriptions").select("id").eq("user_id", userId)
        .order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
      targetId = byUser?.[0]?.id ?? null;
    }
    if (targetId) {
      const { error } = await supabase.from("subscriptions").update(row).eq("id", targetId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("subscriptions").insert({ ...row, user_email: email });
      if (error) throw error;
    }
    console.log("[polar-webhook]", type, row.polar_subscription_id, "status", row.status, "user", userId ?? "(non relié)");
    return new Response("ok", { status: 202 });
  } catch (e) {
    console.error("[polar-webhook] écriture refusée", e, row);
    return new Response("db error", { status: 500 });
  }
});
