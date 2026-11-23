-- The liability and its cohort trace with a pending earn (review of G-104 with ADR-046 (3), 2026-11-23): an earn
-- that is never confirmed never expires (app.loyalty_expire skips it), is no liability (ADR-048) and must not be
-- lined up by the trace of breakage_by_cohort either, or the writer and the trace diverge. A pending earn that is
-- confirmed expires when its confirm row says, and the trace reads the same expiry.
--
-- Techniques (ISTQB): state transition testing (pending -> never confirmed; pending -> confirmed late), decision
-- table of the trace (credit confirmed or pending at the run; expiry before or after the run), boundary values (a
-- confirmed pending earn's expiry one second after a run and at it), negative tests (the pending earn is neither
-- expired nor attributed). Synthetic rows, every moment explicit; the file rolls back.
begin;
select plan(7);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024601'::uuid as tenant_p,
  'cccccccc-cccc-4ccc-8ccc-000000024601'::uuid as account_p,
  'ffffffff-ffff-4fff-8fff-000000024601'::uuid as store_p,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024601'::uuid as programme_p;

insert into public.tenants (id, slug, name, country_code) select tenant_p, 'pending-trace-pgtap', 'Pending trace pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_p, tenant_p, 'mock', 'pending-trace', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_p, tenant_p, account_p, 'pt-1', 'Synthetic store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_p, tenant_p, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select v.name, app.loyalty_join(fx.tenant_p, app.loyalty_customer_for_phone(fx.tenant_p, '0900' || v.phone), 'mini_app', fx.store_p, null, null, timestamptz '2026-01-01 09:00+07')
from fx cross join (values ('member', '246001'), ('late', '246002')) v (name, phone);

create function pg_temp.earn(p_name text, p_member text, p_sold timestamptz, p_net numeric, p_pending boolean)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_p, fx.store_p, fx.account_p, 'pt-' || p_name, '1', p_sold, app.store_business_date(fx.store_p, p_sold), p_net, p_net, p_net from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, e.entry_id from inserted cross join lateral app.loyalty_earn(inserted.id, (select id from ids where name = p_member), 'A', p_sold + interval '5 minutes', p_pending) e
  returning id;
$$;

-- member: a confirmed credit of 10 points sold in January, then a pending earn of 10 sold in February that is
-- never confirmed. Both are past their sale's expiry at the run of April 2027.
select pg_temp.earn('jan', 'member', timestamptz '2026-01-15 10:00+07', 100000, false);
select pg_temp.earn('feb', 'member', timestamptz '2026-02-15 10:00+07', 100000, true);
create temp table run_1 as select app.loyalty_nightly((select tenant_p from fx), timestamptz '2027-04-01 04:00+07') as r;

select is(
  (select r ->> 'expired_points' from run_1) || ' ' || (select concat_ws(':', b.points, b.pending_points) from app.loyalty_balance((select id from ids where name = 'member'), null) b),
  '10 0:10',
  'the nightly run expires the confirmed January points only; the pending February earn keeps its 10 points pending'
);
select is(
  (select d.outstanding_points from public.loyalty_liability_daily d where d.programme_id = (select programme_p from fx) and d.as_of_date = date '2027-04-01'),
  0::bigint,
  'the liability counts neither the expired credit nor the pending earn (ADR-048): nothing is subtracted for the pending earn'
);
select is(
  (select string_agg((c ->> 'month') || '=' || (c ->> 'expired'), ',' order by c ->> 'month')
   from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c
   where d.programme_id = (select programme_p from fx) and d.as_of_date = date '2027-04-01'),
  '2026-01=10,2026-02=0',
  'the trace puts the 10 expired points under January, the month of the credit that expired, not under the pending February earn'
);

-- late: a pending earn of 10 sold in March 2026, confirmed on 2026-05-10, so its points are valid through
-- 2027-05-10 and end at the midnight that closes it (every moment after the run above).
select pg_temp.earn('late_jan', 'late', timestamptz '2026-03-20 10:00+07', 100000, true);
select app.loyalty_confirm((select id from ids where name = 'late_jan'), null, timestamptz '2026-05-10 15:00+07');
select is(
  (select to_char(c.expires_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = (select id from ids where name = 'late_jan')),
  '2027-05-11 00:00',
  'the confirm row carries the expiry counted from the confirmation'
);
select is(
  (app.loyalty_expire((select tenant_p from fx), timestamptz '2027-05-10 23:59:59+07') ->> 'points'),
  '0',
  'boundary values: one second before the confirm row''s expiry nothing of it expires'
);
select is(
  (app.loyalty_expire((select tenant_p from fx), timestamptz '2027-05-11 00:00:00+07') ->> 'points'),
  '10',
  'at the confirm row''s expiry its 10 points expire'
);
create temp table run_2 as select app.loyalty_liability((select programme_p from fx), timestamptz '2027-05-11 04:00+07') as id;
select is(
  (select string_agg((c ->> 'month') || '=' || (c ->> 'expired'), ',' order by c ->> 'month')
   from public.loyalty_liability_daily d, jsonb_array_elements(d.breakage_by_cohort) c where d.id = (select id from run_2)),
  '2026-01=10,2026-02=0,2026-03=10',
  'the trace finds the confirmed pending earn by its confirm row''s expiry and charges its March cohort, and still not the pending February earn'
);

select * from finish();
rollback;
