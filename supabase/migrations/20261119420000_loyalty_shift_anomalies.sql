-- #253: the shift anomaly report of the web section Khách hàng, counted in the database instead of from
-- raw shift, ledger, refusal and check-in rows in the browser.

create function public.loyalty_shift_anomalies(p_store_ids uuid[], p_from date, p_to date)
returns table (
  store_id uuid,
  business_date date,
  shift_number integer,
  earns integer,
  refusals jsonb,
  refusals_total integer,
  adjustments integer,
  checkins_without_invoice integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_range_days constant integer := 92;
  v_stores uuid[];
  v_start timestamptz;
  v_end timestamptz;
begin
  perform app.require_store_ids('loyalty_shift_anomalies', p_store_ids);
  perform app.require_date_range('loyalty_shift_anomalies', p_from, p_to, max_range_days);

  v_stores := array(
    select distinct s.id
    from unnest(p_store_ids) as s (id)
    where s.id = any (app.current_user_loyalty_store_ids())
  );
  v_start := (p_from - 2)::timestamp at time zone 'UTC';
  v_end := (p_to + 3)::timestamp at time zone 'UTC';

  return query
  with clocks as (
    select st.id, st.timezone, st.business_day_start_minutes as day_start
    from public.stores st
    where st.id = any (v_stores)
  ),
  numbered as (
    select
      x.id,
      x.store_id,
      x.external_id,
      x.opened_at,
      x.closed_at,
      x.day,
      row_number() over (partition by x.store_id, x.day order by x.opened_at, x.external_id collate "C")::integer as n
    from (
      select
        sh.id,
        sh.store_id,
        sh.external_id,
        sh.opened_at,
        sh.closed_at,
        ((sh.opened_at at time zone k.timezone) - make_interval(mins => k.day_start))::date as day
      from public.shifts sh
      join clocks k on k.id = sh.store_id
      where sh.opened_at >= v_start
        and sh.opened_at < v_end
    ) x
  ),
  events as (
    select l.store_id, 'earn'::text as kind, null::text as reason, l.business_date as day, i.shift_external_id, i.sold_at as at
    from public.loyalty_ledger l
    left join public.invoices i on i.id = l.invoice_id
    where l.store_id = any (v_stores)
      and l.entry_kind = 'earn'
      and l.business_date between p_from - 1 and p_to + 1
    union all
    select r.store_id, 'refusal', r.reason, r.business_date, i.shift_external_id, i.sold_at
    from public.loyalty_refusals r
    left join public.invoices i on i.id = r.invoice_id
    where r.store_id = any (v_stores)
      and r.business_date between p_from - 1 and p_to + 1
    union all
    select l.store_id, 'adjust', null, ((l.occurred_at at time zone k.timezone) - make_interval(mins => k.day_start))::date, null, l.occurred_at
    from public.loyalty_ledger l
    join clocks k on k.id = l.store_id
    where l.entry_kind = 'adjust'
      and l.reason <> 'welcome'
      and l.occurred_at >= v_start
      and l.occurred_at < v_end
    union all
    select c.store_id, 'checkin', null, ((c.recorded_at at time zone k.timezone) - make_interval(mins => k.day_start))::date, null, c.recorded_at
    from public.pending_checkins c
    join clocks k on k.id = c.store_id
    where c.recorded_at is not null
      and c.matched_invoice_id is null
      and c.status <> 'queued'
      and c.recorded_at >= v_start
      and c.recorded_at < v_end
  ),
  placed as (
    select e.store_id, e.kind, e.reason, coalesce(f.day, e.day) as day, f.n
    from events e
    left join lateral (
      select x.day, x.n
      from numbered x
      where x.store_id = e.store_id
        and (
          x.external_id = e.shift_external_id
          or (e.at is not null and x.opened_at <= e.at and (x.closed_at is null or e.at <= x.closed_at))
        )
      order by (x.external_id = e.shift_external_id) desc nulls last, x.opened_at desc, x.external_id collate "C" desc
      limit 1
    ) f on true
  ),
  counted as (
    select p.store_id, p.day, p.n, p.kind, p.reason, count(*)::integer as c
    from placed p
    where p.day between p_from and p_to
    group by p.store_id, p.day, p.n, p.kind, p.reason
  )
  select
    q.store_id,
    q.day,
    q.n,
    coalesce(sum(q.c) filter (where q.kind = 'earn'), 0)::integer,
    coalesce(jsonb_object_agg(q.reason, q.c) filter (where q.kind = 'refusal'), '{}'::jsonb),
    coalesce(sum(q.c) filter (where q.kind = 'refusal'), 0)::integer,
    coalesce(sum(q.c) filter (where q.kind = 'adjust'), 0)::integer,
    coalesce(sum(q.c) filter (where q.kind = 'checkin'), 0)::integer
  from counted q
  group by q.store_id, q.day, q.n
  order by q.day, q.store_id, q.n nulls last;
end;
$$;

comment on function public.loyalty_shift_anomalies(uuid[], date, date) is 'the shift anomaly report of the web section Khách hàng (#253): per store, business date and shift (shift_number n of Ca {n}, numbered by opening time then external id among the store''s shifts of that business date, as app.shift_number does; null for events outside every shift), the earns, the refusals by reason ({"reason": count}, only reasons that occurred) and their total, the manual adjustments (adjust rows whose reason is not welcome) and the check-ins recorded without an invoice (not matched, not queued). An earn or refusal belongs to the shift its invoice names, else to the shift open when the invoice was sold; an adjustment or a check-in to the shift open at that moment. A row belongs to the business date of its shift, else to its own. Only rows with an event come back, never a cashier name or the POS shift label. A report function: security invoker, 0 to 50 stores and at most 92 days (22023 otherwise); stores outside the caller''s loyalty scope (owners, managers and viewers) give nothing, so staff and the publisher get no row';

revoke all on function public.loyalty_shift_anomalies(uuid[], date, date) from public, anon;
grant execute on function public.loyalty_shift_anomalies(uuid[], date, date) to authenticated, service_role;
