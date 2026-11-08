begin;
select plan(45);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as both_stores,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid as tea_staff_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as other_store_id,
  '77777777-7777-4777-8777-777777777777'::uuid as other_pos_account_id,
  min(i.business_date) as period_from,
  max(i.business_date) as period_to
from public.invoices i
where i.tenant_id = '11111111-1111-4111-8111-111111111111';

select app.refresh_analytics(f.demo_tenant_id, f.period_from, f.period_to) from fixture f;

create temp table demo_invoices as
select i.*
from public.invoices i, fixture f
where i.tenant_id = f.demo_tenant_id
  and i.business_date between f.period_from and f.period_to;

create temp table demo_sales as
select * from demo_invoices where status <> 'voided';

create temp table demo_item_lines as
select l.*, i.pos_account_id
from public.invoice_lines l
join demo_sales i on i.id = l.invoice_id
where l.line_kind = 'item';

create temp table store_day_hours as
select
  d.store_id,
  d.business_date,
  (
    select coalesce(sum(extract(epoch from (p.span ->> 1)::time - (p.span ->> 0)::time) / 3600), 0)
    from jsonb_array_elements(s.opening_hours -> to_char(d.business_date, 'dy')) as p (span)
  ) as opening_hours
from (select distinct store_id, business_date from demo_invoices) d
join public.stores s on s.id = d.store_id;

create temp table invoice_roles as
select
  l.invoice_id,
  bool_or(r.role = 'drink') as has_drink,
  bool_or(r.role = 'snack') as has_snack,
  bool_or(r.role = 'topping') as has_topping
from demo_item_lines l
left join public.item_type_roles r on r.pos_account_id = l.pos_account_id and r.item_type_external_id = l.item_type_external_id
group by l.invoice_id;

create temp table expected as
with sales as (
  select
    count(*) as invoices,
    sum(s.net_amount) as net_amount,
    sum(s.gross_amount) as gross_amount,
    sum(s.paid_amount) as paid_amount,
    sum(s.item_discount_amount + s.bill_discount_amount + s.extra_discount_amount + s.voucher_amount) as discount_amount,
    count(*) filter (where s.voucher_amount > 0 or s.voucher_code is not null) as voucher_invoices,
    count(*) filter (where s.customer_phone is not null) as member_invoices,
    count(*) filter (where s.customer_phone is not null or s.customer_id is not null) as identified_invoices,
    sum(s.net_amount) filter (where extract(hour from s.sold_at at time zone st.timezone) in (20, 21)) as peak_net_amount,
    sum(s.net_amount) filter (where extract(hour from s.sold_at at time zone st.timezone) in (17, 18)) as dead_hour_net_amount,
    count(*) filter (where s.status = 'edited') as edited_invoices
  from demo_sales s
  join public.stores st on st.id = s.store_id
),
lines as (
  select
    count(*) as item_lines,
    sum(l.quantity) as quantity,
    sum(l.quantity) filter (where l.size_label = 'L') as size_l_quantity,
    sum(l.quantity) filter (where l.size_label is not null) as sized_quantity
  from demo_item_lines l
),
cash as (
  select sum(p.amount) as cash_amount
  from public.invoice_payments p
  join demo_sales s on s.id = p.invoice_id
  join public.payment_methods pm on pm.pos_account_id = s.pos_account_id and pm.external_id = p.payment_method_external_id
  where pm.kind = 'cash'
),
attach as (
  select
    count(*) filter (where r.has_drink) as drink_invoices,
    count(*) filter (where r.has_drink and r.has_snack) as snack_invoices,
    count(*) filter (where r.has_drink and r.has_topping) as topping_invoices,
    exists (
      select 1 from public.item_type_roles t, fixture f where t.tenant_id = f.demo_tenant_id and t.role = 'topping'
    ) as topping_mapped
  from invoice_roles r
),
adjustments as (
  select
    (select count(*) from demo_invoices i where i.status = 'voided') as voided_invoices,
    (select count(*) from demo_invoices) as all_invoices,
    (
      select count(*)
      from public.invoice_events e
      join public.stores st on st.id = e.store_id
      cross join fixture f
      where e.tenant_id = f.demo_tenant_id
        and e.kind = 'line_removed'
        and ((e.occurred_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date between f.period_from and f.period_to
    ) as removed_lines
),
hours as (
  select sum(h.opening_hours) as opening_hours from store_day_hours h
)
select v.metric_id, v.value
from sales s, lines l, cash c, attach a, adjustments j, hours h,
  lateral (
    values
      ('net_revenue', s.net_amount),
      ('gross_revenue', s.gross_amount),
      ('invoices', s.invoices::numeric),
      ('avg_ticket', round(s.net_amount / s.invoices, 2)),
      ('items_per_ticket', round(l.quantity / s.invoices, 4)),
      ('avg_item_price', round(s.net_amount / l.quantity, 2)),
      ('cash_share', round(c.cash_amount / s.paid_amount, 6)),
      ('voucher_invoice_share', round(s.voucher_invoices::numeric / s.invoices, 6)),
      ('member_invoice_share', round(s.member_invoices::numeric / s.invoices, 6)),
      ('discount_rate', round(s.discount_amount / s.gross_amount, 6)),
      ('attach_rate_topping', case when a.topping_mapped then round(a.topping_invoices::numeric / a.drink_invoices, 6) end),
      ('attach_rate_snack', round(a.snack_invoices::numeric / a.drink_invoices, 6)),
      ('size_l_share', round(l.size_l_quantity / l.sized_quantity, 6)),
      ('sales_per_opening_hour', round(s.net_amount / h.opening_hours, 2)),
      ('invoices_per_opening_hour', round(s.invoices / h.opening_hours, 4)),
      ('peak_share_20_21', round(s.peak_net_amount / s.net_amount, 6)),
      ('dead_hour_share_17_18', round(s.dead_hour_net_amount / s.net_amount, 6)),
      ('void_rate', round(j.voided_invoices::numeric / j.all_invoices, 6)),
      ('edit_rate', round(s.edited_invoices::numeric / s.invoices, 6)),
      ('removed_line_rate', round(j.removed_lines::numeric / l.item_lines, 6)),
      ('customer_capture_rate', round(s.identified_invoices::numeric / s.invoices, 6))
  ) as v (metric_id, value);

select is(
  public.metric_value(f.both_stores, e.metric_id, f.period_from, f.period_to),
  e.value,
  format('%s over both demo stores equals the computation from the fact tables', e.metric_id)
)
from expected e, fixture f
order by e.metric_id;

select is(
  (
    select (
      public.metric_value(f.both_stores, 'net_revenue', f.period_from - 400, f.period_from - 300),
      public.metric_value(f.both_stores, 'invoices', f.period_from - 400, f.period_from - 300),
      public.metric_value(f.both_stores, 'avg_ticket', f.period_from - 400, f.period_from - 300),
      public.metric_value(f.both_stores, 'void_rate', f.period_from - 400, f.period_from - 300)
    )
    from fixture f
  ),
  (null::numeric, null::numeric, null::numeric, null::numeric),
  'a period without synced sales has no value, not zero'
);
select is(
  (select public.metric_value(f.both_stores, 'attach_rate_topping', f.period_from, f.period_to) from fixture f),
  null::numeric,
  'the topping attach rate is null while no item type carries the topping role'
);

select is(app.opening_minutes('{"sat": [["07:00", "12:00"], ["16:00", "23:00"]]}', '2026-11-14'), 720, 'a split opening day adds its spans');
select is(app.opening_minutes('{"sun": [["18:00", "02:00"]]}', '2026-11-15'), 480, 'a span that closes after midnight counts up to its close');
select is(app.opening_minutes('{"mon": [["07:00", "22:30"]]}', '2026-11-10'), 0, 'a weekday without spans is a closed day');
select is(app.opening_minutes(null, '2026-11-10'), null::integer, 'opening hours that were never entered stay unknown');

select throws_ok(
  $$ select public.metric_value(array['22222222-2222-4222-8222-000000000001']::uuid[], 'no_such_metric', current_date - 7, current_date) $$,
  '22023',
  null,
  'an unknown metric id raises invalid_parameter_value'
);
select throws_ok(
  $$ select public.metric_value(array['22222222-2222-4222-8222-000000000001']::uuid[], 'same_weekday_baseline', current_date - 7, current_date) $$,
  '22023',
  null,
  'a metric without one value per store and period raises invalid_parameter_value'
);
select throws_ok(
  $$ select public.metric_value(array['22222222-2222-4222-8222-000000000001']::uuid[], 'revpash', current_date - 7, current_date) $$,
  '22023',
  null,
  'a metric whose status is not available now raises invalid_parameter_value'
);
select throws_ok(
  $$ select public.metric_value(array['22222222-2222-4222-8222-000000000001']::uuid[], 'net_revenue', current_date, current_date - 1) $$,
  '22023',
  null,
  'a range that starts after it ends raises invalid_parameter_value'
);

select is(has_function_privilege('anon', 'public.metric_value(uuid[], text, date, date)', 'execute'), false, 'anon cannot execute metric_value');
select is(
  (
    has_function_privilege('authenticated', 'public.metric_value(uuid[], text, date, date)', 'execute'),
    has_function_privilege('service_role', 'public.metric_value(uuid[], text, date, date)', 'execute'),
    has_function_privilege('authenticated', 'app.opening_minutes(jsonb, date)', 'execute')
  ),
  (true, true, true),
  'authenticated and service_role can execute metric_value and its opening-hours helper'
);
select is(
  (
    select (p.prosecdef, p.provolatile, 'search_path=""' = any (p.proconfig))
    from pg_proc p
    where p.oid = 'public.metric_value(uuid[], text, date, date)'::regprocedure
  ),
  (false, 's'::"char", true),
  'metric_value is security invoker, stable and pins an empty search_path'
);

update public.item_type_roles r
set role = 'topping'
from fixture f
where r.tenant_id = f.demo_tenant_id
  and r.item_type_external_id = 'type-02';

select app.refresh_analytics(f.demo_tenant_id, f.period_from, f.period_to) from fixture f;

select is(
  (select public.metric_value(f.both_stores, 'attach_rate_topping', f.period_from, f.period_to) from fixture f),
  (
    select round(count(*) filter (where x.has_drink and x.has_topping)::numeric / count(*) filter (where x.has_drink), 6)
    from (
      select l.invoice_id, bool_or(r.role = 'drink') as has_drink, bool_or(r.role = 'topping') as has_topping
      from demo_item_lines l
      left join public.item_type_roles r on r.pos_account_id = l.pos_account_id and r.item_type_external_id = l.item_type_external_id
      group by l.invoice_id
    ) x
  ),
  'once a topping role is mapped the attach rate is drink invoices with a topping over drink invoices'
);

insert into auth.users (id, instance_id, aud, role, email)
select tea_staff_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'staff@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_staff_id, 'staff'::public.tenant_role, array[tea_store_id] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'ipos-fabi', 'other-account', 'Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'store-ext-999', 'Store A' from fixture;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount)
select f.other_tenant_id, f.other_store_id, f.other_pos_account_id, 'tran-other-' || n, (f.period_to + time '12:00') at time zone 'Asia/Ho_Chi_Minh', f.period_to, 10000, 10000, 10000
from fixture f
cross join generate_series(1, 3) as n;

select app.refresh_analytics(f.other_tenant_id, f.period_from, f.period_to) from fixture f;

create temp table scoped_expected as
select
  (select count(*)::numeric from demo_sales s, fixture f where s.store_id = f.tea_store_id) as tea_invoices;

grant select on fixture, expected, scoped_expected to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select is(
  (select public.metric_value(f.both_stores || f.other_store_id, 'net_revenue', f.period_from, f.period_to) from fixture f),
  (select value from expected where metric_id = 'net_revenue'),
  'a store of another tenant adds nothing to the demo owner''s net revenue'
);
select is(
  (select public.metric_value(f.both_stores || f.other_store_id, 'sales_per_opening_hour', f.period_from, f.period_to) from fixture f),
  (select value from expected where metric_id = 'sales_per_opening_hour'),
  'an invisible store without opening hours neither adds sales nor voids the demo owner''s sales per opening hour'
);
select is(
  (select public.metric_value(array[f.other_store_id], 'invoices', f.period_from, f.period_to) from fixture f),
  null::numeric,
  'the demo owner reads no invoice of the other tenant''s store'
);

set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select is(
  (select public.metric_value(f.both_stores, 'invoices', f.period_from, f.period_to) from fixture f),
  (select tea_invoices from scoped_expected),
  'a member limited to the tea store gets the invoices of the tea store only'
);

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is(
  (select public.metric_value(array[f.other_store_id], 'invoices', f.period_from, f.period_to) from fixture f),
  3::numeric,
  'the other owner counts the invoices of the own store'
);
select is(
  (select public.metric_value(f.both_stores, 'net_revenue', f.period_from, f.period_to) from fixture f),
  null::numeric,
  'the other owner reads nothing of the demo stores'
);

reset role;

update public.stores s set opening_hours = null from fixture f where s.id = f.tea_store_id;

select is(
  (select public.metric_value(array[f.tea_store_id], 'sales_per_opening_hour', f.period_from, f.period_to) from fixture f),
  null::numeric,
  'sales per opening hour is null for a store without opening hours'
);
select is(
  (
    select (
      public.metric_value(f.both_stores, 'sales_per_opening_hour', f.period_from, f.period_to),
      public.metric_value(f.both_stores, 'invoices_per_opening_hour', f.period_from, f.period_to)
    )
    from fixture f
  ),
  (null::numeric, null::numeric),
  'one store with sales and without opening hours makes the multi-store per-hour figures null'
);
select isnt(
  (select public.metric_value(array[f.coffee_store_id], 'sales_per_opening_hour', f.period_from, f.period_to) from fixture f),
  null::numeric,
  'the store that has opening hours is still measured'
);

set local role anon;

select throws_ok(
  $$ select public.metric_value(array['22222222-2222-4222-8222-000000000001']::uuid[], 'net_revenue', current_date - 7, current_date) $$,
  '42501',
  null,
  'anon cannot call metric_value'
);

select * from finish();
rollback;
