begin;
select plan(74);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000182000001'::uuid as tenant_a,
  'ffffffff-ffff-4fff-8fff-000182000002'::uuid as tenant_b,
  'ffffffff-ffff-4fff-8fff-000182000101'::uuid as owner_a,
  'ffffffff-ffff-4fff-8fff-000182000102'::uuid as manager_a,
  'ffffffff-ffff-4fff-8fff-000182000103'::uuid as store_manager_a,
  'ffffffff-ffff-4fff-8fff-000182000104'::uuid as staff_a,
  'ffffffff-ffff-4fff-8fff-000182000105'::uuid as viewer_a,
  'ffffffff-ffff-4fff-8fff-000182000106'::uuid as publisher_a,
  'ffffffff-ffff-4fff-8fff-000182000107'::uuid as owner_b,
  'ffffffff-ffff-4fff-8fff-000182000201'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000182000202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000182000301'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000182000302'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000182000303'::uuid as store_b1;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'web-owner-a@example.com'),
    (fx.manager_a, 'web-manager-a@example.com'),
    (fx.store_manager_a, 'web-store-manager-a@example.com'),
    (fx.staff_a, 'web-staff-a@example.com'),
    (fx.viewer_a, 'web-viewer-a@example.com'),
    (fx.publisher_a, 'web-publisher-a@example.com'),
    (fx.owner_b, 'web-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_a, 'notify-it-pgtap-web-a', 'Notify pgTAP web A' from fx
union all
select tenant_b, 'notify-it-pgtap-web-b', 'Notify pgTAP web B' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'web-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'web-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'web-pgtap-store-a1', 'Synthetic store A1' from fx
union all
select store_a2, tenant_a, account_a, 'web-pgtap-store-a2', 'Synthetic store A2' from fx
union all
select store_b1, tenant_b, account_b, 'web-pgtap-store-b1', 'Synthetic store B1' from fx;

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

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, address_hint, secret_name, status, linked_at, consent_record_id)
select fx.tenant_a, 'zalo_bot', 'zalo_bot', m.label, m.user_id, 'synthetic-chat-182-' || m.label, '…' || m.label, 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', '2026-11-01 00:00+00',
  app.ensure_notifications_consent(fx.tenant_a, m.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00')
from fx
cross join lateral (values (fx.owner_a, 'own'), (fx.manager_a, 'mgr'), (fx.store_manager_a, 'smg')) as m (user_id, label);

create temp table dest as
select c.label as key, c.id from public.notification_channels c where c.tenant_id = (select tenant_a from fx);

insert into public.alert_rules (tenant_id, store_id, rule_key, params, enabled)
select tenant_a, null::uuid, 'revenue_below_baseline', '{"ratio": 0.6}'::jsonb, null::boolean from fx
union all
select tenant_a, store_a2, 'revenue_below_baseline', '{"ratio": 0.5}'::jsonb, false from fx;

insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, requires_consent, consent_purpose, source_note)
select tenant_a, 'zalo_bot', 'operational', true, '07:00', '21:00', 20, true, 'notifications', 'synthetic tenant override' from fx;

grant select on fx, dest to authenticated, anon;

create function pg_temp.member(p_user uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object('sub', p_user, 'role', 'authenticated');
$$;

create function pg_temp.outcome_as(p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
  execute p_statement into v_value;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_value, 'null');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.as_user(p_user uuid, p_statement text)
returns text
language sql
as $$
  select pg_temp.outcome_as(pg_temp.member(p_user), p_statement);
$$;

select ok(
  bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute')),
  'every web function is executable by authenticated only'
)
from unnest(array[
  'public.notify_overview(uuid)',
  'public.start_channel_link(uuid, public.channel_kind, text)',
  'public.update_destination(uuid, boolean, text, uuid[], boolean, text[], text)',
  'public.remove_destination(uuid)',
  'public.send_test_message(uuid)',
  'public.notify_message_status(uuid)',
  'public.resend_message(uuid)',
  'public.effective_alert_rules(uuid, uuid)',
  'public.effective_channel_policies(uuid)'
]) as f;
select ok(
  bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute')),
  'the app helpers behind them are executable by no API role'
)
from unnest(array[
  'app.notification_web_member(uuid)',
  'app.email_hint(text)',
  'app.notification_destination_for_caller(uuid, boolean)',
  'app.next_resend_number(uuid, text)'
]) as f;
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('notify_overview', 'start_channel_link', 'update_destination', 'remove_destination', 'send_test_message', 'resend_message', 'effective_alert_rules', 'effective_channel_policies')),
  8,
  'each function has one signature'
);

select is(pg_temp.as_user((select owner_a from fx), format('select jsonb_array_length(public.notify_overview(%L) -> ''destinations'')::text', (select tenant_a from fx))), '3', 'notify_overview: an owner sees the tenant''s three destinations');
select is(pg_temp.as_user((select owner_a from fx), format('select count(*)::text from jsonb_array_elements(public.notify_overview(%L) -> ''destinations'') d where d ->> ''member_email'' is not null', (select tenant_a from fx))), '3', 'notify_overview: an unlimited owner sees each member''s login e-mail');
select is(pg_temp.as_user((select manager_a from fx), format('select jsonb_array_length(public.notify_overview(%L) -> ''destinations'')::text', (select tenant_a from fx))), '3', 'notify_overview: an unlimited manager sees the tenant''s destinations');
select is(pg_temp.as_user((select manager_a from fx), format('select count(*)::text from jsonb_array_elements(public.notify_overview(%L) -> ''destinations'') d where d ->> ''member_email'' is not null', (select tenant_a from fx))), '0', 'notify_overview: a manager never sees an e-mail');
select is(pg_temp.as_user((select manager_a from fx), format('select jsonb_array_length(public.notify_overview(%L) -> ''dispatcher_secrets'')::text', (select tenant_a from fx))), '0', 'notify_overview: a manager sees no secret names');
select is(pg_temp.as_user((select store_manager_a from fx), format('select string_agg(d ->> ''label'', '','') from jsonb_array_elements(public.notify_overview(%L) -> ''destinations'') d', (select tenant_a from fx))), 'smg', 'notify_overview: a store-limited manager sees only their own destination');
select is(pg_temp.as_user((select staff_a from fx), format('select jsonb_array_length(public.notify_overview(%L) -> ''destinations'')::text', (select tenant_a from fx))), '0', 'notify_overview: staff without a destination see none');
select is(pg_temp.as_user((select viewer_a from fx), format('select (public.notify_overview(%L) ->> ''zalo_bot_quota'')', (select tenant_a from fx))), '3000', 'notify_overview: a viewer reads the overview with the Basic plan quota');
select is(pg_temp.as_user((select publisher_a from fx), format('select public.notify_overview(%L)::text', (select tenant_a from fx))), 'error:42501', 'notify_overview: a publisher is refused');
select is(pg_temp.as_user((select owner_b from fx), format('select public.notify_overview(%L)::text', (select tenant_a from fx))), 'error:42501', 'notify_overview: a member of another tenant is refused');
select is(pg_temp.outcome_as('{"role": "anon"}'::jsonb, format('select public.notify_overview(%L)::text', (select tenant_a from fx))), 'error:42501', 'notify_overview: a caller who is not signed in is refused');
select is(pg_temp.as_user((select owner_a from fx), 'select public.notify_overview(null)::text'), 'error:22023', 'notify_overview: no tenant is bad input');
select is(
  pg_temp.as_user((select owner_a from fx), format($q$select (t ~ 'synthetic-chat|NOTIFY_ZALO|"address"|"config"|"secret_name"')::text from (select public.notify_overview(%L)::text as t) x$q$, (select tenant_a from fx))),
  'false',
  'security: the overview holds no address, destination secret name or configuration'
);

select is(pg_temp.as_user((select staff_a from fx), format('select public.start_channel_link(%L, ''email'') ->> ''status''', (select tenant_a from fx))), 'active', 'start_channel_link: an e-mail link activates at once');
select is(
  (select count(*)::text || ':' || min(c.evidence ->> 'method') from public.consent_records c where c.tenant_id = (select tenant_a from fx) and c.subject_id = (select staff_a from fx) and c.purpose = 'notifications' and c.revoked_at is null),
  '1:web_session',
  'start_channel_link: the e-mail link records exactly one notifications consent with method web_session'
);
select is(
  (select address_hint || '|' || coalesce(address, 'null') from public.notification_channels where tenant_id = (select tenant_a from fx) and user_id = (select staff_a from fx) and kind = 'email'),
  'w…@example.com|null',
  'the e-mail destination keeps a hint only and sends to the login address'
);
select is(pg_temp.as_user((select viewer_a from fx), format('select (public.start_channel_link(%L, ''zalo_bot'') ->> ''link_code'') ~ ''^FNB-[A-Z0-9]{8}$''', (select tenant_a from fx))), 'true', 'start_channel_link: a bot link returns a code once');
select is(
  (select status from public.notification_channels where tenant_id = (select tenant_a from fx) and user_id = (select viewer_a from fx) and kind = 'zalo_bot'),
  'pending',
  'the bot destination stays pending until the member''s own acceptance'
);
select is(
  (select count(*)::integer from public.consent_records where tenant_id = (select tenant_a from fx) and subject_id = (select viewer_a from fx) and purpose = 'notifications'),
  0,
  'a bot link records no consent before the member''s acceptance'
);
select is(
  (select count(*)::integer from app.notification_link_codes l join public.notification_channels c on c.id = l.channel_id where c.user_id = (select viewer_a from fx) and l.code_sha256 ~ '^[0-9a-f]{64}$'),
  1,
  'the code is kept only as a hash'
);
select is(pg_temp.as_user((select owner_a from fx), format('select public.start_channel_link(%L, ''webhook'')::text', (select tenant_a from fx))), 'error:22023', 'start_channel_link: the browser never creates a webhook');
select is(pg_temp.as_user((select owner_a from fx), format('select public.start_channel_link(%L, ''zalo_bot'')::text', (select tenant_a from fx))), 'error:23505', 'start_channel_link: a linked chat is not linked twice');
select is(pg_temp.as_user((select publisher_a from fx), format('select public.start_channel_link(%L, ''email'')::text', (select tenant_a from fx))), 'error:42501', 'start_channel_link: a publisher is refused');
select is(pg_temp.as_user((select viewer_a from fx), format('select public.start_channel_link(%L, ''zalo_bot'', repeat(''x'', 61))::text', (select tenant_a from fx))), 'error:22023', 'boundary: a 61-character label is refused');
select is(
  (select string_agg(pg_temp.as_user((select viewer_a from fx), format('select public.start_channel_link(%L, ''zalo_bot'') ->> ''status''', (select tenant_a from fx))), ',' order by n) from generate_series(1, 4) n),
  'pending,pending,pending,pending',
  'the second to fifth link of the hour are accepted'
);
select is(pg_temp.as_user((select viewer_a from fx), format('select public.start_channel_link(%L, ''zalo_bot'')::text', (select tenant_a from fx))), 'error:22023', 'boundary: the sixth link inside an hour is refused');

select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_store_ids => array[%L]::uuid[]) ->> ''store_ids''', (select id from dest where key = 'smg'), (select store_a1 from fx))), format('["%s"]', (select store_a1 from fx)), 'update_destination: a member narrows within their own stores');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_store_ids => array[%L]::uuid[])::text', (select id from dest where key = 'smg'), (select store_a2 from fx))), 'error:22023', 'update_destination: a store outside the member''s scope is refused');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_store_ids => array[%L]::uuid[])::text', (select id from dest where key = 'smg'), (select store_b1 from fx))), 'error:22023', 'update_destination: a store of another tenant is refused');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_muted_rules => array[''not_a_rule''])::text', (select id from dest where key = 'smg'))), 'error:22023', 'update_destination: a muted key outside the catalogue is refused');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_muted_rules => array[''daily_digest'', ''daily_digest''])  ->> ''muted_rules''', (select id from dest where key = 'smg'))), '["daily_digest"]', 'update_destination: muted rules are stored once each');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_timezone => ''Mars/Base'')::text', (select id from dest where key = 'smg'))), 'error:22023', 'update_destination: a zone that is not IANA is refused');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_timezone => ''Asia/Bangkok'', p_label => ''Ca sáng'') ->> ''timezone''', (select id from dest where key = 'smg'))), 'Asia/Bangkok', 'update_destination: an IANA zone and a label are saved');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.update_destination(%L, p_label => '' '')::text', (select id from dest where key = 'smg'))), 'error:22023', 'update_destination: an empty label is refused');
select is(pg_temp.as_user((select manager_a from fx), format('select public.update_destination(%L, p_enabled => false)::text', (select id from dest where key = 'own'))), 'error:42501', 'update_destination: a manager cannot change the owner''s destination');
select is(pg_temp.as_user((select staff_a from fx), format('select public.update_destination(%L, p_enabled => false)::text', (select id from dest where key = 'own'))), 'error:42501', 'update_destination: staff cannot change another member''s destination');
select is(pg_temp.as_user((select owner_a from fx), format('select public.update_destination(%L, p_enabled => false) ->> ''enabled''', (select id from dest where key = 'mgr'))), 'false', 'update_destination: an unlimited owner changes any destination');
select is(pg_temp.as_user((select owner_b from fx), format('select public.update_destination(%L, p_enabled => true)::text', (select id from dest where key = 'mgr'))), 'error:42501', 'update_destination: an owner of another tenant is refused');
select is(pg_temp.as_user((select owner_a from fx), format('select public.update_destination(%L, p_enabled => true) ->> ''enabled''', (select id from dest where key = 'mgr'))), 'true', 'update_destination: enabled again');

select ok(pg_temp.as_user((select owner_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'own'))) ~ '^[0-9a-f-]{36}$', 'send_test_message: the member queues a test');
select is(
  (select kind || ':' || status || ':' || coalesce(app.facts_are_count_only(params)::text, 'null') from public.outbound_messages where channel_id = (select id from dest where key = 'own') and kind = 'test'),
  'test:queued:true',
  'the test is one queued test message with count-only parameters'
);
select is(pg_temp.as_user((select owner_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'own'))), 'error:22023', 'boundary: a second test inside a minute is refused');
select ok(pg_temp.as_user((select manager_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'smg'))) ~ '^[0-9a-f-]{36}$', 'send_test_message: an unlimited manager tests another member''s destination');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'mgr'))), 'error:42501', 'send_test_message: a store-limited manager cannot test another member''s destination');
select is(pg_temp.as_user((select staff_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'own'))), 'error:42501', 'send_test_message: staff cannot test another member''s destination');
select is(
  pg_temp.as_user((select viewer_a from fx), format('select public.send_test_message(%L)::text', (select id from public.notification_channels where user_id = (select viewer_a from fx) and kind = 'zalo_bot'))),
  'error:22023',
  'send_test_message: a pending destination gets no test'
);
delete from app.notification_test_sends where channel_id = (select id from dest where key = 'mgr');
insert into app.notification_test_sends (channel_id, sent_at)
select (select id from dest where key = 'mgr'), now() - make_interval(mins => n * 10) from generate_series(1, 4) n;
select ok(pg_temp.as_user((select manager_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'mgr'))) ~ '^[0-9a-f-]{36}$', 'boundary: the fifth test of the hour is accepted');
update app.notification_test_sends set sent_at = sent_at - interval '2 minutes' where channel_id = (select id from dest where key = 'mgr');
select is(pg_temp.as_user((select manager_a from fx), format('select public.send_test_message(%L)::text', (select id from dest where key = 'mgr'))), 'error:22023', 'boundary: the sixth test of the hour is refused');
select is(
  pg_temp.as_user((select owner_a from fx), format('select public.notify_message_status((select id from public.outbound_messages where channel_id = %L and kind = ''test'' limit 1)) ->> ''status''', (select id from dest where key = 'own'))),
  'queued',
  'notify_message_status: the owner reads the test''s status'
);

create temp table original as
select app.enqueue_message((select tenant_a from fx), (select id from dest where key = 'own'), 'alert', 'alert.sync_failed.v1', 'alert:web-pgtap-1', '{"occurrences": 1}'::jsonb,
  'Cảnh báo', 'Văn bản thử', 'warning'::public.alert_severity, null, null, null, null, null, now()) as id;
update public.outbound_messages set status = 'sending', claimed_at = now(), lease_until = now() + interval '1 minute', send_started_at = now() where id = (select id from original);
update public.outbound_messages set status = 'uncertain' where id = (select id from original);
grant select on original to authenticated, anon;

select is(pg_temp.as_user((select staff_a from fx), format('select public.resend_message(%L)::text', (select id from original))), 'error:42501', 'resend_message: staff are refused');
select is(pg_temp.as_user((select store_manager_a from fx), format('select public.resend_message(%L)::text', (select id from original))), 'error:42501', 'resend_message: a store-limited manager is refused');
select is(pg_temp.as_user((select owner_b from fx), format('select public.resend_message(%L)::text', (select id from original))), 'error:42501', 'resend_message: an owner of another tenant is refused');
select ok(pg_temp.as_user((select owner_a from fx), format('select public.resend_message(%L)::text', (select id from original))) ~ '^[0-9a-f-]{36}$', 'resend_message: an owner resends an uncertain alert');
select ok(pg_temp.as_user((select manager_a from fx), format('select public.resend_message(%L)::text', (select id from original))) ~ '^[0-9a-f-]{36}$', 'resend_message: an unlimited manager resends it again');
select is(
  (select string_agg(dedupe_key || '>' || (resend_of = (select id from original))::text, ',' order by dedupe_key) from public.outbound_messages where resend_of is not null and tenant_id = (select tenant_a from fx)),
  'alert:web-pgtap-1:resend:1>true,alert:web-pgtap-1:resend:2>true',
  'the copies are numbered :resend:1 and :resend:2 and point at the original'
);
select is((select status from public.outbound_messages where id = (select id from original)), 'uncertain', 'the original stays as evidence');
select is(
  pg_temp.as_user((select owner_a from fx), format('select public.resend_message((select id from public.outbound_messages where resend_of = %L order by dedupe_key limit 1))::text', (select id from original))),
  'error:22023',
  'resend_message: a queued message is refused'
);
select is(
  pg_temp.as_user((select owner_a from fx), format('select public.resend_message((select id from public.outbound_messages where channel_id = %L and kind = ''test'' limit 1))::text', (select id from dest where key = 'own'))),
  'error:22023',
  'resend_message: a test message is refused'
);
select is(
  (select app.next_resend_number((select tenant_a from fx), 'alert:web-pgtap-2') || ',' || app.next_resend_number((select tenant_a from fx), 'alert:web-pgtap-2')),
  '1,2',
  'next_resend_number: two calls in one transaction get different numbers'
);
select throws_ok($$ select app.next_resend_number((select tenant_a from fx), 'alert:x:resend:1') $$, '22023', null, 'next_resend_number refuses a key that already carries a suffix');

select is(pg_temp.as_user((select store_manager_a from fx), format('select public.remove_destination(%L)::text', (select id from dest where key = 'smg'))), '1', 'remove_destination: the member removes their own destination and its open test is cancelled');
select is(
  (select count(*)::integer from public.consent_records where tenant_id = (select tenant_a from fx) and subject_id = (select store_manager_a from fx) and purpose = 'notifications' and revoked_at is null),
  1,
  'remove_destination leaves the consent untouched'
);
select is(pg_temp.as_user((select manager_a from fx), format('select public.remove_destination(%L)::text', (select id from dest where key = 'own'))), 'error:42501', 'remove_destination: a manager cannot remove the owner''s destination');

select is(pg_temp.as_user((select manager_a from fx), format('select public.stop_my_notifications(%L)::text', (select tenant_a from fx))) ~ '^[0-9]+$', true, 'stop_my_notifications: the member stops everything');
select is(
  (select string_agg(status || ':' || disabled_reason, ',') from public.notification_channels where user_id = (select manager_a from fx)),
  'disabled:consent_withdrawn',
  'every destination of the member is disabled as consent_withdrawn'
);
select is(
  (select count(*)::integer from public.consent_records where tenant_id = (select tenant_a from fx) and subject_id = (select manager_a from fx) and purpose = 'notifications' and revoked_at is null),
  0,
  'the member''s consent is revoked'
);

set local role authenticated;
do $do$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_a from fx), 'role', 'authenticated')::text, true);
  perform set_config('fnb_test.owner_rules', (select jsonb_agg(to_jsonb(r) order by r.rule_key)::text from public.effective_alert_rules((select tenant_a from fx), (select store_a2 from fx)) r), true);
  perform set_config('fnb_test.owner_policies', (select jsonb_agg(to_jsonb(p) order by p.channel_kind, p.message_class)::text from public.effective_channel_policies((select tenant_a from fx)) p), true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select store_manager_a from fx), 'role', 'authenticated')::text, true);
  perform set_config('fnb_test.limited_a1', (select r.source from public.effective_alert_rules((select tenant_a from fx), (select store_a1 from fx)) r where r.rule_key = 'revenue_below_baseline'), true);
  perform set_config('fnb_test.limited_a2', (select r.source || ':' || r.enabled from public.effective_alert_rules((select tenant_a from fx), (select store_a2 from fx)) r where r.rule_key = 'revenue_below_baseline'), true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select staff_a from fx), 'role', 'authenticated')::text, true);
  perform set_config('fnb_test.staff_sources', (select string_agg(distinct r.source, ',') from public.effective_alert_rules((select tenant_a from fx), null) r), true);
  perform set_config('fnb_test.staff_policy', (select p.source from public.effective_channel_policies((select tenant_a from fx)) p where p.channel_kind = 'zalo_bot' and p.message_class = 'operational'), true);
end
$do$;
reset role;

select is(
  (select count(*)::integer
   from jsonb_array_elements(current_setting('fnb_test.owner_rules')::jsonb) w
   join lateral app.effective_alert_rule((select tenant_a from fx), (select store_a2 from fx), w ->> 'rule_key') e on true
   where (w ->> 'enabled')::boolean is distinct from e.enabled
      or (w ->> 'severity') is distinct from e.severity::text
      or (w -> 'params') is distinct from e.params
      or (w ->> 'cooldown')::interval is distinct from e.cooldown
      or (w ->> 'source') is distinct from case e.source when 'default' then 'catalogue' else e.source end),
  0,
  'effective_alert_rules as the owner equals app.effective_alert_rule for every rule'
);
select is(jsonb_array_length(current_setting('fnb_test.owner_rules')::jsonb), (select count(*)::integer from public.alert_rule_catalog), 'effective_alert_rules lists every catalogue rule');
select is(
  (select count(*)::integer
   from jsonb_array_elements(current_setting('fnb_test.owner_policies')::jsonb) w
   join lateral app.effective_channel_policy((select tenant_a from fx), (w ->> 'channel_kind')::public.channel_kind, (w ->> 'message_class')::public.message_class) e on true
   where (w ->> 'policy_id')::uuid is distinct from e.id
      or (w ->> 'allowed')::boolean is distinct from e.allowed
      or (w ->> 'max_per_day')::integer is distinct from e.max_per_day),
  0,
  'effective_channel_policies as the owner equals app.effective_channel_policy for every pair'
);
select is(current_setting('fnb_test.limited_a1') || '|' || current_setting('fnb_test.limited_a2'), 'tenant|tenant:true', 'a store-limited manager sees the tenant row and no override of a store outside their scope');
select is(current_setting('fnb_test.staff_sources') || '|' || current_setting('fnb_test.staff_policy'), 'catalogue|global', 'staff see only the catalogue and the global policies, as RLS allows');

select * from finish();
rollback;
