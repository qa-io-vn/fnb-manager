create function app.customer_claims_today(p_membership_id uuid, p_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.receipt_claims c
  where c.membership_id = p_membership_id
    and app.store_business_date(c.store_id, c.created_at) = app.store_business_date(c.store_id, p_at);
$$;

comment on function app.customer_claims_today(uuid, timestamptz) is 'the receipt claims a membership submitted on the current business day of each claim''s store, refused ones included, as app.loyalty_submit_claim counts them against receipt_claims_per_phone_per_day';

create function app.customer_wallet(p_at timestamptz default now())
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

comment on function app.customer_wallet(timestamptz) is 'the wallet of a joined customer session from the ledger: the member card of FR-CMP-19 (programme name, display name, masked phone, member since and the confirmed purchases not reversed), one stamp card from app.loyalty_balance (the stamps on the current card, the pending stamps and the date of the next stamp expiry), the points balance with the pending points and the points that expire on the next expiry day (first in first out, by the tenant''s local date), no tier yet, the marketing consent, the latest 100 ledger rows other than confirm rows (kind welcome, earn, redeem, adjust, expire or reversal; state pending, confirmed or reversed; the ledger reason; matched path phone, member_code, receipt_claim, voucher, welcome or manual) and the latest 50 receipt claims with their status and reason as stored, with the claims of today and the daily limit; 42501 for a visitor and every other caller';

create function app.customer_member_code(p_store text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_store uuid;
  v_store_code text;
  v_store_name text;
  v_live public.pending_checkins;
  v_code text;
  v_issued timestamptz;
  v_expires timestamptz;
begin
  if v_membership.status <> 'active' then
    raise exception 'the membership is not active' using errcode = '42501';
  end if;
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  if not exists (select 1 from public.loyalty_programmes p where p.id = v_membership.programme_id and p.status = 'active') then
    raise exception 'the programme is not active' using errcode = '22023';
  end if;
  select s.code, s.name into v_store_code, v_store_name from app.customer_app_stores(v_login.zalo_app_id) s where s.store_id = v_store;
  select c.* into v_live
  from public.pending_checkins c
  where c.membership_id = v_membership.id
    and c.store_id = v_store
    and c.status = 'issued'
    and c.created_at > p_at - interval '30 seconds'
    and c.created_at <= p_at
    and c.expires_at > p_at + interval '60 seconds'
  order by c.created_at desc
  limit 1;
  if v_live.id is not null then
    v_code := v_live.code;
    v_issued := v_live.created_at;
    v_expires := v_live.expires_at;
  else
    select i.code, p_at, i.expires_at into v_code, v_issued, v_expires
    from app.loyalty_issue_checkin_code(v_membership.id, v_store, p_at) i;
  end if;
  return jsonb_build_object(
    'code', v_code,
    'qr_payload', 'fnb-member:1:' || v_store_code || ':' || v_code,
    'store_code', v_store_code,
    'store_name', v_store_name,
    'issued_at', v_issued,
    'refresh_at', least(v_issued + interval '60 seconds', v_expires),
    'expires_at', v_expires
  );
end;
$$;

comment on function app.customer_member_code(text, timestamptz) is 'the dynamic member code of a joined customer at a store of the app''s brand: a 6-digit check-in code from app.loyalty_issue_checkin_code bound to the store, valid for the programme''s checkin_code_ttl_seconds (120 by default) and to be refreshed after 60 seconds, with the QR payload fnb-member:1:<store link key>:<code>; a call within 30 seconds of the last code answers that code again; 42501 for a visitor or an inactive membership, 22023 for a store the app does not offer or a programme that is not active';

create function app.customer_submit_claim(
  p_store text,
  p_receipt_no text,
  p_amount numeric,
  p_business_date date default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_cap integer;
  v_store uuid;
  v_receipt text := btrim(p_receipt_no);
  v_result record;
begin
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  if v_receipt is null or char_length(v_receipt) not between 1 and 40 or v_receipt ~ '[[:space:][:cntrl:]]' then
    raise exception 'a receipt number holds 1 to 40 characters without spaces' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'a claimed amount is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  select p.receipt_claims_per_phone_per_day into v_cap from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select r.* into v_result
  from app.loyalty_submit_claim(v_membership.id, v_store, coalesce(p_business_date, app.store_business_date(v_store, p_at)), v_receipt, p_amount, p_at) r;
  return jsonb_build_object(
    'claim_id', v_result.claim_id,
    'state', v_result.status,
    'reason', v_result.reason,
    'claims_left_today', greatest(v_cap - app.customer_claims_today(v_membership.id, p_at), 0)
  );
end;
$$;

comment on function app.customer_submit_claim(text, text, numeric, date, timestamptz) is 'Nhận điểm từ hóa đơn: a joined customer''s receipt claim at a store of the app''s brand through app.loyalty_submit_claim, which matches it at once when the invoice is synced and otherwise leaves it pending and requests a fast-lane run (a request only; no POS call); the business date defaults to the store''s today; its refusals (the daily limit of receipt_claims_per_phone_per_day among them) are answered with the stored status and reason, not raised; returns {claim_id, state, reason, claims_left_today}; 22023 for a store the app does not offer, a receipt number outside 1 to 40 characters without spaces or an amount outside 0 to 100,000,000; 42501 for a visitor and every other caller';

create function public.customer_wallet()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.customer_wallet(now());
$$;

comment on function public.customer_wallet() is 'RPC for the customer Mini App: app.customer_wallet at the current time';

create function public.customer_member_code(p_store text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.customer_member_code(p_store, now());
$$;

comment on function public.customer_member_code(text) is 'RPC for the customer Mini App: app.customer_member_code at the current time';

create function public.customer_submit_claim(p_store text, p_receipt_no text, p_amount numeric, p_business_date date default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.customer_submit_claim(p_store, p_receipt_no, p_amount, p_business_date, now());
$$;

comment on function public.customer_submit_claim(text, text, numeric, date) is 'RPC for the customer Mini App: app.customer_submit_claim at the current time';

revoke all on function app.customer_claims_today(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_wallet(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_member_code(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_submit_claim(text, text, numeric, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.customer_wallet() from public, anon, service_role;
revoke all on function public.customer_member_code(text) from public, anon, service_role;
revoke all on function public.customer_submit_claim(text, text, numeric, date) from public, anon, service_role;

grant execute on function public.customer_wallet() to authenticated;
grant execute on function public.customer_member_code(text) to authenticated;
grant execute on function public.customer_submit_claim(text, text, numeric, date) to authenticated;
