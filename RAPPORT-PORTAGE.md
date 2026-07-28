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
