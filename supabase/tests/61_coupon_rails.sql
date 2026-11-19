begin;
select plan(48);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006101'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000006102'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000006101'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000006102'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000006101'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000006102'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000006111'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000006101'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000006102'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000006103'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006104'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006105'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000006106'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000006107'::uuid as owner_y,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006101'::uuid as programme_x;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coupon-rails-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.viewer_x, fx.publisher_x, fx.owner_y]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'coupon-rails-pgtap-x', 'Coupon rails pgTAP X' from fx
union all
select tenant_y, 'coupon-rails-pgtap-y', 'Coupon rails pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'coupon-rails-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'coupon-rails-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, e_invoice_status)
select store_x1, tenant_x, account_x, 'cr-x1', 'Synthetic store X1', 'configured'::public.e_invoice_status from fx
union all
select store_x2, tenant_x, account_x, 'cr-x2', 'Synthetic store X2', 'not_configured' from fx
union all
select store_y1, tenant_y, account_y, 'cr-y1', 'Synthetic store Y1', 'unknown' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, fx.owner_y, 'owner', null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on)
select programme_x, tenant_x, 'Synthetic programme X', date '2026-12-01' from fx;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.value_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

grant select on fx to authenticated, service_role;

select has_table('public', 'coupon_rails', 'coupon_rails exists');
select has_table('public', 'coupon_rail_rewards', 'coupon_rail_rewards exists');
select has_table('public', 'coupon_codes', 'coupon_codes exists');
select enum_has_labels('public', 'coupon_rail', array['crm_code_pool', 'crm_callback', 'pos_payment_discount'], 'coupon_rail labels');
select enum_has_labels('public', 'einvoice_display', array['discount', 'zero_price_line'], 'einvoice_display labels');
select enum_has_labels('public', 'coupon_code_state', array['available', 'assigned', 'used', 'quarantined', 'expired'], 'coupon_code_state labels');

set local role authenticated;
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail, active_from) values (%L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'pos_payment_discount', '2026-11-01 00:00+07')),
  'rows:1',
  'an owner with every store sets a store''s rail'
);
select is(
  pg_temp.outcome_as((select manager_xall from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from) values (%L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'crm_code_pool', '{pool-programme-1}', '2026-11-10 00:00+07')),
  'rows:1',
  'a manager with every store switches the rail by inserting a row'
);
select is(
  pg_temp.value_as((select owner_x from fx), format('select string_agg(rail::text || %L || coalesce(active_until::text, %L), %L order by active_from) from public.coupon_rails where store_id = %L', ':', 'active', ',', (select store_x1 from fx))),
  'pos_payment_discount:2026-11-09 17:00:00+00,crm_code_pool:active',
  'the switch closes the previous row at the new start and keeps it as history'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupon_rails set rail = %L where store_id = %L and active_until is null', 'crm_callback', (select store_x1 from fx))),
  '22023',
  'a row''s rail never changes: switching inserts a row'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupon_rails set active_until = null where store_id = %L and active_until is not null', (select store_x1 from fx))),
  '22023',
  'a replaced row stays history'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail, active_from) values (%L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'crm_callback', '2026-11-05 00:00+07')),
  '22023',
  'a switch cannot start before the active rail started'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupon_rails set callback_ip_allowlist = %L where store_id = %L and active_until is null', '{203.0.113.0/24}', (select store_x1 from fx))),
  'rows:1',
  'the allow-list of the active row may change'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail) values (%L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'crm_callback')),
  '42501',
  'a store-limited manager sets no rail'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail) values (%L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'crm_callback')),
  '42501',
  'staff set no rail'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rails (tenant_id, store_id, rail) values (%L, %L, %L)', (select tenant_x from fx), (select store_x2 from fx), 'pos_payment_discount')),
  'rows:1',
  'the second store gets the fallback rail'
);
select is(
  pg_temp.value_as((select owner_x from fx), format('select string_agg(f.rail::text || %L || f.e_invoice_status::text || %L || f.flagged::text, %L order by f.rail) from public.loyalty_rail_flags(array[%L, %L]::uuid[]) f', ':', ':', ',', (select store_x1 from fx), (select store_x2 from fx))),
  'crm_code_pool:configured:false,pos_payment_discount:not_configured:true',
  'a store with a rail whose e-invoicing is not configured is flagged, a configured one is not'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select count(*) from public.loyalty_rail_flags(array[%L, %L]::uuid[])', (select store_x1 from fx), (select store_x2 from fx))),
  '1',
  'the flags follow the caller''s store scope'
);
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.coupon_rails'), '2', 'staff read the rails of their store (data role)');
select is(pg_temp.value_as((select viewer_x from fx), 'select count(*) from public.coupon_rails'), '3', 'a viewer reads every rail of the tenant');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.coupon_rails'), '0', 'the publisher reads no rail');
select is(pg_temp.value_as((select owner_y from fx), 'select count(*) from public.coupon_rails'), '0', 'another tenant reads no rail');

select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, einvoice_display) values (%L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'free-drink', 'discount')),
  '23514',
  'a mapping names the POS side of the reward'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display) values (%L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'free-drink', 'Synthetic discount', 'zero_price_line')),
  '23514',
  'a 0-price line needs the free item'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_free_item_external_id, einvoice_display) values (%L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'free-drink', 'item-free-drink', 'zero_price_line')),
  'rows:1',
  'an owner maps a reward to a 0-price promotional line'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display) values (%L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'ten-off', 'Synthetic discount', 'discount')),
  '42501',
  'a store-limited manager maps nothing'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps, active) values (%L, %L, %L, %L, 8, true)', (select tenant_x from fx), (select programme_x from fx), 'free-drink', 'Free drink')),
  '22023',
  'a reward for every store cannot be active while one store lacks its mapping'
);
reset role;
select throws_ok(
  $$ insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps, active) select tenant_x, programme_x, 'free-drink', 'Free drink', 8, true from fx $$,
  '22023', null,
  'the database owner cannot activate an unmapped reward either'
);
set local role service_role;
select throws_ok(
  $$ insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps, active) select tenant_x, programme_x, 'free-drink', 'Free drink', 8, true from fx $$,
  '22023', null,
  'nor can the service role'
);
reset role;
set local role authenticated;
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps, store_ids, active) values (%L, %L, %L, %L, 8, array[%L]::uuid[], true)', (select tenant_x from fx), (select programme_x from fx), 'free-drink', 'Free drink', (select store_x1 from fx))),
  'rows:1',
  'a reward limited to the mapped store is activated'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupons set store_ids = null where reward_key = %L', 'free-drink')),
  '22023',
  'widening an active reward to an unmapped store is refused'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupon_rail_rewards set active = false where reward_key = %L', 'free-drink')),
  '22023',
  'the mapping of an active reward cannot be deactivated'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('delete from public.coupon_rail_rewards where reward_key = %L', 'free-drink')),
  '22023',
  'the mapping of an active reward cannot be deleted'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display) values (%L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x2 from fx), 'free-drink', 'Synthetic free drink', 'discount')),
  'rows:1',
  'the second store maps the reward to a POS discount'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupons set store_ids = null where reward_key = %L', 'free-drink')),
  'rows:1',
  'with every store mapped the reward covers the tenant'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.coupons set active = false where reward_key = %L', 'free-drink')),
  'rows:1',
  'the reward is deactivated'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('delete from public.coupon_rail_rewards where reward_key = %L and store_id = %L', 'free-drink', (select store_x2 from fx))),
  'rows:1',
  'then its mapping may go'
);
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.coupon_rail_rewards'), '1', 'staff read their store''s mappings');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.coupon_rail_rewards'), '0', 'the publisher reads no mapping');
reset role;

insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_x, store_x1, 'free-drink', 'SYN-' || n from fx, generate_series(1, 3) n
union all
select tenant_x, store_x2, 'free-drink', 'SYN-' || n from fx, generate_series(4, 5) n;

select throws_ok(
  $$ insert into public.coupon_codes (tenant_id, store_id, reward_key, code, state) select tenant_x, store_x1, 'free-drink', 'SYN-9', 'used' from fx $$,
  '23514', null,
  'a used code carries its use time'
);
select throws_ok(
  $$ insert into public.coupon_codes (tenant_id, store_id, reward_key, code) select tenant_x, store_x1, 'free-drink', 'SYN-1' from fx $$,
  '23505', null,
  'a code is unique per store'
);

set local role authenticated;
select is(pg_temp.value_as((select owner_x from fx), 'select count(*) from public.coupon_codes'), '5', 'an owner reads every code');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.coupon_codes'), '3', 'a store-limited manager reads the codes of their store');
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.coupon_codes'), '0', 'staff read no code directly');
select is(pg_temp.value_as((select viewer_x from fx), 'select count(*) from public.coupon_codes'), '0', 'a viewer reads no code');
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.coupon_codes (tenant_id, store_id, reward_key, code) values (%L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'free-drink', 'SYN-7')),
  '42501',
  'no API role writes codes'
);
reset role;

set local role anon;
select throws_ok('select count(*) from public.coupon_rails', '42501', null, 'anon reads no rail');
select throws_ok('select count(*) from public.coupon_codes', '42501', null, 'anon reads no code');
reset role;

select * from finish();
rollback;
