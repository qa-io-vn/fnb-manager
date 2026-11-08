create or replace function app.sales_invoices(p_tenant uuid, p_from date, p_to date, p_store_ids uuid[] default null)
returns table (
  invoice_id uuid,
  tenant_id uuid,
  store_id uuid,
  pos_account_id uuid,
  business_date date,
  sold_at timestamptz,
  status public.invoice_status,
  shift_external_id text,
  customer_phone text,
  customer_id uuid,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  has_voucher boolean
)
language sql
stable
security invoker
rows 10000
set search_path = ''
as $$
  select
    i.id,
    i.tenant_id,
    i.store_id,
    i.pos_account_id,
    i.business_date,
    i.sold_at,
    i.status,
    i.shift_external_id,
    i.customer_phone,
    i.customer_id,
    i.gross_amount,
    i.item_discount_amount,
    i.bill_discount_amount + i.extra_discount_amount,
    i.voucher_amount,
    i.net_amount,
    i.paid_amount,
    i.voucher_amount > 0 or i.voucher_code is not null
  from public.invoices i
  where p_store_ids is not null
    and i.store_id = any (p_store_ids)
    and (p_tenant is null or i.tenant_id = p_tenant)
    and i.business_date between p_from and p_to
  union all
  select
    i.id,
    i.tenant_id,
    i.store_id,
    i.pos_account_id,
    i.business_date,
    i.sold_at,
    i.status,
    i.shift_external_id,
    i.customer_phone,
    i.customer_id,
    i.gross_amount,
    i.item_discount_amount,
    i.bill_discount_amount + i.extra_discount_amount,
    i.voucher_amount,
    i.net_amount,
    i.paid_amount,
    i.voucher_amount > 0 or i.voucher_code is not null
  from public.invoices i
  where p_store_ids is null
    and i.tenant_id = p_tenant
    and i.business_date between p_from and p_to
  union all
  select
    i.id,
    i.tenant_id,
    i.store_id,
    i.pos_account_id,
    i.business_date,
    i.sold_at,
    i.status,
    i.shift_external_id,
    i.customer_phone,
    i.customer_id,
    i.gross_amount,
    i.item_discount_amount,
    i.bill_discount_amount + i.extra_discount_amount,
    i.voucher_amount,
    i.net_amount,
    i.paid_amount,
    i.voucher_amount > 0 or i.voucher_code is not null
  from public.invoices i
  where p_store_ids is null
    and p_tenant is null
    and i.business_date between p_from and p_to;
$$;

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
    count(*)::integer,
    coalesce(sum(inv.net_amount), 0),
    coalesce(sum(lt.items_sold), 0)
  from inv
  left join line_totals lt on lt.invoice_id = inv.invoice_id
  group by inv.tenant_id, inv.store_id, inv.business_date, inv.hour_local;
$$;

revoke all on function app.sales_invoices(uuid, date, date, uuid[]) from public;
revoke all on function app.daily_sales_facts(uuid, date, date, uuid[]) from public;
revoke all on function app.hourly_sales_facts(uuid, date, date, uuid[]) from public;
grant execute on function app.sales_invoices(uuid, date, date, uuid[]) to authenticated, service_role;
grant execute on function app.daily_sales_facts(uuid, date, date, uuid[]) to authenticated, service_role;
grant execute on function app.hourly_sales_facts(uuid, date, date, uuid[]) to authenticated, service_role;

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
begin
  if p_tenant is null or p_from is null or p_to is null then
    raise exception 'refresh_analytics needs a tenant and a closed date range';
  end if;
  if p_from > p_to then
    raise exception 'refresh_analytics range starts % after it ends %', p_from, p_to;
  end if;

  perform pg_advisory_xact_lock(hashtext('refresh_analytics'), hashtext(p_tenant::text));

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
    coalesce(l.item_type_external_id, 'uncategorized'),
    max(l.item_type_name),
    coalesce((array_agg(r.role) filter (where r.role is not null))[1], 'other'),
    sum(l.quantity),
    sum(l.net_amount)
  from app.sales_invoices(p_tenant, p_from, p_to) inv
  join public.invoice_lines l on l.invoice_id = inv.invoice_id
  left join public.item_type_roles r
    on r.pos_account_id = inv.pos_account_id
    and r.item_type_external_id = l.item_type_external_id
  where inv.status <> 'voided'
    and l.line_kind = 'item'
  group by inv.tenant_id, inv.store_id, inv.business_date, coalesce(l.item_type_external_id, 'uncategorized');
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
    count(distinct p.invoice_id)::integer,
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
    left join public.item_type_roles r
      on r.pos_account_id = inv.pos_account_id
      and r.item_type_external_id = l.item_type_external_id
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

  update public.analytics_refreshes
  set finished_at = now(), rows = total_rows
  where id = refresh_id;

  return total_rows;
end;
$$;

revoke all on function app.refresh_analytics(uuid, date, date) from public;
grant execute on function app.refresh_analytics(uuid, date, date) to service_role;

create or replace function public.refresh_my_analytics(p_from date, p_to date, p_tenant uuid default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  manager_roles constant public.tenant_role[] := array['owner', 'manager']::public.tenant_role[];
  tenant uuid;
  total_rows bigint := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'refresh_my_analytics needs a closed date range';
  end if;
  if p_to - p_from + 1 > max_range_days then
    raise exception 'refresh_my_analytics refreshes at most % days per call', max_range_days;
  end if;

  if p_tenant is not null then
    if not app.has_tenant_role(p_tenant, manager_roles) then
      raise insufficient_privilege using message = 'refresh_my_analytics is limited to tenants where the caller is an owner or manager';
    end if;
    return app.refresh_analytics(p_tenant, p_from, p_to);
  end if;

  for tenant in
    select m.tenant_id
    from public.tenant_members m
    where m.user_id = (select auth.uid())
      and m.role = any (manager_roles)
    order by m.tenant_id
  loop
    total_rows := total_rows + app.refresh_analytics(tenant, p_from, p_to);
  end loop;

  if tenant is null then
    raise insufficient_privilege using message = 'refresh_my_analytics is limited to owners and managers';
  end if;

  return total_rows;
end;
$$;

revoke all on function public.refresh_my_analytics(date, date, uuid) from public, anon;
grant execute on function public.refresh_my_analytics(date, date, uuid) to authenticated, service_role;
