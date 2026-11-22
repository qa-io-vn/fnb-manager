-- The data-subject deadline alert after the escalation (G-101, ADR-045).
--
-- (a) A request that turns overdue is escalated once, with the overdue wording (the rule's reminder template), and
--     reminded every 24 hours while a request stays overdue; a request that is only due soon keeps the single early
--     notice and no repeats. (b) The evaluator keeps reading a tenant that has no working destination: the episode stays
--     open with current counts, and its first message goes out when a destination exists.
--
-- Techniques (ISTQB): state transition testing (due soon -> overdue -> reminded -> reminded -> resolved), boundary value
-- analysis (exactly the deadline is still due soon, 1 second past it is overdue, 24 hours minus 1 second after the last
-- message is silent, exactly 24 hours is the next reminder, the same instant read twice queues nothing), equivalence
-- partitioning (due soon only, overdue, a second request turning overdue while one already is, a tenant with and a tenant
-- without a destination, a destination lost while overdue) and security (every queued message and the episode carry
-- counts only, never a contact, a note or a request id).
--
-- Every instant is fixed (nothing reads now() for the rule), the contacts are synthetic, nothing is sent, and the file
-- rolls back.
begin;
select plan(26);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000000239001'::uuid as tenant_a,
  'ffffffff-ffff-4fff-8fff-000000239002'::uuid as tenant_b,
  'ffffffff-ffff-4fff-8fff-000000239003'::uuid as tenant_c,
  'ffffffff-ffff-4fff-8fff-000000239101'::uuid as owner_a,
  'ffffffff-ffff-4fff-8fff-000000239102'::uuid as owner_b,
  'ffffffff-ffff-4fff-8fff-000000239103'::uuid as owner_c;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-escalation-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_a, fx.owner_b, fx.owner_c]) as u (id);

insert into public.tenants (id, slug, name, country_code, timezone)
select tenant_a, 'dsr-escalation-a-pgtap', 'DSR escalation A pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_b, 'dsr-escalation-b-pgtap', 'DSR escalation B pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_c, 'dsr-escalation-c-pgtap', 'DSR escalation C pgTAP', 'VN', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_c, owner_c, 'owner'::public.tenant_role, null::uuid[] from fx;

-- One Zalo bot destination for the owner of tenant A; tenant B gets its destination later in the test.
create temp table chan (name text primary key, id uuid);
create function pg_temp.add_destination(p_name text, p_tenant uuid, p_member uuid)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
  values (p_tenant, 'zalo_bot', 'zalo_bot', 'dest ' || p_name, p_member, 'synthetic-chat-' || p_name, 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', timestamptz '2026-11-01 00:00+00',
    app.ensure_notifications_consent(p_tenant, p_member, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, timestamptz '2026-11-01 00:00+00'))
  returning id into v_id;
  insert into chan values (p_name, v_id);
end;
$$;
select pg_temp.add_destination('owner_a', (select tenant_a from fx), (select owner_a from fx));

create function pg_temp.add_request(p_tenant uuid, p_name text, p_first timestamptz, p_completion timestamptz)
returns uuid
language sql
as $$
  insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type, received_at, first_response_due_at, completion_due_at, status, notes)
  values (p_tenant, 'customer', 'synthetic-contact-239-' || p_name, 'access', timestamptz '2026-12-01 00:00+00', p_first, p_completion, 'received', 'synthetic-note-239-' || p_name)
  returning id;
$$;

-- t0 is the first reading; the first request's reply deadline F is 3 days later, the second one's is 6 hours after F.
create temp table clock as select timestamptz '2026-12-07 03:00:00+00' as t0, timestamptz '2026-12-10 03:00:00+00' as f;
create function pg_temp.t0() returns timestamptz language sql as $$ select t0 from clock $$;
create function pg_temp.f() returns timestamptz language sql as $$ select f from clock $$;

select pg_temp.add_request((select tenant_a from fx), 'r1', pg_temp.f(), pg_temp.t0() + interval '40 days');
select pg_temp.add_request((select tenant_a from fx), 'r2', pg_temp.f() + interval '6 hours', pg_temp.t0() + interval '40 days');

-- The evaluator at a fixed instant: <alerts opened>:<overdue>:<due soon>:<reminders queued>.
create function pg_temp.evaluate(p_tenant uuid, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', r ->> 'dsr_alerts', r ->> 'overdue', r ->> 'due_soon', coalesce(r ->> 'reminders', '-'))
  from (select app.evaluate_dsr_due_soon(p_tenant, p_at) as r) x;
$$;

create function pg_temp.messages(p_tenant uuid, p_kind text default null)
returns integer
language sql
as $$
  select count(*)::integer
  from public.outbound_messages o join public.alert_events e on e.id = o.alert_event_id
  where e.tenant_id = p_tenant and e.rule_key = 'dsr_due_soon' and (p_kind is null or o.kind = p_kind);
$$;

create function pg_temp.open_facts(p_tenant uuid)
returns text
language sql
as $$
  select string_agg(facts::text, ' ') from public.alert_events where tenant_id = p_tenant and rule_key = 'dsr_due_soon' and state = 'open';
$$;

-- A. Tenant A: due soon only.
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.t0()), '1:0:1:-', 'a request due within 3 days opens the episode, one is due soon');
select is(pg_temp.messages((select tenant_a from fx)), 1, 'and the owner gets the early notice');
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.t0() + interval '25 hours'), '0:0:2:0', 'a day later both requests are only due soon: no reminder');
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.t0() + interval '2 days'), '0:0:2:0', 'two days later, still none: requests that are only due soon are told once');
select is(pg_temp.messages((select tenant_a from fx)), 1, 'one message in all, no repeat while only due soon');
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f()), '0:0:2:0', 'boundary: exactly at the first reply deadline the request is due soon, not overdue: no reminder');

-- B. The request turns overdue: escalated once.
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '1 second'), '0:1:1:1', 'boundary: 1 second past the deadline it is overdue (the other still due soon) and the escalation queues one reminder');
select is(
  (select concat_ws(' | ', o.kind, o.template_ref, o.params ->> 'overdue', o.params ->> 'days_late')
   from public.outbound_messages o join public.alert_events e on e.id = o.alert_event_id
   where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'dsr_due_soon' and o.kind = 'alert_reminder'),
  'alert_reminder | alert.dsr_due_soon.reminder.v1 | 1 | 0',
  'the reminder is the overdue wording: 1 overdue, 0 days late'
);
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '1 second'), '0:1:1:0', 'the same instant read again queues nothing');
select is(pg_temp.messages((select tenant_a from fx)), 2, 'two messages: the early notice and the overdue reminder');

-- C. A second request turns overdue while one already is: counted, not announced on its own.
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '7 hours'), '0:2:0:0', 'a second request turning overdue changes the count and queues nothing before the cadence is due');
select is(pg_temp.open_facts((select tenant_a from fx)), '{"days": 3, "overdue": 2, "due_soon": 0, "days_late": 0}', 'the episode holds the two overdue requests and 0 days late');

-- D. The 24-hour cadence while overdue.
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '1 second' + interval '24 hours' - interval '1 second'), '0:2:0:0', 'boundary: 24 hours minus 1 second after the last message is silent');
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '1 second' + interval '24 hours'), '0:2:0:1', 'boundary: exactly 24 hours after the last message is the next reminder');
select is(pg_temp.open_facts((select tenant_a from fx)), '{"days": 3, "overdue": 2, "due_soon": 0, "days_late": 1}', 'a day later the oldest request is 1 day late');
select is(pg_temp.messages((select tenant_a from fx), 'alert_reminder'), 2, 'two reminders so far');

-- E. A destination lost while overdue: the episode stays open and its counts stay current, nothing can be queued.
update public.notification_channels set enabled = false where id = (select id from chan where name = 'owner_a');
select is(pg_temp.evaluate((select tenant_a from fx), pg_temp.f() + interval '2 days' + interval '1 second'), '0:2:0:0', 'with no destination the reading still runs and queues nothing');
select is(pg_temp.open_facts((select tenant_a from fx)), '{"days": 3, "overdue": 2, "due_soon": 0, "days_late": 2}', 'the open episode kept current counts, 2 days late');
select is(
  (select count(*)::integer from public.alert_events where tenant_id = (select tenant_a from fx) and rule_key = 'dsr_due_soon' and state = 'open'),
  1,
  'the episode was not closed for lack of a destination'
);

-- F. A tenant that never had a destination, read through the tick (b).
select pg_temp.add_request((select tenant_b from fx), 'b1', pg_temp.f(), pg_temp.t0() + interval '40 days');
select is(
  (app.notify_tick_rules(pg_temp.t0(), (select tenant_b from fx)) ->> 'dsr_due_soon')::integer,
  1,
  'the tick reads a tenant with no destination and opens its episode'
);
select is(pg_temp.messages((select tenant_b from fx)), 0, 'with nobody to tell, no message is queued');
select app.notify_tick_rules(pg_temp.f() + interval '1 hour', (select tenant_b from fx));
select is(pg_temp.open_facts((select tenant_b from fx)), '{"days": 3, "overdue": 1, "due_soon": 0, "days_late": 0}', 'the episode of that tenant turned overdue with current counts');
select pg_temp.add_destination('owner_b', (select tenant_b from fx), (select owner_b from fx));
select app.notify_tick_rules(pg_temp.f() + interval '2 hours', (select tenant_b from fx));
select is(pg_temp.messages((select tenant_b from fx), 'alert_reminder'), 1, 'once a destination exists the overdue notice goes out at the next tick, though no message was ever sent');
select app.notify_tick_rules(pg_temp.f() + interval '3 hours', (select tenant_b from fx));
select is(pg_temp.messages((select tenant_b from fx)), 1, 'and the next tick within the day queues nothing more');

-- G. A tenant with nothing open is not read, and nothing leaks.
select app.notify_tick_rules(pg_temp.t0(), (select tenant_c from fx));
select is(
  (select count(*)::integer from public.alert_events where tenant_id = (select tenant_c from fx)),
  0,
  'a tenant without a request or an episode opens nothing'
);
select is(
  (select count(*)::integer
   from public.alert_events e left join public.outbound_messages o on o.alert_event_id = e.id
   where e.tenant_id in (select tenant_a from fx union all select tenant_b from fx) and e.rule_key = 'dsr_due_soon'
     and ((to_jsonb(e)::text || coalesce(to_jsonb(o)::text, '')) ~ 'synthetic-contact|synthetic-note'
       or (o.id is not null and not app.facts_are_count_only(o.params)))),
  0,
  'security: no episode or message holds a contact or a note, and every message parameter is count-only'
);

select * from finish();
rollback;
