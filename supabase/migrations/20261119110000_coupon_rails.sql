create type public.coupon_rail as enum ('crm_code_pool', 'crm_callback', 'pos_payment_discount');
create type public.einvoice_display as enum ('discount', 'zero_price_line');
create type public.coupon_code_state as enum ('available', 'assigned', 'used', 'quarantined', 'expired');

alter table public.invoices add constraint invoices_tenant_id_id_key unique (tenant_id, id);

create table public.coupon_rails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  rail public.coupon_rail not null,
  crm_programme_external_ids text[] not null default '{}',
  callback_ip_allowlist cidr[] not null default '{}',
  active_from timestamptz not null default now(),
  active_until timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (active_until is null or active_until >= active_from),
  check (cardinality(crm_programme_external_ids) <= 20),
  check (cardinality(callback_ip_allowlist) <= 20)
);

comment on table public.coupon_rails is 'the loyalty rail of a store: the active row (active_until null) says how rewards reach the till; switching a rail inserts a new row, which closes the previous one and keeps it as history';
comment on column public.coupon_rails.crm_programme_external_ids is 'the POS CRM programmes the rail uses, by external id';
comment on column public.coupon_rails.callback_ip_allowlist is 'optional source networks the voucher callback accepts; empty accepts any';

create unique index coupon_rails_one_active_per_store_key
  on public.coupon_rails (store_id)
  where active_until is null;

create function app.guard_coupon_rail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_external_id text;
begin
  foreach v_external_id in array new.crm_programme_external_ids loop
    if v_external_id is null or char_length(btrim(v_external_id)) not between 1 and 100 then
      raise exception 'each CRM programme external id holds 1 to 100 characters' using errcode = '22023';
    end if;
  end loop;
  if tg_op = 'INSERT' then
    if new.active_until is not null then
      raise exception 'a new coupon rail row is the active one: active_until is set only when a later row replaces it' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.coupon_rails r
      where r.store_id = new.store_id and r.active_until is null and r.active_from > new.active_from
    ) then
      raise exception 'a coupon rail switch starts after the active rail of the store started' using errcode = '22023';
    end if;
    update public.coupon_rails r
    set active_until = new.active_from
    where r.store_id = new.store_id
      and r.active_until is null;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.store_id is distinct from old.store_id
    or new.rail is distinct from old.rail
    or new.active_from is distinct from old.active_from
  then
    raise exception 'switching a store''s rail inserts a new coupon_rails row; the store, rail and start of a row never change' using errcode = '22023';
  end if;
  if old.active_until is not null and new.active_until is distinct from old.active_until then
    raise exception 'a replaced coupon rail row stays history' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger coupon_rails_guard
before insert or update on public.coupon_rails
for each row execute function app.guard_coupon_rail();
create trigger coupon_rails_set_updated_at before update on public.coupon_rails for each row execute function app.set_updated_at();
create trigger coupon_rails_keep_created_by before update on public.coupon_rails for each row execute function app.keep_created_by();
create trigger coupon_rails_set_updated_by before insert or update on public.coupon_rails for each row execute function app.set_updated_by();

create table public.coupon_rail_rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  reward_key text not null check (reward_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  pos_discount_name text check (pos_discount_name is null or char_length(btrim(pos_discount_name)) between 1 and 200),
  pos_free_item_external_id text check (pos_free_item_external_id is null or char_length(btrim(pos_free_item_external_id)) between 1 and 100),
  crm_programme_external_id text check (crm_programme_external_id is null or char_length(btrim(crm_programme_external_id)) between 1 and 100),
  einvoice_display public.einvoice_display not null,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (store_id, reward_key),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  constraint coupon_rail_rewards_pos_side_check check (num_nonnulls(pos_discount_name, pos_free_item_external_id, crm_programme_external_id) >= 1),
  constraint coupon_rail_rewards_zero_price_line_check check (einvoice_display <> 'zero_price_line' or pos_free_item_external_id is not null)
);

comment on table public.coupon_rail_rewards is 'the POS side of a reward at a store: a POS discount by name, a 0-price promotional line by item external id or a CRM programme, and how the cash-register e-invoice shows it; a reward is active at a store only with an active row here';

create trigger coupon_rail_rewards_set_updated_at before update on public.coupon_rail_rewards for each row execute function app.set_updated_at();
create trigger coupon_rail_rewards_keep_created_by before update on public.coupon_rail_rewards for each row execute function app.keep_created_by();
create trigger coupon_rail_rewards_set_updated_by before insert or update on public.coupon_rail_rewards for each row execute function app.set_updated_by();

create table public.coupon_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  reward_key text not null check (reward_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  code text not null check (char_length(code) between 1 and 64 and code !~ '[[:space:][:cntrl:]]'),
  crm_programme_external_id text,
  state public.coupon_code_state not null default 'available',
  imported_at timestamptz not null default now(),
  expires_at timestamptz,
  assigned_at timestamptz,
  used_at timestamptz,
  used_invoice_id uuid,
  quarantined_at timestamptz,
  unique (tenant_id, id),
  unique (store_id, code),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, used_invoice_id) references public.invoices (tenant_id, id),
  check (state <> 'assigned' or assigned_at is not null),
  check (state <> 'used' or used_at is not null),
  check (state <> 'quarantined' or quarantined_at is not null)
);

comment on table public.coupon_codes is 'single-use POS codes of a reward at a store, imported from a CRM export pool: available, assigned to a redemption, used on a synced invoice, quarantined after an unused hold, or expired; read by owners and managers only, written by the service role and the staff functions';

create index coupon_codes_available_idx on public.coupon_codes (store_id, reward_key) where state = 'available';

alter table public.coupon_rails enable row level security;
alter table public.coupon_rail_rewards enable row level security;
alter table public.coupon_codes enable row level security;

create policy coupon_rails_select_for_data_members on public.coupon_rails
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));
create policy coupon_rails_insert_for_unlimited_managers on public.coupon_rails
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy coupon_rails_update_for_unlimited_managers on public.coupon_rails
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));
create policy coupon_rails_delete_for_unlimited_managers on public.coupon_rails
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));

create policy coupon_rail_rewards_select_for_data_members on public.coupon_rail_rewards
  for select to authenticated
  using (store_id = any ((select app.current_user_data_store_ids())::uuid[]));
create policy coupon_rail_rewards_insert_for_unlimited_managers on public.coupon_rail_rewards
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy coupon_rail_rewards_update_for_unlimited_managers on public.coupon_rail_rewards
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));
create policy coupon_rail_rewards_delete_for_unlimited_managers on public.coupon_rail_rewards
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));

create policy coupon_codes_select_for_store_managers on public.coupon_codes
  for select to authenticated
  using (store_id = any ((select app.current_user_loyalty_manager_store_ids())::uuid[]));

revoke all on public.coupon_rails, public.coupon_rail_rewards, public.coupon_codes from anon;
grant select, insert, update, delete on public.coupon_rails, public.coupon_rail_rewards to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.coupon_codes from authenticated;
grant select on public.coupon_codes to authenticated;

create function public.loyalty_rail_flags(p_store_ids uuid[])
returns table (store_id uuid, rail public.coupon_rail, active_from timestamptz, e_invoice_status public.e_invoice_status, flagged boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.store_id, r.rail, r.active_from, s.e_invoice_status, s.e_invoice_status <> 'configured'
  from public.coupon_rails r
  join public.stores s on s.id = r.store_id
  where r.active_until is null
    and r.store_id = any (p_store_ids)
  order by s.name, r.store_id;
$$;

comment on function public.loyalty_rail_flags(uuid[]) is 'the active loyalty rail of each given store the caller reads, with the store''s e-invoice status; flagged when a store with a rail does not issue cash-register e-invoices (status other than configured), for the data-quality page';

revoke all on function app.guard_coupon_rail() from public, anon, authenticated;
revoke all on function public.loyalty_rail_flags(uuid[]) from public, anon;
grant execute on function public.loyalty_rail_flags(uuid[]) to authenticated, service_role;
