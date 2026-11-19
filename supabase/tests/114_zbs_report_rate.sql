begin;
select plan(16);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011401'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000011401'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000011401'::uuid as store_1,
  '44444444-4444-4444-8444-000000011401'::uuid as brand_t,
  '66666666-6666-4666-8666-000000011401'::uuid as oa_t,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011401'::uuid as customer_a,
  '99999999-9999-4999-8999-000000011401'::uuid as member_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000011401'::uuid as programme_t,
  date '2026-11-10' as day;

insert into public.tenants (id, slug, name, country_code)
select tenant_t, 'zbs-report-rate-t', 'ZBS report rate T', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'zbs-report-rate-t', 'Synthetic account T' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_t, account_t, 'zr-1', 'Synthetic store 1' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-1', 'Synthetic brand T', array[store_1] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-zr-oa-t', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.customers (id, tenant_id, phone)
select customer_a, tenant_t, '0900000' || '101' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme T', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, brand_id)
select member_a, tenant_t, programme_t, customer_a, 'mini_app', brand_t from fx;

create function pg_temp.sent_templates(p_count integer, p_day date)
returns void
language sql
as $$
  insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, status, kind, message_class, dedupe_key, params, created_at, claimed_at, sent_at, expires_at)
  select fx.tenant_t, 'zalo_zbs', 'membership:' || fx.member_a::text, 'customer', fx.customer_a, 'sent', 'points_confirmed', 'transactional',
    'customer:points_confirmed:zr-' || p_day::text || '-' || n::text,
    jsonb_build_object('membership_id', fx.member_a::text, 'oa_id', fx.oa_t::text, 'route', 'template'),
    t.at, t.at, t.at, t.at + interval '1 day'
  from fx
  cross join generate_series(1, p_count) as n
  cross join lateral (select ((p_day + time '10:00') at time zone 'Asia/Ho_Chi_Minh') + make_interval(secs => n) as at) t;
$$;

select is(
  (select row(category, delivery, default_enabled, default_severity::text, default_roles::text, default_cooldown, store_scoped)::text from public.alert_rule_catalog where rule_key = 'zbs_report_rate'),
  row('channel', 'immediate', true, 'warning', '{owner}', interval '24 hours', false)::text,
  'zbs_report_rate is an immediate channel warning to owners with a 24-hour cool-down'
);
select ok(
  (select app.alert_rule_params_valid(rule_key, default_params) from public.alert_rule_catalog where rule_key = 'zbs_report_rate'),
  'its defaults pass its parameter schema'
);
select ok(not app.alert_rule_params_valid('zbs_report_rate', '{"max_rate_percent": 3}'::jsonb), 'a threshold above Zalo''s 2 % is refused');
select is(
  array(select unnest(app.customer_template_purposes(k)) from unnest(array['points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back']) as k),
  array['points_confirmation', 'voucher', 'coupon_issued', 'voucher', 'expiry_reminder', 'birthday', 'win_back'],
  'every customer kind maps to the registered template purposes'
);

select pg_temp.sent_templates(10, (select day from fx));
select is(app.zbs_sent_on((select oa_t from fx), (select day from fx)), 10, 'the day''s sent templates of the OA are counted from the outbox');
select is(app.record_zbs_reports((select oa_t from fx), (select day from fx), 5), 'too_few_sent', 'a day under min_sent raises nothing');
select is((select reported from app.zbs_quality_days where oa_id = (select oa_t from fx) and day = (select day from fx)), 5, 'the report count is stored');
select pg_temp.sent_templates(100, (select day from fx) + 1);
select is(app.record_zbs_reports((select oa_t from fx), (select day from fx) + 1, 0), 'below_threshold', 'no report raises nothing');
select is(app.record_zbs_reports((select oa_t from fx), (select day from fx) + 1, 1), 'below_threshold', 'a rate equal to the 1 % threshold raises nothing');
select is(app.record_zbs_reports((select oa_t from fx), (select day from fx) + 1, 2), 'opened', 'a rate of 2 % raises the alert');
select is(
  (select row(e.rule_key, e.dedupe_key, e.business_date, e.state, e.source)::text from public.alert_events e where e.tenant_id = (select tenant_t from fx)),
  row('zbs_report_rate', 'zbs_report_rate:oa:' || (select oa_t from fx)::text, (select day from fx) + 1, 'resolved', 'notify')::text,
  'an instant episode under the OA'
);
select is(
  (select e.facts from public.alert_events e where e.tenant_id = (select tenant_t from fx)),
  '{"sent": 100, "reported": 2, "rate_permille": 20, "max_rate_permille": 10}'::jsonb,
  'its facts are counts only'
);
select is((select reported from app.zbs_quality_days where oa_id = (select oa_t from fx) and day = (select day from fx) + 1), 2, 'a later count replaces the day''s figure');
insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_t, 'zbs_report_rate', false from fx;
select is(app.record_zbs_reports((select oa_t from fx), (select day from fx) + 1, 3), 'disabled', 'a disabled rule raises nothing');
select throws_ok($$ select app.record_zbs_reports((select oa_t from fx), (select day from fx), -1) $$, '22023', null, 'a negative count is refused');
select ok(not has_function_privilege('service_role', 'app.record_zbs_reports(uuid, date, integer, timestamptz)', 'execute'), 'the service role cannot record reports');

select * from finish();
rollback;
