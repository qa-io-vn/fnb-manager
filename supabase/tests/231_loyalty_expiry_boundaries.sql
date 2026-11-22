-- Expiry boundaries of the loyalty ledger (G-17), SQL as the unit under test.
-- Every moment is fixed: sales, holds and every run of app.loyalty_nightly and
-- app.loyalty_expire carry their own explicit time, nothing reads now().
--
-- Techniques (ISTQB):
--   * Boundary value analysis on the end of the 6-month stamp period and the
--     12-month point period of a credit sold on 2026-05-19: the day before, the
--     day itself and the day after, each at the nightly hour (04:00 local), and
--     the exact instant of the expiry at one second before, at, and (through
--     the nightly) after it. Three credits (02:00, 09:00 and 23:30 local) tell
--     apart "the day" from "the moment". A fourth, sold on 31 August, puts the
--     6-month boundary on the clamped 28 February.
--   * State transition testing: a hold released before the first expiry, and a
--     hold that outlives the first expiry and is released after it.
--   * Negative cases: nothing expires early, a second run adds nothing, another
--     tenant's runs leave this tenant's holds and balances alone.
--   * Security: the jobs return counts only, no API role runs them.
--
-- The rule the SQL implements (docs/schema.md fixes the period, not the day):
-- a credit's expiry is the moment of the sale plus the programme's months
-- (stamps.expires_at, loyalty_ledger.expires_at, set by app.loyalty_earn);
-- app.loyalty_expire expires every credit whose expires_at is on or before the
-- moment it runs (expires_at <= as_of), and app.redemption_spendable_stamps
-- lets a stamp be spent while expires_at > the moment. So a credit lives to
-- the same time of day as its sale, and at the nightly hour of the anniversary
-- it is expired only when it was sold before that hour.
begin;
select plan(51);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000023101'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000023102'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000023101'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000023102'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000023101'::uuid as store_a,
  'ffffffff-ffff-4fff-8fff-000000023102'::uuid as store_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000023101'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000023102'::uuid as programme_b;

insert into public.tenants (id, slug, name, country_code)
select tenant_a, 'expiry-boundaries-a-pgtap', 'Expiry boundaries pgTAP A', 'VN' from fx
union all
select tenant_b, 'expiry-boundaries-b-pgtap', 'Expiry boundaries pgTAP B', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'expiry-boundaries-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'expiry-boundaries-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a, tenant_a, account_a, 'eb-a', 'Synthetic store A' from fx
union all
select store_b, tenant_b, account_b, 'eb-b', 'Synthetic store B' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_a, tenant_a, 'Synthetic programme A', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx
union all
select programme_b, tenant_b, 'Synthetic programme B', date '2026-01-01', 'below_threshold', 'active', 0 from fx;

create temp table ids (name text primary key, id uuid);
create temp table holds (name text primary key, answer jsonb);

insert into ids
select v.name, app.loyalty_join(v.tenant, app.loyalty_customer_for_phone(v.tenant, v.phone), 'mini_app', v.store, null, null, timestamptz '2026-05-01 09:00+07')
from fx
cross join lateral (
  values
    ('early', fx.tenant_a, fx.store_a, '0900' || '023101'),
    ('mid', fx.tenant_a, fx.store_a, '0900' || '023102'),
    ('late', fx.tenant_a, fx.store_a, '0900' || '023103'),
    ('clamp', fx.tenant_a, fx.store_a, '0900' || '023104'),
    ('rel_a', fx.tenant_b, fx.store_b, '0900' || '023201'),
    ('rel_b', fx.tenant_b, fx.store_b, '0900' || '023202')
) as v (name, tenant, store, phone);

create function pg_temp.invoice(p_name text, p_tenant uuid, p_store uuid, p_account uuid, p_sold timestamptz, p_net numeric)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    values (p_tenant, p_store, p_account, 'eb-' || p_name, right(p_name, 4), p_sold, app.store_business_date(p_store, p_sold), p_net, p_net, p_net)
    returning id
  )
  insert into ids (name, id) select 'inv_' || p_name, inserted.id from inserted returning id;
$$;

create function pg_temp.earn(p_invoice text, p_member text)
returns text
language sql
as $$
  select concat_ws(':', coalesce(e.refusal, '-'), e.stamps, e.points)
  from app.loyalty_earn(
    (select id from ids where name = p_invoice),
    (select id from ids where name = p_member),
    'A',
    (select i.sold_at from public.invoices i where i.id = (select id from ids where name = p_invoice)) + interval '5 minutes'
  ) e;
$$;

create function pg_temp.bal(p_names text[])
returns text
language sql
as $$
  select string_agg(b.stamps || ':' || b.points, ',' order by n.ord)
  from unnest(p_names) with ordinality as n (name, ord)
  cross join lateral app.loyalty_balance((select id from ids where name = n.name)) b;
$$;

-- stamps:points:released of one nightly step of a tenant at a fixed moment
create function pg_temp.night(p_tenant uuid, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', r ->> 'expired_stamps', r ->> 'expired_points', r ->> 'released_holds')
  from (select app.loyalty_nightly(p_tenant, p_at) as r) x;
$$;

-- stamps:points of one expiry run at a fixed moment
create function pg_temp.expire(p_tenant uuid, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', r ->> 'stamps', r ->> 'points')
  from (select app.loyalty_expire(p_tenant, p_at) as r) x;
$$;

create function pg_temp.spendable(p_member text, p_at timestamptz)
returns integer
language sql
as $$
  select count(*)::integer from app.redemption_spendable_stamps((select id from ids where name = p_member), p_at);
$$;

create function pg_temp.local_time(p_at timestamptz)
returns text
language sql
as $$
  select to_char(p_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI');
$$;

-- Tenant A: four credits. early, mid and late are sold on 2026-05-19 at 02:00,
-- 09:00 and 23:30 local; clamp is sold on 2026-08-31 at noon.
select pg_temp.invoice('0001', (select tenant_a from fx), (select store_a from fx), (select account_a from fx), timestamptz '2026-05-19 02:00+07', 60000);
select pg_temp.invoice('0002', (select tenant_a from fx), (select store_a from fx), (select account_a from fx), timestamptz '2026-05-19 09:00+07', 60000);
select pg_temp.invoice('0003', (select tenant_a from fx), (select store_a from fx), (select account_a from fx), timestamptz '2026-05-19 23:30+07', 60000);
select pg_temp.invoice('0004', (select tenant_a from fx), (select store_a from fx), (select account_a from fx), timestamptz '2026-08-31 12:00+07', 60000);

select is(
  pg_temp.earn('inv_0001', 'early') || ',' || pg_temp.earn('inv_0002', 'mid') || ',' || pg_temp.earn('inv_0003', 'late') || ',' || pg_temp.earn('inv_0004', 'clamp'),
  '-:1:6,-:1:6,-:1:6,-:1:6',
  'each 60,000 sale credits one stamp and six points'
);
select is(
  (select string_agg(pg_temp.local_time(s.expires_at), ',' order by s.earned_at)
   from public.stamps s where s.tenant_id = (select tenant_a from fx) and s.membership_id in (select id from ids where name in ('early', 'mid', 'late'))),
  '2026-11-19 02:00,2026-11-19 09:00,2026-11-19 23:30',
  'boundary values: a stamp of a sale on 2026-05-19 ends six months on, on 2026-11-19, at the time of day of its sale'
);
select is(
  (select string_agg(pg_temp.local_time(l.expires_at), ',' order by l.occurred_at)
   from public.loyalty_ledger l where l.tenant_id = (select tenant_a from fx) and l.entry_kind = 'earn' and l.membership_id in (select id from ids where name in ('early', 'mid', 'late'))),
  '2027-05-19 02:00,2027-05-19 09:00,2027-05-19 23:30',
  'boundary values: the points of that sale end twelve months on, on 2027-05-19, at the time of day of the sale'
);
select is(
  (select pg_temp.local_time(s.expires_at) from public.stamps s where s.membership_id = (select id from ids where name = 'clamp')),
  '2027-02-28 12:00',
  'boundary values: six months from 31 August is 28 February, never a day in March'
);
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '1:6,1:6,1:6,1:6', 'all four members start with one stamp and six points');

-- Tenant B: one member earns a stamp and six points (rel_a) and holds a reward
-- for both on 2026-06-01, one earns four points only (rel_b). The hold of rel_b
-- comes later in the timeline. Built before tenant A's runs so that they can be
-- shown to leave tenant B alone.
select pg_temp.invoice('0101', (select tenant_b from fx), (select store_b from fx), (select account_b from fx), timestamptz '2026-05-19 09:00+07', 60000);
select pg_temp.invoice('0102', (select tenant_b from fx), (select store_b from fx), (select account_b from fx), timestamptz '2026-05-19 09:00+07', 40000);
select is(
  pg_temp.earn('inv_0101', 'rel_a') || ',' || pg_temp.earn('inv_0102', 'rel_b'),
  '-:1:6,below_minimum:0:4',
  'equivalence partitions of the second tenant: a sale of 60,000 earns a stamp and six points, one of 40,000 four points and no stamp'
);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_b, store_b, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], timestamptz '2026-01-01 00:00+07' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_b, store_b, 'syn-both', 'Synthetic entry both', null, 'discount'::public.einvoice_display from fx
union all
select tenant_b, store_b, 'syn-points', 'Synthetic entry points', null, 'discount' from fx;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_b, programme_b, 'syn-both', 'Synthetic reward for a stamp and points', 'free_item'::public.coupon_reward_kind, null::numeric, 1, 6, null::uuid[], 'active'::public.coupon_status from fx
union all
select tenant_b, programme_b, 'syn-points', 'Synthetic reward for points', 'free_item', null, 0, 4, null::uuid[], 'active' from fx;

insert into holds
select 'rel_a', app.redeem_coupon((select id from ids where name = 'rel_a'), (select id from public.coupons where reward_key = 'syn-both' and tenant_id = (select tenant_b from fx)), (select store_b from fx), timestamptz '2026-06-01 10:00+07');
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'stamps_spent', answer ->> 'points_spent', pg_temp.bal(array['rel_a'])) from holds where name = 'rel_a'),
  'held:1:6:0:0',
  'state transition: the hold of 2026-06-01 takes the stamp and the six points'
);

-- Stamps of tenant A, 6 months: the day before, the day itself, the day after.
select is(pg_temp.night((select tenant_a from fx), timestamptz '2026-11-18 04:00+07'), '0:0:0', 'boundary values: the nightly step the day before the six months end expires nothing');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '1:6,1:6,1:6,1:6', 'and every stamp is still spendable the day before');
select is(
  pg_temp.spendable('late', timestamptz '2026-11-19 23:29:59+07') || ':' || pg_temp.spendable('late', timestamptz '2026-11-19 23:30:00+07'),
  '1:0',
  'boundary values: a stamp can be spent one second before its expiry and not at the moment it ends'
);
select is(
  pg_temp.night((select tenant_a from fx), timestamptz '2026-11-19 04:00+07'),
  '1:0:0',
  'the day itself: the nightly step at 04:00 expires only the stamp sold at 02:00, whose six months ended at 02:00'
);
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:6,1:6,1:6,1:6', 'the stamps sold at 09:00 and 23:30 are still spendable on the day itself, the points are untouched');
select is(pg_temp.expire((select tenant_a from fx), timestamptz '2026-11-19 08:59:59+07'), '0:0', 'boundary values: one second before the 09:00 stamp ends, nothing expires');
select is(pg_temp.expire((select tenant_a from fx), timestamptz '2026-11-19 09:00:00+07'), '1:0', 'boundary values: at the moment the 09:00 stamp ends it expires (expires_at <= the moment)');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:6,0:6,1:6,1:6', 'the 23:30 stamp is still there at 09:00');
select is(pg_temp.night((select tenant_a from fx), timestamptz '2026-11-20 04:00+07'), '1:0:0', 'boundary values: the nightly step the day after expires the stamp sold at 23:30');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:6,0:6,0:6,1:6', 'the day after, all three stamps of 2026-05-19 are expired and their six points are untouched');
create temp table second_run as select app.loyalty_nightly((select tenant_a from fx), timestamptz '2026-11-20 04:00+07') as r;
select is(
  (select concat_ws(':', r ->> 'expired_stamps', r ->> 'expired_points', r ->> 'expired_memberships') from second_run),
  '0:0:0',
  'negative case: a second nightly step at the same moment expires nothing more'
);

-- The clamped boundary of the 31 August stamp: 28 February 2027 at noon.
select is(pg_temp.night((select tenant_a from fx), timestamptz '2027-02-28 04:00+07'), '0:0:0', 'boundary values: the stamp of 31 August is still there on 28 February before noon');
select is(pg_temp.night((select tenant_a from fx), timestamptz '2027-03-01 04:00+07'), '1:0:0', 'boundary values: it expires by 1 March, the clamped end, not later');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:6,0:6,0:6,0:6', 'and now no member holds a stamp');

-- Points of tenant A, 12 months.
select is(pg_temp.night((select tenant_a from fx), timestamptz '2027-05-18 04:00+07'), '0:0:0', 'boundary values: the nightly step the day before the twelve months end expires no point');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:6,0:6,0:6,0:6', 'and every member keeps six points the day before');
select is(pg_temp.night((select tenant_a from fx), timestamptz '2027-05-19 04:00+07'), '0:6:0', 'the day itself: the nightly step at 04:00 expires only the six points sold at 02:00');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:0,0:6,0:6,0:6', 'the points sold at 09:00 and 23:30 are still there on the day itself');
select is(
  app.loyalty_expiring_points((select id from ids where name = 'mid'), timestamptz '2027-05-19 08:59:59+07')
    || ':' || app.loyalty_expiring_points((select id from ids where name = 'mid'), timestamptz '2027-05-19 09:00:00+07'),
  '0:6',
  'boundary values: the points about to expire are 0 one second before the 09:00 credit ends and 6 at that moment'
);
select is(pg_temp.expire((select tenant_a from fx), timestamptz '2027-05-19 08:59:59+07'), '0:0', 'boundary values: one second before, the expiry run takes no point');
select is(pg_temp.expire((select tenant_a from fx), timestamptz '2027-05-19 09:00:00+07'), '0:6', 'boundary values: at the moment the credit ends the expiry run takes its six points');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:0,0:0,0:6,0:6', 'the 23:30 points are still there at 09:00');
select is(pg_temp.night((select tenant_a from fx), timestamptz '2027-05-20 04:00+07'), '0:6:0', 'boundary values: the nightly step the day after expires the points sold at 23:30');
select is(pg_temp.bal(array['early', 'mid', 'late', 'clamp']), '0:0,0:0,0:0,0:6', 'the day after, the points of 2026-05-19 are all expired and the 31 August credit still holds its six');
create temp table repeat_run as select app.loyalty_nightly((select tenant_a from fx), timestamptz '2027-05-20 04:00+07') as r;
select is(
  (select concat_ws(':', r ->> 'expired_stamps', r ->> 'expired_points', r ->> 'expired_memberships') from repeat_run),
  '0:0:0',
  'negative case: a second run of the same night expires no point either'
);
select is(
  (select concat_ws(':', count(*), sum(stamp_delta), sum(point_delta), bool_and(reason = 'expired')) from public.loyalty_ledger where tenant_id = (select tenant_a from fx) and entry_kind = 'expire'),
  '7:-4:-18:t',
  'the ledger holds seven expire rows (four for stamps, three for points) that take four stamps and 18 points in all, each with the reason expired'
);
select is(
  (select string_agg(distinct s.state::text, ',') from public.stamps s where s.tenant_id = (select tenant_a from fx)),
  'expired',
  'all four stamps rows are closed as expired'
);

-- Another tenant's runs leave tenant B alone (tenant B has not run its own step).
select is(
  (select concat_ws(':', (select count(*) from public.loyalty_ledger l where l.tenant_id = (select tenant_b from fx) and l.entry_kind = 'expire'), r.state, (select s.state::text from public.stamps s where s.membership_id = (select id from ids where name = 'rel_a'))) from public.redemptions r where r.membership_id = (select id from ids where name = 'rel_a')),
  '0:held:redeemed',
  'negative case: after tenant A ran its steps up to 2027-05-20, tenant B''s hold is still held, its stamp is still closed and nothing of it expired'
);

-- Tenant B: points and a stamp returned by a release keep their first expiry.
select is(pg_temp.night((select tenant_b from fx), timestamptz '2026-06-03 04:00+07'), '0:0:1', 'state transition: the nightly step after the hold ended releases it (the stamp and the points go back)');
select is(pg_temp.bal(array['rel_a']), '1:6', 'the member has the stamp and the six points again');
select is(
  (select concat_ws(':', s.state, pg_temp.local_time(s.expires_at)) from public.stamps s where s.membership_id = (select id from ids where name = 'rel_a')),
  'active:2026-11-19 09:00',
  'a stamp returned by a release is active again with its first expiry, not six months from the release'
);
select is(
  (select concat_ws(':', l.entry_kind, l.reason, l.point_delta, l.expires_at is null, l.source_entry_id = (select r.redeem_entry_id from public.redemptions r where r.membership_id = l.membership_id))
   from public.loyalty_ledger l where l.membership_id = (select id from ids where name = 'rel_a') and l.reason = 'redemption_released'),
  'adjust:redemption_released:6:t:t',
  'the six points a release gives back are no new credit: the row has no expiry and names the hold it cancels'
);
select is(pg_temp.night((select tenant_b from fx), timestamptz '2026-11-18 04:00+07'), '0:0:0', 'boundary values: the day before the first expiry the returned stamp and points are not expired');
select is(
  pg_temp.night((select tenant_b from fx), timestamptz '2026-11-20 04:00+07') || ' ' || pg_temp.bal(array['rel_a']),
  '1:0:0 0:6',
  'boundary values: the day after the first expiry the returned stamp expires, although the release is under six months old, and the returned points are untouched'
);
select is(pg_temp.night((select tenant_b from fx), timestamptz '2027-05-18 04:00+07'), '0:0:0', 'boundary values: the day before the twelve months end the returned points are not expired');
insert into holds
select 'rel_b', app.redeem_coupon((select id from ids where name = 'rel_b'), (select id from public.coupons where reward_key = 'syn-points' and tenant_id = (select tenant_b from fx)), (select store_b from fx), timestamptz '2027-05-19 08:00+07');
select is(
  (select concat_ws(':', answer ->> 'state', answer ->> 'points_spent', pg_temp.bal(array['rel_b'])) from holds where name = 'rel_b'),
  'held:4:0:0',
  'state transition: an hour before its credit ends, the second member holds a reward for four points'
);
select is(
  pg_temp.night((select tenant_b from fx), timestamptz '2027-05-20 04:00+07') || ' ' || pg_temp.bal(array['rel_a', 'rel_b']),
  '0:6:0 0:0,0:0',
  'boundary values: the day after, the six points returned in June expire at their first expiry (11 months after the release), and the four points on hold do not expire while held'
);
select is(
  (select r.state::text from public.redemptions r where r.membership_id = (select id from ids where name = 'rel_b')),
  'held',
  'the hold is still held at 04:00, four hours before it ends'
);
select is(
  pg_temp.night((select tenant_b from fx), timestamptz '2027-05-21 04:00+07') || ' ' || pg_temp.bal(array['rel_b']),
  '0:4:1 0:0',
  'state transition: released after the first expiry has passed, the returned four points expire the same night'
);
select is(
  (select concat_ws(':', count(*), sum(stamp_delta), sum(point_delta)) from public.loyalty_ledger where tenant_id = (select tenant_b from fx) and entry_kind = 'expire'),
  '3:-1:-10',
  'tenant B''s ledger holds three expire rows, one stamp and ten points in all, each from its first expiry'
);

-- Security: counts only, and no API role runs the jobs.
select is(
  (select (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k) || ':' || (select bool_and(jsonb_typeof(v) = 'number') from jsonb_each(r) e (k, v)) from repeat_run),
  'clawbacks,expired_memberships,expired_points,expired_stamps,late_confirmed_holds,liability_rows,quarantined_codes,released_holds:true',
  'security: the nightly step answers eight counts and nothing else, no phone, code or name'
);
select is(
  (select concat_ws(':', bool_and(l.invoice_id is null), bool_and(l.matched_path is null), bool_and(l.approved_by is null))
   from public.loyalty_ledger l where l.entry_kind = 'expire' and l.tenant_id in ((select tenant_a from fx), (select tenant_b from fx))),
  't:t:t',
  'security: an expire row names no invoice, no path and no approver'
);
select ok(
  not has_function_privilege('authenticated', 'app.loyalty_expire(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_expiring_points(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_nightly(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_expire(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_expiring_points(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_nightly(uuid, timestamptz)', 'execute'),
  'security: a signed-in user and anon run no expiry function'
);
select ok(
  has_function_privilege('service_role', 'app.loyalty_expire(uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.loyalty_expiring_points(uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.loyalty_nightly(uuid, timestamptz)', 'execute'),
  'the service role, which the jobs use, runs all three'
);

select * from finish();
rollback;
