begin;
select plan(42);

select col_is_unique('public', 'tenants', array['slug'], 'tenants.slug is unique');
select col_is_pk('public', 'tenant_members', array['tenant_id', 'user_id'], 'tenant_members pk is (tenant_id, user_id)');
select col_is_unique('public', 'pos_accounts', array['tenant_id', 'account_key'], 'pos_accounts unique (tenant_id, account_key)');
select col_is_unique('public', 'pos_accounts', array['tenant_id', 'id'], 'pos_accounts unique (tenant_id, id) for tenant-consistent foreign keys');
select col_is_pk('public', 'pos_account_tokens', 'pos_account_id', 'pos_account_tokens pk is pos_account_id');

select col_is_unique('public', 'stores', array['pos_account_id', 'external_id'], 'stores unique (pos_account_id, external_id)');
select col_is_unique('public', 'stores', array['tenant_id', 'id'], 'stores unique (tenant_id, id) for tenant-consistent foreign keys');
select col_is_unique('public', 'item_types', array['pos_account_id', 'external_id'], 'item_types unique (pos_account_id, external_id)');
select col_is_unique('public', 'item_classes', array['pos_account_id', 'external_id'], 'item_classes unique (pos_account_id, external_id)');
select col_is_unique('public', 'units', array['pos_account_id', 'external_id'], 'units unique (pos_account_id, external_id)');
select col_is_unique('public', 'items', array['pos_account_id', 'external_id'], 'items unique (pos_account_id, external_id)');
select col_is_unique('public', 'store_items', array['store_id', 'item_external_id'], 'store_items unique (store_id, item_external_id)');
select col_is_unique('public', 'packages', array['pos_account_id', 'external_id'], 'packages unique (pos_account_id, external_id)');
select col_is_unique('public', 'customizations', array['pos_account_id', 'external_id'], 'customizations unique (pos_account_id, external_id)');
select col_is_unique('public', 'sources', array['pos_account_id', 'external_id'], 'sources unique (pos_account_id, external_id)');
select col_is_unique('public', 'payment_methods', array['pos_account_id', 'external_id'], 'payment_methods unique (pos_account_id, external_id)');
select col_is_unique('public', 'promotions', array['pos_account_id', 'external_id'], 'promotions unique (pos_account_id, external_id)');
select col_is_unique('public', 'devices', array['pos_account_id', 'external_id'], 'devices unique (pos_account_id, external_id)');

select index_is_unique('public', 'customers', 'customers_tenant_phone_key', 'customers (tenant_id, phone) is unique where phone is not null');

select col_is_unique('public', 'invoices', array['store_id', 'external_id'], 'invoices unique (store_id, external_id)');
select col_is_unique('public', 'invoice_lines', array['invoice_id', 'external_id'], 'invoice_lines unique (invoice_id, external_id)');
select col_is_unique('public', 'invoice_payments', array['invoice_id', 'sequence_no'], 'invoice_payments unique (invoice_id, sequence_no)');
select col_is_unique('public', 'invoice_events', array['store_id', 'invoice_external_id', 'kind', 'occurred_at'], 'invoice_events unique (store_id, invoice_external_id, kind, occurred_at)');
select col_is_unique('public', 'shifts', array['store_id', 'external_id'], 'shifts unique (store_id, external_id)');
select col_is_unique('public', 'sync_checks', array['store_id', 'business_date'], 'sync_checks unique (store_id, business_date)');

select index_is_unique('public', 'item_costs', 'item_costs_scope_item_effective_key', 'item_costs scope index is unique');
select index_is_unique('public', 'payment_fee_rates', 'payment_fee_rates_scope_method_effective_key', 'payment_fee_rates scope index is unique');
select col_is_unique('public', 'item_type_roles', array['pos_account_id', 'item_type_external_id'], 'item_type_roles unique (pos_account_id, item_type_external_id)');
select index_is_unique('public', 'holidays', 'holidays_tenant_country_date_name_key', 'holidays scope index is unique');
select col_is_unique('public', 'targets', array['store_id', 'period_kind', 'period_start'], 'targets unique (store_id, period_kind, period_start)');
select index_is_unique('public', 'consent_records', 'consent_records_one_active_per_subject_purpose_key', 'consent_records allows one active record per subject and purpose');

select fk_ok('public', 'invoices', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'invoices store foreign key carries tenant_id');
select fk_ok('public', 'invoice_lines', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'invoice_lines store foreign key carries tenant_id');
select fk_ok('public', 'targets', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'targets store foreign key carries tenant_id');
select fk_ok('public', 'item_costs', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'item_costs store foreign key carries tenant_id');
select fk_ok('public', 'stores', array['tenant_id', 'pos_account_id'], 'public', 'pos_accounts', array['tenant_id', 'id'], 'stores pos_account foreign key carries tenant_id');
select fk_ok('public', 'invoice_events', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'invoice_events store foreign key carries tenant_id');
select fk_ok('public', 'invoice_events', array['invoice_id'], 'public', 'invoices', array['id'], 'invoice_events invoice foreign key');
select fk_ok('public', 'payment_fee_rates', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'payment_fee_rates store foreign key carries tenant_id');
select fk_ok('public', 'item_type_roles', array['tenant_id', 'pos_account_id'], 'public', 'pos_accounts', array['tenant_id', 'id'], 'item_type_roles pos_account foreign key carries tenant_id');
select fk_ok('public', 'outbound_messages', array['consent_record_id'], 'public', 'consent_records', array['id'], 'outbound_messages consent foreign key');
select fk_ok('public', 'data_subject_requests', array['handled_by'], 'auth', 'users', array['id'], 'data_subject_requests handler foreign key');

select * from finish();
rollback;
