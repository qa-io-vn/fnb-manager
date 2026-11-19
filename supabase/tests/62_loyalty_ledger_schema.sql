begin;
select plan(55);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006201'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000006202'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000006201'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000006202'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000006201'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000006202'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000006211'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000006201'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000006202'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006203'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006204'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000006205'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000006206'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000006207'::uuid as customer_user,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006201'::uuid as customer_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006202'::uuid as customer_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006211'::uuid as customer_y,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006201'::uuid as programme_x,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006211'::uuid as programme_y,
  '99999999-9999-4999-8999-000000006201'::uuid as membership_1,
  '99999999-9999-4999-8999-000000006202'::uuid as membership_2,
  '99999999-9999-4999-8999-000000006211'::uuid as membership_y,
  '77777777-7777-4777-8777-000000006201'::uuid as invoice_1,
  '77777777-7777-4777-8777-000000006202'::uuid as invoice_2,
  '77777777-7777-4777-8777-000000006203'::uuid as invoice_3,
  '77777777-7777-4777-8777-000000006211'::uuid as invoice_y,
  '66666666-6666-4666-8666-000000006201'::uuid as earn_1,
  '66666666-6666-4666-8666-000000006202'::uuid as earn_2,
  '66666666-6666-4666-8666-000000006203'::uuid as earn_pending;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'loyalty-ledger-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_x1, fx.staff_x1, fx.viewer_x, fx.publisher_x, fx.owner_y, fx.customer_user]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'loyalty-ledger-pgtap-x', 'Loyalty ledger pgTAP X' from fx
union all
select tenant_y, 'loyalty-ledger-pgtap-y', 'Loyalty ledger pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'loyalty-ledger-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'loyalty-ledger-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_x1, tenant_x, account_x, 'll-x1', 'Synthetic store X1' from fx
union all
select store_x2, tenant_x, account_x, 'll-x2', 'Synthetic store X2' from fx
union all
select store_y1, tenant_y, account_y, 'll-y1', 'Synthetic store Y1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, fx.owner_y, 'owner', null from fx;

insert into public.customers (id, tenant_id, phone)
select customer_1, tenant_x, '+' || '84900006201' from fx
union all
select customer_2, tenant_x, '+' || '84900006202' from fx
union all
select customer_y, tenant_y, '+' || '84900006211' from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_x, tenant_x, 'Synthetic programme X', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select programme_y, tenant_y, 'Synthetic programme Y', date '2026-11-01', 'below_threshold', 'active' from fx;

insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_store_id)
select membership_1, tenant_x, programme_x, customer_1, 'mini_app', store_x1 from fx
union all
select membership_2, tenant_x, programme_x, customer_2, 'till', store_x2 from fx
union all
select membership_y, tenant_y, programme_y, customer_y, 'mini_app', store_y1 from fx;

insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, net_amount, paid_amount)
select invoice_1, tenant_x, store_x1, account_x, 'll-inv-1', '0001', timestamptz '2026-11-15 10:00+07', date '2026-11-15', 60000, 60000 from fx
union all
select invoice_2, tenant_x, store_x2, account_x, 'll-inv-2', '0001', timestamptz '2026-11-15 11:00+07', date '2026-11-15', 80000, 80000 from fx
union all
select invoice_3, tenant_x, store_x1, account_x, 'll-inv-3', '0002', timestamptz '2026-11-15 12:00+07', date '2026-11-15', 55000, 55000 from fx
union all
select invoice_y, tenant_y, store_y1, account_y, 'll-inv-y', '0001', timestamptz '2026-11-15 10:00+07', date '2026-11-15', 70000, 70000 from fx;

insert into public.loyalty_ledger (id, tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount, invoice_id, business_date, matched_path, pending, reason, occurred_at)
select earn_1, tenant_x, programme_x, membership_1, store_x1, 'earn'::public.loyalty_entry_kind, 1, 6, 3000, invoice_1, date '2026-11-15', 'A', false, null, timestamptz '2026-11-15 10:30+07' from fx
union all
select earn_2, tenant_x, programme_x, membership_2, store_x2, 'earn', 1, 8, 4000, invoice_2, date '2026-11-15', 'C', false, null, timestamptz '2026-11-15 11:30+07' from fx
union all
select earn_pending, tenant_x, programme_x, membership_1, store_x1, 'earn', 1, 5, 2500, invoice_3, date '2026-11-15', 'B', true, null, timestamptz '2026-11-15 12:30+07' from fx
union all
select gen_random_uuid(), tenant_x, programme_x, membership_1, null, 'adjust', 2, 0, 0, null, null, null, false, 'welcome', timestamptz '2026-11-14 09:00+07' from fx
union all
select gen_random_uuid(), tenant_y, programme_y, membership_y, store_y1, 'earn', 1, 7, 3500, invoice_y, date '2026-11-15', 'A', false, null, timestamptz '2026-11-15 10:30+07' from fx;

insert into public.receipt_claims (tenant_id, store_id, membership_id, business_date, receipt_no, amount, expires_at)
select tenant_x, store_x1, membership_1, date '2026-11-15', '0009', 45000, now() + interval '72 hours' from fx
union all
select tenant_x, store_x2, membership_2, date '2026-11-15', '0009', 45000, now() + interval '72 hours' from fx;

insert into public.pending_checkins (tenant_id, store_id, membership_id, code, expires_at)
select tenant_x, store_x1, membership_1, '123456', now() + interval '2 minutes' from fx
union all
select tenant_x, store_x2, membership_2, '654321', now() + interval '2 minutes' from fx;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.value_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

-- Since migration customer_claims_bound_to_login a customer session reads rows only as the customer login of an
-- active Zalo App bound to that customer, so the synthetic session gets one.
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select '44444444-4444-4444-8444-000000062091'::uuid, tenant_x, 'brand-91', 'Synthetic claims brand', array[store_x1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select '55555555-5555-4555-8555-000000062091'::uuid, tenant_x, '44444444-4444-4444-8444-000000062091'::uuid, 'synthetic-claims-app-62', 'ZALO_APP_SECRET_BRAND_91', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_x, '55555555-5555-4555-8555-000000062091'::uuid, 'syn-claims-62', customer_user, customer_1 from fx;

create function pg_temp.value_as_customer(p_user uuid, p_tenant uuid, p_customer uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', p_tenant, 'customer_id', p_customer)
  )::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

grant select on fx to authenticated, service_role;

select has_table('public', 'memberships', 'memberships exists');
select has_table('public', 'loyalty_ledger', 'loyalty_ledger exists');
select has_table('public', 'stamps', 'stamps exists');
select has_table('public', 'pending_checkins', 'pending_checkins exists');
select has_table('public', 'receipt_claims', 'receipt_claims exists');
select has_table('public', 'coupons', 'coupons exists');
select has_table('public', 'redemptions', 'redemptions exists');
select enum_has_labels('public', 'loyalty_entry_kind', array['earn', 'confirm', 'clawback', 'redeem', 'adjust', 'expire'], 'loyalty_entry_kind labels');
select hasnt_column('public', 'memberships', 'phone', 'a membership holds no phone of its own');
select hasnt_column('public', 'memberships', 'stamps', 'a membership holds no balance column');

select is(
  pg_temp.outcome(format('update public.loyalty_ledger set point_delta = 99 where id = %L', (select earn_1 from fx))),
  'P0001:loyalty_ledger is an append-only ledger: a correction is a new row that references the original',
  'the database owner cannot update a ledger row'
);
select is(
  left(pg_temp.outcome(format('delete from public.loyalty_ledger where id = %L', (select earn_1 from fx))), 5),
  'P0001',
  'the database owner cannot delete a ledger row'
);
select is(
  left(pg_temp.outcome('truncate public.loyalty_ledger cascade'), 5),
  'P0001',
  'nobody truncates the ledger'
);
set local role service_role;
select is(left(pg_temp.outcome(format('update public.loyalty_ledger set reason = %L where id = %L', 'x', (select earn_1 from fx))), 5), 'P0001', 'the service role cannot update a ledger row');
select is(left(pg_temp.outcome(format('delete from public.loyalty_ledger where id = %L', (select earn_1 from fx))), 5), 'P0001', 'the service role cannot delete a ledger row');
select is(
  left(pg_temp.outcome(format('set local app.loyalty_erasure = %L; delete from public.loyalty_ledger where id = %L', 'on', (select earn_1 from fx))), 5),
  'P0001',
  'the service role cannot open the erasure path by setting the flag itself'
);
reset role;
set local role authenticated;
select is(pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_ledger set point_delta = 0 where id = %L', (select earn_1 from fx))), '42501', 'an owner cannot update a ledger row');
select is(pg_temp.outcome_as((select owner_x from fx), format('delete from public.loyalty_ledger where id = %L', (select earn_1 from fx))), '42501', 'an owner cannot delete a ledger row');
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, reason, stamp_delta) values (%L, %L, %L, %L, %L, 5)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), 'adjust', 'gift')),
  '42501',
  'an owner cannot write the ledger directly'
);
reset role;

select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, matched_path) values (%L, %L, %L, %L, %L, 1, %L)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), (select store_x1 from fx), 'earn', 'A')), 5),
  '23514',
  'an earn without an invoice is refused'
);
select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, invoice_id, matched_path) values (%L, %L, %L, %L, %L, 1, %L, %L)', (select tenant_x from fx), (select programme_x from fx), (select membership_2 from fx), (select store_x1 from fx), 'earn', (select invoice_1 from fx), 'C')), 5),
  '23505',
  'a second earn for the same invoice is refused'
);
select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, invoice_id, matched_path) values (%L, %L, %L, %L, %L, -1, %L, %L)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), (select store_x1 from fx), 'earn', (select invoice_2 from fx), 'A')), 5),
  '23514',
  'an earn never takes stamps away'
);
select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta) values (%L, %L, %L, %L, 1)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), 'adjust')), 5),
  '23514',
  'an adjustment states its reason'
);
select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, invoice_id, reason) values (%L, %L, %L, %L, -1, %L, %L)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), 'clawback', (select invoice_1 from fx), 'voided')), 5),
  '23514',
  'a clawback names the row it reverses'
);
select is(
  left(pg_temp.outcome(format('insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, reason) values (%L, %L, %L, %L, %L, %L)', (select tenant_x from fx), (select programme_x from fx), (select membership_1 from fx), (select store_y1 from fx), 'adjust', 'cross-tenant')), 5),
  '23503',
  'a ledger row never names another tenant''s store or invoice'
);

set local role authenticated;
select is(pg_temp.value_as((select owner_x from fx), 'select count(*) from public.loyalty_ledger'), '4', 'an owner reads every ledger row of the tenant');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.loyalty_ledger'), '3', 'a store-limited manager reads the rows of their store and the rows without a store');
select is(pg_temp.value_as((select viewer_x from fx), 'select count(*) from public.loyalty_ledger'), '4', 'a viewer reads the tenant''s rows');
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.loyalty_ledger'), '0', 'staff read no ledger row directly');
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.memberships'), '0', 'staff read no membership directly');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.loyalty_ledger'), '0', 'the publisher reads no ledger row');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.memberships'), '0', 'the publisher reads no membership');
select is(pg_temp.value_as((select owner_y from fx), format('select count(*) from public.loyalty_ledger where tenant_id = %L', (select tenant_x from fx))), '0', 'another tenant reads no ledger row');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.receipt_claims'), '1', 'a store-limited manager reads the claims of their store');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.pending_checkins'), '1', 'and the check-ins of their store');
select is(pg_temp.value_as((select owner_x from fx), 'select count(*) from public.memberships'), '2', 'an owner reads the tenant''s memberships');

select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.memberships'),
  '1',
  'a customer session reads only its own membership'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) || '':'' || sum(point_delta) from public.loyalty_ledger'),
  '3:11',
  'a customer session reads only its own ledger rows'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.receipt_claims'),
  '1',
  'a customer session reads only its own claims'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.pending_checkins'),
  '1',
  'a customer session reads only its own check-ins'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.customers'),
  '1',
  'a customer session reads its own customer row'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.invoices'),
  '0',
  'a customer session reads no invoice'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx),
    format('select concat_ws(%L, stamps, points, pending_stamps, pending_points, stamps_on_card, points_value_amount) from public.loyalty_balance(%L)', ':', (select membership_1 from fx))),
  '3:6:1:5:3:3000.00',
  'a customer reads its balance: the welcome and the confirmed earn spendable, the pending earn apart'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx),
    format('select count(*) from public.loyalty_balance(%L)', (select membership_2 from fx))),
  '0',
  'a customer gets no balance of another membership'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_y from fx), (select customer_1 from fx), 'select count(*) from public.loyalty_ledger'),
  '0',
  'a customer claim with the wrong tenant reads nothing'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_1 from fx), 'select count(*) from public.coupon_codes'),
  '0',
  'a customer session reads no pool code'
);
reset role;

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, source_entry_id, occurred_at)
select tenant_x, programme_x, membership_1, store_x1, 'confirm', invoice_3, earn_pending, timestamptz '2026-11-15 13:00+07' from fx;
select is(
  (select concat_ws(':', stamps, points, pending_stamps, pending_points) from app.loyalty_balance((select membership_1 from fx))),
  '4:11:0:0',
  'a confirm row moves the pending earn into the spendable balance'
);
select is(
  (select concat_ws(':', stamps, points) from app.loyalty_balance((select membership_1 from fx), timestamptz '2026-11-15 11:00+07')),
  '3:6',
  'a balance as of a moment counts the rows up to it'
);

set local role service_role;
select is(
  (select app.erase_loyalty_membership((select membership_2 from fx)) ->> 'loyalty_ledger'),
  '1',
  'the data-subject deletion removes the membership''s ledger rows'
);
reset role;
select is((select count(*)::int from public.memberships where id = (select membership_2 from fx)), 0, 'and the membership');
select is((select count(*)::int from public.receipt_claims where membership_id = (select membership_2 from fx)), 0, 'and its claims');
select is(current_setting('app.loyalty_erasure', true), 'off', 'the erasure flag is closed again');

select is(pg_temp.outcome(format('delete from public.tenants where id = %L', (select tenant_y from fx))), 'rows:1', 'deleting a tenant removes its ledger with it');

set local role anon;
select throws_ok('select count(*) from public.loyalty_ledger', '42501', null, 'anon reads no ledger row');
select throws_ok('select count(*) from public.memberships', '42501', null, 'anon reads no membership');
reset role;

select * from finish();
rollback;
