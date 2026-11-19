begin;
select plan(24);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010301'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000010302'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000010301'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000010302'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000010301'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000010311'::uuid as store_y1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010301'::uuid as brand_x,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010311'::uuid as app_x,
  'eeeeeeee-eeee-4eee-8eee-000000010301'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000010302'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010303'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000010304'::uuid as staff_x3,
  'eeeeeeee-eeee-4eee-8eee-000000010305'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000010306'::uuid as outsider,
  '99999999-9999-4999-8999-000000010301'::uuid as bot_x1,
  '99999999-9999-4999-8999-000000010302'::uuid as mail_x1,
  '99999999-9999-4999-8999-000000010303'::uuid as pending_x1,
  '99999999-9999-4999-8999-000000010304'::uuid as bot_x2;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-stop-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.staff_x1, fx.staff_x2, fx.staff_x3, fx.owner_y, fx.outsider]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notify-stop-pgtap-x', 'Synthetic tenant X' from fx
union all
select tenant_y, 'notify-stop-pgtap-y', 'Synthetic tenant Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notify-stop-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notify-stop-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notify-stop-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notify-stop-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_x, owner_x, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_x, staff_x1, 'staff', array[store_x1] from fx
union all
select tenant_x, staff_x2, 'staff', array[store_x1] from fx
union all
select tenant_x, staff_x3, 'staff', array[store_x1] from fx
union all
select tenant_y, owner_y, 'owner', null from fx;

insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_x, 'Nhân viên Thử Một', 'staff'::public.tenant_role, array[store_x1], 'active', staff_x1, now() - interval '20 days' from fx;

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_x, tenant_x, 'brand-1', 'Synthetic brand X', array[store_x1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name)
select app_x, tenant_x, brand_x, 'synthetic-stop-app-x', 'ZALO_APP_SECRET_BRAND_1' from fx;
insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
select tenant_x, app_x, 'synthetic-stop-zalo-1', staff_x1, 'Synthetic staff' from fx;

create temp table staff_ops as
with inserted as (
  insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
  select tenant_x, 'staff', staff_x1, 'staff_ops', 'staff-notice-2026-01', 'mini_app', now() - interval '20 days', '{"method": "accept_button", "notice_channel": "mini_app"}'::jsonb
  from fx
  returning id
)
select id from inserted;

create temp table consents as
select d.user_id, app.ensure_notifications_consent(fx.tenant_x, d.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, now() - interval '10 days') as id
from fx
cross join lateral unnest(array[fx.staff_x1, fx.staff_x2]) as d (user_id);

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select d.id, fx.tenant_x, d.kind::public.channel_kind, d.provider, d.label, d.user_id, d.address, d.secret_name, d.status, d.linked_at,
  (select c.id from consents c where c.user_id = d.user_id)
from fx
cross join lateral (
  values
    (fx.bot_x1, 'zalo_bot', 'zalo_bot', 'Zalo Bot', fx.staff_x1, 'notify-stop-chat-1', 'NOTIFY_ZALO_BOT_TOKEN_STOP', 'active', now() - interval '10 days'),
    (fx.mail_x1, 'email', 'brevo', 'E-mail', fx.staff_x1, null, 'NOTIFY_EMAIL_API_KEY', 'active', now() - interval '10 days'),
    (fx.pending_x1, 'zalo_bot', 'zalo_bot', 'Zalo Bot 2', fx.staff_x1, null, 'NOTIFY_ZALO_BOT_TOKEN_STOP2', 'pending', null::timestamptz),
    (fx.bot_x2, 'zalo_bot', 'zalo_bot', 'Zalo Bot', fx.staff_x2, 'notify-stop-chat-2', 'NOTIFY_ZALO_BOT_TOKEN_STOP', 'active', now() - interval '10 days')
) as d (id, kind, provider, label, user_id, address, secret_name, status, linked_at);

select app.issue_link_code((select pending_x1 from fx), 'bot_link', now());

create temp table msg (label text primary key, id uuid);
insert into msg
select v.label, app.enqueue_message(fx.tenant_x, v.channel_id, v.kind, v.kind || '.v1', 'notify-stop:' || v.label, '{}'::jsonb, null, 'body', 'info', null, null, null, null, null, now())
from fx
cross join lateral (
  values
    ('queued', fx.bot_x1, 'test'),
    ('held', fx.mail_x1, 'test'),
    ('sent', fx.bot_x1, 'test'),
    ('other', fx.bot_x2, 'test')
) as v (label, channel_id, kind);
update public.outbound_messages o set status = 'held', not_before = now() + interval '1 hour' where o.id = (select id from msg where label = 'held');
update public.outbound_messages o set status = 'sending', claimed_at = now(), lease_until = now() + interval '2 minutes' where o.id = (select id from msg where label = 'sent');
update public.outbound_messages o set status = 'sent', sent_at = now() where o.id = (select id from msg where label = 'sent');

create function pg_temp.stop_as(p_user uuid, p_tenant uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return public.stop_my_notifications(p_tenant)::text;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.status_of(p_label text)
returns text
language sql
as $$
  select o.status || coalesce(':' || o.decision, '') from public.outbound_messages o where o.id = (select m.id from msg m where m.label = p_label);
$$;

grant select on fx to authenticated, anon;

select has_function('public', 'stop_my_notifications', array['uuid'], 'stop_my_notifications(uuid) exists');
select ok(
  (select p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.stop_my_notifications(uuid)'::regprocedure)
  and (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'stop_my_notifications'),
  'stop_my_notifications has one signature, is security definer, volatile, with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.stop_my_notifications(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.stop_my_notifications(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.stop_my_notifications(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.withdraw_notifications(uuid, uuid, timestamptz)', 'execute'),
  'only authenticated executes stop_my_notifications, and the service-side withdrawal stays closed to it'
);

select is(pg_temp.stop_as((select outsider from fx), (select tenant_x from fx)), '42501', 'a person outside the tenant is refused');
select is(pg_temp.stop_as((select owner_y from fx), (select tenant_x from fx)), '42501', 'another tenant''s owner is refused');
select is(pg_temp.status_of('queued'), 'queued', 'a refused stop cancels nothing');

select is(pg_temp.stop_as((select staff_x1 from fx), (select tenant_x from fx)), '2', 'Dừng nhận thông báo cancels the member''s two waiting messages');
select ok(
  (select c.revoked_at is not null from public.consent_records c where c.id = (select id from consents where user_id = (select staff_x1 from fx))),
  'the notifications consent is withdrawn'
);
select is(
  (
    select c.id::text || ':' || c.policy_version || ':' || (c.revoked_at is null)::text
    from public.consent_records c
    where c.subject_id = (select staff_x1 from fx) and c.purpose = 'staff_ops'
  ),
  (select id::text from staff_ops) || ':staff-notice-2026-01:true',
  'the staff_ops consent stays exactly as it was'
);
select is(
  (select count(*)::int from public.staff_roster r where r.user_id = (select staff_x1 from fx) and r.status = 'active')
  + (select count(*)::int from public.tenant_members m where m.user_id = (select staff_x1 from fx))
  + (select count(*)::int from public.zalo_identities i where i.user_id = (select staff_x1 from fx)),
  3,
  'the roster row, the membership and the Zalo pairing stay, so the staff app keeps working'
);
select is(
  (select count(*)::int from public.notification_channels c where c.id = (select pending_x1 from fx))
  + (select count(*)::int from app.notification_link_codes l where l.channel_id = (select pending_x1 from fx)),
  0,
  'a destination still waiting for its link goes, with its code'
);
select is(
  (select string_agg(c.status || ':' || c.disabled_reason, ',' order by c.kind) from public.notification_channels c where c.user_id = (select staff_x1 from fx)),
  'disabled:consent_withdrawn,disabled:consent_withdrawn',
  'every other destination of the member is disabled as consent_withdrawn'
);
select is(pg_temp.status_of('queued'), 'cancelled:no_consent', 'a queued message is cancelled');
select is(pg_temp.status_of('held'), 'cancelled:no_consent', 'a held message is cancelled');
select is(pg_temp.status_of('sent'), 'sent', 'a message already sent keeps its record');

select is(pg_temp.status_of('other'), 'queued', 'another member''s message still waits');
select is(
  (select c.status from public.notification_channels c where c.id = (select bot_x2 from fx))
  || ':' || (select (c.revoked_at is null)::text from public.consent_records c where c.id = (select id from consents where user_id = (select staff_x2 from fx))),
  'active:true',
  'and their destination and consent are untouched'
);

select is(
  pg_temp.stop_as((select staff_x1 from fx), (select tenant_x from fx)) || ':' || (select count(*)::text from public.consent_records c where c.subject_id = (select staff_x1 from fx)),
  '0:2',
  'stopping again cancels nothing and writes no consent row'
);

create temp table late as
select app.enqueue_message(fx.tenant_x, fx.bot_x1, 'test', 'test.v1', 'notify-stop:late', '{}'::jsonb, null, 'body', 'info', null, null, null, null, null, now()) as id
from fx;
select is(
  (select d.decision || ':' || d.reason from app.message_decision((select id from late), now()) d),
  'cancel:destination_inactive',
  'a message queued after the stop is cancelled at the next dispatch'
);

select is(
  (
    select (public.my_notifications((select tenant_x from fx)) -> 'consent' ->> 'state')
    from (select set_config('request.jwt.claims', json_build_object('sub', (select staff_x1 from fx), 'role', 'authenticated')::text, true)) as claims
  ),
  'withdrawn',
  'the member reads their consent as withdrawn'
);
select is(pg_temp.stop_as((select staff_x3 from fx), (select tenant_x from fx)), '0', 'a member who never accepted stops without error');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select staff_x2 from fx), 'role', 'authenticated')::text, true);
select is(public.stop_my_notifications((select tenant_x from fx)), 1, 'a member stops their notifications through the API role');
reset role;
select is(pg_temp.status_of('other'), 'cancelled:no_consent', 'and their waiting message is cancelled');

set local role anon;
select throws_ok($q$ select public.stop_my_notifications('dddddddd-dddd-4ddd-8ddd-000000010301') $q$, '42501', null, 'anon cannot stop anyone''s notifications');
reset role;

select * from finish();
rollback;
