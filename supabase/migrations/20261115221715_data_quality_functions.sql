create function public.data_quality_items(store_ids uuid[], from_date date, to_date date)
returns table (
  item_external_id text,
  item_name text,
  pos_account_id uuid,
  pos_type_external_id text,
  pos_type_name text,
  override_type_external_id text,
  item_type_external_id text,
  item_type_name text,
  type_known boolean,
  role public.item_type_role,
  cost_known boolean,
  catalogue_modifier boolean,
  quantity numeric,
  net_amount numeric,
  net_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  visible_ids uuid[];
  returned_rows bigint;
begin
  perform app.require_store_ids('data_quality_items', data_quality_items.store_ids);
  perform app.require_date_range('data_quality_items', data_quality_items.from_date, data_quality_items.to_date, max_range_days);
  visible_ids := array(
    select v.store_id from app.visible_stores(data_quality_items.store_ids) v order by v.store_position
  );

  return query
  with sold as (
    select
      a.item_external_id as s_item,
      array_agg(distinct a.store_id) as s_stores,
      max(a.item_name) as s_name,
      max(a.item_type_external_id) as s_pos_type,
      max(a.item_type_name) as s_pos_type_name,
      sum(a.quantity) as s_quantity,
      sum(a.net_amount) as s_net
    from public.agg_item_daily a
    where a.store_id = any (visible_ids)
      and a.business_date between data_quality_items.from_date and data_quality_items.to_date
    group by a.item_external_id
  ),
  total as (
    select sum(s.s_net) as t_net from sold s
  ),
  effective as (
    select e.item_key as e_item, e.pos_account_id as e_account, e.item_type_external_id as e_type, e.item_type_name as e_type_name, e.role as e_role
    from app.effective_item_types(data_quality_items.store_ids, data_quality_items.from_date, data_quality_items.to_date) e
  ),
  costs as (
    select distinct c.item_external_id as c_item, c.for_store_id as c_store
    from app.item_cost_periods(data_quality_items.store_ids) c
    where c.valid_from <= data_quality_items.to_date
      and (c.valid_until is null or c.valid_until > data_quality_items.to_date)
  )
  select
    s.s_item,
    s.s_name,
    e.e_account,
    s.s_pos_type,
    s.s_pos_type_name,
    o.item_type_external_id,
    e.e_type,
    e.e_type_name,
    exists (
      select 1
      from public.item_types t
      where t.pos_account_id = e.e_account
        and t.external_id = e.e_type
    ),
    e.e_role,
    not exists (
      select 1
      from unnest(s.s_stores) as sold_at (store_id)
      where not exists (select 1 from costs c where c.c_item = s.s_item and c.c_store = sold_at.store_id)
    ),
    exists (
      select 1
      from public.items i
      where i.pos_account_id = e.e_account
        and i.external_id = s.s_item
        and i.is_modifier
    ),
    s.s_quantity,
    s.s_net,
    case when t.t_net is null or t.t_net = 0 then null else round(s.s_net / t.t_net, 6) end
  from sold s
  cross join total t
  left join effective e on e.e_item = s.s_item
  left join public.item_category_overrides o on o.pos_account_id = e.e_account and o.item_external_id = s.s_item
  order by s.s_net desc, s.s_item collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('data_quality_items', returned_rows);
end;
$$;

create function public.data_quality_payments(store_ids uuid[], from_date date, to_date date)
returns table (
  pos_account_id uuid,
  payment_method_external_id text,
  payment_method_name text,
  kind public.payment_kind,
  pos_kind public.payment_kind,
  override_kind public.payment_kind,
  in_catalogue boolean,
  invoices bigint,
  amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  returned_rows bigint;
begin
  perform app.require_store_ids('data_quality_payments', data_quality_payments.store_ids);
  perform app.require_date_range('data_quality_payments', data_quality_payments.from_date, data_quality_payments.to_date, max_range_days);

  return query
  with visible as (
    select s.id as v_store, s.pos_account_id as v_account
    from app.visible_stores(data_quality_payments.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  paid as (
    select
      vs.v_account as p_account,
      a.payment_method_external_id as p_method,
      max(a.payment_method_name) as p_name,
      max(a.kind::text)::public.payment_kind as p_kind,
      sum(a.invoices)::bigint as p_invoices,
      sum(a.amount) as p_amount
    from public.agg_payment_daily a
    join visible vs on vs.v_store = a.store_id
    where a.business_date between data_quality_payments.from_date and data_quality_payments.to_date
    group by vs.v_account, a.payment_method_external_id
  ),
  catalogue as (
    select m.pos_account_id as m_account, m.external_id as m_method, m.name as m_name, m.kind as m_kind, m.pos_kind as m_pos_kind
    from public.payment_methods m
    where m.pos_account_id in (select vs.v_account from visible vs)
  )
  select
    coalesce(c.m_account, p.p_account),
    coalesce(c.m_method, p.p_method),
    coalesce(c.m_name, p.p_name),
    coalesce(c.m_kind, p.p_kind, 'other'::public.payment_kind),
    c.m_pos_kind,
    o.kind,
    c.m_method is not null,
    p.p_invoices,
    p.p_amount
  from catalogue c
  full join paid p on p.p_account = c.m_account and p.p_method = c.m_method
  left join public.payment_kind_overrides o
    on o.pos_account_id = coalesce(c.m_account, p.p_account)
    and o.payment_method_external_id = coalesce(c.m_method, p.p_method)
  order by p.p_amount desc nulls last, coalesce(c.m_name, p.p_name) collate "C", coalesce(c.m_method, p.p_method) collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('data_quality_payments', returned_rows);
end;
$$;

create function public.data_quality_summary(store_ids uuid[], from_date date, to_date date)
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
      and i.status <> 'voided'
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

revoke all on function public.data_quality_items(uuid[], date, date) from public, anon;
revoke all on function public.data_quality_summary(uuid[], date, date) from public, anon;
revoke all on function public.data_quality_payments(uuid[], date, date) from public, anon;

grant execute on function public.data_quality_items(uuid[], date, date) to authenticated, service_role;
grant execute on function public.data_quality_summary(uuid[], date, date) to authenticated, service_role;
grant execute on function public.data_quality_payments(uuid[], date, date) to authenticated, service_role;
