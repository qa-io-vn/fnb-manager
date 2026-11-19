begin;
select plan(20);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000008101'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000008101'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000008101'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000008102'::uuid as store_2,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000008101'::uuid as programme_a,
  'eeeeeeee-eeee-4eee-8eee-000000008101'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000008102'::uuid as manager_1,
  'eeeeeeee-eeee-4eee-8eee-000000008103'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000008104'::uuid as viewer_a,
  'eeeeeeee-eeee-4eee-8eee-000000008105'::uuid as publisher_a,
  date '2026-11-10' as day;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'shift-anomalies-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_a, fx.manager_1, fx.staff_a, fx.viewer_a, fx.publisher_a]) as u (id);

insert into public.tenants (id, slug, name) select tenant_a, 'shift-anomalies-pgtap', 'Shift anomalies pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'shift-anomalies', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, tran_no_reset_period)
select store_1, tenant_a, account_a, 'sa-1', 'Synthetic store 1', 'daily'::public.tran_no_reset_period from fx
union all
select store_2, tenant_a, account_a, 'sa-2', 'Synthetic store 2', 'daily' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_a, 'owner', null::uuid[]), (fx.manager_1, 'manager', array[fx.store_1]), (fx.staff_a, 'staff', null::uuid[]),
         (fx.viewer_a, 'viewer', null::uuid[]), (fx.publisher_a, 'publisher', null::uuid[])
) as m (user_id, role, store_ids);

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'c' || n, app.loyalty_customer_for_phone((select tenant_a from fx), '090000810' || n, timestamptz '2026-11-01 08:00+07')
from generate_series(1, 5) n;
insert into ids
select 'm' || n, app.loyalty_join((select tenant_a from fx), (select id from ids where name = 'c' || n), 'mini_app', null, null, null, timestamptz '2026-11-01 09:00+07')
from generate_series(1, 4) n;
-- m5 joins at store 1 on the day itself, outside every shift: its welcome adjustment is no manual adjustment.
insert into ids select 'm5', app.loyalty_join((select tenant_a from fx), (select id from ids where name = 'c5'), 'staff', (select store_1 from fx), null, null, timestamptz '2026-11-10 06:30+07');

-- Store 1 on the day: Ca 1 from 07:00 to 12:00 with the external id that sorts last, Ca 2 from 12:00 to 23:00.
insert into public.shifts (tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at)
select tenant_a, store_1, 'sa-shift-b', 'Ca POS sáng', 'Thu ngân tổng hợp A', timestamptz '2026-11-10 07:00+07', timestamptz '2026-11-10 12:00+07' from fx
union all
select tenant_a, store_1, 'sa-shift-a', 'Ca POS tối', 'Thu ngân tổng hợp B', timestamptz '2026-11-10 12:00+07', timestamptz '2026-11-10 23:00+07' from fx
union all
select tenant_a, store_2, 'sa-shift-c', 'Ca POS cả ngày', 'Thu ngân tổng hợp C', timestamptz '2026-11-10 08:00+07', timestamptz '2026-11-10 20:00+07' from fx;
insert into ids select 'shift_' || right(external_id, 1), id from public.shifts where store_id in ((select store_1 from fx), (select store_2 from fx));

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_shift text)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, shift_external_id)
    select fx.tenant_a, p_store, fx.account_a, 'sa-' || p_name, p_name, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, 60000, 60000, 60000, p_shift
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.earn(p_invoice text, p_member text)
returns void
language sql
as $$
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, occurred_at)
  select fx.tenant_a, fx.programme_a, m.id, inv.store_id, 'earn', 1, 1, inv.id, inv.business_date, 'A', inv.sold_at + interval '5 minutes'
  from fx
  join ids m on m.name = p_member
  join ids i on i.name = p_invoice
  join public.invoices inv on inv.id = i.id;
$$;

create function pg_temp.refuse(p_invoice text, p_member text, p_reason text)
returns void
language sql
as $$
  insert into public.loyalty_refusals (tenant_id, store_id, membership_id, invoice_id, business_date, matched_path, reason)
  select fx.tenant_a, inv.store_id, m.id, inv.id, inv.business_date, 'A', p_reason
  from fx
  join ids m on m.name = p_member
  join ids i on i.name = p_invoice
  join public.invoices inv on inv.id = i.id;
$$;

create function pg_temp.checkin(p_member text, p_store uuid, p_recorded timestamptz, p_status text, p_code text)
returns void
language sql
as $$
  insert into public.pending_checkins (tenant_id, store_id, membership_id, code, created_at, expires_at, recorded_at, status)
  select fx.tenant_a, p_store, m.id, p_code, p_recorded - interval '1 minute', p_recorded + interval '1 minute', p_recorded, p_status::public.checkin_status
  from fx
  join ids m on m.name = p_member;
$$;

-- Ca 1 of store 1: two earns naming the shift, one earn placed by its time of sale, a daily-cap refusal
-- naming the shift and an excluded-phone refusal placed by time.
select pg_temp.invoice('e1', (select store_1 from fx), timestamptz '2026-11-10 08:00+07', 'sa-shift-b');
select pg_temp.invoice('e2', (select store_1 from fx), timestamptz '2026-11-10 09:00+07', 'sa-shift-b');
select pg_temp.invoice('e3', (select store_1 from fx), timestamptz '2026-11-10 10:00+07', null);
select pg_temp.invoice('r1', (select store_1 from fx), timestamptz '2026-11-10 10:30+07', 'sa-shift-b');
select pg_temp.invoice('r2', (select store_1 from fx), timestamptz '2026-11-10 11:00+07', null);
-- Ca 2 of store 1: an earn placed by time, a below-minimum refusal naming the shift, a manual adjustment,
-- a check-in without an invoice, and a queued check-in that does not count.
select pg_temp.invoice('e4', (select store_1 from fx), timestamptz '2026-11-10 14:00+07', null);
select pg_temp.invoice('r3', (select store_1 from fx), timestamptz '2026-11-10 15:00+07', 'sa-shift-a');
-- The day before at store 1, without a shift, and the day after at store 2.
select pg_temp.invoice('e5', (select store_1 from fx), timestamptz '2026-11-09 10:00+07', null);
select pg_temp.invoice('e6', (select store_2 from fx), timestamptz '2026-11-11 10:00+07', null);

select pg_temp.earn('e1', 'm1');
select pg_temp.earn('e2', 'm2');
select pg_temp.earn('e3', 'm3');
select pg_temp.earn('e4', 'm1');
select pg_temp.earn('e5', 'm2');
select pg_temp.earn('e6', 'm3');
select pg_temp.refuse('r1', 'm4', 'daily_cap');
select pg_temp.refuse('r2', 'm4', 'excluded_phone');
select pg_temp.refuse('r3', 'm2', 'below_minimum');

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, reason, approved_by, business_date, occurred_at)
select fx.tenant_a, fx.programme_a, (select id from ids where name = 'm1'), fx.store_1, 'adjust'::public.loyalty_entry_kind, 1, 'Bù dấu do máy in lỗi', fx.owner_a, fx.day, timestamptz '2026-11-10 13:00+07' from fx
union all
select fx.tenant_a, fx.programme_a, (select id from ids where name = 'm2'), fx.store_2, 'adjust', -1, 'Thu lại dấu tích nhầm', fx.owner_a, fx.day, timestamptz '2026-11-10 09:00+07' from fx;

select pg_temp.checkin('m3', (select store_1 from fx), timestamptz '2026-11-10 22:00+07', 'recorded', '810001');
select pg_temp.checkin('m4', (select store_1 from fx), timestamptz '2026-11-10 21:00+07', 'queued', '810002');
select pg_temp.checkin('m4', (select store_1 from fx), timestamptz '2026-11-10 23:30+07', 'rejected', '810003');

create function pg_temp.as_user(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.report(p_stores uuid[], p_from date, p_to date)
returns text
language sql
as $$
  select coalesce(string_agg(
    concat_ws('|',
      case a.store_id when (select store_1 from fx) then 's1' when (select store_2 from fx) then 's2' else '?' end,
      a.business_date,
      coalesce('Ca ' || a.shift_number, 'none'),
      'earns ' || a.earns,
      'refusals ' || a.refusals_total || ' ' || a.refusals::text,
      'adjust ' || a.adjustments,
      'checkins ' || a.checkins_without_invoice
    ),
    E'\n' order by a.business_date, a.store_id = (select store_2 from fx), a.shift_number nulls last
  ), 'none')
  from public.loyalty_shift_anomalies(p_stores, p_from, p_to) a;
$$;

grant select on fx, ids to authenticated;

set local role authenticated;

select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  concat_ws(E'\n',
    's1|2026-11-10|Ca 1|earns 3|refusals 2 {"daily_cap": 1, "excluded_phone": 1}|adjust 0|checkins 0',
    's1|2026-11-10|Ca 2|earns 1|refusals 1 {"below_minimum": 1}|adjust 1|checkins 1',
    's1|2026-11-10|none|earns 0|refusals 0 {}|adjust 0|checkins 1',
    's2|2026-11-10|Ca 1|earns 0|refusals 0 {}|adjust 1|checkins 0'
  ),
  'the owner gets per store and shift the earns, refusals by reason, manual adjustments and check-ins without an invoice'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx) - 1, (select day from fx) + 1)'),
  concat_ws(E'\n',
    's1|2026-11-09|none|earns 1|refusals 0 {}|adjust 0|checkins 0',
    's1|2026-11-10|Ca 1|earns 3|refusals 2 {"daily_cap": 1, "excluded_phone": 1}|adjust 0|checkins 0',
    's1|2026-11-10|Ca 2|earns 1|refusals 1 {"below_minimum": 1}|adjust 1|checkins 1',
    's1|2026-11-10|none|earns 0|refusals 0 {}|adjust 0|checkins 1',
    's2|2026-11-10|Ca 1|earns 0|refusals 0 {}|adjust 1|checkins 0',
    's2|2026-11-11|none|earns 1|refusals 0 {}|adjust 0|checkins 0'
  ),
  'a wider range adds the days around it, events outside every shift under none'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select string_agg(a.shift_number::text, '','' order by a.shift_number) from public.loyalty_shift_anomalies((select array[store_1] from fx), (select day from fx), (select day from fx)) a where a.shift_number is not null'),
  (select string_agg(app.shift_number(id)::text, ',' order by app.shift_number(id)) from ids where name in ('shift_b', 'shift_a')),
  'shifts are numbered as app.shift_number numbers them'
);
select is(
  (select app.shift_number(id) from ids where name = 'shift_b'),
  1,
  'Ca 1 is the shift opened first, although its external id sorts last'
);
select is(
  pg_temp.as_user((select viewer_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  'a viewer reads the same report'
);
select is(
  pg_temp.as_user((select manager_1 from fx), 'select string_agg(distinct case a.store_id when (select store_1 from fx) then ''s1'' else ''other'' end, '','') from public.loyalty_shift_anomalies((select array[store_1, store_2] from fx), (select day from fx), (select day from fx)) a'),
  's1',
  'a manager of store 1 gets store 1 only, whatever stores it names'
);
select is(
  pg_temp.as_user((select staff_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  '0',
  'staff get no row'
);
select is(
  pg_temp.as_user((select publisher_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  '0',
  'the publisher gets no row'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies(''{}''::uuid[], (select day from fx), (select day from fx))'),
  '0',
  'no store gives no row'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies(array(select gen_random_uuid() from generate_series(1, 51)), (select day from fx), (select day from fx))'),
  'error:22023',
  'more than 50 stores give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies(null, (select day from fx), (select day from fx))'),
  'error:22023',
  'null stores give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1] from fx), (select day from fx) - 92, (select day from fx))'),
  'error:22023',
  '93 days give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1] from fx), (select day from fx) - 91, (select day from fx))'),
  '4',
  '92 days are answered'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1] from fx), (select day from fx), (select day from fx) - 1)'),
  'error:22023',
  'a range whose start is after its end gives 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.loyalty_shift_anomalies((select array[store_1] from fx), null, (select day from fx))'),
  'error:22023',
  'a missing date gives 22023'
);

reset role;

select is(
  (select pg_get_function_result('public.loyalty_shift_anomalies(uuid[], date, date)'::regprocedure) ~* 'name|cashier|label|external'),
  false,
  'no column carries a cashier name, the POS shift label or its external id'
);
select is(
  (select (p.provolatile, p.prosecdef, 'search_path=""' = any (p.proconfig)) from pg_proc p where p.oid = 'public.loyalty_shift_anomalies(uuid[], date, date)'::regprocedure),
  ('s'::"char", false, true),
  'the report is stable, security invoker and pins an empty search_path, like the other report functions'
);
select ok(not has_function_privilege('anon', 'public.loyalty_shift_anomalies(uuid[], date, date)', 'execute'), 'anon cannot execute the report');
select ok(has_function_privilege('authenticated', 'public.loyalty_shift_anomalies(uuid[], date, date)', 'execute'), 'authenticated executes the report');
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.tenant_id = (select tenant_a from fx) and l.entry_kind = 'adjust' and l.reason = 'welcome' and l.store_id = (select store_1 from fx)),
  1,
  'the fixture holds a welcome adjustment at store 1 on the day, which the report leaves out'
);

select * from finish();
rollback;
