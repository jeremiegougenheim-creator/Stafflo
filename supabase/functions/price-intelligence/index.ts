import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VILLA_LAT = 31.6295;
const VILLA_LON = -7.9811;

// Grille par défaut si villa_settings non accessible
const DEFAULT_GRID: Record<string,number> = {
  low:650, normal:750, high:850, veryhigh:950, peak:1500
};
const DEFAULT_COMMISSION = 0.155;
const DEFAULT_FLOOR = 500;
const DEFAULT_BASE_CAPACITY = 8;
const DEFAULT_EXTRA_GUEST = 50;

function getSeason(month: number): string {
  if (month===12||month===1)         return 'peak';
  if (month===7||month===8)          return 'veryhigh';
  if ([3,4,10,11].includes(month))   return 'high';
  if (month===5||month===6)          return 'low';
  return 'normal';
}

function applyMods(base:number, opts:{event?:boolean;weekend?:boolean;lastmin?:boolean;longstay?:boolean;nights?:number}):number {
  let p = base;
  if (opts.event)                            p = Math.round(p*1.15);
  if (opts.weekend)                          p = p+50;
  if (opts.lastmin)                          p = Math.round(p*0.85);
  if (opts.longstay && (opts.nights||0)>=14) p = Math.round(p*0.80);
  return p;
}

function getEventSignal(date:Date):{isEvent:boolean;name:string|null;mult:number} {
  const m=date.getUTCMonth()+1, d=date.getUTCDate();
  if ((m===12&&d>=21)||(m===1&&d<=2)) return {isEvent:true, name:'Noel/Reveillon',            mult:1.0};
  if (m===10&&d>=9&&d<=17)            return {isEvent:true, name:'Festival Film Marrakech',   mult:1.15};
  if (m===6&&d>=19&&d<=23)            return {isEvent:true, name:'Festival Gnaoua Essaouira', mult:1.05};
  if (m===10&&d>=17&&d<=31)           return {isEvent:true, name:'Vacances Toussaint FR',     mult:1.10};
  if (m===2&&d>=12&&d<=17)            return {isEvent:true, name:'Saint-Valentin / vacances', mult:1.08};
  if ([4,5].includes(m))              return {isEvent:true, name:'Pont printemps FR',         mult:1.05};
  return {isEvent:false, name:null, mult:1.0};
}

function isWeekend(date:Date):boolean { const d=date.getUTCDay(); return d===0||d===5||d===6; }

async function fetchWeather(targetDate:string) {
  try {
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${VILLA_LAT}&longitude=${VILLA_LON}&daily=temperature_2m_max,precipitation_sum&start_date=${targetDate}&end_date=${targetDate}&timezone=Africa%2FCasablanca`;
    const r=await fetch(url,{signal:AbortSignal.timeout(5000)});
    if(!r.ok) return null;
    const j=await r.json();
    const temp=j.daily?.temperature_2m_max?.[0], rain=j.daily?.precipitation_sum?.[0];
    if(temp==null) return null;
    const score=(rain<1&&temp>=18&&temp<=32)?1.03:(rain>8?0.95:1.0);
    return {temp:Math.round(temp), rain:Math.round(rain*10)/10, score};
  } catch { return null; }
}

async function fetchMarketComps(supabaseUrl:string, serviceKey:string):Promise<{avg_price:number;comp_count:number}|null> {
  try {
    const r=await fetch(`${supabaseUrl}/functions/v1/market-comps`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${serviceKey}`},
      body:JSON.stringify({location:'Marrakech',bedrooms:5,currency:'EUR'}),
      signal:AbortSignal.timeout(8000)
    });
    if(!r.ok) return null;
    const j=await r.json();
    if(!j.avg_price||j.comp_count<3) return null;
    return {avg_price:Math.round(j.avg_price), comp_count:j.comp_count};
  } catch { return null; }
}

Deno.serve(async (req:Request) => {
  if(req.method==='OPTIONS') return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type'}});

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')??"";
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??"";

    const body = await req.json() as {target_date?:string;nights?:number;event?:boolean;lastmin?:boolean;longstay?:boolean;owner_id?:string;guests?:number};
    const targetDate = body.target_date||new Date().toISOString().slice(0,10);
    const nights     = body.nights||1;
    const guests     = body.guests||0;
    const date       = new Date(targetDate+'T12:00:00Z');
    const month      = date.getUTCMonth()+1;
    const season     = getSeason(month);
    const eventSig   = getEventSignal(date);
    const weekend    = isWeekend(date);

    // === LIRE la grille depuis villa_settings (source de vérité) ===
    let grid = {...DEFAULT_GRID};
    let commissionRate = DEFAULT_COMMISSION;
    let villaFloor     = DEFAULT_FLOOR;
    let villaCap:number|null = null;
    let extraGuestFee  = DEFAULT_EXTRA_GUEST;
    let baseCapacity   = DEFAULT_BASE_CAPACITY;
    let gridSource     = 'defaults';

    if (SUPABASE_URL && SERVICE_KEY && body.owner_id) {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY);
        const {data} = await sb.from('villa_settings')
          .select('price_low,price_normal,price_high,price_veryhigh,price_peak,commission_rate,min_price,max_price,extra_guest_fee,base_capacity')
          .eq('owner_id', body.owner_id)
          .order('created_at', {ascending:true})
          .limit(1)
          .single();
        if (data) {
          if (data.price_low)      grid.low      = data.price_low;
          if (data.price_normal)   grid.normal   = data.price_normal;
          if (data.price_high)     grid.high     = data.price_high;
          if (data.price_veryhigh) grid.veryhigh = data.price_veryhigh;
          if (data.price_peak)     grid.peak     = data.price_peak;
          if (data.commission_rate) commissionRate = parseFloat(data.commission_rate);
          if (data.min_price)      villaFloor    = data.min_price;
          if (data.max_price)      villaCap      = data.max_price;
          if (data.extra_guest_fee) extraGuestFee = parseFloat(data.extra_guest_fee);
          if (data.base_capacity)  baseCapacity  = data.base_capacity;
          gridSource = 'villa_settings';
        }
      } catch { /* use defaults */ }
    }

    // === CALCUL (même logique que getPrice() dans app.html) ===
    const seasonBase   = grid[season];
    const useEvent     = body.event??eventSig.isEvent;
    const useLastmin   = body.lastmin??false;
    const useLongstay  = body.longstay??(nights>=14);

    let price = applyMods(seasonBase, {event:useEvent, weekend, lastmin:useLastmin, longstay:useLongstay, nights});
    price     = Math.max(villaFloor, Math.round(price/50)*50);
    if (villaCap) price = Math.min(villaCap, price);

    // Supplément guests
    const guestExtra = guests>baseCapacity ? (guests-baseCapacity)*extraGuestFee : 0;

    // === MARKET COMPS (AirROI) ===
    const comps = await fetchMarketComps(SUPABASE_URL, SERVICE_KEY);
    let finalPrice = price;
    if (comps) {
      const compAnchor = Math.round(comps.avg_price*1.30);
      finalPrice = Math.round((price*0.6+compAnchor*0.4)/50)*50;
      finalPrice = Math.max(villaFloor, finalPrice);
      if (villaCap) finalPrice = Math.min(villaCap, finalPrice);
    }

    // === MÉTÉO ===
    const weather = await fetchWeather(targetDate);
    if (weather && weather.score!==1.0) {
      finalPrice = Math.max(villaFloor, Math.round(finalPrice*weather.score/50)*50);
    }

    // === FINANCIALS ===
    const pricePN    = finalPrice + guestExtra;
    const commPN     = Math.round(pricePN*commissionRate);
    const netPN      = pricePN-commPN;
    const grossTotal = pricePN*nights;
    const netTotal   = netPN*nights;

    // === CONFIANCE ===
    const liveCount  = (comps?1:0)+(weather?1:0);
    const confidence = liveCount>=2?'A':liveCount===1?'B':'C';

    return new Response(JSON.stringify({
      target_date:  targetDate,
      season,
      nights,
      guests,
      suggested_price: finalPrice,
      confidence,
      floor: villaFloor,
      grid_source: gridSource,
      grid,
      breakdown: {
        season_base:  seasonBase,
        after_mods:   price,
        after_comps:  comps?Math.round((price*0.6+Math.round(comps.avg_price*1.30)*0.4)/50)*50:price,
        after_weather: finalPrice
      },
      financials: {
        price_per_night: finalPrice,
        guest_extra:     guestExtra,
        price_with_guests: pricePN,
        airbnb_commission: commPN,
        net_per_night:   netPN,
        gross_total:     grossTotal,
        net_total:       netTotal,
        commission_rate: `${(commissionRate*100).toFixed(1)}%`
      },
      modifiers_applied: {event:useEvent, weekend, lastmin:useLastmin, longstay:useLongstay},
      signals: {
        event: eventSig.name?{name:eventSig.name, multiplier:eventSig.mult}:null,
        market_comps: comps?{avg_price:comps.avg_price, comp_count:comps.comp_count, villa_premium:'x1.30'}:null,
        weather: weather?{temp:weather.temp, rain:weather.rain, score:weather.score}:null
      },
      label: `${finalPrice}€/nuit · NET ${netPN}€ · Confiance ${confidence}`,
      note: `Mesuré, pas modélisé — grille ${gridSource} (${season} ${seasonBase}€) + ${comps?`AirROI ${comps.comp_count} comps`:'grille seule'} + ${weather?'météo live':'météo N/A'}`
    }, null, 2), {
      headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });

  } catch(e) {
    return new Response(JSON.stringify({error:String(e)}),{
      status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });
  }
});
