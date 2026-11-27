-- The native till, step 2 (native-till.md section 4, ADR-058 section 4, threat S7): signed table QR codes and staff
-- calls. Techniques: equivalence partitions of tokens (current, rotated, inactive, another store's, another tenant's,
-- malformed) with one identical refusal for every miss; boundary values of the guessing limits (10th and 11th miss of a
-- caller, 50th and 51st of a store, the lock's end) and of the call limit (6th and 7th call); state transitions of a
-- table's QR (issued -> rotated -> deactivated -> reactivated) and of a call (open -> repeated -> answered -> reopened);
-- authorisation by role and scope; error guessing on the stored secrets (no API role reads the key or the hash).
begin;
select plan(71);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000026201'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000026202'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000026201'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000026202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000026201'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000026202'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000026203'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026201'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026202'::uuid as brand_b,
  '99999999-9999-4999-8999-000000026201'::uuid as app_a,
  '99999999-9999-4999-8999-000000026202'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000026201'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000026202'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000026203'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000026204'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000026205'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000026206'::uuid as owner_b_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

create function pg_temp.as_user(p_user uuid, p_statement text, p_customer_tenant uuid default null)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_rows integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', case when p_customer_tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', p_customer_tenant) end)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    if p_statement ~* '^\s*select' then
      execute p_statement into v_value;
      v_value := coalesce(v_value, 'null');
    else
      execute p_statement;
      get diagnostics v_rows = row_count;
      v_value := 'rows:' || v_rows;
    end if;
  exception when others then
    v_value := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_value;
end;
$$;

-- A customer's call of an app half at a fixed instant (claims set, role kept), answering the JSON or the SQLSTATE.
create function pg_temp.customer(p_n integer, p_call text, p_store text, p_token text, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ('eeeeeeee-eeee-4eee-8eee-0000000263' || lpad(p_n::text, 2, '0'))::uuid, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', case when p_n >= 90 then (select tenant_b from fx) else (select tenant_a from fx) end))::text, true);
  begin
    execute format('select app.%I(%L, %L, %L)::text', p_call, p_store, p_token, p_at) into v_value;
  exception when others then
    v_value := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_value;
end;
$$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-262-' || right(u.id::text, 4) || '@example.com', u.meta
from fx cross join lateral (
  select x.id, '{}'::jsonb as meta from (values (fx.owner_u), (fx.manager_a1_u), (fx.staff_u), (fx.staff_a2_u), (fx.viewer_u), (fx.owner_b_u)) as x (id)
  union all
  select ('eeeeeeee-eeee-4eee-8eee-0000000263' || lpad(n::text, 2, '0'))::uuid, jsonb_build_object('kind', 'customer', 'tenant_id', case when n >= 90 then fx.tenant_b else fx.tenant_a end)
  from (select generate_series(1, 7) as n union all select 90) g
) as u (id, meta);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-262-a', 'Native 262 A' from fx union all
select tenant_b, 'native-262-b', 'Native 262 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-262-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-262-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'n262-a1', 'sa-1', 'Synthetic store A1' from fx union all
select store_a2, tenant_a, account_a, 'n262-a2', 'sa-2', 'Synthetic store A2' from fx union all
select store_b1, tenant_b, account_b, 'n262-b1', 'sb-1', 'Synthetic store B1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_a1_u, 'manager', array[fx.store_a1]), (fx.staff_u, 'staff', array[fx.store_a1]),
  (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-262-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-262-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'customer', '9999999999262', true, 'Synthetic shop', 'Quán', 'Shop', '#FFFFFF', '#000000', 'black', 'white' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-262-' || n, ('eeeeeeee-eeee-4eee-8eee-0000000263' || lpad(n::text, 2, '0'))::uuid from fx, generate_series(1, 7) as n
union all
select tenant_b, app_b, 'syn-zalo-262-90', 'eeeeeeee-eeee-4eee-8eee-000000026390'::uuid from fx;

insert into public.store_tables (id, tenant_id, store_id, label, area, sort_order)
select v.id, fx.tenant_a, v.store, v.label, v.area, v.sort
from fx cross join lateral (values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000026201'::uuid, fx.store_a1, 'Sofa 1', 'Tầng 1', 10),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000026202'::uuid, fx.store_a1, 'Cửa sổ 2', 'Tầng 2', 20),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000026203'::uuid, fx.store_a2, 'Bàn 1', null, 10)
) as v (id, store, label, area, sort);
insert into public.store_tables (id, tenant_id, store_id, label)
select 'aaaaaaaa-aaaa-4aaa-8aaa-000000026209'::uuid, tenant_b, store_b1, 'Bàn B' from fx;
create temp table tok as
select t.id, t.label, app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token from public.store_tables t
where t.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
create function pg_temp.token(p_label text) returns text language sql as $$ select token from tok where label = p_label $$;

-- 1. The secrets stay in the database ------------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'app.table_qr_keys', 'select') and not has_table_privilege('service_role', 'app.table_qr_keys', 'select')
  and not has_table_privilege('anon', 'app.table_qr_keys', 'select'),
  'no API role reads the table QR keys'
);
select ok(
  not has_column_privilege('authenticated', 'public.store_tables', 'qr_token_sha256', 'select')
  and not has_column_privilege('authenticated', 'public.store_tables', 'qr_version', 'update')
  and not has_column_privilege('authenticated', 'public.store_tables', 'qr_token_sha256', 'insert'),
  'no client reads the token hash or writes the QR columns'
);
select is((select count(*)::int from app.table_qr_keys where tenant_id in (select tenant_a from fx union all select tenant_b from fx)), 2, 'a key per tenant, made at its first table');
select is((select octet_length(key) from app.table_qr_keys where tenant_id = (select tenant_a from fx)), 32, 'each key is 32 bytes');

-- 2. Token derivation ------------------------------------------------------------------------------------------------
select is(
  pg_temp.token('Sofa 1'),
  rtrim(translate(encode(substring(extensions.hmac(convert_to('table:aaaaaaaa-aaaa-4aaa-8aaa-000000026201:1', 'UTF8'),
    (select key from app.table_qr_keys where tenant_id = (select tenant_a from fx)), 'sha256') from 1 for 16), 'base64'), '+/', '-_'), '='),
  'the token is base64url of the first 16 bytes of HMAC-SHA-256 over table:<id>:<version>'
);
select ok(pg_temp.token('Sofa 1') ~ '^[A-Za-z0-9_-]{22}$', 'a token is 22 URL-safe characters');
select is((select qr_token_sha256 from public.store_tables where label = 'Sofa 1'), encode(extensions.digest(pg_temp.token('Sofa 1'), 'sha256'), 'hex'), 'only the SHA-256 of the token is stored');
select isnt(
  app.table_qr_token((select tenant_a from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000026201', 1),
  app.table_qr_token((select tenant_b from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000026201', 1),
  'two tenants give different tokens for the same table and version'
);
select isnt(app.table_qr_token((select tenant_a from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000026201', 2), pg_temp.token('Sofa 1'), 'another version gives another token');

-- 3. The lookup and its identical refusals -------------------------------------------------------------------------
select is(pg_temp.customer(1, 'customer_table', 'sa-1', pg_temp.token('Sofa 1'), (select noon from fx))::jsonb, '{"state": "ok", "table": {"area": "Tầng 1", "label": "Sofa 1"}}'::jsonb, 'the current token names its table and area, nothing else');
create temp table refusals as
select v.kind, pg_temp.customer(2, 'customer_table', 'sa-1', v.token, (select noon from fx)) as answer
from (values
  ('unknown', 'AAAAAAAAAAAAAAAAAAAAAA'),
  ('another store', pg_temp.token('Bàn 1')),
  ('another tenant', pg_temp.token('Bàn B'))
) as v (kind, token);
select is((select count(distinct answer)::int from refusals), 1, 'an unknown token, another store''s and another tenant''s answer alike');
select is((select answer from refusals limit 1)::jsonb, '{"state": "refused", "refusal": "table_unknown"}'::jsonb, 'the one refusal is table_unknown, without detail');
select is(pg_temp.customer(2, 'customer_table', 'sa-1', 'not a token!', (select noon from fx)), '22023', 'a malformed token is 22023');
select is(pg_temp.customer(2, 'customer_table', 'sa-1', repeat('A', 65), (select noon from fx)), '22023', 'a token of 65 characters is 22023');
select is(pg_temp.customer(2, 'customer_table', 'sb-1', pg_temp.token('Bàn B'), (select noon from fx)), '22023', 'a store of another brand is 22023');
select is((pg_temp.customer(90, 'customer_table', 'sb-1', pg_temp.token('Bàn B'), (select noon from fx))::jsonb) ->> 'state', 'ok', 'the other tenant''s customer finds its own table');
select is(pg_temp.as_user((select owner_u from fx), format($$select public.customer_table('sa-1', %L)::text$$, pg_temp.token('Sofa 1'))), '42501', 'a member of the tenant is not a customer session');
select is(
  (pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000026301', format($$select public.customer_table('sa-1', %L)::text$$, pg_temp.token('Sofa 1')), (select tenant_a from fx))::jsonb) ->> 'state',
  'ok', 'the public RPC answers a customer session'
);

-- 4. Rotation, deactivation and reactivation -----------------------------------------------------------------------
select is(pg_temp.as_user((select staff_u from fx), $$select public.rotate_table_qr('aaaaaaaa-aaaa-4aaa-8aaa-000000026201')::text$$), '42501', 'staff cannot rotate a QR code');
select is(pg_temp.as_user((select owner_b_u from fx), $$select public.rotate_table_qr('aaaaaaaa-aaaa-4aaa-8aaa-000000026201')::text$$), '42501', 'another tenant''s owner cannot rotate it');
create temp table rotated as select pg_temp.as_user((select manager_a1_u from fx), $$select public.rotate_table_qr('aaaaaaaa-aaaa-4aaa-8aaa-000000026201')::text$$)::jsonb as r;
select is((select (r ->> 'qr_version')::int from rotated), 2, 'a manager of the store rotates the code to version 2');
select is((select qr_token_sha256 from public.store_tables where label = 'Sofa 1'), app.table_qr_hash((select r ->> 'token' from rotated)), 'the stored hash is the new token''s');
select is(pg_temp.customer(3, 'customer_table', 'sa-1', pg_temp.token('Sofa 1'), (select noon from fx)), '{"state": "refused", "refusal": "table_unknown"}', 'the old printed card is refused at once, like any miss');
select is((pg_temp.customer(3, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb) ->> 'state', 'ok', 'the new card works');
select is((select r ->> 'link' from rotated), 'https://zalo.me/s/9999999999262/?store=sa-1&src=table&t=' || (select r ->> 'token' from rotated), 'the link opens the brand''s customer Mini App at the store with the table token');
update public.store_tables set active = false where label = 'Cửa sổ 2';
select is(pg_temp.customer(3, 'customer_table', 'sa-1', pg_temp.token('Cửa sổ 2'), (select noon from fx)), '{"state": "refused", "refusal": "table_unknown"}', 'a deactivated table''s card is refused');
select is(pg_temp.as_user((select owner_u from fx), $$select public.rotate_table_qr('aaaaaaaa-aaaa-4aaa-8aaa-000000026202')::text$$), '22023', 'an inactive table has no code to rotate');
update public.store_tables set active = true where label = 'Cửa sổ 2';
select is((select qr_version from public.store_tables where label = 'Cửa sổ 2'), 2, 'reactivating a table issues a new version');
select is(pg_temp.customer(3, 'customer_table', 'sa-1', pg_temp.token('Cửa sổ 2'), (select noon from fx)), '{"state": "refused", "refusal": "table_unknown"}', 'reactivation never revives the old printed card');
select throws_ok($$update public.store_tables set qr_version = 1 where label = 'Sofa 1'$$, '22023', null, 'a version never goes back');
select throws_ok($$update public.store_tables set store_id = 'ffffffff-ffff-4fff-8fff-000000026202' where label = 'Sofa 1'$$, '22023', null, 'a table keeps its store');

-- 5. Labels, areas and who writes tables ---------------------------------------------------------------------------
select throws_ok($$insert into public.store_tables (tenant_id, store_id, label) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026201', 'sofa 1')$$, '23505', null, 'two active tables of a store cannot share a name in any case');
select lives_ok($$insert into public.store_tables (tenant_id, store_id, label) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026202', 'Sofa 1')$$, 'another store may use the name');
select lives_ok($$insert into public.store_tables (tenant_id, store_id, label, area) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026201', repeat('l', 20), repeat('a', 40))$$, 'a label of 20 and an area of 40 characters are kept');
select throws_ok($$insert into public.store_tables (tenant_id, store_id, label) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026201', repeat('l', 21))$$, '23514', null, 'a label of 21 characters is refused');
select throws_ok($$insert into public.store_tables (tenant_id, store_id, label, area) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026201', 'Sân 1', repeat('a', 41))$$, '23514', null, 'an area of 41 characters is refused');
select is(pg_temp.as_user((select manager_a1_u from fx), $$insert into public.store_tables (tenant_id, store_id, label) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026201', 'Sân 2')$$), 'rows:1', 'a manager adds a table at its store');
select is(pg_temp.as_user((select manager_a1_u from fx), $$insert into public.store_tables (tenant_id, store_id, label) values ('dddddddd-dddd-4ddd-8ddd-000000026201', 'ffffffff-ffff-4fff-8fff-000000026202', 'Sân 3')$$), '42501', 'a store-limited manager adds no table at another store');
select is(pg_temp.as_user((select manager_a1_u from fx), $$update public.store_tables set qr_version = 9 where label = 'Sân 2'$$), '42501', 'the QR version is not writable by a client');
select is(pg_temp.as_user((select staff_u from fx), 'select count(*) from public.store_tables'), '0', 'staff read no table directly');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(*) from public.store_tables where tenant_id = ''dddddddd-dddd-4ddd-8ddd-000000026201'''), '6', 'a viewer reads the tables');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(qr_token_sha256) from public.store_tables'), '42501', 'nobody selects the token hash');

-- 6. Printing the links ---------------------------------------------------------------------------------------------
select is(pg_temp.as_user((select staff_u from fx), format($$select public.table_qr_links(%L)::text$$, (select store_a1 from fx))), '42501', 'staff cannot print table codes');
select is(pg_temp.as_user((select manager_a1_u from fx), format($$select public.table_qr_links(%L)::text$$, (select store_a2 from fx))), '42501', 'a manager of another store cannot print them');
create temp table links as select pg_temp.as_user((select manager_a1_u from fx), format($$select public.table_qr_links(%L)::text$$, (select store_a1 from fx)))::jsonb as r;
select is((select r ->> 'mini_app_id' from links), '9999999999262', 'the links name the brand''s customer Mini App');
select is(
  (select count(*)::int from links, jsonb_array_elements(r -> 'tables') t where t ->> 'link' = 'https://zalo.me/s/9999999999262/?store=sa-1&src=table&t=' || (t ->> 'token') and app.table_qr_hash(t ->> 'token') = (select s.qr_token_sha256 from public.store_tables s where s.id = (t ->> 'id')::uuid)),
  (select count(*)::int from public.store_tables where store_id = (select store_a1 from fx) and active),
  'every active table gets a link whose token matches its stored hash'
);
create temp table links_b as select pg_temp.as_user((select owner_b_u from fx), format($$select public.table_qr_links(%L)::text$$, (select store_b1 from fx)))::jsonb as r;
select is((select (r ->> 'missing') || '/' || coalesce(r -> 'tables' -> 0 ->> 'link', 'null') from links_b), 'customer_mini_app/null', 'without a customer Mini App the links say what is missing');

-- 7. The guessing limits: 10 misses per caller, 50 per store, 15 minutes -------------------------------------------
create function pg_temp.misses(p_n integer, p_count integer, p_at timestamptz) returns void language plpgsql as $$
begin
  for i in 1..p_count loop
    perform pg_temp.customer(p_n, 'customer_table', 'sa-1', 'MISSMISSMISSMISSMISS' || lpad(i::text, 2, '0'), p_at);
  end loop;
end;
$$;
delete from app.code_attempts where tenant_id = (select tenant_a from fx);
select pg_temp.misses(4, 9, (select noon from fx));
select is((pg_temp.customer(4, 'customer_table', 'sa-1', 'MISSMISSMISSMISSMISS10', (select noon from fx))::jsonb) ->> 'refusal', 'table_unknown', 'the 10th miss of a caller is still answered');
select is((pg_temp.customer(4, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb) ->> 'refusal', 'rate_limited', 'the 11th call of that caller is locked, even with a valid token');
select is(
  (pg_temp.customer(4, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb ->> 'retry_at')::timestamptz,
  (select noon from fx) + interval '15 minutes', 'the lock lasts 15 minutes'
);
select is((pg_temp.customer(5, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb) ->> 'state', 'ok', 'another caller is not locked by one caller''s misses');
select is((pg_temp.customer(4, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx) + interval '15 minutes')::jsonb) ->> 'state', 'ok', 'at the lock''s end the caller is answered again');
select ok(exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'code_guessing_lockout'), 'a lockout raises the code_guessing_lockout alert');
delete from app.code_attempts where tenant_id = (select tenant_a from fx);
select pg_temp.misses(n, 10, (select noon from fx)) from generate_series(1, 4) as n;
select pg_temp.misses(5, 9, (select noon from fx));
select is((pg_temp.customer(6, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb) ->> 'state', 'ok', 'after 49 misses at the store a fresh caller is answered');
select pg_temp.misses(5, 1, (select noon from fx));
select is((pg_temp.customer(6, 'customer_table', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb) ->> 'refusal', 'rate_limited', 'after the 50th miss at the store every caller is locked');
select is((pg_temp.customer(6, 'customer_table', 'sa-2', pg_temp.token('Bàn 1'), (select noon from fx))::jsonb) ->> 'state', 'ok', 'another store of the tenant is not locked');
delete from app.code_attempts where tenant_id = (select tenant_a from fx);

-- 8. Staff calls ---------------------------------------------------------------------------------------------------
create temp table call_1 as select pg_temp.customer(1, 'customer_call_staff', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx))::jsonb as r;
select is((select (r ->> 'state') || '/' || (r ->> 'replayed') from call_1), 'calling/false', 'a customer calls staff to the table');
select is((pg_temp.customer(2, 'customer_call_staff', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx) + interval '10 seconds')::jsonb) ->> 'replayed', 'true', 'a second call of the table answers the open call');
select is((select count(*)::int from public.table_calls where table_id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000026201'), 1, 'one open call per table');
select is(pg_temp.customer(1, 'customer_call_staff', 'sa-1', 'AAAAAAAAAAAAAAAAAAAAAA', (select noon from fx)), '{"state": "refused", "refusal": "table_unknown"}', 'a call with an unknown token is refused like a lookup');
create temp table map_1 as select pg_temp.as_user((select staff_u from fx), format($$select public.counter_table_map(%L)::text$$, (select store_a1 from fx)))::jsonb as r;
select ok((select t -> 'call' ->> 'id' from map_1, jsonb_array_elements(r -> 'tables') t where t ->> 'label' = 'Sofa 1') is not null, 'the table map shows the open call');
select is(pg_temp.as_user((select staff_a2_u from fx), format($$select public.counter_table_map(%L)::text$$, (select store_a1 from fx))), '42501', 'staff of another store read no table map');
create temp table call_id as select (t -> 'call' ->> 'id')::uuid as id from map_1, jsonb_array_elements(r -> 'tables') t where t ->> 'label' = 'Sofa 1';
select is(pg_temp.as_user((select staff_a2_u from fx), format($$select public.counter_ack_call(%L)::text$$, (select id from call_id))), '42501', 'staff of another store cannot answer the call');
select is((pg_temp.as_user((select staff_u from fx), format($$select public.counter_ack_call(%L)::text$$, (select id from call_id)))::jsonb) ->> 'replayed', 'false', '"Tới ngay" answers the call');
select is((select acknowledged_by from public.table_calls where id = (select id from call_id)), (select staff_u from fx), 'the answer records who came');
select is((pg_temp.as_user((select staff_u from fx), format($$select public.counter_ack_call(%L)::text$$, (select id from call_id)))::jsonb) ->> 'replayed', 'true', 'answering twice is a replay');
select is((pg_temp.customer(1, 'customer_call_staff', 'sa-1', (select r ->> 'token' from rotated), (select noon from fx) + interval '1 minute')::jsonb) ->> 'replayed', 'false', 'after the answer the table can call again');
-- The call limit: 6 new calls of a customer in 15 minutes; the 7th is refused.
create function pg_temp.call_and_answer(p_n integer, p_at timestamptz) returns text language plpgsql as $$
declare
  v_answer text := pg_temp.customer(p_n, 'customer_call_staff', 'sa-1', (select r ->> 'token' from rotated), p_at);
begin
  update public.table_calls set acknowledged_at = p_at + interval '1 second' where table_id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000026201' and acknowledged_at is null;
  return v_answer;
end;
$$;
delete from app.code_attempts where tenant_id = (select tenant_a from fx);
update public.table_calls set acknowledged_at = (select noon from fx) + interval '2 minutes' where acknowledged_at is null;
select pg_temp.call_and_answer(7, (select noon from fx) + make_interval(mins => 3 + n)) from generate_series(1, 5) as n;
select is((pg_temp.call_and_answer(7, (select noon from fx) + interval '9 minutes')::jsonb) ->> 'state', 'calling', 'the 6th call of a customer in 15 minutes goes through');
select is((pg_temp.call_and_answer(7, (select noon from fx) + interval '10 minutes')::jsonb) ->> 'refusal', 'rate_limited', 'the 7th is refused');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(*) from public.table_calls'), '8', 'a viewer reads the calls');
select is(pg_temp.as_user((select staff_u from fx), 'select count(*) from public.table_calls'), '0', 'staff read calls only through the table map');

select * from finish();
rollback;
