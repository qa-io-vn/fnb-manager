begin;
select plan(33);

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

create temp table quality as
select
  'dddddddd-dddd-4ddd-8ddd-000000003751'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003761'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003771'::uuid as store_1,
  'dddddddd-dddd-4ddd-8ddd-000000003772'::uuid as store_2,
  'dddddddd-dddd-4ddd-8ddd-000000003762'::uuid as second_account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003779'::uuid as store_3,
  'dddddddd-dddd-4ddd-8ddd-000000003781'::uuid as customer_1,
  'dddddddd-dddd-4ddd-8ddd-000000003782'::uuid as customer_2;

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-quality', 'Quality' from quality;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-quality', 'Quality POS' from quality
union all
select second_account_id, tenant_id, 'mock', 'theme-pgtap-quality-b', 'Quality POS B' from quality;

insert into public.stores (
  id, tenant_id, pos_account_id, external_id, name, opening_hours, seat_count, opened_on, e_invoice_status, tran_no_reset_period, member_capture_status
)
select q.store_1, q.tenant_id, q.account_id, 'quality-1', 'Quality 1', '{"mon": [["07:00", "22:00"]]}'::jsonb, 20, '2024-01-01'::date,
  'configured'::public.e_invoice_status, 'daily'::public.tran_no_reset_period, 'enabled'::public.pos_feature_status
from quality q
union all
select q.store_2, q.tenant_id, q.account_id, 'quality-2', 'Quality 2', null, null, null, 'unknown', 'unknown', 'unknown'
from quality q
union all
select q.store_3, q.tenant_id, q.second_account_id, 'quality-b1', 'Quality B1', null, null, null, 'unknown', 'unknown', 'unknown'
from quality q;

insert into public.item_types (tenant_id, pos_account_id, external_id, name)
select q.tenant_id, q.account_id, t.external_id, t.name
from quality q
cross join (values ('DRINK', 'Đồ uống'), ('SNACK', 'Ăn vặt')) as t (external_id, name);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select tenant_id, account_id, 'DRINK', 'drink' from quality;

insert into public.items (tenant_id, pos_account_id, external_id, name, item_type_external_id, is_modifier)
select q.tenant_id, q.account_id, i.external_id, i.name, i.item_type, i.is_modifier
from quality q
cross join (values ('TEA', 'Trà', 'DRINK', false), ('CAKE', 'Bánh', 'SNACK', false), ('PEARL', 'Trân châu', null, true)) as i (external_id, name, item_type, is_modifier);

insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
select tenant_id, account_id, 'CAKE', 'DRINK' from quality;

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select tenant_id, null, 'TEA', 9000, '2025-01-01' from quality;

insert into public.agg_item_daily (tenant_id, store_id, business_date, item_external_id, item_name, item_type_external_id, item_type_name, quantity, net_amount, invoices)
select q.tenant_id, q.store_1, '2025-10-10', a.item, a.name, a.item_type, a.item_type_name, a.quantity, a.net, 1
from quality q
cross join (
  values
    ('TEA', 'Trà', 'DRINK', 'Đồ uống', 20, 600000),
    ('CAKE', 'Bánh', 'SNACK', 'Ăn vặt', 10, 300000),
    ('PEARL', 'Trân châu', null, null, 5, 50000),
    ('NOTYPE', 'Món lạ', null, null, 2, 50000)
) as a (item, name, item_type, item_type_name, quantity, net);

insert into public.customers (id, tenant_id, external_id, phone, name)
select customer_1, tenant_id, 'C-1', null, null from quality
union all
select customer_2, tenant_id, 'C-2', null, null from quality;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at)
select q.tenant_id, 'customer', q.customer_1, c.purpose, 'privacy-2025-01', 'pos', '2025-09-01', c.revoked_at
from quality q
cross join (values ('loyalty'::public.consent_purpose, null::timestamptz), ('marketing', '2025-09-15'::timestamptz)) as c (purpose, revoked_at);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, customer_id, customer_phone, status, gross_amount, net_amount, paid_amount)
select q.tenant_id, v.store_id, q.account_id, v.external_id, v.receipt_no, (v.on_date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', v.on_date,
  v.customer_id, v.phone, v.status::public.invoice_status, 30000, 30000, 30000
from quality q
cross join lateral (
  select q.store_1 as store_id, 'Q1-' || n as external_id, '1' as receipt_no, ('2025-10-07'::date + n) as on_date, null::uuid as customer_id, null::text as phone, 'completed' as status
  from generate_series(0, 24) n
  union all
  select q.store_2, 'Q2-' || n, (100 + n)::text, '2025-10-07'::date + n, null, null, 'completed'
  from generate_series(0, 24) n
  union all
  values
    (q.store_1, 'Q1-CUST', 'W-1', '2025-10-02'::date, q.customer_1, null::text, 'completed'),
    (q.store_1, 'Q1-PHONE', 'W-2', '2025-10-02'::date, null::uuid, '0900000000', 'completed'),
    (q.store_1, 'Q1-VOID', '5', '2025-10-02'::date, q.customer_2, null::text, 'voided')
) v;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind,
  case when i.external_id = 'Q1-PHONE' then 'PEARL' when i.store_id = q.store_2 then 'CAKE' else 'TEA' end,
  'Món', 1, 30000, 30000, 30000
from public.invoices i
cross join quality q
where i.tenant_id = q.tenant_id
union all
select i.tenant_id, i.store_id, i.id, 'L2', 'modifier'::public.line_kind, null, 'Ít đá', 1, 0, 0, 0
from public.invoices i
cross join quality q
where i.tenant_id = q.tenant_id
  and i.external_id like 'Q1-%'
  and i.external_id not in ('Q1-CUST', 'Q1-PHONE');

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select q.tenant_id, q.store_1, null::uuid, 'VOID-LOOSE', 'voided'::public.invoice_event_kind, '2025-10-15 15:00+07'::timestamptz, 30000, 'pos_report' from quality q
union all
select q.tenant_id, q.store_2, null::uuid, 'VOID-OLD', 'voided'::public.invoice_event_kind, '2025-09-15 15:00+07'::timestamptz, 30000, 'pos_report' from quality q;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select q.tenant_id, q.account_id, m.external_id, m.name, m.kind
from quality q
cross join (values ('CASH', 'Tiền mặt', 'cash'::public.payment_kind), ('WALLET', 'Ví', 'other'), ('CARD', 'Thẻ', 'card')) as m (external_id, name, kind);

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select q.tenant_id, q.second_account_id, 'CARD', 'Thẻ', 'card' from quality q;

insert into public.payment_kind_overrides (tenant_id, pos_account_id, payment_method_external_id, kind)
select tenant_id, account_id, 'WALLET', 'ewallet' from quality;

insert into public.agg_payment_daily (tenant_id, store_id, business_date, payment_method_external_id, payment_method_name, kind, invoices, amount)
select q.tenant_id, q.store_1, '2025-10-10', p.method, p.name, p.kind, p.invoices, p.amount
from quality q
cross join (
  values ('CASH', 'Tiền mặt', 'cash'::public.payment_kind, 10, 500000), ('WALLET', 'Ví', 'ewallet', 5, 250000), ('unknown', 'Không rõ', 'other', 2, 20000)
) as p (method, name, kind, invoices, amount);

select is(
  (
    select array_agg(p.proname || ':' || pg_get_function_identity_arguments(p.oid) || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'data_quality_%'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  ),
  array[
    'data_quality_items:store_ids uuid[], from_date date, to_date date:s:false:search_path=""',
    'data_quality_payments:store_ids uuid[], from_date date, to_date date:s:false:search_path=""',
    'data_quality_summary:store_ids uuid[], from_date date, to_date date:s:false:search_path=""'
  ],
  'the data-quality functions have one signature each, are stable, security invoker with an empty search_path, for authenticated and not anon'
);

select results_eq(
  $$
    select d.item_external_id, d.pos_type_external_id, d.override_type_external_id, d.item_type_external_id, d.type_known, d.role::text, d.cost_known, d.catalogue_modifier, d.net_amount, d.net_share
    from quality q
    cross join lateral public.data_quality_items(array[q.store_1], '2025-10-01', '2025-10-31') d
  $$,
  $$
    values
      ('TEA'::text, 'DRINK'::text, null::text, 'DRINK'::text, true, 'drink'::text, true, false, 600000::numeric, 0.600000::numeric),
      ('CAKE', 'SNACK', 'DRINK', 'DRINK', true, 'drink', false, false, 300000, 0.300000),
      ('NOTYPE', null, null, null, false, null, false, false, 50000, 0.050000),
      ('PEARL', null, null, null, false, null, false, true, 50000, 0.050000)
  $$,
  'data-quality items: a costed drink, an item moved by an override, an item without a type and a catalogue modifier sold as an item, largest first'
);

select results_eq(
  $$
    select coalesce(s.store_id::text, 'all'), s.invoices, s.item_lines, s.modifier_lines, s.modifier_line_share, s.catalogue_modifier_lines,
      s.identified_invoices, s.capture_rate, s.identified_customers, s.loyalty_consents, s.marketing_consents, s.consent_coverage, s.unattributed_events
    from quality q
    cross join lateral public.data_quality_summary(array[q.store_1, q.store_2], '2025-10-01', '2025-10-31') s
  $$,
  $$
    values
      ('all'::text, 52::bigint, 52::bigint, 25::bigint, round(25 / 77::numeric, 6), 1::bigint, 2::bigint, round(2 / 52::numeric, 6), 1::bigint, 1::bigint, 0::bigint, 1.000000::numeric, 1::bigint),
      ('dddddddd-dddd-4ddd-8ddd-000000003771', 27, 27, 25, round(25 / 52::numeric, 6), 1, 2, round(2 / 27::numeric, 6), 1, 1, 0, 1.000000, 1),
      ('dddddddd-dddd-4ddd-8ddd-000000003772', 25, 25, 0, 0.000000, 0, 0, 0.000000, 0, 0, 0, null, 0)
  $$,
  'the data-quality summary counts lines, catalogue modifiers, capture, consent coverage and unattributed events, all stores first'
);

select results_eq(
  $$
    select s.e_invoice_status::text, s.tran_no_reset_period::text, s.member_capture_status::text, s.opening_hours_known, s.seat_count, s.opened_on, s.receipt_days, s.receipt_restarts_daily
    from quality q
    cross join lateral public.data_quality_summary(array[q.store_1, q.store_2], '2025-10-01', '2025-10-31') s
  $$,
  $$
    values
      (null::text, null::text, null::text, null::boolean, null::integer, null::date, null::integer, null::boolean),
      ('configured', 'daily', 'enabled', true, 20, '2024-01-01', 25, true),
      ('unknown', 'unknown', 'unknown', false, null, null, 25, false)
  $$,
  'each store row carries its settings and whether receipt numbers restart every day'
);

select is(
  (
    select s.receipt_days
    from quality q
    cross join lateral public.data_quality_summary(array[q.store_1], '2025-10-01', '2025-10-20') s
    where s.store_id = q.store_1
  ),
  null::integer,
  'fewer than 20 numbered days say nothing about the receipt numbering'
);

select results_eq(
  $$
    select p.payment_method_external_id, p.kind::text, p.pos_kind::text, p.override_kind::text, p.in_catalogue, p.invoices, p.amount
    from quality q
    cross join lateral public.data_quality_payments(array[q.store_1], '2025-10-01', '2025-10-31') p
  $$,
  $$
    values
      ('CASH'::text, 'cash'::text, 'cash'::text, null::text, true, 10::bigint, 500000::numeric),
      ('WALLET', 'ewallet', 'other', 'ewallet', true, 5, 250000),
      ('unknown', 'other', null, null, false, 2, 20000),
      ('CARD', 'card', 'card', null, true, null, null)
  $$,
  'data-quality payments list every catalogue method, an unpaid one last, and a paid id without a catalogue row'
);

select results_eq(
  $$
    select p.pos_account_id
    from quality q
    cross join lateral public.data_quality_payments(array[q.store_3, q.store_1], '2025-10-01', '2025-10-31') p
    where p.payment_method_external_id = 'CARD'
  $$,
  $$ select unnest(array[q.second_account_id, q.account_id]) from quality q $$,
  'the same unpaid method on two accounts comes first for the account of the first store asked'
);

select results_eq(
  $$
    select p.pos_account_id
    from quality q
    cross join lateral public.data_quality_payments(array[q.store_1, q.store_3], '2025-10-01', '2025-10-31') p
    where p.payment_method_external_id = 'CARD'
  $$,
  $$ select unnest(array[q.account_id, q.second_account_id]) from quality q $$,
  'and swaps when the stores are asked the other way round'
);

select throws_ok(
  $$ select * from public.data_quality_summary(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-26', '2025-10-31') $$,
  '22023',
  null,
  'data_quality_summary covers at most 400 days'
);

select is(
  (select count(*)::integer from public.data_quality_summary(array[]::uuid[], '2025-10-01', '2025-10-31')),
  0,
  'no store gives no row'
);

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, e_invoice_status, member_capture_status, business_day_start_minutes)
select v.id, q.tenant_id, q.account_id, v.external_id, v.name, v.e_invoice::public.e_invoice_status, v.member::public.pos_feature_status, v.day_start
from quality q
cross join (
  values
    ('dddddddd-dddd-4ddd-8ddd-000000003773'::uuid, 'quality-3', 'Quality 3', 'not_configured', 'disabled', 0),
    ('dddddddd-dddd-4ddd-8ddd-000000003774'::uuid, 'quality-4', 'Quality 4', 'disabled', 'unknown', 300)
) as v (id, external_id, name, e_invoice, member, day_start);

insert into public.customers (id, tenant_id, external_id)
select 'dddddddd-dddd-4ddd-8ddd-000000003783', tenant_id, 'C-3' from quality;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at)
select tenant_id, 'customer', 'dddddddd-dddd-4ddd-8ddd-000000003783', 'loyalty', 'privacy-2025-01', 'pos', '2025-09-01', '2025-10-01' from quality;

insert into public.shifts (tenant_id, store_id, external_id, name, opened_at, closed_at)
select tenant_id, 'dddddddd-dddd-4ddd-8ddd-000000003773', 'QS-1', 'Ca sáng', '2025-10-20 06:00+07', '2025-10-20 22:00+07' from quality;

insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, opened_at, closed_at, orders)
select s.tenant_id, s.store_id, s.id, s.external_id, '2025-10-20', s.opened_at, s.closed_at, 1
from public.shifts s
where s.store_id = 'dddddddd-dddd-4ddd-8ddd-000000003773';

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, shift_external_id, customer_id, gross_amount, net_amount, paid_amount)
select q.tenant_id, 'dddddddd-dddd-4ddd-8ddd-000000003773', q.account_id, v.external_id, v.receipt, '2025-10-20 10:00+07', '2025-10-20', v.shift, v.customer, 30000, 30000, 30000
from quality q
cross join (
  values
    ('Q3-SHIFT', '1', 'QS-1', 'dddddddd-dddd-4ddd-8ddd-000000003783'::uuid),
    ('Q3-GHOST', '2', 'SH-GHOST', null::uuid)
) as v (external_id, receipt, shift, customer);

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind, 'TEA', 'Trà', 1, 30000, 30000, 30000
from public.invoices i
where i.external_id in ('Q3-SHIFT', 'Q3-GHOST') and i.tenant_id = (select tenant_id from quality)
union all
select i.tenant_id, i.store_id, i.id, 'L2', 'modifier'::public.line_kind, 'TEA', 'Trà', 1, 0, 0, 0
from public.invoices i
where i.external_id = 'Q3-SHIFT' and i.tenant_id = (select tenant_id from quality);

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select q.tenant_id, 'dddddddd-dddd-4ddd-8ddd-000000003773'::uuid, e.invoice_id, e.external_id, e.kind::public.invoice_event_kind, e.occurred_at, 30000, e.source
from quality q
cross join (
  values
    (null::uuid, 'VOID-IN-SHIFT', 'voided', '2025-10-20 12:00+07'::timestamptz, 'pos_report'),
    ((select id from public.invoices where external_id = 'Q3-SHIFT'), 'Q3-SHIFT', 'edited', '2025-10-28 09:00+07'::timestamptz, 'resync_diff'),
    ((select id from public.invoices where external_id = 'Q3-GHOST'), 'Q3-GHOST', 'edited', '2025-10-20 12:30+07'::timestamptz, 'pos_report'),
    (null::uuid, 'VOID-AFTER-CLOSE', 'voided', '2025-10-20 23:30+07'::timestamptz, 'pos_report')
) as e (invoice_id, external_id, kind, occurred_at, source);

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select q.tenant_id, 'dddddddd-dddd-4ddd-8ddd-000000003774'::uuid, null::uuid, e.external_id, 'voided'::public.invoice_event_kind, e.occurred_at, 30000, 'pos_report'
from quality q
cross join (
  values
    ('EARLY-NOV', '2025-11-01 02:00+07'::timestamptz),
    ('EARLY-OCT', '2025-10-01 02:00+07'::timestamptz)
) as e (external_id, occurred_at);

select results_eq(
  $$
    select s.invoices, s.item_lines, s.modifier_lines, s.modifier_line_share, s.catalogue_modifier_lines, s.identified_invoices, s.capture_rate,
      s.identified_customers, s.loyalty_consents, s.consent_coverage, s.unattributed_events, s.e_invoice_status::text, s.member_capture_status::text
    from public.data_quality_summary(array['dddddddd-dddd-4ddd-8ddd-000000003773']::uuid[], '2025-10-01', '2025-10-31') s
    where s.store_id is not null
  $$,
  $$ values (2::bigint, 2::bigint, 1::bigint, 0.333333::numeric, 0::bigint, 1::bigint, 0.500000::numeric, 1::bigint, 0::bigint, 0.000000::numeric, 2::bigint, 'not_configured'::text, 'disabled'::text) $$,
  'events inside a shift window or on an invoice of a known shift are attributed, one on an invoice of an unknown shift or after the close is not; a revoked consent and a modifier line named like an item count for nothing'
);

select is(
  (
    select s.unattributed_events
    from public.data_quality_summary(array['dddddddd-dddd-4ddd-8ddd-000000003774']::uuid[], '2025-10-01', '2025-10-31') s
    where s.store_id is not null
  ),
  1::bigint,
  'an event dates by business day: 02:00 on 1 November belongs to October for a store whose day starts at 05:00, and 02:00 on 1 October to September'
);

insert into public.agg_item_daily (tenant_id, store_id, business_date, item_external_id, item_name, item_type_external_id, item_type_name, quantity, net_amount, invoices)
select q.tenant_id, a.store_id, '2025-11-10', a.item, a.item, a.item_type, a.item_type, 1, a.net, 1
from quality q
cross join (
  values
    ('dddddddd-dddd-4ddd-8ddd-000000003771'::uuid, 'BREAD', 'SNACK', 100000),
    ('dddddddd-dddd-4ddd-8ddd-000000003771'::uuid, 'MILK', 'DRINK', 50000),
    ('dddddddd-dddd-4ddd-8ddd-000000003772'::uuid, 'MILK', 'DRINK', 50000),
    ('dddddddd-dddd-4ddd-8ddd-000000003771'::uuid, 'COOKIE', 'SNACK', 30000)
) as a (store_id, item, item_type, net);

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select q.tenant_id, c.store_id, c.item, 10000, c.effective_from
from quality q
cross join (
  values
    ('dddddddd-dddd-4ddd-8ddd-000000003771'::uuid, 'BREAD', '2025-01-01'::date),
    ('dddddddd-dddd-4ddd-8ddd-000000003771'::uuid, 'MILK', '2025-01-01'::date),
    (null::uuid, 'COOKIE', '2025-12-01'::date)
) as c (store_id, item, effective_from);

select results_eq(
  $$
    select d.item_external_id, d.item_type_external_id, d.type_known, d.role::text, d.cost_known
    from public.data_quality_items(array['dddddddd-dddd-4ddd-8ddd-000000003771', 'dddddddd-dddd-4ddd-8ddd-000000003772']::uuid[], '2025-11-01', '2025-11-30') d
  $$,
  $$
    values
      ('BREAD'::text, 'SNACK'::text, true, null::text, true),
      ('MILK', 'DRINK', true, 'drink', false),
      ('COOKIE', 'SNACK', true, null, false)
  $$,
  'an unmapped type has no role; a cost counts only when every store that sold the item has one in force on the last day'
);

select is(
  array[
    (select count(*)::integer from public.data_quality_items(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-27', '2025-10-31')),
    (select count(*)::integer from public.data_quality_payments(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-27', '2025-10-31')),
    (select count(*)::integer from public.data_quality_summary(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-27', '2025-10-31'))
  ],
  array[4, 4, 2],
  'the three data-quality functions accept 400 days'
);

select throws_ok(
  $$ select * from public.data_quality_items(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-26', '2025-10-31') $$,
  '22023',
  null,
  'data_quality_items refuses 401 days'
);

select throws_ok(
  $$ select * from public.data_quality_payments(array['dddddddd-dddd-4ddd-8ddd-000000003771']::uuid[], '2024-09-26', '2025-10-31') $$,
  '22023',
  null,
  'data_quality_payments refuses 401 days'
);

select * from finish();
rollback;
