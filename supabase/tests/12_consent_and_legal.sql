begin;
select plan(57);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid as tea_manager_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid as staff_id,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid as viewer_id,
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid as publisher_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as unlimited_manager_id,
  (select id from public.customers where phone = '0900000001') as customer_1_id,
  (select id from public.customers where phone = '0900000002') as customer_2_id,
  (select id from public.customers where phone = '0900000003') as customer_3_id,
  (select id from public.customers where phone = '0900000004') as customer_4_id,
  (select id from public.customers where phone = '0900000005') as customer_5_id;

insert into auth.users (id, instance_id, aud, role, email)
select tea_manager_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'manager@example.com'::varchar from fixture
union all
select staff_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'staff@example.com'::varchar from fixture
union all
select viewer_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'viewer@example.com'::varchar from fixture
union all
select publisher_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'publisher@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture
union all
select unlimited_manager_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'unlimited-manager@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_manager_id, 'manager'::public.tenant_role, array[tea_store_id] from fixture
union all
select demo_tenant_id, staff_id, 'staff'::public.tenant_role, null::uuid[] from fixture
union all
select demo_tenant_id, viewer_id, 'viewer'::public.tenant_role, null::uuid[] from fixture
union all
select demo_tenant_id, publisher_id, 'publisher'::public.tenant_role, null::uuid[] from fixture
union all
select demo_tenant_id, unlimited_manager_id, 'manager'::public.tenant_role, null::uuid[] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

grant select on fixture to authenticated, service_role;

select is((select count(*) from public.consent_records where tenant_id = (select demo_tenant_id from fixture)), 9::bigint, 'seed holds nine consent records');
select is((select count(*) from public.consent_records where tenant_id = (select demo_tenant_id from fixture) and revoked_at is null), 8::bigint, 'seed holds eight active consent records');
select is((select count(*) from public.data_subject_requests), 1::bigint, 'seed holds one data subject request');
select is((select count(*) from public.outbound_messages where tenant_id = (select demo_tenant_id from fixture)), 2::bigint, 'seed holds two outbound messages');

select ok(app.has_active_consent((select demo_tenant_id from fixture), 'customer', (select customer_1_id from fixture), 'loyalty'), 'loyalty consent of a seeded customer is active');
select ok(not app.has_active_consent((select demo_tenant_id from fixture), 'customer', (select customer_3_id from fixture), 'marketing'), 'a revoked marketing consent is not active');
select ok(not app.has_active_consent((select demo_tenant_id from fixture), 'customer', (select customer_4_id from fixture), 'marketing'), 'a customer without a marketing record has no active consent');
select ok(app.has_active_consent((select demo_tenant_id from fixture), 'staff', (select demo_owner_id from fixture), 'staff_ops'), 'staff_ops consent of the dev user is active');
select ok(not app.has_active_consent((select other_tenant_id from fixture), 'customer', (select customer_1_id from fixture), 'loyalty'), 'consent is scoped to the tenant that recorded it');

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'customer', customer_1_id, 'loyalty', 'privacy-policy-2026-01', 'till', now() from fixture $$,
  '23505',
  null,
  'a second active consent for the same subject and purpose is rejected'
);

select lives_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'customer', customer_3_id, 'marketing', 'privacy-policy-2026-01', 'mini_app', now() from fixture $$,
  'a new consent may follow a revoked one for the same subject and purpose'
);

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at)
     select demo_tenant_id, 'customer', customer_4_id, 'marketing', 'privacy-policy-2026-01', 'mini_app', now(), now() - interval '1 day' from fixture $$,
  '23514',
  null,
  'a revocation before the grant is rejected'
);

select is(
  (select first_response_due_at from app.dsr_deadlines('2026-11-06 10:00+07', 'VN', 'Asia/Ho_Chi_Minh', false)),
  '2026-11-10 10:00+07'::timestamptz,
  'a request received on a Friday gets its first response due on Tuesday'
);
select is(
  (select completion_due_at from app.dsr_deadlines('2026-11-06 10:00+07', 'VN', 'Asia/Ho_Chi_Minh', false)),
  '2026-11-26 10:00+07'::timestamptz,
  'completion is due 20 calendar days after receipt'
);
select is(
  (select first_response_due_at from app.dsr_deadlines('2026-04-29 09:00+07', 'VN', 'Asia/Ho_Chi_Minh', true)),
  '2026-05-05 09:00+07'::timestamptz,
  'Reunification Day, Labour Day and the weekend are skipped for the first response'
);
select is(
  (select completion_due_at from app.dsr_deadlines('2026-04-29 09:00+07', 'VN', 'Asia/Ho_Chi_Minh', true)),
  '2026-05-29 09:00+07'::timestamptz,
  'completion is due 30 calendar days after receipt when a processor is involved'
);
select is(
  (select first_response_due_at from app.dsr_deadlines('2026-08-31 15:30+07', 'VN', 'Asia/Ho_Chi_Minh', false)),
  '2026-09-04 15:30+07'::timestamptz,
  'National Day and its adjacent holiday are skipped for the first response'
);
select is(
  (select first_response_due_at from app.dsr_deadlines('2026-02-13 08:00+07', 'VN', 'Asia/Ho_Chi_Minh', false)),
  '2026-02-24 08:00+07'::timestamptz,
  'the Tet window is skipped for the first response'
);

select is(
  (select r.first_response_due_at from public.data_subject_requests r),
  (select d.first_response_due_at from public.data_subject_requests r cross join lateral app.dsr_deadlines(r.received_at, 'VN', 'Asia/Ho_Chi_Minh', r.uses_processor) d),
  'the trigger filled the first response deadline of the seeded request'
);
select is(
  (select r.completion_due_at from public.data_subject_requests r),
  (select d.completion_due_at from public.data_subject_requests r cross join lateral app.dsr_deadlines(r.received_at, 'VN', 'Asia/Ho_Chi_Minh', r.uses_processor) d),
  'the trigger filled the completion deadline of the seeded request'
);

insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type, received_at, first_response_due_at, completion_due_at)
select demo_tenant_id, 'customer', 'synthetic-contact-explicit', 'export', '2026-11-06 10:00+07', '2026-11-07 10:00+07', '2026-11-20 10:00+07' from fixture;

select is(
  (select first_response_due_at from public.data_subject_requests where contact = 'synthetic-contact-explicit'),
  '2026-11-07 10:00+07'::timestamptz,
  'an explicit first response deadline is kept by the trigger'
);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select null::uuid, 'ZZ', '2026-01-01'::date + n, 'synthetic closure', 'custom'::public.holiday_kind from generate_series(1, 120) as n;

select throws_ok(
  $$ select * from app.dsr_deadlines('2026-01-01 09:00+07', 'ZZ', 'Asia/Ho_Chi_Minh', false) $$,
  'P0001',
  null,
  'the deadline rule raises instead of returning null when no second working day exists within the scan window'
);

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
select demo_tenant_id, 'staff', demo_owner_id, 'notifications', 'ops-notifications-v1', 'web', now() - interval '1 day', '{"method": "web_session", "notice_channel": "web", "synthetic": true}'::jsonb from fixture;

set local role service_role;

select throws_ok(
  $$ update public.consent_records set granted_at = granted_at - interval '1 day'
     where subject_id = (select customer_1_id from fixture) and purpose = 'loyalty' $$,
  'P0001',
  'consent_records is an append-only ledger: only revoked_at may change',
  'service role cannot rewrite granted_at of a consent record'
);

select throws_ok(
  $$ update public.consent_records set revoked_at = null
     where subject_id = (select customer_3_id from fixture) and purpose = 'marketing' and revoked_at is not null $$,
  'P0001',
  'consent_records revocation is final: revoked_at cannot be cleared or moved once set',
  'service role cannot un-revoke a consent record'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'customer', customer_5_id, 'marketing', 'privacy-policy-2026-01', 'till', now() from fixture $$,
  'owner records a consent for the own tenant'
);

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select other_tenant_id, 'customer', customer_5_id, 'marketing', 'privacy-policy-2026-01', 'till', now() from fixture $$,
  '42501',
  null,
  'owner cannot record a consent for another tenant'
);

select lives_ok(
  $$ update public.consent_records set revoked_at = now()
     where subject_id = (select customer_2_id from fixture) and purpose = 'marketing' and revoked_at is null $$,
  'owner revokes a consent by setting revoked_at'
);

select ok(not app.has_active_consent((select demo_tenant_id from fixture), 'customer', (select customer_2_id from fixture), 'marketing'), 'the revoked consent is no longer active');

select throws_ok(
  $$ update public.consent_records set revoked_at = null
     where subject_id = (select customer_2_id from fixture) and purpose = 'marketing' $$,
  'P0001',
  'consent_records revocation is final: revoked_at cannot be cleared or moved once set',
  'owner cannot un-revoke a consent record'
);

select throws_ok(
  $$ update public.consent_records set granted_at = now()
     where subject_id = (select customer_1_id from fixture) and purpose = 'loyalty' $$,
  'P0001',
  'consent_records is an append-only ledger: only revoked_at may change',
  'owner cannot change granted_at of a consent record'
);

select throws_ok(
  $$ update public.consent_records set evidence = '{"forged": true}'::jsonb
     where subject_id = (select customer_1_id from fixture) and purpose = 'loyalty' $$,
  'P0001',
  'consent_records is an append-only ledger: only revoked_at may change',
  'owner cannot change the evidence of a consent record'
);

select throws_ok(
  $$ update public.consent_records set policy_version = 'privacy-policy-2027-01'
     where subject_id = (select customer_1_id from fixture) and purpose = 'loyalty' $$,
  'P0001',
  'consent_records is an append-only ledger: only revoked_at may change',
  'owner cannot change the policy version of a consent record'
);

select throws_ok(
  $$ update public.consent_records set purpose = 'marketing'
     where subject_id = (select customer_1_id from fixture) and purpose = 'loyalty' $$,
  'P0001',
  'consent_records is an append-only ledger: only revoked_at may change',
  'owner cannot change the purpose of a consent record'
);

select throws_ok(
  $$ delete from public.consent_records where purpose = 'marketing' $$,
  '42501',
  null,
  'owner cannot delete consent records'
);

select lives_ok(
  $$ insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type)
     select demo_tenant_id, 'customer', customer_5_id, 'synthetic-contact-5', 'deletion' from fixture $$,
  'owner files a data subject request without naming the deadlines'
);

select isnt(
  (select first_response_due_at from public.data_subject_requests where contact = 'synthetic-contact-5'),
  null,
  'the trigger fills the deadlines of a request filed from the browser'
);

select throws_ok(
  $$ insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type)
     select other_tenant_id, 'customer', 'synthetic-contact-x', 'access' from fixture $$,
  '42501',
  null,
  'owner cannot file a data subject request for another tenant'
);

select is((select count(*) from public.data_subject_requests), 3::bigint, 'owner reads the requests of the own tenant');
select is((select count(*) from public.outbound_messages), 2::bigint, 'owner reads the outbound messages of the own tenant');

select throws_ok(
  $$ insert into public.outbound_messages (tenant_id, channel, recipient_ref, status)
     select demo_tenant_id, 'zalo_oa', 'forged-ref', 'sent' from fixture $$,
  '42501',
  null,
  'owner cannot insert outbound messages'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'customer', customer_4_id, 'marketing', 'privacy-policy-2026-01', 'till', now() from fixture $$,
  'store-limited manager records a consent captured at the till'
);

select throws_ok(
  $$ insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type)
     select demo_tenant_id, 'customer', 'synthetic-contact-y', 'access' from fixture $$,
  '42501',
  null,
  'store-limited manager cannot file a data subject request'
);

select is((select count(*) from public.data_subject_requests), 0::bigint, 'store-limited manager reads no data subject request');

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'staff', tea_manager_id, 'notifications', 'ops-notifications-v1', 'web', now() from fixture $$,
  '42501',
  null,
  'store-limited manager cannot insert a notifications consent'
);

update public.consent_records set revoked_at = now()
where subject_id = (select demo_owner_id from fixture) and purpose = 'notifications' and revoked_at is null;

select ok(app.has_active_consent((select demo_tenant_id from fixture), 'staff', (select demo_owner_id from fixture), 'notifications'), 'store-limited manager cannot revoke the owner''s notifications consent');

set local request.jwt.claims to '{"sub": "88888888-8888-4888-8888-888888888888", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'staff', unlimited_manager_id, 'notifications', 'ops-notifications-v1', 'web', now() from fixture $$,
  '42501',
  null,
  'unlimited manager cannot insert a notifications consent'
);

update public.consent_records set revoked_at = now()
where subject_id = (select demo_owner_id from fixture) and purpose = 'notifications' and revoked_at is null;

select ok(app.has_active_consent((select demo_tenant_id from fixture), 'staff', (select demo_owner_id from fixture), 'notifications'), 'unlimited manager cannot revoke the owner''s notifications consent');

set local request.jwt.claims to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select demo_tenant_id, 'customer', customer_5_id, 'loyalty', 'privacy-policy-2026-01', 'till', now() from fixture $$,
  '42501',
  null,
  'viewer cannot record a consent'
);

select cmp_ok((select count(*) from public.consent_records), '>', 0::bigint, 'viewer reads the consent records of the tenant');
select is((select count(*) from public.data_subject_requests), 0::bigint, 'viewer reads no data subject request');
select is((select count(*) from public.outbound_messages), 0::bigint, 'viewer reads no outbound message');

set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select cmp_ok((select count(*) from public.consent_records), '>', 0::bigint, 'staff reads the consent records of the tenant');
select is((select count(*) from public.data_subject_requests) + (select count(*) from public.outbound_messages), 0::bigint, 'staff reads no data subject request and no outbound message');

set local request.jwt.claims to '{"sub": "ffffffff-ffff-4fff-8fff-ffffffffffff", "role": "authenticated"}';

select is((select count(*) from public.consent_records) + (select count(*) from public.data_subject_requests) + (select count(*) from public.outbound_messages), 0::bigint, 'publisher reads zero rows of the legal tables');

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.consent_records), 0::bigint, 'other owner reads no demo consent record');
select is((select count(*) from public.data_subject_requests), 0::bigint, 'other owner reads no demo data subject request');
select is((select count(*) from public.outbound_messages), 0::bigint, 'other owner reads no demo outbound message');

select * from finish();
rollback;
