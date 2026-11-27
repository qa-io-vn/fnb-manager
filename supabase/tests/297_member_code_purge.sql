-- Expired member codes are purged (C20; migration member_code_purge): the hourly job deletes the codes that expired more
-- than a day ago and leaves every other code and the guess-limit bookkeeping as they were.
-- Techniques: boundary values of the horizon (expired 23:59:00, exactly 24:00:00 and 24:00:01 ago), equivalence
-- partitions of a code (live, just expired, revoked recently, revoked long ago, three days old), the limit (one at a time,
-- oldest first; out of range refused), idempotence (a second run deletes nothing), regression of the guess limits (the
-- counted misses and the lock untouched; a purged code looks up as the same miss as an expired one; a live code still
-- found; a new code still issued), and grants (no API role runs the job; the schedule is the database's own).
begin;
select plan(17);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029701'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000029701'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000029701'::uuid as store_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029701'::uuid as brand_a,
  '99999999-9999-4999-8999-000000029701'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000029701'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000029711'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029712'::uuid as cust2_u,
  timestamptz '2026-11-25 10:00:00+07' as t;
grant select on fx to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-297-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values (fx.staff_u, null::uuid), (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a)) as u (id, tenant);
insert into public.tenants (id, slug, name) select tenant_a, 'native-297-a', 'Native 297 A' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'native-297-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) select store_a1, tenant_a, account_a, 'n297-a1', 'sa-1', 'Synthetic store A1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_a, staff_u, 'staff', array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-297-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-297-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-297-2', cust2_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table'], array['counter'], false from fx;

-- Codes of the two customers, each a 22-character token kept only as its hash, around the instant t of the run.
create temp table codes (name text primary key, login text, issued interval, expires interval, revoked boolean);
insert into codes values
  ('live', 'cust1', interval '-5 minutes', interval '5 minutes', false),
  ('just_expired', 'cust2', interval '-11 minutes', interval '-1 minute', false),
  ('expired_2359', 'cust1', interval '-24 hours -9 minutes', interval '-23 hours -59 minutes', true),
  ('expired_2400', 'cust2', interval '-24 hours -10 minutes', interval '-24 hours', true),
  ('expired_240001', 'cust1', interval '-24 hours -10 minutes -1 second', interval '-24 hours -1 second', true),
  ('revoked_recent', 'cust2', interval '-50 minutes', interval '-40 minutes', true),
  ('revoked_old', 'cust2', interval '-2 days -10 minutes', interval '-2 days', true),
  ('three_days', 'cust1', interval '-3 days -10 minutes', interval '-3 days', false);
create function pg_temp.token(p_name text) returns text language sql immutable as $$ select rpad('p297' || replace(p_name, '_', ''), 22, 'x') $$;
insert into app.stamp_member_codes (tenant_id, brand_id, customer_login_id, token_sha256, number_sha256, issued_at, expires_at, revoked_at)
select fx.tenant_a, fx.brand_a, l.id, app.stamp_code_hash('token', pg_temp.token(c.name)), app.stamp_code_hash('number', c.name),
  fx.t + c.issued, fx.t + c.expires, case when c.revoked then fx.t + c.expires - interval '1 second' end
from codes c cross join fx
join app.customer_logins l on l.user_id = case c.login when 'cust1' then fx.cust1_u else fx.cust2_u end;
create function pg_temp.left_codes() returns text language sql stable as $$
  select string_agg(c.name, ',' order by c.name) from codes c
  where exists (select 1 from app.stamp_member_codes m where m.token_sha256 = app.stamp_code_hash('token', pg_temp.token(c.name)));
$$;
create function pg_temp.lookup(p_name text, p_at timestamptz) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', (select staff_u from fx), 'role', 'authenticated')::text, true);
  v := app.counter_member_lookup((select store_a1 from fx), 'fnb-stamp:1:' || pg_temp.token(p_name), p_at);
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.issue(p_user uuid) returns jsonb language plpgsql as $f$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', (select tenant_a from fx)))::text, true);
  v := app.customer_stamp_code((select t from fx));
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;
-- A run of the purge, answering the codes of this tenant it deleted (the shared database may hold other tenants' codes).
create function pg_temp.purge(p_at timestamptz, p_limit integer default 20000) returns integer language plpgsql as $f$
declare
  v_before integer := (select count(*) from app.stamp_member_codes where tenant_id = (select tenant_a from fx));
begin
  perform app.purge_stamp_member_codes(p_at, p_limit);
  return v_before - (select count(*) from app.stamp_member_codes where tenant_id = (select tenant_a from fx));
end;
$f$;
create function pg_temp.attempts() returns text language sql stable as $$
  select string_agg(a.endpoint || ':' || a.subject_kind || ':' || a.attempts || ':' || coalesce(a.locked_until::text, '-'), ',' order by a.endpoint, a.subject_kind)
  from app.code_attempts a where a.tenant_id = (select tenant_a from fx);
$$;

select is((select count(*)::int from app.stamp_member_codes where tenant_id = (select tenant_a from fx)), 8, 'eight codes around the run');

-- Two misses of the staff member and a customer's code count are on record before the run.
select is(
  (pg_temp.lookup('nosuchcode', (select t from fx) - interval '2 minutes') ->> 'refusal') || ',' || (pg_temp.lookup('expired_2359', (select t from fx) - interval '1 minute') ->> 'refusal'),
  'code_unknown,code_unknown', 'two lookups miss (an unknown code, an expired one): counted against the person and the store'
);
create temp table recorded as select app.code_attempt_record('customer_stamp_code', tenant_a, null, cust1_u, t - interval '3 minutes') as r from fx;
create temp table before_run as select pg_temp.attempts() as snapshot;

-- 1. The horizon: boundary values and partitions -------------------------------------------------------------------------
select is(pg_temp.purge((select t from fx)), 3, 'the run deletes three codes');
select is(pg_temp.left_codes(), 'expired_2359,expired_2400,just_expired,live,revoked_recent',
  'kept: live, just expired, revoked 40 minutes ago, expired 23:59 ago and exactly 24:00 ago; gone: 24:00:01, two and three days ago');
select is(pg_temp.purge((select t from fx)), 0, 'a second run at the same instant deletes nothing');
select is(pg_temp.purge((select t from fx) + interval '1 second'), 1, 'boundary: one second later the code expired exactly a day ago goes');
select is(pg_temp.left_codes(), 'expired_2359,just_expired,live,revoked_recent', 'and only that one');

-- 2. The limit ----------------------------------------------------------------------------------------------------------
select is(pg_temp.purge((select t from fx) + interval '25 hours', 1), 1, 'with a limit of one, one code goes');
select is(pg_temp.left_codes(), 'just_expired,live,revoked_recent', 'the oldest first (expired 23:59 before the first run)');
select throws_ok($$select app.purge_stamp_member_codes(now(), 0)$$, '22023', null, 'a limit of 0 is refused');
select throws_ok($$select app.purge_stamp_member_codes(null)$$, '22023', null, 'and a run without an instant');

-- 3. The guess limits are untouched; lookups and issuing work as before -----------------------------------------------------
select is(pg_temp.attempts(), (select snapshot from before_run), 'the misses, the code count and any lock on record are exactly as before the runs');
select is(
  (pg_temp.lookup('expired_240001', (select t from fx)) ->> 'refusal') || ',' || (pg_temp.lookup('just_expired', (select t from fx)) ->> 'refusal') || ',' || (pg_temp.lookup('live', (select t from fx)) ->> 'state'),
  'code_unknown,code_unknown,found', 'a purged code is the same miss as an expired one kept; the live code is still found'
);
select is(
  (select a.attempts from app.code_attempts a where a.tenant_id = (select tenant_a from fx) and a.endpoint = 'counter_member_lookup' and a.subject_kind = 'caller'),
  4, 'and both misses are counted, two more than before'
);
select is((pg_temp.issue((select cust2_u from fx)) ->> 'state'), 'issued', 'a customer still gets a new code after the purge');

-- 4. Grants and the schedule ------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'app.purge_stamp_member_codes(timestamptz, integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.purge_stamp_member_codes(timestamptz, integer)', 'execute')
  and not has_function_privilege('service_role', 'app.purge_stamp_member_codes(timestamptz, integer)', 'execute')
  and not has_table_privilege('service_role', 'app.stamp_member_codes', 'delete')
  and exists (select 1 from pg_indexes i where i.schemaname = 'app' and i.tablename = 'stamp_member_codes' and i.indexname = 'stamp_member_codes_expires_idx'),
  'no API role runs the purge or deletes a code; the horizon is indexed'
);
select is(
  (select j.schedule || ' ' || j.command from cron.job j where j.jobname = 'stamp-codes-purge'),
  '17 * * * * select app.purge_stamp_member_codes(now())', 'the job runs hourly, at 17 past, from the migration on'
);

select * from finish();
rollback;
