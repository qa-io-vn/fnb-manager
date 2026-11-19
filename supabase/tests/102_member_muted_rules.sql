begin;
select plan(20);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010201'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000010202'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000010201'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000010202'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000010201'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000010211'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000010201'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000010202'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000010203'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000010204'::uuid as owner_y,
  '99999999-9999-4999-8999-000000010201'::uuid as owner_bot,
  '99999999-9999-4999-8999-000000010202'::uuid as staff_bot,
  '99999999-9999-4999-8999-000000010203'::uuid as staff_mail,
  '99999999-9999-4999-8999-000000010204'::uuid as other_bot;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notify-mute-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[fx.owner_x, fx.staff_x1, fx.staff_x2, fx.owner_y]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notify-mute-pgtap-x', 'Synthetic tenant X' from fx
union all
select tenant_y, 'notify-mute-pgtap-y', 'Synthetic tenant Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notify-mute-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notify-mute-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notify-mute-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notify-mute-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_x, owner_x, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_x, staff_x1, 'staff', array[store_x1] from fx
union all
select tenant_x, staff_x2, 'staff', array[store_x1] from fx
union all
select tenant_y, owner_y, 'owner', null from fx;

create temp table consents as
select d.user_id, app.ensure_notifications_consent(fx.tenant_x, d.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, now() - interval '1 day') as id
from fx
cross join lateral unnest(array[fx.owner_x, fx.staff_x1, fx.staff_x2]) as d (user_id);

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id, muted_rules)
select d.id, fx.tenant_x, d.kind::public.channel_kind, d.provider, d.label, d.user_id, d.address, d.secret_name, 'active', now() - interval '1 day',
  (select c.id from consents c where c.user_id = d.user_id), d.muted
from fx
cross join lateral (
  values
    (fx.owner_bot, 'zalo_bot', 'zalo_bot', 'Zalo Bot', fx.owner_x, 'notify-mute-chat-1', 'NOTIFY_ZALO_BOT_TOKEN_MUTE', '{}'::text[]),
    (fx.staff_bot, 'zalo_bot', 'zalo_bot', 'Zalo Bot', fx.staff_x1, 'notify-mute-chat-2', 'NOTIFY_ZALO_BOT_TOKEN_MUTE', '{}'::text[]),
    (fx.staff_mail, 'email', 'brevo', 'E-mail', fx.staff_x1, null, 'NOTIFY_EMAIL_API_KEY', array['staff_daily_digest']),
    (fx.other_bot, 'zalo_bot', 'zalo_bot', 'Zalo Bot', fx.staff_x2, 'notify-mute-chat-3', 'NOTIFY_ZALO_BOT_TOKEN_MUTE', array['checklist_unfinished'])
) as d (id, kind, provider, label, user_id, address, secret_name, muted);

create function pg_temp.mute_as(p_user uuid, p_channel uuid, p_rules text[])
returns text
language plpgsql
as $$
declare
  v_rules text[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  v_rules := public.set_my_muted_rules(p_channel, p_rules);
  return coalesce(nullif(array_to_string(v_rules, ','), ''), '-');
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.muted(p_channel uuid)
returns text
language sql
as $$
  select array_to_string(c.muted_rules, ',') from public.notification_channels c where c.id = p_channel;
$$;

grant select on fx to authenticated, anon;

select has_function('public', 'set_my_muted_rules', array['uuid', 'text[]'], 'set_my_muted_rules(uuid, text[]) exists');
select ok(
  (select p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.set_my_muted_rules(uuid, text[])'::regprocedure)
  and (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_my_muted_rules'),
  'set_my_muted_rules has one signature, is security definer, volatile, with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_my_muted_rules(uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.set_my_muted_rules(uuid, text[])', 'execute')
  and not has_function_privilege('service_role', 'public.set_my_muted_rules(uuid, text[])', 'execute'),
  'only authenticated executes set_my_muted_rules'
);

select is(
  pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), array['checklist_unfinished', 'staff_sync_stale', 'checklist_unfinished']),
  'staff_sync_stale,checklist_unfinished',
  'a member mutes rules on their own destination, without duplicates and in catalogue order'
);
select is(pg_temp.muted((select staff_bot from fx)), 'staff_sync_stale,checklist_unfinished', 'the destination keeps the list');
select is(pg_temp.muted((select staff_mail from fx)), 'staff_daily_digest', 'their other destination keeps its own list');
select is(pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), array['checklist_unfinished']), 'checklist_unfinished', 'the list is replaced, not added to');
select is(pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), '{}'::text[]), '-', 'an empty list unmutes every rule');

select is(pg_temp.mute_as((select staff_x1 from fx), (select other_bot from fx), '{}'::text[]), '42501', 'another member''s destination is refused');
select is(pg_temp.muted((select other_bot from fx)), 'checklist_unfinished', 'and keeps its list');
select is(pg_temp.mute_as((select owner_x from fx), (select staff_bot from fx), array['checklist_unfinished']), '42501', 'an owner does not mute a staff member''s destination for them');
select is(pg_temp.mute_as((select owner_y from fx), (select owner_bot from fx), array['daily_digest']), '42501', 'another tenant''s owner is refused');
select is(pg_temp.mute_as((select staff_x1 from fx), 'aaaaaaaa-0000-4000-8000-000000010299', array['daily_digest']), '42501', 'an unknown destination is refused');
select is(pg_temp.mute_as(null, (select staff_bot from fx), array['daily_digest']), '42501', 'a caller without a session is refused');
select is(pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), array['not_a_rule']), '22023', 'a key outside the catalogue is refused');
select is(pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), array['daily_digest', null]), '22023', 'a null key is refused');
select is(pg_temp.mute_as((select staff_x1 from fx), (select staff_bot from fx), null), '22023', 'a missing list is refused');

create temp table digest_message as
select app.enqueue_message(fx.tenant_x, fx.owner_bot, 'digest', 'digest.v1', 'notify-mute:digest', '{}'::jsonb, null, 'body', 'info', null, null, null, null, null, now()) as id
from fx;
select is(pg_temp.mute_as((select owner_x from fx), (select owner_bot from fx), array['daily_digest']), 'daily_digest', 'the owner mutes the daily digest on their bot');
select is(
  (select d.reason from app.message_decision((select id from digest_message), now()) d),
  'unsubscribed',
  'a waiting digest to that destination is then cancelled as unsubscribed'
);

set local role anon;
select throws_ok($q$ select public.set_my_muted_rules('99999999-9999-4999-8999-000000010202', array['daily_digest']) $q$, '42501', null, 'anon cannot mute');
reset role;

select * from finish();
rollback;
