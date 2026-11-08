begin;
select plan(45);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  (select min(i.business_date) from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as range_from,
  (select max(i.business_date) from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as range_to;

create temp table first_refresh as
select app.refresh_analytics(f.demo_tenant_id, f.range_from, f.range_to) as refreshed_rows from fixture f;

create temp table demo_invoices as
select i.*
from public.invoices i
join fixture f on f.demo_tenant_id = i.tenant_id;

create temp table fact_daily as
select
  i.store_id,
  i.business_date,
  count(*) filter (where i.status <> 'voided') as invoices,
  coalesce(sum(i.net_amount) filter (where i.status <> 'voided'), 0) as net_amount,
  coalesce(sum(i.paid_amount) filter (where i.status <> 'voided'), 0) as paid_amount,
  count(*) filter (where i.status = 'voided') as voided_invoices,
  coalesce(sum(i.net_amount) filter (where i.status = 'voided'), 0) as voided_amount,
  count(*) filter (where i.status = 'edited') as edited_invoices,
  count(*) filter (where i.status <> 'voided' and i.customer_phone is not null) as member_invoices,
  count(*) filter (where i.status <> 'voided' and (i.customer_phone is not null or i.customer_id is not null)) as identified_invoices,
  count(*) filter (where i.status <> 'voided' and i.voucher_amount > 0) as voucher_invoices
from demo_invoices i
group by i.store_id, i.business_date;

create temp table fact_lines as
select
  i.store_id,
  i.business_date,
  coalesce(sum(l.quantity) filter (where l.line_kind = 'item'), 0) as items_sold,
  count(*) filter (where l.line_kind = 'modifier') as modifier_lines
from demo_invoices i
join public.invoice_lines l on l.invoice_id = i.id
where i.status <> 'voided'
group by i.store_id, i.business_date;

create temp table demo_daily as
select a.* from public.agg_daily_sales a join fixture f on f.demo_tenant_id = a.tenant_id;

select is((select count(*) from demo_daily), (select count(*) from fact_daily), 'one daily row per demo store-day');

select is(
  (select count(*) from demo_daily a join fact_daily f using (store_id, business_date) where a.net_amount <> f.net_amount or a.invoices <> f.invoices),
  0::bigint,
  'daily net and invoice counts equal the non-voided invoices of each store-day'
);
select is(
  (select count(*) from demo_daily a join fact_daily f using (store_id, business_date) where a.paid_amount <> f.paid_amount or a.voided_invoices <> f.voided_invoices or a.edited_invoices <> f.edited_invoices),
  0::bigint,
  'daily paid, voided and edited counts match the facts'
);
select is(
  (select count(*) from demo_daily a join fact_daily f using (store_id, business_date) where a.voided_amount <> f.voided_amount),
  0::bigint,
  'daily voided_amount is the net of the voided invoices'
);
select cmp_ok((select sum(voided_amount) from demo_daily), '>', 0::numeric, 'the seeded void carries an amount');
select is(
  (select count(*) from demo_daily a join fact_daily f using (store_id, business_date) where a.member_invoices <> f.member_invoices or a.voucher_invoices <> f.voucher_invoices),
  0::bigint,
  'daily member and voucher invoice counts match the facts'
);
select is(
  (select count(*) from demo_daily a join fact_daily f using (store_id, business_date) where a.identified_invoices <> f.identified_invoices),
  0::bigint,
  'daily identified invoices count a phone or a customer id'
);
select is((select sum(voided_invoices) from demo_daily), (select count(*) from demo_invoices where status = 'voided'), 'every demo void is counted once');
select is((select sum(edited_invoices) from demo_daily), (select count(*) from demo_invoices where status = 'edited'), 'every demo edit is counted');

select is(
  (select count(*) from demo_daily a join fact_lines f using (store_id, business_date) where a.items_sold <> f.items_sold or a.modifier_lines <> f.modifier_lines),
  0::bigint,
  'items_sold counts item lines only and modifier_lines counts the modifiers'
);
select cmp_ok((select sum(modifier_lines) from demo_daily), '>', 0::bigint, 'the seed contains modifier lines that are not counted as items');

select is(
  (
    select count(*)
    from demo_daily d
    join (select store_id, business_date, sum(invoices) invoices, sum(net_amount) net_amount, sum(items_sold) items_sold from public.agg_hourly_sales group by 1, 2) h using (store_id, business_date)
    where d.invoices <> h.invoices or d.net_amount <> h.net_amount or d.items_sold <> h.items_sold
  ),
  0::bigint,
  'hourly rows sum to the daily row of every store-day'
);
select is(
  (
    select count(*)
    from (
      select i.store_id, i.business_date, extract(hour from i.sold_at at time zone s.timezone)::smallint as hour_local, count(*) as invoices
      from demo_invoices i
      join public.stores s on s.id = i.store_id
      where i.status <> 'voided'
      group by 1, 2, 3
    ) f
    full join (select h.* from public.agg_hourly_sales h join fixture x on x.demo_tenant_id = h.tenant_id) h using (store_id, business_date, hour_local)
    where f.invoices is distinct from h.invoices::bigint
  ),
  0::bigint,
  'hourly rows carry the store-local sale hour'
);

select is(
  (select count(*) from public.agg_item_daily a join fixture f on f.demo_tenant_id = a.tenant_id where a.item_external_id like 'mod-%'),
  0::bigint,
  'agg_item_daily holds no modifier'
);
select is(
  (select sum(a.quantity) from public.agg_item_daily a join fixture f on f.demo_tenant_id = a.tenant_id),
  (select sum(items_sold) from demo_daily),
  'agg_item_daily quantity sums to items_sold'
);
select is(
  (
    select count(*)
    from public.agg_modifier_prefs_daily m
    join fixture f on f.demo_tenant_id = m.tenant_id
    where not exists (
      select 1 from public.invoice_lines l join demo_invoices i on i.id = l.invoice_id
      where l.line_kind = 'modifier' and l.item_name = m.modifier_name and i.store_id = m.store_id and i.business_date = m.business_date
    )
  ),
  0::bigint,
  'agg_modifier_prefs_daily holds only modifier names'
);
select is(
  (select sum(m.count) from public.agg_modifier_prefs_daily m join fixture f on f.demo_tenant_id = m.tenant_id),
  (select sum(modifier_lines) from demo_daily),
  'modifier preferences sum to the modifier lines'
);

select is((select count(distinct c.role) from public.agg_category_daily c join fixture f on f.demo_tenant_id = c.tenant_id), 2::bigint, 'categories carry the drink and snack roles of the demo item types');
select is(
  (select count(*) from public.agg_category_daily c join fixture f on f.demo_tenant_id = c.tenant_id where c.item_type_external_id = 'type-04' and c.role <> 'snack'),
  0::bigint,
  'the snack item type carries the snack role'
);
select is(
  (select sum(c.net_amount) from public.agg_category_daily c join fixture f on f.demo_tenant_id = c.tenant_id),
  (select sum(l.net_amount) from public.invoice_lines l join demo_invoices i on i.id = l.invoice_id where i.status <> 'voided' and l.line_kind = 'item'),
  'category net sums to the item-line net of non-voided invoices'
);

create temp view payment_vs_paid as
select d.store_id, d.business_date, d.paid_amount, coalesce(sum(p.amount), 0) as payment_amount
from public.agg_daily_sales d
join fixture f on f.demo_tenant_id = d.tenant_id
left join public.agg_payment_daily p on p.store_id = d.store_id and p.business_date = d.business_date
group by d.store_id, d.business_date, d.paid_amount;

select is((select count(*) from payment_vs_paid where payment_amount <> paid_amount), 0::bigint, 'payment rows of every store-day sum to its paid amount');
select is(
  (select count(*) from public.agg_payment_daily p join fixture f on f.demo_tenant_id = p.tenant_id where p.payment_method_external_id = 'pm-01' and p.kind <> 'cash'),
  0::bigint,
  'the cash method carries the cash kind'
);
select is(
  (select count(*) from public.agg_payment_daily p join fixture f on f.demo_tenant_id = p.tenant_id where p.kind = 'ewallet' and p.fee_estimate_amount <> round(p.amount * 1.1 / 100, 2)),
  0::bigint,
  'the fee estimate applies the seeded 1.1 percent e-wallet rate'
);
select is(
  (select sum(cash_amount) from demo_daily),
  (select sum(p.amount) from public.agg_payment_daily p join fixture f on f.demo_tenant_id = p.tenant_id where p.kind = 'cash'),
  'daily cash_amount equals the cash tenders'
);

select is(
  (select count(*) from public.agg_shift_cash a join fixture f on f.demo_tenant_id = a.tenant_id),
  (select count(*) from public.shifts s join fixture f on f.demo_tenant_id = s.tenant_id),
  'every demo shift has a cash row'
);
select is(
  (select count(*) from public.agg_shift_cash a join fixture f on f.demo_tenant_id = a.tenant_id where a.variance_amount <> a.drawer_amount - a.expected_cash_amount),
  0::bigint,
  'shift variance is drawer minus expected'
);
select is(
  (
    select count(*)
    from public.agg_shift_cash a
    join public.shifts s on s.id = a.shift_id
    join public.stores st on st.id = s.store_id
    join fixture f on f.demo_tenant_id = a.tenant_id
    where a.business_date <> ((s.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date
  ),
  0::bigint,
  'shift business_date is the store business date of opened_at'
);

select is(
  (select count(*) from public.agg_size_mix_daily m join fixture f on f.demo_tenant_id = m.tenant_id where m.size_label not in ('M', 'L')),
  0::bigint,
  'size mix holds sized items only'
);
select is(
  (select sum(m.quantity) from public.agg_size_mix_daily m join fixture f on f.demo_tenant_id = m.tenant_id),
  (select sum(l.quantity) from public.invoice_lines l join demo_invoices i on i.id = l.invoice_id where i.status <> 'voided' and l.line_kind = 'item' and l.size_label is not null),
  'size mix quantity sums to the sized item lines'
);

select is(
  (select count(*) from public.agg_attach_daily a join fixture f on f.demo_tenant_id = a.tenant_id where a.attach_rate_topping is not null),
  0::bigint,
  'without a topping role the topping attach rate is null, not zero'
);
select is(
  (select count(*) from public.agg_attach_daily a join fixture f on f.demo_tenant_id = a.tenant_id where a.drink_invoices > 0 and a.attach_rate_snack is distinct from round(a.snack_invoices::numeric / a.drink_invoices, 6)),
  0::bigint,
  'the snack attach rate is snack invoices over drink invoices'
);

select is(
  (select count(*) from public.agg_basket_pairs_28d b join fixture f on f.demo_tenant_id = b.tenant_id where b.item_a_external_id like 'mod-%' or b.item_b_external_id like 'mod-%'),
  0::bigint,
  'basket pairs exclude modifiers'
);
select is(
  (select count(*) from public.agg_basket_pairs_28d b join fixture f on f.demo_tenant_id = b.tenant_id where b.pair_invoices < 3 or b.item_a_external_id >= b.item_b_external_id or b.lift <= 0),
  0::bigint,
  'basket pairs respect the minimum support and ordering'
);

create temp table timing as
select clock_timestamp() as started_at, app.refresh_analytics(f.demo_tenant_id, f.range_from, f.range_to) as refreshed_rows from fixture f;

select is((select refreshed_rows from timing), (select refreshed_rows from first_refresh), 'a second refresh of the same range writes the same number of rows');
select cmp_ok((select extract(epoch from clock_timestamp() - started_at) from timing), '<', 10::numeric, 'refreshing the demo range takes under ten seconds');
select is(
  (
    select count(*)::int
    from pg_locks l
    where l.locktype = 'advisory'
      and l.pid = pg_backend_pid()
      and l.granted
      and l.mode = 'ExclusiveLock'
      and l.objsubid = 2
      and l.classid = ((hashtext('refresh_analytics')::bigint & 4294967295))::oid
      and l.objid = ((hashtext('11111111-1111-4111-8111-111111111111')::bigint & 4294967295))::oid
  ),
  1,
  'a refresh holds the per-tenant advisory lock until its transaction ends, so overlapping refreshes of one tenant queue'
);
select is(
  (
    select count(*)::int
    from pg_locks l
    where l.locktype = 'advisory'
      and l.pid = pg_backend_pid()
      and l.objid = ((hashtext('99999999-9999-4999-8999-999999999999')::bigint & 4294967295))::oid
  ),
  0,
  'the lock is keyed by tenant, so another tenant does not wait'
);

create temp table moved_shift as
select s.id as shift_id, a.business_date as old_business_date, a.business_date - 3 as new_business_date
from public.shifts s
join public.agg_shift_cash a on a.shift_id = s.id
join fixture f on f.tea_store_id = s.store_id
order by s.opened_at desc
limit 1;

update public.shifts s
set opened_at = s.opened_at - interval '3 days', closed_at = s.closed_at - interval '3 days'
from moved_shift m
where s.id = m.shift_id;

select lives_ok(
  $$ select app.refresh_analytics('11111111-1111-4111-8111-111111111111', (select new_business_date from moved_shift), (select new_business_date from moved_shift)) $$,
  'refreshing the new day of a shift whose business date moved succeeds'
);
select is(
  (select array_agg(a.business_date) from public.agg_shift_cash a join moved_shift m on m.shift_id = a.shift_id),
  (select array[new_business_date] from moved_shift),
  'the moved shift has one cash row, on its new business date'
);
select lives_ok(
  $$ select app.refresh_analytics('11111111-1111-4111-8111-111111111111', (select old_business_date from moved_shift), (select old_business_date from moved_shift)) $$,
  'refreshing the old day of the moved shift succeeds as well'
);

create temp table moved_tenders as
select (f.range_from + 1) as invoice_date, f.tea_store_id as store_id from fixture f;

update public.invoice_payments p
set business_date = i.business_date + 1
from public.invoices i, moved_tenders m
where i.id = p.invoice_id
  and i.store_id = m.store_id
  and i.business_date = m.invoice_date;

select app.refresh_analytics(f.demo_tenant_id, m.invoice_date, m.invoice_date) from fixture f cross join moved_tenders m;
select app.refresh_analytics(f.demo_tenant_id, m.invoice_date + 1, m.invoice_date + 1) from fixture f cross join moved_tenders m;

select is(
  (select payment_amount from payment_vs_paid v join moved_tenders m on m.store_id = v.store_id and m.invoice_date = v.business_date),
  (select paid_amount from payment_vs_paid v join moved_tenders m on m.store_id = v.store_id and m.invoice_date = v.business_date),
  'tenders dated a day after their invoice stay on the invoice business date'
);
select is((select count(*) from payment_vs_paid where payment_amount <> paid_amount), 0::bigint, 'payment rows still reconcile with the paid amount on every store-day');

create temp table id_only_invoice as
select i.id, i.store_id, i.business_date
from public.invoices i
join fixture f on f.demo_tenant_id = i.tenant_id
where i.status <> 'voided' and i.customer_phone is not null and i.customer_id is not null
order by i.business_date, i.external_id
limit 1;

create temp table capture_before as
select a.member_invoices, a.identified_invoices
from public.agg_daily_sales a
join id_only_invoice x on x.store_id = a.store_id and x.business_date = a.business_date;

update public.invoices i set customer_phone = null from id_only_invoice x where i.id = x.id;
select app.refresh_analytics(f.demo_tenant_id, x.business_date, x.business_date) from fixture f cross join id_only_invoice x;

select is(
  (select (a.member_invoices, a.identified_invoices) from public.agg_daily_sales a join id_only_invoice x on x.store_id = a.store_id and x.business_date = a.business_date),
  (select (member_invoices - 1, identified_invoices) from capture_before),
  'an invoice identified by customer id alone leaves member_invoices but still counts as identified'
);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role, created_by)
select f.demo_tenant_id, s.pos_account_id, 'type-topping-unsold', 'topping', f.demo_owner_id
from fixture f
join public.stores s on s.id = f.tea_store_id;

select app.refresh_analytics(f.demo_tenant_id, f.range_from, f.range_to) from fixture f;

select is(
  (select count(*) from public.agg_attach_daily a join fixture f on f.tea_store_id = a.store_id where a.drink_invoices > 0 and a.attach_rate_topping is distinct from 0::numeric),
  0::bigint,
  'once a topping role is mapped the topping attach rate is measured, here zero'
);
select is(
  (select count(*) from public.agg_attach_daily a join fixture f on f.coffee_store_id = a.store_id join public.stores s on s.id = a.store_id join public.stores t on t.id = f.tea_store_id where s.pos_account_id <> t.pos_account_id and a.attach_rate_topping is not null),
  0::bigint,
  'a store of another POS account without the role stays unmeasured'
);

select * from finish();
rollback;
