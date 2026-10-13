/* ═══════════════════════════════════════════════════════════════════════
   villa-facts.js — RETIRÉ le 13/10/2026. AUCUNE DONNÉE ICI.
   ═══════════════════════════════════════════════════════════════════════
   La fiche maison (équipe, repas, règles, wifi, adresse, QR WhatsApp) était
   servie ici, lisible par tous. Elle vit maintenant en base :
   villa_settings.house_facts (propriétaire seulement, RLS).
     · moteur public, sans données : house-facts.js
     · livret : fonction livret-view, avec le lien personnel du séjour
     · copie de référence, hors du site : _private/house-facts-pilot.json
       (la modifier puis la recopier en base : scripts/house-facts-sql.mjs)
   Le fichier reste, vide, pour les anciennes pages encore en cache qui le
   demandent : sans window.VILLA_FACTS, elles tournent sans fiche
   (villaFactsActive() = false), sans erreur.
   ═══════════════════════════════════════════════════════════════════════ */
