begin;
select plan(29);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009801'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000009801'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000009801'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000009802'::uuid as store_2,
  'ffffffff-ffff-4fff-8fff-000000009803'::uuid as store_3,
  'eeeeeeee-eeee-4eee-8eee-000000009801'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000009802'::uuid as manager_1,
  'eeeeeeee-eeee-4eee-8eee-000000009803'::uuid as viewer_2,
  'eeeeeeee-eeee-4eee-8eee-000000009804'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000009805'::uuid as publisher_a,
  date '2026-11-10' as day;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'member-share-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_a, fx.manager_1, fx.viewer_2, fx.staff_a, fx.publisher_a]) as u (id);

insert into public.tenants (id, slug, name) select tenant_a, 'member-share-pgtap', 'Member share pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'member-share', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, business_day_start_minutes)
select store_1, tenant_a, account_a, 'ms-1', 'Synthetic store 1', 0 from fx
union all
select store_2, tenant_a, account_a, 'ms-2', 'Synthetic store 2', 240 from fx
union all
select store_3, tenant_a, account_a, 'ms-3', 'Synthetic store 3', 0 from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_a, 'owner', null::uuid[]), (fx.manager_1, 'manager', array[fx.store_1]), (fx.viewer_2, 'viewer', array[fx.store_2]),
         (fx.staff_a, 'staff', null::uuid[]), (fx.publisher_a, 'publisher', null::uuid[])
) as m (user_id, role, store_ids);

insert into public.customers (tenant_id, external_id, name) select tenant_a, 'ms-customer', 'Khách tổng hợp' from fx;

insert into public.shifts (tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at)
select tenant_a, store_1, 'ms-b', 'thu.ngan.sang@example.com', 'Thu ngân tổng hợp A', timestamptz '2026-11-10 07:00+07', timestamptz '2026-11-10 12:00+07' from fx
union all
select tenant_a, store_1, 'ms-a', 'Ca POS chiều', 'Thu ngân tổng hợp B', timestamptz '2026-11-10 12:00+07', timestamptz '2026-11-10 22:00+07' from fx
union all
select tenant_a, store_1, 'ms-c', 'Ca POS đêm', 'Thu ngân tổng hợp C', timestamptz '2026-11-10 22:30+07', timestamptz '2026-11-11 01:30+07' from fx
union all
select tenant_a, store_2, 'ms-d', 'Ca POS sáng', 'Thu ngân tổng hợp D', timestamptz '2026-11-10 08:00+07', timestamptz '2026-11-10 12:00+07' from fx
union all
select tenant_a, store_2, 'ms-e', 'Ca POS chiều', 'Thu ngân tổng hợp E', timestamptz '2026-11-10 12:00+07', timestamptz '2026-11-10 18:00+07' from fx
union all
select tenant_a, store_2, 'ms-f', 'Ca POS khuya', 'Thu ngân tổng hợp F', timestamptz '2026-11-11 02:00+07', timestamptz '2026-11-11 03:30+07' from fx;

insert into public.shifts (tenant_id, store_id, external_id, opened_at, closed_at)
select fx.tenant_a, fx.store_3, 'ms-3-' || d.n || '-' || s.n,
  (fx.day - d.n)::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(hours => 6 + s.n),
  (fx.day - d.n)::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(hours => 7 + s.n)
from fx
cross join generate_series(0, 90) as d (n)
cross join generate_series(1, 10) as s (n);

create function pg_temp.invoice(
  p_name text, p_store uuid, p_sold timestamptz, p_business_date date, p_shift text, p_phone text, p_customer boolean, p_status text
)
returns void
language sql
as $$
  insert into public.invoices (
    tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, shift_external_id,
    customer_phone, customer_id, gross_amount, net_amount, paid_amount, status
  )
  select fx.tenant_a, p_store, fx.account_a, 'ms-' || p_name, p_name, p_sold, p_business_date, p_shift,
    p_phone, case when p_customer then (select c.id from public.customers c where c.tenant_id = fx.tenant_a and c.external_id = 'ms-customer') end,
    50000, 50000, 50000, p_status::public.invoice_status
  from fx;
$$;

select pg_temp.invoice('i1', (select store_1 from fx), timestamptz '2026-11-10 08:00+07', date '2026-11-10', 'ms-b', '0900000101', false, 'completed');
select pg_temp.invoice('i2', (select store_1 from fx), timestamptz '2026-11-10 08:30+07', date '2026-11-10', 'ms-b', '0900000102', false, 'edited');
select pg_temp.invoice('i3', (select store_1 from fx), timestamptz '2026-11-10 09:00+07', date '2026-11-10', 'ms-b', null, false, 'completed');
select pg_temp.invoice('i4', (select store_1 from fx), timestamptz '2026-11-10 09:30+07', date '2026-11-10', 'ms-b', '0900000104', false, 'voided');
select pg_temp.invoice('i5', (select store_1 from fx), timestamptz '2026-11-10 10:00+07', date '2026-11-10', 'ms-b', null, true, 'completed');
select pg_temp.invoice('i6', (select store_1 from fx), timestamptz '2026-11-10 13:00+07', date '2026-11-10', 'ms-a', '0900000106', false, 'completed');
select pg_temp.invoice('i7', (select store_1 from fx), timestamptz '2026-11-10 14:00+07', date '2026-11-10', 'ms-a', null, false, 'completed');
select pg_temp.invoice('i8', (select store_1 from fx), timestamptz '2026-11-10 15:00+07', date '2026-11-10', 'ms-a', null, false, 'completed');
select pg_temp.invoice('i9', (select store_1 from fx), timestamptz '2026-11-11 00:30+07', date '2026-11-11', 'ms-c', '0900000109', false, 'completed');
select pg_temp.invoice('i10', (select store_1 from fx), timestamptz '2026-11-10 06:30+07', date '2026-11-10', null, '0900000110', false, 'completed');
select pg_temp.invoice('i11', (select store_1 from fx), timestamptz '2026-11-10 16:00+07', date '2026-11-10', 'ms-missing', null, false, 'completed');
select pg_temp.invoice('i12', (select store_1 from fx), timestamptz '2026-11-10 17:00+07', date '2026-11-10', null, '0900000112', false, 'voided');
select pg_temp.invoice('i13', (select store_1 from fx), timestamptz '2026-11-09 10:00+07', date '2026-11-09', null, null, false, 'completed');
select pg_temp.invoice('j1', (select store_2 from fx), timestamptz '2026-11-10 09:00+07', date '2026-11-10', 'ms-d', '0900000121', false, 'completed');
select pg_temp.invoice('j2', (select store_2 from fx), timestamptz '2026-11-10 10:00+07', date '2026-11-10', 'ms-d', '0900000122', false, 'completed');
select pg_temp.invoice('j3', (select store_2 from fx), timestamptz '2026-11-11 02:30+07', date '2026-11-10', 'ms-f', null, false, 'completed');

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

create function pg_temp.hint_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_hint text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return 'answered';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ' ' || coalesce(v_hint, '');
end;
$$;

create function pg_temp.report(p_stores uuid[], p_from date, p_to date)
returns text
language sql
as $$
  select coalesce(string_agg(
    concat_ws('|',
      case a.store_id when (select store_1 from fx) then 's1' when (select store_2 from fx) then 's2' when (select store_3 from fx) then 's3' else '?' end,
      a.business_date,
      coalesce('Ca ' || a.shift_ordinal, 'none'),
      a.invoices,
      a.member_invoices,
      a.identified_invoices,
      coalesce(a.member_share::text, 'null'),
      coalesce(a.identified_share::text, 'null')
    ),
    E'\n' order by a.ordinality
  ), 'none')
  from public.member_share_by_shift(p_stores, p_from, p_to) with ordinality a;
$$;

create temp table expected as
select concat_ws(E'\n',
  's1|2026-11-10|Ca 1|4|2|3|0.500000|0.750000',
  's1|2026-11-10|Ca 2|3|1|1|0.333333|0.333333',
  's1|2026-11-10|Ca 3|1|1|1|1.000000|1.000000',
  's1|2026-11-10|none|2|1|1|0.500000|0.500000',
  's2|2026-11-10|Ca 1|2|2|2|1.000000|1.000000',
  's2|2026-11-10|Ca 2|0|0|0|null|null',
  's2|2026-11-10|Ca 3|1|0|0|0.000000|0.000000'
) as both_stores;

grant select on fx, expected to authenticated, service_role;

set local role authenticated;

select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  (select both_stores from expected),
  'per store and shift: the non-voided invoices, those with a phone, those with a phone or a customer id and both shares, equal to the hand calculation; a voided invoice counts nowhere, a shift without invoices gives zeros and null shares, and invoices naming no shift of the store form one Không rõ ca row'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_2, store_1] from fx), (select day from fx), (select day from fx))'),
  concat_ws(E'\n',
    's2|2026-11-10|Ca 1|2|2|2|1.000000|1.000000',
    's2|2026-11-10|Ca 2|0|0|0|null|null',
    's2|2026-11-10|Ca 3|1|0|0|0.000000|0.000000',
    's1|2026-11-10|Ca 1|4|2|3|0.500000|0.750000',
    's1|2026-11-10|Ca 2|3|1|1|0.333333|0.333333',
    's1|2026-11-10|Ca 3|1|1|1|1.000000|1.000000',
    's1|2026-11-10|none|2|1|1|0.500000|0.500000'
  ),
  'rows follow the order of store_ids within a business date'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1] from fx), (select day from fx) + 1, (select day from fx) + 1)'),
  'none',
  'an invoice sold after midnight counts in the shift opened the evening before, on that shift''s business date'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1] from fx), (select day from fx) - 1, (select day from fx) + 1)'),
  concat_ws(E'\n',
    's1|2026-11-09|none|1|0|0|0.000000|0.000000',
    's1|2026-11-10|Ca 1|4|2|3|0.500000|0.750000',
    's1|2026-11-10|Ca 2|3|1|1|0.333333|0.333333',
    's1|2026-11-10|Ca 3|1|1|1|1.000000|1.000000',
    's1|2026-11-10|none|2|1|1|0.500000|0.500000'
  ),
  'a wider range adds the day before, whose only invoice names no shift'
);
select is(
  pg_temp.as_user((select owner_a from fx), $q$
    select string_agg(to_char(a.opened_at at time zone 'Asia/Ho_Chi_Minh', 'MM-DD HH24:MI') || ' Ca ' || a.shift_ordinal, ', ' order by a.opened_at)
    from public.member_share_by_shift((select array[store_1, store_2] from fx), (select day from fx), (select day from fx)) a
    where a.shift_ordinal is not null
  $q$),
  pg_temp.as_user((select owner_a from fx), $q$
    select string_agg(to_char(sh.opened_at at time zone 'Asia/Ho_Chi_Minh', 'MM-DD HH24:MI') || ' Ca ' || app.shift_number(sh.id), ', ' order by sh.opened_at)
    from public.shifts sh
    where sh.store_id in ((select store_1 from fx), (select store_2 from fx))
  $q$),
  'shift ordinals equal app.shift_number: by opening time under each store''s day-start rule, whatever the external ids'
);
select is(
  pg_temp.as_user((select manager_1 from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  (select string_agg(line, E'\n') from regexp_split_to_table((select both_stores from expected), E'\n') as line where line like 's1|%'),
  'a manager of store 1 gets store 1 only, whatever stores the call names'
);
select is(
  pg_temp.as_user((select viewer_2 from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  (select string_agg(line, E'\n') from regexp_split_to_table((select both_stores from expected), E'\n') as line where line like 's2|%'),
  'a viewer of store 2 gets store 2 only'
);
select is(
  pg_temp.as_user((select staff_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  (select both_stores from expected),
  'staff read the counts while the tenant lets staff read all revenue'
);
select is(
  pg_temp.as_user((select publisher_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  '0',
  'the publisher gets no row'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift(''{}''::uuid[], (select day from fx), (select day from fx))'),
  '0',
  'no store gives no row'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift(array(select gen_random_uuid() from generate_series(1, 51)), (select day from fx), (select day from fx))'),
  'error:22023',
  'more than 50 stores give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift(null, (select day from fx), (select day from fx))'),
  'error:22023',
  'null stores give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1] from fx), (select day from fx) - 92, (select day from fx))'),
  'error:22023',
  '93 days give 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1] from fx), (select day from fx) - 91, (select day from fx))'),
  '5',
  '92 days are answered'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1] from fx), (select day from fx), (select day from fx) - 1)'),
  'error:22023',
  'a range whose start is after its end gives 22023'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1] from fx), null, (select day from fx))'),
  'error:22023',
  'a missing date gives 22023'
);
select is(
  pg_temp.hint_as((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_3] from fx), (select day from fx) - 89, (select day from fx))'),
  'answered',
  'exactly 900 rows are answered'
);
select is(
  pg_temp.hint_as((select owner_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_3] from fx), (select day from fx) - 90, (select day from fx))'),
  '22023 Ask for fewer stores, a shorter range or a coarser grain.',
  '910 rows give 22023 with the hint to ask for less'
);

reset role;

select is(
  (
    select array_agg(a.name order by a.position)
    from unnest(
      (select p.proargnames from pg_proc p where p.oid = 'public.member_share_by_shift(uuid[], date, date)'::regprocedure),
      (select p.proargmodes::text[] from pg_proc p where p.oid = 'public.member_share_by_shift(uuid[], date, date)'::regprocedure)
    ) with ordinality as a (name, mode, position)
    where a.mode = 't'
  ),
  array['store_id', 'business_date', 'shift_ordinal', 'opened_at', 'closed_at', 'invoices', 'member_invoices', 'identified_invoices', 'member_share', 'identified_share'],
  'the report returns exactly its ten columns'
);
select is(
  (select pg_get_function_result('public.member_share_by_shift(uuid[], date, date)'::regprocedure) ~* 'phone|customer_id|cashier|name|mail|label|external'),
  false,
  'no column carries a phone, a customer id, a cashier name, an e-mail, the POS shift label or its external id'
);
select is(
  (select (p.provolatile, p.prosecdef, 'search_path=""' = any (p.proconfig)) from pg_proc p where p.oid = 'public.member_share_by_shift(uuid[], date, date)'::regprocedure),
  ('s'::"char", false, true),
  'the report is stable, security invoker and pins an empty search_path'
);
select ok(not has_function_privilege('anon', 'public.member_share_by_shift(uuid[], date, date)', 'execute'), 'anon cannot execute the report');
select ok(
  has_function_privilege('authenticated', 'public.member_share_by_shift(uuid[], date, date)', 'execute')
    and has_function_privilege('service_role', 'public.member_share_by_shift(uuid[], date, date)', 'execute'),
  'authenticated and service_role execute the report'
);
select is(
  (
    select array_agg(a.attname::text || ' ' || a.attgenerated::text order by a.attname)
    from pg_attribute a
    where a.attrelid = 'public.invoices'::regclass
      and a.attname in ('has_customer_phone', 'has_customer_identity')
  ),
  array['has_customer_identity s', 'has_customer_phone s'],
  'the member and identity flags are stored generated columns of invoices'
);

set local role service_role;
select is(
  pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx)),
  (select both_stores from expected),
  'the service role gets every requested store'
);
reset role;

update public.tenants set staff_revenue_visibility = 'none' where id = (select tenant_a from fx);
set local role authenticated;
select is(
  pg_temp.as_user((select staff_a from fx), 'select count(*) from public.member_share_by_shift((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  '0',
  'staff get no row once the tenant hides revenue from staff'
);
reset role;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into v_columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'invoices'
    and c.column_name not in ('customer_phone', 'customer_id', 'customer_name');
  revoke select on public.invoices from authenticated;
  execute format('grant select (%s) on public.invoices to authenticated', v_columns);
end;
$$;

set local role authenticated;
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*) filter (where customer_phone is not null)::text from public.invoices'),
  'error:42501',
  'with the customer columns locked, an owner can no longer read a phone'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select pg_temp.report((select array[store_1, store_2] from fx), (select day from fx), (select day from fx))'),
  (select both_stores from expected),
  'with the customer columns locked, the report still counts the same members, as it reads only the stored flags'
);
select is(
  pg_temp.as_user((select owner_a from fx), 'select count(*)::text from public.invoices where has_customer_phone'),
  '9',
  'the flag still reads where the phone does not'
);

reset role;

select * from finish();
rollback;
