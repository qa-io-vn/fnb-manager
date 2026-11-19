begin;
select plan(44);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006701'::uuid as tenant_w,
  'cccccccc-cccc-4ccc-8ccc-000000006701'::uuid as account_w,
  'ffffffff-ffff-4fff-8fff-000000006701'::uuid as store_w1,
  'ffffffff-ffff-4fff-8fff-000000006702'::uuid as store_w2,
  'ffffffff-ffff-4fff-8fff-000000006703'::uuid as store_w3,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006701'::uuid as brand_w,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006702'::uuid as brand_x,
  '99999999-9999-4999-8999-000000006701'::uuid as app_w,
  '99999999-9999-4999-8999-000000006702'::uuid as app_x,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006701'::uuid as programme_w,
  'eeeeeeee-eeee-4eee-8eee-000000006701'::uuid as staff_w,
  'eeeeeeee-eeee-4eee-8eee-000000006711'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000006712'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000006713'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-wallet-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_w, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.staff_w, false), (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)) as u (id, customer);

insert into public.tenants (id, slug, name) select tenant_w, 'customer-wallet-pgtap', 'Customer wallet pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_w, tenant_w, 'mock', 'customer-wallet', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_w1, tenant_w, account_w, 'cw-ext-1', 'cw-1', 'Synthetic store 1' from fx
union all
select store_w2, tenant_w, account_w, 'cw-ext-2', 'cw-2', 'Synthetic store 2' from fx
union all
select store_w3, tenant_w, account_w, 'cw-ext-3', 'cw-3', 'Synthetic store 3' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_w, staff_w, 'staff'::public.tenant_role, array[store_w1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_w, tenant_w, 'brand-976', 'Synthetic brand', array[store_w1, store_w2] from fx
union all
select brand_x, tenant_w, 'brand-977', 'Synthetic brand X', array[store_w3] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_w, tenant_w, brand_w, 'synthetic-wallet-app-w', 'ZALO_APP_SECRET_BRAND_976', 'active' from fx
union all
select app_x, tenant_w, brand_x, 'synthetic-wallet-app-x', 'ZALO_APP_SECRET_BRAND_977', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, stamps_per_card, welcome_stamps)
select programme_w, tenant_w, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 4, 1 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_w, 'privacy_notice', 'vi', 'privacy-cw-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', timestamptz '2026-11-01 00:00+07' from fx;

select app.zalo_customer_sign_in((select app_w from fx), 'cwuser' || n, null, ('eeeeeeee-eeee-4eee-8eee-00000000671' || n)::uuid) from generate_series(1, 3) n;
select app.customer_join(('eeeeeeee-eeee-4eee-8eee-00000000671' || n)::uuid, (select app_w from fx), 'cwuser' || n, 'Khách cwuser' || n, '09000067' || lpad(n::text, 2, '0'),
  true, false, 'privacy-cw-1', 'join-1', (select t0 from fx) - interval '1 day 1 minute', 'cw-1', 'mini_app', (select t0 from fx) - interval '1 day')
from generate_series(1, 2) n;

create temp table ids (name text primary key, id uuid);
insert into ids select 'customer_' || n, l.customer_id from generate_series(1, 2) n join app.customer_logins l on l.user_id = ('eeeeeeee-eeee-4eee-8eee-00000000671' || n)::uuid;
insert into ids select 'member_' || right(i.name, 1), m.id from ids i join public.memberships m on m.customer_id = i.id where i.name like 'customer_%';

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

create function pg_temp.claim(p_login uuid, p_store text, p_receipt text, p_amount numeric, p_date date, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_submit_claim(p_store, p_receipt, p_amount, p_date, p_at);
$$;

create function pg_temp.code(p_login uuid, p_store text, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_member_code(p_store, p_at);
$$;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_net numeric, p_receipt text)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_w, p_store, fx.account_w, 'cw-' || p_name, p_receipt, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

grant execute on function pg_temp.outcome(text), pg_temp.as_login(uuid) to authenticated, anon;

select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx)) -> 'card',
  '{"programme_name": "Synthetic programme", "display_name": "Khách cwuser1", "phone_masked": "•••• ••• 701", "member_since": "2026-11-09", "purchases": 0}'::jsonb,
  'the member card holds the programme name, the customer''s identity and the purchases (FR-CMP-19)'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx)) -> 'stamp_cards',
  jsonb_build_array(jsonb_build_object('id', (select id from ids where name = 'member_1'), 'name', 'Synthetic programme', 'stamps', 1, 'stamps_per_card', 4, 'pending', 0, 'expires_on', '2027-05-09')),
  'one stamp card with the welcome stamp and its expiry'
);
select is(
  (pg_temp.wallet((select login_1 from fx), (select t0 from fx)) -> 'history' -> 0) - 'id' - 'at',
  '{"kind": "welcome", "state": "confirmed", "stamps": 1, "points": 0, "reason": "welcome", "store_name": "Synthetic store 1", "receipt_no": null, "matched_path": "welcome"}'::jsonb,
  'the history starts with the welcome row'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 from fx)) - 'card' - 'stamp_cards' - 'history',
  '{"points": {"balance": 0, "pending": 0, "expiring": null}, "tier": null, "marketing_consent": false, "claims": [], "claims_today": 0, "claims_per_day": 3}'::jsonb,
  'no points, no tier, no marketing consent and no claim yet'
);

create temp table codes (label text primary key, answer jsonb);
insert into codes select 'first', pg_temp.code((select login_1 from fx), 'cw-1', (select t0 from fx));
select ok(
  (select answer ->> 'code' ~ '^[0-9]{6}$' and answer ->> 'qr_payload' = 'fnb-member:1:cw-1:' || (answer ->> 'code') from codes where label = 'first'),
  'a member code has six digits and its QR payload names the store'
);
select is(
  (select concat_ws('|', answer ->> 'store_code', answer ->> 'store_name',
     (answer ->> 'expires_at')::timestamptz - (answer ->> 'issued_at')::timestamptz,
     (answer ->> 'refresh_at')::timestamptz - (answer ->> 'issued_at')::timestamptz) from codes where label = 'first'),
  'cw-1|Synthetic store 1|00:02:00|00:01:00',
  'it is valid two minutes and refreshed after one'
);
select is(
  (select c.store_id = (select store_w1 from fx) and c.status = 'issued' from public.pending_checkins c
   where c.code = (select answer ->> 'code' from codes where label = 'first') and c.membership_id = (select id from ids where name = 'member_1')),
  true,
  'the code is a check-in code bound to the store'
);
select is(
  pg_temp.code((select login_1 from fx), 'cw-1', (select t0 + interval '10 seconds' from fx)) ->> 'code',
  (select answer ->> 'code' from codes where label = 'first'),
  'asking again within 30 seconds answers the same code'
);
insert into codes select 'second', pg_temp.code((select login_1 from fx), 'cw-1', (select t0 + interval '40 seconds' from fx));
select is(
  (select concat_ws('|', c.status, c.reason) from public.pending_checkins c
   where c.code = (select answer ->> 'code' from codes where label = 'first') and c.membership_id = (select id from ids where name = 'member_1')),
  'expired|replaced',
  'a new code replaces the previous one'
);
select is(pg_temp.outcome($q$ select pg_temp.code((select login_1 from fx), 'cw-404', (select t0 from fx)) $q$), '22023', 'an unknown store has no member code');
select is(pg_temp.outcome($q$ select pg_temp.code((select login_1 from fx), 'cw-3', (select t0 from fx)) $q$), '22023', 'nor a store of another brand of the tenant');

select pg_temp.invoice('i1', (select store_w1 from fx), (select t0 - interval '30 minutes' from fx), 60000, '0101');
select is(
  pg_temp.claim((select login_1 from fx), 'cw-1', '101', 60000, date '2026-11-10', (select t0 from fx)) - 'claim_id',
  '{"state": "matched", "reason": null, "claims_left_today": 2}'::jsonb,
  'a claim of a synced receipt is matched at once, leading zeros ignored'
);
select is(
  (select concat_ws('|', l.matched_path, l.stamp_delta, l.point_delta, l.pending) from public.loyalty_ledger l where l.invoice_id = (select id from ids where name = 'i1') and l.entry_kind = 'earn'),
  'C|1|6|f',
  'it earns on path C'
);
select is(
  pg_temp.claim((select login_1 from fx), 'cw-1', '0102', 55000, date '2026-11-10', (select t0 + interval '1 minute' from fx)) - 'claim_id',
  '{"state": "pending", "reason": null, "claims_left_today": 1}'::jsonb,
  'a claim of a receipt not synced yet waits'
);
select ok(
  (select 'claim' = any (r.reasons) and r.claimed_at is null from app.loyalty_fast_lane_runs r where r.store_id = (select store_w1 from fx)),
  'and asks for a fast-lane run that only a runner with LOYALTY_FAST_LANE on claims'
);
select is(
  pg_temp.claim((select login_1 from fx), 'cw-1', '0101', 60000, date '2026-11-10', (select t0 + interval '2 minutes' from fx)) - 'claim_id',
  '{"state": "rejected", "reason": "already_claimed", "claims_left_today": 0}'::jsonb,
  'a receipt claimed again is refused with its reason'
);
select is(
  pg_temp.claim((select login_1 from fx), 'cw-2', '0300', 50000, date '2026-11-10', (select t0 + interval '3 minutes' from fx)) - 'claim_id',
  '{"state": "rejected", "reason": "daily_cap", "claims_left_today": 0}'::jsonb,
  'a fourth claim on the same day is refused with the daily cap'
);
select is(pg_temp.outcome($q$ select pg_temp.claim((select login_1 from fx), 'cw-1', '01 02', 1000, null, (select t0 from fx)) $q$), '22023', 'a receipt number with a space is refused');
select is(pg_temp.outcome($q$ select pg_temp.claim((select login_1 from fx), 'cw-1', '0105', 0, null, (select t0 from fx)) $q$), '22023', 'an amount of 0 is refused');
select is(pg_temp.outcome($q$ select pg_temp.claim((select login_1 from fx), 'cw-1', '0105', 100000001, null, (select t0 from fx)) $q$), '22023', 'an amount above 100,000,000 is refused');
select is(pg_temp.outcome($q$ select pg_temp.claim((select login_1 from fx), 'cw-3', '0105', 1000, null, (select t0 from fx)) $q$), '22023', 'a store the app does not offer is refused');

select is(
  (select jsonb_agg(jsonb_build_object('state', c -> 'state', 'reason', c -> 'reason', 'receipt_no', c -> 'receipt_no', 'store_name', c -> 'store_name'))
   from jsonb_array_elements(pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) -> 'claims') c),
  '[{"state": "rejected", "reason": "daily_cap", "receipt_no": "0300", "store_name": "Synthetic store 2"},
    {"state": "rejected", "reason": "already_claimed", "receipt_no": "0101", "store_name": "Synthetic store 1"},
    {"state": "pending", "reason": null, "receipt_no": "0102", "store_name": "Synthetic store 1"},
    {"state": "matched", "reason": null, "receipt_no": "101", "store_name": "Synthetic store 1"}]'::jsonb,
  'the wallet lists the claims, newest first, with their states and reasons'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) ->> 'claims_today',
  '4',
  'every submission of the day counts, refused ones too'
);
select is(
  concat_ws('|',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) -> 'card' ->> 'purchases',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) -> 'stamp_cards' -> 0 ->> 'stamps',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) -> 'points'),
  '1|2|{"balance": 6, "pending": 0, "expiring": {"on": "2027-11-10", "points": 6}}',
  'the wallet totals follow the ledger: one purchase, two stamps, six points expiring a year after the sale'
);
select is(
  (pg_temp.wallet((select login_1 from fx), (select t0 + interval '4 minutes' from fx)) -> 'history' -> 0) - 'id' - 'at',
  '{"kind": "earn", "state": "confirmed", "stamps": 1, "points": 6, "reason": null, "store_name": "Synthetic store 1", "receipt_no": "0101", "matched_path": "receipt_claim"}'::jsonb,
  'the earn of the claim shows as confirmed through the receipt claim'
);

select pg_temp.invoice('i2', (select store_w1 from fx), (select t0 - interval '20 minutes' from fx), 55000, '102');
select is(
  (app.reconcile_loyalty((select tenant_w from fx), date '2026-11-10', date '2026-11-10', (select t0 + interval '10 minutes' from fx)) ->> 'c_matched')::integer,
  1,
  'the next reconciliation after the synthetic sync matches the waiting claim'
);
select is(
  (select c ->> 'state' from jsonb_array_elements(pg_temp.wallet((select login_1 from fx), (select t0 + interval '11 minutes' from fx)) -> 'claims') c where c ->> 'receipt_no' = '0102'),
  'matched',
  'the claim moves from pending to matched in the wallet'
);
select is(
  (select concat_ws('|', h ->> 'state', h ->> 'stamps', h ->> 'points') from jsonb_array_elements(pg_temp.wallet((select login_1 from fx), (select t0 + interval '11 minutes' from fx)) -> 'history') h
   where h ->> 'receipt_no' = '102'),
  'confirmed|1|5',
  'and its earn is confirmed'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 + interval '11 minutes' from fx)) -> 'points' -> 'expiring',
  '{"on": "2027-11-10", "points": 11}'::jsonb,
  'the points expiring on the next expiry day are counted together'
);

select pg_temp.invoice('i3', (select store_w2 from fx), (select t0 - interval '10 minutes' from fx), 70000, '0200');
select app.loyalty_earn((select id from ids where name = 'i3'), (select id from ids where name = 'member_1'), 'A', (select t0 + interval '12 minutes' from fx), true);
select is(
  (select concat_ws('|', h ->> 'state', h ->> 'matched_path', h ->> 'store_name') from jsonb_array_elements(pg_temp.wallet((select login_1 from fx), (select t0 + interval '13 minutes' from fx)) -> 'history') h
   where h ->> 'receipt_no' = '0200'),
  'pending|phone|Synthetic store 2',
  'an earn waiting for its confirmation shows as pending'
);
select is(
  concat_ws('|',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '13 minutes' from fx)) -> 'stamp_cards' -> 0 ->> 'pending',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '13 minutes' from fx)) -> 'points' ->> 'pending',
    pg_temp.wallet((select login_1 from fx), (select t0 + interval '13 minutes' from fx)) -> 'card' ->> 'purchases'),
  '1|7|2',
  'its stamp and points are pending and it is not a purchase yet'
);
select app.loyalty_clawback((select id from ids where name = 'i1'), 'invoice_voided', (select t0 + interval '14 minutes' from fx));
select is(
  (select string_agg(concat_ws(':', h ->> 'kind', h ->> 'state', h ->> 'stamps', h ->> 'reason'), ',' order by h ->> 'kind')
   from jsonb_array_elements(pg_temp.wallet((select login_1 from fx), (select t0 + interval '15 minutes' from fx)) -> 'history') h
   where h ->> 'receipt_no' = '0101'),
  'earn:reversed:1,reversal:confirmed:-1:invoice_voided',
  'a clawed-back earn shows as reversed beside its reversal'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 + interval '15 minutes' from fx)) -> 'card' ->> 'purchases',
  '1',
  'a reversed earn is no purchase'
);

select is(
  pg_temp.claim((select login_2 from fx), 'cw-1', '0900', 50000, date '2026-11-11', (select t0 from fx)) ->> 'reason',
  'outside_window',
  'a claim dated in the future is refused'
);
select is(
  pg_temp.claim((select login_2 from fx), 'cw-1', '0901', 50000, date '2026-11-06', (select t0 from fx)) ->> 'reason',
  'outside_window',
  'a claim older than the window is refused'
);
select is(
  concat_ws('|', jsonb_array_length(pg_temp.wallet((select login_2 from fx), (select t0 from fx)) -> 'claims'), jsonb_array_length(pg_temp.wallet((select login_2 from fx), (select t0 from fx)) -> 'history')),
  '2|1',
  'another member''s wallet holds only its own claims and rows'
);

set local role authenticated;
select pg_temp.as_login((select login_1 from fx));
select is((select count(*)::integer from public.receipt_claims), 4, 'a customer session reads only its own claims');
select is(
  (select count(*)::integer from public.receipt_claims where membership_id = (select id from ids where name = 'member_2')),
  0,
  'and none of another member'
);
select is(public.customer_wallet() -> 'card' ->> 'display_name', 'Khách cwuser1', 'the wallet RPC answers the session''s own wallet');
select pg_temp.as_login((select login_3 from fx));
select is(pg_temp.outcome($q$ select public.customer_member_code('cw-1') $q$), '42501', 'a visitor has no member code');
select is(pg_temp.outcome($q$ select public.customer_submit_claim('cw-1', '0102', 55000, null) $q$), '42501', 'nor sends a claim');
select set_config('request.jwt.claims', json_build_object('sub', (select staff_w from fx), 'role', 'authenticated')::text, true);
select is(pg_temp.outcome($q$ select public.customer_wallet() $q$), '42501', 'a staff session has no wallet');
reset role;

update public.memberships set status = 'suspended' where id = (select id from ids where name = 'member_2');
select is(pg_temp.outcome($q$ select pg_temp.code((select login_2 from fx), 'cw-1', (select t0 from fx)) $q$), '42501', 'a suspended membership gets no member code');

set local role anon;
select is(pg_temp.outcome($q$ select public.customer_wallet() $q$), '42501', 'anon may not call the wallet');
reset role;

select * from finish();
rollback;
