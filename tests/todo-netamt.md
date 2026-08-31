# Sites non migrés vers netAmt()

Calcul brut `price*(1-commission%)` toujours en place (ignore `commMode`,
casse silencieusement si `commMode === 'fixed'` — voir recon du 2026-08-01).
Modèle de migration déjà fait : COMMIT Z3 (#v5Perf) et COMMIT W5 (renderV3VillaStats,
commit 15f8f53).

1. app.html:11441 — `renderResult` (fonction englobante déclarée ligne 11408)
2. app.html:16087 — `handleChatEmailAnalysis` (ligne 16038)
3. app.html:30257 — `renderExtractedCard` (ligne 30253)
4. app.html:33462 — `renderHero` (ligne 33435)
5. app.html:33605 — `renderGrid` (ligne 33571)
6. app.html:34121 — `renderStay` (ligne 34108)
7. app.html:38025 — `window.handleInboxEmailFull` v6 (réassignation ligne 37965)
