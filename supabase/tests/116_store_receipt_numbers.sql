begin;
select plan(13);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011601'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000011601'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000011601'::uuid as store_daily,
  'ffffffff-ffff-4fff-8fff-000000011602'::uuid as store_owner,
  'ffffffff-ffff-4fff-8fff-000000011603'::uuid as store_unknown,
  'ffffffff-ffff-4fff-8fff-000000011604'::uuid as store_never,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011601'::uuid as brand_r,
  '99999999-9999-4999-8999-000000011601'::uuid as app_r,
  'eeeeeeee-eeee-4eee-8eee-000000011601'::uuid as owner_r,
  'eeeeeeee-eeee-4eee-8eee-000000011611'::uuid as login_r;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'receipt-numbers-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_r, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.owner_r, false), (fx.login_r, true)) as u (id, customer);

insert into public.tenants (id, slug, name, country_code) select tenant_r, 'receipt-numbers-pgtap', 'Receipt numbers pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_r, tenant_r, 'mock', 'receipt-numbers', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, receipt_numbers_reset, tran_no_reset_period)
select store_daily, tenant_r, account_r, 'rn-ext-1', 'rn-1', 'Synthetic store 1', 'daily'::public.tran_no_reset_period, 'unknown'::public.tran_no_reset_period from fx
union all
select store_owner, tenant_r, account_r, 'rn-ext-2', 'rn-2', 'Synthetic store 2', 'daily', 'yearly' from fx
union all
select store_unknown, tenant_r, account_r, 'rn-ext-3', 'rn-3', 'Synthetic store 3', 'unknown', 'unknown' from fx
union all
select store_never, tenant_r, account_r, 'rn-ext-4', 'rn-4', 'Synthetic store 4', 'yearly', 'never' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_r, owner_r, 'owner'::public.tenant_role, null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_r, tenant_r, 'brand-116', 'Synthetic brand', array[store_daily, store_owner, store_unknown, store_never] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_r, tenant_r, brand_r, 'synthetic-receipt-numbers-app', 'ZALO_APP_SECRET_BRAND_116', 'active' from fx;

select app.zalo_customer_sign_in((select app_r from fx), 'rnuser1', null, (select login_r from fx));

grant select on fx to authenticated;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
begin
  execute p_statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

select col_type_is('public', 'stores', 'receipt_numbers_reset', 'tran_no_reset_period', 'stores.receipt_numbers_reset uses the reset enum');
select col_not_null('public', 'stores', 'receipt_numbers_reset', 'stores.receipt_numbers_reset is not null');
select is(
  (select receipt_numbers_reset::text from public.stores s where s.id = (select store_daily from fx)),
  'daily',
  'the column keeps what the POS reports'
);
insert into public.stores (tenant_id, pos_account_id, external_id, name) select tenant_r, account_r, 'rn-ext-9', 'Synthetic store 9' from fx;
select is(
  (select receipt_numbers_reset::text from public.stores where external_id = 'rn-ext-9'),
  'unknown',
  'a store the connector says nothing about is unknown'
);
select is(
  pg_temp.outcome($q$ update public.stores set receipt_numbers_reset = 'never' where id = (select store_unknown from fx) $q$),
  '23514',
  'the POS reports only daily, yearly or unknown; never is the owner''s word'
);

select is(
  array[
    app.receipt_numbers_reset('unknown', 'daily'),
    app.receipt_numbers_reset('yearly', 'daily'),
    app.receipt_numbers_reset('never', 'yearly'),
    app.receipt_numbers_reset('unknown', 'unknown'),
    app.receipt_numbers_reset(null, null)
  ]::text[],
  array['daily', 'yearly', 'never', 'unknown', 'unknown'],
  'the owner''s setting wins unless unknown, then the POS''s, else unknown'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select owner_r from fx), 'role', 'authenticated')::text, true);
select is(
  pg_temp.outcome($q$ update public.stores set receipt_numbers_reset = 'yearly' where id = (select store_daily from fx) $q$),
  '42501',
  'no API role writes the POS''s numbering, not even the owner'
);
select is(
  pg_temp.outcome($q$ update public.stores set tran_no_reset_period = 'daily' where id = (select store_unknown from fx) $q$),
  'ok',
  'the owner still sets the store''s own numbering'
);
select is(
  (select receipt_numbers_reset::text from public.stores where id = (select store_daily from fx)),
  'daily',
  'and reads what the POS reports'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', (select login_r from fx), 'role', 'authenticated',
  'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_r from fx), 'customer_id', null)
)::text, true);
select is(
  (select jsonb_object_agg(s.value ->> 'code', s.value ->> 'receipt_numbers_reset') from jsonb_array_elements(public.customer_home() -> 'stores') s),
  '{"rn-1": "daily", "rn-2": "yearly", "rn-3": "daily", "rn-4": "never"}'::jsonb,
  'the home gives each store the numbering it follows, the owner''s word first'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.customer_home() -> 'stores') s where s.value ? 'receipt_numbers_reset'),
  4,
  'every store of the brand carries it, a visitor''s home included'
);
reset role;

update public.stores set tran_no_reset_period = 'unknown', receipt_numbers_reset = 'unknown' where id = (select store_unknown from fx);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', (select login_r from fx), 'role', 'authenticated',
  'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_r from fx), 'customer_id', null)
)::text, true);
select is(
  (select s.value ->> 'receipt_numbers_reset' from jsonb_array_elements(public.customer_home() -> 'stores') s where s.value ->> 'code' = 'rn-3'),
  'unknown',
  'a store nobody knows about stays unknown, so the app does not warn'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'app.receipt_numbers_reset(public.tran_no_reset_period, public.tran_no_reset_period)', 'execute')
  and not has_function_privilege('anon', 'app.receipt_numbers_reset(public.tran_no_reset_period, public.tran_no_reset_period)', 'execute'),
  'the helper is not an API function'
);

select * from finish();
rollback;
