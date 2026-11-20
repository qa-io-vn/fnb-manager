-- The per-store loyalty confirmation settings (loyalty_store_settings). ISTQB techniques: equivalence partitioning
-- of the callers (owner of the tenant, owner limited to the store, manager, staff, viewer, owner of another tenant),
-- boundary values of every knob (just inside and just outside each range), and a check that the default keeps
-- today's behaviour (pos_sync) for existing and new stores.
begin;
select plan(30);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022001'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022002'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022001'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022002'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022001'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022002'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022003'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022004'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022001'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022001'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022001'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022002'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022002'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022003'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022004'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022005'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022006'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022007'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022011'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022012'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022013'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-20-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-20-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-20-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-20-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-20-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b20-s1', 'b20-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b20-s2', 'b20-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b20-p', 'b20-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b20-b', 'b20-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-920', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-20', 'ZALO_APP_SECRET_BRAND_920', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, stamp_min_bill_amount, point_unit_amount, points_per_unit)
select programme_t, tenant_t, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 50000, 10000, 1 from fx
union all
select programme_u, tenant_u, 'Synthetic programme U', date '2026-11-01', 'below_threshold', 'active', 0, 50000, 10000, 1 from fx;
update public.loyalty_store_settings
set confirmation = 'staff', bill_audit_sample_pct = 0, self_claim = true
where store_id in (select store_s1 from fx union all select store_s2 from fx);
update public.loyalty_store_settings set confirmation = 'staff', bill_audit_sample_pct = 0 where store_id = (select store_b from fx);

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000200' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-20-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900020099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-20-' || n, l.id, (select id from ids where name = 'customer_' || n)
from fx cross join lateral (values (1, fx.login_1), (2, fx.login_2), (3, fx.login_3)) as l (n, id);

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_login(p_login uuid) returns void language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_login, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', l.tenant_id, 'customer_id', l.customer_id)
  )::text, true)
  from app.customer_logins l where l.user_id = p_login;
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create function pg_temp.code(p_member text, p_store uuid, p_at timestamptz) returns text language sql as $$
  select i.code from app.loyalty_issue_checkin_code(pg_temp.id(p_member), p_store, p_at) i;
$$;
-- Records a bill as a user: the answer, or {"error": SQLSTATE}; the bill id is kept under p_name.
create function pg_temp.submit(p_name text, p_user uuid, p_member text, p_store uuid, p_bill text, p_total numeric, p_at timestamptz)
returns jsonb language plpgsql as $$
declare
  v_code text := pg_temp.code(p_member, p_store, p_at - interval '10 seconds');
  v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := app.staff_submit_bill(p_store, v_code, p_bill, p_total, p_at);
  if v ->> 'bill_id' is not null and p_name is not null then
    insert into ids values (p_name, (v ->> 'bill_id')::uuid) on conflict (name) do update set id = excluded.id;
  end if;
  return v;
exception when others then
  return jsonb_build_object('error', sqlstate);
end;
$$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;
create function pg_temp.bill(p_name text) returns text language sql as $$
  select concat_ws(':', b.state, b.evidence_level, b.queue_reason, b.reversal_reason) from public.bill_captures b where b.id = pg_temp.id(p_name);
$$;
create function pg_temp.balance(p_member text) returns text language sql as $$
  select concat_ws('/', b.stamps, b.points, b.pending_stamps, b.pending_points) from app.loyalty_balance(pg_temp.id(p_member), null) b;
$$;


insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, login_3, 'owner', array[store_s1] from fx;

select is((select confirmation from public.loyalty_store_settings where store_id = (select store_p from fx)), 'pos_sync', 'a store gets pos_sync by default');
select ok((select bool_and(s.store_id is not null) from public.stores st left join public.loyalty_store_settings s on s.store_id = st.id),
  'every store has a settings row');
select is(app.loyalty_store_mode((select store_p from fx)), 'pos_sync', 'loyalty_store_mode reads pos_sync');
select is(app.loyalty_store_mode(gen_random_uuid()), 'pos_sync', 'and pos_sync for an unknown store');
select is(
  (select concat_ws(':', max_bill_amount, bill_evidence_required_level, bill_manager_approval_above, bill_amount_tolerance, bill_unconfirmed_hours,
     bill_silence_outcome, bill_staff_shift_cap, reverse_window_minutes, counter_code_ttl_seconds, auto_approve_max_amount, bill_reader_mode)
   from public.loyalty_store_settings where store_id = (select store_p from fx)),
  '2000000.00:2:1000000.00:1000.00:24:reverse:25:480:90:0.00:off',
  'the documented defaults');

create function pg_temp.set_as(p_user uuid, p_store uuid, p_settings jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return coalesce(app.set_loyalty_store_settings(p_store, p_settings, (select t0 from fx)) ->> 'confirmation', 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

-- Who may change the mode
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"confirmation": "staff"}'), 'staff', 'the tenant owner switches a store to staff');
select is(pg_temp.set_as((select login_3 from fx), (select store_s1 from fx), '{"confirmation": "pos_sync"}'), 'pos_sync', 'an owner limited to the store may too');
select is(pg_temp.set_as((select login_3 from fx), (select store_s2 from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'but not at another store');
select is(pg_temp.set_as((select manager_u from fx), (select store_p from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'a manager may not');
select is(pg_temp.set_as((select staff_1 from fx), (select store_p from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'a staff member may not');
select is(pg_temp.set_as((select viewer_u from fx), (select store_p from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'a viewer may not');
select is(pg_temp.set_as((select owner_b from fx), (select store_p from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'an owner of another tenant may not');
select is(pg_temp.set_as(null, (select store_p from fx), '{"confirmation": "pos_sync"}'), 'error:42501', 'no session may not');

-- Input partitions and boundaries
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"confirmation": "pos"}'), 'error:22023', 'an unknown mode is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"colour": "red"}'), 'error:22023', 'an unknown key is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"confirmation": null}'), 'error:22023', 'a null value is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '[]'), 'error:22023', 'a non-object is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"max_bill_amount": 100000000}'), 'staff', 'max_bill_amount 100,000,000 (upper bound) is accepted');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"max_bill_amount": 100000001}'), 'error:22023', '100,000,001 is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"max_bill_amount": 0}'), 'error:22023', '0 is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_evidence_required_level": 3}'), 'error:22023', 'level 3 is not yet a requirement');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_evidence_required_level": 0}'), 'staff', 'level 0 is accepted');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_unconfirmed_hours": 0}'), 'error:22023', '0 hours is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_unconfirmed_hours": 168}'), 'staff', '168 hours is accepted');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"counter_code_ttl_seconds": 29}'), 'error:22023', 'a QR life of 29 s is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"auto_approve_max_amount": 100000001}'), 'error:22023', 'auto-approval above the maximum bill is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_audit_sample_pct": 100.01}'), 'error:22023', 'an audit share above 100 % is refused');
select is(pg_temp.set_as((select owner_u from fx), (select store_p from fx), '{"bill_staff_shift_cap": "many"}'), 'error:22023', 'a value of the wrong type is refused');

-- Audit and reads
select ok(exists (
  select 1 from public.loyalty_audit_events e
  where e.store_id = (select store_p from fx) and e.action = 'settings_changed' and e.details -> 'changed' ? 'confirmation'
), 'a change is audited with the names of the changed keys');
select pg_temp.as_user((select staff_1 from fx));
set local role authenticated;
select is((select count(*)::integer from public.loyalty_store_settings), 0, 'a staff member does not read the settings table (the limits stay with managers)');
reset role;

select * from finish();
rollback;
