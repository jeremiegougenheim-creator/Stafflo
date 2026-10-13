// app.html — garde-fous de la revue UX/UI du 13/10/2026.
//   node tests/evals-app-ux.mjs
//
// Chaque ligne protège une correction vérifiée sur les vrais écrans (données
// réelles, téléphone 390 px et ordinateur 1440 px). Une régression ici veut dire
// qu'un écran redevient faux, vide ou illisible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail || ''); } };

// Bugs
check('Villa › Entretien : #maisonV2 visible dans son panneau', app.includes('#staffloShell #villaPaneEntretien > #maisonV2.nav-v2-on{display:block !important}'));
check('fiche : frais calculés brut − net quand les deux sont connus', /if \(!estime && nb > 0 && nn > 0 && nb > nn\)/.test(app) && /var cm = nb - nn/.test(app));
check('langue : FR / EN (pas « Français » tronqué en « F »)', /<option value="fr" title="Français">FR<\/option>/.test(app) && /<option value="en" title="English">EN<\/option>/.test(app));
check('boîte : objet sur sa propre ligne sous 600 px', /@media \(max-width: 600px\) \{\s*\.cmp-inbox-row \{ flex-wrap: wrap;/.test(app) && /\.cmp-subject \{ order: 5; flex: 1 1 100%; white-space: normal;/.test(app));

// Allègement — un seul interrupteur, réversible
const trim = app.slice(app.indexOf('<!-- v499 — ALLÈGEMENT'));
check('allègement : interrupteur stafflo_trim_v1 (« off » rétablit tout)', /localStorage\.getItem\('stafflo_trim_v1'\) !== 'off'/.test(trim) && /document\.documentElement\.classList\.add\('trim-v1'\)/.test(trim));
check('allègement : seulement du masquage CSS, aucun nœud retiré', !/\.remove\(\)/.test(trim.replace("if (box) box.remove();", '')) && !/removeChild/.test(trim));
for (const [label, sel] of [
  ['« Copier & pousser aux canaux »', '.trim-v1 #v4PushBtn'],
  ['« Opportunités ARIA » dans Villa', '.trim-v1 .v4-card-opps'],
  ['« Scénarios de revenu »', '.trim-v1 .v4-card-scenarios'],
  ['« 14 prochains jours » sans contenu', 'data-en="Next 14 days"'],
  ['« Mode de gestion » sans effet', 'data-en="OPERATION PROFILE"'],
  ['tarifs repas à 0 € (la fiche maison fait foi)', '.trim-v1 #settingsMealPricing'],
  ['« Ops du jour » générique (l’Espace suit les vraies étapes)', '.trim-v1 #v3CardOps'],
]) check('masqué : ' + label, trim.includes(sel));
check('ARIA : icônes en double masquées, « Rédiger » et « Extraire » nommées', trim.includes(".aria-action-btn[onclick*=\"'price'\"]") && trim.includes('content:attr(aria-label)'));
check('Villa › Prix : « occupé ce soir » + prochaine nuit libre', /window\.staffloTrimTonight = function/.test(trim) && /window\.staffloTrimTonight\(\)/.test(app));
check('en-tête : lien vers l’Espace', /a\.href = 'espace\.html'/.test(trim) && !/a\.className = 'hdr-btn'/.test(trim));
check('Aujourd’hui : « NET <année> » au lieu d’un total depuis toujours', /var _netLbl = _trim \? \('NET ' \+ _yr\) : 'NET';/.test(app));
check('Aujourd’hui : pipeline = demandes encore vivantes', /if \(!_trim\) return true;\s*if \(c\.arrival\) return new Date\(String\(c\.arrival\)\.slice\(0,10\) \+ 'T12:00:00'\) >= today;/.test(app));
check('Aujourd’hui : pas de carte « Opportunité » en double pour un client déjà listé', /items\.some\(function\(x\)\{ return x\.client && x\.client\.id === nextNew\.id; \}\)\) nextNew = null;/.test(app));

check('ARIA : événements supprimés (doublons) exclus du contexte', /rest\/v1\/events\?select=[^']*&deleted_at=is\.null/.test(app));
// Onboarding : un compte connecté sans villa ne reste jamais enfermé (passation 30/07 §3a)
const onb = app.slice(app.indexOf('<!-- v504 — ONBOARDING : SE DÉCONNECTER'));
check('onboarding : « Se déconnecter » visible quand une session existe', /id = 'onbV3SignOut'/.test(onb) && /doSignOut\(\)/.test(onb) && /!window\._demoMode/.test(onb));
check('onboarding : rien pour un nouvel inscrit sans compte', /if \(!open \|\| !s\) \{ if \(bar\) bar\.style\.display = 'none'; return; \}/.test(onb));
check('onboarding : ajout pur (aucun nœud existant retiré)', onb.length > 100 && !/\.remove\(\)|removeChild/.test(onb));
// Réglages allégés (v505) : l'Avancé Supabase masqué pour tous ; pour la villa pilote
// (fiche maison active), les champs qui doublent la fiche cèdent la place à une note.
const rg = app.slice(app.indexOf('<!-- v505 — RÉGLAGES ALLÉGÉS'));
check('réglages : URL et clé Supabase masquées (tout propriétaire)', trim.includes('.trim-v1 #settingsModal .settings-section:has(#cfgSbUrl)'));
check('réglages : doublons de la fiche masqués seulement si la fiche maison est active', trim.includes('.trim-v1.facts-v1 #settingsModal .field:has(> #cfgBedrooms)') && /villaFactsActive\(\)/.test(rg) && /classList\.toggle\('facts-v1'/.test(rg));
check('réglages : aucun champ retiré du DOM (valeurs intactes)', !/\.remove\(\)|removeChild/.test(rg.slice(0, rg.indexOf('</script>'))));
// Onboarding SaaS (v507) : un compte déjà connecté ne refait pas d'inscription ; pas de valeurs de Dar J.
check('onboarding : compte connecté → complete(), jamais une 2e inscription', /async function submitOnbAccount\(\)\{\n(?:\s*\/\/[^\n]*\n)*\s*if \(window\._stafflo_session && window\._stafflo_session\.access_token && !window\._demoMode\) \{ complete\(false\); return; \}/.test(app));
check('onboarding : écran compte valide sans saisie quand connecté', /if \(step === 4 && onbAuthed\(\)\) return true;/.test(app) && /if \(onbAuthed\(\)\) \{ next\(\); return; \}/.test(app));
check('inscription : plus de « 5 chambres / 750 € » envoyés par défaut', !/bedrooms: 5, base_price: 750/.test(app));
check('exemples neutres (ni Villa DarJ ni jeremie@)', !/placeholder="Villa DarJ"/.test(app) && !/placeholder="jeremie@villa\.com"/.test(app));
check('lien magique inerte masqué', /#onboardingV3 #onbV3AcctMagic/.test(app));
// v519 — abonnement offert, bande « Performance » des clients
check('abonnement offert (liste blanche) : « Accès offert », jamais « Passer à Solo »', /comp:\s+fr \? 'Accès offert · complet'/.test(app) && /btn\.style\.display = \(s && s\.status === 'comp'\) \? 'none' : ''/.test(app));
check('abonnement : « trial_expired » affiché « Essai terminé » (plus le code brut)', /trial_expired: fr \? 'Essai terminé'/.test(app));
check('clients : barres par canal remplies (le remplissage n’est plus un span en ligne sans taille)', /\.v5-perf-bar-fill \{ display:block; \}/.test(app));
check('clients (téléphone) : barres sous les chiffres, plus de bande qui défile hors écran', /@media \(max-width: 560px\) \{\s*\.v5-perf \{ flex-wrap:wrap; overflow-x:visible;/.test(app));

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
