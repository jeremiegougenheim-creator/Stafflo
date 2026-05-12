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

  let payload: { code?: string; redirect_uri?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { code, redirect_uri } = payload || {};
  if (!code || !redirect_uri) {
    return json({ error: "missing_code_or_redirect_uri" }, 400);
  }

  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: clientSecret,
      code,
      redirect_uri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const body = await tokenRes.text();
  return new Response(body, {
    status: tokenRes.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
