begin;
select plan(141);

create temp table fx as
select
  '44444444-4444-4444-8444-000000000001'::uuid as tenant_a,
  '44444444-4444-4444-8444-000000000002'::uuid as tenant_b,
  '55555555-5555-4555-8555-000000000001'::uuid as owner_a,
  '55555555-5555-4555-8555-000000000002'::uuid as manager_a,
  '55555555-5555-4555-8555-000000000003'::uuid as linker_a,
  '55555555-5555-4555-8555-000000000004'::uuid as waiter_a,
  '55555555-5555-4555-8555-000000000005'::uuid as mailer_a,
  '55555555-5555-4555-8555-000000000006'::uuid as guesser_a,
  '55555555-5555-4555-8555-000000000007'::uuid as owner_b,
  '66666666-6666-4666-8666-000000000001'::uuid as account_a,
  '66666666-6666-4666-8666-000000000002'::uuid as account_b,
  '77777777-7777-4777-8777-000000000001'::uuid as store_a1,
  '77777777-7777-4777-8777-000000000002'::uuid as store_b1;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx
cross join lateral (
  values
    (fx.owner_a, 'notify-owner-a@example.com'),
    (fx.manager_a, 'notify-manager-a@example.com'),
    (fx.linker_a, 'notify-linker-a@example.com'),
    (fx.waiter_a, 'notify-waiter-a@example.com'),
    (fx.mailer_a, 'notify-mailer-a@example.com'),
    (fx.guesser_a, 'notify-guesser-a@example.com'),
    (fx.owner_b, 'notify-owner-b@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_a, 'notify-it-pgtap-a', 'Notify pgTAP A', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_b, 'notify-it-pgtap-b', 'Notify pgTAP B', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, null::uuid[]
from fx
cross join lateral (
  values (fx.owner_a, 'owner'), (fx.manager_a, 'manager'), (fx.linker_a, 'manager'), (fx.waiter_a, 'manager'), (fx.mailer_a, 'manager'), (fx.guesser_a, 'manager')
) as m (user_id, role)
union all
select tenant_b, owner_b, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'notify-pgtap-account-a', 'Synthetic account A' from fx
union all
select account_b, tenant_b, 'mock', 'notify-pgtap-account-b', 'Synthetic account B' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'notify-pgtap-store-a1', 'Synthetic store A1' from fx
union all
select store_b1, tenant_b, account_b, 'notify-pgtap-store-b1', 'Synthetic store B1' from fx;

create temp table consent_ids as
select
  app.ensure_notifications_consent(tenant_a, owner_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_a,
  app.ensure_notifications_consent(tenant_a, manager_a, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as manager_a,
  app.ensure_notifications_consent(tenant_b, owner_b, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00') as owner_b
from fx;

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select v.id::uuid, case when v.member = 'owner_b' then fx.tenant_b else fx.tenant_a end, v.kind::public.channel_kind, v.provider, v.label,
       case v.member when 'owner_a' then fx.owner_a when 'manager_a' then fx.manager_a when 'owner_b' then fx.owner_b end,
       v.address, v.secret_name, 'active', '2026-11-01 00:00+00'::timestamptz,
       case v.member when 'owner_a' then c.owner_a when 'manager_a' then c.manager_a when 'owner_b' then c.owner_b end
from fx
cross join consent_ids c
cross join (
  values
    ('88888888-8888-4888-8888-000000000001', 'zalo_bot', 'zalo_bot', 'main', 'owner_a', 'synthetic-chat-1', 'NOTIFY_ZALO_BOT_TOKEN_IT'),
    ('88888888-8888-4888-8888-000000000002', 'email', 'resend', 'idempotent mail', 'owner_a', null, 'NOTIFY_EMAIL_API_KEY_IT'),
    ('88888888-8888-4888-8888-000000000003', 'zalo_bot', 'zalo_bot', 'manager', 'manager_a', 'synthetic-chat-3', 'NOTIFY_ZALO_BOT_TOKEN_IT'),
    ('88888888-8888-4888-8888-000000000004', 'zalo_bot', 'zalo_bot', 'other tenant', 'owner_b', 'synthetic-chat-4', 'NOTIFY_ZALO_BOT_TOKEN_IT'),
    ('88888888-8888-4888-8888-000000000005', 'zalo_bot', 'zalo_bot', 'second bot', 'owner_a', 'synthetic-chat-5', 'NOTIFY_ZALO_BOT_TOKEN_IT2'),
    ('88888888-8888-4888-8888-000000000006', 'zalo_bot', 'zalo_bot', 'destination failure', 'owner_a', 'synthetic-chat-6', 'NOTIFY_ZALO_BOT_TOKEN_IT3'),
    ('88888888-8888-4888-8888-000000000007', 'zalo_bot', 'zalo_bot', 'channel failure', 'owner_a', 'synthetic-chat-7', 'NOTIFY_ZALO_BOT_TOKEN_IT4'),
    ('88888888-8888-4888-8888-000000000008', 'telegram', 'telegram', 'blocked', 'owner_a', 'synthetic-chat-8', 'NOTIFY_TELEGRAM_BOT_TOKEN_IT'),
    ('88888888-8888-4888-8888-000000000009', 'zalo_bot', 'zalo_bot', 'vanishing', 'owner_a', 'synthetic-chat-9', 'NOTIFY_ZALO_BOT_TOKEN_IT5'),
    ('88888888-8888-4888-8888-000000000010', 'zalo_bot', 'zalo_bot', 'exhaustion', 'owner_a', 'synthetic-chat-10', 'NOTIFY_ZALO_BOT_TOKEN_IT6'),
    ('88888888-8888-4888-8888-000000000011', 'zalo_bot', 'zalo_bot', 'recovery', 'owner_a', 'synthetic-chat-11', 'NOTIFY_ZALO_BOT_TOKEN_IT7'),
    ('88888888-8888-4888-8888-000000000012', 'zalo_bot', 'zalo_bot', 'housekeeping', 'owner_a', 'synthetic-chat-12', 'NOTIFY_ZALO_BOT_TOKEN_IT8')
) as v (id, kind, provider, label, member, address, secret_name);

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, secret_name)
select v.id::uuid, fx.tenant_a, v.kind::public.channel_kind, v.provider, v.label, v.user_id, v.secret_name
from fx
cross join lateral (
  values
    ('88888888-8888-4888-8888-000000000021', 'zalo_bot', 'zalo_bot', 'link and accept', fx.linker_a, 'NOTIFY_ZALO_BOT_TOKEN_IT9'),
    ('88888888-8888-4888-8888-000000000022', 'zalo_bot', 'zalo_bot', 'link without acceptance', fx.waiter_a, 'NOTIFY_ZALO_BOT_TOKEN_IT9'),
    ('88888888-8888-4888-8888-000000000023', 'email', 'brevo', 'e-mail code', fx.mailer_a, 'NOTIFY_EMAIL_API_KEY_IT'),
    ('88888888-8888-4888-8888-000000000024', 'email', 'brevo', 'wrong codes', fx.guesser_a, 'NOTIFY_EMAIL_API_KEY_IT')
) as v (id, kind, provider, label, user_id, secret_name);

create function pg_temp.enqueue(p_channel_id uuid, p_kind text, p_key text, p_at timestamptz, p_body text default null, p_expires_at timestamptz default null)
returns uuid
language sql
as $$
  select app.enqueue_message(c.tenant_id, c.id, p_kind, p_kind || '.v1', p_key, '{"count": 1}'::jsonb, null, p_body, 'warning', null, null, null, null, p_expires_at, p_at)
  from public.notification_channels c
  where c.id = p_channel_id;
$$;

create function pg_temp.message(p_key text)
returns public.outbound_messages
language sql
as $$
  select o.* from public.outbound_messages o where o.dedupe_key = p_key;
$$;

create function pg_temp.clear(p_tenant_id uuid)
returns void
language sql
as $$
  update public.outbound_messages o
  set status = 'cancelled', decision = 'expired'
  where o.tenant_id = p_tenant_id and o.status in ('queued', 'held');
$$;

create function pg_temp.claim(p_secret text, p_at timestamptz, p_tenant_id uuid default null)
returns uuid
language sql
as $$
  select c.message_id
  from app.claim_next_message('pgtap', array[p_secret], interval '2 minutes', p_at, coalesce(p_tenant_id, (select tenant_a from fx))) c;
$$;

create function pg_temp.send_once(p_key text, p_outcome text, p_scope text, p_code text, p_at timestamptz, p_idempotent boolean default false)
returns text
language plpgsql
as $$
declare
  claimed record;
begin
  select c.message_id, c.claimed_at, c.secret_name into claimed
  from public.outbound_messages o
  join public.notification_channels n on n.id = o.channel_id
  cross join lateral app.claim_next_message('pgtap', array[n.secret_name], interval '2 minutes', p_at, o.tenant_id) c
  where o.dedupe_key = p_key;
  if claimed.message_id is null then
    return 'not claimed';
  end if;
  perform app.begin_send(claimed.message_id, claimed.claimed_at, 'title', 'body of ' || p_key, null, p_at);
  return app.finish_send(claimed.message_id, claimed.claimed_at, p_outcome, p_scope, p_code, 'synthetic-provider-id', null, p_idempotent, p_at);
end;
$$;

create function pg_temp.exhaust(p_key text, p_from timestamptz)
returns text[]
language plpgsql
as $$
declare
  statuses text[] := '{}';
  attempt integer;
  claimed record;
begin
  for attempt in 1..5 loop
    select c.message_id, c.claimed_at into claimed
    from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT6'], interval '2 minutes', p_from + make_interval(days => attempt), (select tenant_a from fx)) c;
    perform app.begin_send(claimed.message_id, claimed.claimed_at, 'title', 'body', null, p_from + make_interval(days => attempt));
    statuses := statuses || app.finish_send(claimed.message_id, claimed.claimed_at, 'retry', null, 'http_500', null, null, false, p_from + make_interval(days => attempt));
  end loop;
  return statuses;
end;
$$;

grant select on fx, consent_ids to authenticated, service_role;

create temp table codes as
select
  app.issue_link_code('88888888-8888-4888-8888-000000000021', 'bot_link', '2026-11-07 00:00+00') as linker,
  app.issue_link_code('88888888-8888-4888-8888-000000000022', 'bot_link', '2026-11-07 00:00+00') as waiter,
  app.issue_link_code('88888888-8888-4888-8888-000000000023', 'email_confirm', '2026-11-07 02:00+00') as mailer,
  app.issue_link_code('88888888-8888-4888-8888-000000000024', 'email_confirm', '2026-11-07 02:00+00') as guesser;

select ok((select linker ~ '^FNB-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' from codes), 'a bot code is FNB- plus 8 characters of the unambiguous alphabet');
select ok((select mailer ~ '^[0-9]{6}$' from codes), 'an e-mail code is 6 digits');
select is(
  (select l.code_sha256 from app.notification_link_codes l where l.channel_id = '88888888-8888-4888-8888-000000000021'),
  (select app.sha256_hex('NOTIFY_ZALO_BOT_TOKEN_IT9:' || linker) from codes),
  'only the hash of secret name and code is stored'
);
select is((select count(*)::integer from app.notification_link_codes l where l.code_sha256 like '%' || (select linker from codes) || '%'), 0, 'the code itself is stored nowhere');

select is(app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', 'FNB-AAAAAAAA', 'synthetic-chat-99', '…t-99', '2026-11-07 00:01+00'), null::uuid, 'a wrong code links nothing');
select is(app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT', (select linker from codes), 'synthetic-chat-99', '…t-99', '2026-11-07 00:01+00'), null::uuid, 'a code sent to another bot links nothing');
select is(
  app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', '  ' || lower((select linker from codes)) || ' ', 'synthetic-chat-21', '…t-21', '2026-11-07 00:01+00'),
  '88888888-8888-4888-8888-000000000021'::uuid,
  'the code matches case-insensitively with spaces trimmed'
);
select is(
  (select row(status, address, address_hint)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000021'),
  row('pending', 'synthetic-chat-21', '…t-21')::text,
  'the chat id is stored and the destination stays pending'
);
select is(
  (select row(l.purpose, l.code_sha256)::text from app.notification_link_codes l where l.channel_id = '88888888-8888-4888-8888-000000000021'),
  row('bot_consent', app.sha256_hex('NOTIFY_ZALO_BOT_TOKEN_IT9:synthetic-chat-21'))::text,
  'the code is replaced by an acceptance keyed on the chat'
);
select is(
  (select string_agg(kind, ',') from public.outbound_messages where channel_id = '88888888-8888-4888-8888-000000000021'),
  'link_notice',
  'one link_notice is enqueued'
);
select is(app.accept_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', 'synthetic-chat-21', '2026-11-07 00:01:30+00'), null::uuid, 'an acceptance before the notice was sent is refused');

create temp table notice_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT9'], interval '2 minutes', '2026-11-07 00:02+00', (select tenant_a from fx));
select is((select kind from notice_claim), 'link_notice', 'the link notice is claimed for the pending destination');
select app.begin_send(message_id, claimed_at, null, 'notice text', null, '2026-11-07 00:02+00') from notice_claim;
select is((select app.finish_send(message_id, claimed_at, 'sent', null, null, 'synthetic-notice', null, false, '2026-11-07 00:02:10+00') from notice_claim), 'sent', 'the notice reaches the chat');
select is((select notice_sent_at from app.notification_link_codes where channel_id = '88888888-8888-4888-8888-000000000021'), '2026-11-07 00:02:10+00'::timestamptz, 'the acceptance records when the notice was sent');

select is(app.accept_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', 'synthetic-chat-99', '2026-11-07 00:03+00'), null::uuid, 'ĐỒNG Ý from another chat does nothing');
select is(app.accept_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', 'synthetic-chat-21', '2026-11-07 00:03+00'), '88888888-8888-4888-8888-000000000021'::uuid, 'ĐỒNG Ý from the linked chat accepts');
select is(
  (select row(status, linked_at)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000021'),
  row('active', '2026-11-07 00:03+00'::timestamptz)::text,
  'the destination becomes active'
);
select is(
  (select count(*)::integer from public.consent_records where subject_id = (select linker_a from fx) and purpose = 'notifications'),
  1,
  'exactly one notifications consent is recorded for the member'
);
select is(
  (select row(c.subject_type::text, c.policy_version, c.channel, c.evidence ->> 'method', c.evidence ->> 'notice_channel', c.evidence ->> 'notice_sent_at' is not null)::text
   from public.consent_records c where c.subject_id = (select linker_a from fx) and c.purpose = 'notifications'),
  row('staff', 'ops-notifications-v1', 'zalo_bot', 'bot_reply', 'bot_chat', true)::text,
  'the consent evidence names the reply in the bot chat after the notice'
);
select ok(
  (select c.evidence::text not like '%synthetic-chat%' from public.consent_records c where c.subject_id = (select linker_a from fx) and c.purpose = 'notifications'),
  'the evidence holds no chat id'
);
select is(
  (select consent_record_id from public.notification_channels where id = '88888888-8888-4888-8888-000000000021'),
  (select id from public.consent_records where subject_id = (select linker_a from fx) and purpose = 'notifications'),
  'the destination keeps its consent row'
);
select is(
  (select string_agg(kind || ':' || status, ',' order by created_at) from public.outbound_messages where channel_id = '88888888-8888-4888-8888-000000000021'),
  'link_notice:sent,link_confirmation:queued',
  'one link_confirmation follows the acceptance'
);
select is((select count(*)::integer from app.notification_link_codes where channel_id = '88888888-8888-4888-8888-000000000021'), 0, 'the acceptance row is gone');
select throws_ok(
  $$ select app.issue_link_code('88888888-8888-4888-8888-000000000021', 'bot_link', '2026-11-07 00:04+00') $$,
  '22023', null,
  'a code is issued only for a pending destination'
);

create temp table confirmation_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT9'], interval '2 minutes', '2026-11-07 00:04+00', (select tenant_a from fx));
select app.begin_send(message_id, claimed_at, null, 'confirmation text', null, '2026-11-07 00:04+00') from confirmation_claim;
select is((select app.finish_send(message_id, claimed_at, 'sent', null, null, 'synthetic-confirmation', null, false, '2026-11-07 00:04:10+00') from confirmation_claim), 'sent', 'the confirmation is sent to the accepted destination');

select is(
  app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', (select waiter from codes), 'synthetic-chat-22', '…t-22', '2026-11-07 00:05+00'),
  '88888888-8888-4888-8888-000000000022'::uuid,
  'a second member sends the code'
);
create temp table waiter_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT9'], interval '2 minutes', '2026-11-07 00:06+00', (select tenant_a from fx));
select app.begin_send(message_id, claimed_at, null, 'notice text', null, '2026-11-07 00:06+00') from waiter_claim;
select app.finish_send(message_id, claimed_at, 'sent', null, null, 'synthetic-notice-2', null, false, '2026-11-07 00:06:10+00') from waiter_claim;
select is((select status from public.notification_channels where id = '88888888-8888-4888-8888-000000000022'), 'pending', 'a code without acceptance leaves the destination pending');
select is(
  (select string_agg(kind || ':' || status, ',') from public.outbound_messages where channel_id = '88888888-8888-4888-8888-000000000022'),
  'link_notice:sent',
  'a code without acceptance sends only the link notice'
);
select is((select count(*)::integer from public.consent_records where subject_id = (select waiter_a from fx)), 0, 'a code without acceptance records no consent');

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, secret_name)
select '88888888-8888-4888-8888-000000000025', tenant_a, 'zalo_bot', 'zalo_bot', 'late code', guesser_a, 'NOTIFY_ZALO_BOT_TOKEN_IT9' from fx;
create temp table late_code as select app.issue_link_code('88888888-8888-4888-8888-000000000025', 'bot_link', '2026-11-07 01:00+00') as code;
select is(app.complete_channel_link('zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT9', (select code from late_code), 'synthetic-chat-25', '…t-25', '2026-11-07 01:15+00'), null::uuid, 'a code is refused once its 15 minutes passed');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000023', 'link_code', 'o28:mail-code', '2026-11-07 02:00+00', 'Mã xác nhận: ' || (select mailer from codes));
create temp table mail_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_EMAIL_API_KEY_IT'], interval '2 minutes', '2026-11-07 02:01+00', (select tenant_a from fx));
select is((select address from mail_claim), 'notify-mailer-a@example.com', 'an e-mail claim carries the member''s login address');
select app.begin_send(message_id, claimed_at, 'Mã xác nhận nhận bản tin', null, null, '2026-11-07 02:01+00') from mail_claim;
select app.finish_send(message_id, claimed_at, 'sent', null, null, 'synthetic-mail', null, false, '2026-11-07 02:01:10+00') from mail_claim;
select is(
  app.confirm_email_link('88888888-8888-4888-8888-000000000023', lpad((((select mailer from codes)::integer + 1) % 1000000)::text, 6, '0'), '2026-11-07 02:03+00'),
  false,
  'a wrong e-mail code is refused'
);
select is((select attempts from app.notification_link_codes where channel_id = '88888888-8888-4888-8888-000000000023'), 1::smallint, 'a wrong e-mail code is counted');
select is(app.confirm_email_link('88888888-8888-4888-8888-000000000023', (select mailer from codes), '2026-11-07 02:04+00'), true, 'the right e-mail code confirms');
select is(
  (select row(n.status, c.evidence ->> 'method', c.evidence ->> 'notice_channel', c.channel)::text
   from public.notification_channels n join public.consent_records c on c.id = n.consent_record_id
   where n.id = '88888888-8888-4888-8888-000000000023'),
  row('active', 'email_code', 'email', 'email')::text,
  'the e-mail destination is active with an email_code consent'
);
select is((select body from pg_temp.message('o28:mail-code')), null::text, 'no code stays in the log once it was used');
select is(
  (select count(*)::integer from public.outbound_messages where channel_id = '88888888-8888-4888-8888-000000000023' and kind = 'link_confirmation'),
  1,
  'the e-mail confirmation is enqueued'
);

create function pg_temp.guess_five()
returns integer
language plpgsql
as $$
declare
  refused integer := 0;
  attempt integer;
begin
  for attempt in 1..5 loop
    if not app.confirm_email_link('88888888-8888-4888-8888-000000000024', lpad((((select guesser from codes)::integer + attempt) % 1000000)::text, 6, '0'), '2026-11-07 02:05+00') then
      refused := refused + 1;
    end if;
  end loop;
  return refused;
end;
$$;
select is(pg_temp.guess_five(), 5, 'five wrong e-mail codes are refused');
select is((select count(*)::integer from public.notification_channels where id = '88888888-8888-4888-8888-000000000024'), 0, 'the fifth wrong code deletes the pending destination');

select app.notify_housekeeping('2026-11-07 12:00+00', (select tenant_a from fx));
select is((select count(*)::integer from public.notification_channels where id = '88888888-8888-4888-8888-000000000022'), 1, 'housekeeping keeps an unaccepted chat id within 24 hours');

select pg_temp.clear((select tenant_a from fx));

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:a', '2026-11-08 03:00+00');
select is(pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:a', '2026-11-08 03:10+00'), (select id from pg_temp.message('o28:a')), 'a repeated dedupe key returns the first message');
select is((select count(*)::integer from public.outbound_messages where dedupe_key = 'o28:a'), 1, 'a repeated dedupe key inserts nothing');
select is(
  (select row(m.channel, m.recipient_ref, m.subject_type::text, m.purpose::text, m.message_class::text, m.status, m.created_at, m.expires_at)::text from pg_temp.message('o28:a') m),
  row('zalo_bot', 'channel:88888888-8888-4888-8888-000000000001', 'staff', 'notifications', 'operational', 'queued', '2026-11-08 03:00+00'::timestamptz, '2026-11-09 03:00+00'::timestamptz)::text,
  'enqueue fills channel, recipient reference, subject, purpose, class and the default expiry'
);
select is((select row(subject_id, consent_record_id)::text from pg_temp.message('o28:a')), (select row(fx.owner_a, c.owner_a)::text from fx cross join consent_ids c), 'enqueue fills the member and the consent row');
select throws_ok(
  $$ select app.enqueue_message((select tenant_a from fx), '88888888-8888-4888-8888-000000000004', 'alert', 'alert.v1', 'o28:wrong-tenant', null, null, null, null, null, null, null, null, null, '2026-11-08 03:00+00') $$,
  '22023', null,
  'a destination of another tenant is refused'
);

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:b', '2026-11-08 03:01+00');
create temp table first_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 03:05+00', (select tenant_a from fx));
select is((select count(*)::integer from first_claim), 1, 'a claim returns at most one message');
select is(
  (select row(message_id, attempts, channel_kind::text, secret_name, address, tenant_name, reader_timezone, currency_code)::text from first_claim),
  row((select id from pg_temp.message('o28:a')), 1::smallint, 'zalo_bot', 'NOTIFY_ZALO_BOT_TOKEN_IT', 'synthetic-chat-1', 'Notify pgTAP A', 'Asia/Ho_Chi_Minh', 'VND')::text,
  'the oldest due message is claimed with what the adapter needs'
);
select is((select row(status, lease_until)::text from pg_temp.message('o28:a')), row('sending', '2026-11-08 03:07+00'::timestamptz)::text, 'the claimed message is sending under a lease');
select is((select status from pg_temp.message('o28:b')), 'queued', 'the next message stays queued');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000005', 'alert', 'o28:later', '2026-11-08 04:00+00');
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT2', '2026-11-08 03:30+00'), null::uuid, 'a message created after p_at is not due');
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT99', '2026-11-08 04:30+00'), null::uuid, 'a dispatcher without the destination''s secret claims nothing');
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT2', '2026-11-08 04:30+00'), (select id from pg_temp.message('o28:later')), 'a dispatcher holding the secret claims it');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000004', 'alert', 'o28:tenant-b', '2026-11-08 03:00+00');
create temp table b_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 05:00+00', (select tenant_a from fx));
select is((select message_id from b_claim), (select id from pg_temp.message('o28:b')), 'with the tenant filter, tenant A claims its own message');
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT', '2026-11-08 05:00+00'), null::uuid, 'with the tenant filter, another tenant''s message is not claimed');
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT', '2026-11-08 05:00+00', (select tenant_b from fx)), (select id from pg_temp.message('o28:tenant-b')), 'the other tenant claims it under its own filter');
select app.begin_send(message_id, claimed_at, null, 'b', null, '2026-11-08 05:00+00') from b_claim;
select app.finish_send(message_id, claimed_at, 'sent', null, null, 'synthetic-b', null, false, '2026-11-08 05:00:10+00') from b_claim;

select is(
  (select ok from app.begin_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:04+00', 't', 'b', null, '2026-11-08 03:05+00')),
  false,
  'begin_send refuses a claim time that is not the row''s'
);
select is(
  (select row(ok, title, body)::text from app.begin_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:05+00', 'T1', 'B1', null, '2026-11-08 03:05:30+00')),
  row(true, 'T1', 'B1')::text,
  'begin_send stores the render on the first attempt'
);
select is(
  (select row(body_sha256, send_started_at)::text from pg_temp.message('o28:a')),
  row(app.sha256_hex('B1'), '2026-11-08 03:05:30+00'::timestamptz)::text,
  'the body hash and the start of the send are recorded'
);
select is(app.finish_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:05+00', 'retry', null, 'http_503', null, null, false, '2026-11-08 03:06+00'), 'queued', 'a retry puts the message back in the queue');
select is(
  (select row(status, last_error_code, not_before)::text from pg_temp.message('o28:a')),
  row('queued', 'http_503', '2026-11-08 03:06+00'::timestamptz + app.notify_backoff(1, null, (select id from pg_temp.message('o28:a'))))::text,
  'the retry waits for the back-off of attempt 1'
);
create temp table second_claim as
select * from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT'], interval '2 minutes', '2026-11-08 03:30+00', (select tenant_a from fx));
select is((select row(message_id, attempts)::text from second_claim), row((select id from pg_temp.message('o28:a')), 2::smallint)::text, 'the message is claimed again after its back-off');
select is(
  (select row(ok, title, body)::text from app.begin_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:30+00', 'T2', 'B2', null, '2026-11-08 03:30:10+00')),
  row(true, 'T1', 'B1')::text,
  'a retry sends the stored render, never a new one'
);
select is(app.finish_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:30+00', 'sent', null, null, 'synthetic-provider-1', null, false, '2026-11-08 03:31+00'), 'sent', 'finish_send records a sent message');
select is(
  (select row(status, sent_at, provider_message_id, last_error_code, lease_until)::text from pg_temp.message('o28:a')),
  row('sent', '2026-11-08 03:31+00'::timestamptz, 'synthetic-provider-1', null::text, null::timestamptz)::text,
  'sent keeps the provider id only'
);
select is(
  (select row(status, last_ok_at, consecutive_failures)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000001'),
  row('active', '2026-11-08 03:31+00'::timestamptz, 0)::text,
  'the destination records the success'
);
select is(app.finish_send((select id from pg_temp.message('o28:a')), '2026-11-08 03:30+00', 'sent', null, null, 'again', null, false, '2026-11-08 03:32+00'), 'lost', 'a finish for a finished message changes nothing');
select is(app.finish_send((select id from pg_temp.message('o28:b')), '2026-11-08 05:01+00', 'sent', null, null, 'stale', null, false, '2026-11-08 05:02+00'), 'lost', 'a finish with a stale claim time changes nothing');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:fail-message', '2026-11-08 03:40+00');
select is(pg_temp.send_once('o28:fail-message', 'failed', 'message', 'bad_request', '2026-11-08 03:41+00'), 'failed', 'a permanent failure of the message fails it');
select is(
  (select row(status, consecutive_failures, last_error_code)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000001'),
  row('active', 1, 'bad_request')::text,
  'a message failure leaves the destination active and counts it'
);
select pg_temp.enqueue('88888888-8888-4888-8888-000000000006', 'alert', 'o28:fail-destination', '2026-11-08 03:40+00');
select is(pg_temp.send_once('o28:fail-destination', 'failed', 'destination', 'not_found', '2026-11-08 03:41+00'), 'failed', 'a destination failure fails the message');
select is((select status from public.notification_channels where id = '88888888-8888-4888-8888-000000000006'), 'failing', 'a destination failure marks the destination failing');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000007', 'alert', 'o28:fail-channel', '2026-11-08 03:40+00');
select is(pg_temp.send_once('o28:fail-channel', 'failed', 'channel', 'token_invalid', '2026-11-08 03:41+00'), 'failed', 'a channel failure fails the message');
select is((select row(status, last_error_code)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000007'), row('failing', 'token_invalid')::text, 'a channel failure marks the destination failing');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000008', 'alert', 'o28:blocked', '2026-11-08 03:40+00');
select is(pg_temp.send_once('o28:blocked', 'failed', 'destination', 'blocked_by_user', '2026-11-08 03:41+00'), 'failed', 'a blocked bot fails the message');
select is(
  (select row(status, disabled_reason)::text from public.notification_channels where id = '88888888-8888-4888-8888-000000000008'),
  row('disabled', 'blocked_by_user')::text,
  'a user who blocked the bot disables the destination as an opt-out'
);
select pg_temp.enqueue('88888888-8888-4888-8888-000000000006', 'alert', 'o28:recovered', '2026-11-08 03:50+00');
select is(pg_temp.send_once('o28:recovered', 'sent', null, null, '2026-11-08 03:51+00'), 'sent', 'a failing destination still receives messages');
select is((select status from public.notification_channels where id = '88888888-8888-4888-8888-000000000006'), 'active', 'a success turns a failing destination active again');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:uncertain', '2026-11-08 03:42+00');
select is(pg_temp.send_once('o28:uncertain', 'uncertain', null, 'timeout', '2026-11-08 03:43+00'), 'uncertain', 'an unknown outcome on a non-idempotent provider is uncertain');
select is(
  app.finish_send((select id from pg_temp.message('o28:uncertain')), (select claimed_at from pg_temp.message('o28:uncertain')), 'sent', null, null, 'synthetic-late', null, false, '2026-11-08 03:44+00'),
  'sent',
  'a late success from the original worker turns uncertain into sent'
);
select is((select row(status, provider_message_id)::text from pg_temp.message('o28:uncertain')), row('sent', 'synthetic-late')::text, 'the late success keeps the provider id');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'o28:idempotent', '2026-11-08 03:42+00');
select is(pg_temp.send_once('o28:idempotent', 'uncertain', null, 'timeout', '2026-11-08 03:43+00', true), 'queued', 'an unknown outcome on an idempotent provider is retried');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000009', 'alert', 'o28:vanish-1', '2026-11-08 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000009', 'alert', 'o28:vanish-2', '2026-11-08 03:01+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000009', 'alert', 'o28:vanish-3', '2026-11-08 03:02+00');
select pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT5', '2026-11-08 03:50+00');
select pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT5', '2026-11-08 03:50+00');
delete from public.notification_channels where id = '88888888-8888-4888-8888-000000000009';
select is(
  (select string_agg(status || ':' || coalesce(decision, '') || ':' || coalesce(channel_id::text, 'none'), ',' order by created_at) from public.outbound_messages where dedupe_key like 'o28:vanish-%'),
  'sending:send:none,sending:send:none,cancelled:destination_removed:none',
  'deleting a destination cancels its waiting messages and leaves those being sent without a destination'
);
select is(app.finish_send((select id from pg_temp.message('o28:vanish-1')), '2026-11-08 03:50+00', 'retry', null, 'http_503', null, null, false, '2026-11-08 03:51+00'), 'cancelled', 'a retry for a vanished destination is cancelled');
select is((select decision from pg_temp.message('o28:vanish-1')), 'destination_removed', 'the cancelled retry says the destination was removed');
select is(app.finish_send((select id from pg_temp.message('o28:vanish-2')), '2026-11-08 03:50+00', 'sent', null, null, 'synthetic-vanished', null, false, '2026-11-08 03:51+00'), 'sent', 'a success for a vanished destination is still recorded');

select ok(
  (select bool_and(app.notify_backoff(v.attempt, null, '99999999-9999-4999-8999-000000000001') between make_interval(mins => v.minutes) and make_interval(mins => v.minutes) * 1.2)
   from (values (1, 1), (2, 5), (3, 30), (4, 120), (5, 360), (6, 360)) as v (attempt, minutes)),
  'back-off is 1, 5, 30, 120 and 360 minutes plus at most 20 percent jitter'
);
select is(app.notify_backoff(3, null, '99999999-9999-4999-8999-000000000001'), app.notify_backoff(3, null, '99999999-9999-4999-8999-000000000001'), 'the jitter is deterministic per message');
select isnt(app.notify_backoff(3, null, '99999999-9999-4999-8999-000000000001'), app.notify_backoff(3, null, '99999999-9999-4999-8999-000000000002'), 'the jitter differs between messages');
select is(app.notify_backoff(1, 600, '99999999-9999-4999-8999-000000000001'), interval '10 minutes', 'the provider''s retry-after wins over a shorter back-off');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000010', 'alert', 'o28:exhaust', '2026-11-08 03:00+00', null, '2026-12-31 00:00+00');
select is(pg_temp.exhaust('o28:exhaust', '2026-11-08 03:00+00'), array['queued', 'queued', 'queued', 'queued', 'failed'], 'the fifth retryable failure fails the message');
select is((select row(status, attempts)::text from pg_temp.message('o28:exhaust')), row('failed', 5::smallint)::text, 'the message failed after five attempts');

select pg_temp.clear((select tenant_a from fx));
select pg_temp.enqueue('88888888-8888-4888-8888-000000000011', 'alert', 'o28:lease-never', '2026-11-08 06:00+00');
select pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT7', '2026-11-08 06:00+00');
select cmp_ok(app.recover_message_leases('2026-11-08 06:10+00', (select tenant_a from fx)), '>=', 1, 'lease recovery moves expired leases');
select is((select row(status, last_error_code)::text from pg_temp.message('o28:lease-never')), row('queued', 'lease_expired')::text, 'a lease that expired before the send started goes back to the queue');
select pg_temp.clear((select tenant_a from fx));
select pg_temp.enqueue('88888888-8888-4888-8888-000000000011', 'alert', 'o28:lease-other', '2026-11-08 06:20+00');
select app.begin_send(c.message_id, c.claimed_at, null, 'started', null, '2026-11-08 06:20+00')
from app.claim_next_message('pgtap', array['NOTIFY_ZALO_BOT_TOKEN_IT7'], interval '2 minutes', '2026-11-08 06:20+00', (select tenant_a from fx)) c;
select app.recover_message_leases('2026-11-08 06:30+00', (select tenant_a from fx));
select is((select status from pg_temp.message('o28:lease-other')), 'uncertain', 'a started send on a non-idempotent provider becomes uncertain');
select pg_temp.clear((select tenant_a from fx));
select pg_temp.enqueue('88888888-8888-4888-8888-000000000002', 'alert', 'o28:lease-idempotent', '2026-11-08 06:40+00');
select app.begin_send(c.message_id, c.claimed_at, 'subject', 'started', null, '2026-11-08 06:40+00')
from app.claim_next_message('pgtap', array['NOTIFY_EMAIL_API_KEY_IT'], interval '2 minutes', '2026-11-08 06:40+00', (select tenant_a from fx)) c;
select app.recover_message_leases('2026-11-08 06:50+00', (select tenant_a from fx));
select is((select status from pg_temp.message('o28:lease-idempotent')), 'queued', 'a started send on an idempotent provider is retried with the same key');
select pg_temp.clear((select tenant_a from fx));
insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
select '88888888-8888-4888-8888-000000000013', tenant_a, 'zalo_bot', 'zalo_bot', 'vanishing during a lease', owner_a, 'synthetic-chat-13', 'NOTIFY_ZALO_BOT_TOKEN_IT10', 'active', '2026-11-01 00:00+00' from fx;
select pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'alert', 'o28:lease-vanished', '2026-11-08 07:00+00');
select pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT10', '2026-11-08 07:00+00');
delete from public.notification_channels where id = '88888888-8888-4888-8888-000000000013';
select app.recover_message_leases('2026-11-08 07:10+00', (select tenant_a from fx));
select is((select status || ':' || decision from pg_temp.message('o28:lease-vanished')), 'cancelled:destination_removed', 'a lease of a vanished destination that never started is cancelled');

select app.record_dispatch('2026-11-08 08:00+00', 'cli', array['NOTIFY_ZALO_BOT_TOKEN_IT', 'POS_ACCOUNTS_JSON', 'synthetic-bot-token'], '{"sent": 3}'::jsonb);
select is((select last_dispatcher_secrets from app.notify_settings), array['NOTIFY_ZALO_BOT_TOKEN_IT'], 'record_dispatch keeps NOTIFY_ names only, never other names or values');
select is((select dispatcher_secrets -> 'cli' -> 'counts' from app.notify_settings), '{"sent": 3}'::jsonb, 'record_dispatch keeps the count-only counts per runtime');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000001', 'alert', 'o28:expire-known', '2026-11-08 08:00+00', null, '2026-11-08 08:30+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000005', 'alert', 'o28:expire-unknown', '2026-11-08 08:00+00', null, '2026-11-08 08:30+00');
select is(app.expire_messages('2026-11-08 09:00+00', (select tenant_a from fx)), 2, 'expire_messages cancels the waiting messages past expires_at');
select is((select status || ':' || decision from pg_temp.message('o28:expire-known')), 'cancelled:expired', 'a message whose secret a dispatcher reported expires as expired');
select is((select status || ':' || decision from pg_temp.message('o28:expire-unknown')), 'cancelled:no_dispatcher_secret', 'a message whose secret no runtime reported in 48 hours names the missing secret');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000003', 'alert', 'o28:mgr-sent', '2026-11-08 09:00+00');
select pg_temp.send_once('o28:mgr-sent', 'sent', null, null, '2026-11-08 09:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000003', 'alert', 'o28:mgr-sending', '2026-11-08 09:10+00');
select pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT', '2026-11-08 09:10+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000003', 'alert', 'o28:mgr-queued', '2026-11-08 09:20+00');
select is(app.redact_outbound_for_subject((select tenant_a from fx), 'staff', (select manager_a from fx)), 2, 'redaction touches every row of the subject except the one being sent');
select is(
  (select row(status, decision, recipient_ref, subject_id, params, body)::text from pg_temp.message('o28:mgr-queued')),
  row('cancelled', 'destination_removed', 'redacted', null::uuid, null::jsonb, null::text)::text,
  'a waiting row is cancelled and redacted'
);
select is(
  (select row(status, recipient_ref, subject_id, title, body, template_ref, body_sha256 is not null, sent_at is not null)::text from pg_temp.message('o28:mgr-sent')),
  row('sent', 'redacted', null::uuid, null::text, null::text, 'alert.v1', true, true)::text,
  'a sent row keeps counts, template, hash and timestamps only'
);
select is((select recipient_ref from pg_temp.message('o28:mgr-sending')), 'channel:88888888-8888-4888-8888-000000000003', 'a row being sent is skipped');

delete from public.tenant_members where tenant_id = (select tenant_a from fx) and user_id = (select linker_a from fx);
select is((select count(*)::integer from public.notification_channels where user_id = (select linker_a from fx)), 0, 'removing a member deletes their destinations');
select is((select count(*)::integer from public.outbound_messages where subject_id = (select linker_a from fx)), 0, 'removing a member redacts their outbound rows');
select is(
  (select string_agg(template_ref || ':' || recipient_ref || ':' || coalesce(channel_id::text, 'none'), ',' order by created_at)
   from public.outbound_messages where tenant_id = (select tenant_a from fx) and template_ref in ('link_notice.v1', 'link_confirmation.v1') and recipient_ref = 'redacted' and kind in ('link_notice', 'link_confirmation') and dedupe_key like '%88888888-8888-4888-8888-000000000021%'),
  'link_notice.v1:redacted:none,link_confirmation.v1:redacted:none',
  'the former member''s rows stay as redacted counts'
);
select is((select count(*)::integer from public.consent_records where subject_id = (select linker_a from fx) and purpose = 'notifications'), 1, 'the consent ledger outlives the membership');

delete from public.tenant_members where tenant_id = (select tenant_a from fx) and user_id = (select manager_a from fx);
select is((select row(status, subject_id is not null, channel_id)::text from pg_temp.message('o28:mgr-sending')), row('sending', true, null::uuid)::text, 'a row being sent at the removal keeps its subject until housekeeping');
select app.finish_send(id, claimed_at, 'sent', null, null, 'synthetic-after-removal', null, false, '2026-11-08 09:11+00') from pg_temp.message('o28:mgr-sending');

select throws_ok($$ update app.notify_settings set retention_days = 365 $$, '23514', null, 'a retention below 366 days is refused');

select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:old-sent', '2025-10-01 03:00+00', null, '2025-10-03 00:00+00');
select pg_temp.send_once('o28:old-sent', 'sent', null, null, '2025-10-01 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:old-uncertain', '2025-10-01 03:10+00', null, '2025-10-03 00:00+00');
select pg_temp.send_once('o28:old-uncertain', 'uncertain', null, 'timeout', '2025-10-01 03:10+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:old-sent:resend:1', '2026-11-01 03:00+00', null, '2026-11-03 00:00+00');
update public.outbound_messages set resend_of = (select id from pg_temp.message('o28:old-sent')) where dedupe_key = 'o28:old-sent:resend:1';
select pg_temp.send_once('o28:old-sent:resend:1', 'sent', null, null, '2026-11-01 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:body-old', '2026-08-01 03:00+00', null, '2026-08-03 00:00+00');
select pg_temp.send_once('o28:body-old', 'sent', null, null, '2026-08-01 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:body-new', '2026-08-15 03:00+00', null, '2026-08-17 00:00+00');
select pg_temp.send_once('o28:body-new', 'sent', null, null, '2026-08-15 03:00+00');
select pg_temp.enqueue('88888888-8888-4888-8888-000000000012', 'alert', 'o28:old-queued', '2025-10-01 04:00+00', null, '2027-01-01 00:00+00');

create temp table housekeeping as select app.notify_housekeeping('2026-11-08 03:00+00', (select tenant_a from fx)) as result;
select cmp_ok(((select result from housekeeping) ->> 'messages_deleted')::integer, '>=', 1, 'housekeeping reports the rows it deleted');
select is((select count(*)::integer from public.outbound_messages where dedupe_key = 'o28:old-sent'), 0, 'a sent row older than the retention is deleted');
select is(
  (select row(status, resend_of)::text from pg_temp.message('o28:old-sent:resend:1')),
  row('sent', null::uuid)::text,
  'its resend stays, with the reference cleared'
);
select is((select status from pg_temp.message('o28:old-uncertain')), 'uncertain', 'an uncertain row is never purged');
select is((select status from pg_temp.message('o28:old-queued')), 'queued', 'a waiting row is never purged');
select is(
  (select row(body, body_sha256 is not null, params)::text from pg_temp.message('o28:body-old')),
  row(null::text, true, '{"count": 1}'::jsonb)::text,
  'a body older than 90 days is cleared, its hash and parameters stay'
);
select is((select body from pg_temp.message('o28:body-new')), 'body of o28:body-new', 'a body younger than 90 days stays');
select is((select count(*)::integer from public.notification_channels where id = '88888888-8888-4888-8888-000000000022'), 0, 'an unaccepted pending bot destination is deleted, chat id included, after 24 hours');
select is((select subject_id from pg_temp.message('o28:mgr-sending')), null::uuid, 'housekeeping redacts a row of a former member that was being sent at the removal');

select ok(app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'zalo_bot', 'worker-a', interval '30 seconds', '2026-11-08 10:00+00'), 'a free polling lease is taken');
select ok(not app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'zalo_bot', 'worker-b', interval '30 seconds', '2026-11-08 10:00:10+00'), 'the lease is refused while another worker holds it');
select ok(app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'zalo_bot', 'worker-a', interval '30 seconds', '2026-11-08 10:00:20+00'), 'the holder renews the lease');
select ok(app.take_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'zalo_bot', 'worker-b', interval '30 seconds', '2026-11-08 10:01:00+00'), 'another worker takes the lease after it expired');
select app.release_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'worker-a');
select is((select poller from app.bot_poll_state where secret_name = 'NOTIFY_ZALO_BOT_TOKEN_IT9'), 'worker-b', 'only the holder releases the lease');
select app.release_poll_lease('NOTIFY_ZALO_BOT_TOKEN_IT9', 'worker-b');
select is((select row(poller, poll_lease_until)::text from app.bot_poll_state where secret_name = 'NOTIFY_ZALO_BOT_TOKEN_IT9'), row(null::text, null::timestamptz)::text, 'the holder releases the lease');
select throws_ok($$ select app.take_poll_lease('POS_ACCOUNTS_JSON', 'zalo_bot', 'worker-a', interval '30 seconds', '2026-11-08 10:00+00') $$, '22023', null, 'a lease is taken only for a bot secret name');

create temp table manual_ticket as select app.issue_notify_ticket('manual') as ticket;
select is((select reason from app.claim_notify_ticket((select ticket from manual_ticket))), 'manual', 'a ticket is claimed once');
select is((select count(*)::integer from app.claim_notify_ticket((select ticket from manual_ticket))), 0, 'a used ticket is refused');
create temp table stale_ticket as select app.issue_notify_ticket('manual') as ticket;
update app.notify_tickets set expires_at = now() where ticket = (select ticket from stale_ticket);
select is((select count(*)::integer from app.claim_notify_ticket((select ticket from stale_ticket))), 0, 'an expired ticket is refused');
insert into app.notify_tickets (reason, issued_at, expires_at, request_id) values ('schedule', now() - interval '20 minutes', now() - interval '10 minutes', 4242);
update app.notify_settings set last_housekeeping_at = now();
create temp table tickets_before as select tickets_expired_unclaimed as counted from app.notify_settings;
select app.notify_tick(now(), false);
select is((select tickets_expired_unclaimed from app.notify_settings), (select counted + 1 from tickets_before), 'an expired posted ticket is counted as unclaimed');
select is((select count(*)::integer from app.notify_tickets where expires_at <= now()), 0, 'the tick deletes expired tickets');

select is(app.kick_notify(), false, 'kick_notify does nothing while the schedule is disabled');
select ok(app.facts_are_count_only(app.notify_tick_rules('2026-11-08 12:00+00', (select tenant_a from fx))), 'the rules hook returns a count-only object in every form');
create temp table tick as select app.notify_tick('2026-11-08 12:00+00', false, (select tenant_a from fx)) as summary;
select is(
  ((select summary from tick) ->> 'due_messages')::integer,
  (select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx) and status in ('queued', 'held') and coalesce(not_before, created_at) <= '2026-11-08 12:00+00'),
  'the tick counts the tenant''s due messages'
);
select ok(app.facts_are_count_only((select summary - 'enabled' - 'housekeeping' - 'ticket_posted' from tick)), 'the tick summary is count-only');
select is(((select summary from tick) ->> 'ticket_posted')::boolean, false, 'a tick with p_post false posts no ticket');
select is(
  (select s ->> 'enabled' from (select app.notify_tick('2026-11-08 12:00+00', true, (select tenant_a from fx)) as s) x),
  'false',
  'a posting tick returns early while the schedule is disabled'
);

insert into public.notification_channels (id, tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select '88888888-8888-4888-8888-000000000013', fx.tenant_a, 'zalo_bot', 'zalo_bot', 'claim passes', fx.owner_a, 'synthetic-chat-13', 'NOTIFY_ZALO_BOT_TOKEN_IT11', 'active', '2026-11-01 00:00+00', c.owner_a
from fx
cross join consent_ids c;
select count(pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'alert', 'o28:pass-alert-' || g, '2026-11-10 17:00+00'::timestamptz + make_interval(secs => g)))
from generate_series(1, 21) g;
select pg_temp.enqueue('88888888-8888-4888-8888-000000000013', 'test', 'o28:pass-test', '2026-11-10 17:05+00');
select is(
  pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT11', '2026-11-10 17:10+00'),
  (select id from pg_temp.message('o28:pass-test')),
  'a due message behind more than 20 messages the claim holds on the way is claimed in the same call'
);
select is(
  (select count(*)::integer from public.outbound_messages where dedupe_key like 'o28:pass-alert-%' and status = 'held' and hold_reason = 'outside_hours' and not_before = '2026-11-10 23:00+00'),
  21,
  'every alert ahead of it is held until the window opens'
);
select is(pg_temp.claim('NOTIFY_ZALO_BOT_TOKEN_IT11', '2026-11-10 17:10+00'), null::uuid, 'with only held messages left the claim returns nothing');

select * from finish();
rollback;
