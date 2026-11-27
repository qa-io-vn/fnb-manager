-- The native till, step 1 (ADR-060, native-till.md section 2): the till mode, the store settings and their ranges,
-- closures, the pause, and the ordering state's decision table.
-- Techniques: decision table (the all-true row, one rule per reason, and the priority between two reasons), boundary
-- values to the second (last orders, presence 179/180 s, pause end, closure dates with a 04:00 business-day start),
-- equivalence partitions of every settings range (each end and one past it) and of the callers (role x scope).
begin;
select plan(90);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000026101'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000026102'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000026101'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000026102'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000026101'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000026102'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000026103'::uuid as store_b1,
  'eeeeeeee-eeee-4eee-8eee-000000026101'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000026102'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000026103'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000026104'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000026105'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000026106'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000026107'::uuid as owner_a1_u,
  -- Wednesday 2026-11-25, 10:00 at the store.
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

-- The outcome of a statement run as a member: rows:<n> for a command, the first column for a query, or the SQLSTATE.
create function pg_temp.as_user(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_rows integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    if p_statement ~* '^\s*select' then
      execute p_statement into v_value;
      v_value := coalesce(v_value, 'null');
    else
      execute p_statement;
      get diagnostics v_rows = row_count;
      v_value := 'rows:' || v_rows;
    end if;
  exception when others then
    v_value := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_value;
end;
$$;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-261-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_u), (fx.manager_u), (fx.manager_a1_u), (fx.staff_u), (fx.viewer_u), (fx.owner_b_u), (fx.owner_a1_u)) as u (id);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-261-a', 'Native 261 A' from fx union all
select tenant_b, 'native-261-b', 'Native 261 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-261-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-261-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours, business_day_start_minutes)
select store_a1, tenant_a, account_a, 'n261-a1', 'sa-1', 'Synthetic store A1',
  '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb,
  240 from fx union all
select store_a2, tenant_a, account_a, 'n261-a2', 'sa-2', 'Synthetic store A2', '{"wed": [["07:00", "22:00"]]}'::jsonb, 0 from fx union all
select store_b1, tenant_b, account_b, 'n261-b1', 'sb-1', 'Synthetic store B1', '{"wed": [["07:00", "22:00"]]}'::jsonb, 0 from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.manager_a1_u, 'manager', array[fx.store_a1]),
  (fx.staff_u, 'staff', array[fx.store_a1]), (fx.viewer_u, 'viewer', null), (fx.owner_a1_u, 'owner', array[fx.store_a1])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;

-- 1. The till mode: an owner with every store only ------------------------------------------------------------------
select is(pg_temp.as_user((select manager_u from fx), format($$select public.set_store_till_mode(%L, 'native')::text$$, (select store_a1 from fx))), '42501', 'a manager cannot change the till mode');
select is(pg_temp.as_user((select owner_a1_u from fx), format($$select public.set_store_till_mode(%L, 'native')::text$$, (select store_a1 from fx))), '42501', 'an owner limited to one store cannot change the till mode');
select is(pg_temp.as_user((select owner_b_u from fx), format($$select public.set_store_till_mode(%L, 'native')::text$$, (select store_a1 from fx))), '42501', 'another tenant''s owner cannot change the till mode');
select is(pg_temp.as_user((select owner_u from fx), format($$select public.set_store_till_mode(%L, 'cash')::text$$, (select store_a1 from fx))), '22023', 'an unknown till mode is refused');
select is(pg_temp.as_user((select owner_u from fx), format($$select public.set_store_till_mode(%L, 'native') ->> 'till_mode'$$, (select store_a1 from fx))), 'native', 'an owner with every store switches a store to native');
select is((select till_mode || '/' || ordering_enabled from public.store_ordering_settings where store_id = (select store_a1 from fx)), 'native/false', 'the switch creates the settings row, ordering still off');
select is(
  pg_temp.as_user((select manager_u from fx), format($$update public.store_ordering_settings set till_mode = 'ipos' where store_id = %L$$, (select store_a1 from fx))),
  '42501', 'the till mode is not writable directly'
);
select is(
  pg_temp.as_user((select manager_u from fx), format($$update public.store_ordering_settings set payment_methods = array['vietqr'] where store_id = %L$$, (select store_a1 from fx))),
  '42501', 'online payment methods are not writable before their providers exist'
);
select is(
  pg_temp.as_user((select manager_u from fx), format($$update public.store_ordering_settings set paused_until = now() + interval '1 day' where store_id = %L$$, (select store_a1 from fx))),
  '42501', 'a pause is not written directly'
);
select is(
  pg_temp.as_user((select manager_a1_u from fx), format($$update public.store_ordering_settings set ordering_enabled = true, prep_minutes = 12 where store_id = %L$$, (select store_a1 from fx))),
  'rows:1', 'a store-limited manager writes its own store''s settings'
);
select is(
  pg_temp.as_user((select manager_a1_u from fx), format($$insert into public.store_ordering_settings (store_id, tenant_id, ordering_enabled) values (%L, %L, true)$$, (select store_a2 from fx), (select tenant_a from fx))),
  '42501', 'a store-limited manager creates no settings for another store'
);
select is(pg_temp.as_user((select staff_u from fx), 'select count(*) from public.store_ordering_settings'), '0', 'staff read no settings row');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(*) from public.store_ordering_settings'), '1', 'a viewer reads the settings');

-- 2. The decision table -----------------------------------------------------------------------------------------
update public.store_ordering_settings set staff_presence_required = false where store_id = (select store_a1 from fx);
select is((app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'accepting')::boolean, true, 'all conditions hold: accepting');
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', null, 'all conditions hold: no reason');
select is(app.ordering_state((select store_a2 from fx), 'table', (select noon from fx)) ->> 'reason', 'ordering_off', 'rule ordering_off: no settings row');
update public.store_ordering_settings set ordering_enabled = false where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'ordering_off', 'rule ordering_off: not enabled');
update public.store_ordering_settings set ordering_enabled = true, till_mode = 'ipos' where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'ordering_off', 'rule ordering_off: an ipos store takes no order');
update public.store_ordering_settings set till_mode = 'native' where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'takeaway', (select noon from fx)) ->> 'reason', 'ordering_off', 'rule ordering_off: a type the store does not take');
update public.stores set opening_hours = null where id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'hours_unknown', 'rule hours_unknown');
update public.stores set opening_hours = '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb where id = (select store_a1 from fx);
insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason)
select tenant_a, store_a1, date '2026-11-25', date '2026-11-26', 'Sửa quán' from fx;
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'closed_today', 'rule closed_today');
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'closure_reason', 'Sửa quán', 'closed_today carries the owner''s reason');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 03:59:59+07') ->> 'reason', 'closed_now', 'closure boundary: 03:59:59 belongs to the previous business date');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-27 03:59:59+07') ->> 'reason', 'closed_today', 'closure boundary: 03:59:59 on the 27th is still the 26th');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-27 10:00:00+07') ->> 'reason', null, 'closure boundary: the day after accepts');
update public.store_ordering_settings set paused_until = (select noon from fx) + interval '30 minutes' where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'closed_today', 'priority: a closure before a pause');
delete from public.ordering_closures where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'paused', 'rule paused');
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx) + interval '29 minutes 59 seconds') ->> 'reason', 'paused', 'pause boundary: one second before its end');
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx) + interval '30 minutes') ->> 'reason', null, 'pause boundary: at its end ordering resumes');
update public.store_ordering_settings set paused_until = timestamptz '2026-11-25 23:00:00+07' where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 22:30:00+07') ->> 'reason', 'paused', 'priority: a pause before closed_now');
update public.store_ordering_settings set paused_until = null where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 06:59:59+07') ->> 'reason', 'closed_now', 'rule closed_now');
select is(
  (app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 06:59:59+07') ->> 'opens_at')::timestamptz,
  timestamptz '2026-11-25 07:00:00+07', 'closed_now names the next opening'
);
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 07:00:00+07') ->> 'reason', null, 'opening boundary: the opening second accepts');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 21:59:59+07') ->> 'reason', null, 'last_order_minutes 0: the last second before closing accepts');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 22:00:00+07') ->> 'reason', 'closed_now', 'the closing second is closed');
update public.store_ordering_settings set last_order_minutes = 30 where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 21:29:59+07') ->> 'reason', null, 'last-order boundary: 21:29:59 accepted');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 21:30:00+07') ->> 'reason', 'last_orders_passed', 'rule last_orders_passed: at 21:30:00');
update public.store_ordering_settings set staff_presence_required = true where store_id = (select store_a1 from fx);
insert into app.ordering_presence (store_id, user_id, seen_at) select store_a1, staff_u, noon - interval '179 seconds' from fx;
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', null, 'presence boundary: a poll 179 s ago is fresh');
update app.ordering_presence set seen_at = (select noon from fx) - interval '180 seconds' where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'no_staff_online', 'rule no_staff_online: a poll 180 s ago is stale');
select is(app.ordering_state((select store_a1 from fx), 'table', timestamptz '2026-11-25 21:45:00+07') ->> 'reason', 'last_orders_passed', 'priority: last orders before missing staff');
select is(app.ordering_state((select store_a1 from fx), null, (select noon from fx)) -> 'order_types', '["table"]'::jsonb, 'the state lists the types the store takes');

-- 3. Settings ranges: each end and one past ------------------------------------------------------------------------
create function pg_temp.setting_outcome(p_column text, p_value text)
returns text
language plpgsql
as $$
begin
  execute format('update public.store_ordering_settings set %I = %s where store_id = %L', p_column, p_value, (select store_a1 from fx));
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
select is(pg_temp.setting_outcome(v.col, v.val), v.expected, format('setting %s = %s', v.col, v.val))
from (values
  ('payment_window_minutes', '5', 'ok'), ('payment_window_minutes', '4', '23514'), ('payment_window_minutes', '60', 'ok'), ('payment_window_minutes', '61', '23514'),
  ('late_order_minutes', '1', 'ok'), ('late_order_minutes', '0', '23514'), ('late_order_minutes', '120', 'ok'), ('late_order_minutes', '121', '23514'),
  ('prep_minutes', '0', 'ok'), ('prep_minutes', '-1', '23514'), ('prep_minutes', '120', 'ok'), ('prep_minutes', '121', '23514'),
  ('last_order_minutes', '120', 'ok'), ('last_order_minutes', '121', '23514'),
  ('max_order_amount', '50000', 'ok'), ('max_order_amount', '49999', '23514'), ('max_order_amount', '20000000', 'ok'), ('max_order_amount', '20000001', '23514'), ('max_order_amount', '60000.5', '23514'),
  ('max_waiting_orders', '3', 'ok'), ('max_waiting_orders', '2', '23514'), ('max_waiting_orders', '200', 'ok'), ('max_waiting_orders', '201', '23514'),
  ('order_types', 'array[''table'', ''takeaway'']', 'ok'), ('order_types', 'array[''delivery'']', '23514'), ('order_types', 'array[''table'', ''table'']', '23514'), ('order_types', '''{}''', '23514'),
  ('payment_methods', 'array[''counter'', ''zalo_checkout'', ''vietqr'']', 'ok'), ('payment_methods', 'array[''card'']', '23514'),
  ('till_mode', '''cash''', '23514'),
  ('paused_reason', 'repeat(''x'', 81)', '23514')
) as v (col, val, expected);

-- 4. Closures: 62 days at most -----------------------------------------------------------------------------------
select lives_ok($$insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) values ('dddddddd-dddd-4ddd-8ddd-000000026101', 'ffffffff-ffff-4fff-8fff-000000026102', '2027-01-01', '2027-03-03', 'Nghỉ dài')$$, 'a closure of 62 days is kept');
select throws_ok($$insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) values ('dddddddd-dddd-4ddd-8ddd-000000026101', 'ffffffff-ffff-4fff-8fff-000000026102', '2027-01-01', '2027-03-04', 'Nghỉ dài')$$, '23514', null, 'a closure of 63 days is refused');
select throws_ok($$insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) values ('dddddddd-dddd-4ddd-8ddd-000000026101', 'ffffffff-ffff-4fff-8fff-000000026102', '2027-01-02', '2027-01-01', 'Ngược')$$, '23514', null, 'a closure ending before it starts is refused');
select is(
  pg_temp.as_user((select manager_a1_u from fx), $$insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) values ('dddddddd-dddd-4ddd-8ddd-000000026101', 'ffffffff-ffff-4fff-8fff-000000026102', '2027-05-01', '2027-05-01', 'Khác')$$),
  '42501', 'a store-limited manager adds no closure at another store'
);
select is(
  pg_temp.as_user((select manager_a1_u from fx), $$insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) values ('dddddddd-dddd-4ddd-8ddd-000000026101', 'ffffffff-ffff-4fff-8fff-000000026101', '2027-05-01', '2027-05-01', 'Khác')$$),
  'rows:1', 'a store-limited manager adds a closure at its own store'
);
select is(
  pg_temp.as_user((select manager_u from fx), format($$update public.ordering_closures set store_id = %L where store_id = %L$$, (select store_a2 from fx), (select store_a1 from fx))),
  '22023', 'a closure keeps its store'
);

-- 5. The pause ---------------------------------------------------------------------------------------------------
select ok(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_pause(%L, 60, 'Đông khách') ->> 'paused_until'$$, (select store_a1 from fx))) ~ '^2', 'staff pause ordering for 60 minutes');
select is((select paused_by from public.store_ordering_settings where store_id = (select store_a1 from fx)), (select staff_u from fx), 'the pause records who paused');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_pause(%L, 61, null)::text$$, (select store_a1 from fx))), '42501', 'staff cannot pause for 61 minutes');
select ok(pg_temp.as_user((select manager_a1_u from fx), format($$select public.counter_set_pause(%L, 1440, null) ->> 'paused_until'$$, (select store_a1 from fx))) ~ '^2', 'a manager pauses for 1,440 minutes');
select is(pg_temp.as_user((select manager_u from fx), format($$select public.counter_set_pause(%L, 1441, null)::text$$, (select store_a1 from fx))), '22023', 'nobody pauses for 1,441 minutes');
select is(pg_temp.as_user((select manager_u from fx), format($$select public.counter_set_pause(%L, -1, null)::text$$, (select store_a1 from fx))), '22023', 'a negative pause is refused');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_pause(%L, 5, %L)::text$$, (select store_a1 from fx), 'hai' || chr(10) || 'dòng')), '22023', 'a pause reason with a line break is refused');
select is(pg_temp.as_user((select staff_u from fx), format($$select coalesce(public.counter_set_pause(%L, 0, null) ->> 'paused_until', 'resumed')$$, (select store_a1 from fx))), 'resumed', 'a pause of 0 minutes resumes');
select is((select coalesce(paused_until::text, 'null') || '/' || coalesce(paused_by::text, 'null') from public.store_ordering_settings where store_id = (select store_a1 from fx)), 'null/null', 'resuming clears the pause');
select is(pg_temp.as_user((select viewer_u from fx), format($$select public.counter_set_pause(%L, 5, null)::text$$, (select store_a1 from fx))), '42501', 'a viewer cannot pause');
select is(pg_temp.as_user((select owner_b_u from fx), format($$select public.counter_set_pause(%L, 5, null)::text$$, (select store_a1 from fx))), '42501', 'another tenant''s owner cannot pause the store');
select is(pg_temp.as_user((select owner_b_u from fx), format($$select public.counter_set_pause(%L, 5, null)::text$$, (select store_b1 from fx))), '22023', 'a store without settings cannot be paused');

select * from finish();
rollback;
