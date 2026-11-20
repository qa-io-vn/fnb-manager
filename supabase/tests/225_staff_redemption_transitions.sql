-- ISTQB state transition testing of a redemption at a store in staff mode (no POS confirmation). States: held,
-- confirmed, cancelled, released. Valid: held -> confirmed by staff after a verification (staff_confirm_redemption);
-- confirmed -> cancelled by a manager within the window (staff_void_redemption). Invalid: confirming before the
-- verification, twice, at a pos_sync store, by the staff member who recorded the member's bill today (earn by one,
-- redeem by another), beyond the staff member's daily count; voiding by staff, after the window, twice, or a reward
-- the POS confirmed. The ledger: the redeem row stays pending until its confirm row (reason staff_confirmed, no
-- invoice), a void gives the stamps back.
begin;
select plan(24);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022501'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022502'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022501'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022502'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022501'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022502'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022503'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022504'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022501'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022501'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022501'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022502'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022501'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022502'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022503'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022504'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022505'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022506'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022507'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022511'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022512'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022513'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-25-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-25-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-25-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-25-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-25-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b25-s1', 'b25-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b25-s2', 'b25-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b25-p', 'b25-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b25-b', 'b25-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-925', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-25', 'ZALO_APP_SECRET_BRAND_925', 'active' from fx;
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
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000250' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-25-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900025099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-25-' || n, l.id, (select id from ids where name = 'customer_' || n)
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


insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_t, s, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], t0 - interval '30 days'
from fx cross join lateral unnest(array[fx.store_s1, fx.store_p]) as s;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_t, s, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display
from fx cross join lateral unnest(array[fx.store_s1, fx.store_p]) as s;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, status)
select tenant_t, programme_t, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 1, 0, array[store_s1, store_p], 'active'::public.coupon_status from fx;
insert into ids select 'coupon', id from public.coupons where tenant_id = (select tenant_t from fx);
select app.loyalty_apply_adjustment(pg_temp.id('member_' || n), (select store_s1 from fx), 3, 0, 'synthetic stamps', (select owner_u from fx), (select t0 from fx) - interval '1 day')
from generate_series(1, 4) n;

create function pg_temp.redeem(p_name text, p_member text, p_store uuid, p_at timestamptz) returns text language plpgsql as $$
declare
  v jsonb := app.redeem_coupon(pg_temp.id(p_member), pg_temp.id('coupon'), p_store, p_at);
begin
  insert into ids values (p_name, (v ->> 'redemption_id')::uuid);
  return v ->> 'code';
end;
$$;
create function pg_temp.verify(p_user uuid, p_store uuid, p_code text, p_at timestamptz) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return app.staff_verify_redemption(p_store, p_code, p_at) ->> 'state';
end;
$$;
create function pg_temp.confirm(p_user uuid, p_name text, p_at timestamptz) returns text language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := app.staff_confirm_redemption(pg_temp.id(p_name), p_at);
  return coalesce(v ->> 'refusal', v ->> 'state');
exception when others then
  return 'error:' || sqlstate;
end;
$$;
create function pg_temp.void(p_user uuid, p_name text, p_at timestamptz) returns text language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := app.staff_void_redemption(pg_temp.id(p_name), 'served the wrong drink', p_at);
  return coalesce(v ->> 'refusal', v ->> 'state');
exception when others then
  return 'error:' || sqlstate;
end;
$$;
create function pg_temp.state(p_name text) returns text language sql as $$
  select state::text from public.redemptions where id = pg_temp.id(p_name);
$$;

create temp table codes (name text primary key, code text);
insert into codes select 'r1', pg_temp.redeem('r1', 'member_1', (select store_s1 from fx), (select t0 from fx));
select is(pg_temp.state('r1'), 'held', 'a redemption starts held');
select is(pg_temp.balance('member_1'), '2/0/0/0', 'the held stamp is no longer spendable');
select is(pg_temp.confirm((select staff_1 from fx), 'r1', (select t0 from fx) + interval '1 minute'), 'not_verified', 'held -> confirmed needs the verification first');
select is(pg_temp.verify((select staff_1 from fx), (select store_s1 from fx), (select code from codes where name = 'r1'), (select t0 from fx) + interval '2 minutes'), 'verified', 'staff verify the code');
select is(pg_temp.confirm((select staff_s2 from fx), 'r1', (select t0 from fx) + interval '3 minutes'), 'error:42501', 'staff of another store cannot confirm it');
select is(pg_temp.confirm((select staff_1 from fx), 'r1', (select t0 from fx) + interval '3 minutes'), 'confirmed', 'held -> confirmed at once by staff');
select is(pg_temp.state('r1'), 'confirmed', 'the redemption is confirmed');
select is((select confirmed_invoice_id is null and confirmed_by = (select staff_1 from fx) from public.redemptions where id = pg_temp.id('r1')), true, 'without an invoice, by the staff member');
select ok(exists (select 1 from public.loyalty_ledger l join public.redemptions r on r.redeem_entry_id = l.source_entry_id
  where r.id = pg_temp.id('r1') and l.entry_kind = 'confirm' and l.reason = 'staff_confirmed' and l.invoice_id is null), 'a confirm row with reason staff_confirmed');
select is(pg_temp.confirm((select staff_1 from fx), 'r1', (select t0 from fx) + interval '4 minutes'), 'used', 'a second confirmation reads used');

-- confirmed -> cancelled
select is(pg_temp.void((select staff_1 from fx), 'r1', (select t0 from fx) + interval '5 minutes'), 'error:42501', 'staff cannot void');
select is(pg_temp.void((select manager_u from fx), 'r1', (select t0 from fx) + interval '3 minutes' + interval '480 minutes 1 second'), 'window_passed', 'after the window a void is refused');
select is(pg_temp.void((select manager_u from fx), 'r1', (select t0 from fx) + interval '3 minutes' + interval '480 minutes'), 'voided', 'exactly at the end of the window the manager voids it');
select is(pg_temp.state('r1'), 'cancelled', 'confirmed -> cancelled');
select is(pg_temp.balance('member_1'), '3/0/0/0', 'the stamp is given back');
select is(pg_temp.void((select manager_u from fx), 'r1', (select t0 from fx) + interval '9 hours'), 'already_voided', 'a second void is refused');

-- pos_sync store: staff confirmation is not the source there
insert into codes select 'r2', pg_temp.redeem('r2', 'member_2', (select store_p from fx), (select t0 from fx));
select is(pg_temp.verify((select staff_1 from fx), (select store_p from fx), (select code from codes where name = 'r2'), (select t0 from fx) + interval '1 minute'), 'verified', 'a code verified at a pos_sync store');
select is(pg_temp.confirm((select staff_1 from fx), 'r2', (select t0 from fx) + interval '2 minutes'), 'not_staff_mode', 'cannot be confirmed by staff there');
select is(pg_temp.state('r2'), 'held', 'it stays held for the synced invoice');
select is(pg_temp.void((select manager_u from fx), 'r2', (select t0 from fx) + interval '3 minutes'), 'not_staff_confirmed', 'and a manager cannot void what staff did not confirm');

-- Earn by one, redeem by another
select is((pg_temp.submit(null, (select staff_1 from fx), 'member_3', (select store_s1 from fx), 'R-1', 60000, (select t0 from fx))) ->> 'state', 'awaiting_customer', 'staff 1 records a bill of member 3');
insert into codes select 'r3', pg_temp.redeem('r3', 'member_3', (select store_s1 from fx), (select t0 from fx) + interval '5 minutes');
select pg_temp.verify((select staff_1 from fx), (select store_s1 from fx), (select code from codes where name = 'r3'), (select t0 from fx) + interval '6 minutes');
select is(pg_temp.confirm((select staff_1 from fx), 'r3', (select t0 from fx) + interval '7 minutes'), 'same_staff', 'the same staff member cannot confirm that member''s reward the same day');
select is(pg_temp.confirm((select staff_2 from fx), 'r3', (select t0 from fx) + interval '7 minutes'), 'confirmed', 'another staff member can');

-- Daily count per staff member
update public.loyalty_store_settings set staff_redemptions_per_day = 1 where store_id = (select store_s1 from fx);
insert into codes select 'r4', pg_temp.redeem('r4', 'member_4', (select store_s1 from fx), (select t0 from fx) + interval '10 minutes');
select pg_temp.verify((select staff_2 from fx), (select store_s1 from fx), (select code from codes where name = 'r4'), (select t0 from fx) + interval '11 minutes');
select is(pg_temp.confirm((select staff_2 from fx), 'r4', (select t0 from fx) + interval '12 minutes'), 'staff_daily_cap', 'beyond staff_redemptions_per_day the staff member is refused');

select * from finish();
rollback;
