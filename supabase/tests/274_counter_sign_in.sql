-- The counter web app's sign-in (ADR-064, ADR-066): the brand's Zalo App for the counter-session function and the
-- people Zalo verified but the roster refused (acceptance criterion 5, screen M02 "people blocked at sign-in").
-- Techniques: authorisation by role, tenant and caller kind (decision table), state transitions of a blocked sign-in
-- (pending -> dismissed -> pending again; pending -> approved), boundary values (the 7-day list window, the 30-day
-- purge, the 200 rows of a tenant, a device line of 60 and 61 characters), error guessing (a bound member recorded,
-- an unknown app, a forged user id, a stale version, approving twice, granting the owner role).
begin;
select plan(48);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000027401'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000027402'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000027401'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000027402'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000027401'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000027402'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000027403'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000027401'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000027402'::uuid as brand_b,
  '99999999-9999-4999-8999-000000027401'::uuid as app_a,
  '99999999-9999-4999-8999-000000027402'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000027401'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000027402'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000027403'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000027404'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000027405'::uuid as viewer_u;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'counter-sign-in-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_u), (fx.manager_a1_u), (fx.staff_u), (fx.owner_b_u), (fx.viewer_u)) as u (id);

insert into public.tenants (id, slug, name)
select tenant_a, 'counter-sign-in-pgtap-a', 'Counter sign-in pgTAP A' from fx
union all select tenant_b, 'counter-sign-in-pgtap-b', 'Counter sign-in pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'counter-sign-in-a', 'Synthetic account A' from fx
union all select account_b, tenant_b, 'mock', 'counter-sign-in-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'cs-a1', 'cs-a1', 'Synthetic A1' from fx
union all select store_a2, tenant_a, account_a, 'cs-a2', 'cs-a2', 'Synthetic A2' from fx
union all select store_b1, tenant_b, account_b, 'cs-b1', 'cs-b1', 'Synthetic B1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_a, manager_a1_u, 'manager', array[store_a1] from fx
union all select tenant_a, staff_u, 'staff', array[store_a1] from fx
union all select tenant_a, viewer_u, 'viewer', null from fx
union all select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx
union all select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_a, tenant_a, brand_a, 'synthetic-app-27401', 'ZALO_APP_SECRET_BRAND_1' from fx
union all select app_b, tenant_b, brand_b, 'synthetic-app-27402', 'ZALO_APP_SECRET_BRAND_1' from fx;
-- the staff member is bound to a Zalo identity of brand A's app
insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_a, app_a, 'zalo-bound-274', staff_u, 'Synthetic staff' from fx;

create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform set_config('role', 'service_role', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.record(p_app uuid, p_user text, p_name text default null, p_device text default null) returns jsonb language sql as $$
  select pg_temp.call(null, format($q$select public.counter_record_blocked_signin(%L, %L, %L, %L)$q$, p_app, p_user, p_name, p_device));
$$;
create function pg_temp.list(p_user uuid, p_tenant uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select public.manager_blocked_signins(%L)$q$, p_tenant));
$$;
create function pg_temp.row_of(p_user text) returns app.blocked_signins language sql stable as $$
  select * from app.blocked_signins where zalo_user_id = p_user;
$$;
create function pg_temp.dismiss(p_user uuid, p_request uuid, p_version integer) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select public.manager_dismiss_blocked_signin(%L, %s)$q$, p_request, p_version));
$$;
create function pg_temp.approve(p_user uuid, p_request uuid, p_version integer, p_name text, p_role text, p_stores uuid[]) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select public.manager_approve_blocked_signin(%L, %s, %L, %L, %L)$q$, p_request, p_version, p_name, p_role, p_stores));
$$;

-- 1. Privileges ---------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.counter_session_app(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.counter_session_app(text, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.counter_session_app(text, uuid)', 'execute'),
  'only the service role resolves the counter''s Zalo App');
select ok(not has_function_privilege('anon', 'public.counter_record_blocked_signin(uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.counter_record_blocked_signin(uuid, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.counter_record_blocked_signin(uuid, text, text, text)', 'execute'),
  'only the service role records a blocked sign-in');
select ok(has_function_privilege('authenticated', 'public.manager_blocked_signins(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.manager_blocked_signins(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.manager_blocked_signins(uuid)', 'execute'),
  'members (not anon, not the service role) call the manager list; the function checks the role');
select ok(not has_table_privilege('authenticated', 'app.blocked_signins', 'select')
  and not has_table_privilege('service_role', 'app.blocked_signins', 'select')
  and not has_table_privilege('anon', 'app.blocked_signins', 'select'),
  'no API role reads the blocked sign-ins table');
select ok(not has_function_privilege('authenticated', 'app.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'app.counter_record_blocked_signin(uuid, text, text, text, timestamptz)', 'execute'),
  'the app functions are reached only through the public wrappers');

-- 2. The Zalo App of a brand --------------------------------------------------------------------------------------
select is((select string_agg(external_id || '/' || status, ',') from public.counter_session_app('brand-1', (select tenant_a from fx))),
  'synthetic-app-27401/active', 'the brand''s Zalo App answers its public id within the tenant');
select is((select count(*)::integer from public.counter_session_app('brand-1', null)) >= 2, true,
  'a brand key shared by two tenants answers more than one row (the function refuses it as ambiguous)');
select is((select count(*)::integer from public.counter_session_app('brand-404', (select tenant_a from fx))), 0, 'an unknown brand key answers nothing');

-- 3. Recording -------------------------------------------------------------------------------------------------------
select is(pg_temp.record((select app_a from fx), 'zalo-new-1', 'Người lạ', 'Chrome · Android') ->> 'recorded', 'true', 'an unknown identity is recorded');
select is((select attempts || '/' || status || '/' || display_name from pg_temp.row_of('zalo-new-1')), '1/pending/Người lạ', 'with one attempt, pending, the Zalo name');
select is(pg_temp.record((select app_a from fx), 'zalo-new-1', null, null) ->> 'recorded', 'true', 'a second attempt is recorded on the same row');
select is((select attempts || '/' || display_name || '/' || device from pg_temp.row_of('zalo-new-1')), '2/Người lạ/Chrome · Android',
  'two attempts; a missing name or device keeps the last one');
select is((select count(*)::integer from app.blocked_signins where zalo_user_id = 'zalo-new-1'), 1, 'one row per identity');
select is(pg_temp.record((select app_a from fx), 'zalo-bound-274') ->> 'recorded', 'false', 'a person bound to a member is not blocked');
select is(pg_temp.record((select app_a from fx), 'zalo-device-60', null, repeat('d', 60)) ->> 'recorded', 'true', 'a device line of 60 characters is kept');
select is((select char_length(device) from pg_temp.row_of('zalo-device-60')), 60, '60 characters stored');
select is(pg_temp.record((select app_a from fx), 'zalo-device-61', 'Tên', repeat('d', 61)) ->> 'recorded', 'true', 'a device line of 61 characters is dropped, the attempt kept');
select is((select device from pg_temp.row_of('zalo-device-61')), null, 'no device stored');
select is(pg_temp.record('aaaaaaaa-aaaa-4aaa-8aaa-000000027490', 'zalo-x') ->> 'error', '22023', 'an unknown Zalo App is refused');
select is(pg_temp.record((select app_a from fx), 'bad id!') ->> 'error', '22023', 'a forged user id is refused');
select is(pg_temp.call((select owner_u from fx), format($q$select public.counter_record_blocked_signin(%L, 'zalo-owner')$q$, (select app_a from fx))) ->> 'error', '42501',
  'a member cannot record a blocked sign-in');

-- 4. The manager list -------------------------------------------------------------------------------------------------
select is(jsonb_array_length(pg_temp.list((select owner_u from fx), (select tenant_a from fx)) -> 'requests'), 3, 'the owner sees the three pending people');
select is(jsonb_array_length(pg_temp.list((select manager_a1_u from fx), (select tenant_a from fx)) -> 'requests'), 3, 'a store manager of the tenant sees them too');
select is(pg_temp.list((select staff_u from fx), (select tenant_a from fx)) ->> 'error', '42501', 'staff cannot');
select is(pg_temp.list((select viewer_u from fx), (select tenant_a from fx)) ->> 'error', '42501', 'a viewer cannot');
select is(pg_temp.list((select owner_b_u from fx), (select tenant_a from fx)) ->> 'error', '42501', 'an owner of another tenant cannot');
select is((pg_temp.list((select owner_u from fx), (select tenant_a from fx)) -> 'requests' -> 0) ? 'zalo_user_id', false, 'the list never shows the Zalo user id');
update app.blocked_signins set first_at = now() - interval '7 days' + interval '1 minute', last_at = now() - interval '7 days' + interval '1 minute' where zalo_user_id = 'zalo-device-60';
update app.blocked_signins set first_at = now() - interval '7 days' - interval '1 minute', last_at = now() - interval '7 days' - interval '1 minute' where zalo_user_id = 'zalo-device-61';
select is(jsonb_array_length(pg_temp.list((select owner_u from fx), (select tenant_a from fx)) -> 'requests'), 2,
  'a person last seen just inside 7 days is listed, just outside is not');

-- 5. Dismissing --------------------------------------------------------------------------------------------------------
select is(pg_temp.dismiss((select owner_u from fx), (pg_temp.row_of('zalo-new-1')).id, 1) ->> 'state', 'conflict', 'a stale version is a conflict');
select is(pg_temp.dismiss((select staff_u from fx), (pg_temp.row_of('zalo-new-1')).id, 2) ->> 'error', '42501', 'staff cannot dismiss');
select is(pg_temp.dismiss((select owner_b_u from fx), (pg_temp.row_of('zalo-new-1')).id, 2) ->> 'error', '42501', 'another tenant cannot dismiss');
select is(pg_temp.dismiss((select owner_u from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000027491', 1) ->> 'error', '42501', 'an unknown id is refused like another tenant''s');
select is(pg_temp.dismiss((select manager_a1_u from fx), (pg_temp.row_of('zalo-new-1')).id, 2) ->> 'state', 'dismissed', 'a manager dismisses it');
select is((select status || '/' || (decided_by = (select manager_a1_u from fx))::text from pg_temp.row_of('zalo-new-1')), 'dismissed/true', 'with who decided');
select is(pg_temp.dismiss((select owner_u from fx), (pg_temp.row_of('zalo-new-1')).id, 3) ->> 'replayed', 'true', 'dismissing again is a replay');
select is(pg_temp.record((select app_a from fx), 'zalo-new-1') ->> 'recorded', 'true', 'the person tries again');
select is((select status || '/' || attempts from pg_temp.row_of('zalo-new-1')), 'pending/3', 'the row is pending again with a third attempt');

-- 6. Approving ---------------------------------------------------------------------------------------------------------
select is(pg_temp.approve((select manager_a1_u from fx), (pg_temp.row_of('zalo-new-1')).id, (pg_temp.row_of('zalo-new-1')).version, 'Người mới', 'staff', null) ->> 'error', '42501',
  'a store manager cannot grant every store');
select is(pg_temp.approve((select owner_u from fx), (pg_temp.row_of('zalo-new-1')).id, (pg_temp.row_of('zalo-new-1')).version, 'Người mới', 'owner', null) ->> 'error', '22023',
  'nobody grants the owner role through it');
select is(pg_temp.approve((select staff_u from fx), (pg_temp.row_of('zalo-new-1')).id, (pg_temp.row_of('zalo-new-1')).version, 'Người mới', 'staff', array[(select store_a1 from fx)]) ->> 'error', '42501',
  'staff cannot add people');
create temp table approved as
select pg_temp.approve((select manager_a1_u from fx), (pg_temp.row_of('zalo-new-1')).id, (pg_temp.row_of('zalo-new-1')).version, 'Người mới', 'staff', array[(select store_a1 from fx)]) as r;
select is((select (r ->> 'state') || '/' || ((r ->> 'pairing_code') ~ '^[0-9]{6}$')::text || '/' || (r ->> 'pairing_code_minutes') from approved), 'approved/true/10',
  'a store manager adds the person to their store and gets a six-digit pairing code');
select is((select status || '/' || display_name || '/' || role::text || '/' || array_to_string(store_ids, ',') = 'invited/Người mới/staff/' || (select store_a1 from fx)::text
  from public.staff_roster where id = (select (r ->> 'roster_id')::uuid from approved)), true, 'the roster row is invited with the name, role and store');
select is((select status || '/' || (roster_id = (select (r ->> 'roster_id')::uuid from approved))::text from pg_temp.row_of('zalo-new-1')), 'approved/true', 'the blocked row is approved with its roster row');
select is(pg_temp.approve((select owner_u from fx), (pg_temp.row_of('zalo-new-1')).id, (pg_temp.row_of('zalo-new-1')).version, 'Người mới', 'staff', null) ->> 'refusal', 'not_pending',
  'a decided row cannot be approved twice');

-- 7. Bounds of the table -----------------------------------------------------------------------------------------------
insert into app.blocked_signins (tenant_id, zalo_app_id, zalo_user_id, first_at, last_at)
select (select tenant_b from fx), (select app_b from fx), 'zalo-flood-' || n, now(), now() from generate_series(1, 199) n;
select is(pg_temp.record((select app_b from fx), 'zalo-flood-200') ->> 'recorded', 'true', 'the 200th row of a tenant is recorded');
select is(pg_temp.record((select app_b from fx), 'zalo-flood-201') ->> 'recorded', 'false', 'the 201st is not (the sign-in is still refused)');
update app.blocked_signins set first_at = now() - interval '31 days', last_at = now() - interval '31 days' where zalo_user_id = 'zalo-flood-1';
select is(pg_temp.record((select app_b from fx), 'zalo-flood-202') ->> 'recorded', 'true', 'a new person is recorded once a row passed 30 days');
select is((select count(*)::integer from app.blocked_signins where zalo_user_id = 'zalo-flood-1'), 0, 'the row older than 30 days was removed, which made room');

select * from finish();
rollback;
