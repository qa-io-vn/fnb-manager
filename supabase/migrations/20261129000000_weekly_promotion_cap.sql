-- The weekly cap of promotional Zalo messages (the owner's plan, notifications: "Ưu đãi mới → Khách đã bật nhận tin →
-- Tin Zalo → Tối đa 2 tin mỗi tuần, chỉ gửi khi khách đồng ý"; the design's C12 switch "Nhận tin ưu đãi qua Zalo ·
-- Tối đa 2 tin mỗi tuần"; GA-065; ADR-073). channel_policies had a cap per day (local or rolling 24 hours) and per month
-- only. A policy row now also carries max_per_week, counted over a rolling 7 days, and the customer's send decision
-- (app.customer_cap_release, under app.customer_message_route at claim time, ADR-030) holds a message at it until the
-- exact instant the oldest counted one is 7 days old, or closes it in the app when that would outlast the message.
-- The opt-in text promises at most two a week, so a Zalo advertising row that may send is bound to 1 or 2 a week by a
-- CHECK constraint, as the legal floors are (ADR-030): a row written without the number takes the promised 2.

-- 1. The column and the floor -----------------------------------------------------------------------------------------

alter table public.channel_policies
  add column max_per_week smallint check (max_per_week is null or max_per_week between 1 and 100);

comment on column public.channel_policies.max_per_week is 'the most messages of the class a recipient gets on the channel in a rolling 7 days (a message sent exactly 7 days before no longer counts); null for no weekly cap; a Zalo advertising row that may send is bound to 1 or 2 (channel_policies_advertising_weekly), the promise of the opt-in text';

create function app.channel_policy_weekly_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.message_class = 'advertising' and new.channel_kind in ('zalo_oa', 'zalo_zbs') and new.max_per_week is null then
    new.max_per_week := 2;
  end if;
  return new;
end;
$$;

comment on function app.channel_policy_weekly_default() is 'trigger before an insert or update of channel_policies: a Zalo advertising row (zalo_oa, zalo_zbs) written without max_per_week takes the 2 a week the customer''s opt-in text promises';

create trigger channel_policies_weekly_default
before insert or update on public.channel_policies
for each row execute function app.channel_policy_weekly_default();

update public.channel_policies p
set max_per_week = 2
where p.message_class = 'advertising'
  and p.channel_kind in ('zalo_oa', 'zalo_zbs')
  and p.max_per_week is null;

alter table public.channel_policies add constraint channel_policies_advertising_weekly check (
  message_class <> 'advertising'
  or channel_kind not in ('zalo_oa', 'zalo_zbs')
  or not allowed
  or coalesce(max_per_week between 1 and 2, false)
);

comment on constraint channel_policies_advertising_weekly on public.channel_policies is 'a Zalo advertising policy that may send (zalo_oa, zalo_zbs, allowed) caps each customer at 1 or 2 messages in a rolling 7 days: the C12 opt-in promises "tối đa 2 tin mỗi tuần" (GA-065, ADR-073)';

revoke all on function app.channel_policy_weekly_default() from public, anon, authenticated, service_role;

-- 2. The customer's send decision counts the week --------------------------------------------------------------------

create or replace function app.customer_cap_release(
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
  if p_policy.max_per_week is not null then
    period_start := p_at - interval '7 days';
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
      and coalesce(o.sent_at, o.claimed_at) > period_start;
    if counted >= p_policy.max_per_week then
      select coalesce(o.sent_at, o.claimed_at) + interval '7 days' into release_instant
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
      offset counted - p_policy.max_per_week
      limit 1;
      return query select release_instant, 'weekly_cap'::text;
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

comment on function app.customer_cap_release(public.outbound_messages, text, public.channel_policies, text, timestamptz) is 'the per-user caps of a channel policy applied to one customer, first reached wins: the day (a local day, or a rolling 24 hours: Tag 3 allows 1), the week (a rolling 7 days: a message counts while it was sent less than 7 days before p_at; 2 for Zalo promotions, GA-065) and the month (30 for Tag 3); the release instant (for the rolling windows, the instant the oldest message that keeps the count at the cap leaves the window) and daily_cap, weekly_cap or monthly_cap when the customer''s messages of the class on the channel already reached a cap, no row otherwise';

comment on function app.customer_message_route(uuid, timestamptz) is 'the send decision of a waiting customer message at p_at (FR-NOT-39, FR-CMP-02, FR-CMP-16), first match wins: cancel expired, subject_removed (customer or membership gone, redacted), membership_inactive, messaging_disabled (the kind''s route is off), no_consent (loyalty), no_marketing_consent (advertising); in_app when the route is in_app; for a transactional message whose OA user interacted within free_window_hours (and the API''s 7 days, no unfollow since), a consultation message (window free), or after that window inside the 7 days while the OA''s out-of-window allowance of the month lasts (window allowance), held outside the consultation hours only while the free window stays open; in_app when the route is free; otherwise a ZBS template when zbs_enabled, an approved template of the OA serves the kind and the customer has an OA user id or a phone, held outside the template hours, at the customer''s caps (daily_cap, weekly_cap: 2 promotions in a rolling 7 days, monthly_cap) and at the OA''s daily quota (zbs_quota), and in_app instead when that hold would outlast the message; in_app with the reason (templates_disabled, no_oa, no_template, no_recipient, not_allowed) when no template can go';
