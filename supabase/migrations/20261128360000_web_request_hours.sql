-- The website's forms reach the requests inbox through the public Edge Function web-requests (native-till.md section
-- 12), which calls web_submit_request with the service role after its own checks (origins, fields, honeypot, fill time,
-- body size; an opaque client key). The database now also refuses a booking or a hold outside the store's opening
-- hours or on a day an ordering closure covers (time_outside_hours), for the website and the app alike; a workshop
-- may be held outside them, and a store whose hours are not set is not checked.

create function app.request_time_open(p_store_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not coalesce(app.opening_hours_known((select s.opening_hours from public.stores s where s.id = p_store_id)), false) then true
    else exists (select 1 from app.ordering_span_at(p_store_id, p_at))
      and not exists (
        select 1 from public.ordering_closures c
        where c.store_id = p_store_id and app.store_business_date(p_store_id, p_at) between c.starts_on and c.ends_on
      )
  end;
$$;

comment on function app.request_time_open(uuid, timestamptz) is 'whether a store is open at an instant for a request: inside one of its opening spans and on no closed day; true for a store whose opening hours are not set';

create or replace function app.request_submit(p_channel text, p_tenant_id uuid, p_store_id uuid, p_login app.customer_logins, p_client_key text, p_request jsonb, p_at timestamptz)
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
  if v_kind in ('booking', 'hold') and not app.request_time_open(p_store_id, v_for) then
    return app.request_refused('time_outside_hours');
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

comment on function app.request_submit(text, uuid, uuid, app.customer_logins, text, jsonb, timestamptz) is 'the one writer of new requests (website or app): the shape (22023), the replay (the same request id from the same submitter answers the first request, replayed true; anything else under it request_conflict; parallel calls serialised), store_unknown, kind_not_offered, rate_limited (request_app: 5 a day per customer; request_website: 3 an hour per client key; 100 per store in each window), too_many_open_requests (3 new ones per submitter), name_invalid, phone_invalid (read as E.164), party_size_invalid (a booking for 1 to 30), time_invalid (an instant with its offset, 30 minutes to 60 days ahead; required for a booking, a workshop and a hold), time_outside_hours (a booking or a hold outside the store''s opening hours or on a day it is closed), subject_invalid (the workshop, item or position, required but for a booking), note_invalid; then the new request';

revoke all on function app.request_time_open(uuid, timestamptz) from public, anon, authenticated, service_role;
