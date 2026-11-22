-- Test design (ISTQB) for the data-subject deadline alert, G-26 and G-51 of docs/test-gaps.md.
-- Boundary value analysis: the reply deadline minus 3 days minus 1 second, minus 3 days, minus 1 day, exactly the deadline
-- and 1 second past it; the same five edges on the completion deadline; the list function's window at 3, 1 and 0 days to
-- the second on the frozen transaction clock; the 24-hour cool-down at its last second and at its end; the rule's days
-- parameter at 1. State transition testing: no episode, open, escalated from due soon to overdue (still one episode),
-- resolved when a late response is recorded, reopened by the completion deadline, resolved by completion. Decision tables:
-- the first-response state (none, overdue, answered) against the completion state (on track, due soon, overdue), each
-- request counted once; who is told (owner and unlimited manager, nobody else) and who reads the episode and the list.
-- Negative and security cases: completed, rejected and other tenants' requests never count; the rule off opens nothing;
-- anon, signed-in members and the service role cannot run the evaluator or the rules hook; the episode, the queued messages
-- and the list carry counts only, never a contact, a note, a subject or a request id. Every instant is fixed.
begin;
select plan(78);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000000235001'::uuid as tenant_t,
  'ffffffff-ffff-4fff-8fff-000000235002'::uuid as tenant_u,
  'ffffffff-ffff-4fff-8fff-000000235003'::uuid as tenant_w,
  'ffffffff-ffff-4fff-8fff-000000235011'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000235021'::uuid as store_t,
  'ffffffff-ffff-4fff-8fff-000000235101'::uuid as owner_t,
  'ffffffff-ffff-4fff-8fff-000000235102'::uuid as manager_t,
  'ffffffff-ffff-4fff-8fff-000000235103'::uuid as store_manager_t,
  'ffffffff-ffff-4fff-8fff-000000235104'::uuid as staff_t,
  'ffffffff-ffff-4fff-8fff-000000235105'::uuid as viewer_t,
  'ffffffff-ffff-4fff-8fff-000000235106'::uuid as owner_u,
  'ffffffff-ffff-4fff-8fff-000000235107'::uuid as owner_w;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-deadline-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_t, fx.manager_t, fx.store_manager_t, fx.staff_t, fx.viewer_t, fx.owner_u, fx.owner_w]) as u (id);

insert into public.tenants (id, slug, name, country_code, timezone)
select tenant_t, 'dsr-deadline-pgtap', 'DSR deadline pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_u, 'dsr-deadline-other-pgtap', 'DSR deadline other pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_w, 'dsr-deadline-rule-pgtap', 'DSR deadline rule pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'dsr-deadline', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_t, tenant_t, account_t, 'dsr-d-1', 'dsr-d-1', 'Synthetic store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_t, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_t, 'owner', null::uuid[]), (fx.manager_t, 'manager', null::uuid[]), (fx.store_manager_t, 'manager', array[fx.store_t]),
         (fx.staff_t, 'staff', array[fx.store_t]), (fx.viewer_t, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_u, owner_u, 'owner', null from fx
union all
select tenant_w, owner_w, 'owner', null from fx;

-- One Zalo bot destination per member of the first tenant (and the owner of the third), each with its own consent.
create temp table chan (name text primary key, id uuid);
with inserted as (
  insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
  select v.tenant, 'zalo_bot', 'zalo_bot', 'dest ' || v.name, v.member, 'synthetic-chat-' || v.name, 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', timestamptz '2026-11-01 00:00+00',
    app.ensure_notifications_consent(v.tenant, v.member, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, timestamptz '2026-11-01 00:00+00')
  from fx cross join lateral (
    values ('owner_t', fx.tenant_t, fx.owner_t), ('manager_t', fx.tenant_t, fx.manager_t), ('store_manager_t', fx.tenant_t, fx.store_manager_t),
           ('staff_t', fx.tenant_t, fx.staff_t), ('viewer_t', fx.tenant_t, fx.viewer_t), ('owner_w', fx.tenant_w, fx.owner_w)
  ) as v (name, tenant, member)
  returning id, address
)
insert into chan select substr(address, 16), id from inserted;

create temp table req (name text primary key, id uuid);

create function pg_temp.add_request(
  p_tenant uuid, p_name text, p_first timestamptz, p_completion timestamptz,
  p_responded timestamptz default null, p_status public.dsr_status default 'received', p_received timestamptz default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type, received_at, first_response_due_at, completion_due_at, responded_at, status, notes)
  values (p_tenant, 'customer', 'synthetic-contact-235-' || p_name, 'access', coalesce(p_received, now() - interval '10 days'), p_first, p_completion, p_responded, p_status, 'synthetic-note-235-' || p_name)
  returning id into v_id;
  insert into req values (p_name, v_id);
  return v_id;
end;
$$;

create function pg_temp.rid(p_name text)
returns uuid
language sql
as $$
  select id from req where name = p_name;
$$;

-- The outcome of one statement as one caller: ok:<first column> or error:<SQLSTATE>; the subtransaction is rolled back.
create function pg_temp.run_as(p_role text, p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    perform set_config('role', p_role, true);
    execute p_statement into v_value;
    v_value := 'ok:' || coalesce(v_value, 'null');
    raise exception using errcode = 'P0099', message = v_value;
  exception when others then
    if sqlstate = 'P0099' then
      v_value := sqlerrm;
    else
      v_value := 'error:' || sqlstate;
    end if;
  end;
  return v_value;
end;
$$;

create function pg_temp.member(p_user uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object('sub', p_user, 'role', 'authenticated');
$$;

-- The rows of the list function as one caller, one "name=first/completion" entry per request, in name order.
create function pg_temp.listed(p_user uuid, p_days integer)
returns text
language plpgsql
as $$
declare
  v_out text := pg_temp.run_as(
    'authenticated', pg_temp.member(p_user),
    format('select coalesce(json_agg(json_build_object(''n'', r.request_id, ''f'', r.first_response_state, ''c'', r.completion_state))::text, ''[]'') from public.dsr_due_soon(%s) r', p_days));
begin
  if v_out like 'error:%' then
    return v_out;
  end if;
  return coalesce((
    select string_agg(coalesce(q.name, '?') || '=' || (e ->> 'f') || '/' || (e ->> 'c'), ', ' order by q.name)
    from json_array_elements(substr(v_out, 4)::json) e
    left join req q on q.id = (e ->> 'n')::uuid
  ), '');
end;
$$;

-- The evaluator at a fixed instant: <alerts opened>:<overdue>:<due soon>.
create function pg_temp.evaluate(p_tenant uuid, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', r ->> 'dsr_alerts', r ->> 'overdue', r ->> 'due_soon')
  from (select app.evaluate_dsr_due_soon(p_tenant, p_at) as r) x;
$$;

create function pg_temp.episodes(p_tenant uuid)
returns text
language sql
as $$
  select concat_ws(':', count(*), count(*) filter (where state = 'open'))
  from public.alert_events where tenant_id = p_tenant and rule_key = 'dsr_due_soon';
$$;

create function pg_temp.messages(p_tenant uuid)
returns integer
language sql
as $$
  select count(*)::integer
  from public.outbound_messages o join public.alert_events e on e.id = o.alert_event_id
  where e.tenant_id = p_tenant and e.rule_key = 'dsr_due_soon';
$$;

create function pg_temp.open_facts(p_tenant uuid)
returns text
language sql
as $$
  select string_agg(facts::text, ' ') from public.alert_events where tenant_id = p_tenant and rule_key = 'dsr_due_soon' and state = 'open';
$$;

-- A. The list function at the edges of its window, on the transaction clock (now() is frozen, so the edges are to the second).
-- First-response deadlines: completion is far away and no response was given unless the name says so.
select pg_temp.add_request((select tenant_t from fx), 'f_in_3d1s', now() + interval '3 days 1 second', now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_in_3d', now() + interval '3 days', now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_in_1d1s', now() + interval '1 day 1 second', now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_in_1d', now() + interval '1 day', now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_now', now(), now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_past_1s', now() - interval '1 second', now() + interval '25 days');
select pg_temp.add_request((select tenant_t from fx), 'f_answered', now() - interval '5 days', now() + interval '25 days', now() - interval '6 days', 'in_progress');
-- Completion deadlines of answered requests.
select pg_temp.add_request((select tenant_t from fx), 'c_in_3d1s', now() - interval '5 days', now() + interval '3 days 1 second', now() - interval '6 days', 'in_progress');
select pg_temp.add_request((select tenant_t from fx), 'c_in_3d', now() - interval '5 days', now() + interval '3 days', now() - interval '6 days', 'in_progress');
select pg_temp.add_request((select tenant_t from fx), 'c_past_1s', now() - interval '5 days', now() - interval '1 second', now() - interval '6 days', 'in_progress');
-- Closed requests are never listed, however late; another tenant's requests are not listed to this tenant.
select pg_temp.add_request((select tenant_t from fx), 'closed_past', now() - interval '9 days', now() - interval '8 days', now() - interval '9 days', 'completed');
select pg_temp.add_request((select tenant_t from fx), 'rejected_past', now() - interval '9 days', now() - interval '8 days', now() - interval '9 days', 'rejected');
select pg_temp.add_request((select tenant_u from fx), 'other_overdue', now() - interval '2 days', now() + interval '25 days');

select is(
  pg_temp.listed((select owner_t from fx), 3),
  'c_in_3d=done/due_soon, c_past_1s=done/overdue, f_in_1d=due_soon/on_track, f_in_1d1s=due_soon/on_track, f_in_3d=due_soon/on_track, f_now=due_soon/on_track, f_past_1s=overdue/on_track',
  'boundary 3 days: a deadline exactly 3 days away is listed and 1 second further is not; exactly now is still due soon and 1 second past is overdue; answered, closed and foreign requests are absent'
);
select is(
  pg_temp.listed((select owner_t from fx), 1),
  'c_past_1s=done/overdue, f_in_1d=due_soon/on_track, f_now=due_soon/on_track, f_past_1s=overdue/on_track',
  'boundary 1 day: exactly 1 day away is listed, 1 day and 1 second is not, the 3-day edges drop out'
);
select is(
  pg_temp.listed((select owner_t from fx), 0),
  'c_past_1s=done/overdue, f_now=due_soon/on_track, f_past_1s=overdue/on_track',
  'boundary 0 days: only a deadline already passed or exactly now'
);
select is(pg_temp.listed((select manager_t from fx), 3), pg_temp.listed((select owner_t from fx), 3), 'decision table: an unlimited manager sees the same list as the owner');
select is(pg_temp.listed((select owner_u from fx), 3), 'other_overdue=overdue/on_track', 'tenant isolation: the other tenant''s owner sees only that tenant''s request');
select is(pg_temp.listed((select store_manager_t from fx), 3), 'error:42501', 'decision table: a manager limited to one store gets no list');
select is(pg_temp.listed((select staff_t from fx), 3), 'error:42501', 'decision table: staff get no list');
select is(pg_temp.listed((select viewer_t from fx), 3), 'error:42501', 'decision table: a viewer gets no list');
select is(pg_temp.run_as('anon', null, 'select count(*)::text from public.dsr_due_soon(3)'), 'error:42501', 'security: anon cannot call the list');
select is(pg_temp.run_as('service_role', null, 'select count(*)::text from public.dsr_due_soon(3)'), 'error:42501', 'security: the service role cannot call the list');
select ok(
  pg_temp.run_as('authenticated', pg_temp.member((select owner_t from fx)), 'select json_agg(r)::text from public.dsr_due_soon(30) r') !~ 'synthetic-contact|synthetic-note',
  'security: the list rows carry no contact and no note'
);
delete from public.data_subject_requests where id in (select id from req);
delete from req;

-- B. The decision table of the evaluator on the other tenant: first response (none and late, none and not yet due, answered)
-- against completion (on track, within 3 days, overdue), each request counted once, overdue before due soon.
create temp table p as select timestamptz '2026-12-01 03:00:00+00' as at;
select pg_temp.add_request((select tenant_u from fx), 'u1_first_overdue', (select at from p) - interval '1 day', (select at from p) + interval '20 days');
select pg_temp.add_request((select tenant_u from fx), 'u2_completion_overdue', (select at from p) - interval '9 days', (select at from p) - interval '1 second', (select at from p) - interval '10 days', 'in_progress');
select pg_temp.add_request((select tenant_u from fx), 'u3_both_overdue', (select at from p) - interval '2 days', (select at from p) - interval '1 day');
select pg_temp.add_request((select tenant_u from fx), 'u4_completion_soon', (select at from p) - interval '9 days', (select at from p) + interval '3 days', (select at from p) - interval '10 days', 'in_progress');
select pg_temp.add_request((select tenant_u from fx), 'u5_first_soon', (select at from p) + interval '3 days', (select at from p) + interval '25 days');
select pg_temp.add_request((select tenant_u from fx), 'u6_first_overdue_completion_soon', (select at from p) - interval '1 second', (select at from p) + interval '1 day');
select pg_temp.add_request((select tenant_u from fx), 'u7_on_track', (select at from p) + interval '3 days 1 second', (select at from p) + interval '25 days');
select pg_temp.add_request((select tenant_u from fx), 'u8_answered_on_track', (select at from p) - interval '5 days', (select at from p) + interval '3 days 1 second', (select at from p) - interval '6 days', 'in_progress');
select pg_temp.add_request((select tenant_u from fx), 'u9_completed', (select at from p) - interval '5 days', (select at from p) - interval '4 days', (select at from p) - interval '6 days', 'completed');
select pg_temp.add_request((select tenant_u from fx), 'u10_rejected', (select at from p) - interval '5 days', (select at from p) - interval '4 days', (select at from p) - interval '6 days', 'rejected');
select pg_temp.add_request((select tenant_t from fx), 't_overdue_not_counted_for_u', (select at from p) - interval '5 days', (select at from p) - interval '4 days');

select is(
  pg_temp.evaluate((select tenant_u from fx), (select at from p)),
  '1:4:2',
  'decision table: four requests overdue (a request late on both deadlines counted once, overdue winning over due soon) and two due soon; answered, on-track, completed, rejected and foreign requests are not counted'
);
select is(
  (select concat_ws(':', count(*), min(facts ->> 'overdue'), min(facts ->> 'due_soon'), min(suppressed_reason)) from public.alert_events where tenant_id = (select tenant_u from fx) and rule_key = 'dsr_due_soon'),
  '1:4:2:no_destination',
  'the other tenant has one episode with those counts, and no destination to tell'
);
select is(pg_temp.episodes((select tenant_t from fx)), '0:0', 'the evaluation of one tenant opens nothing in another');
delete from public.data_subject_requests where id in (select id from req);
delete from req;

-- C. The first-response deadline of a request received by the book, swept through its edges on the first tenant.
select pg_temp.add_request((select tenant_t from fx), 'by_the_book', null, null, null, 'received', timestamptz '2026-11-02 03:00:00+00');
create temp table clock as
select r.first_response_due_at as f, r.completion_due_at as c from public.data_subject_requests r where r.id = pg_temp.rid('by_the_book');
select is(
  (select concat_ws(' | ', f = timestamptz '2026-11-04 03:00:00+00', c = timestamptz '2026-11-22 03:00:00+00') from clock),
  't | t',
  'a request received on Monday 2 November 10:00 local is due a reply on Wednesday 4 November (second working day) and completion 20 days after receipt'
);
create function pg_temp.f() returns timestamptz language sql as $$ select f from clock $$;
create function pg_temp.c() returns timestamptz language sql as $$ select c from clock $$;

select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() - interval '4 days'), '0:0:0', 'on track at the deadline minus 4 days: nothing counted');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() - interval '3 days 1 second'), '0:0:0', 'boundary: 1 second before the 3-day horizon nothing is counted');
select is(pg_temp.episodes((select tenant_t from fx)), '0:0', 'no episode before the horizon, though another tenant has six requests due');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() - interval '3 days'), '1:0:1', 'boundary: exactly 3 days before the reply deadline one request is due soon and one episode opens');
select is(pg_temp.episodes((select tenant_t from fx)), '1:1', 'one open episode');
create temp table first_episode as
select e.id, e.opened_at, e.severity::text as severity, e.source, e.occurrences
from public.alert_events e where e.tenant_id = (select tenant_t from fx) and e.rule_key = 'dsr_due_soon';
select is(
  (select concat_ws(' | ', severity, source, occurrences::text, opened_at = pg_temp.f() - interval '3 days') from first_episode),
  'warning | incremental | 1 | t',
  'the episode is a warning opened at the reading instant'
);
select is(
  (select facts::text from public.alert_events where id = (select id from first_episode)),
  '{"days": 3, "overdue": 0, "due_soon": 1}',
  'the episode facts are the three counts and nothing else'
);
select is(
  (select string_agg(c.name, ',' order by c.name) from public.outbound_messages o join chan c on c.id = o.channel_id where o.alert_event_id = (select id from first_episode) and o.kind = 'alert'),
  'manager_t,owner_t',
  'decision table: the owner and the unlimited manager are told once; a store-limited manager, staff and a viewer are not'
);
select is(
  pg_temp.run_as('authenticated', pg_temp.member((select owner_t from fx)), format('select count(*)::text from public.alert_events where tenant_id = %L and rule_key = ''dsr_due_soon''', (select tenant_t from fx))),
  'ok:1',
  'decision table: the owner reads the episode'
);
select is(
  pg_temp.run_as('authenticated', pg_temp.member((select manager_t from fx)), format('select count(*)::text from public.alert_events where tenant_id = %L and rule_key = ''dsr_due_soon''', (select tenant_t from fx))),
  'ok:1',
  'decision table: the unlimited manager reads the episode'
);
select is(
  (select string_agg(pg_temp.run_as('authenticated', pg_temp.member(u.id), format('select count(*)::text from public.alert_events where tenant_id = %L and rule_key = ''dsr_due_soon''', (select tenant_t from fx))), ',' order by u.n)
   from (select 1 as n, store_manager_t as id from fx union all select 2, staff_t from fx union all select 3, viewer_t from fx union all select 4, owner_u from fx) u),
  'ok:0,ok:0,ok:0,ok:0',
  'security: a store-limited manager, staff, a viewer and another tenant''s owner read no episode'
);
select is(
  pg_temp.run_as('anon', null, format('select count(*)::text from public.alert_events where tenant_id = %L', (select tenant_t from fx))),
  'error:42501',
  'security: anon reads no episode'
);
select is(
  (select count(*)::integer from public.alert_events e, public.outbound_messages o
   where e.id = (select id from first_episode) and o.alert_event_id = e.id
     and (to_jsonb(e)::text || to_jsonb(o)::text) ~ ('synthetic-contact|synthetic-note|' || (select id::text from req where name = 'by_the_book'))),
  0,
  'security: the episode row and its queued messages hold no contact, no note and no request id'
);
select is(
  (select count(*)::integer from public.outbound_messages o where o.alert_event_id = (select id from first_episode) and (not app.facts_are_count_only(o.params) or o.params ? 'phone' or o.params ? 'contact' or o.params ? 'name' or o.params ? 'request_id')),
  0,
  'security: the queued message parameters are count-only'
);
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() - interval '1 day'), '0:0:1', 'the deadline minus 1 day: still one request due soon, the same episode, nothing new to open');
select is(pg_temp.episodes((select tenant_t from fx)), '1:1', 'state transition: still one episode and it is still open');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f()), '0:0:1', 'boundary: exactly at the reply deadline the request is due soon, not yet overdue');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() + interval '1 second'), '0:1:0', 'boundary: 1 second past the reply deadline the request is overdue');
select is(
  (select concat_ws(' | ', id = (select id from first_episode), state, facts::text) from public.alert_events where tenant_id = (select tenant_t from fx) and rule_key = 'dsr_due_soon'),
  't | open | {"days": 3, "overdue": 1, "due_soon": 0, "days_late": 0}',
  'state transition: the one episode escalates from due soon to overdue in place, its counts moved (days_late 0 at the deadline) and no second episode'
);
select is(pg_temp.messages((select tenant_t from fx)), 4, 'ADR-045 (G-101): the escalation queues the overdue reminder to the same two people, 2 opening messages and 2 reminders');
select is(
  (select concat_ws(':', (o.params ->> 'overdue'), (o.params ->> 'due_soon'))
   from public.outbound_messages o where o.alert_event_id = (select id from first_episode) and o.channel_id = (select id from chan where name = 'owner_t') and o.kind = 'alert'),
  '0:1',
  'characterisation: the opening message keeps the counts of the instant it was queued'
);
select is(
  (select concat_ws(':', (o.params ->> 'overdue'), (o.params ->> 'due_soon'), (o.params ->> 'days_late'), o.template_ref)
   from public.outbound_messages o where o.alert_event_id = (select id from first_episode) and o.channel_id = (select id from chan where name = 'owner_t') and o.kind = 'alert_reminder'),
  '1:0:0:alert.dsr_due_soon.reminder.v1',
  'ADR-045: the reminder carries the overdue wording, 1 overdue, 0 days late at the deadline'
);

-- Recording the late response answers the first deadline: nothing is due until the completion deadline comes within 3 days.
update public.data_subject_requests set status = 'in_progress', responded_at = pg_temp.f() + interval '1 day' where id = pg_temp.rid('by_the_book');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() + interval '2 days'), '0:0:0', 'state transition: once the first response is recorded nothing is due, though it was late');
select is(
  (select concat_ws(' | ', state, resolution, resolved_at = pg_temp.f() + interval '2 days') from public.alert_events where id = (select id from first_episode)),
  'resolved | cleared | t',
  'the episode is resolved as cleared at the reading instant'
);
select is(pg_temp.messages((select tenant_t from fx)), 4, 'a rule without a resolution notice queues no recovery message');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.f() + interval '2 days'), '0:0:0', 'a second reading of a clear tenant opens nothing');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c() - interval '3 days 1 second'), '0:0:0', 'boundary: 1 second before the completion deadline''s 3-day horizon nothing is counted');
select is(pg_temp.episodes((select tenant_t from fx)), '1:0', 'no new episode yet: one resolved');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c() - interval '3 days'), '1:0:1', 'boundary: exactly 3 days before the completion deadline the request is due soon and a new episode opens');
select is(pg_temp.episodes((select tenant_t from fx)), '2:1', 'state transition: the resolved episode stays as history and a new one is open');
select is(pg_temp.messages((select tenant_t from fx)), 6, 'the reopened episode tells the same two people once more');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c()), '0:0:1', 'boundary: exactly at the completion deadline the request is due soon, not overdue');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c() + interval '1 second'), '0:1:0', 'boundary: 1 second past the completion deadline the request is overdue');
select is(pg_temp.open_facts((select tenant_t from fx)), '{"days": 3, "overdue": 1, "due_soon": 0, "days_late": 0}', 'the open episode holds the overdue count');
update public.data_subject_requests set status = 'completed', completed_at = pg_temp.c() + interval '1 day' where id = pg_temp.rid('by_the_book');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c() + interval '2 days'), '0:0:0', 'state transition: a completed request leaves the count');
select is(pg_temp.episodes((select tenant_t from fx)), '2:0', 'open to resolved: the second episode is resolved and none is open');
select is(pg_temp.messages((select tenant_t from fx)), 8, 'completion queues no message (the 8 are 2 openings and 2 reminders for each of the two episodes)');
select is(pg_temp.evaluate((select tenant_t from fx), pg_temp.c() + interval '3 days'), '0:0:0', 'a later reading opens nothing');
select is(pg_temp.evaluate('ffffffff-ffff-4fff-8fff-000000235999'::uuid, pg_temp.c()), '0:0:0', 'negative: a tenant that does not exist opens nothing and does not fail');
select is(pg_temp.episodes('ffffffff-ffff-4fff-8fff-000000235999'::uuid), '0:0', 'and leaves no episode');
select is(pg_temp.episodes((select tenant_u from fx)), '1:1', 'the other tenant''s episode was untouched by the first tenant''s readings');

-- D. The 24-hour cool-down and the rule's own settings, on the third tenant (one owner destination).
create temp table w as select timestamptz '2026-12-07 03:00:00+00' as t0;
select pg_temp.add_request((select tenant_w from fx), 'w1', (select t0 from w) + interval '3 days', (select t0 from w) + interval '40 days');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w)), '1:0:1', 'a due-soon request opens an episode');
select is(pg_temp.messages((select tenant_w from fx)), 1, 'and tells the owner');
update public.data_subject_requests set status = 'completed', completed_at = (select t0 from w) + interval '30 minutes' where id = pg_temp.rid('w1');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '1 hour'), '0:0:0', 'the request is completed and the episode resolves');
select pg_temp.add_request((select tenant_w from fx), 'w2', (select t0 from w) + interval '24 hours' - interval '1 second' + interval '3 days', (select t0 from w) + interval '40 days');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '24 hours' - interval '1 second'), '1:0:1', 'boundary: 1 second before the 24-hour cool-down ends a new request opens an episode');
select is(
  (select suppressed_reason from public.alert_events where tenant_id = (select tenant_w from fx) and rule_key = 'dsr_due_soon' and state = 'open'),
  'cool_down',
  'but it is held back by the cool-down'
);
select is(pg_temp.messages((select tenant_w from fx)), 1, 'and the owner is not told again');
update public.data_subject_requests set status = 'completed', completed_at = (select t0 from w) + interval '24 hours' where id = pg_temp.rid('w2');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '24 hours'), '0:0:0', 'the second request is completed and its episode resolves');
select pg_temp.add_request((select tenant_w from fx), 'w3', (select t0 from w) + interval '24 hours' + interval '3 days', (select t0 from w) + interval '40 days');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '24 hours'), '1:0:1', 'boundary: exactly 24 hours after the last notice a new request opens an episode');
select is(
  (select coalesce(suppressed_reason, 'told') from public.alert_events where tenant_id = (select tenant_w from fx) and rule_key = 'dsr_due_soon' and state = 'open'),
  'told',
  'and the cool-down no longer holds it back'
);
select is(pg_temp.messages((select tenant_w from fx)), 2, 'so the owner is told a second time');
update public.data_subject_requests set status = 'completed', completed_at = (select t0 from w) + interval '25 hours' where id = pg_temp.rid('w3');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '26 hours'), '0:0:0', 'the third request is completed and its episode resolves');
select is(pg_temp.episodes((select tenant_w from fx)), '3:0', 'three episodes in all, none open');

insert into public.alert_rules (tenant_id, rule_key, params) select tenant_w, 'dsr_due_soon', '{"days": 1}'::jsonb from fx;
select pg_temp.add_request((select tenant_w from fx), 'w4', (select t0 from w) + interval '10 days', (select t0 from w) + interval '40 days');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '9 days' - interval '1 second'), '0:0:0', 'boundary with the days parameter set to 1: 1 day and 1 second before the deadline nothing is counted');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '9 days'), '1:0:1', 'boundary: exactly 1 day before the deadline the request is due soon');
select is(pg_temp.open_facts((select tenant_w from fx)), '{"days": 1, "overdue": 0, "due_soon": 1}', 'the episode facts carry the days of the rule');
update public.data_subject_requests set status = 'completed', completed_at = (select t0 from w) + interval '9 days 1 hour' where id = pg_temp.rid('w4');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '9 days 2 hours'), '0:0:0', 'the request is completed and the episode resolves');
update public.alert_rules set enabled = false where tenant_id = (select tenant_w from fx) and rule_key = 'dsr_due_soon';
select pg_temp.add_request((select tenant_w from fx), 'w5', (select t0 from w) + interval '8 days', (select t0 from w) + interval '40 days');
select is(pg_temp.evaluate((select tenant_w from fx), (select t0 from w) + interval '10 days'), '0:1:0', 'negative: with the rule off the overdue request is counted but no alert opens');
select is(pg_temp.episodes((select tenant_w from fx)), '4:0', 'and no episode is added');

-- E. Nobody but the database's own jobs may run the evaluator or the rules hook.
select is(
  (select string_agg(pg_temp.run_as(v.role, v.claims, format('select app.evaluate_dsr_due_soon(%L, now())::text', (select tenant_t from fx))), ',' order by v.n)
   from (select 1 as n, 'anon' as role, null::jsonb as claims union all
         select 2, 'authenticated', pg_temp.member((select owner_t from fx)) union all
         select 3, 'authenticated', pg_temp.member((select manager_t from fx)) union all
         select 4, 'service_role', null) v),
  'error:42501,error:42501,error:42501,error:42501',
  'security: anon, an owner, a manager and the service role cannot run the evaluator'
);
select is(
  (select string_agg(pg_temp.run_as(v.role, v.claims, format('select app.notify_tick_rules(now(), %L)::text', (select tenant_t from fx))), ',' order by v.n)
   from (select 1 as n, 'anon' as role, null::jsonb as claims union all
         select 2, 'authenticated', pg_temp.member((select owner_t from fx)) union all
         select 3, 'service_role', null) v),
  'error:42501,error:42501,error:42501',
  'security: anon, an owner and the service role cannot run the rules hook that calls it'
);
select is(pg_temp.episodes((select tenant_t from fx)), '2:0', 'the refused calls changed nothing');
select is(
  (select string_agg(pg_temp.run_as('authenticated', pg_temp.member(u.id), format('insert into public.alert_events (tenant_id, rule_key, dedupe_key, severity, opened_at, last_seen_at, source) values (%L, ''dsr_due_soon'', ''dsr_due_soon:tenant'', ''warning'', now(), now(), ''incremental'') returning id::text', (select tenant_t from fx))), ',' order by u.n)
   from (select 1 as n, owner_t as id from fx union all select 2, manager_t from fx) u),
  'error:42501,error:42501',
  'security: not even an owner or a manager writes an episode from the browser'
);

select * from finish();
rollback;
