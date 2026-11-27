-- The native till, step 6 (ADR-061, native-till.md section 11): native orders in the sales facts. A completed order
-- becomes an invoice of its store under the tenant's POS account of connector native, with its lines (options as
-- modifier lines) and its payments by method, through the same columns the sync writes, so the live half of every
-- report reads it at once; a succeeded refund edits it (a full refund voids it) and logs an invoice event. The dates
-- it touches are marked, and the minute job refreshes the aggregates of a marked date once it leaves the live window.
-- Native invoices carry no receipt number and no phone, so the phone loyalty paths never match them (the stamp card
-- rewards native orders), and the sync compares only the invoices of its own POS account.

-- 1. The native POS account of a tenant -------------------------------------------------------------------------

create function app.native_payment_method_name(p_method text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_method
    when 'cash' then 'Tiền mặt'
    when 'card' then 'Thẻ'
    when 'zalo_checkout' then 'Ví điện tử (Zalo)'
    when 'vietqr' then 'Chuyển khoản VietQR'
  end;
$$;

comment on function app.native_payment_method_name(text) is 'the display name of a native payment method in the sales facts';

create function app.native_pos_account(p_tenant_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.pos_accounts;
begin
  insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
  values (p_tenant_id, 'native', 'native', 'Native till')
  on conflict (tenant_id, account_key) do nothing;
  select a.* into strict v_account from public.pos_accounts a where a.tenant_id = p_tenant_id and a.account_key = 'native';
  if v_account.connector <> 'native' then
    raise exception 'the account key native belongs to another connector' using errcode = '23505';
  end if;
  insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
  select p_tenant_id, v_account.id, m.method, app.native_payment_method_name(m.method), m.kind::public.payment_kind
  from (values ('cash', 'cash'), ('card', 'card'), ('zalo_checkout', 'ewallet'), ('vietqr', 'bank_transfer')) as m (method, kind)
  on conflict (pos_account_id, external_id) do nothing;
  return v_account.id;
end;
$$;

comment on function app.native_pos_account(uuid) is 'the tenant''s POS account of connector native (account key native), created on first use with its four payment methods and their kinds (cash, card, e-wallet, bank transfer); no store points at it, so the sync never pulls it';

-- 2. Dates whose aggregates need a refresh ------------------------------------------------------------------------

create table app.native_analytics_pending (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  business_date date not null,
  marked_at timestamptz not null,
  primary key (tenant_id, business_date)
);

comment on table app.native_analytics_pending is 'business dates whose native invoices changed since the aggregates were last refreshed; the minute job refreshes a date once it leaves the live window of the reports (app.analytics_live_from) and removes the mark it saw; no API role reads it';

-- 3. The invoice of a completed order ----------------------------------------------------------------------------

create function app.native_order_invoice(p_order_id uuid, p_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_money record;
  v_account uuid;
  v_invoice uuid;
  v_status public.invoice_status;
  v_primary text;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null or v_order.status <> 'completed' then
    return null;
  end if;
  select m.* into v_money from app.order_money(v_order.id) m;
  v_account := app.native_pos_account(v_order.tenant_id);
  v_status := case
    when v_money.paid > 0 and v_money.refunded >= v_money.paid then 'voided'
    when v_money.refunded > 0 then 'edited'
    else 'completed'
  end;
  select p.method into v_primary
  from public.order_payments p
  where p.order_id = v_order.id and p.status = 'succeeded'
  order by p.amount desc, p.settled_at, p.id
  limit 1;
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, opened_at, closed_at,
    table_name, area_name, sale_type, source_external_id, source_name, gross_amount, bill_discount_amount, bill_discount_name,
    net_amount, paid_amount, primary_payment_method_external_id, primary_payment_method_name, status, raw, synced_at)
  values (v_order.tenant_id, v_order.store_id, v_account, 'native-' || v_order.id, null, coalesce(v_order.completed_at, p_at), v_order.business_date,
    v_order.placed_at, v_order.completed_at, v_order.table_label, (select t.area from public.store_tables t where t.id = v_order.table_id),
    v_order.order_type, 'native-' || v_order.source, case v_order.source when 'app' then 'Ứng dụng' else 'Quầy' end,
    v_order.subtotal, v_order.discount_amount, case when v_order.discount_amount > 0 then 'Phần thưởng tích điểm' end,
    case when v_status = 'voided' then v_order.total else v_order.total - v_money.refunded end,
    case when v_status = 'voided' then v_money.paid else v_money.paid - v_money.refunded end,
    v_primary, app.native_payment_method_name(v_primary), v_status,
    jsonb_build_object('source', 'native', 'order_id', v_order.id, 'order_no', app.order_display_no(v_order.order_no)), p_at)
  on conflict (store_id, external_id) do update
  set net_amount = excluded.net_amount,
      paid_amount = excluded.paid_amount,
      status = excluded.status,
      primary_payment_method_external_id = excluded.primary_payment_method_external_id,
      primary_payment_method_name = excluded.primary_payment_method_name,
      synced_at = excluded.synced_at
  returning id into v_invoice;

  if not exists (select 1 from public.invoice_lines l where l.invoice_id = v_invoice) then
    insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, parent_line_external_id, line_kind, item_external_id,
      item_name, base_name, size_label, item_type_external_id, item_type_name, quantity, list_unit_price, unit_price, gross_amount,
      discount_amount, net_amount, note)
    select l.tenant_id, l.store_id, v_invoice, l.line_no::text, null, 'item'::public.line_kind, coalesce(l.size_id, l.item_id)::text,
      l.item_name || coalesce(' ' || l.size_label, ''), l.item_name, l.size_label, c.id::text, c.name, l.quantity, l.unit_price, l.unit_price,
      l.quantity * l.unit_price, 0, l.quantity * l.unit_price, l.note
    from public.order_lines l
    left join public.menu_items i on i.id = l.item_id
    left join public.menu_categories c on c.id = i.category_id
    where l.order_id = v_order.id
    union all
    select l.tenant_id, l.store_id, v_invoice, l.line_no || '.' || x.n, l.line_no::text, 'modifier'::public.line_kind, x.option ->> 'option_id',
      x.option ->> 'name', x.option ->> 'name', null, null, x.option ->> 'group', l.quantity, (x.option ->> 'price')::numeric,
      (x.option ->> 'price')::numeric, l.quantity * (x.option ->> 'price')::numeric, 0, l.quantity * (x.option ->> 'price')::numeric, null
    from public.order_lines l
    cross join lateral jsonb_array_elements(l.options) with ordinality as x (option, n)
    where l.order_id = v_order.id;
  end if;

  delete from public.invoice_payments p where p.invoice_id = v_invoice;
  insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, payment_method_name,
    amount, reference_no)
  select v_order.tenant_id, v_order.store_id, v_invoice, (row_number() over (order by b.first_at, b.method))::smallint, v_order.business_date,
    b.method, app.native_payment_method_name(b.method), b.amount, b.ref
  from (
    select f.method, sum(f.amount) as amount, min(f.at) as first_at, max(f.ref) as ref
    from (
      select p.method, p.amount, p.settled_at as at, p.provider_ref as ref from public.order_payments p where p.order_id = v_order.id and p.status = 'succeeded'
      union all
      select r.method, -r.amount, r.settled_at, null from public.order_refunds r where r.order_id = v_order.id and r.status = 'succeeded'
    ) f
    group by f.method
  ) b
  where b.amount <> 0;

  insert into app.native_analytics_pending (tenant_id, business_date, marked_at)
  values (v_order.tenant_id, v_order.business_date, p_at)
  on conflict (tenant_id, business_date) do update set marked_at = excluded.marked_at;
  return v_invoice;
end;
$$;

comment on function app.native_order_invoice(uuid, timestamptz) is 'writes the invoice of a completed native order through the sync''s columns: external id native-<order id>, the tenant''s native POS account, no receipt number and no phone (the phone loyalty paths cannot match it), the order''s business date, sold at completion, gross the subtotal, the stamp reward as a bill discount, net and paid less succeeded refunds (a full refund voids it, keeping the amounts), item lines per order line keyed by size with the menu category as item type and options as modifier lines, payments as the net of each method; marks the date for the analytics refresh; nothing for an order that is not completed';

create function app.native_order_refunded(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := app.native_order_invoice(p_order.id, p_at);
  v_refund public.order_refunds;
begin
  if v_invoice is null then
    return;
  end if;
  select r.* into v_refund from public.order_refunds r
  where r.order_id = p_order.id and r.status = 'succeeded'
  order by r.settled_at desc, r.id desc
  limit 1;
  insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, reason, source)
  select i.tenant_id, i.store_id, i.id, i.external_id, case when i.status = 'voided' then 'voided' else 'edited' end::public.invoice_event_kind,
    coalesce(v_refund.settled_at, p_at), v_refund.amount, v_refund.reason, 'native_refund'
  from public.invoices i
  where i.id = v_invoice
  on conflict (store_id, invoice_external_id, kind, occurred_at) do nothing;
end;
$$;

comment on function app.native_order_refunded(public.orders, timestamptz) is 'after a succeeded refund of a completed order: rewrites its invoice (edited, or voided by a full refund) and logs an invoice event with the refund''s amount and reason (source native_refund); nothing for an order that never completed';

-- 4. The hooks ----------------------------------------------------------------------------------------------------

create or replace function app.order_after_completion(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.stamps_on_completion(p_order, p_at);
  perform app.native_order_invoice(p_order.id, p_at);
end;
$$;

create or replace function app.order_after_refund(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.stamps_on_refund(p_order, p_at);
  perform app.native_order_refunded(p_order, p_at);
end;
$$;

comment on function app.order_after_completion(public.orders, timestamptz) is 'the hook run when an order is completed: its stamps (step 5) and its invoice in the sales facts (step 6)';
comment on function app.order_after_refund(public.orders, timestamptz) is 'the hook run after a refund succeeds: the order''s stamps are taken back (step 5) and its invoice edited or voided (step 6)';

-- 5. The analytics refresh of marked dates ------------------------------------------------------------------------

create function app.native_analytics_refresh(p_at timestamptz default now(), p_limit integer default 2)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mark app.native_analytics_pending;
  v_done integer := 0;
begin
  for v_mark in
    select m.* from app.native_analytics_pending m
    where m.business_date < app.analytics_live_from()
    order by m.marked_at, m.tenant_id, m.business_date
    limit greatest(coalesce(p_limit, 0), 0)
  loop
    perform app.refresh_analytics(v_mark.tenant_id, v_mark.business_date, v_mark.business_date);
    delete from app.native_analytics_pending m
    where m.tenant_id = v_mark.tenant_id and m.business_date = v_mark.business_date and m.marked_at = v_mark.marked_at;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

comment on function app.native_analytics_refresh(timestamptz, integer) is 'refreshes the aggregates of at most p_limit marked dates that left the live window of the reports (oldest mark first) and removes the marks it saw; a date marked again meanwhile keeps its mark for the next run; answers how many dates it refreshed';

create or replace function app.ordering_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_cancelled integer := 0;
  v_pruned integer;
  v_refreshed integer;
begin
  for v_order in
    select o.* from public.orders o
    where o.status = 'awaiting_payment' and o.payment_due_at <= p_at
    order by o.payment_due_at
    limit 500
    for update skip locked
  loop
    perform app.order_move(v_order, 'cancelled', 'payment_timeout', 'system', null, 'payment_timeout', null, p_at);
    v_cancelled := v_cancelled + 1;
  end loop;
  delete from app.ordering_presence p where p.seen_at < p_at - interval '1 day';
  get diagnostics v_pruned = row_count;
  v_refreshed := app.native_analytics_refresh(p_at, 2);
  return jsonb_build_object('payment_timeouts', v_cancelled, 'presence_pruned', v_pruned, 'analytics_dates_refreshed', v_refreshed);
end;
$$;

comment on function app.ordering_tick(timestamptz) is 'the minute job of the native till: cancels the orders whose online payment window passed (payment_timeout, nothing charged, no number taken), prunes counter presence older than a day and refreshes the aggregates of up to two dates whose native invoices changed once they left the live window; touches only due rows; answers counts';

-- 6. Grants ------------------------------------------------------------------------------------------------------

revoke all on table app.native_analytics_pending from public, anon, authenticated, service_role;

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('native_payment_method_name', 'native_pos_account', 'native_order_invoice', 'native_order_refunded', 'order_after_completion',
        'order_after_refund', 'native_analytics_refresh', 'ordering_tick')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;
