-- The SQL half of digest corrections (G-70, #60): app.digests_to_revise and app.revise_digest.
--
-- Techniques (ISTQB): boundary value analysis (a run that finished at exactly the build instant is not newer, one second
-- later is; p_at one second before the run and at it; the business date 3 and 4 local days back), decision table for the
-- candidate rule (run kind x run status x tenant x covered range x time), state transition testing of a digest
-- (built -> revised unchanged -> replaced without a correction -> corrected once -> replaced silently after its one
-- correction), equivalence partitioning of the entries (a correction rendered for a destination, null for another),
-- negative tests (null and malformed inputs, a failed digest, a destination of another tenant) and security tests (the
-- API roles cannot call either function; no message holds anything but the rendered text handed over).
--
-- Every instant is explicit, phones and names are synthetic, nothing is sent, and the file rolls back.
begin;
select plan(43);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000024100001'::uuid as tenant_t,
  'ffffffff-ffff-4fff-8fff-000024100002'::uuid as tenant_u,
  'ffffffff-ffff-4fff-8fff-000024100011'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000024100012'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000024100021'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000024100022'::uuid as store_2,
  'ffffffff-ffff-4fff-8fff-000024100023'::uuid as store_u,
  'ffffffff-ffff-4fff-8fff-000024100101'::uuid as owner_t,
  'ffffffff-ffff-4fff-8fff-000024100102'::uuid as manager_t,
  'ffffffff-ffff-4fff-8fff-000024100103'::uuid as owner_u;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'digest-revision-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_t, fx.manager_t, fx.owner_u]) as u (id);

insert into public.tenants (id, slug, name, timezone)
select tenant_t, 'digest-revision-t-pgtap', 'Digest revision T pgTAP', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_u, 'digest-revision-u-pgtap', 'Digest revision U pgTAP', 'Asia/Ho_Chi_Minh' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_t, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_t, manager_t, 'manager'::public.tenant_role, null::uuid[] from fx
union all
select tenant_u, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'digest-revision-t', 'Synthetic account T' from fx
union all
select account_u, tenant_u, 'mock', 'digest-revision-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select store_1, tenant_t, account_t, 'dr-1', 'Synthetic store 1', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_2, tenant_t, account_t, 'dr-2', 'Synthetic store 2', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_u, tenant_u, account_u, 'dr-u', 'Synthetic store U', 'Asia/Ho_Chi_Minh', 0 from fx;

-- Two destinations of tenant T (the owner and the manager), one of tenant U.
create temp table chan (name text primary key, id uuid);
with inserted as (
  insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
  select v.tenant, 'zalo_bot', 'zalo_bot', 'dest ' || v.name, v.member, 'synthetic-chat-' || v.name, 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', timestamptz '2026-11-01 00:00+00',
    app.ensure_notifications_consent(v.tenant, v.member, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, timestamptz '2026-11-01 00:00+00')
  from fx cross join lateral (
    values ('owner_t', fx.tenant_t, fx.owner_t), ('manager_t', fx.tenant_t, fx.manager_t), ('owner_u', fx.tenant_u, fx.owner_u)
  ) as v (name, tenant, member)
  returning id, address
)
insert into chan select substr(address, 16), id from inserted;

-- Digests: D1 of 2026-11-20 and D2 of 2026-11-19 (both stores of tenant T), built at 03:30 the next local morning;
-- U1 of tenant U; F1 a failed digest; N1 a digest whose builder is gone.
create function pg_temp.scope(p_a uuid, p_b uuid default null)
returns text
language sql
as $$
  select md5(array_to_string(array(select x::text from unnest(array[p_a, p_b]) as x where x is not null order by x::text), ','));
$$;

create temp table digests_made (name text primary key, id uuid);
create function pg_temp.build(p_name text, p_tenant uuid, p_date date, p_stores uuid[], p_builder uuid, p_at timestamptz)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  select app.complete_digest(
    p_tenant, p_date, md5(array_to_string(array(select x::text from unnest(p_stores) as x order by x::text), ',')), p_stores, false,
    'settled', 'verified', '{"revenue": 100, "stores": ["a"]}'::jsonb, 1, repeat('a', 64), p_builder, p_at
  ) into v_id;
  insert into digests_made values (p_name, v_id);
end;
$$;

select pg_temp.build('d1', (select tenant_t from fx), date '2026-11-20', array[(select store_1 from fx), (select store_2 from fx)], (select owner_t from fx), timestamptz '2026-11-21 03:30+07');
select pg_temp.build('d2', (select tenant_t from fx), date '2026-11-19', array[(select store_1 from fx)], (select owner_t from fx), timestamptz '2026-11-20 03:30+07');
select pg_temp.build('u1', (select tenant_u from fx), date '2026-11-20', array[(select store_u from fx)], (select owner_u from fx), timestamptz '2026-11-21 03:30+07');

create function pg_temp.did(p_name text) returns uuid language sql as $$ select id from digests_made where name = p_name $$;

-- The run helper: a sync run of tenant T (or U) of a kind, status and range, finishing at an instant.
create function pg_temp.run(p_tenant uuid, p_kind text, p_status text, p_from date, p_to date, p_finished timestamptz)
returns void
language sql
as $$
  insert into public.sync_runs (tenant_id, pos_account_id, kind, range_start, range_end, started_at, finished_at, status)
  select p_tenant, case when p_tenant = fx.tenant_t then fx.account_t else fx.account_u end, p_kind::public.sync_kind, p_from, p_to,
    p_finished - interval '1 minute', p_finished, p_status::public.sync_status
  from fx;
$$;
create function pg_temp.clear_runs() returns void language sql as $$ delete from public.sync_runs where tenant_id in (select tenant_t from fx union all select tenant_u from fx) $$;

create function pg_temp.candidates(p_at timestamptz, p_tenant uuid default null)
returns text
language sql
as $$
  select coalesce(string_agg(m.name, ',' order by r.business_date, r.scope_key, m.name), '-')
  from app.digests_to_revise(p_at, p_tenant) r join digests_made m on m.id = r.digest_id;
$$;

-- A. The candidate rule.
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), '-', 'no run at all: nothing to revise');
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', date '2026-11-20', date '2026-11-20', timestamptz '2026-11-21 03:30+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), '-', 'boundary: a run that finished at exactly the build instant is not newer');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', date '2026-11-20', date '2026-11-20', timestamptz '2026-11-21 03:30:01+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd1', 'boundary: one second after the build, a nightly run covering the date makes the digest a candidate');
select is(pg_temp.candidates(timestamptz '2026-11-21 03:30:00+07'), '-', 'boundary: p_at one second before the run finished: not yet');
select is(pg_temp.candidates(timestamptz '2026-11-21 03:30:01+07'), 'd1', 'boundary: p_at exactly at the run''s finish: candidate');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07', (select tenant_u from fx)), '-', 'the tenant filter: another tenant has none');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07', (select tenant_t from fx)), 'd1', 'and the tenant''s own filter finds it');

select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'incremental', 'succeeded', null, null, timestamptz '2026-11-21 09:00+07');
select pg_temp.run((select tenant_t from fx), 'master_data', 'succeeded', null, null, timestamptz '2026-11-21 09:01+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), '-', 'decision table: incremental and master-data runs never make a candidate');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'failed', date '2026-11-20', date '2026-11-20', timestamptz '2026-11-21 09:00+07');
select pg_temp.run((select tenant_t from fx), 'nightly', 'running', date '2026-11-20', date '2026-11-20', timestamptz '2026-11-21 09:01+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), '-', 'decision table: a failed or a running run does not count');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_u from fx), 'nightly', 'succeeded', date '2026-11-20', date '2026-11-20', timestamptz '2026-11-21 09:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07', (select tenant_t from fx)), '-', 'decision table: a run of another tenant does not count');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', date '2026-11-21', date '2026-11-21', timestamptz '2026-11-21 09:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), '-', 'decision table: a run whose range does not cover the business date does not count');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'backfill', 'succeeded', date '2026-11-19', date '2026-11-20', timestamptz '2026-11-21 09:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd2,d1', 'a backfill over both dates makes both digests candidates, oldest date first');
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'reconciliation', 'succeeded', null, null, timestamptz '2026-11-21 09:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd2,d1', 'a reconciliation run without a range covers every date');

-- B. The window of recent days: the business date 3 local days back counts, 4 does not.
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', null, null, timestamptz '2026-11-22 20:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-22 21:00+07'), 'd2,d1', 'boundary: on the 22nd local, the 19th is exactly 3 days back and counts, with the 20th');
select is(pg_temp.candidates(timestamptz '2026-11-23 00:10+07'), 'd1', 'boundary: on the 23rd local, the 19th is 4 days back and drops out, the 20th (3 days) stays');
select is(pg_temp.candidates(timestamptz '2026-11-24 00:10+07'), '-', 'on the 24th local, neither is within three days');

-- C. A failed digest and a digest without a builder are never candidates.
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', null, null, timestamptz '2026-11-21 09:00+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd2,d1', 'baseline for the digest states: the two built digests of tenant T');
update public.digests set built_as = null where id = pg_temp.did('d2');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd1', 'a digest whose builder is gone cannot be rebuilt as the recipient: not a candidate');
update public.digests set built_as = (select owner_t from fx) where id = pg_temp.did('d2');

-- D. revise_digest.
create function pg_temp.entries(p_correct boolean)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('channel_id', (select id from chan where name = 'owner_t'),
      'digest', jsonb_build_object('title', 'Bản tin', 'body', 'Bản tin ngày 20/11 sau khi cập nhật'),
      'correction', case when p_correct then jsonb_build_object('title', 'Cập nhật', 'body', 'Cập nhật bản tin ngày 20/11: doanh thu giảm') else null end),
    jsonb_build_object('channel_id', (select id from chan where name = 'manager_t'),
      'digest', jsonb_build_object('title', 'Bản tin', 'body', 'Bản tin ngày 20/11 sau khi cập nhật'),
      'correction', case when p_correct then jsonb_build_object('title', 'Cập nhật', 'body', 'Cập nhật bản tin ngày 20/11: doanh thu giảm') else null end)
  );
$$;
create function pg_temp.state_of(p_name text)
returns text
language sql
as $$
  select concat_ws(' | ', d.revision, d.fingerprint = repeat('a', 64), d.model ->> 'revenue', d.revised_at is not null)
  from public.digests d where d.id = pg_temp.did(p_name);
$$;
create function pg_temp.messages_of(p_name text)
returns integer
language sql
as $$
  select count(*)::integer from public.outbound_messages o where o.digest_id = pg_temp.did(p_name) and o.kind = 'digest_correction';
$$;

select is(pg_temp.state_of('d1'), '0 | t | 100 | f', 'the digest as built: revision 0, original fingerprint and model, never revised');
select is(
  app.revise_digest(pg_temp.did('d1'), '{"revenue": 100, "stores": ["a"]}'::jsonb, repeat('a', 64), pg_temp.entries(true), timestamptz '2026-11-21 09:10+07'),
  0,
  'an unchanged fingerprint queues nothing'
);
select is(pg_temp.state_of('d1'), '0 | t | 100 | t', 'and only records the revision instant: model and revision are as they were');

select is(
  app.revise_digest(pg_temp.did('d1'), '{"revenue": 100, "stores": ["a", "b"]}'::jsonb, repeat('b', 64), pg_temp.entries(false), timestamptz '2026-11-21 09:20+07'),
  0,
  'state transition: a change with no correction rendered (items only) queues nothing'
);
select is(pg_temp.state_of('d1'), '0 | f | 100 | t', 'and replaces the model and the fingerprint without spending the one correction: revision stays 0');

select is(
  app.revise_digest(pg_temp.did('d1'), '{"revenue": 90, "stores": ["a", "b"]}'::jsonb, repeat('c', 64), pg_temp.entries(true), timestamptz '2026-11-21 09:30+07'),
  2,
  'state transition: a change with a correction for each of the two destinations queues two corrections'
);
select is(pg_temp.state_of('d1'), '1 | f | 90 | t', 'and sets revision to 1 with the new model');
select is(
  (select string_agg(o.kind || ':' || o.template_ref || ':' || (o.dedupe_key like 'digest:' || pg_temp.did('d1')::text || ':%:r1')::text, ',' order by o.dedupe_key) from public.outbound_messages o where o.digest_id = pg_temp.did('d1')),
  'digest_correction:digest_correction.v1:true,digest_correction:digest_correction.v1:true',
  'the corrections are digest_correction.v1 messages keyed digest:<id>:<destination>:r1'
);
select is(
  (select count(distinct o.channel_id)::integer from public.outbound_messages o where o.digest_id = pg_temp.did('d1')),
  2,
  'one to each destination of the tenant'
);
select is(
  (select o.body from public.outbound_messages o where o.digest_id = pg_temp.did('d1') and o.channel_id = (select id from chan where name = 'owner_t')),
  'Cập nhật bản tin ngày 20/11: doanh thu giảm',
  'the body is the rendered correction handed over, nothing else'
);

select is(
  app.revise_digest(pg_temp.did('d1'), '{"revenue": 80, "stores": ["a", "b"]}'::jsonb, repeat('d', 64), pg_temp.entries(true), timestamptz '2026-11-21 09:40+07'),
  0,
  'one correction at most: a later change is replaced silently'
);
select is(pg_temp.state_of('d1'), '1 | f | 80 | t', 'the model is current and revision stays 1');
select is(pg_temp.messages_of('d1'), 2, 'and no third message exists');

-- E. Candidates again after a revision: only a later run brings the digest back.
select pg_temp.clear_runs();
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', null, null, timestamptz '2026-11-21 09:40+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd2', 'a run that finished at the last revision instant does not bring the revised digest back (d2 was never revised)');
select pg_temp.run((select tenant_t from fx), 'nightly', 'succeeded', null, null, timestamptz '2026-11-21 09:40:01+07');
select is(pg_temp.candidates(timestamptz '2026-11-21 12:00+07'), 'd2,d1', 'one second later it is back');

-- F. Negative tests.
select throws_ok(format('select app.revise_digest(%L, null, %L, ''[]'', now())', pg_temp.did('d2'), repeat('a', 64)), '22023', null, 'a null model is refused');
select throws_ok(format('select app.revise_digest(%L, ''{}''::jsonb, %L, ''[]'', now())', pg_temp.did('d2'), 'not-a-hash'), '22023', null, 'a fingerprint that is not a SHA-256 hex string is refused');
select throws_ok(format('select app.revise_digest(%L, ''{}''::jsonb, %L, ''{}''::jsonb, now())', pg_temp.did('d2'), repeat('a', 64)), '22023', null, 'entries that are not an array are refused');
select throws_ok(format('select app.revise_digest(%L, ''{}''::jsonb, %L, ''[]'', null)', pg_temp.did('d2'), repeat('a', 64)), '22023', null, 'a missing instant is refused');
select throws_ok(format('select app.revise_digest(%L, ''{}''::jsonb, %L, ''[]'', now())', 'ffffffff-ffff-4fff-8fff-000024199999', repeat('a', 64)), '22023', null, 'a digest that does not exist is refused');
select throws_ok(
  format('select app.revise_digest(%L, ''{"revenue": 1}''::jsonb, %L, %L::jsonb, now())', pg_temp.did('u1'), repeat('e', 64),
    jsonb_build_array(jsonb_build_object('channel_id', (select id from chan where name = 'owner_t'), 'correction', jsonb_build_object('title', 'x', 'body', 'y')))::text),
  '22023', null, 'a destination of another tenant is refused'
);
select is(pg_temp.state_of('u1'), '0 | t | 100 | f', 'and the refused call left the digest of the other tenant as it was');

-- G. Security: no API role runs either function. The statements are built here, as the superuser, and run as the role.
create function pg_temp.as_role(p_role text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_original text := current_user;
  v_result text;
begin
  begin
    perform set_config('role', p_role, true);
    execute p_statement;
    v_result := 'ok';
  exception when others then
    v_result := sqlstate;
  end;
  perform set_config('role', v_original, true);
  return v_result;
end;
$$;
select is(pg_temp.as_role('authenticated', 'select * from app.digests_to_revise(now(), null)'), '42501', 'a signed-in member cannot list the digests to revise');
select is(pg_temp.as_role('authenticated', format('select app.revise_digest(%L, ''{}''::jsonb, %L, ''[]'', now())', pg_temp.did('d2'), repeat('a', 64))), '42501', 'nor revise one');
select is(pg_temp.as_role('anon', 'select * from app.digests_to_revise(now(), null)'), '42501', 'anon cannot list them');

select * from finish();
rollback;
