begin;
select plan(47);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009101'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000009102'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000009101'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000009102'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000009101'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000009102'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000009109'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000009101'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000009102'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000009103'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000009104'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000009105'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000009106'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000009111'::uuid as login_x,
  'eeeeeeee-eeee-4eee-8eee-000000009112'::uuid as login_y,
  '44444444-4444-4444-8444-000000009101'::uuid as brand_d,
  '55555555-5555-4555-8555-000000009101'::uuid as app_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-deletion-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_x, fx.login_y]) as u (id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), login_x, now() - interval '1 day', now() - interval '1 day' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'dsr-deletion-pgtap', 'DSR deletion pgTAP', 'VN' from fx
union all
select tenant_o, 'dsr-deletion-other-pgtap', 'DSR deletion other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'dsr-deletion', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'dsr-deletion-other', 'Synthetic account' from fx;
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

create function pg_temp.subject_counts(p_customer text)
returns jsonb
language sql
as $$
  with c as (select id from ids where name = p_customer),
  m as (select id from public.memberships where customer_id = (select id from c))
  select jsonb_build_object(
    'memberships', (select count(*) from m),
    'loyalty_ledger', (select count(*) from public.loyalty_ledger where membership_id in (select id from m)),
    'stamps', (select count(*) from public.stamps where membership_id in (select id from m)),
    'redemptions', (select count(*) from public.redemptions where membership_id in (select id from m)),
    'receipt_claims', (select count(*) from public.receipt_claims where membership_id in (select id from m)),
    'pending_checkins', (select count(*) from public.pending_checkins where membership_id in (select id from m)),
    'loyalty_queue', (select count(*) from public.loyalty_queue where membership_id in (select id from m)),
    'loyalty_refusals', (select count(*) from public.loyalty_refusals where membership_id in (select id from m)),
    'loyalty_requests', (select count(*) from app.loyalty_requests where membership_id in (select id from m)),
    'consent_records', (select count(*) from public.consent_records where subject_type = 'customer' and subject_id = (select id from c)),
    'outbound_messages', (select count(*) from public.outbound_messages where subject_type = 'customer' and subject_id = (select id from c)),
    'invoices_linked', (select count(*) from public.invoices where customer_id = (select id from c)),
    'customer_logins', (select count(*) from app.customer_logins where customer_id = (select id from c)),
    'customers', (select count(*) from public.customers where id = (select id from c))
  );
$$;

create temp table snapshot (name text primary key, counts jsonb);
insert into snapshot
select 'x_before', pg_temp.subject_counts('customer_x')
union all
select 'y_before', pg_temp.subject_counts('customer_y')
union all
select 'other_before', pg_temp.subject_counts('customer_x_other');

select ok(
  (select bool_and((value)::int > 0) from snapshot, jsonb_each_text(counts) where name = 'x_before'),
  'the synthetic customer has a membership, ledger rows, stamps, redemptions, a claim, a check-in, queue items, refusals, a request, consents, messages, a linked invoice, a login and the customer row'
);
select is(
  (select concat_ws(':', count(*) filter (where state = 'held'), count(*) filter (where state = 'confirmed')) from public.redemptions where membership_id = (select id from ids where name = 'member_x')),
  '1:1',
  'one reward is held and one was redeemed on a synced invoice'
);

create temp table answers (name text primary key, answer text);
grant select on fx, ids to authenticated, service_role;

insert into answers
select 'request_x', pg_temp.outcome_as(pg_temp.customer((select login_x from fx), 'customer_x'), $$ select app.customer_request_deletion(now() - interval '1 hour')::text $$);
create temp table req as
select (answer::jsonb ->> 'request_id')::uuid as id from answers where name = 'request_x';
select is(
  (
    select concat_ws(':', r.status, r.contact, r.request_type, r.subject_id = (select id from ids where name = 'customer_x'),
      r.first_response_due_at = d.first_response_due_at, r.completion_due_at = r.received_at + interval '20 days', r.responded_at is null)
    from public.data_subject_requests r
    cross join lateral app.dsr_deadlines(r.received_at, 'VN', 'Asia/Ho_Chi_Minh', false) d
    where r.id = (select id from req)
  ),
  'received:mini_app:deletion:t:t:t:t',
  'the customer''s request from the Mini App is a received deletion request with its two deadlines'
);

with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select tenant_d, 'customer', (select id from ids where name = 'customer_x'), 'synthetic-contact', 'access', now() - interval '2 hours' from fx
  returning id
)
insert into ids select 'request_access', r.id from r;
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type, received_at)
  select tenant_d, 'customer', 'synthetic-contact', 'deletion', now() - interval '2 hours' from fx
  returning id
)
insert into ids select 'request_unmatched', r.id from r;
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select tenant_d, 'staff', staff_d, 'synthetic-contact', 'deletion', now() - interval '2 hours' from fx
  returning id
)
insert into ids select 'request_staff', r.id from r;
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at, status)
  select tenant_d, 'customer', (select id from ids where name = 'customer_y'), 'synthetic-contact', 'deletion', now() - interval '2 hours', 'rejected' from fx
  returning id
)
insert into ids select 'request_rejected', r.id from r;
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select tenant_d, 'customer', (select id from ids where name = 'customer_z'), 'synthetic-contact', 'deletion', now() - interval '30 days' from fx
  returning id
)
insert into ids select 'request_late', r.id from r;

create function pg_temp.dsr_delete_as(p_claims jsonb, p_request text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select public.dsr_delete(%L::uuid)::text', coalesce((select id from ids where name = p_request), (select id from req))));
$$;

select is(pg_temp.dsr_delete_as(pg_temp.member((select manager_d from fx)), 'request_x'), 'error:42501', 'a manager with every store cannot delete a data subject');
select is(pg_temp.dsr_delete_as(pg_temp.member((select store_manager_d from fx)), 'request_x'), 'error:42501', 'a store manager cannot delete a data subject');
select is(pg_temp.dsr_delete_as(pg_temp.member((select staff_d from fx)), 'request_x'), 'error:42501', 'staff cannot delete a data subject');
select is(pg_temp.dsr_delete_as(pg_temp.member((select viewer_d from fx)), 'request_x'), 'error:42501', 'a viewer cannot delete a data subject');
select is(pg_temp.dsr_delete_as(pg_temp.member((select owner_o from fx)), 'request_x'), 'error:42501', 'the owner of another tenant cannot delete the subject');
select is(pg_temp.dsr_delete_as(pg_temp.customer((select login_x from fx), 'customer_x'), 'request_x'), 'error:42501', 'the customer cannot run the deletion of their own request');
select ok(
  not has_function_privilege('anon', 'public.dsr_delete(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.dsr_delete(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.dsr_delete(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.dsr_erase_customer(uuid, uuid, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.dsr_erase_customer(uuid, uuid, timestamptz)', 'execute'),
  'only signed-in callers reach dsr_delete, and no API role runs the erasure directly'
);
select is(pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_access'), 'error:22023', 'the owner cannot delete on an access request');
select is(pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_unmatched'), 'error:22023', 'nor on a deletion request that names no customer yet');
select is(pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_staff'), 'error:22023', 'nor on a staff member''s request');
select is(pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_rejected'), 'error:22023', 'nor on a rejected request');
select is(pg_temp.subject_counts('customer_x'), (select counts from snapshot where name = 'x_before'), 'the refusals deleted nothing');

insert into answers
select 'deleted_x', pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_x');
select is(
  (select concat_ws(':', a ->> 'action', a ->> 'status', a ->> 'already_done', a ->> 'responded_on_time', a ->> 'completed_on_time') from (select answer::jsonb as a from answers where name = 'deleted_x') x),
  'deletion:completed:false:true:true',
  'the owner deletes the customer on the request, within both deadlines'
);
select is(
  (select answer::jsonb -> 'counts' from answers where name = 'deleted_x'),
  (
    select jsonb_build_object(
      'memberships', (b ->> 'memberships')::int,
      'loyalty_ledger', (b ->> 'loyalty_ledger')::int,
      'stamps', (b ->> 'stamps')::int,
      'redemptions', (b ->> 'redemptions')::int,
      'receipt_claims', (b ->> 'receipt_claims')::int,
      'pending_checkins', (b ->> 'pending_checkins')::int,
      'loyalty_queue', (b ->> 'loyalty_queue')::int,
      'loyalty_refusals', (b ->> 'loyalty_refusals')::int,
      'loyalty_requests', (b ->> 'loyalty_requests')::int,
      'bill_captures', 0,
      'coupon_codes_quarantined', 1,
      'redemption_invoices_settled', 1,
      'consent_records', (b ->> 'consent_records')::int,
      'outbound_messages_redacted', (b ->> 'outbound_messages')::int,
      'invoices_unlinked', (b ->> 'invoices_linked')::int,
      'invoices_blanked', 2,
      'sale_records_scrubbed', 0,
      'customer_logins', (b ->> 'customer_logins')::int,
      'auth_users', 1,
      'customers', 1
    )
    from (select counts as b from snapshot where name = 'x_before') s
  ),
  'it counts every row it removed, per table'
);
select is(
  (select jsonb_object_agg(key, value) from jsonb_each(pg_temp.subject_counts('customer_x')) where key <> 'outbound_messages'),
  (select jsonb_object_agg(key, 0) from jsonb_each(pg_temp.subject_counts('customer_x')) where key <> 'outbound_messages'),
  'no membership, ledger row, stamp, redemption, claim, check-in, queue item, refusal, request, consent record, linked invoice, login or customer row of the subject is left'
);
select is(
  (select count(*)::int from public.memberships where zalo_user_id = 'syn-zalo-x') + (select count(*)::int from app.customer_logins where zalo_user_id = 'syn-zalo-x'),
  0,
  'the per-brand Zalo user id of the subject is gone'
);
select is(
  (select count(*)::int from auth.users where id = (select login_x from fx)) + (select count(*)::int from auth.sessions where user_id = (select login_x from fx)),
  0,
  'the subject''s Auth login and its sessions are deleted'
);
select is(
  (
    select string_agg(concat_ws(':', o.recipient_ref, o.subject_id is null, o.title is null, o.body is null), ',')
    from public.outbound_messages o
    where o.tenant_id = (select tenant_d from fx) and o.template_ref = 'synthetic.v1' and o.subject_id is distinct from (select id from ids where name = 'customer_y')
  ),
  'redacted:t:t:t,redacted:t:t:t',
  'the subject''s messages are redacted to their template and times'
);
select is(
  (select string_agg(code || ':' || state, ',' order by code) from public.coupon_codes where store_id = (select store_d from fx)),
  'SYN-91A:used,SYN-91B:quarantined,SYN-91C:assigned,SYN-91D:available',
  'the pool code of the held reward is quarantined, the redeemed one stays used and another member''s hold keeps its code'
);
select is(
  (select concat_ws(':', state, reason, membership_id is null) from public.loyalty_queue where invoice_id = (select id from ids where name = 'inv_redeemed')),
  'dismissed:discount_without_redemption:t',
  'the invoice the erased reward was redeemed on is settled for path D'
);
select is(
  (app.reconcile_redemptions((select tenant_d from fx), current_date - 10, current_date, now()) ->> 'mismatches_found')::int,
  0,
  'so the reconciliation raises no mismatch for it'
);
select is(
  (
    select concat_ws(':', r.status, r.completed_at = now(), r.responded_at = now(), r.handled_by = (select owner_d from fx))
    from public.data_subject_requests r where r.id = (select id from req)
  ),
  'completed:t:t:t',
  'the request is completed, answered and handled by the owner'
);
select is(
  (
    select concat_ws(':', count(*), bool_and(a.counts = (select answer::jsonb -> 'counts' from answers where name = 'deleted_x')),
      bool_and(a.acted_by = (select owner_d from fx)), bool_and(a.first_response_due_at = r.first_response_due_at and a.completion_due_at = r.completion_due_at),
      bool_and(a.responded_on_time and a.completed_on_time))
    from public.data_subject_request_actions a
    join public.data_subject_requests r on r.id = a.request_id
    where a.request_id = (select id from req)
  ),
  '1:t:t:t:t',
  'the counts are logged against the request''s two deadlines'
);

insert into answers
select 'deleted_x_again', pg_temp.dsr_delete_as(pg_temp.member((select owner_d from fx)), 'request_x');
select is(
  (select concat_ws(':', a ->> 'already_done', a -> 'counts' = (select answer::jsonb -> 'counts' from answers where name = 'deleted_x')) from (select answer::jsonb as a from answers where name = 'deleted_x_again') x),
  'true:t',
  'a second call answers the logged deletion'
);
select is((select count(*)::int from public.data_subject_request_actions where request_id = (select id from req)), 1, 'and logs nothing more');

select is(pg_temp.subject_counts('customer_y'), (select counts from snapshot where name = 'y_before'), 'another customer of the tenant keeps every row');
select is(pg_temp.subject_counts('customer_x_other'), (select counts from snapshot where name = 'other_before'), 'the same phone in another tenant keeps every row');
select is(
  (select count(*)::int from auth.users where id = (select login_y from fx)) + (select count(*)::int from public.coupon_codes where code = 'SYN-91C' and state = 'assigned'),
  2,
  'and another customer keeps the Auth login and the held code'
);
select is(
  pg_temp.outcome_as(pg_temp.customer((select login_x from fx), 'customer_x'), $$ select public.customer_home()::text $$),
  'error:42501',
  'a token the subject still holds opens nothing'
);

insert into answers
select 'deleted_z', app.dsr_erase_customer((select id from ids where name = 'request_late'), (select owner_d from fx), now())::text;
select is(
  (select concat_ws(':', a ->> 'status', a ->> 'responded_on_time', a ->> 'completed_on_time', a -> 'counts' ->> 'memberships', a -> 'counts' ->> 'customers') from (select answer::jsonb as a from answers where name = 'deleted_z') x),
  'completed:false:false:1:1',
  'a deletion done after both deadlines is logged as late'
);
select is(
  app.dsr_erase_customer((select id from req), null, now() + interval '1 day') ->> 'already_done',
  'true',
  'the erasure itself is idempotent'
);

update public.data_subject_requests set status = 'in_progress' where id = (select id from ids where name = 'request_access');
select ok(
  (select responded_at = now() from public.data_subject_requests where id = (select id from ids where name = 'request_access')),
  'a request leaving received records when it was first answered'
);
select throws_ok(
  $$ update public.data_subject_requests set responded_at = now() + interval '1 hour' where id = (select id from ids where name = 'request_access') $$,
  '22023',
  'data_subject_requests.responded_at is set once',
  'the first response time cannot be moved'
);
select is(
  (select responded_at from public.data_subject_requests where id = (select id from ids where name = 'request_unmatched')),
  null,
  'a received request has no response time'
);

select throws_ok(
  $$ delete from public.consent_records where subject_id = (select id from ids where name = 'customer_y') $$,
  'P0001',
  'consent_records is an append-only ledger: only the data-subject deletion removes a subject''s records',
  'outside the erasure the database owner cannot delete consent evidence'
);
set local client_min_messages = warning;
select throws_ok(
  $$ truncate public.consent_records cascade $$,
  'P0001',
  'consent_records is an append-only ledger: only the data-subject deletion removes a subject''s records',
  'nor truncate the consent ledger'
);
reset client_min_messages;
set local role service_role;
select set_config('app.dsr_erasure', 'on', true);
select throws_ok(
  $$ delete from public.consent_records where subject_id = (select id from ids where name = 'customer_y') $$,
  'P0001',
  'consent_records is an append-only ledger: only the data-subject deletion removes a subject''s records',
  'the erasure flag does not help the service role'
);
select set_config('app.loyalty_erasure', 'on', true);
select throws_ok(
  $$ delete from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_y') $$,
  'P0001',
  'loyalty_ledger is an append-only ledger: a correction is a new row that references the original',
  'and the ledger stays append-only for the service role'
);
reset role;
select set_config('app.dsr_erasure', 'off', true);
select set_config('app.loyalty_erasure', 'off', true);

create function pg_temp.actions_seen(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', pg_temp.member(p_user)::text, true);
  select count(*) into v_count from public.data_subject_request_actions;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_count;
end;
$$;

select is(pg_temp.actions_seen((select owner_d from fx)), 2, 'the owner reads the logged deletions of the tenant');
select is(pg_temp.actions_seen((select manager_d from fx)), 2, 'so does a manager with every store, as for the requests');
select is(
  pg_temp.actions_seen((select store_manager_d from fx)) + pg_temp.actions_seen((select staff_d from fx)) + pg_temp.actions_seen((select viewer_d from fx)),
  0,
  'a store manager, staff and a viewer read none'
);
select is(pg_temp.actions_seen((select owner_o from fx)), 0, 'the owner of another tenant reads none');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.member((select owner_d from fx))::text, true);
select throws_ok(
  $$ insert into public.data_subject_request_actions (tenant_id, request_id, action, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time)
     select tenant_d, (select id from ids where name = 'request_access'), 'deletion', now(), '{}'::jsonb, now(), now(), true, true from fx $$,
  '42501',
  null,
  'no client writes the log'
);
reset role;
select set_config('request.jwt.claims', '', true);

delete from public.tenants where id = (select tenant_o from fx);
select is(
  (select count(*)::int from public.consent_records where tenant_id = (select tenant_o from fx)),
  0,
  'deleting a tenant still removes its consent records'
);

select * from finish();
rollback;
