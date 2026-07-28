## COMMIT A — audits (auditContrast/auditLabels/auditTones)

- Porté depuis `stafflo-ui-v19.html` (lignes ~1925-2027) : `auditContrast()`,
  `auditLabels()` (alias `labelize()`), `auditTones()`, exposées sur
  `window.*`, insérées en fin du dernier bloc `<script>` d'`app.html`. `L(fr,en)`
  du fichier de référence n'existe pas dans `app.html` — remplacé par le
  pattern déjà en usage ici (`lang === 'fr' ? ... : ...`). Renommé les
  helpers internes `_rgb/_lum/_bgOf` en `_auditRgb/_auditLum/_auditBgOf`
  pour éviter toute collision de nom sur un fichier de 39 8xx lignes.
- Ajout non prévu par la spec initiale, mais nécessaire : `auditContrast()`
  inclut désormais `fg`/`bg` (rgb string) sur chaque entrée, et une nouvelle
  fonction `auditContrastGroups()` regroupe les échecs par couple
  couleur-texte/fond-effectif. Demandé par l'utilisateur en cours de route
  pour distinguer « quelques couples systémiques » de « des centaines de
  bugs isolés » — voir plus bas.

### Itérations avant le vert

Pas 1 mais 3 problèmes trouvés, aucun n'était dans le périmètre de A lui-même :

1. **Premier run : 48/48 rouge.** Cause réelle : dette préexistante massive
   (637 échecs contraste + 31 labels sur un seul écran). Pas un bug du
   portage — c'est exactement ce que ces fonctions sont censées révéler.
   Bloquant : la spec disait « vert sur les 6 critères après CHAQUE commit »,
   ce qui aurait fait de A un chantier de correction non scopé sur tout
   `app.html`. Remonté à l'utilisateur (AskUserQuestion) plutôt que deviné.
   Décision reçue : cliquet (ratchet) par combinaison exacte, pas de
   tolérance globale — voir `tests/baseline.json` et `tests/README.md`.
   auditLabels() suit la même règle ; les 31 manques deviennent un commit à
   part entière (**B-bis**, après B), pas un effet de bord de A.
2. **Diagnostic « couple par couple » demandé avant de continuer.** Sur
   `today`/`calendar`/`villa` à 1440px : 48-49 groupes, mais très concentrés —
   le pire couple (texte gris chaud `rgb(138,128,112)` sur fond blanc,
   ratio 3.89 contre 4.5 requis, donc tout près du seuil) représente à lui
   seul ~50 % des 637 échecs ; les 6 premiers couples couvrent ~74 %. Conclusion
   utile pour le COMMIT D : ce n'est pas 637 bugs, c'est une poignée de
   valeurs de palette à resserrer.
3. **Le harnais lui-même était non-déterministe** (trouvé en relançant deux
   fois de suite sans aucun changement de code : 2 régressions de cliquet
   sur des combinaisons identiques). Cause : `app.html` a une douzaine de
   `setInterval` (rotation de tagline à 6s, compteur ARIA, auto-refresh
   inbox, injection de kebabs à 3s...) qui retombent à des instants dépendant
   de l'horloge murale, pas du code — un run de ~2-3 minutes sur 48
   combinaisons traverse plusieurs de ces cycles à des moments différents
   à chaque exécution. Isolé par bissection (attente cumulée jusqu'à 22s sur
   une page figée : le compte dérivait quand même après 17s de stabilité).
   Corrigé en gelant `window.setInterval = () => 0` via `page.addInitScript`
   avant chargement (`setTimeout` intact — la chaîne de boot démo en dépend).
   Un second trou de mock trouvé au passage : `api.exchangerate-api.com`
   (taux de change) n'était pas mocké, CORS en erreur console sur les écrans
   qui l'appellent. Ajouté. 3 runs consécutifs ensuite : 0 régression, 0
   échec — considéré stable.

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé, baseline)
3. `auditContrast()` : **non exigé `[]` par commit** — cliquet armé, baseline
   par combinaison dans `tests/baseline.json` (48 clés, ex. `today-1440-fr`:
   673 ; `settings-1440-fr`: 719 — le maximum, la modale réglages a le plus
   de texte secondaire). Cible zéro portée par le COMMIT D.
4. `auditLabels()` : idem, cliquet armé (29-30 échecs selon combinaison).
   Cible zéro portée par le COMMIT B-bis.
5. `auditTones()` : **`fautes: []` sur les 48 combinaisons** — pas de tuiles
   `[data-tone]` ni de système de ton avant COMMIT C, donc rien à signaler.
   Vrai critère dur (pas de cliquet), déjà respecté.
6. Erreurs console : **0/48** après correction du mock exchangerate-api.

`>>> HARNAIS: VERT` (3 runs consécutifs).

### PHASE 4 — champs affichés ancien vs nouveau

Sans objet pour ce commit : les trois fonctions sont des outils de
diagnostic invisibles (console uniquement), aucune surface visible n'est
modifiée. Rien n'a été retiré ni changé à l'écran.

### Service worker

v386 -> **v387**.

### Ce qui reste douteux

- La baseline contraste/labels enregistrée dans `tests/baseline.json` est
  une PHOTO de l'état actuel, pas un objectif. Si D ne ramène pas le
  contraste à zéro, je m'arrêterai et rapporterai le tableau des couples
  restants (engagement pris avec l'utilisateur).
- `auditContrastGroups()` n'a pas de test dédié dans `visual.mjs` (c'est un
  outil de diagnostic pour moi/l'utilisateur, pas un critère de vert) — à
  garder à l'esprit si un futur commit s'appuie dessus.
