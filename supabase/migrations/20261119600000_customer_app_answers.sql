create or replace function app.customer_programme(p_programme_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'status', p.status,
    'starts_on', to_char(p.starts_on, 'YYYY-MM-DD'),
    'ends_on', to_char(p.ends_on, 'YYYY-MM-DD'),
    'stamps_per_card', p.stamps_per_card,
    'welcome_stamps', p.welcome_stamps,
    'stamp_validity_months', p.stamp_validity_months,
    'points_enabled', p.points_per_unit > 0,
    'points_expiry_months', p.points_expiry_months,
    'receipt_claims_per_day', p.receipt_claims_per_phone_per_day,
    'receipt_claim_window_hours', p.receipt_claim_window_hours,
    'summary', null,
    'stamp_rule', null,
    'points_rule', null,
    'reward_summary', (
      select string_agg(
        format('%s: %s', case when c.cost_stamps > 0 then c.cost_stamps || ' dấu' else c.cost_points || ' điểm' end, c.name),
        '; ' order by c.cost_stamps, c.cost_points, c.name
      )
      from public.coupons c
      where c.programme_id = p.id and c.active
    ),
    'retention_months', null,
    'tiers', '[]'::jsonb
  )
  from public.loyalty_programmes p
  where p.id = p_programme_id;
$$;

comment on function app.customer_programme(uuid) is 'the programme as the customer Mini App reads it: name, status (active, paused or ended as stored; customer_home never returns a draft), period, stamps per card, welcome stamps, stamp validity, whether points are earned and their expiry, the receipt-claim limit and window, the active rewards as the reward summary (null without any), and null for the owner''s own texts, the retention and an empty tier list, which the programme does not hold yet; no amount or price';

create or replace function app.customer_join(
  p_user_id uuid,
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text,
  p_phone text,
  p_loyalty_consent boolean,
  p_marketing_consent boolean,
  p_policy_version text,
  p_screen_version text,
  p_shown_at timestamptz,
  p_store_code text,
  p_channel text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins;
  v_app public.zalo_apps;
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_display_name text := nullif(btrim(p_display_name), '');
  v_store uuid;
  v_existing uuid;
  v_customer uuid;
  v_programme uuid;
  v_timezone text;
  v_already boolean;
  v_membership uuid;
  v_welcome integer := 0;
  v_evidence jsonb;
begin
  select l.* into v_login
  from app.customer_logins l
  where l.user_id = p_user_id and l.zalo_app_id = p_zalo_app_id and l.zalo_user_id = p_zalo_user_id
  for update;
  if v_login.id is null then
    raise exception 'the login is not the customer login of this Zalo user' using errcode = '22023';
  end if;
  select a.* into v_app from public.zalo_apps a where a.id = p_zalo_app_id;
  if v_app.status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_channel is distinct from 'mini_app' then
    raise exception 'a customer joins through the channel mini_app' using errcode = '22023';
  end if;
  if p_marketing_consent is null or p_at is null then
    raise exception 'a join states the marketing toggle and its time' using errcode = '22023';
  end if;
  if p_screen_version is null or p_screen_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
    or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
  then
    raise exception 'the screen and policy versions are 1 to 40 of a-z, 0-9, . and -' using errcode = '22023';
  end if;
  if p_shown_at is null or p_shown_at > p_at + interval '5 minutes' then
    raise exception 'the purpose screen was shown before the join' using errcode = '22023';
  end if;
  if p_loyalty_consent is not true then
    return jsonb_build_object('status', 'refused', 'reason', 'consent_required');
  end if;
  if not exists (
    select 1 from public.legal_documents d
    where d.tenant_id = v_login.tenant_id
      and d.kind = 'privacy_notice'
      and d.status = 'published'
      and d.version = p_policy_version
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'policy_outdated');
  end if;
  if p_store_code is not null then
    v_store := app.customer_app_store(p_zalo_app_id, p_store_code);
    if v_store is null then
      return jsonb_build_object('status', 'refused', 'reason', 'unknown_store');
    end if;
  end if;
  if v_phone is null then
    raise exception 'the phone number does not read in E.164 form' using errcode = '22023';
  end if;
  if v_display_name is not null and (char_length(v_display_name) > 100 or v_display_name ~ '[[:cntrl:]]') then
    v_display_name := null;
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = v_login.tenant_id;
  v_programme := app.loyalty_active_programme(v_login.tenant_id, (p_at at time zone v_timezone)::date);
  if v_programme is null then
    return jsonb_build_object('status', 'refused', 'reason', 'no_programme');
  end if;

  select c.id into v_existing
  from public.customers c
  where c.tenant_id = v_login.tenant_id
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by (c.phone = v_phone) desc, c.first_seen_at, c.id
  limit 1;
  if v_existing is not null and (
    exists (
      select 1 from app.customer_logins l
      where l.zalo_app_id = p_zalo_app_id and l.customer_id = v_existing and l.user_id <> p_user_id
    )
    or exists (
      select 1 from public.memberships m
      where m.customer_id = v_existing
        and m.brand_id = v_app.brand_id
        and m.zalo_user_id is not null
        and m.zalo_user_id <> p_zalo_user_id
    )
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'phone_in_use');
  end if;

  v_customer := app.loyalty_customer_for_phone(v_login.tenant_id, v_phone, p_at);
  update public.customers c
  set name = coalesce(nullif(btrim(c.name), ''), v_display_name),
      last_seen_at = greatest(c.last_seen_at, p_at)
  where c.id = v_customer;
  if v_login.customer_id is not null and v_login.customer_id <> v_customer then
    update public.memberships m
    set zalo_user_id = null
    where m.customer_id = v_login.customer_id
      and m.brand_id = v_app.brand_id
      and m.zalo_user_id = p_zalo_user_id;
  end if;

  v_already := exists (select 1 from public.memberships m where m.programme_id = v_programme and m.customer_id = v_customer);
  v_membership := app.loyalty_join(v_login.tenant_id, v_customer, 'mini_app', v_store, v_app.brand_id, p_zalo_user_id, p_at);
  if not v_already then
    select coalesce(sum(l.stamp_delta), 0)::integer into v_welcome
    from public.loyalty_ledger l
    where l.membership_id = v_membership
      and l.entry_kind = 'adjust'
      and l.reason = 'welcome'
      and l.approved_by is null;
  end if;

  v_evidence := jsonb_build_object(
    'screen_version', p_screen_version,
    'shown_at', p_shown_at,
    'accepted_at', p_at,
    'channel', 'mini_app',
    'zalo_app_id', p_zalo_app_id,
    'store_id', v_store
  );
  perform app.customer_record_consent(
    v_login.tenant_id, v_customer, 'loyalty', p_policy_version,
    v_evidence || jsonb_build_object('toggle', 'loyalty', 'ticked', true, 'marketing_ticked', p_marketing_consent),
    p_at
  );
  if p_marketing_consent then
    perform app.customer_record_consent(
      v_login.tenant_id, v_customer, 'marketing', p_policy_version,
      v_evidence || jsonb_build_object('toggle', 'marketing', 'ticked', true),
      p_at
    );
  end if;

  update app.customer_logins l set customer_id = v_customer where l.id = v_login.id;
  return jsonb_build_object(
    'status', 'joined',
    'customer_id', v_customer,
    'membership_id', v_membership,
    'welcome_stamps', v_welcome,
    'already_member', v_already
  );
end;
$$;

comment on function app.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text, timestamptz) is 'the join of the customer Mini App after zalo-phone decoded the phone token: refuses consent_required (no loyalty consent), policy_outdated (not a published privacy_notice version of the tenant), unknown_store, no_programme (no active programme covers the tenant''s today: none, paused, ended or outside its period; nothing is written) and phone_in_use (the phone''s customer belongs to another Zalo user of the brand); otherwise finds or creates the customer by its E.164 phone (the Zalo display name kept when the customer has no name), enrols it in the active programme through app.loyalty_join with the welcome stamps, records the loyalty consent and, only when its toggle was ticked, the marketing consent, each with its evidence, and binds the customer to the login; 22023 for malformed input';

create or replace function app.customer_wallet(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
            when l.entry_kind = 'earn' then case l.matched_path when 'A' then 'phone' when 'B' then 'member_code' when 'C' then 'receipt_claim' when 'D' then 'voucher' end
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
    'claims_per_day', v_programme.receipt_claims_per_phone_per_day
  );
end;
$$;

comment on function app.customer_wallet(timestamptz) is 'the wallet of a joined customer session from the ledger: the member card of FR-CMP-19 (programme name, display name, masked phone, member since and the confirmed purchases not reversed), one stamp card from app.loyalty_balance (the stamps on the current card, the pending stamps and the date of the next stamp expiry), the points balance with the pending points and the points that expire on the next expiry day (first in first out, by the tenant''s local date), no tier yet, the marketing consent, the latest 100 ledger rows other than confirm rows (kind welcome, earn, redeem, adjust, expire or reversal; state pending (an earn or redemption hold without its confirm), confirmed (a redemption hold once the synced invoice confirmed it), or reversed (an earn a clawback points at, or a redemption hold given back by its redemption_released adjust row); the ledger reason; matched path phone, member_code, receipt_claim, voucher, welcome or manual, and null for the redemption_released row, which the app words itself) and the latest 50 receipt claims with their status and reason as stored, with the claims of today and the daily limit; 42501 for a visitor and every other caller';
