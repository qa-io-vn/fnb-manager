create table public.loyalty_liability_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  programme_id uuid not null,
  as_of_date date not null,
  as_of timestamptz not null,
  members integer not null default 0 check (members >= 0),
  outstanding_points bigint not null default 0 check (outstanding_points >= 0),
  outstanding_stamps bigint not null default 0 check (outstanding_stamps >= 0),
  point_value_amount numeric(14, 2) not null,
  expected_breakage_rate numeric(4, 3) not null check (expected_breakage_rate between 0 and 1),
  breakage_source text not null check (breakage_source in ('configured', 'observed')),
  liability_amount numeric(14, 2) not null,
  points_issued bigint not null default 0,
  points_redeemed bigint not null default 0,
  points_expired bigint not null default 0,
  points_clawed_back bigint not null default 0,
  deferred_revenue_released_amount numeric(14, 2) not null default 0,
  breakage_by_cohort jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (programme_id, as_of_date),
  foreign key (tenant_id, programme_id) references public.loyalty_programmes (tenant_id, id) on delete cascade
);

comment on table public.loyalty_liability_daily is 'the nightly points liability of a programme: outstanding points (positive balances, confirmed) times the point value times one minus the expected breakage, which is the programme''s configured rate until six months of expiry data exist and the observed expired share of spent and expired points of the last 12 months after; the day''s issued, redeemed, expired and clawed-back points, the deferred revenue released by redemptions and the breakage by issue month; counts and amounts only';

create function app.loyalty_liability(p_programme_id uuid, p_as_of timestamptz default now())
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

  with balances as (
    select
      m.id,
      coalesce(sum(l.point_delta) filter (where not (l.entry_kind = 'earn' and l.pending and not exists (
        select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_as_of
      ))), 0) as points,
      coalesce(sum(l.stamp_delta) filter (where not (l.entry_kind = 'earn' and l.pending and not exists (
        select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_as_of
      ))), 0) as stamps
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
      coalesce(-sum(l.point_delta) filter (where l.entry_kind in ('redeem', 'expire')), 0)
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
    coalesce(sum(l.point_delta) filter (where l.point_delta > 0 and l.entry_kind in ('earn', 'adjust')), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'redeem'), 0),
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

comment on function app.loyalty_liability(uuid, timestamptz) is 'computes and stores (one row per programme and local day, replaced on a re-run) the liability of a programme as of a moment: outstanding points times point_value_amount times (1 - expected breakage), the configured rate until the first expiry is six months old, then the observed share of expired points among redeemed and expired points of the last 12 months; returns the row id';

create function app.loyalty_nightly(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_clawbacks integer := 0;
  v_expired jsonb;
  v_programme uuid;
  v_liability integer := 0;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'loyalty_nightly needs an existing tenant' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  for v_invoice in
    select distinct l.invoice_id
    from public.loyalty_ledger l
    join public.invoices i on i.id = l.invoice_id
    where l.tenant_id = p_tenant_id
      and l.entry_kind = 'earn'
      and i.status in ('voided', 'edited')
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
  loop
    v_clawbacks := v_clawbacks + app.loyalty_clawback(v_invoice, null, p_as_of);
  end loop;
  v_expired := app.loyalty_expire(p_tenant_id, p_as_of);
  for v_programme in
    select p.id from public.loyalty_programmes p
    where p.tenant_id = p_tenant_id and p.status in ('active', 'paused')
    order by p.id
  loop
    perform app.loyalty_liability(v_programme, p_as_of);
    v_liability := v_liability + 1;
  end loop;
  return jsonb_build_object(
    'clawbacks', v_clawbacks,
    'expired_memberships', (v_expired ->> 'memberships')::integer,
    'expired_stamps', (v_expired ->> 'stamps')::integer,
    'expired_points', (v_expired ->> 'points')::integer,
    'liability_rows', v_liability
  );
end;
$$;

comment on function app.loyalty_nightly(uuid, timestamptz) is 'the nightly loyalty step of a tenant after the nightly sync: claws back the earns of invoices the re-pull marked voided or edited, expires stamps and points, and stores the liability of each active or paused programme; idempotent for a moment; counts only';

create function app.loyalty_tenants()
returns table (tenant_id uuid, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.slug
  from public.tenants t
  where exists (select 1 from public.loyalty_programmes p where p.tenant_id = t.id and p.status in ('active', 'paused'))
  order by t.slug;
$$;

comment on function app.loyalty_tenants() is 'the tenants with an active or paused loyalty programme, for the nightly loyalty step';

alter table public.loyalty_liability_daily enable row level security;

create policy loyalty_liability_daily_select_for_loyalty_readers on public.loyalty_liability_daily
  for select to authenticated
  using (tenant_id = any ((select app.current_user_loyalty_tenant_ids())::uuid[]));

revoke all on public.loyalty_liability_daily from anon;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_liability_daily from authenticated;
grant select on public.loyalty_liability_daily to authenticated;

revoke all on function app.loyalty_liability(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_nightly(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_tenants() from public, anon, authenticated;

grant execute on function app.loyalty_liability(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_nightly(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_tenants() to service_role;
