-- Security test design: a read and write matrix of every public loyalty, customer, consent, notification, OA and
-- Zalo table (OWASP API1 broken object level authorisation, API3 excessive data exposure). Each caller's view of
-- each table is compared with the rows the database owner sees, filtered by the documented rule of docs/security.md
-- 5.3: which roles read, whether a store-limited member sees only its stores, and which rows a customer session
-- reads as its own. Updates and deletes are refused to everyone but the documented writers. A new table in these
-- areas fails the last tests until it has a row.
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012101'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012102'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012101'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012102'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012101'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012102'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012103'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012101'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012102'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012101'::uuid as app_a,
  '99999999-9999-4999-8999-000000012102'::uuid as app_b,
  '77777777-7777-4777-8777-000000012101'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012101'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012102'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012101'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012102'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012103'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012104'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012105'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012106'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012107'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012108'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012109'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012110'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012111'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012112'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012113'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012114'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-tables-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-tables-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-tables-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-tables-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-tables-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm121-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm121-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm121-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
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
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-121-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012101', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012102', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012103', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-121-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-121-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-121-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-121-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-121-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-121-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-121-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm121-inv-a1', '0900012101'), (fx.store_a2, 'sm121-inv-a2', '0900012102')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm121-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm121-inv-a2';
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

-- More rows, so every table in scope holds rows of both tenants and of both A stores where it can.
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_a, '0900012198' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code) select tenant_a, store_a2, 'free-drink', 'SYN-121-P1' from fx;
do $$
begin
  perform app.loyalty_issue_checkin_code((select id from ids where name = 'm_a1'), (select store_a1 from fx), now() - interval '1 minute');
  perform app.loyalty_issue_checkin_code((select id from ids where name = 'm_a2'), (select store_a2 from fx), now() - interval '1 minute');
  perform app.loyalty_submit_claim((select id from ids where name = 'm_a2'), (select store_a2 from fx), app.store_business_date((select store_a2 from fx), now()), 'SM-121-9', 50000, now() - interval '1 minute');
  perform app.loyalty_submit_claim((select id from ids where name = 'm_b'), (select store_b1 from fx), app.store_business_date((select store_b1 from fx), now()), 'SM-121-8', 50000, now() - interval '1 minute');
  perform app.loyalty_liability((select programme_a from fx), now());
  perform app.loyalty_liability((select programme_b from fx), now());
  perform app.receive_oa_event((select oa_a from fx), encode(sha256(convert_to('security-tables-event-1', 'UTF8')), 'hex'), 'follow', 'syn-oa-user-121', now() - interval '1 minute', 'raw', now());
end;
$$;
insert into public.loyalty_refusals (tenant_id, store_id, membership_id, invoice_id, business_date, matched_path, reason)
select tenant_a, store_a2, (select id from ids where name = 'm_a2'), (select id from ids where name = 'i_a2'), current_date, 'A', 'daily_cap' from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
select fx.tenant_a, 'customer'::public.consent_subject, (select id from ids where name = v.c), 'loyalty'::public.consent_purpose, 'privacy-121-1', 'mini_app', now() - interval '19 days', '{}'::jsonb
from fx cross join lateral (values ('c_a1'), ('c_a2')) as v (c)
union all
select fx.tenant_b, 'customer', (select id from ids where name = 'c_b'), 'loyalty', 'privacy-121-1', 'mini_app', now() - interval '19 days', '{}'::jsonb from fx;
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_a, oa_a, '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx;
insert into public.oa_users (tenant_id, oa_id, oa_user_id, following, followed_at, customer_id, enrolled_at)
select tenant_a, oa_a, 'syn-oa-user-121', true, now() - interval '2 days', (select id from ids where name = 'c_a1'), now() - interval '1 day' from fx;
insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_a, app_a, 'syn-zalo-121-staff', staff_u, 'Nhân viên' from fx;
-- ADR-060: the native till's tables, with rows in both tenants and at both A stores.
insert into public.item_option_groups (tenant_id, pos_account_id, external_id, name)
select tenant_a, account_a, 'SM121-G', 'Topping' from fx union all
select tenant_b, account_b, 'SM121-G', 'Topping' from fx;
insert into public.item_option_group_options (tenant_id, pos_account_id, group_external_id, item_external_id)
select tenant_a, account_a, 'SM121-G', 'SM121-OPT' from fx union all
select tenant_b, account_b, 'SM121-G', 'SM121-OPT' from fx;
insert into public.item_option_group_targets (tenant_id, pos_account_id, group_external_id, item_external_id)
select tenant_a, account_a, 'SM121-G', 'SM121-ITEM' from fx union all
select tenant_b, account_b, 'SM121-G', 'SM121-ITEM' from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled)
select store_a1, tenant_a, 'native', true from fx union all
select store_a2, tenant_a, 'ipos', false from fx union all
select store_b1, tenant_b, 'native', true from fx;
insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason)
select tenant_a, store_a1, date '2027-01-01', date '2027-01-02', 'Nghỉ' from fx union all
select tenant_a, store_a2, date '2027-01-01', date '2027-01-02', 'Nghỉ' from fx union all
select tenant_b, store_b1, date '2027-01-01', date '2027-01-02', 'Nghỉ' from fx;
insert into public.menu_categories (tenant_id, brand_id, name)
select tenant_a, brand_a, 'Đồ uống' from fx union all
select tenant_b, brand_b, 'Đồ uống' from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name)
select c.tenant_id, c.brand_id, c.id, 'Cà phê' from public.menu_categories c cross join fx where c.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.menu_item_sizes (tenant_id, brand_id, item_id, price, is_default)
select i.tenant_id, i.brand_id, i.id, 29000, true from public.menu_items i cross join fx where i.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.menu_option_groups (tenant_id, brand_id, name)
select tenant_a, brand_a, 'Đá' from fx union all
select tenant_b, brand_b, 'Đá' from fx;
insert into public.menu_options (tenant_id, brand_id, group_id, name)
select g.tenant_id, g.brand_id, g.id, 'Ít đá' from public.menu_option_groups g cross join fx where g.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id)
select i.tenant_id, i.brand_id, i.id, g.id from public.menu_items i join public.menu_option_groups g on g.brand_id = i.brand_id cross join fx where i.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.menu_store_items (tenant_id, store_id, item_id, offered)
select i.tenant_id, s.store_id, i.id, true
from public.menu_items i
cross join fx
cross join lateral (values (fx.store_a1), (fx.store_a2), (fx.store_b1)) as s (store_id)
join public.brands b on b.id = i.brand_id and s.store_id = any (b.store_ids)
where i.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.menu_imports (brand_id, tenant_id, store_id, pos_account_id, counts)
select brand_a, tenant_a, store_a1, account_a, '{}'::jsonb from fx union all
select brand_b, tenant_b, store_b1, account_b, '{}'::jsonb from fx;
insert into public.store_tables (tenant_id, store_id, label)
select tenant_a, store_a1, 'Bàn 1' from fx union all
select tenant_a, store_a2, 'Bàn 1' from fx union all
select tenant_b, store_b1, 'Bàn 1' from fx;
insert into public.table_calls (tenant_id, store_id, table_id)
select t.tenant_id, t.store_id, t.id from public.store_tables t cross join fx where t.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.orders (tenant_id, brand_id, store_id, source, customer_login_id, order_type, table_id, table_label, business_date, order_no, status,
  payment_method, subtotal, total, request_id, request_hash, placed_at, accepted_at)
select s.tenant_id, b.id, s.id, 'app', l.id, 'table', t.id, t.label, current_date, 1, 'accepted', 'counter', 29000, 29000, gen_random_uuid(), repeat('a', 64), now(), now()
from public.stores s
cross join fx
join public.brands b on b.tenant_id = s.tenant_id and s.id = any (b.store_ids)
join public.store_tables t on t.store_id = s.id
left join app.customer_logins l on l.user_id = case when s.tenant_id = fx.tenant_a then fx.customer_u else fx.customer_b_u end
where s.id in (fx.store_a1, fx.store_a2, fx.store_b1);
insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_name, quantity, unit_price, line_total, counts_for_stamps)
select o.tenant_id, o.store_id, o.id, 1, 'Cà phê', 1, 29000, 29000, true from public.orders o cross join fx where o.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.order_events (tenant_id, store_id, order_id, kind, action, to_state, actor_kind, occurred_at)
select o.tenant_id, o.store_id, o.id, 'status', 'placed', 'accepted', 'customer', now() from public.orders o cross join fx where o.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, requested_at, settled_at)
select o.tenant_id, o.store_id, o.id, 'cash', 29000, 'succeeded', now(), now() from public.orders o cross join fx where o.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.order_refunds (tenant_id, store_id, order_id, method, amount, status, reason, requested_at)
select o.tenant_id, o.store_id, o.id, 'cash', 1000, 'due', 'synthetic', now() from public.orders o cross join fx where o.tenant_id in (fx.tenant_a, fx.tenant_b);
insert into public.customer_order_blocks (tenant_id, store_id, customer_login_id, blocked_until, reason)
select o.tenant_id, o.store_id, o.customer_login_id, now() + interval '1 day', 'suspected_prank' from public.orders o cross join fx
where o.tenant_id in (fx.tenant_a, fx.tenant_b) and o.customer_login_id is not null;

-- Who reads what (docs/security.md 5.3, docs/api.md section 4). Reader groups:
--   data: owner, owner_a1, manager, manager_a1, viewer, staff, staff_a2 (and owner_b in tenant B)
--   omv: owners, managers and viewers; om: owners and managers; om_all: owners and managers with every store
-- scoped: a store-limited reader sees only its stores' rows (and rows without a store).
-- own: the rows a customer session of {cust} reads; null when it reads none.
create temp table tables_in_scope (
  tbl text primary key,
  readers text not null,
  scoped boolean not null,
  own text,
  writers text[] not null default '{}'
);
insert into tables_in_scope (tbl, readers, scoped, own, writers) values
  ('loyalty_programmes', 'data', false, $$status <> 'draft'$$, '{owner,manager}'),
  ('loyalty_staff_phones', 'om', false, null, '{owner,owner_a1,manager,manager_a1}'),
  ('coupon_rails', 'data', true, null, '{owner,manager}'),
  ('coupon_rail_rewards', 'data', true, null, '{owner,manager}'),
  ('coupon_codes', 'om', true, null, '{}'),
  ('coupons', 'data', false, 'active', '{owner,manager}'),
  ('memberships', 'omv', false, 'customer_id = {cust}', '{}'),
  ('loyalty_ledger', 'omv', true, 'membership_id in (select m.id from public.memberships m where m.customer_id = {cust})', '{}'),
  ('stamps', 'omv', false, 'membership_id in (select m.id from public.memberships m where m.customer_id = {cust})', '{}'),
  ('pending_checkins', 'omv', true, 'membership_id in (select m.id from public.memberships m where m.customer_id = {cust})', '{}'),
  ('receipt_claims', 'omv', true, 'membership_id in (select m.id from public.memberships m where m.customer_id = {cust})', '{}'),
  ('redemptions', 'omv', true, 'membership_id in (select m.id from public.memberships m where m.customer_id = {cust})', '{}'),
  ('loyalty_refusals', 'omv', true, null, '{}'),
  ('loyalty_queue', 'om', true, null, '{}'),
  ('loyalty_liability_daily', 'omv', false, null, '{}'),
  ('customers', 'data', false, 'id = {cust}', '{}'),
  ('consent_records', 'data', false, null, '{owner,owner_a1,manager,manager_a1}'),
  ('data_subject_requests', 'om_all', false, null, '{owner,manager}'),
  ('data_subject_request_actions', 'om_all', false, null, '{}'),
  ('oa_menus', 'om', false, null, '{owner}'),
  ('oas', 'om', false, null, '{owner}'),
  ('zalo_apps', 'om', false, null, '{owner}'),
  ('brands', 'om', false, null, '{owner}'),
  ('mini_apps', 'om', false, null, '{owner}'),
  ('zbs_templates', 'om', false, null, '{owner}'),
  ('zalo_identities', 'om', false, null, '{}'),
  ('mini_app_visits', 'om', false, null, '{}'),
  ('oa_events', 'nobody', false, null, '{}'),
  ('oa_users', 'nobody', false, null, '{}'),
  ('zalo_tokens', 'nobody', false, null, '{}'),
  ('notification_channels', 'channels', false, null, '{}'),
  ('outbound_messages', 'outbound', false, null, '{}'),
  ('loyalty_store_settings', 'omv', true, null, '{}'),
  ('loyalty_audit_events', 'om', true, null, '{}'),
  ('loyalty_counter_codes', 'nobody', false, null, '{}'),
  ('bill_captures', 'omv', true, null, '{}'),
  ('bill_confirmations', 'om', false, null, '{}'),
  ('bill_audits', 'om', true, null, '{}'),
  -- ADR-060: the native till (docs/security.md 5.3).
  ('item_option_groups', 'data', false, null, '{}'),
  ('item_option_group_options', 'data', false, null, '{}'),
  ('item_option_group_targets', 'data', false, null, '{}'),
  ('store_ordering_settings', 'omv', true, null, '{owner,owner_a1,manager,manager_a1}'),
  ('ordering_closures', 'omv', true, null, '{owner,owner_a1,manager,manager_a1}'),
  ('menu_categories', 'omv', false, null, '{owner,manager}'),
  ('menu_items', 'omv', false, null, '{owner,manager}'),
  ('menu_item_sizes', 'omv', false, null, '{owner,manager}'),
  ('menu_option_groups', 'omv', false, null, '{owner,manager}'),
  ('menu_options', 'omv', false, null, '{owner,manager}'),
  ('menu_item_option_groups', 'omv', false, null, '{owner,manager}'),
  ('menu_store_items', 'omv', true, null, '{owner,owner_a1,manager,manager_a1}'),
  ('menu_price_changes', 'omv', false, null, '{}'),
  ('menu_imports', 'omv', false, null, '{}'),
  ('store_tables', 'omv', true, null, '{owner,owner_a1,manager,manager_a1}'),
  ('table_calls', 'omv', true, null, '{}'),
  ('orders', 'omv', true, null, '{}'),
  ('order_lines', 'omv', true, null, '{}'),
  ('order_events', 'omv', true, null, '{}'),
  ('customer_order_blocks', 'om', true, null, '{owner,owner_a1,manager,manager_a1}'),
  ('order_payments', 'omv', true, null, '{}'),
  ('order_refunds', 'omv', true, null, '{}');

create function pg_temp.signature_sql(p_table text, p_filter text default 'true')
returns text
language sql
stable
as $$
  select format(
    'select format(''a=%%s a2=%%s b=%%s'', count(*) filter (where tenant_id = %L), count(*) filter (where tenant_id = %L and %s), count(*) filter (where tenant_id = %L)) from public.%I where %s',
    (select tenant_a from fx), (select tenant_a from fx),
    case when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'store_id')
      then format('store_id = %L', (select store_a2 from fx)) else 'false' end,
    (select tenant_b from fx), p_table, p_filter
  );
$$;

create function pg_temp.truth(p_table text, p_filter text default 'true')
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.signature_sql(p_table, p_filter) into v_value;
  return v_value;
end;
$$;

-- The expected signature of one caller, from the rows as the database owner sees them.
create function pg_temp.expect_read(p_table text, p_caller text)
returns text
language plpgsql
as $$
declare
  t tables_in_scope;
  v_all text := pg_temp.truth(p_table);
  v_a integer := substring(v_all from 'a=([0-9]+)')::integer;
  v_a2 integer := substring(v_all from 'a2=([0-9]+)')::integer;
  v_b integer := substring(v_all from 'b=([0-9]+)')::integer;
  v_own text;
  v_reads boolean;
begin
  select * into strict t from tables_in_scope where tbl = p_table;
  if p_caller = 'anon' then
    return '^error:42501$';
  end if;
  -- The service role bypasses RLS and holds Supabase's default grant on every public table, the closed caches included
  -- (pgTAP 42 relies on it for zalo_tokens); it is trusted like the database owner.
  if p_caller = 'service' then
    return '^ok:' || v_all || '$';
  end if;
  if t.readers = 'nobody' then
    return '^error:42501$';
  end if;
  if p_caller in ('customer', 'customer_b') then
    if t.own is null then
      return '^ok:a=0 a2=0 b=0$';
    end if;
    v_own := pg_temp.truth(p_table, replace(t.own, '{cust}', quote_literal((select id from ids where name = case p_caller when 'customer' then 'c_a1' else 'c_b' end))));
    if p_caller = 'customer' then
      return '^ok:' || regexp_replace(v_own, 'b=[0-9]+', 'b=0') || '$';
    end if;
    return '^ok:a=0 a2=0 ' || substring(v_own from 'b=[0-9]+') || '$';
  end if;
  if p_caller = 'service' then
    return '^ok:' || v_all || '$';
  end if;
  if t.readers = 'channels' then
    return case p_caller when 'owner' then '^ok:a=1 a2=0 b=0$' when 'manager' then '^ok:a=1 a2=0 b=0$' when 'staff' then '^ok:a=1 a2=0 b=0$' else '^ok:a=0 a2=0 b=0$' end;
  end if;
  if t.readers = 'outbound' then
    return '^ok:a=[0-9]+ a2=[0-9]+ b=0$';
  end if;
  v_reads := case t.readers
    when 'data' then p_caller in ('owner', 'owner_a1', 'manager', 'manager_a1', 'viewer', 'staff', 'staff_a2', 'owner_b')
    when 'omv' then p_caller in ('owner', 'owner_a1', 'manager', 'manager_a1', 'viewer', 'owner_b')
    when 'om' then p_caller in ('owner', 'owner_a1', 'manager', 'manager_a1', 'owner_b')
    when 'om_all' then p_caller in ('owner', 'manager', 'owner_b')
  end;
  if not v_reads then
    return '^ok:a=0 a2=0 b=0$';
  end if;
  if p_caller = 'owner_b' then
    return format('^ok:a=0 a2=0 b=%s$', v_b);
  end if;
  if t.scoped and p_caller in ('owner_a1', 'manager_a1', 'staff') then
    return format('^ok:a=%s a2=0 b=0$', v_a - v_a2);
  end if;
  if t.scoped and p_caller = 'staff_a2' then
    return format('^ok:a=%s a2=%s b=0$', v_a2, v_a2);
  end if;
  return format('^ok:a=%s a2=%s b=0$', v_a, v_a2);
end;
$$;

create temp table read_cells as
select t.tbl, c.name as caller, pg_temp.expect_read(t.tbl, c.name) as pattern, pg_temp.signature_sql(t.tbl) as statement
from tables_in_scope t cross join callers c;

-- Writes: every caller but the documented writers changes nothing, by a missing privilege or by RLS.
create temp table write_cells as
select t.tbl, c.name as caller, w.kind,
  case when c.name = any (t.writers) then '^(ok:[0-9]+|error:[0-9A-Z]{5})$' else '^(ok:0|error:42501)$' end as pattern,
  case w.kind
    when 'update' then format('with x as (update public.%I set tenant_id = tenant_id where tenant_id = %L returning 1) select count(*) from x', t.tbl, fx.tenant_a)
    else format('with x as (delete from public.%I where tenant_id = %L returning 1) select count(*) from x', t.tbl, fx.tenant_a)
  end as statement
from tables_in_scope t cross join callers c cross join fx cross join (values ('update'), ('delete')) as w (kind)
where c.name <> 'service';

create temp table tables_found as
select c.relname::text as tbl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  and c.relname ~ '(loyalty|coupon|membership|stamps|checkin|claim|redemption|customer|consent|data_subject|outbound|notification|^oa|zalo|mini_app|brand|zbs|^bill_|^menu_|ordering|order|store_tables|item_option|table_calls)';

select plan((select count(*)::integer from read_cells) + (select count(*)::integer from write_cells) + 4);

select matches(pg_temp.run_as(caller, statement), pattern, format('%s read as %s', tbl, caller))
from read_cells order by tbl, caller;

select matches(pg_temp.run_as(caller, statement), pattern, format('%s %s as %s', tbl, kind, caller))
from write_cells order by tbl, kind, caller;

select is(
  (select coalesce(string_agg(tbl, ', ' order by tbl), '') from tables_found where tbl not in (select tbl from tables_in_scope)),
  '',
  'every public loyalty, customer, consent, notification, OA and Zalo table has a row in the table matrix'
);
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in (select tbl from tables_in_scope) and c.relkind = 'r' and not c.relrowsecurity),
  '',
  'every table in the matrix has row-level security'
);
select is(
  (select coalesce(string_agg(t.tbl || ':' || p.priv, ', ' order by t.tbl, p.priv), '')
   from tables_in_scope t cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p (priv)
   where t.writers = '{}' and has_table_privilege('authenticated', 'public.' || t.tbl, p.priv)),
  '',
  'authenticated holds no write privilege on a table that no client writes'
);
select is(
  (select coalesce(string_agg(t.tbl || ':' || p.priv, ', ' order by t.tbl, p.priv), '')
   from tables_in_scope t cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p (priv)
   where has_table_privilege('anon', 'public.' || t.tbl, p.priv)),
  '',
  'anon holds no privilege on any table in the matrix'
);

select * from finish();
rollback;
