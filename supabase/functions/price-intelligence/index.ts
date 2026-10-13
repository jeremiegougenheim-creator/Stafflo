import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// v17 (13/10/2026, audit SaaS) — sur la base de v16 (géo-paramétrique), quatre corrections :
//   1. Le propriétaire vient du JWT (auth.getUser). Avant : `owner_id` lu dans le corps,
//      avec la clé service role → n'importe qui lisait la grille, la commission, le
//      plancher et l'occupation de n'importe quel compte.
//   2. Événements lus dans la table `events` du propriétaire (sourcée, suppressions
//      douces exclues). Avant : dates de Marrakech en dur, fausses (festival du film
//      « 9-17 oct. » au lieu du 20-28 nov.) et jamais appliquées si la ville était
//      écrite « Marrakech, Maroc ».
//   3. Ville inconnue → pas de météo (avant : la météo de Marrakech pour tout le monde).
//   4. Villa sans grille de prix → { error: 'grid_missing' } au lieu de la grille de
//      Marrakech (650…1200 €) présentée comme la sienne.
// v18 (13/10/2026, multi-villa) : événements lus avec le jeton du propriétaire → la RLS
//   ajoute les dates fortes partagées de sa destination (events.owner_id null, pays/ville).
// Le moteur lui-même (saison, modificateurs, comparables, occupation, délai) est inchangé :
// décision du 11/07/2026 « garder le moteur existant ».

const DEFAULT_COMMISSION = 0.155, DEFAULT_FLOOR = 500, DEFAULT_CAPACITY = 8, DEFAULT_EXTRA = 50;
const ALLOWED_ORIGINS = new Set(['https://stafflo.app', 'https://www.stafflo.app', 'https://jeremiegougenheim-creator.github.io']);

const CITY_GEO: Record<string,{lat:number;lon:number;tz:string}> = {
  marrakech: { lat:31.6295, lon:-7.9811, tz:'Africa/Casablanca' },
  paris:     { lat:48.8566, lon:2.3522,  tz:'Europe/Paris' },
  comporta:  { lat:38.3833, lon:-8.7833, tz:'Europe/Lisbon' },
  lisbon:    { lat:38.7223, lon:-9.1393, tz:'Europe/Lisbon' },
  phuket:    { lat:7.8804,  lon:98.3923, tz:'Asia/Bangkok' },
  bali:      { lat:-8.4095, lon:115.1889,tz:'Asia/Makassar' },
  denpasar:  { lat:-8.6705, lon:115.2126,tz:'Asia/Makassar' },
  marbella:  { lat:36.5101, lon:-4.8824, tz:'Europe/Madrid' }
};
// « Marrakech, Maroc » → « marrakech ». Ville inconnue → null (pas de météo inventée).
export function cityKey(city: string | null | undefined): string {
  return String(city || '').split(',')[0].trim().toLowerCase();
}
function geoFor(key: string){ return CITY_GEO[key] || null; }

function getSeason(m: number): string {
  if (m===12||m===1) return 'peak'; if (m===7||m===8) return 'veryhigh';
  if ([3,4,10,11].includes(m)) return 'high'; if (m===5||m===6) return 'low'; return 'normal';
}
function applyMods(base:number, o:{event?:boolean;weekend?:boolean;lastmin?:boolean;longstay?:boolean;nights?:number}):number {
  let p=base;
  if(o.event) p=Math.round(p*1.15); if(o.weekend) p=p+50;
  if(o.lastmin) p=Math.round(p*0.85); if(o.longstay&&(o.nights||0)>=14) p=Math.round(p*0.80);
  return p;
}
// deno-lint-ignore no-explicit-any
export function pickEvent(rows: any[], day: string): {isEvent:boolean;name:string|null;mult:number} {
  const hit = (rows || [])
    .filter((e) => e && e.start_date <= day && day <= e.end_date && Number(e.demand_impact) >= 1)
    .sort((a, b) => Number(b.demand_impact) - Number(a.demand_impact))[0];
  return hit ? { isEvent: true, name: String(hit.name), mult: 1.15 } : { isEvent: false, name: null, mult: 1.0 };
}
function isWeekend(d:Date):boolean { const day=d.getUTCDay(); return day===0||day===5||day===6; }
async function fetchWeather(t:string, lat:number, lon:number, tz:string) {
  try {
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,precipitation_sum&start_date=${t}&end_date=${t}&timezone=${encodeURIComponent(tz)}`,{signal:AbortSignal.timeout(5000)});
    if(!r.ok) return null;
    const j=await r.json(), temp=j.daily?.temperature_2m_max?.[0], rain=j.daily?.precipitation_sum?.[0];
    if(temp==null) return null;
    return {temp:Math.round(temp),rain:Math.round(rain*10)/10,score:(rain<1&&temp>=18&&temp<=32)?1.03:(rain>8?0.95:1.0)};
  } catch { return null; }
}
async function fetchComps(url:string,key:string,city:string,country:string,bedrooms:number) {
  try {
    const r=await fetch(`${url}/functions/v1/market-comps`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({city,country,bedrooms}),signal:AbortSignal.timeout(8000)});
    if(!r.ok) return null;
    const j=await r.json();
    const d=j?.data;
    return (d && typeof d.adr_eur==='number' && (d.comp_count||0)>=3)?{avg_price:Math.round(d.adr_eur),comp_count:d.comp_count}:null;
  } catch { return null; }
}

Deno.serve(async (req:Request) => {
  const origin = req.headers.get('origin') || '';
  const cors: Record<string,string> = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://stafflo.app',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  try {
    const SB_URL=Deno.env.get('SUPABASE_URL')??'', SVC=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'', ANON=Deno.env.get('SUPABASE_ANON_KEY')??'';
    // 1. Qui appelle ? Un utilisateur connecté, et lui seul.
    const auth = req.headers.get('authorization') || '';
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const ownerId = user.id;

    const body=await req.json().catch(()=>({})) as {target_date?:string;nights?:number;guests?:number;event?:boolean;lastmin?:boolean;longstay?:boolean};
    const targetDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.target_date||''))?String(body.target_date):new Date().toISOString().slice(0,10);
    const nights=body.nights||1, guests=body.guests||0;
    const date=new Date(targetDate+'T12:00:00Z'), month=date.getUTCMonth()+1;
    const season=getSeason(month), weekend=isWeekend(date);

    const sb=createClient(SB_URL,SVC);
    const {data}=await sb.from('villa_settings').select('price_low,price_normal,price_high,price_veryhigh,price_peak,commission_rate,min_price,max_price,extra_guest_fee,base_capacity,calibration_sources,last_calibrated_at,city,country,bedrooms').eq('owner_id',ownerId).order('created_at',{ascending:true}).limit(1).maybeSingle();
    if(!data) return json({ error:'villa_missing', message:'Aucune villa enregistrée pour ce compte.' });
    // 4. Pas de grille → on le dit, on n'en invente pas une.
    const gridRaw: Record<string, number|null> = { low:data.price_low, normal:data.price_normal, high:data.price_high, veryhigh:data.price_veryhigh, peak:data.price_peak };
    const known = Object.values(gridRaw).filter((v) => typeof v === 'number' && v > 0) as number[];
    if(!known.length) return json({ error:'grid_missing', message:'Grille de prix par saison à renseigner (Réglages › Prix).' });
    const fallbackPrice = known[0];
    const grid: Record<string, number> = {};
    for (const k of Object.keys(gridRaw)) grid[k] = (typeof gridRaw[k] === 'number' && (gridRaw[k] as number) > 0) ? gridRaw[k] as number : fallbackPrice;
    const commRate = data.commission_rate ? parseFloat(String(data.commission_rate)) : DEFAULT_COMMISSION;
    const floor = data.min_price || DEFAULT_FLOOR;
    const extraFee = data.extra_guest_fee ? parseFloat(String(data.extra_guest_fee)) : DEFAULT_EXTRA;
    const capacity = data.base_capacity || DEFAULT_CAPACITY;
    const gridSource = 'villa_settings';
    const calibSource = data.calibration_sources ? 'price-calibrate' : 'manual';
    const calibDate: string|null = data.calibration_sources ? (data.last_calibrated_at||null) : null;
    const calibFormula: string|null = (data.calibration_sources && data.calibration_sources.formula) ? data.calibration_sources.formula : null;
    const villaCity = cityKey(data.city), villaCountry = String(data.country || ''), villaBedrooms = data.bedrooms || 0;

    // 2. Événements (sourcés) lus AVEC LE JETON DU PROPRIÉTAIRE : la RLS renvoie ses lignes
    //    + les dates fortes partagées de SA destination (pays/ville de sa villa), jamais celles d'une autre.
    const { data: evRows } = await asUser.from('events').select('name,start_date,end_date,demand_impact').is('deleted_at', null).lte('start_date', targetDate).gte('end_date', targetDate);
    const eventSig = pickEvent(evRows || [], targetDate);
    const geo = geoFor(villaCity);

    let fillRate=0.5, occupancyMult=1.0, occupancyLabel='Neutre (50%)';
    {
      const today=new Date().toISOString().slice(0,10);
      const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
      const {data:ocData}=await sb.from('crm_clients').select('arrival,departure').eq('user_id',ownerId).eq('booking_status','confirmed').not('arrival','is',null).not('departure','is',null).is('deleted_at',null);
      if(ocData) {
        let bookedDays=0;
        for(let d=new Date(today); d<new Date(future); d.setDate(d.getDate()+1)) {
          const ds=d.toISOString().slice(0,10);
          if(ocData.some(b=>ds>=b.arrival&&ds<b.departure)) bookedDays++;
        }
        fillRate=bookedDays/30;
        if(fillRate<0.30){occupancyMult=0.92;occupancyLabel=`Faible (${Math.round(fillRate*100)}%) -> -8%`;}
        else if(fillRate>0.60){occupancyMult=1.12;occupancyLabel=`Fort (${Math.round(fillRate*100)}%) -> +12%`;}
        else occupancyLabel=`Modere (${Math.round(fillRate*100)}%)`;
      }
    }

    const daysAhead=Math.round((date.getTime()-Date.now())/86400000);
    let leadMult=1.0, leadLabel='Standard';
    if(daysAhead<=3){leadMult=0.85;leadLabel=`J-${daysAhead} last-minute -> -15%`;}
    else if(daysAhead<=14){leadMult=0.90;leadLabel=`J-${daysAhead} -> -10%`;}
    else if(daysAhead>=90){leadMult=1.05;leadLabel=`J+${daysAhead} anticipe -> +5%`;}

    const useEvent=body.event??eventSig.isEvent, useLastmin=body.lastmin??false;
    const useLongstay=body.longstay??(nights>=14);
    let price=applyMods(grid[season],{event:useEvent,weekend,lastmin:useLastmin,longstay:useLongstay,nights});
    price=Math.max(floor,Math.round(price/50)*50);

    const [weatherRes,compsRes]=await Promise.allSettled([
      geo ? fetchWeather(targetDate,geo.lat,geo.lon,geo.tz) : Promise.resolve(null),
      villaCity && villaBedrooms ? fetchComps(SB_URL,SVC,villaCity,villaCountry,villaBedrooms) : Promise.resolve(null),
    ]);
    const weather=weatherRes.status==='fulfilled'?weatherRes.value:null;
    const comps=compsRes.status==='fulfilled'?compsRes.value:null;

    let finalPrice=price;
    if(comps){const ca=Math.round(comps.avg_price*1.30);finalPrice=Math.round((price*0.6+ca*0.4)/50)*50;}
    if(weather&&weather.score!==1.0) finalPrice=Math.round(finalPrice*weather.score/50)*50;
    finalPrice=Math.round(finalPrice*occupancyMult/50)*50;
    finalPrice=Math.round(finalPrice*leadMult/50)*50;
    finalPrice=Math.max(floor,finalPrice);
    if(data.max_price) finalPrice=Math.min(Number(data.max_price),finalPrice);

    const guestExtra=guests>capacity?(guests-capacity)*extraFee:0;
    const pricePN=finalPrice+guestExtra, commPN=Math.round(pricePN*commRate), netPN=pricePN-commPN;

    const liveCount=(comps?1:0)+(weather?1:0)+(occupancyMult!==1.0?1:0);
    const confidence=liveCount>=3?'A':liveCount>=2?'B':'C';

    const _baseProv = calibSource==='price-calibrate'
      ? `Base ${grid[season]} EUR - calibree auto${calibDate?(' le '+new Date(calibDate).toLocaleDateString('fr-FR')):''}`
      : `Base ${grid[season]} EUR - configuree manuellement (Reglages)`;
    const _place = villaCity ? villaCity.charAt(0).toUpperCase()+villaCity.slice(1) : '?';
    const info_card = [
      `Lieu: ${_place} - ${villaBedrooms || '?'} ch`,
      `Saison: ${season} - ${_baseProv}`,
      useEvent&&eventSig.name ? `Evenement: ${eventSig.name} +15%` : null,
      weekend ? 'Week-end +50 EUR' : null,
      comps ? `AirROI: ${comps.comp_count} comps - moy ${comps.avg_price} EUR x1.30 -> ${Math.round(comps.avg_price*1.30)} EUR` : 'AirROI: <3 comps (ignore, honnete)',
      weather ? `Meteo: ${weather.temp}C - ${weather.rain}mm -> x${weather.score}` : (geo ? 'Meteo: hors fenetre 16j' : 'Meteo: ville non couverte'),
      `Occupation 30j: ${occupancyLabel}`,
      `Delai reservation: ${leadLabel}`,
      `Commission: ${(commRate*100).toFixed(1)}% -> NET ${netPN} EUR/nuit`,
      `Mesure, pas modelise - Confiance ${confidence}`
    ].filter(Boolean);

    return json({
      target_date:targetDate, place:_place, city:villaCity, bedrooms:villaBedrooms,
      season, nights, guests, suggested_price:finalPrice, confidence, floor,
      grid_source:gridSource, grid,
      calibration_source:calibSource, calibration_date:calibDate, calibration_formula:calibFormula,
      breakdown:{season_base:grid[season],after_mods:price,after_comps:comps?Math.round((price*0.6+Math.round(comps.avg_price*1.30)*0.4)/50)*50:price,after_occupancy:Math.round(finalPrice/leadMult/50)*50,after_lead:finalPrice},
      financials:{price_per_night:finalPrice,guest_extra:guestExtra,price_with_guests:pricePN,airbnb_commission:commPN,net_per_night:netPN,gross_total:pricePN*nights,net_total:netPN*nights,commission_rate:`${(commRate*100).toFixed(1)}%`},
      modifiers:{event:useEvent,weekend,lastmin:useLastmin,longstay:useLongstay},
      signals:{
        event:eventSig.name?{name:eventSig.name,multiplier:eventSig.mult}:null,
        market_comps:comps?{avg_price:comps.avg_price,comp_count:comps.comp_count,villa_premium:'x1.30'}:null,
        weather:weather?{temp:weather.temp,rain:weather.rain,score:weather.score}:null,
        occupancy:{fill_rate_30d:Math.round(fillRate*100),multiplier:occupancyMult,label:occupancyLabel},
        lead_time:{days_ahead:daysAhead,multiplier:leadMult,label:leadLabel}
      },
      info_card,
      label:`${finalPrice} EUR/nuit - NET ${netPN} EUR - Confiance ${confidence}`,
      note:`Mesure, pas modelise - ${_place} - ${gridSource} (${season} ${grid[season]} EUR, ${calibSource}) + occupation ${Math.round(fillRate*100)}% + lead J${daysAhead>=0?'+':''}${daysAhead}`
    });
  } catch(e) {
    console.error('[price-intelligence]', e);
    return json({ error: 'internal' }, 500);
  }
});
