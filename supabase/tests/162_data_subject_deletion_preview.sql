begin;
select plan(19);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000016201'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000016202'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000016201'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000016202'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000016201'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000016202'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000016209'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000016201'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000016202'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016203'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016204'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000016205'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000016206'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000009111'::uuid as login_x,
  'eeeeeeee-eeee-4eee-8eee-000000009112'::uuid as login_y,
  '44444444-4444-4444-8444-000000016201'::uuid as brand_d,
  '55555555-5555-4555-8555-000000016201'::uuid as app_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-preview-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_x, fx.login_y]) as u (id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), login_x, now() - interval '1 day', now() - interval '1 day' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'dsr-preview-pgtap', 'DSR preview pgTAP', 'VN' from fx
union all
select tenant_o, 'dsr-preview-other-pgtap', 'DSR preview other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'dsr-preview', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'dsr-preview-other', 'Synthetic account' from fx;
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
  values ('customer_x', fx.tenant_d, '0900017101'), ('customer_y', fx.tenant_d, '0900017102'), ('customer_z', fx.tenant_d, '0900017103'),
         ('customer_x_other', fx.tenant_o, '0900017101')
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

select pg_temp.invoice('inv_phone', now() - interval '3 days', 60000, '0900017101');
select app.loyalty_earn((select id from ids where name = 'inv_phone'), (select id from ids where name = 'member_x'), 'A', now() - interval '3 days');
select pg_temp.invoice('inv_linked', now() - interval '2 days', 20000, null, (select id from ids where name = 'customer_x'));
select app.loyalty_earn((select id from ids where name = 'inv_linked'), (select id from ids where name = 'member_x'), 'A', now() - interval '2 days');
select pg_temp.invoice('inv_y', now() - interval '2 days', 70000, '0900017102');
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

create function pg_temp.outcome_as(p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute p_statement into v_value;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_value, 'null');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.member(p_user uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object('sub', p_user, 'role', 'authenticated');
$$;

create function pg_temp.customer(p_user uuid, p_customer text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', (select tenant_d from fx), 'customer_id', (select id from ids where name = p_customer))
  );
$$;


create temp table req (name text primary key, id uuid);
create temp table answers_t (name text primary key, answer text);
grant select on answers_t to authenticated, service_role;
grant select on fx, ids, req to authenticated, service_role;

create function pg_temp.new_request(p_name text, p_tenant uuid, p_type text, p_subject uuid, p_status text default 'received', p_type_subject text default 'customer')
returns void
language sql
as $$
  with r as (
    insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at, status)
    values (p_tenant, p_type_subject::public.consent_subject, p_subject, 'synthetic-contact', p_type::public.dsr_type, now() - interval '1 hour', p_status::public.dsr_status)
    returning id
  )
  insert into req select p_name, r.id from r;
$$;

select pg_temp.new_request('delete_x', (select tenant_d from fx), 'deletion', (select id from ids where name = 'customer_x'));
select pg_temp.new_request('delete_other', (select tenant_o from fx), 'deletion', (select id from ids where name = 'customer_x_other'));
select pg_temp.new_request('unmatched', (select tenant_d from fx), 'deletion', null);
select pg_temp.new_request('staff_subject', (select tenant_d from fx), 'deletion', (select staff_d from fx), 'received', 'staff');
select pg_temp.new_request('rejected', (select tenant_d from fx), 'deletion', (select id from ids where name = 'customer_x'), 'rejected');

create function pg_temp.preview(p_claims jsonb, p_request text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select public.dsr_deletion_preview(%L::uuid)::text', (select id from req where name = p_request)));
$$;

create temp table snapshot as
select
  (select count(*) from public.memberships where tenant_id = (select tenant_d from fx)) as memberships,
  (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_d from fx)) as ledger,
  (select count(*) from public.consent_records where tenant_id = (select tenant_d from fx)) as consents,
  (select count(*) from public.customers where tenant_id = (select tenant_d from fx)) as customers,
  (select status from public.data_subject_requests where id = (select id from req where name = 'delete_x')) as status;

select ok(
  has_function_privilege('authenticated', 'public.dsr_deletion_preview(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.dsr_deletion_preview(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.dsr_deletion_preview(uuid)', 'execute'),
  'the preview is for signed-in callers only'
);

select is(
  pg_temp.preview(pg_temp.member((select owner_d from fx)), 'delete_x')::jsonb,
  jsonb_build_object(
    'memberships', (select count(*) from public.memberships where customer_id = (select id from ids where name = 'customer_x')),
    'loyalty_ledger', (select count(*) from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x')),
    'stamps', (select count(*) from public.stamps where membership_id = (select id from ids where name = 'member_x')),
    'redemptions', (select count(*) from public.redemptions where membership_id = (select id from ids where name = 'member_x')),
    'receipt_claims', (select count(*) from public.receipt_claims where membership_id = (select id from ids where name = 'member_x')),
    'consent_records', 3,
    'outbound_messages', 2,
    'invoices_unlinked', (select count(*) from public.invoices where customer_id = (select id from ids where name = 'customer_x'))
  ),
  'the owner''s preview counts the subject''s rows per table'
);
select ok(
  (select bool_and(value::int > 0) from jsonb_each_text(pg_temp.preview(pg_temp.member((select owner_d from fx)), 'delete_x')::jsonb)),
  'the synthetic subject has rows in every previewed table'
);
select is(
  pg_temp.preview(pg_temp.member((select manager_d from fx)), 'delete_x'),
  pg_temp.preview(pg_temp.member((select owner_d from fx)), 'delete_x'),
  'an unlimited manager sees the same preview (managers see but do not delete)'
);
select is(
  (select concat_ws(':', (select count(*) from public.memberships where tenant_id = (select tenant_d from fx)) = memberships,
    (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_d from fx)) = ledger,
    (select count(*) from public.consent_records where tenant_id = (select tenant_d from fx)) = consents,
    (select count(*) from public.customers where tenant_id = (select tenant_d from fx)) = customers,
    (select status from public.data_subject_requests where id = (select id from req where name = 'delete_x')) = snapshot.status)
   from snapshot),
  't:t:t:t:t',
  'regression: the preview changes nothing, not the rows and not the request status'
);
select is(pg_temp.preview(pg_temp.member((select store_manager_d from fx)), 'delete_x'), 'error:42501', 'a store-limited manager gets no preview');
select is(pg_temp.preview(pg_temp.member((select staff_d from fx)), 'delete_x'), 'error:42501', 'staff get no preview');
select is(pg_temp.preview(pg_temp.member((select viewer_d from fx)), 'delete_x'), 'error:42501', 'a viewer gets no preview');
select is(pg_temp.preview(pg_temp.member((select owner_o from fx)), 'delete_x'), 'error:42501', 'the owner of another tenant gets no preview');
select is(pg_temp.preview(pg_temp.customer((select login_x from fx), 'customer_x'), 'delete_x'), 'error:42501', 'the customer gets no preview of their own deletion through the tooling');
select is(pg_temp.preview('{}'::jsonb, 'delete_x'), 'error:42501', 'a call without a user is refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), $$ select public.dsr_deletion_preview(gen_random_uuid())::text $$), 'error:42501', 'an unknown request id is refused like a foreign one');
select is(pg_temp.preview(pg_temp.member((select owner_d from fx)), 'unmatched'), 'error:22023', 'a request naming no customer is refused');
select is(pg_temp.preview(pg_temp.member((select owner_d from fx)), 'staff_subject'), 'error:22023', 'a request about a staff member is refused');
select is(pg_temp.preview(pg_temp.member((select owner_d from fx)), 'rejected'), 'error:22023', 'a rejected request is refused');
select is(
  (pg_temp.preview(pg_temp.member((select owner_o from fx)), 'delete_other')::jsonb ->> 'memberships'),
  '1',
  'the other tenant''s owner previews only their own subject'
);
select ok(
  pg_temp.preview(pg_temp.member((select owner_d from fx)), 'delete_x') !~ '90001720|\+84',
  'the preview holds counts only, no phone'
);

insert into answers_t select 'deleted', pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), format('select public.dsr_delete(%L::uuid)::text', (select id from req where name = 'delete_x')));
select is(
  (select (answer::jsonb -> 'counts' ->> 'memberships') || ':' || (answer::jsonb -> 'counts' ->> 'consent_records') from answers_t where name = 'deleted'),
  '1:3',
  'integration: the deletion removes what the preview listed'
);
select is(pg_temp.preview(pg_temp.member((select owner_d from fx)), 'delete_x'), 'error:22023', 'after the deletion the preview is refused: the customer is gone');

select * from finish();
rollback;
