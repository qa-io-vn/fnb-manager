-- GA-065, the weekly cap of promotional Zalo messages (migration weekly_promotion_cap, ADR-073): "Tối đa 2 tin mỗi
-- tuần" counted over a rolling 7 days in the customer's send decision (app.customer_message_route at claim time).
-- Techniques: boundary values of the window (a message sent 7 days minus 1 second before still counts, one sent exactly
-- 7 days before no longer does) and of the cap (1, 2, 3 on the floor); a decision table of the hold (inside the
-- template hours, at the cap, the release before or after the message's end) with the outcome hold until the exact
-- instant or the app instead; equivalence partitions of what is counted (sending, sent, delivered and uncertain
-- promotions of this customer on this channel; not failed or cancelled ones, not transactional ones, not another
-- customer's); and the floor as a CHECK constraint that binds every writer (a Zalo promotion row that may send is held
-- to 1 or 2 a week; a row written without the number takes 2; other channels and classes are free).
begin;
select plan(27);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030901'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000030901'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000030901'::uuid as store_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030901'::uuid as brand_a,
  '99999999-9999-4999-8999-000000030901'::uuid as app_a,
  '66666666-6666-4666-8666-000000030901'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000030991'::uuid as programme_a,
  '77777777-7777-4777-8777-000000030901'::uuid as customer_m,
  '77777777-7777-4777-8777-000000030902'::uuid as customer_n,
  '88888888-8888-4888-8888-000000030901'::uuid as member_m,
  '88888888-8888-4888-8888-000000030902'::uuid as member_n,
  'eeeeeeee-eeee-4eee-8eee-000000030911'::uuid as member_u,
  timestamptz '2026-11-20 10:00+07' as s1,
  timestamptz '2026-11-22 10:00+07' as s2;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select member_u, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'cap-309@example.com', jsonb_build_object('kind', 'customer', 'tenant_id', tenant_a) from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_a, 'cap-309-a', 'Cap 309 A', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'cap-309-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) select store_a1, tenant_a, account_a, 't309-a1', 'wc-1', 'Synthetic store A1' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-309-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-309-oa-a', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.customers (id, tenant_id, phone, name)
select customer_m, tenant_a, '0900000' || '309', 'Synthetic member' from fx union all select customer_n, tenant_a, '0900001' || '309', 'Synthetic other' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_m, tenant_a, programme_a, customer_m, 'mini_app', '2026-10-01 10:00+07'::timestamptz, brand_a from fx union all
select member_n, tenant_a, programme_a, customer_n, 'mini_app', '2026-10-01 10:00+07'::timestamptz, brand_a from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_a, 'customer'::public.consent_subject, c.id, p.purpose::public.consent_purpose, 'synthetic-v1', 'mini_app', '2026-10-01 10:00+07'::timestamptz
from fx cross join lateral (values (fx.customer_m), (fx.customer_n)) c (id) cross join (values ('loyalty'), ('marketing')) p (purpose);
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id) select tenant_a, app_a, 'syn-zalo-309-m', member_u, customer_m from fx;
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled) select tenant_a, true, true, true from fx;
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select tenant_a, oa_a, 'syn-tpl-' || p, 'promotion', p, 'approved' from fx cross join (values ('win_back'), ('birthday')) v (p);

-- A promotion already sent to a customer on ZBS at p_at (as the dispatcher leaves it), in the given status.
create function pg_temp.past(p_member uuid, p_customer uuid, p_kind text, p_at timestamptz, p_status text default 'sent') returns uuid language sql as $$
  insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, status, created_at, sent_at, claimed_at,
    kind, message_class, store_id, dedupe_key, params, expires_at)
  values ((select tenant_a from fx), 'zalo_zbs', 'membership:' || p_member, 'customer', p_customer,
    case when app.customer_message_class(p_kind) = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end,
    'zbs.' || p_kind || '.v1', p_status, p_at, case when p_status in ('sent', 'delivered') then p_at end, p_at,
    p_kind, app.customer_message_class(p_kind), (select store_a1 from fx), 'customer:' || p_kind || ':past:' || gen_random_uuid(), jsonb_build_object('membership_id', p_member::text),
    p_at + interval '1 day')
  returning id;
$$;
create function pg_temp.route(p_id uuid, p_at timestamptz) returns text language sql stable as $$
  select row(r.decision, r.route, r.reason, r.release_at)::text from app.customer_message_route(p_id, p_at) r;
$$;
create temp table m (name text primary key, id uuid);
create function pg_temp.m(p_name text) returns uuid language sql stable as $$ select id from m where name = p_name $$;
-- Replaces the named past promotion of the member by one sent at s2 in the given status (a finished row never changes).
create function pg_temp.swap(p_name text, p_status text) returns void language plpgsql as $$
begin
  delete from public.outbound_messages where id = pg_temp.m(p_name);
  delete from m where name = p_name;
  insert into m select p_name, pg_temp.past((select member_m from fx), (select customer_m from fx), 'birthday', (select s2 from fx), p_status);
end;
$$;

-- 1. The policy rows and the floor -------------------------------------------------------------------------------------
select is((select string_agg(channel_kind::text || ':' || coalesce(max_per_week::text, 'none'), ', ' order by channel_kind::text)
  from public.channel_policies where tenant_id is null and message_class = 'advertising' and allowed),
  'email:none, mini_app:none, sms:none, zalo_oa:2, zalo_zbs:2', 'the global Zalo promotion rows cap 2 a week; the other channels have no weekly cap');
select throws_ok($$insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, max_per_week, label_position,
  opt_out_text, consent_purpose, requires_consent, source_note) select tenant_a, 'zalo_zbs', 'advertising', true, '07:00', '22:00', 1, 'rolling_24h', 3, 'template',
  'Bỏ quan tâm OA hoặc chặn tin để ngừng nhận.', 'marketing', true, 'synthetic three a week' from fx$$, '23514', null,
  'boundary: a Zalo promotion row of 3 a week is refused by the floor');
select lives_ok($$insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, label_position,
  opt_out_text, consent_purpose, requires_consent, source_note) select tenant_a, 'zalo_zbs', 'advertising', true, '07:00', '22:00', 1, 'rolling_24h', 'template',
  'Bỏ quan tâm OA hoặc chặn tin để ngừng nhận.', 'marketing', true, 'synthetic without the number' from fx$$, 'a row written without the number is taken');
select is((select max_per_week from public.channel_policies where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_zbs'), 2::smallint, 'and holds the promised 2');
select throws_ok($$update public.channel_policies set max_per_week = 3 where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_zbs'$$, '23514', null,
  'raising it to 3 later is refused too');
select lives_ok($$update public.channel_policies set max_per_week = 1 where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_zbs'$$, 'boundary: 1 a week is allowed');
select lives_ok($$update public.channel_policies set allowed = false, max_per_week = 50 where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_zbs'$$,
  'a row that may not send is free of the floor');
delete from public.channel_policies where tenant_id = (select tenant_a from fx);
select lives_ok($$insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, consent_purpose, requires_consent, source_note)
  select tenant_a, 'zalo_zbs', 'transactional', true, '06:00', '22:00', null, 'loyalty', true, 'synthetic transactional' from fx$$, 'a transactional Zalo row needs no weekly cap');
select is((select max_per_week from public.channel_policies where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_zbs'), null::smallint, 'and gets none');
delete from public.channel_policies where tenant_id = (select tenant_a from fx);

-- 2. The window: 7 days ± 1 second ---------------------------------------------------------------------------------------
insert into m select 'past1', pg_temp.past((select member_m from fx), (select customer_m from fx), 'win_back', (select s1 from fx));
insert into m select 'past2', pg_temp.past((select member_m from fx), (select customer_m from fx), 'birthday', (select s2 from fx));
insert into m select 'new', app.enqueue_customer_message(tenant_a, member_m, 'win_back', 'syn-309-new', jsonb_build_object('inactive_days', 45), store_a1, null,
  s1 + interval '7 days' - interval '2 hours') from fx;
select is(pg_temp.route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)),
  row('hold', 'template', 'weekly_cap', (select s1 + interval '7 days' from fx))::text,
  'boundary: 7 days less a second after the first, two count: held until the first is exactly 7 days old');
select is(pg_temp.route(pg_temp.m('new'), (select s1 + interval '7 days' from fx)), row('send', 'template', null::text, (select s1 + interval '7 days' from fx))::text,
  'boundary: at exactly 7 days the first no longer counts and the promotion goes');
select is(pg_temp.route(pg_temp.m('new'), (select s1 + interval '7 days' + interval '1 second' from fx)), row('send', 'template', null::text, (select s1 + interval '7 days' + interval '1 second' from fx))::text,
  'boundary: a second later too');

-- 3. What counts ------------------------------------------------------------------------------------------------------
delete from public.outbound_messages where id = pg_temp.m('past2'); do $$ begin perform pg_temp.swap('past2', 'cancelled'); end $$;
select is((select r.decision from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'send', 'a cancelled promotion does not count');
do $$ begin perform pg_temp.swap('past2', 'failed'); end $$;
select is((select r.decision from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'send', 'nor a failed one');
do $$ begin perform pg_temp.swap('past2', 'uncertain'); end $$;
select is((select r.reason from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'weekly_cap', 'an uncertain one does (it may have gone)');
do $$ begin perform pg_temp.swap('past2', 'delivered'); end $$;
select is((select r.reason from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'weekly_cap', 'and a delivered one');
delete from public.outbound_messages where id = pg_temp.m('past2');
insert into m select 'tx', pg_temp.past((select member_m from fx), (select customer_m from fx), 'points_confirmed', (select s2 from fx));
select is((select r.decision from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'send',
  'a transactional message on ZBS is not a promotion and does not count');
insert into m select 'other', pg_temp.past((select member_n from fx), (select customer_n from fx), 'birthday', (select s2 from fx));
select is((select r.decision from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'send',
  'another customer''s promotion does not count');
do $$ begin perform pg_temp.swap('past2', 'sent'); end $$;

-- 4. The decision: the day first, the exact release, the app instead ---------------------------------------------------
insert into m select 'recent', pg_temp.past((select member_m from fx), (select customer_m from fx), 'birthday', (select s1 + interval '6 days 20 hours' from fx));
select is((select r.reason from app.customer_message_route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)) r), 'daily_cap',
  'within 24 hours of the last one the daily cap answers first');
delete from public.outbound_messages where id = pg_temp.m('recent');
insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, max_per_week, max_per_month, label_position,
  opt_out_text, consent_purpose, requires_consent, source_note)
select tenant_a, 'zalo_zbs', 'advertising', true, '07:00', '22:00', 1, 'rolling_24h', 1, 30, 'template', 'Bỏ quan tâm OA hoặc chặn tin để ngừng nhận.', 'marketing', true, 'synthetic one a week' from fx;
select is(pg_temp.route(pg_temp.m('new'), (select s1 + interval '7 days' - interval '1 second' from fx)), row('hold', 'template', 'weekly_cap', (select s2 + interval '7 days' from fx))::text,
  'with 1 a week and two counted, held until the one that keeps the count at the cap (the newer) is 7 days old');
delete from public.channel_policies where tenant_id = (select tenant_a from fx);
insert into m select 'short', app.enqueue_customer_message(tenant_a, member_m, 'win_back', 'syn-309-short', jsonb_build_object('inactive_days', 45), store_a1,
  s1 + interval '7 days' - interval '1 minute', s1 + interval '7 days' - interval '2 hours') from fx;
select is(pg_temp.route(pg_temp.m('short'), (select s1 + interval '7 days' - interval '1 hour' from fx)),
  row('send', 'in_app', 'weekly_cap', (select s1 + interval '7 days' - interval '1 hour' from fx))::text,
  'a promotion that would end before the cap releases goes in the app instead (no third Zalo message)');
select is((select c.kind from app.claim_next_customer_message('pgtap-309', array['consultation', 'template'], interval '2 minutes',
  (select s1 + interval '7 days' - interval '1 hour' from fx), (select tenant_a from fx)) c), null, 'the dispatcher hands nothing to ZBS at that time');
select is((select row(o.status, o.channel, o.decision)::text from public.outbound_messages o where o.id = pg_temp.m('short')), row('sent', 'mini_app', 'weekly_cap')::text,
  'the short promotion is closed in the app, at no cost');
select is((select row(o.status, o.hold_reason, o.not_before = (select s1 + interval '7 days' from fx))::text from public.outbound_messages o where o.id = pg_temp.m('new')),
  row('held', 'weekly_cap', true)::text, 'the other one is held until the exact release instant');
select is((select count(*)::integer from app.customer_inbox i where i.dedupe_key = 'message:' || pg_temp.m('short')), 1, 'the promotion closed in the app reaches the customer''s inbox');
select is((select c.kind || ' ' || c.route from app.claim_next_customer_message('pgtap-309', array['consultation', 'template'], interval '2 minutes',
  (select s1 + interval '7 days' from fx), (select tenant_a from fx)) c), 'win_back template', 'at the release instant it is claimed for ZBS');
select is(app.finish_customer_send(pg_temp.m('new'), (select s1 + interval '7 days' from fx), 'sent', null, 'mock-zbs-309', null, (select s1 + interval '7 days' from fx)), 'sent',
  'and sent through the mock: the second promotion of the rolling week');

select * from finish();
rollback;
