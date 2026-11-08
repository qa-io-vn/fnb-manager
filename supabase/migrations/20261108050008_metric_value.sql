create or replace function app.opening_minutes(p_opening_hours jsonb, p_date date)
returns integer
language sql
immutable
set search_path = ''
as $$
  with weekday_spans as (
    select p_opening_hours -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_date)::integer] as spans
  ),
  spans as (
    select
      split_part(s.span ->> 0, ':', 1)::integer * 60 + split_part(s.span ->> 0, ':', 2)::integer as open_minute,
      split_part(s.span ->> 1, ':', 1)::integer * 60 + split_part(s.span ->> 1, ':', 2)::integer as close_minute
    from weekday_spans w
    cross join lateral jsonb_array_elements(case when jsonb_typeof(w.spans) = 'array' then w.spans else '[]'::jsonb end) as s (span)
  )
  select case
    when p_opening_hours is null then null
    else coalesce(
      sum(case when s.close_minute > s.open_minute then s.close_minute - s.open_minute else s.close_minute - s.open_minute + 1440 end),
      0
    )::integer
  end
  from spans s;
$$;

create or replace function public.metric_value(store_ids uuid[], metric_id text, from_date date, to_date date)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if from_date is null or to_date is null or from_date > to_date then
    raise exception using
      errcode = '22023',
      message = 'metric_value needs a date range whose start is not after its end';
  end if;

  case metric_id
    when 'net_revenue' then
      return (select case when s.days_with_data > 0 then s.net_amount end from public.period_summary(store_ids, from_date, to_date) s);
    when 'gross_revenue' then
      return (select case when s.days_with_data > 0 then s.gross_amount end from public.period_summary(store_ids, from_date, to_date) s);
    when 'invoices' then
      return (select case when s.days_with_data > 0 then s.invoices end from public.period_summary(store_ids, from_date, to_date) s);
    when 'avg_ticket' then
      return (select s.avg_ticket from public.period_summary(store_ids, from_date, to_date) s);
    when 'items_per_ticket' then
      return (select s.items_per_ticket from public.period_summary(store_ids, from_date, to_date) s);
    when 'avg_item_price' then
      return (select s.avg_item_price from public.period_summary(store_ids, from_date, to_date) s);
    when 'cash_share' then
      return (select s.cash_share from public.period_summary(store_ids, from_date, to_date) s);
    when 'voucher_invoice_share' then
      return (select s.voucher_share from public.period_summary(store_ids, from_date, to_date) s);
    when 'member_invoice_share' then
      return (select s.member_share from public.period_summary(store_ids, from_date, to_date) s);
    when 'discount_rate' then
      return (select round(s.discount_amount / nullif(s.gross_amount, 0), 6) from public.period_summary(store_ids, from_date, to_date) s);
    when 'attach_rate_topping' then
      return (
        select round(sum(a.topping_invoices)::numeric / nullif(sum(a.drink_invoices), 0), 6)
        from public.agg_attach_daily a
        where a.store_id = any (store_ids)
          and a.business_date between from_date and to_date
          and a.attach_rate_topping is not null
      );
    when 'attach_rate_snack' then
      return (
        select round(sum(a.snack_invoices)::numeric / nullif(sum(a.drink_invoices), 0), 6)
        from public.agg_attach_daily a
        where a.store_id = any (store_ids)
          and a.business_date between from_date and to_date
          and a.attach_rate_snack is not null
      );
    when 'size_l_share' then
      return (
        select round(coalesce(sum(a.quantity) filter (where a.size_label = 'L'), 0) / nullif(sum(a.quantity), 0), 6)
        from public.agg_size_mix_daily a
        where a.store_id = any (store_ids)
          and a.business_date between from_date and to_date
      );
    when 'sales_per_opening_hour' then
      return (
        select case
          when not bool_or(s.opening_hours is null)
          then round(60 * sum(d.net_amount) / nullif(sum(app.opening_minutes(s.opening_hours, d.business_date)), 0), 2)
        end
        from app.daily_sales(store_ids, from_date, to_date) d
        join public.stores s on s.id = d.store_id
      );
    when 'invoices_per_opening_hour' then
      return (
        select case
          when not bool_or(s.opening_hours is null)
          then round(60 * sum(d.invoices)::numeric / nullif(sum(app.opening_minutes(s.opening_hours, d.business_date)), 0), 4)
        end
        from app.daily_sales(store_ids, from_date, to_date) d
        join public.stores s on s.id = d.store_id
      );
    when 'peak_share_20_21' then
      return (
        select round(coalesce(sum(h.net_amount) filter (where h.hour_local in (20, 21)), 0) / nullif(sum(h.net_amount), 0), 6)
        from app.hourly_sales(store_ids, from_date, to_date) h
      );
    when 'dead_hour_share_17_18' then
      return (
        select round(coalesce(sum(h.net_amount) filter (where h.hour_local in (17, 18)), 0) / nullif(sum(h.net_amount), 0), 6)
        from app.hourly_sales(store_ids, from_date, to_date) h
      );
    when 'void_rate' then
      return (
        select round(sum(d.voided_invoices)::numeric / nullif(sum(d.invoices + d.voided_invoices), 0), 6)
        from app.daily_sales(store_ids, from_date, to_date) d
      );
    when 'edit_rate' then
      return (
        select round(sum(d.edited_invoices)::numeric / nullif(sum(d.invoices), 0), 6)
        from app.daily_sales(store_ids, from_date, to_date) d
      );
    when 'removed_line_rate' then
      return (
        with removed_lines as (
          select count(*) as line_count
          from public.invoice_events e
          join public.stores s on s.id = e.store_id
          where e.store_id = any (store_ids)
            and e.kind = 'line_removed'
            and ((e.occurred_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date between from_date and to_date
        ),
        item_lines as (
          select count(*) as line_count
          from app.sales_invoices(null, from_date, to_date, store_ids) i
          join public.invoice_lines l on l.invoice_id = i.invoice_id
          where i.status <> 'voided'
            and l.line_kind = 'item'
        )
        select round(r.line_count::numeric / nullif(il.line_count, 0), 6)
        from removed_lines r
        cross join item_lines il
      );
    when 'customer_capture_rate' then
      return (select s.identified_share from public.period_summary(store_ids, from_date, to_date) s);
    else
      raise exception using
        errcode = '22023',
        message = format('metric_value does not compute %L', metric_id),
        hint = 'It computes the metrics of docs/metrics.md that are available now and have one value per store and period.';
  end case;
end;
$$;

revoke all on function app.opening_minutes(jsonb, date) from public;
grant execute on function app.opening_minutes(jsonb, date) to authenticated, service_role;

revoke all on function public.metric_value(uuid[], text, date, date) from public, anon;
grant execute on function public.metric_value(uuid[], text, date, date) to authenticated, service_role;
