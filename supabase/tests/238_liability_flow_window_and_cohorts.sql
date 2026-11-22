-- The flow window and the breakage cohorts of the nightly liability row (G-104, ADR-048).
--
-- F2: the issued, redeemed, expired and clawed-back points of a row are those of the closed previous
--     local day, from its first moment to the first moment of the row's own day, whatever the hour of the
--     run. F1: an expiry is reported under the month its credit was issued, traced first in first out.
--
-- Techniques (ISTQB): boundary value analysis (rows at the last millisecond before the flow day, at its
-- first instant, at its last millisecond and at the first instant of the row's own day; a credit sold
-- on 31 October that expires on the run of 1 November), equivalence partitioning of the member
-- histories (spent in part, spent beyond the oldest credit, spent in full, two runs one after the
-- other, a credit clawed back, a credit that cannot be traced), decision table for the trace (credits
-- past their expiry x points spent x clawbacks), and an oracle in the ledger itself (the cohorts' expired
-- points add up to the expiry rows). Regression: a re-run of a night stores the same row.
--
-- Every moment is explicit (nothing reads now()), phones are synthetic (0900000911 to 0900000918),
-- nothing is sent, and the file rolls back.
begin;
select plan(14);

set local timezone = 'UTC';
update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000023801'::uuid as tenant_w,
  'cccccccc-cccc-4ccc-8ccc-000000023801'::uuid as account_w,
  'ffffffff-ffff-4fff-8fff-000000023801'::uuid as store_w,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000023801'::uuid as programme_w;

insert into public.tenants (id, slug, name)
select tenant_w, 'liability-window-pgtap', 'Liability window pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_w, tenant_w, 'mock', 'liability-window', 'Synthetic window account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_w, tenant_w, account_w, 'lw-s1', 'Synthetic window store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_w, tenant_w, 'Synthetic window programme', date '2025-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members (name text primary key, membership_id uuid);
insert into members
select m.name, app.loyalty_join(
  fx.tenant_w,
  app.loyalty_customer_for_phone(fx.tenant_w, m.phone, timestamptz '2025-01-01 08:00+07'),
  'mini_app', fx.store_w, null, null, timestamptz '2025-01-01 09:00+07'
)
from fx
cross join (values
  ('m1', '0900000911'), ('m2', '0900000912'), ('m3', '0900000913'), ('m4', '0900000914'),
  ('m5', '0900000915'), ('m6', '0900000916'), ('m7', '0900000917'), ('m8', '0900000918')
) as m (name, phone);

create temp table refs (ref text primary key, invoice_id uuid);

-- One earn of 60,000 (6 points at the default rate) for a member, sold and credited at the same moment.
create function pg_temp.earn(p_ref text, p_member text, p_at timestamptz)
returns void
language plpgsql
as $$
declare
  v_invoice uuid;
begin
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, source_name, status)
  select fx.tenant_w, fx.store_w, fx.account_w, p_ref, right(p_ref, 4), p_at, (p_at at time zone 'Asia/Ho_Chi_Minh')::date, 60000, 60000, 60000, 'tai-quan', 'completed'
  from fx
  returning id into v_invoice;
  insert into refs (ref, invoice_id) values (p_ref, v_invoice);
  perform app.loyalty_earn(v_invoice, (select membership_id from members where name = p_member), 'A', p_at, false);
end;
$$;

create function pg_temp.spend(p_member text, p_points integer, p_at timestamptz)
returns void
language sql
as $$
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, occurred_at)
  select fx.tenant_w, fx.programme_w, m.membership_id, 'redeem', -p_points, p_at
  from fx, members m where m.name = p_member;
$$;

create function pg_temp.adjust(p_member text, p_points integer, p_at timestamptz)
returns void
language sql
as $$
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, reason, expires_at, occurred_at)
  select fx.tenant_w, fx.programme_w, m.membership_id, 'adjust', p_points, 'synthetic credit', null, p_at
  from fx, members m where m.name = p_member;
$$;

create function pg_temp.row_doc(p_date date)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'members', d.members,
    'outstanding', d.outstanding_points,
    'issued', d.points_issued,
    'redeemed', d.points_redeemed,
    'expired', d.points_expired,
    'clawed', d.points_clawed_back,
    'released', d.deferred_revenue_released_amount,
    'cohorts', d.breakage_by_cohort
  )
  from public.loyalty_liability_daily d
  where d.programme_id = (select programme_w from fx) and d.as_of_date = p_date;
$$;

create function pg_temp.flows(p_date date)
returns text
language sql
as $$
  select concat_ws(':', d.points_issued, d.points_redeemed, d.points_expired, d.points_clawed_back)
  from public.loyalty_liability_daily d
  where d.programme_id = (select programme_w from fx) and d.as_of_date = p_date;
$$;

-- History. Each of m1 to m5 holds two credits of 6 points: C1 sold on 20 October 2026, C2 on 20
-- November 2026 (expiring on the same days of 2027). m7 holds one credit sold on 31 October 2026 at 15:00.
select pg_temp.earn('lw-m1-c1', 'm1', timestamptz '2026-10-20 10:00+07');
select pg_temp.earn('lw-m1-c2', 'm1', timestamptz '2026-11-20 10:00+07');
select pg_temp.earn('lw-m2-c1', 'm2', timestamptz '2026-10-20 10:10+07');
select pg_temp.earn('lw-m2-c2', 'm2', timestamptz '2026-11-20 10:10+07');
select pg_temp.earn('lw-m3-c1', 'm3', timestamptz '2026-10-20 10:20+07');
select pg_temp.earn('lw-m3-c2', 'm3', timestamptz '2026-11-20 10:20+07');
select pg_temp.earn('lw-m4-c1', 'm4', timestamptz '2026-10-20 10:30+07');
select pg_temp.earn('lw-m4-c2', 'm4', timestamptz '2026-11-20 10:30+07');
select pg_temp.earn('lw-m5-c1', 'm5', timestamptz '2026-10-20 10:40+07');
select pg_temp.earn('lw-m5-c2', 'm5', timestamptz '2026-11-20 10:40+07');
select pg_temp.earn('lw-m7-c1', 'm7', timestamptz '2026-10-31 15:00+07');

select ok(
  (select bool_and(l.point_delta = 6) from public.loyalty_ledger l where l.entry_kind = 'earn' and l.tenant_id = (select tenant_w from fx)),
  'the fixture: every earn is worth 6 points'
);

-- m1 spends 2 of its 12, m2 spends 8, m3 spends all 12; m5's first credit is voided.
select pg_temp.spend('m1', 2, timestamptz '2027-01-05 10:00+07');
select pg_temp.spend('m2', 8, timestamptz '2027-01-05 10:05+07');
select pg_temp.spend('m3', 12, timestamptz '2027-01-05 10:10+07');
select app.loyalty_clawback((select invoice_id from refs where ref = 'lw-m5-c1'), 'invoice_voided', timestamptz '2026-12-01 10:00+07');

-- m6 has an opening balance without an expiry date and an expiry row that no credit can be traced to.
select pg_temp.adjust('m6', 6, timestamptz '2025-01-02 09:00+07');
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, reason, occurred_at)
select fx.tenant_w, fx.programme_w, m.membership_id, 'expire', -3, 'expired', timestamptz '2026-04-01 00:00+07'
from fx, members m where m.name = 'm6';

-- Three expiry runs: one after the first anniversaries, one on the month boundary, one after the second.
select app.loyalty_expire((select tenant_w from fx), timestamptz '2027-10-21 04:00+07');
select app.loyalty_expire((select tenant_w from fx), timestamptz '2027-11-01 04:00+07');
select app.loyalty_expire((select tenant_w from fx), timestamptz '2027-11-22 04:00+07');

-- m8 holds credits at the edges of the flow day 2027-11-22 (local): 1 point at 23:59:59.999 of the day
-- before, 2 at its first instant, 4 at its last millisecond, 8 at the first instant of the next day.
select pg_temp.adjust('m8', 1, timestamptz '2027-11-21 23:59:59.999+07');
select pg_temp.adjust('m8', 2, timestamptz '2027-11-22 00:00:00+07');
select pg_temp.adjust('m8', 4, timestamptz '2027-11-22 23:59:59.999+07');
select pg_temp.adjust('m8', 8, timestamptz '2027-11-23 00:00:00+07');

select is(
  (select string_agg(r.name || ':' || r.points, ',' order by r.name)
   from (
     select m.name, sum(-l.point_delta)::int as points
     from public.loyalty_ledger l join members m on m.membership_id = l.membership_id
     where l.entry_kind = 'expire' and l.point_delta < 0 group by m.name
   ) r),
  'm1:10,m2:4,m4:12,m5:6,m6:3,m7:6',
  'the expiry rows written by the app: m1 4 + 6, m2 4, m4 6 + 6, m5 6, m7 6 and the hand-made 3 of m6; m3 spent everything'
);
select is(
  (select count(*)::int from public.loyalty_ledger l join members m on m.membership_id = l.membership_id where l.entry_kind = 'expire' and l.point_delta < 0 and m.name = 'm3'),
  0,
  'a member who spent all credits has no expiry row of points (only one of stamps)'
);
select is(
  (select sum(-l.point_delta)::int from public.loyalty_ledger l where l.entry_kind = 'expire' and l.point_delta < 0 and l.occurred_at = timestamptz '2027-11-01 04:00+07'),
  6,
  'the run of 2027-11-01 04:00 expires one credit, the one sold on 31 October 2026 after 04:00'
);

-- The flow window (F2): rows are written in date order.
select app.loyalty_liability((select programme_w from fx), timestamptz '2027-11-22 04:00+07');
select is(
  pg_temp.flows(date '2027-11-22'),
  '1:0:0:0',
  'the row of 2027-11-22 reports 2027-11-21: the credit of 23:59:59.999 (1 point), none of the 22nd''s own rows'
);

select app.loyalty_liability((select programme_w from fx), timestamptz '2027-11-23 04:00+07');
select is(
  pg_temp.flows(date '2027-11-23'),
  '6:0:22:0',
  'the row of 2027-11-23 reports the whole 22nd: credits at its first instant (2) and last millisecond (4) are in, the 8 of the 23rd at 00:00 is not; 22 points expired on its 04:00 run'
);
select is(
  pg_temp.row_doc(date '2027-11-23') -> 'cohorts',
  '[
    {"month": "2025-01", "issued": 6, "expired": 0},
    {"month": "2025-04", "issued": 0, "expired": 3},
    {"month": "2026-10", "issued": 36, "expired": 16},
    {"month": "2026-11", "issued": 30, "expired": 22},
    {"month": "2027-11", "issued": 15, "expired": 0}
  ]'::jsonb,
  'expired points by issue month: October 16 (m1 4, m4 6 and m7''s 6 of 31 October, which an expiry on 1 November no longer moves to November), November 22, the untraceable 3 under the run month less 12 months'
);
select is(
  (select outstanding_points from public.loyalty_liability_daily d where d.programme_id = (select programme_w from fx) and d.as_of_date = date '2027-11-23'),
  (select coalesce(sum(b.points), 0)::bigint from members m cross join lateral app.loyalty_balance(m.membership_id, timestamptz '2027-11-23 04:00+07') b),
  'the stock of the row is still that of the moment of the run: it agrees with the ledger balance'
);

-- A late run of the same day reports the same day and replaces the row.
select app.loyalty_liability((select programme_w from fx), timestamptz '2027-11-23 23:59+07');
select is(
  pg_temp.flows(date '2027-11-23'),
  '6:0:22:0',
  'a run at 23:59 of the same day reports the same complete day'
);

select app.loyalty_liability((select programme_w from fx), timestamptz '2027-11-24 04:00+07');
select is(
  pg_temp.flows(date '2027-11-24'),
  '8:0:0:0',
  'the row of 2027-11-24 reports the 23rd: the credit at its first instant (8), no expiry'
);

-- Oracle: the cohorts' expired points add up to the expiry rows of the ledger, in every stored row.
select is(
  (select count(*)::int
   from public.loyalty_liability_daily d
   where d.programme_id = (select programme_w from fx)
     and (select coalesce(sum((c ->> 'expired')::int), 0) from jsonb_array_elements(d.breakage_by_cohort) c)
       is distinct from (select coalesce(-sum(l.point_delta), 0) from public.loyalty_ledger l
                         where l.programme_id = d.programme_id and l.entry_kind = 'expire' and l.occurred_at <= d.as_of)),
  0,
  'in every stored row the cohorts'' expired points add up to the expiry rows of the ledger up to that run'
);

-- Regression: a re-run replaces the row with the same values and adds none.
create temp table before_rerun as select pg_temp.row_doc(date '2027-11-24') as doc;
select app.loyalty_liability((select programme_w from fx), timestamptz '2027-11-24 04:00+07');
select is(
  pg_temp.row_doc(date '2027-11-24'),
  (select doc from before_rerun),
  'a re-run of the same night stores the same row'
);
select is(
  (select count(*)::int from public.loyalty_liability_daily where programme_id = (select programme_w from fx)),
  3,
  'three days, three rows: the late run and the re-run added none'
);

-- Security: no phone, in any form, reaches the stored liability.
select is(
  (select count(*)::int
   from public.loyalty_liability_daily d
   cross join (values ('0900000911'), ('0900000912'), ('0900000913'), ('0900000914'), ('0900000915'), ('0900000916'), ('0900000917'), ('0900000918')) as p (phone)
   where d.programme_id = (select programme_w from fx)
     and (to_jsonb(d)::text like '%' || p.phone || '%' or to_jsonb(d)::text like '%+84' || substr(p.phone, 2) || '%')),
  0,
  'no member phone appears in any stored liability row'
);

select * from finish();
rollback;
