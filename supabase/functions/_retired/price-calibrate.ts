import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Ancre palace 5★ Marrakech par saison (source: grille app.html, jamais modifiée)
const PALACE_ANCHOR: Record<string,number> = {
  low:700, normal:950, high:1400, veryhigh:1800, peak:2200
};

// Coefficients de dérivation saisonniers (relatif à base_normal)
const SEASON_MULT: Record<string,number> = {
  low:0.87, normal:1.00, high:1.13, veryhigh:1.27, peak:1.60
};

const STAFF_COEFF = 1.15;  // Said + Faiza + Bouchra = valeur ajoutée réelle
const FLOOR = 500;

function round50(n: number): number {
  return Math.max(FLOOR, Math.round(n / 50) * 50);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
  });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json() as { owner_id: string; dry_run?: boolean };
    if (!body.owner_id) return new Response(JSON.stringify({ error: 'owner_id required' }), { status: 400 });

    // 1. AIROI via market-comps (ancre plancher marché)
    let airoiAvg: number | null = null;
    let airoiCount = 0;
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/market-comps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ location: 'Marrakech', bedrooms: 5, currency: 'EUR' }),
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const j = await r.json();
        if (j.avg_price && j.comp_count >= 3) {
          airoiAvg = Math.round(j.avg_price);
          airoiCount = j.comp_count;
        }
      }
    } catch { /* best-effort */ }

    // 2. HISTORIQUE depuis crm_clients (prix acceptés mesurés)
    // Filtre outliers: prix/nuit doit être < palace_peak (2200€) et > floor (500€)
    const { data: histData } = await sb.rpc('exec_sql' as never) as never ?? { data: null };
    // Direct query via supabase client
    const { data: bookings } = await sb
      .from('crm_clients')
      .select('arrival, departure, price')
      .eq('user_id', body.owner_id)
      .gt('price', 0)
      .not('arrival', 'is', null)
      .not('departure', 'is', null);

    const historique: Record<string, number[]> = { low:[], normal:[], high:[], veryhigh:[], peak:[] };

    if (bookings) {
      for (const b of bookings) {
        const arr = new Date(b.arrival + 'T12:00:00Z');
        const dep = new Date(b.departure + 'T12:00:00Z');
        const nights = Math.round((dep.getTime() - arr.getTime()) / 86400000);
        if (nights < 1) continue;
        const pricePN = parseFloat(b.price) / nights;
        const m = arr.getUTCMonth() + 1;
        const d = arr.getUTCDate();
        let season = 'normal';
        if (m===12&&d>=21 || m===1&&d<=2) season='peak';
        else if (m===7||m===8) season='veryhigh';
        else if ([3,4,10,11].includes(m)) season='high';
        else if (m===5||m===6) season='low';

        // Filtre outlier: entre 0.3× et 1.5× l'ancre palace de la saison
        const palaceRef = PALACE_ANCHOR[season];
        if (pricePN >= palaceRef * 0.25 && pricePN <= palaceRef * 1.3) {
          historique[season].push(pricePN);
        }
        // Sinon: outlier ignoré (MAD/brut Airbnb)
      }
    }

    const histAvg: Record<string, number|null> = {};
    for (const [s, prices] of Object.entries(historique)) {
      histAvg[s] = prices.length >= 2
        ? Math.round(prices.reduce((a,b)=>a+b,0) / prices.length)
        : null;  // pas assez de données
    }

    // 3. CALCUL base_normal
    // Ancre 1: AirROI × 1.30 (premium villa staffée sur Airbnb)
    const a1 = airoiAvg ? airoiAvg * 1.30 : null;
    // Ancre 2: Palace normal × 0.55 (villa entre hôtel luxe et palace)
    const a2 = PALACE_ANCHOR.normal * 0.55; // 950 * 0.55 = 522€
    // Ancre 3: historique normal (ou high si manque)
    const a3 = histAvg.normal ?? histAvg.high ?? null;

    let base_normal: number;
    let formula: string;
    let confidence: string;

    if (a1 && a3) {
      // 3 sources — meilleure confiance
      base_normal = (a1*0.50 + a2*0.30 + a3*0.20) * STAFF_COEFF;
      formula = `(AirROI×1.30 ×50% + Palace×0.55 ×30% + Historique×20%) ×${STAFF_COEFF} staff`;
      confidence = 'A';
    } else if (a1) {
      // 2 sources — bonne confiance
      base_normal = (a1*0.60 + a2*0.40) * STAFF_COEFF;
      formula = `(AirROI×1.30 ×60% + Palace×0.55 ×40%) ×${STAFF_COEFF} staff`;
      confidence = 'B';
    } else if (a3) {
      // Historique + palace seulement
      base_normal = (a2*0.50 + a3*0.50) * STAFF_COEFF;
      formula = `(Palace×0.55 ×50% + Historique×50%) ×${STAFF_COEFF} staff`;
      confidence = 'B';
    } else {
      // Palace seul — confiance C
      base_normal = a2 * STAFF_COEFF;
      formula = `Palace×0.55 ×${STAFF_COEFF} staff (seule source)`;
      confidence = 'C';
    }

    base_normal = Math.round(base_normal);

    // 4. GRILLE complète dérivée
    const newGrid = {
      price_low:      round50(base_normal * SEASON_MULT.low),
      price_normal:   round50(base_normal * SEASON_MULT.normal),
      price_high:     round50(base_normal * SEASON_MULT.high),
      price_veryhigh: round50(base_normal * SEASON_MULT.veryhigh),
      price_peak:     round50(base_normal * SEASON_MULT.peak)
    };

    const sources = {
      airoi:     a1 ? { raw: airoiAvg, weighted: Math.round(a1), comp_count: airoiCount } : null,
      palace:    { raw: PALACE_ANCHOR.normal, weighted: Math.round(a2) },
      historique: a3 ? { raw: a3, weighted: a3, seasons_used: Object.keys(histAvg).filter(s=>histAvg[s]!==null) } : null
    };

    if (!body.dry_run) {
      // 5. MISE À JOUR villa_settings
      const { error } = await sb.from('villa_settings')
        .update({
          ...newGrid,
          calibration_base:    base_normal,
          calibration_sources: { formula, confidence, sources, computed_at: new Date().toISOString() },
          last_calibrated_at:  new Date().toISOString()
        })
        .eq('owner_id', body.owner_id);

      if (error) throw new Error(`Update failed: ${error.message}`);
    }

    return new Response(JSON.stringify({
      dry_run:      !!body.dry_run,
      confidence,
      base_normal,
      formula,
      new_grid:     newGrid,
      sources,
      historique_filtered: histAvg,
      note: body.dry_run
        ? 'Simulation — aucune mise à jour effectuée'
        : `Villa_settings mis à jour. Confiance ${confidence}. Recalibrer dans 7 jours.`
    }, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
