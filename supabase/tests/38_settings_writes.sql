begin;
select plan(106);

create temp table fixture as
select
  'dddddddd-dddd-4ddd-8ddd-000000003801'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003811'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003821'::uuid as store_a,
  'dddddddd-dddd-4ddd-8ddd-000000003822'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000003801'::uuid as other_tenant_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000003811'::uuid as other_account_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000003821'::uuid as other_store,
  'eeeeeeee-eeee-4eee-8eee-000000003801'::uuid as owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000003802'::uuid as manager_id,
  'eeeeeeee-eeee-4eee-8eee-000000003803'::uuid as store_owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000003804'::uuid as store_manager_id,
  'eeeeeeee-eeee-4eee-8eee-000000003805'::uuid as staff_id,
  'eeeeeeee-eeee-4eee-8eee-000000003806'::uuid as viewer_id,
  'eeeeeeee-eeee-4eee-8eee-000000003807'::uuid as publisher_id,
  'eeeeeeee-eeee-4eee-8eee-000000003808'::uuid as other_owner_id;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'settings-owner@example.com'),
    (f.manager_id, 'settings-manager@example.com'),
    (f.store_owner_id, 'settings-store-owner@example.com'),
    (f.store_manager_id, 'settings-store-manager@example.com'),
    (f.staff_id, 'settings-staff@example.com'),
    (f.viewer_id, 'settings-viewer@example.com'),
    (f.publisher_id, 'settings-publisher@example.com'),
    (f.other_owner_id, 'settings-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'settings-pgtap', 'Settings' from fixture
union all
select other_tenant_id, 'settings-pgtap-other', 'Settings Other' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all select f.tenant_id, f.manager_id, 'manager', null from fixture f
union all select f.tenant_id, f.store_owner_id, 'owner', array[f.store_a] from fixture f
union all select f.tenant_id, f.store_manager_id, 'manager', array[f.store_a] from fixture f
union all select f.tenant_id, f.staff_id, 'staff', null from fixture f
union all select f.tenant_id, f.viewer_id, 'viewer', null from fixture f
union all select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'settings-pgtap', 'Settings POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'settings-pgtap-other', 'Settings Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opened_on)
select store_a, tenant_id, account_id, 'settings-a', 'A1', 'Store A', '2024-03-01'::date from fixture
union all
select store_b, tenant_id, account_id, 'settings-b', 'B1', 'Store B', null from fixture
union all
select other_store, other_tenant_id, other_account_id, 'settings-other', 'O1', 'Other Store', null from fixture;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select tenant_id, account_id, 'WALLET', 'Ví', 'other'::public.payment_kind from fixture
union all
select tenant_id, account_id, 'CARD', 'Thẻ', 'card' from fixture;

create function pg_temp.affected_rows(p_statement text)
returns integer
language plpgsql
as $$
declare
  v_rows integer;
begin
  execute p_statement;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant select on fixture to authenticated;

select is(
  (
    select array_agg(m.kind::text || '/' || m.pos_kind::text order by m.external_id)
    from public.payment_methods m
    where m.pos_account_id = (select account_id from fixture)
  ),
  array['card/card', 'other/other'],
  'a payment method written without an override keeps the POS kind in kind and pos_kind'
);

select is(
  (
    select array_agg(c.column_name::text order by c.column_name)
    from information_schema.column_privileges c
    where c.table_schema = 'public' and c.table_name = 'stores'
      and c.grantee = 'authenticated' and c.privilege_type = 'UPDATE'
  ),
  array['code', 'e_invoice_status', 'member_capture_status', 'opened_on', 'opening_hours', 'seat_count', 'tran_no_reset_period'],
  'authenticated may update exactly the seven profile columns of stores'
);

select is(
  (
    select array_agg(c.column_name::text order by c.column_name)
    from information_schema.column_privileges c
    where c.table_schema = 'public' and c.table_name = 'tenants'
      and c.grantee = 'authenticated' and c.privilege_type = 'UPDATE'
  ),
  array['default_language', 'legal_form'],
  'authenticated may update exactly legal_form and default_language of tenants'
);

select is(
  (
    select array_agg(c.column_name::text order by c.column_name)
    from information_schema.column_privileges c
    where c.table_schema = 'public' and c.table_name = 'legal_documents'
      and c.grantee = 'authenticated' and c.privilege_type = 'UPDATE'
  ),
  array['body_markdown', 'title', 'version'],
  'authenticated may update exactly the title, body and version of legal documents'
);

select is(
  (
    select count(*)::int
    from information_schema.column_privileges c
    where c.table_schema = 'public'
      and c.table_name in ('payment_kind_overrides', 'legal_documents')
      and c.grantee = 'anon'
  ),
  0,
  'anon holds no privilege on the payment-kind overrides or the legal documents'
);

select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('apply_payment_kind_override', 'apply_payment_kind_overrides_row', 'stamp_store_profile', 'stamp_tenant_profile', 'freeze_legal_document')
      and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
  ),
  array['apply_payment_kind_override', 'apply_payment_kind_overrides_row', 'freeze_legal_document', 'stamp_store_profile', 'stamp_tenant_profile'],
  'every trigger function of the settings writes pins search_path and is executable by no API role'
);

select is(
  (
    select array_agg(p.proname::text || ':' || pg_get_function_identity_arguments(p.oid) order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_legal_document', 'retire_legal_document')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
  ),
  array['publish_legal_document:p_document_id uuid', 'retire_legal_document:p_document_id uuid'],
  'the two legal RPCs have one signature each, are security definer with an empty search_path and executable by authenticated only'
);

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select throws_ok(
  $$ update public.stores set name = 'Renamed' where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  '42501',
  null,
  'nobody may rename a store: the name stays with the POS'
);

select throws_ok(
  $$ update public.stores set timezone = 'Asia/Bangkok' where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  '42501',
  null,
  'nobody may change a store''s time zone'
);

select throws_ok(
  $$ update public.tenants set name = 'Renamed' where id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $$,
  '42501',
  null,
  'nobody may rename the tenant through the browser'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003802", "role": "authenticated"}';

select lives_ok(
  $$ update public.stores set seat_count = 24, member_capture_status = 'enabled' where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  'a manager with an unlimited scope sets a store''s seats and member feature'
);

select is(
  (select array[s.seat_count::text, s.member_capture_status::text, (s.profile_updated_by = f.manager_id)::text, (s.profile_updated_at = now())::text]
   from public.stores s, fixture f where s.id = f.store_a),
  array['24', 'enabled', 'true', 'true'],
  'the change is saved and stamped with its author and time'
);

select throws_ok(
  $$ update public.stores set opening_hours = '{"mon": [["07:00", "22:00"]]}'::jsonb where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  '42501',
  'opening hours are changed by an owner of the store',
  'a manager may not change opening hours'
);

select throws_ok(
  $$ update public.stores set code = ' a1 ' where id = 'dddddddd-dddd-4ddd-8ddd-000000003822' $$,
  '23505',
  'duplicate key value violates unique constraint "stores_code_unique_in_tenant"',
  'a member may not give a store the code of another store of the tenant, compared trimmed and upper-cased'
);

select lives_ok(
  $$ update public.stores set code = 'B2' where id = 'dddddddd-dddd-4ddd-8ddd-000000003822' $$,
  'a member may give a store a code no other store of the tenant holds'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003804", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.stores set seat_count = 30 where id in ('dddddddd-dddd-4ddd-8ddd-000000003821', 'dddddddd-dddd-4ddd-8ddd-000000003822') $q$),
  1,
  'a store-limited manager changes the profile of their own store only'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003803", "role": "authenticated"}';

select lives_ok(
  $$ update public.stores set opening_hours = '{"mon": [["07:00", "22:00"]]}'::jsonb where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  'a store-limited owner changes the opening hours of their own store'
);

select is(
  pg_temp.affected_rows($q$ update public.stores set opening_hours = '{"tue": [["08:00", "21:00"]]}'::jsonb where id = 'dddddddd-dddd-4ddd-8ddd-000000003822' $q$),
  0,
  'a store-limited owner does not reach another store''s opening hours'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select lives_ok(
  $$ update public.stores set opening_hours = '{"sun": [["09:00", "23:00"]]}'::jsonb where id = 'dddddddd-dddd-4ddd-8ddd-000000003822' $$,
  'an owner with an unlimited scope changes the opening hours of any store'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003805", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.stores set seat_count = 1 $q$),
  0,
  'staff change no store profile'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003806", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.stores set seat_count = 1 $q$),
  0,
  'a viewer changes no store profile'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003807", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.stores set seat_count = 1 $q$),
  0,
  'the publisher changes no store profile'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003808", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.stores set seat_count = 1 $q$),
  1,
  'another tenant''s owner changes only their own stores'
);

select lives_ok(
  $$ update public.stores set code = 'A1' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000003821' $$,
  'a code held by a store of another tenant is free in this tenant'
);

reset role;

set local request.jwt.claims to '{}';

select lives_ok(
  $$ update public.stores set code = 'A1' where id = 'dddddddd-dddd-4ddd-8ddd-000000003822' $$,
  'a code written without a member, as the sync writes, is never refused'
);

select is(
  (select array[s.code, coalesce(s.profile_updated_by::text, '-')] from public.stores s, fixture f where s.id = f.store_b),
  (select array['A1', f.owner_id::text] from fixture f),
  'a write without a member leaves the profile stamp alone'
);

update public.stores set code = 'B2' where id = (select store_b from fixture);

create temp table store_profile_before as
select id, code, opening_hours, seat_count, opened_on, e_invoice_status, tran_no_reset_period, member_capture_status, profile_updated_at, profile_updated_by
from public.stores
where tenant_id = (select tenant_id from fixture);

insert into public.stores (tenant_id, pos_account_id, external_id, name, address, timezone, business_day_start_minutes, opened_on, raw)
select f.tenant_id, f.account_id, v.external_id, v.name, 'POS address', 'Asia/Ho_Chi_Minh', 60, '2025-01-01'::date, '{"from": "pos"}'::jsonb
from fixture f
cross join (values ('settings-a', 'Store A from POS'), ('settings-b', 'Store B from POS')) v (external_id, name)
on conflict (pos_account_id, external_id)
do update set name = excluded.name, address = excluded.address, timezone = excluded.timezone,
  business_day_start_minutes = excluded.business_day_start_minutes, raw = excluded.raw,
  opened_on = coalesce(public.stores.opened_on, excluded.opened_on),
  active = true,
  last_seen_at = now();

select is(
  (
    select count(*)::int
    from public.stores s
    join store_profile_before b on b.id = s.id
    where (s.code, s.opening_hours, s.seat_count, s.e_invoice_status, s.tran_no_reset_period, s.member_capture_status, s.profile_updated_at, s.profile_updated_by)
      is not distinct from (b.code, b.opening_hours, b.seat_count, b.e_invoice_status, b.tran_no_reset_period, b.member_capture_status, b.profile_updated_at, b.profile_updated_by)
  ),
  2,
  'the sync''s store upsert keeps every profile column and stamp the members set'
);

select is(
  (
    select array_agg(s.name || ':' || coalesce(s.opened_on::text, '-') || ':' || s.business_day_start_minutes order by s.external_id)
    from public.stores s
    where s.tenant_id = (select tenant_id from fixture)
  ),
  array['Store A from POS:2024-03-01:60', 'Store B from POS:2025-01-01:60'],
  'the sync still writes the POS columns and keeps an existing opening date'
);

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select lives_ok(
  $$ update public.tenants set legal_form = 'household_business', default_language = 'en' where id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $$,
  'an owner with an unlimited scope sets the legal form and the default language'
);

select is(
  (select array[t.legal_form::text, t.default_language, (t.profile_updated_by = f.owner_id)::text, (t.profile_updated_at = now())::text]
   from public.tenants t, fixture f where t.id = f.tenant_id),
  array['household_business', 'en', 'true', 'true'],
  'the tenant profile is saved and stamped with its author and time'
);

select throws_ok(
  $$ update public.tenants set default_language = 'fr' where id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $$,
  '23514',
  null,
  'the default language is Vietnamese or English'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003802", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.tenants set default_language = 'vi' $q$),
  0,
  'a manager changes no tenant profile'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003803", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ update public.tenants set default_language = 'vi' $q$),
  0,
  'a store-limited owner changes no tenant profile'
);

reset role;

set local request.jwt.claims to '{}';

update public.tenants
set analytics_inputs_version = analytics_inputs_version + 1, analytics_inputs_changed_at = now()
where id = (select tenant_id from fixture);

select is(
  (select t.profile_updated_by = f.owner_id from public.tenants t, fixture f where t.id = f.tenant_id),
  true,
  'a change of the catch-up columns leaves the tenant profile stamp alone'
);

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003802", "role": "authenticated"}';

create temp table version_before as
select analytics_inputs_version as version from public.tenants where id = (select tenant_id from fixture);

select throws_ok(
  $$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind, created_by)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'WALLET', 'ewallet', 'eeeeeeee-eeee-4eee-8eee-000000003801') $$,
  '42501',
  null,
  'an override may not name another member as its creator'
);

select lives_ok(
  $$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind, updated_by)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'WALLET', 'ewallet', 'eeeeeeee-eeee-4eee-8eee-000000003801') $$,
  'a manager with an unlimited scope maps a payment method to a kind'
);

select is(
  (select array[o.created_by = f.manager_id, o.updated_by = f.manager_id] from public.payment_kind_overrides o, fixture f where o.payment_method_external_id = 'WALLET' and o.pos_account_id = f.account_id),
  array[true, true],
  'the override''s creator and last editor are the caller, whatever the request names'
);

select is(
  (select m.kind::text || '/' || m.pos_kind::text from public.payment_methods m, fixture f where m.pos_account_id = f.account_id and m.external_id = 'WALLET'),
  'ewallet/other',
  'the method''s kind follows the override and pos_kind keeps the POS value'
);

select is(
  (
    select array[(t.analytics_inputs_version > b.version)::text, t.analytics_pending_from::text, (t.analytics_pending_to = current_date + 1)::text]
    from public.tenants t, version_before b
    where t.id = (select tenant_id from fixture)
  ),
  array['true', '2023-01-01', 'true'],
  'an override write moves the catch-up version and marks every day pending'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003804", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'CARD', 'other') $$,
  '42501',
  null,
  'a store-limited manager may not map payment methods'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003805", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'CARD', 'other') $$,
  '42501',
  null,
  'staff may not map payment methods'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003806", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'CARD', 'other') $$,
  '42501',
  null,
  'a viewer may not map payment methods'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003807", "role": "authenticated"}';

select is(
  (select count(*)::int from public.payment_kind_overrides),
  0,
  'the publisher reads no payment-kind override'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003808", "role": "authenticated"}';

select is(
  pg_temp.affected_rows($q$ delete from public.payment_kind_overrides $q$),
  0,
  'another tenant''s owner neither sees nor deletes the override'
);

reset role;

set local request.jwt.claims to '{}';

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind, raw, active)
select tenant_id, account_id, 'WALLET', 'Ví điện tử', 'other'::public.payment_kind, '{}'::jsonb, true from fixture
on conflict (pos_account_id, external_id)
do update set name = excluded.name, kind = excluded.kind, raw = excluded.raw, active = excluded.active, last_seen_at = now();

select is(
  (select m.kind::text || '/' || m.pos_kind::text || '/' || m.name from public.payment_methods m, fixture f where m.pos_account_id = f.account_id and m.external_id = 'WALLET'),
  'ewallet/other/Ví điện tử',
  'the override survives an upsert shaped like the sync''s'
);

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind, raw, active)
select tenant_id, account_id, 'WALLET', 'Ví điện tử', 'card'::public.payment_kind, '{}'::jsonb, true from fixture
on conflict (pos_account_id, external_id)
do update set name = excluded.name, kind = excluded.kind, raw = excluded.raw, active = excluded.active, last_seen_at = now();

select is(
  (select m.kind::text || '/' || m.pos_kind::text from public.payment_methods m, fixture f where m.pos_account_id = f.account_id and m.external_id = 'WALLET'),
  'ewallet/card',
  'a new POS classification lands in pos_kind while the override keeps kind'
);

update public.payment_methods
set active = false
where pos_account_id = (select account_id from fixture)
  and external_id = 'WALLET';

select is(
  (select m.kind::text || '/' || m.pos_kind::text || '/' || m.active from public.payment_methods m, fixture f where m.pos_account_id = f.account_id and m.external_id = 'WALLET'),
  'ewallet/card/false',
  'a deactivation by the sync keeps pos_kind and the override'
);

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

truncate version_before;
insert into version_before select analytics_inputs_version from public.tenants where id = (select tenant_id from fixture);

select lives_ok(
  $$ update public.payment_kind_overrides set kind = 'bank_transfer', created_by = 'eeeeeeee-eeee-4eee-8eee-000000003806', updated_by = 'eeeeeeee-eeee-4eee-8eee-000000003806'
     where payment_method_external_id = 'WALLET' $$,
  'an owner changes the override'
);

select is(
  (
    select array[m.kind::text, (o.created_by = f.manager_id)::text, (o.updated_by = f.owner_id)::text, (t.analytics_inputs_version > b.version)::text]
    from public.payment_methods m
    join public.payment_kind_overrides o on o.pos_account_id = m.pos_account_id and o.payment_method_external_id = m.external_id
    join public.tenants t on t.id = m.tenant_id
    cross join fixture f
    cross join version_before b
    where m.pos_account_id = f.account_id and m.external_id = 'WALLET'
  ),
  array['bank_transfer', 'true', 'true', 'true'],
  'the method follows the changed override, the creator stays, the editor is the caller and the version moves'
);

truncate version_before;
insert into version_before select analytics_inputs_version from public.tenants where id = (select tenant_id from fixture);

select lives_ok(
  $$ delete from public.payment_kind_overrides where payment_method_external_id = 'WALLET' $$,
  'an owner deletes the override'
);

select is(
  (
    select array[m.kind::text, m.pos_kind::text, (t.analytics_inputs_version > b.version)::text]
    from public.payment_methods m
    join public.tenants t on t.id = m.tenant_id
    cross join fixture f
    cross join version_before b
    where m.pos_account_id = f.account_id and m.external_id = 'WALLET'
  ),
  array['card', 'card', 'true'],
  'deleting the override restores the POS kind and moves the version'
);

select lives_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, updated_by)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'privacy_notice', 'vi', 'privacy-2026-01', 'Thông báo xử lý dữ liệu', '# Thông báo', 'eeeeeeee-eeee-4eee-8eee-000000003806') $$,
  'an owner with an unlimited scope writes a draft legal text'
);

select is(
  (select array[d.status::text, (d.created_by = f.owner_id)::text, (d.updated_by = f.owner_id)::text] from public.legal_documents d, fixture f where d.version = 'privacy-2026-01'),
  array['draft', 'true', 'true'],
  'the draft names its author as creator and editor, whatever the request names'
);

select throws_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'privacy_notice', 'vi', 'privacy-2026-02', 'T', 'B', 'published', now()) $$,
  '42501',
  null,
  'a legal text cannot be inserted already published'
);

select throws_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, published_at)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'privacy_notice', 'vi', 'privacy-2026-02', 'T', 'B', now()) $$,
  '42501',
  null,
  'a draft cannot carry a publication date'
);

select throws_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'privacy_notice', 'vi', 'Privacy 2026', 'T', 'B') $$,
  '23514',
  null,
  'a version label holds lower-case letters, digits, dots and hyphens only'
);

select throws_ok(
  $$ update public.legal_documents set status = 'published' where version = 'privacy-2026-01' $$,
  '42501',
  null,
  'a member cannot set the status directly'
);

select throws_ok(
  $$ update public.legal_documents set published_at = now() where version = 'privacy-2026-01' $$,
  '42501',
  null,
  'a member cannot set the publication date directly'
);

select lives_ok(
  $$ update public.legal_documents set title = 'Thông báo xử lý dữ liệu cá nhân' where version = 'privacy-2026-01' $$,
  'an owner edits a draft'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003802", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'staff_notice', 'vi', 'staff-2026-01', 'T', 'B') $$,
  '42501',
  null,
  'a manager may not write legal texts'
);

select throws_ok(
  format('select public.publish_legal_document(%L)', (select id from public.legal_documents where version = 'privacy-2026-01')),
  '42501',
  null,
  'a manager may not publish a legal text'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003803", "role": "authenticated"}';

select throws_ok(
  format('select public.publish_legal_document(%L)', (select id from public.legal_documents where version = 'privacy-2026-01')),
  '42501',
  null,
  'a store-limited owner may not publish a legal text'
);

reset role;

create temp table draft as select id from public.legal_documents where version = 'privacy-2026-01';
grant select on draft to authenticated;

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003808", "role": "authenticated"}';

select throws_ok(
  format('select public.publish_legal_document(%L)', (select id from draft)),
  '42501',
  null,
  'another tenant''s owner may not publish the text, and cannot tell it exists'
);

select throws_ok(
  $$ select public.publish_legal_document('00000000-0000-4000-8000-000000000000') $$,
  '42501',
  null,
  'an unknown id raises the same error'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select is(
  public.publish_legal_document((select id from draft)),
  (select id from draft),
  'an owner publishes the draft'
);

select is(
  (select array[d.status::text, (d.published_at = now())::text, (d.updated_by = f.owner_id)::text] from public.legal_documents d, fixture f where d.id = (select id from draft)),
  array['published', 'true', 'true'],
  'the text is published at the database''s clock and the caller is its last editor'
);

select throws_ok(
  $$ update public.legal_documents set title = 'Changed' where version = 'privacy-2026-01' $$,
  '55000',
  'a published legal document is frozen',
  'a published text never changes'
);

select throws_ok(
  format('select public.publish_legal_document(%L)', (select id from draft)),
  '22023',
  null,
  'a published text cannot be published again'
);

select is(
  pg_temp.affected_rows($q$ delete from public.legal_documents where id = (select id from draft) $q$),
  0,
  'a published text cannot be deleted'
);

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
values ((select tenant_id from fixture), 'privacy_notice', 'vi', 'privacy-2026-02', 'Thông báo mới', '# Thông báo mới');

select throws_ok(
  format('select public.retire_legal_document(%L)', (select id from public.legal_documents where version = 'privacy-2026-02')),
  '22023',
  null,
  'a draft cannot be retired'
);

select is(
  public.publish_legal_document((select id from public.legal_documents where version = 'privacy-2026-02')),
  (select id from public.legal_documents where version = 'privacy-2026-02'),
  'publishing a second version of the same kind and language succeeds'
);

select is(
  (
    select array_agg(d.version || ':' || d.status::text || ':' || (d.retired_at is not null) order by d.version)
    from public.legal_documents d
    where d.tenant_id = (select tenant_id from fixture)
  ),
  array['privacy-2026-01:retired:true', 'privacy-2026-02:published:false'],
  'the earlier version is retired in the same call, so one version is published'
);

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
values ((select tenant_id from fixture), 'privacy_notice', 'en', 'privacy-2026-02', 'Privacy notice', '# Privacy');

select is(
  public.publish_legal_document((select id from public.legal_documents where version = 'privacy-2026-02' and language = 'en')),
  (select id from public.legal_documents where version = 'privacy-2026-02' and language = 'en'),
  'a version in the other language is published beside it'
);

select is(
  (select count(*)::int from public.legal_documents d where d.tenant_id = (select tenant_id from fixture) and d.status = 'published'),
  2,
  'one version per kind and language is published'
);

select is(
  public.retire_legal_document((select id from public.legal_documents where version = 'privacy-2026-02' and language = 'vi')),
  (select id from public.legal_documents where version = 'privacy-2026-02' and language = 'vi'),
  'an owner retires the published version'
);

select throws_ok(
  format('select public.retire_legal_document(%L)', (select id from public.legal_documents where version = 'privacy-2026-02' and language = 'vi')),
  '22023',
  null,
  'a retired text cannot be retired again'
);

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
values ((select tenant_id from fixture), 'staff_notice', 'vi', 'staff-2026-01', 'Thông báo nhân viên', '# Nhân viên');

select is(
  pg_temp.affected_rows($q$ delete from public.legal_documents where version = 'staff-2026-01' $q$),
  1,
  'a draft can be deleted'
);

reset role;

select throws_ok(
  $$ update public.legal_documents set status = 'published', retired_at = null where version = 'privacy-2026-01' $$,
  '55000',
  null,
  'not even the service writes a retired text back to published'
);

select throws_ok(
  $$ update public.legal_documents set published_at = published_at - interval '1 day' where version = 'privacy-2026-02' and language = 'en' $$,
  '55000',
  'a legal document keeps its publication date',
  'a published text keeps its publication date'
);

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
values ((select tenant_id from fixture), 'mini_app_terms', 'vi', 'terms-2026-01', 'Điều khoản', '# Điều khoản');

select throws_ok(
  $$ update public.legal_documents set status = 'retired', published_at = now(), retired_at = now() where version = 'terms-2026-01' $$,
  '55000',
  'a legal document moves only from draft to published to retired',
  'a draft cannot skip publication'
);

select throws_ok(
  $$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
     select tenant_id, 'privacy_notice', 'en', 'privacy-2026-03', 'T', 'B', 'published', now() from public.legal_documents where version = 'privacy-2026-02' and language = 'en' $$,
  '23505',
  null,
  'two published versions of one kind and language cannot coexist even when written by the service'
);

set local role anon;

select throws_ok(
  $$ select count(*) from public.legal_documents $$,
  '42501',
  null,
  'anon cannot read legal texts'
);

reset role;

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003802", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind, created_by)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-31', 'Tất niên', 'custom', 'eeeeeeee-eeee-4eee-8eee-000000003801') $$,
  '42501',
  null,
  'a holiday may not name another member as its creator'
);

select lives_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind, updated_by)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-31', 'Tất niên', 'custom', 'eeeeeeee-eeee-4eee-8eee-000000003801') $$,
  'a manager with an unlimited scope adds a tenant holiday'
);

select is(
  (select array[h.created_by = f.manager_id, h.updated_by = f.manager_id] from public.holidays h, fixture f where h.tenant_id = f.tenant_id and h.name = 'Tất niên'),
  array[true, true],
  'the holiday''s creator and editor are the caller, whatever the request names'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select lives_ok(
  $$ update public.holidays set name = 'Tất niên cửa hàng', created_by = 'eeeeeeee-eeee-4eee-8eee-000000003806', updated_by = 'eeeeeeee-eeee-4eee-8eee-000000003806'
     where tenant_id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $$,
  'an owner renames the holiday'
);

select is(
  (select array[h.created_by = f.manager_id, h.updated_by = f.owner_id, h.updated_at = now()] from public.holidays h, fixture f where h.tenant_id = f.tenant_id),
  array[true, true, true],
  'the creator stays and the editor and time follow the change'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003804", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-30', 'Nghỉ', 'custom') $$,
  '42501',
  null,
  'a store-limited manager may not add a tenant holiday'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003805", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-30', 'Nghỉ', 'custom') $$,
  '42501',
  null,
  'staff may not add a tenant holiday'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003807", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-30', 'Nghỉ', 'custom') $$,
  '42501',
  null,
  'the publisher may not add a tenant holiday'
);

reset role;

select is(
  (select count(*)::int from public.holidays where tenant_id is null and (created_by is not null or updated_by is not null)),
  0,
  'the national holidays keep null authors'
);

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

set local role authenticated;

select is(
  array(
    select pg_temp.outcome_as(u, $q$ update public.tenants set default_language = 'vi' where id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $q$)
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003805', 'eeeeeeee-eeee-4eee-8eee-000000003806', 'eeeeeeee-eeee-4eee-8eee-000000003807',
      'eeeeeeee-eeee-4eee-8eee-000000003804', 'eeeeeeee-eeee-4eee-8eee-000000003808'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['rows:0', 'rows:0', 'rows:0', 'rows:0', 'rows:0'],
  'staff, a viewer, the publisher, a store-limited manager and another tenant''s owner change no tenant profile'
);

select is(
  array(
    select pg_temp.outcome_as(u, $q$ insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
      values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'staff_notice', 'vi', 'staff-2026-09', 'T', 'B') $q$)
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003805', 'eeeeeeee-eeee-4eee-8eee-000000003806', 'eeeeeeee-eeee-4eee-8eee-000000003807',
      'eeeeeeee-eeee-4eee-8eee-000000003804', 'eeeeeeee-eeee-4eee-8eee-000000003803', 'eeeeeeee-eeee-4eee-8eee-000000003808'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['42501', '42501', '42501', '42501', '42501', '42501'],
  'staff, a viewer, the publisher, a store-limited manager or owner and another tenant''s owner write no legal text'
);

select is(
  array[
    pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003808', $q$ update public.legal_documents set title = 'Taken' where tenant_id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $q$),
    pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003808', $q$ delete from public.legal_documents where tenant_id = 'dddddddd-dddd-4ddd-8ddd-000000003801' $q$)
  ],
  array['rows:0', 'rows:0'],
  'another tenant''s owner neither edits nor deletes the tenant''s legal texts'
);

reset role;

create temp table english_doc as
select id from public.legal_documents where version = 'privacy-2026-02' and language = 'en';

grant select on english_doc to authenticated;

set local role authenticated;

select is(
  (select count(*)::integer from english_doc),
  1,
  'the published English version is the document the next checks retire'
);

select is(
  array[
    pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003802', format('select public.retire_legal_document(%L)', (select id from english_doc))),
    pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003803', format('select public.retire_legal_document(%L)', (select id from english_doc))),
    pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003808', format('select public.retire_legal_document(%L)', (select id from english_doc)))
  ],
  array['42501', '42501', '42501'],
  'a manager, a store-limited owner and another tenant''s owner may not retire a legal text'
);

select is(
  pg_temp.outcome_as('eeeeeeee-eeee-4eee-8eee-000000003801', format('select public.retire_legal_document(%L)', (select id from english_doc))),
  'rows:1',
  'an owner retires the English version'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select is(
  (select array[d.status::text, (d.retired_at = now())::text] from public.legal_documents d where d.version = 'privacy-2026-02' and d.language = 'en'),
  array['retired', 'true'],
  'a retired text carries the database''s clock'
);

select is(
  array(
    select pg_temp.outcome_as(u, $q$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
      values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-29', 'Nghỉ', 'custom') $q$)
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003806', 'eeeeeeee-eeee-4eee-8eee-000000003803', 'eeeeeeee-eeee-4eee-8eee-000000003808'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['42501', '42501', '42501'],
  'a viewer, a store-limited owner and another tenant''s owner add no tenant holiday'
);

select is(
  array(
    select pg_temp.outcome_as(u, $q$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
      values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'CARD', 'other') $q$)
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003803', 'eeeeeeee-eeee-4eee-8eee-000000003807', 'eeeeeeee-eeee-4eee-8eee-000000003808'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['42501', '42501', '42501'],
  'a store-limited owner, the publisher and another tenant''s owner map no payment method'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

select throws_ok(
  $$ update public.stores set address = 'Elsewhere' where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  '42501',
  null,
  'nobody may change a store''s address: it stays with the POS'
);

select throws_ok(
  $$ update public.stores set business_day_start_minutes = 300 where id = 'dddddddd-dddd-4ddd-8ddd-000000003821' $$,
  '42501',
  null,
  'nobody may change a store''s day start: it fixes the business date of every sale'
);

reset role;

set local role anon;

select is(
  array[
    pg_temp.outcome_as(null, $q$ update public.tenants set default_language = 'vi' $q$),
    pg_temp.outcome_as(null, $q$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
      values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'VN', '2026-12-29', 'Nghỉ', 'custom') $q$),
    pg_temp.outcome_as(null, $q$ insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
      values ('dddddddd-dddd-4ddd-8ddd-000000003801', 'dddddddd-dddd-4ddd-8ddd-000000003811', 'CARD', 'other') $q$),
    pg_temp.outcome_as(null, $q$ update public.stores set seat_count = 1 $q$)
  ],
  array['42501', '42501', '42501', '42501'],
  'anon writes no tenant, holiday, override or store'
);

reset role;

set local request.jwt.claims to '{}';

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
values ((select tenant_id from fixture), 'staff_notice', 'en', 'staff-2026-02', 'Staff notice', '# Staff');

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000003801", "role": "authenticated"}';

update public.legal_documents set title = 'Staff notice, revised' where version = 'staff-2026-02';

reset role;

select is(
  (select array[coalesce(d.created_by::text, '-'), (d.updated_by = f.owner_id)::text] from public.legal_documents d, fixture f where d.version = 'staff-2026-02'),
  array['-', 'true'],
  'an owner editing a draft the service wrote becomes its last editor and never its creator'
);

set local request.jwt.claims to '{}';

select lives_ok(
  $$ delete from auth.users where id in ('eeeeeeee-eeee-4eee-8eee-000000003801', 'eeeeeeee-eeee-4eee-8eee-000000003802') $$,
  'the logins of members who wrote holidays, overrides, legal texts and profiles can be removed'
);

select is(
  (
    select array[
      (select count(*) from public.holidays h where h.tenant_id = f.tenant_id and (h.created_by is not null or h.updated_by is not null)),
      (select count(*) from public.legal_documents d where d.tenant_id = f.tenant_id and (d.created_by is not null or d.updated_by is not null)),
      (select count(*) from public.stores s where s.tenant_id = f.tenant_id and s.profile_updated_by is not null and s.profile_updated_by <> f.store_owner_id),
      (select count(*) from public.tenants t where t.id = f.tenant_id and t.profile_updated_by is not null)
    ]
    from fixture f
  ),
  array[0, 0, 0, 0]::bigint[],
  'their authorship becomes null and every row stays'
);

select * from finish();
rollback;
