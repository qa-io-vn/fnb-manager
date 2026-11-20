begin;
select plan(57);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000016301'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000016302'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000016301'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000016302'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000016301'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000016302'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000016309'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000016301'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000016302'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016303'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000016304'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000016305'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000016306'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000016311'::uuid as login_c,
  '99999999-9999-4999-8999-000000016301'::uuid as programme_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-metrics-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_c]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'cust-metrics-pgtap', 'Customer metrics pgTAP', 'VN' from fx
union all
select tenant_o, 'cust-metrics-other-pgtap', 'Customer metrics other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'cust-metrics', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'cust-metrics-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'cm-1', 'cm-1', 'Synthetic store 1' from fx
union all
select store_d2, tenant_d, account_d, 'cm-2', 'cm-2', 'Synthetic store 2' from fx
union all
select store_o, tenant_o, account_o, 'cm-9', 'cm-9', 'Synthetic other store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_d, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_d, 'owner', null::uuid[]), (fx.manager_d, 'manager', null::uuid[]), (fx.store_manager_d, 'manager', array[fx.store_d]),
         (fx.staff_d, 'staff', array[fx.store_d]), (fx.viewer_d, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_o, owner_o, 'owner', null from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, point_value_amount, expected_breakage_rate)
select programme_d, tenant_d, 'Synthetic programme', date '2026-09-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 500, 0.200 from fx;

create temp table cust (name text primary key, id uuid, tenant uuid);
insert into cust
select v.name, gen_random_uuid(), fx.tenant_d
from fx cross join (
  select 'm' || g as name from generate_series(1, 10) g
  union all select 'n' || g from generate_series(1, 10) g
  union all select 'o' || g from generate_series(1, 3) g
) v;
insert into cust
select v.name, gen_random_uuid(), fx.tenant_o
from fx cross join (values ('A'), ('B'), ('C'), ('D'), ('E')) v (name);
insert into public.customers (id, tenant_id, phone, name, first_seen_at, last_seen_at)
select c.id, c.tenant,
  '+849000163' || lpad((row_number() over (order by c.tenant, c.name))::text, 2, '0'),
  'Synthetic ' || c.name,
  case
    when c.name in ('m1', 'm2', 'm3', 'm4', 'm5', 'm10') then timestamptz '2026-10-05 12:00+07'
    when c.name in ('m6', 'm7', 'm8', 'm9') then timestamptz '2026-11-02 12:00+07'
    when c.name = 'o1' then timestamptz '2026-08-01 12:00+07'
    when c.name = 'o2' then timestamptz '2026-09-02 12:00+07'
    when c.name = 'o3' then timestamptz '2026-09-01 12:00+07'
    else timestamptz '2026-09-10 12:00+07'
  end,
  now()
from cust c;

insert into public.memberships (tenant_id, programme_id, customer_id, joined_at, channel)
select fx.tenant_d, fx.programme_d, c.id, timestamptz '2026-10-01 12:00+07', 'import'
from fx join cust c on c.name like 'm%';

create temp table inv (key text primary key, id uuid, store uuid, day date, net numeric);
create sequence inv_seq;
create function pg_temp.visit(p_key text, p_customer text, p_store text, p_day date, p_net numeric default 50000, p_status text default 'completed', p_phone text default null)
returns void
language sql
as $$
  with made as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_id, customer_phone, status)
    select c.tenant, case p_store when 's1' then fx.store_d when 's2' then fx.store_d2 else fx.store_o end,
      case when c.tenant = fx.tenant_o or p_store = 'so' then fx.account_o else fx.account_d end,
      'cm-' || nextval('inv_seq'), (p_day::timestamp + time '12:00') at time zone 'Asia/Ho_Chi_Minh', p_day, p_net, p_net, p_net,
      c.id, p_phone, p_status::public.invoice_status
    from fx cross join cust c where c.name = p_customer
    returning id, store_id
  )
  insert into inv select p_key, made.id, made.store_id, p_day, p_net from made;
$$;

select pg_temp.visit('m1_1', 'm1', 's1', date '2026-11-01', 100000);
select pg_temp.visit('m1_2', 'm1', 's1', date '2026-11-10', 100000);
select pg_temp.visit('m1_3', 'm1', 's1', date '2026-11-20', 100000);
select pg_temp.visit('m2_1', 'm2', 's1', date '2026-11-05');
select pg_temp.visit('m2_2', 'm2', 's2', date '2026-11-05');
select pg_temp.visit('m2_3', 'm2', 's1', date '2026-11-25');
select pg_temp.visit('m3_1', 'm3', 's1', date '2026-11-15');
select pg_temp.visit('m3_2', 'm3', 's2', date '2026-11-15');
select pg_temp.visit('m' || g || '_1', 'm' || g, 's1', date '2026-11-15') from generate_series(4, 10) g;
select pg_temp.visit('m10_0', 'm10', 's1', date '2026-10-05');
select pg_temp.visit('n1_1', 'n1', 's1', date '2026-11-03');
select pg_temp.visit('n1_2', 'n1', 's1', date '2026-11-12');
select pg_temp.visit('n' || g || '_1', 'n' || g, 's1', date '2026-11-15') from generate_series(2, 10) g;
select pg_temp.visit('n5_void', 'n5', 's1', date '2026-11-16', 50000, 'voided');
select pg_temp.visit('o1_1', 'o1', 's1', date '2026-08-01');
select pg_temp.visit('o2_1', 'o2', 's1', date '2026-09-02');
select pg_temp.visit('o3_1', 'o3', 's1', date '2026-09-01');

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select tenant_d, store_d, account_d, 'cm-anon-' || g, timestamptz '2026-11-15 12:00+07', date '2026-11-15', 30000, 30000, 30000,
  case when g = 3 then '+84' || '900016399' end
from fx cross join generate_series(1, 3) g;

select pg_temp.visit('A_1', 'A', 'so', date '2026-11-29', 40000);
select pg_temp.visit('A_2', 'A', 'so', date '2026-11-28', 40000);
select pg_temp.visit('A_3', 'A', 'so', date '2026-11-27', 40000);
select pg_temp.visit('A_4', 'A', 'so', date '2026-11-26', 40000);
select pg_temp.visit('A_5', 'A', 'so', date '2026-11-25', 40000);
select pg_temp.visit('B_1', 'B', 'so', date '2026-11-20', 40000);
select pg_temp.visit('B_2', 'B', 'so', date '2026-11-19', 40000);
select pg_temp.visit('B_3', 'B', 'so', date '2026-11-18', 40000);
select pg_temp.visit('B_4', 'B', 'so', date '2026-11-17', 40000);
select pg_temp.visit('C_1', 'C', 'so', date '2026-10-11', 40000);
select pg_temp.visit('C_2', 'C', 'so', date '2026-10-10', 40000);
select pg_temp.visit('C_3', 'C', 'so', date '2026-10-09', 40000);
select pg_temp.visit('D_1', 'D', 'so', date '2026-08-22', 40000);
select pg_temp.visit('D_2', 'D', 'so', date '2026-08-21', 40000);
select pg_temp.visit('E_1', 'E', 'so', date '2026-05-14', 40000);

create temp table led (key text primary key, id uuid);
create function pg_temp.entry(p_key text, p_member text, p_kind text, p_points integer, p_value numeric, p_invoice text, p_pending boolean, p_expires timestamptz, p_at timestamptz, p_source text default null, p_store boolean default true)
returns void
language sql
as $$
  with made as (
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, point_delta, value_amount, invoice_id, business_date, matched_path, pending, source_entry_id, expires_at, occurred_at)
    select fx.tenant_d, fx.programme_d, m.id,
      case when p_store and p_invoice is not null then i.store end,
      p_kind::public.loyalty_entry_kind, p_points, p_value, i.id, i.day,
      case when p_kind = 'earn' then 'A' end, p_pending, (select l.id from led l where l.key = p_source), p_expires, p_at
    from fx
    join cust c on c.name = p_member
    join public.memberships m on m.customer_id = c.id
    left join inv i on i.key = p_invoice
    returning id
  )
  insert into led select p_key, made.id from made;
$$;

select pg_temp.entry('e_m1_1', 'm1', 'earn', 100, 50000, 'm1_1', false, timestamptz '2026-11-20 12:00+07', timestamptz '2026-11-01 13:00+07');
select pg_temp.entry('e_m1_2', 'm1', 'earn', 100, 50000, 'm1_2', false, timestamptz '2026-11-20 12:00+07', timestamptz '2026-11-10 13:00+07');
select pg_temp.entry('e_m1_3', 'm1', 'earn', 100, 50000, 'm1_3', false, timestamptz '2027-05-01 12:00+07', timestamptz '2026-11-20 13:00+07');
select pg_temp.entry('x_m1', 'm1', 'expire', -200, -100000, null, false, null, timestamptz '2026-11-21 02:00+07');
select pg_temp.entry('e_m2_1', 'm2', 'earn', 50, 25000, 'm2_1', false, timestamptz '2027-01-01 12:00+07', timestamptz '2026-11-05 13:00+07');
select pg_temp.entry('e_m2_3', 'm2', 'earn', 50, 25000, 'm2_3', false, timestamptz '2027-01-01 12:00+07', timestamptz '2026-11-25 13:00+07');
select pg_temp.entry('r_m2_a', 'm2', 'redeem', -60, -30000, null, false, null, timestamptz '2026-11-18 10:00+07');
select pg_temp.entry('r_m2_b', 'm2', 'redeem', -40, -20000, null, true, null, timestamptz '2026-11-26 10:00+07');
select pg_temp.entry('e_m3_1', 'm3', 'earn', 30, 15000, 'm3_1', true, timestamptz '2027-01-01 12:00+07', timestamptz '2026-11-15 13:00+07');
select pg_temp.entry('e_m4_1', 'm4', 'earn', 20, 10000, 'm4_1', true, timestamptz '2027-01-01 12:00+07', timestamptz '2026-11-15 13:00+07');
select pg_temp.entry('c_m4_1', 'm4', 'confirm', 0, 0, 'm4_1', false, null, timestamptz '2026-11-16 09:00+07', 'e_m4_1');
select pg_temp.entry('e_m5_1', 'm5', 'earn', 100, 50000, 'm5_1', false, timestamptz '2026-11-25 12:00+07', timestamptz '2026-11-15 13:00+07');
select pg_temp.entry('e_m6_1', 'm6', 'earn', 50, 25000, 'm6_1', false, timestamptz '2027-01-01 12:00+07', timestamptz '2026-11-15 13:00+07');
select pg_temp.entry('r_m6', 'm6', 'redeem', -20, -10000, null, true, null, timestamptz '2026-11-20 10:00+07');
select pg_temp.entry('c_m6', 'm6', 'confirm', 0, 0, 'm6_1', false, null, timestamptz '2026-11-21 09:00+07', 'r_m6');

create function pg_temp.outcome_as(p_claims jsonb, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_statement into v_value;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    return 'error:' || sqlstate;
  end;
end;
$$;

create function pg_temp.member(p_user uuid)
returns jsonb
language sql
as $$ select jsonb_build_object('sub', p_user, 'role', 'authenticated'); $$;

create function pg_temp.customer_session(p_user uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', (select tenant_d from fx), 'customer_id', (select id from cust where name = 'm1')));
$$;

create function pg_temp.stores(p_names text)
returns text
language sql
as $$
  select '{' || string_agg(case s when 's1' then fx.store_d::text when 's2' then fx.store_d2::text else fx.store_o::text end, ',') || '}'
  from fx cross join unnest(string_to_array(p_names, ',')) s;
$$;

create function pg_temp.metric(p_claims jsonb, p_field text, p_from date, p_to date, p_stores text default 's1,s2')
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims,
    format('select (row_to_json(m) ->> %L) from public.customer_metrics(%L::uuid[], %L, %L) m', p_field, pg_temp.stores(p_stores), p_from, p_to));
$$;

create function pg_temp.metric_row(p_claims jsonb, p_from date, p_to date, p_stores text default 's1,s2')
returns text
language sql
as $$
  select pg_temp.outcome_as(p_claims,
    format('select row_to_json(m)::text from public.customer_metrics(%L::uuid[], %L, %L) m', pg_temp.stores(p_stores), p_from, p_to));
$$;

create function pg_temp.sql_as(p_claims jsonb, p_sql text)
returns text
language sql
as $$ select pg_temp.outcome_as(p_claims, p_sql); $$;

grant select on fx, cust, inv, led to authenticated;

select ok(
  has_function_privilege('authenticated', 'public.customer_metrics(uuid[], date, date)', 'execute')
    and has_function_privilege('authenticated', 'public.cohort_retention(uuid[], date, integer, date)', 'execute')
    and has_function_privilege('authenticated', 'public.rfm_quintiles(uuid[], date)', 'execute')
    and not has_function_privilege('anon', 'public.customer_metrics(uuid[], date, date)', 'execute')
    and not has_function_privilege('anon', 'public.cohort_retention(uuid[], date, integer, date)', 'execute')
    and not has_function_privilege('anon', 'public.rfm_quintiles(uuid[], date)', 'execute')
    and not has_function_privilege('service_role', 'public.customer_metrics(uuid[], date, date)', 'execute'),
  'the three metric functions are for signed-in callers only'
);

select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'invoices', date '2026-11-01', date '2026-11-30')::int, 29, 'hand calculation: 26 identified customer invoices, 1 phone-only and 2 anonymous invoices make 29, the voided one not counted');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'identified_invoices', date '2026-11-01', date '2026-11-30')::int, 27, 'identified invoices: the 26 with a customer and the phone-only one');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'customer_capture_rate', date '2026-11-01', date '2026-11-30')::numeric, 0.9310::numeric, 'capture rate 27 / 29, always beside the customer figures');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'customers', date '2026-11-01', date '2026-11-30')::int, 20, 'twenty customers visited in November');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'repeat_customers', date '2026-11-01', date '2026-11-30')::int, 3, 'three customers came on at least two days: two invoices on one day are one visit');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'repeat_rate', date '2026-11-01', date '2026-11-30')::numeric, 0.15::numeric, 'repeat rate 3 / 20');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'visit_frequency_30d', date '2026-11-01', date '2026-11-30')::numeric, 1.2::numeric, 'visit frequency over the 30 days ending on the last day: 24 customer-days / 20 customers');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'visit_frequency_90d', date '2026-11-01', date '2026-11-30')::numeric, 1.2381::numeric, 'over 90 days: 26 customer-days / 21 customers, the visit on the first day of the window counted and the day before not');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'active_customers_90d', date '2026-11-01', date '2026-11-30')::int, 21, '90 days: 21 active customers');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'outstanding_points', date '2026-11-01', date '2026-11-30')::int, 250, 'outstanding points: 100 + 0 + 0 (pending earn without confirm) + 20 + 100 + 30');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'loyalty_liability', date '2026-11-01', date '2026-11-30')::numeric, 100000::numeric, 'liability 250 x 500 x (1 - 0.2)');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'breakage_rate', date '2026-11-01', date '2026-11-30')::numeric, 0.6667::numeric, 'breakage: 200 expired of 300 points of cohorts past their expiry');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_revenue', date '2026-11-01', date '2026-11-30')::numeric, 900000::numeric, 'net revenue of member invoices');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'rewards_redeemed_value', date '2026-11-01', date '2026-11-30')::numeric, 40000::numeric, 'redeemed value: the plain redemption and the confirmed hold, not the unconfirmed hold');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'reward_cost_rate', date '2026-11-01', date '2026-11-30')::numeric, 0.0444::numeric, 'reward cost rate 40,000 / 900,000');
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_customers', date '2026-11-01', date '2026-11-30'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'comparison_customers', date '2026-11-01', date '2026-11-30'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_visit_frequency', date '2026-11-01', date '2026-11-30')::numeric,
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'comparison_visit_frequency', date '2026-11-01', date '2026-11-30')::numeric),
  '10:10:1.3000:1.1000',
  'both groups of the uplift are reported with their sizes and frequencies'
);
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_frequency_uplift', date '2026-11-01', date '2026-11-30')::numeric, 0.1818::numeric, 'uplift 1.3 / 1.1 - 1');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'uplift_comparison', date '2026-11-01', date '2026-11-30'), 'identified_non_members', 'the uplift names its comparison group');

select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_customers', date '2026-11-15', date '2026-11-15'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'comparison_customers', date '2026-11-15', date '2026-11-15'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_frequency_uplift', date '2026-11-15', date '2026-11-15')),
  '8:9:null',
  'boundary: below ten customers in a group the uplift is null, not zero'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_d from fx)), 'invoices', date '2026-11-15', date '2026-11-15'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'identified_invoices', date '2026-11-15', date '2026-11-15'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'repeat_rate', date '2026-11-15', date '2026-11-15')::numeric),
  '21:19:0.0000',
  'a one-day range works; nobody repeats within a day'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_d from fx)), 'invoices', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'customer_capture_rate', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'repeat_rate', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'visit_frequency_30d', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'member_frequency_uplift', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'breakage_rate', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'reward_cost_rate', date '2026-01-01', date '2026-01-01')),
  '0:null:null:null:null:null:null',
  'an empty range: unmeasured figures are null, never 0'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_d from fx)), 'outstanding_points', date '2026-01-01', date '2026-01-01'),
    pg_temp.metric(pg_temp.member((select owner_d from fx)), 'loyalty_liability', date '2026-01-01', date '2026-01-01')::numeric),
  '0:0.00',
  'before any ledger row the programme owes nothing: a measured zero'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_o from fx)), 'loyalty_liability', date '2026-11-01', date '2026-11-30', 'so'),
    pg_temp.metric(pg_temp.member((select owner_o from fx)), 'breakage_rate', date '2026-11-01', date '2026-11-30', 'so'),
    pg_temp.metric(pg_temp.member((select owner_o from fx)), 'reward_cost_rate', date '2026-11-01', date '2026-11-30', 'so')),
  'null:null:null',
  'a tenant without a loyalty programme has null liability, breakage and reward cost'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_o from fx)), 'customers', date '2026-11-01', date '2026-11-30', 'so'),
    pg_temp.metric(pg_temp.member((select owner_o from fx)), 'repeat_rate', date '2026-11-01', date '2026-11-30', 'so')::numeric),
  '2:1.0000',
  'the other tenant sees only its own two November customers, both repeaters'
);
select is(
  concat_ws(':', pg_temp.metric(pg_temp.member((select owner_o from fx)), 'invoices', date '2026-11-01', date '2026-11-30', 's1,s2'),
    pg_temp.metric(pg_temp.member((select owner_o from fx)), 'customers', date '2026-11-01', date '2026-11-30', 's1,s2'),
    pg_temp.metric(pg_temp.member((select owner_o from fx)), 'outstanding_points', date '2026-11-01', date '2026-11-30', 's1,s2')),
  '0:0:null',
  'tenant isolation: another tenant''s stores give nothing'
);
select is(
  pg_temp.metric(pg_temp.member((select manager_d from fx)), 'customer_capture_rate', date '2026-11-01', date '2026-11-30'),
  pg_temp.metric(pg_temp.member((select owner_d from fx)), 'customer_capture_rate', date '2026-11-01', date '2026-11-30'),
  'an unlimited manager reads the same figures as the owner'
);
select is(
  pg_temp.metric_row(pg_temp.member((select viewer_d from fx)), date '2026-11-01', date '2026-11-30'),
  pg_temp.metric_row(pg_temp.member((select owner_d from fx)), date '2026-11-01', date '2026-11-30'),
  'a viewer reads the same aggregates'
);
select is(
  pg_temp.metric(pg_temp.member((select store_manager_d from fx)), 'invoices', date '2026-11-01', date '2026-11-30')::int,
  (select count(*)::int from public.invoices where store_id = (select store_d from fx) and business_date between date '2026-11-01' and date '2026-11-30' and status <> 'voided'),
  'a store manager''s figures cover the one store they may read'
);
select isnt(
  pg_temp.metric(pg_temp.member((select store_manager_d from fx)), 'invoices', date '2026-11-01', date '2026-11-30')::int,
  29,
  'and fewer than the owner''s'
);
select is(pg_temp.metric(pg_temp.member((select staff_d from fx)), 'invoices', date '2026-11-01', date '2026-11-30'), 'error:42501', 'staff cannot read the customer metrics');
select is(pg_temp.metric(pg_temp.customer_session((select login_c from fx)), 'invoices', date '2026-11-01', date '2026-11-30'), 'error:42501', 'a customer session cannot');
select is(pg_temp.metric('{}'::jsonb, 'invoices', date '2026-11-01', date '2026-11-30'), 'error:42501', 'a call without a user cannot');

select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'invoices', date '2026-11-30', date '2026-11-01'), 'error:22023', 'boundary: a range that ends before it starts is refused');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'customers', date '2025-11-30', date '2026-11-30')::int, 23, 'boundary: 366 days are accepted: 23 customers over the year');
select is(pg_temp.metric(pg_temp.member((select owner_d from fx)), 'invoices', date '2025-11-29', date '2026-11-30'), 'error:22023', 'boundary: 367 days are refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), 'select count(*) from public.customer_metrics(''{}''::uuid[], date ''2026-11-01'', date ''2026-11-30'')'), 'error:22023', 'an empty store list is refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), 'select count(*) from public.customer_metrics(null, date ''2026-11-01'', date ''2026-11-30'')'), 'error:22023', 'a null store list is refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), 'select count(*) from public.customer_metrics((select array_agg(gen_random_uuid()) from generate_series(1, 51)), date ''2026-11-01'', date ''2026-11-30'')'), 'error:22023', 'boundary: 51 stores are refused');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), 'select count(*) from public.customer_metrics((select array_agg(gen_random_uuid()) from generate_series(1, 50)), date ''2026-11-01'', date ''2026-11-30'')'), '1', 'boundary: 50 stores are accepted');
select is(pg_temp.outcome_as(pg_temp.member((select owner_d from fx)), 'select count(*) from public.customer_metrics(''{}''::uuid[], null, date ''2026-11-30'')'), 'error:22023', 'a null date is refused');

select ok(
  pg_temp.metric_row(pg_temp.member((select owner_d from fx)), date '2026-11-01', date '2026-11-30') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}'
    and pg_temp.metric_row(pg_temp.member((select owner_d from fx)), date '2026-11-01', date '2026-11-30') !~ '9000163|Synthetic',
  'no customer id, phone or name leaves the function'
);

select is(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$
    select string_agg(concat_ws(':', c.cohort_month, c.month_offset, c.cohort_size, c.retained, c.retention), ',' order by c.cohort_month, c.month_offset)
    from public.cohort_retention(%L::uuid[], date '2026-09-01', 3, date '2026-11-30') c
  $q$, pg_temp.stores('s1,s2'))),
  '2026-09-01:0:12:2:0.1667,2026-09-01:1:12:0:0.0000,2026-09-01:2:12:10:0.8333,2026-10-01:0:6:1:0.1667,2026-10-01:1:6:6:1.0000,2026-11-01:0:4:4:1.0000',
  'cohort retention equals the hand calculation: September 12 customers, October 6, November 4'
);
select is(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$
    select count(*)::text from public.cohort_retention(%L::uuid[], date '2026-09-01', 3, date '2026-10-31')
  $q$, pg_temp.stores('s1,s2'))),
  '3',
  'cohorts and offsets stop at the as-of month'
);
select is(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$
    select concat_ws(':', count(*), max(c.cohort_size), count(c.retention)) from public.cohort_retention(%L::uuid[], date '2026-07-01', 1, date '2026-11-30') c
  $q$, pg_temp.stores('s1,s2'))),
  '5:0:0',
  'an empty cohort has size 0 and a null retention, never 0 %'
);
select is(pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$ select count(*)::text from public.cohort_retention(%L::uuid[], date '2026-09-01', 0, date '2026-11-30') $q$, pg_temp.stores('s1'))), 'error:22023', 'boundary: 0 cohorts are refused');
select is(pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$ select count(*)::text from public.cohort_retention(%L::uuid[], date '2026-09-01', 13, date '2026-11-30') $q$, pg_temp.stores('s1'))), 'error:22023', 'boundary: 13 cohorts are refused');
select is(pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$ select count(*)::text from public.cohort_retention(%L::uuid[], null, 3, date '2026-11-30') $q$, pg_temp.stores('s1'))), 'error:22023', 'a null first month is refused');
select is(pg_temp.sql_as(pg_temp.member((select staff_d from fx)), format($q$ select count(*)::text from public.cohort_retention(%L::uuid[], date '2026-09-01', 3, date '2026-11-30') $q$, pg_temp.stores('s1'))), 'error:42501', 'staff cannot read cohort retention');
select is(pg_temp.sql_as(pg_temp.member((select owner_o from fx)), format($q$ select coalesce(sum(cohort_size), 0)::text from public.cohort_retention(%L::uuid[], date '2026-09-01', 3, date '2026-11-30') $q$, pg_temp.stores('s1,s2'))), '0', 'another tenant''s owner sees no cohort of this tenant');

select is(
  pg_temp.sql_as(pg_temp.member((select owner_o from fx)), format($q$
    select string_agg(concat_ws(':', r.segment, r.customers, r.share), ',' order by r.customers desc, r.segment) from public.rfm_quintiles(%L::uuid[], date '2026-11-30') r
  $q$, pg_temp.stores('so'))),
  'champions:2:0.4000,hibernating:1:0.2000,lost:1:0.2000,loyal:1:0.2000',
  'RFM on five customers with distinct recency and frequency: one per quintile, grouped into segments'
);
select is(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$
    select sum(r.customers)::text from public.rfm_quintiles(%L::uuid[], date '2026-11-30') r
  $q$, pg_temp.stores('s1,s2'))),
  '23',
  'every identified customer of the year lands in one segment'
);
select ok(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$
    select bool_and(r.segment in ('champions', 'loyal', 'new', 'promising', 'at_risk', 'hibernating', 'lost') and r.share between 0 and 1)::text
    from public.rfm_quintiles(%L::uuid[], date '2026-11-30') r
  $q$, pg_temp.stores('s1,s2'))) = 'true',
  'segments are the seven named ones'
);
select is(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$ select count(*)::text from public.rfm_quintiles(%L::uuid[], date '2024-01-01') $q$, pg_temp.stores('s1,s2'))),
  '0',
  'no customer in the year before the as-of date: no segment rows'
);
select is(pg_temp.sql_as(pg_temp.member((select staff_d from fx)), format($q$ select count(*)::text from public.rfm_quintiles(%L::uuid[], date '2026-11-30') $q$, pg_temp.stores('s1'))), 'error:42501', 'staff cannot read the RFM segments');
select ok(
  pg_temp.sql_as(pg_temp.member((select owner_d from fx)), format($q$ select (json_agg(r))::text from public.rfm_quintiles(%L::uuid[], date '2026-11-30') r $q$, pg_temp.stores('s1,s2'))) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|9000163|Synthetic',
  'the RFM rows carry no customer id, phone or name'
);

select is(
  (select count(*)::int from public.invoices where tenant_id = (select tenant_d from fx)),
  (select count(*)::int from inv where key not like 'A\_%' escape '\' and key not like 'B\_%' escape '\' and key not like 'C\_%' escape '\' and key not like 'D\_%' escape '\' and key not like 'E\_%' escape '\') + 3,
  'regression: the metric functions changed no invoice'
);

select * from finish();
rollback;
