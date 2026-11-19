-- Security test design: personal-data checks (OWASP API3 excessive data exposure, ASVS V8 data protection; Law
-- 91/2025 data minimisation). 1. No answer of a public loyalty, customer, staff or notification function holds a
-- full phone for anyone but an owner's own lookup. 2. No column any caller may select, in any public table or view,
-- holds one (but the invoices' copy of what the POS sent, an open owner decision). 3. A phone, a reward code, the
-- voucher callback's secret path and an OA user id are stored only where they belong: never in the callback log,
-- the outbox, the OA event log or any other table. 4. After a data-subject erasure nothing names the customer.
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';
update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012401'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012402'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012401'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012402'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012401'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012402'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012403'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012401'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012402'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012401'::uuid as app_a,
  '99999999-9999-4999-8999-000000012402'::uuid as app_b,
  '77777777-7777-4777-8777-000000012401'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012401'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012402'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012401'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012402'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012403'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012404'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012405'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012406'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012407'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012408'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012409'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012410'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012411'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012412'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012413'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012414'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-privacy-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-privacy-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-privacy-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-privacy-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-privacy-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm124-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm124-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm124-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
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
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-124-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012401', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012402', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012403', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-124-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-124-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-124-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-124-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-124-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-124-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-124-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm124-inv-a1', '0900012401'), (fx.store_a2, 'sm124-inv-a2', '0900012402')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm124-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm124-inv-a2';
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

-- The privacy flows: the voucher callback with a code and a member phone, the OA enrolment with a form phone, a
-- check-in by phone, a receipt claim, a member lookup and a Bot link, so every log and queue they write holds rows.
insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, callback_ip_allowlist, active_from, callback_store_ref, callback_enabled)
select tenant_a, store_a2, 'crm_callback'::public.coupon_rail, '{PRG-1}'::text[], '{}'::cidr[], now() - interval '30 days', 'POS-A2', true from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_a, store_a2, 'ten-pct', 'PRG-1', 'discount'::public.einvoice_display from fx;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_a, programme_a, 'ten-pct', 'Giảm 10%', 'percent_off'::public.coupon_reward_kind, 10, 1, 0, array[store_a2], 'active'::public.coupon_status from fx;
create temp table secrets (name text primary key, value text);
insert into secrets
select 'cb_code', app.redeem_coupon((select id from ids where name = 'm_a2'), (select id from public.coupons where reward_key = 'ten-pct' and tenant_id = fx.tenant_a), fx.store_a2, now() - interval '5 minutes') ->> 'code' from fx
union all
select 'path', app.issue_voucher_callback_path(tenant_a, 'pos-crm') from fx
union all
select 'hold_code', value from ph where name = 'hold_code';
do $$
declare
  v_path text := encode(sha256(convert_to((select value from secrets where name = 'path'), 'UTF8')), 'hex');
begin
  perform app.answer_voucher_callback(v_path, '203.0.113.5', 'POS-A2', 'PRG-1', (select value from secrets where name = 'cb_code'), 'SALE-124-1', '0900012402',
    '[{"item": "ITEM-A", "quantity": 2, "amount": 60000}]', clock_timestamp(), now());
  perform app.answer_voucher_callback(v_path, '203.0.113.5', 'POS-A2', 'PRG-1', 'WRONG-CODE-124', 'SALE-124-2', '0900012401',
    '[{"item": "ITEM-A", "quantity": 1, "amount": 30000}]', clock_timestamp(), now());
  perform app.answer_voucher_callback(v_path, '203.0.113.5', 'POS-A9', 'PRG-1', (select value from secrets where name = 'hold_code'), 'SALE-124-3', '0900012401',
    '[{"item": "ITEM-A", "quantity": 1, "amount": 30000}]', clock_timestamp(), now());
end;
$$;

insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_a, oa_a, '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx;
create function pg_temp.oa(p_name text, p_input jsonb, p_at timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_event uuid;
begin
  select r.event_row into v_event
  from app.receive_oa_event((select oa_a from fx), encode(sha256(convert_to(concat_ws('/', p_name, p_at), 'UTF8')), 'hex'),
    p_name, 'syn-oa-user-124', p_at, 'raw', p_at + interval '1 second') r;
  perform app.apply_oa_event(v_event, p_at + interval '1 second');
  return app.oa_customer_step(v_event, p_input, p_at + interval '2 seconds');
end;
$$;
do $$
begin
  perform pg_temp.oa('follow', '{"kind": "none"}', now() - interval '10 minutes');
  perform pg_temp.oa('user_send_text', '{"kind": "keyword", "action": "join"}', now() - interval '9 minutes');
  perform app.record_oa_reply((a ->> 'oa_user_row')::uuid, (a ->> 'customer_id')::uuid, 'joined', 'sent', null, 'mock-oa-message-124', now() - interval '7 minutes')
  from (select pg_temp.oa('user_submit_info', '{"kind": "form", "phone": "0900012405", "name": "Khách Biểu Mẫu"}', now() - interval '8 minutes') as a) f;
end;
$$;

create function pg_temp.as_caller(p_caller text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_caller callers;
  v_sql text := pg_temp.fill(p_statement);
  v_value text;
begin
  select * into strict v_caller from callers where name = p_caller;
  perform set_config('request.jwt.claims', v_caller.claims::text, true);
  perform set_config('role', v_caller.role, true);
  execute v_sql into v_value;
  perform set_config('role', 'postgres', true);
  return v_value;
exception when others then
  perform set_config('role', 'postgres', true);
  return 'error:' || sqlstate;
end;
$$;
create temp table flows as
select f.name, pg_temp.as_caller(f.caller, f.statement) as answer
from (values
  ('check-in by phone', 'staff', $q$select public.staff_record_checkin('{store_a1}', '0900012401')::text$q$),
  ('member lookup', 'staff', $q$select public.staff_member_lookup('{store_a1}', '0900012402')::text$q$),
  ('receipt claim', 'customer', $q$select public.customer_submit_claim('sa-1', 'R-124-1', 60000)::text$q$),
  ('Bot link', 'staff', $q$select public.start_bot_link('{tenant_a}', 'ops-notifications-v1')::text$q$),
  ('owner lookup', 'owner', $q$select count(*)::text from public.loyalty_member_lookup('0900012401')$q$)
) as f (name, caller, statement);

-- The phones of the fixture's customers, in any form, are 9000124 and two digits.
create temp table taint (name text primary key, pattern text not null);
insert into taint
select 'phone', '9000124[0-9][0-9]'
union all
select 'redemption code', '(' || string_agg(value, '|') || ')' from secrets where name in ('cb_code', 'hold_code')
union all
select 'callback path', value from secrets where name = 'path'
union all
select 'OA user id', 'syn-oa-user-124';

-- 1. No full phone in any answer to anyone but an owner's lookup, whatever the caller.
create temp table answers (label text primary key, statement text not null);
insert into answers values
  ('customer_home', $$select public.customer_home()::text$$),
  ('customer_wallet', $$select public.customer_wallet()::text$$),
  ('customer_member_code', $$select public.customer_member_code('sa-1')::text$$),
  ('customer_submit_claim', $$select public.customer_submit_claim('sa-1', 'R-124-2', 60000)::text$$),
  ('customer_coupons', $$select json_agg(c)::text from public.customer_coupons(null) c$$),
  ('customer_redeem', $$select public.customer_redeem('{coupon}'::uuid, 'sa-1')::text$$),
  ('customer_vouchers', $$select json_agg(v)::text from public.customer_vouchers() v$$),
  ('customer_request_deletion', $$select public.customer_request_deletion()::text$$),
  ('staff_record_checkin', $$select public.staff_record_checkin('{store_a1}', '0900012402')::text$$),
  ('staff_member_lookup', $$select public.staff_member_lookup('{store_a1}', '0900012401')::text$$),
  ('staff_request', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', 'Khách báo thiếu dấu')::text$$),
  ('staff_loyalty_queue', $$select public.staff_loyalty_queue(null)::text$$),
  ('staff_my_loyalty_requests', $$select public.staff_my_loyalty_requests()::text$$),
  ('staff_verify_redemption', $$select public.staff_verify_redemption('{store_a1}', '{hold_code}')::text$$),
  ('staff_decide_loyalty_request', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused', 'Không')::text$$),
  ('resolve_loyalty_queue_item', $$select public.resolve_loyalty_queue_item('{queue_item}', null, 'Bỏ qua')::text$$),
  ('loyalty_members_page', $$select json_agg(p)::text from public.loyalty_members_page(null) p$$),
  ('loyalty_member_lookup', $$select json_agg(l)::text from public.loyalty_member_lookup('0900012401') l$$),
  ('loyalty_balance', $$select json_agg(b)::text from public.loyalty_balance('{m_a1}') b$$),
  ('loyalty_shift_anomalies', $$select json_agg(a)::text from public.loyalty_shift_anomalies(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1) a$$),
  ('member_share_by_shift', $$select json_agg(a)::text from public.member_share_by_shift(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1) a$$),
  ('redemption_summary', $$select json_agg(a)::text from public.redemption_summary(array['{store_a1}', '{store_a2}']::uuid[], current_date - 2, current_date + 1) a$$),
  ('phone_masked', $$select string_agg(public.phone_masked(m), ',') from public.memberships m$$),
  ('my_notifications', $$select public.my_notifications('{tenant_a}')::text$$),
  ('start_bot_link', $$select public.start_bot_link('{tenant_a}', 'ops-notifications-v1')::text$$),
  ('dsr_delete', $$select public.dsr_delete('{dsr}')::text$$);

create temp table answer_cells as
select a.label, c.name as caller, a.statement
from answers a cross join callers c
where c.name <> 'service';

-- 2. No full phone in any column a caller may select, in any public table or view, but the invoices' own copy of
--    what the POS sent (docs/security.md 8.6: an open owner decision).
create temp table readable as
select c.relname::text as tbl,
  (select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
   from pg_attribute a
   where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'select')) as cols,
  exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenant_scoped
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  and has_any_column_privilege('authenticated', c.oid, 'select')
  and c.relname not in ('invoices');

create temp table table_cells as
select r.tbl, c.name as caller,
  format('select count(*) from (select %s from public.%I %s) t where t::text ~ %L',
    r.cols, r.tbl,
    case when r.tenant_scoped then format('where tenant_id in (%L, %L)', fx.tenant_a, fx.tenant_b) else '' end,
    '9000124[0-9][0-9]') as statement
from readable r cross join callers c cross join fx
where c.name not in ('service', 'anon');

-- 3. Where each secret may live at all. Every table of public and app is read as the database owner, the fixture
--    tenants' rows only where a table has a tenant.
create temp table allowed (taint text, tbl text);
insert into allowed values
  ('phone', 'public.customers'), ('phone', 'public.invoices'), ('OA user id', 'app.customer_oa_contacts'),
  ('redemption code', 'public.redemptions'), ('redemption code', 'public.coupon_codes'),
  ('OA user id', 'public.oa_events'), ('OA user id', 'public.oa_users');

create temp table every_table as
select n.nspname || '.' || c.relname as tbl, c.oid,
  exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenant_scoped,
  c.reltuples
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app') and c.relkind in ('r', 'p');

create function pg_temp.tainted(p_pattern text)
returns text
language plpgsql
as $$
declare
  v_table record;
  v_found integer;
  v_out text[] := '{}';
begin
  for v_table in select * from every_table order by tbl loop
    if not v_table.tenant_scoped and v_table.reltuples > 50000 then
      continue;
    end if;
    execute format('select count(*) from %s t where %s t::text ~ %L', v_table.tbl,
      case when v_table.tenant_scoped then format('t.tenant_id in (%L, %L) and', (select tenant_a from fx), (select tenant_b from fx)) else '' end,
      p_pattern) into v_found;
    if v_found > 0 then
      v_out := v_out || v_table.tbl;
    end if;
  end loop;
  return array_to_string(v_out, ', ');
end;
$$;

-- 4. After the erasure of customer c_a1 nothing of it is left anywhere: its id, phone, Zalo user id and login.
create temp table erased as
select (select id::text from ids where name = 'c_a1') as customer_id, customer_u::text as login, 'syn-zalo-124-1' as zalo_user, (select id::text from ids where name = 'm_a1') as membership
from fx;

select plan(
  (select count(*)::integer from answer_cells) + (select count(*)::integer from table_cells) + (select count(*)::integer from taint) + 10
);

select ok(
  coalesce(pg_temp.run_as(caller, statement), '') !~ '9000124[0-9][0-9]' or (label = 'loyalty_member_lookup' and caller in ('owner', 'owner_a1')),
  format('%s as %s answers no full phone', label, caller))
from answer_cells order by label, caller;

select is(pg_temp.run_as(caller, statement), 'ok:0', format('%s read as %s holds no full phone', tbl, caller))
from table_cells order by tbl, caller;

select is(
  (select coalesce(string_agg(x, ', ' order by x), '') from unnest(string_to_array(pg_temp.tainted(t.pattern), ', ')) x
   where x not in (select a.tbl from allowed a where a.taint = t.name)),
  '',
  format('the %s is stored nowhere but where it belongs', t.name))
from taint t order by t.name;

select ok(
  (select count(*) from app.voucher_callback_log where tenant_id = (select tenant_a from fx)) >= 2,
  'the callback log holds the decisions it scanned');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
   where a.attrelid in ('app.voucher_callback_log'::regclass, 'app.voucher_callback_answers'::regclass, 'public.oa_events'::regclass)
     and a.attnum > 0 and not a.attisdropped and a.attname ~ '(phone|code|member|msisdn|text|name)$' and a.attname not in ('event_name', 'reward_name')),
  null,
  'the callback log, the callback answers and the OA event log have no phone, code, member, text or name column');
select ok(
  (select count(*) from public.outbound_messages where tenant_id = (select tenant_a from fx) and subject_type = 'customer') >= 1,
  'the OA replies to the customer were logged');
select is(
  (select count(*)::integer from public.outbound_messages o where o.tenant_id = (select tenant_a from fx)
     and (coalesce(o.body, '') <> '' or coalesce(o.title, '') <> '' or o.recipient_ref !~ '^(channel|membership|oa_user|customer|redacted):?[0-9a-f-]*$')),
  0,
  'customer and OA replies keep no text and an opaque recipient');

select is(
  (select coalesce(string_agg(name || ': ' || answer, '; '), '') from flows where answer like 'error:%'),
  '',
  'the staff, customer and owner flows ran');
select is(pg_temp.as_caller('owner', $q$select public.dsr_delete('{dsr}') ->> 'status'$q$), 'completed', 'the owner erases customer c_a2 on its request');
insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type)
select tenant_a, 'customer', (select id from ids where name = 'c_a1'), 'mini_app', 'deletion' from fx;
select is(
  pg_temp.as_caller('owner', format('select public.dsr_delete(%L) ->> ''status''',
    (select id from public.data_subject_requests where subject_id = (select id from ids where name = 'c_a1')))),
  'completed',
  'the owner erases customer c_a1 on its request');
select is(
  pg_temp.tainted((select customer_id from erased) || '|' || (select membership from erased)),
  'public.data_subject_requests',
  'nothing but the deletion request itself names the erased customer or its membership');
select is(pg_temp.tainted('9000124(01|02)'), 'public.invoices',
  'the erased customers'' phones remain only on the invoices the POS sent');
select is(
  pg_temp.tainted((select zalo_user from erased)) || '|' || (select count(*) from auth.users where id = (select login::uuid from erased)),
  '|0',
  'the erased customer''s Zalo user id and login are gone');

select * from finish();
rollback;
