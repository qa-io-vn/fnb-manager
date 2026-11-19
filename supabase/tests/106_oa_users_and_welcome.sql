begin;
select plan(30);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010601'::uuid as tenant_w,
  'cccccccc-cccc-4ccc-8ccc-000000010601'::uuid as account_w,
  'ffffffff-ffff-4fff-8fff-000000010601'::uuid as store_w,
  'ffffffff-ffff-4fff-8fff-000000010602'::uuid as store_q,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010601'::uuid as brand_w,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010602'::uuid as brand_q,
  '77777777-7777-4777-8777-000000010601'::uuid as oa_w,
  '77777777-7777-4777-8777-000000010602'::uuid as oa_q,
  'eeeeeeee-eeee-4eee-8eee-000000010601'::uuid as owner_w,
  timestamptz '2026-11-19 09:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select owner_w, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'oa-welcome-owner@example.com' from fx;
insert into public.tenants (id, slug, name) select tenant_w, 'oa-welcome-pgtap', 'OA welcome pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_w, tenant_w, 'mock', 'oa-welcome', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_w, tenant_w, account_w, 'oaw-ext-1', 'Synthetic store 1' from fx
union all
select store_q, tenant_w, account_w, 'oaw-ext-2', 'Synthetic store 2' from fx;
insert into public.tenant_members (tenant_id, user_id, role) select tenant_w, owner_w, 'owner' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_w, tenant_w, 'brand-1', 'Synthetic brand', array[store_w] from fx
union all
select brand_q, tenant_w, 'brand-2', 'Synthetic quiet brand', array[store_q] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_w, tenant_w, brand_w, 'synthetic-oa-106-1', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_q, tenant_w, brand_q, 'synthetic-oa-106-2', 'co_ban', 'ZALO_OA_SECRET_BRAND_2' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_w, brand_w, 'customer', 'synthetic-mini-106', true, 'Thẻ thành viên', 'Thành viên', 'Members', '#123456', '#000000', 'white', 'white' from fx;
insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
select tenant_w, oa_w,
  '[{"action": "join", "label": "Tham gia thành viên", "target": "query"}, {"action": "points", "label": "Điểm của tôi", "target": "mini_app"}]',
  'Cảm ơn bạn đã quan tâm.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên rồi.', 'Tham gia', 'Chia sẻ tên và số điện thoại.', 'https://example.com/brand-logo.png'
from fx;
insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token, refresh_expires_at)
select tenant_w, brand_w, 'oa', 'synthetic-oa-access-106', t0 + interval '20 hours', 'synthetic-oa-refresh-106', t0 + interval '80 days' from fx
union all
select tenant_w, brand_q, 'oa', 'synthetic-oa-access-106-q', t0 + interval '20 hours', 'synthetic-oa-refresh-106-q', t0 + interval '80 days' from fx;

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

create function pg_temp.step(p_event uuid, p_at timestamptz, p_input jsonb default '{"kind": "none"}')
returns jsonb
language plpgsql
as $$
begin
  perform app.apply_oa_event(p_event, p_at);
  return app.oa_customer_step(p_event, p_input, p_at);
end;
$$;

create function pg_temp.welcome(p_user text, p_at timestamptz, p_now timestamptz default null, p_oa uuid default null, p_signature text default 'raw')
returns text
language sql
as $$
  select pg_temp.step(pg_temp.event(coalesce(p_oa, (select oa_w from fx)), 'follow', p_user, p_at, p_signature), coalesce(p_now, p_at + interval '2 seconds')) ->> 'step';
$$;

create function pg_temp.unfollow(p_user text, p_at timestamptz)
returns text
language sql
as $$
  select pg_temp.step(pg_temp.event((select oa_w from fx), 'unfollow', p_user, p_at), p_at + interval '2 seconds') ->> 'step';
$$;

create temp table steps (name text primary key, answer jsonb);
insert into steps
select 'first', pg_temp.step(pg_temp.event(oa_w, 'follow', 'oa-user-106-a', t0), t0 + interval '2 seconds') from fx;

select is(
  (select concat_ws(':', following, followed_at = (select t0 from fx), welcomed_at = (select t0 + interval '2 seconds' from fx)) from public.oa_users where oa_user_id = 'oa-user-106-a'),
  't:t:t',
  'a verified follow records the follower and claims the welcome'
);
select is(
  (select answer ->> 'step' from steps where name = 'first'),
  'welcome',
  'a follow earns the welcome'
);
select is(
  (select concat_ws(':', answer #>> '{reply,kind}', answer #>> '{reply,text}', jsonb_array_length(answer #> '{reply,buttons}'), answer #>> '{reply,mini_app_id}', answer ->> 'recipient')
   from steps where name = 'first'),
  'welcome:Cảm ơn bạn đã quan tâm.:2:synthetic-mini-106:oa-user-106-a',
  'the reply carries the welcome text, the menu buttons and the Mini App they open'
);
select is(
  (select answer ->> 'customer_id' from steps where name = 'first'),
  null,
  'a follower who has not joined is no customer'
);
select is(
  (select app.oa_customer_step((select id from public.oa_events where oa_user_id = 'oa-user-106-a' and event_name = 'follow'), '{"kind": "none"}', t0 + interval '1 minute') ->> 'step' from fx),
  'already_done',
  'the step of an event runs once'
);
select is(
  (select customer_step from public.oa_events where oa_user_id = 'oa-user-106-a' and event_name = 'follow'),
  'welcome',
  'the event keeps its outcome'
);
select is(
  (select pg_temp.welcome('oa-user-106-a', t0 + interval '1 minute') from fx),
  'already_welcomed',
  'a second follow without an unfollow earns nothing'
);
select is(
  (select pg_temp.unfollow('oa-user-106-a', t0 + interval '2 hours') from fx),
  'ignored',
  'an unfollow has no customer step'
);
select is(
  (select concat_ws(':', following, unfollowed_at = (select t0 + interval '2 hours' from fx)) from public.oa_users where oa_user_id = 'oa-user-106-a'),
  'f:t',
  'it ends the follow'
);
select is(
  (select pg_temp.welcome('oa-user-106-a', t0 + interval '3 hours') from fx),
  'already_welcomed',
  'a follow again on the same day earns no second welcome'
);
select is(
  (select pg_temp.unfollow('oa-user-106-a', t0 + interval '26 hours') || ':' || pg_temp.welcome('oa-user-106-a', t0 + interval '27 hours') from fx),
  'ignored:welcome',
  'a follow after an unfollow, a day later, earns its own welcome'
);
select is(
  (select pg_temp.welcome('oa-user-106-b', t0, t0 + interval '3 days') from fx),
  'stale',
  'a follow delivered more than 48 hours late earns nothing'
);
select is(
  (select pg_temp.welcome('oa-user-106-c', t0, null, null, 'mismatch') from fx),
  'unverified',
  'an unverified follow earns nothing'
);
select is(
  (select count(*)::integer from public.oa_users where oa_user_id = 'oa-user-106-c'),
  0,
  'and records no follower'
);
select is(
  (select pg_temp.welcome('oa-user-106-d', t0, null, oa_q) from fx),
  'no_welcome',
  'an OA without a menu sends no welcome'
);
update public.oa_menus set welcome_enabled = false where oa_id = (select oa_w from fx);
select is(
  (select pg_temp.welcome('oa-user-106-e', t0) from fx),
  'no_welcome',
  'nor an OA whose welcome is off'
);
update public.oa_menus set welcome_enabled = true where oa_id = (select oa_w from fx);
select is(
  (select pg_temp.unfollow('oa-user-106-f', t0 + interval '1 minute') || ':' || pg_temp.welcome('oa-user-106-f', t0) from fx),
  'ignored:not_following',
  'a follow delivered after a later unfollow does not follow again and earns nothing'
);

select is(
  (select pg_temp.step(pg_temp.event(oa_w, 'user_send_text', 'oa-user-106-g', t0), t0 + interval '2 seconds') ->> 'step' from fx),
  'ignored',
  'a message that is no menu keyword has no customer step'
);
select is(
  (select pg_temp.step(pg_temp.event(oa_w, 'user_send_image', 'oa-user-106-g', t0 + interval '1 minute'), t0 + interval '2 minutes', '{"kind": "keyword", "action": "join"}') ->> 'step' from fx),
  'ignored',
  'nor any event other than a text, whatever the input says'
);
select is(
  (select app.oa_last_interaction(oa_w, 'oa-user-106-g') = t0 + interval '1 minute' from fx),
  true,
  'the window starts at the latest verified message'
);
select is(
  (select pg_temp.event(oa_w, 'user_send_text', 'oa-user-106-g', t0 + interval '5 minutes', 'mismatch') is not null
     and app.oa_last_interaction(oa_w, 'oa-user-106-g') = t0 + interval '1 minute' from fx),
  true,
  'an unverified message does not move it'
);
select is(
  (select app.oa_last_interaction(oa_w, 'oa-user-106-a') from fx),
  null,
  'a follow alone opens no window'
);

select is(
  (select app.oa_access_token(oa_w, t0) from fx),
  'synthetic-oa-access-106',
  'the OA token is handed out while valid'
);
select is(
  (select app.oa_access_token(oa_w, t0 + interval '20 hours') from fx),
  null,
  'not in its last minute'
);
select is(
  (select app.oa_access_token(oa_q, t0) from fx),
  null,
  'nor for an OA whose package has no Open API'
);

create temp table replies as
select 'sent' as name, app.record_oa_reply(u.id, null, 'welcome', 'sent', null, 'mock-oa-message-1', (select t0 from fx)) as id
from public.oa_users u where u.oa_user_id = 'oa-user-106-a'
union all
select 'failed', app.record_oa_reply(u.id, null, 'form', 'failed', 'zalo_230', null, (select t0 from fx))
from public.oa_users u where u.oa_user_id = 'oa-user-106-a';

select is(
  (select concat_ws(':', o.channel, o.recipient_ref = 'oa_user:' || u.id::text, coalesce(o.subject_type::text, 'none'), o.purpose, o.template_ref, o.status, o.sent_at = (select t0 from fx), o.provider_message_id, o.title is null and o.body is null and o.kind is null)
   from replies r
   join public.outbound_messages o on o.id = r.id
   join public.oa_users u on u.oa_user_id = 'oa-user-106-a'
   where r.name = 'sent'),
  'zalo_oa:t:none:loyalty:oa_welcome.v1:sent:t:mock-oa-message-1:t',
  'a sent reply is logged with an opaque recipient and no text'
);
select is(
  (select concat_ws(':', o.status, o.sent_at is null, o.last_error_code)
   from replies r
   join public.outbound_messages o on o.id = r.id
   where r.name = 'failed'),
  'failed:t:zalo_230',
  'a failed reply keeps its error code and no send time'
);
select throws_ok(
  $$ select app.record_oa_reply((select id from public.oa_users limit 1), null, 'promotion', 'sent', null, null, now()) $$,
  '22023',
  null,
  'only the four consultation replies are logged'
);

set local role authenticated;
select throws_ok(
  'select count(*) from public.oa_users',
  '42501',
  null,
  'no API role reads the OA users'
);
reset role;
select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'oa_users'
     and column_name in ('name', 'phone', 'display_name', 'message', 'text', 'address', 'user_dob', 'gender')),
  0,
  'the OA users hold no name, phone, message, address, birth date or gender'
);

select * from finish();
rollback;
