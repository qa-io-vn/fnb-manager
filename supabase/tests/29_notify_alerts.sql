begin;
select plan(169);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'eeeeeeee-eeee-4eee-8eee-000029000001'::uuid as tenant_a,
  'eeeeeeee-eeee-4eee-8eee-000029000002'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000029000101'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000029000102'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000029000103'::uuid as store_manager_a,
  'eeeeeeee-eeee-4eee-8eee-000029000104'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000029000201'::uuid as account_a,
  'eeeeeeee-eeee-4eee-8eee-000029000202'::uuid as account_a2,
  'eeeeeeee-eeee-4eee-8eee-000029000203'::uuid as account_b,
  'eeeeeeee-eeee-4eee-8eee-000029000301'::uuid as store_a1,
  'eeeeeeee-eeee-4eee-8eee-000029000302'::uuid as store_a2,
  'eeeeeeee-eeee-4eee-8eee-000029000303'::uuid as store_a3,
  'eeeeeeee-eeee-4eee-8eee-000029000304'::uuid as store_a4,
  'eeeeeeee-eeee-4eee-8eee-000029000305'::uuid as store_b1;

grant select on fx to authenticated;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'alerts-owner-a@example.com'),
    (fx.manager_a, 'alerts-manager-a@example.com'),
    (fx.store_manager_a, 'alerts-store-manager-a@example.com'),
    (fx.owner_b, 'alerts-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_a, 'notify-it-pgtap-alerts-a', 'Notify pgTAP alerts A', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_b, 'notify-it-pgtap-alerts-b', 'Notify pgTAP alerts B', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_a, manager_a, 'manager'::public.tenant_role, null::uuid[] from fx
union all
select tenant_a, store_manager_a, 'manager'::public.tenant_role, array[store_a1] from fx
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'alerts-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_a2, tenant_a, 'mock', 'alerts-pgtap-account-a2', 'Synthetic account A2' from fx
union all
select account_b, tenant_b, 'mock', 'alerts-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, opening_hours)
select store_a1, tenant_a, account_a, 'alerts-pgtap-a1', 'Synthetic store A1', null::jsonb from fx
union all
select store_a2, tenant_a, account_a, 'alerts-pgtap-a2', 'Synthetic store A2', null::jsonb from fx
union all
select store_a3, tenant_a, account_a2, 'alerts-pgtap-a3', 'Synthetic store A3',
  '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb
from fx
union all
select store_a4, tenant_a, account_a2, 'alerts-pgtap-a4', 'Synthetic store A4', null::jsonb from fx
union all
select store_b1, tenant_b, account_b, 'alerts-pgtap-b1', 'Synthetic store B1', null::jsonb from fx;

create temp table consent_ids as
select
  app.ensure_notifications_consent(tenant_a, owner_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_a,
  app.ensure_notifications_consent(tenant_a, manager_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as manager_a,
  app.ensure_notifications_consent(tenant_a, store_manager_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as store_manager_a
from fx;

insert into public.notification_channels (
  tenant_id, kind, provider, label, user_id, address, secret_name, config, status, linked_at, consent_record_id, store_ids, muted_rules, disabled_reason
)
select
  fx.tenant_a,
  v.kind::public.channel_kind,
  v.provider,
  v.label,
  case v.member when 'owner' then fx.owner_a when 'manager' then fx.manager_a when 'store_manager' then fx.store_manager_a end,
  v.address,
  v.secret_name,
  v.config::jsonb,
  v.status,
  case when v.status = 'pending' then null else '2026-11-01 00:00+00'::timestamptz end,
  case v.member when 'owner' then c.owner_a when 'manager' then c.manager_a when 'store_manager' then c.store_manager_a end,
  case v.stores when 'a2' then array[fx.store_a2] when 'a1a2' then array[fx.store_a1, fx.store_a2] end,
  v.muted::text[],
  v.disabled_reason
from fx
cross join consent_ids c
cross join (
  values
    ('d1', 'zalo_bot', 'zalo_bot', 'owner', 'synthetic-chat-291', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}', null),
    ('d2', 'email', 'brevo', 'owner', null, 'NOTIFY_EMAIL_API_KEY_IT', '{}', 'active', null, '{}', null),
    ('d3', 'zalo_bot', 'zalo_bot', 'manager', 'synthetic-chat-293', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}', null),
    ('d4', 'email', 'brevo', 'manager', null, 'NOTIFY_EMAIL_API_KEY_IT', '{}', 'active', null, '{}', null),
    ('d5', 'zalo_bot', 'zalo_bot', 'store_manager', 'synthetic-chat-295', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}', null),
    ('d6', 'webhook', 'hmac_webhook', null, null, 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb/store-two"}', 'active', 'a2', '{}', null),
    ('d7', 'zalo_bot', 'zalo_bot', 'owner', 'synthetic-chat-297', 'NOTIFY_ZALO_BOT_TOKEN_IT2', '{}', 'active', 'a1a2', '{sync_stale}', null),
    ('d8', 'zalo_bot', 'zalo_bot', 'manager', null, 'NOTIFY_ZALO_BOT_TOKEN_IT3', '{}', 'pending', null, '{}', null),
    ('d9', 'zalo_bot', 'zalo_bot', 'owner', 'synthetic-chat-299', 'NOTIFY_ZALO_BOT_TOKEN_IT4', '{}', 'disabled', null, '{}', 'owner_request')
) as v (label, kind, provider, member, address, secret_name, config, status, stores, muted, disabled_reason);

create function pg_temp.ch(p_label text)
returns uuid
language sql
as $$
  select c.id from public.notification_channels c where c.tenant_id = (select tenant_a from fx) and c.label = p_label;
$$;

create function pg_temp.dests(p_rule text, p_store uuid, p_account uuid, p_exclude uuid default null)
returns text[]
language sql
as $$
  select coalesce(array_agg(c.label order by c.label), '{}'::text[])
  from app.alert_destinations((select tenant_a from fx), p_store, p_account, p_rule, p_exclude) d
  join public.notification_channels c on c.id = d.channel_id;
$$;

create function pg_temp.recipients(p_event uuid, p_kind text)
returns text[]
language sql
as $$
  select coalesce(array_agg(c.label order by c.label), '{}'::text[])
  from public.outbound_messages o
  join public.notification_channels c on c.id = o.channel_id
  where o.alert_event_id = p_event
    and o.kind = p_kind;
$$;

create function pg_temp.episode(p_key text, p_tenant uuid default null)
returns public.alert_events
language sql
as $$
  select e.*
  from public.alert_events e
  where e.tenant_id = coalesce(p_tenant, (select tenant_a from fx))
    and e.dedupe_key = p_key
  order by e.opened_at desc, e.id
  limit 1;
$$;

create function pg_temp.deliver(p_event uuid, p_label text, p_at timestamptz)
returns void
language sql
as $$
  update public.outbound_messages o
  set status = 'sending', claimed_at = p_at, lease_until = p_at + interval '2 minutes', attempts = 1
  where o.alert_event_id = p_event and o.channel_id = pg_temp.ch(p_label) and o.kind = 'alert';
  update public.outbound_messages o
  set status = 'sent', sent_at = p_at, lease_until = null
  where o.alert_event_id = p_event and o.channel_id = pg_temp.ch(p_label) and o.kind = 'alert';
$$;

create function pg_temp.run(p_store uuid, p_kind text, p_status text, p_started timestamptz, p_finished timestamptz default null)
returns uuid
language sql
as $$
  insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
  select
    s.tenant_id,
    s.pos_account_id,
    case when p_kind = 'incremental' then s.id end,
    array[s.id],
    p_kind::public.sync_kind,
    (p_started at time zone s.timezone)::date - 1,
    (coalesce(p_finished, p_started + interval '1 minute') at time zone s.timezone)::date,
    p_started,
    coalesce(p_finished, p_started + interval '1 minute'),
    p_status::public.sync_status
  from public.stores s
  where s.id = p_store
  returning id;
$$;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.reset()
returns void
language plpgsql
as $$
begin
  delete from public.outbound_messages o where o.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  delete from public.alert_events e where e.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  delete from app.sync_alerts a where a.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  delete from public.sync_runs r where r.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  delete from public.alert_rules r where r.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  delete from public.invoices i where i.tenant_id in (select tenant_a from fx union all select tenant_b from fx);
  update public.pos_accounts a set status = 'active' where a.tenant_id in (select tenant_a from fx union all select tenant_b from fx) and a.status <> 'active';
  update public.notification_channels c
  set status = 'active', disabled_reason = null, consecutive_failures = 0, last_error_code = null, last_error_at = null
  where c.tenant_id = (select tenant_a from fx)
    and c.label in ('d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7');
end;
$$;

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['root_cause_event', 'alert_destinations', 'enqueue_alert_messages', 'raise_alert', 'record_runner_notification', 'reconcile_alerts', 'import_sync_alerts', 'evaluate_channel_health', 'record_job_event', 'store_day_close_at', 'store_day_shift_state', 'store_day_settled_at', 'due_digests', 'digest_scope_check', 'complete_digest', 'enqueue_digest_message', 'fail_digest', 'notify_tick_rules'])),
  18,
  'the episode and digest functions exist with one signature each'
);

select ok(
  to_regprocedure('app.raise_alert(uuid, text, text, text, timestamptz, uuid, uuid, uuid, date, jsonb, public.alert_severity, boolean)') is not null
  and to_regprocedure('app.record_runner_notification(text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text)') is not null
  and to_regprocedure('app.record_job_event(text, text, bigint, integer, timestamptz, timestamptz, uuid)') is not null
  and to_regprocedure('app.reconcile_alerts(timestamptz, uuid)') is not null
  and to_regprocedure('app.import_sync_alerts(timestamptz, uuid)') is not null
  and to_regprocedure('app.evaluate_channel_health(timestamptz, uuid)') is not null
  and to_regprocedure('app.notify_tick_rules(timestamptz, uuid)') is not null,
  'the alert functions have the signatures the TypeScript side calls'
);

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}'::text[])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['root_cause_event', 'alert_destinations', 'enqueue_alert_messages', 'raise_alert', 'record_runner_notification', 'reconcile_alerts', 'import_sync_alerts', 'evaluate_channel_health', 'record_job_event', 'store_day_close_at', 'store_day_shift_state', 'store_day_settled_at', 'due_digests', 'digest_scope_check', 'complete_digest', 'enqueue_digest_message', 'fail_digest', 'notify_tick_rules'])
     and (
       p.proacl is null
       or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute')
     )),
  '{}'::text[],
  'every episode and digest function is revoked from public and runs as postgres only'
);

select is(pg_temp.dests('sync_stale', (select store_a1 from fx), (select account_a from fx)), array['d1', 'd2'], 'sync_stale on store 1 reaches the owner''s destinations, not the muted one, the managers'' or the other store''s webhook');
select is(pg_temp.dests('sync_stale', (select store_a2 from fx), (select account_a from fx)), array['d1', 'd2', 'd6'], 'a webhook whose store_ids cover the store receives the store''s alert');
select is(pg_temp.dests('auth_failed', null, (select account_a from fx)), array['d1', 'd2', 'd6', 'd7'], 'an account episode reaches destinations narrowed to one of the account''s stores');
select is(pg_temp.dests('auth_failed', null, (select account_a2 from fx)), array['d1', 'd2'], 'destinations narrowed to other stores miss another account''s episode');
select is(pg_temp.dests('job_failed', null, null), array['d1', 'd2', 'd7'], 'a tenant episode reaches unlimited owners and no store-narrowed webhook');

insert into public.alert_rules (tenant_id, rule_key, roles)
select tenant_a, 'sync_stale', array['owner', 'manager']::public.tenant_role[] from fx;
select is(pg_temp.dests('sync_stale', (select store_a1 from fx), (select account_a from fx)), array['d1', 'd2', 'd3', 'd4', 'd5'], 'with managers in the rule''s roles a store-limited manager receives their store''s alert');
select is(pg_temp.dests('sync_stale', (select store_a2 from fx), (select account_a from fx)), array['d1', 'd2', 'd3', 'd4', 'd6'], 'a store-limited manager does not receive another store''s alert');
delete from public.alert_rules r where r.tenant_id = (select tenant_a from fx);

select is(pg_temp.dests('channel_failed', null, null, pg_temp.ch('d3')), array['d1', 'd2', 'd4', 'd7'], 'channel_failed of a manager''s destination reaches the owner and the manager''s other destination, never the failing one');
select is(pg_temp.dests('channel_failed', null, null, pg_temp.ch('d1')), array['d2', 'd7'], 'channel_failed of an owner''s destination reaches the owner''s other destinations');

insert into public.notification_channels (tenant_id, kind, provider, label, secret_name, config, status, linked_at)
select tenant_a, 'webhook', 'hmac_webhook', 'd10', 'NOTIFY_WEBHOOK_SECRET_IT2', '{"url": "https://hooks.example.com/fnb/alerts"}', 'active', '2026-11-01 00:00+00' from fx;
update public.notification_channels c set status = 'failing' where c.id = pg_temp.ch('d2');
select is(pg_temp.dests('job_failed', null, null), array['d1', 'd10', 'd2', 'd7'], 'a webhook without store_ids receives tenant episodes, and a failing destination is still reached');
update public.notification_channels c set status = 'active' where c.id = pg_temp.ch('d2');
delete from public.notification_channels c where c.id = pg_temp.ch('d10');

create temp table r3 as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'incremental', '2026-11-20 03:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 120, "threshold_minutes": 90}'::jsonb);

select is((select outcome || ':' || messages from r3), 'opened:2', 'raise_alert opens an episode and queues one message per destination');
select is(pg_temp.recipients((select event_id from r3), 'alert'), array['d1', 'd2'], 'the opening messages go to the rule''s destinations');
select ok(
  (select e.state = 'open' and e.dedupe_key = 'sync_stale:store:' || fx.store_a1 and e.last_notified_at = '2026-11-20 03:00+00'
     and e.notifications = 2 and e.suppressed_reason is null and e.severity = 'critical' and e.source = 'incremental'
     and e.store_id = fx.store_a1 and e.pos_account_id = fx.account_a
   from public.alert_events e, fx where e.id = (select event_id from r3)),
  'the episode records its key, severity, source, subject and notice'
);
select ok(
  (select bool_and(
     o.template_ref = 'alert.sync_stale.v1'
     and o.dedupe_key = 'alert:' || o.alert_event_id || ':' || o.channel_id || ':open'
     and o.expires_at = '2026-11-21 03:00+00'
     and o.created_at = '2026-11-20 03:00+00'
     and o.status = 'queued'
     and o.severity = 'critical'
     and o.store_id = fx.store_a1
     and o.message_class = 'operational'
     and o.title is null and o.body is null)
   from public.outbound_messages o, fx where o.alert_event_id = (select event_id from r3)),
  'alert messages carry the template, the dedupe key, a 24-hour expiry, the store and no rendered text'
);
select ok(
  (select bool_and(
     o.params ->> 'rule_key' = 'sync_stale'
     and o.params ->> 'severity' = 'critical'
     and o.params ->> 'store_id' = fx.store_a1::text
     and o.params ->> 'account_id' = fx.account_a::text
     and (o.params ->> 'opened_at')::bigint = extract(epoch from timestamptz '2026-11-20 03:00+00')::bigint
     and (o.params ->> 'minutes_without_sync')::integer = 120
     and (o.params ->> 'occurrences')::integer = 1
     and app.facts_are_count_only(o.params))
   from public.outbound_messages o, fx where o.alert_event_id = (select event_id from r3)),
  'message params hold the facts and the episode''s subject as count-only values'
);

select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-20 03:30+00',
    (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 150}'::jsonb) r),
  'repeated',
  'a second reading of an open episode is a repeat'
);
select ok(
  (select e.occurrences = 2 and e.last_seen_at = '2026-11-20 03:30+00' and (e.facts ->> 'minutes_without_sync')::integer = 150
     and (select count(*) from public.outbound_messages o where o.alert_event_id = e.id) = 2
   from public.alert_events e where e.id = (select event_id from r3)),
  'a repeat counts the reading, merges its facts and sends nothing'
);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-21 02:59+00',
    (select store_a1 from fx), (select account_a from fx)) r),
  'repeated',
  'no reminder before 24 hours'
);
select is(
  (select r.outcome || ':' || r.messages from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-21 03:00+00',
    (select store_a1 from fx), (select account_a from fx)) r),
  'reminded:2',
  'a reading 24 hours after the last notice sends the reminder'
);
select ok(
  (select count(*) = 2 and bool_and(o.template_ref = 'alert.sync_stale.reminder.v1' and o.dedupe_key like '%:remind:1')
   from public.outbound_messages o where o.alert_event_id = (select event_id from r3) and o.kind = 'alert_reminder'),
  'reminders use the reminder template and a numbered dedupe key'
);
select is((select e.last_notified_at from public.alert_events e where e.id = (select event_id from r3)), '2026-11-21 03:00+00'::timestamptz, 'the reminder moves the notice time');

update public.alert_events e set state = 'resolved', resolved_at = '2026-11-21 03:30+00', resolution = 'recovered' where e.id = (select event_id from r3);
create temp table r3c as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'incremental', '2026-11-21 04:30+00',
  (select store_a1 from fx), (select account_a from fx));
select is((select outcome || ':' || messages from r3c), 'opened:0', 'a new episode inside the cool-down opens silently');
select ok(
  (select e.suppressed_reason = 'cool_down' and e.last_notified_at = '2026-11-21 03:00+00' and e.notifications = 0
   from public.alert_events e where e.id = (select event_id from r3c)),
  'the silent episode inherits the last notice time'
);
update public.alert_events e set state = 'resolved', resolved_at = '2026-11-21 04:45+00', resolution = 'recovered' where e.id = (select event_id from r3c);
select is(
  (select r.outcome || ':' || r.messages from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'incremental', '2026-11-21 05:01+00',
    (select store_a1 from fx), (select account_a from fx)) r),
  'opened:2',
  'once the cool-down after the last notice has passed a new episode notifies again'
);

create temp table r3e as
select * from app.raise_alert((select tenant_b from fx), 'sync_failed', 'store:' || (select store_b1 from fx), 'cli', '2026-11-20 03:00+00',
  (select store_b1 from fx), (select account_b from fx));
select ok(
  (select e.suppressed_reason = 'no_destination' and e.last_notified_at is null and e.notifications = 0 and e.state = 'open'
   from public.alert_events e where e.id = (select event_id from r3e)),
  'without a destination the episode is still recorded, as no_destination'
);

insert into public.alert_rules (tenant_id, rule_key, enabled)
select tenant_a, 'sync_dispatch_failed', false from fx;
select is(
  (select r.outcome || ':' || coalesce(r.event_id::text, 'none') from app.raise_alert((select tenant_a from fx), 'sync_dispatch_failed', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-20 03:00+00',
    (select store_a1 from fx)) r),
  'ignored_disabled:none',
  'a disabled rule is ignored'
);
select is((select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'sync_dispatch_failed'), 0, 'a disabled rule opens no episode');

select throws_ok($$ select * from app.raise_alert((select tenant_a from fx), 'no_such_rule', 'tenant', 'cli', now()) $$, '22023', null, 'an unknown rule key is refused');
select throws_ok($$ select * from app.raise_alert((select tenant_a from fx), 'revenue_below_baseline', 'store:x', 'cli', now()) $$, '22023', null, 'a digest rule never opens an episode');
select throws_ok($$ select * from app.raise_alert((select tenant_a from fx), 'job_failed', 'workflow:sync', 'actions', now(), null, null, null, null, '{"error": "Connection refused by the host"}'::jsonb) $$, '22023', null, 'facts that are not count-only are refused');
select throws_ok($$ select * from app.raise_alert((select tenant_a from fx), 'job_failed', 'Workflow Sync', 'actions', now()) $$, '22023', null, 'a subject key that is not lower-case tokens is refused');

select pg_temp.reset();
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r4 as
select * from app.raise_alert((select tenant_a from fx), 'auth_failed', 'account:' || (select account_a2 from fx), 'incremental', '2026-11-22 03:00+00',
  null, (select account_a2 from fx));
select is((select outcome || ':' || messages from r4), 'opened:2', 'auth_failed reaches the owner''s destinations that cover the account');
select is(
  (select r.outcome || ':' || r.event_id::text from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a3 from fx), 'scheduler', '2026-11-22 04:30+00',
    (select store_a3 from fx), (select account_a2 from fx), null, null, '{"minutes_without_sync": 95}'::jsonb) r),
  'folded:' || (select event_id from r4)::text,
  'a stale reading of the account''s store folds under the open auth_failed episode'
);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_failed', 'store:' || (select store_a3 from fx), 'incremental', '2026-11-22 04:31+00',
    (select store_a3 from fx)) r),
  'folded',
  'the store alone leads to its account''s root cause'
);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_dispatch_failed', 'store:' || (select store_a3 from fx), 'scheduler', '2026-11-22 04:20+00',
    (select store_a3 from fx)) r),
  'folded',
  'a dispatch failure of the account''s store folds too'
);
select ok(
  (select e.folded_occurrences = 3 and e.last_seen_at = '2026-11-22 04:31+00' from public.alert_events e where e.id = (select event_id from r4))
  and not exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key <> 'auth_failed'),
  'folded readings count on the root cause and open nothing'
);
select is((select count(*)::integer from public.outbound_messages o where o.tenant_id = (select tenant_a from fx)), 2, 'folding sends nothing');
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-22 04:30+00',
    (select store_a1 from fx), (select account_a from fx)) r),
  'opened',
  'a reading of a store of another account is not folded'
);
update public.alert_events e set state = 'resolved', resolved_at = '2026-11-22 05:00+00', resolution = 'recovered' where e.id = (select event_id from r4);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a3 from fx), 'scheduler', '2026-11-22 05:20+00',
    (select store_a3 from fx)) r),
  'folded',
  'a reading 20 minutes after the recovery still folds'
);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a3 from fx), 'scheduler', '2026-11-22 05:31+00',
    (select store_a3 from fx)) r),
  'opened',
  'a reading 31 minutes after the recovery opens its own episode'
);

select pg_temp.reset();
create temp table r5a as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_b from fx), (select account_b from fx), (select store_b1 from fx), null,
  '{}'::jsonb, '2026-11-23 03:00+00', 'incremental');
select ok(
  (select e.dedupe_key = 'auth_failed:account:' || fx.account_b and e.store_id is null and e.pos_account_id = fx.account_b
     and (e.facts ->> 'store_count')::integer = 1 and e.suppressed_reason = 'no_destination' and e.source = 'incremental' and e.severity = 'critical'
   from public.alert_events e, fx where e.id = (select event_id from r5a)),
  'auth_failed maps to the account''s episode without the store, and is recorded without destinations'
);

create temp table r5runs as
select pg_temp.run((select store_a1 from fx), 'incremental', 'failed', '2026-11-23 02:30+00') as first_run;
select is(
  (select r.outcome from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), (select store_a1 from fx),
    (select first_run from r5runs), '{"stage": "run", "connector_calls": 3}'::jsonb, '2026-11-23 02:31+00', 'incremental') r),
  'below_threshold',
  'one failed incremental run stays below min_consecutive_incremental'
);
create temp table r5b as
select * from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), (select store_a1 from fx),
  pg_temp.run((select store_a1 from fx), 'incremental', 'failed', '2026-11-23 03:00+00'),
  '{"stage": "run", "connector_calls": 3, "error": "Connection refused by host"}'::jsonb, '2026-11-23 03:01+00', 'incremental');
select is((select outcome || ':' || messages from r5b), 'opened:3', 'the second consecutive failed incremental run raises sync_failed for the store');
select ok(
  (select e.dedupe_key = 'sync_failed:store:' || fx.store_a1 and e.facts ->> 'kind' = 'incremental' and (e.facts ->> 'consecutive_failures')::integer = 2
     and e.facts ->> 'stage' = 'run' and (e.facts ->> 'connector_calls')::integer = 3 and not (e.facts ? 'error')
   from public.alert_events e, fx where e.id = (select event_id from r5b)),
  'the episode keeps count-only facts and drops the error text'
);
select pg_temp.run((select store_a2 from fx), 'incremental', 'failed', '2026-11-23 02:00+00');
select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-11-23 02:30+00');
select is(
  (select r.outcome from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), null, (select store_a2 from fx),
    pg_temp.run((select store_a2 from fx), 'incremental', 'failed', '2026-11-23 03:00+00'), '{"stage": "connect"}'::jsonb, '2026-11-23 03:01+00', 'incremental') r),
  'below_threshold',
  'a success between two failures restarts the count'
);
create temp table r5c as
select * from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), null, null,
  '{"kind": "nightly", "connector_calls": 12}'::jsonb, '2026-11-23 20:30+00', 'cli');
select is((select e.dedupe_key from public.alert_events e where e.id = (select event_id from r5c)), 'sync_failed:account:' || (select account_a from fx) || ':nightly', 'a failed nightly maps to the account and the kind');
select is((select messages from r5c), 4, 'the account''s episode reaches every destination covering one of its stores');
create temp table r5f as
select * from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), null,
  pg_temp.run((select store_a1 from fx), 'backfill', 'failed', '2026-11-23 21:00+00'), '{}'::jsonb, '2026-11-23 21:05+00', 'cli');
select is(
  (select e.dedupe_key from r5f r join public.alert_events e on e.id = r.event_id),
  'sync_failed:account:' || (select account_a from fx) || ':backfill',
  'the recorded run''s own kind decides the subject'
);

create temp table r5d as
select * from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), (select account_a from fx), (select store_a2 from fx), null,
  '{"scope": "now", "minutes_without_sync": 120, "threshold_minutes": 90}'::jsonb, '2026-11-23 04:00+00', 'incremental');
select ok(
  (select r.outcome = 'opened' and r.messages = 3 and e.dedupe_key = 'sync_stale:store:' || fx.store_a2 and (e.facts ->> 'threshold_minutes')::integer = 90
   from r5d r join public.alert_events e on e.id = r.event_id, fx),
  'a stale reading opens sync_stale for the store'
);
insert into public.alert_rules (tenant_id, store_id, rule_key, params)
select tenant_a, store_a2, 'sync_stale', '{"threshold_minutes": 150}'::jsonb from fx;
select is(
  (select r.outcome from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a2 from fx), null,
    '{"scope": "now", "minutes_without_sync": 140}'::jsonb, '2026-11-23 04:30+00', 'incremental') r),
  'below_threshold',
  'the store''s raised threshold applies to the runner''s reading'
);
select is(
  (select r.outcome from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a2 from fx), null,
    '{"scope": "now", "minutes_without_sync": 160}'::jsonb, '2026-11-23 05:00+00', 'incremental') r),
  'repeated',
  'a reading over the raised threshold counts on the open episode'
);
select is(
  (select r.outcome from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a2 from fx), null,
    '{"scope": "previous_day", "business_date": "2026-11-23", "minutes_without_sync": 200}'::jsonb, '2026-11-24 20:30+00', 'cli') r),
  'covered',
  'a previous-day reading for a day an episode of the store overlapped is covered'
);
create temp table r5e as
select * from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a2 from fx), null,
  '{"scope": "previous_day", "business_date": "2026-11-22", "minutes_without_sync": 200}'::jsonb, '2026-11-23 20:30+00', 'cli');
select ok(
  (select r.outcome = 'opened' and r.messages = 3 and e.dedupe_key = 'sync_stale:store_day:' || fx.store_a2 || ':2026-11-22'
     and e.state = 'resolved' and e.resolution = 'instant' and e.business_date = '2026-11-22'
   from r5e r join public.alert_events e on e.id = r.event_id, fx),
  'an uncovered previous-day reading opens and resolves an instant episode for that day'
);
select throws_ok($$ select * from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_b1 from fx), null, '{"minutes_without_sync": 200}'::jsonb, now(), 'cli') $$, '22023', null, 'a store of another tenant is refused');
select throws_ok($$ select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a2 from fx), (select store_a1 from fx), null, '{}'::jsonb, now(), 'cli') $$, '22023', null, 'a store of another POS account is refused');
select throws_ok($$ select * from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), null, pg_temp.run((select store_b1 from fx), 'nightly', 'failed', now()), '{}'::jsonb, now(), 'cli') $$, '22023', null, 'a run of another tenant is refused');
select throws_ok($$ select * from app.record_runner_notification('sync_ok', 'warning', (select tenant_a from fx), null, null, null, '{}'::jsonb, now(), 'cli') $$, '22023', null, 'an unknown notification kind is refused');
select throws_ok($$ select * from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a1 from fx), null, '{"scope": "previous_day", "business_date": "2026-02-30", "minutes_without_sync": 200}'::jsonb, now(), 'cli') $$, '22023', null, 'a previous-day reading needs a real business date');

select pg_temp.reset();
select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-11-24 23:59+00', '2026-11-25 00:00+00');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, minutes)
select tenant_a, store_a1, 'sync_stale', '2026-11-25 02:00+00', '2026-11-25 02:30+00', 3, 150 from fx;
select is(app.import_sync_alerts('2026-11-25 03:00+00', (select tenant_a from fx)), 1, 'an open stale row over the threshold is imported');
select ok(
  (select e.state = 'open' and e.source = 'scheduler' and e.opened_at = '2026-11-25 02:30+00' and e.notifications = 2
     and (e.facts ->> 'minutes_without_sync')::integer = 150 and (e.facts ->> 'threshold_minutes')::integer = 90
   from public.alert_events e, fx where e.dedupe_key = 'sync_stale:store:' || fx.store_a1),
  'the import opens the store''s sync_stale episode at the row''s reading'
);
select is((select a.notified_at from app.sync_alerts a, fx where a.store_id = fx.store_a1), '2026-11-25 03:00+00'::timestamptz, 'the imported row gets notified_at');
select is(app.import_sync_alerts('2026-11-25 03:05+00', (select tenant_a from fx)), 0, 'the same reading is not raised twice');
update app.sync_alerts a set last_seen_at = '2026-11-25 03:20+00', minutes = 170, occurrences = 4 from fx where a.store_id = fx.store_a1;
select is(app.import_sync_alerts('2026-11-25 03:25+00', (select tenant_a from fx)), 1, 'a newer reading of the row is imported');
select ok(
  (select e.occurrences = 2 and e.last_seen_at = '2026-11-25 03:20+00' and (select count(*) from public.outbound_messages o where o.alert_event_id = e.id) = 2
   from public.alert_events e, fx where e.dedupe_key = 'sync_stale:store:' || fx.store_a1),
  'the newer reading counts on the open episode and sends nothing'
);
select is((select a.notified_at from app.sync_alerts a, fx where a.store_id = fx.store_a1), '2026-11-25 03:00+00'::timestamptz, 'notified_at keeps the first notice');
select is(
  (select r.outcome from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a1 from fx), null,
    '{"scope": "now", "minutes_without_sync": 200}'::jsonb, '2026-11-25 03:30+00', 'incremental') r),
  'repeated',
  'the runner''s reading and the scheduler''s share one episode'
);

select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-11-24 00:00+00');
select pg_temp.run((select store_a3 from fx), 'incremental', 'succeeded', '2026-11-25 02:29+00', '2026-11-25 02:30+00');
select pg_temp.run((select store_a4 from fx), 'incremental', 'succeeded', '2026-11-24 20:59+00', '2026-11-24 21:00+00');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, minutes)
select tenant_a, store_a2, 'sync_stale', '2026-11-25 02:00+00'::timestamptz, '2026-11-25 02:30+00'::timestamptz, 1, 80 from fx
union all
select tenant_a, store_a3, 'sync_stale', '2026-11-25 02:00+00', '2026-11-25 02:45+00', 2, 120 from fx
union all
select tenant_a, store_a4, 'sync_stale', '2026-11-24 19:00+00', '2026-11-24 20:00+00', 2, 300 from fx;
select is(app.import_sync_alerts('2026-11-25 03:40+00', (select tenant_a from fx)), 0, 'rows under the threshold, rows older than a newer successful sync and stores back within the threshold are not imported');
select is((select count(*)::integer from app.sync_alerts a where a.tenant_id = (select tenant_a from fx) and a.notified_at is not null), 1, 'only the imported row is marked notified');
select is((select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'sync_stale'), 1, 'the skipped rows open no episode');

select pg_temp.run((select store_b1 from fx), 'incremental', 'succeeded', '2026-11-24 00:00+00');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, minutes)
select tenant_b, store_b1, 'sync_stale', '2026-11-25 02:00+00', '2026-11-25 02:30+00', 5, 500 from fx;
select is(app.import_sync_alerts('2026-11-25 03:40+00', (select tenant_b from fx)), 0, 'nothing is imported for a tenant without destinations');
select ok(
  (select a.notified_at is null from app.sync_alerts a, fx where a.store_id = fx.store_b1)
  and not exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_b from fx)),
  'the tick stays read-only for a tenant without destinations'
);

update app.sync_alerts a set resolved_at = '2026-11-25 03:41+00'
where a.kind = 'sync_stale' and a.store_id in (select store_a2 from fx union all select store_a3 from fx union all select store_a4 from fx);
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, http_status)
select tenant_a, store_a2, 'dispatch_failed', '2026-11-25 03:30+00', '2026-11-25 03:30+00', 1, 503 from fx;
select is(app.import_sync_alerts('2026-11-25 03:45+00', (select tenant_a from fx)), 0, 'one unclaimed ticket stays under min_occurrences');
update app.sync_alerts a set occurrences = 2, last_seen_at = '2026-11-25 04:00+00' from fx where a.store_id = fx.store_a2 and a.kind = 'dispatch_failed';
select is(app.import_sync_alerts('2026-11-25 04:05+00', (select tenant_a from fx)), 1, 'the second unclaimed ticket raises sync_dispatch_failed');
select ok(
  (select e.notifications = 4 and (e.facts ->> 'http_status')::integer = 503 and (e.facts ->> 'sync_alert_occurrences')::integer = 2
   from public.alert_events e, fx where e.dedupe_key = 'sync_dispatch_failed:store:' || fx.store_a2),
  'sync_dispatch_failed keeps the HTTP status and the count, never the error text'
);

select pg_temp.reset();
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a from fx);
create temp table r7a as
select * from app.raise_alert((select tenant_a from fx), 'auth_failed', 'account:' || (select account_a from fx), 'incremental', '2026-11-26 03:00+00',
  null, (select account_a from fx));
select pg_temp.deliver((select event_id from r7a), 'd1', '2026-11-26 03:01+00');
select is(app.reconcile_alerts('2026-11-26 03:30+00', (select tenant_a from fx)), 0, 'nothing resolves while the account is still auth_failed');
update public.pos_accounts a set status = 'active' where a.id = (select account_a from fx);
select is(app.reconcile_alerts('2026-11-26 04:00+00', (select tenant_a from fx)), 1, 'the account logging in again resolves auth_failed');
select ok(
  (select e.state = 'resolved' and e.resolution = 'recovered' and e.resolved_at = '2026-11-26 04:00+00' and e.notifications = 5
   from public.alert_events e where e.id = (select event_id from r7a)),
  'the episode is resolved as recovered and counts its notice'
);
select is(pg_temp.recipients((select event_id from r7a), 'alert_resolved'), array['d1'], 'the recovery notice goes only where the opening message was delivered');
select ok(
  (select o.template_ref = 'alert.auth_failed.resolved.v1' and o.dedupe_key like '%:resolved'
     and (o.params ->> 'resolved_at')::bigint = extract(epoch from timestamptz '2026-11-26 04:00+00')::bigint
   from public.outbound_messages o where o.alert_event_id = (select event_id from r7a) and o.kind = 'alert_resolved'),
  'the recovery notice uses the resolved template and carries the resolution time'
);
select is(
  (select d.decision || ':' || d.reason from app.message_decision(
    (select o.id from public.outbound_messages o where o.alert_event_id = (select event_id from r7a) and o.kind = 'alert' and o.channel_id = pg_temp.ch('d2')),
    '2026-11-26 04:01+00') d),
  'cancel:resolved_before_send',
  'an opening message still waiting is cancelled at its claim'
);
select is(app.reconcile_alerts('2026-11-26 04:05+00', (select tenant_a from fx)), 0, 'a resolved episode is left alone');

create temp table r7b as
select * from app.raise_alert((select tenant_a from fx), 'sync_failed', 'store:' || (select store_a1 from fx), 'incremental', '2026-11-26 05:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"kind": "incremental"}'::jsonb);
create temp table r7c as
select * from app.raise_alert((select tenant_a from fx), 'sync_failed', 'account:' || (select account_a from fx) || ':nightly', 'cli', '2026-11-26 05:00+00',
  null, (select account_a from fx), null, null, '{"kind": "nightly"}'::jsonb);
select pg_temp.deliver((select event_id from r7b), 'd1', '2026-11-26 05:01+00');
select pg_temp.run((select store_a1 from fx), 'backfill', 'succeeded', '2026-11-26 05:10+00');
select is(app.reconcile_alerts('2026-11-26 05:20+00', (select tenant_a from fx)), 1, 'a later succeeded run of the store resolves its sync_failed');
select ok(
  (select e.resolution = 'recovered' from public.alert_events e where e.id = (select event_id from r7b))
  and (select e.state = 'open' from public.alert_events e where e.id = (select event_id from r7c)),
  'a backfill does not resolve a failed nightly'
);
select is(pg_temp.recipients((select event_id from r7b), 'alert_resolved'), '{}'::text[], 'sync_failed sends no recovery notice');
select pg_temp.run((select store_a1 from fx), 'nightly', 'succeeded', '2026-11-26 20:30+00');
select is(app.reconcile_alerts('2026-11-26 21:00+00', (select tenant_a from fx)), 1, 'a succeeded nightly resolves the failed nightly''s episode');

select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-11-26 21:00+00', '2026-11-26 21:01+00');
create temp table r7d as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a2 from fx), 'scheduler', '2026-11-26 23:00+00',
  (select store_a2 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 119}'::jsonb);
select pg_temp.deliver((select event_id from r7d), 'd6', '2026-11-26 23:01+00');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, minutes)
select tenant_a, store_a2, 'sync_stale', '2026-11-26 22:30+00', '2026-11-26 23:00+00', 119 from fx;
select is(app.reconcile_alerts('2026-11-26 23:30+00', (select tenant_a from fx)), 0, 'a store still over the threshold stays open');
select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-11-26 23:40+00', '2026-11-26 23:41+00');
select is(app.reconcile_alerts('2026-11-26 23:50+00', (select tenant_a from fx)), 1, 'a successful sync resolves the stale store although phase 7''s row still holds the older reading');
select ok(
  (select e.resolution = 'recovered' from public.alert_events e where e.id = (select event_id from r7d))
  and pg_temp.recipients((select event_id from r7d), 'alert_resolved') = array['d6'],
  'the stale store''s recovery notice reaches the destination that got the alert'
);

create temp table r7e as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-27 01:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 150}'::jsonb);
select pg_temp.deliver((select event_id from r7e), 'd1', '2026-11-27 01:01+00');
update app.incremental_sync_settings set enabled = false, updated_at = '2026-11-27 01:30+00';
select is(app.reconcile_alerts('2026-11-27 02:00+00', (select tenant_a from fx)), 1, 'switching the incremental schedule off resolves the stale store');
select ok(
  (select e.resolution = 'schedule_disabled' from public.alert_events e where e.id = (select event_id from r7e))
  and pg_temp.recipients((select event_id from r7e), 'alert_resolved') = '{}'::text[],
  'a stale store resolved by switching the schedule off sends no recovery notice'
);
update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, http_status)
select tenant_a, store_a1, 'dispatch_failed', '2026-11-27 02:30+00', '2026-11-27 03:00+00', 2, 500 from fx;
create temp table r7f as
select * from app.raise_alert((select tenant_a from fx), 'sync_dispatch_failed', 'store:' || (select store_a1 from fx), 'scheduler', '2026-11-27 03:00+00',
  (select store_a1 from fx), (select account_a from fx));
select is(app.reconcile_alerts('2026-11-27 03:10+00', (select tenant_a from fx)), 0, 'sync_dispatch_failed stays open while its row is open');
update app.sync_alerts a set resolved_at = '2026-11-27 03:15+00' from fx where a.store_id = fx.store_a1 and a.kind = 'dispatch_failed';
select is(app.reconcile_alerts('2026-11-27 03:20+00', (select tenant_a from fx)), 1, 'a claimed ticket clears sync_dispatch_failed');
select is((select e.resolution from public.alert_events e where e.id = (select event_id from r7f)), 'cleared', 'the dispatch failure is resolved as cleared');

create temp table r7g as
select * from app.raise_alert((select tenant_a from fx), 'nightly_missing', 'tenant', 'notify', '2026-11-27 04:00+00');
select is(pg_temp.recipients((select event_id from r7g), 'alert'), array['d1', 'd2', 'd7'], 'nightly_missing is a tenant episode for the owners');
select pg_temp.deliver((select event_id from r7g), 'd2', '2026-11-27 04:01+00');
select pg_temp.run((select store_a1 from fx), 'nightly', 'succeeded', '2026-11-27 20:20+00');
select is(app.reconcile_alerts('2026-11-27 20:30+00', (select tenant_a from fx)), 1, 'a succeeded nightly resolves nightly_missing');
select is(pg_temp.recipients((select event_id from r7g), 'alert_resolved'), array['d2'], 'nightly_missing sends its recovery notice');

create temp table r7h as
select * from app.raise_alert((select tenant_a from fx), 'zero_sales_open', 'store:' || (select store_a1 from fx) || ':2026-11-28', 'notify', '2026-11-28 05:00+00',
  (select store_a1 from fx), (select account_a from fx), null, '2026-11-28');
create temp table r7i as
select * from app.raise_alert((select tenant_a from fx), 'zero_sales_open', 'store:' || (select store_a2 from fx) || ':2026-11-28', 'notify', '2026-11-28 05:00+00',
  (select store_a2 from fx), (select account_a from fx), null, '2026-11-28');
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, status)
select tenant_a, store_a2, account_a, 'alerts-pgtap-sale-1', '2026-11-28 05:30+00', '2026-11-28', 'completed' from fx;
select is(app.reconcile_alerts('2026-11-28 06:00+00', (select tenant_a from fx)), 1, 'a sale clears zero_sales_open for its store only');
select is((select e.resolution from public.alert_events e where e.id = (select event_id from r7i)), 'cleared', 'the store with a sale is cleared');
select is(app.reconcile_alerts('2026-11-28 17:00+00', (select tenant_a from fx)), 1, 'zero_sales_open ends with the business day');
select is((select e.resolution from public.alert_events e where e.id = (select event_id from r7h)), 'day_ended', 'the store without a sale is resolved as day_ended');

create temp table r7j as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a2 from fx), 'scheduler', '2026-11-29 01:00+00',
  (select store_a2 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 400}'::jsonb);
select is(app.reconcile_alerts('2026-11-30 00:59+00', (select tenant_a from fx)), 0, 'no reminder before 24 hours');
select is(app.reconcile_alerts('2026-11-30 01:00+00', (select tenant_a from fx)), 1, 'the tick sends the 24-hour reminder of a store still stale');
select is(pg_temp.recipients((select event_id from r7j), 'alert_reminder'), array['d1', 'd2', 'd6'], 'the reminder reaches the episode''s destinations');
select is(app.reconcile_alerts('2026-11-30 01:05+00', (select tenant_a from fx)), 0, 'the reminder is not repeated within the next 24 hours');
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a from fx);
select * from app.raise_alert((select tenant_a from fx), 'auth_failed', 'account:' || (select account_a from fx), 'cli', '2026-11-30 02:00+00', null, (select account_a from fx));
select is(app.reconcile_alerts('2026-12-01 01:10+00', (select tenant_a from fx)), 0, 'no reminder while the account''s auth_failed is open');

select pg_temp.reset();
update public.notification_channels c
set status = 'failing', last_error_code = 'token_invalid', last_error_at = '2026-12-02 03:00+00', consecutive_failures = 1
where c.id = pg_temp.ch('d3');
select is(app.evaluate_channel_health('2026-12-02 03:05+00', (select tenant_a from fx)), 1, 'a failing destination raises channel_failed');
select ok(
  (select e.channel_id = pg_temp.ch('d3') and e.store_id is null and e.facts ->> 'channel_kind' = 'zalo_bot' and e.facts ->> 'error_code' = 'token_invalid'
     and e.dedupe_key = 'channel_failed:channel:' || pg_temp.ch('d3')
   from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'channel_failed'),
  'the channel_failed episode names the destination, its kind and the error code'
);
select is(
  pg_temp.recipients((pg_temp.episode('channel_failed:channel:' || pg_temp.ch('d3'))).id, 'alert'),
  array['d1', 'd2', 'd4', 'd7'],
  'the alert reaches the member''s other destination and the owner''s, never the failing one'
);
select is(app.evaluate_channel_health('2026-12-02 03:10+00', (select tenant_a from fx)), 0, 'one alert per failure');
update public.notification_channels c
set status = 'disabled', disabled_reason = 'blocked_by_user', last_error_code = 'blocked_by_user', last_error_at = '2026-12-02 04:00+00'
where c.id = pg_temp.ch('d1');
select is(app.evaluate_channel_health('2026-12-02 04:05+00', (select tenant_a from fx)), 1, 'a destination disabled as blocked_by_user raises channel_failed');
select is(pg_temp.recipients((pg_temp.episode('channel_failed:channel:' || pg_temp.ch('d1'))).id, 'alert'), array['d2', 'd7'], 'the blocked owner hears it on their other destinations');
select is(app.evaluate_channel_health('2026-12-02 04:10+00', (select tenant_a from fx)), 0, 'a blocked destination is reported once');
update public.notification_channels c set status = 'active', last_ok_at = '2026-12-02 05:00+00' where c.id = pg_temp.ch('d3');
select app.enqueue_message((select tenant_a from fx), pg_temp.ch('d3'), 'test', 'test.v1', 'pgtap-alerts-test-d3', '{}'::jsonb, null, 'synthetic', 'info', null, null, null, null, null, '2026-12-02 04:59+00');
update public.outbound_messages o set status = 'sending', claimed_at = '2026-12-02 05:00+00', lease_until = '2026-12-02 05:02+00', attempts = 1 where o.dedupe_key = 'pgtap-alerts-test-d3';
update public.outbound_messages o set status = 'sent', sent_at = '2026-12-02 05:00+00', lease_until = null where o.dedupe_key = 'pgtap-alerts-test-d3';
select is(app.reconcile_alerts('2026-12-02 05:05+00', (select tenant_a from fx)), 1, 'a later sent message on the destination resolves channel_failed');
select is((pg_temp.episode('channel_failed:channel:' || pg_temp.ch('d3'))).resolution, 'recovered', 'the destination is recovered');
update public.notification_channels c
set status = 'failing', last_error_code = 'not_found', last_error_at = '2026-12-02 06:00+00'
where c.id = pg_temp.ch('d3');
select is(app.evaluate_channel_health('2026-12-02 06:05+00', (select tenant_a from fx)), 1, 'a new failure after the recovery raises a new episode');
select is((pg_temp.episode('channel_failed:channel:' || pg_temp.ch('d3'))).suppressed_reason, 'cool_down', 'inside the 24-hour cool-down it opens silently');

select pg_temp.reset();
create temp table r9a as
select * from app.record_job_event('backup', 'failure', 123456789, 1, '2026-12-03 19:00+00', '2026-12-03 19:30+00', (select tenant_a from fx));
select is((select array_agg(r.tenant_id::text || ':' || r.outcome || ':' || r.messages) from r9a r), array[(select tenant_a from fx)::text || ':opened:3'], 'a failed workflow alerts the tenant''s owners once');
select ok(
  (select e.state = 'resolved' and e.resolution = 'instant' and e.severity = 'warning' and e.source = 'actions'
     and e.facts = '{"workflow": "backup", "conclusion": "failure", "run_attempt": 1}'::jsonb
   from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.dedupe_key = 'job_failed:workflow:backup'),
  'job_failed is an instant episode that keeps neither the run id nor its URL'
);
select is(
  (select r.outcome || ':' || r.messages from app.record_job_event('backup', 'timed_out', 2, 1, null, '2026-12-04 01:00+00', (select tenant_a from fx)) r),
  'opened:0',
  'a second failure within 12 hours opens silently'
);
select is((pg_temp.episode('job_failed:workflow:backup')).suppressed_reason, 'cool_down', 'the 12-hour cool-down keeps it silent');
select is(
  (select r.messages from app.record_job_event('backup', 'failure', 3, 1, null, '2026-12-04 07:31+00', (select tenant_a from fx)) r),
  3,
  'after 12 hours the failure is sent again'
);
select * from app.record_job_event('migrate', 'failure', 4, 1, null, '2026-12-04 08:00+00', (select tenant_a from fx));
select is((pg_temp.episode('job_failed:workflow:migrate')).severity, 'critical'::public.alert_severity, 'a failed migration is critical');
select is((select count(*)::integer from app.record_job_event('backup', 'failure', 5, 1, null, '2026-12-04 08:00+00', (select tenant_b from fx))), 0, 'a tenant without a destination for job_failed gets no row');
select is((select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_b from fx)), 0, 'and no episode');

update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a from fx);
select * from app.raise_alert((select tenant_a from fx), 'auth_failed', 'account:' || (select account_a from fx), 'cli', '2026-12-04 19:40+00', null, (select account_a from fx));
select is(
  (select r.outcome || ':' || r.messages from app.record_job_event('sync', 'failure', 6, 1, '2026-12-04 19:20+00', '2026-12-04 19:50+00', (select tenant_a from fx)) r),
  'root_cause_open:0',
  'a failed Sync while auth_failed is open sends nothing'
);
select ok(
  (select e.state = 'resolved' and e.resolution = 'instant' and e.suppressed_reason = 'root_cause_open' and e.notifications = 0 and e.last_notified_at is null
   from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.dedupe_key = 'job_failed:workflow:sync'),
  'the suppressed Sync failure is kept as an instant root_cause_open episode'
);
select is(
  (select r.outcome || ':' || r.messages from app.record_job_event('deploy_web', 'failure', 7, 1, '2026-12-04 19:20+00', '2026-12-04 19:55+00', (select tenant_a from fx)) r),
  'opened:3',
  'another workflow is not suppressed by a sync root cause'
);

select pg_temp.reset();
select * from app.raise_alert((select tenant_a from fx), 'sync_failed', 'store:' || (select store_a1 from fx), 'incremental', '2026-12-05 19:30+00',
  (select store_a1 from fx), (select account_a from fx));
select is(
  (select r.outcome from app.record_job_event('sync', 'failure', 8, 1, '2026-12-05 19:20+00', '2026-12-05 19:50+00', (select tenant_a from fx)) r),
  'root_cause_open',
  'a sync episode opened after the run started explains the failed Sync'
);
select is(
  (select r.outcome || ':' || r.messages from app.record_job_event('sync', 'failure', 9, 1, '2026-12-05 20:00+00', '2026-12-05 20:30+00', (select tenant_a from fx)) r),
  'opened:3',
  'a sync episode last seen before the run started does not'
);
select throws_ok($$ select * from app.record_job_event('nightly', 'failure', 1, 1, null, now(), (select tenant_a from fx)) $$, '22023', null, 'an unknown workflow key is refused');
select throws_ok($$ select * from app.record_job_event('sync', 'success', 1, 1, null, now(), (select tenant_a from fx)) $$, '22023', null, 'only failed conclusions are recorded');

select pg_temp.reset();
set local role authenticated;
select pg_temp.act_as((select owner_a from fx));
select lives_ok(
  $$ insert into public.alert_rules (tenant_id, rule_key, enabled) values ((select tenant_a from fx), 'revenue_below_baseline', false) $$,
  'the owner switches revenue_below_baseline off through RLS'
);
select pg_temp.act_as((select store_manager_a from fx));
select throws_ok(
  $$ insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) values ((select tenant_a from fx), (select store_a1 from fx), 'revenue_below_baseline', true) $$,
  '42501', null,
  'a store-limited manager cannot switch it back on for their store'
);
reset role;
select is(
  (select r.enabled::text || ':' || r.source from app.effective_alert_rule((select tenant_a from fx), (select store_a1 from fx), 'revenue_below_baseline') r),
  'false:tenant',
  'the digest line rule is off for every store of the tenant'
);
insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_a, 'sync_stale', false from fx;
insert into public.alert_rules (tenant_id, store_id, rule_key, enabled) select tenant_a, store_a2, 'sync_stale', true from fx;
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-12-05 21:00+00', (select store_a1 from fx)) r),
  'ignored_disabled',
  'an immediate rule switched off for the tenant is ignored'
);
select is(
  (select r.outcome from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a2 from fx), 'scheduler', '2026-12-05 21:00+00', (select store_a2 from fx)) r),
  'opened',
  'a store row switching it back on applies to that store only'
);

select pg_temp.reset();
select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-12-06 01:00+00', '2026-12-06 01:01+00');
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'scheduler', '2026-12-06 03:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 119}'::jsonb);
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, minutes)
select tenant_a, store_a1, 'sync_stale', '2026-12-06 02:30+00', '2026-12-06 03:00+00', 119 from fx;
select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-12-06 03:10+00', '2026-12-06 03:11+00');
create temp table r11 as select app.notify_tick('2026-12-06 03:20+00', false, (select tenant_a from fx)) as summary;
select ok(
  (select (s.summary ->> 'reconciled')::integer = 1 and (s.summary ->> 'imported')::integer = 0 and (s.summary ->> 'channel_failed')::integer = 0
     and jsonb_typeof(s.summary -> 'due_digests') = 'number'
   from r11 s),
  'the tick reconciles before it imports, so the recovered store''s old reading opens nothing'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.state = 'open'),
  0,
  'no episode is left open'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(app.notify_tick_rules('2026-12-06 03:25+00', (select tenant_a from fx))) k),
  array['channel_failed', 'due_digests', 'imported', 'reconciled'],
  'the second form of the rules hook returns four counts'
);
select ok(app.facts_are_count_only((select summary from r11)), 'the tick summary is count-only');

select pg_temp.reset();
select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-12-07 01:00+00', '2026-12-07 01:01+00');
select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-12-07 01:00+00', '2026-12-07 01:01+00');
select pg_temp.run((select store_a1 from fx), 'incremental', 'failed', '2026-12-07 01:30+00');
select pg_temp.run((select store_a2 from fx), 'incremental', 'failed', '2026-12-07 01:30+00');
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a from fx);
create temp table r12 as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a from fx), (select store_a1 from fx), null,
  '{}'::jsonb, '2026-12-07 01:31+00', 'incremental');
select is((select outcome || ':' || messages from r12), 'opened:4', 'A3: the one auth_failed transition opens one episode with one message per destination');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, minutes)
select tenant_a, store_a1, 'sync_stale', '2026-12-07 03:01+00'::timestamptz, '2026-12-07 03:01+00'::timestamptz, 1, 120 from fx
union all
select tenant_a, store_a2, 'sync_stale', '2026-12-07 03:01+00', '2026-12-07 03:01+00', 1, 120 from fx;
select is(app.import_sync_alerts('2026-12-07 03:01+00', (select tenant_a from fx)), 2, 'A3: the switch''s stale rows of both stores are imported at +2 hours');
update app.sync_alerts a set last_seen_at = '2026-12-07 04:01+00', minutes = 180, occurrences = 3 where a.tenant_id = (select tenant_a from fx);
select is(app.import_sync_alerts('2026-12-07 04:01+00', (select tenant_a from fx)), 2, 'A3: and again at +3 hours');
select is(
  (select r.outcome from app.record_runner_notification('run_failed', 'warning', (select tenant_a from fx), (select account_a from fx), null,
    pg_temp.run((select store_a1 from fx), 'nightly', 'failed', '2026-12-07 20:23+00'), '{"kind": "nightly", "connector_calls": 1}'::jsonb, '2026-12-07 20:25+00', 'cli') r),
  'folded',
  'A3: a failed nightly of the account folds under auth_failed'
);
select is(
  (select r.outcome from app.record_job_event('sync', 'failure', 10, 1, '2026-12-07 20:20+00', '2026-12-07 20:40+00', (select tenant_a from fx)) r),
  'root_cause_open',
  'A3: the failed Sync workflow records root_cause_open'
);
select ok(
  (select e.state = 'open' and e.folded_occurrences >= 2 from public.alert_events e where e.id = (select event_id from r12)),
  'A3: one open auth_failed episode carries the folded readings'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.state = 'open'),
  1,
  'A3: no other episode is open'
);
select is(
  (select array_agg(distinct o.alert_event_id) from public.outbound_messages o where o.tenant_id = (select tenant_a from fx) and o.kind is not null),
  array[(select event_id from r12)],
  'A3: every queued message belongs to the one auth_failed episode'
);

create function pg_temp.deliver_resolution(p_event uuid, p_label text, p_at timestamptz)
returns void
language sql
as $$
  update public.outbound_messages o
  set status = 'sending', claimed_at = p_at, lease_until = p_at + interval '2 minutes', attempts = 1
  where o.alert_event_id = p_event and o.channel_id = pg_temp.ch(p_label) and o.kind = 'alert_resolved';
  update public.outbound_messages o
  set status = 'sent', sent_at = p_at, lease_until = null
  where o.alert_event_id = p_event and o.channel_id = pg_temp.ch(p_label) and o.kind = 'alert_resolved';
$$;

select pg_temp.reset();
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a from fx);
create temp table r13a as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a from fx), null, null,
  '{}'::jsonb, '2026-12-08 03:00+00', 'incremental');
select pg_temp.deliver((select event_id from r13a), 'd1', '2026-12-08 03:01+00');
update public.pos_accounts a set status = 'active' where a.id = (select account_a from fx);
select is(app.reconcile_alerts('2026-12-08 08:05+00', (select tenant_a from fx)), 1, 'the fixed login resolves auth_failed during the business day');
select pg_temp.deliver_resolution((select event_id from r13a), 'd1', '2026-12-08 08:06+00');
select is(
  (select array_agg(r.outcome || ':' || r.messages order by s.store_id)
   from fx
   cross join lateral (values (fx.store_a1), (fx.store_a2)) as s (store_id)
   cross join lateral app.record_runner_notification('sync_stale', 'critical', fx.tenant_a, null, s.store_id, null,
     '{"scope": "previous_day", "business_date": "2026-12-08", "minutes_without_sync": 300}'::jsonb, '2026-12-08 20:23+00', 'cli') r),
  array['covered:0', 'covered:0'],
  'the nightly''s previous-day readings for a day the account''s auth_failed episode overlapped are covered for each of its stores'
);
select ok(
  not exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'sync_stale')
  and (select array_agg(o.kind || ':' || o.status order by o.created_at, o.kind)
       from public.outbound_messages o
       where o.tenant_id = (select tenant_a from fx) and o.channel_id = pg_temp.ch('d1')) = array['alert:sent', 'alert_resolved:sent'],
  'after a fixed credential failure the owner hears the alert and the recovery, and no stale-store alert for the same outage'
);
select is(
  (select r.outcome from app.record_runner_notification('sync_stale', 'critical', (select tenant_a from fx), null, (select store_a1 from fx), null,
    '{"scope": "previous_day", "business_date": "2026-12-09", "minutes_without_sync": 300}'::jsonb, '2026-12-09 20:23+00', 'cli') r),
  'opened',
  'a previous-day reading for a later day the auth_failed episode did not overlap still alerts'
);

select pg_temp.reset();
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r14a as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a2 from fx), null, null,
  '{}'::jsonb, '2026-12-09 03:00+00', 'incremental');
select pg_temp.deliver((select event_id from r14a), 'd1', '2026-12-09 03:01+00');
update public.pos_accounts a set status = 'active' where a.id = (select account_a2 from fx);
select app.reconcile_alerts('2026-12-09 03:20+00', (select tenant_a from fx));
select pg_temp.deliver_resolution((select event_id from r14a), 'd1', '2026-12-09 03:21+00');
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r14b as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a2 from fx), null, null,
  '{}'::jsonb, '2026-12-09 03:40+00', 'incremental');
select is((select outcome || ':' || messages from r14b), 'opened:2', 'a credential failure inside the cool-down after a delivered recovery notice alerts again');
select ok(
  (select e.suppressed_reason is null and e.last_notified_at = '2026-12-09 03:40+00' and e.notifications = 2
   from public.alert_events e where e.id = (select event_id from r14b)),
  'the reopened episode records its own notice instead of inheriting the cool-down'
);
select pg_temp.deliver((select event_id from r14b), 'd1', '2026-12-09 03:41+00');
update public.pos_accounts a set status = 'active' where a.id = (select account_a2 from fx);
select app.reconcile_alerts('2026-12-09 03:50+00', (select tenant_a from fx));
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r14c as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a2 from fx), null, null,
  '{}'::jsonb, '2026-12-09 04:00+00', 'incremental');
select is((select outcome || ':' || messages from r14c), 'opened:2', 'a recovery notice still waiting to be sent lifts the cool-down too, since it will reach the owner');
update public.pos_accounts a set status = 'active' where a.id = (select account_a2 from fx);
select app.reconcile_alerts('2026-12-09 04:10+00', (select tenant_a from fx));
select is(pg_temp.recipients((select event_id from r14c), 'alert_resolved'), '{}'::text[], 'an episode whose alert was never delivered sends no recovery notice');
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r14d as
select * from app.record_runner_notification('auth_failed', 'critical', (select tenant_a from fx), (select account_a2 from fx), null, null,
  '{}'::jsonb, '2026-12-09 04:20+00', 'incremental');
select is((select outcome || ':' || messages from r14d), 'opened:0', 'without a recovery notice since the last alert the cool-down still keeps a reopening silent');
select is((select e.suppressed_reason from public.alert_events e where e.id = (select event_id from r14d)), 'cool_down', 'that silent episode is marked cool_down');

select pg_temp.reset();
update public.pos_accounts a set status = 'auth_failed' where a.id = (select account_a2 from fx);
create temp table r15a as
select * from app.raise_alert((select tenant_a from fx), 'auth_failed', 'account:' || (select account_a2 from fx), 'incremental', '2026-12-10 03:00+00',
  null, (select account_a2 from fx));
select pg_temp.deliver((select event_id from r15a), 'd1', '2026-12-10 03:01+00');
update public.pos_accounts a set status = 'paused' where a.id = (select account_a2 from fx);
select is(app.reconcile_alerts('2026-12-10 03:10+00', (select tenant_a from fx)), 1, 'pausing the account instead of fixing its login ends auth_failed');
select ok(
  (select e.resolution = 'superseded' from public.alert_events e where e.id = (select event_id from r15a))
  and pg_temp.recipients((select event_id from r15a), 'alert_resolved') = '{}'::text[],
  'a paused account ends auth_failed as superseded and sends no recovery notice'
);
update public.pos_accounts a set status = 'active' where a.id = (select account_a2 from fx);

select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-12-10 01:00+00', '2026-12-10 01:01+00');
select pg_temp.run((select store_a2 from fx), 'incremental', 'succeeded', '2026-12-10 01:00+00', '2026-12-10 01:01+00');
create temp table r15b as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'incremental', '2026-12-10 03:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 119}'::jsonb);
select pg_temp.deliver((select event_id from r15b), 'd1', '2026-12-10 03:01+00');
update public.stores s set settings = '{"incremental_sync": false}'::jsonb where s.id = (select store_a1 from fx);
select is(app.reconcile_alerts('2026-12-10 03:10+00', (select tenant_a from fx)), 1, 'opting the store out of the incremental sync ends its sync_stale');
select ok(
  (select e.resolution = 'superseded' from public.alert_events e where e.id = (select event_id from r15b))
  and pg_temp.recipients((select event_id from r15b), 'alert_resolved') = '{}'::text[],
  'a store the sync no longer watches ends sync_stale as superseded and sends no recovery notice'
);
update public.stores s set settings = '{}'::jsonb where s.id = (select store_a1 from fx);
create temp table r15c as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a2 from fx), 'incremental', '2026-12-10 03:00+00',
  (select store_a2 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 119}'::jsonb);
select pg_temp.deliver((select event_id from r15c), 'd1', '2026-12-10 03:01+00');
update public.pos_accounts a set status = 'paused' where a.id = (select account_a from fx);
select is(app.reconcile_alerts('2026-12-10 03:20+00', (select tenant_a from fx)), 1, 'pausing the store''s POS account ends its sync_stale');
select ok(
  (select e.resolution = 'superseded' from public.alert_events e where e.id = (select event_id from r15c))
  and pg_temp.recipients((select event_id from r15c), 'alert_resolved') = '{}'::text[],
  'a paused account''s stale store is superseded without a recovery notice'
);
update public.pos_accounts a set status = 'active' where a.id = (select account_a from fx);

select pg_temp.reset();
select pg_temp.run((select store_a1 from fx), 'incremental', 'succeeded', '2026-12-11 01:00+00', '2026-12-11 01:01+00');
create temp table r15d as
select * from app.raise_alert((select tenant_a from fx), 'sync_stale', 'store:' || (select store_a1 from fx), 'incremental', '2026-12-11 03:00+00',
  (select store_a1 from fx), (select account_a from fx), null, null, '{"minutes_without_sync": 119}'::jsonb);
select pg_temp.deliver((select event_id from r15d), 'd1', '2026-12-11 03:01+00');
update public.stores s set sync_resumed_at = '2026-12-11 03:05+00' where s.id = (select store_a1 from fx);
select is(app.reconcile_alerts('2026-12-11 03:10+00', (select tenant_a from fx)), 1, 'a watch that restarted inside the threshold ends the stale episode');
select ok(
  (select e.resolution = 'superseded' from public.alert_events e where e.id = (select event_id from r15d))
  and pg_temp.recipients((select event_id from r15d), 'alert_resolved') = '{}'::text[],
  'without a successful sync since the opening the episode is superseded, never announced as recovered'
);
update public.stores s set sync_resumed_at = null where s.id = (select store_a1 from fx);

select * from finish();
rollback;
