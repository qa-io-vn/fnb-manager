-- Security test design: the rate limits that stand between a caller and abuse (OWASP API4 unrestricted resource
-- consumption, API6 unrestricted access to sensitive business flows). Receipt claims: three a business day per
-- member, refused ones counted. Zalo Bot link codes: five starts an hour per member. The OA join form: one every two
-- minutes per OA user, and one welcome a day. A replayed OA event is stored once, and a signed form answer older than
-- 48 hours (a stale replay) enrols nobody. The voucher callback's time budget is tested with the Edge Function
-- (supabase/functions/voucher-callback/security.test.ts).
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012501'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012502'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012501'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012502'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012502'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012503'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012501'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012502'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012501'::uuid as app_a,
  '99999999-9999-4999-8999-000000012502'::uuid as app_b,
  '77777777-7777-4777-8777-000000012501'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012501'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012502'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012501'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012502'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012503'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012504'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012505'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012506'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012507'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012508'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012509'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012510'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012511'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012512'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012513'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012514'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-limits-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-limits-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-limits-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-limits-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-limits-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm125-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm125-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm125-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
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
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-125-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012501', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012502', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012503', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-125-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-125-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-125-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-125-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-125-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-125-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-125-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm125-inv-a1', '0900012501'), (fx.store_a2, 'sm125-inv-a2', '0900012502')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm125-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm125-inv-a2';
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

insert into callers (name, role, claims)
select 'customer_2', 'authenticated', jsonb_build_object('sub', customer_2_u, 'role', 'authenticated',
  'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', tenant_a, 'customer_id', (select id from ids where name = 'c_a2')))
from fx;

insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_a, oa_a, '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx;

-- A customer's receipt claim at a given time, as that customer's session (the app function takes the clock).
create function pg_temp.claim(p_customer text, p_receipt text, p_business_date date, p_at timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', (select claims::text from callers where name = p_customer), true);
  v_answer := app.customer_submit_claim('sa-1', p_receipt, 60000, p_business_date, p_at);
  perform set_config('request.jwt.claims', '', true);
  return v_answer;
end;
$$;

create function pg_temp.bot_link(p_caller text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_tenant uuid := (select tenant_a from fx);
  v_claims text := (select claims::text from callers where name = p_caller);
begin
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    perform set_config('role', 'authenticated', true);
    v_value := 'ok:' || (public.start_bot_link(v_tenant, 'ops-notifications-v1') ? 'code')::text;
    perform set_config('role', 'postgres', true);
  exception when others then
    perform set_config('role', 'postgres', true);
    v_value := 'error:' || sqlstate;
  end;
  return v_value;
end;
$$;

create function pg_temp.oa_event(p_name text, p_user text, p_input jsonb, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_event uuid;
begin
  select r.event_row into v_event
  from app.receive_oa_event((select oa_a from fx), encode(sha256(convert_to(concat_ws('/', p_name, p_user, p_at), 'UTF8')), 'hex'),
    p_name, p_user, p_at, 'raw', p_at + interval '1 second') r;
  perform app.apply_oa_event(v_event, p_at + interval '1 second');
  return app.oa_customer_step(v_event, p_input, p_at + interval '2 seconds') ->> 'step';
end;
$$;

create temp table t as
-- t0 is 10:00 Vietnam time on the previous calendar day, so t0 and every offset the tests add (up to 26 hours) stay clear of the
-- local midnight whatever time of day the suite runs; the midnight itself is tested below with fixed instants
select ((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1 + time '10:00') at time zone 'Asia/Ho_Chi_Minh' as t0, app.store_business_date((select store_a1 from fx), ((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1 + time '10:00') at time zone 'Asia/Ho_Chi_Minh') as day0;

-- A signed form answer received now but sent at p_sent: the replay of an old delivery.
create function pg_temp.late_form(p_user text, p_phone text, p_sent timestamptz)
returns text
language plpgsql
as $$
declare
  v_event uuid;
begin
  select r.event_row into v_event
  from app.receive_oa_event((select oa_a from fx), encode(sha256(convert_to(concat_ws('/', 'form', p_user, p_sent), 'UTF8')), 'hex'),
    'user_submit_info', p_user, p_sent, 'raw', now()) r;
  perform app.apply_oa_event(v_event, now());
  return app.oa_customer_step(v_event, jsonb_build_object('kind', 'form', 'phone', p_phone, 'name', 'Khách Cũ'), now()) ->> 'step';
end;
$$;

select plan(30);

-- Receipt claims: at most receipt_claims_per_phone_per_day (3) submissions a business day, refused ones counted.
select is(
  (select string_agg(coalesce(pg_temp.claim('customer', 'R-125-' || n, (select day0 from t), (select t0 from t) + make_interval(mins => n)) ->> 'state', 'null'), ',' order by n)
   from generate_series(1, 3) n),
  'pending,pending,pending',
  'three receipt claims in a business day are taken');
select is(
  pg_temp.claim('customer', 'R-125-4', (select day0 from t), (select t0 + interval '10 minutes' from t)) ->> 'reason',
  'daily_cap',
  'the fourth is refused with daily_cap');
select is(
  (pg_temp.claim('customer', 'R-125-5', (select day0 from t), (select t0 + interval '11 minutes' from t)) ->> 'claims_left_today')::integer,
  0,
  'and the fifth too, with no claim left today');
select is(
  (select count(*)::integer from public.receipt_claims where membership_id = (select id from ids where name = 'm_a1') and status = 'pending'),
  3,
  'no refused claim is waiting to be matched');
select is(
  pg_temp.claim('customer_2', 'R-125-6', (select day0 from t), (select t0 + interval '12 minutes' from t)) ->> 'state',
  'pending',
  'another member''s cap is their own');
select is(
  pg_temp.claim('customer', 'R-125-7', (select day0 from t) + 1, (select t0 + interval '1 day' from t)) ->> 'state',
  'pending',
  'the next business day starts a new count');
select is(
  (select string_agg(coalesce(pg_temp.claim('customer_2', 'R-125-8' || n, (select day0 from t) + 5, (select t0 + interval '1 day 1 hour' from t) + make_interval(mins => n)) ->> 'reason', 'null'), ',' order by n)
   from generate_series(1, 2) n),
  'outside_window,outside_window',
  'refused claims are recorded');
select is(
  (select string_agg(coalesce(pg_temp.claim('customer_2', 'R-125-9' || n, (select day0 from t) + 1, (select t0 + interval '1 day 2 hours' from t) + make_interval(mins => n)) ->> 'state', 'null'), ',' order by n)
   from generate_series(1, 2) n),
  'pending,rejected',
  'so after two refused claims one more is taken and the next is refused');

-- boundary values at the business-day midnight (Vietnam time, day start 00:00): three claims in the last three minutes of a
-- day fill its cap, a fourth 30 seconds before midnight is refused, one at the stroke of midnight starts a new count
create temp table edge as
select ((((select day0 from t) + 10) + 1)::timestamp) at time zone 'Asia/Ho_Chi_Minh' as midnight, (select day0 from t) + 10 as day_before;
select is(
  (select string_agg(coalesce(pg_temp.claim('customer_2', 'R-125-E' || n, (select day_before from edge), (select midnight from edge) - make_interval(mins => 4 - n)) ->> 'state', 'null'), ',' order by n)
   from generate_series(1, 3) n),
  'pending,pending,pending',
  'boundary: three claims before midnight are taken');
select is(
  pg_temp.claim('customer_2', 'R-125-E4', (select day_before from edge), (select midnight from edge) - interval '30 seconds') ->> 'reason',
  'daily_cap',
  'boundary: the fourth, 30 seconds before midnight, is refused');
select is(
  pg_temp.claim('customer_2', 'R-125-E5', (select day_before from edge) + 1, (select midnight from edge)) ->> 'state',
  'pending',
  'boundary: at midnight sharp the new business day starts a new count');
select is(
  pg_temp.claim('customer_2', 'R-125-E6', (select day_before from edge), (select midnight from edge) + interval '1 minute') ->> 'reason',
  null,
  'boundary: a receipt of the day that has just ended is still inside the claim window and counts toward the new day, not the old one');

-- Zalo Bot link codes: at most 5 starts an hour per member.
select is(
  (select string_agg(pg_temp.bot_link('staff'), ',') from generate_series(1, 5)),
  'ok:true,ok:true,ok:true,ok:true,ok:true',
  'five Bot link starts in an hour are taken');
select is(pg_temp.bot_link('staff'), 'error:55000', 'the sixth is refused with 55000');
select is(pg_temp.bot_link('staff'), 'error:55000', 'and the seventh');
select is(pg_temp.bot_link('manager'), 'ok:true', 'another member''s starts are their own');
select is(
  (select count(*)::integer from app.notification_link_codes c
   join public.notification_channels n on n.id = c.channel_id
   where n.user_id = (select staff_u from fx)),
  1,
  'one live code at a time: every start replaced the previous code');
update app.notification_link_starts set window_started_at = window_started_at - interval '61 minutes'
where user_id = (select staff_u from fx);
select is(pg_temp.bot_link('staff'), 'ok:true', 'an hour later a start is taken again');

-- The OA join form: at most one every two minutes per OA user; the welcome at most once a day.
select is(pg_temp.oa_event('follow', 'syn-oa-user-125', '{"kind": "none"}', (select t0 from t)), 'welcome', 'a follow is welcomed');
select is(pg_temp.oa_event('user_send_text', 'syn-oa-user-125', '{"kind": "keyword", "action": "join"}', (select t0 + interval '10 seconds' from t)), 'form', 'the join keyword sends the form');
select is(pg_temp.oa_event('user_send_text', 'syn-oa-user-125', '{"kind": "keyword", "action": "join"}', (select t0 + interval '1 minute' from t)), 'form_recent', 'again within two minutes: no form');
select is(pg_temp.oa_event('user_send_text', 'syn-oa-user-125', '{"kind": "keyword", "action": "join"}', (select t0 + interval '2 minutes 9 seconds' from t)), 'form_recent', 'one second before two minutes: no form');
select is(pg_temp.oa_event('user_send_text', 'syn-oa-user-125', '{"kind": "keyword", "action": "join"}', (select t0 + interval '2 minutes 11 seconds' from t)), 'form', 'one second after two minutes: the form again');
select isnt(pg_temp.oa_event('unfollow', 'syn-oa-user-125', '{"kind": "none"}', (select t0 + interval '3 minutes' from t)), 'welcome', 'an unfollow sends nothing');
select isnt(pg_temp.oa_event('follow', 'syn-oa-user-125', '{"kind": "none"}', (select t0 + interval '4 minutes' from t)), 'welcome', 'a second follow the same day gets no second welcome');
-- Stale signed events: a form answer enrols only while its event is under 48 hours old.
select is(pg_temp.late_form('syn-oa-user-125-s', '0900012591', now() - interval '49 hours'), 'refused_stale', 'a signed form answer 49 hours old enrols nobody');
select is((select count(*)::integer from public.customers where tenant_id = (select tenant_a from fx) and phone like '%900012591'), 0, 'and writes no customer');
select matches(pg_temp.late_form('syn-oa-user-125-f', '0900012592', now() - interval '47 hours'), '^joined', 'one 47 hours old still enrols');
select is((select count(*)::integer from public.customers where tenant_id = (select tenant_a from fx) and phone like '%900012592'), 1, 'and writes its customer');

create temp table replays as
select n, (select r.outcome from app.receive_oa_event((select oa_a from fx), encode(sha256(convert_to('replayed-125', 'UTF8')), 'hex'), 'user_send_text', 'syn-oa-user-125',
  (select t0 + interval '5 minutes' from t), 'raw', (select t0 + interval '5 minutes' from t) + make_interval(secs => n)) r) as outcome
from generate_series(1, 3) n;
select is(
  (select string_agg(outcome, ',' order by n) from replays) || ':' || (select count(*) from public.oa_events where event_id = encode(sha256(convert_to('replayed-125', 'UTF8')), 'hex')),
  'recorded,duplicate,duplicate:1',
  'an event delivered three times is stored once');

select * from finish();
rollback;
