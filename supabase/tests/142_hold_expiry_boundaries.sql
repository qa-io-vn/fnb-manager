-- ISTQB boundary value analysis on the end of a redemption hold (G-20), with SQL
-- as the unit under test. The clock is fixed through the functions' own time
-- argument: app.staff_verify_redemption(store, code, at) and
-- app.answer_voucher_callback(..., received_at, at). Values: the hold's end
-- minus one second (valid), at the end (expired) and plus one second (expired).
-- The same boundary is also tried on the reward's last valid day.
begin;
select plan(16);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000014201'::uuid as tenant_h,
  'cccccccc-cccc-4ccc-8ccc-000000014201'::uuid as account_h,
  'ffffffff-ffff-4fff-8fff-000000014201'::uuid as store_cb,
  'ffffffff-ffff-4fff-8fff-000000014202'::uuid as store_fb,
  'eeeeeeee-eeee-4eee-8eee-000000014201'::uuid as staff_h,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000014201'::uuid as programme_h,
  date_trunc('minute', now()) - interval '3 days' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select staff_h, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'hold-edge-4201@example.com' from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_h, 'hold-edge-pgtap', 'Hold expiry boundaries pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_h, tenant_h, 'mock', 'hold-edge', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_cb, tenant_h, account_h, 'he-1', 'Synthetic store 1' from fx
union all
select store_fb, tenant_h, account_h, 'he-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_h, staff_h, 'staff'::public.tenant_role, array[store_cb, store_fb] from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_h, tenant_h, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members as
select n, app.loyalty_join(fx.tenant_h, app.loyalty_customer_for_phone(fx.tenant_h, '0900000' || (900 + n)::text, fx.t0 - interval '10 days'), 'mini_app', fx.store_cb, null, null, fx.t0 - interval '10 days') as membership_id
from fx cross join generate_series(1, 6) n;

create temp table credits as
with inserted as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select fx.tenant_h, fx.programme_h, m.membership_id, 'adjust', 16, 1000, 0, 'synthetic credit', fx.t0 + interval '90 days', fx.t0 - interval '5 days'
  from members m cross join fx
  returning id, membership_id, stamp_delta
)
select * from inserted;
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select (select tenant_h from fx), c.membership_id, c.id, (select t0 from fx) - interval '5 days', (select t0 from fx) + interval '90 days'
from credits c cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, callback_ip_allowlist, active_from, callback_store_ref, callback_enabled)
select tenant_h, store_cb, 'crm_callback'::public.coupon_rail, '{PRG-1}'::text[], '{}'::cidr[], t0 - interval '30 days', 'POS-1', true from fx
union all
select tenant_h, store_fb, 'pos_payment_discount', '{}', '{}', t0 - interval '30 days', null, false from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_h, store_cb, 'ten-pct', null, 'PRG-1', 'discount'::public.einvoice_display from fx
union all
select tenant_h, store_fb, 'free-drink', 'Synthetic free drink', null, 'discount' from fx;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, reward_item_external_ids, excluded_item_external_ids, min_bill_amount, cost_stamps, cost_points, store_ids, status)
select tenant_h, programme_h, 'ten-pct', 'Giảm 10%', 'percent_off'::public.coupon_reward_kind, 10, null::text[], '{}'::text[], 0, 0, 10, array[store_cb], 'active'::public.coupon_status from fx
union all
select tenant_h, programme_h, 'free-drink', 'Free drink', 'free_item', null, null, '{}', 0, 8, 0, array[store_fb], 'active' from fx;

create temp table held (name text primary key, redemption_id uuid, code text, hold_expires_at timestamptz);
create temp table secret (segment text, path_sha256 text);
insert into secret (segment) select app.issue_voucher_callback_path(tenant_h, 'pos-crm') from fx;
update secret set path_sha256 = encode(sha256(convert_to(segment, 'UTF8')), 'hex');

create function pg_temp.member(p_n integer) returns uuid language sql as $$ select membership_id from members where n = p_n; $$;

create function pg_temp.hold(p_name text, p_member integer, p_reward text, p_store uuid, p_at timestamptz)
returns text
language sql
as $$
  with answer as (
    select app.redeem_coupon(pg_temp.member(p_member), (select id from public.coupons where tenant_id = (select tenant_h from fx) and reward_key = p_reward), p_store, p_at) as a
  )
  insert into held (name, redemption_id, code, hold_expires_at)
  select p_name, (a ->> 'redemption_id')::uuid, a ->> 'code', (a ->> 'hold_expires_at')::timestamptz from answer
  returning coalesce((select a ->> 'state' from answer), 'refused');
$$;

create function pg_temp.verify(p_name text, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select staff_h from fx), 'role', 'authenticated')::text, true);
  v_answer := app.staff_verify_redemption((select store_fb from fx), (select code from held where name = p_name), p_at);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_answer ->> 'refusal', v_answer ->> 'state');
end;
$$;

create function pg_temp.callback(p_name text, p_sale text, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', a ->> 'outcome', a ->> 'discount_amount')
  from (
    select app.answer_voucher_callback(
      (select path_sha256 from secret), '203.0.113.5'::inet, 'POS-1', 'PRG-1', (select code from held where name = p_name), p_sale, null,
      '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]'::jsonb, p_at, p_at
    ) as a
  ) x;
$$;

-- Staff verification at the till: the fallback rail, a hold of 24 hours.
select is(pg_temp.hold('v_edge', 1, 'free-drink', (select store_fb from fx), (select t0 from fx)), 'held', 'setup: a hold on the fallback rail');
select is(pg_temp.hold('v_end', 2, 'free-drink', (select store_fb from fx), (select t0 from fx)), 'held', 'setup: a second hold');
select is(pg_temp.hold('v_late', 3, 'free-drink', (select store_fb from fx), (select t0 from fx)), 'held', 'setup: a third hold');
select is(pg_temp.verify('v_edge', (select hold_expires_at from held where name = 'v_edge') - interval '1 second'), 'verified', 'BVA hold end - 1 second: staff verify the code');
select is(pg_temp.verify('v_end', (select hold_expires_at from held where name = 'v_end')), 'expired', 'BVA hold end: the code is refused expired');
select is(pg_temp.verify('v_late', (select hold_expires_at from held where name = 'v_late') + interval '1 second'), 'expired', 'BVA hold end + 1 second: refused expired');
select is(
  (select r.verified_at is null from public.redemptions r where r.id = (select redemption_id from held where name = 'v_end')),
  true,
  'an expired answer verifies nothing'
);

-- The voucher callback: the code rail, a hold of 24 hours.
select is(pg_temp.hold('c_edge', 4, 'ten-pct', (select store_cb from fx), (select t0 from fx)), 'held', 'setup: a hold on the callback rail');
select is(pg_temp.hold('c_end', 5, 'ten-pct', (select store_cb from fx), (select t0 from fx)), 'held', 'setup: a second callback hold');
select is(pg_temp.hold('c_late', 6, 'ten-pct', (select store_cb from fx), (select t0 from fx)), 'held', 'setup: a third callback hold');
select is(pg_temp.callback('c_edge', 'EDGE-1', (select hold_expires_at from held where name = 'c_edge') - interval '1 second'), 'accepted:6000', 'BVA hold end - 1 second: the callback gives the 10 % discount');
select is(pg_temp.callback('c_end', 'EDGE-2', (select hold_expires_at from held where name = 'c_end')), 'expired:0', 'BVA hold end: the callback answers expired with no discount');
select is(pg_temp.callback('c_late', 'EDGE-3', (select hold_expires_at from held where name = 'c_late') + interval '1 second'), 'expired:0', 'BVA hold end + 1 second: expired with no discount');
select is(
  (select count(*)::integer from app.voucher_callback_answers a where a.tenant_id = (select tenant_h from fx) and a.discount_amount > 0),
  1,
  'only the call at the end minus one second left a binding answer'
);
select is(
  (select string_agg(l.outcome, ',' order by l.logged_at, l.outcome) from app.voucher_callback_log l where l.tenant_id = (select tenant_h from fx)),
  'accepted,expired,expired',
  'the three decisions are logged'
);
select is(
  pg_temp.callback('c_edge', 'EDGE-1', (select hold_expires_at from held where name = 'c_edge') + interval '1 hour'),
  'replayed:6000',
  'a replay of the accepted sale after the end still gets its first answer'
);

select * from finish();
rollback;
