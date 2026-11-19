begin;
select plan(34);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000007201'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000007201'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000007201'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000007202'::uuid as store_2,
  'eeeeeeee-eeee-4eee-8eee-000000007201'::uuid as owner_m,
  'eeeeeeee-eeee-4eee-8eee-000000007202'::uuid as manager_1,
  'eeeeeeee-eeee-4eee-8eee-000000007203'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000007204'::uuid as viewer_m,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007201'::uuid as customer_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000007202'::uuid as customer_b,
  '99999999-9999-4999-8999-000000007201'::uuid as member_a,
  '99999999-9999-4999-8999-000000007202'::uuid as member_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000007201'::uuid as programme_m;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'redemption-recon-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_m, fx.manager_1, fx.staff_1, fx.viewer_m]) as u (id);

insert into public.tenants (id, slug, name, country_code)
select tenant_m, 'redemption-recon-pgtap', 'Redemption reconciliation pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_m, tenant_m, 'mock', 'redemption-recon-m', 'Synthetic account M' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_m, account_m, 'rr-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_m, account_m, 'rr-2', 'Synthetic store 2' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_m, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_m, 'owner', null::uuid[]),
    (fx.manager_1, 'manager', array[fx.store_1]),
    (fx.staff_1, 'staff', array[fx.store_1]),
    (fx.viewer_m, 'viewer', null::uuid[])
) as m (user_id, role, store_ids);

insert into public.customers (id, tenant_id, phone)
select customer_a, tenant_m, '+' || '849000' || '07201' from fx
union all
select customer_b, tenant_m, '+' || '849000' || '07202' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_m, tenant_m, 'Synthetic programme M', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at)
select member_a, tenant_m, programme_m, customer_a, 'mini_app', now() - interval '10 days' from fx
union all
select member_b, tenant_m, programme_m, customer_b, 'mini_app', now() - interval '10 days' from fx;

create temp table credits as
with inserted as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select fx.tenant_m, fx.programme_m, v.membership, 'adjust', v.stamps, v.points, v.points * 500, 'synthetic credit', now() + interval '30 days', now() - interval '5 days'
  from fx
  cross join lateral (values (fx.member_a, 16, 200), (fx.member_b, 0, 100)) as v (membership, stamps, points)
  returning id, membership_id, stamp_delta
)
select * from inserted;
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select (select tenant_m from fx), c.membership_id, c.id, now() - interval '5 days', now() + interval '180 days'
from credits c
cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_m, store_1, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], now() - interval '30 days' from fx
union all
select tenant_m, store_2, 'crm_code_pool', '{pool-1}', now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, crm_programme_external_id, einvoice_display)
select tenant_m, store_1, 'free-drink', 'Synthetic free drink', null, 'discount'::public.einvoice_display from fx
union all
select tenant_m, store_1, 'ten-pct', 'Synthetic ten percent', null, 'discount' from fx
union all
select tenant_m, store_2, 'free-drink', null, 'pool-1', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_m, store_2, 'free-drink', 'SYN-R1' from fx;

select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, cost_points, store_ids, status)
select tenant_m, programme_m, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, null, 8, 0, null::uuid[], 'active'::public.coupon_status from fx
union all
select tenant_m, programme_m, 'ten-pct', 'Ten percent off', 'percent_off', 10, 0, 50, array[store_1], 'active' from fx;

create temp table held (name text primary key, redemption_id uuid, code text);
grant select on fx to authenticated, service_role;

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

create function pg_temp.hold(p_name text, p_member uuid, p_reward text, p_store uuid, p_at timestamptz)
returns text
language sql
as $$
  with answer as (
    select app.redeem_coupon(p_member, (select id from public.coupons where reward_key = p_reward), p_store, p_at) as a
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

create function pg_temp.invoice(p_name text, p_store uuid, p_sold_at timestamptz, p_amount numeric, p_discount_name text, p_discount numeric, p_voucher text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, voucher_code, voucher_amount, net_amount, paid_amount)
  select fx.tenant_m, p_store, fx.account_m, 'rr-' || p_name, p_sold_at, app.store_business_date(p_store, p_sold_at),
    p_amount, p_discount_name, case when p_discount_name is not null then p_discount else 0 end, p_voucher,
    case when p_voucher is not null then p_discount else 0 end, p_amount - p_discount, p_amount - p_discount
  from fx
  returning id;
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty(
    (select tenant_m from fx),
    app.store_business_date((select store_1 from fx), now()) - 3,
    app.store_business_date((select store_1 from fx), now()) + 1,
    p_at
  ) - array['a_earned', 'a_refused', 'b_matched', 'b_queued', 'b_rejected', 'b_pending', 'c_matched', 'c_queued', 'c_rejected', 'c_pending', 'd_confirmed', 'd_earned', 'd_refused', 'expired_codes', 'expired_checkins', 'expired_claims', 'callback_confirmed', 'callback_earned', 'pool_codes_used', 'rail_evidence'];
$$;

create function pg_temp.episode()
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(':', e.state, coalesce(e.resolution, '-'), e.facts ->> 'open_items', e.facts ->> 'verified_without_invoice', e.facts ->> 'discount_without_redemption', e.facts ->> 'amount_mismatch'), ',' order by e.opened_at, e.resolved_at nulls last, e.store_id, e.id), 'none')
  from public.alert_events e
  where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch';
$$;

create temp table pick (reason text primary key, id uuid);
grant select on pick to authenticated;

create function pg_temp.pick(p_reason text)
returns uuid
language sql
as $$
  insert into pick (reason, id)
  select p_reason, q.id
  from public.loyalty_queue q
  where q.tenant_id = (select tenant_m from fx) and q.reason = p_reason and q.state = 'open'
  order by q.created_at
  limit 1
  on conflict (reason) do update set id = excluded.id
  returning id;
$$;

create function pg_temp.dismiss(p_reason text)
returns text
language sql
as $$
  select pg_temp.as_user((select manager_1 from fx), format(
    'select public.resolve_loyalty_queue_item(%L, null, %L) ->> %L',
    (select id from pick where reason = p_reason), 'checked with the cashier', 'state'
  ));
$$;

select is(
  (select concat_ws(':', c.rule_key, c.category, c.delivery, c.default_severity, array_to_string(c.default_roles, '+'), c.default_cooldown, coalesce(c.remind_every::text, '-'), c.notify_on_resolve, c.store_scoped, c.default_enabled, c.sort_order)
   from public.alert_rule_catalog c where c.rule_key = 'redemption_mismatch'),
  'redemption_mismatch:business:immediate:warning:owner+manager:00:00:00:-:f:t:t:195',
  'redemption_mismatch is a store-scoped immediate business rule for owners and managers'
);
select ok(
  app.alert_rule_params_valid('redemption_mismatch', (select default_params from public.alert_rule_catalog where rule_key = 'redemption_mismatch'))
  and (select default_params from public.alert_rule_catalog where rule_key = 'redemption_mismatch') = '{"grace_hours": 24, "amount_tolerance": 1000}'::jsonb,
  'its defaults are a 24-hour grace and a 1,000 tolerance, valid under its own schema'
);
select ok(
  not app.alert_rule_params_valid('redemption_mismatch', '{"grace_hours": 0}'::jsonb)
  and not app.alert_rule_params_valid('redemption_mismatch', '{"amount_tolerance": -1}'::jsonb),
  'a grace under an hour or a negative tolerance is refused'
);

select pg_temp.hold('a_drink', (select member_a from fx), 'free-drink', (select store_1 from fx), now() - interval '30 hours');
select is(pg_temp.verify('a_drink', now() - interval '29 hours'), 'verified', 'staff verify a free drink at the till');
select is(
  pg_temp.reconcile(now() - interval '6 hours'),
  '{"discount_confirmed": 0, "discount_earned": 0, "mismatches_found": 0, "mismatch_alerts": 0}'::jsonb,
  'within the grace hours a verified code without an invoice is not yet a mismatch'
);
select is(
  pg_temp.reconcile(now()),
  '{"discount_confirmed": 0, "discount_earned": 0, "mismatches_found": 1, "mismatch_alerts": 1}'::jsonb,
  'a day after the verification without a synced invoice it is'
);
select is(
  (select concat_ws(':', q.matched_path, q.reason, q.state, q.redemption_id = (select redemption_id from held where name = 'a_drink'), q.membership_id = (select member_a from fx), cardinality(q.candidate_invoice_ids))
   from public.loyalty_queue q where q.tenant_id = (select tenant_m from fx)),
  'D:verified_without_invoice:open:t:t:0',
  'the redemption is listed in the manager queue on path D'
);
select is(pg_temp.episode(), 'open:-:1:1:0:0', 'and opens a redemption_mismatch episode for the store with counts');
select is(
  (select concat_ws(':', e.dedupe_key = 'redemption_mismatch:store:' || (select store_1 from fx), e.store_id = (select store_1 from fx), app.facts_are_count_only(e.facts),
     (select string_agg(k, ',' order by k) from jsonb_object_keys(e.facts) k))
   from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.rule_key = 'redemption_mismatch'),
  't:t:t:amount_mismatch,discount_without_redemption,open_items,verified_without_invoice',
  'the episode is keyed on the store and its facts are counts only, never a code, a phone or an amount'
);
select is(
  pg_temp.reconcile(now() + interval '1 hour'),
  '{"discount_confirmed": 0, "discount_earned": 0, "mismatches_found": 0, "mismatch_alerts": 0}'::jsonb,
  'running the reconciliation again finds nothing new'
);
select is((select count(*)::integer from public.loyalty_queue where tenant_id = (select tenant_m from fx)), 1, 'and lists nothing twice');
select pg_temp.pick('verified_without_invoice');
set local role authenticated;
select is(
  pg_temp.as_user((select manager_1 from fx), format('select public.resolve_loyalty_queue_item(%L, %L, %L)::text',
    (select id from pick where reason = 'verified_without_invoice'), gen_random_uuid(), 'a guess')),
  'error:22023',
  'a redemption item has no candidate invoice to choose'
);
select is(pg_temp.dismiss('verified_without_invoice'), 'dismissed', 'the store''s manager dismisses it after checking');
reset role;
select is(
  pg_temp.reconcile(now() + interval '2 hours') ->> 'mismatch_alerts',
  '0',
  'with no open item the next reconciliation opens nothing'
);
select is(pg_temp.episode(), 'resolved:cleared:1:1:0:0', 'and resolves the episode as cleared');

select pg_temp.invoice('no-redemption', (select store_1 from fx), now() - interval '10 minutes', 100000, 'SYNTHETIC TEN PERCENT', 10000, null);
select pg_temp.invoice('pool-code', (select store_2 from fx), now() - interval '20 minutes', 60000, null, 15000, 'syn-r1');
select is(
  pg_temp.reconcile(now()),
  '{"discount_confirmed": 0, "discount_earned": 0, "mismatches_found": 2, "mismatch_alerts": 2}'::jsonb,
  'an invoice carrying a reward''s discount entry and one carrying a pool code, both without a redemption, are mismatches'
);
select is(
  (select string_agg(concat_ws(':', s.external_id, q.reason, i.external_id), ',' order by s.external_id)
   from public.loyalty_queue q join public.stores s on s.id = q.store_id join public.invoices i on i.id = q.invoice_id
   where q.tenant_id = (select tenant_m from fx) and q.state = 'open'),
  'rr-1:discount_without_redemption:rr-no-redemption,rr-2:discount_without_redemption:rr-pool-code',
  'each is listed with its invoice at its store'
);
select is(pg_temp.episode(), 'resolved:cleared:1:1:0:0,open:-:1:0:1:0,open:-:1:0:1:0', 'each store opens its own episode');

select pg_temp.hold('b_ten', (select member_b from fx), 'ten-pct', (select store_1 from fx), now() - interval '15 minutes');
select is(pg_temp.verify('b_ten', now() - interval '12 minutes'), 'verified', 'a member''s ten percent is verified at the till just before that sale');
select is(
  pg_temp.reconcile(now() + interval '5 minutes'),
  '{"discount_confirmed": 1, "discount_earned": 1, "mismatches_found": 0, "mismatch_alerts": 0}'::jsonb,
  'the next reconciliation confirms the redemption with that invoice'
);
select is(
  (select concat_ws(':', q.state, q.chosen_invoice_id = q.invoice_id) from public.loyalty_queue q join public.stores s on s.id = q.store_id where s.external_id = 'rr-1' and q.reason = 'discount_without_redemption'),
  'resolved:t',
  'the invoice''s mismatch resolves itself'
);
select is(
  (select e.state || ':' || coalesce(e.resolution, '-') from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.store_id = (select store_1 from fx) and e.rule_key = 'redemption_mismatch' order by e.opened_at desc, e.id limit 1),
  'resolved:cleared',
  'and so does the store''s episode'
);

select pg_temp.hold('a_ten', (select member_a from fx), 'ten-pct', (select store_1 from fx), now() - interval '45 minutes');
select is(pg_temp.verify('a_ten', now() - interval '40 minutes'), 'verified', 'another ten percent is verified');
select pg_temp.invoice('over-discount', (select store_1 from fx), now() - interval '35 minutes', 100000, 'Synthetic ten percent', 30000, null);
select is(
  pg_temp.reconcile(now() + interval '10 minutes'),
  '{"discount_confirmed": 1, "discount_earned": 1, "mismatches_found": 1, "mismatch_alerts": 1}'::jsonb,
  'a confirmed redemption whose invoice gives 30 % instead of 10 % is an amount mismatch'
);
select is(
  (select concat_ws(':', q.reason, q.redemption_id = (select redemption_id from held where name = 'a_ten'), i.external_id) from public.loyalty_queue q join public.invoices i on i.id = q.invoice_id where q.reason = 'amount_mismatch'),
  'amount_mismatch:t:rr-over-discount',
  'listed with its redemption and invoice'
);
select is(
  (select e.facts ->> 'amount_mismatch' from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.store_id = (select store_1 from fx) and e.state = 'open'),
  '1',
  'in a new episode of the store'
);
select pg_temp.pick('amount_mismatch');
set local role authenticated;
select is(pg_temp.dismiss('amount_mismatch'), 'dismissed', 'the manager dismisses it');
reset role;
select pg_temp.reconcile(now() + interval '20 minutes');
select is(
  (select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_m from fx) and e.store_id = (select store_1 from fx) and e.state = 'open'),
  0,
  'and the store''s episode resolves at the next reconciliation'
);

set local role authenticated;
select is(
  pg_temp.as_user((select owner_m from fx), format(
    $q$ select string_agg(concat_ws(':', s.external_id, r.reward_key, r.redemptions, r.held, r.confirmed, r.released, r.stamps_redeemed, r.points_redeemed, r.reward_cost_amount, r.member_invoices, r.confirmed_share), ',' order by s.external_id, r.reward_key)
        from public.redemption_summary(array[%L, %L]::uuid[], %L::date, %L::date) r join public.stores s on s.id = r.store_id $q$,
    (select store_1 from fx), (select store_2 from fx),
    app.store_business_date((select store_1 from fx), now()) - 3, app.store_business_date((select store_1 from fx), now()))),
  'rr-1:free-drink:1:1:0:0:0:0:0:2:0.0000,rr-1:ten-pct:2:0:2:0:0:100:40000.00:2:1.0000',
  'the summary per store and reward matches the hand count: holds, states, points spent, the discounts given and the share of member invoices'
);
select is(
  pg_temp.as_user((select manager_1 from fx), format('select count(*)::text from public.redemption_summary(array[%L, %L]::uuid[], current_date - 3, current_date + 1)', (select store_1 from fx), (select store_2 from fx))),
  '2',
  'a store-limited manager gets the rows of their store'
);
select is(
  pg_temp.as_user((select staff_1 from fx), format('select count(*)::text from public.redemption_summary(array[%L]::uuid[], current_date - 3, current_date + 1)', (select store_1 from fx))),
  '0',
  'staff get no row'
);
select is(
  pg_temp.as_user((select owner_m from fx), format('select count(*)::text from public.redemption_summary(array_fill(%L::uuid, array[51]), current_date - 3, current_date)', (select store_1 from fx))),
  'error:22023',
  'more than 50 stores are refused'
);
select is(
  pg_temp.as_user((select owner_m from fx), format('select count(*)::text from public.redemption_summary(array[%L]::uuid[], current_date - 92, current_date)', (select store_1 from fx))),
  'error:22023',
  'more than 92 days are refused'
);
select is(
  pg_temp.as_user((select owner_m from fx), 'select count(*)::text from public.redemption_summary(array[]::uuid[], current_date - 3, current_date)'),
  '0',
  'no store gives no row'
);
reset role;

select * from finish();
rollback;
