-- Security test design: session and JWT spoofing (OWASP API2 broken authentication, ASVS V3 and V4). A customer
-- session is the JWT zalo-session mints: app_metadata kind customer, tenant_id and customer_id, for the customer's own
-- login in app.customer_logins. Every forged or inconsistent combination must be refused by the customer RPCs
-- (42501) and must read no customer row through row-level security: claims naming another customer or tenant, a
-- customer claim on a member's login, another kind, missing claims, a disabled Zalo App, an erased customer, and
-- staff and customer sessions calling each other's functions.
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012201'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012202'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012201'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012201'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012202'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012203'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012201'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012202'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012201'::uuid as app_a,
  '99999999-9999-4999-8999-000000012202'::uuid as app_b,
  '77777777-7777-4777-8777-000000012201'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012201'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012202'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012201'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012202'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012203'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012204'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012205'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012206'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012207'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012208'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012209'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012210'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012211'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012212'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012213'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012214'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-spoofing-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-spoofing-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-spoofing-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-spoofing-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-spoofing-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm122-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm122-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm122-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_u, 'owner', null::uuid[]), (fx.owner_a1_u, 'owner', array[fx.store_a1]),
    (fx.manager_u, 'manager', null::uuid[]), (fx.manager_a1_u, 'manager', array[fx.store_a1]),
    (fx.viewer_u, 'viewer', null::uuid[]), (fx.staff_u, 'staff', array[fx.store_a1]),
    (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.publisher_u, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select fx.tenant_b, fx.owner_b_u, 'owner', null from fx;
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_a, 'Nhân viên A1', 'staff'::public.tenant_role, array[store_a1], 'active', staff_u, now() - interval '1 day' from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx
union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-matrix-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx
union all
select app_b, tenant_b, brand_b, 'synthetic-matrix-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-matrix-oa-a', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme A', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select programme_b, tenant_b, 'Synthetic programme B', date '2026-01-01', 'below_threshold', 'active' from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-122-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012201', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012202', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012203', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-122-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-122-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-122-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-122-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-122-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-122-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-122-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm122-inv-a1', '0900012201'), (fx.store_a2, 'sm122-inv-a2', '0900012202')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm122-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm122-inv-a2';
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, pending, occurred_at)
select fx.tenant_a, fx.programme_a, (select id from ids where name = v.member), v.store, 'earn', 1, 6, (select id from ids where name = v.invoice),
  app.store_business_date(v.store, now() - interval '3 hours'), 'A', false, now() - interval '2 hours'
from fx cross join lateral (values ('m_a1', fx.store_a1, 'i_a1'), ('m_a2', fx.store_a2, 'i_a2')) as v (member, store, invoice);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_a, store_a1, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_a, store_a1, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, status)
select tenant_a, programme_a, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 1, 0, array[store_a1], 'active'::public.coupon_status from fx;
insert into ids select 'coupon', id from public.coupons where tenant_id = (select tenant_a from fx);
do $$ begin perform app.redeem_coupon((select id from ids where name = 'm_a1'), (select id from ids where name = 'coupon'), (select store_a1 from fx), now() - interval '10 minutes'); end $$;
insert into ids select 'redemption', id from public.redemptions where membership_id = (select id from ids where name = 'm_a1');

insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, matched_path, candidate_invoice_ids, reason, created_at)
select tenant_a, store_a1, (select id from ids where name = 'm_a1'), (select id from ids where name = 'redemption'), 'D', '{}'::uuid[], 'verified_without_invoice', now() - interval '5 minutes' from fx;
insert into ids select 'queue_item', id from public.loyalty_queue where tenant_id = (select tenant_a from fx);
insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, reason, requested_by)
select tenant_a, store_a1, (select id from ids where name = 'm_a1'), 'dispute', 'synthetic dispute', staff_u from fx;
insert into ids select 'loyalty_request', id from app.loyalty_requests where tenant_id = (select tenant_a from fx);
insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type)
select tenant_a, 'customer', (select id from ids where name = 'c_a2'), 'mini_app', 'deletion' from fx;
insert into ids select 'dsr', id from public.data_subject_requests where tenant_id = (select tenant_a from fx);
insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status)
select tenant_a, 'zalo_bot'::public.channel_kind, 'zalo_bot', 'Zalo Bot', staff_u, 'NOTIFY_ZALO_BOT_TOKEN', 'pending' from fx;
insert into ids select 'channel_staff', id from public.notification_channels where tenant_id = (select tenant_a from fx) and user_id = (select staff_u from fx);

-- The callers. A customer session carries the claims zalo-session mints: app_metadata kind, tenant_id, customer_id.
create temp table callers (name text primary key, role text not null, claims jsonb);
insert into callers (name, role, claims)
select 'anon', 'anon', '{"role": "anon"}'::jsonb
union all
select 'service', 'service_role', '{"role": "service_role"}'::jsonb
union all
select c.name, 'authenticated', jsonb_build_object('sub', c.id, 'role', 'authenticated')
from fx cross join lateral (
  values ('owner', fx.owner_u), ('owner_a1', fx.owner_a1_u), ('manager', fx.manager_u), ('manager_a1', fx.manager_a1_u),
         ('viewer', fx.viewer_u), ('staff', fx.staff_u), ('staff_a2', fx.staff_a2_u), ('publisher', fx.publisher_u),
         ('owner_b', fx.owner_b_u), ('outsider', fx.outsider_u)
) as c (name, id)
union all
select c.name, 'authenticated', jsonb_build_object('sub', c.id, 'role', 'authenticated',
  'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', c.tenant, 'customer_id', c.customer))
from fx cross join lateral (
  values ('customer', fx.customer_u, fx.tenant_a, (select id from ids where name = 'c_a1')),
         ('visitor', fx.visitor_u, fx.tenant_a, null::uuid),
         ('customer_b', fx.customer_b_u, fx.tenant_b, (select id from ids where name = 'c_b'))
) as c (name, id, tenant, customer);

-- Placeholders that statements name as {name}; replaced with literals before the role switch.
create temp table ph (name text primary key, value text not null);
insert into ph
select 'tenant_a', tenant_a::text from fx union all
select 'tenant_b', tenant_b::text from fx union all
select 'store_a1', store_a1::text from fx union all
select 'store_a2', store_a2::text from fx union all
select 'store_b1', store_b1::text from fx union all
select 'app_a', app_a::text from fx union all
select 'hold_code', (select code from public.redemptions where id = (select id from ids where name = 'redemption'))
union all
select name, id::text from ids;

-- The outcome of one statement as one caller: ok:<first column> or error:<SQLSTATE>; always rolled back.
create function pg_temp.fill(p_statement text)
returns text
language plpgsql
as $$
declare
  v_out text := p_statement;
  v_ph record;
begin
  for v_ph in select name, value from ph loop
    v_out := replace(v_out, '{' || v_ph.name || '}', v_ph.value);
  end loop;
  if v_out ~ '\{[a-z_0-9]+\}' then
    raise exception 'unknown placeholder in %', p_statement;
  end if;
  return v_out;
end;
$$;

create function pg_temp.run_as(p_caller text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_caller callers;
  v_sql text := pg_temp.fill(p_statement);
  v_value text;
begin
  select * into strict v_caller from callers where name = p_caller;
  begin
    perform set_config('request.jwt.claims', v_caller.claims::text, true);
    perform set_config('role', v_caller.role, true);
    execute v_sql into v_value;
    v_value := 'ok:' || coalesce(v_value, 'null');
    raise exception using errcode = 'P0099', message = v_value;
  exception when others then
    if sqlstate = 'P0099' then
      v_value := sqlerrm;
    else
      v_value := 'error:' || sqlstate;
    end if;
  end;
  return v_value;
end;
$$;

-- Expected outcomes: OK (any answer), DENY (42501), BAD (22023), EMPTY (no row, an empty list or null), or a regex.
create function pg_temp.expected(p_token text)
returns text
language sql
immutable
as $$
  select case p_token
    when 'OK' then '^ok:'
    when 'DENY' then '^error:42501$'
    when 'BAD' then '^error:22023$'
    when 'EMPTY' then '^ok:(0|null|\[\]|f|false)$'
    when 'GATE' then '^(ok:|error:(?!42501))'
    else p_token
  end;
$$;

create function pg_temp.run_claims(p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_sql text := pg_temp.fill(p_statement);
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    perform set_config('role', 'authenticated', true);
    execute v_sql into v_value;
    v_value := 'ok:' || coalesce(v_value, 'null');
    raise exception using errcode = 'P0099', message = v_value;
  exception when others then
    if sqlstate = 'P0099' then
      v_value := sqlerrm;
    else
      v_value := 'error:' || sqlstate;
    end if;
  end;
  return v_value;
end;
$$;

-- The probes: two customer RPCs and the rows a customer session reads through RLS. A refused session answers
-- 42501 to the RPCs and reads no customer row, membership, ledger row, stamp, check-in, claim, redemption or balance.
create temp table probes (name text primary key, statement text not null, refused text not null);
insert into probes values
  ('customer_wallet', $$select public.customer_wallet() ->> 'claims_per_day'$$, '^error:42501$'),
  ('customer_vouchers', $$select count(*) from public.customer_vouchers()$$, '^error:42501$'),
  ('rows', $$select concat_ws(',',
      (select count(*) from public.customers), (select count(*) from public.memberships), (select count(*) from public.loyalty_ledger),
      (select count(*) from public.stamps), (select count(*) from public.pending_checkins), (select count(*) from public.receipt_claims),
      (select count(*) from public.redemptions), (select count(*) from public.loyalty_balance('{m_a1}')), (select count(*) from public.loyalty_balance('{m_a2}')),
      (select count(*) from public.loyalty_balance('{m_b}')))$$, '^ok:0,0,0,0,0,0,0,0,0,0$');

create function pg_temp.meta(p_kind text, p_tenant uuid, p_customer text)
returns jsonb
language sql
as $$
  select jsonb_build_object('kind', p_kind, 'tenant_id', p_tenant, 'customer_id', p_customer);
$$;

create temp table spoofs (name text primary key, claims jsonb not null);
insert into spoofs
select 'a customer login naming another customer of its tenant',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a2'))) from fx
union all
select 'a customer login naming its own customer under another tenant',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_b, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'a customer login naming another tenant and its customer',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_b, (select id::text from ids where name = 'c_b'))) from fx
union all
select 'a visitor login naming a joined customer',
  jsonb_build_object('sub', visitor_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'a staff login with customer claims',
  jsonb_build_object('sub', staff_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'an owner login with customer claims',
  jsonb_build_object('sub', owner_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'an outsider login with customer claims',
  jsonb_build_object('sub', outsider_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'customer claims without a subject',
  jsonb_build_object('role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'the customer''s claims with kind ' || k.kind,
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta(k.kind, tenant_a, (select id::text from ids where name = 'c_a1')))
from fx cross join (values ('Customer'), ('customer '), ('staff'), ('member'), ('')) as k (kind)
union all
select 'the customer''s claims with the kind as a list',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', jsonb_build_object('kind', jsonb_build_array('customer'), 'tenant_id', tenant_a, 'customer_id', (select id from ids where name = 'c_a1'))) from fx
union all
select 'the customer''s claims without a kind',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', jsonb_build_object('tenant_id', tenant_a, 'customer_id', (select id from ids where name = 'c_a1'))) from fx
union all
select 'the customer''s claims without a tenant',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', jsonb_build_object('kind', 'customer', 'customer_id', (select id from ids where name = 'c_a1'))) from fx
union all
select 'the customer''s claims with a malformed customer id',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, 'not-a-uuid'' or ''1''=''1')) from fx
union all
select 'the customer''s claims in user_metadata instead of app_metadata',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'user_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'the customer''s claims without any metadata',
  jsonb_build_object('sub', customer_u, 'role', 'authenticated') from fx
union all
select 'the customer''s claims claiming the service role',
  jsonb_build_object('sub', customer_u, 'role', 'service_role', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a2'))) from fx;

-- A customer login that is also a member, the session of a disabled Zalo App, and an erased customer's session.
create temp table later_spoofs (name text primary key, setup text not null, claims jsonb not null);
insert into later_spoofs
select 'a customer login that also has a tenant_members row',
  format('insert into public.tenant_members (tenant_id, user_id, role) values (%L, %L, ''viewer'')', tenant_b, customer_u),
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'the session of a Zalo App the owner disabled',
  format('update public.zalo_apps set status = ''disabled'' where id = %L', app_a),
  jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) from fx
union all
select 'the session of a customer erased since',
  format('select public.dsr_delete(%L)', (select id from ids where name = 'dsr')),
  jsonb_build_object('sub', customer_2_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a2'))) from fx;

create function pg_temp.after(p_setup text, p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    if p_setup like 'select public.dsr_delete%' then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_u from fx), 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      execute p_setup;
      perform set_config('role', 'postgres', true);
    else
      execute p_setup;
    end if;
    v_value := pg_temp.run_claims(p_claims, p_statement);
    raise exception using errcode = 'P0099', message = v_value;
  exception when others then
    if sqlstate = 'P0099' then
      v_value := sqlerrm;
    else
      v_value := 'setup error:' || sqlstate || ' ' || sqlerrm;
    end if;
  end;
  return v_value;
end;
$$;

-- The genuine sessions, as controls: the same probes succeed for the real customer.
create temp table genuine as
select jsonb_build_object('sub', customer_u, 'role', 'authenticated', 'app_metadata', pg_temp.meta('customer', tenant_a, (select id::text from ids where name = 'c_a1'))) as claims
from fx;

select plan(
  (select count(*)::integer from spoofs) * (select count(*)::integer from probes)
  + (select count(*)::integer from later_spoofs) * (select count(*)::integer from probes)
  + 10
);

select matches(pg_temp.run_claims((select claims from genuine), statement),
  case name when 'rows' then '^ok:1,1,3,2,0,0,1,1,0,0$' when 'customer_wallet' then '^ok:3$' else '^ok:1$' end,
  'control: the genuine customer session passes ' || name)
from probes order by name;

-- A forged customer claim adds nothing: the rows probe must read exactly what the same login reads without any
-- customer claim (nothing for a customer login; a member's own rows for a member's login). The probe's answer holds
-- digits and commas only, so it is its own pattern.
create function pg_temp.refused(p_probe text, p_baseline text)
returns text
language sql
as $$
  select case p_probe when 'rows' then '^' || p_baseline || '$' else (select refused from probes where name = p_probe) end;
$$;

select matches(
  pg_temp.run_claims(s.claims, p.statement),
  pg_temp.refused(p.name, pg_temp.run_claims(s.claims - 'app_metadata' - 'user_metadata', p.statement)),
  format('%s: %s refused', s.name, p.name))
from spoofs s cross join probes p order by s.name, p.name;

select matches(
  pg_temp.after(s.setup, s.claims, p.statement),
  pg_temp.refused(p.name, pg_temp.after(s.setup, s.claims - 'app_metadata' - 'user_metadata', p.statement)),
  format('%s: %s refused', s.name, p.name))
from later_spoofs s cross join probes p order by s.name, p.name;

select is(
  pg_temp.run_claims((select claims from spoofs where name = 'a customer login naming another customer of its tenant'), (select statement from probes where name = 'rows')),
  'ok:0,0,0,0,0,0,0,0,0,0',
  'a customer login naming another customer of its tenant reads nothing at all'
);

-- The reverse direction: a customer session is no member, and a member session no customer.
select is(
  pg_temp.run_claims((select claims from genuine), $$select public.staff_member_lookup('{store_a1}', '0900012201') ->> 'found'$$),
  'error:42501', 'a customer session calling a staff function is refused');
select is(
  pg_temp.run_claims((select claims from genuine), $$select count(*) from public.loyalty_members_page(null)$$),
  'error:42501', 'a customer session listing members is refused');
select is(
  pg_temp.run_claims((select claims from genuine), $$select public.my_notifications('{tenant_a}')::text$$),
  'error:42501', 'a customer session reading member notifications is refused');
select is(
  pg_temp.run_claims((select jsonb_build_object('sub', staff_u, 'role', 'authenticated') from fx), $$select public.customer_home()::text$$),
  'error:42501', 'a staff session calling a customer function is refused');
select is(
  pg_temp.run_claims((select jsonb_build_object('sub', owner_u, 'role', 'authenticated') from fx), $$select public.customer_wallet()::text$$),
  'error:42501', 'an owner session calling a customer function is refused');
select is(
  pg_temp.run_claims((select jsonb_build_object('sub', customer_u, 'role', 'service_role') from fx),
    $$select public.zalo_customer_sign_in('{app_a}'::uuid, 'syn-zalo-122-9', null, null)::text$$),
  'error:42501', 'a role claim of service_role does not give an authenticated connection the service RPCs');

select * from finish();
rollback;
