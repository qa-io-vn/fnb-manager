begin;
select plan(55);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011001'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000011002'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000011001'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000011002'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000011001'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000011002'::uuid as store_u,
  '44444444-4444-4444-8444-000000011001'::uuid as brand_t,
  '44444444-4444-4444-8444-000000011002'::uuid as brand_u,
  '66666666-6666-4666-8666-000000011001'::uuid as oa_t,
  '66666666-6666-4666-8666-000000011002'::uuid as oa_u,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011001'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011002'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011003'::uuid as customer_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011004'::uuid as customer_d,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011005'::uuid as customer_e,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011006'::uuid as customer_u,
  '99999999-9999-4999-8999-000000011001'::uuid as member_a,
  '99999999-9999-4999-8999-000000011002'::uuid as member_b,
  '99999999-9999-4999-8999-000000011003'::uuid as member_c,
  '99999999-9999-4999-8999-000000011004'::uuid as member_d,
  '99999999-9999-4999-8999-000000011005'::uuid as member_e,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000011001'::uuid as programme_t,
  '77777777-7777-4777-8777-000000011001'::uuid as coupon_t,
  '88888888-8888-4888-8888-000000011001'::uuid as invoice_1,
  '88888888-8888-4888-8888-000000011002'::uuid as invoice_2,
  '88888888-8888-4888-8888-000000011003'::uuid as invoice_3,
  '88888888-8888-4888-8888-000000011004'::uuid as invoice_4;

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'customer-messages-t', 'Customer messages T', 'VN' from fx
union all
select tenant_u, 'customer-messages-u', 'Customer messages U', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'customer-messages-t', 'Synthetic account T' from fx
union all
select account_u, tenant_u, 'mock', 'customer-messages-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_t, account_t, 'cm-1', 'Synthetic store 1' from fx
union all
select store_u, tenant_u, account_u, 'cm-u', 'Synthetic store U' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-1', 'Synthetic brand T', array[store_1] from fx
union all
select brand_u, tenant_u, 'brand-1', 'Synthetic brand U', array[store_u] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-cm-oa-t', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_u, tenant_u, brand_u, 'synthetic-cm-oa-u', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;

insert into public.customers (id, tenant_id, phone, name)
select customer_a, tenant_t, '0900000' || '101', 'Synthetic A' from fx
union all select customer_b, tenant_t, '0900000' || '102', null from fx
union all select customer_c, tenant_t, '0900000' || '103', null from fx
union all select customer_d, tenant_t, '0900000' || '104', null from fx
union all select customer_e, tenant_t, '0900000' || '105', null from fx
union all select customer_u, tenant_u, '0900000' || '106', null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme T', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, status, brand_id)
select member_a, tenant_t, programme_t, customer_a, 'mini_app', now() - interval '10 days', 'active'::public.membership_status, brand_t from fx
union all select member_b, tenant_t, programme_t, customer_b, 'mini_app', now() - interval '10 days', 'active', brand_t from fx
union all select member_c, tenant_t, programme_t, customer_c, 'till', now() - interval '10 days', 'active', null from fx
union all select member_d, tenant_t, programme_t, customer_d, 'mini_app', now() - interval '10 days', 'suspended', brand_t from fx
union all select member_e, tenant_t, programme_t, customer_e, 'mini_app', now() - interval '90 days', 'active', brand_t from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_t, 'customer'::public.consent_subject, customer_a, 'loyalty'::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '10 days' from fx
union all select tenant_t, 'customer', customer_a, 'marketing', 'synthetic-v1', 'mini_app', now() - interval '10 days' from fx
union all select tenant_t, 'customer', customer_b, 'loyalty', 'synthetic-v1', 'mini_app', now() - interval '10 days' from fx
union all select tenant_t, 'customer', customer_d, 'loyalty', 'synthetic-v1', 'mini_app', now() - interval '10 days' from fx
union all select tenant_t, 'customer', customer_e, 'loyalty', 'synthetic-v1', 'mini_app', now() - interval '90 days' from fx
union all select tenant_t, 'customer', customer_e, 'marketing', 'synthetic-v1', 'mini_app', now() - interval '90 days' from fx;

insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, business_date, sold_at, gross_amount, net_amount, paid_amount, receipt_no)
select v.id, fx.tenant_t, fx.store_1, fx.account_t, v.ext, current_date, now() - interval '1 hour', 60000, 60000, 60000, v.receipt
from fx
cross join lateral (values (fx.invoice_1, 'cm-inv-1', '1101'), (fx.invoice_2, 'cm-inv-2', '1102'), (fx.invoice_3, 'cm-inv-3', '1103'), (fx.invoice_4, 'cm-inv-4', '1104')) as v (id, ext, receipt);

insert into public.coupons (id, tenant_id, programme_id, reward_key, name, cost_points)
select coupon_t, tenant_t, programme_t, 'free-drink', 'Synthetic free drink', 10 from fx;

create function pg_temp.enqueue(p_membership uuid, p_kind text, p_key text, p_params jsonb default '{}'::jsonb, p_tenant uuid default null)
returns uuid
language sql
as $$
  select app.enqueue_customer_message(coalesce(p_tenant, (select tenant_t from fx)), p_membership, p_kind, p_key, p_params, (select store_1 from fx), null, now());
$$;

create function pg_temp.messages(p_kind text, p_membership uuid)
returns integer
language sql
as $$
  select count(*)::integer from public.outbound_messages o
  where o.tenant_id = (select tenant_t from fx) and o.kind = p_kind and o.recipient_ref = 'membership:' || p_membership::text;
$$;

select ok(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'outbound_messages_kind_check') like '%''digest''%''announcement''%''staff_digest''%''points_confirmed''%''coupon_issued''%''voucher_expiring''%''expiry_reminder''%''birthday''%''win_back''%',
  'the kind check keeps the earlier kinds in their order and adds the six customer kinds'
);
select ok(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'outbound_messages_queue_shape') like '%customer%',
  'a customer queue row waits without a destination row'
);
select ok(not has_table_privilege('service_role', 'app.customer_message_settings', 'select'), 'the service role cannot read the customer message settings');
select ok(not has_table_privilege('authenticated', 'app.customer_oa_contacts', 'select'), 'authenticated cannot read the OA contacts');
select ok(not has_function_privilege('service_role', 'app.enqueue_customer_message(uuid, uuid, text, text, jsonb, uuid, timestamptz, timestamptz)', 'execute'), 'the service role cannot queue customer messages');
select ok(not has_function_privilege('authenticated', 'app.link_customer_oa_user(uuid, text, uuid, timestamptz)', 'execute'), 'authenticated cannot link OA users');

select is(pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'off-check'), null, 'nothing is queued while the tenant has no messaging settings');
insert into app.customer_message_settings (tenant_id, enabled) select tenant_t, true from fx;
select is(app.customer_message_route_setting((select tenant_u from fx), 'points_confirmed'), 'off', 'a tenant without settings is off');
select is(app.customer_message_route_setting((select tenant_t from fx), 'points_confirmed'), 'free', 'points confirmations default to the free route');
select is(app.customer_message_route_setting((select tenant_t from fx), 'coupon_issued'), 'template', 'coupon messages default to the template route');
select is(app.customer_message_route_setting((select tenant_t from fx), 'win_back'), 'off', 'win-back is off without the promotions flag');

create temp table first_message as
select pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'manual-1', '{"points": 6, "stamps": 1}'::jsonb) as id;

select isnt((select id from first_message), null, 'an enabled tenant queues the message');
select is(
  (select row(o.channel, o.recipient_ref, o.subject_type::text, o.subject_id, o.purpose::text, o.status, o.message_class::text, o.template_ref, o.title, o.body, o.channel_id)::text
   from public.outbound_messages o where o.id = (select id from first_message)),
  row('mini_app', 'membership:' || (select member_a from fx)::text, 'customer', (select customer_a from fx), 'loyalty', 'queued', 'transactional', 'customer.points_confirmed.v1', null::text, null::text, null::uuid)::text,
  'the row starts in-app with an opaque membership recipient, the customer as subject, the loyalty purpose and no text'
);
select is(
  (select o.consent_record_id from public.outbound_messages o where o.id = (select id from first_message)),
  (select c.id from public.consent_records c where c.subject_id = (select customer_a from fx) and c.purpose = 'loyalty'),
  'the loyalty consent is the reference'
);
select is(
  (select o.params from public.outbound_messages o where o.id = (select id from first_message)),
  jsonb_build_object('points', 6, 'stamps', 1, 'membership_id', (select member_a from fx)::text),
  'the parameters are the counts and the membership reference only'
);
select ok(app.facts_are_count_only((select o.params from public.outbound_messages o where o.id = (select id from first_message))), 'the parameters are count-only');
select is(
  (select o.expires_at - o.created_at from public.outbound_messages o where o.id = (select id from first_message)),
  interval '24 hours',
  'a points confirmation expires after 24 hours'
);
select is(pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'manual-1', '{"points": 9}'::jsonb), (select id from first_message), 'the same event returns the first message');
select is((select count(*)::integer from public.outbound_messages where dedupe_key = 'customer:points_confirmed:manual-1'), 1, 'the event is queued once');

select throws_ok($$ select pg_temp.enqueue((select member_a from fx), 'newsletter', 'x-1') $$, '22023', null, 'an unknown kind is refused');
select throws_ok($$ select pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'Bad Key') $$, '22023', null, 'a malformed event key is refused');
select throws_ok($$ select pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'x-2', '{"customer_name": "Synthetic A"}'::jsonb) $$, '22023', null, 'a name in the parameters is refused');
select throws_ok(
  $$ insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, status, kind, message_class, dedupe_key, body)
     select tenant_t, 'zalo_zbs', 'membership:' || member_a::text, 'customer', customer_a, 'queued', 'points_confirmed', 'transactional', 'customer:points_confirmed:with-body', 'Chào Synthetic A' from fx $$,
  '23514', null, 'a customer message never stores a body'
);
select throws_ok(
  $$ insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, status, kind, message_class, dedupe_key)
     select tenant_t, 'zalo_zbs', '0900000' || '101', 'customer', customer_a, 'queued', 'points_confirmed', 'transactional', 'customer:points_confirmed:raw-phone' from fx $$,
  '23514', null, 'a customer message never stores a phone as recipient'
);

select is(pg_temp.enqueue((select member_c from fx), 'points_confirmed', 'no-consent'), null, 'a member without loyalty consent gets nothing');
select is(pg_temp.enqueue((select member_d from fx), 'points_confirmed', 'suspended'), null, 'a suspended member gets nothing');
select is(pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'other-tenant', '{}'::jsonb, (select tenant_u from fx)), null, 'a membership of another tenant gets nothing');
select is(pg_temp.enqueue((select member_a from fx), 'birthday', 'birthday-1'), null, 'a birthday message waits for the promotions flag');
update app.customer_message_settings set promotions_enabled = true where tenant_id = (select tenant_t from fx);
select is(pg_temp.enqueue((select member_b from fx), 'birthday', 'birthday-b'), null, 'no promotional message is queued without marketing consent');
create temp table birthday_message as select pg_temp.enqueue((select member_a from fx), 'birthday', 'birthday-a') as id;
select is(
  (select row(o.message_class::text, o.purpose::text, o.consent_record_id)::text from public.outbound_messages o where o.id = (select id from birthday_message)),
  row('advertising', 'marketing', (select c.id from public.consent_records c where c.subject_id = (select customer_a from fx) and c.purpose = 'marketing'))::text,
  'a birthday message is advertising under the marketing consent'
);
update app.customer_message_settings set points_route = 'off' where tenant_id = (select tenant_t from fx);
select is(pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'route-off'), null, 'a route switched off queues nothing');
update app.customer_message_settings set points_route = 'free' where tenant_id = (select tenant_t from fx);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_a, store_1, 'earn', 1, 6, invoice_1, current_date, 'A' from fx;
select is(pg_temp.messages('points_confirmed', (select member_a from fx)), 2, 'a confirmed earn queues a points confirmation');
select is(
  (select o.params - 'membership_id' from public.outbound_messages o
   join public.loyalty_ledger l on o.dedupe_key = 'customer:points_confirmed:' || l.id::text
   where l.invoice_id = (select invoice_1 from fx)),
  (select jsonb_build_object('entry_id', l.id::text, 'points', 6, 'stamps', 1) from public.loyalty_ledger l where l.invoice_id = (select invoice_1 from fx)),
  'the earn''s message carries the entry and its counts'
);
select is(
  (select o.store_id from public.outbound_messages o join public.loyalty_ledger l on o.dedupe_key = 'customer:points_confirmed:' || l.id::text where l.invoice_id = (select invoice_1 from fx)),
  (select store_1 from fx),
  'the earn''s store is the message''s store'
);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, pending)
select tenant_t, programme_t, member_b, store_1, 'earn', 1, 6, invoice_2, current_date, 'C', true from fx;
select is(pg_temp.messages('points_confirmed', (select member_b from fx)), 0, 'a pending earn queues nothing');
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, business_date, source_entry_id)
select tenant_t, programme_t, member_b, store_1, 'confirm', invoice_2, current_date, l.id from fx join public.loyalty_ledger l on l.invoice_id = fx.invoice_2 and l.entry_kind = 'earn';
select is(
  (select o.dedupe_key from public.outbound_messages o where o.recipient_ref = 'membership:' || (select member_b from fx)::text and o.kind = 'points_confirmed'),
  (select 'customer:points_confirmed:' || l.id::text from public.loyalty_ledger l where l.invoice_id = (select invoice_2 from fx) and l.entry_kind = 'earn'),
  'its confirmation queues the message keyed on the earn'
);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_b, store_1, 'earn', 0, 0, invoice_3, current_date, 'A' from fx;
select is(pg_temp.messages('points_confirmed', (select member_b from fx)), 1, 'an earn that credits nothing queues nothing');
update app.customer_message_settings set enabled = false where tenant_id = (select tenant_t from fx);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_b, store_1, 'earn', 1, 6, invoice_4, current_date, 'A' from fx;
select is(pg_temp.messages('points_confirmed', (select member_b from fx)), 1, 'nothing is queued while messaging is disabled');
update app.customer_message_settings set enabled = true where tenant_id = (select tenant_t from fx);

insert into public.redemptions (id, tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at)
select '22222222-2222-4222-8222-000000011001'::uuid, tenant_t, store_1, member_a, coupon_t, 'SYNCM001', 'held'::public.redemption_state, now(), now() + interval '5 hours' from fx
union all
select '22222222-2222-4222-8222-000000011002'::uuid, tenant_t, store_1, member_b, coupon_t, 'SYNCM002', 'held', now() - interval '2 days', now() + interval '10 hours' from fx;
select is(pg_temp.messages('coupon_issued', (select member_a from fx)), 1, 'a held redemption queues a coupon message');
select is(
  (select row(o.expires_at, o.params ->> 'redemption_id')::text from public.outbound_messages o where o.dedupe_key = 'customer:coupon_issued:22222222-2222-4222-8222-000000011001'),
  row(now() + interval '5 hours', '22222222-2222-4222-8222-000000011001')::text,
  'the coupon message expires with the hold and names the redemption'
);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, point_delta, value_amount, reason, expires_at, occurred_at)
select tenant_t, programme_t, member_b, 'adjust', 50, 25000, 'synthetic credit', now() + interval '3 days', now() - interval '1 day' from fx;

create temp table reminders as select app.enqueue_customer_reminders(now(), (select tenant_t from fx)) as counts;
select is(
  (select counts from reminders),
  jsonb_build_object('voucher_expiring', 1, 'expiry_reminder', 1, 'win_back', 1),
  'one voucher reminder, one expiry reminder and one win-back are queued'
);
select is(pg_temp.messages('voucher_expiring', (select member_b from fx)), 1, 'the long hold ending within 24 hours is reminded');
select is(pg_temp.messages('voucher_expiring', (select member_a from fx)), 0, 'a hold shorter than the lead gets no reminder');
select is(
  (select o.params - 'membership_id' from public.outbound_messages o where o.kind = 'expiry_reminder' and o.recipient_ref = 'membership:' || (select member_b from fx)::text),
  jsonb_build_object('points', 50, 'stamps', 0, 'expires_on', to_char(((now() + interval '3 days') at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD')),
  'the expiry reminder counts the expiring points and names the day'
);
select is(pg_temp.messages('win_back', (select member_e from fx)), 1, 'a consenting member inactive for 45 days gets the win-back');
select is(pg_temp.messages('win_back', (select member_a from fx)), 0, 'a recent member gets no win-back');
select is(
  app.enqueue_customer_reminders(now(), (select tenant_t from fx)),
  jsonb_build_object('voucher_expiring', 0, 'expiry_reminder', 0, 'win_back', 0),
  'a second scan the same day queues nothing'
);

select is(app.customer_message_oa((select tenant_t from fx), (select member_a from fx), null), (select oa_t from fx), 'the OA of the member''s brand speaks');
select is(app.customer_message_oa((select tenant_t from fx), (select member_c from fx), (select store_1 from fx)), (select oa_t from fx), 'a member without a brand is reached by the OA of the store''s brand');
select is(app.link_customer_oa_user((select oa_t from fx), 'syn-oa-user-1', (select customer_a from fx)), 'linked', 'a customer is linked to an OA user');
select is(app.link_customer_oa_user((select oa_t from fx), 'syn-oa-user-1', (select customer_a from fx)), 'unchanged', 'the same link changes nothing');
select is(app.link_customer_oa_user((select oa_t from fx), 'syn-oa-user-2', (select customer_a from fx)), 'moved', 'a new OA user id replaces the old one');
select is(app.link_customer_oa_user((select oa_t from fx), 'syn-oa-user-2', (select customer_b from fx)), 'linked', 'an OA user id moves to the customer it now names');
select is((select count(*)::integer from app.customer_oa_contacts where oa_id = (select oa_t from fx)), 1, 'an OA user id belongs to one customer of the OA');
select throws_ok(
  $$ select app.link_customer_oa_user((select oa_t from fx), 'syn-oa-user-3', (select customer_u from fx)) $$,
  '22023', null, 'a customer of another tenant cannot be linked'
);

select * from finish();
rollback;
