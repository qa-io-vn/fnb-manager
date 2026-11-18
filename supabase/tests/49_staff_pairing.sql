begin;
select plan(125);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004901'::uuid as tenant_p,
  'dddddddd-dddd-4ddd-8ddd-000000004902'::uuid as tenant_o,
  'eeeeeeee-eeee-4eee-8eee-000000004901'::uuid as owner_p,
  'eeeeeeee-eeee-4eee-8eee-000000004902'::uuid as owner_p1,
  'eeeeeeee-eeee-4eee-8eee-000000004903'::uuid as manager_p1,
  'eeeeeeee-eeee-4eee-8eee-000000004904'::uuid as manager_all,
  'eeeeeeee-eeee-4eee-8eee-000000004905'::uuid as member_s,
  'eeeeeeee-eeee-4eee-8eee-000000004906'::uuid as viewer_p,
  'eeeeeeee-eeee-4eee-8eee-000000004907'::uuid as publisher_p,
  'eeeeeeee-eeee-4eee-8eee-000000004908'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000004911'::uuid as fresh_1,
  'eeeeeeee-eeee-4eee-8eee-000000004912'::uuid as fresh_2,
  'eeeeeeee-eeee-4eee-8eee-000000004913'::uuid as fresh_3,
  'eeeeeeee-eeee-4eee-8eee-000000004914'::uuid as fresh_4,
  'eeeeeeee-eeee-4eee-8eee-000000004915'::uuid as fresh_5,
  'cccccccc-cccc-4ccc-8ccc-000000004901'::uuid as account_p,
  'cccccccc-cccc-4ccc-8ccc-000000004902'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000004901'::uuid as store_p1,
  'ffffffff-ffff-4fff-8fff-000000004902'::uuid as store_p2,
  'ffffffff-ffff-4fff-8fff-000000004903'::uuid as store_p3,
  'ffffffff-ffff-4fff-8fff-000000004904'::uuid as store_o1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004901'::uuid as brand_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004902'::uuid as brand_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004903'::uuid as brand_o,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004911'::uuid as app_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004912'::uuid as app_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004913'::uuid as app_o;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_p, 'pairing-owner-p@example.com'),
    (fx.owner_p1, 'pairing-owner-p1@example.com'),
    (fx.manager_p1, 'pairing-manager-p1@example.com'),
    (fx.manager_all, 'pairing-manager-all@example.com'),
    (fx.member_s, 'pairing-member-s@example.com'),
    (fx.viewer_p, 'pairing-viewer-p@example.com'),
    (fx.publisher_p, 'pairing-publisher-p@example.com'),
    (fx.owner_o, 'pairing-owner-o@example.com'),
    (fx.fresh_1, 'pairing-fresh-1@example.com'),
    (fx.fresh_2, 'pairing-fresh-2@example.com'),
    (fx.fresh_3, 'pairing-fresh-3@example.com'),
    (fx.fresh_4, 'pairing-fresh-4@example.com'),
    (fx.fresh_5, 'pairing-fresh-5@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_p, 'pairing-pgtap-p', 'Pairing pgTAP P' from fx
union all
select tenant_o, 'pairing-pgtap-o', 'Pairing pgTAP O' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_p, tenant_p, 'mock', 'pairing-account-p', 'Synthetic account P' from fx
union all
select account_o, tenant_o, 'mock', 'pairing-account-o', 'Synthetic account O' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_p1, tenant_p, account_p, 'pairing-store-p1', 'Synthetic store P1' from fx
union all
select store_p2, tenant_p, account_p, 'pairing-store-p2', 'Synthetic store P2' from fx
union all
select store_p3, tenant_p, account_p, 'pairing-store-p3', 'Synthetic store P3' from fx
union all
select store_o1, tenant_o, account_o, 'pairing-store-o1', 'Synthetic store O1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_p, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_p, 'owner', null::uuid[]),
    (fx.owner_p1, 'owner', array[fx.store_p1]),
    (fx.manager_p1, 'manager', array[fx.store_p1]),
    (fx.manager_all, 'manager', null::uuid[]),
    (fx.member_s, 'staff', array[fx.store_p1]),
    (fx.viewer_p, 'viewer', null::uuid[]),
    (fx.publisher_p, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_o, owner_o, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_1, tenant_p, 'brand-991', 'Synthetic brand 1', array[store_p1, store_p2] from fx
union all
select brand_2, tenant_p, 'brand-992', 'Synthetic brand 2', array[store_p1, store_p3] from fx
union all
select brand_o, tenant_o, 'brand-993', 'Synthetic brand O', array[store_o1] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_1, tenant_p, brand_1, 'synthetic-pairing-app-1', 'ZALO_APP_SECRET_BRAND_991', 'active' from fx
union all
select app_2, tenant_p, brand_2, 'synthetic-pairing-app-2', 'ZALO_APP_SECRET_BRAND_992', 'active' from fx
union all
select app_o, tenant_o, brand_o, 'synthetic-pairing-app-o', 'ZALO_APP_SECRET_BRAND_993', 'active' from fx;

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at, created_by)
select tenant_p, 'staff_notice', 'vi', 'pair-notice-2026-01', 'Thông báo cho nhân viên', E'# Thông báo\n\nVăn bản thử.', 'published', now() - interval '1 day', owner_p from fx;

create temp table ids (label text primary key, id uuid not null);
create temp table codes (n serial primary key, label text not null, code text not null);
grant select on fx to authenticated, service_role, anon;
grant select, insert on ids to authenticated, service_role;
grant select, insert on codes to authenticated, service_role;
grant usage on sequence codes_n_seq to authenticated, service_role;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.rid(p_label text)
returns uuid
language sql
as $$
  select id from ids where label = p_label;
$$;

create function pg_temp.code(p_label text)
returns text
language sql
as $$
  select c.code from codes c where c.label = p_label order by c.n desc limit 1;
$$;

create function pg_temp.notice()
returns text
language sql
as $$
  select app.published_staff_notice((select tenant_p from fx)) ->> 'version';
$$;

create function pg_temp.pair(p_app uuid, p_zalo text, p_code text, p_new_user uuid default null)
returns jsonb
language sql
as $$
  select app.zalo_pair(p_app, p_zalo, null, p_code, pg_temp.notice(), now() - interval '1 minute', p_new_user, now());
$$;

create function pg_temp.wrong_code()
returns text
language plpgsql
as $$
declare
  v_n integer := 0;
  v_candidate text;
begin
  loop
    v_candidate := lpad(v_n::text, 6, '0');
    if not exists (
      select 1 from app.staff_pairing_codes c, fx
      where c.tenant_id = fx.tenant_p and c.code_sha256 = app.staff_pairing_code_hash(fx.tenant_p, v_candidate)
    ) and not exists (
      select 1 from app.zalo_binding_codes b, fx
      where b.code_sha256 in (app.zalo_binding_code_hash(fx.app_1, v_candidate), app.zalo_binding_code_hash(fx.app_2, v_candidate))
    ) then
      return v_candidate;
    end if;
    v_n := v_n + 1;
  end loop;
end;
$$;

create function pg_temp.live_code(p_label text)
returns app.staff_pairing_codes
language sql
as $$
  select c.* from app.staff_pairing_codes c where c.roster_id = pg_temp.rid(p_label);
$$;

set local role authenticated;
select pg_temp.act_as((select owner_p from fx));
insert into ids
select r.label, public.add_staff(fx.tenant_p, r.name, r.role::public.tenant_role, r.stores)
from fx
cross join lateral (
  values
    ('r_new', 'Nhân viên mới', 'staff', array[fx.store_p1]),
    ('r_mgr', 'Quản lý mới', 'manager', array[fx.store_p1, fx.store_p2]),
    ('r_two', 'Nhân viên hai thương hiệu', 'staff', array[fx.store_p1]),
    ('r_exp', 'Nhân viên mã hết hạn', 'staff', array[fx.store_p1]),
    ('r_tol', 'Nhân viên năm lần sai', 'staff', array[fx.store_p2]),
    ('r_burn', 'Nhân viên mã bị hủy', 'staff', array[fx.store_p2]),
    ('r_lock', 'Nhân viên chờ', 'staff', array[fx.store_p3]),
    ('r_off', 'Nhân viên nghỉ', 'staff', array[fx.store_p1]),
    ('r_view', 'Nhân viên trùng', 'staff', array[fx.store_p1])
) as r (label, name, role, stores);
reset role;

select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'staff_pairing_codes'),
  array['id', 'tenant_id', 'roster_id', 'code_sha256', 'issued_by', 'issued_at', 'expires_at', 'failed_attempts'],
  'no column of the pairing codes holds the code itself'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'staff_pairing_attempts'),
  array['zalo_app_id', 'identity_sha256', 'failed_attempts', 'last_failed_at', 'locked_until'],
  'the attempts per identity hold a hash, never the Zalo user id'
);
select ok(
  (select bool_and(not has_table_privilege(r, t, 'select') and not has_table_privilege(r, t, 'insert'))
   from unnest(array['authenticated', 'anon', 'service_role']) as r, unnest(array['app.staff_pairing_codes', 'app.staff_pairing_attempts']) as t),
  'no API role reads or writes the pairing codes or attempts'
);
select ok(
  (select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""') and count(*) = 8
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('issue_pairing_code', 'drop_pairing_codes_of_inactive_staff', 'zalo_unpaired', 'staff_ops_gate', 'zalo_sign_in',
                       'staff_login_is_fresh', 'zalo_pair', 'link_my_phone')),
  'the eight pairing functions in app are security definer with an empty search_path'
);
select ok(
  (select bool_and(not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""') and count(*) = 3
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('issue_pairing_code', 'link_my_phone', 'zalo_session_pair')),
  'the three RPCs are security invoker wrappers with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.issue_pairing_code(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.link_my_phone(uuid, text)', 'execute')
    and not has_function_privilege('service_role', 'public.issue_pairing_code(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.link_my_phone(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.issue_pairing_code(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.link_my_phone(uuid, text)', 'execute'),
  'a signed-in member calls issue_pairing_code and link_my_phone; the service role and anon do not'
);
select ok(
  has_function_privilege('service_role', 'public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.zalo_pair(uuid, text, text, text, text, timestamptz, uuid, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'app.zalo_pair(uuid, text, text, text, text, timestamptz, uuid, timestamptz)', 'execute'),
  'only the service role pairs, through zalo_session_pair'
);

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_new', public.issue_pairing_code(pg_temp.rid('r_new')) $q$), 'ok', 'an owner issues a pairing code');
reset role;
select matches(pg_temp.code('r_new'), '^[0-9]{6}$', 'a pairing code has six digits');
select is(
  (pg_temp.live_code('r_new')).code_sha256,
  (select app.sha256_hex(tenant_p::text || ':' || pg_temp.code('r_new')) from fx),
  'only the sha256 of the tenant id and the code is stored'
);
select is(
  (select (c.expires_at - c.issued_at)::text || ':' || (c.issued_by = fx.owner_p) || ':' || c.failed_attempts from fx, pg_temp.live_code('r_new') c),
  '00:10:00:true:0',
  'a pairing code lives 10 minutes and names its issuer'
);
set local role authenticated;
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ insert into codes (label, code) select 'r_new', public.issue_pairing_code(pg_temp.rid('r_new')) $q$), 'ok', 'the manager of the person''s store issues a code');
reset role;
select is(
  (select count(*)::integer || ':' || bool_and(c.code_sha256 = app.staff_pairing_code_hash(c.tenant_id, pg_temp.code('r_new'))) from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_new')),
  '1:true',
  'a new code replaces the row''s previous one'
);
set local role authenticated;
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_mgr')) $q$), '42501', 'a store manager cannot issue a code for a person who also works in another store');
select is(pg_temp.outcome_as((select owner_p1 from fx), $q$ insert into codes (label, code) select 'r_two', public.issue_pairing_code(pg_temp.rid('r_two')) $q$), 'ok', 'a store-limited owner issues a code for a person of their store');
select is(pg_temp.outcome_as((select manager_all from fx), $q$ insert into codes (label, code) select 'r_mgr', public.issue_pairing_code(pg_temp.rid('r_mgr')) $q$), 'ok', 'an unlimited manager issues a code for a manager of two stores');
select is(pg_temp.outcome_as((select member_s from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'staff cannot issue a code');
select is(pg_temp.outcome_as((select viewer_p from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'a viewer cannot issue a code');
select is(pg_temp.outcome_as((select publisher_p from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'the publisher cannot issue a code');
select is(pg_temp.outcome_as((select owner_o from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'another tenant''s owner cannot issue a code');
select is(pg_temp.outcome_as((select fresh_5 from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'a login without membership cannot issue a code');
select is(pg_temp.outcome_as(null, $q$ select public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), '42501', 'a request without a login cannot issue a code');
select is(pg_temp.outcome_as((select owner_p from fx), $q$ select public.issue_pairing_code('00000000-0000-4000-8000-000000004999') $q$), '42501', 'an unknown roster row is refused like a forbidden one');
reset role;
set local role anon;
select throws_ok($q$ select public.issue_pairing_code('00000000-0000-4000-8000-000000004999') $q$, '42501', null, 'anon cannot issue a code');
reset role;

select is(
  (select app.zalo_pair(app_1, 'pair-zalo-a') - 'notice' from fx),
  '{"status": "unpaired"}'::jsonb,
  'an unbound identity without a code is unpaired, with no reason'
);
select is((select app.zalo_pair(app_1, 'pair-zalo-a') -> 'notice' ->> 'version' from fx), 'pair-notice-2026-01', 'and is shown the published staff notice');
select is(
  (select app.zalo_sign_in(app_1, 'pair-zalo-a') -> 'notice' ->> 'title' from fx),
  'Thông báo cho nhân viên',
  'the plain sign-in answers unpaired with the notice too'
);
select is(
  (select app.zalo_pair(app_1, 'pair-zalo-a', null, pg_temp.code('r_new')) ->> 'reason' from fx),
  'notice_outdated',
  'a code sent without accepting the notice is not checked'
);
select is(
  (select app.zalo_pair(app_1, 'pair-zalo-a', null, pg_temp.code('r_new'), 'pair-notice-2025-12', now(), null, now()) ->> 'reason' from fx),
  'notice_outdated',
  'nor with a version that is not the published one'
);
select is((pg_temp.live_code('r_new')).failed_attempts, 0::smallint, 'neither counts as an attempt');
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-a', pg_temp.code('r_new')) from fx),
  '{"status": "login_needed"}'::jsonb,
  'a valid code for a row without a login asks zalo-session for a fresh login'
);
select is(
  (select (r.user_id is null)::text || ':' || r.status || ':' || ((pg_temp.live_code('r_new')).id is not null) || ':' ||
          (select count(*) from public.consent_records c where c.tenant_id = r.tenant_id and c.purpose = 'staff_ops')
   from public.staff_roster r where r.id = pg_temp.rid('r_new')),
  'true:invited:true:0',
  'and changes nothing yet: no login, no consent, the code still live'
);
select throws_ok(
  $q$ select pg_temp.pair(app_1, 'pair-zalo-a', pg_temp.code('r_new'), owner_p) from fx $q$,
  '22023', null,
  'a login that already belongs to someone is never given to a roster row'
);

create temp table paired_a as
select pg_temp.pair(app_1, 'pair-zalo-a', pg_temp.code('r_new'), fresh_1) as answer from fx;
select is(
  (select answer - 'user_id' - 'tenant_id' - 'display_name' from paired_a),
  (select jsonb_build_object('status', 'bound', 'role', 'staff', 'store_ids', jsonb_build_array(store_p1), 'stores', jsonb_build_array('Synthetic store P1'), 'brand_store_ids', jsonb_build_array(store_p1)) from fx),
  'the code pairs the person with exactly the roster role and stores'
);
select is(
  (select (answer ->> 'user_id') || ':' || (answer ->> 'tenant_id') from paired_a),
  (select fresh_1::text || ':' || tenant_p::text from fx),
  'as the new login, in the tenant'
);
select is(
  (select r.status || ':' || (r.user_id = fx.fresh_1) || ':' || (r.paired_at = now()) || ':' || (r.phone is null) from fx, public.staff_roster r where r.id = pg_temp.rid('r_new')),
  'active:true:true:true',
  'the roster row is active, holds the login and the pairing time, and no phone'
);
select is(
  (select m.role || ':' || array_to_string(m.store_ids, ',') from public.tenant_members m, fx where m.tenant_id = fx.tenant_p and m.user_id = fx.fresh_1),
  (select 'staff:' || store_p1 from fx),
  'the membership has the roster role and stores'
);
select is(
  (select i.tenant_id = fx.tenant_p and i.zalo_app_id = fx.app_1 and i.user_id = fx.fresh_1 from fx, public.zalo_identities i where i.zalo_user_id = 'pair-zalo-a'),
  true,
  'the Zalo identity of this app is bound to the login'
);
select is(
  (select c.policy_version || ':' || c.channel || ':' || (c.evidence ->> 'method') from public.consent_records c, fx
   where c.tenant_id = fx.tenant_p and c.subject_id = fx.fresh_1 and c.purpose = 'staff_ops' and c.revoked_at is null),
  'pair-notice-2026-01:mini_app:accept_button',
  'the staff_ops consent is recorded in the same step, naming the notice accepted'
);
select is((select count(*)::integer from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_new')), 0, 'the used code is gone');
select is((select app.zalo_sign_in(app_1, 'pair-zalo-a') ->> 'role' from fx), 'staff', 'the next sign-in needs no code');
select is(
  (select app.custom_access_token_claims(jsonb_build_object('user_id', fresh_1, 'claims', jsonb_build_object('sub', fresh_1))) -> 'claims' -> 'memberships' from fx),
  (select jsonb_build_array(jsonb_build_object('tenant_id', tenant_p, 'role', 'staff', 'store_ids', jsonb_build_array(store_p1))) from fx),
  'a session minted now carries the staff role and store'
);
set local role authenticated;
select pg_temp.act_as((select fresh_1 from fx));
select is((select array_agg(s.id) from public.stores s), (select array[store_p1] from fx), 'through RLS the new member reads only their store');
select is((select count(*)::integer from public.staff_roster), 1, 'and only their own roster row');
reset role;

select is(
  (select pg_temp.pair(app_1, 'pair-zalo-b', pg_temp.code('r_new'), fresh_2) - 'notice' from fx),
  '{"status": "unpaired", "reason": "code_refused"}'::jsonb,
  'a used code pairs nobody else'
);

select is(
  (select pg_temp.pair(app_1, 'pair-zalo-m', pg_temp.code('r_mgr'), fresh_2) - 'user_id' - 'tenant_id' - 'display_name' from fx),
  (select jsonb_build_object('status', 'bound', 'role', 'manager', 'store_ids', jsonb_build_array(store_p1, store_p2), 'stores', jsonb_build_array('Synthetic store P1', 'Synthetic store P2'), 'brand_store_ids', jsonb_build_array(store_p1, store_p2)) from fx),
  'a manager row pairs as a manager of its two stores'
);

set local role service_role;
select is(
  (select public.zalo_session_pair(app_1, 'pair-zalo-t1', 'Tên Zalo', pg_temp.code('r_two'), 'pair-notice-2026-01', now() - interval '1 minute', fresh_3) ->> 'display_name' from fx),
  'Tên Zalo',
  'the service role pairs through the RPC and the Zalo name is kept'
);
reset role;

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_exp', public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), 'ok', 'a code for the expiry case');
reset role;
update app.staff_pairing_codes c set issued_at = c.issued_at - interval '11 minutes', expires_at = c.expires_at - interval '11 minutes' where c.roster_id = pg_temp.rid('r_exp');
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-e', pg_temp.code('r_exp'), fresh_4) ->> 'reason' from fx),
  'code_refused',
  'an expired code is refused'
);
select is((select count(*)::integer from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_exp')), 0, 'and deleted');

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_tol', public.issue_pairing_code(pg_temp.rid('r_tol')) $q$), 'ok', 'the owner issues a code for r_tol');
reset role;
select is(
  (select array_agg(pg_temp.pair(app_1, 'pair-guess-' || g, pg_temp.wrong_code()) ->> 'reason' order by g) from fx, generate_series(1, 5) g),
  array['code_refused', 'code_refused', 'code_refused', 'code_refused', 'code_refused'],
  'five wrong codes from five identities are refused'
);
select is((pg_temp.live_code('r_tol')).failed_attempts, 5::smallint, 'each counts against the live code');
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-tol', pg_temp.code('r_tol'), fresh_4) ->> 'status' from fx),
  'bound',
  'after five wrong attempts the right code still pairs'
);

select app.issue_zalo_binding_code(tenant_p, owner_p, app_1) is not null from fx;
set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_burn', public.issue_pairing_code(pg_temp.rid('r_burn')) $q$), 'ok', 'the owner issues a code for r_burn');
reset role;
select is(
  (select array_agg(pg_temp.pair(app_1, 'pair-guess-' || g, pg_temp.wrong_code()) ->> 'reason' order by g) from fx, generate_series(11, 16) g),
  array['code_refused', 'code_refused', 'code_refused', 'code_refused', 'code_refused', 'code_refused'],
  'six wrong codes from six identities are refused'
);
select is((select count(*)::integer from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_burn')), 0, 'the sixth wrong attempt burns the pairing code');
select is((select count(*)::integer from app.zalo_binding_codes b, fx where b.zalo_app_id = fx.app_1), 0, 'and the app''s binding codes, which the pairing request also accepts');
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-burn', pg_temp.code('r_burn'), fresh_5) ->> 'reason' from fx),
  'code_refused',
  'a burnt code no longer pairs'
);
select is((select r.status from public.staff_roster r where r.id = pg_temp.rid('r_burn')), 'invited', 'and the row stays invited');

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_lock', public.issue_pairing_code(pg_temp.rid('r_lock')) $q$), 'ok', 'the owner issues a code for r_lock');
reset role;
select is(
  (select array_agg(pg_temp.pair(app_1, 'pair-zalo-lock', pg_temp.wrong_code()) ->> 'reason' order by g) from fx, generate_series(1, 5) g),
  array['code_refused', 'code_refused', 'code_refused', 'code_refused', 'wait'],
  'one identity''s fifth wrong code makes it wait'
);
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-lock', pg_temp.wrong_code()) - 'notice' from fx),
  '{"status": "unpaired", "reason": "wait", "retry_after": 900}'::jsonb,
  'the wait is 15 minutes'
);
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-lock', pg_temp.code('r_lock'), fresh_5) ->> 'reason' from fx),
  'wait',
  'while it waits even the right code is not checked'
);
select is((pg_temp.live_code('r_lock')).failed_attempts, 5::smallint, 'so the waiting identity''s requests no longer count against the code');
select is(
  (select t.failed_attempts || ':' || (t.locked_until = now() + interval '15 minutes') from app.staff_pairing_attempts t, fx
   where t.zalo_app_id = fx.app_1 and t.identity_sha256 = app.sha256_hex(fx.app_1::text || ':pair-zalo-lock')),
  '5:true',
  'the identity is kept as a hash with its count and the end of its wait'
);
select ok(
  not exists (select 1 from app.staff_pairing_attempts t where row(t.*)::text like '%pair-zalo-lock%'),
  'the Zalo user id itself is not stored'
);
update app.staff_pairing_attempts t
set last_failed_at = t.last_failed_at - interval '16 minutes', locked_until = t.locked_until - interval '16 minutes'
from fx
where t.zalo_app_id = fx.app_1 and t.identity_sha256 = app.sha256_hex(fx.app_1::text || ':pair-zalo-lock');
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-lock', pg_temp.code('r_lock'), fresh_5) ->> 'status' from fx),
  'bound',
  'after the wait the identity tries again and the right code pairs'
);
select is(
  (select count(*)::integer from app.staff_pairing_attempts t, fx where t.zalo_app_id = fx.app_1 and t.identity_sha256 = app.sha256_hex(fx.app_1::text || ':pair-zalo-lock')),
  0,
  'and its count is gone'
);
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-other', pg_temp.wrong_code()) ->> 'reason' from fx),
  'code_refused',
  'another identity of the same app does not wait'
);

select is((select app.zalo_sign_in(app_2, 'pair-zalo-t2') ->> 'status' from fx), 'unpaired', 'a paired person opening the second brand''s app is unpaired there');
set local role authenticated;
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ insert into codes (label, code) select 'r_two', public.issue_pairing_code(pg_temp.rid('r_two')) $q$), 'ok', 'the manager issues a code for the active row');
reset role;
select is(
  (select pg_temp.pair(app_2, 'pair-zalo-t2', pg_temp.code('r_two')) - 'tenant_id' - 'display_name' from fx),
  (select jsonb_build_object('status', 'bound', 'user_id', fresh_3, 'role', 'staff', 'store_ids', jsonb_build_array(store_p1), 'stores', jsonb_build_array('Synthetic store P1'), 'brand_store_ids', jsonb_build_array(store_p1)) from fx),
  'pairing in the second brand keeps the same login, asks for no new one and shows that brand''s stores in scope'
);
select is(
  (select (select count(*) from public.staff_roster r where r.user_id = fx.fresh_3)
        || ':' || (select count(*) from public.tenant_members m where m.user_id = fx.fresh_3)
        || ':' || (select count(*) from public.zalo_identities i where i.user_id = fx.fresh_3)
        || ':' || (select count(*) from public.consent_records c where c.subject_id = fx.fresh_3 and c.purpose = 'staff_ops')
   from fx),
  '1:1:2:1',
  'one roster row, one membership, an identity per app and the one consent already given'
);
select is((select r.paired_at = now() and r.status = 'active' from public.staff_roster r where r.id = pg_temp.rid('r_two')), true, 'the row stays active with its latest pairing time');

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_off', public.issue_pairing_code(pg_temp.rid('r_off')) $q$), 'ok', 'the owner issues a code for r_off');
select is(pg_temp.outcome_as((select owner_p from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_off')) $q$), 'ok', 'an owner deactivates a person with a live code');
reset role;
select is((select count(*)::integer from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_off')), 0, 'deactivation deletes the live code');
set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_off')) $q$), '22023', 'an inactive row gets no code');
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_new')) $q$), 'ok', 'the manager deactivates a paired person');
reset role;
select is((select app.zalo_sign_in(app_1, 'pair-zalo-a') - 'notice' from fx), '{"status": "unpaired"}'::jsonb, 'the deactivated person is unpaired at their next call');
set local role authenticated;
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ select public.reactivate_staff(pg_temp.rid('r_new')) $q$), 'ok', 'and reactivates them');
select is(pg_temp.outcome_as((select manager_p1 from fx), $q$ insert into codes (label, code) select 'r_new', public.issue_pairing_code(pg_temp.rid('r_new')) $q$), 'ok', 'a new code for the reactivated row');
reset role;
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-a', pg_temp.code('r_new')) ->> 'user_id' from fx),
  (select fresh_1::text from fx),
  'pairing again reuses the row''s login without asking for a new one'
);
select is((select r.status from public.staff_roster r where r.id = pg_temp.rid('r_new')), 'active', 'and makes the row active again');

set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_exp', public.issue_pairing_code(pg_temp.rid('r_exp')) $q$), 'ok', 'the owner issues a code for r_exp');
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_view', public.issue_pairing_code(pg_temp.rid('r_view')) $q$), 'ok', 'the owner issues a code for r_view');
reset role;
update app.staff_pairing_codes c set issued_at = c.issued_at - interval '11 minutes', expires_at = c.expires_at - interval '11 minutes' where c.roster_id = pg_temp.rid('r_exp');
update public.staff_roster r set user_id = fx.publisher_p from fx where r.id = pg_temp.rid('r_view');
create temp table refusals as
select 'wrong' as label, pg_temp.pair(app_1, 'pair-hint-1', pg_temp.wrong_code()) as answer from fx
union all select 'expired', pg_temp.pair(app_1, 'pair-hint-2', pg_temp.code('r_exp')) from fx
union all select 'used', pg_temp.pair(app_1, 'pair-hint-3', pg_temp.code('r_new')) from fx
union all select 'deactivated', pg_temp.pair(app_1, 'pair-hint-4', pg_temp.code('r_off')) from fx
union all select 'publisher login', pg_temp.pair(app_1, 'pair-hint-5', pg_temp.code('r_view')) from fx;
select is((select count(distinct answer)::integer from refusals), 1, 'a wrong, expired, used, deactivated or conflicting code gets the very same answer');
select is((select answer - 'notice' from refusals limit 1), '{"status": "unpaired", "reason": "code_refused"}'::jsonb, 'and it says only that the code was refused');
select is(
  (select m.role::text || ':' || (select count(*) from public.zalo_identities i where i.zalo_user_id = 'pair-hint-5') || ':' || (select count(*) from app.staff_pairing_codes c where c.roster_id = pg_temp.rid('r_view'))
   from public.tenant_members m, fx where m.tenant_id = fx.tenant_p and m.user_id = fx.publisher_p),
  'publisher:0:0',
  'a row whose login is the publisher binds nothing and its code is dropped'
);
set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ select public.issue_pairing_code(pg_temp.rid('r_view')) $q$), '22023', 'a row bound to an owner, viewer or publisher login gets no code');
reset role;

insert into codes (label, code) select 'binding-owner', app.issue_zalo_binding_code(tenant_p, owner_p, app_1) from fx;
select is(
  (select pg_temp.pair(app_1, 'pair-zalo-owner', pg_temp.code('binding-owner')) ->> 'role' from fx),
  'owner',
  'the pairing request also accepts a binding code of fnb zalo bind'
);
select is(
  (select count(*)::integer from public.consent_records c, fx where c.subject_id = fx.owner_p and c.purpose = 'staff_ops'),
  0,
  'an owner without a roster row gets no staff_ops consent'
);
select is((select app.zalo_sign_in(app_1, 'pair-zalo-owner') ->> 'status' from fx), 'bound', 'and keeps signing in without one');

set local role authenticated;
select pg_temp.act_as((select owner_p from fx));
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
select tenant_p, 'staff_notice', 'vi', 'pair-notice-2026-02', 'Thông báo cho nhân viên, bản 2', E'# Thông báo\n\nBản thử 2.' from fx;
select public.publish_legal_document((select d.id from public.legal_documents d, fx where d.tenant_id = fx.tenant_p and d.version = 'pair-notice-2026-02')) is not null;
reset role;
select is(
  (select app.zalo_sign_in(app_1, 'pair-zalo-m') - 'notice' from fx),
  '{"status": "notice_required"}'::jsonb,
  'after a new notice the paired manager gets notice_required and no session'
);
select is((select app.zalo_sign_in(app_1, 'pair-zalo-m') -> 'notice' ->> 'version' from fx), 'pair-notice-2026-02', 'with the new version');
select is((select app.zalo_sign_in(app_1, 'pair-zalo-owner') ->> 'status' from fx), 'bound', 'an owner bound without a roster row is not asked');
select is(
  (select app.zalo_pair(app_1, 'pair-zalo-m', null, null, 'pair-notice-2026-01', now(), null, now()) ->> 'status' from fx),
  'notice_required',
  'accepting the retired version does not help'
);
select is((select pg_temp.pair(app_1, 'pair-zalo-m', null) ->> 'role' from fx), 'manager', 'accepting the new version through the pairing request signs in');
select is(
  (select array_agg(c.policy_version || ':' || (c.revoked_at is null) order by c.policy_version) from public.consent_records c, fx where c.subject_id = fx.fresh_2 and c.purpose = 'staff_ops'),
  array['pair-notice-2026-01:false', 'pair-notice-2026-02:true'],
  'the consent now names the new version'
);
select is(
  (select app.zalo_pair(app_1, 'pair-zalo-new', null, pg_temp.wrong_code(), 'pair-notice-2026-01', now(), null, now()) ->> 'reason' from fx),
  'notice_outdated',
  'a pairing with the retired notice is not checked'
);
select is(
  (select count(*)::integer from app.staff_pairing_attempts t, fx where t.identity_sha256 = app.sha256_hex(fx.app_1::text || ':pair-zalo-new')),
  0,
  'and counts no attempt'
);

set local role authenticated;
select pg_temp.act_as((select fresh_2 from fx));
select is((select public.link_my_phone(tenant_p, '+' || '84' || '912000001') from fx), '…001', 'the paired person links their phone and gets its hint');
reset role;
select is(
  (select (r.phone = '+' || '84' || '912000001') || ':' || (r.phone_linked_at = now()) || ':' || (r.updated_by = fx.fresh_2)
   from fx, public.staff_roster r where r.id = pg_temp.rid('r_mgr')),
  'true:true:true',
  'the number is on their own row with the time and their name as the writer'
);
set local role authenticated;
select is(pg_temp.outcome_as((select fresh_2 from fx), $q$ select public.link_my_phone(tenant_p, '0912000001') from fx $q$), '22023', 'a number not in international form is refused');
select is(pg_temp.outcome_as((select fresh_2 from fx), $q$ select public.link_my_phone(tenant_o, '+' || '84' || '912000001') from fx $q$), '42501', 'nor can they write in another tenant');
select is(pg_temp.outcome_as((select manager_all from fx), $q$ select public.link_my_phone(tenant_p, '+' || '84' || '912000002') from fx $q$), '42501', 'a manager cannot write a phone, theirs or anyone''s');
select is(pg_temp.outcome_as((select owner_p from fx), $q$ select public.link_my_phone(tenant_p, '+' || '84' || '912000002') from fx $q$), '42501', 'nor can an owner');
select is(pg_temp.outcome_as((select member_s from fx), $q$ select public.link_my_phone(tenant_p, '+' || '84' || '912000002') from fx $q$), '42501', 'a member who is not on the roster cannot');
select is(pg_temp.outcome_as(null, $q$ select public.link_my_phone(tenant_p, '+' || '84' || '912000002') from fx $q$), '42501', 'a request without a login cannot');
reset role;
select is(
  (select count(*)::integer from public.staff_roster r, fx where r.tenant_id = fx.tenant_p and r.phone is not null),
  1,
  'only the person''s own call stored a phone'
);
set local role authenticated;
select pg_temp.act_as((select fresh_2 from fx));
select is((select public.link_my_phone(tenant_p, null) from fx), null, 'the person removes their phone');
reset role;
select is(
  (select (r.phone is null) and (r.phone_linked_at is null) and (r.phone_hint is null) from public.staff_roster r where r.id = pg_temp.rid('r_mgr')),
  true,
  'and nothing of it is left'
);
select is((select app.zalo_sign_in(app_1, 'pair-zalo-m') ->> 'status' from fx), 'bound', 'phone linking never gates the sign-in');

set local role authenticated;
select pg_temp.act_as((select fresh_3 from fx));
select is((select public.withdraw_staff_ops_consent(tenant_p) from fx), true, 'a paired person withdraws their staff_ops consent');
reset role;
select is((select count(*)::integer from public.zalo_identities i, fx where i.user_id = fx.fresh_3), 0, 'both of their identities are unpaired');
select is((select app.zalo_sign_in(app_2, 'pair-zalo-t2') ->> 'status' from fx), 'unpaired', 'so the next call is unpaired');
set local role authenticated;
select is(pg_temp.outcome_as((select owner_p from fx), $q$ insert into codes (label, code) select 'r_two', public.issue_pairing_code(pg_temp.rid('r_two')) $q$), 'ok', 'the owner issues a code for r_two');
reset role;
select is((select pg_temp.pair(app_2, 'pair-zalo-t2', pg_temp.code('r_two')) ->> 'user_id' from fx), (select fresh_3::text from fx), 'a new code pairs them again as the same login');
select is(
  (select count(*)::integer from public.consent_records c, fx where c.subject_id = fx.fresh_3 and c.purpose = 'staff_ops' and c.revoked_at is null),
  1,
  'with a new staff_ops consent'
);

select throws_ok($q$ select app.zalo_pair('bbbbbbbb-bbbb-4bbb-8bbb-000000004999', 'pair-zalo-a') $q$, '22023', null, 'an unknown Zalo App is refused');
select throws_ok($q$ select app.zalo_pair(app_1, 'pair zalo', null) from fx $q$, '22023', null, 'a malformed Zalo user id is refused');
select throws_ok($q$ select app.zalo_pair(app_1, 'pair-zalo-a', null, '12345') from fx $q$, '22023', null, 'a code of five digits is refused');
select throws_ok($q$ select app.zalo_pair(app_1, 'pair-zalo-a', null, '123456', 'Bad Version') from fx $q$, '22023', null, 'a malformed notice version is refused');
update public.zalo_apps a set status = 'disabled' from fx where a.id = fx.app_2;
select throws_ok($q$ select app.zalo_pair(app_2, 'pair-zalo-t2') from fx $q$, '22023', null, 'a disabled Zalo App is refused');

select * from finish();
rollback;
