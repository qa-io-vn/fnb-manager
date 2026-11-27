-- Indexes for the foreign keys of the e-invoice tables (migration einvoices, ADR-069): every referencing column set
-- gets an index whose leading columns are the key, so a cascaded delete or a set null (an order, a store, a provider,
-- a request, a customer login, an Auth user, the tenant) finds its rows without scanning the table. Single-column
-- tenant indexes and the partial indexes these cover are dropped; the order and store-state indexes the readers use
-- stay.

create index e_invoices_tenant_order_idx on public.e_invoices (tenant_id, order_id);
create index e_invoices_tenant_store_idx on public.e_invoices (tenant_id, store_id);
create index e_invoices_tenant_request_idx on public.e_invoices (tenant_id, request_id);
create index e_invoices_tenant_provider_idx on public.e_invoices (tenant_id, provider_id);
drop index public.e_invoices_original_idx;
create index e_invoices_original_idx on public.e_invoices (original_id);
drop index public.e_invoices_request_idx;
drop index public.e_invoices_provider_idx;
drop index public.e_invoices_tenant_idx;

create index invoice_requests_tenant_order_idx on public.invoice_requests (tenant_id, order_id);
create index invoice_requests_tenant_store_idx on public.invoice_requests (tenant_id, store_id);
create index invoice_requests_tenant_einvoice_idx on public.invoice_requests (tenant_id, einvoice_id);
drop index public.invoice_requests_login_idx;
create index invoice_requests_login_idx on public.invoice_requests (customer_login_id);
create index invoice_requests_requested_by_idx on public.invoice_requests (requested_by);
drop index public.invoice_requests_einvoice_idx;
drop index public.invoice_requests_tenant_idx;

create index einvoice_providers_tenant_brand_idx on public.einvoice_providers (tenant_id, brand_id);
create index einvoice_providers_tenant_store_idx on public.einvoice_providers (tenant_id, store_id);
create index einvoice_providers_created_by_idx on public.einvoice_providers (created_by);
create index einvoice_providers_updated_by_idx on public.einvoice_providers (updated_by);
drop index public.einvoice_providers_tenant_idx;
drop index public.einvoice_providers_store_idx;

create index einvoice_provider_changes_tenant_provider_idx on public.einvoice_provider_changes (tenant_id, provider_id);
create index einvoice_provider_changes_changed_by_idx on public.einvoice_provider_changes (changed_by);
drop index public.einvoice_provider_changes_tenant_idx;
