begin;
select plan(91);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000016101'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000016102'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000016101'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000016102'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000016101'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000016102'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000016109'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000016101'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000016102'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016103'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016104'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000016105'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000016106'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000009111'::uuid as login_x,
  'eeeeeeee-eeee-4eee-8eee-000000009112'::uuid as login_y,
  '44444444-4444-4444-8444-000000016101'::uuid as brand_d,
  '55555555-5555-4555-8555-000000016101'::uuid as app_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-tooling-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_x, fx.login_y]) as u (id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), login_x, now() - interval '1 day', now() - interval '1 day' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'dsr-tooling-pgtap', 'DSR tooling pgTAP', 'VN' from fx
union all
select tenant_o, 'dsr-tooling-other-pgtap', 'DSR tooling other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'dsr-tooling', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'dsr-tooling-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'dsr-1', 'dsr-1', 'Synthetic store 1' from fx
union all
select store_d2, tenant_d, account_d, 'dsr-2', 'dsr-2', 'Synthetic store 2' from fx
union all
select store_o, tenant_o, account_o, 'dsr-9', 'dsr-9', 'Synthetic other store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_d, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_d, 'owner', null::uuid[]), (fx.manager_d, 'manager', null::uuid[]), (fx.store_manager_d, 'manager', array[fx.store_d]),
         (fx.staff_d, 'staff', array[fx.store_d]), (fx.viewer_d, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_o, owner_o, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_d, tenant_d, 'brand-1', 'Synthetic brand', array[store_d, store_d2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_d, tenant_d, brand_d, 'syn-app-9101', 'ZALO_APP_SECRET_BRAND_1' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select tenant_o, 'Synthetic other programme', date '2026-11-01', 'below_threshold', 'active' from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select v.name, app.loyalty_customer_for_phone(v.tenant, v.phone, now() - interval '20 days')
from fx cross join lateral (
  values ('customer_x', fx.tenant_d, '0900016101'), ('customer_y', fx.tenant_d, '0900016102'), ('customer_z', fx.tenant_d, '0900016103'),
         ('customer_x_other', fx.tenant_o, '0900016101')
) as v (name, tenant, phone);
update public.customers set name = 'Synthetic X' where id = (select id from ids where name = 'customer_x');
insert into ids
select 'member_' || substr(c.name, 10), app.loyalty_join(
  c.tenant, c.id, 'mini_app', c.store, case when c.tenant = fx.tenant_d then fx.brand_d end,
  case when c.tenant = fx.tenant_d then 'syn-zalo-' || substr(c.name, 10, 1) end, now() - interval '10 days'
)
from fx cross join lateral (
  select i.name, i.id, cu.tenant_id as tenant, case when cu.tenant_id = fx.tenant_d then fx.store_d else fx.store_o end as store
  from ids i join public.customers cu on cu.id = i.id
  where i.name like 'customer_%'
) c;

with credits as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select m.tenant_id, m.programme_id, m.id, 'adjust', 20, 100, 50000, 'synthetic credit', now() + interval '300 days', now() - interval '9 days'
  from public.memberships m
  where m.id in (select id from ids where name in ('member_x', 'member_y'))
  returning id, tenant_id, membership_id, stamp_delta
)
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select c.tenant_id, c.membership_id, c.id, now() - interval '9 days', now() + interval '180 days'
from credits c cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_d, store_d, 'crm_code_pool'::public.coupon_rail, '{pool-1}'::text[], now() - interval '30 days' from fx
union all
select tenant_d, store_d2, 'crm_code_pool', '{pool-1}', now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_d, store_d, 'free-drink', 'pool-1', 'discount'::public.einvoice_display from fx
union all
select tenant_d, store_d2, 'free-drink', 'pool-1', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code, imported_at)
select fx.tenant_d, fx.store_d, 'free-drink', v.code, now() - make_interval(hours => v.age)
from fx cross join (values ('SYN-91A', 5), ('SYN-91B', 4), ('SYN-91C', 3), ('SYN-91D', 2)) as v (code, age);
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, status)
select fx.tenant_d, p.id, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 5, 0, 'active'::public.coupon_status
from fx join public.loyalty_programmes p on p.tenant_id = fx.tenant_d;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_phone text default null, p_customer uuid default null, p_voucher text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name, customer_id, voucher_code)
    select fx.tenant_d, fx.store_d, fx.account_d, 'dsr-' || p_name, p_sold, app.store_business_date(fx.store_d, p_sold), p_net, p_net, p_net,
      p_phone, case when p_phone is not null then 'Synthetic till name' end, p_customer, p_voucher
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

insert into ids
select 'redemption_x1', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '5 days') ->> 'redemption_id')::uuid;
select pg_temp.invoice('inv_redeemed', now() - interval '5 days' + interval '10 minutes', 65000, null, null, (select code from public.redemptions where id = (select id from ids where name = 'redemption_x1')));
select app.confirm_redemption((select id from ids where name = 'redemption_x1'), (select id from ids where name = 'inv_redeemed'), now() - interval '5 days' + interval '15 minutes');
insert into ids
select 'redemption_x2', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;
insert into ids
select 'redemption_y', (app.redeem_coupon((select id from ids where name = 'member_y'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;

select pg_temp.invoice('inv_phone', now() - interval '3 days', 60000, '0900016101');
select app.loyalty_earn((select id from ids where name = 'inv_phone'), (select id from ids where name = 'member_x'), 'A', now() - interval '3 days');
select pg_temp.invoice('inv_linked', now() - interval '2 days', 20000, null, (select id from ids where name = 'customer_x'));
select app.loyalty_earn((select id from ids where name = 'inv_linked'), (select id from ids where name = 'member_x'), 'A', now() - interval '2 days');
select pg_temp.invoice('inv_y', now() - interval '2 days', 70000, '0900016102');
select app.loyalty_earn((select id from ids where name = 'inv_y'), (select id from ids where name = 'member_y'), 'A', now() - interval '2 days');
select app.loyalty_submit_claim((select id from ids where name = 'member_x'), (select store_d from fx), app.store_business_date((select store_d from fx), now() - interval '1 day'), '777', 50000, now() - interval '1 hour');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_x'), (select store_d from fx), now() - interval '30 minutes');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_y'), (select store_d from fx), now() - interval '30 minutes');
insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, matched_path, candidate_invoice_ids, reason, created_at)
select tenant_d, store_d, (select id from ids where name = 'member_x'), (select id from ids where name = 'redemption_x2'), 'D', '{}'::uuid[], 'verified_without_invoice', now() - interval '10 minutes' from fx;
insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, reason, requested_by)
select tenant_d, store_d, (select id from ids where name = 'member_x'), 'dispute', 'synthetic dispute', staff_d from fx
union all
select tenant_d, store_d, (select id from ids where name = 'member_y'), 'dispute', 'synthetic dispute', staff_d from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at, evidence)
select fx.tenant_d, 'customer'::public.consent_subject, c.id, v.purpose::public.consent_purpose, 'v1', 'mini_app', now() - v.granted, now() - v.revoked, '{"screen": "join-v1"}'::jsonb
from fx
cross join (select id from ids where name = 'customer_x') c
cross join (values ('loyalty', interval '10 days', null::interval), ('marketing', interval '10 days', interval '8 days'), ('marketing', interval '7 days', null::interval)) as v (purpose, granted, revoked)
union all
select fx.tenant_d, 'customer', (select id from ids where name = 'customer_y'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx
union all
select fx.tenant_o, 'customer', (select id from ids where name = 'customer_x_other'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx;

insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, title, body)
select fx.tenant_d, 'zalo_oa', 'synthetic-recipient-' || v.n, 'customer', c.id, 'marketing', 'synthetic.v1', now() - interval '2 days', 'sent', 'Synthetic title', 'Synthetic body'
from fx
cross join lateral (values (1, 'customer_x'), (2, 'customer_x'), (3, 'customer_y')) as v (n, name)
join ids c on c.name = v.name;

insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_d, app_d, 'syn-zalo-x', login_x, (select id from ids where name = 'customer_x') from fx
union all
select tenant_d, app_d, 'syn-zalo-y', login_y, (select id from ids where name = 'customer_y') from fx;

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

create function pg_temp.member(p_user uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object('sub', p_user, 'role', 'authenticated');
$$;

create function pg_temp.customer(p_user uuid, p_customer text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', (select tenant_d from fx), 'customer_id', (select id from ids where name = p_customer))
  );
$$;


create temp table req (name text primary key, id uuid);
grant select on fx, ids, req to authenticated, service_role;

create function pg_temp.new_request(p_name text, p_tenant uuid, p_type text, p_subject uuid, p_received interval, p_status text default 'received', p_type_subject text default 'customer', p_responded interval default null)
returns void
language sql
as $$
  with r as (
    insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at, status, responded_at)
    values (p_tenant, p_type_subject::public.consent_subject, p_subject, 'synthetic-contact', p_type::public.dsr_type, now() - p_received, p_status::public.dsr_status,
      case when p_responded is not null then now() - p_responded end)
    returning id
  )
  insert into req select p_name, r.id from r;
$$;

select pg_temp.new_request('access_x', (select tenant_d from fx), 'access', (select id from ids where name = 'customer_x'), interval '1 hour');
select pg_temp.new_request('export_x', (select tenant_d from fx), 'export', (select id from ids where name = 'customer_x'), interval '1 hour');
select pg_temp.new_request('correct_x', (select tenant_d from fx), 'correction', (select id from ids where name = 'customer_x'), interval '1 hour');
select pg_temp.new_request('correct_y', (select tenant_d from fx), 'correction', (select id from ids where name = 'customer_y'), interval '1 hour');
select pg_temp.new_request('correct_done', (select tenant_d from fx), 'correction', (select id from ids where name = 'customer_y'), interval '3 days', 'completed');
select pg_temp.new_request('staff_subject', (select tenant_d from fx), 'access', (select staff_d from fx), interval '1 hour', 'received', 'staff');
select pg_temp.new_request('unmatched', (select tenant_d from fx), 'access', null, interval '1 hour');
select pg_temp.new_request('rejected_x', (select tenant_d from fx), 'access', (select id from ids where name = 'customer_x'), interval '1 hour', 'rejected');
select pg_temp.new_request('access_other', (select tenant_o from fx), 'access', (select id from ids where name = 'customer_x_other'), interval '1 hour');
select pg_temp.new_request('overdue_d', (select tenant_d from fx), 'access', (select id from ids where name = 'customer_z'), interval '25 days');
select pg_temp.new_request('soon_d', (select tenant_d from fx), 'export', (select id from ids where name = 'customer_z'), interval '18 days', 'in_progress', 'customer', interval '17 days');
select pg_temp.new_request('ontrack_d', (select tenant_d from fx), 'access', (select id from ids where name = 'customer_z'), interval '1 day', 'in_progress', 'customer', interval '1 hour');
select pg_temp.new_request('closed_d', (select tenant_d from fx), 'deletion', (select id from ids where name = 'customer_z'), interval '40 days', 'completed');
select pg_temp.new_request('overdue_o', (select tenant_o from fx), 'access', (select id from ids where name = 'customer_x_other'), interval '25 days');
select pg_temp.new_request('delete_x', (select tenant_d from fx), 'deletion', (select id from ids where name = 'customer_x'), interval '1 hour');

create function pg_temp.rid(p_name text) returns uuid language sql as $$ select id from req where name = p_name; $$;

create function pg_temp.lookup(p_claims jsonb, p_phone text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select coalesce(json_agg(l)::text, ''[]'') from public.dsr_lookup(%L) l', p_phone));
$$;

create function pg_temp.export(p_claims jsonb, p_request text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select public.dsr_export(%L::uuid)::text', pg_temp.rid(p_request)));
$$;

create function pg_temp.correct(p_claims jsonb, p_request text, p_field text, p_value text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select public.dsr_correct(%L::uuid, %L, %L)::text', pg_temp.rid(p_request), p_field, p_value));
$$;

create function pg_temp.due(p_claims jsonb, p_days text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims, format('select coalesce(json_agg(json_build_object(''n'', r.request_id, ''f'', r.first_response_state, ''c'', r.completion_state) order by r.request_id)::text, ''[]'') from public.dsr_due_soon(%s) r', p_days));
$$;

create function pg_temp.due_names(p_claims jsonb, p_days text)
returns text
language sql
as $$
  select coalesce(string_agg(rq.name, ',' order by rq.name), '')
  from json_array_elements(case when pg_temp.due(p_claims, p_days) like 'error:%' then '[]'::json else pg_temp.due(p_claims, p_days)::json end) e
  join req rq on rq.id = (e ->> 'n')::uuid;
$$;

create function pg_temp.due_state(p_claims jsonb, p_days text, p_request text)
returns text
language sql
as $$
  select concat_ws(':', e ->> 'f', e ->> 'c')
  from json_array_elements(pg_temp.due(p_claims, p_days)::json) e
  where (e ->> 'n')::uuid = pg_temp.rid(p_request);
$$;

create temp table answers (name text primary key, answer text);
grant select on answers to authenticated, service_role;

select ok(
  has_function_privilege('authenticated', 'public.dsr_lookup(text)', 'execute')
    and has_function_privilege('authenticated', 'public.dsr_export(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.dsr_correct(uuid, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.dsr_due_soon(integer)', 'execute')
    and not has_function_privilege('anon', 'public.dsr_lookup(text)', 'execute')
    and not has_function_privilege('anon', 'public.dsr_export(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.dsr_correct(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.dsr_due_soon(integer)', 'execute')
    and not has_function_privilege('service_role', 'public.dsr_export(uuid)', 'execute'),
  'the four tooling functions are for signed-in callers only: anon and the service role cannot run them'
);
select ok(
  not has_function_privilege('authenticated', 'app.dsr_scope_tenant_ids()', 'execute')
    and not has_function_privilege('authenticated', 'app.dsr_request_for_caller(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.evaluate_dsr_due_soon(uuid, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.evaluate_dsr_due_soon(uuid, timestamptz)', 'execute'),
  'the helpers and the alert evaluation are internal: no API role runs them'
);

select is(
  json_array_length(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101')::json)::text,
  '1',
  'dsr_lookup: the owner finds the one customer of the tenant with that phone, not the same phone of another tenant'
);
select is(
  (select concat_ws(':', r ->> 'name', r ->> 'phone_masked', r ->> 'memberships', r ->> 'ledger_entries', r ->> 'messages', r ->> 'open_requests', json_array_length(r -> 'consents'))
   from json_array_elements(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101')::json) r),
  concat_ws(':', 'Synthetic X', '•••• ••• 101', '1',
    (select count(*) from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x')),
    '2', '4', '3'),
  'the summary holds the name, the masked phone, the memberships, the ledger entries, the messages, the open requests and the three consent rows'
);
select is(
  (select concat_ws(':', r ->> 'stamp_total', r ->> 'point_total')
   from json_array_elements(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101')::json) r),
  (select concat_ws(':', sum(stamp_delta), sum(point_delta)) from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x')),
  'the stamp and point totals equal the sums of the subject''s ledger rows'
);
select is(
  pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101') ~ '90001610|\+84900',
  false,
  'no lookup answer holds the full phone, not even for the owner'
);
select is(
  pg_temp.lookup(pg_temp.member((select owner_d from fx)), '+84 900 016 101'),
  pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101'),
  'the phone is matched in any written form (equivalence: local, international with spaces)'
);
select is(
  pg_temp.lookup(pg_temp.member((select manager_d from fx)), '0900016101'),
  pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101'),
  'an unlimited manager sees the same lookup as the owner'
);
select is(
  json_array_length(pg_temp.lookup(pg_temp.member((select owner_o from fx)), '0900016101')::json)::text || ':' || (pg_temp.lookup(pg_temp.member((select owner_o from fx)), '0900016101')::json -> 0 ->> 'open_requests'),
  '1:2',
  'the owner of another tenant finds only their own customer for the same phone, with their own open requests'
);
select is(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016999'), '[]', 'boundary: a phone nobody has gives no rows, not an error');
select is(pg_temp.lookup(pg_temp.member((select owner_d from fx)), 'abc'), '[]', 'negative: letters give no rows');
select is(pg_temp.lookup(pg_temp.member((select owner_d from fx)), ''), '[]', 'boundary: an empty phone gives no rows');
select is(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '''; drop table public.customers; --'), '[]', 'input abuse: an injection string gives no rows');
select ok(exists (select 1 from public.customers limit 1), 'the customers table is still there');
select is(pg_temp.lookup(pg_temp.member((select store_manager_d from fx)), '0900016101'), 'error:42501', 'a store-limited manager cannot look up');
select is(pg_temp.lookup(pg_temp.member((select staff_d from fx)), '0900016101'), 'error:42501', 'staff cannot look up');
select is(pg_temp.lookup(pg_temp.member((select viewer_d from fx)), '0900016101'), 'error:42501', 'a viewer cannot look up');
select is(pg_temp.lookup(pg_temp.customer((select login_x from fx), 'customer_x'), '0900016101'), 'error:42501', 'a customer session cannot look up, not even their own phone');
select is(pg_temp.lookup('{}'::jsonb, '0900016101'), 'error:42501', 'a call without a user cannot look up');
select is(
  pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), $$ select set_config('request.method', 'GET', true) || (select count(*)::text from public.dsr_lookup('0900016101')) $$),
  'error:PT405',
  'a lookup over GET is refused (PT405): the phone never travels in a URL'
);

select is(
  (pg_temp.export(pg_temp.member((select owner_d from fx)), 'access_x') like '{%')::text,
  'true',
  'dsr_export: the owner gets a JSON for the access request of the customer'
);
create temp table exported as
select pg_temp.export(pg_temp.member((select owner_d from fx)), 'export_x')::jsonb as j;
select is(
  (select j -> 'counts' from exported),
  jsonb_build_object(
    'invoices', (select count(*) from public.invoices where customer_id = (select id from ids where name = 'customer_x') or customer_phone in ('0900016101', '+84900016101')),
    'memberships', (select count(*) from public.memberships where customer_id = (select id from ids where name = 'customer_x')),
    'loyalty_ledger', (select count(*) from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x')),
    'stamps', (select count(*) from public.stamps where membership_id = (select id from ids where name = 'member_x')),
    'receipt_claims', (select count(*) from public.receipt_claims where membership_id = (select id from ids where name = 'member_x')),
    'redemptions', (select count(*) from public.redemptions where membership_id = (select id from ids where name = 'member_x')),
    'consent_records', 3,
    'messages', 2
  ),
  'the export counts every row of the subject per table'
);
select ok(
  (select (j -> 'counts' ->> 'loyalty_ledger')::int > 0 and (j -> 'counts' ->> 'stamps')::int > 0 and (j -> 'counts' ->> 'receipt_claims')::int > 0
     and (j -> 'counts' ->> 'redemptions')::int > 0 and (j -> 'counts' ->> 'invoices')::int > 0 from exported),
  'completeness: the synthetic subject has rows in every exported table and the export holds them'
);
select is(
  (select jsonb_array_length(j -> 'loyalty_ledger') from exported),
  (select count(*)::int from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x')),
  'the ledger array has one element per ledger row'
);
select ok(
  not exists (
    select 1 from exported, jsonb_array_elements(j -> 'loyalty_ledger') e
    where (e ->> 'id')::uuid not in (select id from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_x'))
  )
  and not exists (
    select 1 from exported, jsonb_array_elements(j -> 'memberships') e
    where (e ->> 'id')::uuid <> (select id from ids where name = 'member_x')
  ),
  'isolation: every exported ledger row and membership belongs to the subject'
);
select ok(
  (select j::text !~ '0900016102|0900016103|Synthetic Y|syn-zalo' from exported),
  'the export holds no other customer''s phone and no Zalo user id'
);
select is((select j -> 'customer' ->> 'phone' from exported), '+84900016101', 'the owner''s export carries the subject''s own phone');
select is(
  (select concat_ws(':', r.status, r.responded_at is not null) from public.data_subject_requests r where r.id = pg_temp.rid('export_x')),
  'in_progress:t',
  'state transition: exporting moves a received request to in progress and stamps the first response'
);
select is(
  (pg_temp.export(pg_temp.member((select manager_d from fx)), 'access_x')::jsonb -> 'customer' ->> 'phone'),
  '•••• ••• 101',
  'a manager''s export masks the phone'
);
select ok(
  pg_temp.export(pg_temp.member((select manager_d from fx)), 'access_x') !~ '90001610|\+84900',
  'a manager''s export holds no full phone anywhere, invoices included'
);
select is(pg_temp.export(pg_temp.member((select store_manager_d from fx)), 'access_x'), 'error:42501', 'a store-limited manager cannot export');
select is(pg_temp.export(pg_temp.member((select staff_d from fx)), 'access_x'), 'error:42501', 'staff cannot export');
select is(pg_temp.export(pg_temp.member((select viewer_d from fx)), 'access_x'), 'error:42501', 'a viewer cannot export');
select is(pg_temp.export(pg_temp.member((select owner_o from fx)), 'access_x'), 'error:42501', 'the owner of another tenant cannot export');
select is(pg_temp.export(pg_temp.customer((select login_x from fx), 'customer_x'), 'access_x'), 'error:42501', 'the customer cannot export their own data through the tooling');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), $$ select public.dsr_export(gen_random_uuid())::text $$), 'error:42501', 'an unknown request id is refused like a foreign one, so ids cannot be probed');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), $$ select public.dsr_export(null)::text $$), 'error:42501', 'a null request id is refused');
select is(pg_temp.export(pg_temp.member((select owner_d from fx)), 'unmatched'), 'error:22023', 'a request naming no customer is refused');
select is(pg_temp.export(pg_temp.member((select owner_d from fx)), 'staff_subject'), 'error:22023', 'a request about a staff member is refused');
select is(pg_temp.export(pg_temp.member((select owner_d from fx)), 'rejected_x'), 'error:22023', 'a rejected request is refused');
select is(
  (pg_temp.export(pg_temp.member((select owner_o from fx)), 'access_other')::jsonb -> 'counts' ->> 'memberships'),
  '1',
  'the owner of the other tenant exports only their own subject'
);
select ok(
  pg_temp.export(pg_temp.member((select owner_o from fx)), 'access_other') !~ (select string_agg(id::text, '|') from public.loyalty_ledger where tenant_id = (select tenant_d from fx)),
  'tenant isolation: the other tenant''s export holds no ledger id of the first tenant'
);

select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'access_x', 'name', 'New Name'), 'error:22023', 'dsr_correct refuses a request that is not a correction');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'phone', '0900016555'), 'error:22023', 'the phone is corrected in the POS first, not here');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'name; drop table x', 'New Name'), 'error:22023', 'input abuse: an unknown field name is refused');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'name', '   '), 'error:22023', 'boundary: a blank name is refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), format('select public.dsr_correct(%L::uuid, ''name'', null)::text', pg_temp.rid('correct_x'))), 'error:22023', 'a null name is refused');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'name', repeat('x', 121)), 'error:22023', 'boundary: 121 characters are refused');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'name', E'bad\nname'), 'error:22023', 'a control character is refused');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_done', 'name', 'New Name'), 'error:22023', 'a completed request is not changed');
select is(pg_temp.correct(pg_temp.member((select store_manager_d from fx)), 'correct_x', 'name', 'New Name'), 'error:42501', 'a store-limited manager cannot correct');
select is(pg_temp.correct(pg_temp.member((select staff_d from fx)), 'correct_x', 'name', 'New Name'), 'error:42501', 'staff cannot correct');
select is(pg_temp.correct(pg_temp.member((select viewer_d from fx)), 'correct_x', 'name', 'New Name'), 'error:42501', 'a viewer cannot correct');
select is(pg_temp.correct(pg_temp.member((select owner_o from fx)), 'correct_x', 'name', 'New Name'), 'error:42501', 'another tenant''s owner cannot correct');
select is(pg_temp.correct(pg_temp.customer((select login_x from fx), 'customer_x'), 'correct_x', 'name', 'New Name'), 'error:42501', 'the customer cannot correct through the tooling');
select is((select name from public.customers where id = (select id from ids where name = 'customer_x')), 'Synthetic X', 'the refusals changed nothing');
insert into answers select 'corrected', pg_temp.correct(pg_temp.member((select manager_d from fx)), 'correct_x', 'name', '  Corrected X  ');
select is(
  (select concat_ws(':', answer::jsonb ->> 'field', answer::jsonb ->> 'changed', answer::jsonb ->> 'status') from answers where name = 'corrected'),
  'name:true:in_progress',
  'a manager corrects the name on a correction request, which moves to in progress'
);
select is((select name from public.customers where id = (select id from ids where name = 'customer_x')), 'Corrected X', 'the name is trimmed and stored');
select is((select answer !~ 'Corrected' from answers where name = 'corrected'), true, 'the answer repeats no value');
select is(pg_temp.correct(pg_temp.member((select owner_d from fx)), 'correct_x', 'name', 'Corrected X')::jsonb ->> 'changed', 'false', 'the same name again changes nothing');
select is((select name from public.customers where id = (select id from ids where name = 'customer_y')), null, 'another customer''s name is untouched');

select is(pg_temp.due_names(pg_temp.member((select owner_d from fx)), '0'), 'overdue_d', 'dsr_due_soon boundary 0: only the request already overdue on both deadlines');
select ok(
  pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') like '%overdue_d%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') like '%soon_d%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%ontrack_d%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%closed_d%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%correct_done%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%rejected_x%'
    and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%overdue_o%' and pg_temp.due_names(pg_temp.member((select owner_d from fx)), '3') not like '%access_other%',
  'the default window lists the overdue and the soon-due open requests, not the on-track, completed, rejected or foreign ones'
);
select is(pg_temp.due_state(pg_temp.member((select owner_d from fx)), '3', 'overdue_d'), 'overdue:overdue', 'decision table: no response and past completion is overdue on both');
select is(pg_temp.due_state(pg_temp.member((select owner_d from fx)), '3', 'soon_d'), 'done:due_soon', 'decision table: responded and completion within the window is done and due soon');
select is(pg_temp.due_state(pg_temp.member((select owner_d from fx)), '30', 'ontrack_d'), 'done:due_soon', 'a 30-day window brings the on-track request in as due soon');
select is(pg_temp.due_names(pg_temp.member((select owner_d from fx)), '30') like '%closed_d%', false, 'a completed request is never listed, however wide the window');
select is(pg_temp.due_names(pg_temp.member((select manager_d from fx)), '30'), pg_temp.due_names(pg_temp.member((select owner_d from fx)), '30'), 'an unlimited manager sees the same queue as the owner');
select is(pg_temp.due_names(pg_temp.member((select owner_o from fx)), '30'), 'access_other,overdue_o', 'the other tenant''s owner sees only their requests');
select is(pg_temp.due(pg_temp.member((select owner_d from fx)), '-1'), 'error:22023', 'boundary: -1 days is refused');
select is(pg_temp.due(pg_temp.member((select owner_d from fx)), '31'), 'error:22023', 'boundary: 31 days is refused');
select is(pg_temp.due(pg_temp.member((select owner_d from fx)), 'null'), 'error:22023', 'a null window is refused');
select is(pg_temp.due(pg_temp.member((select store_manager_d from fx)), '3'), 'error:42501', 'a store-limited manager gets no queue');
select is(pg_temp.due(pg_temp.member((select staff_d from fx)), '3'), 'error:42501', 'staff get no queue');
select is(pg_temp.due(pg_temp.member((select viewer_d from fx)), '3'), 'error:42501', 'a viewer gets no queue');
select is(pg_temp.due(pg_temp.customer((select login_x from fx), 'customer_x'), '3'), 'error:42501', 'a customer session gets no queue');
select ok(
  pg_temp.due(pg_temp.member((select owner_d from fx)), '30') !~ 'synthetic-contact|Synthetic',
  'the queue rows carry no contact and no name'
);

select is(
  (select concat_ws(':', category, delivery, default_enabled, default_roles::text, store_scoped, app.alert_rule_params_valid(rule_key, default_params))
   from public.alert_rule_catalog where rule_key = 'dsr_due_soon'),
  'operations:immediate:t:{owner,manager}:f:t',
  'the dsr_due_soon rule is in the catalogue for owners and managers with valid default parameters'
);
select is(app.alert_rule_params_valid('dsr_due_soon', '{"days": 0}'), false, 'boundary: the rule''s days below 1 are invalid');
select is(app.alert_rule_params_valid('dsr_due_soon', '{"days": 11}'), false, 'boundary: the rule''s days above 10 are invalid');
select is(app.alert_rule_params_valid('dsr_due_soon', '{"days": 10}'), true, 'boundary: 10 days is valid');
select is(
  (app.evaluate_dsr_due_soon((select tenant_d from fx), now()) ->> 'dsr_alerts'),
  '1',
  'the evaluation opens one tenant episode while requests are overdue'
);
select is(
  (select concat_ws(':', count(*), min((facts ->> 'overdue')::int), bool_and(app.facts_are_count_only(facts))) from public.alert_events where tenant_id = (select tenant_d from fx) and rule_key = 'dsr_due_soon' and state = 'open'),
  '1:1:t',
  'one open episode with counts only'
);
select is((app.evaluate_dsr_due_soon((select tenant_d from fx), now()) ->> 'dsr_alerts'), '0', 'a second evaluation opens nothing more');
select is((select count(*)::int from public.alert_events where tenant_id = (select tenant_o from fx) and rule_key = 'dsr_due_soon'), 0, 'the other tenant has no episode from the first tenant''s requests');
update public.data_subject_requests set status = 'completed' where tenant_id = (select tenant_d from fx) and status in ('received', 'in_progress') and id <> pg_temp.rid('delete_x');
update public.data_subject_requests set status = 'completed' where id = pg_temp.rid('delete_x');
select is((app.evaluate_dsr_due_soon((select tenant_d from fx), now()) ->> 'dsr_alerts'), '0', 'nothing open: no new episode');
select is(
  (select count(*)::int from public.alert_events where tenant_id = (select tenant_d from fx) and rule_key = 'dsr_due_soon' and state = 'open'),
  0,
  'the episode is resolved when no request is open'
);

update public.data_subject_requests set status = 'received', completed_at = null where id = pg_temp.rid('delete_x');
insert into answers select 'deleted_x', pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), format('select public.dsr_delete(%L::uuid)::text', pg_temp.rid('delete_x')));
select is((select answer::jsonb ->> 'status' from answers where name = 'deleted_x'), 'completed', 'integration: the owner deletes the customer on the deletion request');
select is(pg_temp.lookup(pg_temp.member((select owner_d from fx)), '0900016101'), '[]', 'after the deletion the lookup finds nobody');
select is(pg_temp.export(pg_temp.member((select owner_d from fx)), 'access_x'), 'error:22023', 'after the deletion an export of that customer is refused');
select is(
  (select count(*)::int from public.customers where id = (select id from ids where name = 'customer_x_other')),
  1,
  'the same phone in the other tenant is untouched by the deletion'
);

select * from finish();
rollback;
