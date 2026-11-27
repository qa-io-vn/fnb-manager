begin;
select plan(31);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011101'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000011101'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000011101'::uuid as store_1,
  '44444444-4444-4444-8444-000000011101'::uuid as brand_t,
  '66666666-6666-4666-8666-000000011101'::uuid as oa_t,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011101'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011102'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011103'::uuid as customer_c,
  '99999999-9999-4999-8999-000000011101'::uuid as member_a,
  '99999999-9999-4999-8999-000000011102'::uuid as member_b,
  '99999999-9999-4999-8999-000000011103'::uuid as member_c,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000011101'::uuid as programme_t,
  -- the scenario runs from noon to noon + 8 days and counts a monthly allowance, so it must stay inside one
  -- calendar month: tomorrow when that leaves room, otherwise the 2nd of next month
  ((case
      when extract(day from (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1) <= 20
        then (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1
      else (date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date) + interval '1 month 1 day')::date
    end + time '12:00') at time zone 'Asia/Ho_Chi_Minh') as noon;

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'customer-routing-t', 'Customer routing T', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'customer-routing-t', 'Synthetic account T' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_t, account_t, 'cr-1', 'Synthetic store 1' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-1', 'Synthetic brand T', array[store_1] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-cr-oa-t', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;

insert into public.customers (id, tenant_id, phone, name)
select customer_a, tenant_t, '0900000' || '101', 'Synthetic A' from fx
union all select customer_b, tenant_t, '0900000' || '102', null from fx
union all select customer_c, tenant_t, null, null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme T', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_a, tenant_t, programme_t, customer_a, 'mini_app', now() - interval '10 days', brand_t from fx
union all select member_b, tenant_t, programme_t, customer_b, 'mini_app', now() - interval '10 days', brand_t from fx
union all select member_c, tenant_t, programme_t, customer_c, 'oa_form', now() - interval '10 days', brand_t from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select fx.tenant_t, 'customer'::public.consent_subject, v.customer, v.purpose::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '10 days'
from fx
cross join lateral (values (fx.customer_a, 'loyalty'), (fx.customer_a, 'marketing'), (fx.customer_b, 'loyalty'), (fx.customer_c, 'loyalty')) as v (customer, purpose);

insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled)
select tenant_t, true, true, true from fx;

insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select fx.tenant_t, fx.oa_t, v.ext, v.tag, v.purpose, v.state
from fx
cross join lateral (values
  ('syn-tpl-points', 'customer_care', 'points_confirmation', 'approved'),
  ('syn-tpl-voucher', 'transaction', 'voucher', 'approved'),
  ('syn-tpl-coupon', 'customer_care', 'coupon_issued', 'approved'),
  ('syn-tpl-winback', 'promotion', 'win_back', 'approved'),
  ('syn-tpl-expiry', 'customer_care', 'expiry_reminder', 'pending_review')
) as v (ext, tag, purpose, state);

create function pg_temp.at_local(p_days integer, p_time time)
returns timestamptz
language sql
as $$
  select ((((select noon from fx) at time zone 'Asia/Ho_Chi_Minh')::date + p_days) + p_time) at time zone 'Asia/Ho_Chi_Minh';
$$;

create function pg_temp.enqueue(p_membership uuid, p_kind text, p_key text, p_expires timestamptz default null, p_at timestamptz default null)
returns uuid
language sql
as $$
  select app.enqueue_customer_message((select tenant_t from fx), p_membership, p_kind, p_key, '{"points": 4}'::jsonb, (select store_1 from fx), p_expires, coalesce(p_at, (select noon from fx)));
$$;

create function pg_temp.route(p_id uuid, p_at timestamptz default null)
returns text
language sql
as $$
  select row(r.decision, r.route, r.reason, r.window_kind)::text from app.customer_message_route(p_id, coalesce(p_at, (select noon from fx))) r;
$$;

create function pg_temp.interact(p_user text, p_at timestamptz, p_name text default 'user_send_text')
returns void
language sql
as $$
  insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
  select tenant_t, oa_t, encode(sha256(convert_to(p_user || p_name || p_at::text, 'UTF8')), 'hex'), p_name, p_user, p_at, p_at, 'raw' from fx;
$$;

create function pg_temp.sent_row(p_customer uuid, p_membership uuid, p_kind text, p_channel text, p_at timestamptz, p_key text, p_extra jsonb default '{}'::jsonb)
returns void
language sql
as $$
  insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, status, kind, message_class, dedupe_key, params, created_at, claimed_at, sent_at, expires_at)
  select tenant_t, p_channel, 'membership:' || p_membership::text, 'customer', p_customer, 'sent', p_kind, app.customer_message_class(p_kind), 'customer:' || p_kind || ':' || p_key,
    jsonb_build_object('membership_id', p_membership::text, 'oa_id', oa_t::text) || p_extra, p_at, p_at, p_at, p_at + interval '1 day'
  from fx;
$$;

create temp table m (name text primary key, id uuid);
insert into m values
  ('points_b', pg_temp.enqueue((select member_b from fx), 'points_confirmed', 'r-points-b')),
  ('coupon_b', pg_temp.enqueue((select member_b from fx), 'coupon_issued', 'r-coupon-b')),
  ('points_a', pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'r-points-a')),
  ('coupon_a', pg_temp.enqueue((select member_a from fx), 'coupon_issued', 'r-coupon-a')),
  ('winback_a', pg_temp.enqueue((select member_a from fx), 'win_back', 'r-winback-a')),
  ('expiry_b', pg_temp.enqueue((select member_b from fx), 'expiry_reminder', 'r-expiry-b')),
  ('coupon_c', pg_temp.enqueue((select member_c from fx), 'coupon_issued', 'r-coupon-c')),
  ('short_b', pg_temp.enqueue((select member_b from fx), 'coupon_issued', 'r-short-b', pg_temp.at_local(0, time '23:45'))),
  ('points_a3', pg_temp.enqueue((select member_a from fx), 'points_confirmed', 'r-points-a3', null, (select noon from fx) + interval '71 hours')),
  ('coupon_a3', pg_temp.enqueue((select member_a from fx), 'coupon_issued', 'r-coupon-a3', null, (select noon from fx) + interval '71 hours'));

select is(pg_temp.route((select id from m where name = 'points_b')), '(send,in_app,outside_window,)', 'without an OA conversation a points confirmation stays in the app');
select is(pg_temp.route((select id from m where name = 'coupon_b')), '(send,template,,)', 'outside the window a coupon goes as a ZBS template');
select is(
  (select r.template_id from app.customer_message_route((select id from m where name = 'coupon_b'), (select noon from fx)) r),
  (select z.id from public.zbs_templates z where z.external_id = 'syn-tpl-voucher'),
  'the coupon uses the voucher template, the layout that carries a code'
);
update public.zbs_templates set approval_state = 'pending_review' where external_id = 'syn-tpl-voucher';
select is(
  (select z.external_id from app.customer_message_route((select id from m where name = 'coupon_b'), (select noon from fx)) r join public.zbs_templates z on z.id = r.template_id),
  'syn-tpl-coupon',
  'without an approved voucher template the coupon template serves'
);
update public.zbs_templates set approval_state = 'approved' where external_id = 'syn-tpl-voucher';
select is(pg_temp.route((select id from m where name = 'expiry_b')), '(send,in_app,no_template,)', 'a kind without an approved template stays in the app');

select app.link_customer_oa_user((select oa_t from fx), 'syn-cr-user-a', (select customer_a from fx));
select pg_temp.interact('syn-cr-user-a', (select noon from fx) - interval '2 hours');
select is(pg_temp.route((select id from m where name = 'points_a')), '(send,consultation,,free)', 'a customer who messaged the OA two hours ago gets the free consultation message');
select is(pg_temp.route((select id from m where name = 'coupon_a')), '(send,consultation,,free)', 'the free message replaces the paid template for the same event');
select is(
  (select r.oa_id from app.customer_message_route((select id from m where name = 'coupon_a'), (select noon from fx)) r),
  (select oa_t from fx),
  'the consultation goes from the member''s OA'
);
select is(pg_temp.route((select id from m where name = 'winback_a')), '(send,template,,)', 'a promotion never goes as a consultation message');
select is(
  pg_temp.route((select id from m where name = 'points_a3'), (select noon from fx) + interval '3 days'),
  '(send,in_app,outside_window,)',
  'three days after the conversation the free window is closed and no allowance is configured'
);
update app.customer_message_settings set out_of_window_monthly_quota = 1 where tenant_id = (select tenant_t from fx);
select is(
  pg_temp.route((select id from m where name = 'coupon_a3'), (select noon from fx) + interval '3 days'),
  '(send,consultation,,allowance)',
  'inside the API''s 7 days the out-of-window allowance carries a consultation message'
);
select pg_temp.sent_row((select customer_b from fx), (select member_b from fx), 'points_confirmed', 'zalo_oa', (select noon from fx) + interval '2 days', 'allowance-used', '{"window": "allowance"}'::jsonb);
select is(
  pg_temp.route((select id from m where name = 'coupon_a3'), (select noon from fx) + interval '3 days'),
  '(send,template,,)',
  'once the month''s allowance is used the template goes instead'
);
select is(
  pg_temp.route((select id from m where name = 'coupon_a'), (select noon from fx) + interval '8 days'),
  '(cancel,,expired,)',
  'an expired message is cancelled'
);

select is(pg_temp.route((select id from m where name = 'points_a'), pg_temp.at_local(0, time '23:00')), '(hold,consultation,outside_hours,free)', 'a consultation message waits for the OA''s hours while the free window stays open');
select is(
  (select r.release_at from app.customer_message_route((select id from m where name = 'points_a'), pg_temp.at_local(0, time '23:00')) r),
  pg_temp.at_local(1, time '07:00'),
  'it is released at 07:00'
);
select is(pg_temp.route((select id from m where name = 'coupon_b'), pg_temp.at_local(0, time '23:00')), '(hold,template,outside_hours,)', 'a template waits for the template hours');
select is(
  (select r.release_at from app.customer_message_route((select id from m where name = 'coupon_b'), pg_temp.at_local(0, time '23:00')) r),
  pg_temp.at_local(1, time '06:00'),
  'it is released at 06:00'
);
select is(pg_temp.route((select id from m where name = 'short_b'), pg_temp.at_local(0, time '23:00')), '(send,in_app,outside_hours,)', 'a template that could only go after the message expires stays in the app');

update public.outbound_messages set params = params || '{"consultation_refused": true}'::jsonb where id = (select id from m where name = 'coupon_a');
select is(pg_temp.route((select id from m where name = 'coupon_a')), '(send,template,,)', 'after the OA refused the consultation message the template goes');

select is(pg_temp.route((select id from m where name = 'coupon_c')), '(send,in_app,no_recipient,)', 'a customer without a phone or an OA user stays in the app');

update app.customer_message_settings set zbs_daily_quota = 1 where tenant_id = (select tenant_t from fx);
select pg_temp.sent_row((select customer_a from fx), (select member_a from fx), 'points_confirmed', 'zalo_zbs', (select noon from fx) - interval '1 hour', 'quota-used');
select is(pg_temp.route((select id from m where name = 'coupon_b')), '(hold,template,zbs_quota,)', 'the OA''s daily template quota holds the next template');
select is(
  (select r.release_at from app.customer_message_route((select id from m where name = 'coupon_b'), (select noon from fx)) r),
  pg_temp.at_local(1, time '06:00'),
  'until the template hours of the next day'
);
update app.customer_message_settings set zbs_daily_quota = 1000 where tenant_id = (select tenant_t from fx);

select pg_temp.sent_row((select customer_a from fx), (select member_a from fx), 'birthday', 'zalo_zbs', (select noon from fx) - interval '2 hours', 'cap-day');
select is(pg_temp.route((select id from m where name = 'winback_a')), '(hold,template,daily_cap,)', 'a second promotion within 24 hours is held (Tag 3: one a day)');
select is(
  (select r.release_at from app.customer_message_route((select id from m where name = 'winback_a'), (select noon from fx)) r),
  (select noon from fx) + interval '22 hours',
  'until the first one is 24 hours old'
);
insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, max_per_month, label_position, opt_out_text, consent_purpose, requires_consent, source_note)
select tenant_t, 'zalo_zbs', 'advertising', true, '07:00', '22:00', 3, 'rolling_24h', 1, 'template', 'Bỏ quan tâm OA hoặc chặn tin để ngừng nhận.', 'marketing', true, 'synthetic tighter monthly cap' from fx;
select is(pg_temp.route((select id from m where name = 'winback_a')), '(send,in_app,monthly_cap,)', 'a promotion the monthly per-user cap would hold past its life stays in the app');
delete from public.channel_policies where tenant_id = (select tenant_t from fx);

update public.consent_records set revoked_at = (select noon from fx) - interval '1 minute' where subject_id = (select customer_a from fx) and purpose = 'marketing';
select is(pg_temp.route((select id from m where name = 'winback_a')), '(cancel,,no_marketing_consent,)', 'a promotion is cancelled once the marketing consent is withdrawn');
select is(pg_temp.route((select id from m where name = 'points_a')), '(send,consultation,,free)', 'withdrawing marketing keeps the loyalty messages');

update public.memberships set status = 'suspended' where id = (select member_b from fx);
select is(pg_temp.route((select id from m where name = 'points_b')), '(cancel,,membership_inactive,)', 'a suspended member gets nothing');
update public.memberships set status = 'active' where id = (select member_b from fx);

update public.consent_records set revoked_at = (select noon from fx) - interval '1 minute' where subject_id = (select customer_b from fx) and purpose = 'loyalty';
select is(pg_temp.route((select id from m where name = 'coupon_b')), '(cancel,,no_consent,)', 'a message waiting when the loyalty consent is withdrawn is cancelled');

update app.customer_message_settings set points_route = 'in_app' where tenant_id = (select tenant_t from fx);
select is(pg_temp.route((select id from m where name = 'points_a')), '(send,in_app,in_app_only,)', 'an in-app route never leaves the app');
update app.customer_message_settings set enabled = false where tenant_id = (select tenant_t from fx);
select is(pg_temp.route((select id from m where name = 'points_a')), '(cancel,,messaging_disabled,)', 'switching messaging off cancels what waits');

select * from finish();
rollback;
