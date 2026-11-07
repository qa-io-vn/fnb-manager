create type public.pos_account_status as enum ('active', 'paused', 'error');

create table public.pos_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connector text not null,
  account_key text not null,
  display_name text not null,
  external_company_id text,
  external_brand_id text,
  status public.pos_account_status not null default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, account_key),
  unique (tenant_id, id)
);

create trigger pos_accounts_set_updated_at
before update on public.pos_accounts
for each row execute function app.set_updated_at();

create table public.pos_account_tokens (
  pos_account_id uuid primary key references public.pos_accounts (id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create trigger pos_account_tokens_set_updated_at
before update on public.pos_account_tokens
for each row execute function app.set_updated_at();
