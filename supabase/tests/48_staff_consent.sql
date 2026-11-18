begin;
select plan(72);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004801'::uuid as tenant_c,
  'dddddddd-dddd-4ddd-8ddd-000000004802'::uuid as tenant_d,
  'eeeeeeee-eeee-4eee-8eee-000000004801'::uuid as owner_c,
  'eeeeeeee-eeee-4eee-8eee-000000004802'::uuid as manager_c,
  'eeeeeeee-eeee-4eee-8eee-000000004803'::uuid as manager_c1,
  'eeeeeeee-eeee-4eee-8eee-000000004804'::uuid as staff_p,
  'eeeeeeee-eeee-4eee-8eee-000000004805'::uuid as staff_q,
  'eeeeeeee-eeee-4eee-8eee-000000004806'::uuid as viewer_c,
  'eeeeeeee-eeee-4eee-8eee-000000004807'::uuid as publisher_c,
  'eeeeeeee-eeee-4eee-8eee-000000004808'::uuid as owner_d,
  'eeeeeeee-eeee-4eee-8eee-000000004809'::uuid as outsider,
  'cccccccc-cccc-4ccc-8ccc-000000004801'::uuid as account_c,
  'ffffffff-ffff-4fff-8fff-000000004801'::uuid as store_c1,
  'ffffffff-ffff-4fff-8fff-000000004802'::uuid as store_c2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004801'::uuid as brand_c,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000004811'::uuid as app_c,
  'aaaaaaaa-0000-4000-8000-000000004801'::uuid as roster_p,
  'aaaaaaaa-0000-4000-8000-000000004802'::uuid as roster_q,
  'aaaaaaaa-0000-4000-8000-000000004811'::uuid as session_p,
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_c, 'consent-owner-c@example.com'),
    (fx.manager_c, 'consent-manager-c@example.com'),
    (fx.manager_c1, 'consent-manager-c1@example.com'),
    (fx.staff_p, 'consent-staff-p@example.com'),
    (fx.staff_q, 'consent-staff-q@example.com'),
    (fx.viewer_c, 'consent-viewer-c@example.com'),
    (fx.publisher_c, 'consent-publisher-c@example.com'),
    (fx.owner_d, 'consent-owner-d@example.com'),
    (fx.outsider, 'consent-outsider@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_c, 'consent-pgtap-c', 'Consent pgTAP C' from fx
union all
select tenant_d, 'consent-pgtap-d', 'Consent pgTAP D' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_c, tenant_c, 'mock', 'consent-account-c', 'Synthetic account C' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_c1, tenant_c, account_c, 'consent-store-c1', 'Synthetic store C1' from fx
union all
select store_c2, tenant_c, account_c, 'consent-store-c2', 'Synthetic store C2' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_c, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_c, 'owner', null::uuid[]),
    (fx.manager_c, 'manager', null::uuid[]),
    (fx.manager_c1, 'manager', array[fx.store_c1]),
    (fx.staff_p, 'staff', array[fx.store_c1]),
    (fx.viewer_c, 'viewer', null::uuid[]),
    (fx.publisher_c, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select tenant_d, owner_d, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.staff_roster (id, tenant_id, display_name, role, store_ids, status, user_id, paired_at, created_by)
select roster_p, tenant_c, 'Nhân viên P', 'staff'::public.tenant_role, array[store_c1], 'active', staff_p, now() - interval '2 days', owner_c from fx
union all
select roster_q, tenant_c, 'Nhân viên Q', 'staff'::public.tenant_role, array[store_c2], 'invited', staff_q, null::timestamptz, owner_c from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_c, tenant_c, 'brand-981', 'Synthetic brand C', array[store_c1, store_c2] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_c, tenant_c, brand_c, 'synthetic-consent-app-c', 'ZALO_APP_SECRET_BRAND_981', 'active' from fx;

insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_c, app_c, 'synthetic-consent-zalo-p', staff_p, 'Synthetic P' from fx;

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at, created_by)
select tenant_c, 'staff_notice'::public.legal_document_kind, 'vi', 'staff-notice-2026-01', 'Thông báo cho nhân viên', E'# Thông báo\n\nVăn bản thử.', 'published'::public.legal_document_status, now() - interval '1 day', owner_c from fx
union all
select tenant_c, 'staff_notice'::public.legal_document_kind, 'en', 'staff-notice-2026-01-en', 'Staff notice', E'# Notice\n\nSynthetic text.', 'published', now() - interval '1 day', owner_c from fx;

grant select on fx to authenticated, service_role, anon;

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.active_staff_ops(p_user uuid)
returns integer
language sql
as $$
  select count(*)::integer
  from public.consent_records c, fx
  where c.tenant_id = fx.tenant_c
    and c.subject_type = 'staff'
    and c.subject_id = p_user
    and c.purpose = 'staff_ops'
    and c.revoked_at is null;
$$;

select ok(
  (select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('published_staff_notice', 'staff_ops_consent_state', 'staff_notice_acceptance_valid', 'record_staff_ops_consent',
                       'revoke_staff_ops_consent', 'accept_staff_notice', 'withdraw_staff_ops_consent', 'my_staff_notice')),
  'the eight staff notice functions in app are security definer with an empty search_path'
);
select ok(
  (select bool_and(not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('accept_staff_notice', 'withdraw_staff_ops_consent', 'my_staff_notice')),
  'the three RPCs are security invoker wrappers with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_staff_notice(uuid, text, timestamptz)', 'execute')
    and has_function_privilege('authenticated', 'public.withdraw_staff_ops_consent(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.my_staff_notice(uuid)', 'execute'),
  'a signed-in person calls the three RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.accept_staff_notice(uuid, text, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.withdraw_staff_ops_consent(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.my_staff_notice(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.accept_staff_notice(uuid, text, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'public.withdraw_staff_ops_consent(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.my_staff_notice(uuid)', 'execute'),
  'anon and the service role, which has no person behind it, call none of them'
);
select ok(
  not has_function_privilege('authenticated', 'app.record_staff_ops_consent(uuid, uuid, text, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.record_staff_ops_consent(uuid, uuid, text, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'app.record_staff_ops_consent(uuid, uuid, text, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'app.revoke_staff_ops_consent(uuid, uuid, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.revoke_staff_ops_consent(uuid, uuid, timestamptz)', 'execute'),
  'no API role records or revokes a staff_ops consent for a person it names'
);
select is(
  (select array_agg(p.policyname::text order by p.policyname)
   from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'consent_records' and p.permissive = 'RESTRICTIVE'),
  array['consent_records_notifications_not_inserted_from_browser', 'consent_records_notifications_not_updated_from_browser',
        'consent_records_staff_ops_not_inserted_from_browser', 'consent_records_staff_ops_not_updated_from_browser'],
  'consent_records carries restrictive policies for notifications and for staff_ops'
);

select is(app.staff_ops_consent_state((select tenant_c from fx), (select staff_p from fx)), 'missing', 'a person without a staff_ops row has a missing consent');
select is(
  (select app.zalo_sign_in(app_c, 'synthetic-consent-zalo-p') from fx),
  (select jsonb_build_object('status', 'notice_required', 'notice', app.published_staff_notice(tenant_c)) from fx),
  'a bound person on the roster without consent gets notice_required with the notice and no session'
);
select is(
  (select app.published_staff_notice(tenant_c) - 'published_at' from fx),
  '{"version": "staff-notice-2026-01", "title": "Thông báo cho nhân viên", "body_markdown": "# Thông báo\n\nVăn bản thử."}'::jsonb,
  'the notice is the published Vietnamese staff_notice'
);
select is(app.published_staff_notice((select tenant_d from fx)), null, 'a tenant without a published staff notice has none');

set local role authenticated;
select is(
  pg_temp.outcome_as(f.user_id, $q$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select tenant_c, 'staff', staff_p, 'staff_ops', 'staff-notice-2026-01', 'web', now() from fx $q$),
  '42501',
  'the browser cannot insert a staff_ops row: ' || f.label
)
from (
  select 'owner' as label, owner_c as user_id, 1 as n from fx
  union all select 'unlimited manager', manager_c, 2 from fx
  union all select 'store manager', manager_c1, 3 from fx
  union all select 'the person themselves', staff_p, 4 from fx
  union all select 'viewer', viewer_c, 5 from fx
  union all select 'publisher', publisher_c, 6 from fx
  union all select 'another tenant''s owner', owner_d, 7 from fx
) as f
order by f.n;
select is(
  pg_temp.outcome_as((select owner_c from fx), $q$ insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
     select tenant_c, 'customer', 'aaaaaaaa-0000-4000-8000-000000004899', 'loyalty', 'privacy-2026-01', 'till', now() from fx $q$),
  'ok',
  'an owner still records a customer''s loyalty consent'
);
reset role;

select is(pg_temp.active_staff_ops((select staff_p from fx)), 0, 'no staff_ops row came from the browser');

select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2025-12', now() - interval '1 minute', now()) from fx $q$,
  '22023', null, 'a version that is not the published one is refused'
);
select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01-en', now() - interval '1 minute', now()) from fx $q$,
  '22023', null, 'the English version is not the notice of record'
);
select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01', null, now()) from fx $q$,
  '22023', null, 'an acceptance without the time the notice was shown is refused'
);
select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01', now() + interval '6 minutes', now()) from fx $q$,
  '22023', null, 'a notice shown after its acceptance is refused'
);
select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01', now() - interval '2 days', now()) from fx $q$,
  '22023', null, 'a notice shown before its publication is refused'
);
select throws_ok(
  $q$ select app.record_staff_ops_consent(tenant_d, owner_d, 'staff-notice-2026-01', now() - interval '1 minute', now()) from fx $q$,
  '22023', null, 'another tenant''s notice version does not count'
);

create temp table first_consent as
select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01', now() - interval '2 minutes', now()) as id from fx;
grant select on first_consent to authenticated;

select is(
  (select array[c.subject_type::text, c.purpose::text, c.policy_version, c.channel, (c.granted_at = now())::text, (c.revoked_at is null)::text]
   from public.consent_records c where c.id = (select id from first_consent)),
  array['staff', 'staff_ops', 'staff-notice-2026-01', 'mini_app', 'true', 'true'],
  'the row is an active staff_ops consent of the person on channel mini_app naming the published version'
);
select is(
  (select array_agg(k order by k) from public.consent_records c, jsonb_object_keys(c.evidence) k where c.id = (select id from first_consent)),
  array['accepted_at', 'method', 'notice_channel', 'notice_shown_at', 'notice_version'],
  'the evidence holds the method, the notice version and channel, when it was shown and when it was accepted'
);
select is(
  (select c.evidence - 'notice_shown_at' - 'accepted_at' from public.consent_records c where c.id = (select id from first_consent)),
  '{"method": "accept_button", "notice_version": "staff-notice-2026-01", "notice_channel": "mini_app"}'::jsonb,
  'the method is the button and the channel the Mini App'
);
select is(
  (select ((c.evidence ->> 'notice_shown_at')::timestamptz = now() - interval '2 minutes') and ((c.evidence ->> 'accepted_at')::timestamptz = now())
   from public.consent_records c where c.id = (select id from first_consent)),
  true,
  'the two times are those of the showing and of the acceptance'
);
select ok(
  (select c.evidence::text !~ 'synthetic-consent-zalo-p|consent-staff-p|\+84|phone|device|zalo_user' from public.consent_records c where c.id = (select id from first_consent)),
  'the evidence holds no Zalo id, login, phone or device detail'
);
select is(
  (select app.record_staff_ops_consent(tenant_c, staff_p, 'staff-notice-2026-01', now() - interval '1 minute', now()) from fx),
  (select id from first_consent),
  'accepting the same version again keeps the active row'
);
select is(pg_temp.active_staff_ops((select staff_p from fx)), 1, 'one active staff_ops row per person');
select is(app.staff_ops_consent_state((select tenant_c from fx), (select staff_p from fx)), 'current', 'the consent is current');
select is((select app.zalo_sign_in(app_c, 'synthetic-consent-zalo-p') ->> 'status' from fx), 'bound', 'with a current consent the person signs in');

set local role authenticated;
select pg_temp.act_as((select owner_c from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select manager_c from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select manager_c1 from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select staff_p from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select viewer_c from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select owner_d from fx));
update public.consent_records c set revoked_at = now() where c.id = (select id from first_consent);
select pg_temp.act_as((select owner_c from fx));
select is((select count(*)::integer from public.consent_records c where c.id = (select id from first_consent)), 1, 'the owner still reads the staff_ops row');
reset role;
select is(
  (select c.revoked_at from public.consent_records c where c.id = (select id from first_consent)),
  null,
  'no owner, manager, viewer, the person or another tenant can revoke or change it from the browser'
);

set local role authenticated;
select is(pg_temp.outcome_as((select staff_p from fx), $q$ select public.my_staff_notice(tenant_c) ->> 'consent' from fx $q$), 'ok', 'the person reads their notice state');
select pg_temp.act_as((select staff_p from fx));
select is(
  (select public.my_staff_notice(tenant_c) from fx) - 'notice',
  '{"consent": "current"}'::jsonb,
  'their consent is current'
);
select is((select public.my_staff_notice(tenant_c) -> 'notice' ->> 'version' from fx), 'staff-notice-2026-01', 'and the notice is named');
select pg_temp.act_as((select owner_c from fx));
select is((select public.my_staff_notice(tenant_c) ->> 'consent' from fx), 'not_required', 'an owner who is not on the roster needs no staff_ops consent');
select is(pg_temp.outcome_as((select outsider from fx), $q$ select public.my_staff_notice(tenant_c) from fx $q$), '42501', 'a login outside the tenant reads no notice state');
select is(pg_temp.outcome_as((select owner_d from fx), $q$ select public.my_staff_notice(tenant_c) from fx $q$), '42501', 'nor does another tenant''s owner');

select pg_temp.act_as((select owner_c from fx));
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown)
select tenant_c, 'staff_notice', 'vi', 'staff-notice-2026-02', 'Thông báo cho nhân viên, bản 2', E'# Thông báo\n\nBản thử 2.' from fx;
select public.publish_legal_document((select d.id from public.legal_documents d, fx where d.tenant_id = fx.tenant_c and d.version = 'staff-notice-2026-02'));
reset role;

select is(app.staff_ops_consent_state((select tenant_c from fx), (select staff_p from fx)), 'outdated', 'a newly published notice makes the earlier consent outdated');
select is(
  (select c.revoked_at is null and c.policy_version = 'staff-notice-2026-01' from public.consent_records c where c.id = (select id from first_consent)),
  true,
  'the earlier row is not rewritten: it still names the version accepted'
);
select is(
  (select app.zalo_sign_in(app_c, 'synthetic-consent-zalo-p') -> 'notice' ->> 'version' from fx),
  'staff-notice-2026-02',
  'the next sign-in asks again with the new version'
);
set local role authenticated;
select pg_temp.act_as((select staff_p from fx));
select is((select public.my_staff_notice(tenant_c) ->> 'consent' from fx), 'outdated', 'and the session sees it as outdated');

select is(
  pg_temp.outcome_as((select staff_p from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-01', now()) from fx $q$),
  '22023',
  'accepting the retired version is refused'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$),
  '42501',
  'an owner who is not on the roster accepts nothing'
);
select is(
  pg_temp.outcome_as((select manager_c from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$),
  '42501',
  'a manager cannot accept for staff'
);
select is(
  pg_temp.outcome_as((select staff_q from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$),
  '42501',
  'a person on the roster who has not paired accepts through the pairing step only'
);
select is(
  pg_temp.outcome_as((select outsider from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$),
  '42501',
  'a login outside the tenant accepts nothing'
);
select is(
  pg_temp.outcome_as((select staff_p from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$),
  'ok',
  'the person accepts the new version from their own session'
);
reset role;

select is(
  (select array_agg(c.policy_version || ':' || (c.revoked_at is null) order by c.granted_at, c.policy_version)
   from public.consent_records c, fx where c.tenant_id = fx.tenant_c and c.subject_id = fx.staff_p and c.purpose = 'staff_ops'),
  array['staff-notice-2026-01:false', 'staff-notice-2026-02:true'],
  'the outdated row is closed and the new version is the one active row'
);
select is(
  (select c.channel || ':' || (c.evidence ->> 'method') || ':' || (c.evidence ->> 'notice_version')
   from public.consent_records c, fx where c.tenant_id = fx.tenant_c and c.subject_id = fx.staff_p and c.purpose = 'staff_ops' and c.revoked_at is null),
  'mini_app:accept_button:staff-notice-2026-02',
  'the new row names the new version in its evidence'
);
select is((select app.zalo_sign_in(app_c, 'synthetic-consent-zalo-p') ->> 'status' from fx), 'bound', 'the person signs in again');

create temp table notifications_p as
select app.ensure_notifications_consent(tenant_c, staff_p, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, now()) as id from fx;
insert into auth.sessions (id, user_id, created_at, updated_at) select session_p, staff_p, now(), now() from fx;
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at) select 'synthetic-consent-refresh-4801', staff_p::text, session_p, false, now(), now() from fx;

set local role authenticated;
select is(
  pg_temp.outcome_as((select manager_c from fx), $q$ select public.withdraw_staff_ops_consent(tenant_c) from fx $q$),
  '42501',
  'a manager cannot withdraw on anyone''s behalf: the function acts for the caller, who is not on the roster'
);
select is(
  pg_temp.outcome_as((select owner_c from fx), $q$ select public.withdraw_staff_ops_consent(tenant_c) from fx $q$),
  '42501',
  'nor can an owner'
);
select pg_temp.act_as((select staff_p from fx));
select is((select public.withdraw_staff_ops_consent(tenant_c) from fx), true, 'the person withdraws their staff_ops consent');
reset role;

select is(pg_temp.active_staff_ops((select staff_p from fx)), 0, 'the staff_ops consent is revoked');
select is(
  (select c.revoked_at is null from public.consent_records c where c.id = (select id from notifications_p)),
  true,
  'the notifications consent is left as it was'
);
select is((select count(*)::integer from public.zalo_identities i, fx where i.tenant_id = fx.tenant_c and i.user_id = fx.staff_p), 0, 'the Zalo identity is unpaired');
select is(
  (select (select count(*) from auth.sessions s where s.user_id = fx.staff_p) + (select count(*) from auth.refresh_tokens t where t.session_id = fx.session_p) from fx)::integer,
  0,
  'the staff session is ended, with no refresh token left'
);
select is((select app.zalo_sign_in(app_c, 'synthetic-consent-zalo-p') from fx) ->> 'status', 'unpaired', 'the next zalo-session call is unpaired');
select is(
  (select r.status || ':' || (m.user_id is not null) from fx, public.staff_roster r left join public.tenant_members m on m.tenant_id = r.tenant_id and m.user_id = r.user_id where r.id = fx.roster_p),
  'active:true',
  'the roster row and the membership stay, so the notification destinations keep their scope'
);
set local role authenticated;
select pg_temp.act_as((select staff_p from fx));
select is((select public.withdraw_staff_ops_consent(tenant_c) from fx), false, 'withdrawing again changes nothing more');
select is(pg_temp.outcome_as((select staff_p from fx), $q$ select public.accept_staff_notice(tenant_c, 'staff-notice-2026-02', now()) from fx $q$), 'ok', 'consent given again from the person''s own session');
reset role;

select app.withdraw_notifications((select tenant_c from fx), (select staff_p from fx), now());
select is(
  (select c.revoked_at is not null from public.consent_records c where c.id = (select id from notifications_p)),
  true,
  'withdrawing notifications revokes that consent'
);
select is(pg_temp.active_staff_ops((select staff_p from fx)), 1, 'and leaves staff_ops as it was');

set local role anon;
select throws_ok($q$ select public.withdraw_staff_ops_consent('dddddddd-dddd-4ddd-8ddd-000000004801') $q$, '42501', null, 'anon cannot withdraw');
select throws_ok($q$ select public.accept_staff_notice('dddddddd-dddd-4ddd-8ddd-000000004801', 'staff-notice-2026-02', now()) $q$, '42501', null, 'anon cannot accept');
reset role;

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at, created_by)
select demo_tenant, 'staff_notice', 'vi', 'staff-privacy-notice-2026-01', 'Demo staff notice', E'# Demo staff notice\n\nPlaceholder text for the demo tenant. It is not a legal text.', 'published', now() - interval '31 days', demo_owner
from fx
where not exists (select 1 from public.legal_documents d where d.tenant_id = fx.demo_tenant and d.kind = 'staff_notice' and d.status = 'published');
select is(
  (select c.policy_version from public.consent_records c, fx where c.tenant_id = fx.demo_tenant and c.subject_id = fx.demo_owner and c.purpose = 'staff_ops' and c.revoked_at is null),
  'staff-privacy-notice-2026-01',
  'the demo tenant''s synthetic staff_ops row names the seeded notice version'
);
select is(app.staff_ops_consent_state((select demo_tenant from fx), (select demo_owner from fx)), 'current', 'and stays current against the seeded notice');

select * from finish();
rollback;
