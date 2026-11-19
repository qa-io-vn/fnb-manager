create type public.loyalty_queue_state as enum ('open', 'resolved', 'dismissed');

create table public.loyalty_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  checkin_id uuid,
  claim_id uuid,
  matched_path text not null check (matched_path in ('B', 'C')),
  candidate_invoice_ids uuid[] not null check (cardinality(candidate_invoice_ids) between 2 and 20 and array_position(candidate_invoice_ids, null) is null),
  reason text not null check (reason in ('two_candidates', 'duplicate_receipt')),
  state public.loyalty_queue_state not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  chosen_invoice_id uuid,
  resolution_reason text check (resolution_reason is null or (char_length(resolution_reason) between 1 and 200 and resolution_reason !~ '[[:cntrl:]]')),
  entry_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, checkin_id) references public.pending_checkins (tenant_id, id),
  foreign key (tenant_id, claim_id) references public.receipt_claims (tenant_id, id),
  foreign key (tenant_id, chosen_invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, entry_id) references public.loyalty_ledger (tenant_id, id),
  check (num_nonnulls(checkin_id, claim_id) = 1),
  check ((matched_path = 'B') = (checkin_id is not null)),
  check ((state = 'open') = (resolved_at is null)),
  check (state <> 'resolved' or chosen_invoice_id is not null)
);

comment on table public.loyalty_queue is 'the manager queue: a check-in or receipt claim with two candidate invoices within tolerance waits here instead of being guessed; an owner or manager of the store resolves it with resolve_loyalty_queue_item';

create unique index loyalty_queue_one_per_checkin_key on public.loyalty_queue (checkin_id) where checkin_id is not null;
create unique index loyalty_queue_one_per_claim_key on public.loyalty_queue (claim_id) where claim_id is not null;
create index loyalty_queue_open_idx on public.loyalty_queue (store_id, created_at) where state = 'open';

create table app.loyalty_fast_lane_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  requested_at timestamptz not null,
  run_after timestamptz not null,
  last_requested_at timestamptz not null,
  requests integer not null default 1 check (requests >= 1),
  reasons text[] not null default '{}',
  claimed_at timestamptz,
  finished_at timestamptz,
  outcome text check (outcome is null or char_length(outcome) between 1 and 40),
  check (run_after >= requested_at),
  check (finished_at is null or claimed_at is not null)
);

comment on table app.loyalty_fast_lane_runs is 'fast-lane sync requests per store (a staff check-in or a claim waiting for its invoice): requests within 5 minutes of a run share it, and a store runs at most once per 5 minutes; a runner claims due runs only when LOYALTY_FAST_LANE=on, and nothing schedules it';

create index loyalty_fast_lane_runs_store_idx on app.loyalty_fast_lane_runs (store_id, requested_at desc);
create index loyalty_fast_lane_runs_due_idx on app.loyalty_fast_lane_runs (run_after) where claimed_at is null;

revoke all on table app.loyalty_fast_lane_runs from public, anon, authenticated, service_role;

create function app.request_fast_lane(p_store_id uuid, p_reason text default 'manual', p_at timestamptz default now())
returns table (run_id uuid, coalesced boolean, run_after timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_latest app.loyalty_fast_lane_runs%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'manual');
begin
  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if v_tenant is null then
    raise exception 'request_fast_lane needs an existing store' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty_fast_lane:' || p_store_id::text));
  select r.* into v_latest
  from app.loyalty_fast_lane_runs r
  where r.store_id = p_store_id
  order by r.requested_at desc
  limit 1;
  if v_latest.id is not null and v_latest.claimed_at is null then
    update app.loyalty_fast_lane_runs r
    set requests = r.requests + 1,
        last_requested_at = greatest(r.last_requested_at, p_at),
        reasons = case when v_reason = any (r.reasons) then r.reasons else r.reasons || v_reason end
    where r.id = v_latest.id;
    return query select v_latest.id, true, v_latest.run_after;
    return;
  end if;
  insert into app.loyalty_fast_lane_runs (tenant_id, store_id, requested_at, run_after, last_requested_at, reasons)
  values (
    v_tenant, p_store_id, p_at,
    case when v_latest.id is not null and v_latest.run_after > p_at - interval '5 minutes' then v_latest.run_after + interval '5 minutes' else p_at end,
    p_at, array[v_reason]
  )
  returning app.loyalty_fast_lane_runs.id, app.loyalty_fast_lane_runs.run_after into v_latest.id, v_latest.run_after;
  return query select v_latest.id, false, v_latest.run_after;
end;
$$;

comment on function app.request_fast_lane(uuid, text, timestamptz) is 'asks for a fast-lane sync of a store''s last 60 minutes: joins the store''s run not yet started (coalesced), or opens a new run due at once, or 5 minutes after the previous run''s start when that is later; records only, never calls the POS; service role only';

create function app.claim_fast_lane_runs(p_at timestamptz default now(), p_limit integer default 5)
returns table (run_id uuid, tenant_id uuid, store_id uuid, window_from timestamptz, window_to timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update app.loyalty_fast_lane_runs r
  set claimed_at = p_at, finished_at = p_at, outcome = 'expired'
  where r.claimed_at is null
    and r.last_requested_at < p_at - interval '60 minutes';
  return query
  with due as (
    select r.id
    from app.loyalty_fast_lane_runs r
    where r.claimed_at is null
      and r.run_after <= p_at
    order by r.run_after, r.id
    limit greatest(least(coalesce(p_limit, 5), 50), 1)
    for update skip locked
  )
  update app.loyalty_fast_lane_runs r
  set claimed_at = p_at
  from due
  where r.id = due.id
  returning r.id, r.tenant_id, r.store_id, p_at - interval '60 minutes', p_at;
end;
$$;

comment on function app.claim_fast_lane_runs(timestamptz, integer) is 'claims the fast-lane runs that are due, each once, with their 60-minute window; requests left unclaimed for 60 minutes are closed as expired';

create function app.finish_fast_lane_run(p_run_id uuid, p_outcome text, p_at timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  update app.loyalty_fast_lane_runs r
  set finished_at = p_at, outcome = left(coalesce(nullif(btrim(p_outcome), ''), 'finished'), 40)
  where r.id = p_run_id
    and r.claimed_at is not null
    and r.finished_at is null;
$$;

comment on function app.finish_fast_lane_run(uuid, text, timestamptz) is 'records how a claimed fast-lane run ended';

create function app.loyalty_issue_checkin_code(p_membership_id uuid, p_store_id uuid, p_at timestamptz default now())
returns table (checkin_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_membership public.memberships%rowtype;
  v_ttl integer;
  v_code text;
  v_id uuid;
  v_expires timestamptz;
  v_attempt integer := 0;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if not found or v_membership.status <> 'active' then
    raise exception 'a check-in code is issued to an active membership' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.tenant_id = v_membership.tenant_id and s.active) then
    raise exception 'a check-in code is issued for an active store of the membership''s tenant' using errcode = '22023';
  end if;
  select p.checkin_code_ttl_seconds into v_ttl from public.loyalty_programmes p where p.id = v_membership.programme_id;
  update public.pending_checkins c
  set status = 'expired', reason = case when c.membership_id = p_membership_id and c.expires_at > p_at then 'replaced' else 'code_expired' end, closed_at = p_at
  where c.store_id = p_store_id
    and c.status = 'issued'
    and (c.expires_at <= p_at or c.membership_id = p_membership_id);
  v_expires := p_at + make_interval(secs => v_ttl);
  loop
    v_attempt := v_attempt + 1;
    v_code := app.notify_random_code('0123456789', 6);
    insert into public.pending_checkins (tenant_id, store_id, membership_id, code, created_at, expires_at)
    values (v_membership.tenant_id, p_store_id, p_membership_id, v_code, p_at, v_expires)
    on conflict (store_id, code) where status = 'issued' do nothing
    returning id into v_id;
    exit when v_id is not null;
    if v_attempt >= 20 then
      raise exception 'no free check-in code at this store, try again' using errcode = '55000';
    end if;
  end loop;
  return query select v_id, v_code, v_expires;
end;
$$;

comment on function app.loyalty_issue_checkin_code(uuid, uuid, timestamptz) is 'path B: issues a fresh 6-digit check-in code for a membership at a store, valid for the programme''s checkin_code_ttl_seconds, replacing the membership''s previous live code there; for the customer app''s dynamic code; service role only';

create function app.loyalty_match_checkin(p_checkin_id uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkin public.pending_checkins%rowtype;
  v_before integer;
  v_after integer;
  v_best_invoice uuid;
  v_candidates uuid[];
  v_earn record;
begin
  select c.* into v_checkin from public.pending_checkins c where c.id = p_checkin_id for update;
  if not found then
    raise exception 'loyalty_match_checkin needs an existing check-in' using errcode = '22023';
  end if;
  if v_checkin.status <> 'recorded' then
    return v_checkin.status::text;
  end if;
  select p.checkin_window_before_minutes, p.checkin_window_after_minutes into v_before, v_after
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = v_checkin.membership_id;
  with candidates as (
    select
      i.id as invoice_id,
      case when v_checkin.amount is null then 0 else abs(i.net_amount - v_checkin.amount) end as amount_gap,
      abs(extract(epoch from i.sold_at - v_checkin.recorded_at)) as time_gap,
      i.external_id
    from public.invoices i
    where i.store_id = v_checkin.store_id
      and i.sold_at >= v_checkin.recorded_at - make_interval(mins => v_before)
      and i.sold_at <= v_checkin.recorded_at + make_interval(mins => v_after)
      and i.status = 'completed'
      and not exists (select 1 from public.loyalty_ledger l where l.invoice_id = i.id and l.entry_kind = 'earn')
      and not exists (select 1 from public.pending_checkins o where o.matched_invoice_id = i.id)
      and not exists (select 1 from public.receipt_claims r where r.invoice_id = i.id)
      and not exists (select 1 from public.loyalty_queue q where q.state = 'open' and i.id = any (q.candidate_invoice_ids))
  ),
  best as (
    select c.* from candidates c order by c.amount_gap, c.time_gap, c.external_id collate "C" limit 1
  )
  select
    b.invoice_id,
    (select array_agg(c.invoice_id order by c.time_gap, c.external_id collate "C") from candidates c where c.amount_gap = b.amount_gap)
  into v_best_invoice, v_candidates
  from best b;
  if v_best_invoice is null then
    return 'pending';
  end if;
  if cardinality(v_candidates) > 1 then
    insert into public.loyalty_queue (tenant_id, store_id, membership_id, checkin_id, matched_path, candidate_invoice_ids, reason, created_at)
    values (v_checkin.tenant_id, v_checkin.store_id, v_checkin.membership_id, v_checkin.id, 'B', v_candidates[1:20], 'two_candidates', p_at);
    update public.pending_checkins c set status = 'queued' where c.id = v_checkin.id;
    return 'queued';
  end if;
  select e.* into v_earn from app.loyalty_earn(v_best_invoice, v_checkin.membership_id, 'B', p_at) e;
  if v_earn.entry_id is null then
    update public.pending_checkins c
    set status = 'rejected', reason = v_earn.refusal, closed_at = p_at
    where c.id = v_checkin.id;
    return 'rejected';
  end if;
  update public.pending_checkins c
  set status = 'matched', matched_invoice_id = v_best_invoice, matched_entry_id = v_earn.entry_id, closed_at = p_at
  where c.id = v_checkin.id;
  return 'matched';
end;
$$;

comment on function app.loyalty_match_checkin(uuid, timestamptz) is 'path B: matches a recorded check-in to an unclaimed completed invoice of its store sold within the programme''s window around the recording (closest amount first when staff typed one, then closest time); two candidates equally close go to the manager queue; returns matched, queued, rejected (an earn refusal), pending or the check-in''s status';

create function app.loyalty_record_checkin(
  p_store_id uuid,
  p_code text,
  p_recorded_by uuid default null,
  p_amount numeric default null,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_amount is not null and p_amount <= 0 then
    raise exception 'a check-in amount is positive' using errcode = '22023';
  end if;
  update public.pending_checkins c
  set status = 'recorded', recorded_at = p_at, recorded_by = p_recorded_by, amount = p_amount
  where c.store_id = p_store_id
    and c.code = btrim(p_code)
    and c.status = 'issued'
    and c.expires_at > p_at
  returning c.id into v_id;
  if v_id is null then
    raise exception 'the check-in code is unknown or expired at this store' using errcode = '22023';
  end if;
  if app.loyalty_match_checkin(v_id, p_at) = 'pending' then
    perform app.request_fast_lane(p_store_id, 'checkin', p_at);
  end if;
  return v_id;
end;
$$;

comment on function app.loyalty_record_checkin(uuid, text, uuid, numeric, timestamptz) is 'path B: staff record a customer''s live check-in code at a store, optionally with the bill amount; matched at once when the invoice is already synced, otherwise a fast-lane run is requested; for the staff functions of phase 17b; service role only';

create function app.loyalty_match_claim(p_claim_id uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.receipt_claims%rowtype;
  v_found integer;
  v_exact uuid[];
  v_invoice public.invoices%rowtype;
  v_earn record;
  v_reject text;
begin
  select c.* into v_claim from public.receipt_claims c where c.id = p_claim_id for update;
  if not found then
    raise exception 'loyalty_match_claim needs an existing claim' using errcode = '22023';
  end if;
  if v_claim.status <> 'pending' then
    return v_claim.status::text;
  end if;
  select count(*), array_agg(i.id order by i.external_id collate "C") filter (where i.net_amount = v_claim.amount)
  into v_found, v_exact
  from public.invoices i
  where i.store_id = v_claim.store_id
    and i.business_date = v_claim.business_date
    and ltrim(btrim(i.receipt_no), '0') = ltrim(v_claim.receipt_no, '0');
  if v_found = 0 then
    if p_at >= v_claim.expires_at then
      update public.receipt_claims c set status = 'expired', reason = 'no_matching_invoice', closed_at = p_at where c.id = v_claim.id;
      return 'expired';
    end if;
    return 'pending';
  end if;
  if coalesce(cardinality(v_exact), 0) = 0 then
    update public.receipt_claims c set status = 'rejected', reason = 'amount_mismatch', closed_at = p_at where c.id = v_claim.id;
    return 'rejected';
  end if;
  if cardinality(v_exact) > 1 then
    insert into public.loyalty_queue (tenant_id, store_id, membership_id, claim_id, matched_path, candidate_invoice_ids, reason, created_at)
    values (v_claim.tenant_id, v_claim.store_id, v_claim.membership_id, v_claim.id, 'C', v_exact[1:20], 'duplicate_receipt', p_at);
    update public.receipt_claims c set status = 'queued' where c.id = v_claim.id;
    return 'queued';
  end if;
  select i.* into v_invoice from public.invoices i where i.id = v_exact[1];
  if exists (select 1 from public.receipt_claims r where r.invoice_id = v_invoice.id) then
    v_reject := 'already_claimed';
  elsif exists (select 1 from public.loyalty_ledger l where l.invoice_id = v_invoice.id and l.entry_kind = 'earn') then
    v_reject := 'already_earned';
  elsif v_invoice.status <> 'completed' then
    v_reject := 'invoice_not_completed';
  end if;
  if v_reject is not null then
    update public.receipt_claims c set status = 'rejected', reason = v_reject, closed_at = p_at where c.id = v_claim.id;
    return 'rejected';
  end if;
  select e.* into v_earn from app.loyalty_earn(v_invoice.id, v_claim.membership_id, 'C', p_at) e;
  if v_earn.entry_id is null then
    update public.receipt_claims c set status = 'rejected', reason = v_earn.refusal, closed_at = p_at where c.id = v_claim.id;
    return 'rejected';
  end if;
  update public.receipt_claims c
  set status = 'matched', invoice_id = v_invoice.id, entry_id = v_earn.entry_id, closed_at = p_at
  where c.id = v_claim.id;
  return 'matched';
end;
$$;

comment on function app.loyalty_match_claim(uuid, timestamptz) is 'path C: matches a pending receipt claim on store, business date, receipt number (leading zeros ignored) and exact net amount; rejects a different amount, a receipt already claimed or earned and an earn refusal, queues two invoices with the same receipt and amount, expires the claim after its window; returns the outcome';

create function app.loyalty_submit_claim(
  p_membership_id uuid,
  p_store_id uuid,
  p_business_date date,
  p_receipt_no text,
  p_amount numeric,
  p_at timestamptz default now()
)
returns table (claim_id uuid, status public.receipt_claim_status, reason text, entry_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_membership public.memberships%rowtype;
  v_programme public.loyalty_programmes%rowtype;
  v_receipt text := btrim(p_receipt_no);
  v_today date;
  v_earliest date;
  v_submitted integer;
  v_reject text;
  v_id uuid;
  v_outcome text;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'loyalty_submit_claim needs an existing membership' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.tenant_id = v_membership.tenant_id) then
    raise exception 'a receipt claim names a store of the membership''s tenant' using errcode = '22023';
  end if;
  if v_receipt is null or char_length(v_receipt) not between 1 and 40 or v_receipt ~ '[[:space:][:cntrl:]]' then
    raise exception 'a receipt number holds 1 to 40 characters without spaces' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1000000000000 then
    raise exception 'a claimed amount is positive' using errcode = '22023';
  end if;
  if p_business_date is null then
    raise exception 'a receipt claim names its business date' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  v_today := app.store_business_date(p_store_id, p_at);
  v_earliest := app.store_business_date(p_store_id, p_at - make_interval(hours => v_programme.receipt_claim_window_hours));
  select count(*) into v_submitted
  from public.receipt_claims c
  where c.membership_id = p_membership_id
    and app.store_business_date(c.store_id, c.created_at) = v_today;
  if v_membership.status <> 'active' then
    v_reject := 'membership_inactive';
  elsif p_business_date > v_today or p_business_date < v_earliest then
    v_reject := 'outside_window';
  elsif v_submitted >= v_programme.receipt_claims_per_phone_per_day then
    v_reject := 'daily_cap';
  elsif exists (
    select 1 from public.receipt_claims c
    where c.store_id = p_store_id
      and c.business_date = p_business_date
      and ltrim(c.receipt_no, '0') = ltrim(v_receipt, '0')
      and c.status in ('pending', 'matched', 'queued')
  ) then
    v_reject := 'already_claimed';
  end if;
  if v_reject is null then
    begin
      insert into public.receipt_claims (tenant_id, store_id, membership_id, business_date, receipt_no, amount, created_at, expires_at)
      values (v_membership.tenant_id, p_store_id, p_membership_id, p_business_date, v_receipt, p_amount, p_at, p_at + make_interval(hours => v_programme.receipt_claim_window_hours))
      returning id into v_id;
    exception when unique_violation then
      v_reject := 'already_claimed';
    end;
  end if;
  if v_reject is not null then
    insert into public.receipt_claims (tenant_id, store_id, membership_id, business_date, receipt_no, amount, status, created_at, expires_at, reason, closed_at)
    values (v_membership.tenant_id, p_store_id, p_membership_id, p_business_date, v_receipt, p_amount, 'rejected', p_at,
      p_at + make_interval(hours => v_programme.receipt_claim_window_hours), v_reject, p_at)
    returning id into v_id;
    return query select c.id, c.status, c.reason, c.entry_id from public.receipt_claims c where c.id = v_id;
    return;
  end if;
  v_outcome := app.loyalty_match_claim(v_id, p_at);
  if v_outcome = 'pending' then
    perform app.request_fast_lane(p_store_id, 'claim', p_at);
  end if;
  return query select c.id, c.status, c.reason, c.entry_id from public.receipt_claims c where c.id = v_id;
end;
$$;

comment on function app.loyalty_submit_claim(uuid, uuid, date, text, numeric, timestamptz) is 'path C: records a member''s receipt claim and matches it at once when the invoice is synced, otherwise requests a fast-lane run and leaves it pending for the programme''s claim window; refuses (as a rejected claim with its reason) membership_inactive, outside_window, daily_cap (receipt_claims_per_phone_per_day submissions a business day) and already_claimed; for the customer claim function of phase 18a; service role only';

create function app.reconcile_loyalty(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_earn record;
  v_outcome text;
  v_counts jsonb := jsonb_build_object(
    'a_earned', 0, 'a_refused', 0,
    'b_matched', 0, 'b_queued', 0, 'b_rejected', 0, 'b_pending', 0,
    'c_matched', 0, 'c_queued', 0, 'c_rejected', 0, 'c_pending', 0,
    'd_earned', 0, 'd_refused', 0, 'd_confirmed', 0,
    'expired_codes', 0, 'expired_checkins', 0, 'expired_claims', 0
  );
  v_rows integer;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_loyalty takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  if not exists (select 1 from public.loyalty_programmes p where p.tenant_id = p_tenant_id and p.status = 'active') then
    return jsonb_build_object('skipped', 'no_active_programme');
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));

  for v_row in
    with members as materialized (
      select
        m.id as membership_id,
        m.customer_id,
        m.joined_at - make_interval(hours => p.receipt_claim_window_hours) as earliest_sale,
        m.joined_at,
        app.loyalty_normalize_phone(c.phone) as phone
      from public.memberships m
      join public.customers c on c.id = m.customer_id
      join public.loyalty_programmes p on p.id = m.programme_id and p.status = 'active'
      where m.tenant_id = p_tenant_id
    ),
    candidates as materialized (
      select i.id, i.sold_at, i.external_id, i.customer_id, app.loyalty_normalize_phone(i.customer_phone) as phone
      from public.invoices i
      where i.tenant_id = p_tenant_id
        and i.business_date between p_from and p_to
        and (i.customer_id is not null or i.customer_phone is not null)
        and not exists (select 1 from public.loyalty_ledger l where l.invoice_id = i.id and l.entry_kind = 'earn')
    )
    select c.id as invoice_id, mm.membership_id
    from candidates c
    cross join lateral (
      select m.membership_id
      from members m
      where (m.customer_id = c.customer_id or (c.phone is not null and m.phone = c.phone))
        and c.sold_at >= m.earliest_sale
      order by coalesce(m.customer_id = c.customer_id, false) desc, m.joined_at, m.membership_id
      limit 1
    ) mm
    where not exists (select 1 from public.loyalty_refusals r where r.invoice_id = c.id and r.membership_id = mm.membership_id)
    order by c.sold_at, c.external_id collate "C"
  loop
    select e.* into v_earn from app.loyalty_earn(v_row.invoice_id, v_row.membership_id, 'A', p_at) e;
    if v_earn.entry_id is not null then
      v_counts := jsonb_set(v_counts, '{a_earned}', to_jsonb((v_counts ->> 'a_earned')::integer + 1));
    else
      v_counts := jsonb_set(v_counts, '{a_refused}', to_jsonb((v_counts ->> 'a_refused')::integer + 1));
    end if;
  end loop;

  for v_row in
    select c.id from public.pending_checkins c
    where c.tenant_id = p_tenant_id and c.status = 'recorded'
    order by c.recorded_at, c.id
  loop
    v_outcome := app.loyalty_match_checkin(v_row.id, p_at);
    if v_outcome in ('matched', 'queued', 'rejected', 'pending') then
      v_counts := jsonb_set(v_counts, array['b_' || v_outcome], to_jsonb((v_counts ->> ('b_' || v_outcome))::integer + 1));
    end if;
  end loop;

  for v_row in
    select c.id from public.receipt_claims c
    where c.tenant_id = p_tenant_id and c.status = 'pending'
    order by c.created_at, c.id
  loop
    v_outcome := app.loyalty_match_claim(v_row.id, p_at);
    if v_outcome in ('matched', 'queued', 'rejected', 'pending') then
      v_counts := jsonb_set(v_counts, array['c_' || v_outcome], to_jsonb((v_counts ->> ('c_' || v_outcome))::integer + 1));
    elsif v_outcome = 'expired' then
      v_counts := jsonb_set(v_counts, '{expired_claims}', to_jsonb((v_counts ->> 'expired_claims')::integer + 1));
    end if;
  end loop;

  for v_row in
    select i.id as invoice_id, r.id as redemption_id, r.membership_id, r.redeem_entry_id, r.coupon_code_id
    from public.invoices i
    join public.redemptions r
      on r.tenant_id = i.tenant_id
     and r.state = 'held'
     and (r.store_id is null or r.store_id = i.store_id)
     and upper(r.code) = upper(btrim(i.voucher_code))
    where i.tenant_id = p_tenant_id
      and i.business_date between p_from and p_to
      and i.voucher_code is not null
      and i.status = 'completed'
    order by i.sold_at, i.external_id collate "C"
  loop
    update public.redemptions r
    set state = 'confirmed', confirmed_invoice_id = v_row.invoice_id, confirmed_at = p_at
    where r.id = v_row.redemption_id and r.state = 'held';
    if v_row.redeem_entry_id is not null
      and exists (select 1 from public.loyalty_ledger l where l.id = v_row.redeem_entry_id and l.pending)
    then
      perform app.loyalty_confirm(v_row.redeem_entry_id, v_row.invoice_id, p_at);
    end if;
    if v_row.coupon_code_id is not null then
      update public.coupon_codes k
      set state = 'used', used_invoice_id = v_row.invoice_id, used_at = p_at
      where k.id = v_row.coupon_code_id and k.state in ('available', 'assigned');
    end if;
    v_counts := jsonb_set(v_counts, '{d_confirmed}', to_jsonb((v_counts ->> 'd_confirmed')::integer + 1));
    if not exists (select 1 from public.loyalty_ledger l where l.invoice_id = v_row.invoice_id and l.entry_kind = 'earn')
      and not exists (select 1 from public.loyalty_refusals f where f.invoice_id = v_row.invoice_id and f.membership_id = v_row.membership_id)
    then
      select e.* into v_earn from app.loyalty_earn(v_row.invoice_id, v_row.membership_id, 'D', p_at) e;
      if v_earn.entry_id is not null then
        v_counts := jsonb_set(v_counts, '{d_earned}', to_jsonb((v_counts ->> 'd_earned')::integer + 1));
      else
        v_counts := jsonb_set(v_counts, '{d_refused}', to_jsonb((v_counts ->> 'd_refused')::integer + 1));
      end if;
    end if;
  end loop;

  update public.pending_checkins c
  set status = 'expired', reason = 'code_expired', closed_at = p_at
  where c.tenant_id = p_tenant_id and c.status = 'issued' and c.expires_at <= p_at;
  get diagnostics v_rows = row_count;
  v_counts := jsonb_set(v_counts, '{expired_codes}', to_jsonb(v_rows));

  update public.pending_checkins c
  set status = 'expired', reason = 'no_matching_invoice', closed_at = p_at
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = c.membership_id
    and c.tenant_id = p_tenant_id
    and c.status = 'recorded'
    and c.recorded_at + make_interval(hours => p.checkin_pending_hours) <= p_at;
  get diagnostics v_rows = row_count;
  v_counts := jsonb_set(v_counts, '{expired_checkins}', to_jsonb(v_rows));

  update public.receipt_claims c
  set status = 'expired', reason = 'no_matching_invoice', closed_at = p_at
  where c.tenant_id = p_tenant_id and c.status = 'pending' and c.expires_at <= p_at;
  get diagnostics v_rows = row_count;
  v_counts := jsonb_set(v_counts, '{expired_claims}', to_jsonb((v_counts ->> 'expired_claims')::integer + v_rows));

  return v_counts;
end;
$$;

comment on function app.reconcile_loyalty(uuid, date, date, timestamptz) is 'the loyalty reconciliation after a sync: path A (the customer or phone on invoices of the range), path B (recorded check-ins), path C (pending receipt claims), path D (held redemptions whose code is on an invoice of the range, confirmed and earned), then expiry of stale codes, check-ins and claims; idempotent; returns counts only; service role and the jobs';

create function app.resolve_loyalty_queue_item(p_item_id uuid, p_choice uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.loyalty_queue%rowtype;
  v_reason text := btrim(p_reason);
  v_earn record;
  v_at timestamptz := now();
begin
  select q.* into v_item from public.loyalty_queue q where q.id = p_item_id for update;
  if not found or not app.can_manage_store_scope(v_item.tenant_id, v_item.store_id) then
    raise exception 'only an owner or manager of the store resolves a loyalty queue item' using errcode = '42501';
  end if;
  if v_item.state <> 'open' then
    raise exception 'the loyalty queue item is already closed' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a resolution states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  if p_choice is null then
    update public.loyalty_queue q
    set state = 'dismissed', resolved_at = v_at, resolved_by = (select auth.uid()), resolution_reason = v_reason
    where q.id = p_item_id;
    update public.pending_checkins c set status = 'rejected', reason = 'dismissed', closed_at = v_at where c.id = v_item.checkin_id;
    update public.receipt_claims c set status = 'rejected', reason = 'dismissed', closed_at = v_at where c.id = v_item.claim_id;
    return jsonb_build_object('state', 'dismissed', 'entry_id', null, 'refusal', null);
  end if;
  if not (p_choice = any (v_item.candidate_invoice_ids)) then
    raise exception 'the choice is one of the item''s candidate invoices' using errcode = '22023';
  end if;
  select e.* into v_earn from app.loyalty_earn(p_choice, v_item.membership_id, v_item.matched_path, v_at, false, (select auth.uid())) e;
  update public.loyalty_queue q
  set state = 'resolved', resolved_at = v_at, resolved_by = (select auth.uid()), chosen_invoice_id = p_choice,
      resolution_reason = v_reason, entry_id = v_earn.entry_id
  where q.id = p_item_id;
  if v_earn.entry_id is null then
    update public.pending_checkins c set status = 'rejected', reason = v_earn.refusal, closed_at = v_at where c.id = v_item.checkin_id;
    update public.receipt_claims c set status = 'rejected', reason = v_earn.refusal, closed_at = v_at where c.id = v_item.claim_id;
  else
    update public.pending_checkins c
    set status = 'matched', matched_invoice_id = p_choice, matched_entry_id = v_earn.entry_id, closed_at = v_at
    where c.id = v_item.checkin_id;
    update public.receipt_claims c
    set status = 'matched', invoice_id = p_choice, entry_id = v_earn.entry_id, closed_at = v_at
    where c.id = v_item.claim_id;
  end if;
  return jsonb_build_object('state', 'resolved', 'entry_id', v_earn.entry_id, 'refusal', v_earn.refusal);
end;
$$;

comment on function app.resolve_loyalty_queue_item(uuid, uuid, text) is 'an owner or manager of the store resolves a queue item: p_choice one of its candidate invoices earns it for the member (approved_by the caller), null dismisses it; the check-in or claim is closed accordingly; 42501 for anyone else';

create function public.resolve_loyalty_queue_item(p_item_id uuid, p_choice uuid, p_reason text)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.resolve_loyalty_queue_item(p_item_id, p_choice, p_reason);
$$;

comment on function public.resolve_loyalty_queue_item(uuid, uuid, text) is 'RPC: app.resolve_loyalty_queue_item';

create or replace function app.erase_loyalty_membership(p_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  delete from public.memberships where id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('memberships', v_rows);
  perform set_config('app.loyalty_erasure', 'off', true);
  return v_counts;
end;
$$;

alter table public.loyalty_queue enable row level security;

create policy loyalty_queue_select_for_store_managers on public.loyalty_queue
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_manager_store_ids())::uuid[]));

revoke all on public.loyalty_queue from anon;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_queue from authenticated;
grant select on public.loyalty_queue to authenticated;

revoke all on function app.request_fast_lane(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app.claim_fast_lane_runs(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function app.finish_fast_lane_run(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_issue_checkin_code(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_match_checkin(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_record_checkin(uuid, text, uuid, numeric, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_match_claim(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_submit_claim(uuid, uuid, date, text, numeric, timestamptz) from public, anon, authenticated;
revoke all on function app.reconcile_loyalty(uuid, date, date, timestamptz) from public, anon, authenticated;
revoke all on function app.resolve_loyalty_queue_item(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.resolve_loyalty_queue_item(uuid, uuid, text) from public, anon, service_role;

grant execute on function app.request_fast_lane(uuid, text, timestamptz) to service_role;
grant execute on function app.loyalty_issue_checkin_code(uuid, uuid, timestamptz) to service_role;
grant execute on function app.loyalty_match_checkin(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_record_checkin(uuid, text, uuid, numeric, timestamptz) to service_role;
grant execute on function app.loyalty_match_claim(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_submit_claim(uuid, uuid, date, text, numeric, timestamptz) to service_role;
grant execute on function app.reconcile_loyalty(uuid, date, date, timestamptz) to service_role;
grant execute on function app.resolve_loyalty_queue_item(uuid, uuid, text) to authenticated;
grant execute on function public.resolve_loyalty_queue_item(uuid, uuid, text) to authenticated;
