// Rejoue le brief CC "Rappels d'envoi du livret : persistants, mis en avant aux
// bons jalons" (Commit 2, carte dans buildMattersItems()) contre le code réel
// d'app.html.
//   node tests/evals-livret-matters.mjs
//
// Toutes les comparaisons de dates dépendent du fuseau horaire du process (voir
// buildMattersItems: new Date(c.arrival) parse la date-only en UTC, puis
// setHours(0,0,0,0) la ramène à minuit LOCAL — un décalage d'un jour est
// possible hors UTC). On se force en UTC pour un résultat déterministe partout.
import { spawnSync } from 'node:child_process';
if (process.env.TZ !== 'UTC') {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { TZ: 'UTC' })
  });
  process.exit(r.status == null ? 1 : r.status);
}

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

function fnSource(name) {
  const m = src.indexOf('function ' + name + '(');
  if (m < 0) throw new Error('fonction introuvable: ' + name);
  const lineStart = src.lastIndexOf('\n', m) + 1;
  const indent = src.slice(lineStart, m);
  const endMarker = '\n' + indent + '}';
  const e = src.indexOf(endMarker, m);
  return src.slice(m, e + endMarker.length);
}

const ctx = { console };
vm.createContext(ctx);
// Ordre : isFirmBooking (globale, hors closure) avant firm() (qui la lit via
// typeof) — sinon firm() retombe sur son repli mort, qui diverge sur 'cancelled'.
vm.runInContext(fnSource('isFirmBooking') + '\nthis.isFirmBooking = isFirmBooking;', ctx);
vm.runInContext(fnSource('firm') + '\nthis.firm = firm;', ctx);
vm.runInContext(fnSource('todayMidnight') + '\nthis.todayMidnight = todayMidnight;', ctx);
vm.runInContext(fnSource('firstName') + '\nthis.firstName = firstName;', ctx);
vm.runInContext(fnSource('fr') + '\nthis.fr = fr;', ctx);
vm.runInContext(fnSource('buildMattersItems') + '\nthis.buildMattersItems = buildMattersItems;', ctx);
const buildMattersItems = ctx.buildMattersItems;

function offsetISODate(days) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function offsetISODateTime(days) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
let nextId = 1;
function client(overrides) {
  return Object.assign({
    id: 'c' + (nextId++), name: 'Test Guest', bookingStatus: 'confirmed',
    createdAt: offsetISODateTime(-100)
  }, overrides);
}
function livretItems(clients) {
  ctx.clients = clients;
  return buildMattersItems().items.filter(it => it.key && it.key.indexOf('livret:') === 0);
}

const evals = [];
const ev = (name, fn) => evals.push({ name, fn });

ev('confirmée il y a 2 jours, arrivée dans 8 mois, non envoyé → en avant', () => {
  const items = livretItems([client({ createdAt: offsetISODateTime(-2), arrival: offsetISODate(243) })]);
  return items.length === 1 && items[0].tier === 'p1';
});

ev('confirmée il y a 40 jours, arrivée dans 6 mois, non envoyé → visible, pas en avant', () => {
  const items = livretItems([client({ createdAt: offsetISODateTime(-40), arrival: offsetISODate(182) })]);
  return items.length === 1 && items[0].tier === 'p2';
});

ev('arrivée dans 29 jours, non envoyé → en avant', () => {
  const items = livretItems([client({ arrival: offsetISODate(29) })]);
  return items.length === 1 && items[0].tier === 'p1';
});

ev('arrivée dans 14 jours, non envoyé → en avant', () => {
  const items = livretItems([client({ arrival: offsetISODate(14) })]);
  return items.length === 1 && items[0].tier === 'p1';
});

ev('arrivée dans 5 jours, non envoyé → en avant, libellé PDF', () => {
  const items = livretItems([client({ arrival: offsetISODate(5) })]);
  return items.length === 1 && items[0].tier === 'p1' &&
    /PDF/i.test(items[0].sub_fr) && /PDF/i.test(items[0].sub_en);
});

ev('arrivée dans 20 jours, non envoyé → visible, pas en avant, libellé lien', () => {
  const items = livretItems([client({ arrival: offsetISODate(20) })]);
  return items.length === 1 && items[0].tier === 'p2' &&
    !/PDF/i.test(items[0].sub_fr) && !/PDF/i.test(items[0].sub_en);
});

ev('livret marqué envoyé → aucune carte', () => {
  const items = livretItems([client({
    arrival: offsetISODate(5),
    details: { livretSentAt: offsetISODateTime(-1) }
  })]);
  return items.length === 0;
});

ev('réservation annulée ou non confirmée → aucune carte', () => {
  const cancelled = livretItems([client({ arrival: offsetISODate(5), bookingStatus: 'cancelled' })]);
  const lead = livretItems([client({ arrival: offsetISODate(5), bookingStatus: 'lead' })]);
  return cancelled.length === 0 && lead.length === 0;
});

ev('arrivée passée → aucune carte', () => {
  const items = livretItems([client({ arrival: offsetISODate(-5), departure: offsetISODate(-3) })]);
  return items.length === 0;
});

ev('deux appels successifs de la fonction → une seule carte, pas de doublon', () => {
  const clients = [client({ createdAt: offsetISODateTime(-2), arrival: offsetISODate(243) })];
  const first = livretItems(clients);
  const second = livretItems(clients);
  return first.length === 1 && second.length === 1 && first[0].key === second[0].key;
});

ev('date d\'arrivée manquante → carte visible, jamais en avant', () => {
  const items = livretItems([client({ createdAt: offsetISODateTime(-2) })]);
  return items.length === 1 && items[0].tier === 'p2';
});

ev('fenêtres chevauchantes (confirmée <15j ET arrivée <=7j) → une seule carte, en avant', () => {
  const items = livretItems([client({ createdAt: offsetISODateTime(-2), arrival: offsetISODate(5) })]);
  return items.length === 1 && items[0].tier === 'p1';
});

ev('date de confirmation inconnue, arrivée dans 5 jours → visible, jamais en avant', () => {
  const items = livretItems([client({ createdAt: null, arrival: offsetISODate(5) })]);
  return items.length === 1 && items[0].tier === 'p2';
});

let fails = 0;
for (const { name, fn } of evals) {
  let ok = false, err = '';
  try { ok = !!fn(); } catch (e) { err = ' — ' + (e && e.message); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + err);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} échec(s)` : `\n${evals.length}/${evals.length} PASS`);
process.exit(fails ? 1 : 0);
