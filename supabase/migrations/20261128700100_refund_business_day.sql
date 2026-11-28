-- Defect D-1 (acceptance criterion 6, ADR-071): a refund counts on the business day it is handed back. A completed
-- order refunded on a later business day left both days unmatched: the refund edited or voided the invoice of the
-- order's day while the cash left the drawer of the refund day's shift (and an online or card refund was taken off the
-- order's day). The owner has not decided yet; this is the default, chosen to match Vietnamese accounting and the
-- e-invoice adjustment, which is dated the day it is issued.
--
-- 1. app.refund_business_date decides the day of a succeeded refund, in one place: for cash, the business date of the
--    shift whose drawer paid it out (the drawer the clock-out counts); for card and online, the store's business date
--    at the instant the refund succeeded (the store's day start, as the rest of the native till); never before the
--    order's own business date. The other choice, a refund counting on the order's own day, is this one function
--    answering the order's business date: every refund is then of the same day and everything below follows.
-- 2. A refund of the order's own business day edits the order's invoice, or voids it when it is refunded in full, as
--    before. A refund of a later business day never changes the earlier day: the order's invoice keeps its amounts,
--    status and payments, and the refund is its own document of the refund's business day, written through the sync's
--    columns with the external id native-<order id>-refund-<refund id>, the status refund, a net and paid amount of
--    minus the refund (gross 0: a deduction from revenue, as a same-day refund is), one payment of minus the refund in
--    its method, no line; the refund day is marked for the analytics refresh. Writing the documents is idempotent and
--    also runs at completion, so a refund settled before an order completes is placed the same way.
-- 3. manager_day_reconciliation subtracts each refund on its own day: the revenue and the card and cash invoiced follow
--    the documents of the day; the online refunds confirmed by the gateway are taken off the day they are counted on.
--    Two explanatory figures: cash_refund_owed, the cash still owed back for the day's cancelled paid orders, and
--    cancelled_cash, the net cash of cancelled orders in the day's drawers (taken for the day's cancelled orders less
--    handed back on the day), whose opposite is the difference cancelled orders cause.
-- 4. Every reader of the sales facts sums a refund document and never counts it as an invoice, a sale or a visit
--    (status in ('completed', 'edited') in the counts, status <> 'voided' in the sums): the daily and hourly facts, the
--    payment aggregate's invoice count, the zero-sales alert and its resolution, the voucher spike, the data quality
--    summary, member share by shift and the capture rate of customer_metrics. export_control_totals counts the refund
--    documents (refund_invoices), so the export's daily summary still adds up.

-- 1. The business day of a refund ---------------------------------------------------------------------------------

create function app.refund_business_date(p_refund public.order_refunds)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_refund.status = 'succeeded' and p_refund.settled_at is not null then greatest(
    o.business_date,
    coalesce(
      case when p_refund.method = 'cash' and p_refund.recorded_by is not null then (
        select s.business_date
        from public.staff_shifts s
        where s.store_id = p_refund.store_id
          and s.user_id = p_refund.recorded_by
          and s.clock_in_at <= p_refund.settled_at
          and (s.clock_out_at is null or p_refund.settled_at < s.clock_out_at)
        order by s.clock_in_at desc
        limit 1
      ) end,
      app.store_business_date(p_refund.store_id, p_refund.settled_at)
    )
  ) end
  from public.orders o
  where o.id = p_refund.order_id;
$$;

comment on function app.refund_business_date(public.order_refunds) is 'the business date a succeeded refund counts on (ADR-071): for cash, the business date of the shift of the person who recorded it at the store that held the instant it was settled (the drawer that paid it out, as app.shift_cash_flow counts it); for card and online refunds, and cash without such a shift, the store''s business date at the instant it succeeded; never before the order''s own business date; null for a refund that has not succeeded. The one place of the rule: answering the order''s business date instead makes every refund count on the order''s day';

-- 2. The documents of a native order --------------------------------------------------------------------------------

create function app.native_refund_documents(p_order_id uuid, p_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_refund public.order_refunds;
  v_day date;
  v_account uuid;
  v_invoice uuid;
  v_written integer := 0;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null or v_order.status <> 'completed' then
    return 0;
  end if;
  for v_refund in
    select r.* from public.order_refunds r
    where r.order_id = v_order.id and r.status = 'succeeded'
    order by r.settled_at, r.id
  loop
    v_day := app.refund_business_date(v_refund);
    continue when v_day is null or v_day = v_order.business_date;
    v_account := coalesce(v_account, app.native_pos_account(v_order.tenant_id));
    v_invoice := null;
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, opened_at, closed_at,
      table_name, area_name, sale_type, source_external_id, source_name, gross_amount, bill_discount_amount, bill_discount_name,
      net_amount, paid_amount, primary_payment_method_external_id, primary_payment_method_name, status, raw, synced_at)
    values (v_order.tenant_id, v_order.store_id, v_account, 'native-' || v_order.id || '-refund-' || v_refund.id, null, v_refund.settled_at, v_day,
      v_refund.requested_at, v_refund.settled_at, v_order.table_label, (select t.area from public.store_tables t where t.id = v_order.table_id),
      v_order.order_type, 'native-' || v_order.source, case v_order.source when 'app' then 'Ứng dụng' else 'Quầy' end,
      0, 0, null, -v_refund.amount, -v_refund.amount, v_refund.method, app.native_payment_method_name(v_refund.method), 'refund',
      jsonb_build_object('source', 'native', 'kind', 'refund', 'order_id', v_order.id, 'order_no', app.order_display_no(v_order.order_no),
        'refund_id', v_refund.id, 'refunds', 'native-' || v_order.id, 'order_business_date', v_order.business_date), p_at)
    on conflict (store_id, external_id) do nothing
    returning id into v_invoice;
    continue when v_invoice is null;
    insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, payment_method_name,
      amount, reference_no)
    values (v_order.tenant_id, v_order.store_id, v_invoice, 1, v_day, v_refund.method, app.native_payment_method_name(v_refund.method),
      -v_refund.amount, v_refund.provider_ref);
    insert into app.native_analytics_pending (tenant_id, business_date, marked_at)
    values (v_order.tenant_id, v_day, p_at)
    on conflict (tenant_id, business_date) do update set marked_at = excluded.marked_at;
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$$;

comment on function app.native_refund_documents(uuid, timestamptz) is 'writes, for each succeeded refund of a completed native order that counts on a later business day than the order''s (app.refund_business_date), its own document of that day through the sync''s columns (ADR-071): external id native-<order id>-refund-<refund id>, status refund, sold and closed when the refund succeeded, gross 0, net and paid minus the refund, the refund''s method as the primary payment and one payment of minus the refund with the provider''s reference, no line, no receipt number and no phone; marks that day for the analytics refresh; a document already written is left as it is (idempotent); answers how many it wrote; nothing for an order that is not completed';

create or replace function app.native_order_invoice(p_order_id uuid, p_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_paid numeric;
  v_refunded numeric;
  v_account uuid;
  v_invoice uuid;
  v_status public.invoice_status;
  v_primary text;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null or v_order.status <> 'completed' then
    return null;
  end if;
  select m.paid into v_paid from app.order_money(v_order.id) m;
  -- only the refunds that count on the order's own business day change its invoice; a later one is its own document
  select coalesce(sum(r.amount), 0) into v_refunded
  from public.order_refunds r
  where r.order_id = v_order.id and r.status = 'succeeded' and app.refund_business_date(r) = v_order.business_date;
  v_account := app.native_pos_account(v_order.tenant_id);
  v_status := case
    when v_paid > 0 and v_refunded >= v_paid then 'voided'
    when v_refunded > 0 then 'edited'
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
    case when v_status = 'voided' then v_order.total else v_order.total - v_refunded end,
    case when v_status = 'voided' then v_paid else v_paid - v_refunded end,
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
      select r.method, -r.amount, r.settled_at, null from public.order_refunds r
      where r.order_id = v_order.id and r.status = 'succeeded' and app.refund_business_date(r) = v_order.business_date
    ) f
    group by f.method
  ) b
  where b.amount <> 0;

  insert into app.native_analytics_pending (tenant_id, business_date, marked_at)
  values (v_order.tenant_id, v_order.business_date, p_at)
  on conflict (tenant_id, business_date) do update set marked_at = excluded.marked_at;
  perform app.native_refund_documents(v_order.id, p_at);
  return v_invoice;
end;
$$;

comment on function app.native_order_invoice(uuid, timestamptz) is 'writes the invoice of a completed native order through the sync''s columns: external id native-<order id>, the tenant''s native POS account, no receipt number and no phone (the phone loyalty paths cannot match it), the order''s business date, sold at completion, gross the subtotal, the stamp reward as a bill discount, net and paid less the succeeded refunds that count on the order''s own business day (a full refund of that day voids it, keeping the amounts), item lines per order line keyed by size with the menu category as item type and options as modifier lines, payments as the net of each method of that day; marks the date for the analytics refresh; then writes the document of each refund of a later business day (app.native_refund_documents, ADR-071); nothing for an order that is not completed';

create or replace function app.native_order_refunded(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund public.order_refunds;
  v_invoice uuid;
begin
  select r.* into v_refund from public.order_refunds r
  where r.order_id = p_order.id and r.status = 'succeeded'
  order by r.settled_at desc, r.id desc
  limit 1;
  if v_refund.id is not null and app.refund_business_date(v_refund) is distinct from p_order.business_date
     and exists (select 1 from public.invoices i where i.store_id = p_order.store_id and i.external_id = 'native-' || p_order.id) then
    -- a refund of a later business day is its own document of that day: the order's invoice and its day stay as they were
    perform app.native_refund_documents(p_order.id, p_at);
    return;
  end if;
  v_invoice := app.native_order_invoice(p_order.id, p_at);
  if v_invoice is null then
    return;
  end if;
  insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, reason, source)
  select i.tenant_id, i.store_id, i.id, i.external_id, case when i.status = 'voided' then 'voided' else 'edited' end::public.invoice_event_kind,
    coalesce(v_refund.settled_at, p_at), v_refund.amount, v_refund.reason, 'native_refund'
  from public.invoices i
  where i.id = v_invoice
  on conflict (store_id, invoice_external_id, kind, occurred_at) do nothing;
end;
$$;

comment on function app.native_order_refunded(public.orders, timestamptz) is 'after a succeeded refund of a completed order: a refund of the order''s own business day rewrites its invoice (edited, or voided by a full refund) and logs an invoice event with the refund''s amount and reason (source native_refund); a refund of a later business day (ADR-071) leaves the order''s invoice and day untouched and is written as its own document of the refund''s day (app.native_refund_documents), which is its record; nothing for an order that never completed';

-- 3. The day's reconciliation -----------------------------------------------------------------------------------------

create or replace function app.manager_day_reconciliation(p_store_id uuid, p_date date, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_from timestamptz;
  v_revenue numeric;
  v_methods jsonb;
  v_online numeric;
  v_card numeric;
  v_cash_invoiced numeric;
  v_expected numeric;
  v_counted numeric;
  v_open integer;
  v_awaiting integer;
  v_unfinished numeric;
  v_owed numeric;
  v_cancelled_cash numeric;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'a business date' using errcode = '22023';
  end if;
  -- the day's first instant: a refund counted on the day succeeded at or after it (app.refund_business_date)
  v_from := (p_date::timestamp + make_interval(mins => v_store.business_day_start_minutes)) at time zone v_store.timezone;
  -- the native documents of the day: the invoices of its orders and the refunds of earlier orders handed back on it
  select coalesce(sum(i.net_amount), 0) into v_revenue
  from public.invoices i join public.pos_accounts a on a.id = i.pos_account_id and a.connector = 'native'
  where i.store_id = v_store.id and i.business_date = p_date and i.status <> 'voided';
  select coalesce(jsonb_object_agg(x.method, x.amount), '{}'::jsonb) into v_methods
  from (
    select p.payment_method_external_id as method, sum(p.amount)::bigint as amount
    from public.invoice_payments p
    join public.invoices i on i.id = p.invoice_id
    join public.pos_accounts a on a.id = i.pos_account_id and a.connector = 'native'
    where i.store_id = v_store.id and i.business_date = p_date and i.status <> 'voided'
    group by p.payment_method_external_id
  ) x;
  v_card := coalesce((v_methods ->> 'card')::numeric, 0);
  v_cash_invoiced := coalesce((v_methods ->> 'cash')::numeric, 0);
  -- the gateway: the online payments it confirmed for the day's completed orders, less the online refunds of completed
  -- orders it confirmed that count on this day, whichever day their order was
  select coalesce(sum(p.amount), 0)
    - coalesce((select sum(r.amount) from public.order_refunds r join public.orders o2 on o2.id = r.order_id
        where r.store_id = v_store.id and o2.status = 'completed' and r.status = 'succeeded' and r.method in ('zalo_checkout', 'vietqr')
          and r.settled_at >= v_from and app.refund_business_date(r) = p_date), 0)
  into v_online
  from public.order_payments p join public.orders o on o.id = p.order_id
  where o.store_id = v_store.id and o.business_date = p_date and o.status = 'completed'
    and p.method in ('zalo_checkout', 'vietqr') and p.status = 'succeeded' and p.provider_ref is not null;
  select coalesce(sum(s.expected_cash - s.opening_cash), 0), coalesce(sum(s.counted_cash - s.opening_cash), 0),
    count(*) filter (where s.status = 'open'), count(*) filter (where s.status = 'awaiting_confirmation')
  into v_expected, v_counted, v_open, v_awaiting
  from public.staff_shifts s where s.store_id = v_store.id and s.business_date = p_date;
  v_expected := coalesce(v_expected, 0);
  v_counted := coalesce(v_counted, 0);
  select coalesce(sum(p.amount), 0) into v_unfinished
  from public.order_payments p join public.orders o on o.id = p.order_id
  where o.store_id = v_store.id and o.business_date = p_date and o.status not in ('completed', 'cancelled') and p.status = 'succeeded';
  -- cancelled paid orders: the cash still owed back, and the net cash of cancelled orders in the day's drawers
  select coalesce(sum(r.amount), 0) into v_owed
  from public.order_refunds r join public.orders o on o.id = r.order_id
  where o.store_id = v_store.id and o.business_date = p_date and o.status = 'cancelled' and r.method = 'cash' and r.status in ('due', 'pending');
  select coalesce((select sum(p.amount) from public.order_payments p join public.orders o on o.id = p.order_id
      where o.store_id = v_store.id and o.business_date = p_date and o.status = 'cancelled' and p.method = 'cash' and p.status = 'succeeded'), 0)
    - coalesce((select sum(r.amount) from public.order_refunds r join public.orders o on o.id = r.order_id
      where r.store_id = v_store.id and o.status = 'cancelled' and r.method = 'cash' and r.status = 'succeeded'
        and r.settled_at >= v_from and app.refund_business_date(r) = p_date), 0)
  into v_cancelled_cash;
  return jsonb_build_object(
    'store_id', v_store.id,
    'business_date', p_date,
    'revenue', v_revenue::bigint,
    'by_method', v_methods,
    'online_confirmed', v_online::bigint,
    'card', v_card::bigint,
    'cash', jsonb_build_object('invoiced', v_cash_invoiced::bigint, 'expected', v_expected::bigint, 'counted', v_counted::bigint,
      'difference', (v_counted - v_expected)::bigint),
    'shifts_open', v_open,
    'shifts_awaiting_confirmation', v_awaiting,
    'paid_not_completed', v_unfinished::bigint,
    'cash_refund_owed', v_owed::bigint,
    'cancelled_cash', v_cancelled_cash::bigint,
    'difference', (v_revenue - v_online - v_card - v_counted)::bigint,
    'matched', v_revenue = v_online + v_card + v_counted and v_open = 0 and v_awaiting = 0
  );
end;
$$;

comment on function app.manager_day_reconciliation(uuid, date, timestamptz) is 'acceptance criterion 6 for a native store''s business day, for its owners and managers: the revenue of its native documents (the invoices of the day''s orders and the refunds of any order that count on the day, ADR-071), their payments by method, the online payments the provider confirmed for the day''s completed orders less the confirmed online refunds of completed orders that count on the day, the card payments, and the cash the shifts of the day counted against what the counter recorded (opening cash left out); matched when the revenue equals the confirmed online payments, the card payments and the counted cash, and every shift of the day is closed. Explanations, outside the match: paid_not_completed, money taken for orders of the day not completed yet; cash_refund_owed, the cash still owed back (due or pending) for the day''s cancelled paid orders; cancelled_cash, the net cash of cancelled orders in the day''s drawers (cash taken for the day''s cancelled orders less cash handed back on the day for any cancelled order), whose opposite is the difference cancelled orders cause';

-- 4. The readers: a refund document is in every sum and in no count -------------------------------------------------

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
    (count(*) filter (where inv.status in ('completed', 'edited')))::integer,
    coalesce(sum(inv.gross_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.item_discount_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.bill_discount_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.voucher_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.net_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(inv.paid_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(c.cash_amount) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(lt.items_sold) filter (where inv.status <> 'voided'), 0),
    coalesce(sum(lt.modifier_lines) filter (where inv.status <> 'voided'), 0)::integer,
    (count(*) filter (where inv.status in ('completed', 'edited') and inv.has_voucher))::integer,
    (count(*) filter (where inv.status in ('completed', 'edited') and inv.customer_phone is not null))::integer,
    (count(*) filter (where inv.status in ('completed', 'edited') and (inv.customer_phone is not null or inv.customer_id is not null)))::integer,
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

create or replace function app.hourly_sales_facts(p_tenant uuid, p_from date, p_to date, p_store_ids uuid[] default null)
returns table (
  tenant_id uuid,
  store_id uuid,
  business_date date,
  hour_local smallint,
  invoices integer,
  net_amount numeric,
  items_sold numeric
)
language sql
stable
security invoker
rows 10000
set search_path = ''
as $$
  with inv as (
    select i.*, extract(hour from (i.sold_at at time zone s.timezone))::smallint as hour_local
    from app.sales_invoices(p_tenant, p_from, p_to, p_store_ids) i
    join public.stores s on s.id = i.store_id
    where i.status <> 'voided'
  ),
  line_totals as (
    select l.invoice_id, coalesce(sum(l.quantity) filter (where l.line_kind = 'item'), 0) as items_sold
    from public.invoice_lines l
    join inv on inv.invoice_id = l.invoice_id
    group by l.invoice_id
  )
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    inv.hour_local,
    (count(*) filter (where inv.status in ('completed', 'edited')))::integer,
    coalesce(sum(inv.net_amount), 0),
    coalesce(sum(lt.items_sold), 0)
  from inv
  left join line_totals lt on lt.invoice_id = inv.invoice_id
  group by inv.tenant_id, inv.store_id, inv.business_date, inv.hour_local;
$$;

create or replace function app.refresh_analytics(p_tenant uuid, p_from date, p_to date)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  refresh_id uuid;
  total_rows bigint := 0;
  inserted_rows bigint;
  pairs_from date := p_to - 27;
  inputs_version bigint;
begin
  if p_tenant is null or p_from is null or p_to is null then
    raise exception 'refresh_analytics needs a tenant and a closed date range';
  end if;
  if p_from > p_to then
    raise exception 'refresh_analytics range starts % after it ends %', p_from, p_to;
  end if;

  perform pg_advisory_xact_lock(hashtext('refresh_analytics'), hashtext(p_tenant::text));

  select t.analytics_inputs_version into inputs_version
  from public.tenants t
  where t.id = p_tenant;

  insert into public.analytics_refreshes (tenant_id, from_date, to_date)
  values (p_tenant, p_from, p_to)
  returning id into refresh_id;

  delete from public.agg_daily_sales where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_hourly_sales where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_item_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_category_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_payment_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_shift_cash a
  where a.tenant_id = p_tenant
    and (
      a.business_date between p_from and p_to
      or a.shift_id in (
        select sh.id
        from public.shifts sh
        join public.stores st on st.id = sh.store_id
        where sh.tenant_id = p_tenant
          and ((sh.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date between p_from and p_to
      )
    );
  delete from public.agg_size_mix_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_modifier_prefs_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_attach_daily where tenant_id = p_tenant and business_date between p_from and p_to;
  delete from public.agg_basket_pairs_28d where tenant_id = p_tenant and as_of_date = p_to;

  insert into public.agg_daily_sales (
    tenant_id, store_id, business_date, invoices, gross_amount, item_discount_amount, bill_discount_amount, voucher_amount,
    net_amount, paid_amount, cash_amount, items_sold, modifier_lines, voucher_invoices, member_invoices, identified_invoices,
    voided_invoices, voided_amount, edited_invoices
  )
  select
    tenant_id, store_id, business_date, invoices, gross_amount, item_discount_amount, bill_discount_amount, voucher_amount,
    net_amount, paid_amount, cash_amount, items_sold, modifier_lines, voucher_invoices, member_invoices, identified_invoices,
    voided_invoices, voided_amount, edited_invoices
  from app.daily_sales_facts(p_tenant, p_from, p_to);
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_hourly_sales (tenant_id, store_id, business_date, hour_local, invoices, net_amount, items_sold)
  select tenant_id, store_id, business_date, hour_local, invoices, net_amount, items_sold
  from app.hourly_sales_facts(p_tenant, p_from, p_to);
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_item_daily (
    tenant_id, store_id, business_date, item_external_id, item_name, base_name, size_label, item_type_external_id, item_type_name,
    quantity, net_amount, invoices
  )
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    coalesce(l.item_external_id, l.item_name),
    max(l.item_name),
    max(l.base_name),
    max(l.size_label),
    max(l.item_type_external_id),
    max(l.item_type_name),
    sum(l.quantity),
    sum(l.net_amount),
    count(distinct l.invoice_id)::integer
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_lines l on l.invoice_id = inv.invoice_id
  where inv.status <> 'voided'
    and l.line_kind = 'item'
  group by inv.tenant_id, inv.store_id, inv.business_date, coalesce(l.item_external_id, l.item_name);
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_category_daily (tenant_id, store_id, business_date, item_type_external_id, item_type_name, role, quantity, net_amount)
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    coalesce(o.item_type_external_id, l.item_type_external_id, 'uncategorized'),
    coalesce(max(ot.name), max(l.item_type_name)),
    coalesce((array_agg(r.role) filter (where r.role is not null))[1], 'other'),
    sum(l.quantity),
    sum(l.net_amount)
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_lines l on l.invoice_id = inv.invoice_id
  left join public.item_category_overrides o
    on o.pos_account_id = inv.pos_account_id
    and o.item_external_id = coalesce(l.item_external_id, l.item_name)
  left join public.item_types ot
    on ot.pos_account_id = o.pos_account_id
    and ot.external_id = o.item_type_external_id
  left join public.item_type_roles r
    on r.pos_account_id = inv.pos_account_id
    and r.item_type_external_id = coalesce(o.item_type_external_id, l.item_type_external_id)
  where inv.status <> 'voided'
    and l.line_kind = 'item'
  group by inv.tenant_id, inv.store_id, inv.business_date, coalesce(o.item_type_external_id, l.item_type_external_id, 'uncategorized');
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_payment_daily (
    tenant_id, store_id, business_date, payment_method_external_id, payment_method_name, kind, invoices, amount, fee_amount, fee_estimate_amount
  )
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    coalesce(p.payment_method_external_id, 'unknown'),
    coalesce(max(pm.name), max(p.payment_method_name)),
    coalesce((array_agg(pm.kind) filter (where pm.kind is not null))[1], 'other'),
    (count(distinct p.invoice_id) filter (where inv.status in ('completed', 'edited')))::integer,
    sum(p.amount),
    sum(p.fee_amount),
    coalesce(sum(round(p.amount * coalesce(rate.fee_pct, 0) / 100 + coalesce(rate.fixed_fee_amount, 0), 2)), 0)
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_payments p on p.invoice_id = inv.invoice_id
  left join public.payment_methods pm
    on pm.pos_account_id = inv.pos_account_id
    and pm.external_id = p.payment_method_external_id
  left join lateral (
    select fr.fee_pct, fr.fixed_fee_amount
    from public.payment_fee_rates fr
    where fr.tenant_id = inv.tenant_id
      and fr.payment_method_external_id = p.payment_method_external_id
      and fr.effective_from <= inv.business_date
      and (fr.store_id = inv.store_id or fr.store_id is null)
    order by (fr.store_id is not null) desc, fr.effective_from desc
    limit 1
  ) rate on true
  where inv.status <> 'voided'
  group by inv.tenant_id, inv.store_id, inv.business_date, coalesce(p.payment_method_external_id, 'unknown');
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_shift_cash (
    tenant_id, store_id, shift_id, shift_external_id, business_date, cashier_name, opened_at, closed_at, orders, sales_amount,
    cash_sales_amount, opening_float_amount, expected_cash_amount, drawer_amount, variance_amount
  )
  with shift_days as (
    select
      sh.*,
      ((sh.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date as shift_business_date,
      st.pos_account_id
    from public.shifts sh
    join public.stores st on st.id = sh.store_id
    where sh.tenant_id = p_tenant
  ),
  cash_by_shift as (
    select
      i.store_id,
      i.shift_external_id,
      sum(p.amount) as cash_sales_amount
    from public.invoices i
    join public.invoice_payments p on p.invoice_id = i.id
    join public.payment_methods pm
      on pm.pos_account_id = i.pos_account_id
      and pm.external_id = p.payment_method_external_id
    where i.tenant_id = p_tenant
      and i.status <> 'voided'
      and i.shift_external_id is not null
      and i.business_date between p_from - 1 and p_to + 1
      and pm.kind = 'cash'
    group by i.store_id, i.shift_external_id
  )
  select
    sd.tenant_id,
    sd.store_id,
    sd.id,
    sd.external_id,
    sd.shift_business_date,
    sd.cashier_name,
    sd.opened_at,
    sd.closed_at,
    sd.orders_count,
    sd.sales_amount,
    coalesce(c.cash_sales_amount, 0),
    sd.opening_float_amount,
    sd.expected_cash_amount,
    sd.cash_drawer_amount,
    sd.cash_variance_amount
  from shift_days sd
  left join cash_by_shift c on c.store_id = sd.store_id and c.shift_external_id = sd.external_id
  where sd.shift_business_date between p_from and p_to;
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_size_mix_daily (tenant_id, store_id, business_date, base_name, size_label, quantity, net_amount)
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    coalesce(l.base_name, l.item_name),
    l.size_label,
    sum(l.quantity),
    sum(l.net_amount)
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_lines l on l.invoice_id = inv.invoice_id
  where inv.status <> 'voided'
    and l.line_kind = 'item'
    and l.size_label is not null
  group by inv.tenant_id, inv.store_id, inv.business_date, coalesce(l.base_name, l.item_name), l.size_label;
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_modifier_prefs_daily (tenant_id, store_id, business_date, modifier_name, count)
  select
    inv.tenant_id,
    inv.store_id,
    inv.business_date,
    l.item_name,
    count(*)::integer
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_lines l on l.invoice_id = inv.invoice_id
  where inv.status <> 'voided'
    and l.line_kind = 'modifier'
  group by inv.tenant_id, inv.store_id, inv.business_date, l.item_name;
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_attach_daily (
    tenant_id, store_id, business_date, drink_invoices, topping_invoices, snack_invoices, topping_lines, snack_lines, attach_rate_topping, attach_rate_snack
  )
  with mapped_roles as (
    select
      r.pos_account_id,
      bool_or(r.role = 'topping') as has_topping_role,
      bool_or(r.role = 'snack') as has_snack_role
    from public.item_type_roles r
    where r.tenant_id = p_tenant
    group by r.pos_account_id
  ),
  role_lines as (
    select
      inv.tenant_id,
      inv.store_id,
      inv.business_date,
      inv.invoice_id,
      coalesce(r.role, 'other') as role,
      count(*) as lines
    from app.sales_invoices(p_tenant, p_from, p_to) inv
    join public.invoice_lines l on l.invoice_id = inv.invoice_id
    left join public.item_category_overrides o
      on o.pos_account_id = inv.pos_account_id
      and o.item_external_id = coalesce(l.item_external_id, l.item_name)
    left join public.item_type_roles r
      on r.pos_account_id = inv.pos_account_id
      and r.item_type_external_id = coalesce(o.item_type_external_id, l.item_type_external_id)
    where inv.status <> 'voided'
      and l.line_kind = 'item'
    group by inv.tenant_id, inv.store_id, inv.business_date, inv.invoice_id, coalesce(r.role, 'other')
  ),
  per_invoice as (
    select
      tenant_id,
      store_id,
      business_date,
      invoice_id,
      bool_or(role = 'drink') as has_drink,
      bool_or(role = 'topping') as has_topping,
      bool_or(role = 'snack') as has_snack,
      coalesce(sum(lines) filter (where role = 'topping'), 0) as topping_lines,
      coalesce(sum(lines) filter (where role = 'snack'), 0) as snack_lines
    from role_lines
    group by tenant_id, store_id, business_date, invoice_id
  ),
  per_day as (
    select
      tenant_id,
      store_id,
      business_date,
      (count(*) filter (where has_drink))::integer as drink_invoices,
      (count(*) filter (where has_drink and has_topping))::integer as topping_invoices,
      (count(*) filter (where has_drink and has_snack))::integer as snack_invoices,
      coalesce(sum(topping_lines) filter (where has_drink), 0)::integer as topping_lines,
      coalesce(sum(snack_lines) filter (where has_drink), 0)::integer as snack_lines
    from per_invoice
    group by tenant_id, store_id, business_date
  )
  select
    d.tenant_id,
    d.store_id,
    d.business_date,
    d.drink_invoices,
    d.topping_invoices,
    d.snack_invoices,
    d.topping_lines,
    d.snack_lines,
    case when coalesce(m.has_topping_role, false) then round(d.topping_invoices::numeric / nullif(d.drink_invoices, 0), 6) end,
    case when coalesce(m.has_snack_role, false) then round(d.snack_invoices::numeric / nullif(d.drink_invoices, 0), 6) end
  from per_day d
  join public.stores st on st.id = d.store_id
  left join mapped_roles m on m.pos_account_id = st.pos_account_id;
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  insert into public.agg_basket_pairs_28d (
    tenant_id, store_id, as_of_date, item_a_external_id, item_a_name, item_b_external_id, item_b_name, pair_invoices, support_a, support_b, lift
  )
  with invoice_items as (
    select distinct
      inv.tenant_id,
      inv.store_id,
      inv.invoice_id,
      coalesce(l.item_external_id, l.item_name) as item_external_id,
      l.item_name
    from app.sales_invoices(p_tenant, pairs_from, p_to) inv
    join public.invoice_lines l on l.invoice_id = inv.invoice_id
    where inv.status <> 'voided'
      and l.line_kind = 'item'
  ),
  store_totals as (
    select store_id, count(distinct invoice_id) as invoices
    from invoice_items
    group by store_id
  ),
  item_totals as (
    select store_id, item_external_id, max(item_name) as item_name, count(distinct invoice_id) as invoices
    from invoice_items
    group by store_id, item_external_id
  ),
  pairs as (
    select
      a.tenant_id,
      a.store_id,
      a.item_external_id as item_a_external_id,
      b.item_external_id as item_b_external_id,
      count(distinct a.invoice_id) as pair_invoices
    from invoice_items a
    join invoice_items b
      on b.invoice_id = a.invoice_id
      and b.item_external_id > a.item_external_id
    group by a.tenant_id, a.store_id, a.item_external_id, b.item_external_id
    having count(distinct a.invoice_id) >= 3
  )
  select
    p.tenant_id,
    p.store_id,
    p_to,
    p.item_a_external_id,
    ia.item_name,
    p.item_b_external_id,
    ib.item_name,
    p.pair_invoices::integer,
    round(ia.invoices::numeric / st.invoices, 6),
    round(ib.invoices::numeric / st.invoices, 6),
    round((p.pair_invoices::numeric / st.invoices) / ((ia.invoices::numeric / st.invoices) * (ib.invoices::numeric / st.invoices)), 4)
  from pairs p
  join store_totals st on st.store_id = p.store_id
  join item_totals ia on ia.store_id = p.store_id and ia.item_external_id = p.item_a_external_id
  join item_totals ib on ib.store_id = p.store_id and ib.item_external_id = p.item_b_external_id;
  get diagnostics inserted_rows = row_count;
  total_rows := total_rows + inserted_rows;

  perform app.shrink_analytics_pending(p_tenant, p_from, p_to, inputs_version);

  update public.analytics_refreshes
  set finished_at = now(), rows = total_rows
  where id = refresh_id;

  return total_rows;
end;
$$;

create or replace function app.evaluate_intraday_rules(p_at timestamptz, p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate record;
  effective record;
  today date;
  day_start timestamptz;
  open_minutes integer;
  last_sync timestamptz;
  last_nightly timestamptz;
  hours integer;
  raised record;
  counted integer := 0;
begin
  if p_at is null then
    raise exception 'evaluate_intraday_rules needs an instant' using errcode = '22023';
  end if;
  for candidate in
    select s.id, s.tenant_id, s.pos_account_id, s.opening_hours, s.timezone, s.business_day_start_minutes
    from public.stores s
    join public.pos_accounts a on a.id = s.pos_account_id
    where (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and a.status::text not in ('paused', 'auth_failed')
      and app.tenant_has_destinations(s.tenant_id)
      and app.opening_hours_known(s.opening_hours)
      and app.incremental_sync_watched(s.id)
      and coalesce(app.store_open_at(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at), false)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, candidate.id, 'zero_sales_open') r;
    continue when not coalesce(effective.enabled, false);
    today := ((p_at at time zone candidate.timezone) - make_interval(mins => candidate.business_day_start_minutes))::date;
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'zero_sales_open:store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD')
    );
    day_start := (today + make_interval(mins => candidate.business_day_start_minutes)) at time zone candidate.timezone;
    open_minutes := app.opening_minutes_between(candidate.opening_hours, candidate.timezone, candidate.business_day_start_minutes, day_start, p_at);
    continue when open_minutes < coalesce((effective.params ->> 'min_open_minutes')::integer, 120);
    last_sync := app.last_successful_sync(candidate.id, p_at);
    continue when last_sync is null
      or last_sync < p_at - make_interval(mins => coalesce((effective.params ->> 'fresh_sync_minutes')::integer, 45));
    continue when exists (
      select 1
      from public.invoices i
      where i.store_id = candidate.id
        and i.business_date = today
        and i.status in ('completed', 'edited')
    );
    continue when coalesce((effective.params ->> 'skip_holidays')::boolean, true)
      and coalesce(app.is_excluded_day(array[candidate.id], today), false);
    continue when coalesce(
      (select min(k.business_date) from public.sync_checks k where k.store_id = candidate.id),
      'infinity'::date
    ) > today - coalesce((effective.params ->> 'min_history_days')::integer, 28);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'zero_sales_open', 'store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD'),
      'scheduler', p_at, candidate.id, candidate.pos_account_id, null, today,
      jsonb_build_object('open_minutes', open_minutes)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;

  for candidate in
    select t.id as tenant_id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and app.tenant_has_destinations(t.id)
    order by t.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, null, 'nightly_missing') r;
    continue when not coalesce(effective.enabled, false);
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'nightly_missing:tenant'
    );
    continue when not exists (
      select 1 from app.alert_destinations(candidate.tenant_id, null, null, 'nightly_missing') d
    );
    select max(r.finished_at) into last_nightly
    from public.sync_runs r
    where r.tenant_id = candidate.tenant_id
      and r.kind = 'nightly'
      and r.status = 'succeeded'
      and r.finished_at <= p_at;
    continue when last_nightly is null;
    hours := coalesce((effective.params ->> 'hours')::integer, 30);
    continue when last_nightly > p_at - make_interval(hours => hours);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'nightly_missing', 'tenant', 'scheduler', p_at,
      null, null, null, null,
      jsonb_build_object('hours', hours, 'hours_since_nightly', floor(extract(epoch from (p_at - last_nightly)) / 3600)::integer)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end;
$$;

create or replace function app.reconcile_alerts(p_at timestamptz default now(), p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  schedule_enabled boolean;
  schedule_changed_at timestamptz;
  episode record;
  effective record;
  resolution_value text;
  threshold integer;
  account_status text;
  last_sync timestamptz;
  queued integer;
  changed integer := 0;
begin
  select s.enabled, s.updated_at into schedule_enabled, schedule_changed_at
  from app.incremental_sync_settings s;
  for episode in
    select e.*
    from public.alert_events e
    where e.state = 'open'
      and (p_tenant_id is null or e.tenant_id = p_tenant_id)
    order by e.opened_at, e.id
    for update of e skip locked
  loop
    select r.* into effective from app.effective_alert_rule(episode.tenant_id, episode.store_id, episode.rule_key) r;
    resolution_value := null;
    if episode.rule_key = 'auth_failed' then
      account_status := null;
      select a.status::text into account_status
      from public.pos_accounts a
      where a.id = episode.pos_account_id;
      if account_status is null or account_status = 'paused' then
        resolution_value := 'superseded';
      elsif account_status <> 'auth_failed' then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'sync_failed' then
      if split_part(episode.dedupe_key, ':', 2) = 'store' then
        if exists (
          select 1
          from public.stores s
          join public.sync_runs r on r.pos_account_id = s.pos_account_id
          where s.id = episode.store_id
            and r.status = 'succeeded'
            and r.kind <> 'master_data'
            and r.started_at > episode.opened_at
            and r.started_at <= p_at
            and app.sync_run_covers_store(r.store_id, r.store_ids, s.id)
        ) then
          resolution_value := 'recovered';
        end if;
      elsif exists (
        select 1
        from public.sync_runs r
        where r.pos_account_id = episode.pos_account_id
          and r.kind::text = split_part(episode.dedupe_key, ':', 4)
          and r.status = 'succeeded'
          and r.started_at > episode.opened_at
          and r.started_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'sync_stale' then
      threshold := coalesce((effective.params ->> 'threshold_minutes')::integer, 90);
      last_sync := app.last_successful_sync(episode.store_id, p_at);
      if not coalesce(schedule_enabled, false) and schedule_changed_at >= episode.opened_at then
        resolution_value := 'schedule_disabled';
      elsif not app.incremental_sync_watched(episode.store_id) then
        resolution_value := 'superseded';
      elsif not exists (
          select 1
          from app.sync_alerts a
          where a.store_id = episode.store_id
            and a.kind = 'sync_stale'
            and a.resolved_at is null
            and a.last_seen_at > coalesce(last_sync, '-infinity'::timestamptz)
        )
        and coalesce(app.sync_gap_minutes(episode.store_id, p_at), 0) <= threshold
      then
        resolution_value := case when coalesce(last_sync > episode.opened_at, false) then 'recovered' else 'superseded' end;
      end if;
    elsif episode.rule_key = 'sync_dispatch_failed' then
      if not exists (
        select 1
        from app.sync_alerts a
        where a.store_id = episode.store_id
          and a.kind = 'dispatch_failed'
          and a.resolved_at is null
      ) then
        resolution_value := 'cleared';
      end if;
    elsif episode.rule_key = 'zero_sales_open' then
      if exists (
        select 1
        from public.invoices i
        where i.store_id = episode.store_id
          and i.business_date = episode.business_date
          and i.status in ('completed', 'edited')
      ) then
        resolution_value := 'cleared';
      elsif exists (
        select 1
        from public.stores s
        where s.id = episode.store_id
          and p_at >= ((episode.business_date + 1) + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone
      ) then
        resolution_value := 'day_ended';
      end if;
    elsif episode.rule_key = 'nightly_missing' then
      if exists (
        select 1
        from public.sync_runs r
        where r.tenant_id = episode.tenant_id
          and r.kind = 'nightly'
          and r.status = 'succeeded'
          and r.finished_at > episode.opened_at
          and r.finished_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'digest_failed' then
      if exists (
        select 1
        from public.digests d
        where d.tenant_id = episode.tenant_id
          and d.business_date = episode.business_date
          and d.scope_key = split_part(episode.dedupe_key, ':', 3)
          and d.state = 'built'
      ) then
        resolution_value := 'cleared';
      end if;
    elsif episode.rule_key = 'channel_failed' then
      if exists (
        select 1
        from public.outbound_messages o
        where o.channel_id = episode.channel_id
          and o.status in ('sent', 'delivered')
          and o.sent_at > episode.opened_at
          and o.sent_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    end if;

    if resolution_value is not null then
      update public.alert_events e
      set state = 'resolved',
          resolved_at = p_at,
          resolution = resolution_value
      where e.id = episode.id;
      queued := 0;
      if coalesce(effective.notify_on_resolve, false) and resolution_value in ('recovered', 'cleared') then
        queued := app.enqueue_alert_messages(episode.id, 'alert_resolved', p_at);
        if queued > 0 then
          update public.alert_events e set notifications = e.notifications + queued where e.id = episode.id;
        end if;
      end if;
      changed := changed + 1;
    elsif coalesce(effective.enabled, false)
      and effective.remind_every is not null
      and episode.last_notified_at is not null
      and episode.last_notified_at + effective.remind_every <= p_at
      and app.root_cause_event(episode.tenant_id, episode.rule_key, episode.store_id, episode.pos_account_id, p_at) is null
    then
      queued := app.enqueue_alert_messages(episode.id, 'alert_reminder', p_at);
      update public.alert_events e
      set last_notified_at = p_at,
          notifications = e.notifications + queued
      where e.id = episode.id;
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

create or replace function app.evaluate_voucher_spikes(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  ratio numeric;
  min_vouchers integer;
  weeks integer;
  min_samples integer;
  today date;
  on_day date;
  subject text;
  vouchers integer;
  invoice_count integer;
  samples integer;
  base_vouchers numeric;
  base_share numeric;
  over_count boolean;
  over_share boolean;
  raised record;
  opened integer := 0;
begin
  for target in
    select s.id, s.tenant_id
    from public.stores s
    where s.active
      and (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(s.tenant_id)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(target.tenant_id, target.id, 'voucher_spike') r;
    continue when not coalesce(effective.enabled, false);
    ratio := coalesce((effective.params ->> 'ratio')::numeric, 2);
    min_vouchers := coalesce((effective.params ->> 'min_vouchers')::integer, 5);
    weeks := coalesce((effective.params ->> 'weeks')::integer, 8);
    min_samples := coalesce((effective.params ->> 'min_sample_days')::integer, 3);
    today := app.store_business_date(target.id, p_at);
    foreach on_day in array array[today - 1, today] loop
      subject := 'store:' || target.id::text || ':' || to_char(on_day, 'YYYY-MM-DD');
      continue when exists (
        select 1
        from public.alert_events e
        where e.tenant_id = target.tenant_id
          and e.dedupe_key = 'voucher_spike:' || subject
      );
      select
        (count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null))::integer,
        count(*)::integer
      into vouchers, invoice_count
      from public.invoices i
      where i.store_id = target.id
        and i.business_date = on_day
        and i.status in ('completed', 'edited');
      continue when vouchers < min_vouchers;
      select count(*)::integer, avg(x.day_vouchers), avg(x.day_share)
      into samples, base_vouchers, base_share
      from (
        select
          w.on_date,
          count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null) as day_vouchers,
          (count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null))::numeric / count(*) as day_share
        from generate_series(1, weeks) as g (n)
        cross join lateral (select on_day - 7 * g.n as on_date) w
        join public.invoices i
          on i.store_id = target.id
         and i.business_date = w.on_date
         and i.status in ('completed', 'edited')
        group by w.on_date
      ) x;
      continue when samples < min_samples;
      over_count := vouchers > ratio * base_vouchers;
      over_share := invoice_count > 0 and vouchers::numeric / invoice_count > ratio * base_share;
      continue when not (over_count or over_share);
      select r.* into raised
      from app.raise_alert(target.tenant_id, 'voucher_spike', subject, p_source, p_at,
        target.id, null, null, on_day,
        jsonb_build_object(
          'vouchers', vouchers,
          'invoices', invoice_count,
          'share', round(vouchers::numeric / invoice_count, 4),
          'baseline_vouchers', round(base_vouchers, 1),
          'baseline_share', round(base_share, 4),
          'sample_days', samples,
          'ratio', ratio,
          'over_count', over_count,
          'over_share', over_share
        ),
        null, true) r;
      if raised.outcome = 'opened' then
        opened := opened + 1;
      end if;
    end loop;
  end loop;
  return opened;
end;
$$;

create or replace function public.data_quality_summary(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  invoices bigint,
  item_lines bigint,
  modifier_lines bigint,
  modifier_line_share numeric,
  catalogue_modifier_lines bigint,
  identified_invoices bigint,
  capture_rate numeric,
  identified_customers bigint,
  loyalty_consents bigint,
  marketing_consents bigint,
  consent_coverage numeric,
  unattributed_events bigint,
  e_invoice_status public.e_invoice_status,
  tran_no_reset_period public.tran_no_reset_period,
  member_capture_status public.pos_feature_status,
  opening_hours_known boolean,
  seat_count integer,
  opened_on date,
  receipt_days integer,
  receipt_restarts_daily boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  receipt_lookback_days constant integer := 120;
  min_receipt_days constant integer := 20;
  restart_share constant numeric := 0.9;
  restart_max_number constant integer := 3;
begin
  perform app.require_store_ids('data_quality_summary', data_quality_summary.store_ids);
  perform app.require_date_range('data_quality_summary', data_quality_summary.from_date, data_quality_summary.to_date, max_range_days);
  if cardinality(data_quality_summary.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as materialized (
    select s.id as v_store, v.store_position as v_position, s.tenant_id as v_tenant, s.timezone as v_timezone,
      s.business_day_start_minutes as v_day_start,
      s.e_invoice_status as v_e_invoice, s.tran_no_reset_period as v_tran_no, s.member_capture_status as v_member,
      app.opening_hours_present(s.opening_hours) as v_hours_known, s.seat_count as v_seats, s.opened_on as v_opened
    from app.visible_stores(data_quality_summary.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  sales as materialized (
    select i.store_id as sale_store, i.id as sale_id, i.pos_account_id as sale_account, i.customer_id as sale_customer,
      i.customer_phone is not null or i.customer_id is not null as sale_identified
    from public.invoices i
    join visible vs on vs.v_store = i.store_id
    where i.business_date between data_quality_summary.from_date and data_quality_summary.to_date
      and i.status in ('completed', 'edited')
  ),
  lines as (
    select
      x.sale_store as l_store,
      count(*) filter (where l.line_kind = 'item') as l_items,
      count(*) filter (where l.line_kind = 'modifier') as l_modifiers,
      count(*) filter (where l.line_kind = 'item' and l.catalogue_modifier) as l_catalogue_modifiers
    from sales x
    cross join lateral (
      select
        il.line_kind,
        il.line_kind = 'item' and exists (
          select 1
          from public.items it
          where it.pos_account_id = x.sale_account
            and it.external_id = il.item_external_id
            and it.is_modifier
        ) as catalogue_modifier
      from public.invoice_lines il
      where il.invoice_id = x.sale_id
        and il.line_kind in ('item', 'modifier')
    ) l
    group by x.sale_store
  ),
  per_store as (
    select
      x.sale_store as p_store,
      count(*) as p_invoices,
      count(*) filter (where x.sale_identified) as p_identified
    from sales x
    group by x.sale_store
  ),
  customers as materialized (
    select distinct x.sale_store as c_store, x.sale_customer as c_customer, vs.v_tenant as c_tenant
    from sales x
    join visible vs on vs.v_store = x.sale_store
    where x.sale_customer is not null
  ),
  consents as (
    select
      c.c_store,
      c.c_customer,
      app.has_active_consent(c.c_tenant, 'customer', c.c_customer, 'loyalty') as c_loyalty,
      app.has_active_consent(c.c_tenant, 'customer', c.c_customer, 'marketing') as c_marketing
    from customers c
  ),
  shift_windows as (
    select a.store_id as w_store, a.shift_external_id as w_shift, a.opened_at as w_from,
      coalesce(a.closed_at, a.opened_at + interval '1 day') as w_to
    from public.agg_shift_cash a
    join visible vs on vs.v_store = a.store_id
    where a.business_date between data_quality_summary.from_date - 2 and data_quality_summary.to_date + 1
  ),
  unattributed as (
    select e.store_id as u_store, count(*) as u_events
    from public.invoice_events e
    join visible vs on vs.v_store = e.store_id
    left join public.invoices i on i.id = e.invoice_id
    where ((e.occurred_at at time zone vs.v_timezone) - make_interval(mins => vs.v_day_start))::date
        between data_quality_summary.from_date and data_quality_summary.to_date
      and case
        when i.id is not null and i.shift_external_id is not null then not exists (
          select 1
          from public.agg_shift_cash a
          where a.store_id = i.store_id
            and a.shift_external_id = i.shift_external_id
        )
        else not exists (
          select 1
          from shift_windows w
          where w.w_store = e.store_id
            and e.occurred_at >= w.w_from
            and e.occurred_at < w.w_to
        )
      end
    group by e.store_id
  ),
  receipt_days as (
    select
      i.store_id as r_store,
      i.business_date as r_on,
      bool_and(i.receipt_no ~ '^[0-9]+$') as r_numeric,
      min(case when i.receipt_no ~ '^[0-9]{1,18}$' then i.receipt_no::bigint end) as r_first
    from public.invoices i
    join visible vs on vs.v_store = i.store_id
    where i.business_date between data_quality_summary.to_date - (receipt_lookback_days - 1) and data_quality_summary.to_date
      and i.receipt_no is not null
    group by i.store_id, i.business_date
  ),
  receipts as (
    select
      r.r_store,
      (count(*) filter (where r.r_numeric))::integer as r_days,
      count(*) filter (where r.r_numeric and r.r_first <= restart_max_number) as r_restarts
    from receipt_days r
    group by r.r_store
  ),
  store_rows as (
    select
      vs.v_store,
      vs.v_position,
      coalesce(ps.p_invoices, 0) as s_invoices,
      coalesce(l.l_items, 0) as s_items,
      coalesce(l.l_modifiers, 0) as s_modifiers,
      coalesce(l.l_catalogue_modifiers, 0) as s_catalogue_modifiers,
      coalesce(ps.p_identified, 0) as s_identified,
      (select count(*) from customers c where c.c_store = vs.v_store) as s_customers,
      (select count(*) from consents c where c.c_store = vs.v_store and c.c_loyalty) as s_loyalty,
      (select count(*) from consents c where c.c_store = vs.v_store and c.c_marketing) as s_marketing,
      coalesce(u.u_events, 0) as s_unattributed,
      vs.v_e_invoice, vs.v_tran_no, vs.v_member, vs.v_hours_known, vs.v_seats, vs.v_opened,
      case when coalesce(r.r_days, 0) >= min_receipt_days then r.r_days end as s_receipt_days,
      case when coalesce(r.r_days, 0) >= min_receipt_days then r.r_restarts >= restart_share * r.r_days end as s_restarts
    from visible vs
    left join per_store ps on ps.p_store = vs.v_store
    left join lines l on l.l_store = vs.v_store
    left join unattributed u on u.u_store = vs.v_store
    left join receipts r on r.r_store = vs.v_store
  ),
  all_stores as (
    select
      sum(s.s_invoices)::bigint as a_invoices,
      sum(s.s_items)::bigint as a_items,
      sum(s.s_modifiers)::bigint as a_modifiers,
      sum(s.s_catalogue_modifiers)::bigint as a_catalogue_modifiers,
      sum(s.s_identified)::bigint as a_identified,
      (select count(distinct c.c_customer) from customers c) as a_customers,
      (select count(distinct c.c_customer) filter (where c.c_loyalty) from consents c) as a_loyalty,
      (select count(distinct c.c_customer) filter (where c.c_marketing) from consents c) as a_marketing,
      sum(s.s_unattributed)::bigint as a_unattributed
    from store_rows s
  )
  select
    u.u_store, u.u_invoices, u.u_items, u.u_modifiers, u.u_modifier_share, u.u_catalogue_modifiers,
    u.u_identified, u.u_capture, u.u_customers, u.u_loyalty, u.u_marketing, u.u_coverage, u.u_unattributed,
    u.u_e_invoice, u.u_tran_no, u.u_member, u.u_hours_known, u.u_seats, u.u_opened, u.u_receipt_days, u.u_restarts
  from (
    select
      0::bigint as u_order,
      null::uuid as u_store,
      coalesce(a.a_invoices, 0) as u_invoices,
      coalesce(a.a_items, 0) as u_items,
      coalesce(a.a_modifiers, 0) as u_modifiers,
      case when coalesce(a.a_items, 0) + coalesce(a.a_modifiers, 0) > 0
        then round(a.a_modifiers::numeric / (a.a_items + a.a_modifiers), 6) end as u_modifier_share,
      coalesce(a.a_catalogue_modifiers, 0) as u_catalogue_modifiers,
      coalesce(a.a_identified, 0) as u_identified,
      case when coalesce(a.a_invoices, 0) > 0 then round(a.a_identified::numeric / a.a_invoices, 6) end as u_capture,
      a.a_customers as u_customers,
      a.a_loyalty as u_loyalty,
      a.a_marketing as u_marketing,
      case when a.a_customers > 0 then round(a.a_loyalty::numeric / a.a_customers, 6) end as u_coverage,
      coalesce(a.a_unattributed, 0) as u_unattributed,
      null::public.e_invoice_status as u_e_invoice,
      null::public.tran_no_reset_period as u_tran_no,
      null::public.pos_feature_status as u_member,
      null::boolean as u_hours_known,
      null::integer as u_seats,
      null::date as u_opened,
      null::integer as u_receipt_days,
      null::boolean as u_restarts
    from all_stores a
    union all
    select
      s.v_position,
      s.v_store,
      s.s_invoices,
      s.s_items,
      s.s_modifiers,
      case when s.s_items + s.s_modifiers > 0 then round(s.s_modifiers::numeric / (s.s_items + s.s_modifiers), 6) end,
      s.s_catalogue_modifiers,
      s.s_identified,
      case when s.s_invoices > 0 then round(s.s_identified::numeric / s.s_invoices, 6) end,
      s.s_customers,
      s.s_loyalty,
      s.s_marketing,
      case when s.s_customers > 0 then round(s.s_loyalty::numeric / s.s_customers, 6) end,
      s.s_unattributed,
      s.v_e_invoice,
      s.v_tran_no,
      s.v_member,
      s.v_hours_known,
      s.v_seats,
      s.v_opened,
      s.s_receipt_days,
      s.s_restarts
    from store_rows s
  ) u
  order by u.u_order;
end;
$$;

create or replace function public.member_share_by_shift(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  business_date date,
  shift_ordinal integer,
  opened_at timestamptz,
  closed_at timestamptz,
  invoices integer,
  member_invoices integer,
  identified_invoices integer,
  member_share numeric,
  identified_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_range_days constant integer := 92;
  returned_rows bigint;
begin
  perform app.require_store_ids('member_share_by_shift', member_share_by_shift.store_ids);
  perform app.require_date_range('member_share_by_shift', member_share_by_shift.from_date, member_share_by_shift.to_date, max_range_days);

  return query
  with visible as (
    select v.store_id as vs_store, v.store_position as vs_position, st.timezone as vs_zone, st.business_day_start_minutes as vs_day_start
    from app.visible_stores(member_share_by_shift.store_ids) v
    join public.stores st on st.id = v.store_id
  ),
  shift_days as (
    select
      sh.store_id as sd_store,
      sh.id as sd_id,
      sh.external_id as sd_external,
      sh.opened_at as sd_opened,
      sh.closed_at as sd_closed,
      ((sh.opened_at at time zone vs.vs_zone) - make_interval(mins => vs.vs_day_start))::date as sd_on
    from public.shifts sh
    join visible vs on vs.vs_store = sh.store_id
    where sh.opened_at >= (member_share_by_shift.from_date - 2)::timestamp at time zone 'UTC'
      and sh.opened_at < (member_share_by_shift.to_date + 3)::timestamp at time zone 'UTC'
  ),
  numbered as materialized (
    select
      sd.*,
      row_number() over (partition by sd.sd_store, sd.sd_on order by sd.sd_opened, sd.sd_external collate "C")::integer as sd_ordinal
    from shift_days sd
    where sd.sd_on between member_share_by_shift.from_date and member_share_by_shift.to_date
  ),
  shift_counts as (
    select
      n.sd_id as sc_shift,
      count(*)::integer as sc_invoices,
      (count(*) filter (where i.has_customer_phone))::integer as sc_members,
      (count(*) filter (where i.has_customer_identity))::integer as sc_identified
    from numbered n
    join public.invoices i on i.store_id = n.sd_store and i.shift_external_id = n.sd_external
    where i.status in ('completed', 'edited')
    group by n.sd_id
  ),
  unshifted as (
    select
      i.store_id as us_store,
      i.business_date as us_on,
      count(*)::integer as us_invoices,
      (count(*) filter (where i.has_customer_phone))::integer as us_members,
      (count(*) filter (where i.has_customer_identity))::integer as us_identified
    from public.invoices i
    join visible vs on vs.vs_store = i.store_id
    where i.business_date between member_share_by_shift.from_date and member_share_by_shift.to_date
      and i.status in ('completed', 'edited')
      and not exists (
        select 1
        from public.shifts sh
        where sh.store_id = i.store_id
          and sh.external_id = i.shift_external_id
      )
    group by i.store_id, i.business_date
  ),
  counted as (
    select
      n.sd_store as r_store,
      n.sd_on as r_on,
      n.sd_ordinal as r_ordinal,
      n.sd_opened as r_opened,
      n.sd_closed as r_closed,
      coalesce(sc.sc_invoices, 0) as r_invoices,
      coalesce(sc.sc_members, 0) as r_members,
      coalesce(sc.sc_identified, 0) as r_identified
    from numbered n
    left join shift_counts sc on sc.sc_shift = n.sd_id
    union all
    select us.us_store, us.us_on, null::integer, null::timestamptz, null::timestamptz, us.us_invoices, us.us_members, us.us_identified
    from unshifted us
  )
  select
    c.r_store,
    c.r_on,
    c.r_ordinal,
    c.r_opened,
    c.r_closed,
    c.r_invoices,
    c.r_members,
    c.r_identified,
    case when c.r_invoices > 0 then round(c.r_members::numeric / c.r_invoices, 6) end,
    case when c.r_invoices > 0 then round(c.r_identified::numeric / c.r_invoices, 6) end
  from counted c
  join visible vs on vs.vs_store = c.r_store
  order by c.r_on, vs.vs_position, c.r_ordinal nulls last;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('member_share_by_shift', returned_rows);
end;
$$;

create or replace function public.customer_metrics(p_store_ids uuid[], p_from date, p_to date)
returns table (
  invoices integer,
  identified_invoices integer,
  customer_capture_rate numeric,
  customers integer,
  repeat_customers integer,
  repeat_rate numeric,
  active_customers_30d integer,
  visit_frequency_30d numeric,
  active_customers_90d integer,
  visit_frequency_90d numeric,
  outstanding_points integer,
  loyalty_liability numeric,
  breakage_rate numeric,
  member_revenue numeric,
  rewards_redeemed_value numeric,
  reward_cost_rate numeric,
  member_customers integer,
  comparison_customers integer,
  member_visit_frequency numeric,
  comparison_visit_frequency numeric,
  member_frequency_uplift numeric,
  uplift_comparison text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  min_group constant integer := 10;
  v_scope uuid[] := app.identified_metric_scope(p_store_ids, p_from, p_to);
  v_total integer;
  v_identified integer;
  v_visits integer;
begin
  select
    count(*)::integer,
    (count(*) filter (where i.has_customer_identity))::integer
  into v_total, v_identified
  from public.invoices i
  where i.store_id = any (v_scope)
    and i.business_date between p_from and p_to
    and i.status in ('completed', 'edited');
  invoices := v_total;
  identified_invoices := v_identified;
  customer_capture_rate := case when v_total > 0 then round(v_identified::numeric / v_total, 4) end;

  with visits as (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope)
      and i.customer_id is not null
      and i.business_date between p_from and p_to
      and i.status <> 'voided'
  ),
  per_customer as (
    select customer_id, count(*) as days from visits group by customer_id
  )
  select count(*)::integer, (count(*) filter (where days >= 2))::integer
  into customers, repeat_customers
  from per_customer;
  repeat_rate := case when customers > 0 then round(repeat_customers::numeric / customers, 4) end;

  select count(distinct v.customer_id)::integer, count(*)::integer
  into active_customers_30d, v_visits
  from (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope) and i.customer_id is not null and i.status <> 'voided'
      and i.business_date between p_to - 29 and p_to
  ) v;
  visit_frequency_30d := case when active_customers_30d > 0 then round(v_visits::numeric / active_customers_30d, 4) end;

  select count(distinct v.customer_id)::integer, count(*)::integer
  into active_customers_90d, v_visits
  from (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope) and i.customer_id is not null and i.status <> 'voided'
      and i.business_date between p_to - 89 and p_to
  ) v;
  visit_frequency_90d := case when active_customers_90d > 0 then round(v_visits::numeric / active_customers_90d, 4) end;

  select
    case when count(p.id) = 0 then null else coalesce(sum(b.points), 0)::integer end,
    case when count(p.id) = 0 then null else round(coalesce(sum(b.points * p.point_value_amount * (1 - p.expected_breakage_rate)), 0), 2) end,
    case when coalesce(sum(b.matured), 0) > 0 then round(coalesce(sum(b.expired), 0)::numeric / sum(b.matured), 4) end,
    case when count(p.id) = 0 then null else round(coalesce(sum(b.redeemed_value), 0), 2) end
  into outstanding_points, loyalty_liability, breakage_rate, rewards_redeemed_value
  from public.loyalty_programmes p
  join public.tenants t on t.id = p.tenant_id
  left join lateral (
    select
      sum(l.point_delta) filter (
        where not (l.entry_kind = 'earn' and l.pending and not exists (select 1 from public.loyalty_ledger c where c.source_entry_id = l.id and c.entry_kind = 'confirm'))
      ) as points,
      sum(l.point_delta) filter (where l.entry_kind = 'earn' and l.expires_at is not null and l.expires_at < ((p_to + 1)::timestamp at time zone t.timezone)) as matured,
      - sum(l.point_delta) filter (where l.entry_kind = 'expire') as expired,
      - sum(l.value_amount) filter (
        where l.entry_kind = 'redeem'
          and l.occurred_at >= (p_from::timestamp at time zone t.timezone)
          and l.occurred_at < ((p_to + 1)::timestamp at time zone t.timezone)
          and (not l.pending or exists (select 1 from public.loyalty_ledger c where c.source_entry_id = l.id and c.entry_kind = 'confirm'))
      ) as redeemed_value
    from public.loyalty_ledger l
    where l.programme_id = p.id
      and l.occurred_at < ((p_to + 1)::timestamp at time zone t.timezone)
      and (l.store_id is null or l.store_id = any (v_scope))
  ) b on true
  where p.tenant_id in (select s.tenant_id from public.stores s where s.id = any (v_scope));

  select coalesce(sum(i.net_amount), 0) into member_revenue
  from public.invoices i
  where i.store_id = any (v_scope)
    and i.business_date between p_from and p_to
    and i.status <> 'voided'
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = i.tenant_id and m.customer_id = i.customer_id and m.joined_at < ((p_to + 1)::timestamp at time zone 'UTC')
    );
  reward_cost_rate := case
    when rewards_redeemed_value is not null and member_revenue > 0 then round(rewards_redeemed_value / member_revenue, 4)
  end;

  with visits as (
    select distinct i.customer_id, i.business_date, i.tenant_id
    from public.invoices i
    where i.store_id = any (v_scope)
      and i.customer_id is not null
      and i.business_date between p_from and p_to
      and i.status <> 'voided'
  ),
  grouped as (
    select
      v.customer_id,
      count(*) as days,
      exists (
        select 1 from public.memberships m
        where m.tenant_id = v.tenant_id and m.customer_id = v.customer_id and m.joined_at < ((p_from)::timestamp at time zone 'UTC')
      ) as member
    from visits v
    group by v.customer_id, v.tenant_id
  )
  select
    (count(*) filter (where member))::integer,
    (count(*) filter (where not member))::integer,
    round(avg(days) filter (where member), 4),
    round(avg(days) filter (where not member), 4)
  into member_customers, comparison_customers, member_visit_frequency, comparison_visit_frequency
  from grouped;
  uplift_comparison := 'identified_non_members';
  if member_customers >= min_group and comparison_customers >= min_group and comparison_visit_frequency > 0 then
    member_frequency_uplift := round(member_visit_frequency / comparison_visit_frequency - 1, 4);
  else
    member_frequency_uplift := null;
  end if;

  return next;
end;
$$;

comment on function public.member_share_by_shift(uuid[], date, date) is 'the phone-capture KPI of Ca & két tiền (#236, #237, FR-LOY-01): per store and shift of the range, the invoices neither voided nor refund documents, those with a customer_phone (member_invoices) and those with a customer_phone or a customer_id (identified_invoices), and both shares (null without an invoice). A shift belongs to the business date of its opening under the store''s day-start rule and is labelled by shift_ordinal, n of Ca {n}: its place by opening time, then external id, among the store''s shifts of that business date, as app.shift_number numbers it; a shift without invoices comes back with zeros. An invoice counts in the shift its shift_external_id names; an invoice naming no shift of its store counts in one row per store and business date of the invoice whose shift_ordinal, opened_at and closed_at are null (Không rõ ca). Rows come by business date, the order of store_ids, then shift_ordinal with that row last. The counts read the stored flags invoices.has_customer_phone and has_customer_identity, never the customer columns, and no column carries a phone, a customer id, a cashier name or the POS shift label. A report function: security invoker, 0 to 50 stores, at most 92 days and 900 rows (22023 otherwise); the caller''s revenue scope applies through the policies of invoices and shifts, so the publisher gets no row';
comment on function public.customer_metrics(uuid[], date, date) is 'the customer and loyalty metrics of docs/metrics.md over 1 to 50 stores and 1 to 366 business dates, as one row of aggregates read as the caller (42501 unless an owner, manager or viewer; 22023 for a bad store list or range): invoices (neither voided nor refund documents) and customer_capture_rate beside every customer figure; customers, repeat_customers and repeat_rate over customer-days of non-voided invoices with a customer_id; visit frequency (customer-days per active customer) over the 30 and 90 days ending on p_to; the loyalty liability (spendable outstanding points x point value x (1 - expected breakage)), the breakage rate (expired points over points of cohorts already past their expiry) and the reward cost rate (confirmed redeem value of the range over net revenue of member invoices) over the ledger rows of the requested stores and rows without a store; and the member frequency uplift against the identified non-members of the same stores, with the comparison group named in uplift_comparison and both sizes given, null below 10 customers in a group. A figure whose input is not measured is null, never 0. No phone, name or customer id leaves the function. customer_ltv needs costs and is not computed here';
comment on function app.evaluate_voucher_spikes(timestamptz, uuid, text) is 'voucher_spike: for a store''s business days today (so far) and yesterday, the invoices with a voucher (voucher amount or code; voided invoices and refund documents left out of every count) against the same weekday of the weeks before (days with sales only, at least min_sample_days): at least min_vouchers and either the count above ratio times the baseline''s mean count or the share above ratio times its mean share; one instant episode per store and day (store:<id>:<date>) to the owners and the store''s managers, with count-only facts (vouchers, invoices, share, baseline_vouchers, baseline_share, sample_days, ratio, over_count, over_share), never an amount or a voucher code; a day already raised is not raised again; returns the episodes opened';
comment on function app.evaluate_intraday_rules(timestamptz, uuid) is 'the intraday rules of the tick, only for tenants with an active or failing, enabled destination: zero_sales_open on store:<id>:<business date> for a store with known hours, open at p_at, watched by the incremental sync, whose account is neither paused nor auth_failed, after min_open_minutes of opening time today, with a successful sync within fresh_sync_minutes, no sale of the business date (an invoice completed or edited: a refund document is no sale), not an excluded day when skip_holidays, and checked history reaching min_history_days back; nightly_missing on tenant when a destination receives it, a succeeded nightly ran before and none finished in the last hours; an open episode of the key is left alone; returns the readings recorded';

drop function public.export_control_totals(uuid[], date, date);

create function public.export_control_totals(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  invoices bigint,
  voided_invoices bigint,
  refund_invoices bigint,
  sales_net_amount numeric,
  invoice_fingerprint text,
  lines bigint,
  line_net_amount numeric,
  line_fingerprint text,
  payments bigint,
  payment_amount numeric,
  payment_fingerprint text,
  shifts bigint,
  shift_sales_amount numeric,
  shift_fingerprint text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform app.require_store_ids('export_control_totals', export_control_totals.store_ids);
  perform app.require_date_range('export_control_totals', export_control_totals.from_date, export_control_totals.to_date, 92);
  return query
  select v.store_id,
         inv.invoice_count, inv.voided_count, inv.refund_count, inv.sales_net, inv.digest,
         ln.line_count, ln.line_net, ln.digest,
         py.payment_count, py.payment_total, py.digest,
         sh.shift_count, sh.shift_sales, sh.digest
  from app.visible_stores(export_control_totals.store_ids) v
  join public.stores st on st.id = v.store_id
  cross join lateral (
    select count(*) as invoice_count,
           count(*) filter (where i.status = 'voided') as voided_count,
           count(*) filter (where i.status = 'refund') as refund_count,
           coalesce(sum(i.net_amount) filter (where i.status <> 'voided'), 0) as sales_net,
           app.fingerprint(string_agg(
             concat_ws('|', i.id::text, i.status::text, app.minor_units(i.net_amount, 2), app.minor_units(i.gross_amount, 2), app.minor_units(i.paid_amount, 2), i.business_date::text),
             E'\n' order by i.id
           )) as digest
    from public.invoices i
    where i.store_id = v.store_id
      and i.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) inv
  cross join lateral (
    select count(*) as line_count,
           coalesce(sum(l.net_amount), 0) as line_net,
           app.fingerprint(string_agg(
             concat_ws('|', l.invoice_id::text, l.external_id, l.line_kind::text, app.minor_units(l.quantity, 3), app.minor_units(l.net_amount, 2)),
             E'\n' order by l.invoice_id, l.external_id collate "C"
           )) as digest
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    where i.store_id = v.store_id
      and i.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) ln
  cross join lateral (
    select count(*) as payment_count,
           coalesce(sum(p.amount), 0) as payment_total,
           app.fingerprint(string_agg(
             concat_ws('|', p.invoice_id::text, p.sequence_no::text, app.minor_units(p.amount, 2)),
             E'\n' order by p.invoice_id, p.sequence_no
           )) as digest
    from public.invoice_payments p
    where p.store_id = v.store_id
      and p.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) py
  cross join lateral (
    select count(*) as shift_count,
           coalesce(sum(s.sales_amount), 0) as shift_sales,
           app.fingerprint(string_agg(
             concat_ws('|', s.id::text, app.minor_units(s.sales_amount, 2), coalesce(app.minor_units(s.cash_variance_amount, 2), '')),
             E'\n' order by s.id
           )) as digest
    from public.shifts s
    where s.store_id = v.store_id
      and ((s.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date
          between export_control_totals.from_date and export_control_totals.to_date
  ) sh
  order by v.store_position;
end;
$$;

comment on function public.export_control_totals(uuid[], date, date) is 'per visible store over at most 92 days: counts, sums and SHA-256 fingerprints over canonical lines of invoices, invoice lines (by the invoice''s business date), payments (by their own business date) and shifts (by the business date of opened_at in the store''s zone after the day start), so an export proves it equals the tables; refund_invoices counts the refund documents of later-day native refunds (status refund, ADR-071), which the sums include and the daily summary does not count as invoices';

-- 5. Grants -------------------------------------------------------------------------------------------------------

revoke all on function app.refund_business_date(public.order_refunds) from public, anon, authenticated, service_role;
revoke all on function app.native_refund_documents(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.export_control_totals(uuid[], date, date) from public, anon;
grant execute on function public.export_control_totals(uuid[], date, date) to authenticated, service_role;
