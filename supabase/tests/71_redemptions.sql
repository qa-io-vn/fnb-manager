begin;
select plan(62);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000007101'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000007101'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000007101'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000007102'::uuid as store_2,
  'ffffffff-ffff-4fff-8fff-000000007103'::uuid as store_3,
  'eeeeeeee-eeee-4eee-8eee-000000007101'::uuid as owner_r,
  'eeeeeeee-eeee-4eee-8eee-000000007102'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000007103'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000007104'::uuid as viewer_r,
  'eeeeeeee-eeee-4eee-8eee-000000007111'::uuid as user_a,
  'eeeeeeee-eeee-4eee-8eee-000000007112'::uuid as user_b,
  'eeeeeeee-eeee-4eee-8eee-000000007113'::uuid as user_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007101'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007102'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007103'::uuid as customer_c,
  '99999999-9999-4999-8999-000000007101'::uuid as member_a,
  '99999999-9999-4999-8999-000000007102'::uuid as member_b,
  '99999999-9999-4999-8999-000000007103'::uuid as member_c,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000007101'::uuid as programme_r,
  '44444444-4444-4444-8444-000000007101'::uuid as brand_r,
  '55555555-5555-4555-8555-000000007101'::uuid as app_r;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'redemptions-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_r, fx.staff_1, fx.staff_2, fx.viewer_r, fx.user_a, fx.user_b, fx.user_c]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_r, 'redemptions-pgtap', 'Redemptions pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_r, tenant_r, 'mock', 'redemptions-r', 'Synthetic account R' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_r, account_r, 'rd-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_r, account_r, 'rd-2', 'Synthetic store 2' from fx
union all
select store_3, tenant_r, account_r, 'rd-3', 'Synthetic store 3' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_r, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_r, 'owner', null::uuid[]),
    (fx.staff_1, 'staff', array[fx.store_1]),
    (fx.staff_2, 'staff', array[fx.store_2]),
    (fx.viewer_r, 'viewer', null::uuid[])
) as m (user_id, role, store_ids);

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_r, tenant_r, 'brand-1', 'Synthetic brand', array[store_1, store_2, store_3] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_r, tenant_r, brand_r, 'syn-app-7101', 'ZALO_APP_SECRET_BRAND_1' from fx;

insert into public.customers (id, tenant_id, phone, name)
select customer_a, tenant_r, '+' || '849000' || '07101', 'Synthetic A' from fx
union all
select customer_b, tenant_r, '+' || '849000' || '07102', null from fx
union all
select customer_c, tenant_r, '+' || '849000' || '07103', null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_r, tenant_r, 'Synthetic programme R', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at)
select member_a, tenant_r, programme_r, customer_a, 'mini_app', now() - interval '10 days' from fx
union all
select member_b, tenant_r, programme_r, customer_b, 'mini_app', now() - interval '10 days' from fx
union all
select member_c, tenant_r, programme_r, customer_c, 'mini_app', now() - interval '10 days' from fx;

insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_r, app_r, 'syn-zalo-a', user_a, customer_a from fx
union all
select tenant_r, app_r, 'syn-zalo-b', user_b, customer_b from fx
union all
select tenant_r, app_r, 'syn-zalo-c', user_c, customer_c from fx;

create temp table credits as
with inserted as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select fx.tenant_r, fx.programme_r, v.membership, 'adjust', v.stamps, v.points, v.points * 500, 'synthetic credit', now() + interval '30 days', now() - interval '3 days'
  from fx
  cross join lateral (values (fx.member_a, 30, 200), (fx.member_b, 2, 0), (fx.member_c, 10, 100)) as v (membership, stamps, points)
  returning id, membership_id, stamp_delta
)
select * from inserted;
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select (select tenant_r from fx), c.membership_id, c.id, now() - interval '3 days', now() + interval '180 days'
from credits c
cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_r, store_1, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], now() - interval '30 days' from fx
union all
select tenant_r, store_2, 'crm_code_pool', '{pool-1}', now() - interval '30 days' from fx
union all
select tenant_r, store_3, 'crm_callback', '{cb-1}', now() - interval '30 days' from fx;

insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_r, store_1, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx
union all
select tenant_r, store_1, 'ten-pct', 'Synthetic ten percent', null, 'discount' from fx
union all
select tenant_r, store_2, 'free-drink', null, 'pool-1', 'discount' from fx
union all
select tenant_r, store_2, 'points-cake', null, 'pool-2', 'discount' from fx
union all
select tenant_r, store_3, 'free-drink', null, 'cb-1', 'discount' from fx;

insert into public.coupon_codes (tenant_id, store_id, reward_key, code, imported_at)
select fx.tenant_r, fx.store_2, v.reward, v.code, now() - make_interval(hours => v.age)
from fx
cross join (values ('free-drink', 'SYN-P1', 3), ('free-drink', 'SYN-P2', 2), ('points-cake', 'SYN-C1', 1)) as v (reward, code, age);

select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, per_member_limit, status)
select tenant_r, programme_r, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, null, 8, 0, null::uuid[], null::smallint, 'active'::public.coupon_status from fx
union all
select tenant_r, programme_r, 'ten-pct', 'Ten percent off', 'percent_off', 10, 0, 50, array[store_1], 1, 'active' from fx
union all
select tenant_r, programme_r, 'points-cake', 'Cake for points', 'free_item', null, 0, 60, array[store_2], null, 'active' from fx;

create temp table answers (name text primary key, answer jsonb);
grant select on fx to authenticated, service_role;
grant all on answers to authenticated;

create function pg_temp.as_customer(p_user uuid, p_customer uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_r from fx), 'customer_id', p_customer)
  )::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.as_user(p_user uuid, p_query text)
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

create function pg_temp.redeem(p_user uuid, p_customer uuid, p_reward text, p_store text)
returns text
language sql
as $$
  select pg_temp.as_customer(p_user, p_customer, format(
    'select public.customer_redeem((select id from public.coupons where reward_key = %L), %L)::text', p_reward, p_store
  ));
$$;

create function pg_temp.verify(p_user uuid, p_store uuid, p_code text)
returns jsonb
language plpgsql
as $$
declare
  v_value text := pg_temp.as_user(p_user, format('select public.staff_verify_redemption(%L::uuid, %L)::text', p_store, p_code));
begin
  return case when v_value like 'error:%' then jsonb_build_object('error', substr(v_value, 7)) else v_value::jsonb end;
end;
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold_at timestamptz, p_amount numeric, p_discount_name text, p_discount numeric, p_voucher text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, voucher_code, voucher_amount, net_amount, paid_amount)
  select fx.tenant_r, p_store, fx.account_r, 'rd-' || p_name, p_sold_at, app.store_business_date(p_store, p_sold_at),
    p_amount, p_discount_name, case when p_discount_name is not null then p_discount else 0 end, p_voucher,
    case when p_voucher is not null then p_discount else 0 end, p_amount - p_discount, p_amount - p_discount
  from fx
  returning id;
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty((select tenant_r from fx), app.store_business_date((select store_1 from fx), now()) - 1, app.store_business_date((select store_1 from fx), now()) + 2, p_at);
$$;

set local role authenticated;
select is(
  pg_temp.as_customer((select user_a from fx), (select customer_a from fx), $$ select string_agg(concat_ws(':', reward_key, available, coalesce(unavailable_reason, '-')), ',' order by reward_key) from public.customer_coupons('rd-1') $$),
  'free-drink:t:-,ten-pct:t:-',
  'the rewards of a store with what the member can redeem there'
);
select is(
  pg_temp.as_customer((select user_b from fx), (select customer_b from fx), $$ select string_agg(concat_ws(':', reward_key, affordable, unavailable_reason, stamps_short, points_short), ',' order by reward_key) from public.customer_coupons(null) $$),
  'free-drink:f:insufficient_stamps:6:0,points-cake:f:insufficient_points:0:60,ten-pct:f:insufficient_points:0:50',
  'a member short of stamps or points sees what is missing, for every store of the app'
);
insert into answers select 'a_fallback', pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'free-drink', 'rd-1')::jsonb;
reset role;

select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'rail', char_length(answer ->> 'code'), answer ->> 'refusal', answer ->> 'stamps', answer ->> 'stamps_spent') from answers where name = 'a_fallback'),
  'held:pos_payment_discount:8:22:8',
  'a member redeems a free drink on the fallback rail: a held redemption with an 8-character code, the stamps held at once'
);
select is(
  (select answer ->> 'qr_payload' = 'fnb-redeem:1:' || (answer ->> 'code') from answers where name = 'a_fallback'),
  true,
  'with the QR payload the staff app scans'
);
select is(
  (select concat_ws(':', l.entry_kind, l.stamp_delta, l.pending, l.reason) from public.loyalty_ledger l join public.redemptions r on r.redeem_entry_id = l.id where r.id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_fallback')),
  'redeem:-8:t:redemption',
  'the hold is a pending redeem row of the ledger'
);
select is(
  (select count(*)::integer from public.stamps s join public.redemptions r on r.redeem_entry_id = s.closed_entry_id where s.state = 'redeemed' and r.id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_fallback')),
  8,
  'and closes eight stamps as redeemed'
);
select is(
  (select pos_discount_name from public.redemptions where id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_fallback')),
  'Synthetic free drink',
  'the redemption carries the store''s discount entry name'
);

set local role authenticated;
select is(
  (pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'free-drink', 'rd-1')::jsonb ->> 'refusal'),
  'already_held',
  'a second hold of the same reward is refused while the first runs'
);
select is(
  (pg_temp.redeem((select user_b from fx), (select customer_b from fx), 'free-drink', 'rd-1')::jsonb ->> 'refusal'),
  'insufficient_stamps',
  'a member with two stamps cannot redeem an eight-stamp reward'
);
select is(
  (pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'ten-pct', 'rd-2')::jsonb ->> 'refusal'),
  'store_unavailable',
  'a reward limited to one store is refused at another'
);
select is(
  pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'free-drink', 'unknown-store'),
  'error:22023',
  'a store the app does not offer is refused'
);
select is(
  pg_temp.as_user((select owner_r from fx), $$ select public.customer_redeem((select id from public.coupons where reward_key = 'free-drink'), 'rd-1')::text $$),
  'error:42501',
  'a member of the tenant is not a customer session'
);
select is(
  pg_temp.as_customer((select user_a from fx), (select customer_a from fx), $$ select concat_ws(':', display_state, seconds_left > 86000, code is not null, verified) from public.customer_vouchers() $$),
  'held:t:t:f',
  'the wallet shows the held voucher with its code and a 24-hour countdown'
);
select is(
  pg_temp.as_customer((select user_b from fx), (select customer_b from fx), $$ select count(*)::text from public.customer_vouchers() $$),
  '0',
  'another member sees none of it in their wallet'
);
select is(
  pg_temp.as_customer((select user_b from fx), (select customer_b from fx), $$ select count(*)::text from public.redemptions $$),
  '0',
  'nor in the redemptions table'
);
select is(
  pg_temp.as_customer((select user_a from fx), (select customer_a from fx), $$ select count(*)::text from public.redemptions $$),
  '1',
  'the member reads their own redemption'
);
select is(
  pg_temp.as_customer((select user_a from fx), (select customer_a from fx), format('select public.staff_verify_redemption(%L::uuid, %L)::text', (select store_1 from fx), (select answer ->> 'code' from answers where name = 'a_fallback'))),
  'error:42501',
  'a customer session cannot verify a code'
);
reset role;

select is(
  pg_temp.verify((select staff_2 from fx), (select store_2 from fx), (select answer ->> 'code' from answers where name = 'a_fallback')),
  '{"state": "refused", "reason": "other_store", "refusal": "wrong_store", "used_at": null, "text_key": "redeem.refusal.wrong_store", "expired_at": null, "used_store_name": null}'::jsonb,
  'staff of another store are refused as wrong_store without a word about the code'
);
select is(
  pg_temp.verify((select staff_2 from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'a_fallback')) ->> 'error',
  '42501',
  'and cannot verify at a store outside their scope'
);
select is(
  pg_temp.verify((select owner_r from fx), (select store_3 from fx), 'fnb-redeem:1:' || (select answer ->> 'code' from answers where name = 'a_fallback')) ->> 'refusal',
  'wrong_store',
  'an owner checking the code at another of their stores is refused too'
);
select is(
  pg_temp.verify((select staff_1 from fx), (select store_1 from fx), 'two words') ->> 'error',
  '22023',
  'a malformed code is refused'
);
select is(
  pg_temp.verify((select staff_1 from fx), (select store_1 from fx), 'NOSUCHCODE') ->> 'refusal',
  'unknown',
  'an unknown code is refused'
);
insert into answers select 'verify_1', pg_temp.verify((select staff_1 from fx), (select store_1 from fx), 'fnb-redeem:1:' || lower((select answer ->> 'code' from answers where name = 'a_fallback')));
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'first_verification', answer ->> 'rail', answer ->> 'pos_discount_name', coalesce(answer ->> 'voucher_code', '-'), answer ->> 'reward_name', answer ->> 'phone_masked', coalesce(answer ->> 'min_bill_amount', '-'), answer ->> 'hold_until' is not null, answer ->> 'confirm_by' is not null) from answers where name = 'verify_1'),
  'verified:true:pos_payment_discount:Synthetic free drink:-:Free drink:•••• ••• 101:-:t:t',
  'staff of the store verify the scanned code (any case): the discount entry to apply, the reward, a masked phone, the hold and the time the sale should be rung by'
);
select is(
  (select verified_at is not null and verified_by = (select staff_1 from fx) and state = 'held' from public.redemptions where id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_fallback')),
  true,
  'the redemption is marked verified and stays held until the invoice confirms it'
);
select is(
  pg_temp.verify((select staff_1 from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'a_fallback')) ->> 'first_verification',
  'false',
  'the same staff member checking again within the window gets the same answer'
);
select is(
  (select concat_ws(':', a ->> 'refusal', a ->> 'reason', a ->> 'text_key', a ->> 'used_store_name', a ->> 'used_at' is not null)
   from (select pg_temp.verify((select owner_r from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'a_fallback')) as a) x),
  'used:already_verified:redeem.refusal.used:Synthetic store 1:t',
  'a second verification by someone else is refused as used: the code is not applied twice'
);

select pg_temp.invoice('fallback-1', (select store_1 from fx), now() + interval '5 minutes', 120000, ' synthetic FREE drink ', 30000, null);
select is(
  (select concat_ws(':', c ->> 'discount_confirmed', c ->> 'discount_earned', c ->> 'mismatches_found') from (select pg_temp.reconcile(now() + interval '1 hour') as c) x),
  '1:1:0',
  'the reconciliation after the sync confirms the redemption by the invoice carrying the discount name and earns it on path D'
);
select is(
  (select concat_ws(':', r.state, i.external_id, (select count(*) from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = r.redeem_entry_id), (select matched_path from public.loyalty_ledger l where l.entry_kind = 'earn' and l.invoice_id = i.id))
   from public.redemptions r join public.invoices i on i.id = r.confirmed_invoice_id
   where r.id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_fallback')),
  'confirmed:rd-fallback-1:1:D',
  'the redemption is confirmed with its invoice and the hold gets its confirm row'
);
set local role authenticated;
select is(
  pg_temp.as_customer((select user_a from fx), (select customer_a from fx), $$ select concat_ws(':', display_state, coalesce(code, '-')) from public.customer_vouchers() $$),
  'used:-',
  'the wallet shows it as Đã dùng without the code'
);
reset role;
select is(
  pg_temp.verify((select staff_1 from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'a_fallback')) - 'used_at',
  '{"state": "refused", "reason": "used", "refusal": "used", "text_key": "redeem.refusal.used", "expired_at": null, "used_store_name": "Synthetic store 1"}'::jsonb,
  'a used code shown again is refused as used, with where it was used'
);

set local role authenticated;
insert into answers select 'a_pool', pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'free-drink', 'rd-2')::jsonb;
reset role;
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'rail', answer ->> 'code') from answers where name = 'a_pool'),
  'held:crm_code_pool:SYN-P1',
  'on the code-pool rail the hold takes the oldest available pool code'
);
select is(
  (select state::text from public.coupon_codes where code = 'SYN-P1'),
  'assigned',
  'which is assigned to it'
);
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'rail', answer ->> 'voucher_code', coalesce(answer ->> 'pos_discount_name', '-'), coalesce(answer ->> 'confirm_by', '-')) from (select pg_temp.verify((select staff_2 from fx), (select store_2 from fx), 'SYN-P1') as answer) x),
  'verified:crm_code_pool:SYN-P1:-:-',
  'staff are told the voucher code to type'
);
select pg_temp.invoice('pool-1', (select store_2 from fx), now() + interval '10 minutes', 90000, null, 25000, 'syn-p1');
select is(
  (pg_temp.reconcile(now() + interval '1 hour') ->> 'd_confirmed')::integer,
  1,
  'the synced invoice carrying the pool code confirms the redemption'
);
select is(
  (select concat_ws(':', k.state, r.state) from public.coupon_codes k join public.redemptions r on r.coupon_code_id = k.id where k.code = 'SYN-P1'),
  'used:confirmed',
  'and the pool code becomes used'
);

set local role authenticated;
insert into answers select 'a_callback', pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'free-drink', 'rd-3')::jsonb;
reset role;
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'rail', answer ->> 'code' ~ '^[A-Z2-9]{8}$') from answers where name = 'a_callback'),
  'held:crm_callback:t',
  'on the callback rail the hold carries a generated code for the callback to validate'
);
select is(
  (select pg_temp.verify((select owner_r from fx), (select store_3 from fx), answer ->> 'code') ->> 'voucher_code' = answer ->> 'code' from answers where name = 'a_callback'),
  true,
  'an owner verifying at that store is told to type the code'
);
select pg_temp.invoice('callback-1', (select store_3 from fx), now() + interval '20 minutes', 80000, null, 20000, (select answer ->> 'code' from answers where name = 'a_callback'));

set local role authenticated;
insert into answers select 'a_ten', pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'ten-pct', 'rd-1')::jsonb;
reset role;
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'points_spent', answer ->> 'points') from answers where name = 'a_ten'),
  'held:50:150',
  'a points reward holds its points'
);
select app.confirm_redemption((select (answer ->> 'redemption_id')::uuid from answers where name = 'a_ten'), pg_temp.invoice('ten-1', (select store_1 from fx), now() + interval '30 minutes', 100000, 'Synthetic ten percent', 10000, null), now() + interval '31 minutes');
set local role authenticated;
select is(
  (pg_temp.redeem((select user_a from fx), (select customer_a from fx), 'ten-pct', 'rd-1')::jsonb ->> 'refusal'),
  'member_limit_reached',
  'the per-member limit refuses a second redemption of a reward limited to one'
);
reset role;

insert into public.coupon_rails (tenant_id, store_id, rail, active_from)
select tenant_r, store_3, 'pos_payment_discount', now() from fx;
select is(
  (app.redeem_coupon((select member_a from fx), (select id from public.coupons where reward_key = 'free-drink'), (select store_3 from fx), now() + interval '1 minute') ->> 'refusal'),
  'rail_not_ready',
  'a store whose rail does not fit the reward''s mapping refuses the redemption'
);

insert into answers
select 'c_points', app.redeem_coupon((select member_c from fx), (select id from public.coupons where reward_key = 'points-cake'), (select store_2 from fx), now() - interval '25 hours')
union all
select 'c_stamps', app.redeem_coupon((select member_c from fx), (select id from public.coupons where reward_key = 'free-drink'), (select store_1 from fx), now() - interval '26 hours');
select is(
  (select string_agg(concat_ws(':', name, answer ->> 'state', coalesce(answer ->> 'code', '-')), ',' order by name) from answers where name like 'c\_%'),
  'c_points:held:SYN-C1,c_stamps:held:' || (select answer ->> 'code' from answers where name = 'c_stamps'),
  'two holds made more than a day ago'
);
select is(
  (select concat_ws(':', stamps, points) from app.loyalty_balance((select member_c from fx), now())),
  '2:40',
  'hold the member''s stamps and points'
);
select is(
  (select concat_ws(':', a ->> 'refusal', a ->> 'expired_at' is not null) from (select pg_temp.verify((select staff_1 from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'c_stamps')) as a) x),
  'expired:t',
  'a code whose hold has ended is refused as expired, with the time it ended'
);

create temp table ledger_before as select count(*) as n from public.loyalty_ledger where tenant_id = (select tenant_r from fx);
-- Changed by ADR-046 (G-102): the nightly counts gained written_off_stamps and written_off_points; this
-- check is about the hold release, so they are dropped with the other phase 17 counts (here and below).
select is(
  app.loyalty_nightly((select tenant_r from fx), now()) - 'clawbacks' - 'written_off_stamps' - 'written_off_points' - 'expired_points' - 'expired_stamps' - 'expired_memberships' - 'liability_rows',
  '{"released_holds": 2, "quarantined_codes": 1, "late_confirmed_holds": 0}'::jsonb,
  'the nightly step releases both unused holds after 24 hours and quarantines the pool code'
);
select is(
  (select concat_ws(':', stamps, points) from app.loyalty_balance((select member_c from fx), now())),
  '10:100',
  'the release gives every stamp and point back'
);
select is(
  (select count(*)::integer from public.stamps where membership_id = (select member_c from fx) and state = 'active'),
  10,
  'and the held stamps are active again'
);
select is(
  pg_temp.verify((select staff_1 from fx), (select store_1 from fx), (select answer ->> 'code' from answers where name = 'c_stamps')) ->> 'refusal',
  'released',
  'a released code shown at the till is refused as released'
);
select is(
  (select string_agg(concat_ws(':', l.entry_kind, l.reason, l.stamp_delta, l.point_delta, h.entry_kind), ',' order by l.point_delta)
   from public.loyalty_ledger l join public.loyalty_ledger h on h.id = l.source_entry_id
   where l.membership_id = (select member_c from fx) and l.reason = 'redemption_released'),
  'adjust:redemption_released:8:0:redeem,adjust:redemption_released:0:60:redeem',
  'each release is a reversing ledger row pointing at its hold'
);
select is(
  (select string_agg(concat_ws(':', r.state, r.release_reason, r.release_entry_id is not null), ',') from public.redemptions r where r.membership_id = (select member_c from fx)),
  'released:hold_expired:t,released:hold_expired:t',
  'both redemptions are released'
);
select is(
  (select state::text || ':' || (quarantined_at is not null) from public.coupon_codes where code = 'SYN-C1'),
  'quarantined:true',
  'the unused pool code is quarantined, never handed out again'
);
set local role authenticated;
select is(
  pg_temp.as_customer((select user_c from fx), (select customer_c from fx), $$ select string_agg(display_state, ',') from public.customer_vouchers() $$),
  'returned,returned',
  'the wallet shows them as Đã hoàn lại'
);
reset role;
select is(
  app.loyalty_nightly((select tenant_r from fx), now()) ->> 'released_holds',
  '0',
  'a second nightly run releases nothing more'
);
select is(
  (select count(*) - (select n from ledger_before) from public.loyalty_ledger where tenant_id = (select tenant_r from fx)),
  2::bigint,
  'and writes no further ledger row'
);
select is(
  app.loyalty_expiring_points((select member_c from fx), now() + interval '31 days'),
  100,
  'returned points keep the expiry of the credit they came from'
);
select is(
  app.loyalty_nightly((select tenant_r from fx), now() + interval '25 hours') - 'clawbacks' - 'written_off_stamps' - 'written_off_points' - 'expired_points' - 'expired_stamps' - 'expired_memberships' - 'liability_rows',
  '{"released_holds": 0, "quarantined_codes": 0, "late_confirmed_holds": 1}'::jsonb,
  'a hold whose invoice is already synced is confirmed, not released, when its time is up'
);
select is(
  (select state::text from public.redemptions where id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'a_callback')),
  'confirmed',
  'the callback-rail redemption is confirmed by its invoice'
);

select ok(
  not has_function_privilege('anon', 'public.customer_redeem(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.customer_coupons(text)', 'execute')
  and not has_function_privilege('anon', 'public.customer_vouchers()', 'execute')
  and not has_function_privilege('anon', 'public.staff_verify_redemption(uuid, text)', 'execute'),
  'anon calls none of the redemption functions'
);
select ok(
  not has_function_privilege('authenticated', 'app.redeem_coupon(uuid, uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.customer_redeem(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.staff_verify_redemption(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.release_redemption_holds(uuid, timestamptz)', 'execute'),
  'members reach the app functions only through the RPCs, which fix the clock'
);
select ok(
  not has_function_privilege('service_role', 'public.customer_redeem(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.staff_verify_redemption(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'app.redeem_coupon(uuid, uuid, uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.release_redemption_holds(uuid, timestamptz)', 'execute'),
  'the service role, which is no session, uses the app functions and not the RPCs'
);
set local role authenticated;
select is(pg_temp.as_user((select staff_1 from fx), 'select count(*)::text from public.redemptions'), '0', 'staff read no redemption row directly');
select is(pg_temp.as_user((select viewer_r from fx), 'select count(*)::text from public.redemptions'), '6', 'a viewer reads the tenant''s redemptions');
select is(pg_temp.as_user((select viewer_r from fx), format('select public.staff_verify_redemption(%L::uuid, %L)::text', (select store_2 from fx), 'SYN-P1')), 'error:42501', 'a viewer verifies no code');
reset role;

select * from finish();
rollback;
