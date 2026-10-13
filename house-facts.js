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

const KEYS = ['VILLA','PRACTICAL','ROOMS','GOOD_TO_KNOW','MEAL_NOTES','MEALS','LEISURE','RULES','BREAKFAST','GOUTER','STARTERS','MAINS','SIMPLE','DESSERTS','MEDINA','GOLF','ACTIVITIES','RESTAURANTS','CAFES','TEXT','TEAM','QR'];

function build(data) {
if (!data || typeof data !== 'object' || !data.VILLA) return null;
const {VILLA, PRACTICAL, ROOMS, GOOD_TO_KNOW, MEAL_NOTES, MEALS, LEISURE, RULES,
  BREAKFAST, GOUTER, STARTERS, MAINS, SIMPLE, DESSERTS, MEDINA, GOLF,
  ACTIVITIES, RESTAURANTS, CAFES, TEXT, TEAM} = data;

function pick(pair, i) {
  if (!Array.isArray(pair)) return String(pair == null ? '' : pair);
  return String(pair[i] != null ? pair[i] : pair[0]);
}
const flat = s => String(s).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const head = s => String(s).split(' — ')[0].trim();

function digest(lang) {
  const i = lang === 'en' ? 1 : 0;
  const fr = i === 0;
  const P = pair => flat(pick(pair, i));
  const out = [];
  const sec = t => out.push('', '## ' + t);
  const li = t => out.push('- ' + t);

  out.push(fr
    ? '=== FICHE MAISON — VILLA DAR J (faits officiels et à jour) ==='
    : '=== HOUSE FACTS — VILLA DAR J (official and up to date) ===');
  out.push(fr
    ? 'Ces faits priment sur tout autre texte (mémoire, anciens modèles, historique de conversation). Cite uniquement ce qui est écrit ici ; une information absente se dit « à confirmer » — jamais inventée. Sers-t\'en pour rédiger, jamais comme donnée client à extraire. Prix des repas en MAD, par service et pour tout le groupe (jamais par personne).'
    : 'These facts override any other text (memory, old templates, conversation history). Only state what is written here; anything missing is "to be confirmed" — never invented. Use them to write, never as guest data to extract. Meal prices are in MAD, per service, for the whole group (never per person).');

  sec(fr ? 'Maison' : 'House');
  li((fr ? 'Maison de famille de ' : 'Family home of ') + VILLA.host + (fr ? ', propriétaire et hôte (souvent à l\'étranger).' : ', owner and host (often abroad).'));
  li((fr ? 'Adresse : ' : 'Address: ') + VILLA.address + ' — GPS ' + VILLA.pin.lat + ',' + VILLA.pin.lng);
  li(P(TEXT.roomsIntro));
  ROOMS.forEach(r => li(P(r.t) + (r.tag ? ' (' + P(r.tag) + ')' : '') + ' : ' + P(r.bed) + ' · ' + P(r.bath)));
  const x = VILLA.extraGuest;
  li(fr
    ? 'Supplément voyageurs (réglage Airbnb) : ' + x.fee + ' € par nuit et par personne à partir du ' + x.from + 'e voyageur, ' + x.max + ' personnes au maximum.'
    : 'Extra guest fee (Airbnb setting): €' + x.fee + ' per night per person from guest no. ' + x.from + ', ' + x.max + ' people maximum.');

  sec(fr ? 'Équipe' : 'Team');
  TEAM.forEach(m => li((m.name ? m.name + ' : ' : '') + pick(m.role, i) + (m.phone ? ' (' + m.phone + ')' : '')));
  li((fr ? 'Hôte : ' : 'Host: ') + VILLA.host + ' ' + VILLA.hostPhone);

  sec(fr ? 'Repas' : 'Meals');
  MEALS.forEach(m => {
    const same = pick(m.a, i) === pick(m.b, i);
    li(P(m.n) + ' : ' + (same ? P(m.a) : P(m.a) + (fr ? ' (1–6 pers.) / ' : ' (1–6 guests) / ') + P(m.b) + (fr ? ' (7–10 pers.)' : ' (7–10 guests)')) + ' — ' + P(m.h));
  });
  MEAL_NOTES.forEach(n => li(P(n)));
  li(P(TEXT.orderRule));
  li(P(TEXT.menuIntro));
  li(P(TEXT.earlyBrk));
  li((fr ? 'Petit-déjeuner : ' : 'Breakfast: ') + BREAKFAST.map(b => P(b)).join(', '));
  li((fr ? 'Goûter : ' : 'Afternoon tea: ') + GOUTER.map(g => P(g)).join(', '));
  li((fr ? 'Entrées : ' : 'Starters: ') + STARTERS.map(s => head(P(s))).join(', '));
  li((fr ? 'Plats : ' : 'Mains: ') + MAINS.map(s => head(P(s))).join(', '));
  li((fr ? 'Pour les enfants : ' : 'For children: ') + SIMPLE.map(s => head(P(s))).join(', '));
  li((fr ? 'Desserts : ' : 'Desserts: ') + DESSERTS.map(s => head(P(s))).join(', '));

  sec(fr ? 'Pratique' : 'Practical');
  PRACTICAL.forEach(p => li(P(p)));
  GOOD_TO_KNOW.forEach(g => li(P(g)));
  li('Wi-Fi : ' + VILLA.wifi.net + ' / ' + VILLA.wifi.pass);

  sec(fr ? 'Règles de la maison' : 'House rules');
  RULES.forEach(r => li(P(r)));

  sec(fr ? 'Loisirs et alentours' : 'Leisure and surroundings');
  li(LEISURE.map(l => P(l)).join(' · '));
  li(P(TEXT.kidsBox));
  li((fr ? 'Golf : ' : 'Golf: ') + GOLF.map(g => P(g.n) + ' ' + P(g.d)).join(' ; '));
  li((fr ? 'Activités : ' : 'Activities: ') + ACTIVITIES.map(a => P(a.n)).join(', '));
  li((fr ? 'Restaurants conseillés : ' : 'Recommended restaurants: ') + RESTAURANTS.map(r => P(r.n)).join(', '));

  return out.join('\n');
}


const out = {};
KEYS.forEach(k => { if (data[k] !== undefined) out[k] = data[k]; });
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
