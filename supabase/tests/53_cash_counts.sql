begin;
select plan(69);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005301'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000005302'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000005301'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000005302'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000005301'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000005302'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000005321'::uuid as store_w1,
  'ffffffff-ffff-4fff-8fff-000000005331'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005301'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000005302'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005303'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005304'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005305'::uuid as staff_x1b,
  'eeeeeeee-eeee-4eee-8eee-000000005306'::uuid as staff_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005307'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000005308'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000005309'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000005310'::uuid as staff_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005311'::uuid as no_member,
  '22222222-2222-4222-8222-000000000001'::uuid as demo_store_1,
  '22222222-2222-4222-8222-000000000002'::uuid as demo_store_2,
  ((extract(hour from now() at time zone 'Asia/Ho_Chi_Minh') * 60 + extract(minute from now() at time zone 'Asia/Ho_Chi_Minh'))::integer + 720) % 1440 as day_start_far,
  ((extract(hour from now() at time zone 'Asia/Ho_Chi_Minh') * 60 + extract(minute from now() at time zone 'Asia/Ho_Chi_Minh'))::integer + 1380) % 1440 as day_start_recent;

create temp table cases as
select v.code, ('ffffffff-ffff-4fff-8fff-0000000053' || v.code)::uuid as store_id, v.variance, v.cash_sales
from (
  values
    ('11', 49999::numeric, 1000000::numeric), ('12', 50000, 1000000), ('13', 50001, 1000000),
    ('14', 49999, 20000000), ('15', 50000, 20000000), ('16', 50001, 20000000), ('17', -50001, 20000000), ('18', 40000, 20000000)
) as v (code, variance, cash_sales);

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'cash-counts-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[
  fx.owner_x, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.staff_x1b, fx.staff_xall, fx.viewer_x, fx.publisher_x, fx.owner_y, fx.staff_y1, fx.no_member
]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'cash-counts-pgtap-x', 'Cash counts pgTAP X' from fx
union all
select tenant_y, 'cash-counts-pgtap-y', 'Cash counts pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'cash-counts-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'cash-counts-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select store_x1, tenant_x, account_x, 'cash-counts-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh', day_start_far from fx
union all
select store_x2, tenant_x, account_x, 'cash-counts-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh', day_start_recent from fx
union all
select store_w1, tenant_x, account_x, 'cash-counts-w1', 'Synthetic store W1', 'Asia/Ho_Chi_Minh', day_start_far from fx
union all
select c.store_id, fx.tenant_x, fx.account_x, 'cash-counts-b' || c.code, 'Synthetic store B' || c.code, 'Asia/Ho_Chi_Minh', fx.day_start_far from fx, cases c
union all
select store_y1, tenant_y, account_y, 'cash-counts-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh', day_start_far from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_x1b, 'staff', array[fx.store_x1]),
    (fx.staff_xall, 'staff', null::uuid[]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_y, 'owner', null::uuid[]),
    (fx.staff_y1, 'staff', array[fx.store_y1])
) as m (user_id, role, store_ids);

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, config, status, linked_at, consent_record_id)
select
  fx.tenant_x, 'zalo_bot', 'zalo_bot', d.label, d.user_id, 'synthetic-chat-53' || d.n, 'NOTIFY_ZALO_BOT_TOKEN_IT', '{}'::jsonb, 'active', '2026-11-01 00:00+00',
  app.ensure_notifications_consent(fx.tenant_x, d.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00')
from fx
cross join lateral (
  values ('owner', fx.owner_x, 1), ('manager_all', fx.manager_xall, 2), ('manager_x1', fx.manager_x1, 3), ('staff_all', fx.staff_xall, 4)
) as d (label, user_id, n);

insert into public.shifts (tenant_id, store_id, external_id, name, cashier_external_id, cashier_name, opened_at, closed_at, sales_amount, orders_count, cash_drawer_amount, opening_float_amount, expected_cash_amount)
select fx.tenant_x, c.store_id, 'b' || c.code || '-s1', 'Ca chiều POS', 'cashier-ext-53', 'cashier-name@example.com', now() - interval '4 hours', now() - interval '5 minutes',
  c.cash_sales + 500000, 40, 2000000 + c.variance, 500000, 2000000
from fx, cases c
union all
select fx.tenant_x, fx.store_w1, 'w1-s1', 'Ca chiều POS', 'cashier-ext-53', 'cashier-name@example.com', now() - interval '4 hours', now() - interval '30 minutes', 1500000, 20, 1000000, 500000, 1000000 from fx
union all
select fx.tenant_x, fx.store_x1, 'x1-s1', 'Ca sáng POS', 'cashier-ext-53', 'cashier-name@example.com', now() - interval '3 hours', now() - interval '2 hours', 900000, 12, 800000, 500000, 800000 from fx
union all
select fx.tenant_x, fx.store_x1, 'x1-s2', 'Ca chiều POS', 'cashier-ext-53', 'cashier-name@example.com', now() - interval '2 hours', null, 0, 0, null, 500000, null from fx
union all
select fx.tenant_x, fx.store_x1, 'x1-s3', 'Ca tối POS', 'cashier-ext-53', 'cashier-name@example.com', now() + interval '5 minutes', null, 0, 0, null, 500000, null from fx
union all
select fx.tenant_x, fx.store_x2, 'x2-s1', 'Ca đêm POS', 'cashier-ext-53', 'cashier-name@example.com', now() - interval '3 hours', now() - interval '10 minutes', 700000, 9, 900000, 300000, 900000 from fx;

insert into public.agg_shift_cash (
  tenant_id, store_id, shift_id, shift_external_id, business_date, cashier_name, opened_at, closed_at, orders, sales_amount,
  cash_sales_amount, opening_float_amount, expected_cash_amount, drawer_amount, variance_amount
)
select s.tenant_id, s.store_id, s.id, s.external_id, app.store_business_date(s.store_id, s.opened_at), s.cashier_name, s.opened_at, s.closed_at, s.orders_count, s.sales_amount,
  coalesce(c.cash_sales, 500000), s.opening_float_amount, s.expected_cash_amount, s.cash_drawer_amount, s.cash_drawer_amount - s.expected_cash_amount
from public.shifts s
left join cases c on c.store_id = s.store_id
where s.tenant_id = (select tenant_x from fx)
  and s.external_id in ('b11-s1', 'b12-s1', 'b13-s1', 'b14-s1', 'b15-s1', 'b16-s1', 'b17-s1', 'b18-s1', 'w1-s1', 'x1-s1');

create temp table days as
select
  app.store_business_date((select c.store_id from cases c where c.code = '11'), now() - interval '4 hours') as b_date,
  app.store_business_date((select store_x1 from fx), now()) as x1_date,
  app.store_business_date((select store_x2 from fx), now() - interval '3 hours') as x2_shift_date;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.value_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.shift(p_external_id text)
returns uuid
language sql
security definer
as $$
  select s.id from public.shifts s where s.external_id = p_external_id and s.tenant_id in (select tenant_x from fx);
$$;

create function pg_temp.count_of(p_store uuid, p_status text default 'active')
returns uuid
language sql
security definer
as $$
  select c.id from public.cash_counts c where c.store_id = p_store and c.status = p_status order by c.created_at desc, c.counted_at desc, c.id limit 1;
$$;

create function pg_temp.record_as(p_user uuid, p_store uuid, p_amount numeric, p_replaces uuid default null)
returns text
language sql
as $$
  select pg_temp.value_as(p_user, format('select public.record_cash_count(%L, %L, null, null, %L)::text', p_store, p_amount, p_replaces));
$$;

create function pg_temp.events(p_store uuid)
returns text
language sql
security definer
as $$
  select coalesce(string_agg(e.state || ':' || coalesce(e.resolution, '-') || ':' || e.occurrences || ':' || e.notifications, ',' order by e.opened_at, e.id), '-')
  from public.alert_events e
  where e.store_id = p_store and e.rule_key = 'cash_count_variance';
$$;

create function pg_temp.seen_as(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.cash_counts c where c.tenant_id in (select tenant_x from fx union all select tenant_y from fx);
  return v_count;
end;
$$;

grant select on fx, cases, days to authenticated, anon;

select is(
  (select row(c.category, c.delivery, c.default_enabled, c.default_severity::text, c.default_roles::text, c.default_params, c.default_cooldown, c.remind_every, c.notify_on_resolve, c.store_scoped)::text
   from public.alert_rule_catalog c where c.rule_key = 'cash_count_variance'),
  row('business', 'immediate', true, 'warning', '{owner,manager}', '{"match_window_minutes": 60}'::jsonb, interval '0', null::interval, false, true)::text,
  'cash_count_variance is an immediate warning to the store''s managers and the owner, store-scoped, without cool-down, matching counts within 60 minutes'
);
select ok(
  app.alert_rule_params_valid('cash_count_variance', '{"match_window_minutes": 120}') and not app.alert_rule_params_valid('cash_count_variance', '{"match_window_minutes": 10}')
    and not app.alert_rule_params_valid('cash_count_variance', '{"threshold": 50000}'),
  'the match window is 15 to 360 minutes and the rule takes no threshold of its own: the thresholds are the report settings'
);
select is(
  (select t.tgname::text || ':' || (t.tgtype & 1 = 0) || ':' || (t.tgtype & 4 = 4) from pg_trigger t where t.tgrelid = 'public.agg_shift_cash'::regclass and not t.tgisinternal),
  'agg_shift_cash_process_cash_counts:true:true',
  'a statement trigger after every insert into agg_shift_cash, so each sync''s refresh processes the waiting counts'
);
select is(
  (select count(*)::integer from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'cash_counts' and (c.column_name ~ '(name|cashier)')),
  0,
  'cash_counts has no shift name or cashier column'
);
select is(
  (select array_to_string(p.proargnames, ',') ~ '(name|cashier)' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'cash_count_review'),
  false,
  'the review returns no shift name or cashier field'
);

select is(
  (select count(*)::integer
   from app.shift_variance_scores(array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[], '2000-01-01', '2100-12-31', 50000, 0.005) v
   join public.agg_shift_cash a on a.shift_id = v.shift_id
   cross join lateral app.cash_variance_test(a.store_id, a.business_date, a.variance_amount, a.cash_sales_amount, 50000, 0.005) t
   where row(t.trailing_shifts, t.trailing_mean_variance, t.trailing_stddev_variance, t.z_score, t.over_abs_threshold, t.over_rel_threshold, t.over_z_threshold, t.reasons)
         is not distinct from row(v.trailing_shifts, v.trailing_mean_variance, v.trailing_stddev_variance, v.z_score, v.over_abs_threshold, v.over_rel_threshold, v.over_z_threshold, v.reasons))
    = (select count(*)::integer from app.shift_variance_scores(array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[], '2000-01-01', '2100-12-31', 50000, 0.005))
  and (select count(*) from app.shift_variance_scores(array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[], '2000-01-01', '2100-12-31', 50000, 0.005)) > 0,
  true,
  'on every demo shift app.cash_variance_test gives exactly the flags, z-score and history of app.shift_variance_scores, the rule of Ca & két tiền and Ngày'
);
select is(
  (select count(*)::integer
   from app.shift_variance_scores(array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[], '2000-01-01', '2100-12-31', 5000, 0.0005) v
   join public.agg_shift_cash a on a.shift_id = v.shift_id
   cross join lateral app.cash_variance_test(a.store_id, a.business_date, a.variance_amount, a.cash_sales_amount, 5000, 0.0005) t
   where row(t.z_score, t.over_abs_threshold, t.over_rel_threshold, t.over_z_threshold, t.reasons)
         is distinct from row(v.z_score, v.over_abs_threshold, v.over_rel_threshold, v.over_z_threshold, v.reasons)),
  0,
  'and under tighter thresholds too'
);

set local role authenticated;

select is(
  (select array_agg(pg_temp.record_as((select staff_xall from fx), c.store_id, 2000000 + c.variance)::jsonb ->> 'matched' order by c.code) from cases c where c.code <> '18'),
  array['true', 'true', 'true', 'true', 'true', 'true', 'true'],
  'a count saved after its shift synced is matched at once'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format(
    'select string_agg(r.state || %L || array_to_string(r.reasons, %L) || %L || r.variance_amount, %L order by r.store_id) from public.cash_count_review(%L, %L, %L) r',
    ':', '+', ':', ',', (select array_agg(c.store_id order by c.code) from cases c where c.code <> '18'),
    (select b_date from days), (select b_date from days))),
  'over:relative:49999.00,over:relative:50000.00,over:absolute+relative:50001.00,within::49999.00,within::50000.00,over:absolute:50001.00,over:absolute:-50001.00',
  'the boundary under 50,000 ₫ strictly greater and 0.5 % of cash sales: with low cash sales 49,999 and 50,000 cross through the relative test; with high cash sales 50,000 stays within and 50,001 crosses the absolute test in either direction'
);
select is(
  (select string_agg(c.code || '=' || pg_temp.events(c.store_id), ',' order by c.code) from cases c where c.code <> '18'),
  '11=open:-:1:2,12=open:-:1:2,13=open:-:1:2,14=-,15=-,16=open:-:1:2,17=open:-:1:2',
  'each count over a threshold opens one episode sent to two destinations; a count within the thresholds raises nothing'
);

reset role;

select is(
  (select string_agg(c.code || '=' || (e.facts ->> 'shift_number') || ':' || (e.facts ->> 'over_abs') || ':' || (e.facts ->> 'over_rel') || ':' || (e.facts ->> 'over_z') || ':' || (e.facts ->> 'shortfall') || ':' || (e.facts ->> 'recounts'), ',' order by c.code)
   from cases c join public.alert_events e on e.store_id = c.store_id and e.rule_key = 'cash_count_variance'),
  '11=1:false:true:false:false:0,12=1:false:true:false:false:0,13=1:true:true:false:false:0,16=1:true:false:false:false:0,17=1:true:false:false:true:0',
  'the episode''s facts are counts and flags only: Ca {n}, which test crossed, a shortfall and the recounts'
);
select is(
  (select string_agg(distinct e.dedupe_key ~ '^cash_count_variance:shift:[0-9a-f-]{36}$' || ':' || e.source || ':' || e.severity::text || ':' || (e.business_date = app.store_business_date(e.store_id, now() - interval '4 hours')), ',')
   from public.alert_events e join cases c on c.store_id = e.store_id where e.rule_key = 'cash_count_variance'),
  'true:operations:warning:true',
  'one episode per shift under the key cash_count_variance:shift:<shift id>, from the operations source, on the shift''s business date'
);
select is(
  (select string_agg(distinct ch.label || ':' || o.kind || ':' || o.template_ref, ',' order by ch.label || ':' || o.kind || ':' || o.template_ref)
   from public.outbound_messages o join public.notification_channels ch on ch.id = o.channel_id join cases c on c.store_id = o.store_id),
  'manager_all:alert:alert.cash_count_variance.v1,owner:alert:alert.cash_count_variance.v1',
  'the alerts go to the owner and the manager of every store; a manager of another store and staff get none'
);
select is(
  (select bool_and(app.facts_are_count_only(o.params)) and bool_and(not exists (select 1 from jsonb_object_keys(o.params) k where k ~ 'amount'))
          and bool_and(o.params::text !~ '(cashier|POS|example|2050001|1949999|50001)')
   from public.outbound_messages o join cases c on c.store_id = o.store_id),
  true,
  'message parameters are count-only: no amount, no shift name, no cashier'
);
select is(
  (select bool_and(e.facts::text !~ '(cashier|POS|example)') from public.alert_events e join cases c on c.store_id = e.store_id),
  true,
  'nor do the episodes carry any shift name or cashier field'
);
select is(
  (select string_agg(r.store_id::text || ':' || r.over_abs_threshold || r.over_rel_threshold || r.over_z_threshold || ':' || array_to_string(r.reasons, '+'), ',' order by r.store_id)
   from public.shift_review((select array_agg(c.store_id) from cases c where c.code <> '18'), (select b_date from days), (select b_date from days)) r),
  (select string_agg(r.store_id::text || ':' || r.over_abs_threshold || r.over_rel_threshold || r.over_z_threshold || ':' || array_to_string(r.reasons, '+'), ',' order by r.store_id)
   from public.cash_count_review((select array_agg(c.store_id) from cases c where c.code <> '18'), (select b_date from days), (select b_date from days)) r),
  'where the count equals the POS drawer, the count''s flags are those of Ca & két tiền (shift_review) for the same store and shift'
);

set local role authenticated;

select is(
  pg_temp.record_as((select staff_xall from fx), (select store_id from cases where code = '14'), 1990000)::jsonb ->> 'matched',
  'false',
  'a second fresh count of a shift that has one stays unmatched: one count per shift unless a manager reopens it'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1000000, %L)::text', (select store_x1 from fx), '{"500000": 1, "200000": 2}')),
  'error:23514',
  'a denomination breakdown must add up to the counted amount'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1000000, %L)::text', (select store_x1 from fx), '{"abc": 2}')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1000000, %L)::text', (select store_x1 from fx), '{"500000": 2.5}')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, -1)::text', (select store_x1 from fx)))
  ],
  array['error:23514', 'error:23514', 'error:23514'],
  'a breakdown has face values and whole counts, and an amount is never negative'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select (d ->> %L) || %L || (d ->> %L) || %L || ((d ->> %L)::date = app.store_business_date(%L, now())) from public.record_cash_count(%L, 1000000, %L, %L) d',
    'matched', ':', 'status', ':', 'business_date', (select store_x1 from fx), (select store_x1 from fx), '{"500000": 2}', 'Đếm hai lần.')),
  'false:active:true',
  'a count saved before its shift''s close is synced waits unmatched (chưa khớp ca) on the store''s business date'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select string_agg(r.state || %L || coalesce(r.shift_number::text, %L), %L order by r.opened_at nulls last) from public.cash_count_review(%L, %L, %L) r',
    ':', '-', ',', array[(select store_x1 from fx)], (select x1_date from days), (select x1_date from days))),
  'no_count:1,unmatched:-',
  'the manager sees Ca 1 closed without a count and the waiting count'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1000)::text', (select store_w1 from fx))),
    pg_temp.value_as((select viewer_x from fx), format('select public.record_cash_count(%L, 1000)::text', (select store_x1 from fx))),
    pg_temp.value_as((select publisher_x from fx), format('select public.record_cash_count(%L, 1000)::text', (select store_x1 from fx))),
    pg_temp.value_as((select staff_y1 from fx), format('select public.record_cash_count(%L, 1000)::text', (select store_x1 from fx))),
    pg_temp.value_as((select no_member from fx), format('select public.record_cash_count(%L, 1000)::text', (select store_x1 from fx)))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'nobody counts at a store outside their operations scope'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.cash_counts (tenant_id, store_id, counted_amount, shift_id) values (%L, %L, 1000, %L)', (select tenant_x from fx), (select store_x1 from fx), pg_temp.shift('x1-s1'))),
  '42501',
  'a client cannot name the shift of a count'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('update public.cash_counts set counted_amount = 1 where id = %L', pg_temp.count_of((select store_x1 from fx)))),
  '42501',
  'nor change a count'
);

reset role;

update public.shifts
set closed_at = now() + interval '5 minutes', expected_cash_amount = 1060000, cash_drawer_amount = 1060000, sales_amount = 1200000, orders_count = 15
where id = pg_temp.shift('x1-s2');
insert into public.agg_shift_cash (
  tenant_id, store_id, shift_id, shift_external_id, business_date, cashier_name, opened_at, closed_at, orders, sales_amount,
  cash_sales_amount, opening_float_amount, expected_cash_amount, drawer_amount, variance_amount
)
select s.tenant_id, s.store_id, s.id, s.external_id, app.store_business_date(s.store_id, s.opened_at), s.cashier_name, s.opened_at, s.closed_at, s.orders_count, s.sales_amount,
  560000, s.opening_float_amount, s.expected_cash_amount, s.cash_drawer_amount, s.cash_drawer_amount - s.expected_cash_amount
from public.shifts s
where s.id = pg_temp.shift('x1-s2');

select is(
  (select (c.shift_id = pg_temp.shift('x1-s2')) || ':' || (c.matched_at = now()) || ':' || (c.evaluated_at = now()) || ':' || c.status
   from public.cash_counts c where c.id = pg_temp.count_of((select store_x1 from fx))),
  'true:true:true:active',
  'the sync that brings the close (the refresh writing agg_shift_cash) matches the waiting count to the shift closing nearest to it and evaluates it'
);
select is(
  pg_temp.events((select store_x1 from fx)),
  'open:-:1:3',
  'a 60,000 ₫ shortfall alerts within that sync: one episode to the owner, the manager of every store and the store''s manager'
);
select is(
  (select (e.facts ->> 'shift_number') || ':' || (e.facts ->> 'shortfall') || ':' || app.shift_number(pg_temp.shift('x1-s2')) || ':' || app.shift_number(pg_temp.shift('x1-s1')) || ':' || app.shift_number(pg_temp.shift('x1-s3'))
   from public.alert_events e where e.store_id = (select store_x1 from fx) and e.rule_key = 'cash_count_variance'),
  '2:true:2:1:3',
  'the shift is Ca 2 by opening order within its business day'
);

set local role authenticated;

select is(
  pg_temp.value_as((select manager_x1 from fx), format('select string_agg(r.shift_number || %L || r.state || %L || coalesce(r.counted_amount::text, %L) || %L || coalesce(r.expected_cash_amount::text, %L) || %L || coalesce(r.drawer_amount::text, %L) || %L || coalesce(r.variance_amount::text, %L), %L order by r.shift_number) from public.cash_count_review(%L, %L, %L) r',
    ':', ':', '-', ':', '-', ':', '-', ':', '-', ',', array[(select store_x1 from fx)], (select x1_date from days), (select x1_date from days))),
  '1:no_count:-:800000.00:800000.00:-,2:over:1000000.00:1060000.00:1060000.00:-60000.00',
  'the review shows Ca 1 without a count and Ca 2 counted against the expected cash with the POS drawer beside it'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.reopen_cash_count(%L)::text', pg_temp.count_of((select store_x1 from fx)))),
    pg_temp.value_as((select manager_x1 from fx), format('select public.reopen_cash_count(%L)::text', pg_temp.count_of((select store_id from cases where code = '11')))),
    pg_temp.value_as((select owner_y from fx), format('select public.reopen_cash_count(%L)::text', pg_temp.count_of((select store_x1 from fx)))),
    pg_temp.value_as((select viewer_x from fx), format('select public.reopen_cash_count(%L)::text', pg_temp.count_of((select store_x1 from fx))))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'staff, a manager of another store, another tenant''s owner and a viewer reopen nothing'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1030000, null, null, %L)::text', (select store_x1 from fx), pg_temp.count_of((select store_x1 from fx)))),
  'error:22023',
  'a recount replaces only a reopened count'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select (d ->> %L) || %L || ((d ->> %L)::uuid = %L) || %L || ((d ->> %L)::timestamptz = now()) from public.reopen_cash_count(%L) d',
    'status', ':', 'reopened_by', (select manager_x1 from fx), ':', 'reopened_at', pg_temp.count_of((select store_x1 from fx)))),
  'reopened:true:true',
  'a manager of the store reopens the count, logged with who and when'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1030000, null, null, %L) ->> %L', (select store_x1 from fx), pg_temp.count_of((select store_x1 from fx), 'reopened'), 'matched')),
  'true',
  'the recount replaces it and keeps its shift'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.record_cash_count(%L, 1040000, null, null, %L)::text', (select store_x1 from fx), pg_temp.count_of((select store_x1 from fx), 'reopened'))),
  'error:23505',
  'a reopened count has one recount'
);
select is(
  pg_temp.events((select store_x1 from fx)),
  'open:-:2:3',
  'a second count of the same shift over the thresholds reuses the open episode: one more occurrence, no new message'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.reopen_cash_count(%L) ->> %L', pg_temp.count_of((select store_x1 from fx)), 'status')),
  'reopened',
  'the manager reopens the recount'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.reopen_cash_count(%L) ->> %L', (select c.id from public.cash_counts c where c.store_id = (select store_x1 from fx) and c.status = 'reopened' order by c.counted_at, c.created_at limit 1), 'status')),
  'reopened',
  'reopening a reopened count changes nothing'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.record_cash_count(%L, 1059000, null, %L, %L) ->> %L', (select store_x1 from fx), 'Đếm lại sau khi tìm thấy phiếu chi.',
    (select c.id from public.cash_counts c where c.store_id = (select store_x1 from fx) and c.status = 'reopened' and not exists (select 1 from public.cash_counts r where r.replaces_id = c.id)), 'matched')),
  'true',
  'the manager counts again: 1,000 ₫ short, within the thresholds'
);
select is(
  pg_temp.events((select store_x1 from fx)),
  'resolved:cleared:2:3',
  'a count within the thresholds clears the shift''s episode'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select string_agg(r.state || %L || r.recounts, %L) from public.cash_count_review(%L, %L, %L) r where r.shift_number = 2',
    ':', ',', array[(select store_x1 from fx)], (select x1_date from days), (select x1_date from days))),
  'within:2',
  'the review shows the active count and the two reopenings before it'
);

reset role;

select is(
  (select string_agg(c.status || ':' || (c.shift_id = pg_temp.shift('x1-s2')) || ':' || (c.replaces_id is not null) || ':' || (c.reopened_by is not null), ',' order by c.counted_at, c.created_at, c.status desc)
   from public.cash_counts c where c.store_id = (select store_x1 from fx)),
  'reopened:true:false:true,reopened:true:true:true,active:true:true:false',
  'every reopening stays logged: the chain of counts of the shift with who reopened each'
);
select throws_ok(
  format($q$ update public.cash_counts set counted_amount = 1 where id = %L $q$, pg_temp.count_of((select store_x1 from fx))),
  '55000', null,
  'a count never changes, even for the database owner'
);
select throws_ok(
  format($q$ update public.cash_counts set status = 'active' where id = %L $q$, pg_temp.count_of((select store_x1 from fx), 'reopened')),
  '55000', null,
  'and a reopened count stays reopened'
);

insert into public.cash_counts (tenant_id, store_id, counted_amount, created_by)
select fx.tenant_y, fx.store_y1, 750000, fx.staff_y1 from fx;
update public.tenants set staff_revenue_visibility = 'none' where id = (select tenant_x from fx);

set local role authenticated;

select is(
  array[pg_temp.seen_as((select owner_x from fx)), pg_temp.seen_as((select manager_xall from fx)), pg_temp.seen_as((select manager_x1 from fx))],
  array[11, 11, 3],
  'owners and managers read every count of their stores'
);
select is(
  array[pg_temp.seen_as((select staff_x1 from fx)), pg_temp.seen_as((select staff_x1b from fx)), pg_temp.seen_as((select staff_xall from fx))],
  array[2, 0, 8],
  'with the revenue visibility none, staff read only the counts they made'
);
select is(
  array[pg_temp.seen_as((select viewer_x from fx)), pg_temp.seen_as((select publisher_x from fx)), pg_temp.seen_as((select no_member from fx)), pg_temp.seen_as((select owner_y from fx)), pg_temp.seen_as((select staff_y1 from fx))],
  array[0, 0, 0, 1, 1],
  'viewers, the publisher and logins without membership read none; no read crosses tenants'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select string_agg(r.state || %L || coalesce(r.variance_amount::text, %L) || %L || coalesce(r.expected_cash_amount::text, %L), %L order by r.store_id, r.state) from public.cash_count_review(%L, %L, %L) r',
    ':', '-', ':', '-', ',', (select array_agg(c.store_id order by c.code) from cases c where c.code in ('11', '14')),
    (select b_date from days), (select b_date from days))),
  'recorded:-:-,recorded:-:-,unmatched:-:-',
  'staff without revenue visibility see their counts as recorded, never the expected cash or the difference'
);

reset role;
update public.tenants set staff_revenue_visibility = 'all' where id = (select tenant_x from fx);
set local role authenticated;

select is(
  array[pg_temp.seen_as((select staff_x1 from fx)), pg_temp.seen_as((select staff_x1b from fx))],
  array[3, 3],
  'with the visibility all, staff read every count of their store'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select string_agg(r.state || %L || coalesce(r.variance_amount::text, %L), %L order by r.store_id) from public.cash_count_review(%L, %L, %L) r where r.cash_count_id is not null and r.shift_id is not null',
    ':', '-', ',', (select array_agg(c.store_id order by c.code) from cases c where c.code in ('11', '14')),
    (select b_date from days), (select b_date from days))),
  'over:49999.00,within:49999.00',
  'and see the difference and its threshold state as a manager does'
);
select is(
  pg_temp.value_as((select viewer_x from fx), format('select count(*)::text from public.cash_count_review(%L, %L, %L) r where r.cash_count_id is not null',
    (select array_agg(c.store_id order by c.code) from cases c), (select b_date from days), (select b_date from days))),
  '0',
  'a viewer reads the shifts but no count'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select public.record_cash_count(%L, 1000) ->> %L', (select store_w1 from fx), 'matched')),
  'true',
  'a count 30 minutes after its shift closed is matched under the default window of 60 minutes'
);

reset role;

insert into public.alert_rules (tenant_id, store_id, rule_key, params)
select tenant_x, store_w1, 'cash_count_variance', '{"match_window_minutes": 15}'::jsonb from fx;
update public.cash_counts set status = 'reopened', reopened_at = now(), reopened_by = (select manager_xall from fx) where id = pg_temp.count_of((select store_w1 from fx));
select pg_temp.value_as((select staff_xall from fx), format('select public.record_cash_count(%L, 1000) ->> %L', (select store_w1 from fx), 'matched'));
select is(
  (select count(*)::integer from public.cash_counts c where c.store_id = (select store_w1 from fx) and c.status = 'active' and c.shift_id is null),
  1,
  'with the store''s rule window set to 15 minutes the same count waits unmatched'
);
update public.alert_rules set params = '{"match_window_minutes": 45}' where store_id = (select store_w1 from fx) and rule_key = 'cash_count_variance';
delete from public.cash_counts c where c.store_id = (select store_w1 from fx) and c.status = 'reopened';
select is(app.process_cash_counts((select store_w1 from fx), now()), 1, 'with 45 minutes the next processing matches and evaluates it');
select is(pg_temp.events((select store_w1 from fx)), 'open:-:2:2', 'its difference counts on the shift''s episode, which the first count opened');

insert into public.report_settings (tenant_id, cash_abs_threshold, cash_rel_threshold)
select tenant_x, 30000, 0.0050 from fx;
set local role authenticated;
select is(
  pg_temp.record_as((select staff_xall from fx), (select store_id from cases where code = '18'), 2040000)::jsonb ->> 'matched',
  'true',
  'a count of 40,000 ₫ over at a store with high cash sales'
);
reset role;
select is(
  pg_temp.events((select store_id from cases where code = '18')),
  'open:-:1:2',
  'alerts once the tenant''s absolute threshold is 30,000 ₫: the thresholds are the report settings'
);
select is(
  (select r.state || ':' || array_to_string(r.reasons, '+')
   from public.cash_count_review(array[(select store_id from cases where code = '18')], (select b_date from days), (select b_date from days)) r),
  'over:absolute',
  'and the review applies the same settings'
);

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select tenant_x, account_x, 'cash-counts-cash', 'Tiền mặt', 'cash' from fx;
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, status, shift_external_id)
select fx.tenant_x, fx.store_x2, fx.account_x, 'cash-counts-x2-1', now() - interval '2 hours', app.store_business_date(fx.store_x2, now() - interval '2 hours'), 600000, 600000, 600000, 'completed', 'x2-s1'
from fx;
insert into public.invoice_payments (tenant_id, store_id, invoice_id, business_date, payment_method_external_id, amount)
select i.tenant_id, i.store_id, i.id, i.business_date, 'cash-counts-cash', 600000
from public.invoices i
where i.external_id = 'cash-counts-x2-1';

set local role authenticated;
select is(
  pg_temp.value_as((select staff_xall from fx), format('select (d ->> %L) || %L || ((d ->> %L)::date = app.store_business_date(%L, now() - interval %L)) || %L || ((d ->> %L)::date < app.store_business_date(%L, now())) from public.record_cash_count(%L, 990000) d',
    'matched', ':', 'business_date', (select store_x2 from fx), '3 hours', ':', 'business_date', (select store_x2 from fx), (select store_x2 from fx))),
  'true:true:true',
  'at a store whose day started an hour ago, a count matched to a shift that opened before the day start takes the shift''s business date, not today''s'
);
reset role;

select is(
  (select c.evaluated_at is null from public.cash_counts c where c.id = pg_temp.count_of((select store_x2 from fx))),
  true,
  'without the shift''s figures yet the count waits for the refresh'
);
select ok(
  app.refresh_analytics((select tenant_x from fx), (select x2_shift_date from days), (select x2_shift_date from days)) > 0,
  'the incremental sync refreshes the analytics of the shift''s business date'
);
select is(
  (select a.cash_sales_amount || ':' || a.expected_cash_amount from public.agg_shift_cash a where a.shift_id = pg_temp.shift('x2-s1')),
  '600000.00:900000.00',
  'the refresh wrote the shift''s cash sales and expected cash'
);
select is(
  (select (c.evaluated_at = now()) || ':' || pg_temp.events(c.store_id) from public.cash_counts c where c.id = pg_temp.count_of((select store_x2 from fx))),
  'true:open:-:1:2',
  'and in the same cycle the count is evaluated: 90,000 ₫ over alerts the owner and the manager of every store'
);
select is(
  (select e.business_date = (select x2_shift_date from days) from public.alert_events e where e.store_id = (select store_x2 from fx)),
  true,
  'the episode carries the shift''s business date'
);

select is(
  (select count(*)::integer from public.alert_events e join public.tenants t on t.id = e.tenant_id where t.id in (select tenant_x from fx union all select tenant_y from fx) and e.rule_key = 'cash_count_variance' and e.store_id = (select store_y1 from fx)),
  0,
  'an unmatched count raises nothing'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'app')
     and p.proname in ('record_cash_count', 'reopen_cash_count', 'cash_count_review', 'match_cash_counts', 'evaluate_cash_count', 'process_cash_counts', 'cash_variance_test', 'shift_number',
                       'cash_denominations_valid', 'prepare_cash_count', 'after_cash_count_insert', 'guard_cash_count', 'process_cash_counts_after_refresh')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
  0,
  'none of the cash count functions is executable by public or anon'
);
select ok(
  not has_function_privilege('authenticated', 'app.match_cash_counts(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.evaluate_cash_count(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.process_cash_counts(uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.process_cash_counts(uuid, timestamptz)', 'execute'),
  'members cannot match or evaluate counts themselves; the service role may process a store'
);
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef || ':' || p.provolatile::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('record_cash_count', 'reopen_cash_count', 'cash_count_review')),
  array['cash_count_review:false:s', 'record_cash_count:false:v', 'reopen_cash_count:false:v'],
  'the RPCs run as the caller; the review is stable and reads through RLS like the reports'
);

set local role anon;
select throws_ok('select count(*) from public.cash_counts', '42501', null, 'anon reads no count');
select throws_ok($q$ select public.record_cash_count('ffffffff-ffff-4fff-8fff-000000005301', 1000) $q$, '42501', null, 'anon records nothing');
select throws_ok($q$ select * from public.cash_count_review(array['ffffffff-ffff-4fff-8fff-000000005301']::uuid[], current_date, current_date) $q$, '42501', null, 'anon reviews nothing');
reset role;

select * from finish();
rollback;
