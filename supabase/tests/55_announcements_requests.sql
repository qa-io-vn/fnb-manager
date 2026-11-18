begin;
select plan(144);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005501'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000005502'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000005501'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000005502'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000005501'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000005502'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000005511'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005501'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000005502'::uuid as owner_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005503'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005504'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005505'::uuid as manager_x2,
  'eeeeeeee-eeee-4eee-8eee-000000005506'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005507'::uuid as staff_x1b,
  'eeeeeeee-eeee-4eee-8eee-000000005508'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000005509'::uuid as staff_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005510'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000005511'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000005512'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000005513'::uuid as staff_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005514'::uuid as no_member,
  'eeeeeeee-eeee-4eee-8eee-000000005515'::uuid as staff_late;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'notices-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[
  fx.owner_x, fx.owner_x1, fx.manager_xall, fx.manager_x1, fx.manager_x2, fx.staff_x1, fx.staff_x1b, fx.staff_x2, fx.staff_xall,
  fx.viewer_x, fx.publisher_x, fx.owner_y, fx.staff_y1, fx.no_member, fx.staff_late
]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'notices-pgtap-x', 'Notices pgTAP X' from fx
union all
select tenant_y, 'notices-pgtap-y', 'Notices pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'notices-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'notices-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone)
select store_x1, tenant_x, account_x, 'notices-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh' from fx
union all
select store_x2, tenant_x, account_x, 'notices-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh' from fx
union all
select store_y1, tenant_y, account_y, 'notices-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.owner_x1, 'owner', array[fx.store_x1]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.manager_x2, 'manager', array[fx.store_x2]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_x1b, 'staff', array[fx.store_x1]),
    (fx.staff_x2, 'staff', array[fx.store_x2]),
    (fx.staff_xall, 'staff', null::uuid[]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_y, 'owner', null::uuid[]),
    (fx.staff_y1, 'staff', array[fx.store_y1])
) as m (user_id, role, store_ids);

insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_x, 'Nhân viên Một', 'staff'::public.tenant_role, array[store_x1], 'active', staff_x1, now() from fx
union all
select tenant_x, 'Nhân viên Hai', 'staff', array[store_x1], 'active', staff_x1b, now() from fx;

create temp table consents as
select d.user_id, app.ensure_notifications_consent(fx.tenant_x, d.user_id, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as consent_id
from fx
cross join lateral unnest(array[fx.owner_x, fx.manager_xall, fx.manager_x2, fx.staff_x1, fx.staff_x2, fx.staff_xall]) as d (user_id);

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, config, status, linked_at, consent_record_id, store_ids)
select fx.tenant_x, d.kind::public.channel_kind, d.provider, d.label, d.user_id, d.address, d.secret_name, '{}'::jsonb, 'active', '2026-11-01 00:00+00',
  (select c.consent_id from consents c where c.user_id = d.user_id), d.store_ids
from fx
cross join lateral (
  values
    ('zalo_bot', 'zalo_bot', 'owner bot', fx.owner_x, 'notices-chat-01', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'manager bot', fx.manager_xall, 'notices-chat-03', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'manager x2 bot', fx.manager_x2, 'notices-chat-05', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'staff x1 bot', fx.staff_x1, 'notices-chat-06', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('email', 'brevo', 'staff x1 mail', fx.staff_x1, null, 'NOTIFY_EMAIL_API_KEY', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'staff x1b bot', fx.staff_x1b, 'notices-chat-07', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'staff x2 bot', fx.staff_x2, 'notices-chat-08', 'NOTIFY_ZALO_BOT_TOKEN_IT', null::uuid[]),
    ('zalo_bot', 'zalo_bot', 'staff all bot', fx.staff_xall, 'notices-chat-09', 'NOTIFY_ZALO_BOT_TOKEN_IT', array[fx.store_x2])
) as d (kind, provider, label, user_id, address, secret_name, store_ids);

create function pg_temp.call_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_result;
  return v_result;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create temp table ann (label text primary key, id uuid, result jsonb);
create temp table req (label text primary key, id uuid, result jsonb);

create function pg_temp.label_of(p_id uuid)
returns text
language sql
as $$
  select coalesce((select a.label from ann a where a.id = p_id), (select r.label from req r where r.id = p_id), 'other');
$$;

create function pg_temp.person(p_id uuid)
returns text
language sql
as $$
  select case p_id
    when fx.owner_x then 'owner_x' when fx.owner_x1 then 'owner_x1' when fx.manager_xall then 'manager_xall' when fx.manager_x1 then 'manager_x1'
    when fx.manager_x2 then 'manager_x2' when fx.staff_x1 then 'staff_x1' when fx.staff_x1b then 'staff_x1b' when fx.staff_x2 then 'staff_x2'
    when fx.staff_xall then 'staff_xall' when fx.staff_late then 'staff_late' else 'other' end
  from fx;
$$;

create function pg_temp.feed_as(p_user uuid, p_store uuid default null, p_expired boolean default false)
returns text
language plpgsql
as $$
declare
  v_labels text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(pg_temp.label_of(f.announcement_id) || case when f.pinned then '*' else '' end, ',' order by f.ordinality), '-')
  into v_labels
  from public.announcement_feed(p_store, p_expired) with ordinality as f;
  return v_labels;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.visible_as(p_user uuid, p_relation text)
returns text
language plpgsql
as $$
declare
  v_labels text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  if p_relation = 'announcements' then
    select coalesce(string_agg(pg_temp.label_of(a.id), ',' order by pg_temp.label_of(a.id)), '-') into v_labels from public.announcements a;
  elsif p_relation = 'announcement_recipients' then
    select coalesce(string_agg(pg_temp.label_of(r.announcement_id) || ':' || pg_temp.person(r.user_id), ',' order by pg_temp.label_of(r.announcement_id), pg_temp.person(r.user_id)), '-') into v_labels from public.announcement_recipients r;
  elsif p_relation = 'announcement_receipts' then
    select coalesce(string_agg(pg_temp.label_of(r.announcement_id) || ':' || pg_temp.person(r.created_by), ',' order by pg_temp.label_of(r.announcement_id), pg_temp.person(r.created_by)), '-') into v_labels from public.announcement_receipts r;
  else
    select coalesce(string_agg(pg_temp.label_of(r.id), ',' order by pg_temp.label_of(r.id)), '-') into v_labels from public.approval_requests r;
  end if;
  return v_labels;
exception when others then
  return sqlstate;
end;
$$;

grant select on fx, ann, req to authenticated, anon;

select has_table('public', 'announcements', 'announcements exists');
select has_table('public', 'announcement_recipients', 'announcement_recipients exists');
select has_table('public', 'announcement_receipts', 'announcement_receipts exists');
select has_table('public', 'approval_request_kinds', 'approval_request_kinds exists');
select has_table('public', 'approval_requests', 'approval_requests exists');
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('announcements', 'announcement_recipients', 'announcement_receipts', 'approval_request_kinds', 'approval_requests') and c.relrowsecurity),
  5,
  'the five tables have row level security enabled'
);
select is(
  (select array_agg(p.tablename::text || ':' || p.cnt order by p.tablename collate "C")
   from (select tablename, count(*) as cnt from pg_policies where schemaname = 'public'
         and tablename in ('announcements', 'announcement_recipients', 'announcement_receipts', 'approval_request_kinds', 'approval_requests')
         and roles = array['authenticated']::name[] group by tablename) p),
  array['announcement_receipts:4', 'announcement_recipients:4', 'announcements:4', 'approval_request_kinds:4', 'approval_requests:4'],
  'each table has four policies, all for authenticated'
);
select is(
  (select array_agg(k.key || ':' || k.sort_order order by k.sort_order) from public.approval_request_kinds k where k.tenant_id is null),
  array['mua_hang:10', 'chenh_lech_tien:20', 'ngoai_le_checklist:30', 'khac:90'],
  'four Vietnamese default request kinds, none for leave or shift swaps'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
   and table_name in ('announcements', 'announcement_recipients', 'announcement_receipts', 'approval_request_kinds', 'approval_requests')),
  0,
  'anon holds no privilege on the five tables'
);
select is(
  (select array_agg(t.table_name::text || ':' || t.privilege_type order by t.table_name collate "C", t.privilege_type collate "C")
   from information_schema.role_table_grants t where t.grantee = 'authenticated' and t.table_schema = 'public'
   and t.table_name in ('announcements', 'announcement_recipients', 'announcement_receipts', 'approval_request_kinds', 'approval_requests')),
  array['announcement_receipts:SELECT', 'announcement_recipients:SELECT', 'announcements:SELECT', 'approval_request_kinds:DELETE', 'approval_request_kinds:INSERT',
        'approval_request_kinds:SELECT', 'approval_requests:SELECT'],
  'members read the four operations tables and write none of them table-wide; owners manage request kinds'
);
select ok(
  has_column_privilege('authenticated', 'public.approval_requests', 'details', 'insert')
  and has_column_privilege('authenticated', 'public.approval_requests', 'kind_key', 'insert')
  and not has_column_privilege('authenticated', 'public.approval_requests', 'status', 'insert')
  and not has_column_privilege('authenticated', 'public.approval_requests', 'created_by', 'insert')
  and not has_column_privilege('authenticated', 'public.approval_requests', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.announcement_receipts', 'read_at', 'insert'),
  'a member inserts a request''s store, kind and details only, and never sets a status, a requester or a read time'
);
select is(
  (select array_agg(n.nspname || '.' || p.proname || ':' || p.prosecdef || ':' || p.provolatile::text order by n.nspname || '.' || p.proname collate "C")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (('app', 'publish_announcement'), ('app', 'set_announcement_pin'), ('app', 'mark_announcement_read'), ('app', 'decide_request'),
     ('public', 'publish_announcement'), ('public', 'set_announcement_pin'), ('public', 'mark_announcement_read'), ('public', 'decide_request'),
     ('public', 'announcement_feed'), ('public', 'announcement_read_rate'), ('public', 'announcement_readers'), ('public', 'submit_request'),
     ('public', 'approval_request_kinds_of'), ('public', 'approval_queue'), ('public', 'my_requests'))
     and p.proconfig = array['search_path=""']),
  array['app.decide_request:true:v', 'app.mark_announcement_read:true:v', 'app.publish_announcement:true:v', 'app.set_announcement_pin:true:v',
        'public.announcement_feed:false:s', 'public.announcement_read_rate:false:s', 'public.announcement_readers:false:s', 'public.approval_queue:false:s',
        'public.approval_request_kinds_of:false:s', 'public.decide_request:false:v', 'public.mark_announcement_read:false:v', 'public.my_requests:false:s',
        'public.publish_announcement:false:v', 'public.set_announcement_pin:false:v', 'public.submit_request:false:v'],
  'the four writers are security definer in app behind invoker wrappers, the readers and submit_request run as the caller, all with an empty search_path'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('publish_announcement', 'set_announcement_pin', 'mark_announcement_read', 'decide_request', 'announcement_feed', 'announcement_read_rate',
       'announcement_readers', 'submit_request', 'approval_request_kinds_of', 'approval_queue', 'my_requests')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
  11,
  'the eleven RPCs act only for a signed-in member: authenticated executes them, anon, public and the service role do not'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('member_destinations', 'enqueue_member_message', 'approval_request_kind_active', 'announcement_visible')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'the outbox and visibility helpers run inside the definer functions only'
);
select ok(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'outbound_messages_kind_check') like '%''announcement''%''request_decided''%',
  'the outbox takes the two new message kinds'
);

insert into ann (label, id, result)
select 'A1', (r ->> 'announcement_id')::uuid, r
from (select pg_temp.call_as(fx.manager_x1, format($q$ select public.publish_announcement(%L, 'Lịch vệ sinh tuần này', 'Cả ca sáng lau kho trước 10 giờ.', array[%L]::uuid[], p_pinned_until => now() + interval '3 days', p_expires_at => now() + interval '10 days')::text $q$, fx.tenant_x, fx.store_x1))::jsonb as r from fx) p;
insert into ann (label, id, result)
select 'A2', (r ->> 'announcement_id')::uuid, r
from (select pg_temp.call_as(fx.owner_x, format($q$ select public.publish_announcement(%L, 'Thực đơn mới', 'Từ thứ hai áp dụng thực đơn mới ở mọi cửa hàng.', null, array['staff']::public.tenant_role[])::text $q$, fx.tenant_x))::jsonb as r from fx) p;
insert into ann (label, id, result)
select 'A3', (r ->> 'announcement_id')::uuid, r
from (select pg_temp.call_as(fx.owner_x, format($q$ select public.publish_announcement(%L, 'Họp quản lý', 'Họp quản lý cửa hàng X2 lúc 15 giờ.', array[%L]::uuid[], array['owner', 'manager']::public.tenant_role[])::text $q$, fx.tenant_x, fx.store_x2))::jsonb as r from fx) p;

select is(
  (select array_agg(a.label || ':' || (a.result ->> 'recipients') || ':' || (a.result ->> 'messages') order by a.label) from ann a),
  array['A1:4:3', 'A2:4:4', 'A3:2:2'],
  'publishing fixes the recipients and queues one message per recipient destination: A1 reaches 4 members and 3 destinations (no consent, a destination narrowed to another store), A2 every staff member, A3 the two managers of X2'
);
select is(
  (select string_agg(pg_temp.label_of(r.announcement_id) || ':' || pg_temp.person(r.user_id) || ':' || r.role || ':' || coalesce(array_length(r.store_ids, 1)::text, 'all'), ',' order by pg_temp.label_of(r.announcement_id), pg_temp.person(r.user_id))
   from public.announcement_recipients r where r.announcement_id in (select a.id from ann a)),
  'A1:manager_xall:manager:1,A1:staff_x1:staff:1,A1:staff_x1b:staff:1,A1:staff_xall:staff:1,A2:staff_x1:staff:1,A2:staff_x1b:staff:1,A2:staff_x2:staff:1,A2:staff_xall:staff:all,A3:manager_x2:manager:1,A3:manager_xall:manager:1',
  'recipients are the audience roles whose scope meets the stores, the author left out, with the stores they received it at (all for staff of every store on an every-store notice)'
);
select is(
  (select string_agg(pg_temp.person(c.user_id) || ':' || c.kind, ',' order by pg_temp.person(c.user_id), c.kind::text)
   from public.outbound_messages o join public.notification_channels c on c.id = o.channel_id
   where o.dedupe_key like 'announcement:' || (select id from ann where label = 'A1') || ':%'),
  'manager_xall:zalo_bot,staff_x1:email,staff_x1:zalo_bot',
  'A1 goes to every destination of a consenting recipient, none to staff without the notifications consent and none to a destination narrowed to another store'
);
select is(
  (select string_agg(distinct o.kind || ':' || o.template_ref || ':' || o.message_class || ':' || o.status || ':' || o.severity || ':' || (o.title is null) || ':' || (o.body is null), ',')
   from public.outbound_messages o where o.kind = 'announcement' and o.tenant_id = (select tenant_x from fx)),
  'announcement:announcement.v1:operational:queued:info:true:true',
  'announcement messages are queued operational messages of template announcement.v1 with no title and no body'
);
select is(
  (select string_agg(distinct (select string_agg(k, ',' order by k) from jsonb_object_keys(o.params) as k), '|')
   from public.outbound_messages o where o.kind = 'announcement' and o.tenant_id = (select tenant_x from fx)),
  'all_stores,announcement_id,pinned,store_count',
  'their parameters are count-only: the announcement id, whether pinned, every store, the store count'
);
select is(
  (select count(*)::integer from public.outbound_messages o
   where o.tenant_id = (select tenant_x from fx)
     and (coalesce(o.params::text, '') || coalesce(o.title, '') || coalesce(o.body, '') || o.recipient_ref) ~ '(vệ sinh|Thực đơn|Họp|lau kho|giờ)'),
  0,
  'no title or body text reaches the outbox'
);
select is(
  (select string_agg(distinct o.recipient_ref ~ '^channel:[0-9a-f-]{36}$' || ':' || (o.store_id is not distinct from fx.store_x1) || ':' || o.purpose::text, ',')
   from public.outbound_messages o, fx where o.dedupe_key like 'announcement:' || (select id from ann where label = 'A1') || ':%'),
  'true:true:notifications',
  'recipients are opaque channel references under the notifications purpose, and a one-store notice names its store'
);
select is(
  (select d.decision from public.outbound_messages o cross join lateral app.message_decision(o.id, ((now() at time zone 'Asia/Ho_Chi_Minh')::date + time '12:00') at time zone 'Asia/Ho_Chi_Minh') d
   where o.dedupe_key like 'announcement:' || (select id from ann where label = 'A2') || ':%' and o.channel_id in (select c.id from public.notification_channels c where c.label = 'staff x2 bot')),
  'send',
  'the dispatcher''s send decision accepts an announcement message inside the window (12:00 in Hồ Chí Minh)'
);

select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '42501', 'staff do not publish');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L, %L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx), (select store_x2 from fx))), '42501', 'a store-limited manager does not publish to a store outside the scope');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B')::text $q$, (select tenant_x from fx))), '42501', 'nor to every store');
select is(pg_temp.call_as((select owner_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B')::text $q$, (select tenant_x from fx))), '42501', 'a store-limited owner does not publish to every store either');
select is(pg_temp.call_as((select viewer_x from fx), format($q$ select public.publish_announcement(%L, 'T', 'B')::text $q$, (select tenant_x from fx))), '42501', 'a viewer does not publish');
select is(pg_temp.call_as((select publisher_x from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '42501', 'the publisher does not publish');
select is(pg_temp.call_as((select owner_y from fx), format($q$ select public.publish_announcement(%L, 'T', 'B')::text $q$, (select tenant_x from fx))), '42501', 'another tenant''s owner does not publish here');
select is(pg_temp.call_as((select owner_y from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[])::text $q$, (select tenant_y from fx), (select store_x1 from fx))), '42501', 'a store of another tenant is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L, %L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx), (select store_x1 from fx))), '22023', 'a store listed twice is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[]::uuid[])::text $q$, (select tenant_x from fx))), '22023', 'an empty store list is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, '  ', 'B', array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a blank title is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, repeat('t', 121), 'B', array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a title over 120 characters is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', repeat('b', 4001), array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a body over 4000 characters is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B' || chr(7), array[%L]::uuid[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a body with a control character is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[], array['viewer']::public.tenant_role[])::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'an audience outside owner, manager and staff is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[], p_pinned_until => now() - interval '1 hour')::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a pin that already ended is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.publish_announcement(%L, 'T', 'B', array[%L]::uuid[], p_pinned_until => now() + interval '5 days', p_expires_at => now() + interval '2 days')::text $q$, (select tenant_x from fx), (select store_x1 from fx))), '22023', 'a pin past the expiry is refused');
select is(
  (select count(*)::integer from public.announcements a where a.tenant_id in ((select tenant_x from fx), (select tenant_y from fx))),
  3,
  'no refused call left an announcement behind'
);

insert into public.announcements (tenant_id, store_ids, title, body, pinned_until, published_at, expires_at, created_by)
select tenant_x, array[store_x1], 'Ghim cũ', 'Ghim còn hiệu lực.', now() + interval '2 days', now() - interval '2 days', null::timestamptz, manager_x1 from fx
union all
select tenant_x, null, 'Tin cũ', 'Ghim đã hết.', now() - interval '1 day', now() - interval '3 days', null, owner_x from fx
union all
select tenant_x, array[store_x1], 'Hết hạn', 'Đã hết hạn.', null, now() - interval '5 days', now() - interval '1 day', manager_x1 from fx;
insert into ann (label, id)
select case a.title when 'Ghim cũ' then 'B_pinned' when 'Tin cũ' then 'C_old' else 'D_expired' end, a.id
from public.announcements a
where a.tenant_id = (select tenant_x from fx) and a.title in ('Ghim cũ', 'Tin cũ', 'Hết hạn');

select throws_ok(
  $q$ update public.announcements set title = 'Đổi tiêu đề' where title = 'Ghim cũ' $q$,
  '55000', null,
  'a published announcement keeps its text, stores, audience and times, for every writer'
);
select throws_ok(
  $q$ update public.announcements set expires_at = published_at + interval '1 day' where title = 'Hết hạn' $q$,
  '55000', null,
  'its expiry is fixed at publication'
);
select throws_ok(
  $q$ insert into public.announcements (tenant_id, store_ids, title, body) select tenant_x, array[store_y1], 'T', 'B' from fx $q$,
  '23503', null,
  'an announcement cannot name a store of another tenant'
);
select throws_ok(
  $q$ insert into public.announcements (tenant_id, store_ids, title, body, audience) select tenant_x, null, 'T', 'B', array['publisher']::public.tenant_role[] from fx $q$,
  '23514', null,
  'the audience check holds for every writer'
);

set local role authenticated;

select is(pg_temp.visible_as((select owner_x from fx), 'announcements'), 'A1,A2,A3,B_pinned,C_old,D_expired', 'an unlimited owner reads every announcement of the tenant');
select is(pg_temp.visible_as((select manager_xall from fx), 'announcements'), 'A1,A2,A3,B_pinned,C_old,D_expired', 'an unlimited manager too');
select is(pg_temp.visible_as((select owner_x1 from fx), 'announcements'), 'A1,A2,B_pinned,C_old,D_expired', 'a store-limited owner reads those of their store and the every-store ones');
select is(pg_temp.visible_as((select manager_x1 from fx), 'announcements'), 'A1,A2,B_pinned,C_old,D_expired', 'a manager of X1 does not read the X2 managers'' notice');
select is(pg_temp.visible_as((select manager_x2 from fx), 'announcements'), 'A2,A3,C_old', 'a manager of X2 reads the X2 and every-store notices');
select is(pg_temp.visible_as((select staff_x1 from fx), 'announcements'), 'A1,A2,B_pinned,C_old,D_expired', 'staff of X1 read their store''s and the every-store notices');
select is(pg_temp.visible_as((select staff_x2 from fx), 'announcements'), 'A2,C_old', 'staff of X2 read no X1 notice');
select is(pg_temp.visible_as((select staff_xall from fx), 'announcements'), 'A1,A2,B_pinned,C_old,D_expired', 'staff of every store read every notice addressed to staff, never a managers-only one');
select is(
  array[pg_temp.visible_as((select viewer_x from fx), 'announcements'), pg_temp.visible_as((select publisher_x from fx), 'announcements'), pg_temp.visible_as((select no_member from fx), 'announcements')],
  array['-', '-', '-'],
  'viewers, the publisher and a login without membership read no announcement'
);
select is(
  array[pg_temp.visible_as((select owner_y from fx), 'announcements'), pg_temp.visible_as((select staff_y1 from fx), 'announcements')],
  array['-', '-'],
  'no announcement crosses tenants'
);
select is(pg_temp.feed_as((select staff_x1 from fx), (select store_x1 from fx)), 'A1*,B_pinned*,A2,C_old', 'the feed puts pinned notices first until their pin ends, newest first, and hides expired ones');
select is(pg_temp.feed_as((select staff_x2 from fx)), 'A2,C_old', 'staff of X2 get the every-store notices only');
select is(pg_temp.feed_as((select staff_x1 from fx), (select store_x1 from fx), true), 'A1*,B_pinned*,A2,C_old,D_expired', 'expired notices come back only when asked for');
select is(pg_temp.visible_as((select staff_x1 from fx), 'announcement_recipients'), 'A1:staff_x1,A2:staff_x1', 'staff read only their own recipient rows');
select is(pg_temp.visible_as((select manager_x1 from fx), 'announcement_recipients'), 'A1:manager_xall,A1:staff_x1,A1:staff_x1b,A1:staff_xall,A2:staff_x1,A2:staff_x1b,A2:staff_xall', 'a store-limited manager reads the recipients at their own store, not those of another store');
select is(pg_temp.visible_as((select manager_x2 from fx), 'announcement_recipients'), 'A2:staff_x2,A2:staff_xall,A3:manager_x2,A3:manager_xall', 'the manager of X2 reads the recipients at X2');
select is(
  array[pg_temp.visible_as((select viewer_x from fx), 'announcement_recipients'), pg_temp.visible_as((select owner_y from fx), 'announcement_recipients'), pg_temp.visible_as((select no_member from fx), 'announcement_recipients')],
  array['-', '-', '-'],
  'viewers, other tenants and logins without membership read no recipient'
);

select is((pg_temp.call_as((select staff_x1 from fx), format($q$ select public.mark_announcement_read(%L)::text $q$, (select id from ann where label = 'A1')))::jsonb ->> 'recipient'), 'true', 'Đã đọc records the reader''s receipt as a recipient');
select is(
  pg_temp.call_as((select staff_x1 from fx), format($q$ select (public.mark_announcement_read(%L) ->> 'read_at')::timestamptz = (select r.read_at from public.announcement_receipts r where r.announcement_id = %L and r.created_by = auth.uid()) $q$, (select id from ann where label = 'A1'), (select id from ann where label = 'A1'))),
  'true',
  'a second tap keeps the first receipt and returns its time'
);
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select count(*)::text from public.announcement_receipts r where r.announcement_id = %L $q$, (select id from ann where label = 'A1'))), '1', 'one receipt per reader, however often they tap');
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.mark_announcement_read(%L)::text $q$, (select id from ann where label = 'A3'))), '42501', 'nobody marks a notice they may not read');
select is(pg_temp.call_as((select staff_y1 from fx), format($q$ select public.mark_announcement_read(%L)::text $q$, (select id from ann where label = 'A1'))), '42501', 'nor one of another tenant');
select is(pg_temp.call_as((select viewer_x from fx), format($q$ select public.mark_announcement_read(%L)::text $q$, (select id from ann where label = 'A2'))), '42501', 'a viewer records no receipt');
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format($q$ insert into public.announcement_receipts (tenant_id, announcement_id, created_by) values (%L, %L, %L) $q$, (select tenant_x from fx), (select id from ann where label = 'A2'), (select staff_x1b from fx))),
  '42501',
  'a member cannot write a receipt directly, for themselves or anyone else'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.announcement_receipts set read_at = now() - interval '1 day' $q$),
  '42501',
  'nor move a receipt''s time'
);
select is(pg_temp.visible_as((select staff_x1b from fx), 'announcement_receipts'), '-', 'staff do not read other members'' receipts');
select is(pg_temp.visible_as((select manager_x1 from fx), 'announcement_receipts'), 'A1:staff_x1', 'the manager of the store reads them');

select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select count(*)::text from public.announcement_read_rate(%L) $q$, (select id from ann where label = 'A1'))), '42501', 'staff get no read rate');
select is(pg_temp.call_as((select manager_x2 from fx), format($q$ select count(*)::text from public.announcement_read_rate(%L) $q$, (select id from ann where label = 'A1'))), '42501', 'nor a manager who cannot read the notice');
select is(pg_temp.call_as((select owner_y from fx), format($q$ select count(*)::text from public.announcement_read_rate(%L) $q$, (select id from ann where label = 'A1'))), '42501', 'nor another tenant''s owner');

reset role;

insert into public.announcement_receipts (tenant_id, announcement_id, store_ids, read_at, created_by)
select tenant_x, (select id from ann where label = 'A1'), array[store_x1], now() + interval '25 hours', staff_x1b from fx;
select throws_ok(
  $q$ update public.announcement_receipts set read_at = now() where created_by = 'eeeeeeee-eeee-4eee-8eee-000000005507' $q$,
  '55000', null,
  'a receipt never changes, for every writer'
);
select throws_ok(
  $q$ insert into public.announcement_receipts (tenant_id, announcement_id, store_ids, created_by) select tenant_x, (select id from ann where label = 'A1'), array[store_x1], staff_x1 from fx $q$,
  '23505', null,
  'a second receipt of the same reader is refused, for every writer'
);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_x, staff_late, 'staff', array[store_x1] from fx;
select is((pg_temp.call_as((select staff_late from fx), format($q$ select public.mark_announcement_read(%L)::text $q$, (select id from ann where label = 'A1')))::jsonb ->> 'recipient'), 'false', 'a member who joined after publication reads it too, recorded as a reader who was not a recipient');
delete from public.tenant_members where user_id = (select staff_x1b from fx);
select is((select count(*)::integer from public.announcement_recipients r where r.announcement_id = (select id from ann where label = 'A1')), 4, 'a member who leaves stays among the recipients, so the denominator holds');

set local role authenticated;

select is(
  pg_temp.call_as((select owner_x from fx), format($q$ select row(r.recipients, r.readers, r.readers_within_24h, r.read_rate, r.read_rate_24h)::text from public.announcement_read_rate(%L) r $q$, (select id from ann where label = 'A1'))),
  '(4,2,1,0.5000,0.2500)',
  'the read rate counts the recipients who read, and those within 24 hours of publication, over the fixed recipients; a late joiner does not count'
);
select is(
  pg_temp.call_as((select manager_x1 from fx), format($q$ select row(r.recipients, r.readers, r.read_rate)::text from public.announcement_read_rate(%L) r $q$, (select id from ann where label = 'A2'))),
  '(3,0,0.0000)',
  'a store-limited manager gets the rate over their own staff'
);
select is(
  pg_temp.call_as((select manager_x1 from fx), format($q$ select string_agg(pg_temp.person(r.user_id) || ':' || coalesce(r.display_name, '-') || ':' || (r.read_at is not null) || ':' || r.member, ',' order by pg_temp.person(r.user_id)) from public.announcement_readers(%L) r $q$, (select id from ann where label = 'A2'))),
  'staff_x1:Nhân viên Một:false:true,staff_x1b:Nhân viên Hai:false:false,staff_xall:-:false:true',
  'the readers list shows a store-limited manager only their own staff, with names they may read and who has left'
);
select is(
  pg_temp.call_as((select owner_x from fx), format($q$ select string_agg(pg_temp.person(r.user_id) || ':' || (r.read_at is not null), ',' order by r.read_at is not null, pg_temp.person(r.user_id)) from public.announcement_readers(%L) r $q$, (select id from ann where label = 'A1'))),
  'manager_xall:false,staff_xall:false,staff_x1:true,staff_x1b:true',
  'the owner sees every recipient, unread first'
);
select is(pg_temp.call_as((select staff_xall from fx), format($q$ select count(*)::text from public.announcement_readers(%L) $q$, (select id from ann where label = 'A2'))), '42501', 'staff get no readers list');

select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.set_announcement_pin(%L, null)::text $q$, (select id from ann where label = 'A1'))), '42501', 'staff do not pin or unpin');
select is(pg_temp.call_as((select manager_x2 from fx), format($q$ select public.set_announcement_pin(%L, null)::text $q$, (select id from ann where label = 'A1'))), '42501', 'nor a manager of another store');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.set_announcement_pin(%L, now() + interval '11 days')::text $q$, (select id from ann where label = 'A1'))), '22023', 'a pin past the expiry is refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.set_announcement_pin(%L, now() - interval '1 minute')::text $q$, (select id from ann where label = 'A1'))), '22023', 'a pin in the past is refused');
select is((pg_temp.call_as((select manager_x1 from fx), format($q$ select public.set_announcement_pin(%L, null)::text $q$, (select id from ann where label = 'A1')))::jsonb ->> 'pinned'), 'false', 'a manager of the store unpins it');
select matches(pg_temp.feed_as((select staff_x1 from fx), (select store_x1 from fx)), '^B_pinned[*],(A1,A2|A2,A1),C_old$', 'unpinned, it takes its place by date');
select is((pg_temp.call_as((select manager_xall from fx), format($q$ select public.set_announcement_pin(%L, now() + interval '1 day')::text $q$, (select id from ann where label = 'A2')))::jsonb ->> 'pinned'), 'true', 'an unlimited manager pins an every-store notice');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.set_announcement_pin(%L, null)::text $q$, (select id from ann where label = 'A2'))), '42501', 'a store-limited manager does not unpin an every-store notice');
select is(pg_temp.feed_as((select staff_x1 from fx), (select store_x1 from fx)), 'A2*,B_pinned*,A1,C_old', 'pinned notices stay first');

select is(
  pg_temp.call_as((select staff_x1 from fx), format($q$ select string_agg(k.key || ':' || k.active || ':' || k.tenant_row, ',' order by k.sort_order) from public.approval_request_kinds_of(%L) k $q$, (select tenant_x from fx))),
  'mua_hang:true:false,chenh_lech_tien:true:false,ngoai_le_checklist:true:false,khac:true:false',
  'a tenant without its own kinds gets the defaults'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format($q$ insert into public.approval_request_kinds (tenant_id, key, label, sort_order, active) values (%L, 'khac', 'Việc khác', 90, false) $q$, (select tenant_x from fx))),
  'rows:1',
  'an owner with every store overrides a default kind'
);
select is(
  pg_temp.outcome_as((select manager_xall from fx), format($q$ insert into public.approval_request_kinds (tenant_id, key, label) values (%L, 'dung_cu', 'Dụng cụ') $q$, (select tenant_x from fx))),
  '42501',
  'a manager does not'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), $q$ update public.approval_request_kinds set label = 'Mua sắm' where key = 'mua_hang' and tenant_id is null $q$),
  'rows:0',
  'nobody changes the global defaults'
);
select is(
  pg_temp.call_as((select staff_x1 from fx), format($q$ select string_agg(k.key || ':' || k.active || ':' || k.tenant_row, ',' order by k.sort_order) from public.approval_request_kinds_of(%L) k $q$, (select tenant_x from fx))),
  'mua_hang:true:false,chenh_lech_tien:true:false,ngoai_le_checklist:true:false,khac:false:true',
  'the tenant''s row replaces the default of its key'
);

reset role;

insert into req (label, id, result)
select 'R1', (r ->> 'request_id')::uuid, r
from (select pg_temp.call_as(fx.staff_x1, format($q$ select public.submit_request(%L, 'mua_hang', 'Cần mua thêm ly giấy cho ca tối.')::text $q$, fx.store_x1))::jsonb as r from fx) p;
insert into req (label, id, result)
select 'R2', (r ->> 'request_id')::uuid, r
from (select pg_temp.call_as(fx.manager_x1, format($q$ select public.submit_request(%L, 'chenh_lech_tien', 'Két thiếu tiền lẻ, xin giải trình.')::text $q$, fx.store_x1))::jsonb as r from fx) p;
insert into req (label, id, result)
select 'R3', (r ->> 'request_id')::uuid, r
from (select pg_temp.call_as(fx.staff_x2, format($q$ select public.submit_request(%L, 'ngoai_le_checklist', 'Máy rửa ly hỏng, xin bỏ mục rửa ly hôm nay.')::text $q$, fx.store_x2))::jsonb as r from fx) p;

set local role authenticated;

select is(
  (select array_agg(r.label || ':' || (r.result ->> 'status') order by r.label) from req r),
  array['R1:pending', 'R2:pending', 'R3:pending'],
  'staff and managers submit requests that start pending'
);
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.submit_request(%L, 'mua_hang', 'X')::text $q$, (select store_x2 from fx))), '42501', 'a request goes only to a store of the caller''s scope');
select is(pg_temp.call_as((select viewer_x from fx), format($q$ select public.submit_request(%L, 'mua_hang', 'X')::text $q$, (select store_x1 from fx))), '42501', 'a viewer sends no request');
select is(pg_temp.call_as((select staff_y1 from fx), format($q$ select public.submit_request(%L, 'mua_hang', 'X')::text $q$, (select store_x1 from fx))), '42501', 'nor does another tenant''s staff');
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.submit_request(%L, 'nghi_phep', 'X')::text $q$, (select store_x1 from fx))), '22023', 'an unknown kind is refused: leave stays with the HR product');
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.submit_request(%L, 'khac', 'X')::text $q$, (select store_x1 from fx))), '22023', 'a kind the tenant retired is refused');
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.submit_request(%L, 'mua_hang', '   ')::text $q$, (select store_x1 from fx))), '23514', 'empty details are refused');
select is(pg_temp.call_as((select staff_x1 from fx), format($q$ select public.submit_request(%L, 'mua_hang', repeat('x', 1001))::text $q$, (select store_x1 from fx))), '23514', 'details over 1000 characters are refused');
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format($q$ insert into public.approval_requests (tenant_id, store_id, kind_key, details, status) values (%L, %L, 'mua_hang', 'X', 'approved') $q$, (select tenant_x from fx), (select store_x1 from fx))),
  '42501',
  'nobody inserts a decided request'
);
select is(pg_temp.visible_as((select staff_x1 from fx), 'approval_requests'), 'R1', 'staff read their own requests only');
select is(pg_temp.visible_as((select staff_late from fx), 'approval_requests'), '-', 'not a colleague''s');
select is(pg_temp.visible_as((select manager_x1 from fx), 'approval_requests'), 'R1,R2', 'a manager reads the requests of their store');
select is(pg_temp.visible_as((select manager_x2 from fx), 'approval_requests'), 'R3', 'and only of their store');
select is(pg_temp.visible_as((select owner_x from fx), 'approval_requests'), 'R1,R2,R3', 'an unlimited owner reads every request');
select is(
  array[pg_temp.visible_as((select viewer_x from fx), 'approval_requests'), pg_temp.visible_as((select owner_y from fx), 'approval_requests'), pg_temp.visible_as((select no_member from fx), 'approval_requests')],
  array['-', '-', '-'],
  'viewers, other tenants and logins without membership read no request'
);
select is(pg_temp.call_as((select manager_x1 from fx), $q$ select string_agg(pg_temp.label_of(q.request_id) || ':' || q.kind_label || ':' || coalesce(q.requester_name, '-'), ',' order by q.requested_at, q.request_id) from public.approval_queue() q $q$), 'R1:Mua hàng cho cửa hàng:Nhân viên Một', 'the manager''s queue holds the pending requests of their store without their own');
select is(pg_temp.call_as((select manager_xall from fx), $q$ select string_agg(pg_temp.label_of(q.request_id), ',' order by pg_temp.label_of(q.request_id)) from public.approval_queue() q $q$), 'R1,R2,R3', 'an unlimited manager queues every store''s requests, including the other manager''s');
select is(pg_temp.call_as((select manager_xall from fx), format($q$ select string_agg(pg_temp.label_of(q.request_id), ',') from public.approval_queue(%L) q $q$, (select store_x2 from fx))), 'R3', 'the queue narrows to one store');
select is(pg_temp.call_as((select staff_x1 from fx), $q$ select count(*)::text from public.approval_queue() $q$), '0', 'staff have no queue');

select is(pg_temp.call_as((select staff_late from fx), format($q$ select public.decide_request(%L, 'approved')::text $q$, (select id from req where label = 'R1'))), '42501', 'staff do not decide');
select is(pg_temp.call_as((select manager_x2 from fx), format($q$ select public.decide_request(%L, 'approved')::text $q$, (select id from req where label = 'R1'))), '42501', 'nor a manager of another store');
select is(pg_temp.call_as((select owner_y from fx), format($q$ select public.decide_request(%L, 'approved')::text $q$, (select id from req where label = 'R1'))), '42501', 'nor another tenant''s owner');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.decide_request(%L, 'approved')::text $q$, (select id from req where label = 'R2'))), '42501', 'nobody decides their own request');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.decide_request(%L, 'maybe')::text $q$, (select id from req where label = 'R1'))), '22023', 'a decision is approved or refused');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.decide_request(%L, 'refused')::text $q$, (select id from req where label = 'R1'))), '22023', 'a refusal needs a reason');
select is(pg_temp.call_as((select manager_x1 from fx), format($q$ select public.decide_request(%L, 'approved', 'Đồng ý')::text $q$, (select id from req where label = 'R1'))), '22023', 'an approval takes no reason');
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format($q$ update public.approval_requests set status = 'approved' where id = %L $q$, (select id from req where label = 'R1'))),
  '42501',
  'a manager cannot change a status directly'
);
select is(
  (pg_temp.call_as((select manager_x1 from fx), format($q$ select public.decide_request(%L, 'approved')::text $q$, (select id from req where label = 'R1')))::jsonb - 'decided_at' - 'request_id' - 'decided_by'),
  '{"status": "approved", "messages": 2, "refusal_reason": null}'::jsonb,
  'a manager of the store approves from the queue; the requester''s two destinations get a message'
);
select is(pg_temp.call_as((select manager_xall from fx), format($q$ select public.decide_request(%L, 'refused', 'Muộn')::text $q$, (select id from req where label = 'R1'))), '55000', 'a decided request is decided once');
select is(
  pg_temp.call_as((select staff_x1 from fx), $q$ select string_agg(m.kind_label || ':' || m.status || ':' || (m.decided_at is not null) || ':' || coalesce(m.refusal_reason, '-'), ',') from public.my_requests() m $q$),
  'Mua hàng cho cửa hàng:approved:true:-',
  'the requester sees the approval in Yêu cầu của tôi'
);
select is(
  (pg_temp.call_as((select manager_xall from fx), format($q$ select public.decide_request(%L, 'refused', '  Tuần này đủ nhân lực rửa tay.  ')::text $q$, (select id from req where label = 'R3')))::jsonb ->> 'refusal_reason'),
  'Tuần này đủ nhân lực rửa tay.',
  'a refusal keeps its trimmed reason'
);
select is(
  pg_temp.call_as((select staff_x2 from fx), $q$ select string_agg(m.status || ':' || m.refusal_reason, ',') from public.my_requests() m $q$),
  'refused:Tuần này đủ nhân lực rửa tay.',
  'the requester sees the refusal and its reason'
);
select is(pg_temp.call_as((select manager_x1 from fx), $q$ select count(*)::text from public.approval_queue() $q$), '0', 'a decided request leaves the queue');
select is(pg_temp.call_as((select staff_x1 from fx), $q$ select count(*)::text from public.my_requests() $q$), '1', 'my_requests lists only the caller''s requests');

reset role;

select is(
  (select string_agg(o.kind || ':' || o.template_ref || ':' || (o.params ->> 'decision') || ':' || (o.params ->> 'kind_key') || ':' || (o.title is null) || ':' || (o.body is null), ',' order by o.params ->> 'decision', o.channel_id)
   from public.outbound_messages o where o.dedupe_key like 'request:%' and o.tenant_id = (select tenant_x from fx)),
  'request_decided:request_decided.v1:approved:mua_hang:true:true,request_decided:request_decided.v1:approved:mua_hang:true:true,request_decided:request_decided.v1:refused:ngoai_le_checklist:true:true',
  'each decision queues request_decided messages to the requester only, with the decision and kind key and no text'
);
select is(
  (select count(*)::integer from public.outbound_messages o
   where o.tenant_id = (select tenant_x from fx)
     and (coalesce(o.params::text, '') || coalesce(o.title, '') || coalesce(o.body, '')) ~ '(ly giấy|giải trình|rửa|nhân lực)'),
  0,
  'neither details nor a refusal reason reaches the outbox'
);
select is(
  (select count(*)::integer from public.outbound_messages o where o.params ->> 'announcement_id' = (select id from ann where label = 'A2')::text),
  4,
  'pinning and unpinning send nothing: A2 keeps its four messages'
);
select is(
  (select string_agg(distinct (select string_agg(k, ',' order by k) from jsonb_object_keys(o.params) as k), '|') from public.outbound_messages o where o.kind = 'request_decided' and o.tenant_id = (select tenant_x from fx)),
  'decision,kind_key,request_id',
  'decision messages carry count-only parameters'
);
select throws_ok(
  $q$ update public.approval_requests set status = 'refused', refusal_reason = 'X' where details like 'Cần mua%' $q$,
  '55000', null,
  'a decided request stays as decided, for every writer'
);
select throws_ok(
  $q$ update public.approval_requests set status = 'approved', decided_by = created_by, decided_at = now() where details like 'Két thiếu%' $q$,
  '42501', null,
  'a decision by the requester is refused for every writer'
);
select throws_ok(
  $q$ update public.approval_requests set details = 'Khác' where details like 'Két thiếu%' $q$,
  '55000', null,
  'a request keeps its details'
);
select throws_ok(
  $q$ update public.approval_requests set status = 'refused', decided_by = 'eeeeeeee-eeee-4eee-8eee-000000005503', decided_at = now() where details like 'Két thiếu%' $q$,
  '23514', null,
  'a refusal without a reason is refused by the table'
);

set local role anon;
select throws_ok('select count(*) from public.announcements', '42501', null, 'anon reads no announcement');
select throws_ok('select count(*) from public.approval_requests', '42501', null, 'anon reads no request');
select throws_ok($q$ select public.mark_announcement_read('00000000-0000-0000-0000-000000000000') $q$, '42501', null, 'anon calls no announcement function');
select throws_ok($q$ select public.submit_request('00000000-0000-0000-0000-000000000000', 'mua_hang', 'X') $q$, '42501', null, 'anon sends no request');
reset role;

select * from finish();
rollback;
