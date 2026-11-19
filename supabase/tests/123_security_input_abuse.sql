-- Security test design: input abuse with boundary values and equivalence classes (ISTQB boundary value analysis;
-- OWASP ASVS V5 validation, API8 injection). Each documented limit of a public loyalty, customer, staff, report,
-- notification and staff-phone function is called at the limit and one past it, and every text and number argument
-- gets hostile values: empty, blank, control characters, SQL and pattern meta characters, very long strings,
-- negative, zero and huge numbers, dates outside the windows. The answer must be the documented 22023 or 42501 or a
-- refusal answered as data, never another error (which PostgREST turns into a 500), and an error never leaves a
-- write behind (the fingerprint of every table these functions write is compared).
begin;

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000012301'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000012302'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000012301'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000012302'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000012301'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000012302'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000012303'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012301'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000012302'::uuid as brand_b,
  '99999999-9999-4999-8999-000000012301'::uuid as app_a,
  '99999999-9999-4999-8999-000000012302'::uuid as app_b,
  '77777777-7777-4777-8777-000000012301'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012301'::uuid as programme_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000012302'::uuid as programme_b,
  'eeeeeeee-eeee-4eee-8eee-000000012301'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000012302'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012303'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000012304'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000012305'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012306'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000012307'::uuid as publisher_u,
  'eeeeeeee-eeee-4eee-8eee-000000012308'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000012309'::uuid as outsider_u,
  'eeeeeeee-eeee-4eee-8eee-000000012310'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012311'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000012312'::uuid as customer_2_u,
  'eeeeeeee-eeee-4eee-8eee-000000012313'::uuid as visitor_u,
  'eeeeeeee-eeee-4eee-8eee-000000012314'::uuid as customer_b_u;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'security-abuse-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of, 'customer_id', null) end
from fx
cross join lateral (
  values
    (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null),
    (fx.staff_u, null), (fx.publisher_u, null), (fx.owner_b_u, null), (fx.outsider_u, null), (fx.staff_a2_u, null),
    (fx.customer_u, fx.tenant_a), (fx.customer_2_u, fx.tenant_a), (fx.visitor_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);

insert into public.tenants (id, slug, name)
select tenant_a, 'security-abuse-pgtap-a', 'Security matrix pgTAP A' from fx
union all
select tenant_b, 'security-abuse-pgtap-b', 'Security matrix pgTAP B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'security-abuse-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'security-abuse-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_a1, tenant_a, account_a, 'sm123-ext-a1', 'sa-1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'sm123-ext-a2', 'sa-2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'sm123-ext-b1', 'sb-1', 'Synthetic store B1' from fx;
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
select t.id, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-123-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-01-01 00:00+07'
from fx cross join lateral (values (fx.tenant_a), (fx.tenant_b)) as t (id);

create temp table ids (name text primary key, id uuid);
insert into ids select 'c_a1', app.loyalty_customer_for_phone(tenant_a, '0900012301', now() - interval '20 days') from fx;
insert into ids select 'c_a2', app.loyalty_customer_for_phone(tenant_a, '0900012302', now() - interval '20 days') from fx;
insert into ids select 'c_b', app.loyalty_customer_for_phone(tenant_b, '0900012303', now() - interval '20 days') from fx;
insert into ids select 'm_a1', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a1'), 'mini_app', store_a1, brand_a, 'syn-zalo-123-1', now() - interval '19 days') from fx;
insert into ids select 'm_a2', app.loyalty_join(tenant_a, (select id from ids where name = 'c_a2'), 'mini_app', store_a2, brand_a, 'syn-zalo-123-2', now() - interval '19 days') from fx;
insert into ids select 'm_b', app.loyalty_join(tenant_b, (select id from ids where name = 'c_b'), 'mini_app', store_b1, brand_b, 'syn-zalo-123-4', now() - interval '19 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-123-1', customer_u, (select id from ids where name = 'c_a1') from fx
union all
select tenant_a, app_a, 'syn-zalo-123-2', customer_2_u, (select id from ids where name = 'c_a2') from fx
union all
select tenant_a, app_a, 'syn-zalo-123-3', visitor_u, null from fx
union all
select tenant_b, app_b, 'syn-zalo-123-4', customer_b_u, (select id from ids where name = 'c_b') from fx;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select fx.tenant_a, v.store, fx.account_a, v.ext, v.ext, now() - interval '3 hours', app.store_business_date(v.store, now() - interval '3 hours'), 60000, 60000, 60000, v.phone
from fx cross join lateral (values (fx.store_a1, 'sm123-inv-a1', '0900012301'), (fx.store_a2, 'sm123-inv-a2', '0900012302')) as v (store, ext, phone);
insert into ids select 'i_a1', id from public.invoices where external_id = 'sm123-inv-a1';
insert into ids select 'i_a2', id from public.invoices where external_id = 'sm123-inv-a2';
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

insert into ph select 'today_a1', app.store_business_date(store_a1, now())::text from fx;

-- What a call may change: one fingerprint over the tables the functions below write.
create function pg_temp.fingerprint()
returns text
language sql
as $$
  select concat_ws(',',
    (select count(*) from public.loyalty_ledger), (select count(*) from public.pending_checkins), (select count(*) from public.receipt_claims),
    (select count(*) from public.redemptions where verified_at is not null), (select count(*) from public.redemptions), (select count(*) from app.loyalty_requests),
    (select count(*) from app.loyalty_requests where status = 'pending'), (select count(*) from public.loyalty_queue where state = 'open'),
    (select count(*) from public.consent_records where revoked_at is null), (select count(*) from public.data_subject_requests),
    (select count(*) from public.notification_channels), (select coalesce(sum(cardinality(muted_rules)), 0) from public.notification_channels),
    (select count(*) from public.staff_roster where phone is not null), (select count(*) from app.notification_link_codes),
    (select string_agg(loyalty_adjust_max_stamps || '/' || loyalty_adjust_max_points, ';' order by id) from public.tenants where id in (select tenant_a from fx)));
$$;

-- One call as one caller: ok:<first column> or error:<SQLSTATE>, then |w when the fingerprint moved and |n when not.
create function pg_temp.abuse(p_caller text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_caller callers;
  v_sql text := pg_temp.fill(p_statement);
  v_before text := pg_temp.fingerprint();
  v_value text;
begin
  select * into strict v_caller from callers where name = p_caller;
  begin
    perform set_config('request.jwt.claims', v_caller.claims::text, true);
    perform set_config('role', v_caller.role, true);
    begin
      execute v_sql into v_value;
      v_value := 'ok:' || coalesce(v_value, 'null');
    exception when others then
      v_value := 'error:' || sqlstate;
    end;
    perform set_config('role', 'postgres', true);
    v_value := v_value || case when pg_temp.fingerprint() = v_before then '|n' else '|w' end;
    raise exception using errcode = 'P0099', message = v_value;
  exception when others then
    if sqlstate = 'P0099' then
      v_value := sqlerrm;
    else
      v_value := 'harness:' || sqlstate;
    end if;
  end;
  return v_value;
end;
$$;

-- Boundary values with their exact documented outcome (docs/api.md 3.19 to 3.24, 3.5, 3.10, 3.12).
-- BAD is 22023 with nothing written; ANSWER a refusal answered as data, with nothing written.
create temp table boundaries (label text primary key, caller text not null, statement text not null, expect text not null);
insert into boundaries values
-- customer_submit_claim: receipt 1 to 40 characters without spaces or control characters; amount above 0, at most 100,000,000.
  ('claim: a 40-character receipt is taken', 'customer', $$select public.customer_submit_claim('sa-1', repeat('R', 40), 60000) ->> 'state'$$, '^ok:(pending|queued|matched|rejected)\|w$'),
  ('claim: a 41-character receipt', 'customer', $$select public.customer_submit_claim('sa-1', repeat('R', 41), 60000)::text$$, 'BAD'),
  ('claim: an empty receipt', 'customer', $$select public.customer_submit_claim('sa-1', '', 60000)::text$$, 'BAD'),
  ('claim: a blank receipt', 'customer', $$select public.customer_submit_claim('sa-1', '   ', 60000)::text$$, 'BAD'),
  ('claim: a receipt with a space', 'customer', $$select public.customer_submit_claim('sa-1', 'R 1', 60000)::text$$, 'BAD'),
  ('claim: a receipt with a tab', 'customer', $$select public.customer_submit_claim('sa-1', E'R\t1', 60000)::text$$, 'BAD'),
  ('claim: a receipt with a line break', 'customer', $$select public.customer_submit_claim('sa-1', E'R\n1', 60000)::text$$, 'BAD'),
  ('claim: a null receipt', 'customer', $$select public.customer_submit_claim('sa-1', null, 60000)::text$$, 'BAD'),
  ('claim: an amount of 0', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 0)::text$$, 'BAD'),
  ('claim: a negative amount', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', -1)::text$$, 'BAD'),
  ('claim: an amount of 0.01 is taken', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 0.01) ->> 'state'$$, '^ok:[a-z]+\|w$'),
  ('claim: an amount of 100,000,000 is taken', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 100000000) ->> 'state'$$, '^ok:[a-z]+\|w$'),
  ('claim: an amount of 100,000,000.01', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 100000000.01)::text$$, 'BAD'),
  ('claim: an amount that is not a number', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 'NaN'::numeric)::text$$, 'BAD'),
  ('claim: a null amount', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', null)::text$$, 'BAD'),
  ('claim: a huge amount', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 1e30)::text$$, 'BAD'),
  ('claim: tomorrow''s business date is refused as an answer', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 60000, '{today_a1}'::date + 1) ->> 'state'$$, '^(ok:rejected\|w|error:22023\|n)$'),
  ('claim: a business date long past is refused as an answer', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 60000, '{today_a1}'::date - 30) ->> 'state'$$, '^(ok:rejected\|w|error:22023\|n)$'),
  ('claim: the year 1 is refused', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 60000, date '0001-01-01') ->> 'state'$$, '^(ok:rejected\|w|error:22023\|n)$'),
  ('claim: an infinite date is refused', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-1', 60000, 'infinity'::date) ->> 'state'$$, '^(ok:rejected\|w|error:22023\|n)$'),
  ('claim: a store link key in another case', 'customer', $$select public.customer_submit_claim('SA-1', 'R-123-1', 60000)::text$$, 'BAD'),
-- customer store link keys: 1 to 64 of A-Z a-z 0-9 . _ -, compared exactly among the app's stores.
  ('member code: an unknown 64-character link key', 'customer', $$select public.customer_member_code(repeat('s', 64))::text$$, 'BAD'),
  ('member code: a 65-character link key', 'customer', $$select public.customer_member_code(repeat('s', 65))::text$$, 'BAD'),
  ('member code: an empty link key', 'customer', $$select public.customer_member_code('')::text$$, 'BAD'),
  ('member code: a null link key', 'customer', $$select public.customer_member_code(null)::text$$, 'BAD'),
  ('member code: a link key with SQL', 'customer', $$select public.customer_member_code($q$sa-1' or '1'='1$q$)::text$$, 'BAD'),
  ('member code: a link key with a pattern character', 'customer', $$select public.customer_member_code('sa-%')::text$$, 'BAD'),
  ('member code: another tenant''s link key', 'customer', $$select public.customer_member_code('sb-1')::text$$, 'BAD'),
  ('coupons: an unknown link key', 'customer', $$select count(*) from public.customer_coupons('sa-9')$$, 'BAD'),
  ('redeem: an unknown reward is an answer', 'customer', $$select public.customer_redeem(gen_random_uuid(), 'sa-1') ->> 'refusal'$$, '^ok:coupon_unavailable\|n$'),
  ('redeem: another tenant''s link key', 'customer', $$select public.customer_redeem('{coupon}'::uuid, 'sb-1')::text$$, 'BAD'),
-- staff_record_checkin: a phone or a code; a code of 6 digits or the member-code payload; an amount 0 to 100,000,000.
  ('check-in: neither phone nor code', 'staff', $$select public.staff_record_checkin('{store_a1}', null, null)::text$$, 'BAD'),
  ('check-in: both phone and code', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012301', '123456')::text$$, 'BAD'),
  ('check-in: a 5-digit code', 'staff', $$select public.staff_record_checkin('{store_a1}', null, '12345')::text$$, 'BAD'),
  ('check-in: a 7-digit code', 'staff', $$select public.staff_record_checkin('{store_a1}', null, '1234567')::text$$, 'BAD'),
  ('check-in: a code with letters', 'staff', $$select public.staff_record_checkin('{store_a1}', null, '12345a')::text$$, 'BAD'),
  ('check-in: an unknown 6-digit code is an answer', 'staff', $$select public.staff_record_checkin('{store_a1}', null, '000000') ->> 'refusal'$$, '^ok:code_unknown\|[nw]$'),
  ('check-in: a payload naming another store is an answer', 'staff', $$select public.staff_record_checkin('{store_a1}', null, 'fnb-member:1:sa-2:000000') ->> 'refusal'$$, '^ok:(wrong_store|code_unknown)\|[nw]$'),
  ('check-in: a phone that is not a phone is an answer', 'staff', $$select public.staff_record_checkin('{store_a1}', $q$' or '1'='1$q$) ->> 'refusal'$$, '^ok:invalid_phone\|[nw]$'),
  ('check-in: an amount of -1', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012301', null, -1)::text$$, 'BAD'),
  ('check-in: an amount of 100,000,001', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012301', null, 100000001)::text$$, 'BAD'),
  ('check-in: an amount of 100,000,000 is taken', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012301', null, 100000000) ->> 'state'$$, '^ok:[a-z]+\|w$'),
  ('check-in: an amount of 0', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012302', null, 0)::text$$, 'BAD'),
  ('check-in: an amount of 0.01 is taken', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012302', null, 0.01) ->> 'state'$$, '^ok:[a-z]+\|w$'),
-- staff_member_lookup: one of phone and membership; nothing about non-members.
  ('lookup: neither phone nor membership', 'staff', $$select public.staff_member_lookup('{store_a1}', null, null)::text$$, 'BAD'),
  ('lookup: both phone and membership', 'staff', $$select public.staff_member_lookup('{store_a1}', '0900012301', '{m_a1}')::text$$, 'BAD'),
  ('lookup: SQL in the phone is not found', 'staff', $$select public.staff_member_lookup('{store_a1}', $q$0900012301' or '1'='1$q$) ->> 'found'$$, '^ok:false\|n$'),
  ('lookup: a wildcard phone is not found', 'staff', $$select public.staff_member_lookup('{store_a1}', '%') ->> 'found'$$, '^ok:false\|n$'),
  ('lookup: another tenant''s member is not found', 'staff', $$select public.staff_member_lookup('{store_a1}', null, '{m_b}') ->> 'found'$$, '^ok:false\|n$'),
  ('lookup: a 100,000-character phone', 'staff', $$select public.staff_member_lookup('{store_a1}', repeat('9', 100000)) ->> 'found'$$, '^(ok:false\|n|error:22023\|n)$'),
-- staff_request: reason 1 to 200 characters, at most 20 stamps or 100,000 points, adjustment or dispute.
  ('request: a 200-character reason is taken', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', repeat('l', 200)) ->> 'state'$$, '^ok:pending\|w$'),
  ('request: a 201-character reason', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', repeat('l', 201))::text$$, 'BAD'),
  ('request: an empty reason', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', '')::text$$, 'BAD'),
  ('request: a blank reason', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', '   ')::text$$, 'BAD'),
  ('request: a reason with a control character', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', E'Lý do\x07')::text$$, 'BAD'),
  ('request: another kind', 'staff', $$select public.staff_request('{store_a1}', 'Adjustment', '{m_a1}', 'Lý do', 1)::text$$, 'BAD'),
  ('request: a kind with SQL', 'staff', $$select public.staff_request('{store_a1}', $q$dispute'--$q$, '{m_a1}', 'Lý do')::text$$, 'BAD'),
  ('request: 20 stamps are taken', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 20) ->> 'state'$$, '^ok:pending\|w$'),
  ('request: 21 stamps', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 21)::text$$, 'BAD'),
  ('request: minus 21 stamps', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', -21)::text$$, 'BAD'),
  ('request: 100,000 points are taken', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 0, 100000) ->> 'state'$$, '^ok:pending\|w$'),
  ('request: 100,001 points', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 0, 100001)::text$$, 'BAD'),
  ('request: the largest integer of points', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 0, 2147483647)::text$$, 'BAD'),
  ('request: an adjustment that moves nothing', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 0, 0)::text$$, 'BAD'),
  ('request: a dispute that takes stamps', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', 'Lý do', -1)::text$$, 'BAD'),
  ('request: an unknown membership', 'staff', $$select public.staff_request('{store_a1}', 'dispute', gen_random_uuid(), 'Lý do')::text$$, 'BAD'),
-- staff_decide_loyalty_request: approved or refused, a refusal with a reason of at most 500 characters.
  ('decide: another decision', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'approve')::text$$, 'BAD'),
  ('decide: a refusal without a reason', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused')::text$$, 'BAD'),
  ('decide: a 500-character reason is taken', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused', repeat('l', 500)) ->> 'state'$$, '^ok:refused\|w$'),
  ('decide: a 501-character reason', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused', repeat('l', 501))::text$$, 'BAD'),
  ('decide: 21 stamps', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'approved', 'Đồng ý', 21)::text$$, 'BAD'),
  ('decide: an approved dispute that takes', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'approved', 'Đồng ý', -1)::text$$, 'BAD'),
  ('decide: an unknown request', 'manager', $$select public.staff_decide_loyalty_request(gen_random_uuid(), 'refused', 'Không')::text$$, 'DENY'),
-- staff_verify_redemption: a code of 1 to 64 characters without spaces, or its QR payload.
  ('verify: an empty code', 'staff', $$select public.staff_verify_redemption('{store_a1}', '')::text$$, 'BAD'),
  ('verify: a code with a space', 'staff', $$select public.staff_verify_redemption('{store_a1}', 'AB CD')::text$$, 'BAD'),
  ('verify: a 65-character code', 'staff', $$select public.staff_verify_redemption('{store_a1}', repeat('A', 65))::text$$, 'BAD'),
  ('verify: an unknown 64-character code is an answer', 'staff', $$select public.staff_verify_redemption('{store_a1}', repeat('A', 64)) ->> 'refusal'$$, '^ok:unknown\|n$'),
  ('verify: SQL in the code is an answer', 'staff', $$select public.staff_verify_redemption('{store_a1}', $q$x'or'1'='1$q$) ->> 'refusal'$$, '^ok:unknown\|n$'),
  ('verify: a wildcard code is an answer', 'staff', $$select public.staff_verify_redemption('{store_a1}', '%') ->> 'refusal'$$, '^ok:unknown\|n$'),
  ('verify: the code in its QR payload', 'staff', $$select public.staff_verify_redemption('{store_a1}', 'fnb-redeem:1:{hold_code}') ->> 'state'$$, '^ok:verified\|w$'),
  ('verify: the code in lower case is an answer', 'staff', $$select public.staff_verify_redemption('{store_a1}', lower('{hold_code}')) ->> 'state'$$, '^ok:(verified\|w|refused\|n)$'),
-- resolve_loyalty_queue_item: a reason of 1 to 200 characters without control characters; a choice among the candidates.
  ('resolve: an empty reason', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', null, '')::text$$, 'BAD'),
  ('resolve: a 201-character reason', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', null, repeat('l', 201))::text$$, 'BAD'),
  ('resolve: a 200-character reason is taken', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', null, repeat('l', 200)) ->> 'state'$$, '^ok:[a-z]+\|w$'),
  ('resolve: a reason with a control character', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', null, E'Bỏ\x1bqua')::text$$, 'BAD'),
  ('resolve: a choice that is no candidate', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', gen_random_uuid(), 'Chọn')::text$$, 'BAD'),
  ('resolve: an unknown item', 'manager', $$select public.resolve_loyalty_queue_item(gen_random_uuid(), null, 'Bỏ qua')::text$$, 'DENY'),
-- loyalty_members_page: limit 1 to 1,000; a page key; a search of 1 to 3 digits or a membership id.
  ('members page: a limit of 0', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 0)$$, 'BAD'),
  ('members page: a limit of 1 is taken', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 1)$$, '^ok:1\|n$'),
  ('members page: a limit of 1,000 is taken', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 1000)$$, '^ok:2\|n$'),
  ('members page: a limit of 1,001', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 1001)$$, 'BAD'),
  ('members page: a negative limit', 'owner', $$select count(*) from public.loyalty_members_page(null, null, -1)$$, 'BAD'),
  ('members page: a page key that is not one', 'owner', $$select count(*) from public.loyalty_members_page(null, $q$x' or '1'='1$q$)$$, 'BAD'),
  ('members page: a search of 3 digits is taken', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 100, '301')$$, '^ok:[0-9]+\|n$'),
  ('members page: a search of 4 digits', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 100, '2301')$$, 'BAD'),
  ('members page: a wildcard search', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 100, '%')$$, 'BAD'),
  ('members page: a search with SQL', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 100, $q$1' or '1'='1$q$)$$, 'BAD'),
-- loyalty_member_lookup: anything that is not a phone finds nothing.
  ('member lookup: an empty phone', 'owner', $$select count(*) from public.loyalty_member_lookup('')$$, '^ok:0\|n$'),
  ('member lookup: SQL in the phone', 'owner', $$select count(*) from public.loyalty_member_lookup($q$' or '1'='1$q$)$$, '^ok:0\|n$'),
  ('member lookup: a wildcard phone', 'owner', $$select count(*) from public.loyalty_member_lookup('%')$$, '^ok:0\|n$'),
  ('member lookup: a 100,000-character phone', 'owner', $$select count(*) from public.loyalty_member_lookup(repeat('9', 100000))$$, '^(ok:0\|n|error:22023\|n)$'),
-- report functions over loyalty rows: 0 to 50 stores, at most 92 days, to on or after from.
  ('shift anomalies: 92 days are taken', 'owner', $$select count(*) from public.loyalty_shift_anomalies(array['{store_a1}']::uuid[], date '2026-08-01', date '2026-08-01' + 91)$$, '^ok:[0-9]+\|n$'),
  ('shift anomalies: 93 days', 'owner', $$select count(*) from public.loyalty_shift_anomalies(array['{store_a1}']::uuid[], date '2026-08-01', date '2026-08-01' + 92)$$, 'BAD'),
  ('shift anomalies: to before from', 'owner', $$select count(*) from public.loyalty_shift_anomalies(array['{store_a1}']::uuid[], date '2026-08-02', date '2026-08-01')$$, 'BAD'),
  ('shift anomalies: 51 stores', 'owner', $$select count(*) from public.loyalty_shift_anomalies(array(select gen_random_uuid() from generate_series(1, 51)), date '2026-08-01', date '2026-08-01')$$, 'BAD'),
  ('shift anomalies: a null range', 'owner', $$select count(*) from public.loyalty_shift_anomalies(array['{store_a1}']::uuid[], null, null)$$, 'BAD'),
  ('member share: 93 days', 'owner', $$select count(*) from public.member_share_by_shift(array['{store_a1}']::uuid[], date '2026-08-01', date '2026-08-01' + 92)$$, 'BAD'),
  ('member share: 51 stores', 'owner', $$select count(*) from public.member_share_by_shift(array(select gen_random_uuid() from generate_series(1, 51)), date '2026-08-01', date '2026-08-01')$$, 'BAD'),
  ('member share: to before from', 'owner', $$select count(*) from public.member_share_by_shift(array['{store_a1}']::uuid[], date '2026-08-02', date '2026-08-01')$$, 'BAD'),
  ('redemption summary: 93 days', 'owner', $$select count(*) from public.redemption_summary(array['{store_a1}']::uuid[], date '2026-08-01', date '2026-08-01' + 92)$$, 'BAD'),
  ('redemption summary: 51 stores', 'owner', $$select count(*) from public.redemption_summary(array(select gen_random_uuid() from generate_series(1, 51)), date '2026-08-01', date '2026-08-01')$$, 'BAD'),
  ('redemption summary: to before from', 'owner', $$select count(*) from public.redemption_summary(array['{store_a1}']::uuid[], date '2026-08-02', date '2026-08-01')$$, 'BAD'),
  ('discount days: an unknown reward', 'owner', $$select count(*) from public.coupon_discount_days(gen_random_uuid(), 2026)$$, 'BAD'),
  ('discount days: the year 0', 'owner', $$select count(*) from public.coupon_discount_days('{coupon}', 0)$$, 'BAD'),
  ('discount days: the year 2022', 'owner', $$select count(*) from public.coupon_discount_days('{coupon}', 2022)$$, 'BAD'),
  ('discount days: the year 2026 is taken', 'owner', $$select count(*) from public.coupon_discount_days('{coupon}', 2026)$$, '^ok:[0-9]+\|n$'),
  ('discount days: the year 100,000', 'owner', $$select count(*) from public.coupon_discount_days('{coupon}', 100000)$$, 'BAD'),
  ('OA counts: 401 days', 'owner', $$select count(*) from public.oa_event_counts('{tenant_a}', date '2026-01-01', date '2026-01-01' + 401)$$, 'BAD'),
  ('OA counts: 400 days are taken', 'owner', $$select count(*) from public.oa_event_counts('{tenant_a}', date '2026-01-01', date '2026-01-01' + 400)$$, '^ok:0\|n$'),
  ('OA counts: to before from', 'owner', $$select count(*) from public.oa_event_counts('{tenant_a}', date '2026-01-02', date '2026-01-01')$$, 'BAD'),
-- set_loyalty_adjust_limits: 0 to 20 stamps, 0 to 100,000 points.
  ('adjust limits: 20 stamps and 100,000 points are taken', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', 20, 100000) ->> 'max_stamps'$$, '^ok:20\|w$'),
  ('adjust limits: 21 stamps', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', 21, 0)::text$$, 'BAD'),
  ('adjust limits: minus 1 stamp', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', -1, 0)::text$$, 'BAD'),
  ('adjust limits: 100,001 points', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', 0, 100001)::text$$, 'BAD'),
  ('adjust limits: null limits', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', null, null)::text$$, 'BAD'),
-- notifications and the staff phone.
  ('bot link: another notice version', 'staff', $$select public.start_bot_link('{tenant_a}', 'ops-notifications-v2')::text$$, 'BAD'),
  ('bot link: an empty notice version', 'staff', $$select public.start_bot_link('{tenant_a}', '')::text$$, 'BAD'),
  ('bot link: a notice version with SQL', 'staff', $$select public.start_bot_link('{tenant_a}', $q$ops-notifications-v1' or '1'='1$q$)::text$$, 'BAD'),
  ('muted rules: 101 keys', 'staff', $$select public.set_my_muted_rules('{channel_staff}', array(select 'sync_stale' from generate_series(1, 101)))::text$$, 'BAD'),
  ('muted rules: a null key', 'staff', $$select public.set_my_muted_rules('{channel_staff}', array[null]::text[])::text$$, 'BAD'),
  ('muted rules: an unknown key', 'staff', $$select public.set_my_muted_rules('{channel_staff}', array['no_such_rule'])::text$$, 'BAD'),
  ('muted rules: a null list', 'staff', $$select public.set_my_muted_rules('{channel_staff}', null)::text$$, 'BAD'),
  ('staff phone: a local phone', 'staff', $$select public.link_my_phone('{tenant_a}', '0900012399')$$, 'BAD'),
  ('staff phone: 16 digits', 'staff', $$select public.link_my_phone('{tenant_a}', '+' || repeat('1', 16))$$, 'BAD'),
  ('staff phone: a phone with SQL', 'staff', $$select public.link_my_phone('{tenant_a}', $q$+84' or '1'='1$q$)$$, 'BAD');

-- Fuzzing: every text argument of every customer and staff function gets hostile strings, every number argument
-- hostile numbers. The answer must be data, 22023 or 42501: never another error (a 500 through PostgREST), and an
-- error never leaves a write behind.
create temp table nasty_text (v text primary key);
insert into nasty_text values
  (''), (' '), (E'\t'), (E'\n'), (E'\r\n'), (E'\x01'), (E'\x7f'), (E'​'), (E'‮' || 'evil'), (E'﻿'),
  ('😀'), ('ü̈'), ($q$'$q$), ($q$''$q$), ($q$'; drop table public.customers; --$q$), ($q$' or '1'='1$q$), ('%'), ('_'), ('\'), ('$1'),
  ('{}'), ('[]'), ('null'), ('<script>alert(1)</script>'), ('../../etc/passwd'), (repeat('x', 100000)), (repeat('9', 41)), (repeat('é', 300));
create temp table nasty_number (v text primary key);
insert into nasty_number values ('-1'), ('0'), ('-0.0001'), ('1e15'), ('1e100'), ('''NaN''::numeric'), ('-2147483648'), ('2147483647'), ('null');

create temp table fuzz (fn text, caller text, statement text);
insert into fuzz
select f.fn, f.caller, replace(f.template, '$v', quote_nullable(t.v))
from nasty_text t
cross join (values
  ('customer_member_code', 'customer', $$select public.customer_member_code($v)::text$$),
  ('customer_submit_claim.store', 'customer', $$select public.customer_submit_claim($v, 'R-123-9', 60000)::text$$),
  ('customer_submit_claim.receipt', 'customer', $$select public.customer_submit_claim('sa-1', $v, 60000)::text$$),
  ('customer_coupons', 'customer', $$select count(*) from public.customer_coupons($v)$$),
  ('customer_redeem', 'customer', $$select public.customer_redeem('{coupon}'::uuid, $v)::text$$),
  ('staff_record_checkin.phone', 'staff', $$select public.staff_record_checkin('{store_a1}', $v)::text$$),
  ('staff_record_checkin.code', 'staff', $$select public.staff_record_checkin('{store_a1}', null, $v)::text$$),
  ('staff_member_lookup', 'staff', $$select public.staff_member_lookup('{store_a1}', $v)::text$$),
  ('staff_request.kind', 'staff', $$select public.staff_request('{store_a1}', $v, '{m_a1}', 'Lý do')::text$$),
  ('staff_request.reason', 'staff', $$select public.staff_request('{store_a1}', 'dispute', '{m_a1}', $v)::text$$),
  ('staff_decide_loyalty_request.decision', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', $v, 'Lý do')::text$$),
  ('staff_decide_loyalty_request.reason', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'refused', $v)::text$$),
  ('staff_verify_redemption', 'staff', $$select public.staff_verify_redemption('{store_a1}', $v)::text$$),
  ('resolve_loyalty_queue_item', 'manager', $$select public.resolve_loyalty_queue_item('{queue_item}', null, $v)::text$$),
  ('loyalty_members_page.after', 'owner', $$select count(*) from public.loyalty_members_page(null, $v)$$),
  ('loyalty_members_page.search', 'owner', $$select count(*) from public.loyalty_members_page(null, null, 100, $v)$$),
  ('loyalty_member_lookup', 'owner', $$select count(*) from public.loyalty_member_lookup($v)$$),
  ('start_bot_link', 'staff', $$select public.start_bot_link('{tenant_a}', $v)::text$$),
  ('set_my_muted_rules', 'staff', $$select public.set_my_muted_rules('{channel_staff}', array[$v])::text$$),
  ('link_my_phone', 'staff', $$select public.link_my_phone('{tenant_a}', $v)$$)
) as f (fn, caller, template)
union all
select f.fn, f.caller, replace(f.template, '$v', n.v)
from nasty_number n
cross join (values
  ('customer_submit_claim.amount', 'customer', $$select public.customer_submit_claim('sa-1', 'R-123-9', $v)::text$$),
  ('staff_record_checkin.amount', 'staff', $$select public.staff_record_checkin('{store_a1}', '0900012301', null, $v)::text$$),
  ('staff_request.stamps', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', ($v)::numeric::integer)::text$$),
  ('staff_request.points', 'staff', $$select public.staff_request('{store_a1}', 'adjustment', '{m_a1}', 'Lý do', 0, ($v)::numeric::integer)::text$$),
  ('staff_decide_loyalty_request.stamps', 'manager', $$select public.staff_decide_loyalty_request('{loyalty_request}', 'approved', 'Lý do', ($v)::numeric::integer)::text$$),
  ('loyalty_members_page.limit', 'owner', $$select count(*) from public.loyalty_members_page(null, null, ($v)::numeric::integer)$$),
  ('set_loyalty_adjust_limits', 'owner', $$select public.set_loyalty_adjust_limits('{tenant_a}', ($v)::numeric::integer, ($v)::numeric::integer)::text$$),
  ('coupon_discount_days', 'owner', $$select count(*) from public.coupon_discount_days('{coupon}', ($v)::numeric::integer)$$)
) as f (fn, caller, template)
-- integer arguments are cast by the caller; a value outside integer is the client's own cast error, not the function's
where not (f.template like '%::integer%' and n.v in ('1e15', '1e100', '''NaN''::numeric'));

select plan((select count(*)::integer from boundaries) + (select count(*)::integer from fuzz));

select matches(
  pg_temp.abuse(caller, statement),
  case expect when 'BAD' then '^error:22023\|n$' when 'DENY' then '^error:42501\|n$' else expect end,
  label)
from boundaries order by label;

select matches(
  pg_temp.abuse(caller, statement),
  '^(ok:.*\|[nw]|error:(22023|42501)\|n)$',
  format('fuzz %s with %s', fn, left(regexp_replace(statement, '[[:cntrl:]]', '?', 'g'), 120)))
from fuzz order by fn, statement;

select * from finish();
rollback;
