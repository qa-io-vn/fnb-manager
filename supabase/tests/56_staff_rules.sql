begin;
select plan(90);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005601'::uuid as tenant_s,
  'dddddddd-dddd-4ddd-8ddd-000000005602'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000005601'::uuid as account_s,
  'cccccccc-cccc-4ccc-8ccc-000000005603'::uuid as account_s3,
  'cccccccc-cccc-4ccc-8ccc-000000005602'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000005601'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000005602'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000005603'::uuid as store_s3,
  'ffffffff-ffff-4fff-8fff-000000005611'::uuid as store_t1,
  'eeeeeeee-eeee-4eee-8eee-000000005601'::uuid as owner_s,
  'eeeeeeee-eeee-4eee-8eee-000000005602'::uuid as manager_all,
  'eeeeeeee-eeee-4eee-8eee-000000005603'::uuid as manager_s1,
  'eeeeeeee-eeee-4eee-8eee-000000005604'::uuid as manager_s3,
  'eeeeeeee-eeee-4eee-8eee-000000005605'::uuid as staff_s1,
  'eeeeeeee-eeee-4eee-8eee-000000005606'::uuid as staff_s3,
  'eeeeeeee-eeee-4eee-8eee-000000005607'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000005608'::uuid as viewer_s,
  'eeeeeeee-eeee-4eee-8eee-000000005609'::uuid as owner_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000005601'::uuid as brand_s,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000005602'::uuid as zalo_app_s,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000005603'::uuid as oa_s,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000005604'::uuid as mini_app_s,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005601'::uuid as template_open,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005602'::uuid as template_mid,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005603'::uuid as template_late,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005604'::uuid as template_retired,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005605'::uuid as template_close,
  '2026-09-10 08:00+07'::timestamptz as t0,
  '2026-09-10 15:00+07'::timestamptz as sales_at;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'staff-rules-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_s, fx.manager_all, fx.manager_s1, fx.manager_s3, fx.staff_s1, fx.staff_s3, fx.staff_s2, fx.viewer_s, fx.owner_t]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_s, 'staff-rules-pgtap-s', 'Staff rules pgTAP S' from fx
union all
select tenant_t, 'staff-rules-pgtap-t', 'Staff rules pgTAP T' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_s, tenant_s, 'mock', 'staff-rules-account-s', 'Synthetic account S' from fx
union all
select account_s3, tenant_s, 'mock', 'staff-rules-account-s3', 'Synthetic account S3' from fx
union all
select account_t, tenant_t, 'mock', 'staff-rules-account-t', 'Synthetic account T' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
select store_s1, tenant_s, account_s, 'staff-rules-s1', 'Synthetic store S1', 'Asia/Ho_Chi_Minh', 0, null::jsonb from fx
union all
select store_s2, tenant_s, account_s, 'staff-rules-s2', 'Synthetic store S2', 'Asia/Ho_Chi_Minh', 0, null from fx
union all
select store_s3, tenant_s, account_s3, 'staff-rules-s3', 'Synthetic store S3', 'Asia/Ho_Chi_Minh', 0,
  '{"mon": [["06:00", "22:00"]], "tue": [["06:00", "22:00"]], "wed": [["06:00", "22:00"]], "thu": [["06:00", "22:00"]], "fri": [["06:00", "22:00"]], "sat": [["06:00", "22:00"]], "sun": [["06:00", "22:00"]]}'::jsonb from fx
union all
select store_t1, tenant_t, account_t, 'staff-rules-t1', 'Synthetic store T1', 'Asia/Ho_Chi_Minh', 0, null from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_s, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_s, 'owner', null::uuid[]),
    (fx.manager_all, 'manager', null::uuid[]),
    (fx.manager_s1, 'manager', array[fx.store_s1]),
    (fx.manager_s3, 'manager', array[fx.store_s3]),
    (fx.staff_s1, 'staff', array[fx.store_s1]),
    (fx.staff_s3, 'staff', array[fx.store_s3]),
    (fx.staff_s2, 'staff', array[fx.store_s2]),
    (fx.viewer_s, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select fx.tenant_t, fx.owner_t, 'owner', null from fx;

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, config, status, linked_at, consent_record_id)
select
  d.tenant_id, 'zalo_bot', 'zalo_bot', 'bot ' || d.n, d.user_id, 'staff-rules-chat-' || d.n, 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}'::jsonb, 'active', '2026-01-01 00:00+07',
  app.ensure_notifications_consent(d.tenant_id, d.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-01-01 00:00+07')
from fx
cross join lateral (
  values
    (fx.tenant_s, fx.owner_s, 1), (fx.tenant_s, fx.manager_all, 2), (fx.tenant_s, fx.manager_s1, 3), (fx.tenant_s, fx.manager_s3, 4),
    (fx.tenant_s, fx.staff_s1, 5), (fx.tenant_s, fx.staff_s3, 6), (fx.tenant_s, fx.staff_s2, 7), (fx.tenant_t, fx.owner_t, 9)
) as d (tenant_id, user_id, n);

create function pg_temp.person(p_id uuid)
returns text
language sql
as $$
  select case p_id
    when fx.owner_s then 'owner_s' when fx.manager_all then 'manager_all' when fx.manager_s1 then 'manager_s1' when fx.manager_s3 then 'manager_s3'
    when fx.staff_s1 then 'staff_s1' when fx.staff_s3 then 'staff_s3' when fx.staff_s2 then 'staff_s2' when fx.owner_t then 'owner_t' else 'other' end
  from fx;
$$;

create function pg_temp.reached(p_event_id uuid, p_kind text default 'alert')
returns text
language sql
as $$
  select coalesce(string_agg(pg_temp.person(c.user_id), ',' order by pg_temp.person(c.user_id)), '-')
  from public.outbound_messages o
  join public.notification_channels c on c.id = o.channel_id
  where o.alert_event_id = p_event_id
    and o.kind = p_kind;
$$;

create function pg_temp.episode(p_dedupe_key text)
returns uuid
language sql
as $$
  select e.id from public.alert_events e
  where e.tenant_id = (select tenant_s from fx) and e.dedupe_key = p_dedupe_key
  order by e.opened_at desc, e.id
  limit 1;
$$;

create function pg_temp.local_at(p_day date, p_time time)
returns timestamptz
language sql
as $$
  select (p_day + p_time) at time zone 'Asia/Ho_Chi_Minh';
$$;

create function pg_temp.call_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_result;
  return v_result;
exception when others then
  return sqlstate;
end;
$$;

grant select on fx to authenticated, anon, service_role;

select is(
  (select array_agg(c.rule_key || ':' || c.category || ':' || c.delivery || ':' || c.default_severity::text || ':' || array_to_string(c.default_roles, '+') || ':' || c.default_cooldown::text
     || ':' || coalesce(c.remind_every::text, '-') || ':' || c.notify_on_resolve || ':' || c.store_scoped || ':' || c.default_enabled order by c.sort_order)
   from public.alert_rule_catalog c where c.sort_order between 200 and 260),
  array[
    'staff_sync_stale:sync:immediate:warning:manager+staff:06:00:00:-:false:true:true',
    'abnormal_voids:business:immediate:warning:owner+manager:00:00:00:-:false:true:true',
    'voucher_spike:business:immediate:warning:owner+manager:00:00:00:-:false:true:true',
    'checklist_unfinished:operations:immediate:warning:manager+staff:00:00:00:-:false:true:true',
    'staff_daily_digest:digest:digest:info:staff:00:00:00:-:false:false:true',
    'oa_inactive:channel:immediate:warning:owner:7 days:7 days:false:false:true',
    'mini_app_visits_low:channel:immediate:warning:owner:00:00:00:-:false:false:true'
  ],
  'the seven phase 15 rules with their default roles, cool-downs, reminders and scope'
);
select ok(
  (select bool_and(app.alert_rule_params_valid(c.rule_key, c.default_params)) from public.alert_rule_catalog c where c.sort_order between 200 and 260),
  'every new default passes its own parameter schema'
);
select ok(not app.alert_rule_params_valid('abnormal_voids', '{"z_threshold": 0.5}'::jsonb) and not app.alert_rule_params_valid('oa_inactive', '{"warn_after_days": 180}'::jsonb)
  and not app.alert_rule_params_valid('mini_app_visits_low', '{"min_visits": 0}'::jsonb) and app.alert_rule_params_valid('checklist_unfinished', '{"grace_minutes": 0}'::jsonb),
  'the new parameter ranges hold: a z threshold under 1, an inactivity warning at the lock itself and a zero visit floor are refused'
);
select throws_ok(
  $q$ insert into public.alert_rules (tenant_id, rule_key, roles) select tenant_s, 'daily_digest', array['owner', 'staff']::public.tenant_role[] from fx $q$,
  '22023', null,
  'the daily digest never goes to staff, for every writer: one owner''s or manager''s model would leak figures'
);
select throws_ok(
  $q$ insert into public.alert_rules (tenant_id, rule_key, roles) select tenant_s, 'staff_daily_digest', array['staff', 'manager']::public.tenant_role[] from fx $q$,
  '22023', null,
  'the staff digest goes to staff only'
);
select lives_ok(
  $q$ insert into public.alert_rules (tenant_id, rule_key, roles, params) select tenant_s, 'staff_daily_digest', array['staff']::public.tenant_role[], '{"deadline_local": "07:00"}'::jsonb from fx $q$,
  'the owner keeps the staff digest for staff and moves its hour'
);
select ok(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'outbound_messages_kind_check') like '%''staff_digest''%',
  'the outbox takes the staff_digest kind'
);
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname collate "C")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('evaluate_staff_rules', 'evaluate_staff_sync', 'evaluate_unfinished_checklists', 'evaluate_abnormal_voids', 'evaluate_voucher_spikes',
       'evaluate_oa_activity', 'evaluate_mini_app_visits', 'checklist_phase_end', 'resolve_rule_episode', 'due_staff_digests', 'enqueue_staff_digest_message',
       'guard_digest_roles', 'record_oa_follower_activity')
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
       or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  null,
  'the rule evaluators and the staff digest functions run as postgres only'
);
select ok(
  has_function_privilege('service_role', 'public.zalo_session_visit(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.zalo_session_visit(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.zalo_session_visit(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'app.record_mini_app_visit(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.record_mini_app_visit(uuid, text, timestamptz)', 'execute'),
  'only zalo-session, as the service role, counts a visit'
);
select throws_ok(
  $q$ select app.evaluate_staff_rules(now(), 'dddddddd-dddd-4ddd-8ddd-000000005601', 'webhook') $q$,
  '22023', null,
  'the evaluation takes the sources incremental, nightly, scheduler and cli'
);

select has_table('public', 'mini_app_visits', 'mini_app_visits exists');
select is(
  (select array_agg(c.column_name::text order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'mini_app_visits'),
  array['tenant_id', 'mini_app_id', 'month', 'visits', 'updated_at'],
  'visits are counts per Mini App and month only: no person, device or location column'
);
select col_is_pk('public', 'mini_app_visits', array['mini_app_id', 'month'], 'one row per Mini App and month');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.mini_app_visits'::regclass), 'mini_app_visits has row level security');
select is(
  (select array_agg(t.grantee::text || ':' || t.privilege_type order by t.grantee, t.privilege_type) from information_schema.role_table_grants t
   where t.table_schema = 'public' and t.table_name = 'mini_app_visits' and t.grantee in ('anon', 'authenticated')),
  array['authenticated:SELECT'],
  'members only read the counts; anon holds nothing'
);

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_s, tenant_s, 'brand-1', 'Synthetic brand', array[store_s1, store_s2, store_s3] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select zalo_app_s, tenant_s, brand_s, 'synthetic-app-56', 'ZALO_APP_SECRET_BRAND1' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, secret_name, created_at)
select oa_s, tenant_s, brand_s, 'synthetic-oa-56', 'ZALO_OA_SECRET_BRAND1', '2026-04-01 00:00+07' from fx;
insert into public.mini_apps (id, tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
select mini_app_s, tenant_s, brand_s, 'staff', 'synthetic-mini-56', false, 'Quán Mẫu Nội Bộ', 'Quán Mẫu', 'Sample Shop', '#FFFFFF', '#000000', 'black', 'white' from fx;

select is(
  (select array[app.record_mini_app_visit(zalo_app_s, 'staff', '2026-09-03 10:00+07'), app.record_mini_app_visit(zalo_app_s, 'staff', '2026-09-01 00:30+07'), app.record_mini_app_visit(zalo_app_s, 'customer', '2026-09-03 10:00+07')] from fx),
  array[1, 2, null]::integer[],
  'a visit adds one to the month of the brand''s Mini App; a brand without a customer app counts nothing'
);
set local role service_role;
select is((select public.zalo_session_visit(zalo_app_s) from fx), 1, 'zalo-session counts a visit through zalo_session_visit');
reset role;
select is(
  (select string_agg(to_char(v.month, 'YYYY-MM-DD') || ':' || v.visits, ',' order by v.month) from public.mini_app_visits v where v.tenant_id = (select tenant_s from fx) and v.month < '2026-10-01'),
  '2026-09-01:2',
  'a late-evening visit falls in the tenant''s own month'
);
set local role authenticated;
select is(pg_temp.call_as((select owner_s from fx), $q$ select count(*)::text from public.mini_app_visits $q$), '2', 'owners read the counts');
select is(
  array[pg_temp.call_as((select staff_s1 from fx), $q$ select count(*)::text from public.mini_app_visits $q$), pg_temp.call_as((select owner_t from fx), $q$ select count(*)::text from public.mini_app_visits $q$)],
  array['0', '0'],
  'staff and other tenants read none'
);
select is(pg_temp.call_as((select owner_s from fx), $q$ insert into public.mini_app_visits (tenant_id, mini_app_id, month, visits) select tenant_s, mini_app_s, date '2026-08-01', 99 from fx returning 'x' $q$), '42501', 'no member writes a count');
reset role;
set local role anon;
select throws_ok('select count(*) from public.mini_app_visits', '42501', null, 'anon reads no visit count');
reset role;

select is((select app.evaluate_staff_sync(t0, tenant_s, 'incremental') from fx), 0, 'staff_sync_stale: nothing opens while every sync episode of the tenant is closed');
select app.raise_alert(tenant_s, 'sync_stale', 'store:' || store_s1, 'scheduler', t0, store_s1, account_s, null, null, '{"minutes_without_sync": 120, "threshold_minutes": 90, "scope": "now"}'::jsonb) from fx;
select is((select app.evaluate_staff_sync(t0, tenant_s, 'incremental') from fx), 1, 'an open sync_stale of a store opens the staff variant for that store');
select is(pg_temp.reached(pg_temp.episode('staff_sync_stale:store:' || (select store_s1 from fx))), 'manager_all,manager_s1,staff_s1', 'it reaches the store''s staff and managers, nobody of another store');
select is(pg_temp.reached(pg_temp.episode('sync_stale:store:' || (select store_s1 from fx))), 'owner_s', 'the owner keeps the owner-facing alert');
select is((select e.facts from public.alert_events e where e.id = pg_temp.episode('staff_sync_stale:store:' || (select store_s1 from fx))), '{}'::jsonb, 'the staff variant carries no fact: only that the figures are not up to date');
select is((select app.evaluate_staff_sync(t0 + interval '10 minutes', tenant_s, 'incremental') from fx), 0, 'a second evaluation opens nothing more');
update public.alert_events set state = 'resolved', resolved_at = t0 + interval '1 hour', resolution = 'recovered' from fx where dedupe_key = 'sync_stale:store:' || store_s1 and state = 'open';
select app.evaluate_staff_sync(t0 + interval '1 hour', tenant_s, 'incremental') from fx;
select is(
  (select e.state || ':' || e.resolution || ':' || pg_temp.reached(e.id, 'alert_resolved') from public.alert_events e where e.id = pg_temp.episode('staff_sync_stale:store:' || (select store_s1 from fx))),
  'resolved:recovered:-',
  'it resolves as recovered with the owner''s episode, without a recovery message'
);
select app.raise_alert(tenant_s, 'sync_stale', 'store:' || store_s1, 'scheduler', t0 + interval '2 hours', store_s1, account_s, null, null, '{"minutes_without_sync": 100}'::jsonb) from fx;
select app.evaluate_staff_sync(t0 + interval '2 hours', tenant_s, 'incremental') from fx;
select is(
  (select e.state || ':' || coalesce(e.suppressed_reason, '-') || ':' || pg_temp.reached(e.id) from public.alert_events e where e.id = pg_temp.episode('staff_sync_stale:store:' || (select store_s1 from fx))),
  'open:cool_down:-',
  'a return inside the 6-hour cool-down opens silently'
);
update public.alert_events set state = 'resolved', resolved_at = t0 + interval '3 hours', resolution = 'recovered' from fx where dedupe_key = 'sync_stale:store:' || store_s1 and state = 'open';
select app.evaluate_staff_sync(t0 + interval '3 hours', tenant_s, 'incremental') from fx;
select app.raise_alert(tenant_s, 'sync_stale', 'store:' || store_s1, 'scheduler', t0 + interval '7 hours', store_s1, account_s, null, null, '{"minutes_without_sync": 100}'::jsonb) from fx;
select app.evaluate_staff_sync(t0 + interval '7 hours', tenant_s, 'nightly') from fx;
select is(
  (select e.state || ':' || coalesce(e.suppressed_reason, '-') || ':' || pg_temp.reached(e.id) || ':' || e.source from public.alert_events e where e.id = pg_temp.episode('staff_sync_stale:store:' || (select store_s1 from fx))),
  'open:-:manager_all,manager_s1,staff_s1:nightly',
  'after the cool-down it is announced again'
);
select app.raise_alert(tenant_s, 'auth_failed', 'account:' || account_s, 'scheduler', t0 + interval '8 hours', null, account_s, null, null, '{}'::jsonb) from fx;
select is((select app.evaluate_staff_sync(t0 + interval '8 hours', tenant_s, 'incremental') from fx), 1, 'a credential failure of the POS account opens it for the account''s other store, not for a store of another account');
select is(pg_temp.reached(pg_temp.episode('staff_sync_stale:store:' || (select store_s2 from fx))), 'manager_all,staff_s2', 'the other store''s staff hear it');

insert into public.shifts (tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at)
select fx.tenant_s, fx.store_s1, p.external_id, 'Ca POS ' || p.external_id, 'cashier-name@example.com', (p.business_date + p.opened) at time zone 'Asia/Ho_Chi_Minh',
  (p.business_date + p.closed) at time zone 'Asia/Ho_Chi_Minh'
from fx
cross join (values
  ('V-T1', date '2026-09-03', time '06:00', time '22:00'),
  ('V-T2', date '2026-09-04', time '06:00', time '22:00'),
  ('V-T3', date '2026-09-05', time '06:00', time '22:00'),
  ('V-T4', date '2026-09-06', time '06:00', time '22:00'),
  ('V-X', date '2026-09-10', time '06:00', time '14:00'),
  ('V-Y', date '2026-09-10', time '14:30', null)
) as p (external_id, business_date, opened, closed);
insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, cashier_name, opened_at, closed_at, orders)
select s.tenant_id, s.store_id, s.id, s.external_id, app.store_business_date(s.store_id, s.opened_at), s.cashier_name, s.opened_at, s.closed_at, 0
from public.shifts s where s.store_id = (select store_s1 from fx);
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id, gross_amount, net_amount, paid_amount)
select fx.tenant_s, fx.store_s1, fx.account_s, p.external_id || '-' || n, (p.business_date + p.sold) at time zone 'Asia/Ho_Chi_Minh', p.business_date, p.external_id, 30000, 30000, 30000
from fx
cross join (values
  ('V-T1', date '2026-09-03', time '10:00', 20), ('V-T2', date '2026-09-04', time '10:00', 20), ('V-T3', date '2026-09-05', time '10:00', 20),
  ('V-T4', date '2026-09-06', time '10:00', 20), ('V-X', date '2026-09-10', time '10:00', 10), ('V-Y', date '2026-09-10', time '14:35', 2)
) as p (external_id, business_date, sold, orders)
cross join lateral generate_series(1, p.orders) n;
insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, source)
select fx.tenant_s, fx.store_s1, null, 'VOID-' || p.external_id || '-' || n, 'voided'::public.invoice_event_kind, (p.business_date + p.at_time + n * interval '1 minute') at time zone 'Asia/Ho_Chi_Minh', 30000, 'pos_report'
from fx
cross join (values
  ('V-T1', date '2026-09-03', time '12:00', 1), ('V-T3', date '2026-09-05', time '12:00', 1), ('V-X', date '2026-09-10', time '12:00', 5), ('V-Y', date '2026-09-10', time '14:40', 5)
) as p (external_id, business_date, at_time, voids)
cross join lateral generate_series(1, p.voids) n;

select is((select app.evaluate_abnormal_voids(sales_at, tenant_s, 'incremental') from fx), 1, 'abnormal_voids: the closed shift whose void rate stands out within the store is raised; the open one waits for its close');
select is(
  (select e.facts - 'void_z' from public.alert_events e where e.rule_key = 'abnormal_voids' and e.tenant_id = (select tenant_s from fx)),
  '{"orders": 10, "voids": 5, "removed_lines": 0, "removed_z": null, "over_voids": true, "over_removed": false, "shift_number": 1}'::jsonb,
  'its facts are counts and flags: Ca 1, orders, voids, removed lines, never an amount, a cashier or a shift name'
);
select ok((select (e.facts ->> 'void_z')::numeric > 2 and e.state = 'resolved' and e.resolution = 'instant' and e.business_date = '2026-09-10' from public.alert_events e where e.rule_key = 'abnormal_voids' and e.tenant_id = (select tenant_s from fx)), 'the z-score is above the threshold and the episode is an instant one of the shift''s day');
select is(pg_temp.reached((select e.id from public.alert_events e where e.rule_key = 'abnormal_voids' and e.tenant_id = (select tenant_s from fx))), 'manager_all,manager_s1,owner_s', 'it reaches the owner and the store''s managers, not staff');
select is((select app.evaluate_abnormal_voids(sales_at + interval '30 minutes', tenant_s, 'nightly') from fx), 0, 'a shift already raised is not raised again');

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, voucher_code, voucher_amount)
select fx.tenant_s, fx.store_s2, fx.account_s, 'VS-' || to_char(p.business_date, 'MMDD') || '-' || n, (p.business_date + time '11:00') at time zone 'Asia/Ho_Chi_Minh', p.business_date,
  50000, 50000, 50000, case when n <= p.vouchers then 'GIAM-' || n end, case when n <= p.vouchers then 10000 else 0 end
from fx
cross join (values (date '2026-08-20', 1), (date '2026-08-27', 1), (date '2026-09-03', 1), (date '2026-09-10', 6)) as p (business_date, vouchers)
cross join lateral generate_series(1, 20) n;

select is((select app.evaluate_voucher_spikes(sales_at, tenant_s, 'incremental') from fx), 1, 'voucher_spike: a day with three times the same-weekday voucher count is raised');
select is(
  (select e.facts from public.alert_events e where e.rule_key = 'voucher_spike' and e.tenant_id = (select tenant_s from fx)),
  '{"vouchers": 6, "invoices": 20, "share": 0.3000, "baseline_vouchers": 1.0, "baseline_share": 0.0500, "sample_days": 3, "ratio": 2, "over_count": true, "over_share": true}'::jsonb,
  'its facts are counts and shares, never an amount or a voucher code'
);
select is(pg_temp.reached((select e.id from public.alert_events e where e.rule_key = 'voucher_spike' and e.tenant_id = (select tenant_s from fx))), 'manager_all,owner_s', 'it reaches the owner and the managers of the store');
select is((select app.evaluate_voucher_spikes(sales_at + interval '1 hour', tenant_s, 'incremental') from fx), 0, 'a day already raised is not raised again');
insert into public.alert_rules (tenant_id, store_id, rule_key, params)
select tenant_s, store_s2, 'voucher_spike', '{"min_sample_days": 4}'::jsonb from fx;
delete from public.alert_events where rule_key = 'voucher_spike' and tenant_id = (select tenant_s from fx);
select is((select app.evaluate_voucher_spikes(sales_at, tenant_s, 'incremental') from fx), 0, 'with fewer same-weekday days than the store asks for, nothing is raised');

create temp table checklist_day as select app.store_business_date((select store_s3 from fx), now()) as d;
grant select on checklist_day to authenticated;

insert into public.checklist_templates (id, tenant_id, store_id, shift_phase, title, active, created_at, created_by)
select template_open, tenant_s, store_s3, 'opening', 'Mở ca bí mật', true, now() - interval '2 days', manager_s3 from fx
union all
select template_mid, tenant_s, null, 'midshift', 'Giữa ca bí mật', true, now() - interval '2 days', owner_s from fx
union all
select template_late, tenant_s, store_s3, 'opening', 'Mở ca mới tạo', true, pg_temp.local_at((select d from checklist_day), time '07:00'), manager_s3 from fx
union all
select template_retired, tenant_s, store_s3, 'opening', 'Mở ca cũ', false, now() - interval '2 days', manager_s3 from fx;
insert into public.checklist_items (tenant_id, store_id, template_id, template_version, position, label, created_by)
select t.tenant_id, t.store_id, t.id, 1, p.position, 'Việc ' || p.position, t.created_by
from public.checklist_templates t
cross join (values (1::smallint), (2::smallint)) as p (position)
where t.tenant_id = (select tenant_s from fx);

select is(
  (select array[app.checklist_phase_end(store_s3, d, 'opening'), app.checklist_phase_end(store_s3, d, 'midshift'), app.checklist_phase_end(store_s3, d, 'closing'), app.checklist_phase_end(store_s1, d, 'opening')] from fx, checklist_day),
  (select array[pg_temp.local_at(d, time '06:00'), pg_temp.local_at(d, time '14:00'), pg_temp.local_at(d, time '22:00'), null] from checklist_day),
  'shift phases end at the opening, halfway through the day and at the close; a store without opening hours has none'
);
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '06:29'), tenant_s, 'incremental') from fx, checklist_day), 0, 'checklist_unfinished: nothing before the grace after the phase end has passed');
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '06:31'), tenant_s, 'incremental') from fx, checklist_day), 1, 'an opening checklist not finished 30 minutes after the opening is raised; a retired one and one created after the opening are not');
select is(
  (select e.facts from public.alert_events e where e.id = pg_temp.episode('checklist_unfinished:checklist:' || (select template_open from fx) || ':' || (select store_s3 from fx) || ':' || to_char((select d from checklist_day), 'YYYY-MM-DD'))),
  '{"shift_phase": "opening", "started": false, "items_total": 0, "items_done": 0, "minutes_late": 31, "grace_minutes": 30}'::jsonb,
  'its facts say the phase, whether it started and how far it got, never the checklist''s title'
);
select is(
  pg_temp.reached(pg_temp.episode('checklist_unfinished:checklist:' || (select template_open from fx) || ':' || (select store_s3 from fx) || ':' || to_char((select d from checklist_day), 'YYYY-MM-DD'))),
  'manager_all,manager_s3,staff_s3',
  'it reaches the staff and managers of that store only'
);
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '06:45'), tenant_s, 'incremental') from fx, checklist_day), 0, 'the same checklist and day is raised once');
select set_config('request.jwt.claims', json_build_object('sub', (select staff_s3 from fx), 'role', 'authenticated')::text, true);
insert into public.checklist_runs (tenant_id, store_id, template_id) select tenant_s, store_s3, template_open from fx;
update public.checklist_runs set status = 'finished' where template_id = (select template_open from fx);
select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '06:50'), tenant_s, 'incremental') from fx, checklist_day;
select is(
  (select e.state || ':' || e.resolution from public.alert_events e where e.id = pg_temp.episode('checklist_unfinished:checklist:' || (select template_open from fx) || ':' || (select store_s3 from fx) || ':' || to_char((select d from checklist_day), 'YYYY-MM-DD'))),
  'resolved:cleared',
  'finishing the run clears the episode'
);
insert into public.checklist_runs (tenant_id, store_id, template_id) select tenant_s, store_s3, template_mid from fx;
update public.checklist_answers a set done = true
from public.checklist_runs r, public.checklist_items i
where r.id = a.run_id and r.template_id = (select template_mid from fx) and i.id = a.item_id and i.position = 1;
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '14:31'), tenant_s, 'incremental') from fx, checklist_day), 1, 'a tenant-wide midshift checklist started but not finished is raised at the store whose hours are known');
select is(
  (select e.facts ->> 'started' || ':' || (e.facts ->> 'items_done') || '/' || (e.facts ->> 'items_total') from public.alert_events e where e.id = pg_temp.episode('checklist_unfinished:checklist:' || (select template_mid from fx) || ':' || (select store_s3 from fx) || ':' || to_char((select d from checklist_day), 'YYYY-MM-DD'))),
  'true:1/2',
  'it tells how far the run got'
);
select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '14:31') + interval '12 hours', tenant_s, 'nightly') from fx, checklist_day;
select is(
  (select e.state || ':' || e.resolution from public.alert_events e where e.id = pg_temp.episode('checklist_unfinished:checklist:' || (select template_mid from fx) || ':' || (select store_s3 from fx) || ':' || to_char((select d from checklist_day), 'YYYY-MM-DD'))),
  'resolved:day_ended',
  'an episode still open 12 hours later ends with the day'
);
insert into public.checklist_templates (id, tenant_id, store_id, shift_phase, title, active, created_at, created_by)
select template_close, tenant_s, store_s3, 'closing', 'Đóng ca bí mật', true, now() - interval '2 days', manager_s3 from fx;
insert into public.alert_rules (tenant_id, store_id, rule_key, enabled)
select tenant_s, store_s3, 'checklist_unfinished', false from fx;
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '22:31'), tenant_s, 'incremental') from fx, checklist_day), 0, 'a store that switched the rule off is not evaluated');
delete from public.alert_rules where rule_key = 'checklist_unfinished' and tenant_id = (select tenant_s from fx);
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '22:20'), tenant_s, 'incremental') from fx, checklist_day), 0, 'the closing checklist waits for its grace after the close');
select is((select app.evaluate_unfinished_checklists(pg_temp.local_at(d, time '22:31'), tenant_s, 'incremental') from fx, checklist_day), 1, 'and is raised once it passed');

select is((select app.evaluate_oa_activity('2026-08-20 09:00+07', tenant_s, 'nightly') from fx), 0, 'oa_inactive: 141 days without activity toward followers raise nothing');
select is((select app.evaluate_oa_activity('2026-09-01 09:00+07', tenant_s, 'nightly') from fx), 1, 'from 150 days the owner is warned');
select is(
  (select e.facts from public.alert_events e where e.id = pg_temp.episode('oa_inactive:oa:' || (select oa_s from fx))),
  '{"days_inactive": 153, "warn_after_days": 150, "lock_after_days": 180, "days_left": 27, "activity_recorded": false}'::jsonb,
  'its facts count the days, the threshold and the days left before Zalo may lock the OA'
);
select is(pg_temp.reached(pg_temp.episode('oa_inactive:oa:' || (select oa_s from fx))), 'owner_s', 'it reaches the owner only');
select app.evaluate_oa_activity('2026-09-02 09:00+07', tenant_s, 'nightly') from fx;
select is(
  (select e.occurrences || ':' || (select count(*) from public.outbound_messages o where o.alert_event_id = e.id) from public.alert_events e where e.id = pg_temp.episode('oa_inactive:oa:' || (select oa_s from fx))),
  '2:1',
  'the next night repeats it silently'
);
select app.evaluate_oa_activity('2026-09-08 09:00+07', tenant_s, 'nightly') from fx;
select is(pg_temp.reached(pg_temp.episode('oa_inactive:oa:' || (select oa_s from fx)), 'alert_reminder'), 'owner_s', 'a week after the warning comes a reminder');
insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
select tenant_s, oa_s, encode(sha256(convert_to('staff-rules-oa-1', 'UTF8')), 'hex'), 'oa_send_text', 'synthetic-follower', '2026-09-09 10:00+07'::timestamptz, '2026-09-09 10:00+07'::timestamptz, 'raw' from fx
union all
select tenant_s, oa_s, encode(sha256(convert_to('staff-rules-oa-2', 'UTF8')), 'hex'), 'oa_send_text', 'synthetic-follower', '2026-09-09 12:00+07', '2026-09-09 12:00+07', 'mismatch' from fx
union all
select tenant_s, oa_s, encode(sha256(convert_to('staff-rules-oa-3', 'UTF8')), 'hex'), 'user_send_text', 'synthetic-follower', '2026-09-09 13:00+07', '2026-09-09 13:00+07', 'raw' from fx;
select is(
  (select a.last_sent_at from app.oa_follower_activity a where a.oa_id = (select oa_s from fx)),
  '2026-09-09 10:00+07'::timestamptz,
  'only a verified oa_send_ event counts as activity toward followers; a follower''s message or an unverified event does not'
);
select app.evaluate_oa_activity('2026-09-10 09:00+07', tenant_s, 'nightly') from fx;
select is(
  (select e.state || ':' || e.resolution from public.alert_events e where e.id = pg_temp.episode('oa_inactive:oa:' || (select oa_s from fx))),
  'resolved:recovered',
  'activity resolves the warning'
);

select is((select app.evaluate_mini_app_visits('2026-09-05 10:00+07', tenant_s, 'nightly') from fx), 0, 'mini_app_visits_low: nothing in the first days of a month');
select is((select app.evaluate_mini_app_visits('2026-09-10 10:00+07', tenant_s, 'nightly') from fx), 1, 'two visits in ten days project six for the month, under ten: the owner is warned');
select is(
  (select e.facts from public.alert_events e where e.id = pg_temp.episode('mini_app_visits_low:mini_app:' || (select mini_app_s from fx) || ':2026-09')),
  '{"app_kind": "staff", "visits": 2, "projected": 6, "min_visits": 10, "days_elapsed": 10, "days_in_month": 30}'::jsonb,
  'its facts are the month''s counts and the projection'
);
select is(pg_temp.reached(pg_temp.episode('mini_app_visits_low:mini_app:' || (select mini_app_s from fx) || ':2026-09')), 'owner_s', 'it reaches the owner only');
select app.record_mini_app_visit(zalo_app_s, 'staff', '2026-09-11 08:00+07') from fx;
select app.record_mini_app_visit(zalo_app_s, 'staff', '2026-09-11 09:00+07') from fx;
select app.evaluate_mini_app_visits('2026-09-11 10:00+07', tenant_s, 'nightly') from fx;
select is(
  (select e.state || ':' || e.resolution from public.alert_events e where e.id = pg_temp.episode('mini_app_visits_low:mini_app:' || (select mini_app_s from fx) || ':2026-09')),
  'resolved:cleared',
  'four visits in eleven days project ten: the warning clears'
);
select is((select app.evaluate_mini_app_visits('2026-09-20 10:00+07', tenant_s, 'nightly') from fx), 0, 'a month that already cleared is not warned again');
select is((select app.evaluate_mini_app_visits('2026-10-09 10:00+07', tenant_s, 'nightly') from fx), 1, 'a month without visits is warned');
select app.evaluate_mini_app_visits('2026-11-02 10:00+07', tenant_s, 'nightly') from fx;
select is(
  (select e.state || ':' || e.resolution from public.alert_events e where e.id = pg_temp.episode('mini_app_visits_low:mini_app:' || (select mini_app_s from fx) || ':2026-10')),
  'resolved:superseded',
  'its warning ends with the month'
);

select is(
  (select string_agg(pg_temp.person(d.run_as) || ':' || d.business_date || ':' || d.visibility || ':' || cardinality(d.channel_ids), ',' order by pg_temp.person(d.run_as))
   from fx, app.due_staff_digests('2026-09-11 08:00+07', fx.tenant_s) d),
  'staff_s1:2026-09-10:all:1,staff_s2:2026-09-10:all:1,staff_s3:2026-09-10:all:1',
  'staff digests are due per store scope of staff destinations only, built as a staff member'
);
select is((select count(*)::integer from fx, app.due_staff_digests('2026-09-11 06:59+07', fx.tenant_s) d), 0, 'not before the deadline hour of the next morning');
update public.tenants set staff_revenue_visibility = 'none' where id = (select tenant_s from fx);
select is((select string_agg(distinct d.visibility, ',') from fx, app.due_staff_digests('2026-09-11 08:00+07', fx.tenant_s) d), 'none', 'each due digest carries the owner''s visibility level for the builder');
select throws_ok(
  $q$ select app.enqueue_staff_digest_message((select c.id from public.notification_channels c where c.user_id = 'eeeeeeee-eeee-4eee-8eee-000000005602'), '2026-09-10', array['ffffffff-ffff-4fff-8fff-000000005601']::uuid[], null, 'Bản tin', '2026-09-11 08:00+07') $q$,
  '22023', null,
  'the staff digest is never queued for a manager'
);
select throws_ok(
  $q$ select app.enqueue_staff_digest_message((select c.id from public.notification_channels c where c.user_id = 'eeeeeeee-eeee-4eee-8eee-000000005605'), '2026-09-10', array['ffffffff-ffff-4fff-8fff-000000005602']::uuid[], null, 'Bản tin', '2026-09-11 08:00+07') $q$,
  '22023', null,
  'nor for stores outside the staff member''s scope'
);
create temp table staff_digest_message as
select app.enqueue_staff_digest_message(c.id, '2026-09-10', array[fx.store_s1], null, 'Bản tin hôm qua: 3 checklist đã xong.', '2026-09-11 08:00+07') as id
from fx join public.notification_channels c on c.user_id = fx.staff_s1;
select is(
  (select o.kind || ':' || o.template_ref || ':' || o.business_date || ':' || (o.params = '{"store_count": 1, "visibility": "none", "business_date": "2026-09-10"}'::jsonb) from public.outbound_messages o where o.id = (select id from staff_digest_message)),
  'staff_digest:staff_digest.v1:2026-09-10:true',
  'the staff digest is queued with count-only parameters and the visibility it was built under'
);
select is(
  (select app.enqueue_staff_digest_message(c.id, '2026-09-10', array[fx.store_s1], null, 'Bản tin khác', '2026-09-11 08:05+07') from fx join public.notification_channels c on c.user_id = fx.staff_s1),
  (select id from staff_digest_message),
  'a repeat returns the first message'
);
update public.notification_channels set muted_rules = array['staff_daily_digest'] where user_id = (select staff_s2 from fx);
select is(
  (select string_agg(pg_temp.person(d.run_as), ',' order by pg_temp.person(d.run_as)) from fx, app.due_staff_digests('2026-09-11 08:00+07', fx.tenant_s) d),
  'staff_s3',
  'a destination that has its digest, or mutes it, is no longer due'
);

select is(
  (select string_agg(pg_temp.person(c.user_id), ',' order by pg_temp.person(c.user_id)) from fx, app.alert_destinations(fx.tenant_s, fx.store_s1, null, 'cash_count_variance') d join public.notification_channels c on c.id = d.channel_id),
  'manager_all,manager_s1,owner_s',
  'drawer variance (cash_count_variance) reaches the store''s managers and the owner, never staff'
);
select is(
  (select jsonb_object_keys_sorted from (select string_agg(k, ',' order by k) as jsonb_object_keys_sorted from jsonb_object_keys(app.evaluate_staff_rules('2026-09-11 08:00+07', (select tenant_s from fx), 'nightly')) as k) x),
  'abnormal_voids,checklist_unfinished,mini_app_visits_low,oa_inactive,staff_sync_stale,voucher_spike',
  'one call evaluates every staff rule and monitor and returns count-only figures'
);
select is(
  (select r.outcome || ':' || r.messages from fx, app.record_job_event('zalo_tokens', 'failure', 11, 1, null, '2026-09-12 10:00+07', fx.tenant_s) r),
  'opened:1',
  'a failed run of the Zalo token workflow is recorded under its own key and reaches the owner'
);
select is(
  (select e.facts ->> 'workflow' from public.alert_events e where e.id = pg_temp.episode('job_failed:workflow:zalo_tokens')),
  'zalo_tokens',
  'its facts name the workflow by its key'
);
select throws_ok($q$ select * from app.record_job_event('zalo', 'failure', 12, 1, null, now(), 'dddddddd-dddd-4ddd-8ddd-000000005601') $q$, '22023', null, 'a workflow key outside the list is still refused');
update public.oas set package_expires_on = date '2026-10-02' where id = (select oa_s from fx);
select is((select app.check_oa_package_expiry('2026-09-12 10:00+07', tenant_s, 'scheduler') from fx), 1, 'the first package notice opens');
select is(
  (select e.facts ->> 'brand' || ':' || (e.facts ->> 'days_left') from public.alert_events e, fx where e.tenant_id = fx.tenant_s and e.rule_key = 'oa_package_expiring'),
  'brand-1:20',
  'the package notice names its brand by the neutral key, so the message can name the OA'
);
select ok(
  (select bool_and(app.facts_are_count_only(e.facts)) from public.alert_events e where e.tenant_id = (select tenant_s from fx)),
  'every episode''s facts are count-only'
);
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_s from fx)
   and (e.facts::text ~ '(bí mật|Việc |cashier|GIAM|Ca POS|example)' or exists (select 1 from jsonb_object_keys(e.facts) as k where k ~ '(amount|revenue|sales|cash|name|code|title)'))),
  0,
  'no fact holds a title, a label, a name, a voucher code or an amount'
);
select is(
  (select count(*)::integer from public.outbound_messages o where o.tenant_id = (select tenant_s from fx) and o.kind like 'alert%'
   and (coalesce(o.params::text, '') || coalesce(o.title, '') || coalesce(o.body, '')) ~ '(bí mật|Việc |cashier|GIAM|Ca POS|example)'),
  0,
  'no alert message holds free text'
);

select * from finish();
rollback;
