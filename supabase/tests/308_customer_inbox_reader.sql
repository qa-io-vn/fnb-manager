-- C12's reader, read marks, marketing switch, retention and the customer's own data (migration customer_inbox,
-- ADR-073; GA-063, GA-064). Techniques: state transitions of an item (unread -> read, read stays read with its first
-- time, every unread item at once) and of the marketing consent (none -> active -> a replay -> revoked by "Dừng nhận
-- tin" -> active again with a new record); boundary values of the page (exactly 20 items, 21, 41; the cursor 0, 1 and
-- the last item's), of the retention (90 days ± 1 second for the reader and the purge), of the list of ids (1, 100,
-- 101, empty) and of the rate limits (the 120th read mark and the 10th start allowed, the next refused, the lock's end);
-- equivalence partitions of the filter (all, orders, offers, an unknown one); a decision table of who may call (a
-- customer, a visitor, another customer, another brand's customer, another tenant's customer, staff, anon) with IDOR
-- probes on every write; the consent required before any promotion is sent; and the copy, deletion and DSR of C19.
begin;
select plan(83);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030801'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030802'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030801'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030802'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030801'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030803'::uuid as store_c1,
  'ffffffff-ffff-4fff-8fff-000000030802'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030801'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030803'::uuid as brand_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030802'::uuid as brand_b,
  '99999999-9999-4999-8999-000000030801'::uuid as app_a,
  '99999999-9999-4999-8999-000000030803'::uuid as app_c,
  '99999999-9999-4999-8999-000000030802'::uuid as app_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000030891'::uuid as programme_a,
  '77777777-7777-4777-8777-000000030801'::uuid as customer_m,
  '77777777-7777-4777-8777-000000030802'::uuid as customer_n,
  '88888888-8888-4888-8888-000000030801'::uuid as member_m,
  'eeeeeeee-eeee-4eee-8eee-000000030801'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030803'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030811'::uuid as member_u,
  'eeeeeeee-eeee-4eee-8eee-000000030812'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000030813'::uuid as other_u,
  'eeeeeeee-eeee-4eee-8eee-000000030814'::uuid as brand_c_u,
  'eeeeeeee-eeee-4eee-8eee-000000030815'::uuid as tenant_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000030816'::uuid as gone_u,
  timestamptz '2026-11-27 12:00+07' as t0;
grant select on fx to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'inbox-308-' || right(u.id::text, 4) || '@example.com', u.meta
from fx cross join lateral (values
  (fx.owner_u, '{}'::jsonb), (fx.staff_u, '{}'::jsonb),
  (fx.member_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)), (fx.visitor_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)),
  (fx.other_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)), (fx.brand_c_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)),
  (fx.tenant_b_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_b)), (fx.gone_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a))
) as u (id, meta);
insert into public.tenants (id, slug, name, country_code)
select tenant_a, 'inbox-308-a', 'Inbox 308 A', 'VN' from fx union all select tenant_b, 'inbox-308-b', 'Inbox 308 B', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'inbox-308-a', 'Synthetic account A' from fx union all select account_b, tenant_b, 'mock', 'inbox-308-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 't308-a1', 'ir-1', 'Synthetic store A1' from fx union all
select store_c1, tenant_a, account_a, 't308-c1', 'ir-3', 'Synthetic store C1' from fx union all
select store_b1, tenant_b, account_b, 't308-b1', 'ir-2', 'Synthetic store B1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx union all
select tenant_a, staff_u, 'staff'::public.tenant_role, array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx union all
select brand_c, tenant_a, 'brand-3', 'Synthetic brand C', array[store_c1] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-308-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_c, tenant_a, brand_c, 'synthetic-308-app-c', 'ZALO_APP_SECRET_BRAND_3', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-308-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_a, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-308-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07' from fx;
insert into public.customers (id, tenant_id, phone, name)
select customer_m, tenant_a, '0900000' || '308', 'Synthetic member' from fx union all
select customer_n, tenant_a, '0900001' || '308', 'Synthetic other' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_m, tenant_a, programme_a, customer_m, 'mini_app', '2026-11-01 10:00+07'::timestamptz, brand_a from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_a, 'customer'::public.consent_subject, customer_m, 'loyalty'::public.consent_purpose, 'privacy-308-1', 'mini_app', '2026-11-01 10:00+07'::timestamptz from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-308-m', member_u, customer_m from fx union all
select tenant_a, app_a, 'syn-zalo-308-v', visitor_u, null from fx union all
select tenant_a, app_a, 'syn-zalo-308-o', other_u, customer_n from fx union all
select tenant_a, app_c, 'syn-zalo-308-c', brand_c_u, null from fx union all
select tenant_b, app_b, 'syn-zalo-308-b', tenant_b_u, null from fx union all
select tenant_a, app_a, 'syn-zalo-308-g', gone_u, null from fx;

create function pg_temp.login(p_user uuid) returns uuid language sql stable as $$ select l.id from app.customer_logins l where l.user_id = p_user $$;
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id, 'customer_id', l.customer_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.inbox(p_user uuid, p_filter text, p_before bigint, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_inbox(%L, %s, %L)$q$, p_filter, coalesce(p_before::text, 'null'), p_at));
$$;
create function pg_temp.mark(p_user uuid, p_ids uuid[], p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_inbox_read(%L::uuid[], %L)$q$, p_ids, p_at));
$$;
-- n stamp items of a login, a second apart, ending at p_end
create function pg_temp.stamps(p_user uuid, p_n integer, p_end timestamptz, p_prefix text) returns integer language sql as $$
  select count(app.customer_inbox_add((select tenant_id from app.customer_logins where user_id = p_user), pg_temp.login(p_user), 'stamp', p_prefix || ':' || g,
    jsonb_build_object('added', 1, 'stamps', 1, 'left', 8, 'per', 9), null, null, null, p_end - make_interval(secs => p_n - g)))::integer
  from generate_series(1, p_n) g;
$$;
create temp table sink (v text);
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

-- An order of the member at a table, with two lines, for the order item's fields.
insert into o values ('order', gen_random_uuid());
insert into public.orders (id, tenant_id, brand_id, store_id, source, customer_login_id, order_type, table_label, business_date, order_no, status, payment_status,
  payment_method, subtotal, total, request_id, request_hash, placed_at, accepted_at)
select pg_temp.o('order'), tenant_a, brand_a, store_a1, 'app', pg_temp.login(member_u), 'table', 'Bàn 5', date '2026-11-27', 7, 'serving', 'paid', 'counter', 120000, 120000,
  gen_random_uuid(), repeat('a', 64), t0 - interval '2 hours', t0 - interval '2 hours' from fx;
insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_name, quantity, unit_price, line_total, counts_for_stamps)
select tenant_a, store_a1, pg_temp.o('order'), 1, 'Cà phê sữa', 2, 40000, 80000, true from fx union all
select tenant_a, store_a1, pg_temp.o('order'), 2, 'Bánh chuối', 1, 40000, 40000, false from fx;

-- 1. The page: exactly 20, then 21 and 41 items ---------------------------------------------------------------------
insert into sink select pg_temp.stamps((select member_u from fx), 20, (select t0 - interval '1 hour' from fx), 's');
select is((select jsonb_array_length(r -> 'items') || '/' || coalesce(r ->> 'next_before', 'null') from (select pg_temp.inbox((select member_u from fx), 'all', null, (select t0 from fx)) r) x),
  '20/null', 'boundary: exactly 20 items fill one page with no next page');
insert into sink select app.customer_inbox_add(tenant_a, pg_temp.login(member_u), 'order_ready', 'order:' || pg_temp.o('order') || ':ready', jsonb_build_object('order_type', 'table'),
  pg_temp.o('order'), null, null, t0 - interval '30 minutes') from fx;
create temp table p1 as select pg_temp.inbox((select member_u from fx), 'all', null, (select t0 from fx)) as r;
select is((select jsonb_array_length(r -> 'items') from p1), 20, 'boundary: 21 items give a first page of 20');
select is((select (r ->> 'next_before')::bigint from p1), (select (r -> 'items' -> 19 ->> 'cursor')::bigint from p1), 'and the next page starts after the 20th item''s cursor');
select is((select r -> 'items' -> 0 ->> 'kind' from p1), 'order_ready', 'newest first');
select is((select jsonb_array_length(r -> 'items') || '/' || coalesce(r ->> 'next_before', 'null')
  from (select pg_temp.inbox((select member_u from fx), 'all', (select (r ->> 'next_before')::bigint from p1), (select t0 from fx)) r) x), '1/null', 'the second page holds the 21st item and ends');
insert into sink select pg_temp.stamps((select member_u from fx), 20, (select t0 - interval '20 minutes' from fx), 't');
create temp table q1 as select pg_temp.inbox((select member_u from fx), 'all', null, (select t0 from fx)) as r;
create temp table q2 as select pg_temp.inbox((select member_u from fx), 'all', (select (r ->> 'next_before')::bigint from q1), (select t0 from fx)) as r;
create temp table q3 as select pg_temp.inbox((select member_u from fx), 'all', (select (r ->> 'next_before')::bigint from q2), (select t0 from fx)) as r;
select is((select jsonb_array_length(r -> 'items') from q1) || '/' || (select jsonb_array_length(r -> 'items') from q2) || '/' || (select jsonb_array_length(r -> 'items') || ':' || coalesce(r ->> 'next_before', 'null') from q3),
  '20/20/1:null', 'boundary: 41 items read as 20, 20 and 1');
select is((select count(distinct e ->> 'id')::integer from (select jsonb_array_elements(r -> 'items') e from q1 union all select jsonb_array_elements(r -> 'items') from q2
  union all select jsonb_array_elements(r -> 'items') from q3) x), 41, 'the three pages hold every item once');
select is((select jsonb_array_length(r -> 'items') from (select pg_temp.inbox((select member_u from fx), 'all', 1, (select t0 from fx)) r) x), 0, 'boundary: the cursor 1 gives an empty page');
select is(pg_temp.inbox((select member_u from fx), 'all', 0, (select t0 from fx)), jsonb_build_object('error', '22023'), 'boundary: the cursor 0 is refused');

-- 2. Filters and what an item says -----------------------------------------------------------------------------------
select is((select string_agg(distinct e ->> 'topic', ',') from p1, jsonb_array_elements(r -> 'items') e), 'offers,orders', 'all holds both filters');
select is((select string_agg(e ->> 'kind', ',') from (select pg_temp.inbox((select member_u from fx), 'orders', null, (select t0 from fx)) r) x, jsonb_array_elements(r -> 'items') e),
  'order_ready', 'orders holds the order items only');
select is((select count(*)::integer from (select pg_temp.inbox((select member_u from fx), 'offers', null, (select t0 from fx)) r) x, jsonb_array_elements(r -> 'items') e where e ->> 'topic' <> 'offers'),
  0, 'offers holds no order item');
select is(pg_temp.inbox((select member_u from fx), 'events', null, (select t0 from fx)), jsonb_build_object('error', '22023'), 'an unknown filter is refused (workshop items come in phase 3)');
select is((select r -> 'items' -> 0 -> 'order' from p1),
  jsonb_build_object('display_no', '#007', 'type', 'table', 'table_label', 'Bàn 5', 'status', 'serving', 'payment_status', 'paid', 'total', 120000, 'pickup_at', null,
    'cancel_reason', null, 'first_item', 'Cà phê sữa', 'items', 3),
  'an order item reads its number, table, state, total, first item and item count from the order now');
select is((select (r -> 'items' -> 0 ->> 'target') || ' ' || (r -> 'items' -> 0 ->> 'order_id') from p1), 'order ' || pg_temp.o('order'), 'and leads to the order (C06)');
select is((select (e ->> 'target') || ' ' || (e ->> 'reward_name') from p1, jsonb_array_elements(r -> 'items') e where e ->> 'kind' = 'stamp' limit 1), 'stamps Ly miễn phí',
  'a stamp item leads to the card (C07) with the brand''s reward name');
select is((select (r ->> 'unread') || ' ' || (r -> 'unread_by_topic' ->> 'orders') || ' ' || (r -> 'unread_by_topic' ->> 'offers') from p1), '21 1 20', 'the unread counts, in all and per filter');

-- 3. Read marks: unread -> read, and IDOR ----------------------------------------------------------------------------
create temp table item_order as select (r -> 'items' -> 0 ->> 'id')::uuid as id from p1;
select is(pg_temp.mark((select member_u from fx), array[(select id from item_order)], (select t0 from fx)) ->> 'marked', '1', 'the customer marks one item read');
select is((select read_at from app.customer_inbox where id = (select id from item_order)), (select t0 from fx), 'its read time is the moment of the mark');
select is((select (r ->> 'unread') || ' ' || (r -> 'items' -> 0 ->> 'read_at' is not null)::text from (select pg_temp.inbox((select member_u from fx), 'orders', null, (select t0 from fx)) r) x),
  '40 true', 'the reader shows it read and one fewer unread');
select is((pg_temp.mark((select member_u from fx), array[(select id from item_order)], (select t0 + interval '30 seconds' from fx)) ->> 'marked')
  || ' ' || ((select read_at from app.customer_inbox where id = (select id from item_order)) = (select t0 from fx))::text, '0 true',
  'marking it again changes nothing: read stays read with its first time');
insert into sink select pg_temp.stamps((select other_u from fx), 2, (select t0 - interval '5 minutes' from fx), 'o');
create temp table other_item as select x.id from app.customer_inbox x where x.customer_login_id = pg_temp.login((select other_u from fx)) order by x.seq limit 1;
select is(pg_temp.mark((select member_u from fx), array[(select id from other_item)], (select t0 from fx)) ->> 'marked', '0', 'IDOR: another customer''s item marks nothing');
select is((select read_at from app.customer_inbox where id = (select id from other_item)), null, 'and it stays unread');
select is(pg_temp.mark((select brand_c_u from fx), array[(select id from other_item)], (select t0 from fx)) ->> 'marked', '0', 'IDOR: another brand''s customer marks nothing');
select is(pg_temp.mark((select tenant_b_u from fx), array[(select id from other_item)], (select t0 from fx)) ->> 'marked', '0', 'IDOR: another tenant''s customer marks nothing');
select is(pg_temp.mark((select tenant_b_u from fx), null, (select t0 from fx)) ->> 'marked', '0', 'IDOR: "all" of another tenant''s customer reaches none of these items');
select is((select count(*)::integer from app.customer_inbox where customer_login_id = pg_temp.login((select other_u from fx)) and read_at is null), 2, 'the other customer''s items are untouched');
select is(jsonb_array_length(pg_temp.inbox((select brand_c_u from fx), 'all', null, (select t0 from fx)) -> 'items')
  + jsonb_array_length(pg_temp.inbox((select tenant_b_u from fx), 'all', null, (select t0 from fx)) -> 'items')
  + jsonb_array_length(pg_temp.inbox((select visitor_u from fx), 'all', null, (select t0 from fx)) -> 'items'), 0,
  'another brand''s, another tenant''s and another login''s readers see none of them');
select is(pg_temp.inbox((select staff_u from fx), 'all', null, (select t0 from fx)), jsonb_build_object('error', '42501'), 'staff have no inbox');
select is(pg_temp.mark((select staff_u from fx), null, (select t0 from fx)), jsonb_build_object('error', '42501'), 'staff mark nothing');
select is(pg_temp.mark((select member_u from fx), array[]::uuid[], (select t0 from fx)), jsonb_build_object('error', '22023'), 'boundary: an empty list is refused');
select is(pg_temp.mark((select member_u from fx), array[null::uuid], (select t0 from fx)), jsonb_build_object('error', '22023'), 'a list holding null is refused');
select is(pg_temp.mark((select member_u from fx), (select array_agg(gen_random_uuid()) from generate_series(1, 101)), (select t0 from fx)), jsonb_build_object('error', '22023'),
  'boundary: 101 ids are refused');
select is(pg_temp.mark((select member_u from fx), (select array_agg(gen_random_uuid()) from generate_series(1, 100)), (select t0 from fx)) ->> 'state', 'read', 'boundary: 100 ids are taken');
select is((pg_temp.mark((select member_u from fx), null, (select t0 + interval '1 minute' from fx)) ->> 'marked') || ' '
  || (pg_temp.call((select member_u from fx), format($q$select app.customer_inbox_unread(%L)$q$, (select t0 + interval '1 minute' from fx))) ->> 'unread'), '40 0',
  'null marks every unread item read, and the bell shows 0');

-- 4. The rate limit of read marks: 120 calls in 15 minutes ------------------------------------------------------------
do $$
begin
  for i in 1..114 loop
    perform pg_temp.mark((select member_u from fx), null, (select t0 + interval '2 minutes' from fx));
  end loop;
end;
$$;
select is(pg_temp.mark((select member_u from fx), null, (select t0 + interval '2 minutes' from fx)) ->> 'state', 'read', 'boundary: the 120th call in 15 minutes is taken');
create temp table limited as select pg_temp.mark((select member_u from fx), null, (select t0 + interval '3 minutes' from fx)) as r;
select is((select r ->> 'refusal' from limited), 'rate_limited', 'boundary: the 121st is refused rate_limited');
select is(pg_temp.mark((select member_u from fx), null, (select (r ->> 'retry_at')::timestamptz - interval '1 second' from limited)) ->> 'refusal', 'rate_limited', 'a second before the lock ends it still is');
select is(pg_temp.mark((select member_u from fx), null, (select (r ->> 'retry_at')::timestamptz from limited)) ->> 'state', 'read', 'at the lock''s end marks are taken again');
select is(pg_temp.mark((select other_u from fx), null, (select t0 + interval '3 minutes' from fx)) ->> 'marked', '2', 'another customer is not held by that lock');

-- 5. Retention: 90 days ------------------------------------------------------------------------------------------------
insert into sink select app.customer_inbox_add(tenant_a, pg_temp.login(visitor_u), 'stamp', 'old:edge', '{}'::jsonb, null, null, null, t0 - interval '90 days') from fx;
insert into sink select app.customer_inbox_add(tenant_a, pg_temp.login(visitor_u), 'stamp', 'old:inside', '{}'::jsonb, null, null, null, t0 - interval '90 days' + interval '1 second') from fx;
select is((select string_agg(x.dedupe_key, ',' order by x.dedupe_key) from app.customer_inbox x
  where x.id::text in (select e ->> 'id' from jsonb_array_elements(pg_temp.inbox((select visitor_u from fx), 'all', null, (select t0 from fx)) -> 'items') e)),
  'old:inside', 'boundary: an item 90 days old is no longer shown, one a second younger is');
select is(pg_temp.call((select visitor_u from fx), format($q$select app.customer_inbox_unread(%L)$q$, (select t0 from fx))) ->> 'unread', '1', 'nor counted on the bell');
select is(app.purge_customer_inbox((select t0 - interval '1 second' from fx)), 0, 'boundary: a second before 90 days the purge deletes nothing');
select is(app.purge_customer_inbox((select t0 from fx)), 1, 'at 90 days it deletes the item');
select is((select string_agg(dedupe_key, ',') from app.customer_inbox where customer_login_id = pg_temp.login((select visitor_u from fx))), 'old:inside', 'and keeps the younger one');
select is(app.purge_customer_inbox((select t0 + interval '1 second' from fx)), 1, 'a second later the younger one goes too');
select throws_ok($$select app.purge_customer_inbox(now(), 0)$$, '22023', null, 'boundary: a purge limit of 0 is refused');
select is((select j.schedule || ' ' || j.command from cron.job j where j.jobname = 'customer-inbox-purge'), '29 * * * * select app.purge_customer_inbox(now())',
  'the hourly job customer-inbox-purge runs the purge');

-- 6. The marketing switch: who, when, which text ---------------------------------------------------------------------
select is((pg_temp.inbox((select member_u from fx), 'all', null, (select t0 from fx)) -> 'marketing'), jsonb_build_object('member', true, 'consent', false, 'weekly_cap', 2),
  'the member''s switch is off, with the weekly cap of 2');
select is((pg_temp.inbox((select visitor_u from fx), 'all', null, (select t0 from fx)) -> 'marketing'), jsonb_build_object('member', false, 'consent', false, 'weekly_cap', 2),
  'a visitor is not a member: the switch needs joining first');
create function pg_temp.start(p_user uuid, p_policy text, p_shown timestamptz, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_start_marketing(%L, 'inbox-optin-1', %L, %L)$q$, p_policy, p_shown, p_at));
$$;
select is(pg_temp.start((select visitor_u from fx), 'privacy-308-1', (select t0 from fx), (select t0 from fx)), jsonb_build_object('error', '42501'), 'a visitor cannot consent (42501)');
select is(pg_temp.start((select staff_u from fx), 'privacy-308-1', (select t0 from fx), (select t0 from fx)), jsonb_build_object('error', '42501'), 'staff cannot consent for anyone');
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '5 minutes 1 second' from fx), (select t0 from fx)), jsonb_build_object('error', '22023'),
  'boundary: a sheet shown more than 5 minutes after the answer is refused');
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 - interval '1 day 1 second' from fx), (select t0 from fx)), jsonb_build_object('error', '22023'),
  'boundary: a sheet shown more than a day before is refused');
select is(pg_temp.start((select member_u from fx), 'Privacy 1', (select t0 from fx), (select t0 from fx)), jsonb_build_object('error', '22023'), 'a malformed policy version is refused');
select is(pg_temp.start((select member_u from fx), 'privacy-308-9', (select t0 from fx), (select t0 + interval '10 seconds' from fx)) ->> 'refusal', 'policy_outdated',
  'a privacy notice version the tenant never published is refused');
select is((select count(*)::integer from public.consent_records where subject_id = (select customer_m from fx) and purpose = 'marketing'), 0, 'and nothing is recorded');
create temp table started as select pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 - interval '20 seconds' from fx), (select t0 from fx)) as r;
select is((select (r ->> 'state') || ' ' || (r ->> 'replayed') || ' ' || ((r ->> 'started_at')::timestamptz = (select t0 from fx))::text from started), 'started false true',
  'the member turns the switch on');
select is((select row(c.policy_version, c.channel, c.granted_at = (select t0 from fx), c.evidence ->> 'screen_version', (c.evidence ->> 'shown_at')::timestamptz = (select t0 - interval '20 seconds' from fx),
    c.evidence ->> 'source', c.evidence ->> 'weekly_cap', c.evidence ->> 'zalo_app_id')::text
  from public.consent_records c where c.subject_id = (select customer_m from fx) and c.purpose = 'marketing' and c.revoked_at is null),
  row('privacy-308-1', 'mini_app', true, 'inbox-optin-1', true, 'inbox_switch', '2', (select app_a from fx)::text)::text,
  'the marketing consent records who (the customer and the app), when, the notice''s version and the opt-in text''s version');
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 from fx), (select t0 + interval '1 minute' from fx)) ->> 'replayed', 'true',
  'turning it on again is a replay');
select is((select count(*)::integer from public.consent_records where subject_id = (select customer_m from fx) and purpose = 'marketing'), 1, 'with no second record');
select is((pg_temp.inbox((select member_u from fx), 'all', null, (select t0 from fx)) -> 'marketing' ->> 'consent'), 'true', 'the reader shows the switch on');
select is(pg_temp.call((select member_u from fx), 'select app.customer_stop_marketing(' || quote_literal((select t0 + interval '2 minutes' from fx)) || ')') ->> 'marketing_consent', 'false',
  '"Dừng nhận tin" (the existing stop) turns it off');
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '3 minutes' from fx), (select t0 + interval '3 minutes' from fx)) ->> 'replayed', 'false',
  'on again after a stop is a new consent');
select is((select count(*)::integer || '/' || count(*) filter (where revoked_at is null) from public.consent_records where subject_id = (select customer_m from fx) and purpose = 'marketing'),
  '2/1', 'the revoked record stays as evidence beside the new active one');
do $$
begin
  for i in 1..5 loop
    perform pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '4 minutes' from fx), (select t0 + interval '4 minutes' from fx));
  end loop;
end;
$$;
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '4 minutes' from fx), (select t0 + interval '4 minutes' from fx)) ->> 'state', 'started',
  'boundary: the 10th call in 15 minutes is taken (the policy_outdated call counted too)');
select is(pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '5 minutes' from fx), (select t0 + interval '5 minutes' from fx)) ->> 'refusal', 'rate_limited',
  'boundary: the 11th is refused rate_limited');

-- 7. The consent comes before any promotion is sent ------------------------------------------------------------------
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled) select tenant_a, true, false, true from fx;
update public.consent_records set revoked_at = (select t0 + interval '6 minutes' from fx) where subject_id = (select customer_m from fx) and purpose = 'marketing' and revoked_at is null;
select is(app.enqueue_customer_message((select tenant_a from fx), (select member_m from fx), 'win_back', 'syn-308-1', jsonb_build_object('inactive_days', 45), null, null,
  (select t0 + interval '7 minutes' from fx)), null, 'without the consent a promotion is not queued');
insert into sink select pg_temp.start((select member_u from fx), 'privacy-308-1', (select t0 + interval '20 minutes' from fx), (select t0 + interval '20 minutes' from fx));
create temp table promo as select app.enqueue_customer_message((select tenant_a from fx), (select member_m from fx), 'win_back', 'syn-308-2', jsonb_build_object('inactive_days', 45),
  null, null, (select t0 + interval '21 minutes' from fx)) as id;
select isnt((select id from promo), null, 'with it, it is queued');
update public.consent_records set revoked_at = (select t0 + interval '22 minutes' from fx) where subject_id = (select customer_m from fx) and purpose = 'marketing' and revoked_at is null;
select is((select to_jsonb(c) from app.claim_next_customer_message('pgtap-308', array['consultation', 'template'], interval '2 minutes', (select t0 + interval '23 minutes' from fx),
  (select tenant_a from fx)) c), null, 'withdrawn before the claim, it is not sent');
select is((select status || ' ' || decision from public.outbound_messages where id = (select id from promo)), 'cancelled no_marketing_consent', 'it is cancelled for want of the consent');
select is((select count(*)::integer from app.customer_inbox where kind = 'offer' and tenant_id = (select tenant_a from fx)), 0, 'and never reaches the inbox');

-- 8. The customer's copy, the deletion and the DSR (C19) ----------------------------------------------------------------
insert into sink select pg_temp.stamps((select gone_u from fx), 3, (select t0 from fx), 'g');
create temp table ex as select pg_temp.call((select gone_u from fx), format($q$select app.customer_export_data(%L)$q$, (select t0 from fx))) as j;
select is((select jsonb_array_length(j -> 'inbox') || ' ' || (j -> 'counts' ->> 'inbox') from ex), '3 3', 'the copy of the data holds the inbox and counts it');
select is((select j -> 'inbox' -> 0 ->> 'kind' from ex), 'stamp', 'each item with its kind, times and facts');
select is(pg_temp.call((select gone_u from fx), format($q$select app.customer_delete_account(true, %L)$q$, (select t0 from fx))) -> 'counts' ->> 'inbox_items', '3',
  'deleting the account counts the items');
select is((select count(*)::integer from app.customer_inbox x where x.dedupe_key like 'g:%'), 0, 'and they go with the login');
insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
select tenant_a, 'customer', customer_n, 'mini_app', 'deletion', t0 from fx;
create temp table dsr as select id from public.data_subject_requests where subject_id = (select customer_n from fx);
select is((pg_temp.call((select owner_u from fx), format($q$select public.dsr_export(%L)$q$, (select id from dsr))) -> 'counts' ->> 'inbox'), '2',
  'the owner''s DSR export holds the inbox of the customer''s Zalo logins');
select is((app.dsr_erase_customer((select id from dsr), (select owner_u from fx), (select t0 from fx)) ->> 'already_done') is distinct from 'true', true, 'the owner carries out the deletion');
select is((select count(*)::integer from app.customer_inbox x where x.dedupe_key like 'o:%'), 0, 'the erased customer''s items are gone with their login');

-- 9. Grants --------------------------------------------------------------------------------------------------------------
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (role) cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p (priv)
  where has_table_privilege(r.role, 'app.customer_inbox', p.priv)), 0, 'no API role touches the inbox table');
select ok((select relrowsecurity from pg_class where oid = 'app.customer_inbox'::regclass), 'the inbox table has row-level security');
select is((select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   cross join (values ('app.customer_inbox(text, bigint, timestamptz)'), ('app.customer_inbox_unread(timestamptz)'), ('app.customer_inbox_read(uuid[], timestamptz)'),
     ('app.customer_start_marketing(text, text, timestamptz, timestamptz)'), ('app.purge_customer_inbox(timestamptz, integer)'), ('app.customer_inbox_item_json(app.customer_inbox)'),
     ('app.customer_inbox_marketing(app.customer_logins)')) f (fn)
   where has_function_privilege(r.role, f.fn, 'execute')), 0, 'no API role runs the internal functions');
select is((select string_agg(r.role || ':' || f.fn, ', ' order by r.role, f.fn collate "C") from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   cross join (values ('public.customer_inbox(text, bigint)'), ('public.customer_inbox_unread()'), ('public.customer_inbox_read(uuid[])'),
     ('public.customer_start_marketing(text, text, timestamptz)')) f (fn)
   where has_function_privilege(r.role, f.fn, 'execute')),
  'authenticated:public.customer_inbox(text, bigint), authenticated:public.customer_inbox_read(uuid[]), authenticated:public.customer_inbox_unread(), authenticated:public.customer_start_marketing(text, text, timestamptz)',
  'the four RPCs are for authenticated sessions only, never anon or the service role');

select * from finish();
rollback;
