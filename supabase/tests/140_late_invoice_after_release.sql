-- ISTQB state transition testing, the transition "evidence arrives after the end
-- state": a redemption whose hold was released is not confirmed by an invoice
-- that syncs late. SQL is the unit under test (app.release_redemption_holds,
-- app.reconcile_redemptions, app.reconcile_loyalty). Closes G-02: the invoice
-- reaches the manager queue once, the redemption_mismatch alert is raised with
-- counts only, and the pool rail's quarantined code becomes used with its invoice.
begin;
select plan(28);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000014001'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000014001'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000014001'::uuid as store_discount,
  'ffffffff-ffff-4fff-8fff-000000014002'::uuid as store_pool,
  'eeeeeeee-eeee-4eee-8eee-000000014001'::uuid as staff_r,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000014001'::uuid as programme_r,
  date_trunc('minute', now()) - interval '4 days' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select staff_r, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'late-invoice-4001@example.com' from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_r, 'late-invoice-pgtap', 'Late invoice pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_r, tenant_r, 'mock', 'late-invoice', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_discount, tenant_r, account_r, 'li-1', 'Synthetic store 1' from fx
union all
select store_pool, tenant_r, account_r, 'li-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_r, staff_r, 'staff'::public.tenant_role, array[store_discount, store_pool] from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_r, tenant_r, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members as
select n, app.loyalty_join(fx.tenant_r, app.loyalty_customer_for_phone(fx.tenant_r, '0900000' || (700 + n)::text, fx.t0 - interval '10 days'), 'mini_app', fx.store_discount, null, null, fx.t0 - interval '10 days') as membership_id
from fx cross join generate_series(1, 3) n;

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
select tenant_r, store_pool, 'crm_code_pool', '{pool-li}', t0 - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_r, store_discount, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx
union all
select tenant_r, store_pool, 'free-drink', null, 'pool-li', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_r, store_pool, 'free-drink', 'SYN-LI' || n from fx cross join generate_series(1, 3) n;
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

create function pg_temp.verify(p_name text, p_at timestamptz, p_store uuid)
returns text
language plpgsql
as $$
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select staff_r from fx), 'role', 'authenticated')::text, true);
  v_answer := app.staff_verify_redemption(p_store, (select code from held where name = p_name), p_at);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_answer ->> 'refusal', v_answer ->> 'state');
end;
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_discount_name text, p_voucher text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, voucher_code, voucher_amount, net_amount, paid_amount)
  select fx.tenant_r, p_store, fx.account_r, 'li-' || p_name, p_sold, app.store_business_date(p_store, p_sold), 80000, p_discount_name,
    case when p_discount_name is null then 0 else 30000 end, p_voucher, case when p_voucher is null then 0 else 30000 end, 50000, 50000
  from fx
  returning id;
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty((select tenant_r from fx), (select (t0 at time zone 'Asia/Ho_Chi_Minh')::date - 1 from fx), (select (t0 at time zone 'Asia/Ho_Chi_Minh')::date + 6 from fx), p_at);
$$;

create function pg_temp.queue_items(p_store uuid)
returns text
language sql
as $$
  select coalesce(string_agg(q.reason || ':' || q.state, ', ' order by q.reason), '-')
  from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.store_id = p_store and q.matched_path = 'D';
$$;

create function pg_temp.alert_facts(p_store uuid)
returns jsonb
language sql
as $$
  select e.facts from public.alert_events e
  where e.tenant_id = (select tenant_r from fx) and e.store_id = p_store and e.rule_key = 'redemption_mismatch' and e.state = 'open';
$$;

-- Fallback rail: hold, verify, the hold ends and the nightly step releases it.
select is(pg_temp.hold('d1', 1, (select store_discount from fx), (select t0 from fx)), 'held', 'state transition (start) -> held on the fallback rail');
select is(pg_temp.verify('d1', (select t0 from fx) + interval '2 minutes', (select store_discount from fx)), 'verified', 'held -> held+verified: staff apply the discount entry at the till');
select is(
  app.release_redemption_holds((select tenant_r from fx), (select hold_expires_at from held where name = 'd1')) ->> 'released_holds',
  '1',
  'held -> released: no invoice by the end of the hold, so the nightly step releases it'
);
select is(
  (select concat_ws(':', r.state, r.verified_at is not null) from public.redemptions r where r.id = (select redemption_id from held where name = 'd1')),
  'released:t',
  'the redemption is released, its verification kept as history'
);
select is((select b.stamps from app.loyalty_balance(pg_temp.member(1), null) b), 16, 'the 8 stamps are back, the member holds 16');

-- The invoice carrying the discount entry syncs after the release.
select isnt(pg_temp.invoice('d1', (select store_discount from fx), (select t0 from fx) + interval '5 minutes', 'Synthetic free drink', null), null, 'the invoice that carries the reward''s discount entry syncs late');
select is(
  pg_temp.reconcile((select hold_expires_at from held where name = 'd1') + interval '1 hour') ->> 'discount_confirmed',
  '0',
  'state transition released + late evidence: the reconciliation confirms nothing'
);
select is(
  (select r.state::text from public.redemptions r where r.id = (select redemption_id from held where name = 'd1')),
  'released',
  'the redemption stays released, not confirmed by the late invoice'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = pg_temp.member(1) and l.entry_kind in ('redeem', 'confirm')),
  1,
  'no second redeem row and no confirm row is written (the hold''s own redeem row only)'
);
select is((select b.stamps from app.loyalty_balance(pg_temp.member(1), null) b), 16, 'the member''s balance is unchanged by the late invoice');
select is(
  (select count(*)::integer from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.reason = 'discount_without_redemption' and q.state = 'open'
     and q.invoice_id = (select id from public.invoices where external_id = 'li-d1')),
  1,
  'the invoice is listed once in the manager queue as a discount without a redemption'
);
select is(
  (select count(*)::integer from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.store_id = (select store_discount from fx) and q.matched_path = 'D' and q.state = 'open'),
  (select (pg_temp.alert_facts((select store_discount from fx)) ->> 'open_items')::integer),
  'the alert counts exactly the open queue items of the store'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_r from fx) and e.store_id = (select store_discount from fx) and e.rule_key = 'redemption_mismatch' and e.state = 'open'),
  1,
  'exactly one redemption_mismatch episode is open for the store'
);
select is(
  (select pg_temp.alert_facts((select store_discount from fx)) ->> 'discount_without_redemption'),
  '1',
  'the episode counts the discount without a redemption'
);
select is(
  (select count(*)::integer from jsonb_each(pg_temp.alert_facts((select store_discount from fx))) f where jsonb_typeof(f.value) <> 'number'),
  0,
  'the facts are counts only: every value is a number'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_r from fx) and e.rule_key = 'redemption_mismatch' and e.store_id = (select store_pool from fx)),
  0,
  'the other store has no episode yet'
);

select isnt(pg_temp.reconcile((select hold_expires_at from held where name = 'd1') + interval '2 hours'), null, 'a second reconciliation runs');
select is(
  (select count(*)::integer from public.loyalty_queue q where q.invoice_id = (select id from public.invoices where external_id = 'li-d1') and q.reason = 'discount_without_redemption'),
  1,
  'idempotence: the invoice is still listed once'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_r from fx) and e.store_id = (select store_discount from fx) and e.rule_key = 'redemption_mismatch'),
  1,
  'idempotence: no second episode'
);

-- Pool rail: the hold is released, the code quarantined, then the invoice with the code syncs.
select is(pg_temp.hold('p1', 2, (select store_pool from fx), (select t0 from fx)), 'held', 'state transition (start) -> held on the code-pool rail');
select is(
  app.release_redemption_holds((select tenant_r from fx), (select hold_expires_at from held where name = 'p1')) ->> 'released_holds',
  '1',
  'held -> released on the pool rail'
);
select is(
  (select k.state::text from public.coupon_codes k join public.redemptions r on r.coupon_code_id = k.id where r.id = (select redemption_id from held where name = 'p1')),
  'quarantined',
  'the pool code is quarantined by the release'
);
select isnt(pg_temp.invoice('p1', (select store_pool from fx), (select t0 from fx) + interval '30 minutes', null, (select code from held where name = 'p1')), null, 'the invoice that carries the quarantined code syncs late');
select is(
  pg_temp.reconcile((select hold_expires_at from held where name = 'p1') + interval '1 hour') ->> 'discount_confirmed',
  '0',
  'the reconciliation confirms nothing on the pool rail either'
);
select is(
  (select concat_ws(':', r.state, k.state, k.used_invoice_id = (select id from public.invoices where external_id = 'li-p1'))
     from public.redemptions r join public.coupon_codes k on k.id = r.coupon_code_id where r.id = (select redemption_id from held where name = 'p1')),
  'released:used:t',
  'the redemption stays released while the quarantined pool code becomes used with its invoice'
);
select is(
  pg_temp.queue_items((select store_pool from fx)),
  'discount_without_redemption:open',
  'the pool rail invoice is listed once in the queue as a discount without a redemption'
);
select is(
  (select pg_temp.alert_facts((select store_pool from fx)) ->> 'open_items'),
  '1',
  'the pool store''s episode counts the one open item'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = pg_temp.member(2) and l.entry_kind = 'confirm'),
  0,
  'no confirm row on the pool rail either'
);

select * from finish();
rollback;
