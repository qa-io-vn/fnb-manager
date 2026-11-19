begin;
select plan(59);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006001'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000006002'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000006001'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000006002'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000006001'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000006002'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000006011'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000006001'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000006002'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000006003'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006004'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000006005'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000006006'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000006007'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000006008'::uuid as customer_user,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006001'::uuid as customer_x,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006002'::uuid as customer_y,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006001'::uuid as programme_x,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006002'::uuid as programme_x_draft,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006003'::uuid as programme_y;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'loyalty-programmes-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.viewer_x, fx.publisher_x, fx.owner_y, fx.customer_user]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'loyalty-programmes-pgtap-x', 'Loyalty programmes pgTAP X' from fx
union all
select tenant_y, 'loyalty-programmes-pgtap-y', 'Loyalty programmes pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'loyalty-programmes-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'loyalty-programmes-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_x1, tenant_x, account_x, 'lp-x1', 'Synthetic store X1' from fx
union all
select store_x2, tenant_x, account_x, 'lp-x2', 'Synthetic store X2' from fx
union all
select store_y1, tenant_y, account_y, 'lp-y1', 'Synthetic store Y1' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, fx.owner_y, 'owner', null from fx;

insert into public.customers (id, tenant_id, phone)
select customer_x, tenant_x, '+' || '84900006001' from fx
union all
select customer_y, tenant_y, '+' || '84900006002' from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, notification_basis, status)
select programme_x, tenant_x, 'Synthetic programme X', date '2026-12-01', 'below_threshold'::public.loyalty_notification_decision, null, 'draft'::public.loyalty_programme_status from fx
union all
select programme_x_draft, tenant_x, 'Synthetic draft X', date '2027-01-01', 'pending', null, 'draft' from fx
union all
select programme_y, tenant_y, 'Synthetic programme Y', date '2026-12-01', 'pending', null, 'draft' from fx;

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

grant execute on function pg_temp.outcome_as(uuid, text) to authenticated, service_role;
grant execute on function pg_temp.value_as(uuid, text) to authenticated, service_role;
grant execute on function pg_temp.value_as_customer(uuid, uuid, uuid, text) to authenticated;
grant select on fx to authenticated, service_role;

select has_table('public', 'loyalty_programmes', 'loyalty_programmes exists');
select has_table('public', 'loyalty_staff_phones', 'loyalty_staff_phones exists');
select enum_has_labels('public', 'loyalty_programme_status', array['draft', 'active', 'paused', 'ended'], 'loyalty_programme_status labels');
select enum_has_labels('public', 'loyalty_notification_decision', array['pending', 'notified', 'below_threshold', 'not_required'], 'loyalty_notification_decision labels');

select is(
  (
    select row(p.stamps_per_card, p.stamp_min_bill_amount, p.welcome_stamps, p.point_unit_amount, p.points_per_unit, p.stamp_validity_months,
      p.points_expiry_months, p.earning_invoices_per_phone_per_day, p.checkin_window_before_minutes, p.checkin_window_after_minutes,
      p.checkin_code_ttl_seconds, p.checkin_pending_hours, p.receipt_claim_window_hours, p.receipt_claims_per_phone_per_day,
      p.excluded_order_sources, p.point_value_amount, p.expected_breakage_rate, p.reward_budget_amount, p.ends_on)::text
    from public.loyalty_programmes p where p.id = (select programme_y from fx)
  ),
  row(8, 50000.00, 2, 10000.00, 1, 6, 12, 3, 2, 15, 120, 24, 72, 3, '{}'::text[], 500.00, 0.200, 0.00, null::date)::text,
  'a programme starts with the recommended mechanic: 8 stamps per card, 50,000 minimum bill, 2 welcome stamps, 1 point per 10,000, 6 and 12 months, 3 earning invoices a day, -2/+15 minutes, 72 hours'
);
select is((select status::text || '/' || notification_decision::text from public.loyalty_programmes where id = (select programme_y from fx)), 'draft/pending', 'a programme starts as a draft with its notification decision pending');
select is((select notification_decided_at from public.loyalty_programmes where id = (select programme_y from fx)), null, 'a pending decision has no decision time');
select isnt((select notification_decided_at from public.loyalty_programmes where id = (select programme_x from fx)), null, 'a recorded decision is stamped with its time');

select throws_ok(
  $$ update public.loyalty_programmes set status = 'active' where id = (select programme_y from fx) $$,
  '22023', 'a loyalty programme cannot become active while its notification decision is pending',
  'the database owner cannot activate a programme whose decision is pending'
);
select throws_ok(
  $$ insert into public.loyalty_programmes (tenant_id, name, starts_on, status) select tenant_y, 'Active at once', current_date, 'active' from fx $$,
  '22023', null,
  'a programme cannot be inserted active with a pending decision'
);
set local role service_role;
select throws_ok(
  $$ update public.loyalty_programmes set status = 'active' where id = (select programme_y from fx) $$,
  '22023', null,
  'the service role cannot activate a programme whose decision is pending'
);
reset role;
set local role authenticated;
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set status = %L where id = %L', 'active', (select programme_x_draft from fx))),
  '22023',
  'an owner with every store cannot activate a programme whose decision is pending'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set notification_decision = %L where id = %L', 'not_required', (select programme_x_draft from fx))),
  '22023',
  'not_required without a legal basis is refused'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set status = %L where id = %L', 'active', (select programme_x from fx))),
  'rows:1',
  'an owner activates a programme once its decision is recorded'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set notification_decision = %L, notification_basis = %L, status = %L where id = %L', 'not_required', 'Purchase-based programme; basis to be confirmed by the legal read', 'paused', (select programme_x_draft from fx))),
  'rows:1',
  'not_required with a basis is accepted'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set status = %L where id = %L', 'active', (select programme_x_draft from fx))),
  '23505',
  'a tenant has at most one active programme'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set notification_decision = %L where id = %L', 'pending', (select programme_x from fx))),
  '22023',
  'an active programme cannot fall back to a pending decision'
);
reset role;

select is(
  (
    select array_agg(r.problem order by r.n)
    from (
      select n, pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set %s where id = %L', setting, (select programme_x_draft from fx))) as problem
      from (
        values
          (1, 'stamps_per_card = 1'), (2, 'stamps_per_card = 21'), (3, 'stamp_min_bill_amount = -1'), (4, 'stamp_min_bill_amount = 10000001'),
          (5, 'welcome_stamps = 8'), (6, 'welcome_stamps = -1'), (7, 'point_unit_amount = 999'), (8, 'point_unit_amount = 1000001'),
          (9, 'points_per_unit = 101'), (10, 'stamp_validity_months = 0'), (11, 'stamp_validity_months = 37'), (12, 'points_expiry_months = 61'),
          (13, 'earning_invoices_per_phone_per_day = 0'), (14, 'earning_invoices_per_phone_per_day = 21'), (15, 'checkin_window_before_minutes = 31'),
          (16, 'checkin_window_after_minutes = 0'), (17, 'checkin_window_after_minutes = 121'), (18, 'checkin_code_ttl_seconds = 29'),
          (19, 'checkin_pending_hours = 169'), (20, 'receipt_claim_window_hours = 0'), (21, 'receipt_claim_window_hours = 721'),
          (22, 'receipt_claims_per_phone_per_day = 21'), (23, 'point_value_amount = -1'), (24, 'expected_breakage_rate = 0.95'),
          (25, 'reward_budget_amount = -1'), (26, 'ends_on = starts_on - 1'), (27, 'name = '' '''), (28, 'excluded_order_sources = array['' '']'),
          (29, 'notification_basis = repeat(''x'', 501)')
      ) as v (n, setting)
    ) r
  ),
  array_fill('22023'::text, array[29]),
  'every parameter outside its range is refused with 22023'
);
select is(
  (
    select array_agg(r.problem order by r.n)
    from (
      select n, pg_temp.outcome_as((select owner_x from fx), format('update public.loyalty_programmes set %s where id = %L', setting, (select programme_x_draft from fx))) as problem
      from (
        values
          (1, 'stamps_per_card = 2, welcome_stamps = 1'), (2, 'stamps_per_card = 20, welcome_stamps = 19'), (3, 'stamp_min_bill_amount = 0'),
          (4, 'stamp_min_bill_amount = 10000000'), (5, 'point_unit_amount = 1000'), (6, 'point_unit_amount = 1000000'), (7, 'points_per_unit = 0'),
          (8, 'stamp_validity_months = 36, points_expiry_months = 60'), (9, 'earning_invoices_per_phone_per_day = 20'),
          (10, 'checkin_window_before_minutes = 0, checkin_window_after_minutes = 120'), (11, 'checkin_code_ttl_seconds = 600, checkin_pending_hours = 168'),
          (12, 'receipt_claim_window_hours = 720, receipt_claims_per_phone_per_day = 1'), (13, 'expected_breakage_rate = 0.9, point_value_amount = 0'),
          (14, 'excluded_order_sources = array['' Giao hàng '', ''delivery-app'']'), (15, 'ends_on = starts_on')
      ) as v (n, setting)
    ) r
  ),
  array_fill('rows:1'::text, array[15]),
  'every boundary value is accepted'
);
select is(
  (select excluded_order_sources from public.loyalty_programmes where id = (select programme_x_draft from fx)),
  array['Giao hàng', 'delivery-app'],
  'excluded order sources are trimmed'
);

set local role authenticated;
select is(pg_temp.value_as((select owner_x from fx), 'select count(*) from public.loyalty_programmes'), '2', 'an owner reads the tenant''s programmes');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.loyalty_programmes'), '2', 'a store-limited manager reads them');
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.loyalty_programmes'), '2', 'staff read them (data role)');
select is(pg_temp.value_as((select viewer_x from fx), 'select count(*) from public.loyalty_programmes'), '2', 'a viewer reads them');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.loyalty_programmes'), '0', 'the publisher reads none');
select is(pg_temp.value_as((select owner_y from fx), format('select count(*) from public.loyalty_programmes where tenant_id = %L', (select tenant_x from fx))), '0', 'another tenant reads none');
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_x from fx), 'select string_agg(name, '','' order by name) from public.loyalty_programmes'),
  'Synthetic draft X,Synthetic programme X',
  'a customer session reads its tenant''s programmes that are not drafts'
);
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_y from fx), 'select count(*) from public.loyalty_programmes'),
  '0',
  'a customer claim naming a customer of another tenant reads nothing'
);
select is(
  pg_temp.outcome_as((select manager_xall from fx), format('update public.loyalty_programmes set reward_budget_amount = 90000000 where id = %L', (select programme_x from fx))),
  'rows:1',
  'a manager with every store updates a programme'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('update public.loyalty_programmes set reward_budget_amount = 1 where id = %L', (select programme_x from fx))),
  'rows:0',
  'a store-limited manager updates nothing'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('update public.loyalty_programmes set reward_budget_amount = 1 where id = %L', (select programme_x from fx))),
  'rows:0',
  'staff update nothing'
);
select is(
  pg_temp.outcome_as((select viewer_x from fx), format('insert into public.loyalty_programmes (tenant_id, name, starts_on) values (%L, %L, current_date)', (select tenant_x from fx), 'Viewer programme')),
  '42501',
  'a viewer inserts nothing'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('insert into public.loyalty_programmes (tenant_id, name, starts_on) values (%L, %L, current_date)', (select tenant_x from fx), 'Limited programme')),
  '42501',
  'a store-limited manager inserts nothing'
);
select is(
  pg_temp.outcome_as((select manager_xall from fx), format('insert into public.loyalty_programmes (tenant_id, name, starts_on) values (%L, %L, current_date)', (select tenant_x from fx), 'Manager programme')),
  'rows:1',
  'a manager with every store inserts a programme'
);
select is(
  pg_temp.outcome_as((select publisher_x from fx), format('delete from public.loyalty_programmes where tenant_id = %L', (select tenant_x from fx))),
  'rows:0',
  'the publisher deletes nothing'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('delete from public.loyalty_programmes where name = %L', 'Manager programme')),
  'rows:1',
  'an owner with every store deletes a programme without members'
);

select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.loyalty_staff_phones (tenant_id, phone, label) values (%L, %L, %L)', (select tenant_x from fx), '090 000-6101', 'Synthetic cashier')),
  'rows:1',
  'an owner adds a staff phone'
);
reset role;
select is((select phone from public.loyalty_staff_phones where tenant_id = (select tenant_x from fx)), '+' || '84900006101', 'a national number is stored in E.164 form');
set local role authenticated;
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('insert into public.loyalty_staff_phones (tenant_id, phone) values (%L, %L)', (select tenant_x from fx), '+84 90 000 6102')),
  'rows:1',
  'a store-limited manager adds a staff phone'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.loyalty_staff_phones (tenant_id, phone) values (%L, %L)', (select tenant_x from fx), '0084900006101')),
  '23505',
  'the same phone in another form is a duplicate'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.loyalty_staff_phones (tenant_id, phone) values (%L, %L)', (select tenant_x from fx), 'not a phone')),
  '22023',
  'a value that is not a phone is refused'
);
select is(pg_temp.value_as((select owner_x from fx), 'select count(*) from public.loyalty_staff_phones'), '2', 'an owner reads the staff phones');
select is(pg_temp.value_as((select manager_x1 from fx), 'select count(*) from public.loyalty_staff_phones'), '2', 'a manager reads the staff phones');
select is(pg_temp.value_as((select staff_x1 from fx), 'select count(*) from public.loyalty_staff_phones'), '0', 'staff never read the staff phones');
select is(pg_temp.value_as((select viewer_x from fx), 'select count(*) from public.loyalty_staff_phones'), '0', 'a viewer never reads the staff phones');
select is(pg_temp.value_as((select publisher_x from fx), 'select count(*) from public.loyalty_staff_phones'), '0', 'the publisher never reads the staff phones');
select is(pg_temp.value_as((select owner_y from fx), 'select count(*) from public.loyalty_staff_phones'), '0', 'another tenant never reads them');
select is(
  pg_temp.value_as_customer((select customer_user from fx), (select tenant_x from fx), (select customer_x from fx), 'select count(*) from public.loyalty_staff_phones'),
  '0',
  'a customer session never reads them'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.loyalty_staff_phones (tenant_id, phone) values (%L, %L)', (select tenant_x from fx), '+' || '84900006103')),
  '42501',
  'staff add no staff phone'
);
select is(
  pg_temp.outcome_as((select viewer_x from fx), format('delete from public.loyalty_staff_phones where tenant_id = %L', (select tenant_x from fx))),
  'rows:0',
  'a viewer deletes no staff phone'
);
select is(
  pg_temp.outcome_as((select manager_xall from fx), format('update public.loyalty_staff_phones set phone = %L where phone = %L', '0900006104', '+' || '84900006102')),
  'rows:1',
  'a manager corrects a staff phone'
);
select is(
  pg_temp.value_as((select owner_x from fx), 'select string_agg(phone, '','' order by phone) from public.loyalty_staff_phones'),
  '+' || '84900006101,+' || '84900006104',
  'a corrected phone is normalised too'
);
reset role;

set local role anon;
select throws_ok('select count(*) from public.loyalty_programmes', '42501', null, 'anon reads no programme');
select throws_ok('select count(*) from public.loyalty_staff_phones', '42501', null, 'anon reads no staff phone');
reset role;

select is(app.loyalty_normalize_phone('0912 345 678'), '+' || '84912345678', 'a Vietnamese mobile number gains +84');
select is(app.loyalty_normalize_phone('84912345678'), '+' || '84912345678', 'the 84 prefix without + is read as Vietnamese');
select is(app.loyalty_normalize_phone('+1 (415) 555-0100'), '+14155550100', 'an international number keeps its country code');
select is(app.loyalty_normalize_phone('12345'), null, 'a short number is not a phone');
select is(app.loyalty_normalize_phone(null), null, 'null stays null');

select * from finish();
rollback;
