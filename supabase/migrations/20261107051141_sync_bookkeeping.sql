create type public.sync_kind as enum ('incremental', 'nightly', 'backfill', 'master_data', 'reconciliation');
create type public.sync_status as enum ('running', 'succeeded', 'failed');

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  kind public.sync_kind not null,
  range_start date,
  range_end date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.sync_status not null default 'running',
  rows_upserted jsonb not null default '{}'::jsonb,
  error_message text,
  triggered_by text,
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index sync_runs_pos_account_started_at_idx on public.sync_runs (pos_account_id, started_at desc);
create index sync_runs_tenant_id_idx on public.sync_runs (tenant_id);

create table public.sync_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  source_invoice_count integer not null default 0,
  source_net_amount numeric(14, 2) not null default 0,
  local_invoice_count integer not null default 0,
  local_net_amount numeric(14, 2) not null default 0,
  is_matched boolean not null default false,
  checked_at timestamptz not null default now(),
  unique (store_id, business_date),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index sync_checks_tenant_id_idx on public.sync_checks (tenant_id);
