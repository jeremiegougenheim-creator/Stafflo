// Calendriers iCal lus côté serveur (supabase/functions/ical-sync) : liens du compte, liste fermée de
// plateformes, dates rangées en base, jamais le texte des événements. Depuis le 21/10 : une réservation
// lue sans séjour crée le séjour (dates, source, code ; nom et montant « à compléter »), jamais un blocage,
// jamais deux fois, jamais quand l'interrupteur du compte (ical_auto_create) est coupé.
//   PUSH_TEST_MODULES=… node tests/evals-ical-sync.mjs   (esbuild, comme evals-livret-view)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tryReq = (n, alt) => { for (const b of [import.meta.url, ...(alt || [])]) { try { return createRequire(b)(n); } catch {} } return null; };
const esbuild = tryReq('esbuild', [process.env.PUSH_TEST_MODULES || '/tmp/', '/opt/npm-tools/']);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); } };
const src = fs.readFileSync(path.join(root, 'supabase/functions/ical-sync/index.ts'), 'utf8');

const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ymd = (d) => iso(d).replace(/-/g, '');
const AIRBNB = ['BEGIN:VCALENDAR', 'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN', 'VERSION:2.0',
  'BEGIN:VEVENT', `DTEND;VALUE=DATE:${ymd(6)}`, `DTSTART;VALUE=DATE:${ymd(2)}`, 'UID:1418fb94e984-a1@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCD1234\\nPhone Num', ' ber (Last 4 Digits): 4321', 'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', `DTEND;VALUE=DATE:${ymd(12)}`, `DTSTART;VALUE=DATE:${ymd(10)}`, 'UID:7f3a-b2@airbnb.com', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
  'BEGIN:VEVENT', `DTEND;VALUE=DATE:${ymd(-20)}`, `DTSTART;VALUE=DATE:${ymd(-25)}`, 'UID:old-1@airbnb.com', 'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', `DTSTART;VALUE=DATE:${ymd(30)}`, 'UID:noend@airbnb.com', 'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', `DTEND;VALUE=DATE:${ymd(42)}`, `DTSTART;VALUE=DATE:${ymd(40)}`, 'UID:cx@airbnb.com', 'STATUS:CANCELLED', 'SUMMARY:Reserved', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const BOOKING = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `DTSTART;VALUE=DATE:${ymd(15)}`, `DTEND;VALUE=DATE:${ymd(18)}`, 'UID:bk-1@booking.com', 'SUMMARY:CLOSED - Not available', 'END:VEVENT', 'END:VCALENDAR'].join('\n');

const DB = { villas: [], events: [], runs: [], stays: [] };
const USERS = { 'tok-o1': 'o1', 'tok-o2': 'o2' };
const FEEDS = { 'www.airbnb.com': AIRBNB, 'admin.booking.com': BOOKING };
const OUT = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'SRK', SUPABASE_ANON_KEY: 'ANON' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init = {}) => {
  const raw = String(url); url = decodeURIComponent(raw);
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (!url.startsWith('https://sb.test')) {
    OUT.push(url);
    const host = new URL(url).hostname;
    if (url.includes('broken')) return new Response('nope', { status: 500 });
    return FEEDS[host] ? Object.defineProperty(new Response(FEEDS[host], { status: 200 }), 'url', { value: url }) : new Response('x', { status: 404 });
  }
  if (url.endsWith('/auth/v1/user')) { const t = String((init.headers || {}).Authorization || '').replace(/^Bearer\s+/, ''); return USERS[t] ? ok({ id: USERS[t] }) : ok({}, 401); }
  if (url.includes('/rpc/gmail_sync_key_ok')) return ok(JSON.parse(init.body).k === 'SYNC');
  if (url.includes('/rest/v1/villa_settings')) {
    const o = (url.match(/owner_id=eq\.([^&]+)/) || [])[1];
    return ok(DB.villas.filter((v) => (!o || v.owner_id === o) && (o || (Array.isArray(v.ical_feeds) && v.ical_feeds.length))));
  }
  if (url.includes('/rest/v1/sync_runs')) { DB.runs.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  // Séjours (21/10) : lus pour savoir ce qui est déjà couvert, créés en une fois (return=minimal).
  if (url.includes('/rest/v1/crm_clients')) {
    if (init.method === 'POST') {
      if (!/return=minimal/.test(init.headers.Prefer)) return ok({ code: 'prefer' }, 400);
      for (const r of JSON.parse(init.body)) { if (DB.stays.some((s) => s.id === r.id)) return ok({ code: '23505' }, 409); DB.stays.push(r); }
      return new Response(null, { status: 201 });
    }
    const o = (url.match(/user_id=eq\.([^&]+)/) || [])[1];
    if (!o || !/deleted_at=is\.null/.test(url) || !/or=\(departure\.gte\.\d{4}-\d{2}-\d{2}/.test(url)) return ok({ code: 'filter' }, 400);
    return ok(DB.stays.filter((s) => s.user_id === o && !s.deleted_at));
  }
  if (url.includes('/rest/v1/ical_events')) {
    if (!init.method || init.method === 'GET') {
      const o = (url.match(/owner_id=eq\.([^&]+)/) || [])[1], ge = (url.match(/end_date=gte\.([^&]+)/) || [])[1];
      if (!o || !/kind=eq\.reserved/.test(url) || !/gone_at=is\.null/.test(url) || !/hidden_at=is\.null/.test(url)) return ok({ code: 'filter' }, 400);
      return ok(DB.events.filter((e) => e.owner_id === o && e.kind === 'reserved' && !e.gone_at && !e.hidden_at && (!ge || e.end_date >= ge)).map((e) => ({ id: e.uid, ...e })));
    }
    if (init.method === 'POST') {
      if (!/on_conflict=owner_id,feed_id,uid/.test(url) || !/merge-duplicates/.test(init.headers.Prefer)) return ok({ code: 'conflict' }, 409);
      for (const r of JSON.parse(init.body)) {
        const cur = DB.events.find((e) => e.owner_id === r.owner_id && e.feed_id === r.feed_id && e.uid === r.uid);
        if (cur) Object.assign(cur, r); else DB.events.push({ hidden_at: null, ...r });
      }
      return new Response(null, { status: 201 });
    }
    if (init.method === 'PATCH') {
      const o = url.match(/owner_id=eq\.([^&]+)/)[1], f = (url.match(/feed_id=eq\.([^&]+)/) || [])[1], notIn = (url.match(/feed_id=not\.in\.\(([^)]*)\)/) || [])[1];
      const lt = (url.match(/seen_at=lt\.([^&]+)/) || [])[1], ge = (url.match(/end_date=gte\.([^&]+)/) || [])[1];
      const hit = DB.events.filter((e) => e.owner_id === o && !e.gone_at && (!f || e.feed_id === f) && (!notIn || !notIn.split(',').includes(e.feed_id)) && (!lt || e.seen_at < lt) && (!ge || e.end_date >= ge));
      const body = JSON.parse(init.body); hit.forEach((e) => Object.assign(e, body));
      return ok(hit.map((e) => ({ id: e.uid })));
    }
  }
  throw new Error('inattendu ' + url);
};
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const h = globalThis.__h;
const post = (headers = {}, body = {}) => h(new Request('https://x/ical-sync', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

// 1. Lecture pure
const ev = M.parseIcal(AIRBNB);
check('Airbnb : « Reserved » = réservé avec son code HM… (ligne repliée lue), « Not available » = bloqué, fin exclusive = jour de départ',
  ev.length === 4 && ev[0].kind === 'reserved' && ev[0].code === 'HMABCD1234' && ev[0].start === iso(2) && ev[0].end === iso(6) && ev[1].kind === 'blocked' && ev[1].code === null, ev);
check('sans DTEND → une nuit ; événement annulé (STATUS:CANCELLED) ignoré', ev[3].start === iso(30) && ev[3].end === iso(31) && !ev.some((e) => e.uid === 'cx@airbnb.com'));
check('Booking.com : « CLOSED - Not available » = bloqué (Booking ne distingue pas réservation et fermeture)', M.parseIcal(BOOKING)[0].kind === 'blocked' && M.parseIcal(BOOKING)[0].start === iso(15));
check('fenêtre : du séjour en cours (départ ≥ hier) à 18 mois', M.inWindow(ev[0], iso(0)) && !M.inWindow(ev[2], iso(0)) && !M.inWindow({ start: iso(600), end: iso(602) }, iso(0)));
check('liens acceptés : https / webcal des plateformes connues ; jamais http, une IP, un autre site, un identifiant dans l’URL',
  !!M.allowed('webcal://www.airbnb.fr/calendar/ical/1.ics?s=a') && !!M.allowed('https://admin.booking.com/hotel/hoteladmin/ical.html?t=x') &&
  !M.allowed('http://www.airbnb.com/x.ics') && !M.allowed('https://10.0.0.1/x.ics') && !M.allowed('https://evil.example/airbnb.com.ics') && !M.allowed('https://u:p@www.airbnb.com/x.ics'));
check('réglages nettoyés : id, nom, lien accepté ; 8 calendriers au plus', M.feedsOf([{ id: 'a1', label: '  Airbnb  ', url: 'https://www.airbnb.com/c.ics' }, { id: 'b', url: 'http://x' }, { url: 'https://www.airbnb.com/d.ics' }]).length === 1 &&
  M.feedsOf(Array.from({ length: 12 }, (_, i) => ({ id: 'f' + i, url: 'https://www.airbnb.com/c' + i + '.ics' }))).length === 8);

// 1 bis. Séjours à créer (pur, 21/10) : réservations non couvertes, source d'après le lien, ligne de séjour.
check('source d’un calendrier : d’après la plateforme du lien, jamais le nom donné par le propriétaire',
  M.sourceOf('https://www.airbnb.fr/calendar/ical/1.ics?s=a') === 'Airbnb' && M.sourceOf('https://ical.booking.com/v1/export?t=x') === 'Booking' && M.sourceOf('https://www.vrbo.com/icalendar/x.ics') === 'Vrbo' && M.sourceOf('https://calendar.google.com/x.ics') === 'Autre' && M.sourceOf('') === 'Autre');
{
  const T = iso(0);
  const E = (id, s, d, extra) => ({ id, feed_id: 'air', uid: id, start_date: iso(s), end_date: iso(d), kind: 'reserved', code: null, hidden_at: null, gone_at: null, ...(extra || {}) });
  const evs = [
    E('e-code', 10, 14, { code: 'HMCODE0001' }), // couverte par le code (séjour déplacé à d'autres dates)
    E('e-dates', 20, 23), // couverte par les dates (séjour saisi à la main qui chevauche)
    E('e-free', 30, 33, { code: 'HMFREE0002' }), // à créer
    E('e-free-b', 32, 35), // même plage que la précédente (chevauche) : une seule création
    E('e-blocked', 40, 42, { kind: 'blocked' }), // blocage : jamais
    E('e-hidden', 50, 52, { hidden_at: '2026-10-20T10:00:00Z' }), // masquée par le propriétaire
    E('e-gone', 60, 62, { gone_at: '2026-10-20T10:00:00Z' }), // disparue du calendrier
    E('e-past', -9, -5), // terminée
    E('e-cancelled-stay', 70, 73), // un séjour annulé ne couvre pas : à créer
  ];
  const stays = [
    { id: 's1', arrival: iso(90), departure: iso(93), booking_status: 'confirmed', details: { reservation_code: 'HMCODE0001' } },
    { id: 's2', arrival: iso(18), departure: iso(21), booking_status: 'confirmed', details: {} },
    { id: 's3', arrival: iso(70), departure: iso(73), booking_status: 'cancelled', details: {} },
  ];
  const u = M.uncovered(evs, stays, T);
  check('réservations à créer : ni couvertes (code ou dates), ni bloquées, ni masquées, ni disparues, ni passées ; une seule par plage ; un séjour annulé ne couvre pas',
    u.map((e) => e.id).join() === 'e-free,e-cancelled-stay', u.map((e) => e.id));
  const row = M.stayRow(u[0], 'o1', 'Airbnb', '2026-10-21T07:00:00.000Z', 1);
  check('ligne de séjour : dates, source, code, confirmé, montant vide, nom = code, « à compléter » nom et montant, traces du calendrier',
    row.user_id === 'o1' && row.name === 'HMFREE0002' && row.arrival === iso(30) && row.departure === iso(33) && row.source === 'Airbnb' && row.booking_status === 'confirmed' && row.price === null && row.guests === null &&
    row.details.reservation_code === 'HMFREE0002' && row.details.origin === 'ical_sync' && row.details.ical_event_id === 'e-free' && row.details.ical_feed_id === 'air' && row.details.pending.join() === 'name,price' && row.id === String(Date.parse('2026-10-21T07:00:00.000Z') + 1), row);
  const row2 = M.stayRow(u[1], 'o1', 'Vrbo', '2026-10-21T07:00:00.000Z', 2);
  check('sans code : nom « <source> <arrivée> », pas de code inventé', row2.name === 'Vrbo ' + iso(70) && !('reservation_code' in row2.details) && row2.id !== row.id, row2);
}

// 2. Passage du cron
DB.villas.push({ owner_id: 'o1', ical_feeds: [{ id: 'air', label: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/123.ics?s=secret' }, { id: 'bk', label: 'Booking', url: 'https://admin.booking.com/ical.html?t=y' }, { id: 'bad', label: 'Cassé', url: 'https://www.airbnb.com/broken.ics' }] },
  { owner_id: 'o2', ical_feeds: [] });
// Un séjour saisi à la main porte déjà le code HMABCD1234 (dates déplacées sur Airbnb) : la réservation est couverte.
DB.stays.push({ id: 'manual-1', user_id: 'o1', name: 'Ana Ruiz', arrival: iso(50), departure: iso(53), booking_status: 'confirmed', details: { reservation_code: 'HMABCD1234', origin: 'espace' } });
let r = await post({ 'x-sync-key': 'NOPE' });
check('cron : mauvaise clé → 401, aucun calendrier lu', r.status === 401 && !OUT.length);
r = await post({ 'x-sync-key': 'SYNC' }); let b = await r.json();
check('cron : chaque compte qui a des calendriers (pas les autres) ; 3 calendriers lus', b.ok && b.owners === 1 && OUT.filter((u) => /airbnb|booking/.test(u)).length === 3, b);
const o1 = DB.events.filter((e) => e.owner_id === 'o1');
check('rangés en base : dates, réservé / bloqué, code, nom du calendrier — dans la fenêtre seulement', o1.length === 4 && o1.find((e) => e.uid.startsWith('1418')).code === 'HMABCD1234' && o1.find((e) => e.feed_id === 'bk').kind === 'blocked' && !o1.some((e) => e.uid === 'old-1@airbnb.com') && o1.every((e) => e.label), o1);
check('jamais le texte de l’événement (4 derniers chiffres du téléphone)', !JSON.stringify(DB.events).includes('4321') && !JSON.stringify(DB.events).includes('Phone'));
const run = DB.runs.find((x) => x.owner_id === 'o1');
check('passage noté (sync_runs ical) : nombres, et l’erreur du calendrier cassé sans arrêter les autres', run && run.source === 'ical' && run.ok === false && run.stats.events === 4 && run.stats.reserved === 2 && run.stats.errors.length === 1 && run.stats.errors[0].feed === 'bad' && !JSON.stringify(run).includes('secret'), run);
// 2 bis. Séjour créé depuis le calendrier (21/10)
const made = DB.stays.filter((s) => s.id !== 'manual-1');
check('réservation Airbnb sans séjour → séjour créé (dates, source Airbnb, à compléter) ; celle couverte par le code ne l’est pas ; blocages Airbnb et Booking jamais',
  run.stats.created === 1 && made.length === 1 && made[0].user_id === 'o1' && made[0].name === 'Airbnb ' + iso(30) && made[0].arrival === iso(30) && made[0].departure === iso(31) && made[0].source === 'Airbnb' && made[0].details.origin === 'ical_sync' && made[0].details.pending.join() === 'name,price' && made[0].details.ical_event_id === 'noend@airbnb.com', made);
r = await post({ 'x-sync-key': 'SYNC' }); b = await r.json();
check('passage suivant : rien n’est créé deux fois (le séjour couvre maintenant la réservation)', b.results[0].created === 0 && DB.stays.length === 2, b.results[0]);
// Interrupteur du compte coupé : les dates sont lues, aucun séjour créé.
FEEDS['www.airbnb.com'] = AIRBNB.replace('END:VCALENDAR', ['BEGIN:VEVENT', `DTEND;VALUE=DATE:${ymd(100)}`, `DTSTART;VALUE=DATE:${ymd(97)}`, 'UID:late@airbnb.com', 'SUMMARY:Reserved', 'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMLATE0099', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
DB.villas[0].ical_auto_create = false;
r = await post({ 'x-sync-key': 'SYNC' }); b = await r.json();
check('interrupteur « créer les séjours » coupé (villa_settings.ical_auto_create = false) : la nouvelle réservation est rangée, aucun séjour créé', b.results[0].created === 0 && b.results[0].reserved === 3 && !!DB.events.find((e) => e.uid === 'late@airbnb.com') && DB.stays.length === 2, b.results[0]);
DB.villas[0].ical_auto_create = true;
r = await post({ 'x-sync-key': 'SYNC' }); b = await r.json();
check('interrupteur remis : le séjour est créé au passage suivant, avec son code', b.results[0].created === 1 && DB.stays.length === 3 && DB.stays[2].name === 'HMLATE0099' && DB.stays[2].details.reservation_code === 'HMLATE0099' && DB.stays[2].arrival === iso(97), DB.stays[2]);

// 3. Annulation, masquage, calendrier retiré
DB.events.find((e) => e.uid === 'noend@airbnb.com').hidden_at = '2026-10-17T10:00:00Z';
FEEDS['www.airbnb.com'] = AIRBNB.replace(/BEGIN:VEVENT\r\nDTEND;VALUE=DATE:\d+\r\nDTSTART;VALUE=DATE:\d+\r\nUID:1418fb94e984-a1@airbnb\.com[\s\S]*?END:VEVENT\r\n/, '');
await new Promise((res) => setTimeout(res, 5));
r = await post({ 'x-sync-key': 'SYNC' });
check('réservation disparue du calendrier (annulée) → gone_at, plus comptée', !!DB.events.find((e) => e.uid.startsWith('1418')).gone_at);
check('« Masquer » du propriétaire (hidden_at) gardé au passage suivant', DB.events.find((e) => e.uid === 'noend@airbnb.com').hidden_at === '2026-10-17T10:00:00Z' && !DB.events.find((e) => e.uid === 'noend@airbnb.com').gone_at);
DB.villas[0].ical_feeds = DB.villas[0].ical_feeds.filter((f) => f.id !== 'bk');
r = await post({ Authorization: 'Bearer tok-o1' }); b = await r.json();
check('« Lire maintenant » (session) : SON compte ; calendrier retiré des réglages → ses dates ne comptent plus', r.status === 200 && b.ok && !!DB.events.find((e) => e.feed_id === 'bk').gone_at && !DB.events.find((e) => e.uid === 'noend@airbnb.com').gone_at, b);
check('sans session ni clé → 401', (await post()).status === 401 && (await post({ Authorization: 'Bearer inconnu' })).status === 401);
let lim = false; for (let i = 0; i < 8; i++) if ((await post({ Authorization: 'Bearer tok-o2' })).status === 429) lim = true;
check('« Lire maintenant » limité (6 / heure)', lim);
check('séjours créés en une seule écriture (return=minimal), jamais modifiés ni effacés par ici ; les emails ne sont pas touchés', (src.match(/crm_clients/g) || []).length === 2 && !/crm_clients\?id=/.test(src) && !/email_inbox/.test(src));
check('réponse jamais mise en cache, CORS fermé aux pages du site', /"Cache-Control": "no-store"/.test(src) && /ORIGINS\.includes\(o\)/.test(src));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
