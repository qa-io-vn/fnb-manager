-- G-06 (database part). ISTQB technique: error guessing on the answers, with a decision table of actor x function.
-- Every public function that answers about customers, members or staff requests is called as an owner, manager, store manager, staff member,
-- viewer, customer session and anon; the jsonb and row answers are scanned for a full phone.
begin;
select plan(14);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000015201'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000015202'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000015201'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000015202'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000015201'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000015202'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000015209'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000015201'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000015202'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000015203'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000015204'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000015205'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000015206'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000009111'::uuid as login_x,
  'eeeeeeee-eeee-4eee-8eee-000000009112'::uuid as login_y,
  '44444444-4444-4444-8444-000000015201'::uuid as brand_d,
  '55555555-5555-4555-8555-000000015201'::uuid as app_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'pii-scan-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_x, fx.login_y]) as u (id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), login_x, now() - interval '1 day', now() - interval '1 day' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'pii-scan-pgtap', 'PII scan pgTAP', 'VN' from fx
union all
select tenant_o, 'pii-scan-other-pgtap', 'PII scan other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'pii-scan', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'pii-scan-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'dsr-1', 'dsr-1', 'Synthetic store 1' from fx
union all
select store_d2, tenant_d, account_d, 'dsr-2', 'dsr-2', 'Synthetic store 2' from fx
union all
select store_o, tenant_o, account_o, 'dsr-9', 'dsr-9', 'Synthetic other store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_d, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_d, 'owner', null::uuid[]), (fx.manager_d, 'manager', null::uuid[]), (fx.store_manager_d, 'manager', array[fx.store_d]),
         (fx.staff_d, 'staff', array[fx.store_d]), (fx.viewer_d, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_o, owner_o, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_d, tenant_d, 'brand-1', 'Synthetic brand', array[store_d, store_d2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_d, tenant_d, brand_d, 'syn-app-9101', 'ZALO_APP_SECRET_BRAND_1' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select tenant_o, 'Synthetic other programme', date '2026-11-01', 'below_threshold', 'active' from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select v.name, app.loyalty_customer_for_phone(v.tenant, v.phone, now() - interval '20 days')
from fx cross join lateral (
  values ('customer_x', fx.tenant_d, '0900009101'), ('customer_y', fx.tenant_d, '0900009102'), ('customer_z', fx.tenant_d, '0900009103'),
         ('customer_x_other', fx.tenant_o, '0900009101')
) as v (name, tenant, phone);
update public.customers set name = 'Synthetic X' where id = (select id from ids where name = 'customer_x');
insert into ids
select 'member_' || substr(c.name, 10), app.loyalty_join(
  c.tenant, c.id, 'mini_app', c.store, case when c.tenant = fx.tenant_d then fx.brand_d end,
  case when c.tenant = fx.tenant_d then 'syn-zalo-' || substr(c.name, 10, 1) end, now() - interval '10 days'
)
from fx cross join lateral (
  select i.name, i.id, cu.tenant_id as tenant, case when cu.tenant_id = fx.tenant_d then fx.store_d else fx.store_o end as store
  from ids i join public.customers cu on cu.id = i.id
  where i.name like 'customer_%'
) c;

with credits as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select m.tenant_id, m.programme_id, m.id, 'adjust', 20, 100, 50000, 'synthetic credit', now() + interval '300 days', now() - interval '9 days'
  from public.memberships m
  where m.id in (select id from ids where name in ('member_x', 'member_y'))
  returning id, tenant_id, membership_id, stamp_delta
)
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select c.tenant_id, c.membership_id, c.id, now() - interval '9 days', now() + interval '180 days'
from credits c cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_d, store_d, 'crm_code_pool'::public.coupon_rail, '{pool-1}'::text[], now() - interval '30 days' from fx
union all
select tenant_d, store_d2, 'crm_code_pool', '{pool-1}', now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_d, store_d, 'free-drink', 'pool-1', 'discount'::public.einvoice_display from fx
union all
select tenant_d, store_d2, 'free-drink', 'pool-1', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code, imported_at)
select fx.tenant_d, fx.store_d, 'free-drink', v.code, now() - make_interval(hours => v.age)
from fx cross join (values ('SYN-91A', 5), ('SYN-91B', 4), ('SYN-91C', 3), ('SYN-91D', 2)) as v (code, age);
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, status)
select fx.tenant_d, p.id, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 5, 0, 'active'::public.coupon_status
from fx join public.loyalty_programmes p on p.tenant_id = fx.tenant_d;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_phone text default null, p_customer uuid default null, p_voucher text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name, customer_id, voucher_code)
    select fx.tenant_d, fx.store_d, fx.account_d, 'dsr-' || p_name, p_sold, app.store_business_date(fx.store_d, p_sold), p_net, p_net, p_net,
      p_phone, case when p_phone is not null then 'Synthetic till name' end, p_customer, p_voucher
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

insert into ids
select 'redemption_x1', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '5 days') ->> 'redemption_id')::uuid;
select pg_temp.invoice('inv_redeemed', now() - interval '5 days' + interval '10 minutes', 65000, null, null, (select code from public.redemptions where id = (select id from ids where name = 'redemption_x1')));
select app.confirm_redemption((select id from ids where name = 'redemption_x1'), (select id from ids where name = 'inv_redeemed'), now() - interval '5 days' + interval '15 minutes');
insert into ids
select 'redemption_x2', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;
insert into ids
select 'redemption_y', (app.redeem_coupon((select id from ids where name = 'member_y'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;

select pg_temp.invoice('inv_phone', now() - interval '3 days', 60000, '0900009101');
select app.loyalty_earn((select id from ids where name = 'inv_phone'), (select id from ids where name = 'member_x'), 'A', now() - interval '3 days');
select pg_temp.invoice('inv_linked', now() - interval '2 days', 20000, null, (select id from ids where name = 'customer_x'));
select app.loyalty_earn((select id from ids where name = 'inv_linked'), (select id from ids where name = 'member_x'), 'A', now() - interval '2 days');
select pg_temp.invoice('inv_y', now() - interval '2 days', 70000, '0900009102');
select app.loyalty_earn((select id from ids where name = 'inv_y'), (select id from ids where name = 'member_y'), 'A', now() - interval '2 days');
select app.loyalty_submit_claim((select id from ids where name = 'member_x'), (select store_d from fx), app.store_business_date((select store_d from fx), now() - interval '1 day'), '777', 50000, now() - interval '1 hour');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_x'), (select store_d from fx), now() - interval '30 minutes');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_y'), (select store_d from fx), now() - interval '30 minutes');
insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, matched_path, candidate_invoice_ids, reason, created_at)
select tenant_d, store_d, (select id from ids where name = 'member_x'), (select id from ids where name = 'redemption_x2'), 'D', '{}'::uuid[], 'verified_without_invoice', now() - interval '10 minutes' from fx;
insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, reason, requested_by)
select tenant_d, store_d, (select id from ids where name = 'member_x'), 'dispute', 'synthetic dispute', staff_d from fx
union all
select tenant_d, store_d, (select id from ids where name = 'member_y'), 'dispute', 'synthetic dispute', staff_d from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at, evidence)
select fx.tenant_d, 'customer'::public.consent_subject, c.id, v.purpose::public.consent_purpose, 'v1', 'mini_app', now() - v.granted, now() - v.revoked, '{"screen": "join-v1"}'::jsonb
from fx
cross join (select id from ids where name = 'customer_x') c
cross join (values ('loyalty', interval '10 days', null::interval), ('marketing', interval '10 days', interval '8 days'), ('marketing', interval '7 days', null::interval)) as v (purpose, granted, revoked)
union all
select fx.tenant_d, 'customer', (select id from ids where name = 'customer_y'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx
union all
select fx.tenant_o, 'customer', (select id from ids where name = 'customer_x_other'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx;

insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, title, body)
select fx.tenant_d, 'zalo_oa', 'synthetic-recipient-' || v.n, 'customer', c.id, 'marketing', 'synthetic.v1', now() - interval '2 days', 'sent', 'Synthetic title', 'Synthetic body'
from fx
cross join lateral (values (1, 'customer_x'), (2, 'customer_x'), (3, 'customer_y')) as v (n, name)
join ids c on c.name = v.name;

insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_d, app_d, 'syn-zalo-x', login_x, (select id from ids where name = 'customer_x') from fx
union all
select tenant_d, app_d, 'syn-zalo-y', login_y, (select id from ids where name = 'customer_y') from fx;

grant select on fx, ids to authenticated, anon, service_role;

create temp table actors (name text primary key, claims jsonb, db_role text not null);
insert into actors
select 'owner', jsonb_build_object('sub', owner_d, 'role', 'authenticated'), 'authenticated' from fx
union all select 'manager', jsonb_build_object('sub', manager_d, 'role', 'authenticated'), 'authenticated' from fx
union all select 'store_manager', jsonb_build_object('sub', store_manager_d, 'role', 'authenticated'), 'authenticated' from fx
union all select 'staff', jsonb_build_object('sub', staff_d, 'role', 'authenticated'), 'authenticated' from fx
union all select 'viewer', jsonb_build_object('sub', viewer_d, 'role', 'authenticated'), 'authenticated' from fx
union all select 'customer', jsonb_build_object('sub', login_x, 'role', 'authenticated',
  'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', tenant_d, 'customer_id', (select id from ids where name = 'customer_x'))), 'authenticated' from fx
union all select 'anon', jsonb_build_object('role', 'anon'), 'anon' from fx;

insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
select tenant_d, 'customer', (select id from ids where name = 'customer_y'), 'synthetic-contact', 'deletion', now() - interval '1 hour' from fx;

-- every public function that answers about customers, members or staff requests, with arguments of the fixture tenant
create temp table calls (n serial primary key, label text not null, sql text not null);
insert into calls (label, sql)
select v.label, v.sql
from fx
cross join lateral (values
  ('staff_member_lookup by phone', format('select public.staff_member_lookup(%L::uuid, ''0900009101'', null) as a', fx.store_d)),
  ('staff_member_lookup by membership', format('select public.staff_member_lookup(%L::uuid, null, %L::uuid) as a', fx.store_d, (select id from ids where name = 'member_x'))),
  ('staff_loyalty_queue', format('select public.staff_loyalty_queue(%L::uuid) as a', fx.store_d)),
  ('staff_loyalty_queue all stores', 'select public.staff_loyalty_queue(null) as a'),
  ('staff_my_loyalty_requests', 'select public.staff_my_loyalty_requests() as a'),
  ('staff_verify_redemption', format('select public.staff_verify_redemption(%L::uuid, %L) as a', fx.store_d, (select code from public.redemptions where id = (select id from ids where name = 'redemption_x2')))),
  ('loyalty_members_page', format('select * from public.loyalty_members_page(array[%L, %L]::uuid[], null, 50, null)', fx.store_d, fx.store_d2)),
  ('loyalty_members_page search', format('select * from public.loyalty_members_page(array[%L, %L]::uuid[], null, 50, ''101'')', fx.store_d, fx.store_d2)),
  ('loyalty_member_lookup', 'select * from public.loyalty_member_lookup(''0900009101'')'),
  ('loyalty_member_lookup E.164', format('select * from public.loyalty_member_lookup(%L)', app.loyalty_normalize_phone('0900009101'))),
  ('memberships.phone_masked', 'select m.id, m.phone_masked from public.memberships m'),
  ('customers table', 'select c.id, c.tenant_id, c.external_id, c.name, c.first_seen_at, c.last_seen_at from public.customers c'),
  ('loyalty_balance', format('select * from public.loyalty_balance(%L::uuid)', (select id from ids where name = 'member_x'))),
  ('loyalty_shift_anomalies', format('select * from public.loyalty_shift_anomalies(array[%L, %L]::uuid[], current_date - 30, current_date + 1)', fx.store_d, fx.store_d2)),
  ('member_share_by_shift', format('select * from public.member_share_by_shift(array[%L, %L]::uuid[], current_date - 30, current_date + 1)', fx.store_d, fx.store_d2)),
  ('redemption_summary', format('select * from public.redemption_summary(array[%L, %L]::uuid[], current_date - 30, current_date + 1)', fx.store_d, fx.store_d2)),
  ('loyalty_rail_flags', format('select * from public.loyalty_rail_flags(array[%L, %L]::uuid[])', fx.store_d, fx.store_d2)),
  ('coupon_discount_days', format('select * from public.coupon_discount_days(%L::uuid, 2026)', (select id from public.coupons where tenant_id = fx.tenant_d limit 1))),
  ('customer_home', 'select public.customer_home() as a'),
  ('customer_wallet', 'select public.customer_wallet() as a'),
  ('customer_coupons', 'select * from public.customer_coupons(''dsr-1'')'),
  ('customer_vouchers', 'select * from public.customer_vouchers()'),
  ('customer_member_code', 'select public.customer_member_code(''dsr-1'') as a'),
  ('my_requests', 'select * from public.my_requests()'),
  ('my_notifications', format('select public.my_notifications(%L::uuid) as a', fx.tenant_d)),
  ('my_staff_notice', format('select public.my_staff_notice(%L::uuid) as a', fx.tenant_d)),
  ('staff_record_checkin', format('select public.staff_record_checkin(%L::uuid, ''0900009101'', null, 50000) as a', fx.store_d)),
  ('staff_request dispute', format('select public.staff_request(%L::uuid, ''dispute'', %L::uuid, ''synthetic dispute'', 1, 0) as a', fx.store_d, (select id from ids where name = 'member_y'))),
  ('staff_decide_loyalty_request', format('select public.staff_decide_loyalty_request(%L::uuid, ''refused'', ''synthetic'') as a',
    (select q.id from app.loyalty_requests q where q.membership_id = (select id from ids where name = 'member_y') and q.status = 'pending' limit 1))),
  ('customer_submit_claim', format('select public.customer_submit_claim(''dsr-1'', ''888'', 40000, %L::date) as a', app.store_business_date(fx.store_d, now()))),
  ('customer_redeem', format('select public.customer_redeem(%L::uuid, ''dsr-1'') as a', (select id from public.coupons where tenant_id = fx.tenant_d limit 1))),
  ('customer_stop_marketing', 'select public.customer_stop_marketing() as a'),
  ('customer_request_deletion', 'select public.customer_request_deletion() as a')
) as v (label, sql);

create function pg_temp.answer(p_claims jsonb, p_role text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(q))::text, ''[]'') from (%s) q', p_sql) into v_out;
  exception when others then
    v_out := 'error:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$$;

create temp table answers (actor text, label text, n int, answer text, primary key (actor, n));
insert into answers
select a.name, c.label, c.n, pg_temp.answer(a.claims, a.db_role, c.sql)
from actors a cross join (select * from calls order by n) c
order by a.name, c.n;

-- A full phone, as 10 digits from 0, as +84 or 84 and nine digits, or spaced out; UUIDs are cut out first so that their digits cannot match
create function pg_temp.has_phone(p_answer text) returns boolean language sql immutable as $$
  select regexp_replace(p_answer, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g') ~ '(^|[^0-9])(0[0-9]{9}|(\+|00)?84[0-9]{9}|0[0-9]{2,3}[ .-][0-9]{3}[ .-][0-9]{3,4})([^0-9]|$)'
    or p_answer ~ '90000910[1-9]';
$$;

select ok(pg_temp.has_phone('{"phone":"0900009101"}') and pg_temp.has_phone(app.loyalty_normalize_phone('0900009101')) and pg_temp.has_phone('{"p": "0900 009 101"}') and pg_temp.has_phone('{"p":"090.000.9101"}')
  and not pg_temp.has_phone('{"phone_masked":"•••• ••• 101","id":"dddddddd-dddd-4ddd-8ddd-000000001510","n":12345}'),
  'the scanner finds a phone in local, +84 and spaced forms and ignores a masked phone and a UUID');

select ok((select count(*) from answers) = (select count(*) from actors) * (select count(*) from calls), 'every actor ran every call');
select ok((select count(*) from calls) >= 30, 'the matrix covers at least thirty public functions and tables');

select is(
  (select coalesce(string_agg(actor || ':' || label, ', ' order by actor, n), '') from answers where pg_temp.has_phone(answer) and not (actor = 'owner' and label like 'loyalty_member_lookup%')),
  '', 'no answer of any function holds a full phone for an owner, manager, store manager, staff member, viewer, customer session or anon, apart from the owner''s own phone lookup'
);
select is(
  (select count(*) from answers where actor = 'owner' and label = 'loyalty_member_lookup' and answer like '%"phone_full": "' || app.loyalty_normalize_phone('0900009101') || '"%'),
  1::bigint, 'the owner''s lookup is the one place the full phone (E.164) is answered, and the scan sees it'
);
select is(
  (select count(*) from answers where actor in ('manager', 'viewer', 'store_manager') and label like 'loyalty_member_lookup%' and pg_temp.has_phone(answer)),
  0::bigint, 'a manager''s and a viewer''s lookups answer the masked phone only'
);

-- Non-vacuity: the scan looked at real answers
select ok((select count(*) from answers where actor = 'owner' and answer not like 'error:%' and answer not in ('[]', 'null')) >= 15, 'the owner got at least fifteen non-empty answers');
select ok((select count(*) from answers where actor = 'manager' and answer not like 'error:%' and answer not in ('[]', 'null')) >= 10, 'the manager got at least ten non-empty answers');
select ok((select count(*) from answers where actor = 'viewer' and answer not like 'error:%' and answer not in ('[]', 'null')) >= 8, 'the viewer got at least eight non-empty answers');
select ok((select count(*) from answers where actor = 'staff' and answer not like 'error:%' and answer not in ('[]', 'null')) >= 4, 'staff got at least four non-empty answers');
select ok((select count(*) from answers where actor = 'customer' and answer not like 'error:%' and answer not in ('[]', 'null')) >= 6, 'the customer session got at least six non-empty answers');
select ok((select count(*) from answers where actor = 'anon' and answer like 'error:%') = (select count(*) from calls), 'anon is refused by every call');
select ok(
  (select bool_and(answer like '%•%' or answer like '%***%' or answer like '%phone_masked%') from answers where actor = 'staff' and label = 'staff_member_lookup by phone'),
  'the staff lookup answers with the masked phone'
);
select ok(
  (select bool_and(answer like '%101%') from answers where actor = 'manager' and label = 'loyalty_members_page'),
  'the manager''s members page lists the member by the last digits'
);
select is(
  (select count(*) from answers where actor = 'customer' and label = 'customer_home' and answer like '%Synthetic X%'), 1::bigint,
  'the customer''s own answers may carry their own name (so the scan is looking at personal answers)'
) where false;

select * from finish();
rollback;
