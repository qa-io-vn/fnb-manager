-- G-104, ADR-048 (as amended 2026-11-23): two changes to the nightly liability row, both of which came
-- from reading the stored rows before any page does.
--
-- F2, the flows cover the closed previous local day. points_issued, points_redeemed, points_expired,
-- points_clawed_back and deferred_revenue_released_amount of a row were the points from local midnight
-- up to the run, and the production nightly runs at 03:23, so they covered about three hours. They now
-- cover the whole previous local business day, from its first moment to the first moment of the row's own
-- day, whatever the hour of the run. The stock columns (members, outstanding points and stamps, the
-- liability) are still those of the moment of the run.
--
-- F1, an expiry is reported under the month its credit was issued. An expire row is one row per member
-- and carries no link to an earn, so breakage_by_cohort reported it under the month of the run less the
-- expiry period: a credit sold on 31 October after the nightly hour, expired by the run of 1 November
-- the next year, was reported under November. The expiry is now traced the way it was written, first in
-- first out (app.loyalty_expiring_points): at the moment of the run the member's credits past their
-- expiry, net of their clawbacks, are lined up oldest expiry first; every spent point took the front of
-- the line, so the points that expired are the last ones of it, and each credit is charged with its
-- share. A row that cannot be traced (an opening balance without an expiry date, or credits that shrank
-- afterwards) keeps the old month for the part it cannot trace.
--
-- Everything else of the function is as it was in 20261122100000.

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
  v_flow_start timestamptz;
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
  v_flow_start := (v_date - 1)::timestamp at time zone v_timezone;

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

  -- The flows of the closed previous local day: [first moment of the day before, first moment of this day).
  select
    coalesce(sum(l.point_delta) filter (where l.point_delta > 0 and l.entry_kind in ('earn', 'adjust') and l.reason is distinct from 'redemption_released'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'redeem' or (l.entry_kind = 'adjust' and l.reason = 'redemption_released')), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'expire'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'clawback'), 0)
  into v_issued, v_redeemed, v_expired_day, v_clawed
  from public.loyalty_ledger l
  where l.programme_id = p_programme_id
    and l.occurred_at >= v_flow_start
    and l.occurred_at < v_day_start;

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
      select t.month, 0, t.points
      from (
        with expiries as (
          select e.id as expire_id, e.membership_id, e.occurred_at as run_at, -e.point_delta as expired
          from public.loyalty_ledger e
          where e.programme_id = p_programme_id and e.entry_kind = 'expire' and e.point_delta < 0 and e.occurred_at <= p_as_of
        ),
        -- the credits past their expiry at the moment of each expiry run, net of the clawbacks made by then
        due as (
          select
            x.expire_id,
            c.id as credit_id,
            c.occurred_at as issued_at,
            c.expires_at,
            c.point_delta + coalesce((
              select sum(r.point_delta) from public.loyalty_ledger r
              where r.entry_kind = 'clawback' and r.source_entry_id = c.id and r.occurred_at <= x.run_at
            ), 0) as net
          from expiries x
          join public.loyalty_ledger c on c.membership_id = x.membership_id
          where c.point_delta > 0
            and c.entry_kind in ('earn', 'adjust')
            and c.reason is distinct from 'redemption_released'
            and c.expires_at is not null
            and c.expires_at <= x.run_at
            and c.occurred_at <= x.run_at
        ),
        lined as (
          select
            d.*,
            sum(d.net) over (partition by d.expire_id order by d.expires_at, d.issued_at, d.credit_id) as cum_to,
            sum(d.net) over (partition by d.expire_id) as total
          from due d
        ),
        -- the expired points are the last ones of the line: the part of each credit between
        -- (total - expired) and total
        traced as (
          select
            l.expire_id,
            l.issued_at,
            greatest(least(l.cum_to, l.total) - greatest(l.cum_to - l.net, l.total - x.expired, 0), 0) as part
          from lined l
          join expiries x on x.expire_id = l.expire_id
        ),
        by_credit as (
          select tr.expire_id, date_trunc('month', tr.issued_at at time zone v_timezone) as month, sum(tr.part) as points
          from traced tr
          group by tr.expire_id, date_trunc('month', tr.issued_at at time zone v_timezone)
        ),
        -- what could not be traced keeps the month of the run less the expiry period
        untraced as (
          select
            x.expire_id,
            date_trunc('month', (x.run_at at time zone v_timezone) - make_interval(months => v_programme.points_expiry_months)) as month,
            x.expired - coalesce((select sum(tr.part) from traced tr where tr.expire_id = x.expire_id), 0) as points
          from expiries x
        )
        select bc.month, bc.points from by_credit bc where bc.points > 0
        union all
        select u.month, u.points from untraced u where u.points > 0
      ) t
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

comment on function app.loyalty_liability(uuid, timestamptz) is 'computes and stores (one row per programme and local day, replaced on a re-run) the liability of a programme as of a moment: outstanding points times point_value_amount times (1 - expected breakage), the configured rate until the first expiry is six months old, then the observed share of expired points among redeemed and expired points of the last 12 months; a released redemption hold (adjust, reason redemption_released) nets out of the redeemed points and is not issued; returns the row id; a pending earn that is not confirmed at that moment, and the clawback of it, count for nothing (ADR-048); the issued, redeemed, expired and clawed-back points and the deferred revenue released are those of the closed previous local day, whatever the hour of the run; breakage_by_cohort reports an expiry under the month its credit was issued, traced first in first out';
