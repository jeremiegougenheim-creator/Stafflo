import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MARRAKECH_LAT = 31.6295;
const MARRAKECH_LON = -7.9811;
const OWNER_ID_HEADER = 'x-owner-id';

// Grille hôtels 5★ palace Marrakech (issues du code app.html lignes 21641-21649)
// Toujours disponible même sans scrape — confidence C si seule source
const HOTEL_GRID: Record<string, Record<string,number>> = {
  palace:  { low:700, normal:950, high:1400, peak:2200 },
  boutique:{ low:350, normal:450, high:620,  peak:950  }
};

function getSeason(month: number): string {
  if (month === 12 || month === 1)             return 'peak';
  if (month === 7  || month === 8)             return 'high';
  if ([3,4,10,11].includes(month))             return 'high';
  if (month === 5  || month === 6)             return 'low';
  return 'normal';
}

function getEventMultiplier(date: Date): { mult: number; name: string | null } {
  const m = date.getMonth()+1, d = date.getDate();
  if ((m===12&&d>=21)||(m===1&&d<=2)) return { mult:1.5, name:'Noël/Réveillon' };
  if (m===10&&d>=9&&d<=17)           return { mult:1.25, name:'Festival Film Marrakech' };
  if (m===6&&d>=19&&d<=23)           return { mult:1.08, name:'Festival Gnaoua Essaouira' };
  if (m===10&&d>=17&&d<=31)          return { mult:1.25, name:'Vacances Toussaint FR' };
  return { mult:1, name:null };
}

async function fetchWeather(targetDate: string) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${MARRAKECH_LAT}&longitude=${MARRAKECH_LON}&daily=temperature_2m_max,precipitation_sum&start_date=${targetDate}&end_date=${targetDate}&timezone=Africa%2FCasablanca`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const temp = j.daily?.temperature_2m_max?.[0];
    const rain = j.daily?.precipitation_sum?.[0];
    if (temp == null) return null;
    // Score météo : 22-28°C + pas de pluie = premium (+5%), pluie = malus (-5%)
    const score = (rain < 1 && temp >= 20 && temp <= 30) ? 1.05 : (rain > 5 ? 0.95 : 1.0);
    return { temp, rain, score, source: 'Open-Meteo' };
  } catch { return null; }
}

async function fetchLeCollectionist(): Promise<number | null> {
  try {
    const url = 'https://www.lecollectionist.com/fr/villa/maroc/marrakech';
    const r = await fetch(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; price-intelligence/1.0)',
      'Accept': 'text/html,application/xhtml+xml'
    }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const html = await r.text();
    // Cherche les prix en EUR dans le HTML (pattern: "1 200 €/nuit" ou "1200€")
    const matches = [...html.matchAll(/(\d[\d\s]{2,5})\s*[€$]\s*(?:\/\s*nuit|\/\s*night|per night)?/gi)];
    const prices = matches
      .map(m => parseInt(m[1].replace(/\s/g, '')))
      .filter(p => p >= 500 && p <= 10000);
    if (!prices.length) return null;
    prices.sort((a,b) => a-b);
    // Retourne la médiane (ignore outliers bas/haut)
    return prices[Math.floor(prices.length / 2)];
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-owner-id'
    }});
  }

  try {
    const body = await req.json() as { target_date?: string; nights?: number };
    const targetDate = body.target_date || new Date().toISOString().slice(0,10);
    const date = new Date(targetDate);
    const month = date.getMonth()+1;
    const season = getSeason(month);
    const { mult: evMult, name: evName } = getEventMultiplier(date);

    // Grille hôtel palace (toujours disponible — ancre haute)
    const hotelAnchor = HOTEL_GRID.palace[season];

    // Open-Meteo (async, best-effort)
    const weather = await fetchWeather(targetDate);

    // Le Collectionist (async, best-effort)
    const lcPrice = await fetchLeCollectionist();

    // Sources collectées
    const sources: Array<{ name:string; value:number; weight:number }> = [
      { name: 'Grille hôtels 5★ palace Marrakech', value: hotelAnchor, weight: 0.4 }
    ];

    if (lcPrice) {
      sources.push({ name: 'Le Collectionist Marrakech (médiane)', value: lcPrice, weight: 0.45 });
    }

    // Calcul prix
    // Villa DarJ = au-dessus du palace (villa entière staffée) mais en dessous du LC si dispo
    const baseAnchor = lcPrice
      ? (lcPrice * 0.55 + hotelAnchor * 0.45)   // mix LC + palace
      : hotelAnchor * 0.85;                       // palace seul → villa = 85% ancre palace

    const weatherMult = weather?.score ?? 1.0;
    const rawPrice = baseAnchor * evMult * weatherMult;
    // Arrondi propre à 50€
    const suggestedPrice = Math.round(rawPrice / 50) * 50;

    // Badge confiance
    const sourceCount = sources.length + (weather ? 1 : 0);
    const confidence = sourceCount >= 3 ? 'A' : sourceCount === 2 ? 'B' : 'C';

    const result = {
      target_date: targetDate,
      season,
      suggested_price: suggestedPrice,
      confidence,
      sources,
      signals: {
        hotel_anchor: hotelAnchor,
        lc_villa_median: lcPrice ?? null,
        event: evName ? { name: evName, multiplier: evMult } : null,
        weather: weather ? { temp: weather.temp, rain: weather.rain, score: weather.score } : null
      },
      label: `${suggestedPrice}€/nuit · Confiance ${confidence}`,
      note: 'Mesuré, pas modélisé — sources: ' + sources.map(s=>s.name).join(' · ') + (weather ? ' · Open-Meteo' : '')
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
