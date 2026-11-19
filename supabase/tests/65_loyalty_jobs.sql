begin;
select plan(32);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006501'::uuid as tenant_j,
  'dddddddd-dddd-4ddd-8ddd-000000006502'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000006501'::uuid as account_j,
  'cccccccc-cccc-4ccc-8ccc-000000006502'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000006501'::uuid as store_j1,
  'ffffffff-ffff-4fff-8fff-000000006502'::uuid as store_j2,
  'ffffffff-ffff-4fff-8fff-000000006511'::uuid as store_o1,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006501'::uuid as programme_j,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006502'::uuid as programme_o,
  'eeeeeeee-eeee-4eee-8eee-000000006501'::uuid as owner_j,
  'eeeeeeee-eeee-4eee-8eee-000000006502'::uuid as staff_j,
  'eeeeeeee-eeee-4eee-8eee-000000006503'::uuid as publisher_j,
  timestamptz '2026-11-15 09:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'loyalty-jobs-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_j, fx.staff_j, fx.publisher_j]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_j, 'loyalty-jobs-pgtap', 'Loyalty jobs pgTAP' from fx
union all
select tenant_o, 'loyalty-breakage-pgtap', 'Loyalty breakage pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_j, tenant_j, 'mock', 'loyalty-jobs', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'loyalty-breakage', 'Synthetic account O' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_j1, tenant_j, account_j, 'lj-1', 'Synthetic store 1' from fx
union all
select store_j2, tenant_j, account_j, 'lj-2', 'Synthetic store 2' from fx
union all
select store_o1, tenant_o, account_o, 'lo-1', 'Synthetic store O1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_j, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values (fx.owner_j, 'owner', null::uuid[]), (fx.staff_j, 'staff', array[fx.store_j1]), (fx.publisher_j, 'publisher', array[fx.store_j1])) as m (user_id, role, store_ids);

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_j, tenant_j, 'Synthetic programme J', date '2025-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx
union all
select programme_o, tenant_o, 'Synthetic programme O', date '2025-01-01', 'notified', 'active', 0 from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'member_' || n, app.loyalty_join((select tenant_j from fx), app.loyalty_customer_for_phone((select tenant_j from fx), '+849000065' || lpad(n::text, 2, '0')), 'mini_app', (select store_j1 from fx), null, null, timestamptz '2026-01-01 09:00+07')
from generate_series(1, 4) n;
insert into ids
select 'other_1', app.loyalty_join((select tenant_o from fx), app.loyalty_customer_for_phone((select tenant_o from fx), '+' || '84900006591'), 'mini_app', (select store_o1 from fx), null, null, timestamptz '2025-01-02 09:00+07');

select is(
  (select concat_ws(':', coalesced, run_after = (select t0 from fx)) from app.request_fast_lane((select store_j1 from fx), 'checkin', (select t0 from fx))),
  'f:t',
  'a first fast-lane request opens a run due at once'
);
select is(
  (select coalesced::text from app.request_fast_lane((select store_j1 from fx), 'claim', (select t0 from fx) + interval '2 minutes')),
  'true',
  'a second request within five minutes joins it'
);
select is(
  (select concat_ws(':', count(*), sum(requests), max(array_to_string(reasons, '+'))) from app.loyalty_fast_lane_runs where store_id = (select store_j1 from fx)),
  '1:2:checkin+claim',
  'two requests within five minutes start one run'
);
select is(
  (select concat_ws(':', count(*), max(window_to - window_from)) from app.claim_fast_lane_runs((select t0 from fx) + interval '3 minutes')),
  '1:01:00:00',
  'the runner claims the run once, over the last 60 minutes'
);
select is((select count(*)::int from app.claim_fast_lane_runs((select t0 from fx) + interval '3 minutes')), 0, 'a claimed run is not handed out twice');
select is(
  (select concat_ws(':', coalesced, run_after - (select t0 from fx)) from app.request_fast_lane((select store_j1 from fx), 'checkin', (select t0 from fx) + interval '4 minutes')),
  'f:00:05:00',
  'a request while the run is under way opens the next run five minutes after the first'
);
select is((select count(*)::int from app.claim_fast_lane_runs((select t0 from fx) + interval '4 minutes 30 seconds')), 0, 'the next run is not due before then');
select is((select count(*)::int from app.claim_fast_lane_runs((select t0 from fx) + interval '5 minutes')), 1, 'it is due five minutes after the first');
select is(
  (select concat_ws(':', coalesced, run_after = (select t0 from fx) + interval '11 minutes') from app.request_fast_lane((select store_j1 from fx), 'claim', (select t0 from fx) + interval '11 minutes')),
  'f:t',
  'a request after five minutes starts another run at once'
);
select is(
  (select coalesced::text from app.request_fast_lane((select store_j2 from fx), 'claim', (select t0 from fx) + interval '11 minutes')),
  'false',
  'each store has its own lane'
);
select is((select count(*)::int from app.claim_fast_lane_runs((select t0 from fx) + interval '3 hours')), 0, 'requests left unclaimed for an hour are dropped');
select is(
  (select count(*)::int from app.loyalty_fast_lane_runs where outcome = 'expired' and tenant_id = (select tenant_j from fx)),
  2,
  'and recorded as expired'
);
select lives_ok(
  format('select app.finish_fast_lane_run(%L, %L)', (select id from app.loyalty_fast_lane_runs where store_id = (select store_j1 from fx) order by requested_at limit 1), 'ran'),
  'a finished run records its outcome'
);

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_phone text)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
    select fx.tenant_j, fx.store_j1, fx.account_j, 'lj-' || p_name, right(p_name, 4), p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net, p_phone
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted returning id;
$$;

select pg_temp.invoice('inv_1', timestamptz '2026-11-14 10:00+07', 120000, '0900006501');
select pg_temp.invoice('inv_2', timestamptz '2026-11-14 11:00+07', 75000, '0900006502');
select pg_temp.invoice('inv_3', timestamptz '2026-11-14 12:00+07', 60000, '0900006503');
select is(
  (app.reconcile_loyalty((select tenant_j from fx), date '2026-11-14', date '2026-11-14', timestamptz '2026-11-14 13:00+07') ->> 'a_earned')::int,
  3,
  'three invoices earn'
);
update public.invoices set status = 'voided' where id = (select id from ids where name = 'inv_3');
select is(
  app.loyalty_nightly((select tenant_j from fx), timestamptz '2026-11-15 04:00+07'),
  '{"clawbacks": 1, "liability_rows": 1, "expired_points": 0, "expired_stamps": 0, "expired_memberships": 0, "released_holds": 0, "quarantined_codes": 0, "late_confirmed_holds": 0}'::jsonb,
  'the nightly step reverses the earn of the invoice voided by the re-pull'
);
select is(
  (select concat_ws(':', stamps, points) from app.loyalty_balance((select id from ids where name = 'member_3'))),
  '0:0',
  'the voided invoice no longer counts'
);
select is(
  (app.loyalty_nightly((select tenant_j from fx), timestamptz '2026-11-15 04:00+07') ->> 'clawbacks')::int,
  0,
  'a second nightly run reverses nothing more'
);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, reason, occurred_at)
select fx.tenant_j, fx.programme_j, m.id, 'adjust', -30, 'synthetic correction', timestamptz '2026-11-15 05:00+07'
from fx, ids m where m.name = 'member_4';
select pg_temp.invoice('pending_inv', timestamptz '2026-11-15 06:00+07', 90000, null);
select e.entry_id from app.loyalty_earn((select id from ids where name = 'pending_inv'), (select id from ids where name = 'member_4'), 'B', timestamptz '2026-11-15 06:30+07', true) e;

select isnt(app.loyalty_liability((select programme_j from fx), timestamptz '2026-11-15 23:00+07'), null, 'the liability of a day is stored');
select is(
  (
    select concat_ws(':', members, outstanding_points, outstanding_stamps, point_value_amount, expected_breakage_rate, breakage_source, liability_amount)
    from public.loyalty_liability_daily
    where programme_id = (select programme_j from fx) and as_of_date = date '2026-11-15'
  ),
  '4:19:2:500.00:0.200:configured:7600.00',
  'outstanding 12 + 7 points (a negative balance and a pending earn excluded) x 500 x (1 - 0.2) = 7,600'
);
select is(
  (
    select concat_ws(':', points_issued, points_clawed_back, points_redeemed, points_expired)
    from public.loyalty_liability_daily
    where programme_id = (select programme_j from fx) and as_of_date = date '2026-11-15'
  ),
  '9:6:0:0',
  'the day''s flows count the points issued (the pending earn among them) and the clawback'
);
select is(
  (select count(*)::int from public.loyalty_liability_daily where programme_id = (select programme_j from fx)),
  1,
  'the nightly run and a later run of the same day share one row'
);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, reason, expires_at, occurred_at)
select fx.tenant_o, fx.programme_o, m.id, 'adjust', 400, 'synthetic opening balance', null, timestamptz '2025-01-02 09:00+07'
from fx, ids m where m.name = 'other_1';
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, reason, occurred_at)
select fx.tenant_o, fx.programme_o, m.id, 'expire', -30, 'expired', timestamptz '2026-04-01 00:00+07'
from fx, ids m where m.name = 'other_1';
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, occurred_at)
select fx.tenant_o, fx.programme_o, m.id, 'redeem', -90, timestamptz '2026-11-01 10:00+07'
from fx, ids m where m.name = 'other_1';
select app.loyalty_liability((select programme_o from fx), timestamptz '2026-11-15 23:00+07');
select is(
  (
    select concat_ws(':', outstanding_points, expected_breakage_rate, breakage_source, liability_amount)
    from public.loyalty_liability_daily
    where programme_id = (select programme_o from fx)
  ),
  '280:0.250:observed:105000.00',
  'with six months of expiry data the observed breakage 30 / (30 + 90) applies: 280 x 500 x 0.75 = 105,000'
);
select is(
  (select breakage_by_cohort from public.loyalty_liability_daily where programme_id = (select programme_o from fx)),
  '[{"month": "2025-01", "issued": 400, "expired": 0}, {"month": "2025-04", "issued": 0, "expired": 30}]'::jsonb,
  'breakage is reported by issue month'
);

insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select fx.tenant_j, m.id, l.id, timestamptz '2026-01-01 09:00+07', timestamptz '2026-07-01 09:00+07'
from fx, ids m, public.loyalty_ledger l
where m.name = 'member_1' and l.membership_id = m.id and l.entry_kind = 'earn';
select is(
  (app.loyalty_nightly((select tenant_j from fx), timestamptz '2026-11-16 04:00+07') ->> 'expired_stamps')::int,
  1,
  'the nightly step expires stamps past their validity'
);

select is((select array_agg(slug order by slug) from app.loyalty_tenants() where slug like 'loyalty-%-pgtap'), array['loyalty-breakage-pgtap', 'loyalty-jobs-pgtap'], 'the nightly step lists the tenants with a programme');

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

grant select on fx to authenticated;
set local role authenticated;
select is(pg_temp.value_as((select owner_j from fx), 'select count(*)::text from public.loyalty_liability_daily'), '2', 'an owner reads the liability');
select is(pg_temp.value_as((select staff_j from fx), 'select count(*)::text from public.loyalty_liability_daily'), '0', 'staff read no liability');
select is(pg_temp.value_as((select publisher_j from fx), 'select count(*)::text from public.loyalty_liability_daily'), '0', 'the publisher reads no liability');
select is(
  pg_temp.value_as((select owner_j from fx), format('select app.loyalty_nightly(%L)::text', (select tenant_j from fx))),
  'error:42501',
  'an owner cannot run the nightly step'
);
select is(
  pg_temp.value_as((select owner_j from fx), format('select run_id::text from app.request_fast_lane(%L)', (select store_j1 from fx))),
  'error:42501',
  'nor request a fast-lane run directly'
);
select is(
  pg_temp.value_as((select owner_j from fx), 'select count(*)::text from app.loyalty_fast_lane_runs'),
  'error:42501',
  'nor read the fast-lane runs'
);
reset role;

set local role anon;
select throws_ok('select count(*) from public.loyalty_liability_daily', '42501', null, 'anon reads no liability');
reset role;

select * from finish();
rollback;
