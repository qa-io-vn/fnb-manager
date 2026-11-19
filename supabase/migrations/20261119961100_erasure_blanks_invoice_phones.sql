-- G-05: after a data-subject deletion the POS customer fields of the customer's old invoices are blanked, and stay blank when a
-- later sync or the nightly re-pull brings the same phone again. The phone is remembered only as a hash (app.erased_phones),
-- until the same phone joins again through a membership, which starts clean.

create function app.phone_hash(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(app.loyalty_normalize_phone(p_phone), 'UTF8')), 'hex');
$$;

comment on function app.phone_hash(text) is 'the sha-256 of a phone in E.164 form (null when it does not read as a phone); only for the memory of erased phones, never shown';

create table app.erased_phones (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  phone_hash text not null,
  erased_at timestamptz not null,
  primary key (tenant_id, phone_hash)
);

alter table app.erased_phones enable row level security;
revoke all on table app.erased_phones from public, anon, authenticated;

comment on table app.erased_phones is 'phones of customers erased by a data-subject deletion, kept only as a sha-256 hash per tenant so that invoices synced later with the same phone arrive without customer_phone and customer_name; a new membership for the phone deletes its row; written by app.dsr_erase_customer and the membership trigger only, read by the invoice trigger';

create function app.blank_erased_invoice_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_phone is not null
    and exists (
      select 1 from app.erased_phones e
      where e.tenant_id = new.tenant_id and e.phone_hash = app.phone_hash(new.customer_phone)
    )
  then
    new.customer_phone := null;
    new.customer_name := null;
  end if;
  return new;
end;
$$;

comment on function app.blank_erased_invoice_phone() is 'trigger before an invoice is inserted or its customer_phone changes: blanks customer_phone and customer_name when the phone belongs to an erased customer of the tenant';

create trigger invoices_blank_erased_phone
before insert or update of customer_phone on public.invoices
for each row execute function app.blank_erased_invoice_phone();

create function app.forget_erased_phone_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.erased_phones e
  using public.customers c
  where c.id = new.customer_id
    and e.tenant_id = new.tenant_id
    and e.phone_hash = app.phone_hash(c.phone);
  return new;
end;
$$;

comment on function app.forget_erased_phone_on_join() is 'trigger after a membership is created: the customer joined again of their own accord, so the phone is no longer remembered as erased';

create trigger memberships_forget_erased_phone
after insert on public.memberships
for each row execute function app.forget_erased_phone_on_join();

create or replace function app.dsr_erase_customer(p_request_id uuid, p_actor uuid, p_at timestamptz default now())
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
  v_phone text;
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
    'redemption_invoices_settled', 0, 'consent_records', 0, 'outbound_messages_redacted', 0, 'invoices_unlinked', 0, 'invoices_blanked', 0,
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

  -- the POS fields of the customer's invoices are blanked too (owner's default, security.md section 12), and the phone is
  -- remembered as a hash so that a later sync or the nightly re-pull cannot write it back (trigger invoices_blank_erased_phone)
  select app.loyalty_normalize_phone(c.phone) into v_phone
  from public.customers c
  where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id;
  if v_phone is not null then
    insert into app.erased_phones (tenant_id, phone_hash, erased_at)
    values (v_request.tenant_id, app.phone_hash(v_phone), p_at)
    on conflict (tenant_id, phone_hash) do update set erased_at = excluded.erased_at;
  end if;
  update public.invoices i
  set customer_phone = null, customer_name = null
  where i.tenant_id = v_request.tenant_id
    and (i.customer_id = v_request.subject_id or (v_phone is not null and app.loyalty_normalize_phone(i.customer_phone) = v_phone));
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('invoices_blanked', v_rows);

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

comment on function app.dsr_erase_customer(uuid, uuid, timestamptz) is 'the data-subject deletion of a customer (FR-CMP-04), in one transaction under the tenant''s loyalty lock, for a deletion request of subject customer naming the customer (22023 otherwise, and for a rejected request): quarantines the pool codes of the customer''s held rewards, settles the path D check of the invoices its confirmed rewards were redeemed on, erases every membership with app.erase_loyalty_membership, deletes the customer''s consent records (flag app.dsr_erasure), redacts the customer''s outbound messages, deletes the customer''s Mini App logins with their Auth users and the customers row, unlinks the customer''s invoices and blanks their customer_phone and customer_name (those linked to the customer and those carrying the customer''s phone), remembering the phone as a hash in app.erased_phones so later syncs cannot write it back; then completes the request and logs the counts per table against both deadlines in data_subject_request_actions; a second call answers the logged action with already_done true and deletes nothing; database owner only';
