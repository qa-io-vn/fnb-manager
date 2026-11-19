create function app.customer_template_purposes(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'points_confirmed' then array['points_confirmation']
    when 'coupon_issued' then array['voucher', 'coupon_issued']
    when 'voucher_expiring' then array['voucher']
    when 'expiry_reminder' then array['expiry_reminder']
    when 'birthday' then array['birthday']
    when 'win_back' then array['win_back']
    else array[]::text[]
  end;
$$;

comment on function app.customer_template_purposes(text) is 'the zbs_templates purposes a customer message kind may use, in order of preference: points_confirmation; voucher (the Voucher layout that carries the code) then coupon_issued; voucher; expiry_reminder; birthday; win_back';

create function app.customer_oa_window(p_oa_id uuid, p_customer_id uuid)
returns table (oa_user_id text, last_interaction_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.oa_user_id, app.oa_last_interaction(c.oa_id, c.oa_user_id)
  from app.customer_oa_contacts c
  where c.oa_id = p_oa_id
    and c.customer_id = p_customer_id;
$$;

comment on function app.customer_oa_window(uuid, uuid) is 'the customer''s OA user id on one OA (app.customer_oa_contacts) and the start of their consultation window, app.oa_last_interaction: the latest verified user_send_ event (a follow alone does not open it); no row without a link, a null time without such an event';

create function app.customer_cap_release(
  p_message public.outbound_messages,
  p_channel text,
  p_policy public.channel_policies,
  p_zone text,
  p_at timestamptz
)
returns table (release_at timestamptz, reason text)
language plpgsql
stable
set search_path = ''
as $$
declare
  period_start timestamptz;
  counted integer;
  release_instant timestamptz;
begin
  if p_policy.max_per_day is not null then
    period_start := case
      when p_policy.cap_window = 'rolling_24h' then p_at - interval '24 hours'
      else date_trunc('day', p_at at time zone p_zone) at time zone p_zone
    end;
    select count(*)::integer into counted
    from public.outbound_messages o
    where o.tenant_id = p_message.tenant_id
      and o.subject_type = 'customer'
      and o.subject_id = p_message.subject_id
      and o.channel_id is null
      and o.channel = p_channel
      and o.message_class = p_message.message_class
      and o.id <> p_message.id
      and o.status in ('sending', 'sent', 'delivered', 'uncertain')
      and coalesce(o.sent_at, o.claimed_at) <= p_at
      and (
        (p_policy.cap_window = 'rolling_24h' and coalesce(o.sent_at, o.claimed_at) > period_start)
        or (p_policy.cap_window <> 'rolling_24h' and coalesce(o.sent_at, o.claimed_at) >= period_start)
      );
    if counted >= p_policy.max_per_day then
      if p_policy.cap_window = 'rolling_24h' then
        select coalesce(o.sent_at, o.claimed_at) + interval '24 hours' into release_instant
        from public.outbound_messages o
        where o.tenant_id = p_message.tenant_id
          and o.subject_type = 'customer'
          and o.subject_id = p_message.subject_id
          and o.channel_id is null
          and o.channel = p_channel
          and o.message_class = p_message.message_class
          and o.id <> p_message.id
          and o.status in ('sending', 'sent', 'delivered', 'uncertain')
          and coalesce(o.sent_at, o.claimed_at) <= p_at
          and coalesce(o.sent_at, o.claimed_at) > period_start
        order by coalesce(o.sent_at, o.claimed_at)
        offset counted - p_policy.max_per_day
        limit 1;
      else
        release_instant := (date_trunc('day', p_at at time zone p_zone) + interval '1 day') at time zone p_zone;
      end if;
      return query select release_instant, 'daily_cap'::text;
      return;
    end if;
  end if;
  if p_policy.max_per_month is not null then
    period_start := date_trunc('month', p_at at time zone p_zone) at time zone p_zone;
    select count(*)::integer into counted
    from public.outbound_messages o
    where o.tenant_id = p_message.tenant_id
      and o.subject_type = 'customer'
      and o.subject_id = p_message.subject_id
      and o.channel_id is null
      and o.channel = p_channel
      and o.message_class = p_message.message_class
      and o.id <> p_message.id
      and o.status in ('sending', 'sent', 'delivered', 'uncertain')
      and coalesce(o.sent_at, o.claimed_at) >= period_start
      and coalesce(o.sent_at, o.claimed_at) <= p_at;
    if counted >= p_policy.max_per_month then
      return query select (date_trunc('month', p_at at time zone p_zone) + interval '1 month') at time zone p_zone, 'monthly_cap'::text;
      return;
    end if;
  end if;
end;
$$;

comment on function app.customer_cap_release(public.outbound_messages, text, public.channel_policies, text, timestamptz) is 'the per-user caps of a channel policy applied to one customer locally (Tag 3: 1 in a rolling 24 hours and 30 a month): the release instant and daily_cap or monthly_cap when the customer''s messages of the class on the channel already reached a cap, no row otherwise';

create function app.customer_message_route(p_message_id uuid, p_at timestamptz)
returns table (decision text, route text, release_at timestamptz, reason text, oa_id uuid, template_id uuid, window_kind text)
language plpgsql
stable
set search_path = ''
as $$
declare
  msg public.outbound_messages%rowtype;
  member public.memberships%rowtype;
  settings app.customer_message_settings%rowtype;
  mode text;
  zone text;
  speaker uuid;
  contact_user text;
  contact_at timestamptz;
  oa_policy public.channel_policies%rowtype;
  zbs_policy public.channel_policies%rowtype;
  api_window interval;
  age interval;
  chosen_window text;
  opens_at timestamptz;
  used integer;
  template public.zbs_templates%rowtype;
  phone text;
  cap_release timestamptz;
  cap_reason text;
  release_instant timestamptz;
  hold_reason text;
begin
  select o.* into msg from public.outbound_messages o where o.id = p_message_id;
  if not found or app.customer_message_class(msg.kind) is null or msg.subject_type is distinct from 'customer' then
    return;
  end if;
  if msg.expires_at is not null and msg.expires_at <= p_at then
    return query select 'cancel'::text, null::text, null::timestamptz, 'expired'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if msg.subject_id is null then
    return query select 'cancel'::text, null::text, null::timestamptz, 'subject_removed'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  select m.* into member
  from public.memberships m
  where m.tenant_id = msg.tenant_id
    and m.id = (msg.params ->> 'membership_id')::uuid
    and m.customer_id = msg.subject_id;
  if not found or not exists (select 1 from public.customers c where c.id = msg.subject_id and c.tenant_id = msg.tenant_id) then
    return query select 'cancel'::text, null::text, null::timestamptz, 'subject_removed'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if member.status <> 'active' then
    return query select 'cancel'::text, null::text, null::timestamptz, 'membership_inactive'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  mode := app.customer_message_route_setting(msg.tenant_id, msg.kind);
  if mode = 'off' then
    return query select 'cancel'::text, null::text, null::timestamptz, 'messaging_disabled'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if app.customer_consent_record(msg.tenant_id, msg.subject_id, 'loyalty') is null then
    return query select 'cancel'::text, null::text, null::timestamptz, 'no_consent'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if msg.message_class = 'advertising' and app.customer_consent_record(msg.tenant_id, msg.subject_id, 'marketing') is null then
    return query select 'cancel'::text, null::text, null::timestamptz, 'no_marketing_consent'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if mode = 'in_app' then
    return query select 'send'::text, 'in_app'::text, p_at, 'in_app_only'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  select s.* into settings from app.customer_message_settings s where s.tenant_id = msg.tenant_id;
  zone := coalesce((select t.timezone from public.tenants t where t.id = msg.tenant_id), 'Asia/Ho_Chi_Minh');
  speaker := app.customer_message_oa(msg.tenant_id, member.id, msg.store_id);

  if msg.message_class = 'transactional'
    and speaker is not null
    and not coalesce((msg.params ->> 'consultation_refused')::boolean, false)
  then
    select w.oa_user_id, w.last_interaction_at into contact_user, contact_at from app.customer_oa_window(speaker, msg.subject_id) w;
    oa_policy := app.effective_channel_policy(msg.tenant_id, 'zalo_oa', 'transactional');
    if contact_at is not null
      and contact_at <= p_at
      and oa_policy.id is not null
      and oa_policy.allowed
      and oa_policy.api_send_allowed
    then
      api_window := least(coalesce(oa_policy.interaction_window, interval '7 days'), interval '7 days');
      age := p_at - contact_at;
      if age <= least(make_interval(hours => settings.free_window_hours), api_window) then
        chosen_window := 'free';
      elsif age <= api_window and settings.out_of_window_monthly_quota > 0 then
        select count(*)::integer into used
        from public.outbound_messages o
        where o.tenant_id = msg.tenant_id
          and o.channel_id is null
          and o.subject_type = 'customer'
          and o.channel = 'zalo_oa'
          and o.status in ('sending', 'sent', 'delivered', 'uncertain')
          and o.params ->> 'oa_id' = speaker::text
          and o.params ->> 'window' = 'allowance'
          and coalesce(o.sent_at, o.claimed_at) >= date_trunc('month', p_at at time zone zone) at time zone zone;
        if used < settings.out_of_window_monthly_quota then
          chosen_window := 'allowance';
        end if;
      end if;
      if chosen_window is not null then
        opens_at := p_at;
        if oa_policy.window_start is not null then
          opens_at := app.next_window_start(oa_policy.window_start, oa_policy.window_end, zone, p_at);
        end if;
        if opens_at <= p_at then
          return query select 'send'::text, 'consultation'::text, p_at, null::text, speaker, null::uuid, chosen_window;
          return;
        end if;
        if chosen_window = 'free'
          and opens_at < contact_at + least(make_interval(hours => settings.free_window_hours), api_window)
          and opens_at < msg.expires_at
        then
          return query select 'hold'::text, 'consultation'::text, opens_at, 'outside_hours'::text, speaker, null::uuid, chosen_window;
          return;
        end if;
      end if;
    end if;
  end if;

  if mode = 'free' then
    return query select 'send'::text, 'in_app'::text, p_at, 'outside_window'::text, speaker, null::uuid, null::text;
    return;
  end if;
  if not settings.zbs_enabled then
    return query select 'send'::text, 'in_app'::text, p_at, 'templates_disabled'::text, speaker, null::uuid, null::text;
    return;
  end if;
  if speaker is null then
    return query select 'send'::text, 'in_app'::text, p_at, 'no_oa'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  select z.* into template
  from public.zbs_templates z
  cross join lateral unnest(app.customer_template_purposes(msg.kind)) with ordinality as p (purpose, position)
  where z.oa_id = speaker
    and z.purpose = p.purpose
    and z.approval_state = 'approved'
  order by p.position, z.updated_at desc
  limit 1;
  if template.id is null then
    return query select 'send'::text, 'in_app'::text, p_at, 'no_template'::text, speaker, null::uuid, null::text;
    return;
  end if;
  if contact_user is null then
    select w.oa_user_id into contact_user from app.customer_oa_window(speaker, msg.subject_id) w;
  end if;
  select c.phone into phone from public.customers c where c.id = msg.subject_id;
  if contact_user is null and phone is null then
    return query select 'send'::text, 'in_app'::text, p_at, 'no_recipient'::text, speaker, null::uuid, null::text;
    return;
  end if;
  zbs_policy := app.effective_channel_policy(msg.tenant_id, 'zalo_zbs', msg.message_class);
  if zbs_policy.id is null or not zbs_policy.allowed or not zbs_policy.api_send_allowed then
    return query select 'send'::text, 'in_app'::text, p_at, 'not_allowed'::text, speaker, null::uuid, null::text;
    return;
  end if;
  release_instant := null;
  if zbs_policy.window_start is not null then
    opens_at := app.next_window_start(zbs_policy.window_start, zbs_policy.window_end, zone, p_at);
    if opens_at > p_at then
      release_instant := opens_at;
      hold_reason := 'outside_hours';
    end if;
  end if;
  if release_instant is null then
    select r.release_at, r.reason into cap_release, cap_reason from app.customer_cap_release(msg, 'zalo_zbs', zbs_policy, zone, p_at) r;
    if cap_reason is not null then
      release_instant := cap_release;
      hold_reason := cap_reason;
    end if;
  end if;
  if release_instant is null then
    select count(*)::integer into used
    from public.outbound_messages o
    where o.tenant_id = msg.tenant_id
      and o.channel_id is null
      and o.subject_type = 'customer'
      and o.channel = 'zalo_zbs'
      and o.status in ('sending', 'sent', 'delivered', 'uncertain')
      and o.params ->> 'oa_id' = speaker::text
      and coalesce(o.sent_at, o.claimed_at) >= date_trunc('day', p_at at time zone zone) at time zone zone;
    if used >= settings.zbs_daily_quota then
      release_instant := (date_trunc('day', p_at at time zone zone) + interval '1 day') at time zone zone;
      hold_reason := 'zbs_quota';
    end if;
  end if;
  if release_instant is not null then
    if zbs_policy.window_start is not null then
      release_instant := app.next_window_start(zbs_policy.window_start, zbs_policy.window_end, zone, release_instant);
    end if;
    if release_instant >= msg.expires_at then
      return query select 'send'::text, 'in_app'::text, p_at, hold_reason, speaker, template.id, null::text;
      return;
    end if;
    return query select 'hold'::text, 'template'::text, release_instant, hold_reason, speaker, template.id, null::text;
    return;
  end if;
  return query select 'send'::text, 'template'::text, p_at, null::text, speaker, template.id, null::text;
end;
$$;

comment on function app.customer_message_route(uuid, timestamptz) is 'the send decision of a waiting customer message at p_at (FR-NOT-39, FR-CMP-02, FR-CMP-16), first match wins: cancel expired, subject_removed (customer or membership gone, redacted), membership_inactive, messaging_disabled (the kind''s route is off), no_consent (loyalty), no_marketing_consent (advertising); in_app when the route is in_app; for a transactional message whose OA user interacted within free_window_hours (and the API''s 7 days, no unfollow since), a consultation message (window free), or after that window inside the 7 days while the OA''s out-of-window allowance of the month lasts (window allowance), held outside the consultation hours only while the free window stays open; in_app when the route is free; otherwise a ZBS template when zbs_enabled, an approved template of the OA serves the kind and the customer has an OA user id or a phone, held outside the template hours, at the customer''s caps (daily_cap, monthly_cap) and at the OA''s daily quota (zbs_quota), and in_app instead when that hold would outlast the message; in_app with the reason (templates_disabled, no_oa, no_template, no_recipient, not_allowed) when no template can go';

create function app.customer_message_parameters(p_message_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with msg as (
    select o.* from public.outbound_messages o where o.id = p_message_id
  ),
  zone as (
    select coalesce(t.timezone, 'Asia/Ho_Chi_Minh') as name from msg join public.tenants t on t.id = msg.tenant_id
  ),
  entry as (
    select l.* from msg join public.loyalty_ledger l on l.id = (msg.params ->> 'entry_id')::uuid and l.tenant_id = msg.tenant_id
  ),
  hold as (
    select d.* from msg join public.redemptions d on d.id = (msg.params ->> 'redemption_id')::uuid and d.tenant_id = msg.tenant_id
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'customer_name', (select nullif(btrim(c.name), '') from msg join public.customers c on c.id = msg.subject_id),
    'points', (msg.params -> 'points'),
    'stamps', (msg.params -> 'stamps'),
    'bill_no', (select nullif(btrim(i.receipt_no), '') from entry join public.invoices i on i.id = entry.invoice_id),
    'store_name', coalesce(
      (select s.name from entry join public.stores s on s.id = entry.store_id),
      (select s.name from hold join public.stores s on s.id = hold.store_id),
      (select s.name from public.stores s where s.id = msg.store_id)
    ),
    'reward_name', (select k.name from hold join public.coupons k on k.id = hold.coupon_id),
    'voucher_code', (select hold.code from hold),
    'expires_at', coalesce(
      (select to_char(hold.hold_expires_at at time zone (select name from zone), 'HH24:MI DD/MM/YYYY') from hold),
      (select to_char((msg.params ->> 'expires_on')::date, 'DD/MM/YYYY') where msg.params ->> 'expires_on' is not null)
    ),
    'inactive_days', (msg.params -> 'inactive_days')
  ))
  from msg;
$$;

comment on function app.customer_message_parameters(uuid) is 'the template parameters of a customer message, resolved at send time and never stored: customer_name, points, stamps, bill_no (the earn''s receipt number), store_name, reward_name, voucher_code, expires_at (the hold''s end or the expiry day in the tenant''s zone) and inactive_days, each only when known';

create function app.claim_next_customer_message(
  p_worker text,
  p_routes text[],
  p_lease interval default interval '2 minutes',
  p_at timestamptz default now(),
  p_tenant_id uuid default null
)
returns table (
  message_id uuid,
  claimed_at timestamptz,
  tenant_id uuid,
  kind text,
  route text,
  attempts smallint,
  oa_id uuid,
  window_kind text,
  template_external_id text,
  template_purpose text,
  template_tag text,
  recipient_kind text,
  recipient text,
  parameters jsonb,
  reader_timezone text
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  max_passes constant integer := 10;
  candidate record;
  verdict record;
  pass integer := 0;
  progressed boolean := true;
  consent uuid;
  template public.zbs_templates%rowtype;
  contact_user text;
  phone text;
begin
  while progressed and pass < max_passes loop
    pass := pass + 1;
    progressed := false;
    for candidate in
      select o.id, o.subject_id, o.tenant_id, o.message_class
      from public.outbound_messages o
      where o.subject_type = 'customer'
        and o.channel_id is null
        and o.status in ('queued', 'held')
        and o.kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back')
        and coalesce(o.not_before, o.created_at) <= p_at
        and (p_tenant_id is null or o.tenant_id = p_tenant_id)
      order by coalesce(o.not_before, o.created_at), o.created_at
      limit 20
      for update of o skip locked
    loop
      continue when candidate.subject_id is not null
        and not pg_try_advisory_xact_lock(hashtextextended('fnb-notify:customer:' || candidate.subject_id::text, 0));
      select * into verdict from app.customer_message_route(candidate.id, p_at);
      continue when verdict.decision is null;
      if verdict.decision = 'cancel' then
        update public.outbound_messages o
        set status = 'cancelled', decision = verdict.reason, hold_reason = null
        where o.id = candidate.id;
        progressed := true;
      elsif verdict.decision = 'hold' then
        update public.outbound_messages o
        set status = 'held', not_before = verdict.release_at, hold_reason = verdict.reason, decision = verdict.reason
        where o.id = candidate.id;
        progressed := progressed or coalesce(verdict.release_at > p_at, false);
      elsif verdict.route = 'in_app' then
        consent := app.customer_consent_record(candidate.tenant_id, candidate.subject_id,
          case when candidate.message_class = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end);
        update public.outbound_messages o
        set status = 'sending', channel = 'mini_app', claimed_at = p_at, lease_until = p_at + p_lease, attempts = o.attempts + 1,
            consent_record_id = coalesce(consent, o.consent_record_id)
        where o.id = candidate.id;
        update public.outbound_messages o
        set status = 'sent', sent_at = p_at, lease_until = null, decision = coalesce(verdict.reason, 'in_app'), hold_reason = null,
            cost_amount = 0, last_error_code = null,
            params = o.params || jsonb_build_object('route', 'in_app')
        where o.id = candidate.id;
        progressed := true;
      else
        continue when not (verdict.route = any (p_routes));
        consent := app.customer_consent_record(candidate.tenant_id, candidate.subject_id,
          case when candidate.message_class = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end);
        template := null;
        if verdict.template_id is not null then
          select z.* into template from public.zbs_templates z where z.id = verdict.template_id;
        end if;
        update public.outbound_messages o
        set status = 'sending',
            channel = case when verdict.route = 'consultation' then 'zalo_oa' else 'zalo_zbs' end,
            claimed_at = p_at,
            lease_until = p_at + p_lease,
            attempts = o.attempts + 1,
            send_started_at = null,
            hold_reason = null,
            decision = 'send',
            last_error_code = null,
            consent_record_id = coalesce(consent, o.consent_record_id),
            template_ref = case when verdict.route = 'template' then 'zbs.' || template.purpose || '.v1' else 'consultation.' || o.kind || '.v1' end,
            params = o.params || jsonb_strip_nulls(jsonb_build_object(
              'route', verdict.route,
              'oa_id', verdict.oa_id::text,
              'window', verdict.window_kind,
              'template_id', template.id::text
            ))
        where o.id = candidate.id;
        contact_user := null;
        select w.oa_user_id into contact_user from app.customer_oa_window(verdict.oa_id, candidate.subject_id) w;
        select c.phone into phone from public.customers c where c.id = candidate.subject_id;
        return query
          select o.id, o.claimed_at, o.tenant_id, o.kind, verdict.route, o.attempts, verdict.oa_id, verdict.window_kind,
                 template.external_id, template.purpose, template.tag,
                 case when contact_user is not null then 'uid' else 'phone' end,
                 coalesce(contact_user, regexp_replace(regexp_replace(phone, '^\+', ''), '^0', '84')),
                 app.customer_message_parameters(o.id),
                 coalesce(t.timezone, 'Asia/Ho_Chi_Minh')
          from public.outbound_messages o
          join public.tenants t on t.id = o.tenant_id
          where o.id = candidate.id;
        return;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function app.claim_next_customer_message(text, text[], interval, timestamptz, uuid) is 'the customer half of the dispatcher: locks due customer messages with skip locked in batches of 20 (at most 10 batches), takes app.customer_message_route under a per-customer advisory lock, cancels and holds on the way, closes in-app messages at once as sent on mini_app at no cost, and returns at most one consultation or template message whose route p_routes names as sending with a lease, with what the adapter needs and never stores: the OA, the template id, purpose and tag, the recipient (the OA user id as uid, else the phone in international digits without a plus sign) and the parameters; a route the dispatcher lacks leaves the message waiting';

create function app.begin_customer_send(p_message_id uuid, p_claimed_at timestamptz, p_at timestamptz)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  msg public.outbound_messages%rowtype;
begin
  select o.* into msg from public.outbound_messages o where o.id = p_message_id for update;
  if not found
    or app.customer_message_class(msg.kind) is null
    or msg.status <> 'sending'
    or msg.claimed_at is distinct from p_claimed_at
    or msg.lease_until < p_at
  then
    return false;
  end if;
  update public.outbound_messages o set send_started_at = p_at where o.id = p_message_id;
  return true;
end;
$$;

comment on function app.begin_customer_send(uuid, timestamptz, timestamptz) is 'marks the start of the provider call of a claimed customer message; false when the claim was lost (status, claim time or lease); nothing is rendered or stored';

create function app.finish_customer_send(
  p_message_id uuid,
  p_claimed_at timestamptz,
  p_outcome text,
  p_code text,
  p_provider_message_id text,
  p_retry_after_seconds integer,
  p_at timestamptz
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  msg public.outbound_messages%rowtype;
  code text := case when p_code is null then null when p_code ~ '^[a-z0-9_]{1,40}$' then p_code else 'unknown_error' end;
  provider_id text := left(p_provider_message_id, 200);
  next_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'reroute', 'failed', 'uncertain') then
    raise exception 'finish_customer_send needs the outcome sent, retry, reroute, failed or uncertain' using errcode = '22023';
  end if;
  select o.* into msg from public.outbound_messages o where o.id = p_message_id for update;
  if not found or app.customer_message_class(msg.kind) is null then
    return 'missing';
  end if;
  if msg.claimed_at is distinct from p_claimed_at then
    return 'lost';
  end if;
  if msg.status = 'uncertain' then
    if p_outcome <> 'sent' then
      return 'lost';
    end if;
    update public.outbound_messages o
    set status = 'sent', sent_at = p_at, provider_message_id = provider_id
    where o.id = p_message_id;
    next_status := 'sent';
  elsif msg.status <> 'sending' then
    return 'lost';
  else
    next_status := case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'failed' then 'failed'
      when p_outcome = 'uncertain' then 'uncertain'
      when p_outcome = 'reroute' and msg.channel = 'zalo_oa' then 'queued'
      when p_outcome = 'reroute' then 'failed'
      when msg.attempts >= 5 then 'failed'
      else 'queued'
    end;
    update public.outbound_messages o
    set status = next_status,
        sent_at = case when next_status = 'sent' then p_at else o.sent_at end,
        provider_message_id = case when next_status = 'sent' then provider_id else o.provider_message_id end,
        last_error_code = case when next_status = 'sent' then null else coalesce(code, p_outcome) end,
        not_before = case
          when next_status = 'queued' and p_outcome = 'reroute' then p_at
          when next_status = 'queued' then p_at + app.notify_backoff(msg.attempts, p_retry_after_seconds, msg.id)
          else o.not_before
        end,
        params = case when next_status = 'queued' and p_outcome = 'reroute' then o.params || '{"consultation_refused": true}'::jsonb else o.params end,
        send_started_at = case when next_status = 'queued' then null else o.send_started_at end,
        lease_until = null
    where o.id = p_message_id;
  end if;
  if msg.subject_id is not null and not exists (select 1 from public.customers c where c.id = msg.subject_id) then
    perform app.redact_outbound_for_subject(msg.tenant_id, 'customer', msg.subject_id);
    select o.status into next_status from public.outbound_messages o where o.id = p_message_id;
  end if;
  return next_status;
end;
$$;

comment on function app.finish_customer_send(uuid, timestamptz, text, text, text, integer, timestamptz) is 'records the provider''s answer for a claimed customer message: sent; retry back to queued after app.notify_backoff, failed once five attempts are used; reroute (the OA refused the consultation message, for example outside its window) back to queued at once with consultation_refused set, so the next decision goes on to the template or in-app; failed; uncertain, which is never resent (a timeout); a late sent turns uncertain into sent; when the customer was deleted while the message was being sent, the row is redacted at once (app.redact_outbound_for_subject); returns the new status, or lost and missing';

revoke all on function app.customer_template_purposes(text) from public, anon, authenticated, service_role;
revoke all on function app.customer_oa_window(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.customer_cap_release(public.outbound_messages, text, public.channel_policies, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_message_route(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_message_parameters(uuid) from public, anon, authenticated, service_role;
revoke all on function app.claim_next_customer_message(text, text[], interval, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function app.begin_customer_send(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.finish_customer_send(uuid, timestamptz, text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
