begin;
select plan(23);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010401'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000010402'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000010401'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000010402'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000010401'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000010402'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000010411'::uuid as store_y1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010401'::uuid as brand_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010402'::uuid as brand_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010403'::uuid as brand_y,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010411'::uuid as app_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010412'::uuid as app_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010413'::uuid as app_y,
  'eeeeeeee-eeee-4eee-8eee-000000010401'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000010402'::uuid as manager_x2,
  'eeeeeeee-eeee-4eee-8eee-000000010403'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010404'::uuid as staff_both,
  'eeeeeeee-eeee-4eee-8eee-000000010405'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000010406'::uuid as outsider;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-follow-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_x2, fx.staff_x1, fx.staff_both, fx.owner_y, fx.outsider]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notify-follow-pgtap-x', 'Synthetic tenant X' from fx
union all
select tenant_y, 'notify-follow-pgtap-y', 'Synthetic tenant Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notify-follow-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notify-follow-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notify-follow-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_x2, tenant_x, account_x, 'notify-follow-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notify-follow-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_x, owner_x, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_x, manager_x2, 'manager', array[store_x2] from fx
union all
select tenant_x, staff_x1, 'staff', array[store_x1] from fx
union all
select tenant_x, staff_both, 'staff', null from fx
union all
select tenant_y, owner_y, 'owner', null from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_1, tenant_x, 'brand-1', 'Synthetic brand 1', array[store_x1] from fx
union all
select brand_2, tenant_x, 'brand-2', 'Synthetic brand 2', array[store_x2] from fx
union all
select brand_y, tenant_y, 'brand-1', 'Synthetic brand Y', array[store_y1] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_1, tenant_x, brand_1, 'synthetic-follow-app-1', 'ZALO_APP_SECRET_BRAND_1' from fx
union all
select app_2, tenant_x, brand_2, 'synthetic-follow-app-2', 'ZALO_APP_SECRET_BRAND_2' from fx
union all
select app_y, tenant_y, brand_y, 'synthetic-follow-app-y', 'ZALO_APP_SECRET_BRAND_1' from fx;

insert into public.oas (tenant_id, brand_id, external_id, secret_name)
select tenant_x, brand_1, 'synthetic-follow-oa-1', 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select tenant_x, brand_2, 'synthetic-follow-oa-2', 'ZALO_OA_SECRET_BRAND_2' from fx;

insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name, updated_at)
select tenant_x, app_1, 'synthetic-follow-zalo-1', staff_x1, 'Synthetic staff 1', now() - interval '1 day' from fx
union all
select tenant_x, app_1, 'synthetic-follow-zalo-2', staff_both, 'Synthetic staff 2', now() - interval '3 days' from fx
union all
select tenant_x, app_2, 'synthetic-follow-zalo-3', staff_both, 'Synthetic staff 2', now() - interval '1 hour' from fx;

create function pg_temp.follow_as(p_user uuid, p_tenant uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return coalesce(public.my_follow_oa(p_tenant), '-');
exception when others then
  return sqlstate;
end;
$$;

grant select on fx to authenticated, anon;

select has_function('public', 'my_follow_oa', array['uuid'], 'my_follow_oa(uuid) exists');

select is(pg_temp.follow_as((select staff_x1 from fx), (select tenant_x from fx)), 'synthetic-follow-oa-1', 'staff get the OA of the brand whose Mini App they signed in through');
select is(pg_temp.follow_as((select staff_both from fx), (select tenant_x from fx)), 'synthetic-follow-oa-2', 'with two brands, the one they signed in through last');
select is(pg_temp.follow_as((select manager_x2 from fx), (select tenant_x from fx)), 'synthetic-follow-oa-2', 'without a Zalo sign-in, the one OA of the brands of their stores');
select is(pg_temp.follow_as((select owner_x from fx), (select tenant_x from fx)), '-', 'no OA when the stores span two brands and no sign-in tells which');
select is(pg_temp.follow_as((select owner_y from fx), (select tenant_y from fx)), '-', 'no OA when the brand has none');
select is(pg_temp.follow_as((select outsider from fx), (select tenant_x from fx)), '42501', 'a person outside the tenant is refused');
select is(pg_temp.follow_as((select owner_y from fx), (select tenant_x from fx)), '42501', 'another tenant''s owner is refused');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select staff_x1 from fx), 'role', 'authenticated')::text, true);
select is(public.my_follow_oa((select tenant_x from fx)), 'synthetic-follow-oa-1', 'a member reads the OA id through the API role');
select is((select count(*)::int from public.oas), 0, 'while the oas table stays closed to staff');
reset role;

set local role anon;
select throws_ok($q$ select public.my_follow_oa('dddddddd-dddd-4ddd-8ddd-000000010401') $q$, '42501', null, 'anon cannot read the OA id');
reset role;

select is(
  (
    select array_agg(p.proname::text || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('my_notifications', 'start_bot_link', 'set_my_muted_rules', 'stop_my_notifications', 'my_follow_oa')
  ),
  array[
    'my_follow_oa:true:search_path=""',
    'my_notifications:true:search_path=""',
    'set_my_muted_rules:true:search_path=""',
    'start_bot_link:true:search_path=""',
    'stop_my_notifications:true:search_path=""'
  ],
  'the five member functions are security definer with an empty search_path, one signature each'
);
select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('my_notifications', 'start_bot_link', 'set_my_muted_rules', 'stop_my_notifications', 'my_follow_oa')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
      and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
  ),
  array['my_follow_oa', 'my_notifications', 'set_my_muted_rules', 'start_bot_link', 'stop_my_notifications'],
  'each is executable by authenticated only: not by public, anon or the service role'
);
select is(
  (
    select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('notification_member_role', 'bot_link_notice_text', 'member_bot_secret_name', 'issue_link_code', 'withdraw_notifications', 'complete_channel_link', 'accept_channel_link')
      and (
        has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
      )
  ),
  0,
  'the helpers and the service-side linking functions stay closed to the API roles'
);
select ok(
  not has_table_privilege('authenticated', 'app.notification_link_starts', 'select')
  and not has_table_privilege('anon', 'app.notification_link_starts', 'select')
  and not has_table_privilege('service_role', 'app.notification_link_starts', 'select'),
  'the link rate limit is closed to the API roles'
);
select is(
  (
    select array_agg(a.attname::text order by a.attname)
    from pg_attribute a
    where a.attrelid = 'app.notification_link_starts'::regclass and a.attnum > 0 and not a.attisdropped
  ),
  array['starts', 'tenant_id', 'user_id', 'window_started_at'],
  'and keeps only the member, the window start and the count'
);
select ok(
  not has_column_privilege('authenticated', 'public.notification_channels', 'address', 'select')
  and not has_column_privilege('authenticated', 'public.notification_channels', 'secret_name', 'select')
  and not has_column_privilege('authenticated', 'public.notification_channels', 'muted_rules', 'update')
  and not has_table_privilege('authenticated', 'public.notification_channels', 'insert'),
  'members still neither read addresses and secret names nor write destinations directly'
);

-- G-105, ADR-049: store scope belongs to the login, not to the app. One login may span the stores of two brands (it can
-- record a customer at either); a login is refused (42501) at a store outside its scope whatever app it signed in through,
-- and the owner reads the brands of each login on the access page (the web roster). Boundary: the scope is the stores of the
-- login, so the one store of another brand is the first one refused. A refusal is the 42501 of the scope gate itself, which
-- comes before any look at the phone or the member code.
create function pg_temp.checkin_as(p_user uuid, p_store uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform public.staff_record_checkin(p_store, '0900000104', null, null);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
select isnt(pg_temp.checkin_as((select staff_both from fx), (select store_x1 from fx)), '42501', 'a login scoped to the stores of two brands records a customer at the store of brand 1');
select isnt(pg_temp.checkin_as((select staff_both from fx), (select store_x2 from fx)), '42501', 'and at the store of brand 2: one login may span brands, the app only chooses which one it lists');
select isnt(pg_temp.checkin_as((select staff_x1 from fx), (select store_x1 from fx)), '42501', 'a login scoped to one store records a customer there');
select is(pg_temp.checkin_as((select staff_x1 from fx), (select store_x2 from fx)), '42501', 'the same login is refused at the store of the other brand, whatever app it signed in through');
select is(pg_temp.checkin_as((select manager_x2 from fx), (select store_x1 from fx)), '42501', 'a manager of brand 2''s store is refused at brand 1''s store');
select is(pg_temp.checkin_as((select outsider from fx), (select store_x1 from fx)), '42501', 'a login with no membership in the tenant is refused at every store');

select * from finish();
rollback;
