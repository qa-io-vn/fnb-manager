create or replace function public.promotion_summary(store_ids uuid[], from_date date, to_date date)
returns table (
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  invoices bigint,
  lines bigint,
  discount_amount numeric,
  first_used_on date,
  last_used_on date,
  days_used integer
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
  perform app.require_store_ids('promotion_summary', promotion_summary.store_ids);
  perform app.require_date_range('promotion_summary', promotion_summary.from_date, promotion_summary.to_date, max_range_days);

  return query
  with sales as (
    select
      i.id as sale_id,
      i.business_date as sold_on,
      i.bill_discount_amount + i.extra_discount_amount as bill_amount,
      i.bill_discount_name as bill_name,
      i.voucher_amount as voucher_value,
      i.voucher_amount > 0 or i.voucher_code is not null as with_voucher,
      i.voucher_name as voucher_label,
      i.voucher_code as voucher_reference
    from public.invoices i
    where i.store_id = any (promotion_summary.store_ids)
      and i.business_date between promotion_summary.from_date and promotion_summary.to_date
      and i.status <> 'voided'
  ),
  uses as (
    select
      'item'::text as use_kind,
      l.line_key as use_key,
      l.line_name as use_name,
      s.sale_id,
      s.sold_on,
      l.line_count as use_lines,
      l.line_discount as use_discount
    from sales s
    cross join lateral (
      select
        coalesce(il.promotion_external_id, il.promotion_name, 'unnamed') as line_key,
        max(il.promotion_name) as line_name,
        count(*) as line_count,
        sum(il.discount_amount) as line_discount
      from public.invoice_lines il
      where il.invoice_id = s.sale_id
        and il.line_kind = 'item'
        and il.discount_amount > 0
      group by coalesce(il.promotion_external_id, il.promotion_name, 'unnamed')
    ) l
    union all
    select 'bill'::text, coalesce(s.bill_name, 'unnamed'), s.bill_name, s.sale_id, s.sold_on, null::bigint, s.bill_amount
    from sales s
    where s.bill_amount > 0
    union all
    select 'voucher'::text, coalesce(s.voucher_label, s.voucher_reference, 'unnamed'), s.voucher_label, s.sale_id, s.sold_on, null::bigint, s.voucher_value
    from sales s
    where s.with_voucher
  )
  select
    u.use_kind,
    u.use_key,
    max(u.use_name),
    count(distinct u.sale_id),
    sum(u.use_lines)::bigint,
    sum(u.use_discount),
    min(u.sold_on),
    max(u.sold_on),
    (count(distinct u.sold_on))::integer
  from uses u
  group by u.use_kind, u.use_key
  order by sum(u.use_discount) desc, u.use_kind collate "C", u.use_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('promotion_summary', returned_rows);
end;
$$;

create function app.discount_rows(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  business_date date,
  invoice_id uuid,
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  item_key text,
  discount_amount numeric,
  base_amount numeric,
  discount_rate numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sales as (
    select
      i.store_id as sale_store,
      i.business_date as sold_on,
      i.id as sale_id,
      i.gross_amount as sale_gross,
      i.item_discount_amount as sale_item_discount,
      i.bill_discount_amount + i.extra_discount_amount as sale_bill_discount,
      i.bill_discount_name as sale_bill_name,
      i.voucher_amount as sale_voucher,
      i.voucher_amount > 0 or i.voucher_code is not null as sale_with_voucher,
      i.voucher_name as sale_voucher_name,
      i.voucher_code as sale_voucher_code
    from public.invoices i
    where i.store_id = any (discount_rows.store_ids)
      and i.business_date between discount_rows.from_date and discount_rows.to_date
      and i.status <> 'voided'
  ),
  rows as (
    select
      s.sale_store, s.sold_on, s.sale_id, 'item'::text as row_kind,
      coalesce(l.promotion_external_id, l.promotion_name, 'unnamed') as row_key,
      l.promotion_name as row_name,
      coalesce(l.item_external_id, l.item_name) as row_item,
      l.discount_amount as row_discount,
      l.gross_amount as row_base
    from sales s
    cross join lateral (
      select il.promotion_external_id, il.promotion_name, il.item_external_id, il.item_name, il.discount_amount, il.gross_amount
      from public.invoice_lines il
      where il.invoice_id = s.sale_id
        and il.line_kind = 'item'
        and il.discount_amount > 0
    ) l
    union all
    select
      s.sale_store, s.sold_on, s.sale_id, 'bill', coalesce(s.sale_bill_name, 'unnamed'), s.sale_bill_name, null,
      s.sale_bill_discount, s.sale_gross - s.sale_item_discount
    from sales s
    where s.sale_bill_discount > 0
    union all
    select
      s.sale_store, s.sold_on, s.sale_id, 'voucher', coalesce(s.sale_voucher_name, s.sale_voucher_code, 'unnamed'), s.sale_voucher_name, null,
      s.sale_voucher, s.sale_gross - s.sale_item_discount - s.sale_bill_discount
    from sales s
    where s.sale_with_voucher
  )
  select
    r.sale_store,
    r.sold_on,
    r.sale_id,
    r.row_kind,
    r.row_key,
    coalesce(r.row_name, r.row_key),
    r.row_item,
    r.row_discount,
    r.row_base,
    case when r.row_base = 0 then null else round(r.row_discount / r.row_base, 6) end
  from rows r;
$$;

create function public.promotion_days(
  store_ids uuid[],
  from_date date,
  to_date date,
  kind_filter text default null,
  key_filter text default null
)
returns table (
  store_id uuid,
  business_date date,
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  invoices bigint,
  lines bigint,
  discount_amount numeric
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
  perform app.require_store_ids('promotion_days', promotion_days.store_ids);
  perform app.require_date_range('promotion_days', promotion_days.from_date, promotion_days.to_date, max_range_days);
  if promotion_days.kind_filter is not null and promotion_days.kind_filter not in ('item', 'bill', 'voucher') then
    raise exception using
      errcode = '22023',
      message = format('promotion_days needs kind_filter item, bill or voucher, not %s', promotion_days.kind_filter);
  end if;
  if promotion_days.key_filter is not null and promotion_days.kind_filter is null then
    raise exception using
      errcode = '22023',
      message = 'promotion_days needs a kind_filter with a key_filter';
  end if;

  return query
  with visible as (
    select v.store_id as visible_store, v.store_position as visible_position
    from app.visible_stores(promotion_days.store_ids) v
  ),
  uses as (
    select d.*
    from app.discount_rows(
      array(select visible_store from visible),
      promotion_days.from_date,
      promotion_days.to_date
    ) d
    where (promotion_days.kind_filter is null or d.promotion_kind = promotion_days.kind_filter)
      and (promotion_days.key_filter is null or d.promotion_key = promotion_days.key_filter)
  )
  select
    u.store_id,
    u.business_date,
    u.promotion_kind,
    u.promotion_key,
    coalesce(max(u.promotion_name) filter (where u.promotion_name is distinct from u.promotion_key), max(u.promotion_name)),
    count(distinct u.invoice_id),
    case when u.promotion_kind = 'item' then count(*) end,
    sum(u.discount_amount)
  from uses u
  join visible v on v.visible_store = u.store_id
  group by u.store_id, v.visible_position, u.business_date, u.promotion_kind, u.promotion_key
  order by u.business_date, v.visible_position, u.promotion_kind collate "C", u.promotion_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('promotion_days', returned_rows);
end;
$$;

create function public.promotion_catalogue(store_ids uuid[], as_of_date date)
returns table (
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  in_catalogue boolean,
  catalogue_active boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  first_used_on date,
  last_used_on date,
  days_used_365 integer,
  invoices_365 bigint,
  discount_365 numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  returned_rows bigint;
  first_sale date;
begin
  perform app.require_store_ids('promotion_catalogue', promotion_catalogue.store_ids);
  if promotion_catalogue.as_of_date is null then
    raise exception using
      errcode = '22023',
      message = 'promotion_catalogue needs an as_of_date';
  end if;

  select min(i.business_date) into first_sale
  from public.invoices i
  where i.store_id in (select v.store_id from app.visible_stores(promotion_catalogue.store_ids) v);

  return query
  with visible as (
    select v.store_id as visible_store
    from app.visible_stores(promotion_catalogue.store_ids) v
  ),
  uses as (
    select d.*
    from app.discount_rows(
      array(select visible_store from visible),
      coalesce(first_sale, promotion_catalogue.as_of_date),
      promotion_catalogue.as_of_date
    ) d
  ),
  used as (
    select
      u.promotion_kind as used_kind,
      u.promotion_key as used_key,
      coalesce(max(u.promotion_name) filter (where u.promotion_name is distinct from u.promotion_key), max(u.promotion_name)) as used_name,
      min(u.business_date) as used_first,
      max(u.business_date) as used_last,
      (count(distinct u.business_date) filter (where u.business_date > promotion_catalogue.as_of_date - 365))::integer as used_days,
      count(distinct u.invoice_id) filter (where u.business_date > promotion_catalogue.as_of_date - 365) as used_invoices,
      sum(u.discount_amount) filter (where u.business_date > promotion_catalogue.as_of_date - 365) as used_discount
    from uses u
    group by u.promotion_kind, u.promotion_key
  ),
  catalogue as (
    select
      'item'::text as listed_kind,
      p.external_id as listed_key,
      max(p.name) as listed_name,
      bool_or(p.active) as listed_active,
      min(p.starts_at) as listed_starts,
      max(p.ends_at) as listed_ends
    from public.promotions p
    where p.pos_account_id in (
      select s.pos_account_id
      from public.stores s
      join visible v on v.visible_store = s.id
    )
    group by p.external_id
  ),
  merged as (
    select
      coalesce(c.listed_kind, u.used_kind) as merged_kind,
      coalesce(c.listed_key, u.used_key) as merged_key,
      coalesce(c.listed_name, u.used_name, c.listed_key, u.used_key) as merged_name,
      c.listed_key is not null as merged_listed,
      c.listed_active as merged_active,
      c.listed_starts as merged_starts,
      c.listed_ends as merged_ends,
      u.used_first as merged_first,
      u.used_last as merged_last,
      coalesce(u.used_days, 0) as merged_days,
      coalesce(u.used_invoices, 0) as merged_invoices,
      coalesce(u.used_discount, 0) as merged_discount
    from catalogue c
    full join used u on u.used_kind = c.listed_kind and u.used_key = c.listed_key
  )
  select
    m.merged_kind,
    m.merged_key,
    m.merged_name,
    m.merged_listed,
    m.merged_active,
    m.merged_starts,
    m.merged_ends,
    m.merged_first,
    m.merged_last,
    m.merged_days,
    m.merged_invoices,
    m.merged_discount
  from merged m
  order by m.merged_last desc nulls last, m.merged_kind collate "C", m.merged_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('promotion_catalogue', returned_rows);
end;
$$;

create function public.promotion_lift(
  store_ids uuid[],
  promotion_kind text,
  promotion_key text,
  from_date date,
  to_date date,
  comparator text,
  pre_weeks integer default null
)
returns table (
  business_date date,
  promo_day boolean,
  control_day boolean,
  test_gross_amount numeric,
  test_net_amount numeric,
  test_invoices bigint,
  discount_amount numeric,
  reference_gross_amount numeric,
  reference_days integer,
  counterfactual_gross_amount numeric,
  gross_lift_amount numeric,
  test_store_count integer,
  control_store_count integer,
  promo_days integer,
  measured_days integer,
  control_days integer,
  trend_adjustment_amount numeric,
  net_lift_amount numeric,
  lift_rate numeric,
  flags text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  usage_lookback_days constant integer := 56;
  baseline_weeks constant integer := 8;
  min_baseline_dates constant integer := 3;
  min_weekday_dates constant integer := 2;
  min_control_days constant integer := 7;
  weeks integer;
  visible_ids uuid[];
  test_ids uuid[];
  control_ids uuid[];
  used_ids uuid[];
  first_promo date;
begin
  perform app.require_store_ids('promotion_lift', promotion_lift.store_ids);
  perform app.require_date_range('promotion_lift', promotion_lift.from_date, promotion_lift.to_date, max_range_days);
  if promotion_lift.promotion_kind is null or promotion_lift.promotion_kind not in ('item', 'bill', 'voucher') then
    raise exception using
      errcode = '22023',
      message = 'promotion_lift needs promotion_kind item, bill or voucher';
  end if;
  if promotion_lift.promotion_key is null then
    raise exception using
      errcode = '22023',
      message = 'promotion_lift needs a promotion_key';
  end if;
  if promotion_lift.comparator is null or promotion_lift.comparator not in ('baseline', 'prior_weeks', 'sister_store') then
    raise exception using
      errcode = '22023',
      message = 'promotion_lift needs comparator baseline, prior_weeks or sister_store';
  end if;
  if promotion_lift.pre_weeks is not null and promotion_lift.pre_weeks not between 2 and 8 then
    raise exception using
      errcode = '22023',
      message = 'promotion_lift needs pre_weeks from 2 to 8';
  end if;

  if cardinality(promotion_lift.store_ids) = 0 then
    return;
  end if;

  visible_ids := array(
    select v.store_id
    from app.visible_stores(promotion_lift.store_ids) v
    order by v.store_position
  );
  weeks := coalesce(
    promotion_lift.pre_weeks,
    (select s.promo_pre_weeks from app.store_report_settings(visible_ids) s limit 1),
    4
  );

  select
    coalesce(array_agg(distinct d.store_id) filter (where d.business_date between promotion_lift.from_date and promotion_lift.to_date), '{}'::uuid[]),
    coalesce(array_agg(distinct d.store_id) filter (where d.business_date >= promotion_lift.from_date - 7 * weeks), '{}'::uuid[]),
    min(d.business_date) filter (where d.business_date between promotion_lift.from_date and promotion_lift.to_date)
  into test_ids, used_ids, first_promo
  from app.discount_rows(visible_ids, promotion_lift.from_date - usage_lookback_days, promotion_lift.to_date) d
  where d.promotion_kind = promotion_lift.promotion_kind
    and d.promotion_key = promotion_lift.promotion_key;

  control_ids := array(
    select v.store_id
    from unnest(visible_ids) with ordinality as v (store_id, store_position)
    where v.store_id <> all (used_ids)
    order by v.store_position
  );

  return query
  with discounts as materialized (
    select d.store_id as d_store, d.business_date as d_on, d.promotion_kind as d_kind, d.promotion_key as d_key, d.discount_amount as d_amount
    from app.discount_rows(test_ids, promotion_lift.from_date - usage_lookback_days, promotion_lift.to_date) d
  ),
  usage as (
    select x.d_on as u_on, sum(x.d_amount) as u_discount
    from discounts x
    where x.d_kind = promotion_lift.promotion_kind
      and x.d_key = promotion_lift.promotion_key
    group by x.d_on
  ),
  daily as materialized (
    select ds.store_id as s_store, ds.business_date as s_on, ds.gross_amount as s_gross, ds.net_amount as s_net, ds.invoices as s_invoices
    from app.daily_sales(visible_ids, promotion_lift.from_date - usage_lookback_days, promotion_lift.to_date) ds
  ),
  test_series as (
    select y.s_on as t_on, sum(y.s_gross) as t_gross, sum(y.s_net) as t_net, sum(y.s_invoices)::bigint as t_invoices
    from daily y
    where y.s_store = any (test_ids)
    group by y.s_on
  ),
  control_series as (
    select y.s_on as c_on, sum(y.s_gross) as c_gross
    from daily y
    where y.s_store = any (control_ids)
    group by y.s_on
  ),
  calendar as materialized (
    select g::date as cal_on, app.is_excluded_day(test_ids, g::date) as cal_excluded
    from generate_series(promotion_lift.from_date - usage_lookback_days, promotion_lift.to_date, interval '1 day') g
  ),
  window_days as (
    select c.cal_on as w_on, c.cal_excluded as w_excluded, u.u_on is not null as w_promo, u.u_discount as w_discount
    from calendar c
    left join usage u on u.u_on = c.cal_on
    where c.cal_on between promotion_lift.from_date and promotion_lift.to_date
  ),
  baseline_refs as (
    select
      w.w_on as r_on,
      count(ts.t_gross)::integer as r_dates,
      case
        when count(ts.t_gross) >= min_baseline_dates
          then round((percentile_cont(0.5) within group (order by ts.t_gross::double precision))::numeric, 2)
      end as r_reference
    from window_days w
    cross join generate_series(1, baseline_weeks) k
    join calendar c on c.cal_on = w.w_on - 7 * k
    join test_series ts on ts.t_on = c.cal_on
    where not c.cal_excluded
      and not exists (select 1 from usage u where u.u_on = c.cal_on)
    group by w.w_on
  ),
  pre_period as (
    select c.cal_on as p_on, ts.t_gross as p_test, cs.c_gross as p_control
    from calendar c
    join test_series ts on ts.t_on = c.cal_on
    left join control_series cs on cs.c_on = c.cal_on
    where first_promo is not null
      and c.cal_on between first_promo - 7 * weeks and first_promo - 1
      and not c.cal_excluded
      and not exists (select 1 from usage u where u.u_on = c.cal_on)
      and (promotion_lift.comparator <> 'sister_store' or cs.c_gross is not null)
  ),
  pre_weekdays as (
    select
      extract(isodow from p.p_on)::integer as pw_weekday,
      count(*)::integer as pw_dates,
      avg(p.p_test) as pw_test,
      avg(p.p_control) as pw_control
    from pre_period p
    group by extract(isodow from p.p_on)
  ),
  referenced as (
    select
      w.w_on, w.w_excluded, w.w_promo, w.w_discount,
      ts.t_gross, ts.t_net, ts.t_invoices,
      cs.c_gross,
      case promotion_lift.comparator
        when 'baseline' then br.r_reference
        else case when coalesce(pw.pw_dates, 0) >= min_weekday_dates then round(pw.pw_test, 2) end
      end as ref_amount,
      case promotion_lift.comparator
        when 'baseline' then coalesce(br.r_dates, 0)
        else coalesce(pw.pw_dates, 0)
      end as ref_dates,
      pw.pw_dates, pw.pw_test, pw.pw_control
    from window_days w
    left join test_series ts on ts.t_on = w.w_on
    left join control_series cs on cs.c_on = w.w_on
    left join baseline_refs br on br.r_on = w.w_on
    left join pre_weekdays pw on pw.pw_weekday = extract(isodow from w.w_on)::integer
  ),
  marked as (
    select
      r.*,
      promotion_lift.comparator <> 'sister_store'
        and not r.w_promo
        and not r.w_excluded
        and r.t_gross is not null
        and r.ref_amount is not null
        and (promotion_lift.comparator <> 'prior_weeks' or (first_promo is not null and r.w_on >= first_promo)) as is_control
    from referenced r
  ),
  trend as (
    select count(*) filter (where m.is_control)::integer as n_control,
           avg(m.t_gross - m.ref_amount) filter (where m.is_control) as adjustment
    from marked m
  ),
  counterfactual as (
    select
      m.*,
      case
        when not m.w_promo then null
        when promotion_lift.comparator = 'sister_store' then
          case when coalesce(m.pw_dates, 0) >= min_weekday_dates and m.c_gross is not null
            then round(m.pw_test + (m.c_gross - m.pw_control), 2)
          end
        when t.n_control >= min_control_days and m.ref_amount is not null then round(m.ref_amount + t.adjustment, 2)
      end as cf_amount
    from marked m
    cross join trend t
  ),
  lifted as (
    select
      c.*,
      case when c.w_promo and c.cf_amount is not null and c.t_gross is not null then c.t_gross - c.cf_amount end as lift_amount
    from counterfactual c
  ),
  summary as (
    select
      count(*) filter (where l.w_promo)::integer as s_promo,
      count(*) filter (where l.w_promo and l.cf_amount is not null)::integer as s_measured,
      count(*) filter (where l.is_control)::integer as s_control,
      sum(l.lift_amount) filter (where l.w_promo and l.cf_amount is not null) as s_lift,
      sum(l.w_discount) filter (where l.w_promo and l.cf_amount is not null) as s_discount,
      sum(l.cf_amount) filter (where l.w_promo and l.cf_amount is not null) as s_cf,
      bool_or(l.w_promo and l.ref_amount is null) as s_unreferenced,
      bool_or(l.w_promo and l.w_excluded) as s_excluded
    from lifted l
  ),
  size_ratio as (
    select case when avg(p.p_test) > 0 then avg(p.p_control) / avg(p.p_test) end as ratio
    from pre_period p
  ),
  other_promotions as (
    select exists (
      select 1
      from discounts x
      join usage u on u.u_on = x.d_on
      where x.d_on between promotion_lift.from_date and promotion_lift.to_date
        and (x.d_kind, x.d_key) is distinct from (promotion_lift.promotion_kind, promotion_lift.promotion_key)
    ) as found
  )
  select
    l.w_on,
    l.w_promo,
    l.is_control,
    l.t_gross,
    l.t_net,
    l.t_invoices,
    l.w_discount,
    l.ref_amount,
    l.ref_dates,
    l.cf_amount,
    l.lift_amount,
    null::integer,
    null::integer,
    null::integer,
    null::integer,
    null::integer,
    null::numeric,
    null::numeric,
    null::numeric,
    null::text[]
  from lifted l
  union all
  select
    null::date,
    null::boolean,
    null::boolean,
    null::numeric,
    null::numeric,
    null::bigint,
    s.s_discount,
    null::numeric,
    null::integer,
    null::numeric,
    s.s_lift,
    cardinality(test_ids),
    cardinality(control_ids),
    s.s_promo,
    s.s_measured,
    case when promotion_lift.comparator = 'sister_store' then null else s.s_control end,
    case
      when promotion_lift.comparator <> 'sister_store' and s.s_measured > 0 then round(t.adjustment, 2)
    end,
    s.s_lift - s.s_discount,
    case when s.s_cf is not null and s.s_cf <> 0 then round(s.s_lift / s.s_cf, 6) end,
    array_remove(array[
      case when cardinality(test_ids) = 0 then 'no_test_store' end,
      case when s.s_promo < 3 then 'few_promo_days' end,
      case when promotion_lift.comparator <> 'sister_store' and t.n_control < min_control_days then 'few_control_days' end,
      case when coalesce(s.s_unreferenced, false) then 'few_reference_days' end,
      case when s.s_measured < s.s_promo then 'unmeasured_days' end,
      case when promotion_lift.comparator = 'sister_store' and cardinality(control_ids) = 0 then 'no_control_store' end,
      case when promotion_lift.comparator = 'sister_store' and z.ratio is not null and (z.ratio < 0.5 or z.ratio > 2) then 'control_differs_in_size' end,
      case when coalesce(s.s_excluded, false) then 'excluded_days_in_window' end,
      case when o.found then 'other_promotions' end
    ], null)
  from summary s
  cross join trend t
  cross join size_ratio z
  cross join other_promotions o
  order by 1 nulls last;
end;
$$;

create function public.promotion_compliance(store_ids uuid[], from_date date, to_date date, cap_rate numeric default 0.5)
returns table (
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  checked_rows bigint,
  max_partial_rate numeric,
  over_cap_rows bigint,
  over_cap_discount_amount numeric,
  first_over_cap_on date,
  last_over_cap_on date,
  full_discount_rows bigint,
  full_discount_amount numeric,
  first_full_discount_on date,
  last_full_discount_on date
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
  perform app.require_store_ids('promotion_compliance', promotion_compliance.store_ids);
  perform app.require_date_range('promotion_compliance', promotion_compliance.from_date, promotion_compliance.to_date, max_range_days);
  if promotion_compliance.cap_rate is null or promotion_compliance.cap_rate <= 0 or promotion_compliance.cap_rate > 1 then
    raise exception using
      errcode = '22023',
      message = 'promotion_compliance needs a cap_rate above 0 and at most 1';
  end if;

  if cardinality(promotion_compliance.store_ids) = 0 then
    return;
  end if;

  return query
  with discounts as materialized (
    select
      d.*,
      d.discount_amount >= d.base_amount as is_full
    from app.discount_rows(
      array(select v.store_id from app.visible_stores(promotion_compliance.store_ids) v),
      promotion_compliance.from_date,
      promotion_compliance.to_date
    ) d
  ),
  by_promotion as (
    select
      x.promotion_kind as c_kind,
      x.promotion_key as c_key,
      coalesce(max(x.promotion_name) filter (where x.promotion_name is distinct from x.promotion_key), max(x.promotion_name)) as c_name,
      count(*) as c_checked,
      max(x.discount_rate) filter (where not x.is_full) as c_max_partial,
      count(*) filter (where not x.is_full and x.discount_rate > promotion_compliance.cap_rate) as c_over_rows,
      coalesce(sum(x.discount_amount) filter (where not x.is_full and x.discount_rate > promotion_compliance.cap_rate), 0) as c_over_amount,
      min(x.business_date) filter (where not x.is_full and x.discount_rate > promotion_compliance.cap_rate) as c_over_first,
      max(x.business_date) filter (where not x.is_full and x.discount_rate > promotion_compliance.cap_rate) as c_over_last,
      count(*) filter (where x.is_full) as c_full_rows,
      coalesce(sum(x.discount_amount) filter (where x.is_full), 0) as c_full_amount,
      min(x.business_date) filter (where x.is_full) as c_full_first,
      max(x.business_date) filter (where x.is_full) as c_full_last
    from discounts x
    group by x.promotion_kind, x.promotion_key
  ),
  per_invoice as (
    select
      x.invoice_id as i_id,
      min(x.business_date) as i_on,
      sum(x.discount_amount) filter (where not (x.promotion_kind = 'item' and x.is_full)) as i_partial,
      i.gross_amount - coalesce(sum(x.base_amount) filter (where x.promotion_kind = 'item' and x.is_full), 0) as i_base
    from discounts x
    join public.invoices i on i.id = x.invoice_id
    group by x.invoice_id, i.gross_amount
  ),
  invoice_rates as (
    select p.i_on, coalesce(p.i_partial, 0) as i_partial, round(coalesce(p.i_partial, 0) / p.i_base, 6) as i_rate
    from per_invoice p
    where p.i_base > 0
  ),
  invoice_total as (
    select
      'invoice_total'::text as c_kind,
      'all'::text as c_key,
      null::text as c_name,
      count(*) as c_checked,
      max(r.i_rate) filter (where r.i_rate < 1) as c_max_partial,
      count(*) filter (where r.i_rate > promotion_compliance.cap_rate and r.i_rate < 1) as c_over_rows,
      coalesce(sum(r.i_partial) filter (where r.i_rate > promotion_compliance.cap_rate and r.i_rate < 1), 0) as c_over_amount,
      min(r.i_on) filter (where r.i_rate > promotion_compliance.cap_rate and r.i_rate < 1) as c_over_first,
      max(r.i_on) filter (where r.i_rate > promotion_compliance.cap_rate and r.i_rate < 1) as c_over_last,
      count(*) filter (where r.i_rate >= 1) as c_full_rows,
      coalesce(sum(r.i_partial) filter (where r.i_rate >= 1), 0) as c_full_amount,
      min(r.i_on) filter (where r.i_rate >= 1) as c_full_first,
      max(r.i_on) filter (where r.i_rate >= 1) as c_full_last
    from invoice_rates r
    having count(*) > 0
  ),
  combined as (
    select b.*, 0 as c_last from by_promotion b
    union all
    select t.*, 1 from invoice_total t
  )
  select
    c.c_kind, c.c_key, c.c_name, c.c_checked, c.c_max_partial, c.c_over_rows, c.c_over_amount,
    c.c_over_first, c.c_over_last, c.c_full_rows, c.c_full_amount, c.c_full_first, c.c_full_last
  from combined c
  order by c.c_last, c.c_over_rows desc, c.c_kind collate "C", c.c_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('promotion_compliance', returned_rows);
end;
$$;

create function public.item_discount_days(store_ids uuid[], calendar_year integer, as_of_date date default null)
returns table (
  item_external_id text,
  item_name text,
  price_discount_days integer,
  line_price_discount_days integer,
  bill_discount_days integer,
  gift_days integer,
  voucher_days integer,
  first_price_discount_on date,
  last_price_discount_on date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  first_year constant integer := 2023;
  visible_ids uuid[];
  window_from date;
  window_to date;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_discount_days', item_discount_days.store_ids);
  if item_discount_days.calendar_year is null
    or item_discount_days.calendar_year < first_year
    or item_discount_days.calendar_year > coalesce(
      (
        select max(extract(year from (now() at time zone s.timezone)))::integer
        from public.stores s
        where s.id = any (item_discount_days.store_ids)
      ),
      extract(year from current_date)::integer
    ) then
    raise exception using
      errcode = '22023',
      message = format('item_discount_days needs a calendar_year from %s to the current year', first_year);
  end if;

  visible_ids := array(select v.store_id from app.visible_stores(item_discount_days.store_ids) v);
  window_from := make_date(item_discount_days.calendar_year, 1, 1);
  window_to := least(
    make_date(item_discount_days.calendar_year, 12, 31),
    coalesce(item_discount_days.as_of_date, app.analytics_as_of(visible_ids))
  );

  return query
  with discounts as materialized (
    select d.*, d.discount_amount >= d.base_amount as is_full
    from app.discount_rows(visible_ids, window_from, window_to) d
    where window_from <= window_to
  ),
  item_days as (
    select x.item_key as k_item, x.business_date as k_on,
           case when x.is_full then 'gift' else 'line' end as k_kind
    from discounts x
    where x.promotion_kind = 'item'
    union
    select coalesce(il.item_external_id, il.item_name), x.business_date,
           case when x.promotion_kind = 'bill' then 'bill' else 'voucher' end
    from discounts x
    join public.invoice_lines il on il.invoice_id = x.invoice_id and il.line_kind = 'item'
    where (x.promotion_kind = 'bill' and not x.is_full)
       or x.promotion_kind = 'voucher'
  ),
  names as (
    select coalesce(il.item_external_id, il.item_name) as n_item, max(il.item_name) as n_name
    from (select distinct x.invoice_id from discounts x) x
    join public.invoice_lines il on il.invoice_id = x.invoice_id and il.line_kind = 'item'
    group by coalesce(il.item_external_id, il.item_name)
  )
  select
    d.k_item,
    n.n_name,
    (count(distinct d.k_on) filter (where d.k_kind in ('line', 'bill')))::integer,
    (count(distinct d.k_on) filter (where d.k_kind = 'line'))::integer,
    (count(distinct d.k_on) filter (where d.k_kind = 'bill'))::integer,
    (count(distinct d.k_on) filter (where d.k_kind = 'gift'))::integer,
    (count(distinct d.k_on) filter (where d.k_kind = 'voucher'))::integer,
    min(d.k_on) filter (where d.k_kind in ('line', 'bill')),
    max(d.k_on) filter (where d.k_kind in ('line', 'bill'))
  from item_days d
  left join names n on n.n_item = d.k_item
  group by d.k_item, n.n_name
  order by 3 desc, 6 desc, d.k_item collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_discount_days', returned_rows);
end;
$$;

create function public.shift_adjustments(store_ids uuid[], from_date date, to_date date, z_threshold numeric default null)
returns table (
  store_id uuid,
  shift_id uuid,
  shift_external_id text,
  shift_name text,
  business_date date,
  cashier_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  orders bigint,
  item_lines bigint,
  voids integer,
  void_amount numeric,
  edits integer,
  removed_lines integer,
  removed_amount numeric,
  edits_after_close integer,
  changed_after_close boolean,
  void_rate numeric,
  removed_line_rate numeric,
  trailing_shifts integer,
  void_z_score numeric,
  removed_z_score numeric,
  flagged boolean,
  reasons text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  trailing_days constant integer := 56;
  min_trailing_shifts constant integer := 3;
  threshold numeric;
  returned_rows bigint;
begin
  perform app.require_store_ids('shift_adjustments', shift_adjustments.store_ids);
  perform app.require_date_range('shift_adjustments', shift_adjustments.from_date, shift_adjustments.to_date, max_range_days);
  if shift_adjustments.z_threshold is not null and shift_adjustments.z_threshold <= 0 then
    raise exception using
      errcode = '22023',
      message = 'shift_adjustments needs a z_threshold above 0';
  end if;
  select count(*) into returned_rows
  from public.agg_shift_cash a
  where a.store_id in (select v.store_id from app.visible_stores(shift_adjustments.store_ids) v)
    and a.business_date between shift_adjustments.from_date and shift_adjustments.to_date;
  perform app.require_report_rows('shift_adjustments', returned_rows);

  threshold := coalesce(
    shift_adjustments.z_threshold,
    (
      select s.z_threshold
      from app.store_report_settings(array(select v.store_id from app.visible_stores(shift_adjustments.store_ids) v)) s
      limit 1
    ),
    2
  );

  return query
  with visible as (
    select v.store_id as visible_store, v.store_position as visible_position
    from app.visible_stores(shift_adjustments.store_ids) v
  ),
  shift_set as materialized (
    select
      a.store_id as sh_store,
      a.shift_id as sh_id,
      a.shift_external_id as sh_external,
      a.business_date as sh_on,
      a.cashier_name as sh_cashier,
      a.opened_at as sh_opened,
      a.closed_at as sh_closed,
      a.opened_at as sh_window_from,
      coalesce(a.closed_at, a.opened_at + interval '1 day') as sh_window_to
    from public.agg_shift_cash a
    join visible v on v.visible_store = a.store_id
    where a.business_date between shift_adjustments.from_date - trailing_days and shift_adjustments.to_date
  ),
  shift_invoices as materialized (
    select sh.sh_id as si_shift, i.id as si_invoice, i.status as si_status
    from shift_set sh
    join public.invoices i on i.store_id = sh.sh_store and i.shift_external_id = sh.sh_external
  ),
  sales as (
    select
      si.si_shift as sa_shift,
      count(*) filter (where si.si_status <> 'voided') as sa_orders,
      coalesce(sum(l.line_count) filter (where si.si_status <> 'voided'), 0)::bigint as sa_lines
    from shift_invoices si
    cross join lateral (
      select count(*) as line_count
      from public.invoice_lines il
      where il.invoice_id = si.si_invoice
        and il.line_kind = 'item'
    ) l
    group by si.si_shift
  ),
  by_invoice as (
    select si.si_shift as ev_shift, e.kind as ev_kind, e.amount as ev_amount, e.occurred_at as ev_at
    from shift_invoices si
    join public.invoice_events e on e.invoice_id = si.si_invoice
  ),
  by_time as (
    select w.sh_id as ev_shift, e.kind as ev_kind, e.amount as ev_amount, e.occurred_at as ev_at
    from public.invoice_events e
    join visible v on v.visible_store = e.store_id
    left join public.invoices i on i.id = e.invoice_id
    cross join lateral (
      select sh.sh_id
      from shift_set sh
      where sh.sh_store = e.store_id
        and e.occurred_at >= sh.sh_window_from
        and e.occurred_at < sh.sh_window_to
      order by sh.sh_opened desc
      limit 1
    ) w
    where e.occurred_at >= (select min(sh.sh_window_from) from shift_set sh)
      and e.occurred_at < (select max(sh.sh_window_to) from shift_set sh)
      and (i.id is null or i.shift_external_id is null)
  ),
  events as (
    select * from by_invoice
    union all
    select * from by_time
  ),
  adjustments as (
    select
      ev.ev_shift as ad_shift,
      (count(*) filter (where ev.ev_kind = 'voided'))::integer as ad_voids,
      sum(ev.ev_amount) filter (where ev.ev_kind = 'voided') as ad_void_amount,
      (count(*) filter (where ev.ev_kind = 'edited'))::integer as ad_edits,
      (count(*) filter (where ev.ev_kind = 'line_removed'))::integer as ad_removed,
      sum(ev.ev_amount) filter (where ev.ev_kind = 'line_removed') as ad_removed_amount
    from events ev
    group by ev.ev_shift
  ),
  after_close as (
    select bi.ev_shift as ac_shift, count(*)::integer as ac_edits
    from by_invoice bi
    join shift_set sh on sh.sh_id = bi.ev_shift
    where sh.sh_closed is not null
      and bi.ev_at >= sh.sh_closed
    group by bi.ev_shift
  ),
  measured as (
    select
      sh.*,
      coalesce(sa.sa_orders, 0) as m_orders,
      coalesce(sa.sa_lines, 0) as m_lines,
      coalesce(ad.ad_voids, 0) as m_voids,
      ad.ad_void_amount as m_void_amount,
      coalesce(ad.ad_edits, 0) as m_edits,
      coalesce(ad.ad_removed, 0) as m_removed,
      ad.ad_removed_amount as m_removed_amount,
      coalesce(ac.ac_edits, 0) as m_after_close,
      case when coalesce(sa.sa_orders, 0) + coalesce(ad.ad_voids, 0) > 0
        then coalesce(ad.ad_voids, 0)::numeric / (coalesce(sa.sa_orders, 0) + coalesce(ad.ad_voids, 0))
      end as m_void_rate,
      case when coalesce(sa.sa_lines, 0) > 0
        then coalesce(ad.ad_removed, 0)::numeric / sa.sa_lines
      end as m_removed_rate
    from shift_set sh
    left join sales sa on sa.sa_shift = sh.sh_id
    left join adjustments ad on ad.ad_shift = sh.sh_id
    left join after_close ac on ac.ac_shift = sh.sh_id
  ),
  scored as (
    select
      m.*,
      vt.n as void_n,
      case when vt.n >= min_trailing_shifts and vt.sd > 0 and m.m_void_rate is not null
        then round((m.m_void_rate - vt.mean) / vt.sd, 4)
      end as void_z,
      case when rt.n >= min_trailing_shifts and rt.sd > 0 and m.m_removed_rate is not null
        then round((m.m_removed_rate - rt.mean) / rt.sd, 4)
      end as removed_z
    from measured m
    cross join lateral (
      select count(*)::integer as n, avg(t.m_void_rate) as mean, stddev_samp(t.m_void_rate) as sd
      from measured t
      where t.sh_store = m.sh_store
        and t.sh_on between m.sh_on - trailing_days and m.sh_on - 1
        and t.m_void_rate is not null
    ) vt
    cross join lateral (
      select count(*)::integer as n, avg(t.m_removed_rate) as mean, stddev_samp(t.m_removed_rate) as sd
      from measured t
      where t.sh_store = m.sh_store
        and t.sh_on between m.sh_on - trailing_days and m.sh_on - 1
        and t.m_removed_rate is not null
    ) rt
    where m.sh_on between shift_adjustments.from_date and shift_adjustments.to_date
  )
  select
    s.sh_store,
    s.sh_id,
    s.sh_external,
    sh.name,
    s.sh_on,
    s.sh_cashier,
    s.sh_opened,
    s.sh_closed,
    s.m_orders,
    s.m_lines,
    s.m_voids,
    case when s.m_voids = 0 then 0::numeric else s.m_void_amount end,
    s.m_edits,
    s.m_removed,
    case when s.m_removed = 0 then 0::numeric else s.m_removed_amount end,
    s.m_after_close,
    coalesce(sh.changed_after_close, false),
    round(s.m_void_rate, 6),
    round(s.m_removed_rate, 6),
    s.void_n,
    s.void_z,
    s.removed_z,
    coalesce(s.void_z > threshold, false) or coalesce(s.removed_z > threshold, false) or s.m_after_close > 0,
    array_remove(array[
      case when s.void_z > threshold then 'voids' end,
      case when s.removed_z > threshold then 'removed_lines' end,
      case when s.m_after_close > 0 then 'after_close' end
    ], null)
  from scored s
  join visible v on v.visible_store = s.sh_store
  left join public.shifts sh on sh.id = s.sh_id
  order by s.sh_on, v.visible_position, s.sh_opened, s.sh_external collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('shift_adjustments', returned_rows);
end;
$$;

revoke all on function app.discount_rows(uuid[], date, date) from public;
revoke all on function public.promotion_days(uuid[], date, date, text, text) from public, anon;
revoke all on function public.promotion_catalogue(uuid[], date) from public, anon;
revoke all on function public.promotion_lift(uuid[], text, text, date, date, text, integer) from public, anon;
revoke all on function public.promotion_compliance(uuid[], date, date, numeric) from public, anon;
revoke all on function public.item_discount_days(uuid[], integer, date) from public, anon;
revoke all on function public.shift_adjustments(uuid[], date, date, numeric) from public, anon;

grant execute on function app.discount_rows(uuid[], date, date) to authenticated, service_role;
grant execute on function public.promotion_days(uuid[], date, date, text, text) to authenticated, service_role;
grant execute on function public.promotion_catalogue(uuid[], date) to authenticated, service_role;
grant execute on function public.promotion_lift(uuid[], text, text, date, date, text, integer) to authenticated, service_role;
grant execute on function public.promotion_compliance(uuid[], date, date, numeric) to authenticated, service_role;
grant execute on function public.item_discount_days(uuid[], integer, date) to authenticated, service_role;
grant execute on function public.shift_adjustments(uuid[], date, date, numeric) to authenticated, service_role;

