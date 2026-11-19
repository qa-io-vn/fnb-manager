begin;
select plan(24);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009601'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000009601'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000009601'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000009602'::uuid as store_2,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000009601'::uuid as programme_m;

insert into public.tenants (id, slug, name, country_code)
select tenant_m, 'coupon-pools-pgtap', 'Coupon pools pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_m, tenant_m, 'mock', 'coupon-pools-m', 'Synthetic account M' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_1, tenant_m, account_m, 'cp-1', 'CP1', 'Synthetic store 1' from fx
union all
select store_2, tenant_m, account_m, 'cp-2', 'CP2', 'Synthetic store 2' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_m, tenant_m, 'Synthetic programme M', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_m, store_1, 'crm_code_pool'::public.coupon_rail, '{POOL-1}'::text[], now() - interval '30 days' from fx
union all
select tenant_m, store_2, 'crm_code_pool', '{POOL-2}', now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_m, store_1, 'free-drink', 'POOL-1', 'discount'::public.einvoice_display from fx
union all
select tenant_m, store_2, 'free-drink', 'POOL-2', 'discount' from fx;

create function pg_temp.import(p_store uuid, p_codes text[])
returns jsonb
language sql
as $$
  select app.import_coupon_codes((select tenant_m from fx), p_store, 'free-drink', p_codes);
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_voucher text, p_status public.invoice_status default 'completed', p_days integer default 0)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, voucher_code, net_amount, paid_amount, status)
  select fx.tenant_m, p_store, fx.account_m, 'cp-' || p_name, now() - make_interval(days => p_days) - interval '1 hour',
    app.store_business_date(p_store, now() - make_interval(days => p_days) - interval '1 hour'), 50000, p_voucher, 50000, 50000, p_status
  from fx
  returning id;
$$;

create function pg_temp.pass()
returns integer
language sql
as $$
  select app.mark_used_pool_codes(
    (select tenant_m from fx),
    app.store_business_date((select store_1 from fx), now()) - 3,
    app.store_business_date((select store_1 from fx), now()),
    now()
  );
$$;

create function pg_temp.states(p_store uuid)
returns text
language sql
as $$
  select coalesce(string_agg(code || ':' || state::text, ',' order by code), '')
  from public.coupon_codes where store_id = p_store;
$$;

select is(
  pg_temp.import((select store_1 from fx), array['AAA1001', 'AAA1002', 'aaa1002', 'bad code', '', 'AAA1003', 'AAA1004']),
  '{"received": 7, "inserted": 4, "malformed": 2, "duplicates": 1, "already_present": 0, "conflicting": 0}'::jsonb,
  'an import counts malformed and duplicate rows and inserts the rest'
);
select is(
  (select count(*)::integer from public.coupon_codes where store_id = (select store_1 from fx) and state = 'available' and crm_programme_external_id = 'POOL-1'),
  4,
  'the codes are available, with the CRM programme of the store''s mapping'
);
select is(
  pg_temp.import((select store_1 from fx), array['AAA1001', 'AAA1002', 'AAA1003', 'AAA1004']),
  '{"received": 4, "inserted": 0, "malformed": 0, "duplicates": 0, "already_present": 4, "conflicting": 0}'::jsonb,
  'a second import of the same export changes nothing'
);
select is(
  pg_temp.import((select store_2 from fx), array['aaa1001', 'BBB2001']),
  '{"received": 2, "inserted": 1, "malformed": 0, "duplicates": 0, "already_present": 0, "conflicting": 1}'::jsonb,
  'a code another pool of the tenant holds is conflicting'
);
select throws_ok(
  format('select app.import_coupon_codes(%L, %L, %L, array[%L])', (select tenant_m from fx), (select store_1 from fx), 'no-mapping', 'CCC3001'),
  '22023',
  null,
  'a reward without a mapping at the store gets no pool'
);
select throws_ok(
  format('select app.import_coupon_codes(%L, %L, %L, array_fill(%L::text, array[1001]))', (select tenant_m from fx), (select store_1 from fx), 'free-drink', 'X'),
  '22023',
  null,
  'an import holds at most 1,000 codes'
);
select throws_ok(
  format('select app.import_coupon_codes(%L, %L, %L, array[%L])', '00000000-0000-4000-8000-000000000000', (select store_1 from fx), 'free-drink', 'CCC3001'),
  '22023',
  null,
  'the store belongs to the tenant'
);

update public.coupon_codes set state = 'quarantined', quarantined_at = now() - interval '2 days' where code = 'AAA1003';
select pg_temp.invoice('used-1', (select store_1 from fx), ' aaa1001 ');
select pg_temp.invoice('voided-2', (select store_1 from fx), 'AAA1002', 'voided');
select pg_temp.invoice('other-store-4', (select store_2 from fx), 'AAA1004');
select pg_temp.invoice('quarantined-3', (select store_1 from fx), 'AAA1003');
select pg_temp.invoice('old-4', (select store_1 from fx), 'AAA1004', 'completed', 20);

select is(pg_temp.pass(), 2, 'the pass marks the codes found on non-voided invoices of the store in the range');
select is(
  pg_temp.states((select store_1 from fx)),
  'AAA1001:used,AAA1002:available,AAA1003:used,AAA1004:available',
  'a voided invoice, another store''s invoice and an invoice outside the range mark nothing; a quarantined code the till used becomes used'
);
select is(
  (select i.external_id from public.coupon_codes k join public.invoices i on i.id = k.used_invoice_id where k.code = 'AAA1001'),
  'cp-used-1',
  'the used code keeps the invoice that used it'
);
select is(pg_temp.pass(), 0, 'the pass is idempotent');
select is(
  (
    app.reconcile_loyalty(
      (select tenant_m from fx),
      app.store_business_date((select store_1 from fx), now()) - 30,
      app.store_business_date((select store_1 from fx), now()),
      now()
    ) ->> 'pool_codes_used'
  )::integer,
  1,
  'the reconciliation after a sync runs the pass over its range'
);
select is(pg_temp.states((select store_1 from fx)), 'AAA1001:used,AAA1002:available,AAA1003:used,AAA1004:used', 'the old invoice''s code is now used');

select is(
  (select string_agg(store_code || ':' || reward_key || ':' || state::text || ':' || codes::text, ',' order by store_code, state) from app.coupon_code_status((select tenant_m from fx))),
  'CP1:free-drink:available:1,CP1:free-drink:used:3,CP2:free-drink:available:1',
  'the status counts codes per store, reward and state'
);
select is(
  (select string_agg(code || ':' || coalesce(invoice_external_id, '-'), ',' order by code) from app.coupon_codes_in_state((select tenant_m from fx), 'used')),
  'AAA1001:cp-used-1,AAA1003:cp-quarantined-3,AAA1004:cp-old-4',
  'the export lists exactly the used codes with their invoices'
);
select is(
  (select count(*)::integer from app.coupon_codes_in_state((select tenant_m from fx), 'quarantined')),
  0,
  'and nothing is quarantined any more'
);

select ok(has_function_privilege('service_role', 'app.import_coupon_codes(uuid, uuid, text, text[], timestamptz, timestamptz)', 'execute'), 'the service role imports');
select ok(not has_function_privilege('authenticated', 'app.import_coupon_codes(uuid, uuid, text, text[], timestamptz, timestamptz)', 'execute'), 'a signed-in user does not');
select ok(not has_function_privilege('authenticated', 'app.coupon_codes_in_state(uuid, public.coupon_code_state)', 'execute'), 'nor exports codes');
select ok(not has_function_privilege('anon', 'app.coupon_code_status(uuid)', 'execute'), 'anon reads no status');
select ok(not has_function_privilege('authenticated', 'app.mark_used_pool_codes(uuid, date, date, timestamptz)', 'execute'), 'only the jobs run the pass');
select throws_ok(
  format('select app.mark_used_pool_codes(%L, current_date - 70, current_date)', (select tenant_m from fx)),
  '22023',
  null,
  'the pass covers at most 63 days'
);
select throws_ok(
  format('select app.import_coupon_codes(%L, %L, %L, array[%L], now() - interval %L)', (select tenant_m from fx), (select store_1 from fx), 'free-drink', 'CCC3002', '1 day'),
  '22023',
  null,
  'codes never expire before their import'
);
select is(
  (app.import_coupon_codes((select tenant_m from fx), (select store_1 from fx), 'free-drink', array['CCC3003'], now() + interval '30 days') ->> 'inserted')::integer,
  1,
  'an import may carry the export''s expiry'
);

select * from finish();
rollback;
