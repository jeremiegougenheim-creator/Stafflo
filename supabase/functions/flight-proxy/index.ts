import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Accès (13/10/2026, audit SaaS) : un propriétaire connecté (jeton de session vérifié
// auprès de Supabase Auth) — la clé anon publique ne suffit plus. Avant : aucun contrôle, n'importe qui épuisait le quota AviationStack.
// Note : l'offre gratuite d'AviationStack n'accepte que http (clé côté serveur, jamais exposée au navigateur).
const __SB_URL = Deno.env.get('SUPABASE_URL') || ''
const __SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
const __users = new Map<string, { uid: string | null; exp: number }>()
async function callerId(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')
  if (!m || !__SB_URL) return null
  const token = m[1].trim()
  if (!token || token === __SB_ANON) return null
  
  const now = Date.now(), hit = __users.get(token)
  if (hit && hit.exp > now) return hit.uid
  let uid: string | null = null
  try {
    const r = await fetch(`${__SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: __SB_ANON } })
    if (r.ok) { const u = await r.json(); uid = u?.id ? String(u.id) : null }
  } catch { uid = null }
  if (__users.size > 2000) __users.clear()
  __users.set(token, { uid, exp: now + (uid ? 300_000 : 30_000) })
  return uid
}
const __hits = new Map<string, number[]>()
function overLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  if (__hits.size > 5000) __hits.clear()
  const recent = (__hits.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) { __hits.set(key, recent); return true }
  recent.push(now); __hits.set(key, recent); return false
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// In-memory cache (flight data changes frequently)
const cache: Record<string, { data: any; expires: number }> = {}
const TTL = 5 * 60 * 1000 // 5 min

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const uid = await callerId(req)
  if (!uid) return new Response(JSON.stringify({ error: 'login_required' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  if (overLimit('u:' + uid, 60 * 60_000, 60)) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const url = new URL(req.url)
  const flight = url.searchParams.get('flight') || url.searchParams.get('iata')
  const date = url.searchParams.get('date')
  const airport = url.searchParams.get('airport') // RAK, CDG, etc.
  const mode = url.searchParams.get('mode') || 'arr' // arr | dep
  const limit = String(Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10)))

  if ((flight && !/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/i.test(flight)) || (airport && !/^[A-Z]{3}$/i.test(airport)) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return new Response(JSON.stringify({ error: 'invalid_params' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  if (!flight && !airport) {
    return new Response(JSON.stringify({ error: 'flight or airport param required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const cacheKey = flight ? `flight:${flight}:${date||''}` : `airport:${airport}:${mode}:${limit}`
  const cached = cache[cacheKey]
  if (cached && cached.expires > Date.now()) {
    return new Response(JSON.stringify(cached.data), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    })
  }

  const key = Deno.env.get('AVIATIONSTACK_API_KEY')
  if (!key) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  try {
    const params = new URLSearchParams({ access_key: key })
    if (flight) {
      params.set('flight_iata', flight)
      if (date) params.set('flight_date', date)
    } else if (airport) {
      params.set(mode === 'dep' ? 'dep_iata' : 'arr_iata', airport)
      params.set('limit', limit)
    }

    const r = await fetch(`http://api.aviationstack.com/v1/flights?${params}`)
    const data = await r.json()
    if (!r.ok || data.error) {
      return new Response(JSON.stringify({ error: data.error?.message || 'API error' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }
    cache[cacheKey] = { data, expires: Date.now() + TTL }
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
