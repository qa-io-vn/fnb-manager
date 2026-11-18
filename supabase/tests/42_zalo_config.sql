begin;
select plan(125);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004201'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000004202'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000000004201'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000004202'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000004203'::uuid as store_owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000004204'::uuid as store_manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000004205'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000004206'::uuid as viewer_a,
  'eeeeeeee-eeee-4eee-8eee-000000004207'::uuid as publisher_a,
  'eeeeeeee-eeee-4eee-8eee-000000004208'::uuid as owner_b,
  'cccccccc-cccc-4ccc-8ccc-000000004201'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000004202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000004201'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000004202'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000004203'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004201'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004202'::uuid as brand_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004203'::uuid as brand_a2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004204'::uuid as brand_b2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004211'::uuid as app_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004212'::uuid as app_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004221'::uuid as oa_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004222'::uuid as oa_b;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'zalo-owner-a@example.com'),
    (fx.manager_a, 'zalo-manager-a@example.com'),
    (fx.store_owner_a, 'zalo-store-owner-a@example.com'),
    (fx.store_manager_a, 'zalo-store-manager-a@example.com'),
    (fx.staff_a, 'zalo-staff-a@example.com'),
    (fx.viewer_a, 'zalo-viewer-a@example.com'),
    (fx.publisher_a, 'zalo-publisher-a@example.com'),
    (fx.owner_b, 'zalo-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_a, 'zalo-it-pgtap-a', 'Zalo pgTAP A' from fx
union all
select tenant_b, 'zalo-it-pgtap-b', 'Zalo pgTAP B' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'zalo-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'zalo-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'zalo-pgtap-store-a1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'zalo-pgtap-store-a2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'zalo-pgtap-store-b1', 'Synthetic store B1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_a, 'owner', null::uuid[]),
    (fx.manager_a, 'manager', null::uuid[]),
    (fx.store_owner_a, 'owner', array[fx.store_a1]),
    (fx.store_manager_a, 'manager', array[fx.store_a1]),
    (fx.staff_a, 'staff', null::uuid[]),
    (fx.viewer_a, 'viewer', null::uuid[]),
    (fx.publisher_a, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx
union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx
union all
select brand_b2, tenant_b, 'brand-2', 'Synthetic brand B2', array[store_b1] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_a, tenant_a, brand_a, 'synthetic-app-a', 'ZALO_APP_SECRET_BRAND_1' from fx
union all
select app_b, tenant_b, brand_b, 'synthetic-app-b', 'ZALO_APP_SECRET_BRAND_1' from fx;

insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, package_expires_on, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-oa-a', 'tang_truong', date '2027-06-30', true, 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_b, tenant_b, brand_b, 'synthetic-oa-b', 'co_ban', null::date, false, 'ZALO_OA_SECRET_BRAND_1' from fx;

insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'staff', 'synthetic-mini-a-staff', false, 'Quán Mẫu Nội Bộ', 'Nội bộ', 'Staff', '#1F6F4A', '#0E2A1F', 'white', 'white' from fx
union all
select tenant_a, brand_a, 'customer', 'synthetic-mini-a-customer', true, 'Quán Mẫu Thành Viên', 'Thành viên', 'Members', '#FFFFFF', '#121212', 'black', 'white' from fx
union all
select tenant_b, brand_b, 'customer', 'synthetic-mini-b-customer', true, 'Quán Thử Thành Viên', 'Thành viên', 'Members', '#FFFFFF', '#121212', 'black', 'white' from fx;

insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose)
select tenant_a, oa_a, 'synthetic-template-a', 'customer_care', 'voucher_issued' from fx
union all
select tenant_b, oa_b, 'synthetic-template-b', 'transaction', 'otp' from fx;

insert into public.gmf_groups (tenant_id, oa_id, external_id, store_ids)
select tenant_a, oa_a, 'synthetic-group-a', array[store_a1] from fx
union all
select tenant_b, oa_b, 'synthetic-group-b', array[store_b1] from fx;

insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_a, app_a, 'synthetic-zalo-user-a', staff_a, 'Synthetic staff' from fx
union all
select tenant_b, app_b, 'synthetic-zalo-user-b', owner_b, 'Synthetic owner' from fx;

insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token, refresh_expires_at)
select tenant_a, brand_a, 'oa', 'synthetic-oa-access-a', now() + interval '25 hours', 'synthetic-oa-refresh-a', now() + interval '90 days' from fx
union all
select tenant_a, brand_a, 'developer', 'synthetic-dev-access-a', now() + interval '1 hour', 'synthetic-dev-refresh-a', now() + interval '30 days' from fx
union all
select tenant_b, brand_b, 'oa', 'synthetic-oa-access-b', now() + interval '25 hours', 'synthetic-oa-refresh-b', null::timestamptz from fx;

grant select on fx to authenticated, service_role, anon;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.visible()
returns integer[]
language sql
as $$
  select array[
    (select count(*)::integer from public.brands where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.zalo_apps where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.oas where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.mini_apps where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.zbs_templates where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.gmf_groups where tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
    (select count(*)::integer from public.zalo_identities where tenant_id in ((select tenant_a from fx), (select tenant_b from fx)))
  ];
$$;

create function pg_temp.oa_mode(p_oa_id uuid)
returns text
language sql
security definer
as $$
  select o.webhook_mode from public.oas o where o.id = p_oa_id;
$$;

create function pg_temp.brand_row(p_brand_id uuid)
returns text
language sql
security definer
as $$
  select row(b.display_name, b.created_by, b.updated_by)::text from public.brands b where b.id = p_brand_id;
$$;

create function pg_temp.row_count(p_table text, p_tenant_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  execute format('select count(*)::integer from public.%I where tenant_id = $1', p_table) into v_count using p_tenant_id;
  return v_count;
end;
$$;

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'zalo_identities', 'zalo_tokens')),
  array['brands', 'gmf_groups', 'mini_apps', 'oas', 'zalo_apps', 'zalo_identities', 'zalo_tokens', 'zbs_templates'],
  'the eight Zalo tables exist with row level security enabled'
);
select columns_are(
  'public', 'zalo_identities',
  array['id', 'tenant_id', 'zalo_app_id', 'zalo_user_id', 'user_id', 'display_name', 'created_at', 'updated_at'],
  'zalo_identities holds only the per-app user id, the display name and the Auth user link'
);
select columns_are(
  'public', 'zalo_tokens',
  array['id', 'tenant_id', 'brand_id', 'kind', 'access_token', 'access_expires_at', 'refresh_token', 'refresh_expires_at', 'refreshed_at', 'version', 'updated_at'],
  'zalo_tokens holds the token pair with expiries, refreshed_at and the version'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups')
     and column_name in ('tenant_id', 'created_by', 'updated_by')),
  18,
  'each configuration table carries tenant_id, created_by and updated_by'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'zalo_identities', 'zalo_tokens')
     and column_name ~ '(phone|avatar|location|address|email|birth|gender)'),
  0,
  'no Zalo table has a phone, avatar, location, address, e-mail, birth date or gender column'
);
select is(
  (select array_agg(c.table_name::text || '.' || c.column_name::text order by c.table_name, c.column_name)
   from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups')
     and c.column_name like '%secret%'),
  array['oas.secret_name', 'zalo_apps.secret_name'],
  'the only secret columns of the configuration are the two secret names'
);
select fk_ok('public', 'zalo_apps', array['tenant_id', 'brand_id'], 'public', 'brands', array['tenant_id', 'id'], 'zalo_apps references its brand with the tenant');
select fk_ok('public', 'oas', array['tenant_id', 'brand_id'], 'public', 'brands', array['tenant_id', 'id'], 'oas references its brand with the tenant');
select fk_ok('public', 'mini_apps', array['tenant_id', 'brand_id'], 'public', 'brands', array['tenant_id', 'id'], 'mini_apps references its brand with the tenant');
select fk_ok('public', 'zbs_templates', array['tenant_id', 'oa_id'], 'public', 'oas', array['tenant_id', 'id'], 'zbs_templates references its OA with the tenant');
select fk_ok('public', 'gmf_groups', array['tenant_id', 'oa_id'], 'public', 'oas', array['tenant_id', 'id'], 'gmf_groups references its OA with the tenant');
select fk_ok('public', 'zalo_identities', array['tenant_id', 'zalo_app_id'], 'public', 'zalo_apps', array['tenant_id', 'id'], 'zalo_identities references its Zalo App with the tenant');
select fk_ok('public', 'zalo_tokens', array['tenant_id', 'brand_id'], 'public', 'brands', array['tenant_id', 'id'], 'zalo_tokens references its brand with the tenant');

select ok(not has_table_privilege('authenticated', 'public.zalo_tokens', 'select, insert, update, delete, truncate, references, trigger'), 'authenticated holds no privilege on zalo_tokens');
select ok(not has_table_privilege('anon', 'public.zalo_tokens', 'select, insert, update, delete, truncate, references, trigger'), 'anon holds no privilege on zalo_tokens');
select ok(
  has_table_privilege('service_role', 'public.zalo_tokens', 'select')
    and has_table_privilege('service_role', 'public.zalo_tokens', 'insert')
    and has_table_privilege('service_role', 'public.zalo_tokens', 'update')
    and has_table_privilege('service_role', 'public.zalo_tokens', 'delete'),
  'service_role reads and writes zalo_tokens'
);
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'zalo_tokens'), 0, 'zalo_tokens has no policy');
select is(
  (select count(*)::integer from information_schema.column_privileges where table_schema = 'public' and table_name = 'zalo_tokens' and grantee in ('anon', 'authenticated')),
  0,
  'no API role holds a column privilege on zalo_tokens'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'
     and table_name in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'zalo_identities', 'zalo_tokens')),
  0,
  'anon holds no privilege on the Zalo tables'
);
select is(
  (select array_agg(distinct table_name::text order by table_name::text)
   from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and table_name in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'zalo_identities', 'zalo_tokens')),
  array['brands', 'gmf_groups', 'mini_apps', 'oas', 'zalo_apps', 'zbs_templates'],
  'authenticated writes the six configuration tables and neither identities nor tokens'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups')
     and cmd in ('INSERT', 'UPDATE', 'DELETE')
     and coalesce(qual, '') || coalesce(with_check, '') like '%has_store_scope(tenant_id, NULL::uuid, ARRAY[''owner''%'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%manager%'),
  18,
  'every write policy of the configuration is for owners with an unlimited scope'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename in ('brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'zalo_identities')
     and cmd = 'SELECT'
     and qual like '%has_tenant_role(tenant_id, ARRAY[''owner''::%, ''manager''::%])%'),
  7,
  'owners and managers read the configuration and the identities'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename in ('zalo_identities', 'zalo_tokens')
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no browser write policy on identities or tokens'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('zalo_secret_name_valid', 'mini_app_title_valid', 'validate_zalo_store_ids', 'bump_zalo_token_version')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array['mini_app_title_valid', 'zalo_secret_name_valid'],
  'authenticated executes the two check helpers and neither trigger function'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('zalo_secret_name_valid', 'mini_app_title_valid', 'validate_zalo_store_ids', 'bump_zalo_token_version')
     and (has_function_privilege('anon', p.oid, 'execute') or p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""')),
  0,
  'the four functions are closed to anon, run as the caller and set an empty search_path'
);

select is(
  array[
    app.zalo_secret_name_valid('ZALO_APP_SECRET_BRAND_1', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_OA_SECRET_BRAND_12', 'ZALO_OA_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_IT', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET__1', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_BRAND_1_', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_OA_SECRET_BRAND_1', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('zalo_app_secret_brand_1', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('NOTIFY_ZALO_BOT_TOKEN', 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_' || repeat('B', 45), 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_' || repeat('Q', 17), 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_' || repeat('A1', 5), 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid('ZALO_APP_SECRET_' || repeat('7', 13), 'ZALO_APP_SECRET_'),
    app.zalo_secret_name_valid(null, 'ZALO_APP_SECRET_')
  ],
  array[true, true, true, false, false, false, false, false, false, false, false, false, false, false],
  'secret names: the ZALO_ pattern with the column''s prefix, no empty segment, no value-shaped segment'
);
select is(
  array[
    app.mini_app_title_valid('Quán Mẫu Nội Bộ'),
    app.mini_app_title_valid('Happy Quán Mẫu'),
    app.mini_app_title_valid('Abc'),
    app.mini_app_title_valid(repeat('a', 50)),
    app.mini_app_title_valid('Ab'),
    app.mini_app_title_valid(repeat('a', 51)),
    app.mini_app_title_valid('Quán Mẫu Zalo'),
    app.mini_app_title_valid('ZaloQuán Mẫu'),
    app.mini_app_title_valid('Quán Mẫu App'),
    app.mini_app_title_valid('Quán Mẫu app'),
    app.mini_app_title_valid('Mini App Quán Mẫu'),
    app.mini_app_title_valid('QuánMẫuApp'),
    app.mini_app_title_valid('Quán Mẫu Apps'),
    app.mini_app_title_valid('QUÁN MẪU NỘI BỘ'),
    app.mini_app_title_valid(' Quán Mẫu'),
    app.mini_app_title_valid(null)
  ],
  array[true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false],
  'titles: 3 to 50 characters, not all capitals, no Zalo, App or Mini App'
);

set local role anon;
select throws_ok($$ select count(*) from public.brands $$, '42501', null, 'anon cannot read brands');
select throws_ok($$ select count(*) from public.zalo_apps $$, '42501', null, 'anon cannot read zalo_apps');
select throws_ok($$ select count(*) from public.oas $$, '42501', null, 'anon cannot read oas');
select throws_ok($$ select count(*) from public.mini_apps $$, '42501', null, 'anon cannot read mini_apps');
select throws_ok($$ select count(*) from public.zbs_templates $$, '42501', null, 'anon cannot read zbs_templates');
select throws_ok($$ select count(*) from public.gmf_groups $$, '42501', null, 'anon cannot read gmf_groups');
select throws_ok($$ select count(*) from public.zalo_identities $$, '42501', null, 'anon cannot read zalo_identities');
select throws_ok($$ select count(*) from public.zalo_tokens $$, '42501', null, 'anon cannot read zalo_tokens');
select throws_ok($$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_a, 'brand-9', 'anon', array[store_a1] from fx $$, '42501', null, 'anon cannot write brands');
reset role;

set local role authenticated;

select pg_temp.act_as((select owner_a from fx));
select is(pg_temp.visible(), array[1, 1, 1, 2, 1, 1, 1], 'unlimited owner: the configuration and identities of the own tenant only');
select throws_ok($$ select count(*) from public.zalo_tokens $$, '42501', null, 'unlimited owner cannot read the token store');
select throws_ok($$ update public.zalo_tokens set access_token = 'x' $$, '42501', null, 'unlimited owner cannot write the token store');
select throws_ok($$ insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token) select tenant_a, brand_a, 'oa', 'x', now(), 'y' from fx $$, '42501', null, 'unlimited owner cannot insert into the token store');

select pg_temp.act_as((select manager_a from fx));
select is(pg_temp.visible(), array[1, 1, 1, 2, 1, 1, 1], 'unlimited manager reads the same rows as the owner');
select throws_ok($$ select count(*) from public.zalo_tokens $$, '42501', null, 'unlimited manager cannot read the token store');

select pg_temp.act_as((select store_owner_a from fx));
select is(pg_temp.visible(), array[1, 1, 1, 2, 1, 1, 1], 'store-limited owner reads the configuration');

select pg_temp.act_as((select store_manager_a from fx));
select is(pg_temp.visible(), array[1, 1, 1, 2, 1, 1, 1], 'store-limited manager reads the configuration');

select pg_temp.act_as((select staff_a from fx));
select is(pg_temp.visible(), array[0, 0, 0, 0, 0, 0, 0], 'staff read nothing, not even their own identity');
select throws_ok($$ select count(*) from public.zalo_tokens $$, '42501', null, 'staff cannot read the token store');

select pg_temp.act_as((select viewer_a from fx));
select is(pg_temp.visible(), array[0, 0, 0, 0, 0, 0, 0], 'viewer reads nothing');

select pg_temp.act_as((select publisher_a from fx));
select is(pg_temp.visible(), array[0, 0, 0, 0, 0, 0, 0], 'publisher reads nothing');

select pg_temp.act_as((select owner_b from fx));
select is(pg_temp.visible(), array[2, 1, 1, 1, 1, 1, 1], 'owner of another tenant: only that tenant''s rows');
select is(
  (select count(*)::integer from public.brands where tenant_id = (select tenant_a from fx))
    + (select count(*)::integer from public.zalo_apps where tenant_id = (select tenant_a from fx))
    + (select count(*)::integer from public.zalo_identities where tenant_id = (select tenant_a from fx)),
  0,
  'a member of tenant B reads no row of tenant A'
);

select pg_temp.act_as((select owner_a from fx));
select lives_ok(
  $$ insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a2, tenant_a, 'brand-2', 'Synthetic brand A2', array[store_a2] from fx $$,
  'unlimited owner adds a second brand'
);
select lives_ok(
  $$ insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name) select tenant_a, brand_a2, 'synthetic-app-a2', 'ZALO_APP_SECRET_BRAND_2' from fx $$,
  'unlimited owner adds its Zalo App'
);
select lives_ok(
  $$ insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
     select tenant_a, brand_a2, 'customer', 'synthetic-mini-a2-customer', true, 'Happy Quán Mẫu', 'Thành viên', 'Members', '#FFFFFF', '#121212', 'black', 'white' from fx $$,
  'unlimited owner adds a Mini App whose title only contains the letters app inside a word'
);
select is(
  pg_temp.brand_row((select brand_a2 from fx)),
  row('Synthetic brand A2', (select owner_a from fx), (select owner_a from fx))::text,
  'created_by and updated_by are the owner'
);
select lives_ok($$ update public.oas set webhook_mode = 'enforce' where id = (select oa_a from fx) $$, 'unlimited owner switches the OA to enforce');
select is(pg_temp.oa_mode((select oa_a from fx)), 'enforce', 'the switch is stored');
update public.brands set created_by = (select manager_a from fx), display_name = 'Renamed brand A2' where id = (select brand_a2 from fx);
select is(
  pg_temp.brand_row((select brand_a2 from fx)),
  row('Renamed brand A2', (select owner_a from fx), (select owner_a from fx))::text,
  'created_by stays frozen on update while the other columns change'
);
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids, created_by) select tenant_a, 'brand-3', 'Forged', array[store_a1], manager_a from fx $$,
  '42501', null,
  'unlimited owner cannot write a brand in someone else''s name'
);
select throws_ok(
  $$ insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name) select tenant_b, brand_b2, 'synthetic-app-b2', 'ZALO_APP_SECRET_BRAND_2' from fx $$,
  '42501', null,
  'unlimited owner cannot write a Zalo App of another tenant'
);
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_b, 'brand-3', 'Other tenant', array[store_b1] from fx $$,
  '23503', null,
  'unlimited owner cannot write a brand of another tenant, whose stores it cannot see'
);
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_a, 'brand-3', 'Foreign store', array[store_b1] from fx $$,
  '23503', null,
  'unlimited owner cannot cover a store of another tenant'
);
select throws_ok(
  $$ insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id) select tenant_a, app_a, 'synthetic-zalo-user-x', owner_a from fx $$,
  '42501', null,
  'unlimited owner cannot bind an identity from the browser'
);
update public.oas set webhook_mode = 'enforce' where id = (select oa_b from fx);
delete from public.zalo_apps where tenant_id = (select tenant_b from fx);
select is(
  array[pg_temp.oa_mode((select oa_b from fx)), pg_temp.row_count('zalo_apps', (select tenant_b from fx))::text],
  array['observe', '1'],
  'unlimited owner can neither change nor delete another tenant''s rows'
);
select lives_ok($$ delete from public.gmf_groups where tenant_id = (select tenant_a from fx) $$, 'unlimited owner deletes a staff group');
select is(pg_temp.row_count('gmf_groups', (select tenant_a from fx)), 0, 'the delete is stored');

select pg_temp.act_as((select manager_a from fx));
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_a, 'brand-3', 'Manager brand', array[store_a1] from fx $$,
  '42501', null,
  'unlimited manager cannot add a brand'
);
select throws_ok(
  $$ insert into public.gmf_groups (tenant_id, oa_id, external_id, store_ids) select tenant_a, oa_a, 'synthetic-group-m', array[store_a1] from fx $$,
  '42501', null,
  'unlimited manager cannot add a staff group'
);
update public.oas set webhook_mode = 'observe' where id = (select oa_a from fx);
select is(pg_temp.oa_mode((select oa_a from fx)), 'enforce', 'unlimited manager cannot change the webhook mode');
delete from public.zalo_apps where tenant_id = (select tenant_a from fx);
select is(pg_temp.row_count('zalo_apps', (select tenant_a from fx)), 2, 'unlimited manager cannot delete a Zalo App');

select pg_temp.act_as((select store_owner_a from fx));
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_a, 'brand-3', 'Store owner brand', array[store_a1] from fx $$,
  '42501', null,
  'store-limited owner cannot add a brand'
);
update public.oas set webhook_mode = 'observe' where id = (select oa_a from fx);
select is(pg_temp.oa_mode((select oa_a from fx)), 'enforce', 'store-limited owner cannot change the webhook mode');

select pg_temp.act_as((select staff_a from fx));
select throws_ok(
  $$ insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose) select tenant_a, oa_a, 'synthetic-template-s', 'promotion', 'win_back' from fx $$,
  '42501', null,
  'staff cannot add a template'
);
delete from public.mini_apps where tenant_id = (select tenant_a from fx);
select is(pg_temp.row_count('mini_apps', (select tenant_a from fx)), 3, 'staff cannot delete a Mini App');

select pg_temp.act_as((select publisher_a from fx));
select throws_ok(
  $$ insert into public.oas (tenant_id, brand_id, external_id, secret_name) select tenant_a, brand_a2, 'synthetic-oa-p', 'ZALO_OA_SECRET_BRAND_2' from fx $$,
  '42501', null,
  'publisher cannot add an OA'
);

reset role;
set local role service_role;
select is((select count(*)::integer from public.zalo_tokens where tenant_id = (select tenant_a from fx)), 2, 'service_role reads the token store');
select lives_ok($$ update public.zalo_tokens set access_token = 'synthetic-oa-access-a2', refreshed_at = now() where brand_id = (select brand_a from fx) and kind = 'oa' $$, 'service_role writes the token store');
reset role;

select is(
  (select version from public.zalo_tokens where brand_id = (select brand_a from fx) and kind = 'oa'),
  2::bigint,
  'an update moves the token version by one'
);
update public.zalo_tokens set version = 40 where brand_id = (select brand_a from fx) and kind = 'oa';
select is(
  (select version from public.zalo_tokens where brand_id = (select brand_a from fx) and kind = 'oa'),
  3::bigint,
  'the version cannot be set, only moved'
);
select is(
  (select version from public.zalo_tokens where brand_id = (select brand_a from fx) and kind = 'developer'),
  1::bigint,
  'the other token row keeps its version'
);

select throws_ok(
  $$ insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name) select tenant_a, brand_a, 'synthetic-app-dup', 'ZALO_APP_SECRET_BRAND_1' from fx $$,
  '23505', null,
  'a brand has one Zalo App'
);
select throws_ok(
  $$ insert into public.oas (tenant_id, brand_id, external_id, secret_name) select tenant_a, brand_a, 'synthetic-oa-dup', 'ZALO_OA_SECRET_BRAND_1' from fx $$,
  '23505', null,
  'a brand has one OA'
);
select throws_ok(
  $$ insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
     select tenant_a, brand_a, 'staff', 'synthetic-mini-dup', false, 'Quán Mẫu Thứ Hai', 'Nội bộ', 'Staff', '#1F6F4A', '#0E2A1F', 'white', 'white' from fx $$,
  '23505', null,
  'a brand has one staff Mini App'
);
select throws_ok(
  $$ insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id) select tenant_a, app_a, 'synthetic-zalo-user-a', manager_a from fx $$,
  '23505', null,
  'a Zalo user id is bound once per Zalo App'
);
select lives_ok(
  $$ insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id) select tenant_b, app_b, 'synthetic-zalo-user-a', owner_b from fx $$,
  'the same user id under another Zalo App is another identity'
);
select throws_ok(
  $$ insert into public.brands (tenant_id, brand_key, display_name, store_ids) select tenant_a, 'brand-1', 'Duplicate key', array[store_a1] from fx $$,
  '23505', null,
  'the brand key is unique in the tenant'
);

select throws_ok(
  $$ insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name) select tenant_a, brand_b2, 'synthetic-app-x', 'ZALO_APP_SECRET_BRAND_9' from fx $$,
  '23503', null,
  'a Zalo App of tenant A cannot hang off a brand of tenant B'
);
select throws_ok(
  $$ insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
     select tenant_b, brand_a2, 'staff', 'synthetic-mini-x', false, 'Quán Mẫu Thứ Ba', 'Nội bộ', 'Staff', '#1F6F4A', '#0E2A1F', 'white', 'white' from fx $$,
  '23503', null,
  'a Mini App of tenant B cannot hang off a brand of tenant A'
);
select throws_ok(
  $$ insert into public.gmf_groups (tenant_id, oa_id, external_id, store_ids) select tenant_a, oa_b, 'synthetic-group-x', array[store_a1] from fx $$,
  '23503', null,
  'a staff group of tenant A cannot hang off an OA of tenant B'
);
select throws_ok(
  $$ insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose) select tenant_b, oa_a, 'synthetic-template-x', 'promotion', 'win_back' from fx $$,
  '23503', null,
  'a template of tenant B cannot hang off an OA of tenant A'
);
select throws_ok(
  $$ insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id) select tenant_a, app_b, 'synthetic-zalo-user-x', owner_a from fx $$,
  '23503', null,
  'an identity of tenant A cannot hang off a Zalo App of tenant B'
);
select throws_ok(
  $$ insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token) select tenant_a, brand_b, 'developer', 'x', now(), 'y' from fx $$,
  '23503', null,
  'a token row of tenant A cannot hang off a brand of tenant B'
);
select throws_ok(
  $$ insert into public.gmf_groups (tenant_id, oa_id, external_id, store_ids) select tenant_a, oa_a, 'synthetic-group-y', array[store_b1] from fx $$,
  '23503', null,
  'a staff group cannot serve a store of another tenant, even for a role that bypasses row level security'
);
select throws_ok(
  $$ update public.brands set store_ids = array[store_a1, store_b1] from fx where id = fx.brand_a $$,
  '23503', null,
  'a brand cannot be widened to a store of another tenant'
);
select throws_ok(
  $$ update public.brands set store_ids = array[store_a1, store_a1] from fx where id = fx.brand_a $$,
  '22023', null,
  'a brand cannot list a store twice'
);
select throws_ok(
  $$ update public.brands set store_ids = '{}' from fx where id = fx.brand_a $$,
  '23514', null,
  'a brand covers at least one store'
);
select throws_ok(
  $$ update public.brands set brand_key = 'tra-sua-nha-an' from fx where id = fx.brand_a $$,
  '23514', null,
  'a brand key is neutral (brand-<n>)'
);

select throws_ok(
  $$ update public.zalo_apps set secret_name = 'zalo_app_secret_brand_1' from fx where id = fx.app_a $$,
  '23514', null,
  'a lower-case secret name is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'eyJ' || encode(convert_to('{"alg":"HS256"}', 'utf8'), 'base64') || '.e30.' || md5('synthetic') from fx where id = fx.app_a $$,
  '23514', null,
  'a JWT where a secret name is expected is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'https://example.com/secret' from fx where id = fx.app_a $$,
  '23514', null,
  'a URL where a secret name is expected is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'ZALO_APP_SECRET_' || upper(md5('synthetic')) from fx where id = fx.app_a $$,
  '23514', null,
  'a long hex value behind the prefix is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'ZALO_APP_SECRET_' || encode(convert_to('synthetic value', 'utf8'), 'base64') from fx where id = fx.app_a $$,
  '23514', null,
  'a base64 value behind the prefix is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'ZALO_APP_SECRET_' || repeat('Q', 24) from fx where id = fx.app_a $$,
  '23514', null,
  'a long upper-case value behind the prefix is refused'
);
select throws_ok(
  $$ update public.zalo_apps set secret_name = 'ZALO_OA_SECRET_BRAND_1' from fx where id = fx.app_a $$,
  '23514', null,
  'a Zalo App cannot name the OA secret'
);
select throws_ok(
  $$ update public.oas set secret_name = 'ZALO_APP_SECRET_BRAND_1' from fx where id = fx.oa_a $$,
  '23514', null,
  'an OA cannot name the App secret'
);
select throws_ok(
  $$ update public.oas set secret_name = 'ZALO_OA_SECRET_' || repeat('9', 10) from fx where id = fx.oa_a $$,
  '23514', null,
  'an OA secret name cannot carry a numeric id'
);
select throws_ok(
  $$ update public.oas set webhook_mode = 'strict' from fx where id = fx.oa_a $$,
  '23514', null,
  'the webhook mode is observe or enforce'
);
select throws_ok(
  $$ update public.oas set package_tier = 'premium' from fx where id = fx.oa_a $$,
  '23514', null,
  'the package tier is one of the four current packages'
);
select is((select webhook_mode from public.oas where id = (select oa_b from fx)), 'observe', 'a new OA starts in observe mode');
select throws_ok(
  $$ update public.zalo_apps set status = 'paused' from fx where id = fx.app_a $$,
  '23514', null,
  'a Zalo App is active or disabled'
);
select throws_ok(
  $$ update public.zalo_apps set external_id = 'synthetic app' from fx where id = fx.app_a $$,
  '23514', null,
  'a Zalo App id has no spaces'
);

select throws_ok(
  $$ update public.mini_apps set title = 'Quán Mẫu Zalo' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title containing Zalo is refused'
);
select throws_ok(
  $$ update public.mini_apps set title = 'Quán Mẫu App' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title containing App is refused'
);
select throws_ok(
  $$ update public.mini_apps set title = 'Mini App Quán Mẫu' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title containing Mini App is refused'
);
select throws_ok(
  $$ update public.mini_apps set title = 'QUÁN MẪU NỘI BỘ' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title in capitals only is refused'
);
select throws_ok(
  $$ update public.mini_apps set title = 'Qu' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title under 3 characters is refused'
);
select throws_ok(
  $$ update public.mini_apps set title = repeat('Quán ', 11) || 'X' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a title over 50 characters is refused'
);
select throws_ok(
  $$ update public.mini_apps set browsable = true from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'the staff Mini App is never browsable'
);
select throws_ok(
  $$ update public.mini_apps set browsable = false from fx where brand_id = fx.brand_a and kind = 'customer' $$,
  '23514', null,
  'the customer Mini App is browsable'
);
select throws_ok(
  $$ update public.mini_apps set header_color_dark = 'navy' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a header colour is a hex colour'
);
select throws_ok(
  $$ update public.mini_apps set text_color_light = 'red' from fx where brand_id = fx.brand_a and kind = 'staff' $$,
  '23514', null,
  'a header text colour is black or white'
);
select throws_ok(
  $$ update public.zbs_templates set tag = 'tag_4' from fx where oa_id = fx.oa_a $$,
  '23514', null,
  'a template tag is transaction, customer care or promotion'
);
select throws_ok(
  $$ update public.gmf_groups set purpose = 'customers' from fx where oa_id = fx.oa_b $$,
  '23514', null,
  'a staff group''s purpose is staff'
);
select throws_ok(
  $$ update public.zalo_identities set display_name = repeat('n', 101) from fx where zalo_app_id = fx.app_a $$,
  '23514', null,
  'a display name is at most 100 characters'
);

delete from public.brands where id = (select brand_a from fx);
select is(
  array[
    pg_temp.row_count('zalo_apps', (select tenant_a from fx)),
    pg_temp.row_count('oas', (select tenant_a from fx)),
    pg_temp.row_count('mini_apps', (select tenant_a from fx)),
    pg_temp.row_count('zbs_templates', (select tenant_a from fx)),
    pg_temp.row_count('zalo_identities', (select tenant_a from fx)),
    pg_temp.row_count('zalo_tokens', (select tenant_a from fx))
  ],
  array[1, 0, 1, 0, 0, 0],
  'deleting a brand removes its app, OA, Mini Apps, templates, identities and tokens and leaves the other brand'
);
delete from auth.users where id = (select owner_a from fx);
select is(
  (select created_by from public.brands where id = (select brand_a2 from fx)),
  null::uuid,
  'removing the author''s login keeps the brand and drops its name'
);

select * from finish();
rollback;
