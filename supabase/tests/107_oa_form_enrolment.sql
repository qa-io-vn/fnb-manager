begin;
select plan(35);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010701'::uuid as tenant_e,
  'dddddddd-dddd-4ddd-8ddd-000000010702'::uuid as tenant_n,
  'cccccccc-cccc-4ccc-8ccc-000000010701'::uuid as account_e,
  'cccccccc-cccc-4ccc-8ccc-000000010702'::uuid as account_n,
  'ffffffff-ffff-4fff-8fff-000000010701'::uuid as store_e,
  'ffffffff-ffff-4fff-8fff-000000010702'::uuid as store_n,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010701'::uuid as brand_e,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010702'::uuid as brand_n,
  '77777777-7777-4777-8777-000000010701'::uuid as oa_e,
  '77777777-7777-4777-8777-000000010702'::uuid as oa_n,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000010701'::uuid as programme_e,
  timestamptz '2026-11-19 10:00+07' as t0;

insert into public.tenants (id, slug, name)
select tenant_e, 'oa-enrol-pgtap', 'OA enrolment pgTAP' from fx
union all
select tenant_n, 'oa-enrol-none-pgtap', 'OA enrolment without programme pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_e, tenant_e, 'mock', 'oa-enrol', 'Synthetic account' from fx
union all
select account_n, tenant_n, 'mock', 'oa-enrol-none', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_e, tenant_e, account_e, 'oae-ext-1', 'Synthetic store' from fx
union all
select store_n, tenant_n, account_n, 'oae-ext-9', 'Synthetic store' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_e, tenant_e, 'brand-1', 'Synthetic brand', array[store_e] from fx
union all
select brand_n, tenant_n, 'brand-1', 'Synthetic brand', array[store_n] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_e, tenant_e, brand_e, 'synthetic-oa-107-1', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_n, tenant_n, brand_n, 'synthetic-oa-107-9', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_e, oa_e,
  '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}]',
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên; bật nhận tin trong ứng dụng nếu muốn.', 'Bạn đã là thành viên rồi.',
  'Tham gia thành viên', 'Chia sẻ tên và số điện thoại để tích dấu.', 'https://example.com/brand-logo.png'
from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select programme_e, tenant_e, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 2 from fx;
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_e, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-107-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, timestamptz '2026-11-01 00:00+07' from fx
union all
select tenant_n, 'privacy_notice', 'vi', 'privacy-107-9', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', timestamptz '2026-11-01 00:00+07' from fx;
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_e, '0900010790' from fx;
insert into public.customers (tenant_id, phone, name) select tenant_e, '0900010702', 'Tên từ quầy' from fx;
with c as (
  insert into public.customers (tenant_id, phone, name) select tenant_e, '+84' || '900010703', 'Khách ứng dụng' from fx returning id, tenant_id
)
insert into public.memberships (tenant_id, programme_id, customer_id, channel, brand_id, zalo_user_id)
select c.tenant_id, fx.programme_e, c.id, 'mini_app', fx.brand_e, 'app-user-107' from c, fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
select c.tenant_id, 'customer', c.id, 'loyalty', 'privacy-107-1', 'mini_app', timestamptz '2026-11-10 10:00+07', '{"channel": "mini_app"}'
from public.customers c where c.phone = '+84' || '900010703';

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

create function pg_temp.submit(p_user text, p_phone text, p_name text, p_at timestamptz, p_oa uuid default null, p_signature text default 'raw')
returns jsonb
language plpgsql
as $$
declare
  v_event uuid := pg_temp.event(coalesce(p_oa, (select oa_e from fx)), 'user_submit_info', p_user, p_at, p_signature);
begin
  perform app.apply_oa_event(v_event, p_at + interval '2 seconds');
  return app.oa_customer_step(v_event, jsonb_build_object('kind', 'form', 'phone', p_phone, 'name', p_name), p_at + interval '2 seconds');
end;
$$;

create function pg_temp.counts(p_tenant uuid)
returns text
language sql
as $$
  select concat_ws(':',
    (select count(*) from public.customers where tenant_id = p_tenant),
    (select count(*) from public.memberships where tenant_id = p_tenant),
    (select count(*) from public.consent_records where tenant_id = p_tenant and purpose = 'loyalty'),
    (select count(*) from public.consent_records where tenant_id = p_tenant and purpose = 'marketing'),
    (select count(*) from app.customer_oa_contacts where tenant_id = p_tenant),
    (select count(*) from public.loyalty_ledger where tenant_id = p_tenant));
$$;

create temp table baseline as select pg_temp.counts(tenant_e) as counts from fx;
create temp table answers (name text primary key, answer jsonb);

insert into answers
select 'first', app.oa_form_enrol(pg_temp.event(oa_e, 'user_submit_info', 'oa-user-107-a', t0), '0900010701', 'Khách Thử', t0 + interval '2 seconds') from fx;

select is(
  (select concat_ws(':', answer ->> 'status', answer ->> 'already_member', answer ->> 'consent_created', answer ->> 'link') from answers where name = 'first'),
  'joined:false:true:linked',
  'a form answer enrols the customer, records the consent and ties the OA user'
);
select is(
  (select pg_temp.counts(tenant_e) from fx),
  (select concat_ws(':', split_part(counts, ':', 1)::integer + 1, split_part(counts, ':', 2)::integer + 1, split_part(counts, ':', 3)::integer + 1, split_part(counts, ':', 4), split_part(counts, ':', 5)::integer + 1, split_part(counts, ':', 6)::integer + 1) from baseline),
  'exactly one customer, membership, loyalty consent, OA tie and welcome entry, and no marketing consent'
);
select is(
  (select concat_ws(':', c.phone, c.name) from public.customers c where c.id = (select (answer ->> 'customer_id')::uuid from answers where name = 'first')),
  '+84' || '900010701:Khách Thử',
  'the customer holds the phone in E.164 form and the name of the form'
);
select is(
  (select concat_ws(':', m.channel, m.brand_id = (select brand_e from fx), coalesce(m.zalo_user_id, 'none'), m.joined_store_id is null, m.programme_id = (select programme_e from fx))
   from public.memberships m where m.id = (select (answer ->> 'membership_id')::uuid from answers where name = 'first')),
  'oa_form:t:none:t:t',
  'the membership joined through oa_form under the OA''s brand, without a Mini App user id'
);
select is(
  (select coalesce(sum(l.stamp_delta), 0)::integer from public.loyalty_ledger l where l.membership_id = (select (answer ->> 'membership_id')::uuid from answers where name = 'first') and l.reason = 'welcome'),
  2,
  'the first join credits the welcome stamps'
);
select is(
  (select concat_ws(':', c.channel, c.policy_version, c.evidence ->> 'channel', c.evidence ->> 'marketing', c.evidence ->> 'phone_source', c.evidence -> 'shared_fields', c.evidence ->> 'form_title', c.evidence ->> 'event_id' = e.event_id)
   from public.consent_records c
   join public.oa_events e on e.oa_user_id = 'oa-user-107-a'
   where c.id = (select (answer ->> 'consent_record_id')::uuid from answers where name = 'first')),
  'oa_form:privacy-107-1:oa_form:not_asked:user_submitted:["name", "phone"]:Tham gia thành viên:t',
  'the loyalty consent carries the form as evidence under the published privacy notice'
);
select is(
  (select c.evidence::text ~ '900010701|Khách Thử' from public.consent_records c where c.id = (select (answer ->> 'consent_record_id')::uuid from answers where name = 'first')),
  false,
  'the evidence repeats neither the phone nor the name'
);
select is(
  (select count(*)::integer from app.customer_oa_contacts k where k.oa_id = (select oa_e from fx) and k.oa_user_id = 'oa-user-107-a' and k.customer_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'first')),
  1,
  'the OA user is tied to the customer on this OA for the outbox'
);
select is(
  (select concat_ws(':', u.customer_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'first'), u.enrolled_at is not null) from public.oa_users u where u.oa_user_id = 'oa-user-107-a'),
  't:t',
  'and recorded as enrolled as that customer'
);

create temp table after_first as select pg_temp.counts(tenant_e) as counts from fx;
select is(
  (select outcome from app.receive_oa_event(
    (select oa_e from fx), (select event_id from public.oa_events where oa_user_id = 'oa-user-107-a' and event_name = 'user_submit_info'),
    'user_submit_info', 'oa-user-107-a', (select t0 from fx), 'raw', (select t0 + interval '1 minute' from fx))),
  'duplicate',
  'a replay of the same event is a duplicate'
);
select is(
  (select pg_temp.counts(tenant_e) from fx),
  (select counts from after_first),
  'and creates nothing'
);
select is(
  (select pg_temp.submit('oa-user-107-a', '+84 900 010 701', 'Tên khác', t0 + interval '10 minutes') ->> 'step' from fx),
  'joined_quiet',
  'a second submission of the same phone enrols again, quietly outside the window'
);
select is(
  (select pg_temp.counts(tenant_e) from fx),
  (select counts from after_first),
  'and links to the same customer without a new row of any kind'
);
select is(
  (select name from public.customers where phone = '+84' || '900010701'),
  'Khách Thử',
  'the customer keeps its name'
);
select is(
  (select pg_temp.submit('oa-user-107-b', '0900010701', 'Người khác', t0 + interval '11 minutes') ->> 'step' from fx),
  'refused_phone_in_use',
  'another OA user cannot claim a phone tied to an OA user of this OA'
);
select is(
  (select pg_temp.counts(tenant_e) from fx),
  (select counts from after_first),
  'the refusal creates nothing'
);

insert into answers
select 'till', app.oa_form_enrol(pg_temp.event(oa_e, 'user_submit_info', 'oa-user-107-c', t0 + interval '20 minutes'), '0900010702', 'Tên trong form', t0 + interval '21 minutes') from fx;
select is(
  (select concat_ws(':', a.answer ->> 'status', a.answer ->> 'already_member', c.phone, c.name)
   from answers a join public.customers c on c.id = (a.answer ->> 'customer_id')::uuid where a.name = 'till'),
  'joined:false:0900010702:Tên từ quầy',
  'a customer the till recorded is found by its phone, keeps its name and joins'
);
select is(
  (select count(*)::integer from public.customers where tenant_id = (select tenant_e from fx) and app.loyalty_normalize_phone(phone) = '+84' || '900010702'),
  1,
  'without a second customer for the same phone'
);

insert into answers
select 'app', app.oa_form_enrol(pg_temp.event(oa_e, 'user_submit_info', 'oa-user-107-d', t0 + interval '30 minutes'), '0900010703', null, t0 + interval '31 minutes') from fx;
select is(
  (select concat_ws(':', answer ->> 'status', answer ->> 'already_member', answer ->> 'consent_created') from answers where name = 'app'),
  'joined:true:false',
  'a Mini App member is already a member and keeps the consent of the same policy version'
);
select is(
  (select concat_ws(':', m.channel, m.zalo_user_id) from public.memberships m where m.id = (select (answer ->> 'membership_id')::uuid from answers where name = 'app')),
  'mini_app:app-user-107',
  'the Mini App membership keeps its channel and its Zalo user id'
);
select is(
  (select count(*)::integer from public.consent_records c where c.subject_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'app') and c.channel = 'oa_form'),
  0,
  'no OA-form consent is added on top of the active one'
);

insert into answers
select 'staff', app.oa_form_enrol(pg_temp.event(oa_e, 'user_submit_info', 'oa-user-107-e', t0 + interval '40 minutes'), '0900010790', null, t0 + interval '41 minutes') from fx;
select is(
  (select concat_ws(':', a.answer ->> 'status', (select count(*) from public.loyalty_ledger l where l.membership_id = (a.answer ->> 'membership_id')::uuid))
   from answers a where a.name = 'staff'),
  'joined:0',
  'a staff phone joins without welcome stamps'
);

create temp table before_refusals as select pg_temp.counts(tenant_e) as counts from fx;
select is(
  (select pg_temp.submit('oa-user-107-f', 'không có số', 'Khách', t0 + interval '50 minutes') ->> 'step' from fx),
  'refused_phone_invalid',
  'an unreadable phone is refused'
);
select is(
  (select pg_temp.submit('oa-user-107-f', null, 'Khách', t0 + interval '51 minutes') ->> 'step' from fx),
  'refused_phone_invalid',
  'so is a form without a phone'
);
select is(
  (select pg_temp.submit('oa-user-107-g', '0900010704', 'Khách', t0 + interval '52 minutes', null, 'mismatch') ->> 'step' from fx),
  'unverified',
  'an unverified form answer enrols nobody'
);
select is(
  (select app.oa_form_enrol((select id from public.oa_events where oa_user_id = 'oa-user-107-g'), '0900010704', null, t0 + interval '53 minutes') ->> 'reason' from fx),
  'unverified',
  'even when the enrolment is called directly'
);
select is(
  (select pg_temp.counts(tenant_e) from fx),
  (select counts from before_refusals),
  'refusals create nothing'
);
select is(
  (select pg_temp.submit('oa-user-107-h', '0900010705', 'Khách', t0, oa_n) ->> 'step' from fx),
  'refused_no_programme',
  'a tenant without an active programme enrols nobody'
);
update public.legal_documents set status = 'retired', retired_at = (select t0 from fx) where tenant_id = (select tenant_e from fx);
select is(
  (select pg_temp.submit('oa-user-107-i', '0900010706', 'Khách', t0 + interval '1 hour') ->> 'step' from fx),
  'refused_policy_missing',
  'nor a tenant without a published privacy notice'
);
insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
select tenant_e, 'privacy_notice'::public.legal_document_kind, 'vi', 'privacy-107-2', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published'::public.legal_document_status, t0 + interval '1 hour' from fx;
select is(
  (select pg_temp.counts(tenant_n) from fx) || '/' || (select pg_temp.counts(tenant_e) from fx),
  '0:0:0:0:0:0/' || (select counts from before_refusals),
  'neither refusal creates anything'
);

select is(
  (select app.oa_customer_step(pg_temp.event(oa_e, 'user_send_text', 'oa-user-107-j', t0 + interval '2 hours'), '{"kind": "keyword", "action": "join"}', t0 + interval '2 hours 1 second') ->> 'step' from fx),
  'form',
  'the join keyword inside the window sends the form'
);
insert into answers
select 'window', pg_temp.submit('oa-user-107-j', '0900010707', 'Khách Mới', t0 + interval '2 hours 1 minute') from fx;
select is(
  (select concat_ws(':', answer ->> 'step', answer #>> '{reply,kind}', answer #>> '{reply,text}', answer ->> 'customer_id' is not null) from answers where name = 'window'),
  'joined:joined:Bạn đã là thành viên; bật nhận tin trong ứng dụng nếu muốn.:t',
  'a form answer inside the window is answered with the joined text, which explains the opt-in'
);
select is(
  (select c.evidence ->> 'form_sent_at' is not null from public.consent_records c where c.subject_id = (select (answer ->> 'customer_id')::uuid from answers where name = 'window')),
  true,
  'the evidence says when the form was sent'
);
select is(
  (select count(*)::integer from public.consent_records where purpose = 'marketing' and tenant_id = (select tenant_e from fx)),
  0,
  'no OA enrolment ever records a marketing consent'
);
select ok(
  not has_function_privilege('authenticated', 'app.oa_form_enrol(uuid, text, text, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.oa_form_enrol(uuid, text, text, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.oa_customer_step(uuid, jsonb, timestamptz)', 'execute'),
  'the enrolment runs only from the webhook''s database connection'
);

select * from finish();
rollback;
