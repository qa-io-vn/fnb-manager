create type public.line_kind as enum ('item', 'modifier', 'service', 'package', 'other');
create type public.invoice_status as enum ('completed', 'edited', 'voided');
create type public.invoice_event_kind as enum ('voided', 'edited', 'line_removed', 'reissued');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  pos_account_id uuid not null,
  external_id text not null,
  receipt_no text,
  sold_at timestamptz not null,
  business_date date not null,
  opened_at timestamptz,
  closed_at timestamptz,
  table_name text,
  area_name text,
  sale_type text,
  source_external_id text,
  source_name text,
  employee_external_id text,
  employee_name text,
  shift_external_id text,
  device_code text,
  guest_count integer,
  customer_id uuid references public.customers (id) on delete set null,
  customer_phone text,
  customer_name text,
  gross_amount numeric(14, 2) not null default 0,
  item_discount_amount numeric(14, 2) not null default 0,
  bill_discount_amount numeric(14, 2) not null default 0,
  extra_discount_amount numeric(14, 2) not null default 0,
  bill_discount_name text,
  voucher_code text,
  voucher_name text,
  voucher_amount numeric(14, 2) not null default 0,
  partner_marketing_amount numeric(14, 2) not null default 0,
  service_charge_amount numeric(14, 2) not null default 0,
  shipping_fee_amount numeric(14, 2) not null default 0,
  vat_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  primary_payment_method_external_id text,
  primary_payment_method_name text,
  status public.invoice_status not null default 'completed',
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (store_id, external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

comment on column public.invoices.business_date is 'calendar day of sold_at in the store timezone, assigned by the sync';
comment on column public.invoices.bill_discount_amount is 'bill-level discount applied as a price reduction';
comment on column public.invoices.extra_discount_amount is 'second bill-level discount the POS reports separately; bill_discount_name is its label';

create index invoices_store_business_date_idx on public.invoices (store_id, business_date);
create index invoices_store_sold_at_idx on public.invoices (store_id, sold_at);
create index invoices_tenant_business_date_idx on public.invoices (tenant_id, business_date);
create index invoices_customer_id_idx on public.invoices (customer_id) where customer_id is not null;
create index invoices_store_shift_idx on public.invoices (store_id, shift_external_id);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  external_id text not null,
  parent_line_external_id text,
  line_kind public.line_kind not null default 'item',
  item_external_id text,
  item_name text not null,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_type_name text,
  item_class_external_id text,
  item_class_name text,
  unit_external_id text,
  unit_name text,
  package_external_id text,
  quantity numeric(12, 3) not null default 1,
  list_unit_price numeric(14, 2),
  unit_price numeric(14, 2) not null default 0,
  gross_amount numeric(14, 2) not null default 0,
  discount_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  promotion_external_id text,
  promotion_name text,
  note text,
  raw jsonb,
  unique (invoice_id, external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.invoice_lines.list_unit_price is 'menu price of the item at sale time; differs from unit_price on a manual price override';
comment on column public.invoice_lines.parent_line_external_id is 'external_id of the item line a modifier line belongs to; null on item lines';

create index invoice_lines_invoice_id_idx on public.invoice_lines (invoice_id);
create index invoice_lines_store_item_idx on public.invoice_lines (store_id, item_external_id);
create index invoice_lines_tenant_line_kind_idx on public.invoice_lines (tenant_id, line_kind);
create index invoice_lines_invoice_package_idx on public.invoice_lines (invoice_id, package_external_id) where package_external_id is not null;

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sequence_no smallint not null default 1,
  business_date date not null,
  payment_method_external_id text,
  payment_method_name text,
  amount numeric(14, 2) not null default 0,
  fee_amount numeric(14, 2) not null default 0,
  reference_no text,
  partner_transaction_id text,
  raw jsonb,
  unique (invoice_id, sequence_no),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.invoice_payments.sequence_no is 'position of the tender in the invoice payment list, assigned by the sync';

create index invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);
create index invoice_payments_store_method_idx on public.invoice_payments (store_id, payment_method_external_id);
create index invoice_payments_store_business_date_idx on public.invoice_payments (store_id, business_date);

create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  invoice_id uuid references public.invoices (id) on delete set null,
  invoice_external_id text not null,
  kind public.invoice_event_kind not null,
  occurred_at timestamptz not null,
  amount numeric(14, 2),
  reason text,
  source text not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, invoice_external_id, kind, occurred_at),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.invoice_events.source is 'how the sync learned of the event, for example resync_diff or pos_report';

create index invoice_events_store_occurred_at_idx on public.invoice_events (store_id, occurred_at);
create index invoice_events_invoice_id_idx on public.invoice_events (invoice_id);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  external_id text not null,
  name text,
  cashier_external_id text,
  cashier_name text,
  opened_at timestamptz not null,
  closed_at timestamptz,
  sales_amount numeric(14, 2) not null default 0,
  orders_count integer not null default 0,
  cash_drawer_amount numeric(14, 2),
  opening_float_amount numeric(14, 2),
  expected_cash_amount numeric(14, 2),
  cash_variance_amount numeric(14, 2) generated always as (cash_drawer_amount - expected_cash_amount) stored,
  changed_after_close boolean not null default false,
  status text,
  device_code text,
  raw jsonb,
  unique (store_id, external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.shifts.expected_cash_amount is 'opening float plus invoice_payments of the shift whose payment method kind is cash, computed by the sync';

create index shifts_store_opened_at_idx on public.shifts (store_id, opened_at);
