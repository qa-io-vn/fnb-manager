-- G-103, ADR-048: the liability counts confirmed points only. A clawback of a pending earn that was never
-- confirmed was subtracted from the member's confirmed points although the earn was never counted, so the
-- stored outstanding points were lower than the ledger balance. Rows that hang on an unconfirmed pending earn
-- (its clawback) are now left out of the balances, as app.loyalty_balance and the @fnb/core model already did.
-- Only the balances step changes; the rest of the function is as it was in 20261119310000.

create or replace function app.loyalty_liability(p_programme_id uuid, p_as_of timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.loyalty_programmes%rowtype;
  v_timezone text;
  v_date date;
  v_day_start timestamptz;
  v_members integer;
  v_points bigint;
  v_stamps bigint;
  v_first_expiry timestamptz;
  v_spent bigint;
  v_expired bigint;
  v_rate numeric;
  v_source text;
  v_issued bigint;
  v_redeemed bigint;
  v_expired_day bigint;
  v_clawed bigint;
  v_cohorts jsonb;
  v_id uuid;
begin
  select p.* into v_programme from public.loyalty_programmes p where p.id = p_programme_id;
  if not found then
    raise exception 'loyalty_liability needs an existing programme' using errcode = '22023';
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = v_programme.tenant_id;
  v_date := (p_as_of at time zone v_timezone)::date;
  v_day_start := v_date::timestamp at time zone v_timezone;

  with waiting as (
    -- A pending earn that is not confirmed at this moment is not a liability yet, and neither is a row
    -- that hangs on it (the clawback of it): the earn was never counted (ADR-048, G-103).
    select e.id
    from public.loyalty_ledger e
    where e.programme_id = p_programme_id
      and e.entry_kind = 'earn'
      and e.pending
      and e.occurred_at <= p_as_of
      and not exists (
        select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id and c.occurred_at <= p_as_of
      )
  ),
  balances as (
    select
      m.id,
      coalesce(sum(l.point_delta) filter (where l.id not in (select w.id from waiting w) and (l.source_entry_id is null or l.source_entry_id not in (select w.id from waiting w))), 0) as points,
      coalesce(sum(l.stamp_delta) filter (where l.id not in (select w.id from waiting w) and (l.source_entry_id is null or l.source_entry_id not in (select w.id from waiting w))), 0) as stamps
    from public.memberships m
    left join public.loyalty_ledger l on l.membership_id = m.id and l.occurred_at <= p_as_of
    where m.programme_id = p_programme_id
      and m.joined_at <= p_as_of
    group by m.id
  )
  select count(*), coalesce(sum(greatest(b.points, 0)), 0), coalesce(sum(greatest(b.stamps, 0)), 0)
  into v_members, v_points, v_stamps
  from balances b;

  select min(l.occurred_at) into v_first_expiry
  from public.loyalty_ledger l
  where l.programme_id = p_programme_id and l.entry_kind = 'expire' and l.point_delta < 0 and l.occurred_at <= p_as_of;
  if v_first_expiry is not null and v_first_expiry <= p_as_of - interval '6 months' then
    select
      coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'expire'), 0),
      coalesce(-sum(l.point_delta) filter (where l.entry_kind in ('redeem', 'expire') or (l.entry_kind = 'adjust' and l.reason = 'redemption_released')), 0)
    into v_expired, v_spent
    from public.loyalty_ledger l
    where l.programme_id = p_programme_id
      and l.occurred_at > p_as_of - interval '12 months'
      and l.occurred_at <= p_as_of;
    if v_spent > 0 then
      v_rate := least(round(v_expired::numeric / v_spent, 3), 1);
      v_source := 'observed';
    end if;
  end if;
  if v_source is null then
    v_rate := v_programme.expected_breakage_rate;
    v_source := 'configured';
  end if;

  select
    coalesce(sum(l.point_delta) filter (where l.point_delta > 0 and l.entry_kind in ('earn', 'adjust') and l.reason is distinct from 'redemption_released'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'redeem' or (l.entry_kind = 'adjust' and l.reason = 'redemption_released')), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'expire'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'clawback'), 0)
  into v_issued, v_redeemed, v_expired_day, v_clawed
  from public.loyalty_ledger l
  where l.programme_id = p_programme_id
    and l.occurred_at >= v_day_start
    and l.occurred_at <= p_as_of;

  select coalesce(jsonb_agg(jsonb_build_object('month', c.month, 'issued', c.issued, 'expired', c.expired) order by c.month), '[]'::jsonb)
  into v_cohorts
  from (
    select
      to_char(k.month, 'YYYY-MM') as month,
      coalesce(sum(k.issued), 0)::bigint as issued,
      coalesce(sum(k.expired), 0)::bigint as expired
    from (
      select date_trunc('month', l.occurred_at at time zone v_timezone) as month, l.point_delta as issued, 0 as expired
      from public.loyalty_ledger l
      where l.programme_id = p_programme_id and l.occurred_at <= p_as_of and l.point_delta > 0 and l.entry_kind in ('earn', 'adjust')
        and l.reason is distinct from 'redemption_released'
      union all
      select date_trunc('month', (l.occurred_at at time zone v_timezone) - make_interval(months => v_programme.points_expiry_months)), 0, -l.point_delta
      from public.loyalty_ledger l
      where l.programme_id = p_programme_id and l.occurred_at <= p_as_of and l.entry_kind = 'expire' and l.point_delta < 0
    ) k
    group by k.month
  ) c;

  insert into public.loyalty_liability_daily (
    tenant_id, programme_id, as_of_date, as_of, members, outstanding_points, outstanding_stamps, point_value_amount,
    expected_breakage_rate, breakage_source, liability_amount, points_issued, points_redeemed, points_expired, points_clawed_back,
    deferred_revenue_released_amount, breakage_by_cohort, computed_at
  )
  values (
    v_programme.tenant_id, p_programme_id, v_date, p_as_of, v_members, v_points, v_stamps, v_programme.point_value_amount,
    v_rate, v_source, round(v_points * v_programme.point_value_amount * (1 - v_rate), 2), v_issued, v_redeemed, v_expired_day, v_clawed,
    round(v_redeemed * v_programme.point_value_amount, 2), v_cohorts, now()
  )
  on conflict (programme_id, as_of_date) do update set
    as_of = excluded.as_of,
    members = excluded.members,
    outstanding_points = excluded.outstanding_points,
    outstanding_stamps = excluded.outstanding_stamps,
    point_value_amount = excluded.point_value_amount,
    expected_breakage_rate = excluded.expected_breakage_rate,
    breakage_source = excluded.breakage_source,
    liability_amount = excluded.liability_amount,
    points_issued = excluded.points_issued,
    points_redeemed = excluded.points_redeemed,
    points_expired = excluded.points_expired,
    points_clawed_back = excluded.points_clawed_back,
    deferred_revenue_released_amount = excluded.deferred_revenue_released_amount,
    breakage_by_cohort = excluded.breakage_by_cohort,
    computed_at = excluded.computed_at
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.loyalty_liability(uuid, timestamptz) is 'computes and stores (one row per programme and local day, replaced on a re-run) the liability of a programme as of a moment: outstanding points times point_value_amount times (1 - expected breakage), the configured rate until the first expiry is six months old, then the observed share of expired points among redeemed and expired points of the last 12 months; a released redemption hold (adjust, reason redemption_released) nets out of the redeemed points and is not issued; returns the row id; a pending earn that is not confirmed at that moment, and the clawback of it, count for nothing (ADR-048)';
