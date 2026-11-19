begin;
select plan(65);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006601'::uuid as tenant_c,
  'dddddddd-dddd-4ddd-8ddd-000000006602'::uuid as tenant_o,
  'cccccccc-cccc-4ccc-8ccc-000000006601'::uuid as account_c,
  'cccccccc-cccc-4ccc-8ccc-000000006602'::uuid as account_o,
  'ffffffff-ffff-4fff-8fff-000000006601'::uuid as store_c1,
  'ffffffff-ffff-4fff-8fff-000000006602'::uuid as store_c2,
  'ffffffff-ffff-4fff-8fff-000000006603'::uuid as store_c3,
  'ffffffff-ffff-4fff-8fff-000000006604'::uuid as store_o1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006601'::uuid as brand_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006602'::uuid as brand_off,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000006603'::uuid as brand_o,
  '99999999-9999-4999-8999-000000006601'::uuid as app_c,
  '99999999-9999-4999-8999-000000006602'::uuid as app_off,
  '99999999-9999-4999-8999-000000006603'::uuid as app_o,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006601'::uuid as programme_c,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006602'::uuid as programme_o,
  'eeeeeeee-eeee-4eee-8eee-000000006601'::uuid as owner_c,
  'eeeeeeee-eeee-4eee-8eee-000000006602'::uuid as staff_c,
  'eeeeeeee-eeee-4eee-8eee-000000006611'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000006612'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000006613'::uuid as login_3,
  'eeeeeeee-eeee-4eee-8eee-000000006614'::uuid as login_4,
  'eeeeeeee-eeee-4eee-8eee-000000006615'::uuid as login_5,
  'eeeeeeee-eeee-4eee-8eee-000000006616'::uuid as login_race,
  'eeeeeeee-eeee-4eee-8eee-000000006617'::uuid as login_plain,
  'eeeeeeee-eeee-4eee-8eee-000000006618'::uuid as login_other,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'customer-join-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (
  values (fx.owner_c, false, null::uuid), (fx.staff_c, false, null), (fx.login_1, true, fx.tenant_c), (fx.login_2, true, fx.tenant_c),
         (fx.login_3, true, fx.tenant_c), (fx.login_4, true, fx.tenant_c), (fx.login_5, true, fx.tenant_c), (fx.login_race, true, fx.tenant_c),
         (fx.login_plain, false, null), (fx.login_other, true, fx.tenant_o)
) as u (id, customer, tenant);

insert into public.tenants (id, slug, name)
select tenant_c, 'customer-join-pgtap', 'Customer join pgTAP' from fx
union all
select tenant_o, 'customer-join-other-pgtap', 'Customer join other pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_c, tenant_c, 'mock', 'customer-join', 'Synthetic account' from fx
union all
select account_o, tenant_o, 'mock', 'customer-join-other', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, address, opening_hours)
select store_c1, tenant_c, account_c, 'cj-ext-1', 'cj-1', 'Synthetic store B', 'Số 1 Đường Thử', '{"mon": [["07:00", "22:00"]]}'::jsonb from fx
union all
select store_c2, tenant_c, account_c, 'cj-ext-2', 'CJ-2', 'Synthetic store A', null, null from fx
union all
select store_c3, tenant_c, account_c, 'cj-ext-3', 'cj-3', 'Synthetic store C', 'Số 3 Đường Thử', null from fx
union all
select store_o1, tenant_o, account_o, 'cj-ext-9', 'cj-9', 'Synthetic other store', 'Số 9 Đường Thử', null from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_c, owner_c, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_c, staff_c, 'staff', array[store_c1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_c, tenant_c, 'brand-966', 'Synthetic brand', array[store_c1, store_c2] from fx
union all
select brand_off, tenant_c, 'brand-967', 'Synthetic brand off', array[store_c3] from fx
union all
select brand_o, tenant_o, 'brand-966', 'Synthetic other brand', array[store_o1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_c, tenant_c, brand_c, 'synthetic-customer-app-c', 'ZALO_APP_SECRET_BRAND_966', 'active' from fx
union all
select app_off, tenant_c, brand_off, 'synthetic-customer-app-off', 'ZALO_APP_SECRET_BRAND_967', 'disabled' from fx
union all
select app_o, tenant_o, brand_o, 'synthetic-customer-app-o', 'ZALO_APP_SECRET_BRAND_966', 'active' from fx;
insert into public.oas (tenant_id, brand_id, external_id, secret_name)
select tenant_c, brand_c, 'synthetic-oa-c', 'ZALO_OA_SECRET_BRAND_966' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_c, tenant_c, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 2 from fx
union all
select programme_o, tenant_o, 'Synthetic other programme', date '2026-11-01', 'below_threshold', 'active', 2 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at, retired_at)
select fx.tenant_c, d.kind::public.legal_document_kind, d.language, d.version, d.title, 'Văn bản giữ chỗ.', d.status::public.legal_document_status, timestamptz '2026-11-01 00:00+07', d.retired_at
from fx cross join lateral (
  values ('privacy_notice', 'vi', 'privacy-cj-1', 'Chính sách cũ', 'retired', timestamptz '2026-11-05 00:00+07'),
         ('privacy_notice', 'vi', 'privacy-cj-2', 'Chính sách bảo mật', 'published', null::timestamptz),
         ('mini_app_terms', 'vi', 'terms-cj-1', 'Điều khoản sử dụng', 'published', null)
) as d (kind, language, version, title, status, retired_at);
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_c, '0900006690' from fx;
insert into public.customers (tenant_id, phone, name) select tenant_c, '0900006605', 'Tên từ quầy' from fx;

grant select on fx to authenticated, anon, service_role;
create temp table deletion (answer jsonb);
grant select, insert on deletion to authenticated;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute p_statement into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.as_customer(p_user uuid, p_tenant uuid, p_customer uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', p_tenant, 'customer_id', p_customer)
  )::text, true);
$$;

create function pg_temp.as_member(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.join(p_user uuid, p_zalo_user text, p_phone text, p_loyalty boolean, p_marketing boolean, p_policy text, p_store text, p_at_offset interval default interval '0')
returns jsonb
language sql
as $$
  select app.customer_join(p_user, (select app_c from fx), p_zalo_user, 'Khách ' || p_zalo_user, p_phone, p_loyalty, p_marketing, p_policy, 'join-1',
    (select t0 from fx) + p_at_offset - interval '1 minute', p_store, 'mini_app', (select t0 from fx) + p_at_offset);
$$;

create function pg_temp.customer_of(p_user uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select l.customer_id from app.customer_logins l where l.user_id = p_user;
$$;

grant execute on function pg_temp.outcome(text), pg_temp.as_customer(uuid, uuid, uuid), pg_temp.as_member(uuid), pg_temp.customer_of(uuid) to authenticated, anon;

select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', 'Khách cjuser1', null),
  '{"status": "login_needed"}'::jsonb,
  'a Zalo user without a customer login needs one'
);
select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', 'Khách cjuser1', (select login_1 from fx)) - 'tenant_id',
  jsonb_build_object('status', 'customer', 'user_id', (select login_1 from fx), 'customer_id', null, 'display_name', 'Khách cjuser1'),
  'the new customer login is bound and the visitor answer carries the Zalo name and no customer'
);
select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', null, null) ->> 'tenant_id',
  (select tenant_c::text from fx),
  'the next sign-in finds the login and names the app''s tenant'
);
select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', null, (select login_race from fx)) ->> 'user_id',
  (select login_1::text from fx),
  'a login created by a second request in a race loses to the bound one'
);
select is(
  pg_temp.outcome(format('select app.zalo_customer_sign_in(%L, %L, null, %L)', (select app_c from fx), 'cjuser9', (select staff_c from fx))),
  '22023',
  'a login with a tenant membership is never bound as a customer'
);
select is(
  pg_temp.outcome(format('select app.zalo_customer_sign_in(%L, %L, null, %L)', (select app_c from fx), 'cjuser9', (select login_plain from fx))),
  '22023',
  'a login created without the customer kind is never bound'
);
select is(
  pg_temp.outcome(format('select app.zalo_customer_sign_in(%L, %L, null, null)', (select app_off from fx), 'cjuser1')),
  '22023',
  'a disabled Zalo App signs nobody in'
);
select is(
  pg_temp.outcome(format('select app.zalo_customer_sign_in(%L, %L, null, null)', (select app_c from fx), 'bad user')),
  '22023',
  'a malformed Zalo user id is refused'
);
select app.zalo_customer_sign_in((select app_c from fx), 'cjuser' || n, null, (select id from auth.users where id = ('eeeeeeee-eeee-4eee-8eee-00000000661' || n)::uuid))
from generate_series(2, 5) n;
select app.zalo_customer_sign_in((select app_o from fx), 'cjuser8', null, (select login_other from fx));

select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', false, true, 'privacy-cj-2', 'cj-1'),
  '{"status": "refused", "reason": "consent_required"}'::jsonb,
  'joining without the loyalty consent is refused'
);
select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', true, false, 'privacy-cj-1', 'cj-1'),
  '{"status": "refused", "reason": "policy_outdated"}'::jsonb,
  'joining on a retired privacy notice is refused as outdated'
);
select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', true, false, 'privacy-cj-2', 'cj-404') ->> 'reason',
  'unknown_store',
  'an unknown store code is refused'
);
select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', true, false, 'privacy-cj-2', 'cj-3') ->> 'reason',
  'unknown_store',
  'a store of another brand of the tenant is not a store of this app'
);
select is(
  (select count(*)::integer from public.consent_records c where c.tenant_id = (select tenant_c from fx)),
  0,
  'a refused join records no consent'
);
select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', true, false, 'privacy-cj-2', 'cj-1') - 'customer_id' - 'membership_id',
  '{"status": "joined", "welcome_stamps": 2, "already_member": false}'::jsonb,
  'the first join answers joined with the programme''s welcome stamps'
);
select is(
  (select concat_ws('|', c.phone = app.loyalty_normalize_phone('0900006601'), c.name) from public.customers c where c.id = pg_temp.customer_of((select login_1 from fx))),
  't|Khách cjuser1',
  'the customer holds the phone in E.164 form and the Zalo display name'
);
select is(
  (select concat_ws('|', m.channel, m.brand_id = (select brand_c from fx), m.zalo_user_id, m.joined_store_id = (select store_c1 from fx))
   from public.memberships m where m.customer_id = pg_temp.customer_of((select login_1 from fx))),
  'mini_app|t|cjuser1|t',
  'the membership keeps the channel, the brand, the per-brand Zalo user id and the store'
);
select is(
  (select concat_ws('|', count(*), sum(l.stamp_delta)) from public.loyalty_ledger l join public.memberships m on m.id = l.membership_id
   where m.customer_id = pg_temp.customer_of((select login_1 from fx)) and l.entry_kind = 'adjust' and l.reason = 'welcome'),
  '1|2',
  'the welcome stamps are one ledger adjust row'
);
select is(
  (select string_agg(c.purpose::text || ':' || c.policy_version || ':' || c.channel, ',') from public.consent_records c
   where c.subject_type = 'customer' and c.subject_id = pg_temp.customer_of((select login_1 from fx)) and c.revoked_at is null),
  'loyalty:privacy-cj-2:mini_app',
  'the join records the loyalty consent and no marketing consent when its toggle was not ticked'
);
select is(
  (select c.evidence - 'zalo_app_id' - 'store_id' from public.consent_records c
   where c.subject_id = pg_temp.customer_of((select login_1 from fx)) and c.purpose = 'loyalty'),
  jsonb_build_object('screen_version', 'join-1', 'shown_at', (select t0 - interval '1 minute' from fx), 'accepted_at', (select t0 from fx),
    'channel', 'mini_app', 'toggle', 'loyalty', 'ticked', true, 'marketing_ticked', false),
  'the loyalty consent keeps its evidence: screen version, toggles, times and channel'
);
select is(
  (select c.granted_at = (select t0 from fx) from public.consent_records c where c.subject_id = pg_temp.customer_of((select login_1 from fx)) and c.purpose = 'loyalty'),
  true,
  'the consent is granted at the join'
);
select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', 'Tên Zalo mới', null) ->> 'customer_id',
  pg_temp.customer_of((select login_1 from fx))::text,
  'after the join the sign-in names the customer'
);
select is(
  app.zalo_customer_sign_in((select app_c from fx), 'cjuser1', 'Tên Zalo mới', null) ->> 'display_name',
  'Khách cjuser1',
  'and the customer''s name rather than a later Zalo name'
);
select is(
  pg_temp.join((select login_1 from fx), 'cjuser1', '0900006601', true, false, 'privacy-cj-2', null, interval '1 hour') - 'customer_id' - 'membership_id',
  '{"status": "joined", "welcome_stamps": 0, "already_member": true}'::jsonb,
  'joining again answers the same membership as already a member, without new welcome stamps'
);
select is(
  (select count(*)::integer from public.consent_records c where c.subject_id = pg_temp.customer_of((select login_1 from fx))),
  1,
  'joining again on the same policy version adds no consent row'
);
select is(
  pg_temp.join((select login_2 from fx), 'cjuser2', '0900006602', true, true, 'privacy-cj-2', 'CJ-2') ->> 'status',
  'joined',
  'a customer joins with the marketing toggle ticked at a store whose code has capitals'
);
select is(
  (select string_agg(c.purpose::text || ':' || (c.evidence ->> 'toggle') || ':' || (c.evidence ->> 'ticked'), ',' order by c.purpose)
   from public.consent_records c where c.subject_id = pg_temp.customer_of((select login_2 from fx)) and c.revoked_at is null),
  'loyalty:loyalty:true,marketing:marketing:true',
  'a ticked marketing toggle records its own consent with its evidence'
);
select is(
  pg_temp.join((select login_3 from fx), 'cjuser3', '0900006601', true, false, 'privacy-cj-2', null),
  '{"status": "refused", "reason": "phone_in_use"}'::jsonb,
  'a phone that another Zalo user of the brand joined with is refused'
);
select is(
  pg_temp.join((select login_3 from fx), 'cjuser3', '0900006690', true, false, 'privacy-cj-2', null) ->> 'welcome_stamps',
  '0',
  'a staff phone joins without welcome stamps'
);
select is(
  (select concat_ws('|', pg_temp.join((select login_4 from fx), 'cjuser4', '0900006605', true, false, 'privacy-cj-2', null) ->> 'customer_id' = c.id::text, c.name)
   from public.customers c where c.tenant_id = (select tenant_c from fx) and c.phone = '0900006605'),
  't|Tên từ quầy',
  'a customer the till stored in national form is found by its phone and keeps its name'
);
select is(
  pg_temp.outcome(format('select app.customer_join(%L, %L, %L, null, %L, true, false, %L, %L, %L, null, %L, %L)',
    (select login_5 from fx), (select app_c from fx), 'cjuser5', 'not a phone', 'privacy-cj-2', 'join-1', (select t0 from fx), 'mini_app', (select t0 from fx))),
  '22023',
  'a phone that does not read in E.164 form is refused'
);
select is(
  pg_temp.outcome(format('select app.customer_join(%L, %L, %L, null, %L, true, false, %L, %L, %L, null, %L, %L)',
    (select login_5 from fx), (select app_c from fx), 'cjuser1', '0900006609', 'privacy-cj-2', 'join-1', (select t0 from fx), 'mini_app', (select t0 from fx))),
  '22023',
  'a login joins only for its own Zalo user'
);
select is(
  pg_temp.outcome(format('select app.customer_join(%L, %L, %L, null, %L, true, false, %L, %L, %L, null, %L, %L)',
    (select login_5 from fx), (select app_c from fx), 'cjuser5', '0900006609', 'privacy-cj-2', 'join-1', (select t0 from fx), 'oa_form', (select t0 from fx))),
  '22023',
  'the Mini App join takes only the channel mini_app'
);
set local role service_role;
select is(
  public.customer_join((select login_5 from fx), (select app_c from fx), 'cjuser5', 'Khách năm', '0900006609', true, false, 'privacy-cj-2', 'join-1', now() - interval '1 minute', 'cj-1', 'mini_app') ->> 'status',
  'joined',
  'the service role joins through the RPC at the current time'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.zalo_customer_sign_in(uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.zalo_customer_sign_in(uuid, text, text, uuid)', 'execute'),
  'sign-in and join are RPCs of the service role only'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('customer_home', 'customer_wallet', 'customer_member_code', 'customer_submit_claim', 'customer_stop_marketing', 'customer_request_deletion')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
  6,
  'the six session RPCs act only for a signed-in caller'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like 'customer\_%'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0,
  'no app customer function is executable by a client role, so no client chooses its time'
);
select ok(
  not has_table_privilege('authenticated', 'app.customer_logins', 'select')
  and not has_table_privilege('service_role', 'app.customer_logins', 'select'),
  'the customer logins are read only inside the functions'
);

set local role authenticated;
select pg_temp.as_customer((select login_3 from fx), (select tenant_c from fx), null);
select is(public.customer_home() -> 'programme' ->> 'name', 'Synthetic programme', 'a visitor session reads the programme before joining');
select is(
  (public.customer_home() -> 'programme') - 'name'::text - 'starts_on'::text - 'ends_on'::text,
  '{"tiers": [], "status": "active", "summary": null, "stamp_rule": null, "points_rule": null, "points_enabled": true, "reward_summary": null, "welcome_stamps": 2, "stamps_per_card": 8, "retention_months": null, "points_expiry_months": 12, "stamp_validity_months": 6, "receipt_claims_per_day": 3, "receipt_claim_window_hours": 72}'::jsonb,
  'the programme facts come from the programme row'
);
select is(
  (select string_agg(s.value ->> 'code', ',' order by s.ordinality) from jsonb_array_elements(public.customer_home() -> 'stores') with ordinality s),
  'CJ-2,cj-1',
  'the stores of the app''s brand only, by name, with their link keys'
);
select is(
  (select jsonb_agg(s.value - 'code' - 'name' - 'receipt_numbers_reset' order by s.ordinality) from jsonb_array_elements(public.customer_home() -> 'stores') with ordinality s),
  '[{"address": null, "opening_hours": null}, {"address": "Số 1 Đường Thử", "opening_hours": {"mon": [["07:00", "22:00"]]}}]'::jsonb,
  'with the address and opening hours, null when unknown'
);
select is(
  public.customer_home() -> 'legal' ->> 'policy_version',
  'privacy-cj-2',
  'the legal block names the published privacy notice version'
);
select is(
  (select string_agg(d ->> 'kind' || ':' || (d ->> 'version'), ',') from jsonb_array_elements(public.customer_home() -> 'legal' -> 'documents') d),
  'privacy_notice:privacy-cj-2,mini_app_terms:terms-cj-1',
  'the published privacy notice and terms, never a retired version'
);
select is(
  concat_ws('|', public.customer_home() -> 'legal' ->> 'entity_name', public.customer_home() ->> 'oa_id', jsonb_array_length(public.customer_home() -> 'menu')),
  'Customer join pgTAP|synthetic-oa-c|0',
  'the legal entity, the brand''s OA and no menu highlight yet'
);
select ok(public.customer_home()::text !~* 'amount|price', 'the home holds no amount or price');
select is(pg_temp.outcome('select public.customer_wallet()'), '42501', 'a visitor has no wallet');
select is(pg_temp.outcome('select public.customer_stop_marketing()'), '42501', 'a visitor has no marketing consent to stop');
select is(pg_temp.outcome('select public.customer_request_deletion()'), '42501', 'a visitor has no data to delete through the app');
select pg_temp.as_customer((select login_3 from fx), (select tenant_o from fx), null);
select is(pg_temp.outcome('select public.customer_home()'), '42501', 'a session naming another tenant is refused');
select pg_temp.as_member((select login_3 from fx));
select is(pg_temp.outcome('select public.customer_home()'), '42501', 'a session without the customer kind is refused');
select pg_temp.as_member((select staff_c from fx));
select is(pg_temp.outcome('select public.customer_home()'), '42501', 'a staff session is not a customer session');
select pg_temp.as_customer((select login_1 from fx), (select tenant_c from fx), pg_temp.customer_of((select login_2 from fx)));
select is(pg_temp.outcome('select public.customer_wallet()'), '42501', 'a session naming another customer than its login''s is refused');
select pg_temp.as_customer((select login_1 from fx), (select tenant_c from fx), pg_temp.customer_of((select login_1 from fx)));
select is(
  (select count(*)::integer from public.customers),
  1,
  'a member session reads its own customer row only'
);
select is(
  (select count(*)::integer from public.memberships),
  1,
  'and its own membership only'
);
select is(
  (select count(*)::integer from public.loyalty_ledger),
  1,
  'and its own ledger rows only'
);
select is(
  (select count(*)::integer from public.consent_records),
  0,
  'a customer session reads no consent record directly'
);
reset role;

set local role authenticated;
select pg_temp.as_customer((select login_2 from fx), (select tenant_c from fx), pg_temp.customer_of((select login_2 from fx)));
select is(public.customer_wallet() ->> 'marketing_consent', 'true', 'the wallet shows the marketing consent given at the join');
select is(public.customer_stop_marketing() ->> 'marketing_consent', 'false', 'Dừng nhận tin answers that marketing stopped');
select is(public.customer_wallet() ->> 'marketing_consent', 'false', 'and the wallet shows it at once');
select is(public.customer_stop_marketing() ->> 'marketing_consent', 'false', 'stopping again is not an error');
reset role;
select is(
  (select string_agg(c.purpose::text || ':' || (c.revoked_at is not null), ',' order by c.purpose) from public.consent_records c
   where c.subject_id = pg_temp.customer_of((select login_2 from fx))),
  'loyalty:false,marketing:true',
  'the marketing consent is revoked, the row kept, and the loyalty consent stays'
);
select is(
  app.has_active_consent((select tenant_c from fx), 'customer', pg_temp.customer_of((select login_2 from fx)), 'marketing'),
  false,
  'so no promotional message can pass the consent check afterwards'
);

set local role authenticated;
select pg_temp.as_customer((select login_2 from fx), (select tenant_c from fx), pg_temp.customer_of((select login_2 from fx)));
insert into deletion select public.customer_request_deletion();
select is(
  (select (answer - 'request_id' - 'requested_at' - 'first_response_due_at' - 'completion_due_at') from deletion),
  '{"status": "received"}'::jsonb,
  'the deletion request is received'
);
select is(
  public.customer_request_deletion() ->> 'request_id',
  (select answer ->> 'request_id' from deletion),
  'asking again answers the open request'
);
reset role;
select is(
  (select concat_ws('|', r.subject_type, r.subject_id = pg_temp.customer_of((select login_2 from fx)), r.request_type, r.contact, r.status, r.first_response_due_at > r.received_at, r.completion_due_at > r.received_at)
   from public.data_subject_requests r where r.id = (select (answer ->> 'request_id')::uuid from deletion)),
  'customer|t|deletion|mini_app|received|t|t',
  'it is a data-subject request of the customer with its deadlines'
);

select * from finish();
rollback;
