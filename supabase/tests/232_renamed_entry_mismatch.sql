-- A renamed discount entry on the fallback rail (G-19), SQL as the unit under
-- test. 97_rail_recognition shows that a renamed entry is no longer
-- recognised; this file shows that the owner is told anyway. Every moment is
-- fixed through the time arguments of app.redeem_coupon,
-- app.staff_verify_redemption and app.reconcile_loyalty, nothing reads now().
--
-- Scenario: store 1 is on the fallback rail (pos_payment_discount), whose
-- reward mapping names the POS entry 'Synthetic free drink'. The entry has been
-- renamed at the till, so the invoices carry 'Synthetic free drink (new)'. Two
-- members (a, b) hold the reward, show the code at the till and are verified
-- at 10:10; their invoices carry the new name, so nothing confirms them.
--
-- Techniques (ISTQB):
--   * Use case and scenario testing: the whole path from the hold to the
--     episode and the manager's queue, read as the manager would.
--   * Boundary value analysis on the grace period of redemption_mismatch
--     (24 hours, from the verification): one second before it, at it.
--   * Equivalence partitioning of the redemptions of one store: renamed and
--     verified (listed), correctly named and verified (confirmed), held and
--     never verified (left alone), verified later (joins the same episode).
--   * State transition testing: the episode opens once, is only refreshed by
--     later items and by a repeated run.
--   * Security: the episode and the queue carry counts and ids only, no phone
--     and no code; the entry name is read through the redemption, under RLS.
begin;
select plan(32);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000023301'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000023301'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000023301'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000023302'::uuid as store_2,
  'eeeeeeee-eeee-4eee-8eee-000000023301'::uuid as owner_m,
  'eeeeeeee-eeee-4eee-8eee-000000023302'::uuid as manager_1,
  'eeeeeeee-eeee-4eee-8eee-000000023303'::uuid as manager_2,
  'eeeeeeee-eeee-4eee-8eee-000000023304'::uuid as staff_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000023301'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000023302'::uuid as customer_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000023303'::uuid as customer_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000023304'::uuid as customer_d,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000023305'::uuid as customer_e,
  '99999999-9999-4999-8999-000000023301'::uuid as member_a,
  '99999999-9999-4999-8999-000000023302'::uuid as member_b,
  '99999999-9999-4999-8999-000000023303'::uuid as member_c,
  '99999999-9999-4999-8999-000000023304'::uuid as member_d,
  '99999999-9999-4999-8999-000000023305'::uuid as member_e,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000023301'::uuid as programme_m;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'renamed-entry-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_m, fx.manager_1, fx.manager_2, fx.staff_1]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_m, 'renamed-entry-pgtap', 'Renamed entry pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_m, tenant_m, 'mock', 'renamed-entry-m', 'Synthetic account M' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_m, account_m, 'rn-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_m, account_m, 'rn-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_m, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_m, 'owner', null::uuid[]),
    (fx.manager_1, 'manager', array[fx.store_1]),
    (fx.manager_2, 'manager', array[fx.store_2]),
    (fx.staff_1, 'staff', array[fx.store_1])
) as m (user_id, role, store_ids);

insert into public.customers (id, tenant_id, phone)
select c.id, fx.tenant_m, '+' || '849000' || c.tail
from fx
cross join lateral (
  values (fx.customer_a, '23301'), (fx.customer_b, '23302'), (fx.customer_c, '23303'), (fx.customer_d, '23304'), (fx.customer_e, '23305')
) as c (id, tail);
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_m, tenant_m, 'Synthetic programme M', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at)
select m.member, fx.tenant_m, fx.programme_m, m.customer, 'mini_app', timestamptz '2026-11-01 08:00+07'
from fx
cross join lateral (
  values (fx.member_a, fx.customer_a), (fx.member_b, fx.customer_b), (fx.member_c, fx.customer_c), (fx.member_d, fx.customer_d), (fx.member_e, fx.customer_e)
) as m (member, customer);
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
select fx.tenant_m, fx.programme_m, m.member, 'adjust', 0, 200, 100000, 'synthetic credit', timestamptz '2027-11-01 09:00+07', timestamptz '2026-11-01 09:00+07'
from fx
cross join lateral (values (fx.member_a), (fx.member_b), (fx.member_c), (fx.member_d), (fx.member_e)) as m (member);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_m, store_1, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], timestamptz '2026-10-01 00:00+07' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_m, store_1, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx;
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_m, programme_m, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, null::numeric, 0, 50, array[store_1], 'active'::public.coupon_status from fx;

create temp table held (name text primary key, redemption_id uuid, code text);
create temp table first_episode (id uuid);
grant select on fx, held, first_episode to authenticated;

create function pg_temp.as_user(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.hold(p_name text, p_member uuid, p_at timestamptz)
returns text
language sql
as $$
  with answer as (
    select app.redeem_coupon(p_member, (select id from public.coupons where reward_key = 'free-drink' and tenant_id = (select tenant_m from fx)), (select store_1 from fx), p_at) as a
  )
  insert into held (name, redemption_id, code)
  select p_name, (a ->> 'redemption_id')::uuid, a ->> 'code' from answer
  returning coalesce(code, 'refused');
$$;

create function pg_temp.verify(p_name text, p_at timestamptz)
returns text
language sql
as $$
  select pg_temp.as_user((select staff_1 from fx), format(
    'select app.staff_verify_redemption(%L::uuid, %L, %L::timestamptz) ->> %L',
    (select store_1 from fx), (select code from held where name = p_name), p_at, 'state'
  ));
$$;

create function pg_temp.invoice(p_name text, p_sold_at timestamptz, p_entry text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, net_amount, paid_amount)
  select fx.tenant_m, fx.store_1, fx.account_m, 'rn-' || p_name, p_sold_at, app.store_business_date(fx.store_1, p_sold_at), 100000, p_entry, 15000, 85000, 85000
  from fx
  returning id;
$$;

-- confirmed:found:alerts of one reconciliation after a sync, at a fixed moment
create function pg_temp.reconcile(p_at timestamptz)
returns text
language sql
as $$
  select concat_ws(':', r ->> 'discount_confirmed', r ->> 'mismatches_found', r ->> 'mismatch_alerts')
  from (select app.reconcile_loyalty((select tenant_m from fx), date '2026-11-09', date '2026-11-12', p_at) as r) x;
$$;

create function pg_temp.episode()
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(':', e.state, coalesce(e.resolution, '-'), e.facts ->> 'open_items', e.facts ->> 'verified_without_invoice', e.facts ->> 'discount_without_redemption', e.facts ->> 'amount_mismatch'), ',' order by e.opened_at, e.id), 'none')
  from public.alert_events e
  where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch';
$$;

create function pg_temp.queued(p_reason text default null)
returns text
language sql
as $$
  select coalesce(string_agg(h.name, ',' order by h.name), 'none')
  from public.loyalty_queue q
  join held h on h.redemption_id = q.redemption_id
  where q.tenant_id = (select tenant_m from fx) and (p_reason is null or q.reason = p_reason);
$$;

-- how many codes and phones of the fixture appear in the text of the queue
-- items and episodes of the tenant: examined codes : examined phones : hits
create function pg_temp.leaks()
returns text
language sql
as $$
  select concat_ws(':',
    (select count(*) from held),
    (select count(*) from public.customers c where c.tenant_id = (select tenant_m from fx)),
    (select count(*)
     from held h
     cross join public.customers c
     cross join lateral (
       select to_jsonb(q)::text as t from public.loyalty_queue q where q.tenant_id = (select tenant_m from fx)
       union all
       select to_jsonb(e)::text from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch'
     ) x
     where c.tenant_id = (select tenant_m from fx)
       and (position(upper(h.code) in upper(x.t)) > 0 or position(right(c.phone, 9) in x.t) > 0)));
$$;

-- Holds of the five members on the fallback rail, each with the entry name the
-- mapping gave at that moment.
select pg_temp.hold('a', (select member_a from fx), timestamptz '2026-11-10 10:00+07');
select pg_temp.hold('e', (select member_e from fx), timestamptz '2026-11-10 10:01+07');
select pg_temp.hold('b', (select member_b from fx), timestamptz '2026-11-10 10:05+07');
select pg_temp.hold('c', (select member_c from fx), timestamptz '2026-11-10 11:50+07');
select pg_temp.hold('d', (select member_d from fx), timestamptz '2026-11-10 13:50+07');
select is(
  (select concat_ws(':', count(*), string_agg(distinct r.pos_discount_name, ','), string_agg(distinct r.rail::text, ','), string_agg(distinct r.state::text, ','))
   from public.redemptions r where r.tenant_id = (select tenant_m from fx)),
  '5:Synthetic free drink:pos_payment_discount:held',
  'five holds on the fallback rail, each carrying the entry name its mapping gave when the hold was made'
);

-- Staff verify four of them at the till; member e never shows the code.
select is(
  pg_temp.verify('a', timestamptz '2026-11-10 10:10:00+07') || ',' || pg_temp.verify('b', timestamptz '2026-11-10 10:10:00+07')
    || ',' || pg_temp.verify('c', timestamptz '2026-11-10 12:00:00+07') || ',' || pg_temp.verify('d', timestamptz '2026-11-10 14:00:00+07'),
  'verified,verified,verified,verified',
  'staff verify the codes of a and b at 10:10, of c at 12:00 and of d at 14:00'
);
select is(
  (select concat_ws(':', r.state, r.verified_at is null) from public.redemptions r where r.id = (select redemption_id from held where name = 'e')),
  'held:t',
  'the code of e is never shown, so it stays held and unverified'
);

-- The till's invoices. The entry was renamed: a, b and c carry the new name.
-- d carries the mapped name in other case and spacing: the control.
select pg_temp.invoice('a', timestamptz '2026-11-10 10:11:00+07', 'Synthetic free drink (new)');
select pg_temp.invoice('b', timestamptz '2026-11-10 10:12:00+07', 'Synthetic free drink (new)');
select pg_temp.invoice('c', timestamptz '2026-11-10 12:01:00+07', 'Synthetic free drink (new)');
select pg_temp.invoice('d', timestamptz '2026-11-10 14:01:00+07', ' SYNTHETIC free drink ');

select is(
  pg_temp.reconcile(timestamptz '2026-11-10 14:10:00+07'),
  '1:0:0',
  'control: the invoice with the mapped entry (case and spacing aside) confirms the redemption of d, and the reconciliation lists nothing'
);
select is(
  (select concat_ws(':',
    (select count(*) from app.invoice_rail_evidence v join public.invoices i on i.id = v.invoice_id where i.external_id in ('rn-a', 'rn-b', 'rn-c') and v.kind = 'discount_entry'),
    (select count(*) from app.invoice_rail_evidence v join public.invoices i on i.id = v.invoice_id where i.external_id = 'rn-d' and v.kind = 'discount_entry' and v.on_rail))),
  '0:1',
  'the renamed entry is no longer recognised on the three invoices, the mapped one is on the rail for the control'
);
select is(
  (select count(*)::text from public.loyalty_queue where tenant_id = (select tenant_m from fx)) || ' ' || pg_temp.episode(),
  '0 none',
  'so far no item and no episode: the grace of a and b has not ended'
);

-- Boundary values on the grace period: 24 hours after the verification at 10:10.
select is(
  pg_temp.reconcile(timestamptz '2026-11-11 10:09:59+07'),
  '0:0:0',
  'boundary values: one second before the 24-hour grace ends, nothing is found'
);
select is(
  (select count(*)::text from public.loyalty_queue where tenant_id = (select tenant_m from fx)) || ' ' || pg_temp.episode(),
  '0 none',
  'and nothing is listed and no episode is open'
);
select is(
  pg_temp.reconcile(timestamptz '2026-11-11 10:10:00+07'),
  '0:2:1',
  'boundary values: at the end of the grace the two verified redemptions without a confirming invoice are found, in one episode'
);
insert into first_episode select e.id from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch';

select is(
  (select concat_ws(':', count(*), string_agg(distinct matched_path, ','), string_agg(distinct reason, ','), string_agg(distinct state::text, ','),
     count(*) filter (where invoice_id is null and cardinality(candidate_invoice_ids) = 0 and store_id = (select store_1 from fx) and membership_id is not null))
   from public.loyalty_queue where tenant_id = (select tenant_m from fx)),
  '2:D:verified_without_invoice:open:2',
  'two open path D items of the store, reason verified_without_invoice, with no invoice and no candidate'
);
select is(pg_temp.queued(), 'a,b', 'they are the redemptions of a and b: not d (confirmed), not e (never verified), not c (not yet due)');
select is(
  (select concat_ws(':', count(*), string_agg(distinct r.pos_discount_name, ','), string_agg(distinct r.rail::text, ','), count(*) filter (where r.verified_at is not null))
   from public.loyalty_queue q join public.redemptions r on r.id = q.redemption_id where q.tenant_id = (select tenant_m from fx)),
  '2:Synthetic free drink:pos_payment_discount:2',
  'each queue item reaches its redemption, which carries the rail''s entry name and its verification'
);
select is(
  (select concat_ws(' / ',
     (select string_agg(distinct r.pos_discount_name, ',') from public.loyalty_queue q join public.redemptions r on r.id = q.redemption_id where q.tenant_id = (select tenant_m from fx)),
     (select string_agg(distinct i.bill_discount_name, ',')
      from public.loyalty_queue q
      join public.redemptions r on r.id = q.redemption_id
      join public.invoices i on i.store_id = q.store_id
        and i.sold_at between r.verified_at - interval '2 minutes' and r.verified_at + interval '15 minutes'
      where q.tenant_id = (select tenant_m from fx)))),
  'Synthetic free drink / Synthetic free drink (new)',
  'the manager sees why: the entry of the rail differs from the entry on the invoices sold around the verification'
);
select is(
  (select count(*)::integer from public.loyalty_queue where tenant_id = (select tenant_m from fx) and reason = 'discount_without_redemption'),
  0,
  'the rename hides the invoices from the opposite check too: no discount_without_redemption item'
);
select is(pg_temp.episode(), 'open:-:2:2:0:0', 'exactly one redemption_mismatch episode, open, naming two items of kind verified_without_invoice');
select is(
  (select concat_ws(':', e.dedupe_key = 'redemption_mismatch:store:' || (select store_1 from fx), e.store_id = (select store_1 from fx), app.facts_are_count_only(e.facts),
     (select string_agg(k, ',' order by k) from jsonb_object_keys(e.facts) k))
   from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch'),
  't:t:t:amount_mismatch,discount_without_redemption,open_items,verified_without_invoice',
  'the episode is keyed on the store and its facts are four counts, never an entry name, a code or a phone'
);
select is(pg_temp.leaks(), '5:5:0', 'security: no redemption code and no phone of the five members appears in the text of the queue items or the episode');
select is(
  (select count(*)::integer from public.alert_events where tenant_id = (select tenant_m from fx) and store_id = (select store_2 from fx)),
  0,
  'negative case: the other store has no episode'
);

-- What each caller reads (RLS): the store's manager sees the items and the entry
-- name, the other store's manager and the store's staff see nothing.
set local role authenticated;
select is(
  pg_temp.as_user((select manager_1 from fx), $q$ select count(*)::text || ':' || coalesce(string_agg(distinct r.pos_discount_name, ','), '-') from public.loyalty_queue q join public.redemptions r on r.id = q.redemption_id $q$),
  '2:Synthetic free drink',
  'the store''s manager reads the two items and, through their redemptions, the entry name of the rail'
);
select is(
  pg_temp.as_user((select manager_1 from fx), $q$ select count(*)::text from public.alert_events where rule_key = 'redemption_mismatch' $q$),
  '1',
  'and the one episode'
);
select is(
  pg_temp.as_user((select owner_m from fx), $q$ select (select count(*) from public.loyalty_queue)::text || ':' || (select count(*) from public.alert_events where rule_key = 'redemption_mismatch')::text $q$),
  '2:1',
  'the owner reads the same'
);
select is(
  pg_temp.as_user((select manager_2 from fx), $q$ select (select count(*) from public.loyalty_queue)::text || ':' || (select count(*) from public.redemptions)::text || ':' || (select count(*) from public.alert_events where rule_key = 'redemption_mismatch')::text $q$),
  '0:0:0',
  'security: the manager of the other store reads no item, no redemption and no episode'
);
select is(
  pg_temp.as_user((select staff_1 from fx), $q$ select (select count(*) from public.loyalty_queue)::text || ':' || (select count(*) from public.redemptions)::text || ':' || (select count(*) from public.alert_events where rule_key = 'redemption_mismatch')::text $q$),
  '0:0:0',
  'security: staff of the store read no item, no redemption and no episode'
);
reset role;

-- State transition: a repeated run adds nothing; a later redemption joins the episode.
select is(pg_temp.reconcile(timestamptz '2026-11-11 10:10:00+07'), '0:0:0', 'negative case: running the reconciliation again at the same moment finds nothing new');
select is(
  (select count(*)::text from public.loyalty_queue where tenant_id = (select tenant_m from fx)) || ' ' || pg_temp.episode(),
  '2 open:-:2:2:0:0',
  'and lists nothing twice, in the same single episode'
);
select is(
  pg_temp.reconcile(timestamptz '2026-11-11 12:00:00+07'),
  '0:1:0',
  'boundary values: at the end of its own grace the redemption of c is found, and opens no second episode'
);
select is(pg_temp.queued(), 'a,b,c', 'the queue now holds a, b and c');
select is(
  (select concat_ws(':', count(*), bool_and(e.id = (select id from first_episode)), max(e.facts ->> 'verified_without_invoice'), max(e.facts ->> 'open_items'))
   from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch'),
  '1:t:3:3',
  'the same episode now names three items'
);
select is(pg_temp.leaks(), '5:5:0', 'security: still no code and no phone in the queue or the episode');
select is(
  (select concat_ws(' ',
     (select concat_ws(':', r.state, r.confirmed_invoice_id = (select id from public.invoices where external_id = 'rn-d')) from public.redemptions r where r.id = (select redemption_id from held where name = 'd')),
     (select concat_ws(':', r.state, r.verified_at is null) from public.redemptions r where r.id = (select redemption_id from held where name = 'e')))),
  'confirmed:t held:t',
  'control: d stayed confirmed by its invoice and e, which never showed its code, was never listed'
);

-- Security: no API role runs the reconciliation.
select ok(
  not has_function_privilege('authenticated', 'app.reconcile_loyalty(uuid, date, date, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.reconcile_loyalty(uuid, date, date, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.reconcile_redemptions(uuid, date, date, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.reconcile_redemptions(uuid, date, date, timestamptz)', 'execute'),
  'security: a signed-in user and anon run neither reconciliation'
);
select ok(
  has_function_privilege('service_role', 'app.reconcile_loyalty(uuid, date, date, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.reconcile_redemptions(uuid, date, date, timestamptz)', 'execute'),
  'the service role, which the sync runner uses, runs both'
);

select * from finish();
rollback;
