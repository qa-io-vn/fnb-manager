alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.pos_accounts enable row level security;
alter table public.pos_account_tokens enable row level security;
alter table public.stores enable row level security;
alter table public.item_types enable row level security;
alter table public.item_classes enable row level security;
alter table public.units enable row level security;
alter table public.items enable row level security;
alter table public.store_items enable row level security;
alter table public.packages enable row level security;
alter table public.customizations enable row level security;
alter table public.sources enable row level security;
alter table public.payment_methods enable row level security;
alter table public.promotions enable row level security;
alter table public.devices enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_events enable row level security;
alter table public.shifts enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_checks enable row level security;
alter table public.item_costs enable row level security;
alter table public.payment_fee_rates enable row level security;
alter table public.item_type_roles enable row level security;
alter table public.holidays enable row level security;
alter table public.targets enable row level security;
alter table public.strategy_reports enable row level security;
alter table public.consent_records enable row level security;
alter table public.data_subject_requests enable row level security;
alter table public.outbound_messages enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

revoke insert, update, delete, truncate, references, trigger, maintain on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger, maintain on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from authenticated;

grant insert, update, delete on public.item_costs, public.payment_fee_rates, public.item_type_roles, public.holidays, public.targets, public.strategy_reports to authenticated;
grant insert, update on public.consent_records, public.data_subject_requests to authenticated;
revoke all on public.pos_account_tokens from authenticated;

create policy tenants_select_for_members on public.tenants
  for select to authenticated
  using (id = any ((select app.current_user_tenant_ids())::uuid[]));

create policy tenant_members_select_for_data_members on public.tenant_members
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy pos_accounts_select_for_data_members on public.pos_accounts
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy stores_select_for_readers on public.stores
  for select to authenticated
  using (id = any ((select app.current_user_store_ids())::uuid[]));

create policy item_types_select_for_data_members on public.item_types
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy item_classes_select_for_data_members on public.item_classes
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy units_select_for_data_members on public.units
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy items_select_for_data_members on public.items
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy store_items_select_for_data_store_readers on public.store_items
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy packages_select_for_data_members on public.packages
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy customizations_select_for_data_members on public.customizations
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy sources_select_for_data_members on public.sources
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy payment_methods_select_for_data_members on public.payment_methods
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy promotions_select_for_data_members on public.promotions
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy devices_select_for_data_members on public.devices
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy customers_select_for_data_members on public.customers
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy invoices_select_for_data_store_readers on public.invoices
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy invoice_lines_select_for_data_store_readers on public.invoice_lines
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy invoice_payments_select_for_data_store_readers on public.invoice_payments
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy invoice_events_select_for_data_store_readers on public.invoice_events
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy shifts_select_for_data_store_readers on public.shifts
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy sync_runs_select_for_data_members on public.sync_runs
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy sync_checks_select_for_data_store_readers on public.sync_checks
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy item_costs_select_for_data_store_readers on public.item_costs
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    and (store_id is null or store_id = any ((select app.current_user_data_store_ids())::uuid[]))
  );

create policy item_costs_insert_for_scope_managers on public.item_costs
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, store_id)
    and created_by = (select auth.uid())
  );

create policy item_costs_update_for_scope_managers on public.item_costs
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id))
  with check (app.can_manage_store_scope(tenant_id, store_id));

create policy item_costs_delete_for_scope_managers on public.item_costs
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id));

create policy payment_fee_rates_select_for_data_store_readers on public.payment_fee_rates
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    and (store_id is null or store_id = any ((select app.current_user_data_store_ids())::uuid[]))
  );

create policy payment_fee_rates_insert_for_scope_managers on public.payment_fee_rates
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, store_id)
    and created_by = (select auth.uid())
  );

create policy payment_fee_rates_update_for_scope_managers on public.payment_fee_rates
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id))
  with check (app.can_manage_store_scope(tenant_id, store_id));

create policy payment_fee_rates_delete_for_scope_managers on public.payment_fee_rates
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id));

create policy item_type_roles_select_for_data_members on public.item_type_roles
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy item_type_roles_insert_for_tenant_managers on public.item_type_roles
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, null)
    and created_by = (select auth.uid())
  );

create policy item_type_roles_update_for_tenant_managers on public.item_type_roles
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, null))
  with check (app.can_manage_store_scope(tenant_id, null));

create policy item_type_roles_delete_for_tenant_managers on public.item_type_roles
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, null));

create policy holidays_select_for_members on public.holidays
  for select to authenticated
  using (tenant_id is null or tenant_id = any ((select app.current_user_tenant_ids())::uuid[]));

create policy holidays_insert_for_tenant_managers on public.holidays
  for insert to authenticated
  with check (tenant_id is not null and app.can_manage_store_scope(tenant_id, null));

create policy holidays_update_for_tenant_managers on public.holidays
  for update to authenticated
  using (tenant_id is not null and app.can_manage_store_scope(tenant_id, null))
  with check (tenant_id is not null and app.can_manage_store_scope(tenant_id, null));

create policy holidays_delete_for_tenant_managers on public.holidays
  for delete to authenticated
  using (tenant_id is not null and app.can_manage_store_scope(tenant_id, null));

create policy targets_select_for_data_store_readers on public.targets
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy targets_insert_for_scope_managers on public.targets
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, store_id)
    and created_by = (select auth.uid())
  );

create policy targets_update_for_scope_managers on public.targets
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id))
  with check (app.can_manage_store_scope(tenant_id, store_id));

create policy targets_delete_for_scope_managers on public.targets
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id));

create policy strategy_reports_select_for_store_readers on public.strategy_reports
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_tenant_ids())::uuid[])
    and (store_id is null or store_id = any ((select app.current_user_store_ids())::uuid[]))
  );

create policy strategy_reports_insert_for_scope_publishers on public.strategy_reports
  for insert to authenticated
  with check (
    app.can_publish_store_scope(tenant_id, store_id)
    and created_by = (select auth.uid())
  );

create policy strategy_reports_update_for_scope_managers on public.strategy_reports
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id))
  with check (app.can_manage_store_scope(tenant_id, store_id));

create policy strategy_reports_delete_for_scope_managers on public.strategy_reports
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, store_id));

create policy consent_records_select_for_data_members on public.consent_records
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy consent_records_insert_for_tenant_managers on public.consent_records
  for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));

create policy consent_records_update_for_tenant_managers on public.consent_records
  for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));

create policy data_subject_requests_select_for_tenant_managers on public.data_subject_requests
  for select to authenticated
  using (app.can_manage_store_scope(tenant_id, null));

create policy data_subject_requests_insert_for_tenant_managers on public.data_subject_requests
  for insert to authenticated
  with check (app.can_manage_store_scope(tenant_id, null));

create policy data_subject_requests_update_for_tenant_managers on public.data_subject_requests
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, null))
  with check (app.can_manage_store_scope(tenant_id, null));

create policy outbound_messages_select_for_tenant_managers on public.outbound_messages
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
