create table public.agg_daily_sales (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  invoices integer not null default 0,
  gross_amount numeric(14, 2) not null default 0,
  item_discount_amount numeric(14, 2) not null default 0,
  bill_discount_amount numeric(14, 2) not null default 0,
  voucher_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  cash_amount numeric(14, 2) not null default 0,
  items_sold numeric(12, 3) not null default 0,
  modifier_lines integer not null default 0,
  voucher_invoices integer not null default 0,
  member_invoices integer not null default 0,
  identified_invoices integer not null default 0,
  voided_invoices integer not null default 0,
  voided_amount numeric(14, 2) not null default 0,
  edited_invoices integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_daily_sales.bill_discount_amount is 'invoices.bill_discount_amount plus invoices.extra_discount_amount';
comment on column public.agg_daily_sales.items_sold is 'sum of quantity over lines of kind item; modifier, service, package and other lines are excluded';
comment on column public.agg_daily_sales.member_invoices is 'non-voided invoices with a customer_phone';
comment on column public.agg_daily_sales.identified_invoices is 'non-voided invoices with a customer_phone or a customer_id';
comment on column public.agg_daily_sales.voided_amount is 'sum of net_amount over invoices with status voided';

create index agg_daily_sales_tenant_business_date_idx on public.agg_daily_sales (tenant_id, business_date);

create table public.agg_hourly_sales (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  hour_local smallint not null check (hour_local between 0 and 23),
  invoices integer not null default 0,
  net_amount numeric(14, 2) not null default 0,
  items_sold numeric(12, 3) not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, hour_local),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index agg_hourly_sales_tenant_business_date_idx on public.agg_hourly_sales (tenant_id, business_date);

create table public.agg_item_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  item_external_id text not null,
  item_name text not null,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_type_name text,
  quantity numeric(12, 3) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  invoices integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, item_external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_item_daily.item_external_id is 'invoice_lines.item_external_id, or the item name when the POS sent no id';

create index agg_item_daily_tenant_business_date_idx on public.agg_item_daily (tenant_id, business_date);
create index agg_item_daily_store_item_idx on public.agg_item_daily (store_id, item_external_id, business_date);

create table public.agg_category_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  item_type_external_id text not null,
  item_type_name text,
  role public.item_type_role not null default 'other',
  quantity numeric(12, 3) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, item_type_external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_category_daily.item_type_external_id is 'invoice_lines.item_type_external_id, or the text uncategorized when the line carries none';

create index agg_category_daily_tenant_business_date_idx on public.agg_category_daily (tenant_id, business_date);

create table public.agg_payment_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  payment_method_external_id text not null,
  payment_method_name text,
  kind public.payment_kind not null default 'other',
  invoices integer not null default 0,
  amount numeric(14, 2) not null default 0,
  fee_amount numeric(14, 2) not null default 0,
  fee_estimate_amount numeric(14, 2) not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, payment_method_external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_payment_daily.payment_method_external_id is 'invoice_payments.payment_method_external_id, or the text unknown when the tender carries none';
comment on column public.agg_payment_daily.fee_estimate_amount is 'amount times the applicable payment_fee_rates row plus its fixed fee; zero when no rate is configured';

create index agg_payment_daily_tenant_business_date_idx on public.agg_payment_daily (tenant_id, business_date);

create table public.agg_shift_cash (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  shift_external_id text not null,
  business_date date not null,
  cashier_name text,
  opened_at timestamptz not null,
  closed_at timestamptz,
  orders integer not null default 0,
  sales_amount numeric(14, 2) not null default 0,
  cash_sales_amount numeric(14, 2) not null default 0,
  opening_float_amount numeric(14, 2),
  expected_cash_amount numeric(14, 2),
  drawer_amount numeric(14, 2),
  variance_amount numeric(14, 2),
  refreshed_at timestamptz not null default now(),
  primary key (store_id, shift_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_shift_cash.business_date is 'business date of opened_at under the store day-start rule';

create index agg_shift_cash_store_business_date_idx on public.agg_shift_cash (store_id, business_date);
create index agg_shift_cash_tenant_business_date_idx on public.agg_shift_cash (tenant_id, business_date);

create table public.agg_size_mix_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  base_name text not null,
  size_label text not null,
  quantity numeric(12, 3) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, base_name, size_label),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index agg_size_mix_daily_tenant_business_date_idx on public.agg_size_mix_daily (tenant_id, business_date);

create table public.agg_modifier_prefs_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  modifier_name text not null,
  count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date, modifier_name),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index agg_modifier_prefs_daily_tenant_business_date_idx on public.agg_modifier_prefs_daily (tenant_id, business_date);

create table public.agg_basket_pairs_28d (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  as_of_date date not null,
  item_a_external_id text not null,
  item_a_name text not null,
  item_b_external_id text not null,
  item_b_name text not null,
  pair_invoices integer not null,
  support_a numeric(8, 6) not null,
  support_b numeric(8, 6) not null,
  lift numeric(10, 4),
  refreshed_at timestamptz not null default now(),
  primary key (store_id, as_of_date, item_a_external_id, item_b_external_id),
  check (item_a_external_id < item_b_external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_basket_pairs_28d.support_a is 'fraction of the window invoices that contain item a; support_b likewise';
comment on column public.agg_basket_pairs_28d.lift is 'pair share divided by support_a times support_b over the 28 days ending as_of_date';

create index agg_basket_pairs_28d_tenant_as_of_idx on public.agg_basket_pairs_28d (tenant_id, as_of_date);

create table public.agg_attach_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  drink_invoices integer not null default 0,
  topping_invoices integer not null default 0,
  snack_invoices integer not null default 0,
  topping_lines integer not null default 0,
  snack_lines integer not null default 0,
  attach_rate_topping numeric(8, 6),
  attach_rate_snack numeric(8, 6),
  refreshed_at timestamptz not null default now(),
  primary key (store_id, business_date),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.agg_attach_daily.attach_rate_topping is 'topping_invoices divided by drink_invoices as a fraction; null when no invoice contained a drink or no item type of the store POS account carries the topping role';
comment on column public.agg_attach_daily.attach_rate_snack is 'snack_invoices divided by drink_invoices as a fraction; null when no invoice contained a drink or no item type of the store POS account carries the snack role';

create index agg_attach_daily_tenant_business_date_idx on public.agg_attach_daily (tenant_id, business_date);

create table public.analytics_refreshes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows bigint
);

create index analytics_refreshes_tenant_started_at_idx on public.analytics_refreshes (tenant_id, started_at desc);

alter table public.agg_daily_sales enable row level security;
alter table public.agg_hourly_sales enable row level security;
alter table public.agg_item_daily enable row level security;
alter table public.agg_category_daily enable row level security;
alter table public.agg_payment_daily enable row level security;
alter table public.agg_shift_cash enable row level security;
alter table public.agg_size_mix_daily enable row level security;
alter table public.agg_modifier_prefs_daily enable row level security;
alter table public.agg_basket_pairs_28d enable row level security;
alter table public.agg_attach_daily enable row level security;
alter table public.analytics_refreshes enable row level security;

create policy agg_daily_sales_select_for_data_store_readers on public.agg_daily_sales
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_hourly_sales_select_for_data_store_readers on public.agg_hourly_sales
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_item_daily_select_for_data_store_readers on public.agg_item_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_category_daily_select_for_data_store_readers on public.agg_category_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_payment_daily_select_for_data_store_readers on public.agg_payment_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_shift_cash_select_for_data_store_readers on public.agg_shift_cash
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_size_mix_daily_select_for_data_store_readers on public.agg_size_mix_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_modifier_prefs_daily_select_for_data_store_readers on public.agg_modifier_prefs_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_basket_pairs_28d_select_for_data_store_readers on public.agg_basket_pairs_28d
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy agg_attach_daily_select_for_data_store_readers on public.agg_attach_daily
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));

create policy analytics_refreshes_select_for_data_members on public.analytics_refreshes
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));
