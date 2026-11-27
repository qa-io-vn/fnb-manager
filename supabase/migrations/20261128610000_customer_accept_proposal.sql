-- The customer accepts the time a manager proposed (M01 "Đề xuất giờ khác", C08): until now only a manager could move a
-- proposed request to confirmed, on the customer's word by phone or message. customer_accept_proposal lets the customer
-- of an app request accept the time proposed while it is still ahead, with the same end state as the manager's confirm
-- (confirmed, the booking moved to the time proposed, the proposal kept as history, the version moved on); the
-- manager's answer (who, when, the message) stays as the proposal left it, and the acceptance is recorded with its
-- moment and the customer's request id, which makes it idempotent. The manager inbox flags it: an accepted request
-- nobody opened since is accepted_unseen (counted, and listed after the new requests) until an owner or manager opens
-- it or answers it, which is recorded with who and when. The first reading of the request (read_at, read_by) is kept:
-- marking it unread again would lose who first saw the contact (M01-S6), so a flag of its own was chosen.

alter table public.store_requests
  add column customer_accepted_at timestamptz,
  add column accept_request_id uuid,
  add column accept_seen_at timestamptz,
  add column accept_seen_by uuid references auth.users (id) on delete set null,
  add constraint store_requests_accept_check check (
    (customer_accepted_at is null) = (accept_request_id is null)
    and (customer_accepted_at is null or (customer_login_id is not null and proposed_for is not null))
    and (accept_seen_at is null or customer_accepted_at is not null)
    and (accept_seen_by is null or accept_seen_at is not null)
  );

create unique index store_requests_accept_key on public.store_requests (customer_login_id, accept_request_id) where accept_request_id is not null;
create index store_requests_accept_seen_by_idx on public.store_requests (accept_seen_by);

comment on column public.store_requests.customer_accepted_at is 'when the customer accepted the time proposed (customer_accept_proposal); null when a manager confirmed it or nothing was accepted';
comment on column public.store_requests.accept_request_id is 'the request id the customer''s app sent with the acceptance: the same id again answers the same acceptance, another request with it is request_conflict';
comment on column public.store_requests.accept_seen_at is 'when an owner or manager first opened or answered the request after the customer accepted; null while the inbox flags it (accepted_unseen)';
comment on column public.store_requests.accept_seen_by is 'who first opened or answered it after the acceptance';

-- 1. The request as each side sees it ---------------------------------------------------------------------------------

create function app.request_accepted_unseen(p_request public.store_requests)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_request.status = 'confirmed' and p_request.customer_accepted_at is not null and p_request.accept_seen_at is null;
$$;

comment on function app.request_accepted_unseen(public.store_requests) is 'whether the inbox flags a request: the customer accepted the time proposed and no owner or manager opened or answered it since';

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
    'customer_accepted_at', p_request.customer_accepted_at,
    'version', p_request.version
  ) || case when p_for = 'manager' then jsonb_build_object(
    'channel', p_request.channel,
    'contact_name', p_request.contact_name,
    'contact_phone', p_request.contact_phone,
    'answered_by', p_request.answered_by,
    'read_at', p_request.read_at,
    'read_by', p_request.read_by,
    'accepted_unseen', app.request_accepted_unseen(p_request),
    'accept_seen_at', p_request.accept_seen_at,
    'accept_seen_by', p_request.accept_seen_by,
    'answer_due_at', p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30)),
    'overdue', p_request.status = 'new'
      and p_at > p_request.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = p_request.store_id), 30))
  ) else jsonb_build_object('contact_name', p_request.contact_name) end;
$$;

comment on function app.request_json(public.store_requests, text, timestamptz) is 'a request as its customer sees it (no phone echoed back; the time proposed; when they accepted it) or as a manager sees it (channel, contact, who answered, who first read it and when, whether the customer''s acceptance waits to be seen and who saw it, when the answer is due and whether it is overdue)';

-- 2. The customer accepts -----------------------------------------------------------------------------------------------

create function app.customer_accept_proposal(p_request_id uuid, p_accept_id uuid, p_at timestamptz default now())
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
  if p_request_id is null or p_accept_id is null then
    raise exception 'an acceptance names the request and its own request id' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-request-accept:' || v_login.id::text, 0));
  select r.* into v_row from public.store_requests r where r.customer_login_id = v_login.id and r.accept_request_id = p_accept_id;
  if v_row.id is not null and v_row.id <> p_request_id then
    return jsonb_build_object('state', 'refused', 'refusal', 'request_conflict', 'replayed', false, 'request', null);
  end if;
  select r.* into v_row from public.store_requests r where r.id = p_request_id and r.customer_login_id = v_login.id for update;
  if v_row.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_request', 'replayed', false, 'request', null);
  end if;
  if v_row.accept_request_id = p_accept_id then
    return jsonb_build_object('state', 'accepted', 'refusal', null, 'replayed', true, 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  if v_row.status <> 'proposed' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_allowed', 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  if v_row.proposed_for <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'proposal_expired', 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
  end if;
  update public.store_requests r
  set status = 'confirmed',
      requested_for = r.proposed_for,
      version = r.version + 1,
      customer_accepted_at = p_at,
      accept_request_id = p_accept_id,
      accept_seen_at = null,
      accept_seen_by = null
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'accepted', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'customer', p_at));
end;
$$;

comment on function app.customer_accept_proposal(uuid, uuid, timestamptz) is 'the customer accepts the time an owner or manager proposed for their own request (C08, M01): only while the request is proposed (not_allowed otherwise, also after an earlier acceptance) and the time proposed is still ahead (proposal_expired at or after it); the request is confirmed and moves to the time proposed, as the manager''s confirm does, with the moment of the acceptance and the app''s request id recorded, and the manager inbox flags it until an owner or manager opens it; the same request id again answers the acceptance (replayed), the same id with another request is request_conflict; another customer''s request or an unknown id is unknown_request; 22023 without both ids; 42501 without a customer session';

-- 3. The inbox flags the acceptance until an owner or manager opens or answers it --------------------------------------

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
      select jsonb_agg(app.request_json(r, 'manager', p_at) order by (r.status = 'new') desc, app.request_accepted_unseen(r) desc, r.created_at desc, r.id)
      from (
        select r.* from public.store_requests r
        where r.store_id = v_store.id and (p_status is null or r.status = p_status)
        order by (r.status = 'new') desc, app.request_accepted_unseen(r) desc, r.created_at desc, r.id
        limit p_limit
      ) r
    ), '[]'::jsonb),
    'new', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new'),
    'unread', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new' and r.read_at is null),
    'accepted_unseen', (select count(*) from public.store_requests r where r.store_id = v_store.id and app.request_accepted_unseen(r)),
    'overdue', (select count(*) from public.store_requests r where r.store_id = v_store.id and r.status = 'new'
      and p_at > r.created_at + make_interval(mins => coalesce((select o.request_answer_minutes from public.store_ordering_settings o where o.store_id = v_store.id), 30)))
  );
end;
$$;

comment on function app.manager_requests(uuid, text, integer, timestamptz) is 'the inbox of a store (S10, M01) for its owners and managers (42501 otherwise): new requests first, then the ones the customer accepted that nobody opened since, then the newest, with the contact, who first read each, when the answer is due and whether it is overdue; the counts of new, unread new, accepted unseen and overdue requests';

create or replace function app.manager_request_read(p_request_id uuid, p_at timestamptz default now())
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
  if v_row.read_at is null or (v_row.customer_accepted_at is not null and v_row.accept_seen_at is null) then
    update public.store_requests r
    set read_at = coalesce(r.read_at, p_at),
        read_by = case when r.read_at is null then v_uid else r.read_by end,
        accept_seen_at = case when r.customer_accepted_at is not null then coalesce(r.accept_seen_at, p_at) end,
        accept_seen_by = case when r.customer_accepted_at is not null and r.accept_seen_at is null then v_uid else r.accept_seen_by end
    where r.id = v_row.id
    returning * into v_row;
  end if;
  return jsonb_build_object('state', 'read', 'request', app.request_json(v_row, 'manager', p_at));
end;
$$;

comment on function app.manager_request_read(uuid, timestamptz) is 'an owner or manager of the store opens a request (42501 otherwise, the same for an unknown id): the first opening is recorded with who and when (M01: the unread mark goes, and reading a contact is on record), and the first opening after the customer accepted a proposal clears the inbox''s flag with who and when; later openings change nothing; answers the request as the manager sees it';

create or replace function app.manager_answer_request(p_request_id uuid, p_status text, p_message text, p_expected_version integer, p_at timestamptz default now(),
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
      accept_seen_at = case when r.customer_accepted_at is not null then coalesce(r.accept_seen_at, p_at) end,
      accept_seen_by = case when r.customer_accepted_at is not null and r.accept_seen_at is null then v_uid else r.accept_seen_by end,
      cancelled_at = case when p_status = 'cancelled' then p_at end,
      cancelled_by_kind = case when p_status = 'cancelled' then 'staff' end
  where r.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'answered', 'refusal', null, 'replayed', false, 'request', app.request_json(v_row, 'manager', p_at));
end;
$$;

comment on function app.manager_answer_request(uuid, text, text, integer, timestamptz, timestamptz) is 'an owner or manager of the store answers a request (42501 otherwise, the same for an unknown id): a new request is confirmed, declined, cancelled or proposed another time; a proposed one is confirmed (the customer agreed: the request moves to the time proposed), declined, cancelled or proposed again; a confirmed one cancelled. Declining, cancelling and proposing need a message for the customer (1 to 500 characters), a proposal and only a proposal names its time (30 minutes to 60 days ahead, not the time asked: time_invalid; inside the opening hours for a booking or a hold: time_outside_hours); the version seen (conflict), not_allowed for any other move, the same answer again a replay; records who answered, when and the message (sent to the customer by hand until ZBS templates exist), and counts as a reading, also of a customer''s acceptance';

-- 4. Public wrapper and grants ------------------------------------------------------------------------------------------

create function public.customer_accept_proposal(p_request uuid, p_request_id uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_accept_proposal(p_request, p_request_id, now()); $$;
comment on function public.customer_accept_proposal(uuid, uuid) is 'RPC for the customer Mini App (C08): app.customer_accept_proposal at the current time';

revoke all on function app.request_json(public.store_requests, text, timestamptz), app.request_accepted_unseen(public.store_requests),
  app.customer_accept_proposal(uuid, uuid, timestamptz), app.manager_requests(uuid, text, integer, timestamptz),
  app.manager_request_read(uuid, timestamptz), app.manager_answer_request(uuid, text, text, integer, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.customer_accept_proposal(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.customer_accept_proposal(uuid, uuid) to authenticated;
