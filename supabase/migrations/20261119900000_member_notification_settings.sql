create table app.notification_link_starts (
  tenant_id uuid not null,
  user_id uuid not null,
  window_started_at timestamptz not null,
  starts smallint not null check (starts between 1 and 5),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade
);

comment on table app.notification_link_starts is 'the rate limit of public.start_bot_link: how many Zalo Bot link codes a member started in the current one-hour window, at most 5; the row goes with the membership and keeps nothing else about the member';

revoke all on table app.notification_link_starts from public, anon, authenticated, service_role;

create function app.notification_member_role(p_tenant_id uuid, p_user_id uuid)
returns public.tenant_role
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role public.tenant_role;
begin
  if p_tenant_id is not null and p_user_id is not null then
    select m.role into v_role
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_user_id;
  end if;
  if v_role is null then
    raise exception 'only a signed-in member of the tenant manages their own notifications' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

comment on function app.notification_member_role(uuid, uuid) is 'the member''s role in the tenant for the member notification functions; 42501 for a caller who is not signed in or not a member';

create function app.bot_link_notice_text(p_tenant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select normalize(
    'Khi liên kết, ' || t.name || ' chỉ dùng mã tài khoản Zalo hoặc địa chỉ e-mail đăng nhập của bạn để gửi bản tin số liệu hằng ngày và cảnh báo vận hành. Tin do hệ thống tự động gửi qua Zalo Bot. Việc liên kết là tự nguyện và không ảnh hưởng đến công việc của bạn. Bạn có thể ngừng bất cứ lúc nào trong Cài đặt → Cảnh báo, hoặc nhờ chủ cửa hàng gỡ liên kết. Nhật ký gửi tin được lưu khoảng 13 tháng.',
    nfc
  )
  from public.tenants t
  where t.id = p_tenant_id;
$$;

comment on function app.bot_link_notice_text(uuid) is 'the notice ops-notifications-v1 for a Zalo Bot destination of the tenant, word for word the NOTICE_TEMPLATE of @fnb/notify filled with the tenant name, Zalo and Zalo Bot (NFC), which the staff app shows before it asks for a link code';

create function app.member_bot_secret_name(p_tenant_id uuid, p_user_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select c.secret_name
      from public.notification_channels c
      where c.tenant_id = p_tenant_id
        and c.user_id = p_user_id
        and c.kind = 'zalo_bot'
      order by case c.status when 'pending' then 0 when 'disabled' then 1 else 2 end, c.created_at, c.id
      limit 1
    ),
    (
      select c.secret_name
      from public.notification_channels c
      where c.tenant_id = p_tenant_id
        and c.kind = 'zalo_bot'
        and c.status in ('active', 'failing')
      group by c.secret_name
      order by count(*) desc, c.secret_name
      limit 1
    ),
    'NOTIFY_ZALO_BOT_TOKEN'
  );
$$;

comment on function app.member_bot_secret_name(uuid, uuid) is 'the Zalo Bot a member links to: the bot of their own Zalo Bot destination (pending first, then disabled), else the bot most of the tenant''s linked Zalo Bot destinations use, else the default NOTIFY_ZALO_BOT_TOKEN; a name, never a token';

create function public.my_notifications(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.tenant_role;
  v_secret text;
begin
  v_role := app.notification_member_role(p_tenant_id, v_user);
  v_secret := app.member_bot_secret_name(p_tenant_id, v_user);
  return jsonb_build_object(
    'consent',
    coalesce(
      (
        select jsonb_build_object(
          'state', case when c.revoked_at is null then 'active' else 'withdrawn' end,
          'granted_at', c.granted_at,
          'revoked_at', c.revoked_at,
          'channel', c.channel
        )
        from public.consent_records c
        where c.tenant_id = p_tenant_id
          and c.subject_type = 'staff'
          and c.subject_id = v_user
          and c.purpose = 'notifications'
        order by c.revoked_at is null desc, coalesce(c.revoked_at, c.granted_at) desc, c.id
        limit 1
      ),
      jsonb_build_object('state', 'none', 'granted_at', null, 'revoked_at', null, 'channel', null)
    ),
    'destinations',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'kind', c.kind,
            'provider', c.provider,
            'label', c.label,
            'address_hint', c.address_hint,
            'status', c.status,
            'enabled', c.enabled,
            'muted_rules', to_jsonb(c.muted_rules),
            'linked_at', c.linked_at,
            'last_ok_at', c.last_ok_at,
            'disabled_reason', c.disabled_reason,
            'link_stage', case
              when c.status <> 'pending' or l.channel_id is null or l.expires_at <= now() then null
              when l.purpose = 'bot_consent' then 'acceptance'
              else 'code'
            end,
            'link_expires_at', case when c.status = 'pending' and l.expires_at > now() then l.expires_at end
          )
          order by c.created_at, c.id
        )
        from public.notification_channels c
        left join app.notification_link_codes l on l.channel_id = c.id
        where c.tenant_id = p_tenant_id
          and c.user_id = v_user
      ),
      '[]'::jsonb
    ),
    'rules',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('rule_key', c.rule_key, 'category', c.category, 'delivery', c.delivery)
          order by c.sort_order
        )
        from public.alert_rule_catalog c
        where v_role = any (
            coalesce(
              (select t.roles from public.alert_rules t where t.tenant_id = p_tenant_id and t.store_id is null and t.rule_key = c.rule_key),
              c.default_roles
            )
          )
          or exists (
            select 1
            from public.alert_rules s
            where s.tenant_id = p_tenant_id
              and s.store_id is not null
              and s.rule_key = c.rule_key
              and v_role = any (s.roles)
          )
          or exists (
            select 1
            from public.notification_channels n
            where n.tenant_id = p_tenant_id
              and n.user_id = v_user
              and c.rule_key = any (n.muted_rules)
          )
      ),
      '[]'::jsonb
    ),
    'notice',
    jsonb_build_object('version', 'ops-notifications-v1', 'text', app.bot_link_notice_text(p_tenant_id)),
    'bot_name',
    (select b.bot_name from app.bot_poll_state b where b.secret_name = v_secret)
  );
end;
$$;

comment on function public.my_notifications(uuid) is 'Nhận thông báo of the signed-in member: their notifications consent (active, withdrawn or none, with its times and channel), their own destinations without address, secret or configuration (with the link stage and expiry of a pending one), the catalogue rules their role receives or they muted, the notice ops-notifications-v1 to show before a link code, and the display name of the bot they would link; 42501 for anyone who is not a member of the tenant';

create function public.start_bot_link(p_tenant_id uuid, p_notice_version text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.tenant_role;
  v_at timestamptz := now();
  v_secret text;
  v_channel public.notification_channels%rowtype;
  v_existing boolean;
  v_starts smallint;
  v_code text;
  v_expires timestamptz;
begin
  v_role := app.notification_member_role(p_tenant_id, v_user);
  if v_role = 'publisher' then
    raise exception 'a publisher login receives no digest or alert' using errcode = '42501';
  end if;
  if p_notice_version is distinct from 'ops-notifications-v1' then
    raise exception 'the notice shown before the code must be ops-notifications-v1' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notify-bot-link:' || p_tenant_id::text || ':' || v_user::text, 0));
  if exists (
    select 1
    from public.notification_channels c
    where c.tenant_id = p_tenant_id
      and c.user_id = v_user
      and c.kind = 'zalo_bot'
      and c.status in ('active', 'failing')
  ) then
    raise exception 'the Zalo Bot is already linked' using errcode = '23505';
  end if;
  v_secret := app.member_bot_secret_name(p_tenant_id, v_user);
  select c.* into v_channel
  from public.notification_channels c
  where c.tenant_id = p_tenant_id
    and c.user_id = v_user
    and c.kind = 'zalo_bot'
    and c.secret_name = v_secret
  for update;
  v_existing := found;
  if v_existing and v_channel.disabled_reason = 'owner_request' then
    raise exception 'the owner removed this Zalo Bot link, so only the owner links it again' using errcode = '42501';
  end if;
  insert into app.notification_link_starts as s (tenant_id, user_id, window_started_at, starts)
  values (p_tenant_id, v_user, v_at, 1)
  on conflict (tenant_id, user_id) do update
  set window_started_at = case
        when s.window_started_at <= excluded.window_started_at - interval '1 hour' or s.window_started_at > excluded.window_started_at
          then excluded.window_started_at
        else s.window_started_at
      end,
      starts = case
        when s.window_started_at <= excluded.window_started_at - interval '1 hour' or s.window_started_at > excluded.window_started_at
          then 1
        else s.starts + 1
      end
  where s.window_started_at <= excluded.window_started_at - interval '1 hour'
     or s.window_started_at > excluded.window_started_at
     or s.starts < 5
  returning s.starts into v_starts;
  if v_starts is null then
    raise exception 'at most 5 link codes an hour' using errcode = '55000';
  end if;
  if not v_existing then
    insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status)
    values (p_tenant_id, 'zalo_bot', 'zalo_bot', 'Zalo Bot', v_user, v_secret, 'pending')
    returning * into v_channel;
  elsif v_channel.status = 'disabled' then
    update public.notification_channels c
    set status = 'pending',
        disabled_reason = null,
        enabled = true,
        address = null,
        address_hint = null,
        linked_at = null,
        consent_record_id = null,
        consecutive_failures = 0,
        last_error_code = null,
        last_error_at = null
    where c.id = v_channel.id
    returning c.* into v_channel;
  end if;
  v_code := app.issue_link_code(v_channel.id, 'bot_link', v_at);
  select l.expires_at into v_expires
  from app.notification_link_codes l
  where l.channel_id = v_channel.id;
  perform app.kick_notify('kick');
  return jsonb_build_object(
    'channel_id', v_channel.id,
    'notice_version', 'ops-notifications-v1',
    'code', v_code,
    'expires_at', v_expires,
    'bot_name', (select b.bot_name from app.bot_poll_state b where b.secret_name = v_secret)
  );
end;
$$;

comment on function public.start_bot_link(uuid, text) is 'the signed-in member links their own Zalo Bot chat from the staff app, after the app showed the notice ops-notifications-v1 (p_notice_version): reuses their pending or self-stopped Zalo Bot destination, or creates one on the bot of app.member_bot_secret_name, issues a code valid 15 minutes that is returned once and kept only as a hash, and wakes the dispatcher; the destination becomes active, and the notifications consent is recorded, only when the member answers the bot''s notice with ĐỒNG Ý; 23505 when their Zalo Bot is already linked, 42501 for a non-member, a publisher or a link the owner removed, 22023 for another notice version, 55000 past 5 codes an hour';

create function public.set_my_muted_rules(p_channel_id uuid, p_muted_rules text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_channel public.notification_channels%rowtype;
  v_rules text[];
begin
  if v_user is not null then
    select c.* into v_channel
    from public.notification_channels c
    where c.id = p_channel_id
      and c.user_id = v_user
    for update;
  end if;
  if v_channel.id is null then
    raise exception 'only the member a destination belongs to mutes its messages' using errcode = '42501';
  end if;
  if p_muted_rules is null
    or cardinality(p_muted_rules) > 100
    or exists (
      select 1
      from unnest(p_muted_rules) as r (rule_key)
      where r.rule_key is null
         or not exists (select 1 from public.alert_rule_catalog c where c.rule_key = r.rule_key)
    ) then
    raise exception 'muted rules are a list of catalogue rule keys' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.rule_key order by c.sort_order), '{}'::text[]) into v_rules
  from public.alert_rule_catalog c
  where c.rule_key = any (p_muted_rules);
  update public.notification_channels c
  set muted_rules = v_rules
  where c.id = v_channel.id;
  return v_rules;
end;
$$;

comment on function public.set_my_muted_rules(uuid, text[]) is 'the signed-in member sets the catalogue rules one of their own destinations does not want, replacing the list (an empty list unmutes all); returned without duplicates in catalogue order; the send decision cancels a waiting message of a muted rule as unsubscribed; 42501 for a destination that is not the caller''s, 22023 for a key outside the catalogue';

create function public.stop_my_notifications(p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  perform app.notification_member_role(p_tenant_id, v_user);
  return app.withdraw_notifications(p_tenant_id, v_user, now());
end;
$$;

comment on function public.stop_my_notifications(uuid) is 'Dừng nhận thông báo: the signed-in member withdraws their own notifications consent through app.withdraw_notifications, in one transaction: the consent revoked, the waiting messages of every destination of theirs cancelled as no_consent, destinations still pending a link deleted and the others disabled as consent_withdrawn; returns the number of messages cancelled; the staff_ops consent, the membership and the staff app session stay as they were; 42501 for anyone who is not a member of the tenant';

create function public.my_follow_oa(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_oa text;
  v_scope uuid[];
begin
  perform app.notification_member_role(p_tenant_id, v_user);
  select o.external_id into v_oa
  from public.zalo_identities i
  join public.zalo_apps z on z.tenant_id = i.tenant_id and z.id = i.zalo_app_id
  join public.oas o on o.tenant_id = z.tenant_id and o.brand_id = z.brand_id
  where i.tenant_id = p_tenant_id
    and i.user_id = v_user
  order by i.updated_at desc, i.id
  limit 1;
  if v_oa is not null then
    return v_oa;
  end if;
  select m.store_ids into v_scope
  from public.tenant_members m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_user;
  select case when count(distinct o.external_id) = 1 then min(o.external_id) end into v_oa
  from public.brands b
  join public.oas o on o.tenant_id = b.tenant_id and o.brand_id = b.id
  where b.tenant_id = p_tenant_id
    and (v_scope is null or b.store_ids && v_scope);
  return v_oa;
end;
$$;

comment on function public.my_follow_oa(uuid) is 'the OA id the staff app passes to the SDK''s followOA: the OA of the brand whose Mini App the signed-in member last signed in through, else the one OA of the brands meeting their store scope, else null (no OA, or more than one); nothing else of oas; 42501 for anyone who is not a member of the tenant';

revoke all on function app.notification_member_role(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.bot_link_notice_text(uuid) from public, anon, authenticated, service_role;
revoke all on function app.member_bot_secret_name(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_notifications(uuid) from public, anon, service_role;
revoke all on function public.start_bot_link(uuid, text) from public, anon, service_role;
revoke all on function public.set_my_muted_rules(uuid, text[]) from public, anon, service_role;
revoke all on function public.stop_my_notifications(uuid) from public, anon, service_role;
revoke all on function public.my_follow_oa(uuid) from public, anon, service_role;

grant execute on function public.my_notifications(uuid) to authenticated;
grant execute on function public.start_bot_link(uuid, text) to authenticated;
grant execute on function public.set_my_muted_rules(uuid, text[]) to authenticated;
grant execute on function public.stop_my_notifications(uuid) to authenticated;
grant execute on function public.my_follow_oa(uuid) to authenticated;
