# tests/ — harnais visuel pour app.html

## Lancer

```bash
node tests/visual.mjs
```

Aucun serveur à démarrer à la main : le script sert la racine du dépôt sur
`http://localhost:8934` lui-même, ouvre `app.html?demo=1` (mode démo — pas
d'auth Supabase réelle, données CRM factices), et ferme le serveur à la fin.

Prérequis : `playwright` doit être installé dans `tests/node_modules`
(`npm i` depuis `tests/` si besoin) avec Chromium déjà téléchargé
(`npx playwright install chromium`).

## Ce qui est testé

Pour chaque largeur (390/768/1440) × langue (fr/en), une page est ouverte et :

- 5 écrans : today, clients, calendar, villa, inbox
- 3 modales : aria, client, settings

à chacun de ces 8 états, le harnais :

1. capture `tests/shots/{vue}-{largeur}-{langue}.png`
2. appelle `window.auditContrast()`, `window.auditLabels()`, `window.auditTones()`
3. relève toute erreur console ou `pageerror`

Total : 48 combinaisons par run.

## Lire un échec

La sortie liste chaque combinaison avec un statut :

- `PASS` — les trois audits ont renvoyé `[]`, zéro erreur console
- `FAIL` — un audit a renvoyé un tableau non vide (ou a levé une exception),
  ou une erreur console/page est survenue. Le détail est imprimé juste
  en dessous de la ligne concernée.
- `SKIP (audits absents)` — `auditContrast`/`auditLabels`/`auditTones`
  n'existent pas encore dans `app.html` (normal avant COMMIT A de la
  série de portage). Les erreurs console sont quand même relevées et
  comptent pour un `FAIL` même en SKIP.

Le code de sortie du process est non-nul (`1`) si au moins une combinaison
a `fail: true` — utilisable tel quel en CI/pre-commit.

La capture correspondante dans `tests/shots/` permet de voir l'état exact
de l'écran au moment de l'échec.

## Sécurité réseau

Le harnais réutilise `launchTestContext()` de `browser-harness.js`
(service worker bloqué, `ai-proxy` mocké) et ajoute un mock générique sur
`**/*.supabase.co/**`, `**/nominatim.openstreetmap.org/**` et
`**/api.exchangerate-api.com/**` : aucune combinaison ne peut atteindre un
vrai backend payant, même en mode démo (le mode démo ne bypass que
l'auth, pas les appels aux edge functions comme `price-intelligence`,
`weather-proxy`, `transcribe`, etc., ni les appels externes comme le taux
de change EUR).

## Déterminisme (cliquet contraste/labels)

`tests/baseline.json` enregistre, par combinaison exacte (écran × largeur
× langue), le nombre d'échecs `auditContrast()`/`auditLabels()`. Le
critère vert n'exige pas `[]` immédiatement : un commit ne doit jamais
faire REMONTER le compte d'une combinaison par rapport à sa baseline
enregistrée. S'il le fait baisser, `baseline.json` est resserré (écrasé
avec les nouveaux comptes plus bas) et commité avec le changement. La
dette initiale (des centaines d'échecs, dominés par une poignée de
couples couleur/fond) est du ressort des COMMITS B et D, pas de chaque
commit individuellement.

app.html a une douzaine de `setInterval` (rotation de tagline, compteur
ARIA, auto-refresh inbox...) qui, livrés à eux-mêmes, changent le DOM à
des instants dépendant de l'horloge murale — ça rendait les comptes
d'audit non-déterministiques d'un run à l'autre sans aucun changement de
code. Le harnais les gèle via `window.setInterval = () => 0` injecté
avant le chargement de la page (voir commentaire dans `visual.mjs`).
`setTimeout` n'est pas touché : la chaîne de boot démo (`generateAlerts`,
`loadMorningBrief`) en dépend et doit s'exécuter une fois.
