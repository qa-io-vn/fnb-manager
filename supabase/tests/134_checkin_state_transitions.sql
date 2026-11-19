-- ISTQB state transition testing of a path B check-in (pending_checkins), with
-- SQL as the unit under test. States: issued, recorded, matched, queued,
-- rejected, expired. Valid transitions:
--   (start) -> issued            app.loyalty_issue_checkin_code
--   issued -> expired (replaced) a new code for the same member and store
--   issued -> expired (code_expired)  the reconciliation after the TTL
--   issued -> recorded           app.loyalty_record_checkin without the invoice
--   issued -> matched            app.loyalty_record_checkin with the invoice synced
--   recorded -> matched | queued | rejected   app.loyalty_match_checkin
--   recorded -> expired (no_matching_invoice) the reconciliation after checkin_pending_hours
--   queued -> matched | rejected (dismissed)  a manager resolves the queue item
-- Invalid transitions (recording a used, recorded or expired code; matching a
-- closed check-in again) must refuse or change nothing.
begin;
select plan(29);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013401'::uuid as tenant_c,
  'cccccccc-cccc-4ccc-8ccc-000000013401'::uuid as account_c,
  'ffffffff-ffff-4fff-8fff-000000013401'::uuid as store_c,
  'eeeeeeee-eeee-4eee-8eee-000000013401'::uuid as manager_c,
  timestamptz '2026-11-10 08:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select manager_c, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'checkin-states-3401@example.com' from fx;
insert into public.tenants (id, slug, name) select tenant_c, 'checkin-states-pgtap', 'Check-in states pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_c, tenant_c, 'mock', 'checkin-states', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_c, tenant_c, account_c, 'cs-1', 'Synthetic store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_c, manager_c, 'manager'::public.tenant_role, array[store_c] from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select tenant_c, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'member_' || n,
  app.loyalty_join(fx.tenant_c, app.loyalty_customer_for_phone(fx.tenant_c, '0900000' || (700 + n)::text, fx.t0 - interval '1 day'), 'mini_app', fx.store_c, null, null, fx.t0 - interval '1 day')
from fx cross join generate_series(1, 8) n;
insert into public.loyalty_staff_phones (tenant_id, phone, label) select tenant_c, '+84' || '900000706', 'Synthetic staff' from fx;

create function pg_temp.at(p_hours integer, p_offset interval default interval '0') returns timestamptz language sql as $$ select (select t0 from fx) + make_interval(hours => p_hours) + p_offset; $$;

create function pg_temp.issue(p_name text, p_member text, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_id uuid;
begin
  select c.checkin_id into v_id from app.loyalty_issue_checkin_code((select id from ids where name = p_member), (select store_c from fx), p_at) c;
  insert into ids (name, id) values (p_name, v_id);
  return (select status::text from public.pending_checkins where id = v_id);
end;
$$;

create function pg_temp.status(p_name text)
returns text
language sql
as $$
  select concat_ws(':', c.status, c.reason) from public.pending_checkins c where c.id = (select id from ids where name = p_name);
$$;

create function pg_temp.record(p_name text, p_at timestamptz, p_amount numeric default null)
returns text
language plpgsql
as $$
begin
  perform app.loyalty_record_checkin((select store_c from fx), (select code from public.pending_checkins where id = (select id from ids where name = p_name)), null, p_amount, p_at);
  return pg_temp.status(p_name);
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.match(p_name text, p_at timestamptz)
returns text
language sql
as $$
  select app.loyalty_match_checkin((select id from ids where name = p_name), p_at);
$$;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_c, fx.store_c, fx.account_c, 'cs-' || p_name, p_sold, app.store_business_date(fx.store_c, p_sold), p_net, p_net, p_net
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
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select manager_c from fx), 'role', 'authenticated')::text, true);
  v_answer := app.resolve_loyalty_queue_item(
    (select q.id from public.loyalty_queue q where q.checkin_id = (select id from ids where name = p_name)),
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

-- (start) -> issued, issued -> expired (replaced)
select is(pg_temp.issue('s1_first', 'member_1', pg_temp.at(1)), 'issued', 'state transition (start) -> issued: a fresh code for the member');
select is(pg_temp.issue('s1_second', 'member_1', pg_temp.at(1, interval '30 seconds')), 'issued', 'a second code for the same member and store is issued');
select is(pg_temp.status('s1_first'), 'expired:replaced', 'state transition issued -> expired: the first code is replaced');
select is(pg_temp.record('s1_first', pg_temp.at(1, interval '40 seconds')), '22023', 'invalid transition expired -> recorded: a replaced code is refused');

-- issued -> recorded -> matched
select pg_temp.issue('s2', 'member_2', pg_temp.at(2));
select is(pg_temp.record('s2', pg_temp.at(2, interval '30 seconds')), 'recorded', 'state transition issued -> recorded: without its invoice the check-in waits');
select is(pg_temp.record('s2', pg_temp.at(2, interval '40 seconds')), '22023', 'invalid transition recorded -> recorded: the code cannot be recorded twice');
select is(pg_temp.match('s2', pg_temp.at(2, interval '1 minute')), 'pending', 'recorded -> recorded: matching without a candidate invoice changes nothing');
select pg_temp.invoice('s2_sale', pg_temp.at(2, interval '5 minutes'), 61000);
select is(pg_temp.match('s2', pg_temp.at(2, interval '10 minutes')), 'matched', 'state transition recorded -> matched: the synced invoice matches');
select is(pg_temp.match('s2', pg_temp.at(2, interval '11 minutes')), 'matched', 'invalid transition matched -> matched: matching again answers matched');
select is(pg_temp.earns('member_2'), 1, 'and earns nothing twice');
select is(pg_temp.record('s2', pg_temp.at(2, interval '12 minutes')), '22023', 'invalid transition matched -> recorded: a used code is refused');

-- issued -> matched in one step
select pg_temp.invoice('s3_sale', pg_temp.at(3), 61000);
select pg_temp.issue('s3', 'member_3', pg_temp.at(3, interval '-1 minute'));
select is(pg_temp.record('s3', pg_temp.at(3, interval '30 seconds')), 'matched', 'state transition issued -> matched: recording a code whose invoice is already synced matches at once');

-- recorded -> queued -> matched
select pg_temp.issue('s4', 'member_4', pg_temp.at(4));
select is(pg_temp.record('s4', pg_temp.at(4, interval '20 seconds'), 50000), 'recorded', 'a check-in with the typed amount waits');
select pg_temp.invoice('s4_a', pg_temp.at(4, interval '3 minutes'), 55000);
select pg_temp.invoice('s4_b', pg_temp.at(4, interval '6 minutes'), 55000);
select is(pg_temp.match('s4', pg_temp.at(4, interval '10 minutes')), 'queued', 'state transition recorded -> queued: two invoices equally close go to the queue');
select is(pg_temp.match('s4', pg_temp.at(4, interval '11 minutes')), 'queued', 'invalid transition queued -> matched by the matcher: it answers queued and changes nothing');
select is(pg_temp.resolve('s4', (select id from ids where name = 's4_b')), 'matched', 'state transition queued -> matched: the manager chooses an invoice');
select is(
  (select i.name from public.pending_checkins c join ids i on i.id = c.matched_invoice_id where c.id = (select id from ids where name = 's4')),
  's4_b',
  'the check-in is matched with the chosen invoice'
);

-- recorded -> queued -> rejected (dismissed)
select pg_temp.issue('s5', 'member_5', pg_temp.at(5));
select pg_temp.record('s5', pg_temp.at(5, interval '20 seconds'), 50000);
select pg_temp.invoice('s5_a', pg_temp.at(5, interval '3 minutes'), 45000);
select pg_temp.invoice('s5_b', pg_temp.at(5, interval '6 minutes'), 55000);
select is(pg_temp.match('s5', pg_temp.at(5, interval '10 minutes')), 'queued', 'two invoices 5,000 away on either side are equally close: queued');
select is(pg_temp.resolve('s5', null), 'rejected:dismissed', 'state transition queued -> rejected: the manager dismisses the item');
select is(pg_temp.earns('member_5'), 0, 'a dismissed check-in earns nothing');

-- recorded -> rejected (an earn refusal)
select pg_temp.issue('s6', 'member_6', pg_temp.at(6));
select pg_temp.record('s6', pg_temp.at(6, interval '20 seconds'));
select pg_temp.invoice('s6_sale', pg_temp.at(6, interval '4 minutes'), 61000);
select is(pg_temp.match('s6', pg_temp.at(6, interval '10 minutes')), 'rejected', 'state transition recorded -> rejected: the earn is refused for a staff phone');
select is(pg_temp.status('s6'), 'rejected:excluded_phone', 'with the refusal as its reason');
select is(pg_temp.match('s6', pg_temp.at(6, interval '11 minutes')), 'rejected', 'invalid transition rejected -> matched: matching again answers rejected');

-- issued -> expired (code_expired) and recorded -> expired (no_matching_invoice) by the reconciliation
select pg_temp.issue('s7', 'member_7', pg_temp.at(7));
select pg_temp.issue('s8', 'member_8', pg_temp.at(8));
select pg_temp.record('s8', pg_temp.at(8, interval '30 seconds'));
create function pg_temp.reconcile(p_at timestamptz) returns jsonb language sql as $$
  select app.reconcile_loyalty((select tenant_c from fx), date '2026-11-09', date '2026-11-12', p_at);
$$;
select pg_temp.reconcile(pg_temp.at(8, interval '24 hours 29 seconds'));
select is(pg_temp.status('s7'), 'expired:code_expired', 'state transition issued -> expired: the reconciliation closes a code past its TTL');
select is(pg_temp.status('s8'), 'recorded', 'recorded -> recorded: one second before checkin_pending_hours the check-in still waits');
select is((pg_temp.reconcile(pg_temp.at(8, interval '24 hours 30 seconds')) ->> 'expired_checkins')::integer, 1, 'at checkin_pending_hours the reconciliation expires it');
select is(pg_temp.status('s8'), 'expired:no_matching_invoice', 'state transition recorded -> expired: no matching invoice');
select is(pg_temp.record('s7', pg_temp.at(9)), '22023', 'invalid transition expired -> recorded: an expired code is refused');
select is(pg_temp.match('s8', pg_temp.at(9)), 'expired', 'invalid transition expired -> matched: matching answers expired');

select * from finish();
rollback;
