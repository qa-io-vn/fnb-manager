create function app.customer_deletion_answer(p_request public.data_subject_requests)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_request.id is not null then jsonb_build_object(
    'request_id', p_request.id,
    'status', p_request.status,
    'requested_at', p_request.received_at,
    'first_response_due_at', p_request.first_response_due_at,
    'completion_due_at', p_request.completion_due_at
  ) end;
$$;

comment on function app.customer_deletion_answer(public.data_subject_requests) is 'a deletion request as the customer Mini App reads it: {request_id, status, requested_at (received_at), first_response_due_at, completion_due_at}, the deadlines as the ledger''s trigger filled them; null for no request';

create function app.customer_deletion_request(p_tenant_id uuid, p_customer_id uuid, p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.customer_deletion_answer(r)
  from public.data_subject_requests r
  where r.tenant_id = p_tenant_id
    and r.subject_type = 'customer'
    and r.subject_id = p_customer_id
    and r.request_type = 'deletion'
    and r.received_at <= p_at
  order by (r.status in ('received', 'in_progress')) desc, r.received_at desc, r.id
  limit 1;
$$;

comment on function app.customer_deletion_request(uuid, uuid, timestamptz) is 'the deletion request of a customer that the customer Mini App shows, as app.customer_deletion_answer: the open one (received or in_progress), else the latest received by p_at whatever its status (a rejected one, so the app can offer a new request), else null; read only';

create or replace function app.customer_request_deletion(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_customer uuid := app.customer_session_customer();
  v_request public.data_subject_requests;
begin
  select r.* into v_request
  from public.data_subject_requests r
  where r.tenant_id = v_login.tenant_id
    and r.subject_type = 'customer'
    and r.subject_id = v_customer
    and r.request_type = 'deletion'
    and r.status in ('received', 'in_progress')
  order by r.received_at desc
  limit 1;
  if v_request.id is null then
    insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
    values (v_login.tenant_id, 'customer', v_customer, 'mini_app', 'deletion', p_at)
    returning * into v_request;
  end if;
  return app.customer_deletion_answer(v_request);
end;
$$;

comment on function app.customer_request_deletion(timestamptz) is 'records the joined customer''s request to delete their data in data_subject_requests (subject customer, contact mini_app, deadlines filled by the ledger''s trigger) and answers it as app.customer_deletion_answer, with both deadlines; an open deletion request of the customer is answered again instead of a second one; an owner then carries it out with dsr_delete; 42501 for a visitor and every other caller';

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
    'claims_per_day', v_programme.receipt_claims_per_phone_per_day,
    'deletion_request', app.customer_deletion_request(v_membership.tenant_id, v_membership.customer_id, p_at)
  );
end;
$$;

comment on function app.customer_wallet(timestamptz) is 'the wallet of a joined customer session from the ledger: the member card of FR-CMP-19 (programme name, display name, masked phone, member since and the confirmed purchases not reversed), one stamp card from app.loyalty_balance (the stamps on the current card, the pending stamps and the date of the next stamp expiry), the points balance with the pending points and the points that expire on the next expiry day (first in first out, by the tenant''s local date), no tier yet, the marketing consent, the latest 100 ledger rows other than confirm rows (kind welcome, earn, redeem, adjust, expire or reversal; state pending (an earn or redemption hold without its confirm), confirmed (a redemption hold once the synced invoice confirmed it), or reversed (an earn a clawback points at, or a redemption hold given back by its redemption_released adjust row); the ledger reason; matched path phone, member_code, receipt_claim, voucher, welcome or manual, and null for the redemption_released row, which the app words itself), the latest 50 receipt claims with their status and reason as stored, with the claims of today and the daily limit, and the customer''s deletion request as app.customer_deletion_request (the open one, else the latest, with both deadlines; null without any); 42501 for a visitor and every other caller';

revoke all on function app.customer_deletion_answer(public.data_subject_requests) from public, anon, authenticated, service_role;
revoke all on function app.customer_deletion_request(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
