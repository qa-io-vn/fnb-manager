begin;
select plan(14);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011501'::uuid as tenant_d,
  'cccccccc-cccc-4ccc-8ccc-000000011501'::uuid as account_d,
  'ffffffff-ffff-4fff-8fff-000000011501'::uuid as store_d,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000011501'::uuid as brand_d,
  '99999999-9999-4999-8999-000000011501'::uuid as app_d,
  'eeeeeeee-eeee-4eee-8eee-000000011501'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000011511'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000011512'::uuid as login_2,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-deletion-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_d, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.manager_d, false), (fx.login_1, true), (fx.login_2, true)) as u (id, customer);

insert into public.tenants (id, slug, name, country_code) select tenant_d, 'customer-deletion-pgtap', 'Customer deletion pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_d, tenant_d, 'mock', 'customer-deletion', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'cd-ext-1', 'cd-1', 'Synthetic store 1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_d, manager_d, 'manager'::public.tenant_role, null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_d, tenant_d, 'brand-115', 'Synthetic brand', array[store_d] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_d, tenant_d, brand_d, 'synthetic-deletion-app', 'ZALO_APP_SECRET_BRAND_115', 'active' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, stamps_per_card, welcome_stamps)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 4, 1 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_d, 'privacy_notice', 'vi', 'privacy-cd-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', timestamptz '2026-11-01 00:00+07' from fx;

select app.zalo_customer_sign_in((select app_d from fx), 'cduser' || n, null, ('eeeeeeee-eeee-4eee-8eee-00000001151' || n)::uuid) from generate_series(1, 2) n;
select app.customer_join(('eeeeeeee-eeee-4eee-8eee-00000001151' || n)::uuid, (select app_d from fx), 'cduser' || n, 'Khách cduser' || n, '09000115' || lpad(n::text, 2, '0'),
  true, false, 'privacy-cd-1', 'join-1', (select t0 from fx) - interval '1 day 1 minute', 'cd-1', 'mini_app', (select t0 from fx) - interval '1 day')
from generate_series(1, 2) n;

grant select on fx to authenticated, anon;

create function pg_temp.as_login(p_login uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_login, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', l.tenant_id, 'customer_id', l.customer_id)
  )::text, true)
  from app.customer_logins l where l.user_id = p_login;
$$;

create function pg_temp.wallet(p_login uuid, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_wallet(p_at);
$$;

create function pg_temp.ask(p_login uuid, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_request_deletion(p_at);
$$;

create temp table answers (name text primary key, answer jsonb);
grant select on answers to authenticated;

select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx)) -> 'deletion_request',
  'null'::jsonb,
  'a customer who never asked has no deletion request in the wallet'
);

insert into answers select 'first', pg_temp.ask((select login_1 from fx), (select t0 from fx));
select is(
  (select array_agg(k order by k) from answers, jsonb_object_keys(answer) k where name = 'first'),
  array['completion_due_at', 'first_response_due_at', 'request_id', 'requested_at', 'status'],
  'the request answers its id, status, time and both deadlines'
);
select is(
  (select concat_ws('|', a.answer ->> 'status', (a.answer ->> 'requested_at')::timestamptz = r.received_at,
      (a.answer ->> 'first_response_due_at')::timestamptz = r.first_response_due_at,
      (a.answer ->> 'completion_due_at')::timestamptz = r.completion_due_at,
      r.first_response_due_at > r.received_at, r.completion_due_at > r.first_response_due_at)
   from answers a join public.data_subject_requests r on r.id = (a.answer ->> 'request_id')::uuid
   where a.name = 'first'),
  'received|t|t|t|t|t',
  'the deadlines are those the ledger''s trigger filled, the reply before the deletion'
);
select is(
  (select r.completion_due_at - r.received_at
   from answers a join public.data_subject_requests r on r.id = (a.answer ->> 'request_id')::uuid
   where a.name = 'first'),
  interval '20 days',
  'the deletion is due 20 days after the request'
);

select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx) + interval '1 minute') -> 'deletion_request',
  (select answer from answers where name = 'first'),
  'after a restart the wallet shows the same request, deadlines included'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx) - interval '1 minute') -> 'deletion_request',
  'null'::jsonb,
  'a wallet read before the request was received does not show it'
);
select is(
  pg_temp.wallet((select login_2 from fx), (select t0 from fx) + interval '1 minute') -> 'deletion_request',
  'null'::jsonb,
  'another customer of the tenant does not see the request'
);
select is(
  pg_temp.ask((select login_1 from fx), (select t0 from fx) + interval '2 minutes'),
  (select answer from answers where name = 'first'),
  'asking again answers the open request with the same deadlines'
);

update public.data_subject_requests set status = 'in_progress', handled_by = (select manager_d from fx)
where id = (select (answer ->> 'request_id')::uuid from answers where name = 'first');
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx) + interval '1 hour') -> 'deletion_request' ->> 'status',
  'in_progress',
  'the wallet follows the status the owner sets'
);

update public.data_subject_requests set status = 'rejected', notes = 'synthetic'
where id = (select (answer ->> 'request_id')::uuid from answers where name = 'first');
select is(
  (pg_temp.wallet((select login_1 from fx), (select t0 from fx) + interval '2 hours') -> 'deletion_request') - 'status',
  (select answer - 'status' from answers where name = 'first'),
  'a rejected request is still shown, as the latest one'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx) + interval '2 hours') -> 'deletion_request' ->> 'status',
  'rejected',
  'with its status rejected, so the app can offer a new request'
);

insert into answers select 'second', pg_temp.ask((select login_1 from fx), (select t0 from fx) + interval '3 hours');
select isnt(
  (select answer ->> 'request_id' from answers where name = 'second'),
  (select answer ->> 'request_id' from answers where name = 'first'),
  'after a rejection a new request is recorded'
);

update public.data_subject_requests set received_at = (select t0 from fx) + interval '4 hours'
where id = (select (answer ->> 'request_id')::uuid from answers where name = 'first');
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx) + interval '5 hours') -> 'deletion_request' ->> 'request_id',
  (select answer ->> 'request_id' from answers where name = 'second'),
  'the open request comes before a later closed one'
);

set local role authenticated;
select pg_temp.as_login((select login_1 from fx));
select is(
  public.customer_wallet() -> 'deletion_request' ->> 'request_id',
  (select answer ->> 'request_id' from answers where name = 'second'),
  'the wallet RPC carries the deletion request'
);
reset role;

select * from finish();
rollback;
