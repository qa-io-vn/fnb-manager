-- G-92: a customer whose answer was lost on the way back (the phone went to sleep, the network dropped) and who sends
-- it again now gets the first answer's outcome back instead of a refusal, and the wallet lists the counter claims.
--
--   * bill_confirmations.answered_state keeps the outcome the customer was given for their answer: the state of the
--     bill right after the blind total (confirmed, queued or still waiting), or right after a counter claim
--     (awaiting_staff, or confirmed when approved at once).
--   * app.customer_confirm_bill: a second answer to a bill the customer already answered returns that first outcome
--     with replayed true, whatever total is typed the second time (the first answer stands, and the second call learns
--     nothing new about the staff member's total). A bill answered before this migration, or one the customer
--     disputed, still answers already_answered.
--   * app.customer_dispute_bill: a second dispute of a bill the customer disputed returns reversed with replayed true.
--   * app.customer_submit_counter_claim: the same bill number sent again with the same counter QR returns the first
--     outcome with replayed true (bill id, deadline, stamps and points earned), even once the QR has expired; another
--     bill number with that QR is still refused with code_used.
--   * app.customer_wallet gains counter_claims (app.customer_counter_claims): the member's counter claims still
--     waiting, and those sent in the last 7 days, with their state; never a total.

alter table public.bill_confirmations
  add column answered_state text check (answered_state in ('awaiting_customer', 'awaiting_staff', 'queued', 'confirmed')),
  add constraint bill_confirmations_answered_state_customer check (answered_state is null or source = 'customer');

comment on column public.bill_confirmations.answered_state is 'for the customer''s reading only: the outcome the customer was given for it (the bill''s state right after the answer), returned again when the same answer is sent twice (G-92); null for staff and reader rows and for customer rows written before migration customer_bill_answer_replay';

create or replace function app.customer_confirm_bill(p_bill_id uuid, p_total numeric, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := app.customer_session_membership();
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
  v_answer public.bill_confirmations;
  v_state text;
  v_agrees boolean;
begin
  if p_total is null or p_total <= 0 or p_total > 100000000 then
    raise exception 'a bill total is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id and b.membership_id = v_membership.id for update;
  if v_bill.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_bill');
  end if;
  select c.* into v_answer from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'customer';
  if v_answer.id is not null and v_answer.answered_state is not null then
    -- the same customer answering again (a lost answer): the first answer's outcome, not a refusal
    return jsonb_build_object('state', v_answer.answered_state, 'refusal', null, 'evidence_level', v_bill.evidence_level, 'replayed', true);
  end if;
  if v_bill.state <> 'awaiting_customer' or v_answer.id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_answered');
  end if;
  if v_bill.confirm_by <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'too_late');
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  v_agrees := abs(v_bill.total - p_total) <= v_settings.bill_amount_tolerance;
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at)
  values (v_bill.tenant_id, p_bill_id, 'customer', p_total, v_agrees, (select auth.uid()), p_at)
  returning * into v_answer;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'bill_answered', p_bill_id, v_bill.membership_id, p_total,
    jsonb_build_object('agrees', v_agrees), p_at);
  v_state := app.bill_evaluate(p_bill_id, null, p_at);
  update public.bill_confirmations c set answered_state = v_state where c.id = v_answer.id;
  return jsonb_build_object(
    'state', v_state,
    'refusal', null,
    'evidence_level', (select b.evidence_level from public.bill_captures b where b.id = p_bill_id),
    'replayed', false
  );
end;
$$;

comment on function app.customer_confirm_bill(uuid, numeric, timestamptz) is 'RPC core (customer session, plan phase 2): the customer types the total they paid for one of their bills waiting for them, without seeing the staff total; one answer per bill; agreeing within bill_amount_tolerance gives level 2 (confirmed at once unless the bill needs a manager), disagreeing queues it (disagreement); the outcome is kept in bill_confirmations.answered_state, and the same customer answering the bill again (a lost answer) gets that first outcome back with replayed true, whatever total they type (G-92). Refusals unknown_bill (not a bill of this member: no existence oracle), already_answered (disputed, or answered before answered_state existed) and too_late; audited; 22023 for a total out of range';

create or replace function app.customer_dispute_bill(p_bill_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := app.customer_session_membership();
  v_bill public.bill_captures;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id and b.membership_id = v_membership.id for update;
  if v_bill.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_bill');
  end if;
  if v_bill.state = 'reversed' and v_bill.reversal_reason = 'disputed' then
    -- only the customer disputes a bill, so this is the customer's own dispute sent again (a lost answer)
    return jsonb_build_object('state', 'reversed', 'refusal', null, 'replayed', true);
  end if;
  if v_bill.state <> 'awaiting_customer'
    or exists (select 1 from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'customer')
  then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_answered');
  end if;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'bill_disputed', p_bill_id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
  perform app.bill_reverse(p_bill_id, 'disputed', null, p_at);
  return jsonb_build_object('state', 'reversed', 'refusal', null, 'replayed', false);
end;
$$;

comment on function app.customer_dispute_bill(uuid, timestamptz) is 'RPC core (customer session): "Không đúng" on a bill waiting for the customer: the bill is reversed (disputed), the earn clawed back, and loyalty_staff_anomaly raised for the staff member who recorded it; the same dispute sent again (a lost answer) answers reversed with replayed true (G-92); refusals unknown_bill and already_answered (the bill was answered with a total, or is no longer waiting)';

create or replace function app.customer_submit_counter_claim(p_qr text, p_bill_no text, p_total numeric, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_uid uuid := (select auth.uid());
  v_raw text := btrim(p_qr);
  v_bill_no text := btrim(p_bill_no);
  v_store_code text;
  v_token text;
  v_code public.loyalty_counter_codes;
  v_settings public.loyalty_store_settings;
  v_today date;
  v_locked timestamptz;
  v_refusal text;
  v_bill uuid;
  v_earn public.loyalty_ledger;
  v_first public.bill_captures;
  v_first_state text;
begin
  if v_raw is null or v_raw !~ '^fnb-counter:1:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-HJ-NP-Z2-9]{12}$' then
    raise exception 'a counter QR reads fnb-counter:1:<store code>:<12 characters>' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 or p_total > 100000000 then
    raise exception 'a bill total is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  if v_bill_no is null or char_length(v_bill_no) not between 1 and 40 or v_bill_no ~ '[[:space:][:cntrl:]]' then
    raise exception 'a bill number holds 1 to 40 characters without spaces' using errcode = '22023';
  end if;
  v_store_code := split_part(v_raw, ':', 3);
  v_token := split_part(v_raw, ':', 4);

  v_locked := app.code_attempt_gate('customer_counter_claim', v_membership.tenant_id, null, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'locked', 'bill_id', null, 'retry_at', v_locked);
  end if;
  select c.* into v_code from public.loyalty_counter_codes c where c.token = v_token and c.tenant_id = v_membership.tenant_id;
  if v_code.id is null
    or app.customer_app_store(v_login.zalo_app_id, v_store_code) is distinct from v_code.store_id
  then
    perform app.code_attempt_record('customer_counter_claim', v_membership.tenant_id, null, v_uid, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', case when v_code.id is null then 'code_unknown' else 'wrong_store' end, 'bill_id', null);
  end if;

  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_code.store_id;
  v_today := app.store_business_date(v_code.store_id, p_at);
  perform pg_advisory_xact_lock(hashtextextended('fnb-bill:' || v_code.store_id::text, 0));
  -- the same bill sent again with the same QR (a lost answer, or a second tap while the first was on its way): the
  -- first outcome, even once the QR has expired; under the store lock, so a parallel second call waits for the first
  select b.* into v_first
  from public.bill_captures b
  where b.membership_id = v_membership.id and b.counter_code_id = v_code.id and b.bill_key = app.bill_key(v_bill_no);
  if v_first.id is not null then
    select c.answered_state into v_first_state from public.bill_confirmations c where c.bill_id = v_first.id and c.source = 'customer';
  end if;
  if v_first_state = 'confirmed' then
    select l.* into v_earn from public.loyalty_ledger l where l.bill_id = v_first.id and l.entry_kind = 'earn';
    return jsonb_build_object('state', 'confirmed', 'refusal', null, 'bill_id', v_first.id, 'evidence_level', v_first.evidence_level,
      'stamps_earned', v_earn.stamp_delta, 'points_earned', v_earn.point_delta, 'replayed', true);
  elsif v_first_state = 'awaiting_staff' then
    return jsonb_build_object('state', 'awaiting_staff', 'refusal', null, 'bill_id', v_first.id, 'evidence_level', v_first.evidence_level,
      'expires_at', v_first.confirm_by, 'replayed', true);
  end if;
  if v_settings.confirmation is distinct from 'staff' or not v_settings.self_claim then
    v_refusal := 'not_available';
  elsif p_at < v_code.issued_at or p_at > v_code.expires_at + app.counter_claim_grace() then
    v_refusal := 'code_expired';
  elsif exists (select 1 from public.bill_captures b where b.membership_id = v_membership.id and b.counter_code_id = v_code.id) then
    v_refusal := 'code_used';
  elsif (
    select count(*) from public.bill_captures b
    where b.membership_id = v_membership.id and b.source = 'counter_claim' and b.business_date = v_today
  ) >= (select p.receipt_claims_per_phone_per_day from public.loyalty_programmes p where p.id = v_membership.programme_id) then
    v_refusal := 'daily_limit';
  else
    v_refusal := app.bill_precheck(v_code.store_id, v_membership.id, v_bill_no, p_total, null, null, p_at);
  end if;
  if v_refusal is not null then
    perform app.loyalty_audit(v_membership.tenant_id, v_code.store_id, null, 'bill_refused', null, v_membership.id, p_total,
      jsonb_build_object('refusal', v_refusal, 'source', 'counter_claim'), p_at);
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal, 'bill_id', null);
  end if;

  insert into public.bill_captures (tenant_id, store_id, membership_id, source, counter_code_id, business_date, bill_no, bill_key, total, state, confirm_by, created_at)
  values (v_membership.tenant_id, v_code.store_id, v_membership.id, 'counter_claim', v_code.id, v_today, v_bill_no, app.bill_key(v_bill_no), p_total,
    'awaiting_staff', p_at + interval '6 hours', p_at)
  returning id into v_bill;
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at, answered_state)
  values (v_membership.tenant_id, v_bill, 'customer', p_total, true, v_uid, p_at, 'awaiting_staff');
  perform app.loyalty_audit(v_membership.tenant_id, v_code.store_id, null, 'bill_recorded', v_bill, v_membership.id, p_total,
    jsonb_build_object('source', 'counter_claim'), p_at);

  if v_settings.auto_approve_max_amount > 0
    and p_total <= v_settings.auto_approve_max_amount
    and (
      select count(*) from public.bill_captures b
      where b.store_id = v_code.store_id and b.business_date = v_today and b.auto_approved
    ) < v_settings.auto_approve_per_day
  then
    perform app.bill_confirm(v_bill, null, p_at);
    update public.bill_captures b set auto_approved = true where b.id = v_bill;
    update public.bill_confirmations c set answered_state = 'confirmed' where c.bill_id = v_bill and c.source = 'customer';
    select l.* into v_earn from public.loyalty_ledger l where l.bill_id = v_bill and l.entry_kind = 'earn';
    return jsonb_build_object('state', 'confirmed', 'refusal', null, 'bill_id', v_bill, 'evidence_level', 0,
      'stamps_earned', v_earn.stamp_delta, 'points_earned', v_earn.point_delta, 'replayed', false);
  end if;
  return jsonb_build_object('state', 'awaiting_staff', 'refusal', null, 'bill_id', v_bill, 'evidence_level', 0, 'expires_at', p_at + interval '6 hours', 'replayed', false);
end;
$$;

comment on function app.customer_submit_counter_claim(text, text, numeric, timestamptz) is 'RPC core (customer session): a claim with the counter QR of a store in staff mode with self claims, the bill number and the total paid (the customer''s reading). Refuses locked (code-guessing limit), code_unknown, wrong_store (a QR of a store outside the customer''s app), not_available, code_expired (issued later than now, or more than 120 seconds past its expiry: no remote claims), code_used (one claim per member and QR; the same bill number sent again with that QR, as after a lost answer, returns the first outcome with replayed true instead, even after the QR expired, G-92), daily_limit (receipt_claims_per_phone_per_day counter claims a day) or a refusal of app.bill_precheck (dedupe, conflict alert, caps). Otherwise the bill waits 6 hours for a staff member''s blind total (awaiting_staff), or is confirmed at once at level 0 when the total is within auto_approve_max_amount and the store''s auto_approve_per_day is not used up; audited; 22023 for a malformed QR, number or total';

create function app.customer_counter_claims(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := app.customer_session_membership();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', recent.id,
      'store_name', recent.store_name,
      'bill_no', recent.bill_no,
      'submitted_at', recent.created_at,
      'state', recent.state,
      'waiting_until', case when recent.state = 'awaiting_staff' then recent.confirm_by end,
      'decided_at', case when recent.state not in ('awaiting_staff', 'queued') then coalesce(recent.reversed_at, recent.confirmed_at, recent.decided_at) end
    ) order by recent.created_at desc, recent.id)
    from (
      select b.id, s.name as store_name, b.bill_no, b.created_at, b.state, b.confirm_by, b.reversed_at, b.confirmed_at, b.decided_at
      from public.bill_captures b
      join public.stores s on s.id = b.store_id
      where b.membership_id = v_membership.id
        and b.source = 'counter_claim'
        and b.created_at <= p_at
        and (b.state in ('awaiting_staff', 'queued') or b.created_at > p_at - interval '7 days')
      order by b.created_at desc, b.id
      limit 20
    ) as recent
  ), '[]'::jsonb);
end;
$$;

comment on function app.customer_counter_claims(timestamptz) is 'RPC core (customer session, G-92): the member''s counter claims still waiting for a staff member or a manager, and the others sent in the 7 days before the moment, newest first, at most 20: store name, bill number, when it was sent, the bill''s state, until when it waits for the staff (awaiting_staff) and when it was decided; never a total';

revoke all on function app.customer_counter_claims(timestamptz) from public, anon, authenticated;
grant execute on function app.customer_counter_claims(timestamptz) to service_role;

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

  -- ADR-047: the next instant at which credits end, a confirmed pending earn with the expiry of its confirm
  -- row (ADR-046), a credit a clawback took whole left out; the points ending then are those expiring by
  -- that instant less those already ended (out of the balance before their expire row is written)
  select min(case when l.pending then coalesce(f.expires_at, l.expires_at) else l.expires_at end) into v_next_expiry
  from public.loyalty_ledger l
  left join public.loyalty_ledger f on l.pending and f.entry_kind = 'confirm' and f.source_entry_id = l.id and f.occurred_at <= p_at
  where l.membership_id = v_membership.id
    and l.entry_kind in ('earn', 'adjust')
    and l.point_delta > 0
    and l.reason is distinct from 'redemption_released'
    and l.occurred_at <= p_at
    and (not l.pending or f.id is not null)
    and (case when l.pending then coalesce(f.expires_at, l.expires_at) else l.expires_at end) > p_at
    and l.point_delta + coalesce((
      select sum(c.point_delta) from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at
    ), 0) > 0;
  if v_next_expiry is not null then
    v_expiring := app.loyalty_expiring_points(v_membership.id, v_next_expiry) - app.loyalty_expiring_points(v_membership.id, p_at);
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
        -- ADR-047: the last day the next stamp to end is valid (the local date of the last moment before its
        -- expires_at), under the old key too, and the instant
        'expires_on', to_char(((v_balance.next_stamp_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
        'valid_through', to_char(((v_balance.next_stamp_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
        'expires_at', v_balance.next_stamp_expiry
      )
    ),
    'points', jsonb_build_object(
      'balance', greatest(v_balance.points, 0),
      'pending', greatest(v_balance.pending_points, 0),
      'expiring', case
        when coalesce(v_expiring, 0) > 0 then jsonb_build_object(
          'points', v_expiring,
          'on', to_char(((v_next_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
          'valid_through', to_char(((v_next_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
          'expires_at', v_next_expiry
        )
      end
    ),
    'tier', null,
    'marketing_consent', app.has_active_consent(v_membership.tenant_id, 'customer', v_membership.customer_id, 'marketing'),
    'history', v_history,
    'claims', v_claims,
    'claims_today', app.customer_claims_today(v_membership.id, p_at),
    'claims_per_day', v_programme.receipt_claims_per_phone_per_day,
    'bills_to_confirm', app.customer_pending_bills(p_at),
    'counter_claims', app.customer_counter_claims(p_at),
    'deletion_request', app.customer_deletion_request(v_membership.tenant_id, v_membership.customer_id, p_at)
  );
end;
$function$

;

comment on function app.customer_wallet(timestamptz) is 'RPC core (customer session): the member''s card, stamp cards, points, history (path E earns read matched_path bill), receipt claims, the bills waiting for the customer''s blind total (bills_to_confirm, never the staff total), the counter claims waiting or sent in the last 7 days (counter_claims, never a total; G-92) and the deletion request state; balances at the moment (ADR-047: a credit past its expiry is out before the nightly run writes its row), the points balance never below zero (greatest(0, ...), ADR-046); the stamp card and the next expiring points give the last valid day as valid_through (also under the old keys expires_on and on) and the instant as expires_at, the points being those that end at that instant';
