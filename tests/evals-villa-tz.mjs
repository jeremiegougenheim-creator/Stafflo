// Heure de la maison (22/10/2026) — « aujourd'hui » se lit dans le fuseau de la villa, pas celui du téléphone.
//   node tests/evals-villa-tz.mjs
//
// Cas réel : propriétaire à Hong Kong (UTC+8), villa à Marrakech. Le téléphone passe au lendemain vers 16–17 h à
// Marrakech ; l'Espace montrait alors les arrivées du lendemain comme celles du jour. Le script se relance avec
// TZ=Asia/Hong_Kong pour être ce téléphone-là.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.TZ !== 'Asia/Hong_Kong') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: Object.assign({}, process.env, { TZ: 'Asia/Hong_Kong' }) });
  process.exit(r.status == null ? 1 : r.status);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esp = fs.readFileSync(path.join(root, 'espace.html'), 'utf8');
const eq = fs.readFileSync(path.join(root, 'equipe.html'), 'utf8');
const push = fs.readFileSync(path.join(root, 'supabase/functions/push-notify/index.ts'), 'utf8');
const sv = fs.readFileSync(path.join(root, 'supabase/functions/staff-view/index.ts'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

// ── Le bloc de dates de l'Espace, exécuté avec une horloge fixée ──
const a = esp.indexOf('  function dayNum(iso)'), b = esp.indexOf('  function fmtLongDay(');
check('bloc de dates trouvé dans espace.html', a > 0 && b > a);
const block = esp.slice(a, b);
function espaceAt(isoNow, vtz, lang) {
  const RealDate = Date, fixed = new RealDate(isoNow).getTime();
  class FakeDate extends RealDate { constructor(...x) { if (x.length) super(...x); else super(fixed); } static now() { return fixed; } }
  const store = {};
  const ctx = {
    Date: FakeDate, Intl, JSON, String, Math, Object, Array,
    U: { lang: lang || 'fr' },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\n;VTZ = ' + JSON.stringify(vtz || '') + ';\nthis.api = { todayNum, dayNum, seenAt, tzFor, awayFromVilla, hmOf, fmtDay, setVillaTz, get VTZ() { return VTZ; } };', ctx);
  return { api: ctx.api, store };
}
const D = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

// 22/10/2026, 17:30 UTC : 01:30 le 23 à Hong Kong, 17:30 ou 18:30 le 22 à Marrakech.
const evening = '2026-10-22T17:30:00Z';
const mar = espaceAt(evening, 'Africa/Casablanca').api;
check('téléphone à Hong Kong : la date du téléphone est déjà le 23', new Date(evening).getDate() === 23);
check('villa à Marrakech : aujourd’hui = le 22 (pas le 23 du téléphone)', mar.todayNum() === D('2026-10-22'), mar.todayNum());
const casaHour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', hourCycle: 'h23' }).format(new Date(evening));
check('heure affichée = heure de la villa', mar.hmOf(new Date(evening)) === String(casaHour).padStart(2, '0') + ':30', mar.hmOf(new Date(evening)));
check('« vu » : aujourd’hui à l’heure de la villa', mar.seenAt('2026-10-22T16:10:00Z') === 'aujourd’hui à ' + String(casaHour - 1).padStart(2, '0') + ':10', mar.seenAt('2026-10-22T16:10:00Z'));
check('« vu » la veille au soir à Marrakech = hier', /^hier à /.test(mar.seenAt('2026-10-21T20:00:00Z')), mar.seenAt('2026-10-21T20:00:00Z'));
check('l’en-tête dit « à la villa » quand le téléphone est ailleurs', mar.awayFromVilla() === true);

const none = espaceAt(evening, '').api;
check('pays inconnu : le jour du téléphone, comme avant', none.todayNum() === D('2026-10-23'), none.todayNum());
check('pays inconnu : pas de mention « à la villa »', none.awayFromVilla() === false);

const hk = espaceAt(evening, 'Asia/Hong_Kong').api;
check('téléphone dans le fuseau de la villa : pas de mention « à la villa »', hk.awayFromVilla() === false);

const morning = espaceAt('2026-10-22T03:00:00Z', 'Africa/Casablanca').api; // 11:00 à Hong Kong, 03/04:00 à Marrakech
check('le matin, même jour des deux côtés', morning.todayNum() === D('2026-10-22'));

check('fuseau déduit du pays : Maroc', mar.tzFor('Maroc', 'Marrakech, Maroc') === 'Africa/Casablanca');
check('fuseau déduit du pays : Thailand (compte réel)', mar.tzFor('Thailand', 'Ko Pha-ngan District, Thailand') === 'Asia/Bangkok');
check('fuseau inconnu : vide (jamais deviné)', mar.tzFor('', '') === '' && mar.tzFor(null, null) === '');

const st = espaceAt(evening, '');
st.api.setVillaTz('Maroc', 'Marrakech', 'u1');
check('setVillaTz : fuseau posé et gardé pour ce compte', st.api.VTZ === 'Africa/Casablanca' && JSON.parse(st.store.stafflo_villa_tz).uid === 'u1');
st.api.setVillaTz('', '', 'u1');
check('setVillaTz : pays effacé → retour au téléphone, rien de gardé', st.api.VTZ === '' && !st.store.stafflo_villa_tz);

// ── Une seule table de fuseaux : Espace = push-notify (point du matin) = staff-view (lien équipe) ──
const rulesOf = (src, re) => { const m = src.match(re); return m ? m[1].replace(/\s+/g, '').replace(/"/g, "'") : null; };
const rE = rulesOf(esp, /var TZ_RULES = \[([\s\S]*?)\n  \];/), rP = rulesOf(push, /const TZ: \[RegExp, string\]\[\] = \[([\s\S]*?)\n\];/), rS = rulesOf(sv, /const TZ: \[RegExp, string\]\[\] = \[([\s\S]*?)\n\];/);
check('même table de fuseaux que push-notify', rE && rP && rE.replace(/,$/, '') === rP.replace(/,$/, ''), [rE && rE.length, rP && rP.length]);
check('même table de fuseaux que staff-view', rE && rS && rE.replace(/,$/, '') === rS.replace(/,$/, ''));

// ── Espace : la base donne le fuseau, les mois et le calendrier suivent la villa ──
check('fuseau posé au chargement depuis villa_settings (pays, ville)', /setVillaTz\(D\.villa && D\.villa\.country, D\.villa && D\.villa\.city/.test(esp));
check('mois des chiffres = mois de la villa', (esp.match(/var m0 = new Date\(todayNum\(\) \* 86400000\)/g) || []).length === 2 && !/var m0 = new Date\(\),/.test(esp));
check('calendrier = mois de la villa', /var now = new Date\(todayNum\(\) \* 86400000\), y = now\.getUTCFullYear\(\)/.test(esp));
check('messages WhatsApp : jour et heure de la villa', /var wlDay = function \(m\) \{ return dayOfInstant\(/.test(esp) && /var wlHm = function \(m\) \{ return hmOf\(/.test(esp));
check('plus aucune lecture de l’heure du téléphone hors repli', !/getHours\(\)/.test(esp.replace(/return \{ y: d\.getFullYear\(\), m: d\.getMonth\(\) \+ 1, d: d\.getDate\(\), h: d\.getHours\(\)[^\n]*/, '').replace(/return c\.h !== n\.getHours\(\)[^\n]*/, '')));

// ── staff-view : plus de Casablanca en dur, jour et fuseau renvoyés à la page ──
check('staff-view : plus de fuseau en dur', !/timeZone: "Africa\/Casablanca"/.test(sv));
check('staff-view : jour calculé dans le fuseau de la villa', /const tz = villaTz\(vs && vs\.country, vs && vs\.city\);\s*const todayIso = todayIn\(tz\);/.test(sv));
check('staff-view : renvoie today et tz', /today: todayIso, tz,/.test(sv));

// ── equipe.html : le jour de la villa quand le serveur le donne ──
const ea = eq.indexOf('  function dayNum(iso)'), eb = eq.indexOf('  function fmt(n, long)');
const eblock = eq.slice(ea, eb);
function equipeAt(isoNow, data) {
  const RealDate = Date, fixed = new RealDate(isoNow).getTime();
  class FakeDate extends RealDate { constructor(...x) { if (x.length) super(...x); else super(fixed); } static now() { return fixed; } }
  const ctx = { Date: FakeDate, Intl, S: { data } };
  vm.createContext(ctx);
  vm.runInContext(eblock + '\nthis.todayNum = todayNum;', ctx);
  return ctx.todayNum();
}
check('équipe : fuseau de la villa reçu → jour de la villa', equipeAt(evening, { tz: 'Africa/Casablanca', today: '2026-10-22', at: evening }) === D('2026-10-22'));
check('équipe : sans fuseau → jour du téléphone', equipeAt(evening, { today: '2026-10-22', at: evening }) === D('2026-10-23'));
check('équipe : pas encore de données → jour du téléphone', equipeAt(evening, null) === D('2026-10-23'));

console.log(`\n${pass} réussis, ${fail} en échec`);
process.exit(fail ? 1 : 0);
