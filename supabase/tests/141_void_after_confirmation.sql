-- ISTQB state transition testing, the transition confirmed -> cancelled: the
-- invoice that confirmed a redemption is voided later (the nightly re-pull).
-- Decision of the owner's defaults: the redemption becomes cancelled, the
-- stamps are returned, the item goes to the manager queue and the
-- redemption_mismatch alert counts it. A second case ("clawed-back earn frees
-- its place in the daily cap") follows from the same void. SQL is the unit under
-- test (app.reconcile_loyalty, app.loyalty_nightly, app.staff_verify_redemption).
-- Closes G-03 and the rule of G-42 on the SQL side.
begin;
select plan(39);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000014101'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000014101'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000014101'::uuid as store_discount,
  'ffffffff-ffff-4fff-8fff-000000014102'::uuid as store_pool,
  'eeeeeeee-eeee-4eee-8eee-000000014101'::uuid as staff_r,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000014101'::uuid as programme_r,
  ((date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') - interval '4 days' + interval '10 hours') at time zone 'Asia/Ho_Chi_Minh') as t0;

insert into auth.users (id, instance_id, aud, role, email)
select staff_r, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'void-after-4101@example.com' from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_r, 'void-after-pgtap', 'Void after confirmation pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_r, tenant_r, 'mock', 'void-after', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_discount, tenant_r, account_r, 'va-1', 'Synthetic store 1' from fx
union all
select store_pool, tenant_r, account_r, 'va-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_r, staff_r, 'staff'::public.tenant_role, array[store_discount, store_pool] from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_r, tenant_r, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members as
select n, app.loyalty_join(fx.tenant_r, app.loyalty_customer_for_phone(fx.tenant_r, '0900000' || (800 + n)::text, fx.t0 - interval '10 days'), 'mini_app', fx.store_discount, null, null, fx.t0 - interval '10 days') as membership_id
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
select tenant_r, store_pool, 'crm_code_pool', '{pool-va}', t0 - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_r, store_discount, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx
union all
select tenant_r, store_pool, 'free-drink', null, 'pool-va', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_r, store_pool, 'free-drink', 'SYN-VA' || n from fx cross join generate_series(1, 3) n;
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

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_discount_name text, p_voucher text, p_net numeric default 50000)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, voucher_code, voucher_amount, net_amount, paid_amount)
  select fx.tenant_r, p_store, fx.account_r, 'va-' || p_name, p_sold, app.store_business_date(p_store, p_sold), p_net + 30000, p_discount_name,
    case when p_discount_name is null then 0 else 30000 end, p_voucher, case when p_voucher is null then 0 else 30000 end, p_net, p_net
  from fx
  returning id;
$$;

create function pg_temp.void(p_name text)
returns void
language sql
as $$
  update public.invoices set status = 'voided' where tenant_id = (select tenant_r from fx) and external_id = 'va-' || p_name;
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty((select tenant_r from fx), (select (t0 at time zone 'Asia/Ho_Chi_Minh')::date - 1 from fx), (select (t0 at time zone 'Asia/Ho_Chi_Minh')::date + 6 from fx), p_at);
$$;

create function pg_temp.cancelled_after(p_at timestamptz)
returns text
language plpgsql
as $$
begin
  perform pg_temp.reconcile(p_at);
  return (select count(*)::text from public.redemptions r where r.tenant_id = (select tenant_r from fx) and r.state = 'cancelled');
end;
$$;

create function pg_temp.balance(p_n integer)
returns integer
language sql
as $$
  select b.stamps from app.loyalty_balance(pg_temp.member(p_n), null) b;
$$;

create function pg_temp.state(p_name text)
returns text
language sql
as $$
  select r.state::text from public.redemptions r where r.id = (select redemption_id from held where name = p_name);
$$;

create function pg_temp.earn(p_invoice uuid, p_member integer, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', e.stamps, coalesce(e.refusal, '-'), e.entry_id is not null)
  from app.loyalty_earn(p_invoice, pg_temp.member(p_member), 'A', p_at) e;
$$;

create function pg_temp.queue_items_text(p_store uuid)
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

-- Fallback rail: held, verified, confirmed by its invoice.
select is(pg_temp.hold('f1', 1, (select store_discount from fx), (select t0 from fx)), 'held', 'state transition (start) -> held on the fallback rail');
select is(pg_temp.verify('f1', (select t0 from fx) + interval '2 minutes', (select store_discount from fx)), 'verified', 'held -> held+verified');
select isnt(pg_temp.invoice('f1', (select store_discount from fx), (select t0 from fx) + interval '5 minutes', 'Synthetic free drink', null), null, 'the invoice with the discount entry syncs');
select is(pg_temp.reconcile((select t0 from fx) + interval '1 hour') ->> 'discount_confirmed', '1', 'held -> confirmed: the reconciliation confirms the redemption');
select is(pg_temp.state('f1'), 'confirmed', 'the redemption is confirmed');
select is(pg_temp.balance(1), 9, 'the member holds 8 stamps after the hold plus the invoice''s stamp');
select is(
  (select count(*)::integer from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.matched_path = 'D'),
  0,
  'no queue item while the invoice stands'
);

-- The nightly re-pull marks the invoice voided.
select pg_temp.void('f1');
select is(pg_temp.cancelled_after((select t0 from fx) + interval '1 day'), '1', 'state transition confirmed -> cancelled: the voided invoice cancels the redemption');
select is(pg_temp.state('f1'), 'cancelled', 'the redemption is cancelled');
select is(
  (select concat_ws(':', r.released_at is not null, r.release_entry_id is not null, r.confirmed_invoice_id is not null) from public.redemptions r where r.id = (select redemption_id from held where name = 'f1')),
  't:t:t',
  'the cancellation time and its ledger row are kept, and the voided invoice stays named'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = pg_temp.member(1) and l.entry_kind = 'adjust' and l.reason = 'redemption_released' and l.stamp_delta = 8),
  1,
  'the 8 stamps come back through one adjust row of the redemption'
);
select is(
  (select count(*)::integer from public.stamps s where s.membership_id = pg_temp.member(1) and s.state = 'active'),
  17,
  'the stamps the redemption closed are active again (16, plus the invoice''s own until its clawback)'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = pg_temp.member(1) and l.entry_kind = 'confirm' and l.invoice_id is not null and l.source_entry_id in (select redeem_entry_id from public.redemptions where id = (select redemption_id from held where name = 'f1'))),
  1,
  'the history keeps the confirm row of the redeem entry'
);
select isnt(app.loyalty_nightly((select tenant_r from fx), (select t0 from fx) + interval '1 day 1 minute'), null, 'the nightly step runs: it claws back the voided invoice''s earn');
select is(pg_temp.balance(1), 16, 'the member ends with 16 stamps: the redemption''s 8 back, the earn clawed back');
select is(
  (select string_agg(q.reason || ':' || q.state || ':' || (q.redemption_id is not null)::text || ':' || (q.invoice_id is not null)::text, ', ') from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.store_id = (select store_discount from fx) and q.matched_path = 'D'),
  'confirmed_invoice_voided:open:true:true',
  'the manager queue holds one open item naming the redemption and the voided invoice'
);
select is(
  (select pg_temp.alert_facts((select store_discount from fx)) ->> 'confirmed_invoice_voided'),
  '1',
  'the redemption_mismatch episode of the store counts the voided confirmation'
);
select is(
  (select count(*)::integer from jsonb_each(pg_temp.alert_facts((select store_discount from fx))) f where jsonb_typeof(f.value) <> 'number'),
  0,
  'the facts are counts only'
);
select isnt(pg_temp.reconcile((select t0 from fx) + interval '2 days'), null, 'a second reconciliation runs');
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = pg_temp.member(1) and l.reason = 'redemption_released'),
  1,
  'idempotence: nothing is given back twice'
);
select is(
  (select count(*)::integer from public.loyalty_queue q where q.tenant_id = (select tenant_r from fx) and q.reason = 'confirmed_invoice_voided'),
  1,
  'idempotence: one queue item'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_r from fx) and e.store_id = (select store_discount from fx) and e.rule_key = 'redemption_mismatch'),
  1,
  'idempotence: one episode'
);
select is(
  pg_temp.verify('f1', (select t0 from fx) + interval '2 days', (select store_discount from fx)),
  'released',
  'invalid transition cancelled -> verified: staff are told the code was given back'
);
select is(app.confirm_redemption((select redemption_id from held where name = 'f1'), (select id from public.invoices where external_id = 'va-f1'), (select t0 from fx) + interval '2 days'), null, 'invalid transition cancelled -> confirmed: nothing happens');
select is(app.release_redemption((select redemption_id from held where name = 'f1'), 'hold_expired', (select t0 from fx) + interval '2 days'), null, 'invalid transition cancelled -> released: nothing happens');

-- Code-pool rail: the same void.
select is(pg_temp.hold('c1', 2, (select store_pool from fx), (select t0 from fx)), 'held', 'state transition (start) -> held on the code-pool rail');
select isnt(pg_temp.invoice('c1', (select store_pool from fx), (select t0 from fx) + interval '30 minutes', null, (select code from held where name = 'c1')), null, 'the invoice with the pool code syncs');
select is(pg_temp.cancelled_after((select t0 from fx) + interval '1 hour'), '1', 'no new cancellation while the pool invoice stands (only the fallback one)');
select is(pg_temp.state('c1'), 'confirmed', 'the pool-rail redemption is confirmed by its code');
select pg_temp.void('c1');
select is(pg_temp.cancelled_after((select t0 from fx) + interval '1 day'), '2', 'confirmed -> cancelled on the pool rail (two cancelled in all)');
select is(
  (select concat_ws(':', r.state, k.state) from public.redemptions r join public.coupon_codes k on k.id = r.coupon_code_id where r.id = (select redemption_id from held where name = 'c1')),
  'cancelled:quarantined',
  'the pool code is quarantined, not used again by the voided sale'
);
select is(pg_temp.balance(2) >= 16, true, 'the member''s stamps are returned on the pool rail too');
select is(pg_temp.queue_items_text((select store_pool from fx)), 'confirmed_invoice_voided:open', 'the pool store''s queue holds one open item');

-- Daily cap: a clawed-back earn frees its place (earning_invoices_per_phone_per_day = 3).
select is(pg_temp.earn(pg_temp.invoice('k1', (select store_discount from fx), (select t0 from fx) + interval '3 hours', null, null, 60000), 3, (select t0 from fx) + interval '3 hours'), '1:-:t', 'daily cap: the first earning invoice earns');
select is(pg_temp.earn(pg_temp.invoice('k2', (select store_discount from fx), (select t0 from fx) + interval '3 hours 1 minute', null, null, 60000), 3, (select t0 from fx) + interval '3 hours 1 minute'), '1:-:t', 'daily cap: the second earns');
select is(pg_temp.hold('k3', 3, (select store_discount from fx), (select t0 from fx) + interval '3 hours 2 minutes'), 'held', 'the member holds the reward');
select pg_temp.verify('k3', (select t0 from fx) + interval '3 hours 3 minutes', (select store_discount from fx));
select pg_temp.invoice('k3', (select store_discount from fx), (select t0 from fx) + interval '3 hours 5 minutes', 'Synthetic free drink', null, 60000);
select is(pg_temp.reconcile((select t0 from fx) + interval '4 hours') ->> 'discount_earned', '1', 'daily cap: the redemption''s invoice is the third earn and confirms the redemption');
select is(pg_temp.earn(pg_temp.invoice('k4', (select store_discount from fx), (select t0 from fx) + interval '3 hours 10 minutes', null, null, 60000), 3, (select t0 from fx) + interval '3 hours 10 minutes'), '0:daily_cap:f', 'daily cap x + 1: a fourth earning invoice is refused');
select pg_temp.void('k3');
select pg_temp.reconcile((select t0 from fx) + interval '1 day');
select app.loyalty_nightly((select tenant_r from fx), (select t0 from fx) + interval '1 day 1 minute');
select is(pg_temp.earn(pg_temp.invoice('k5', (select store_discount from fx), (select t0 from fx) + interval '3 hours 20 minutes', null, null, 60000), 3, (select t0 from fx) + interval '1 day 2 minutes'), '1:-:t',
  'after the void and its clawback the earn no longer counts toward the daily cap: the next invoice earns');

select * from finish();
rollback;
