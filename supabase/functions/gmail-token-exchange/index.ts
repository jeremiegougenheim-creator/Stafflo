import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGIN = "https://jeremiegougenheim-creator.github.io";
const CLIENT_ID = "657823663741-b34rdmlb08obva72vcibt34mp49iqlom.apps.googleusercontent.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let payload: { code?: string; redirect_uri?: string; refresh_token?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { code, redirect_uri, refresh_token } = payload || {};

  // Two grant flows share this endpoint so client_secret lives in one place
  // and the CORS surface stays small. Refresh path is what enables persistent
  // tokens — previously the client tried to refresh directly against Google
  // without a client_secret, which Google rejects for web-typed client IDs.
  const isRefresh = !!refresh_token;
  if (!isRefresh && (!code || !redirect_uri)) {
    return json({ error: "missing_code_or_refresh_token" }, 400);
  }

  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const tokenBody = isRefresh
    ? new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        refresh_token: refresh_token!,
        grant_type: "refresh_token",
      })
    : new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        code: code!,
        redirect_uri: redirect_uri!,
        grant_type: "authorization_code",
      });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  const body = await tokenRes.text();
  return new Response(body, {
    status: tokenRes.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
