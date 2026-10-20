-- Contrôles d'isolation du multi-villa — à lancer DANS LA MÊME transaction que la migration :
--   [bloc AVANT] ; [migration] ; [bloc APRÈS, qui finit par raise exception → tout est annulé].
-- Le bloc APRÈS compare, compte par compte et table par table, ce que chaque compte voit
-- avant et après (sans en-tête : rien ne doit changer), puis joue les cas membres.

-- ═══ AVANT ═══
do $b$
declare u record; j jsonb := '{}'; t text; n bigint; row jsonb;
begin
  for u in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', '{}', true);
    execute 'set local role authenticated';
    row := '{}';
    foreach t in array array['crm_clients','email_inbox','sync_runs','events','staff_links','villa_settings','staff','livret_links','staff_reports','guest_registrations','wa_numbers','wa_messages','ical_events','staff_link_opens','stay_files','inbound_addresses','guest_notices'] loop
      execute format('select count(*) from public.%I', t) into n;
      row := row || jsonb_build_object(t, n);
    end loop;
    execute 'reset role';
    j := j || jsonb_build_object(u.id::text, row);
  end loop;
  perform set_config('zz.before', j::text, true);
end $b$;

-- ═══ APRÈS ═══
do $a$
declare
  PILOT uuid := '0f25a319-8cbb-44ae-96e3-7befcda16c9b';
  u record; t text; n bigint; before jsonb; diffs jsonb := '[]'; res jsonb := '{}';
  M uuid; V uuid; W uuid; tok text; tok2 text; r jsonb; cid text; x text; k int;
  tabs text[] := array['crm_clients','email_inbox','sync_runs','events','staff_links','villa_settings','staff','livret_links','staff_reports','guest_registrations','wa_numbers','wa_messages','ical_events','staff_link_opens','stay_files','inbound_addresses','guest_notices'];
begin
  before := current_setting('zz.before', true)::jsonb;
  for u in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', '{}', true);
    execute 'set local role authenticated';
    foreach t in array tabs loop
      execute format('select count(*) from public.%I', t) into n;
      if (before -> u.id::text ->> t)::bigint is distinct from n then diffs := diffs || jsonb_build_object('user', left(u.id::text, 8), 'table', t, 'before', before -> u.id::text -> t, 'after', n); end if;
    end loop;
    execute 'reset role';
  end loop;
  res := res || jsonb_build_object('users', (select count(*) from auth.users), 'diffs', diffs);
  select id into M from auth.users where id <> PILOT order by created_at limit 1;
  select id into V from auth.users where id not in (PILOT, M) order by created_at limit 1;
  select id into W from auth.users where id not in (PILOT, M, V) order by created_at limit 1;
  insert into public.villa_members (villa_id, user_id, role) values (PILOT, M, 'manager'), (PILOT, V, 'viewer');
  -- gestionnaire, en-tête pilote
  perform set_config('request.jwt.claims', json_build_object('sub', M, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-stafflo-villa', PILOT::text)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.crm_clients; res := res || jsonb_build_object('mgr_stays', n);
  select count(*) into n from public.villa_settings; res := res || jsonb_build_object('mgr_settings', n);
  select count(*) into n from public.email_inbox; res := res || jsonb_build_object('mgr_inbox', n);
  res := res || jsonb_build_object('mgr_entitled', public.is_entitled(), 'mgr_active', public.active_villa() = PILOT, 'mgr_active_rw', public.active_villa_rw() = PILOT);
  select count(*) into n from public.my_villas(); res := res || jsonb_build_object('mgr_my_villas', n);
  select count(*) into n from public.portfolio_stays(current_date - 7, current_date + 30); res := res || jsonb_build_object('mgr_portfolio', n);
  select l.client_id, l.token into cid, tok from public.livret_links l where l.owner_id = PILOT and l.deleted_at is null limit 1;
  res := res || jsonb_build_object('mgr_livret_same', cid is not null and public.livret_token(cid) = tok);
  begin
    insert into public.crm_clients (id, name, arrival, departure, booking_status) values ('zz-test-mv', 'Test MV', '2030-01-01', '2030-01-03', 'confirmed') returning user_id into x;
    res := res || jsonb_build_object('mgr_insert_user', x = PILOT::text);
  exception when others then res := res || jsonb_build_object('mgr_insert_user', sqlstate || ' ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.headers', json_build_object('x-stafflo-villa', gen_random_uuid()::text)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.crm_clients; res := res || jsonb_build_object('mgr_random_stays', n);
  select count(*) into n from public.villa_settings; res := res || jsonb_build_object('mgr_random_settings', n);
  execute 'reset role';
  perform set_config('request.headers', json_build_object('x-stafflo-villa', V::text)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.crm_clients; res := res || jsonb_build_object('mgr_other_stays', n);
  execute 'reset role';
  -- lecteur, en-tête pilote
  perform set_config('request.jwt.claims', json_build_object('sub', V, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-stafflo-villa', PILOT::text)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.crm_clients; res := res || jsonb_build_object('viewer_stays', n);
  select count(*) into n from public.villa_settings; res := res || jsonb_build_object('viewer_settings_direct', n);
  res := res || jsonb_build_object('viewer_view', (public.villa_view() ->> 'villa_name') is not null, 'viewer_view_no_token', public.villa_view()::text not like '%refresh_token%', 'viewer_entitled', public.is_entitled());
  update public.crm_clients set notes = notes where id = 'zz-test-mv'; get diagnostics k = row_count; res := res || jsonb_build_object('viewer_update_rows', k);
  begin
    insert into public.crm_clients (id, name) values ('zz-test-mv2', 'x');
    res := res || jsonb_build_object('viewer_insert', 'ALLOWED');
  exception when others then res := res || jsonb_build_object('viewer_insert', sqlstate); end;
  begin
    perform public.villa_invite_create('viewer', 'x');
    res := res || jsonb_build_object('viewer_invite', 'ALLOWED');
  exception when others then res := res || jsonb_build_object('viewer_invite', sqlstate); end;
  execute 'reset role';
  -- invitation : le pilote crée un lien gestionnaire, V (lecteur) l'accepte → gestionnaire
  perform set_config('request.jwt.claims', json_build_object('sub', PILOT, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
  tok2 := public.villa_invite_create('manager', 'Conciergerie test');
  select count(*) into n from public.villa_access_list(); res := res || jsonb_build_object('pilot_access_list', n, 'pilot_my_villas', (select count(*) from public.my_villas()));
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', V, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.villa_invite_accept(tok2)::jsonb;
  res := res || jsonb_build_object('accept', r, 'accept_bad', public.villa_invite_accept('nope-nope-nope-nope-nope')::jsonb, 'accept_again', public.villa_invite_accept(tok2)::jsonb);
  execute 'reset role';
  select m.role into x from public.villa_members m where m.villa_id = PILOT and m.user_id = V;
  res := res || jsonb_build_object('v_role_after', x);
  if W is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', W, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', '{}', true);
    execute 'set local role authenticated';
    select count(*) into n from public.my_villas(); res := res || jsonb_build_object('solo_my_villas', n, 'solo_entitled', public.is_entitled());
    execute 'reset role';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', M, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
  res := res || jsonb_build_object('remove_by_mgr', public.villa_member_remove(PILOT, V));
  execute 'reset role';
  res := res || jsonb_build_object('tournees_restrictive', (select bool_and(permissive = 'RESTRICTIVE') from pg_policies where tablename = 'maison_tournees' and policyname like 'billing_gate%'));
  raise exception 'RES %', res::text;
end $a$;
