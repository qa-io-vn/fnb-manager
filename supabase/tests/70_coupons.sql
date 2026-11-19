begin;
select plan(43);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000007001'::uuid as tenant_c,
  'dddddddd-dddd-4ddd-8ddd-000000007002'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000007001'::uuid as account_c,
  'cccccccc-cccc-4ccc-8ccc-000000007002'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000007001'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000007002'::uuid as store_2,
  'ffffffff-ffff-4fff-8fff-000000007003'::uuid as store_3,
  'ffffffff-ffff-4fff-8fff-000000007011'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000007001'::uuid as owner_c,
  'eeeeeeee-eeee-4eee-8eee-000000007002'::uuid as manager_c,
  'eeeeeeee-eeee-4eee-8eee-000000007003'::uuid as manager_c1,
  'eeeeeeee-eeee-4eee-8eee-000000007004'::uuid as staff_c1,
  'eeeeeeee-eeee-4eee-8eee-000000007005'::uuid as publisher_c,
  'eeeeeeee-eeee-4eee-8eee-000000007006'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000007007'::uuid as customer_user,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007001'::uuid as customer_1,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000007001'::uuid as programme_c,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000007011'::uuid as programme_o;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coupons-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_c, fx.manager_c, fx.manager_c1, fx.staff_c1, fx.publisher_c, fx.owner_o, fx.customer_user]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_c, 'coupons-pgtap-c', 'Coupons pgTAP C', 'VN' from fx
union all
select tenant_o, 'coupons-pgtap-o', 'Coupons pgTAP O', 'VN' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_c, tenant_c, 'mock', 'coupons-c', 'Synthetic account C' from fx
union all
select account_o, tenant_o, 'mock', 'coupons-o', 'Synthetic account O' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_c, account_c, 'cp-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_c, account_c, 'cp-2', 'Synthetic store 2' from fx
union all
select store_3, tenant_c, account_c, 'cp-3', 'Synthetic store 3' from fx
union all
select store_o, tenant_o, account_o, 'cp-o', 'Synthetic store O' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_c, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_c, 'owner', null::uuid[]),
    (fx.manager_c, 'manager', null::uuid[]),
    (fx.manager_c1, 'manager', array[fx.store_1]),
    (fx.staff_c1, 'staff', array[fx.store_1]),
    (fx.publisher_c, 'publisher', array[fx.store_1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_o, fx.owner_o, 'owner', null from fx;

insert into public.customers (id, tenant_id, phone)
select customer_1, tenant_c, '+' || '849000' || '07001' from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_c, tenant_c, 'Synthetic programme C', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select programme_o, tenant_o, 'Synthetic programme O', date '2026-01-01', 'below_threshold', 'active' from fx;

insert into public.coupon_rails (tenant_id, store_id, rail)
select tenant_c, store_1, 'pos_payment_discount'::public.coupon_rail from fx
union all
select tenant_c, store_2, 'pos_payment_discount' from fx
union all
select tenant_o, store_o, 'pos_payment_discount' from fx;

insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
select fx.tenant_c, fx.store_1, k.key, 'Synthetic discount ' || k.key, 'discount'::public.einvoice_display
from fx, unnest(array['free-drink', 'ten-off', 'half-off', 'amount-off', 'legacy']) as k (key)
union all
select tenant_c, store_3, 'free-drink', 'Synthetic discount free-drink', 'discount' from fx
union all
select tenant_o, store_o, 'free-drink', 'Synthetic discount free-drink', 'discount' from fx;

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

create function pg_temp.value_as_customer(p_user uuid, p_tenant uuid, p_customer uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', p_tenant, 'customer_id', p_customer)
  )::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.coupon(p_key text, p_extra_columns text, p_extra_values text)
returns text
language sql
as $$
  select format(
    'insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps%s) values (%L, %L, %L, %L, 8%s)',
    p_extra_columns, (select tenant_c from fx), (select programme_c from fx), p_key, 'Reward ' || p_key, p_extra_values
  );
$$;

grant select on fx to authenticated, service_role;

select enum_has_labels('public', 'coupon_reward_kind', array['free_item', 'percent_off', 'amount_off', 'free_upgrade'], 'the reward kinds are items, percentages, amounts off and upgrades, with no cash-like kind');
select enum_has_labels('public', 'coupon_status', array['draft', 'approved', 'active', 'retired'], 'coupon_status labels');
select throws_ok(
  pg_temp.coupon('cash', ', reward_kind', ', ''stored_value'''),
  '22P02', null,
  'a stored-value reward cannot be stored by any writer'
);
select is(
  (select row(app.promotion_discount_cap('VN', date '2026-11-19', null), app.promotion_discount_cap('vn', date '2025-01-01', date '2025-12-31'))::text),
  '(0.5,0.5)',
  'the dated Vietnamese cap is 50 % before and after 1 July 2025'
);
select is(
  (select row(app.promotion_discount_cap('VN', date '2017-01-01', date '2018-05-21'), app.promotion_discount_cap('US', date '2026-01-01', null))::text),
  '(,)',
  'no cap before the first dated rule or for a country without rules'
);
select is(
  (select row(app.promotion_discount_days_limit('VN', date '2026-06-25'), app.promotion_discount_days_limit('VN', date '2026-06-26'))::text),
  '(120,)',
  'the 120 discount-days limit holds until 25 June 2026 and is reported repealed after'
);

set local role authenticated;
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('half-off', ', reward_kind, reward_percent, store_ids', ', ''percent_off'', 50, array[''ffffffff-ffff-4fff-8fff-000000007001'']::uuid[]')),
  'rows:1',
  'a 50 % reward is saved'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('over-half', ', reward_kind, reward_percent', ', ''percent_off'', 50.5')),
  '22023',
  'a reward of 50.5 % is refused for an owner'
);
reset role;
set local role service_role;
select throws_ok(
  pg_temp.coupon('over-half', ', reward_kind, reward_percent', ', ''percent_off'', 60'),
  '22023', null,
  'and for the service role'
);
reset role;
select throws_ok(
  $$ update public.coupons set reward_percent = 70 where reward_key = 'half-off' $$,
  '22023', null,
  'the database owner cannot raise a saved reward above the cap either'
);
set local role authenticated;
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('amount-off', ', reward_kind, reward_amount', ', ''amount_off'', 20000')),
  '22023',
  'an amount-off reward names the minimum bill it reduces'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('amount-off', ', reward_kind, reward_amount, min_bill_amount', ', ''amount_off'', 30000, 50000')),
  '22023',
  'an amount off above half the minimum bill is refused'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('amount-off', ', reward_kind, reward_amount, min_bill_amount', ', ''amount_off'', 25000, 50000')),
  'rows:1',
  'an amount off of half the minimum bill is saved'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('no-percent', ', reward_kind', ', ''percent_off''')),
  '23514',
  'a percent-off reward states its percentage'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('odd-gift', ', reward_kind, reward_percent', ', ''free_item'', 10')),
  '23514',
  'a free item carries no percentage'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('odd-items', ', reward_item_external_ids, excluded_item_external_ids', ', ''{syn-latte}'', ''{syn-latte}''')),
  '22023',
  'an item is a reward item or an excluded item, not both'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('no-limit', ', per_member_limit', ', 0')),
  '23514',
  'a per-member limit is 1 or more'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('bad-dates', ', valid_from, valid_until', ', ''2026-12-31'', ''2026-12-01''')),
  '23514',
  'fixed dates end on or after they start'
);

select is(
  pg_temp.outcome_as((select manager_c from fx), pg_temp.coupon('free-drink', ', store_ids', ', array[''ffffffff-ffff-4fff-8fff-000000007001'']::uuid[]')),
  'rows:1',
  'a manager with every store drafts a free item'
);
select is(
  pg_temp.value_as((select owner_c from fx), $$ select concat_ws(':', status, active, approved_at is null) from public.coupons where reward_key = 'free-drink' $$),
  'draft:f:t',
  'a new reward is a draft without approval'
);
select is(
  pg_temp.outcome_as((select manager_c from fx), $$ update public.coupons set status = 'approved' where reward_key = 'free-drink' $$),
  '42501',
  'a manager cannot approve a reward'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set status = 'approved' where reward_key = 'free-drink' $$),
  'rows:1',
  'an owner approves it'
);
select is(
  pg_temp.value_as((select owner_c from fx), format($$ select concat_ws(':', status, approved_by = %L, approved_at is not null) from public.coupons where reward_key = 'free-drink' $$, (select owner_c from fx))),
  'approved:t:t',
  'the approval records the owner and the time'
);
select is(
  pg_temp.outcome_as((select manager_c from fx), $$ update public.coupons set status = 'active' where reward_key = 'free-drink' $$),
  'rows:1',
  'a manager activates the approved reward at a store with a rail and a mapping'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set store_ids = array['ffffffff-ffff-4fff-8fff-000000007002']::uuid[] where reward_key = 'free-drink' $$),
  '22023',
  'an active reward cannot move to a store whose rail does not map it'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set store_ids = array['ffffffff-ffff-4fff-8fff-000000007003']::uuid[] where reward_key = 'free-drink' $$),
  '22023',
  'nor to a store that maps it without a coupon rail'
);
select is(
  pg_temp.outcome_as((select manager_c from fx), $$ update public.coupons set cost_stamps = 6 where reward_key = 'free-drink' $$),
  'rows:1',
  'a manager may change an active reward''s terms'
);
select is(
  pg_temp.value_as((select owner_c from fx), $$ select concat_ws(':', status, active, approved_at is null) from public.coupons where reward_key = 'free-drink' $$),
  'draft:f:t',
  'but the change sends it back to draft, out of the catalogue, until an owner approves it again'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set status = 'active' where reward_key = 'free-drink' $$),
  'rows:1',
  'an owner approves and activates in one step'
);
select is(
  pg_temp.value_as((select owner_c from fx), $$ select concat_ws(':', status, active) || ':' || (select count(*) from public.coupons where reward_key = 'free-drink' and approved_at is not null) from public.coupons where reward_key = 'free-drink' $$),
  'active:t:1',
  'and the reward is active with its approval'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set status = 'retired' where reward_key = 'free-drink' $$),
  'rows:1',
  'an owner retires the reward'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $$ update public.coupons set status = 'active' where reward_key = 'free-drink' $$),
  '22023',
  'a retired reward stays retired'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), pg_temp.coupon('legacy', ', store_ids, active', ', array[''ffffffff-ffff-4fff-8fff-000000007001'']::uuid[], true')),
  'rows:1',
  'a writer that only sets active still works for an owner'
);
select is(
  pg_temp.value_as((select owner_c from fx), $$ select concat_ws(':', status, active, approved_at is not null) from public.coupons where reward_key = 'legacy' $$),
  'active:t:t',
  'and the status follows it with the owner''s approval'
);
select is(
  pg_temp.outcome_as((select manager_c1 from fx), pg_temp.coupon('store-limited', '', '')),
  '42501',
  'a store-limited manager writes no reward'
);
select is(
  pg_temp.outcome_as((select staff_c1 from fx), pg_temp.coupon('staff-written', '', '')),
  '42501',
  'staff write no reward'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_c from fx), (select customer_1 from fx), 'select string_agg(reward_key, '','' order by reward_key) from public.coupons'),
  'legacy',
  'a customer session reads its tenant''s active rewards only'
);
select is(pg_temp.value_as((select staff_c1 from fx), 'select count(*) from public.coupons'), '4', 'staff read the tenant''s reward catalogue');
select is(pg_temp.value_as((select publisher_c from fx), 'select count(*) from public.coupons'), '0', 'the publisher reads no reward');
select is(pg_temp.value_as((select owner_o from fx), 'select count(*) from public.coupons'), '0', 'another tenant reads no reward');
reset role;

insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, item_discount_amount, net_amount, paid_amount)
select v.id::uuid, fx.tenant_c, fx.store_1, fx.account_c, 'cp-inv-' || v.n, v.sold_at::timestamptz, v.sold_at::date, 100000, 20000, 80000, 80000
from fx
cross join (
  values
    ('77777777-7777-4777-8777-000000007001', 1, '2025-03-01 10:00+07'),
    ('77777777-7777-4777-8777-000000007002', 2, '2025-03-02 10:00+07'),
    ('77777777-7777-4777-8777-000000007003', 3, '2025-03-03 10:00+07'),
    ('77777777-7777-4777-8777-000000007004', 4, '2026-07-01 10:00+07')
) as v (id, n, sold_at);
insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, discount_amount, net_amount)
select fx.tenant_c, fx.store_1, v.invoice::uuid, 'cp-line-' || v.n, 'item', v.item, v.item, 1, 100000, 100000, 20000, 80000
from fx
cross join (
  values
    ('77777777-7777-4777-8777-000000007001', 1, 'syn-latte'),
    ('77777777-7777-4777-8777-000000007002', 2, 'syn-latte'),
    ('77777777-7777-4777-8777-000000007003', 3, 'syn-cake'),
    ('77777777-7777-4777-8777-000000007004', 4, 'syn-latte')
) as v (invoice, n, item);
update public.coupons set excluded_item_external_ids = '{syn-cake}' where reward_key = 'half-off';

set local role authenticated;
select is(
  pg_temp.value_as((select owner_c from fx), $$ select string_agg(concat_ws(':', item_external_id, price_discount_days, limit_days, over_limit), ',') from public.coupon_discount_days((select id from public.coupons where reward_key = 'half-off'), 2025) $$),
  'syn-latte:2:120:f',
  'the discount days of a reward''s items, without its excluded items, against the 120-day limit in force in 2025'
);
select is(
  pg_temp.value_as((select owner_c from fx), $$ select string_agg(concat_ws(':', item_external_id, price_discount_days, coalesce(limit_days::text, '-'), over_limit), ',') from public.coupon_discount_days((select id from public.coupons where reward_key = 'half-off'), 2026) $$),
  'syn-latte:1:-:f',
  'with the limit reported repealed the 2026 count is information only and never over a limit'
);
select is(
  pg_temp.value_as((select owner_o from fx), $$ select count(*) from public.coupon_discount_days((select id from public.coupons where reward_key = 'half-off' and tenant_id = 'dddddddd-dddd-4ddd-8ddd-000000007001'), 2025) $$),
  'error:22023',
  'a caller who does not read the reward gets no count'
);
reset role;

select * from finish();
rollback;
