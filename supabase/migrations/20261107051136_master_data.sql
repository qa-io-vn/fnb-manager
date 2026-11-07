create type public.payment_kind as enum ('cash', 'card', 'bank_transfer', 'ewallet', 'voucher', 'other');
create type public.e_invoice_status as enum ('unknown', 'not_configured', 'configured', 'disabled');
create type public.tran_no_reset_period as enum ('daily', 'yearly', 'never', 'unknown');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  code text,
  name text not null,
  address text,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  business_day_start_minutes integer not null default 0 check (business_day_start_minutes >= 0 and business_day_start_minutes < 1440),
  opening_hours jsonb,
  seat_count integer check (seat_count >= 0),
  opened_on date,
  e_invoice_status public.e_invoice_status not null default 'unknown',
  tran_no_reset_period public.tran_no_reset_period not null default 'unknown',
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

comment on column public.stores.business_day_start_minutes is 'minutes after local midnight at which the business day begins; a sale before this time belongs to the previous business_date';
comment on column public.stores.opening_hours is 'weekday keys mon..sun, each a list of [open, close] local HH24:MI pairs, for example {"mon": [["07:00", "22:30"]]}';
comment on column public.stores.tran_no_reset_period is 'how often the POS restarts its receipt numbering; receipt claims are keyed on store, business date and receipt_no because of it';

create or replace function app.current_user_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  where m.user_id = (select auth.uid())
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

create or replace function app.current_user_data_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  where m.user_id = (select auth.uid())
    and m.role = any (app.data_roles())
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

create or replace function app.can_read_store(store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.tenant_members m on m.tenant_id = s.tenant_id
    where s.id = can_read_store.store_id
      and m.user_id = (select auth.uid())
      and (m.store_ids is null or can_read_store.store_id = any (m.store_ids))
  );
$$;

create or replace function app.has_store_scope(tenant_id uuid, store_id uuid, roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = has_store_scope.tenant_id
      and m.user_id = (select auth.uid())
      and m.role = any (has_store_scope.roles)
      and case
        when has_store_scope.store_id is null then m.store_ids is null
        else
          exists (
            select 1
            from public.stores s
            where s.id = has_store_scope.store_id
              and s.tenant_id = m.tenant_id
          )
          and (m.store_ids is null or has_store_scope.store_id = any (m.store_ids))
      end
  );
$$;

create or replace function app.can_manage_store_scope(tenant_id uuid, store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_scope(can_manage_store_scope.tenant_id, can_manage_store_scope.store_id, array['owner', 'manager']::public.tenant_role[]);
$$;

create or replace function app.can_publish_store_scope(tenant_id uuid, store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_scope(can_publish_store_scope.tenant_id, can_publish_store_scope.store_id, array['owner', 'manager', 'publisher']::public.tenant_role[]);
$$;

revoke all on function app.current_user_store_ids() from public;
revoke all on function app.current_user_data_store_ids() from public;
revoke all on function app.can_read_store(uuid) from public;
revoke all on function app.has_store_scope(uuid, uuid, public.tenant_role[]) from public;
revoke all on function app.can_manage_store_scope(uuid, uuid) from public;
revoke all on function app.can_publish_store_scope(uuid, uuid) from public;
grant execute on function app.current_user_store_ids() to authenticated;
grant execute on function app.current_user_data_store_ids() to authenticated;
grant execute on function app.can_read_store(uuid) to authenticated;
grant execute on function app.has_store_scope(uuid, uuid, public.tenant_role[]) to authenticated;
grant execute on function app.can_manage_store_scope(uuid, uuid) to authenticated;
grant execute on function app.can_publish_store_scope(uuid, uuid) to authenticated;

create table public.item_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index item_types_tenant_id_idx on public.item_types (tenant_id);

create table public.item_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index item_classes_tenant_id_idx on public.item_classes (tenant_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index units_tenant_id_idx on public.units (tenant_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_class_external_id text,
  unit_external_id text,
  unit_name text,
  list_price numeric(14, 2),
  takeaway_price numeric(14, 2),
  cost_price numeric(14, 2),
  is_modifier boolean not null default false,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index items_tenant_id_idx on public.items (tenant_id);
create index items_pos_account_item_type_idx on public.items (pos_account_id, item_type_external_id);

create table public.store_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  item_external_id text not null,
  list_price numeric(14, 2),
  takeaway_price numeric(14, 2),
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (store_id, item_external_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index store_items_tenant_item_idx on public.store_items (tenant_id, item_external_id);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  list_price numeric(14, 2),
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index packages_tenant_id_idx on public.packages (tenant_id);

create table public.customizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index customizations_tenant_id_idx on public.customizations (tenant_id);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index sources_tenant_id_idx on public.sources (tenant_id);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  kind public.payment_kind not null default 'other',
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index payment_methods_tenant_id_idx on public.payment_methods (tenant_id);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index promotions_tenant_id_idx on public.promotions (tenant_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  code text,
  name text,
  store_external_id text,
  store_id uuid,
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete set null
);

create index devices_tenant_id_idx on public.devices (tenant_id);
create index devices_pos_account_code_idx on public.devices (pos_account_id, code);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  external_id text,
  phone text,
  name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index customers_tenant_phone_key on public.customers (tenant_id, phone) where phone is not null;
create index customers_tenant_id_idx on public.customers (tenant_id);
