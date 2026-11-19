begin;
select plan(44);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009501'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000009501'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000009501'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000009502'::uuid as store_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000009501'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000009502'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000009503'::uuid as customer_c,
  '99999999-9999-4999-8999-000000009501'::uuid as member_a,
  '99999999-9999-4999-8999-000000009502'::uuid as member_b,
  '99999999-9999-4999-8999-000000009503'::uuid as member_c,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000009501'::uuid as programme_m;

insert into public.tenants (id, slug, name, country_code)
select tenant_m, 'voucher-callback-pgtap', 'Voucher callback pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_m, tenant_m, 'mock', 'voucher-callback-m', 'Synthetic account M' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_m, account_m, 'vc-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_m, account_m, 'vc-2', 'Synthetic store 2' from fx;

insert into public.customers (id, tenant_id, phone)
select customer_a, tenant_m, '+' || '849000' || '09501' from fx
union all
select customer_b, tenant_m, '+' || '849000' || '09502' from fx
union all
select customer_c, tenant_m, '+' || '849000' || '09503' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_m, tenant_m, 'Synthetic programme M', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at)
select v.member, fx.tenant_m, fx.programme_m, v.customer, 'mini_app', now() - interval '10 days'
from fx
cross join lateral (values (fx.member_a, fx.customer_a), (fx.member_b, fx.customer_b), (fx.member_c, fx.customer_c)) as v (member, customer);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
select fx.tenant_m, fx.programme_m, v.member, 'adjust', 0, 1000, 0, 'synthetic credit', now() + interval '30 days', now() - interval '5 days'
from fx
cross join lateral (values (fx.member_a), (fx.member_b), (fx.member_c)) as v (member);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, callback_ip_allowlist, active_from, callback_store_ref, callback_enabled)
select tenant_m, store_1, 'crm_callback'::public.coupon_rail, '{PRG-1}'::text[], '{}'::cidr[], now() - interval '30 days', 'POS-1', true from fx
union all
select tenant_m, store_2, 'crm_callback', '{}', '{198.51.100.0/24}', now() - interval '30 days', 'POS-2', true from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select fx.tenant_m, s.store, k.reward_key, 'PRG-1', 'discount'::public.einvoice_display
from fx
cross join lateral (values (fx.store_1), (fx.store_2)) as s (store)
cross join lateral (values ('ten-pct'), ('amount-20k'), ('free-f')) as k (reward_key);

select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, reward_amount, reward_item_external_ids, excluded_item_external_ids, min_bill_amount, cost_points, status)
select tenant_m, programme_m, 'ten-pct', 'Giảm 10%', 'percent_off'::public.coupon_reward_kind, 10, null, null::text[], '{ITEM-X}'::text[], 0, 10, 'active'::public.coupon_status from fx
union all
select tenant_m, programme_m, 'amount-20k', 'Giảm 20.000đ', 'amount_off', null, 20000, null, '{}', 50000, 10, 'active' from fx
union all
select tenant_m, programme_m, 'free-f', 'Tặng một ly', 'free_item', null, null, '{ITEM-F}', '{}', 0, 10, 'active' from fx;

create temp table held (name text primary key, redemption_id uuid, code text);
create temp table secret (segment text, path_sha256 text);

create function pg_temp.hold(p_name text, p_member uuid, p_reward text, p_store uuid, p_at timestamptz)
returns text
language sql
as $$
  with answer as (
    select app.redeem_coupon(p_member, (select id from public.coupons where reward_key = p_reward and tenant_id = (select tenant_m from fx)), p_store, p_at) as a
  )
  insert into held (name, redemption_id, code)
  select p_name, (a ->> 'redemption_id')::uuid, a ->> 'code' from answer
  returning coalesce(code, 'refused');
$$;

create function pg_temp.call(
  p_code text,
  p_sale text,
  p_lines jsonb,
  p_store_ref text default 'POS-1',
  p_ip inet default '203.0.113.5',
  p_phone text default null,
  p_programme text default 'PRG-1',
  p_path text default null
)
returns jsonb
language sql
as $$
  select app.answer_voucher_callback(
    coalesce(p_path, (select path_sha256 from secret)), p_ip, p_store_ref, p_programme, p_code, p_sale, p_phone, p_lines, clock_timestamp(), now()
  );
$$;

create function pg_temp.code(p_name text)
returns text
language sql
as $$
  select code from held where name = p_name;
$$;

create function pg_temp.logged()
returns integer
language sql
as $$
  select count(*)::integer from app.voucher_callback_log where tenant_id = (select tenant_m from fx);
$$;

insert into secret (segment)
select app.issue_voucher_callback_path(tenant_m, 'pos-crm') from fx;
update secret set path_sha256 = encode(sha256(convert_to(segment, 'UTF8')), 'hex');

select matches((select segment from secret), '^[A-Za-z0-9_-]{43}$', 'a callback path segment is 43 base64url characters');
select is(
  (select count(*)::integer from app.voucher_callback_paths k, secret s where k.path_sha256 = s.path_sha256 and k.revoked_at is null),
  1,
  'only the SHA-256 of the segment is kept'
);
select is(
  (select count(*)::integer from app.voucher_callback_paths k, secret s where k.path_sha256 = s.segment or k.label = s.segment),
  0,
  'the segment itself is not stored'
);

select is(pg_temp.hold('a_pct', (select member_a from fx), 'ten-pct', (select store_1 from fx), now() - interval '1 hour') ~ '^[A-Z0-9]{8}$', true, 'a reward redeemed on the callback rail gets an 8-character code');
select pg_temp.hold('b_pct_store_2', (select member_b from fx), 'ten-pct', (select store_2 from fx), now() - interval '1 hour');
select pg_temp.hold('b_amount', (select member_b from fx), 'amount-20k', (select store_1 from fx), now() - interval '1 hour');
select pg_temp.hold('c_free', (select member_c from fx), 'free-f', (select store_1 from fx), now() - interval '1 hour');
select pg_temp.hold('a_amount_old', (select member_a from fx), 'amount-20k', (select store_1 from fx), now() - interval '48 hours');

select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]', p_path => repeat('0', 64)) ->> 'outcome',
  'unknown_path',
  'an unknown path segment answers unknown_path'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 0, "amount": 60000}]') ->> 'outcome',
  'malformed',
  'a line without a positive quantity is malformed'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 1, "amount": 2000000000}]') ->> 'outcome',
  'malformed',
  'a line above the amount range is malformed'
);
select is(
  pg_temp.call(pg_temp.code('b_pct_store_2'), 'SALE-9', '[{"item": "ITEM-A", "quantity": 1, "amount": 60000}]', p_store_ref => 'POS-2', p_ip => '203.0.113.5') ->> 'outcome',
  'refused_address',
  'an address outside the store''s allow-list is refused'
);
select is(pg_temp.logged(), 0, 'a wrong path, a malformed body and a refused address write no log row');
select is(
  (select count(*)::integer from app.voucher_callback_answers where tenant_id = (select tenant_m from fx)),
  0,
  'and no answer'
);

select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]', p_store_ref => 'POS-404', p_ip => '198.51.100.7') ->> 'outcome',
  'unknown_store',
  'a store reference no callback rail carries answers unknown_store'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]', p_programme => 'PRG-9') ->> 'outcome',
  'wrong_programme',
  'a programme outside the rail''s CRM programmes answers wrong_programme'
);
select is(
  pg_temp.call('NOPE2345', 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]') ->> 'outcome',
  'unknown_code',
  'a code without a redemption answers unknown_code'
);

select is(
  pg_temp.call(lower(pg_temp.code('a_pct')), 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}, {"item": "ITEM-X", "quantity": 1, "amount": 40000}]'),
  '{"outcome": "accepted", "discount_amount": 6000, "reward_name": "Giảm 10%"}'::jsonb,
  'a valid code gets 10 % of the eligible lines, the excluded item left out'
);
select is(
  (select verified_at is not null from public.redemptions where id = (select redemption_id from held where name = 'a_pct')),
  true,
  'an accepted answer marks the redemption verified'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 10, "amount": 300000}]'),
  '{"outcome": "replayed", "discount_amount": 6000, "reward_name": "Giảm 10%"}'::jsonb,
  'a replay of the same sale gets the first answer, whatever lines it posts'
);
select is(
  (select replays from app.voucher_callback_answers where redemption_id = (select redemption_id from held where name = 'a_pct')),
  1,
  'the replay is counted'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-2', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]'),
  '{"outcome": "used", "discount_amount": 0, "reward_name": null}'::jsonb,
  'the used code under another sale gets 0'
);
select is(
  pg_temp.call(pg_temp.code('b_pct_store_2'), 'SALE-3', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]') ->> 'outcome',
  'wrong_store',
  'a code held for another store answers wrong_store'
);

select is(
  pg_temp.call(pg_temp.code('b_amount'), 'SALE-4', '[{"item": "ITEM-A", "quantity": 1, "amount": 40000}]') ->> 'outcome',
  'below_minimum',
  'a bill under the reward''s minimum answers below_minimum'
);
select is(
  pg_temp.call(pg_temp.code('b_amount'), 'SALE-4', '[{"item": "ITEM-A", "quantity": 1, "amount": 40000}, {"item": "ITEM-B", "quantity": 1, "amount": 60000}]'),
  '{"outcome": "accepted", "discount_amount": 20000, "reward_name": "Giảm 20.000đ"}'::jsonb,
  'a refusal binds nothing: the same sale with a larger bill gets the amount off'
);

select is(
  pg_temp.call(pg_temp.code('c_free'), 'SALE-5', '[{"item": "ITEM-F", "quantity": 2, "amount": 50000}]', p_phone => '0900' || '009501') ->> 'outcome',
  'wrong_member',
  'another member''s phone on the bill answers wrong_member'
);
select is(
  pg_temp.call(pg_temp.code('c_free'), 'SALE-5', '[{"item": "ITEM-A", "quantity": 1, "amount": 50000}]', p_phone => '0900' || '009503') ->> 'outcome',
  'not_applicable',
  'a gift whose item is not on the bill answers not_applicable'
);
select is(
  pg_temp.call(pg_temp.code('c_free'), 'SALE-5', '[{"item": "ITEM-F", "quantity": 2, "amount": 50000}, {"item": "ITEM-A", "quantity": 1, "amount": 30000}]', p_phone => '0900' || '009503'),
  '{"outcome": "accepted", "discount_amount": 25000, "reward_name": "Tặng một ly"}'::jsonb,
  'a gift with the owner''s phone in local form gets one unit of the reward item'
);
select is(
  pg_temp.call(pg_temp.code('a_amount_old'), 'SALE-6', '[{"item": "ITEM-A", "quantity": 2, "amount": 100000}]') ->> 'outcome',
  'expired',
  'a code whose hold has ended answers expired'
);

select is(
  (select count(*)::integer from app.voucher_callback_log l where l.tenant_id = (select tenant_m from fx)),
  13,
  'every decided call wrote one log row'
);
select is(
  (select string_agg(outcome || ':' || discount_amount::text, ',' order by id) from app.voucher_callback_log l where l.tenant_id = (select tenant_m from fx)),
  'unknown_store:0,wrong_programme:0,unknown_code:0,accepted:6000,replayed:6000,used:0,wrong_store:0,below_minimum:0,accepted:20000,wrong_member:0,not_applicable:0,accepted:25000,expired:0',
  'the log holds the outcomes and discounts'
);
select is(
  (
    select count(*)::integer
    from app.voucher_callback_log l
    cross join held h
    where l.tenant_id = (select tenant_m from fx)
      and (to_jsonb(l)::text ilike '%' || h.code || '%' or to_jsonb(l)::text ilike '%SALE-%' or to_jsonb(l)::text like '%900009501%')
  ),
  0,
  'no log row carries a code, a sale reference or a phone'
);
select is(
  (select count(*)::integer from app.voucher_callback_log l where l.tenant_id = (select tenant_m from fx) and (l.latency_ms is null or l.store_id is null)),
  1,
  'every row has its latency, and only the unknown store has no store'
);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, item_discount_amount, net_amount, paid_amount)
select tenant_m, store_1, account_m, 'SALE-1', now() - interval '30 minutes', app.store_business_date(store_1, now() - interval '30 minutes'), 100000, 6000, 94000, 94000 from fx;
select is(
  (
    app.reconcile_loyalty(
      (select tenant_m from fx),
      app.store_business_date((select store_1 from fx), now()) - 1,
      app.store_business_date((select store_1 from fx), now()),
      now()
    ) -> 'callback_confirmed'
  )::integer,
  1,
  'the synced invoice of the answered sale confirms the redemption without a voucher code'
);
select is(
  (select state::text from public.redemptions where id = (select redemption_id from held where name = 'a_pct')),
  'confirmed',
  'the redemption is confirmed'
);
select is(
  pg_temp.call(pg_temp.code('a_pct'), 'SALE-1', '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]') ->> 'outcome',
  'replayed',
  'after the confirmation the answered sale still gets its answer'
);

select throws_ok(
  format('update public.coupon_rails set callback_store_ref = %L where store_id = %L and active_until is null', 'POS-1', (select store_2 from fx)),
  '23505',
  null,
  'two active callback rails of a tenant never share a store reference'
);
select throws_ok(
  format('insert into public.coupon_rails (tenant_id, store_id, rail, callback_store_ref) values (%L, %L, %L, %L)', (select tenant_m from fx), (select store_2 from fx), 'pos_payment_discount', 'POS-7'),
  '23514',
  null,
  'only a crm_callback rail carries a callback store reference'
);

update public.coupon_rails set callback_enabled = false where store_id = (select store_1 from fx) and active_until is null;
select is(
  pg_temp.call(pg_temp.code('b_amount'), 'SALE-8', '[{"item": "ITEM-A", "quantity": 1, "amount": 100000}]'),
  '{"outcome": "disabled", "discount_amount": 0, "reward_name": null}'::jsonb,
  'a store whose callback is switched off answers disabled'
);
select is(
  (select outcome from app.voucher_callback_log where tenant_id = (select tenant_m from fx) order by id desc limit 1),
  'disabled',
  'and the call is logged'
);
select throws_ok(
  format('insert into public.coupon_rails (tenant_id, store_id, rail, callback_enabled) values (%L, %L, %L, true)', (select tenant_m from fx), (select store_2 from fx), 'crm_code_pool'),
  '23514',
  null,
  'only a crm_callback rail switches the callback on'
);
update public.coupon_rails set callback_enabled = true where store_id = (select store_1 from fx) and active_until is null;

select is(app.revoke_voucher_callback_path((select tenant_m from fx), 'pos-crm'), 1, 'the live path of a label is revoked');
select is(
  pg_temp.call(pg_temp.code('b_amount'), 'SALE-4', '[{"item": "ITEM-A", "quantity": 1, "amount": 100000}]') ->> 'outcome',
  'unknown_path',
  'a revoked path answers like an unknown one'
);

select ok(has_function_privilege('service_role', 'app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz)', 'execute'), 'the service role decides callbacks');
select ok(not has_function_privilege('authenticated', 'app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz)', 'execute'), 'a signed-in user does not');
select ok(not has_function_privilege('anon', 'app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz)', 'execute'), 'nor does anon');
select ok(not has_function_privilege('authenticated', 'app.issue_voucher_callback_path(uuid, text)', 'execute'), 'a signed-in user issues no callback path');
select ok(
  not has_table_privilege('authenticated', 'app.voucher_callback_log', 'select')
    and not has_table_privilege('service_role', 'app.voucher_callback_answers', 'select')
    and not has_table_privilege('service_role', 'app.voucher_callback_paths', 'select'),
  'no API role reads the callback tables'
);

select * from finish();
rollback;
