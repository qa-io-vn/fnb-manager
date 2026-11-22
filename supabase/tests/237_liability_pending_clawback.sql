-- The liability and the earns that are still pending (G-103, ADR-048).
--
-- Rule (ADR-048): the liability counts confirmed points only. A pending earn is not a
-- liability until it is confirmed, so the clawback of a pending earn lowers nothing:
-- the earn was never counted. Before the fix app.loyalty_liability subtracted that
-- clawback from the confirmed points of the same member.
--
-- Techniques (ISTQB): state transition testing of an earn over five days (pending,
-- clawed back while pending, confirmed, clawed back after confirmation, confirmed
-- late), with the liability run at the end of each local day; equivalence
-- partitioning of the members (a confirmed earn, a confirmed earn beside a pending
-- one that is clawed back, a pending earn confirmed and then clawed back, a pending
-- earn that stays pending); and an oracle in the database itself, the ledger balance
-- of app.loyalty_balance at the same moment, which already treated pending earns as
-- waiting (the TypeScript model of @fnb/core does too, see pgtap:236).
--
-- Every moment is explicit (nothing reads now()), phones are synthetic, nothing is
-- sent, and the file rolls back.
begin;
select plan(14);

set local timezone = 'UTC';
update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000023701'::uuid as tenant_p,
  'cccccccc-cccc-4ccc-8ccc-000000023701'::uuid as account_p,
  'ffffffff-ffff-4fff-8fff-000000023701'::uuid as store_p,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000023701'::uuid as programme_p;

insert into public.tenants (id, slug, name)
select tenant_p, 'liability-pending-pgtap', 'Liability pending pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_p, tenant_p, 'mock', 'liability-pending', 'Synthetic pending account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_p, tenant_p, account_p, 'lp-s1', 'Synthetic pending store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_p, tenant_p, 'Synthetic pending programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table members (name text primary key, membership_id uuid);
insert into members
select m.name, app.loyalty_join(
  fx.tenant_p,
  app.loyalty_customer_for_phone(fx.tenant_p, m.phone, timestamptz '2026-11-01 08:00+07'),
  'mini_app', fx.store_p, null, null, timestamptz '2026-11-01 09:00+07'
)
from fx
cross join (values ('m1', '0900000901'), ('m2', '0900000902'), ('m3', '0900000903'), ('m4', '0900000904')) as m (name, phone);

create temp table refs (ref text primary key, invoice_id uuid);

create function pg_temp.earn(p_ref text, p_member text, p_at timestamptz, p_pending boolean)
returns void
language plpgsql
as $$
declare
  v_invoice uuid;
begin
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, source_name, status)
  select fx.tenant_p, fx.store_p, fx.account_p, p_ref, right(p_ref, 4), p_at, (p_at at time zone 'Asia/Ho_Chi_Minh')::date, 60000, 60000, 60000, 'tai-quan', 'completed'
  from fx
  returning id into v_invoice;
  insert into refs (ref, invoice_id) values (p_ref, v_invoice);
  perform app.loyalty_earn(v_invoice, (select membership_id from members where name = p_member), 'A', p_at, p_pending);
end;
$$;

create function pg_temp.earn_entry(p_ref text)
returns uuid
language sql
as $$
  select l.id from public.loyalty_ledger l join refs r on r.invoice_id = l.invoice_id where r.ref = p_ref and l.entry_kind = 'earn';
$$;

create function pg_temp.points_of(p_ref text)
returns bigint
language sql
as $$
  select l.point_delta::bigint from public.loyalty_ledger l where l.id = pg_temp.earn_entry(p_ref);
$$;

create function pg_temp.confirm(p_ref text, p_at timestamptz)
returns void
language sql
as $$
  select app.loyalty_confirm(pg_temp.earn_entry(p_ref), null, p_at);
$$;

create function pg_temp.void(p_ref text, p_at timestamptz)
returns void
language sql
as $$
  select app.loyalty_clawback((select invoice_id from refs where ref = p_ref), 'invoice_voided', p_at);
$$;

-- What the database's own balance says at a moment: the points of every member that count.
create function pg_temp.balance_points(p_at timestamptz)
returns bigint
language sql
as $$
  select coalesce(sum(b.points), 0)::bigint from members m cross join lateral app.loyalty_balance(m.membership_id, p_at) b;
$$;

create function pg_temp.outstanding(p_at timestamptz)
returns bigint
language plpgsql
as $$
begin
  perform app.loyalty_liability((select programme_p from fx), p_at);
  return (select d.outstanding_points from public.loyalty_liability_daily d
    where d.programme_id = (select programme_p from fx) and d.as_of_date = (p_at at time zone 'Asia/Ho_Chi_Minh')::date);
end;
$$;

-- Day 1, 10 November: five earns of the same amount. E1 and E2a are confirmed at once,
-- E2b, E3 and E4 are pending.
select pg_temp.earn('lp-e1', 'm1', timestamptz '2026-11-10 09:00+07', false);
select pg_temp.earn('lp-e2a', 'm2', timestamptz '2026-11-10 09:10+07', false);
select pg_temp.earn('lp-e2b', 'm2', timestamptz '2026-11-10 09:20+07', true);
select pg_temp.earn('lp-e3', 'm3', timestamptz '2026-11-10 09:30+07', true);
select pg_temp.earn('lp-e4', 'm4', timestamptz '2026-11-10 09:40+07', true);

select ok(
  (select bool_and(pg_temp.points_of(r) > 0) from unnest(array['lp-e1', 'lp-e2a', 'lp-e2b', 'lp-e3', 'lp-e4']) r),
  'the fixture: every earn is worth points'
);
select is(
  (select array_agg(r order by r) from unnest(array['lp-e1', 'lp-e2a', 'lp-e2b', 'lp-e3', 'lp-e4']) r
    where (select l.pending from public.loyalty_ledger l where l.id = pg_temp.earn_entry(r))),
  array['lp-e2b', 'lp-e3', 'lp-e4'],
  'the fixture: E2b, E3 and E4 are pending, E1 and E2a are not'
);

select is(
  pg_temp.outstanding(timestamptz '2026-11-10 23:00+07'),
  pg_temp.points_of('lp-e1') + pg_temp.points_of('lp-e2a'),
  'day 1: the liability counts the two confirmed earns and none of the pending ones'
);
select is(
  pg_temp.outstanding(timestamptz '2026-11-10 23:00+07'),
  pg_temp.balance_points(timestamptz '2026-11-10 23:00+07'),
  'day 1: the liability agrees with the ledger balance'
);

-- Day 2: the pending earn E2b is voided before anyone confirmed it.
select pg_temp.void('lp-e2b', timestamptz '2026-11-11 10:00+07');
select is(
  pg_temp.outstanding(timestamptz '2026-11-11 23:00+07'),
  pg_temp.points_of('lp-e1') + pg_temp.points_of('lp-e2a'),
  'day 2: the clawback of a pending earn lowers nothing, the earn was never counted (G-103)'
);
select is(
  pg_temp.outstanding(timestamptz '2026-11-11 23:00+07'),
  pg_temp.balance_points(timestamptz '2026-11-11 23:00+07'),
  'day 2: the liability still agrees with the ledger balance'
);
select is(
  (select d.outstanding_points from public.loyalty_liability_daily d where d.programme_id = (select programme_p from fx) and d.as_of_date = date '2026-11-11'),
  (select d.outstanding_points from public.loyalty_liability_daily d where d.programme_id = (select programme_p from fx) and d.as_of_date = date '2026-11-10'),
  'day 2 equals day 1: nothing counted moved'
);

-- Day 3: E3 is confirmed, E1 (confirmed) is voided.
select pg_temp.confirm('lp-e3', timestamptz '2026-11-12 10:00+07');
select pg_temp.void('lp-e1', timestamptz '2026-11-12 11:00+07');
select is(
  pg_temp.outstanding(timestamptz '2026-11-12 23:00+07'),
  pg_temp.points_of('lp-e2a') + pg_temp.points_of('lp-e3'),
  'day 3: a confirmed pending earn is counted, the clawback of a confirmed earn is subtracted'
);
select is(
  pg_temp.outstanding(timestamptz '2026-11-12 23:00+07'),
  pg_temp.balance_points(timestamptz '2026-11-12 23:00+07'),
  'day 3: the liability agrees with the ledger balance'
);

-- Day 4: E3, confirmed on day 3, is voided.
select pg_temp.void('lp-e3', timestamptz '2026-11-13 10:00+07');
select is(
  pg_temp.outstanding(timestamptz '2026-11-13 23:00+07'),
  pg_temp.points_of('lp-e2a'),
  'day 4: a pending earn that was confirmed and then clawed back nets to zero'
);
select is(
  pg_temp.outstanding(timestamptz '2026-11-13 23:00+07'),
  pg_temp.balance_points(timestamptz '2026-11-13 23:00+07'),
  'day 4: the liability agrees with the ledger balance'
);

-- Day 5: E4, pending since day 1, is confirmed late and counts from that moment.
select pg_temp.confirm('lp-e4', timestamptz '2026-11-14 10:00+07');
select is(
  pg_temp.outstanding(timestamptz '2026-11-14 23:00+07'),
  pg_temp.points_of('lp-e2a') + pg_temp.points_of('lp-e4'),
  'day 5: a pending earn confirmed late counts from its confirmation'
);
select is(
  pg_temp.outstanding(timestamptz '2026-11-14 23:00+07'),
  pg_temp.balance_points(timestamptz '2026-11-14 23:00+07'),
  'day 5: the liability agrees with the ledger balance'
);

-- A run for an earlier moment still reads the ledger as of that moment (regression).
select is(
  pg_temp.outstanding(timestamptz '2026-11-11 23:00+07'),
  pg_temp.points_of('lp-e1') + pg_temp.points_of('lp-e2a'),
  'a re-run for day 2 after later changes gives day 2 again'
);

select * from finish();
rollback;
