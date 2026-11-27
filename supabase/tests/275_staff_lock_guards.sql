-- The roster's lock paths (M02, counter-app.md section 6): nobody locks their own roster entry or changes their own
-- role or stores, and the tenant's last owner is never locked through the roster.
-- Techniques: decision table of deactivate_staff (actor owner, manager, staff x target self, the last owner, an owner
-- with another owner, a manager, staff), equivalence partitions of update_staff on one's own entry (the name only,
-- the role, the stores), state transition of a refused lock (the entry stays active, the membership and the sessions
-- stay), error guessing (the same stores in another order is no change; null stores against a list).
begin;
select plan(24);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000027501'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000027501'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000027501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000027502'::uuid as store_a2,
  'eeeeeeee-eeee-4eee-8eee-000000027501'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000027502'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000027503'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000027504'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000027505'::uuid as owner2_u;
grant select on fx to authenticated;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'lock-guard-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_u), (fx.manager_u), (fx.manager_a1_u), (fx.staff_u), (fx.owner2_u)) as u (id);
insert into public.tenants (id, slug, name) select tenant_a, 'lock-guard-275', 'Lock guard 275' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'lock-guard-275', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'lg-275-a1', 'Synthetic store A1' from fx union all
select store_a2, tenant_a, account_a, 'lg-275-a2', 'Synthetic store A2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null::uuid[]), (fx.manager_a1_u, 'manager', array[fx.store_a1]),
  (fx.staff_u, 'staff', array[fx.store_a1])
) as m (user_id, role, store_ids);
-- Roster entries of the two managers and the staff member, and one of the owner (a person may be on the roster with
-- their login while their membership is the owner's).
create temp table r (label text primary key, id uuid not null);
grant select on r to authenticated;
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select fx.tenant_a, v.name, v.role::public.tenant_role, v.stores, 'active', v.u, now() - interval '1 day'
from fx cross join lateral (values
  ('Quản lý', 'manager', null::uuid[], fx.manager_u),
  ('Quản lý A1', 'manager', array[fx.store_a1], fx.manager_a1_u),
  ('Nhân viên', 'staff', array[fx.store_a1], fx.staff_u),
  ('Chủ quán', 'manager', null::uuid[], fx.owner_u)
) as v (name, role, stores, u);
insert into r select case r2.display_name when 'Quản lý' then 'manager' when 'Quản lý A1' then 'manager_a1' when 'Nhân viên' then 'staff' else 'owner' end, r2.id
from public.staff_roster r2 where r2.tenant_id = (select tenant_a from fx);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), u, now(), now() from fx cross join lateral (values (fx.manager_u), (fx.manager_a1_u)) as v (u);

create function pg_temp.rid(p_label text) returns uuid language sql stable as $$ select id from r where label = p_label $$;
-- The outcome of a statement run as a member through the API role: ok, or the SQLSTATE and the hint.
create function pg_temp.as_member(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text := 'ok';
  v_hint text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v := sqlstate || coalesce(':' || nullif(v_hint, ''), '');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.lock(p_user uuid, p_label text) returns text language sql as $$
  select pg_temp.as_member(p_user, format('select public.deactivate_staff(%L)', pg_temp.rid(p_label)));
$$;
create function pg_temp.edit(p_user uuid, p_label text, p_name text, p_role text, p_stores uuid[]) returns text language sql as $$
  select pg_temp.as_member(p_user, format('select public.update_staff(%L, %L, %L, %L)', pg_temp.rid(p_label), p_name, p_role, p_stores));
$$;
create function pg_temp.state(p_label text) returns text language sql stable as $$
  select r2.status || '/' || r2.role::text || '/' || coalesce(array_to_string(r2.store_ids, ','), 'all') || '/'
    || coalesce((select m.role::text from public.tenant_members m where m.tenant_id = r2.tenant_id and m.user_id = r2.user_id), 'none')
  from public.staff_roster r2 where r2.id = pg_temp.rid(p_label);
$$;

-- 1. Locking oneself (decision table: actor = target) --------------------------------------------------------------
select is(pg_temp.lock((select manager_u from fx), 'manager'), '42501:own_entry', 'a manager of every store cannot lock their own entry');
select is(pg_temp.lock((select manager_a1_u from fx), 'manager_a1'), '42501:own_entry', 'nor can a manager of one store');
select is(pg_temp.lock((select staff_u from fx), 'staff'), '42501', 'staff cannot lock anyone, themselves included (the scope check comes first)');
select is(pg_temp.state('manager'), 'active/manager/all/manager', 'the refused lock left the entry and the membership as they were');
select is((select count(*)::int from auth.sessions s where s.user_id = (select manager_u from fx)), 1, 'and the sessions');

-- 2. The last owner ----------------------------------------------------------------------------------------------
select is(pg_temp.lock((select manager_u from fx), 'owner'), '42501:last_owner', 'the entry of the tenant''s only owner is never locked');
select is(pg_temp.lock((select owner_u from fx), 'owner'), '42501:own_entry', 'not by the owner themselves either');
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_a, owner2_u, 'owner', null from fx;
select is(pg_temp.lock((select manager_u from fx), 'owner'), 'ok', 'with a second owner the entry may be locked');
select is(pg_temp.state('owner'), 'inactive/manager/all/owner', 'which leaves the owner membership: the roster removes only staff and manager memberships');

-- 3. Locking another person still works ----------------------------------------------------------------------------
select is(pg_temp.lock((select manager_u from fx), 'manager_a1'), 'ok', 'a manager of every store locks a manager of one store');
select is(pg_temp.state('manager_a1'), 'inactive/manager/' || (select store_a1 from fx)::text || '/none', 'whose membership is removed');
select is((select count(*)::int from auth.sessions s where s.user_id = (select manager_a1_u from fx)), 0, 'and whose sessions are revoked');
select is(pg_temp.lock((select manager_u from fx), 'manager_a1'), 'ok', 'locking again is a replay');

-- 4. Changing one's own entry (equivalence partitions) ------------------------------------------------------------
select is(pg_temp.edit((select manager_u from fx), 'manager', 'Quản lý Mới', 'manager', null), 'ok', 'one''s own name may change');
select is((select display_name from public.staff_roster where id = pg_temp.rid('manager')), 'Quản lý Mới', 'and did');
select is(pg_temp.edit((select manager_u from fx), 'manager', 'Quản lý Mới', 'staff', null), '42501:own_entry', 'one''s own role never changes (a manager demoting themselves)');
select is(pg_temp.edit((select manager_u from fx), 'manager', 'Quản lý Mới', 'manager', array[(select store_a1 from fx)]), '42501:own_entry', 'nor one''s own stores (null to a list)');
select is(pg_temp.state('manager'), 'active/manager/all/manager', 'the entry and the membership are unchanged');

-- 5. Changing another person's entry still works; the same stores in another order are no change ---------------------
update public.staff_roster set store_ids = array[(select store_a2 from fx), (select store_a1 from fx)] where id = pg_temp.rid('staff');
update public.tenant_members set store_ids = array[(select store_a2 from fx), (select store_a1 from fx)] where user_id = (select staff_u from fx);
select is(pg_temp.edit((select manager_u from fx), 'staff', 'Nhân viên', 'manager', array[(select store_a1 from fx)]), 'ok', 'a manager promotes and narrows another person');
select is(pg_temp.state('staff'), 'active/manager/' || (select store_a1 from fx)::text || '/manager', 'the entry and the membership follow');
update public.tenant_members set store_ids = array[(select store_a1 from fx), (select store_a2 from fx)] where user_id = (select owner2_u from fx);
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_a, 'Chủ 2', 'manager', array[store_a1, store_a2], 'active', owner2_u, now() from fx;
insert into r select 'owner2', id from public.staff_roster where user_id = (select owner2_u from fx);
select is(pg_temp.edit((select owner2_u from fx), 'owner2', 'Chủ Hai', 'manager', array[(select store_a2 from fx), (select store_a1 from fx)]), 'ok',
  'the same stores in another order are no change of one''s own entry: only the name changes');
select is(pg_temp.edit((select owner2_u from fx), 'owner2', 'Chủ Hai', 'staff', array[(select store_a1 from fx), (select store_a2 from fx)]), '42501:own_entry', 'but the role is');

-- 6. The guard is internal --------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app.roster_lock_guard(public.staff_roster)', 'execute')
  and not has_function_privilege('anon', 'app.roster_lock_guard(public.staff_roster)', 'execute'), 'the guard is not callable by an API role');
select ok(has_function_privilege('authenticated', 'public.deactivate_staff(uuid)', 'execute') and not has_function_privilege('anon', 'public.deactivate_staff(uuid)', 'execute'),
  'deactivate_staff keeps its grants');

select * from finish();
rollback;
