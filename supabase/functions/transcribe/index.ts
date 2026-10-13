// ═══ STAFFLO TRANSCRIBE — Supabase Edge Function v9 ═══
//
// v9 (13/10/2026, audit SaaS) :
//   1. 100 % UE. L'audio partait chez Groq (États-Unis, whisper-large-v3-turbo),
//      contraire au badge « Données traitées en Europe ». Transcription Mistral
//      (Voxtral, modèle voxtral-mini-latest, endpoint /v1/audio/transcriptions).
//   2. Compte obligatoire. Le jeton de session est vérifié (comme ai-proxy v47) ;
//      la limite est par propriétaire (30 / 5 min). Avant : Origin seul (falsifiable)
//      et un JWT « dormant » jamais activé.
//   3. Le modèle demandé par le client est ignoré : le serveur choisit.
// v8 — Origin allowlist, rate limit par IP, plafond 25 Mo.
//
// Secret : MISTRAL_API_KEY (le même qu'ai-proxy).

const ALLOWED_ORIGINS = new Set(["https://stafflo.app", "https://www.stafflo.app"]);
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
export const MODEL = "voxtral-mini-latest";
export const ENDPOINT = "https://api.mistral.ai/v1/audio/transcriptions";
const MAX_BYTES = 25 * 1024 * 1024;

function corsFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-stafflo-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const RL_WINDOW_MS = 5 * 60_000, RL_MAX = 30;
const rlHits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  if (rlHits.size > 5000) rlHits.clear();
  const recent = (rlHits.get(key) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (recent.length >= RL_MAX) { rlHits.set(key, recent); return true; }
  recent.push(now);
  rlHits.set(key, recent);
  return false;
}

const userCache = new Map<string, { uid: string | null; exp: number }>();
async function userFromAuth(authHeader: string): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m || !SB_URL) return null;
  const token = m[1].trim();
  if (!token || token === SB_ANON) return null;
  const now = Date.now();
  const hit = userCache.get(token);
  if (hit && hit.exp > now) return hit.uid;
  let uid: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SB_ANON } });
    if (r.ok) { const u = await r.json(); uid = u?.id ? String(u.id) : null; }
  } catch { uid = null; }
  if (userCache.size > 2000) userCache.clear();
  userCache.set(token, { uid, exp: now + (uid ? 5 * 60_000 : 30_000) });
  return uid;
}

// « fr-FR » → « fr » ; rien de reconnaissable → pas de langue imposée (détection auto).
export function langCode(v: unknown): string {
  const m = /^([a-z]{2})(?:[-_][A-Za-z]{2})?$/.exec(String(v || "").trim());
  return m ? m[1] : "";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "origin_forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const cors = corsFor(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  const uid = await userFromAuth(req.headers.get("authorization") || "");
  if (!uid) return json({ error: "login_required" }, 401, cors);
  if (rateLimited("u:" + uid)) return json({ error: "rate_limited", retry_after_s: 300 }, 429, cors);

  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) return json({ error: "not_configured" }, 500, cors);

  const declared = Number(req.headers.get("content-length") || "0");
  if (declared && declared > MAX_BYTES) return json({ error: "payload_too_large", max_bytes: MAX_BYTES }, 413, cors);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "expected_multipart_form_data" }, 400, cors); }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "missing_audio_file" }, 400, cors);
  if (file.size > MAX_BYTES) return json({ error: "payload_too_large", max_bytes: MAX_BYTES }, 413, cors);

  const out = new FormData();
  out.append("file", file, file.name || "audio.webm");
  out.append("model", MODEL);
  const lang = langCode(form.get("language"));
  if (lang) out.append("language", lang);

  let r: Response;
  try {
    r = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: out });
  } catch (e) {
    return json({ error: "transcribe_fetch_failed", detail: (e as Error).message.slice(0, 200) }, 502, cors);
  }
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    console.error("[transcribe] mistral", r.status, errText.slice(0, 300));
    return json({ error: `mistral_${r.status}` }, 502, cors);
  }
  const data = await r.json().catch(() => ({} as Record<string, unknown>));
  return json({ text: String((data as { text?: string }).text || "").trim() }, 200, cors);
});
