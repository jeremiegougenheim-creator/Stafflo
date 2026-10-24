-- 24/10/2026 — staff-view v25 : ce que le prestataire a confirmé (« Repas confirmés ») : ses lignes de repas commandés et de menus,
-- {v: 1, o: [...], m: [...]}. Écrit par la fonction staff-view seulement (service role) ; lu par elle pour montrer ce qui a changé depuis.
alter table public.staff_reports add column if not exists snapshot jsonb;
