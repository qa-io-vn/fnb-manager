begin;
select plan(13);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009401'::uuid as tenant_g,
  'cccccccc-cccc-4ccc-8ccc-000000009401'::uuid as account_g,
  'ffffffff-ffff-4fff-8fff-000000009401'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000009402'::uuid as store_2,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000009401'::uuid as programme_g,
  'eeeeeeee-eeee-4eee-8eee-000000009401'::uuid as owner_g,
  'eeeeeeee-eeee-4eee-8eee-000000009402'::uuid as other_g;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coupon-guards-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_g, fx.other_g]) as u (id);

insert into public.tenants (id, slug, name, country_code) select tenant_g, 'coupon-guards-pgtap', 'Coupon guards pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_g, tenant_g, 'mock', 'coupon-guards', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_1, tenant_g, account_g, 'cg-1', 'Synthetic store 1' from fx
union all
select store_2, tenant_g, account_g, 'cg-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_g, owner_g, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_g, other_g, 'owner', null from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_g, tenant_g, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_g, s.id, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], now() - interval '30 days'
from fx cross join lateral unnest(array[fx.store_1, fx.store_2]) as s (id);
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
select tenant_g, s.id, 'gift-drink', 'Synthetic gift drink', 'discount'::public.einvoice_display
from fx cross join lateral unnest(array[fx.store_1, fx.store_2]) as s (id);

select set_config('request.jwt.claims', json_build_object('sub', (select owner_g from fx), 'role', 'authenticated')::text, true);
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, status)
select tenant_g, programme_g, 'gift-drink', 'Gift drink', 'free_item'::public.coupon_reward_kind, 4, 0, null::uuid[], 'active'::public.coupon_status from fx;
select set_config('request.jwt.claims', '', true);

select is(
  (select concat_ws('|', c.status, c.approved_by = (select owner_g from fx), c.approved_at is not null) from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  'active|t|t',
  'the owner who activated the reward is its approver'
);

update public.coupons set approved_by = null where tenant_id = (select tenant_g from fx);
select is(
  (select c.approved_by from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  (select owner_g from fx),
  'a writer that clears approved_by itself gets the approver back'
);
update public.coupons set approved_by = (select other_g from fx) where tenant_id = (select tenant_g from fx);
select is(
  (select c.approved_by from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  (select owner_g from fx),
  'and one that rewrites it to another user too'
);

select lives_ok(
  format('delete from auth.users where id = %L', (select owner_g from fx)),
  'the Auth user who approved a live reward can be deleted'
);
select is(
  (select concat_ws('|', c.status, coalesce(c.approved_by::text, 'none'), c.approved_at is not null, c.active) from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  'active|none|t|t',
  'the reward stays active and approved, its approver set null by the foreign key'
);
update public.coupons set name = 'Gift drink, renamed' where tenant_id = (select tenant_g from fx);
select is(
  (select concat_ws('|', c.status, coalesce(c.approved_by::text, 'none'), c.approved_at is not null) from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  'active|none|t',
  'a later edit keeps the approval as it stands'
);

select throws_ok(
  format('delete from public.coupon_rail_rewards where store_id = %L', (select store_1 from fx)),
  '22023',
  null,
  'a direct delete of a mapping an active reward needs is still refused'
);
select throws_ok(
  format('update public.coupon_rail_rewards set active = false where store_id = %L', (select store_1 from fx)),
  '22023',
  null,
  'and so is deactivating it'
);

select lives_ok(
  format('delete from public.stores where id = %L', (select store_2 from fx)),
  'a store with an active reward''s mapping can be deleted: the cascade passes the guard'
);
select is(
  (select count(*)::integer from public.coupon_rail_rewards w where w.store_id = (select store_2 from fx)),
  0,
  'the deleted store''s mapping went with it'
);
select is(
  (select count(*)::integer from public.coupon_rail_rewards w where w.store_id = (select store_1 from fx) and w.active),
  1,
  'the other store keeps its mapping'
);

select lives_ok(
  format('delete from public.tenants where id = %L', (select tenant_g from fx)),
  'a tenant with an active reward can be deleted'
);
select is(
  (select count(*)::integer from public.coupon_rail_rewards w where w.tenant_id = (select tenant_g from fx))
  + (select count(*)::integer from public.coupons c where c.tenant_id = (select tenant_g from fx)),
  0,
  'its rewards and mappings went with it'
);

select * from finish();
rollback;
