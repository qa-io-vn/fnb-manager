begin;
select plan(68);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000008001'::uuid as tenant_p,
  'dddddddd-dddd-4ddd-8ddd-000000008002'::uuid as tenant_q,
  'cccccccc-cccc-4ccc-8ccc-000000008001'::uuid as account_p,
  'cccccccc-cccc-4ccc-8ccc-000000008002'::uuid as account_q,
  'ffffffff-ffff-4fff-8fff-000000008001'::uuid as store_p1,
  'ffffffff-ffff-4fff-8fff-000000008002'::uuid as store_p2,
  'ffffffff-ffff-4fff-8fff-000000008003'::uuid as store_q1,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000008001'::uuid as programme_p,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000008002'::uuid as programme_q,
  'eeeeeeee-eeee-4eee-8eee-000000008001'::uuid as owner_p,
  'eeeeeeee-eeee-4eee-8eee-000000008002'::uuid as manager_p,
  'eeeeeeee-eeee-4eee-8eee-000000008003'::uuid as manager_p1,
  'eeeeeeee-eeee-4eee-8eee-000000008004'::uuid as staff_p,
  'eeeeeeee-eeee-4eee-8eee-000000008005'::uuid as viewer_p,
  'eeeeeeee-eeee-4eee-8eee-000000008006'::uuid as publisher_p,
  'eeeeeeee-eeee-4eee-8eee-000000008007'::uuid as outsider,
  'eeeeeeee-eeee-4eee-8eee-000000008008'::uuid as customer_user,
  date '2026-11-10' as day;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'phone-privacy-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_p, fx.manager_p, fx.manager_p1, fx.staff_p, fx.viewer_p, fx.publisher_p, fx.outsider, fx.customer_user]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_p, 'phone-privacy-pgtap-p', 'Phone privacy pgTAP P' from fx
union all
select tenant_q, 'phone-privacy-pgtap-q', 'Phone privacy pgTAP Q' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_p, tenant_p, 'mock', 'phone-privacy-p', 'Synthetic account P' from fx
union all
select account_q, tenant_q, 'mock', 'phone-privacy-q', 'Synthetic account Q' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, tran_no_reset_period)
select store_p1, tenant_p, account_p, 'pp-1', 'Synthetic store P1', 'daily'::public.tran_no_reset_period from fx
union all
select store_p2, tenant_p, account_p, 'pp-2', 'Synthetic store P2', 'daily' from fx
union all
select store_q1, tenant_q, account_q, 'pq-1', 'Synthetic store Q1', 'daily' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_p, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_p, 'owner', null::uuid[]), (fx.manager_p, 'manager', null::uuid[]), (fx.manager_p1, 'manager', array[fx.store_p1]),
         (fx.staff_p, 'staff', null::uuid[]), (fx.viewer_p, 'viewer', null::uuid[]), (fx.publisher_p, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select fx.tenant_q, fx.owner_p, 'viewer', null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_p, tenant_p, 'Synthetic programme P', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select programme_q, tenant_q, 'Synthetic programme Q', date '2026-11-01', 'below_threshold', 'active' from fx;

create temp table ids (name text primary key, id uuid);

insert into ids
select 'c' || n, app.loyalty_customer_for_phone((select tenant_p from fx), '090000800' || n, timestamptz '2026-11-01 08:00+07')
from generate_series(1, 5) n;
insert into public.customers (tenant_id, phone, name) select tenant_p, '0900008006', 'Khách từ quầy' from fx;
insert into ids select 'c6', id from public.customers where tenant_id = (select tenant_p from fx) and phone = '0900008006';
insert into ids select 'cq1', app.loyalty_customer_for_phone((select tenant_q from fx), '0900008001', timestamptz '2026-11-01 08:00+07');

insert into ids select 'm1', app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'c1'), 'mini_app', (select store_p1 from fx), null, null, timestamptz '2026-11-01 09:00+07');
insert into ids select 'm2', app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'c2'), 'mini_app', null, null, null, timestamptz '2026-11-02 09:00+07');
insert into ids select 'm3', app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'c3'), 'till', (select store_p2 from fx), null, null, timestamptz '2026-11-03 09:00+07');
insert into ids select 'm4', app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'c4'), 'mini_app', null, null, null, timestamptz '2026-11-04 09:00+07');
insert into ids select 'm5', app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'c5'), 'staff', (select store_p1 from fx), null, null, timestamptz '2026-11-10 06:30+07');
with made as (
  insert into public.memberships (tenant_id, programme_id, customer_id, joined_at, channel)
  select tenant_p, programme_p, (select id from ids where name = 'c6'), timestamptz '2026-11-04 09:00+07', 'till' from fx
  returning id
)
insert into ids select 'm6', id from made;
insert into ids select 'q1', app.loyalty_join((select tenant_q from fx), (select id from ids where name = 'cq1'), 'mini_app', null, null, null, timestamptz '2026-11-01 10:00+07');

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_p, p_store, fx.account_p, 'pp-' || p_name, p_name, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, 60000, 60000, 60000
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.earn(p_invoice text, p_member text, p_store uuid, p_points integer, p_pending boolean)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, pending, occurred_at)
    select fx.tenant_p, fx.programme_p, m.id, p_store, 'earn', 1, p_points, i.id, inv.business_date, 'A', p_pending, inv.sold_at + interval '1 hour'
    from fx
    join ids m on m.name = p_member
    join ids i on i.name = p_invoice
    join public.invoices inv on inv.id = i.id
    returning id
  )
  insert into ids (name, id) select 'earn_' || p_invoice, inserted.id from inserted
  returning id;
$$;

select pg_temp.invoice('i1', (select store_p1 from fx), timestamptz '2026-11-10 08:00+07');
select pg_temp.invoice('i2', (select store_p2 from fx), timestamptz '2026-11-11 10:00+07');
select pg_temp.invoice('i3', (select store_p1 from fx), timestamptz '2026-11-10 09:00+07');
select pg_temp.invoice('i4', (select store_p1 from fx), timestamptz '2026-11-10 10:00+07');
select pg_temp.earn('i1', 'm1', (select store_p1 from fx), 5, false);
select pg_temp.earn('i2', 'm1', (select store_p2 from fx), 3, true);
select pg_temp.earn('i3', 'm1', (select store_p1 from fx), 2, true);
select pg_temp.earn('i4', 'm2', (select store_p1 from fx), 4, false);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, invoice_id, source_entry_id, business_date, occurred_at)
select fx.tenant_p, fx.programme_p, (select id from ids where name = 'm1'), fx.store_p1, 'confirm', (select id from ids where name = 'i3'), (select id from ids where name = 'earn_i3'), fx.day, timestamptz '2026-11-10 12:00+07'
from fx;
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, reason, approved_by, business_date, occurred_at)
select fx.tenant_p, fx.programme_p, (select id from ids where name = 'm1'), fx.store_p2, 'adjust', 1, 'Bù dấu do máy in lỗi', fx.owner_p, fx.day, timestamptz '2026-11-10 13:00+07'
from fx;

create temp table expect as
select
  (select string_agg(i.name || ':' || b.stamps || '/' || b.points || '/' || b.pending_stamps || '/' || b.pending_points, ',' order by i.name)
   from ids i cross join lateral app.loyalty_balance(i.id) b
   where i.name ~ '^m[0-9]$') as full_balances,
  (select string_agg(i.name, ',' order by m.joined_at desc, m.id desc)
   from ids i join public.memberships m on m.id = i.id
   where i.name ~ '^m[0-9]$') as order_names,
  (select string_agg(pg.page, '|' order by pg.n)
   from (
     select (r.rn - 1) / 2 as n, string_agg(r.name, ',' order by r.rn) as page
     from (
       select i.name, row_number() over (order by m.joined_at desc, m.id desc) as rn
       from ids i join public.memberships m on m.id = i.id
       where i.name ~ '^m[0-9]$'
     ) r
     group by (r.rn - 1) / 2
   ) pg) as pages_of_two,
  app.loyalty_normalize_phone('0900008001') as phone_1,
  app.loyalty_normalize_phone('0900008006') as phone_6;

create function pg_temp.as_user(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.as_customer(p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select customer_user from fx), 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_p from fx), 'customer_id', (select id from ids where name = 'c1'))
  )::text, true);
  execute p_query into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.walk(p_stores uuid[], p_limit integer)
returns text
language plpgsql
as $$
declare
  v_after text;
  v_out text := '';
  v_page text;
  v_last text;
  v_count integer;
begin
  loop
    select string_agg(coalesce(i.name, '?'), ',' order by p.ordinality), count(*), (array_agg(p.page_key order by p.ordinality desc))[1]
    into v_page, v_count, v_last
    from public.loyalty_members_page(p_stores, v_after, p_limit, null) with ordinality as p
    left join ids i on i.id = p.membership_id;
    exit when v_count = 0;
    v_out := v_out || case when v_out = '' then '' else '|' end || v_page;
    exit when v_count < p_limit;
    v_after := v_last;
  end loop;
  return v_out;
end;
$$;

create function pg_temp.lookup_by(p_method text, p_phone text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  perform set_config('request.method', p_method, true);
  select count(*) into v_count from public.loyalty_member_lookup(p_phone);
  perform set_config('request.method', '', true);
  return v_count;
end;
$$;

grant select on fx, ids, expect to authenticated;

-- The column grant on customers.

select ok(not has_column_privilege('authenticated', 'public.customers', 'phone', 'select'), 'authenticated cannot select customers.phone');
select ok(
  has_column_privilege('authenticated', 'public.customers', 'id', 'select')
    and has_column_privilege('authenticated', 'public.customers', 'tenant_id', 'select')
    and has_column_privilege('authenticated', 'public.customers', 'external_id', 'select')
    and has_column_privilege('authenticated', 'public.customers', 'name', 'select')
    and has_column_privilege('authenticated', 'public.customers', 'first_seen_at', 'select')
    and has_column_privilege('authenticated', 'public.customers', 'last_seen_at', 'select'),
  'authenticated selects every other column of customers'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name = 'customers'),
  0,
  'authenticated holds no table-wide privilege on customers'
);
select is(
  (select count(*)::integer from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name = 'customers'),
  0,
  'anon holds no column privilege on customers'
);
select ok(has_column_privilege('service_role', 'public.customers', 'phone', 'select'), 'the service role still selects customers.phone');

set local role authenticated;

select is(pg_temp.as_user((select viewer_p from fx), 'select phone from public.customers limit 1'), 'error:42501', 'a viewer cannot read customers.phone through the API');
select is(pg_temp.as_user((select manager_p from fx), 'select phone from public.customers limit 1'), 'error:42501', 'a manager cannot read customers.phone');
select is(pg_temp.as_user((select manager_p1 from fx), 'select count(*) from public.customers where phone is not null'), 'error:42501', 'a store manager cannot filter on customers.phone either');
select is(pg_temp.as_user((select staff_p from fx), 'select phone from public.customers limit 1'), 'error:42501', 'staff cannot read customers.phone');
select is(pg_temp.as_user((select owner_p from fx), 'select phone from public.customers limit 1'), 'error:42501', 'an owner reads a full phone only through the lookup, not the table');
select is(pg_temp.as_user((select owner_p from fx), 'select c.phone from public.memberships m join public.customers c on c.id = m.customer_id limit 1'), 'error:42501', 'nor through a join, as a PostgREST embed customers(phone) would');
select is(
  pg_temp.as_user((select viewer_p from fx), 'select count(*) || '':'' || count(name) from public.customers where tenant_id = (select tenant_p from fx)'),
  '6:1',
  'a viewer still counts the tenant''s customers and reads the other columns'
);
select is(pg_temp.as_user((select staff_p from fx), 'select count(*) from public.customers where tenant_id = (select tenant_p from fx)'), '6', 'staff keep the rows the policy gives data members, without the phone');
select is(pg_temp.as_user((select publisher_p from fx), 'select count(*) from public.customers'), '0', 'the publisher reads no customer');
select is(pg_temp.as_customer('select count(*) from public.customers'), '1', 'a customer session reads its own customers row');
select is(pg_temp.as_customer('select phone from public.customers'), 'error:42501', 'but not its phone through the table');

-- memberships.phone_masked, the computed column the reconciliation queue embeds.

select is(
  pg_temp.as_user((select viewer_p from fx), 'select public.phone_masked(m) from public.memberships m where m.id = (select id from ids where name = ''m1'')'),
  '•••• ••• 001',
  'memberships.phone_masked gives a viewer the masked phone'
);
select is(
  pg_temp.as_user((select manager_p1 from fx), 'select string_agg(public.phone_masked(m), '','' order by public.phone_masked(m)) from public.memberships m where m.tenant_id = (select tenant_p from fx)'),
  '•••• ••• 001,•••• ••• 002,•••• ••• 003,•••• ••• 004,•••• ••• 005,•••• ••• 006',
  'a store manager gets every member of the tenant masked, the till''s local form included'
);
select is(
  pg_temp.as_user((select staff_p from fx), 'select public.phone_masked(jsonb_populate_record(null::public.memberships, jsonb_build_object(''id'', (select id from ids where name = ''m1''))))'),
  'null',
  'staff get nothing for a membership id passed through /rpc'
);
select is(
  pg_temp.as_user((select outsider from fx), 'select public.phone_masked(jsonb_populate_record(null::public.memberships, jsonb_build_object(''id'', (select id from ids where name = ''m1''), ''tenant_id'', (select tenant_p from fx))))'),
  'null',
  'nor does a stranger who fabricates the row'
);
select is(
  pg_temp.as_customer('select string_agg(public.phone_masked(m), '','') from public.memberships m'),
  '•••• ••• 001',
  'a customer session gets its own membership masked'
);
select is(
  pg_temp.as_customer('select public.phone_masked(jsonb_populate_record(null::public.memberships, jsonb_build_object(''id'', (select id from ids where name = ''m2''))))'),
  'null',
  'and nothing for another member'
);

-- loyalty_members_page: masking, order, paging and limits.

select is(
  pg_temp.as_user((select owner_p from fx), 'select string_agg(i.name, '','' order by p.ordinality) from public.loyalty_members_page((select array[store_p1, store_p2] from fx)) with ordinality as p join ids i on i.id = p.membership_id'),
  (select order_names from expect),
  'the owner lists the members newest first, ties broken by membership id'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select count(*) filter (where p.phone_masked ~ ''^•••• ••• [0-9]{3}$'') || ''/'' || count(*) from public.loyalty_members_page((select array[store_p1, store_p2] from fx)) p'),
  '6/6',
  'every phone in the list is masked, the owner''s included'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select p.phone_masked from public.loyalty_members_page((select array[store_p1, store_p2] from fx), null, 100, (select id::text from ids where name = ''m6'')) p'),
  '•••• ••• 006',
  'a member the till stored in local form is masked the same way'
);
select is(pg_temp.as_user((select owner_p from fx), 'select pg_temp.walk((select array[store_p1, store_p2] from fx), 2)'), (select pages_of_two from expect), 'pages of two follow each other by page_key without a gap or a repeat');
select is(pg_temp.as_user((select owner_p from fx), 'select pg_temp.walk((select array[store_p1, store_p2] from fx), 1000)'), (select order_names from expect), 'one page of 1,000 holds them all');
select is(
  pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page((select array[store_p1, store_p2] from fx), null, 100) p where p.page_key ~ (''^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\.[0-9]{6}Z~'' || p.membership_id::text || ''$'')'),
  '6',
  'page_key is the joining time in UTC and the membership id'
);
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null)'), '7', 'with no stores the owner gets every tenant where it reads loyalty, here also the one it views');
select is(pg_temp.as_user((select manager_p1 from fx), 'select count(*) from public.loyalty_members_page((select array[store_p1, store_p2] from fx))'), '6', 'a store manager lists every member of the tenant');
select is(pg_temp.as_user((select manager_p from fx), 'select count(*) from public.loyalty_members_page((select array[store_q1] from fx))'), '0', 'a store of another tenant gives nothing');
select is(
  pg_temp.as_user((select viewer_p from fx), 'select string_agg(i.name, '','') from public.loyalty_members_page((select array[store_p1] from fx), null, 100, ''003'') p join ids i on i.id = p.membership_id'),
  'm3',
  'p_search narrows to the members whose phone ends in the masked digits'
);
select is(
  pg_temp.as_user((select viewer_p from fx), 'select string_agg(i.name, '','') from public.loyalty_members_page(null, null, 100, (select id::text from ids where name = ''m4'')) p join ids i on i.id = p.membership_id'),
  'm4',
  'or to one membership id'
);
select is(pg_temp.as_user((select viewer_p from fx), 'select count(*) from public.loyalty_members_page((select array[store_p1] from fx), null, 100, ''  '')'), '6', 'a blank search lists everyone');
select is(pg_temp.as_user((select viewer_p from fx), 'select count(*) from public.loyalty_members_page(null, null, 100, ''8001'')'), 'error:22023', 'a search of four digits is refused, as it would reveal a hidden digit');
select is(pg_temp.as_user((select viewer_p from fx), 'select count(*) from public.loyalty_members_page(null, null, 100, ''+84'')'), 'error:22023', 'and so is any other search text');
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null, null, 0)'), 'error:22023', 'p_limit 0 is refused');
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null, null, 1001)'), 'error:22023', 'p_limit above 1,000 is refused');
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null, null, null)'), 'error:22023', 'a null p_limit is refused');
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null, ''2026-11-04'')'), 'error:22023', 'a p_after that is not a page_key is refused');
select is(
  pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_members_page(null, ''2026-13-40T00:00:00.000000Z~'' || (select id::text from ids where name = ''m1''))'),
  'error:22023',
  'and so is a page_key with an impossible date'
);

-- loyalty_members_page: refusals by role.

select is(pg_temp.as_user((select staff_p from fx), 'select count(*) from public.loyalty_members_page(null)'), 'error:42501', 'staff are refused the members list');
select is(pg_temp.as_user((select publisher_p from fx), 'select count(*) from public.loyalty_members_page(null)'), 'error:42501', 'the publisher is refused');
select is(pg_temp.as_user((select outsider from fx), 'select count(*) from public.loyalty_members_page(null)'), 'error:42501', 'a login of no tenant is refused');
select is(pg_temp.as_customer('select count(*) from public.loyalty_members_page(null)'), 'error:42501', 'a customer session is refused');

-- loyalty_members_page: balances.

select is(
  pg_temp.as_user((select owner_p from fx), 'select string_agg(i.name || '':'' || p.stamps || ''/'' || p.points || ''/'' || p.pending_stamps || ''/'' || p.pending_points, '','' order by i.name) from public.loyalty_members_page((select array[store_p1, store_p2] from fx)) p join ids i on i.id = p.membership_id'),
  (select full_balances from expect),
  'with every store the balances equal app.loyalty_balance'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select concat_ws(''/'', p.stamps, p.points, p.pending_stamps, p.pending_points, p.last_visit) from public.loyalty_members_page(null) p where p.membership_id = (select id from ids where name = ''m1'')'),
  '5/7/1/3/2026-11-11',
  'the owner''s balance: welcome stamps, a confirmed earn, a confirmed pending earn and an adjustment spend; an open pending earn waits; the last visit is the latest earn'
);
select is(
  pg_temp.as_user((select manager_p1 from fx), 'select concat_ws(''/'', p.stamps, p.points, p.pending_stamps, p.pending_points, p.last_visit) from public.loyalty_members_page(null) p where p.membership_id = (select id from ids where name = ''m1'')'),
  '4/7/0/0/2026-11-10',
  'a manager of store 1 sees the rows of store 1 only: no pending earn or adjustment of store 2'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select concat_ws(''/'', p.stamps, p.points, p.pending_stamps, p.pending_points, p.last_visit) from public.loyalty_members_page((select array[store_p2] from fx)) p where p.membership_id = (select id from ids where name = ''m1'')'),
  '1/0/1/3/2026-11-11',
  'an owner who names store 2 gets that store''s rows, without the welcome stamps given at store 1'
);
select is(
  pg_temp.as_user((select manager_p1 from fx), 'select concat_ws(''/'', p.stamps, p.points, p.last_visit) from public.loyalty_members_page(null) p where p.membership_id = (select id from ids where name = ''m2'')'),
  '3/4/2026-11-10',
  'welcome stamps without a store count for every scope'
);
select is(
  pg_temp.as_user((select manager_p1 from fx), 'select concat_ws(''/'', p.stamps, p.points, p.pending_stamps, coalesce(p.last_visit::text, ''-'')) from public.loyalty_members_page(null) p where p.membership_id = (select id from ids where name = ''m3'')'),
  '0/0/0/-',
  'welcome stamps given at another store are not in a store manager''s figure'
);

-- loyalty_member_lookup.

select is(
  pg_temp.as_user((select owner_p from fx), 'select string_agg(concat_ws(''|'', i.name, l.phone_full = (select phone_1 from expect), l.phone_masked), '','' order by i.name) from public.loyalty_member_lookup(''090 000 8001'') l join ids i on i.id = l.membership_id'),
  'm1|t|•••• ••• 001,q1|•••• ••• 001',
  'the owner''s lookup gives the full E.164 phone in its own tenant, and masked where it is a viewer'
);
select is(
  pg_temp.as_user((select manager_p from fx), 'select concat_ws(''|'', count(*), count(l.phone_full), min(l.phone_masked)) from public.loyalty_member_lookup(''0900008001'') l'),
  '1|0|•••• ••• 001',
  'a manager''s lookup is masked'
);
select is(
  pg_temp.as_user((select viewer_p from fx), 'select concat_ws(''|'', count(*), count(l.phone_full), min(l.phone_masked)) from public.loyalty_member_lookup(''0900008001'') l'),
  '1|0|•••• ••• 001',
  'a viewer''s lookup is masked'
);
select is(
  pg_temp.as_user((select manager_p1 from fx), 'select concat_ws(''/'', l.stamps, l.points, l.pending_stamps, l.pending_points, l.last_visit) from public.loyalty_member_lookup(''0900008001'') l'),
  '4/7/0/0/2026-11-10',
  'a store manager''s lookup carries the balance of its stores'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select string_agg(i.name || ''|'' || (l.phone_full = (select phone_6 from expect)), '','') from public.loyalty_member_lookup((select phone_6 from expect)) l join ids i on i.id = l.membership_id'),
  'm6|true',
  'an E.164 lookup finds the member the till stored in local form'
);
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_member_lookup(''0900008099'')'), '0', 'an unknown phone gives nothing');
select is(pg_temp.as_user((select owner_p from fx), 'select count(*) from public.loyalty_member_lookup(''không phải số'')'), '0', 'a text that is not a phone gives nothing');
select is(pg_temp.as_user((select staff_p from fx), 'select count(*) from public.loyalty_member_lookup(''0900008001'')'), 'error:42501', 'staff are refused the lookup');
select is(pg_temp.as_user((select publisher_p from fx), 'select count(*) from public.loyalty_member_lookup(''0900008001'')'), 'error:42501', 'the publisher is refused the lookup');
select is(pg_temp.as_customer('select count(*) from public.loyalty_member_lookup(''0900008001'')'), 'error:42501', 'a customer session is refused the lookup');
select is(
  pg_temp.as_user((select owner_p from fx), 'select pg_temp.lookup_by(''GET'', ''0900008001'')'),
  'error:PT405',
  'through PostgREST a GET, which would put the phone in the URL, is refused with 405'
);
select is(
  pg_temp.as_user((select owner_p from fx), 'select pg_temp.lookup_by(''POST'', ''0900008001'')'),
  '2',
  'a POST is answered'
);

reset role;

-- Properties.

select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || ('search_path=""' = any (p.proconfig)), ',' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('loyalty_members_page', 'loyalty_member_lookup', 'phone_masked')),
  'loyalty_member_lookup:true:true,loyalty_members_page:true:true,phone_masked:true:true',
  'the three readers of customers.phone are security definer and pin an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.loyalty_members_page(uuid[], text, integer, text)', 'execute')
    and not has_function_privilege('anon', 'public.loyalty_member_lookup(text)', 'execute')
    and not has_function_privilege('anon', 'public.phone_masked(public.memberships)', 'execute'),
  'anon executes none of them'
);
select ok(
  has_function_privilege('authenticated', 'public.loyalty_members_page(uuid[], text, integer, text)', 'execute')
    and has_function_privilege('authenticated', 'public.loyalty_member_lookup(text)', 'execute')
    and has_function_privilege('authenticated', 'public.phone_masked(public.memberships)', 'execute'),
  'authenticated executes all three'
);
select ok(
  not has_function_privilege('authenticated', 'app.loyalty_store_balance(uuid, uuid[])', 'execute')
    and not has_function_privilege('service_role', 'app.loyalty_store_balance(uuid, uuid[])', 'execute'),
  'no API role executes the scoped balance helper'
);
select is(
  (select regexp_replace(pg_get_function_result('public.loyalty_members_page(uuid[], text, integer, text)'::regprocedure), 'phone_masked', '', 'g') ~ 'phone'),
  false,
  'the members list has no column for a full phone'
);

select * from finish();
rollback;
