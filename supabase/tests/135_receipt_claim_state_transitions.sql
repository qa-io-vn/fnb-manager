-- ISTQB state transition testing of a path C receipt claim (receipt_claims),
-- with SQL as the unit under test. States: pending, matched, queued, rejected,
-- expired. Valid transitions:
--   (start) -> pending    app.loyalty_submit_claim before the invoice is synced
--   (start) -> matched    app.loyalty_submit_claim when it is already synced
--   (start) -> rejected   refused at submission (already_claimed, daily_cap)
--   pending -> matched | rejected (amount_mismatch, already_earned) | queued  app.loyalty_match_claim
--   pending -> expired    the reconciliation after receipt_claim_window_hours
--   queued -> matched | rejected (dismissed)  a manager resolves the queue item
-- Invalid transitions (matching a closed claim again, claiming a claimed
-- receipt) must refuse or change nothing.
begin;
select plan(22);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013501'::uuid as tenant_k,
  'cccccccc-cccc-4ccc-8ccc-000000013501'::uuid as account_k,
  'ffffffff-ffff-4fff-8fff-000000013501'::uuid as store_k,
  'eeeeeeee-eeee-4eee-8eee-000000013501'::uuid as manager_k,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select manager_k, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'claim-states-3501@example.com' from fx;
insert into public.tenants (id, slug, name) select tenant_k, 'claim-states-pgtap', 'Receipt claim states pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_k, tenant_k, 'mock', 'claim-states', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_k, tenant_k, account_k, 'ks-1', 'Synthetic store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_k, manager_k, 'manager'::public.tenant_role, array[store_k] from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select tenant_k, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'member_' || n,
  app.loyalty_join(fx.tenant_k, app.loyalty_customer_for_phone(fx.tenant_k, '0900000' || (800 + n)::text, fx.t0 - interval '1 day'), 'mini_app', fx.store_k, null, null, fx.t0 - interval '1 day')
from fx cross join generate_series(1, 9) n;

create function pg_temp.claim(p_name text, p_member text, p_receipt text, p_amount numeric, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_claim record;
begin
  select c.claim_id, c.status, c.reason into v_claim
  from app.loyalty_submit_claim((select id from ids where name = p_member), (select store_k from fx), date '2026-11-10', p_receipt, p_amount, p_at) c;
  insert into ids (name, id) values (p_name, v_claim.claim_id);
  return concat_ws(':', v_claim.status, v_claim.reason);
end;
$$;

create function pg_temp.status(p_name text)
returns text
language sql
as $$
  select concat_ws(':', c.status, c.reason) from public.receipt_claims c where c.id = (select id from ids where name = p_name);
$$;

create function pg_temp.match(p_name text, p_at timestamptz)
returns text
language sql
as $$
  select app.loyalty_match_claim((select id from ids where name = p_name), p_at);
$$;

create function pg_temp.invoice(p_name text, p_receipt text, p_net numeric, p_sold timestamptz default null, p_phone text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
    select fx.tenant_k, fx.store_k, fx.account_k, 'ks-' || p_name, p_receipt, coalesce(p_sold, fx.t0 - interval '1 hour'), date '2026-11-10', p_net, p_net, p_net, p_phone
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.resolve(p_name text, p_choice uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select manager_k from fx), 'role', 'authenticated')::text, true);
  perform app.resolve_loyalty_queue_item(
    (select q.id from public.loyalty_queue q where q.claim_id = (select id from ids where name = p_name)),
    p_choice,
    'checked with the cashier'
  );
  perform set_config('request.jwt.claims', '', true);
  return pg_temp.status(p_name);
end;
$$;

create function pg_temp.earns(p_member text)
returns integer
language sql
as $$
  select count(*)::integer from public.loyalty_ledger l where l.entry_kind = 'earn' and l.membership_id = (select id from ids where name = p_member);
$$;

-- (start) -> pending -> matched
select is(pg_temp.claim('k1', 'member_1', '0001', 61000, (select t0 from fx)), 'pending', 'state transition (start) -> pending: the receipt is not synced yet');
select is(pg_temp.match('k1', (select t0 from fx) + interval '1 minute'), 'pending', 'pending -> pending: matching without the invoice changes nothing');
select pg_temp.invoice('k1_sale', '1', 61000);
select is(pg_temp.match('k1', (select t0 from fx) + interval '2 minutes'), 'matched', 'state transition pending -> matched: the synced invoice with the same number (leading zeros ignored) and amount');
select is(pg_temp.match('k1', (select t0 from fx) + interval '3 minutes'), 'matched', 'invalid transition matched -> matched: matching again answers matched');
select is(pg_temp.earns('member_1'), 1, 'and earns once');
select is(pg_temp.claim('k1_other', 'member_2', '0001', 61000, (select t0 from fx) + interval '4 minutes'), 'rejected:already_claimed', 'invalid transition (start) -> pending for a matched receipt: another member''s claim is refused already_claimed');

-- (start) -> matched in one step
select pg_temp.invoice('k3_sale', '0003', 52000);
select is(pg_temp.claim('k3', 'member_3', '0003', 52000, (select t0 from fx)), 'matched', 'state transition (start) -> matched: the invoice was already synced');

-- pending -> rejected (amount_mismatch)
select pg_temp.claim('k4', 'member_4', '0004', 70000, (select t0 from fx));
select pg_temp.invoice('k4_sale', '0004', 61000);
select is(pg_temp.match('k4', (select t0 from fx) + interval '5 minutes'), 'rejected', 'state transition pending -> rejected: the invoice''s amount differs');
select is(pg_temp.status('k4'), 'rejected:amount_mismatch', 'with amount_mismatch');
select is(pg_temp.match('k4', (select t0 from fx) + interval '6 minutes'), 'rejected', 'invalid transition rejected -> matched: matching again answers rejected');
select is(pg_temp.claim('k4_retry', 'member_4', '0004', 61000, (select t0 from fx) + interval '7 minutes'), 'matched', 'a rejected claim does not block a corrected claim of the same receipt');

-- pending -> rejected (already_earned on path A)
select pg_temp.claim('k5', 'member_5', '0005', 61000, (select t0 from fx));
select pg_temp.invoice('k5_sale', '0005', 61000, (select t0 from fx) - interval '2 hours', '0900000805');
select pg_temp.invoice('k5_unrelated', '0099', 1000, (select t0 from fx) - interval '3 hours');
select is(
  (app.reconcile_loyalty((select tenant_k from fx), date '2026-11-09', date '2026-11-11', (select t0 from fx) + interval '10 minutes') ->> 'a_earned')::integer,
  1,
  'the invoice carrying the member''s phone earns on path A first'
);
select is(pg_temp.status('k5'), 'rejected:already_earned', 'state transition pending -> rejected: the claimed invoice already earned');
select is(pg_temp.earns('member_5'), 1, 'one earn only');

-- pending -> queued -> matched, and pending -> queued -> rejected
select pg_temp.claim('k6', 'member_6', '0006', 61000, (select t0 from fx));
select pg_temp.invoice('k6_a', '0006', 61000, (select t0 from fx) - interval '4 hours');
select pg_temp.invoice('k6_b', '006', 61000, (select t0 from fx) - interval '5 hours');
select is(pg_temp.match('k6', (select t0 from fx) + interval '11 minutes'), 'queued', 'state transition pending -> queued: two invoices carry the receipt number and amount');
select is(pg_temp.match('k6', (select t0 from fx) + interval '12 minutes'), 'queued', 'invalid transition queued -> matched by the matcher: it answers queued');
select is(pg_temp.resolve('k6', (select id from ids where name = 'k6_b')), 'matched', 'state transition queued -> matched: the manager chooses one');
select pg_temp.claim('k7', 'member_7', '0007', 61000, (select t0 from fx));
select pg_temp.invoice('k7_a', '0007', 61000, (select t0 from fx) - interval '6 hours');
select pg_temp.invoice('k7_b', '7', 61000, (select t0 from fx) - interval '7 hours');
select pg_temp.match('k7', (select t0 from fx) + interval '13 minutes');
select is(pg_temp.resolve('k7', null), 'rejected:dismissed', 'state transition queued -> rejected: the manager dismisses the item');

-- (start) -> rejected (daily_cap), pending -> expired
select pg_temp.claim('k8_' || n, 'member_8', '008' || n, 61000, (select t0 from fx) + make_interval(mins => n)) from generate_series(1, 3) n;
select is(pg_temp.claim('k8_4', 'member_8', '0084', 61000, (select t0 from fx) + interval '5 minutes'), 'rejected:daily_cap', 'state transition (start) -> rejected: the fourth claim of the day is over receipt_claims_per_phone_per_day');
select pg_temp.claim('k9', 'member_9', '0009', 61000, (select t0 from fx));
select is(
  (app.reconcile_loyalty((select tenant_k from fx), date '2026-11-09', date '2026-11-11', (select t0 from fx) + interval '72 hours') ->> 'expired_claims')::integer >= 1,
  true,
  'the reconciliation expires claims past their window'
);
select is(pg_temp.status('k9'), 'expired:no_matching_invoice', 'state transition pending -> expired: no matching invoice');
select pg_temp.invoice('k9_late', '0009', 61000);
select is(pg_temp.match('k9', (select t0 from fx) + interval '73 hours'), 'expired', 'invalid transition expired -> matched: the late invoice does not revive it');

select * from finish();
rollback;
