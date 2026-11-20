-- Bill verification without the POS (docs/deep-dives/bill-verification-plan.md, phases 1 and 2), the
-- earning path of stores whose loyalty_confirmation is 'staff'.
--
-- A bill is recorded in the staff Mini App after a scan of the member's dynamic QR: bill number and total
-- (the staff reading, evidence level 0). Its earn (path E) is written pending at once. The customer then
-- types the total they paid, blind, in the customer Mini App: agreeing within bill_amount_tolerance gives
-- level 2 and the earn is confirmed at once; disagreeing puts the bill in the manager queue; a dispute
-- reverses it; silence until bill_unconfirmed_hours applies bill_silence_outcome (reverse by default).
-- A store whose bill_evidence_required_level is 0 confirms the staff reading at once. A bill above
-- bill_manager_approval_above always waits for a manager. The dedupe key is store + business date + bill
-- number without leading zeros; the same key with another total is a critical alert.
--
-- Customers may also claim with the store's rotating counter QR: the customer's total is the first reading,
-- a staff member types the total from the bill blind as the second; small claims may be auto-approved.
--
-- Extension points for phases 4 to 8: bill_captures.photo_path, photo_hash, reading, printed_at, lines and
-- flags; bill_confirmations.source 'reader' with its reading; evidence_level 1 and 3; bill_reader_mode.

-- 1. Tables ----------------------------------------------------------------------------------

create function app.bill_key(p_bill_no text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bill_no is null or btrim(p_bill_no) = '' then null
    when upper(btrim(p_bill_no)) ~ '^0+$' then '0'
    else regexp_replace(upper(btrim(p_bill_no)), '^0+', '')
  end;
$$;

comment on function app.bill_key(text) is 'the dedupe form of a bill number: trimmed, upper case, leading zeros dropped (0 for a number of zeros only), like the receipt claims of path C';

create table public.loyalty_counter_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  token text not null unique check (token ~ '^[A-HJ-NP-Z2-9]{12}$'),
  issued_by uuid references auth.users (id) on delete set null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (expires_at > issued_at)
);

comment on table public.loyalty_counter_codes is 'the rotating counter QR of a store in staff mode with self claims: a 12-character token valid for counter_code_ttl_seconds, shown in the staff Mini App; a customer claim must name a fresh token of the store; never readable through the API';

create index loyalty_counter_codes_store_idx on public.loyalty_counter_codes (store_id, issued_at desc);

create table public.bill_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  source text not null check (source in ('staff_scan', 'counter_claim')),
  captured_by uuid references auth.users (id) on delete set null,
  counter_code_id uuid,
  business_date date not null,
  bill_no text not null check (char_length(bill_no) between 1 and 40 and bill_no !~ '[[:space:][:cntrl:]]'),
  bill_key text not null,
  total numeric(14, 2) not null check (total > 0 and total <= 100000000),
  printed_at timestamptz,
  lines jsonb check (lines is null or jsonb_typeof(lines) = 'array'),
  flags text[] not null default '{}'::text[],
  photo_path text check (photo_path is null or char_length(photo_path) between 1 and 300),
  photo_hash text check (photo_hash is null or photo_hash ~ '^[0-9a-f]{64}$'),
  reading jsonb check (reading is null or jsonb_typeof(reading) = 'object'),
  evidence_level smallint not null default 0 check (evidence_level between 0 and 3),
  state text not null check (state in ('awaiting_customer', 'awaiting_staff', 'queued', 'confirmed', 'reversed', 'rejected', 'expired')),
  queue_reason text check (queue_reason in ('over_approval', 'disagreement')),
  confirm_by timestamptz not null,
  auto_approved boolean not null default false,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (char_length(decision_reason) between 1 and 200 and decision_reason !~ '[[:cntrl:]]')),
  confirmed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text check (reversal_reason in ('disputed', 'timed_out', 'manager_rejected', 'manager_reversed', 'audit_failed')),
  invoice_id uuid,
  shadow_state text check (shadow_state in ('matched', 'mismatch', 'no_invoice')),
  shadow_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, counter_code_id) references public.loyalty_counter_codes (tenant_id, id) on delete set null (counter_code_id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete set null (invoice_id),
  check (bill_key = app.bill_key(bill_no)),
  check (confirm_by > created_at),
  check ((state = 'queued') = (queue_reason is not null)),
  check ((state = 'confirmed') = (confirmed_at is not null) or state = 'reversed'),
  check ((state = 'reversed') = (reversed_at is not null and reversal_reason is not null)),
  check (state <> 'rejected' or decision_reason is not null),
  check (not auto_approved or (source = 'counter_claim' and confirmed_at is not null)),
  check ((shadow_state is null) = (shadow_checked_at is null))
);

comment on table public.bill_captures is 'path E: a paper bill recorded at a store in staff mode, by a staff member after scanning the member''s dynamic QR (staff_scan) or by the customer with the counter QR (counter_claim), with its dedupe key, the first reading''s total, the evidence level reached and its state (awaiting_customer, awaiting_staff, queued, confirmed, reversed, rejected, expired); the ledger earn names it through loyalty_ledger.bill_id; photo, hash, reading, printed time, lines and flags are filled by the camera reader of later phases';
comment on column public.bill_captures.bill_key is 'store + business date + this key is the dedupe key of a bill (app.bill_key: leading zeros dropped)';
comment on column public.bill_captures.total is 'the total of the first reading: the staff member''s for staff_scan, the customer''s for counter_claim; the other readings are bill_confirmations rows';
comment on column public.bill_captures.evidence_level is '0 one typed total; 1 one reading (camera reader, later); 2 two agreeing readings; 3 two agreeing readings and clean bill checks (later)';
comment on column public.bill_captures.confirm_by is 'when a bill still waiting for its second reading is settled by bill_silence_outcome (staff_scan) or expires (counter_claim)';
comment on column public.bill_captures.invoice_id is 'the shadow match: a synced invoice that also shows this bill, set by app.loyalty_shadow_reconcile when the store has a POS sync; nothing needs it';

create unique index bill_captures_dedupe_key on public.bill_captures (store_id, business_date, bill_key) where state not in ('rejected', 'expired');
create index bill_captures_store_day_idx on public.bill_captures (store_id, business_date);
create index bill_captures_captured_by_idx on public.bill_captures (captured_by, business_date) where captured_by is not null;
create index bill_captures_membership_idx on public.bill_captures (membership_id, created_at);
create index bill_captures_waiting_idx on public.bill_captures (confirm_by) where state in ('awaiting_customer', 'awaiting_staff');
create unique index bill_captures_one_per_member_counter_code_key on public.bill_captures (membership_id, counter_code_id) where counter_code_id is not null;
create unique index bill_captures_invoice_key on public.bill_captures (invoice_id) where invoice_id is not null;

create table public.bill_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  bill_id uuid not null,
  source text not null check (source in ('staff', 'customer', 'reader')),
  entered_total numeric(14, 2) check (entered_total is null or (entered_total > 0 and entered_total <= 100000000)),
  reading jsonb check (reading is null or jsonb_typeof(reading) = 'object'),
  agrees boolean,
  entered_by uuid references auth.users (id) on delete set null,
  entered_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (bill_id, source),
  foreign key (tenant_id, bill_id) references public.bill_captures (tenant_id, id) on delete cascade,
  check (source = 'reader' or entered_total is not null)
);

comment on table public.bill_confirmations is 'one reading of a bill per source: the staff member''s typed total, the customer''s blind total, or (later) the photo reader''s reading; agrees says whether it matched the first reading within bill_amount_tolerance';

create table public.bill_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  bill_id uuid not null unique,
  state text not null default 'open' check (state in ('open', 'passed', 'failed')),
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  note text check (note is null or (char_length(note) between 1 and 200 and note !~ '[[:cntrl:]]')),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, bill_id) references public.bill_captures (tenant_id, id) on delete cascade,
  check ((state = 'open') = (closed_at is null)),
  check (state <> 'failed' or note is not null)
);

comment on table public.bill_audits is 'the random audit of confirmed bills (bill_audit_sample_pct): open in the manager queue until a manager marks it passed or failed; a failed audit reverses the earn and counts against the staff member';

create index bill_audits_open_idx on public.bill_audits (store_id, opened_at) where state = 'open';

-- 2. Ledger -----------------------------------------------------------------------------------

alter table public.loyalty_ledger add column bill_id uuid;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_bill_fkey foreign key (tenant_id, bill_id) references public.bill_captures (tenant_id, id);
comment on column public.loyalty_ledger.bill_id is 'on an earn of path E and its confirm and clawback rows: the bill_captures row that proves it instead of an invoice';

alter table public.loyalty_ledger drop constraint loyalty_ledger_matched_path_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_matched_path_check check (matched_path in ('A', 'B', 'C', 'D', 'E'));
alter table public.loyalty_ledger drop constraint loyalty_ledger_invoice_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_invoice_check check (
  entry_kind not in ('earn', 'confirm', 'clawback')
  or invoice_id is not null
  or bill_id is not null
  or (entry_kind = 'confirm' and reason = 'staff_confirmed')
);
alter table public.loyalty_ledger add constraint loyalty_ledger_bill_path_check check (entry_kind <> 'earn' or (matched_path = 'E') = (bill_id is not null));
comment on column public.loyalty_ledger.matched_path is 'how the purchase of an earn was proven: A the phone or member on the invoice, B a check-in code, C a receipt claim, D a voucher recipient (all by a synced invoice), E a paper bill recorded at a store in staff mode (bill_captures, the evidence ladder)';

create unique index loyalty_ledger_one_earn_per_bill_key on public.loyalty_ledger (bill_id) where entry_kind = 'earn' and bill_id is not null;
create index loyalty_ledger_bill_idx on public.loyalty_ledger (bill_id) where bill_id is not null;

-- 3. Shared steps -------------------------------------------------------------------------------

create function app.bill_earn(p_bill_id uuid, p_pending boolean, p_at timestamptz)
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
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id;
  select l.id into v_entry from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  if v_entry is not null then
    return v_entry;
  end if;
  select p.* into v_programme
  from public.memberships m join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = v_bill.membership_id;
  v_stamps := case when v_bill.total >= v_programme.stamp_min_bill_amount then 1 else 0 end;
  v_points := greatest(floor(v_bill.total / v_programme.point_unit_amount), 0)::integer * v_programme.points_per_unit;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    business_date, matched_path, pending, approved_by, bill_id, expires_at, occurred_at
  )
  values (
    v_bill.tenant_id, v_programme.id, v_bill.membership_id, v_bill.store_id, 'earn', v_stamps, v_points,
    round(v_points * v_programme.point_value_amount, 2), v_bill.business_date, 'E', p_pending, v_bill.captured_by, v_bill.id,
    case when v_points > 0 then p_at + make_interval(months => v_programme.points_expiry_months) end, p_at
  )
  returning id into v_entry;
  if v_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_bill.tenant_id, v_bill.membership_id, v_entry, p_at, p_at + make_interval(months => v_programme.stamp_validity_months)
    from generate_series(1, v_stamps);
  end if;
  return v_entry;
end;
$$;

comment on function app.bill_earn(uuid, boolean, timestamptz) is 'writes the earn of a bill (path E, one per bill): one stamp when the total reaches stamp_min_bill_amount, points_per_unit per point_unit_amount, pending or not; returns the existing earn when there is one; internal';

create function app.bill_confirm(p_bill_id uuid, p_actor uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
  v_earn public.loyalty_ledger;
  v_entry uuid;
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
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, business_date, source_entry_id, bill_id, reason, approved_by, occurred_at)
    values (v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'confirm', v_earn.business_date, v_earn.id, p_bill_id, 'bill_confirmed', p_actor, p_at)
    on conflict (source_entry_id) where entry_kind = 'confirm' do nothing;
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

comment on function app.bill_confirm(uuid, uuid, timestamptz) is 'confirms a bill (state -> confirmed): a confirm row for its pending earn, or a confirmed earn when none was written yet; audited; samples bill_audit_sample_pct of the confirmed bills into bill_audits; a closed bill is left alone; internal';

create function app.bill_reverse(p_bill_id uuid, p_reason text, p_actor uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_earn public.loyalty_ledger;
  v_clawback uuid;
  v_count integer;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.state in ('reversed', 'rejected', 'expired') then
    return;
  end if;
  select l.* into v_earn from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  if v_earn.id is not null and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = v_earn.id) then
    insert into public.loyalty_ledger (
      tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
      business_date, source_entry_id, bill_id, reason, approved_by, occurred_at
    )
    values (
      v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'clawback', -v_earn.stamp_delta, -v_earn.point_delta,
      -v_earn.value_amount, v_earn.business_date, v_earn.id, p_bill_id, 'bill_' || p_reason, p_actor, p_at
    )
    returning id into v_clawback;
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_clawback, closed_at = p_at
    where s.earn_entry_id = v_earn.id and s.state = 'active';
  end if;
  if v_earn.id is null and p_reason = 'manager_rejected' then
    update public.bill_captures b
    set state = 'rejected', queue_reason = null, decided_by = p_actor, decided_at = p_at, decision_reason = coalesce(b.decision_reason, 'rejected')
    where b.id = p_bill_id;
    perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_rejected', p_bill_id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
    return;
  end if;
  update public.bill_captures b
  set state = 'reversed', queue_reason = null, reversed_at = p_at, reversal_reason = p_reason,
      decided_by = coalesce(p_actor, b.decided_by), decided_at = coalesce(b.decided_at, p_at)
  where b.id = p_bill_id;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_reversed', p_bill_id, v_bill.membership_id, v_bill.total,
    jsonb_build_object('reason', p_reason, 'earned', v_earn.id is not null), p_at);
  if p_reason in ('disputed', 'timed_out', 'audit_failed', 'manager_reversed') then
    select count(*) into v_count
    from public.bill_captures b
    where b.store_id = v_bill.store_id and b.business_date = v_bill.business_date and b.reversal_reason = p_reason;
    perform app.loyalty_staff_alert(v_bill.tenant_id, v_bill.store_id,
      case p_reason when 'manager_reversed' then 'reversal' else p_reason end,
      v_bill.store_id::text || coalesce(':' || v_bill.captured_by::text, ''),
      jsonb_build_object('count_today', v_count), p_at);
  end if;
end;
$$;

comment on function app.bill_reverse(uuid, text, uuid, timestamptz) is 'reverses a bill (state -> reversed with reason disputed, timed_out, manager_rejected, manager_reversed or audit_failed): a clawback row (reason bill_<reason>) of its earn, its active stamps clawed back (stamps already redeemed stay redeemed, the balance may go negative); a bill without an earn rejected by a manager becomes rejected; audited; a dispute, a timeout, an audit failure or a manager reversal raises loyalty_staff_anomaly for the store and the staff member with the day''s count; internal';

create function app.bill_evaluate(p_bill_id uuid, p_actor uuid, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
  v_staff public.bill_confirmations;
  v_customer public.bill_confirmations;
  v_level smallint := 0;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.state not in ('awaiting_customer', 'awaiting_staff') then
    return v_bill.state;
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  select c.* into v_staff from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'staff';
  select c.* into v_customer from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'customer';
  if v_staff.id is not null and v_customer.id is not null then
    if abs(v_staff.entered_total - v_customer.entered_total) <= v_settings.bill_amount_tolerance then
      v_level := 2;
    else
      update public.bill_captures b set state = 'queued', queue_reason = 'disagreement' where b.id = p_bill_id;
      perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_queued', p_bill_id, v_bill.membership_id, v_bill.total,
        jsonb_build_object('queue_reason', 'disagreement'), p_at);
      return 'queued';
    end if;
  end if;
  update public.bill_captures b set evidence_level = greatest(b.evidence_level, v_level) where b.id = p_bill_id;
  if v_staff.id is null then
    return v_bill.state;
  end if;
  if v_bill.total > v_settings.bill_manager_approval_above then
    update public.bill_captures b set state = 'queued', queue_reason = 'over_approval' where b.id = p_bill_id;
    perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_queued', p_bill_id, v_bill.membership_id, v_bill.total,
      jsonb_build_object('queue_reason', 'over_approval', 'evidence_level', greatest(v_bill.evidence_level, v_level)), p_at);
    return 'queued';
  end if;
  if greatest(v_bill.evidence_level, v_level) >= v_settings.bill_evidence_required_level then
    perform app.bill_confirm(p_bill_id, p_actor, p_at);
    return 'confirmed';
  end if;
  return v_bill.state;
end;
$$;

comment on function app.bill_evaluate(uuid, uuid, timestamptz) is 'the evidence ladder after each reading of a waiting bill: a staff and a customer reading that agree within bill_amount_tolerance give level 2, that disagree queue the bill (disagreement); with a staff reading, a total above bill_manager_approval_above queues it (over_approval) and a level at or above bill_evidence_required_level confirms it; otherwise it keeps waiting; returns the state; internal';

create function app.bill_precheck(
  p_store_id uuid, p_membership_id uuid, p_bill_no text, p_total numeric, p_recorder uuid, p_exclude_bill uuid, p_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.loyalty_store_settings;
  v_store public.stores;
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_customer public.customers;
  v_today date := app.store_business_date(p_store_id, p_at);
  v_known public.bill_captures;
  v_count integer;
  v_sum numeric;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = p_store_id;
  select m.* into v_membership from public.memberships m where m.id = p_membership_id and m.tenant_id = v_store.tenant_id;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  if v_settings.confirmation is distinct from 'staff' then
    return 'not_staff_mode';
  elsif v_membership.id is null or v_membership.status <> 'active' then
    return 'membership_inactive';
  elsif v_programme.status <> 'active' or v_today < v_programme.starts_on or (v_programme.ends_on is not null and v_today > v_programme.ends_on) then
    return 'no_programme';
  elsif app.loyalty_is_staff_phone(v_store.tenant_id, v_customer.phone) then
    return 'staff_phone';
  elsif p_total > v_settings.max_bill_amount then
    return 'over_bill_limit';
  end if;
  if p_exclude_bill is null then
    select b.* into v_known
    from public.bill_captures b
    where b.store_id = p_store_id and b.business_date = v_today and b.bill_key = app.bill_key(p_bill_no)
      and b.state not in ('rejected', 'expired');
    if v_known.id is not null then
      if abs(v_known.total - p_total) > v_settings.bill_amount_tolerance then
        perform app.loyalty_audit(v_store.tenant_id, p_store_id, p_recorder, 'bill_conflict', v_known.id, p_membership_id, p_total,
          jsonb_build_object('known_total', v_known.total, 'same_member', v_known.membership_id = p_membership_id), p_at);
        perform app.loyalty_staff_alert(v_store.tenant_id, p_store_id, 'bill_conflict', v_known.id::text,
          jsonb_build_object('total_gap', abs(v_known.total - p_total)), p_at, 'critical');
        return 'bill_conflict';
      end if;
      return 'bill_used';
    end if;
    select count(*) into v_count
    from public.loyalty_ledger e
    where e.membership_id = p_membership_id
      and e.entry_kind = 'earn'
      and e.business_date = v_today
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = e.id);
    if v_count >= v_programme.earning_invoices_per_phone_per_day then
      return 'daily_limit';
    end if;
  end if;
  if p_recorder is not null then
    select count(*) filter (where b.evidence_level < 2 and b.state not in ('rejected', 'expired')), coalesce(sum(b.total) filter (where b.state not in ('rejected', 'expired', 'reversed')), 0)
    into v_count, v_sum
    from public.bill_captures b
    where b.store_id = p_store_id and b.business_date = v_today and b.captured_by = p_recorder
      and (p_exclude_bill is null or b.id <> p_exclude_bill);
    if p_exclude_bill is null and v_count >= v_settings.bill_staff_shift_cap then
      perform app.loyalty_staff_alert(v_store.tenant_id, p_store_id, 'cap_reached', p_store_id::text || ':' || p_recorder::text,
        jsonb_build_object('cap', 'bill_staff_shift_cap'), p_at);
      return 'staff_shift_cap';
    elsif v_sum + p_total > v_settings.staff_amount_per_day then
      perform app.loyalty_staff_alert(v_store.tenant_id, p_store_id, 'cap_reached', p_store_id::text || ':' || p_recorder::text,
        jsonb_build_object('cap', 'staff_amount_per_day'), p_at);
      return 'staff_amount_cap';
    end if;
  end if;
  if p_exclude_bill is null then
    select count(*) into v_count
    from public.bill_captures b
    where b.store_id = p_store_id and b.business_date = v_today and b.state not in ('rejected', 'expired');
    if v_count >= v_settings.store_earns_per_day then
      perform app.loyalty_staff_alert(v_store.tenant_id, p_store_id, 'cap_reached', p_store_id::text, jsonb_build_object('cap', 'store_earns_per_day'), p_at);
      return 'store_daily_cap';
    end if;
  end if;
  if p_total < v_programme.stamp_min_bill_amount and floor(p_total / v_programme.point_unit_amount) * v_programme.points_per_unit < 1 then
    return 'below_minimum';
  end if;
  return null;
end;
$$;

comment on function app.bill_precheck(uuid, uuid, text, numeric, uuid, uuid, timestamptz) is 'the checks before a bill earns, in order: not_staff_mode, membership_inactive, no_programme, staff_phone, over_bill_limit, then for a new bill bill_conflict (its dedupe key is known with another total: audited, critical loyalty_staff_anomaly) or bill_used, and daily_limit (the programme''s earns per member and day); for a recording staff member staff_shift_cap (unreviewed level 0-1 bills of the day, new bills only) and staff_amount_cap; for a new bill store_daily_cap; below_minimum (neither stamp nor point); a cap refusal raises cap_reached; null when the bill may earn; internal (callers hold the store lock)';

create function app.bill_cap_warning(p_store_id uuid, p_recorder uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.loyalty_store_settings;
  v_count integer;
begin
  if p_recorder is null then
    return;
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = p_store_id;
  select count(*) into v_count
  from public.bill_captures b
  where b.store_id = p_store_id and b.business_date = app.store_business_date(p_store_id, p_at) and b.captured_by = p_recorder
    and b.evidence_level < 2 and b.state not in ('rejected', 'expired');
  if v_count = ceil(v_settings.bill_staff_shift_cap * 0.7) then
    perform app.loyalty_staff_alert(v_settings.tenant_id, p_store_id, 'cap_warning', p_store_id::text || ':' || p_recorder::text,
      jsonb_build_object('cap', 'bill_staff_shift_cap', 'used', v_count, 'limit', v_settings.bill_staff_shift_cap), p_at);
  end if;
end;
$$;

comment on function app.bill_cap_warning(uuid, uuid, timestamptz) is 'raises loyalty_staff_anomaly cap_warning when a staff member''s unreviewed bills of the day reach 70 % of bill_staff_shift_cap; internal';

create function app.loyalty_parse_member_code(p_store_id uuid, p_raw text, p_at timestamptz)
returns table (membership_id uuid, checkin_id uuid, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := btrim(p_raw);
  v_tenant uuid;
  v_store_code text;
  v_code text;
  v_payload_store text;
  v_found public.pending_checkins;
begin
  select s.tenant_id, app.customer_store_code(s.code, s.external_id) into v_tenant, v_store_code from public.stores s where s.id = p_store_id;
  if v_raw ~ '^[0-9]{6}$' then
    v_code := v_raw;
  elsif v_raw ~ '^fnb-member:1:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[0-9]{6}$' then
    v_code := split_part(v_raw, ':', 4);
    v_payload_store := split_part(v_raw, ':', 3);
  else
    raise exception 'a member code has six digits or is the QR payload of one' using errcode = '22023';
  end if;
  if v_payload_store is not null and v_payload_store is distinct from v_store_code then
    return query select null::uuid, null::uuid, 'wrong_store'::text;
    return;
  end if;
  select c.* into v_found
  from public.pending_checkins c
  where c.store_id = p_store_id and c.code = v_code
  order by c.created_at desc
  limit 1;
  if v_found.id is null then
    return query select null::uuid, null::uuid,
      case when exists (
        select 1 from public.pending_checkins c
        where c.tenant_id = v_tenant and c.code = v_code and c.status = 'issued' and c.expires_at > p_at
      ) then 'wrong_store' else 'code_unknown' end;
  elsif v_found.status = 'issued' and v_found.expires_at > p_at then
    return query select v_found.membership_id, v_found.id, null::text;
  elsif v_found.status in ('issued', 'expired') and v_found.reason is distinct from 'staff_confirmed' then
    return query select null::uuid, null::uuid, 'code_expired'::text;
  else
    return query select null::uuid, null::uuid, 'code_used'::text;
  end if;
end;
$$;

comment on function app.loyalty_parse_member_code(uuid, text, timestamptz) is 'reads a member''s dynamic code (six digits or fnb-member:1:<store code>:<code>) at a store: the membership and check-in row of a live code, or the refusal wrong_store, code_unknown, code_expired or code_used (a code closed by a bill); 22023 for anything else; internal';

-- 4. Staff: record a bill -----------------------------------------------------------------------

create function app.staff_submit_bill(p_store_id uuid, p_code text, p_bill_no text, p_total numeric, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
  v_settings public.loyalty_store_settings;
  v_bill_no text := btrim(p_bill_no);
  v_locked timestamptz;
  v_code record;
  v_refusal text;
  v_bill uuid;
  v_state text;
  v_earn public.loyalty_ledger;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store records a bill there' using errcode = '42501';
  end if;
  if p_total is null or p_total <= 0 or p_total > 100000000 then
    raise exception 'a bill total is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  if v_bill_no is null or char_length(v_bill_no) not between 1 and 40 or v_bill_no ~ '[[:space:][:cntrl:]]' then
    raise exception 'a bill number holds 1 to 40 characters without spaces' using errcode = '22023';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'a bill takes the member''s code from the QR' using errcode = '22023';
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = p_store_id;
  if v_settings.confirmation is distinct from 'staff' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_staff_mode', 'bill_id', null);
  end if;

  v_locked := app.code_attempt_gate('staff_submit_bill', v_store.tenant_id, p_store_id, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'locked', 'bill_id', null, 'retry_at', v_locked);
  end if;
  select c.* into v_code from app.loyalty_parse_member_code(p_store_id, p_code, p_at) c;
  if v_code.refusal is not null then
    if v_code.refusal in ('code_unknown', 'wrong_store') then
      perform app.code_attempt_record('staff_submit_bill', v_store.tenant_id, p_store_id, v_uid, p_at);
    end if;
    perform app.loyalty_audit(v_store.tenant_id, p_store_id, v_uid, 'bill_refused', null, null, p_total, jsonb_build_object('refusal', v_code.refusal), p_at);
    return jsonb_build_object('state', 'refused', 'refusal', v_code.refusal, 'bill_id', null);
  end if;

  -- one store at a time, so parallel bills cannot all pass the caps and the dedupe key
  perform pg_advisory_xact_lock(hashtextextended('fnb-bill:' || p_store_id::text, 0));
  v_refusal := app.bill_precheck(p_store_id, v_code.membership_id, v_bill_no, p_total, v_uid, null, p_at);
  if v_refusal is not null then
    perform app.loyalty_audit(v_store.tenant_id, p_store_id, v_uid, 'bill_refused', null, v_code.membership_id, p_total, jsonb_build_object('refusal', v_refusal), p_at);
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal, 'bill_id', null);
  end if;

  insert into public.bill_captures (tenant_id, store_id, membership_id, source, captured_by, business_date, bill_no, bill_key, total, state, confirm_by, created_at)
  values (v_store.tenant_id, p_store_id, v_code.membership_id, 'staff_scan', v_uid, app.store_business_date(p_store_id, p_at), v_bill_no,
    app.bill_key(v_bill_no), p_total, 'awaiting_customer', p_at + make_interval(hours => v_settings.bill_unconfirmed_hours), p_at)
  returning id into v_bill;
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at)
  values (v_store.tenant_id, v_bill, 'staff', p_total, true, v_uid, p_at);
  perform app.bill_earn(v_bill, true, p_at);
  update public.pending_checkins c
  set status = 'expired', reason = 'staff_confirmed', closed_at = p_at
  where c.id = v_code.checkin_id;
  perform app.loyalty_audit(v_store.tenant_id, p_store_id, v_uid, 'bill_recorded', v_bill, v_code.membership_id, p_total,
    jsonb_build_object('source', 'staff_scan'), p_at);
  v_state := app.bill_evaluate(v_bill, v_uid, p_at);
  perform app.bill_cap_warning(p_store_id, v_uid, p_at);
  select l.* into v_earn from public.loyalty_ledger l where l.bill_id = v_bill and l.entry_kind = 'earn';
  return jsonb_build_object(
    'state', v_state,
    'refusal', null,
    'bill_id', v_bill,
    'evidence_level', (select b.evidence_level from public.bill_captures b where b.id = v_bill),
    'stamps_earned', v_earn.stamp_delta,
    'points_earned', v_earn.point_delta,
    'recorded_at', p_at,
    'confirm_by', case when v_state = 'awaiting_customer' then p_at + make_interval(hours => v_settings.bill_unconfirmed_hours) end,
    'reverse_until', p_at + make_interval(mins => v_settings.reverse_window_minutes),
    'member', app.loyalty_member_summary(v_code.membership_id, p_at)
  );
end;
$$;

comment on function app.staff_submit_bill(uuid, text, text, numeric, timestamptz) is 'RPC core (staff Mini App, staff mode, plan phase 1): an owner, manager or staff member of the store scans the member''s dynamic QR and types the bill number and total; after app.bill_precheck the bill is recorded (evidence level 0, the staff reading), its earn (path E) is written pending and app.bill_evaluate decides: confirmed at once when bill_evidence_required_level is 0, queued above bill_manager_approval_above, otherwise awaiting_customer until the customer''s blind total or bill_unconfirmed_hours. Answers the state, bill id, level, stamps, points, deadlines and the masked member summary, or state refused with refusal not_staff_mode, locked, wrong_store, code_unknown, code_expired, code_used or a precheck refusal; the member code is single use; audited; 42501 outside the store, 22023 for a malformed code, number or total';

create function public.staff_submit_bill(p_store_id uuid, p_code text, p_bill_no text, p_total numeric)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_submit_bill(p_store_id, p_code, p_bill_no, p_total, now());
$$;

comment on function public.staff_submit_bill(uuid, text, text, numeric) is 'RPC: app.staff_submit_bill at now()';

-- 5. Customer: blind confirmation and dispute (plan phase 2) -----------------------------------------

create function app.customer_pending_bills(p_at timestamptz default now())
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
      'id', b.id,
      'store_name', s.name,
      'bill_no', b.bill_no,
      'recorded_at', b.created_at,
      'confirm_by', b.confirm_by
    ) order by b.created_at desc, b.id)
    from public.bill_captures b
    join public.stores s on s.id = b.store_id
    where b.membership_id = v_membership.id
      and b.state = 'awaiting_customer'
      and b.confirm_by > p_at
      and b.created_at <= p_at
      and not exists (select 1 from public.bill_confirmations c where c.bill_id = b.id and c.source = 'customer')
  ), '[]'::jsonb);
end;
$$;

comment on function app.customer_pending_bills(timestamptz) is 'RPC core (customer session): the bills of the customer''s membership waiting for their blind total: store name, bill number, when it was recorded and the deadline; never the total the staff member typed';

create function public.customer_pending_bills()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.customer_pending_bills(now());
$$;

comment on function public.customer_pending_bills() is 'RPC: app.customer_pending_bills at now()';

create function app.customer_confirm_bill(p_bill_id uuid, p_total numeric, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships := app.customer_session_membership();
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
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
  if v_bill.state <> 'awaiting_customer'
    or exists (select 1 from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'customer')
  then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_answered');
  end if;
  if v_bill.confirm_by <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'too_late');
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  v_agrees := abs(v_bill.total - p_total) <= v_settings.bill_amount_tolerance;
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at)
  values (v_bill.tenant_id, p_bill_id, 'customer', p_total, v_agrees, (select auth.uid()), p_at);
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'bill_answered', p_bill_id, v_bill.membership_id, p_total,
    jsonb_build_object('agrees', v_agrees), p_at);
  v_state := app.bill_evaluate(p_bill_id, null, p_at);
  return jsonb_build_object(
    'state', v_state,
    'refusal', null,
    'evidence_level', (select b.evidence_level from public.bill_captures b where b.id = p_bill_id)
  );
end;
$$;

comment on function app.customer_confirm_bill(uuid, numeric, timestamptz) is 'RPC core (customer session, plan phase 2): the customer types the total they paid for one of their bills waiting for them, without seeing the staff total; one answer per bill; agreeing within bill_amount_tolerance gives level 2 (confirmed at once unless the bill needs a manager), disagreeing queues it (disagreement). Refusals unknown_bill (not a bill of this member: no existence oracle), already_answered and too_late; audited; 22023 for a total out of range';

create function public.customer_confirm_bill(p_bill_id uuid, p_total numeric)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.customer_confirm_bill(p_bill_id, p_total, now());
$$;

comment on function public.customer_confirm_bill(uuid, numeric) is 'RPC: app.customer_confirm_bill at now()';

create function app.customer_dispute_bill(p_bill_id uuid, p_at timestamptz default now())
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
  if v_bill.state <> 'awaiting_customer'
    or exists (select 1 from public.bill_confirmations c where c.bill_id = p_bill_id and c.source = 'customer')
  then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_answered');
  end if;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'bill_disputed', p_bill_id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
  perform app.bill_reverse(p_bill_id, 'disputed', null, p_at);
  return jsonb_build_object('state', 'reversed', 'refusal', null);
end;
$$;

comment on function app.customer_dispute_bill(uuid, timestamptz) is 'RPC core (customer session): "Không đúng" on a bill waiting for the customer: the bill is reversed (disputed), the earn clawed back, and loyalty_staff_anomaly raised for the staff member who recorded it; refusals unknown_bill and already_answered';

create function public.customer_dispute_bill(p_bill_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.customer_dispute_bill(p_bill_id, now());
$$;

comment on function public.customer_dispute_bill(uuid) is 'RPC: app.customer_dispute_bill at now()';

create function app.bill_expire_pending(p_tenant_id uuid default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_reversed integer := 0;
  v_confirmed integer := 0;
  v_expired integer := 0;
begin
  for v_bill in
    select b.id, b.state, b.tenant_id, b.store_id, b.membership_id, b.total, s.bill_silence_outcome
    from public.bill_captures b
    join public.loyalty_store_settings s on s.store_id = b.store_id
    where b.state in ('awaiting_customer', 'awaiting_staff')
      and b.confirm_by <= p_at
      and (p_tenant_id is null or b.tenant_id = p_tenant_id)
    order by b.confirm_by, b.id
  loop
    if v_bill.state = 'awaiting_staff' then
      update public.bill_captures b set state = 'expired', decided_at = p_at where b.id = v_bill.id and b.state = 'awaiting_staff';
      perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, null, 'bill_expired', v_bill.id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
      v_expired := v_expired + 1;
    elsif v_bill.bill_silence_outcome = 'confirm' then
      perform app.bill_confirm(v_bill.id, null, p_at);
      v_confirmed := v_confirmed + 1;
    else
      perform app.bill_reverse(v_bill.id, 'timed_out', null, p_at);
      v_reversed := v_reversed + 1;
    end if;
  end loop;
  return jsonb_build_object('reversed', v_reversed, 'confirmed', v_confirmed, 'expired', v_expired);
end;
$$;

comment on function app.bill_expire_pending(uuid, timestamptz) is 'the bill deadline job (every 10 minutes by pg_cron, and on demand): a staff bill still waiting for the customer at confirm_by is reversed (timed_out, with an alert) or confirmed at its own level, per the store''s bill_silence_outcome; a counter claim nobody answered expires without an earn; for one tenant or all; returns counts; service role only';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('loyalty-bill-deadlines', '*/10 * * * *', 'select app.bill_expire_pending(null, now())');
  end if;
end;
$$;

-- 6. Staff: counter QR and counter claims ------------------------------------------------------

create function app.staff_counter_code(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
  v_settings public.loyalty_store_settings;
  v_code public.loyalty_counter_codes;
  v_store_code text;
  v_attempt integer := 0;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store shows its counter QR' using errcode = '42501';
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = p_store_id;
  if v_settings.confirmation is distinct from 'staff' or not v_settings.self_claim then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_available');
  end if;
  v_store_code := app.customer_store_code(v_store.code, v_store.external_id);
  if v_store_code is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'no_store_code');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-counter-code:' || p_store_id::text, 0));
  select c.* into v_code
  from public.loyalty_counter_codes c
  where c.store_id = p_store_id
    and c.issued_at <= p_at
    and c.expires_at - p_at > make_interval(secs => v_settings.counter_code_ttl_seconds) / 2
  order by c.issued_at desc
  limit 1;
  if v_code.id is null then
    loop
      v_attempt := v_attempt + 1;
      begin
        insert into public.loyalty_counter_codes (tenant_id, store_id, token, issued_by, issued_at, expires_at)
        values (v_store.tenant_id, p_store_id, app.notify_random_code('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12), v_uid, p_at,
          p_at + make_interval(secs => v_settings.counter_code_ttl_seconds))
        returning * into v_code;
        exit;
      exception when unique_violation then
        if v_attempt >= 5 then
          raise;
        end if;
      end;
    end loop;
    perform app.loyalty_audit(v_store.tenant_id, p_store_id, v_uid, 'counter_code_issued', v_code.id, null, null, '{}'::jsonb, p_at);
  end if;
  return jsonb_build_object(
    'state', 'ready',
    'refusal', null,
    'qr_payload', 'fnb-counter:1:' || v_store_code || ':' || v_code.token,
    'store_code', v_store_code,
    'issued_at', v_code.issued_at,
    'expires_at', v_code.expires_at,
    'refresh_at', v_code.issued_at + make_interval(secs => v_settings.counter_code_ttl_seconds) / 2
  );
end;
$$;

comment on function app.staff_counter_code(uuid, timestamptz) is 'RPC core: the live counter QR of a store in staff mode with self claims (fnb-counter:1:<store code>:<12-character token>), reused while more than half of counter_code_ttl_seconds is left, otherwise a new one; refusal not_available outside that mode, no_store_code without a customer store code; 42501 outside the store';

create function public.staff_counter_code(p_store_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_counter_code(p_store_id, now());
$$;

comment on function public.staff_counter_code(uuid) is 'RPC: app.staff_counter_code at now()';

create function app.counter_claim_grace()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '120 seconds';
$$;

comment on function app.counter_claim_grace() is 'how long after its expiry a counter QR still accepts the claim of a customer who scanned it (time to type the bill): 120 seconds';

create function app.customer_submit_counter_claim(p_qr text, p_bill_no text, p_total numeric, p_at timestamptz default now())
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
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at)
  values (v_membership.tenant_id, v_bill, 'customer', p_total, true, v_uid, p_at);
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
    select l.* into v_earn from public.loyalty_ledger l where l.bill_id = v_bill and l.entry_kind = 'earn';
    return jsonb_build_object('state', 'confirmed', 'refusal', null, 'bill_id', v_bill, 'evidence_level', 0,
      'stamps_earned', v_earn.stamp_delta, 'points_earned', v_earn.point_delta);
  end if;
  return jsonb_build_object('state', 'awaiting_staff', 'refusal', null, 'bill_id', v_bill, 'evidence_level', 0, 'expires_at', p_at + interval '6 hours');
end;
$$;

comment on function app.customer_submit_counter_claim(text, text, numeric, timestamptz) is 'RPC core (customer session): a claim with the counter QR of a store in staff mode with self claims, the bill number and the total paid (the customer''s reading). Refuses locked (code-guessing limit), code_unknown, wrong_store (a QR of a store outside the customer''s app), not_available, code_expired (issued later than now, or more than 120 seconds past its expiry: no remote claims), code_used (one claim per member and QR), daily_limit (receipt_claims_per_phone_per_day counter claims a day) or a refusal of app.bill_precheck (dedupe, conflict alert, caps). Otherwise the bill waits 6 hours for a staff member''s blind total (awaiting_staff), or is confirmed at once at level 0 when the total is within auto_approve_max_amount and the store''s auto_approve_per_day is not used up; audited; 22023 for a malformed QR, number or total';

create function public.customer_submit_counter_claim(p_qr text, p_bill_no text, p_total numeric)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.customer_submit_counter_claim(p_qr, p_bill_no, p_total, now());
$$;

comment on function public.customer_submit_counter_claim(text, text, numeric) is 'RPC: app.customer_submit_counter_claim at now()';

create function app.staff_counter_claims(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store lists its counter claims' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'created_at', b.created_at,
      'expires_at', b.confirm_by,
      'bill_no', b.bill_no,
      'phone_masked', app.loyalty_masked_phone(k.phone),
      'display_name', nullif(btrim(k.name), '')
    ) order by b.created_at, b.id)
    from public.bill_captures b
    join public.memberships m on m.id = b.membership_id
    join public.customers k on k.id = m.customer_id
    where b.store_id = p_store_id
      and b.state = 'awaiting_staff'
      and b.confirm_by > p_at
      and b.created_at <= p_at
  ), '[]'::jsonb);
end;
$$;

comment on function app.staff_counter_claims(uuid, timestamptz) is 'RPC core: the counter claims of a store waiting for a staff member, oldest first, for its owners, managers and staff: masked phone, display name and bill number, never the customer''s total (the staff member types the total from the bill blind)';

create function public.staff_counter_claims(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_counter_claims(p_store_id, now());
$$;

comment on function public.staff_counter_claims(uuid) is 'RPC: app.staff_counter_claims at now()';

create function app.staff_answer_counter_claim(p_bill_id uuid, p_total numeric, p_reject_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reject_reason), '');
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
  v_refusal text;
  v_agrees boolean;
  v_state text;
  v_earn public.loyalty_ledger;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id;
  if v_bill.id is null or v_uid is null or v_bill.source <> 'counter_claim'
    or not app.has_store_scope(v_bill.tenant_id, v_bill.store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store answers its counter claims' using errcode = '42501';
  end if;
  if num_nonnulls(p_total, v_reason) <> 1 then
    raise exception 'a counter claim is answered with the bill total or rejected with a reason' using errcode = '22023';
  end if;
  if p_total is not null and (p_total <= 0 or p_total > 100000000) then
    raise exception 'a bill total is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  if v_reason is not null and (char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'a rejection states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-bill:' || v_bill.store_id::text, 0));
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.state <> 'awaiting_staff' then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_answered', 'bill_state', v_bill.state);
  end if;
  if v_bill.confirm_by <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'expired', 'bill_state', v_bill.state);
  end if;
  if v_reason is not null then
    update public.bill_captures b
    set state = 'rejected', decided_by = v_uid, decided_at = p_at, decision_reason = v_reason
    where b.id = p_bill_id;
    perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, v_uid, 'bill_rejected', p_bill_id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
    return jsonb_build_object('state', 'rejected', 'refusal', null, 'bill_state', 'rejected');
  end if;
  v_refusal := app.bill_precheck(v_bill.store_id, v_bill.membership_id, v_bill.bill_no, p_total, v_uid, p_bill_id, p_at);
  if v_refusal is not null then
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal, 'bill_state', v_bill.state);
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  v_agrees := abs(v_bill.total - p_total) <= v_settings.bill_amount_tolerance;
  insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees, entered_by, entered_at)
  values (v_bill.tenant_id, p_bill_id, 'staff', p_total, v_agrees, v_uid, p_at);
  update public.bill_captures b set captured_by = v_uid where b.id = p_bill_id;
  v_state := app.bill_evaluate(p_bill_id, v_uid, p_at);
  select l.* into v_earn from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  return jsonb_build_object(
    'state', v_state, 'refusal', null, 'bill_state', v_state,
    'evidence_level', (select b.evidence_level from public.bill_captures b where b.id = p_bill_id),
    'stamps_earned', coalesce(v_earn.stamp_delta, 0), 'points_earned', coalesce(v_earn.point_delta, 0)
  );
end;
$$;

comment on function app.staff_answer_counter_claim(uuid, numeric, text, timestamptz) is 'RPC core: an owner, manager or staff member of the store answers a waiting counter claim either with the total read from the bill (blind: the customer''s total is not shown) or with a rejection reason; agreeing totals give level 2 and confirm the bill (an earn of path E credited to that staff member) unless it needs a manager, disagreeing ones queue it; the staff member''s amount cap applies; refusals already_answered, expired and the precheck refusals; audited; 42501 outside the store, 22023 for anything but exactly one of total and reason';

create function public.staff_answer_counter_claim(p_bill_id uuid, p_total numeric, p_reject_reason text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_answer_counter_claim(p_bill_id, p_total, p_reject_reason, now());
$$;

comment on function public.staff_answer_counter_claim(uuid, numeric, text) is 'RPC: app.staff_answer_counter_claim at now()';

-- 7. Staff: recent bills, manager queue, reversal, audits (plan phase 3 controls) ---------------------

create function app.staff_recent_bills(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
  v_manager boolean;
  v_settings public.loyalty_store_settings;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store lists its bills' using errcode = '42501';
  end if;
  v_manager := app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager']::public.tenant_role[]);
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = p_store_id;
  return jsonb_build_object(
    'mode', v_settings.confirmation,
    'self_claim', v_settings.self_claim,
    'is_manager', v_manager,
    'bills', coalesce((
      select jsonb_agg(x.row order by x.created_at desc, x.id)
      from (
        select b.created_at, b.id, jsonb_build_object(
          'id', b.id,
          'created_at', b.created_at,
          'bill_no', b.bill_no,
          'total', b.total,
          'source', b.source,
          'state', b.state,
          'queue_reason', b.queue_reason,
          'reversal_reason', b.reversal_reason,
          'evidence_level', b.evidence_level,
          'by_me', b.captured_by is not distinct from v_uid,
          'recorded_by_name', app.loyalty_requester_name(b.tenant_id, b.captured_by),
          'phone_masked', app.loyalty_masked_phone(c.phone),
          'stamps', coalesce(l.stamp_delta, 0),
          'points', coalesce(l.point_delta, 0),
          'reverse_until', coalesce(b.confirmed_at, b.created_at) + make_interval(mins => v_settings.reverse_window_minutes),
          'reversible', v_manager and b.state in ('confirmed', 'awaiting_customer')
            and p_at <= coalesce(b.confirmed_at, b.created_at) + make_interval(mins => v_settings.reverse_window_minutes),
          'shadow_state', b.shadow_state
        ) as row
        from public.bill_captures b
        join public.memberships m on m.id = b.membership_id
        join public.customers c on c.id = m.customer_id
        left join public.loyalty_ledger l on l.bill_id = b.id and l.entry_kind = 'earn'
        where b.store_id = p_store_id
          and b.created_at <= p_at
          and b.created_at > p_at - interval '24 hours'
          and (v_manager or b.captured_by = v_uid)
        order by b.created_at desc, b.id
        limit 100
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.staff_recent_bills(uuid, timestamptz) is 'RPC core: the bills of the last 24 hours at a store, newest first (at most 100): every bill for an owner or manager, only their own for a staff member; masked phone only; state, evidence level and whether the caller may still reverse it; also the store''s mode and whether self claims are on';

create function public.staff_recent_bills(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_recent_bills(p_store_id, now());
$$;

comment on function public.staff_recent_bills(uuid) is 'RPC: app.staff_recent_bills at now()';

create function app.staff_bill_queue(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner', 'manager']::public.tenant_role[])
  then
    raise exception 'only an owner or manager of the store reads its bill queue' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'created_at', b.created_at,
        'bill_no', b.bill_no,
        'source', b.source,
        'queue_reason', b.queue_reason,
        'evidence_level', b.evidence_level,
        'staff_total', (select c.entered_total from public.bill_confirmations c where c.bill_id = b.id and c.source = 'staff'),
        'customer_total', (select c.entered_total from public.bill_confirmations c where c.bill_id = b.id and c.source = 'customer'),
        'recorded_by_name', app.loyalty_requester_name(b.tenant_id, b.captured_by),
        'own', b.captured_by is not distinct from v_uid,
        'phone_masked', app.loyalty_masked_phone(k.phone)
      ) order by b.created_at, b.id)
      from public.bill_captures b
      join public.memberships m on m.id = b.membership_id
      join public.customers k on k.id = m.customer_id
      where b.store_id = p_store_id and b.state = 'queued'
    ), '[]'::jsonb),
    'audits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'bill_id', b.id,
        'opened_at', a.opened_at,
        'bill_no', b.bill_no,
        'total', b.total,
        'evidence_level', b.evidence_level,
        'has_photo', b.photo_path is not null,
        'recorded_by_name', app.loyalty_requester_name(b.tenant_id, b.captured_by),
        'phone_masked', app.loyalty_masked_phone(k.phone)
      ) order by a.opened_at, a.id)
      from public.bill_audits a
      join public.bill_captures b on b.id = a.bill_id
      join public.memberships m on m.id = b.membership_id
      join public.customers k on k.id = m.customer_id
      where a.store_id = p_store_id and a.state = 'open'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.staff_bill_queue(uuid, timestamptz) is 'RPC core: the manager queue of a store for its owners and managers: queued bills (over_approval, disagreement) with both readings and who recorded them, and the open random audits';

create function public.staff_bill_queue(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_bill_queue(p_store_id, now());
$$;

comment on function public.staff_bill_queue(uuid) is 'RPC: app.staff_bill_queue at now()';

create function app.staff_decide_bill(p_bill_id uuid, p_decision text, p_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_bill public.bill_captures;
  v_owner boolean;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.id is null or v_uid is null
    or not app.has_store_scope(v_bill.tenant_id, v_bill.store_id, array['owner', 'manager']::public.tenant_role[])
  then
    raise exception 'only an owner or manager of the store decides its queued bills' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'a decision is approved or rejected' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a decision states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  if v_bill.state <> 'queued' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_queued', 'bill_state', v_bill.state);
  end if;
  v_owner := app.has_store_scope(v_bill.tenant_id, v_bill.store_id, array['owner']::public.tenant_role[]);
  if p_decision = 'approved' and v_bill.captured_by = v_uid and not v_owner then
    return jsonb_build_object('state', 'refused', 'refusal', 'own_bill', 'bill_state', v_bill.state);
  end if;
  update public.bill_captures b set decision_reason = v_reason where b.id = p_bill_id;
  if p_decision = 'approved' then
    perform app.bill_confirm(p_bill_id, v_uid, p_at);
  else
    perform app.bill_reverse(p_bill_id, 'manager_rejected', v_uid, p_at);
  end if;
  return jsonb_build_object('state', p_decision, 'refusal', null,
    'bill_state', (select b.state from public.bill_captures b where b.id = p_bill_id));
end;
$$;

comment on function app.staff_decide_bill(uuid, text, text, timestamptz) is 'RPC core: an owner or manager of the store approves (the bill is confirmed, its earn credited) or rejects (the earn clawed back, or a bill without one rejected) a queued bill with a reason; a manager may not approve a bill they recorded (own_bill), an owner may; refusal not_queued; audited; 42501 for anyone else, 22023 for another decision or no reason';

create function public.staff_decide_bill(p_bill_id uuid, p_decision text, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_decide_bill(p_bill_id, p_decision, p_reason, now());
$$;

comment on function public.staff_decide_bill(uuid, text, text) is 'RPC: app.staff_decide_bill at now()';

create function app.staff_reverse_bill(p_bill_id uuid, p_reason text, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(p_reason);
  v_bill public.bill_captures;
  v_settings public.loyalty_store_settings;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.id is null or v_uid is null
    or not app.has_store_scope(v_bill.tenant_id, v_bill.store_id, array['owner', 'manager']::public.tenant_role[])
  then
    raise exception 'only an owner or manager of the store reverses a bill there' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a reversal states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  if v_bill.state not in ('confirmed', 'awaiting_customer') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_reversible', 'bill_state', v_bill.state);
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_bill.store_id;
  if p_at > coalesce(v_bill.confirmed_at, v_bill.created_at) + make_interval(mins => v_settings.reverse_window_minutes) then
    return jsonb_build_object('state', 'refused', 'refusal', 'window_passed', 'bill_state', v_bill.state);
  end if;
  update public.bill_captures b set decision_reason = v_reason where b.id = p_bill_id;
  perform app.bill_reverse(p_bill_id, 'manager_reversed', v_uid, p_at);
  return jsonb_build_object('state', 'reversed', 'refusal', null, 'bill_state', 'reversed', 'reversed_at', p_at);
end;
$$;

comment on function app.staff_reverse_bill(uuid, text, timestamptz) is 'RPC core: an owner or manager of the store reverses a confirmed or waiting bill within reverse_window_minutes of its confirmation (or recording) with a reason: a clawback row, its active stamps clawed back, an alert; refusals not_reversible and window_passed (later corrections use an adjustment); 42501 for anyone else, 22023 without a reason';

create function public.staff_reverse_bill(p_bill_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_reverse_bill(p_bill_id, p_reason, now());
$$;

comment on function public.staff_reverse_bill(uuid, text) is 'RPC: app.staff_reverse_bill at now()';

create function app.staff_close_bill_audit(p_audit_id uuid, p_result text, p_note text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note text := nullif(btrim(p_note), '');
  v_audit public.bill_audits;
  v_bill public.bill_captures;
begin
  select a.* into v_audit from public.bill_audits a where a.id = p_audit_id for update;
  if v_audit.id is null or v_uid is null
    or not app.has_store_scope(v_audit.tenant_id, v_audit.store_id, array['owner', 'manager']::public.tenant_role[])
  then
    raise exception 'only an owner or manager of the store closes its bill audits' using errcode = '42501';
  end if;
  if p_result is null or p_result not in ('passed', 'failed') then
    raise exception 'an audit is passed or failed' using errcode = '22023';
  end if;
  if (p_result = 'failed' and v_note is null) or (v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]')) then
    raise exception 'a failed audit states its note in 1 to 200 characters' using errcode = '22023';
  end if;
  if v_audit.state <> 'open' then
    return jsonb_build_object('state', 'refused', 'refusal', 'closed');
  end if;
  select b.* into v_bill from public.bill_captures b where b.id = v_audit.bill_id;
  if p_result = 'passed' and v_bill.captured_by = v_uid
    and not app.has_store_scope(v_audit.tenant_id, v_audit.store_id, array['owner']::public.tenant_role[])
  then
    return jsonb_build_object('state', 'refused', 'refusal', 'own_bill');
  end if;
  update public.bill_audits a set state = p_result, closed_by = v_uid, closed_at = p_at, note = v_note where a.id = p_audit_id;
  perform app.loyalty_audit(v_audit.tenant_id, v_audit.store_id, v_uid, 'audit_closed', v_audit.id, v_bill.membership_id, v_bill.total,
    jsonb_build_object('result', p_result), p_at);
  if p_result = 'failed' then
    perform app.bill_reverse(v_audit.bill_id, 'audit_failed', v_uid, p_at);
  end if;
  return jsonb_build_object('state', p_result, 'refusal', null);
end;
$$;

comment on function app.staff_close_bill_audit(uuid, text, text, timestamptz) is 'RPC core: an owner or manager of the store closes a random bill audit as passed or failed (with a note); a failed audit reverses the bill (audit_failed, no time window) and alerts, counting against the staff member; a manager may not pass an audit of their own bill (own_bill); refusal closed; 42501 for anyone else';

create function public.staff_close_bill_audit(p_audit_id uuid, p_result text, p_note text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_close_bill_audit(p_audit_id, p_result, p_note, now());
$$;

comment on function public.staff_close_bill_audit(uuid, text, text) is 'RPC: app.staff_close_bill_audit at now()';

-- 8. Redemptions confirmed by staff ----------------------------------------------------------

create function app.staff_confirm_redemption(p_redemption_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_redemption public.redemptions;
  v_settings public.loyalty_store_settings;
  v_hold public.loyalty_ledger;
  v_today date;
  v_count integer;
  v_refusal text;
begin
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id;
  if v_redemption.id is null or v_uid is null or v_redemption.store_id is null
    or not app.has_store_scope(v_redemption.tenant_id, v_redemption.store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store confirms a reward there' using errcode = '42501';
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_redemption.store_id;
  perform pg_advisory_xact_lock(hashtextextended('fnb-bill:' || v_redemption.store_id::text, 0));
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id for update;
  v_today := app.store_business_date(v_redemption.store_id, p_at);

  if v_settings.confirmation is distinct from 'staff' then
    v_refusal := 'not_staff_mode';
  elsif v_redemption.state = 'confirmed' then
    v_refusal := 'used';
  elsif v_redemption.state in ('released', 'cancelled') then
    v_refusal := 'released';
  elsif v_redemption.hold_expires_at <= p_at then
    v_refusal := 'expired';
  elsif v_redemption.verified_at is null then
    v_refusal := 'not_verified';
  elsif exists (
    select 1 from public.bill_captures b
    where b.membership_id = v_redemption.membership_id and b.captured_by = v_uid and b.business_date = v_today
      and b.state not in ('rejected', 'expired', 'reversed')
  ) then
    v_refusal := 'same_staff';
  else
    select count(*) into v_count
    from public.redemptions r
    where r.store_id = v_redemption.store_id
      and r.confirmed_by = v_uid
      and r.confirmed_at is not null
      and app.store_business_date(r.store_id, r.confirmed_at) = v_today;
    if v_count >= v_settings.staff_redemptions_per_day then
      v_refusal := 'staff_daily_cap';
    end if;
  end if;
  if v_refusal is not null then
    perform app.loyalty_audit(v_redemption.tenant_id, v_redemption.store_id, v_uid, 'redemption_refused', v_redemption.id, v_redemption.membership_id, null,
      jsonb_build_object('refusal', v_refusal), p_at);
    if v_refusal = 'staff_daily_cap' then
      perform app.loyalty_staff_alert(v_redemption.tenant_id, v_redemption.store_id, 'cap_reached',
        v_redemption.store_id::text || ':' || v_uid::text, jsonb_build_object('cap', 'staff_redemptions_per_day'), p_at);
    end if;
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal);
  end if;

  update public.redemptions r
  set state = 'confirmed', confirmed_at = p_at, confirmed_by = v_uid
  where r.id = v_redemption.id;
  select l.* into v_hold from public.loyalty_ledger l where l.id = v_redemption.redeem_entry_id;
  if v_hold.id is not null and v_hold.pending then
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, business_date, source_entry_id, reason, approved_by, occurred_at)
    values (v_hold.tenant_id, v_hold.programme_id, v_hold.membership_id, v_hold.store_id, 'confirm', v_today, v_hold.id, 'staff_confirmed', v_uid, p_at)
    on conflict (source_entry_id) where entry_kind = 'confirm' do nothing;
  end if;
  if v_redemption.coupon_code_id is not null then
    update public.coupon_codes k
    set state = 'used', used_at = p_at
    where k.id = v_redemption.coupon_code_id and k.state in ('available', 'assigned');
  end if;
  perform app.loyalty_audit(v_redemption.tenant_id, v_redemption.store_id, v_uid, 'redemption_confirmed', v_redemption.id, v_redemption.membership_id, null,
    jsonb_build_object('rail', v_redemption.rail), p_at);
  return jsonb_build_object(
    'state', 'confirmed',
    'refusal', null,
    'redemption_id', v_redemption.id,
    'confirmed_at', p_at,
    'void_until', p_at + make_interval(mins => v_settings.reverse_window_minutes),
    'pos_discount_name', v_redemption.pos_discount_name
  );
end;
$$;

comment on function app.staff_confirm_redemption(uuid, timestamptz) is 'RPC core (staff mode): after staff_verify_redemption, an owner, manager or staff member of the store confirms the held reward at once (state held -> confirmed, confirmed_by, a confirm row with reason staff_confirmed and no invoice, a pool code marked used); the cashier then applies the named manual discount on any POS. Refusals not_staff_mode, used, released, expired, not_verified, same_staff (the confirming staff member recorded a bill for this member today: earn by one, redeem by another) and staff_daily_cap (staff_redemptions_per_day, raises loyalty_staff_anomaly); audited; 42501 outside the store';

create function public.staff_confirm_redemption(p_redemption_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_confirm_redemption(p_redemption_id, now());
$$;

comment on function public.staff_confirm_redemption(uuid) is 'RPC: app.staff_confirm_redemption at now()';

create function app.staff_void_redemption(p_redemption_id uuid, p_reason text, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(p_reason);
  v_redemption public.redemptions;
  v_settings public.loyalty_store_settings;
  v_hold public.loyalty_ledger;
  v_entry uuid;
begin
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id for update;
  if v_redemption.id is null or v_uid is null or v_redemption.store_id is null
    or not app.has_store_scope(v_redemption.tenant_id, v_redemption.store_id, array['owner', 'manager']::public.tenant_role[])
  then
    raise exception 'only an owner or manager of the store voids a confirmed reward there' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a void states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  select s.* into v_settings from public.loyalty_store_settings s where s.store_id = v_redemption.store_id;
  if v_redemption.state = 'cancelled' then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_voided');
  end if;
  if v_redemption.state <> 'confirmed' or v_redemption.confirmed_by is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_staff_confirmed');
  end if;
  if p_at > v_redemption.confirmed_at + make_interval(mins => v_settings.reverse_window_minutes) then
    return jsonb_build_object('state', 'refused', 'refusal', 'window_passed');
  end if;
  select l.* into v_hold from public.loyalty_ledger l where l.id = v_redemption.redeem_entry_id;
  if v_hold.id is not null and (v_hold.stamp_delta <> 0 or v_hold.point_delta <> 0) then
    insert into public.loyalty_ledger (
      tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
      business_date, source_entry_id, reason, approved_by, occurred_at
    )
    values (
      v_hold.tenant_id, v_hold.programme_id, v_hold.membership_id, v_hold.store_id, 'adjust', -v_hold.stamp_delta, -v_hold.point_delta,
      -v_hold.value_amount, app.store_business_date(v_hold.store_id, p_at), v_hold.id, 'redemption_released', v_uid, p_at
    )
    returning id into v_entry;
    update public.stamps s
    set state = 'active', closed_entry_id = null, closed_at = null
    where s.closed_entry_id = v_hold.id and s.state = 'redeemed';
  end if;
  update public.redemptions r
  set state = 'cancelled', released_at = p_at, release_entry_id = v_entry, voided_by = v_uid, void_reason = v_reason
  where r.id = v_redemption.id;
  if v_redemption.coupon_code_id is not null then
    update public.coupon_codes k
    set state = 'quarantined', quarantined_at = p_at
    where k.id = v_redemption.coupon_code_id and k.state in ('available', 'assigned', 'used');
  end if;
  perform app.loyalty_audit(v_redemption.tenant_id, v_redemption.store_id, v_uid, 'redemption_voided', v_redemption.id, v_redemption.membership_id, null,
    jsonb_build_object('confirmed_by_self', v_redemption.confirmed_by = v_uid), p_at);
  return jsonb_build_object('state', 'voided', 'refusal', null, 'redemption_id', v_redemption.id, 'voided_at', p_at);
end;
$$;

comment on function app.staff_void_redemption(uuid, text, timestamptz) is 'RPC core: an owner or manager of the store voids a staff-confirmed reward within reverse_window_minutes with a reason (state confirmed -> cancelled): an adjust row with reason redemption_released gives the stamps and points back, the stamps it closed are active again, a pool code is quarantined; refusals already_voided, not_staff_confirmed and window_passed; audited; 42501 for anyone else, 22023 without a reason';

create function public.staff_void_redemption(p_redemption_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.staff_void_redemption(p_redemption_id, p_reason, now());
$$;

comment on function public.staff_void_redemption(uuid, text) is 'RPC: app.staff_void_redemption at now()';

-- 9. Security ------------------------------------------------------------------------------

alter table public.loyalty_store_settings enable row level security;
alter table public.loyalty_audit_events enable row level security;
alter table public.loyalty_counter_codes enable row level security;
alter table public.bill_captures enable row level security;
alter table public.bill_confirmations enable row level security;
alter table public.bill_audits enable row level security;

create policy loyalty_store_settings_select_for_loyalty_readers on public.loyalty_store_settings
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_store_ids())::uuid[]));
create policy loyalty_audit_events_select_for_managers on public.loyalty_audit_events
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_manager_store_ids())::uuid[]));
create policy bill_captures_select_for_loyalty_readers on public.bill_captures
  for select to authenticated
  using (
    store_id = any ((select app.current_user_loyalty_store_ids())::uuid[])
    or (captured_by = (select auth.uid()) and store_id = any ((select app.current_user_store_ids())::uuid[]))
  );
create policy bill_confirmations_select_for_managers on public.bill_confirmations
  for select to authenticated
  using (exists (
    select 1 from public.bill_captures b
    where b.id = bill_confirmations.bill_id and b.store_id = any ((select app.current_user_loyalty_manager_store_ids())::uuid[])
  ));
create policy bill_audits_select_for_managers on public.bill_audits
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_manager_store_ids())::uuid[]));

revoke all on public.loyalty_store_settings, public.loyalty_audit_events, public.loyalty_counter_codes,
  public.bill_captures, public.bill_confirmations, public.bill_audits from anon;
revoke insert, update, delete, truncate, references, trigger on public.loyalty_store_settings, public.loyalty_audit_events,
  public.bill_captures, public.bill_confirmations, public.bill_audits from authenticated;
revoke all on public.loyalty_counter_codes from authenticated;
grant select on public.loyalty_store_settings, public.loyalty_audit_events, public.bill_captures, public.bill_confirmations, public.bill_audits to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'app.create_loyalty_store_settings()', 'app.loyalty_store_mode(uuid)',
    'app.loyalty_audit(uuid, uuid, uuid, text, uuid, uuid, numeric, jsonb, timestamptz)',
    'app.loyalty_staff_alert(uuid, uuid, text, text, jsonb, timestamptz, public.alert_severity)',
    'app.set_loyalty_store_settings(uuid, jsonb, timestamptz)', 'app.bill_key(text)',
    'app.bill_earn(uuid, boolean, timestamptz)', 'app.bill_confirm(uuid, uuid, timestamptz)', 'app.bill_reverse(uuid, text, uuid, timestamptz)',
    'app.bill_evaluate(uuid, uuid, timestamptz)', 'app.bill_precheck(uuid, uuid, text, numeric, uuid, uuid, timestamptz)',
    'app.bill_cap_warning(uuid, uuid, timestamptz)', 'app.loyalty_parse_member_code(uuid, text, timestamptz)',
    'app.staff_submit_bill(uuid, text, text, numeric, timestamptz)', 'app.customer_pending_bills(timestamptz)',
    'app.customer_confirm_bill(uuid, numeric, timestamptz)', 'app.customer_dispute_bill(uuid, timestamptz)',
    'app.bill_expire_pending(uuid, timestamptz)', 'app.staff_counter_code(uuid, timestamptz)', 'app.counter_claim_grace()',
    'app.customer_submit_counter_claim(text, text, numeric, timestamptz)', 'app.staff_counter_claims(uuid, timestamptz)',
    'app.staff_answer_counter_claim(uuid, numeric, text, timestamptz)', 'app.staff_recent_bills(uuid, timestamptz)',
    'app.staff_bill_queue(uuid, timestamptz)', 'app.staff_decide_bill(uuid, text, text, timestamptz)',
    'app.staff_reverse_bill(uuid, text, timestamptz)', 'app.staff_close_bill_audit(uuid, text, text, timestamptz)',
    'app.staff_confirm_redemption(uuid, timestamptz)', 'app.staff_void_redemption(uuid, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'public.set_loyalty_store_settings(uuid, jsonb)', 'public.staff_submit_bill(uuid, text, text, numeric)',
    'public.customer_pending_bills()', 'public.customer_confirm_bill(uuid, numeric)', 'public.customer_dispute_bill(uuid)',
    'public.staff_counter_code(uuid)', 'public.customer_submit_counter_claim(text, text, numeric)', 'public.staff_counter_claims(uuid)',
    'public.staff_answer_counter_claim(uuid, numeric, text)', 'public.staff_recent_bills(uuid)', 'public.staff_bill_queue(uuid)',
    'public.staff_decide_bill(uuid, text, text)', 'public.staff_reverse_bill(uuid, text)', 'public.staff_close_bill_audit(uuid, text, text)',
    'public.staff_confirm_redemption(uuid)', 'public.staff_void_redemption(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$$;
