create function app.dsr_scope_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  where m.user_id = (select auth.uid())
    and m.role = any (array['owner', 'manager']::public.tenant_role[])
    and m.store_ids is null;
$$;

comment on function app.dsr_scope_tenant_ids() is 'the tenants where the caller is an owner or a manager with every store, the only callers of the data-subject tooling (dsr_lookup, dsr_export, dsr_correct, dsr_due_soon); a customer session and every other role get an empty list';

create function app.dsr_request_for_caller(p_request_id uuid, p_caller text)
returns public.data_subject_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
begin
  select r.* into v_request from public.data_subject_requests r where r.id = p_request_id;
  if v_request.id is null or not v_request.tenant_id = any (app.dsr_scope_tenant_ids()) then
    raise exception '% is for owners and managers with every store, on a request of their tenant', p_caller using errcode = '42501';
  end if;
  if v_request.subject_type <> 'customer' then
    raise exception '% handles a customer; a member of the tenant is handled through the member functions', p_caller using errcode = '22023';
  end if;
  if v_request.subject_id is null then
    raise exception 'the request names no customer yet' using errcode = '22023';
  end if;
  if v_request.status = 'rejected' then
    raise exception 'a rejected request is not carried out' using errcode = '22023';
  end if;
  return v_request;
end;
$$;

comment on function app.dsr_request_for_caller(uuid, text) is 'the data-subject request of the caller''s tenant that a tooling function works on: 42501 when the request is not in a tenant where the caller is an owner or a manager with every store, 22023 when it is not about a customer, names no customer yet or was rejected';

create function public.dsr_lookup(p_phone text)
returns table (
  customer_id uuid,
  tenant_id uuid,
  name text,
  phone_masked text,
  first_seen_at timestamptz,
  memberships integer,
  ledger_entries integer,
  stamp_total integer,
  point_total integer,
  consents jsonb,
  messages integer,
  open_requests integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenants uuid[] := app.dsr_scope_tenant_ids();
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if v_method not in ('', 'POST') then
    raise sqlstate 'PT405' using message = 'dsr_lookup takes the phone in a POST body, never in a URL';
  end if;
  if cardinality(v_tenants) = 0 then
    raise exception using errcode = '42501', message = 'dsr_lookup is for owners and managers with every store';
  end if;
  if v_phone is null then
    return;
  end if;

  return query
  select
    c.id,
    c.tenant_id,
    c.name,
    app.loyalty_masked_phone(c.phone),
    c.first_seen_at,
    (select count(*)::integer from public.memberships m where m.tenant_id = c.tenant_id and m.customer_id = c.id),
    (select count(*)::integer from public.loyalty_ledger l join public.memberships m on m.id = l.membership_id where m.tenant_id = c.tenant_id and m.customer_id = c.id),
    (select coalesce(sum(l.stamp_delta), 0)::integer from public.loyalty_ledger l join public.memberships m on m.id = l.membership_id where m.tenant_id = c.tenant_id and m.customer_id = c.id),
    (select coalesce(sum(l.point_delta), 0)::integer from public.loyalty_ledger l join public.memberships m on m.id = l.membership_id where m.tenant_id = c.tenant_id and m.customer_id = c.id),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id, 'purpose', k.purpose, 'channel', k.channel, 'policy_version', k.policy_version,
        'granted_at', k.granted_at, 'revoked_at', k.revoked_at, 'active', k.revoked_at is null
      ) order by k.granted_at, k.id), '[]'::jsonb)
      from public.consent_records k
      where k.tenant_id = c.tenant_id and k.subject_type = 'customer' and k.subject_id = c.id
    ),
    (select count(*)::integer from public.outbound_messages o where o.tenant_id = c.tenant_id and o.subject_type = 'customer' and o.subject_id = c.id),
    (select count(*)::integer from public.data_subject_requests r where r.tenant_id = c.tenant_id and r.subject_type = 'customer' and r.subject_id = c.id and r.status in ('received', 'in_progress'))
  from public.customers c
  where c.tenant_id = any (v_tenants)
    and c.phone is not null
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by c.first_seen_at desc, c.id desc
  limit 20;
end;
$$;

comment on function public.dsr_lookup(text) is 'the data-subject lookup (FR-CMP-04) for owners and managers with every store (42501 for every other caller, a customer session included), POST only (PT405 for a GET, the phone never in a URL): per customer of the caller''s tenants with that phone, the masked phone, the memberships, the ledger entry count and stamp and point totals, the consent rows per purpose, the message count and the open requests; never the full phone';

create function public.dsr_export(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
  v_customer public.customers;
  v_owner boolean;
  v_invoices jsonb;
  v_memberships jsonb;
  v_ledger jsonb;
  v_stamps jsonb;
  v_claims jsonb;
  v_redemptions jsonb;
  v_consents jsonb;
  v_messages jsonb;
begin
  v_request := app.dsr_request_for_caller(p_request_id, 'dsr_export');
  select c.* into v_customer from public.customers c where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id;
  if v_customer.id is null then
    raise exception 'the customer of this request no longer exists' using errcode = '22023';
  end if;
  v_owner := app.has_store_scope(v_request.tenant_id, null, array['owner']::public.tenant_role[]);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'external_id', i.external_id, 'sold_at', i.sold_at, 'business_date', i.business_date, 'net_amount', i.net_amount,
    'customer_name', i.customer_name,
    'customer_phone', case when v_owner then i.customer_phone else app.loyalty_masked_phone(i.customer_phone) end
  ) order by i.sold_at, i.id), '[]'::jsonb) into v_invoices
  from public.invoices i
  where i.tenant_id = v_request.tenant_id
    and (i.customer_id = v_customer.id or (v_customer.phone is not null and app.loyalty_normalize_phone(i.customer_phone) = v_customer.phone));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'programme_id', m.programme_id, 'joined_at', m.joined_at, 'channel', m.channel, 'status', m.status
  ) order by m.joined_at, m.id), '[]'::jsonb) into v_memberships
  from public.memberships m
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'membership_id', l.membership_id, 'entry_kind', l.entry_kind, 'stamp_delta', l.stamp_delta, 'point_delta', l.point_delta,
    'value_amount', l.value_amount, 'invoice_id', l.invoice_id, 'business_date', l.business_date, 'pending', l.pending,
    'reason', l.reason, 'occurred_at', l.occurred_at, 'expires_at', l.expires_at
  ) order by l.occurred_at, l.id), '[]'::jsonb) into v_ledger
  from public.loyalty_ledger l
  join public.memberships m on m.id = l.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'membership_id', s.membership_id, 'earned_at', s.earned_at, 'expires_at', s.expires_at, 'state', s.state, 'closed_at', s.closed_at
  ) order by s.earned_at, s.id), '[]'::jsonb) into v_stamps
  from public.stamps s
  join public.memberships m on m.id = s.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'membership_id', q.membership_id, 'store_id', q.store_id, 'business_date', q.business_date, 'receipt_no', q.receipt_no,
    'amount', q.amount, 'status', q.status, 'created_at', q.created_at, 'closed_at', q.closed_at
  ) order by q.created_at, q.id), '[]'::jsonb) into v_claims
  from public.receipt_claims q
  join public.memberships m on m.id = q.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'membership_id', r.membership_id, 'coupon_id', r.coupon_id, 'code', r.code, 'state', r.state,
    'held_at', r.held_at, 'confirmed_at', r.confirmed_at, 'released_at', r.released_at
  ) order by r.held_at, r.id), '[]'::jsonb) into v_redemptions
  from public.redemptions r
  join public.memberships m on m.id = r.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'purpose', k.purpose, 'channel', k.channel, 'policy_version', k.policy_version,
    'granted_at', k.granted_at, 'revoked_at', k.revoked_at
  ) order by k.granted_at, k.id), '[]'::jsonb) into v_consents
  from public.consent_records k
  where k.tenant_id = v_request.tenant_id and k.subject_type = 'customer' and k.subject_id = v_customer.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'channel', o.channel, 'purpose', o.purpose, 'template_ref', o.template_ref, 'sent_at', o.sent_at, 'status', o.status
  ) order by o.sent_at, o.id), '[]'::jsonb) into v_messages
  from public.outbound_messages o
  where o.tenant_id = v_request.tenant_id and o.subject_type = 'customer' and o.subject_id = v_customer.id;

  if v_request.status = 'received' then
    update public.data_subject_requests r set status = 'in_progress' where r.id = v_request.id;
  end if;

  return jsonb_build_object(
    'request', jsonb_build_object('id', v_request.id, 'request_type', v_request.request_type, 'received_at', v_request.received_at),
    'exported_at', now(),
    'customer', jsonb_build_object(
      'id', v_customer.id, 'name', v_customer.name,
      'phone', case when v_owner then v_customer.phone else app.loyalty_masked_phone(v_customer.phone) end,
      'first_seen_at', v_customer.first_seen_at, 'last_seen_at', v_customer.last_seen_at
    ),
    'invoices', v_invoices,
    'memberships', v_memberships,
    'loyalty_ledger', v_ledger,
    'stamps', v_stamps,
    'receipt_claims', v_claims,
    'redemptions', v_redemptions,
    'consent_records', v_consents,
    'messages', v_messages,
    'counts', jsonb_build_object(
      'invoices', jsonb_array_length(v_invoices), 'memberships', jsonb_array_length(v_memberships),
      'loyalty_ledger', jsonb_array_length(v_ledger), 'stamps', jsonb_array_length(v_stamps),
      'receipt_claims', jsonb_array_length(v_claims), 'redemptions', jsonb_array_length(v_redemptions),
      'consent_records', jsonb_array_length(v_consents), 'messages', jsonb_array_length(v_messages)
    )
  );
end;
$$;

comment on function public.dsr_export(uuid) is 'RPC for owners and managers with every store (42501 for every other caller, a customer session included): every row of the customer of a data-subject request of their tenant as one JSON (the customer, the customer fields of invoices, memberships, ledger, stamps, claims, redemptions, consent records and message log rows, with the counts) and nothing of another customer or tenant; the full phone only for an owner, masked for a manager; moves a received request to in_progress; 22023 for a request about staff, naming no customer, rejected or whose customer is gone';

create function public.dsr_correct(p_request_id uuid, p_field text, p_value text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
  v_value text := btrim(p_value);
  v_changed boolean;
begin
  v_request := app.dsr_request_for_caller(p_request_id, 'dsr_correct');
  if v_request.request_type <> 'correction' then
    raise exception 'dsr_correct works on a correction request' using errcode = '22023';
  end if;
  if v_request.status = 'completed' then
    raise exception 'a completed request is not changed' using errcode = '22023';
  end if;
  if p_field is distinct from 'name' then
    raise exception 'only the name is corrected here; the phone and the sales data are corrected in the POS first and the days synced again' using errcode = '22023';
  end if;
  if v_value is null or char_length(v_value) not between 1 and 120 or v_value ~ '[[:cntrl:]]' then
    raise exception 'the corrected name has 1 to 120 characters and no control characters' using errcode = '22023';
  end if;

  update public.customers c set name = v_value
  where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id and c.name is distinct from v_value;
  v_changed := found;
  if not v_changed and not exists (select 1 from public.customers c where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id) then
    raise exception 'the customer of this request no longer exists' using errcode = '22023';
  end if;

  update public.data_subject_requests r
  set status = 'in_progress'
  where r.id = v_request.id and r.status = 'received';

  return jsonb_build_object('request_id', v_request.id, 'field', 'name', 'changed', v_changed,
    'status', (select r.status from public.data_subject_requests r where r.id = v_request.id));
end;
$$;

comment on function public.dsr_correct(uuid, text, text) is 'RPC for owners and managers with every store (42501 for every other caller): corrects the customer''s name in our copy on a correction request of their tenant (22023 for another request type, a completed or rejected request, any field but name, or a name that is empty, over 120 characters or holds control characters) and moves a received request to in_progress; the answer holds no value, and POS data is corrected in the POS first';

create function public.dsr_due_soon(p_days integer default 3)
returns table (
  request_id uuid,
  tenant_id uuid,
  request_type public.dsr_type,
  status public.dsr_status,
  received_at timestamptz,
  first_response_due_at timestamptz,
  completion_due_at timestamptz,
  responded_at timestamptz,
  first_response_state text,
  completion_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenants uuid[] := app.dsr_scope_tenant_ids();
begin
  if cardinality(v_tenants) = 0 then
    raise exception using errcode = '42501', message = 'dsr_due_soon is for owners and managers with every store';
  end if;
  if p_days is null or p_days not between 0 and 30 then
    raise exception 'dsr_due_soon looks 0 to 30 days ahead' using errcode = '22023';
  end if;
  return query
  select r.id, r.tenant_id, r.request_type, r.status, r.received_at, r.first_response_due_at, r.completion_due_at, r.responded_at, f.state, c.state
  from public.data_subject_requests r
  cross join lateral (
    select case
      when r.responded_at is not null then 'done'
      when r.first_response_due_at < now() then 'overdue'
      when r.first_response_due_at <= now() + make_interval(days => p_days) then 'due_soon'
      else 'on_track'
    end as state
  ) f
  cross join lateral (
    select case
      when r.completion_due_at < now() then 'overdue'
      when r.completion_due_at <= now() + make_interval(days => p_days) then 'due_soon'
      else 'on_track'
    end as state
  ) c
  where r.tenant_id = any (v_tenants)
    and r.status in ('received', 'in_progress')
    and (f.state in ('overdue', 'due_soon') or c.state in ('overdue', 'due_soon'))
  order by least(
      case when r.responded_at is null then r.first_response_due_at end,
      r.completion_due_at
    ), r.id;
end;
$$;

comment on function public.dsr_due_soon(integer) is 'the open data-subject requests (received or in progress) of the caller''s tenants whose first response (until responded_at is set) or completion deadline is overdue or within p_days days (0 to 30, 3 by default), soonest first, with a state per deadline (done, overdue, due_soon, on_track); for owners and managers with every store (42501 for every other caller); no contact and no subject in the rows';

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values (
  'dsr_due_soon', 'operations', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
  '{"days": 3}',
  '{"days": {"type": "integer", "min": 1, "max": 10}}',
  interval '24 hours', null, false, false, 197
);

create function app.evaluate_dsr_due_soon(p_tenant_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_overdue integer;
  v_soon integer;
  v_open_event uuid;
  v_facts jsonb;
  v_raised record;
begin
  select coalesce((e.params ->> 'days')::integer, 3) into v_days
  from app.effective_alert_rule(p_tenant_id, null, 'dsr_due_soon') e;
  if v_days is null then
    return jsonb_build_object('dsr_alerts', 0);
  end if;
  select
    count(*) filter (where (r.responded_at is null and r.first_response_due_at < p_at) or r.completion_due_at < p_at),
    count(*) filter (
      where not ((r.responded_at is null and r.first_response_due_at < p_at) or r.completion_due_at < p_at)
        and ((r.responded_at is null and r.first_response_due_at <= p_at + make_interval(days => v_days)) or r.completion_due_at <= p_at + make_interval(days => v_days))
    )
  into v_overdue, v_soon
  from public.data_subject_requests r
  where r.tenant_id = p_tenant_id and r.status in ('received', 'in_progress');
  select e.id into v_open_event
  from public.alert_events e
  where e.tenant_id = p_tenant_id and e.dedupe_key = 'dsr_due_soon:tenant' and e.state = 'open'
  order by e.opened_at desc
  limit 1;
  v_facts := jsonb_build_object('overdue', v_overdue, 'due_soon', v_soon, 'days', v_days);
  if v_overdue + v_soon > 0 then
    if v_open_event is null then
      select r.* into v_raised from app.raise_alert(p_tenant_id, 'dsr_due_soon', 'tenant', 'incremental', p_at, null, null, null, null, v_facts) r;
      return jsonb_build_object('dsr_alerts', case when v_raised.outcome = 'opened' then 1 else 0 end, 'overdue', v_overdue, 'due_soon', v_soon);
    end if;
    update public.alert_events e set facts = v_facts where e.id = v_open_event and e.facts is distinct from v_facts;
  elsif v_open_event is not null then
    perform app.resolve_rule_episode(v_open_event, 'cleared', p_at);
  end if;
  return jsonb_build_object('dsr_alerts', 0, 'overdue', v_overdue, 'due_soon', v_soon);
end;
$$;

comment on function app.evaluate_dsr_due_soon(uuid, timestamptz) is 'the dsr_due_soon alert rule of a tenant: opens one tenant-level episode when an open data-subject request has a deadline overdue or within the rule''s days (3 by default), keeps its counts current while it stays open and resolves it when nothing is due; the facts are counts only';

revoke all on function app.dsr_scope_tenant_ids() from public, anon, authenticated, service_role;
revoke all on function app.dsr_request_for_caller(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_dsr_due_soon(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.dsr_lookup(text) from public, anon, service_role;
revoke all on function public.dsr_export(uuid) from public, anon, service_role;
revoke all on function public.dsr_correct(uuid, text, text) from public, anon, service_role;
revoke all on function public.dsr_due_soon(integer) from public, anon, service_role;
grant execute on function public.dsr_lookup(text) to authenticated;
grant execute on function public.dsr_export(uuid) to authenticated;
grant execute on function public.dsr_correct(uuid, text, text) to authenticated;
grant execute on function public.dsr_due_soon(integer) to authenticated;
