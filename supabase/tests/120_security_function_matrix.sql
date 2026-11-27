-- Security test design: an authorization matrix (ISTQB decision table; OWASP ASVS V4 and API Top 10 API1/API5).
-- Every public function of the loyalty, customer, staff, redemption, notification, OA and Zalo areas is called by
-- every kind of caller, and the outcome must match the documented allow or refuse code (docs/api.md, 3.5, 3.10,
-- 3.19 to 3.24). Each cell runs in its own subtransaction that is rolled back, so a write by one caller never feeds
-- the next. The last tests fail when a public function of these areas exists that the matrix does not name, so a
-- new function cannot ship without its row.
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012002'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012002'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012003'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012001'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012002'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012001'::uuid as app_a,
  '99999999-9999-4999-8999-000000012002'::uuid as app_b,
  '77777777-7777-4777-8777-000000012001'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012001'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012002'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012002'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012003'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012004'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012005'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012006'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012007'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012008'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012009'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012010'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012011'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012012'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012013'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012014'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-matrix-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-matrix-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-matrix-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-matrix-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-matrix-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
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
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-120-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012001', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012002', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012003', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-120-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-120-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-120-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-120-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-120-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-120-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-120-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm-inv-a1', '0900012001'), (fx.store_a2, 'sm-inv-a2', '0900012002')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm-inv-a2';
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
select 'brand_a', brand_a::text from fx union all
select 'brand_b', brand_b::text from fx union all
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

create temp table matrix (
  fn text not null,
  label text primary key,
  statement text not null,
  expect jsonb not null
);

-- Groups of callers used below.
--   data roles of A at A1: owner, owner_a1, manager, manager_a1, viewer, staff
--   members of A: those, staff_a2 and publisher
insert into matrix (fn, label, statement, expect) values
-- 3.20 and 3.22: the customer functions. Only a customer session; a visitor only for customer_home.
('customer_home', 'customer_home',
  $$select (public.customer_home() ? 'programme')::text$$,
  '{"*": "DENY", "customer": "^ok:true$", "visitor": "^ok:true$", "customer_b": "^ok:true$"}'),
('customer_wallet', 'customer_wallet reads only its own card',
  $$select public.customer_wallet() -> 'card' ->> 'phone_masked'$$,
  '{"*": "DENY", "customer": "001$", "customer_b": "003$"}'),
('customer_member_code', 'customer_member_code at A1',
  $$select public.customer_member_code('sa-1') ->> 'store_code'$$,
  '{"*": "DENY", "customer": "^ok:sa-1$", "customer_b": "BAD"}'),
('customer_submit_claim', 'customer_submit_claim at A1',
  $$select (public.customer_submit_claim('sa-1', 'SM-120-1', 60000, null) ->> 'claim_id') is not null$$,
  '{"*": "DENY", "customer": "^ok:true$", "customer_b": "BAD"}'),
('customer_stop_marketing', 'customer_stop_marketing',
  $$select public.customer_stop_marketing() ->> 'marketing_consent'$$,
  '{"*": "DENY", "customer": "^ok:false$", "customer_b": "^ok:false$"}'),
('customer_request_deletion', 'customer_request_deletion',
  $$select (public.customer_request_deletion() ->> 'request_id') is not null$$,
  '{"*": "DENY", "customer": "^ok:true$", "customer_b": "^ok:true$"}'),
('customer_coupons', 'customer_coupons of the session''s programme only',
  $$select count(*) from public.customer_coupons(null)$$,
  '{"*": "DENY", "customer": "^ok:1$", "customer_b": "^ok:0$"}'),
('customer_redeem', 'customer_redeem at A1',
  $$select (public.customer_redeem('{coupon}'::uuid, 'sa-1') ? 'refusal')::text$$,
  '{"*": "DENY", "customer": "^ok:true$", "customer_b": "BAD"}'),
('customer_vouchers', 'customer_vouchers of the session only',
  $$select count(*) from public.customer_vouchers()$$,
  '{"*": "DENY", "customer": "^ok:1$", "customer_b": "^ok:0$"}'),
-- 3.21 and 3.22: the staff functions. Owners, managers and staff whose scope holds the store.
('staff_record_checkin', 'staff_record_checkin at A1',
  $$select public.staff_record_checkin('{store_a1}', '0900012002') ->> 'state'$$,
  '{"*": "DENY", "owner": "OK", "owner_a1": "OK", "manager": "OK", "manager_a1": "OK", "staff": "OK"}'),
('staff_record_checkin', 'staff_record_checkin at A2',
  $$select public.staff_record_checkin('{store_a2}', '0900012001') ->> 'state'$$,
  '{"*": "DENY", "owner": "OK", "manager": "OK", "staff_a2": "OK"}'),
('staff_record_checkin', 'staff_record_checkin at another tenant''s store',
  $$select public.staff_record_checkin('{store_b1}', '0900012003') ->> 'state'$$,
  '{"*": "DENY", "owner_b": "OK"}'),
('staff_member_lookup', 'staff_member_lookup at A1',
  $$select public.staff_member_lookup('{store_a1}', '0900012001') ->> 'found'$$,
  '{"*": "DENY", "owner": "^ok:true$", "owner_a1": "^ok:true$", "manager": "^ok:true$", "manager_a1": "^ok:true$", "staff": "^ok:true$"}'),
('staff_member_lookup', 'staff_member_lookup at A2',
  $$select public.staff_member_lookup('{store_a2}', null, '{m_a2}') ->> 'found'$$,
  '{"*": "DENY", "owner": "^ok:true$", "manager": "^ok:true$", "staff_a2": "^ok:true$"}'),
('staff_request', 'staff_request at A1',
  $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', 'Khách báo thiếu dấu') ->> 'state'$$,
  '{"*": "DENY", "owner": "^ok:pending$", "owner_a1": "^ok:pending$", "manager": "^ok:pending$", "manager_a1": "^ok:pending$", "staff": "^ok:pending$"}'),
('staff_request', 'staff_request for another tenant''s member',
  $$select public.staff_request('{store_a1}', 'dispute', '{m_b}', 'Khách báo thiếu dấu') ->> 'state'$$,
  '{"*": "DENY", "owner": "BAD", "owner_a1": "BAD", "manager": "BAD", "manager_a1": "BAD", "staff": "BAD"}'),
('staff_decide_loyalty_request', 'staff_decide_loyalty_request on staff''s dispute at A1',
  $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused', 'Không đủ căn cứ') ->> 'state'$$,
  '{"*": "DENY", "owner": "^ok:refused$", "owner_a1": "^ok:refused$", "manager": "^ok:refused$", "manager_a1": "^ok:refused$"}'),
('staff_loyalty_queue', 'staff_loyalty_queue at A1',
  $$select jsonb_array_length(public.staff_loyalty_queue('{store_a1}'))$$,
  '{"*": "EMPTY", "anon": "DENY", "service": "DENY", "owner": "^ok:2$", "owner_a1": "^ok:2$", "manager": "^ok:2$", "manager_a1": "^ok:2$"}'),
('staff_my_loyalty_requests', 'staff_my_loyalty_requests',
  $$select jsonb_array_length(public.staff_my_loyalty_requests())$$,
  '{"*": "EMPTY", "anon": "DENY", "service": "DENY", "staff": "^ok:1$"}'),
('staff_verify_redemption', 'staff_verify_redemption at A1',
  $$select public.staff_verify_redemption('{store_a1}', '{hold_code}') ->> 'state'$$,
  '{"*": "DENY", "owner": "^ok:verified$", "owner_a1": "^ok:verified$", "manager": "^ok:verified$", "manager_a1": "^ok:verified$", "staff": "^ok:verified$"}'),
('staff_verify_redemption', 'staff_verify_redemption of an A1 code at A2',
  $$select public.staff_verify_redemption('{store_a2}', '{hold_code}') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:wrong_store$", "manager": "^ok:wrong_store$", "staff_a2": "^ok:wrong_store$"}'),
('staff_verify_redemption', 'staff_verify_redemption of an A code in tenant B',
  $$select public.staff_verify_redemption('{store_b1}', '{hold_code}') ->> 'refusal'$$,
  '{"*": "DENY", "owner_b": "^ok:unknown$"}'),
-- Staff confirmation mode and bills (docs/api.md 3.25).
('set_loyalty_store_settings', 'set_loyalty_store_settings at A1',
  $$select public.set_loyalty_store_settings('{store_a1}', '{"shadow_reconcile": true}') ->> 'confirmation'$$,
  '{"*": "DENY", "owner": "^ok:pos_sync$", "owner_a1": "^ok:pos_sync$"}'),
('set_loyalty_store_settings', 'set_loyalty_store_settings at B1',
  $$select public.set_loyalty_store_settings('{store_b1}', '{"shadow_reconcile": true}') ->> 'confirmation'$$,
  '{"*": "DENY", "owner_b": "^ok:pos_sync$"}'),
('staff_submit_bill', 'staff_submit_bill at A1',
  $$select public.staff_submit_bill('{store_a1}', '123456', 'SM-120-B', 60000) ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_staff_mode$", "owner_a1": "^ok:not_staff_mode$", "manager": "^ok:not_staff_mode$", "manager_a1": "^ok:not_staff_mode$", "staff": "^ok:not_staff_mode$"}'),
('staff_submit_bill', 'staff_submit_bill at B1',
  $$select public.staff_submit_bill('{store_b1}', '123456', 'SM-120-B', 60000) ->> 'refusal'$$,
  '{"*": "DENY", "owner_b": "^ok:not_staff_mode$"}'),
('customer_pending_bills', 'customer_pending_bills',
  $$select jsonb_array_length(public.customer_pending_bills())$$,
  '{"*": "DENY", "customer": "^ok:0$", "customer_b": "^ok:0$"}'),
('customer_confirm_bill', 'customer_confirm_bill of a bill that is not the member''s',
  $$select public.customer_confirm_bill('{store_a1}'::uuid, 60000) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:unknown_bill$", "customer_b": "^ok:unknown_bill$"}'),
('customer_dispute_bill', 'customer_dispute_bill of a bill that is not the member''s',
  $$select public.customer_dispute_bill('{store_a1}'::uuid) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:unknown_bill$", "customer_b": "^ok:unknown_bill$"}'),
('customer_submit_counter_claim', 'customer_submit_counter_claim with an unknown counter QR',
  $$select public.customer_submit_counter_claim('fnb-counter:1:sa-1:ABCDEFGHJKLM', 'SM-120-C', 60000) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:code_unknown$", "customer_b": "^ok:code_unknown$"}'),
('staff_counter_code', 'staff_counter_code at A1',
  $$select public.staff_counter_code('{store_a1}') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_available$", "owner_a1": "^ok:not_available$", "manager": "^ok:not_available$", "manager_a1": "^ok:not_available$", "staff": "^ok:not_available$"}'),
('staff_counter_claims', 'staff_counter_claims at A1',
  $$select jsonb_array_length(public.staff_counter_claims('{store_a1}'))$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$", "staff": "^ok:0$"}'),
('staff_answer_counter_claim', 'staff_answer_counter_claim of an unknown bill',
  $$select public.staff_answer_counter_claim('{store_a1}'::uuid, 60000, null) ->> 'state'$$,
  '{"*": "DENY"}'),
('staff_recent_bills', 'staff_recent_bills at A1',
  $$select public.staff_recent_bills('{store_a1}') ->> 'mode'$$,
  '{"*": "DENY", "owner": "^ok:pos_sync$", "owner_a1": "^ok:pos_sync$", "manager": "^ok:pos_sync$", "manager_a1": "^ok:pos_sync$", "staff": "^ok:pos_sync$"}'),
('staff_recent_bills', 'staff_recent_bills at A2',
  $$select public.staff_recent_bills('{store_a2}') ->> 'mode'$$,
  '{"*": "DENY", "owner": "^ok:pos_sync$", "manager": "^ok:pos_sync$", "staff_a2": "^ok:pos_sync$"}'),
('staff_bill_queue', 'staff_bill_queue at A1',
  $$select jsonb_array_length(public.staff_bill_queue('{store_a1}') -> 'bills')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$"}'),
('staff_decide_bill', 'staff_decide_bill of an unknown bill',
  $$select public.staff_decide_bill('{store_a1}'::uuid, 'approved', 'synthetic') ->> 'state'$$,
  '{"*": "DENY"}'),
('staff_reverse_bill', 'staff_reverse_bill of an unknown bill',
  $$select public.staff_reverse_bill('{store_a1}'::uuid, 'synthetic') ->> 'state'$$,
  '{"*": "DENY"}'),
('staff_close_bill_audit', 'staff_close_bill_audit of an unknown audit',
  $$select public.staff_close_bill_audit('{store_a1}'::uuid, 'passed', null) ->> 'state'$$,
  '{"*": "DENY"}'),
('staff_confirm_redemption', 'staff_confirm_redemption at A1',
  $$select public.staff_confirm_redemption('{redemption}') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_staff_mode$", "owner_a1": "^ok:not_staff_mode$", "manager": "^ok:not_staff_mode$", "manager_a1": "^ok:not_staff_mode$", "staff": "^ok:not_staff_mode$"}'),
('staff_void_redemption', 'staff_void_redemption at A1',
  $$select public.staff_void_redemption('{redemption}', 'synthetic') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_staff_confirmed$", "owner_a1": "^ok:not_staff_confirmed$", "manager": "^ok:not_staff_confirmed$", "manager_a1": "^ok:not_staff_confirmed$"}'),
('bill_anomaly_report', 'bill_anomaly_report of A1 and A2',
  $$select count(*) from public.bill_anomaly_report(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1)$$,
  '{"*": "^ok:0$", "anon": "DENY"}'),
-- 3.19: the queue, balances and rails.
('resolve_loyalty_queue_item', 'resolve_loyalty_queue_item at A1',
  $$select public.resolve_loyalty_queue_item('{queue_item}', null, 'Bỏ qua') ->> 'state'$$,
  '{"*": "DENY", "owner": "OK", "owner_a1": "OK", "manager": "OK", "manager_a1": "OK"}'),
('loyalty_balance', 'loyalty_balance of an A member',
  $$select count(*) from public.loyalty_balance('{m_a1}')$$,
  '{"*": "^ok:0$", "anon": "DENY", "service": "^ok:1$", "owner": "^ok:1$", "owner_a1": "^ok:1$", "manager": "^ok:1$", "manager_a1": "^ok:1$", "viewer": "^ok:1$", "customer": "^ok:1$"}'),
('loyalty_rail_flags', 'loyalty_rail_flags of A1 and A2',
  $$select count(*) from public.loyalty_rail_flags(array['{store_a1}', '{store_a2}']::uuid[])$$,
  '{"*": "^ok:0$", "anon": "DENY", "service": "^ok:1$", "owner": "^ok:1$", "owner_a1": "^ok:1$", "manager": "^ok:1$", "manager_a1": "^ok:1$", "viewer": "^ok:1$", "staff": "^ok:1$"}'),
-- 3.23: the member reads with masked phones; the full phone only for an owner.
('loyalty_members_page', 'loyalty_members_page',
  $$select count(*) from public.loyalty_members_page(null)$$,
  '{"*": "DENY", "owner": "^ok:2$", "owner_a1": "^ok:2$", "manager": "^ok:2$", "manager_a1": "^ok:2$", "viewer": "^ok:2$", "owner_b": "^ok:1$"}'),
('loyalty_member_lookup', 'loyalty_member_lookup: rows and full phones',
  $$select count(*) || ':' || count(phone_full) from public.loyalty_member_lookup('0900012001')$$,
  '{"*": "DENY", "owner": "^ok:1:1$", "owner_a1": "^ok:1:1$", "manager": "^ok:1:0$", "manager_a1": "^ok:1:0$", "viewer": "^ok:1:0$", "owner_b": "^ok:0:0$"}'),
('loyalty_shift_anomalies', 'loyalty_shift_anomalies of A1 and A2',
  $$select count(distinct store_id) from public.loyalty_shift_anomalies(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1)$$,
  '{"*": "^ok:0$", "anon": "DENY", "owner": "^ok:2$", "owner_a1": "^ok:1$", "manager": "^ok:2$", "manager_a1": "^ok:1$", "viewer": "^ok:2$"}'),
('customer_metrics', 'customer_metrics of A1 and A2: one row of aggregates',
  $$select count(*) from public.customer_metrics(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1)$$,
  '{"*": "DENY", "owner": "^ok:1$", "owner_a1": "^ok:1$", "manager": "^ok:1$", "manager_a1": "^ok:1$", "viewer": "^ok:1$", "owner_b": "^ok:1$"}'),
('phone_masked', 'phone_masked of an A member, looked up by id',
  $$select public.phone_masked(jsonb_populate_record(null::public.memberships, jsonb_build_object('id', '{m_a1}')))$$,
  '{"*": "^ok:null$", "anon": "DENY", "service": "DENY", "owner": "001$", "owner_a1": "001$", "manager": "001$", "manager_a1": "001$", "viewer": "001$", "customer": "001$"}'),
-- 3.8 and 3.22: report functions over loyalty rows.
('member_share_by_shift', 'member_share_by_shift of A1 and A2',
  $$select count(distinct store_id) from public.member_share_by_shift(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1)$$,
  '{"*": "^ok:0$", "anon": "DENY", "service": "^ok:2$", "owner": "^ok:2$", "owner_a1": "^ok:1$", "manager": "^ok:2$", "manager_a1": "^ok:1$", "viewer": "^ok:2$", "staff": "^ok:1$", "staff_a2": "^ok:1$"}'),
('redemption_summary', 'redemption_summary of A1 and A2',
  $$select count(*) from public.redemption_summary(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1)$$,
  '{"*": "^ok:0$", "anon": "DENY", "service": "^ok:1$", "owner": "^ok:1$", "owner_a1": "^ok:1$", "manager": "^ok:1$", "manager_a1": "^ok:1$", "viewer": "^ok:1$"}'),
('coupon_discount_days', 'coupon_discount_days of an A reward',
  $$select count(*) from public.coupon_discount_days('{coupon}', 2026)$$,
  '{"*": "BAD", "anon": "DENY", "service": "OK", "owner": "OK", "owner_a1": "OK", "manager": "OK", "manager_a1": "OK", "viewer": "OK", "staff": "OK", "staff_a2": "OK", "customer": "OK"}'),
-- 3.24: erasure, for an owner with every store only.
('dsr_delete', 'dsr_delete of an A customer',
  $$select public.dsr_delete('{dsr}') ->> 'status'$$,
  '{"*": "DENY", "owner": "^ok:completed$"}'),
('dsr_lookup', 'dsr_lookup of an A phone: rows, never a full phone',
  $$select count(*) || ':' || count(*) filter (where row_to_json(l)::text ~ '9000120') from public.dsr_lookup('0900012001') l$$,
  '{"*": "DENY", "owner": "^ok:1:0$", "manager": "^ok:1:0$", "owner_b": "^ok:0:0$"}'),
('dsr_export', 'dsr_export of an A request',
  $$select (public.dsr_export('{dsr}') -> 'counts' ->> 'memberships')$$,
  '{"*": "DENY", "owner": "^ok:[0-9]+$", "manager": "^ok:[0-9]+$"}'),
('dsr_correct', 'dsr_correct on an A request that is not a correction',
  $$select public.dsr_correct('{dsr}', 'name', 'Synthetic name')::text$$,
  '{"*": "DENY", "owner": "BAD", "manager": "BAD"}'),
('dsr_due_soon', 'dsr_due_soon of A',
  $$select count(*) from public.dsr_due_soon(30)$$,
  '{"*": "DENY", "owner": "^ok:[0-9]+$", "manager": "^ok:[0-9]+$", "owner_b": "^ok:0$"}'),
('dsr_deletion_preview', 'dsr_deletion_preview of an A request',
  $$select (public.dsr_deletion_preview('{dsr}') ->> 'memberships')$$,
  '{"*": "DENY", "owner": "^ok:[0-9]+$", "manager": "^ok:[0-9]+$"}'),
('set_loyalty_adjust_limits', 'set_loyalty_adjust_limits of A',
  $$select public.set_loyalty_adjust_limits('{tenant_a}', 2, 10) ->> 'max_stamps'$$,
  '{"*": "DENY", "owner": "^ok:2$"}'),
-- 3.5: the member's own notifications.
('my_notifications', 'my_notifications of A',
  $$select (public.my_notifications('{tenant_a}') ? 'consent')::text$$,
  '{"*": "DENY", "owner": "^ok:true$", "owner_a1": "^ok:true$", "manager": "^ok:true$", "manager_a1": "^ok:true$", "viewer": "^ok:true$", "staff": "^ok:true$", "staff_a2": "^ok:true$", "publisher": "^ok:true$"}'),
('start_bot_link', 'start_bot_link in A',
  $$select (public.start_bot_link('{tenant_a}', 'ops-notifications-v1') ? 'code')::text$$,
  '{"*": "DENY", "owner": "^ok:true$", "owner_a1": "^ok:true$", "manager": "^ok:true$", "manager_a1": "^ok:true$", "viewer": "^ok:true$", "staff": "^ok:true$", "staff_a2": "^ok:true$"}'),
('set_my_muted_rules', 'set_my_muted_rules on staff''s own destination',
  $$select coalesce(array_length(public.set_my_muted_rules('{channel_staff}', array[]::text[]), 1), 0)$$,
  '{"*": "DENY", "staff": "^ok:0$"}'),
('stop_my_notifications', 'stop_my_notifications in A',
  $$select public.stop_my_notifications('{tenant_a}')$$,
  '{"*": "DENY", "owner": "OK", "owner_a1": "OK", "manager": "OK", "manager_a1": "OK", "viewer": "OK", "staff": "OK", "staff_a2": "OK", "publisher": "OK"}'),
('my_follow_oa', 'my_follow_oa in A',
  $$select coalesce(public.my_follow_oa('{tenant_a}'), 'none')$$,
  '{"*": "DENY", "owner": "OK", "owner_a1": "OK", "manager": "OK", "manager_a1": "OK", "viewer": "OK", "staff": "OK", "staff_a2": "OK", "publisher": "OK"}'),
-- 3.10: the OA webhook's day counts, for owners.
('oa_event_counts', 'oa_event_counts of A',
  $$select count(*) from public.oa_event_counts('{tenant_a}', current_date - 1, current_date)$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$"}'),
-- 3.12: a staff member's own phone.
('link_my_phone', 'link_my_phone in A',
  $$select public.link_my_phone('{tenant_a}', '+' || '849000120' || '99')$$,
  '{"*": "DENY", "staff": "^ok:•+ ?•* ?099$|^ok:.*099$"}'),
('withdraw_staff_ops_consent', 'withdraw_staff_ops_consent in A',
  $$select public.withdraw_staff_ops_consent('{tenant_a}')::text$$,
  '{"*": "DENY", "staff": "OK"}'),
-- 3.20 and section 5: the RPCs only the service role may execute.
('customer_join', 'customer_join',
  $$select public.customer_join('{customer_2_u}'::uuid, '{app_a}'::uuid, 'syn-zalo-120-9', null, '0900012009', false, false, 'privacy-120-1', 'join-1', now(), 'sa-1', 'mini_app')::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_customer_sign_in', 'zalo_customer_sign_in',
  $$select public.zalo_customer_sign_in('{app_a}'::uuid, 'syn-zalo-120-9', null, null) ->> 'status'$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_session_app', 'zalo_session_app',
  $$select public.zalo_session_app('brand-1', '{tenant_a}'::uuid)::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_session_sign_in', 'zalo_session_sign_in',
  $$select public.zalo_session_sign_in('{app_a}'::uuid, 'syn-zalo-120-9', null, null)::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_session_pair', 'zalo_session_pair',
  $$select public.zalo_session_pair('{app_a}'::uuid, 'syn-zalo-120-9', null, '123456', 'staff-notice-0', now(), null)::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_session_texts', 'zalo_session_texts',
  $$select public.zalo_session_texts('{app_a}'::uuid)::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_session_visit', 'zalo_session_visit',
  $$select public.zalo_session_visit('{app_a}'::uuid, 'staff')::text$$,
  '{"*": "DENY", "service": "GATE"}'),
-- ADR-057: the Zalo Graph relay's address, written and read only by zalo-session and zalo-phone.
('zalo_relay_announce', 'zalo_relay_announce',
  $$select public.zalo_relay_announce('https://synthetic-relay-120.trycloudflare.com', now())::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('zalo_relay_current', 'zalo_relay_current',
  $$select coalesce(public.zalo_relay_current(), 'none')$$,
  '{"*": "DENY", "service": "GATE"}'),
-- ADR-060: the native till's menu. Customer reads for the session's brand (another brand's store is 22023); the
-- counter for owners, managers and staff of the store; the till mode and the import for owners with every store.
('customer_menu', 'customer_menu at A1',
  $$select (public.customer_menu('sa-1') ? 'categories')::text$$,
  '{"*": "DENY", "customer": "^ok:true$", "visitor": "^ok:true$", "customer_b": "BAD"}'),
('customer_menu_version', 'customer_menu_version at A1',
  $$select (public.customer_menu_version('sa-1') ? 'menu_version')::text$$,
  '{"*": "DENY", "customer": "^ok:true$", "visitor": "^ok:true$", "customer_b": "BAD"}'),
('counter_menu', 'counter_menu at A1',
  $$select jsonb_array_length(public.counter_menu('{store_a1}') -> 'items')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$", "staff": "^ok:0$"}'),
('counter_menu', 'counter_menu at A2',
  $$select jsonb_array_length(public.counter_menu('{store_a2}') -> 'items')$$,
  '{"*": "DENY", "owner": "^ok:0$", "manager": "^ok:0$", "staff_a2": "^ok:0$"}'),
('counter_set_sold_out', 'counter_set_sold_out of an item not on the menu at A1',
  $$select public.counter_set_sold_out('{store_a1}', 'aaaaaaaa-aaaa-4aaa-8aaa-000000012099', true)::text$$,
  '{"*": "DENY", "owner": "BAD", "owner_a1": "BAD", "manager": "BAD", "manager_a1": "BAD", "staff": "BAD"}'),
('counter_set_pause', 'counter_set_pause at A1 without settings',
  $$select public.counter_set_pause('{store_a1}', 15, null)::text$$,
  '{"*": "DENY", "owner": "BAD", "owner_a1": "BAD", "manager": "BAD", "manager_a1": "BAD", "staff": "BAD"}'),
('counter_set_pause', 'counter_set_pause for 90 minutes at A1',
  $$select public.counter_set_pause('{store_a1}', 90, null)::text$$,
  '{"*": "DENY", "owner": "BAD", "owner_a1": "BAD", "manager": "BAD", "manager_a1": "BAD"}'),
('set_store_till_mode', 'set_store_till_mode of A1',
  $$select public.set_store_till_mode('{store_a1}', 'native') ->> 'till_mode'$$,
  '{"*": "DENY", "owner": "^ok:native$"}'),
('set_store_till_mode', 'set_store_till_mode of B1',
  $$select public.set_store_till_mode('{store_b1}', 'native') ->> 'till_mode'$$,
  '{"*": "DENY", "owner_b": "^ok:native$"}'),
('import_menu_from_pos', 'import_menu_from_pos of brand A from A1',
  $$select public.import_menu_from_pos('{brand_a}', '{store_a1}') ->> 'state'$$,
  '{"*": "DENY", "owner": "^ok:imported$"}'),
('import_menu_from_pos', 'import_menu_from_pos of brand B from B1',
  $$select public.import_menu_from_pos('{brand_b}', '{store_b1}') ->> 'state'$$,
  '{"*": "DENY", "owner_b": "^ok:imported$"}'),
-- ADR-060 step 2: tables, their QR codes and staff calls.
('customer_table', 'customer_table with an unknown token at A1',
  $$select public.customer_table('sa-1', 'AAAAAAAAAAAAAAAAAAAAAA') ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:table_unknown$", "visitor": "^ok:table_unknown$", "customer_b": "BAD"}'),
('customer_call_staff', 'customer_call_staff with an unknown token at A1',
  $$select public.customer_call_staff('sa-1', 'AAAAAAAAAAAAAAAAAAAAAA') ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:table_unknown$", "visitor": "^ok:table_unknown$", "customer_b": "BAD"}'),
('table_qr_links', 'table_qr_links of A1',
  $$select jsonb_array_length(public.table_qr_links('{store_a1}') -> 'tables')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$"}'),
('rotate_table_qr', 'rotate_table_qr of an unknown table',
  $$select public.rotate_table_qr('aaaaaaaa-aaaa-4aaa-8aaa-000000012098')::text$$,
  '{"*": "DENY"}'),
('counter_table_map', 'counter_table_map at A1',
  $$select jsonb_array_length(public.counter_table_map('{store_a1}') -> 'tables')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$", "staff": "^ok:0$"}'),
('counter_ack_call', 'counter_ack_call of an unknown call',
  $$select public.counter_ack_call('aaaaaaaa-aaaa-4aaa-8aaa-000000012097')::text$$,
  '{"*": "DENY"}'),
-- ADR-061 step 3: orders. A customer session of the store's brand places, reads and cancels its own orders (another
-- brand's store is 22023, another login's order unknown_order); the counter functions are for staff of the store.
('customer_place_order', 'customer_place_order at A1 of a store that takes no order',
  $$select public.customer_place_order(jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table', 'table_token', 'AAAAAAAAAAAAAAAAAAAAAA', 'payment', 'counter', 'lines', jsonb_build_array(jsonb_build_object('size', gen_random_uuid(), 'qty', 1)), 'expected_total', 1)) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:ordering_off$", "visitor": "^ok:ordering_off$", "customer_b": "BAD"}'),
('customer_check_cart', 'customer_check_cart at A1',
  $$select public.customer_check_cart(jsonb_build_object('store', 'sa-1', 'type', 'table', 'lines', jsonb_build_array(jsonb_build_object('size', gen_random_uuid(), 'qty', 1)))) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:item_unavailable$", "visitor": "^ok:item_unavailable$", "customer_b": "BAD"}'),
('customer_cancel_order', 'customer_cancel_order of an unknown order',
  $$select public.customer_cancel_order('aaaaaaaa-aaaa-4aaa-8aaa-000000012096') ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:unknown_order$", "visitor": "^ok:unknown_order$", "customer_b": "^ok:unknown_order$"}'),
('customer_order', 'customer_order of an unknown order',
  $$select public.customer_order('aaaaaaaa-aaaa-4aaa-8aaa-000000012096') ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:unknown_order$", "visitor": "^ok:unknown_order$", "customer_b": "^ok:unknown_order$"}'),
('customer_orders', 'customer_orders of the session only',
  $$select jsonb_array_length(public.customer_orders(null) -> 'orders')$$,
  '{"*": "DENY", "customer": "^ok:0$", "visitor": "^ok:0$", "customer_b": "^ok:0$"}'),
-- ADR-061 step 5: the stamp card of the customer's Zalo account, read only through this RPC by a customer session.
('customer_stamp_card', 'customer_stamp_card of the session only',
  $$select public.customer_stamp_card() ->> 'stamps'$$,
  '{"*": "DENY", "customer": "^ok:0$", "visitor": "^ok:0$", "customer_b": "^ok:0$"}'),
-- Native till step 7: the requests inbox. The app's submission and the customer's own list for a customer session
-- (a store of another brand is store_unknown); the website's for the service role only; the inbox for owners and
-- managers of the store.
('customer_submit_request', 'customer_submit_request at a store of no brand',
  $$select public.customer_submit_request(jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sz-9', 'kind', 'booking', 'name', 'Khách', 'phone', '0901234567', 'party_size', 2, 'at', '2030-01-01T19:00:00+07:00')) ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:store_unknown$", "visitor": "^ok:store_unknown$", "customer_b": "^ok:store_unknown$"}'),
('customer_requests', 'customer_requests of the session only',
  $$select jsonb_array_length(public.customer_requests() -> 'requests')$$,
  '{"*": "DENY", "customer": "^ok:0$", "visitor": "^ok:0$", "customer_b": "^ok:0$"}'),
('customer_cancel_request', 'customer_cancel_request of an unknown request',
  $$select public.customer_cancel_request('aaaaaaaa-aaaa-4aaa-8aaa-000000012091') ->> 'refusal'$$,
  '{"*": "DENY", "customer": "^ok:unknown_request$", "visitor": "^ok:unknown_request$", "customer_b": "^ok:unknown_request$"}'),
('web_submit_request', 'web_submit_request of an unknown brand',
  $$select public.web_submit_request('aaaaaaaa-aaaa-4aaa-8aaa-000000012090', 'synthetic-client-key-120', jsonb_build_object('store', 'sa-1')) ->> 'refusal'$$,
  '{"*": "DENY", "service": "BAD"}'),
('manager_requests', 'manager_requests at A1',
  $$select jsonb_array_length(public.manager_requests('{store_a1}', null, 50) -> 'requests')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$"}'),
('manager_requests', 'manager_requests at A2',
  $$select jsonb_array_length(public.manager_requests('{store_a2}', null, 50) -> 'requests')$$,
  '{"*": "DENY", "owner": "^ok:0$", "manager": "^ok:0$"}'),
('manager_answer_request', 'manager_answer_request of an unknown request',
  $$select public.manager_answer_request('aaaaaaaa-aaaa-4aaa-8aaa-000000012091', 'confirmed', null, 1)::text$$,
  '{"*": "DENY"}'),
-- Native till step 8: shifts. Clocking in for members of the store (a wrong counter code answers as such); clocking
-- out and one's own shift for every member; the counter code, the shifts, the worked days and the day's
-- reconciliation for owners and managers of the store; confirming and closing a shift for owners and managers of its
-- store (an unknown shift is 42501 for everyone).
('staff_clock_in', 'staff_clock_in at A1 with a wrong code',
  $$select public.staff_clock_in('{store_a1}', 'wrong-code-120', 0) ->> 'refusal'$$,
  '{"*":"DENY","owner":"^ok:counter_qr_invalid$","owner_a1":"^ok:counter_qr_invalid$","manager":"^ok:counter_qr_invalid$","manager_a1":"^ok:counter_qr_invalid$","staff":"^ok:counter_qr_invalid$"}'),
('staff_clock_out', 'staff_clock_out without a shift',
  $$select public.staff_clock_out(0) ->> 'refusal'$$,
  '{"*":"DENY","owner":"^ok:not_clocked_in$","owner_a1":"^ok:not_clocked_in$","manager":"^ok:not_clocked_in$","manager_a1":"^ok:not_clocked_in$","viewer":"^ok:not_clocked_in$","staff":"^ok:not_clocked_in$","staff_a2":"^ok:not_clocked_in$","publisher":"^ok:not_clocked_in$","owner_b":"^ok:not_clocked_in$"}'),
('staff_my_shift', 'staff_my_shift without a shift',
  $$select (public.staff_my_shift(null) -> 'shift')::text$$,
  '{"*":"DENY","owner":"^ok:null$","owner_a1":"^ok:null$","manager":"^ok:null$","manager_a1":"^ok:null$","viewer":"^ok:null$","staff":"^ok:null$","staff_a2":"^ok:null$","publisher":"^ok:null$","owner_b":"^ok:null$"}'),
('manager_counter_qr', 'manager_counter_qr at A1',
  $$select public.manager_counter_qr('{store_a1}', false) ->> 'version'$$,
  '{"*":"DENY","owner":"^ok:1$","owner_a1":"^ok:1$","manager":"^ok:1$","manager_a1":"^ok:1$"}'),
('manager_counter_qr', 'manager_counter_qr at A2',
  $$select public.manager_counter_qr('{store_a2}', false) ->> 'version'$$,
  '{"*":"DENY","owner":"^ok:1$","manager":"^ok:1$"}'),
('manager_confirm_shift', 'manager_confirm_shift of an unknown shift',
  $$select public.manager_confirm_shift('aaaaaaaa-aaaa-4aaa-8aaa-000000012089', 'synthetic')::text$$,
  '{"*": "DENY"}'),
('manager_close_shift', 'manager_close_shift of an unknown shift',
  $$select public.manager_close_shift('aaaaaaaa-aaaa-4aaa-8aaa-000000012089', now(), 0, 'synthetic')::text$$,
  '{"*": "DENY"}'),
('manager_shifts', 'manager_shifts at A1',
  $$select jsonb_array_length(public.manager_shifts('{store_a1}', current_date - 7, current_date) -> 'shifts')$$,
  '{"*":"DENY","owner":"^ok:0$","owner_a1":"^ok:0$","manager":"^ok:0$","manager_a1":"^ok:0$"}'),
('manager_shifts', 'manager_shifts at A2',
  $$select jsonb_array_length(public.manager_shifts('{store_a2}', current_date - 7, current_date) -> 'shifts')$$,
  '{"*":"DENY","owner":"^ok:0$","manager":"^ok:0$"}'),
('manager_worked_days', 'manager_worked_days at A1',
  $$select jsonb_array_length(public.manager_worked_days('{store_a1}', current_date) -> 'people')$$,
  '{"*":"DENY","owner":"^ok:0$","owner_a1":"^ok:0$","manager":"^ok:0$","manager_a1":"^ok:0$"}'),
('manager_day_reconciliation', 'manager_day_reconciliation at A1',
  $$select public.manager_day_reconciliation('{store_a1}', current_date) ->> 'revenue'$$,
  '{"*":"DENY","owner":"^ok:0$","owner_a1":"^ok:0$","manager":"^ok:0$","manager_a1":"^ok:0$"}'),
('manager_day_reconciliation', 'manager_day_reconciliation at A2',
  $$select public.manager_day_reconciliation('{store_a2}', current_date) ->> 'revenue'$$,
  '{"*":"DENY","owner":"^ok:0$","manager":"^ok:0$"}'),
('counter_board', 'counter_board at A1',
  $$select jsonb_array_length(public.counter_board('{store_a1}', 0) -> 'orders')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$", "staff": "^ok:0$"}'),
('counter_board', 'counter_board at A2',
  $$select jsonb_array_length(public.counter_board('{store_a2}', 0) -> 'orders')$$,
  '{"*": "DENY", "owner": "^ok:0$", "manager": "^ok:0$", "staff_a2": "^ok:0$"}'),
('counter_order', 'counter_order of an unknown order',
  $$select public.counter_order('aaaaaaaa-aaaa-4aaa-8aaa-000000012096')::text$$,
  '{"*": "DENY"}'),
('counter_order_act', 'counter_order_act on an unknown order',
  $$select public.counter_order_act('aaaaaaaa-aaaa-4aaa-8aaa-000000012096', 'start', 1, null)::text$$,
  '{"*": "DENY"}'),
-- ADR-062 step 4: payments and refunds. The counter's for staff of the order's store (an unknown order is 42501 for
-- everyone); the online seams only for the service role, called by the payment Edge Functions after they verified.
('counter_record_payment', 'counter_record_payment of an unknown order',
  $$select public.counter_record_payment('aaaaaaaa-aaaa-4aaa-8aaa-000000012095', 'cash', 1, 1)::text$$,
  '{"*": "DENY"}'),
('counter_void_payment', 'counter_void_payment of an unknown payment',
  $$select public.counter_void_payment('aaaaaaaa-aaaa-4aaa-8aaa-000000012094', 'synthetic')::text$$,
  '{"*": "DENY"}'),
('counter_refund', 'counter_refund of an unknown order',
  $$select public.counter_refund('aaaaaaaa-aaaa-4aaa-8aaa-000000012095', 1, 'synthetic')::text$$,
  '{"*": "DENY"}'),
('checkout_payment_start', 'checkout_payment_start',
  $$select public.checkout_payment_start('{customer_2_u}'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000012095', 'vietqr', 'synthetic-key-120') ->> 'refusal'$$,
  '{"*": "DENY", "service": "GATE"}'),
('checkout_payment_confirm', 'checkout_payment_confirm',
  $$select public.checkout_payment_confirm('vietqr', 'synthetic-ref-120', 'aaaaaaaa-aaaa-4aaa-8aaa-000000012093', 1, true) ->> 'refusal'$$,
  '{"*": "DENY", "service": "GATE"}'),
('checkout_payments_pending', 'checkout_payments_pending',
  $$select count(*) from public.checkout_payments_pending(20, 10)$$,
  '{"*": "DENY", "service": "GATE"}'),
('checkout_refund_confirm', 'checkout_refund_confirm',
  $$select public.checkout_refund_confirm('aaaaaaaa-aaaa-4aaa-8aaa-000000012092', true, 'synthetic-ref-120') ->> 'refusal'$$,
  '{"*": "DENY", "service": "GATE"}'),
('counter_create_order', 'counter_create_order at A1, an ipos store',
  $$select public.counter_create_order('{store_a1}', jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(jsonb_build_object('size', gen_random_uuid(), 'qty', 1)))) ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_native$", "owner_a1": "^ok:not_native$", "manager": "^ok:not_native$", "manager_a1": "^ok:not_native$", "staff": "^ok:not_native$"}'),
-- The counter web app (ADR-066): the brand's Zalo App and the blocked sign-ins are for the counter-session function
-- only; owners and managers of the tenant read and answer the blocked sign-ins (an unknown request is 42501 for all).
('counter_session_app', 'counter_session_app',
  $$select public.counter_session_app('brand-1', '{tenant_a}'::uuid)::text$$,
  '{"*": "DENY", "service": "GATE"}'),
('counter_record_blocked_signin', 'counter_record_blocked_signin of an unknown app',
  $$select public.counter_record_blocked_signin('aaaaaaaa-aaaa-4aaa-8aaa-000000012093', 'synthetic-user-120', null, null)::text$$,
  '{"*": "DENY", "service": "BAD"}'),
('manager_blocked_signins', 'manager_blocked_signins of tenant A',
  $$select jsonb_array_length(public.manager_blocked_signins('{tenant_a}') -> 'requests')$$,
  '{"*": "DENY", "owner": "^ok:0$", "owner_a1": "^ok:0$", "manager": "^ok:0$", "manager_a1": "^ok:0$"}'),
('manager_dismiss_blocked_signin', 'manager_dismiss_blocked_signin of an unknown request',
  $$select public.manager_dismiss_blocked_signin('aaaaaaaa-aaaa-4aaa-8aaa-000000012094', 1)::text$$,
  '{"*": "DENY"}'),
-- Native till hardening (C20, Q01): the stamp card's member code for a customer session; the counter's lookup and
-- attach for staff of the store (A1 is an ipos store: not_native; an unknown order is 42501 for everyone).
('customer_stamp_code', 'customer_stamp_code of the session',
  $$select public.customer_stamp_code() ->> 'state'$$,
  '{"*": "DENY", "customer": "^ok:issued$", "visitor": "^ok:issued$", "customer_b": "^ok:issued$"}'),
('counter_member_lookup', 'counter_member_lookup at A1, an ipos store',
  $$select public.counter_member_lookup('{store_a1}', '12345674') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_native$", "owner_a1": "^ok:not_native$", "manager": "^ok:not_native$", "manager_a1": "^ok:not_native$", "staff": "^ok:not_native$"}'),
('counter_member_lookup', 'counter_member_lookup at A2, an ipos store',
  $$select public.counter_member_lookup('{store_a2}', '12345674') ->> 'refusal'$$,
  '{"*": "DENY", "owner": "^ok:not_native$", "manager": "^ok:not_native$", "staff_a2": "^ok:not_native$"}'),
('counter_attach_member', 'counter_attach_member of an unknown order',
  $$select public.counter_attach_member('aaaaaaaa-aaaa-4aaa-8aaa-000000012096', '12345674', 1)::text$$,
  '{"*": "DENY"}'),
-- Native till hardening (C19): deleting a never-joined login and exporting one's data, for a customer session only
-- (the matrix asks without the confirmation, so nothing is deleted: 22023 for every customer session).
('customer_delete_account', 'customer_delete_account without the confirmation',
  $$select public.customer_delete_account(false)::text$$,
  '{"*": "DENY", "customer": "BAD", "visitor": "BAD", "customer_b": "BAD"}'),
('customer_export_data', 'customer_export_data of the session',
  $$select (public.customer_export_data() ? 'orders')::text$$,
  '{"*": "DENY", "customer": "^ok:true$", "visitor": "^ok:true$", "customer_b": "^ok:true$"}'),
('manager_approve_blocked_signin', 'manager_approve_blocked_signin of an unknown request',
  $$select public.manager_approve_blocked_signin('aaaaaaaa-aaaa-4aaa-8aaa-000000012094', 1, 'Synthetic', 'staff', null)::text$$,
  '{"*": "DENY"}');

insert into ph select 'customer_2_u', customer_2_u::text from fx;

create temp table cells as
select m.label, c.name as caller,
  pg_temp.expected(coalesce(m.expect ->> c.name, m.expect ->> '*')) as pattern,
  m.statement
from matrix m cross join callers c;

-- The functions in scope: every public function an API role may execute whose name belongs to the loyalty,
-- customer, staff loyalty, redemption, notification, OA or Zalo areas.
create temp table in_scope as
select p.proname as fn, p.oid::regprocedure::text as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
where n.nspname = 'public'
  and d.objid is null
  and p.prorettype <> 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
  and p.proname ~ '(customer|loyalty|coupon|redemption|redeem|dsr|member|notification|bot|muted|oa_|_oa|zalo|phone|voucher|claim|checkin|^staff_|consent|^bill_|^counter_|import_menu|till_mode|table_qr|order|ordering|sold_out|checkout|^manager_|^web_)';

select plan((select count(*)::integer from cells) + 4);

select matches(pg_temp.run_as(caller, statement), pattern, format('%s as %s', label, caller))
from cells
order by label, caller;

select is(
  (select coalesce(string_agg(signature, ', ' order by signature), '') from in_scope where fn not in (select fn from matrix)),
  '',
  'every public loyalty, customer, staff, redemption, notification, OA and Zalo function has a row in the matrix'
);
select is(
  (select coalesce(string_agg(distinct fn, ', '), '') from matrix where fn not in (select fn from in_scope)),
  '',
  'every function the matrix names exists and is in scope'
);
select is(
  (select coalesce(string_agg(signature, ', ' order by signature), '') from in_scope s
   where has_function_privilege('anon', (select p.oid from pg_proc p where p.oid = s.signature::regprocedure), 'execute')),
  '',
  'anon may execute none of them'
);
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
   from pg_proc p join in_scope s on s.signature = p.oid::regprocedure::text
   where p.prosecdef and not coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=(""|)$', false)),
  '',
  'every security definer function in scope pins an empty search_path'
);

select * from finish();
rollback;
