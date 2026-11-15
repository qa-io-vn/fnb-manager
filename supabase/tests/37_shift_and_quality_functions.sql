begin;
select plan(17);

create temp table fixture as
select
  'dddddddd-dddd-4ddd-8ddd-000000003701'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003711'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003721'::uuid as store_id;

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-shifts', 'Shifts' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-shifts', 'Shifts POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_id, tenant_id, account_id, 'shift-s', 'Store S' from fixture;

create temp table shift_plan as
select *
from (
  values
    ('SH-T1', '2025-09-01'::date, 332, 1, false),
    ('SH-T2', '2025-09-02'::date, 499, 1, true),
    ('SH-T3', '2025-09-03'::date, 249, 1, false),
    ('SH-X', '2025-09-04'::date, 196, 4, false),
    ('SH-Y', '2025-09-05'::date, 999, 1, false)
) as p (external_id, business_date, orders, voids, changed_after_close);

insert into public.shifts (tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at, changed_after_close)
select f.tenant_id, f.store_id, p.external_id, 'Ca ' || p.external_id, 'Cashier', (p.business_date + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
  (p.business_date + time '22:00') at time zone 'Asia/Ho_Chi_Minh', p.changed_after_close
from shift_plan p
cross join fixture f;

insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, cashier_name, opened_at, closed_at, orders)
select s.tenant_id, s.store_id, s.id, s.external_id, p.business_date, s.cashier_name, s.opened_at, s.closed_at, p.orders
from public.shifts s
join shift_plan p on p.external_id = s.external_id
where s.tenant_id = (select tenant_id from fixture);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id, gross_amount, net_amount, paid_amount)
select f.tenant_id, f.store_id, f.account_id, p.external_id || '-' || n, (p.business_date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', p.business_date, p.external_id,
  30000, 30000, 30000
from shift_plan p
cross join fixture f
cross join lateral generate_series(1, p.orders) n;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind, 'TEA', 'Tea', 1, 30000, 30000, 30000
from public.invoices i
where i.tenant_id = (select tenant_id from fixture);

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select f.tenant_id, f.store_id, null, 'VOID-' || p.external_id || '-' || n, 'voided'::public.invoice_event_kind,
  (p.business_date + time '12:00' + n * interval '1 minute') at time zone 'Asia/Ho_Chi_Minh', 30000, 'pos_report'
from shift_plan p
cross join fixture f
cross join lateral generate_series(1, p.voids) n;

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select f.tenant_id, f.store_id, null, 'VOID-NIGHT', 'voided', ('2025-09-04'::date + time '23:30') at time zone 'Asia/Ho_Chi_Minh', 30000, 'pos_report'
from fixture f;

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select i.tenant_id, i.store_id, i.id, i.external_id, 'line_removed', i.sold_at + interval '5 minutes', 10000, 'pos_report'
from public.invoices i
where i.tenant_id = (select tenant_id from fixture)
  and i.external_id in ('SH-X-1', 'SH-X-2');

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select i.tenant_id, i.store_id, i.id, i.external_id, 'edited', '2025-09-20 09:00+07', null, 'resync_diff'
from public.invoices i
where i.tenant_id = (select tenant_id from fixture)
  and i.external_id = 'SH-T2-1';

select is(
  (
    select p.proname || ':' || pg_get_function_identity_arguments(p.oid) || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
      || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('anon', p.oid, 'execute')::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'shift_adjustments'
  ),
  'shift_adjustments:store_ids uuid[], from_date date, to_date date, z_threshold numeric:s:false:search_path="":true:false',
  'shift_adjustments has one signature, is stable, security invoker with an empty search_path, for authenticated and not anon'
);

select results_eq(
  $$
    select a.shift_external_id, a.orders, a.item_lines, a.voids, a.void_amount, a.edits, a.removed_lines, a.removed_amount, a.edits_after_close, a.changed_after_close
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-01', '2025-09-05') a
  $$,
  $$
    values
      ('SH-T1'::text, 332::bigint, 332::bigint, 1, 30000::numeric, 0, 0, 0::numeric, 0, false),
      ('SH-T2', 499, 499, 1, 30000, 1, 0, 0, 1, true),
      ('SH-T3', 249, 249, 1, 30000, 0, 0, 0, 0, false),
      ('SH-X', 196, 196, 4, 120000, 0, 2, 20000, 0, false),
      ('SH-Y', 999, 999, 1, 30000, 0, 0, 0, 0, false)
  $$,
  'each shift counts its orders and item lines, voids without an invoice by time, removals and a re-sync edit by the invoice''s shift, in date order'
);

select is(
  (
    select a.voids
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-04', '2025-09-04') a
  ),
  4,
  'a void after the shift closed and before the next opened belongs to no shift'
);

select is(
  (
    select array[a.void_rate::text, a.removed_line_rate::text]
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-04', '2025-09-04') a
  ),
  array[round(4 / 200::numeric, 6)::text, round(2 / 196::numeric, 6)::text],
  'the void rate counts voids over orders and voids, the removed-line rate over item lines'
);

select is(
  (
    select array_agg(a.shift_external_id || ':' || a.trailing_shifts || ':' || coalesce(a.void_z_score::text, '-') order by a.business_date)
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-01', '2025-09-03') a
  ),
  array['SH-T1:0:-', 'SH-T2:1:-', 'SH-T3:2:-'],
  'a z-score needs three earlier shifts of the store'
);

select is(
  (
    select a.void_z_score
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-04', '2025-09-04') a
  ),
  (
    select round((4 / 200::numeric - avg(r)) / stddev_samp(r), 4)
    from (values (1 / 333::numeric), (1 / 500::numeric), (1 / 250::numeric)) v (r)
  ),
  'the z-score on rates near 0.003 equals the hand calculation on unrounded rates'
);

select is(
  (
    select array[a.trailing_shifts::text, coalesce(a.removed_z_score::text, '-'), a.flagged::text, array_to_string(a.reasons, ',')]
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-04', '2025-09-04') a
  ),
  array['3', '-', 'true', 'voids'],
  'a void rate far above the store''s earlier shifts is flagged; earlier removals all zero give no removed-line score'
);

select is(
  (
    select array[(a.void_z_score < 0)::text, a.flagged::text, coalesce(array_to_string(a.reasons, ','), '')]
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-05', '2025-09-05') a
  ),
  array['true', 'false', ''],
  'a void rate below the earlier shifts is not flagged'
);

select is(
  (
    select array[a.flagged::text, array_to_string(a.reasons, ',')]
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-02', '2025-09-02') a
  ),
  array['true', 'after_close'],
  'an edit after the shift closed flags the shift'
);

select is(
  (
    select a.flagged
    from fixture f
    cross join lateral public.shift_adjustments(array[f.store_id], '2025-09-04', '2025-09-04', 50) a
  ),
  false,
  'a higher threshold stops flagging the shift'
);

select throws_ok(
  $$ select * from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003721']::uuid[], '2025-06-05', '2025-09-05') $$,
  '22023',
  null,
  'shift_adjustments covers at most 92 days'
);

select throws_ok(
  $$ select * from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003721']::uuid[], '2025-09-01', '2025-09-05', 0) $$,
  '22023',
  null,
  'shift_adjustments refuses a threshold of 0'
);

select is(
  (select count(*)::integer from public.shift_adjustments(array[]::uuid[], '2025-09-01', '2025-09-05')),
  0,
  'no store gives no shift'
);

create temp table more_shifts as
select *
from (
  values
    ('dddddddd-dddd-4ddd-8ddd-000000003722'::uuid, 'TT-1', '2025-09-01'::date, time '06:00', time '22:00', 99, 1),
    ('dddddddd-dddd-4ddd-8ddd-000000003722', 'TT-2', '2025-09-02', time '06:00', time '22:00', 100, 1),
    ('dddddddd-dddd-4ddd-8ddd-000000003722', 'TT-3', '2025-09-03', time '06:00', time '22:00', 98, 1),
    ('dddddddd-dddd-4ddd-8ddd-000000003722', 'TT-LOW', '2025-09-04', time '06:00', time '22:00', 100, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003723', 'OV-1', '2025-09-10', time '08:00', time '16:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003723', 'OV-2', '2025-09-10', time '12:00', time '20:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003724', 'TB-57', '2025-10-04', time '06:00', time '22:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003724', 'TB-56', '2025-10-05', time '06:00', time '22:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003724', 'TB-55', '2025-10-06', time '06:00', time '22:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003724', 'TB-54', '2025-10-07', time '06:00', time '22:00', 1, 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003724', 'TB-0', '2025-11-30', time '06:00', time '22:00', 1, 0)
) as m (store_id, external_id, business_date, opens, closes, orders, voids);

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select v.id, f.tenant_id, f.account_id, v.external_id, v.name
from fixture f
cross join (
  values
    ('dddddddd-dddd-4ddd-8ddd-000000003722'::uuid, 'shift-tight', 'Tight'),
    ('dddddddd-dddd-4ddd-8ddd-000000003723'::uuid, 'shift-overlap', 'Overlap'),
    ('dddddddd-dddd-4ddd-8ddd-000000003724'::uuid, 'shift-boundary', 'Boundary')
) as v (id, external_id, name);

insert into public.shifts (tenant_id, store_id, external_id, name, opened_at, closed_at)
select f.tenant_id, m.store_id, m.external_id, m.external_id, (m.business_date + m.opens) at time zone 'Asia/Ho_Chi_Minh', (m.business_date + m.closes) at time zone 'Asia/Ho_Chi_Minh'
from more_shifts m
cross join fixture f;

insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, opened_at, closed_at, orders)
select s.tenant_id, s.store_id, s.id, s.external_id, m.business_date, s.opened_at, s.closed_at, m.orders
from public.shifts s
join more_shifts m on m.store_id = s.store_id and m.external_id = s.external_id;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id, gross_amount, net_amount, paid_amount)
select f.tenant_id, m.store_id, f.account_id, m.external_id || '-' || n, (m.business_date + m.opens + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh', m.business_date, m.external_id, 30000, 30000, 30000
from more_shifts m
cross join fixture f
cross join lateral generate_series(1, m.orders) n;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind, 'TEA', 'Tea', 1, 30000, 30000, 30000
from public.invoices i
join more_shifts m on m.store_id = i.store_id and i.external_id like m.external_id || '-%';

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select f.tenant_id, m.store_id, null::uuid, 'VOID-' || m.external_id || '-' || n, 'voided'::public.invoice_event_kind,
  (m.business_date + m.opens + interval '2 hours') at time zone 'Asia/Ho_Chi_Minh', 30000, 'pos_report'
from more_shifts m
cross join fixture f
cross join lateral generate_series(1, m.voids) n;

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select tenant_id, 'dddddddd-dddd-4ddd-8ddd-000000003723', null::uuid, 'VOID-OVERLAP', 'voided'::public.invoice_event_kind, ('2025-09-10'::date + time '13:00') at time zone 'Asia/Ho_Chi_Minh', 30000, 'pos_report'
from fixture;

select is(
  (
    select array[(a.void_z_score < -2)::text, a.flagged::text, coalesce(array_to_string(a.reasons, ','), '')]
    from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003722']::uuid[], '2025-09-04', '2025-09-04') a
  ),
  array['true', 'false', ''],
  'a void rate far below tightly grouped earlier shifts is not flagged: the test is one-sided'
);

select is(
  (
    select array_agg(a.shift_external_id || ':' || a.voids order by a.shift_external_id)
    from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003723']::uuid[], '2025-09-10', '2025-09-10') a
  ),
  array['OV-1:0', 'OV-2:1'],
  'an event in two overlapping shift windows goes to the shift opened last'
);

select is(
  (
    select a.trailing_shifts
    from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003724']::uuid[], '2025-11-30', '2025-11-30') a
  ),
  3,
  'the trailing window reaches back 56 days and not 57'
);

select lives_ok(
  $$ select * from public.shift_adjustments(array['dddddddd-dddd-4ddd-8ddd-000000003721']::uuid[], '2025-06-06', '2025-09-05') $$,
  'shift_adjustments accepts 92 days'
);

select * from finish();
rollback;
