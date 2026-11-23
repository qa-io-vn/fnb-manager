-- The voucher callback's database decision timed with realistic data (G-39).
--
-- The POS waits for the callback; the busy limit of the function is 2,500 ms (docs/test-plan.md, NFR-PERF). The decision
-- itself, app.answer_voucher_callback, was only run on a handful of rows. This file loads 1,000 held redemptions (made
-- through app.redeem_coupon, as the Mini App does) and 10,000 answered sales (their redemptions, answers and log rows) for
-- one tenant, analyses the tables, then times 200 decisions of the mix a till produces and asserts the 95th percentile is
-- under 500 ms and the slowest under the busy limit.
--
-- Techniques (ISTQB): performance efficiency testing with a realistic load profile (volume of the tables, mix of outcomes),
-- equivalence partitioning of the calls (a first answer, a replay of an answered sale, an unknown code), boundary values
-- on the limits (500 ms p95, 2,500 ms maximum), and a check that the measurement itself is complete (every call was
-- measured and decided as intended, so a fast answer of the wrong kind cannot pass). The data are synthetic, nothing is
-- sent, every moment is read from the clock only for the timing, and the file rolls back.
begin;
select plan(7);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024001'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000024001'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000024001'::uuid as store_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024001'::uuid as programme_t,
  'eeeeeeee-eeee-4eee-8eee-000000024001'::uuid as staff_t;

insert into auth.users (id, instance_id, aud, role, email)
select staff_t, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'callback-timing-staff@example.com' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'callback-timing-pgtap', 'Callback timing pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'callback-timing', 'Synthetic timing account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_t, tenant_t, account_t, 'ct-1', 'Synthetic timing store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic timing programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

-- 1,000 members, each with 1,000 points to spend.
create temp table members (n integer primary key, membership_id uuid);
with customers as (
  insert into public.customers (tenant_id, phone)
  select fx.tenant_t, '+84' || '9' || lpad(g.n::text, 8, '0')
  from fx cross join generate_series(1, 1000) as g (n)
  returning id, phone
),
joined as (
  insert into public.memberships (tenant_id, programme_id, customer_id, channel, joined_at)
  select fx.tenant_t, fx.programme_t, c.id, 'mini_app', now() - interval '60 days'
  from fx cross join customers c
  returning id, customer_id
)
insert into members (n, membership_id)
select row_number() over (order by j.id)::integer, j.id from joined j;
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
select fx.tenant_t, fx.programme_t, m.membership_id, 'adjust', 0, 1000, 0, 'synthetic credit', now() + interval '300 days', now() - interval '50 days'
from fx cross join members m;

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, callback_ip_allowlist, active_from, callback_store_ref, callback_enabled)
select tenant_t, store_t, 'crm_callback'::public.coupon_rail, '{PRG-1}'::text[], '{}'::cidr[], now() - interval '90 days', 'POS-T', true from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_t, store_t, 'ten-pct', 'PRG-1', 'discount'::public.einvoice_display from fx;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, reward_amount, reward_item_external_ids, excluded_item_external_ids, min_bill_amount, cost_points, status)
select tenant_t, programme_t, 'ten-pct', 'Giảm 10%', 'percent_off'::public.coupon_reward_kind, 10, null, null::text[], '{}'::text[], 0, 10, 'active'::public.coupon_status from fx;

create temp table secret (segment text, path_sha256 text);
insert into secret (segment) select app.issue_voucher_callback_path(tenant_t, 'pos-crm') from fx;
update secret set path_sha256 = encode(sha256(convert_to(segment, 'UTF8')), 'hex');

-- 1,000 held redemptions through the real function.
create temp table held (n integer primary key, redemption_id uuid, code text);
insert into held (n, redemption_id, code)
select m.n, (a.answer ->> 'redemption_id')::uuid, a.answer ->> 'code'
from members m
cross join lateral (
  select app.redeem_coupon(m.membership_id, (select id from public.coupons where reward_key = 'ten-pct' and tenant_id = (select tenant_t from fx)), (select store_t from fx), now() - interval '1 hour') as answer
) a;

select is((select count(*)::integer from held where code ~ '^[A-Z0-9]{8}$'), 1000, 'the fixture: 1,000 held redemptions with a code each');

-- 10,000 answered sales: confirmed redemptions of the same members, their binding answers and their log rows.
insert into public.redemptions (tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at, confirmed_by, confirmed_at, rail)
select fx.tenant_t, fx.store_t, m.membership_id, (select id from public.coupons where reward_key = 'ten-pct' and tenant_id = fx.tenant_t),
  'D' || lpad(g.n::text, 7, '0'), 'confirmed', now() - interval '30 days' - g.n * interval '1 minute',
  now() - interval '30 days' - g.n * interval '1 minute' + interval '24 hours', fx.staff_t,
  now() - interval '30 days' - g.n * interval '1 minute' + interval '2 hours', 'crm_callback'::public.coupon_rail
from fx
cross join generate_series(1, 10000) as g (n)
join members m on m.n = (g.n % 1000) + 1;
insert into app.voucher_callback_answers (tenant_id, store_id, sale_ref, redemption_id, discount_amount, reward_name, answered_at)
select r.tenant_id, r.store_id, 'SALE-' || substr(r.code, 2), r.id, 5000, 'Giảm 10%', r.confirmed_at
from public.redemptions r where r.tenant_id = (select tenant_t from fx) and r.state = 'confirmed';
insert into app.voucher_callback_log (tenant_id, store_id, outcome, discount_amount, latency_ms, logged_at)
select a.tenant_id, a.store_id, 'accepted', a.discount_amount, 12, a.answered_at
from app.voucher_callback_answers a where a.tenant_id = (select tenant_t from fx);
analyze public.redemptions;
analyze public.memberships;
analyze public.customers;
analyze app.voucher_callback_answers;
analyze app.voucher_callback_log;

select is((select count(*)::integer from public.redemptions where tenant_id = (select tenant_t from fx) and state = 'held'), 1000, 'the load: 1,000 held redemptions');
select is((select count(*)::integer from app.voucher_callback_answers where tenant_id = (select tenant_t from fx)), 10000, 'the load: 10,000 answered sales');

-- 200 decisions, timed one by one: 120 first answers on distinct held codes, 40 replays of answered sales, 40 unknown codes.
create temp table measured (i integer primary key, kind text, outcome text, ms numeric);
create function pg_temp.measure()
returns void
language plpgsql
as $$
declare
  v_secret text := (select path_sha256 from secret);
  v_lines jsonb := '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]';
  v_kind text;
  v_code text;
  v_sale text;
  v_started timestamptz;
  v_answer jsonb;
  v_next_held integer := 0;
  v_next_sale integer := 0;
begin
  for i in 1..200 loop
    if i % 5 in (0, 1, 2) then
      v_kind := 'first';
      v_next_held := v_next_held + 1;
      select h.code into v_code from held h where h.n = v_next_held * 7;
      v_sale := 'NEW-' || i;
    elsif i % 5 = 3 then
      v_kind := 'replay';
      v_next_sale := v_next_sale + 1;
      v_code := 'D' || lpad((v_next_sale * 211)::text, 7, '0');
      v_sale := 'SALE-' || lpad((v_next_sale * 211)::text, 7, '0');
    else
      v_kind := 'unknown';
      v_code := 'ZZ' || lpad(i::text, 6, '0');
      v_sale := 'NEW-' || i;
    end if;
    v_started := clock_timestamp();
    v_answer := app.answer_voucher_callback(v_secret, '203.0.113.5'::inet, 'POS-T', 'PRG-1', v_code, v_sale, null, v_lines, clock_timestamp(), clock_timestamp());
    insert into measured (i, kind, outcome, ms)
    values (i, v_kind, v_answer ->> 'outcome', extract(epoch from (clock_timestamp() - v_started)) * 1000);
  end loop;
end;
$$;
select pg_temp.measure();

select is(
  (select string_agg(k.kind || ':' || k.n, ',' order by k.kind) from (select kind, count(*) as n from measured group by kind) k),
  'first:120,replay:40,unknown:40',
  'every one of the 200 calls was measured, in the planned mix'
);
select is(
  (select string_agg(o.outcome || ':' || o.n, ',' order by o.outcome) from (select outcome, count(*) as n from measured group by outcome) o),
  'accepted:120,replayed:40,unknown_code:40',
  'and each was decided as intended: 120 accepted, 40 replayed, 40 unknown codes (a fast answer of the wrong kind cannot pass)'
);
select diag(format('callback decision over 1,000 held and 10,000 answered: median %s ms, p95 %s ms, slowest %s ms',
  round((select percentile_cont(0.5) within group (order by ms) from measured)::numeric, 2),
  round((select percentile_cont(0.95) within group (order by ms) from measured)::numeric, 2),
  round((select max(ms) from measured)::numeric, 2)));
select cmp_ok(
  (select percentile_cont(0.95) within group (order by ms) from measured)::numeric, '<', 500::numeric,
  'the 95th percentile of the database decision is under 500 ms'
);
select cmp_ok(
  (select max(ms) from measured)::numeric, '<', 2500::numeric,
  'and the slowest is under the 2,500 ms busy limit'
);

select * from finish();
rollback;
