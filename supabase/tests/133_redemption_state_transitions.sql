-- ISTQB state transition testing of a redemption, with SQL as the unit under
-- test. States: held (with or without the staff verification), confirmed,
-- released. Valid transitions: (start) -> held by app.redeem_coupon;
-- held -> held+verified by app.staff_verify_redemption; held -> confirmed by
-- app.confirm_redemption or, after the hold, by app.release_redemption_holds
-- when the invoice is synced; held -> released by app.release_redemption or by
-- app.release_redemption_holds after the hold. Invalid transitions are tried
-- from every end state and must change nothing. The state 'cancelled' exists
-- in the enum but no function writes it (checked below).
begin;
select plan(34);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013301'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000013301'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000013301'::uuid as store_discount,
  'ffffffff-ffff-4fff-8fff-000000013302'::uuid as store_pool,
  'eeeeeeee-eeee-4eee-8eee-000000013301'::uuid as staff_r,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000013301'::uuid as programme_r,
  date_trunc('minute', now()) - interval '2 days' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select staff_r, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'redemption-states-3301@example.com' from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_r, 'redemption-states-pgtap', 'Redemption states pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_r, tenant_r, 'mock', 'redemption-states', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_discount, tenant_r, account_r, 'rs-1', 'Synthetic store 1' from fx
union all
select store_pool, tenant_r, account_r, 'rs-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_r, staff_r, 'staff'::public.tenant_role, array[store_discount, store_pool] from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_r, tenant_r, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members as
select n, gen_random_uuid() as customer_id, gen_random_uuid() as membership_id from generate_series(1, 7) n;
insert into public.customers (id, tenant_id, phone)
select m.customer_id, fx.tenant_r, '+84900000' || (600 + m.n)::text from members m cross join fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at)
select m.membership_id, fx.tenant_r, fx.programme_r, m.customer_id, 'mini_app', fx.t0 - interval '10 days' from members m cross join fx;

create temp table credits as
with inserted as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select fx.tenant_r, fx.programme_r, m.membership_id, 'adjust', 16, 0, 0, 'synthetic credit', fx.t0 + interval '90 days', fx.t0 - interval '5 days'
  from members m cross join fx
  returning id, membership_id, stamp_delta
)
select * from inserted;
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select (select tenant_r from fx), c.membership_id, c.id, (select t0 from fx) - interval '5 days', (select t0 from fx) + interval '90 days'
from credits c cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_r, store_discount, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], t0 - interval '30 days' from fx
union all
select tenant_r, store_pool, 'crm_code_pool', '{pool-rs}', t0 - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_r, store_discount, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx
union all
select tenant_r, store_pool, 'free-drink', null, 'pool-rs', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_r, store_pool, 'free-drink', 'SYN-RS' || n from fx cross join generate_series(1, 3) n;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, status)
select tenant_r, programme_r, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 8, 0, null::uuid[], 'active'::public.coupon_status from fx;

create temp table held (name text primary key, redemption_id uuid, code text, hold_expires_at timestamptz);

create function pg_temp.member(p_n integer) returns uuid language sql as $$ select membership_id from members where n = p_n; $$;

create function pg_temp.hold(p_name text, p_member integer, p_store uuid, p_at timestamptz)
returns text
language sql
as $$
  with answer as (
    select app.redeem_coupon(pg_temp.member(p_member), (select id from public.coupons where tenant_id = (select tenant_r from fx)), p_store, p_at) as a
  )
  insert into held (name, redemption_id, code, hold_expires_at)
  select p_name, (a ->> 'redemption_id')::uuid, a ->> 'code', (a ->> 'hold_expires_at')::timestamptz from answer
  returning coalesce((select a ->> 'state' from answer), 'refused');
$$;

create function pg_temp.state(p_name text)
returns text
language sql
as $$
  select concat_ws(':', r.state, r.verified_at is not null) from public.redemptions r where r.id = (select redemption_id from held where name = p_name);
$$;

create function pg_temp.verify(p_name text, p_at timestamptz, p_store uuid default null)
returns text
language plpgsql
as $$
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select staff_r from fx), 'role', 'authenticated')::text, true);
  v_answer := app.staff_verify_redemption(coalesce(p_store, (select store_discount from fx)), (select code from held where name = p_name), p_at);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_answer ->> 'refusal', v_answer ->> 'state');
end;
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_discount_name text, p_voucher text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, voucher_code, voucher_amount, net_amount, paid_amount)
  select fx.tenant_r, p_store, fx.account_r, 'rs-' || p_name, p_sold, app.store_business_date(p_store, p_sold), 80000, p_discount_name,
    case when p_discount_name is null then 0 else 30000 end, p_voucher, case when p_voucher is null then 0 else 30000 end, 50000, 50000
  from fx
  returning id;
$$;

create function pg_temp.spendable(p_member integer)
returns integer
language sql
as $$
  select b.stamps from app.loyalty_balance(pg_temp.member(p_member), null) b;
$$;

-- (start) -> held
select is(pg_temp.hold('r1', 1, (select store_discount from fx), (select t0 from fx)), 'held', 'state transition (start) -> held: the member redeems at the till''s store');
select is(pg_temp.state('r1'), 'held:f', 'the new redemption is held and not verified');
select is(
  (select concat_ws(':', l.entry_kind, l.pending, l.stamp_delta) from public.loyalty_ledger l join public.redemptions r on r.redeem_entry_id = l.id where r.id = (select redemption_id from held where name = 'r1')),
  'redeem:t:-8',
  'the hold is a pending redeem row of the reward''s 8 stamps'
);
select is(pg_temp.spendable(1), 8, 'the held stamps leave the spendable balance at once');
select is(pg_temp.hold('r1_twice', 1, (select store_discount from fx), (select t0 from fx) + interval '1 minute'), 'refused', 'invalid transition held -> held: a second hold of the same reward is refused already_held');

-- held -> held (verified)
select is(pg_temp.verify('r1', (select t0 from fx) + interval '2 minutes'), 'verified', 'state transition held -> held+verified: staff verify the code at the store');
select is(pg_temp.state('r1'), 'held:t', 'the redemption stays held, now verified, until its invoice is synced');

-- held -> confirmed
select isnt(
  app.confirm_redemption((select redemption_id from held where name = 'r1'),
    pg_temp.invoice('r1', (select store_discount from fx), (select t0 from fx) + interval '5 minutes', 'Synthetic free drink', null),
    (select t0 from fx) + interval '10 minutes'),
  null,
  'state transition held -> confirmed: the synced invoice confirms the redemption'
);
select is(pg_temp.state('r1'), 'confirmed:t', 'the redemption is confirmed');
select is(
  (select count(*)::integer from public.loyalty_ledger c join public.redemptions r on r.redeem_entry_id = c.source_entry_id where c.entry_kind = 'confirm' and r.id = (select redemption_id from held where name = 'r1')),
  1,
  'and its redeem row has its confirm row'
);

-- invalid transitions from confirmed
select is(app.release_redemption((select redemption_id from held where name = 'r1'), 'hold_expired', (select t0 from fx) + interval '2 days'), null, 'invalid transition confirmed -> released: the release does nothing');
select is(app.confirm_redemption((select redemption_id from held where name = 'r1'), pg_temp.invoice('r1_again', (select store_discount from fx), (select t0 from fx) + interval '20 minutes', 'Synthetic free drink', null), (select t0 from fx) + interval '25 minutes'), null,
  'invalid transition confirmed -> confirmed: a second invoice confirms nothing');
select is(pg_temp.verify('r1', (select t0 from fx) + interval '30 minutes'), 'used', 'invalid transition confirmed -> verified: staff are told the code was used');
select is(pg_temp.state('r1'), 'confirmed:t', 'the confirmed redemption is unchanged');

-- held -> released
select is(pg_temp.hold('r2', 2, (select store_discount from fx), (select t0 from fx)), 'held', 'a second member holds the reward');
select isnt(app.release_redemption((select redemption_id from held where name = 'r2'), 'hold_expired', (select t0 from fx) + interval '1 day'), null,
  'state transition held -> released: the release writes its adjust row');
select is(pg_temp.state('r2'), 'released:f', 'the redemption is released');
select is(pg_temp.spendable(2), 16, 'the stamps are given back');
select is(
  (select count(*)::integer from public.stamps s where s.membership_id = pg_temp.member(2) and s.state = 'active'),
  16,
  'and the stamps the hold closed are active again'
);

-- invalid transitions from released
select is(app.release_redemption((select redemption_id from held where name = 'r2'), 'hold_expired', (select t0 from fx) + interval '1 day 1 minute'), null, 'invalid transition released -> released: nothing is given back twice');
select is(
  (select count(*)::integer from public.loyalty_ledger where membership_id = pg_temp.member(2) and reason = 'redemption_released'),
  1,
  'one redemption_released row only'
);
select is(app.confirm_redemption((select redemption_id from held where name = 'r2'), pg_temp.invoice('r2_late', (select store_discount from fx), (select t0 from fx) + interval '1 day 2 minutes', 'Synthetic free drink', null), (select t0 from fx) + interval '1 day 3 minutes'), null,
  'invalid transition released -> confirmed: a late invoice confirms nothing');
select is(pg_temp.verify('r2', (select t0 from fx) + interval '1 day 5 minutes'), 'released', 'invalid transition released -> verified: staff are told the code was given back');
select is(pg_temp.state('r2'), 'released:f', 'the released redemption is unchanged');

-- held -> released by the nightly release, at the end of the hold
select pg_temp.hold('r3', 3, (select store_discount from fx), (select t0 from fx));
select is(
  app.release_redemption_holds((select tenant_r from fx), (select hold_expires_at from held where name = 'r3') - interval '1 second') ->> 'released_holds',
  '0',
  'held -> held: one second before the hold ends the nightly release leaves it held'
);
select is(pg_temp.verify('r3', (select hold_expires_at from held where name = 'r3') + interval '1 minute'), 'expired', 'invalid transition expired hold -> verified: staff are told the hold ended');
select is(
  app.release_redemption_holds((select tenant_r from fx), (select hold_expires_at from held where name = 'r3')) ->> 'released_holds',
  '1',
  'state transition held -> released: at the end of the hold the nightly release gives it back'
);
select is(pg_temp.state('r3'), 'released:f', 'the redemption is released by the nightly step');

-- the pool code follows the redemption: assigned while held, used when confirmed, quarantined when released
select is(pg_temp.hold('r4', 4, (select store_pool from fx), (select t0 from fx)), 'held', 'a member holds the reward at the code-pool store');
select is(
  (select concat_ws(':', k.state, upper(k.code) = upper(h.code)) from public.coupon_codes k join public.redemptions r on r.coupon_code_id = k.id join held h on h.redemption_id = r.id where h.name = 'r4'),
  'assigned:t',
  'the hold carries an assigned pool code'
);
select isnt(app.confirm_redemption((select redemption_id from held where name = 'r4'),
    pg_temp.invoice('r4', (select store_pool from fx), (select t0 from fx) + interval '30 minutes', null, lower((select code from held where name = 'r4'))),
    (select t0 from fx) + interval '40 minutes'), null,
  'state transition held -> confirmed on the code rail');
select is(
  (select k.state::text from public.coupon_codes k join public.redemptions r on r.coupon_code_id = k.id join held h on h.redemption_id = r.id where h.name = 'r4'),
  'used',
  'and its pool code is used'
);

-- held -> confirmed by the nightly release when the invoice was synced late (late_confirmed_holds)
select pg_temp.hold('r5', 5, (select store_pool from fx), (select t0 from fx));
select pg_temp.invoice('r5', (select store_pool from fx), (select t0 from fx) + interval '1 hour', null, (select code from held where name = 'r5'));
select is(
  app.release_redemption_holds((select tenant_r from fx), (select hold_expires_at from held where name = 'r5') + interval '1 minute') ->> 'late_confirmed_holds',
  '1',
  'state transition held -> confirmed at the end of the hold: an invoice synced late confirms instead of releasing'
);

select is(
  (select count(*)::integer from public.redemptions where tenant_id = (select tenant_r from fx) and state = 'cancelled'),
  0,
  'no transition reaches cancelled: the enum value is unused by every function'
);

select * from finish();
rollback;
