-- The requests inbox gains what M01 drew and counter-app.md section 6 decision 6 left out: "Đề xuất giờ khác" (an
-- owner or manager proposes another time with a message; the request leaves the overdue clock, the customer sees the
-- time proposed, and the manager confirms it when the customer agrees, the booking then moving to that time) and read
-- tracking (the first owner or manager who opened a request and when, and the unread count of the inbox; M01-S6:
-- opening a request is recorded).

alter table public.store_requests drop constraint store_requests_status_check;
alter table public.store_requests add constraint store_requests_status_check check (status in ('new', 'proposed', 'confirmed', 'declined', 'cancelled'));
alter table public.store_requests
  add column proposed_for timestamptz,
  add column read_at timestamptz,
  add column read_by uuid references auth.users (id) on delete set null,
  add constraint store_requests_proposed_check check (status <> 'proposed' or (proposed_for is not null and answered_at is not null and answer_message is not null)),
  add constraint store_requests_read_check check (read_by is null or read_at is not null);

comment on column public.store_requests.proposed_for is 'the other time an owner or manager proposed ("Đề xuất giờ khác"); kept as history once the request is confirmed (requested_for then takes it)';
comment on column public.store_requests.read_at is 'when an owner or manager of the store first opened the request (manager_request_read)';
comment on column public.store_requests.read_by is 'who first opened it';

create or replace function app.request_json(p_request public.store_requests, p_for text, p_at timestamptz)
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
    'proposed_for', p_request.proposed_for,
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
    'read_at', p_request.read_at,
    'read_by', p_request.read_by,
    'answer_due_at', p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30)),
    'overdue', p_request.status = 'new'
      and p_at > p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30))
  ) else jsonb_build_object('contact_name', p_request.contact_name) end;
$$;

comment on function app.request_json(public.store_requests, text, timestamptz) is 'a request as its customer sees it (no phone echoed back; the time proposed) or as a manager sees it (channel, contact, who answered, who first read it and when, when the answer is due and whether it is overdue)';

create or replace function app.manager_requests(p_store_id uuid, p_status text default null, p_limit integer default 50, p_at timestamptz default now())
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
  if p_status is not null and p_status not in ('new', 'proposed', 'confirmed', 'declined', 'cancelled') then
    raise exception 'a status is new, proposed, confirmed, declined or cancelled' using errcode = '22023';
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
    'unread', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new' and r.read_at is null),
    'overdue', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new'
      and p_at > r.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = v_store.id), 30)))
  );
end;
$$;

comment on function app.manager_requests(uuid, text, integer, timestamptz) is 'the inbox of a store (S10) for its owners and managers (42501 otherwise): new requests first, then the newest, with the contact, who first read each, when the answer is due and whether it is overdue; the counts of new, unread new and overdue requests';

create function app.manager_request_read(p_request_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.store_requests;
begin
  select r.* into v_row from public.store_requests r where r.id = p_request_id for update;
  if v_row.id is null or not app.has_store_scope(v_row.tenant_id, v_row.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the request''s store' using errcode = '42501';
  end if;
  if v_row.read_at is null then
    update public.store_requests r set read_at = p_at, read_by = (select auth.uid()) where r.id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('state', 'read', 'request', app.request_json(v_row, 'manager', p_at));
end;
$$;

comment on function app.manager_request_read(uuid, timestamptz) is 'an owner or manager of the store opens a request (42501 otherwise, the same for an unknown id): the first opening is recorded with who and when (M01: the unread mark goes, and reading a contact is on record); later openings change nothing; answers the request as the manager sees it';

drop function public.manager_answer_request(uuid, text, text, integer);
drop function app.manager_answer_request(uuid, text, text, integer, timestamptz);

create function app.manager_answer_request(p_request_id uuid, p_status text, p_message text, p_expected_version integer, p_at timestamptz default now(),
  p_proposed_for timestamptz default null)
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
  if p_status is null or p_status not in ('confirmed', 'declined', 'cancelled', 'proposed') then
    raise exception 'an answer is confirmed, declined, cancelled or proposed' using errcode = '22023';
  end if;
  if p_message is not null and not app.native_text_valid(p_message, 500) then
    raise exception 'a message is 1 to 500 characters on one line' using errcode = '22023';
  end if;
  if p_status in ('declined', 'cancelled', 'proposed') and p_message is null then
    raise exception 'declining, cancelling or proposing another time needs a message for the customer' using errcode = '22023';
  end if;
  if (p_status = 'proposed') <> (p_proposed_for is not null) then
    raise exception 'a proposal, and only a proposal, names the other time' using errcode = '22023';
  end if;
  if v_row.status = p_status and v_row.answer_message is not distinct from p_message and v_row.proposed_for is not distinct from coalesce(p_proposed_for, v_row.proposed_for) then
    return jsonb_build_object('state', 'answered', 'refusal', null, 'replayed', true, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if p_expected_version is distinct from v_row.version then
    return jsonb_build_object('state', 'conflict', 'refusal', 'conflict', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if not ((v_row.status = 'new' and p_status in ('confirmed', 'declined', 'cancelled', 'proposed'))
       or (v_row.status = 'proposed' and p_status in ('confirmed', 'declined', 'cancelled', 'proposed'))
       or (v_row.status = 'confirmed' and p_status = 'cancelled')) then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_allowed', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if p_status = 'proposed' and (
       p_proposed_for < p_at + interval '30 minutes' or p_proposed_for > p_at + interval '60 days'
       or p_proposed_for = v_row.requested_for) then
    return jsonb_build_object('state', 'refused', 'refusal', 'time_invalid', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  if p_status = 'proposed' and v_row.kind in ('booking', 'hold') and not app.request_time_open(v_row.store_id, p_proposed_for) then
    return jsonb_build_object('state', 'refused', 'refusal', 'time_outside_hours', 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
  end if;
  update public.store_requests r
  set status = p_status,
      version = r.version + 1,
      answered_by = v_uid,
      answered_at = p_at,
      answer_message = p_message,
      proposed_for = case when p_status = 'proposed' then p_proposed_for else r.proposed_for end,
      requested_for = case when p_status = 'confirmed' and r.status = 'proposed' then r.proposed_for else r.requested_for end,
      read_at = coalesce(r.read_at, p_at),
      read_by = case when r.read_at is null then v_uid else r.read_by end,
      cancelled_at = case when p_status = 'cancelled' then p_at end,
      cancelled_by_kind = case when p_status = 'cancelled' then 'staff' end
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'answered', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
end;
$$;

comment on function app.manager_answer_request(uuid, text, text, integer, timestamptz, timestamptz) is 'an owner or manager of the store answers a request (42501 otherwise, the same for an unknown id): a new request is confirmed, declined, cancelled or proposed another time; a proposed one is confirmed (the customer agreed: the request moves to the time proposed), declined, cancelled or proposed again; a confirmed one cancelled. Declining, cancelling and proposing need a message for the customer (1 to 500 characters), a proposal and only a proposal names its time (30 minutes to 60 days ahead, not the time asked: time_invalid; inside the opening hours for a booking or a hold: time_outside_hours); the version seen (conflict), not_allowed for any other move, the same answer again a replay; records who answered, when and the message (sent to the customer by hand until ZBS templates exist), and counts as a reading';

create or replace function app.customer_cancel_request(p_request_id uuid, p_at timestamptz default now())
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
  if v_row.status not in ('new', 'proposed', 'confirmed') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_allowed', 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  update public.store_requests r
  set status = 'cancelled', cancelled_at = p_at, cancelled_by_kind = 'customer', version = r.version + 1
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'cancelled', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
end;
$$;

comment on function app.customer_cancel_request(uuid, timestamptz) is 'the customer cancels their own new, proposed or confirmed request (declining a time proposed is cancelling it); another customer''s or an unknown id is unknown_request; a declined request is not_allowed; a second cancel is a replay';

create function public.manager_answer_request(p_request uuid, p_status text, p_message text, p_expected_version integer, p_proposed_for timestamptz default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_answer_request(p_request, p_status, p_message, p_expected_version, now(), p_proposed_for); $$;
comment on function public.manager_answer_request(uuid, text, text, integer, timestamptz) is 'RPC for the manager app (S10, M01): app.manager_answer_request at the current time, with the time proposed for a proposal';

create function public.manager_request_read(p_request uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_request_read(p_request, now()); $$;
comment on function public.manager_request_read(uuid) is 'RPC for the manager app (M01): app.manager_request_read at the current time';

revoke all on function app.manager_answer_request(uuid, text, text, integer, timestamptz, timestamptz), app.manager_request_read(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.manager_answer_request(uuid, text, text, integer, timestamptz), public.manager_request_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.manager_answer_request(uuid, text, text, integer, timestamptz), public.manager_request_read(uuid) to authenticated;
