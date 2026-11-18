begin;
select plan(14);

insert into public.tenants (id, slug, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ipos-source-real', 'iPOS source real'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ipos-source-snapshot', 'iPOS source snapshot');

select has_table('app', 'tenant_ipos_sources', 'app.tenant_ipos_sources exists');
select col_is_pk('app', 'tenant_ipos_sources', 'tenant_id', 'one source per tenant');
select fk_ok('app', 'tenant_ipos_sources', 'tenant_id', 'public', 'tenants', 'id', 'the source belongs to a tenant');

select is(
  app.claim_ipos_source('aaaaaaaa-0000-4000-8000-000000000001', 'api'),
  'api',
  'the first claim records api'
);
select is(
  app.claim_ipos_source('aaaaaaaa-0000-4000-8000-000000000001', 'snapshot'),
  'api',
  'a later snapshot claim keeps api and returns it'
);
select is(
  app.claim_ipos_source('aaaaaaaa-0000-4000-8000-000000000002', 'snapshot'),
  'snapshot',
  'the first claim records snapshot'
);
select is(
  app.claim_ipos_source('aaaaaaaa-0000-4000-8000-000000000002', 'api'),
  'snapshot',
  'a later api claim keeps snapshot and returns it'
);
select is(
  (select count(*)::integer from app.tenant_ipos_sources where tenant_id in ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002')),
  2,
  'each tenant holds one row'
);

select throws_ok(
  $$ select app.claim_ipos_source('aaaaaaaa-0000-4000-8000-000000000001', 'fake') $$,
  '22023',
  'claim_ipos_source takes api or snapshot',
  'an unknown source is refused'
);
select throws_ok(
  $$ insert into app.tenant_ipos_sources (tenant_id, source) values ('aaaaaaaa-0000-4000-8000-000000000001', 'other') $$,
  '23514',
  null,
  'the table accepts only api and snapshot'
);

delete from public.tenants where id = 'aaaaaaaa-0000-4000-8000-000000000002';
select is(
  (select count(*)::integer from app.tenant_ipos_sources where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  0,
  'deleting a tenant deletes its source'
);

select is(
  (select count(*)::integer
   from information_schema.role_table_grants
   where table_schema = 'app' and table_name = 'tenant_ipos_sources'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0,
  'no API role can read or write the sources'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'claim_ipos_source'
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'no API role can claim a source'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'claim_ipos_source'
     and not p.prosecdef
     and array_to_string(p.proconfig, ',') = 'search_path=""'),
  1,
  'claim_ipos_source runs as the caller with an empty search_path'
);

select * from finish();
rollback;
