-- 24/10/2026 — Le lien personnel de l'équipe dans chaque brief.
-- Avant : seule l'empreinte du lien était gardée (staff_links.token_hash) ; le brief ne pouvait que rappeler « votre lien
-- Stafflo », que Saïd n'ouvrait pas (une ouverture en 4 jours). Désormais le lien est gardé CHIFFRÉ (pgcrypto, clé Vault
-- « staff_link_key »), dans une table à part que personne ne lit directement : seules deux fonctions y accèdent, pour le
-- propriétaire connecté et ses liens actifs. Sans la clé Vault, rien n'est gardé et le brief garde l'ancienne ligne.
-- Les liens créés avant restent sans copie (leur jeton n'a jamais été stocké) : il faut un nouveau lien pour l'avoir.

create table if not exists public.staff_link_secrets (
  link_id    uuid primary key references public.staff_links(id) on delete cascade,
  owner_id   uuid not null,
  enc        bytea not null,
  created_at timestamptz not null default now()
);
alter table public.staff_link_secrets enable row level security;            -- aucune policy : aucun accès direct
revoke all on public.staff_link_secrets from anon, authenticated, public;

-- Garde le lien chiffré, seulement s'il correspond à l'empreinte d'un lien actif du propriétaire connecté.
create or replace function public.staff_link_keep(p_link uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare uid uuid := auth.uid(); k text;
begin
  if uid is null or p_link is null or p_token is null or length(p_token) < 32 or length(p_token) > 128 then return false; end if;
  if not exists (
    select 1 from public.staff_links l
     where l.id = p_link and l.owner_id = uid and l.deleted_at is null
       and l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then return false; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'staff_link_key';
  if k is null then return false; end if;
  insert into public.staff_link_secrets (link_id, owner_id, enc)
    values (p_link, uid, extensions.pgp_sym_encrypt(p_token, k, 'cipher-algo=aes256'))
    on conflict (link_id) do update set enc = excluded.enc, created_at = now();
  return true;
end $$;

-- Les liens gardés du propriétaire connecté (actifs seulement).
create or replace function public.staff_link_urls()
returns table (link_id uuid, token text)
language plpgsql
security definer
set search_path to ''
as $$
declare uid uuid := auth.uid(); k text;
begin
  if uid is null then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'staff_link_key';
  if k is null then return; end if;
  return query
    select s.link_id, extensions.pgp_sym_decrypt(s.enc, k)
      from public.staff_link_secrets s
      join public.staff_links l on l.id = s.link_id
     where s.owner_id = uid and l.owner_id = uid and l.deleted_at is null;
end $$;

revoke all on function public.staff_link_keep(uuid, text) from public, anon;
revoke all on function public.staff_link_urls() from public, anon;
grant execute on function public.staff_link_keep(uuid, text) to authenticated;
grant execute on function public.staff_link_urls() to authenticated;

-- Lien retiré (« Retirer » = deleted_at) : sa copie chiffrée est effacée.
create or replace function public.staff_link_secret_drop()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.staff_link_secrets where link_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.staff_link_secret_drop() from public, anon, authenticated;
drop trigger if exists staff_link_secret_drop on public.staff_links;
create trigger staff_link_secret_drop after update of deleted_at on public.staff_links
  for each row execute function public.staff_link_secret_drop();

-- Clé : à créer une fois (SQL editor de Supabase), jamais écrite dans ce fichier :
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'staff_link_key');
