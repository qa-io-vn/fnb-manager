begin;
select plan(12);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010901'::uuid as tenant_p,
  'cccccccc-cccc-4ccc-8ccc-000000010901'::uuid as account_p,
  'ffffffff-ffff-4fff-8fff-000000010901'::uuid as store_p,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010901'::uuid as brand_p,
  '77777777-7777-4777-8777-000000010901'::uuid as oa_p,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000010901'::uuid as programme_p,
  'eeeeeeee-eeee-4eee-8eee-000000010901'::uuid as owner_p,
  timestamptz '2026-11-19 12:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select owner_p, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'oa-privacy-owner@example.com' from fx;
insert into public.tenants (id, slug, name) select tenant_p, 'oa-privacy-pgtap', 'OA privacy pgTAP' from fx;
insert into public.tenant_members (tenant_id, user_id, role) select tenant_p, owner_p, 'owner' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_p, tenant_p, 'mock', 'oa-privacy', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_p, tenant_p, account_p, 'oap-ext-1', 'Synthetic store' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_p, tenant_p, 'brand-1', 'Synthetic brand', array[store_p] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_p, tenant_p, brand_p, 'synthetic-oa-109-1', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_p, oa_p, '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_p, tenant_p, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 1 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_p, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-109-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-11-01 00:00+07' from fx;

create function pg_temp.event(p_name text, p_user text, p_at timestamptz)
returns uuid
language sql
as $$
  select r.event_row
  from app.receive_oa_event(
    (select oa_p from fx), encode(sha256(convert_to(concat_ws('/', p_name, p_user, p_at), 'UTF8')), 'hex'),
    p_name, p_user, p_at, 'raw', p_at + interval '1 second'
  ) r;
$$;

create function pg_temp.run(p_event uuid, p_input jsonb, p_at timestamptz)
returns jsonb
language plpgsql
as $$
begin
  perform app.apply_oa_event(p_event, p_at);
  return app.oa_customer_step(p_event, p_input, p_at);
end;
$$;

create temp table answers (name text primary key, answer jsonb);
insert into answers select 'follow_x', pg_temp.run(pg_temp.event('follow', 'oa-user-109-x', t0), '{"kind": "none"}', t0 + interval '1 second') from fx;
insert into answers select 'tap_x', pg_temp.run(pg_temp.event('user_send_text', 'oa-user-109-x', t0 + interval '1 minute'), '{"kind": "keyword", "action": "join"}', t0 + interval '61 seconds') from fx;
insert into answers select 'form_x', pg_temp.run(pg_temp.event('user_submit_info', 'oa-user-109-x', t0 + interval '2 minutes'), '{"kind": "form", "phone": "0900010901", "name": "Khách Riêng"}', t0 + interval '121 seconds') from fx;
insert into answers select 'form_y', pg_temp.run(pg_temp.event('user_submit_info', 'oa-user-109-y', t0 + interval '3 minutes'), '{"kind": "form", "phone": "0900010902", "name": null}', t0 + interval '181 seconds') from fx;
create temp table logged as
select app.record_oa_reply((a.answer ->> 'oa_user_row')::uuid, (a.answer ->> 'customer_id')::uuid, 'joined', 'sent', null, 'mock-oa-message-109', (select t0 + interval '2 minutes' from fx)) as id
from answers a where a.name = 'form_x';

select is(
  (select string_agg(answer ->> 'step', ',' order by name) from answers),
  'welcome,joined,joined_quiet,form',
  'the OA user followed, tapped join, answered the form and a second OA user joined quietly'
);
select is(
  (select concat_ws(':', o.subject_type, o.subject_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'form_x'), o.recipient_ref like 'oa_user:%')
   from logged l join public.outbound_messages o on o.id = l.id),
  'customer:t:t',
  'the joined reply is logged against the customer with an opaque recipient'
);

create temp table request as
with r as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select tenant_p, 'customer', (select (answer ->> 'customer_id')::uuid from answers where name = 'form_x'), 'synthetic-contact', 'deletion', t0 + interval '1 hour' from fx
  returning id
)
select id from r;
select lives_ok(
  $$ select app.dsr_erase_customer((select id from request), (select owner_p from fx), (select t0 + interval '2 hours' from fx)) $$,
  'the customer enrolled through the OA can be erased'
);
select is(
  (select count(*)::integer from public.oa_users where oa_user_id = 'oa-user-109-x'),
  0,
  'the erasure takes the OA user enrolled as the customer along'
);
select is(
  (select count(*)::integer from app.customer_oa_contacts where oa_user_id = 'oa-user-109-x'),
  0,
  'and the outbox tie'
);
select is(
  (select count(*)::integer from public.consent_records where subject_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'form_x')),
  0,
  'and the OA-form consent'
);
select is(
  (select concat_ws(':', o.recipient_ref, coalesce(o.subject_id::text, 'none')) from logged l join public.outbound_messages o on o.id = l.id),
  'redacted:none',
  'the reply log is redacted'
);
select is(
  (select concat_ws(':', count(*), bool_and(customer_id is not null)) from public.oa_users where oa_user_id = 'oa-user-109-y'),
  '1:t',
  'another OA user of the OA is untouched'
);
select is(
  (select count(*)::integer from public.oa_events e where e.oa_id = (select oa_p from fx)),
  4,
  'the event log keeps its ids and times only'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and (p.proname like 'oa\_%' or p.proname in ('track_oa_user', 'set_oa_menu', 'record_oa_menu_applied', 'record_oa_reply', 'apply_oa_event'))
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  array['oa_menu_buttons_valid', 'oa_text_valid'],
  'of the OA functions only the two pure checks are callable by an API role'
);
select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('oa_form_enrol', 'oa_customer_step')
     and (pg_get_function_identity_arguments(p.oid) ~ '(dob|gender|address|city)')),
  0,
  'the enrolment takes no birth date, gender or address'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'oa_form_enrol' and p.prosecdef),
  0,
  'the enrolment is no security definer reachable through the API'
);

select * from finish();
rollback;
