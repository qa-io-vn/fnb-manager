begin;
select plan(41);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010101'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000010102'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000010101'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000010102'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000010101'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000010111'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000010101'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000010102'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010103'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010104'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000010105'::uuid as staff_x3,
  'eeeeeeee-eeee-4eee-8eee-000000010106'::uuid as staff_x4,
  'eeeeeeee-eeee-4eee-8eee-000000010107'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000010108'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000010109'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000010110'::uuid as outsider,
  'NOTIFY_ZALO_BOT_TOKEN_LINK'::text as secret;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-link-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_x1, fx.staff_x1, fx.staff_x2, fx.staff_x3, fx.staff_x4, fx.viewer_x, fx.publisher_x, fx.owner_y, fx.outsider]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notify-link-pgtap-x', 'Synthetic tenant X' from fx
union all
select tenant_y, 'notify-link-pgtap-y', 'Synthetic tenant Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notify-link-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notify-link-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notify-link-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notify-link-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_x2, 'staff', array[fx.store_x1]),
    (fx.staff_x3, 'staff', array[fx.store_x1]),
    (fx.staff_x4, 'staff', array[fx.store_x1]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select tenant_y, owner_y, 'owner', null from fx;

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, address_hint, secret_name, status, linked_at, disabled_reason)
select tenant_x, 'zalo_bot'::public.channel_kind, 'zalo_bot', 'Zalo Bot', owner_x, 'notify-link-chat-owner', '…wner', secret, 'active', now() - interval '10 days', null::text from fx
union all
select tenant_x, 'zalo_bot', 'zalo_bot', 'Zalo Bot', staff_x3, 'notify-link-chat-3', '…at-3', secret, 'disabled', now() - interval '10 days', 'owner_request' from fx;

insert into app.bot_poll_state (secret_name, kind, bot_name)
select secret, 'zalo_bot', 'Bot Liên kết' from fx;

create function pg_temp.start_as(p_user uuid, p_tenant uuid, p_version text default 'ops-notifications-v1')
returns jsonb
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return public.start_bot_link(p_tenant, p_version);
end;
$$;

create function pg_temp.outcome_as(p_user uuid, p_tenant uuid, p_version text default 'ops-notifications-v1')
returns text
language plpgsql
as $$
begin
  perform pg_temp.start_as(p_user, p_tenant, p_version);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.complete(p_code text, p_chat text, p_at timestamptz)
returns uuid
language sql
as $$
  select app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_LINK', p_code, p_chat, '…' || right(p_chat, 4), p_at);
$$;

create temp table link (label text primary key, result jsonb);
grant select on fx to authenticated, anon;

select has_function('public', 'start_bot_link', array['uuid', 'text'], 'start_bot_link(uuid, text) exists');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'start_bot_link'),
  1,
  'start_bot_link has one signature'
);
select ok(
  (select p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.start_bot_link(uuid, text)'::regprocedure),
  'start_bot_link is security definer, volatile, with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.start_bot_link(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.start_bot_link(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.start_bot_link(uuid, text)', 'execute'),
  'only authenticated executes start_bot_link'
);

select is(pg_temp.outcome_as((select outsider from fx), (select tenant_x from fx)), '42501', 'a person outside the tenant is refused');
select is(pg_temp.outcome_as((select owner_y from fx), (select tenant_x from fx)), '42501', 'another tenant''s owner is refused');
select is(pg_temp.outcome_as((select publisher_x from fx), (select tenant_x from fx)), '42501', 'a publisher, who receives no digest or alert, is refused');
select is(pg_temp.outcome_as((select staff_x1 from fx), (select tenant_x from fx), 'ops-notifications-v0'), '22023', 'a code after another notice version is refused');
select is(pg_temp.outcome_as((select staff_x1 from fx), (select tenant_x from fx), null), '22023', 'a code without the notice shown is refused');
select is(
  (select count(*)::int from public.notification_channels c where c.user_id in ((select staff_x1 from fx), (select publisher_x from fx))),
  0,
  'a refused start leaves no destination'
);

insert into link values ('x1', pg_temp.start_as((select staff_x1 from fx), (select tenant_x from fx)));

select ok((select result ?& array['channel_id', 'notice_version', 'code', 'expires_at', 'bot_name'] from link where label = 'x1'), 'the answer names the destination, the notice version, the code, its expiry and the bot');
select is((select result ->> 'notice_version' from link where label = 'x1'), 'ops-notifications-v1', 'the notice version the code follows');
select matches((select result ->> 'code' from link where label = 'x1'), '^FNB-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'the code is FNB- and eight unambiguous characters');
select is((select (result ->> 'expires_at')::timestamptz from link where label = 'x1'), now() + interval '15 minutes', 'the code lives 15 minutes');
select is((select result ->> 'bot_name' from link where label = 'x1'), 'Bot Liên kết', 'the member is told which bot to message');
select is(
  (
    select jsonb_build_object('kind', c.kind, 'status', c.status, 'secret_name', c.secret_name, 'address', c.address, 'created_by', c.created_by = (select staff_x1 from fx))
    from public.notification_channels c
    where c.id = (select (result ->> 'channel_id')::uuid from link where label = 'x1')
  ),
  '{"kind": "zalo_bot", "status": "pending", "secret_name": "NOTIFY_ZALO_BOT_TOKEN_LINK", "address": null, "created_by": true}'::jsonb,
  'a pending Zalo Bot destination of the member on the bot the tenant already uses'
);
select is(
  (
    select l.code_sha256
    from app.notification_link_codes l
    where l.channel_id = (select (result ->> 'channel_id')::uuid from link where label = 'x1') and l.purpose = 'bot_link'
  ),
  (select app.sha256_hex('NOTIFY_ZALO_BOT_TOKEN_LINK:' || (result ->> 'code')) from link where label = 'x1'),
  'only the hash of the code is kept'
);
select ok(
  not exists (
    select 1
    from app.notification_link_codes l
    where strpos(to_jsonb(l)::text, (select result ->> 'code' from link where label = 'x1')) > 0
  )
  and not exists (
    select 1
    from public.outbound_messages o
    where strpos(to_jsonb(o)::text, (select result ->> 'code' from link where label = 'x1')) > 0
  ),
  'the code itself is stored nowhere'
);
select is(
  (select count(*)::int from public.consent_records c where c.subject_id = (select staff_x1 from fx) and c.purpose = 'notifications'),
  0,
  'starting a link records no consent'
);

select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'x1'), 'notify-link-chat-1', now()),
  (select (result ->> 'channel_id')::uuid from link where label = 'x1'),
  'the code sent to the bot finds the destination'
);
select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'x1'), 'notify-link-chat-1', now()),
  null,
  'the same code works once only'
);
select is(
  (select c.status || ':' || c.address from public.notification_channels c where c.id = (select (result ->> 'channel_id')::uuid from link where label = 'x1')),
  'pending:notify-link-chat-1',
  'the chat is known but the destination still waits'
);
select is(
  (select count(*)::int from public.outbound_messages o where o.channel_id = (select (result ->> 'channel_id')::uuid from link where label = 'x1') and o.kind = 'link_notice'),
  1,
  'the bot will send the notice'
);
select is(
  app.accept_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_LINK', 'notify-link-chat-1', now()),
  null,
  'ĐỒNG Ý before the notice reached the member links nothing'
);
update app.notification_link_codes l
set notice_sent_at = now()
where l.channel_id = (select (result ->> 'channel_id')::uuid from link where label = 'x1');
select is(
  app.accept_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_LINK', 'notify-link-chat-1', now()),
  (select (result ->> 'channel_id')::uuid from link where label = 'x1'),
  'the member''s own ĐỒNG Ý after the notice links the destination'
);
select is(
  (
    select c.evidence ->> 'method'
    from public.consent_records c
    where c.subject_id = (select staff_x1 from fx) and c.purpose = 'notifications' and c.revoked_at is null
  ),
  'bot_reply',
  'and only then records the consent, as the reply in the bot chat'
);
select is(pg_temp.outcome_as((select staff_x1 from fx), (select tenant_x from fx)), '23505', 'a member whose Zalo Bot is linked gets no new code');

insert into link values ('x2', pg_temp.start_as((select staff_x2 from fx), (select tenant_x from fx)));
select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'x2'), 'notify-link-chat-2', now() + interval '16 minutes'),
  null,
  'an expired code finds nothing'
);
select is(
  (select c.address from public.notification_channels c where c.id = (select (result ->> 'channel_id')::uuid from link where label = 'x2')),
  null,
  'and keeps no chat id'
);
select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'x2'), 'notify-link-chat-2', now() + interval '14 minutes'),
  (select (result ->> 'channel_id')::uuid from link where label = 'x2'),
  'the same code within its 15 minutes still works'
);

insert into link values ('m1', pg_temp.start_as((select manager_x1 from fx), (select tenant_x from fx)));
insert into link values ('m2', pg_temp.start_as((select manager_x1 from fx), (select tenant_x from fx)));
select is(
  (select result ->> 'channel_id' from link where label = 'm2'),
  (select result ->> 'channel_id' from link where label = 'm1'),
  'a second start reuses the member''s pending destination'
);
select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'm1'), 'notify-link-chat-m', now()),
  null,
  'and the earlier code no longer works'
);
select is(
  pg_temp.complete((select result ->> 'code' from link where label = 'm2'), 'notify-link-chat-m', now()),
  (select (result ->> 'channel_id')::uuid from link where label = 'm2'),
  'while the new one does'
);

select is(
  (select string_agg(pg_temp.outcome_as((select viewer_x from fx), (select tenant_x from fx)), ',') from generate_series(1, 6)),
  'ok,ok,ok,ok,ok,55000',
  'at most five codes an hour'
);
update app.notification_link_starts s
set window_started_at = now() - interval '61 minutes'
where s.user_id = (select viewer_x from fx);
select is(pg_temp.outcome_as((select viewer_x from fx), (select tenant_x from fx)), 'ok', 'a new hour allows a new code');

select is(pg_temp.outcome_as((select staff_x3 from fx), (select tenant_x from fx)), '42501', 'a link the owner removed is not restarted by the member');

select app.withdraw_notifications((select tenant_x from fx), (select staff_x1 from fx), now());
insert into link values ('x1again', pg_temp.start_as((select staff_x1 from fx), (select tenant_x from fx)));
select is(
  (
    select jsonb_build_object('same', c.id = (select (result ->> 'channel_id')::uuid from link where label = 'x1'), 'status', c.status, 'address', c.address, 'linked_at', c.linked_at, 'reason', c.disabled_reason)
    from public.notification_channels c
    where c.id = (select (result ->> 'channel_id')::uuid from link where label = 'x1again')
  ),
  '{"same": true, "status": "pending", "address": null, "linked_at": null, "reason": null}'::jsonb,
  'after stopping, the member links the same destination again from the start'
);
select is(
  (select count(*)::int from public.consent_records c where c.subject_id = (select staff_x1 from fx) and c.purpose = 'notifications' and c.revoked_at is null),
  0,
  'without a consent until the next ĐỒNG Ý'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select staff_x4 from fx), 'role', 'authenticated')::text, true);
select matches(public.start_bot_link((select tenant_x from fx), 'ops-notifications-v1') ->> 'code', '^FNB-', 'a member starts a link through the API role');
select throws_ok(
  $q$ select app.issue_link_code((select c.id from public.notification_channels c limit 1), 'bot_link', now()) $q$,
  '42501',
  null,
  'and cannot issue a code through the service-side function'
);
reset role;

set local role anon;
select throws_ok($q$ select public.start_bot_link('dddddddd-dddd-4ddd-8ddd-000000010101', 'ops-notifications-v1') $q$, '42501', null, 'anon cannot start a link');
reset role;

select * from finish();
rollback;
