// Météo de l'app (loadWeather) — la vraie météo de SA villa, jamais de chiffres inventés.
//   node tests/evals-meteo.mjs
//
// Exécute la VRAIE fonction loadWeather() d'app.html contre les réponses réelles de
// weather-proxy (Open-Meteo, format relevé le 13/10/2026) : temps actuel sans `sys`,
// prévisions par jour (`dt_txt`) sans horodatage `dt`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
function fnSource(name, prefix = '') {
  const i = app.indexOf(prefix + 'function ' + name + '(');
  if (i < 0) return '';
  return app.slice(i, app.indexOf('\n}\n', i) + 3);
}
const SRC = ['parseGpsLatLon', 'weatherMainFromIcon', 'getWeatherIcon'].map((n) => fnSource(n)).join('\n') + '\n' + fnSource('loadWeather', 'async ');

const CUR = { cod: 200, coord: { lat: 31.6295, lon: -7.9811 }, main: { temp: 26.7, feels_like: 29, humidity: 49 }, wind: { speed: 5.8 }, weather: [{ id: 0, description: 'Ciel degage', icon: '01d' }], name: 'Marrakech' };
const FORE = { cod: '200', cnt: 4, city: { name: 'Marrakech' }, list: [
  { dt_txt: '2026-10-13', main: { temp_max: 29.4, temp_min: 16.1 }, weather: [{ id: 45, description: 'Brouillard', icon: '50d' }], rain: { '3h': 0 } },
  { dt_txt: '2026-10-14', main: { temp_max: 30.4, temp_min: 18 }, weather: [{ id: 2, description: 'Partiellement nuageux', icon: '02d' }], rain: { '3h': 0.2 } },
  { dt_txt: '2026-10-15', main: { temp_max: 30.6, temp_min: 20.5 }, weather: [{ id: 61, description: 'Pluie', icon: '10d' }], rain: { '3h': 0.1 } },
  { dt_txt: '2026-10-16', main: { temp_max: 30.1, temp_min: 17.6 }, weather: [{ id: 3, description: 'Partiellement nuageux', icon: '02d' }], rain: { '3h': 0 } },
] };

async function run({ cfg = {}, marrakech = false, fore = FORE, cur = CUR } = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { innerHTML: '', textContent: '', id });
  const urls = [];
  const ctx = {
    window: {}, lang: 'fr', SB_URL: 'https://x.supabase.co', console,
    document: { getElementById: el },
    getCfg: () => cfg,
    isMarrakechVilla: () => marrakech,
    fetch: async (u) => { urls.push(u); return { json: async () => (/mode=forecast/.test(u) ? fore : cur) }; },
    Date, Math, String, Number, Array, Object, JSON, isFinite, encodeURIComponent, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.__run = loadWeather;', ctx);
  await ctx.__run();
  return { els, urls, data: ctx.window._weatherData };
}

check('fonctions extraites', /async function loadWeather\(/.test(SRC) && /function parseGpsLatLon\(/.test(SRC));
{
  const r = await run({ cfg: { gps: '31°37\'46.2"N 7°58\'52.0"W', city: 'Marrakech, Maroc' }, marrakech: true });
  const html = r.els.weatherContent?.innerHTML || '';
  check('position : les coordonnées GPS de la villa (pas un « q=Marrakech » ignoré)', r.urls.length === 2 && r.urls.every((u) => /lat=31\.6295&lon=-7\.9811&tz=auto&name=Marrakech/.test(u)), r.urls);
  check('temps actuel affiché (27°, min–max du jour 16°–29°)', /27°/.test(html) && /16°–29°/.test(html));
  check('4 jours de prévisions affichés', (html.match(/Partiellement nuageux|Brouillard|Pluie/g) || []).length >= 4);
  check('aucun NaN / undefined affiché', !/NaN|undefined/.test(html), html.match(/.{0,40}(NaN|undefined).{0,40}/));
  check('source et lieu réels en pied de carte', /Open-Meteo · Marrakech/.test(html) && !/OpenWeatherMap/.test(html));
  check('vent en km/h tel que fourni (pas ×3,6)', /💨6km\/h/.test(html), html.match(/💨\d+km\/h/));
  check('donnée exposée à ARIA = la vraie (27 °C)', r.data && r.data.temp === 27 && r.data.min === 16 && r.data.max === 29, r.data);
}
{
  const r = await run({ cfg: { gps: '38.7223, -9.1393', city: 'Lisbonne, Portugal' }, fore: { cod: 500, message: 'Open-Meteo error: 503' } });
  const html = r.els.weatherContent?.innerHTML || '';
  check('prévisions en échec : la météo du jour reste affichée, sans NaN', /27°/.test(html) && !/NaN|undefined/.test(html) && r.data && r.data.min === null);
  check('autre villa : ses coordonnées décimales et sa ville', r.urls.every((u) => /lat=38\.7223&lon=-9\.1393&tz=auto&name=Lisbonne/.test(u)), r.urls);
}
{
  const r = await run({ cfg: { city: 'Lisbonne' } });
  check('villa sans GPS hors Marrakech : aucun appel, aucune météo d’une autre ville', r.urls.length === 0 && r.data === null && /position GPS de la villa/.test(r.els.weatherContent.innerHTML));
  check('jamais de « 24°C » inventés', !/24°C|Ensoleillé|offline/i.test(r.els.weatherContent.innerHTML + r.els.factorWeather.textContent));
}
{
  const r = await run({ cfg: { city: 'Marrakech' }, marrakech: true });
  check('villa à Marrakech sans GPS : repli Marrakech du serveur', r.urls.every((u) => /weather-proxy\?name=Marrakech&lang=fr/.test(u)), r.urls);
}
{
  const r = await run({ cfg: { gps: '31.6, -7.9' }, cur: { cod: 500, message: 'down' } });
  check('service en panne : la carte le dit, rien n’est exposé à ARIA', r.data === null && /indisponible/.test(r.els.weatherContent.innerHTML) && r.els.factorWeather.textContent === '—');
}
{
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fnSource('parseGpsLatLon') + '\nthis.p = parseGpsLatLon;', ctx);
  const P = ctx.p;
  check('GPS : texte illisible ou hors bornes → pas de position devinée', P('') === null && P('Palmeraie, Marrakech') === null && P('95, 10') === null);
  check('GPS : hémisphère sud / est', JSON.stringify(P('8°24\'34"S 115°11\'20"E')) === JSON.stringify({ lat: -8.4094, lon: 115.1889 }), P('8°24\'34"S 115°11\'20"E'));
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
