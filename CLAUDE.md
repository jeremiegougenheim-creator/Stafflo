# CLAUDE.md — Manuel d'exécution Stafflo

> Lu automatiquement par Claude Code au démarrage de chaque session.
> Définit ce qu'est ce repo, comment l'éditer en sécurité, et les règles non-négociables.

## Contexte du repo

- **App** : single-file `app.html` (~44 000 lignes, 48 blocs `<script>`), hébergé sur GitHub Pages (stafflo.app), bientôt Cloudflare Workers (`wrangler.jsonc`, `scripts/build-site.sh`). **Gelé** : corrections seulement ; l'écran principal est l'Espace (`espace.html`, §2 et §14)
  - URL live : <https://jeremiegougenheim-creator.github.io/Stafflo/>
  - Repo path : `app.html` à la racine
- **Landing** : `index.html` (FR) + `en.html` (EN) dans le même repo
- **Backend** : Supabase project `rcjhgilpmojohmrqzokx` — Auth, Postgres + RLS multi-tenant, Edge Functions Deno, Realtime
- **Proxy AI** : edge function Supabase `ai-proxy` — **Mistral EU (Paris) uniquement**. L'ancien Worker Cloudflare et la cascade Groq/DeepSeek/Gemini/OpenAI ne sont plus utilisés.
- **Appel IA direct depuis le navigateur** (`callProviderAPI`) : coupé ; réactivable seulement par `localStorage.stafflo_direct_ai = 'on'` (garde-fou : `tests/evals-app-securite.mjs`)
- **Voix** : dictée Whisper existante (`transcribe`, Voxtral, Mistral UE). Pas de TTS, pas de voix comme chemin principal (§2).
- **Icons** : Tabler Icons via webfont, centralisés via `iconFor()`
- **Typographie** : Cormorant Garamond (titres, voix ARIA) + Inter (UI)
- **Palette** : cream `#FAF6EE`, dark green `#0F2318`, mid green `#1D4D3A`, gold `#C9963A`, gold soft `#E5C77A`
- **Villa pilote** (pas un modèle : Stafflo est un SaaS multi-villa, voir §16) : Villa DarJ, Marrakech. Équipe actuelle : uniquement celle de la fiche maison (`villa_settings.house_facts`) (l'ancienne cuisinière, partie en septembre 2026, ne doit réapparaître nulle part).
- **Fiche maison** : en base (`villa_settings.house_facts`), moteur `house-facts.js` — voir §13.

---

## 1. Avant chaque session

La version live (`app.html` sur GitHub Pages) **diverge souvent** de la version du repo local. Avant toute édition :

1. `curl https://jeremiegougenheim-creator.github.io/Stafflo/app.html -o /tmp/app-live.html`
2. `diff /tmp/app-live.html app.html`
3. Si diff non vide → **STOP** et demander quoi faire (rebase live → local, ou ignorer)
4. `git status` doit être clean
5. Confirmer la branche : `feature/*` pour tout sauf hotfix critique

## 2. Strangler fig — le produit, c'est la base + le serveur + des interfaces fines (décision du 15/10/2026)

Le pivot « ARIA-first v1 » (orbe, brief comme accueil, bouton vocal, cards qui se matérialisent) est **abandonné**. Les chiffres : en mai, 80 % des questions posées à ARIA venaient de boutons, pas du propriétaire ; en août, l'extraction réussissait à 54 %, le brief à 68 %. Un assistant qui a raison deux fois sur trois n'est pas une porte d'entrée. ARIA reste, **en coulisses** : lire (extraction serveur, regex d'abord), rédiger sur demande (réponse, brief, avis, à un geste sur un séjour ou un message), le point du matin. Jamais un onglet, jamais un orbe, jamais la voix comme chemin principal.

Ce que Stafflo est : **la base** (seule vérité), **le serveur** (automatisations : synchro Airbnb, alertes, liens), et **une interface fine par intervenant** :

| Intervenant | Interface | Règle |
|---|---|---|
| Propriétaire | `espace.html` (Jour / Séjours / Maison, ARIA dans l'en-tête) | écran principal ; moins à l'écran, pas plus |
| Propriétaire | `app.html` | **gelé** = réglages, prix, facturation, création d'un séjour direct — jusqu'à leur arrivée dans l'Espace, puis extinction. **Depuis le 15/10/2026, un compte connecté et configuré qui ouvre app.html arrive sur l'Espace** (script en tête d'app.html ; restent sur app.html : connexion, inscription, mise en route, liens profonds `?open=…`, retours OAuth/lien magique, `?app=1` = « Ouvrir l'app complète » pour cet onglet ; interrupteur `localStorage.stafflo_espace_home = 'off'`). Garde-fou : `evals-une-app` (Chromium) |
| Équipe | `equipe.html` (lien personnel, FR/AR) | jamais de prix, de téléphone, de notes |
| Client | `livret.html` (lien personnel par séjour) | lecture + « Votre arrivée » (répond vers la base) |

Méthode inchangée, non négociable : **strangler fig**. On construit à côté, derrière interrupteur ; on ne supprime rien ; un écran d'app.html n'est retiré qu'après 14 jours sans retour, dans une session de nettoyage dédiée.

### Règles que Claude Code DOIT suivre

1. **Ne jamais supprimer de code existant.** Wrap dans un conditionnel, ne pas retirer.
2. **Ne rien ajouter à app.html** sauf correction. Un nouvel écran va dans l'Espace.
3. **Un commit = une tâche**, tous les garde-fous avant chaque push (§15).
4. **Aucun cleanup pendant le build.** Une session dédiée, après 14 jours sans retour.
5. **Les deux UI doivent fonctionner en parallèle** : si l'Espace manque, app.html reste.

### Quand Claude Code est tenté de « cleaner »

Refuser poliment et demander que le changement soit scopé dans une session de cleanup dédiée. Tout « cleanup » pendant le build risque de régresser des features existantes (Inbox, Gmail OAuth, pricing, multi-villa).

### Ancien plan ARIA-first (pour mémoire, ne plus construire)

`ARIA_FIRST_V1` (localStorage `stafflo_aria_first_v1`, `?aria_first=1`) est ON depuis v87 dans app.html : le hero `.v3-hero` en dépend. On ne le retire pas (règle 1), on n'y ajoute rien. Composants prévus et non livrés : orbe animé, cards matérialisées, voix hold-to-talk — **ne pas les livrer**. La dictée Whisper existante (`transcribe`, Voxtral) reste.

## 3. Pattern d'édition safe sur app.html (13k+ lignes)

- **Localiser** : `grep -n "pattern_unique" app.html`
- **Vérifier le contexte** : `view` avec range 20-40 lignes autour
- **`str_replace`** avec 3-5 lignes d'ancrage (sinon match ambigu)
- Delta d'accolades de référence : **`-3`** (mesuré sur tout le fichier, oct. 2026). Pas un bug. Toute autre valeur = quelque chose est cassé.

## 4. Validation après chaque édition

- Script Python : extraire tous les `<script>` vers `/tmp/all_js.js`
  ```bash
  python3 -c "
  import re
  with open('app.html') as f: c = f.read()
  blocks = re.findall(r'<script>(.*?)</script>', c, re.DOTALL)
  open('/tmp/all_js.js','w').write('\n'.join(blocks))
  "
  ```
- `node --check /tmp/all_js.js`
- Ouvrir `app.html` dans le navigateur, vérifier qu'il n'y a pas d'erreur console
- Tester sur **iPhone réel** à chaque commit majeur (le simulateur ment)

## 5. Workflow git

- 1 commit = 1 changement propre (pas de batch end-of-day)
- Format : `feat(aria-first): commit 1 — orb central` ou `fix(voice): Safari iOS permission`
- Push après chaque commit pour rollback granulaire

## 6. Règles produit non-négociables

- L'AI ne dit **JAMAIS** "à vérifier dans le système" — propose toujours une action concrète
- Champs manquants marqués explicitement avec `?`
- **Pas de fake data** dans l'app
- Distinction guest-paid vs host-payout critique
- Commissions par défaut : Airbnb 3.6%, Booking 15%, Direct 0% — ⚠ à trancher par le propriétaire : le code n'est pas cohérent (3.6 à l'onboarding et sur les séjours, 15.5 « host-only » dans Réglages et `price-intelligence`). Ne pas « corriger » d'un côté sans décision.
- `cfg.minPrice` / `cfg.maxPrice` = plancher et plafond, ARIA doit les respecter
- Pricing tiers :
  - **Tier A** €69 / €179 / €399 — émergent
  - **Tier B** €99 / €249 / €499 — mid-luxe (default Marrakech)
  - **Tier C** €149 / €399 / €799 — premium
- Vocabulaire : "signal" préféré à "paste/collez"

## 7. Palette luxe (cohérence app + landing)

- Cream : `#FAF6EE`
- Dark green : `#0F2318`
- Mid green : `#1D4D3A`
- Gold : `#C9963A`
- Fonts : Cormorant Garamond + Inter partout (règle v19 ; DM Sans/Fraunces = résidus d'app.html, à ne pas propager)

## 8. Ce qu'il reste à construire, dans l'ordre (15/10/2026)

Chaque étape : une fonction serveur ou un écran fin, une éval, un commit. Détail et verdict : doc projet `REVUE-UX-UI-2026-10-15` et `ARCHI-CIBLE-2026-10-12`.

1. ~~Livret → base~~ (« Votre arrivée », fait et en ligne le 15/10).
2. ~~Équipe → base~~ (« Chambres prêtes », « Signaler un problème », fait et en ligne le 15/10) : table `staff_reports` (écrite par `staff-view` `action: report` après vérification du lien, 30/h/lien ; lue par le propriétaire, RLS ; `seen_at` = « Vu ») ; Espace › Jour carte « De l'équipe », « Chambres prêtes · qui · quand » sur le séjour ; `push-notify` `run` : une alerte par retour (`notified_at`), prénom + initiale du client seulement. Garde-fous : `evals-staff`, `evals-equipe-load` (Chromium), `evals-push`, `evals-espace`.
3. ~~Créer un séjour direct depuis l'Espace~~ (fait le 15/10 : Séjours › « Nouveau séjour » ; montant net dans `price` en €, payé par le client à part dans `details.financial.guestTotal`, chevauchement refusé ; aussi le calendrier du mois et la mise en page ordinateur — menu à gauche, deux colonnes ≥ 1024 px). **Modifier un séjour** (15/10, Séjours › séjour › Modifier) : nom, dates (chevauchement refusé, hors le séjour lui-même ; nouvelles dates → rechargement), source (une source hors liste, ex. WhatsApp, est gardée), « Net reçu (€) » et « Payé par le client (€) ». Net modifié → `price` = net et `commission` 0 (même règle que la confirmation Airbnb de l'app) ; payé → `details.financial.guestTotal` ; les autres clés de `financial` (relevé de l'email) restent, `editedAt` noté. Un séjour qui porte encore une commission (saisi dans l'app complète) l'affiche avec le net que l'app en déduit ; « c'est mon net » = `commission` 0, montant inchangé : c'est le propriétaire qui tranche, séjour par séjour. Rien n'est envoyé si rien n'a changé. Garde-fou : `evals-espace-fiche`.
4. **Réglages dans l'Espace** (Gmail, iCal, alertes, villa) → app.html = prix + facturation seulement.
5. **Passeports** (photo côté client, chiffrés, effacés à J+30) — à cadrer avec la politique de confidentialité.
6. Extinction d'app.html écran par écran, derrière interrupteur, 14 jours sans retour avant tout retrait.

## 9. Hors périmètre

- **TTS, orbe, voix comme chemin principal, « streaming cards »** — abandonnés (§2).
- **Multi-langues au-delà de FR/EN** (arabe : vue équipe seulement). Glossaire FR/EN archivé dans `_archive/strings.tsv`.
- **Réécriture complète, framework, app native** — refusés (décisions du propriétaire).
- **Tout cleanup d'app.html** — après 14 jours sans retour, session dédiée.

## 10. Critères de réussite

- « Qui arrive, que reste-t-il à faire » se lit en moins de 5 secondes, sur téléphone, dans l'Espace.
- Un séjour = nom, dates, une ligne d'état ; jamais une rangée de pastilles.
- Le client et l'équipe répondent sans passer par le propriétaire (heure d'arrivée, composition, repas, chambres prêtes).
- Aucun email Airbnb non relié depuis plus de 30 minutes. Aucun appel IA hors UE.
- ARIA ne cite jamais un fait absent de la fiche maison ou de la base (évals à chaque commit).
- app.html ne grossit plus ; chaque écran remplacé passe derrière interrupteur.

## 11. Conventions techniques

- **ARIA orchestrator** : point d'entrée AI unique. Ne jamais écrire vers l'ancien `#chatMessages v1`. Tous les appels AI passent par **`ai-proxy` (Supabase, Mistral EU) only**, jamais d'appel direct provider depuis le client. Intent classification heuristique route vers : `reason`, `write_fr`, `extract`, `fast_classify`, `chat_fr`. Override manuel : préfixe `/deep`.
- **localStorage = source of truth runtime** : les settings vivent en localStorage pour une UI snappy. `villa_settings` Supabase = backup multi-device, synced au save. **Ne jamais assumer que Supabase a le dernier état pendant une session** — toujours lire localStorage en premier.
- **`isMarrakechVilla()`** : certaines features sont gated par ce check. Quand on bosse sur une feature qui doit être universelle, vérifier qu'elle n'est PAS dans ce gate.
- **Service Worker** : `sw.js` filtre les requêtes non-HTTP/API pour éviter les erreurs cache chrome-extension. Si on ajoute des ressources externes, vérifier qu'elles ne cassent pas le filtre. **Toujours bump `CACHE_NAME` après un déploiement** pour forcer le refresh sur les devices users.
- **`isFirmBooking()`** : filtre les leads (inquiry/lead/quoted) des surfaces opérationnelles (calendrier, brief, contexte ARIA, header stats). Tab Demandes utilise `isRequestStatus()` séparément. **iCal merge logic et dup detection on save ne sont PAS filtrés** — ils ont besoin de la donnée brute.
- **Onboarding** : 3-step wizard, synced Supabase. Ne pas toucher sauf si la tâche le demande explicitement.
- **Intercepteur `window.fetch` global (ligne ~17271)** : réécrit l'`Authorization` de toute requête vers `SB_URL` avec le JWT de `_stafflo_session.access_token` si l'en-tête sortant est absent ou vaut encore la clé anon (`SB_ANON`). C'est ce qui fait fonctionner les RLS `auth.uid() = user_id` (ex. `crm_clients`) même quand une fonction d'appel (`pushToSupabase`, `sbHdrs`) ne construit qu'un header avec la clé anon — l'intercepteur corrige au niveau réseau, pas au niveau appelant. Piège : si tu testes un appel Supabase hors navigateur (Node, curl), cet intercepteur n'existe pas — il faut le simuler ou fournir directement le JWT, sinon RLS rejette silencieusement (`42501`) alors que le même code marche en prod.
- **`handle_new_user()`** (trigger `on_auth_user_created` sur `auth.users`) provisionne `profiles` ET `villa_settings` au signup, chaque insert dans son propre `BEGIN...EXCEPTION WHEN OTHERS` pour qu'une erreur sur une table ne bloque jamais la création de compte. Les échecs ne remontent PAS dans l'app (le trigger ne peut pas faire échouer le signup) — ils vont en `RAISE WARNING`, visibles uniquement dans les logs Postgres : Dashboard Supabase → Logs → Postgres Logs, ou MCP `get_logs(service: postgres)`, filtrer `error_severity = WARNING` et `event_message` contenant `[handle_new_user]`. Vérifier ces logs après toute campagne de signups si des comptes semblent mal provisionnés.
- **`crm_details_guard`** (trigger BEFORE UPDATE OF details sur `crm_clients`, 15/10/2026) : une clé écrite par le serveur (`guest_answers`, `guest_orders`, `payouts`, `financial`, `reservation_code`, `airbnb_thread_id`, `payout_eur`, `payout_source`) absente de la nouvelle version est reprise de l'ancienne ; pour `guest_answers` / `guest_orders`, la plus récente (`at`) gagne. Les autres clés restent libres. Raison : le formulaire d'app.html renvoyait `details: {}` à chaque modification et effaçait réponses, commande et versements ; `pushToSupabase` / `safePushToSupabase` n'envoient plus un champ `undefined`.
- **`maison_charges.deleted_at`** (15/10/2026) : une charge générée par erreur se retire (suppression douce) ; tous les lecteurs filtrent `deleted_at=is.null`.
- **`create_profile_for_user()`** : orpheline (aucun trigger ne l'appelle, sa logique est dupliquée dans `handle_new_user()`), `EXECUTE` révoqué pour `anon`/`authenticated`/`PUBLIC`. Cleanup (suppression) différé à une session dédiée, pas pendant le build ARIA-first.

## 12. Limitations connues à NE PAS toucher dans v1

- **Gmail OAuth** : Implicit flow → tokens expirent ~1h, daily reconnect nécessaire. Upgrade vers Authorization Code flow scopé pour un patch séparé, pas dans le pivot ARIA-first.
- **`deleted_at`** (suppression douce) existe sur `crm_clients`, `client_context`, `chat_history`, `prestataires`, `push_subscriptions`. Aucun `DELETE` HTTP dans l'app, sauf `forgetClient` (effacement RGPD volontaire) et `runDiagnostic` (retire la ligne de test qu'il vient de créer).

## 13. Fiche maison — en base (source unique des faits de la villa)

- Prix des repas, équipe, horaires, règles, chambres, menus, alentours, wifi, adresse, QR WhatsApp : **uniquement** dans la fiche maison, en paires `[fr, en]`. Depuis le 13/10/2026 elle est **en base** : `villa_settings.house_facts` (jsonb, propriétaire seulement, RLS) — plus jamais un fichier du site (`villa-facts.js` est un fichier vide, gardé pour les pages en cache).
  - **Moteur public sans données** : `house-facts.js` → `StaffloHouseFacts.build(data)` (mêmes clés que l'ancien `VILLA_FACTS` + `digest(lang)`), `StaffloHouseFacts.livretLinks(...)`.
  - **Modifier la fiche (15/10/2026)** : chaque compte la remplit et la modifie dans l'Espace › Maison (« Remplir / Modifier la fiche maison ») ; la sauvegarde écrit `house_facts` + `house_facts_ref` sur SA ligne `villa_settings` (owner_id). Paires `[fr, en]` ; un anglais vide reste vide en base et le français est repris à la lecture (moteur, Espace, livret) ; « Traduire les champs vides » = geste explicite (ai-proxy), relu avant d'enregistrer. Une fiche partielle est valide : une section absente n'est ni résumée, ni rendue, ni proposée en message. Garde-fous : `evals-espace-fiche` (Chromium), `evals-livret-load`.
  - **Copie de référence du pilote** (hors du site : dossier `_`, absent du build) : `_private/house-facts-pilot.json` — sert aux évals (empreintes du résumé et du livret). La base fait foi ; si le pilote modifie sa fiche dans l'Espace, la copie peut diverger : la recopier depuis la base avant de recalculer les empreintes.
  - **app.html** : `pullVillaSettings()` → `staffloHouseFactsHydrate(row.house_facts)` ; copie locale `stafflo_house_facts` rattachée à l'id du compte (démarrage), effacée à la déconnexion ; **jamais dans cfg** (elle repartirait avec `pushVillaSettings`).
  - **espace.html** : lit `house_facts` avec la ligne `villa_settings` du compte.
  - **livret.html** : reçoit la fiche de `livret-view` (lien personnel `?t=`), ou de la base pour le propriétaire connecté, ou (anciens liens envoyés avant le 14/10/2026, nom + dates exacts, séjour pas terminé) de `livret-view` sans jeton. Sinon un message clair FR/EN. Le script du livret est inchangé (`#livret-main`, lancé une fois la fiche reçue) ; rendu prouvé identique le 13/10/2026. La barre d'édition (nom, dates, tarif, PDF) n'apparaît qu'au propriétaire connecté ou avec `?edit=1`. **« Votre arrivée »** (lien personnel seulement, jamais imprimé) : le client envoie heure d'arrivée, couples / personnes seules, repas → `livret-view` POST → `details.guest_answers` tel quel, et `details.arrival_time`, `details.beds`, `meals` remplis seulement s'ils sont vides (jamais écrasés, jamais traduits). L'Espace affiche « Réponse du client · date » ; la vue équipe lit les mêmes champs. **Commande avant l'arrivée** (15/10/2026, même bloc) : repas chiffrés de la fiche (prix du groupe 1–6 / 7+) et `EXTRAS` de la fiche (prix, unité, `VILLA.currency`) ; la page n'envoie que `{id, q}`, `livret-view` recalcule les prix depuis la fiche → `details.guest_orders` (la dernière remplace la précédente), résumé des repas dans `meals` seulement s'il est vide. Rien n'est payé en ligne. Une commande nouvelle ou modifiée (total > 0) laisse une ligne dans `guest_notices` (écrite par `livret-view` seulement, lue par le propriétaire, RLS) → alerte « Claire V. a commandé · 2 500 MAD » par `push-notify` `run` (`notified_at`, jamais deux fois ; un renvoi identique n'en crée pas). Espace : « Commande du client », « Commande confirmée au client » (`details.orderConfirmedAt`), ligne « Confirmer la commande » dans « À faire », chiffre « Extras commandés par vos clients ». Vue équipe : « Commandé par le client » (extras, quoi et combien, jamais le prix). **Fiches voyageurs** (15/10/2026, interrupteur `VILLA.guest_registration` dans Espace › Maison › Règles) : bloc « Fiches voyageurs » du livret (lien personnel seulement), une fiche par voyageur (nom, prénoms, naissance, nationalité, pièce, profession, adresse) → `livret-view` les chiffre (AES-256-GCM, clé Vault `guest_reg_key`, rpc `guest_reg_key()` réservée au service) → `guest_registrations` (une ligne active par séjour, la dernière remplace, `enc` jamais lisible par anon/authenticated, `purge_after` = départ + 1 an) ; jamais renvoyées au lien ; le propriétaire les ouvre à la demande (fonction `guest-registrations` `get`, sa session), les imprime (une fiche par voyageur, à signer) ou les télécharge (CSV « ; »), « Marquer déclarées » = `details.regDeclaredAt`, « Déclarer les voyageurs » dans À faire le jour de l'arrivée ; cron `guest-reg-purge` efface le contenu (enc = null, `purged_at`). Base légale vérifiée le 15/10 (Maroc, loi 80-14 art. 36-38 : pièce + fiche signée à l'arrivée, déclaration électronique quotidienne — STDN —, fiches gardées un an ; sanctions art. 48) : doc projet `DECLARATION-VOYAGEURS-2026-10-15`. Garde-fous : `evals-livret-view`, `evals-guest-registrations`, `evals-livret-load`, `evals-espace-fiche`. Tout PATCH REST d'une fonction serveur envoie `Content-Type: application/json` (sinon 400 — bug trouvé en production le 15/10).
- **Lien personnel du livret** : table `livret_links` (un lien actif par séjour, index unique partiel, suppression douce, RLS propriétaire + `billing_gate`) ; `rpc livret_token(client_id)` obtient OU crée le jeton (atomique : le même lien sur l'app et l'Espace) ; edge function `livret-view` (`verify_jwt` off, l'accès c'est le jeton) renvoie `{facts}` tant que le séjour n'est pas terminé depuis plus de 7 jours (sinon 410). Aucun lien sans jeton n'est envoyé à un client (message de bienvenue, bouton Espace). Espace › séjour › « Livret » = message prêt à envoyer (lien personnel absolu, « Votre arrivée », ce que la fiche chiffre à commander), « Voir le livret » dans le même panneau. Garde-fous : `evals-livret-view`, `evals-livret-load`, `evals-livret-links`, `evals-house-facts`.
- **Ne jamais recopier un fait en dur dans app.html** (prompt, modèle de message, libellé). C'est ce qui avait figé « Faiza », « 300 MAD par personne » et « la Palmeraie » dans les réponses d'ARIA pendant des mois.
- Côté app : `villaFactsActive()` (Villa Dar J seulement, hors démo, coupe-circuit `localStorage.stafflo_facts_ai = 'off'`), `villaFactsForAI(lang)`, `villaStaffNames()`, `villaTeamLine(lang)`.
- Un wrapper `window.fetch` ajoute le résumé de la fiche (`VILLA_FACTS.digest(lang)`) à toute requête ai-proxy de **rédaction** (`write_*`, `chat_*`, `reason`, `brief`). **Jamais aux extractions** (`extract`, `fast_classify`, `vision`…) : un prix de la villa ne doit pas devenir une donnée client.
- `sw.js` ne met jamais `house-facts.js` (ni `villa-facts.js`, ni `livret.html`) en cache : un changement atteint ARIA au chargement suivant.
- Garde-fou : `node tests/evals-fiche-maison.mjs` (résumé à jour, injection, réponses types, pas de retour des copies figées). Le livret doit rendre **à l'identique** après tout déplacement de données.


## 14. Synchronisation Gmail → CRM côté serveur (`gmail-sync`) et Espace Stafflo

- **`supabase/functions/gmail-sync`** (edge function, `verify_jwt` off, protégée par l'en-tête `x-sync-key` vérifié en base par `gmail_sync_key_ok()` contre le secret Vault `gmail_sync_key`). Lit la boîte de la villa avec le jeton déjà stocké dans `villa_settings.email_connection` (scope `gmail.readonly` : **aucun envoi possible**).
- **Cron** (pg_cron + pg_net) : `gmail-sync-10min` (`*/10`, emails Airbnb des 3 derniers jours → `email_inbox`, `source = 'gmail_sync'`) et `gmail-reparse-30min` (`5,35`, re-parse les lignes insérées par l'app). Chaque passage écrit une ligne dans `sync_runs` (lisible par le propriétaire, RLS).
- **Multi-propriétaire** (v5) : aucun compte en dur. La synchro boucle sur chaque `villa_settings` dont `email_connection.refresh_token` existe ; tout est rattaché au propriétaire du passage. Un compte en erreur n'arrête pas les autres (réponse 207). `{owner: uuid}` limite un essai à un compte.
- **Parseur regex uniquement** (`parseAirbnb`). Un champ absent du texte reste vide. Garde-fou : `node tests/evals-gmail-sync.mjs`.
- **Rapprochement strict** (`findStay`) : code HM… → fil Airbnb → dates exactes avec un seul séjour → (rappel) nom complet exact. Sinon rien n'est relié. Une confirmation sans séjour crée le séjour (`details.origin = 'gmail_sync'`, `pending: ['price']` si pas de versement). Une annulation n'agit que sur code exact. Ne remplit que les champs vides, ne supprime jamais.
- **Espace Stafflo** (`espace.html`, noindex, jamais en cache) : poste de pilotage simple sur la même session que l'app. Jour / Séjours / ARIA / Maison, FR/EN. Lit `crm_clients`, `email_inbox` (non archivés), `sync_runs`. « Traité » = `archived_at` (soft). Aucun fait de villa en dur : la fiche (`villa_settings.house_facts`) n'est utilisée que si `villa_settings.house_facts_ref = 'villa-facts.js'` (drapeau « fiche en place », aujourd'hui le pilote) ; sinon bases du compte (nom, ville, chambres, équipe de la table `staff`) et ARIA répond « à confirmer ». Compte neuf : carte « Mise en route » (Gmail, premier séjour, équipe, alertes) avec liens `app.html?open=gmail|stay|settings`. Garde-fou : `node tests/evals-espace.mjs`.
- **Entrée sans Gmail** (15/10/2026, derrière interrupteur `EMAIL_IN_LIVE` dans espace.html, ou `localStorage.stafflo_email_in = 'on'`) : adresse par compte `in-<jeton>@stafflo.app` (table `inbound_addresses`, rpc `inbound_address()` obtient ou crée) ; le propriétaire y fait suivre ses emails Airbnb → Cloudflare Email Routing (catch-all) → Worker `workers/email-in` (postal-mime, secret `INBOUND_KEY` = secret Vault `inbound_key`) → fonction `email-in` (`inbound_key_ok`, ne garde que les emails d'Airbnb et la confirmation de transfert Gmail, doublons par Message-ID) → `email_inbox` `source = 'email_in'` ; le re-parse 30 min relie au séjour comme pour Gmail. Carte Espace › Maison « Emails Airbnb sans Gmail » (adresse, étapes, code de confirmation Gmail). Garde-fou : `evals-email-in`. À allumer seulement quand le routage Cloudflare et le Worker sont en place.
- Claude Code reste en lecture seule sur la base : les migrations, cron et secrets sont gérés par Claude (claude.ai).


## 15. Alertes, iCal, garde-fous (oct. 2026)

- **Alertes sur le téléphone (Web Push, sans service tiers)** : `supabase/functions/push-notify` (+ `webpush.ts`, chiffrement aes128gcm / VAPID en WebCrypto). Cron `push-notify-5min` : une alerte par nouvel email Airbnb utile (demande, message, confirmation, modification, annulation, versement), puis `email_inbox.notified_at` — jamais deux fois. Même passage : retours de l'équipe (`staff_reports`) et commandes des clients (`guest_notices`). Abonnements dans `push_subscriptions` (RLS propriétaire). Clé privée VAPID dans Vault, jamais dans le client. L'Espace propose « Activer les alertes » ; `sw.js` gère `push` et `notificationclick` (ouvre l'Espace). Sur iPhone : l'Espace doit être ajouté à l'écran d'accueil (`espace.webmanifest`).
- **Point du matin sur le téléphone** : cron `push-brief-matin` (`30 * * * *`) → `push-notify` `{action:"brief"}` : pour chaque compte avec des alertes actives, une notification « <nom de sa villa> — aujourd'hui » quand il est 8 h dans le fuseau de la villa (`tzFor` : déduit du pays, UTC sinon) → 8 h 30 locales. Arrivées, départs, à faire, messages, avis, calculés depuis la base (`buildBrief`, testé dans `evals-push`) ; livret, repas et message de départ comptés seulement avec une fiche maison. Rien si rien à signaler. `{dry:true}` = aperçu de tous les comptes. Alertes (`run`) : chaque email part sur les appareils de SON propriétaire.
- **iCal** : `supabase/functions/ical-fetch` lit les calendriers côté serveur (utilisateur connecté, https, liste fermée de plateformes, redirections vérifiées). Les proxys CORS publics de `fetchIcal` ne servent plus que si `localStorage.stafflo_public_cors = 'on'`.
- **Point du matin** : tâche planifiée claude.ai « Villa Dar J — à faire du jour (8h45) » (lecture seule de la base → email au propriétaire + notification). Pas de code dans ce dépôt.
- **Garde-fous à lancer avant tout push** : TOUS les `node tests/evals-*.mjs` (app-securite, app-ux, app-multivilla, fiche-maison, espace, gmail-sync, push, meteo, site-legal, ai-proxy, transcribe, polar, price-intel, donnees-publiques, staff, equipe-load (Chromium), une-app (Chromium), guest-registrations, email-in, livret-* (dont livret-view, livret-load en Chromium, livret-links), house-facts, site-build, email-body, airbnb-guests, planning), plus `node tests/visual.mjs` (avec `git checkout -- tests/baseline.json` avant et après). Les évals des fonctions serveur se lancent avec `PUSH_TEST_MODULES` / `POLAR_TEST_MODULES` (modules transpilés).
- **Allègement de l'UI** (`stafflo_trim_v1`, bloc « v499 — ALLÈGEMENT » en fin de app.html) : masquage CSS + bandeau « occupé ce soir » + lien Espace. `'off'` rétablit tout. Ajouter un masquage = une ligne de sélecteur dans ce bloc + un contrôle dans `tests/evals-app-ux.mjs`. Revue complète : doc projet `REVUE-UX-UI-2026-10-13`.
- **Dates fortes** : table `events` = vacances scolaires FR par zone (`zones`), festivals, marathon, fêtes lunaires (`source = 'estimate'` → affichées « approximatives »). Deux sortes de lignes : celles d'un compte (`owner_id`, RLS propriétaire) et le **catalogue partagé** (`owner_id` null, `country` ISO-2 obligatoire, `city` facultative), visible en lecture seule par chaque compte dont la villa est dans ce pays/cette ville (policy `events_shared_read` → `events_shared_visible()` + `country_code()`). Catalogue actuel : Maroc (fêtes religieuses, tout le pays) et Marrakech (festivals, vacances FR avec notes de marché Marrakech). Les notes et `demand_impact` sont propres à une destination : ne jamais partager une ligne hors de sa destination. Aucun compte ne peut écrire le catalogue (tenu côté serveur). Les lecteurs (Espace, app, `price-intelligence` avec le jeton du propriétaire) passent par la RLS. Toute date a une source ; suppression douce (`deleted_at`). L'Espace calcule les nuits sans séjour ; ARIA les reçoit sans jamais proposer de prix chiffré. `marrakech_events` = ancien moteur de prix d'app.html (hausses en % sans source) : à éteindre avec l'écran Prix, ne pas l'enrichir.
- **Propositions passées** : doc projet `PROPOSITIONS-2026-10-13` (intégré / à faire dans l'ordre / laissé de côté / à trancher). Le consulter avant de proposer une « nouvelle » idée.
- **Architecture cible** (doc projet `ARCHI-CIBLE-2026-10-12`) : la base est la seule vérité, le serveur fait les automatisations, les écrans restent fins. L'Espace (`espace.html`) est l'écran principal ; app.html est éteint écran par écran, derrière interrupteur, 14 jours sans retour avant tout retrait.


## 16. SaaS multi-villa (13/10/2026) — règles pour toute modification

Villa Dar J n'est que le pilote. Un nouveau compte ne doit rien voir, recevoir ni écrire du pilote.

- **Aucun identifiant du pilote en dur** : ni UUID, ni `villa_key`, ni email, ni téléphone, ni annonce Airbnb, ni nom de villa ou d'équipe comme valeur par défaut. Replis neutres : `villaNameOr()` / `ownerNameOr()` (app), `villaName()` / `owner()` (Espace). Garde-fous : `evals-app-multivilla`, `evals-espace` (v9), `evals-gmail-sync`, `evals-push`.
- **Fiche maison** : choisie par la base, jamais par le nom — données dans `villa_settings.house_facts`, drapeau `house_facts_ref = 'villa-facts.js'` (valeur historique, gardée : push-notify, Espace et app la lisent). App : `cfg.houseFactsRef`, relu à chaque démarrage par `pullVillaSettings()` → `villaFactsActive()`. Livret, repas, message de départ : seulement avec une fiche. Livret ouvert à toute villa (15/10/2026) : nom, ville, hôte, premier contact et son rôle viennent de la fiche, signé « Livret préparé avec Stafflo » ; rendu du pilote identique au caractère près (empreintes dans `evals-livret-load`).
- **Fiche hors du site public (13/10/2026)** : plus de wifi, téléphones, adresse ni QR dans un fichier servi. ⚠ L'historique git du dépôt public garde l'ancienne version de `villa-facts.js` et de `livret.html` tant que le dépôt n'est pas privé.
- **Lignes `villa_settings`** : toujours par `owner_id` (le compte), jamais par une `villa_key` par défaut ou dérivée du nom (un nouveau compte a `villa_key = villa_<id>`).
- **Fonctions serveur** : `gmail-sync` boucle sur chaque boîte connectée (`email_connection.refresh_token`), erreurs isolées par compte (207) ; `push-notify` envoie chaque alerte au propriétaire de l'email, point du matin à 8 h 30 dans le fuseau de la villa (`tzFor` depuis le pays, UTC sinon ; cron `30 * * * *`) ; `price-intelligence` lit `events` avec le jeton du propriétaire.
- **Dates fortes partagées** : `events.owner_id` null + `country` ISO-2 (+ `city`), visibles via la policy `events_shared_read` / `events_shared_visible()`. Notes et `demand_impact` propres à une destination : ne jamais partager une ligne hors de sa destination.
- **Lieu** : météo = GPS des Réglages (`parseGpsLatLon`, Open-Meteo par lat/lon ; `q=` est ignoré par `weather-proxy`), Marrakech seulement pour une villa à Marrakech, sinon rien — jamais de météo inventée. Vols RAK, événements `marrakech_events`, suggestions de concurrents : `isMarrakechVilla()` (ville vide ≠ Marrakech, sauf le pilote).
- **Auth des fonctions** : la clé anon n'est pas un utilisateur (`isPublicKey`) ; utilisateur = `GET /auth/v1/user` avec son jeton (cache 5 min) ; limites par utilisateur. `transcribe` (Voxtral) et la vision d'`ai-proxy` exigent une session. Facturation : `is_entitled()` + policies restrictives `billing_gate` (INSERT/UPDATE) ; `billing_status()` renvoie aussi `comp` (accès offert) et `trial_expired`.
- **Site et légal** : liens Confidentialité / Conditions / Mentions légales sur chaque page ; avis légal sous chaque formulaire d'inscription ; la politique de confidentialité décrit ce que fait le code (la mettre à jour avec tout nouveau sous-traitant ou toute nouvelle lecture de données). Liens profonds : `app.html?signup=1` (onglet inscription), `app.html?open=gmail|settings|stay`.

