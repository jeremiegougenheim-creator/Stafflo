# Stafflo — Brief pour Claude

## Contexte produit
SaaS PWA de gestion d'opérations pour villas de luxe avec staff (chef, butler, housekeeper).
- **Single dev** : Jérémie (Jérémie Gougenheim)
- **Villa de test / référence** : Villa DarJ, Marrakech
- **Cible soft launch** : 5–10 utilisateurs (Superhosts villa, opérateurs boutique)
- **Repo** : `~/Stafflo` (live sur GitHub Pages, voir URLs plus bas)

## Stack
- **Frontend** : single-file `app.html` (~24k lignes — 1.3 MB) en vanilla JS, pas de bundler, pas de framework. Pages adjacentes : `index.html` (landing FR, ~23k lignes), `en.html` (landing EN, marketing), `login.html`.
- **Icônes** : Tabler Icons (CDN webfont)
- **Fonts** : Cormorant Garamond + Inter (palette luxury) ; en pratique `app.html` charge aussi Fraunces (logos/titres) et DM Sans (body) — 4 familles cohabitent.
- **Backend / Auth / DB** : Supabase
  - Project ID : `rcjhgilpmojohmrqzokx`
  - URL : `https://rcjhgilpmojohmrqzokx.supabase.co`
  - Auth + RLS multi-tenant (gating par villa)
  - Edge Functions Deno (notamment `ai-proxy` pour appels LLM)
- **Proxy AI** : Supabase Edge Function `functions/v1/ai-proxy` (constante `STAFFLO_PROXY` dans `app.html`).
- **Cloudflare Worker proxy** : `stafflo-proxy.jeremiegougenheim.workers.dev` — non référencé dans `app.html` au moment de l'écriture (probablement déployé séparément ou usage hors app principale, à confirmer).
- **Hosting** : GitHub Pages
- **Service Worker** : `sw.js` (cache `stafflo-v4`, bypass pour supabase/groq/mistral/deepseek/openai/googleapis)
- **PWA** : `manifest.json`, installable mobile

## URLs
- **Live app** : https://jeremiegougenheim-creator.github.io/Stafflo/app.html
- **Landing FR** : https://jeremiegougenheim-creator.github.io/Stafflo/index.html
- **Landing EN** : https://jeremiegougenheim-creator.github.io/Stafflo/en.html

## AI cascade
**Ordre brief** : Groq (llama-3.1-8b-instant) → DeepSeek → Gemini → Mistral → OpenAI.
**Code actuel** : `cfgAiProvider` default = `'gemini'` ; clés gérées : `geminiKey`, `groqKey`, `mistralKey`, `deepseekKey`, `openaiKey`, `anthropicKey`. Sélection via helper `callBestAI(task, system, user, maxTokens)` selon le type de tâche (`'extract'`, `'brief'`, `'reason'`, `'write_fr'`).
> Vérifier l'ordre exact de fallback dans `callBestAI` avant tout changement.

## Palette luxury
Deux jeux de variables coexistent dans `app.html` :

**Vars principales (`:root`, ligne ~24)** — utilisées partout :
- `--ink:#1A1208` (texte)
- `--paper:#FBF7F0` (fond)
- `--green:#1B4332`, `--green2:#2A5240`, `--green3:#0F2318`
- `--gold:#C9963A`, `--gold-light:#FEF3DC`
- `--border:#E8E2D8`, `--muted:#8A8070`, `--red:#C0392B`

**Vars ARIA (ligne ~869)** — palette brand "luxury" du brief :
- `--cream: #FAF6EE`
- `--green-dark: #0F2318`
- `--green-mid: #1d4d3a`
- `--gold: #C9963A`

> Le brief décrit la palette ARIA. Quand on touche au visuel global, prendre les vars `:root`. Quand on touche au composant ARIA / brand surfaces, utiliser les vars `--cream/--green-mid/...`.

## Typographie
- **Headlines / brand** : Cormorant Garamond, Fraunces
- **Body** : Inter, DM Sans

## Bilingue FR/EN
- `<html lang="fr">` par défaut dans `app.html`
- Pattern : attributs `data-fr="..." data-en="..."` sur les éléments à traduire
- Helper `isMarrakechVilla()` (ligne ~13468, exposé sur `window`) pour gating villa-spécifique
- Landing pages séparées : `index.html` (FR) et `en.html` (EN), liées via `hreflang`

## Philosophie de travail
- **Ship > polish** — viser le soft launch, pas la perfection
- **Pas de fake data** — données réelles ou rien
- **Token efficiency max** — pas de surchage, pas de redondance
- **Communication directe** — pushback bienvenu sur over-engineering
- **Pas de surface inutile** — bug fix = bug fix, pas de refacto autour

## Edit pattern (fichier ~24k lignes)
1. **Localiser** : `grep -n "<pattern>" app.html`
2. **Contexte** : `Read` 20–40 lignes autour
3. **Modifier** : `Edit` avec 3–5 lignes d'ancrage uniques avant/après le changement
4. **Jamais** ouvrir `app.html` en entier sans offset (1.3 MB)

### Brace delta de référence
- **Brief** : `-1` (baseline acceptée, pas un bug)
- **Mesuré** : `opens=5758, closes=5762, delta=-4`
- → Soit 3 nouveaux faux positifs apparus depuis le brief (commentaires, regex, strings contenant `}`), soit régression réelle. **À investiguer si on touche aux blocs JS**, mais ne pas paniquer sur `-4` : valider avec `node --check` (cf. ci-dessous).

### Validation JS
```bash
# extraire tous les <script> en un fichier puis valider
python3 -c "
import re; src=open('app.html').read()
js='\n;\n'.join(re.findall(r'<script[^>]*>(.*?)</script>', src, re.S))
open('/tmp/all_js.js','w').write(js)
"
node --check /tmp/all_js.js
```

## State management
- **Runtime** : `localStorage`
- **Backup multi-device** : Supabase table `villa_settings`
- Sync indicator : `.sync-dot` dans le header (`ok` / `busy` / `err`)

## Workflow Claude — règles
- Toujours `grep -n` avant `Read`. Lire le minimum nécessaire (offset/limit).
- Avant un `Edit` non-trivial : lire les 20–40 lignes autour pour vérifier l'ancrage.
- Après un `Edit` qui touche du JS : valider avec `node --check` (script ci-dessus).
- Travailler en français par défaut (langue du dev). Code/identifiers restent en anglais.
- Communication concise. Pas de récap si le diff parle.
- Pushback explicite si on me demande un truc qui me semble over-engineered ou qui casse "ship > polish".

## Reality check vs brief (à jour 2026-05-11)
Notes pour mémoire — différences entre le brief écrit et le code cloné aujourd'hui :
- `app.html` fait **~24k lignes**, pas 13k → fichier a doublé depuis le brief.
- Brace delta réel = `-4`, pas `-1`.
- Provider AI par défaut dans `cfgAiProvider` = `'gemini'`, pas Groq.
- Cloudflare Worker URL non référencée dans `app.html` — Supabase Edge Function utilisée à la place pour le proxy AI.
- 4 familles de fonts chargées (pas 2) : Cormorant Garamond + Inter + Fraunces + DM Sans.

Ces écarts ne sont pas forcément des bugs — c'est juste que le brief a vieilli. À reconfirmer avec Jérémie au besoin.
