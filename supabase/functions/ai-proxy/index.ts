// ═══ STAFFLO AI ROUTER — Supabase Edge Function ═══
//
// Single backend for all client AI calls. Mirrors the client AI_ROUTES table
// (see app.html line ~21761). For each task, walks the cascade tier-by-tier,
// validates each output, and returns the first valid response.
//
// Endpoint: POST /functions/v1/ai-proxy
// Payload : { task, system, user, max_tokens }
// Response: { text, provider_id, tier }                     // success
//           { error: 'all_providers_failed', errors: [...] } // 503 on full failure
//
// `text` and `provider_id` field names are kept for backward compatibility
// with the existing client which reads `d.text` and `pd.provider_id`.
//
// Secrets required: GEMINI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY,
// MISTRAL_API_KEY. Missing keys cause that provider to be silently skipped
// — the cascade walks past it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ═══ AI ROUTING TABLE — keep in sync with client AI_ROUTES (app.html ~21761) ═══
const ROUTES: Record<string, string[]> = {
  extract:        ['gemini',      'deepseek',  'groq',     'mistral'],
  chat_fr:        ['gemini',      'mistral',   'groq',     'deepseek'],
  chat_en:        ['gemini',      'groq',      'mistral',  'deepseek'],
  write_fr:       ['gemini_lite', 'mistral',   'groq',     'gemini'],
  write_en:       ['gemini_lite', 'groq',      'mistral',  'gemini'],
  write_guest_fr: ['gemini_lite', 'mistral',   'groq',     'gemini'],
  write_guest_en: ['gemini_lite', 'groq',      'mistral',  'gemini'],
  write_staff:    ['gemini_lite', 'mistral',   'groq',     'deepseek'],
  fast_classify:  ['gemini_lite', 'groq',      'mistral',  'deepseek'],
  brief:          ['gemini_lite', 'deepseek',  'groq',     'mistral'],
  reason:         ['deepseek',    'gemini',    'groq',     'mistral'],
  vision:         ['gemini'],
};

type ProviderConfig = {
  url: string;
  key: () => string | undefined;
  type: 'gemini' | 'openai';
  model?: string;
};

const PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    key: () => Deno.env.get('GEMINI_API_KEY'),
    type: 'gemini',
  },
  gemini_lite: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    key: () => Deno.env.get('GEMINI_API_KEY'),
    type: 'gemini',
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    key: () => Deno.env.get('DEEPSEEK_API_KEY'),
    type: 'openai',
    model: 'deepseek-chat',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: () => Deno.env.get('GROQ_API_KEY'),
    type: 'openai',
    model: 'llama-3.3-70b-versatile',
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    key: () => Deno.env.get('MISTRAL_API_KEY'),
    type: 'openai',
    model: 'mistral-small-latest',
  },
};

async function callProvider(
  providerId: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string | null> {
  const p = PROVIDERS[providerId];
  const key = p?.key();
  if (!p || !key) return null;

  let body: string;
  let headers: Record<string, string>;

  if (p.type === 'gemini') {
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    const payload: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { maxOutputTokens: maxTokens || 1000, temperature: 0.7 },
    };
    if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    body = JSON.stringify(payload);
  } else {
    // OpenAI-compatible (DeepSeek, Groq, Mistral)
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userContent });
    body = JSON.stringify({
      model: p.model,
      messages,
      max_tokens: maxTokens || 1000,
      temperature: 0.7,
    });
  }

  const r = await fetch(p.url, { method: 'POST', headers, body });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`${providerId} ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();

  if (p.type === 'gemini') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }
  return data.choices?.[0]?.message?.content || null;
}

function validate(task: string, output: string | null): boolean {
  if (!output || typeof output !== 'string') return false;
  if (task === 'extract') return output.includes('{') && output.includes('}');
  if (task === 'fast_classify') return output.length >= 2;
  if (task.startsWith('chat')) return output.length >= 10;
  if (task.startsWith('write')) return output.length >= 20;
  return output.length >= 10;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let payload: { task?: string; system?: string; user?: string; max_tokens?: number };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { task, system, user, max_tokens } = payload;
  if (!task || !user) {
    return new Response(JSON.stringify({ error: 'missing_task_or_user' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const cascade = ROUTES[task] || ROUTES.extract;
  const errors: Array<{ provider: string; reason: string }> = [];

  for (let i = 0; i < cascade.length; i++) {
    const providerId = cascade[i];
    try {
      const result = await callProvider(providerId, system || '', user, max_tokens || 1000);
      if (result && validate(task, result)) {
        // Field names `text` and `provider_id` are kept for client compatibility
        // (existing reads: d.text, pd.provider_id). `tier` is 1-indexed.
        return new Response(
          JSON.stringify({ text: result, provider_id: providerId, tier: i + 1 }),
          { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
        );
      }
      errors.push({ provider: providerId, reason: result ? 'invalid_output' : 'no_key_or_empty' });
    } catch (e) {
      errors.push({ provider: providerId, reason: (e as Error).message.slice(0, 200) });
    }
  }

  return new Response(
    JSON.stringify({ error: 'all_providers_failed', errors }),
    { status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  );
});
