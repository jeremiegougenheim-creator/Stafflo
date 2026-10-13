// ═══ STAFFLO AI ROUTER — Supabase Edge Function v47 ═══
//
// v47 (13/10/2026, audit SaaS) — l'IA d'un SaaS, pas d'un compte :
//   1. QUI APPELLE. Le jeton de session (Authorization: Bearer) est vérifié
//      (auth/v1/user, mis en cache 5 min). Un propriétaire connecté a sa propre
//      limite (150 appels / 5 min). Sans session (étape « wow » de l'onboarding,
//      démo) : 15 appels par heure et par IP, réponses plafonnées à 700 tokens,
//      pas de lecture de fichier. Avant : seul l'en-tête Origin, falsifiable hors
//      navigateur — un relais Mistral ouvert, aux frais de Stafflo.
//   2. 100 % UE. La tâche « vision » partait chez Gemini (Google) et, en plus,
//      n'envoyait jamais la pièce jointe (seul le texte partait). Elle passe chez
//      Mistral (modèles multimodaux de la cascade) avec l'image en data URL. Un PDF
//      reçoit une réponse honnête au lieu d'un résumé inventé. Groq, DeepSeek et
//      Gemini sont retirés de la liste des fournisseurs.
//   3. JOURNAL. Chaque appel écrit une ligne dans ai_usage_log (propriétaire,
//      tâche, modèle, latence, succès) — la table était muette depuis le 7 mai.
//
// v46 — CASCADE DE MODÈLES : chaque tâche a une liste de candidats ; un 403
//   tier_not_allowed marque le modèle bloqué (1 h) et on passe au suivant.
// v45 — un modèle par tâche. v44 — 'brief' : JSON seulement si tableau demandé.
// v43 — Origin + rate limit. v42..v37 — formats, retries, EU-only.
//
// Secrets : MISTRAL_API_KEY, PROXY_SECRET (optionnel). Env par défaut : SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = new Set(['https://stafflo.app', 'https://www.stafflo.app']);
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function corsFor(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-stafflo-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// ── v47 : limites — par propriétaire connecté, ou par IP sans session ──────────
export const LIMITS = {
  user: { windowMs: 5 * 60_000, max: 150 },
  anon: { windowMs: 60 * 60_000, max: 15, maxTokens: 700 },
};
const rlHits = new Map<string, number[]>();
export function limited(key: string, windowMs: number, max: number, now = Date.now()): boolean {
  if (rlHits.size > 10000) rlHits.clear();
  const recent = (rlHits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { rlHits.set(key, recent); return true; }
  recent.push(now);
  rlHits.set(key, recent);
  return false;
}

// ── v47 : identité — jeton de session vérifié auprès de Supabase Auth ──────────
const userCache = new Map<string, { uid: string | null; exp: number }>();
export async function userFromAuth(authHeader: string): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  if (!m) return null;
  const token = m[1].trim();
  if (!token || isPublicKey(token) || !SB_URL) return null;
  const now = Date.now();
  const hit = userCache.get(token);
  if (hit && hit.exp > now) return hit.uid;
  let uid: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SB_ANON } });
    if (r.ok) { const u = await r.json(); uid = (u && u.id) ? String(u.id) : null; }
  } catch { uid = null; }
  if (userCache.size > 2000) userCache.clear();
  userCache.set(token, { uid, exp: now + (uid ? 5 * 60_000 : 30_000) });
  return uid;
}

// Clé publique de l'app (anon JWT, ou clé « sb_publishable_ ») = visiteur sans compte.
// Lecture du rôle sans vérifier la signature : un faux « anon » n'obtient que le quota anonyme.
export function isPublicKey(token: string): boolean {
  if (!token) return false;
  if (token === SB_ANON || token.startsWith('sb_publishable_')) return true;
  const part = token.split('.')[1];
  if (!part) return false;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)));
    return json && json.role === 'anon';
  } catch { return false; }
}

// ── v47 : journal d'usage (ai_usage_log), sans bloquer la réponse ─────────────
function logUsage(row: Record<string, unknown>): void {
  if (!SB_URL || !SB_SERVICE) return;
  const p = fetch(`${SB_URL}/rest/v1/ai_usage_log`, {
    method: 'POST',
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  }).then(() => undefined).catch(() => undefined);
  // deno-lint-ignore no-explicit-any
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ }
}

const providerCooldown: Record<string, number> = {};
const COOLDOWN_MS = 60_000;

const modelBlocked: Record<string, number> = {};
const MODEL_BLOCK_MS = 60 * 60_000;

function isModelBlocked(model: string): boolean {
  const until = modelBlocked[model];
  if (!until) return false;
  if (Date.now() > until) { delete modelBlocked[model]; return false; }
  return true;
}

function blockModel(model: string): void {
  modelBlocked[model] = Date.now() + MODEL_BLOCK_MS;
  console.warn('[ai-proxy] model_blocked', JSON.stringify({ model, for_minutes: MODEL_BLOCK_MS / 60000 }));
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [400, 900, 1600];
const JITTER_MS = 400;

const TEMP_STRUCTURED = 0.2;
const TEMP_PROSE = 0.7;

const JSON_SUFFIX_BRIEF =
  '\n\nOUTPUT FORMAT (absolute, overrides any other formatting instruction above): reply ' +
  'with a single valid JSON object and NOTHING else — no prose, no preamble, no markdown ' +
  'fences. Shape: {"cards": [ ... ]} where each element of "cards" follows the card schema ' +
  'described above. If there is nothing worth reporting, reply exactly {"cards": []}.';

const JSON_SUFFIX_EXTRACT =
  '\n\nOUTPUT FORMAT (absolute): reply with a single valid JSON object and NOTHING else — ' +
  'no prose, no preamble, no markdown fences.';

function isOnCooldown(providerId: string): boolean {
  const until = providerCooldown[providerId];
  if (!until) return false;
  if (Date.now() > until) { delete providerCooldown[providerId]; return false; }
  return true;
}

function setCooldown(providerId: string): void {
  providerCooldown[providerId] = Date.now() + COOLDOWN_MS;
}

// PRIVACY LOCK — EU-ONLY : Mistral (Paris) est le SEUL fournisseur, vision comprise.
export const ROUTES: Record<string, string[]> = {
  extract:        ['mistral'],
  chat_fr:        ['mistral'],
  chat_en:        ['mistral'],
  write_fr:       ['mistral'],
  write_en:       ['mistral'],
  write_guest_fr: ['mistral'],
  write_guest_en: ['mistral'],
  write_staff:    ['mistral'],
  fast_classify:  ['mistral'],
  brief:          ['mistral'],
  reason:         ['mistral'],
  vision:         ['mistral'],
};

// Candidats par tâche, du plus capable au plus sûr ; le dernier a un accès avéré.
// Vision : Large 3, Ministral 14B et Medium 3.x sont multimodaux (docs Mistral « Vision »).
const TASK_MODELS: Record<string, Record<string, string[]>> = {
  mistral: {
    extract:        ['ministral-8b-2512', 'ministral-3b-2512', 'mistral-medium-latest'],
    fast_classify:  ['ministral-3b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
    chat_fr:        ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    chat_en:        ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    write_fr:       ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    write_en:       ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    write_guest_fr: ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    write_guest_en: ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    write_staff:    ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    brief:          ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    reason:         ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
    vision:         ['mistral-large-2512', 'ministral-14b-2512', 'mistral-medium-latest'],
  },
};

type ProviderConfig = {
  url: string;
  key: () => string | undefined;
  model?: string;
};

const PROVIDERS: Record<string, ProviderConfig> = {
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    key: () => Deno.env.get('MISTRAL_API_KEY'),
    model: 'mistral-medium-latest',
  },
};

function modelsFor(providerId: string, task: string): string[] {
  const byTask = TASK_MODELS[providerId];
  const list = (byTask && byTask[task]) || [];
  const fallback = PROVIDERS[providerId]?.model;
  const all = list.length ? list.slice() : (fallback ? [fallback] : []);
  const open = all.filter((m) => !isModelBlocked(m));
  return open.length ? open : all.slice(-1);
}

class ProviderError extends Error {
  retryable: boolean;
  tierBlocked: boolean;
  constructor(message: string, retryable: boolean, tierBlocked = false) {
    super(message);
    this.retryable = retryable;
    this.tierBlocked = tierBlocked;
  }
}

async function singleAttempt(
  p: ProviderConfig,
  headers: Record<string, string>,
  body: string,
  providerId: string,
  soleProvider: boolean,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(p.url, { method: 'POST', headers, body, signal: ctrl.signal });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      const status = r.status;
      if (status === 403 && /tier_not_allowed|1910/.test(errText)) {
        throw new ProviderError(providerId + ' 403 tier_not_allowed', false, true);
      }
      if (status === 401 || status === 402) {
        setCooldown(providerId);
        throw new ProviderError(providerId + ' ' + status + ': ' + errText.slice(0, 160), false);
      }
      if (status === 429) {
        if (!soleProvider) {
          setCooldown(providerId);
          throw new ProviderError(providerId + ' 429: ' + errText.slice(0, 160), false);
        }
        throw new ProviderError(providerId + ' 429: ' + errText.slice(0, 160), true);
      }
      const retryable = status >= 500 || status === 408;
      throw new ProviderError(providerId + ' ' + status + ': ' + errText.slice(0, 160), retryable);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOneModel(
  providerId: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  soleProvider: boolean,
  temperature: number,
  jsonMode: boolean,
  image: string | null,
): Promise<string | null> {
  const p = PROVIDERS[providerId];
  const key = p?.key();
  if (!p || !key) return null;

  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
  const messages: { role: string; content: unknown }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: image ? [{ type: 'text', text: userContent }, { type: 'image_url', image_url: image }] : userContent,
  });
  const payload: Record<string, unknown> = { model, messages, max_tokens: maxTokens || 1000, temperature };
  if (jsonMode) payload.response_format = { type: 'json_object' };
  const body = JSON.stringify(payload);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const base = BACKOFF_MS[attempt - 1] ?? 1600;
      const jitter = Math.floor(Math.random() * JITTER_MS);
      await new Promise((res) => setTimeout(res, base + jitter));
    }
    try {
      return await singleAttempt(p, headers, body, providerId, soleProvider);
    } catch (e) {
      const retryable = e instanceof ProviderError ? e.retryable : true;
      lastErr = e as Error;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw e;
    }
  }
  throw lastErr || new Error(providerId + ' exhausted');
}

async function callProvider(
  providerId: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  soleProvider: boolean,
  temperature: number,
  jsonMode: boolean,
  task: string,
  image: string | null,
): Promise<{ text: string | null; model: string } | null> {
  const candidates = modelsFor(providerId, task);
  let lastErr: Error | null = null;

  for (const model of candidates) {
    try {
      const text = await callOneModel(
        providerId, model, systemPrompt, userContent, maxTokens, soleProvider, temperature, jsonMode, image,
      );
      return { text, model };
    } catch (e) {
      lastErr = e as Error;
      if (e instanceof ProviderError && e.tierBlocked) {
        blockModel(model);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error(providerId + ': no usable model');
}

function unwrapBriefArray(raw: string | null): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return JSON.stringify(parsed);
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.cards)) return JSON.stringify(obj.cards);
    for (const k of Object.keys(obj)) {
      if (Array.isArray(obj[k])) return JSON.stringify(obj[k]);
    }
  }
  return null;
}

function validate(task: string, output: string | null, arrayMode: boolean): boolean {
  if (!output || typeof output !== 'string') return false;
  if (task === 'extract') return output.includes('{') && output.includes('}');
  if (task === 'brief') {
    return arrayMode ? (output.includes('[') && output.includes(']')) : output.length >= 10;
  }
  if (task === 'fast_classify') return output.length >= 2;
  if (task.startsWith('chat')) return output.length >= 10;
  if (task.startsWith('write')) return output.length >= 20;
  return output.length >= 10;
}

// Pièce jointe de la tâche vision → data URL d'image, ou raison du refus.
const MAX_IMAGE_B64 = 10_000_000;
export function imageFromAttachment(att: unknown): { image: string | null; reason: string | null } {
  // deno-lint-ignore no-explicit-any
  const a = att as any;
  if (!a || typeof a !== 'object' || typeof a.data !== 'string' || !a.data) return { image: null, reason: 'no_attachment' };
  const mt = String(a.media_type || '').toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(mt)) return { image: null, reason: 'unsupported_type' };
  if (a.data.length > MAX_IMAGE_B64) return { image: null, reason: 'too_large' };
  const clean = a.data.replace(/^data:[^,]*,/, '');
  return { image: `data:${mt};base64,${clean}`, reason: null };
}
function looksFrench(s: string): boolean {
  return /[éèêàçù]|\b(le|la|les|ce|cette|fichier|résume|analyse)\b/i.test(s || '');
}

serve(async (req) => {
  const started = Date.now();
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    console.warn('[ai-proxy] origin_forbidden', JSON.stringify({ origin: origin.slice(0, 100) || '(none)', method: req.method }));
    return new Response(JSON.stringify({ error: 'origin_forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const cors = corsFor(origin);
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const requiredSecret = Deno.env.get('PROXY_SECRET') || '';
  if (requiredSecret && req.headers.get('x-stafflo-secret') !== requiredSecret) return json({ error: 'bad_secret' }, 401);

  // v47 : qui appelle ? Un jeton présent mais refusé (expiré) → 401 : l'app rafraîchit
  // sa session et rejoue l'appel, au lieu de passer en silence au quota anonyme.
  const authHeader = req.headers.get('authorization') || '';
  const uid = await userFromAuth(authHeader);
  const bearer = (/^Bearer\s+(.+)$/i.exec(authHeader) || [])[1] || '';
  if (!uid && bearer && !isPublicKey(bearer.trim())) return json({ error: 'invalid_session' }, 401);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const isLimited = uid
    ? limited('u:' + uid, LIMITS.user.windowMs, LIMITS.user.max)
    : limited('ip:' + ip, LIMITS.anon.windowMs, LIMITS.anon.max);
  if (isLimited) {
    console.warn('[ai-proxy] rate_limited', JSON.stringify({ who: uid ? 'user' : 'anon' }));
    return json({ error: 'rate_limited', retry_after_s: uid ? 300 : 3600, login_required: !uid }, 429);
  }

  let payload: { task?: string; system?: string; user?: string; max_tokens?: number; json_shape?: string; attachment?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const { task, system, user, json_shape } = payload;
  if (!task || !user) return json({ error: 'missing_task_or_user' }, 400);
  let maxTokens = Math.max(1, Math.min(Number(payload.max_tokens) || 1000, 4000));
  if (!uid) maxTokens = Math.min(maxTokens, LIMITS.anon.maxTokens);

  // v47 : vision — image en data URL chez Mistral ; jamais sans session.
  let image: string | null = null;
  if (task === 'vision') {
    if (!uid) return json({ error: 'login_required' }, 401);
    const att = imageFromAttachment(payload.attachment);
    if (!att.image) {
      const fr = looksFrench(user);
      const text = att.reason === 'unsupported_type'
        ? (fr ? 'Je ne lis pas encore ce type de fichier (PDF, document). Envoyez une photo ou une capture d’écran, ou collez le texte : je m’en occupe.'
              : 'I can’t read this file type yet (PDF, document). Send a photo or a screenshot, or paste the text, and I’ll take it from there.')
        : att.reason === 'too_large'
        ? (fr ? 'Image trop lourde (plus de 7 Mo environ). Envoyez une capture plus légère.' : 'Image too large (over about 7 MB). Please send a lighter screenshot.')
        : (fr ? 'Aucune image reçue.' : 'No image received.');
      logUsage({ task, model_used: null, tier: 0, latency_ms: Date.now() - started, success: false, error: 'vision_' + att.reason, owner_id: uid });
      return json({ text, provider_id: null, model_id: null, tier: 0 });
    }
    image = att.image;
  }

  const cascade = ROUTES[task] || ROUTES.extract;
  const soleProvider = cascade.length === 1;
  const errors: Array<{ provider: string; reason: string }> = [];

  const probe = (system || '') + ' ' + (user || '');
  const arrayMode = task === 'brief' && (json_shape === 'array' || /json\s+array/i.test(probe));

  const structured = (task === 'extract') || arrayMode;
  const temperature = structured ? TEMP_STRUCTURED : TEMP_PROSE;
  const SHAPE_RETRIES = structured ? 1 : 0;

  let sys = system || '';
  if (arrayMode)               sys += JSON_SUFFIX_BRIEF;
  else if (task === 'extract') sys += JSON_SUFFIX_EXTRACT;

  for (let i = 0; i < cascade.length; i++) {
    const providerId = cascade[i];
    if (isOnCooldown(providerId)) {
      errors.push({ provider: providerId, reason: 'cooldown_60s' });
      continue;
    }

    let lastBad: string | null = null;
    let hardError: string | null = null;

    for (let shot = 0; shot <= SHAPE_RETRIES; shot++) {
      try {
        const out = await callProvider(providerId, sys, user, maxTokens, soleProvider, temperature, structured, task, image);
        const raw = out ? out.text : null;
        const result = arrayMode ? (unwrapBriefArray(raw) ?? raw) : raw;

        if (result && validate(task, result, arrayMode)) {
          logUsage({ task, model_used: out ? out.model : null, tier: i + 1, latency_ms: Date.now() - started, success: true, error: null, owner_id: uid });
          return json({ text: result, provider_id: providerId, model_id: out ? out.model : null, tier: i + 1 });
        }
        lastBad = result;
      } catch (e) {
        hardError = (e as Error).message.slice(0, 200);
        break;
      }
    }

    if (hardError) {
      errors.push({ provider: providerId, reason: hardError });
    } else {
      errors.push({
        provider: providerId,
        reason: lastBad ? 'invalid_output after ' + (SHAPE_RETRIES + 1) + ' shot(s): ' + String(lastBad).slice(0, 80) : 'no_key_or_empty',
      });
    }
  }

  console.error('[ai-proxy] all_providers_failed', JSON.stringify({ task, tried: modelsFor(cascade[0], task), blocked: Object.keys(modelBlocked), errors }));
  logUsage({ task, model_used: null, tier: 0, latency_ms: Date.now() - started, success: false, error: String(errors[0]?.reason || 'failed').slice(0, 200), owner_id: uid });
  return json({ error: 'all_providers_failed', errors }, 503);
});
