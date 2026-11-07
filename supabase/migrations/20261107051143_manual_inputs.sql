create type public.period_kind as enum ('month', 'week');
create type public.strategy_source as enum ('skill', 'routine', 'pasted');
create type public.item_type_role as enum ('drink', 'topping', 'food', 'snack', 'other');
create type public.holiday_kind as enum ('public', 'tet', 'custom');

create or replace function app.keep_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

revoke all on function app.keep_created_by() from public;

create table public.item_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  item_external_id text not null,
  cost_amount numeric(14, 2) not null,
  effective_from date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.item_costs.store_id is 'null applies the cost to every store of the tenant';

create unique index item_costs_scope_item_effective_key
  on public.item_costs (tenant_id, store_id, item_external_id, effective_from) nulls not distinct;
create index item_costs_tenant_item_idx on public.item_costs (tenant_id, item_external_id, effective_from desc);

create trigger item_costs_set_updated_at
before update on public.item_costs
for each row execute function app.set_updated_at();

create trigger item_costs_keep_created_by
before update on public.item_costs
for each row execute function app.keep_created_by();

create table public.payment_fee_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  payment_method_external_id text not null,
  fee_pct numeric(6, 3) not null default 0,
  fixed_fee_amount numeric(14, 2) not null default 0,
  effective_from date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.payment_fee_rates.store_id is 'null applies the rate to every store of the tenant';
comment on column public.payment_fee_rates.fee_pct is 'percentage of the paid amount, 1.100 means 1.1 percent';

create unique index payment_fee_rates_scope_method_effective_key
  on public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, effective_from) nulls not distinct;
create index payment_fee_rates_tenant_method_idx on public.payment_fee_rates (tenant_id, payment_method_external_id, effective_from desc);

create trigger payment_fee_rates_set_updated_at
before update on public.payment_fee_rates
for each row execute function app.set_updated_at();

create trigger payment_fee_rates_keep_created_by
before update on public.payment_fee_rates
for each row execute function app.keep_created_by();

create table public.item_type_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  item_type_external_id text not null,
  role public.item_type_role not null default 'other',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pos_account_id, item_type_external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index item_type_roles_tenant_id_idx on public.item_type_roles (tenant_id);

create trigger item_type_roles_set_updated_at
before update on public.item_type_roles
for each row execute function app.set_updated_at();

create trigger item_type_roles_keep_created_by
before update on public.item_type_roles
for each row execute function app.keep_created_by();

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  country_code text not null,
  holiday_date date not null,
  name text not null,
  kind public.holiday_kind not null,
  created_at timestamptz not null default now()
);

comment on column public.holidays.tenant_id is 'null applies the holiday to every tenant of the country';

create unique index holidays_tenant_country_date_name_key
  on public.holidays (tenant_id, country_code, holiday_date, name) nulls not distinct;
create index holidays_country_date_idx on public.holidays (country_code, holiday_date);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  period_kind public.period_kind not null,
  period_start date not null,
  net_target_amount numeric(14, 2) not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, period_kind, period_start),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index targets_tenant_id_idx on public.targets (tenant_id);

create trigger targets_set_updated_at
before update on public.targets
for each row execute function app.set_updated_at();

create trigger targets_keep_created_by
before update on public.targets
for each row execute function app.keep_created_by();

create table public.strategy_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  horizon text not null,
  language text not null default 'vi',
  generated_via public.strategy_source not null,
  title text not null,
  content_markdown text not null,
  data_pack jsonb,
  kpis jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on column public.strategy_reports.store_id is 'null means the report covers every store of the tenant';

create index strategy_reports_tenant_created_at_idx on public.strategy_reports (tenant_id, created_at desc);
create index strategy_reports_store_id_idx on public.strategy_reports (store_id) where store_id is not null;

create trigger strategy_reports_set_updated_at
before update on public.strategy_reports
for each row execute function app.set_updated_at();

create trigger strategy_reports_keep_created_by
before update on public.strategy_reports
for each row execute function app.keep_created_by();
