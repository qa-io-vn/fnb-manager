begin;
select plan(9);

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  0,
  'every table in public has row level security enabled'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')),
  46,
  'public holds the 46 expected tables'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'pos_account_tokens'),
  0,
  'pos_account_tokens has no policies'
);

select is(
  (
    select count(distinct tablename)::int
    from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and tablename not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests')
  ),
  0,
  'write policies exist only on the manual-input tables, strategy_reports and the legal ledgers'
);

select is(
  (
    select count(distinct table_name)::int
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and privilege_type <> 'SELECT'
      and table_name not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests')
  ),
  0,
  'authenticated holds write privileges only on the manual-input tables, strategy_reports and the legal ledgers'
);

select is(
  (
    select count(*)::int
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public'
      and d.defaclrole = 'postgres'::regrole
      and d.defaclobjtype = 'r'
      and a.grantee = 'authenticated'::regrole
      and a.privilege_type <> 'SELECT'
  ),
  0,
  'future tables created by postgres start read-only for authenticated'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and (qual like '%can_read_store%' or with_check like '%can_read_store%')),
  0,
  'no policy evaluates app.can_read_store per row'
);

select is(
  (select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  0,
  'anon holds no privilege on any public table'
);

select is(
  (
    select count(*)::int
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in ('consent_records', 'data_subject_requests', 'outbound_messages')
      and privilege_type = 'DELETE'
  ),
  0,
  'authenticated cannot delete from the legal ledgers'
);

select * from finish();
rollback;
