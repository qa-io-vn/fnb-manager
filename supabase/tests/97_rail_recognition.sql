begin;
select plan(14);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009701'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000009701'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000009701'::uuid as store_1;

insert into public.tenants (id, slug, name, country_code)
select tenant_m, 'rail-recognition-pgtap', 'Rail recognition pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_m, tenant_m, 'mock', 'rail-recognition-m', 'Synthetic account M' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_m, account_m, 'rr-97', 'Synthetic store 1' from fx;
insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_m, store_1, 'crm_code_pool'::public.coupon_rail, '{100001}'::text[], now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, pos_free_item_external_id, crm_programme_external_id, einvoice_display)
select tenant_m, store_1, 'free-drink', 'Synthetic free drink', 'ITEM-F', '100001', 'zero_price_line'::public.einvoice_display from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code)
select tenant_m, store_1, 'free-drink', 'POOL0001' from fx;

create function pg_temp.sale(p_name text, p_sold_at timestamptz, p_status public.invoice_status default 'completed')
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.invoices (
    tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, customer_phone, voucher_code,
    gross_amount, item_discount_amount, bill_discount_name, bill_discount_amount, net_amount, paid_amount, status
  )
  select fx.tenant_m, fx.store_1, fx.account_m, 'rr97-' || p_name, p_sold_at, app.store_business_date(fx.store_1, p_sold_at),
    '0900' || '009701', ' pool0001 ', 100000, 10000, 'synthetic FREE drink', 5000, 85000, 85000, p_status
  from fx
  returning id into v_id;
  insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name)
  select fx.tenant_m, fx.store_1, v_id, v.external_id, 'item', v.item, v.item, v.gross, v.discount, v.gross - v.discount, v.promotion, v.promotion_name
  from fx
  cross join lateral (
    values
      ('l1', 'ITEM-A', 60000::numeric, 10000::numeric, '100001', 'Synthetic free drink'),
      ('l2', 'ITEM-F', 30000, 30000, null, null),
      ('l3', 'ITEM-B', 40000, 0, null, null)
  ) as v (external_id, item, gross, discount, promotion, promotion_name);
  return v_id;
end;
$$;

create function pg_temp.recognise()
returns integer
language sql
as $$
  select app.recognise_rail_events(
    (select tenant_m from fx),
    app.store_business_date((select store_1 from fx), now()) - 2,
    app.store_business_date((select store_1 from fx), now()),
    now()
  );
$$;

create function pg_temp.evidence(p_name text)
returns text
language sql
as $$
  select coalesce(string_agg(e.kind || ':' || coalesce(e.rail::text, '-') || ':' || e.on_rail::text || ':' || coalesce(e.reward_key, '-') || ':' || e.amount::integer::text, ',' order by e.kind), 'none')
  from app.invoice_rail_evidence e
  join public.invoices i on i.id = e.invoice_id
  where i.external_id = 'rr97-' || p_name;
$$;

select pg_temp.sale('a', now() - interval '2 hours');
select pg_temp.sale('voided', now() - interval '2 hours', 'voided');
select is(pg_temp.recognise(), 5, 'the recognition records the evidence of the non-voided invoice');
select is(
  pg_temp.evidence('a'),
  'crm_promotion:crm_code_pool:true:free-drink:15000,discount_entry:crm_code_pool:false:free-drink:5000,member_phone:crm_code_pool:true:-:0,pool_code:crm_code_pool:true:free-drink:15000,zero_price_line:crm_code_pool:false:free-drink:30000',
  'on the pool rail a pool code and the CRM promotion line are on the rail; the discount entry and the 0-price line are not'
);
select is(pg_temp.evidence('voided'), 'none', 'a voided invoice carries no evidence');
select is(pg_temp.recognise(), 5, 'a second run recognises the same rows');
select is((select count(*)::integer from app.invoice_rail_evidence where tenant_id = (select tenant_m from fx)), 5, 'and replaces them instead of adding');

insert into public.coupon_rails (tenant_id, store_id, rail, active_from)
select tenant_m, store_1, 'pos_payment_discount'::public.coupon_rail, now() - interval '1 hour' from fx;
select pg_temp.sale('b', now() - interval '30 minutes');
select pg_temp.recognise();
select is(
  pg_temp.evidence('b'),
  'crm_promotion:pos_payment_discount:false:free-drink:15000,discount_entry:pos_payment_discount:true:free-drink:5000,member_phone:pos_payment_discount:true:-:0,pool_code:pos_payment_discount:false:free-drink:15000,zero_price_line:pos_payment_discount:true:free-drink:30000',
  'after switching the store to the fallback rail the discount entry and the 0-price line are on the rail, with no code change'
);
select is(
  pg_temp.evidence('a'),
  'crm_promotion:crm_code_pool:true:free-drink:15000,discount_entry:crm_code_pool:false:free-drink:5000,member_phone:crm_code_pool:true:-:0,pool_code:crm_code_pool:true:free-drink:15000,zero_price_line:crm_code_pool:false:free-drink:30000',
  'an invoice sold before the switch keeps the rail of its time'
);

update public.coupon_rail_rewards set pos_discount_name = 'Another entry' where store_id = (select store_1 from fx);
select pg_temp.recognise();
select is(
  (select count(*)::integer from app.invoice_rail_evidence where tenant_id = (select tenant_m from fx) and kind = 'discount_entry'),
  0,
  'a renamed discount entry is no longer recognised'
);

select is(
  (select count(*)::integer from app.invoice_rail_evidence e where e.tenant_id = (select tenant_m from fx) and (to_jsonb(e)::text like '%900009701%' or to_jsonb(e)::text ilike '%pool0001%')),
  0,
  'no evidence row carries a phone or a code'
);

select is(
  (
    app.reconcile_redemptions(
      (select tenant_m from fx),
      app.store_business_date((select store_1 from fx), now()) - 1,
      app.store_business_date((select store_1 from fx), now()),
      now()
    ) ->> 'rail_evidence'
  )::integer,
  8,
  'the redemption reconciliation recognises the evidence first'
);
select is(
  (select count(*)::integer from public.loyalty_queue where tenant_id = (select tenant_m from fx) and reason = 'discount_without_redemption'),
  2,
  'and lists the invoices whose pool code no redemption confirms'
);

select ok(has_function_privilege('service_role', 'app.recognise_rail_events(uuid, date, date, timestamptz)', 'execute'), 'the service role recognises');
select ok(not has_function_privilege('authenticated', 'app.recognise_rail_events(uuid, date, date, timestamptz)', 'execute'), 'a signed-in user does not');
select ok(not has_table_privilege('authenticated', 'app.invoice_rail_evidence', 'select'), 'no API role reads the evidence');

select * from finish();
rollback;
