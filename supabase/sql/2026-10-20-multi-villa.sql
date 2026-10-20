-- ═══════════════════════════════════════════════════════════════════════════
-- Multi-villa v1 (20/10/2026) — une connexion, plusieurs maisons (conciergeries)
--
-- Principe : « une maison = un compte » ne change pas. Chaque maison garde son
-- identifiant (owner_id / user_id), ses lignes, sa synchro Gmail/iCal, ses liens.
-- On ajoute par-dessus : des membres (villa_members) et une « maison active »
-- choisie par l'Espace, envoyée dans l'en-tête HTTP x-stafflo-villa.
--
--   public.active_villa()    → la maison qu'on peut LIRE (soi, gestionnaire, lecteur)
--   public.active_villa_rw() → la maison qu'on peut MODIFIER (soi, gestionnaire)
--
-- Sans en-tête, les deux valent auth.uid() : un compte sans membres voit et
-- écrit exactement ce qu'il voyait avant (prouvé ligne à ligne, table par table,
-- pour chaque compte, avant l'application). En-tête vers une maison dont on
-- n'est pas membre → NULL → rien de visible, aucune écriture possible.
--
-- Rôles : 'manager' (la conciergerie, tout) · 'viewer' (le propriétaire invité,
-- lecture seule — jamais les jetons Gmail ni les liens iCal : villa_view()).
-- Une maison créée par une conciergerie est un compte « maison » (auth.users,
-- app_metadata.kind = 'villa', créé par la fonction villa-create) : personne ne
-- s'y connecte ; ses gestionnaires y accèdent par l'en-tête.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tables ─────────────────────────────────────────────────────────────
create table if not exists public.villa_members (
  villa_id   uuid not null references auth.users(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('manager', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (villa_id, user_id),
  check (villa_id <> user_id)
);
create index if not exists villa_members_user_idx on public.villa_members (user_id) where deleted_at is null;
comment on table public.villa_members is 'Multi-villa (20/10/2026) : qui accède à quelle maison. manager = tout, viewer = lecture. Écrit par les RPC villa_invite_accept / villa_member_remove et la fonction villa-create seulement.';

create table if not exists public.villa_invites (
  id          uuid primary key default gen_random_uuid(),
  villa_id    uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('manager', 'viewer')),
  label       text,
  token_hash  text not null unique,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  deleted_at  timestamptz
);
create index if not exists villa_invites_villa_idx on public.villa_invites (villa_id) where deleted_at is null;
comment on table public.villa_invites is 'Multi-villa : liens d''invitation (jeton montré une fois, empreinte sha256 seule en base, 14 jours).';

create table if not exists public.villa_quota (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  max_villas int not null default 0 check (max_villas between 0 and 200),
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.villa_quota is 'Multi-villa : nombre de maisons qu''un compte peut créer (ouvert par Stafflo, compte par compte). Sans ligne : aucune.';

alter table public.villa_members enable row level security;
alter table public.villa_invites enable row level security;
alter table public.villa_quota   enable row level security;
revoke insert, update, delete, truncate on public.villa_members, public.villa_invites, public.villa_quota from anon, authenticated;
revoke all on public.villa_members, public.villa_invites, public.villa_quota from anon;

-- ── 2. Maison active ──────────────────────────────────────────────────────
create or replace function public.villa_access(p_write boolean)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); h text; v uuid; r text;
begin
  if uid is null then return null; end if;
  h := nullif(current_setting('request.headers', true), '');
  if h is not null then
    begin h := nullif(btrim((h::json) ->> 'x-stafflo-villa'), '');
    exception when others then return null; end;
  end if;
  if h is null then return uid; end if;                       -- sans en-tête : son propre compte, comme avant
  if h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  v := h::uuid;
  if v = uid then return uid; end if;
  select m.role into r from public.villa_members m where m.villa_id = v and m.user_id = uid and m.deleted_at is null;
  if r is null then return null; end if;                       -- pas membre : rien
  if p_write and r <> 'manager' then return null; end if;      -- lecteur : pas d'écriture
  return v;
end $$;
create or replace function public.active_villa()    returns uuid language sql stable security definer set search_path = '' as $$ select public.villa_access(false) $$;
create or replace function public.active_villa_rw() returns uuid language sql stable security definer set search_path = '' as $$ select public.villa_access(true) $$;

create or replace function public.villa_role(p_villa uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null or p_villa is null then null
              when p_villa = auth.uid() then 'self'
              else (select m.role from public.villa_members m where m.villa_id = p_villa and m.user_id = auth.uid() and m.deleted_at is null) end
$$;

revoke all on function public.villa_access(boolean) from public;
grant execute on function public.villa_access(boolean), public.active_villa(), public.active_villa_rw(), public.villa_role(uuid) to anon, authenticated;

create policy villa_members_read on public.villa_members for select to authenticated
  using (user_id = (select auth.uid()) or villa_id = (select auth.uid()) or public.villa_role(villa_id) = 'manager');
create policy villa_invites_read on public.villa_invites for select to authenticated
  using (public.villa_role(villa_id) in ('self', 'manager'));
create policy villa_quota_read on public.villa_quota for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 3. Abonnement : la personne, ou la maison active ───────────────────────
create or replace function public.entitled_user(p uuid)
returns boolean language plpgsql stable security definer set search_path = 'public' as $$
begin
  if p is null then return false; end if;
  if exists (select 1 from billing_allowlist where user_id = p) then return true; end if;
  if exists (
    select 1 from subscriptions s
    where s.user_id = p and (
         s.status in ('active', 'past_due')
      or (s.status = 'trialing' and now() < coalesce(s.trial_ends_at, s.current_period_end, s.created_at + interval '14 days'))
      or (s.status = 'canceled' and s.current_period_end is not null and now() < s.current_period_end)
    )
  ) then return true; end if;
  -- essai de 14 jours : les personnes, jamais un compte « maison » créé par une conciergerie
  return exists (select 1 from auth.users where id = p and created_at > now() - interval '14 days' and coalesce(raw_app_meta_data ->> 'kind', '') <> 'villa');
end $$;
revoke all on function public.entitled_user(uuid) from public, anon, authenticated;

create or replace function public.is_entitled()
returns boolean language plpgsql stable security definer set search_path = 'public' as $$
declare uid uuid := auth.uid(); v uuid;
begin
  if uid is null then return false; end if;
  if public.entitled_user(uid) then return true; end if;
  -- gestionnaire d'une maison abonnée (le propriétaire paie, la conciergerie travaille)
  v := public.active_villa_rw();
  return v is not null and v <> uid and public.entitled_user(v);
end $$;

-- ── 4. Fonctions existantes : la maison active au lieu de auth.uid() ──────
create or replace function public.events_shared_visible(e_country text, e_city text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select e_country is not null and exists (
    select 1 from public.villa_settings v
    where v.owner_id = public.active_villa()
      and public.country_code(coalesce(v.country, '') || ' ' || coalesce(v.city, '')) = e_country
      and (e_city is null or position(lower(e_city) in lower(coalesce(v.city, ''))) > 0)
  )
$$;

create or replace function public.livret_token(p_client_id text)
returns text language plpgsql set search_path to '' as $$
declare v uuid := public.active_villa(); w uuid := public.active_villa_rw(); tok text;
begin
  if v is null or p_client_id is null or p_client_id = '' then return null; end if;
  if not exists (select 1 from public.crm_clients c where c.id = p_client_id and c.user_id = v and c.deleted_at is null) then
    return null;
  end if;
  select l.token into tok from public.livret_links l
    where l.owner_id = v and l.client_id = p_client_id and l.deleted_at is null limit 1;
  if tok is not null or w is null then return tok; end if;     -- lecteur : un lien existant, jamais un nouveau
  insert into public.livret_links (owner_id, client_id, token)
    values (w, p_client_id, rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='))
    on conflict (owner_id, client_id) where deleted_at is null do nothing;
  select l.token into tok from public.livret_links l
    where l.owner_id = w and l.client_id = p_client_id and l.deleted_at is null limit 1;
  return tok;
end;
$$;

create or replace function public.inbound_address()
returns text language plpgsql security definer set search_path to '' as $$
declare v uuid := public.active_villa(); w uuid := public.active_villa_rw(); t text;
begin
  if v is null then return null; end if;
  select token into t from public.inbound_addresses where owner_id = v;
  if t is null and w is not null then
    insert into public.inbound_addresses (owner_id, token)
      values (w, substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12))
      on conflict (owner_id) do nothing;
    select token into t from public.inbound_addresses where owner_id = w;
  end if;
  if t is null then return null; end if;
  return 'in-' || t || '@stafflo.app';
end $$;

-- ── 5. Défauts : une ligne créée va dans la maison active ─────────────────
alter table public.crm_clients  alter column user_id  set default public.active_villa_rw();
alter table public.stay_files   alter column owner_id set default public.active_villa_rw();
alter table public.staff_links  alter column owner_id set default public.active_villa_rw();
alter table public.livret_links alter column owner_id set default public.active_villa_rw();

-- ── 6. Règles d'accès (17 tables de l'Espace) ─────────────────────────────
-- crm_clients
drop policy "Own clients delete" on public.crm_clients;
create policy "Own clients delete" on public.crm_clients for delete to public using (user_id = (select public.active_villa_rw()));
drop policy "Own clients insert" on public.crm_clients;
create policy "Own clients insert" on public.crm_clients for insert to public with check (user_id = (select public.active_villa_rw()));
drop policy "Own clients read" on public.crm_clients;
create policy "Own clients read" on public.crm_clients for select to public using (user_id = (select public.active_villa()));
drop policy "Own clients write" on public.crm_clients;
create policy "Own clients write" on public.crm_clients for update to public using (user_id = (select public.active_villa_rw()));
drop policy own_data on public.crm_clients;
create policy own_data on public.crm_clients for all to public using (user_id = (select public.active_villa_rw())) with check (user_id = (select public.active_villa_rw()));
-- email_inbox
drop policy inbox_delete on public.email_inbox;
create policy inbox_delete on public.email_inbox for delete to public using (owner_id = (select public.active_villa_rw()));
drop policy inbox_insert on public.email_inbox;
create policy inbox_insert on public.email_inbox for insert to public with check (owner_id = (select public.active_villa_rw()));
drop policy inbox_select on public.email_inbox;
create policy inbox_select on public.email_inbox for select to public using (owner_id = (select public.active_villa()));
drop policy inbox_update on public.email_inbox;
create policy inbox_update on public.email_inbox for update to public using (owner_id = (select public.active_villa_rw()));
-- sync_runs
drop policy sync_runs_owner_read on public.sync_runs;
create policy sync_runs_owner_read on public.sync_runs for select to authenticated using (owner_id = (select public.active_villa()));
-- events (le catalogue partagé passe par events_shared_visible, ci-dessus)
drop policy events_owner_all on public.events;
create policy events_owner_all on public.events for all to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
create policy events_member_read on public.events for select to authenticated using (owner_id = (select public.active_villa()));
-- staff_links
drop policy staff_links_owner_insert on public.staff_links;
create policy staff_links_owner_insert on public.staff_links for insert to authenticated with check (owner_id = (select public.active_villa_rw()));
drop policy staff_links_owner_select on public.staff_links;
create policy staff_links_owner_select on public.staff_links for select to authenticated using (owner_id = (select public.active_villa()));
drop policy staff_links_owner_update on public.staff_links;
create policy staff_links_owner_update on public.staff_links for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- villa_settings : lecture directe réservée à soi et aux gestionnaires (jetons Gmail, liens iCal) ; le lecteur passe par villa_view()
drop policy villa_delete on public.villa_settings;
create policy villa_delete on public.villa_settings for delete to public using (owner_id = (select public.active_villa_rw()));
drop policy villa_insert on public.villa_settings;
create policy villa_insert on public.villa_settings for insert to public with check (owner_id = (select public.active_villa_rw()));
drop policy villa_select on public.villa_settings;
create policy villa_select on public.villa_settings for select to public using (owner_id = (select public.active_villa_rw()));
drop policy villa_update on public.villa_settings;
create policy villa_update on public.villa_settings for update to public using (owner_id = (select public.active_villa_rw()));
-- staff
drop policy "Owner full access on staff" on public.staff;
create policy "Owner full access on staff" on public.staff for all to public using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
create policy staff_member_read on public.staff for select to public using (owner_id = (select public.active_villa()));
-- livret_links
drop policy livret_links_owner_insert on public.livret_links;
create policy livret_links_owner_insert on public.livret_links for insert to authenticated with check (owner_id = (select public.active_villa_rw()));
drop policy livret_links_owner_select on public.livret_links;
create policy livret_links_owner_select on public.livret_links for select to authenticated using (owner_id = (select public.active_villa()));
drop policy livret_links_owner_update on public.livret_links;
create policy livret_links_owner_update on public.livret_links for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- staff_reports
drop policy staff_reports_owner_select on public.staff_reports;
create policy staff_reports_owner_select on public.staff_reports for select to authenticated using (owner_id = (select public.active_villa()));
drop policy staff_reports_owner_update on public.staff_reports;
create policy staff_reports_owner_update on public.staff_reports for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- guest_registrations (contenu chiffré, lu par la fonction guest-registrations, gestionnaires seulement)
drop policy guest_registrations_owner_read on public.guest_registrations;
create policy guest_registrations_owner_read on public.guest_registrations for select to authenticated using (owner_id = (select public.active_villa()));
-- wa_numbers, wa_messages
drop policy wa_numbers_select on public.wa_numbers;
create policy wa_numbers_select on public.wa_numbers for select to authenticated using (owner_id = (select public.active_villa()));
drop policy wa_messages_select on public.wa_messages;
create policy wa_messages_select on public.wa_messages for select to authenticated using (owner_id = (select public.active_villa()));
drop policy wa_messages_update on public.wa_messages;
create policy wa_messages_update on public.wa_messages for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- ical_events
drop policy ical_events_owner_read on public.ical_events;
create policy ical_events_owner_read on public.ical_events for select to authenticated using (owner_id = (select public.active_villa()));
drop policy ical_events_owner_hide on public.ical_events;
create policy ical_events_owner_hide on public.ical_events for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- staff_link_opens
drop policy staff_link_opens_owner_select on public.staff_link_opens;
create policy staff_link_opens_owner_select on public.staff_link_opens for select to authenticated using (owner_id = (select public.active_villa()));
-- stay_files
drop policy stay_files_insert on public.stay_files;
create policy stay_files_insert on public.stay_files for insert to authenticated with check (
  owner_id = (select public.active_villa_rw())
  and path like (((select public.active_villa_rw())::text || '/') || client_id) || '/%'
  and exists (select 1 from public.crm_clients c where c.id = stay_files.client_id and c.user_id = (select public.active_villa_rw())));
drop policy stay_files_select on public.stay_files;
create policy stay_files_select on public.stay_files for select to authenticated using (owner_id = (select public.active_villa()));
drop policy stay_files_update on public.stay_files;
create policy stay_files_update on public.stay_files for update to authenticated using (owner_id = (select public.active_villa_rw())) with check (owner_id = (select public.active_villa_rw()));
-- inbound_addresses, guest_notices
drop policy inbound_addresses_owner_read on public.inbound_addresses;
create policy inbound_addresses_owner_read on public.inbound_addresses for select to authenticated using (owner_id = (select public.active_villa()));
drop policy guest_notices_owner_read on public.guest_notices;
create policy guest_notices_owner_read on public.guest_notices for select to authenticated using (owner_id = (select public.active_villa()));

-- ── 7. Fichiers du décompte (bucket stay-files) : par dossier de maison ────
create or replace function public.storage_villa_ok(p_folder text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v uuid; r text;
begin
  if uid is null or p_folder is null or p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v := p_folder::uuid;
  if v = uid then r := 'self';
  else select m.role into r from public.villa_members m where m.villa_id = v and m.user_id = uid and m.deleted_at is null; end if;
  if r is null then return false; end if;
  if p_write then return r <> 'viewer' and (public.entitled_user(uid) or public.entitled_user(v)); end if;
  return true;
end $$;
grant execute on function public.storage_villa_ok(text, boolean) to authenticated;
drop policy stay_files_obj_read on storage.objects;
create policy stay_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'stay-files' and public.storage_villa_ok((storage.foldername(name))[1], false));
drop policy stay_files_obj_insert on storage.objects;
create policy stay_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stay-files' and public.storage_villa_ok((storage.foldername(name))[1], true));

-- ── 8. Correction trouvée au passage : maison_tournees ────────────────────
-- Ses deux « billing_gate » étaient PERMISSIVES (les autres tables : RESTRICTIVES) : un compte abonné
-- pouvait écrire ou modifier les tournées de n'importe quel compte. Remises en restrictives.
drop policy billing_gate_insert on public.maison_tournees;
create policy billing_gate_insert on public.maison_tournees as restrictive for insert to public with check (is_entitled());
drop policy billing_gate_update on public.maison_tournees;
create policy billing_gate_update on public.maison_tournees as restrictive for update to public using (is_entitled()) with check (is_entitled());

-- ── 9. RPC de l'Espace ────────────────────────────────────────────────────
-- Les maisons du compte, avec ce qui se passe aujourd'hui (date du jour donnée par l'appareil).
create or replace function public.my_villas(p_today date default null)
returns table (villa_id uuid, villa_name text, city text, country text, role text,
               arrivals int, departures int, in_house int, next_arrival text, msgs int, reports int)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); d text := to_char(coalesce(p_today, current_date), 'YYYY-MM-DD'); own_real boolean; has_m boolean;
begin
  if uid is null then return; end if;
  select exists (select 1 from public.villa_members m where m.user_id = uid and m.deleted_at is null) into has_m;
  -- sa propre maison n'est montrée à côté des autres que si elle existe vraiment (fiche, Gmail, iCal ou un séjour)
  select exists (select 1 from public.villa_settings vs where vs.owner_id = uid and (vs.house_facts is not null or (vs.email_connection ->> 'refresh_token') is not null or coalesce(jsonb_array_length(case when jsonb_typeof(vs.ical_feeds) = 'array' then vs.ical_feeds end), 0) > 0))
      or exists (select 1 from public.crm_clients c where c.user_id = uid and c.deleted_at is null) into own_real;
  return query
  with ids as (
    select uid as vid, 'self'::text as r where (not has_m) or own_real
    union all
    select m.villa_id, m.role from public.villa_members m where m.user_id = uid and m.deleted_at is null
  ), st as (
    select c.user_id as vid, left(c.arrival, 10) as a, left(c.departure, 10) as dd
    from public.crm_clients c
    where c.user_id in (select ids.vid from ids) and c.deleted_at is null
      and coalesce(c.booking_status, '') not in ('inquiry', 'lead', 'quoted', 'declined', 'cancelled', 'canceled')
      and c.arrival ~ '^\d{4}-\d{2}-\d{2}' and c.departure ~ '^\d{4}-\d{2}-\d{2}'
  )
  select i.vid, v.villa_name, v.city, v.country, i.r,
    (select count(*)::int from st where st.vid = i.vid and st.a = d),
    (select count(*)::int from st where st.vid = i.vid and st.dd = d),
    (select count(*)::int from st where st.vid = i.vid and st.a <= d and st.dd > d),
    (select min(st.a) from st where st.vid = i.vid and st.a > d),
    (select count(*)::int from public.email_inbox e where e.owner_id = i.vid and e.archived_at is null
       and e.received_at > now() - interval '48 hours' and e.from_email ilike '%airbnb.com'
       and (e.extracted -> 'airbnb' ->> 'type') in ('message', 'inquiry', 'request')),
    (select count(*)::int from public.staff_reports s where s.owner_id = i.vid and s.seen_at is null and s.deleted_at is null and s.created_at > now() - interval '7 days')
  from ids i
  left join lateral (select vs.villa_name, vs.city, vs.country from public.villa_settings vs where vs.owner_id = i.vid order by vs.created_at asc limit 1) v on true
  order by (i.r = 'self') desc, lower(coalesce(v.villa_name, ''));
end $$;

-- Toutes les maisons : les séjours fermes d'une période (au plus 62 jours), sans prix ni téléphone.
create or replace function public.portfolio_stays(p_from date, p_to date)
returns table (villa_id uuid, villa_name text, id text, name text, arrival text, departure text,
               guests int, adults int, children int, infants int, source text,
               arrival_time text, departure_time text, meals boolean, briefed boolean, orders boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); f text; t text;
begin
  if uid is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then return; end if;
  f := to_char(p_from, 'YYYY-MM-DD'); t := to_char(p_to, 'YYYY-MM-DD');
  return query
  with ids as (
    select uid as vid
    union
    select m.villa_id from public.villa_members m where m.user_id = uid and m.deleted_at is null
  )
  select c.user_id, (select vs.villa_name from public.villa_settings vs where vs.owner_id = c.user_id order by vs.created_at limit 1),
    c.id, c.name, left(c.arrival, 10), left(c.departure, 10), c.guests, c.adults, c.children, c.infants, c.source,
    nullif(left(c.details ->> 'arrival_time', 200), ''), nullif(left(c.details ->> 'departure_time', 200), ''),
    (coalesce(btrim(c.meals), '') <> '' or jsonb_exists(coalesce(c.details, '{}'::jsonb), 'guest_orders')),
    c.staff_briefed_at is not null,
    jsonb_exists(coalesce(c.details, '{}'::jsonb), 'guest_orders')
  from public.crm_clients c
  where c.user_id in (select ids.vid from ids) and c.deleted_at is null
    and coalesce(c.booking_status, '') not in ('inquiry', 'lead', 'quoted', 'declined', 'cancelled', 'canceled')
    and c.arrival ~ '^\d{4}-\d{2}-\d{2}' and c.departure ~ '^\d{4}-\d{2}-\d{2}'
    and left(c.arrival, 10) <= t and left(c.departure, 10) >= f
  order by left(c.arrival, 10), c.name
  limit 500;
end $$;

-- Réglages de la maison pour un lecteur : jamais les jetons Gmail ni les liens iCal.
create or replace function public.villa_view()
returns json language sql stable security definer set search_path = '' as $$
  select row_to_json(x) from (
    select vs.villa_name, vs.city, vs.country, vs.owner_name, vs.bedrooms, vs.max_guests, vs.house_facts_ref, vs.house_facts, vs.staff_members,
      vs.email_connection ->> 'email' as gmail, vs.email_connection ->> 'connected_at' as gmail_at, false as wa_connect_enabled,
      (select coalesce(json_agg(json_build_object('id', fe ->> 'id', 'label', fe ->> 'label')), '[]'::json)
         from jsonb_array_elements(case when jsonb_typeof(vs.ical_feeds) = 'array' then vs.ical_feeds else '[]'::jsonb end) fe) as ical_feeds
    from public.villa_settings vs where vs.owner_id = public.active_villa()
    order by vs.created_at asc limit 1) x
$$;

-- Accès à la maison active : membres et invitations en attente (soi et gestionnaires seulement).
create or replace function public.villa_access_list()
returns table (kind text, id text, user_id uuid, email text, role text, label text, created_at timestamptz, expires_at timestamptz, me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v uuid := public.active_villa_rw();
begin
  if uid is null or v is null then return; end if;
  return query
  select 'member'::text, m.user_id::text, m.user_id, u.email::text, m.role, null::text, m.created_at, null::timestamptz, m.user_id = uid
    from public.villa_members m join auth.users u on u.id = m.user_id
   where m.villa_id = v and m.deleted_at is null
  union all
  select 'invite'::text, i.id::text, null::uuid, null::text, i.role, i.label, i.created_at, i.expires_at, false
    from public.villa_invites i
   where i.villa_id = v and i.deleted_at is null and i.accepted_at is null and i.expires_at > now()
  order by 1 desc, 7 asc;
end $$;

create or replace function public.villa_invite_create(p_role text, p_label text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v uuid := public.active_villa_rw(); tok text; n int;
begin
  if uid is null or v is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('manager', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  select count(*) into n from public.villa_invites i where i.villa_id = v and i.created_at > now() - interval '1 day';
  if n >= 20 then raise exception 'rate_limited' using errcode = '54000'; end if;
  tok := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
  insert into public.villa_invites (villa_id, role, label, token_hash, created_by)
    values (v, p_role, left(nullif(btrim(coalesce(p_label, '')), ''), 80), encode(extensions.digest(tok, 'sha256'), 'hex'), uid);
  return tok;
end $$;

create or replace function public.villa_invite_accept(p_token text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); i public.villa_invites%rowtype; nm text;
begin
  if uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then return json_build_object('ok', false, 'error', 'invalid'); end if;
  select * into i from public.villa_invites where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and deleted_at is null for update;
  if not found then return json_build_object('ok', false, 'error', 'invalid'); end if;
  select vs.villa_name into nm from public.villa_settings vs where vs.owner_id = i.villa_id order by vs.created_at limit 1;
  if i.villa_id = uid then return json_build_object('ok', true, 'villa_id', i.villa_id, 'villa_name', nm, 'role', 'self'); end if;
  if i.accepted_at is not null then
    if i.accepted_by = uid then return json_build_object('ok', true, 'villa_id', i.villa_id, 'villa_name', nm, 'role', i.role); end if;
    return json_build_object('ok', false, 'error', 'used');
  end if;
  if i.expires_at < now() then return json_build_object('ok', false, 'error', 'expired'); end if;
  insert into public.villa_members as vm (villa_id, user_id, role, invited_by)
    values (i.villa_id, uid, i.role, i.created_by)
    on conflict (villa_id, user_id) do update
      set role = case when vm.deleted_at is null and vm.role = 'manager' then 'manager' else excluded.role end,
          deleted_at = null, invited_by = excluded.invited_by;
  update public.villa_invites set accepted_by = uid, accepted_at = now() where id = i.id;
  return json_build_object('ok', true, 'villa_id', i.villa_id, 'villa_name', nm, 'role', i.role);
end $$;

-- Retirer un membre (soi ou gestionnaire) ; un membre peut toujours se retirer lui-même.
create or replace function public.villa_member_remove(p_villa uuid, p_user uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r text := public.villa_role(p_villa); n int;
begin
  if uid is null or p_villa is null or p_user is null then return false; end if;
  if not (p_user = uid or r in ('self', 'manager')) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.villa_members set deleted_at = now() where villa_id = p_villa and user_id = p_user and deleted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.villa_invite_revoke(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null or p_id is null then return false; end if;
  update public.villa_invites i set deleted_at = now()
   where i.id = p_id and i.deleted_at is null and public.villa_role(i.villa_id) in ('self', 'manager');
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.my_villas(date), public.portfolio_stays(date, date), public.villa_view(), public.villa_access_list(),
  public.villa_invite_create(text, text), public.villa_invite_accept(text), public.villa_member_remove(uuid, uuid), public.villa_invite_revoke(uuid) from public, anon;
grant execute on function public.my_villas(date), public.portfolio_stays(date, date), public.villa_view(), public.villa_access_list(),
  public.villa_invite_create(text, text), public.villa_invite_accept(text), public.villa_member_remove(uuid, uuid), public.villa_invite_revoke(uuid) to authenticated;
