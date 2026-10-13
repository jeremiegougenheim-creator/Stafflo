import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Echange un refresh_token Google contre un nouvel access_token.
// Le client_secret ne quitte jamais le serveur : il vit dans une variable
// d'environnement de la fonction, jamais dans app.html ni dans le depot.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return json({ error: "missing_server_config", detail: "GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET absent des variables d'environnement de la fonction." }, 500);
    }

    let payload: { refresh_token?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const refreshToken = (payload?.refresh_token || "").trim();
    if (!refreshToken) return json({ error: "missing_refresh_token" }, 400);

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await r.json();

    if (!r.ok) {
      // Google renvoie invalid_grant quand le refresh_token est revoque
      // (mot de passe change, acces retire, app en mode Test > 7 jours).
      // On le remonte tel quel : le client doit alors relancer un consentement.
      return json({ error: data.error || "google_error", detail: data.error_description || null }, r.status);
    }

    if (!data.access_token) return json({ error: "no_access_token" }, 502);

    return json({
      access_token: data.access_token,
      expires_in: data.expires_in ?? 3600,
      expires_at: Date.now() + ((data.expires_in ?? 3600) * 1000),
      scope: data.scope ?? null,
    });
  } catch (e) {
    return json({ error: "unexpected", detail: String(e) }, 500);
  }
});
