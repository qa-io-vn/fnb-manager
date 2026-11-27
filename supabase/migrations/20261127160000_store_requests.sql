-- The native till, step 7 (native-till.md section 12): the requests inbox. Every request a customer sends a store, from
-- the website or the customer app, lands in one inbox the store's owners and managers answer: bookings now; workshops,
-- holds of an item and job applications as kinds a store switches on. The website submits through a service-role Edge
-- Function (anon gets nothing) and the app with the customer's session; both are idempotent per request id and limited
-- per submitter and per store. A request carries the contact the customer typed, so it is read only by the store's
-- owners and managers, deleted with the customer's account and purged 180 days after its date.

-- 1. Settings -------------------------------------------------------------------------------------------------------

alter table public.store_ordering_settings
  add column request_kinds text[] not null default array['booking']::text[]
    check (app.native_set_valid(request_kinds, array['booking', 'workshop', 'hold', 'application'], 1)),
  add column request_answer_minutes integer not null default 30 check (request_answer_minutes between 5 and 1440);

comment on column public.store_ordering_settings.request_kinds is 'the kinds of request the store takes: booking (the default), workshop, hold (an item kept for the customer) and application (a job application)';
comment on column public.store_ordering_settings.request_answer_minutes is 'how soon a new request should be answered (the promise of the website); a new request older than this is overdue in the inbox';

grant insert (request_kinds, request_answer_minutes), update (request_kinds, request_answer_minutes) on public.store_ordering_settings to authenticated;

-- 2. The inbox --------------------------------------------------------------------------------------------------------

create table public.store_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  kind text not null check (kind in ('booking', 'workshop', 'hold', 'application')),
  channel text not null check (channel in ('website', 'app')),
  customer_login_id uuid references app.customer_logins (id) on delete cascade,
  client_request_id uuid not null,
  client_key_sha256 text check (client_key_sha256 is null or client_key_sha256 ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  contact_name text not null check (app.native_text_valid(contact_name, 60)),
  contact_phone text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  party_size integer check (party_size between 1 and 30),
  requested_for timestamptz,
  subject text check (subject is null or app.native_text_valid(subject, 100)),
  note text check (note is null or app.native_text_valid(note, 500)),
  status text not null default 'new' check (status in ('new', 'confirmed', 'declined', 'cancelled')),
  version integer not null default 1 check (version >= 1),
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  answer_message text check (answer_message is null or app.native_text_valid(answer_message, 500)),
  cancelled_by_kind text check (cancelled_by_kind in ('customer', 'staff')),
  cancelled_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (channel, client_request_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check ((channel = 'website') = (client_key_sha256 is not null)),
  check (kind <> 'booking' or (party_size is not null and requested_for is not null)),
  check (kind = 'booking' or party_size is null),
  check (kind not in ('workshop', 'hold') or requested_for is not null),
  check (kind = 'booking' or subject is not null),
  check ((status in ('confirmed', 'declined')) <= (answered_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancelled_by_kind is not null))
);

create index store_requests_store_idx on public.store_requests (store_id, status, created_at desc);
create index store_requests_login_idx on public.store_requests (customer_login_id) where customer_login_id is not null;
create index store_requests_client_key_idx on public.store_requests (client_key_sha256, status) where client_key_sha256 is not null;
create index store_requests_tenant_idx on public.store_requests (tenant_id);

comment on table public.store_requests is 'the requests inbox (native-till.md section 12): bookings, workshop sign-ups, holds of an item and job applications sent from the website (by a service-role Edge Function, with the SHA-256 of its client key) or the customer app (with the customer''s login), each once per request id; the contact typed, the time asked for, then the answer of an owner or manager (confirmed, declined, cancelled with who, when and the message) or the customer''s cancellation; read only by the store''s owners and managers; deleted with the customer''s account, purged 180 days after its date';

create trigger store_requests_set_updated_at before update on public.store_requests for each row execute function app.set_updated_at();

alter table public.store_requests enable row level security;

create policy store_requests_select on public.store_requests
  for select to authenticated using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.store_requests from anon, authenticated;
grant select on public.store_requests to authenticated;

-- 3. Limits ---------------------------------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('request_app', 'calls', 5, 100, interval '1 day', interval '1 hour'),
  ('request_website', 'calls', 3, 100, interval '1 hour', interval '1 hour');

-- 4. Submitting -----------------------------------------------------------------------------------------------------

create function app.request_refused(p_refusal text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('state', 'refused', 'refusal', p_refusal, 'replayed', false, 'request', null) || coalesce(p_extra, '{}'::jsonb);
$$;

comment on function app.request_refused(text, jsonb) is 'the answer of a refused request submission';

create function app.request_json(p_request public.store_requests, p_for text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_request.id,
    'kind', p_request.kind,
    'store', (select app.customer_store_code(s.code, s.external_id) from public.stores s where s.id = p_request.store_id),
    'status', p_request.status,
    'party_size', p_request.party_size,
    'requested_for', p_request.requested_for,
    'subject', p_request.subject,
    'note', p_request.note,
    'created_at', p_request.created_at,
    'answered_at', p_request.answered_at,
    'answer_message', p_request.answer_message,
    'cancelled_at', p_request.cancelled_at,
    'cancelled_by', p_request.cancelled_by_kind,
    'version', p_request.version
  ) || case when p_for = 'manager' then jsonb_build_object(
    'channel', p_request.channel,
    'contact_name', p_request.contact_name,
    'contact_phone', p_request.contact_phone,
    'answered_by', p_request.answered_by,
    'answer_due_at', p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30)),
    'overdue', p_request.status = 'new'
      and p_at > p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30))
  ) else jsonb_build_object('contact_name', p_request.contact_name) end;
$$;

comment on function app.request_json(public.store_requests, text, timestamptz) is 'a request as its customer sees it (no phone echoed back) or as a manager sees it (channel, contact, who answered, when the answer is due and whether it is overdue)';

create function app.request_submit(p_channel text, p_tenant_id uuid, p_store_id uuid, p_login app.customer_logins, p_client_key text, p_request jsonb, p_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_hash text;
  v_key_hash text := case when p_client_key is not null then encode(extensions.digest(convert_to(p_client_key, 'UTF8'), 'sha256'), 'hex') end;
  v_caller uuid;
  v_existing public.store_requests;
  v_kind text := p_request ->> 'kind';
  v_kinds text[];
  v_locked timestamptz;
  v_phone text;
  v_name text := p_request ->> 'name';
  v_subject text := nullif(p_request ->> 'subject', '');
  v_note text := nullif(p_request ->> 'note', '');
  v_party integer;
  v_for timestamptz;
  v_row public.store_requests;
  v_endpoint text := case p_channel when 'website' then 'request_website' else 'request_app' end;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_request) as k where k not in ('request_id', 'store', 'kind', 'name', 'phone', 'party_size', 'at', 'subject', 'note'))
     or jsonb_typeof(p_request -> 'request_id') is distinct from 'string'
     or (p_request ->> 'request_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_request -> 'kind') is distinct from 'string'
     or jsonb_typeof(p_request -> 'name') is distinct from 'string'
     or jsonb_typeof(p_request -> 'phone') is distinct from 'string'
     or char_length(p_request ->> 'phone') > 30
     or (p_request ? 'party_size' and jsonb_typeof(p_request -> 'party_size') not in ('number', 'null'))
     or (p_request ? 'at' and jsonb_typeof(p_request -> 'at') not in ('string', 'null'))
     or (p_request ? 'subject' and jsonb_typeof(p_request -> 'subject') not in ('string', 'null'))
     or (p_request ? 'note' and jsonb_typeof(p_request -> 'note') not in ('string', 'null')) then
    raise exception 'a request is {request_id, store, kind, name, phone, party_size, at, subject, note}' using errcode = '22023';
  end if;
  v_request_id := (p_request ->> 'request_id')::uuid;
  v_hash := app.sha256_hex(p_request::text);
  v_caller := case when p_channel = 'website' then md5(v_key_hash)::uuid else p_login.user_id end;

  perform pg_advisory_xact_lock(hashtextextended('fnb-store-request:' || p_channel || ':' || v_request_id::text, 0));
  select r.* into v_existing from public.store_requests r where r.channel = p_channel and r.client_request_id = v_request_id;
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash
       or v_existing.client_key_sha256 is distinct from v_key_hash
       or v_existing.customer_login_id is distinct from p_login.id then
      return app.request_refused('request_conflict');
    end if;
    return jsonb_build_object('state', 'submitted', 'refusal', null, 'replayed', true, 'request', app.request_json(v_existing, 'customer', p_at));
  end if;

  if p_store_id is null then
    return app.request_refused('store_unknown');
  end if;
  select coalesce(o.request_kinds, array['booking']::text[]) into v_kinds
  from (select 1) as one left join public.store_ordering_settings o on o.store_id = p_store_id;
  if v_kind is null or not (v_kind = any (v_kinds)) then
    return app.request_refused('kind_not_offered');
  end if;

  v_locked := app.code_attempt_gate(v_endpoint, p_tenant_id, p_store_id, v_caller, p_at);
  if v_locked is not null then
    return app.request_refused('rate_limited', jsonb_build_object('retry_at', v_locked));
  end if;
  perform app.code_attempt_record(v_endpoint, p_tenant_id, p_store_id, v_caller, p_at);
  if (select count(*) from public.store_requests r
      where r.status = 'new'
        and ((p_channel = 'website' and r.client_key_sha256 = v_key_hash) or (p_channel = 'app' and r.customer_login_id = p_login.id))) >= 3 then
    return app.request_refused('too_many_open_requests');
  end if;

  if not app.native_text_valid(v_name, 60) then
    return app.request_refused('name_invalid');
  end if;
  v_phone := app.loyalty_normalize_phone(p_request ->> 'phone');
  if v_phone is null then
    return app.request_refused('phone_invalid');
  end if;
  if v_kind = 'booking' then
    if jsonb_typeof(p_request -> 'party_size') is distinct from 'number'
       or (p_request ->> 'party_size')::numeric <> trunc((p_request ->> 'party_size')::numeric)
       or (p_request ->> 'party_size')::numeric not between 1 and 30 then
      return app.request_refused('party_size_invalid');
    end if;
    v_party := (p_request ->> 'party_size')::integer;
  elsif jsonb_typeof(p_request -> 'party_size') = 'number' then
    return app.request_refused('party_size_invalid');
  end if;
  if v_kind in ('booking', 'workshop', 'hold') or jsonb_typeof(p_request -> 'at') = 'string' then
    begin
      v_for := (p_request ->> 'at')::timestamptz;
    exception when others then
      v_for := null;
    end;
    if v_for is null or (p_request ->> 'at') !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
       or v_for < p_at + interval '30 minutes' or v_for > p_at + interval '60 days' then
      return app.request_refused('time_invalid');
    end if;
  end if;
  if v_kind <> 'booking' and not app.native_text_valid(v_subject, 100) then
    return app.request_refused('subject_invalid');
  end if;
  if v_kind = 'booking' and v_subject is not null and not app.native_text_valid(v_subject, 100) then
    return app.request_refused('subject_invalid');
  end if;
  if v_note is not null and not app.native_text_valid(v_note, 500) then
    return app.request_refused('note_invalid');
  end if;

  insert into public.store_requests (tenant_id, store_id, kind, channel, customer_login_id, client_request_id, client_key_sha256, request_hash,
    contact_name, contact_phone, party_size, requested_for, subject, note, created_at)
  values (p_tenant_id, p_store_id, v_kind, p_channel, p_login.id, v_request_id, v_key_hash, v_hash,
    v_name, v_phone, v_party, v_for, v_subject, v_note, p_at)
  returning * into v_row;
  return jsonb_build_object('state', 'submitted', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
end;
$$;

comment on function app.request_submit(text, uuid, uuid, app.customer_logins, text, jsonb, timestamptz) is 'the one writer of new requests (website or app): the shape (22023), the replay (the same request id from the same submitter answers the first request, replayed true; anything else under it request_conflict; parallel calls serialised), store_unknown, kind_not_offered, rate_limited (request_app: 5 a day per customer; request_website: 3 an hour per client key; 100 per store in each window), too_many_open_requests (3 new ones per submitter), name_invalid, phone_invalid (read as E.164), party_size_invalid (a booking for 1 to 30), time_invalid (an instant with its offset, 30 minutes to 60 days ahead; required for a booking, a workshop and a hold), subject_invalid (the workshop, item or position, required but for a booking), note_invalid; then the new request';

create function app.customer_submit_request(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_store uuid;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request -> 'store') is distinct from 'string' then
    raise exception 'a request names its store' using errcode = '22023';
  end if;
  v_store := app.customer_app_store(v_login.zalo_app_id, p_request ->> 'store');
  return app.request_submit('app', v_login.tenant_id, v_store, v_login, null, p_request, p_at);
end;
$$;

comment on function app.customer_submit_request(jsonb, timestamptz) is 'a request from the customer app (C08): the customer''s session and a store of the app''s brand (store_unknown otherwise), then app.request_submit; 42501 without a customer session';

create function app.web_submit_request(p_brand_id uuid, p_client_key text, p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_brand public.brands;
  v_store uuid;
begin
  if p_client_key is null or char_length(p_client_key) not between 16 and 200 or p_client_key ~ '[[:cntrl:][:space:]]' then
    raise exception 'a client key is 16 to 200 printable characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request -> 'store') is distinct from 'string' then
    raise exception 'a request names its store' using errcode = '22023';
  end if;
  select b.* into v_brand from public.brands b where b.id = p_brand_id;
  if v_brand.id is null then
    raise exception 'unknown brand' using errcode = '22023';
  end if;
  select case when count(*) = 1 then (array_agg(s.id))[1] end into v_store
  from public.stores s
  where s.tenant_id = v_brand.tenant_id and s.id = any (v_brand.store_ids) and s.active
    and app.customer_store_code(s.code, s.external_id) = p_request ->> 'store';
  return app.request_submit('website', v_brand.tenant_id, v_store, null, p_client_key, p_request, p_at);
end;
$$;

comment on function app.web_submit_request(uuid, text, jsonb, timestamptz) is 'a request from the website form, for the service role only: the Edge Function names the brand of the site and an opaque client key it derived (16 to 200 characters; only its SHA-256 is kept, for the limits and the replay), then app.request_submit with a store of the brand';

-- 5. The customer's requests ------------------------------------------------------------------------------------

create function app.customer_requests(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
begin
  return jsonb_build_object('requests', coalesce((
    select jsonb_agg(app.request_json(r, 'customer', p_at) order by r.created_at desc, r.id)
    from (select r.* from public.store_requests r where r.customer_login_id = v_login.id order by r.created_at desc, r.id limit 50) r
  ), '[]'::jsonb));
end;
$$;

comment on function app.customer_requests(timestamptz) is 'the customer''s own requests from the app, newest first (at most 50), with their status and answer; 42501 without a customer session';

create function app.customer_cancel_request(p_request_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_row public.store_requests;
begin
  select r.* into v_row from public.store_requests r where r.id = p_request_id and r.customer_login_id = v_login.id for update;
  if v_row.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_request', 'request', null);
  end if;
  if v_row.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'refusal', null, 'replayed', true, 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  if v_row.status not in ('new', 'confirmed') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_allowed', 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  update public.store_requests r
  set status = 'cancelled', cancelled_at = p_at, cancelled_by_kind = 'customer', version = r.version + 1
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'cancelled', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
end;
$$;

comment on function app.customer_cancel_request(uuid, timestamptz) is 'the customer cancels their own new or confirmed request; another customer''s or an unknown id is unknown_request; a declined request is not_allowed; a second cancel is a replay';

-- 6. The managers' inbox ----------------------------------------------------------------------------------------

create function app.manager_requests(p_store_id uuid, p_status text default null, p_limit integer default 50, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('new', 'confirmed', 'declined', 'cancelled') then
    raise exception 'a status is new, confirmed, declined or cancelled' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'a limit is 1 to 200' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(app.request_json(r, 'manager', p_at) order by (r.status = 'new') desc, r.created_at desc, r.id)
      from (
        select r.* from public.store_requests r
        where r.store_id = v_store.id and (p_status is null or r.status = p_status)
        order by (r.status = 'new') desc, r.created_at desc, r.id
        limit p_limit
      ) r
    ), '[]'::jsonb),
    'new', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new'),
    'overdue', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new'
      and p_at > r.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = v_store.id), 30)))
  );
end;
$$;

comment on function app.manager_requests(uuid, text, integer, timestamptz) is 'the inbox of a store (S10) for its owners and managers (42501 otherwise): new requests first, then the newest, with the contact, when the answer is due and whether it is overdue; the counts of new and overdue requests';

create function app.manager_answer_request(p_request_id uuid, p_status text, p_message text, p_expected_version integer, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.store_requests;
  v_uid uuid := (select auth.uid());
begin
  select r.* into v_row from public.store_requests r where r.id = p_request_id for update;
  if v_row.id is null or not app.has_store_scope(v_row.tenant_id, v_row.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the request''s store' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('confirmed', 'declined', 'cancelled') then
    raise exception 'an answer is confirmed, declined or cancelled' using errcode = '22023';
  end if;
  if p_message is not null and not app.native_text_valid(p_message, 500) then
    raise exception 'a message is 1 to 500 characters on one line' using errcode = '22023';
  end if;
  if p_status in ('declined', 'cancelled') and p_message is null then
    raise exception 'declining or cancelling a request needs a message for the customer' using errcode = '22023';
  end if;
  if v_row.status = p_status and v_row.answer_message is not distinct from p_message then
    return jsonb_build_object('state', 'answered', 'refusal', null, 'replayed', true, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if p_expected_version is distinct from v_row.version then
    return jsonb_build_object('state', 'conflict', 'refusal', 'conflict', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if not ((v_row.status = 'new' and p_status in ('confirmed', 'declined', 'cancelled')) or (v_row.status = 'confirmed' and p_status = 'cancelled')) then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_allowed', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  update public.store_requests r
  set status = p_status,
      version = r.version + 1,
      answered_by = v_uid,
      answered_at = p_at,
      answer_message = p_message,
      cancelled_at = case when p_status = 'cancelled' then p_at end,
      cancelled_by_kind = case when p_status = 'cancelled' then 'staff' end
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'answered', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
end;
$$;

comment on function app.manager_answer_request(uuid, text, text, integer, timestamptz) is 'an owner or manager of the store answers a request (42501 otherwise, the same for an unknown id): a new request is confirmed, declined or cancelled, a confirmed one cancelled; declining and cancelling need a message for the customer (1 to 500 characters); the version seen (conflict), not_allowed for any other move, the same answer again a replay; records who answered, when and the message (the message goes to the customer by hand until ZBS templates exist)';

-- 7. Retention in the minute job ----------------------------------------------------------------------------------

create or replace function app.ordering_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_cancelled integer := 0;
  v_pruned integer;
  v_refreshed integer;
  v_purged integer;
begin
  for v_order in
    select o.* from public.orders o
    where o.status = 'awaiting_payment' and o.payment_due_at <= p_at
    order by o.payment_due_at
    limit 500
    for update skip locked
  loop
    perform app.order_move(v_order, 'cancelled', 'payment_timeout', 'system', null, 'payment_timeout', null, p_at);
    v_cancelled := v_cancelled + 1;
  end loop;
  delete from app.ordering_presence p where p.seen_at < p_at - interval '1 day';
  get diagnostics v_pruned = row_count;
  delete from public.store_requests r where greatest(r.created_at, coalesce(r.requested_for, r.created_at)) < p_at - interval '180 days';
  get diagnostics v_purged = row_count;
  v_refreshed := app.native_analytics_refresh(p_at, 2);
  return jsonb_build_object('payment_timeouts', v_cancelled, 'presence_pruned', v_pruned, 'requests_purged', v_purged, 'analytics_dates_refreshed', v_refreshed);
end;
$$;

comment on function app.ordering_tick(timestamptz) is 'the minute job of the native till: cancels the orders whose online payment window passed (payment_timeout, nothing charged, no number taken), prunes counter presence older than a day, deletes requests 180 days after their date (or their creation) and refreshes the aggregates of up to two dates whose native invoices changed once they left the live window; touches only due rows; answers counts';

-- 8. Public wrappers and grants ---------------------------------------------------------------------------------

create function public.customer_submit_request(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_submit_request(p_request, now()); $$;
comment on function public.customer_submit_request(jsonb) is 'RPC for the customer Mini App (C08): app.customer_submit_request at the current time';

create function public.customer_requests()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_requests(now()); $$;
comment on function public.customer_requests() is 'RPC for the customer Mini App: app.customer_requests at the current time';

create function public.customer_cancel_request(p_request uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_cancel_request(p_request, now()); $$;
comment on function public.customer_cancel_request(uuid) is 'RPC for the customer Mini App: app.customer_cancel_request at the current time';

create function public.web_submit_request(p_brand uuid, p_client_key text, p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.web_submit_request(p_brand, p_client_key, p_request, now()); $$;
comment on function public.web_submit_request(uuid, text, jsonb) is 'RPC for the website''s Edge Function (service role only): app.web_submit_request at the current time';

create function public.manager_requests(p_store uuid, p_status text default null, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_requests(p_store, p_status, p_limit, now()); $$;
comment on function public.manager_requests(uuid, text, integer) is 'RPC for the manager app (S10): app.manager_requests at the current time';

create function public.manager_answer_request(p_request uuid, p_status text, p_message text, p_expected_version integer)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_answer_request(p_request, p_status, p_message, p_expected_version, now()); $$;
comment on function public.manager_answer_request(uuid, text, text, integer) is 'RPC for the manager app (S10): app.manager_answer_request at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('request_refused', 'request_json', 'request_submit', 'customer_submit_request', 'web_submit_request', 'customer_requests',
        'customer_cancel_request', 'manager_requests', 'manager_answer_request', 'ordering_tick')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_submit_request(jsonb), public.customer_requests(), public.customer_cancel_request(uuid),
  public.manager_requests(uuid, text, integer), public.manager_answer_request(uuid, text, text, integer),
  public.web_submit_request(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.customer_submit_request(jsonb), public.customer_requests(), public.customer_cancel_request(uuid),
  public.manager_requests(uuid, text, integer), public.manager_answer_request(uuid, text, text, integer) to authenticated;
grant execute on function public.web_submit_request(uuid, text, jsonb) to service_role;
