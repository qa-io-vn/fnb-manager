begin;
select plan(58);

create temp table fx as
select
  '44444444-4444-4444-8444-000000000001'::uuid as tenant_a,
  '55555555-5555-4555-8555-000000000001'::uuid as owner_a,
  '55555555-5555-4555-8555-000000000002'::uuid as manager_a,
  '66666666-6666-4666-8666-000000000001'::uuid as account_a,
  '77777777-7777-4777-8777-000000000001'::uuid as store_a1;

insert into auth.users (id, instance_id, aud, role, email)
select owner_a, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-owner-a@example.com' from fx
union all
select manager_a, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-manager-a@example.com' from fx;

insert into public.tenants (id, slug, name, timezone)
select tenant_a, 'notify-it-pgtap-a', 'Notify pgTAP A', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_a, manager_a, 'manager'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'notify-pgtap-account-a', 'Synthetic account A' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'notify-pgtap-store-a1', 'Synthetic store A1' from fx;

select app.ensure_notifications_consent(tenant_a, owner_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, address_hint, secret_name, config, timezone, status, enabled, muted_rules, linked_at, disabled_reason)
select v.id::uuid, fx.tenant_a, v.kind::public.channel_kind, v.provider, v.label, case when v.member = 'owner' then fx.owner_a when v.member = 'manager' then fx.manager_a end,
       v.address, null, v.secret_name, v.config::jsonb, v.timezone, v.status, v.enabled, v.muted::text[], case when v.status <> 'pending' then '2026-11-01 00:00+00'::timestamptz end, v.disabled_reason
from fx
cross join (
  values
    ('88888888-8888-4888-8888-000000000001', 'zalo_bot', 'zalo_bot', 'A4', 'owner', 'synthetic-chat-1', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000002', 'zalo_bot', 'zalo_bot', 'decisions', 'owner', 'synthetic-chat-2', 'NOTIFY_ZALO_BOT_TOKEN_IT2', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000003', 'zalo_bot', 'zalo_bot', 'disabled', 'owner', 'synthetic-chat-3', 'NOTIFY_ZALO_BOT_TOKEN_IT3', '{}', null, 'disabled', true, '{}', 'owner_request'),
    ('88888888-8888-4888-8888-000000000004', 'zalo_bot', 'zalo_bot', 'switched off', 'owner', 'synthetic-chat-4', 'NOTIFY_ZALO_BOT_TOKEN_IT4', '{}', null, 'active', false, '{}', null),
    ('88888888-8888-4888-8888-000000000005', 'zalo_bot', 'zalo_bot', 'pending', 'owner', null, 'NOTIFY_ZALO_BOT_TOKEN_IT5', '{}', null, 'pending', true, '{}', null),
    ('88888888-8888-4888-8888-000000000006', 'zalo_oa', 'zalo_oa', 'oa', 'owner', 'synthetic-oa-user', 'NOTIFY_ZALO_OA_IT', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000007', 'telegram', 'telegram', 'telegram', 'owner', 'synthetic-chat-7', 'NOTIFY_TELEGRAM_BOT_TOKEN_IT', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000008', 'email', 'brevo', 'email', 'owner', null, 'NOTIFY_EMAIL_API_KEY_IT', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000009', 'webhook', 'hmac_webhook', 'webhook', 'none', null, 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb/alerts"}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000010', 'zalo_bot', 'zalo_bot', 'manager', 'manager', 'synthetic-chat-10', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000011', 'zalo_bot', 'zalo_bot', 'muted', 'owner', 'synthetic-chat-11', 'NOTIFY_ZALO_BOT_TOKEN_IT6', '{}', null, 'active', true, '{daily_digest}', null),
    ('88888888-8888-4888-8888-000000000012', 'zalo_bot', 'zalo_bot', 'local day cap', 'owner', 'synthetic-chat-12', 'NOTIFY_ZALO_BOT_TOKEN_IT7', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000013', 'zalo_bot', 'zalo_bot', 'rolling cap', 'owner', 'synthetic-chat-13', 'NOTIFY_ZALO_BOT_TOKEN_IT8', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000014', 'zalo_bot', 'zalo_bot', 'monthly cap', 'owner', 'synthetic-chat-14', 'NOTIFY_ZALO_BOT_TOKEN_IT9', '{}', null, 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000015', 'zalo_bot', 'zalo_bot', 'berlin reader', 'owner', 'synthetic-chat-15', 'NOTIFY_ZALO_BOT_TOKEN_IT10', '{}', 'Europe/Berlin', 'active', true, '{}', null),
    ('88888888-8888-4888-8888-000000000016', 'zalo_bot', 'zalo_bot', 'rolling into the night', 'owner', 'synthetic-chat-16', 'NOTIFY_ZALO_BOT_TOKEN_IT11', '{}', null, 'active', true, '{}', null)
) as v (id, kind, provider, label, member, address, secret_name, config, timezone, status, enabled, muted, disabled_reason);

create function pg_temp.enqueue(p_channel_id uuid, p_kind text, p_key text, p_at timestamptz, p_severity public.alert_severity default 'warning', p_event_id uuid default null)
returns uuid
language sql
as $$
  select app.enqueue_message(c.tenant_id, c.id, p_kind, p_kind || '.v1', p_key, '{}'::jsonb, null, null, p_severity, null, null, null, p_event_id, null, p_at)
  from public.notification_channels c
  where c.id = p_channel_id;
$$;

create function pg_temp.decide(p_message_id uuid, p_at timestamptz)
returns text
language sql
as $$
  select d.decision || coalesce(':' || d.reason, '') from app.message_decision(p_message_id, p_at) d;
$$;

create function pg_temp.release_at(p_message_id uuid, p_at timestamptz)
returns timestamptz
language sql
as $$
  select d.release_at from app.message_decision(p_message_id, p_at) d;
$$;

create function pg_temp.mark(p_message_id uuid, p_status text, p_at timestamptz)
returns void
language sql
as $$
  update public.outbound_messages o
  set status = 'sending', claimed_at = p_at, lease_until = p_at + interval '2 minutes'
  where o.id = p_message_id;
  update public.outbound_messages o
  set status = p_status, sent_at = case when p_status = 'sent' then p_at end, lease_until = null
  where o.id = p_message_id;
$$;

create function pg_temp.episode(p_rule_key text, p_store_id uuid, p_state text, p_resolution text)
returns uuid
language sql
as $$
  insert into public.alert_events (tenant_id, rule_key, dedupe_key, store_id, severity, state, opened_at, last_seen_at, resolved_at, resolution, source)
  select fx.tenant_a, p_rule_key, p_rule_key || ':' || gen_random_uuid()::text, p_store_id, 'warning', p_state,
         '2026-11-08 00:00+00', '2026-11-08 00:00+00', case when p_state = 'resolved' then '2026-11-08 00:30+00'::timestamptz end, p_resolution, 'cli'
  from fx
  returning id;
$$;

select is(app.next_window_start('06:00', '24:00', 'Asia/Ho_Chi_Minh', '2026-11-08 17:30+00'), '2026-11-08 23:00+00'::timestamptz, 'Ho Chi Minh City: 00:30 local waits for 06:00 local');
select is(app.next_window_start('06:00', '24:00', 'Asia/Ho_Chi_Minh', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'::timestamptz, 'Ho Chi Minh City: an instant inside the window is returned as it is');
select is(app.next_window_start('06:00', '24:00', 'Asia/Ho_Chi_Minh', '2026-11-08 16:59:59+00'), '2026-11-08 16:59:59+00'::timestamptz, '24:00 ends the window at local midnight: 23:59:59 is inside');
select is(app.next_window_start('06:00', '24:00', 'Asia/Ho_Chi_Minh', '2026-11-08 17:00+00'), '2026-11-08 23:00+00'::timestamptz, '24:00 ends the window at local midnight: midnight itself waits for 06:00');
select is(app.next_window_start('22:00', '02:00', 'Asia/Ho_Chi_Minh', '2026-11-08 18:00+00'), '2026-11-08 18:00+00'::timestamptz, 'a window across midnight holds 01:00 local');
select is(app.next_window_start('22:00', '02:00', 'Asia/Ho_Chi_Minh', '2026-11-08 20:00+00'), '2026-11-09 15:00+00'::timestamptz, 'a window across midnight sends 03:00 local at 22:00 local');
select is(app.next_window_start('06:00', '24:00', 'Asia/Tokyo', '2026-11-08 20:00+00'), '2026-11-08 21:00+00'::timestamptz, 'Tokyo: 05:00 local waits for 06:00 local');
select is(app.next_window_start('02:30', '05:00', 'Europe/Berlin', '2026-03-29 00:00+00'), '2026-03-29 01:30+00'::timestamptz, 'Berlin: a start inside the spring gap opens at 03:30 local');
select is(app.next_window_start('02:30', '05:00', 'Europe/Berlin', '2026-10-24 23:00+00'), '2026-10-25 01:30+00'::timestamptz, 'Berlin: a start inside the autumn overlap opens at its standard-time occurrence');
select is(app.next_window_start(null, null, 'Asia/Ho_Chi_Minh', '2026-11-08 17:30+00'), '2026-11-08 17:30+00'::timestamptz, 'a null window returns p_at');

select is(
  pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:expired', '2026-11-08 03:00+00'), '2026-11-09 03:00+00'),
  'cancel:expired',
  'step 1: a message past expires_at is cancelled as expired'
);

select is(
  pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:resolved', '2026-11-08 03:00+00', 'warning', pg_temp.episode('sync_stale', null, 'resolved', 'cleared')), '2026-11-08 03:00+00'),
  'cancel:resolved_before_send',
  'step 2: an alert whose episode resolved before the send is cancelled'
);
select is(
  pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:instant', '2026-11-08 03:00+00', 'warning', pg_temp.episode('job_failed', null, 'resolved', 'instant')), '2026-11-08 03:00+00'),
  'send',
  'step 2: an instant episode does not cancel its alert'
);
select is(
  pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert_resolved', 'p27:resolved-notice', '2026-11-08 03:00+00', 'warning', pg_temp.episode('sync_stale', null, 'resolved', 'cleared')), '2026-11-08 03:00+00'),
  'send',
  'step 2: a resolution notice is sent for a resolved episode'
);

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000003', 'alert', 'p27:disabled', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:destination_inactive', 'step 3: a disabled destination cancels');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000004', 'alert', 'p27:off', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:destination_inactive', 'step 3: a destination switched off cancels');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000005', 'alert', 'p27:pending-alert', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:destination_inactive', 'step 3: a pending destination receives no alert');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000005', 'link_notice', 'p27:pending-notice', '2026-11-08 17:30+00'), '2026-11-08 17:30+00'), 'send', 'step 3: a pending destination receives its link notice, at any hour and without consent');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000005', 'link_confirmation', 'p27:pending-confirmation', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:destination_inactive', 'step 3: a pending destination receives no link confirmation');

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000006', 'alert', 'p27:oa', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:unavailable', 'step 4: a kind without an adapter cancels as unavailable');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:class', '2026-11-08 03:00+00');
update public.outbound_messages set message_class = 'transactional' where dedupe_key = 'p27:class';
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:class'), '2026-11-08 03:00+00'), 'cancel:class_not_enabled', 'step 5: a transactional message is refused in phase 12');

delete from public.channel_policies where tenant_id is null and channel_kind = 'telegram' and message_class = 'operational';
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000007', 'alert', 'p27:no-policy', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:no_policy', 'step 6: a pair without a policy fails closed');

insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, consent_purpose, source_note)
select tenant_a, 'email', 'operational', false, 'notifications', 'pgTAP override' from fx;
insert into public.channel_policies (tenant_id, channel_kind, message_class, requires_consent, api_send_allowed, source_note)
select tenant_a, 'webhook', 'operational', false, false, 'pgTAP override' from fx;
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000008', 'alert', 'p27:not-allowed', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:not_allowed', 'step 7: a tenant policy that forbids the pair cancels as not_allowed');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000009', 'alert', 'p27:manual', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:manual_only', 'step 7: a policy without API sending cancels as manual_only');
delete from public.channel_policies where tenant_id = (select tenant_a from fx);

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000010', 'alert', 'p27:no-consent', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:no_consent', 'step 8: a member without the notifications consent receives no alert');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000010', 'test', 'p27:no-consent-test', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:no_consent', 'step 8: a test message never skips consent');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000010', 'link_notice', 'p27:no-consent-notice', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'send', 'step 8: the link notice is sent before consent exists');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000009', 'alert', 'p27:webhook', '2026-11-08 17:30+00'), '2026-11-08 17:30+00'), 'send', 'step 8: a webhook needs no consent and has no window');

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000011', 'digest', 'p27:muted-digest', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'cancel:unsubscribed', 'step 9: a digest to a destination muting daily_digest is cancelled');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000011', 'alert', 'p27:muted-other', '2026-11-08 03:00+00', 'warning', pg_temp.episode('sync_stale', null, 'open', null)), '2026-11-08 03:00+00'), 'send', 'step 9: muting the digest leaves alerts on');
insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_a, 'sync_stale', false from fx;
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:rule-off', '2026-11-08 03:00+00', 'warning', pg_temp.episode('sync_stale', null, 'open', null)), '2026-11-08 03:00+00'), 'cancel:unsubscribed', 'step 9: a rule the tenant switched off cancels its alert');
insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a1, 'sync_stale', true from fx;
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:rule-store-on', '2026-11-08 03:00+00', 'warning', pg_temp.episode('sync_stale', (select store_a1 from fx), 'open', null)), '2026-11-08 03:00+00'), 'send', 'step 9: a store row switching the rule back on wins over the tenant row');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:no-episode', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'send', 'step 9: an alert without an episode has no rule to check');
delete from public.alert_rules where tenant_id = (select tenant_a from fx);

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'test', 'p27:test-night', '2026-11-08 17:30+00'), '2026-11-08 17:30+00'), 'send', 'step 10: a test message ignores the window');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:night', '2026-11-08 17:30+00');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:night'), '2026-11-08 17:30+00'), 'hold:outside_hours', 'step 11: an alert at 00:30 local is held');
select is(pg_temp.release_at((select id from public.outbound_messages where dedupe_key = 'p27:night'), '2026-11-08 17:30+00'), '2026-11-08 23:00+00'::timestamptz, 'step 11: it is released at 06:00 local');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000015', 'alert', 'p27:berlin', '2026-11-08 04:00+00');
select is(pg_temp.release_at((select id from public.outbound_messages where dedupe_key = 'p27:berlin'), '2026-11-08 04:00+00'), '2026-11-08 05:00+00'::timestamptz, 'step 11: the window is the reader''s, so a Berlin destination opens at 06:00 Berlin time');

insert into public.channel_policies (tenant_id, channel_kind, message_class, window_start, window_end, max_per_day, cap_window, consent_purpose, source_note)
select tenant_a, 'zalo_bot', 'operational', '06:00', '24:00', 2, 'local_day', 'notifications', 'pgTAP cap' from fx;
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:cap-yesterday', '2026-11-07 15:00+00'), 'sent', '2026-11-07 15:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'digest', 'p27:cap-today-1', '2026-11-08 01:00+00'), 'sent', '2026-11-08 01:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'test', 'p27:cap-test', '2026-11-08 01:30+00'), 'sent', '2026-11-08 01:30+00');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:cap-under', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'send', 'step 12: yesterday''s message and test messages do not count toward today''s cap');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:cap-today-2', '2026-11-08 02:00+00'), 'uncertain', '2026-11-08 02:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:cap-over', '2026-11-08 03:00+00');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:cap-over'), '2026-11-08 03:00+00'), 'hold:daily_cap', 'step 12: the cap per local day holds the third message (an uncertain one counts)');
select is(pg_temp.release_at((select id from public.outbound_messages where dedupe_key = 'p27:cap-over'), '2026-11-08 03:00+00'), '2026-11-08 23:00+00'::timestamptz, 'step 12: released at the window opening after the next local midnight');
update public.channel_policies set critical_bypass = true where tenant_id = (select tenant_a from fx);
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:cap-critical', '2026-11-08 03:00+00', 'critical'), '2026-11-08 03:00+00'), 'send', 'critical_bypass: a critical alert passes the daily cap');
select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'p27:night-critical', '2026-11-08 17:30+00', 'critical'), '2026-11-08 17:30+00'), 'send', 'critical_bypass: a critical alert passes the window');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:cap-over'), '2026-11-08 03:00+00'), 'hold:daily_cap', 'critical_bypass: a warning stays held');

update public.channel_policies set critical_bypass = false, cap_window = 'rolling_24h' where tenant_id = (select tenant_a from fx);
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'alert', 'p27:roll-1', '2026-11-07 07:00+00'), 'sent', '2026-11-07 07:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'alert', 'p27:roll-2', '2026-11-07 17:00+00'), 'sent', '2026-11-07 17:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'alert', 'p27:roll-over', '2026-11-08 03:00+00');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:roll-over'), '2026-11-08 03:00+00'), 'hold:daily_cap', 'step 12: the rolling 24-hour cap holds a message after two in the last 24 hours');
select is(pg_temp.release_at((select id from public.outbound_messages where dedupe_key = 'p27:roll-over'), '2026-11-08 03:00+00'), '2026-11-08 07:00+00'::timestamptz, 'step 12: released when the oldest counted message is 24 hours old');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:roll-over'), '2026-11-08 07:00+00'), 'send', 'step 12: at that instant the rolling cap has room again');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000016', 'alert', 'p27:roll-night-1', '2026-11-07 18:00+00', 'critical'), 'sent', '2026-11-07 18:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000016', 'alert', 'p27:roll-night-2', '2026-11-07 19:00+00', 'critical'), 'sent', '2026-11-07 19:00+00');
select is(pg_temp.release_at(pg_temp.enqueue('88888888-8888-4888-8888-000000000016', 'alert', 'p27:roll-night-over', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), '2026-11-08 23:00+00'::timestamptz, 'step 12: a rolling release inside the quiet hours moves to the window opening');

update public.channel_policies set max_per_day = null, cap_window = 'local_day', max_per_month = 2 where tenant_id = (select tenant_a from fx);
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000014', 'alert', 'p27:month-october', '2026-10-31 03:00+00'), 'sent', '2026-10-31 03:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000014', 'alert', 'p27:month-1', '2026-11-02 03:00+00'), 'sent', '2026-11-02 03:00+00');
select pg_temp.mark(pg_temp.enqueue('88888888-8888-4888-8888-000000000014', 'alert', 'p27:month-2', '2026-11-05 03:00+00'), 'sent', '2026-11-05 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000014', 'alert', 'p27:month-over', '2026-11-08 03:00+00');
select is(pg_temp.decide((select id from public.outbound_messages where dedupe_key = 'p27:month-over'), '2026-11-08 03:00+00'), 'hold:monthly_cap', 'step 13: the monthly cap holds the third message of the local month');
select is(pg_temp.release_at((select id from public.outbound_messages where dedupe_key = 'p27:month-over'), '2026-11-08 03:00+00'), '2026-11-30 23:00+00'::timestamptz, 'step 13: released at the window opening of the next local month');
delete from public.channel_policies where tenant_id = (select tenant_a from fx);

select is(pg_temp.decide(pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:plain', '2026-11-08 03:00+00'), '2026-11-08 03:00+00'), 'send', 'step 14: an alert inside the window with room under the cap is sent');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'p27:a4', '2026-11-08 17:30+00');
select is(
  (select count(*)::integer from app.claim_next_message('test', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 17:31+00', (select tenant_a from fx))),
  0,
  'A4: a claim at 00:31 local returns no message'
);
select is(
  (select row(o.status, o.not_before, o.hold_reason)::text from public.outbound_messages o where o.dedupe_key = 'p27:a4'),
  row('held', '2026-11-08 23:00+00'::timestamptz, 'outside_hours')::text,
  'A4: the alert is held until 06:00 local as outside_hours'
);
select is(
  (select count(*)::integer from app.claim_next_message('test', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 22:59:59+00', (select tenant_a from fx))),
  0,
  'A4: a claim one second before 06:00 local returns nothing'
);
select is(
  (select c.message_id from app.claim_next_message('test', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 23:00+00', (select tenant_a from fx)) c),
  (select id from public.outbound_messages where dedupe_key = 'p27:a4'),
  'A4: a claim at 06:00 local returns the alert'
);
select is((select status from public.outbound_messages where dedupe_key = 'p27:a4'), 'sending', 'A4: the claimed alert is sending');

update public.outbound_messages set status = 'cancelled', decision = 'expired'
where tenant_id = (select tenant_a from fx) and status in ('queued', 'held');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'p27:revoked-while-held', '2026-11-08 17:30+00');
select is(
  (select count(*)::integer from app.claim_next_message('test', array['NOTIFY_ZALO_BOT_TOKEN_IT2'], interval '2 minutes', '2026-11-08 17:31+00', (select tenant_a from fx))),
  0,
  'consent revoked while held: the night claim holds the alert'
);
update public.consent_records set revoked_at = '2026-11-08 20:00+00'
where subject_id = (select owner_a from fx) and purpose = 'notifications' and revoked_at is null;
select is(
  (select count(*)::integer from app.claim_next_message('test', array['NOTIFY_ZALO_BOT_TOKEN_IT2'], interval '2 minutes', '2026-11-08 23:00+00', (select tenant_a from fx))),
  0,
  'consent revoked while held: the morning claim sends nothing'
);
select is(
  (select status || ':' || decision from public.outbound_messages where dedupe_key = 'p27:revoked-while-held'),
  'cancelled:no_consent',
  'consent revoked while held: the held alert is cancelled at release as no_consent'
);

select * from finish();
rollback;
