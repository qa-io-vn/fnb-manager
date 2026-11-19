alter table public.data_subject_requests add column responded_at timestamptz;
alter table public.data_subject_requests add constraint data_subject_requests_tenant_id_id_key unique (tenant_id, id);

comment on column public.data_subject_requests.responded_at is 'when the first response was given, compared with first_response_due_at: stamped when the status first leaves received (app.stamp_dsr_response) or by the deletion, unless given; set once';

create function app.stamp_dsr_response()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.responded_at is not null and new.responded_at is distinct from old.responded_at then
    raise exception 'data_subject_requests.responded_at is set once' using errcode = '22023';
  end if;
  if new.responded_at is null and new.status <> 'received' then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

comment on function app.stamp_dsr_response() is 'trigger before a data_subject_requests row is written: stamps responded_at when the status is no longer received and no response time was given, and refuses moving it once set (22023)';

create trigger data_subject_requests_stamp_response
before insert or update on public.data_subject_requests
for each row execute function app.stamp_dsr_response();

create table public.data_subject_request_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('deletion')),
  acted_by uuid references auth.users (id) on delete set null,
  acted_at timestamptz not null,
  counts jsonb not null check (jsonb_typeof(counts) = 'object' and app.facts_are_count_only(counts)),
  first_response_due_at timestamptz not null,
  completion_due_at timestamptz not null,
  responded_on_time boolean not null,
  completed_on_time boolean not null,
  created_at timestamptz not null default now(),
  unique (request_id, action),
  foreign key (tenant_id, request_id) references public.data_subject_requests (tenant_id, id) on delete cascade
);

comment on table public.data_subject_request_actions is 'what was done for a data-subject request, logged against its deadlines: one row per request and action (deletion today), with the rows removed or redacted per table (counts only), who acted and when, both deadlines of the request and whether the first response and the completion met them; written only by app.dsr_erase_customer';
comment on column public.data_subject_request_actions.counts is 'rows per table, counts only: memberships, loyalty_ledger, stamps, redemptions, receipt_claims, pending_checkins, loyalty_queue, loyalty_refusals, loyalty_requests, coupon_codes_quarantined, redemption_invoices_settled, consent_records, outbound_messages_redacted, invoices_unlinked, customer_logins, auth_users, customers';
comment on column public.data_subject_request_actions.responded_on_time is 'the request''s responded_at (or this action, when no response was recorded before) was no later than first_response_due_at (2 working days)';
comment on column public.data_subject_request_actions.completed_on_time is 'this action was no later than completion_due_at (20 days, 30 with a processor)';

alter table public.data_subject_request_actions enable row level security;

create policy data_subject_request_actions_select_for_tenant_managers on public.data_subject_request_actions
  for select to authenticated
  using (app.can_manage_store_scope(tenant_id, null));

revoke all on public.data_subject_request_actions from anon;
revoke insert, update, delete, truncate, references, trigger on public.data_subject_request_actions from authenticated;
grant select on public.data_subject_request_actions to authenticated;

create function app.keep_consent_records()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'postgres' and current_setting('app.dsr_erasure', true) = 'on' then
      return old;
    end if;
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;
    end if;
  end if;
  raise exception 'consent_records is an append-only ledger: only the data-subject deletion removes a subject''s records';
end;
$$;

comment on function app.keep_consent_records() is 'trigger before a consent_records row is deleted and before the table is truncated: refuses for every role, the service role and the database owner included, except inside the data-subject deletion (app.dsr_erase_customer sets the transaction-local flag app.dsr_erasure, which only the database owner may use) and the cascade of a deleted tenant';

create trigger consent_records_keep_on_delete
before delete on public.consent_records
for each row execute function app.keep_consent_records();
create trigger consent_records_no_truncate
before truncate on public.consent_records
for each statement execute function app.keep_consent_records();

create function app.dsr_action_result(p_action_id uuid, p_already_done boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'request_id', a.request_id,
    'action', a.action,
    'status', r.status,
    'already_done', p_already_done,
    'acted_at', a.acted_at,
    'counts', a.counts,
    'first_response_due_at', a.first_response_due_at,
    'completion_due_at', a.completion_due_at,
    'responded_on_time', a.responded_on_time,
    'completed_on_time', a.completed_on_time
  )
  from public.data_subject_request_actions a
  join public.data_subject_requests r on r.id = a.request_id
  where a.id = p_action_id;
$$;

comment on function app.dsr_action_result(uuid, boolean) is 'the answer of a logged data-subject action: request, action, the request''s status, whether it had already been done, when, the counts per table, both deadlines and whether they were met';

create function app.dsr_erase_customer(p_request_id uuid, p_actor uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
  v_action uuid;
  v_counts jsonb;
  v_erased jsonb;
  v_key text;
  v_membership uuid;
  v_users uuid[];
  v_rows integer;
begin
  select r.* into v_request from public.data_subject_requests r where r.id = p_request_id for update;
  if v_request.id is null then
    raise exception 'dsr_delete needs an existing data-subject request' using errcode = '22023';
  end if;
  select a.id into v_action
  from public.data_subject_request_actions a
  where a.request_id = p_request_id and a.action = 'deletion';
  if v_action is not null then
    return app.dsr_action_result(v_action, true);
  end if;
  if v_request.request_type <> 'deletion' then
    raise exception 'dsr_delete deletes only for a deletion request' using errcode = '22023';
  end if;
  if v_request.subject_type <> 'customer' then
    raise exception 'dsr_delete deletes a customer; a member of the tenant is removed through the member functions' using errcode = '22023';
  end if;
  if v_request.subject_id is null then
    raise exception 'the deletion request names no customer yet' using errcode = '22023';
  end if;
  if v_request.status = 'rejected' then
    raise exception 'a rejected request deletes nothing' using errcode = '22023';
  end if;
  if p_at is null or p_at < v_request.received_at then
    raise exception 'the deletion happens after the request was received' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || v_request.tenant_id::text));

  v_counts := jsonb_build_object(
    'memberships', 0, 'loyalty_ledger', 0, 'stamps', 0, 'redemptions', 0, 'receipt_claims', 0, 'pending_checkins', 0,
    'loyalty_queue', 0, 'loyalty_refusals', 0, 'loyalty_requests', 0, 'coupon_codes_quarantined', 0,
    'redemption_invoices_settled', 0, 'consent_records', 0, 'outbound_messages_redacted', 0, 'invoices_unlinked', 0,
    'customer_logins', 0, 'auth_users', 0, 'customers', 0
  );

  select count(*) into v_rows
  from app.loyalty_requests q
  join public.memberships m on m.id = q.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_request.subject_id;
  v_counts := v_counts || jsonb_build_object('loyalty_requests', v_rows);

  update public.coupon_codes k
  set state = 'quarantined', quarantined_at = p_at
  from public.redemptions r
  join public.memberships m on m.id = r.membership_id
  where m.tenant_id = v_request.tenant_id
    and m.customer_id = v_request.subject_id
    and r.state = 'held'
    and k.id = r.coupon_code_id
    and k.state = 'assigned';
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('coupon_codes_quarantined', v_rows);

  with settled as (
    insert into public.loyalty_queue (
      tenant_id, store_id, invoice_id, matched_path, candidate_invoice_ids, reason, state, created_at, resolved_at, resolved_by, resolution_reason
    )
    select r.tenant_id, i.store_id, i.id, 'D', '{}'::uuid[], 'discount_without_redemption', 'dismissed', p_at, p_at, p_actor,
      'the redemption was erased with its member on a data-subject request'
    from public.redemptions r
    join public.memberships m on m.id = r.membership_id
    join public.invoices i on i.id = r.confirmed_invoice_id
    where m.tenant_id = v_request.tenant_id
      and m.customer_id = v_request.subject_id
      and r.state = 'confirmed'
    on conflict (invoice_id, reason) where invoice_id is not null and redemption_id is null do nothing
    returning 1
  )
  select count(*) into v_rows from settled;
  v_counts := v_counts || jsonb_build_object('redemption_invoices_settled', v_rows);

  for v_membership in
    select m.id
    from public.memberships m
    where m.tenant_id = v_request.tenant_id and m.customer_id = v_request.subject_id
    order by m.joined_at, m.id
  loop
    v_erased := app.erase_loyalty_membership(v_membership);
    for v_key in select jsonb_object_keys(v_erased) loop
      v_counts := v_counts || jsonb_build_object(v_key, coalesce((v_counts ->> v_key)::integer, 0) + (v_erased ->> v_key)::integer);
    end loop;
  end loop;

  perform set_config('app.dsr_erasure', 'on', true);
  delete from public.consent_records c
  where c.tenant_id = v_request.tenant_id
    and c.subject_type = 'customer'
    and c.subject_id = v_request.subject_id;
  get diagnostics v_rows = row_count;
  perform set_config('app.dsr_erasure', 'off', true);
  v_counts := v_counts || jsonb_build_object('consent_records', v_rows);

  v_counts := v_counts || jsonb_build_object(
    'outbound_messages_redacted', app.redact_outbound_for_subject(v_request.tenant_id, 'customer', v_request.subject_id)
  );

  select count(*) into v_rows
  from public.invoices i
  where i.tenant_id = v_request.tenant_id and i.customer_id = v_request.subject_id;
  v_counts := v_counts || jsonb_build_object('invoices_unlinked', v_rows);

  select coalesce(array_agg(l.user_id), '{}'::uuid[]) into v_users
  from app.customer_logins l
  where l.tenant_id = v_request.tenant_id and l.customer_id = v_request.subject_id;
  v_counts := v_counts || jsonb_build_object('customer_logins', cardinality(v_users));
  delete from auth.users u
  where u.id = any (v_users)
    and not exists (select 1 from public.tenant_members t where t.user_id = u.id)
    and not exists (select 1 from public.zalo_identities z where z.user_id = u.id);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_rows);
  delete from app.customer_logins l where l.user_id = any (v_users);

  delete from public.customers c where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('customers', v_rows);

  update public.data_subject_requests r
  set status = 'completed',
      completed_at = coalesce(r.completed_at, p_at),
      responded_at = coalesce(r.responded_at, p_at),
      handled_by = coalesce(r.handled_by, p_actor)
  where r.id = p_request_id;

  insert into public.data_subject_request_actions (
    tenant_id, request_id, action, acted_by, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time
  )
  values (
    v_request.tenant_id, p_request_id, 'deletion', p_actor, p_at, v_counts, v_request.first_response_due_at, v_request.completion_due_at,
    coalesce(v_request.responded_at, p_at) <= v_request.first_response_due_at, p_at <= v_request.completion_due_at
  )
  returning id into v_action;
  return app.dsr_action_result(v_action, false);
end;
$$;

comment on function app.dsr_erase_customer(uuid, uuid, timestamptz) is 'the data-subject deletion of a customer (FR-CMP-04), in one transaction under the tenant''s loyalty lock, for a deletion request of subject customer naming the customer (22023 otherwise, and for a rejected request): quarantines the pool codes of the customer''s held rewards, settles the path D check of the invoices its confirmed rewards were redeemed on (a dismissed discount_without_redemption item, so no false mismatch is raised later), erases every membership with app.erase_loyalty_membership (queue items, refusals, stamps, redemptions, claims, check-ins, ledger rows, loyalty requests, the membership), deletes the customer''s consent records (the only way past their append-only rule, flag app.dsr_erasure), redacts the customer''s outbound messages (app.redact_outbound_for_subject), deletes the customer''s Mini App logins with their Auth users and sessions (an Auth user that is also a member or a paired staff login keeps its user and loses only the customer login) and the customers row (invoices keep their POS customer fields and lose the link); then completes the request (completed_at, responded_at and handled_by kept when set) and logs the counts per table against both deadlines in data_subject_request_actions; a second call answers the logged action with already_done true and deletes nothing; database owner only';

create function public.dsr_delete(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select r.tenant_id into v_tenant from public.data_subject_requests r where r.id = p_request_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store deletes a data subject' using errcode = '42501';
  end if;
  return app.dsr_erase_customer(p_request_id, (select auth.uid()), now());
end;
$$;

comment on function public.dsr_delete(uuid) is 'RPC for owners with an unlimited scope (42501 for every other caller, including managers): app.dsr_erase_customer of a deletion request of their tenant at the current time, returning the logged counts and deadlines';

comment on function app.erase_loyalty_membership(uuid) is 'the data-subject deletion of a membership''s loyalty rows: its queue items, refusals, stamps, redemptions, claims, check-ins, ledger rows, loyalty requests and the membership itself, returning the counts; the only way past the append-only rule of loyalty_ledger; called by app.dsr_erase_customer, which also removes the customer, its consent evidence, logins and messages; service role and database owner only';

comment on function app.customer_request_deletion(timestamptz) is 'records the joined customer''s request to delete their data in data_subject_requests (subject customer, contact mini_app, deadlines filled by the ledger''s trigger); an open deletion request of the customer is answered again instead of a second one; an owner then carries it out with dsr_delete; 42501 for a visitor and every other caller';

revoke all on function app.stamp_dsr_response() from public, anon, authenticated, service_role;
revoke all on function app.keep_consent_records() from public, anon, authenticated, service_role;
revoke all on function app.dsr_action_result(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function app.dsr_erase_customer(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.dsr_delete(uuid) from public, anon, service_role;
grant execute on function public.dsr_delete(uuid) to authenticated;
