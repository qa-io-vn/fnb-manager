-- ADR-046 (G-102, G-43): balances never go negative. SQL as the unit under test: app.loyalty_apply_adjustment,
-- app.loyalty_clawback, app.bill_reverse (both through app.loyalty_write_clawback), app.loyalty_confirm,
-- app.bill_confirm, app.loyalty_expire, app.loyalty_expiring_points and app.loyalty_nightly.
--
-- Techniques (ISTQB):
--   * Boundary value analysis: an adjustment that takes the balance to 1, 0 and -1 (points and stamps); a
--     clawback whose earn's points were spent and the member holds earn - 1, earn and earn + 1 again; the
--     expiry of a confirmed pending earn one second before and at its end.
--   * Decision table of a clawback: pending (R1), confirmed with all of it left (R2), part of it spent by a
--     manual debit (R3), all of it spent by a redemption (R4), already expired (R5).
--   * State transition testing: pending -> (nightly expiry passes it by) -> confirmed -> expires from the
--     confirmation; expired -> clawed back; a bill pending -> confirmed -> reversed.
--   * Negative tests: a refused adjustment writes nothing; a second clawback writes nothing; a legacy
--     negative balance takes a credit but no further debit.
--   * Security: the new function is closed to anon and authenticated; the refusal message, the clawback
--     reasons and the nightly answer carry counts only, no phone or name.
-- The three cases of G-102 (a clawback of an expired earn, a clawback after a manual debit, a pending earn
-- that outlives its expiry) and the fourth (an adjustment with no floor) each fail on the code before
-- migrations 20261123120000 to 20261123140000. Every moment is explicit, phones are synthetic.
begin;
select plan(44);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024201'::uuid as tenant_f,
  'cccccccc-cccc-4ccc-8ccc-000000024201'::uuid as account_f,
  'ffffffff-ffff-4fff-8fff-000000024201'::uuid as store_f,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024201'::uuid as programme_f;

insert into public.tenants (id, slug, name, country_code)
select tenant_f, 'balance-floor-pgtap', 'Balance floor pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_f, tenant_f, 'mock', 'balance-floor', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_f, tenant_f, account_f, 'bf-1', 'Synthetic store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, earning_invoices_per_phone_per_day)
select programme_f, tenant_f, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 20 from fx;

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_f, store_f, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], timestamptz '2026-01-01 00:00+07' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_f, store_f, k, 'Synthetic entry ' || k, null, 'discount'::public.einvoice_display
from fx cross join unnest(array['syn-both', 'syn-two']) k;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_f, programme_f, 'syn-both', 'Synthetic reward for a stamp and six points', 'free_item'::public.coupon_reward_kind, null::numeric, 1, 6, null::uuid[], 'active'::public.coupon_status from fx
union all
select tenant_f, programme_f, 'syn-two', 'Synthetic reward for two stamps', 'free_item', null, 2, 0, null::uuid[], 'active' from fx;

create temp table ids (name text primary key, id uuid);

insert into ids
select v.name, app.loyalty_join(fx.tenant_f, app.loyalty_customer_for_phone(fx.tenant_f, '0900' || v.phone), 'mini_app', fx.store_f, null, null, timestamptz '2026-09-01 09:00+07')
from fx
cross join (
  values
    ('adj_p', '242001'), ('adj_p4', '242002'), ('adj_s', '242003'), ('adj_mix', '242004'), ('adj_pend', '242005'), ('adj_legacy', '242006'),
    ('r1', '242011'), ('r2', '242012'), ('r3', '242013'), ('r4', '242014'), ('r5', '242015'),
    ('b5', '242021'), ('b6', '242022'), ('b7', '242023'), ('sc', '242031'), ('pc', '242041'), ('bl', '242051'), ('nw', '242061')
) as v (name, phone);

create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_f, fx.store_f, fx.account_f, 'bf-' || p_name, right(p_name, 6), p_sold, app.store_business_date(fx.store_f, p_sold), p_net, p_net, p_net
    from fx
    returning id
  )
  insert into ids (name, id) select 'inv_' || p_name, inserted.id from inserted returning id;
$$;

-- an earn of 60,000 (one stamp, six points) sold at p_sold, written five minutes later
create function pg_temp.earn(p_member text, p_sold timestamptz, p_pending boolean default false)
returns uuid
language sql
as $$
  select pg_temp.invoice(p_member || '_' || to_char(p_sold, 'YYYYMMDDHH24MI'), p_sold, 60000);
  select e.entry_id
  from app.loyalty_earn(pg_temp.id('inv_' || p_member || '_' || to_char(p_sold, 'YYYYMMDDHH24MI')), pg_temp.id(p_member), 'A', p_sold + interval '5 minutes', p_pending) e;
$$;

create function pg_temp.adjust(p_member text, p_stamps integer, p_points integer, p_at timestamptz)
returns uuid
language sql
as $$
  select app.loyalty_apply_adjustment(pg_temp.id(p_member), (select store_f from fx), p_stamps, p_points, 'synthetic correction', null, p_at);
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

create function pg_temp.bal(p_member text)
returns text
language sql
as $$
  select concat_ws(':', b.stamps, b.points, b.pending_stamps, b.pending_points) from app.loyalty_balance(pg_temp.id(p_member)) b;
$$;

create function pg_temp.rows_of(p_member text)
returns integer
language sql
as $$
  select count(*)::integer from public.loyalty_ledger where membership_id = pg_temp.id(p_member);
$$;

-- stamp_delta:point_delta:reason of the clawback row of an earn
create function pg_temp.claw_row(p_earn uuid)
returns text
language sql
as $$
  select concat_ws(':', c.stamp_delta, c.point_delta, c.reason) from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = p_earn;
$$;

create function pg_temp.claw(p_earn uuid, p_at timestamptz)
returns integer
language sql
as $$
  select app.loyalty_clawback((select l.invoice_id from public.loyalty_ledger l where l.id = p_earn), 'invoice_voided', p_at);
$$;

create function pg_temp.hold(p_member text, p_reward text, p_at timestamptz)
returns text
language sql
as $$
  select coalesce(r ->> 'state', r ->> 'refusal')
  from (
    select app.redeem_coupon(pg_temp.id(p_member), (select c.id from public.coupons c where c.reward_key = p_reward and c.tenant_id = (select tenant_f from fx)), (select store_f from fx), p_at) as r
  ) x;
$$;

-- A. The floor of an adjustment (ADR-046 (1)) ------------------------------------------------------------
select pg_temp.adjust('adj_p', 0, 5, timestamptz '2026-10-05 09:00+07');
select pg_temp.adjust('adj_p4', 0, 5, timestamptz '2026-10-05 09:00+07');
select is(
  pg_temp.try($$select pg_temp.adjust('adj_p', 0, -6, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.rows_of('adj_p') || ' ' || pg_temp.bal('adj_p'),
  'error:22023 1 0:5:0:0',
  'boundary value balance + 1: taking 6 of 5 points is refused with 22023 and writes nothing'
);
select is(
  pg_temp.try($$select pg_temp.adjust('adj_p4', 0, -4, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_p4'),
  'ok 0:1:0:0',
  'boundary value balance - 1: taking 4 of 5 points leaves 1'
);
select is(
  pg_temp.try($$select pg_temp.adjust('adj_p', 0, -5, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_p'),
  'ok 0:0:0:0',
  'boundary value balance: taking all 5 points leaves 0'
);

select pg_temp.adjust('adj_s', 2, 0, timestamptz '2026-10-05 09:00+07');
select is(
  pg_temp.try($$select pg_temp.adjust('adj_s', -3, 0, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_s'),
  'error:22023 2:0:0:0',
  'boundary value: taking 3 of 2 stamps is refused'
);
select is(
  pg_temp.try($$select pg_temp.adjust('adj_s', -2, 0, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_s'),
  'ok 0:0:0:0',
  'boundary value: taking both stamps leaves 0'
);
select is(
  (select string_agg(s.state::text, ',') from public.stamps s where s.membership_id = pg_temp.id('adj_s')),
  'clawed_back,clawed_back',
  'and closes both stamps rows'
);

select pg_temp.adjust('adj_mix', 0, 3, timestamptz '2026-10-05 09:00+07');
select is(
  pg_temp.try($$select pg_temp.adjust('adj_mix', 2, -4, timestamptz '2026-10-05 10:00+07')$$) || ' '
    || pg_temp.try($$select pg_temp.adjust('adj_mix', 2, -3, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_mix'),
  'error:22023 ok 2:0:0:0',
  'each kind is checked on its own: crediting two stamps does not let the points go below zero'
);

select pg_temp.earn('adj_pend', timestamptz '2026-10-05 08:00+07', true);
select is(
  pg_temp.try($$select pg_temp.adjust('adj_pend', -1, 0, timestamptz '2026-10-05 10:00+07')$$) || ' '
    || pg_temp.try($$select pg_temp.adjust('adj_pend', 0, -1, timestamptz '2026-10-05 10:00+07')$$) || ' ' || pg_temp.bal('adj_pend'),
  'error:22023 error:22023 0:0:1:6',
  'negative test: a pending earn is not spendable, so it does not carry a debit'
);

-- A balance an older row left below zero (written before ADR-046).
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, point_delta, reason, occurred_at)
select tenant_f, programme_f, pg_temp.id('adj_legacy'), store_f, 'adjust', -10, 'legacy debit', timestamptz '2026-10-01 09:00+07' from fx;
select is(
  pg_temp.try($$select pg_temp.adjust('adj_legacy', 0, 4, timestamptz '2026-10-05 10:00+07')$$) || ' '
    || pg_temp.try($$select pg_temp.adjust('adj_legacy', 0, -1, timestamptz '2026-10-05 11:00+07')$$) || ' ' || pg_temp.bal('adj_legacy'),
  'ok error:22023 0:-6:0:0',
  'a positive part is never refused, even on a legacy negative balance, and no debit is taken from it'
);
select is(
  pg_temp.rows_of('adj_legacy'),
  2,
  'negative test: the refused debit wrote no row (the legacy row and the credit only)'
);

-- B. The decision table of a clawback (ADR-046 (2)) ------------------------------------------------------
create temp table earns (name text primary key, id uuid);
insert into earns values
  ('r1', pg_temp.earn('r1', timestamptz '2026-10-05 09:00+07', true)),
  ('r2', pg_temp.earn('r2', timestamptz '2026-10-05 09:00+07')),
  ('r3', pg_temp.earn('r3', timestamptz '2026-10-05 09:00+07')),
  ('r4', pg_temp.earn('r4', timestamptz '2026-10-05 09:00+07'));
select pg_temp.adjust('r3', 0, -4, timestamptz '2026-10-05 12:00+07');
select is(pg_temp.hold('r4', 'syn-both', timestamptz '2026-10-05 12:00+07'), 'held', 'r4 spends its stamp and six points on a reward');

select is(
  pg_temp.claw((select id from earns where name = 'r1'), timestamptz '2026-10-05 15:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'r1')) || ' ' || pg_temp.bal('r1'),
  '1 -1:-6:invoice_voided 0:0:0:0',
  'R1 a pending earn is taken back whole from the pending balance'
);
select is(
  pg_temp.claw((select id from earns where name = 'r2'), timestamptz '2026-10-05 15:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'r2')) || ' ' || pg_temp.bal('r2'),
  '1 -1:-6:invoice_voided 0:0:0:0',
  'R2 a confirmed earn the member still holds is taken back whole'
);
select is(
  pg_temp.claw((select id from earns where name = 'r3'), timestamptz '2026-10-05 15:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'r3')) || ' ' || pg_temp.bal('r3'),
  '1 -1:-2:invoice_voided; short by 4 points 0:0:0:0',
  'R3 after a manual debit (G-102) the clawback takes the 2 points left and writes off 4, the balance stops at 0'
);
select is(
  pg_temp.claw((select id from earns where name = 'r4'), timestamptz '2026-10-05 15:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'r4')) || ' ' || pg_temp.bal('r4'),
  '1 0:0:invoice_voided; short by 1 stamp and 6 points 0:0:0:0',
  'R4 after a redemption of all of it the clawback takes nothing and writes it all off'
);
select is(
  pg_temp.claw((select id from earns where name = 'r4'), timestamptz '2026-10-05 16:00+07') || ' ' || (select count(*) from public.loyalty_ledger where entry_kind = 'clawback' and source_entry_id = (select id from earns where name = 'r4')),
  '0 1',
  'negative test: a second clawback of the same invoice writes nothing'
);
select is(
  (select concat_ws(':', -c.value_amount, e.value_amount) from public.loyalty_ledger c join public.loyalty_ledger e on e.id = c.source_entry_id where c.source_entry_id = (select id from earns where name = 'r3') and c.entry_kind = 'clawback'),
  '1000.00:3000.00',
  'the clawback row is valued at the points it took (2 x 500), not at the earn''s 3,000'
);

-- Boundary values of the cap: the earn's six points spent, then the member holds 5, 6 or 7 again.
insert into earns values
  ('b5', pg_temp.earn('b5', timestamptz '2026-10-05 09:00+07')),
  ('b6', pg_temp.earn('b6', timestamptz '2026-10-05 09:00+07')),
  ('b7', pg_temp.earn('b7', timestamptz '2026-10-05 09:00+07'));
select pg_temp.adjust(m, 0, -6, timestamptz '2026-10-05 10:00+07') from unnest(array['b5', 'b6', 'b7']) m;
select pg_temp.adjust(m, 0, k, timestamptz '2026-10-05 11:00+07') from (values ('b5', 5), ('b6', 6), ('b7', 7)) v (m, k);
select is(
  (select string_agg(pg_temp.claw(e.id, timestamptz '2026-10-05 15:00+07') || '>' || pg_temp.claw_row(e.id) || '>' || pg_temp.bal(e.name), ' | ' order by e.name)
   from earns e where e.name in ('b5', 'b6', 'b7')),
  '1>-1:-5:invoice_voided; short by 1 point>0:0:0:0 | 1>-1:-6:invoice_voided>0:0:0:0 | 1>-1:-6:invoice_voided>0:1:0:0',
  'boundary values earn - 1, earn, earn + 1: the clawback takes 5, 6 and 6 points, writes off 1, 0 and 0'
);

-- The stamps taken: the earn's own first, then the member's oldest spendable ones.
insert into earns values
  ('sc1', pg_temp.earn('sc', timestamptz '2026-10-05 09:00+07')),
  ('sc2', pg_temp.earn('sc', timestamptz '2026-10-05 10:00+07')),
  ('sc3', pg_temp.earn('sc', timestamptz '2026-10-05 11:00+07'));
select is(pg_temp.hold('sc', 'syn-two', timestamptz '2026-10-05 12:00+07'), 'held', 'a reward of two stamps takes the two oldest (those of the first two earns)');
select is(
  pg_temp.claw((select id from earns where name = 'sc2'), timestamptz '2026-10-05 15:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'sc2')),
  '1 -1:-6:invoice_voided',
  'the second earn''s own stamp is redeemed, the member still holds one: the clawback takes it whole'
);
select is(
  (select string_agg(s.state::text || coalesce('/' || (s.closed_entry_id = (select c.id from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = (select id from earns where name = 'sc2')))::text, ''), ',' order by s.earned_at)
   from public.stamps s where s.membership_id = pg_temp.id('sc')),
  'redeemed/false,redeemed/false,clawed_back/true',
  'so the stamps rows follow the ledger: the third earn''s stamp is closed by that clawback'
);
select is(
  pg_temp.claw((select id from earns where name = 'sc3'), timestamptz '2026-10-05 16:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'sc3')) || ' ' || pg_temp.bal('sc'),
  '1 0:-6:invoice_voided; short by 1 stamp 0:6:0:0',
  'the third earn''s stamp is gone: its clawback takes its six points and writes off the stamp'
);

-- A bill of path E: pending -> confirmed -> reversed after its points were spent.
insert into public.bill_captures (tenant_id, store_id, membership_id, source, business_date, bill_no, bill_key, total, state, confirm_by)
select tenant_f, store_f, pg_temp.id('bl'), 'staff_scan', date '2026-10-05', 'BF-1', app.bill_key('BF-1'), 60000, 'awaiting_customer', now() + interval '1 day' from fx;
select app.bill_earn((select b.id from public.bill_captures b where b.bill_no = 'BF-1' and b.tenant_id = (select tenant_f from fx)), true, timestamptz '2026-10-05 09:00+07');
select is(pg_temp.bal('bl'), '0:0:1:6', 'the bill''s earn waits for the customer');
select app.bill_confirm((select b.id from public.bill_captures b where b.bill_no = 'BF-1' and b.tenant_id = (select tenant_f from fx)), null, timestamptz '2026-10-05 10:00+07');
select pg_temp.adjust('bl', 0, -6, timestamptz '2026-10-05 11:00+07');
select app.bill_reverse((select b.id from public.bill_captures b where b.bill_no = 'BF-1' and b.tenant_id = (select tenant_f from fx)), 'manager_rejected', null, timestamptz '2026-10-05 12:00+07');
select is(
  (select concat_ws(':', c.stamp_delta, c.point_delta, c.reason, b.state) from public.loyalty_ledger c join public.bill_captures b on b.id = c.bill_id where c.entry_kind = 'clawback' and c.membership_id = pg_temp.id('bl'))
    || ' ' || pg_temp.bal('bl'),
  '-1:0:bill_manager_rejected; short by 6 points:reversed 0:0:0:0',
  'a reversed bill takes back the stamp, writes off the six points spent and leaves the member at 0'
);

-- The nightly counts what its clawbacks could not take back.
insert into earns values ('nw', pg_temp.earn('nw', timestamptz '2026-10-05 09:00+07'));
select pg_temp.adjust('nw', 0, -4, timestamptz '2026-10-05 10:00+07');
update public.invoices set status = 'voided' where id = (select l.invoice_id from public.loyalty_ledger l where l.id = (select id from earns where name = 'nw'));
create temp table night as select app.loyalty_nightly((select tenant_f from fx), timestamptz '2026-10-06 04:00+07') as r;
select is(
  (select concat_ws(':', r ->> 'clawbacks', r ->> 'written_off_stamps', r ->> 'written_off_points') from night) || ' ' || pg_temp.claw_row((select id from earns where name = 'nw')),
  '1:0:4 -1:-2:invoice_voided; short by 4 points',
  'the nightly step reverses the voided invoice and counts the four points it wrote off'
);

-- C. Expiry: a clawback of an expired earn and a pending earn that outlives its expiry ---------------
insert into earns values
  ('r5', pg_temp.earn('r5', timestamptz '2026-10-05 09:00+07')),
  ('pc', pg_temp.earn('pc', timestamptz '2026-10-05 09:00+07', true));
create temp table run_2027 as select app.loyalty_expire((select tenant_f from fx), timestamptz '2027-10-06 04:00+07') as r;
select is(
  (select concat_ws(':', l.stamp_delta, l.point_delta) from public.loyalty_ledger l where l.membership_id = pg_temp.id('r5') and l.entry_kind = 'expire'),
  '-1:-6',
  'r5''s stamp and six points expire a year on'
);
select is(
  pg_temp.claw((select id from earns where name = 'r5'), timestamptz '2027-10-06 10:00+07') || ' ' || pg_temp.claw_row((select id from earns where name = 'r5')) || ' ' || pg_temp.bal('r5'),
  '1 0:0:invoice_voided; short by 1 stamp and 6 points 0:0:0:0',
  'R5 a clawback of an expired earn (G-102) takes back nothing and the balance stays at 0, not -1:-6'
);
select is(
  (select count(*)::int from public.loyalty_ledger l where l.membership_id = pg_temp.id('pc') and l.entry_kind = 'expire') || ' ' || pg_temp.bal('pc')
    || ' ' || app.loyalty_expiring_points(pg_temp.id('pc'), timestamptz '2027-10-06 04:00+07'),
  '0 0:0:1:6 0',
  'state transition: the pending earn (G-102) outlives its expiry untouched: no expire row, still 1 stamp and 6 points pending'
);
select is(
  (select s.state::text from public.stamps s where s.membership_id = pg_temp.id('pc')),
  'active',
  'and its stamps row is still active'
);
select app.loyalty_confirm((select id from earns where name = 'pc'), null, timestamptz '2027-10-07 09:00+07');
select is(
  pg_temp.bal('pc'),
  '1:6:0:0',
  'state transition: confirmed a year after the sale, it becomes spendable'
);
select ok(
  (select c.expires_at >= timestamptz '2028-10-07 09:00+07' and c.expires_at < timestamptz '2028-10-08 09:00+07'
   from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = (select id from earns where name = 'pc'))
  and (select s.expires_at >= timestamptz '2028-04-07 09:00+07' and s.expires_at < timestamptz '2028-04-08 09:00+07'
       from public.stamps s where s.membership_id = pg_temp.id('pc')),
  'its clock starts at the confirmation: the confirm row carries the points'' expiry twelve months on and the stamp expires six months on'
);
select is(
  (select concat_ws(':', app.loyalty_expiring_points(pg_temp.id('pc'), c.expires_at - interval '1 second'), app.loyalty_expiring_points(pg_temp.id('pc'), c.expires_at))
   from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = (select id from earns where name = 'pc')),
  '0:6',
  'boundary values: the six points expire at the confirm row''s expiry, not a second before'
);
select is(
  (select concat_ws(':',
     (app.loyalty_expire((select tenant_f from fx), s.expires_at - interval '1 second') ->> 'stamps'),
     (app.loyalty_expire((select tenant_f from fx), s.expires_at) ->> 'stamps'))
   from public.stamps s where s.membership_id = pg_temp.id('pc')),
  '0:1',
  'boundary values: the stamp expires at its new expiry, not a second before'
);
select is(
  (select r ->> 'points' from run_2027),
  (select sum(-l.point_delta)::text from public.loyalty_ledger l where l.tenant_id = (select tenant_f from fx) and l.entry_kind = 'expire' and l.occurred_at = timestamptz '2027-10-06 04:00+07'),
  'the expiry run counts exactly the points its rows took'
);

-- D. No balance below zero anywhere, the legacy row aside -------------------------------------------------
select is(
  (select string_agg(i.name, ',' order by i.name) from ids i cross join lateral app.loyalty_balance(i.id) b
   where i.name not like 'inv_%' and (b.stamps < 0 or b.points < 0 or b.pending_stamps < 0 or b.pending_points < 0)),
  'adj_legacy',
  'after every case only the member with a legacy negative row is below zero'
);
select is(
  (select count(*)::int from public.stamps s
   join ids i on i.id = s.membership_id
   where s.state = 'active' and s.tenant_id = (select tenant_f from fx)
     and not exists (select 1 from public.loyalty_ledger e where e.id = s.earn_entry_id and e.pending and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id))),
  (select coalesce(sum(greatest(b.stamps, 0)), 0)::int from ids i cross join lateral app.loyalty_balance(i.id) b where i.name not like 'inv_%'),
  'the active stamps rows equal the stamps the balances count: the clawbacks and adjustments closed the stamps they took'
);

-- E. Security ---------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'app.loyalty_write_clawback(uuid, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_write_clawback(uuid, text, uuid, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.loyalty_write_clawback(uuid, text, uuid, timestamptz)', 'execute'),
  'security: the clawback writer is closed to anon and authenticated, open to the service role'
);
select ok(
  not has_function_privilege('anon', 'app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.loyalty_clawback(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_clawback(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.bill_reverse(uuid, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.bill_reverse(uuid, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.loyalty_confirm(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.bill_confirm(uuid, uuid, timestamptz)', 'execute'),
  'security: the replaced writers stay closed to anon and authenticated'
);
create function pg_temp.refusal_text()
returns text
language plpgsql
as $$
begin
  perform pg_temp.adjust('adj_p4', 0, -2, timestamptz '2026-10-06 10:00+07');
  return 'accepted';
exception when others then
  return sqlerrm;
end;
$$;
select is(
  pg_temp.refusal_text(),
  'an adjustment never takes a balance below zero: 0 stamps and 1 points are spendable',
  'security: the refusal says the counts and nothing about the member'
);
select is(
  (select count(*)::int from public.loyalty_ledger l
   where l.tenant_id = (select tenant_f from fx) and l.entry_kind = 'clawback'
     and (l.reason ~ '(\+?84|0)[1-9][0-9]{8,9}' or l.reason ~* 'synthetic store|synthetic programme' or l.reason !~ '^(invoice_voided|bill_manager_rejected)(; short by [0-9]+ (stamp|stamps|point|points)( and [0-9]+ (point|points))?)?$')),
  0,
  'security: every clawback reason is the given reason and the counts written off, no phone or name'
);
select is(
  (select bool_and(jsonb_typeof(v) = 'number')::text from night, jsonb_each(r) e (k, v)),
  'true',
  'security: the nightly answer is counts only'
);
select is(
  (select count(*)::int from public.loyalty_ledger l where l.tenant_id = (select tenant_f from fx) and l.entry_kind = 'clawback' and char_length(l.reason) > 200),
  0,
  'every reason stays within the 200 characters of the column'
);

-- the reason is cut so the whole stays within 200 characters (boundary 200)
insert into earns values ('long', pg_temp.earn('adj_p4', timestamptz '2026-10-07 09:00+07'));
select pg_temp.adjust('adj_p4', 0, -7, timestamptz '2026-10-07 10:00+07');
select app.loyalty_clawback((select l.invoice_id from public.loyalty_ledger l where l.id = (select id from earns where name = 'long')), repeat('x', 200), timestamptz '2026-10-07 11:00+07');
select is(
  (select concat_ws(':', char_length(l.reason), right(l.reason, 19)) from public.loyalty_ledger l where l.entry_kind = 'clawback' and l.source_entry_id = (select id from earns where name = 'long')),
  '200:; short by 6 points',
  'boundary value: a reason of 200 characters is cut to keep "short by" and the whole at 200'
);
select is(
  (select l.reason from public.loyalty_ledger l where l.entry_kind = 'clawback' and l.source_entry_id = (select id from earns where name = 'long')) like repeat('x', 181) || ';%',
  true,
  'the given reason keeps its first 181 characters'
);

select * from finish();
rollback;
