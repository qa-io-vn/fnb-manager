-- Per-store confirmation source for loyalty (POS-independent "staff" mode).
--
-- Until now an earn of path B or C and a redemption of the discount rail were
-- confirmed only by a synced POS invoice. A store may now choose
-- loyalty_confirmation = 'staff': the staff Mini App records the paper bill
-- (bill number and total) after scanning the member's dynamic QR, and the
-- evidence ladder of docs/deep-dives/bill-verification-plan.md decides when
-- the earn is confirmed (path E, bill_captures, migration 20261120510000).
-- 'pos_sync' (the default for every store, existing and new) keeps today's
-- behaviour. This file holds the per-store settings, the audit trail, the
-- ledger and redemption constraint changes, the code-guessing policies and
-- the alert rule, and turns the POS-matched paths off at a staff-mode store.

-- 1. Settings ---------------------------------------------------------------

create table public.loyalty_store_settings (
  store_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  confirmation text not null default 'pos_sync' check (confirmation in ('pos_sync', 'staff')),
  max_bill_amount numeric(14, 2) not null default 2000000 check (max_bill_amount > 0 and max_bill_amount <= 100000000),
  bill_evidence_required_level smallint not null default 2 check (bill_evidence_required_level between 0 and 2),
  bill_manager_approval_above numeric(14, 2) not null default 1000000 check (bill_manager_approval_above > 0),
  bill_amount_tolerance numeric(14, 2) not null default 1000 check (bill_amount_tolerance between 0 and 100000),
  bill_unconfirmed_hours smallint not null default 24 check (bill_unconfirmed_hours between 1 and 168),
  bill_silence_outcome text not null default 'reverse' check (bill_silence_outcome in ('reverse', 'confirm')),
  bill_staff_shift_cap smallint not null default 25 check (bill_staff_shift_cap between 1 and 1000),
  staff_amount_per_day numeric(14, 2) not null default 30000000 check (staff_amount_per_day > 0 and staff_amount_per_day <= 1000000000),
  store_earns_per_day smallint not null default 400 check (store_earns_per_day between 1 and 5000),
  staff_redemptions_per_day smallint not null default 50 check (staff_redemptions_per_day between 1 and 1000),
  reverse_window_minutes smallint not null default 480 check (reverse_window_minutes between 15 and 1440),
  bill_audit_sample_pct numeric(5, 2) not null default 2 check (bill_audit_sample_pct between 0 and 100),
  self_claim boolean not null default false,
  counter_code_ttl_seconds smallint not null default 90 check (counter_code_ttl_seconds between 30 and 600),
  auto_approve_max_amount numeric(14, 2) not null default 0 check (auto_approve_max_amount >= 0),
  auto_approve_per_day smallint not null default 0 check (auto_approve_per_day between 0 and 500),
  bill_photo_retention_days smallint not null default 90 check (bill_photo_retention_days between 1 and 365),
  bill_reader_mode text not null default 'off' check (bill_reader_mode in ('off', 'mock')),
  shadow_reconcile boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (auto_approve_max_amount <= max_bill_amount),
  check (bill_manager_approval_above <= max_bill_amount)
);

comment on table public.loyalty_store_settings is 'per store: what confirms a loyalty earn or redemption (pos_sync: a synced POS invoice, the default; staff: the bill evidence ladder in the staff and customer Mini Apps, no POS needed) and the limits of the staff mode; one row per store, created with the store; written only through set_loyalty_store_settings by an owner';
comment on column public.loyalty_store_settings.confirmation is 'pos_sync: earns of paths B and C and discount-rail redemptions wait for a synced invoice; staff: bills recorded in the staff Mini App earn (path E) and staff confirm rewards at once; the POS-matched paths A to D do not earn at this store and a sync only feeds the shadow check';
comment on column public.loyalty_store_settings.max_bill_amount is 'the largest bill total a staff mode earn may carry; larger is refused';
comment on column public.loyalty_store_settings.bill_evidence_required_level is 'the evidence level a bill needs before its earn is confirmed: 0 the staff member''s typed total alone, 1 one reading (camera reader, later), 2 two agreeing readings (the staff total and the customer''s blind total)';
comment on column public.loyalty_store_settings.bill_manager_approval_above is 'a staff-recorded bill above this total waits in the manager queue whatever its evidence';
comment on column public.loyalty_store_settings.bill_amount_tolerance is 'two readings of a total agree when they differ by at most this amount';
comment on column public.loyalty_store_settings.bill_unconfirmed_hours is 'how long a bill below the required level waits for the customer''s answer before bill_silence_outcome applies';
comment on column public.loyalty_store_settings.bill_silence_outcome is 'what happens to a bill the customer never answered: reverse (a clawback and an alert, the default) or confirm at its own level';
comment on column public.loyalty_store_settings.bill_staff_shift_cap is 'how many unreviewed (evidence level 0 or 1) bills one staff member may record at the store in a business day; an alert fires at 70 %';
comment on column public.loyalty_store_settings.staff_amount_per_day is 'the total of the bills one staff member may record at the store in a business day';
comment on column public.loyalty_store_settings.store_earns_per_day is 'how many bills the store may record in a business day, auto-approved counter claims included';
comment on column public.loyalty_store_settings.staff_redemptions_per_day is 'how many rewards one staff member may confirm at the store in a business day';
comment on column public.loyalty_store_settings.reverse_window_minutes is 'how long after a confirmation a manager may still reverse the earn or void the redemption (the shift); later corrections go through an adjustment';
comment on column public.loyalty_store_settings.bill_audit_sample_pct is 'the share of confirmed bills put in the manager queue for a random audit';
comment on column public.loyalty_store_settings.self_claim is 'whether customers may claim with the counter QR shown in the staff Mini App';
comment on column public.loyalty_store_settings.counter_code_ttl_seconds is 'how long one counter QR is valid; the staff Mini App replaces it before half of that time has passed';
comment on column public.loyalty_store_settings.auto_approve_max_amount is 'a counter claim up to this total is confirmed at once at level 0 (0: never), within auto_approve_per_day: an owner-accepted risk, bounded and audited';
comment on column public.loyalty_store_settings.auto_approve_per_day is 'how many counter claims the store may approve automatically in a business day';
comment on column public.loyalty_store_settings.bill_photo_retention_days is 'how long a bill photo is kept (phase 4 of the bill verification plan; stored now so the knob exists)';
comment on column public.loyalty_store_settings.bill_reader_mode is 'the bill photo reader: off, or mock for tests (phase 4; live and sample come with phase 6)';
comment on column public.loyalty_store_settings.shadow_reconcile is 'in staff mode, whether bills are matched in the background with synced invoices when the store also has a POS sync; a mismatch is only flagged';

insert into public.loyalty_store_settings (store_id, tenant_id)
select s.id, s.tenant_id from public.stores s
on conflict (store_id) do nothing;

create function app.create_loyalty_store_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.loyalty_store_settings (store_id, tenant_id)
  values (new.id, new.tenant_id)
  on conflict (store_id) do nothing;
  return null;
end;
$$;

comment on function app.create_loyalty_store_settings() is 'trigger after a store is added: its loyalty_store_settings row with the defaults (pos_sync)';

create trigger stores_create_loyalty_settings
after insert on public.stores
for each row execute function app.create_loyalty_store_settings();

create function app.loyalty_store_mode(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.confirmation from public.loyalty_store_settings s where s.store_id = p_store_id), 'pos_sync');
$$;

comment on function app.loyalty_store_mode(uuid) is 'the loyalty confirmation source of a store: pos_sync (also when the store has no settings row) or staff';

-- 2. Audit trail --------------------------------------------------------------

create table public.loyalty_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (action in (
    'settings_changed', 'bill_recorded', 'bill_refused', 'bill_answered', 'bill_disputed', 'bill_queued', 'bill_confirmed',
    'bill_reversed', 'bill_rejected', 'bill_expired', 'bill_conflict', 'bill_photo_attached', 'audit_opened', 'audit_closed',
    'counter_code_issued', 'redemption_confirmed', 'redemption_refused', 'redemption_voided', 'shadow_flagged'
  )),
  subject_id uuid,
  membership_id uuid,
  amount numeric(14, 2),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.loyalty_audit_events is 'the audit trail of the staff confirmation mode: every settings change, bill (recorded, refused, answered by the customer, disputed, queued, confirmed, reversed, rejected, expired, conflicting), random audit, counter QR issue, staff redemption confirmation or void and shadow flag, with the acting user (null for the customer or a job), the subject row and the amount; details never hold a phone, a code or a name; append-only for API roles, a data-subject erasure only blanks membership_id';

create index loyalty_audit_events_store_idx on public.loyalty_audit_events (store_id, occurred_at desc);
create index loyalty_audit_events_actor_idx on public.loyalty_audit_events (actor, occurred_at desc) where actor is not null;
create index loyalty_audit_events_membership_idx on public.loyalty_audit_events (membership_id) where membership_id is not null;

create function app.loyalty_audit(
  p_tenant_id uuid, p_store_id uuid, p_actor uuid, p_action text, p_subject_id uuid,
  p_membership_id uuid, p_amount numeric, p_details jsonb, p_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.loyalty_audit_events (tenant_id, store_id, actor, action, subject_id, membership_id, amount, details, occurred_at)
  values (p_tenant_id, p_store_id, p_actor, p_action, p_subject_id, p_membership_id, p_amount, coalesce(p_details, '{}'::jsonb), p_at);
$$;

comment on function app.loyalty_audit(uuid, uuid, uuid, text, uuid, uuid, numeric, jsonb, timestamptz) is 'appends one loyalty_audit_events row; internal';

-- 3. Redemptions confirmed by staff, refusals of the POS paths ------------------

alter table public.loyalty_refusals drop constraint loyalty_refusals_reason_check;
alter table public.loyalty_refusals add constraint loyalty_refusals_reason_check check (reason in (
  'below_minimum', 'daily_cap', 'excluded_phone', 'excluded_source', 'already_earned', 'invoice_not_completed',
  'programme_inactive', 'membership_inactive', 'staff_mode'
));

alter table public.redemptions add column confirmed_by uuid references auth.users (id) on delete set null;
alter table public.redemptions add column voided_by uuid references auth.users (id) on delete set null;
alter table public.redemptions add column void_reason text check (void_reason is null or (char_length(void_reason) between 1 and 200 and void_reason !~ '[[:cntrl:]]'));
alter table public.redemptions drop constraint redemptions_check1;
alter table public.redemptions add constraint redemptions_check1 check (
  state <> 'confirmed' or (confirmed_at is not null and (confirmed_invoice_id is not null or confirmed_by is not null))
);
alter table public.redemptions add constraint redemptions_void_check check ((voided_by is null and void_reason is null) or (state = 'cancelled' and void_reason is not null));
comment on column public.redemptions.confirmed_by is 'the staff member who confirmed the redemption at a store in staff mode; then confirmed_invoice_id is only the shadow match, if any';
comment on column public.redemptions.voided_by is 'the manager who voided a staff-confirmed redemption within the reverse window (state cancelled, stamps and points given back)';

-- 4. Code-guessing limits for the new endpoints -------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('staff_submit_bill', 'misses', 5, 20, interval '15 minutes', interval '15 minutes'),
  ('customer_counter_claim', 'misses', 5, 50, interval '15 minutes', interval '15 minutes');

-- 5. Owner/manager alerts ----------------------------------------------------------

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('loyalty_staff_anomaly', 'operations', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{}', '{}', interval '1 hour', null, false, true, 280);

create function app.loyalty_staff_alert(
  p_tenant_id uuid, p_store_id uuid, p_kind text, p_subject text, p_facts jsonb, p_at timestamptz,
  p_severity public.alert_severity default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from app.raise_alert(
    p_tenant_id, 'loyalty_staff_anomaly', p_kind || ':' || p_subject, 'operations', p_at,
    p_store_id, null, null, app.store_business_date(p_store_id, p_at),
    jsonb_build_object('kind', p_kind) || coalesce(p_facts, '{}'::jsonb),
    p_severity, true
  );
end;
$$;

comment on function app.loyalty_staff_alert(uuid, uuid, text, text, jsonb, timestamptz, public.alert_severity) is 'raises the loyalty_staff_anomaly episode <kind>:<subject> of a store with count-only facts; kinds cap_warning (70 % of a cap), cap_reached, bill_conflict (a known bill number with another total, critical), disputed, timed_out, reversal, audit_failed, shadow_mismatch; internal';

-- 6. Owner settings --------------------------------------------------------------------

create function app.set_loyalty_store_settings(p_store_id uuid, p_settings jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
  v_before public.loyalty_store_settings;
  v_after public.loyalty_store_settings;
  v_key text;
  v_changed text[];
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, p_store_id, array['owner']::public.tenant_role[])
  then
    raise exception 'only an owner of the store sets its loyalty confirmation' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'the settings are a JSON object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in ('confirmation', 'max_bill_amount', 'bill_evidence_required_level', 'bill_manager_approval_above',
      'bill_amount_tolerance', 'bill_unconfirmed_hours', 'bill_silence_outcome', 'bill_staff_shift_cap', 'staff_amount_per_day',
      'store_earns_per_day', 'staff_redemptions_per_day', 'reverse_window_minutes', 'bill_audit_sample_pct', 'self_claim',
      'counter_code_ttl_seconds', 'auto_approve_max_amount', 'auto_approve_per_day', 'bill_photo_retention_days',
      'bill_reader_mode', 'shadow_reconcile')
    then
      raise exception 'unknown loyalty setting %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_settings -> v_key) = 'null' then
      raise exception 'loyalty setting % takes a value', v_key using errcode = '22023';
    end if;
  end loop;
  select s.* into v_before from public.loyalty_store_settings s where s.store_id = p_store_id for update;
  begin
    update public.loyalty_store_settings s
    set confirmation = coalesce(p_settings ->> 'confirmation', s.confirmation),
        max_bill_amount = coalesce((p_settings ->> 'max_bill_amount')::numeric, s.max_bill_amount),
        bill_evidence_required_level = coalesce((p_settings ->> 'bill_evidence_required_level')::smallint, s.bill_evidence_required_level),
        bill_manager_approval_above = coalesce((p_settings ->> 'bill_manager_approval_above')::numeric, s.bill_manager_approval_above),
        bill_amount_tolerance = coalesce((p_settings ->> 'bill_amount_tolerance')::numeric, s.bill_amount_tolerance),
        bill_unconfirmed_hours = coalesce((p_settings ->> 'bill_unconfirmed_hours')::smallint, s.bill_unconfirmed_hours),
        bill_silence_outcome = coalesce(p_settings ->> 'bill_silence_outcome', s.bill_silence_outcome),
        bill_staff_shift_cap = coalesce((p_settings ->> 'bill_staff_shift_cap')::smallint, s.bill_staff_shift_cap),
        staff_amount_per_day = coalesce((p_settings ->> 'staff_amount_per_day')::numeric, s.staff_amount_per_day),
        store_earns_per_day = coalesce((p_settings ->> 'store_earns_per_day')::smallint, s.store_earns_per_day),
        staff_redemptions_per_day = coalesce((p_settings ->> 'staff_redemptions_per_day')::smallint, s.staff_redemptions_per_day),
        reverse_window_minutes = coalesce((p_settings ->> 'reverse_window_minutes')::smallint, s.reverse_window_minutes),
        bill_audit_sample_pct = coalesce((p_settings ->> 'bill_audit_sample_pct')::numeric, s.bill_audit_sample_pct),
        self_claim = coalesce((p_settings ->> 'self_claim')::boolean, s.self_claim),
        counter_code_ttl_seconds = coalesce((p_settings ->> 'counter_code_ttl_seconds')::smallint, s.counter_code_ttl_seconds),
        auto_approve_max_amount = coalesce((p_settings ->> 'auto_approve_max_amount')::numeric, s.auto_approve_max_amount),
        auto_approve_per_day = coalesce((p_settings ->> 'auto_approve_per_day')::smallint, s.auto_approve_per_day),
        bill_photo_retention_days = coalesce((p_settings ->> 'bill_photo_retention_days')::smallint, s.bill_photo_retention_days),
        bill_reader_mode = coalesce(p_settings ->> 'bill_reader_mode', s.bill_reader_mode),
        shadow_reconcile = coalesce((p_settings ->> 'shadow_reconcile')::boolean, s.shadow_reconcile),
        updated_by = v_uid,
        updated_at = p_at
    where s.store_id = p_store_id
    returning s.* into v_after;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
      raise exception 'a loyalty setting is out of range: %', sqlerrm using errcode = '22023';
  end;
  select coalesce(array_agg(k order by k), '{}'::text[]) into v_changed
  from jsonb_each(to_jsonb(v_after)) a (k, v)
  where k not in ('updated_by', 'updated_at') and v is distinct from (to_jsonb(v_before) -> k);
  if cardinality(v_changed) > 0 then
    perform app.loyalty_audit(v_store.tenant_id, p_store_id, v_uid, 'settings_changed', null, null, null,
      jsonb_build_object('changed', to_jsonb(v_changed), 'confirmation', v_after.confirmation), p_at);
  end if;
  return to_jsonb(v_after) - 'tenant_id' - 'updated_by';
end;
$$;

comment on function app.set_loyalty_store_settings(uuid, jsonb, timestamptz) is 'RPC core: an owner of the store (whole tenant or that store) changes its loyalty_store_settings with a JSON object of the keys to change (confirmation, the bill evidence and approval knobs, the caps, self_claim, the counter QR life, auto-approval, audit share, shadow_reconcile); unknown keys, null values and out-of-range values are 22023, anyone else 42501; a change is audited with the names of the changed keys; returns the row without tenant and author';

create function public.set_loyalty_store_settings(p_store_id uuid, p_settings jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.set_loyalty_store_settings(p_store_id, p_settings, now());
$$;

comment on function public.set_loyalty_store_settings(uuid, jsonb) is 'RPC: app.set_loyalty_store_settings at now()';

-- 7. The POS-matched paths do not earn at a store in staff mode ----------------------

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

comment on function app.loyalty_earn(uuid, uuid, text, timestamptz, boolean, uuid) is 'credits a membership for an invoice by the programme read at this moment: one stamp when the net amount reaches stamp_min_bill_amount, points_per_unit per point_unit_amount of the net amount; refuses staff_mode (the invoice''s store confirms through staff, path E), already_earned (also when a bill of path E is linked to the invoice by the shadow check), membership_inactive, invoice_not_completed, programme_inactive, excluded_source, excluded_phone (a phone on the owner''s list or on an active staff roster row) and daily_cap, and notes below_minimum when no stamp is earned; each refusal is stored in loyalty_refusals; service role only';

-- 8. Path B and C refuse at a staff-mode store ------------------------------------------

create or replace function app.staff_record_checkin(p_store_id uuid, p_phone text default null, p_code text default null, p_amount numeric default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_store_code text;
  v_raw text := btrim(p_code);
  v_code text;
  v_payload_store text;
  v_found public.pending_checkins;
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_customer public.customers;
  v_refusal text;
  v_checkin uuid;
  v_result public.pending_checkins;
  v_entry public.loyalty_ledger;
begin
  select s.tenant_id, app.customer_store_code(s.code, s.external_id) into v_tenant, v_store_code
  from public.stores s where s.id = p_store_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only an owner, manager or staff member of the store records a customer there' using errcode = '42501';
  end if;
  if num_nonnulls(nullif(btrim(p_phone), ''), nullif(v_raw, '')) <> 1 then
    raise exception 'a check-in takes either a phone number or a member code' using errcode = '22023';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000000) then
    raise exception 'a check-in amount is more than 0 and at most 100,000,000' using errcode = '22023';
  end if;
  if app.loyalty_store_mode(p_store_id) = 'staff' then
    return jsonb_build_object('state', 'refused', 'refusal', 'staff_mode', 'text_key', 'checkin.refusal.staff_mode', 'checkin_id', null);
  end if;

  if nullif(v_raw, '') is not null then
    if v_raw ~ '^[0-9]{6}$' then
      v_code := v_raw;
    elsif v_raw ~ '^fnb-member:1:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[0-9]{6}$' then
      v_code := split_part(v_raw, ':', 4);
      v_payload_store := split_part(v_raw, ':', 3);
    else
      raise exception 'a member code has six digits or is the QR payload of one' using errcode = '22023';
    end if;
    if v_payload_store is not null and v_payload_store is distinct from v_store_code then
      v_refusal := 'wrong_store';
    else
      select c.* into v_found
      from public.pending_checkins c
      where c.store_id = p_store_id and c.code = v_code
      order by c.created_at desc
      limit 1;
      if v_found.id is null then
        v_refusal := case
          when exists (
            select 1 from public.pending_checkins c
            where c.tenant_id = v_tenant and c.code = v_code and c.status = 'issued' and c.expires_at > p_at
          ) then 'wrong_store'
          else 'code_unknown'
        end;
      elsif v_found.status = 'issued' and v_found.expires_at > p_at then
        select m.* into v_membership from public.memberships m where m.id = v_found.membership_id;
      elsif v_found.status in ('issued', 'expired') and v_found.reason is distinct from 'staff_confirmed' then
        v_refusal := 'code_expired';
      else
        v_refusal := 'code_used';
      end if;
    end if;
  else
    if app.loyalty_normalize_phone(p_phone) is null then
      v_refusal := 'invalid_phone';
    elsif app.loyalty_is_staff_phone(v_tenant, p_phone) then
      v_refusal := 'staff_phone';
    else
      v_membership := app.loyalty_member_for_phone(v_tenant, p_phone);
      if v_membership.id is null then
        v_refusal := 'not_member';
      end if;
    end if;
  end if;

  if v_refusal is null then
    select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
    select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
    if v_programme.status <> 'active' then
      v_refusal := 'no_programme';
    elsif v_membership.status <> 'active' then
      v_refusal := 'membership_inactive';
    elsif app.loyalty_is_staff_phone(v_tenant, v_customer.phone) then
      v_refusal := 'staff_phone';
    elsif exists (
      select 1 from public.pending_checkins c
      where c.membership_id = v_membership.id
        and c.store_id = p_store_id
        and c.status = 'recorded'
        and c.recorded_at > p_at - make_interval(mins => v_programme.checkin_window_after_minutes)
    ) then
      v_refusal := 'already_recorded';
    end if;
  end if;

  if v_refusal is not null then
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal, 'text_key', 'checkin.refusal.' || v_refusal, 'checkin_id', null);
  end if;

  if v_code is null then
    select i.code into v_code from app.loyalty_issue_checkin_code(v_membership.id, p_store_id, p_at) i;
  end if;
  v_checkin := app.loyalty_record_checkin(p_store_id, v_code, (select auth.uid()), p_amount, p_at);
  select c.* into v_result from public.pending_checkins c where c.id = v_checkin;
  if v_result.status = 'rejected' then
    return jsonb_build_object(
      'state', 'refused',
      'refusal', app.staff_checkin_refusal(v_result.reason),
      'text_key', 'checkin.refusal.' || app.staff_checkin_refusal(v_result.reason),
      'checkin_id', v_result.id
    );
  end if;
  select l.* into v_entry from public.loyalty_ledger l where l.id = v_result.matched_entry_id;
  return jsonb_build_object(
    'state', case v_result.status when 'recorded' then 'pending' else v_result.status::text end,
    'refusal', null,
    'checkin_id', v_result.id,
    'recorded_at', v_result.recorded_at,
    'confirm_by', case when v_result.status = 'recorded' then v_result.recorded_at + interval '10 minutes' end,
    'member', app.loyalty_member_summary(v_membership.id, p_at),
    'stamps_earned', coalesce(v_entry.stamp_delta, 0),
    'points_earned', coalesce(v_entry.point_delta, 0)
  );
end;
$$;

comment on function app.staff_record_checkin(uuid, text, text, numeric, timestamptz) is 'RPC core (path B, stores in pos_sync mode): records a member at the till by phone or dynamic code for the reconciliation to match to a synced invoice; refusal staff_mode at a store whose confirmation is staff (use staff_submit_bill there), and the earlier refusals (a code closed by a bill reads code_used)';

create or replace function app.customer_submit_claim(p_store text, p_receipt_no text, p_amount numeric, p_business_date date default null, p_at timestamptz default now())
returns jsonb
language plpgsql
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
  if app.loyalty_store_mode(v_store) = 'staff' then
    return jsonb_build_object(
      'claim_id', null,
      'state', 'rejected',
      'reason', 'staff_mode',
      'claims_left_today', greatest(v_cap - app.customer_claims_today(v_membership.id, p_at), 0)
    );
  end if;
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

comment on function app.customer_submit_claim(text, text, numeric, date, timestamptz) is 'RPC core (customer session, path C): a receipt claim at a store of the app in pos_sync mode; at a store in staff mode nothing is stored and the answer is state rejected with reason staff_mode (the customer claims with the counter QR there)';
