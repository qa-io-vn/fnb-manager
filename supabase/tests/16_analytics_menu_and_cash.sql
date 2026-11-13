begin;
select plan(27);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as both_stores,
  a.seed_anchor,
  (a.seed_anchor - 7)::date as seed_from,
  (a.seed_anchor - 1)::date as seed_to
from (select max(i.business_date) + 1 as seed_anchor from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as a;

select app.refresh_analytics(f.demo_tenant_id, f.seed_from, f.seed_to) from fixture f;

select is((select count(*) from fixture f cross join lateral public.item_velocity(f.both_stores, f.seed_to) v), 15::bigint, 'item_velocity lists every sold item once');
select is((select count(*) from fixture f cross join lateral public.item_velocity(f.both_stores, f.seed_to) v where v.item_external_id like 'mod-%'), 0::bigint, 'item_velocity excludes modifiers');
select is(
  (select sum(v.recent_quantity) from fixture f cross join lateral public.item_velocity(f.both_stores, f.seed_to) v),
  (select sum(a.items_sold) from public.agg_daily_sales a, fixture f where a.store_id = any (f.both_stores) and a.business_date between f.seed_to - 27 and f.seed_to),
  'item_velocity recent quantity sums to items_sold'
);
select is((select sum(v.prior_quantity) from fixture f cross join lateral public.item_velocity(f.both_stores, f.seed_to) v), 0::numeric, 'item_velocity prior window is empty for a one-week seed');

create temp table matrix as
select m.* from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m;

select is((select count(*) from matrix), 15::bigint, 'menu_matrix classifies every sold item');
select is((select count(*) from matrix where provisional), 0::bigint, 'menu_matrix is not provisional when every item has a cost');
select is((select count(*) from matrix where menu_class not in ('star', 'plowhorse', 'puzzle', 'dog')), 0::bigint, 'menu_matrix assigns a Kasavana-Smith class to every item');
select is((select count(*) from matrix where role = 'drink'), 12::bigint, 'menu_matrix groups the drinks by role');
select is((select count(*) from matrix where role = 'snack'), 3::bigint, 'menu_matrix groups the snacks by role');
select is((select count(*) from matrix where margin_axis <> avg_unit_price - unit_cost), 0::bigint, 'the margin axis is the contribution margin when a cost exists');
select is((select popularity_threshold_pct from matrix where role = 'drink' limit 1), round(100 * 0.7 / 12, 3), 'the popularity threshold is the factor over the item count of the role');
select is(
  (select count(*) from matrix m where m.margin_threshold <> (select round(sum(x.net_amount - x.unit_cost * x.quantity) / sum(x.quantity), 2) from matrix x where x.role = m.role)),
  0::bigint,
  'the margin threshold is the quantity-weighted mean contribution margin of the role'
);
select is(
  (select array_agg(distinct (role, low_sample)::text order by (role, low_sample)::text) from matrix),
  array['(drink,f)', '(snack,t)'],
  'a role with fewer than ten sold items carries the low-sample flag'
);
select is(
  (select count(*) from matrix where (menu_mix_pct >= popularity_threshold_pct and margin_axis >= margin_threshold) <> (menu_class = 'star')),
  0::bigint,
  'a star is popular and above the margin threshold'
);

delete from public.item_costs where item_external_id = 'item-13';

select is((select provisional from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m where m.item_external_id = 'item-13'), true, 'menu_matrix flags an item without cost as provisional');
select is((select (unit_cost is null, margin_axis = avg_unit_price, menu_class is not null) from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m where m.item_external_id = 'item-13'), (true, true, true), 'a provisional item uses its price as margin proxy and still receives a class');
select is(
  (select array_agg(distinct (m.role, m.provisional)::text order by (m.role, m.provisional)::text) from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m),
  array['(drink,f)', '(snack,t)'],
  'one item without cost makes its whole role provisional and leaves a fully costed role exact'
);
select is(
  (select count(*) from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m where m.role = 'snack' and (m.margin_axis <> m.avg_unit_price or (m.item_external_id <> 'item-13' and m.unit_cost is null))),
  0::bigint,
  'every item of a provisional role is placed on price, and the costed ones still report their cost'
);

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from, created_by)
select f.demo_tenant_id, f.tea_store_id, 'item-01', 99, f.seed_anchor - 10, f.demo_owner_id from fixture f;

select is((select unit_cost from fixture f cross join lateral public.menu_matrix(array[f.tea_store_id], f.seed_to) m where m.item_external_id = 'item-01'), 99.00::numeric, 'a store-specific cost wins over the tenant-wide cost');
select is(
  (select unit_cost from fixture f cross join lateral public.menu_matrix(array[f.coffee_store_id], f.seed_to) m where m.item_external_id = 'item-01'),
  (select c.cost_amount from public.item_costs c, fixture f where c.tenant_id = f.demo_tenant_id and c.item_external_id = 'item-01' and c.store_id is null),
  'another store keeps the tenant-wide cost'
);

delete from public.item_costs c
using fixture f
where c.tenant_id = f.demo_tenant_id
  and c.item_external_id in ('item-01', 'item-02', 'item-03', 'item-04', 'item-05', 'item-06');

create temp table half_costed as
select m.* from fixture f cross join lateral public.menu_matrix(f.both_stores, f.seed_to) m where m.role = 'drink';

select is(
  (select (count(*) filter (where provisional), count(*) filter (where unit_cost is not null), count(*) filter (where margin_axis <> avg_unit_price)) from half_costed),
  (12::bigint, 6::bigint, 0::bigint),
  'in a half-costed role every drink is provisional and placed on price, costed or not'
);
select is(
  (select count(distinct margin_threshold) from half_costed),
  1::bigint,
  'the half-costed role has one threshold'
);
select is(
  (select margin_threshold from half_costed limit 1),
  (select round(sum(net_amount) / sum(quantity), 2) from half_costed),
  'the threshold of a provisional role is its quantity-weighted mean price'
);
select is(
  (select count(*) from half_costed where (menu_mix_pct >= popularity_threshold_pct and margin_axis >= margin_threshold) <> (menu_class = 'star') or (menu_mix_pct < popularity_threshold_pct and margin_axis < margin_threshold) <> (menu_class = 'dog')),
  0::bigint,
  'classes in the half-costed role follow the single price axis'
);

update public.shifts s
set cash_drawer_amount = s.expected_cash_amount + 60000
from fixture f
where s.store_id = f.tea_store_id
  and s.external_id = 'shift-TEA-' || to_char(f.seed_anchor - 2, 'YYYYMMDD') || '-2';

select app.refresh_analytics(f.demo_tenant_id, f.seed_from, f.seed_to) from fixture f;

select is(
  (select (variance_amount, over_abs_threshold, 'absolute' = any (reasons)) from fixture f cross join lateral public.cash_variance_flags(f.both_stores, f.seed_from, f.seed_to) c where c.shift_external_id = 'shift-TEA-' || to_char(f.seed_anchor - 2, 'YYYYMMDD') || '-2'),
  (60000.00::numeric, true, true),
  'cash_variance_flags flags a 60,000 variance over the absolute threshold'
);
select is(
  (select count(*) from fixture f cross join lateral public.cash_variance_flags(f.both_stores, f.seed_from, f.seed_to, 1000000, 1) c where not c.over_z_threshold or c.reasons <> array['z_score']),
  0::bigint,
  'with unreachable thresholds only the z-score rule flags a shift'
);
select is(
  (select count(*) from fixture f cross join lateral public.cash_variance_flags(f.both_stores, f.seed_from, f.seed_to) c where c.variance_amount = 0),
  0::bigint,
  'balanced shifts are never flagged'
);

select * from finish();
rollback;
