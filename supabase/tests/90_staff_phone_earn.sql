begin;
select plan(22);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009001'::uuid as tenant_p,
  'dddddddd-dddd-4ddd-8ddd-000000009002'::uuid as tenant_q,
  'cccccccc-cccc-4ccc-8ccc-000000009001'::uuid as account_p,
  'cccccccc-cccc-4ccc-8ccc-000000009002'::uuid as account_q,
  'ffffffff-ffff-4fff-8fff-000000009001'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000009002'::uuid as store_q,
  'eeeeeeee-eeee-4eee-8eee-000000009001'::uuid as staff_p,
  'eeeeeeee-eeee-4eee-8eee-000000009002'::uuid as former_p,
  'eeeeeeee-eeee-4eee-8eee-000000009003'::uuid as staff_q,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'staff-phone-earn-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.staff_p, fx.former_p, fx.staff_q]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_p, 'staff-phone-earn-pgtap', 'Staff phone earn pgTAP' from fx
union all
select tenant_q, 'staff-phone-earn-other-pgtap', 'Staff phone earn other pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_p, tenant_p, 'mock', 'staff-phone-earn', 'Synthetic account' from fx
union all
select account_q, tenant_q, 'mock', 'staff-phone-earn-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, tran_no_reset_period)
select store_p, tenant_p, account_p, 'spe-1', 'Synthetic store', 'daily'::public.tran_no_reset_period from fx
union all
select store_q, tenant_q, account_q, 'spe-9', 'Synthetic other store', 'daily' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_p, staff_p, 'staff'::public.tenant_role, array[store_p] from fx
union all
select tenant_p, former_p, 'staff', array[store_p] from fx
union all
select tenant_q, staff_q, 'staff', array[store_q] from fx;
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at, phone, phone_linked_at)
select tenant_p, 'Nhân viên thử', 'staff'::public.tenant_role, array[store_p], 'active', staff_p, t0 - interval '30 days', app.loyalty_normalize_phone('0900009001'), t0 - interval '30 days' from fx
union all
select tenant_p, 'Nhân viên cũ thử', 'staff', array[store_p], 'active', former_p, t0 - interval '30 days', app.loyalty_normalize_phone('0900009005'), t0 - interval '30 days' from fx
union all
select tenant_q, 'Nhân viên khác thử', 'staff', array[store_q], 'active', staff_q, t0 - interval '30 days', app.loyalty_normalize_phone('0900009003'), t0 - interval '30 days' from fx;
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_p, '0900009002' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_p, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone((select tenant_p from fx), '090000900' || n, timestamptz '2026-11-01 08:00+07')
from generate_series(1, 5) n;
insert into ids
select 'member_' || n, app.loyalty_join((select tenant_p from fx), (select id from ids where name = 'customer_' || n), 'mini_app', (select store_p from fx), null, null, timestamptz '2026-11-01 09:00+07')
from generate_series(1, 5) n;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_receipt text, p_phone text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
    select fx.tenant_p, fx.store_p, fx.account_p, 'spe-' || p_name, p_receipt, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net, p_phone
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.welcome(p_member text)
returns integer
language sql
as $$
  select coalesce(sum(l.stamp_delta), 0)::integer
  from public.loyalty_ledger l
  where l.membership_id = (select id from ids where name = p_member) and l.entry_kind = 'adjust' and l.reason = 'welcome';
$$;

create function pg_temp.earned(p_invoice text)
returns text
language sql
as $$
  select coalesce(
    (select concat_ws(':', l.matched_path, m.name) from public.loyalty_ledger l join ids m on m.id = l.membership_id where l.entry_kind = 'earn' and l.invoice_id = (select id from ids where name = p_invoice)),
    (select string_agg(concat_ws(':', r.matched_path, m.name, r.reason), ',' order by r.reason) from public.loyalty_refusals r join ids m on m.id = r.membership_id where r.invoice_id = (select id from ids where name = p_invoice)),
    'none'
  );
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty((select tenant_p from fx), date '2026-11-01', date '2026-11-20', p_at);
$$;

select is(pg_temp.welcome('member_1'), 0, 'a phone linked to an active roster row gets no welcome stamps');
select is(pg_temp.welcome('member_2'), 0, 'a phone on the staff-phone list gets no welcome stamps');
select is(pg_temp.welcome('member_3'), 2, 'a phone on another tenant''s roster is a customer here and gets the welcome stamps');
select is(pg_temp.welcome('member_4'), 2, 'a customer''s phone gets the welcome stamps');
select is(pg_temp.welcome('member_5'), 0, 'a second active roster phone gets no welcome stamps either');

select pg_temp.invoice('a_roster', timestamptz '2026-11-10 08:00+07', 60000, '0001', '0900009001');
select pg_temp.invoice('a_list', timestamptz '2026-11-10 08:05+07', 60000, '0002', '0900009002');
select pg_temp.invoice('a_other_roster', timestamptz '2026-11-10 08:10+07', 60000, '0003', '0900009003');
select pg_temp.invoice('a_plain', timestamptz '2026-11-10 08:15+07', 60000, '0004', '0900009004');
select pg_temp.invoice('a_former_before', timestamptz '2026-11-10 08:20+07', 60000, '0005', '0900009005');
select is((pg_temp.reconcile(timestamptz '2026-11-10 08:30+07') ->> 'a_earned')::int, 2, 'path A earns only the two customers'' invoices');
select is(pg_temp.earned('a_roster'), 'A:member_1:excluded_phone', 'path A refuses a roster phone as excluded_phone');
select is(pg_temp.earned('a_list'), 'A:member_2:excluded_phone', 'path A still refuses a phone on the staff-phone list');
select is(pg_temp.earned('a_other_roster'), 'A:member_3', 'another tenant''s roster does not exclude a phone here');
select is(pg_temp.earned('a_plain'), 'A:member_4', 'a customer earns on path A');
select is(pg_temp.earned('a_former_before'), 'A:member_5:excluded_phone', 'path A refuses the second roster phone while its row is active');

insert into ids select 'code_1', c.checkin_id from app.loyalty_issue_checkin_code((select id from ids where name = 'member_1'), (select store_p from fx), (select t0 from fx)) c;
select app.loyalty_record_checkin(
  (select store_p from fx),
  (select code from public.pending_checkins where id = (select id from ids where name = 'code_1')),
  (select staff_p from fx),
  70000,
  (select t0 from fx) + interval '30 seconds'
);
select pg_temp.invoice('b_roster', (select t0 from fx) + interval '3 minutes', 70000, '0010');
select is(
  app.loyalty_match_checkin((select id from ids where name = 'code_1'), (select t0 from fx) + interval '10 minutes'),
  'rejected',
  'path B rejects the check-in of a roster phone'
);
select is(
  (select concat_ws(':', status, reason) from public.pending_checkins where id = (select id from ids where name = 'code_1')),
  'rejected:excluded_phone',
  'the check-in keeps excluded_phone as its reason'
);
select is(pg_temp.earned('b_roster'), 'B:member_1:excluded_phone', 'path B stores the refusal and earns nothing');

select pg_temp.invoice('c_roster', timestamptz '2026-11-10 11:00+07', 80000, '0020');
select is(
  (
    select concat_ws(':', c.status, c.reason)
    from app.loyalty_submit_claim((select id from ids where name = 'member_1'), (select store_p from fx), date '2026-11-10', '20', 80000, timestamptz '2026-11-10 11:30+07') c
  ),
  'rejected:excluded_phone',
  'path C rejects the receipt claim of a roster phone'
);
select is(pg_temp.earned('c_roster'), 'C:member_1:excluded_phone', 'path C stores the refusal and earns nothing');

select pg_temp.invoice('d_roster', timestamptz '2026-11-10 12:00+07', 90000, '0030');
select is(
  (select e.refusal from app.loyalty_earn((select id from ids where name = 'd_roster'), (select id from ids where name = 'member_1'), 'D', timestamptz '2026-11-10 12:30+07') e),
  'excluded_phone',
  'path D refuses a roster phone'
);
select pg_temp.invoice('d_invoice_phone', timestamptz '2026-11-10 12:10+07', 90000, '0031', '0900009001');
select is(
  (select e.refusal from app.loyalty_earn((select id from ids where name = 'd_invoice_phone'), (select id from ids where name = 'member_4'), 'D', timestamptz '2026-11-10 12:30+07') e),
  'excluded_phone',
  'a customer''s earn is refused when the invoice carries a roster phone'
);

update public.staff_roster
set status = 'inactive', deactivated_at = timestamptz '2026-11-10 13:00+07', phone = null, phone_linked_at = null
where user_id = (select former_p from fx);
select pg_temp.invoice('a_former_after', timestamptz '2026-11-10 14:00+07', 60000, '0040', '0900009005');
select pg_temp.reconcile(timestamptz '2026-11-10 14:30+07');
select is(pg_temp.earned('a_former_after'), 'A:member_5', 'once the roster row is deactivated the phone earns again');
select is(pg_temp.earned('a_former_before'), 'A:member_5:excluded_phone', 'and an invoice refused while it was staff stays refused');

select is(app.staff_checkin_refusal('excluded_phone'), 'staff_phone', 'the staff app names the refusal staff_phone');
select is(
  (select string_agg(distinct matched_path, ',') from public.loyalty_refusals where membership_id = (select id from ids where name = 'member_1') and reason = 'excluded_phone'),
  'A,B,C,D',
  'the roster phone is refused on each of the paths A to D'
);

select * from finish();
rollback;
