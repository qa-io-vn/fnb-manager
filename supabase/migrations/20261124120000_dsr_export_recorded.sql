-- G-53, ADR-054: the copy a data-subject export hands over is made in the owner's browser and kept on no server, and
-- every answer of dsr_export is now recorded as an `export` action: who made the copy, when, and the counts of what it
-- holds, never the content. A request may be exported more than once, so only the deletion stays one per request.

alter table public.data_subject_request_actions drop constraint data_subject_request_actions_action_check;
alter table public.data_subject_request_actions
  add constraint data_subject_request_actions_action_check check (action in ('deletion', 'export'));
alter table public.data_subject_request_actions drop constraint data_subject_request_actions_request_id_action_key;
create unique index data_subject_request_actions_one_deletion_key
  on public.data_subject_request_actions (request_id) where action = 'deletion';
create index data_subject_request_actions_request_idx
  on public.data_subject_request_actions (request_id, acted_at);

comment on column public.data_subject_request_actions.action is
  'deletion (one per request, written by dsr_delete) or export (one per answer of dsr_export: who made the copy and when; the copy itself is never stored)';

create or replace function public.dsr_export(p_request_id uuid)
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
  v_counts jsonb;
  v_at timestamptz := now();
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

  v_counts := jsonb_build_object(
    'invoices', jsonb_array_length(v_invoices), 'memberships', jsonb_array_length(v_memberships),
    'loyalty_ledger', jsonb_array_length(v_ledger), 'stamps', jsonb_array_length(v_stamps),
    'receipt_claims', jsonb_array_length(v_claims), 'redemptions', jsonb_array_length(v_redemptions),
    'consent_records', jsonb_array_length(v_consents), 'messages', jsonb_array_length(v_messages)
  );
  -- ADR-054: who made a copy and when, with the counts only; the copy itself is never stored
  insert into public.data_subject_request_actions (
    tenant_id, request_id, action, acted_by, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time
  )
  values (
    v_request.tenant_id, v_request.id, 'export', (select auth.uid()), v_at, v_counts, v_request.first_response_due_at, v_request.completion_due_at,
    coalesce(v_request.responded_at, v_at) <= v_request.first_response_due_at, v_at <= v_request.completion_due_at
  );
  return jsonb_build_object(
    'request', jsonb_build_object('id', v_request.id, 'request_type', v_request.request_type, 'received_at', v_request.received_at),
    'exported_at', v_at,
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
    'counts', v_counts
  );
end;
$$;

comment on function public.dsr_export(uuid) is 'RPC for owners and managers with every store (42501 for every other caller, a customer session included): every row of the customer of a data-subject request of their tenant as one JSON (the customer, the customer fields of invoices, memberships, ledger, stamps, claims, redemptions, consent records and message log rows, with the counts) and nothing of another customer or tenant; the full phone only for an owner, masked for a manager; moves a received request to in_progress and records an export action in data_subject_request_actions (the caller, the moment, the counts; never the content, ADR-054) at every answer; 22023 for a request about staff, naming no customer, rejected or whose customer is gone';
