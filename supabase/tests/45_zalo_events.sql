begin;
select plan(87);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004501'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000004502'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000000004501'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000004502'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000004503'::uuid as member_a,
  'eeeeeeee-eeee-4eee-8eee-000000004504'::uuid as member_a2,
  'eeeeeeee-eeee-4eee-8eee-000000004505'::uuid as owner_b,
  'cccccccc-cccc-4ccc-8ccc-000000004501'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000004502'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000004501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000004502'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004501'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004502'::uuid as brand_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004511'::uuid as app_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004512'::uuid as app_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004521'::uuid as oa_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004522'::uuid as oa_b,
  '88888888-8888-4888-8888-000000004501'::uuid as oa_dest_a1,
  '88888888-8888-4888-8888-000000004502'::uuid as oa_dest_a2,
  '88888888-8888-4888-8888-000000004503'::uuid as oa_dest_b1,
  '88888888-8888-4888-8888-000000004504'::uuid as bot_dest_a1,
  '88888888-8888-4888-8888-000000004505'::uuid as mail_dest_a1,
  '88888888-8888-4888-8888-000000004506'::uuid as bot_dest_a2,
  repeat('a', 64) as event_1,
  repeat('b', 64) as event_2,
  repeat('c', 64) as event_3,
  repeat('d', 64) as event_4,
  repeat('e', 64) as event_5,
  repeat('f', 64) as event_6,
  repeat('1', 64) as event_7,
  repeat('2', 64) as event_8,
  repeat('9', 64) as bot_hash;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'zalo-events-owner-a@example.com'),
    (fx.manager_a, 'zalo-events-manager-a@example.com'),
    (fx.member_a, 'zalo-events-member-a@example.com'),
    (fx.member_a2, 'zalo-events-member-a2@example.com'),
    (fx.owner_b, 'zalo-events-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_a, 'zalo-it-pgtap-events-a', 'Zalo events pgTAP A', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_b, 'zalo-it-pgtap-events-b', 'Zalo events pgTAP B', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, null::uuid[]
from fx
cross join lateral (
  values (fx.owner_a, 'owner'), (fx.manager_a, 'manager'), (fx.member_a, 'manager'), (fx.member_a2, 'manager')
) as m (user_id, role)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'zalo-events-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'zalo-events-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'zalo-events-store-a1', 'Synthetic store A1' from fx
union all
select store_b1, tenant_b, account_b, 'zalo-events-store-b1', 'Synthetic store B1' from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx
union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_a, tenant_a, brand_a, 'synthetic-events-app-a', 'ZALO_APP_SECRET_BRAND_1' from fx
union all
select app_b, tenant_b, brand_b, 'synthetic-events-app-b', 'ZALO_APP_SECRET_BRAND_1' from fx;

insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-events-oa-a', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_b, tenant_b, brand_b, 'synthetic-events-oa-b', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;

update public.oas set webhook_mode = 'enforce' where id = (select oa_b from fx);

create temp table consent_ids as
select
  app.ensure_notifications_consent(tenant_a, member_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as member_a,
  app.ensure_notifications_consent(tenant_a, member_a2, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as member_a2
from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
select v.id, v.tenant_id, v.kind::public.channel_kind, v.provider, v.label, v.user_id, v.address, v.secret_name, 'active', '2026-11-01 00:00+00'::timestamptz
from fx
cross join lateral (
  values
    (fx.oa_dest_a1, fx.tenant_a, 'zalo_oa', 'zalo_oa', 'oa member', fx.member_a, 'synthetic-oa-user-1', 'NOTIFY_ZALO_OA_BRAND_1'),
    (fx.oa_dest_a2, fx.tenant_a, 'zalo_oa', 'zalo_oa', 'oa other member', fx.member_a2, 'synthetic-oa-user-2', 'NOTIFY_ZALO_OA_BRAND_1'),
    (fx.oa_dest_b1, fx.tenant_b, 'zalo_oa', 'zalo_oa', 'oa other tenant', fx.owner_b, 'synthetic-oa-user-1', 'NOTIFY_ZALO_OA_BRAND_1'),
    (fx.bot_dest_a1, fx.tenant_a, 'zalo_bot', 'zalo_bot', 'bot member', fx.member_a, 'synthetic-chat-4501', 'NOTIFY_ZALO_BOT_TOKEN_IT45'),
    (fx.mail_dest_a1, fx.tenant_a, 'email', 'resend', 'mail member', fx.member_a, null, 'NOTIFY_EMAIL_API_KEY_IT45'),
    (fx.bot_dest_a2, fx.tenant_a, 'zalo_bot', 'zalo_bot', 'bot other member', fx.member_a2, 'synthetic-chat-4502', 'NOTIFY_ZALO_BOT_TOKEN_IT45')
) as v (id, tenant_id, kind, provider, label, user_id, address, secret_name);

grant select on fx to authenticated, anon;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

select is(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'oa_events'),
  true,
  'oa_events has row level security enabled'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'oa_events'),
  0,
  'oa_events has no policy, so no API role reads a row'
);
select columns_are(
  'public', 'oa_events',
  array['id', 'tenant_id', 'oa_id', 'event_id', 'event_name', 'oa_user_id', 'occurred_at', 'received_at', 'signature', 'processed_at', 'customer_step', 'customer_step_at'],
  'oa_events holds ids, the event name, times and the customer step outcome, never message text'
);
select ok(not has_table_privilege('authenticated', 'public.oa_events', 'select'), 'authenticated cannot select oa_events');
select ok(not has_table_privilege('anon', 'public.oa_events', 'select'), 'anon cannot select oa_events');
select ok(not has_table_privilege('authenticated', 'app.oa_event_days', 'select'), 'authenticated cannot select the day counts');
select ok(not has_table_privilege('service_role', 'app.oa_event_days', 'select'), 'service_role cannot select the day counts');
select has_column('public', 'notification_channels', 'last_interaction_at', 'notification_channels.last_interaction_at exists');
select ok(not has_column_privilege('authenticated', 'public.notification_channels', 'last_interaction_at', 'select'), 'authenticated cannot select last_interaction_at');
select col_default_is('public', 'oas', 'webhook_mode', 'observe'::text, 'an OA starts in observe mode');
select throws_ok(
  $$ update public.oas set webhook_mode = 'strict' where id = (select oa_a from fx) $$,
  '23514', null, 'the webhook mode is observe or enforce'
);

select is(
  (select row(t.oa_id, t.tenant_id, t.secret_name, t.webhook_mode)::text from app.oa_webhook_target('synthetic-events-app-a', 'synthetic-events-oa-a') t),
  (select row(oa_a, tenant_a, 'ZALO_OA_SECRET_BRAND_1', 'observe')::text from fx),
  'the target names the OA, its tenant, its secret name and its mode'
);
select is(
  (select count(*)::integer from app.oa_webhook_target('synthetic-events-app-b', 'synthetic-events-oa-a')),
  0,
  'an OA id under another app matches nothing'
);

select is(
  (select row(r.outcome, r.event_row is not null, r.unverified)::text
   from app.receive_oa_event((select oa_a from fx), (select event_1 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:00+00', 'raw', '2026-11-18 03:00:01+00') r),
  row('recorded', true, null::integer)::text,
  'a verified event is recorded'
);
select is(
  (select row(r.outcome, r.event_row, r.unverified)::text
   from app.receive_oa_event((select oa_a from fx), (select event_1 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:00+00', 'raw', '2026-11-18 03:00:31+00') r),
  row('duplicate', null::uuid, null::integer)::text,
  'the same event delivered again is a duplicate'
);
select is(
  (select count(*)::integer from public.oa_events where oa_id = (select oa_a from fx) and event_id = (select event_1 from fx)),
  1,
  'a duplicate delivery stores no second row'
);
select is(
  (select row(signature, oa_user_id, occurred_at, received_at, processed_at)::text from public.oa_events where event_id = (select event_1 from fx)),
  row('raw', 'synthetic-oa-user-1', '2026-11-18 03:00+00'::timestamptz, '2026-11-18 03:00:01+00'::timestamptz, null::timestamptz)::text,
  'the row keeps which serialisation matched, the user and the times'
);
select is(
  (select row(r.outcome, r.unverified)::text
   from app.receive_oa_event((select oa_a from fx), (select event_2 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:05+00', 'mismatch', '2026-11-18 03:05:01+00') r),
  row('recorded', 1)::text,
  'observe mode records a mismatch and counts it'
);
select is(
  (select row(r.outcome, r.unverified)::text
   from app.receive_oa_event((select oa_a from fx), (select event_3 from fx), 'user_seen_message', 'synthetic-oa-user-1', '2026-11-18 03:06+00', 'missing', '2026-11-18 03:06:01+00') r),
  row('recorded', 2)::text,
  'observe mode records a missing signature and counts it with the mismatch'
);
select is(
  (select occurred_at from public.oa_events where event_id = (select event_2 from fx)),
  '2026-11-18 03:05+00'::timestamptz,
  'the event time is kept'
);
select is(
  (select row(r.outcome, r.event_row, r.unverified)::text
   from app.receive_oa_event((select oa_b from fx), (select event_4 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:00+00', 'mismatch', '2026-11-18 03:00:01+00') r),
  row('refused', null::uuid, 1)::text,
  'enforce mode refuses a mismatch and counts the refusal'
);
select is(
  (select row(r.outcome, r.unverified)::text
   from app.receive_oa_event((select oa_b from fx), (select event_4 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:00+00', 'missing', '2026-11-18 03:00:02+00') r),
  row('refused', 2)::text,
  'enforce mode refuses a missing signature'
);
select is(
  (select count(*)::integer from public.oa_events where oa_id = (select oa_b from fx)),
  0,
  'enforce mode stores nothing for a refused call'
);
select is(
  (select r.outcome from app.receive_oa_event((select oa_b from fx), (select event_5 from fx), 'follow', 'synthetic-oa-user-9', '2026-11-18 03:10+00', 'compact', '2026-11-18 03:10:01+00') r),
  'recorded',
  'enforce mode stores a verified event'
);
select is(
  (select array_agg(row(day, signature, events)::text order by signature) from app.oa_event_days where oa_id = (select oa_b from fx)),
  array[row(date '2026-11-18', 'compact', 1)::text, row(date '2026-11-18', 'refused', 2)::text],
  'the day counts hold the verified event and the refusals'
);
select is(
  (select r.outcome from app.receive_oa_event((select oa_a from fx), (select event_6 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-11-18 03:20+00', 'raw', '2026-11-18 03:19+00') r),
  'recorded',
  'an event stamped after its arrival is recorded'
);
select is(
  (select occurred_at from public.oa_events where event_id = (select event_6 from fx)),
  '2026-11-18 03:19+00'::timestamptz,
  'an event time later than the arrival is clamped to the arrival'
);
select throws_ok(
  $$ select * from app.receive_oa_event('00000000-0000-4000-8000-000000000000', repeat('a', 64), 'follow', null, null, 'raw', now()) $$,
  '22023', null, 'an unknown OA is refused'
);
select throws_ok(
  $$ select * from app.receive_oa_event((select oa_a from fx), repeat('a', 64), 'follow', null, null, 'verified', now()) $$,
  '22023', null, 'an unknown signature outcome is refused'
);
select throws_ok(
  $$ select * from app.receive_oa_event((select oa_a from fx), 'not-a-digest', 'follow', null, null, 'raw', now()) $$,
  '23514', null, 'an event id that is not a digest is refused'
);

create temp table rows_of as
select event_id, id from public.oa_events where oa_id in ((select oa_a from fx), (select oa_b from fx));

select is(app.apply_oa_event((select id from rows_of where event_id = (select event_1 from fx)), '2026-11-18 03:00:02+00'), 'interaction', 'a message is an interaction');
select is(
  (select last_interaction_at from public.notification_channels where id = (select oa_dest_a1 from fx)),
  '2026-11-18 03:00+00'::timestamptz,
  'a message moves last_interaction_at of that OA user''s destination'
);
select is(
  (select last_interaction_at from public.notification_channels where id = (select oa_dest_a2 from fx)),
  null::timestamptz,
  'another OA user''s destination does not move'
);
select is(
  (select last_interaction_at from public.notification_channels where id = (select oa_dest_b1 from fx)),
  null::timestamptz,
  'the same user id in another tenant does not move'
);
select is(app.apply_oa_event((select id from rows_of where event_id = (select event_1 from fx)), '2026-11-18 03:00:03+00'), 'already_processed', 'a follow-up runs once');
select is(app.apply_oa_event((select id from rows_of where event_id = (select event_3 from fx)), '2026-11-18 03:06:02+00'), 'ignored', 'a seen receipt is not an interaction');
select is(
  (select last_interaction_at from public.notification_channels where id = (select oa_dest_a1 from fx)),
  '2026-11-18 03:00+00'::timestamptz,
  'an unrelated event does not move last_interaction_at'
);
select is(app.apply_oa_event((select id from rows_of where event_id = (select event_6 from fx)), '2026-11-18 03:20+00'), 'interaction', 'a later message is an interaction');
select is(app.apply_oa_event((select id from rows_of where event_id = (select event_2 from fx)), '2026-11-18 03:20:01+00'), 'interaction', 'an earlier message processed late is an interaction');
select is(
  (select last_interaction_at from public.notification_channels where id = (select oa_dest_a1 from fx)),
  '2026-11-18 03:19+00'::timestamptz,
  'last_interaction_at only moves forward'
);
select ok(app.oa_event_is_interaction('follow'), 'a follow is an interaction');
select ok(app.oa_event_is_interaction('user_send_image'), 'any user_send_ event is an interaction');
select ok(not app.oa_event_is_interaction('user_received_message'), 'a delivery receipt is not an interaction');
select ok(not app.oa_event_is_interaction('oa_send_text'), 'the OA''s own message is not an interaction');

select is(
  (select r.outcome from app.receive_oa_event((select oa_a from fx), (select event_7 from fx), 'unfollow', 'synthetic-oa-user-2', '2026-11-18 18:00+00', 'raw', '2026-11-18 18:00:01+00') r),
  'recorded',
  'an unfollow is recorded'
);
select is(
  (select array_agg(day order by day) from app.oa_event_days where oa_id = (select oa_a from fx) and signature = 'raw'),
  array[date '2026-11-18', date '2026-11-19'],
  'an event at 18:00 UTC counts on the next tenant-local day'
);
select is(app.apply_oa_event((select id from public.oa_events where event_id = (select event_7 from fx)), '2026-11-18 18:00:02+00'), 'unfollow', 'an unfollow is applied');
select is(
  (select row(status, disabled_reason)::text from public.notification_channels where id = (select oa_dest_a2 from fx)),
  row('disabled', 'blocked_by_user')::text,
  'an unfollow disables that user''s destination as blocked_by_user'
);
select is(
  (select status from public.notification_channels where id = (select oa_dest_a1 from fx)),
  'active',
  'an unfollow leaves other destinations alone'
);

select is(
  (select row(category, delivery, default_enabled, default_severity::text, default_roles::text, default_params, store_scoped)::text from public.alert_rule_catalog where rule_key = 'zalo_webhook_unverified'),
  row('channel', 'immediate', true, 'warning', '{owner}', '{"max_per_day": 10}'::jsonb, false)::text,
  'zalo_webhook_unverified is an immediate warning to the owner'
);
select ok(app.alert_rule_params_valid('zalo_webhook_unverified', '{"max_per_day": 0}'::jsonb), 'max_per_day accepts 0');
select ok(not app.alert_rule_params_valid('zalo_webhook_unverified', '{"max_per_day": 1001}'::jsonb), 'max_per_day stops at 1000');
select is(app.raise_oa_webhook_alert((select oa_a from fx), 10, '2026-11-18 05:00+00'), 'not_crossed', 'ten unverified calls stay below the default threshold');
select is(app.raise_oa_webhook_alert((select oa_a from fx), 11, '2026-11-18 05:01+00'), 'opened', 'the eleventh unverified call raises the alert');
select is(app.raise_oa_webhook_alert((select oa_a from fx), 12, '2026-11-18 05:02+00'), 'not_crossed', 'later calls of the day raise nothing more');
select is(
  (select row(rule_key, dedupe_key, source, state, resolution, business_date, facts)::text from public.alert_events where tenant_id = (select tenant_a from fx)),
  (select row('zalo_webhook_unverified', 'zalo_webhook_unverified:oa:' || oa_a, 'webhook', 'resolved', 'instant', date '2026-11-18', '{"mode": "observe", "unverified": 11, "max_per_day": 10}'::jsonb)::text from fx),
  'one instant episode with count-only facts, raised from the webhook'
);
insert into public.alert_rules (tenant_id, rule_key, params) select tenant_b, 'zalo_webhook_unverified', '{"max_per_day": 1}' from fx;
select is(app.raise_oa_webhook_alert((select oa_b from fx), 2, '2026-11-18 05:00+00'), 'opened', 'the tenant''s own threshold applies');
select is(app.raise_oa_webhook_alert('00000000-0000-4000-8000-000000000000', 11, '2026-11-18 05:00+00'), 'none', 'an unknown OA raises nothing');

select lives_ok(
  $$ insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
     select tenant_a, oa_a, (select event_8 from fx), 'user_send_text', 'synthetic-oa-user-1', '2026-08-01 00:00+00', '2026-08-01 00:00+00', 'raw' from fx $$,
  'an event older than 90 days is inserted for the retention case'
);
create temp table housekeeping as select app.notify_housekeeping('2026-11-18 06:00+00', (select tenant_a from fx)) as result;
select is(((select result from housekeeping) ->> 'oa_events_deleted')::integer, 1, 'housekeeping deletes the events older than 90 days');
select is(
  (select count(*)::integer from public.oa_events where tenant_id = (select tenant_a from fx)),
  5,
  'newer events stay'
);
select is(
  (select count(*)::integer from public.oa_events where tenant_id = (select tenant_b from fx)),
  1,
  'a housekeeping run for one tenant leaves another tenant''s events'
);
select ok(
  (select sum(events) from app.oa_event_days where tenant_id = (select tenant_a from fx)) = 5,
  'the day counts stay after the events are deleted'
);

select lives_ok($$ select app.set_bot_webhook('NOTIFY_ZALO_BOT_TOKEN_IT45', (select bot_hash from fx), '2026-11-18 00:00+00') $$, 'a Zalo Bot is put in webhook mode');
select is(
  (select row(t.secret_name, t.kind::text)::text from app.bot_webhook_target((select bot_hash from fx)) t),
  row('NOTIFY_ZALO_BOT_TOKEN_IT45', 'zalo_bot')::text,
  'the secret token hash finds the bot'
);
select is((select count(*)::integer from app.bot_webhook_target(repeat('8', 64))), 0, 'another hash finds no bot');
select ok(not app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT45', 'zalo_bot', 'worker-a', interval '30 seconds', '2026-11-18 00:01+00'), 'polling is refused once the bot is in webhook mode');
select ok(app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT46', 'zalo_bot', 'worker-a', interval '30 seconds', '2026-11-18 00:01+00'), 'another bot still polls');
select throws_ok(
  $$ select app.set_bot_webhook('NOTIFY_TELEGRAM_BOT_TOKEN_IT45', repeat('9', 64), now()) $$,
  '22023', null, 'only a Zalo Bot name goes into webhook mode'
);
select throws_ok(
  $$ select app.set_bot_webhook('NOTIFY_ZALO_BOT_TOKEN_IT45', 'synthetic-plain-token', now()) $$,
  '22023', null, 'only a hash is stored, never the token'
);

select isnt(
  app.enqueue_message((select tenant_a from fx), (select bot_dest_a1 from fx), 'test', 'test.v1', 'o45:waiting', '{}'::jsonb, null, null, null, null, null, null, null, '2026-11-19 00:00+00', '2026-11-18 06:00+00'),
  null::uuid,
  'a message waits for the member'
);
select is(
  (select count(*)::integer from app.stop_bot_chat('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT45', 'synthetic-chat-9999', '2026-11-18 06:01+00')),
  0,
  'DỪNG from a chat that is not linked stops nothing'
);
select is(
  (select array_agg(s.channel_id) from app.stop_bot_chat('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT45', 'synthetic-chat-4501', '2026-11-18 06:02+00') s),
  (select array[bot_dest_a1] from fx),
  'DỪNG from the linked chat returns its destination'
);
select is(
  (select revoked_at from public.consent_records where id = (select member_a from consent_ids)),
  '2026-11-18 06:02+00'::timestamptz,
  'the member''s notifications consent is revoked'
);
select is(
  (select array_agg(row(id, status, disabled_reason)::text order by id) from public.notification_channels where user_id = (select member_a from fx) and kind in ('zalo_bot', 'email')),
  (select array[row(bot_dest_a1, 'disabled', 'consent_withdrawn')::text, row(mail_dest_a1, 'disabled', 'consent_withdrawn')::text] from fx),
  'every destination of the member is disabled as consent_withdrawn'
);
select is(
  (select row(status, decision)::text from public.outbound_messages where dedupe_key = 'o45:waiting'),
  row('cancelled', 'no_consent')::text,
  'the waiting message is cancelled, so nothing more reaches the member'
);
select is(
  (select status from public.notification_channels where id = (select bot_dest_a2 from fx)),
  'active',
  'another member''s chat stays linked'
);
select is(
  (select count(*)::integer from app.stop_bot_chat('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT45', 'synthetic-chat-4501', '2026-11-18 06:03+00')),
  0,
  'a second DỪNG finds nothing linked, so it is confirmed once'
);
select is(
  app.record_bot_reply((select array[bot_dest_a1] from fx), 'stop_confirmation.v1', 'sent', null, 'synthetic-reply-1', '2026-11-18 06:02:01+00'),
  1,
  'the confirmation is logged once per destination'
);
select is(
  (select row(channel, recipient_ref, subject_id, purpose::text, template_ref, status, sent_at, kind, body)::text from public.outbound_messages where template_ref = 'stop_confirmation.v1' and tenant_id = (select tenant_a from fx)),
  (select row('zalo_bot', 'channel:' || bot_dest_a1, member_a, 'notifications', 'stop_confirmation.v1', 'sent', '2026-11-18 06:02:01+00'::timestamptz, null::text, null::text)::text from fx),
  'the log row carries the opaque recipient and the outcome, never the text'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['oa_event_is_interaction', 'oa_webhook_target', 'oa_unverified_on', 'receive_oa_event', 'apply_oa_event', 'raise_oa_webhook_alert', 'set_bot_webhook', 'bot_webhook_target', 'stop_bot_chat', 'record_bot_reply'])
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  array['apply_oa_event', 'bot_webhook_target', 'oa_event_is_interaction', 'oa_unverified_on', 'oa_webhook_target', 'raise_oa_webhook_alert', 'receive_oa_event', 'record_bot_reply', 'set_bot_webhook', 'stop_bot_chat'],
  'no API role executes the webhook functions'
);
select ok(not has_function_privilege('anon', 'public.oa_event_counts(uuid, date, date)', 'execute'), 'anon cannot read the counts');

set local role authenticated;
select pg_temp.act_as((select owner_a from fx));
select is(
  (select array_agg(row(c.day, c.signature, c.events)::text order by c.signature) from public.oa_event_counts((select tenant_a from fx), '2026-11-18', '2026-11-18') c),
  array[row(date '2026-11-18', 'mismatch', 1)::text, row(date '2026-11-18', 'missing', 1)::text, row(date '2026-11-18', 'raw', 2)::text],
  'the owner reads the day counts through the function'
);
select throws_ok($$ select count(*) from public.oa_events $$, '42501', null, 'the owner cannot read the events themselves');
select throws_ok(
  $$ select * from public.oa_event_counts((select tenant_a from fx), '2026-01-01', '2027-12-31') $$,
  '22023', null, 'a range over 400 days is refused'
);
select pg_temp.act_as((select manager_a from fx));
select throws_ok(
  $$ select * from public.oa_event_counts((select tenant_a from fx), '2026-11-18', '2026-11-18') $$,
  '42501', null, 'a manager cannot read the counts'
);
select pg_temp.act_as((select owner_b from fx));
select throws_ok(
  $$ select * from public.oa_event_counts((select tenant_a from fx), '2026-11-18', '2026-11-18') $$,
  '42501', null, 'an owner of another tenant cannot read the counts'
);
reset role;

select * from finish();
rollback;
