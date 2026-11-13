begin;
select plan(64);

create temp table fx as
select
  '44444444-4444-4444-8444-000000000001'::uuid as tenant_a,
  '44444444-4444-4444-8444-000000000002'::uuid as tenant_b,
  '55555555-5555-4555-8555-000000000001'::uuid as owner_a,
  '55555555-5555-4555-8555-000000000002'::uuid as manager_a,
  '55555555-5555-4555-8555-000000000003'::uuid as store_manager_a,
  '55555555-5555-4555-8555-000000000004'::uuid as staff_a,
  '55555555-5555-4555-8555-000000000005'::uuid as viewer_a,
  '55555555-5555-4555-8555-000000000006'::uuid as publisher_a,
  '55555555-5555-4555-8555-000000000007'::uuid as owner_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '66666666-6666-4666-8666-000000000001'::uuid as account_a,
  '66666666-6666-4666-8666-000000000002'::uuid as account_b,
  '77777777-7777-4777-8777-000000000001'::uuid as store_a1,
  '77777777-7777-4777-8777-000000000002'::uuid as store_a2,
  '77777777-7777-4777-8777-000000000003'::uuid as store_b1;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'notify-owner-a@example.com'),
    (fx.manager_a, 'notify-manager-a@example.com'),
    (fx.store_manager_a, 'notify-store-manager-a@example.com'),
    (fx.staff_a, 'notify-staff-a@example.com'),
    (fx.viewer_a, 'notify-viewer-a@example.com'),
    (fx.publisher_a, 'notify-publisher-a@example.com'),
    (fx.owner_b, 'notify-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_a, 'notify-it-pgtap-a', 'Notify pgTAP A' from fx
union all
select tenant_b, 'notify-it-pgtap-b', 'Notify pgTAP B' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'notify-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'notify-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'notify-pgtap-store-a1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'notify-pgtap-store-a2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'notify-pgtap-store-b1', 'Synthetic store B1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_a, 'owner', null::uuid[]),
    (fx.manager_a, 'manager', null::uuid[]),
    (fx.store_manager_a, 'manager', array[fx.store_a1]),
    (fx.staff_a, 'staff', null::uuid[]),
    (fx.viewer_a, 'viewer', null::uuid[]),
    (fx.publisher_a, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

select app.ensure_notifications_consent(fx.tenant_a, m.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00')
from fx
cross join lateral (values (fx.owner_a), (fx.store_manager_a), (fx.manager_a)) as m (user_id);

insert into public.alert_rules (tenant_id, store_id, rule_key, params)
select tenant_a, null::uuid, 'revenue_below_baseline', '{"ratio": 0.6}'::jsonb from fx
union all
select tenant_a, store_a1, 'revenue_below_baseline', '{"min_sample_days": 6}'::jsonb from fx
union all
select tenant_a, store_a2, 'revenue_below_baseline', '{"ratio": 0.5}'::jsonb from fx
union all
select tenant_b, null::uuid, 'revenue_below_baseline', '{"ratio": 0.7}'::jsonb from fx;

insert into public.channel_policies (tenant_id, channel_kind, message_class, window_start, window_end, max_per_day, consent_purpose, source_note)
select tenant_a, 'email'::public.channel_kind, 'operational'::public.message_class, '06:00'::time, '24:00'::time, 10, 'notifications'::public.consent_purpose, 'pgTAP override' from fx
union all
select tenant_b, 'email'::public.channel_kind, 'operational'::public.message_class, '06:00'::time, '24:00'::time, 10, 'notifications'::public.consent_purpose, 'pgTAP override' from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, address_hint, secret_name, config, status, linked_at)
select v.id::uuid, v.tenant_id, v.kind::public.channel_kind, v.provider, v.label, v.user_id, v.address, v.hint, v.secret_name, v.config::jsonb, 'active', '2026-11-01 00:00+00'::timestamptz
from fx
cross join lateral (
  values
    ('88888888-8888-4888-8888-000000000001', fx.tenant_a, 'zalo_bot', 'zalo_bot', 'owner zalo', fx.owner_a, 'synthetic-chat-1', '…at-1', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}'),
    ('88888888-8888-4888-8888-000000000002', fx.tenant_a, 'email', 'brevo', 'store manager mail', fx.store_manager_a, null, 'n…@example.com', 'NOTIFY_EMAIL_API_KEY_IT', '{"from_name": "FNB Manager"}'),
    ('88888888-8888-4888-8888-000000000003', fx.tenant_a, 'zalo_bot', 'zalo_bot', 'manager zalo', fx.manager_a, 'synthetic-chat-3', '…at-3', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}'),
    ('88888888-8888-4888-8888-000000000004', fx.tenant_b, 'zalo_bot', 'zalo_bot', 'other owner zalo', fx.owner_b, 'synthetic-chat-4', '…at-4', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}')
) as v (id, tenant_id, kind, provider, label, user_id, address, hint, secret_name, config);

insert into public.alert_events (tenant_id, rule_key, dedupe_key, store_id, pos_account_id, severity, opened_at, last_seen_at, source)
select fx.tenant_a, 'auth_failed', 'auth_failed:account:' || fx.account_a::text, null::uuid, fx.account_a, 'critical'::public.alert_severity, now(), now(), 'incremental' from fx
union all
select fx.tenant_a, 'sync_stale', 'sync_stale:store:' || fx.store_a1::text, fx.store_a1, null::uuid, 'critical'::public.alert_severity, now(), now(), 'scheduler' from fx
union all
select fx.tenant_a, 'sync_stale', 'sync_stale:store:' || fx.store_a2::text, fx.store_a2, null::uuid, 'critical'::public.alert_severity, now(), now(), 'scheduler' from fx
union all
select fx.tenant_b, 'sync_stale', 'sync_stale:store:' || fx.store_b1::text, fx.store_b1, null::uuid, 'critical'::public.alert_severity, now(), now(), 'scheduler' from fx;

insert into public.digests (tenant_id, business_date, scope_key, store_ids, all_stores, state, trigger, data_state, model, model_version, fingerprint, built_at)
select v.tenant_id, '2026-11-07', md5(v.scope), v.store_ids, v.all_stores, 'built', 'settled', 'verified', '{"version": 1}'::jsonb, 1, repeat('a', 64), now()
from fx
cross join lateral (
  values
    (fx.tenant_a, fx.store_a1::text, array[fx.store_a1], false),
    (fx.tenant_a, least(fx.store_a1, fx.store_a2)::text || ',' || greatest(fx.store_a1, fx.store_a2)::text, array[fx.store_a1, fx.store_a2], true),
    (fx.tenant_b, fx.store_b1::text, array[fx.store_b1], true)
) as v (tenant_id, scope, store_ids, all_stores);

select app.enqueue_message(c.tenant_id, c.id, 'alert', 'alert.sync_stale.v1', 'a31:' || v.key, '{}'::jsonb, null, 'body', 'warning', v.store_id, null, null, null, null, '2026-11-08 03:00+00')
from fx
cross join lateral (
  values
    ('88888888-8888-4888-8888-000000000001'::uuid, 'owner', null::uuid),
    ('88888888-8888-4888-8888-000000000001'::uuid, 'store-a1', fx.store_a1),
    ('88888888-8888-4888-8888-000000000001'::uuid, 'store-a2', fx.store_a2),
    ('88888888-8888-4888-8888-000000000002'::uuid, 'store-manager-own', null::uuid),
    ('88888888-8888-4888-8888-000000000004'::uuid, 'tenant-b', null::uuid)
) as v (channel_id, key, store_id)
join public.notification_channels c on c.id = v.channel_id;

grant select on fx to authenticated, service_role, anon;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.visible()
returns integer[]
language sql
as $$
  select array[
    (select count(*)::integer from public.alert_rule_catalog),
    (select count(*)::integer from public.alert_rules),
    (select count(*)::integer from public.channel_policies),
    (select count(id)::integer from public.notification_channels),
    (select count(*)::integer from public.alert_events),
    (select count(*)::integer from public.digests),
    (select count(*)::integer from public.outbound_messages where tenant_id in ((select tenant_a from fx), (select tenant_b from fx)))
  ];
$$;

create function pg_temp.rule_value(p_store_id uuid, p_key text)
returns text
language sql
security definer
as $$
  select r.params ->> p_key from public.alert_rules r where r.tenant_id = (select tenant_a from fx) and r.store_id is not distinct from p_store_id and r.rule_key = 'revenue_below_baseline';
$$;

create function pg_temp.notifications_active(p_user_id uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from public.consent_records c
    where c.tenant_id = (select tenant_a from fx) and c.subject_id = p_user_id and c.purpose = 'notifications' and c.revoked_at is null
  );
$$;

create function pg_temp.global_window_start()
returns time
language sql
security definer
as $$
  select p.window_start from public.channel_policies p where p.tenant_id is null and p.channel_kind = 'zalo_bot' and p.message_class = 'operational';
$$;

select ok(not has_column_privilege('authenticated', 'public.notification_channels', 'address', 'select'), 'authenticated cannot select notification_channels.address');
select ok(not has_column_privilege('authenticated', 'public.notification_channels', 'secret_name', 'select'), 'authenticated cannot select notification_channels.secret_name');
select ok(not has_column_privilege('authenticated', 'public.notification_channels', 'config', 'select'), 'authenticated cannot select notification_channels.config');
select ok(has_column_privilege('authenticated', 'public.notification_channels', 'address_hint', 'select'), 'authenticated selects the address hint');
select ok(has_function_privilege('authenticated', 'app.alert_rule_params_valid(text, jsonb)', 'execute'), 'authenticated may execute app.alert_rule_params_valid');
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['channel_kind_available', 'notify_secret_name_valid', 'facts_are_count_only', 'alert_rule_params_valid', 'validate_alert_rule', 'validate_notification_channel', 'cancel_destination_messages', 'guard_outbound_message', 'current_user_channel_ids', 'sha256_hex', 'notify_random_code', 'effective_alert_rule', 'effective_channel_policy', 'tenant_has_destinations', 'enqueue_message', 'next_window_start', 'message_decision', 'claim_next_message', 'begin_send', 'notify_backoff', 'finish_send', 'recover_message_leases', 'expire_messages', 'record_dispatch', 'ensure_notifications_consent', 'issue_link_code', 'complete_channel_link', 'accept_channel_link', 'confirm_email_link', 'withdraw_notifications', 'take_poll_lease', 'release_poll_lease', 'redact_outbound_for_subject', 'redact_member_notifications', 'notify_housekeeping', 'issue_notify_ticket', 'post_notify_ticket', 'claim_notify_ticket', 'kick_notify', 'notify_tick_rules', 'notify_tick'])
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array['alert_rule_params_valid', 'channel_kind_available', 'current_user_channel_ids', 'facts_are_count_only', 'notify_secret_name_valid'],
  'authenticated executes only the check helpers, the parameter check and its own channel ids'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['channel_kind_available', 'notify_secret_name_valid', 'facts_are_count_only', 'alert_rule_params_valid', 'validate_alert_rule', 'validate_notification_channel', 'cancel_destination_messages', 'guard_outbound_message', 'current_user_channel_ids', 'sha256_hex', 'notify_random_code', 'effective_alert_rule', 'effective_channel_policy', 'tenant_has_destinations', 'enqueue_message', 'next_window_start', 'message_decision', 'claim_next_message', 'begin_send', 'notify_backoff', 'finish_send', 'recover_message_leases', 'expire_messages', 'record_dispatch', 'ensure_notifications_consent', 'issue_link_code', 'complete_channel_link', 'accept_channel_link', 'confirm_email_link', 'withdraw_notifications', 'take_poll_lease', 'release_poll_lease', 'redact_outbound_for_subject', 'redact_member_notifications', 'notify_housekeeping', 'issue_notify_ticket', 'post_notify_ticket', 'claim_notify_ticket', 'kick_notify', 'notify_tick_rules', 'notify_tick'])
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) or has_function_privilege('anon', p.oid, 'execute'))),
  0,
  'every notify function in app is revoked from public and anon'
);
select ok(not has_function_privilege('service_role', 'app.claim_next_message(text, text[], interval, timestamptz, uuid)', 'execute'), 'service_role cannot claim messages');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'consent_records' and permissive = 'RESTRICTIVE' and policyname in ('consent_records_notifications_not_inserted_from_browser', 'consent_records_notifications_not_updated_from_browser')),
  2,
  'the two restrictive consent policies exist'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'alert_rules' and cmd in ('INSERT', 'UPDATE', 'DELETE') and coalesce(qual, '') || coalesce(with_check, '') like '%owner%' and coalesce(qual, '') || coalesce(with_check, '') not like '%manager%'),
  3,
  'alert_rules has owner-only write policies'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name in ('alert_rule_catalog', 'alert_rules', 'channel_policies', 'notification_channels', 'alert_events', 'digests')),
  0,
  'anon holds no privilege on the new tables'
);
select is(
  (select count(*)::integer from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name = 'notification_channels'),
  0,
  'anon holds no column privilege on notification_channels'
);
select is(
  (select array_agg(distinct table_name::text order by table_name::text) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE') and table_name in ('alert_rule_catalog', 'alert_rules', 'channel_policies', 'notification_channels', 'alert_events', 'digests')),
  array['alert_rules', 'channel_policies'],
  'authenticated writes only alert_rules and channel_policies among the new tables'
);

set local role anon;
select throws_ok($$ select count(*) from public.alert_rule_catalog $$, '42501', null, 'anon cannot read the rule catalogue');
select throws_ok($$ select count(*) from public.alert_rules $$, '42501', null, 'anon cannot read alert_rules');
select throws_ok($$ select count(*) from public.channel_policies $$, '42501', null, 'anon cannot read channel_policies');
select throws_ok($$ select count(id) from public.notification_channels $$, '42501', null, 'anon cannot read notification_channels');
select throws_ok($$ select count(*) from public.alert_events $$, '42501', null, 'anon cannot read alert_events');
select throws_ok($$ select count(*) from public.digests $$, '42501', null, 'anon cannot read digests');
reset role;

set local role authenticated;

select pg_temp.act_as((select owner_a from fx));
select is(pg_temp.visible(), array[15, 3, 28, 3, 3, 2, 4], 'owner: catalogue, rules, policies, destinations, episodes, digests and messages of the own tenant');
select throws_ok($$ select address from public.notification_channels $$, '42501', null, 'owner cannot select a destination''s address');
select throws_ok($$ select * from public.notification_channels $$, '42501', null, 'select * on notification_channels fails for the browser');
select lives_ok($$ select id, kind, label, address_hint, status from public.notification_channels $$, 'named columns of notification_channels are readable');

select pg_temp.act_as((select manager_a from fx));
select is(pg_temp.visible(), array[15, 3, 28, 3, 3, 2, 4], 'unlimited manager: the same rows as the owner');

select pg_temp.act_as((select store_manager_a from fx));
select is(pg_temp.visible(), array[15, 2, 28, 1, 1, 1, 2], 'store-limited manager: tenant and own-store rules, own destination, own store''s episode, digest and messages, and own messages');

select pg_temp.act_as((select staff_a from fx));
select is(pg_temp.visible(), array[15, 0, 27, 0, 0, 0, 0], 'staff: the catalogue and the global policies only');

select pg_temp.act_as((select viewer_a from fx));
select is(pg_temp.visible(), array[15, 0, 27, 0, 0, 0, 0], 'viewer: the catalogue and the global policies only');

select pg_temp.act_as((select publisher_a from fx));
select is(pg_temp.visible(), array[15, 0, 27, 0, 0, 0, 0], 'publisher: the catalogue and the global policies only');

select pg_temp.act_as((select owner_b from fx));
select is(pg_temp.visible(), array[15, 1, 28, 1, 1, 1, 1], 'owner of another tenant: only that tenant''s rows');

select pg_temp.act_as((select demo_owner_id from fx));
select is((select count(*)::integer from public.outbound_messages), 2, 'the seed owner still reads the two seed messages');

select pg_temp.act_as((select owner_a from fx));
select lives_ok($$ insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'ticket_drop', '{"drop": 0.2}' from fx $$, 'owner inserts a tenant rule override');
select lives_ok($$ insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a1, 'zero_sales_open', false from fx $$, 'owner inserts a store rule override');
select lives_ok($$ update public.alert_rules set params = '{"ratio": 0.65}' where store_id is null and rule_key = 'revenue_below_baseline' and tenant_id = (select tenant_a from fx) $$, 'owner updates a tenant threshold');
select is(pg_temp.rule_value(null, 'ratio'), '0.65', 'the owner''s update is stored');
select lives_ok($$ delete from public.alert_rules where store_id = (select store_a2 from fx) $$, 'owner deletes a store override');
select is(pg_temp.rule_value((select store_a2 from fx), 'ratio'), null::text, 'the owner''s delete is stored');
select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'sync_stale', '{"threshold_minutes": 30}' from fx $$, '22023', null, 'the validation trigger runs as the owner and refuses a threshold under its minimum');
select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, created_by) select tenant_a, 'job_failed', manager_a from fx $$, '42501', null, 'owner cannot write a rule in someone else''s name');
select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_b, 'job_failed', false from fx $$, '42501', null, 'owner cannot write a rule of another tenant');

select lives_ok($$ insert into public.channel_policies (tenant_id, channel_kind, message_class, window_start, window_end, max_per_day, consent_purpose, source_note) select tenant_a, 'zalo_bot', 'operational', '07:00', '23:00', 10, 'notifications', 'quieter evenings' from fx $$, 'owner inserts a tenant policy override');
select throws_ok(
  $$ insert into public.channel_policies (tenant_id, channel_kind, message_class, window_start, window_end, max_per_day, cap_window, label, label_position, opt_out_text, sender_info_required, consent_purpose, source_note)
     select tenant_a, 'email', 'advertising', '07:00', '22:00', 4, 'rolling_24h', '[QC]', 'subject', 'Từ chối nhận quảng cáo: bấm Hủy đăng ký, trả lời TU CHOI, hoặc gọi {hotline}.', true, 'marketing', 'too many' from fx $$,
  '23514', null,
  'a browser write below the advertising floor fails its CHECK constraint'
);
select throws_ok(
  $$ insert into public.channel_policies (tenant_id, channel_kind, message_class, requires_consent, consent_purpose, source_note) select tenant_a, 'telegram', 'operational', false, null, 'no consent check' from fx $$,
  '23514', null,
  'a browser override that switches off the member consent check fails its CHECK constraint'
);
select throws_ok(
  $$ update public.channel_policies set requires_consent = false, consent_purpose = null where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_bot' and message_class = 'operational' $$,
  '23514', null,
  'a browser update that switches off the member consent check fails its CHECK constraint'
);
select is(
  (select row(requires_consent, consent_purpose::text)::text from public.channel_policies where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_bot' and message_class = 'operational'),
  row(true, 'notifications')::text,
  'the owner''s override keeps the consent check'
);
update public.channel_policies set window_start = '00:00' where tenant_id is null and channel_kind = 'zalo_bot' and message_class = 'operational';
select is(pg_temp.global_window_start(), time '06:00', 'owner cannot change a global policy');
select lives_ok($$ delete from public.channel_policies where tenant_id = (select tenant_a from fx) and channel_kind = 'zalo_bot' $$, 'owner deletes a tenant policy override');

select throws_ok($$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name) select tenant_a, 'email', 'brevo', 'from the browser', owner_a, 'NOTIFY_EMAIL_API_KEY_IT' from fx $$, '42501', null, 'owner cannot insert a destination directly');
select throws_ok($$ update public.notification_channels set label = 'renamed' $$, '42501', null, 'owner cannot update a destination directly');
select throws_ok($$ delete from public.alert_events $$, '42501', null, 'owner cannot delete episodes');
select throws_ok($$ insert into public.digests (tenant_id, business_date, scope_key, store_ids, all_stores, state) select tenant_a, '2026-11-06', repeat('b', 32), array[store_a1], false, 'failed' from fx $$, '42501', null, 'owner cannot write digests');
select throws_ok($$ insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, notify_on_resolve, store_scoped, sort_order) values ('browser_rule', 'business', 'digest', true, 'info', '{owner}', '{}', '{}', '0', false, false, 999) $$, '42501', null, 'owner cannot write the catalogue');
select throws_ok($$ update public.outbound_messages set status = 'cancelled' $$, '42501', null, 'owner cannot update outbound messages');

update public.consent_records set revoked_at = now() where subject_id = (select owner_a from fx) and purpose = 'notifications';
select ok(pg_temp.notifications_active((select owner_a from fx)), 'not even the owner revokes a notifications consent from the browser');

select pg_temp.act_as((select manager_a from fx));
select throws_ok($$ insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a1, 'sync_stale', false from fx $$, '42501', null, 'unlimited manager cannot switch a rule off for a store');
update public.alert_rules set params = '{"ratio": 0.2}' where tenant_id = (select tenant_a from fx) and store_id is null and rule_key = 'revenue_below_baseline';
select is(pg_temp.rule_value(null, 'ratio'), '0.65', 'unlimited manager cannot change a threshold');
update public.alert_rules set roles = '{manager}' where tenant_id = (select tenant_a from fx) and store_id is null and rule_key = 'revenue_below_baseline';
select is((select roles from public.alert_rules where tenant_id = (select tenant_a from fx) and store_id is null and rule_key = 'revenue_below_baseline'), null::public.tenant_role[], 'unlimited manager cannot remove owner from the roles');
select throws_ok($$ insert into public.channel_policies (tenant_id, channel_kind, message_class, consent_purpose, source_note) select tenant_a, 'telegram', 'operational', 'notifications', 'manager write' from fx $$, '42501', null, 'unlimited manager cannot write a policy');
select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at) select tenant_a, 'staff', staff_a, 'notifications', 'ops-notifications-v1', 'web', now() from fx $$,
  '42501', null,
  'unlimited manager cannot insert a notifications consent'
);
update public.consent_records set revoked_at = now() where subject_id = (select owner_a from fx) and purpose = 'notifications';
select ok(pg_temp.notifications_active((select owner_a from fx)), 'unlimited manager cannot revoke the owner''s notifications consent');

select pg_temp.act_as((select store_manager_a from fx));
select throws_ok($$ insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a1, 'sync_stale', false from fx $$, '42501', null, 'store-limited manager cannot switch a rule off for the own store');
update public.alert_rules set params = '{"min_sample_days": 1}' where store_id = (select store_a1 from fx) and rule_key = 'revenue_below_baseline';
select is(pg_temp.rule_value((select store_a1 from fx), 'min_sample_days'), '6', 'store-limited manager cannot change the own store''s threshold');
update public.alert_rules set roles = '{manager}' where store_id = (select store_a1 from fx) and rule_key = 'revenue_below_baseline';
select is((select roles from public.alert_rules where store_id = (select store_a1 from fx) and rule_key = 'revenue_below_baseline'), null::public.tenant_role[], 'store-limited manager cannot remove owner from the roles');
select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at) select tenant_a, 'staff', store_manager_a, 'notifications', 'ops-notifications-v1', 'web', now() from fx $$,
  '42501', null,
  'store-limited manager cannot insert a notifications consent, not even their own'
);
update public.consent_records set revoked_at = now() where subject_id = (select owner_a from fx) and purpose = 'notifications';
select ok(pg_temp.notifications_active((select owner_a from fx)), 'store-limited manager cannot revoke the owner''s notifications consent');

reset role;

select * from finish();
rollback;
