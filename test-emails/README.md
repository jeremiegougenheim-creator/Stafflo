# Stafflo — Email Extraction Test Suite

Suite de fils d'emails canoniques pour valider l'extraction de Stafflo après chaque modif du prompt système.

## Usage

1. Ouvre Stafflo (mode authentifié ou demo)
2. Pour chaque fichier `*.txt` :
   - Copie le contenu intégral du fichier
   - Colle dans le champ "Paste email/message" du dashboard
   - Clique sur "Analyze"
3. Compare la fiche client générée avec la section **EXPECTED OUTPUT** dans chaque fichier
4. Note chaque ✓ ou ✗ dans le tableau de scoring

## Fichiers

| # | Fichier | Complexité | Bug ciblé |
|---|---------|------------|-----------|
| 01 | `airbnb-simple.txt` | ⭐ Facile | Baseline — résa Airbnb FR standard |
| 02 | `booking-business.txt` | ⭐⭐ Moyen | Résa Booking.com EN, séjour business |
| 03 | `whatsapp-inquiry.txt` | ⭐⭐ Moyen | Inquiry WhatsApp pas encore confirmée |
| 04 | `silan-multidevise-multiroom.txt` | ⭐⭐⭐⭐ Difficile | Multi-devises (THB), multi-rooms, multi-offres, booker≠traveler |
| 05 | `direct-allergies-bebe.txt` | ⭐⭐⭐ Moyen+ | Demandes safety répétées (allergies + bébé) |
| 06 | `multi-personnes-confusion.txt` | ⭐⭐⭐ Moyen+ | 3 personnes dans le fil, qui est le booker ? |

## Scoring template

Copie ce template à chaque session de test :

```
DATE : YYYY-MM-DD
COMMIT : abc1234
PROMPT VERSION : v?

01 airbnb-simple              [_/8]
02 booking-business           [_/9]
03 whatsapp-inquiry           [_/7]
04 silan-multidevise-multiroom [_/12]
05 direct-allergies-bebe      [_/9]
06 multi-personnes-confusion  [_/8]

TOTAL                         [_/53]
```

Objectif : maintenir ≥ 90% (47/53) avant de toucher au prompt système.
Si un test régresse après une modif → rollback ou ajuste.

## Règle d'or

**Ne jamais modifier le prompt système sans avoir fait passer cette suite avant ET après.**
Sinon tu régresses en silence et tu t'en aperçois en prod via un user mécontent.
