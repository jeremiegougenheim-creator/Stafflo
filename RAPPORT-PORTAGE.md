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

## COMMIT B — retrait des `outline:none` qui écrasaient `:focus-visible`

- Régénéré la liste par grep (les 38 numéros de ligne notés avant ce commit
  dans le commentaire d'`app.html` étaient bien périmés — décalés de +8 à
  +66 lignes selon leur position, à cause des éditions COMMIT 1/2/8 et de
  mon propre COMMIT A). Trouvé 38 déclarations `outline:none`, pas 38 « en
  style inline » comme le disait le commentaire préexistant : 24 sont de
  vrais attributs `style="..."` (statiques ou générés en JS), 14 sont des
  règles de classe dans le `<style>` global (ex. `.field input{...}`).
  Vérifié que les deux catégories posent le même problème : la règle
  universelle `:focus-visible{outline:2px solid var(--gold)}` (l.539) a une
  spécificité de (0,1,0) — n'importe quelle règle de classe (0,1,1) ou tout
  style inline l'emporte, peu importe l'ordre. Donc les 38, pas seulement
  les 24. Retiré les 38 en un seul passage Python vérifié (regex
  `outline\s*:\s*none\s*;?`, avant/après comptés : 38 -> 0), remplacé le
  commentaire périmé par une note de résolution.

### Itérations avant le vert

1 seule. Le retrait ne touche à aucune couleur/texte, donc aucun impact
attendu sur `auditContrast()`/`auditLabels()` — confirmé : les comptes
après ce commit sont identiques à la baseline du COMMIT A à la combinaison
près (ex. `today-1440-fr` : 673 avant, 673 après). Un seul résidu
cosmétique repéré en relisant le diff : `.cs-sel{...cursor:pointer;}` se
termine par un point-virgule avant l'accolade fermante (la règle n'avait
pas de `;` après `outline:none`, seulement avant) — CSS valide, aucun
effet, non corrigé (n'aurait fait que déplacer le problème inverse sur un
autre cas).

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : cliquet **resserré à l'identique** (aucune baisse —
   attendu, cette correction est invisible sur le texte/couleur, elle
   restaure juste l'anneau de focus natif). Zéro reste porté par COMMIT D.
4. `auditLabels()` : idem, inchangé (28-30 selon combinaison). Zéro reste
   porté par COMMIT B-bis.
5. `auditTones()` : **`fautes: []`** sur les 48 combinaisons (rien n'existe
   encore à auditer avant COMMIT C).
6. Erreurs console : **0/48**.

`>>> HARNAIS: VERT`

### PHASE 4 — champs affichés ancien vs nouveau

Sans objet : aucun champ ajouté/retiré. Le seul changement observable est
comportemental (au clavier) — un `Tab` dans un champ de recherche, un
textarea ARIA, un input d'onboarding, etc. affiche maintenant l'anneau
doré `:focus-visible` au lieu de rien. Invisible sur une capture d'écran
statique (le harnais ne simule pas de focus clavier) — noté en vérification
manuelle recommandée, voir synthèse finale.

### Service worker

v387 -> **v388**.

### Ce qui reste douteux

- Aucun test automatisé ne vérifie réellement que l'anneau de focus
  s'affiche désormais (le harnais capture des écrans au repos, pas des
  états `:focus`). Recommandation manuelle : `Tab` dans chaque écran/modale
  et confirmer visuellement l'anneau doré sur au moins un input par
  catégorie (recherche CRM, textarea ARIA, champ d'onboarding, réglages
  iCal/IMAP).
- Les 14 occurrences retirées des règles de classe (vs les 24 en style
  inline) élargissent le périmètre au-delà du titre littéral du commit
  (« inline »). Choix justifié ci-dessus par la spécificité CSS réelle,
  mais à signaler si le résultat visuel surprend sur un composant précis
  (ex. `.aria-hero-input`, `.v3-hero-input` — fonds sombres, l'anneau doré
  pourrait trancher différemment qu'attendu sur ces surfaces).

## COMMIT B-bis — aria-label sur les boutons icône

- Diagnostic dédié (script ad hoc, pas dans `visual.mjs`) : ouvert les 8 vues
  (5 écrans + 3 modales) et collecté `auditLabels()` sur chacune, dédupliqué
  par signature `classe {dataset}`. Résultat : seulement **4 boutons
  distincts**, pas 31 bugs isolés — répétés (jusqu'à 14 fois pour le
  chevron de carte pliable, présent sur chaque carte de chaque écran).
  1. `hdr-btn` × 3 (`ariaMemBtn`, `icalSyncBtn`, `notifBtn`, l.3279-3281) :
     `title` déjà présent et dynamique (mis à jour au survol), `aria-label`
     manquant. Ajouté un `aria-label` statique correspondant au `title` de
     repos, sans toucher au handler `onmouseenter`.
  2. `.aria-mic-btn` × 5 occurrences identiques : avait déjà
     `aria-label="Voice input"` mais pas de `title`, et portait des
     attributs `data-fr-label`/`data-en-label` **inertes** (rien ne les
     lisait). `applyLang()` (l.13083-13088) sait déjà gérer
     `data-title-fr/en` et `data-aria-label-fr/en` pour n'importe quel
     élément — converti vers cette convention existante plutôt que d'en
     inventer une nouvelle ou d'étendre `labelize()`.
  3. Chevron de carte pliable, deux implémentations (`v2-icon-btn _hdChev`
     l.34856 dans le dashboard v2, et un second sans classe l.35060 dans
     les cartes maison/`hm-card`) : bouton généré en JS, aucune étiquette,
     icône seule qui bascule haut/bas selon l'état. Ajouté un `aria-label`
     + `title` **dynamiques** dans leurs `applyState(collapsed)` respectifs
     (Déplier/Réduire ou Expand/Collapse selon l'état ET la langue), pas
     une valeur statique — sinon l'étiquette mentirait une fois la carte
     dépliée.
  4. `cfgSubscriptionBtn` (l.5936, modale réglages) : texte posé
     dynamiquement par `renderSubscriptionSettings()` (l.39425) une fois
     l'entitlement chargé — vide tant que cet appel n'a pas résolu (ou dans
     un contexte de test où l'appel est mocké). Ajouté un `aria-label`/
     `title` statique de repli dans le HTML (« Abonnement ») ET fait poser
     par `renderSubscriptionSettings()` un `aria-label`/`title` calqués sur
     le texte réel une fois connu, pour ne jamais désynchroniser les deux.

### Itérations avant le vert

1 seule après diagnostic — les 4 causes once identified étaient chacune une
correction de 1 à 3 lignes. Revérifié avec le même script de diagnostic :
0 bouton restant sans étiquette sur les 8 vues.

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : cliquet inchangé (aucune couleur touchée par ce
   commit)
4. `auditLabels()` : **0 sur les 48 combinaisons** (était 28-30 avant) —
   cliquet resserré à zéro, comme demandé. Vérifié stable sur 2 runs
   consécutifs.
5. `auditTones()` : `fautes: []` (toujours rien à auditer avant COMMIT C)
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT`

### PHASE 4 — champs affichés ancien vs nouveau

Sans objet : aucun champ visuel ajouté/retiré, uniquement des attributs
d'accessibilité invisibles à l'écran (`aria-label`, `title`).

### Service worker

v388 -> **v389**.

### Ce qui reste douteux

- `cfgSubscriptionBtn` : le `aria-label` de repli statique (« Abonnement »)
  n'est vu par un lecteur d'écran que dans la fenêtre entre le rendu HTML
  et la résolution de `bootSubscription()` (normalement quelques centaines
  de ms) — comportement correct mais je n'ai pas pu observer le cas réel
  post-résolution en environnement de test (l'entitlement est mocké, donc
  `renderSubscriptionSettings()` peut ne jamais se déclencher avec des
  données réalistes). Vérification manuelle recommandée : ouvrir Réglages
  en prod/staging réel et confirmer au lecteur d'écran (ou juste au survol)
  que le bouton annonce bien « Gérer mon abonnement » ou « Passer à Solo »
  selon le statut, pas juste « Abonnement ».

## COMMIT C — quatre tons sémantiques (go/wait/house/alert)

- Recherche préalable (agent Explore) : **aucune infrastructure de ton
  n'existait dans `app.html`** — ni les variables CSS, ni `[data-tone]`, ni
  les classes `.pcard__i`/`.sig__i`/etc. du fichier de référence. Seules les
  chaînes de sélecteur DANS `auditTones()` (mon propre COMMIT A) les
  mentionnaient — c'était du code mort en attente de ce commit. Il n'y a
  donc pas de « fonctions de rendu existantes à rebrancher sur les
  classes du fichier de référence » au sens littéral : ces classes n'ont
  jamais existé ici. Rebranché sur l'équivalent RÉEL le plus proche trouvé
  dans `app.html`.
- CSS posé (additif, un troisième bloc `:root{}` à la suite de celui du
  COMMIT 2, même convention) : les 8 variables de ton, `[data-tone=X]`
  générique (`background`/`color` en `!important` — nécessaire, sinon un
  style inline existant l'emporterait par spécificité, même bug que
  COMMIT B) et `.tone-tile` (42px, rayon, liseré intérieur `inset 1.5px`)
  prête à l'emploi mais pas encore posée sur un composant existant : aucune
  tuile carrée dédiée n'existe aujourd'hui dans `app.html` (les icônes
  d'alerte et de charge sont des spans inline en ligne de texte, pas des
  tuiles). Documenté plutôt qu'inventé un nouveau composant pour la caser.
- Câblé sur 2 points concrets, sans toucher la logique existante :
  1. `renderAlert()` (l.20740, alertes/signaux) : ajouté `const ALERT_TONE
     = {urgent:'alert', warn:'wait', good:'go', info:'house'}` et
     `data-tone="${ALERT_TONE[a.type]}"` sur la même div qui porte déjà
     `class="alert-hm ${a.type}"`. Les règles `.warn/.good/.info/.urgent`
     (l.396-399, 1327-1330) restent en place, intactes — `[data-tone]`
     l'emporte par `!important`, comme prévu.
  2. `renderMaisonReal()` (l.39689, pastille payé/à régler) : ajouté
     `data-tone="go"`/`data-tone="wait"` sur les deux `<span>` de pastille,
     couleurs en dur (`GREEN_MID`, `#8a6420`...) laissées dans le HTML,
     supplantées visuellement par les valeurs canoniques.

### Itérations avant le vert

1 seule. Risque identifié avant d'écrire le code (pas après) : le
`onmouseenter`/`onmouseleave` de `renderAlert()` fait
`this.style.background='rgba(60,108,17,.04)'` au survol — un style inline
posé en JS. Avec `[data-tone]{background:...!important}`, cet effet de
survol devient invisible (le `!important` gagne même sur un style inline
posé après coup). Accepté sciemment : l'effet actuel remplaçait déjà la
couleur du type par un survol générique verdâtre, perdant elle aussi le
sens du ton pendant le survol — la nouvelle version garde la couleur
sémantique visible en permanence, ce qui est plus cohérent avec la règle
du commit, au prix d'un micro-effet de survol en moins. Noté ici plutôt
que découvert en test.

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : cliquet inchangé (les tons touchent des éléments
   déjà comptés, mêmes valeurs de contraste avant/après à vérifier — voir
   ci-dessous)
4. `auditLabels()` : **0** (inchangé, toujours à zéro depuis B-bis)
5. `auditTones()` : **`fautes: []`** sur les 48 combinaisons — aucun
   élément `.aicon`/`.pact`/`.btn` ne porte les couleurs `--t-*-fg`
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT` (2 runs consécutifs)

### PHASE 4 — champs affichés ancien vs nouveau

Sans objet côté données : aucun champ ajouté/retiré, uniquement une
recoloration des pastilles payé/à régler (villa) et un attribut
sémantique sur les lignes d'alerte. Vérifié visuellement sur
`tests/shots/villa-1440-fr.png` : pastille « à régler » en or, « payé »
en vert — conforme aux valeurs canoniques. **Non vérifié visuellement** :
le rendu de `renderAlert()` — le mode démo (`?demo=1`) ne peuple pas
`generateAlerts()` avec des données réalistes (dépend d'appels réseau
mockés qui renvoient du vide), donc aucune `.alert-hm` n'est apparue dans
les captures pour confirmer le rendu réel. Voir vérification manuelle
recommandée.

### Service worker

v389 -> **v390**.

### Ce qui reste douteux

- `.tone-tile` (42px) est posée en CSS mais n'a aucun consommateur réel
  pour l'instant — à vérifier si un futur commit (D ou G, qui touchent aux
  surfaces) doit l'adopter sur un vrai composant, ou si elle doit rester
  en réserve.
- Le rendu réel de `renderAlert()` avec `data-tone` n'a pas pu être
  observé (mode démo sans alertes). Recommandation manuelle : ouvrir
  l'app avec un vrai compte ayant des alertes actives (paiement en retard,
  arrivée du jour, etc.) et confirmer que chaque ligne de `.alert-hm`
  affiche le bon liseré de couleur (or/vert/bleu/rouille selon le type)
  et que le survol ne fait plus disparaître la couleur.
- Perte du micro-effet de survol vert sur les lignes d'alerte (voir
  itérations ci-dessus) — mineur, mais à signaler si quelqu'un le
  remarque.

## COMMIT D — surfaces (paper/card, palette) — contraste PAS à zéro, voir tableau

**Prévenu à l'avance dans le rapport COMMIT A** : la dette de contraste
était massive (637-719 échecs/écran) et concentrée sur une poignée de
couples. Ce commit devait la ramener à zéro. Elle passe à **220-228**
(**-69 %**), pas zéro. J'arrête ici et je documente, comme convenu.

### Ce qui a été changé

1. **Surfaces** (valeurs exactes du fichier de référence) : `--paper`
   `#FBF7F0` -> `#F4EFE3`, `--card` `#fff` -> `#FFFDF8`, `--bg` aligné sur
   `--paper`. Écart de luminance page/carte : 5,88 % -> 11,78 %, comme
   spécifié.
2. **`--muted`/`--text3`** : `#8A8070` -> mesuré, pas repris tel quel du
   fichier de référence. Sa valeur (`#7A7567`, 4,60:1 sur blanc PUR)
   restait sous 4,5:1 contre plusieurs autres teintes quasi-blanches que
   porte réellement `app.html` (paper, cream, card...). Recalculé
   `#706B5D` par mesure directe contre TOUTES les teintes de fond
   trouvées : 4,53:1 dans le pire cas. 413 usages via la variable + 26
   occurrences en hex brut corrigées (1 gradient décoratif non lié au
   texte, volontairement laissé intact).
3. **`--gold-ink:#8e6414`** (nouvelle variable, valeur du fichier de
   référence) : l'or `#C9963A` ne fait que ~2,7:1 sur fond clair — jamais
   utilisable comme couleur de TEXTE, seulement en accent/fond/bordure.
   Câblé sur 3 sites vérifiés un par un (pas par recherche-remplacement
   globale) :
   - `#tssNet` (bandeau stats Today, sur `.v2-card` = `var(--card)`, clair)
   - `.v3-card-link` (liens « + N more → », sur `.v3-card{background:#fff}`, clair)
   - `.onb-langbar button.is-active` (sélecteur de langue onboarding, sur
     `#onboardingV3{background:#FAF6EE}`, clair)

### Deux erreurs faites puis corrigées AVANT de committer

En généralisant trop vite « l'or en texte doit devenir gold-ink », j'ai
d'abord appliqué ce changement à `.aria-hero-counter-lbl` (« SIGNAUX ») et
`.price-season` (« saison normale ») — puis vérifié leur contexte réel
(`rgba(255,255,255,.88)` et `#fff` sur les éléments voisins immédiats) :
ce sont des composants sur fond **sombre** (bandeau ARIA vert foncé, carte
prix vert foncé). `gold-ink` y aurait rendu le texte quasi invisible —
l'inverse du problème visé. Les deux échecs de contraste que montrait le
diagnostic pour ces éléments (`rgb(201,150,58)/rgb(27,67,50)` etc.)
demandent en réalité un or plus CLAIR sur fond sombre, pas plus foncé —
un problème distinct, non résolu ici. Annulé les deux avant de committer,
gardé uniquement les 3 sites où j'ai vérifié le fond directement dans le
CSS avant d'éditer.

### Non fait dans ce commit (scope ambigu, pas deviné)

- **Titres Cormorant en graisse 600** : 138 usages de `font-weight` avec
  Cormorant Garamond dans `app.html`, réparti 300/400/500/600/700 — un
  remplacement global casserait des usages décoratifs volontairement plus
  légers (logo, nombres). Le fichier de référence ne clarifie pas non plus
  quels éléments précis visent les 600 au-delà de « titres ». Pas fait.
- **Contours à 1,5px** : dans le fichier de référence, le 1,5px cible des
  classes précises (`.aicon`, `.pact`, `.chip`, `.ccard`/`.pcard`/`.sig`/
  `.frow`) qui, comme `.tone-tile` au COMMIT C, **n'existent pas** dans
  `app.html` — `.v2-card`/`.v3-card` (l'équivalent réel le plus proche)
  utilisent déjà `1px`, comme la classe `.card` de base du fichier de
  référence lui-même (pas 1,5px). Pas de cible sûre identifiée, pas fait.

### Tableau des couples restants (46 groupes, 220 échecs, écran `today`/1440/fr — représentatif des 48 combinaisons)

| Couple (texte/fond) | Ratio | Seuil | Nb | Exemple | Piste |
|---|---|---|---|---|---|
| `rgb(201,150,58)` / `rgb(255,253,248)` | 2.61 | 3 | 25 | `4 (DIV)` | or-sur-carte non identifié — sites multiples, à vérifier un par un comme ci-dessus |
| `rgb(255,255,255)` / `rgb(250,246,238)` | 1.08 | 3 | 21 | `ARIA (aria-hero-name)` | texte blanc sur fond clair — suspect, probablement lié à l'état du bandeau ARIA (COMMIT G) |
| `rgb(201,150,58)` / `rgb(250,246,238)` | 2.46 | 3 | 20 | `lo (EM)` | idem or-sur-clair |
| `rgb(141,161,153)` / `rgb(27,67,50)` | 4.06 | 4.5 | 15 | `PERS. (qv-stat-lbl)` | texte clair sur fond sombre, tout près du seuil |
| `rgb(201,150,58)` / `rgb(255,255,255)` | 2.66 | 4.5 | 12 | `J+5 (v3-cal-when)` | or-sur-blanc, calendrier |
| `rgb(138,134,120)` / `rgb(250,246,238)` | 3.38 | 4.5 | 10 | `English (BUTTON)` | **2e teinte grise distincte** de `--muted`, non traitée par ce commit |
| `rgb(255,255,255)` / `rgb(37,211,102)` | 1.98 | 4.5 | 10 | `💬 WhatsApp (A)` | couleur de marque tierce (WhatsApp) — ne pas toucher |
| `rgb(255,255,255)` / `rgb(255,253,248)` | 1.02 | 4.5 | 10 | `16 (BUTTON)` | blanc sur quasi-blanc — probable bug distinct, pas un simple réglage de palette |
| `rgb(111,123,116)` / `rgb(15,35,24)` | 3.74 | 4.5 | 8 | `Guests (SPAN)` | texte clair sur fond sombre |
| … 37 autres groupes, 1 à 7 occurrences chacun | | | 49 | | long tail, voir `auditContrastGroups()` en direct |

**Non résolu par ce commit, signalé explicitement** : `--muted` sert aussi
de texte sur fonds sombres (vert `#0F2318`/`#1D4D3A`) où la même variable
doit être plus CLAIRE, pas plus foncée — conflit structurel, pas
réparable en changeant une seule valeur. Nécessite une variable séparée
pour le texte secondaire sur fond sombre.

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : **220-228 selon combinaison, PAS zéro** (était
   225-233 avant le dernier ajustement or, 664-719 avant COMMIT D) — cliquet
   resserré, aucune régression, mais critère non atteint. Voir tableau
   ci-dessus.
4. `auditLabels()` : **0** (inchangé)
5. `auditTones()` : `fautes: []` (inchangé)
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT` au sens du cliquet (aucune régression), **ROUGE** au
sens du critère explicite « contraste à zéro » de ce commit.

### PHASE 4 — champs affichés ancien vs nouveau

Sans objet : aucun champ ajouté/retiré, uniquement des couleurs.

### Service worker

v390 -> **v391**.

### Ce qui reste douteux / à faire à la main

- Le tableau ci-dessus, en particulier la 2e teinte grise (`rgb(138,134,
  120)`) qui n'est pas `--muted` et n'a pas été identifiée dans ce commit.
- `aria-hero-name` blanc sur fond clair (21 occurrences) — probablement
  lié à un état du bandeau ARIA à examiner au COMMIT G, pas retenté ici
  pour éviter une 3e erreur de contexte.
- `--muted` sur fond sombre reste sous le seuil (conflit structurel noté
  en commentaire dans le CSS, l.60+).
- Titres Cormorant (graisse) et contours 1,5px : scope ambigu, pas fait,
  voir section dédiée ci-dessus.

## COMMIT D-bis — scission `--muted-on-light` / `--muted-on-dark` (SW v392)

`--muted` servait de texte à la fois sur fond clair et sur fond sombre —
deux corrections opposées pour un seul token, signalé comme non résolu
au COMMIT D. Scindé en `--muted-on-light` (#706B5D, alias de l'ancien
`--muted`) et `--muted-on-dark` (#B6B2A7, mesuré contre les deux fonds
sombres alors repérés via `auditContrastGroups()` : #1D4D3A -> 4,56:1,
#0F2318 -> 7,78:1). Cliquet resserré sur les 48 combinaisons, contraste
en baisse partout (~220 -> ~214-222 selon écran), aucune régression.

## COMMIT D-ter — les cinq causes du contraste restant (SW v394)

Après D-bis, `auditContrastGroups()` montrait ~220 échecs par écran,
mais concentrés sur une poignée de couples — pas 220 bugs isolés. Cinq
causes distinctes, traitées dans ce commit :

### 1. L'or comme texte sur fond clair

`#C9963A` ne fait que 2,46:1 sur crème et 2,66:1 sur blanc — jamais
suffisant pour du texte ou une icône porteuse de sens. Remplacé par
`--gold-ink` (#8e6414, 4,89-5,27:1 selon le fond clair réel) partout où
l'or portait du texte sur un fond vérifié clair : `.brief-title`,
`.v5-card-rev`, `.v3-cal-when`, `.v4-market-row.is-you .v4-market-name`,
`.v3-stat-accent`/`.v3-stat-clk:hover`, `.v3-welcome-eyebrow`,
`.onbV3-logo em`, `.tms-due`/`.tms-go`, `#setupOneLinerProgress`/
`#setupProgress`, le bouton « Ouvrir les réglages », `#liveFlightBtn`,
7 icônes Tabler de `.hm-hdr-lbl`/`.v2-card-title`, les deux
`.settings-title` inline (IA, ARIA Mémoire), le lien « réglages/
settings », les labels de mois du calendrier (ruban + mini-calendrier),
le countdown « DANS Nj » des guests à venir, `renderDemoMonthCard()`
(tuile + pastille + « Reste à régler »), la pastille « 🟢 N arrivée(s) »,
et deux règles `!important` qui écrasaient encore le fix sur
`.tonight-price`/`.market-alert` (repointées vers `--s-gold-ink`, déjà
défini et déjà utilisé par `.bk2-note-tag`). `.bk2-task-flag` et
`.bk2-rota-state.todo` (`var(--s-gold)`) repointés pareil.

**Volontairement laissé en or** : chaque site où le fond réel est vert
sombre, vérifié un par un (le CSS du COMMIT D prévenait : deux erreurs de
contexte déjà commises ce jour-là). `.af1-orb-letter` et `.aria-badge`
(fond `.aria-hero`/`.chat-header`/`.aria-modal-hd` = vert plein) ;
`.aria-hero-counter-num` (fond `.aria-hero`, dégradé) ; `fl-val.gold`/
`.price-season` (vert #1B4332, déjà signalé non résolu volontairement) ;
les deux logos "Staff**lo**" d'onboarding (`#owStep0`, `#owHeader` — fond
`linear-gradient(...,var(--green3),...)`). Ces derniers apparaissent dans
`auditContrastGroups()` comme « or sur crème/carte » alors que le fond
réel est sombre : `_auditBgOf()` ne lit que `background-color`, pas
`background-image`, et remonte donc jusqu'au premier ancêtre à
`background-color` opaque — qui se trouve être clair. Angle mort de
l'outil de mesure, pas un bug d'affichage ; non touché.

### 2. Les gris-verts sur vert sombre

Les 3 couples signalés (`rgb(141,161,153)`/`#1B4332` 4,06 ;
`rgb(111,123,116)`/`#0F2318` 3,74 ; `rgb(118,142,132)`/`#1B4332` 3,16)
n'étaient PAS `--muted-on-dark` — c'étaient des `rgba(255,255,255,.4)`
et `.5` en dur (`.qv-stat-lbl`, `.qv-meals-lbl`, `.bot-nav .nav-item`,
puis en élargissant : `.bd-lbl`, `.fl-lbl`, `.hstat-lbl`, `.crm-stat
label`, `.price-lbl-home`, et une dizaine de labels inline — CONNEXION
EMAIL, INTÉGRATIONS, INBOX, PRIX CE SOIR, MESSAGE PRÊT, Net vous/Par
nuit — jamais reclassés au COMMIT D-bis). `--muted-on-dark` (#B6B2A7)
a été re-vérifié empiriquement contre un troisième vert réel non couvert
par D-bis, `#1B4332` (fond de `.qv-inhouse`) : 5,23:1, au-dessus des deux
autres — la valeur du token n'était donc pas en cause. Les 18 sites
repointés dessus (16 réels + 2 placeholders `::placeholder`, harmless).
Cliquet : ces 3 couples ont disparu de `auditContrastGroups()`.

### 3. Deux gris en dur, hors token

`#8A8678` (14 sites : bouton langue onboarding, `.tms-s`, labels
`onbV3-*`) et `#8a8a7a` (34 sites : paywall, onboarding, staff picker,
détail lead, liste clients) ne passaient par aucune variable. Repointés
vers `--muted-on-light` (tous vérifiés sur fond clair — cartes/panneaux
blancs, crème ou `var(--card)`). Les usages en `background`/`border`
(badges COLD/LOST) laissés intacts : hors périmètre (c'est la couleur de
texte qui manquait de token, pas le badge).

### 4. WhatsApp — couleur de marque tierce

`#25D366` + texte blanc (1,98:1, ~10 éléments) est la couleur officielle
WhatsApp, pas un choix de palette Stafflo — non modifiable. Exception
ajoutée directement dans `auditContrast()` (app.html) : tout élément dont
le fond composité tombe sur `rgb(37,211,102)` (± 2/canal) est ignoré par
l'audit, avec commentaire expliquant pourquoi. Disparu du rapport.

### 5. Blanc sur blanc, ratio 1,02 — diagnostiqué, PAS corrigé

`rgb(255,255,255)` sur `rgb(255,253,248)` (carte), ~10 éléments par
écran, ex. `16 (BUTTON)`, `→ (SPAN)`, `23 (BUTTON)`.

- **Éléments exacts** : les boutons de jour du calendrier
  (`data-cal-day="..."`, `renderRibbon()` l.~7963 et `buildRichSummary()`
  / `cardCalendarMini` l.~34640) pour les jours arrivée/départ, plus leur
  span flèche (`→`/`←`) imbriqué qui hérite de la même couleur.
- **Règle qui pose le blanc** : `fg = '#fff'` — couleur en dur dans le
  template JS (`if (info.type === 'arrival') { bg = 'rgba(60,108,17,.85)';
  fg = '#fff'; ... }`, et `departure` avec `rgba(163,45,45,.78)`).
- **Règle qui pose le fond** : `background:'+bg+'` — même template,
  `rgba(60,108,17,.85)` (arrivée) ou `rgba(163,45,45,.78)` (départ) :
  volontairement semi-transparent, pas une couleur en dur oubliée.
- **Conditionnel ou en dur ?** En dur (littéral rgba dans le template),
  mais c'est le fond voulu — pas un état manquant.
- **Racine du faux positif** : `_auditBgOf()` (COMMIT A) n'accepte un
  fond que si `c.a >= 0.95` ; à `.85`/`.78` d'opacité, il le rejette et
  remonte à l'ancêtre suivant — la carte `.v2-card` (`--card`, quasi
  blanche) — au lieu de composer la couleur avec ce qu'il y a dessous.
  Résultat : blanc comparé au mauvais fond. Le rendu réel (blanc sur vert/
  rouge à 85%/78% d'opacité, sur fond carte) est parfaitement lisible.
- **Même famille que les 21 `aria-hero-name` du COMMIT D ?** Non — famille
  voisine (même fonction `_auditBgOf()` en cause) mais racine différente :
  `aria-hero-name` est un angle mort sur `background-image` (dégradé
  jamais lu comme fond), celui-ci est un angle mort sur le SEUIL d'opacité
  (`.85`/`.78` rejetés comme « pas assez opaque » au lieu d'être composés).
  Deux limites distinctes du même outil de mesure, pas le même bug.
- **Préexistant ou introduit par C/D ?** Préexistant — `renderRibbon()`/
  `buildRichSummary()` datent d'avant le chantier contraste, et
  `_auditBgOf()` a ce seuil `>= 0.95` depuis le COMMIT A. Rien à voir avec
  C ou D : c'est l'audit qui vient de le révéler, pas une régression.
  Pas touché dans ce commit (hors périmètre explicite).

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : **114-146 selon combinaison** (était 214-222 avant
   ce commit) — cliquet resserré sur les 48 combinaisons, aucune
   régression. Toujours pas zéro : long tail de couples à 1-3 occurrences
   (voir `auditContrastGroups()` en direct) et les faux positifs de
   `_auditBgOf()` documentés ci-dessus (causes 1 et 5), non retentés ici.
4. `auditLabels()` : **0** (inchangé)
5. `auditTones()` : `fautes: []` (inchangé)
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT`.

### Service worker

v393 -> **v394**.

### Ce qui reste douteux / à faire à la main

- Long tail de `auditContrastGroups()` (couples à 1-7 occurrences,
  fonds divers) — pas traité, pas la cause principale.
- Cause 5 (blanc sur blanc / faux positif `_auditBgOf()` sous 0,95
  d'opacité) : diagnostiquée, pas corrigée. Corriger proprement demande
  de faire composer `_auditBgOf()` avec l'ancêtre au lieu de rejeter un
  fond translucide — changement de l'audit lui-même, à faire dans un
  commit dédié (risque de changer le compte de cliquet sur tout
  `app.html`, pas juste ces boutons).
- `--muted` (alias non préfixé) reste défini pour compat ; tout nouveau
  code doit utiliser `--muted-on-light`/`--muted-on-dark` explicitement.

## COMMIT G — panneau ARIA : bande verte en tête, corps clair (SW v397)

Porté depuis `stafflo-ui-v19.html` (`renderHero()`, `syncFab()`, bloc CSS
« PANNEAU ARIA — bande verte en tête, corps clair »).

### 0. Découverte préalable — ce qui est vraiment visible par défaut

Le composant visé au départ (`.aria-hero` / `#ariaHeroToday`, `#ariaHeroGuests`,
`#ariaHeroVilla`) s'est révélé masqué par défaut. Deux drapeaux en cause,
aucun des deux touché par ce commit :

- **`stafflo_aria_first_v1` — ON par défaut depuis v87** (`flagOn()`,
  app.html l.~3590 : `localStorage.getItem('stafflo_aria_first_v1') !== '0'`
  → vrai si jamais posé). SW est à v397, v87 est très ancien : la quasi-
  totalité des comptes réels tournent avec le flag ON depuis longtemps.
  Effet sur Today : `applyV3Mode()` (l.~3608) masque tous les enfants de
  `#tab-today` sauf `#todayV3` — dont `.v3-hero`, PAS `.aria-hero`
  (`#ariaHeroToday`). Sur Guests/Villa, `#guestsV5`/`#villaV3` remplacent
  tout le contenu de l'onglet de la même façon (fonctions distinctes,
  même esprit) — `#ariaHeroGuests`/`#ariaHeroVilla` disparaissent avec le
  reste. Vérifié à l'écran (captures `tests/shots/today-390-fr.png`,
  `clients-390-fr.png`, `villa-390-fr.png` avant ce commit) : Today montre
  `.v3-hero`, Guests montre la fiche du client courant (pas de bande ARIA
  du tout), Villa montre « Ce mois · votre maison » (une seule bulle
  « Aria : » inline, pas de bande non plus).
- **`#ariaFab` masqué depuis v162/v167** — trois règles CSS distinctes,
  toutes `!important` : l.~828 (globale, v167 : « masqué AUSSI sur mobile
  réel, les hide v162 étaient scopés desktop-only »), l.~2471 (scopée
  `#staffloShell`, v77, antérieure et redondante avec les deux autres),
  l.~2474 (globale, v162 : « un seul orbe ARIA, le A de la nav suffit,
  badge déplacé sur `#nb-aria` »). Le HTML `#ariaFab` est conservé par
  design pour réversibilité (commentaire v162 explicite).

Remonté à l'utilisateur avant de continuer (AskUserQuestion) : quel
composant traiter ? Décision reçue — traiter les DEUX (`.aria-hero` ET
`.v3-hero`, le composant Today réellement visible), ne rien ajouter à
Guests/Villa (décision produit antérieure, pas un oubli, pas à renverser
dans un commit de couleur), factoriser le CSS entre les deux plutôt que
le dupliquer, documenter les deux drapeaux ici.

### 1. Ce qui est factorisé

`.v3-hero` porte désormais AUSSI la classe `.aria-hero` (HTML :
`class="v3-hero aria-hero"`) et réutilise telles quelles les classes déjà
écrites pour Today/Guests/Villa : `.aria-hero-top` (bande), `.aria-hero-left`,
`.aria-online-dot`, `.aria-hero-input-row`, `.aria-hero-input`,
`.aria-hero-go`, `.aria-mic-btn`, `.aria-suggs`/`.aria-sugg-chip`,
`.aria-actions`/`.aria-action-btn`. Zéro règle de panneau dupliquée : la
règle de base `.v3-hero{background:#0F2318;...}` a été retirée (elle ne
faisait que répéter ce que `.aria-hero` fournit maintenant), `.v3-hero` reste
une classe marqueur (ciblée par le hook responsive landscape l.~1843 et par
`wireV3Chips()`, devenu un no-op inoffensif — voir §4).

Seule différence assumée entre les deux : l'identité dans la bande. Today/
Guests/Villa gardent la version imposante (`.aria-logo-lg` 56px +
`.aria-hero-name` 30px + tagline + decision-line). `.v3-hero` réutilise la
paire compacte qui existait déjà ailleurs dans le fichier — `.aria-logo`
24px + `.aria-name` 17px, jusqu'ici seule dans l'en-tête du pop-up
`#ariaModal` — plutôt que d'inventer une troisième taille. `.aria-name` n'a
plus de `color` par héritage (elle vivait uniquement dans un en-tête déjà
`color:#fff`) : `color:#fff` posé explicitement sur la règle elle-même,
sinon le texte prend l'encre du corps clair une fois réutilisée dans la
bande sombre de `.v3-hero` — trouvé à l'écran, pas à la lecture.

Les 3 suggestions et 4 actions or de `.v3-hero` pointent vers les MÊMES
prompts que `.aria-hero` (même fonction `ariaBandAction()`, voir §3) : un
seul jeu de prompts ARIA à maintenir des deux côtés du flag.

### 2. Le panneau lui-même (Today/Guests/Villa + v3)

- Bande : `.aria-hero-top`, dégradé 158°, trois teintes échantillonnées
  dans la référence (`--aria-band-hi:#182821`, `--aria-band:#13201A`,
  `--aria-band-lo:#0E1B15`), non retouchées. Filet or 1px en bas
  (`border-bottom:1px solid rgba(201,150,58,.55)`), coins hauts arrondis
  nichés dans le rayon du panneau (`calc(var(--r-xl) - 1.5px)`).
- Corps : `var(--card)` (déjà le blanc-crème des `.v2-card`, cohérence avec
  le reste de l'app plutôt qu'une valeur inventée).
- `.aria-hero{overflow:visible}`, aucun `max-height` — comme la référence,
  pour la même raison qu'elle documente (une version antérieure tranchait
  les 4 actions en deux sur mobile avec ce genre de contrainte).
- Champ : blanc, cerclé de vert 2px (`var(--aria-band)`, la teinte médiane
  de la bande), focus → or. Le bouton d'envoi (`.aria-hero-go`) est passé
  d'un dégradé à `background:var(--gold)` uni (fidèle à la référence) —
  ça a exposé un vrai bug de contraste, voir §5.
- Compteur signaux : retiré des 3 bandes ET de la bande `.v3-hero`, ne vit
  plus que dans l'en-tête de `#ariaModal` (une seule instance suffit
  désormais — les `.ariaCounterNumMirror` de Guests/Villa sont retirés,
  `updateAriaCounter()` simplifiée en conséquence).
- Exclusivité bande/FAB : `syncAriaFabBandExclusivity()` (IntersectionObserver,
  seuil 0.35, reconstruite à chaque `goTab()`, dégradation sûre si
  `IntersectionObserver` est absent). **Dormante par construction** :
  cible `#ariaFab`, qui reste masqué par les 3 règles listées en §0 — ce
  commit ne les touche pas. Pour réveiller le flottant (décision produit
  à part, pas un effet de bord de G) : retirer/adapter les règles
  `#ariaFab{display:none!important}` aux lignes ~828 et ~2474, et
  `#staffloShell #ariaFab{display:none!important}` à la ligne ~2471.

### 3. Bug trouvé en route : les chips ne faisaient rien

`ariaQuickAction(kind)` (utilisée par les anciens `.aria-hero-chip` ET
`.v3-chip` via `wireV3Chips()`) n'a jamais ouvert le pop-up elle-même —
elle écrit seulement dans `#ariaModalInput`, en supposant le pop-up déjà
ouvert (vrai pour ses appelants historiques, les chips DANS le pop-up).
Deux bugs cumulés sur les boutons de bande/v3 :

1. Kinds jamais mappés : `'email'`, `'whatsapp'`, `'analyze'`, `'checklist'`
   n'existaient pas dans la table de prompts de `ariaQuickAction()` (seul
   `'price'` était géré, en cas spécial) — clic sans aucun effet, silencieux.
2. Même avec un kind valide, l'appeler depuis l'extérieur du pop-up écrit
   dans un champ caché (`display:none` sur `.aria-modal-bg`) sans jamais
   l'ouvrir.

Nouveau wrapper `ariaBandAction(kind)` (app.html, juste après
`ariaQuickAction()`) : ouvre le pop-up d'abord (idempotent), rejoue le kind
réel ensuite. `'price'` fait exception — elle s'ouvre déjà elle-même
(grounding price-intelligence), pas de double ouverture. Tous les boutons
de bande/v3 utilisent désormais des kinds réels (`who_arrives`, `price`,
`staff_brief`, `write_msg`, `paste_email`) au lieu des anciens jamais
mappés — les 3 suggestions et 4 actions or fonctionnent réellement,
contrairement aux 5 chips qu'elles remplacent.

### 4. Ce qui est commenté, pas supprimé

- Compteur « Actions Aria · 7 jours » de `.v3-hero` (`#v3HeroCounter`) :
  `display:none` depuis sa création, jamais raccordé à un affichage réel —
  commenté en HTML avec la raison, `renderV3Hero()` intacte (no-op sûr,
  `if (!num) return;`).
- `wireV3Chips()` : plus aucun `.v3-chip[data-chip]` dans le DOM après ce
  commit → boucle vide, no-op inoffensif. Fonction laissée telle quelle
  (pas de risque à la garder, cf. §3 sur `ariaQuickAction()` qu'elle
  appelait).

### 5. Bug de contraste trouvé en portant la bande (pas dans le plan initial)

Déplacer des éléments d'un fond en DÉGRADÉ (indéterminé pour
`auditContrast()`, jamais mesuré) vers un fond PLEIN (mesurable) a révélé
deux vrais échecs jusque-là invisibles à l'audit :

- `.aria-hero-go` (bouton d'envoi, `↑`) : blanc sur or plein = 2,66:1
  (icône 18px/700 → seuil « gros texte » 3:1, toujours sous la barre).
  Sur l'ancien dégradé, indéterminé, jamais vu. `color:#fff` → `color:
  var(--green3)` = 6,21:1. Même convention que le reste de la bande :
  l'or ne porte jamais de texte/icône blanc.
- `.aria-hero-counter-lbl` (« SIGNAUX ») : `rgba(201,150,58,.9)` sur le
  fond du chip composé sur `var(--green3)` = 4,47:1, sous le seuil 4,5
  (texte 8px, jamais « gros »). Invisible tant que le compteur vivait
  sur le dégradé de la bande. `rgba(...,.9)` → `var(--gold)` plein =
  5,15:1.

Les deux corrigés avant de committer. Vérifié par diff avant/après avec
un harnais Playwright ad hoc reproduisant exactement les conditions de
`tests/visual.mjs` (mêmes mocks, mêmes gels de `setInterval`, même
séquence `goto load → wait 800ms → setLang → wait 700ms → goTab`) : sans
ces deux fixes, +4 échecs réels sur les 48 combinaisons (régression de
cliquet confirmée) ; avec, retour exact aux comptes d'avant COMMIT G sur
les 48 (88/89/95 à 390px, 87/88/94 à 768/1440px — identiques à la
baseline pré-commit).

### 6. Les deux points de vigilance demandés

**Dégradés → indéterminés, de combien ils montent.** Mesuré par
`tests/visual.mjs` (compte officiel, écrit dans `tests/baseline.json`,
informatif — hors cliquet) :

- 390px : 49 → ~22-24 (léger bruit de ±2 d'un run à l'autre, déjà
  documenté comme caractéristique du harnais — voir COMMIT A). **Baisse**,
  pas hausse : les anciens `.aria-hero-chip`/`.v3-chip` vivaient sur
  l'ancien dégradé plein-panneau (indéterminés) et disparaissent ;
  `.aria-suggs`/`.aria-actions`/le champ vivent sur le corps clair PLEIN
  (résolvables, jamais indéterminés).
- 768px/1440px : 49 → ~68-70. **Hausse** cette fois — composition
  différente à ces largeurs, pas creusé plus loin que la confirmation
  du chiffre officiel (le harnais lui-même documente une marge de
  non-déterminisme resurgissant parfois à certaines largeurs, cf. COMMIT
  A « le harnais lui-même était non-déterministe »). Dans les deux cas,
  0 échec réel introduit (voir tableau §5) : ces éléments restent sur la
  bande en dégradé, ni pire ni mieux qu'avant, juste non mesurables.

**Les 21 `aria-hero-name` blanc-sur-clair du COMMIT D — disparaissent-ils ?**
Non reproductibles dans le code actuel : instrumenté précisément (classe
exacte `aria-hero-name`, avant/après ce commit, 390px ET 768px) →
**0 échec réel, 3 indéterminés, identique avant et après**. `.aria-hero-name`
vit sur un fond en dégradé depuis avant ce commit (le panneau entier
était un dégradé) et continue d'y vivre après (seule la bande l'est
maintenant) — sa classification n'a pas bougé d'un pouce. Les 21 échecs
réels mentionnés viennent d'un état antérieur au reclassement
dégradé→indéterminé introduit au COMMIT A-bis (voir RAPPORT-PORTAGE.md
plus haut) : un vrai bug d'état à l'époque, déjà résolu depuis par ce
reclassement, pas par ce commit — ni réintroduit ni « corrigé » ici,
juste confirmé absent.

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : **88/89/95 (390px), 87/88/94 (768/1440px)** — identique
   à la baseline pré-COMMIT-G sur les 48 combinaisons, 0 régression.
4. `auditLabels()` : **0** (inchangé)
5. `auditTones()` : `fautes: []` (inchangé) — les 4 actions or n'empruntent
   aucune teinte d'état (go/wait/house/alert).
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT`.

### Service worker

v396 -> **v397**.

### Ce qui reste douteux / à faire à la main

- La composition exacte des indéterminés supplémentaires à 768/1440px
  (§6) n'a pas été décomposée élément par élément — confirmé que 0 sont
  de vrais échecs, pas creusé plus loin faute de gain clair.
- `#ariaFab` et son exclusivité restent dormants (§0, §2) — décision
  produit à prendre séparément, pas dans ce commit.
- `wireV3Chips()` et le compteur `#v3HeroCounter` commenté (§4) : dead
  code mineur laissé en l'état par choix (strangler-fig), à revisiter
  seulement dans une session de cleanup dédiée.

## COMMIT I — calendrier : cases riches (SW v398)

### Recon d'abord (demandé explicitement après les deux surprises de G)

Harnais relancé, captures `calendar-390-fr.png`/`calendar-1440-fr.png` ouvertes
avant tout grep. Contrairement à G, **pas de piège** : un seul rendu, aucun
drapeau ne le gouverne.

- Composant affiché : `#tab-calendar` → `window.renderCalendarTab()` (une
  seule IIFE, ~l.8230-8380) → trois hôtes : `#calTabStrip` (bande 14 jours,
  inchangée dans ce commit), `#calTabGrid` (grille du mois — **la cible**),
  `#calTabUpcoming` (liste, inchangée).
- Aucun `navV2On()` ni `stafflo_aria_first_v1` autour de `renderCalendarTab`
  ou `#tab-calendar` — confirmé par grep ciblé après la capture, pas avant.
- Deux AUTRES calendriers existent dans le fichier, ni l'un ni l'autre visible
  ici — notés pour mémoire, non touchés :
  - `staffloCal` (module séparé, `#calBody`/`#calMonthLbl`) : vit dans
    `#cardCalendarMini`, une carte de l'ancien dashboard v2 Guests —
    doublement dormante (masquée par `#guestsV5` par défaut ET
    `data-collapsed="1"` sur sa propre carte).
  - `renderV3Calendar()` : liste « prochaines arrivées » sur le dashboard v3
    de Today, pas une grille.
  - Les cellules `data-cal-day`/`staffloCal.tap()` (clic → modale jour) sont
    un module tiers, appelé par `onclick` sur les cases mais dont la logique
    interne n'a pas été touchée — le clic continue de fonctionner
    exactement comme avant.

### Ce qui a changé

`renderMonth(occ)` (dans l'IIFE de `renderCalendarTab`) : les cases
(`.cal-grid-d` → **`.cal-case`**, renommée — seul usage dans tout le fichier,
vérifié par grep avant de renommer) portent maintenant :

- **Prénom en gras** : premier mot de `c.name` (`.split(/\s+/)[0]`).
- **Net par nuit** : réutilise `nights(c)`/`netAmt(c)` (déjà les fonctions de
  la card in-house de Today — même formule partout, y compris la bascule
  `confirmation_email` qui prime sur prix×commission). `netAmt(c)` retourne 0
  si `c.price` est vide — **pas de ligne prix dans ce cas**, jamais un « 0€ »
  affiché (même garde que le `v116` de `renderTodayStatsStrip`, réutilisée
  ici plutôt que réinventée).
- **Icône personnes + compte** : `<i class="ti ti-users">` + `c.guests`,
  même icône que les chips `bk2-chip` existants (cohérence, pas une nouvelle
  convention).
- **Flèche d'arrivée/départ** : `ti-plane-arrival`/`ti-plane-departure` (déjà
  utilisée ailleurs pour « Prochaines arrivées ») — seulement sur les jours
  `arr`/`dep`, absente sur un jour `stay` (pas d'événement d'arrivée/départ
  ce jour-là).
- **Infobulle complète** (`title` + `aria-label`, identiques) : format
  `{j} {mois court} — {type} · {nom complet} · {pax} pers. · {prix total}€`.
  Vérifié en conditions réelles (harnais démo) :
  `"17 juil. — arrivée · Famille Bianchi · 6 pers. · 17 500€"`,
  `"24 juil. — départ · Famille Bianchi · 6 pers. · 17 500€"`. Le prix de
  l'infobulle est le **total du séjour** (`c.price`, guest-paid), distinct du
  net/nuit affiché dans la case (host payout) — les deux se complètent au
  lieu de répéter le même chiffre, cf. CLAUDE.md §6 (distinction guest-paid /
  host-payout).
- **Événement** — overlay ajouté (`isInEventWindow()`, déjà écrite pour le
  module `staffloCal`, réutilisée telle quelle) : seulement sur un jour SANS
  réservation (`!info`), jamais prioritaire sur une case occupée. Aucun jour
  de juillet 2026 n'en porte (MK_EVENTS ne couvre pas ce mois) — vérifié à
  l'écran, pas un oubli.
- **Quatre tons (COMMIT C)** : `stay`→go, `dep`→alert, `event`→wait.
  **Arrivée en vert plein** (`var(--green)`, blanc, 11,08:1) — volontairement
  HORS du jeu des 4 tons (pas de `data-tone`), le jour le plus important du
  calendrier mérite plus qu'une teinte pâle. Anneau or (`.today`,
  `box-shadow:inset 0 0 0 2px var(--gold)`) cumulable avec n'importe lequel
  des tons ci-dessus.
- **Tailles** : 96px de haut ; 72px sous 860px de large (`@media(max-width:
  860px)`) — vérifié par mesure directe (`getComputedStyle`) aux deux côtés
  du seuil : 860px → 72px, 861px → 96px, exact.
- **Légende** mise à jour pour refléter les nouvelles couleurs (l'ancienne
  ne correspondait plus à rien : Arrivée était en dégradé or, Départ en
  pêche clair — aucun rapport avec les 4 tons du COMMIT C). Ajout d'une
  entrée « Événement », absente jusqu'ici alors que `.cal-grid-d` n'avait
  jamais porté ce cas.

Rien touché dans `render14Strip()` (bande 14 jours, restée à son format
compact existant — pas dans le périmètre demandé) ni dans `buildOcc()`
(la carte occupation reste construite à l'identique ; l'overlay événement
est calculé à la volée dans la boucle de rendu, pas injecté dans la map,
pour ne pas toucher à une fonction utilisée ailleurs par la bande 14 jours).

### Sortie du harnais (6 critères)

1. `node --check` : **OK**
2. Delta d'accolades : **-3** (inchangé)
3. `auditContrast()` : **88 (390px), 87 (768/1440px)** sur `calendar` —
   identique à la baseline pré-commit, cliquet resserré ailleurs (les
   anciens tokens ad hoc `--s-gold-tint`/`#f8e7d6`/`rgba(29,77,58,.18)`
   étaient moins bien mesurés que les tokens `--t-*` déjà audités du
   COMMIT C ; -1 échec sur plusieurs combinaisons `today`/`aria` en prime,
   sans lien direct avec le calendrier — effet de bord positif du
   remplacement, pas recherché).
4. `auditLabels()` : **0** (inchangé)
5. `auditTones()` : `fautes: []` — aucune des 3 teintes d'état (`go`/`dep`
   alerte/`event` wait) n'est posée sur un `.aicon`/`.pact`/`.btn` ; l'arrivée
   (vert plein) n'a délibérément pas de `data-tone`, hors du système des 4.
6. Erreurs console : **0/48**

`>>> HARNAIS: VERT`.

### Service worker

v397 -> **v398**.

### Ce qui reste douteux / à faire à la main

- Aucun jour de juillet 2026 (le mois par défaut de la démo) ne recoupe un
  MK_EVENTS — le ton `event`/wait n'a pas pu être vérifié à l'écran, seulement
  par lecture de code et logique (même fonction `isInEventWindow()` déjà
  utilisée ailleurs). À re-vérifier visuellement sur un mois qui recoupe un
  festival (ex. naviguer vers juin pour Marrakech du Rire) avant mise en prod.
- `staffloCal.tap()` (modale au clic) n'a pas été relu en détail — le
  comportement au clic est inchangé par construction (aucune ligne de cette
  fonction modifiée), mais pas ré-audité pour ce commit.

## COMMIT J — `isFirmBooking()` : les 74 replis sont morts (SW v399)

### Ce qui était demandé au départ, et pourquoi ça a changé de forme

Le brief initial demandait d'instrumenter chaque repli de `isFirmBooking()`
avec un `console.warn` pour transformer un risque supposé (repli silencieux
qui diverge de la canonique sans signal) en risque visible. Le recon a
démontré que ce risque n'existe pas dans le fichier actuel — voir
démonstration ci-dessous. Le commit a donc changé de forme : pas de
`console.warn`, pas de changement de comportement, juste une trace écrite
(ce document) et cinq commentaires sources aux points où un futur refactor
(notamment la découpe en modules) pourrait réintroduire le risque.

### Recon : combien de replis, où

`grep -n "isFirmBooking" app.html` → **74 occurrences** (pas ~10 comme
supposé au départ — le recon d'origine datait d'avant plusieurs commits qui
ont fait dériver les numéros de ligne). Canonique unique, exposée sur
`window`, l.10998-11006 :

```js
function isFirmBooking(c) {
  if (!c) return false;
  var bs = c.bookingStatus || c.booking_status || '';
  if (!bs) return true;
  return bs === 'confirmed' || bs === 'pending';
}
window.isFirmBooking = isFirmBooking;
```

Sur les 74, ~45 sont de vrais replis (ternaire ou garde avec branche
alternative) ; le reste sont des appels nus (pas de garde) ou des
commentaires.

### Démonstration : pourquoi les 74 sont morts

Deux raisons indépendantes, chacune suffisante seule :

1. **Hoisting.** `isFirmBooking` est une déclaration `function` classique
   (pas `const`/`var =`), donc entièrement hoistée (nom + corps) dans son
   bloc `<script>` (l.6704-29656, confirmé par `awk` sur les balises
   `<script>`/`</script>`). Elle est appelable dès la première ligne de ce
   bloc, indépendamment de sa position source à la ligne 10998. Vérifié à
   la main (`node -e`) : `typeof isFirmBooking` vaut `'function'` avant
   même que la ligne `function isFirmBooking(){}` s'exécute textuellement,
   dans un même script.
2. **Aucun `<script>` du fichier n'a `async`/`defer`/`type="module"`**
   (grep ciblé) — tous les blocs s'exécutent en synchrone, dans l'ordre du
   document. Les 6 sites de repli situés dans un bloc `<script>`
   *antérieur* au bloc 6704-29656 (l.3456, 3672, 4267, 4319, 4743, 4978)
   sont les seuls où un risque était théoriquement possible. Tous les six
   sont enveloppés dans des fonctions qui ne s'exécutent que plus tard —
   via `DOMContentLoaded`, `setTimeout`, ou un registre de renderers
   (`window._dashV2Renderers.push(...)`) — jamais au niveau racine de leur
   propre bloc. Le temps qu'elles s'exécutent, le bloc définissant
   `isFirmBooking` a déjà fini de tourner.

Aucun chemin de code, aujourd'hui, ne peut atteindre une branche de repli
avant que la canonique existe. Les ~45 replis sont du code mort, tous, sans
exception.

### Table des cinq replis qui divergeraient (si jamais ils s'exécutaient)

La majorité des replis sont des `: true` (fail-open, ne filtrent jamais) —
inoffensifs par construction, pas une vraie heuristique. Cinq réimplémentent
une vraie logique et **divergeraient** de la canonique s'ils s'exécutaient un
jour :

| Ligne(s) | Fonction | Repli | Ce qu'il rate vs canonique |
|---|---|---|---|
| 3672 | `firm()` | `!!(c && bookingStatus∉{lead,inquiry,quoted})` | Ignore `booking_status` (snake_case) ; traite tout statut hors `{lead,inquiry,quoted}` comme ferme — un `'cancelled'` serait à tort ferme. |
| 11283, 11289 | inline (guest lookup) | `bookingStatus==='confirmed'` | Rate `'pending'`, rate le statut vide (legacy = ferme dans la canonique), ignore `booking_status` (snake_case). Trop strict : sous-compte les fermes. |
| 31504 | `firm()` | `!!c` | Accepte n'importe quel client tant qu'il existe — ignore complètement le statut. `lead`/`inquiry`/`quoted`/`cancelled` seraient tous à tort fermes. |
| 33587 | `firmOf()` | `bookingStatus∈{confirmed,pending}` | Gère `'pending'` correctement, mais rate le statut vide (legacy = ferme) et `booking_status` (snake_case). |
| 33710 | inline (`buildAriaCtxChips`) | `booking_status==='confirmed'` | Snake_case seulement — ignore `bookingStatus` (camelCase), rate `'pending'`, rate le statut vide (legacy = ferme). |

Chacune de ces cinq lignes porte maintenant un commentaire au même format :
`/* repli mort par hoisting — DIVERGE de la canonique s'il s'exécutait : <détail>. Voir RAPPORT-PORTAGE.md, COMMIT J. */`
— placé juste au-dessus de la ligne concernée (deux emplacements pour la
paire 11283/11289, qui est le même repli dupliqué deux fois dans la même
fonction).

### Ce qui n'a PAS été fait (exprès)

- **Aucun `console.warn`.** Le repli n'a jamais de chance de s'exécuter
  aujourd'hui ; un warn qui ne se déclenche jamais n'aurait rien prouvé de
  plus que ce document, pour 45 points d'édition en plus.
- **Aucune suppression, aucune unification.** Les replis restent tels
  quels, y compris les cinq buggés — per [[strangler-fig]]/CLAUDE.md §2.7,
  aucun cleanup pendant la phase de build. Ils sont candidats pour la
  session de cleanup post-v1 : voir `stafflo-audit-backlog` (mémoire),
  section « isFirmBooking fallback guards ».
- **Aucun changement de comportement.** Six commentaires source, un
  document, un bump de service worker.

### Sortie du harnais

1. `node --check /tmp/all_js.js` (scripts extraits) : **OK**
2. Delta d'accolades : **-3** (inchangé — les commentaires n'ouvrent/ferment
   aucune accolade)
3. Pas d'audit visuel — zéro changement DOM/CSS, rien à capturer.

### Service worker

v398 -> **v399**.
