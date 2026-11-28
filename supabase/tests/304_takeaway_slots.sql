-- Takeaway pick-up slots (C17, migration takeaway_slots, ADR-072): the one day a customer may book, its slots on the
-- server clock in the store's zone, why a slot cannot be booked (passed, full), "Càng sớm có thể", the next opening when
-- the store is closed, closures and the business-day start, the slot settings and who writes them, and the reads.
-- Techniques: boundary value analysis of the instant against the preparation time, the last pick-up (closing less one
-- slot), the closing, the opening and the business-day start (C17-U1: 14:05, 22:29, 22:30, 22:31, 22:45, 23:00, 03:59,
-- 05:00, 06:50, 07:00; an overnight store at 01:00, 01:46 and 02:00); the next opening across days (C17-U2: a closed
-- weekday, a closure, the overnight store); equivalence partitions of a slot's capacity (C17-U3: 0, limit - 1 and
-- limit places taken, a hold whose window passed) and of the ordering state (accepting, closed, ordering_off, paused,
-- no_staff_online, hours_unknown); boundary values of the settings (slot 5..60 dividing an hour, limit 1..100); and
-- object-level authorisation (who writes the settings, who reads the slots, no API role on the internal functions).
begin;
select plan(69);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030401'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030402'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030401'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030402'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030401'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030403'::uuid as store_a3,
  'ffffffff-ffff-4fff-8fff-000000030409'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030401'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030402'::uuid as brand_b,
  '99999999-9999-4999-8999-000000030401'::uuid as app_a,
  '99999999-9999-4999-8999-000000030402'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000030401'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030402'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030403'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030404'::uuid as manager_a3_u,
  'eeeeeeee-eeee-4eee-8eee-000000030405'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000030406'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000030411'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000030412'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030413'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000030419'::uuid as custb_u;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030451'), ('item_ta', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030401'), ('ta', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030411'),
  ('cat_b', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030452'), ('item_b', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030409'), ('tb', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030419');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'takeaway-304-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.staff_u, null), (fx.manager_a3_u, null), (fx.viewer_u, null), (fx.owner_b_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'takeaway-304-a', 'Takeaway 304 A' from fx union all
select tenant_b, 'takeaway-304-b', 'Takeaway 304 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'takeaway-304-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'takeaway-304-b', 'Synthetic account B' from fx;
-- A1 opens 07:00-23:00 Monday to Saturday and never on Sunday, its business day starting at 04:00; A3 opens overnight,
-- 18:00-02:00 every day, also from 04:00; B1 is another tenant's.
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, address, business_day_start_minutes, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name, 'Synthetic street 1', 240, s.hours
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 't304-a1', 'ta-1', 'Synthetic store A1',
    '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]], "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]]}'::jsonb),
  (fx.store_a3, fx.tenant_a, fx.account_a, 't304-a3', 'ta-3', 'Synthetic store A3',
    '{"mon": [["18:00", "02:00"]], "tue": [["18:00", "02:00"]], "wed": [["18:00", "02:00"]], "thu": [["18:00", "02:00"]], "fri": [["18:00", "02:00"]], "sat": [["18:00", "02:00"]], "sun": [["18:00", "02:00"]]}'::jsonb),
  (fx.store_b1, fx.tenant_b, fx.account_b, 't304-b1', 'tb-1', 'Synthetic store B1',
    '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]], "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]], "sun": [["07:00", "23:00"]]}'::jsonb)
) as s (id, tenant, account, ext, code, name, hours);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.staff_u, 'staff', array[fx.store_a1]),
  (fx.manager_a3_u, 'manager', array[fx.store_a3]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a3] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-304-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-304-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-304-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-304-2', cust2_u from fx union all
select tenant_a, app_a, 'syn-zalo-304-3', cust3_u from fx union all
select tenant_b, app_b, 'syn-zalo-304-9', custb_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required,
  prep_minutes, takeaway_slot_limit)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15, 2 from fx union all
select store_a3, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15, 2 from fx union all
select store_b1, tenant_b, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15, 2 from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx union all
select pg_temp.id('cat_b'), tenant_b, brand_b, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_ta'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê mang đi', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_b'), tenant_b, brand_b, pg_temp.id('cat_b'), 'Món B', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('ta'), tenant_a, brand_a, pg_temp.id('item_ta'), null, 40000, 10, true from fx union all
select pg_temp.id('tb'), tenant_b, brand_b, pg_temp.id('item_b'), null, 20000, 10, true from fx;

-- Helpers. Instants are written in the store's zone (+07); answers are read as local times.
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create function pg_temp.local(p_at timestamptz) returns text language sql immutable as $$ select to_char(p_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') $$;
create function pg_temp.slots(p_store uuid, p_at text) returns jsonb language sql stable as $$ select app.takeaway_slots(p_store, pg_temp.at(p_at)) $$;
create function pg_temp.first_free(p_answer jsonb) returns text language sql immutable as $$
  select pg_temp.local((s ->> 'start')::timestamptz) from jsonb_array_elements(p_answer -> 'slots') s where (s ->> 'available')::boolean order by (s ->> 'start')::timestamptz limit 1
$$;
create function pg_temp.slot(p_answer jsonb, p_local text) returns text language sql immutable as $$
  select coalesce((s ->> 'available') || ':' || coalesce(s ->> 'reason', '-'), 'absent')
  from (select 1) d left join lateral (select s from jsonb_array_elements(p_answer -> 'slots') s where pg_temp.local((s ->> 'start')::timestamptz) = p_local) x on true
$$;
create function pg_temp.claims(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
$$;
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.place(p_user uuid, p_pickup text, p_at text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    v := app.customer_place_order(jsonb_build_object('request_id', gen_random_uuid(), 'store', 'ta-1', 'type', 'takeaway', 'payment', 'vietqr',
      'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('ta'), 'qty', 1)), 'expected_total', 40000,
      'pickup_at', to_char(pg_temp.at(p_pickup) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), pg_temp.at(p_at));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.rows_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.claims(p_user);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v;
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

-- 1. C17-U1: the open store, prep 15 and slot 15 (boundary values of the instant) ---------------------------------
create temp table open_1405 as select pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05') as a;
select is((select a ->> 'state' from open_1405), 'ok', 'Friday 14:05, open: the slots are answered');
select is((select a ->> 'date' from open_1405), '2026-11-27', 'the day offered is today');
select is((select pg_temp.first_free(a) from open_1405), '2026-11-27 14:30', 'now 14:05 with 15 minutes to prepare: the first slot is 14:30');
select is((select pg_temp.local((a ->> 'asap_at')::timestamptz) from open_1405), '2026-11-27 14:20', '"Càng sớm có thể" is 14:20, now plus the preparation time');
select is((select pg_temp.slot(a, '2026-11-27 14:15') from open_1405), 'false:passed', 'boundary: 14:15 is before 14:20 and has passed');
select is((select pg_temp.slot(a, '2026-11-27 07:00') from open_1405), 'false:passed', 'the morning''s slots are listed as passed');
select is((select jsonb_array_length(a -> 'slots') from open_1405), 64, 'the day holds 64 slots of 15 minutes, 07:00 to 22:45');
select is((select pg_temp.local((a ->> 'last_pickup_at')::timestamptz) || ' ' || pg_temp.local((a ->> 'opens_at')::timestamptz) || ' ' || pg_temp.local((a ->> 'closes_at')::timestamptz) from open_1405),
  '2026-11-27 22:45 2026-11-27 07:00 2026-11-27 23:00', 'the last pick-up is the closing less one slot (22:45); the day opens 07:00 and closes 23:00');
select is((select (a ->> 'pre_order')::boolean from open_1405), false, 'while the store is open the slots are not a pre-order');
select is((select (a ->> 'prep_minutes') || '/' || (a ->> 'slot_minutes') from open_1405), '15/15', 'the answer carries the preparation and slot minutes');
select is(pg_temp.first_free(pg_temp.slots((select store_a1 from fx), '2026-11-27 22:29')), '2026-11-27 22:45', 'boundary: at 22:29 the last slot 22:45 is still free (22:44 earliest)');
select is(pg_temp.first_free(pg_temp.slots((select store_a1 from fx), '2026-11-27 22:30')), '2026-11-27 22:45', 'boundary: at 22:30 the last slot 22:45 is exactly now plus 15 and still free');
create temp table open_2231 as select pg_temp.slots((select store_a1 from fx), '2026-11-27 22:31') as a;
select is((select a ->> 'date' || ' ' || pg_temp.first_free(a) from open_2231), '2026-11-28 2026-11-28 07:00', 'boundary: at 22:31 no slot is left today, so tomorrow from the opening (07:00)');
select is((select (a ->> 'pre_order')::boolean from open_2231), false, 'the store still takes orders at 22:31, so this is not yet a pre-order');
select is((select pg_temp.local((a ->> 'asap_at')::timestamptz) from open_2231), '2026-11-27 22:46', 'and "Càng sớm có thể" is still offered while it is open');
select is(pg_temp.first_free(pg_temp.slots((select store_a1 from fx), '2026-11-27 22:45')), '2026-11-28 07:00', 'at 22:45 the slots are tomorrow''s');
create temp table closed_2300 as select pg_temp.slots((select store_a1 from fx), '2026-11-27 23:00') as a;
select is((select (a ->> 'pre_order')::boolean || ' ' || coalesce(a ->> 'asap_at', 'null') from closed_2300), 'true null', 'boundary: at 23:00 the store is closed: a pre-order, no "Càng sớm"');
select is((select a ->> 'date' || ' ' || pg_temp.first_free(a) from closed_2300), '2026-11-28 2026-11-28 07:00', 'closed: Saturday''s slots from its opening, 07:00 bookable');
select is((select a -> 'ordering' ->> 'reason' from closed_2300), 'closed_now', 'the answer carries the ordering state''s reason');
select is(pg_temp.first_free(pg_temp.slots((select store_a1 from fx), '2026-11-28 03:59')), '2026-11-28 07:00', 'day start boundary: at 03:59 (still Friday''s business day) the next opening is Saturday 07:00');
select is((pg_temp.slots((select store_a1 from fx), '2026-11-28 05:00')) ->> 'date', '2026-11-28', 'at 05:00 (Saturday''s business day) the slots are today''s, from 07:00');
create temp table closed_0650 as select pg_temp.slots((select store_a1 from fx), '2026-11-28 06:50') as a;
select is((select pg_temp.first_free(a) from closed_0650), '2026-11-28 07:15', 'at 06:50 the opening is too close to prepare for: the first slot is 07:15');
select is((select pg_temp.slot(a, '2026-11-28 07:00') from closed_0650), 'false:passed', 'and 07:00 is listed as passed');
select is(pg_temp.first_free(pg_temp.slots((select store_a1 from fx), '2026-11-28 07:00')), '2026-11-28 07:15', 'boundary: at the opening (07:00) the first slot is 07:15');

-- 2. C17-U2: the next opening across days ---------------------------------------------------------------------------
select is((pg_temp.slots((select store_a1 from fx), '2026-11-28 23:30')) ->> 'date', '2026-11-30', 'Saturday night: the store never opens on Sunday, so Monday');
insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason)
select tenant_a, store_a1, date '2026-11-30', date '2026-11-30', 'Synthetic closure' from fx;
select is((pg_temp.slots((select store_a1 from fx), '2026-11-28 23:30')) ->> 'date', '2026-12-01', 'with Monday closed, Tuesday');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-28 23:30'), '2026-11-30 08:00'), 'absent', 'a closed date has no slot at all');
create temp table closure_day as select pg_temp.slots((select store_a1 from fx), '2026-11-30 10:00') as a;
select is((select (a ->> 'pre_order')::boolean || ' ' || (a -> 'ordering' ->> 'reason') || ' ' || (a ->> 'date') from closure_day), 'true closed_today 2026-12-01',
  'on the closed day itself the next bookable day is Tuesday, as a pre-order');
delete from public.ordering_closures where store_id = (select store_a1 from fx);
create temp table night_0100 as select pg_temp.slots((select store_a3 from fx), '2026-11-28 01:00') as a;
select is((select a ->> 'date' || ' ' || pg_temp.first_free(a) from night_0100), '2026-11-27 2026-11-28 01:15', 'an overnight store at 01:00: Friday''s business day, next slot 01:15');
select is((select pg_temp.local((a ->> 'last_pickup_at')::timestamptz) from night_0100), '2026-11-28 01:45', 'its last pick-up is 01:45, one slot before 02:00');
select is((select jsonb_array_length(a -> 'slots') from night_0100), 32, 'its business day holds 32 slots, 18:00 to 01:45');
select is(pg_temp.first_free(pg_temp.slots((select store_a3 from fx), '2026-11-28 01:46')), '2026-11-28 18:00', 'at 01:46 nothing is left before closing: Saturday 18:00');
select is((pg_temp.slots((select store_a3 from fx), '2026-11-28 02:00')) ->> 'pre_order', 'true', 'boundary: at 02:00 it is closed and the slots are a pre-order');

-- 3. C17-U3: capacity (limit 2: 0, limit - 1, limit) and holds -------------------------------------------------------
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05'), '2026-11-27 15:00'), 'true:-', 'no place taken: 15:00 is free');
select is((pg_temp.place((select cust1_u from fx), '2026-11-27 15:00', '2026-11-27 14:05')) ->> 'state', 'awaiting_payment', 'a customer books 15:00 and pays online');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:06'), '2026-11-27 15:00'), 'true:-', 'one of two places taken (limit - 1): still free');
select is((pg_temp.place((select cust2_u from fx), '2026-11-27 15:00', '2026-11-27 14:06')) ->> 'state', 'awaiting_payment', 'a second customer books it');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:07'), '2026-11-27 15:00'), 'false:full', 'both places taken (the limit): Hết chỗ');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:07'), '2026-11-27 15:15'), 'true:-', 'the next slot is unaffected');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:14:59'), '2026-11-27 15:00'), 'false:full', 'boundary: at 14:14:59 the first hold (placed 14:05) still holds');
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:15'), '2026-11-27 15:00'), 'true:-', 'boundary: at 14:15, 10 minutes on, its window passed and the place is free again, before any job runs');
update public.store_ordering_settings set takeaway_slot_limit = 1 where store_id = (select store_a1 from fx);
select is(pg_temp.slot(pg_temp.slots((select store_a1 from fx), '2026-11-27 14:15'), '2026-11-27 15:00'), 'false:full', 'a manager lowers the limit to 1: the one live hold fills it');
update public.store_ordering_settings set takeaway_slot_limit = 2 where store_id = (select store_a1 from fx);

-- 4. The ordering state decides whether there are slots at all -------------------------------------------------------
update public.store_ordering_settings set order_types = array['table'] where store_id = (select store_a1 from fx);
select is((pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05')) ->> 'refusal', 'ordering_off', 'a store that takes no takeaway answers ordering_off and no slot');
update public.store_ordering_settings set order_types = array['table', 'takeaway'], paused_until = pg_temp.at('2026-11-27 15:00') where store_id = (select store_a1 from fx);
select is((pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05')) ->> 'refusal', 'paused', 'a paused store answers paused');
update public.store_ordering_settings set paused_until = null, staff_presence_required = true where store_id = (select store_a1 from fx);
select is((pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05')) ->> 'refusal', 'no_staff_online', 'an open store without a counter online answers no_staff_online');
select is((pg_temp.slots((select store_a1 from fx), '2026-11-27 23:30')) ->> 'state', 'ok', 'a closed store still offers the next morning''s slots without staff online');
update public.store_ordering_settings set staff_presence_required = false where store_id = (select store_a1 from fx);
update public.stores set opening_hours = null where id = (select store_a3 from fx);
select is((pg_temp.slots((select store_a3 from fx), '2026-11-27 14:05')) ->> 'refusal', 'hours_unknown', 'a store without opening hours has no slot');
update public.stores set opening_hours = '{"mon": [["18:00", "02:00"]], "tue": [["18:00", "02:00"]], "wed": [["18:00", "02:00"]], "thu": [["18:00", "02:00"]], "fri": [["18:00", "02:00"]], "sat": [["18:00", "02:00"]], "sun": [["18:00", "02:00"]]}'::jsonb
where id = (select store_a3 from fx);

-- 5. The settings: bounds, slot alignment and who writes them ------------------------------------------------------------
update public.store_ordering_settings set takeaway_slot_minutes = 30 where store_id = (select store_a1 from fx);
create temp table half_hour as select pg_temp.slots((select store_a1 from fx), '2026-11-27 14:05') as a;
select is((select pg_temp.first_free(a) || ' ' || pg_temp.local((a ->> 'last_pickup_at')::timestamptz) from half_hour), '2026-11-27 14:30 2026-11-27 22:30',
  'with 30-minute slots: 14:30 first, the last pick-up at 22:30');
select is((select pg_temp.slot(a, '2026-11-27 14:45') from half_hour), 'absent', 'and no slot starts at 14:45');
update public.store_ordering_settings set takeaway_slot_minutes = 15 where store_id = (select store_a1 from fx);
select throws_ok(format($q$update public.store_ordering_settings set takeaway_slot_minutes = 7 where store_id = %L$q$, (select store_a1 from fx)), '23514', null, 'a slot of 7 minutes (not dividing an hour) is refused');
select throws_ok(format($q$update public.store_ordering_settings set takeaway_slot_minutes = 0 where store_id = %L$q$, (select store_a1 from fx)), '23514', null, 'a slot of 0 minutes is refused');
select lives_ok(format($q$update public.store_ordering_settings set takeaway_slot_minutes = 60 where store_id = %L$q$, (select store_a1 from fx)), 'boundary: a 60-minute slot is allowed');
select lives_ok(format($q$update public.store_ordering_settings set takeaway_slot_minutes = 5 where store_id = %L$q$, (select store_a1 from fx)), 'boundary: a 5-minute slot is allowed');
select throws_ok(format($q$update public.store_ordering_settings set takeaway_slot_limit = 0 where store_id = %L$q$, (select store_a1 from fx)), '23514', null, 'boundary: a limit of 0 is refused');
select throws_ok(format($q$update public.store_ordering_settings set takeaway_slot_limit = 101 where store_id = %L$q$, (select store_a1 from fx)), '23514', null, 'boundary: a limit of 101 is refused');
select lives_ok(format($q$update public.store_ordering_settings set takeaway_slot_limit = 100 where store_id = %L$q$, (select store_a1 from fx)), 'boundary: a limit of 100 is allowed');
update public.store_ordering_settings set takeaway_slot_minutes = 15, takeaway_slot_limit = 2 where store_id = (select store_a1 from fx);
select is((select takeaway_slot_minutes || '/' || takeaway_slot_limit from public.store_ordering_settings where store_id = (select store_a3 from fx)), '15/2', 'the fixture''s values; a new row defaults to 15 minutes and 6 places');
select is(pg_temp.rows_as((select manager_u from fx), format($q$with u as (update public.store_ordering_settings set takeaway_slot_limit = 8, takeaway_slot_minutes = 20, prep_minutes = 12 where store_id = %L returning 1) select count(*)::text from u$q$, (select store_a1 from fx))),
  '1', 'a manager of the store edits the preparation time, the slot length and the limit');
select is((select takeaway_slot_limit || '/' || takeaway_slot_minutes || '/' || prep_minutes from public.store_ordering_settings where store_id = (select store_a1 from fx)), '8/20/12', 'and the row holds them');
select is(pg_temp.rows_as((select manager_a3_u from fx), format($q$with u as (update public.store_ordering_settings set takeaway_slot_limit = 9 where store_id = %L returning 1) select count(*)::text from u$q$, (select store_a1 from fx))),
  '0', 'a manager of another store changes nothing at A1');
select is(pg_temp.rows_as((select staff_u from fx), format($q$with u as (update public.store_ordering_settings set takeaway_slot_limit = 9 where store_id = %L returning 1) select count(*)::text from u$q$, (select store_a1 from fx))),
  '0', 'staff change nothing');
select is(pg_temp.rows_as((select owner_b_u from fx), format($q$with u as (update public.store_ordering_settings set takeaway_slot_limit = 9 where store_id = %L returning 1) select count(*)::text from u$q$, (select store_a1 from fx))),
  '0', 'another tenant''s owner changes nothing');
select is(pg_temp.rows_as((select viewer_u from fx), format($q$select takeaway_slot_limit::text from public.store_ordering_settings where store_id = %L$q$, (select store_a1 from fx))),
  '8', 'a viewer reads them');
update public.store_ordering_settings set takeaway_slot_minutes = 15, takeaway_slot_limit = 2, prep_minutes = 15 where store_id = (select store_a1 from fx);

-- 6. The customer's read and the boundary of the functions -----------------------------------------------------------
select is((pg_temp.call((select cust3_u from fx), $q$select public.customer_takeaway_slots('ta-1')$q$)) ->> 'state' in ('ok', 'refused'), true, 'a customer of the brand reads the slots of its store at the server''s time');
select is((pg_temp.call((select custb_u from fx), $q$select public.customer_takeaway_slots('ta-1')$q$)) ->> 'error', '22023', 'another tenant''s customer cannot name the store');
select is((pg_temp.call((select staff_u from fx), $q$select public.customer_takeaway_slots('ta-1')$q$)) ->> 'error', '42501', 'a staff login is not a customer session');
select ok(not has_function_privilege('anon', 'public.customer_takeaway_slots(text)', 'execute') and has_function_privilege('authenticated', 'public.customer_takeaway_slots(text)', 'execute'),
  'the slots are for signed-in customers only');
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   cross join (values ('app.takeaway_slots(uuid, timestamptz)'), ('app.takeaway_offer(uuid, timestamptz)'), ('app.takeaway_slot_starts(uuid, timestamptz, timestamptz)'),
     ('app.takeaway_slot_taken(uuid, timestamptz, timestamptz)'), ('app.takeaway_slot_refusal(uuid, timestamptz, timestamptz)'), ('app.order_start_at(public.orders)'),
     ('app.takeaway_hold_minutes()'), ('app.ordering_waiting_orders(uuid, timestamptz)')) f (fn)
   where has_function_privilege(r.role, f.fn, 'execute')),
  0, 'no API role executes the internal slot functions'
);
select is((select count(*)::integer from public.orders where store_id = (select store_a1 from fx)), 2, 'reading slots wrote nothing: only the two bookings are orders');

select * from finish();
rollback;
