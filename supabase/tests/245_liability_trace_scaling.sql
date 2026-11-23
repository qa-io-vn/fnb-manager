-- The cohort trace of app.loyalty_liability at scale (review of G-104 / ADR-048, 2026-11-23): 20 members with
-- 130 weekly credits each and a weekly expiry row once the credits start to end, about two and a half years of
-- history. The trace of 20261123090000 ran a correlated subquery per expiry row and re-read the clawbacks of
-- each credit three times: it took 1.8 s, 8 s and 34 s for 10, 20 and 40 such members. Migration
-- 20261123180000 computes the same rows in one pass per run.
--
-- Techniques (ISTQB): performance (load) testing with a generous bound, regression (the cohorts still add up to
-- the ledger's expiry rows, and every traced cohort is a month credits were issued in), boundary values (a
-- credit that ends exactly at the moment of an expiry row is traced, one that ends a second later is not).
-- The rows are synthetic (adjust credits, no customer data) and the file rolls back.
begin;
select plan(6);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024501'::uuid as tenant_s,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024501'::uuid as programme_s,
  timestamptz '2025-01-06 10:00+07' as t0;

insert into public.tenants (id, slug, name, country_code) select tenant_s, 'trace-scaling-pgtap', 'Trace scaling pgTAP', 'VN' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_s, tenant_s, 'Synthetic programme', date '2025-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

insert into public.customers (tenant_id, phone, first_seen_at, last_seen_at)
select tenant_s, '+849002450' || lpad(n::text, 2, '0'), t0, t0 from fx, generate_series(1, 20) n;
insert into public.memberships (tenant_id, programme_id, customer_id, joined_at, channel)
select fx.tenant_s, fx.programme_s, c.id, fx.t0 - interval '1 day', 'import' from fx join public.customers c on c.tenant_id = fx.tenant_s;

-- 130 weekly credits of 10 points per member, each valid twelve months
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, value_amount, reason, expires_at, occurred_at)
select fx.tenant_s, fx.programme_s, m.id, 'adjust', 10, 5000, 'synthetic credit',
  fx.t0 + make_interval(weeks => w) + interval '12 months', fx.t0 + make_interval(weeks => w)
from fx cross join public.memberships m cross join generate_series(0, 129) w
where m.tenant_id = fx.tenant_s;

-- a weekly expiry row per member once credits end, each taking the credit that ended (10 points), and an
-- extra row at the exact end of a credit
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, value_amount, reason, occurred_at)
select fx.tenant_s, fx.programme_s, m.id, 'expire', -10, -5000, 'expired',
  fx.t0 + make_interval(weeks => w) + interval '12 months' + interval '1 day'
from fx cross join public.memberships m cross join generate_series(0, 76) w
where m.tenant_id = fx.tenant_s;

create temp table timing (started timestamptz, finished timestamptz, row_id uuid);
insert into timing (started) values (clock_timestamp());
update timing set row_id = app.loyalty_liability((select programme_s from fx), (select t0 from fx) + interval '130 weeks');
update timing set finished = clock_timestamp();

select is(
  (select count(*)::int from public.loyalty_ledger l where l.programme_id = (select programme_s from fx) and l.entry_kind = 'expire'),
  20 * 77,
  'the load: 20 members, 130 credits each and 77 expiry rows each'
);
select cmp_ok(
  (select extract(epoch from finished - started) from timing),
  '<',
  2.0::numeric,
  'performance: the nightly liability of the 20 members runs in under 2 seconds (the trace of 20261123090000 took about 8)'
);
select is(
  (select sum((c ->> 'expired')::bigint)::bigint from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c where d.id = (select row_id from timing)),
  (select sum(-l.point_delta)::bigint from public.loyalty_ledger l where l.programme_id = (select programme_s from fx) and l.entry_kind = 'expire'),
  'regression: the expired points of the cohorts add up to the ledger''s expiry rows'
);
select is(
  (select count(*)::int from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c
   where d.id = (select row_id from timing) and (c ->> 'expired')::int > 0 and (c ->> 'issued')::int = 0),
  0,
  'every cohort with expired points is a month credits were issued in: the whole expiry was traced'
);
select is(
  (select string_agg((c ->> 'month') || '=' || (c ->> 'expired'), ',' order by c ->> 'month') from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c
   where d.id = (select row_id from timing) and (c ->> 'month') in ('2025-01', '2027-06')),
  '2025-01=800,2027-06=0',
  'the first cohort (four weekly credits of 20 members) expired whole, the June 2027 one not at all'
);

-- boundary: a credit ending exactly at an expiry row's moment is traced, one ending a second later is not
create temp table edge as
select gen_random_uuid() as tenant_e, gen_random_uuid() as programme_e, gen_random_uuid() as member_e;
insert into public.tenants (id, slug, name, country_code) select tenant_e, 'trace-edge-pgtap', 'Trace edge pgTAP', 'VN' from edge;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_e, tenant_e, 'Synthetic programme', date '2025-01-01', 'below_threshold', 'active', 0 from edge;
insert into public.customers (tenant_id, phone, first_seen_at, last_seen_at) select tenant_e, '+' || '849002' || '45099', now(), now() from edge;
insert into public.memberships (id, tenant_id, programme_id, customer_id, joined_at, channel)
select member_e, tenant_e, programme_e, (select c.id from public.customers c where c.tenant_id = edge.tenant_e), timestamptz '2025-01-01 00:00+07', 'import' from edge;
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, value_amount, reason, expires_at, occurred_at)
select tenant_e, programme_e, member_e, 'adjust', v.points, 0, 'synthetic credit', v.ends, v.issued
from edge cross join (values
  (7, timestamptz '2026-03-01 00:00+07', timestamptz '2025-03-01 09:00+07'),
  (5, timestamptz '2026-03-01 00:00:01+07', timestamptz '2025-04-01 09:00+07')
) v (points, ends, issued);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, value_amount, reason, occurred_at)
select tenant_e, programme_e, member_e, 'expire', -7, 0, 'expired', timestamptz '2026-03-01 00:00+07' from edge;
create temp table edge_run as select app.loyalty_liability((select programme_e from edge), timestamptz '2026-03-02 04:00+07') as row_id;
select is(
  (select string_agg((c ->> 'month') || '=' || (c ->> 'expired'), ',' order by c ->> 'month')
   from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c
   where d.id = (select row_id from edge_run)),
  '2025-03=7,2025-04=0',
  'boundary values: the credit ending at the moment of the expiry row is traced (expires_at <= the run), the one ending a second later is not'
);

select * from finish();
rollback;
