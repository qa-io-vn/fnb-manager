begin;
select plan(19);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010801'::uuid as tenant_s,
  'cccccccc-cccc-4ccc-8ccc-000000010801'::uuid as account_s,
  'ffffffff-ffff-4fff-8fff-000000010801'::uuid as store_1,
  'ffffffff-ffff-4fff-8fff-000000010802'::uuid as store_2,
  'ffffffff-ffff-4fff-8fff-000000010803'::uuid as store_3,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010801'::uuid as brand_1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010802'::uuid as brand_2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010803'::uuid as brand_3,
  '77777777-7777-4777-8777-000000010801'::uuid as oa_form,
  '77777777-7777-4777-8777-000000010802'::uuid as oa_link,
  '77777777-7777-4777-8777-000000010803'::uuid as oa_bare,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000010801'::uuid as programme_s,
  timestamptz '2026-11-19 11:00+07' as t0;

insert into public.tenants (id, slug, name) select tenant_s, 'oa-step-pgtap', 'OA step pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_s, tenant_s, 'mock', 'oa-step', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select s.id, fx.tenant_s, fx.account_s, s.ext, 'Synthetic store'
from fx cross join lateral (values (fx.store_1, 'oas-ext-1'), (fx.store_2, 'oas-ext-2'), (fx.store_3, 'oas-ext-3')) as s (id, ext);
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select b.id, fx.tenant_s, b.key, 'Synthetic brand', array[b.store]
from fx cross join lateral (values (fx.brand_1, 'brand-1', fx.store_1), (fx.brand_2, 'brand-2', fx.store_2), (fx.brand_3, 'brand-3', fx.store_3)) as b (id, key, store);
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select o.id, fx.tenant_s, o.brand, o.ext, 'tang_truong', o.secret
from fx cross join lateral (
  values (fx.oa_form, fx.brand_1, 'synthetic-oa-108-1', 'ZALO_OA_SECRET_BRAND_1'),
         (fx.oa_link, fx.brand_2, 'synthetic-oa-108-2', 'ZALO_OA_SECRET_BRAND_2'),
         (fx.oa_bare, fx.brand_3, 'synthetic-oa-108-3', 'ZALO_OA_SECRET_BRAND_3')
) as o (id, brand, ext, secret);
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_s, oa_form,
  '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}, {"action": "vouchers", "label": "Voucher", "target": "mini_app"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx
union all
select tenant_s, oa_link,
  '[{"action": "join", "label": "Tham gia thành viên", "target": "mini_app"}]'::jsonb,
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia thành viên', 'Chia sẻ tên và số điện thoại.', null
from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_s, tenant_s, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_s, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-108-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-11-01 00:00+07' from fx;

create function pg_temp.event(p_oa uuid, p_name text, p_user text, p_at timestamptz, p_signature text default 'raw')
returns uuid
language sql
as $$
  select r.event_row
  from app.receive_oa_event(
    p_oa, encode(sha256(convert_to(concat_ws('/', p_oa, p_name, p_user, p_at, p_signature), 'UTF8')), 'hex'),
    p_name, p_user, p_at, p_signature, p_at + interval '1 second'
  ) r;
$$;

create function pg_temp.tap(p_user text, p_at timestamptz, p_now timestamptz default null, p_oa uuid default null, p_signature text default 'raw')
returns jsonb
language plpgsql
as $$
declare
  v_event uuid := pg_temp.event(coalesce(p_oa, (select oa_form from fx)), 'user_send_text', p_user, p_at, p_signature);
begin
  perform app.apply_oa_event(v_event, coalesce(p_now, p_at + interval '1 second'));
  return app.oa_customer_step(v_event, '{"kind": "keyword", "action": "join"}', coalesce(p_now, p_at + interval '1 second'));
end;
$$;

create function pg_temp.submit(p_user text, p_phone text, p_at timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_event uuid := pg_temp.event((select oa_form from fx), 'user_submit_info', p_user, p_at);
begin
  perform app.apply_oa_event(v_event, p_at + interval '1 second');
  return app.oa_customer_step(v_event, jsonb_build_object('kind', 'form', 'phone', p_phone, 'name', null), p_at + interval '1 second');
end;
$$;

create temp table answers (name text primary key, answer jsonb);
insert into answers select 'form', pg_temp.tap('oa-user-108-a', t0) from fx;

select is(
  (select concat_ws(':', answer ->> 'step', answer #>> '{reply,kind}', answer #>> '{reply,title}', answer #>> '{reply,subtitle}', answer #>> '{reply,image_url}') from answers where name = 'form'),
  'form:form:Tham gia thành viên:Chia sẻ tên và số điện thoại.:https://example.com/brand-logo.png',
  'the join keyword inside the window answers Zalo''s request_user_info form'
);
select is(
  (select concat_ws(':', jsonb_array_length(answer #> '{reply,buttons}'), coalesce(answer #>> '{reply,mini_app_id}', 'none')) from answers where name = 'form'),
  '2:none',
  'with the menu buttons and no Mini App when the brand has none'
);
select is(
  (select form_sent_at = (select t0 + interval '1 second' from fx) from public.oa_users where oa_user_id = 'oa-user-108-a'),
  true,
  'the form is claimed'
);
select is(
  (select pg_temp.tap('oa-user-108-a', t0 + interval '30 seconds') ->> 'step' from fx),
  'form_recent',
  'a second tap within two minutes sends no second form'
);
select is(
  (select pg_temp.tap('oa-user-108-a', t0 + interval '3 minutes') ->> 'step' from fx),
  'form',
  'a later tap sends the form again'
);
select is(
  (select pg_temp.submit('oa-user-108-a', '0900010801', t0 + interval '4 minutes') ->> 'step' from fx),
  'joined',
  'the answer inside the window is confirmed'
);
insert into answers select 'member', pg_temp.tap('oa-user-108-a', t0 + interval '10 minutes') from fx;
select is(
  (select concat_ws(':', answer ->> 'step', answer #>> '{reply,kind}', answer #>> '{reply,text}', answer ->> 'customer_id' is not null) from answers where name = 'member'),
  'member:member:Bạn đã là thành viên rồi.:t',
  'an OA user enrolled as a member gets the member text instead of the form'
);
select is(
  (select pg_temp.tap('oa-user-108-b', t0, t0 + interval '49 hours') ->> 'step' from fx),
  'outside_window',
  'a keyword handled more than 48 hours after its message is outside the window'
);
select is(
  (select pg_temp.tap('oa-user-108-c', t0, null, null, 'mismatch') ->> 'step' from fx),
  'unverified',
  'an unverified tap sends nothing'
);
select is(
  (select count(*)::integer from public.oa_users where oa_user_id = 'oa-user-108-c'),
  0,
  'and records no OA user'
);
select is(
  (select pg_temp.tap('oa-user-108-d', t0, null, oa_link) ->> 'step' from fx),
  'no_form',
  'a menu whose join opens the Mini App sends no form'
);
select is(
  (select pg_temp.tap('oa-user-108-e', t0, null, oa_bare) ->> 'step' from fx),
  'no_menu',
  'an OA without a menu answers nothing'
);
select is(
  (select pg_temp.submit('oa-user-108-f', '0900010806', t0) ->> 'step' from fx),
  'joined_quiet',
  'an answer without a message in the window enrols without a reply'
);
select is(
  (select pg_temp.submit('oa-user-108-a', '0900010807', t0 + interval '20 minutes') ->> 'step' from fx),
  'joined',
  'an OA user who submits another phone enrols that phone'
);
select is(
  (select c.phone from public.oa_users u join public.customers c on c.id = u.customer_id where u.oa_user_id = 'oa-user-108-a'),
  '+84' || '900010807',
  'and the OA user moves to that customer'
);
select is(
  (select concat_ws(':', (select count(*) from app.customer_oa_contacts where oa_user_id = 'oa-user-108-a'), c.phone)
   from app.customer_oa_contacts k join public.customers c on c.id = k.customer_id where k.oa_user_id = 'oa-user-108-a'),
  '1:+84' || '900010807',
  'so does the outbox tie'
);
select is(
  (select app.oa_customer_step('00000000-0000-4000-8000-000000000000', '{"kind": "none"}', t0) ->> 'step' from fx),
  'unknown_event',
  'an unknown event row has no step'
);
select throws_ok(
  $$ select app.oa_customer_step((select id from public.oa_events limit 1), '{"kind": "none"}', null) $$,
  '22023',
  null,
  'the step needs an instant'
);
select is(
  (select count(*)::integer from public.oa_events e where e.tenant_id = (select tenant_s from fx) and e.customer_step is null),
  0,
  'every event of the tenant carries its step outcome'
);

select * from finish();
rollback;
