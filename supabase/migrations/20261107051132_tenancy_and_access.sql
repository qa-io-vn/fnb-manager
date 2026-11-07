create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

alter default privileges for role postgres in schema app revoke execute on functions from public;

create type public.tenant_role as enum ('owner', 'manager', 'staff', 'viewer', 'publisher');
create type public.legal_form as enum ('household_business', 'micro_enterprise', 'small_enterprise', 'enterprise', 'unknown');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country_code text not null default 'VN',
  currency_code text not null default 'VND',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  legal_form public.legal_form not null default 'unknown',
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.tenant_role not null,
  store_ids uuid[],
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

comment on column public.tenant_members.store_ids is 'null grants access to every store of the tenant';

create index tenant_members_user_id_idx on public.tenant_members (user_id);

create or replace function app.current_user_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(tenant_id), '{}'::uuid[])
  from public.tenant_members
  where user_id = (select auth.uid());
$$;

create or replace function app.data_roles()
returns public.tenant_role[]
language sql
immutable
as $$
  select array['owner', 'manager', 'staff', 'viewer']::public.tenant_role[];
$$;

create or replace function app.current_user_data_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(tenant_id), '{}'::uuid[])
  from public.tenant_members
  where user_id = (select auth.uid())
    and role = any (app.data_roles());
$$;

create or replace function app.has_tenant_role(tenant_id uuid, roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = has_tenant_role.tenant_id
      and m.user_id = (select auth.uid())
      and m.role = any (has_tenant_role.roles)
  );
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.current_user_tenant_ids() from public;
revoke all on function app.data_roles() from public;
revoke all on function app.current_user_data_tenant_ids() from public;
revoke all on function app.has_tenant_role(uuid, public.tenant_role[]) from public;
revoke all on function app.set_updated_at() from public;

grant execute on function app.current_user_tenant_ids() to authenticated;
grant execute on function app.data_roles() to authenticated;
grant execute on function app.current_user_data_tenant_ids() to authenticated;
grant execute on function app.has_tenant_role(uuid, public.tenant_role[]) to authenticated;
