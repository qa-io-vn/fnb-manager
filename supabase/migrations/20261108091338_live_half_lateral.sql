create or replace function app.daily_sales_facts(p_tenant uuid, p_from date, p_to date, p_store_ids uuid[] default null)
returns table (
  tenant_id uuid,
  store_id uuid,
  business_date date,
  invoices integer,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  modifier_lines integer,
  voucher_invoices integer,
  member_invoices integer,
  identified_invoices integer,
  voided_invoices integer,
  voided_amount numeric,
  edited_invoices integer
)
language sql
stable
security invoker
rows 10000
set search_path = ''
as $$
  with inv as (
    select * from app.sales_invoices(p_tenant, p_from, p_to, p_store_ids)
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
  left join lateral (
    select
      coalesce(sum(l.quantity) filter (where l.line_kind = 'item'), 0) as items_sold,
      count(*) filter (where l.line_kind = 'modifier') as modifier_lines
    from public.invoice_lines l
    where l.invoice_id = inv.invoice_id
  ) lt on true
  left join lateral (
    select sum(p.amount) as cash_amount
    from public.invoice_payments p
    join public.payment_methods pm
      on pm.pos_account_id = inv.pos_account_id
      and pm.external_id = p.payment_method_external_id
    where p.invoice_id = inv.invoice_id
      and pm.kind = 'cash'
  ) c on true
  group by inv.tenant_id, inv.store_id, inv.business_date;
$$;

revoke all on function app.daily_sales_facts(uuid, date, date, uuid[]) from public;
grant execute on function app.daily_sales_facts(uuid, date, date, uuid[]) to authenticated, service_role;
