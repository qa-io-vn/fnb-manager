begin;
select plan(65);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005401'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000005402'::uuid as tenant_u,
  'eeeeeeee-eeee-4eee-8eee-000000005401'::uuid as owner_t,
  'eeeeeeee-eeee-4eee-8eee-000000005402'::uuid as owner_t1,
  'eeeeeeee-eeee-4eee-8eee-000000005403'::uuid as manager_t,
  'eeeeeeee-eeee-4eee-8eee-000000005404'::uuid as staff_t,
  'eeeeeeee-eeee-4eee-8eee-000000005405'::uuid as viewer_t,
  'eeeeeeee-eeee-4eee-8eee-000000005406'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000005407'::uuid as limited_t,
  'cccccccc-cccc-4ccc-8ccc-000000005401'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000005402'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000005401'::uuid as store_t1,
  'ffffffff-ffff-4fff-8fff-000000005402'::uuid as store_t2,
  'ffffffff-ffff-4fff-8fff-000000005403'::uuid as store_t3,
  'ffffffff-ffff-4fff-8fff-000000005404'::uuid as store_u1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005401'::uuid as brand_t,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005402'::uuid as brand_off,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005403'::uuid as brand_u,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005411'::uuid as app_t,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005412'::uuid as app_off,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005413'::uuid as app_u,
  '2026-11-18 03:00:00+00'::timestamptz as t0,
  E'Gặp quản lý ca tại quầy.\nGọi 0901 234 567 hoặc gửi thư tới hr@example.com.' as contact;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_t, 'texts-owner-t@example.com'),
    (fx.owner_t1, 'texts-owner-t1@example.com'),
    (fx.manager_t, 'texts-manager-t@example.com'),
    (fx.staff_t, 'texts-staff-t@example.com'),
    (fx.viewer_t, 'texts-viewer-t@example.com'),
    (fx.owner_u, 'texts-owner-u@example.com'),
    (fx.limited_t, 'texts-limited-t@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_t, 'texts-pgtap-t', 'Texts pgTAP T' from fx
union all
select tenant_u, 'texts-pgtap-u', 'Texts pgTAP U' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'texts-account-t', 'Synthetic account T' from fx
union all
select account_u, tenant_u, 'mock', 'texts-account-u', 'Synthetic account U' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_t1, tenant_t, account_t, 'texts-store-t1', 'Synthetic store Z' from fx
union all
select store_t2, tenant_t, account_t, 'texts-store-t2', 'Synthetic store A' from fx
union all
select store_t3, tenant_t, account_t, 'texts-store-t3', 'Synthetic store M' from fx
union all
select store_u1, tenant_u, account_u, 'texts-store-u1', 'Synthetic store U' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_t, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_t, 'owner', null::uuid[]),
    (fx.owner_t1, 'owner', array[fx.store_t1]),
    (fx.manager_t, 'manager', null::uuid[]),
    (fx.staff_t, 'staff', array[fx.store_t1]),
    (fx.viewer_t, 'viewer', null::uuid[]),
    (fx.limited_t, 'manager', array[fx.store_t2, fx.store_t3])
) as m (user_id, role, store_ids)
union all
select tenant_u, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at, created_by)
select tenant_t, 'Nhân viên T', 'staff'::public.tenant_role, array[store_t1], 'active', staff_t, now() - interval '2 days', owner_t from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-971', 'Synthetic brand T', array[store_t1, store_t2] from fx
union all
select brand_off, tenant_t, 'brand-972', 'Synthetic brand off', array[store_t3] from fx
union all
select brand_u, tenant_u, 'brand-973', 'Synthetic brand U', array[store_u1] from fx;

insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-texts-app-t', 'ZALO_APP_SECRET_BRAND_971', 'active' from fx
union all
select app_off, tenant_t, brand_off, 'synthetic-texts-app-off', 'ZALO_APP_SECRET_BRAND_972', 'disabled' from fx
union all
select app_u, tenant_u, brand_u, 'synthetic-texts-app-u', 'ZALO_APP_SECRET_BRAND_973', 'active' from fx;

insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_t, app_t, 'texts-zalo-staff', staff_t, 'Synthetic staff' from fx
union all
select tenant_t, app_t, 'texts-zalo-owner', owner_t, 'Synthetic owner' from fx
union all
select tenant_t, app_t, 'texts-zalo-limited', limited_t, 'Synthetic limited' from fx
union all
select tenant_t, app_t, 'texts-zalo-owner-t1', owner_t1, 'Synthetic owner T1' from fx;

insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at, retired_at, created_by)
select fx.tenant_t, d.kind::public.legal_document_kind, d.language, d.version, d.title, d.body, d.status::public.legal_document_status, d.published_at, d.retired_at, fx.owner_t
from fx
cross join lateral (
  values
    ('mini_app_terms', 'vi', 'terms-2026-01', 'Điều khoản sử dụng', 'Điều khoản thử.', 'published', now() - interval '3 days', null::timestamptz),
    ('privacy_notice', 'en', 'privacy-2026-01-en', 'Privacy notice', 'Synthetic privacy text.', 'published', now() - interval '3 days', null::timestamptz),
    ('privacy_notice', 'vi', 'privacy-2026-01', 'Thông báo quyền riêng tư', E'# Quyền riêng tư\n\nVăn bản thử.', 'published', now() - interval '3 days', null::timestamptz),
    ('privacy_notice', 'vi', 'privacy-2026-02', 'Bản nháp', 'Bản nháp chưa công bố.', 'draft', null::timestamptz, null::timestamptz),
    ('mini_app_terms', 'en', 'terms-2025-01-en', 'Retired terms', 'Retired text.', 'retired', now() - interval '30 days', now() - interval '20 days'),
    ('staff_notice', 'vi', 'texts-notice-2026-01', 'Thông báo cho nhân viên', 'Thông báo thử.', 'published', now() - interval '3 days', null::timestamptz),
    ('data_protection_rules', 'vi', 'rules-2026-01', 'Quy định bảo vệ dữ liệu', 'Quy định thử.', 'published', now() - interval '3 days', null::timestamptz)
) as d (kind, language, version, title, body, status, published_at, retired_at)
union all
select fx.tenant_u, 'privacy_notice', 'vi', 'privacy-u-2026-01', 'Quyền riêng tư U', 'Văn bản U.', 'published', now() - interval '3 days', null::timestamptz, fx.owner_u
from fx;

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

create function pg_temp.set_contact_as(p_user uuid, p_text text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform public.set_staff_contact_instructions((select tenant_t from fx), p_text);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.texts_entries(p_answer jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg((d ->> 'kind') || ':' || (d ->> 'language') || ':' || (d ->> 'version') order by n), '{}')
  from jsonb_array_elements(p_answer -> 'documents') with ordinality as e (d, n);
$$;

grant execute on function pg_temp.set_contact_as(uuid, text) to authenticated;

select has_column('public', 'tenants', 'staff_contact_instructions', 'tenants carries the staff contact instructions');
select columns_are('app', 'zalo_texts_requests', array['zalo_app_id', 'window_started_at', 'requests'], 'the texts rate limit keeps only the app, its window and a count, no caller detail');
select ok(
  has_function_privilege('authenticated', 'public.set_staff_contact_instructions(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.set_staff_contact_instructions(uuid, text)', 'execute')
    and not has_function_privilege('service_role', 'public.set_staff_contact_instructions(uuid, text)', 'execute'),
  'set_staff_contact_instructions is for signed-in members only'
);
select ok(
  has_function_privilege('service_role', 'public.zalo_session_texts(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.zalo_session_texts(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.zalo_session_texts(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.zalo_texts(uuid, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'app.zalo_texts(uuid, timestamptz)', 'execute'),
  'only the service role asks for the texts, as zalo-session does'
);
select ok(
  not has_table_privilege('anon', 'app.zalo_texts_requests', 'select')
    and not has_table_privilege('authenticated', 'app.zalo_texts_requests', 'select')
    and not has_table_privilege('service_role', 'app.zalo_texts_requests', 'select'),
  'no API role reads the texts rate limit'
);
select ok(
  not has_column_privilege('authenticated', 'public.tenants', 'staff_contact_instructions', 'update'),
  'members do not write the contact instructions column directly'
);

select is(
  (select array_agg(app.text_holds_link(t) order by n) from unnest(array[
    'Xem https://example.com/lien-he',
    'xem www.example.com nhé',
    'Nhắn zalo.me/0901234567',
    'Trang example.com',
    'Fanpage Facebook.com/abc',
    'mailto://hr@example.com'
  ]) with ordinality as v (t, n)),
  array[true, true, true, true, true, true],
  'a URL, a www host, a host with a path and a host name are links'
);
select is(
  (select array_agg(app.text_holds_link(t) order by n) from unnest(array[
    'Gọi quản lý: 0901 234 567',
    'Zalo: 0901.234.567',
    'Gửi thư tới hr@example.com',
    'Ca sáng 07.00/14.00 tại TP.HCM, Q.1',
    'Tạm ứng tối đa 1.000.000đ'
  ]) with ordinality as v (t, n)),
  array[false, false, false, false, false],
  'phone numbers, e-mail addresses, times, abbreviations and amounts are not links'
);

set local role authenticated;
select is(pg_temp.set_contact_as((select owner_t from fx), E'  \r\nGặp quản lý ca tại quầy.\r\nGọi 0901 234 567 hoặc gửi thư tới hr@example.com.\n\t '), 'ok', 'an owner with every store sets the contact instructions');
select pg_temp.act_as((select owner_t from fx));
select is(
  (select public.set_staff_contact_instructions(tenant_t, E'  \r\nGặp quản lý ca tại quầy.\r\nGọi 0901 234 567 hoặc gửi thư tới hr@example.com.\n\t ') from fx),
  (select contact from fx),
  'it gets back the stored text: line breaks made \n and the ends trimmed'
);
reset role;
select is((select staff_contact_instructions from public.tenants where id = (select tenant_t from fx)), (select contact from fx), 'the tenant keeps the text');
select ok(
  (select profile_updated_by = (select owner_t from fx) and profile_updated_at is not null from public.tenants where id = (select tenant_t from fx)),
  'the tenant profile stamps record who changed it'
);
select is((select staff_contact_instructions from public.tenants where id = (select tenant_u from fx)), null, 'another tenant is untouched');

set local role authenticated;
select is(pg_temp.set_contact_as((select owner_t1 from fx), 'Khác'), '42501', 'a store-limited owner may not set it');
select is(pg_temp.set_contact_as((select manager_t from fx), 'Khác'), '42501', 'nor may a manager with every store');
select is(pg_temp.set_contact_as((select staff_t from fx), 'Khác'), '42501', 'nor a staff member');
select is(pg_temp.set_contact_as((select viewer_t from fx), 'Khác'), '42501', 'nor a viewer');
select is(pg_temp.set_contact_as((select owner_u from fx), 'Khác'), '42501', 'nor another tenant''s owner');
select is(pg_temp.set_contact_as((select owner_t from fx), repeat('a', 500)), 'ok', '500 characters are accepted');
select is(pg_temp.set_contact_as((select owner_t from fx), repeat('ă', 501)), '22023', '501 characters are refused');
select is(pg_temp.set_contact_as((select owner_t from fx), 'Xem https://example.com'), '22023', 'a URL is refused');
select is(pg_temp.set_contact_as((select owner_t from fx), 'Xem www.example.com'), '22023', 'a www host is refused');
select is(pg_temp.set_contact_as((select owner_t from fx), 'Nhắn zalo.me/0901234567'), '22023', 'a host with a path is refused');
select is(pg_temp.set_contact_as((select owner_t from fx), 'Xem example.vn'), '22023', 'a host name is refused');
select is(pg_temp.set_contact_as((select owner_t from fx), E'Gọi\u0007 quản lý'), '22023', 'a control character other than a line break or tab is refused');
select is(pg_temp.set_contact_as((select owner_t from fx), E'Quầy:\tgọi 0901 234 567, thư hr@example.com'), 'ok', 'a phone number, an e-mail address and a tab are accepted');
select pg_temp.act_as((select owner_t from fx));
select is((select public.set_staff_contact_instructions(tenant_t, E' \n\t ') from fx), null, 'a blank text clears the instructions and returns null');
select is((select public.set_staff_contact_instructions(tenant_t, null) from fx), null, 'so does null');
select is(
  pg_temp.outcome_as((select owner_t from fx), $q$ update public.tenants set staff_contact_instructions = 'Khác' where id = (select tenant_t from fx) $q$),
  '42501',
  'an owner cannot write the column without the function'
);
reset role;
select is((select staff_contact_instructions from public.tenants where id = (select tenant_t from fx)), null, 'the instructions are cleared');
select throws_ok(
  $q$ update public.tenants set staff_contact_instructions = 'Xem https://example.com' where id = (select tenant_t from fx) $q$,
  '23514',
  null,
  'the table refuses a link written past the function'
);
select throws_ok(
  $q$ update public.tenants set staff_contact_instructions = ' Khác' where id = (select tenant_t from fx) $q$,
  '23514',
  null,
  'and untrimmed text'
);

select ok(not ((select app.zalo_sign_in(app_t, 'texts-zalo-nobody') from fx) ? 'contact'), 'without instructions the unpaired answer has no contact');
select ok(not ((select app.zalo_sign_in(app_t, 'texts-zalo-staff') from fx) ? 'contact'), 'nor has notice_required');
set local role authenticated;
select pg_temp.act_as((select owner_t from fx));
select is((select public.set_staff_contact_instructions(tenant_t, contact) from fx), (select contact from fx), 'the owner sets the instructions again');
reset role;
select is(
  (select app.zalo_sign_in(app_t, 'texts-zalo-nobody') - 'notice' from fx),
  (select jsonb_build_object('status', 'unpaired', 'contact', contact) from fx),
  'an unpaired answer carries the contact instructions'
);
select is(
  (select app.zalo_pair(app_t, 'texts-zalo-nobody', null, '000000', 'texts-notice-2026-01', now() - interval '1 minute', null, now()) - 'notice' from fx),
  (select jsonb_build_object('status', 'unpaired', 'reason', 'code_refused', 'contact', contact) from fx),
  'so does a refused pairing code'
);
select is(
  (select app.zalo_sign_in(app_t, 'texts-zalo-staff') from fx),
  (select jsonb_build_object('status', 'notice_required', 'notice', app.published_staff_notice(tenant_t), 'contact', contact) from fx),
  'and notice_required, next to the notice'
);
select ok(not ((select app.zalo_sign_in(app_u, 'texts-zalo-nobody') from fx) ? 'contact'), 'another tenant''s answers do not carry them');

select is((select app.zalo_texts(app_t, t0) ->> 'status' from fx), 'texts', 'the texts request answers texts');
select is(
  (select pg_temp.texts_entries(app.zalo_texts(app_t, t0)) from fx),
  array['privacy_notice:vi:privacy-2026-01', 'privacy_notice:en:privacy-2026-01-en', 'mini_app_terms:vi:terms-2026-01'],
  'it holds the published privacy notice and terms in every language, privacy first and Vietnamese first; no draft, retired, staff notice or other kind'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select app.zalo_texts(app_t, t0) from fx)) as k),
  array['contact', 'documents', 'status'],
  'it says nothing else'
);
select is(
  (select app.zalo_texts(app_t, t0) -> 'documents' -> 0 from fx),
  (select jsonb_build_object('kind', 'privacy_notice', 'language', 'vi', 'version', 'privacy-2026-01', 'title', 'Thông báo quyền riêng tư', 'body_markdown', E'# Quyền riêng tư\n\nVăn bản thử.', 'published_at', d.published_at)
   from public.legal_documents d, fx
   where d.tenant_id = fx.tenant_t and d.version = 'privacy-2026-01'),
  'a document is {kind, language, version, title, body_markdown, published_at}'
);
select is((select app.zalo_texts(app_t, t0) ->> 'contact' from fx), (select contact from fx), 'and the contact instructions come along');
select is(
  (select app.zalo_texts(app_u, t0) from fx),
  (select jsonb_build_object('status', 'texts', 'documents', jsonb_build_array(jsonb_build_object('kind', 'privacy_notice', 'language', 'vi', 'version', 'privacy-u-2026-01', 'title', 'Quyền riêng tư U', 'body_markdown', 'Văn bản U.', 'published_at', d.published_at)), 'contact', null)
   from public.legal_documents d, fx
   where d.tenant_id = fx.tenant_u),
  'another brand''s app answers its own tenant''s texts, with a null contact when none is set'
);
select throws_ok(
  $q$ select app.zalo_texts((select app_off from fx), (select t0 from fx)) $q$,
  '22023',
  'the Zalo App is disabled',
  'a disabled app answers no texts'
);
select throws_ok(
  $q$ select app.zalo_texts('bbbbbbbb-bbbb-4bbb-8bbb-000000005499'::uuid, (select t0 from fx)) $q$,
  '22023',
  'unknown Zalo App',
  'nor does an unknown app'
);

select is(
  (select count(*)::integer from fx, generate_series(1, 120) as g
   where app.zalo_texts(app_u, t0 + interval '1 hour' + g * interval '100 milliseconds') ->> 'status' = 'texts'),
  120,
  '120 texts requests within a minute are answered'
);
select is(
  (select app.zalo_texts(app_u, t0 + interval '1 hour 20 seconds') from fx),
  '{"status": "wait", "retry_after": 41}'::jsonb,
  'the 121st waits until the minute is over and reveals nothing'
);
select is((select app.zalo_texts(app_t, t0 + interval '1 hour 20 seconds') ->> 'status' from fx), 'texts', 'another app of the tenant is not held back');
select is((select app.zalo_texts(app_u, t0 + interval '1 hour 61 seconds') ->> 'status' from fx), 'texts', 'after the minute the texts are answered again');
select is((select requests from app.zalo_texts_requests where zalo_app_id = (select app_u from fx)), 1, 'in a new window');
select is((select app.zalo_texts(app_u, t0) ->> 'status' from fx), 'texts', 'a clock that went back starts a new window');

set local role service_role;
select is((select public.zalo_session_texts(app_t) ->> 'status' from fx), 'texts', 'zalo-session reads the texts at the current time');
reset role;

select is(
  (select app.zalo_member_profile(app_t, owner_t) - 'user_id' - 'tenant_id' from fx),
  (select jsonb_build_object('status', 'bound', 'role', 'owner', 'store_ids', null, 'stores', jsonb_build_array('Synthetic store A', 'Synthetic store Z'), 'brand_store_ids', jsonb_build_array(store_t2, store_t1)) from fx),
  'an owner sees the brand''s stores by name and by id, in the same order'
);
select is(
  (select app.zalo_member_profile(app_t, limited_t) -> 'brand_store_ids' from fx),
  (select jsonb_build_array(store_t2) from fx),
  'a store-limited member gets only the brand''s stores in their scope'
);
select is(
  (select array_agg(c.user_id order by c.user_id)
   from (
     select
       m.user_id,
       coalesce((
         select array_agg(s.id order by s.name, s.id)
         from public.stores s
         join public.brands b on s.id = any (b.store_ids)
         where b.id = fx.brand_t and (m.store_ids is null or s.id = any (m.store_ids))
       ), '{}') as expected,
       coalesce((
         select array_agg(e.v::uuid order by e.n)
         from jsonb_array_elements_text(app.zalo_member_profile(fx.app_t, m.user_id) -> 'brand_store_ids') with ordinality as e (v, n)
       ), '{}') as ids,
       coalesce((
         select array_agg(e.v order by e.n)
         from jsonb_array_elements_text(app.zalo_member_profile(fx.app_t, m.user_id) -> 'stores') with ordinality as e (v, n)
       ), '{}') as names,
       coalesce((
         select array_agg(s.name order by e.n)
         from jsonb_array_elements_text(app.zalo_member_profile(fx.app_t, m.user_id) -> 'brand_store_ids') with ordinality as e (v, n)
         join public.stores s on s.id = e.v::uuid
       ), '{}') as names_of_ids
     from public.tenant_members m, fx
     where m.tenant_id = fx.tenant_t
   ) as c
   where c.ids = c.expected and c.names_of_ids = c.names),
  (select array_agg(u order by u) from fx, unnest(array[owner_t, owner_t1, manager_t, staff_t, viewer_t, limited_t]) as u),
  'for every member brand_store_ids holds exactly the brand''s stores in scope, each id at the place of its name in stores'
);
select is(
  (select app.zalo_sign_in(app_t, 'texts-zalo-limited') -> 'brand_store_ids' from fx),
  (select jsonb_build_array(store_t2) from fx),
  'the bound sign-in answer carries the ids'
);

set local role authenticated;
select pg_temp.act_as((select staff_t from fx));
select ok(not ((select public.my_staff_notice(tenant_t) from fx) ? 'phone_hint'), 'before linking, my_staff_notice names no phone');
select is((select public.link_my_phone(tenant_t, '+84' || '900000789') from fx), '…789', 'the person links a phone');
select is((select public.my_staff_notice(tenant_t) ->> 'phone_hint' from fx), '…789', 'and my_staff_notice shows its hint when Cá nhân opens');
select is((select public.my_staff_notice(tenant_t) - 'notice' - 'phone_hint' from fx), '{"consent": "missing"}'::jsonb, 'next to the consent state as before');
select is((select public.link_my_phone(tenant_t, null) from fx), null, 'the person removes the phone');
select ok(not ((select public.my_staff_notice(tenant_t) from fx) ? 'phone_hint'), 'and the hint is gone');
select pg_temp.act_as((select manager_t from fx));
select ok(not ((select public.my_staff_notice(tenant_t) from fx) ? 'phone_hint'), 'a member who is not on the roster gets no hint');
reset role;

select * from finish();
rollback;
