// Site public et pages légales — garde-fous statiques.
//   node tests/evals-site-legal.mjs
//
// Les pages légales décrivent ce que le code fait vraiment (sous-traitants, Gmail,
// hébergement) ; elles sont accessibles depuis chaque page du site et chaque
// formulaire d'inscription.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

// ── Politique de confidentialité : conforme au code ──────────────────────
const priv = read('privacy.html'), terms = read('terms.html');
for (const [lang, re] of [['en', /data-block="en">([\s\S]*?)<!-- =+ FRAN/], ['fr', /data-block="fr">([\s\S]*?)<\/main>/]]) {
  const b = (priv.match(re) || [])[1] || '';
  check(`confidentialité (${lang}) : hébergement des données à Paris`, /Paris/.test(b) && /(EU|Union européenne)/.test(b));
  check(`confidentialité (${lang}) : tous les sous-traitants appelés par le code`, ['Supabase', 'Mistral', 'Polar', 'Google', 'Open-Meteo', 'AviationStack', 'AirROI', 'GitHub'].every((x) => b.includes(x)) && /(Push services|Services de notification)/.test(b));
  check(`confidentialité (${lang}) : Gmail décrit tel quel (copie des emails récents dans l'app, Airbnb seul côté serveur)`, /(last few days|ces derniers jours)/.test(b) && /(only emails sent by Airbnb|uniquement les emails envoyés par Airbnb)/.test(b));
  check(`confidentialité (${lang}) : plus l'ancienne promesse « emails de réservation seulement »`, !/(solely<\/strong> to detect booking-confirmation|uniquement<\/strong> pour détecter les emails de confirmation)/.test(b));
  check(`confidentialité (${lang}) : déconnexion = jetons supprimés, synchro arrêtée`, /(deletes the access tokens|jetons d'accès que nous conservons sont alors supprimés)/.test(b));
}
check('confidentialité : ouverte dans la langue du lien (?lang=fr)', /lang=\(fr\|en\)/.test(priv));
// ── Mentions légales ──────────────────────────────────────────────────────
check('mentions légales FR et legal notice EN', /id="mentions-legales"/.test(terms) && /id="legal-notice"/.test(terms) && (terms.match(/GitHub, Inc\., 88 Colin P\. Kelly Jr\. Street/g) || []).length === 2);
check('conditions : ouvertes dans la langue du lien (?lang=fr)', /lang=\(fr\|en\)/.test(terms));

// ── Site : liens légaux, équipe de démonstration, langues ────────────────
for (const f of ['index.html', 'en.html', 'ar.html', 'th.html', 'zh.html']) {
  const h = read(f);
  check(`${f} : pied de page → confidentialité, conditions, mentions légales`, /href="privacy\.html\?lang=(fr|en)"/.test(h) && /href="terms\.html\?lang=(fr|en)"/.test(h) && /href="terms\.html\?lang=(fr|en)#(mentions-legales|legal-notice)"/.test(h));
  check(`${f} : équipe de démonstration fictive (jamais l'équipe réelle du pilote)`, !/\bSaid\b|Saïd|Faiza|Bouchra/.test(h));
}
check('accueil : un navigateur en chinois arrive sur zh.html (plus sur en.html)', /zh:'zh\.html'/.test(read('index.html')));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
