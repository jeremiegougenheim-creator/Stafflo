/* ═══════════════════════════════════════════════════════════════════════
   house-facts.js — MOTEUR de la fiche maison. AUCUNE DONNÉE ICI.
   ═══════════════════════════════════════════════════════════════════════
   Les faits d'une villa (équipe, repas, règles, wifi, adresse…) sont en base :
   villa_settings.house_facts (jsonb, propriétaire seulement). Ils arrivent :
     · app.html / espace.html — avec la ligne villa_settings du compte (RLS) ;
     · livret.html             — par la fonction livret-view, avec le lien
                                 personnel du séjour (jamais publics) ; pour le
                                 propriétaire connecté, sa ligne villa_settings.
   StaffloHouseFacts.build(data) → objet gelé aux mêmes clés que l'ancien
   window.VILLA_FACTS (+ digest(lang), le résumé injecté dans les prompts ARIA).
   Le code ci-dessous (pick, flat, head, digest) est une copie exacte de l'ancien
   villa-facts.js : même donnée → même résumé, au caractère près
   (tests/evals-fiche-maison.mjs).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const KEYS = ['VILLA','PRACTICAL','ROOMS','GOOD_TO_KNOW','MEAL_NOTES','MEALS','LEISURE','RULES','BREAKFAST','BRUNCH','GOUTER','STARTERS','MAINS','SIMPLE','DESSERTS','MEDINA','GOLF','ACTIVITIES','RESTAURANTS','CAFES','TEXT','TEAM','QR','EXTRAS'];

function build(data) {
if (!data || typeof data !== 'object' || !data.VILLA) return null;
const {VILLA, PRACTICAL, ROOMS, GOOD_TO_KNOW, MEAL_NOTES, MEALS, LEISURE, RULES,
  BREAKFAST, BRUNCH, GOUTER, STARTERS, MAINS, SIMPLE, DESSERTS, MEDINA, GOLF,
  ACTIVITIES, RESTAURANTS, CAFES, TEXT, TEAM, EXTRAS} = data;

function pick(pair, i) {
  if (!Array.isArray(pair)) return String(pair == null ? '' : pair);
  return String(pair[i] != null && pair[i] !== '' ? pair[i] : pair[0]); // anglais vide → français
}
const flat = s => String(s).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const head = s => String(s).split(' — ')[0].trim();

/* Le résumé tolère une fiche partielle (15/10/2026 : la fiche se remplit dans l'Espace,
   section par section) : une section absente ou vide n'écrit rien. Sur une fiche complète,
   le texte est identique au caractère près à l'ancien villa-facts.js (empreintes dans
   tests/evals-house-facts.mjs). */
const A = v => Array.isArray(v) ? v : [];
const O = v => v && typeof v === 'object' ? v : {};
const has = s => String(s == null ? '' : s).trim() !== '';
function digest(lang) {
  const i = lang === 'en' ? 1 : 0;
  const fr = i === 0;
  const P = pair => flat(pick(pair, i));
  const out = [];
  const sec = t => out.push('', '## ' + t);
  const li = t => out.push('- ' + t);
  const V = O(VILLA), T = O(TEXT), pin = O(V.pin), wifi = O(V.wifi), x = O(V.extraGuest);
  const NAME = String(V.name || '').trim().toUpperCase();

  out.push(fr
    ? '=== FICHE MAISON' + (NAME ? ' — ' + NAME : '') + ' (faits officiels et à jour) ==='
    : '=== HOUSE FACTS' + (NAME ? ' — ' + NAME : '') + ' (official and up to date) ===');
  out.push(fr
    ? 'Ces faits priment sur tout autre texte (mémoire, anciens modèles, historique de conversation). Cite uniquement ce qui est écrit ici ; une information absente se dit « à confirmer » — jamais inventée. Sers-t\'en pour rédiger, jamais comme donnée client à extraire. Prix des repas en MAD, par service et pour tout le groupe (jamais par personne).'
    : 'These facts override any other text (memory, old templates, conversation history). Only state what is written here; anything missing is "to be confirmed" — never invented. Use them to write, never as guest data to extract. Meal prices are in MAD, per service, for the whole group (never per person).');

  sec(fr ? 'Maison' : 'House');
  if (has(V.host)) li((fr ? 'Maison de famille de ' : 'Family home of ') + V.host + (fr ? ', propriétaire et hôte (souvent à l\'étranger).' : ', owner and host (often abroad).'));
  if (has(V.address) || pin.lat != null) li((fr ? 'Adresse : ' : 'Address: ') + (V.address || '') + (pin.lat != null && pin.lng != null ? ' — GPS ' + pin.lat + ',' + pin.lng : ''));
  if (has(P(T.roomsIntro))) li(P(T.roomsIntro));
  A(ROOMS).forEach(r => li(P(r.t) + (r.tag ? ' (' + P(r.tag) + ')' : '') + ' : ' + P(r.bed) + ' · ' + P(r.bath)));
  if (x.fee != null && x.from != null) li(fr
    ? 'Supplément voyageurs (réglage Airbnb) : ' + x.fee + ' € par nuit et par personne à partir du ' + x.from + 'e voyageur, ' + x.max + ' personnes au maximum.'
    : 'Extra guest fee (Airbnb setting): €' + x.fee + ' per night per person from guest no. ' + x.from + ', ' + x.max + ' people maximum.');

  sec(fr ? 'Équipe' : 'Team');
  A(TEAM).forEach(m => li((m.name ? m.name + ' : ' : '') + pick(m.role, i) + (m.phone ? ' (' + m.phone + ')' : '')));
  if (has(V.host)) li((fr ? 'Hôte : ' : 'Host: ') + V.host + (has(V.hostPhone) ? ' ' + V.hostPhone : ''));

  sec(fr ? 'Repas' : 'Meals');
  A(MEALS).forEach(m => {
    const same = pick(m.a, i) === pick(m.b, i);
    // 17/10/2026 : qui prépare un repas « maison » à partir de 7 personnes (MEALS[i].big) — dit à ARIA tel quel.
    if (m && m.house && m.big === 'off') return li(P(m.n) + ' : ' + P(m.a) + (fr ? ' — groupes de 1 à 6 seulement, préparé par la maison' : ' — groups of 1 to 6 only, prepared by the house team') + ' — ' + P(m.h));
    if (m && m.house && m.big === 'kitchen') return li(P(m.n) + ' : ' + P(m.a) + (fr ? ' (1–6 pers., préparé par la maison) / ' : ' (1–6 guests, prepared by the house team) / ') + P(m.b) + (fr ? ' (7–10 pers., préparé par la cuisinière)' : ' (7–10 guests, prepared by the cook)') + ' — ' + P(m.h));
    li(P(m.n) + ' : ' + (same ? P(m.a) : P(m.a) + (fr ? ' (1–6 pers.) / ' : ' (1–6 guests) / ') + P(m.b) + (fr ? ' (7–10 pers.)' : ' (7–10 guests)')) + ' — ' + P(m.h));
  });
  A(MEAL_NOTES).forEach(n => li(P(n)));
  ['orderRule', 'menuIntro', 'earlyBrk'].forEach(k => { if (has(P(T[k]))) li(P(T[k])); });
  if (A(BREAKFAST).length) li((fr ? 'Petit-déjeuner : ' : 'Breakfast: ') + A(BREAKFAST).map(b => P(b)).join(', '));
  // Brunch (16/10/2026) : une composition, pas un choix entrée-plat-dessert. Absent de la fiche du pilote copiée : résumé inchangé.
  if (A(BRUNCH).length) li((fr ? 'Brunch (sur demande) : ' : 'Brunch (on request): ') + A(BRUNCH).map(b => head(P(b))).join(', '));
  if (A(GOUTER).length) li((fr ? 'Goûter : ' : 'Afternoon tea: ') + A(GOUTER).map(g => P(g)).join(', '));
  if (A(STARTERS).length) li((fr ? 'Entrées : ' : 'Starters: ') + A(STARTERS).map(s => head(P(s))).join(', '));
  if (A(MAINS).length) li((fr ? 'Plats : ' : 'Mains: ') + A(MAINS).map(s => head(P(s))).join(', '));
  if (A(SIMPLE).length) li((fr ? 'Pour les enfants : ' : 'For children: ') + A(SIMPLE).map(s => head(P(s))).join(', '));
  if (A(DESSERTS).length) li((fr ? 'Desserts : ' : 'Desserts: ') + A(DESSERTS).map(s => head(P(s))).join(', '));

  // Extras commandables depuis le livret (15/10/2026). Absents de la fiche du pilote : résumé inchangé.
  const XS = A(EXTRAS).filter(e => e && e.n && P(e.n));
  if (XS.length) {
    sec(fr ? 'Extras sur demande' : 'Extras on request');
    XS.forEach(e => li(P(e.n) + (e.price != null && e.price !== '' ? ' : ' + e.price + (V.currency ? ' ' + V.currency : '') + (has(P(e.unit)) ? ' ' + P(e.unit) : '') : '') + (has(P(e.d)) ? ' — ' + P(e.d) : '')));
  }

  sec(fr ? 'Pratique' : 'Practical');
  A(PRACTICAL).forEach(p => li(P(p)));
  A(GOOD_TO_KNOW).forEach(g => li(P(g)));
  if (has(wifi.net)) li('Wi-Fi : ' + wifi.net + ' / ' + (wifi.pass || ''));

  sec(fr ? 'Règles de la maison' : 'House rules');
  A(RULES).forEach(r => li(P(r)));

  sec(fr ? 'Loisirs et alentours' : 'Leisure and surroundings');
  if (A(LEISURE).length) li(A(LEISURE).map(l => P(l)).join(' · '));
  if (has(P(T.kidsBox))) li(P(T.kidsBox));
  if (A(GOLF).length) li((fr ? 'Golf : ' : 'Golf: ') + A(GOLF).map(g => P(g.n) + ' ' + P(g.d)).join(' ; '));
  if (A(ACTIVITIES).length) li((fr ? 'Activités : ' : 'Activities: ') + A(ACTIVITIES).map(a => P(a.n)).join(', '));
  if (A(RESTAURANTS).length) li((fr ? 'Restaurants conseillés : ' : 'Recommended restaurants: ') + A(RESTAURANTS).map(r => P(r.n)).join(', '));

  return out.join('\n');
}


const out = {};
// Fiche partielle : une section absente devient une liste vide (TEXT, QR : objet vide),
// pour que livret, Espace et vue équipe n'aient jamais à tester chaque clé.
KEYS.forEach(k => { out[k] = data[k] != null ? data[k] : (k === 'TEXT' || k === 'QR' ? {} : k === 'VILLA' ? data[k] : []); });
out.digest = digest;
return Object.freeze(out);
}

/* ── Lien personnel du livret (un par séjour) ─────────────────────────────
   Le jeton vient de la base : public.livret_token(client_id) l'obtient OU le crée
   en une opération (le même lien sur tous les appareils, app et Espace). Copie
   locale par compte (stafflo_livret_tokens) pour que livretUrl(), synchrone,
   ait le lien dès l'ouverture. Chaque page fournit ses propres appels
   authentifiés : opt.owner() → id du compte, opt.list() → lignes
   {client_id, token} actives, opt.create(clientId) → jeton (texte) ou null. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
function livretLinks(opt) {
  const KEY = 'stafflo_livret_tokens';
  const owner = () => { try { return String(opt.owner() || ''); } catch (e) { return ''; } };
  const readStore = (o) => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && s && s.owner === o && s.map && typeof s.map === 'object') return s.map;
    } catch (e) {}
    return {};
  };
  // La copie locale suit le compte : session ouverte plus tard, ou autre compte → sa propre copie.
  let mapOwner = owner(), map = readStore(mapOwner);
  const sync = () => { const o = owner(); if (o !== mapOwner) { mapOwner = o; map = readStore(o); } return o; };
  const inflight = {};
  const save = () => { try { if (mapOwner) localStorage.setItem(KEY, JSON.stringify({ owner: mapOwner, map: map })); } catch (e) {} };
  function get(id) { sync(); const t = map[String(id || '')]; return TOKEN_RE.test(t || '') ? t : ''; }
  function ensure(id) {
    id = String(id || '');
    const o = sync();
    if (!id || !o) return Promise.resolve('');
    if (get(id)) return Promise.resolve(get(id));
    const k = o + ':' + id;
    if (inflight[k]) return inflight[k];
    const p = Promise.resolve().then(() => opt.create(id)).then((t) => {
      if (typeof t === 'string' && TOKEN_RE.test(t) && o === mapOwner) { map[id] = t; save(); return t; }
      return '';
    }).catch(() => '').then((t) => { delete inflight[k]; return t; });
    inflight[k] = p;
    return p;
  }
  function load() {
    const o = sync();
    if (!o) return Promise.resolve(false);
    return Promise.resolve().then(() => opt.list()).then((rows) => {
      if (!Array.isArray(rows) || o !== mapOwner) return false;
      const m = {};
      rows.forEach((r) => { if (r && r.client_id && TOKEN_RE.test(r.token || '')) m[String(r.client_id)] = r.token; });
      map = m; save();
      return true;
    }).catch(() => false);
  }
  return Object.freeze({ get: get, ensure: ensure, load: load });
}

window.StaffloHouseFacts = Object.freeze({ build: build, KEYS: KEYS, livretLinks: livretLinks });
})();
