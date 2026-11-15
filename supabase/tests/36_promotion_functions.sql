begin;
select plan(57);

create temp table fixture as
select
  'dddddddd-dddd-4ddd-8ddd-000000003601'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003611'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003621'::uuid as store_a,
  'dddddddd-dddd-4ddd-8ddd-000000003622'::uuid as store_b,
  'dddddddd-dddd-4ddd-8ddd-000000003623'::uuid as store_c,
  'dddddddd-dddd-4ddd-8ddd-000000003624'::uuid as store_d,
  'dddddddd-dddd-4ddd-8ddd-000000003625'::uuid as store_e,
  'dddddddd-dddd-4ddd-8ddd-000000003626'::uuid as store_f,
  'dddddddd-dddd-4ddd-8ddd-000000003627'::uuid as store_g,
  'dddddddd-dddd-4ddd-8ddd-000000003628'::uuid as store_h,
  '2025-05-26'::date as history_from,
  '2025-07-21'::date as window_from,
  '2025-08-17'::date as window_to;

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-promotions', 'Promotions' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-promotions', 'Promotions POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select s.id, f.tenant_id, f.account_id, s.external_id, s.name
from fixture f
cross join lateral (
  values
    (f.store_a, 'promo-a', 'Store A'),
    (f.store_b, 'promo-b', 'Store B'),
    (f.store_c, 'promo-c', 'Store C'),
    (f.store_d, 'promo-d', 'Store D'),
    (f.store_e, 'promo-e', 'Store E'),
    (f.store_f, 'promo-f', 'Store F'),
    (f.store_g, 'promo-g', 'Store G'),
    (f.store_h, 'promo-h', 'Store H')
) as s (id, external_id, name);

insert into public.promotions (tenant_id, pos_account_id, external_id, name, active)
select f.tenant_id, f.account_id, p.external_id, p.name, p.active
from fixture f
cross join (values ('KM-LIFT', 'Mua 2 tặng 1', true), ('KM-NEVER', 'Chưa dùng', false)) as p (external_id, name, active);

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, gross_amount, net_amount)
select f.tenant_id, s.store_id, d::date, 10, s.gross, s.gross
from fixture f
cross join generate_series(f.history_from, f.window_to, interval '1 day') d
cross join lateral (
  select (d::date - f.history_from) as t
) i
cross join lateral (
  values
    (f.store_a, 100000 + 1000 * i.t + case when d::date between '2025-08-05' and '2025-08-07' then 30000 else 0 end, true),
    (f.store_b, 80000 + 1000 * i.t, true),
    (f.store_c, 50000, true),
    (f.store_d, 60000, d::date >= f.window_from),
    (f.store_e, 1000000 + 10000 * i.t, true)
) as s (store_id, gross, present)
where s.present;

create temp table sale as
select *
from (
  values
    ('A-CAT', 'store_a', '2025-06-15'::date, 100000, 0, 10000, 'BILL-CAT', 'VOUCHER-CAT', 3000, null::text, null::text, null::text, 0, 0),
    ('A-ONE', 'store_a', '2025-08-12'::date, 50000, 5000, 0, null, null, 0, 'TEA', 'KM-ONE', 'Một ngày', 50000, 5000),
    ('G-30', 'store_g', '2025-09-10'::date, 100000, 30000, 0, null, null, 0, 'COF', 'KM-30', 'Giảm 30', 100000, 30000),
    ('G-60', 'store_g', '2025-09-10'::date, 100000, 60000, 0, null, null, 0, 'COF', 'KM-60', 'Giảm 60', 100000, 60000),
    ('G-BILL', 'store_g', '2025-09-10'::date, 100000, 0, 60000, 'BILL-60', null, 0, 'COF', null, null, 100000, 0),
    ('G-GIFT-1', 'store_g', '2025-09-10'::date, 100000, 60000, 4000, 'BILL-10', null, 0, 'CAKE', 'KM-GIFT', 'Tặng bánh', 60000, 60000),
    ('G-MIX-1', 'store_g', '2025-10-05'::date, 100000, 10000, 0, null, null, 0, 'COF', 'KM-MIX', 'Giảm giá', 100000, 10000),
    ('G-MIX-2', 'store_g', '2025-10-05'::date, 100000, 10000, 0, null, null, 0, 'COF', 'KM-MIX', null, 100000, 10000),
    ('F-OLD', 'store_f', '2025-07-01'::date, 50000, 5000, 0, null, null, 0, 'TEA', 'KM-LIFT', 'Mua 2 tặng 1', 50000, 5000),
    ('G-GIFT-2', 'store_g', '2025-09-11'::date, 100000, 30000, 0, null, null, 0, 'CAKE', 'KM-GIFT', 'Tặng bánh', 30000, 30000),
    ('H-VOUCHER', 'store_h', '2025-12-28'::date, 50000, 0, 0, null, 'VOUCHER-H', 5000, 'TEA', null, null, 50000, 0),
    ('H-GIFT', 'store_h', '2025-12-29'::date, 50000, 50000, 0, null, null, 0, 'TEA', 'KM-H-GIFT', 'Tặng trà', 50000, 50000),
    ('H-BILL', 'store_h', '2025-12-30'::date, 50000, 0, 5000, 'BILL-H', null, 0, 'TEA', null, null, 50000, 0),
    ('H-LINE', 'store_h', '2025-12-31'::date, 50000, 10000, 4000, 'BILL-H', null, 0, 'TEA', 'KM-H', 'Giảm trà', 50000, 10000),
    ('H-NEW', 'store_h', '2026-01-01'::date, 50000, 10000, 0, null, null, 0, 'TEA', 'KM-H', 'Giảm trà', 50000, 10000)
) as v (external_id, store, on_date, gross, item_discount, bill, bill_name, voucher_name, voucher, item, promotion_id, promotion_name, line_gross, line_discount)
union all
select 'A-LIFT-' || to_char(d, 'MMDD') || '-' || n, 'store_a', d::date, 50000, 5000, 0, null, null, 0, 'TEA', 'KM-LIFT', 'Mua 2 tặng 1', 50000, 5000
from generate_series('2025-08-05'::date, '2025-08-07'::date, interval '1 day') d
cross join generate_series(1, 2) n
union all
select 'C-ALL-' || to_char(d, 'MMDD'), 'store_c', d::date, 20000, 2000, 0, null, null, 0, 'TEA', 'KM-ALL', 'Cả tháng', 20000, 2000
from generate_series('2025-07-21'::date, '2025-08-17'::date, interval '1 day') d
union all
select 'D-' || to_char(d, 'MMDD'), 'store_d', d::date, 20000, 2000, 0, null, null, 0, 'TEA', 'KM-D', 'Cửa hàng mới', 20000, 2000
from generate_series('2025-07-22'::date, '2025-07-24'::date, interval '1 day') d;

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, item_discount_amount,
  bill_discount_amount, extra_discount_amount, bill_discount_name, voucher_name, voucher_amount, net_amount, paid_amount
)
select
  f.tenant_id,
  case v.store when 'store_a' then f.store_a when 'store_c' then f.store_c when 'store_d' then f.store_d when 'store_f' then f.store_f when 'store_g' then f.store_g else f.store_h end,
  f.account_id, v.external_id, (v.on_date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', v.on_date,
  v.gross, v.item_discount, v.bill, 0, v.bill_name, v.voucher_name, v.voucher,
  v.gross - v.item_discount - v.bill - v.voucher, v.gross - v.item_discount - v.bill - v.voucher
from sale v
cross join fixture f;

insert into public.invoice_lines (
  tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price,
  gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name
)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind, v.item, v.item || ' name', 1, v.line_gross, v.line_gross, v.line_discount,
  v.line_gross - v.line_discount, v.promotion_id, v.promotion_name
from sale v
join public.invoices i on i.external_id = v.external_id and i.tenant_id = (select tenant_id from fixture)
where v.item is not null
union all
select i.tenant_id, i.store_id, i.id, 'L2', 'item'::public.line_kind, 'BREAD', 'BREAD name', 1, v.gross - v.line_gross, v.gross - v.line_gross, 0,
  v.gross - v.line_gross, null, null
from sale v
join public.invoices i on i.external_id = v.external_id and i.tenant_id = (select tenant_id from fixture)
where v.item is not null and v.gross > v.line_gross;

create function pg_temp.summary(p_store_ids uuid[], p_kind text, p_key text, p_comparator text, p_pre_weeks integer default null)
returns table (
  promo_days integer, measured_days integer, control_days integer, trend_adjustment_amount numeric,
  gross_lift_amount numeric, discount_amount numeric, net_lift_amount numeric, lift_rate numeric,
  test_store_count integer, control_store_count integer, flags text[]
)
language sql
as $$
  select l.promo_days, l.measured_days, l.control_days, l.trend_adjustment_amount, l.gross_lift_amount, l.discount_amount,
    l.net_lift_amount, l.lift_rate, l.test_store_count, l.control_store_count, l.flags
  from public.promotion_lift(p_store_ids, p_kind, p_key, '2025-07-21', '2025-08-17', p_comparator, p_pre_weeks) l
  where l.business_date is null;
$$;

select is(
  (
    select array_agg(
      p.proname || ':' || pg_get_function_identity_arguments(p.oid) || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
      order by p.proname
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('public', 'promotion_days'), ('public', 'promotion_catalogue'), ('public', 'promotion_lift'),
      ('public', 'promotion_compliance'), ('public', 'item_discount_days'), ('public', 'promotion_summary'), ('app', 'discount_rows')
    )
  ),
  array[
    'discount_rows:store_ids uuid[], from_date date, to_date date:s:false:search_path=""',
    'item_discount_days:store_ids uuid[], calendar_year integer, as_of_date date:s:false:search_path=""',
    'promotion_catalogue:store_ids uuid[], as_of_date date:s:false:search_path=""',
    'promotion_compliance:store_ids uuid[], from_date date, to_date date, cap_rate numeric:s:false:search_path=""',
    'promotion_days:store_ids uuid[], from_date date, to_date date, kind_filter text, key_filter text:s:false:search_path=""',
    'promotion_lift:store_ids uuid[], promotion_kind text, promotion_key text, from_date date, to_date date, comparator text, pre_weeks integer:s:false:search_path=""',
    'promotion_summary:store_ids uuid[], from_date date, to_date date:s:false:search_path=""'
  ],
  'every promotion function has one signature with its argument types, is stable, security invoker and has an empty search_path'
);

select is(
  (
    select array_agg(p.proname::text order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('promotion_days', 'promotion_catalogue', 'promotion_lift', 'promotion_compliance', 'item_discount_days')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  ),
  array['item_discount_days', 'promotion_catalogue', 'promotion_compliance', 'promotion_days', 'promotion_lift'],
  'authenticated and service_role may run the new promotion functions and anon may not'
);

select results_eq(
  $$
    select d.promotion_kind, d.promotion_key, count(distinct d.invoice_id), sum(d.discount_amount), min(d.business_date), max(d.business_date)
    from fixture f
    cross join lateral app.discount_rows(array[f.store_a, f.store_c, f.store_d], '2025-06-01', '2025-08-17') d
    group by d.promotion_kind, d.promotion_key
    order by 1, 2
  $$,
  $$
    select p.promotion_kind, p.promotion_key, p.invoices, p.discount_amount, p.first_used_on, p.last_used_on
    from fixture f
    cross join lateral public.promotion_summary(array[f.store_a, f.store_c, f.store_d], '2025-06-01', '2025-08-17') p
    order by 1, 2
  $$,
  'grouped by kind and key, the discount rows equal promotion_summary'
);

select results_eq(
  $$
    select d.promotion_kind, d.promotion_key, sum(d.invoices)::bigint, sum(d.lines)::bigint, sum(d.discount_amount), (count(distinct d.business_date))::integer
    from fixture f
    cross join lateral public.promotion_days(array[f.store_a, f.store_c, f.store_d], '2025-06-01', '2025-08-17') d
    group by d.promotion_kind, d.promotion_key
    order by 1, 2
  $$,
  $$
    select p.promotion_kind, p.promotion_key, p.invoices, p.lines, p.discount_amount, p.days_used
    from fixture f
    cross join lateral public.promotion_summary(array[f.store_a, f.store_c, f.store_d], '2025-06-01', '2025-08-17') p
    order by 1, 2
  $$,
  'promotion_days summed over dates and stores equals promotion_summary'
);

select is(
  (
    select array_agg(d.business_date::text || ':' || d.invoices || ':' || d.lines || ':' || d.discount_amount || ':' || d.promotion_name order by d.business_date)
    from fixture f
    cross join lateral public.promotion_days(array[f.store_a], '2025-07-21', '2025-08-17', 'item', 'KM-LIFT') d
  ),
  array['2025-08-05:2:2:10000.00:Mua 2 tặng 1', '2025-08-06:2:2:10000.00:Mua 2 tặng 1', '2025-08-07:2:2:10000.00:Mua 2 tặng 1'],
  'promotion_days filtered by kind and key returns that promotion per day'
);

select is(
  (
    select array[d.promotion_name, coalesce(d.lines::text, '-')]
    from fixture f
    cross join lateral public.promotion_days(array[f.store_a], '2025-06-15', '2025-06-15', 'bill') d
  ),
  array['BILL-CAT', '-'],
  'a bill row names itself by its key and has no line count'
);

select throws_ok(
  $$ select * from public.promotion_days(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], '2025-07-21', '2025-08-17', null, 'KM-LIFT') $$,
  '22023',
  null,
  'promotion_days refuses a key filter without a kind'
);

select is(
  (
    select array_agg(c.promotion_kind || ':' || c.promotion_key || ':' || c.in_catalogue || ':' || coalesce(c.catalogue_active::text, '-') || ':' || coalesce(c.first_used_on::text, '-') || ':' || coalesce(c.last_used_on::text, '-') || ':' || c.days_used_365 || ':' || c.invoices_365 || ':' || c.discount_365 order by c.promotion_kind, c.promotion_key)
    from fixture f
    cross join lateral public.promotion_catalogue(array[f.store_a], '2025-08-17') c
  ),
  array[
    'bill:BILL-CAT:false:-:2025-06-15:2025-06-15:1:1:10000.00',
    'item:KM-LIFT:true:true:2025-08-05:2025-08-07:3:6:30000.00',
    'item:KM-NEVER:true:false:-:-:0:0:0',
    'item:KM-ONE:false:-:2025-08-12:2025-08-12:1:1:5000.00',
    'voucher:VOUCHER-CAT:false:-:2025-06-15:2025-06-15:1:1:3000.00'
  ],
  'the catalogue lists a promotion never used, the catalogue and used ones, and the bill and voucher keys with their first and last use'
);

select is(
  (
    select array_agg(c.promotion_key order by c.ordinality)
    from fixture f
    cross join lateral public.promotion_catalogue(array[f.store_a], '2025-08-17') with ordinality c
  ),
  array['KM-ONE', 'KM-LIFT', 'BILL-CAT', 'VOUCHER-CAT', 'KM-NEVER'],
  'the catalogue orders by last use, newest first, the never-used promotion last'
);

select is(
  (
    select array_agg(c.promotion_key || ':' || c.days_used_365 order by c.promotion_key)
    from fixture f
    cross join lateral public.promotion_catalogue(array[f.store_a], '2026-08-20') c
    where c.promotion_kind = 'item'
  ),
  array['KM-LIFT:0', 'KM-NEVER:0', 'KM-ONE:0'],
  'use older than 365 days still dates the promotion but no longer counts'
);

select results_eq(
  $$ select * from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'baseline') $$,
  $$ values (3, 3, 25, 31920.00::numeric, 88740.00::numeric, 30000.00::numeric, 88740.00 - 30000.00, round(88740 / 517260::numeric, 6), 1, 1, '{}'::text[]) $$,
  'baseline: the median of the same weekday and the trend adjustment give the hand-computed lift'
);

select is(
  (
    select array[l.promo_day::text, l.control_day::text, l.test_gross_amount::text, l.reference_gross_amount::text, l.reference_days::text, l.counterfactual_gross_amount::text, l.gross_lift_amount::text, l.discount_amount::text]
    from fixture f
    cross join lateral public.promotion_lift(array[f.store_a, f.store_b], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'baseline') l
    where l.business_date = '2025-08-06'
  ),
  array['true', 'false', '202000.00', '140500.00', '8', '172420.00', '29580.00', '10000.00'],
  'a promotion day shows its gross, its median reference, the counterfactual and its lift'
);

select is(
  (
    select array[l.promo_day::text, l.control_day::text, l.reference_gross_amount::text, l.reference_days::text, coalesce(l.counterfactual_gross_amount::text, '-'), coalesce(l.gross_lift_amount::text, '-')]
    from fixture f
    cross join lateral public.promotion_lift(array[f.store_a, f.store_b], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'baseline') l
    where l.business_date = '2025-08-13'
  ),
  array['false', 'true', '144000.00', '7', '-', '-'],
  'a control day a week after the promotion leaves the promotion day out of its reference'
);

select is(
  (
    select array[count(*)::text, (count(*) filter (where l.business_date is null))::text, (array_agg(l.business_date order by l.business_date nulls last))[1]::text]
    from fixture f
    cross join lateral public.promotion_lift(array[f.store_a, f.store_b], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'baseline') l
  ),
  array['29', '1', '2025-07-21'],
  'the lift returns a row per day of the window and the summary last'
);

select results_eq(
  $$ select * from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'prior_weeks', 4) $$,
  $$ values (3, 3, 10, 21700.00::numeric, 77400.00::numeric, 30000.00::numeric, 77400.00 - 30000.00, round(77400 / 528600::numeric, 6), 1, 1, '{}'::text[]) $$,
  'prior weeks: the pre-period mean of the weekday and the trend adjustment give the hand-computed lift'
);

insert into public.report_settings (tenant_id, promo_pre_weeks)
select tenant_id, 3 from fixture;

select results_eq(
  $$ select * from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'prior_weeks') $$,
  $$ select * from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'prior_weeks', 3) $$,
  'without pre_weeks the lift takes the tenant''s weeks'
);

select isnt(
  (select s.trend_adjustment_amount from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'prior_weeks') s),
  (select s.trend_adjustment_amount from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'prior_weeks', 4) s),
  'three weeks before give another reference than four'
);

select results_eq(
  $$ select * from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'sister_store', 4) $$,
  $$ values (3, 3, null::integer, null::numeric, 90000.00::numeric, 30000.00::numeric, 90000.00 - 30000.00, round(90000 / 516000::numeric, 6), 1, 1, '{}'::text[]) $$,
  'sister store: the difference to the store that did not run it gives the hand-computed lift'
);

select is(
  (
    select array_agg(distinct (s.gross_lift_amount - s.discount_amount = s.net_lift_amount))
    from unnest(array['baseline', 'prior_weeks', 'sister_store']) c
    cross join lateral pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', c) s
  ),
  array[true],
  'gross lift minus the discount is the net lift for every comparator'
);

select is(
  (select array[s.measured_days::text, array_to_string(s.flags, ',')] from pg_temp.summary((select array[store_c] from fixture), 'item', 'KM-ALL', 'baseline') s),
  array['0', 'few_control_days,unmeasured_days'],
  'a promotion run on every day of the window leaves no control day and measures nothing'
);

select ok(
  (select 'no_test_store' = any (s.flags) from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-NONE', 'baseline') s),
  'a promotion no requested store ran is flagged no_test_store'
);

select ok(
  (select 'few_promo_days' = any (s.flags) and s.promo_days = 1 from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-ONE', 'baseline') s),
  'a promotion run on one day is flagged few_promo_days'
);

select is(
  (select array_to_string(s.flags, ',') from pg_temp.summary((select array[store_d] from fixture), 'item', 'KM-D', 'baseline') s),
  'few_control_days,few_reference_days,unmeasured_days',
  'a new store without earlier weeks has no reference, so no control day either, and measures nothing'
);

select ok(
  (select 'no_control_store' = any (s.flags) and s.control_store_count = 0 from pg_temp.summary((select array[store_a] from fixture), 'item', 'KM-LIFT', 'sister_store') s),
  'sister store without another store is flagged no_control_store'
);

select ok(
  (select 'control_differs_in_size' = any (s.flags) from pg_temp.summary((select array[store_a, store_e] from fixture), 'item', 'KM-LIFT', 'sister_store') s),
  'a sister store ten times larger is flagged control_differs_in_size'
);

select throws_ok(
  $$ select * from public.promotion_lift(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'sister') $$,
  '22023',
  null,
  'promotion_lift refuses an unknown comparator'
);

select throws_ok(
  $$ select * from public.promotion_lift(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'prior_weeks', 9) $$,
  '22023',
  null,
  'promotion_lift refuses nine weeks before'
);

select throws_ok(
  $$ select * from public.promotion_lift(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], 'combo', 'KM-LIFT', '2025-07-21', '2025-08-17', 'baseline') $$,
  '22023',
  null,
  'promotion_lift refuses an unknown kind'
);

select throws_ok(
  $$ select * from public.promotion_lift(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], 'item', 'KM-LIFT', '2025-05-17', '2025-08-17', 'baseline') $$,
  '22023',
  null,
  'promotion_lift covers at most 92 days'
);

select results_eq(
  $$
    select c.promotion_kind, c.promotion_key, c.promotion_name, c.checked_rows, c.max_partial_rate, c.over_cap_rows, c.over_cap_discount_amount,
      c.first_over_cap_on, c.full_discount_rows, c.full_discount_amount, c.first_full_discount_on, c.last_full_discount_on
    from fixture f
    cross join lateral public.promotion_compliance(array[f.store_g], '2025-09-01', '2025-09-30') c
  $$,
  $$
    values
      ('bill'::text, 'BILL-60'::text, 'BILL-60'::text, 1::bigint, 0.600000::numeric, 1::bigint, 60000::numeric, '2025-09-10'::date, 0::bigint, 0::numeric, null::date, null::date),
      ('item', 'KM-60', 'Giảm 60', 1, 0.600000, 1, 60000, '2025-09-10', 0, 0, null, null),
      ('bill', 'BILL-10', 'BILL-10', 1, 0.100000, 0, 0, null, 0, 0, null, null),
      ('item', 'KM-30', 'Giảm 30', 1, 0.300000, 0, 0, null, 0, 0, null, null),
      ('item', 'KM-GIFT', 'Tặng bánh', 2, null, 0, 0, null, 2, 90000, '2025-09-10', '2025-09-11'),
      ('invoice_total', 'all', null, 5, 0.600000, 2, 120000, '2025-09-10', 0, 0, null, null)
  $$,
  'compliance: 30 % stays under the cap, a 60 % line and a 60 % bill are over it, gifts are full rows, a gift plus a 10 % bill stays under, the invoice total comes last'
);

select throws_ok(
  $$ select * from public.promotion_compliance(array['dddddddd-dddd-4ddd-8ddd-000000003627']::uuid[], '2025-09-01', '2025-09-30', 0) $$,
  '22023',
  null,
  'promotion_compliance refuses a cap of 0'
);

select is(
  (
    select array_agg(c.promotion_key || ':' || c.over_cap_rows order by c.promotion_key collate "C")
    from fixture f
    cross join lateral public.promotion_compliance(array[f.store_g], '2025-09-01', '2025-09-30', 0.25) c
  ),
  array['BILL-10:0', 'BILL-60:1', 'KM-30:1', 'KM-60:1', 'KM-GIFT:0', 'all:3'],
  'a lower cap moves the 30 % line over it'
);

select results_eq(
  $$
    select d.item_external_id, d.price_discount_days, d.line_price_discount_days, d.bill_discount_days, d.gift_days, d.voucher_days, d.first_price_discount_on, d.last_price_discount_on
    from fixture f
    cross join lateral public.item_discount_days(array[f.store_h], 2025, '2026-01-05') d
  $$,
  $$ values ('TEA'::text, 2, 1, 2, 1, 1, '2025-12-30'::date, '2025-12-31'::date) $$,
  'item discount days keep price, line, bill, gift and voucher days apart and stop at the end of the year'
);

select results_eq(
  $$
    select d.item_external_id, d.price_discount_days, d.line_price_discount_days, d.bill_discount_days, d.gift_days, d.voucher_days, d.first_price_discount_on, d.last_price_discount_on
    from fixture f
    cross join lateral public.item_discount_days(array[f.store_h], 2026, '2026-01-05') d
  $$,
  $$ values ('TEA'::text, 1, 1, 0, 0, 0, '2026-01-01'::date, '2026-01-01'::date) $$,
  'the next calendar year counts only its own days'
);

select is(
  (select d.item_name from fixture f cross join lateral public.item_discount_days(array[f.store_h], 2025, '2026-01-05') d),
  'TEA name',
  'item discount days name the item'
);

select is(
  (select count(*)::integer from fixture f cross join lateral public.item_discount_days(array[f.store_h], 2025, '2025-12-29') d where d.gift_days = 1 and d.price_discount_days = 0),
  1,
  'an as-of day inside the year ends the window there'
);

select throws_ok(
  $$ select * from public.item_discount_days(array['dddddddd-dddd-4ddd-8ddd-000000003628']::uuid[], 2022) $$,
  '22023',
  null,
  'item_discount_days starts in 2023'
);

select lives_ok(
  $$ select * from public.promotion_summary(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], '2024-07-14', '2025-08-17') $$,
  'promotion_summary accepts 400 days'
);

select throws_ok(
  $$ select * from public.promotion_summary(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], '2024-07-13', '2025-08-17') $$,
  '22023',
  null,
  'promotion_summary refuses 401 days'
);

select lives_ok(
  $$ select * from public.promotion_days(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], '2024-07-14', '2025-08-17') $$,
  'promotion_days accepts 400 days'
);

select throws_ok(
  $$ select * from public.promotion_days(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], '2024-07-13', '2025-08-17') $$,
  '22023',
  null,
  'promotion_days refuses 401 days'
);

select throws_ok(
  $$ select * from public.promotion_compliance(array['dddddddd-dddd-4ddd-8ddd-000000003627']::uuid[], '2024-07-13', '2025-08-17') $$,
  '22023',
  null,
  'promotion_compliance refuses 401 days'
);

select is(
  (select count(*)::integer from fixture f cross join lateral public.promotion_days(array[f.store_a], '2025-08-05', '2025-08-07') d),
  3,
  'promotion_days returns one row per store, date and promotion'
);

select is(
  (select count(*)::integer from public.promotion_days(array[]::uuid[], '2025-08-05', '2025-08-07')),
  0,
  'no store gives no promotion day'
);

select throws_ok(
  $$ select * from public.promotion_catalogue(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], null) $$,
  '22023',
  null,
  'promotion_catalogue needs an as-of day'
);

select is(
  (
    select array_agg(d.promotion_kind || ':' || d.base_amount || ':' || d.discount_rate order by d.promotion_kind)
    from fixture f
    cross join lateral app.discount_rows(array[f.store_a], '2025-06-15', '2025-06-15') d
  ),
  array['bill:100000.00:0.100000', 'voucher:90000.00:0.033333'],
  'a bill discount''s base is the gross after item discounts, a voucher''s base also leaves out the bill discount'
);

select is(
  (select d.promotion_name from fixture f cross join lateral public.promotion_days(array[f.store_g], '2025-10-05', '2025-10-05') d),
  'Giảm giá',
  'a key used with and without a POS name is named by the POS'
);

select is(
  (
    select array[
      (select count(*)::integer from public.promotion_lift(array[]::uuid[], 'item', 'KM-LIFT', '2025-07-21', '2025-08-17', 'baseline')),
      (select count(*)::integer from public.promotion_compliance(array[]::uuid[], '2025-09-01', '2025-09-30'))
    ]
  ),
  array[0, 0],
  'no store gives no lift row and no compliance row'
);

select is(
  (select count(*)::integer from fixture f cross join lateral public.promotion_compliance(array[f.store_a], '2025-01-01', '2025-01-31') c),
  0,
  'a range without discounts gives no compliance row, not an empty invoice total'
);

select is(
  (
    select array[
      (select c.days_used_365 from fixture f cross join lateral public.promotion_catalogue(array[f.store_a], '2026-08-04') c where c.promotion_key = 'KM-LIFT'),
      (select c.days_used_365 from fixture f cross join lateral public.promotion_catalogue(array[f.store_a], '2026-08-05') c where c.promotion_key = 'KM-LIFT')
    ]
  ),
  array[3, 2],
  'the 365 days end on the as-of day: the first use counts on its anniversary eve and not on the anniversary'
);

select is(
  (
    select array[l.control_days::text, l.measured_days::text, coalesce(array_to_string(l.flags, ','), '')]
    from fixture f
    cross join lateral public.promotion_lift(array[f.store_a, f.store_b], 'item', 'KM-LIFT', '2025-07-21', '2025-08-14', 'prior_weeks', 4) l
    where l.business_date is null
  ),
  array['7', '3', ''],
  'seven control days are enough to measure'
);

select is(
  (
    select array[l.control_days::text, l.measured_days::text, coalesce(array_to_string(l.flags, ','), '')]
    from fixture f
    cross join lateral public.promotion_lift(array[f.store_a, f.store_b], 'item', 'KM-LIFT', '2025-07-21', '2025-08-13', 'prior_weeks', 4) l
    where l.business_date is null
  ),
  array['6', '0', 'few_control_days,unmeasured_days'],
  'six control days are not'
);

select is(
  (select array[s.control_store_count::text, ('no_control_store' = any (s.flags))::text] from pg_temp.summary((select array[store_a, store_f] from fixture), 'item', 'KM-LIFT', 'sister_store', 4) s),
  array['0', 'true'],
  'a store that ran the promotion in the weeks before is no control store'
);

select lives_ok(
  $$ select * from public.promotion_lift(array['dddddddd-dddd-4ddd-8ddd-000000003621']::uuid[], 'item', 'KM-LIFT', '2025-05-18', '2025-08-17', 'baseline') $$,
  'promotion_lift accepts 92 days'
);

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_amount, bill_discount_name, net_amount, paid_amount
)
select f.tenant_id, f.store_a, f.account_id, 'A-OTHER', ('2025-08-06'::date + time '11:00') at time zone 'Asia/Ho_Chi_Minh', '2025-08-06', 50000, 5000, 'BILL-OTHER', 45000, 45000
from fixture f;

select ok(
  (select 'other_promotions' = any (s.flags) from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'baseline') s),
  'another promotion on a promotion day is flagged other_promotions'
);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select tenant_id, 'VN', '2025-08-06', 'Store anniversary', 'custom' from fixture;

select ok(
  (select 'excluded_days_in_window' = any (s.flags) from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'baseline') s),
  'a holiday on a promotion day is flagged excluded_days_in_window'
);

select is(
  (
    select array[s.promo_days::text, s.control_days::text]
    from pg_temp.summary((select array[store_a, store_b] from fixture), 'item', 'KM-LIFT', 'baseline') s
  ),
  array['3', '25'],
  'an excluded promotion day stays a promotion day and is never a control day'
);

select * from finish();
rollback;
