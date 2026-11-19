alter table public.tenants
  add column loyalty_adjust_max_stamps smallint not null default 1 check (loyalty_adjust_max_stamps between 0 and 20),
  add column loyalty_adjust_max_points integer not null default 0 check (loyalty_adjust_max_points between 0 and 100000);

comment on column public.tenants.loyalty_adjust_max_stamps is 'the largest stamp adjustment (either sign) a member of the staff app records at once with staff_request; a larger one waits for an owner or manager of the store; written by an owner with an unlimited scope through set_loyalty_adjust_limits';
comment on column public.tenants.loyalty_adjust_max_points is 'the largest points adjustment (either sign) recorded at once with staff_request; a larger one waits for an owner or manager of the store';

create table app.loyalty_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  kind text not null check (kind in ('adjustment', 'dispute')),
  stamp_delta integer not null default 0 check (stamp_delta between -20 and 20),
  point_delta integer not null default 0 check (point_delta between -100000 and 100000),
  reason text not null check (char_length(reason) between 1 and 200 and reason = btrim(reason) and reason !~ '[[:cntrl:]]'),
  status text not null default 'pending' check (status in ('pending', 'applied', 'approved', 'refused')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (char_length(decision_reason) between 1 and 500 and decision_reason !~ '[[:cntrl:]]')),
  entry_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, entry_id) references public.loyalty_ledger (tenant_id, id) on delete set null (entry_id),
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'refused' or decision_reason is not null),
  check (kind <> 'adjustment' or stamp_delta <> 0 or point_delta <> 0),
  check (kind <> 'dispute' or (stamp_delta >= 0 and point_delta >= 0))
);

create index loyalty_requests_pending_idx on app.loyalty_requests (store_id, requested_at) where status = 'pending';
create index loyalty_requests_requester_idx on app.loyalty_requests (requested_by, requested_at desc);
create index loyalty_requests_membership_idx on app.loyalty_requests (membership_id);

comment on table app.loyalty_requests is 'disputes and adjustments recorded by the staff app for a member at a store (FR-LOY-16): an adjustment within the tenant''s loyalty_adjust_max_stamps and loyalty_adjust_max_points is applied at once (applied, the requester as approver); a larger one and every dispute wait (pending) for an owner or manager of the store other than the requester, who approves (with the requested or other amounts) or refuses it with staff_decide_loyalty_request; every applied or approved change becomes a loyalty_ledger adjust row with the request''s reason and the approver; the amounts here are the requested ones, the ledger row holds what was applied; read and written only through the staff functions';

create function app.loyalty_is_staff_phone(p_tenant_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select v.phone is not null and (
      exists (select 1 from public.loyalty_staff_phones s where s.tenant_id = p_tenant_id and s.phone = v.phone)
      or exists (select 1 from public.staff_roster r where r.tenant_id = p_tenant_id and r.status = 'active' and r.phone = v.phone)
    )
    from (select app.loyalty_normalize_phone(p_phone) as phone) v
  ), false);
$$;

comment on function app.loyalty_is_staff_phone(uuid, text) is 'whether a phone is a staff phone of the tenant: on the loyalty staff-phone list or linked to an active staff roster row; such a phone never earns at the till';

create function app.loyalty_member_for_phone(p_tenant_id uuid, p_phone text)
returns public.memberships
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from (select app.loyalty_normalize_phone(p_phone) as phone) v
  join public.customers c on c.tenant_id = p_tenant_id and (c.phone = v.phone or app.loyalty_normalize_phone(c.phone) = v.phone)
  join public.memberships m on m.customer_id = c.id
  join public.loyalty_programmes p on p.id = m.programme_id and p.status = 'active'
  order by (c.phone = v.phone) desc, m.joined_at, m.id
  limit 1;
$$;

comment on function app.loyalty_member_for_phone(uuid, text) is 'the membership in the tenant''s active programme of the customer with this phone, matched in E.164 form; never creates a customer';

create or replace function app.loyalty_text_key(p_prefix text, p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_prefix || '.' || string_agg(case when u.i = 1 then u.w else initcap(u.w) end, '' order by u.i)
  from unnest(string_to_array(p_reason, '_')) with ordinality as u (w, i)
  where p_reason is not null;
$$;

comment on function app.loyalty_text_key(text, text) is 'a message key of a refusal reason: the prefix and the reason in camel case, as redemption.refused.codeExpired';

create function app.loyalty_masked_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '•••• ••• ' || right(coalesce(p_phone, ''), 3);
$$;

comment on function app.loyalty_masked_phone(text) is 'a phone as the apps show it: four and three dots and the last three digits';

create function app.loyalty_member_summary(p_membership_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'membership_id', m.id,
    'phone_masked', app.loyalty_masked_phone(c.phone),
    'display_name', nullif(btrim(c.name), ''),
    'stamps', b.stamps,
    'stamps_per_card', b.stamps_per_card,
    'points', b.points
  )
  from public.memberships m
  join public.customers c on c.id = m.customer_id
  cross join lateral app.loyalty_balance(m.id, p_at) b
  where m.id = p_membership_id;
$$;

comment on function app.loyalty_member_summary(uuid, timestamptz) is 'the short member card of a check-in answer: membership, masked phone, name, spendable stamps, stamps per card and points';

create function app.loyalty_apply_adjustment(
  p_membership_id uuid,
  p_store_id uuid,
  p_stamps integer,
  p_points integer,
  p_reason text,
  p_approved_by uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_entry uuid;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    reason, approved_by, expires_at, occurred_at
  )
  values (
    v_membership.tenant_id, v_programme.id, p_membership_id, p_store_id, 'adjust', coalesce(p_stamps, 0), coalesce(p_points, 0),
    round(coalesce(p_points, 0) * v_programme.point_value_amount, 2), p_reason, p_approved_by,
    case when p_points > 0 then p_at + make_interval(months => v_programme.points_expiry_months) end, p_at
  )
  returning id into v_entry;
  if p_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_membership.tenant_id, p_membership_id, v_entry, p_at, p_at + make_interval(months => v_programme.stamp_validity_months)
    from generate_series(1, p_stamps);
  elsif p_stamps < 0 then
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (
      select a.id from public.stamps a
      where a.membership_id = p_membership_id and a.state = 'active'
      order by a.expires_at, a.id
      limit -p_stamps
    );
  end if;
  return v_entry;
end;
$$;

comment on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) is 'writes a manual adjustment as a loyalty_ledger adjust row with its reason and approver (points valued at the programme''s point_value_amount and expiring after points_expiry_months); added stamps get stamps rows expiring after stamp_validity_months, removed ones close the oldest active stamps as clawed_back; returns the ledger row';

create function app.staff_checkin_refusal(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'daily_cap' then 'daily_limit'
    when 'excluded_phone' then 'staff_phone'
    else p_reason
  end;
$$;

comment on function app.staff_checkin_refusal(text) is 'the staff app''s name of a check-in refusal or of an earn refusal of a matched check-in: daily_cap is daily_limit and excluded_phone is staff_phone, every other reason keeps its name';

create function app.staff_record_checkin(
  p_store_id uuid,
  p_phone text default null,
  p_code text default null,
  p_amount numeric default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
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
      elsif v_found.status in ('issued', 'expired') then
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

comment on function app.staff_record_checkin(uuid, text, text, numeric, timestamptz) is 'Ghi nhận khách (path B) for an owner, manager or staff member with the store in scope (42501 otherwise): either a phone (the member of the tenant''s active programme with that phone; a fresh check-in code is issued for it) or the customer''s live 6-digit member code or its QR payload fnb-member:1:<store link key>:<code>, then app.loyalty_record_checkin with the caller as recorder and the optional bill amount, which matches at once when the invoice is synced and otherwise requests a fast-lane run (no POS call); answers {state pending, matched or queued, checkin_id, recorded_at, confirm_by (10 minutes after a recording that waits), member, stamps_earned, points_earned} or {state refused, refusal, text_key checkin.refusal.<refusal>, checkin_id}: invalid_phone, not_member, staff_phone, code_unknown, code_expired, code_used, wrong_store, no_programme, membership_inactive, already_recorded (recorded at the store within the programme''s check-in window) or the earn refusal of a check-in matched at once (daily_cap as daily_limit); 22023 for both or neither of phone and code, a malformed code or an amount outside 0 to 100,000,000';

create function app.staff_member_lookup(p_store_id uuid, p_phone text default null, p_membership_id uuid default null, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
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
begin
  select s.tenant_id, s.timezone, s.name into v_tenant, v_timezone, v_store_name from public.stores s where s.id = p_store_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only an owner, manager or staff member of the store looks a member up there' using errcode = '42501';
  end if;
  if num_nonnulls(nullif(btrim(p_phone), ''), p_membership_id) <> 1 then
    raise exception 'a lookup takes either a phone number or a membership' using errcode = '22023';
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
    return jsonb_build_object('found', false);
  end if;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  if app.loyalty_is_staff_phone(v_tenant, v_customer.phone) then
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

comment on function app.staff_member_lookup(uuid, text, uuid, timestamptz) is 'the staff app''s member lookup by phone or membership for an owner, manager or staff member with the store in scope (42501 otherwise; 22023 for both or neither): {found true, store_name, business_date, card {membership_id, phone_masked, display_name, member_since, status, tier_name (none yet), stamps (spendable), stamps_per_card, stamps_on_card, cards_completed, stamps_pending, points, points_pending}, today (the check-ins, earns, open receipt claims and manual adjustments of the member at that store on its business day, each {at, path, state pending, confirmed, queued or rejected, stamps, points, receipt_no}), adjust_limit_stamps, adjust_limit_points}; a phone that does not read, a staff phone, no membership in the tenant''s active programme or a membership of another tenant answer {found false}, so the lookup never says whether a non-member is a customer';

create function app.staff_request(
  p_store_id uuid,
  p_kind text,
  p_membership_id uuid,
  p_reason text,
  p_stamps integer default 0,
  p_points integer default 0,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_reason text := btrim(p_reason);
  v_stamps integer := coalesce(p_stamps, 0);
  v_points integer := coalesce(p_points, 0);
  v_max_stamps integer;
  v_max_points integer;
  v_request app.loyalty_requests;
  v_entry uuid;
begin
  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only an owner, manager or staff member of the store records a loyalty request there' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('adjustment', 'dispute') then
    raise exception 'a loyalty request is an adjustment or a dispute' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id
    where m.id = p_membership_id and m.tenant_id = v_tenant and p.status <> 'draft'
  ) then
    raise exception 'a loyalty request names a membership of the store''s tenant' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a loyalty request states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  if v_stamps not between -20 and 20 or v_points not between -100000 and 100000 then
    raise exception 'an adjustment moves at most 20 stamps and 100,000 points' using errcode = '22023';
  end if;
  if p_kind = 'adjustment' and v_stamps = 0 and v_points = 0 then
    raise exception 'an adjustment moves stamps or points' using errcode = '22023';
  end if;
  if p_kind = 'dispute' and (v_stamps < 0 or v_points < 0) then
    raise exception 'a dispute asks for stamps or points, never takes them' using errcode = '22023';
  end if;
  select t.loyalty_adjust_max_stamps, t.loyalty_adjust_max_points into v_max_stamps, v_max_points
  from public.tenants t where t.id = v_tenant;
  insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, stamp_delta, point_delta, reason, requested_by, requested_at)
  values (v_tenant, p_store_id, p_membership_id, p_kind, v_stamps, v_points, v_reason, (select auth.uid()), p_at)
  returning * into v_request;
  if p_kind = 'adjustment' and abs(v_stamps) <= v_max_stamps and abs(v_points) <= v_max_points then
    v_entry := app.loyalty_apply_adjustment(p_membership_id, p_store_id, v_stamps, v_points, v_reason, (select auth.uid()), p_at);
    update app.loyalty_requests r
    set status = 'applied', decided_by = (select auth.uid()), decided_at = p_at, entry_id = v_entry
    where r.id = v_request.id
    returning * into v_request;
  end if;
  return jsonb_build_object(
    'request_id', v_request.id,
    'kind', v_request.kind,
    'state', v_request.status,
    'entry_id', v_request.entry_id,
    'requested_at', v_request.requested_at
  );
end;
$$;

comment on function app.staff_request(uuid, text, uuid, text, integer, integer, timestamptz) is 'records a dispute or an adjustment for a member of the store''s tenant as an owner, manager or staff member with the store in scope (42501 otherwise): an adjustment within the tenant''s loyalty_adjust_max_stamps and loyalty_adjust_max_points is applied at once as a ledger adjust row with the reason and the caller as approver (state applied); a larger adjustment and every dispute wait as pending for an owner or manager of the store; 22023 for another kind, a membership of another tenant, a reason outside 1 to 200 characters, more than 20 stamps or 100,000 points, an adjustment that moves nothing or a dispute that takes; returns {request_id, kind, state, entry_id, requested_at}';

create function app.staff_decide_loyalty_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null,
  p_stamps integer default null,
  p_points integer default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request app.loyalty_requests;
  v_reason text := nullif(btrim(p_reason), '');
  v_stamps integer;
  v_points integer;
  v_entry uuid;
begin
  select r.* into v_request from app.loyalty_requests r where r.id = p_request_id for update;
  if v_request.id is null
    or not app.has_store_scope(v_request.tenant_id, v_request.store_id, array['owner', 'manager']::public.tenant_role[])
    or v_request.requested_by is not distinct from (select auth.uid())
  then
    raise exception 'only an owner or manager of the store other than the requester decides a loyalty request' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'the loyalty request is already decided' using errcode = '55000';
  end if;
  if p_decision is null or p_decision not in ('approved', 'refused') then
    raise exception 'a decision is approved or refused' using errcode = '22023';
  end if;
  if v_reason is not null and (char_length(v_reason) > 500 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'a decision''s reason holds at most 500 characters' using errcode = '22023';
  end if;
  if p_decision = 'refused' and v_reason is null then
    raise exception 'a refusal states its reason' using errcode = '22023';
  end if;
  v_stamps := coalesce(p_stamps, v_request.stamp_delta);
  v_points := coalesce(p_points, v_request.point_delta);
  if v_stamps not between -20 and 20 or v_points not between -100000 and 100000 then
    raise exception 'an approval moves at most 20 stamps and 100,000 points' using errcode = '22023';
  end if;
  if p_decision = 'approved' and v_request.kind = 'dispute' and (v_stamps < 0 or v_points < 0) then
    raise exception 'an approved dispute never takes stamps or points' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (v_stamps <> 0 or v_points <> 0) then
    v_entry := app.loyalty_apply_adjustment(v_request.membership_id, v_request.store_id, v_stamps, v_points, v_request.reason, (select auth.uid()), p_at);
  end if;
  update app.loyalty_requests r
  set status = p_decision, decided_by = (select auth.uid()), decided_at = p_at, decision_reason = v_reason, entry_id = v_entry
  where r.id = p_request_id
  returning * into v_request;
  return jsonb_build_object(
    'state', v_request.status,
    'refusal', null,
    'request_id', v_request.id,
    'entry_id', v_request.entry_id,
    'decided_at', v_request.decided_at
  );
end;
$$;

comment on function app.staff_decide_loyalty_request(uuid, text, text, integer, integer, timestamptz) is 'approves or refuses a pending loyalty request as an owner or manager of its store who is not the requester (42501 otherwise, also for an unknown request): an approval writes the ledger adjust row with the request''s reason and the caller as approver, with the stamps and points given (the requested ones by default; an approved dispute never takes); a refusal states its reason (22023); a decided request gives 55000; returns {state, refusal (null), request_id, entry_id, decided_at}';

create function app.loyalty_requester_name(p_tenant_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.display_name from public.staff_roster r where r.tenant_id = p_tenant_id and r.user_id = p_user_id),
    (select i.display_name from public.zalo_identities i where i.tenant_id = p_tenant_id and i.user_id = p_user_id and i.display_name is not null order by i.updated_at desc limit 1)
  );
$$;

comment on function app.loyalty_requester_name(uuid, uuid) is 'the name a manager sees for a requester: the staff roster name, else the Zalo display name, else null';

create function app.staff_loyalty_queue(p_store_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(q.item order by q.created_at, q.id), '[]'::jsonb)
  from (
    select r.requested_at as created_at, r.id, jsonb_build_object(
      'id', r.id,
      'kind', r.kind,
      'store_id', r.store_id,
      'created_at', r.requested_at,
      'phone_masked', app.loyalty_masked_phone(c.phone),
      'requested_by_name', app.loyalty_requester_name(r.tenant_id, r.requested_by),
      'reason', r.reason,
      'stamps', r.stamp_delta,
      'points', r.point_delta,
      'match', null
    ) as item
    from app.loyalty_requests r
    join public.memberships m on m.id = r.membership_id
    join public.customers c on c.id = m.customer_id
    where r.status = 'pending'
      and (p_store_id is null or r.store_id = p_store_id)
      and r.requested_by is distinct from (select auth.uid())
      and app.has_store_scope(r.tenant_id, r.store_id, array['owner', 'manager']::public.tenant_role[])
    union all
    select q.created_at, q.id, jsonb_build_object(
      'id', q.id,
      'kind', 'match',
      'store_id', q.store_id,
      'created_at', q.created_at,
      'phone_masked', app.loyalty_masked_phone(c.phone),
      'requested_by_name', null,
      'reason', q.reason,
      'stamps', 0,
      'points', 0,
      'match', jsonb_build_object(
        'path', case q.matched_path when 'B' then 'member_code' else 'receipt_claim' end,
        'recorded_at', k.recorded_at,
        'amount', coalesce(k.amount, rc.amount),
        'receipt_no', rc.receipt_no,
        'candidates', (
          select coalesce(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'receipt_no', i.receipt_no, 'sold_at', i.sold_at, 'amount', i.net_amount) order by u.o), '[]'::jsonb)
          from unnest(q.candidate_invoice_ids) with ordinality as u (invoice_id, o)
          join public.invoices i on i.id = u.invoice_id
        )
      )
    )
    from public.loyalty_queue q
    join public.memberships m on m.id = q.membership_id
    join public.customers c on c.id = m.customer_id
    left join public.pending_checkins k on k.id = q.checkin_id
    left join public.receipt_claims rc on rc.id = q.claim_id
    where q.state = 'open'
      and (p_store_id is null or q.store_id = p_store_id)
      and app.has_store_scope(q.tenant_id, q.store_id, array['owner', 'manager']::public.tenant_role[])
    order by 1, 2
    limit 200
  ) q;
$$;

comment on function app.staff_loyalty_queue(uuid) is 'the manager queue of the staff app for one store or all: the pending disputes and adjustments that the caller, an owner or manager with the store in scope, may decide (never the caller''s own) and the open match items of loyalty_queue with their candidate invoices, oldest first, at most 200, each {id, kind (adjustment, dispute or match), store_id, created_at, phone_masked, requested_by_name, reason, stamps, points, match}; staff and everyone else get an empty list';

create function app.staff_my_loyalty_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.requested_at desc, x.id), '[]'::jsonb)
  from (
    select r.requested_at, r.id, jsonb_build_object(
      'id', r.id,
      'kind', r.kind,
      'created_at', r.requested_at,
      'phone_masked', app.loyalty_masked_phone(c.phone),
      'reason', r.reason,
      'stamps', r.stamp_delta,
      'points', r.point_delta,
      'state', r.status,
      'decided_at', r.decided_at,
      'decision_reason', r.decision_reason,
      'store_name', s.name
    ) as item
    from app.loyalty_requests r
    join public.memberships m on m.id = r.membership_id
    join public.customers c on c.id = m.customer_id
    join public.stores s on s.id = r.store_id
    where r.requested_by = (select auth.uid())
      and app.has_store_scope(r.tenant_id, r.store_id, array['owner', 'manager', 'staff']::public.tenant_role[])
    order by r.requested_at desc, r.id
    limit 200
  ) x;
$$;

comment on function app.staff_my_loyalty_requests() is 'the caller''s own disputes and adjustments at stores still in scope, newest first, at most 200, each {id, kind, created_at, phone_masked, reason, stamps, points, state, decided_at, decision_reason, store_name}';

create function app.set_loyalty_adjust_limits(p_tenant_id uuid, p_max_stamps integer, p_max_points integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.has_store_scope(p_tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store sets the loyalty adjustment limits' using errcode = '42501';
  end if;
  if p_max_stamps is null or p_max_stamps not between 0 and 20 or p_max_points is null or p_max_points not between 0 and 100000 then
    raise exception 'the limits are 0 to 20 stamps and 0 to 100,000 points' using errcode = '22023';
  end if;
  update public.tenants t
  set loyalty_adjust_max_stamps = p_max_stamps, loyalty_adjust_max_points = p_max_points
  where t.id = p_tenant_id;
  return jsonb_build_object('max_stamps', p_max_stamps, 'max_points', p_max_points);
end;
$$;

comment on function app.set_loyalty_adjust_limits(uuid, integer, integer) is 'sets the tenant''s loyalty_adjust_max_stamps and loyalty_adjust_max_points as an owner with an unlimited scope (42501 otherwise; 22023 outside 0 to 20 stamps or 0 to 100,000 points); returns the limits';

create function public.staff_record_checkin(p_store_id uuid, p_phone text default null, p_code text default null, p_amount numeric default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.staff_record_checkin(p_store_id, p_phone, p_code, p_amount, now());
$$;

comment on function public.staff_record_checkin(uuid, text, text, numeric) is 'RPC for the staff app: app.staff_record_checkin at the current time';

create function public.staff_member_lookup(p_store_id uuid, p_phone text default null, p_membership_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_member_lookup(p_store_id, p_phone, p_membership_id, now());
$$;

comment on function public.staff_member_lookup(uuid, text, uuid) is 'RPC for the staff app: app.staff_member_lookup at the current time';

create function public.staff_request(p_store_id uuid, p_kind text, p_membership_id uuid, p_reason text, p_stamps integer default 0, p_points integer default 0)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.staff_request(p_store_id, p_kind, p_membership_id, p_reason, p_stamps, p_points, now());
$$;

comment on function public.staff_request(uuid, text, uuid, text, integer, integer) is 'RPC for the staff app: app.staff_request at the current time';

create function public.staff_decide_loyalty_request(p_request_id uuid, p_decision text, p_reason text default null, p_stamps integer default null, p_points integer default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.staff_decide_loyalty_request(p_request_id, p_decision, p_reason, p_stamps, p_points, now());
$$;

comment on function public.staff_decide_loyalty_request(uuid, text, text, integer, integer) is 'RPC for the staff app and the web app: app.staff_decide_loyalty_request at the current time';

create function public.staff_loyalty_queue(p_store_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_loyalty_queue(p_store_id);
$$;

comment on function public.staff_loyalty_queue(uuid) is 'RPC for the staff app and the web app: app.staff_loyalty_queue';

create function public.staff_my_loyalty_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_my_loyalty_requests();
$$;

comment on function public.staff_my_loyalty_requests() is 'RPC for the staff app: app.staff_my_loyalty_requests';

create function public.set_loyalty_adjust_limits(p_tenant_id uuid, p_max_stamps integer, p_max_points integer)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.set_loyalty_adjust_limits(p_tenant_id, p_max_stamps, p_max_points);
$$;

comment on function public.set_loyalty_adjust_limits(uuid, integer, integer) is 'RPC for the web app: app.set_loyalty_adjust_limits';

revoke all on table app.loyalty_requests from public, anon, authenticated, service_role;

revoke all on function app.loyalty_is_staff_phone(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_member_for_phone(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_text_key(text, text) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_masked_phone(text) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_member_summary(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_checkin_refusal(text) from public, anon, authenticated, service_role;
revoke all on function app.staff_record_checkin(uuid, text, text, numeric, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_member_lookup(uuid, text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_request(uuid, text, uuid, text, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_decide_loyalty_request(uuid, text, text, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.loyalty_requester_name(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.staff_loyalty_queue(uuid) from public, anon, authenticated, service_role;
revoke all on function app.staff_my_loyalty_requests() from public, anon, authenticated, service_role;
revoke all on function app.set_loyalty_adjust_limits(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.staff_record_checkin(uuid, text, text, numeric) from public, anon, service_role;
revoke all on function public.staff_member_lookup(uuid, text, uuid) from public, anon, service_role;
revoke all on function public.staff_request(uuid, text, uuid, text, integer, integer) from public, anon, service_role;
revoke all on function public.staff_decide_loyalty_request(uuid, text, text, integer, integer) from public, anon, service_role;
revoke all on function public.staff_loyalty_queue(uuid) from public, anon, service_role;
revoke all on function public.staff_my_loyalty_requests() from public, anon, service_role;
revoke all on function public.set_loyalty_adjust_limits(uuid, integer, integer) from public, anon, service_role;

grant execute on function public.staff_record_checkin(uuid, text, text, numeric) to authenticated;
grant execute on function public.staff_member_lookup(uuid, text, uuid) to authenticated;
grant execute on function public.staff_request(uuid, text, uuid, text, integer, integer) to authenticated;
grant execute on function public.staff_decide_loyalty_request(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.staff_loyalty_queue(uuid) to authenticated;
grant execute on function public.staff_my_loyalty_requests() to authenticated;
grant execute on function public.set_loyalty_adjust_limits(uuid, integer, integer) to authenticated;
