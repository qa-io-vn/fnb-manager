-- Acceptance criterion 7 of the owner's plan, phase 1: "Công tháng của từng nhân viên khớp giờ vào, ra ca đã ghi". The
-- rule as built (migration staff_shifts; the counting rule is still the owner's decision, so this file pins it and every
-- surprising edge is named): per person, per store and per business date (the date of the clock-in under the store's
-- day start), the hours between the recorded clock-in and clock-out of every shift whose clock-out is recorded (closed,
-- awaiting a manager's confirmation, or closed by a manager for a forgotten clock-out), over the store's hours per day
-- (8 by default), rounded to two decimals and capped at 1; the month is the sum of its days, read against 28; a shift
-- without a clock-out is listed as open and not counted. The manager's S11 view and the person's own view must agree,
-- and both must equal an oracle that recomputes every day from the clock-in and clock-out instants alone.
-- Techniques: boundary values of the day's hours (8:00:00, 7:59:59, 7:57, 8:00:01, 4:00, 3:58, 3:57, one minute, ten
-- hours in two shifts), of the business date (a clock-in at 04:59 and 05:00 with a 05:00 day start, a night across
-- midnight, the month's last night, a clock-in at 04:30 on the 1st that still belongs to the month before, 29 February),
-- and of the store setting (1 and 16 hours kept, 0.99 and 16.01 refused); equivalence partitions of a shift's state
-- (closed, awaiting confirmation, closed by a manager, open); a decision table of who reads the month (the manager of
-- the store, a manager of another store, staff, a viewer, another tenant, a customer); error guessing (one person at
-- two stores on one day makes 1.5 days: flagged for the owner; a locked person still has the days they worked).
begin;
select plan(26);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030002'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030002'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000030003'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030001'::uuid as brand_a,
  '99999999-9999-4999-8999-000000030001'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000030001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030002'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030003'::uuid as staff1_u,
  'eeeeeeee-eeee-4eee-8eee-000000030004'::uuid as staff2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030005'::uuid as staff3_u,
  'eeeeeeee-eeee-4eee-8eee-000000030006'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000030007'::uuid as manager_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030008'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000030011'::uuid as cust1_u;
grant select on fx to authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'acceptance-300-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.staff1_u, null), (fx.staff2_u, null), (fx.staff3_u, null), (fx.viewer_u, null),
  (fx.manager_a2_u, null), (fx.owner_b_u, null), (fx.cust1_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'acceptance-300-a', 'Acceptance 300 A' from fx union all
select tenant_b, 'acceptance-300-b', 'Acceptance 300 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'acceptance-300-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'acceptance-300-b', 'Synthetic account B' from fx;
-- A1's business day starts at midnight, A2's at 05:00.
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, business_day_start_minutes)
select s.id, s.tenant, s.account, s.ext, s.code, s.name, s.day_start
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'a300-a1', 'sa-1', 'Synthetic store A1', 0),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'a300-a2', 'sa-2', 'Synthetic store A2', 300),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'a300-b1', 'sb-1', 'Synthetic store B1', 0)
) as s (id, tenant, account, ext, code, name, day_start);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.staff1_u, 'staff', array[fx.store_a1, fx.store_a2]),
  (fx.staff2_u, 'staff', array[fx.store_a1]), (fx.staff3_u, 'staff', array[fx.store_a1]), (fx.viewer_u, 'viewer', null),
  (fx.manager_a2_u, 'manager', array[fx.store_a2])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_a, r.name, 'staff', r.stores, 'active', r.user_id, now()
from fx cross join lateral (values
  ('Nhân viên Một', fx.staff1_u, array[fx.store_a1, fx.store_a2]), ('Nhân viên Hai', fx.staff2_u, array[fx.store_a1]),
  ('Nhân viên Ba', fx.staff3_u, array[fx.store_a1])
) as r (name, user_id, stores);
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-300-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-300-1', cust1_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], false from fx;
create temp table qr as
select s.id as store_id, app.counter_qr_token(s.tenant_id, s.id, 1) as token from public.stores s join fx on s.id in (fx.store_a1, fx.store_a2);

create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
-- A recorded shift: clocked in and out at the given Vietnam times, closed with a matching drawer; its business date
-- is the clock-in's under the store's day start, as app.staff_clock_in sets it.
create function pg_temp.worked(p_user uuid, p_store uuid, p_in text, p_out text) returns void language sql as $$
  insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, clock_out_at, expected_cash, counted_cash, cash_difference, status, closed_at)
  select s.tenant_id, s.id, p_user, app.store_business_date(s.id, pg_temp.at(p_in)), pg_temp.at(p_in), pg_temp.at(p_out), 0, 0, 0, 'closed', pg_temp.at(p_out)
  from public.stores s where s.id = p_store;
$$;
create function pg_temp.month(p_user uuid, p_store uuid, p_month date) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_worked_days(%L, %L)$q$, p_store, p_month));
$$;
-- One person's entry of a month at a store, as the store's manager reads it.
create function pg_temp.person(p_store uuid, p_month date, p_user uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.month((select manager_u from fx), p_store, p_month) -> 'people') x where (x ->> 'user_id')::uuid = p_user;
$$;
create function pg_temp.days_list(p_store uuid, p_month date, p_user uuid) returns text language sql as $$
  select string_agg(right(d ->> 'date', 5) || '=' || (d ->> 'hours') || 'h:' || (d ->> 'days'), ',' order by d ->> 'date')
  from jsonb_array_elements(pg_temp.person(p_store, p_month, p_user) -> 'days') d;
$$;
-- The oracle: every day recomputed from the clock-in and clock-out instants alone (the business date from the
-- clock-in, the store's time zone and day start; not the stored business_date), under the rule as built.
create function pg_temp.oracle(p_store uuid, p_month date, p_user uuid) returns text language sql stable as $$
  select sum(x.hours)::text || '/' || sum(x.days)::text
  from (
    select round(sum(extract(epoch from s.clock_out_at - s.clock_in_at)) / 3600, 2) as hours,
      least(1.00, round(sum(extract(epoch from s.clock_out_at - s.clock_in_at)) / 3600 / coalesce(o.standard_day_hours, 8), 2)) as days
    from public.staff_shifts s
    join public.stores st on st.id = s.store_id
    left join public.store_ordering_settings o on o.store_id = s.store_id
    where s.store_id = p_store and s.user_id = p_user and s.clock_out_at is not null
      and date_trunc('month', ((s.clock_in_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date) = date_trunc('month', p_month)
    group by ((s.clock_in_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date, o.standard_day_hours
  ) x;
$$;

-- 1. The day's hours at their boundaries (staff 1 at A1, October 2026, 8 hours a day) ---------------------------------
select pg_temp.worked(staff1_u, store_a1, v.f, v.t)
from fx cross join (values
  ('2026-09-30 23:00', '2026-10-01 01:00'),
  ('2026-10-01 08:00', '2026-10-01 16:00'),
  ('2026-10-02 08:00', '2026-10-02 15:59:59'),
  ('2026-10-03 08:00', '2026-10-03 15:57'),
  ('2026-10-04 08:00', '2026-10-04 16:00:01'),
  ('2026-10-05 08:00', '2026-10-05 12:00'),
  ('2026-10-06 08:00', '2026-10-06 11:58'),
  ('2026-10-07 08:00', '2026-10-07 11:57'),
  ('2026-10-08 08:00', '2026-10-08 08:01'),
  ('2026-10-09 07:00', '2026-10-09 11:00'),
  ('2026-10-09 13:00', '2026-10-09 19:00'),
  ('2026-10-10 20:00', '2026-10-11 04:00'),
  ('2026-10-21 06:00', '2026-10-21 12:00'),
  ('2026-10-31 22:00', '2026-11-01 02:00'),
  ('2026-11-01 08:00', '2026-11-01 12:00')
) as v (f, t);
select is(
  (select (r ->> 'month') || '/' || (r ->> 'standard_days') || '/' || (r ->> 'standard_day_hours') from (select pg_temp.month((select manager_u from fx), (select store_a1 from fx), date '2026-10-17') as r) q),
  '2026-10/28/8.00', 'October at A1, read against 28 days of 8 hours'
);
select is(
  pg_temp.days_list((select store_a1 from fx), date '2026-10-17', (select staff1_u from fx)),
  '10-01=8.00h:1.00,10-02=8.00h:1.00,10-03=7.95h:0.99,10-04=8.00h:1.00,10-05=4.00h:0.50,10-06=3.97h:0.50,10-07=3.95h:0.49,10-08=0.02h:0.00,10-09=10.00h:1.00,10-10=8.00h:1.00,10-21=6.00h:0.75,10-31=4.00h:0.50',
  'criterion 7, boundaries: 8 h is a day; 7:59:59 rounds up to a day; 7:57 is 0.99; 8:00:01 is capped at 1; 4 h is half; 3:58 rounds to half; 3:57 is 0.49; one minute is 0; two shifts of 10 h are capped at 1; a night across midnight and the month''s last night stay on their clock-in date'
);
select is(
  (select (p ->> 'hours') || '/' || (p ->> 'worked_days') || '/' || (p ->> 'open_shifts') || '/' || (p ->> 'name') from pg_temp.person((select store_a1 from fx), date '2026-10-17', (select staff1_u from fx)) p),
  '71.89/8.73/0/Nhân viên Một', 'criterion 7: the month is the sum of its days: 71.89 hours make 8.73 worked days; the night begun on 30 September and the shift of 1 November are left out'
);
select is(
  (select (p ->> 'hours') || '/' || (p ->> 'worked_days') from pg_temp.person((select store_a1 from fx), date '2026-10-17', (select staff1_u from fx)) p),
  pg_temp.oracle((select store_a1 from fx), date '2026-10-17', (select staff1_u from fx)),
  'criterion 7: the hours and worked days equal those recomputed from the clock-in and clock-out instants alone'
);

-- 2. The business date under a 05:00 day start (staff 1 at A2), through the counter's own functions --------------------
select is(
  (select string_agg(x, ',') from (
    select pg_temp.call((select staff1_u from fx), format($q$select app.staff_clock_in(%L, %L, 0, %L)$q$, (select store_a2 from fx), (select token from qr where store_id = (select store_a2 from fx)), pg_temp.at(v.f))) -> 'shift' ->> 'business_date'
      || ':' || (pg_temp.call((select staff1_u from fx), format($q$select app.staff_clock_out(0, %L)$q$, pg_temp.at(v.t))) ->> 'state') as x
    from (values (1, '2026-10-01 04:59', '2026-10-01 06:59'), (2, '2026-10-20 04:59', '2026-10-20 08:59'), (3, '2026-10-20 09:00', '2026-10-20 13:00'),
      (4, '2026-10-21 13:00', '2026-10-21 19:00'), (5, '2026-11-01 04:30', '2026-11-01 06:30'), (6, '2026-11-01 05:00', '2026-11-01 07:00')) as v (n, f, t)
    order by v.n) q),
  '2026-09-30:closed,2026-10-19:closed,2026-10-20:closed,2026-10-21:closed,2026-10-31:closed,2026-11-01:closed',
  'clocking in at 04:59 belongs to the day before and at 05:00 or later to the day itself; 04:30 on 1 November is still 31 October'
);
select is(
  pg_temp.days_list((select store_a2 from fx), date '2026-10-01', (select staff1_u from fx)),
  '10-19=4.00h:0.50,10-20=4.00h:0.50,10-21=6.00h:0.75,10-31=2.00h:0.25',
  'criterion 7: October at A2 holds the four shifts whose business date is in October, by the recorded clock-in'
);
select is(
  (select (p ->> 'hours') || '/' || (p ->> 'worked_days') from pg_temp.person((select store_a2 from fx), date '2026-10-01', (select staff1_u from fx)) p),
  pg_temp.oracle((select store_a2 from fx), date '2026-10-01', (select staff1_u from fx)),
  'criterion 7: and equals the oracle'
);
select is(
  (select sum((d ->> 'days')::numeric)::text from (
     select jsonb_array_elements(pg_temp.person(st, date '2026-10-01', (select staff1_u from fx)) -> 'days') d from fx cross join unnest(array[fx.store_a1, fx.store_a2]) st) q
   where d ->> 'date' = '2026-10-21'),
  '1.50', 'flag for the owner: 6 hours at A1 and 6 at A2 on 21 October make 1.50 worked days for one person on one day (the cap is per store)'
);
select is(
  (select string_agg((m ->> 'store_id' = (select store_a1::text from fx))::text || ':' || (p ->> 'worked_days'), ',' order by m ->> 'store_id' = (select store_a1::text from fx) desc)
   from pg_temp.call((select staff1_u from fx), $q$select app.staff_my_shift('2026-10-01')$q$) r
   cross join jsonb_array_elements(r -> 'months') m cross join jsonb_array_elements(m -> 'people') p),
  'true:8.73,false:2.00', 'criterion 7: the person''s own view of October gives the same days per store as the manager''s'
);

-- 3. The states of a shift (staff 2 and staff 3 at A1) ------------------------------------------------------------------
select pg_temp.worked(staff2_u, store_a1, '2026-10-12 09:00', '2026-10-12 17:00') from fx;
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, clock_out_at, expected_cash, counted_cash, cash_difference, status)
select tenant_a, store_a1, staff2_u, '2026-10-13', pg_temp.at('2026-10-13 09:00'), pg_temp.at('2026-10-13 13:00'), 100000, 95000, -5000, 'awaiting_confirmation' from fx;
select is(
  pg_temp.call((select staff3_u from fx), format($q$select app.staff_clock_in(%L, %L, 0, %L)$q$, (select store_a1 from fx), (select token from qr where store_id = (select store_a1 from fx)), pg_temp.at('2026-10-14 09:00'))) ->> 'state',
  'clocked_in', 'staff 3 clocks in on 14 October and forgets to clock out'
);
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'hours') from pg_temp.call((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'quên ra ca', %L)$q$,
    (select s.id from public.staff_shifts s where s.user_id = (select staff3_u from fx) and s.status = 'open'), pg_temp.at('2026-10-14 17:00'), pg_temp.at('2026-10-15 08:00'))) r),
  'closed/8.00', 'a manager closes it the next morning with the clock-out at 17:00'
);
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at)
select tenant_a, store_a1, staff3_u, '2026-10-16', pg_temp.at('2026-10-16 09:00') from fx;
select is(
  pg_temp.days_list((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) || '|'
  || (select (p ->> 'worked_days') || '/' || (p ->> 'open_shifts') from pg_temp.person((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) p),
  '10-12=8.00h:1.00,10-13=4.00h:0.50|1.50/0',
  'equivalence partitions: a closed shift counts, and so does one awaiting a manager''s confirmation (its clock-out is recorded)'
);
select is(
  pg_temp.days_list((select store_a1 from fx), date '2026-10-01', (select staff3_u from fx)) || '|'
  || (select (p ->> 'worked_days') || '/' || (p ->> 'open_shifts') from pg_temp.person((select store_a1 from fx), date '2026-10-01', (select staff3_u from fx)) p),
  '10-14=8.00h:1.00|1.00/1',
  'equivalence partitions: a forgotten shift closed by a manager counts with the clock-out the manager recorded; an open shift is listed, not counted'
);
select is(
  (select string_agg((p ->> 'name') || '=' || (p ->> 'worked_days') || ':' || pg_temp.oracle((select store_a1 from fx), date '2026-10-01', (p ->> 'user_id')::uuid), ',' order by p ->> 'name')
   from jsonb_array_elements(pg_temp.month((select manager_u from fx), (select store_a1 from fx), date '2026-10-01') -> 'people') p),
  'Nhân viên Ba=1.00:8.00/1.00,Nhân viên Hai=1.50:12.00/1.50,Nhân viên Một=8.73:71.89/8.73',
  'criterion 7: every person of A1''s October, each beside the oracle''s hours and days'
);

-- 4. A locked person keeps the days they worked; 29 February ---------------------------------------------------------
update public.staff_roster set status = 'inactive', deactivated_at = pg_temp.at('2026-10-20 00:00') where user_id = (select staff2_u from fx);
select is(
  (select (p ->> 'name') || '/' || (p ->> 'worked_days') from pg_temp.person((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) p),
  'Nhân viên Hai/1.50', 'a person locked out of the roster later still has the worked days of the month'
);
select pg_temp.worked(staff2_u, store_a1, v.f, v.t)
from fx cross join (values ('2028-02-29 08:00', '2028-02-29 16:00'), ('2028-03-01 08:00', '2028-03-01 12:00')) as v (f, t);
select is(pg_temp.days_list((select store_a1 from fx), date '2028-02-01', (select staff2_u from fx)), '02-29=8.00h:1.00', 'boundary: 29 February 2028 is in February; 1 March is not');

-- 5. The store's hours per day ------------------------------------------------------------------------------------
select throws_ok(format($q$update public.store_ordering_settings set standard_day_hours = 0.99 where store_id = %L$q$, (select store_a1 from fx)), '23514', null,
  'boundary: fewer than 1 hour per day is refused');
select throws_ok(format($q$update public.store_ordering_settings set standard_day_hours = 16.01 where store_id = %L$q$, (select store_a1 from fx)), '23514', null,
  'boundary: more than 16 hours per day is refused');
update public.store_ordering_settings set standard_day_hours = 16 where store_id = (select store_a1 from fx);
select is(
  (select (p ->> 'worked_days') || '=' || pg_temp.oracle((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) from pg_temp.person((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) p),
  '0.75=12.00/0.75', 'boundary: at 16 hours per day the same 12 hours are 0.75 days, as the oracle says'
);
update public.store_ordering_settings set standard_day_hours = 1 where store_id = (select store_a1 from fx);
select is(
  (select (p ->> 'worked_days') from pg_temp.person((select store_a1 from fx), date '2026-10-01', (select staff2_u from fx)) p),
  '2.00', 'boundary: at 1 hour per day each shift is a whole day, capped at 1'
);
update public.store_ordering_settings set standard_day_hours = 8 where store_id = (select store_a1 from fx);

-- 6. Who reads the month ---------------------------------------------------------------------------------------------
select is(
  (pg_temp.month((select staff1_u from fx), (select store_a1 from fx), date '2026-10-01') ->> 'error') || '/'
  || (pg_temp.month((select viewer_u from fx), (select store_a1 from fx), date '2026-10-01') ->> 'error') || '/'
  || (pg_temp.month((select manager_a2_u from fx), (select store_a1 from fx), date '2026-10-01') ->> 'error') || '/'
  || (pg_temp.month((select owner_b_u from fx), (select store_a1 from fx), date '2026-10-01') ->> 'error') || '/'
  || (pg_temp.month((select cust1_u from fx), (select store_a1 from fx), date '2026-10-01') ->> 'error'),
  '42501/42501/42501/42501/42501', 'staff, a viewer, a manager of another store, another tenant''s owner and a customer do not read everyone''s month'
);
select is(jsonb_array_length(pg_temp.month((select manager_a2_u from fx), (select store_a2 from fx), date '2026-10-01') -> 'people'), 1, 'a manager of A2 reads A2''s month');
select is(pg_temp.month((select owner_u from fx), (select store_a1 from fx), null) ->> 'error', '22023', 'a month needs a date in it');
select is(
  (select count(*)::int from pg_temp.call((select staff2_u from fx), $q$select app.staff_my_shift('2026-10-01')$q$) r
   cross join jsonb_array_elements(r -> 'months') m cross join jsonb_array_elements(m -> 'people') p where (p ->> 'user_id')::uuid <> (select staff2_u from fx)),
  0, 'a person''s own view holds only themselves'
);
select is(pg_temp.call((select cust1_u from fx), $q$select app.staff_my_shift('2026-10-01')$q$) ->> 'error', '42501', 'a customer has no month');
select ok(
  not has_function_privilege('anon', 'public.manager_worked_days(uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'app.worked_days_rows(uuid, date, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.worked_days_json(uuid, date, uuid)', 'execute'),
  'anon has no month, and nobody calls the internal halves directly'
);

select * from finish();
rollback;
