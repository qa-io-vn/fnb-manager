-- Quản lý → Tiền chờ xử lý's reader (ADR-068; migration payment_exception_readers): manager_payment_exceptions takes
-- the status "resolved" (refunded and dismissed in one call under one limit), names who resolved each exception (the
-- roster's name, else their Zalo sign-in's in the tenant, an owner included) and says which account received the money
-- (the store's own or the brand-wide one, its bank and the last 4 characters of its number as they were when the money
-- arrived), while every earlier answer and refusal stays as it was. The money is made the server's way where it can
-- be (checkout_set_provider, checkout_settle with a reference nobody issued, manager_resolve_payment_exception).
-- Techniques: equivalence partitions of the status (open, refunded, dismissed, resolved, null, unknown, wrong case,
-- empty), boundary values of the limit on the merged list (1 and 2), a decision table of who resolved it (on the
-- roster with a Zalo name too, an owner off the roster, a person named only in another tenant, nobody yet), state
-- transitions of a provider row (an account changed after the money arrived), and security: IDOR across stores and
-- tenants, staff refused, the brand-wide money still only for those with every store, no API role on the app function.
begin;
select plan(39);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030201'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030202'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030201'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030201'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030202'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000030203'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030201'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030202'::uuid as brand_b,
  '99999999-9999-4999-8999-000000030201'::uuid as app_a,
  '99999999-9999-4999-8999-000000030202'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000030201'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030202'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030203'::uuid as manager_all_u,
  'eeeeeeee-eeee-4eee-8eee-000000030204'::uuid as manager_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030205'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030206'::uuid as owner_b_u,
  timestamptz '2026-11-25 10:00:00+07' as t;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'readers-302-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_u), (fx.manager_u), (fx.manager_all_u), (fx.manager_a2_u), (fx.staff_u), (fx.owner_b_u)) as u (id);
insert into public.tenants (id, slug, name)
select tenant_a, 'readers-302-a', 'Readers 302 A' from fx union all
select tenant_b, 'readers-302-b', 'Readers 302 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'readers-302-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'readers-302-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select s.id, s.tenant, s.account, s.ext, s.code, s.name
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'r302-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'r302-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'r302-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', array[fx.store_a1]), (fx.manager_all_u, 'manager', null),
  (fx.manager_a2_u, 'manager', array[fx.store_a2]), (fx.staff_u, 'staff', array[fx.store_a1])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-302-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-302-zapp-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
-- The roster names the managers of the stores (the owner is never on it); the Zalo sign-ins carry the names people
-- chose: the manager's differs from the roster's, and the manager of every store signed in only at tenant B.
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_a, 'Quản lý mẫu', 'manager'::public.tenant_role, array[store_a1], 'active', manager_u, now() from fx union all
select tenant_a, 'Quản lý A2', 'manager', array[store_a2], 'active', manager_a2_u, now() from fx union all
select tenant_a, 'Thu ngân mẫu', 'staff', array[store_a1], 'active', staff_u, now() from fx;
insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_a, app_a, 'syn-302-owner', owner_u, 'Chủ quán mẫu' from fx union all
select tenant_a, app_a, 'syn-302-manager', manager_u, 'Tên Zalo của quản lý' from fx union all
select tenant_b, app_b, 'syn-302-elsewhere', manager_all_u, 'Tên ở quán khác' from fx union all
select tenant_b, app_b, 'syn-302-owner-b', owner_b_u, 'Chủ quán B' from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); the reader; the names of the listed
-- exceptions in their order; one listed exception.
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.at(p_minutes integer) returns timestamptz language sql stable as $$ select t + make_interval(mins => p_minutes) from fx $$;
create function pg_temp.list(p_user uuid, p_store uuid, p_status text, p_limit integer default 50) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select app.manager_payment_exceptions(%L, %L, %s)', p_store, p_status, p_limit));
$$;
create temp table x (name text primary key, id uuid);
create function pg_temp.names(p_answer jsonb) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(x.name, '?'), ', ' order by i.n), '')
  from jsonb_array_elements(p_answer -> 'exceptions') with ordinality as i (item, n)
  left join x on x.id = (i.item ->> 'id')::uuid;
$$;
create function pg_temp.item(p_answer jsonb, p_name text) returns jsonb language sql stable as $$
  select i from jsonb_array_elements(p_answer -> 'exceptions') i where (i ->> 'id')::uuid = (select id from x where name = p_name);
$$;
create function pg_temp.provider(p_user uuid, p_request jsonb, p_minutes integer) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$, p_request, pg_temp.at(p_minutes)));
$$;
create function pg_temp.bank(p_brand uuid, p_store uuid, p_bank text, p_number text, p_name text, p_secret text) returns jsonb language sql immutable as $$
  select jsonb_build_object('brand', p_brand, 'store', p_store, 'method', 'vietqr', 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', p_secret,
    'settings', jsonb_build_object('bank_bin', '970400', 'bank_name', p_bank, 'account_number', p_number, 'account_name', p_name, 'reference_prefix', 'FNB'));
$$;
create function pg_temp.provider_id(p_brand uuid, p_store uuid, p_method text) returns uuid language sql stable as $$
  select p.id from public.payment_providers p where p.brand_id = p_brand and p.method = p_method and p.store_id is not distinct from p_store;
$$;
-- A transfer whose reference nobody issued, settled as bank-webhook (or checkout-webhook) settles it: held for a manager.
create function pg_temp.unknown(p_provider uuid, p_ref text, p_reference text, p_amount numeric, p_minutes integer) returns uuid language sql as $$
  select (app.checkout_settle(jsonb_build_object('provider_id', p_provider, 'provider_ref', p_ref, 'amount', p_amount, 'success', true,
    'reference', p_reference, 'source', 'webhook'), pg_temp.at(p_minutes)) ->> 'exception_id')::uuid;
$$;
create function pg_temp.resolve(p_user uuid, p_name text, p_resolution text, p_minutes integer) returns text language sql as $$
  select pg_temp.call(p_user, format('select app.manager_resolve_payment_exception(%L, %L, %L, %L)', (select id from x where name = p_name),
    p_resolution, 'Ghi chú mẫu', pg_temp.at(p_minutes))) ->> 'state';
$$;

-- The accounts: store A1's own VietQR account and the brand-wide one (store A2 has none, so its customers pay the
-- brand's), the brand's wallet, and tenant B's account; each switched on by an owner, so each is in the change log.
select pg_temp.provider((select owner_u from fx), pg_temp.bank((select brand_a from fx), (select store_a1 from fx), 'Ngân hàng mẫu', '0123456789', 'CUA HANG MAU', 'PAYMENT_BANK_STORE_A'), -60);
select pg_temp.provider((select owner_u from fx), pg_temp.bank((select brand_a from fx), null, 'Ngân hàng chung', '9876543210', 'THUONG HIEU MAU', 'PAYMENT_BANK_BRAND_A'), -60);
select pg_temp.provider((select owner_u from fx), jsonb_build_object('brand', (select brand_a from fx), 'method', 'zalo_checkout', 'mode', 'sandbox',
  'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_A', 'settings', '{}'::jsonb), -60);
select pg_temp.provider((select owner_b_u from fx), pg_temp.bank((select brand_b from fx), null, 'Ngân hàng B', '5555666677', 'QUAN B', 'PAYMENT_BANK_BRAND_B'), -60);

-- The money held: at store A1's account (x1 open, x2 refunded by the manager, x3 dismissed by the owner, x4 dismissed by
-- the manager of every store), at the brand's account and wallet with no store (x5, x6), at tenant B (x7), then after
-- store A1's account number changed (x8), and at store A2 through the brand's account (x9, as checkout_settle records
-- a transfer of another amount for an attempt there; the attempt's path is 290's).
insert into x values
  ('x1', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), (select store_a1 from fx), 'vietqr'), 'mock:r302-1', 'FNBAAAAAAA2', 45000, 1)),
  ('x2', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), (select store_a1 from fx), 'vietqr'), 'mock:r302-2', 'FNBAAAAAAA3', 30000, 2)),
  ('x3', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), (select store_a1 from fx), 'vietqr'), 'mock:r302-3', 'FNBAAAAAAA4', 20000, 3)),
  ('x4', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), (select store_a1 from fx), 'vietqr'), 'mock:r302-4', 'FNBAAAAAAA5', 10000, 4)),
  ('x5', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), null, 'vietqr'), 'mock:r302-5', 'FNBAAAAAAA6', 50000, 5)),
  ('x6', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), null, 'zalo_checkout'), 'zalo:r302-6', 'ZCAAAAAAA7', 60000, 6)),
  ('x7', pg_temp.unknown(pg_temp.provider_id((select brand_b from fx), null, 'vietqr'), 'mock:r302-7', 'FNBAAAAAAA8', 70000, 7));
select pg_temp.resolve((select manager_u from fx), 'x2', 'refunded', 20);
select pg_temp.resolve((select owner_u from fx), 'x3', 'dismissed', 21);
select pg_temp.resolve((select manager_all_u from fx), 'x4', 'dismissed', 22);
select pg_temp.provider((select owner_u from fx), pg_temp.bank((select brand_a from fx), (select store_a1 from fx), 'Ngân hàng mới', '1111222233', 'CUA HANG MAU', 'PAYMENT_BANK_STORE_A'), 30);
insert into x values
  ('x8', pg_temp.unknown(pg_temp.provider_id((select brand_a from fx), (select store_a1 from fx), 'vietqr'), 'mock:r302-8', 'FNBAAAAAAA9', 80000, 31));
insert into public.payment_exceptions (tenant_id, store_id, provider_id, method, provider_ref, amount, expected_amount, reason, reference, source, received_at)
select tenant_a, store_a2, pg_temp.provider_id(brand_a, null, 'vietqr'), 'vietqr', 'mock:r302-9', 24000, 25000, 'amount_differs', 'FNBAAAAAAAB', 'webhook', pg_temp.at(32)
from fx;
insert into x select 'x9', id from public.payment_exceptions where provider_ref = 'mock:r302-9';

select is((select count(*) from x where id is not null), 9::bigint, 'nine pieces of money are held, none applied to an order');

-- 1. The status (equivalence partitions; the earlier ones unchanged) -------------------------------------------------

select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'open')), 'x8, x1', 'open: the open ones, newest first');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'refunded')), 'x2', 'refunded: the ones handed back');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'dismissed')), 'x4, x3', 'dismissed: the ones dismissed');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'resolved')), 'x4, x3, x2',
  'resolved: both resolutions in one answer, newest first');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), null)), 'x8, x4, x3, x2, x1', 'null: every one of the store');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'resolved', 1)), 'x4',
  'resolved with limit 1: only the newest of both resolutions (the limit holds on the merged list)');
select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'resolved', 2)), 'x4, x3', 'resolved with limit 2: the two newest');
select is(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'resolved') ->> 'open', '2', 'the open count is the same whatever the filter');
select is(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'closed') ->> 'error', '22023', 'an unknown status is refused');
select is(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'Resolved') ->> 'error', '22023', 'so is the right word in another case');
select is(pg_temp.list((select manager_u from fx), (select store_a1 from fx), '') ->> 'error', '22023', 'and an empty one');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.item(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'open'), 'x1')) k),
  array['account', 'amount', 'expected_amount', 'id', 'method', 'order_id', 'order_no', 'reason', 'received_at', 'reference', 'resolution_note',
    'resolved_at', 'resolved_by', 'resolved_by_name', 'source', 'status'],
  'an exception keeps every earlier field and gains resolved_by_name and account');

-- 2. Who resolved it (decision table) --------------------------------------------------------------------------------

create temp table r as select pg_temp.list((select owner_u from fx), (select store_a1 from fx), 'resolved') as answer;
select is(pg_temp.item((select answer from r), 'x2') ->> 'resolved_by_name', 'Quản lý mẫu', 'a manager on the roster: the roster''s name, not the Zalo one');
select is(pg_temp.item((select answer from r), 'x2') ->> 'resolved_by', (select manager_u::text from fx), 'resolved_by is still answered');
select is(pg_temp.item((select answer from r), 'x3') ->> 'resolved_by_name', 'Chủ quán mẫu', 'the owner, never on the roster: the name of their Zalo sign-in');
select ok(pg_temp.item((select answer from r), 'x4') ? 'resolved_by_name' and pg_temp.item((select answer from r), 'x4') -> 'resolved_by_name' = 'null'::jsonb,
  'a person named only at another tenant: no name (another tenant''s name is never shown)');
select ok(pg_temp.item(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'open'), 'x1') -> 'resolved_by_name' = 'null'::jsonb,
  'an open one: no name');
select is(pg_temp.resolve((select manager_u from fx), 'x1', 'dismissed', 40), 'dismissed', 'the manager settles x1');
select is(pg_temp.item(pg_temp.list((select manager_u from fx), (select store_a1 from fx), 'resolved'), 'x1') ->> 'resolved_by_name', 'Quản lý mẫu',
  'and is named on it at once (open → dismissed)');

-- 3. Which account received the money ------------------------------------------------------------------------------

create temp table all_a1 as select pg_temp.list((select owner_u from fx), (select store_a1 from fx), null) as answer;
select is(pg_temp.item((select answer from all_a1), 'x1') -> 'account', '{"scope": "store", "bank_name": "Ngân hàng mẫu", "account_tail": "6789"}'::jsonb,
  'the store''s own account: its bank and the last 4 digits');
select is(pg_temp.item((select answer from all_a1), 'x8') -> 'account', '{"scope": "store", "bank_name": "Ngân hàng mới", "account_tail": "2233"}'::jsonb,
  'money after the account changed: the new account');
select is(pg_temp.item((select answer from all_a1), 'x2') -> 'account' ->> 'account_tail', '6789',
  'money before the change: the account as it was when the money arrived');
select is(pg_temp.item((select answer from all_a1), 'x5') -> 'account', '{"scope": "brand", "bank_name": "Ngân hàng chung", "account_tail": "3210"}'::jsonb,
  'the brand-wide account, for an owner with every store');
select is(pg_temp.item((select answer from all_a1), 'x6') -> 'account', '{"scope": "brand", "bank_name": null, "account_tail": null}'::jsonb,
  'the brand''s wallet: brand-wide, no bank');
select is(pg_temp.item(pg_temp.list((select manager_a2_u from fx), (select store_a2 from fx), null), 'x9') -> 'account',
  '{"scope": "brand", "bank_name": "Ngân hàng chung", "account_tail": "3210"}'::jsonb,
  'money of store A2, which has no account of its own, says it went to the brand''s account');
select ok(position('0123456789' in (select answer::text from all_a1)) = 0 and position('9876543210' in (select answer::text from all_a1)) = 0
  and position('1111222233' in (select answer::text from all_a1)) = 0 and position('CUA HANG MAU' in (select answer::text from all_a1)) = 0
  and position('THUONG HIEU MAU' in (select answer::text from all_a1)) = 0,
  'no full account number and no account name in the answer');

-- 4. Security --------------------------------------------------------------------------------------------------------

select is(pg_temp.names(pg_temp.list((select manager_u from fx), (select store_a1 from fx), null)), 'x8, x4, x3, x2, x1',
  'the manager of A1 still does not read the brand-wide money no store took (ADR-068 unchanged)');
select is(pg_temp.names(pg_temp.list((select manager_all_u from fx), (select store_a1 from fx), 'open')), 'x8, x6, x5',
  'a manager of every store does');
select is(pg_temp.list((select manager_u from fx), (select store_a2 from fx), 'resolved') ->> 'error', '42501', 'the manager of A1 is refused store A2 (IDOR)');
select is(pg_temp.list((select manager_a2_u from fx), (select store_a1 from fx), 'resolved') ->> 'error', '42501', 'and the manager of A2 store A1');
select is(pg_temp.list((select owner_b_u from fx), (select store_a1 from fx), 'resolved') ->> 'error', '42501', 'another tenant''s owner is refused');
select ok(pg_temp.names(pg_temp.list((select owner_b_u from fx), (select store_b1 from fx), null)) = 'x7'
  and position('Ngân hàng mẫu' in pg_temp.list((select owner_b_u from fx), (select store_b1 from fx), null)::text) = 0,
  'and reads only its own money, with its own account');
select is(pg_temp.list((select staff_u from fx), (select store_a1 from fx), 'resolved') ->> 'error', '42501', 'staff are refused (managers only)');
select is(pg_temp.list(null, (select store_a1 from fx), 'resolved') ->> 'error', '42501', 'so is a call without a session');
select ok(not has_function_privilege('anon', 'app.manager_payment_exceptions(uuid, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.manager_payment_exceptions(uuid, text, integer)', 'execute')
  and not has_function_privilege('service_role', 'app.manager_payment_exceptions(uuid, text, integer)', 'execute'),
  'no API role executes the app function');
select ok(has_function_privilege('authenticated', 'public.manager_payment_exceptions(uuid, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.manager_payment_exceptions(uuid, text, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.manager_payment_exceptions(uuid, text, integer)', 'execute'),
  'only authenticated executes the RPC');

-- Through the RPC as PostgREST calls it (the role authenticated with the person's claims).
create function pg_temp.rpc(p_user uuid, p_status text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v := public.manager_payment_exceptions((select store_a1 from fx), p_status, 50);
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
grant select on fx to authenticated;
select is(jsonb_array_length(pg_temp.rpc((select manager_u from fx), 'resolved') -> 'exceptions'), 4, 'the RPC takes resolved for a manager');
select is(pg_temp.rpc((select staff_u from fx), 'resolved') ->> 'error', '42501', 'and refuses staff');

select * from finish();
rollback;
