-- Test design (#317): the limits on the endpoints that take a short code or a phone. Boundary values on each
-- maximum (limit - 1, limit, limit + 1) and on the window and the lockout (one second before and at their end);
-- equivalence partitions of the counted outcomes (an unknown code counts, a found member or a membership-id lookup
-- does not; every customer_redeem call counts); state transitions open -> locked -> open; isolation between callers,
-- stores and tenants; the alert raised once per lock with count-only facts; and the grants (no API role reaches the
-- counters or the policy table).
begin;

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000017001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000017002'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000017001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000017002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000017001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000017002'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000017003'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000017001'::uuid as brand_a,
  '99999999-9999-4999-8999-000000017001'::uuid as app_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000017001'::uuid as programme_a,
  'eeeeeeee-eeee-4eee-8eee-000000017001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000017002'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000017003'::uuid as staff_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000017004'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000017005'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000017006'::uuid as manager_u,
  timestamptz '2026-11-20 03:00:00+00' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'code-limits-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral (values (fx.owner_u), (fx.staff_u), (fx.staff_2_u), (fx.owner_b_u), (fx.customer_u), (fx.manager_u)) as u (id);

insert into public.tenants (id, slug, name)
select tenant_a, 'code-limits-pgtap-a', 'Code limits pgTAP A' from fx
union all
select tenant_b, 'code-limits-pgtap-b', 'Code limits pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'code-limits-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'code-limits-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'cl170-a1', 'cl-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'cl170-a2', 'cl-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'cl170-b1', 'cl-b', 'Synthetic store B1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null::uuid[]),
         (fx.staff_u, 'staff', array[fx.store_a1]), (fx.staff_2_u, 'staff', array[fx.store_a1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_b, fx.owner_b_u, 'owner', null from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-limits-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme A', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_a, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-170-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07' from fx;

create temp table ids (name text primary key, id uuid);
insert into ids select 'customer', app.loyalty_customer_for_phone(tenant_a, '0900017001', now() - interval '20 days') from fx;
insert into ids select 'member', app.loyalty_join(tenant_a, (select id from ids where name = 'customer'), 'mini_app', store_a1, brand_a, 'syn-zalo-170-1', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-170-1', customer_u, (select id from ids where name = 'customer') from fx;

create function pg_temp.as_user(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.as_customer()
returns void
language sql
as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', fx.customer_u, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a, 'customer_id', (select id from ids where name = 'customer')))::text, true)
  from fx;
$$;

create function pg_temp.verify(p_user uuid, p_store uuid, p_code text, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := app.staff_verify_redemption(p_store, p_code, p_at);
  return coalesce(v ->> 'refusal', v ->> 'state');
end;
$$;

create function pg_temp.verify_times(p_user uuid, p_store uuid, p_times integer, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_last text;
begin
  for i in 1..p_times loop
    v_last := pg_temp.verify(p_user, p_store, 'NOPE' || i, p_at);
  end loop;
  return v_last;
end;
$$;

create function pg_temp.attempts(p_endpoint text, p_kind text, p_subject uuid)
returns text
language sql
as $$
  select coalesce((select a.attempts || ':' || (a.locked_until is not null) from app.code_attempts a
    where a.endpoint = p_endpoint and a.subject_kind = p_kind and a.subject_id = p_subject), 'none');
$$;

create function pg_temp.lockouts(p_subject text)
returns integer
language sql
as $$
  select count(*)::integer from public.alert_events e
  where e.rule_key = 'code_guessing_lockout' and e.tenant_id in ((select tenant_a from fx), (select tenant_b from fx))
    and e.dedupe_key like '%' || p_subject;
$$;

select plan(42);

-- The policies and the grants.
select is(
  (select string_agg(endpoint || ':' || counts || ':' || caller_max || ':' || scope_max || ':' || window_length || ':' || lockout, ', ' order by endpoint) from app.code_attempt_policies),
  'counter_member_lookup:misses:5:20:00:15:00:00:15:00, customer_call_staff:calls:6:120:00:15:00:00:15:00, customer_change_pickup:calls:10:200:00:15:00:00:15:00, customer_counter_claim:misses:5:50:00:15:00:00:15:00, customer_inbox_read:calls:120:10000:00:15:00:00:15:00, customer_invoice_request:calls:10:1000:01:00:00:01:00:00, customer_marketing:calls:10:1000:00:15:00:00:15:00, customer_place_order:calls:20:200:00:15:00:00:15:00, customer_redeem:calls:10:100:00:15:00:00:15:00, customer_stamp_code:calls:30:10000:00:15:00:00:15:00, customer_table:misses:10:50:00:15:00:00:15:00, loyalty_member_lookup:misses:10:30:00:15:00:00:15:00, request_app:calls:5:100:1 day:01:00:00, request_website:calls:3:100:01:00:00:01:00:00, staff_clock_in:misses:5:20:00:15:00:00:15:00, staff_member_lookup:misses:10:30:00:15:00:00:15:00, staff_submit_bill:misses:5:20:00:15:00:00:15:00, staff_verify_redemption:misses:5:20:00:15:00:00:15:00',
  'eighteen endpoints with their limits (the native till''s table lookup, staff calls, order placement, the requests of the app and the website, the counter clock-in, the counter''s member lookup, the customer''s member code, the company invoice request, the customer''s change of pick-up time, the inbox''s read marks and the marketing consent added)'
);
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated')) r (role)
   where has_table_privilege(r.role, 'app.code_attempts', 'select') or has_table_privilege(r.role, 'app.code_attempt_policies', 'select')
      or has_function_privilege(r.role, 'app.code_attempt_record(text, uuid, uuid, uuid, timestamptz)', 'execute')
      or has_function_privilege(r.role, 'app.code_attempt_gate(text, uuid, uuid, uuid, timestamptz)', 'execute')),
  0,
  'anon and authenticated reach neither the counters, the policies nor the counting functions'
);
select ok(
  not has_function_privilege('service_role', 'app.code_attempt_record(text, uuid, uuid, uuid, timestamptz)', 'execute'),
  'the service role cannot count attempts either'
);
select is(
  (select row(category, delivery, default_enabled, default_severity::text, default_roles::text, default_cooldown, store_scoped)::text
   from public.alert_rule_catalog where rule_key = 'code_guessing_lockout'),
  '(operations,immediate,t,warning,"{owner,manager}",01:00:00,t)',
  'the lockout alert rule'
);
select throws_ok($$ select app.code_attempt_record('no_such_endpoint', (select tenant_a from fx), null, null, now()) $$, '22023', null, 'an endpoint without a policy is refused');
select throws_ok($$ select app.code_attempt_gate('staff_verify_redemption', null, null, null, now()) $$, '22023', null, 'a gate without a tenant is refused');

-- staff_verify_redemption: the caller's maximum of 5 unknown codes in 15 minutes.
select is(pg_temp.verify_times((select staff_u from fx), (select store_a1 from fx), 4, (select t0 from fx)), 'unknown', 'limit - 1: the fourth unknown code is unknown');
select is(pg_temp.attempts('staff_verify_redemption', 'caller', (select staff_u from fx)), '4:false', 'four counted, no lock');
select is(pg_temp.lockouts((select staff_u::text from fx)), 0, 'no alert below the limit');
select is(pg_temp.verify((select staff_u from fx), (select store_a1 from fx), 'NOPE5', (select t0 from fx)), 'unknown', 'limit: the fifth unknown code is still answered');
select is(pg_temp.attempts('staff_verify_redemption', 'caller', (select staff_u from fx)), '5:true', 'the fifth locks the caller');
select is(pg_temp.lockouts((select staff_u::text from fx)), 1, 'one alert for the lock');
select ok(
  (select app.facts_are_count_only(e.facts) and e.facts ->> 'endpoint' = 'staff_verify_redemption' and (e.facts ->> 'attempts')::integer = 5
   from public.alert_events e where e.rule_key = 'code_guessing_lockout' and e.dedupe_key like '%' || (select staff_u::text from fx)),
  'the alert carries counts only, never a code'
);
select is(pg_temp.verify((select staff_u from fx), (select store_a1 from fx), 'NOPE6', (select t0 from fx)), 'locked', 'limit + 1: the caller is locked');
select is(
  (perform_result.r ->> 'retry_at')::timestamptz,
  (select t0 + interval '15 minutes' from fx),
  'the locked answer says when to retry'
) from (select pg_temp.as_user((select staff_u from fx)), app.staff_verify_redemption((select store_a1 from fx), 'NOPE7', (select t0 from fx)) as r) perform_result;
select is(pg_temp.attempts('staff_verify_redemption', 'caller', (select staff_u from fx)), '5:true', 'a locked call is not counted');
select is(pg_temp.verify((select staff_2_u from fx), (select store_a1 from fx), 'NOPE1', (select t0 from fx)), 'unknown', 'another staff member of the store is not locked by the first one');
select is(pg_temp.verify((select staff_u from fx), (select store_a1 from fx), 'NOPE8', (select t0 + interval '14 minutes 59 seconds' from fx)), 'locked', 'one second before the lock ends: locked');
select is(pg_temp.verify((select staff_u from fx), (select store_a1 from fx), 'NOPE9', (select t0 + interval '15 minutes' from fx)), 'unknown', 'at the end of the lock: answered again');
select is(pg_temp.attempts('staff_verify_redemption', 'caller', (select staff_u from fx)), '1:false', 'a new window starts after the lock');
select throws_ok(
  $$ select pg_temp.verify((select owner_b_u from fx), (select store_a1 from fx), 'NOPE1', (select t0 from fx)) $$,
  '42501', null, 'an owner of another tenant is refused before any count'
);

-- The window: four misses, then a fifth after the window does not lock.
select is(pg_temp.verify_times((select staff_2_u from fx), (select store_a1 from fx), 3, (select t0 + interval '1 hour' from fx)), 'unknown', 'misses in a later window');
select is(pg_temp.attempts('staff_verify_redemption', 'caller', (select staff_2_u from fx)), '3:false', 'the earlier window was not carried over');

-- The store's maximum of 20 unknown codes, from any callers.
select is(
  (select count(*)::integer from generate_series(1, 18) g
   where app.code_attempt_record('staff_verify_redemption', (select tenant_a from fx), (select store_a2 from fx), gen_random_uuid(), (select t0 from fx)) is not null),
  0,
  'store limit - 2 from eighteen callers: no lock'
);
select is(pg_temp.verify((select owner_u from fx), (select store_a2 from fx), 'NOPE1', (select t0 from fx)), 'unknown', 'store limit - 1: answered');
select is(pg_temp.verify((select manager_u from fx), (select store_a2 from fx), 'NOPE1', (select t0 from fx)), 'unknown', 'store limit: answered, and the store locks');
select is(pg_temp.attempts('staff_verify_redemption', 'store', (select store_a2 from fx)), '20:true', 'twenty misses lock the store');
select is(pg_temp.verify((select owner_u from fx), (select store_a2 from fx), 'NOPE2', (select t0 from fx)), 'locked', 'store limit + 1: every caller at the store is locked');
select is(pg_temp.verify((select owner_u from fx), (select store_a1 from fx), 'NOPE2', (select t0 + interval '1 hour' from fx)), 'unknown', 'the other store of the tenant is not locked');
select is(pg_temp.lockouts((select store_a2::text from fx)), 1, 'the store lock raises one alert');

-- staff_member_lookup: phones that find no member count; a membership-id lookup is never counted nor locked.
select pg_temp.as_user((select staff_u from fx));
select is(
  (select count(*)::integer from generate_series(1, 9) g
   where (app.staff_member_lookup((select store_a1 from fx), '09000171' || lpad(g::text, 2, '0'), null, (select t0 from fx)) ->> 'found')::boolean),
  0,
  'nine unknown phones are not found'
);
select is(app.staff_member_lookup((select store_a1 from fx), '0900017001', null, (select t0 from fx)) ->> 'found', 'true', 'a known phone is found and not counted');
select is(pg_temp.attempts('staff_member_lookup', 'caller', (select staff_u from fx)), '9:false', 'limit - 1 after nine misses');
select is(app.staff_member_lookup((select store_a1 from fx), '0900017199', null, (select t0 from fx)) ->> 'locked', null, 'limit: the tenth miss is answered');
select is(app.staff_member_lookup((select store_a1 from fx), '0900017001', null, (select t0 from fx)) - 'retry_at', '{"found": false, "locked": true}'::jsonb, 'limit + 1: even a known phone answers locked, without the card');
select is(
  app.staff_member_lookup((select store_a1 from fx), null, (select id from ids where name = 'member'), (select t0 from fx)) ->> 'found',
  'true',
  'a lookup by membership id still works while phone lookups are locked'
);

-- loyalty_member_lookup (web): ten unknown phones, then PT429; it uses the current time.
select pg_temp.as_user((select owner_u from fx));
select is(
  (select count(*)::integer from generate_series(1, 10) g, public.loyalty_member_lookup('09000172' || lpad(g::text, 2, '0')) l),
  0,
  'ten unknown phones find nothing'
);
select is(pg_temp.attempts('loyalty_member_lookup', 'caller', (select owner_u from fx)), '10:true', 'the tenth locks the caller');
select throws_ok($$ select * from public.loyalty_member_lookup('0900017001') $$, 'PT429', null, 'limit + 1: refused with 429 before anything is read');

-- customer_redeem: every call counts; the eleventh in 15 minutes is rate_limited and holds nothing.
select pg_temp.as_customer();
select is(
  (select count(*)::integer from generate_series(1, 10) g
   where app.customer_redeem(gen_random_uuid(), 'cl-1', (select t0 from fx)) ->> 'refusal' = 'rate_limited'),
  0,
  'ten redemption calls are answered'
);
select is(
  (select r ->> 'refusal' || ':' || (r ? 'stamps') || ':' || coalesce(r ->> 'redemption_id', 'none')
   from (select app.customer_redeem(gen_random_uuid(), 'cl-1', (select t0 from fx)) as r) x),
  'rate_limited:true:none',
  'the eleventh is rate_limited with the balance and no hold'
);
select is(
  (select count(*)::integer from public.redemptions where membership_id = (select id from ids where name = 'member')),
  0,
  'no redemption was held by the refused calls'
);

select * from finish();
rollback;
