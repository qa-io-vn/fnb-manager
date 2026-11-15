begin;
select plan(16);

create temp table fixture as
select
  'dddddddd-dddd-4ddd-8ddd-000000003901'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003902'::uuid as other_tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000003911'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003912'::uuid as other_account_id,
  'dddddddd-dddd-4ddd-8ddd-000000003921'::uuid as store_1,
  'dddddddd-dddd-4ddd-8ddd-000000003922'::uuid as store_2,
  'dddddddd-dddd-4ddd-8ddd-000000003923'::uuid as other_store,
  'eeeeeeee-eeee-4eee-8eee-000000003901'::uuid as owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000003902'::uuid as store_manager_id,
  'eeeeeeee-eeee-4eee-8eee-000000003903'::uuid as viewer_id,
  'eeeeeeee-eeee-4eee-8eee-000000003904'::uuid as publisher_id,
  'eeeeeeee-eeee-4eee-8eee-000000003905'::uuid as other_owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000003906'::uuid as store_owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000003907'::uuid as staff_id;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'access-b-owner@example.com'),
    (f.store_manager_id, 'access-b-store-manager@example.com'),
    (f.viewer_id, 'access-b-viewer@example.com'),
    (f.publisher_id, 'access-b-publisher@example.com'),
    (f.other_owner_id, 'access-b-other-owner@example.com'),
    (f.store_owner_id, 'access-b-store-owner@example.com'),
    (f.staff_id, 'access-b-staff@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-access-b', 'Access B' from fixture
union all
select other_tenant_id, 'theme-pgtap-access-b-other', 'Access B Other' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all select f.tenant_id, f.store_manager_id, 'manager', array[f.store_1] from fixture f
union all select f.tenant_id, f.viewer_id, 'viewer', null from fixture f
union all select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all select f.tenant_id, f.store_owner_id, 'owner', array[f.store_1] from fixture f
union all select f.tenant_id, f.staff_id, 'staff', null from fixture f
union all select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-access-b', 'Access B POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'theme-pgtap-access-b-other', 'Access B Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_id, account_id, 'access-b-1', 'Store 1' from fixture
union all
select store_2, tenant_id, account_id, 'access-b-2', 'Store 2' from fixture
union all
select other_store, other_tenant_id, other_account_id, 'access-b-o', 'Other' from fixture;

create temp table sale as
select *
from (
  values
    ('S1-1', 'store_1', 'TEA', 'KM-T'),
    ('S2-1', 'store_2', 'CAKE', 'KM-T'),
    ('S2-2', 'store_2', 'CAKE', 'KM-T2'),
    ('O-1', 'other_store', 'MILK', 'KM-T')
) as v (external_id, store, item, promotion_id);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, shift_external_id, gross_amount, item_discount_amount, net_amount, paid_amount)
select
  case when v.store = 'other_store' then f.other_tenant_id else f.tenant_id end,
  case v.store when 'store_1' then f.store_1 when 'store_2' then f.store_2 else f.other_store end,
  case when v.store = 'other_store' then f.other_account_id else f.account_id end,
  v.external_id, '1', ('2025-11-03'::date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', '2025-11-03', 'SH-' || v.store,
  50000, 5000, 45000, 45000
from sale v
cross join fixture f;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name)
select i.tenant_id, i.store_id, i.id, 'L1', 'item'::public.line_kind, v.item, v.item, 1, 50000, 50000, 5000, 45000, v.promotion_id, v.promotion_id
from sale v
join public.invoices i on i.external_id = v.external_id
where i.tenant_id in (select tenant_id from fixture union all select other_tenant_id from fixture);

insert into public.shifts (tenant_id, store_id, external_id, name, opened_at, closed_at)
select i.tenant_id, i.store_id, i.shift_external_id, 'Ca', ('2025-11-03'::date + time '06:00') at time zone 'Asia/Ho_Chi_Minh', ('2025-11-03'::date + time '22:00') at time zone 'Asia/Ho_Chi_Minh'
from (select distinct tenant_id, store_id, shift_external_id from public.invoices where external_id in (select external_id from sale) and tenant_id in (select tenant_id from fixture union all select other_tenant_id from fixture)) i;

insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, opened_at, closed_at, orders)
select s.tenant_id, s.store_id, s.id, s.external_id, '2025-11-03', s.opened_at, s.closed_at, 1
from public.shifts s
where s.tenant_id in (select tenant_id from fixture union all select other_tenant_id from fixture);

insert into public.agg_item_daily (tenant_id, store_id, business_date, item_external_id, item_name, quantity, net_amount, invoices)
select i.tenant_id, i.store_id, '2025-11-03', l.item_external_id, l.item_name, 1, 45000, 1
from public.invoices i
join public.invoice_lines l on l.invoice_id = i.id
where i.external_id in (select external_id from sale)
  and i.tenant_id in (select tenant_id from fixture union all select other_tenant_id from fixture)
on conflict do nothing;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select tenant_id, account_id, 'CASH', 'Tiền mặt', 'cash'::public.payment_kind from fixture
union all
select other_tenant_id, other_account_id, 'CASH', 'Tiền mặt', 'cash' from fixture;

insert into public.agg_payment_daily (tenant_id, store_id, business_date, payment_method_external_id, payment_method_name, kind, invoices, amount)
select i.tenant_id, i.store_id, '2025-11-03', 'CASH', 'Tiền mặt', 'cash'::public.payment_kind, count(*), sum(i.paid_amount)
from public.invoices i
where i.external_id in (select external_id from sale)
  and i.tenant_id in (select tenant_id from fixture union all select other_tenant_id from fixture)
group by i.tenant_id, i.store_id;

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
select tenant_id, 'privacy_notice', 'vi', 'privacy-2025-11', 'Thông báo', '# Thông báo' from fixture;

create temp table probes as
select *
from (
  values
    ('promotion_days', $q$ select coalesce(string_agg(x, ',' order by x), '-') from (select distinct right(d.store_id::text, 4) as x from public.promotion_days('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') d) s $q$),
    ('promotion_catalogue', $q$ select coalesce(string_agg(c.promotion_key || ':' || c.days_used_365, ',' order by c.promotion_key), '-') from public.promotion_catalogue('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-05') c $q$),
    ('promotion_lift', $q$ select l.test_store_count::text from public.promotion_lift('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', 'item', 'KM-T', '2025-10-01', '2025-11-05', 'baseline') l where l.business_date is null $q$),
    ('promotion_compliance', $q$ select coalesce(sum(c.checked_rows)::text, '-') from public.promotion_compliance('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') c where c.promotion_kind <> 'invoice_total' $q$),
    ('item_discount_days', $q$ select coalesce(string_agg(d.item_external_id, ',' order by d.item_external_id), '-') from public.item_discount_days('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', 2025, '2025-12-31') d $q$),
    ('shift_adjustments', $q$ select coalesce(string_agg(x, ',' order by x), '-') from (select distinct right(a.store_id::text, 4) as x from public.shift_adjustments('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') a) s $q$),
    ('data_quality_items', $q$ select coalesce(string_agg(d.item_external_id, ',' order by d.item_external_id), '-') from public.data_quality_items('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') d $q$),
    ('data_quality_summary', $q$ select string_agg(coalesce(right(s.store_id::text, 4), 'all') || ':' || s.invoices, ',' order by s.store_id nulls first) from public.data_quality_summary('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') s $q$),
    ('data_quality_payments', $q$ select coalesce(string_agg(p.payment_method_external_id || ':' || coalesce(p.amount::text, '-'), ',' order by p.payment_method_external_id), '-') from public.data_quality_payments('{dddddddd-dddd-4ddd-8ddd-000000003921,dddddddd-dddd-4ddd-8ddd-000000003922,dddddddd-dddd-4ddd-8ddd-000000003923}', '2025-11-01', '2025-11-05') p $q$)
) as p (name, statement);

create function pg_temp.value_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement into v_value;
  return coalesce(v_value, '-');
exception when others then
  return sqlstate;
end;
$$;

grant select on probes, fixture to authenticated, anon;

create function pg_temp.probe_row(p_name text)
returns text[]
language sql
as $$
  select array[
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003901', p.statement),
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003902', p.statement),
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003903', p.statement),
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003904', p.statement),
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003905', p.statement),
    pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003907', p.statement)
  ]
  from probes p
  where p.name = p_name;
$$;

set local role authenticated;

select is(pg_temp.probe_row('promotion_days'), array['3921,3922', '3921', '3921,3922', '-', '3923', '3921,3922'],
  'promotion_days: the owner and a viewer see their stores, a store-limited manager their store, the publisher nothing and another tenant''s owner only their own store');

select is(pg_temp.probe_row('promotion_catalogue'), array['KM-T:1,KM-T2:1', 'KM-T:1', 'KM-T:1,KM-T2:1', '-', 'KM-T:1', 'KM-T:1,KM-T2:1'],
  'promotion_catalogue follows the same scope');

select is(pg_temp.probe_row('promotion_lift'), array['2', '1', '2', '0', '1', '2'],
  'promotion_lift counts only the test stores the member reads');

select is(pg_temp.probe_row('promotion_compliance'), array['3', '1', '3', '-', '1', '3'],
  'promotion_compliance checks only the rows the member reads');

select is(pg_temp.probe_row('item_discount_days'), array['CAKE,TEA', 'TEA', 'CAKE,TEA', '-', 'MILK', 'CAKE,TEA'],
  'item_discount_days lists only the items of the stores the member reads');

select is(pg_temp.probe_row('shift_adjustments'), array['3921,3922', '3921', '3921,3922', '-', '3923', '3921,3922'],
  'shift_adjustments returns only the shifts of the stores the member reads');

select is(pg_temp.probe_row('data_quality_items'), array['CAKE,TEA', 'TEA', 'CAKE,TEA', '-', 'MILK', 'CAKE,TEA'],
  'data_quality_items lists only the items of the stores the member reads');

select is(pg_temp.probe_row('data_quality_summary'), array['all:3,3921:1,3922:2', 'all:1,3921:1', 'all:3,3921:1,3922:2', 'all:0,3921:0,3922:0', 'all:1,3923:1', 'all:3,3921:1,3922:2'],
  'data_quality_summary has a row for each store the member sees, and the publisher''s counts are empty');

select is(pg_temp.probe_row('data_quality_payments'), array['CASH:135000.00', 'CASH:45000.00', 'CASH:135000.00', '-', 'CASH:45000.00', 'CASH:135000.00'],
  'data_quality_payments sums only the payments of the stores the member reads');

reset role;

create temp table draft as select id from public.legal_documents where tenant_id = (select tenant_id from fixture);
grant select on draft to authenticated, anon;

set local role anon;

select is(
  (
    select array_agg(p.proname::text || ':' || has_function_privilege('anon', p.oid, 'execute')::text order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'promotion_days', 'promotion_catalogue', 'promotion_lift', 'promotion_compliance', 'item_discount_days',
        'shift_adjustments', 'data_quality_items', 'data_quality_summary', 'data_quality_payments',
        'publish_legal_document', 'retire_legal_document'
      )
  ),
  array[
    'data_quality_items:false', 'data_quality_payments:false', 'data_quality_summary:false', 'item_discount_days:false',
    'promotion_catalogue:false', 'promotion_compliance:false', 'promotion_days:false', 'promotion_lift:false',
    'publish_legal_document:false', 'retire_legal_document:false', 'shift_adjustments:false'
  ],
  'anon holds no execute privilege on any 10b function or legal function'
);

select is(
  array(select pg_temp.value_as(null, p.statement) from probes p order by p.name),
  array['42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501'],
  'and every call anon makes is refused'
);

select is(
  array[
    pg_temp.value_as(null, format('select public.publish_legal_document(%L)::text', (select id from draft))),
    pg_temp.value_as(null, format('select public.retire_legal_document(%L)::text', (select id from draft)))
  ],
  array['42501', '42501'],
  'anon may run neither legal function'
);

set local role authenticated;

select is(
  array(
    select pg_temp.value_as(u, format('select public.publish_legal_document(%L)::text', (select id from draft)))
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003902', 'eeeeeeee-eeee-4eee-8eee-000000003903', 'eeeeeeee-eeee-4eee-8eee-000000003904',
      'eeeeeeee-eeee-4eee-8eee-000000003905', 'eeeeeeee-eeee-4eee-8eee-000000003906', 'eeeeeeee-eeee-4eee-8eee-000000003907'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['42501', '42501', '42501', '42501', '42501', '42501'],
  'a store-limited manager, a viewer, the publisher, another tenant''s owner, a store-limited owner and staff may not publish'
);

select is(
  pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003901', format('select public.publish_legal_document(%L)::text', (select id from draft))),
  (select id::text from draft),
  'the owner with an unlimited scope publishes the text'
);

select is(
  array(
    select pg_temp.value_as(u, format('select public.retire_legal_document(%L)::text', (select id from draft)))
    from unnest(array[
      'eeeeeeee-eeee-4eee-8eee-000000003902', 'eeeeeeee-eeee-4eee-8eee-000000003903', 'eeeeeeee-eeee-4eee-8eee-000000003904',
      'eeeeeeee-eeee-4eee-8eee-000000003905', 'eeeeeeee-eeee-4eee-8eee-000000003906', 'eeeeeeee-eeee-4eee-8eee-000000003907'
    ]::uuid[]) with ordinality as m (u, n)
    order by m.n
  ),
  array['42501', '42501', '42501', '42501', '42501', '42501'],
  'and none of those may retire it'
);

select is(
  pg_temp.value_as('eeeeeeee-eeee-4eee-8eee-000000003901', format('select public.retire_legal_document(%L)::text', (select id from draft))),
  (select id::text from draft),
  'the owner retires it'
);

select * from finish();
rollback;
