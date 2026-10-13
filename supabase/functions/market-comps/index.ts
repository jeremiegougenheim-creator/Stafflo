import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const AIRROI_KEY = Deno.env.get('AIRROI_KEY') || ''
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ── Accès (13/10/2026, audit SaaS) : un propriétaire connecté (jeton de session vérifié
// auprès de Supabase Auth) — la clé anon publique ne suffit plus. Exception : price-intelligence l'appelle avec la clé service role.
// Avant : verify_jwt seul — la clé anon publique passait, chacun lançait des appels AirROI payants.
const __SB_URL = Deno.env.get('SUPABASE_URL') || ''
const __SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
const __users = new Map<string, { uid: string | null; exp: number }>()
async function callerId(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')
  if (!m || !__SB_URL) return null
  const token = m[1].trim()
  if (!token || token === __SB_ANON) return null
  if (token === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '#')) return 'service'
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

// Taux de change vers l'euro. Approximations, mises à jour manuellement.
const FX: Record<string, number> = {
  EUR: 1, MAD: 0.092, USD: 0.92, GBP: 1.17, THB: 0.026,
  CHF: 1.06, AED: 0.25, TRY: 0.027, MXN: 0.045, IDR: 0.000056
}

const TTL_REAL_MS  = 7 * 24 * 60 * 60 * 1000  // 7 jours pour de la vraie donnée
const TTL_EMPTY_MS = 24 * 60 * 60 * 1000      // 24 h quand c'est vide — on réessaie

// Marchés connus, avec leur région AirROI. À enrichir ville par ville.
const MARKETS: Record<string, { country: string; region: string | null; locality: string }> = {
  marrakech: { country: 'Morocco',  region: 'Marrakech-Safi', locality: 'Marrakech' },
  paris:     { country: 'France',   region: 'Île-de-France',  locality: 'Paris' },
  comporta:  { country: 'Portugal', region: 'Setúbal',        locality: 'Comporta' },
}

// Le champ ville contient souvent « Localité, Pays » — on en extrait le pays
// plutôt que de supposer. Aucune supposition géographique n'est faite ailleurs.
const PAYS_CONNUS: Record<string, string> = {
  'maroc': 'Morocco', 'morocco': 'Morocco',
  'france': 'France',
  'thailande': 'Thailand', 'thaïlande': 'Thailand', 'thailand': 'Thailand',
  'espagne': 'Spain', 'spain': 'Spain',
  'portugal': 'Portugal',
  'italie': 'Italy', 'italy': 'Italy',
  'grece': 'Greece', 'grèce': 'Greece', 'greece': 'Greece',
  'indonesie': 'Indonesia', 'indonésie': 'Indonesia', 'indonesia': 'Indonesia',
  'mexique': 'Mexico', 'mexico': 'Mexico',
  'suisse': 'Switzerland', 'switzerland': 'Switzerland',
  'turquie': 'Turkey', 'turkey': 'Turkey',
  'emirats': 'United Arab Emirates', 'émirats': 'United Arab Emirates',
  'uae': 'United Arab Emirates',
  'royaume-uni': 'United Kingdom', 'united kingdom': 'United Kingdom', 'uk': 'United Kingdom'
}

function sansAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Sépare « อำเภอเกาะพะงัน, Thaïlande » en { locality, country }
function decoupeVille(brut: string): { locality: string; country: string | null } {
  const parts = String(brut || '').split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return { locality: parts[0] || '', country: null }
  const dernier = sansAccents(parts[parts.length - 1])
  const pays = PAYS_CONNUS[dernier] || null
  return pays
    ? { locality: parts.slice(0, -1).join(', '), country: pays }
    : { locality: brut, country: null }
}

type Market = { country: string; region: string | null; locality: string }

async function callAirroi(market: Market, bedrooms: number) {
  const body = {
    market: { ...market, district: null },
    filter: { bedrooms: { eq: bedrooms } },
    sort: { ttm_revenue: 'desc' },
    pagination: { page_size: 10, offset: 0 },
    currency: 'native'
  }
  const res = await fetch('https://api.airroi.com/listings/search/market', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': AIRROI_KEY },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AirROI ${res.status}: ${errText.slice(0, 200)}`)
  }
  const json = await res.json()
  return (json.results || []) as any[]
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const uid = await callerId(req)
  if (!uid) return new Response(JSON.stringify({ error: 'login_required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (uid !== 'service' && overLimit('u:' + uid, 60 * 60_000, 30)) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const { city, country, bedrooms } = await req.json()
    if (!city || !bedrooms) throw new Error('city and bedrooms required')

    const cityKey = sansAccents(String(city))
    const sb = createClient(SB_URL, SB_KEY)

    const { data: cached } = await sb
      .from('market_cache')
      .select('*')
      .eq('city', cityKey)
      .eq('bedrooms', bedrooms)
      .single()

    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
      const isReal = (cached.comp_count ?? 0) > 0
      const ttl = isReal ? TTL_REAL_MS : TTL_EMPTY_MS
      if (ageMs < ttl) {
        return new Response(JSON.stringify({ source: 'cache', data: isReal ? cached : null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // RÉSOLUTION DU MARCHÉ — plus aucun pays par défaut.
    //
    // La version précédente faisait `country: country || 'Morocco'`.
    // Conséquence : une villa à Koh Phangan était interrogée comme
    // « localité thaïlandaise située au Maroc ». AirROI ne renvoyait
    // évidemment rien, et le cache enregistrait « vide » — un résultat
    // faux présenté comme une absence de donnée.
    //
    // Trois voies, dans l'ordre, et aucune supposition :
    //   1. marché connu (MARKETS)
    //   2. pays fourni par le client
    //   3. pays extrait du champ ville, s'il contient « Ville, Pays »
    // Sans pays identifiable, on ne devine PAS : on répond no_country.
    // ══════════════════════════════════════════════════════════════════
    let market: Market | null = MARKETS[cityKey] || null

    if (!market) {
      const decoupe = decoupeVille(city)
      const paysFinal = country || decoupe.country
      if (!paysFinal) {
        return new Response(JSON.stringify({
          source: 'no_country',
          data: null,
          message: 'Pays inconnu pour cette ville — impossible d’interroger le marché sans deviner.',
          debug: { city, cityKey }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      market = { country: paysFinal, region: null, locality: decoupe.locality || city }
    }

    let results: any[] = []
    let bedroomsUsed = bedrooms
    for (const candidate of [bedrooms, bedrooms - 1, bedrooms + 1]) {
      if (candidate < 1) continue
      const r = await callAirroi(market, candidate)
      if (r.length) { results = r; bedroomsUsed = candidate; break }
    }

    if (!results.length) {
      const emptyRow = {
        city: cityKey,
        country: (market.country || '').toLowerCase(),
        bedrooms,
        comp_count: 0,
        comp_bedrooms_used: null,
        fetched_at: new Date().toISOString()
      }
      await sb.from('market_cache').upsert(emptyRow, { onConflict: 'city,bedrooms' })
      return new Response(JSON.stringify({ source: 'empty', data: null, debug: { market, bedrooms } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const rates = results.map((r: any) => r.performance_metrics?.ttm_avg_rate).filter((v: any) => typeof v === 'number' && v > 0)
    const occs  = results.map((r: any) => r.performance_metrics?.ttm_occupancy).filter((v: any) => typeof v === 'number' && v > 0)
    const revs  = results.map((r: any) => r.performance_metrics?.ttm_revenue).filter((v: any) => typeof v === 'number' && v > 0)

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    const currency = results[0]?.pricing_info?.currency || 'EUR'

    // Devise inconnue : on NE convertit PAS avec un taux inventé.
    // On renvoie la valeur locale et on laisse adr_eur à null.
    const toEur = FX[currency] ?? null

    const adrLocal = avg(rates)
    const adrEur   = (adrLocal != null && toEur != null) ? Math.round(adrLocal * toEur) : null
    const occRate  = avg(occs)
    const annRev   = avg(revs)
    const compMin  = (rates.length && toEur != null) ? Math.round(Math.min(...rates) * toEur) : null
    const compMax  = (rates.length && toEur != null) ? Math.round(Math.max(...rates) * toEur) : null

    const summary = results.slice(0, 5).map((r: any) => ({
      name: r.listing_info?.listing_name || 'Listing',
      adr_eur: (r.performance_metrics?.ttm_avg_rate && toEur != null)
        ? Math.round(r.performance_metrics.ttm_avg_rate * toEur) : null,
      adr_local: r.performance_metrics?.ttm_avg_rate
        ? Math.round(r.performance_metrics.ttm_avg_rate) : null,
      occupancy_pct: (typeof r.performance_metrics?.ttm_occupancy === 'number' && r.performance_metrics.ttm_occupancy > 0)
        ? Math.round(r.performance_metrics.ttm_occupancy * 100) : null,
      rating: r.ratings?.rating_overall || null,
      reviews: r.ratings?.num_reviews || null,
      bedrooms: r.property_details?.bedrooms || null,
      superhost: r.host_info?.superhost || false,
      listing_id: r.listing_info?.listing_id || null
    }))

    const row = {
      city: cityKey,
      country: (market.country || '').toLowerCase(),
      bedrooms,
      comp_bedrooms_used: bedroomsUsed,
      adr_eur:              adrEur,
      adr_local:            adrLocal ? Math.round(adrLocal) : null,
      currency,
      occupancy_rate:       occRate != null ? Math.round(occRate * 1000) / 10 : null,
      annual_revenue_local: annRev ? Math.round(annRev) : null,
      comp_count:           rates.length,
      comp_min_eur:         compMin,
      comp_max_eur:         compMax,
      listings_summary:     summary,
      fetched_at:           new Date().toISOString()
    }

    await sb.from('market_cache').upsert(row, { onConflict: 'city,bedrooms' })

    return new Response(JSON.stringify({
      source: 'airroi',
      data: row,
      fx_known: toEur != null
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    })
  }
})
