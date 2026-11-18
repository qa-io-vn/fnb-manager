begin;
select plan(67);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004401'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000004402'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000000004401'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000004402'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000004403'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000004404'::uuid as viewer_a,
  'eeeeeeee-eeee-4eee-8eee-000000004405'::uuid as publisher_a,
  'eeeeeeee-eeee-4eee-8eee-000000004406'::uuid as two_tenants,
  'eeeeeeee-eeee-4eee-8eee-000000004407'::uuid as no_member,
  'eeeeeeee-eeee-4eee-8eee-000000004408'::uuid as owner_b,
  'cccccccc-cccc-4ccc-8ccc-000000004401'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000004402'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000004401'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000004402'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000004403'::uuid as store_a3,
  'ffffffff-ffff-4fff-8fff-000000004404'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004401'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004402'::uuid as brand_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004403'::uuid as brand_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004411'::uuid as app_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004412'::uuid as app_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004413'::uuid as app_c;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'zalo-identity-owner-a@example.com'),
    (fx.manager_a, 'zalo-identity-manager-a@example.com'),
    (fx.staff_a, 'zalo-identity-staff-a@example.com'),
    (fx.viewer_a, 'zalo-identity-viewer-a@example.com'),
    (fx.publisher_a, 'zalo-identity-publisher-a@example.com'),
    (fx.two_tenants, 'zalo-identity-two-tenants@example.com'),
    (fx.no_member, 'zalo-identity-no-member@example.com'),
    (fx.owner_b, 'zalo-identity-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_a, 'zalo-it-pgtap-identity-a', 'Zalo identity pgTAP A' from fx
union all
select tenant_b, 'zalo-it-pgtap-identity-b', 'Zalo identity pgTAP B' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'zalo-identity-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'zalo-identity-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'zalo-identity-store-a1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'zalo-identity-store-a2', 'Synthetic store A2' from fx
union all
select store_a3, tenant_a, account_a, 'zalo-identity-store-a3', 'Synthetic store A3' from fx
union all
select store_b1, tenant_b, account_b, 'zalo-identity-store-b1', 'Synthetic store B1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_a, 'owner', null::uuid[]),
    (fx.manager_a, 'manager', array[fx.store_a1]),
    (fx.staff_a, 'staff', null::uuid[]),
    (fx.viewer_a, 'viewer', array[fx.store_a2]),
    (fx.publisher_a, 'publisher', null::uuid[]),
    (fx.two_tenants, 'staff', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_b, two_tenants, 'manager'::public.tenant_role, array[store_b1] from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-944', 'Synthetic brand A', array[store_a1, store_a2] from fx
union all
select brand_b, tenant_b, 'brand-944', 'Synthetic brand B', array[store_b1] from fx
union all
select brand_c, tenant_a, 'brand-945', 'Synthetic brand C', array[store_a3] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-identity-app-a', 'ZALO_APP_SECRET_BRAND_944', 'active' from fx
union all
select app_b, tenant_b, brand_b, 'synthetic-identity-app-b', 'ZALO_APP_SECRET_BRAND_944_B', 'active' from fx
union all
select app_c, tenant_a, brand_c, 'synthetic-identity-app-c', 'ZALO_APP_SECRET_BRAND_945', 'disabled' from fx;

create temp table codes (label text primary key, code text not null);
grant select on fx, codes to authenticated, service_role, anon;

create function pg_temp.event_for(p_user_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'user_id', p_user_id,
    'claims', jsonb_build_object(
      'aud', 'authenticated',
      'exp', 1794970000,
      'iat', 1794966400,
      'sub', p_user_id,
      'email', 'synthetic@example.com',
      'phone', '',
      'role', 'authenticated',
      'aal', 'aal1',
      'session_id', 'aaaaaaaa-0000-4000-8000-000000004401',
      'is_anonymous', false
    ),
    'authentication_method', 'password'
  );
$$;

create function pg_temp.memberships(p_user_id uuid)
returns jsonb
language sql
as $$
  select app.custom_access_token_claims(pg_temp.event_for(p_user_id)) -> 'claims' -> 'memberships';
$$;

create function pg_temp.wrong_code(p_label text)
returns text
language sql
as $$
  select case when code = '000000' then '000001' else '000000' end from codes where label = p_label;
$$;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

select ok(has_function_privilege('supabase_auth_admin', 'app.custom_access_token_claims(jsonb)', 'execute'), 'supabase_auth_admin executes the access-token hook');
select ok(has_schema_privilege('supabase_auth_admin', 'app', 'usage'), 'supabase_auth_admin may use the app schema to reach the hook');
select ok(
  not has_function_privilege('authenticated', 'app.custom_access_token_claims(jsonb)', 'execute')
    and not has_function_privilege('anon', 'app.custom_access_token_claims(jsonb)', 'execute')
    and not has_function_privilege('service_role', 'app.custom_access_token_claims(jsonb)', 'execute'),
  'no API role executes the access-token hook'
);
select is(
  (select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_claims'),
  'true search_path=""',
  'the hook is security definer with an empty search_path'
);

select is(
  pg_temp.memberships((select owner_a from fx)),
  (select jsonb_build_array(jsonb_build_object('tenant_id', tenant_a, 'role', 'owner', 'store_ids', null)) from fx),
  'an owner''s claims carry the tenant, the owner role and every store'
);
select is(
  pg_temp.memberships((select manager_a from fx)),
  (select jsonb_build_array(jsonb_build_object('tenant_id', tenant_a, 'role', 'manager', 'store_ids', jsonb_build_array(store_a1))) from fx),
  'a store-limited manager''s claims carry the manager role and that store only'
);
select is(
  pg_temp.memberships((select staff_a from fx)),
  (select jsonb_build_array(jsonb_build_object('tenant_id', tenant_a, 'role', 'staff', 'store_ids', null)) from fx),
  'a staff member''s claims carry the staff role'
);
select is(
  pg_temp.memberships((select two_tenants from fx)),
  (select jsonb_build_array(
     jsonb_build_object('tenant_id', tenant_a, 'role', 'staff', 'store_ids', null),
     jsonb_build_object('tenant_id', tenant_b, 'role', 'manager', 'store_ids', jsonb_build_array(store_b1))
   ) from fx),
  'a member of two tenants gets one entry per tenant, each with its own role and stores'
);
select is(
  pg_temp.memberships((select no_member from fx)),
  '[]'::jsonb,
  'a login without membership gets an empty list'
);
select is(
  (app.custom_access_token_claims(pg_temp.event_for((select no_member from fx))) -> 'claims') - 'memberships',
  pg_temp.event_for((select no_member from fx)) -> 'claims',
  'the hook keeps every claim it receives'
);
select is(
  app.custom_access_token_claims(
    jsonb_set(pg_temp.event_for((select staff_a from fx)), '{claims,memberships}', (select jsonb_build_array(jsonb_build_object('tenant_id', tenant_b, 'role', 'owner', 'store_ids', null)) from fx))
  ) -> 'claims' -> 'memberships',
  pg_temp.memberships((select staff_a from fx)),
  'memberships sent in the event are replaced by the stored ones'
);
select is(
  app.custom_access_token_claims(jsonb_build_object('user_id', 'not-a-uuid', 'claims', jsonb_build_object('sub', 'x'))) -> 'claims' -> 'memberships',
  '[]'::jsonb,
  'an event without a user id gets an empty list instead of an error'
);

select is(
  (select count(*)::integer from app.zalo_resolve_app('brand-944', null)),
  2,
  'a brand key shared by two tenants resolves to both apps'
);
select is(
  (select array[r.tenant_id::text, r.tenant_slug, r.zalo_app_id::text, r.secret_name, r.status]
   from app.zalo_resolve_app('brand-944', (select tenant_a from fx)) r),
  (select array[tenant_a::text, 'zalo-it-pgtap-identity-a', app_a::text, 'ZALO_APP_SECRET_BRAND_944', 'active'] from fx),
  'the tenant filter resolves one app with its tenant, secret name and status'
);
select is(
  (select count(*)::integer from app.zalo_resolve_app('brand-946', null)),
  0,
  'an unknown brand key resolves to nothing'
);
select is(
  (select r.status from app.zalo_resolve_app('brand-945', null) r),
  'disabled',
  'a disabled Zalo App resolves with its status'
);

select is(
  app.zalo_sign_in((select app_a from fx), 'zalo-user-new'),
  '{"status": "unpaired"}'::jsonb,
  'an unbound identity without a code is unpaired'
);
select is(
  (select count(*)::integer from public.zalo_identities where zalo_user_id = 'zalo-user-new'),
  0,
  'an unpaired sign-in stores no identity'
);

insert into codes select 'manager', app.issue_zalo_binding_code(tenant_a, manager_a, app_a) from fx;
select matches((select code from codes where label = 'manager'), '^[0-9]{6}$', 'a binding code has six digits');
select is(
  (select c.code_sha256 from app.zalo_binding_codes c where c.user_id = (select manager_a from fx)),
  (select app.sha256_hex(app_a::text || ':' || (select code from codes where label = 'manager')) from fx),
  'the code is stored as the sha256 of the app id and the code'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'zalo_binding_codes'),
  array['id', 'tenant_id', 'zalo_app_id', 'user_id', 'code_sha256', 'issued_at', 'expires_at', 'failed_attempts'],
  'no column holds the code itself'
);
select is(
  (select expires_at - issued_at from app.zalo_binding_codes where user_id = (select manager_a from fx)),
  interval '10 minutes',
  'a binding code lives 10 minutes'
);
select ok(
  not has_table_privilege('authenticated', 'app.zalo_binding_codes', 'select')
    and not has_table_privilege('anon', 'app.zalo_binding_codes', 'select')
    and not has_table_privilege('service_role', 'app.zalo_binding_codes', 'select'),
  'no API role reads the binding codes'
);

insert into codes select 'manager-again', app.issue_zalo_binding_code(tenant_a, manager_a, app_a) from fx;
select is(
  (select count(*)::integer from app.zalo_binding_codes where user_id = (select manager_a from fx)),
  1,
  'a new code replaces the member''s previous one'
);
select is(
  (select code_sha256 from app.zalo_binding_codes where user_id = (select manager_a from fx)),
  (select app.zalo_binding_code_hash(app_a, (select code from codes where label = 'manager-again')) from fx),
  'the live code is the newest'
);

select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager', 'Quản lý thử', (select code from codes where label = 'manager-again')) - 'user_id' - 'tenant_id' from fx),
  (select jsonb_build_object('status', 'bound', 'role', 'manager', 'store_ids', jsonb_build_array(store_a1), 'stores', jsonb_build_array('Synthetic store A1'), 'brand_store_ids', jsonb_build_array(store_a1), 'display_name', 'Quản lý thử') from fx),
  'a valid code binds the identity and answers the manager''s role, store scope and store names'
);
select is(
  (select array[tenant_id::text, user_id::text, display_name] from public.zalo_identities where zalo_user_id = 'zalo-user-manager'),
  (select array[tenant_a::text, manager_a::text, 'Quản lý thử'] from fx),
  'the identity is stored with the tenant, the login and the display name'
);
select is(
  (select count(*)::integer from app.zalo_binding_codes where user_id = (select manager_a from fx)),
  0,
  'a used code is gone'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-intruder', null, (select code from codes where label = 'manager-again')) from fx),
  '{"status": "unpaired"}'::jsonb,
  'a used code does not bind a second identity'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager') ->> 'status' from fx),
  'bound',
  'the bound identity signs in again without a code'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager', 'Quản lý mới') ->> 'display_name' from fx),
  'Quản lý mới',
  'a changed Zalo display name is kept'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager', E'Bad\x01name') ->> 'display_name' from fx),
  'Quản lý mới',
  'a display name with a control character is ignored'
);
select is(
  (select app.zalo_sign_in(app_b, 'zalo-user-manager') from fx),
  '{"status": "unpaired"}'::jsonb,
  'the same Zalo user id under another Zalo App is a different identity'
);

delete from app.zalo_binding_codes where zalo_app_id = (select app_a from fx);
insert into codes select 'staff', app.issue_zalo_binding_code(tenant_a, staff_a, app_a) from fx;
select is(
  (select array_agg(app.zalo_sign_in(app_a, 'zalo-user-guess', null, pg_temp.wrong_code('staff')) ->> 'status') from fx, generate_series(1, 5)),
  array['unpaired', 'unpaired', 'unpaired', 'unpaired', 'unpaired'],
  'five wrong codes are refused'
);
select is(
  (select failed_attempts from app.zalo_binding_codes where user_id = (select staff_a from fx)),
  5::smallint,
  'every wrong code counts against the live code'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-staff', null, (select code from codes where label = 'staff')) ->> 'role' from fx),
  'staff',
  'after five wrong attempts the right code still binds'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-staff') -> 'stores' from fx),
  '["Synthetic store A1", "Synthetic store A2"]'::jsonb,
  'a member with every store sees the brand''s stores, not the stores of other brands'
);

insert into codes select 'viewer', app.issue_zalo_binding_code(tenant_a, viewer_a, app_a) from fx;
select is(
  (select array_agg(app.zalo_sign_in(app_a, 'zalo-user-guess', null, pg_temp.wrong_code('viewer')) ->> 'status') from fx, generate_series(1, 6)),
  array['unpaired', 'unpaired', 'unpaired', 'unpaired', 'unpaired', 'unpaired'],
  'six wrong codes are refused'
);
select is(
  (select count(*)::integer from app.zalo_binding_codes where user_id = (select viewer_a from fx)),
  0,
  'the sixth wrong attempt burns the code'
);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-viewer', null, (select code from codes where label = 'viewer')) from fx),
  '{"status": "unpaired"}'::jsonb,
  'a burnt code no longer binds'
);

insert into codes select 'owner-expired', app.issue_zalo_binding_code(tenant_a, owner_a, app_a, now() - interval '11 minutes') from fx;
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-owner', null, (select code from codes where label = 'owner-expired')) from fx),
  '{"status": "unpaired"}'::jsonb,
  'an expired code is refused'
);
select is(
  (select count(*)::integer from app.zalo_binding_codes where user_id = (select owner_a from fx)),
  0,
  'an expired code is removed'
);
insert into codes select 'owner', app.issue_zalo_binding_code(tenant_a, owner_a, app_a, now() - interval '9 minutes') from fx;
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-owner', null, (select code from codes where label = 'owner')) - 'user_id' - 'tenant_id' - 'display_name' from fx),
  (select jsonb_build_object('status', 'bound', 'role', 'owner', 'store_ids', null, 'stores', jsonb_build_array('Synthetic store A1', 'Synthetic store A2'), 'brand_store_ids', jsonb_build_array(store_a1, store_a2)) from fx),
  'a code nine minutes old still binds, and an owner sees every store of the brand'
);

select throws_ok(
  format('select app.issue_zalo_binding_code(%L, %L, %L)', (select tenant_a from fx), (select publisher_a from fx), (select app_a from fx)),
  '22023',
  'a publisher login cannot be bound to a Zalo account',
  'a publisher gets no binding code'
);
select throws_ok(
  format('select app.issue_zalo_binding_code(%L, %L, %L)', (select tenant_a from fx), (select no_member from fx), (select app_a from fx)),
  '22023',
  'the login is not a member of this tenant',
  'a login without membership gets no binding code'
);
select throws_ok(
  format('select app.issue_zalo_binding_code(%L, %L, %L)', (select tenant_a from fx), (select owner_a from fx), (select app_b from fx)),
  '22023',
  'the Zalo App is not an app of this tenant',
  'a code for another tenant''s Zalo App is refused'
);
select throws_ok(
  format('select app.issue_zalo_binding_code(%L, %L, %L)', (select tenant_a from fx), (select owner_a from fx), (select app_c from fx)),
  '22023',
  'the Zalo App is disabled',
  'a disabled Zalo App issues no code'
);
select throws_ok(
  format('select app.zalo_sign_in(%L, %L)', (select app_c from fx), 'zalo-user-owner'),
  '22023',
  'the Zalo App is disabled',
  'a disabled Zalo App signs nobody in'
);
select throws_ok(
  format('select app.zalo_sign_in(%L, %L, null, %L)', (select app_a from fx), 'zalo-user-owner', '12345'),
  '22023',
  'a binding code has six digits',
  'a malformed binding code is refused'
);
select throws_ok(
  format('select app.zalo_sign_in(%L, %L)', (select app_a from fx), 'not a zalo id'),
  '22023',
  'the Zalo user id is malformed',
  'a malformed Zalo user id is refused'
);

insert into codes select 'two-tenants', app.issue_zalo_binding_code(tenant_b, two_tenants, app_b) from fx;
select is(
  (select app.zalo_sign_in(app_b, 'zalo-user-two', null, (select code from codes where label = 'two-tenants')) - 'user_id' - 'display_name' from fx),
  (select jsonb_build_object('status', 'bound', 'tenant_id', tenant_b, 'role', 'manager', 'store_ids', jsonb_build_array(store_b1), 'stores', jsonb_build_array('Synthetic store B1'), 'brand_store_ids', jsonb_build_array(store_b1)) from fx),
  'a member of two tenants signs in to a brand with the role of that brand''s tenant'
);

insert into codes select 'manager-pending', app.issue_zalo_binding_code(tenant_a, manager_a, app_a) from fx;
delete from public.tenant_members where tenant_id = (select tenant_a from fx) and user_id = (select manager_a from fx);
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager') from fx),
  '{"status": "unpaired"}'::jsonb,
  'an identity whose membership was removed is unpaired'
);
select is(
  (select count(*)::integer from app.zalo_binding_codes where user_id = (select manager_a from fx)),
  0,
  'removing the membership removes its pending code'
);
select is(
  (select array[(app.zalo_sign_in(app_a, 'zalo-user-manager', null, (select code from codes where label = 'staff')) ->> 'status')] from fx),
  array['unpaired'],
  'a former member cannot reuse someone else''s spent code'
);
insert into codes select 'rebind', app.issue_zalo_binding_code(tenant_a, staff_a, app_a) from fx;
select is(
  (select app.zalo_sign_in(app_a, 'zalo-user-manager', null, (select code from codes where label = 'rebind')) ->> 'role' from fx),
  'staff',
  'an unpaired identity can be bound again to another member with a new code'
);
select is(
  (select user_id from public.zalo_identities where zalo_app_id = (select app_a from fx) and zalo_user_id = 'zalo-user-manager'),
  (select staff_a from fx),
  'the identity now points at the new login'
);

select ok(
  has_function_privilege('service_role', 'public.zalo_session_app(text, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.zalo_session_sign_in(uuid, text, text, text)', 'execute'),
  'service_role executes the two RPCs of the Edge Functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.zalo_session_app(text, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.zalo_session_sign_in(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.zalo_session_app(text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.zalo_session_sign_in(uuid, text, text, text)', 'execute'),
  'neither authenticated nor anon executes the RPCs'
);
select ok(
  not has_function_privilege('service_role', 'app.issue_zalo_binding_code(uuid, uuid, uuid, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'app.issue_zalo_binding_code(uuid, uuid, uuid, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'app.issue_zalo_binding_code(uuid, uuid, uuid, timestamptz)', 'execute'),
  'only the database owner issues binding codes'
);
select ok(
  not has_function_privilege('authenticated', 'app.zalo_sign_in(uuid, text, text, text, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'app.zalo_sign_in(uuid, text, text, text, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'app.zalo_resolve_app(text, uuid)', 'execute'),
  'authenticated and anon cannot sign in a Zalo identity or resolve apps'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('issue_zalo_binding_code', 'zalo_member_profile', 'zalo_resolve_app', 'zalo_sign_in', 'custom_access_token_claims')
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""')),
  0,
  'the five definer functions pin an empty search_path'
);

set local role service_role;
select is(
  (select count(*)::integer from public.zalo_session_app('brand-944', (select tenant_a from fx))),
  1,
  'service_role resolves a brand through the RPC'
);
select is(
  public.zalo_session_sign_in((select app_a from fx), 'zalo-user-owner') ->> 'role',
  'owner',
  'service_role signs a bound identity in through the RPC'
);
reset role;

set local role authenticated;
select pg_temp.act_as((select owner_b from fx));
select is(
  (select count(*)::integer from public.zalo_identities where tenant_id = (select tenant_a from fx)),
  0,
  'an owner of tenant B reads no Zalo identity of tenant A'
);
select pg_temp.act_as((select owner_a from fx));
select is(
  (select count(*)::integer from public.zalo_identities where tenant_id = (select tenant_a from fx)),
  3,
  'an owner reads the Zalo identities of their tenant'
);
select pg_temp.act_as((select staff_a from fx));
select is(
  (select count(*)::integer from public.zalo_identities),
  0,
  'staff read no Zalo identity, not even their own'
);
reset role;

set local role anon;
select throws_ok('select count(*) from public.zalo_identities', '42501', null, 'anon cannot read zalo_identities');
reset role;

select * from finish();
rollback;
