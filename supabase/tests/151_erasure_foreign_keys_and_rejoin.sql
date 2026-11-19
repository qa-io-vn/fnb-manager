-- G-05, G-06 (database part). ISTQB techniques: state transition (live, erased, new evidence, re-joined) and error guessing
-- (the same phone in either form, another tenant, a later sync). The tables to check are found from the foreign keys, so a new table is caught.
begin;
select plan(23);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000015101'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000015102'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000015101'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000015102'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000015101'::uuid as store_d,
  'ffffffff-ffff-4fff-8fff-000000015102'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000015109'::uuid as store_o,
  'eeeeeeee-eeee-4eee-8eee-000000015101'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000015102'::uuid as manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000015103'::uuid as store_manager_d,
  'eeeeeeee-eeee-4eee-8eee-000000015104'::uuid as staff_d,
  'eeeeeeee-eeee-4eee-8eee-000000015105'::uuid as viewer_d,
  'eeeeeeee-eeee-4eee-8eee-000000015106'::uuid as owner_o,
  'eeeeeeee-eeee-4eee-8eee-000000009111'::uuid as login_x,
  'eeeeeeee-eeee-4eee-8eee-000000009112'::uuid as login_y,
  '44444444-4444-4444-8444-000000015101'::uuid as brand_d,
  '55555555-5555-4555-8555-000000015101'::uuid as app_d;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'dsr-erasure-' || right(u.id::text, 4) || '@example.com', '{}'::jsonb
from fx cross join lateral unnest(array[fx.owner_d, fx.manager_d, fx.store_manager_d, fx.staff_d, fx.viewer_d, fx.owner_o, fx.login_x, fx.login_y]) as u (id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select gen_random_uuid(), login_x, now() - interval '1 day', now() - interval '1 day' from fx;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'dsr-erasure-pgtap', 'DSR erasure pgTAP', 'VN' from fx
union all
select tenant_o, 'dsr-erasure-other-pgtap', 'DSR erasure other pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'dsr-erasure', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'dsr-erasure-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d, tenant_d, account_d, 'dsr-1', 'dsr-1', 'Synthetic store 1' from fx
union all
select store_d2, tenant_d, account_d, 'dsr-2', 'dsr-2', 'Synthetic store 2' from fx
union all
select store_o, tenant_o, account_o, 'dsr-9', 'dsr-9', 'Synthetic other store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_d, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_d, 'owner', null::uuid[]), (fx.manager_d, 'manager', null::uuid[]), (fx.store_manager_d, 'manager', array[fx.store_d]),
         (fx.staff_d, 'staff', array[fx.store_d]), (fx.viewer_d, 'viewer', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_o, owner_o, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_d, tenant_d, 'brand-1', 'Synthetic brand', array[store_d, store_d2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_d, tenant_d, brand_d, 'syn-app-9101', 'ZALO_APP_SECRET_BRAND_1' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx
union all
select tenant_o, 'Synthetic other programme', date '2026-11-01', 'below_threshold', 'active' from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select v.name, app.loyalty_customer_for_phone(v.tenant, v.phone, now() - interval '20 days')
from fx cross join lateral (
  values ('customer_x', fx.tenant_d, '0900009101'), ('customer_y', fx.tenant_d, '0900009102'), ('customer_z', fx.tenant_d, '0900009103'),
         ('customer_x_other', fx.tenant_o, '0900009101')
) as v (name, tenant, phone);
update public.customers set name = 'Synthetic X' where id = (select id from ids where name = 'customer_x');
insert into ids
select 'member_' || substr(c.name, 10), app.loyalty_join(
  c.tenant, c.id, 'mini_app', c.store, case when c.tenant = fx.tenant_d then fx.brand_d end,
  case when c.tenant = fx.tenant_d then 'syn-zalo-' || substr(c.name, 10, 1) end, now() - interval '10 days'
)
from fx cross join lateral (
  select i.name, i.id, cu.tenant_id as tenant, case when cu.tenant_id = fx.tenant_d then fx.store_d else fx.store_o end as store
  from ids i join public.customers cu on cu.id = i.id
  where i.name like 'customer_%'
) c;

with credits as (
  insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
  select m.tenant_id, m.programme_id, m.id, 'adjust', 20, 100, 50000, 'synthetic credit', now() + interval '300 days', now() - interval '9 days'
  from public.memberships m
  where m.id in (select id from ids where name in ('member_x', 'member_y'))
  returning id, tenant_id, membership_id, stamp_delta
)
insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
select c.tenant_id, c.membership_id, c.id, now() - interval '9 days', now() + interval '180 days'
from credits c cross join lateral generate_series(1, c.stamp_delta);

insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_d, store_d, 'crm_code_pool'::public.coupon_rail, '{pool-1}'::text[], now() - interval '30 days' from fx
union all
select tenant_d, store_d2, 'crm_code_pool', '{pool-1}', now() - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
select tenant_d, store_d, 'free-drink', 'pool-1', 'discount'::public.einvoice_display from fx
union all
select tenant_d, store_d2, 'free-drink', 'pool-1', 'discount' from fx;
insert into public.coupon_codes (tenant_id, store_id, reward_key, code, imported_at)
select fx.tenant_d, fx.store_d, 'free-drink', v.code, now() - make_interval(hours => v.age)
from fx cross join (values ('SYN-91A', 5), ('SYN-91B', 4), ('SYN-91C', 3), ('SYN-91D', 2)) as v (code, age);
select set_config('request.jwt.claims', '', true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, status)
select fx.tenant_d, p.id, 'free-drink', 'Free drink', 'free_item'::public.coupon_reward_kind, 5, 0, 'active'::public.coupon_status
from fx join public.loyalty_programmes p on p.tenant_id = fx.tenant_d;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_phone text default null, p_customer uuid default null, p_voucher text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name, customer_id, voucher_code)
    select fx.tenant_d, fx.store_d, fx.account_d, 'dsr-' || p_name, p_sold, app.store_business_date(fx.store_d, p_sold), p_net, p_net, p_net,
      p_phone, case when p_phone is not null then 'Synthetic till name' end, p_customer, p_voucher
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

insert into ids
select 'redemption_x1', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '5 days') ->> 'redemption_id')::uuid;
select pg_temp.invoice('inv_redeemed', now() - interval '5 days' + interval '10 minutes', 65000, null, null, (select code from public.redemptions where id = (select id from ids where name = 'redemption_x1')));
select app.confirm_redemption((select id from ids where name = 'redemption_x1'), (select id from ids where name = 'inv_redeemed'), now() - interval '5 days' + interval '15 minutes');
insert into ids
select 'redemption_x2', (app.redeem_coupon((select id from ids where name = 'member_x'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;
insert into ids
select 'redemption_y', (app.redeem_coupon((select id from ids where name = 'member_y'), (select id from public.coupons where reward_key = 'free-drink'), (select store_d from fx), now() - interval '1 hour') ->> 'redemption_id')::uuid;

select pg_temp.invoice('inv_phone', now() - interval '3 days', 60000, '0900009101');
select app.loyalty_earn((select id from ids where name = 'inv_phone'), (select id from ids where name = 'member_x'), 'A', now() - interval '3 days');
select pg_temp.invoice('inv_linked', now() - interval '2 days', 20000, null, (select id from ids where name = 'customer_x'));
select app.loyalty_earn((select id from ids where name = 'inv_linked'), (select id from ids where name = 'member_x'), 'A', now() - interval '2 days');
select pg_temp.invoice('inv_y', now() - interval '2 days', 70000, '0900009102');
select app.loyalty_earn((select id from ids where name = 'inv_y'), (select id from ids where name = 'member_y'), 'A', now() - interval '2 days');
select app.loyalty_submit_claim((select id from ids where name = 'member_x'), (select store_d from fx), app.store_business_date((select store_d from fx), now() - interval '1 day'), '777', 50000, now() - interval '1 hour');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_x'), (select store_d from fx), now() - interval '30 minutes');
select app.loyalty_issue_checkin_code((select id from ids where name = 'member_y'), (select store_d from fx), now() - interval '30 minutes');
insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, matched_path, candidate_invoice_ids, reason, created_at)
select tenant_d, store_d, (select id from ids where name = 'member_x'), (select id from ids where name = 'redemption_x2'), 'D', '{}'::uuid[], 'verified_without_invoice', now() - interval '10 minutes' from fx;
insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, reason, requested_by)
select tenant_d, store_d, (select id from ids where name = 'member_x'), 'dispute', 'synthetic dispute', staff_d from fx
union all
select tenant_d, store_d, (select id from ids where name = 'member_y'), 'dispute', 'synthetic dispute', staff_d from fx;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at, evidence)
select fx.tenant_d, 'customer'::public.consent_subject, c.id, v.purpose::public.consent_purpose, 'v1', 'mini_app', now() - v.granted, now() - v.revoked, '{"screen": "join-v1"}'::jsonb
from fx
cross join (select id from ids where name = 'customer_x') c
cross join (values ('loyalty', interval '10 days', null::interval), ('marketing', interval '10 days', interval '8 days'), ('marketing', interval '7 days', null::interval)) as v (purpose, granted, revoked)
union all
select fx.tenant_d, 'customer', (select id from ids where name = 'customer_y'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx
union all
select fx.tenant_o, 'customer', (select id from ids where name = 'customer_x_other'), 'loyalty', 'v1', 'mini_app', now() - interval '10 days', null, '{"screen": "join-v1"}'::jsonb from fx;

insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, title, body)
select fx.tenant_d, 'zalo_oa', 'synthetic-recipient-' || v.n, 'customer', c.id, 'marketing', 'synthetic.v1', now() - interval '2 days', 'sent', 'Synthetic title', 'Synthetic body'
from fx
cross join lateral (values (1, 'customer_x'), (2, 'customer_x'), (3, 'customer_y')) as v (n, name)
join ids c on c.name = v.name;

insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_d, app_d, 'syn-zalo-x', login_x, (select id from ids where name = 'customer_x') from fx
union all
select tenant_d, app_d, 'syn-zalo-y', login_y, (select id from ids where name = 'customer_y') from fx;

-- Reach every table that points at the subject, by foreign keys read from the catalogue, so that a table added later is caught.
create temp table subject_ids (tbl regclass not null, id text not null, primary key (tbl, id));
create temp table edges (parent regclass not null, child regclass not null, child_col name not null, primary key (parent, child, child_col));
insert into subject_ids select 'public.customers'::regclass, id::text from ids where name = 'customer_x';
insert into subject_ids select 'public.memberships'::regclass, id::text from ids where name = 'member_x';

create function pg_temp.walk() returns void language plpgsql as $$
declare
  r record;
  v_new integer;
  v_n integer;
begin
  loop
    v_new := 0;
    for r in
      select c.confrelid::regclass as parent, c.conrelid as child_oid, c.conrelid::regclass as child,
        (
          select a.attname
          from unnest(c.conkey, c.confkey) as k (ck, fk)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.ck
          join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.fk
          where pa.attname = 'id'
        ) as child_col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where c.contype = 'f' and n.nspname in ('public', 'app') and c.confrelid in (select distinct tbl from subject_ids)
    loop
      if r.child_col is null then continue; end if;
      insert into edges values (r.parent, r.child, r.child_col) on conflict do nothing;
      if exists (select 1 from pg_attribute where attrelid = r.child_oid and attname = 'id' and not attisdropped) then
        execute format(
          'insert into subject_ids select %L::regclass, ch.id::text from %s ch where ch.%I::text in (select id from subject_ids where tbl = %L::regclass) on conflict do nothing',
          r.child, r.child, r.child_col, r.parent
        );
        get diagnostics v_n = row_count;
        v_new := v_new + v_n;
      end if;
    end loop;
    exit when v_new = 0;
  end loop;
end;
$$;

create function pg_temp.referencing() returns text language plpgsql as $$
declare
  e record;
  v_n bigint;
  v_out text[] := '{}';
begin
  for e in select * from edges order by child::text, child_col loop
    execute format('select count(*) from %s where %I::text in (select id from subject_ids where tbl = %L::regclass)', e.child, e.child_col, e.parent) into v_n;
    if v_n > 0 then v_out := v_out || (e.child::text || '.' || e.child_col || ':' || v_n); end if;
  end loop;
  return array_to_string(v_out, ',');
end;
$$;

select pg_temp.walk();
create temp table before_refs as select pg_temp.referencing() as refs;
select ok(
  (select cardinality(string_to_array(refs, ',')) from before_refs) >= 8,
  'before the erasure at least eight foreign keys have rows pointing at the customer, the membership or the rows below them (non-vacuous check)'
);
select ok(
  (select count(*) from edges) >= 20,
  'the discovery reads at least twenty foreign keys into the customer, the membership and the rows below them'
);

create temp table ghost as
select c.id as customer_id, (select id from ids where name = 'member_x') as membership_id
from public.customers c where c.id = (select id from ids where name = 'customer_x');
create temp table req as
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select tenant_d, 'customer', (select id from ids where name = 'customer_x'), 'synthetic-contact', 'deletion', now() - interval '1 hour' from fx
  returning id
)
select id from r;

-- State transition: live to erased. Event: the owner's deletion on the customer's request.
select set_config('request.jwt.claims', json_build_object('sub', (select owner_d from fx), 'role', 'authenticated')::text, true);
select is((select public.dsr_delete((select id from req)) ->> 'status'), 'completed', 'the owner erases the customer');
select set_config('request.jwt.claims', '', true);

select is(pg_temp.referencing(), '', 'after the erasure no row of any table references the customer, the membership or a row below them (found through foreign keys)');
select is((select count(*) from public.customers where id = (select customer_id from ghost)), 0::bigint, 'the customer row is gone');

-- The owner's decision on POS fields: the old invoices are blanked
select is(
  (select count(*) from public.invoices where id in (select id from ids where name in ('inv_phone', 'inv_linked')) and (customer_phone is not null or customer_name is not null)),
  0::bigint, 'the invoices that carried the phone or the link have no customer_phone and customer_name any more'
);
select is(
  (select concat_ws(':', customer_phone, customer_name) from public.invoices where id = (select id from ids where name = 'inv_y')),
  '0900009102:Synthetic till name', 'another customer''s invoice keeps its POS fields'
);
select is(
  (select (counts ->> 'invoices_blanked')::int from public.data_subject_request_actions where request_id = (select id from req)),
  2, 'the logged counts say how many invoices were blanked'
);

-- Later syncs bring the same phone back: an update of an old invoice and new invoices, in either phone form
select is(
  (select phone_hash from app.erased_phones where tenant_id = (select tenant_d from fx)), app.phone_hash('0900009101'),
  'the erased phone is remembered as a hash'
);
select is((select count(*) from app.erased_phones where phone_hash ~ '900009101'), 0::bigint, 'no phone digits are stored');
update public.invoices set customer_phone = '0900009101', customer_name = 'Synthetic till name' where id = (select id from ids where name = 'inv_phone');
select pg_temp.invoice('inv_resync', now() - interval '1 day', 45000, app.loyalty_normalize_phone('0900009101'));
select pg_temp.invoice('inv_resync_local', now() - interval '1 day', 46000, '0900009101');
select is(
  (select count(*) from public.invoices where id in (select id from ids where name in ('inv_phone', 'inv_resync', 'inv_resync_local')) and (customer_phone is not null or customer_name is not null)),
  0::bigint, 'a re-synced old invoice and new invoices with the same phone (local or +84 form) arrive without phone and name'
);
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name)
select tenant_o, store_o, account_o, 'dsr-other-tenant', now() - interval '1 day', current_date, 1000, 1000, 1000, '0900009101', 'Synthetic till name' from fx;
select is(
  (select concat_ws(':', customer_phone, customer_name) from public.invoices where external_id = 'dsr-other-tenant'),
  '0900009101:Synthetic till name', 'the same phone in another tenant is untouched'
);
select pg_temp.invoice('inv_other_phone', now() - interval '1 day', 47000, '0900009104');
select is((select customer_phone from public.invoices where id = (select id from ids where name = 'inv_other_phone')), '0900009104', 'an unrelated phone still arrives');

-- The reconciliation and the nightly job find the phone on no invoice and create nothing
create function pg_temp.world() returns jsonb language sql as $$
  select jsonb_build_object(
    'customers', (select count(*) from public.customers where tenant_id = (select tenant_d from fx)),
    'memberships', (select count(*) from public.memberships where tenant_id = (select tenant_d from fx)),
    'ledger', (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_d from fx)),
    'checkins', (select count(*) from public.pending_checkins where tenant_id = (select tenant_d from fx)),
    'claims', (select count(*) from public.receipt_claims where tenant_id = (select tenant_d from fx)),
    'queue', (select count(*) from public.loyalty_queue where tenant_id = (select tenant_d from fx)),
    'refusals', (select count(*) from public.loyalty_refusals where tenant_id = (select tenant_d from fx)),
    'messages', (select count(*) from public.outbound_messages where tenant_id = (select tenant_d from fx))
  );
$$;
create temp table world_before as select pg_temp.world() as w;
select app.reconcile_loyalty((select tenant_d from fx), current_date - 14, current_date + 1, now());
select app.loyalty_nightly((select tenant_d from fx), now());
select app.reconcile_loyalty((select tenant_d from fx), current_date - 14, current_date + 1, now() + interval '1 hour');
select is(
  pg_temp.world() - 'ledger' - 'refusals' - 'queue', (select w - 'ledger' - 'refusals' - 'queue' from world_before),
  'the reconciliation and the nightly job over the 14 days with the erased phone create no customer, membership, check-in, claim or message'
);
select is(
  (select count(*) from public.customers where tenant_id = (select tenant_d from fx) and app.loyalty_normalize_phone(phone) = app.loyalty_normalize_phone('0900009101')),
  0::bigint, 'no customer holds the erased phone'
);
select is(
  (select count(*) from public.loyalty_ledger l where l.invoice_id in (select id from ids where name in ('inv_phone', 'inv_resync', 'inv_resync_local')) )
  + (select count(*) from public.loyalty_queue q where q.candidate_invoice_ids && (select array_agg(id) from ids where name in ('inv_phone', 'inv_resync', 'inv_resync_local'))),
  0::bigint, 'the new invoices with the erased phone earn nothing and open no queue item'
);

-- A re-join starts clean
create temp table rejoin as
select app.loyalty_customer_for_phone((select tenant_d from fx), '0900009101', now()) as customer_id;
select isnt((select customer_id from rejoin), (select customer_id from ghost), 'the same phone joins again as a new customer');
insert into ids select 'member_new', app.loyalty_join((select tenant_d from fx), (select customer_id from rejoin), 'mini_app', (select store_d from fx), (select brand_d from fx), 'syn-zalo-new', now());
select is((select id from ids where name = 'member_new') <> (select membership_id from ghost), true, 'the membership is a new one');
select is(
  (select concat_ws(':', count(*) filter (where entry_kind = 'adjust' and reason = 'welcome'), count(*) filter (where entry_kind <> 'adjust' or reason <> 'welcome'), coalesce(sum(stamp_delta), 0))
   from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_new')),
  '1:0:2', 'the new membership has only the welcome stamps and no earlier ledger row'
);
select is((select blank_before is not null from app.erased_phones where tenant_id = (select tenant_d from fx)), true, 'joining again limits the memory of the erased phone to what was sold before the new membership');
select pg_temp.invoice('inv_after_join', now() + interval '1 hour', 52000, '0900009101');
select is((select customer_phone from public.invoices where id = (select id from ids where name = 'inv_after_join')), '0900009101', 'after the re-join new invoices carry the phone again');
select is(
  (select count(*) from public.invoices where id in (select id from ids where name in ('inv_linked')) and (customer_phone is not null or customer_name is not null)),
  0::bigint, 'the old invoices stay blank after the re-join'
);
update public.invoices set customer_phone = '0900009101', customer_name = 'Synthetic till name' where id = (select id from ids where name = 'inv_resync_local');
select is(
  (select customer_phone from public.invoices where id = (select id from ids where name = 'inv_resync_local')), null,
  'an invoice sold before the re-join stays blank when the sync or the nightly re-pull brings the phone again'
);

select * from finish();
rollback;
