-- Committed scratch fixture for the parallel-cap run; removed by conc_cleanup.sql.
insert into auth.users (id, instance_id, aud, role, email)
values ('eeeeeeee-eeee-4eee-8eee-000000029901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conc-9901@example.com');
insert into public.tenants (id, slug, name) values ('dddddddd-dddd-4ddd-8ddd-000000029901', 'conc-pgtap', 'Concurrency scratch');
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
values ('cccccccc-cccc-4ccc-8ccc-000000029901', 'dddddddd-dddd-4ddd-8ddd-000000029901', 'mock', 'conc', 'Synthetic');
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
values ('ffffffff-ffff-4fff-8fff-000000029901', 'dddddddd-dddd-4ddd-8ddd-000000029901', 'cccccccc-cccc-4ccc-8ccc-000000029901', 'conc-1', 'conc-1', 'Synthetic');
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
values ('dddddddd-dddd-4ddd-8ddd-000000029901', 'eeeeeeee-eeee-4eee-8eee-000000029901', 'staff', array['ffffffff-ffff-4fff-8fff-000000029901'::uuid]);
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
values ('dddddddd-dddd-4ddd-8ddd-000000029901', 'Synthetic', date '2026-01-01', 'below_threshold', 'active', 0);
update public.loyalty_store_settings set confirmation = 'staff', bill_staff_shift_cap = 3, bill_audit_sample_pct = 0
where store_id = 'ffffffff-ffff-4fff-8fff-000000029901';
create table public.conc_codes as
select n, i.code
from generate_series(1, 8) n
cross join lateral (select app.loyalty_join('dddddddd-dddd-4ddd-8ddd-000000029901',
  app.loyalty_customer_for_phone('dddddddd-dddd-4ddd-8ddd-000000029901', '09000299' || lpad(n::text, 2, '0'), now()), 'mini_app', null, null, null, now()) as m) j
cross join lateral app.loyalty_issue_checkin_code(j.m, 'ffffffff-ffff-4fff-8fff-000000029901', now()) i;
