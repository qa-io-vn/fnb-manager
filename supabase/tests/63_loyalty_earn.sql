begin;
select plan(59);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006301'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000006302'::uuid as tenant_r,
  'cccccccc-cccc-4ccc-8ccc-000000006301'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000006302'::uuid as account_r,
  'ffffffff-ffff-4fff-8fff-000000006301'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000006321'::uuid as store_r1,
  'ffffffff-ffff-4fff-8fff-000000006322'::uuid as store_r2,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006301'::uuid as programme_x,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006302'::uuid as programme_r,
  'eeeeeeee-eeee-4eee-8eee-000000006301'::uuid as owner_x;

insert into auth.users (id, instance_id, aud, role, email)
select owner_x, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'loyalty-earn-6301@example.com' from fx;

insert into public.tenants (id, slug, name)
select tenant_x, 'loyalty-earn-pgtap-x', 'Loyalty earn pgTAP X' from fx
union all
select tenant_r, 'loyalty-replay-pgtap', 'Loyalty replay pgTAP' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'loyalty-earn-x', 'Synthetic account X' from fx
union all
select account_r, tenant_r, 'mock', 'loyalty-replay', 'Synthetic replay account' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_x1, tenant_x, account_x, 'le-x1', 'Synthetic store X1' from fx
union all
select store_r1, tenant_r, account_r, 'rp-s1', 'Synthetic replay store 1' from fx
union all
select store_r2, tenant_r, account_r, 'rp-s2', 'Synthetic replay store 2' from fx;

insert into public.tenant_members (tenant_id, user_id, role)
select tenant_x, owner_x, 'owner' from fx;

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, excluded_order_sources)
select programme_x, tenant_x, 'Synthetic programme X', date '2026-09-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, array['delivery-app'] from fx
union all
select programme_r, tenant_r, 'Synthetic replay programme', date '2026-09-01', 'below_threshold', 'active', array['delivery-app'] from fx;

insert into public.loyalty_staff_phones (tenant_id, phone)
select tenant_x, '+' || '84900006399' from fx;

create temp table ids (name text primary key, id uuid);

insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone((select tenant_x from fx), '090000630' || n, timestamptz '2026-10-01 08:00+07')
from generate_series(1, 4) n;
insert into ids select 'customer_staff', app.loyalty_customer_for_phone((select tenant_x from fx), '+84 90 000 6399', timestamptz '2026-10-01 08:00+07');

insert into ids
select 'member_' || n, app.loyalty_join((select tenant_x from fx), (select id from ids where name = 'customer_' || n), 'mini_app', (select store_x1 from fx), null, null, timestamptz '2026-10-01 09:00+07')
from generate_series(1, 4) n;
insert into ids select 'member_staff', app.loyalty_join((select tenant_x from fx), (select id from ids where name = 'customer_staff'), 'till', (select store_x1 from fx), null, null, timestamptz '2026-10-01 09:00+07');

create function pg_temp.invoice(p_external text, p_sold timestamptz, p_net numeric, p_source text default 'tai-quan', p_status public.invoice_status default 'completed')
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, source_name, status)
  select fx.tenant_x, fx.store_x1, fx.account_x, p_external, right(p_external, 4), p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net, p_source, p_status
  from fx
  returning id;
$$;

create function pg_temp.earn(p_invoice uuid, p_member text, p_pending boolean default false)
returns text
language sql
as $$
  select concat_ws(':', case when e.entry_id is null then 'none' else 'entry' end, e.stamps, e.points, coalesce(e.refusal, '-'))
  from app.loyalty_earn(p_invoice, (select id from ids where name = p_member), 'A', timestamptz '2026-10-20 12:00+07', p_pending) e;
$$;

create function pg_temp.balance(p_member text, p_at timestamptz default null)
returns text
language sql
as $$
  select concat_ws(':', b.stamps, b.points, b.pending_stamps, b.pending_points)
  from app.loyalty_balance((select id from ids where name = p_member), p_at) b;
$$;

select is((select count(*)::int from public.customers where tenant_id = (select tenant_x from fx)), 5, 'a customer row per phone');
select is((select phone from public.customers where id = (select id from ids where name = 'customer_1')), '+' || '84900006301', 'a new customer is stored with the E.164 phone');
select is(pg_temp.balance('member_1'), '2:0:0:0', 'joining credits the two welcome stamps');
select is(
  (select string_agg(entry_kind::text || '/' || reason || '/' || stamp_delta, ',') from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_1')),
  'adjust/welcome/2',
  'the welcome stamps are an adjust row with reason welcome'
);
select is((select count(*)::int from public.stamps where membership_id = (select id from ids where name = 'member_1') and state = 'active'), 2, 'each welcome stamp has its stamps row');
select is(
  (select (expires_at - earned_at)::text from public.stamps where membership_id = (select id from ids where name = 'member_1') limit 1),
  '182 days',
  'a stamp lives for the programme''s six months'
);
select is(
  app.loyalty_join((select tenant_x from fx), (select id from ids where name = 'customer_1'), 'mini_app', null, null, null, timestamptz '2026-10-02 09:00+07'),
  (select id from ids where name = 'member_1'),
  'joining again returns the same membership'
);
select is(pg_temp.balance('member_1'), '2:0:0:0', 'and adds no second welcome');
select is(pg_temp.balance('member_staff'), '0:0:0:0', 'a staff phone joins without welcome stamps');
select throws_ok(
  $$ select app.loyalty_join((select tenant_r from fx), (select id from ids where name = 'customer_1'), 'mini_app') $$,
  '22023', null,
  'a customer of another tenant cannot join'
);
select throws_ok(
  $$ select app.loyalty_customer_for_phone((select tenant_x from fx), 'not a phone') $$,
  '22023', null,
  'a customer needs a readable phone'
);
select is(app.loyalty_customer_for_phone((select tenant_x from fx), '+' || '84900006301'), (select id from ids where name = 'customer_1'), 'the same phone in another form finds the same customer');

insert into ids select 'inv_60k', pg_temp.invoice('le-0001', timestamptz '2026-10-05 09:00+07', 60000);
insert into ids select 'inv_30k', pg_temp.invoice('le-0002', timestamptz '2026-10-05 10:00+07', 30000);
insert into ids select 'inv_5k', pg_temp.invoice('le-0003', timestamptz '2026-10-05 11:00+07', 5000);
insert into ids select 'inv_delivery', pg_temp.invoice('le-0004', timestamptz '2026-10-05 12:00+07', 90000, 'Delivery-App');
insert into ids select 'inv_staff', pg_temp.invoice('le-0005', timestamptz '2026-10-05 12:30+07', 90000);
insert into ids select 'inv_voided', pg_temp.invoice('le-0006', timestamptz '2026-10-05 13:00+07', 90000, 'tai-quan', 'voided');
insert into ids select 'inv_cap_' || n, pg_temp.invoice('le-001' || n, timestamptz '2026-10-06 08:00+07' + make_interval(hours => n), 55000) from generate_series(1, 4) n;

select is(pg_temp.earn((select id from ids where name = 'inv_60k'), 'member_1'), 'entry:1:6:-', 'a 60,000 bill earns one stamp and six points');
select is(
  (select concat_ws(':', matched_path, value_amount, business_date, (expires_at = timestamptz '2027-10-05 09:00+07')::text) from public.loyalty_ledger where invoice_id = (select id from ids where name = 'inv_60k')),
  'A:3000.00:2026-10-05:true',
  'the earn records its path, its value at issue and a twelve-month points expiry'
);
select is(pg_temp.earn((select id from ids where name = 'inv_60k'), 'member_2'), 'none:0:0:already_earned', 'a second earn for the same invoice is refused');
select is(pg_temp.earn((select id from ids where name = 'inv_30k'), 'member_1'), 'entry:0:3:below_minimum', 'a bill under the minimum earns points but no stamp');
select is(pg_temp.earn((select id from ids where name = 'inv_5k'), 'member_1'), 'none:0:0:below_minimum', 'a bill under one point unit earns nothing');
select is(pg_temp.earn((select id from ids where name = 'inv_delivery'), 'member_1'), 'none:0:0:excluded_source', 'an excluded order source earns nothing, whatever its case');
select is(pg_temp.earn((select id from ids where name = 'inv_staff'), 'member_staff'), 'none:0:0:excluded_phone', 'a staff phone earns nothing');
select is(pg_temp.earn((select id from ids where name = 'inv_voided'), 'member_1'), 'none:0:0:invoice_not_completed', 'a voided invoice earns nothing');
select is(
  (select string_agg(pg_temp.earn(i.id, 'member_2'), ',' order by i.name) from ids i where i.name like 'inv_cap_%'),
  'entry:1:5:-,entry:1:5:-,entry:1:5:-,none:0:0:daily_cap',
  'a phone earns on at most three invoices a business day'
);
select is(
  (select string_agg(reason, ',' order by reason) from public.loyalty_refusals where tenant_id = (select tenant_x from fx)),
  'already_earned,below_minimum,below_minimum,daily_cap,excluded_phone,excluded_source,invoice_not_completed',
  'every refusal is stored with its reason for the anomaly report'
);
select is(pg_temp.balance('member_1'), '3:9:0:0', 'the balance adds the welcome, the stamp and the points');

update public.loyalty_programmes set stamp_min_bill_amount = 70000 where id = (select programme_x from fx);
insert into ids select 'inv_after_change', pg_temp.invoice('le-0021', timestamptz '2026-10-07 09:00+07', 60000);
select is(pg_temp.earn((select id from ids where name = 'inv_after_change'), 'member_3'), 'entry:0:6:below_minimum', 'a raised minimum bill changes the next earn without a deploy');
update public.loyalty_programmes set stamp_min_bill_amount = 50000 where id = (select programme_x from fx);

update public.memberships set status = 'suspended' where id = (select id from ids where name = 'member_4');
insert into ids select 'inv_suspended', pg_temp.invoice('le-0022', timestamptz '2026-10-07 10:00+07', 60000);
select is(pg_temp.earn((select id from ids where name = 'inv_suspended'), 'member_4'), 'none:0:0:membership_inactive', 'a suspended membership earns nothing');
update public.memberships set status = 'active' where id = (select id from ids where name = 'member_4');

update public.loyalty_programmes set status = 'paused' where id = (select programme_x from fx);
insert into ids select 'inv_paused', pg_temp.invoice('le-0023', timestamptz '2026-10-07 11:00+07', 60000);
select is(pg_temp.earn((select id from ids where name = 'inv_paused'), 'member_4'), 'none:0:0:programme_inactive', 'a paused programme earns nothing');
update public.loyalty_programmes set status = 'active' where id = (select programme_x from fx);

insert into ids select 'inv_pending', pg_temp.invoice('le-0024', timestamptz '2026-10-07 12:00+07', 80000);
select is(pg_temp.earn((select id from ids where name = 'inv_pending'), 'member_4', true), 'entry:1:8:-', 'an earn may be written pending');
select is(pg_temp.balance('member_4'), '2:0:1:8', 'a pending earn shows apart from the spendable balance');
insert into ids select 'confirm_4', app.loyalty_confirm((select id from public.loyalty_ledger where invoice_id = (select id from ids where name = 'inv_pending') and entry_kind = 'earn'), null, timestamptz '2026-10-07 13:00+07');
select is(pg_temp.balance('member_4'), '3:8:0:0', 'its confirm row makes it spendable');
select is(
  app.loyalty_confirm((select id from public.loyalty_ledger where invoice_id = (select id from ids where name = 'inv_pending') and entry_kind = 'earn')),
  (select id from ids where name = 'confirm_4'),
  'confirming again returns the same row'
);
select throws_ok(
  format('select app.loyalty_confirm(%L)', (select id from public.loyalty_ledger where invoice_id = (select id from ids where name = 'inv_60k') and entry_kind = 'earn')),
  '22023', null,
  'only a pending entry is confirmed'
);

update public.invoices set status = 'voided' where id = (select id from ids where name = 'inv_60k');
select is(app.loyalty_clawback((select id from ids where name = 'inv_60k'), null, timestamptz '2026-10-21 02:00+07'), 1, 'a voided invoice''s earn is clawed back');
select is(
  (select concat_ws(':', stamp_delta, point_delta, value_amount, reason) from public.loyalty_ledger where entry_kind = 'clawback' and invoice_id = (select id from ids where name = 'inv_60k')),
  '-1:-6:-3000.00:invoice_voided',
  'the clawback has the opposite deltas and the void as reason'
);
select is(pg_temp.balance('member_1'), '2:3:0:0', 'the balance drops back');
select is(
  (select string_agg(state::text, ',' order by state::text) from public.stamps where membership_id = (select id from ids where name = 'member_1')),
  'active,active,clawed_back',
  'the clawed-back stamp is closed'
);
select is(app.loyalty_clawback((select id from ids where name = 'inv_60k')), 0, 'a second clawback writes nothing');
select throws_ok(
  format('select app.loyalty_clawback(%L)', (select id from ids where name = 'inv_30k')),
  '22023', null,
  'a clawback of a completed invoice needs a reason'
);

insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, occurred_at)
select fx.tenant_x, fx.programme_x, i.id, fx.store_x1, 'redeem', -3, timestamptz '2026-10-08 09:00+07'
from fx, ids i where i.name = 'member_2';
update public.stamps s set state = 'redeemed', closed_at = timestamptz '2026-10-08 09:00+07'
where s.id in (select s2.id from public.stamps s2 where s2.membership_id = (select id from ids where name = 'member_2') and s2.state = 'active' order by s2.expires_at limit 3);
update public.invoices set status = 'edited' where id = (select id from ids where name = 'inv_cap_1');
select is(app.loyalty_clawback((select id from ids where name = 'inv_cap_1'), null, timestamptz '2026-10-21 02:00+07'), 1, 'an edited invoice''s earn is clawed back');
select is(pg_temp.balance('member_2'), '1:10:0:0', 'after a redemption the clawback still applies');
update public.invoices set status = 'voided' where id in (select id from ids where name in ('inv_cap_2', 'inv_cap_3'));
select is(
  app.loyalty_clawback((select id from ids where name = 'inv_cap_2'), null, timestamptz '2026-10-21 02:00+07')
    + app.loyalty_clawback((select id from ids where name = 'inv_cap_3'), null, timestamptz '2026-10-21 02:00+07'),
  2,
  'two more voids are clawed back'
);
select is(pg_temp.balance('member_2'), '-1:0:0:0', 'a clawback after a redemption leaves a negative balance');

select is(
  app.loyalty_expire((select tenant_x from fx), timestamptz '2027-03-01 00:00+07'),
  '{"points": 0, "stamps": 0, "memberships": 0}'::jsonb,
  'nothing expires before its validity'
);
select is(
  app.loyalty_expire((select tenant_x from fx), timestamptz '2027-04-08 00:00+07'),
  '{"points": 0, "stamps": 7, "memberships": 3}'::jsonb,
  'six months on, the active welcome and earned stamps of three members expire'
);
select is(pg_temp.balance('member_1'), '0:3:0:0', 'the expired stamps leave the balance');
select is(
  app.loyalty_expire((select tenant_x from fx), timestamptz '2027-04-08 00:00+07'),
  '{"points": 0, "stamps": 0, "memberships": 0}'::jsonb,
  'a second run at the same moment expires nothing'
);
select is(
  app.loyalty_expire((select tenant_x from fx), timestamptz '2027-10-08 00:00+07'),
  '{"points": 17, "stamps": 0, "memberships": 3}'::jsonb,
  'twelve months on, the remaining points expire first in first out'
);
select is(pg_temp.balance('member_1'), '0:0:0:0', 'leaving nothing spendable');

grant select on fx, ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select owner_x from fx), 'role', 'authenticated')::text, true);
select throws_ok(
  format('select * from app.loyalty_earn(%L, %L, %L)', (select id from ids where name = 'inv_5k'), (select id from ids where name = 'member_3'), 'A'),
  '42501', null,
  'an owner cannot call the earn function'
);
select throws_ok(
  format('select app.loyalty_join(%L, %L, %L)', (select tenant_x from fx), (select id from ids where name = 'customer_3'), 'mini_app'),
  '42501', null,
  'nor the join function'
);
reset role;

create temp table replay as
select $replay${"dataset":{"base":"2026-10-01","days":30,"utcOffsetMinutes":420,"phones":["0900007001","0900007002","0900007003","0900007004","0900007005","0900007006","0900007007","0900007008","0900007009","0900007010","0900007011","0900007012","0900007013","0900007014","0900007015","0900007016","0900007017","0900007018","0900007019","0900007020","0900007021","0900007022","0900007023","0900007024","0900007025","0900007026","0900007027","0900007028","0900007029","0900007030","0900007031","0900007032","0900007033","0900007034","0900007035","0900007036","0900007037","0900007038","0900007039","0900007040","0900007041","0900007042","0900007043","0900007044","0900007045","0900007046","0900007047","0900007048","0900007049","0900007050"],"staffPhoneIndexes":[49],"rows":[["rp-0001",0,1,26580,26000,36,1,0,0],["rp-0002",0,1,27120,31000,-1,0,0,0],["rp-0003",0,0,28260,143000,45,0,0,0],["rp-0004",0,1,32340,59000,32,0,0,0],["rp-0005",0,0,32700,78000,35,0,0,0],["rp-0006",0,1,36360,23000,2,0,0,0],["rp-0007",0,0,39240,91000,48,0,0,0],["rp-0008",0,0,42300,47000,26,0,0,0],["rp-0009",0,0,43680,4000,42,0,0,0],["rp-0010",0,0,45540,9000,-1,0,0,0],["rp-0011",0,1,48120,16000,-1,0,0,0],["rp-0012",0,1,50160,21000,5,0,0,0],["rp-0013",0,0,50640,19000,35,0,0,0],["rp-0014",0,1,53220,150000,7,0,0,1],["rp-0015",0,1,56460,59000,11,0,0,0],["rp-0016",0,1,60240,134000,-1,1,0,0],["rp-0017",0,0,60600,38000,45,0,0,0],["rp-0018",0,0,61680,54000,-1,0,0,0],["rp-0019",0,1,65280,41000,12,0,0,0],["rp-0020",0,0,66840,9000,42,0,0,0],["rp-0021",0,0,71400,31000,-1,0,0,0],["rp-0022",0,0,71640,19000,-1,1,0,0],["rp-0023",0,1,72960,57000,19,0,0,0],["rp-0024",1,0,30840,69000,23,0,0,0],["rp-0025",1,1,33420,15000,17,0,0,0],["rp-0026",1,0,37740,145000,-1,0,0,0],["rp-0027",1,1,40080,10000,46,0,0,0],["rp-0028",1,1,43560,109000,22,0,0,0],["rp-0029",1,0,44640,11000,-1,0,0,0],["rp-0030",1,0,51180,149000,27,0,0,0],["rp-0031",1,1,53220,137000,-1,0,0,0],["rp-0032",1,0,56100,24000,-1,0,0,0],["rp-0033",1,1,59220,147000,-1,0,0,0],["rp-0034",1,0,59580,12000,13,0,0,0],["rp-0035",1,1,60960,78000,-1,0,0,0],["rp-0036",1,1,66480,67000,-1,0,0,0],["rp-0037",1,0,66840,150000,8,0,0,0],["rp-0038",1,0,68520,94000,21,0,0,0],["rp-0039",1,1,68760,68000,49,0,0,0],["rp-0040",1,0,73680,76000,-1,0,0,0],["rp-0041",1,1,74460,62000,-1,0,0,0],["rp-0042",2,0,26940,42000,12,0,0,0],["rp-0043",2,0,27060,22000,21,0,0,0],["rp-0044",2,1,28080,23000,7,0,0,0],["rp-0045",2,1,41340,5000,0,0,0,0],["rp-0046",2,0,42660,129000,-1,0,0,0],["rp-0047",2,0,43440,45000,18,0,0,0],["rp-0048",2,1,43800,105000,21,0,0,0],["rp-0049",2,1,46380,51000,36,0,0,0],["rp-0050",2,1,46740,130000,-1,0,0,0],["rp-0051",2,0,47220,120000,33,0,0,0],["rp-0052",2,1,53400,22000,39,0,0,0],["rp-0053",2,1,55440,55000,43,0,0,0],["rp-0054",2,0,57720,139000,25,1,0,0],["rp-0055",2,0,58320,104000,-1,0,1,0],["rp-0056",2,0,59040,145000,-1,0,0,0],["rp-0057",2,0,62280,6000,34,0,0,0],["rp-0058",2,0,62700,10000,5,0,0,0],["rp-0059",2,1,64560,19000,-1,0,0,0],["rp-0060",2,0,74220,32000,17,0,0,0],["rp-0061",2,1,75060,120000,-1,0,1,0],["rp-0062",2,1,75180,132000,25,0,0,0],["rp-0063",3,0,27540,28000,-1,0,1,0],["rp-0064",3,1,28860,135000,-1,0,0,0],["rp-0065",3,0,29460,72000,-1,0,0,0],["rp-0066",3,1,31020,20000,-1,0,0,0],["rp-0067",3,0,31500,135000,37,0,0,0],["rp-0068",3,0,32490,60000,0,0,0,0],["rp-0069",3,1,33600,124000,-1,0,0,0],["rp-0070",3,0,34080,72000,27,0,0,0],["rp-0071",3,0,34290,61000,0,0,0,0],["rp-0072",3,1,35520,130000,30,0,0,0],["rp-0073",3,0,36090,62000,0,0,0,0],["rp-0074",3,0,37890,63000,0,0,0,0],["rp-0075",3,0,39690,64000,0,0,0,0],["rp-0076",3,1,42900,42000,48,0,0,0],["rp-0077",3,1,46140,132000,-1,0,0,0],["rp-0078",3,0,52260,88000,13,0,0,0],["rp-0079",3,1,53340,40000,17,0,0,0],["rp-0080",3,1,54720,69000,-1,0,1,0],["rp-0081",3,1,60360,130000,-1,0,0,0],["rp-0082",3,1,60900,137000,25,0,0,0],["rp-0083",3,0,66840,28000,36,0,0,0],["rp-0084",3,0,67740,111000,36,0,0,0],["rp-0085",3,0,68100,107000,-1,0,0,0],["rp-0086",3,0,70200,128000,-1,0,0,0],["rp-0087",4,0,26280,33000,-1,0,0,0],["rp-0088",4,1,30300,30000,24,0,0,0],["rp-0089",4,1,31020,10000,19,0,0,0],["rp-0090",4,0,32340,81000,6,0,0,0],["rp-0091",4,0,33420,145000,-1,0,0,0],["rp-0092",4,1,34260,133000,20,0,0,1],["rp-0093",4,0,37560,37000,9,0,0,0],["rp-0094",4,1,37980,50000,29,0,0,0],["rp-0095",4,0,41340,50000,-1,0,0,0],["rp-0096",4,1,44100,49000,46,0,0,0],["rp-0097",4,1,44220,81000,32,0,0,0],["rp-0098",4,1,46200,80000,38,0,0,0],["rp-0099",4,1,46560,115000,-1,0,1,0],["rp-0100",4,1,48660,11000,-1,0,0,0],["rp-0101",4,0,51120,149000,-1,0,0,0],["rp-0102",4,1,57180,34000,0,0,0,0],["rp-0103",4,0,58800,59000,41,0,0,0],["rp-0104",4,1,59160,138000,30,1,0,0],["rp-0105",4,0,64680,69000,8,0,0,0],["rp-0106",4,1,66600,63000,44,0,0,0],["rp-0107",4,1,66660,65000,-1,0,0,0],["rp-0108",4,1,73140,40000,7,0,0,0],["rp-0109",4,0,73740,48000,9,1,0,1],["rp-0110",5,0,27300,65000,22,1,0,0],["rp-0111",5,1,29820,51000,-1,0,0,0],["rp-0112",5,0,30180,120000,26,0,0,1],["rp-0113",5,1,32220,6000,-1,0,0,0],["rp-0114",5,1,43380,43000,46,0,0,0],["rp-0115",5,0,44700,103000,-1,0,0,0],["rp-0116",5,1,45720,116000,37,0,0,0],["rp-0117",5,0,47640,149000,3,0,0,0],["rp-0118",5,1,49860,141000,47,0,0,0],["rp-0119",5,0,56640,49000,38,0,0,0],["rp-0120",5,0,60480,129000,-1,0,0,0],["rp-0121",5,1,62880,49000,-1,0,0,0],["rp-0122",5,0,66060,37000,32,0,1,0],["rp-0123",5,0,66840,12000,-1,0,0,0],["rp-0124",5,1,69360,143000,-1,0,0,0],["rp-0125",5,1,71160,29000,-1,0,0,0],["rp-0126",5,1,73080,112000,46,0,0,0],["rp-0127",6,0,29460,143000,-1,0,0,0],["rp-0128",6,0,33300,145000,20,0,0,0],["rp-0129",6,1,33360,77000,-1,0,0,0],["rp-0130",6,0,35280,30000,18,0,0,0],["rp-0131",6,1,38160,81000,29,0,0,0],["rp-0132",6,0,40740,50000,-1,0,0,0],["rp-0133",6,1,40980,106000,34,0,0,0],["rp-0134",6,1,44160,88000,-1,0,0,0],["rp-0135",6,1,57240,142000,23,0,0,0],["rp-0136",6,1,57480,150000,11,0,0,0],["rp-0137",6,0,59160,78000,13,0,0,0],["rp-0138",6,1,68640,37000,-1,0,0,0],["rp-0139",6,1,68760,72000,0,0,0,0],["rp-0140",6,1,72180,57000,11,0,0,0],["rp-0141",6,0,72240,38000,-1,0,0,0],["rp-0142",6,0,72840,106000,23,0,0,0],["rp-0143",6,0,73020,81000,-1,0,0,0],["rp-0144",7,1,26280,89000,7,0,0,0],["rp-0145",7,1,27120,143000,22,0,0,0],["rp-0146",7,1,28980,147000,49,0,0,0],["rp-0147",7,1,31020,122000,-1,0,0,0],["rp-0148",7,1,31800,78000,-1,0,0,0],["rp-0149",7,0,35580,77000,-1,0,0,0],["rp-0150",7,0,39900,41000,18,0,0,0],["rp-0151",7,1,40320,61000,-1,0,0,0],["rp-0152",7,0,40620,12000,38,0,0,0],["rp-0153",7,0,42300,56000,-1,0,0,0],["rp-0154",7,0,48120,41000,38,0,0,0],["rp-0155",7,0,52020,4000,36,0,0,0],["rp-0156",7,1,53700,97000,-1,0,1,0],["rp-0157",7,1,57600,66000,37,0,0,0],["rp-0158",7,1,57960,135000,-1,0,0,0],["rp-0159",7,0,61080,20000,30,0,0,0],["rp-0160",7,1,63360,140000,-1,0,0,0],["rp-0161",7,1,67740,129000,-1,0,0,0],["rp-0162",7,1,73500,5000,1,0,0,0],["rp-0163",7,0,73740,132000,37,0,0,0],["rp-0164",7,0,75240,68000,38,0,0,0],["rp-0165",8,0,26340,55000,47,0,0,0],["rp-0166",8,1,38100,27000,30,0,0,0],["rp-0167",8,1,38640,93000,46,0,0,0],["rp-0168",8,1,38820,131000,22,0,0,0],["rp-0169",8,1,40440,118000,42,0,0,0],["rp-0170",8,0,43200,77000,-1,0,0,0],["rp-0171",8,0,45780,8000,40,0,0,0],["rp-0172",8,1,47820,24000,13,0,0,0],["rp-0173",8,1,48600,9000,6,0,0,0],["rp-0174",8,0,56400,127000,39,0,0,0],["rp-0175",8,1,56640,147000,-1,0,0,0],["rp-0176",8,1,57240,118000,-1,0,0,0],["rp-0177",8,0,57660,94000,-1,0,1,0],["rp-0178",8,1,57720,109000,26,0,0,0],["rp-0179",8,1,59340,95000,41,0,0,0],["rp-0180",8,0,59880,44000,25,0,0,0],["rp-0181",8,0,66780,105000,8,0,0,0],["rp-0182",8,0,67560,60000,10,0,0,0],["rp-0183",8,1,67920,22000,40,0,0,0],["rp-0184",8,1,69120,52000,-1,0,0,0],["rp-0185",8,1,73080,25000,-1,0,0,0],["rp-0186",8,1,74400,114000,23,1,0,0],["rp-0187",8,0,74760,143000,-1,0,0,0],["rp-0188",9,1,25200,32000,20,0,0,0],["rp-0189",9,1,25800,40000,24,0,0,0],["rp-0190",9,1,34980,138000,48,0,0,0],["rp-0191",9,1,40260,5000,-1,0,0,0],["rp-0192",9,0,42300,102000,-1,1,1,0],["rp-0193",9,0,42900,53000,-1,0,0,0],["rp-0194",9,1,46020,78000,48,0,0,0],["rp-0195",9,1,47400,17000,38,0,0,0],["rp-0196",9,0,53520,48000,12,0,0,0],["rp-0197",9,1,53580,55000,33,0,0,0],["rp-0198",9,1,55500,106000,32,0,0,0],["rp-0199",9,0,58920,30000,32,0,0,0],["rp-0200",9,1,59520,29000,4,0,0,0],["rp-0201",9,0,65580,21000,24,0,0,0],["rp-0202",9,0,65760,101000,44,0,0,0],["rp-0203",9,1,69000,96000,-1,0,0,0],["rp-0204",9,0,69360,25000,-1,0,0,0],["rp-0205",9,0,70320,99000,40,0,0,0],["rp-0206",9,1,70320,118000,-1,0,0,0],["rp-0207",9,0,74340,81000,5,0,0,0],["rp-0208",10,0,26220,98000,26,0,0,0],["rp-0209",10,0,27720,79000,29,0,0,0],["rp-0210",10,1,28380,107000,33,0,0,0],["rp-0211",10,0,29280,41000,-1,0,0,0],["rp-0212",10,1,35880,112000,-1,0,0,0],["rp-0213",10,0,37140,140000,38,0,0,0],["rp-0214",10,1,42420,69000,-1,1,0,0],["rp-0215",10,1,43140,136000,28,0,1,0],["rp-0216",10,0,44760,132000,41,0,0,0],["rp-0217",10,1,48540,100000,8,0,0,0],["rp-0218",10,0,56820,126000,-1,0,0,0],["rp-0219",10,1,58920,45000,-1,0,0,0],["rp-0220",10,1,61200,139000,-1,0,0,0],["rp-0221",10,1,61980,14000,-1,0,0,0],["rp-0222",10,1,62760,45000,39,0,0,0],["rp-0223",10,0,64260,5000,-1,0,0,0],["rp-0224",10,1,64800,52000,-1,0,0,0],["rp-0225",10,1,64920,139000,8,1,0,0],["rp-0226",10,0,66060,59000,27,0,0,0],["rp-0227",10,1,67620,10000,-1,0,0,0],["rp-0228",10,0,68520,141000,3,0,0,0],["rp-0229",10,0,68640,122000,47,0,0,0],["rp-0230",10,1,71880,119000,23,0,0,0],["rp-0231",10,1,72420,80000,49,0,0,0],["rp-0232",11,1,25620,110000,41,1,0,0],["rp-0233",11,0,27120,46000,44,0,0,0],["rp-0234",11,0,31380,128000,46,0,0,0],["rp-0235",11,0,32160,71000,-1,0,0,0],["rp-0236",11,1,32700,113000,2,0,0,0],["rp-0237",11,1,33840,74000,14,0,0,0],["rp-0238",11,0,36480,90000,23,0,0,0],["rp-0239",11,1,36840,94000,39,0,0,0],["rp-0240",11,1,43080,70000,40,0,0,0],["rp-0241",11,0,43920,100000,-1,0,0,0],["rp-0242",11,1,46860,39000,48,0,0,0],["rp-0243",11,0,51480,52000,-1,0,0,0],["rp-0244",11,0,55260,123000,-1,0,0,0],["rp-0245",11,0,56760,21000,-1,0,0,0],["rp-0246",11,1,56880,74000,12,0,0,0],["rp-0247",11,0,57060,128000,6,0,0,0],["rp-0248",11,0,62820,49000,-1,0,0,0],["rp-0249",11,1,67980,82000,2,0,0,0],["rp-0250",11,0,68040,142000,-1,0,0,0],["rp-0251",11,0,75300,23000,21,0,0,0],["rp-0252",12,1,29760,149000,-1,0,0,0],["rp-0253",12,0,33660,4000,21,0,0,0],["rp-0254",12,0,39660,64000,26,0,0,0],["rp-0255",12,1,40020,98000,30,0,0,0],["rp-0256",12,0,40320,84000,6,0,0,0],["rp-0257",12,0,41160,63000,45,0,0,0],["rp-0258",12,0,41880,105000,-1,0,0,0],["rp-0259",12,1,42540,50000,13,0,0,0],["rp-0260",12,1,43620,70000,26,0,0,0],["rp-0261",12,1,44280,89000,-1,0,0,0],["rp-0262",12,0,44940,63000,28,0,0,0],["rp-0263",12,0,47160,89000,12,0,0,0],["rp-0264",12,0,47940,100000,26,1,0,0],["rp-0265",12,1,49620,47000,8,0,0,0],["rp-0266",12,1,52800,46000,-1,0,0,0],["rp-0267",12,1,53760,79000,42,0,0,0],["rp-0268",12,0,54000,72000,-1,0,0,0],["rp-0269",12,1,57120,18000,44,0,0,0],["rp-0270",12,0,58080,48000,49,1,0,0],["rp-0271",12,1,60900,124000,-1,0,0,0],["rp-0272",12,1,62880,25000,28,0,0,0],["rp-0273",12,1,67380,66000,43,0,0,0],["rp-0274",12,0,68340,63000,5,0,0,1],["rp-0275",12,1,70320,80000,-1,0,0,0],["rp-0276",13,0,25620,125000,-1,0,0,0],["rp-0277",13,0,33240,70000,-1,0,0,0],["rp-0278",13,1,38160,5000,15,1,0,0],["rp-0279",13,0,41100,32000,-1,0,0,0],["rp-0280",13,0,43200,38000,22,0,0,0],["rp-0281",13,0,45300,46000,40,0,0,0],["rp-0282",13,1,45960,24000,45,1,0,0],["rp-0283",13,0,46800,31000,41,0,0,0],["rp-0284",13,0,52140,57000,-1,0,0,0],["rp-0285",13,1,56640,60000,25,0,0,0],["rp-0286",13,1,57600,149000,12,0,0,1],["rp-0287",13,1,58260,31000,5,0,0,0],["rp-0288",13,1,60720,120000,-1,0,0,0],["rp-0289",13,0,61740,77000,-1,1,0,0],["rp-0290",13,0,61860,74000,39,0,0,0],["rp-0291",13,1,61980,22000,-1,0,0,0],["rp-0292",13,1,63660,68000,27,0,0,0],["rp-0293",13,1,68460,142000,40,0,0,0],["rp-0294",13,0,70200,19000,28,0,0,0],["rp-0295",13,1,70740,95000,-1,0,0,0],["rp-0296",13,0,71040,64000,24,0,0,0],["rp-0297",13,1,71880,129000,15,0,0,1],["rp-0298",13,0,75360,44000,14,0,0,0],["rp-0299",14,1,27300,96000,-1,0,0,0],["rp-0300",14,0,28560,110000,22,0,0,0],["rp-0301",14,1,29760,37000,21,0,0,0],["rp-0302",14,1,36300,8000,20,0,0,0],["rp-0303",14,1,39180,58000,-1,0,0,0],["rp-0304",14,0,40740,6000,-1,0,0,0],["rp-0305",14,1,40980,97000,-1,0,0,0],["rp-0306",14,0,50760,81000,-1,0,0,0],["rp-0307",14,1,54000,89000,22,0,0,0],["rp-0308",14,1,54600,147000,-1,0,0,0],["rp-0309",14,0,54960,40000,33,0,0,0],["rp-0310",14,1,57660,88000,43,0,0,0],["rp-0311",14,1,61440,76000,49,0,0,0],["rp-0312",14,0,62640,95000,49,0,1,0],["rp-0313",14,0,65520,137000,18,1,0,0],["rp-0314",14,0,66420,37000,29,0,0,0],["rp-0315",14,0,66840,76000,-1,0,0,0],["rp-0316",14,1,70500,73000,-1,0,0,0],["rp-0317",14,1,71580,147000,36,0,0,0],["rp-0318",14,1,72960,42000,-1,1,0,0],["rp-0319",14,1,74040,131000,-1,0,0,0],["rp-0320",15,0,27960,78000,-1,0,0,0],["rp-0321",15,1,29280,36000,-1,0,0,0],["rp-0322",15,1,29580,5000,1,0,0,0],["rp-0323",15,0,29820,70000,11,0,0,0],["rp-0324",15,1,31620,150000,-1,0,0,0],["rp-0325",15,1,32040,145000,-1,0,0,0],["rp-0326",15,1,32340,6000,5,0,0,0],["rp-0327",15,1,34440,73000,-1,0,0,0],["rp-0328",15,0,35040,23000,2,1,0,0],["rp-0329",15,0,43380,64000,29,0,0,0],["rp-0330",15,0,58620,146000,42,0,0,0],["rp-0331",15,0,62460,78000,9,0,0,0],["rp-0332",15,0,63780,87000,40,0,0,0],["rp-0333",15,0,65160,143000,-1,1,0,0],["rp-0334",15,1,67080,9000,-1,0,0,0],["rp-0335",15,0,69240,141000,38,1,0,0],["rp-0336",15,1,71700,128000,25,0,0,0],["rp-0337",15,0,71940,149000,-1,0,0,0],["rp-0338",15,1,74040,70000,-1,0,0,0],["rp-0339",16,1,30300,86000,34,0,0,0],["rp-0340",16,1,33900,95000,-1,0,0,0],["rp-0341",16,1,35520,48000,-1,0,0,0],["rp-0342",16,0,36000,5000,-1,0,0,0],["rp-0343",16,1,37140,103000,-1,0,0,0],["rp-0344",16,1,40260,80000,-1,0,0,0],["rp-0345",16,0,43260,144000,-1,0,0,0],["rp-0346",16,0,53100,135000,3,0,0,0],["rp-0347",16,0,58380,78000,-1,1,0,0],["rp-0348",16,1,62040,121000,-1,0,0,0],["rp-0349",16,1,62880,17000,-1,0,0,0],["rp-0350",16,1,68940,146000,9,0,0,0],["rp-0351",16,0,71640,82000,39,0,0,0],["rp-0352",16,0,73860,48000,11,0,0,0],["rp-0353",16,0,74400,54000,-1,0,0,0],["rp-0354",16,0,74460,55000,25,0,0,0],["rp-0355",17,0,27720,33000,-1,0,0,0],["rp-0356",17,0,29280,86000,-1,0,0,0],["rp-0357",17,1,30300,89000,-1,0,0,0],["rp-0358",17,0,31680,91000,-1,0,0,0],["rp-0359",17,1,39780,69000,38,0,0,0],["rp-0360",17,1,40260,46000,3,0,0,0],["rp-0361",17,1,42060,80000,-1,0,0,0],["rp-0362",17,1,48360,111000,-1,0,0,0],["rp-0363",17,1,48420,149000,0,0,0,0],["rp-0364",17,1,53760,23000,11,0,0,0],["rp-0365",17,1,54180,43000,34,0,0,0],["rp-0366",17,1,54660,89000,-1,0,0,0],["rp-0367",17,1,55140,118000,30,0,0,0],["rp-0368",17,1,55680,6000,-1,0,0,0],["rp-0369",17,1,56400,71000,-1,0,0,0],["rp-0370",17,0,59340,51000,-1,1,0,0],["rp-0371",17,0,59700,49000,13,0,1,0],["rp-0372",17,0,64500,48000,-1,0,0,0],["rp-0373",17,0,66780,134000,16,0,0,0],["rp-0374",17,0,67620,98000,29,0,0,0],["rp-0375",17,1,67800,147000,11,0,0,0],["rp-0376",17,1,68040,123000,-1,1,0,0],["rp-0377",17,0,69840,99000,-1,0,0,0],["rp-0378",18,1,28980,49000,28,0,0,0],["rp-0379",18,1,32160,90000,-1,0,0,0],["rp-0380",18,1,32760,5000,-1,0,0,0],["rp-0381",18,0,37200,146000,23,0,0,0],["rp-0382",18,0,40680,146000,4,0,0,0],["rp-0383",18,1,42600,34000,2,0,0,0],["rp-0384",18,1,43860,69000,-1,0,0,0],["rp-0385",18,1,43980,42000,-1,1,0,0],["rp-0386",18,0,45180,35000,9,0,0,0],["rp-0387",18,0,46920,111000,-1,0,0,0],["rp-0388",18,0,51060,98000,36,0,0,0],["rp-0389",18,1,52620,69000,-1,0,0,0],["rp-0390",18,1,56340,40000,-1,0,0,0],["rp-0391",18,1,56460,31000,-1,0,0,0],["rp-0392",18,1,61920,116000,39,1,0,0],["rp-0393",18,0,63240,147000,-1,1,0,0],["rp-0394",18,1,63600,129000,38,0,0,0],["rp-0395",18,0,64260,98000,-1,0,0,0],["rp-0396",18,0,64800,145000,-1,0,0,0],["rp-0397",18,0,67620,67000,-1,0,0,0],["rp-0398",18,0,69300,85000,38,0,0,0],["rp-0399",18,0,69420,35000,-1,0,0,0],["rp-0400",19,1,31560,86000,-1,0,0,0],["rp-0401",19,1,33000,116000,20,1,0,0],["rp-0402",19,1,34140,46000,19,0,0,0],["rp-0403",19,1,35220,94000,32,0,0,0],["rp-0404",19,1,36180,94000,-1,0,0,0],["rp-0405",19,1,36900,129000,46,0,0,0],["rp-0406",19,0,37860,108000,38,0,0,0],["rp-0407",19,1,38640,146000,-1,0,0,0],["rp-0408",19,1,39540,66000,-1,0,0,0],["rp-0409",19,1,40800,126000,44,0,0,0],["rp-0410",19,0,44700,107000,32,0,0,0],["rp-0411",19,0,45720,35000,-1,0,0,0],["rp-0412",19,1,46800,102000,-1,0,0,0],["rp-0413",19,1,49260,146000,-1,0,0,0],["rp-0414",19,0,51060,122000,-1,0,0,0],["rp-0415",19,1,52620,115000,12,0,0,0],["rp-0416",19,0,53040,54000,-1,0,0,0],["rp-0417",19,1,54000,20000,43,1,0,0],["rp-0418",19,0,59640,121000,-1,0,0,0],["rp-0419",19,0,62400,100000,3,0,0,0],["rp-0420",19,1,62640,94000,27,0,0,1],["rp-0421",19,0,66240,9000,-1,0,0,0],["rp-0422",20,1,26460,20000,15,0,0,0],["rp-0423",20,1,33720,5000,48,0,0,0],["rp-0424",20,1,34080,75000,11,0,0,0],["rp-0425",20,0,35700,144000,-1,1,0,0],["rp-0426",20,0,37920,22000,12,0,0,0],["rp-0427",20,0,38640,35000,-1,0,0,0],["rp-0428",20,1,40200,24000,-1,0,0,0],["rp-0429",20,0,41700,19000,-1,0,0,0],["rp-0430",20,0,42240,52000,24,0,0,0],["rp-0431",20,1,42360,71000,21,0,0,0],["rp-0432",20,1,46080,108000,21,0,0,0],["rp-0433",20,0,49740,93000,-1,0,0,0],["rp-0434",20,1,50580,42000,30,0,0,0],["rp-0435",20,0,52920,101000,25,0,1,0],["rp-0436",20,1,53220,95000,15,0,0,0],["rp-0437",20,0,53520,23000,-1,0,0,0],["rp-0438",20,0,55620,136000,-1,0,0,0],["rp-0439",20,1,57120,73000,45,1,0,0],["rp-0440",20,0,57600,45000,40,0,0,0],["rp-0441",20,1,58380,149000,41,0,0,0],["rp-0442",20,1,58980,135000,-1,0,0,0],["rp-0443",20,0,62640,109000,34,0,0,0],["rp-0444",20,1,63840,58000,-1,0,0,0],["rp-0445",20,0,70080,79000,7,0,0,0],["rp-0446",21,0,25380,73000,41,0,0,0],["rp-0447",21,0,25560,106000,22,1,0,0],["rp-0448",21,1,26520,94000,37,0,0,0],["rp-0449",21,1,29460,145000,20,0,0,0],["rp-0450",21,0,29880,62000,-1,1,0,0],["rp-0451",21,1,36480,70000,-1,0,0,0],["rp-0452",21,0,37920,137000,11,0,0,0],["rp-0453",21,0,41880,78000,49,0,0,0],["rp-0454",21,1,46860,147000,-1,0,0,0],["rp-0455",21,0,47280,51000,42,0,0,0],["rp-0456",21,0,52020,28000,18,0,0,0],["rp-0457",21,0,57720,135000,-1,0,0,0],["rp-0458",21,1,59520,114000,23,0,1,0],["rp-0459",21,1,59820,25000,37,0,0,0],["rp-0460",21,1,60000,12000,-1,0,0,0],["rp-0461",21,0,61260,13000,42,0,0,0],["rp-0462",21,1,61560,150000,7,0,0,0],["rp-0463",21,0,64320,145000,-1,1,0,0],["rp-0464",21,0,67320,98000,6,0,0,0],["rp-0465",21,0,69360,68000,-1,0,0,0],["rp-0466",21,0,74340,63000,44,0,0,0],["rp-0467",21,1,74580,102000,6,0,0,0],["rp-0468",21,1,74880,119000,-1,0,0,0],["rp-0469",21,0,75120,95000,-1,0,0,0],["rp-0470",22,1,25380,51000,48,0,0,0],["rp-0471",22,1,26280,147000,6,0,0,0],["rp-0472",22,1,28800,7000,34,1,0,0],["rp-0473",22,0,33360,132000,-1,0,0,0],["rp-0474",22,1,35640,62000,21,0,0,0],["rp-0475",22,1,40320,110000,-1,0,0,0],["rp-0476",22,1,41940,147000,39,0,0,0],["rp-0477",22,0,43020,5000,14,0,0,0],["rp-0478",22,0,44820,13000,16,0,0,1],["rp-0479",22,0,48840,88000,49,0,0,0],["rp-0480",22,1,48900,31000,41,1,0,0],["rp-0481",22,0,49440,37000,-1,0,0,0],["rp-0482",22,0,50400,98000,-1,0,0,0],["rp-0483",22,1,54840,64000,-1,0,0,0],["rp-0484",22,1,59880,58000,22,0,0,0],["rp-0485",22,1,65400,110000,25,1,0,0],["rp-0486",22,1,67020,139000,16,0,0,0],["rp-0487",22,1,69300,31000,-1,0,0,0],["rp-0488",22,1,72480,114000,40,0,0,0],["rp-0489",22,0,73740,122000,-1,0,0,0],["rp-0490",22,0,74160,104000,-1,0,0,0],["rp-0491",23,1,25380,91000,35,1,0,0],["rp-0492",23,1,25740,108000,13,0,0,0],["rp-0493",23,0,26160,95000,17,0,0,0],["rp-0494",23,0,27180,105000,-1,0,0,0],["rp-0495",23,1,29700,117000,39,0,0,0],["rp-0496",23,0,32700,69000,38,0,0,0],["rp-0497",23,0,35640,112000,28,0,0,0],["rp-0498",23,0,37260,12000,19,0,0,0],["rp-0499",23,0,39960,8000,4,0,0,0],["rp-0500",23,1,41820,65000,12,0,0,0],["rp-0501",23,1,43080,144000,-1,0,0,0],["rp-0502",23,0,43980,83000,-1,0,0,0],["rp-0503",23,1,45360,67000,24,0,0,0],["rp-0504",23,1,51840,25000,30,0,0,0],["rp-0505",23,1,55680,56000,0,0,0,0],["rp-0506",23,1,58020,37000,-1,0,0,0],["rp-0507",23,0,61920,16000,21,0,0,0],["rp-0508",23,1,65820,21000,9,0,0,0],["rp-0509",23,1,67800,87000,47,0,0,0],["rp-0510",23,0,69000,150000,-1,0,0,0],["rp-0511",23,0,70080,80000,33,0,0,0],["rp-0512",23,0,73140,150000,31,0,0,0],["rp-0513",23,0,74100,44000,-1,0,1,0],["rp-0514",23,1,74220,130000,10,0,0,0],["rp-0515",24,1,25620,64000,12,0,0,1],["rp-0516",24,1,28860,148000,27,0,0,0],["rp-0517",24,1,31320,62000,-1,0,0,0],["rp-0518",24,0,38880,58000,13,1,1,0],["rp-0519",24,1,39840,10000,-1,0,0,0],["rp-0520",24,0,48180,105000,22,0,0,1],["rp-0521",24,0,48720,50000,37,0,0,0],["rp-0522",24,0,50640,39000,9,0,0,0],["rp-0523",24,1,51060,32000,-1,0,0,0],["rp-0524",24,0,51180,62000,45,0,0,0],["rp-0525",24,1,51660,17000,31,0,0,0],["rp-0526",24,1,53340,71000,17,0,0,0],["rp-0527",24,0,56040,69000,26,0,0,0],["rp-0528",24,1,56760,113000,-1,0,0,0],["rp-0529",24,1,61140,16000,5,0,0,0],["rp-0530",24,0,63540,107000,-1,0,0,0],["rp-0531",24,0,63960,47000,19,0,0,0],["rp-0532",24,0,64140,137000,13,0,0,0],["rp-0533",24,0,67080,130000,27,0,0,0],["rp-0534",24,1,67140,91000,41,0,0,0],["rp-0535",24,0,69000,117000,39,0,0,0],["rp-0536",24,1,69000,67000,24,0,0,0],["rp-0537",24,1,69120,99000,23,0,0,0],["rp-0538",24,0,72720,89000,-1,0,0,0],["rp-0539",24,0,74220,110000,15,0,0,0],["rp-0540",24,0,74280,19000,-1,0,0,0],["rp-0541",25,1,27120,61000,-1,0,0,0],["rp-0542",25,0,31500,85000,39,0,0,0],["rp-0543",25,1,34140,131000,1,0,0,0],["rp-0544",25,0,36480,115000,42,0,0,0],["rp-0545",25,1,37260,139000,-1,1,0,0],["rp-0546",25,1,37740,10000,-1,0,0,0],["rp-0547",25,0,40860,74000,-1,0,0,0],["rp-0548",25,1,44100,44000,49,0,1,0],["rp-0549",25,0,45120,131000,-1,0,0,0],["rp-0550",25,1,49320,143000,-1,0,0,0],["rp-0551",25,1,49380,130000,26,0,0,0],["rp-0552",25,0,50100,24000,22,0,0,0],["rp-0553",25,0,53820,48000,15,0,0,0],["rp-0554",25,0,55140,58000,29,0,0,0],["rp-0555",25,0,55740,76000,-1,0,0,0],["rp-0556",25,1,56520,22000,-1,0,0,0],["rp-0557",25,1,59880,67000,9,0,0,0],["rp-0558",25,1,59940,124000,42,0,0,0],["rp-0559",25,1,62580,42000,-1,1,0,0],["rp-0560",25,0,62760,24000,-1,0,0,0],["rp-0561",25,0,62940,134000,-1,0,0,0],["rp-0562",25,0,66000,136000,-1,0,0,0],["rp-0563",25,1,67800,147000,-1,0,0,0],["rp-0564",25,1,72240,71000,22,0,0,0],["rp-0565",25,0,72840,147000,42,1,0,0],["rp-0566",26,1,25980,29000,-1,1,0,0],["rp-0567",26,0,28920,76000,4,0,0,0],["rp-0568",26,1,31140,4000,-1,0,0,0],["rp-0569",26,1,31500,30000,47,0,0,0],["rp-0570",26,1,35040,91000,18,0,0,0],["rp-0571",26,1,37680,86000,16,0,0,0],["rp-0572",26,1,44160,22000,3,1,0,0],["rp-0573",26,1,52680,91000,11,0,0,0],["rp-0574",26,1,53460,61000,-1,0,0,0],["rp-0575",26,0,56460,121000,19,0,0,0],["rp-0576",26,0,57960,120000,44,0,0,0],["rp-0577",26,1,59340,117000,26,1,1,0],["rp-0578",26,0,59940,35000,32,0,0,0],["rp-0579",26,0,60120,105000,8,0,0,0],["rp-0580",26,1,60300,101000,-1,0,0,0],["rp-0581",26,0,62580,87000,47,0,0,0],["rp-0582",26,0,63600,117000,10,0,0,0],["rp-0583",26,1,64080,60000,22,0,0,0],["rp-0584",26,0,74160,47000,-1,0,0,0],["rp-0585",26,0,75360,26000,0,0,0,0],["rp-0586",27,0,25200,64000,36,0,0,0],["rp-0587",27,1,26460,11000,44,0,0,0],["rp-0588",27,1,27000,53000,27,0,0,0],["rp-0589",27,1,29220,101000,4,0,0,0],["rp-0590",27,0,30300,90000,-1,0,0,0],["rp-0591",27,0,41460,136000,33,0,0,0],["rp-0592",27,0,45420,35000,18,1,0,0],["rp-0593",27,1,45600,114000,46,0,0,0],["rp-0594",27,1,48960,34000,45,0,0,0],["rp-0595",27,0,49260,123000,-1,0,0,0],["rp-0596",27,1,49620,149000,37,0,0,0],["rp-0597",27,0,50340,72000,33,0,0,0],["rp-0598",27,1,51540,44000,2,0,0,0],["rp-0599",27,1,53280,18000,23,0,0,0],["rp-0600",27,0,53520,104000,37,0,0,1],["rp-0601",27,0,55020,104000,45,1,0,0],["rp-0602",27,0,58140,22000,16,0,0,0],["rp-0603",27,0,58620,143000,-1,0,0,0],["rp-0604",27,0,59040,87000,43,0,0,0],["rp-0605",27,1,62880,92000,-1,0,0,0],["rp-0606",27,0,63540,28000,-1,0,0,0],["rp-0607",27,1,64380,47000,-1,0,0,0],["rp-0608",27,0,65520,17000,29,0,0,0],["rp-0609",27,1,72060,131000,-1,0,0,0],["rp-0610",27,1,75000,60000,-1,0,0,0],["rp-0611",28,1,30720,90000,37,0,0,0],["rp-0612",28,1,31620,45000,49,0,0,0],["rp-0613",28,1,32160,34000,38,0,0,1],["rp-0614",28,1,32220,124000,-1,0,0,0],["rp-0615",28,1,33480,95000,29,0,0,0],["rp-0616",28,0,38400,5000,-1,0,0,0],["rp-0617",28,1,42720,55000,36,0,0,0],["rp-0618",28,1,45300,125000,8,1,0,0],["rp-0619",28,0,52140,129000,15,0,0,0],["rp-0620",28,1,53220,122000,44,0,0,0],["rp-0621",28,0,57300,76000,2,1,0,0],["rp-0622",28,1,57780,89000,4,0,0,0],["rp-0623",28,0,58560,138000,-1,0,0,0],["rp-0624",28,1,65520,4000,25,0,0,0],["rp-0625",28,0,67920,89000,41,0,0,0],["rp-0626",28,1,70140,83000,-1,0,0,0],["rp-0627",28,0,72120,70000,-1,0,0,0],["rp-0628",28,0,73260,4000,-1,0,0,0],["rp-0629",28,0,75000,9000,36,0,0,0],["rp-0630",28,1,75060,32000,7,0,0,0],["rp-0631",29,1,25560,107000,20,0,0,0],["rp-0632",29,0,26640,120000,37,0,0,0],["rp-0633",29,0,28980,42000,0,0,0,0],["rp-0634",29,0,29580,80000,-1,0,0,0],["rp-0635",29,0,31200,78000,-1,0,0,0],["rp-0636",29,1,32820,48000,19,0,0,0],["rp-0637",29,0,33660,64000,-1,0,0,0],["rp-0638",29,1,34680,103000,-1,0,0,0],["rp-0639",29,0,35040,75000,43,0,0,0],["rp-0640",29,1,37980,118000,-1,0,0,0],["rp-0641",29,1,39780,138000,49,0,1,0],["rp-0642",29,0,40980,47000,9,1,0,0],["rp-0643",29,1,47940,80000,22,0,0,0],["rp-0644",29,0,50100,113000,-1,0,0,0],["rp-0645",29,0,50760,89000,40,0,0,0],["rp-0646",29,0,51840,16000,46,0,0,0],["rp-0647",29,1,59700,105000,0,0,0,0],["rp-0648",29,0,60780,150000,27,0,0,0],["rp-0649",29,1,63000,65000,-1,0,0,0],["rp-0650",29,1,65160,91000,-1,0,0,0],["rp-0651",29,1,67200,31000,-1,0,0,0],["rp-0652",29,1,67740,76000,-1,1,0,0],["rp-0653",29,0,68700,58000,-1,0,0,0],["rp-0654",29,1,70320,8000,-1,0,0,0],["rp-0655",29,1,70740,138000,40,0,0,0]]},"expected":{"earns":331,"clawbacks":12,"stamps":320,"points":2334,"refusals":{"below_minimum":116,"daily_cap":2,"excluded_phone":7,"excluded_source":31,"already_earned":0,"invoice_not_completed":10,"programme_inactive":0,"membership_inactive":0,"staff_mode":0},"members":{"0900007001":{"stamps":9,"points":63,"earns":10,"clawbacks":0},"0900007002":{"stamps":3,"points":13,"earns":1,"clawbacks":0},"0900007003":{"stamps":4,"points":28,"earns":5,"clawbacks":0},"0900007004":{"stamps":6,"points":55,"earns":5,"clawbacks":0},"0900007005":{"stamps":6,"points":41,"earns":5,"clawbacks":0},"0900007006":{"stamps":3,"points":15,"earns":6,"clawbacks":1},"0900007007":{"stamps":8,"points":61,"earns":6,"clawbacks":0},"0900007008":{"stamps":5,"points":39,"earns":7,"clawbacks":1},"0900007009":{"stamps":7,"points":55,"earns":6,"clawbacks":0},"0900007010":{"stamps":5,"points":38,"earns":7,"clawbacks":0},"0900007011":{"stamps":5,"points":30,"earns":3,"clawbacks":0},"0900007012":{"stamps":10,"points":81,"earns":10,"clawbacks":0},"0900007013":{"stamps":6,"points":46,"earns":10,"clawbacks":2},"0900007014":{"stamps":7,"points":46,"earns":7,"clawbacks":0},"0900007015":{"stamps":3,"points":11,"earns":2,"clawbacks":0},"0900007016":{"stamps":5,"points":38,"earns":6,"clawbacks":1},"0900007017":{"stamps":5,"points":36,"earns":5,"clawbacks":1},"0900007018":{"stamps":4,"points":24,"earns":5,"clawbacks":0},"0900007019":{"stamps":3,"points":22,"earns":5,"clawbacks":0},"0900007020":{"stamps":4,"points":31,"earns":7,"clawbacks":0},"0900007021":{"stamps":5,"points":41,"earns":5,"clawbacks":1},"0900007022":{"stamps":7,"points":50,"earns":9,"clawbacks":0},"0900007023":{"stamps":11,"points":87,"earns":12,"clawbacks":1},"0900007024":{"stamps":9,"points":74,"earns":8,"clawbacks":0},"0900007025":{"stamps":6,"points":32,"earns":7,"clawbacks":0},"0900007026":{"stamps":7,"points":53,"earns":6,"clawbacks":0},"0900007027":{"stamps":8,"points":55,"earns":8,"clawbacks":1},"0900007028":{"stamps":10,"points":79,"earns":9,"clawbacks":1},"0900007029":{"stamps":4,"points":24,"earns":5,"clawbacks":0},"0900007030":{"stamps":9,"points":53,"earns":9,"clawbacks":0},"0900007031":{"stamps":5,"points":43,"earns":7,"clawbacks":0},"0900007032":{"stamps":3,"points":16,"earns":2,"clawbacks":0},"0900007033":{"stamps":7,"points":48,"earns":7,"clawbacks":0},"0900007034":{"stamps":8,"points":59,"earns":7,"clawbacks":0},"0900007035":{"stamps":5,"points":32,"earns":4,"clawbacks":0},"0900007036":{"stamps":3,"points":8,"earns":2,"clawbacks":0},"0900007037":{"stamps":8,"points":52,"earns":7,"clawbacks":0},"0900007038":{"stamps":11,"points":94,"earns":11,"clawbacks":1},"0900007039":{"stamps":10,"points":80,"earns":13,"clawbacks":1},"0900007040":{"stamps":10,"points":86,"earns":10,"clawbacks":0},"0900007041":{"stamps":9,"points":80,"earns":10,"clawbacks":0},"0900007042":{"stamps":9,"points":68,"earns":8,"clawbacks":0},"0900007043":{"stamps":8,"points":61,"earns":7,"clawbacks":0},"0900007044":{"stamps":7,"points":34,"earns":5,"clawbacks":0},"0900007045":{"stamps":8,"points":64,"earns":9,"clawbacks":0},"0900007046":{"stamps":5,"points":32,"earns":5,"clawbacks":0},"0900007047":{"stamps":7,"points":65,"earns":9,"clawbacks":0},"0900007048":{"stamps":7,"points":50,"earns":6,"clawbacks":0},"0900007049":{"stamps":6,"points":41,"earns":6,"clawbacks":0},"0900007050":{"stamps":0,"points":0,"earns":0,"clawbacks":0}}}}$replay$::jsonb as doc;

insert into public.loyalty_staff_phones (tenant_id, phone)
select fx.tenant_r, r.doc -> 'dataset' -> 'phones' ->> (s.idx::integer)
from fx, replay r, jsonb_array_elements_text(r.doc -> 'dataset' -> 'staffPhoneIndexes') s (idx);

create temp table replay_members as
select p.phone, app.loyalty_join(
  fx.tenant_r,
  app.loyalty_customer_for_phone(fx.tenant_r, p.phone, timestamptz '2026-09-30 10:00+07'),
  'mini_app', fx.store_r1, null, null, timestamptz '2026-09-30 10:00+07'
) as membership_id
from fx, replay r, jsonb_array_elements_text(r.doc -> 'dataset' -> 'phones') p (phone);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, source_name, status)
select
  fx.tenant_r,
  case when (x.row ->> 2)::integer = 0 then fx.store_r1 else fx.store_r2 end,
  fx.account_r,
  x.row ->> 0,
  right(x.row ->> 0, 4),
  ((r.doc -> 'dataset' ->> 'base')::date + (x.row ->> 1)::integer)::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(secs => (x.row ->> 3)::integer),
  (r.doc -> 'dataset' ->> 'base')::date + (x.row ->> 1)::integer,
  (x.row ->> 4)::numeric,
  (x.row ->> 4)::numeric,
  (x.row ->> 4)::numeric,
  case when (x.row ->> 5)::integer >= 0 then r.doc -> 'dataset' -> 'phones' ->> ((x.row ->> 5)::integer) end,
  case when (x.row ->> 6)::integer = 1 then 'delivery-app' else 'tai-quan' end,
  case when (x.row ->> 7)::integer = 1 then 'voided' else 'completed' end::public.invoice_status
from fx, replay r, jsonb_array_elements(r.doc -> 'dataset' -> 'rows') x (row);

select is((select count(*)::int from replay_members), 50, 'the replay enrols 50 synthetic phones');
select is(
  (select count(*)::int from public.invoices where tenant_id = (select tenant_r from fx)),
  (select jsonb_array_length(doc -> 'dataset' -> 'rows') from replay),
  'and replays every synthetic invoice of the 30 days'
);

create temp table replay_run_1 as
select app.reconcile_loyalty((select tenant_r from fx), date '2026-10-01', date '2026-10-30', timestamptz '2026-10-31 06:00+07') as counts;

update public.invoices i set status = 'voided'
from replay r, jsonb_array_elements(r.doc -> 'dataset' -> 'rows') x (row)
where i.tenant_id = (select tenant_r from fx) and i.external_id = x.row ->> 0 and (x.row ->> 8)::integer = 1;

create temp table replay_nightly_1 as
select app.loyalty_nightly((select tenant_r from fx), timestamptz '2026-11-01 04:00+07') as counts;

select is(
  (select count(*)::int from public.loyalty_ledger where tenant_id = (select tenant_r from fx) and entry_kind = 'earn'),
  (select (doc -> 'expected' ->> 'earns')::int from replay),
  'the replay writes the expected number of earns'
);
select is(
  (select count(*)::int from public.loyalty_ledger where tenant_id = (select tenant_r from fx) and entry_kind = 'clawback'),
  (select (doc -> 'expected' ->> 'clawbacks')::int from replay),
  'the nightly step claws back the invoices voided after their earn'
);
select is(
  (select jsonb_object_agg(f.reason, f.n) from (select reason, count(*)::int as n from public.loyalty_refusals where tenant_id = (select tenant_r from fx) group by reason) f),
  (select jsonb_object_agg(e.key, e.value) from replay, jsonb_each(doc -> 'expected' -> 'refusals') e where e.value <> '0'::jsonb),
  'every refusal reason counts as the hand calculation'
);
select is(
  (
    select jsonb_object_agg(m.phone, jsonb_build_array(b.stamps, b.points))
    from replay_members m
    cross join lateral app.loyalty_balance(m.membership_id) b
  ),
  (select jsonb_object_agg(e.key, jsonb_build_array(e.value -> 'stamps', e.value -> 'points')) from replay, jsonb_each(doc -> 'expected' -> 'members') e),
  'each of the 50 balances equals the independent calculation'
);
select is(
  (select concat_ws(':', sum(b.stamps), sum(b.points)) from replay_members m cross join lateral app.loyalty_balance(m.membership_id) b),
  (select concat_ws(':', doc -> 'expected' ->> 'stamps', doc -> 'expected' ->> 'points') from replay),
  'and so do the totals'
);

create temp table replay_rows_before as
select (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_r from fx)) as ledger,
       (select count(*) from public.loyalty_refusals where tenant_id = (select tenant_r from fx)) as refusals,
       (select count(*) from public.stamps where tenant_id = (select tenant_r from fx)) as stamps;

select is(
  app.reconcile_loyalty((select tenant_r from fx), date '2026-10-01', date '2026-10-30', timestamptz '2026-11-01 06:00+07') ->> 'a_earned',
  '0',
  're-running the reconciliation earns nothing'
);
select is(
  app.loyalty_nightly((select tenant_r from fx), timestamptz '2026-11-01 04:00+07') ->> 'clawbacks',
  '0',
  're-running the nightly step claws back nothing'
);
select is(
  (select row(
     (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_r from fx)),
     (select count(*) from public.loyalty_refusals where tenant_id = (select tenant_r from fx)),
     (select count(*) from public.stamps where tenant_id = (select tenant_r from fx)))::text),
  (select row(ledger, refusals, stamps)::text from replay_rows_before),
  'the re-run is idempotent: no ledger, refusal or stamp row is added'
);

select * from finish();
rollback;
