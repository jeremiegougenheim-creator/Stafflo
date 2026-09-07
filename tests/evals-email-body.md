# Évals de non-régression — corps d'email lisible (ARIA « Voir l'original » + prompt)

Écrites AVANT l'implémentation (session 2026-09-06). Rejouées en Node via
`node tests/evals-email-body.mjs` (extrait `window.StaffloEmailText` de app.html).
Aucune éval n'a été éditée pour faire passer un échec.

Diagnostic à l'origine du lot :
- Ingestion Gmail (`syncGmailDirect` l.~19159, force-pull l.~19552) : `atob()` sort
  des octets Latin-1 puis `.replace(/\s+/g,' ')` écrase les retours à la ligne ET
  remplace l'octet `\u00A0` (2e octet UTF-8 de « à » et de `&nbsp;`) par un espace.
  En base : « à » → `Ã `, `&nbsp;` → `Â `. `fixMojibake` transforme ensuite ces
  séquences invalides en `�`.
- `htmlToText` / `cleanEmailBoilerplate` / `cleanAirbnbGuestMessage` (l.~29856–30073)
  sont enfermés dans une IIFE, jamais exposés : les gardes `typeof x === 'function'`
  du patch v6 sont toujours fausses → email brut à l'écran et dans le prompt.

Portée : ingestion (2 sites), rendu « Voir l'original », texte envoyé au LLM v6.
Aucune écriture Supabase, aucune relecture des lignes déjà stockées : les lignes
legacy sont réparées à l'affichage uniquement.

---

```
[REGRESSION — décodage UTF-8 base64url]
Entrée   : decodeB64Url(base64url("Merci à bientôt — Jérémie ✓"), "utf-8")
Attendu  : "Merci à bientôt — Jérémie ✓" à l'identique
Interdit : Ã, Â, â, � — tout artefact d'octet Latin-1
Statut   : PASS
```

```
[REGRESSION — préheader nbsp/zwnj + footer légal (affichage)]
Entrée   : "Tell Esther's group what you loved.\n\nAirbnb Ireland UC 8 Hanover Quay Dublin 2, Ireland"
           + 30 × "\u00A0\u200C"
Attendu  : toReadable(...) === "Tell Esther's group what you loved."
Interdit : tout caractère invisible (U+200B–200D, 2060, FEFF, 00AD, 034F, FFFD) résiduel ;
           « Airbnb Ireland » résiduel
Statut   : PASS
```

```
[REGRESSION — HTML → blocs, préheader caché supprimé]
Entrée   : '<div style="display:none">PREHEADER &nbsp;&zwnj;&nbsp;</div>'
           + '<h2>How was Esther&#39;s stay?</h2><p>Tell Esther&#39;s group<br>what you loved.</p>'
Attendu  : htmlToTextBlocks(...) === "How was Esther's stay?\n\nTell Esther's group\nwhat you loved."
Interdit : "PREHEADER" ; balise résiduelle ; entité résiduelle (&#39; / &nbsp;)
Statut   : PASS
```

```
[REGRESSION — ligne legacy aplatie (cas réel Esther, stockée par l'ancienne ingestion)]
Entrée   : "HOW WAS ESTHER'S STAY? Tell Esther's group what you loved and what they can do better
            Esther's group has just checked out, so now is the perfect time to write your review.
            Write a review WHY REVIEWS ARE IMPORTANT Hosts count on each other to be upfront so
            they can feel confident hosting. Airbnb Ireland UC 8 Hanover Quay Dublin 2, Ireland
            Â Â Â Â Â Â "   (une seule ligne, sans \n — tel que stocké)
Attendu  : toReadable(...) commence par "HOW WAS ESTHER'S STAY?\n" ;
           contient "\n\nWHY REVIEWS ARE IMPORTANT\nHosts count" ;
           ne contient ni "Airbnb Ireland", ni "�", ni "Â"
Interdit : tout mot absent de l'entrée (la reflow n'insère QUE des sauts de ligne)
Statut   : PASS
```

```
[REGRESSION — « à » corrompu par l'ancienne ingestion]
Entrée   : "Merci Ã bientÃ´t Ã la villa, Ã 14h"
           (ce que l'ancienne ingestion a stocké pour "Merci à bientôt à la villa, à 14h")
Attendu  : toReadable(...) === "Merci à bientôt à la villa, à 14h"
Interdit : "�" ; "Ã" ; "à" collé au mot suivant ("àbientôt")
Statut   : PASS
```

```
[REGRESSION — texte pour LLM : les données de réservation restent]
Entrée   : email Airbnb nominal (retours à la ligne conservés) :
           "Massi Mekla\nParis, France\nCONFIRMATION CODE\nHMF8MQ49HW\nCheck-in\nCheckout\n
            Fri 15 May\nTue 19 May\nGUESTS\n2 adults, 1 child, 1 infant\nGUEST PAID\n2035.20 EUR\n
            GET READY FOR MASSI'S ARRIVAL\nProvide directions to your place"
Attendu  : toPromptText(...) contient "HMF8MQ49HW", "Fri 15 May", "Tue 19 May",
           "2 adults, 1 child, 1 infant", "2035.20 EUR" ;
           ne contient pas "Provide directions" (bloc GET READY FOR coupé par
           cleanEmailBoilerplate, comportement existant de l'ancien pipeline l.31033) ;
           après normalisation `\s+` → ' ', parseEmailSignals retrouve
           "Check-in Checkout Fri 15 May Tue 19 May" (le bloc dates n'est PAS coupé
           pour le LLM — cleanAirbnbGuestMessage est réservé à l'affichage).
Interdit : toute valeur absente de l'entrée
Statut   : PASS
```

```
[REGRESSION — montant absent]
Entrée   : même email sans le bloc "GUEST PAID\n2035.20 EUR"
Attendu  : toPromptText(...) ne contient ni "EUR" ni "2035" ni aucun nombre absent de l'entrée
           (les nettoyeurs ne font que retirer ; aucun chemin ne peut produire un montant)
Interdit : tout nombre absent de l'entrée
Statut   : PASS
```

```
[REGRESSION — texte pur sans HTML reste intact]
Entrée   : "Bonjour,\n\nNous arrivons à 14h.\n\nMerci"
Attendu  : toReadable(...) et toPromptText(...) === entrée à l'identique
Interdit : ajout/retrait de mot ; perte des paragraphes
Statut   : PASS
```

```
[REGRESSION — rendu HTML d'affichage]
Entrée   : "HOW WAS ESTHER'S STAY?\nTell <b>Esther's</b> group.\n\nWHY REVIEWS ARE IMPORTANT\nHosts count."
Attendu  : toDisplayHtml(...) === '<div class="seh-h">HOW WAS ESTHER&#39;S STAY?</div>'
           + '<p class="seh-p">Tell &lt;b&gt;Esther&#39;s&lt;/b&gt; group.</p>'
           + '<div class="seh-h">WHY REVIEWS ARE IMPORTANT</div>'
           + '<p class="seh-p">Hosts count.</p>'
           (échappement HTML systématique — le texte n'est jamais injecté brut)
Interdit : balise non échappée provenant du texte
Statut   : PASS
```
