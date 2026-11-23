-- ADR-047: a credit is valid through the end of its anniversary day.
--
-- A credit's last day is the local date of the sale (the tenant's time zone) plus the programme's months,
-- clamped to the last day of a shorter month as PostgreSQL adds months (31 August plus six months is
-- 28 February, 29 February plus twelve months is 28 February); it is valid through 23:59:59 of that day, so
-- its expires_at is the local midnight that ends it: app.loyalty_credit_expires_at(moment, months, time zone).
-- Until now expires_at was the moment of the sale plus the months in the session's time zone, so three
-- credits sold at 02:00, 09:00 and 23:30 of one day expired at three different hours of their anniversary.
--
-- Every writer of an expiry uses it: app.loyalty_earn (from the invoice's sale), app.bill_earn (from the
-- recording of the bill), app.loyalty_join (the welcome stamps, from the join), app.loyalty_apply_adjustment
-- (from the adjustment), and app.loyalty_confirm and app.bill_confirm, where the clock of a pending earn
-- starts (ADR-046, from the confirmation). The credits written before this migration are moved by
-- 20261123170000. Everything else of each function is as in its latest definition: app.loyalty_join
-- 20261119500000, app.loyalty_earn 20261120500000, app.bill_earn 20261120510000,
-- app.loyalty_apply_adjustment 20261123120000, app.loyalty_confirm and app.bill_confirm 20261123130000.

create or replace function app.loyalty_credit_expires_at(p_from timestamptz, p_months integer, p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((((p_from at time zone p_timezone)::date + make_interval(months => p_months))::date + 1)::timestamp at time zone p_timezone);
$$;

comment on function app.loyalty_credit_expires_at(timestamptz, integer, text) is 'ADR-047: when a credit issued at p_from expires, p_months later: the local midnight (p_timezone) that ends the anniversary day, the local date of p_from plus p_months clamped to the last day of a shorter month; the credit is valid through that day and spendable while the moment is before the result; internal';

create or replace function app.loyalty_join(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_channel text,
  p_store_id uuid default null,
  p_brand_id uuid default null,
  p_zalo_user_id text default null,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_programme public.loyalty_programmes%rowtype;
  v_membership uuid;
  v_phone text;
  v_entry uuid;
begin
  select t.timezone into v_timezone from public.tenants t where t.id = p_tenant_id;
  if v_timezone is null then
    raise exception 'loyalty_join needs an existing tenant' using errcode = '22023';
  end if;
  select c.phone into v_phone from public.customers c where c.id = p_customer_id and c.tenant_id = p_tenant_id;
  if not found then
    raise exception 'loyalty_join needs a customer of the tenant' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (select 1 from public.stores s where s.id = p_store_id and s.tenant_id = p_tenant_id) then
    raise exception 'loyalty_join needs a store of the tenant' using errcode = '22023';
  end if;
  select p.* into v_programme
  from public.loyalty_programmes p
  where p.id = app.loyalty_active_programme(p_tenant_id, (p_at at time zone v_timezone)::date);
  if v_programme.id is null then
    raise exception 'the tenant has no active loyalty programme to join' using errcode = '22023';
  end if;
  select m.id into v_membership
  from public.memberships m
  where m.programme_id = v_programme.id and m.customer_id = p_customer_id
  for update;
  if v_membership is not null then
    update public.memberships m
    set brand_id = coalesce(m.brand_id, p_brand_id),
        zalo_user_id = case when m.brand_id is null or m.brand_id = p_brand_id then coalesce(p_zalo_user_id, m.zalo_user_id) else m.zalo_user_id end
    where m.id = v_membership
      and p_brand_id is not null
      and (m.brand_id is null or m.brand_id = p_brand_id);
    return v_membership;
  end if;
  insert into public.memberships (tenant_id, programme_id, customer_id, joined_at, channel, joined_store_id, brand_id, zalo_user_id)
  values (p_tenant_id, v_programme.id, p_customer_id, p_at, p_channel, p_store_id, p_brand_id, case when p_brand_id is not null then p_zalo_user_id end)
  on conflict (programme_id, customer_id) do nothing
  returning id into v_membership;
  if v_membership is null then
    select m.id into v_membership from public.memberships m where m.programme_id = v_programme.id and m.customer_id = p_customer_id;
    return v_membership;
  end if;
  if v_programme.welcome_stamps > 0 and not app.loyalty_is_staff_phone(p_tenant_id, v_phone) then
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, reason, occurred_at)
    values (p_tenant_id, v_programme.id, v_membership, p_store_id, 'adjust', v_programme.welcome_stamps, 'welcome', p_at)
    returning id into v_entry;
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select p_tenant_id, v_membership, v_entry, p_at, app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
    from generate_series(1, v_programme.welcome_stamps);
  end if;
  return v_membership;
end;
$$;

comment on function app.loyalty_join(uuid, uuid, text, uuid, uuid, text, timestamptz) is 'enrols a customer in the tenant''s active programme and returns the membership id; the first join credits the programme''s welcome stamps (an adjust row with reason welcome), valid through the end of the day stamp_validity_months after the join (ADR-047), except for a staff phone (app.loyalty_is_staff_phone: the owner''s list or an active roster row); a second call returns the same membership and adds nothing; service role only';

create or replace function app.loyalty_earn(
  p_invoice_id uuid,
  p_membership_id uuid,
  p_path text,
  p_at timestamptz default now(),
  p_pending boolean default false,
  p_approved_by uuid default null
)
returns table (entry_id uuid, stamps integer, points integer, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_membership public.memberships%rowtype;
  v_programme public.loyalty_programmes%rowtype;
  v_phone text;
  v_invoice_phone text;
  v_earned_today integer;
  v_stamps integer := 0;
  v_points integer := 0;
  v_entry uuid;
  v_refusal text;
  v_timezone text;
begin
  if p_path is null or p_path not in ('A', 'B', 'C', 'D') then
    raise exception 'loyalty_earn takes the matched path A, B, C or D' using errcode = '22023';
  end if;
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'loyalty_earn needs an existing membership' using errcode = '22023';
  end if;
  select i.* into v_invoice from public.invoices i where i.id = p_invoice_id;
  if not found or v_invoice.tenant_id <> v_membership.tenant_id then
    raise exception 'loyalty_earn needs an invoice of the membership''s tenant' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_membership.tenant_id;

  if app.loyalty_store_mode(v_invoice.store_id) = 'staff' then
    v_refusal := 'staff_mode';
  elsif exists (select 1 from public.loyalty_ledger l where l.invoice_id = p_invoice_id and l.entry_kind = 'earn')
    or app.loyalty_invoice_billed(p_invoice_id)
  then
    v_refusal := 'already_earned';
  elsif v_membership.status <> 'active' then
    v_refusal := 'membership_inactive';
  elsif v_invoice.status <> 'completed' then
    v_refusal := 'invoice_not_completed';
  elsif v_programme.status <> 'active'
    or v_invoice.business_date < v_programme.starts_on
    or (v_programme.ends_on is not null and v_invoice.business_date > v_programme.ends_on)
  then
    v_refusal := 'programme_inactive';
  elsif exists (
    select 1
    from unnest(v_programme.excluded_order_sources) as s (source)
    where lower(s.source) = lower(btrim(coalesce(v_invoice.source_external_id, '')))
       or lower(s.source) = lower(btrim(coalesce(v_invoice.source_name, '')))
  ) then
    v_refusal := 'excluded_source';
  else
    select app.loyalty_normalize_phone(c.phone) into v_phone from public.customers c where c.id = v_membership.customer_id;
    v_invoice_phone := app.loyalty_normalize_phone(v_invoice.customer_phone);
    if app.loyalty_is_staff_phone(v_membership.tenant_id, v_phone)
      or app.loyalty_is_staff_phone(v_membership.tenant_id, v_invoice_phone)
    then
      v_refusal := 'excluded_phone';
    else
      select count(*) into v_earned_today
      from public.loyalty_ledger e
      where e.membership_id = p_membership_id
        and e.entry_kind = 'earn'
        and e.business_date = v_invoice.business_date
        and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = e.id);
      if v_earned_today >= v_programme.earning_invoices_per_phone_per_day then
        v_refusal := 'daily_cap';
      end if;
    end if;
  end if;

  if v_refusal is null then
    v_stamps := case when v_invoice.net_amount >= v_programme.stamp_min_bill_amount then 1 else 0 end;
    v_points := greatest(floor(v_invoice.net_amount / v_programme.point_unit_amount), 0)::integer * v_programme.points_per_unit;
    if v_stamps = 0 then
      v_refusal := 'below_minimum';
    end if;
    if v_stamps > 0 or v_points > 0 then
      insert into public.loyalty_ledger (
        tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
        invoice_id, business_date, matched_path, pending, approved_by, expires_at, occurred_at
      )
      values (
        v_membership.tenant_id, v_programme.id, p_membership_id, v_invoice.store_id, 'earn', v_stamps, v_points,
        round(v_points * v_programme.point_value_amount, 2), p_invoice_id, v_invoice.business_date, p_path, coalesce(p_pending, false),
        p_approved_by, case when v_points > 0 then app.loyalty_credit_expires_at(v_invoice.sold_at, v_programme.points_expiry_months, v_timezone) end, p_at
      )
      on conflict (invoice_id) where entry_kind = 'earn' do nothing
      returning id into v_entry;
      if v_entry is null then
        v_refusal := 'already_earned';
        v_stamps := 0;
        v_points := 0;
      elsif v_stamps > 0 then
        insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
        select v_membership.tenant_id, p_membership_id, v_entry, v_invoice.sold_at, app.loyalty_credit_expires_at(v_invoice.sold_at, v_programme.stamp_validity_months, v_timezone)
        from generate_series(1, v_stamps);
      end if;
    end if;
  else
    v_stamps := 0;
    v_points := 0;
  end if;

  if v_refusal is not null then
    insert into public.loyalty_refusals (tenant_id, store_id, membership_id, invoice_id, business_date, matched_path, reason, created_at)
    values (v_membership.tenant_id, v_invoice.store_id, p_membership_id, p_invoice_id, v_invoice.business_date, p_path, v_refusal, p_at)
    on conflict (invoice_id, membership_id, reason) do nothing;
  end if;
  return query select v_entry, v_stamps, v_points, v_refusal;
end;
$$;

comment on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) is 'credits a membership for an invoice by the programme read at this moment: one stamp when the net amount reaches stamp_min_bill_amount, points_per_unit per point_unit_amount of the net amount; refuses staff_mode (the invoice''s store confirms through staff, path E), already_earned (also when a bill of path E is linked to the invoice by the shadow check), membership_inactive, invoice_not_completed, programme_inactive, excluded_source, excluded_phone (a phone on the owner''s list or on an active staff roster row) and daily_cap, and notes below_minimum when no stamp is earned; each refusal is stored in loyalty_refusals; service role only';

create or replace function app.bill_earn(p_bill_id uuid, p_pending boolean, p_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_programme public.loyalty_programmes;
  v_stamps integer;
  v_points integer;
  v_entry uuid;
  v_timezone text;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id;
  select l.id into v_entry from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  if v_entry is not null then
    return v_entry;
  end if;
  select p.* into v_programme
  from public.memberships m join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = v_bill.membership_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_bill.tenant_id;
  v_stamps := case when v_bill.total >= v_programme.stamp_min_bill_amount then 1 else 0 end;
  v_points := greatest(floor(v_bill.total / v_programme.point_unit_amount), 0)::integer * v_programme.points_per_unit;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    business_date, matched_path, pending, approved_by, bill_id, expires_at, occurred_at
  )
  values (
    v_bill.tenant_id, v_programme.id, v_bill.membership_id, v_bill.store_id, 'earn', v_stamps, v_points,
    round(v_points * v_programme.point_value_amount, 2), v_bill.business_date, 'E', p_pending, v_bill.captured_by, v_bill.id,
    case when v_points > 0 then app.loyalty_credit_expires_at(p_at, v_programme.points_expiry_months, v_timezone) end, p_at
  )
  returning id into v_entry;
  if v_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_bill.tenant_id, v_bill.membership_id, v_entry, p_at, app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
    from generate_series(1, v_stamps);
  end if;
  return v_entry;
end;
$$;

comment on function app.bill_earn(uuid, boolean, timestamptz) is 'writes the earn of a bill (path E, one per bill): one stamp when the total reaches stamp_min_bill_amount, points_per_unit per point_unit_amount, pending or not; returns the existing earn when there is one; internal';

create or replace function app.loyalty_apply_adjustment(
  p_membership_id uuid,
  p_store_id uuid,
  p_stamps integer,
  p_points integer,
  p_reason text,
  p_approved_by uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_balance record;
  v_entry uuid;
  v_timezone text;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'loyalty_apply_adjustment needs an existing membership' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_membership.tenant_id;
  if coalesce(p_stamps, 0) < 0 or coalesce(p_points, 0) < 0 then
    select b.stamps, b.points into v_balance from app.loyalty_balance(p_membership_id, p_at) b;
    if (coalesce(p_stamps, 0) < 0 and coalesce(v_balance.stamps, 0) + p_stamps < 0)
      or (coalesce(p_points, 0) < 0 and coalesce(v_balance.points, 0) + p_points < 0)
    then
      raise exception 'an adjustment never takes a balance below zero: % stamps and % points are spendable',
        coalesce(v_balance.stamps, 0), coalesce(v_balance.points, 0)
        using errcode = '22023';
    end if;
  end if;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    reason, approved_by, expires_at, occurred_at
  )
  values (
    v_membership.tenant_id, v_programme.id, p_membership_id, p_store_id, 'adjust', coalesce(p_stamps, 0), coalesce(p_points, 0),
    round(coalesce(p_points, 0) * v_programme.point_value_amount, 2), p_reason, p_approved_by,
    case when p_points > 0 then app.loyalty_credit_expires_at(p_at, v_programme.points_expiry_months, v_timezone) end, p_at
  )
  returning id into v_entry;
  if p_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_membership.tenant_id, p_membership_id, v_entry, p_at, app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
    from generate_series(1, p_stamps);
  elsif p_stamps < 0 then
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (
      select a.id
      from public.stamps a
      where a.membership_id = p_membership_id
        and a.state = 'active'
        and not exists (
          select 1
          from public.loyalty_ledger e
          where e.id = a.earn_entry_id
            and e.pending
            and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
        )
      order by a.expires_at, a.id
      limit -p_stamps
    );
  end if;
  return v_entry;
end;
$$;

comment on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) is 'writes a manual adjustment as a loyalty_ledger adjust row with its reason and approver (points valued at the programme''s point_value_amount and expiring after points_expiry_months); added stamps get stamps rows expiring after stamp_validity_months, removed ones close the oldest active stamps the balance counts (never one of an earn still waiting for its confirm row) as clawed_back; refuses with 22023, writing nothing, a negative part larger than the spendable balance of that kind at the moment (ADR-046: a balance never goes below zero) and an unknown membership; returns the ledger row; internal';

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
  v_timezone text;
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
  select t.timezone into v_timezone from public.tenants t where t.id = v_entry.tenant_id;
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, business_date, source_entry_id, expires_at, occurred_at)
  values (
    v_entry.tenant_id, v_entry.programme_id, v_entry.membership_id, v_entry.store_id, 'confirm', v_invoice, v_business_date, p_entry_id,
    case when v_entry.entry_kind = 'earn' and v_entry.point_delta > 0 then app.loyalty_credit_expires_at(p_at, v_programme.points_expiry_months, v_timezone) end,
    p_at
  )
  on conflict (source_entry_id) where entry_kind = 'confirm' do nothing
  returning id into v_confirm;
  if v_confirm is null then
    select l.id into v_confirm from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = p_entry_id;
  elsif v_entry.entry_kind = 'earn' then
    update public.stamps s
    set expires_at = app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
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
  v_timezone text;
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
    select t.timezone into v_timezone from public.tenants t where t.id = v_earn.tenant_id;
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, business_date, source_entry_id, bill_id, reason, approved_by, expires_at, occurred_at)
    values (
      v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'confirm', v_earn.business_date, v_earn.id, p_bill_id, 'bill_confirmed', p_actor,
      case when v_earn.point_delta > 0 then app.loyalty_credit_expires_at(p_at, v_programme.points_expiry_months, v_timezone) end,
      p_at
    )
    on conflict (source_entry_id) where entry_kind = 'confirm' do nothing
    returning id into v_entry;
    if v_entry is not null then
      update public.stamps s
      set expires_at = app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
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

comment on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) is 'credits a membership for an invoice by the programme read at this moment: one stamp when the net amount reaches stamp_min_bill_amount, points_per_unit per point_unit_amount of the net amount, valid through the end of the anniversary day of the sale (ADR-047: expires_at is the local midnight ending the sale''s local date plus stamp_validity_months or points_expiry_months, app.loyalty_credit_expires_at); refuses staff_mode (the invoice''s store confirms through staff, path E), already_earned (also when a bill of path E is linked to the invoice by the shadow check), membership_inactive, invoice_not_completed, programme_inactive, excluded_source, excluded_phone (a phone on the owner''s list or on an active staff roster row) and daily_cap, and notes below_minimum when no stamp is earned; each refusal is stored in loyalty_refusals; service role only';
comment on function app.bill_earn(uuid, boolean, timestamptz) is 'writes the earn of a bill (path E, one per bill): one stamp when the total reaches stamp_min_bill_amount, points_per_unit per point_unit_amount, pending or not, valid through the end of the anniversary day of the recording (ADR-047); returns the existing earn when there is one; internal';
comment on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) is 'writes a manual adjustment as a loyalty_ledger adjust row with its reason and approver (points valued at the programme''s point_value_amount); added points and stamps are valid through the end of the anniversary day of the adjustment (ADR-047), removed stamps close the oldest active stamps the balance counts (never one of an earn still waiting for its confirm row) as clawed_back; refuses with 22023, writing nothing, a negative part larger than the spendable balance of that kind at the moment (ADR-046: a balance never goes below zero) and an unknown membership; returns the ledger row; internal';
comment on function app.loyalty_confirm(uuid, uuid, timestamptz) is 'confirms a pending earn or redemption hold with a confirm row naming the invoice that proves it (the earn''s own invoice by default) and returns its id; the expiry clock of a confirmed earn starts here (ADR-046): the confirm row carries its points'' expiry and its stamps get theirs, each through the end of the anniversary day of the confirmation (ADR-047); a second call returns the same row; service role only';
comment on function app.bill_confirm(uuid, uuid, timestamptz) is 'confirms a bill (state -> confirmed): a confirm row for its pending earn, which starts the earn''s expiry clock (ADR-046: the confirm row carries the points'' expiry and the stamps get theirs, through the end of the anniversary day of the confirmation, ADR-047), or a confirmed earn when none was written yet; audited; samples bill_audit_sample_pct of the confirmed bills into bill_audits; a closed bill is left alone; internal';

revoke all on function app.loyalty_credit_expires_at(timestamptz, integer, text) from public, anon, authenticated;
grant execute on function app.loyalty_credit_expires_at(timestamptz, integer, text) to service_role;
