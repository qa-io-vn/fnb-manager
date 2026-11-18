begin;
select plan(134);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004601'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000004602'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000000004601'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000004602'::uuid as owner_a1,
  'eeeeeeee-eeee-4eee-8eee-000000004603'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000004604'::uuid as manager_a1,
  'eeeeeeee-eeee-4eee-8eee-000000004605'::uuid as manager_a12,
  'eeeeeeee-eeee-4eee-8eee-000000004606'::uuid as staff_x,
  'eeeeeeee-eeee-4eee-8eee-000000004607'::uuid as staff_y,
  'eeeeeeee-eeee-4eee-8eee-000000004608'::uuid as viewer_a,
  'eeeeeeee-eeee-4eee-8eee-000000004609'::uuid as publisher_a,
  'eeeeeeee-eeee-4eee-8eee-000000004610'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000004611'::uuid as no_member,
  'cccccccc-cccc-4ccc-8ccc-000000004601'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000004602'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000004601'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000004602'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000004603'::uuid as store_a3,
  'ffffffff-ffff-4fff-8fff-000000004604'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004601'::uuid as brand_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004602'::uuid as brand_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004611'::uuid as app_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004612'::uuid as app_2,
  'aaaaaaaa-0000-4000-8000-000000004601'::uuid as session_x;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'roster-owner-a@example.com'),
    (fx.owner_a1, 'roster-owner-a1@example.com'),
    (fx.manager_a, 'roster-manager-a@example.com'),
    (fx.manager_a1, 'roster-manager-a1@example.com'),
    (fx.manager_a12, 'roster-manager-a12@example.com'),
    (fx.staff_x, 'roster-staff-x@example.com'),
    (fx.staff_y, 'roster-staff-y@example.com'),
    (fx.viewer_a, 'roster-viewer-a@example.com'),
    (fx.publisher_a, 'roster-publisher-a@example.com'),
    (fx.owner_b, 'roster-owner-b@example.com'),
    (fx.no_member, 'roster-no-member@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_a, 'roster-pgtap-a', 'Roster pgTAP A' from fx
union all
select tenant_b, 'roster-pgtap-b', 'Roster pgTAP B' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'roster-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'roster-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'roster-store-a1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'roster-store-a2', 'Synthetic store A2' from fx
union all
select store_a3, tenant_a, account_a, 'roster-store-a3', 'Synthetic store A3' from fx
union all
select store_b1, tenant_b, account_b, 'roster-store-b1', 'Synthetic store B1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_a, 'owner', null::uuid[]),
    (fx.owner_a1, 'owner', array[fx.store_a1]),
    (fx.manager_a, 'manager', null::uuid[]),
    (fx.manager_a1, 'manager', array[fx.store_a1]),
    (fx.manager_a12, 'manager', array[fx.store_a1, fx.store_a2]),
    (fx.staff_x, 'staff', array[fx.store_a1]),
    (fx.staff_y, 'staff', array[fx.store_a2]),
    (fx.viewer_a, 'viewer', null::uuid[]),
    (fx.publisher_a, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_1, tenant_a, 'brand-961', 'Synthetic brand 1', array[store_a1, store_a2] from fx
union all
select brand_2, tenant_a, 'brand-962', 'Synthetic brand 2', array[store_a1, store_a3] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_1, tenant_a, brand_1, 'synthetic-roster-app-1', 'ZALO_APP_SECRET_BRAND_961', 'active' from fx
union all
select app_2, tenant_a, brand_2, 'synthetic-roster-app-2', 'ZALO_APP_SECRET_BRAND_962', 'active' from fx;

create temp table ids (label text primary key, id uuid not null);
grant select on fx to authenticated, service_role, anon;
grant select, insert on ids to authenticated, service_role, anon;

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

create function pg_temp.visible_as(p_user uuid)
returns text
language plpgsql
as $$
declare
  v_labels text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(i.label, ',' order by i.label collate "C"), '-') into v_labels
  from public.staff_roster r
  join ids i on i.id = r.id;
  return v_labels;
end;
$$;

create function pg_temp.rid(p_label text)
returns uuid
language sql
as $$
  select id from ids where label = p_label;
$$;

create function pg_temp.roster(p_label text)
returns public.staff_roster
language sql
as $$
  select r.* from public.staff_roster r where r.id = (select id from ids where label = p_label);
$$;

create function pg_temp.memberships(p_user_id uuid)
returns jsonb
language sql
as $$
  select app.custom_access_token_claims(jsonb_build_object('user_id', p_user_id, 'claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated'))) -> 'claims' -> 'memberships';
$$;

select has_table('public', 'staff_roster', 'staff_roster exists');
select columns_are(
  'public', 'staff_roster',
  array['id', 'tenant_id', 'display_name', 'role', 'store_ids', 'status', 'user_id', 'paired_at', 'phone', 'phone_hint', 'phone_linked_at',
        'deactivated_at', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  'staff_roster holds the name, role, stores, status, the bound login, the linked phone and the audit columns, and no Zalo user id'
);
select col_type_is('public', 'staff_roster', 'role', 'tenant_role', 'staff_roster.role uses tenant_role');
select col_type_is('public', 'staff_roster', 'store_ids', 'uuid[]', 'staff_roster.store_ids is a uuid array');
select col_default_is('public', 'staff_roster', 'status', 'invited', 'a roster row starts invited');
select fk_ok('public', 'staff_roster', array['tenant_id'], 'public', 'tenants', array['id'], 'staff_roster references its tenant');
select fk_ok('public', 'staff_roster', array['user_id'], 'auth', 'users', array['id'], 'staff_roster references the bound Auth user');
select col_is_unique('public', 'staff_roster', array['tenant_id', 'id'], 'staff_roster is unique on tenant and id for composite references');
select col_is_unique('public', 'staff_roster', array['tenant_id', 'user_id'], 'one roster row per login and tenant, whatever the brand');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.staff_roster'::regclass), 'staff_roster has row level security');
select policies_are('public', 'staff_roster', array['staff_roster_select_for_managers_or_self'], 'staff_roster has one policy, a read policy');
select is(
  (select array_agg(t.tgname::text order by t.tgname) from pg_trigger t where t.tgrelid = 'public.staff_roster'::regclass and not t.tgisinternal),
  array['staff_roster_drop_pairing_codes', 'staff_roster_keep_created_by', 'staff_roster_set_updated_at', 'staff_roster_set_updated_by', 'staff_roster_validate_store_ids'],
  'staff_roster freezes created_by, stamps updated_at and updated_by, checks its stores and drops the pairing code of a deactivated row'
);
select is(
  (select count(*)::integer from pg_trigger t where t.tgrelid = 'public.tenant_members'::regclass and t.tgname = 'tenant_members_deactivate_staff'),
  1,
  'removing a membership deactivates the roster row by trigger'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants where table_schema = 'public' and table_name = 'staff_roster' and grantee in ('anon', 'authenticated')),
  0,
  'neither anon nor authenticated holds a table-wide privilege on staff_roster'
);
select is(
  (select array_agg(c.column_name::text order by c.column_name) from information_schema.column_privileges c
   where c.table_schema = 'public' and c.table_name = 'staff_roster' and c.grantee = 'authenticated' and c.privilege_type = 'SELECT'),
  array['created_at', 'created_by', 'deactivated_at', 'display_name', 'id', 'paired_at', 'phone_hint', 'phone_linked_at', 'role', 'status',
        'store_ids', 'tenant_id', 'updated_at', 'updated_by', 'user_id'],
  'authenticated selects every column but the phone number'
);
select is(
  (select count(*)::integer from information_schema.column_privileges c
   where c.table_schema = 'public' and c.table_name = 'staff_roster' and (c.grantee = 'anon' or (c.grantee = 'authenticated' and c.privilege_type <> 'SELECT'))),
  0,
  'anon holds no column privilege and authenticated may write no column'
);
select ok(not has_column_privilege('authenticated', 'public.staff_roster', 'phone', 'select'), 'authenticated cannot select the phone number');
select is(
  (
    select array_agg(p.proname::text || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('can_manage_staff', 'add_staff', 'update_staff', 'deactivate_staff', 'reactivate_staff', 'deactivate_removed_staff')
  ),
  array['add_staff:true:search_path=""', 'can_manage_staff:true:search_path=""', 'deactivate_removed_staff:true:search_path=""',
        'deactivate_staff:true:search_path=""', 'reactivate_staff:true:search_path=""', 'update_staff:true:search_path=""'],
  'the roster functions in app are security definer with an empty search_path'
);
select is(
  (
    select array_agg(p.proname::text || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('add_staff', 'update_staff', 'deactivate_staff', 'reactivate_staff')
  ),
  array['add_staff:false:search_path=""', 'deactivate_staff:false:search_path=""', 'reactivate_staff:false:search_path=""', 'update_staff:false:search_path=""'],
  'the public wrappers run as the caller with an empty search_path, one signature each'
);
select is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where (n.nspname, p.proname) in (('app', 'can_manage_staff'), ('app', 'add_staff'), ('app', 'update_staff'), ('app', 'deactivate_staff'),
            ('app', 'reactivate_staff'), ('app', 'deactivate_removed_staff'), ('public', 'add_staff'), ('public', 'update_staff'),
            ('public', 'deactivate_staff'), ('public', 'reactivate_staff'))
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  ),
  0,
  'no roster function is executable by public or anon'
);
select ok(
  has_function_privilege('authenticated', 'public.add_staff(uuid, text, public.tenant_role, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.update_staff(uuid, text, public.tenant_role, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.deactivate_staff(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.reactivate_staff(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.can_manage_staff(uuid, uuid[])', 'execute'),
  'authenticated executes the four RPCs and the read helper'
);
select ok(
  not has_function_privilege('service_role', 'public.add_staff(uuid, text, public.tenant_role, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'app.deactivate_staff(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.deactivate_removed_staff()', 'execute')
  and not has_function_privilege('service_role', 'app.deactivate_removed_staff()', 'execute'),
  'the service role calls no roster RPC, and no API role executes the trigger function'
);

set local role authenticated;

select pg_temp.act_as((select owner_a from fx));
insert into ids
select v.label, public.add_staff(fx.tenant_a, v.display_name, v.role::public.tenant_role, v.store_ids)
from fx
cross join lateral (
  values
    ('r_a1', 'Nhân viên 1', 'staff', array[fx.store_a1]),
    ('r_a2', 'Nhân viên 2', 'staff', array[fx.store_a2]),
    ('r_a12', 'Nhân viên 3', 'staff', array[fx.store_a1, fx.store_a2]),
    ('r_all', 'Quản lý 1', 'manager', null::uuid[])
) as v (label, display_name, role, store_ids);

select pg_temp.act_as((select owner_b from fx));
insert into ids select 'r_b1', public.add_staff(tenant_b, 'Nhân viên 1', 'staff', array[store_b1]) from fx;

reset role;

select is(
  (select array_agg(r.status || ':' || (r.created_by = fx.owner_a) || ':' || (r.updated_by = fx.owner_a) || ':' || (r.user_id is null) order by i.label collate "C")
   from public.staff_roster r join ids i on i.id = r.id cross join fx where i.label like 'r_a%'),
  array['invited:true:true:true', 'invited:true:true:true', 'invited:true:true:true', 'invited:true:true:true'],
  'add_staff writes invited rows with created_by and updated_by set to the caller and no login'
);
select is(
  (select array_agg(r.display_name || ':' || r.role || ':' || coalesce(cardinality(r.store_ids)::text, 'all') order by i.label collate "C") from public.staff_roster r join ids i on i.id = r.id where i.label like 'r_a%'),
  array['Nhân viên 1:staff:1', 'Nhân viên 3:staff:2', 'Nhân viên 2:staff:1', 'Quản lý 1:manager:all'],
  'add_staff stores the name, role and stores given'
);

update public.staff_roster r set status = 'active', user_id = fx.staff_x, paired_at = '2026-11-18 01:00+00' from fx where r.id = pg_temp.rid('r_a1');
update public.staff_roster r set status = 'active', user_id = fx.staff_y, paired_at = '2026-11-18 01:00+00' from fx where r.id = pg_temp.rid('r_a2');

set local role authenticated;

select is(pg_temp.visible_as((select owner_a from fx)), 'r_a1,r_a12,r_a2,r_all', 'an unlimited owner reads every roster row of the tenant');
select is(pg_temp.visible_as((select owner_a1 from fx)), 'r_a1', 'a store-limited owner reads the rows whose every store is in scope');
select is(pg_temp.visible_as((select manager_a from fx)), 'r_a1,r_a12,r_a2,r_all', 'an unlimited manager reads every roster row of the tenant');
select is(pg_temp.visible_as((select manager_a1 from fx)), 'r_a1', 'a manager of one store reads only the rows of that store, not a person who also works elsewhere');
select is(pg_temp.visible_as((select manager_a12 from fx)), 'r_a1,r_a12,r_a2', 'a manager of two stores reads the rows within those stores but not a row for every store');
select is(pg_temp.visible_as((select staff_x from fx)), 'r_a1', 'a paired staff member reads only their own row');
select is(pg_temp.visible_as((select staff_y from fx)), 'r_a2', 'another staff member reads only theirs');
select is(pg_temp.visible_as((select viewer_a from fx)), '-', 'a viewer reads no roster row');
select is(pg_temp.visible_as((select publisher_a from fx)), '-', 'the publisher reads no roster row');
select is(pg_temp.visible_as((select owner_b from fx)), 'r_b1', 'another tenant''s owner reads only their own tenant''s row');
select is(pg_temp.visible_as((select no_member from fx)), '-', 'a login without membership reads nothing');
select throws_ok('select phone from public.staff_roster', '42501', null, 'even a manager cannot select the phone number');

select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ insert into ids select 'm_a1', public.add_staff(tenant_a, 'Nhân viên 4', 'staff', array[store_a1]) from fx $q$), 'ok', 'a manager of one store adds staff to that store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ insert into ids select 'm_a1_mgr', public.add_staff(tenant_a, 'Quản lý 2', 'manager', array[store_a1]) from fx $q$), 'ok', 'a manager may grant the manager role within their stores');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'staff', array[store_a2]) from fx $q$), '42501', 'a manager of one store cannot add staff to another store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'staff', array[store_a1, store_a2]) from fx $q$), '42501', 'nor to their store and another');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'staff', null) from fx $q$), '42501', 'nor to every store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'owner', array[store_a1]) from fx $q$), '22023', 'a manager cannot grant owner');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'owner', array[store_a1]) from fx $q$), '22023', 'nor can an owner: a roster role is staff or manager');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'viewer', array[store_a1]) from fx $q$), '22023', 'viewer is not a roster role');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 5', 'publisher', array[store_a1]) from fx $q$), '22023', 'publisher is not a roster role');
select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ insert into ids select 'm_a12', public.add_staff(tenant_a, 'Nhân viên 6', 'staff', array[store_a2, store_a1]) from fx $q$), 'ok', 'a manager of two stores adds staff to both');
select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 7', 'staff', array[store_a1, store_a3]) from fx $q$), '42501', 'but not to a store outside their scope');
select is(pg_temp.outcome_as((select owner_a1 from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 7', 'staff', null) from fx $q$), '42501', 'a store-limited owner cannot grant every store');
select is(pg_temp.outcome_as((select owner_a1 from fx), $q$ insert into ids select 'o_a1', public.add_staff(tenant_a, 'Nhân viên 7', 'staff', array[store_a1]) from fx $q$), 'ok', 'a store-limited owner adds staff to their store');
select is(pg_temp.outcome_as((select manager_a from fx), $q$ insert into ids select 'm_all', public.add_staff(tenant_a, 'Quản lý 3', 'manager', null) from fx $q$), 'ok', 'an unlimited manager may grant every store');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_b1]) from fx $q$), '23503', 'a store of another tenant is refused even for an unlimited owner');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1, store_a1]) from fx $q$), '22023', 'a store listed twice is refused');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', '{}'::uuid[]) from fx $q$), '23514', 'an empty store list is refused');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, '   ', 'staff', array[store_a1]) from fx $q$), '22023', 'a blank name is refused');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ select public.add_staff(tenant_a, E'Nhân\tviên', 'staff', array[store_a1]) from fx $q$), '22023', 'a name with a control character is refused');
select is(pg_temp.outcome_as((select staff_x from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'staff cannot add staff');
select is(pg_temp.outcome_as((select viewer_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'a viewer cannot add staff');
select is(pg_temp.outcome_as((select publisher_a from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'the publisher cannot add staff');
select is(pg_temp.outcome_as((select owner_b from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'another tenant''s owner cannot add staff to this tenant');
select is(pg_temp.outcome_as((select no_member from fx), $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'a login without membership cannot add staff');
select is(pg_temp.outcome_as(null, $q$ select public.add_staff(tenant_a, 'Nhân viên 8', 'staff', array[store_a1]) from fx $q$), '42501', 'a request without a login cannot add staff');

select is(
  (select array_agg(i.label || ':' || (r.created_by = case i.label when 'm_a12' then fx.manager_a12 when 'o_a1' then fx.owner_a1 when 'm_all' then fx.manager_a else fx.manager_a1 end) order by i.label collate "C")
   from public.staff_roster r join ids i on i.id = r.id cross join fx where i.label in ('m_a1', 'm_a1_mgr', 'm_a12', 'o_a1', 'm_all')),
  array['m_a1:true', 'm_a12:true', 'm_a1_mgr:true', 'm_all:true', 'o_a1:true'],
  'every added row names its own writer in created_by'
);
select is(pg_temp.visible_as((select manager_a1 from fx)), 'm_a1,m_a1_mgr,o_a1,r_a1', 'the manager of one store now reads the three rows of that store and the paired one');

select is(
  pg_temp.outcome_as((select owner_a from fx), $q$ insert into public.staff_roster (tenant_id, display_name, role, store_ids, created_by) select tenant_a, 'Nhân viên 9', 'staff', array[store_a1], manager_a from fx $q$),
  '42501',
  'a direct insert, naming another writer or not, is refused'
);
select is(pg_temp.outcome_as((select owner_a from fx), $q$ update public.staff_roster set created_by = (select manager_a from fx) $q$), '42501', 'a direct update of created_by is refused');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ update public.staff_roster set status = 'active' $q$), '42501', 'a direct update of the status is refused');
select is(pg_temp.outcome_as((select owner_a from fx), $q$ delete from public.staff_roster $q$), '42501', 'a direct delete is refused');

reset role;
set local role anon;
select throws_ok('select count(*) from public.staff_roster', '42501', null, 'anon cannot read the roster');
select throws_ok($q$ select public.add_staff('dddddddd-dddd-4ddd-8ddd-000000004601', 'Nhân viên 9', 'staff', null) $q$, '42501', null, 'anon cannot call add_staff');
select throws_ok($q$ select public.deactivate_staff('dddddddd-dddd-4ddd-8ddd-000000004601') $q$, '42501', null, 'anon cannot call deactivate_staff');
reset role;

update public.staff_roster r set created_by = fx.owner_b from fx where r.id = pg_temp.rid('r_a12');
select is((select r.created_by = fx.owner_a from fx, pg_temp.roster('r_a12') r), true, 'the migration role cannot change created_by later');
set local role service_role;
update public.staff_roster r set created_by = null where r.id = (select id from ids where label = 'r_a12');
reset role;
select is((select r.created_by = fx.owner_a from fx, pg_temp.roster('r_a12') r), true, 'nor can the service role, even to null');

set local role authenticated;

select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1', 'manager', array[store_a1]) from fx $q$), 'ok', 'a manager promotes a staff member of their store to manager');
reset role;
select is(
  (select m.role || ':' || array_to_string(m.store_ids, ',') from public.tenant_members m, fx where m.tenant_id = fx.tenant_a and m.user_id = fx.staff_x),
  'manager:' || (select store_a1 from fx),
  'the active row''s membership takes the new role at once'
);
select is((select r.role::text || ':' || (r.updated_by = fx.manager_a1) || ':' || (r.created_by = fx.owner_a) from fx, pg_temp.roster('r_a1') r), 'manager:true:true', 'the row records the editor in updated_by and keeps its creator');
set local role authenticated;
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'staff', array[store_a1]) from fx $q$), 'ok', 'and renames and demotes them again');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'staff', array[store_a2]) from fx $q$), '42501', 'a manager cannot move a person to a store outside their scope');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'staff', null) from fx $q$), '42501', 'nor grant every store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'owner', array[store_a1]) from fx $q$), '22023', 'nor grant owner');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_a12'), 'Nhân viên 3', 'staff', array[store_a1]) from fx $q$), '42501', 'nor change a person who also works in another store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_all'), 'Quản lý 1', 'manager', array[store_a1]) from fx $q$), '42501', 'nor a person of every store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff(pg_temp.rid('r_b1'), 'Nhân viên 1', 'staff', array[store_a1]) from fx $q$), '42501', 'nor a row of another tenant');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.update_staff('00000000-0000-4000-8000-000000004699', 'Nhân viên 1', 'staff', array[store_a1]) from fx $q$), '42501', 'an unknown row is refused like a forbidden one');
select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ select public.update_staff(pg_temp.rid('r_a2'), 'Nhân viên 2', 'staff', array[store_a1, store_a2]) from fx $q$), 'ok', 'a manager of two stores extends a person to both');
reset role;
select is(
  (select array_length(m.store_ids, 1) from public.tenant_members m, fx where m.tenant_id = fx.tenant_a and m.user_id = fx.staff_y),
  2,
  'the extended person''s membership covers both stores at once'
);
set local role authenticated;
select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ select public.update_staff(pg_temp.rid('r_a2'), 'Nhân viên 2', 'staff', array[store_a2]) from fx $q$), 'ok', 'and narrows them back');
select is(pg_temp.outcome_as((select staff_x from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'manager', array[store_a1]) from fx $q$), '42501', 'a staff member cannot change their own row');
select is(pg_temp.outcome_as((select viewer_a from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'staff', array[store_a1]) from fx $q$), '42501', 'a viewer cannot change a row');
select is(pg_temp.outcome_as((select owner_b from fx), $q$ select public.update_staff(pg_temp.rid('r_a1'), 'Nhân viên 1A', 'staff', array[store_a1]) from fx $q$), '42501', 'another tenant''s owner cannot change a row');
reset role;
select is(
  (select r.display_name || ':' || r.role || ':' || (m.role = 'staff') || ':' || (m.store_ids = array[fx.store_a1])
   from fx, pg_temp.roster('r_a1') r join public.tenant_members m on m.tenant_id = r.tenant_id and m.user_id = r.user_id),
  'Nhân viên 1A:staff:true:true',
  'after the refused calls the row and the membership hold the last accepted values'
);

select ok(
  (select count(*) = 0 from public.staff_roster r join ids i on i.id = r.id where r.phone is not null or r.phone_linked_at is not null),
  'no roster function ever stores a phone number'
);

insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_a, app_1, 'synthetic-roster-zalo-x', staff_x, 'Synthetic X' from fx
union all
select tenant_a, app_2, 'synthetic-roster-zalo-x2', staff_x, 'Synthetic X' from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
select tenant_a, 'staff', staff_x, 'staff_ops', 'synthetic-staff-notice-1', 'mini_app', now(), '{"method": "accept_button", "notice_channel": "mini_app"}'::jsonb from fx;

select is(
  (select app.zalo_sign_in(app_1, 'synthetic-roster-zalo-x') ->> 'user_id' from fx) || ':' || (select app.zalo_sign_in(app_2, 'synthetic-roster-zalo-x2') ->> 'user_id' from fx),
  (select staff_x::text || ':' || staff_x::text from fx),
  'a person bound in two brands'' apps signs in to both as the same login'
);
select is((select count(*)::integer from public.staff_roster r, fx where r.tenant_id = fx.tenant_a and r.user_id = fx.staff_x), 1, 'and has one roster row');
select throws_ok(
  $q$ insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
      select tenant_a, 'Nhân viên 1B', 'staff', array[store_a3], 'active', staff_x, now() from fx $q$,
  '23505', null,
  'a second roster row for the same login in the tenant is refused'
);

create temp table consent_x as
select app.ensure_notifications_consent(tenant_a, staff_x, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-17 00:00+00') as id from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select '88888888-8888-4888-8888-000000004601', fx.tenant_a, 'zalo_bot', 'zalo_bot', 'roster staff', fx.staff_x, 'synthetic-chat-4601', 'NOTIFY_ZALO_BOT_TOKEN_IT46', 'active', '2026-11-17 00:00+00', c.id
from fx cross join consent_x c;

create temp table message_x as
select app.enqueue_message(tenant_a, '88888888-8888-4888-8888-000000004601', 'alert', 'alert.v1', 'roster46:staff-x', '{"count": 1}'::jsonb, null, null, 'warning', null, null, null, null, null, '2026-11-17 01:00+00') as id from fx;

select app.issue_zalo_binding_code(tenant_a, staff_x, app_1, now()) is not null from fx;

insert into auth.sessions (id, user_id, created_at, updated_at) select session_x, staff_x, now(), now() from fx;
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at) select 'synthetic-roster-refresh-4601', staff_x::text, session_x, false, now(), now() from fx;

select is(
  (select (select count(*) from public.notification_channels c where c.user_id = fx.staff_x)
        + (select count(*) from public.outbound_messages o where o.subject_id = fx.staff_x)
        + (select count(*) from app.zalo_binding_codes b where b.user_id = fx.staff_x)
        + (select count(*) from auth.sessions s where s.user_id = fx.staff_x)
        + (select count(*) from auth.refresh_tokens t where t.session_id = fx.session_x)
        + (select count(*) from public.zalo_identities i where i.user_id = fx.staff_x)
   from fx)::integer,
  7,
  'before deactivation the person has a destination, a message, a binding code, a session, its refresh token and two Zalo identities'
);

set local role authenticated;
select pg_temp.act_as((select staff_x from fx));
select is((select count(*)::integer from public.stores), 1, 'the paired person reads their store before deactivation');

select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_all')) $q$), '42501', 'a store-limited manager cannot deactivate a person of every store');
select is(pg_temp.outcome_as((select staff_x from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), '42501', 'staff cannot deactivate, not even themselves');
select is(pg_temp.outcome_as((select viewer_a from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), '42501', 'a viewer cannot deactivate');
select is(pg_temp.outcome_as((select publisher_a from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), '42501', 'the publisher cannot deactivate');
select is(pg_temp.outcome_as((select owner_b from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), '42501', 'another tenant''s owner cannot deactivate');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), 'ok', 'the manager of the person''s store deactivates them');

reset role;
select is(
  (select r.status || ':' || (r.deactivated_at is not null) || ':' || (r.user_id = fx.staff_x) || ':' || (r.paired_at is not null) || ':' || (r.updated_by = fx.manager_a1) from fx, pg_temp.roster('r_a1') r),
  'inactive:true:true:true:true',
  'the row is inactive with its deactivation time, keeps the login for a later pairing and names the manager'
);
select is((select count(*)::integer from public.tenant_members m, fx where m.tenant_id = fx.tenant_a and m.user_id = fx.staff_x), 0, 'the membership is removed');
select is((select count(*)::integer from public.notification_channels c, fx where c.user_id = fx.staff_x), 0, 'the destinations are gone with the membership');
select is(
  (select o.recipient_ref || ':' || (o.subject_id is null) from public.outbound_messages o where o.id = (select id from message_x)),
  'redacted:true',
  'the person''s notification rows are redacted'
);
select is((select count(*)::integer from app.zalo_binding_codes b, fx where b.user_id = fx.staff_x), 0, 'the live binding code is gone');
select is((select count(*)::integer from public.zalo_identities i, fx where i.user_id = fx.staff_x), 0, 'the Zalo identities of the person in this tenant are deleted');
select is((select count(*)::integer from auth.sessions s, fx where s.user_id = fx.staff_x), 0, 'every Auth session of the login is revoked');
select is((select count(*)::integer from auth.refresh_tokens t, fx where t.session_id = fx.session_x), 0, 'so no refresh token is left to mint a new access token');
select is((select count(*)::integer from public.consent_records c, fx where c.subject_id = fx.staff_x and c.purpose = 'notifications'), 1, 'the consent ledger outlives the membership');
select is(pg_temp.memberships((select staff_x from fx)), '[]'::jsonb, 'a token minted now carries no membership');
select is((select app.zalo_sign_in(app_1, 'synthetic-roster-zalo-x') ->> 'status' from fx), 'unpaired', 'the next zalo-session call answers unpaired');

set local role authenticated;
select pg_temp.act_as((select staff_x from fx));
select is(
  (select (select count(*) from public.staff_roster) + (select count(*) from public.stores) + (select count(*) from public.tenants) + (select count(*) from public.tenant_members))::integer,
  0,
  'the next request of the session minted before reads nothing: no roster row, store, tenant or member'
);

select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.deactivate_staff(pg_temp.rid('r_a1')) $q$), 'ok', 'deactivating again is accepted');
reset role;
select is((select r.status from pg_temp.roster('r_a1') r), 'inactive', 'and changes nothing');

set local role authenticated;
select is(pg_temp.outcome_as((select viewer_a from fx), $q$ select public.reactivate_staff(pg_temp.rid('r_a1')) $q$), '42501', 'a viewer cannot reactivate');
select is(pg_temp.outcome_as((select manager_a12 from fx), $q$ select public.reactivate_staff(pg_temp.rid('r_all')) $q$), '42501', 'a store-limited manager cannot reactivate a row of every store');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.reactivate_staff(pg_temp.rid('r_a1')) $q$), 'ok', 'the manager reactivates the person');
reset role;
select is(
  (select r.status || ':' || (r.deactivated_at is null) || ':' || (r.paired_at is null) || ':' || (r.user_id = fx.staff_x) from fx, pg_temp.roster('r_a1') r),
  'invited:true:true:true',
  'a reactivated row is invited again and keeps the login'
);
select is((select count(*)::integer from public.tenant_members m, fx where m.tenant_id = fx.tenant_a and m.user_id = fx.staff_x), 0, 'reactivation grants no access before a new pairing');
set local role authenticated;
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.reactivate_staff(pg_temp.rid('r_a1')) $q$), 'ok', 'reactivating a row that is not inactive is accepted');
select is(pg_temp.visible_as((select staff_x from fx)), '-', 'and the person still reads nothing');
select is(pg_temp.outcome_as((select manager_a1 from fx), $q$ select public.deactivate_staff(pg_temp.rid('m_a1')) $q$), 'ok', 'an invited row without a login can be deactivated');
reset role;
select is((select r.status from pg_temp.roster('m_a1') r), 'inactive', 'and is inactive');

select throws_ok(
  $q$ update public.staff_roster set phone = '0901234567', phone_linked_at = now() where id = pg_temp.rid('r_a2') $q$,
  '23514', null,
  'a phone number not in international form is refused'
);
select throws_ok(
  $q$ update public.staff_roster set phone = '+' || '84' || '900000567', phone_linked_at = now() where id = pg_temp.rid('r_a12') $q$,
  '23514', null,
  'a person who has not paired has no phone number'
);
select throws_ok(
  $q$ update public.staff_roster set phone = '+' || '84' || '900000567' where id = pg_temp.rid('r_a2') $q$,
  '23514', null,
  'a phone number comes with the time it was linked'
);
update public.staff_roster set phone = '+' || '84' || '900000567', phone_linked_at = '2026-11-18 02:00+00' where id = pg_temp.rid('r_a2');

set local role authenticated;
select pg_temp.act_as((select manager_a12 from fx));
select is((select r.phone_hint from public.staff_roster r where r.id = pg_temp.rid('r_a2')), '…567', 'a manager sees the phone hint only');
select pg_temp.act_as((select staff_y from fx));
select is((select r.phone_hint from public.staff_roster r), '…567', 'the person sees their own hint');
reset role;

delete from public.tenant_members m using fx where m.tenant_id = fx.tenant_a and m.user_id = fx.staff_y;
select is(
  (select r.status || ':' || (r.deactivated_at is not null) || ':' || (r.phone is null) || ':' || (r.phone_hint is null) from pg_temp.roster('r_a2') r),
  'inactive:true:true:true',
  'removing the membership by another path deactivates the active row and drops its phone'
);
select is((select r.status from pg_temp.roster('r_a12') r), 'invited', 'an invited row is left as it is');

delete from public.tenants where id = (select tenant_b from fx);
select is((select count(*)::integer from public.staff_roster r, fx where r.tenant_id = fx.tenant_b), 0, 'deleting a tenant deletes its roster');

set local request.jwt.claims to '{}';
delete from auth.users where id = (select manager_a1 from fx);
select is(
  (select count(*)::integer from public.staff_roster r join ids i on i.id = r.id where i.label in ('m_a1', 'm_a1_mgr') and r.created_by is null),
  2,
  'removing a writer''s login keeps the rows they wrote and drops their name'
);

select * from finish();
rollback;
