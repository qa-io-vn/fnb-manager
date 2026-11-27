-- The roster's lock paths refuse what a screen must never be able to do (M02, counter-app.md section 6): nobody locks
-- their own roster entry or changes their own role or stores (a manager would shut themselves out), and the last owner
-- of a tenant is never locked through the roster. The refusals are 42501 with a hint naming the rule (own_entry,
-- last_owner), so an app can say why; the existing checks of scope and role run first and are unchanged.

create function app.roster_lock_guard(p_row public.staff_roster)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_row.user_id is not null and p_row.user_id = (select auth.uid()) then
    raise exception 'nobody locks or changes their own roster entry' using errcode = '42501', hint = 'own_entry';
  end if;
  if p_row.user_id is not null
     and exists (
       select 1 from public.tenant_members m
       where m.tenant_id = p_row.tenant_id and m.user_id = p_row.user_id and m.role = 'owner'
     )
     and not exists (
       select 1 from public.tenant_members m
       where m.tenant_id = p_row.tenant_id and m.user_id <> p_row.user_id and m.role = 'owner'
     ) then
    raise exception 'the last owner of a tenant is never locked' using errcode = '42501', hint = 'last_owner';
  end if;
end;
$$;

comment on function app.roster_lock_guard(public.staff_roster) is 'refuses a lock of a roster entry that belongs to the caller (42501, hint own_entry) or to the tenant''s only owner (42501, hint last_owner); called by deactivate_staff and by update_staff when the role or the stores change';

create or replace function app.deactivate_staff(p_roster_id uuid)
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
  perform app.roster_lock_guard(v_row);
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

comment on function app.deactivate_staff(uuid) is 'deactivates a roster row whose stores are all in the caller''s scope: status inactive, the phone dropped, the staff or manager membership removed (its destinations and binding codes go by the foreign keys and its notification rows are redacted by trigger), its Zalo identities in the tenant deleted and every Auth session of the login revoked; a second call changes nothing; never one''s own entry (42501 own_entry) nor the tenant''s last owner (42501 last_owner)';

create or replace function app.update_staff(p_roster_id uuid, p_display_name text, p_role public.tenant_role, p_store_ids uuid[])
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
  if p_role is distinct from v_row.role
     or coalesce((select array_agg(s order by s) from unnest(p_store_ids) s), '{}'::uuid[])
        is distinct from coalesce((select array_agg(s order by s) from unnest(v_row.store_ids) s), '{}'::uuid[])
     or (p_store_ids is null) <> (v_row.store_ids is null) then
    perform app.roster_lock_guard(v_row);
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

comment on function app.update_staff(uuid, text, public.tenant_role, uuid[]) is 'replaces the name, role and stores of a roster row whose stores are all in the caller''s scope, with stores in that scope; an active row''s membership takes the new role and stores at once; the role and the stores of one''s own entry (42501 own_entry) and of the tenant''s last owner (42501 last_owner) never change, a name may';

revoke all on function app.roster_lock_guard(public.staff_roster) from public, anon, authenticated, service_role;
