comment on column public.loyalty_ledger.expires_at is 'on a crediting row, when its points expire, fixed at issue from the programme''s points_expiry_months; each stamp carries its own expiry on its stamps row';

create table public.loyalty_refusals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  invoice_id uuid not null,
  business_date date not null,
  matched_path text not null check (matched_path in ('A', 'B', 'C', 'D')),
  reason text not null check (reason in ('below_minimum', 'daily_cap', 'excluded_phone', 'excluded_source', 'already_earned', 'invoice_not_completed', 'programme_inactive', 'membership_inactive')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (invoice_id, membership_id, reason),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);

comment on table public.loyalty_refusals is 'why an invoice did not earn (or earned points without a stamp, below_minimum) for a membership, one row per invoice, membership and reason, for the shift anomaly report; a refused invoice is not tried again on that path';

create index loyalty_refusals_store_date_idx on public.loyalty_refusals (store_id, business_date);

create function app.loyalty_customer_for_phone(p_tenant_id uuid, p_phone text, p_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_customer uuid;
begin
  if v_phone is null then
    raise exception 'loyalty_customer_for_phone needs a phone number that reads in E.164 form' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'loyalty_customer_for_phone needs an existing tenant' using errcode = '22023';
  end if;
  select c.id into v_customer
  from public.customers c
  where c.tenant_id = p_tenant_id
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by (c.phone = v_phone) desc, c.first_seen_at, c.id
  limit 1;
  if v_customer is null then
    insert into public.customers (tenant_id, phone, first_seen_at, last_seen_at)
    values (p_tenant_id, v_phone, p_at, p_at)
    on conflict (tenant_id, phone) where phone is not null do update set last_seen_at = greatest(public.customers.last_seen_at, excluded.last_seen_at)
    returning id into v_customer;
  end if;
  return v_customer;
end;
$$;

comment on function app.loyalty_customer_for_phone(uuid, text, timestamptz) is 'the customers row of a phone in a tenant, matched in E.164 form whatever form the till stored, created with the E.164 phone when none exists; service role only';

create function app.loyalty_active_programme(p_tenant_id uuid, p_on date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.loyalty_programmes p
  where p.tenant_id = p_tenant_id
    and p.status = 'active'
    and p.starts_on <= p_on
    and (p.ends_on is null or p.ends_on >= p_on);
$$;

comment on function app.loyalty_active_programme(uuid, date) is 'the tenant''s active programme whose period covers the day, or null';

create function app.loyalty_join(
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
  if v_programme.welcome_stamps > 0
    and not exists (
      select 1 from public.loyalty_staff_phones s
      where s.tenant_id = p_tenant_id and s.phone = app.loyalty_normalize_phone(v_phone)
    )
  then
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, reason, occurred_at)
    values (p_tenant_id, v_programme.id, v_membership, p_store_id, 'adjust', v_programme.welcome_stamps, 'welcome', p_at)
    returning id into v_entry;
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select p_tenant_id, v_membership, v_entry, p_at, p_at + make_interval(months => v_programme.stamp_validity_months)
    from generate_series(1, v_programme.welcome_stamps);
  end if;
  return v_membership;
end;
$$;

comment on function app.loyalty_join(uuid, uuid, text, uuid, uuid, text, timestamptz) is 'enrols a customer in the tenant''s active programme and returns the membership id; the first join credits the programme''s welcome stamps (an adjust row with reason welcome), except for a phone on the staff list; a second call returns the same membership and adds nothing; service role only';

create function app.loyalty_earn(
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

  if exists (select 1 from public.loyalty_ledger l where l.invoice_id = p_invoice_id and l.entry_kind = 'earn') then
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
    if exists (
      select 1 from public.loyalty_staff_phones s
      where s.tenant_id = v_membership.tenant_id
        and (s.phone = v_phone or s.phone = v_invoice_phone)
    ) then
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
        p_approved_by, case when v_points > 0 then v_invoice.sold_at + make_interval(months => v_programme.points_expiry_months) end, p_at
      )
      on conflict (invoice_id) where entry_kind = 'earn' do nothing
      returning id into v_entry;
      if v_entry is null then
        v_refusal := 'already_earned';
        v_stamps := 0;
        v_points := 0;
      elsif v_stamps > 0 then
        insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
        select v_membership.tenant_id, p_membership_id, v_entry, v_invoice.sold_at, v_invoice.sold_at + make_interval(months => v_programme.stamp_validity_months)
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

comment on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) is 'credits a membership for an invoice by the programme read at this moment: one stamp when the net amount reaches stamp_min_bill_amount, points_per_unit per point_unit_amount of the net amount; refuses already_earned, membership_inactive, invoice_not_completed, programme_inactive, excluded_source, excluded_phone and daily_cap, and notes below_minimum when no stamp is earned; each refusal is stored in loyalty_refusals; service role only';

create function app.loyalty_confirm(p_entry_id uuid, p_invoice_id uuid default null, p_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.loyalty_ledger%rowtype;
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
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, business_date, source_entry_id, occurred_at)
  values (v_entry.tenant_id, v_entry.programme_id, v_entry.membership_id, v_entry.store_id, 'confirm', v_invoice, v_business_date, p_entry_id, p_at)
  on conflict (source_entry_id) where entry_kind = 'confirm' do nothing
  returning id into v_confirm;
  if v_confirm is null then
    select l.id into v_confirm from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = p_entry_id;
  end if;
  return v_confirm;
end;
$$;

comment on function app.loyalty_confirm(uuid, uuid, timestamptz) is 'confirms a pending earn or redemption hold with a confirm row naming the invoice that proves it (the earn''s own invoice by default) and returns its id; a second call returns the same row; service role only';

create function app.loyalty_clawback(p_invoice_id uuid, p_reason text default null, p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
  v_reason text;
  v_earn public.loyalty_ledger%rowtype;
  v_entry uuid;
  v_count integer := 0;
begin
  select i.status into v_status from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'loyalty_clawback needs an existing invoice' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason), ''), case when v_status in ('voided', 'edited') then 'invoice_' || v_status::text end);
  if v_reason is null then
    raise exception 'a clawback of a completed invoice states its reason' using errcode = '22023';
  end if;
  for v_earn in
    select l.*
    from public.loyalty_ledger l
    where l.invoice_id = p_invoice_id
      and l.entry_kind = 'earn'
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
  loop
    insert into public.loyalty_ledger (
      tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
      invoice_id, business_date, source_entry_id, reason, occurred_at
    )
    values (
      v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'clawback', -v_earn.stamp_delta, -v_earn.point_delta, -v_earn.value_amount,
      p_invoice_id, v_earn.business_date, v_earn.id, v_reason, p_at
    )
    on conflict (source_entry_id) where entry_kind = 'clawback' do nothing
    returning id into v_entry;
    if v_entry is not null then
      update public.stamps s
      set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
      where s.earn_entry_id = v_earn.id
        and s.state = 'active';
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function app.loyalty_clawback(uuid, text, timestamptz) is 'reverses every earn of an invoice not yet reversed with a clawback row of the opposite deltas and closes its active stamps; stamps already redeemed stay redeemed, so the balance may go negative; the reason defaults to invoice_voided or invoice_edited; returns the rows written; service role only';

create function app.loyalty_expiring_points(p_membership_id uuid, p_as_of timestamptz)
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
      c.expires_at
    from rows c
    where c.point_delta > 0
      and c.entry_kind in ('earn', 'adjust')
  ),
  debits as (
    select coalesce(-sum(r.point_delta), 0) as total
    from rows r
    where r.entry_kind in ('redeem', 'expire')
       or (r.entry_kind = 'adjust' and r.point_delta < 0)
  )
  select greatest(
    coalesce((select sum(c.net) from credits c where c.expires_at is not null and c.expires_at <= p_as_of), 0)
      - (select d.total from debits d),
    0
  )::integer;
$$;

comment on function app.loyalty_expiring_points(uuid, timestamptz) is 'the points of a membership that expire by p_as_of, first in first out: the credits whose expiry has passed (net of their clawbacks) less every point already spent, held, adjusted away or expired';

create function app.loyalty_expire(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
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
    select count(*) into v_stamps
    from public.stamps s
    where s.membership_id = v_membership.id and s.state = 'active' and s.expires_at <= p_as_of;
    v_points := app.loyalty_expiring_points(v_membership.id, p_as_of);
    if v_stamps > 0 or v_points > 0 then
      insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, occurred_at)
      values (v_membership.tenant_id, v_membership.programme_id, v_membership.id, 'expire', -v_stamps, -v_points,
        -round(v_points * v_membership.point_value_amount, 2), 'expired', p_as_of)
      returning id into v_entry;
      update public.stamps s
      set state = 'expired', closed_entry_id = v_entry, closed_at = p_as_of
      where s.membership_id = v_membership.id and s.state = 'active' and s.expires_at <= p_as_of;
      v_rows := v_rows + 1;
      v_total_stamps := v_total_stamps + v_stamps;
      v_total_points := v_total_points + v_points;
    end if;
  end loop;
  return jsonb_build_object('memberships', v_rows, 'stamps', v_total_stamps, 'points', v_total_points);
end;
$$;

comment on function app.loyalty_expire(uuid, timestamptz) is 'expires the stamps whose validity ended and the points whose rolling expiry passed (first in first out) for every membership of a tenant, one expire row per membership with both deltas; a second run with the same moment adds nothing; returns counts only; service role only';

alter table public.loyalty_refusals enable row level security;

create policy loyalty_refusals_select_for_loyalty_readers on public.loyalty_refusals
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_store_ids())::uuid[]));

revoke all on public.loyalty_refusals from anon;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_refusals from authenticated;
grant select on public.loyalty_refusals to authenticated;

revoke all on function app.loyalty_customer_for_phone(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_active_programme(uuid, date) from public, anon, authenticated;
revoke all on function app.loyalty_join(uuid, uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke all on function app.loyalty_confirm(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_clawback(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_expiring_points(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_expire(uuid, timestamptz) from public, anon, authenticated;

grant execute on function app.loyalty_customer_for_phone(uuid, text, timestamptz) to service_role;
grant execute on function app.loyalty_active_programme(uuid, date) to service_role;
grant execute on function app.loyalty_join(uuid, uuid, text, uuid, uuid, text, timestamptz) to service_role;
grant execute on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) to service_role;
grant execute on function app.loyalty_confirm(uuid, uuid, timestamptz) to service_role;
grant execute on function app.loyalty_clawback(uuid, text, timestamptz) to service_role;
grant execute on function app.loyalty_expiring_points(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_expire(uuid, timestamptz) to service_role;

alter function app.guard_coupon() security definer;
revoke all on function app.coupon_unmapped_stores(uuid, text, uuid[]) from authenticated;
