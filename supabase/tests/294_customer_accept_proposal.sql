-- The customer accepts the time a manager proposed (C08, M01; migration customer_accept_proposal): only their own
-- proposed request while the time proposed is ahead, idempotent per the app's request id, ending as the manager's
-- confirm ends, recorded with its moment, and flagged in the manager inbox until an owner or manager opens or answers it.
-- Techniques: boundary values of the time proposed (accepting one second before it, at it, one second after it),
-- equivalence partitions of the ids (missing, unknown, another customer's, another tenant's, a website request),
-- state transitions (proposed -> accepted; new, declined, cancelled, confirmed by a manager and already accepted ->
-- not_allowed; accepted -> cancelled by the customer and by a manager), an oracle (the end state equals the manager's
-- confirm), error guessing (a replay, the same request id on another request, a write that skips the function), the
-- inbox's flag (counted, listed after the new ones, cleared by the first opening or an answer, the first reading kept),
-- IDOR, authorisation and grants, and the index of the new foreign key.
begin;
select plan(42);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029401'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029402'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029401'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029402'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029401'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029403'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029401'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029402'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029401'::uuid as app_a,
  '99999999-9999-4999-8999-000000029402'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000029401'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029402'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029403'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029411'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029412'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029413'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000029414'::uuid as cust4_u,
  'eeeeeeee-eeee-4eee-8eee-000000029419'::uuid as custb_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-294-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.staff_a2_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-294-a', 'Native 294 A' from fx union all
select tenant_b, 'native-294-b', 'Native 294 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-294-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-294-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]], "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]], "sun": [["07:00", "23:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a2, fx.tenant_a, fx.account_a, 'n294-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'n294-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.staff_a2_u, 'staff', array[fx.store_a2])
) as m (user_id, role, store_ids);
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-294-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-294-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-294-' || n, u from fx cross join lateral (values (1, fx.cust1_u), (2, fx.cust2_u), (3, fx.cust3_u), (4, fx.cust4_u)) as c (n, u)
union all
select tenant_b, app_b, 'syn-zalo-294-9', custb_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a2, tenant_a, 'native', true, array['table'], array['counter'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table'], array['counter'], false from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); a booking of A2 from the app; a manager's
-- answer; the customer's acceptance at an instant; the inbox; a statement through the API role.
create function pg_temp.claims(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
$$;
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.as_role(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.claims(p_user);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v;
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create temp table rq (name text primary key, id uuid);
grant select on rq to authenticated;
create function pg_temp.rq(p_name text) returns uuid language sql stable as $$ select id from rq where name = p_name $$;
create function pg_temp.book(p_user uuid, p_at text) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_submit_request(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-2', 'kind', 'booking', 'name', 'Lan', 'phone', '0901234567', 'party_size', 4, 'at', p_at),
    (select noon from fx))) -> 'request' ->> 'id')::uuid;
$$;
create function pg_temp.answer(p_user uuid, p_req uuid, p_status text, p_message text, p_for text default null, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_answer_request(%L, %L, %L, %s, %L, %L)$q$, p_req, p_status, p_message,
    (select version from public.store_requests where id = p_req), coalesce(p_at, (select noon from fx) + interval '5 minutes'), p_for));
$$;
create function pg_temp.accept(p_user uuid, p_req uuid, p_key uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_accept_proposal(%L, %L, %L)$q$, p_req, p_key, coalesce(p_at, (select noon from fx) + interval '10 minutes')));
$$;
create function pg_temp.inbox(p_user uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_requests(%L, null, 50, %L)$q$, (select store_a2 from fx), coalesce(p_at, (select noon from fx) + interval '20 minutes')));
$$;
create function pg_temp.state(p_req uuid) returns text language sql stable as $$
  select r.status || '/' || r.version || '/' || coalesce(r.customer_accepted_at::text, '-') from public.store_requests r where r.id = p_req;
$$;

-- Ten bookings of A2 for tomorrow 19:00, from four customers (at most three new ones each), and keys for the app's ids.
insert into rq select 'r1', pg_temp.book((select cust1_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r2', pg_temp.book((select cust1_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r3', pg_temp.book((select cust1_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r4', pg_temp.book((select cust2_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r5', pg_temp.book((select cust2_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r6', pg_temp.book((select cust2_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r7', pg_temp.book((select cust3_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'r8', pg_temp.book((select cust3_u from fx), '2026-11-26T19:00:00+07:00');
insert into rq select 'web', null;
insert into public.store_requests (tenant_id, store_id, kind, channel, client_request_id, client_key_sha256, request_hash, contact_name, contact_phone, party_size, requested_for, created_at)
select tenant_a, store_a2, 'booking', 'website', gen_random_uuid(), repeat('a', 64), repeat('b', 64), 'Web', app.loyalty_normalize_phone('0901234567'), 2, timestamptz '2026-11-26 19:00+07', noon from fx;
update rq set id = (select r.id from public.store_requests r where r.channel = 'website' and r.store_id = (select store_a2 from fx)) where name = 'web';
insert into rq values
  ('k1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029481'), ('k2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029482'), ('k3', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029483'),
  ('k4', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029484'), ('k5', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029485'), ('k6', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029486'),
  ('k7', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029487'), ('k8', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029488'), ('k9', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029489'),
  ('unknown', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029499');
select is((select count(*)::int from rq where id is null), 0, 'nine bookings of A2: eight from the app, one from the website');

-- The manager proposes 19:30 to r1, r2, r3, r5, r6, r7 and the website request, and declines r8; r4 stays new.
select is(
  (select string_agg(pg_temp.answer((select manager_u from fx), pg_temp.rq(n), 'proposed', '19:00 đã kín, 19:30 được không?', '2026-11-26T19:30:00+07:00') -> 'request' ->> 'status', ',' order by n)
   from unnest(array['r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'web']) as n),
  'proposed,proposed,proposed,proposed,proposed,proposed,proposed', 'a time is proposed to seven requests'
);
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('r8'), 'declined', 'Hết chỗ') -> 'request' ->> 'status'), 'declined', 'and one is declined');

-- 1. Boundary values of the time proposed ---------------------------------------------------------------------------
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('r2'), pg_temp.rq('k2'), timestamptz '2026-11-26 19:30:00+07') ->> 'refusal'), 'proposal_expired', 'boundary: at the time proposed it can no longer be accepted');
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('r3'), pg_temp.rq('k3'), timestamptz '2026-11-26 19:30:01+07') ->> 'refusal'), 'proposal_expired', 'boundary: one second after it neither');
select is(pg_temp.state(pg_temp.rq('r2')) || ' ' || pg_temp.state(pg_temp.rq('r3')), 'proposed/2/- proposed/2/-', 'a refused acceptance changes nothing');
select is(
  (select (r ->> 'state') || '/' || (r ->> 'replayed') || '/' || (r -> 'request' ->> 'status') || '/' || (r -> 'request' ->> 'requested_for')::timestamptz::text
     || '/' || (r -> 'request' ->> 'customer_accepted_at')::timestamptz::text
   from pg_temp.accept((select cust1_u from fx), pg_temp.rq('r1'), pg_temp.rq('k1'), timestamptz '2026-11-26 19:29:59+07') r),
  'accepted/false/confirmed/' || timestamptz '2026-11-26 19:30+07' || '/' || timestamptz '2026-11-26 19:29:59+07',
  'boundary: one second before the time proposed the customer accepts: confirmed, moved to 19:30, the moment recorded'
);

-- 2. Replay and conflict of the app's request id ----------------------------------------------------------------------
select is(
  (select (r ->> 'state') || '/' || (r ->> 'replayed') || '/' || (r -> 'request' ->> 'version') from pg_temp.accept((select cust1_u from fx), pg_temp.rq('r1'), pg_temp.rq('k1')) r),
  'accepted/true/3', 'the same request id again answers the acceptance as a replay, writing nothing'
);
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('r3'), pg_temp.rq('k1')) ->> 'refusal'), 'request_conflict', 'the same request id on another request is request_conflict');
select is(pg_temp.state(pg_temp.rq('r3')), 'proposed/2/-', 'and that request is untouched');
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('r1'), pg_temp.rq('k9')) ->> 'refusal'), 'not_allowed', 'a second acceptance with a new id is not_allowed: the request is confirmed');
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('r1'), null) ->> 'error'), '22023', 'an acceptance without its request id is 22023');
select is((pg_temp.accept((select cust1_u from fx), null, pg_temp.rq('k9')) ->> 'error'), '22023', 'nor without the request');

-- 3. The inbox flags the acceptance ----------------------------------------------------------------------------------
select is(
  (select (r ->> 'accepted_unseen') || '/' || (r -> 'requests' -> 0 ->> 'id' = pg_temp.rq('r4')::text) || '/' || (r -> 'requests' -> 1 ->> 'id' = pg_temp.rq('r1')::text)
     || '/' || (r -> 'requests' -> 1 ->> 'accepted_unseen') || '/' || (r ->> 'unread')
   from pg_temp.inbox((select manager_u from fx)) r),
  '1/true/true/true/1', 'the inbox counts one acceptance unseen and lists it right after the new request; the unread count is of new requests only'
);
select is(
  (select (r -> 'request' ->> 'accepted_unseen') || '/' || ((r -> 'request' ->> 'accept_seen_by')::uuid = (select owner_u from fx)) || '/'
     || ((r -> 'request' ->> 'read_at')::timestamptz = (select noon from fx) + interval '5 minutes') || '/' || ((r -> 'request' ->> 'read_by')::uuid = (select manager_u from fx))
   from pg_temp.call((select owner_u from fx), format($q$select app.manager_request_read(%L, %L)$q$, pg_temp.rq('r1'), (select noon from fx) + interval '30 minutes')) r),
  'false/true/true/true', 'the owner opens it: the flag goes with who and when, the first reading (the manager''s proposal) is kept'
);
select is(
  (select ((r -> 'request' ->> 'accept_seen_at')::timestamptz = (select noon from fx) + interval '30 minutes') || '/' || ((r -> 'request' ->> 'accept_seen_by')::uuid = (select owner_u from fx))
   from pg_temp.call((select manager_u from fx), format($q$select app.manager_request_read(%L, %L)$q$, pg_temp.rq('r1'), (select noon from fx) + interval '40 minutes')) r),
  'true/true', 'a later opening by the manager keeps who first saw it and when'
);
select is((pg_temp.inbox((select manager_u from fx)) ->> 'accepted_unseen'), '0', 'nothing is flagged any more');
select is(
  (select ((r -> 'requests' -> 0) ? 'accept_seen_by')::text || '/' || ((r -> 'requests' -> 0) ? 'accepted_unseen')::text || '/' || ((r -> 'requests' -> 0) ? 'customer_accepted_at')::text
   from pg_temp.call((select cust1_u from fx), 'select app.customer_requests()') r),
  'false/false/true', 'the customer sees when they accepted, not who in the store saw it'
);

-- 4. State transitions ----------------------------------------------------------------------------------------------
select is((pg_temp.accept((select cust2_u from fx), pg_temp.rq('r4'), pg_temp.rq('k4')) ->> 'refusal'), 'not_allowed', 'a new request (nothing proposed) cannot be accepted');
select is((pg_temp.call((select cust2_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.rq('r5'))) ->> 'state'), 'cancelled', 'the customer declines a proposal by cancelling');
select is((pg_temp.accept((select cust2_u from fx), pg_temp.rq('r5'), pg_temp.rq('k5')) ->> 'refusal'), 'not_allowed', 'a cancelled request cannot be accepted');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('r6'), 'confirmed', null) -> 'request' ->> 'status'), 'confirmed', 'the manager confirms a proposal on the customer''s word');
select is((pg_temp.accept((select cust2_u from fx), pg_temp.rq('r6'), pg_temp.rq('k6')) ->> 'refusal'), 'not_allowed', 'a request a manager confirmed cannot be accepted again');
select is((pg_temp.accept((select cust3_u from fx), pg_temp.rq('r8'), pg_temp.rq('k8')) ->> 'refusal'), 'not_allowed', 'nor a declined one');
select is((pg_temp.accept((select cust3_u from fx), pg_temp.rq('r7'), pg_temp.rq('k7')) ->> 'state'), 'accepted', 'the customer accepts r7');
select is(
  (select r.status || '/' || r.requested_for::text || '/' || r.proposed_for::text || '/' || r.version || '/' || (r.answered_by = (select manager_u from fx)) || '/' || r.answer_message
   from public.store_requests r where r.id = pg_temp.rq('r7')),
  (select r.status || '/' || r.requested_for::text || '/' || r.proposed_for::text || '/' || r.version || '/' || (r.answered_by = (select manager_u from fx)) || '/' || '19:00 đã kín, 19:30 được không?'
   from public.store_requests r where r.id = pg_temp.rq('r6')),
  'oracle: the customer''s acceptance ends as the manager''s confirm (status, time, proposal kept, version), the manager''s proposal message kept'
);
select is(
  (select (r -> 'request' ->> 'status') || '/' || ((r -> 'request' ->> 'accept_seen_by')::uuid = (select manager_u from fx)) || '/' || (r -> 'request' ->> 'accepted_unseen')
   from pg_temp.answer((select manager_u from fx), pg_temp.rq('r7'), 'cancelled', 'Quán đóng cửa đột xuất', null, (select noon from fx) + interval '50 minutes') r),
  'cancelled/true/false', 'a manager cancels the accepted booking: answering counts as seeing the acceptance'
);
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.rq('r1'))) ->> 'state'), 'cancelled', 'the customer may still cancel an accepted booking');
select is(
  (select (r ->> 'replayed') || '/' || (r -> 'request' ->> 'status') from pg_temp.accept((select cust1_u from fx), pg_temp.rq('r1'), pg_temp.rq('k1')) r),
  'true/cancelled', 'a replay of the acceptance answers the request as it is now and writes nothing'
);

-- 5. IDOR: another customer's request answers as an unknown id ---------------------------------------------------------
select is(
  (select string_agg((x.r - 'request')::text || '|' || coalesce(x.r ->> 'request', 'null'), ' ' order by x.n)
   from (values
     (1, pg_temp.accept((select cust4_u from fx), pg_temp.rq('r3'), pg_temp.rq('k3'))),
     (2, pg_temp.accept((select cust4_u from fx), pg_temp.rq('unknown'), pg_temp.rq('k3'))),
     (3, pg_temp.accept((select custb_u from fx), pg_temp.rq('r3'), pg_temp.rq('k3')))
   ) as x (n, r)),
  (select string_agg('{"state": "refused", "refusal": "unknown_request", "replayed": false}|null', ' ') from generate_series(1, 3)),
  'another customer''s request, an unknown id and another tenant''s customer get the same answer, with no request in it'
);
select is((pg_temp.accept((select cust1_u from fx), pg_temp.rq('web'), pg_temp.rq('k3')) ->> 'refusal'), 'unknown_request', 'a website request belongs to no app login: unknown_request');
select is(pg_temp.state(pg_temp.rq('r3')) || ' ' || pg_temp.state(pg_temp.rq('web')), 'proposed/2/- proposed/2/-', 'none of those calls changed a request');
select is((pg_temp.accept((select manager_u from fx), pg_temp.rq('r3'), pg_temp.rq('k3')) ->> 'error'), '42501', 'a manager is no customer session: 42501');
select is((pg_temp.accept((select staff_a2_u from fx), pg_temp.rq('r3'), pg_temp.rq('k3')) ->> 'error'), '42501', 'nor is staff');

-- 6. Grants, the table's guard and the new foreign key's index ----------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.customer_accept_proposal(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.customer_accept_proposal(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.customer_accept_proposal(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.customer_accept_proposal(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.request_accepted_unseen(public.store_requests)', 'execute'),
  'the RPC is for signed-in callers only; anon and the service role get nothing, nor the app halves'
);
select is(
  pg_temp.as_role((select cust1_u from fx), format($q$select public.customer_accept_proposal(%L, %L) ->> 'refusal'$q$, pg_temp.rq('r3'), pg_temp.rq('k1'))),
  'request_conflict', 'the public wrapper answers through the API role (k1 already accepted r1)'
);
select is(
  pg_temp.as_role((select cust2_u from fx), format($q$select public.customer_accept_proposal(%L, %L)::text$q$, pg_temp.rq('r3'), pg_temp.rq('k2'))),
  '{"state": "refused", "refusal": "unknown_request", "request": null, "replayed": false}', 'through the API role another customer''s request is unknown too'
);
select is(
  pg_temp.as_role((select cust1_u from fx), format($q$select count(*)::text from public.store_requests where id = %L$q$, pg_temp.rq('r3'))),
  '0', 'a customer reads no request row directly'
);
select throws_ok(
  format($q$update public.store_requests set customer_accepted_at = now() where id = %L$q$, pg_temp.rq('r3')),
  '23514', null, 'the table refuses an acceptance without its request id, whoever writes it'
);
select throws_ok(
  format($q$update public.store_requests set accept_seen_at = now() where id = %L$q$, pg_temp.rq('r3')),
  '23514', null, 'and a seen mark without an acceptance'
);
select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f' and c.conrelid = 'public.store_requests'::regclass and c.confrelid = 'auth.users'::regclass
     and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.store_requests'::regclass and a.attname = 'accept_seen_by')]::int2[]
     and exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indpred is null and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[])),
  1, 'the new foreign key accept_seen_by (to the Auth users, set null) has a whole index led by it'
);
select is(
  (select count(*)::int from pg_attribute a where a.attrelid = 'public.store_requests'::regclass and a.attname in ('customer_accepted_at', 'accept_request_id', 'accept_seen_at', 'accept_seen_by')
     and has_column_privilege('authenticated', 'public.store_requests', a.attname, 'update')),
  0, 'no API role writes the acceptance columns'
);

select * from finish();
rollback;
