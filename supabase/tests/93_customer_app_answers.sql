begin;
select plan(24);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000009301'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000009301'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000009301'::uuid as store_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000009301'::uuid as brand_a,
  '99999999-9999-4999-8999-000000009301'::uuid as app_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000009301'::uuid as programme_a,
  'eeeeeeee-eeee-4eee-8eee-000000009301'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000009311'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000009312'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000009313'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-answers-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.owner_a, false), (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)) as u (id, customer);

insert into public.tenants (id, slug, name) select tenant_a, 'customer-answers-pgtap', 'Customer answers pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'customer-answers', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_1, tenant_a, account_a, 'ca-ext-1', 'ca-1', 'Synthetic store 1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-993', 'Synthetic brand', array[store_1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-answers-app', 'ZALO_APP_SECRET_BRAND_993', 'active' from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_a, 'privacy_notice', 'vi', 'privacy-ca-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', timestamptz '2026-10-01 00:00+07' from fx;

select app.zalo_customer_sign_in((select app_a from fx), 'causer' || n, null, ('eeeeeeee-eeee-4eee-8eee-00000000931' || n)::uuid) from generate_series(1, 3) n;

create temp table answers (name text primary key, answer jsonb);
grant select on fx to service_role;

create function pg_temp.as_login(p_login uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_login, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', l.tenant_id, 'customer_id', l.customer_id)
  )::text, true)
  from app.customer_logins l where l.user_id = p_login;
$$;

create function pg_temp.home(p_login uuid)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_home();
$$;

create function pg_temp.wallet(p_login uuid, p_at timestamptz)
returns jsonb
language sql
as $$
  select pg_temp.as_login(p_login);
  select app.customer_wallet(p_at);
$$;

create function pg_temp.history(p_login uuid, p_at timestamptz, p_kind text)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(h - 'id' - 'at' order by h ->> 'at'), '[]'::jsonb)
  from jsonb_array_elements(pg_temp.wallet(p_login, p_at) -> 'history') h
  where h ->> 'kind' = p_kind;
$$;

create function pg_temp.join(p_n integer, p_at timestamptz)
returns jsonb
language sql
as $$
  select app.customer_join(('eeeeeeee-eeee-4eee-8eee-00000000931' || p_n)::uuid, (select app_a from fx), 'causer' || p_n, 'Khách causer' || p_n,
    '09000093' || lpad(p_n::text, 2, '0'), true, false, 'privacy-ca-1', 'join-1', p_at - interval '1 minute', 'ca-1', 'mini_app', p_at);
$$;

create function pg_temp.membership(p_login uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select m.id from public.memberships m join app.customer_logins l on l.customer_id = m.customer_id where l.user_id = p_login;
$$;

select is(pg_temp.home((select login_1 from fx)) -> 'programme', 'null'::jsonb, 'a tenant without any programme answers the home with programme null');
select is(
  pg_temp.join(1, (select t0 from fx)),
  '{"status": "refused", "reason": "no_programme"}'::jsonb,
  'joining a tenant without any programme is refused with no_programme instead of an error'
);
select is(
  (select concat_ws('|',
    (select count(*) from public.customers c where c.tenant_id = fx.tenant_a),
    (select count(*) from public.consent_records c where c.tenant_id = fx.tenant_a),
    (select count(*) from app.customer_logins l where l.tenant_id = fx.tenant_a and l.customer_id is not null))
   from fx),
  '0|0|0',
  'a join refused for want of a programme writes no customer, consent or binding'
);

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, stamps_per_card, welcome_stamps)
select programme_a, tenant_a, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 8, 2 from fx;

select is(
  pg_temp.join(1, timestamptz '2026-10-25 10:00+07') ->> 'reason',
  'no_programme',
  'an active programme whose period has not started yet is no programme to join'
);
select is(pg_temp.home((select login_1 from fx)) #>> '{programme,status}', 'active', 'the home names the programme''s status: active');
select is(pg_temp.join(1, (select t0 from fx)) - 'customer_id' - 'membership_id', '{"status": "joined", "welcome_stamps": 2, "already_member": false}'::jsonb, 'the success answer keeps its shape');
select is(pg_temp.join(2, (select t0 from fx)) ->> 'status', 'joined', 'a second customer joins');

select set_config('request.jwt.claims', '', true);
insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
select tenant_a, store_1, 'pos_payment_discount'::public.coupon_rail, '{}'::text[], t0 - interval '30 days' from fx;
insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
select tenant_a, store_1, 'gift-drink', 'Synthetic gift drink', 'discount'::public.einvoice_display from fx;
insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, cost_stamps, cost_points, store_ids, hold_hours, status)
select tenant_a, programme_a, 'gift-drink', 'Gift drink', 'free_item'::public.coupon_reward_kind, 1, 0, array[store_1], 24, 'active'::public.coupon_status from fx;

insert into answers
select 'held_1', app.redeem_coupon(pg_temp.membership((select login_1 from fx)), (select id from public.coupons where reward_key = 'gift-drink'), (select store_1 from fx), (select t0 + interval '1 hour' from fx));
insert into answers
select 'held_2', app.redeem_coupon(pg_temp.membership((select login_2 from fx)), (select id from public.coupons where reward_key = 'gift-drink'), (select store_1 from fx), (select t0 + interval '1 hour' from fx));

select is(
  pg_temp.history((select login_1 from fx), (select t0 + interval '2 hours' from fx), 'redeem'),
  '[{"kind": "redeem", "state": "pending", "stamps": -1, "points": 0, "reason": "redemption", "store_name": "Synthetic store 1", "receipt_no": null, "matched_path": null}]'::jsonb,
  'a held reward is a pending redeem row without a path'
);

select isnt(
  app.release_redemption((select (answer ->> 'redemption_id')::uuid from answers where name = 'held_1'), 'hold_expired', (select t0 + interval '26 hours' from fx)),
  null,
  'the unused hold is released with an adjust row'
);
select is(
  pg_temp.history((select login_1 from fx), (select t0 + interval '27 hours' from fx), 'redeem') -> 0 ->> 'state',
  'reversed',
  'after the release the redeem row reads reversed, no longer pending'
);
select is(
  pg_temp.history((select login_1 from fx), (select t0 + interval '25 hours' from fx), 'redeem') -> 0 ->> 'state',
  'pending',
  'and stays pending in a wallet read before the release'
);
select is(
  (select jsonb_agg(h) from jsonb_array_elements(pg_temp.history((select login_1 from fx), (select t0 + interval '27 hours' from fx), 'adjust')) h where h ->> 'reason' = 'redemption_released'),
  '[{"kind": "adjust", "state": "confirmed", "stamps": 1, "points": 0, "reason": "redemption_released", "store_name": "Synthetic store 1", "receipt_no": null, "matched_path": null}]'::jsonb,
  'the redemption_released adjustment carries no path, so the app words it itself'
);
select is(
  pg_temp.wallet((select login_1 from fx), (select t0 + interval '27 hours' from fx)) #>> '{stamp_cards,0,stamps}',
  '2',
  'the stamps are back on the card'
);
select is(
  (select r.state::text from public.redemptions r where r.id = (select (answer ->> 'redemption_id')::uuid from answers where name = 'held_1')),
  'released',
  'the redemption is released'
);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, bill_discount_name, bill_discount_amount, net_amount, paid_amount)
select tenant_a, store_1, account_a, 'ca-inv-1', t0 + interval '90 minutes', app.store_business_date(store_1, t0 + interval '90 minutes'), 60000, 'Synthetic gift drink', 30000, 30000, 30000 from fx;
select isnt(
  app.confirm_redemption((select (answer ->> 'redemption_id')::uuid from answers where name = 'held_2'), (select id from public.invoices where external_id = 'ca-inv-1'), (select t0 + interval '2 hours' from fx)),
  null,
  'the second hold is confirmed by its synced invoice'
);
select is(
  pg_temp.history((select login_2 from fx), (select t0 + interval '3 hours' from fx), 'redeem') -> 0 ->> 'state',
  'confirmed',
  'a used voucher''s redeem row reads confirmed'
);
select is(
  pg_temp.history((select login_2 from fx), (select t0 + interval '30 hours' from fx), 'redeem') -> 0 ->> 'state',
  'confirmed',
  'and stays confirmed after its hold time'
);

select app.loyalty_apply_adjustment(pg_temp.membership((select login_1 from fx)), (select store_1 from fx), 1, 0, 'Synthetic goodwill stamp', (select owner_a from fx), (select t0 + interval '28 hours' from fx));
select is(
  (select string_agg(concat_ws(':', h ->> 'reason', coalesce(h ->> 'matched_path', 'none')), ',' order by h ->> 'reason' collate "C")
   from jsonb_array_elements(pg_temp.history((select login_1 from fx), (select t0 + interval '29 hours' from fx), 'adjust')) h),
  'Synthetic goodwill stamp:manual,redemption_released:none',
  'a staff adjustment still reads manual beside the released hold'
);

update public.loyalty_programmes set status = 'paused' where id = (select programme_a from fx);
select is(pg_temp.home((select login_3 from fx)) #>> '{programme,status}', 'paused', 'a paused programme says paused, so it does not look open');
select is(pg_temp.join(3, (select t0 from fx)) ->> 'reason', 'no_programme', 'joining a paused programme is refused with no_programme');
set local role service_role;
select is(
  public.customer_join((select login_3 from fx), (select app_a from fx), 'causer3', 'Khách causer3', '0900009303', true, false, 'privacy-ca-1', 'join-1', now() - interval '1 minute', 'ca-1', 'mini_app'),
  '{"status": "refused", "reason": "no_programme"}'::jsonb,
  'the RPC zalo-session calls answers the refusal too'
);
reset role;
select is(
  (select count(*)::integer from public.memberships m where m.programme_id = (select programme_a from fx)),
  2,
  'the refused joins enrolled nobody'
);

update public.loyalty_programmes set status = 'ended', ends_on = date '2026-11-15' where id = (select programme_a from fx);
select is(pg_temp.home((select login_3 from fx)) #>> '{programme,status}', 'ended', 'an ended programme says ended');
select is(pg_temp.home((select login_1 from fx)) #>> '{programme,name}', 'Synthetic programme', 'and is still the programme the home describes');

select * from finish();
rollback;
