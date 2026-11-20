create table app.code_attempt_policies (
  endpoint text primary key check (endpoint in ('staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem')),
  counts text not null check (counts in ('misses', 'calls')),
  caller_max integer not null check (caller_max between 1 and 1000),
  scope_max integer not null check (scope_max between 1 and 10000),
  window_length interval not null check (window_length between interval '1 minute' and interval '1 day'),
  lockout interval not null check (lockout between interval '1 minute' and interval '1 day'),
  check (scope_max >= caller_max)
);

comment on table app.code_attempt_policies is 'the limits of the endpoints that take a short code or a phone and could be tried repeatedly (#317): per endpoint, whether every call or only a miss counts, the most a caller and a store (a tenant for the web phone lookup) may make within window_length, and how long the caller or the store then waits; read only by the security definer functions';

insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('staff_verify_redemption', 'misses', 5, 20, interval '15 minutes', interval '15 minutes'),
  ('staff_member_lookup', 'misses', 10, 30, interval '15 minutes', interval '15 minutes'),
  ('loyalty_member_lookup', 'misses', 10, 30, interval '15 minutes', interval '15 minutes'),
  ('customer_redeem', 'calls', 10, 100, interval '15 minutes', interval '15 minutes');

revoke all on table app.code_attempt_policies from public, anon, authenticated, service_role;
grant select, update on table app.code_attempt_policies to service_role;

create table app.code_attempts (
  endpoint text not null references app.code_attempt_policies (endpoint) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject_kind text not null check (subject_kind in ('caller', 'store', 'tenant')),
  subject_id uuid not null,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 1),
  locked_until timestamptz,
  primary key (endpoint, tenant_id, subject_kind, subject_id),
  check (locked_until is null or locked_until > window_started_at)
);

comment on table app.code_attempts is 'counted attempts per endpoint, tenant and subject (the caller''s user id, the store, or the tenant for the web phone lookup) in the current fixed window; locked_until is set when the count reaches the policy''s maximum. No code, phone or answer is kept. A row is reset by the first attempt after its window or its lock ends, and stale rows of the tenant are deleted as new ones are counted';

revoke all on table app.code_attempts from public, anon, authenticated, service_role;
grant select on table app.code_attempts to service_role;

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('code_guessing_lockout', 'operations', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{}', '{}', interval '1 hour', null, false, true, 270);

create function app.code_attempt_scope(p_tenant_id uuid, p_store_id uuid)
returns table (subject_kind text, subject_id uuid)
language sql
immutable
set search_path = ''
as $$
  select case when p_store_id is null then 'tenant' else 'store' end, coalesce(p_store_id, p_tenant_id);
$$;

comment on function app.code_attempt_scope(uuid, uuid) is 'the shared subject of an attempt: its store, or its tenant when the endpoint has no store';

create function app.code_attempt_gate(p_endpoint text, p_tenant_id uuid, p_store_id uuid, p_caller uuid, p_at timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  if p_endpoint is null or p_tenant_id is null or p_at is null then
    raise exception 'code_attempt_gate needs an endpoint, a tenant and an instant' using errcode = '22023';
  end if;
  select s.* into v_scope from app.code_attempt_scope(p_tenant_id, p_store_id) s;
  perform pg_advisory_xact_lock(hashtextextended('fnb-code-attempts:' || p_endpoint || ':' || v_scope.subject_id::text, 0));
  return (
    select max(a.locked_until)
    from app.code_attempts a
    where a.endpoint = p_endpoint
      and a.tenant_id = p_tenant_id
      and a.locked_until > p_at
      and (
        (a.subject_kind = 'caller' and a.subject_id = p_caller)
        or (a.subject_kind = v_scope.subject_kind and a.subject_id = v_scope.subject_id)
      )
  );
end;
$$;

comment on function app.code_attempt_gate(text, uuid, uuid, uuid, timestamptz) is 'called first by a rate-limited endpoint (#317): serialises the calls of one endpoint at one store (or tenant) with a transaction advisory lock, so parallel guesses cannot all pass before the count, and returns when the caller''s or the store''s lock ends, or null when neither is locked';

create function app.code_attempt_record(p_endpoint text, p_tenant_id uuid, p_store_id uuid, p_caller uuid, p_at timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_policy app.code_attempt_policies;
  v_scope record;
  v_subject record;
  v_row app.code_attempts;
  v_locked timestamptz;
  v_raised record;
begin
  if p_endpoint is null or p_tenant_id is null or p_at is null then
    raise exception 'code_attempt_record needs an endpoint, a tenant and an instant' using errcode = '22023';
  end if;
  select p.* into v_policy from app.code_attempt_policies p where p.endpoint = p_endpoint;
  if v_policy.endpoint is null then
    raise exception 'code_attempt_record needs an endpoint with a policy' using errcode = '22023';
  end if;
  select s.* into v_scope from app.code_attempt_scope(p_tenant_id, p_store_id) s;
  delete from app.code_attempts a
  where a.endpoint = p_endpoint
    and a.tenant_id = p_tenant_id
    and a.window_started_at < p_at - v_policy.window_length - v_policy.lockout
    and (a.locked_until is null or a.locked_until <= p_at);
  for v_subject in
    select 'caller'::text as kind, p_caller as id, v_policy.caller_max as max_attempts
    where p_caller is not null
    union all
    select v_scope.subject_kind, v_scope.subject_id, v_policy.scope_max
  loop
    insert into app.code_attempts as a (endpoint, tenant_id, subject_kind, subject_id, window_started_at, attempts, locked_until)
    values (p_endpoint, p_tenant_id, v_subject.kind, v_subject.id, p_at, 1,
      case when v_subject.max_attempts <= 1 then p_at + v_policy.lockout end)
    on conflict (endpoint, tenant_id, subject_kind, subject_id) do update
    set window_started_at = case
          when a.window_started_at + v_policy.window_length <= excluded.window_started_at
            or a.locked_until <= excluded.window_started_at
          then excluded.window_started_at
          else a.window_started_at
        end,
        attempts = case
          when a.window_started_at + v_policy.window_length <= excluded.window_started_at
            or a.locked_until <= excluded.window_started_at
          then 1
          else a.attempts + 1
        end,
        locked_until = case
          when a.locked_until > excluded.window_started_at then a.locked_until
          when a.window_started_at + v_policy.window_length <= excluded.window_started_at
            or a.locked_until <= excluded.window_started_at
          then case when v_subject.max_attempts <= 1 then excluded.window_started_at + v_policy.lockout end
          when a.attempts + 1 >= v_subject.max_attempts then excluded.window_started_at + v_policy.lockout
        end
    returning a.* into v_row;
    if v_row.attempts = v_subject.max_attempts and v_row.locked_until = p_at + v_policy.lockout then
      v_locked := greatest(v_locked, v_row.locked_until);
      select r.* into v_raised
      from app.raise_alert(
        p_tenant_id, 'code_guessing_lockout', p_endpoint || ':' || v_subject.kind || ':' || v_subject.id::text, 'operations', p_at,
        p_store_id, null, null, null,
        jsonb_build_object(
          'endpoint', p_endpoint,
          'subject', v_subject.kind,
          'attempts', v_row.attempts,
          'max_attempts', v_subject.max_attempts,
          'window_minutes', (extract(epoch from v_policy.window_length) / 60)::integer,
          'lockout_minutes', (extract(epoch from v_policy.lockout) / 60)::integer
        ),
        null, true
      ) r;
    end if;
  end loop;
  return v_locked;
end;
$$;

comment on function app.code_attempt_record(text, uuid, uuid, uuid, timestamptz) is 'counts one attempt of a rate-limited endpoint (#317) for the caller and for the store (or tenant) in the current fixed window of the endpoint''s policy; the attempt that reaches a maximum locks that subject for the policy''s lockout and raises code_guessing_lockout (an instant episode per endpoint and subject, count-only facts, cooled down for an hour); the first attempt after a window or a lock ends starts a new window; deletes the tenant''s stale rows of the endpoint; returns the end of a lock this attempt set, or null';

revoke all on function app.code_attempt_scope(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.code_attempt_gate(text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.code_attempt_record(text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function app.staff_verify_redemption(p_store_id uuid, p_code text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw text := btrim(p_code);
  v_code text;
  v_store public.stores;
  v_redemption public.redemptions;
  v_coupon public.coupons;
  v_membership public.memberships;
  v_customer public.customers;
  v_window integer;
  v_reason text;
  v_refusal text;
  v_first boolean := false;
  v_item_name text;
  v_locked timestamptz;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null
    or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store verifies a code there' using errcode = '42501';
  end if;
  v_code := coalesce(substring(v_raw from '^fnb-redeem:[0-9]+:(.+)$'), v_raw);
  if v_code is null or char_length(v_code) not between 1 and 64 or v_code ~ '[[:space:][:cntrl:]]' then
    raise exception 'a reward code holds 1 to 64 characters without spaces, or is its QR payload fnb-redeem:1:<code>' using errcode = '22023';
  end if;

  v_locked := app.code_attempt_gate('staff_verify_redemption', v_store.tenant_id, v_store.id, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object(
      'state', 'refused',
      'refusal', 'locked',
      'reason', 'locked',
      'text_key', 'redeem.refusal.locked',
      'retry_at', v_locked,
      'used_at', null,
      'used_store_name', null,
      'expired_at', null
    );
  end if;

  select r.* into v_redemption
  from public.redemptions r
  where r.tenant_id = v_store.tenant_id
    and upper(r.code) = upper(v_code)
  order by (r.store_id = p_store_id) desc, (r.state = 'held') desc, r.held_at desc, r.id
  limit 1
  for update;
  select p.checkin_window_after_minutes into v_window
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = v_redemption.membership_id;

  if v_redemption.id is null then
    v_reason := 'unknown_code';
  elsif v_redemption.store_id is distinct from p_store_id then
    v_reason := 'other_store';
  elsif v_redemption.state = 'confirmed' then
    v_reason := 'used';
  elsif v_redemption.state = 'released' then
    v_reason := 'released';
  elsif v_redemption.state = 'cancelled' then
    v_reason := 'cancelled';
  elsif v_redemption.hold_expires_at <= p_at then
    v_reason := 'expired';
  elsif v_redemption.verified_at is not null
    and not (v_redemption.verified_by is not distinct from v_uid and v_redemption.verified_at > p_at - make_interval(mins => v_window))
  then
    v_reason := 'already_verified';
  end if;

  if v_reason is not null then
    if v_reason = 'unknown_code' then
      perform app.code_attempt_record('staff_verify_redemption', v_store.tenant_id, v_store.id, v_uid, p_at);
    end if;
    v_refusal := case v_reason
      when 'unknown_code' then 'unknown'
      when 'other_store' then 'wrong_store'
      when 'already_verified' then 'used'
      when 'cancelled' then 'released'
      else v_reason
    end;
    return jsonb_build_object(
      'state', 'refused',
      'refusal', v_refusal,
      'reason', v_reason,
      'text_key', 'redeem.refusal.' || v_refusal,
      'used_at', case v_reason when 'used' then v_redemption.confirmed_at when 'already_verified' then v_redemption.verified_at end,
      'used_store_name', case when v_reason in ('used', 'already_verified') then v_store.name end,
      'expired_at', case when v_reason in ('expired', 'released', 'cancelled') then v_redemption.hold_expires_at end
    );
  end if;

  if v_redemption.verified_at is null then
    update public.redemptions r
    set verified_at = p_at, verified_by = v_uid
    where r.id = v_redemption.id
    returning r.* into v_redemption;
    v_first := true;
  end if;
  select c.* into v_coupon from public.coupons c where c.id = v_redemption.coupon_id;
  select m.* into v_membership from public.memberships m where m.id = v_redemption.membership_id;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  if v_redemption.pos_free_item_external_id is not null then
    select min(i.name) into v_item_name from public.items i
    where i.tenant_id = v_redemption.tenant_id and i.external_id = v_redemption.pos_free_item_external_id;
  end if;
  return jsonb_build_object(
    'state', 'verified',
    'refusal', null,
    'text_key', 'redeem.valid',
    'first_verification', v_first,
    'redemption_id', v_redemption.id,
    'reward_name', v_coupon.name,
    'reward_kind', v_coupon.reward_kind,
    'reward_percent', v_coupon.reward_percent,
    'rail', v_redemption.rail,
    'pos_discount_name', case when v_redemption.rail = 'pos_payment_discount'
      then coalesce(v_redemption.pos_discount_name, v_item_name, v_redemption.pos_free_item_external_id) end,
    'pos_free_item_external_id', v_redemption.pos_free_item_external_id,
    'voucher_code', case when v_redemption.rail is distinct from 'pos_payment_discount' then v_redemption.code end,
    'min_bill_amount', nullif(v_coupon.min_bill_amount, 0),
    'hold_until', v_redemption.hold_expires_at,
    'confirm_by', case when v_redemption.rail = 'pos_payment_discount'
      then least(v_redemption.verified_at + make_interval(mins => v_window), v_redemption.hold_expires_at) end,
    'verified_at', v_redemption.verified_at,
    'phone_masked', '•••• ••• ' || right(coalesce(v_customer.phone, ''), 3)
  );
end;
$$;

create or replace function app.staff_member_lookup(p_store_id uuid, p_phone text default null, p_membership_id uuid default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
          'path', case l.matched_path when 'A' then 'phone' when 'C' then 'receipt_claim' when 'D' then 'voucher' end,
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
$$;

create or replace function public.loyalty_member_lookup(p_phone text)
returns table (
  membership_id uuid,
  tenant_id uuid,
  programme_id uuid,
  phone_full text,
  phone_masked text,
  joined_at timestamptz,
  status public.membership_status,
  channel text,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  last_visit date
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_rows constant integer := 100;
  v_tenants uuid[] := app.current_user_loyalty_tenant_ids();
  v_scope uuid[] := app.current_user_loyalty_store_ids();
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_locked timestamptz;
  v_found integer;
begin
  if v_method not in ('', 'POST') then
    raise sqlstate 'PT405' using message = 'loyalty_member_lookup takes the phone in a POST body, never in a URL';
  end if;
  if cardinality(v_tenants) = 0 then
    raise exception using errcode = '42501', message = 'loyalty_member_lookup is for owners, managers and viewers';
  end if;
  if v_phone is null then
    return;
  end if;
  foreach v_tenant in array v_tenants loop
    v_locked := greatest(v_locked, app.code_attempt_gate('loyalty_member_lookup', v_tenant, null, v_uid, now()));
  end loop;
  if v_locked is not null then
    raise sqlstate 'PT429' using message = 'too many phone lookups without a member; try again later', hint = 'retry_at ' || to_char(v_locked at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  return query
  select
    m.id,
    m.tenant_id,
    m.programme_id,
    case when app.has_tenant_role(m.tenant_id, array['owner']::public.tenant_role[]) then v_phone end,
    app.loyalty_masked_phone(c.phone),
    m.joined_at,
    m.status,
    m.channel,
    b.stamps,
    b.points,
    b.pending_stamps,
    b.pending_points,
    b.last_visit
  from public.customers c
  join public.memberships m on m.customer_id = c.id and m.tenant_id = c.tenant_id
  cross join lateral app.loyalty_store_balance(m.id, v_scope) b
  where c.tenant_id = any (v_tenants)
    and c.phone is not null
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by m.joined_at desc, m.id desc
  limit max_rows;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    foreach v_tenant in array v_tenants loop
      perform app.code_attempt_record('loyalty_member_lookup', v_tenant, null, v_uid, now());
    end loop;
  end if;
end;
$$;

create or replace function app.customer_redeem(p_coupon uuid, p_store text, p_at timestamptz default now())
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
  v_result jsonb;
  v_balance record;
  v_tenant uuid;
  v_locked timestamptz;
begin
  if p_coupon is null then
    raise exception 'customer_redeem names the reward' using errcode = '22023';
  end if;
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  select s.code, s.name into v_store_code, v_store_name from app.customer_app_stores(v_login.zalo_app_id) s where s.store_id = v_store;
  select s.tenant_id into v_tenant from public.stores s where s.id = v_store;
  v_locked := app.code_attempt_gate('customer_redeem', v_tenant, v_store, v_login.user_id, p_at);
  if v_locked is not null then
    select b.stamps, b.points into v_balance from app.loyalty_balance(v_membership.id, p_at) b;
    return jsonb_build_object(
      'redemption_id', null,
      'state', null,
      'refusal', 'rate_limited',
      'retry_at', v_locked,
      'store_code', v_store_code,
      'store_name', v_store_name,
      'qr_payload', null,
      'seconds_left', null,
      'stamps', v_balance.stamps,
      'points', v_balance.points
    );
  end if;
  perform app.code_attempt_record('customer_redeem', v_tenant, v_store, v_login.user_id, p_at);
  v_result := app.redeem_coupon(v_membership.id, p_coupon, v_store, p_at);
  select b.stamps, b.points into v_balance from app.loyalty_balance(v_membership.id, p_at) b;
  return v_result || jsonb_build_object(
    'store_code', v_store_code,
    'store_name', v_store_name,
    'qr_payload', case when v_result ->> 'code' is not null then 'fnb-redeem:1:' || (v_result ->> 'code') end,
    'seconds_left', case when v_result ->> 'hold_expires_at' is not null
      then greatest(floor(extract(epoch from ((v_result ->> 'hold_expires_at')::timestamptz - p_at))), 0)::integer end,
    'stamps', v_balance.stamps,
    'points', v_balance.points
  );
end;
$$;

alter function public.staff_member_lookup(uuid, text, uuid) volatile;

comment on function app.staff_verify_redemption(uuid, text, timestamptz) is 'the staff check of a reward code at the till: 42501 outside the caller''s stores, 22023 for a malformed code; then, rate-limited (#317, app.code_attempt_policies): a caller or store locked after too many unknown codes gets the refusal locked with retry_at and nothing is looked up; otherwise the code''s refusal (unknown, wrong_store, used, released, expired; an unknown code counts against the caller and the store) or its verification, as before';
comment on function app.staff_member_lookup(uuid, text, uuid, timestamptz) is 'the staff app''s member card by phone or membership at a store, as before; a phone that finds no member counts against the caller and the store (#317), and once either is locked a phone lookup answers {found: false, locked: true, retry_at} without reading; a lookup by membership id is never counted nor locked';
comment on function public.loyalty_member_lookup(text) is 'the phone lookup of the web section Khách hàng (#253) for owners, managers and viewers (42501 for everyone else): the memberships, in the tenants where the caller reads loyalty, of the customer whose phone reads as p_phone in E.164 form whatever form the till stored, newest first, at most 100; nothing for a phone that does not read or that no member has. phone_full is the E.164 phone for an owner of the membership''s tenant and null for everyone else; phone_masked is always the masked form. The balance is scoped as in loyalty_members_page (the caller''s loyalty stores and the rows without a store). Through PostgREST it answers POST only (the phone travels in the request body); a GET, which would carry the phone in the URL, is refused with PT405 (HTTP 405) before anything is read. A readable phone that finds no member counts against the caller and the tenant (#317); once either is locked the lookup is refused with PT429 (HTTP 429) before anything is read';
comment on function app.customer_redeem(uuid, text, timestamptz) is 'the customer Mini App''s redemption of a reward at a store of the app: every call counts against the customer and the store (#317, at most 10 and 100 within 15 minutes); a locked customer or store gets refusal rate_limited with retry_at and the balance, and nothing is held; otherwise app.redeem_coupon with the store and the QR payload';
