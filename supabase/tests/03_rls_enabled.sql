begin;
select plan(10);

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
  66,
  'public holds the 66 expected tables'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('pos_account_tokens', 'zalo_tokens', 'oa_events')),
  0,
  'the token caches pos_account_tokens and zalo_tokens and the event log oa_events have no policies'
);

select is(
  (
    select count(distinct tablename)::int
    from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and tablename not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests', 'alert_rules', 'channel_policies', 'report_settings', 'item_category_overrides', 'payment_kind_overrides', 'legal_documents', 'stores', 'tenants', 'brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups')
  ),
  0,
  'write policies exist only on the manual-input tables, the settings and mappings, the store and tenant profiles, strategy_reports, the legal ledgers, alert_rules, channel_policies and the Zalo configuration'
);

select is(
  (
    select count(distinct table_name)::int
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and privilege_type <> 'SELECT'
      and table_name not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests', 'alert_rules', 'channel_policies', 'report_settings', 'item_category_overrides', 'payment_kind_overrides', 'legal_documents', 'brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups')
  ),
  0,
  'authenticated holds table-wide write privileges only on the manual-input tables, the settings and mappings, strategy_reports, the legal ledgers, alert_rules, channel_policies and the Zalo configuration'
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

select is(
  (
    select array_agg(t.table_name || ':' || t.columns order by t.table_name)
    from (
      select c.table_name::text, count(*)::int as columns
      from information_schema.column_privileges c
      where c.grantee = 'authenticated'
        and c.table_schema = 'public'
        and c.privilege_type = 'UPDATE'
        and not exists (
          select 1
          from information_schema.role_table_grants g
          where g.grantee = 'authenticated'
            and g.table_schema = 'public'
            and g.table_name = c.table_name
            and g.privilege_type = 'UPDATE'
        )
      group by c.table_name
    ) t
  ),
  array['legal_documents:3', 'stores:7', 'tenants:2'],
  'authenticated may update seven columns of stores, two of tenants and three of legal_documents, and no other column by column grant'
);

select * from finish();
rollback;
