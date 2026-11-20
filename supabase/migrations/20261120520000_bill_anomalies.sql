-- Bill verification, plan phase 3 and the readers of the ledger: the per-staff anomaly report, the
-- optional shadow check against synced invoices, path E in the staff lookup and the customer wallet,
-- the customer home's per-store confirmation mode, and the data-subject erasure of bills.

-- 1. Readers of the ledger learn path E -------------------------------------------------------

create or replace function app.staff_member_lookup(p_store_id uuid, p_phone text DEFAULT NULL::text, p_membership_id uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_timezone text;
  v_store_name text;
  v_membership public.memberships;
  v_customer public.customers;
  v_balance record;
  v_today date;
  v_locked timestamptz;
begin
  select s.tenant_id, s.timezone, s.name into v_tenant, v_timezone, v_store_name from public.stores s where s.id = p_store_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only an owner, manager or staff member of the store looks a member up there' using errcode = '42501';
  end if;
  if num_nonnulls(nullif(btrim(p_phone), ''), p_membership_id) <> 1 then
    raise exception 'a lookup takes either a phone number or a membership' using errcode = '22023';
  end if;
  if p_membership_id is null then
    v_locked := app.code_attempt_gate('staff_member_lookup', v_tenant, p_store_id, (select auth.uid()), p_at);
    if v_locked is not null then
      return jsonb_build_object('found', false, 'locked', true, 'retry_at', v_locked);
    end if;
  end if;
  if p_membership_id is not null then
    select m.* into v_membership
    from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id and p.status <> 'draft'
    where m.id = p_membership_id and m.tenant_id = v_tenant;
  elsif app.loyalty_normalize_phone(p_phone) is not null and not app.loyalty_is_staff_phone(v_tenant, p_phone) then
    v_membership := app.loyalty_member_for_phone(v_tenant, p_phone);
  end if;
  if v_membership.id is null then
    if p_membership_id is null then
      perform app.code_attempt_record('staff_member_lookup', v_tenant, p_store_id, (select auth.uid()), p_at);
    end if;
    return jsonb_build_object('found', false);
  end if;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  if app.loyalty_is_staff_phone(v_tenant, v_customer.phone) then
    if p_membership_id is null then
      perform app.code_attempt_record('staff_member_lookup', v_tenant, p_store_id, (select auth.uid()), p_at);
    end if;
    return jsonb_build_object('found', false);
  end if;
  select b.* into v_balance from app.loyalty_balance(v_membership.id, p_at) b;
  v_today := app.store_business_date(p_store_id, p_at);
  return jsonb_build_object(
    'found', true,
    'store_name', v_store_name,
    'business_date', to_char(v_today, 'YYYY-MM-DD'),
    'card', jsonb_build_object(
      'membership_id', v_membership.id,
      'phone_masked', app.loyalty_masked_phone(v_customer.phone),
      'display_name', nullif(btrim(v_customer.name), ''),
      'member_since', to_char((v_membership.joined_at at time zone v_timezone)::date, 'YYYY-MM-DD'),
      'status', v_membership.status,
      'tier_name', null,
      'stamps', v_balance.stamps,
      'stamps_per_card', v_balance.stamps_per_card,
      'stamps_on_card', v_balance.stamps_on_card,
      'cards_completed', v_balance.cards_completed,
      'stamps_pending', greatest(v_balance.pending_stamps, 0),
      'points', v_balance.points,
      'points_pending', greatest(v_balance.pending_points, 0)
    ),
    'today', coalesce((
      select jsonb_agg(v.visit order by v.at, v.id)
      from (
        select c.recorded_at as at, c.id, jsonb_build_object(
          'at', c.recorded_at,
          'path', 'member_code',
          'state', case c.status when 'matched' then 'confirmed' when 'recorded' then 'pending' when 'queued' then 'queued' else 'rejected' end,
          'stamps', coalesce(l.stamp_delta, 0),
          'points', coalesce(l.point_delta, 0),
          'receipt_no', nullif(btrim(i.receipt_no), '')
        ) as visit
        from public.pending_checkins c
        left join public.loyalty_ledger l on l.id = c.matched_entry_id
        left join public.invoices i on i.id = c.matched_invoice_id
        where c.membership_id = v_membership.id
          and c.store_id = p_store_id
          and c.recorded_at is not null
          and c.recorded_at <= p_at
          and app.store_business_date(p_store_id, c.recorded_at) = v_today
        union all
        select l.occurred_at, l.id, jsonb_build_object(
          'at', l.occurred_at,
          'path', case l.matched_path when 'A' then 'phone' when 'C' then 'receipt_claim' when 'D' then 'voucher' when 'E' then 'bill' end,
          'state', case
            when exists (select 1 from public.loyalty_ledger x where x.entry_kind = 'clawback' and x.source_entry_id = l.id) then 'rejected'
            when l.pending and not exists (select 1 from public.loyalty_ledger x where x.entry_kind = 'confirm' and x.source_entry_id = l.id) then 'pending'
            else 'confirmed'
          end,
          'stamps', l.stamp_delta,
          'points', l.point_delta,
          'receipt_no', nullif(btrim(i.receipt_no), '')
        )
        from public.loyalty_ledger l
        left join public.invoices i on i.id = l.invoice_id
        where l.membership_id = v_membership.id
          and l.store_id = p_store_id
          and l.entry_kind = 'earn'
          and l.matched_path <> 'B'
          and l.business_date = v_today
          and l.occurred_at <= p_at
        union all
        select r.created_at, r.id, jsonb_build_object(
          'at', r.created_at,
          'path', 'receipt_claim',
          'state', case r.status when 'queued' then 'queued' else 'pending' end,
          'stamps', 0,
          'points', 0,
          'receipt_no', r.receipt_no
        )
        from public.receipt_claims r
        where r.membership_id = v_membership.id
          and r.store_id = p_store_id
          and r.status in ('pending', 'queued')
          and r.created_at <= p_at
          and app.store_business_date(p_store_id, r.created_at) = v_today
        union all
        select l.occurred_at, l.id, jsonb_build_object(
          'at', l.occurred_at,
          'path', 'manual',
          'state', 'confirmed',
          'stamps', l.stamp_delta,
          'points', l.point_delta,
          'receipt_no', null
        )
        from public.loyalty_ledger l
        where l.membership_id = v_membership.id
          and l.store_id = p_store_id
          and l.entry_kind = 'adjust'
          and l.approved_by is not null
          and l.occurred_at <= p_at
          and app.store_business_date(p_store_id, l.occurred_at) = v_today
      ) v
    ), '[]'::jsonb),
    'adjust_limit_stamps', (select t.loyalty_adjust_max_stamps from public.tenants t where t.id = v_tenant),
    'adjust_limit_points', (select t.loyalty_adjust_max_points from public.tenants t where t.id = v_tenant)
  );
end;
$function$

;

create or replace function app.customer_wallet(p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_membership public.memberships := app.customer_session_membership();
  v_programme public.loyalty_programmes;
  v_customer public.customers;
  v_timezone text;
  v_balance record;
  v_next_expiry timestamptz;
  v_expiring integer;
  v_history jsonb;
  v_claims jsonb;
begin
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_membership.tenant_id;
  select b.* into v_balance from app.loyalty_balance(v_membership.id, p_at) b;

  select min(l.expires_at) into v_next_expiry
  from public.loyalty_ledger l
  where l.membership_id = v_membership.id
    and l.entry_kind in ('earn', 'adjust')
    and l.point_delta > 0
    and l.expires_at > p_at
    and l.occurred_at <= p_at
    and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
    and (not l.pending or exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id));
  if v_next_expiry is not null then
    v_expiring := app.loyalty_expiring_points(
      v_membership.id,
      (((v_next_expiry at time zone v_timezone)::date + 1)::timestamp at time zone v_timezone) - interval '1 microsecond'
    );
  end if;

  select coalesce(jsonb_agg(h.entry order by h.at desc, h.id), '[]'::jsonb)
  into v_history
  from (
    select e.at, e.id, e.entry
    from (
      select
        l.occurred_at as at,
        l.id,
        jsonb_build_object(
          'id', l.id,
          'at', l.occurred_at,
          'kind', case
            when l.entry_kind = 'adjust' and l.reason = 'welcome' and l.approved_by is null and l.invoice_id is null then 'welcome'
            when l.entry_kind = 'clawback' then 'reversal'
            else l.entry_kind::text
          end,
          'state', case
            when exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at) then 'reversed'
            when l.entry_kind = 'redeem' and exists (
              select 1 from public.loyalty_ledger c
              where c.entry_kind = 'adjust' and c.reason = 'redemption_released' and c.source_entry_id = l.id and c.occurred_at <= p_at
            ) then 'reversed'
            when l.pending and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_at) then 'pending'
            else 'confirmed'
          end,
          'stamps', l.stamp_delta,
          'points', l.point_delta,
          'reason', l.reason,
          'store_name', s.name,
          'receipt_no', nullif(btrim(i.receipt_no), ''),
          'matched_path', case
            when l.entry_kind = 'earn' then case l.matched_path when 'A' then 'phone' when 'B' then 'member_code' when 'C' then 'receipt_claim' when 'D' then 'voucher' when 'E' then 'bill' end
            when l.entry_kind = 'adjust' and l.reason = 'welcome' and l.approved_by is null and l.invoice_id is null then 'welcome'
            when l.entry_kind = 'adjust' and l.reason = 'redemption_released' and l.source_entry_id is not null then null
            when l.entry_kind = 'adjust' then 'manual'
          end
        ) as entry
      from public.loyalty_ledger l
      left join public.stores s on s.id = l.store_id
      left join public.invoices i on i.id = l.invoice_id
      where l.membership_id = v_membership.id
        and l.entry_kind <> 'confirm'
        and l.occurred_at <= p_at
    ) e
    order by e.at desc, e.id
    limit 100
  ) h;

  select coalesce(jsonb_agg(k.claim order by k.created_at desc, k.id), '[]'::jsonb)
  into v_claims
  from (
    select
      c.created_at,
      c.id,
      jsonb_build_object(
        'id', c.id,
        'store_name', s.name,
        'receipt_no', c.receipt_no,
        'business_date', to_char(c.business_date, 'YYYY-MM-DD'),
        'submitted_at', c.created_at,
        'state', c.status,
        'reason', c.reason
      ) as claim
    from public.receipt_claims c
    join public.stores s on s.id = c.store_id
    where c.membership_id = v_membership.id
      and c.created_at <= p_at
    order by c.created_at desc, c.id
    limit 50
  ) k;

  return jsonb_build_object(
    'card', jsonb_build_object(
      'programme_name', v_programme.name,
      'display_name', coalesce(nullif(btrim(v_customer.name), ''), 'Thành viên'),
      'phone_masked', '•••• ••• ' || right(coalesce(v_customer.phone, ''), 3),
      'member_since', to_char((v_membership.joined_at at time zone v_timezone)::date, 'YYYY-MM-DD'),
      'purchases', (
        select count(*)::integer
        from public.loyalty_ledger l
        where l.membership_id = v_membership.id
          and l.entry_kind = 'earn'
          and l.occurred_at <= p_at
          and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at)
          and (not l.pending or exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_at))
      )
    ),
    'stamp_cards', jsonb_build_array(
      jsonb_build_object(
        'id', v_membership.id,
        'name', v_programme.name,
        'stamps', greatest(v_balance.stamps_on_card, 0),
        'stamps_per_card', v_programme.stamps_per_card,
        'pending', greatest(v_balance.pending_stamps, 0),
        'expires_on', to_char((v_balance.next_stamp_expiry at time zone v_timezone)::date, 'YYYY-MM-DD')
      )
    ),
    'points', jsonb_build_object(
      'balance', v_balance.points,
      'pending', greatest(v_balance.pending_points, 0),
      'expiring', case
        when coalesce(v_expiring, 0) > 0 then jsonb_build_object('points', v_expiring, 'on', to_char((v_next_expiry at time zone v_timezone)::date, 'YYYY-MM-DD'))
      end
    ),
    'tier', null,
    'marketing_consent', app.has_active_consent(v_membership.tenant_id, 'customer', v_membership.customer_id, 'marketing'),
    'history', v_history,
    'claims', v_claims,
    'claims_today', app.customer_claims_today(v_membership.id, p_at),
    'claims_per_day', v_programme.receipt_claims_per_phone_per_day,
    'bills_to_confirm', app.customer_pending_bills(p_at),
    'deletion_request', app.customer_deletion_request(v_membership.tenant_id, v_membership.customer_id, p_at)
  );
end;
$function$

;

create or replace function app.customer_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_login app.customer_logins := app.customer_session();
  v_app public.zalo_apps;
  v_timezone text;
  v_programme uuid;
begin
  select a.* into v_app from public.zalo_apps a where a.id = v_login.zalo_app_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_login.tenant_id;
  select p.id into v_programme
  from public.loyalty_programmes p
  where p.tenant_id = v_login.tenant_id
    and p.status <> 'draft'
  order by (p.id is not distinct from app.loyalty_active_programme(v_login.tenant_id, (now() at time zone v_timezone)::date)) desc,
    (p.status = 'active') desc, p.starts_on desc, p.id
  limit 1;
  return jsonb_build_object(
    'programme', app.customer_programme(v_programme),
    'oa_id', (select o.external_id from public.oas o where o.brand_id = v_app.brand_id),
    'legal', jsonb_build_object(
      'entity_name', (select t.name from public.tenants t where t.id = v_login.tenant_id),
      'policy_version', (
        select d.version
        from public.legal_documents d
        where d.tenant_id = v_login.tenant_id and d.kind = 'privacy_notice' and d.status = 'published'
        order by d.language <> 'vi', d.language
        limit 1
      ),
      'documents', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'kind', d.kind,
              'language', d.language,
              'version', d.version,
              'title', d.title,
              'body_markdown', d.body_markdown,
              'published_at', d.published_at
            )
            order by d.kind, d.language <> 'vi', d.language
          )
          from public.legal_documents d
          where d.tenant_id = v_login.tenant_id
            and d.status = 'published'
            and d.kind in ('privacy_notice', 'mini_app_terms')
        ),
        '[]'::jsonb
      )
    ),
    'stores', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'code', s.code, 'name', s.name, 'address', nullif(btrim(s.address), ''), 'opening_hours', s.opening_hours,
            'receipt_numbers_reset', app.receipt_numbers_reset(st.tran_no_reset_period, st.receipt_numbers_reset),
            'confirmation', app.loyalty_store_mode(st.id),
            'counter_claims', coalesce((select ls.confirmation = 'staff' and ls.self_claim from public.loyalty_store_settings ls where ls.store_id = st.id), false)
          )
          order by s.name, s.code
        )
        from app.customer_app_stores(v_login.zalo_app_id) s
        join public.stores st on st.id = s.store_id
      ),
      '[]'::jsonb
    ),
    'menu', '[]'::jsonb
  );
end;
$function$

;

create or replace function app.erase_loyalty_membership(p_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_counts jsonb := '{}'::jsonb;
  v_rows integer;
begin
  if not exists (select 1 from public.memberships m where m.id = p_membership_id) then
    raise exception 'erase_loyalty_membership needs an existing membership' using errcode = '22023';
  end if;
  perform set_config('app.loyalty_erasure', 'on', true);
  delete from public.loyalty_queue where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('loyalty_queue', v_rows);
  delete from public.loyalty_refusals where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('loyalty_refusals', v_rows);
  delete from public.stamps where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('stamps', v_rows);
  delete from public.redemptions where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('redemptions', v_rows);
  delete from public.receipt_claims where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('receipt_claims', v_rows);
  delete from public.pending_checkins where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('pending_checkins', v_rows);
  delete from public.loyalty_ledger where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('loyalty_ledger', v_rows);
  delete from public.bill_captures where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('bill_captures', v_rows);
  update public.loyalty_audit_events set membership_id = null where membership_id = p_membership_id;
  delete from public.memberships where id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('memberships', v_rows);
  perform set_config('app.loyalty_erasure', 'off', true);
  return v_counts;
end;
$function$

;


comment on function app.customer_wallet(timestamptz) is 'RPC core (customer session): the member''s card, stamp cards, points, history (path E earns read matched_path bill), receipt claims, the bills waiting for the customer''s blind total (bills_to_confirm, never the staff total) and the deletion request state';
comment on function app.customer_home() is 'RPC core (customer session): programme, OA, legal texts, the stores of the app with their receipt numbering, loyalty confirmation mode (pos_sync or staff) and whether counter claims are open, and the menu';

-- 2. Shadow check against synced invoices (optional, never blocking) ---------------------------------

create function app.loyalty_invoice_billed(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bill_captures b
    where b.invoice_id = p_invoice_id and b.state not in ('rejected', 'expired', 'reversed')
  );
$$;

comment on function app.loyalty_invoice_billed(uuid) is 'whether a live bill of path E is linked to the invoice by the shadow check, so the POS paths never earn the same purchase twice; internal';

create function app.loyalty_shadow_reconcile(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_invoice public.invoices;
  v_state text;
  v_matched integer := 0;
  v_flagged integer := 0;
  v_redemptions integer := 0;
  v_store record;
  v_new_flags jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.loyalty_store_settings s
    where s.tenant_id = p_tenant_id and s.confirmation = 'staff' and s.shadow_reconcile
  ) then
    return '{}'::jsonb;
  end if;
  for v_bill in
    select b.*, s.bill_amount_tolerance as tolerance
    from public.bill_captures b
    join public.loyalty_store_settings s on s.store_id = b.store_id
    where b.tenant_id = p_tenant_id
      and s.confirmation = 'staff'
      and s.shadow_reconcile
      and b.state in ('confirmed', 'awaiting_customer', 'queued')
      and b.shadow_state is null
      and b.business_date between p_from and p_to
      and b.created_at <= p_at - interval '30 minutes'
      and exists (select 1 from public.invoices i where i.store_id = b.store_id and i.business_date = b.business_date)
    order by b.created_at, b.id
  loop
    v_invoice := null;
    select i.* into v_invoice
    from public.invoices i
    where i.store_id = v_bill.store_id
      and i.business_date = v_bill.business_date
      and app.bill_key(i.receipt_no) = v_bill.bill_key
      and not exists (select 1 from public.bill_captures o where o.invoice_id = i.id)
    order by i.sold_at, i.id
    limit 1;
    if v_invoice.id is not null then
      v_state := case when v_invoice.status = 'completed' and abs(v_invoice.net_amount - v_bill.total) <= v_bill.tolerance then 'matched' else 'mismatch' end;
    elsif v_bill.created_at <= p_at - interval '2 hours' then
      v_state := 'no_invoice';
    else
      continue;
    end if;
    update public.bill_captures b
    set shadow_state = v_state, invoice_id = v_invoice.id, shadow_checked_at = p_at
    where b.id = v_bill.id;
    if v_state = 'matched' then
      v_matched := v_matched + 1;
    else
      v_flagged := v_flagged + 1;
      v_new_flags := jsonb_set(v_new_flags, array[v_bill.store_id::text], to_jsonb(coalesce((v_new_flags ->> v_bill.store_id::text)::integer, 0) + 1));
      perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'shadow_flagged', v_bill.id, v_bill.membership_id, v_bill.total,
        jsonb_build_object('shadow_state', v_state), p_at);
    end if;
  end loop;

  with candidates as (
    select r.id as redemption_id, (
      select i.id
      from public.invoices i
      where i.tenant_id = r.tenant_id
        and i.store_id = r.store_id
        and i.status = 'completed'
        and i.sold_at between r.confirmed_at - interval '30 minutes' and r.confirmed_at + interval '30 minutes'
        and (
          (r.pos_discount_name is not null and lower(btrim(i.bill_discount_name)) = lower(btrim(r.pos_discount_name)))
          or (i.voucher_code is not null and upper(btrim(i.voucher_code)) = upper(r.code))
        )
        and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
      order by abs(extract(epoch from i.sold_at - r.confirmed_at)), i.id
      limit 1
    ) as invoice_id
    from public.redemptions r
    join public.loyalty_store_settings s on s.store_id = r.store_id
    where r.tenant_id = p_tenant_id
      and s.confirmation = 'staff'
      and s.shadow_reconcile
      and r.state = 'confirmed'
      and r.confirmed_by is not null
      and r.confirmed_invoice_id is null
      and app.store_business_date(r.store_id, r.confirmed_at) between p_from and p_to
  ),
  linked as (
    update public.redemptions r
    set confirmed_invoice_id = c.invoice_id
    from candidates c
    where r.id = c.redemption_id and c.invoice_id is not null
    returning r.id
  )
  select count(*) into v_redemptions from linked;

  for v_store in select key::uuid as store_id, value::integer as flags from jsonb_each_text(v_new_flags) loop
    perform app.loyalty_staff_alert(p_tenant_id, v_store.store_id, 'shadow_mismatch', v_store.store_id::text,
      jsonb_build_object('new_flags', v_store.flags), p_at);
  end loop;

  return jsonb_build_object('shadow_matched', v_matched, 'shadow_flagged', v_flagged, 'shadow_redemptions_linked', v_redemptions);
end;
$$;

comment on function app.loyalty_shadow_reconcile(uuid, date, date, timestamptz) is 'plan phase 8, optional: at stores in staff mode with shadow_reconcile and synced invoices that day, each unchecked live bill at least 30 minutes old is linked to the synced invoice with its bill number (bill_captures.invoice_id) and marked matched (completed, total within bill_amount_tolerance) or mismatch, or no_invoice after two hours; an empty object for a tenant without such a store; nothing is blocked or reversed, a flag is audited and raises loyalty_staff_anomaly shadow_mismatch (count-only); a staff-confirmed reward is linked to the invoice carrying its discount or code within 30 minutes (confirmed_invoice_id) so the redemption checks cover it; returns counts; service role only';

create or replace function app.reconcile_loyalty(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  v_counts := app.reconcile_loyalty_paths(p_tenant_id, p_from, p_to, p_at);
  if v_counts ? 'skipped' then
    return v_counts;
  end if;
  v_counts := v_counts || app.loyalty_shadow_reconcile(p_tenant_id, p_from, p_to, p_at);
  v_counts := v_counts || app.reconcile_redemptions(p_tenant_id, p_from, p_to, p_at);
  return v_counts || app.reconcile_rails(p_tenant_id, p_from, p_to, p_at);
end;
$$;

comment on function app.reconcile_loyalty(uuid, date, date, timestamptz) is 'the loyalty step after every sync: the matching of paths B and C, the shadow check of staff-mode stores (app.loyalty_shadow_reconcile), the redemption checks and the rail checks; returns their counts';

-- 3. Per-staff anomaly report (plan phase 3) -------------------------------------------------------

create function public.bill_anomaly_report(p_store_ids uuid[], p_from date, p_to date)
returns table (
  store_id uuid,
  business_date date,
  staff_user_id uuid,
  staff_name text,
  bills integer,
  bills_total numeric,
  level0 integer,
  level2 integer,
  confirmed integer,
  queued integer,
  disagreements integer,
  disputes integer,
  timed_out integer,
  reversals integer,
  audits_failed integer,
  redemptions_confirmed integer,
  top_member_share numeric,
  amount_outliers integer,
  max_bills_in_hour integer,
  peer_median_bills numeric,
  flags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_stores uuid[];
begin
  perform app.require_store_ids('bill_anomaly_report', p_store_ids);
  perform app.require_date_range('bill_anomaly_report', p_from, p_to, 92);
  v_stores := array(
    select distinct s.id from unnest(p_store_ids) as s (id)
    where s.id = any (app.current_user_loyalty_manager_store_ids())
  );
  return query
  with bills as (
    select b.id, b.store_id, b.business_date, b.captured_by, b.membership_id, b.total, b.evidence_level, b.state, b.reversal_reason, b.created_at,
      (select c.agrees from public.bill_confirmations c where c.bill_id = b.id and c.source = 'customer') as customer_agrees,
      (select c.agrees from public.bill_confirmations c where c.bill_id = b.id and c.source = 'staff') as staff_agrees
    from public.bill_captures b
    where b.store_id = any (v_stores)
      and b.business_date between p_from and p_to
      and b.state not in ('rejected', 'expired')
  ),
  medians as (
    select x.store_id, percentile_cont(0.5) within group (order by x.total) as median
    from bills x group by x.store_id
  ),
  mads as (
    select x.store_id, m.median, percentile_cont(0.5) within group (order by abs(x.total - m.median)) as mad
    from bills x join medians m on m.store_id = x.store_id
    group by x.store_id, m.median
  ),
  per_staff as (
    select
      x.store_id, x.business_date, x.captured_by,
      count(*)::integer as bills,
      sum(x.total) as bills_total,
      count(*) filter (where x.evidence_level = 0)::integer as level0,
      count(*) filter (where x.evidence_level >= 2)::integer as level2,
      count(*) filter (where x.state = 'confirmed')::integer as confirmed,
      count(*) filter (where x.state = 'queued')::integer as queued,
      count(*) filter (where x.customer_agrees = false or x.staff_agrees = false)::integer as disagreements,
      count(*) filter (where x.reversal_reason = 'disputed')::integer as disputes,
      count(*) filter (where x.reversal_reason = 'timed_out')::integer as timed_out,
      count(*) filter (where x.state = 'reversed')::integer as reversals,
      count(*) filter (where exists (select 1 from public.bill_audits a where a.bill_id = x.id and a.state = 'failed'))::integer as audits_failed,
      count(*) filter (where x.total > d.median + 5 * greatest(d.mad, 1000))::integer as amount_outliers,
      count(distinct date_trunc('hour', x.created_at))::integer as active_hours
    from bills x
    join mads d on d.store_id = x.store_id
    group by x.store_id, x.business_date, x.captured_by
  ),
  member_share as (
    select y.store_id, y.business_date, y.captured_by, max(y.n)::numeric / nullif(sum(y.n), 0) as share
    from (
      select z.store_id, z.business_date, z.captured_by, z.membership_id, count(*) as n
      from bills z group by z.store_id, z.business_date, z.captured_by, z.membership_id
    ) y
    group by y.store_id, y.business_date, y.captured_by
  ),
  hours as (
    select h.store_id, h.business_date, h.captured_by, max(h.n)::integer as max_n
    from (
      select z.store_id, z.business_date, z.captured_by, date_trunc('hour', z.created_at) as hour, count(*) as n
      from bills z group by z.store_id, z.business_date, z.captured_by, date_trunc('hour', z.created_at)
    ) h
    group by h.store_id, h.business_date, h.captured_by
  ),
  rewards as (
    select r.store_id, app.store_business_date(r.store_id, r.confirmed_at) as business_date, r.confirmed_by, count(*)::integer as n
    from public.redemptions r
    where r.store_id = any (v_stores) and r.confirmed_by is not null and r.confirmed_at is not null
    group by r.store_id, app.store_business_date(r.store_id, r.confirmed_at), r.confirmed_by
  ),
  peers as (
    select p.store_id, p.business_date, p.captured_by,
      (select percentile_cont(0.5) within group (order by q.bills) from per_staff q
        where q.store_id = p.store_id and q.business_date = p.business_date
          and q.captured_by is distinct from p.captured_by and q.captured_by is not null) as median
    from per_staff p
  )
  select
    p.store_id, p.business_date, p.captured_by,
    case when p.captured_by is null then null else app.loyalty_requester_name(st.tenant_id, p.captured_by) end,
    p.bills, p.bills_total, p.level0, p.level2, p.confirmed, p.queued, p.disagreements, p.disputes, p.timed_out, p.reversals, p.audits_failed,
    coalesce(rw.n, 0),
    round(ms.share, 3),
    p.amount_outliers,
    h.max_n,
    pe.median::numeric,
    array_remove(array[
      case when pe.median is not null and p.bills >= 10 and p.bills > 2 * pe.median then 'peer_outlier' end,
      case when p.disagreements >= 2 or (p.bills >= 5 and p.disagreements::numeric / p.bills >= 0.2) then 'disagreements' end,
      case when p.disputes >= 1 then 'disputes' end,
      case when p.timed_out >= 3 then 'timeouts' end,
      case when p.bills >= 4 and ms.share >= 0.5 then 'one_member' end,
      case when p.amount_outliers >= 1 then 'amount_outliers' end,
      case when p.audits_failed >= 1 then 'audit_failed' end,
      case when h.max_n >= 6 and h.max_n >= 3 * p.bills::numeric / greatest(p.active_hours, 1) then 'burst' end
    ], null)
  from per_staff p
  join public.stores st on st.id = p.store_id
  left join member_share ms on ms.store_id = p.store_id and ms.business_date = p.business_date and ms.captured_by is not distinct from p.captured_by
  left join hours h on h.store_id = p.store_id and h.business_date = p.business_date and h.captured_by is not distinct from p.captured_by
  left join rewards rw on rw.store_id = p.store_id and rw.business_date = p.business_date and rw.confirmed_by = p.captured_by
  left join peers pe on pe.store_id = p.store_id and pe.business_date = p.business_date and pe.captured_by is not distinct from p.captured_by
  order by p.store_id, p.business_date, p.bills desc, p.captured_by;
end;
$$;

comment on function public.bill_anomaly_report(uuid[], date, date) is 'RPC (plan phase 3): per store, business day and staff member (null: auto-approved counter claims) of the stores the caller owns or manages, at most 92 days: bills recorded and their total, by evidence level and state, disagreements, disputes, timeouts, reversals, failed audits, rewards they confirmed, the share of their bills that went to one member, amount outliers (above the store''s median plus 5 MAD over the range, MAD at least 1,000), the most bills in one clock hour and the median of their peers that day, with flags peer_outlier, disagreements, disputes, timeouts, one_member, amount_outliers, audit_failed and burst; staff names only, never a phone; other stores are left out silently';

revoke all on function public.bill_anomaly_report(uuid[], date, date) from public, anon;
grant execute on function public.bill_anomaly_report(uuid[], date, date) to authenticated, service_role;
revoke all on function app.loyalty_invoice_billed(uuid) from public, anon, authenticated;
grant execute on function app.loyalty_invoice_billed(uuid) to service_role;
revoke all on function app.loyalty_shadow_reconcile(uuid, date, date, timestamptz) from public, anon, authenticated;
grant execute on function app.loyalty_shadow_reconcile(uuid, date, date, timestamptz) to service_role;
