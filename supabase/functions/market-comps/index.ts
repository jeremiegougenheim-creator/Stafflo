import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const AIRROI_KEY = Deno.env.get('AIRROI_KEY') || ''
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MAD_TO_EUR = 0.092 // approximate, update periodically

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { city, country, bedrooms } = await req.json()
    if (!city || !bedrooms) throw new Error('city and bedrooms required')

    const sb = createClient(SB_URL, SB_KEY)

    // Check cache (7-day TTL)
    const { data: cached } = await sb
      .from('market_cache')
      .select('*')
      .eq('city', city.toLowerCase())
      .eq('bedrooms', bedrooms)
      .gte('fetched_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) {
      return new Response(JSON.stringify({ source: 'cache', data: cached }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Call AirROI API
    const searchBody = {
      location: city,
      country: country || 'morocco',
      num_bedrooms: { eq: bedrooms },
      page_size: 15
    }

    const res = await fetch('https://api.airroi.com/v1/listings/search/location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AIRROI_KEY
      },
      body: JSON.stringify(searchBody)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`AirROI ${res.status}: ${errText.slice(0, 200)}`)
    }

    const result = await res.json()
    const listings = result.data || result.listings || []

    if (!listings.length) {
      return new Response(JSON.stringify({ source: 'empty', data: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Calculate aggregates
    const prices = listings
      .map((l: any) => l.adr || l.average_daily_rate || l.price)
      .filter((p: any) => p && p > 0)
    const occupancies = listings
      .map((l: any) => l.occupancy_rate || l.occupancy)
      .filter((o: any) => o != null)
    const revenues = listings
      .map((l: any) => l.annual_revenue || l.revenue)
      .filter((r: any) => r && r > 0)

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null

    // Detect currency — AirROI returns local currency
    const currency = listings[0]?.currency || 'MAD'
    const toEur = currency === 'EUR' ? 1
      : currency === 'MAD' ? MAD_TO_EUR
      : currency === 'USD' ? 0.92
      : 0.092 // fallback

    const adrLocal = avg(prices)
    const adrEur = adrLocal ? Math.round(adrLocal * toEur) : null
    const occRate = avg(occupancies)
    const annRevLocal = avg(revenues)
    const compMin = prices.length ? Math.round(Math.min(...prices) * toEur) : null
    const compMax = prices.length ? Math.round(Math.max(...prices) * toEur) : null

    // Top 5 listings summary for display
    const summary = listings.slice(0, 5).map((l: any) => ({
      name: l.name || l.title || 'Listing',
      adr: Math.round((l.adr || l.average_daily_rate || 0) * toEur),
      occupancy: l.occupancy_rate || l.occupancy,
      rating: l.rating || l.review_score,
      url: l.url || l.listing_url
    }))

    // Upsert cache
    const row = {
      city: city.toLowerCase(),
      country: (country || 'morocco').toLowerCase(),
      bedrooms,
      adr_eur: adrEur,
      adr_local: adrLocal ? Math.round(adrLocal) : null,
      currency,
      occupancy_rate: occRate ? Math.round(occRate * 10) / 10 : null,
      annual_revenue_local: annRevLocal ? Math.round(annRevLocal) : null,
      comp_count: prices.length,
      comp_min_eur: compMin,
      comp_max_eur: compMax,
      listings_summary: summary,
      fetched_at: new Date().toISOString()
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
