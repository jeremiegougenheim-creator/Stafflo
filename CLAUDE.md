# CLAUDE.md — Stafflo / ARIA

This file is read automatically by Claude Code at the start of every session. It tells Claude what this codebase is, how it's organized, and what conventions to follow.

## What this project is

Stafflo is a SaaS PWA for luxury villa operations management. The product is being repositioned around **ARIA**, an AI agent that becomes the primary interface (not a feature). Tagline: *"From a SaaS for luxury villas to an AI manager every villa hires."*

Test villa: Villa DarJ in Marrakech. On-site staff: Said (majordome), Faiza (chef), Bouchra (housekeeping).

## Stack at a glance

- **App**: single-file `app.html` (~13 000+ lines) deployed on GitHub Pages
  - Live URL: `https://jeremiegougenheim-creator.github.io/Stafflo/app.html`
  - Repo path: `app.html` at root
- **Landing**: `index.html` (FR) + `en.html` (EN), GitHub Pages
- **Backend**: Supabase project `rcjhgilpmojohmrqzokx` — Auth, Postgres + RLS multi-tenant, Edge Functions (Deno), JSONB storage, Realtime
- **AI proxy**: Cloudflare Worker at `stafflo-proxy.jeremiegougenheim.workers.dev`
- **LLM cascade**: Groq `llama-3.1-8b-instant` (primary) → DeepSeek → Gemini → Mistral → OpenAI (fallback)
- **Voice (v1)**: Web Speech API for input, ElevenLabs for TTS (planned)
- **Icons**: Tabler Icons via webfont, mapped centrally through `iconFor()`
- **Typography**: Cormorant Garamond (serif, ARIA voice & titles) + Inter (sans, UI)
- **Palette**: cream `#FAF6EE`, dark green `#0F2318`, mid green `#1D4D3A`, gold `#C9963A`, gold soft `#E5C77A`

## Working directory & files

- Working file (Claude Code edits here): `app.html` at repo root
- Backup before any session: `curl -o /tmp/app.live.html https://jeremiegougenheim-creator.github.io/Stafflo/app.html`
- **The live version often diverges from local.** Always pull the live one before starting work.

---

## CRITICAL — Strangler fig pattern for ARIA-first refactor

The ARIA-first pivot is being executed as a **strangler fig refactor**, NOT a rewrite. This is non-negotiable.

### What this means concretely

The new ARIA-first UI is built **as new components that COEXIST with the existing dashboard**, gated by a feature flag. Existing code is NOT modified or deleted during the build phase. Once the new UI is proven stable in production with real users (Villa DarJ + soft launch), the old code is then progressively removed.

### Rules Claude Code MUST follow

1. **Never delete existing code.** Wrap it in a conditional, never remove it.
2. **Never modify existing components.** Create new components alongside them.
3. **Always gate new ARIA-first code behind the feature flag** `ARIA_FIRST_V1`.
4. **Read the flag from `localStorage`** so it can be toggled without redeploying:
   `const ARIA_FIRST_V1 = localStorage.getItem('flag_aria_first_v1') === '1';`
5. **Default to FALSE** until the v1 is feature-complete and tested. Owner enables it manually on their device.
6. **Both UIs must work in parallel.** If something breaks in ARIA-first, the user can toggle off and fall back to dashboard.
7. **No dead code cleanup during the build phase.** That happens later, in a dedicated cleanup session, only AFTER the new UI is proven in production for at least 2 weeks.

### Concrete pattern for every new ARIA-first component

At render time:
```javascript
function renderTodayTab() {
  if (ARIA_FIRST_V1) {
    return renderAriaFirstTodayV1();  // new component
  }
  return renderClassicDashboard();    // existing, untouched
}
```

Or in HTML, by visibility:
```html
<div id="dashboard-classic">
  <!-- existing 6 cards, unchanged -->
</div>
<div id="aria-first-hero" style="display: none">
  <!-- new orb + brief + contextual cards -->
</div>
```
With JS toggling display based on the flag at app init.

### When Claude Code is tempted to "clean up"

If Claude Code suggests deleting old dashboard code, refactoring shared functions, or simplifying the data flow during the build phase: **refuse politely and ask for the change to be scoped as a separate post-v1 cleanup session**.

The reason: any "cleanup" during the build risks regressions on existing features (Inbox, Gmail OAuth, pricing logic, multi-villa) that the soft-launch users depend on. The strangler fig pattern's whole point is to never break what works.

### Exit criteria (when to remove the old code)

The classic dashboard code can be removed only when ALL of these are true:
- `ARIA_FIRST_V1` enabled on all production accounts for at least 14 days
- Zero rollbacks needed during that period
- Active DAU greater than or equal to 80% of pre-flag DAU (no churn caused by the new UI)
- Voice input has been tested on iOS Safari, Android Chrome, desktop Safari, desktop Chrome

If any criterion fails, the flag stays and the old code stays.

---

## Conventions Claude Code must follow

### 1. Safe editing pattern for large single-file HTML

`app.html` is around 13 000 lines. Never rewrite chunks. Always:

- `grep -n "<keyword>" app.html` to locate
- view 20 to 40 lines to confirm context
- `str_replace` with 3 to 5 lines of anchor around the change

Anchors shorter than 3 lines cause ambiguous matches. Anchors longer than 5 are slow and break on whitespace.

### 2. Validation after every meaningful edit

Extract the JS from app.html and check it parses:

```bash
python3 -c "
import re
with open('app.html') as f: c = f.read()
blocks = re.findall(r'<script>(.*?)</script>', c, re.DOTALL)
open('/tmp/all_js.js','w').write('\n'.join(blocks))
"
node --check /tmp/all_js.js
```

A pre-existing brace-balance delta of -1 is a known baseline, not a bug. Bigger imbalance means something is broken.

### 3. localStorage is the runtime source of truth

Settings live in `localStorage` for snappy UI. `villa_settings` in Supabase is multi-device backup, synced on save. Never assume Supabase has the latest state during a session — always read from `localStorage` first.

### 4. ARIA orchestrator rules

- ARIA is the single AI entry point. Never write to legacy `#chatMessages` v1.
- All AI calls go through the Cloudflare Worker proxy. Never call provider APIs directly from the client.
- Heuristic intent classification routes to task endpoints: `reason`, `write_fr`, `extract`, `fast_classify`, `chat_fr`. Manual override prefix: `/deep`.
- System prompt must NEVER say "à vérifier dans le système" — propose a concrete action when data is missing, mark missing fields explicitly with `?`.

### 5. Pricing & business defaults

- Platform commissions: Airbnb 3.6%, Booking.com 15%, Direct 0%
- Distinguish guest-paid price vs host payout in every UI
- `cfg.minPrice` / `cfg.maxPrice` are floor and cap, ARIA must respect them
- Pricing tiers: Tier A €69/€179/€399 (émergent), Tier B €99/€249/€499 (mid-luxe, default for Marrakech), Tier C €149/€399/€799 (premium)

### 6. UX vocabulary

- Use "signal" not "paste/collez"
- Direct, informal French with mixed English technical terms
- Never use emoji; use Tabler outline icons

### 7. Marrakech-specific features

Some features are gated by `isMarrakechVilla()`. When working on a feature that should be universal, make sure it's NOT inside that gate.

### 8. Service Worker

`sw.js` filters non-HTTP/API requests to prevent chrome-extension cache errors. If you add new external resources, make sure they don't break the SW filter. After deploying new versions, always bump `CACHE_NAME` to force-refresh on users' devices.

### 9. Onboarding

3-step wizard, synced to Supabase. Don't touch unless the task explicitly requires it.

### 10. Booking filtering (recent baseline)

`isFirmBooking()` filters out leads (inquiry/lead/quoted) from operational surfaces (calendar, brief, ARIA context, header stats). Tab Demandes uses `isRequestStatus()` separately. iCal merge logic and dup detection on save are NOT filtered — they need raw data.

## Known limitations to NOT try to fix unless asked

- Gmail OAuth uses Implicit flow → tokens expire after ~1h, daily reconnect needed. Authorization Code flow upgrade is scoped for a later patch.
- No `deleted_at` soft-delete history yet in Supabase. Don't add unless requested.

---

## Current mission: ARIA-first UI pivot v1 (strangler fig)

The dashboard (current tab Today with 6 fixed cards) is being **strangled** by a new ARIA orb-centered screen. The new screen is built ALONGSIDE, not replacing.

### v1 scope (what to ship as new components, gated by ARIA_FIRST_V1)

1. **New component `AriaHero`**: ARIA orb (animated, breathing), greeting line, status indicator.
2. **New component `AriaBrief`**: auto-generated brief reading calendar + Gmail + villa state, synthesizes a 1-paragraph brief, proposes ONE primary action (e.g. "envoyer le brief WhatsApp staff").
3. **New component `AriaCards`**: cards materialize contextually as ARIA responds; brief card is the first.
4. **New component `AriaVoiceButton`** (Web Speech API):
   - Hold-to-talk pattern, NOT toggle (avoids accidental activation)
   - Browser support gate: detect `webkitSpeechRecognition`, fall back to text input only if missing
   - iOS Safari quirk: needs user gesture + secure context (https) — already satisfied on GitHub Pages
   - During recording: show waveform animation, status "ARIA écoute..."
   - After recording: transcribe, show transcript, send to ARIA orchestrator
   - Language: `fr-FR` by default, `en-US` toggle in settings
5. **The classic dashboard, Inbox, To-do, Settings tabs remain unchanged.** Only the rendering of tab Today is conditional on the flag.

### v1 explicitly out of scope

- TTS (ARIA speaking back) — comes in v1.5
- Proactive monitoring / agent — comes in v2
- Streaming card materialization — comes in v1.5
- Mode silencieux, multi-langues beyond FR/EN — comes later
- Any cleanup of existing dashboard code — comes only after v1 is proven for ≥14 days

### Success criteria for v1

- With flag enabled: user opens app → sees ARIA orb + brief + 1 primary action (3 seconds, no clicks)
- With flag enabled: user can hold the voice button, speak, see transcript, get an ARIA response with a card
- With flag disabled: classic dashboard works exactly as before, zero regression
- No regression on Inbox, Settings, To-do staff, pricing logic regardless of flag state
- App still passes the JS validation check after every meaningful change
