begin;
select plan(84);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006801'::uuid as tenant_s,
  'dddddddd-dddd-4ddd-8ddd-000000006802'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000006801'::uuid as account_s,
  'cccccccc-cccc-4ccc-8ccc-000000006802'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000006801'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000006802'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000006809'::uuid as store_o1,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006801'::uuid as programme_s,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006802'::uuid as programme_o,
  'eeeeeeee-eeee-4eee-8eee-000000006801'::uuid as owner_s,
  'eeeeeeee-eeee-4eee-8eee-000000006802'::uuid as manager_s1,
  'eeeeeeee-eeee-4eee-8eee-000000006803'::uuid as manager_s2,
  'eeeeeeee-eeee-4eee-8eee-000000006804'::uuid as staff_s1,
  'eeeeeeee-eeee-4eee-8eee-000000006805'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000006806'::uuid as viewer_s,
  'eeeeeeee-eeee-4eee-8eee-000000006807'::uuid as customer_login,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'staff-loyalty-' || right(u.id::text, 4) || '@example.com',
  case when u.id = fx.customer_login then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_s, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral unnest(array[fx.owner_s, fx.manager_s1, fx.manager_s2, fx.staff_s1, fx.staff_s2, fx.viewer_s, fx.customer_login]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_s, 'staff-loyalty-pgtap', 'Staff loyalty pgTAP' from fx
union all
select tenant_o, 'staff-loyalty-other-pgtap', 'Staff loyalty other pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_s, tenant_s, 'mock', 'staff-loyalty', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'staff-loyalty-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_s, account_s, 'cs-ext-1', 'cs-1', 'Synthetic store 1' from fx
union all
select store_s2, tenant_s, account_s, 'cs-ext-2', 'cs-2', 'Synthetic store 2' from fx
union all
select store_o1, tenant_o, account_o, 'cs-ext-9', 'cs-9', 'Synthetic other store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_s, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_s, 'owner', null::uuid[]), (fx.manager_s1, 'manager', array[fx.store_s1]), (fx.manager_s2, 'manager', array[fx.store_s2]),
         (fx.staff_s1, 'staff', array[fx.store_s1]), (fx.staff_s2, 'staff', array[fx.store_s2]), (fx.viewer_s, 'viewer', null::uuid[])
) as m (user_id, role, store_ids);
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at, phone, phone_linked_at)
select tenant_s, 'Nhân viên thử', 'staff', array[store_s1], 'active', staff_s1, t0 - interval '30 days', app.loyalty_normalize_phone('0900006890'), t0 - interval '30 days' from fx;
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_s, '0900006891' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_s, tenant_s, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select programme_o, tenant_o, 'Synthetic other programme', date '2026-11-01', 'below_threshold', 'active' from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone((select tenant_s from fx), '09000068' || lpad(n::text, 2, '0'), timestamptz '2026-11-01 08:00+07')
from generate_series(1, 6) n;
insert into ids
select 'customer_roster', app.loyalty_customer_for_phone((select tenant_s from fx), '0900006890', timestamptz '2026-11-01 08:00+07');
insert into ids
select 'customer_other', app.loyalty_customer_for_phone((select tenant_o from fx), '0900006801', timestamptz '2026-11-01 08:00+07');
insert into ids
select 'member_' || n, app.loyalty_join((select tenant_s from fx), (select id from ids where name = 'customer_' || n), 'mini_app', (select store_s1 from fx), null, null, timestamptz '2026-11-09 09:00+07')
from generate_series(1, 6) n;
insert into ids
select 'member_roster', app.loyalty_join((select tenant_s from fx), (select id from ids where name = 'customer_roster'), 'mini_app', (select store_s1 from fx), null, null, timestamptz '2026-11-09 09:00+07');
insert into ids
select 'member_other', app.loyalty_join((select tenant_o from fx), (select id from ids where name = 'customer_other'), 'mini_app', (select store_o1 from fx), null, null, timestamptz '2026-11-09 09:00+07');

grant select on fx, ids to authenticated, anon;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute p_statement into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.as_member(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.checkin(p_user uuid, p_store uuid, p_phone text, p_code text, p_at timestamptz, p_amount numeric default null)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_record_checkin(p_store, p_phone, p_code, p_amount, p_at);
$$;


create function pg_temp.lookup(p_user uuid, p_store uuid, p_phone text, p_at timestamptz, p_membership uuid default null)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_member_lookup(p_store, p_phone, p_membership, p_at);
$$;

create function pg_temp.request(p_user uuid, p_store uuid, p_kind text, p_member text, p_reason text, p_stamps integer, p_points integer, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_request(p_store, p_kind, (select id from ids where name = p_member), p_reason, p_stamps, p_points, p_at);
$$;

create function pg_temp.decide(p_user uuid, p_request uuid, p_decision text, p_reason text, p_at timestamptz, p_stamps integer default null, p_points integer default null)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_decide_loyalty_request(p_request, p_decision, p_reason, p_stamps, p_points, p_at);
$$;

create function pg_temp.queue(p_user uuid)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_loyalty_queue(null);
$$;

create function pg_temp.mine(p_user uuid)
returns jsonb
language sql
as $$
  select pg_temp.as_member(p_user);
  select app.staff_my_loyalty_requests();
$$;

create function pg_temp.issue(p_member text, p_store uuid, p_at timestamptz)
returns text
language sql
as $$
  select i.code from app.loyalty_issue_checkin_code((select id from ids where name = p_member), p_store, p_at) i;
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_net numeric, p_receipt text)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_s, p_store, fx.account_s, 'cs-' || p_name, p_receipt, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

grant execute on function pg_temp.outcome(text), pg_temp.as_member(uuid) to authenticated, anon;

create temp table answers (label text primary key, answer jsonb);

insert into answers select 'phone_1', pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006801', null, (select t0 from fx));
select is(
  (select answer - 'checkin_id' from answers where label = 'phone_1'),
  jsonb_build_object('state', 'pending', 'refusal', null, 'recorded_at', (select t0 from fx), 'confirm_by', (select t0 + interval '10 minutes' from fx),
    'member', jsonb_build_object('membership_id', (select id from ids where name = 'member_1'), 'phone_masked', '•••• ••• 801', 'display_name', null,
      'stamps', 2, 'stamps_per_card', 8, 'points', 0),
    'stamps_earned', 0, 'points_earned', 0),
  'staff record a member by phone; without the invoice the check-in waits with its expected confirmation time'
);
select is(
  (select concat_ws('|', c.status, c.recorded_by = (select staff_s1 from fx), c.store_id = (select store_s1 from fx), c.membership_id = (select id from ids where name = 'member_1'))
   from public.pending_checkins c where c.id = (select (answer ->> 'checkin_id')::uuid from answers where label = 'phone_1')),
  'recorded|t|t|t',
  'the check-in is recorded for the member at the staff member''s store, with the recorder'
);
select ok(
  (select 'checkin' = any (r.reasons) and r.claimed_at is null from app.loyalty_fast_lane_runs r where r.store_id = (select store_s1 from fx)),
  'a fast-lane run is requested, only recorded until a runner with LOYALTY_FAST_LANE on claims it'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006801', null, (select t0 + interval '1 minute' from fx)),
  '{"state": "refused", "refusal": "already_recorded", "text_key": "checkin.refusal.already_recorded", "checkin_id": null}'::jsonb,
  'the same member recorded again within the check-in window is refused'
);
select pg_temp.invoice('i1', (select store_s1 from fx), (select t0 + interval '5 minutes' from fx), 65000, '0001');
select is(
  (app.reconcile_loyalty((select tenant_s from fx), date '2026-11-10', date '2026-11-10', (select t0 + interval '10 minutes' from fx)) ->> 'b_matched')::integer,
  1,
  'the reconciliation after the synthetic sync matches the check-in'
);
select is(
  (select concat_ws('|', l.matched_path, l.stamp_delta, l.point_delta) from public.loyalty_ledger l
   where l.invoice_id = (select id from ids where name = 'i1') and l.entry_kind = 'earn' and l.membership_id = (select id from ids where name = 'member_1')),
  'B|1|6',
  'the staff check-in earns the synthetic invoice on path B'
);

select pg_temp.invoice('i2', (select store_s1 from fx), (select t0 + interval '19 minutes' from fx), 70000, '0002');
insert into answers select 'code_2_value', to_jsonb(pg_temp.issue('member_2', (select store_s1 from fx), (select t0 + interval '20 minutes' from fx)));
insert into answers select 'code_2', pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, (select answer #>> '{}' from answers where label = 'code_2_value'), (select t0 + interval '20 minutes 30 seconds' from fx));
select is(
  (select concat_ws('|', answer ->> 'state', answer ->> 'stamps_earned', answer ->> 'points_earned', answer ->> 'confirm_by', answer -> 'member' ->> 'stamps') from answers where label = 'code_2'),
  'matched|1|7|3',
  'the customer''s member code typed at the till is matched at once to the synced invoice'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, (select answer #>> '{}' from answers where label = 'code_2_value'), (select t0 + interval '21 minutes' from fx)) ->> 'refusal',
  'code_used',
  'a code already recorded is refused as used'
);
insert into answers select 'code_3_value', to_jsonb(pg_temp.issue('member_3', (select store_s1 from fx), (select t0 + interval '30 minutes' from fx)));
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, 'fnb-member:1:cs-1:' || (select answer #>> '{}' from answers where label = 'code_3_value'), (select t0 + interval '30 minutes 10 seconds' from fx)) ->> 'state',
  'pending',
  'the scanned QR payload of the store records the code'
);
insert into answers select 'code_4_value', to_jsonb(pg_temp.issue('member_4', (select store_s1 from fx), (select t0 + interval '31 minutes' from fx)));
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, 'fnb-member:1:cs-2:' || (select answer #>> '{}' from answers where label = 'code_4_value'), (select t0 + interval '31 minutes 10 seconds' from fx)) ->> 'refusal',
  'wrong_store',
  'a QR payload of another store is refused'
);
insert into answers select 'code_4b_value', to_jsonb(pg_temp.issue('member_4', (select store_s2 from fx), (select t0 + interval '32 minutes' from fx)));
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, (select answer #>> '{}' from answers where label = 'code_4b_value'), (select t0 + interval '32 minutes 10 seconds' from fx)) ->> 'refusal',
  'wrong_store',
  'a code issued for another store is refused at this one'
);
insert into answers select 'code_5_value', to_jsonb(pg_temp.issue('member_5', (select store_s1 from fx), (select t0 + interval '40 minutes' from fx)));
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, (select answer #>> '{}' from answers where label = 'code_5_value'), (select t0 + interval '43 minutes' from fx)),
  '{"state": "refused", "refusal": "code_expired", "text_key": "checkin.refusal.code_expired", "checkin_id": null}'::jsonb,
  'an expired member code is refused at the till'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null,
    (select lpad(n::text, 6, '0') from generate_series(0, 999999) n where not exists (select 1 from public.pending_checkins c where c.code = lpad(n::text, 6, '0')) limit 1),
    (select t0 + interval '44 minutes' from fx)) ->> 'refusal',
  'code_unknown',
  'an unknown code is refused'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006891', null, (select t0 + interval '45 minutes' from fx)) ->> 'refusal',
  'staff_phone',
  'a phone on the staff-phone list never earns'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006890', null, (select t0 + interval '45 minutes' from fx)) ->> 'refusal',
  'staff_phone',
  'nor the phone of an active staff member, even with a membership'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, pg_temp.issue('member_roster', (select store_s1 from fx), (select t0 + interval '46 minutes' from fx)), (select t0 + interval '46 minutes 5 seconds' from fx)) ->> 'refusal',
  'staff_phone',
  'nor through a member code'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006899', null, (select t0 + interval '47 minutes' from fx)) ->> 'refusal',
  'not_member',
  'a phone without a membership is refused'
);
select is(
  pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), 'abc', null, (select t0 + interval '47 minutes' from fx)) ->> 'refusal',
  'invalid_phone',
  'a phone that does not read is refused'
);
select is(pg_temp.outcome($q$ select pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006806', '123456', (select t0 from fx)) $q$), '22023', 'a check-in takes a phone or a code, not both');
select is(pg_temp.outcome($q$ select pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, null, (select t0 from fx)) $q$), '22023', 'nor neither');
select is(pg_temp.outcome($q$ select pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), null, '12ab', (select t0 from fx)) $q$), '22023', 'a malformed code is refused');
select is(pg_temp.outcome($q$ select pg_temp.checkin((select staff_s1 from fx), (select store_s1 from fx), '0900006806', null, (select t0 from fx), 0) $q$), '22023', 'an amount of 0 is refused');
select is(pg_temp.outcome($q$ select pg_temp.checkin((select staff_s2 from fx), (select store_s1 from fx), '0900006806', null, (select t0 from fx)) $q$), '42501', 'a staff member of another store cannot record a customer here');
select is(pg_temp.outcome($q$ select pg_temp.checkin((select viewer_s from fx), (select store_s1 from fx), '0900006806', null, (select t0 from fx)) $q$), '42501', 'a viewer cannot record a customer');
select is(
  pg_temp.outcome(format($q$ select app.staff_record_checkin(%L, '0900006806', null, null, %L) from (select set_config('request.jwt.claims', %L, true)) a $q$,
    (select store_s1 from fx), (select t0 from fx),
    json_build_object('sub', (select customer_login from fx), 'role', 'authenticated', 'app_metadata', json_build_object('kind', 'customer', 'tenant_id', (select tenant_s from fx)))::text)),
  '42501',
  'a customer session cannot record a customer'
);
select is(
  pg_temp.checkin((select owner_s from fx), (select store_s2 from fx), '0900006806', null, (select t0 + interval '50 minutes' from fx)) ->> 'state',
  'pending',
  'an owner records a customer at any store'
);

select is(
  (select concat_ws('|', r ->> 'found', r -> 'card' ->> 'phone_masked', r -> 'card' ->> 'stamps', r -> 'card' ->> 'points', r ->> 'business_date', r ->> 'store_name',
     jsonb_array_length(r -> 'today'), r ->> 'adjust_limit_stamps', r ->> 'adjust_limit_points')
   from pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006801', (select t0 + interval '11 minutes' from fx)) r),
  'true|•••• ••• 801|3|6|2026-11-10|Synthetic store 1|1|1|0',
  'the lookup shows a masked member card with the balance, today''s visits at the store and the adjustment limits'
);
select is(
  (pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006801', (select t0 + interval '11 minutes' from fx)) -> 'today' -> 0) - 'at',
  '{"path": "member_code", "state": "confirmed", "stamps": 1, "points": 6, "receipt_no": "0001"}'::jsonb,
  'today''s visit is the confirmed check-in with what it earned and its receipt'
);
select ok(
  pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006801', (select t0 from fx))::text !~ '900006801',
  'the lookup never shows the full phone'
);
select is(
  jsonb_array_length(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006801', (select t0 + interval '1 day' from fx)) -> 'today'),
  0,
  'the next day starts without visits'
);
select is(
  pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), null, (select t0 from fx), (select id from ids where name = 'member_2')) -> 'card' ->> 'membership_id',
  (select id::text from ids where name = 'member_2'),
  'a member is also looked up by membership'
);
select is(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), null, (select t0 from fx), (select id from ids where name = 'member_other')), '{"found": false}'::jsonb, 'never a membership of another tenant');
select is(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006899', (select t0 from fx)), '{"found": false}'::jsonb, 'a phone without a membership is not found');
select is(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006890', (select t0 from fx)), '{"found": false}'::jsonb, 'a staff phone is not looked up, even with a membership');
select is(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), 'x', (select t0 from fx)), '{"found": false}'::jsonb, 'a phone that does not read finds nobody');
select is(pg_temp.outcome($q$ select pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006801', (select t0 from fx), (select id from ids where name = 'member_1')) $q$), '22023', 'a lookup takes a phone or a membership, not both');
select is(pg_temp.outcome($q$ select pg_temp.lookup((select staff_s1 from fx), (select store_s2 from fx), '0900006801', (select t0 from fx)) $q$), '42501', 'a staff member cannot look up at another store');
select is(pg_temp.outcome($q$ select pg_temp.lookup((select viewer_s from fx), (select store_s1 from fx), '0900006801', (select t0 from fx)) $q$), '42501', 'nor can a viewer');

insert into answers select 'adjust_small', pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Bù lần ghé hôm qua', 1, 0, (select t0 from fx));
select is(
  (select concat_ws('|', answer ->> 'kind', answer ->> 'state') from answers where label = 'adjust_small'),
  'adjustment|applied',
  'an adjustment within the threshold is applied at once'
);
select is(
  (select concat_ws('|', l.entry_kind, l.stamp_delta, l.reason, l.approved_by = (select staff_s1 from fx), l.store_id = (select store_s1 from fx))
   from public.loyalty_ledger l where l.id = (select (answer ->> 'entry_id')::uuid from answers where label = 'adjust_small')),
  'adjust|1|Bù lần ghé hôm qua|t|t',
  'as a ledger adjust row with its reason and approver'
);
select is(
  (select v - 'at' from jsonb_array_elements(pg_temp.lookup((select staff_s1 from fx), (select store_s1 from fx), '0900006806', (select t0 + interval '1 minute' from fx)) -> 'today') v
   where v ->> 'path' = 'manual'),
  '{"path": "manual", "state": "confirmed", "stamps": 1, "points": 0, "receipt_no": null}'::jsonb,
  'and shows among today''s visits as a manual change'
);
insert into answers select 'adjust_big', pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Khách quên ghi nhận ba lần', 3, 0, (select t0 + interval '1 minute' from fx));
select is(
  (select concat_ws('|', answer ->> 'state', coalesce(answer ->> 'entry_id', 'none')) from answers where label = 'adjust_big'),
  'pending|none',
  'an adjustment above the threshold waits for a manager'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = (select id from ids where name = 'member_6') and l.entry_kind = 'adjust'),
  2,
  'and writes nothing to the ledger yet'
);
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'approved', null, %L) $q$, (select staff_s1 from fx), (select answer ->> 'request_id' from answers where label = 'adjust_big'), (select t0 from fx))), '42501', 'staff cannot approve it');
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'approved', null, %L) $q$, (select manager_s2 from fx), (select answer ->> 'request_id' from answers where label = 'adjust_big'), (select t0 from fx))), '42501', 'nor a manager of another store');
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'maybe', null, %L) $q$, (select manager_s1 from fx), (select answer ->> 'request_id' from answers where label = 'adjust_big'), (select t0 from fx))), '22023', 'a decision is approved or refused');
insert into answers select 'approved', pg_temp.decide((select manager_s1 from fx), (select (answer ->> 'request_id')::uuid from answers where label = 'adjust_big'), 'approved', '', (select t0 + interval '2 minutes' from fx));
select is((select concat_ws('|', answer ->> 'state', coalesce(answer ->> 'refusal', 'none')) from answers where label = 'approved'), 'approved|none', 'the store''s manager approves it');
select is(
  (select concat_ws('|', l.stamp_delta, l.reason, l.approved_by = (select manager_s1 from fx)) from public.loyalty_ledger l where l.id = (select (answer ->> 'entry_id')::uuid from answers where label = 'approved')),
  '3|Khách quên ghi nhận ba lần|t',
  'the approval writes the adjust row with the manager as approver'
);
select is(
  (select count(*)::integer from public.stamps s where s.membership_id = (select id from ids where name = 'member_6') and s.state = 'active'),
  6,
  'the stamps are credited: two welcome, one and three adjusted'
);
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'refused', 'late', %L) $q$, (select owner_s from fx), (select answer ->> 'request_id' from answers where label = 'adjust_big'), (select t0 from fx))), '55000', 'a decided request is not decided again');

insert into answers select 'dispute', pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'dispute', 'member_6', 'Khách nói chưa được cộng dấu', 1, 0, (select t0 + interval '3 minutes' from fx));
select is((select answer ->> 'state' from answers where label = 'dispute'), 'pending', 'a dispute always waits for a manager');
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'refused', null, %L) $q$, (select manager_s1 from fx), (select answer ->> 'request_id' from answers where label = 'dispute'), (select t0 from fx))), '22023', 'a refusal states its reason');
select is(
  pg_temp.decide((select manager_s1 from fx), (select (answer ->> 'request_id')::uuid from answers where label = 'dispute'), 'refused', 'Không có hóa đơn', (select t0 + interval '4 minutes' from fx)) ->> 'state',
  'refused',
  'the manager refuses the dispute with a reason'
);
select is(
  (select count(*)::integer from public.loyalty_ledger l where l.membership_id = (select id from ids where name = 'member_6') and l.entry_kind = 'adjust'),
  3,
  'a refused dispute writes nothing'
);
insert into answers select 'manager_own', pg_temp.request((select manager_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Điều chỉnh của quản lý', 5, 0, (select t0 + interval '5 minutes' from fx));
select is(pg_temp.outcome(format($q$ select pg_temp.decide(%L, %L, 'approved', null, %L) $q$, (select manager_s1 from fx), (select answer ->> 'request_id' from answers where label = 'manager_own'), (select t0 from fx))), '42501', 'nobody approves their own request');
select is(
  pg_temp.decide((select owner_s from fx), (select (answer ->> 'request_id')::uuid from answers where label = 'manager_own'), 'approved', null, (select t0 + interval '6 minutes' from fx)) ->> 'state',
  'approved',
  'the owner approves the manager''s request'
);
insert into answers select 'remove', pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Ghi nhầm một dấu', -1, 0, (select t0 + interval '7 minutes' from fx));
select is(
  (select concat_ws('|', s.state, s.closed_entry_id = (select (answer ->> 'entry_id')::uuid from answers where label = 'remove'))
   from public.stamps s where s.membership_id = (select id from ids where name = 'member_6') and s.state <> 'active'),
  'clawed_back|t',
  'a removed stamp closes the oldest active one'
);
select is(
  pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Cộng điểm', 0, 5, (select t0 + interval '8 minutes' from fx)) ->> 'state',
  'pending',
  'points wait while the points threshold is 0'
);
select is(
  pg_temp.outcome(format($q$ select app.set_loyalty_adjust_limits(%L, 1, 10) from (select pg_temp.as_member(%L)) a $q$, (select tenant_s from fx), (select manager_s1 from fx))),
  '42501',
  'a manager cannot change the limits'
);
select is(
  pg_temp.outcome(format($q$ select app.set_loyalty_adjust_limits(%L, 1, 10)::text from (select pg_temp.as_member(%L)) a $q$, (select tenant_s from fx), (select owner_s from fx))),
  '{"max_points": 10, "max_stamps": 1}',
  'the owner with every store sets them'
);
select is(
  pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'Cộng điểm', 0, 5, (select t0 + interval '9 minutes' from fx)) ->> 'state',
  'applied',
  'and a points adjustment within the new limit is applied'
);
insert into answers select 'dispute_2', pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'dispute', 'member_6', 'Thiếu một dấu hôm qua', 1, 0, (select t0 + interval '10 minutes' from fx));
insert into answers select 'dispute_2_approved', pg_temp.decide((select manager_s1 from fx), (select (answer ->> 'request_id')::uuid from answers where label = 'dispute_2'), 'approved', 'Thiếu hai dấu', (select t0 + interval '11 minutes' from fx), 2, 0);
select is(
  (select concat_ws('|', l.stamp_delta, l.reason, l.approved_by = (select manager_s1 from fx)) from public.loyalty_ledger l where l.id = (select (answer ->> 'entry_id')::uuid from answers where label = 'dispute_2_approved')),
  '2|Thiếu một dấu hôm qua|t',
  'the manager approves a dispute with the stamps they decide'
);
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjust', 'member_6', 'x', 1, 0, (select t0 from fx)) $q$), '22023', 'a request is an adjustment or a dispute');
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_other', 'x', 1, 0, (select t0 from fx)) $q$), '22023', 'a membership of another tenant is refused');
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', '  ', 1, 0, (select t0 from fx)) $q$), '22023', 'a request states its reason');
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'x', 0, 0, (select t0 from fx)) $q$), '22023', 'an adjustment moves something');
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s1 from fx), (select store_s1 from fx), 'dispute', 'member_6', 'x', -1, 0, (select t0 from fx)) $q$), '22023', 'a dispute never takes stamps');
select is(pg_temp.outcome($q$ select pg_temp.request((select staff_s2 from fx), (select store_s1 from fx), 'adjustment', 'member_6', 'x', 1, 0, (select t0 from fx)) $q$), '42501', 'a staff member of another store records no request here');

select pg_temp.invoice('i4', (select store_s1 from fx), (select t0 + interval '29 minutes 10 seconds' from fx), 48000, '0004');
select pg_temp.invoice('i5', (select store_s1 from fx), (select t0 + interval '31 minutes 10 seconds' from fx), 52000, '0005');
select is(
  (app.reconcile_loyalty((select tenant_s from fx), date '2026-11-10', date '2026-11-10', (select t0 + interval '50 minutes' from fx)) ->> 'b_queued')::integer,
  1,
  'a check-in without an amount and two invoices in its window goes to the manager queue'
);
select is(
  (select string_agg(i ->> 'kind', ',' order by i ->> 'kind') from jsonb_array_elements(pg_temp.queue((select manager_s1 from fx))) i),
  'adjustment,match',
  'the store''s manager sees the pending request of another member of staff and the match to resolve'
);
select is(
  (select jsonb_build_object('path', i -> 'match' ->> 'path', 'candidates', jsonb_array_length(i -> 'match' -> 'candidates'), 'receipts',
     (select string_agg(c ->> 'receipt_no', ',' order by c ->> 'receipt_no') from jsonb_array_elements(i -> 'match' -> 'candidates') c),
     'phone_masked', i ->> 'phone_masked')
   from jsonb_array_elements(pg_temp.queue((select manager_s1 from fx))) i where i ->> 'kind' = 'match'),
  '{"path": "member_code", "candidates": 2, "receipts": "0004,0005", "phone_masked": "•••• ••• 803"}'::jsonb,
  'the match item carries its path, its candidate invoices and the masked phone'
);
select is(
  (select concat_ws('|', i ->> 'requested_by_name', i ->> 'reason', i ->> 'stamps', i ->> 'points', i ->> 'phone_masked')
   from jsonb_array_elements(pg_temp.queue((select manager_s1 from fx))) i where i ->> 'kind' = 'adjustment'),
  'Nhân viên thử|Cộng điểm|0|5|•••• ••• 806',
  'the request item names the requester from the roster'
);
select is(jsonb_array_length(pg_temp.queue((select owner_s from fx))), 2, 'the owner sees the same queue');
select is(pg_temp.queue((select staff_s1 from fx)), '[]'::jsonb, 'staff have no manager queue');
select is(pg_temp.queue((select manager_s2 from fx)), '[]'::jsonb, 'a manager of another store sees none of it');
select is(
  (select string_agg(r ->> 'state', ',' order by r ->> 'created_at', r ->> 'state') from jsonb_array_elements(pg_temp.mine((select staff_s1 from fx))) r),
  'applied,approved,refused,applied,pending,applied,approved',
  'a member of staff sees their own requests with their states'
);
select is(
  (select concat_ws('|', r ->> 'decision_reason', r ->> 'store_name', r ->> 'phone_masked') from jsonb_array_elements(pg_temp.mine((select staff_s1 from fx))) r where r ->> 'state' = 'refused'),
  'Không có hóa đơn|Synthetic store 1|•••• ••• 806',
  'with the reason of a refusal'
);
select is(jsonb_array_length(pg_temp.mine((select manager_s2 from fx))), 0, 'and nobody sees another''s requests');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('staff_record_checkin', 'staff_member_lookup', 'staff_request', 'staff_decide_loyalty_request', 'staff_loyalty_queue', 'staff_my_loyalty_requests', 'set_loyalty_adjust_limits')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
  7,
  'the seven staff RPCs act only for a signed-in member'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('staff_record_checkin', 'staff_member_lookup', 'staff_request', 'staff_decide_loyalty_request', 'staff_loyalty_queue', 'staff_my_loyalty_requests',
       'set_loyalty_adjust_limits', 'loyalty_is_staff_phone', 'loyalty_member_for_phone', 'loyalty_text_key', 'loyalty_masked_phone', 'loyalty_member_summary',
       'loyalty_apply_adjustment', 'staff_checkin_refusal', 'loyalty_requester_name')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'their app functions run only behind the RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'app.loyalty_requests', 'select') and not has_table_privilege('service_role', 'app.loyalty_requests', 'select'),
  'the requests are read only through the functions'
);

set local role authenticated;
select pg_temp.as_member((select staff_s1 from fx));
select is(public.staff_member_lookup((select store_s1 from fx), '0900006801') ->> 'found', 'true', 'the lookup RPC answers a staff member of the store');
select is(pg_temp.outcome(format($q$ select public.staff_record_checkin(%L, '0900006801') $q$, (select store_s2 from fx))), '42501', 'the check-in RPC refuses another store');
select is((select count(*)::integer from public.memberships), 0, 'staff still read no membership directly');
reset role;

select * from finish();
rollback;
