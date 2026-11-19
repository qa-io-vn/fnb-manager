begin;
select plan(34);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011201'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000011201'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000011201'::uuid as store_1,
  '44444444-4444-4444-8444-000000011201'::uuid as brand_t,
  '66666666-6666-4666-8666-000000011201'::uuid as oa_t,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011201'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011202'::uuid as customer_b,
  '99999999-9999-4999-8999-000000011201'::uuid as member_a,
  '99999999-9999-4999-8999-000000011202'::uuid as member_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000011201'::uuid as programme_t,
  '77777777-7777-4777-8777-000000011201'::uuid as coupon_t,
  '88888888-8888-4888-8888-000000011201'::uuid as invoice_1,
  '22222222-2222-4222-8222-000000011201'::uuid as redemption_b,
  ((((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1) + time '12:00') at time zone 'Asia/Ho_Chi_Minh') as noon;

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'customer-dispatch-t', 'Customer dispatch T', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'customer-dispatch-t', 'Synthetic account T' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_t, account_t, 'cd-1', 'Synthetic store 1' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-1', 'Synthetic brand T', array[store_1] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-cd-oa-t', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.customers (id, tenant_id, phone, name)
select customer_a, tenant_t, '0900000' || '101', 'Synthetic A' from fx
union all select customer_b, tenant_t, '0900000' || '102', 'Synthetic B' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme T', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_a, tenant_t, programme_t, customer_a, 'mini_app', now() - interval '10 days', brand_t from fx
union all select member_b, tenant_t, programme_t, customer_b, 'mini_app', now() - interval '10 days', brand_t from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select fx.tenant_t, 'customer'::public.consent_subject, v.customer, 'loyalty'::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '10 days'
from fx cross join lateral (values (fx.customer_a), (fx.customer_b)) as v (customer);
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled)
select tenant_t, true, true from fx;
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select tenant_t, oa_t, 'syn-tpl-voucher', 'transaction', 'voucher', 'approved' from fx;
insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, business_date, sold_at, gross_amount, net_amount, paid_amount, receipt_no)
select invoice_1, tenant_t, store_1, account_t, 'cd-inv-1', current_date, now() - interval '1 hour', 60000, 60000, 60000, '001234' from fx;
insert into public.coupons (id, tenant_id, programme_id, reward_key, name, cost_points)
select coupon_t, tenant_t, programme_t, 'free-drink', 'Synthetic free drink', 10 from fx;

select app.link_customer_oa_user((select oa_t from fx), 'syn-cd-user-a', (select customer_a from fx));
insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
select tenant_t, oa_t, encode(sha256(convert_to('cd-a', 'UTF8')), 'hex'), 'user_send_text', 'syn-cd-user-a', noon - interval '1 hour', noon - interval '1 hour', 'raw' from fx;

insert into public.loyalty_ledger (id, tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, created_at)
select '33333333-3333-4333-8333-000000011201'::uuid, tenant_t, programme_t, member_a, store_1, 'earn', 1, 6, invoice_1, current_date, 'A', noon - interval '5 minutes' from fx;
insert into public.redemptions (id, tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at)
select redemption_b, tenant_t, store_1, member_b, coupon_t, 'SYNCD001', 'held'::public.redemption_state, noon - interval '5 minutes', noon + interval '20 hours' from fx;
create temp table in_app as
select app.enqueue_customer_message(tenant_t, member_b, 'points_confirmed', 'cd-in-app', '{"points": 2}'::jsonb, store_1, null, noon - interval '10 minutes') as id from fx;

create function pg_temp.claim(p_routes text[], p_at timestamptz default null)
returns setof record
language sql
as $$
  select c.message_id, c.claimed_at, c.kind, c.route, c.window_kind, c.template_external_id, c.template_purpose, c.recipient_kind, c.recipient, c.parameters
  from app.claim_next_customer_message('pgtap', p_routes, interval '2 minutes', coalesce(p_at, (select noon from fx)), (select tenant_t from fx)) c;
$$;

create temp table claims (n integer, message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);

insert into claims select 1, * from pg_temp.claim(array['consultation', 'template']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);

select is(
  (select row(o.status, o.channel, o.decision, o.cost_amount, o.params ->> 'route')::text from public.outbound_messages o where o.id = (select id from in_app)),
  row('sent', 'mini_app', 'outside_window', 0::numeric(14,2), 'in_app')::text,
  'an in-app message is closed at once as sent in the app, at no cost'
);
select is((select count(*)::integer from claims where message_id = (select id from in_app)), 0, 'an in-app message is never handed to an adapter');
select is((select count(*)::integer from claims where n = 1), 1, 'one message is claimed');
select is(
  (select row(kind, route, window_kind, recipient_kind, recipient)::text from claims where n = 1),
  row('points_confirmed', 'consultation', 'free', 'uid', 'syn-cd-user-a')::text,
  'the member who messaged the OA is claimed for a free consultation message to their OA user id'
);
select is(
  (select parameters from claims where n = 1),
  jsonb_build_object('customer_name', 'Synthetic A', 'points', 6, 'stamps', 1, 'bill_no', '001234', 'store_name', 'Synthetic store 1'),
  'the name, counts, bill number and store are resolved for the adapter'
);
select is(
  (select row(o.status, o.channel, o.template_ref, o.title, o.body, o.params ->> 'route', o.params ->> 'window', o.params ->> 'oa_id')::text from public.outbound_messages o where o.id = (select message_id from claims where n = 1)),
  row('sending', 'zalo_oa', 'consultation.points_confirmed.v1', null::text, null::text, 'consultation', 'free', (select oa_t from fx)::text)::text,
  'the claimed row holds the route and the OA, never the text'
);
select ok(
  (select bool_and(app.facts_are_count_only(o.params) and o.title is null and o.body is null and o.recipient_ref ~ '^membership:')
   from public.outbound_messages o where o.tenant_id = (select tenant_t from fx)),
  'no customer row holds a name, a phone or another personal parameter'
);
select ok(
  not exists (
    select 1 from public.outbound_messages o
    where o.tenant_id = (select tenant_t from fx)
      and (o::text like '%Synthetic A%' or o::text like '%' || (select right(c.phone, 9) from public.customers c where c.id = (select customer_a from fx)) || '%' or o::text like '%syn-cd-user-a%' or o::text like '%001234%' or o::text like '%SYNCD001%')
  ),
  'neither the name, the phone, the OA user id, the bill number nor the code is stored'
);

select ok(app.begin_customer_send((select message_id from claims where n = 1), (select claimed_at from claims where n = 1), (select noon from fx)), 'the send begins on the live claim');
select ok(not app.begin_customer_send((select message_id from claims where n = 1), (select claimed_at from claims where n = 1) - interval '1 second', (select noon from fx)), 'a stale claim cannot begin');
select is(
  app.finish_customer_send((select message_id from claims where n = 1), (select claimed_at from claims where n = 1), 'sent', null, 'mock-cs-1', null, (select noon from fx)),
  'sent',
  'the consultation message is sent'
);
select is(
  (select row(o.status, o.sent_at, o.provider_message_id, o.lease_until)::text from public.outbound_messages o where o.id = (select message_id from claims where n = 1)),
  row('sent', (select noon from fx), 'mock-cs-1', null::timestamptz)::text,
  'the row records the provider id and time'
);

insert into claims select 2, * from pg_temp.claim(array['consultation']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is((select count(*)::integer from claims where n = 2), 0, 'a dispatcher without the template adapter claims no template');
select is(
  (select o.status from public.outbound_messages o where o.dedupe_key = 'customer:coupon_issued:' || (select redemption_b from fx)::text),
  'queued',
  'the template waits for a dispatcher that has it'
);

insert into claims select 3, * from pg_temp.claim(array['consultation', 'template']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is(
  (select row(kind, route, template_external_id, template_purpose, recipient_kind, recipient)::text from claims where n = 3),
  row('coupon_issued', 'template', 'syn-tpl-voucher', 'voucher', 'phone', '84' || '900000102')::text,
  'the coupon goes as the voucher template to the phone, without its plus sign'
);
select is(
  (select parameters from claims where n = 3),
  jsonb_build_object('customer_name', 'Synthetic B', 'points', 0, 'stamps', 0, 'store_name', 'Synthetic store 1', 'reward_name', 'Synthetic free drink', 'voucher_code', 'SYNCD001',
    'expires_at', to_char(((select noon from fx) + interval '20 hours') at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY')),
  'the reward, its code and the end of the hold are resolved'
);
select is(
  (select row(o.channel, o.template_ref, o.params ->> 'template_id')::text from public.outbound_messages o where o.id = (select message_id from claims where n = 3)),
  row('zalo_zbs', 'zbs.voucher.v1', (select z.id from public.zbs_templates z where z.external_id = 'syn-tpl-voucher')::text)::text,
  'the row names the template row, not its content'
);
select ok(app.begin_customer_send((select message_id from claims where n = 3), (select claimed_at from claims where n = 3), (select noon from fx)), 'the template send begins');
select is(
  app.finish_customer_send((select message_id from claims where n = 3), (select claimed_at from claims where n = 3), 'uncertain', 'timeout', null, null, (select noon from fx)),
  'uncertain',
  'a provider timeout leaves the message uncertain'
);
insert into claims select 4, * from pg_temp.claim(array['consultation', 'template'], (select noon from fx) + interval '10 minutes') as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is((select count(*)::integer from claims where n = 4), 0, 'an uncertain message is never claimed again');
select is(
  app.finish_customer_send((select message_id from claims where n = 3), (select claimed_at from claims where n = 3), 'sent', null, 'mock-zbs-late', null, (select noon from fx) + interval '1 minute'),
  'sent',
  'a late confirmation turns it into sent'
);
select is(
  app.finish_customer_send((select message_id from claims where n = 3), (select claimed_at from claims where n = 3) - interval '1 second', 'sent', null, 'x', null, (select noon from fx)),
  'lost',
  'an answer for another claim is lost'
);

create temp table retry_message as
select app.enqueue_customer_message(tenant_t, member_b, 'coupon_issued', 'cd-retry', '{}'::jsonb, store_1, null, noon) as id from fx;
insert into claims select 5, * from pg_temp.claim(array['template']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is((select message_id from claims where n = 5), (select id from retry_message), 'the next template is claimed');
select is(
  app.finish_customer_send((select message_id from claims where n = 5), (select claimed_at from claims where n = 5), 'retry', 'quota_exceeded', null, 3600, (select noon from fx)),
  'queued',
  'a quota answer queues it again'
);
select is(
  (select row(o.status, o.not_before, o.last_error_code, o.send_started_at)::text from public.outbound_messages o where o.id = (select id from retry_message)),
  row('queued', (select noon from fx) + interval '1 hour', 'quota_exceeded', null::timestamptz)::text,
  'not before the provider''s retry-after'
);
update public.outbound_messages set attempts = 4 where id = (select id from retry_message);
insert into claims select 6, * from pg_temp.claim(array['template'], (select noon from fx) + interval '2 hours') as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is(
  app.finish_customer_send((select message_id from claims where n = 6), (select claimed_at from claims where n = 6), 'retry', 'http_500', null, null, (select noon from fx) + interval '2 hours'),
  'failed',
  'the fifth attempt that fails ends as failed'
);

create temp table reroute_message as
select app.enqueue_customer_message(tenant_t, member_a, 'coupon_issued', 'cd-reroute', '{}'::jsonb, store_1, null, noon) as id from fx;
insert into claims select 7, * from pg_temp.claim(array['consultation', 'template']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is((select row(message_id, route)::text from claims where n = 7), row((select id from reroute_message), 'consultation')::text, 'the coupon of the member in the window is claimed as a consultation message');
select is(
  app.finish_customer_send((select message_id from claims where n = 7), (select claimed_at from claims where n = 7), 'reroute', 'window_closed', null, null, (select noon from fx)),
  'queued',
  'the OA''s refusal of the consultation message queues it again at once'
);
insert into claims select 8, * from pg_temp.claim(array['consultation', 'template']) as c (message_id uuid, claimed_at timestamptz, kind text, route text, window_kind text, template_external_id text, template_purpose text, recipient_kind text, recipient text, parameters jsonb);
select is(
  (select row(message_id, route, recipient_kind, recipient)::text from claims where n = 8),
  row((select id from reroute_message), 'template', 'uid', 'syn-cd-user-a')::text,
  'the next claim sends the template to the OA user id instead'
);
select ok(app.begin_customer_send((select message_id from claims where n = 8), (select claimed_at from claims where n = 8), (select noon from fx)), 'its send begins');
select is(app.recover_message_leases((select noon from fx) + interval '5 minutes', (select tenant_t from fx)), 1, 'its lease expires without an answer');
select is(
  (select row(o.status, o.last_error_code)::text from public.outbound_messages o where o.id = (select id from reroute_message)),
  row('uncertain', 'lease_expired')::text,
  'a send that started and lost its lease is uncertain, never resent'
);
select is(
  app.finish_customer_send((select message_id from claims where n = 8), (select claimed_at from claims where n = 8), 'failed', 'user_unreachable', null, null, (select noon from fx)),
  'lost',
  'a failure answer cannot reopen an uncertain message'
);
select throws_ok(
  $$ select app.finish_customer_send((select message_id from claims where n = 8), (select claimed_at from claims where n = 8), 'maybe', null, null, null, now()) $$,
  '22023', null, 'an unknown outcome is refused'
);

select * from finish();
rollback;
