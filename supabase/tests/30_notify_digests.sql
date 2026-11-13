begin;
select plan(84);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000030000001'::uuid as tenant_1,
  'ffffffff-ffff-4fff-8fff-000030000002'::uuid as tenant_2,
  'ffffffff-ffff-4fff-8fff-000030000003'::uuid as tenant_3,
  'ffffffff-ffff-4fff-8fff-000030000004'::uuid as tenant_4,
  'ffffffff-ffff-4fff-8fff-000030000101'::uuid as owner_1,
  'ffffffff-ffff-4fff-8fff-000030000102'::uuid as manager_1,
  'ffffffff-ffff-4fff-8fff-000030000103'::uuid as staff_1,
  'ffffffff-ffff-4fff-8fff-000030000104'::uuid as owner_2,
  'ffffffff-ffff-4fff-8fff-000030000105'::uuid as owner_3,
  'ffffffff-ffff-4fff-8fff-000030000106'::uuid as owner_4,
  'ffffffff-ffff-4fff-8fff-000030000201'::uuid as account_1,
  'ffffffff-ffff-4fff-8fff-000030000202'::uuid as account_2,
  'ffffffff-ffff-4fff-8fff-000030000203'::uuid as account_3,
  'ffffffff-ffff-4fff-8fff-000030000204'::uuid as account_4,
  'ffffffff-ffff-4fff-8fff-000030000301'::uuid as s1,
  'ffffffff-ffff-4fff-8fff-000030000302'::uuid as s2,
  'ffffffff-ffff-4fff-8fff-000030000303'::uuid as s3,
  'ffffffff-ffff-4fff-8fff-000030000304'::uuid as s4,
  'ffffffff-ffff-4fff-8fff-000030000305'::uuid as s5,
  'ffffffff-ffff-4fff-8fff-000030000306'::uuid as s6,
  'ffffffff-ffff-4fff-8fff-000030000308'::uuid as s8,
  'ffffffff-ffff-4fff-8fff-000030000309'::uuid as s9;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_1, 'digests-owner-1@example.com'),
    (fx.manager_1, 'digests-manager-1@example.com'),
    (fx.staff_1, 'digests-staff-1@example.com'),
    (fx.owner_2, 'digests-owner-2@example.com'),
    (fx.owner_3, 'digests-owner-3@example.com'),
    (fx.owner_4, 'digests-owner-4@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_1, 'notify-it-pgtap-digests-1', 'Notify pgTAP digests 1', 'Asia/Ho_Chi_Minh' from fx
union all select tenant_2, 'notify-it-pgtap-digests-2', 'Notify pgTAP digests 2', 'Asia/Ho_Chi_Minh' from fx
union all select tenant_3, 'notify-it-pgtap-digests-3', 'Notify pgTAP digests 3', 'Asia/Ho_Chi_Minh' from fx
union all select tenant_4, 'notify-it-pgtap-digests-4', 'Notify pgTAP digests 4', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_1, owner_1, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_1, manager_1, 'manager'::public.tenant_role, array[s1] from fx
union all select tenant_1, staff_1, 'staff'::public.tenant_role, null::uuid[] from fx
union all select tenant_2, owner_2, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_3, owner_3, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_4, owner_4, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_1, tenant_1, 'mock', 'digests-pgtap-account-1', 'Synthetic account 1' from fx
union all select account_2, tenant_2, 'mock', 'digests-pgtap-account-2', 'Synthetic account 2' from fx
union all select account_3, tenant_3, 'mock', 'digests-pgtap-account-3', 'Synthetic account 3' from fx
union all select account_4, tenant_4, 'mock', 'digests-pgtap-account-4', 'Synthetic account 4' from fx;

create temp table hours as
select
  '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb as day_07_22,
  '{"tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb as closed_monday,
  '{"mon": [["10:00", "01:00"]], "tue": [["10:00", "01:00"]], "wed": [["10:00", "01:00"]], "thu": [["10:00", "01:00"]], "fri": [["10:00", "01:00"]], "sat": [["10:00", "01:00"]], "sun": [["10:00", "01:00"]]}'::jsonb as late_10_01,
  '{"mon": [["18:00", "02:00"]], "tue": [["18:00", "02:00"]], "wed": [["18:00", "02:00"]], "thu": [["18:00", "02:00"]], "fri": [["18:00", "02:00"]], "sat": [["18:00", "02:00"]], "sun": [["18:00", "02:00"]]}'::jsonb as night_18_02,
  '{"mon": [["08:00", "22:00"]], "tue": [["08:00", "22:00"]], "wed": [["08:00", "22:00"]], "thu": [["08:00", "22:00"]], "fri": [["08:00", "22:00"]], "sat": [["08:00", "22:00"]], "sun": [["08:00", "22:00"]]}'::jsonb as day_08_22;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
select s1, tenant_1, account_1, 's1', 'Synthetic store 1', 'Asia/Ho_Chi_Minh', 0, h.day_07_22 from fx, hours h
union all select s2, tenant_1, account_1, 's2', 'Synthetic store 2', 'Asia/Ho_Chi_Minh', 0, null::jsonb from fx, hours h
union all select s4, tenant_2, account_2, 's4', 'Synthetic store 4', 'Asia/Tokyo', 0, h.day_08_22 from fx, hours h
union all select s8, tenant_2, account_2, 's8', 'Synthetic store 8', 'Asia/Ho_Chi_Minh', 0, h.day_07_22 from fx, hours h
union all select s9, tenant_3, account_3, 's9', 'Synthetic store 9', 'Asia/Ho_Chi_Minh', 0, h.day_07_22 from fx, hours h
union all select s3, tenant_3, account_3, 's3', 'Synthetic store 3', 'Asia/Ho_Chi_Minh', 300, h.late_10_01 from fx, hours h
union all select s5, tenant_4, account_4, 's5', 'Synthetic store 5', 'Asia/Ho_Chi_Minh', 0, h.closed_monday from fx, hours h
union all select s6, tenant_4, account_4, 's6', 'Synthetic store 6', 'Asia/Ho_Chi_Minh', 0, h.night_18_02 from fx, hours h;

insert into public.sync_checks (tenant_id, store_id, business_date)
select s.tenant_id, s.id, d.day::date
from public.stores s
cross join fx
cross join generate_series('2026-11-15'::date, '2026-11-20'::date, interval '1 day') as d (day)
where s.id in (fx.s1, fx.s2, fx.s4, fx.s8, fx.s9, fx.s3, fx.s5)
  and (s.id not in (fx.s1, fx.s2, fx.s3, fx.s9) or d.day >= '2026-11-17');

create temp table consent_ids as
select
  app.ensure_notifications_consent(tenant_1, owner_1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_1,
  app.ensure_notifications_consent(tenant_1, manager_1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as manager_1,
  app.ensure_notifications_consent(tenant_1, staff_1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as staff_1,
  app.ensure_notifications_consent(tenant_2, owner_2, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_2,
  app.ensure_notifications_consent(tenant_3, owner_3, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_3,
  app.ensure_notifications_consent(tenant_4, owner_4, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_4
from fx;

insert into public.notification_channels (
  tenant_id, kind, provider, label, user_id, address, secret_name, config, status, linked_at, consent_record_id, store_ids, muted_rules, disabled_reason
)
select
  case v.tenant when 1 then fx.tenant_1 when 2 then fx.tenant_2 when 3 then fx.tenant_3 else fx.tenant_4 end,
  v.kind::public.channel_kind,
  v.provider,
  v.label,
  case v.member when 'owner_1' then fx.owner_1 when 'manager_1' then fx.manager_1 when 'staff_1' then fx.staff_1
    when 'owner_2' then fx.owner_2 when 'owner_3' then fx.owner_3 when 'owner_4' then fx.owner_4 end,
  v.address,
  v.secret_name,
  v.config::jsonb,
  v.status,
  case when v.status = 'pending' then null else '2026-11-10 00:00+00'::timestamptz end,
  case v.member when 'owner_1' then c.owner_1 when 'manager_1' then c.manager_1 when 'staff_1' then c.staff_1
    when 'owner_2' then c.owner_2 when 'owner_3' then c.owner_3 when 'owner_4' then c.owner_4 end,
  case v.stores when 's1' then array[fx.s1] when 's5' then array[fx.s5] end,
  v.muted::text[],
  null
from fx
cross join consent_ids c
cross join (
  values
    (1, 'owner zalo', 'zalo_bot', 'zalo_bot', 'owner_1', 'synthetic-chat-301', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}'),
    (1, 'owner mail', 'email', 'brevo', 'owner_1', null, 'NOTIFY_EMAIL_API_KEY_IT', '{}', 'active', 's1', '{}'),
    (1, 'manager zalo', 'zalo_bot', 'zalo_bot', 'manager_1', 'synthetic-chat-302', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}'),
    (1, 'staff zalo', 'zalo_bot', 'zalo_bot', 'staff_1', 'synthetic-chat-303', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}'),
    (1, 'owner muted', 'zalo_bot', 'zalo_bot', 'owner_1', 'synthetic-chat-304', 'NOTIFY_ZALO_BOT_TOKEN_IT2', '{}', 'active', null, '{daily_digest}'),
    (1, 'owner pending', 'zalo_bot', 'zalo_bot', 'owner_1', null, 'NOTIFY_ZALO_BOT_TOKEN_IT3', '{}', 'pending', null, '{}'),
    (1, 'webhook', 'webhook', 'hmac_webhook', null, null, 'NOTIFY_WEBHOOK_SECRET_IT', '{"url": "https://hooks.example.com/fnb/alerts"}', 'active', null, '{}'),
    (2, 'owner 2', 'zalo_bot', 'zalo_bot', 'owner_2', 'synthetic-chat-311', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}'),
    (3, 'owner 3', 'zalo_bot', 'zalo_bot', 'owner_3', 'synthetic-chat-321', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', null, '{}'),
    (4, 'owner 4', 'zalo_bot', 'zalo_bot', 'owner_4', 'synthetic-chat-331', 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}', 'active', 's5', '{}')
) as v (tenant, label, kind, provider, member, address, secret_name, config, status, stores, muted);

create function pg_temp.ch(p_label text)
returns uuid
language sql
as $$
  select c.id from public.notification_channels c
  where c.label = p_label
    and c.tenant_id in (select tenant_1 from fx union all select tenant_2 from fx union all select tenant_3 from fx union all select tenant_4 from fx);
$$;

create function pg_temp.run(p_stores uuid[], p_kind text, p_status text, p_started timestamptz, p_finished timestamptz, p_from date, p_to date)
returns uuid
language sql
as $$
  insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
  select s.tenant_id, s.pos_account_id, case when cardinality(p_stores) = 1 then s.id end, p_stores, p_kind::public.sync_kind,
         p_from, p_to, p_started, p_finished, p_status::public.sync_status
  from public.stores s
  where s.id = p_stores[1]
  returning id;
$$;

create function pg_temp.due(p_tenant uuid, p_at timestamptz)
returns text[]
language sql
as $$
  select coalesce(array_agg(x.line order by x.line), '{}'::text[])
  from (
    select to_char(d.business_date, 'YYYY-MM-DD') || ':' || d.trigger || ':'
      || (select string_agg(s.external_id, ',' order by s.external_id) from public.stores s where s.id = any (d.store_ids)) as line
    from app.due_digests(p_at, p_tenant) d
  ) x;
$$;

create function pg_temp.due_at(p_tenant uuid, p_at timestamptz, p_externals text)
returns timestamptz
language sql
as $$
  select d.due_at
  from app.due_digests(p_at, p_tenant) d
  where (select string_agg(s.external_id, ',' order by s.external_id) from public.stores s where s.id = any (d.store_ids)) = p_externals;
$$;

create function pg_temp.scope_key(variadic p_ids uuid[])
returns text
language sql
as $$
  select md5(string_agg(x.id::text, ',' order by x.id::text)) from unnest(p_ids) as x (id);
$$;

create function pg_temp.fact(p_tenant uuid, p_at timestamptz, p_externals text, p_store uuid)
returns jsonb
language sql
as $$
  select f.value
  from app.due_digests(p_at, p_tenant) d
  cross join lateral jsonb_array_elements(d.store_facts) as f (value)
  where (select string_agg(s.external_id, ',' order by s.external_id) from public.stores s where s.id = any (d.store_ids)) = p_externals
    and f.value ->> 'store_id' = p_store::text;
$$;

select is(app.store_day_close_at((select s1 from fx), '2026-11-17'), '2026-11-17 15:00+00'::timestamptz, 'known hours close at the end of the last span (22:00 local)');
select is(app.store_day_close_at((select s2 from fx), '2026-11-17'), '2026-11-17 17:00+00'::timestamptz, 'unknown hours close at the end of the business day');
select is(app.store_day_close_at((select s5 from fx), '2026-11-16'), '2026-11-15 17:00+00'::timestamptz, 'a scheduled closed day closes at its start');
select is(app.store_day_close_at((select s3 from fx), '2026-11-17'), '2026-11-17 18:00+00'::timestamptz, 'with a 05:00 day start the 01:00 close falls on the next calendar day');
select is(app.store_day_close_at((select s6 from fx), '2026-11-17'), '2026-11-17 19:00+00'::timestamptz, 'a span past midnight closes at 02:00 the next morning');
select is(app.store_day_close_at((select s4 from fx), '2026-11-17'), '2026-11-17 13:00+00'::timestamptz, 'a Tokyo store closes at 22:00 Tokyo time');

insert into public.shifts (tenant_id, store_id, external_id, opened_at, closed_at)
select tenant_1, s1, 'shift-1', '2026-11-17 00:00+00'::timestamptz, '2026-11-17 07:00+00'::timestamptz from fx
union all select tenant_1, s1, 'shift-2', '2026-11-17 07:00+00'::timestamptz, '2026-11-17 15:40+00'::timestamptz from fx
union all select tenant_1, s1, 'shift-0', '2026-11-16 16:30+00'::timestamptz, null::timestamptz from fx
union all select tenant_3, s3, 'shift-late', '2026-11-18 21:30+00'::timestamptz, '2026-11-18 21:45+00'::timestamptz from fx;

select is((select sh.open_shifts || ':' || sh.last_closed_at from app.store_day_shift_state((select s1 from fx), '2026-11-17') sh), '0:' || '2026-11-17 15:40+00'::timestamptz, 'the shifts opened within the business day: none open, the last closed at 22:40 local');
select is((select sh.open_shifts || ':' || coalesce(sh.last_closed_at::text, 'none') from app.store_day_shift_state((select s1 from fx), '2026-11-16') sh), '1:none', 'a shift opened at 23:30 belongs to its own business day and is still open');
select is((select sh.open_shifts || ':' || sh.last_closed_at from app.store_day_shift_state((select s3 from fx), '2026-11-18') sh), '0:' || '2026-11-18 21:45+00'::timestamptz, 'with a 05:00 day start a shift opened at 04:30 belongs to the previous business day');
select is((select sh.open_shifts || ':' || coalesce(sh.last_closed_at::text, 'none') from app.store_day_shift_state((select s3 from fx), '2026-11-19') sh), '0:none', 'a day without shifts has none open and no close');

select pg_temp.run(array[(select s1 from fx)], 'incremental', 'succeeded', '2026-11-17 15:00+00', '2026-11-17 15:05+00', '2026-11-17', '2026-11-17');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-17'), null::timestamptz, 'a run started at the closing instant does not settle the day');
select pg_temp.run(array[(select s1 from fx)], 'incremental', 'succeeded', '2026-11-17 16:05+00', '2026-11-17 16:07+00', '2026-11-17', '2026-11-17');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-17'), null::timestamptz, 'with a shift closed at 22:40 a run started at 23:05 does not settle the day');
select pg_temp.run(array[(select s1 from fx)], 'incremental', 'succeeded', '2026-11-17 16:10+00', '2026-11-17 16:12+00', '2026-11-17', '2026-11-17');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-17'), '2026-11-17 16:12+00'::timestamptz, 'a run started at 23:10 settles the day when it ends');
select pg_temp.run(array[(select s1 from fx)], 'incremental', 'succeeded', '2026-11-18 15:00+00', '2026-11-18 15:02+00', '2026-11-18', '2026-11-18');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-18'), null::timestamptz, 'without shifts the run at the closing instant still does not count');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-18', interval '0'), '2026-11-18 15:02+00'::timestamptz, 'with a grace of 0 the run at the closing instant counts');

select pg_temp.run(array[(select s2 from fx)], 'incremental', 'failed', '2026-11-17 18:00+00', '2026-11-17 18:01+00', '2026-11-17', '2026-11-17');
select pg_temp.run(array[(select s2 from fx)], 'master_data', 'succeeded', '2026-11-17 18:10+00', '2026-11-17 18:11+00', null, null);
select pg_temp.run(array[(select s2 from fx)], 'backfill', 'succeeded', '2026-11-17 18:30+00', '2026-11-17 18:31+00', '2026-11-18', '2026-11-18');
select is(app.store_day_settled_at((select s2 from fx), '2026-11-17'), null::timestamptz, 'failed runs, master data runs, other stores'' runs and ranges without the day settle nothing');
select pg_temp.run(array[(select s1 from fx), (select s2 from fx)], 'nightly', 'succeeded', '2026-11-17 20:23+00', '2026-11-17 20:30+00', '2026-11-16', '2026-11-17');
select is(app.store_day_settled_at((select s2 from fx), '2026-11-17'), '2026-11-17 20:30+00'::timestamptz, 'the nightly settles a store with unknown hours');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-17'), '2026-11-17 16:12+00'::timestamptz, 'the earliest qualifying run settles the day');
insert into public.shifts (tenant_id, store_id, external_id, opened_at, closed_at)
select tenant_1, s2, 'shift-open-19', '2026-11-19 03:00+00'::timestamptz, null::timestamptz from fx
union all select tenant_1, s2, 'shift-open-18', '2026-11-18 10:00+00'::timestamptz, null from fx;
select pg_temp.run(array[(select s1 from fx), (select s2 from fx)], 'nightly', 'succeeded', '2026-11-19 20:23+00', '2026-11-19 20:30+00', '2026-11-18', '2026-11-19');
select is(app.store_day_settled_at((select s2 from fx), '2026-11-19'), null::timestamptz, 'an open shift settles nothing, whatever runs follow');
select is(app.store_day_settled_at((select s1 from fx), '2026-11-19'), '2026-11-19 20:30+00'::timestamptz, 'the nightly settles the other store of the run');
select is(app.store_day_settled_at((select s5 from fx), '2026-11-16'), '2026-11-15 17:00+00'::timestamptz, 'a scheduled closed day is settled at its start without a run');

select is(pg_temp.due((select tenant_1 from fx), '2026-11-17 20:25+00'), array['2026-11-17:settled:s1'], 'the one-store scope is due once its store settled; the two-store scope waits for the nightly');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-17 20:35+00'), array['2026-11-17:settled:s1', '2026-11-17:settled:s1,s2'], 'once every store settled, both scopes are due');
create temp table due_both as
select d.*
from app.due_digests('2026-11-17 20:35+00', (select tenant_1 from fx)) d
where cardinality(d.store_ids) = 2;
create temp table due_one as
select d.*
from app.due_digests('2026-11-17 20:35+00', (select tenant_1 from fx)) d
where cardinality(d.store_ids) = 1;
select ok(
  (select d.scope_key = pg_temp.scope_key(fx.s1, fx.s2) and d.store_ids = array[fx.s1, fx.s2] and d.all_stores and d.due_at = '2026-11-17 20:30+00'
     and d.run_as = fx.owner_1 and d.channel_ids = array[pg_temp.ch('owner zalo')]
   from due_both d, fx),
  'the two-store scope: key, sorted stores, all stores, the latest settle as due_at, the member and the one destination'
);
select ok(
  (select d.scope_key = pg_temp.scope_key(fx.s1) and not d.all_stores and d.due_at = '2026-11-17 16:12+00' and d.run_as = fx.owner_1
     and d.channel_ids = (select array_agg(x order by x::text) from unnest(array[pg_temp.ch('owner mail'), pg_temp.ch('manager zalo')]) as x)
   from due_one d, fx),
  'members with the same store set share one scope: the narrowed owner mail and the store-limited manager, run as the smallest member id'
);
select is(
  (select count(*)::integer from due_both d cross join lateral unnest(d.channel_ids) as c (id) where c.id in (pg_temp.ch('staff zalo'), pg_temp.ch('owner muted'), pg_temp.ch('owner pending'), pg_temp.ch('webhook')))
  + (select count(*)::integer from due_one d cross join lateral unnest(d.channel_ids) as c (id) where c.id in (pg_temp.ch('staff zalo'), pg_temp.ch('owner muted'), pg_temp.ch('owner pending'), pg_temp.ch('webhook'))),
  0,
  'a staff member, a destination muting daily_digest, a pending destination and a webhook get no digest'
);
select is(
  pg_temp.fact((select tenant_1 from fx), '2026-11-17 20:35+00', 's1,s2', (select s1 from fx)) - 'close_at' - 'last_shift_closed_at' - 'settled_at',
  jsonb_build_object('store_id', (select s1 from fx), 'opening_minutes', 900, 'open_shifts', 0, 'day_ended', true),
  'store facts carry the opening minutes, open shifts and whether the day ended'
);
select ok(
  (select (f ->> 'close_at')::timestamptz = '2026-11-17 15:00+00' and (f ->> 'last_shift_closed_at')::timestamptz = '2026-11-17 15:40+00'
     and (f ->> 'settled_at')::timestamptz = '2026-11-17 16:12+00'
   from pg_temp.fact((select tenant_1 from fx), '2026-11-17 20:35+00', 's1,s2', (select s1 from fx)) f),
  'store facts carry the close, the last shift close and the settle time'
);
select ok(
  (select f ->> 'opening_minutes' is null and jsonb_typeof(f -> 'opening_minutes') = 'null' and (f ->> 'settled_at')::timestamptz = '2026-11-17 20:30+00'
   from pg_temp.fact((select tenant_1 from fx), '2026-11-17 20:35+00', 's1,s2', (select s2 from fx)) f),
  'a store with unknown hours has null opening minutes'
);
select is((app.notify_tick_rules('2026-11-17 20:35+00', (select tenant_1 from fx)) ->> 'due_digests')::integer, 2, 'the tick counts the due digests');

insert into public.alert_rules (tenant_id, rule_key, enabled) select tenant_1, 'daily_digest', false from fx;
select is(pg_temp.due((select tenant_1 from fx), '2026-11-17 20:35+00'), '{}'::text[], 'a disabled daily_digest rule makes nothing due');
delete from public.alert_rules r where r.tenant_id = (select tenant_1 from fx);

create temp table built_17 as
select
  app.complete_digest(tenant_1, '2026-11-17', pg_temp.scope_key(s1, s2), array[s2, s1], true, 'settled', 'verified',
    '{"version": 1}'::jsonb, 1, repeat('a', 64), owner_1, '2026-11-17 20:40+00') as both_id,
  app.complete_digest(tenant_1, '2026-11-17', pg_temp.scope_key(s1), array[s1], false, 'settled', 'unverified',
    '{"version": 1}'::jsonb, 1, repeat('b', 64), owner_1, '2026-11-17 20:40+00') as one_id
from fx;
select ok((select both_id is not null and one_id is not null from built_17), 'complete_digest stores both built digests and returns their ids');
select ok(
  (select d.state = 'built' and d.store_ids = array[fx.s1, fx.s2] and d.all_stores and d.trigger = 'settled' and d.data_state = 'verified'
     and d.model_version = 1 and d.fingerprint = repeat('a', 64) and d.built_as = fx.owner_1 and d.built_at = '2026-11-17 20:40+00'
     and d.revision = 0 and d.attempts = 0
   from public.digests d, fx where d.id = (select both_id from built_17)),
  'the built digest keeps sorted stores, trigger, data state, model version, fingerprint, builder and time'
);
select is(
  app.complete_digest((select tenant_1 from fx), '2026-11-17', pg_temp.scope_key((select s1 from fx)), array[(select s1 from fx)], false, 'settled', 'verified',
    '{"version": 1}'::jsonb, 1, repeat('c', 64), (select owner_1 from fx), '2026-11-17 20:41+00'),
  null::uuid,
  'a second builder of the same digest gets null and stops'
);
select is((select d.fingerprint from public.digests d where d.id = (select one_id from built_17)), repeat('b', 64), 'the first build is kept');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-17 20:45+00'), '{}'::text[], 'built digests are not due again');

create temp table messages_17 as
select
  app.enqueue_digest_message(b.one_id, pg_temp.ch('owner mail'), 0, 'digest', 'Bản tin ngày 17/11/2026', 'synthetic digest text', '2026-11-17 20:40+00') as mail_id,
  app.enqueue_digest_message(b.one_id, pg_temp.ch('manager zalo'), 0, 'digest', null, 'synthetic digest text', '2026-11-17 20:40+00') as manager_id,
  app.enqueue_digest_message(b.both_id, pg_temp.ch('owner zalo'), 0, 'digest', null, 'synthetic digest text', '2026-11-17 20:40+00') as owner_id
from built_17 b;
select is(
  app.enqueue_digest_message((select one_id from built_17), pg_temp.ch('owner mail'), 0, 'digest', 'Bản tin ngày 17/11/2026', 'synthetic digest text', '2026-11-17 20:42+00'),
  (select mail_id from messages_17),
  'a repeated enqueue returns the first message'
);
select ok(
  (select o.kind = 'digest' and o.template_ref = 'digest.v1' and o.status = 'queued' and o.message_class = 'operational'
     and o.dedupe_key = 'digest:' || o.digest_id || ':' || o.channel_id || ':r0'
     and o.digest_id = (select one_id from built_17) and o.store_id = fx.s1 and o.business_date = '2026-11-17'
     and o.title = 'Bản tin ngày 17/11/2026' and o.body = 'synthetic digest text' and o.body_sha256 = app.sha256_hex('synthetic digest text')
     and o.expires_at = '2026-11-19 08:40+00' and o.severity = 'info' and o.purpose = 'notifications' and o.subject_id = fx.owner_1
   from public.outbound_messages o, fx where o.id = (select mail_id from messages_17)),
  'a digest message carries the pre-rendered text, the store of a one-store scope, the digest and a 36-hour expiry'
);
select is((select o.store_id from public.outbound_messages o where o.id = (select owner_id from messages_17)), null::uuid, 'a scope of several stores leaves store_id empty');
select is(
  (select count(*)::integer from public.outbound_messages o where o.digest_id in ((select one_id from built_17), (select both_id from built_17))),
  3,
  'one message per destination'
);
select throws_ok($$ select app.enqueue_digest_message((select one_id from built_17), pg_temp.ch('owner mail'), 0, 'digest_correction', null, 'x', now()) $$, '22023', null, 'a correction needs revision 1');
select throws_ok($$ select app.enqueue_digest_message((select one_id from built_17), pg_temp.ch('owner 2'), 0, 'digest', null, 'x', now()) $$, '22023', null, 'a destination of another tenant is refused');
select throws_ok($$ select app.complete_digest((select tenant_1 from fx), '2026-11-18', md5('not the stores'), array[(select s1 from fx)], false, 'settled', 'verified', '{}'::jsonb, 1, repeat('a', 64), null, now()) $$, '22023', null, 'a scope key that is not the md5 of the stores is refused');
select throws_ok($$ select app.complete_digest((select tenant_1 from fx), '2026-11-18', pg_temp.scope_key((select s4 from fx)), array[(select s4 from fx)], false, 'settled', 'verified', '{}'::jsonb, 1, repeat('a', 64), null, now()) $$, '22023', null, 'stores of another tenant are refused');
select throws_ok($$ select app.complete_digest((select tenant_1 from fx), '2026-11-18', pg_temp.scope_key((select s1 from fx)), array[(select s1 from fx)], false, 'nightly', 'verified', '{}'::jsonb, 1, repeat('a', 64), null, now()) $$, '22023', null, 'an unknown trigger is refused');
select throws_ok($$ select app.complete_digest((select tenant_1 from fx), '2026-11-18', pg_temp.scope_key((select s1 from fx)), array[(select s1 from fx)], false, 'settled', 'verified', '{}'::jsonb, 1, 'not-a-hash', null, now()) $$, '22023', null, 'a malformed fingerprint is refused');

select is(pg_temp.due((select tenant_1 from fx), '2026-11-18 23:00+00'), '{}'::text[], 'before the deadline an unsettled day waits');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-18 23:31+00'), array['2026-11-18:deadline:s1', '2026-11-18:deadline:s1,s2'], 'at 06:30 local the deadline makes the unsettled day due');
select is(pg_temp.due_at((select tenant_1 from fx), '2026-11-18 23:31+00', 's1,s2'), '2026-11-18 23:30+00'::timestamptz, 'due_at is the latest deadline of the unsettled stores');
select ok(
  (select (f ->> 'open_shifts')::integer = 1 and jsonb_typeof(f -> 'settled_at') = 'null' and (f ->> 'day_ended')::boolean
   from pg_temp.fact((select tenant_1 from fx), '2026-11-18 23:31+00', 's1,s2', (select s2 from fx)) f),
  'at the deadline the store with an open shift shows it'
);

select pg_temp.run(array[(select s1 from fx)], 'incremental', 'succeeded', '2026-11-19 16:00+00', '2026-11-19 16:01+00', '2026-11-19', '2026-11-19');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 16:30+00'), array['2026-11-18:deadline:s1,s2', '2026-11-19:settled:s1'], 'only the newest due date per scope: the one-store scope skips the 18th for the 19th');
select app.complete_digest(tenant_1, '2026-11-19', pg_temp.scope_key(s1), array[s1], false, 'settled', 'verified', '{"version": 1}'::jsonb, 1, repeat('d', 64), owner_1, '2026-11-19 16:31+00') from fx;
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 16:32+00'), array['2026-11-18:deadline:s1,s2'], 'an older date is never sent after a newer one was built');

create temp table failed_18 as
select app.fail_digest(tenant_1, '2026-11-18', pg_temp.scope_key(s1, s2), array[s1, s2], 'report_timeout', '2026-11-19 16:33+00') as id from fx;
select ok(
  (select d.state = 'failed' and d.attempts = 1 and d.next_attempt_at = '2026-11-19 16:38+00' and d.last_error_code = 'report_timeout'
   from public.digests d where d.id = (select id from failed_18)),
  'a failed build keeps a failed row with its first back-off of 5 minutes'
);
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 16:34+00'), '{}'::text[], 'a failed build waits for its back-off');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 16:39+00'), array['2026-11-18:deadline:s1,s2'], 'after the back-off it is due again');
select app.fail_digest(tenant_1, '2026-11-18', pg_temp.scope_key(s1, s2), array[s1, s2], 'Report failed: timeout', '2026-11-19 16:40+00') from fx;
select ok(
  (select d.attempts = 2 and d.next_attempt_at = '2026-11-19 16:55+00' and d.last_error_code = 'build_failed' from public.digests d where d.id = (select id from failed_18)),
  'the second failure waits 15 minutes and an error text is never stored'
);
select app.fail_digest(tenant_1, '2026-11-18', pg_temp.scope_key(s1, s2), array[s1, s2], 'report_timeout', '2026-11-19 17:00+00') from fx;
select is((select d.next_attempt_at from public.digests d where d.id = (select id from failed_18)), '2026-11-19 18:00+00'::timestamptz, 'the third failure waits 60 minutes');
select app.fail_digest(tenant_1, '2026-11-18', pg_temp.scope_key(s1, s2), array[s1, s2], 'report_timeout', '2026-11-19 18:05+00') from fx;
select is((select d.next_attempt_at from public.digests d where d.id = (select id from failed_18)), '2026-11-19 20:05+00'::timestamptz, 'the fourth failure waits 120 minutes');
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_1 from fx) and e.rule_key = 'digest_failed'),
  0,
  'four failures raise nothing yet'
);
select app.fail_digest(tenant_1, '2026-11-18', pg_temp.scope_key(s1, s2), array[s1, s2], 'report_timeout', '2026-11-19 20:10+00') from fx;
select ok(
  (select d.attempts = 5 and d.next_attempt_at is null from public.digests d where d.id = (select id from failed_18)),
  'the fifth failure stops the retries'
);
select ok(
  (select e.state = 'open' and e.business_date = '2026-11-18' and e.dedupe_key = 'digest_failed:digest:' || pg_temp.scope_key(fx.s1, fx.s2) || ':2026-11-18'
     and (e.facts ->> 'attempts')::integer = 5 and e.notifications = 4
     and (select array_agg(c.label order by c.label) from public.outbound_messages o join public.notification_channels c on c.id = o.channel_id where o.alert_event_id = e.id)
       = array['owner mail', 'owner muted', 'owner zalo', 'webhook']
   from public.alert_events e, fx where e.tenant_id = fx.tenant_1 and e.rule_key = 'digest_failed'),
  'the fifth failure raises digest_failed to the owner''s destinations and the webhook'
);
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 20:15+00'), '{}'::text[], 'a digest that failed five times is no longer due');

select is(
  app.complete_digest((select tenant_1 from fx), '2026-11-18', pg_temp.scope_key((select s1 from fx), (select s2 from fx)), array[(select s1 from fx), (select s2 from fx)], true, 'manual', 'partial',
    '{"version": 1}'::jsonb, 1, repeat('e', 64), (select owner_1 from fx), '2026-11-19 20:20+00'),
  (select id from failed_18),
  'a manual build turns the failed row into the built digest'
);
select ok(
  (select d.state = 'built' and d.trigger = 'manual' and d.next_attempt_at is null and d.last_error_code is null and d.attempts = 5 from public.digests d where d.id = (select id from failed_18)),
  'the built digest clears the back-off and keeps the attempt count'
);
select is(app.reconcile_alerts('2026-11-19 20:25+00', (select tenant_1 from fx)), 1, 'reconcile resolves digest_failed once the digest is built');
select is((select e.resolution from public.alert_events e where e.tenant_id = (select tenant_1 from fx) and e.rule_key = 'digest_failed'), 'cleared', 'the digest failure is cleared');
select is(
  app.fail_digest((select tenant_1 from fx), '2026-11-18', pg_temp.scope_key((select s1 from fx), (select s2 from fx)), array[(select s1 from fx), (select s2 from fx)], 'report_timeout', '2026-11-19 20:30+00'),
  null::uuid,
  'a failure after the digest was built changes nothing'
);

select app.enqueue_digest_message((select id from failed_18), pg_temp.ch('owner zalo'), 0, 'digest', null, 'synthetic digest text', '2026-11-19 20:20+00');
update public.notification_channels c set store_ids = array[(select s2 from fx)] where c.id = pg_temp.ch('owner zalo');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 20:35+00'), '{}'::text[], 'a destination narrowed after its digest was sent gets no second digest for that date');
select is(pg_temp.due((select tenant_1 from fx), '2026-11-19 23:31+00'), array['2026-11-19:deadline:s2'], 'the narrowed destination gets its new scope from the next date');
update public.notification_channels c set store_ids = null where c.id = pg_temp.ch('owner zalo');

select pg_temp.run(array[(select s4 from fx), (select s8 from fx)], 'incremental', 'succeeded', '2026-11-17 15:40+00', '2026-11-17 15:45+00', '2026-11-17', '2026-11-17');
select is(pg_temp.due((select tenant_2 from fx), '2026-11-17 15:50+00'), array['2026-11-17:settled:s4,s8'], 'Tokyo and Ho Chi Minh City: due once the later store settled');
update public.notification_channels c set linked_at = '2026-11-19 03:00+00' where c.id = pg_temp.ch('owner 2');
select is(pg_temp.due((select tenant_2 from fx), '2026-11-17 15:50+00'), '{}'::text[], 'never a date before the day before the link');
update public.notification_channels c set linked_at = '2026-11-10 00:00+00' where c.id = pg_temp.ch('owner 2');
delete from public.sync_runs r where r.tenant_id = (select tenant_2 from fx);
select pg_temp.run(array[(select s4 from fx)], 'incremental', 'succeeded', '2026-11-17 13:40+00', '2026-11-17 13:41+00', '2026-11-17', '2026-11-17');
select is(pg_temp.due((select tenant_2 from fx), '2026-11-17 22:00+00'), '{}'::text[], 'past the Tokyo deadline the scope still waits for the Ho Chi Minh City store''s deadline');
select is(pg_temp.due((select tenant_2 from fx), '2026-11-17 23:31+00'), array['2026-11-17:deadline:s4,s8'], 'at 06:30 in Ho Chi Minh City the scope is due by deadline');
select ok(
  (select (f ->> 'settled_at')::timestamptz = '2026-11-17 13:41+00' from pg_temp.fact((select tenant_2 from fx), '2026-11-17 23:31+00', 's4,s8', (select s4 from fx)) f)
  and (select jsonb_typeof(f -> 'settled_at') = 'null' from pg_temp.fact((select tenant_2 from fx), '2026-11-17 23:31+00', 's4,s8', (select s8 from fx)) f),
  'the deadline digest knows which store settled'
);

select pg_temp.run(array[(select s9 from fx)], 'incremental', 'succeeded', '2026-11-17 15:40+00', '2026-11-17 15:41+00', '2026-11-17', '2026-11-17');
select is(pg_temp.due((select tenant_3 from fx), '2026-11-17 18:20+00'), '{}'::text[], 'a store closing at 01:00 with a 05:00 day start keeps the scope waiting');
select is(pg_temp.due((select tenant_3 from fx), '2026-11-17 23:31+00'), array['2026-11-17:deadline:s3,s9'], 'without the later store''s sync the deadline builds a partial digest at 06:30');
select pg_temp.run(array[(select s3 from fx)], 'incremental', 'succeeded', '2026-11-17 18:35+00', '2026-11-17 18:36+00', '2026-11-17', '2026-11-17');
select is(pg_temp.due((select tenant_3 from fx), '2026-11-17 18:40+00'), array['2026-11-17:settled:s3,s9'], 'with it the scope is due after the later settle');
select is(pg_temp.due_at((select tenant_3 from fx), '2026-11-17 18:40+00', 's3,s9'), '2026-11-17 18:36+00'::timestamptz, 'due_at is the later store''s settle time');

select is(pg_temp.due((select tenant_4 from fx), '2026-11-16 23:00+00'), '{}'::text[], 'a scope whose every store is closed that day gets no digest');
insert into public.alert_rules (tenant_id, rule_key, params) select tenant_4, 'daily_digest', '{"skip_closed_days": false}'::jsonb from fx;
select is(pg_temp.due((select tenant_4 from fx), '2026-11-16 23:00+00'), array['2026-11-16:settled:s5'], 'without skip_closed_days the closed day is due, settled at its start');
delete from public.alert_rules r where r.tenant_id = (select tenant_4 from fx);
update public.notification_channels c set store_ids = array[(select s6 from fx)] where c.id = pg_temp.ch('owner 4');
select pg_temp.run(array[(select s6 from fx)], 'incremental', 'succeeded', '2026-11-17 19:40+00', '2026-11-17 19:41+00', '2026-11-17', '2026-11-17');
select is(pg_temp.due((select tenant_4 from fx), '2026-11-17 19:45+00'), '{}'::text[], 'a store without any sync history gets no digest');
insert into public.sync_checks (tenant_id, store_id, business_date) select tenant_4, s6, '2026-11-17' from fx;
select is(pg_temp.due((select tenant_4 from fx), '2026-11-17 19:45+00'), array['2026-11-17:settled:s6'], 'with history the settled day is due');

select ok(
  (select bool_and(
     p.proacl is not null
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname = any (array['store_day_close_at', 'store_day_shift_state', 'store_day_settled_at', 'due_digests', 'digest_scope_check', 'complete_digest', 'enqueue_digest_message', 'fail_digest'])),
  'the digest functions run as postgres only'
);
select ok(
  to_regprocedure('app.due_digests(timestamptz, uuid)') is not null
  and to_regprocedure('app.complete_digest(uuid, date, text, uuid[], boolean, text, text, jsonb, integer, text, uuid, timestamptz)') is not null
  and to_regprocedure('app.enqueue_digest_message(uuid, uuid, integer, text, text, text, timestamptz)') is not null
  and to_regprocedure('app.fail_digest(uuid, date, text, uuid[], text, timestamptz)') is not null
  and to_regprocedure('app.store_day_settled_at(uuid, date, interval)') is not null,
  'the digest functions have the signatures the TypeScript side calls'
);

select * from finish();
rollback;
