import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const AIRROI_KEY = Deno.env.get('AIRROI_KEY') || ''
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MAD_TO_EUR = 0.092 // approximate, update periodically

// Minimal city → AirROI market mapping. Add entries as new cities go live.
const MARKETS: Record<string, { country: string; region: string | null; locality: string }> = {
  marrakech: { country: 'Morocco', region: 'Marrakech-Safi', locality: 'Marrakech' },
  paris:     { country: 'France',  region: 'Île-de-France',  locality: 'Paris' },
  comporta:  { country: 'Portugal', region: 'Setúbal',       locality: 'Comporta' },
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { city, country, bedrooms } = await req.json()
    if (!city || !bedrooms) throw new Error('city and bedrooms required')

    const cityKey = city.toLowerCase()
    const sb = createClient(SB_URL, SB_KEY)

    // Cache (7-day TTL)
    const { data: cached } = await sb
      .from('market_cache')
      .select('*')
      .eq('city', cityKey)
      .eq('bedrooms', bedrooms)
      .gte('fetched_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) {
      return new Response(JSON.stringify({ source: 'cache', data: cached }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Resolve market — known city or fallback
    const market = MARKETS[cityKey] || {
      country: country || 'Morocco',
      region: null,
      locality: city
    }

    const body = {
      market: { ...market, district: null },
      filter: { bedrooms: { eq: bedrooms } },
      sort: { ttm_revenue: 'desc' },
      pagination: { page_size: 10, offset: 0 },
      currency: 'native'
    }

    const res = await fetch('https://api.airroi.com/listings/search/market', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': AIRROI_KEY
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`AirROI ${res.status}: ${errText.slice(0, 200)}`)
    }

    const json = await res.json()
    const results = json.results || []
    const totalCount = json.pagination?.total_count ?? 0

    if (!results.length) {
      return new Response(JSON.stringify({
        source: 'empty',
        data: null,
        debug: { market, totalCount, bedrooms }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Pull metrics — TTM is the relevant window for annual benchmarks.
    const rates = results
      .map((r: any) => r.performance_metrics?.ttm_avg_rate)
      .filter((v: any) => typeof v === 'number' && v > 0)
    const occs = results
      .map((r: any) => r.performance_metrics?.ttm_occupancy)
      .filter((v: any) => typeof v === 'number')
    const revs = results
      .map((r: any) => r.performance_metrics?.ttm_revenue)
      .filter((v: any) => typeof v === 'number' && v > 0)

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    const currency = results[0]?.pricing_info?.currency || 'MAD'
    const toEur = currency === 'EUR' ? 1
      : currency === 'MAD' ? MAD_TO_EUR
      : currency === 'USD' ? 0.92
      : currency === 'GBP' ? 1.17
      : 0.092

    const adrLocal = avg(rates)
    const adrEur   = adrLocal ? Math.round(adrLocal * toEur) : null
    const occRate  = avg(occs)  // 0–1
    const annRev   = avg(revs)
    const compMin  = rates.length ? Math.round(Math.min(...rates) * toEur) : null
    const compMax  = rates.length ? Math.round(Math.max(...rates) * toEur) : null

    const summary = results.slice(0, 5).map((r: any) => ({
      name: r.listing_info?.listing_name || 'Listing',
      adr_eur: r.performance_metrics?.ttm_avg_rate
        ? Math.round(r.performance_metrics.ttm_avg_rate * toEur) : null,
      occupancy_pct: r.performance_metrics?.ttm_occupancy != null
        ? Math.round(r.performance_metrics.ttm_occupancy * 100) : null,
      rating: r.ratings?.rating_overall || null,
      reviews: r.ratings?.num_reviews || null,
      bedrooms: r.property_details?.bedrooms || null,
      superhost: r.host_info?.superhost || false,
      listing_id: r.listing_info?.listing_id || null
    }))

    const row = {
      city: cityKey,
      country: (country || market.country).toLowerCase(),
      bedrooms,
      adr_eur:              adrEur,
      adr_local:            adrLocal ? Math.round(adrLocal) : null,
      currency,
      occupancy_rate:       occRate != null ? Math.round(occRate * 1000) / 10 : null, // 0–100 with 1 decimal
      annual_revenue_local: annRev ? Math.round(annRev) : null,
      comp_count:           rates.length,
      comp_min_eur:         compMin,
      comp_max_eur:         compMax,
      listings_summary:     summary,
      fetched_at:           new Date().toISOString()
    }

    await sb.from('market_cache').upsert(row, { onConflict: 'city,bedrooms' })

    return new Response(JSON.stringify({ source: 'airroi', data: row }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    })
  }
})
