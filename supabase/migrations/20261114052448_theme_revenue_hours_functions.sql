create function public.range_totals(store_ids uuid[], from_dates date[], to_dates date[])
returns table (
  range_index smallint,
  store_id uuid,
  from_date date,
  to_date date,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  voucher_invoices bigint,
  member_invoices bigint,
  identified_invoices bigint,
  voided_invoices bigint,
  voided_amount numeric,
  edited_invoices bigint,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric,
  discount_rate numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_ranges constant integer := 6;
  max_days constant integer := 1100;
  range_count integer := coalesce(cardinality(range_totals.from_dates), 0);
  range_number integer;
begin
  perform app.require_store_ids('range_totals', range_totals.store_ids);
  if range_count < 1
    or range_count > max_ranges
    or range_count <> coalesce(cardinality(range_totals.to_dates), 0) then
    raise exception using
      errcode = '22023',
      message = format('range_totals needs 1 to %s ranges, with as many end dates as start dates', max_ranges);
  end if;
  for range_number in 1 .. range_count loop
    perform app.require_date_range('range_totals', range_totals.from_dates[range_number], range_totals.to_dates[range_number], max_days);
  end loop;
  if cardinality(range_totals.store_ids) = 0 then
    return;
  end if;
  perform app.require_report_rows(
    'range_totals',
    range_count::bigint * (1 + (select count(*) from app.visible_stores(range_totals.store_ids)))
  );

  return query
  with blocks as (
    select null::uuid as block_store_id, 0::bigint as block_position, range_totals.store_ids as block_store_ids
    union all
    select v.store_id, v.store_position, array[v.store_id]
    from app.visible_stores(range_totals.store_ids) v
  ),
  ranges as (
    select r.range_from, r.range_to, r.range_position
    from unnest(range_totals.from_dates, range_totals.to_dates) with ordinality as r (range_from, range_to, range_position)
  )
  select
    r.range_position::smallint,
    k.block_store_id,
    r.range_from,
    r.range_to,
    t.days_with_data,
    t.invoices,
    t.net_amount,
    t.gross_amount,
    t.item_discount_amount,
    t.bill_discount_amount,
    t.voucher_amount,
    t.discount_amount,
    t.paid_amount,
    t.cash_amount,
    t.items_sold,
    t.voucher_invoices,
    t.member_invoices,
    t.identified_invoices,
    t.voided_invoices,
    t.voided_amount,
    t.edited_invoices,
    t.avg_ticket,
    t.items_per_ticket,
    t.avg_item_price,
    t.cash_share,
    t.voucher_share,
    t.member_share,
    t.identified_share,
    t.discount_rate
  from ranges r
  cross join blocks k
  cross join lateral app.period_totals(k.block_store_ids, r.range_from, r.range_to) t
  order by r.range_position, k.block_position;
end;
$$;

create function public.opening_productivity(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  days_with_sales integer,
  invoices bigint,
  net_amount numeric,
  opening_minutes bigint,
  seat_count integer,
  seat_minutes bigint,
  sales_per_opening_hour numeric,
  invoices_per_opening_hour numeric,
  revpash numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_days constant integer := 1100;
begin
  perform app.require_store_ids('opening_productivity', opening_productivity.store_ids);
  perform app.require_date_range('opening_productivity', opening_productivity.from_date, opening_productivity.to_date, max_days);
  if cardinality(opening_productivity.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as (
    select v.store_id as visible_id, v.store_position, s.opening_hours, s.seat_count as seats
    from app.visible_stores(opening_productivity.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  store_days as (
    select
      d.store_id as day_store_id,
      d.invoices as day_invoices,
      d.net_amount as day_net,
      v.opening_hours is null as hours_missing,
      app.opening_minutes(v.opening_hours, d.business_date) as day_minutes,
      v.seats
    from app.daily_sales(opening_productivity.store_ids, opening_productivity.from_date, opening_productivity.to_date) d
    join visible v on v.visible_id = d.store_id
  ),
  blocks as (
    select null::uuid as block_store_id, 0::bigint as block_position
    union all
    select v.visible_id, v.store_position
    from visible v
  ),
  summed as (
    select
      k.block_store_id,
      k.block_position,
      count(d.day_store_id)::integer as day_count,
      sum(d.day_invoices) as sum_invoices,
      sum(d.day_net) as sum_net,
      case when not bool_or(d.hours_missing) then sum(d.day_minutes) end as sum_minutes,
      case
        when not bool_or(d.hours_missing) and not bool_or(d.seats is null)
          then sum(d.seats::bigint * d.day_minutes)::bigint
      end as sum_seat_minutes
    from blocks k
    left join store_days d
      on k.block_store_id is null or d.day_store_id = k.block_store_id
    group by k.block_store_id, k.block_position
  ),
  seated as (
    select
      m.*,
      case
        when m.block_store_id is not null then (select v.seats from visible v where v.visible_id = m.block_store_id)
        else (
          select case when bool_or(v.seats is null) then null else sum(v.seats)::integer end
          from visible v
          where exists (select 1 from store_days d where d.day_store_id = v.visible_id)
        )
      end as block_seats
    from summed m
  )
  select
    s.block_store_id,
    s.day_count,
    s.sum_invoices,
    s.sum_net,
    s.sum_minutes,
    s.block_seats,
    s.sum_seat_minutes,
    round(60 * s.sum_net / nullif(s.sum_minutes, 0), 2),
    round(60 * s.sum_invoices::numeric / nullif(s.sum_minutes, 0), 4),
    round(60 * s.sum_net / nullif(s.sum_seat_minutes, 0), 2)
  from seated s
  order by s.block_position;
end;
$$;

create function public.hour_profile(
  store_ids uuid[],
  from_date date,
  to_date date,
  peak_hours integer default null,
  dead_hour_ratio numeric default null,
  busy_hour_ratio numeric default null
)
returns table (
  scope text,
  weekday smallint,
  hour_local smallint,
  hour_position smallint,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  avg_net_amount numeric,
  avg_invoices numeric,
  net_share numeric,
  level text,
  peak_share numeric,
  dead_share numeric,
  peak_hours_used integer,
  dead_hour_ratio_used numeric,
  busy_hour_ratio_used numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_days constant integer := 400;
begin
  perform app.require_store_ids('hour_profile', hour_profile.store_ids);
  perform app.require_date_range('hour_profile', hour_profile.from_date, hour_profile.to_date, max_days);
  if hour_profile.peak_hours is not null and hour_profile.peak_hours not between 1 and 6 then
    raise exception using errcode = '22023', message = 'hour_profile needs peak_hours between 1 and 6';
  end if;
  if hour_profile.dead_hour_ratio is not null and hour_profile.dead_hour_ratio not between 0.1 and 0.9 then
    raise exception using errcode = '22023', message = 'hour_profile needs dead_hour_ratio between 0.1 and 0.9';
  end if;
  if hour_profile.busy_hour_ratio is not null and hour_profile.busy_hour_ratio not between 1.05 and 3 then
    raise exception using errcode = '22023', message = 'hour_profile needs busy_hour_ratio between 1.05 and 3';
  end if;
  if cardinality(hour_profile.store_ids) = 0 then
    return;
  end if;

  return query
  with first_store as (
    select (s.business_day_start_minutes / 60)::integer as start_hour
    from app.visible_stores(hour_profile.store_ids) v
    join public.stores s on s.id = v.store_id
    order by v.store_position
    limit 1
  ),
  thresholds as (
    select
      coalesce(hour_profile.peak_hours, r.peak_hours) as peak_count,
      coalesce(hour_profile.dead_hour_ratio, r.dead_hour_ratio) as dead_ratio,
      coalesce(hour_profile.busy_hour_ratio, r.busy_hour_ratio) as busy_ratio
    from app.store_report_settings(hour_profile.store_ids) with ordinality as r (
      store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
      cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
      promo_pre_weeks, settings_position
    )
    order by r.settings_position
    limit 1
  ),
  hourly as (
    select
      h.business_date,
      extract(isodow from h.business_date)::smallint as day_of_week,
      h.hour_local as local_hour,
      h.invoices as hour_invoices,
      h.net_amount as hour_net
    from app.hourly_sales(hour_profile.store_ids, hour_profile.from_date, hour_profile.to_date) h
  ),
  scoped as (
    select 'all'::text as scope_name, 1 as scope_order, h.* from hourly h
    union all
    select 'weekdays', 2, h.* from hourly h where h.day_of_week between 1 and 5
    union all
    select 'weekend', 3, h.* from hourly h where h.day_of_week >= 6
  ),
  scope_totals as (
    select
      s.scope_name,
      s.scope_order,
      count(distinct s.business_date)::integer as scope_days,
      sum(s.hour_invoices) as scope_invoices,
      sum(s.hour_net) as scope_net
    from scoped s
    group by s.scope_name, s.scope_order
  ),
  per_hour as (
    select
      s.scope_name,
      ((s.local_hour - f.start_hour + 24) % 24)::smallint as slot,
      sum(s.hour_invoices) as position_invoices,
      sum(s.hour_net) as position_net
    from scoped s
    cross join first_store f
    group by s.scope_name, ((s.local_hour - f.start_hour + 24) % 24)
  ),
  spans as (
    select
      p.scope_name,
      min(p.slot) filter (where p.position_net > 0) as first_position,
      max(p.slot) filter (where p.position_net > 0) as last_position
    from per_hour p
    group by p.scope_name
  ),
  span_hours as (
    select
      sp.scope_name,
      g.slot::smallint as slot,
      ((g.slot + f.start_hour) % 24)::smallint as local_hour,
      coalesce(p.position_invoices, 0) as position_invoices,
      coalesce(p.position_net, 0) as position_net
    from spans sp
    cross join first_store f
    cross join lateral generate_series(sp.first_position::integer, sp.last_position::integer) as g (slot)
    left join per_hour p on p.scope_name = sp.scope_name and p.slot = g.slot
    where sp.first_position is not null
  ),
  span_totals as (
    select
      h.scope_name,
      count(*) as span_count,
      sum(h.position_invoices) as span_invoices,
      sum(h.position_net) as span_net
    from span_hours h
    group by h.scope_name
  ),
  ranked as (
    select
      h.*,
      row_number() over (partition by h.scope_name order by h.position_net desc, h.slot) as net_rank
    from span_hours h
  ),
  levelled as (
    select
      r.scope_name,
      r.slot,
      r.local_hour,
      r.position_invoices,
      r.position_net,
      case
        when r.scope_name = 'all' then
          case
            when r.position_net > 0 and r.net_rank <= t.peak_count then 'peak'
            when r.position_net * st.span_count < t.dead_ratio * st.span_net then 'dead'
            else 'normal'
          end
        else
          case
            when r.position_invoices > 0 and r.position_invoices * st.span_count >= t.busy_ratio * st.span_invoices then 'busy'
            when r.position_invoices * st.span_count < t.dead_ratio * st.span_invoices then 'quiet'
            else 'normal'
          end
      end as hour_level
    from ranked r
    join span_totals st on st.scope_name = r.scope_name
    cross join thresholds t
  ),
  level_shares as (
    select
      l.scope_name,
      sum(l.position_net) filter (where l.hour_level = 'peak') as peak_net,
      sum(l.position_net) filter (where l.hour_level = 'dead') as dead_net
    from levelled l
    group by l.scope_name
  ),
  weekdays as (
    select
      h.day_of_week,
      count(distinct h.business_date)::integer as weekday_days,
      sum(h.hour_invoices) as weekday_invoices,
      sum(h.hour_net) as weekday_net
    from hourly h
    group by h.day_of_week
  ),
  rows_out as (
    select
      l.scope_name as out_scope,
      tot.scope_order as out_scope_order,
      null::smallint as out_weekday,
      l.local_hour as out_hour,
      l.slot as out_position,
      0 as out_summary,
      tot.scope_days as out_days,
      l.position_invoices as out_invoices,
      l.position_net as out_net,
      round(l.position_net / tot.scope_days, 2) as out_avg_net,
      round(l.position_invoices::numeric / tot.scope_days, 4) as out_avg_invoices,
      round(l.position_net / nullif(tot.scope_net, 0), 6) as out_share,
      l.hour_level as out_level,
      null::numeric as out_peak_share,
      null::numeric as out_dead_share
    from levelled l
    join scope_totals tot on tot.scope_name = l.scope_name
    union all
    select
      tot.scope_name,
      tot.scope_order,
      null::smallint,
      null::smallint,
      null::smallint,
      1,
      tot.scope_days,
      tot.scope_invoices,
      tot.scope_net,
      round(tot.scope_net / tot.scope_days, 2),
      round(tot.scope_invoices::numeric / tot.scope_days, 4),
      round(tot.scope_net / nullif(tot.scope_net, 0), 6),
      null::text,
      case when tot.scope_name = 'all' then round(coalesce(ls.peak_net, 0) / nullif(tot.scope_net, 0), 6) end,
      case when tot.scope_name = 'all' then round(coalesce(ls.dead_net, 0) / nullif(tot.scope_net, 0), 6) end
    from scope_totals tot
    left join level_shares ls on ls.scope_name = tot.scope_name
    union all
    select
      'weekday',
      4,
      w.day_of_week,
      null::smallint,
      null::smallint,
      0,
      w.weekday_days,
      w.weekday_invoices,
      w.weekday_net,
      round(w.weekday_net / w.weekday_days, 2),
      round(w.weekday_invoices::numeric / w.weekday_days, 4),
      round(w.weekday_net / nullif((select a.scope_net from scope_totals a where a.scope_name = 'all'), 0), 6),
      null::text,
      null::numeric,
      null::numeric
    from weekdays w
  )
  select
    o.out_scope,
    o.out_weekday,
    o.out_hour,
    o.out_position,
    o.out_days,
    o.out_invoices,
    o.out_net,
    o.out_avg_net,
    o.out_avg_invoices,
    o.out_share,
    o.out_level,
    o.out_peak_share,
    o.out_dead_share,
    t.peak_count,
    t.dead_ratio,
    t.busy_ratio
  from rows_out o
  cross join thresholds t
  order by o.out_scope_order, o.out_summary, o.out_position, o.out_weekday;
end;
$$;

revoke all on function public.range_totals(uuid[], date[], date[]) from public, anon;
revoke all on function public.opening_productivity(uuid[], date, date) from public, anon;
revoke all on function public.hour_profile(uuid[], date, date, integer, numeric, numeric) from public, anon;

grant execute on function public.range_totals(uuid[], date[], date[]) to authenticated, service_role;
grant execute on function public.opening_productivity(uuid[], date, date) to authenticated, service_role;
grant execute on function public.hour_profile(uuid[], date, date, integer, numeric, numeric) to authenticated, service_role;
