create table public.staff_roster (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100 and display_name = btrim(display_name) and display_name !~ '[[:cntrl:]]'),
  role public.tenant_role not null check (role in ('staff', 'manager')),
  store_ids uuid[] check (store_ids is null or (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null)),
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  user_id uuid references auth.users (id) on delete set null,
  paired_at timestamptz,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_hint text generated always as (case when phone is null then null else '…' || right(phone, 3) end) stored,
  phone_linked_at timestamptz,
  deactivated_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  check (status <> 'active' or paired_at is not null),
  check ((status = 'inactive') = (deactivated_at is not null)),
  check ((phone is null) = (phone_linked_at is null)),
  check (phone is null or status = 'active')
);

create index staff_roster_user_id_idx on public.staff_roster (user_id) where user_id is not null;

comment on table public.staff_roster is 'the staff roster of a tenant (FR-STF-09): one row per person whatever the brand, with a role (staff or manager), a store scope and a status; written only through app.add_staff, app.update_staff, app.deactivate_staff and app.reactivate_staff, and by the pairing of phase 14a';
comment on column public.staff_roster.role is 'staff or manager; the role the person''s membership gets when paired';
comment on column public.staff_roster.store_ids is 'the stores of the tenant the person works in, checked by app.validate_zalo_store_ids; null for every store, which only a member with an unlimited scope may grant';
comment on column public.staff_roster.status is 'invited (on the roster, not paired), active (paired, with a tenant_members row of the roster role and stores) or inactive (deactivated, no membership)';
comment on column public.staff_roster.user_id is 'the Auth user bound at the first pairing, kept after a deactivation so a later pairing reuses it; the person''s Zalo identities, one per Zalo App, are the zalo_identities rows of this user';
comment on column public.staff_roster.paired_at is 'when the person last paired a Zalo account';
comment on column public.staff_roster.phone is 'the phone number in international form, only after the person linked it themselves; no API role may select it';
comment on column public.staff_roster.phone_hint is 'what the screens show instead of the phone number, for example …678';
comment on column public.staff_roster.deactivated_at is 'when the row was deactivated; set exactly while the status is inactive';

create trigger staff_roster_set_updated_at before update on public.staff_roster for each row execute function app.set_updated_at();
create trigger staff_roster_keep_created_by before update on public.staff_roster for each row execute function app.keep_created_by();
create trigger staff_roster_set_updated_by before insert or update on public.staff_roster for each row execute function app.set_updated_by();
create trigger staff_roster_validate_store_ids before insert or update of tenant_id, store_ids on public.staff_roster for each row execute function app.validate_zalo_store_ids();

comment on function app.validate_zalo_store_ids() is 'trigger on brands, gmf_groups and staff_roster: refuses a store listed twice (22023) and a store that is not a store of the row''s tenant (23503), the array form of the tenant-consistent foreign key';

create function app.can_manage_staff(tenant_id uuid, store_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = can_manage_staff.tenant_id
      and m.user_id = (select auth.uid())
      and m.role = any (array['owner', 'manager']::public.tenant_role[])
      and (m.store_ids is null or can_manage_staff.store_ids <@ m.store_ids)
  );
$$;

comment on function app.can_manage_staff(uuid, uuid[]) is 'whether the caller is an owner or manager of the tenant whose scope holds every given store; a null store list (every store) needs an unlimited scope';

create function app.add_staff(p_tenant_id uuid, p_display_name text, p_role public.tenant_role, p_store_ids uuid[])
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_display_name);
  v_id uuid;
begin
  if not app.has_tenant_role(p_tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only an owner or a manager of the tenant may add staff' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('staff', 'manager') then
    raise exception 'a roster role is staff or manager' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'a display name has 1 to 100 characters' using errcode = '22023';
  end if;
  if not app.can_manage_staff(p_tenant_id, p_store_ids) then
    raise exception 'the stores are outside the member''s scope' using errcode = '42501';
  end if;
  insert into public.staff_roster (tenant_id, display_name, role, store_ids, created_by)
  values (p_tenant_id, v_name, p_role, p_store_ids, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.add_staff(uuid, text, public.tenant_role, uuid[]) is 'adds an invited roster row as the caller: an owner or manager of the tenant, with a role of staff or manager and stores within the caller''s scope';

create function app.update_staff(p_roster_id uuid, p_display_name text, p_role public.tenant_role, p_store_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.staff_roster;
  v_name text := btrim(p_display_name);
begin
  select r.* into v_row
  from public.staff_roster r
  where r.id = p_roster_id
  for update;
  if not found or not app.can_manage_staff(v_row.tenant_id, v_row.store_ids) then
    raise exception 'the roster entry cannot be changed by this member' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('staff', 'manager') then
    raise exception 'a roster role is staff or manager' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'a display name has 1 to 100 characters' using errcode = '22023';
  end if;
  if not app.can_manage_staff(v_row.tenant_id, p_store_ids) then
    raise exception 'the stores are outside the member''s scope' using errcode = '42501';
  end if;
  update public.staff_roster r
  set display_name = v_name, role = p_role, store_ids = p_store_ids
  where r.id = v_row.id;
  if v_row.status = 'active' and v_row.user_id is not null then
    update public.tenant_members m
    set role = p_role, store_ids = p_store_ids
    where m.tenant_id = v_row.tenant_id
      and m.user_id = v_row.user_id
      and m.role = any (array['staff', 'manager']::public.tenant_role[]);
  end if;
end;
$$;

comment on function app.update_staff(uuid, text, public.tenant_role, uuid[]) is 'replaces the name, role and stores of a roster row whose stores are all in the caller''s scope, with stores in that scope; an active row''s membership takes the new role and stores at once';

create function app.deactivate_staff(p_roster_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.staff_roster;
begin
  select r.* into v_row
  from public.staff_roster r
  where r.id = p_roster_id
  for update;
  if not found or not app.can_manage_staff(v_row.tenant_id, v_row.store_ids) then
    raise exception 'the roster entry cannot be changed by this member' using errcode = '42501';
  end if;
  if v_row.status = 'inactive' then
    return;
  end if;
  update public.staff_roster r
  set status = 'inactive', deactivated_at = now(), phone = null, phone_linked_at = null
  where r.id = v_row.id;
  if v_row.user_id is not null then
    delete from public.tenant_members m
    where m.tenant_id = v_row.tenant_id
      and m.user_id = v_row.user_id
      and m.role = any (array['staff', 'manager']::public.tenant_role[]);
    if found then
      delete from public.zalo_identities i
      where i.tenant_id = v_row.tenant_id
        and i.user_id = v_row.user_id;
      delete from auth.sessions s where s.user_id = v_row.user_id;
    end if;
  end if;
end;
$$;

comment on function app.deactivate_staff(uuid) is 'deactivates a roster row whose stores are all in the caller''s scope: status inactive, the phone dropped, the staff or manager membership removed (its destinations and binding codes go by the foreign keys and its notification rows are redacted by trigger), its Zalo identities in the tenant deleted and every Auth session of the login revoked; a second call changes nothing';

create function app.reactivate_staff(p_roster_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.staff_roster;
begin
  select r.* into v_row
  from public.staff_roster r
  where r.id = p_roster_id
  for update;
  if not found or not app.can_manage_staff(v_row.tenant_id, v_row.store_ids) then
    raise exception 'the roster entry cannot be changed by this member' using errcode = '42501';
  end if;
  if v_row.status <> 'inactive' then
    return;
  end if;
  update public.staff_roster r
  set status = 'invited', deactivated_at = null, paired_at = null
  where r.id = v_row.id;
end;
$$;

comment on function app.reactivate_staff(uuid) is 'puts an inactive roster row whose stores are all in the caller''s scope back to invited: the person regains access only by pairing again; a row that is not inactive is left as it is';

create function app.deactivate_removed_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    update public.staff_roster r
    set status = 'inactive', deactivated_at = now(), phone = null, phone_linked_at = null
    where r.tenant_id = old.tenant_id
      and r.user_id = old.user_id
      and r.status = 'active';
  end if;
  return old;
end;
$$;

comment on function app.deactivate_removed_staff() is 'trigger after a member is removed from tenant_members by any path: an active roster row of that login becomes inactive, so the roster never shows access the person no longer has; nothing to do when the whole tenant is being deleted';

create trigger tenant_members_deactivate_staff
after delete on public.tenant_members
for each row execute function app.deactivate_removed_staff();

create function public.add_staff(p_tenant_id uuid, p_display_name text, p_role public.tenant_role, p_store_ids uuid[])
returns uuid
language sql
volatile
set search_path = ''
as $$
  select app.add_staff(p_tenant_id, p_display_name, p_role, p_store_ids);
$$;

comment on function public.add_staff(uuid, text, public.tenant_role, uuid[]) is 'RPC: app.add_staff';

create function public.update_staff(p_roster_id uuid, p_display_name text, p_role public.tenant_role, p_store_ids uuid[])
returns void
language sql
volatile
set search_path = ''
as $$
  select app.update_staff(p_roster_id, p_display_name, p_role, p_store_ids);
$$;

comment on function public.update_staff(uuid, text, public.tenant_role, uuid[]) is 'RPC: app.update_staff';

create function public.deactivate_staff(p_roster_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select app.deactivate_staff(p_roster_id);
$$;

comment on function public.deactivate_staff(uuid) is 'RPC: app.deactivate_staff';

create function public.reactivate_staff(p_roster_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select app.reactivate_staff(p_roster_id);
$$;

comment on function public.reactivate_staff(uuid) is 'RPC: app.reactivate_staff';

alter table public.staff_roster enable row level security;

create policy staff_roster_select_for_managers_or_self on public.staff_roster
  for select to authenticated
  using (
    app.can_manage_staff(tenant_id, store_ids)
    or (user_id = (select auth.uid()) and tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]))
  );

revoke all on public.staff_roster from anon, authenticated;
grant select (id, tenant_id, display_name, role, store_ids, status, user_id, paired_at, phone_hint, phone_linked_at, deactivated_at,
  created_by, created_at, updated_by, updated_at)
  on public.staff_roster to authenticated;

revoke all on function app.can_manage_staff(uuid, uuid[]) from public, anon;
revoke all on function app.add_staff(uuid, text, public.tenant_role, uuid[]) from public, anon, service_role;
revoke all on function app.update_staff(uuid, text, public.tenant_role, uuid[]) from public, anon, service_role;
revoke all on function app.deactivate_staff(uuid) from public, anon, service_role;
revoke all on function app.reactivate_staff(uuid) from public, anon, service_role;
revoke all on function app.deactivate_removed_staff() from public, anon, authenticated, service_role;
revoke all on function public.add_staff(uuid, text, public.tenant_role, uuid[]) from public, anon, service_role;
revoke all on function public.update_staff(uuid, text, public.tenant_role, uuid[]) from public, anon, service_role;
revoke all on function public.deactivate_staff(uuid) from public, anon, service_role;
revoke all on function public.reactivate_staff(uuid) from public, anon, service_role;

grant execute on function app.can_manage_staff(uuid, uuid[]) to authenticated;
grant execute on function app.add_staff(uuid, text, public.tenant_role, uuid[]) to authenticated;
grant execute on function app.update_staff(uuid, text, public.tenant_role, uuid[]) to authenticated;
grant execute on function app.deactivate_staff(uuid) to authenticated;
grant execute on function app.reactivate_staff(uuid) to authenticated;
grant execute on function public.add_staff(uuid, text, public.tenant_role, uuid[]) to authenticated;
grant execute on function public.update_staff(uuid, text, public.tenant_role, uuid[]) to authenticated;
grant execute on function public.deactivate_staff(uuid) to authenticated;
grant execute on function public.reactivate_staff(uuid) to authenticated;
