# Évals de non-régression — missing[] chips + gate facture fin de séjour

Écrites AVANT l'implémentation (fiche CC 2026-08-01, section 7). Rejouées manuellement
(trace de code) après chaque lot ; `Statut` mis à jour en conséquence. Aucune éval
n'a été éditée pour faire passer un échec.

Portée réelle (voir désaccords fiche/code notés en tête de commit) :
- Lot A/B branchés sur les 3 sites qui parsent déjà `parsed.missing` :
  `handleChatContextCommand`, `handleChatContextCommandWithText`,
  `handleInboxEmailFull` (override v6 actif, ligne ~37965).
- Lot C branché sur `window.STAFFLO_BILLING.compute()` (pas de `generateInvoice()`
  dans ce dépôt).

---

```
[REGRESSION — normalisation missing[] chaînes nues]
Entrée   : parsed.missing = ["Numéro de vol retour", "Allergies alimentaires"]
Attendu  : normalizeMissingItem("Numéro de vol retour") ===
           { item: "Numéro de vol retour", blocking: false, ask: "guest" }
           (idem pour "Allergies alimentaires")
Interdit : toute valeur blocking:true ou ask:"staff" non présente dans l'entrée —
           une chaîne nue est TOUJOURS blocking:false / ask:"guest" par défaut.
Statut   : PASS
```

```
[REGRESSION — normalisation missing[] objets enrichis]
Entrée   : parsed.missing = [
             { "item": "Montant des tickets de courses", "blocking": true, "ask": "staff" },
             { "item": "Numéro de vol retour" }   // objet incomplet, ask/blocking absents
           ]
Attendu  : item 1 → { item:"Montant des tickets de courses", blocking:true, ask:"staff" }
           item 2 → { item:"Numéro de vol retour", blocking:false, ask:"guest" }
           (repli sur les défauts quand blocking/ask absents d'un objet, sans lever)
Interdit : ask ∉ {"guest","staff"} ; blocking non-booléen propagé tel quel
Statut   : PASS
```

```
[REGRESSION — piège du préfixe : collision de clé avec 'arrival']
Entrée   : client_context existant = { client_id:"cl_x", category:"arrival",
             key:"heure_d_arrivee", value:"14h00", source:"chat" }
           Nouvelle réponse ARIA : missing = ["Heure d'arrivée"]
Attendu  : persistMissingItems écrit key = "missing:heure_d_arrivee" (préfixé),
           PAS "heure_d_arrivee". La ligne category="arrival" existante n'est ni
           lue ni modifiée par l'upsert (clé différente après préfixe).
Interdit : un upsert sur on_conflict=client_id,key qui cible "heure_d_arrivee" nu
           (écraserait silencieusement la ligne arrival — perte de donnée réelle)
Statut   : PASS
```

```
[REGRESSION — tiers : facture séjour ≥7 personnes (cas réel Sofia)]
Entrée   : sejours réel (id f2dcb305…) — nb_adults:7, nb_children:5 (12 guests),
           repas:{dejeuners:2, diners:2}. villa_settings.meal_categories réel —
           dejeuner.tiers = [{price:300,maxGuests:6},{price:400,minGuests:7}],
           diner.tiers = [{price:400,maxGuests:6},{price:550,minGuests:7}].
Attendu  : compute({stay:{group_size:12}, costs:{lunches:2, dinners:2}, ...})
           applique le palier ≥7 : dejeuner 400 MAD/unité (pas 300), diner 550
           MAD/unité (pas 400) → coût repas total = 2×400 + 2×550 = 1800 MAD
           (l'ancien code hardcodé PRICES.dejeuner=300/diner=400 aurait sorti
           2×300+2×400=1400 MAD — écart de 400 MAD, sous-facturation confirmée)
Interdit : palier 1 (≤6) appliqué à un groupe de 12 ; prix inventé hors tiers/
           defaultPrice de villa_settings.meal_categories
Statut   : PASS
```

```
[REGRESSION — grocery_invoices totalement absent du input]
Entrée   : compute({ stay:{group_size:12}, currency:'MAD',
             costs:{ dinners:2, lunches:2 } })   // costs.grocery_invoices absent
             (≠ costs.grocery_invoices:[] qui signifie "0 confirmé explicitement"
             via parseAmounts sur réponse "aucun/0" — cas déjà couvert, non régressé)
Attendu  : r.ok === false ; r.missing contient un item
           { item: L.miss_grocery, blocking:true, ask:"staff" } ;
           AUCUN montant de courses inclus dans costLines/totalCosts (ni 0 ni estimé)
Interdit : totalCosts qui inclut un 0 MAD silencieux pour les courses ; r.ok===true
           malgré l'absence de la donnée
Statut   : PASS
```

```
[REGRESSION — facture d'un séjour complet → PDF/message produit]
Entrée   : compute({ stay:{group_size:12, guest_first_name:'Sofia', stay_dates:'28/07–01/08'},
             currency:'MAD', costs:{ dinners:2, lunches:2, grocery_invoices:[],
             transport:[], extras:[] }, payments_received:[{montant_MAD:1800}] })
           — toutes les catégories répondues explicitement (grocery/transport/extras
           = [] veut dire "aucun", pas "non renseigné")
Attendu  : r.ok === true ; r.missing.filter(blocking) est vide ; buildMessage()
           produit un message rempli (pas de refus) ; aucun chip "manquant"
           résiduel à afficher côté UI puisque missing global est vide
Interdit : blocage sur une catégorie explicitement répondue à vide ([] ≠ absente)
Statut   : PASS
```

```
[REGRESSION — réponse ARIA sans missing[] → aucune écriture client_context]
Entrée   : parsed = { response:"...", action:"info", extracted:[] }  // pas de clé missing
Attendu  : persistMissingItems(clientId, parsed.missing, 'aria') retourne
           immédiatement (Array.isArray(undefined) === false) — zéro appel fetch
           vers /rest/v1/client_context
Interdit : tout appel réseau déclenché en l'absence de missing[]
Statut   : PASS
```

```
[REGRESSION — ?demo=1 sur les cas 1 (persistance) et 5 (gate facture)]
Entrée   : isDemoMode() === true (stafflo_demo_mode='1', posé par ?demo=1 au boot)
           + mêmes entrées que les cas 1 et 5 ci-dessus
Attendu  : cas 1 (persistMissingItems avec missing[] non vide) → return immédiat,
           zéro fetch Supabase. Cas 5 (compute() côté facture) → compute() est un
           calcul pur, aucune écriture Supabase dans ce Lot ; le gate/refus reste
           identique à la prod (comportement de calcul non gaté par demo, seule
           la PERSISTANCE l'est — cohérent avec "Lecture seule sur Supabase" du
           calcul lui-même, qui ne fait aucune écriture avant comme après ce commit)
Interdit : une écriture client_context depuis handleChatContextCommand/
           handleChatContextCommandWithText/handleInboxEmailFull en mode démo
Statut   : PASS
```
