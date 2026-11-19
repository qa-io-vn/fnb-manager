-- ISTQB decision table testing of earn eligibility in app.loyalty_earn, with
-- SQL as the unit under test. Five conditions, every one of the 2^5 = 32 rules:
--   C1 the net amount reaches the minimum bill (50,000)
--   C2 the phone is a staff phone (loyalty_staff_phones)
--   C3 the invoice's order source is excluded (excluded_order_sources)
--   C4 the phone already earned the daily cap (3) that business date
--   C5 the programme is active (otherwise paused)
-- Actions, in the refusal order of app.loyalty_earn: programme_inactive when
-- not C5, else excluded_source when C3, else excluded_phone when C2, else
-- daily_cap when C4, else an earn: a stamp and 6 points when C1, otherwise
-- 4 points and below_minimum. The TypeScript port is tested with the same
-- table for C1 to C4 in packages/core/test/unit/loyalty-test-design.test.ts.
begin;
select plan(35);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013201'::uuid as tenant_d,
  'cccccccc-cccc-4ccc-8ccc-000000013201'::uuid as account_d,
  'ffffffff-ffff-4fff-8fff-000000013201'::uuid as store_d,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000013201'::uuid as programme_d,
  timestamptz '2026-11-10 08:00+07' as t0;

insert into public.tenants (id, slug, name) select tenant_d, 'loyalty-decision-pgtap', 'Loyalty decision table pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_d, tenant_d, 'mock', 'loyalty-decision', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_d, tenant_d, account_d, 'dt-1', 'Synthetic store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, excluded_order_sources)
select programme_d, tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, array['GrabFood'] from fx;

create temp table rules as
select
  n as rule,
  (n & 1) <> 0 as c1_minimum_bill,
  (n & 2) <> 0 as c2_staff_phone,
  (n & 4) <> 0 as c3_excluded_source,
  (n & 8) <> 0 as c4_daily_cap,
  (n & 16) = 0 as c5_programme_active,
  null::text as actual
from generate_series(0, 31) n;

create function pg_temp.yn(p_value boolean) returns text language sql immutable as $$ select case when p_value then 'Y' else 'N' end; $$;

create function pg_temp.expected(r rules)
returns text
language sql
immutable
as $$
  select case
    when not r.c5_programme_active then '0:0:programme_inactive:f'
    when r.c3_excluded_source then '0:0:excluded_source:f'
    when r.c2_staff_phone then '0:0:excluded_phone:f'
    when r.c4_daily_cap then '0:0:daily_cap:f'
    when r.c1_minimum_bill then '1:6:-:t'
    else '0:4:below_minimum:t'
  end;
$$;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_source text)
returns uuid
language sql
as $$
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, source_name)
  select fx.tenant_d, fx.store_d, fx.account_d, 'dt-' || p_name, p_sold, app.store_business_date(fx.store_d, p_sold), p_net, p_net, p_net, p_source
  from fx
  returning id;
$$;

do $$
declare
  r rules;
  v_t0 timestamptz := (select t0 from fx);
  v_tenant uuid := (select tenant_d from fx);
  v_phone text;
  v_member uuid;
  v_invoice uuid;
  v_result text;
begin
  for r in select * from rules order by rule loop
    v_phone := '+84900000' || (500 + r.rule)::text;
    update public.loyalty_programmes set status = 'active' where id = (select programme_d from fx);
    v_member := app.loyalty_join(v_tenant, app.loyalty_customer_for_phone(v_tenant, v_phone, v_t0 - interval '1 day'), 'mini_app', (select store_d from fx), null, null, v_t0 - interval '1 day');
    if r.c4_daily_cap then
      for k in 1..3 loop
        v_invoice := pg_temp.invoice(r.rule || '-earlier-' || k, v_t0 + make_interval(mins => k), 60000, 'Tại quán');
        perform app.loyalty_earn(v_invoice, v_member, 'A', v_t0 + make_interval(mins => k));
      end loop;
    end if;
    if r.c2_staff_phone then
      insert into public.loyalty_staff_phones (tenant_id, phone, label) values (v_tenant, v_phone, 'Synthetic staff');
    end if;
    if not r.c5_programme_active then
      update public.loyalty_programmes set status = 'paused' where id = (select programme_d from fx);
    end if;
    v_invoice := pg_temp.invoice(
      r.rule || '-tested',
      v_t0 + interval '1 hour',
      case when r.c1_minimum_bill then 60000 else 45000 end,
      case when r.c3_excluded_source then ' grabfood ' else 'Tại quán' end
    );
    select concat_ws(':', e.stamps, e.points, coalesce(e.refusal, '-'), e.entry_id is not null) into v_result
    from app.loyalty_earn(v_invoice, v_member, 'A', v_t0 + interval '1 hour') e;
    update rules set actual = v_result where rules.rule = r.rule;
  end loop;
  update public.loyalty_programmes set status = 'active' where id = (select programme_d from fx);
end;
$$;

select is(
  (select count(distinct (c1_minimum_bill, c2_staff_phone, c3_excluded_source, c4_daily_cap, c5_programme_active))::integer from rules),
  32,
  'decision table: the 32 rules cover every combination of the five conditions once'
);

select is(
  r.actual,
  pg_temp.expected(r),
  format('decision table rule %s: C1 minimum bill=%s, C2 staff phone=%s, C3 excluded source=%s, C4 daily cap reached=%s, C5 programme active=%s',
    r.rule + 1, pg_temp.yn(r.c1_minimum_bill), pg_temp.yn(r.c2_staff_phone), pg_temp.yn(r.c3_excluded_source), pg_temp.yn(r.c4_daily_cap), pg_temp.yn(r.c5_programme_active))
)
from rules r
order by r.rule;

select is(
  (select count(*)::integer from public.loyalty_refusals f join public.invoices i on i.id = f.invoice_id where i.external_id like 'dt-%-tested'),
  (select count(*)::integer from rules r where pg_temp.expected(r) not in ('1:6:-:t')),
  'decision table: every refused or below-minimum tested invoice stores exactly one refusal row'
);

select is(
  (select string_agg(distinct f.reason, ',' order by f.reason) from public.loyalty_refusals f join public.invoices i on i.id = f.invoice_id where i.external_id like 'dt-%-tested'),
  'below_minimum,daily_cap,excluded_phone,excluded_source,programme_inactive',
  'decision table: each of the five refusal actions is reached'
);

select * from finish();
rollback;
