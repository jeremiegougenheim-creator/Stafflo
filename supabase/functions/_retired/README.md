# Fonctions retirées (13/10/2026, audit SaaS)

Sources telles qu'elles étaient déployées avant leur retrait. Chaque slug répond désormais
`410 Gone` (stub déployé, `verify_jwt` actif), sans rien lire ni écrire.

| Fonction | Pourquoi |
|---|---|
| `price-calibrate` | Aucune protection : réécrivait la grille de prix (`villa_settings`) de n'importe quel propriétaire passé dans le corps, et renvoyait ses moyennes de revenu. Jamais appelée. Valeurs de Marrakech en dur. |
| `google-token-refresh` | Doublon de `gmail-token-exchange`, CORS `*`, jamais appelée. Rafraîchissait n'importe quel jeton Google avec le secret client de Stafflo. |
| `hyper-function` | Fragment collé qui ne démarrait pas ; appelait Groq (hors UE). Jamais appelée. |
| `email-intake` | Ancienne ingestion d'emails (inactive depuis le 5 mai), propriétaire Dar J en dur. Remplacée par `gmail-sync`. |

Pour en rétablir une : la redéployer depuis ce fichier, après avoir corrigé la raison de son retrait.
