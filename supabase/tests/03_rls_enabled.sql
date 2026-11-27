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
  121,
  'public holds the 121 expected tables'
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
      and tablename not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests', 'alert_rules', 'channel_policies', 'report_settings', 'item_category_overrides', 'payment_kind_overrides', 'legal_documents', 'stores', 'tenants', 'brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'checklist_templates', 'checklist_items', 'checklist_runs', 'checklist_answers', 'checklist_corrections', 'shift_handovers', 'incidents', 'incident_categories', 'cash_counts', 'announcements', 'announcement_recipients', 'announcement_receipts', 'approval_request_kinds', 'approval_requests', 'loyalty_programmes', 'loyalty_staff_phones', 'coupon_rails', 'coupon_rail_rewards', 'coupons', 'oa_menus', 'store_ordering_settings', 'ordering_closures', 'menu_categories', 'menu_items', 'menu_item_sizes', 'menu_option_groups', 'menu_options', 'menu_item_option_groups', 'menu_store_items', 'store_tables')
  ),
  0,
  'write policies exist only on the manual-input tables, the settings and mappings, the store and tenant profiles, strategy_reports, the legal ledgers, alert_rules, channel_policies, the Zalo configuration with the OA menus, the operations tables of phase 14b, incident_categories and the loyalty configuration'
);

select is(
  (
    select count(distinct table_name)::int
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and privilege_type <> 'SELECT'
      and table_name not in ('item_costs', 'payment_fee_rates', 'item_type_roles', 'holidays', 'targets', 'strategy_reports', 'consent_records', 'data_subject_requests', 'alert_rules', 'channel_policies', 'report_settings', 'item_category_overrides', 'payment_kind_overrides', 'legal_documents', 'brands', 'zalo_apps', 'oas', 'mini_apps', 'zbs_templates', 'gmf_groups', 'incident_categories', 'approval_request_kinds', 'loyalty_programmes', 'loyalty_staff_phones', 'coupon_rails', 'coupon_rail_rewards', 'coupons', 'oa_menus', 'ordering_closures', 'menu_categories', 'menu_items', 'menu_item_sizes', 'menu_option_groups', 'menu_options', 'menu_item_option_groups', 'menu_store_items', 'store_tables')
  ),
  0,
  'authenticated holds table-wide write privileges only on the manual-input tables, the settings and mappings, strategy_reports, the legal ledgers, alert_rules, channel_policies, the Zalo configuration, incident_categories, the loyalty configuration and the delete of OA menus'
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
  array['approval_request_kinds:3', 'checklist_answers:3', 'checklist_runs:1', 'incident_categories:3', 'incidents:5', 'legal_documents:3', 'menu_categories:3', 'menu_item_option_groups:1', 'menu_item_sizes:5', 'menu_items:10', 'menu_option_groups:4', 'menu_options:5', 'menu_store_items:2', 'oa_menus:8', 'shift_handovers:3', 'store_ordering_settings:9', 'store_tables:4', 'stores:7', 'tenants:2'],
  'authenticated may update seven columns of stores, two of tenants, three of legal_documents, the eight configured columns of oa_menus and, in phase 14b, the answer fields of checklist_answers, the status of checklist_runs, the label, order and active flag of incident_categories and the content of incidents and shift_handovers, and no other column by column grant'
);

select * from finish();
rollback;
