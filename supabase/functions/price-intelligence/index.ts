import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VILLA_LAT = 31.6295, VILLA_LON = -7.9811;
const DEFAULT_GRID: Record<string,number> = { low:650, normal:750, high:850, veryhigh:950, peak:1200 };
const DEFAULT_COMMISSION = 0.155, DEFAULT_FLOOR = 500, DEFAULT_CAPACITY = 8, DEFAULT_EXTRA = 50;

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
function getEvent(date:Date):{isEvent:boolean;name:string|null;mult:number} {
  const m=date.getUTCMonth()+1,d=date.getUTCDate();
  if((m===12&&d>=21)||(m===1&&d<=2)) return {isEvent:true,name:'Noel/Reveillon',mult:1.0};
  if(m===10&&d>=9&&d<=17) return {isEvent:true,name:'Festival Film Marrakech',mult:1.15};
  if(m===6&&d>=19&&d<=23) return {isEvent:true,name:'Festival Gnaoua Essaouira',mult:1.05};
  if(m===10&&d>=17&&d<=31) return {isEvent:true,name:'Vacances Toussaint FR',mult:1.10};
  if(m===2&&d>=12&&d<=17) return {isEvent:true,name:'Saint-Valentin / vacances',mult:1.08};
  if([4,5].includes(m)) return {isEvent:true,name:'Pont printemps FR',mult:1.05};
  return {isEvent:false,name:null,mult:1.0};
}
function isWeekend(d:Date):boolean { const day=d.getUTCDay(); return day===0||day===5||day===6; }
async function fetchWeather(t:string) {
  try {
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${VILLA_LAT}&longitude=${VILLA_LON}&daily=temperature_2m_max,precipitation_sum&start_date=${t}&end_date=${t}&timezone=Africa%2FCasablanca`,{signal:AbortSignal.timeout(5000)});
    if(!r.ok) return null;
    const j=await r.json(), temp=j.daily?.temperature_2m_max?.[0], rain=j.daily?.precipitation_sum?.[0];
    if(temp==null) return null;
    return {temp:Math.round(temp),rain:Math.round(rain*10)/10,score:(rain<1&&temp>=18&&temp<=32)?1.03:(rain>8?0.95:1.0)};
  } catch { return null; }
}
async function fetchComps(url:string,key:string) {
  try {
    const r=await fetch(`${url}/functions/v1/market-comps`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({location:'Marrakech',bedrooms:5,currency:'EUR'}),signal:AbortSignal.timeout(8000)});
    if(!r.ok) return null;
    const j=await r.json();
    return (j.avg_price&&j.comp_count>=3)?{avg_price:Math.round(j.avg_price),comp_count:j.comp_count}:null;
  } catch { return null; }
}

Deno.serve(async (req:Request) => {
  if(req.method==='OPTIONS') return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type'}});
  try {
    const SB_URL=Deno.env.get('SUPABASE_URL')??'', SVC=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
    const body=await req.json() as {target_date?:string;nights?:number;guests?:number;event?:boolean;lastmin?:boolean;longstay?:boolean;owner_id?:string};
    const targetDate=body.target_date||new Date().toISOString().slice(0,10);
    const nights=body.nights||1, guests=body.guests||0;
    const date=new Date(targetDate+'T12:00:00Z'), month=date.getUTCMonth()+1;
    const season=getSeason(month), eventSig=getEvent(date), weekend=isWeekend(date);

    // 1. Villa settings depuis Supabase + provenance calibration
    let grid={...DEFAULT_GRID}, commRate=DEFAULT_COMMISSION, floor=DEFAULT_FLOOR;
    let extraFee=DEFAULT_EXTRA, capacity=DEFAULT_CAPACITY, gridSource='defaults';
    let calibSource='manual', calibDate:string|null=null, calibFormula:string|null=null;
    const sb=createClient(SB_URL,SVC);
    if(body.owner_id) {
      const {data}=await sb.from('villa_settings').select('price_low,price_normal,price_high,price_veryhigh,price_peak,commission_rate,min_price,max_price,extra_guest_fee,base_capacity,calibration_sources,last_calibrated_at').eq('owner_id',body.owner_id).order('created_at',{ascending:true}).limit(1).single();
      if(data) {
        if(data.price_low) grid.low=data.price_low;
        if(data.price_normal) grid.normal=data.price_normal;
        if(data.price_high) grid.high=data.price_high;
        if(data.price_veryhigh) grid.veryhigh=data.price_veryhigh;
        if(data.price_peak) grid.peak=data.price_peak;
        if(data.commission_rate) commRate=parseFloat(data.commission_rate);
        if(data.min_price) floor=data.min_price;
        if(data.extra_guest_fee) extraFee=parseFloat(data.extra_guest_fee);
        if(data.base_capacity) capacity=data.base_capacity;
        gridSource='villa_settings';
        // Provenance: calibrée auto seulement si calibration_sources existe
        if(data.calibration_sources){
          calibSource='price-calibrate';
          calibDate=data.last_calibrated_at||null;
          calibFormula=(data.calibration_sources&&data.calibration_sources.formula)?data.calibration_sources.formula:null;
        }
      }
    }

    // 2. Occupation 30j — signal pression (PriceLabs style)
    let fillRate=0.5, occupancyMult=1.0, occupancyLabel='Neutre (50%)';
    if(body.owner_id) {
      const today=new Date().toISOString().slice(0,10);
      const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
      const {data:ocData}=await sb.from('crm_clients').select('arrival,departure').eq('user_id',body.owner_id).eq('booking_status','confirmed').not('arrival','is',null).not('departure','is',null).is('deleted_at',null);
      if(ocData) {
        let bookedDays=0;
        for(let d=new Date(today); d<new Date(future); d.setDate(d.getDate()+1)) {
          const ds=d.toISOString().slice(0,10);
          if(ocData.some(b=>ds>=b.arrival&&ds<b.departure)) bookedDays++;
        }
        fillRate=bookedDays/30;
        if(fillRate<0.30){occupancyMult=0.92;occupancyLabel=`Faible (${Math.round(fillRate*100)}%) → -8%`;}
        else if(fillRate>0.60){occupancyMult=1.12;occupancyLabel=`Fort (${Math.round(fillRate*100)}%) → +12%`;}
        else occupancyLabel=`Modéré (${Math.round(fillRate*100)}%)`;
      }
    }

    // 3. Lead time adjustment (Beyond Pricing style)
    const daysAhead=Math.round((date.getTime()-Date.now())/86400000);
    let leadMult=1.0, leadLabel='Standard';
    if(daysAhead<=3){leadMult=0.85;leadLabel=`J-${daysAhead} last-minute → -15%`;}
    else if(daysAhead<=14){leadMult=0.90;leadLabel=`J-${daysAhead} → -10%`;}
    else if(daysAhead>=90){leadMult=1.05;leadLabel=`J+${daysAhead} anticipé → +5%`;}

    // 4. Calcul prix
    const useEvent=body.event??eventSig.isEvent, useLastmin=body.lastmin??false;
    const useLongstay=body.longstay??(nights>=14);
    let price=applyMods(grid[season],{event:useEvent,weekend,lastmin:useLastmin,longstay:useLongstay,nights});
    price=Math.max(floor,Math.round(price/50)*50);

    const [weatherRes,compsRes]=await Promise.allSettled([fetchWeather(targetDate),fetchComps(SB_URL,SVC)]);
    const weather=weatherRes.status==='fulfilled'?weatherRes.value:null;
    const comps=compsRes.status==='fulfilled'?compsRes.value:null;

    let finalPrice=price;
    if(comps){const ca=Math.round(comps.avg_price*1.30);finalPrice=Math.round((price*0.6+ca*0.4)/50)*50;}
    if(weather&&weather.score!==1.0) finalPrice=Math.round(finalPrice*weather.score/50)*50;
    finalPrice=Math.round(finalPrice*occupancyMult/50)*50;
    finalPrice=Math.round(finalPrice*leadMult/50)*50;
    finalPrice=Math.max(floor,finalPrice);

    // 5. Financials
    const guestExtra=guests>capacity?(guests-capacity)*extraFee:0;
    const pricePN=finalPrice+guestExtra, commPN=Math.round(pricePN*commRate), netPN=pricePN-commPN;

    // 6. Confiance
    const liveCount=(comps?1:0)+(weather?1:0)+(occupancyMult!==1.0?1:0);
    const confidence=liveCount>=3?'A':liveCount>=2?'B':'C';

    // 7. Info card (ServiceFlow style) avec provenance explicite
    const _baseProv = calibSource==='price-calibrate'
      ? `Base ${grid[season]}€ · calibrée auto${calibDate?(' le '+new Date(calibDate).toLocaleDateString('fr-FR')):''}`
      : `Base ${grid[season]}€ · configurée manuellement (Réglages — pas encore calibrée auto)`;
    const info_card = [
      `Saison: ${season} · ${_baseProv}`,
      useEvent&&eventSig.name ? `Événement: ${eventSig.name} +15%` : null,
      weekend ? 'Week-end +50€' : null,
      comps ? `AirROI: ${comps.comp_count} comps · moy ${comps.avg_price}€ × 1.30 → ${Math.round(comps.avg_price*1.30)}€` : 'AirROI: non disponible',
      weather ? `Météo: ${weather.temp}°C · ${weather.rain}mm → ×${weather.score}` : 'Météo: hors fenêtre 16j',
      `Occupation 30j: ${occupancyLabel}`,
      `Délai réservation: ${leadLabel}`,
      `Commission Airbnb: ${(commRate*100).toFixed(1)}% → NET ${netPN}€/nuit`,
      `Mesuré, pas modélisé · Confiance ${confidence}`,
    ].filter(Boolean);

    return new Response(JSON.stringify({
      target_date:targetDate, season, nights, guests, suggested_price:finalPrice, confidence, floor,
      grid_source:gridSource, grid,
      calibration_source:calibSource, calibration_date:calibDate, calibration_formula:calibFormula,
      breakdown:{season_base:grid[season],after_mods:price,after_comps:comps?Math.round((price*0.6+Math.round(comps.avg_price*1.30)*0.4)/50)*50:price,after_occupancy:Math.round(finalPrice/leadMult/50)*50,after_lead:finalPrice},
      financials:{price_per_night:finalPrice,guest_extra:guestExtra,price_with_guests:pricePN,airbnb_commission:commPN,net_per_night:netPN,gross_total:pricePN*nights,net_total:netPN*nights,commission_rate:`${(commRate*100).toFixed(1)}%`},
      modifiers:{event:useEvent,weekend,lastmin:useLastmin,longstay:useLongstay},
      signals:{
        event:eventSig.name?{name:eventSig.name,multiplier:eventSig.mult}:null,
        market_comps:comps?{avg_price:comps.avg_price,comp_count:comps.comp_count,villa_premium:'×1.30'}:null,
        weather:weather?{temp:weather.temp,rain:weather.rain,score:weather.score}:null,
        occupancy:{fill_rate_30d:Math.round(fillRate*100),multiplier:occupancyMult,label:occupancyLabel},
        lead_time:{days_ahead:daysAhead,multiplier:leadMult,label:leadLabel}
      },
      info_card,
      label:`${finalPrice}€/nuit · NET ${netPN}€ · Confiance ${confidence}`,
      note:`Mesuré, pas modélisé — ${gridSource} (${season} ${grid[season]}€, ${calibSource}) + occupation ${Math.round(fillRate*100)}% + lead J${daysAhead>=0?'+':''}${daysAhead}`
    },null,2),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  } catch(e) {
    return new Response(JSON.stringify({error:String(e)}),{status:500,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }
});
