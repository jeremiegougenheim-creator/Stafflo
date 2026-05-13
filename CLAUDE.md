# CLAUDE.md — Manuel d'exécution Stafflo

> Lu automatiquement par Claude Code au démarrage de chaque session.
> Définit ce qu'est ce repo, comment l'éditer en sécurité, et les règles non-négociables.

## Contexte du repo

- **App** : single-file `app.html` (~13 000+ lignes), hébergé sur GitHub Pages
  - URL live : <https://jeremiegougenheim-creator.github.io/Stafflo/>
  - Repo path : `app.html` à la racine
- **Landing** : `index.html` (FR) + `en.html` (EN) dans le même repo
- **Backend** : Supabase project `rcjhgilpmojohmrqzokx` — Auth, Postgres + RLS multi-tenant, Edge Functions Deno, Realtime
- **Proxy AI** : Cloudflare Worker `stafflo-proxy.jeremiegougenheim.workers.dev`
- **LLM cascade** : Groq `llama-3.1-8b-instant` (primaire) → DeepSeek → Gemini → Mistral → OpenAI (fallback)
- **Voix (v1)** : Web Speech API pour l'input, ElevenLabs pour le TTS (prévu)
- **Icons** : Tabler Icons via webfont, centralisés via `iconFor()`
- **Typographie** : Cormorant Garamond (titres, voix ARIA) + Inter (UI)
- **Palette** : cream `#FAF6EE`, dark green `#0F2318`, mid green `#1D4D3A`, gold `#C9963A`, gold soft `#E5C77A`
- **Villa de test** : Villa DarJ Marrakech. Staff : Said (majordome), Faiza (chef), Bouchra (housekeeping).

---

## 1. Avant chaque session

La version live (`app.html` sur GitHub Pages) **diverge souvent** de la version du repo local. Avant toute édition :

1. `curl https://jeremiegougenheim-creator.github.io/Stafflo/app.html -o /tmp/app-live.html`
2. `diff /tmp/app-live.html app.html`
3. Si diff non vide → **STOP** et demander quoi faire (rebase live → local, ou ignorer)
4. `git status` doit être clean
5. Confirmer la branche : `feature/*` pour tout sauf hotfix critique

## 2. Pattern strangler fig pour le pivot ARIA-first v1

Le pivot ARIA-first est exécuté en **strangler fig**, PAS en rewrite. Non-négociable.

La nouvelle UI ARIA-first est construite **comme de nouveaux composants qui COEXISTENT avec le dashboard existant**, derrière un feature flag. Le code existant n'est ni modifié ni supprimé pendant la phase de build. Une fois la nouvelle UI prouvée stable en production (Villa DarJ + soft launch), l'ancien code est retiré progressivement.

### Règles que Claude Code DOIT suivre

1. **Ne jamais supprimer de code existant.** Wrap dans un conditionnel, ne pas retirer.
2. **Ne jamais modifier les composants existants.** Créer de nouveaux composants à côté.
3. **Toujours gater le nouveau code ARIA-first** derrière le feature flag `ARIA_FIRST_V1`.
4. **Lire le flag depuis `localStorage`** pour le toggler sans redéployer :
   `const ARIA_FIRST_V1 = localStorage.getItem('stafflo_aria_first_v1') === '1';`
   Activation alternative : `?aria_first=1` dans l'URL.
5. **Default à FALSE** jusqu'à ce que v1 soit feature-complete et testée. Le owner l'active manuellement sur son device.
6. **Les deux UI doivent fonctionner en parallèle.** Si ARIA-first plante, l'utilisateur toggle off et retombe sur le dashboard.
7. **Aucun cleanup de dead code pendant la phase de build.** Ça arrive plus tard, dans une session dédiée, UNIQUEMENT après que la nouvelle UI soit prouvée en production pendant au moins 14 jours.

### Pattern concret pour chaque nouveau composant ARIA-first

Au render :
```javascript
function renderTodayTab() {
  if (ARIA_FIRST_V1) {
    return renderAriaFirstTodayV1();  // nouveau composant
  }
  return renderClassicDashboard();    // existant, intact
}
```

Ou en HTML, par visibilité :
```html
<div id="dashboard-classic">
  <!-- 6 cards existantes, inchangées -->
</div>
<div id="aria-first-hero" style="display: none">
  <!-- nouveau orb + brief + cards contextuelles -->
</div>
```
JS toggle le `display` selon le flag à l'init de l'app.

### Quand Claude Code est tenté de « cleaner »

Si Claude Code propose de supprimer du vieux code dashboard, de refactoriser des fonctions partagées, ou de simplifier le data flow pendant la phase de build : **refuser poliment et demander que le changement soit scopé dans une session de cleanup post-v1 dédiée**.

Raison : tout « cleanup » pendant le build risque de régresser des features existantes (Inbox, Gmail OAuth, pricing logic, multi-villa) dont les utilisateurs du soft launch dépendent. Le but du strangler fig est précisément de ne jamais casser ce qui marche.

### Critères de sortie (quand retirer l'ancien code)

L'ancien dashboard ne peut être retiré que si TOUS ces critères sont vrais :
- `ARIA_FIRST_V1` activé sur tous les comptes de production depuis au moins 14 jours
- Zéro rollback déclenché pendant cette période
- DAU actif ≥ 80% du DAU pré-flag (pas de churn causé par la nouvelle UI)
- Voice input testé sur iOS Safari, Android Chrome, Safari desktop, Chrome desktop

Si un critère échoue, le flag reste et l'ancien code reste.

## 3. Pattern d'édition safe sur app.html (13k+ lignes)

- **Localiser** : `grep -n "pattern_unique" app.html`
- **Vérifier le contexte** : `view` avec range 20-40 lignes autour
- **`str_replace`** avec 3-5 lignes d'ancrage (sinon match ambigu)
- Pre-existing brace balance delta `-4` = baseline mesurée sur le live (JS-only, 13 blocs `<script>`). Pas un bug. Un delta plus négatif = quelque chose est cassé.

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
- Commissions par défaut : Airbnb 3.6%, Booking 15%, Direct 0%
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
- Fonts : Cormorant Garamond + Inter (landing), DM Sans + Fraunces (app ARIA)

## 8. Roadmap pivot ARIA-first v1 (composants à livrer)

Le dashboard actuel (tab Today, 6 cards fixes) est **strangulé** par un nouvel écran ARIA orb-centered. Construction ALONGSIDE, pas en remplacement.

Composants à livrer, tous gated par `ARIA_FIRST_V1` :

1. **`AriaHero`** : ARIA orb (animé, breathing), ligne de greeting, status indicator.
2. **`AriaBrief`** : brief auto-généré qui lit calendrier + Gmail + état villa, synthétise un brief 1-paragraphe et propose UNE action primaire (ex. « envoyer le brief WhatsApp staff »).
3. **`AriaCards`** : cards qui se matérialisent contextuellement quand ARIA répond ; la card brief est la première.
4. **`AriaVoiceButton`** (Web Speech API) — **LE COMPOSANT LE PLUS RISQUÉ, conversation review obligatoire avant** :
   - Pattern hold-to-talk, PAS toggle (évite les activations accidentelles)
   - Gate de support browser : détecter `webkitSpeechRecognition`, fallback vers text input only si absent
   - iOS Safari quirk : nécessite user gesture + secure context (https) — déjà satisfait sur GitHub Pages
   - Pendant l'enregistrement : afficher une animation waveform, status "ARIA écoute…"
   - Après l'enregistrement : transcrire, afficher le transcript, envoyer à l'orchestrateur ARIA
   - Langue : `fr-FR` par défaut, toggle `en-US` dans les settings
5. **Dashboard classique, Inbox, To-do, Settings restent inchangés.** Seul le rendering du tab Today est conditionnel sur le flag.

## 9. v1 explicitly out of scope

- **TTS** (ARIA qui répond vocalement) — v1.5
- **Monitoring proactif / agent** — v2
- **Streaming card materialization** — v1.5
- **Mode silencieux, multi-langues au-delà de FR/EN** — plus tard
- **Tout cleanup du code dashboard existant** — uniquement après que v1 soit prouvée en prod ≥14 jours

## 10. Success criteria v1

- Avec flag activé : user ouvre l'app → voit ARIA orb + brief + 1 action primaire (3 secondes, zéro clic)
- Avec flag activé : user peut tenir le voice button, parler, voir le transcript, recevoir une réponse ARIA avec une card
- Avec flag désactivé : dashboard classique fonctionne exactement comme avant, zéro régression
- Pas de régression sur Inbox, Settings, To-do staff, pricing logic, indépendamment de l'état du flag
- L'app passe toujours le check de validation JS après chaque changement significatif

## 11. Conventions techniques

- **ARIA orchestrator** : point d'entrée AI unique. Ne jamais écrire vers l'ancien `#chatMessages v1`. Tous les appels AI passent par le **proxy Cloudflare Worker only**, jamais d'appel direct provider depuis le client. Intent classification heuristique route vers : `reason`, `write_fr`, `extract`, `fast_classify`, `chat_fr`. Override manuel : préfixe `/deep`.
- **localStorage = source of truth runtime** : les settings vivent en localStorage pour une UI snappy. `villa_settings` Supabase = backup multi-device, synced au save. **Ne jamais assumer que Supabase a le dernier état pendant une session** — toujours lire localStorage en premier.
- **`isMarrakechVilla()`** : certaines features sont gated par ce check. Quand on bosse sur une feature qui doit être universelle, vérifier qu'elle n'est PAS dans ce gate.
- **Service Worker** : `sw.js` filtre les requêtes non-HTTP/API pour éviter les erreurs cache chrome-extension. Si on ajoute des ressources externes, vérifier qu'elles ne cassent pas le filtre. **Toujours bump `CACHE_NAME` après un déploiement** pour forcer le refresh sur les devices users.
- **`isFirmBooking()`** : filtre les leads (inquiry/lead/quoted) des surfaces opérationnelles (calendrier, brief, contexte ARIA, header stats). Tab Demandes utilise `isRequestStatus()` séparément. **iCal merge logic et dup detection on save ne sont PAS filtrés** — ils ont besoin de la donnée brute.
- **Onboarding** : 3-step wizard, synced Supabase. Ne pas toucher sauf si la tâche le demande explicitement.

## 12. Limitations connues à NE PAS toucher dans v1

- **Gmail OAuth** : Implicit flow → tokens expirent ~1h, daily reconnect nécessaire. Upgrade vers Authorization Code flow scopé pour un patch séparé, pas dans le pivot ARIA-first.
- **`deleted_at`** : pas encore d'historique soft-delete dans Supabase. Ne pas ajouter sans demande.
