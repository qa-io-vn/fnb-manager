begin;
select plan(7);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as demo_stores,
  (select min(i.business_date) from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as demo_from,
  (select max(i.business_date) from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as demo_to,
  '55555555-5555-4555-8555-000000000301'::uuid as tenant_id,
  '55555555-5555-4555-8555-000000000311'::uuid as account_id,
  '55555555-5555-4555-8555-000000000321'::uuid as store_a,
  '55555555-5555-4555-8555-000000000322'::uuid as store_b,
  array['55555555-5555-4555-8555-000000000321', '55555555-5555-4555-8555-000000000322']::uuid[] as both_stores;

create function pg_temp.reference_daily_sales_facts(p_tenant uuid, p_from date, p_to date, p_store_ids uuid[] default null)
returns table (
  tenant_id uuid, store_id uuid, business_date date, invoices integer, gross_amount numeric, item_discount_amount numeric,
  bill_discount_amount numeric, voucher_amount numeric, net_amount numeric, paid_amount numeric, cash_amount numeric, items_sold numeric,
  modifier_lines integer, voucher_invoices integer, member_invoices integer, identified_invoices integer, voided_invoices integer,
  voided_amount numeric, edited_invoices integer
)
language sql
stable
as $$
  with inv as (
    select * from app.sales_invoices(p_tenant, p_from, p_to, p_store_ids)
  ),
  line_totals as (
    select
      l.invoice_id,
      coalesce(sum(l.quantity) filter (where l.line_kind = 'item'), 0) as items_sold,
      count(*) filter (where l.line_kind = 'modifier') as modifier_lines
    from public.invoice_lines l
    join inv on inv.invoice_id = l.invoice_id
    group by l.invoice_id
  ),
  cash_totals as (
    select p.invoice_id, sum(p.amount) as cash_amount
    from public.invoice_payments p
    join inv on inv.invoice_id = p.invoice_id
    join public.payment_methods pm
      on pm.pos_account_id = inv.pos_account_id
      and pm.external_id = p.payment_method_external_id
    where pm.kind = 'cash'
    group by p.invoice_id
  )
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    (count(*) filter (where inv.status <> 'voided'))::integer,
    coalesce(sum(inv.gross_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.item_discount_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.bill_discount_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.voucher_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.net_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.paid_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(c.cash_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(lt.items_sold) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(lt.modifier_lines) filter (where inv.status <> 'voided'), 0)::integer,
    (count(*) filter (where inv.status <> 'voided' and inv.has_voucher))::integer,
    (count(*) filter (where inv.status <> 'voided' and inv.customer_phone is not null))::integer,
    (count(*) filter (where inv.status <> 'voided' and (inv.customer_phone is not null or inv.customer_id is not null)))::integer,
    (count(*) filter (where inv.status = 'voided'))::integer,
    coalesce(sum(inv.net_amount) filter (where inv.status = 'voided'), 0),
    (count(*) filter (where inv.status = 'edited'))::integer
  from inv
  left join line_totals lt on lt.invoice_id = inv.invoice_id
  left join cash_totals c on c.invoice_id = inv.invoice_id
  group by inv.tenant_id, inv.store_id, inv.business_date;
$$;

create function pg_temp.live_half_plan(p_store_ids uuid[], p_from date, p_to date)
returns jsonb
language plpgsql
as $$
declare
  body text;
  plan jsonb;
begin
  select p.prosrc into body
  from pg_proc p
  where p.oid = 'app.daily_sales_facts(uuid, date, date, uuid[])'::regprocedure;
  body := replace(replace(replace(replace(body, 'p_store_ids', '$4'), 'p_tenant', '$1'), 'p_from', '$2'), 'p_to', '$3');
  execute format('prepare live_half_body (uuid, date, date, uuid[]) as %s', regexp_replace(body, ';\s*$', ''));
  execute format('explain (format json) execute live_half_body (null, %L, %L, %L)', p_from, p_to, p_store_ids) into plan;
  deallocate live_half_body;
  return plan;
end;
$$;

insert into public.tenants (id, slug, name)
select tenant_id, 'live-half-fixture', 'Live Half Fixture' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'live-half-fixture', 'Live Half Fixture POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a, tenant_id, account_id, 'live-half-a', 'Store A' from fixture
union all
select store_b, tenant_id, account_id, 'live-half-b', 'Store B' from fixture;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select f.tenant_id, f.account_id, m.external_id, m.name, m.kind::public.payment_kind
from fixture f
cross join (values ('CASH', 'Cash', 'cash'), ('CARD', 'Card', 'card'), ('WALLET', 'E-wallet', 'ewallet')) as m (external_id, name, kind);

create temp table live_sales as
select
  s.store_id,
  d.business_date,
  v.invoice_no,
  format('LH-%s-%s-%s', s.store_code, to_char(d.business_date, 'YYYYMMDD'), v.invoice_no) as external_id,
  v.status::public.invoice_status as sale_status,
  v.customer_phone,
  v.voucher_code,
  v.voucher_amount::numeric as voucher_amount,
  v.net_amount::numeric as net_amount
from fixture f
cross join lateral (values (f.store_a, 'A'), (f.store_b, 'B')) as s (store_id, store_code)
cross join lateral (values (current_date - 10), (current_date - 1), (current_date)) as d (business_date)
cross join (
  values
    (1, 'completed', null, null, 0, 35000),
    (2, 'voided', null, null, 0, 30000),
    (3, 'edited', 'member-301', 'CODE-ONLY', 0, 20000),
    (4, 'completed', null, null, 0, 0),
    (5, 'completed', null, null, 5000, 25000)
) as v (invoice_no, status, customer_phone, voucher_code, voucher_amount, net_amount);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, status, customer_phone, voucher_code, voucher_amount, gross_amount, net_amount, paid_amount)
select f.tenant_id, s.store_id, f.account_id, s.external_id, (s.business_date + time '09:00' + make_interval(hours => s.invoice_no)) at time zone 'Asia/Ho_Chi_Minh',
  s.business_date, s.sale_status, s.customer_phone, s.voucher_code, s.voucher_amount, s.net_amount + s.voucher_amount, s.net_amount, s.net_amount
from live_sales s
cross join fixture f;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, parent_line_external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select f.tenant_id, s.store_id, i.id, l.external_id, l.parent_line, l.line_kind::public.line_kind, l.item_external_id, l.item_name, l.quantity, l.unit_price, l.quantity * l.unit_price, l.quantity * l.unit_price
from live_sales s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
cross join lateral (
  values
    ('L1', null, 'item', 'DRINK-1', 'Drink one', 2.0, 10000),
    ('L2', 'L1', 'modifier', 'MOD-SUGAR', 'Less sugar', 1.0, 0),
    ('L3', 'L1', 'modifier', 'MOD-ICE', 'Less ice', 1.0, 0),
    ('L4', null, 'item', 'SNACK-1', 'Snack one', 1.5, 10000),
    ('L5', null, 'service', 'SERVICE-1', 'Delivery', 1.0, 0)
) as l (external_id, parent_line, line_kind, item_external_id, item_name, quantity, unit_price)
where s.invoice_no in (1, 2, 3, 5)
  and (s.invoice_no = 1 or l.external_id in ('L1', 'L4'));

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select f.tenant_id, s.store_id, i.id, p.sequence_no, s.business_date, p.method, p.amount
from live_sales s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
cross join lateral (
  values
    (1, 1, 'CASH', 20000),
    (1, 2, 'CASH', 10000),
    (1, 3, 'CARD', 5000),
    (2, 1, 'CASH', 30000),
    (3, 1, 'WALLET', 20000),
    (5, 1, 'UNKNOWN-METHOD', 15000),
    (5, 2, 'CASH', 10000)
) as p (invoice_no, sequence_no, method, amount)
where p.invoice_no = s.invoice_no;

create temp table compared_ranges as
select f.demo_tenant_id as range_tenant, f.demo_stores as range_stores, f.demo_from as range_from, f.demo_to as range_to from fixture f
union all
select f.tenant_id, f.both_stores, current_date - 10, current_date from fixture f;

select is(
  (
    select (
      (
        select count(*)
        from compared_ranges c
        cross join lateral (
          (select x.* from app.daily_sales_facts(null, c.range_from, c.range_to, c.range_stores) x
           except all
           select y.* from pg_temp.reference_daily_sales_facts(null, c.range_from, c.range_to, c.range_stores) y)
          union all
          (select y.* from pg_temp.reference_daily_sales_facts(null, c.range_from, c.range_to, c.range_stores) y
           except all
           select x.* from app.daily_sales_facts(null, c.range_from, c.range_to, c.range_stores) x)
        ) differences
      ),
      (
        select count(*) > 13
        from compared_ranges c
        cross join lateral app.daily_sales_facts(null, c.range_from, c.range_to, c.range_stores) x
      )
    )
  ),
  (0::bigint, true),
  'the store branch equals the previous hash-join body on the demo seed and on modifiers, voids, multi-tender cash and empty invoices'
);
select is(
  (
    select count(*)
    from compared_ranges c
    cross join lateral (
      (select x.* from app.daily_sales_facts(c.range_tenant, c.range_from, c.range_to) x
       except all
       select y.* from pg_temp.reference_daily_sales_facts(c.range_tenant, c.range_from, c.range_to) y)
      union all
      (select y.* from pg_temp.reference_daily_sales_facts(c.range_tenant, c.range_from, c.range_to) y
       except all
       select x.* from app.daily_sales_facts(c.range_tenant, c.range_from, c.range_to) x)
    ) differences
  ),
  0::bigint,
  'the tenant branch equals the previous body for the demo tenant and the fixture tenant'
);
select is(
  (
    select count(*)
    from compared_ranges c
    cross join lateral (
      (select x.* from app.daily_sales_facts(null, c.range_from, c.range_to) x where x.tenant_id = c.range_tenant
       except all
       select y.* from pg_temp.reference_daily_sales_facts(null, c.range_from, c.range_to) y where y.tenant_id = c.range_tenant)
      union all
      (select y.* from pg_temp.reference_daily_sales_facts(null, c.range_from, c.range_to) y where y.tenant_id = c.range_tenant
       except all
       select x.* from app.daily_sales_facts(null, c.range_from, c.range_to) x where x.tenant_id = c.range_tenant)
    ) differences
  ),
  0::bigint,
  'the branch without tenant or stores equals the previous body on the rows of both tenants'
);
select is(
  (
    select (n.items_sold, n.modifier_lines, n.cash_amount, n.invoices, n.voided_invoices, n.edited_invoices, n.voucher_invoices, n.member_invoices)
    from fixture f
    cross join lateral app.daily_sales_facts(null, current_date - 1, current_date - 1, array[f.store_a]) n
  ),
  (10.500::numeric, 2, 40000.00::numeric, 4, 1, 1, 2, 1),
  'one fixture day counts item quantities without modifiers or services, and only the cash tenders of its sales'
);

create temp table demo_daily_before as
select a.tenant_id, a.store_id, a.business_date, a.invoices, a.gross_amount, a.item_discount_amount, a.bill_discount_amount, a.voucher_amount,
  a.net_amount, a.paid_amount, a.cash_amount, a.items_sold, a.modifier_lines, a.voucher_invoices, a.member_invoices, a.identified_invoices,
  a.voided_invoices, a.voided_amount, a.edited_invoices
from public.agg_daily_sales a
join fixture f on f.demo_tenant_id = a.tenant_id;

select app.refresh_analytics(f.demo_tenant_id, f.demo_from, f.demo_to) from fixture f;

select is(
  (
    select count(*)
    from (
      (select * from demo_daily_before
       except all
       select a.tenant_id, a.store_id, a.business_date, a.invoices, a.gross_amount, a.item_discount_amount, a.bill_discount_amount, a.voucher_amount,
         a.net_amount, a.paid_amount, a.cash_amount, a.items_sold, a.modifier_lines, a.voucher_invoices, a.member_invoices, a.identified_invoices,
         a.voided_invoices, a.voided_amount, a.edited_invoices
       from public.agg_daily_sales a join fixture f on f.demo_tenant_id = a.tenant_id)
      union all
      (select a.tenant_id, a.store_id, a.business_date, a.invoices, a.gross_amount, a.item_discount_amount, a.bill_discount_amount, a.voucher_amount,
         a.net_amount, a.paid_amount, a.cash_amount, a.items_sold, a.modifier_lines, a.voucher_invoices, a.member_invoices, a.identified_invoices,
         a.voided_invoices, a.voided_amount, a.edited_invoices
       from public.agg_daily_sales a join fixture f on f.demo_tenant_id = a.tenant_id
       except all
       select * from demo_daily_before)
    ) differences
  ),
  0::bigint,
  'a re-run of refresh_analytics leaves the demo agg_daily_sales unchanged'
);
select ok(
  (select count(*) > 0 from demo_daily_before),
  'the demo tenant has daily aggregates to compare'
);
select ok(
  (
    select jsonb_path_exists(pg_temp.live_half_plan(f.both_stores, current_date - 1, current_date), '$.** ? (@."Index Name" == "invoice_lines_invoice_id_idx")')
    from fixture f
  ),
  'the store branch for two days reads the lines of each invoice through invoice_lines_invoice_id_idx'
);

select * from finish();
rollback;
