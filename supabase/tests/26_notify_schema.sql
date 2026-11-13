begin;
select plan(178);

create temp table fx as
select
  '44444444-4444-4444-8444-000000000001'::uuid as tenant_a,
  '44444444-4444-4444-8444-000000000002'::uuid as tenant_b,
  '55555555-5555-4555-8555-000000000001'::uuid as owner_a,
  '55555555-5555-4555-8555-000000000007'::uuid as owner_b,
  '66666666-6666-4666-8666-000000000001'::uuid as account_a,
  '66666666-6666-4666-8666-000000000002'::uuid as account_b,
  '77777777-7777-4777-8777-000000000001'::uuid as store_a1,
  '77777777-7777-4777-8777-000000000002'::uuid as store_b1,
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id;

insert into auth.users (id, instance_id, aud, role, email)
select owner_a, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-owner-a@example.com' from fx
union all
select owner_b, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-owner-b@example.com' from fx;

insert into public.tenants (id, slug, name)
select tenant_a, 'notify-it-pgtap-a', 'Notify pgTAP A' from fx
union all
select tenant_b, 'notify-it-pgtap-b', 'Notify pgTAP B' from fx;

insert into public.tenant_members (tenant_id, user_id, role)
select tenant_a, owner_a, 'owner'::public.tenant_role from fx
union all
select tenant_b, owner_b, 'owner'::public.tenant_role from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'notify-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'notify-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'notify-pgtap-store-a1', 'Synthetic store A1' from fx
union all
select store_b1, tenant_b, account_b, 'notify-pgtap-store-b1', 'Synthetic store B1' from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
select v.id::uuid, fx.tenant_a, 'zalo_bot', 'zalo_bot', v.label, fx.owner_a, v.address, v.secret_name, 'active', '2026-11-01 00:00+00'::timestamptz
from fx
cross join (
  values
    ('88888888-8888-4888-8888-000000000001', 'transitions', 'synthetic-chat-1', 'NOTIFY_ZALO_BOT_TOKEN_IT'),
    ('88888888-8888-4888-8888-000000000002', 'deleted with waiting messages', 'synthetic-chat-2', 'NOTIFY_ZALO_BOT_TOKEN_IT2'),
    ('88888888-8888-4888-8888-000000000003', 'deleted after an episode', 'synthetic-chat-3', 'NOTIFY_ZALO_BOT_TOKEN_IT3')
) as v (id, label, address, secret_name);

grant select on fx to authenticated, service_role;

create function pg_temp.enqueue(p_channel_id uuid, p_key text)
returns uuid
language sql
as $$
  select app.enqueue_message(c.tenant_id, c.id, 'alert', 'alert.sync_stale.v1', p_key, '{"minutes_without_sync": 95}'::jsonb, 'title', 'body', 'warning', null, null, null, null, null, '2026-11-08 03:00+00')
  from public.notification_channels c
  where c.id = p_channel_id;
$$;

create function pg_temp.id_of(p_key text)
returns uuid
language sql
as $$
  select o.id from public.outbound_messages o where o.dedupe_key = p_key;
$$;

create function pg_temp.ad_policy(p_overrides jsonb)
returns void
language sql
as $$
  insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, max_per_month, critical_bypass, label, label_position, opt_out_text, sender_info_required, consent_purpose, requires_consent, api_send_allowed, source_note)
  select r.tenant_id, r.channel_kind, r.message_class, r.allowed, r.window_start, r.window_end, r.max_per_day, r.cap_window, r.max_per_month, r.critical_bypass, r.label, r.label_position, r.opt_out_text, r.sender_info_required, r.consent_purpose, r.requires_consent, r.api_send_allowed, r.source_note
  from jsonb_populate_record(
    null::public.channel_policies,
    jsonb_build_object(
      'tenant_id', (select tenant_a from fx),
      'channel_kind', 'email',
      'message_class', 'advertising',
      'allowed', true,
      'window_start', '07:00',
      'window_end', '22:00',
      'max_per_day', 3,
      'cap_window', 'rolling_24h',
      'critical_bypass', false,
      'label', '[QC]',
      'label_position', 'subject',
      'opt_out_text', 'Từ chối nhận quảng cáo: bấm Hủy đăng ký, trả lời TU CHOI, hoặc gọi {hotline}.',
      'sender_info_required', true,
      'consent_purpose', 'marketing',
      'requires_consent', true,
      'api_send_allowed', true,
      'source_note', 'pgTAP floor case'
    ) || p_overrides
  ) as r;
$$;

create function pg_temp.member_policy(p_overrides jsonb)
returns void
language sql
as $$
  insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, consent_purpose, requires_consent, source_note)
  select r.tenant_id, r.channel_kind, r.message_class, r.allowed, r.window_start, r.window_end, r.max_per_day, r.consent_purpose, r.requires_consent, r.source_note
  from jsonb_populate_record(
    null::public.channel_policies,
    jsonb_build_object(
      'tenant_id', (select tenant_a from fx),
      'channel_kind', 'zalo_bot',
      'message_class', 'operational',
      'allowed', true,
      'window_start', '06:00',
      'window_end', '24:00',
      'max_per_day', 20,
      'consent_purpose', 'notifications',
      'requires_consent', true,
      'source_note', 'pgTAP consent floor case'
    ) || p_overrides
  ) as r;
$$;

select has_enum('public', 'channel_kind', 'channel_kind enum exists');
select enum_has_labels('public', 'channel_kind', array['zalo_bot', 'email', 'telegram', 'webhook', 'zalo_oa', 'zalo_gmf', 'zalo_zbs', 'mini_app', 'sms'], 'channel_kind labels');
select has_enum('public', 'message_class', 'message_class enum exists');
select enum_has_labels('public', 'message_class', array['operational', 'transactional', 'advertising'], 'message_class labels');
select has_enum('public', 'alert_severity', 'alert_severity enum exists');
select enum_has_labels('public', 'alert_severity', array['info', 'warning', 'critical'], 'alert_severity labels');
select enum_has_labels('public', 'consent_purpose', array['loyalty', 'marketing', 'staff_ops', 'notifications'], 'consent_purpose gains notifications');

select has_table('public', 'alert_rule_catalog', 'alert_rule_catalog exists');
select has_table('public', 'alert_rules', 'alert_rules exists');
select has_table('public', 'channel_policies', 'channel_policies exists');
select has_table('public', 'notification_channels', 'notification_channels exists');
select has_table('public', 'alert_events', 'alert_events exists');
select has_table('public', 'digests', 'digests exists');
select has_table('app', 'notification_link_codes', 'app.notification_link_codes exists');
select has_table('app', 'bot_poll_state', 'app.bot_poll_state exists');
select has_table('app', 'notify_settings', 'app.notify_settings exists');
select has_table('app', 'notify_tickets', 'app.notify_tickets exists');
select is((select count(*)::integer from app.notify_settings), 1, 'app.notify_settings holds its single row');
select is((select enabled from app.notify_settings), false, 'the notify schedule starts disabled');

select col_is_null('public', 'outbound_messages', 'sent_at', 'outbound_messages.sent_at allows null');
select col_hasnt_default('public', 'outbound_messages', 'sent_at', 'outbound_messages.sent_at has no default');
select columns_are('public', 'outbound_messages', array[
  'id', 'tenant_id', 'channel', 'recipient_ref', 'subject_type', 'subject_id', 'purpose', 'template_ref', 'consent_record_id', 'sent_at', 'status',
  'provider_message_id', 'cost_amount', 'raw', 'created_at', 'kind', 'message_class', 'channel_id', 'store_id', 'digest_id', 'alert_event_id',
  'business_date', 'severity', 'dedupe_key', 'params', 'title', 'body', 'body_sha256', 'decision', 'hold_reason', 'not_before', 'expires_at',
  'attempts', 'claimed_at', 'lease_until', 'send_started_at', 'last_error_code', 'resend_of'
], 'outbound_messages holds the phase 2 columns and the queue columns');
select col_type_is('public', 'notification_channels', 'kind', 'channel_kind', 'notification_channels.kind uses the enum');
select col_type_is('public', 'channel_policies', 'window_start', 'time without time zone', 'channel_policies.window_start is a time');
select col_type_is('public', 'outbound_messages', 'message_class', 'message_class', 'outbound_messages.message_class uses the enum');
select col_type_is('public', 'alert_events', 'severity', 'alert_severity', 'alert_events.severity uses the enum');
select col_is_unique('public', 'digests', array['tenant_id', 'business_date', 'scope_key'], 'one digest per tenant, business date and scope');
select fk_ok('public', 'notification_channels', array['tenant_id', 'user_id'], 'public', 'tenant_members', array['tenant_id', 'user_id'], 'a destination belongs to a member of its tenant');
select fk_ok('public', 'outbound_messages', array['tenant_id', 'channel_id'], 'public', 'notification_channels', array['tenant_id', 'id'], 'a message points at a destination of its tenant');
select fk_ok('public', 'outbound_messages', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'a message points at a store of its tenant');
select fk_ok('public', 'outbound_messages', array['tenant_id', 'digest_id'], 'public', 'digests', array['tenant_id', 'id'], 'a message points at a digest of its tenant');
select fk_ok('public', 'alert_events', array['tenant_id', 'channel_id'], 'public', 'notification_channels', array['tenant_id', 'id'], 'an episode points at a destination of its tenant');
select fk_ok('public', 'alert_rules', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'a store override points at a store of its tenant');
select has_index('public', 'outbound_messages', 'outbound_messages_dedupe_key', 'the dedupe key is unique per tenant');
select has_index('public', 'alert_events', 'alert_events_one_open_key', 'one open episode per dedupe key');
select has_index('public', 'notification_channels', 'notification_channels_member_kind_key', 'one destination per member, kind and secret name');
select has_trigger('public', 'outbound_messages', 'outbound_messages_guard', 'the outbox state machine has its guard');
select has_trigger('public', 'notification_channels', 'notification_channels_cancel_open_messages', 'deleting a destination cancels its waiting messages');
select has_trigger('public', 'tenant_members', 'tenant_members_redact_notifications', 'removing a member redacts their messages');

select ok(app.notify_secret_name_valid('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN'), 'the default Zalo Bot secret name is valid');
select ok(app.notify_secret_name_valid('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_2'), 'a suffixed Zalo Bot secret name is valid');
select ok(app.notify_secret_name_valid('email', 'NOTIFY_EMAIL_API_KEY'), 'the e-mail key name is valid');
select ok(app.notify_secret_name_valid('telegram', 'NOTIFY_TELEGRAM_BOT_TOKEN_IT'), 'a Telegram secret name is valid');
select ok(app.notify_secret_name_valid('webhook', 'NOTIFY_WEBHOOK_SECRET'), 'the webhook secret name is valid');
select ok(app.notify_secret_name_valid('zalo_oa', 'NOTIFY_ZALO_OA_TOKEN'), 'a kind without its own prefix takes any NOTIFY_ name');
select ok(not app.notify_secret_name_valid('zalo_bot', 'NOTIFY_EMAIL_API_KEY'), 'another kind''s secret name is refused');
select ok(not app.notify_secret_name_valid('email', 'POS_ACCOUNTS_JSON'), 'POS_ACCOUNTS_JSON is refused');
select ok(not app.notify_secret_name_valid('telegram', 'SUPABASE_DB_URL'), 'SUPABASE_DB_URL is refused');
select ok(not app.notify_secret_name_valid('zalo_oa', 'POS_ACCOUNTS_JSON'), 'a name without the NOTIFY_ prefix is refused for every kind');
select ok(not app.notify_secret_name_valid('zalo_bot', 'notify_zalo_bot_token'), 'a lower-case name is refused');
select ok(not app.notify_secret_name_valid('zalo_bot', null), 'a null name is refused');

select ok(app.facts_are_count_only('{"minutes_without_sync": 95, "stage": "connect", "store_id": "77777777-7777-4777-8777-000000000001", "business_date": "2026-11-07", "at": "22:35", "ok": true, "none": null}'::jsonb), 'numbers, booleans, nulls and short tokens are count-only');
select ok(app.facts_are_count_only(null), 'null facts are count-only');
select ok(not app.facts_are_count_only('{"error": "Connection refused"}'::jsonb), 'an error text is refused');
select ok(not app.facts_are_count_only('{"email": "owner@example.com"}'::jsonb), 'an e-mail address is refused');
select ok(not app.facts_are_count_only('{"url": "https://hooks.example.com/x"}'::jsonb), 'a URL is refused');
select ok(not app.facts_are_count_only('{"store": "Synthetic store A1"}'::jsonb), 'a name is refused');
select ok(not app.facts_are_count_only('{"nested": {"a": 1}}'::jsonb), 'a nested object is refused');
select ok(not app.facts_are_count_only('{"list": [1, 2]}'::jsonb), 'an array value is refused');
select ok(not app.facts_are_count_only('[1, 2]'::jsonb), 'a top-level array is refused');
select ok(not app.facts_are_count_only('{"BadKey": 1}'::jsonb), 'a key that is not snake_case is refused');
select ok(not app.facts_are_count_only((select jsonb_object_agg('k' || n, n) from generate_series(1, 25) as n)), 'more than 24 keys are refused');

select ok(app.alert_rule_params_valid('daily_digest', '{"deadline_local": "07:15", "corrections": false}'::jsonb), 'a time and a boolean of the schema are accepted');
select ok(not app.alert_rule_params_valid('daily_digest', '{"deadline_local": "7am"}'::jsonb), 'a malformed time is refused');
select ok(not app.alert_rule_params_valid('revenue_below_baseline', '{"ratio": 1.5}'::jsonb), 'a number above its maximum is refused');
select ok(app.alert_rule_params_valid('revenue_below_baseline', '{"ratio": 0.6, "min_sample_days": 6}'::jsonb), 'numbers inside their ranges are accepted');
select ok(not app.alert_rule_params_valid('revenue_below_baseline', '{"min_sample_days": 4.5}'::jsonb), 'an integer parameter refuses a fraction');
select ok(not app.alert_rule_params_valid('ticket_drop', '{"reference": "last_year"}'::jsonb), 'an enum refuses a value outside its list');
select ok(app.alert_rule_params_valid('ticket_drop', '{"reference": "previous"}'::jsonb), 'an enum accepts a listed value');
select ok(not app.alert_rule_params_valid('daily_digest', '{"corrections": "yes"}'::jsonb), 'a boolean parameter refuses a string');
select ok(not app.alert_rule_params_valid('sync_stale', '{"threshold": 120}'::jsonb), 'an unknown parameter is refused');
select ok(not app.alert_rule_params_valid('not_a_rule', '{}'::jsonb), 'an unknown rule is refused');

select is((select count(*)::integer from public.alert_rule_catalog), 15, 'the catalogue holds the 15 rules');
select is(
  (select array_agg(rule_key order by sort_order) from public.alert_rule_catalog),
  array['daily_digest', 'revenue_below_baseline', 'ticket_drop', 'drawer_variance', 'unverified_day', 'zero_sales_day', 'zero_sales_open', 'sync_failed', 'auth_failed', 'sync_stale', 'sync_dispatch_failed', 'nightly_missing', 'job_failed', 'channel_failed', 'digest_failed'],
  'the catalogue rules in their order'
);
select ok((select bool_and(app.alert_rule_params_valid(rule_key, default_params)) from public.alert_rule_catalog), 'every catalogue default passes its own parameter schema');
select is(
  (select row(default_cooldown, remind_every, notify_on_resolve, store_scoped, default_severity::text)::text from public.alert_rule_catalog where rule_key = 'sync_stale'),
  row(interval '2 hours', interval '24 hours', true, true, 'critical')::text,
  'sync_stale cools down for 2 hours, reminds every 24 hours and announces its resolution'
);
select is((select count(*)::integer from public.alert_rule_catalog where delivery = 'digest'), 6, 'six rules are digest lines');

select is((select count(*)::integer from public.channel_policies where tenant_id is null), 27, 'the 27 global policies are seeded');
select is((select count(distinct (channel_kind, message_class))::integer from public.channel_policies where tenant_id is null), 27, 'one global policy per channel kind and message class');
select is(
  (select row(allowed, window_start, window_end, max_per_day, cap_window, consent_purpose::text, requires_consent)::text from public.channel_policies where tenant_id is null and channel_kind = 'zalo_bot' and message_class = 'operational'),
  row(true, time '06:00', time '24:00', 20::smallint, 'local_day', 'notifications', true)::text,
  'internal messages default to 06:00–24:00 and 20 a local day under the notifications consent'
);
select is(
  (select count(*)::integer from public.channel_policies where tenant_id is null and message_class <> 'operational' and channel_kind in ('zalo_bot', 'telegram', 'webhook', 'zalo_gmf') and allowed),
  0,
  'internal channels refuse customer messages'
);

select throws_ok($$ select pg_temp.ad_policy('{"window_start": "06:00"}') $$, '23514', null, 'floor as postgres: an advertising window opening at 06:00 is refused');
select throws_ok($$ select pg_temp.ad_policy('{"window_start": null, "window_end": null}') $$, '23514', null, 'floor as postgres: an advertising policy without a window is refused');
select throws_ok($$ select pg_temp.ad_policy('{"max_per_day": 4}') $$, '23514', null, 'floor as postgres: four advertising e-mails a day are refused');
select throws_ok($$ select pg_temp.ad_policy('{"cap_window": "local_day"}') $$, '23514', null, 'floor as postgres: an advertising cap per local day instead of 24 hours is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label": null, "label_position": null, "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo."}') $$, '23514', null, 'floor as postgres: advertising without a label is refused');
select throws_ok($$ select pg_temp.ad_policy('{"opt_out_text": null}') $$, '23514', null, 'floor as postgres: advertising without an opt-out text is refused');
select throws_ok($$ select pg_temp.ad_policy('{"critical_bypass": true}') $$, '23514', null, 'floor as postgres: advertising with critical_bypass is refused');
select throws_ok($$ select pg_temp.ad_policy('{"label_position": "text"}') $$, '23514', null, 'floor as postgres: advertising e-mail without the label in the subject is refused');
select throws_ok($$ select pg_temp.ad_policy('{"sender_info_required": false}') $$, '23514', null, 'floor as postgres: advertising e-mail without sender information is refused');
select throws_ok($$ select pg_temp.ad_policy('{"opt_out_text": "Từ chối nhận quảng cáo bằng cách bấm Hủy đăng ký."}') $$, '23514', null, 'floor as postgres: advertising e-mail without the {hotline} refusal is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "zalo_bot", "label_position": "text", "sender_info_required": false}') $$, '23514', null, 'floor as postgres: advertising allowed on the Zalo Bot is refused');
select lives_ok($$ select pg_temp.ad_policy('{"max_per_day": 2, "window_start": "08:00", "window_end": "21:00"}') $$, 'floor as postgres: a lawful tightening is accepted');
select throws_ok($$ select pg_temp.member_policy('{"requires_consent": false, "consent_purpose": null}') $$, '23514', null, 'consent floor as postgres: a Zalo Bot policy without the consent check is refused');
select throws_ok($$ select pg_temp.member_policy('{"channel_kind": "email", "requires_consent": false}') $$, '23514', null, 'consent floor as postgres: an e-mail policy that keeps the purpose but skips the check is refused');
select lives_ok($$ select pg_temp.member_policy('{"tenant_id": "44444444-4444-4444-8444-000000000002", "allowed": false, "requires_consent": false, "consent_purpose": null}') $$, 'consent floor as postgres: switching a member channel off needs no consent');
select lives_ok($$ select pg_temp.member_policy('{"tenant_id": "44444444-4444-4444-8444-000000000002", "channel_kind": "webhook", "requires_consent": false, "consent_purpose": null}') $$, 'consent floor as postgres: a webhook, which has no member, needs no consent');

set local role service_role;
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "window_start": "06:00"}') $$, '23514', null, 'floor as service_role: an advertising window opening at 06:00 is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "window_start": null, "window_end": null}') $$, '23514', null, 'floor as service_role: an advertising policy without a window is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "max_per_day": 4}') $$, '23514', null, 'floor as service_role: four advertising messages a day are refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "cap_window": "local_day"}') $$, '23514', null, 'floor as service_role: an advertising cap per local day is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label": null, "label_position": null, "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo."}') $$, '23514', null, 'floor as service_role: advertising without a label is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": null}') $$, '23514', null, 'floor as service_role: advertising without an opt-out text is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "critical_bypass": true}') $$, '23514', null, 'floor as service_role: advertising with critical_bypass is refused');
select throws_ok($$ select pg_temp.ad_policy('{"label_position": "text"}') $$, '23514', null, 'floor as service_role: advertising e-mail without the label in the subject is refused');
select throws_ok($$ select pg_temp.ad_policy('{"sender_info_required": false}') $$, '23514', null, 'floor as service_role: advertising e-mail without sender information is refused');
select throws_ok($$ select pg_temp.ad_policy('{"opt_out_text": "Từ chối nhận quảng cáo bằng cách bấm Hủy đăng ký."}') $$, '23514', null, 'floor as service_role: advertising e-mail without the {hotline} refusal is refused');
select throws_ok($$ select pg_temp.ad_policy('{"channel_kind": "zalo_bot", "label_position": "text", "sender_info_required": false}') $$, '23514', null, 'floor as service_role: advertising allowed on the Zalo Bot is refused');
select lives_ok($$ select pg_temp.ad_policy('{"channel_kind": "sms", "label_position": "text", "sender_info_required": false, "opt_out_text": "Soạn TC gửi tổng đài để từ chối nhận quảng cáo.", "max_per_day": 1}') $$, 'floor as service_role: a lawful tightening is accepted');
select throws_ok(
  $$ insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, consent_purpose, source_note) select tenant_a, 'telegram', 'transactional', true, 'loyalty', 'pgTAP' from fx $$,
  '23514', null,
  'as service_role: customer messages on an internal channel are refused'
);
select throws_ok($$ select pg_temp.member_policy('{"channel_kind": "telegram", "requires_consent": false, "consent_purpose": null}') $$, '23514', null, 'consent floor as service_role: a Telegram policy without the consent check is refused');
select throws_ok($$ select pg_temp.member_policy('{"channel_kind": "mini_app", "requires_consent": false, "consent_purpose": null}') $$, '23514', null, 'consent floor as service_role: every kind whose destination has a member is covered, not only the built adapters');
reset role;

select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://user:pw@example.com/fnb"}', 'active', now() from fx $$,
  '23514', null, 'a webhook URL with user information is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb?key=1"}', 'active', now() from fx $$,
  '23514', null, 'a webhook URL with a query string is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb#part"}', 'active', now() from fx $$,
  '23514', null, 'a webhook URL with a fragment is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "http://hooks.example.com/fnb"}', 'active', now() from fx $$,
  '23514', null, 'a plain-http webhook URL is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', 'active', now() from fx $$,
  '23514', null, 'a webhook without a URL is refused'
);
select lives_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at) select tenant_a, 'webhook', 'hmac_webhook', 'hook', 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb/alerts"}', 'active', now() from fx $$,
  'a plain https webhook URL is accepted'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name) select tenant_a, 'zalo_bot', 'zalo_bot', 'wrong secret', owner_a, 'POS_ACCOUNTS_JSON' from fx $$,
  '23514', null, 'a destination naming a non-NOTIFY secret is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name) select tenant_a, 'zalo_bot', 'zalo_bot', 'other tenant member', owner_b, 'NOTIFY_ZALO_BOT_TOKEN_IT4' from fx $$,
  '23503', null, 'a destination for a member of another tenant is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status, linked_at) select tenant_a, 'zalo_bot', 'zalo_bot', 'no chat', owner_a, 'NOTIFY_ZALO_BOT_TOKEN_IT4', 'active', now() from fx $$,
  '23514', null, 'an active bot destination needs a chat id'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status) select tenant_a, 'email', 'brevo', 'never linked', owner_a, 'NOTIFY_EMAIL_API_KEY_IT', 'active' from fx $$,
  '23514', null, 'an active destination needs linked_at'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status, linked_at) select tenant_a, 'email', 'brevo', 'no reason', owner_a, 'NOTIFY_EMAIL_API_KEY_IT', 'disabled', now() from fx $$,
  '23514', null, 'a disabled destination needs its reason'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, timezone) select tenant_a, 'email', 'brevo', 'zone', owner_a, 'NOTIFY_EMAIL_API_KEY_IT', 'Mars/Olympus_Mons' from fx $$,
  '22023', null, 'an unknown time zone is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, store_ids) select tenant_a, 'email', 'brevo', 'stores', owner_a, 'NOTIFY_EMAIL_API_KEY_IT', array[store_b1] from fx $$,
  '22023', null, 'a store of another tenant in store_ids is refused'
);
select throws_ok(
  $$ insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, muted_rules) select tenant_a, 'email', 'brevo', 'muted', owner_a, 'NOTIFY_EMAIL_API_KEY_IT', array['not_a_rule'] from fx $$,
  '22023', null, 'a muted rule outside the catalogue is refused'
);

select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'revenue_below_baseline', '{"ratio": 1.5}' from fx $$, '22023', null, 'a rule parameter outside its range is refused');
select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'revenue_below_baseline', '{"factor": 0.5}' from fx $$, '22023', null, 'an unknown rule parameter is refused');
select throws_ok($$ insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a1, 'auth_failed', false from fx $$, '22023', null, 'a store row for a rule that is not store scoped is refused');
select lives_ok($$ insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'revenue_below_baseline', '{"ratio": 0.6}' from fx $$, 'a tenant row inside the schema is accepted');
select lives_ok($$ insert into public.alert_rules (tenant_id, store_id, rule_key, params) select tenant_a, store_a1, 'revenue_below_baseline', '{"min_sample_days": 6}' from fx $$, 'a store row of a store-scoped rule is accepted');
select throws_ok($$ insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_a, 'revenue_below_baseline', false from fx $$, '23505', null, 'a second tenant row of the same rule is refused');
select is(
  (select row(params, source)::text from app.effective_alert_rule((select tenant_a from fx), (select store_a1 from fx), 'revenue_below_baseline')),
  row('{"ratio": 0.6, "min_sample_days": 6}'::jsonb, 'store')::text,
  'effective_alert_rule merges the store row over the tenant row over the catalogue'
);
select is(
  (select row(params, source)::text from app.effective_alert_rule((select tenant_a from fx), null, 'revenue_below_baseline')),
  row('{"ratio": 0.6, "min_sample_days": 4}'::jsonb, 'tenant')::text,
  'without a store the tenant row applies'
);
select is(
  (select row(enabled, source)::text from app.effective_alert_rule((select tenant_b from fx), null, 'revenue_below_baseline')),
  row(true, 'default')::text,
  'a tenant without overrides gets the catalogue'
);
select is((select count(*)::integer from app.effective_alert_rule((select tenant_a from fx), null, 'not_a_rule')), 0, 'an unknown rule has no effective row');
select is((select (app.effective_channel_policy((select tenant_a from fx), 'email', 'advertising')).max_per_day), 2::smallint, 'effective_channel_policy prefers the tenant row');
select is((select (app.effective_channel_policy((select tenant_b from fx), 'email', 'advertising')).max_per_day), 3::smallint, 'effective_channel_policy falls back to the global row');

select throws_ok(
  $$ insert into public.alert_events (tenant_id, rule_key, dedupe_key, severity, opened_at, last_seen_at, source, facts) select tenant_a, 'sync_failed', 'sync_failed:x', 'warning', now(), now(), 'cli', '{"error": "Connection refused by host"}' from fx $$,
  '23514', null, 'episode facts with text are refused'
);
select throws_ok(
  $$ select app.enqueue_message(tenant_a, '88888888-8888-4888-8888-000000000001', 'alert', 'alert.v1', 'g:params', '{"store": "Synthetic store A1"}', null, null, null, null, null, null, null, null, now()) from fx $$,
  '23514', null, 'message parameters with a name are refused'
);

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'g:' || n) from generate_series(1, 12) as n;

select lives_ok($$ update public.outbound_messages set status = 'held', not_before = '2026-11-08 23:00+00', hold_reason = 'outside_hours' where id = pg_temp.id_of('g:1') $$, 'queued to held');
select lives_ok($$ update public.outbound_messages set status = 'queued' where id = pg_temp.id_of('g:1') $$, 'held to queued');
select lives_ok($$ update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id = pg_temp.id_of('g:1') $$, 'queued to sending');
select lives_ok($$ update public.outbound_messages set status = 'sent', sent_at = '2026-11-08 23:01+00', lease_until = null where id = pg_temp.id_of('g:1') $$, 'sending to sent');
select lives_ok($$ update public.outbound_messages set status = 'delivered' where id = pg_temp.id_of('g:1') $$, 'sent to delivered');
update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id = pg_temp.id_of('g:2');
select lives_ok($$ update public.outbound_messages set status = 'queued', lease_until = null where id = pg_temp.id_of('g:2') $$, 'sending to queued');
select lives_ok($$ update public.outbound_messages set status = 'cancelled', decision = 'expired' where id = pg_temp.id_of('g:2') $$, 'queued to cancelled');
update public.outbound_messages set status = 'held' where id = pg_temp.id_of('g:3');
select lives_ok($$ update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id = pg_temp.id_of('g:3') $$, 'held to sending');
select lives_ok($$ update public.outbound_messages set status = 'failed', lease_until = null, last_error_code = 'bad_request' where id = pg_temp.id_of('g:3') $$, 'sending to failed');
update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id in (pg_temp.id_of('g:4'), pg_temp.id_of('g:5'), pg_temp.id_of('g:7'), pg_temp.id_of('g:9'), pg_temp.id_of('g:10'), pg_temp.id_of('g:11'));
select lives_ok($$ update public.outbound_messages set status = 'uncertain', lease_until = null where id = pg_temp.id_of('g:4') $$, 'sending to uncertain');
select lives_ok($$ update public.outbound_messages set status = 'sent', sent_at = '2026-11-08 23:05+00' where id = pg_temp.id_of('g:4') $$, 'uncertain to sent, a late success');
update public.outbound_messages set status = 'uncertain', lease_until = null where id in (pg_temp.id_of('g:5'), pg_temp.id_of('g:10'));
select lives_ok($$ update public.outbound_messages set status = 'failed' where id = pg_temp.id_of('g:5') $$, 'uncertain to failed, marked lost');
update public.outbound_messages set status = 'held' where id = pg_temp.id_of('g:6');
select lives_ok($$ update public.outbound_messages set status = 'cancelled', decision = 'no_consent' where id = pg_temp.id_of('g:6') $$, 'held to cancelled');
update public.outbound_messages set status = 'sent', sent_at = '2026-11-08 23:01+00', lease_until = null where id in (pg_temp.id_of('g:7'), pg_temp.id_of('g:9'));
select lives_ok($$ update public.outbound_messages set status = 'failed', last_error_code = 'bounced' where id = pg_temp.id_of('g:7') $$, 'sent to failed, a later receipt');

select throws_ok($$ update public.outbound_messages set status = 'sent', sent_at = now() where id = pg_temp.id_of('g:8') $$, '55000', null, 'queued cannot become sent without a claim');
select throws_ok($$ update public.outbound_messages set status = 'queued' where id = pg_temp.id_of('g:2') $$, '55000', null, 'a cancelled message stays cancelled');
select throws_ok($$ update public.outbound_messages set status = 'sent', sent_at = now() where id = pg_temp.id_of('g:3') $$, '55000', null, 'a failed message stays failed');
select throws_ok($$ update public.outbound_messages set status = 'sent' where id = pg_temp.id_of('g:1') $$, '55000', null, 'a delivered message stays delivered');
select throws_ok($$ update public.outbound_messages set status = 'queued' where id = pg_temp.id_of('g:9') $$, '55000', null, 'a sent message is never queued again');
select throws_ok($$ update public.outbound_messages set status = 'queued' where id = pg_temp.id_of('g:10') $$, '55000', null, 'an uncertain message is never retried automatically');
select throws_ok($$ update public.outbound_messages set status = 'cancelled' where id = pg_temp.id_of('g:11') $$, '55000', null, 'a message being sent is cancelled only when its destination vanished');
select throws_ok($$ update public.outbound_messages set kind = 'test' where id = pg_temp.id_of('g:12') $$, '55000', null, 'the kind of a queue row never changes');

select throws_ok($$ update public.outbound_messages set body = 'another text' where id = pg_temp.id_of('g:9') $$, '55000', null, 'the body of a sent message is frozen');
select lives_ok($$ update public.outbound_messages set title = null, body = null, params = null where id = pg_temp.id_of('g:9') $$, 'the body purge may clear title, body and parameters');
select throws_ok($$ update public.outbound_messages set recipient_ref = 'channel:elsewhere' where id = pg_temp.id_of('g:9') $$, '55000', null, 'the recipient of a sent message is frozen');
select lives_ok($$ update public.outbound_messages set recipient_ref = 'redacted', subject_id = null where id = pg_temp.id_of('g:9') $$, 'redaction may replace the recipient and clear the subject');
select throws_ok($$ update public.outbound_messages set subject_id = gen_random_uuid() where id = pg_temp.id_of('g:4') $$, '55000', null, 'the subject of a sent message cannot be replaced');
select throws_ok($$ update public.outbound_messages set decision = 'expired' where id = pg_temp.id_of('g:9') $$, '55000', null, 'the decision of a sent message is frozen');
select throws_ok($$ update public.outbound_messages set attempts = 3 where id = pg_temp.id_of('g:9') $$, '55000', null, 'the attempts of a sent message are frozen');
select throws_ok($$ update public.outbound_messages set sent_at = now() where id = pg_temp.id_of('g:9') $$, '55000', null, 'sent_at changes only with a status change');

select is(
  (select count(*)::integer from public.outbound_messages where tenant_id = (select demo_tenant_id from fx) and kind is null and status = 'delivered'),
  2,
  'the two seed rows keep kind null and status delivered, valid under the new checks'
);

select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'del:' || s) from unnest(array['queued', 'held', 'sending']) as s;
update public.outbound_messages set status = 'held' where id = pg_temp.id_of('del:held');
update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id = pg_temp.id_of('del:sending');
select lives_ok($$ delete from public.notification_channels where id = '88888888-8888-4888-8888-000000000002' $$, 'a destination with waiting and sending messages can be deleted');
select is(
  (select string_agg(dedupe_key || '=' || status || ':' || coalesce(decision, '') || ':' || coalesce(channel_id::text, 'none'), ',' order by dedupe_key) from public.outbound_messages where dedupe_key like 'del:%'),
  'del:held=cancelled:destination_removed:none,del:queued=cancelled:destination_removed:none,del:sending=sending::none',
  'its waiting messages are cancelled and the one being sent keeps sending without a destination'
);

insert into public.alert_events (tenant_id, rule_key, dedupe_key, channel_id, severity, opened_at, last_seen_at, source)
select tenant_a, 'channel_failed', 'channel_failed:channel:88888888-8888-4888-8888-000000000003', '88888888-8888-4888-8888-000000000003', 'warning', now(), now(), 'notify' from fx;
insert into public.alert_events (tenant_id, rule_key, dedupe_key, store_id, severity, opened_at, last_seen_at, source)
select tenant_a, 'sync_stale', 'sync_stale:store:' || store_a1::text, store_a1, 'critical', now(), now(), 'scheduler' from fx;
select pg_temp.enqueue('88888888-8888-4888-8888-000000000003', 'ep:channel');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'ep:store');
update public.outbound_messages set alert_event_id = (select id from public.alert_events where rule_key = 'channel_failed') where id = pg_temp.id_of('ep:channel');
update public.outbound_messages set alert_event_id = (select id from public.alert_events where rule_key = 'sync_stale') where id = pg_temp.id_of('ep:store');
update public.outbound_messages set status = 'sending', claimed_at = '2026-11-08 23:00+00', lease_until = '2026-11-08 23:02+00' where id in (pg_temp.id_of('ep:channel'), pg_temp.id_of('ep:store'));
update public.outbound_messages set status = 'sent', sent_at = '2026-11-08 23:01+00', lease_until = null where id in (pg_temp.id_of('ep:channel'), pg_temp.id_of('ep:store'));
select lives_ok($$ delete from public.notification_channels where id = '88888888-8888-4888-8888-000000000003' $$, 'a destination with a sent message of its own episode can be deleted');
select is(
  (select row(status, channel_id, alert_event_id)::text from public.outbound_messages where id = pg_temp.id_of('ep:channel')),
  row('sent', null::uuid, null::uuid)::text,
  'the sent message loses its destination and its episode and stays sent'
);
select lives_ok($$ delete from public.alert_events where rule_key = 'sync_stale' $$, 'an episode with a sent message can be deleted');
select is((select alert_event_id from public.outbound_messages where id = pg_temp.id_of('ep:store')), null::uuid, 'the sent message keeps no reference to the deleted episode');
select lives_ok(
  $$ update public.outbound_messages set recipient_ref = 'redacted', subject_id = null, title = null, body = null, params = null where id = pg_temp.id_of('ep:store') $$,
  'a sent row can be redacted'
);

select * from finish();
rollback;
