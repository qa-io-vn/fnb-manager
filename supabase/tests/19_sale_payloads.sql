begin;
select plan(27);

insert into public.tenants (id, slug, name)
values
  ('55555555-5555-4555-8555-000000000001', 'payload-tenant', 'Payload Tenant'),
  ('55555555-5555-4555-8555-000000000002', 'payload-other', 'Payload Other');

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
values ('55555555-5555-4555-8555-000000000011', '55555555-5555-4555-8555-000000000001', 'mock', 'payload-account', 'Payload account');

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
values ('55555555-5555-4555-8555-000000000021', '55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000011', 'PAYLOAD-STORE', 'Payload store');

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date)
select '55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '55555555-5555-4555-8555-000000000011', v.external_id, v.sold_at, v.business_date
from (
  values
    ('A', timestamptz '2026-11-01 03:00+00', date '2026-11-01'),
    ('B', timestamptz '2026-11-01 04:00+00', date '2026-11-01'),
    ('C', timestamptz '2026-11-01 05:00+00', date '2026-11-01'),
    ('E', timestamptz '2026-11-03 05:00+00', date '2026-11-03')
) as v (external_id, sold_at, business_date);

create function pg_temp.payload_record(p_external_id text, p_version integer)
returns text
language sql
as $$
  select jsonb_build_object(
    'external_id', p_external_id,
    'invoice', jsonb_build_object('version', p_version),
    'lines', '{}'::jsonb,
    'payments', '{}'::jsonb
  )::text
$$;

create function pg_temp.payload_versions(p_business_date date)
returns text
language sql
as $$
  select string_agg((kept.entry::jsonb ->> 'external_id') || ':' || (kept.entry::jsonb -> 'invoice' ->> 'version'), ',' order by kept.ordinal)
  from public.sale_payloads p
  cross join lateral string_to_table(p.payload, E'\n') with ordinality as kept (entry, ordinal)
  where p.store_id = '55555555-5555-4555-8555-000000000021'
    and p.business_date = p_business_date
$$;

select has_table('public', 'sale_payloads', 'sale_payloads table exists');
select col_is_pk('public', 'sale_payloads', array['store_id', 'business_date'], 'sale_payloads pk is store_id and business_date');
select fk_ok('public', 'sale_payloads', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'sale_payloads references its store within the tenant');
select is(
  (select attcompression::text from pg_attribute where attrelid = 'public.sale_payloads'::regclass and attname = 'payload'),
  'l',
  'payload is compressed with lz4'
);
select is((select relrowsecurity from pg_class where oid = 'public.sale_payloads'::regclass), true, 'sale_payloads has row level security enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'sale_payloads'), 0, 'sale_payloads has no policies');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'sale_payloads' and grantee in ('anon', 'authenticated')),
  0,
  'anon and authenticated hold no privilege on sale_payloads'
);
select is(
  (
    has_function_privilege('anon', 'app.store_sale_payloads(uuid, uuid, date, text[])', 'execute'),
    has_function_privilege('authenticated', 'app.store_sale_payloads(uuid, uuid, date, text[])', 'execute'),
    has_function_privilege('service_role', 'app.store_sale_payloads(uuid, uuid, date, text[])', 'execute')
  ),
  (false, false, true),
  'only service_role can execute app.store_sale_payloads'
);
select is(
  (
    select (p.prosecdef, 'search_path=""' = any (p.proconfig))
    from pg_proc p
    where p.oid = 'app.store_sale_payloads(uuid, uuid, date, text[])'::regprocedure
  ),
  (false, true),
  'app.store_sale_payloads is security invoker and pins an empty search_path'
);

select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-01', array[pg_temp.payload_record('B', 1), pg_temp.payload_record('A', 1)]),
  2,
  'storing two sales reports two records'
);
select is(pg_temp.payload_versions('2026-11-01'), 'A:1,B:1', 'the day document holds one record per sale ordered by external id');

select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-01', array[pg_temp.payload_record('C', 1), pg_temp.payload_record('A', 2)]),
  2,
  'storing a changed and a new sale reports two records'
);
select is(pg_temp.payload_versions('2026-11-01'), 'A:2,B:1,C:1', 'a later write replaces the records of its sales and keeps the others');
select is(
  (select count(*)::int from public.sale_payloads p cross join lateral string_to_table(p.payload, E'\n') where p.store_id = '55555555-5555-4555-8555-000000000021' and p.business_date = '2026-11-01'),
  3,
  'the document keeps one line per sale'
);

select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-02', array[pg_temp.payload_record('B', 2)]),
  1,
  'storing a sale under a new business date reports one record'
);
select is(pg_temp.payload_versions('2026-11-02'), 'B:2', 'the sale is kept under its new business date');
select is(pg_temp.payload_versions('2026-11-01'), 'A:2,C:1', 'the sale leaves the document of the business date its invoice row still carries');

select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-03', array[pg_temp.payload_record('E', 1)]),
  1,
  'storing the only sale of a day reports one record'
);
select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-02', array[pg_temp.payload_record('E', 2)]),
  1,
  'moving the only sale of a day reports one record'
);
select is(
  (select count(*)::int from public.sale_payloads where store_id = '55555555-5555-4555-8555-000000000021' and business_date = '2026-11-03'),
  0,
  'a document left without records is removed'
);
select is(pg_temp.payload_versions('2026-11-02'), 'B:2,E:2', 'the moved sale joins the document of its new business date');

select is(
  app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-01', '{}'::text[]),
  0,
  'storing no record reports zero'
);
select is(pg_temp.payload_versions('2026-11-01'), 'A:2,C:1', 'storing no record leaves the document unchanged');

select throws_ok(
  $$ select app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-01', array[pg_temp.payload_record('A', 3), pg_temp.payload_record('A', 4)]) $$,
  '22023',
  null,
  'the same sale twice in one write is refused'
);
select throws_ok(
  $$ select app.store_sale_payloads('55555555-5555-4555-8555-000000000001', '55555555-5555-4555-8555-000000000021', '2026-11-01', array['{"invoice": {}}']) $$,
  '22023',
  null,
  'a record without external_id is refused'
);
select throws_ok(
  $$ select app.store_sale_payloads('55555555-5555-4555-8555-000000000002', '55555555-5555-4555-8555-000000000021', '2026-11-09', array[pg_temp.payload_record('A', 5)]) $$,
  '23503',
  null,
  'a document naming another tenant than its store is refused'
);

delete from public.tenants where id = '55555555-5555-4555-8555-000000000001';
select is((select count(*)::int from public.sale_payloads where tenant_id = '55555555-5555-4555-8555-000000000001'), 0, 'deleting the tenant deletes its payload documents');

select * from finish();
rollback;
