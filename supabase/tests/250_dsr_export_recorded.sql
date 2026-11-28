begin;
select plan(24);

-- G-53, ADR-054: every answer of dsr_export records one `export` action (the caller, the moment, the counts; never the
-- content); a refused caller records nothing; exports never block the one deletion of a request. Decision table over
-- the caller (owner, manager with every store, store-limited manager, staff, customer session) and the request
-- (open, rejected, a deletion request); boundaries of the deadlines at the export's moment (due exactly then, a
-- microsecond earlier).

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000025001'::uuid as tenant_d,
  'cccccccc-cccc-4ccc-8ccc-000000025001'::uuid as account_d,
  'ffffffff-ffff-4fff-8fff-000000025001'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000025002'::uuid as store_d2,
  'eeeeeeee-eeee-4eee-8eee-000000025001'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000025002'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000025003'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000025004'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000025005'::uuid as customer_login,
  '09000' || '25001' as phone_x,
  '09000' || '25002' as phone_y;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-export-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.customer_login]) as u (id);

insert into public.tenants (id, slug, name, country_code) select tenant_d, 'dsr-export-pgtap', 'DSR export pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'dsr-export', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'dx-1', 'dx-1', 'Synthetic store 1' from fx
union all
select store_d2, tenant_d, account_d, 'dx-2', 'dx-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_d, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_d, 'owner', null::uuid[]), (fx.manager_d, 'manager', null::uuid[]), (fx.store_manager_d, 'manager', array[fx.store_d]),
         (fx.staff_d, 'staff', array[fx.store_d])
) as m (user_id, role, store_ids);
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select v.name, app.loyalty_customer_for_phone(fx.tenant_d, v.phone, now() - interval '20 days')
from fx cross join lateral (values ('customer_x', fx.phone_x), ('customer_y', fx.phone_y)) as v (name, phone);
insert into ids
select 'member_x', app.loyalty_join(fx.tenant_d, (select id from ids where name = 'customer_x'), 'mini_app', fx.store_d, null, null, now() - interval '10 days')
from fx;

create temp table req (name text primary key, id uuid);
create function pg_temp.new_request(p_name text, p_type text, p_customer text, p_status text default 'received',
  p_first_due timestamptz default null, p_completion_due timestamptz default null)
returns void
language sql
as $$
  with r as (
    insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at, status, first_response_due_at, completion_due_at)
    select fx.tenant_d, 'customer'::public.consent_subject, (select id from ids where name = p_customer), 'synthetic-contact', p_type::public.dsr_type,
      now() - interval '1 hour', p_status::public.dsr_status, p_first_due, p_completion_due
    from fx
    returning id
  )
  insert into req select p_name, r.id from r;
$$;
select pg_temp.new_request('access_x', 'access', 'customer_x');
select pg_temp.new_request('due_now', 'access', 'customer_x', 'received', now(), now());
select pg_temp.new_request('due_before', 'access', 'customer_x', 'received', now() - interval '1 microsecond', now() - interval '1 microsecond');
select pg_temp.new_request('rejected_x', 'access', 'customer_x', 'rejected');
select pg_temp.new_request('delete_y', 'deletion', 'customer_y');

create function pg_temp.rid(p_name text) returns uuid language sql as $$ select id from req where name = p_name; $$;

create function pg_temp.outcome_as(p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute p_statement into v_value;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_value, 'null');
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.member(p_user uuid) returns jsonb language sql as $$ select jsonb_build_object('sub', p_user, 'role', 'authenticated'); $$;

create function pg_temp.export(p_claims jsonb, p_request text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select (public.dsr_export(%L::uuid) -> ''counts'')::text', pg_temp.rid(p_request)));
$$;

create function pg_temp.exports(p_request text)
returns integer
language sql
as $$
  select count(*)::integer from public.data_subject_request_actions a where a.request_id = pg_temp.rid(p_request) and a.action = 'export';
$$;

-- the owner's export is recorded once, with the same counts as the file and nothing else
create temp table first_export as select pg_temp.export(pg_temp.member((select owner_d from fx)), 'access_x')::jsonb as counts;
select is(pg_temp.exports('access_x'), 1, 'one answer of dsr_export records one export action');
select is(
  (select a.counts from public.data_subject_request_actions a where a.request_id = pg_temp.rid('access_x') and a.action = 'export'),
  (select counts from first_export),
  'the action holds the counts of the file it answered'
);
select is(
  (select array_agg(k order by k) from first_export, jsonb_object_keys(counts) k),
  array['consent_records', 'inbox', 'invoices', 'loyalty_ledger', 'memberships', 'messages', 'receipt_claims', 'redemptions', 'stamps'],
  'the counts name the eight tables of the file and the inbox of the customer''s Zalo logins (C12)'
);
select ok(
  (select app.facts_are_count_only(a.counts) from public.data_subject_request_actions a where a.request_id = pg_temp.rid('access_x') and a.action = 'export'),
  'the recorded facts are counts only'
);
select is(
  (select a.acted_by from public.data_subject_request_actions a where a.request_id = pg_temp.rid('access_x') and a.action = 'export'),
  (select owner_d from fx),
  'the action names who made the copy'
);
select is(
  (select a.acted_at from public.data_subject_request_actions a where a.request_id = pg_temp.rid('access_x') and a.action = 'export'),
  now(),
  'the action carries the moment of the export'
);
select is(
  (select r.status::text from public.data_subject_requests r where r.id = pg_temp.rid('access_x')),
  'in_progress',
  'the export still moves a received request to in progress'
);

-- each later answer adds its own action
select isnt(pg_temp.export(pg_temp.member((select owner_d from fx)), 'access_x'), null, 'a second export by the owner answers');
select isnt(pg_temp.export(pg_temp.member((select manager_d from fx)), 'access_x'), null, 'a manager with every store exports too');
select is(pg_temp.exports('access_x'), 3, 'three exports of one request are three actions');
select is(
  (select count(*)::integer from public.data_subject_request_actions a where a.request_id = pg_temp.rid('access_x') and a.acted_by = (select manager_d from fx)),
  1,
  'the manager''s copy is recorded under the manager'
);

-- refused callers and requests record nothing
select is(pg_temp.export(pg_temp.member((select store_manager_d from fx)), 'access_x'), 'error:42501', 'a store-limited manager is refused');
select is(pg_temp.export(pg_temp.member((select staff_d from fx)), 'access_x'), 'error:42501', 'staff are refused');
select is(
  pg_temp.export(jsonb_build_object('sub', (select customer_login from fx), 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', (select tenant_d from fx), 'customer_id', (select id from ids where name = 'customer_x'))), 'access_x'),
  'error:42501',
  'the customer''s own session is refused'
);
select is(pg_temp.exports('access_x'), 3, 'a refused caller records no action');
select is(pg_temp.export(pg_temp.member((select owner_d from fx)), 'rejected_x'), 'error:22023', 'a rejected request is not exported');
select is(pg_temp.exports('rejected_x'), 0, 'a refused request records no action');

-- the deadlines at the moment of the export: due exactly then is on time, a microsecond earlier is late
select isnt(pg_temp.export(pg_temp.member((select owner_d from fx)), 'due_now'), null, 'a request due at the export''s moment is exported');
select isnt(pg_temp.export(pg_temp.member((select owner_d from fx)), 'due_before'), null, 'a request due a microsecond earlier is exported');
select is(
  array(
    select concat_ws('/', r.name, a.responded_on_time, a.completed_on_time)
    from req r join public.data_subject_request_actions a on a.request_id = r.id and a.action = 'export'
    where r.name in ('due_now', 'due_before')
    order by r.name
  ),
  array['due_before/f/f', 'due_now/t/t'],
  'the action says whether the copy was made by each deadline'
);

-- exports never take the place of the one deletion
select isnt(pg_temp.export(pg_temp.member((select owner_d from fx)), 'delete_y'), null, 'a deletion request can be exported first');
select is(
  pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), format('select (public.dsr_delete(%L::uuid) ->> ''already_done'')', pg_temp.rid('delete_y'))),
  'false',
  'the deletion after an export is carried out, not answered as already done'
);
select throws_ok(
  format($sql$
    insert into public.data_subject_request_actions (tenant_id, request_id, action, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time)
    select r.tenant_id, r.id, 'deletion', now(), '{}', r.first_response_due_at, r.completion_due_at, true, true from public.data_subject_requests r where r.id = %L
  $sql$, pg_temp.rid('delete_y')),
  '23505',
  null,
  'a request still holds at most one deletion action'
);
select throws_ok(
  format($sql$
    insert into public.data_subject_request_actions (tenant_id, request_id, action, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time)
    select r.tenant_id, r.id, 'printed', now(), '{}', r.first_response_due_at, r.completion_due_at, true, true from public.data_subject_requests r where r.id = %L
  $sql$, pg_temp.rid('access_x')),
  '23514',
  null,
  'an action is a deletion or an export, nothing else'
);

select * from finish();
rollback;
