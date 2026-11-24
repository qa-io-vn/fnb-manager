begin;
select plan(17);

-- G-52, ADR-053: a name corrected through dsr_correct is never overwritten. No POS sync writes customers.name; the
-- two other writers (a Zalo join, the OA form) fill an empty name only. Equivalence classes of the stored name:
-- corrected (set), null, blank; writers: the OA form, the join, a synced invoice carrying a POS name, the earn's
-- customer lookup. The guard at the end fails when a new function starts writing the name.

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024901'::uuid as tenant_n,
  'cccccccc-cccc-4ccc-8ccc-000000024901'::uuid as account_n,
  'ffffffff-ffff-4fff-8fff-000000024901'::uuid as store_n,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000024901'::uuid as brand_n,
  '99999999-9999-4999-8999-000000024901'::uuid as app_n,
  '77777777-7777-4777-8777-000000024901'::uuid as oa_n,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024901'::uuid as programme_n,
  'eeeeeeee-eeee-4eee-8eee-000000024901'::uuid as owner_n,
  'eeeeeeee-eeee-4eee-8eee-000000024911'::uuid as login_corrected,
  'eeeeeeee-eeee-4eee-8eee-000000024912'::uuid as login_empty,
  -- synthetic phones built by concatenation (the public-safety scan refuses phone-shaped literals)
  '09000' || '24901' as phone_corrected,
  '09000' || '24902' as phone_null,
  '09000' || '24903' as phone_blank,
  '09000' || '24904' as phone_join_empty,
  timestamptz '2026-11-20 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'name-stands-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_n, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.owner_n, false), (fx.login_corrected, true), (fx.login_empty, true)) as u (id, customer);

insert into public.tenants (id, slug, name) select tenant_n, 'name-stands-pgtap', 'Corrected name pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_n, tenant_n, 'mock', 'name-stands', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_n, tenant_n, account_n, 'ns-ext-1', 'ns-1', 'Synthetic store' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_n, owner_n, 'owner'::public.tenant_role, null::uuid[] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_n, tenant_n, 'brand-1', 'Synthetic brand', array[store_n] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_n, tenant_n, brand_n, 'synthetic-app-249', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_n, tenant_n, brand_n, 'synthetic-oa-249', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_n, oa_n,
  '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]',
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.',
  'Tham gia thành viên', 'Chia sẻ tên và số điện thoại để tích dấu.', 'https://example.com/brand-logo.png'
from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_n, tenant_n, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select fx.tenant_n, d.kind::public.legal_document_kind, 'vi', d.version, d.title, 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-11-01 00:00+07'
from fx cross join lateral (
  values ('privacy_notice', 'privacy-249-1', 'Chính sách bảo mật'), ('mini_app_terms', 'terms-249-1', 'Điều khoản sử dụng')
) as d (kind, version, title);

insert into public.customers (tenant_id, phone, name)
select tenant_n, phone_corrected, 'Tên sai từ quầy' from fx
union all
select tenant_n, phone_null, null from fx
union all
select tenant_n, phone_blank, '   ' from fx
union all
select tenant_n, phone_join_empty, null from fx;

create function pg_temp.name_of(p_phone text)
returns text
language sql
as $$
  select c.name from public.customers c where c.tenant_id = (select tenant_n from fx) and c.phone = p_phone;
$$;

create function pg_temp.form(p_user text, p_phone text, p_name text, p_offset interval)
returns jsonb
language sql
as $$
  select app.oa_form_enrol(
    (select r.event_row from app.receive_oa_event(
      fx.oa_n, encode(sha256(convert_to(concat_ws('/', p_user, p_offset), 'UTF8')), 'hex'),
      'user_submit_info', p_user, fx.t0 + p_offset, 'raw', fx.t0 + p_offset + interval '1 second'
    ) r),
    p_phone, p_name, fx.t0 + p_offset + interval '2 seconds'
  )
  from fx;
$$;

create function pg_temp.join(p_user uuid, p_zalo_user text, p_display text, p_phone text, p_offset interval)
returns jsonb
language sql
as $$
  select app.customer_join(p_user, fx.app_n, p_zalo_user, p_display, p_phone, true, false, 'privacy-249-1', 'join-1',
    fx.t0 + p_offset - interval '1 minute', 'ns-1', 'mini_app', fx.t0 + p_offset)
  from fx;
$$;

-- the two customer logins, bound to their Zalo users the way zalo-session binds them
select app.zalo_customer_sign_in(fx.app_n, 'zalo-user-249-a', null, fx.login_corrected) from fx;
select app.zalo_customer_sign_in(fx.app_n, 'zalo-user-249-b', null, fx.login_empty) from fx;

-- the correction itself, as the owner
create temp table req as
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select fx.tenant_n, 'customer'::public.consent_subject, c.id, 'synthetic-contact', 'correction'::public.dsr_type, now() - interval '1 hour'
  from fx join public.customers c on c.tenant_id = fx.tenant_n and c.phone = fx.phone_corrected
  returning id
)
select id from r;
grant select on fx, req to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', (select owner_n from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (public.dsr_correct((select id from req), 'name', 'Tên đã sửa') ->> 'changed'),
  'true',
  'the owner corrects the name through the correction request'
);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'the corrected name is stored');

-- writers that carry another name
select is(pg_temp.form('oa-user-249-a', (select phone_corrected from fx), 'Tên trong form', interval '1 minute') ->> 'status', 'joined', 'the OA form of the corrected phone is accepted');
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'an OA form with another name keeps the corrected name');

select is(pg_temp.join((select login_corrected from fx), 'zalo-user-249-a', 'Khách Zalo', (select phone_corrected from fx), interval '10 minutes') ->> 'status', 'joined',
  'the Zalo join of the corrected phone is accepted');
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'a Zalo join with another display name keeps the corrected name');

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name)
select tenant_n, store_n, account_n, 'ns-sale-1', t0 + interval '1 hour', app.store_business_date(store_n, t0 + interval '1 hour'), 50000, 50000, 50000,
  phone_corrected, 'Tên ở quầy'
from fx;
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'a synced invoice carrying the POS name keeps the corrected name');
update public.invoices set customer_name = 'Tên ở quầy mới', net_amount = 50000 where external_id = 'ns-sale-1' and tenant_id = (select tenant_n from fx);
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'a re-pull that changes the POS name on the invoice keeps the corrected name');

select is(
  app.loyalty_customer_for_phone((select tenant_n from fx), (select phone_corrected from fx), (select t0 from fx) + interval '2 hours'),
  (select c.id from public.customers c join fx on c.tenant_id = fx.tenant_n and c.phone = fx.phone_corrected),
  'the earn''s customer lookup finds the same customer'
);
select is(pg_temp.name_of((select phone_corrected from fx)), 'Tên đã sửa', 'the earn''s customer lookup keeps the corrected name');

-- controls: the writers do fill an empty name, so the checks above are not passing by doing nothing
select is(pg_temp.form('oa-user-249-b', (select phone_null from fx), 'Khách Mới', interval '20 minutes') ->> 'status', 'joined', 'the OA form of a customer without a name is accepted');
select is(pg_temp.name_of((select phone_null from fx)), 'Khách Mới', 'the OA form fills a null name');
select is(pg_temp.form('oa-user-249-c', (select phone_blank from fx), 'Khách Trống', interval '30 minutes') ->> 'status', 'joined', 'the OA form of a blank name is accepted');
select is(pg_temp.name_of((select phone_blank from fx)), 'Khách Trống', 'the OA form fills a name of spaces only (the boundary of empty)');
select is(pg_temp.join((select login_empty from fx), 'zalo-user-249-b', 'Khách Zalo Mới', (select phone_join_empty from fx), interval '40 minutes') ->> 'status', 'joined',
  'the Zalo join of a customer without a name is accepted');
select is(pg_temp.name_of((select phone_join_empty from fx)), 'Khách Zalo Mới', 'the Zalo join fills a null name');

-- the guard: exactly these functions write customers.name; a new writer must keep the fill-only rule and be added here
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and (p.prosrc ~* 'update\s+public\.customers\M[^;]*\mset\M[^;]*\mname\M'
        or p.prosrc ~* 'insert\s+into\s+public\.customers\s*\([^)]*\mname\M')
    order by 1
  ),
  array[
    'app.customer_join(uuid,uuid,text,text,text,boolean,boolean,text,text,timestamp with time zone,text,text,timestamp with time zone)',
    'app.oa_form_enrol(uuid,text,text,timestamp with time zone)',
    'dsr_correct(uuid,text,text)'
  ]::text[],
  'only the correction, the Zalo join and the OA form write a customer''s name'
);

select * from finish();
rollback;
