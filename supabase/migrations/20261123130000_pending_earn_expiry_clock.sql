-- ADR-046 (3), G-102: a pending earn never expires while it is pending; its expiry clock starts when it
-- is confirmed.
--
-- An earn written pending (a path B to D earn waiting for its proof, a staff-mode bill waiting for the
-- customer) is shown apart and is not spendable. Until now its stamps and points were expired by the
-- nightly run like any other credit, so a balance read -1 stamp and -6 points while the pending line
-- still showed them. Now:
--   * the confirm row of an earn carries the points' expiry, counted from the moment of the confirmation
--     with the programme's points_expiry_months (the loyalty_ledger row of the earn is append-only, so the
--     earn keeps the expiry it was written with and the confirm row states the one that applies), and the
--     earn's stamps get their expiry from the same moment with stamp_validity_months
--     (app.loyalty_confirm and app.bill_confirm);
--   * app.loyalty_expiring_points leaves out an earn that is not confirmed by the moment and reads the
--     expiry of a confirmed pending earn from its confirm row (the earn's own when a confirm row written
--     before this migration has none);
--   * app.loyalty_expire leaves the stamps of an unconfirmed earn alone;
--   * app.loyalty_balance gives as next_stamp_expiry the first expiry of a stamp the balance counts;
--   * app.loyalty_liability traces an expiry (breakage_by_cohort) through the same credits.
-- Everything else of each function is as in its latest definition: app.loyalty_confirm and
-- app.loyalty_expire 20261119130000, app.bill_confirm 20261120510000, app.loyalty_expiring_points
-- 20261119310000, app.loyalty_balance 20261119120000, app.loyalty_liability 20261123090000.

comment on column public.loyalty_ledger.expires_at is 'on a crediting row, when its points expire, fixed at issue from the programme''s points_expiry_months; on the confirm row of a pending earn, when the points of that earn expire, counted from the confirmation (ADR-046: a pending earn never expires while it is pending); each stamp carries its own expiry on its stamps row';

create or replace function app.loyalty_confirm(p_entry_id uuid, p_invoice_id uuid default null, p_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.loyalty_ledger%rowtype;
  v_programme public.loyalty_programmes%rowtype;
  v_confirm uuid;
  v_invoice uuid;
  v_business_date date;
begin
  select l.* into v_entry from public.loyalty_ledger l where l.id = p_entry_id;
  if not found or not v_entry.pending or v_entry.entry_kind not in ('earn', 'redeem') then
    raise exception 'loyalty_confirm confirms a pending earn or redemption' using errcode = '22023';
  end if;
  select l.id into v_confirm from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = p_entry_id;
  if v_confirm is not null then
    return v_confirm;
  end if;
  if exists (select 1 from public.loyalty_ledger l where l.entry_kind = 'clawback' and l.source_entry_id = p_entry_id) then
    raise exception 'a reversed entry is not confirmed' using errcode = '22023';
  end if;
  v_invoice := coalesce(p_invoice_id, v_entry.invoice_id);
  if v_invoice is null then
    raise exception 'a confirmation names the invoice that proves it' using errcode = '22023';
  end if;
  select i.business_date into v_business_date from public.invoices i where i.id = v_invoice and i.tenant_id = v_entry.tenant_id;
  if not found then
    raise exception 'a confirmation names an invoice of the entry''s tenant' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_entry.programme_id;
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, business_date, source_entry_id, expires_at, occurred_at)
  values (
    v_entry.tenant_id, v_entry.programme_id, v_entry.membership_id, v_entry.store_id, 'confirm', v_invoice, v_business_date, p_entry_id,
    case when v_entry.entry_kind = 'earn' and v_entry.point_delta > 0 then p_at + make_interval(months => v_programme.points_expiry_months) end,
    p_at
  )
  on conflict (source_entry_id) where entry_kind = 'confirm' do nothing
  returning id into v_confirm;
  if v_confirm is null then
    select l.id into v_confirm from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = p_entry_id;
  elsif v_entry.entry_kind = 'earn' then
    update public.stamps s
    set expires_at = p_at + make_interval(months => v_programme.stamp_validity_months)
    where s.earn_entry_id = p_entry_id
      and s.state = 'active';
  end if;
  return v_confirm;
end;
$$;

comment on function app.loyalty_confirm(uuid, uuid, timestamptz) is 'confirms a pending earn or redemption hold with a confirm row naming the invoice that proves it (the earn''s own invoice by default) and returns its id; the expiry clock of a confirmed earn starts here (ADR-046): the confirm row carries its points'' expiry and its stamps expire stamp_validity_months from now; a second call returns the same row; service role only';

create or replace function app.bill_confirm(p_bill_id uuid, p_actor uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
  v_earn public.loyalty_ledger;
  v_programme public.loyalty_programmes;
  v_entry uuid;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.state in ('confirmed', 'reversed', 'rejected', 'expired') then
    return;
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  select l.* into v_earn from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  if v_earn.id is null then
    perform app.bill_earn(p_bill_id, false, p_at);
  elsif v_earn.pending then
    select p.* into v_programme from public.loyalty_programmes p where p.id = v_earn.programme_id;
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, business_date, source_entry_id, bill_id, reason, approved_by, expires_at, occurred_at)
    values (
      v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'confirm', v_earn.business_date, v_earn.id, p_bill_id, 'bill_confirmed', p_actor,
      case when v_earn.point_delta > 0 then p_at + make_interval(months => v_programme.points_expiry_months) end,
      p_at
    )
    on conflict (source_entry_id) where entry_kind = 'confirm' do nothing
    returning id into v_entry;
    if v_entry is not null then
      update public.stamps s
      set expires_at = p_at + make_interval(months => v_programme.stamp_validity_months)
      where s.earn_entry_id = v_earn.id
        and s.state = 'active';
    end if;
    v_entry := null;
  end if;
  update public.bill_captures b
  set state = 'confirmed', queue_reason = null, confirmed_at = p_at,
      decided_by = coalesce(p_actor, b.decided_by), decided_at = coalesce(b.decided_at, case when p_actor is not null then p_at end)
  where b.id = p_bill_id;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_confirmed', p_bill_id, v_bill.membership_id, v_bill.total,
    jsonb_build_object('evidence_level', v_bill.evidence_level, 'auto_approved', v_bill.auto_approved), p_at);
  if v_settings.bill_audit_sample_pct > 0 and random() * 100 < v_settings.bill_audit_sample_pct then
    insert into public.bill_audits (tenant_id, store_id, bill_id, opened_at)
    values (v_bill.tenant_id, v_bill.store_id, p_bill_id, p_at)
    on conflict (bill_id) do nothing
    returning id into v_entry;
    if v_entry is not null then
      perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'audit_opened', v_entry, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
    end if;
  end if;
end;
$$;

comment on function app.bill_confirm(uuid, uuid, timestamptz) is 'confirms a bill (state -> confirmed): a confirm row for its pending earn, which starts the earn''s expiry clock (ADR-046: the confirm row carries the points'' expiry and the stamps expire stamp_validity_months from the confirmation), or a confirmed earn when none was written yet; audited; samples bill_audit_sample_pct of the confirmed bills into bill_audits; a closed bill is left alone; internal';

create or replace function app.loyalty_expiring_points(p_membership_id uuid, p_as_of timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select l.*
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and l.occurred_at <= p_as_of
  ),
  credits as (
    select
      c.point_delta + coalesce((select sum(r.point_delta) from rows r where r.entry_kind = 'clawback' and r.source_entry_id = c.id), 0) as net,
      case when c.pending then coalesce(f.expires_at, c.expires_at) else c.expires_at end as expires_at
    from rows c
    left join rows f on c.pending and f.entry_kind = 'confirm' and f.source_entry_id = c.id
    where c.point_delta > 0
      and c.entry_kind in ('earn', 'adjust')
      and c.reason is distinct from 'redemption_released'
      and (not c.pending or f.id is not null)
  ),
  debits as (
    select coalesce(-sum(r.point_delta), 0) as total
    from rows r
    where r.entry_kind in ('redeem', 'expire')
       or (r.entry_kind = 'adjust' and (r.point_delta < 0 or r.reason = 'redemption_released'))
  )
  select greatest(
    coalesce((select sum(c.net) from credits c where c.expires_at is not null and c.expires_at <= p_as_of), 0)
      - (select d.total from debits d),
    0
  )::integer;
$$;

comment on function app.loyalty_expiring_points(uuid, timestamptz) is 'the points of a membership that expire by p_as_of, first in first out: the credits whose expiry has passed (net of their clawbacks) less every point already spent, held, adjusted away or expired; a released redemption hold (adjust, reason redemption_released) cancels its hold instead of counting as a new credit, so the points it gives back keep the expiry of the credits they came from; an earn not confirmed by p_as_of never expires, and a confirmed pending earn expires when its confirm row says (ADR-046)';

create or replace function app.loyalty_expire(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_due uuid[];
  v_stamps integer;
  v_points integer;
  v_entry uuid;
  v_rows integer := 0;
  v_total_stamps integer := 0;
  v_total_points integer := 0;
begin
  for v_membership in
    select m.id, m.tenant_id, m.programme_id, p.point_value_amount
    from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id
    where m.tenant_id = p_tenant_id
      and (
        exists (select 1 from public.stamps s where s.membership_id = m.id and s.state = 'active' and s.expires_at <= p_as_of)
        or exists (select 1 from public.loyalty_ledger l where l.membership_id = m.id and l.point_delta > 0 and l.expires_at <= p_as_of)
      )
    order by m.id
    for update of m
  loop
    select coalesce(array_agg(s.id), '{}'::uuid[]) into v_due
    from public.stamps s
    where s.membership_id = v_membership.id
      and s.state = 'active'
      and s.expires_at <= p_as_of
      and not exists (
        select 1
        from public.loyalty_ledger e
        where e.id = s.earn_entry_id
          and e.pending
          and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
      );
    v_stamps := cardinality(v_due);
    v_points := app.loyalty_expiring_points(v_membership.id, p_as_of);
    if v_stamps > 0 or v_points > 0 then
      insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, occurred_at)
      values (v_membership.tenant_id, v_membership.programme_id, v_membership.id, 'expire', -v_stamps, -v_points,
        -round(v_points * v_membership.point_value_amount, 2), 'expired', p_as_of)
      returning id into v_entry;
      update public.stamps s
      set state = 'expired', closed_entry_id = v_entry, closed_at = p_as_of
      where s.id = any (v_due);
      v_rows := v_rows + 1;
      v_total_stamps := v_total_stamps + v_stamps;
      v_total_points := v_total_points + v_points;
    end if;
  end loop;
  return jsonb_build_object('memberships', v_rows, 'stamps', v_total_stamps, 'points', v_total_points);
end;
$$;

comment on function app.loyalty_expire(uuid, timestamptz) is 'expires the stamps whose validity ended and the points whose rolling expiry passed (first in first out) for every membership of a tenant, one expire row per membership with both deltas; the stamps and points of an earn still waiting for its confirm row never expire (ADR-046); a second run with the same moment adds nothing; returns counts only; service role only';

create or replace function app.loyalty_balance(p_membership_id uuid, p_at timestamptz default null)
returns table (
  membership_id uuid,
  programme_id uuid,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  stamps_per_card smallint,
  cards_completed integer,
  stamps_on_card integer,
  next_stamp_expiry timestamptz,
  points_value_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    select l.*
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and (p_at is null or l.occurred_at <= p_at)
  ),
  open_pending as (
    select e.id
    from entries e
    where e.pending
      and e.entry_kind = 'earn'
      and not exists (select 1 from entries c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
  ),
  split as (
    select
      e.stamp_delta,
      e.point_delta,
      exists (select 1 from open_pending o where o.id = e.id or o.id = e.source_entry_id) as is_pending
    from entries e
  ),
  totals as (
    select
      coalesce(sum(s.stamp_delta) filter (where not s.is_pending), 0)::integer as stamps,
      coalesce(sum(s.point_delta) filter (where not s.is_pending), 0)::integer as points,
      coalesce(sum(s.stamp_delta) filter (where s.is_pending), 0)::integer as pending_stamps,
      coalesce(sum(s.point_delta) filter (where s.is_pending), 0)::integer as pending_points
    from split s
  )
  select
    m.id,
    m.programme_id,
    t.stamps,
    t.points,
    t.pending_stamps,
    t.pending_points,
    p.stamps_per_card,
    greatest(t.stamps, 0) / p.stamps_per_card,
    greatest(t.stamps, 0) % p.stamps_per_card,
    (
      select min(st.expires_at)
      from public.stamps st
      where st.membership_id = m.id
        and st.state = 'active'
        and not exists (select 1 from open_pending o where o.id = st.earn_entry_id)
    ),
    round(t.points * p.point_value_amount, 2)
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  cross join totals t
  where m.id = p_membership_id;
$$;

comment on function app.loyalty_balance(uuid, timestamptz) is 'the balance of a membership from its ledger rows (up to p_at when given): spendable stamps and points (confirmed earns, adjustments, holds, redemptions, clawbacks and expiries) and pending ones (earns waiting for their confirm row), with the card progress, the first expiry of a stamp the balance counts (not one of a pending earn, whose clock starts at its confirmation, ADR-046) and the points value; no row when the caller cannot read the membership';

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
        -- the credits past their expiry at the moment of each expiry run, net of the clawbacks made by then;
        -- an earn not confirmed by then is not a credit yet, and a confirmed pending earn expires when its
        -- confirm row says (ADR-046, as app.loyalty_expiring_points)
        candidates as (
          select
            x.expire_id,
            x.run_at,
            c.id,
            c.occurred_at,
            c.point_delta,
            case when c.pending then coalesce(f.expires_at, c.expires_at) else c.expires_at end as expires_at
          from expiries x
          join public.loyalty_ledger c on c.membership_id = x.membership_id
          left join public.loyalty_ledger f on c.pending and f.entry_kind = 'confirm' and f.source_entry_id = c.id and f.occurred_at <= x.run_at
          where c.point_delta > 0
            and c.entry_kind in ('earn', 'adjust')
            and c.reason is distinct from 'redemption_released'
            and c.occurred_at <= x.run_at
            and (not c.pending or f.id is not null)
        ),
        due as (
          select
            c.expire_id,
            c.id as credit_id,
            c.occurred_at as issued_at,
            c.expires_at,
            c.point_delta + coalesce((
              select sum(r.point_delta) from public.loyalty_ledger r
              where r.entry_kind = 'clawback' and r.source_entry_id = c.id and r.occurred_at <= c.run_at
            ), 0) as net
          from candidates c
          where c.expires_at is not null
            and c.expires_at <= c.run_at
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

comment on function app.loyalty_liability(uuid, timestamptz) is 'computes and stores (one row per programme and local day, replaced on a re-run) the liability of a programme as of a moment: outstanding points times point_value_amount times (1 - expected breakage), the configured rate until the first expiry is six months old, then the observed share of expired points among redeemed and expired points of the last 12 months; a released redemption hold (adjust, reason redemption_released) nets out of the redeemed points and is not issued; returns the row id; a pending earn that is not confirmed at that moment, and the clawback of it, count for nothing (ADR-048); the issued, redeemed, expired and clawed-back points and the deferred revenue released are those of the closed previous local day, whatever the hour of the run; breakage_by_cohort reports an expiry under the month its credit was issued, traced first in first out through the credits app.loyalty_expiring_points expires (a pending earn only once confirmed, with the expiry of its confirm row, ADR-046)';
