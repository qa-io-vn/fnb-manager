-- ADR-047: a credit is valid through the end of its anniversary day and is spendable until that instant,
-- not until the nightly row. SQL as the unit under test: app.loyalty_credit_expires_at, the writers of an
-- expiry (app.loyalty_earn, app.bill_earn, app.loyalty_join, app.loyalty_apply_adjustment, app.loyalty_confirm,
-- app.bill_confirm), app.loyalty_balance at a moment, app.redeem_coupon and app.loyalty_apply_adjustment in the
-- midnight-to-nightly-run window (app.loyalty_expire_membership), app.customer_wallet and
-- app.customer_coupons, and the data move of migration 20261123170000.
--
-- Techniques (ISTQB):
--   * Boundary value analysis: the stored expiry exactly at the anniversary midnight, one second before and
--     after; month ends (31 August plus six months, 31 January plus one month), 29 February plus twelve
--     months, a sale at 00:30 and one at 23:30 local, 31 December plus one month.
--   * Equivalence partitioning: the hours of a sale (02:00, 09:00, 23:30 of one day share one expiry); the
--     writers of a credit (an earn, a bill, a welcome, an adjustment, a confirmation).
--   * State transition testing: valid -> ended (out of the balance) -> expired by the nightly row; a hold in
--     the window that first writes the ended credit's row.
--   * Negative tests: in the window a hold or a debit that needs the ended credit is refused and writes
--     nothing.
--   * Boundary values of G-43: a legacy ledger at -1, then 0 and 1, and the wallet at 0, 0 and 1.
--   * Security: the new functions are closed to anon and authenticated; the wallet gives dates, never a time
--     of day, and the expire rows carry no phone.
-- Every moment is explicit; phones are synthetic.
begin;
select plan(37);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024301'::uuid as tenant_v,
  'cccccccc-cccc-4ccc-8ccc-000000024301'::uuid as account_v,
  'ffffffff-ffff-4fff-8fff-000000024301'::uuid as store_v,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000024301'::uuid as brand_v,
  '99999999-9999-4999-8999-000000024301'::uuid as app_v,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024301'::uuid as programme_v,
  'eeeeeeee-eeee-4eee-8eee-000000024311'::uuid as login_w;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select login_w, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'valid-through-2431@example.com',
  jsonb_build_object('kind', 'customer', 'tenant_id', tenant_v, 'customer_id', null)
from fx;
insert into public.tenants (id, slug, name, country_code) select tenant_v, 'valid-through-pgtap', 'Valid through pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_v, tenant_v, 'mock', 'valid-through', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) select store_v, tenant_v, account_v, 'vt-ext-1', 'vt-1', 'Synthetic store' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_v, tenant_v, 'brand-243', 'Synthetic brand', array[store_v] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_v, tenant_v, brand_v, 'synthetic-valid-through-app', 'ZALO_APP_SECRET_BRAND_243', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, earning_invoices_per_phone_per_day)
select programme_v, tenant_v, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 20 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_v, 'privacy_notice', 'vi', 'privacy-vt-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', timestamptz '2026-01-01 00:00+07' from fx;

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_v, store_v, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], timestamptz '2026-01-01 00:00+07' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_v, store_v, k, 'Synthetic entry ' || k, null, 'discount'::public.einvoice_display
from fx cross join unnest(array['vt-one-stamp', 'vt-two-stamps', 'vt-six-points']) k;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_v, programme_v, v.k, 'Synthetic reward ' || v.k, 'free_item'::public.coupon_reward_kind, null::numeric, v.s, v.p, null::uuid[], 'active'::public.coupon_status
from fx cross join (values ('vt-one-stamp', 1, 0), ('vt-two-stamps', 2, 0), ('vt-six-points', 0, 6)) v (k, s, p);

create temp table ids (name text primary key, id uuid);

-- The wallet member joins through the Mini App; the others through app.loyalty_join.
select app.zalo_customer_sign_in((select app_v from fx), 'vtuser1', null, (select login_w from fx));
select app.customer_join((select login_w from fx), (select app_v from fx), 'vtuser1', 'Khách vtuser1', '0900' || '243101',
  true, false, 'privacy-vt-1', 'join-1', timestamptz '2026-05-01 08:59+07', 'vt-1', 'mini_app', timestamptz '2026-05-01 09:00+07');
insert into ids select 'wallet', m.id from app.customer_logins l join public.memberships m on m.customer_id = l.customer_id where l.user_id = (select login_w from fx);
insert into ids
select v.name, app.loyalty_join(fx.tenant_v, app.loyalty_customer_for_phone(fx.tenant_v, '0900' || v.phone), 'mini_app', fx.store_v, null, null, timestamptz '2026-05-01 09:00+07')
from fx cross join (values ('w_early', '243102'), ('w_mid', '243103'), ('w_late', '243104'), ('stamps', '243105'), ('points', '243106'), ('debit', '243107'), ('pend', '243108'), ('bill', '243109'), ('adj', '243110')) v (name, phone);

create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create function pg_temp.local_time(p_at timestamptz) returns text language sql as $$ select to_char(p_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') $$;

create function pg_temp.earn(p_member text, p_sold timestamptz, p_pending boolean default false)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_v, fx.store_v, fx.account_v, 'vt-' || p_member || '-' || extract(epoch from p_sold)::bigint, '1', p_sold, app.store_business_date(fx.store_v, p_sold), 60000, 60000, 60000
    from fx
    returning id
  )
  select e.entry_id from inserted cross join lateral app.loyalty_earn(inserted.id, pg_temp.id(p_member), 'A', p_sold + interval '5 minutes', p_pending) e;
$$;

create function pg_temp.bal_at(p_member text, p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id(p_member), p_at) b;
$$;

create function pg_temp.hold(p_member text, p_reward text, p_at timestamptz)
returns text
language sql
as $$
  select coalesce(r ->> 'state', r ->> 'refusal')
  from (select app.redeem_coupon(pg_temp.id(p_member), (select c.id from public.coupons c where c.reward_key = p_reward), (select store_v from fx), p_at) as r) x;
$$;

create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'error:' || sqlstate;
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

create function pg_temp.wallet(p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login((select login_w from fx));
  select app.customer_wallet(p_at);
$$;

create function pg_temp.coupon(p_reward text, p_at timestamptz)
returns text
language sql
as $$
  select pg_temp.as_login((select login_w from fx));
  select concat_ws(':', c.affordable, c.stamps_short, c.points_short, coalesce(c.unavailable_reason, '-'))
  from app.customer_coupons('vt-1', p_at) c where c.reward_key = p_reward;
$$;

-- A. The end of the anniversary day ------------------------------------------------------------------------
select is(
  (select string_agg(pg_temp.local_time(app.loyalty_credit_expires_at(v.sold, v.months, 'Asia/Ho_Chi_Minh')), ',' order by v.n)
   from (values
     (1, timestamptz '2026-05-19 02:00+07', 6), (2, timestamptz '2026-05-19 09:00+07', 6), (3, timestamptz '2026-05-19 23:30+07', 6),
     (4, timestamptz '2026-05-20 00:30+07', 6), (5, timestamptz '2026-08-31 12:00+07', 6), (6, timestamptz '2027-08-31 12:00+07', 6),
     (7, timestamptz '2028-02-29 12:00+07', 12), (8, timestamptz '2026-12-31 23:59+07', 1), (9, timestamptz '2027-01-31 08:00+07', 1),
     (10, timestamptz '2026-10-31 23:45+07', 12)
   ) v (n, sold, months)),
  '2026-11-20 00:00:00,2026-11-20 00:00:00,2026-11-20 00:00:00,2026-11-21 00:00:00,2027-03-01 00:00:00,2028-03-01 00:00:00,2029-03-01 00:00:00,2027-02-01 00:00:00,2027-03-01 00:00:00,2027-11-01 00:00:00',
  'boundary values: the same day''s sales end together; 00:30 counts the local date; 31 August + 6 months is valid through 28 February (29 in a leap year), 29 February + 12 months through 28 February, 31 January + 1 month through 28 February'
);
select is(
  (select string_agg(to_char(((app.loyalty_credit_expires_at(v.sold, 6, 'Asia/Ho_Chi_Minh') - interval '1 microsecond') at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'), ',' order by v.sold)
   from (values (timestamptz '2026-05-19 09:00+07'), (timestamptz '2026-08-31 12:00+07')) v (sold)),
  '2026-11-19,2027-02-28',
  'the last valid day is the local date of the moment before the expiry: valid through 19 November and through 28 February'
);

-- B. Every writer of an expiry uses it --------------------------------------------------------------------
insert into ids values
  ('e_early', pg_temp.earn('w_early', timestamptz '2026-05-19 02:00+07')),
  ('e_mid', pg_temp.earn('w_mid', timestamptz '2026-05-19 09:00+07')),
  ('e_late', pg_temp.earn('w_late', timestamptz '2026-05-19 23:30+07'));
select is(
  (select string_agg(pg_temp.local_time(l.expires_at) || '/' || (select pg_temp.local_time(s.expires_at) from public.stamps s where s.earn_entry_id = l.id), ',' order by l.occurred_at)
   from public.loyalty_ledger l where l.id in (pg_temp.id('e_early'), pg_temp.id('e_mid'), pg_temp.id('e_late'))),
  '2027-05-20 00:00:00/2026-11-20 00:00:00,2027-05-20 00:00:00/2026-11-20 00:00:00,2027-05-20 00:00:00/2026-11-20 00:00:00',
  'equivalence partitions: app.loyalty_earn gives the points and the stamp of sales at 02:00, 09:00 and 23:30 one expiry each'
);
select app.loyalty_apply_adjustment(pg_temp.id('adj'), (select store_v from fx), 1, 5, 'synthetic credit', null, timestamptz '2026-07-14 16:20+07');
select is(
  (select pg_temp.local_time(l.expires_at) || '/' || (select pg_temp.local_time(s.expires_at) from public.stamps s where s.earn_entry_id = l.id)
   from public.loyalty_ledger l where l.membership_id = pg_temp.id('adj') and l.entry_kind = 'adjust'),
  '2027-07-15 00:00:00/2027-01-15 00:00:00',
  'app.loyalty_apply_adjustment: a credit of 14 July at 16:20 is valid through 14 July next year (points) and 14 January (stamps)'
);
update public.loyalty_programmes set welcome_stamps = 1 where id = (select programme_v from fx);
insert into ids select 'welcome', app.loyalty_join(fx.tenant_v, app.loyalty_customer_for_phone(fx.tenant_v, '0900' || '243111'), 'mini_app', fx.store_v, null, null, timestamptz '2026-07-14 16:20+07') from fx;
update public.loyalty_programmes set welcome_stamps = 0 where id = (select programme_v from fx);
select is(
  (select pg_temp.local_time(s.expires_at) from public.stamps s where s.membership_id = pg_temp.id('welcome')),
  '2027-01-15 00:00:00',
  'app.loyalty_join: a welcome stamp is valid through the end of the day six months on'
);
insert into ids values ('e_pend', pg_temp.earn('pend', timestamptz '2026-05-19 09:00+07', true));
select app.loyalty_confirm(pg_temp.id('e_pend'), null, timestamptz '2026-05-21 15:00+07');
select is(
  (select pg_temp.local_time(c.expires_at) from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = pg_temp.id('e_pend'))
    || '/' || (select pg_temp.local_time(s.expires_at) from public.stamps s where s.earn_entry_id = pg_temp.id('e_pend')),
  '2027-05-22 00:00:00/2026-11-22 00:00:00',
  'app.loyalty_confirm: the clock of a pending earn starts at the end of the day of its confirmation (ADR-046 with ADR-047)'
);
insert into public.bill_captures (tenant_id, store_id, membership_id, source, business_date, bill_no, bill_key, total, state, confirm_by)
select tenant_v, store_v, pg_temp.id('bill'), 'staff_scan', date '2026-07-14', 'VT-1', app.bill_key('VT-1'), 60000, 'awaiting_customer', now() + interval '1 day' from fx;
select app.bill_earn((select b.id from public.bill_captures b where b.bill_no = 'VT-1' and b.tenant_id = (select tenant_v from fx)), true, timestamptz '2026-07-14 16:20+07');
select app.bill_confirm((select b.id from public.bill_captures b where b.bill_no = 'VT-1' and b.tenant_id = (select tenant_v from fx)), null, timestamptz '2026-07-15 08:00+07');
select is(
  (select pg_temp.local_time(e.expires_at) || '/' || pg_temp.local_time(c.expires_at) || '/' || (select pg_temp.local_time(s.expires_at) from public.stamps s where s.earn_entry_id = e.id)
   from public.loyalty_ledger e join public.loyalty_ledger c on c.source_entry_id = e.id and c.entry_kind = 'confirm'
   where e.membership_id = pg_temp.id('bill') and e.entry_kind = 'earn'),
  '2027-07-15 00:00:00/2027-07-16 00:00:00/2027-01-16 00:00:00',
  'app.bill_earn and app.bill_confirm: the bill''s earn ends at the end of its day, its clock restarts at the end of the day of the confirmation'
);

-- C. Spendable until the instant: the midnight-to-nightly-run window ----------------------------------------
select is(
  pg_temp.bal_at('w_late', timestamptz '2026-11-19 23:59:59+07') || ' ' || pg_temp.bal_at('w_late', timestamptz '2026-11-20 00:00:00+07')
    || ' ' || pg_temp.bal_at('w_late', timestamptz '2026-11-20 00:00:01+07'),
  '1:6 0:6 0:6',
  'boundary values: the stamp sold at 23:30 is in the balance one second before its anniversary midnight, not at it nor a second after'
);
select is(
  (select count(*)::int from app.redemption_spendable_stamps(pg_temp.id('w_early'), timestamptz '2026-11-19 23:59:59+07'))
    || ':' || (select count(*)::int from app.redemption_spendable_stamps(pg_temp.id('w_early'), timestamptz '2026-11-20 00:00:00+07')),
  '1:0',
  'and so is the stamp sold at 02:00: spendable to the last second of its day'
);
select is(
  (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('w_mid'), null) b) || ' '
    || (select count(*) from public.loyalty_ledger l where l.membership_id = pg_temp.id('w_mid') and l.entry_kind = 'expire'),
  '1:6 0',
  'in the window no expire row exists yet and the ledger rows alone still hold the stamp'
);
select is(
  app.loyalty_expire((select tenant_v from fx), timestamptz '2026-11-20 04:00+07') ->> 'stamps',
  '3',
  'the nightly run of 04:00 writes the three stamps together'
);
select is(
  pg_temp.bal_at('w_mid', timestamptz '2026-11-20 04:00+07') || ' ' || (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('w_mid'), null) b),
  '0:6 0:6',
  'after the run the balance at the moment and the ledger rows agree'
);

-- A hold in the window: the stamp that ended is not spendable; a hold that is accepted first writes its row.
insert into ids values
  ('s1', pg_temp.earn('stamps', timestamptz '2026-05-19 09:00+07')),
  ('s2', pg_temp.earn('stamps', timestamptz '2026-06-10 09:00+07'));
create temp table rows_before as select count(*) as n from public.loyalty_ledger where membership_id = pg_temp.id('stamps');
select is(
  pg_temp.hold('stamps', 'vt-two-stamps', timestamptz '2026-12-01 09:00+07') || ' ' || ((select count(*) from public.loyalty_ledger where membership_id = pg_temp.id('stamps')) - (select n from rows_before)),
  'insufficient_stamps 0',
  'negative test: once the May stamp ended, a reward of two stamps is refused although the ledger rows still count two, and nothing is written'
);
select is(
  pg_temp.hold('stamps', 'vt-one-stamp', timestamptz '2026-12-01 09:00+07'),
  'held',
  'a reward of one stamp takes the June stamp, still valid'
);
select is(
  (select string_agg(concat_ws(':', l.entry_kind, l.stamp_delta, pg_temp.local_time(l.occurred_at)), ',' order by l.occurred_at, l.entry_kind desc)
   from public.loyalty_ledger l where l.membership_id = pg_temp.id('stamps') and l.entry_kind in ('expire', 'redeem')),
  'expire:-1:2026-12-01 09:00:00,redeem:-1:2026-12-01 09:00:00',
  'state transition: the accepted hold first wrote the ended stamp''s expire row at its moment, then its own row'
);
select is(
  (select string_agg(s.state::text, ',' order by s.earned_at) from public.stamps s where s.membership_id = pg_temp.id('stamps')),
  'expired,redeemed',
  'the May stamp is closed as expired, the June stamp as redeemed'
);

-- Points: a hold in the window spends the June points, not the May points that ended.
insert into ids values
  ('p1', pg_temp.earn('points', timestamptz '2026-05-19 09:00+07')),
  ('p2', pg_temp.earn('points', timestamptz '2026-06-10 09:00+07'));
select app.loyalty_expire_membership(pg_temp.id('points'), timestamptz '2026-12-01 04:00+07');
select is(
  pg_temp.bal_at('points', timestamptz '2027-05-20 01:00+07'),
  '0:6',
  'in the window of 2027-05-20 the six May points are out, the six June points are there'
);
select is(pg_temp.hold('points', 'vt-six-points', timestamptz '2027-05-20 01:00+07'), 'held', 'a reward of six points is held');
select is(
  (select string_agg(concat_ws(':', l.entry_kind, l.point_delta), ',' order by l.entry_kind desc)
   from public.loyalty_ledger l where l.membership_id = pg_temp.id('points') and l.occurred_at = timestamptz '2027-05-20 01:00+07'),
  'expire:-6,redeem:-6',
  'the ended May points got their expire row first, so the hold is counted against the June points'
);
select is(
  (app.loyalty_expire_membership(pg_temp.id('points'), timestamptz '2027-06-11 04:00+07') ->> 'points') || ' ' || (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('points'), null) b),
  '0 0:0',
  'at the June credit''s own end nothing is left to expire: the member spent exactly what was valid'
);

-- A manual debit in the window.
insert into ids values
  ('d1', pg_temp.earn('debit', timestamptz '2026-05-19 09:00+07')),
  ('d2', pg_temp.earn('debit', timestamptz '2026-06-10 09:00+07'));
select is(
  pg_temp.try($$select app.loyalty_apply_adjustment(pg_temp.id('debit'), (select store_v from fx), -2, 0, 'synthetic correction', null, timestamptz '2026-11-20 01:00+07')$$)
    || ' ' || pg_temp.try($$select app.loyalty_apply_adjustment(pg_temp.id('debit'), (select store_v from fx), -1, 0, 'synthetic correction', null, timestamptz '2026-11-20 01:00+07')$$),
  'error:22023 ok',
  'negative test: in the window a debit of two stamps is refused (one is valid) and a debit of one is taken'
);
select is(
  (select string_agg(s.state::text, ',' order by s.earned_at) from public.stamps s where s.membership_id = pg_temp.id('debit'))
    || ' ' || (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('debit'), null) b),
  'expired,clawed_back 0:12',
  'the debit took the June stamp, still valid; the ended May stamp got its expire row first'
);

-- D. The wallet and the reward list read the instant -----------------------------------------------------
insert into ids values
  ('wa1', pg_temp.earn('wallet', timestamptz '2026-05-19 09:00+07')),
  ('wa2', pg_temp.earn('wallet', timestamptz '2026-06-10 09:00+07'));
select is(
  (select concat_ws('|', w -> 'stamp_cards' -> 0 ->> 'stamps', w -> 'stamp_cards' -> 0 ->> 'valid_through', w -> 'stamp_cards' -> 0 ->> 'expires_on', w -> 'points' ->> 'balance',
     w -> 'points' -> 'expiring' ->> 'points', w -> 'points' -> 'expiring' ->> 'valid_through')
   from (select pg_temp.wallet(timestamptz '2026-11-19 23:59:59+07') as w) x),
  '2|2026-11-19|2026-11-19|12|6|2027-05-19',
  'the wallet one second before midnight: two stamps, the next stamp valid through 19 November (the date, under both keys)'
);
select is(
  (select concat_ws('|', w -> 'stamp_cards' -> 0 ->> 'stamps', w -> 'stamp_cards' -> 0 ->> 'valid_through', w -> 'stamp_cards' -> 0 ->> 'expires_at')
   from (select pg_temp.wallet(timestamptz '2026-11-20 00:00:00+07') as w) x),
  '1|2026-12-10|2026-12-10T17:00:00+00:00',
  'at midnight, before any run: one stamp, valid through 10 December, ending at the instant given as expires_at'
);
select is(
  pg_temp.coupon('vt-two-stamps', timestamptz '2026-11-19 23:59:59+07') || ' ' || pg_temp.coupon('vt-two-stamps', timestamptz '2026-11-20 00:00:00+07'),
  't:0:0:- f:1:0:insufficient_stamps',
  'the reward list of the Mini App decides with the instant: two stamps are enough at 23:59:59, one short at midnight'
);
select is(
  (select concat_ws('|', w -> 'points' ->> 'balance', w -> 'points' -> 'expiring' ->> 'points', w -> 'points' -> 'expiring' ->> 'valid_through')
   from (select pg_temp.wallet(timestamptz '2027-05-19 12:00+07') as w) x),
  '12|6|2027-05-19',
  'on the last day: twelve points, six of them valid through today'
);
select is(
  (select concat_ws('|', w -> 'points' ->> 'balance', w -> 'points' -> 'expiring' ->> 'points', w -> 'points' -> 'expiring' ->> 'valid_through')
   from (select pg_temp.wallet(timestamptz '2027-05-20 01:00+07') as w) x),
  '6|6|2027-06-10',
  'in the window: the six ended points are out of the balance and not announced again; the next six are valid through 10 June'
);

-- E. The data move of 20261123170000 ---------------------------------------------------------------------
select is(
  (select count(*)::int from public.loyalty_ledger l join public.tenants t on t.id = l.tenant_id
   where l.expires_at > now() and l.entry_kind in ('earn', 'adjust', 'confirm')
     and l.expires_at <> ((l.expires_at at time zone t.timezone)::date::timestamp at time zone t.timezone))
  + (select count(*)::int from public.stamps s join public.tenants t on t.id = s.tenant_id
     where s.expires_at > now() and s.state in ('active', 'redeemed')
       and s.expires_at <> ((s.expires_at at time zone t.timezone)::date::timestamp at time zone t.timezone)),
  0,
  'after the data move every credit not yet expired, of every tenant, ends at a local midnight'
);
select is(
  (select string_agg(concat_ws('>', pg_temp.local_time(v.old_expiry), pg_temp.local_time(v.moved), v.moved - v.old_expiry), ',' order by v.old_expiry)
   from (
     select o.old_expiry, (((o.old_expiry at time zone 'Asia/Ho_Chi_Minh')::date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as moved
     from (values (timestamptz '2027-11-19 08:00:40+07'), (timestamptz '2027-11-19 00:00:01+07'), (timestamptz '2027-11-19 23:59:59+07')) o (old_expiry)
   ) v),
  '2027-11-19 00:00:01>2027-11-20 00:00:00>23:59:59,2027-11-19 08:00:40>2027-11-20 00:00:00>15:59:20,2027-11-19 23:59:59>2027-11-20 00:00:00>00:00:01',
  'boundary values of the move (the migration''s expression): a credit ending on 19 November moves to its end, later by under 24 hours and never earlier'
);

-- F. Security ---------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'app.loyalty_credit_expires_at(timestamptz, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_credit_expires_at(timestamptz, integer, text)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_expire_membership(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_expire_membership(uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.loyalty_expire_membership(uuid, timestamptz)', 'execute'),
  'security: the new functions are closed to anon and authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.loyalty_balance(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_balance(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.redeem_coupon(uuid, uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.customer_wallet(timestamptz)', 'execute'),
  'security: the replaced functions keep their grants: anon reads no balance, the cores stay behind their RPCs'
);
select is(
  (select count(*)::int from (select pg_temp.wallet(timestamptz '2027-05-19 12:00+07') as w) x
   where (w -> 'stamp_cards' -> 0 ->> 'valid_through') !~ '^\d{4}-\d{2}-\d{2}$'
      or (w -> 'points' -> 'expiring' ->> 'valid_through') !~ '^\d{4}-\d{2}-\d{2}$'
      or (w -> 'points' -> 'expiring' ->> 'on') !~ '^\d{4}-\d{2}-\d{2}$'),
  0,
  'security: the wallet states a date, never a time of day, for what it shows the customer'
);
select is(
  (select count(*)::int from public.loyalty_ledger l
   where l.tenant_id = (select tenant_v from fx) and l.entry_kind = 'expire'
     and (l.invoice_id is not null or l.approved_by is not null or l.reason is distinct from 'expired')),
  0,
  'security: an expire row written in the window names no invoice and no approver, only the reason expired'
);
select is(
  (select count(*)::int from public.loyalty_ledger l where l.tenant_id = (select tenant_v from fx) and l.reason ~ '(\+?84|0)[1-9][0-9]{8,9}'),
  0,
  'security: no phone in any reason written'
);


-- G. G-43 with ADR-046 (4): the wallet's greatest(0, ...) is a safety net for rows written before ADR-046. A
-- legacy debit row (inserted directly, as an old clawback left it) before the member's first earn puts the
-- ledger at -1 stamp and -1 point; the wallet shows 0, then 0 and 1 as credits come in (boundary values -1, 0, 1).
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, reason, occurred_at)
select tenant_v, programme_v, pg_temp.id('wallet'), store_v, 'adjust', -1, -1, 'legacy debit', timestamptz '2026-05-02 10:00+07' from fx;
select is(
  (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('wallet'), timestamptz '2026-05-02 11:00+07') b)
    || ' ' || (select concat_ws(':', w -> 'stamp_cards' -> 0 ->> 'stamps', w -> 'points' ->> 'balance') from (select pg_temp.wallet(timestamptz '2026-05-02 11:00+07') as w) x),
  '-1:-1 0:0',
  'boundary value -1: the ledger says -1 stamp and -1 point, the wallet shows 0 and 0'
);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, reason, occurred_at)
select tenant_v, programme_v, pg_temp.id('wallet'), store_v, 'adjust', 1, 1, 'synthetic credit', timestamptz '2026-05-02 12:00+07' from fx;
select is(
  (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('wallet'), timestamptz '2026-05-02 12:30+07') b)
    || ' ' || (select concat_ws(':', w -> 'stamp_cards' -> 0 ->> 'stamps', w -> 'points' ->> 'balance') from (select pg_temp.wallet(timestamptz '2026-05-02 12:30+07') as w) x),
  '0:0 0:0',
  'boundary value 0: the ledger and the wallet agree at 0'
);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, reason, occurred_at)
select tenant_v, programme_v, pg_temp.id('wallet'), store_v, 'adjust', 1, 1, 'synthetic credit', timestamptz '2026-05-02 13:00+07' from fx;
select is(
  (select concat_ws(':', b.stamps, b.points) from app.loyalty_balance(pg_temp.id('wallet'), timestamptz '2026-05-02 13:30+07') b)
    || ' ' || (select concat_ws(':', w -> 'stamp_cards' -> 0 ->> 'stamps', w -> 'points' ->> 'balance') from (select pg_temp.wallet(timestamptz '2026-05-02 13:30+07') as w) x),
  '1:1 1:1',
  'boundary value 1: the ledger and the wallet agree at 1'
);

select * from finish();
rollback;
