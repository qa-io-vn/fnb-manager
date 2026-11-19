-- G-08. ISTQB technique: decision table. Conditions: the phone of the membership (on the owner's list, on an active roster row,
-- on a deactivated roster row, neither) x the actor (staff below the threshold, staff above it, a manager deciding). Expected: the
-- first two phone rows are refused with staff_phone whatever the actor and nothing is written; the last two get the usual outcome.
begin;
select plan(18);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000015001'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000015001'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000015001'::uuid as store_t,
  'eeeeeeee-eeee-4eee-8eee-000000015001'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000015002'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000015003'::uuid as roster_staff,
  'eeeeeeee-eeee-4eee-8eee-000000015004'::uuid as former_staff,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'staff-phone-adj-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.staff_a, fx.manager_a, fx.roster_staff, fx.former_staff]) as u (id);
insert into public.tenants (id, slug, name) select tenant_t, 'staff-phone-adjust-pgtap', 'Staff phone adjust pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_t, tenant_t, 'mock', 'staff-phone-adjust', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_t, tenant_t, account_t, 'spa-1', 'Synthetic store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, staff_a, 'staff'::public.tenant_role, array[store_t] from fx
union all select tenant_t, manager_a, 'manager', array[store_t] from fx
union all select tenant_t, roster_staff, 'staff', array[store_t] from fx
union all select tenant_t, former_staff, 'staff', array[store_t] from fx;
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at, phone, phone_linked_at, deactivated_at)
select tenant_t, 'Synthetic roster staff', 'staff'::public.tenant_role, array[store_t], 'active', roster_staff, t0 - interval '30 days', app.loyalty_normalize_phone('0900015003'), t0 - interval '30 days', null from fx
union all
select tenant_t, 'Synthetic former staff', 'staff', array[store_t], 'inactive', former_staff, t0 - interval '30 days', null, null, t0 - interval '1 day' from fx;
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_t, '0900015002' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_t, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
update public.tenants set loyalty_adjust_max_stamps = 5, loyalty_adjust_max_points = 50 where id = (select tenant_t from fx);

create temp table ids (name text primary key, id uuid);
-- 1 = ordinary customer, 2 = on the owner's list, 3 = on an active roster row, 4 = phone of a deactivated roster row
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone((select tenant_t from fx), '090001500' || n, timestamptz '2026-11-01 08:00+07')
from generate_series(1, 4) n;
insert into ids
select 'member_' || n, app.loyalty_join((select tenant_t from fx), (select id from ids where name = 'customer_' || n), 'mini_app', (select store_t from fx), null, null, timestamptz '2026-11-01 09:00+07')
from generate_series(1, 4) n;

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.adjust_rows(p_member text) returns bigint language sql as $$
  select count(*) from public.loyalty_ledger where membership_id = (select id from ids where name = p_member) and entry_kind = 'adjust' and reason = 'synthetic adjustment';
$$;
create function pg_temp.request_rows(p_member text) returns bigint language sql as $$
  select count(*) from app.loyalty_requests where membership_id = (select id from ids where name = p_member);
$$;
create function pg_temp.ask(p_user uuid, p_member text, p_stamps int, p_points int, p_kind text default 'adjustment') returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return (app.staff_request((select store_t from fx), p_kind, (select id from ids where name = p_member), 'synthetic adjustment', p_stamps, p_points, (select t0 from fx) + interval '1 day') ->> 'state');
exception when others then
  return sqlstate || ':' || split_part(sqlerrm, ':', 1);
end;
$$;

select is(pg_temp.ask((select staff_a from fx), 'member_2', 1, 10), '22023:staff_phone', 'owner list, staff below the threshold: refused as staff_phone');
select is(pg_temp.ask((select staff_a from fx), 'member_3', 1, 10), '22023:staff_phone', 'active roster row, staff below the threshold: refused as staff_phone');
select is(pg_temp.ask((select staff_a from fx), 'member_3', 9, 0), '22023:staff_phone', 'active roster row, staff above the threshold: refused instead of queued');
select is(pg_temp.ask((select staff_a from fx), 'member_2', 0, 500), '22023:staff_phone', 'owner list, staff above the threshold: refused instead of queued');
select is(pg_temp.ask((select manager_a from fx), 'member_2', 1, 0), '22023:staff_phone', 'owner list, manager: refused');
select is(pg_temp.ask((select manager_a from fx), 'member_3', -1, 0), '22023:staff_phone', 'active roster row, manager, a removal: refused too');
select is(pg_temp.ask((select staff_a from fx), 'member_3', 1, 0, 'dispute'), '22023:staff_phone', 'a dispute for the membership of a staff phone is refused');
select is(pg_temp.adjust_rows('member_2') + pg_temp.adjust_rows('member_3'), 0::bigint, 'the refusals wrote no ledger row');
select is(pg_temp.request_rows('member_2') + pg_temp.request_rows('member_3'), 0::bigint, 'and no request row');

select is(pg_temp.ask((select staff_a from fx), 'member_1', 1, 10), 'applied', 'ordinary customer, below the threshold: applied at once');
select is(pg_temp.ask((select staff_a from fx), 'member_1', 9, 0), 'pending', 'ordinary customer, above the threshold: waits for a manager');
select is(pg_temp.ask((select staff_a from fx), 'member_4', 1, 0), 'applied', 'a phone of a deactivated roster row is a customer again: applied');
select is(pg_temp.adjust_rows('member_1'), 1::bigint, 'the ordinary customer''s adjustment is in the ledger');

-- Approval path: the phone joins the staff list while a request waits
reset role;
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_t, '0900015001' from fx;
select pg_temp.as_user((select manager_a from fx));
select is(
  pg_temp.ask((select manager_a from fx), 'member_1', 1, 0), '22023:staff_phone', 'once the phone is on the staff list new requests are refused'
);
select throws_ok(
  format($q$ select app.staff_decide_loyalty_request(%L, 'approved') $q$, (select id from app.loyalty_requests where membership_id = (select id from ids where name = 'member_1') and status = 'pending')),
  '22023', null, 'approving a pending request after the phone joined the staff list is refused'
);
select is(pg_temp.adjust_rows('member_1'), 1::bigint, 'the refused approval wrote no ledger row');
select is(
  (select app.staff_decide_loyalty_request(id, 'refused', 'synthetic refusal') ->> 'state' from app.loyalty_requests where membership_id = (select id from ids where name = 'member_1') and status = 'pending'),
  'refused', 'the request can still be refused'
);
select is(app.loyalty_is_staff_phone((select tenant_t from fx), '0900015004'), false, 'the deactivated roster phone is no staff phone');

select * from finish();
rollback;
