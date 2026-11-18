begin;
select plan(87);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000005002'::uuid as tenant_b,
  'eeeeeeee-eeee-4eee-8eee-000000005001'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000005002'::uuid as owner_b,
  'cccccccc-cccc-4ccc-8ccc-000000005001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000005002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000005001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000005002'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005001'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005002'::uuid as brand_a2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005003'::uuid as brand_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005021'::uuid as oa_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005023'::uuid as oa_b,
  '88888888-8888-4888-8888-000000005001'::uuid as bot_dest_a,
  repeat('a', 64) as state_1,
  repeat('b', 64) as state_2,
  repeat('c', 64) as state_3,
  repeat('d', 64) as state_4,
  rpad('verifier-', 43, 'v') as verifier_1,
  rpad('verifier-', 43, 'w') as verifier_2,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date as local_today;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values (fx.owner_a, 'zalo-tokens-owner-a@example.com'), (fx.owner_b, 'zalo-tokens-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_a, 'zalo-it-pgtap-tokens-a', 'Zalo tokens pgTAP A', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_b, 'zalo-it-pgtap-tokens-b', 'Zalo tokens pgTAP B', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'zalo-tokens-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'zalo-tokens-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'zalo-tokens-store-a1', 'Synthetic store A1' from fx
union all
select store_b1, tenant_b, account_b, 'zalo-tokens-store-b1', 'Synthetic store B1' from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx
union all
select brand_a2, tenant_a, 'brand-2', 'Synthetic brand A2', array[store_a1] from fx
union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;

insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
select tenant_a, brand_a, 'synthetic-tokens-app-a', 'ZALO_APP_SECRET_BRAND_1' from fx
union all
select tenant_a, brand_a2, 'synthetic-tokens-app-a2', 'ZALO_APP_SECRET_BRAND_2' from fx
union all
select tenant_b, brand_b, 'synthetic-tokens-app-b', 'ZALO_APP_SECRET_BRAND_1' from fx;

insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-tokens-oa-a', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_b, tenant_b, brand_b, 'synthetic-tokens-oa-b', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;

select app.ensure_notifications_consent(tenant_a, owner_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, now() - interval '30 days') from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
select bot_dest_a, tenant_a, 'zalo_bot', 'zalo_bot', 'owner bot', owner_a, 'synthetic-chat-5001', 'NOTIFY_ZALO_BOT_TOKEN_IT50', 'active', now() - interval '30 days'
from fx;

delete from app.zalo_oauth_pending where tenant_id in (select tenant_a from fx union all select tenant_b from fx);

select is(
  (
    select count(*)::integer
    from (values ('app.zalo_oauth_pending'), ('app.zalo_token_tickets'), ('app.zalo_token_settings')) as t (name)
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role)
    where has_table_privilege(r.role, t.name, 'select')
       or has_table_privilege(r.role, t.name, 'insert')
       or has_table_privilege(r.role, t.name, 'update')
       or has_table_privilege(r.role, t.name, 'delete')
  ),
  0,
  'the pending authorisations, the tickets and the schedule settings are closed to anon, authenticated and service_role'
);

select is(
  (
    select count(*)::integer
    from (values ('anon'), ('authenticated')) as r (role)
    where has_table_privilege(r.role, 'public.zalo_tokens', 'select')
       or has_table_privilege(r.role, 'public.zalo_tokens', 'insert')
       or has_table_privilege(r.role, 'public.zalo_tokens', 'update')
  ),
  0,
  'the token store stays closed to anon and authenticated'
);

select is(
  (
    select count(*)::integer
    from (
      values
        ('app.zalo_token_refresh_after(text)'),
        ('app.zalo_token_targets(text, uuid, text)'),
        ('app.purge_oa_authorizations(timestamptz)'),
        ('app.begin_oa_authorization(uuid, text, text, timestamptz)'),
        ('app.claim_oa_authorization(text, timestamptz)'),
        ('app.save_zalo_tokens(uuid, text, text, timestamptz, text, timestamptz, timestamptz)'),
        ('app.lock_zalo_token(uuid, text, interval, timestamptz)'),
        ('app.store_zalo_token_refresh(uuid, bigint, text, timestamptz, text, timestamptz, timestamptz)'),
        ('app.raise_zalo_token_alert(uuid, text, text, integer, text, timestamptz)'),
        ('app.resolve_zalo_token_alert(uuid, text, timestamptz)'),
        ('app.check_oa_package_expiry(timestamptz, uuid, text)'),
        ('app.zalo_tokens_due(timestamptz)'),
        ('app.dispatch_zalo_tokens(timestamptz)'),
        ('app.claim_zalo_token_ticket(uuid)'),
        ('app.issue_zalo_token_ticket(uuid, text)'),
        ('app.enable_zalo_token_jobs(text, text)'),
        ('app.disable_zalo_token_jobs()')
    ) as f (signature)
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role)
    where has_function_privilege(r.role, f.signature, 'execute')
  ),
  0,
  'no API role may execute a function of the token jobs'
);

select is(
  (select row(category, delivery, default_enabled, default_severity::text, default_roles::text, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped)::text from public.alert_rule_catalog where rule_key = 'zalo_token_failed'),
  row('channel', 'immediate', true, 'critical', '{owner}', '{}'::jsonb, '{}'::jsonb, interval '12 hours', interval '24 hours', true, false)::text,
  'zalo_token_failed is a critical immediate rule for the owner with a 12-hour cool-down, a daily reminder and a recovery notice'
);
select is(
  (select row(category, delivery, default_enabled, default_severity::text, default_roles::text, default_params, default_cooldown, remind_every, notify_on_resolve, store_scoped)::text from public.alert_rule_catalog where rule_key = 'oa_package_expiring'),
  row('channel', 'immediate', true, 'warning', '{owner}', '{"first_notice_days": 30, "last_notice_days": 7}'::jsonb, interval '24 hours', null::interval, false, false)::text,
  'oa_package_expiring warns the owner 30 and 7 days ahead by default'
);
select ok(app.alert_rule_params_valid('oa_package_expiring', '{"first_notice_days": 8, "last_notice_days": 1}'::jsonb), 'the notice days accept their lowest values');
select ok(not app.alert_rule_params_valid('oa_package_expiring', '{"first_notice_days": 7}'::jsonb), 'the first notice comes at least 8 days ahead');
select ok(not app.alert_rule_params_valid('oa_package_expiring', '{"last_notice_days": 31}'::jsonb), 'the last notice comes at most 30 days ahead');
select ok(not app.alert_rule_params_valid('zalo_token_failed', '{"threshold": 1}'::jsonb), 'zalo_token_failed takes no parameter');
select ok(
  (select bool_and(app.alert_rule_params_valid(rule_key, default_params)) from public.alert_rule_catalog where rule_key in ('zalo_token_failed', 'oa_package_expiring')),
  'both defaults pass their own schema'
);

select is(app.zalo_token_refresh_after('oa'), interval '11 hours', 'an OA pair is refreshed once older than 11 hours');
select is(app.zalo_token_refresh_after('developer'), interval '20 hours', 'a developer pair is rotated once older than 20 hours');

select is(
  (select array_agg(t.brand_key || '/' || t.has_token::text order by t.brand_key) from app.zalo_token_targets('oa', (select tenant_a from fx)) t),
  array['brand-1/false'],
  'the OA targets of a tenant are its brands with an OA, none authorised yet'
);
select is(
  (select array_agg(t.brand_key order by t.brand_key) from app.zalo_token_targets('developer', (select tenant_a from fx)) t),
  array['brand-1', 'brand-2'],
  'the developer targets are every brand with an active Zalo App'
);
select is(
  (select count(*)::integer from app.zalo_token_targets('oa', (select tenant_b from fx), 'brand-2')),
  0,
  'the brand key narrows the targets'
);

select is(
  (select row(b.expires_at = now() + interval '10 minutes', b.app_external_id, b.oa_external_id)::text from fx cross join lateral app.begin_oa_authorization(fx.brand_a, fx.state_1, fx.verifier_1, now()) b),
  row(true, 'synthetic-tokens-app-a', 'synthetic-tokens-oa-a')::text,
  'an authorisation starts with a 10-minute expiry and the ids of the permission URL'
);
select is(
  (select row(p.state_sha256, p.code_verifier)::text from app.zalo_oauth_pending p where p.brand_id = (select brand_a from fx)),
  (select row(state_1, verifier_1)::text from fx),
  'the pending row keeps the state hash and the verifier'
);
select ok(exists (select 1 from cron.job where jobname = 'zalo-oauth-purge'), 'the purge job runs while an authorisation waits');
select app.begin_oa_authorization(fx.brand_a, fx.state_2, fx.verifier_2, now()) from fx;
select is(
  (select array_agg(p.state_sha256) from app.zalo_oauth_pending p where p.brand_id = (select brand_a from fx)),
  (select array[state_2] from fx),
  'a new authorisation replaces the brand''s pending one'
);
select throws_ok(
  format('select * from app.begin_oa_authorization(%L, %L, %L)', (select brand_a2 from fx), (select state_3 from fx), (select verifier_1 from fx)),
  '22023', null,
  'a brand without an OA cannot be authorised'
);
select throws_ok(
  format('select * from app.begin_oa_authorization(%L, %L, %L)', (select brand_b from fx), 'not-a-hash', (select verifier_1 from fx)),
  '23514', null,
  'the state is kept only as a SHA-256 hash'
);
select throws_ok(
  format('select * from app.begin_oa_authorization(%L, %L, %L)', (select brand_b from fx), (select state_3 from fx), 'short'),
  '23514', null,
  'a verifier shorter than 43 characters is refused'
);

select is(
  (select c.outcome from fx cross join lateral app.claim_oa_authorization(fx.state_1, now()) c),
  'unknown',
  'the replaced state is refused'
);
select is(
  (select row(c.outcome, c.brand_key, c.code_verifier, c.app_external_id, c.app_secret_name, c.oa_external_id)::text from fx cross join lateral app.claim_oa_authorization(fx.state_2, now()) c),
  (select row('claimed', 'brand-1', verifier_2, 'synthetic-tokens-app-a', 'ZALO_APP_SECRET_BRAND_1', 'synthetic-tokens-oa-a')::text from fx),
  'the right state claims the verifier, the brand, its App secret name and its OA'
);
select is(
  (select c.outcome from fx cross join lateral app.claim_oa_authorization(fx.state_2, now()) c),
  'unknown',
  'a state is claimed once'
);
select app.begin_oa_authorization(fx.brand_b, fx.state_3, fx.verifier_1, now() - interval '11 minutes') from fx;
select is(
  (select c.outcome from fx cross join lateral app.claim_oa_authorization(fx.state_3, now()) c),
  'expired',
  'a state older than 10 minutes is refused'
);
select is(
  (select count(*)::integer from app.zalo_oauth_pending p where p.tenant_id in (select tenant_a from fx union all select tenant_b from fx)),
  0,
  'the expired claim deleted its row'
);

select app.begin_oa_authorization(fx.brand_b, fx.state_4, fx.verifier_1, now() - interval '9 minutes') from fx;
select is(app.purge_oa_authorizations(now()), 0, 'the purge keeps a row younger than 10 minutes');
select is(app.purge_oa_authorizations(now() + interval '1 minute'), 1, 'the purge deletes the row once its 10 minutes are over');
select is(
  (select count(*)::integer from app.zalo_oauth_pending p where p.brand_id = (select brand_b from fx)),
  0,
  'the verifier row is gone after 10 minutes'
);
select ok(
  exists (select 1 from app.zalo_oauth_pending) or not exists (select 1 from cron.job where jobname = 'zalo-oauth-purge'),
  'the purge job removes itself once no authorisation waits'
);

select is(
  app.save_zalo_tokens(fx.brand_a, 'oa', 'synthetic-oa-access-1', now() + interval '25 hours', 'synthetic-oa-refresh-1', now() + interval '90 days', now() - interval '12 hours'),
  1::bigint,
  'the first OA pair is stored as version 1'
) from fx;
select is(
  (select row(k.tenant_id = fx.tenant_a, k.access_token, k.refresh_token, k.refreshed_at = now() - interval '12 hours')::text from public.zalo_tokens k cross join fx where k.brand_id = fx.brand_a and k.kind = 'oa'),
  row(true, 'synthetic-oa-access-1', 'synthetic-oa-refresh-1', true)::text,
  'the pair is stored in the brand''s tenant with its refresh time'
);
select throws_ok(
  format('select app.save_zalo_tokens(%L, %L, %L, now() - interval ''1 minute'', %L, null, now())', (select brand_a from fx), 'oa', 'synthetic-a', 'synthetic-r'),
  '22023', null,
  'an access token that already expired is refused'
);
select throws_ok(
  format('select app.save_zalo_tokens(%L, %L, %L, now() + interval ''1 hour'', %L, null, now())', (select brand_a from fx), 'page', 'synthetic-a', 'synthetic-r'),
  '22023', null,
  'an unknown kind is refused'
);

select is(
  (select count(*)::integer from app.zalo_tokens_due(now()) d where d.brand_id = (select brand_a from fx)),
  1,
  'a pair refreshed 12 hours ago is due'
);

create temp table locked_1 as
select l.* from fx cross join lateral app.lock_zalo_token(fx.brand_a, 'oa', null, now()) l;

select is(
  (select row(l.version, l.due, l.refresh_token)::text from locked_1 l),
  row(1::bigint, true, 'synthetic-oa-refresh-1')::text,
  'the lock reads the row again and hands out the refresh token of a due pair'
);

create temp table locks_before as
select count(*)::integer as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();

select is(
  (select count(*)::integer from fx cross join lateral app.lock_zalo_token(fx.brand_b, 'oa', null, now()) l),
  0,
  'the lock answers no row for a brand without a pair'
);
select is(
  (select count(*)::integer from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) - (select held from locks_before),
  1,
  'the lock still takes the brand''s token lock, held after the call until the transaction ends, so two sessions serialise even on a first pair'
);
select ok(
  exists (
    select 1
    from pg_locks l
    cross join fx
    where l.locktype = 'advisory'
      and l.pid = pg_backend_pid()
      and l.mode = 'ExclusiveLock'
      and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('fnb-zalo-token:' || fx.brand_a::text || ':oa', 0)
  ),
  'the advisory lock is the brand''s OA token key, shared by every session that refreshes it'
);
select is(
  (select l.refresh_token from fx cross join lateral app.lock_zalo_token(fx.brand_a, 'oa', interval '13 hours', now()) l),
  null,
  'a pair younger than the refresh age keeps its refresh token in the database'
);
select is(
  (select l.due from fx cross join lateral app.lock_zalo_token(fx.brand_a, 'oa', interval '0', now()) l),
  true,
  'a refresh age of zero forces a refresh'
);
select throws_ok(
  format('select * from app.lock_zalo_token(%L, %L, interval ''-1 hour'', now())', (select brand_a from fx), 'oa'),
  '22023', null,
  'a negative refresh age is refused'
);

select is(
  (select app.store_zalo_token_refresh(l.token_id, l.version, 'synthetic-oa-access-2', now() + interval '25 hours', 'synthetic-oa-refresh-2', now() + interval '90 days', now()) from locked_1 l),
  2::bigint,
  'the refreshed pair is written over the version read under the lock, and the version moves to 2'
);
select is(
  (select app.store_zalo_token_refresh(l.token_id, l.version, 'synthetic-oa-access-3', now() + interval '25 hours', 'synthetic-oa-refresh-3', now() + interval '90 days', now()) from locked_1 l),
  null::bigint,
  'a second write over the old version is refused'
);
select is(
  (select row(k.version, k.access_token, k.refresh_token, k.refreshed_at = now())::text from public.zalo_tokens k cross join fx where k.brand_id = fx.brand_a and k.kind = 'oa'),
  row(2::bigint, 'synthetic-oa-access-2', 'synthetic-oa-refresh-2', true)::text,
  'the row holds the new pair, its refresh time and version 2'
);
select is(
  (select row(l.version, l.due, l.refresh_token)::text from fx cross join lateral app.lock_zalo_token(fx.brand_a, 'oa', null, now()) l),
  row(2::bigint, false, null::text)::text,
  'read again under the lock, the fresh pair is not due'
);
select is(
  (select count(*)::integer from app.zalo_tokens_due(now()) d where d.brand_id = (select brand_a from fx)),
  0,
  'a fresh pair is not due'
);

select app.save_zalo_tokens(fx.brand_a2, 'developer', 'synthetic-dev-access-1', now() + interval '1 hour', 'synthetic-dev-refresh-1', now() + interval '30 days', now() - interval '19 hours') from fx;
select is(
  (select l.due from fx cross join lateral app.lock_zalo_token(fx.brand_a2, 'developer', null, now()) l),
  false,
  'a developer pair rotated 19 hours ago is not due'
);
update public.zalo_tokens set refreshed_at = now() - interval '21 hours' where brand_id = (select brand_a2 from fx) and kind = 'developer';
select is(
  (select row(l.version, l.due)::text from fx cross join lateral app.lock_zalo_token(fx.brand_a2, 'developer', null, now()) l),
  row(2::bigint, true)::text,
  'a developer pair rotated 21 hours ago is due, and every update moved its version'
);

select is(
  app.raise_zalo_token_alert(fx.brand_a, 'oa', 'refused', -216, 'cli', now()),
  'opened',
  'a refresh refused with -216 opens a zalo_token_failed episode'
) from fx;
select is(
  (select row(e.rule_key, e.dedupe_key, e.severity::text, e.state, e.source, e.facts, e.notifications)::text from public.alert_events e cross join fx where e.tenant_id = fx.tenant_a and e.rule_key = 'zalo_token_failed'),
  (select row('zalo_token_failed', 'zalo_token_failed:oa:' || brand_a, 'critical', 'open', 'cli', '{"kind": "oa", "brand": "brand-1", "reason": "refused", "error_code": -216}'::jsonb, 1)::text from fx),
  'the episode is critical, keyed by kind and brand, with count-only facts, and reaches the owner once'
);
select is(
  app.raise_zalo_token_alert(fx.brand_a, 'oa', 'refused', -220, 'scheduler', now() + interval '1 hour'),
  'repeated',
  'a second refusal (-220) is counted on the open episode'
) from fx;
select is(
  (select row(count(*), max(e.occurrences), max(e.notifications), max(e.facts ->> 'error_code'))::text from public.alert_events e cross join fx where e.tenant_id = fx.tenant_a and e.rule_key = 'zalo_token_failed'),
  row(1::bigint, 2, 1, '-220')::text,
  'still exactly one episode, two occurrences, one notice, and the latest error code'
);
select is(
  (select count(*)::integer from public.outbound_messages o cross join fx where o.tenant_id = fx.tenant_a and o.template_ref = 'alert.zalo_token_failed.v1'),
  1,
  'the owner''s destination received one alert message'
);
select is(
  app.raise_zalo_token_alert(fx.brand_a, 'oa', 'refused', -224, 'actions', now() + interval '2 hours'),
  'repeated',
  'a refusal for an expired package (-224) also stays on the open episode'
) from fx;
select is(
  app.raise_zalo_token_alert(fx.brand_a2, 'developer', 'unanswered', null, 'actions', now()),
  'opened',
  'a failed developer-token rotation opens its own episode'
) from fx;
select is(
  (select e.facts from public.alert_events e cross join fx where e.dedupe_key = 'zalo_token_failed:developer:' || fx.brand_a2),
  '{"kind": "developer", "brand": "brand-2", "reason": "unanswered"}'::jsonb,
  'an unanswered rotation carries no error code'
);
select throws_ok(
  format('select app.raise_zalo_token_alert(%L, %L, %L, null, %L)', (select brand_a from fx), 'oa', 'timeout', 'cli'),
  '22023', null,
  'an unknown reason is refused'
);
select throws_ok(
  format('select app.raise_zalo_token_alert(%L, %L, %L, null, %L)', (select brand_a from fx), 'oa', 'refused', 'webhook'),
  '22023', null,
  'an unknown source is refused'
);

select is(app.resolve_zalo_token_alert(fx.brand_a, 'oa', now() + interval '3 hours'), 1, 'a stored pair resolves the open episode') from fx;
select is(
  (select row(e.state, e.resolution)::text from public.alert_events e cross join fx where e.dedupe_key = 'zalo_token_failed:oa:' || fx.brand_a),
  row('resolved', 'recovered')::text,
  'the episode is resolved as recovered'
);
select is(app.resolve_zalo_token_alert(fx.brand_a, 'oa', now() + interval '4 hours'), 0, 'nothing is left to resolve') from fx;
select is(
  app.raise_zalo_token_alert(fx.brand_a, 'oa', 'refused', -216, 'cli', now() + interval '5 hours'),
  'opened',
  'a failure after the recovery opens a new episode'
) from fx;
select is(
  (select row(e.suppressed_reason, e.notifications)::text from public.alert_events e cross join fx where e.dedupe_key = 'zalo_token_failed:oa:' || fx.brand_a and e.state = 'open'),
  row('cool_down', 0)::text,
  'inside the 12-hour cool-down the new episode stays silent'
);

update public.oas set package_expires_on = (select local_today + 30 from fx) where id = (select oa_a from fx);
update public.oas set package_expires_on = (select local_today + 3 from fx) where id = (select oa_b from fx);
select is(app.check_oa_package_expiry(now(), (select tenant_a from fx), 'cli'), 1, '30 days before the expiry the first notice fires');
select is(
  (select row(e.state, e.resolution, e.facts ->> 'days_left', e.facts ->> 'notice_days', e.notifications)::text from public.alert_events e cross join fx where e.tenant_id = fx.tenant_a and e.rule_key = 'oa_package_expiring'),
  row('resolved', 'instant', '30', '30', 1)::text,
  'the notice is an instant episode with the days left, sent to the owner'
);
select is(app.check_oa_package_expiry(now() + interval '1 day', (select tenant_a from fx), 'scheduler'), 0, 'the first notice fires once');
select is(app.check_oa_package_expiry(now() + interval '22 days', (select tenant_a from fx), 'scheduler'), 0, 'eight days ahead nothing more fires');
select is(app.check_oa_package_expiry(now() + interval '23 days', (select tenant_a from fx), 'scheduler'), 1, '7 days before the expiry the last notice fires');
select is(app.check_oa_package_expiry(now() + interval '24 days', (select tenant_a from fx), 'scheduler'), 0, 'the last notice fires once');
select is(
  (select array_agg((e.facts ->> 'notice_days')::integer order by e.opened_at) from public.alert_events e cross join fx where e.tenant_id = fx.tenant_a and e.rule_key = 'oa_package_expiring'),
  array[30, 7],
  'exactly one notice at 30 days and one at 7 days'
);
select is(app.check_oa_package_expiry(now() + interval '31 days', (select tenant_a from fx), 'scheduler'), 0, 'an expired package raises nothing');
select is(app.check_oa_package_expiry(now(), (select tenant_b from fx), 'cli'), 1, 'a package first seen 3 days ahead raises only the last notice');
select is(
  (select e.facts ->> 'notice_days' from public.alert_events e cross join fx where e.tenant_id = fx.tenant_b and e.rule_key = 'oa_package_expiring'),
  '7',
  'that notice is the 7-day one'
);
update public.oas set package_expires_on = (select local_today + 60 from fx) where id = (select oa_a from fx);
insert into public.alert_rules (tenant_id, rule_key, params) select tenant_a, 'oa_package_expiring', '{"first_notice_days": 61}' from fx;
select is(app.check_oa_package_expiry(now(), (select tenant_a from fx), 'cli'), 1, 'a renewed package gets its own notices, and the tenant chooses how early');

select is(app.dispatch_zalo_tokens(now()), 0, 'while the schedule is disabled nothing is dispatched');
select app.enable_zalo_token_jobs('http://127.0.0.1:54321/functions/v1/zalo-oauth');
select ok(exists (select 1 from cron.job where jobname = 'zalo-tokens' and schedule = '41 * * * *'), 'enabling schedules the hourly job');
update public.zalo_tokens set refreshed_at = now() - interval '12 hours' where brand_id = (select brand_a from fx) and kind = 'oa';
select ok(
  app.dispatch_zalo_tokens(now()) >= 2,
  'the dispatcher issues a ticket per due pair'
);
select is(
  (select array_agg(t.kind || '/' || t.source order by t.kind) from app.zalo_token_tickets t where t.brand_id in (select brand_a from fx union all select brand_a2 from fx)),
  array['developer/schedule', 'oa/schedule'],
  'the due OA pair and the due developer pair each got a ticket'
);
select is(
  (select count(*)::integer from app.zalo_token_tickets t where t.brand_id in (select brand_a from fx union all select brand_a2 from fx) and t.request_id is not null),
  2,
  'each ticket was posted through pg_net'
);
select app.dispatch_zalo_tokens(now());
select is(
  (select count(*)::integer from app.zalo_token_tickets t where t.brand_id in (select brand_a from fx union all select brand_a2 from fx)),
  2,
  'a pair with a waiting ticket gets no second one'
);
select is(
  (select row(c.brand_id = fx.brand_a, c.kind, c.source)::text from fx cross join lateral app.claim_zalo_token_ticket((select t.ticket from app.zalo_token_tickets t where t.brand_id = fx.brand_a)) c),
  row(true, 'oa', 'schedule')::text,
  'claiming a ticket names the brand and the kind'
);
select is(
  (select count(*)::integer from fx cross join lateral app.claim_zalo_token_ticket((select t.ticket from app.zalo_token_tickets t where t.brand_id = fx.brand_a)) c),
  0,
  'a ticket is claimed once'
);
select is(
  (select c.source from fx cross join lateral app.claim_zalo_token_ticket(app.issue_zalo_token_ticket(fx.brand_b, 'oa')) c),
  'manual',
  'an operator issues a manual ticket'
);
select throws_ok(
  format('select app.issue_zalo_token_ticket(%L, %L)', (select brand_b from fx), 'page'),
  '22023', null,
  'a manual ticket needs a known kind'
);
select app.disable_zalo_token_jobs();
select ok(not exists (select 1 from cron.job where jobname = 'zalo-tokens'), 'disabling removes the job');

select * from finish();
rollback;
