begin;
select plan(30);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011301'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000011301'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000011301'::uuid as store_1,
  '44444444-4444-4444-8444-000000011301'::uuid as brand_t,
  '55555555-5555-4555-8555-000000011301'::uuid as app_t,
  '66666666-6666-4666-8666-000000011301'::uuid as oa_t,
  'eeeeeeee-eeee-4eee-8eee-000000011301'::uuid as owner_t,
  'eeeeeeee-eeee-4eee-8eee-000000011302'::uuid as user_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011301'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011302'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011303'::uuid as customer_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011304'::uuid as customer_d,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011305'::uuid as customer_e,
  '99999999-9999-4999-8999-000000011301'::uuid as member_a,
  '99999999-9999-4999-8999-000000011302'::uuid as member_b,
  '99999999-9999-4999-8999-000000011303'::uuid as member_c,
  '99999999-9999-4999-8999-000000011304'::uuid as member_d,
  '99999999-9999-4999-8999-000000011305'::uuid as member_e,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000011301'::uuid as programme_t,
  '77777777-7777-4777-8777-000000011301'::uuid as coupon_t,
  '88888888-8888-4888-8888-000000011301'::uuid as invoice_1,
  '22222222-2222-4222-8222-000000011301'::uuid as redemption_e,
  ((((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1) + time '12:00') at time zone 'Asia/Ho_Chi_Minh') as noon;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-consent-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_t, fx.user_a]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'customer-consent-t', 'Customer consent T', 'VN' from fx;
insert into public.tenant_members (tenant_id, user_id, role)
select tenant_t, owner_t, 'owner' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'customer-consent-t', 'Synthetic account T' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_t, account_t, 'cc-1', 'Synthetic store 1' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-1', 'Synthetic brand T', array[store_1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_t, tenant_t, brand_t, 'syn-app-11301', 'ZALO_APP_SECRET_BRAND_1' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-cc-oa-t', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;

insert into public.customers (id, tenant_id, phone, name)
select v.id, fx.tenant_t, '0900000' || right(v.tail, 3), null
from fx cross join lateral (values (fx.customer_a, '11301'), (fx.customer_b, '11302'), (fx.customer_c, '11303'), (fx.customer_d, '11304'), (fx.customer_e, '11305')) as v (id, tail);

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme T', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select v.member, fx.tenant_t, fx.programme_t, v.customer, 'mini_app', now() - interval '90 days', fx.brand_t
from fx cross join lateral (values (fx.member_a, fx.customer_a), (fx.member_b, fx.customer_b), (fx.member_c, fx.customer_c), (fx.member_d, fx.customer_d), (fx.member_e, fx.customer_e)) as v (member, customer);
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_t, app_t, 'syn-cc-zalo-a', user_a, customer_a from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select fx.tenant_t, 'customer'::public.consent_subject, v.customer, v.purpose::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '90 days'
from fx cross join lateral (values
  (fx.customer_a, 'loyalty'), (fx.customer_a, 'marketing'),
  (fx.customer_b, 'loyalty'),
  (fx.customer_c, 'loyalty'), (fx.customer_c, 'marketing'),
  (fx.customer_d, 'loyalty'),
  (fx.customer_e, 'loyalty')
) as v (customer, purpose);

insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled)
select tenant_t, true, true, true from fx;
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select fx.tenant_t, fx.oa_t, v.ext, v.tag, v.purpose, 'approved'
from fx cross join lateral (values
  ('syn-cc-points', 'customer_care', 'points_confirmation'),
  ('syn-cc-voucher', 'transaction', 'voucher'),
  ('syn-cc-birthday', 'customer_care', 'birthday'),
  ('syn-cc-winback', 'promotion', 'win_back')
) as v (ext, tag, purpose);
insert into public.coupons (id, tenant_id, programme_id, reward_key, name, cost_points)
select coupon_t, tenant_t, programme_t, 'free-drink', 'Synthetic free drink', 10 from fx;
insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, business_date, sold_at, gross_amount, net_amount, paid_amount, receipt_no)
select invoice_1, tenant_t, store_1, account_t, 'cc-inv-1', current_date, now() - interval '1 hour', 60000, 60000, 60000, '2201' from fx;

create function pg_temp.drain(p_at timestamptz)
returns integer
language plpgsql
as $$
declare
  c record;
  n integer := 0;
begin
  loop
    select * into c from app.claim_next_customer_message('pgtap', array['consultation', 'template'], interval '2 minutes', p_at, (select tenant_t from fx));
    exit when c.message_id is null;
    perform app.begin_customer_send(c.message_id, c.claimed_at, p_at);
    perform app.finish_customer_send(c.message_id, c.claimed_at, 'sent', null, 'mock-' || c.message_id::text, null, p_at);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function pg_temp.rows_of(p_member uuid, p_kind text)
returns text
language sql
as $$
  select coalesce(string_agg(o.status || ':' || o.channel || ':' || coalesce(o.decision, ''), ',' order by o.created_at, o.id), '')
  from public.outbound_messages o
  where o.tenant_id = (select tenant_t from fx) and o.kind = p_kind and o.recipient_ref = 'membership:' || p_member::text;
$$;

select is(
  app.enqueue_customer_reminders((select noon from fx), (select tenant_t from fx)) ->> 'win_back',
  '2',
  'the win-back scan queues only the two members who agreed to promotions'
);
select is(pg_temp.rows_of((select member_b from fx), 'win_back'), '', 'a member without marketing consent gets no win-back');
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_b from fx), 'birthday', 'cc-birthday-b', '{}'::jsonb, null, null, (select noon from fx)),
  null,
  'nor a birthday message'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', (select user_a from fx), 'role', 'authenticated',
  'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_t from fx), 'customer_id', (select customer_a from fx))
)::text, true);
set local role authenticated;
select is(public.customer_stop_marketing() ->> 'marketing_consent', 'false', 'the member taps Dừng nhận tin');
reset role;

select is(pg_temp.drain((select noon from fx)), 1, 'one promotional template goes out');
select is(pg_temp.rows_of((select member_a from fx), 'win_back'), 'cancelled:mini_app:no_marketing_consent', 'the win-back queued before Dừng nhận tin is cancelled, never sent');
select is(pg_temp.rows_of((select member_c from fx), 'win_back'), 'sent:zalo_zbs:send', 'the consenting member receives the win-back template');
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_a from fx), 'birthday', 'cc-birthday-a', '{}'::jsonb, null, null, (select noon from fx)),
  null,
  'after Dừng nhận tin no promotion is queued'
);

select isnt(
  app.enqueue_customer_message((select tenant_t from fx), (select member_c from fx), 'birthday', 'cc-birthday-c', '{}'::jsonb, null, null, (select noon from fx) + interval '1 hour'),
  null,
  'a second promotion for the same member is queued'
);
select is(pg_temp.drain((select noon from fx) + interval '1 hour'), 0, 'it is not sent');
select is(pg_temp.rows_of((select member_c from fx), 'birthday'), 'held:mini_app:daily_cap', 'it is held by the one-a-day cap of Tag 3');

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_d, store_1, 'earn', 1, 6, invoice_1, current_date, 'A' from fx;
select is(pg_temp.rows_of((select member_d from fx), 'points_confirmed'), 'queued:mini_app:', 'a confirmed earn queues the points confirmation');
-- the earn trigger stamps the row with the real clock; pin its life to the fixture's noon so the 24-hour expiry never depends on the time of day the suite runs
update public.outbound_messages set expires_at = (select noon from fx) + interval '23 hours'
where kind = 'points_confirmed' and subject_id = (select customer_d from fx);
update public.consent_records set revoked_at = (select noon from fx) - interval '1 minute' where subject_id = (select customer_d from fx) and purpose = 'loyalty';
select is(pg_temp.drain((select noon from fx) + interval '1 hour'), 0, 'nothing goes out after the loyalty consent is withdrawn');
select is(pg_temp.rows_of((select member_d from fx), 'points_confirmed'), 'cancelled:mini_app:no_consent', 'the waiting confirmation is cancelled');
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_d from fx), 'points_confirmed', 'cc-after-withdrawal', '{}'::jsonb, null, null, (select noon from fx)),
  null,
  'and nothing new is queued'
);

-- boundary values of the 24-hour expiry: the row expires at exactly the drain instant (cancelled), one second later it is still sent
insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, business_date, sold_at, gross_amount, net_amount, paid_amount, receipt_no)
select v.id, tenant_t, store_1, account_t, v.ext, current_date, now() - interval '1 hour', 60000, 60000, 60000, v.ext
from fx cross join (values ('88888888-8888-4888-8888-000000011302'::uuid, 'cc-inv-2'), ('88888888-8888-4888-8888-000000011303'::uuid, 'cc-inv-3')) as v (id, ext);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_e, store_1, 'earn', 1, 6, '88888888-8888-4888-8888-000000011302'::uuid, current_date, 'A' from fx;
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
select tenant_t, programme_t, member_b, store_1, 'earn', 1, 6, '88888888-8888-4888-8888-000000011303'::uuid, current_date, 'A' from fx;
select is(pg_temp.rows_of((select member_e from fx), 'points_confirmed'), 'queued:mini_app:', 'boundary: the second confirmation is queued');
update public.outbound_messages set expires_at = (select noon from fx) + interval '1 hour'
where kind = 'points_confirmed' and subject_id = (select customer_e from fx);
update public.outbound_messages set expires_at = (select noon from fx) + interval '1 hour 1 second'
where kind = 'points_confirmed' and subject_id = (select customer_b from fx);
select is(pg_temp.drain((select noon from fx) + interval '1 hour'), 0, 'boundary: nothing is claimed for Zalo, the in-app delivery of the unexpired row is shown by its status below');
select is(pg_temp.rows_of((select member_e from fx), 'points_confirmed'), 'cancelled:mini_app:expired', 'boundary: expiry at exactly the drain instant cancels');
select is(pg_temp.rows_of((select member_b from fx), 'points_confirmed'), 'sent:mini_app:outside_window', 'boundary: one second before expiry it is delivered in the app');

select app.link_customer_oa_user((select oa_t from fx), 'syn-cc-user-c', (select customer_c from fx));
insert into public.data_subject_requests (id, tenant_id, subject_type, subject_id, contact, request_type, received_at)
select '11111111-1111-4111-8111-000000011301'::uuid, tenant_t, 'customer', customer_c, 'synthetic contact', 'deletion', now() from fx;
select lives_ok(
  $$ select app.dsr_erase_customer('11111111-1111-4111-8111-000000011301'::uuid, (select owner_t from fx), now()) $$,
  'the customer is deleted on request'
);
select is(
  (select string_agg(o.status || ':' || o.recipient_ref || ':' || coalesce(o.subject_id::text, 'none') || ':' || coalesce(o.params::text, 'none'), ',' order by o.kind)
   from public.outbound_messages o where o.tenant_id = (select tenant_t from fx) and o.kind in ('birthday', 'win_back') and o.subject_type = 'customer' and o.subject_id is null),
  'cancelled:redacted:none:none,sent:redacted:none:none',
  'the deleted customer''s waiting promotion is cancelled and both rows are redacted to their counts'
);
select is((select count(*)::integer from app.customer_oa_contacts where customer_id = (select customer_c from fx)), 0, 'the OA tie goes with the customer');
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_c from fx), 'points_confirmed', 'cc-after-deletion', '{}'::jsonb, null, null, (select noon from fx)),
  null,
  'nothing is queued for a deleted customer'
);
select is(pg_temp.drain((select noon from fx) + interval '25 hours'), 0, 'and nothing goes out');

create temp table in_flight as
select c.message_id, c.claimed_at
from (select app.enqueue_customer_message((select tenant_t from fx), (select member_b from fx), 'coupon_issued', 'cc-in-flight', '{}'::jsonb, null, null, (select noon from fx)) as id) q
cross join lateral app.claim_next_customer_message('pgtap', array['template'], interval '2 minutes', (select noon from fx), (select tenant_t from fx)) c;
insert into public.data_subject_requests (id, tenant_id, subject_type, subject_id, contact, request_type, received_at)
select '11111111-1111-4111-8111-000000011302'::uuid, tenant_t, 'customer', customer_b, 'synthetic contact', 'deletion', now() from fx;
select app.dsr_erase_customer('11111111-1111-4111-8111-000000011302'::uuid, (select owner_t from fx), now());
select is(
  app.finish_customer_send((select message_id from in_flight), (select claimed_at from in_flight), 'sent', null, 'mock-in-flight', null, (select noon from fx)),
  'sent',
  'a message being sent when its customer is deleted still records the provider''s answer'
);
select is(
  (select row(o.status, o.recipient_ref, o.subject_id, o.params)::text from public.outbound_messages o where o.id = (select message_id from in_flight)),
  row('sent', 'redacted', null::uuid, null::jsonb)::text,
  'and is redacted at once'
);

select app.link_customer_oa_user((select oa_t from fx), 'syn-cc-user-e', (select customer_e from fx));
insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
select tenant_t, oa_t, encode(sha256(convert_to('cc-e', 'UTF8')), 'hex'), 'user_send_text', 'syn-cc-user-e', noon - interval '30 minutes', noon - interval '30 minutes', 'raw' from fx;
insert into public.redemptions (id, tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at)
select redemption_e, tenant_t, store_1, member_e, coupon_t, 'SYNCC001', 'held'::public.redemption_state, noon, noon + interval '20 hours' from fx;
select is(pg_temp.drain((select noon from fx)), 1, 'the coupon of the member who messaged the OA goes out');
select is(pg_temp.rows_of((select member_e from fx), 'coupon_issued'), 'sent:zalo_oa:send', 'as the free consultation message');
select is(
  (select count(*)::integer from public.outbound_messages o where o.tenant_id = (select tenant_t from fx) and o.channel = 'zalo_zbs' and o.recipient_ref = 'membership:' || (select member_e from fx)::text),
  0,
  'and no paid template is sent for the same event'
);
select ok(
  (select bool_and(o.title is null and o.body is null and coalesce(app.facts_are_count_only(o.params), true) and o.recipient_ref ~ '^(membership:|redacted$)')
   from public.outbound_messages o where o.tenant_id = (select tenant_t from fx)),
  'every customer row stays count-only with an opaque recipient'
);

select * from finish();
rollback;
