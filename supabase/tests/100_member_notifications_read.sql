begin;
select plan(30);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010001'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000010002'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000010001'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000010002'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000010001'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000010002'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000010011'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000010001'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000010002'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010003'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010004'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000010005'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000010006'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000010007'::uuid as outsider,
  '99999999-9999-4999-8999-000000010001'::uuid as bot_x1,
  '99999999-9999-4999-8999-000000010002'::uuid as mail_x1,
  '99999999-9999-4999-8999-000000010003'::uuid as bot_x2;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-read-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_x1, fx.staff_x1, fx.staff_x2, fx.publisher_x, fx.owner_y, fx.outsider]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notify-read-pgtap-x', 'Cửa hàng Thử X' from fx
union all
select tenant_y, 'notify-read-pgtap-y', 'Cửa hàng Thử Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notify-read-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notify-read-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notify-read-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_x2, tenant_x, account_x, 'notify-read-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notify-read-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_x2, 'staff', array[fx.store_x2]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select tenant_y, owner_y, 'owner', null from fx;

create function pg_temp.read_as(p_user uuid, p_tenant uuid)
returns jsonb
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return public.my_notifications(p_tenant);
end;
$$;

create function pg_temp.outcome_as(p_user uuid, p_tenant uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform public.my_notifications(p_tenant);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

grant select on fx to authenticated, anon;

select has_function('public', 'my_notifications', array['uuid'], 'my_notifications(uuid) exists');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'my_notifications'),
  1,
  'my_notifications has one signature'
);
select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.my_notifications(uuid)'::regprocedure),
  'my_notifications is security definer, stable, with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.my_notifications(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_notifications(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.my_notifications(uuid)', 'execute'),
  'only authenticated executes my_notifications'
);

select is(pg_temp.outcome_as((select outsider from fx), (select tenant_x from fx)), '42501', 'a signed-in person outside the tenant is refused');
select is(pg_temp.outcome_as((select owner_y from fx), (select tenant_x from fx)), '42501', 'another tenant''s owner is refused');
select is(pg_temp.outcome_as(null, (select tenant_x from fx)), '42501', 'a caller without a session is refused');
select is(pg_temp.outcome_as((select staff_x1 from fx), null), '42501', 'no tenant is refused');

select is(
  pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'consent',
  '{"state": "none", "granted_at": null, "revoked_at": null, "channel": null}'::jsonb,
  'a member who never accepted has no notifications consent'
);
select is(
  pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'destinations',
  '[]'::jsonb,
  'and no destination'
);
select is(
  pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'notice',
  jsonb_build_object(
    'version', 'ops-notifications-v1',
    'text', normalize('Khi liên kết, Cửa hàng Thử X chỉ dùng mã tài khoản Zalo hoặc địa chỉ e-mail đăng nhập của bạn để gửi bản tin số liệu hằng ngày và cảnh báo vận hành. Tin do hệ thống tự động gửi qua Zalo Bot. Việc liên kết là tự nguyện và không ảnh hưởng đến công việc của bạn. Bạn có thể ngừng bất cứ lúc nào trong Cài đặt → Cảnh báo, hoặc nhờ chủ cửa hàng gỡ liên kết. Nhật ký gửi tin được lưu khoảng 13 tháng.', nfc)
  ),
  'the notice is ops-notifications-v1 word for word, with the tenant''s name'
);
select ok(
  (
    select array_agg(r ->> 'rule_key') @> array['staff_sync_stale', 'checklist_unfinished', 'staff_daily_digest']
      and not (array_agg(r ->> 'rule_key') && array['daily_digest', 'sync_failed', 'revenue_below_baseline'])
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'rules') as r
  ),
  'staff may mute the rules that reach staff, and see none of the owners'' and managers'' rules'
);
select ok(
  (
    select array_agg(r ->> 'rule_key') @> array['daily_digest', 'sync_failed', 'revenue_below_baseline']
      and not (array_agg(r ->> 'rule_key') && array['staff_daily_digest'])
    from jsonb_array_elements(pg_temp.read_as((select owner_x from fx), (select tenant_x from fx)) -> 'rules') as r
  ),
  'an owner may mute the owners'' rules and not the staff digest'
);
select is(
  (
    select array_agg(r ->> 'rule_key' order by ordinality)
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'rules') with ordinality as e (r, ordinality)
    where r ->> 'rule_key' in ('staff_sync_stale', 'checklist_unfinished', 'staff_daily_digest')
  ),
  array['staff_sync_stale', 'checklist_unfinished', 'staff_daily_digest'],
  'rules come in catalogue order'
);

insert into public.alert_rules (tenant_id, store_id, rule_key, roles)
select tenant_x, null, 'zero_sales_open', array['owner', 'manager', 'staff']::public.tenant_role[] from fx;
select ok(
  (
    select bool_or(r ->> 'rule_key' = 'zero_sales_open')
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'rules') as r
  ),
  'a tenant row that sends a rule to staff lets staff mute it'
);

create temp table consent_x1 as
select app.ensure_notifications_consent(fx.tenant_x, fx.staff_x1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as id
from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, address_hint, secret_name, status, linked_at, consent_record_id, muted_rules, created_at)
select bot_x1, tenant_x, 'zalo_bot'::public.channel_kind, 'zalo_bot'::text, 'Zalo Bot'::text, staff_x1, 'notify-read-chat-1'::text, '…at-1'::text, 'NOTIFY_ZALO_BOT_TOKEN_READ'::text, 'active'::text, '2026-11-01 00:00+00'::timestamptz, (select id from consent_x1), '{}'::text[], '2026-11-01 00:00+00'::timestamptz from fx
union all
select mail_x1, tenant_x, 'email', 'brevo', 'E-mail', staff_x1, null, 'n…@example.com', 'NOTIFY_EMAIL_API_KEY', 'active', '2026-11-02 00:00+00', (select id from consent_x1), array['daily_digest', 'checklist_unfinished'], '2026-11-02 00:00+00' from fx
union all
select bot_x2, tenant_x, 'zalo_bot', 'zalo_bot', 'Zalo Bot', staff_x2, 'notify-read-chat-2', '…at-2', 'NOTIFY_ZALO_BOT_TOKEN_READ', 'pending', null, null, '{}', '2026-11-03 00:00+00' from fx;

insert into app.bot_poll_state (secret_name, kind, bot_name)
values ('NOTIFY_ZALO_BOT_TOKEN_READ', 'zalo_bot', 'Bot Thử');

select is(
  (pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'consent') - 'granted_at',
  '{"state": "active", "revoked_at": null, "channel": "zalo_bot"}'::jsonb,
  'an accepted consent reads as active with its channel'
);
select is(
  (
    select array_agg(d ->> 'id' order by ordinality)
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'destinations') with ordinality as e (d, ordinality)
  ),
  array[(select bot_x1::text from fx), (select mail_x1::text from fx)],
  'the member reads their own destinations, oldest first, and not another member''s'
);
select is(
  (
    select jsonb_agg(d - 'id' - 'linked_at' order by ordinality)
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'destinations') with ordinality as e (d, ordinality)
  ),
  '[
    {"kind": "zalo_bot", "provider": "zalo_bot", "label": "Zalo Bot", "address_hint": "…at-1", "status": "active", "enabled": true, "muted_rules": [], "last_ok_at": null, "disabled_reason": null, "link_stage": null, "link_expires_at": null},
    {"kind": "email", "provider": "brevo", "label": "E-mail", "address_hint": "n…@example.com", "status": "active", "enabled": true, "muted_rules": ["daily_digest", "checklist_unfinished"], "last_ok_at": null, "disabled_reason": null, "link_stage": null, "link_expires_at": null}
  ]'::jsonb,
  'each destination carries its state, hint and muted rules'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'destinations') as d
    where d ?| array['address', 'secret_name', 'config', 'consent_record_id', 'user_id', 'tenant_id']
  ),
  'no destination carries its address, secret name, configuration or ids beyond its own'
);
select ok(
  (
    select bool_or(r ->> 'rule_key' = 'daily_digest')
    from jsonb_array_elements(pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'rules') as r
  ),
  'a rule the member muted stays listed so they can unmute it'
);
select is(
  pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) ->> 'bot_name',
  'Bot Thử',
  'the bot the member links to is named'
);

select is(
  pg_temp.read_as((select staff_x2 from fx), (select tenant_x from fx)) -> 'destinations' -> 0 ->> 'link_stage',
  null,
  'a pending destination without a live code has no link stage'
);
select app.issue_link_code((select bot_x2 from fx), 'bot_link', now());
select is(
  (pg_temp.read_as((select staff_x2 from fx), (select tenant_x from fx)) -> 'destinations' -> 0) - 'id' - 'last_ok_at' - 'muted_rules' - 'label' - 'provider' - 'kind' - 'enabled' - 'linked_at' - 'disabled_reason' - 'address_hint',
  jsonb_build_object('status', 'pending', 'link_stage', 'code', 'link_expires_at', now() + interval '15 minutes'),
  'a pending destination with a code shows the code stage and its expiry'
);
update app.notification_link_codes l
set purpose = 'bot_consent', code_sha256 = app.sha256_hex('NOTIFY_ZALO_BOT_TOKEN_READ:notify-read-chat-2'), expires_at = now() + interval '24 hours'
where l.channel_id = (select bot_x2 from fx);
select is(
  pg_temp.read_as((select staff_x2 from fx), (select tenant_x from fx)) -> 'destinations' -> 0 ->> 'link_stage',
  'acceptance',
  'once the code reached the bot the destination waits for the member''s ĐỒNG Ý'
);

select app.withdraw_notifications((select tenant_x from fx), (select staff_x1 from fx), now());
select is(
  (pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'consent') ->> 'state',
  'withdrawn',
  'a withdrawn consent reads as withdrawn'
);
select ok(
  (pg_temp.read_as((select staff_x1 from fx), (select tenant_x from fx)) -> 'consent' ->> 'revoked_at') is not null,
  'with the time it was withdrawn'
);

select is(
  jsonb_array_length(pg_temp.read_as((select publisher_x from fx), (select tenant_x from fx)) -> 'destinations'),
  0,
  'a publisher reads an empty list'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select staff_x2 from fx), 'role', 'authenticated')::text, true);
select is(
  jsonb_array_length(public.my_notifications((select tenant_x from fx)) -> 'destinations'),
  1,
  'a member calls it through the API role'
);
select is(
  (select count(*)::int from public.notification_channels c where c.tenant_id = (select tenant_x from fx) and c.user_id = (select staff_x1 from fx)),
  0,
  'and still reads no other member''s destination from the table'
);
reset role;

set local role anon;
select throws_ok($q$ select public.my_notifications('dddddddd-dddd-4ddd-8ddd-000000010001') $q$, '42501', null, 'anon cannot read anyone''s notifications');
reset role;

select * from finish();
rollback;
