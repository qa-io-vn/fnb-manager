-- G-47 (a): a data-subject deletion also scrubs the raw POS payloads in sale_payloads. Until now the erasure blanked the
-- phone and the name on the invoice rows only, while the stored vendor payload of the same sales still held them (and the
-- e-invoice buyer fields beside them), and every later sync wrote them back into the payload document.
--
-- What is scrubbed, inside invoice, lines and payments of a sale record (external_id is never touched):
--   * the customer fields of the sales the erasure blanks: every key that starts with customer, buyer or inv_buyer and holds
--     a string or a number becomes JSON null (the POS's customer_phone, customer_name, customer_id and the e-invoice
--     buyer's name, address, e-mail, tax code and bank fields);
--   * the phone itself wherever it is written as text in the tenant's payloads (a sale note, a table name), also with
--     spaces, dots, dashes or brackets inside it: such a string value becomes JSON null; a record whose customer field held
--     the phone loses its other customer fields too.
-- A later sync or the nightly re-pull that brings the phone back on a sale's customer field is scrubbed on arrival by the
-- invoice trigger that already blanks the invoice row, with the same blank_before rule after a re-join.

create function app.phones_in_text(p_text text)
returns setof text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_run text;
  v_groups text[];
  v_from integer;
  v_to integer;
  v_phone text;
  v_seen text[] := '{}';
begin
  if p_text is null then
    return;
  end if;
  -- every run of digit groups joined by at most two separators, then every contiguous span of its groups up to the length
  -- of a phone, so that a phone next to other digits ("0900 000 501 2 ly") is still found while a longer number (an id)
  -- never reads as one
  for v_run in
    select m[1] from regexp_matches(p_text, '(\+?[0-9]+(?:[ .()-]{1,2}[0-9]+)*)', 'g') as m
  loop
    v_groups := regexp_split_to_array(v_run, '[ .()-]+');
    for v_from in 1 .. cardinality(v_groups) loop
      for v_to in v_from .. cardinality(v_groups) loop
        exit when length(array_to_string(v_groups[v_from:v_to], '')) > 17;
        v_phone := app.loyalty_normalize_phone(array_to_string(v_groups[v_from:v_to], ''));
        if v_phone is not null and v_phone <> all (v_seen) then
          v_seen := v_seen || v_phone;
          return next v_phone;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

comment on function app.phones_in_text(text) is 'every phone written in the text, in E.164 as app.loyalty_normalize_phone reads it, separators between digit groups included; a longer digit run that merely contains a phone''s digits gives none; internal to the erasure of sale payloads';

create function app.text_holds_phone(p_text text, p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
    and p_phone is not null
    and length(right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 7)) = 7
    and strpos(regexp_replace(p_text, '[^0-9]', '', 'g'), right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 7)) > 0
    and exists (select 1 from app.phones_in_text(p_text) as found (phone) where found.phone = p_phone);
$$;

comment on function app.text_holds_phone(text, text) is 'true when the text contains the phone (E.164, as app.loyalty_normalize_phone writes it) in any form app.phones_in_text finds; internal to the erasure of sale payloads';

create function app.scrub_payload_value(p_value jsonb, p_phone text, p_customer_keys boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(jsonb_object_agg(
          e.key,
          case
            when p_customer_keys and e.key ~* '^(customer|buyer|inv_buyer)' and jsonb_typeof(e.value) in ('string', 'number') then 'null'::jsonb
            else app.scrub_payload_value(e.value, p_phone, p_customer_keys)
          end
        ), '{}'::jsonb)
      into v_out
      from jsonb_each(p_value) as e;
      return v_out;
    when 'array' then
      select coalesce(jsonb_agg(app.scrub_payload_value(e.value, p_phone, p_customer_keys) order by e.ord), '[]'::jsonb)
      into v_out
      from jsonb_array_elements(p_value) with ordinality as e (value, ord);
      return v_out;
    when 'string' then
      if app.text_holds_phone(p_value #>> '{}', p_phone) then
        return 'null'::jsonb;
      end if;
      return p_value;
    else
      return p_value;
  end case;
end;
$$;

comment on function app.scrub_payload_value(jsonb, text, boolean) is 'a payload value with every string holding the phone replaced by JSON null and, when p_customer_keys, every string or number under a key starting with customer, buyer or inv_buyer too, at any depth; internal to the erasure of sale payloads';

create function app.sale_record_customer_holds_phone(p_record jsonb, p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_path_query(p_record, 'strict $.** ? (@.type() == "object")') as o (value)
    cross join lateral jsonb_each(o.value) as e
    where e.key ~* '^(customer|buyer|inv_buyer)'
      and jsonb_typeof(e.value) in ('string', 'number')
      and app.text_holds_phone(e.value #>> '{}', p_phone)
  );
$$;

comment on function app.sale_record_customer_holds_phone(jsonb, text) is 'true when a customer or buyer field anywhere in the sale record holds the phone; internal to the erasure of sale payloads';

create function app.scrub_sale_record(p_record jsonb, p_phone text, p_customer_keys boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_record || jsonb_build_object(
    'invoice', app.scrub_payload_value(coalesce(p_record -> 'invoice', 'null'::jsonb), p_phone, p_customer_keys),
    'lines', app.scrub_payload_value(coalesce(p_record -> 'lines', '{}'::jsonb), p_phone, p_customer_keys),
    'payments', app.scrub_payload_value(coalesce(p_record -> 'payments', '{}'::jsonb), p_phone, p_customer_keys)
  );
$$;

comment on function app.scrub_sale_record(jsonb, text, boolean) is 'one sale record of a payload document with its invoice, line and payment payloads scrubbed by app.scrub_payload_value; external_id is kept; internal to the erasure of sale payloads';

create function app.scrub_sale_payload_records(p_store_id uuid, p_business_date date, p_external_ids text[], p_phone text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payload text;
  v_changed integer;
begin
  select p.payload into v_payload
  from public.sale_payloads p
  where p.store_id = p_store_id and p.business_date = p_business_date
  for update;
  if v_payload is null or cardinality(p_external_ids) = 0 then
    return 0;
  end if;
  with entries as (
    select e.entry, e.ord, e.entry::jsonb as record
    from string_to_table(v_payload, E'\n') with ordinality as e (entry, ord)
  ),
  scrubbed as (
    select entries.*,
      case
        when record ->> 'external_id' = any (p_external_ids) then app.scrub_sale_record(record, p_phone, true)
        else record
      end as result
    from entries
  )
  select string_agg(case when result = record then entry else result::text end, E'\n' order by ord),
    count(*) filter (where result <> record)
  into v_payload, v_changed
  from scrubbed;
  if v_changed > 0 then
    update public.sale_payloads p
    set payload = v_payload, updated_at = now()
    where p.store_id = p_store_id and p.business_date = p_business_date;
  end if;
  return v_changed;
end;
$$;

comment on function app.scrub_sale_payload_records(uuid, date, text[], text) is 'scrubs the customer fields and the phone (null for none) of the named sales in the payload document of one store and business date, keeping every other record byte for byte; returns the number of records changed; called by app.dsr_erase_customer and the invoice trigger only';

create function app.scrub_phone_from_sale_payloads(p_tenant_id uuid, p_phone text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 7);
  v_pattern text;
  v_document record;
  v_payload text;
  v_changed integer;
  v_total integer := 0;
begin
  if p_phone is null or length(v_digits) < 7 then
    return 0;
  end if;
  -- the last seven digits with up to two separators between them: a cheap filter on the compressed text before any record
  -- is parsed; app.text_holds_phone then decides
  v_pattern := array_to_string(regexp_split_to_array(v_digits, ''), '[ .()-]{0,2}');
  for v_document in
    select p.store_id, p.business_date, p.payload
    from public.sale_payloads p
    where p.tenant_id = p_tenant_id and p.payload ~ v_pattern
    order by p.store_id, p.business_date
    for update
  loop
    with entries as (
      select e.entry, e.ord, case when e.entry ~ v_pattern then e.entry::jsonb end as record
      from string_to_table(v_document.payload, E'\n') with ordinality as e (entry, ord)
    ),
    scrubbed as (
      select entries.*,
        case
          when record is null then null
          else app.scrub_sale_record(record, p_phone, app.sale_record_customer_holds_phone(record, p_phone))
        end as result
      from entries
    )
    select string_agg(case when result is null or result = record then entry else result::text end, E'\n' order by ord),
      count(*) filter (where result <> record)
    into v_payload, v_changed
    from scrubbed;
    if v_changed > 0 then
      update public.sale_payloads p
      set payload = v_payload, updated_at = now()
      where p.store_id = v_document.store_id and p.business_date = v_document.business_date;
      v_total := v_total + v_changed;
    end if;
  end loop;
  return v_total;
end;
$$;

comment on function app.scrub_phone_from_sale_payloads(uuid, text) is 'scrubs the phone from every payload document of the tenant: each string holding it becomes JSON null, and a record whose customer field held it loses its other customer fields too; returns the number of records changed; called by app.dsr_erase_customer only';

-- the invoice trigger also scrubs the payload record of the sale it blanks, so a later sync cannot write the phone back there
create or replace function app.blank_erased_invoice_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_phone is not null
    and exists (
      select 1 from app.erased_phones e
      where e.tenant_id = new.tenant_id
        and e.phone_hash = app.phone_hash(new.customer_phone)
        and (e.blank_before is null or new.sold_at < e.blank_before)
    )
  then
    perform app.scrub_sale_payload_records(
      new.store_id, new.business_date, array[new.external_id], app.loyalty_normalize_phone(new.customer_phone)
    );
    new.customer_phone := null;
    new.customer_name := null;
  end if;
  return new;
end;
$$;

comment on function app.blank_erased_invoice_phone() is 'trigger before an invoice is inserted or its customer_phone changes: blanks customer_phone and customer_name when the phone belongs to an erased customer of the tenant, for every invoice until the customer joins again and for the invoices sold before the new membership after that, and scrubs the same sale''s record in its sale_payloads document (written just before by the sync)';

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
  v_days jsonb;
  v_day jsonb;
  v_scrubbed integer := 0;
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
    'sale_records_scrubbed', 0, 'customer_logins', 0, 'auth_users', 0, 'customers', 0
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
  with blanked as (
    update public.invoices i
    set customer_phone = null, customer_name = null
    where i.tenant_id = v_request.tenant_id
      and (i.customer_id = v_request.subject_id or (v_phone is not null and app.loyalty_normalize_phone(i.customer_phone) = v_phone))
    returning i.store_id, i.business_date, i.external_id
  ),
  days as (
    select b.store_id, b.business_date, array_agg(b.external_id order by b.external_id) as external_ids
    from blanked b
    group by b.store_id, b.business_date
  )
  select (select count(*) from blanked),
    (select coalesce(jsonb_agg(to_jsonb(d) order by d.store_id, d.business_date), '[]'::jsonb) from days d)
  into v_rows, v_days;
  v_counts := v_counts || jsonb_build_object('invoices_blanked', v_rows);

  -- and so are the raw POS payloads of those sales, then the phone wherever else the tenant's payloads hold it (G-47)
  for v_day in select d.value from jsonb_array_elements(v_days) as d (value) loop
    v_scrubbed := v_scrubbed + app.scrub_sale_payload_records(
      (v_day ->> 'store_id')::uuid,
      (v_day ->> 'business_date')::date,
      array(select jsonb_array_elements_text(v_day -> 'external_ids')),
      v_phone
    );
  end loop;
  v_scrubbed := v_scrubbed + app.scrub_phone_from_sale_payloads(v_request.tenant_id, v_phone);
  v_counts := v_counts || jsonb_build_object('sale_records_scrubbed', v_scrubbed);

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

comment on function app.dsr_erase_customer(uuid, uuid, timestamptz) is 'the data-subject deletion of a customer (FR-CMP-04), in one transaction under the tenant''s loyalty lock, for a deletion request of subject customer naming the customer (22023 otherwise, and for a rejected request): quarantines the pool codes of the customer''s held rewards, settles the path D check of the invoices its confirmed rewards were redeemed on, erases every membership with app.erase_loyalty_membership, deletes the customer''s consent records (flag app.dsr_erasure), redacts the customer''s outbound messages, deletes the customer''s Mini App logins with their Auth users and the customers row, unlinks the customer''s invoices and blanks their customer_phone and customer_name (those linked to the customer and those carrying the customer''s phone), remembering the phone as a hash in app.erased_phones so later syncs cannot write it back, and scrubs the raw POS payloads: the customer fields of those sales and the phone wherever the tenant''s sale_payloads hold it (sale_records_scrubbed); then completes the request and logs the counts per table against both deadlines in data_subject_request_actions; a second call answers the logged action with already_done true and deletes nothing; database owner only';

create function app.scrub_erased_phones_from_sale_payloads(p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_document record;
  v_entry record;
  v_record jsonb;
  v_result jsonb;
  v_phone text;
  v_sold_at timestamptz;
  v_entries text[];
  v_changed integer;
  v_total integer := 0;
begin
  if not exists (select 1 from app.erased_phones e where e.tenant_id = p_tenant_id) then
    return 0;
  end if;
  for v_document in
    select p.store_id, p.business_date, p.payload
    from public.sale_payloads p
    where p.tenant_id = p_tenant_id
    order by p.store_id, p.business_date
    for update
  loop
    v_entries := '{}';
    v_changed := 0;
    for v_entry in
      select e.entry from string_to_table(v_document.payload, E'\n') with ordinality as e (entry, ord) order by e.ord
    loop
      v_record := v_entry.entry::jsonb;
      v_result := v_record;
      select i.sold_at into v_sold_at
      from public.invoices i
      where i.store_id = v_document.store_id and i.external_id = v_record ->> 'external_id';
      for v_phone in
        select distinct found.phone
        from jsonb_path_query(v_record, 'strict $.** ? (@.type() == "string")') as s (value)
        cross join lateral app.phones_in_text(s.value #>> '{}') as found (phone)
        where exists (
          select 1 from app.erased_phones e
          where e.tenant_id = p_tenant_id
            and e.phone_hash = app.phone_hash(found.phone)
            and (e.blank_before is null or v_sold_at is null or v_sold_at < e.blank_before)
        )
        order by found.phone
      loop
        v_result := app.scrub_sale_record(v_result, v_phone, app.sale_record_customer_holds_phone(v_result, v_phone));
      end loop;
      if v_result = v_record then
        v_entries := v_entries || v_entry.entry;
      else
        v_entries := v_entries || v_result::text;
        v_changed := v_changed + 1;
      end if;
    end loop;
    if v_changed > 0 then
      update public.sale_payloads p
      set payload = array_to_string(v_entries, E'\n'), updated_at = now()
      where p.store_id = v_document.store_id and p.business_date = v_document.business_date;
      v_total := v_total + v_changed;
    end if;
  end loop;
  return v_total;
end;
$$;

comment on function app.scrub_erased_phones_from_sale_payloads(uuid) is 'scrubs from every payload document of the tenant the phones remembered in app.erased_phones (known only as hashes, so every phone written in a record is hashed and compared, with the blank_before rule on the sale''s invoice): each string holding one becomes JSON null, and a record whose customer field held it loses its other customer fields too; returns the number of records changed; run once by migration erasure_scrubs_sale_payloads for the customers erased before it, database owner only';

-- the payloads of the customers erased before this migration
select app.scrub_erased_phones_from_sale_payloads(t.tenant_id)
from (select distinct e.tenant_id from app.erased_phones e order by e.tenant_id) as t;

revoke all on function app.phones_in_text(text) from public, anon, authenticated, service_role;
revoke all on function app.text_holds_phone(text, text) from public, anon, authenticated, service_role;
revoke all on function app.scrub_payload_value(jsonb, text, boolean) from public, anon, authenticated, service_role;
revoke all on function app.sale_record_customer_holds_phone(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function app.scrub_sale_record(jsonb, text, boolean) from public, anon, authenticated, service_role;
revoke all on function app.scrub_sale_payload_records(uuid, date, text[], text) from public, anon, authenticated, service_role;
revoke all on function app.scrub_phone_from_sale_payloads(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.scrub_erased_phones_from_sale_payloads(uuid) from public, anon, authenticated, service_role;
