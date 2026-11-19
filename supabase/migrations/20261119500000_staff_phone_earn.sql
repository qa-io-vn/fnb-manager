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
    select p_tenant_id, v_membership, v_entry, p_at, p_at + make_interval(months => v_programme.stamp_validity_months)
    from generate_series(1, v_programme.welcome_stamps);
  end if;
  return v_membership;
end;
$$;

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

comment on function app.loyalty_join(uuid, uuid, text, uuid, uuid, text, timestamptz) is 'enrols a customer in the tenant''s active programme and returns the membership id; the first join credits the programme''s welcome stamps (an adjust row with reason welcome), except for a staff phone of the tenant (app.loyalty_is_staff_phone: on loyalty_staff_phones or linked to an active staff_roster row); a second call returns the same membership and adds nothing; service role only';

comment on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) is 'credits a membership for an invoice by the programme read at this moment: one stamp when the net amount reaches stamp_min_bill_amount, points_per_unit per point_unit_amount of the net amount; refuses already_earned, membership_inactive, invoice_not_completed, programme_inactive, excluded_source, excluded_phone (the member''s or the invoice''s phone is a staff phone of the tenant, app.loyalty_is_staff_phone: on loyalty_staff_phones or linked to an active staff_roster row, on every path A to D) and daily_cap, and notes below_minimum when no stamp is earned; each refusal is stored in loyalty_refusals; service role only';

comment on function app.loyalty_is_staff_phone(uuid, text) is 'whether a phone is a staff phone of the tenant: on the loyalty staff-phone list or linked to an active staff roster row; such a phone gets no welcome stamps, never earns on any path (app.loyalty_earn refuses excluded_phone, which the staff app names staff_phone) and is not recorded or looked up at the till';
