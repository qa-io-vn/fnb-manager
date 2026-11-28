-- "Món mang đi đã xong" (the owner's plan, notifications: the customer, in the app and by a ZBS message, after 22:00
-- in the app only; ADR-065, ADR-072): when a takeaway order of a customer's Zalo account turns ready, the order screen
-- shows it at once (in the app, always), and a customer who joined the stamp programme with a phone also gets a
-- customer message through the existing outbox (ADR-030, phase 19a): kind takeaway_ready, routed when the dispatcher
-- claims it like every customer message, so it goes as a free OA consultation inside the window, as the ZBS template
-- order_ready between 06:00 and 22:00 when the tenant's ZBS is on and Zalo approved that template (off until then; a
-- mock in tests), and otherwise closes in the app. It expires an hour after the order turned ready, so a message held
-- by the night window closes in the app instead of waking the customer at 06:00.

-- 1. The kind on the outbox ----------------------------------------------------------------------------------------

alter table public.outbound_messages drop constraint outbound_messages_kind_check;
alter table public.outbound_messages add constraint outbound_messages_kind_check check (kind is null or kind in (
  'digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved', 'test', 'link_code', 'link_notice', 'link_confirmation',
  'announcement', 'request_decided', 'staff_digest', 'points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday',
  'win_back', 'takeaway_ready'
));

alter table public.outbound_messages drop constraint outbound_messages_queue_shape;
alter table public.outbound_messages add constraint outbound_messages_queue_shape check (
  kind is null
  or (
    message_class is not null
    and dedupe_key is not null
    and (
      channel_id is not null
      or status in ('sending', 'sent', 'delivered', 'failed', 'cancelled', 'uncertain')
      or (subject_type = 'customer' and kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back', 'takeaway_ready'))
    )
  )
);

alter table public.outbound_messages drop constraint outbound_messages_customer_shape;
alter table public.outbound_messages add constraint outbound_messages_customer_shape check (
  kind is null
  or kind not in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back', 'takeaway_ready')
  or (
    subject_type = 'customer'
    and channel_id is null
    and channel in ('mini_app', 'zalo_oa', 'zalo_zbs')
    and title is null
    and body is null
    and (recipient_ref = 'redacted' or recipient_ref ~ '^membership:[0-9a-f-]{36}$')
  )
);

comment on constraint outbound_messages_customer_shape on public.outbound_messages is 'a customer message (points_confirmed, coupon_issued, voucher_expiring, expiry_reminder, birthday, win_back, takeaway_ready) has a customer subject, no destination row, the channel mini_app, zalo_oa or zalo_zbs, an opaque membership:<id> recipient and never a title or body: personal parameters are resolved at send time and never stored (NFR-PRV-02)';

-- 2. Its class, route setting, template purpose and parameters ----------------------------------------------------

alter table app.customer_message_settings
  add column order_ready_route text not null default 'template' check (order_ready_route in ('off', 'in_app', 'free', 'template'));

comment on column app.customer_message_settings.order_ready_route is 'how far "takeaway ready" may go (off, in_app, free, template; template by default: the free consultation inside the window, else the ZBS template order_ready when zbs_enabled and approved, else in the app)';

create or replace function app.customer_message_class(p_kind text)
returns public.message_class
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'takeaway_ready') then 'transactional'::public.message_class
    when p_kind in ('birthday', 'win_back') then 'advertising'::public.message_class
  end;
$$;

comment on function app.customer_message_class(text) is 'the message class of a customer message kind: transactional for points_confirmed, coupon_issued, voucher_expiring, expiry_reminder and takeaway_ready, advertising for birthday and win_back, null for any other kind';

create or replace function app.customer_message_route_setting(p_tenant_id uuid, p_kind text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.tenant_id is null or not s.enabled then 'off'
    when p_kind = 'points_confirmed' then s.points_route
    when p_kind = 'coupon_issued' then s.coupon_route
    when p_kind = 'voucher_expiring' then s.voucher_expiring_route
    when p_kind = 'expiry_reminder' then s.expiry_route
    when p_kind = 'takeaway_ready' then s.order_ready_route
    when p_kind in ('birthday', 'win_back') then case when s.promotions_enabled then 'template' else 'off' end
    else 'off'
  end
  from (select p_tenant_id as tenant_id) t
  left join app.customer_message_settings s on s.tenant_id = t.tenant_id;
$$;

comment on function app.customer_message_route_setting(uuid, text) is 'how far a customer message kind may go for the tenant: off (no message), in_app, free or template; off when messaging is not enabled, and birthday and win_back are template only with promotions_enabled';

create or replace function app.customer_template_purposes(p_kind text)
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
    when 'takeaway_ready' then array['order_ready']
    else array[]::text[]
  end;
$$;

comment on function app.customer_template_purposes(text) is 'the zbs_templates purposes a customer message kind may use, in order of preference: points_confirmation; voucher (the Voucher layout that carries the code) then coupon_issued; voucher; expiry_reminder; birthday; win_back; order_ready';

create or replace function app.customer_message_parameters(p_message_id uuid)
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
  ),
  native_order as (
    select o.*, s.timezone as store_zone from msg
    join public.orders o on o.id = (msg.params ->> 'order_id')::uuid and o.tenant_id = msg.tenant_id
    join public.stores s on s.id = o.store_id
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'customer_name', (select nullif(btrim(c.name), '') from msg join public.customers c on c.id = msg.subject_id),
    'points', (msg.params -> 'points'),
    'stamps', (msg.params -> 'stamps'),
    'bill_no', (select nullif(btrim(i.receipt_no), '') from entry join public.invoices i on i.id = entry.invoice_id),
    'store_name', coalesce(
      (select s.name from entry join public.stores s on s.id = entry.store_id),
      (select s.name from hold join public.stores s on s.id = hold.store_id),
      (select s.name from native_order join public.stores s on s.id = native_order.store_id),
      (select s.name from public.stores s where s.id = msg.store_id)
    ),
    'reward_name', (select k.name from hold join public.coupons k on k.id = hold.coupon_id),
    'voucher_code', (select hold.code from hold),
    'expires_at', coalesce(
      (select to_char(hold.hold_expires_at at time zone (select name from zone), 'HH24:MI DD/MM/YYYY') from hold),
      (select to_char((msg.params ->> 'expires_on')::date, 'DD/MM/YYYY') where msg.params ->> 'expires_on' is not null)
    ),
    'inactive_days', (msg.params -> 'inactive_days'),
    'order_no', (select app.order_display_no(native_order.order_no) from native_order),
    'pickup_time', (select to_char(coalesce(native_order.pickup_at, native_order.done_at) at time zone native_order.store_zone, 'HH24:MI') from native_order)
  ))
  from msg;
$$;

comment on function app.customer_message_parameters(uuid) is 'the template parameters of a customer message, resolved at send time and never stored: customer_name, points, stamps, bill_no (the earn''s receipt number), store_name, reward_name, voucher_code, expires_at (the hold''s end or the expiry day in the tenant''s zone), inactive_days, and for a native order order_no (#007) and pickup_time (its pick-up, else when it turned ready, HH:MI in the store''s zone), each only when known';

create or replace function app.claim_next_customer_message(
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
        and o.kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back', 'takeaway_ready')
        and coalesce(o.not_before, o.created_at) <= p_at
        and (p_tenant_id is null or o.tenant_id = p_tenant_id)
      order by coalesce(o.not_before, o.created_at), o.created_at
      limit 20
      for update of o skip locked
    loop
      continue when candidate.subject_id is not null
        and not pg_try_advisory_xact_lock(hashtextextended('fnb-notify:customer:' || candidate.subject_id::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('fnb-notify:customer-quota:' || candidate.tenant_id::text, 0));
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

comment on function app.claim_next_customer_message(text, text[], interval, timestamptz, uuid) is 'the customer half of the dispatcher: locks due customer messages (the six loyalty kinds and takeaway_ready) with skip locked in batches of 20 (at most 10 batches), takes app.customer_message_route under a per-customer advisory lock, cancels and holds on the way, closes in-app messages at once as sent on mini_app at no cost, and returns at most one consultation or template message whose route p_routes names as sending with a lease, with what the adapter needs and never stores: the OA, the template id, purpose and tag, the recipient (the OA user id as uid, else the phone in international digits without a plus sign) and the parameters; a route the dispatcher lacks leaves the message waiting; the send decision of each candidate is taken under a transaction advisory lock of its tenant so two claimers cannot both count the same quota and overshoot it';

-- 3. Queued when a takeaway order turns ready ----------------------------------------------------------------------

create function app.enqueue_takeaway_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership uuid;
begin
  if not exists (select 1 from app.customer_message_settings s where s.tenant_id = new.tenant_id and s.enabled) then
    return null;
  end if;
  select m.id into v_membership
  from app.customer_logins l
  join public.memberships m on m.tenant_id = l.tenant_id and m.customer_id = l.customer_id and m.status = 'active'
  where l.id = new.customer_login_id
  order by (m.brand_id is not distinct from new.brand_id) desc, m.joined_at, m.id
  limit 1;
  if v_membership is null then
    return null;
  end if;
  begin
    perform app.enqueue_customer_message(
      new.tenant_id,
      v_membership,
      'takeaway_ready',
      'order:' || new.id::text,
      jsonb_build_object('order_id', new.id::text),
      new.store_id,
      coalesce(new.done_at, now()) + interval '1 hour',
      coalesce(new.done_at, now())
    );
  exception when others then
    raise warning 'the takeaway ready message was not queued (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.enqueue_takeaway_ready() is 'trigger after a takeaway order of a customer''s Zalo account turns ready: when the tenant''s customer messages are on and the login joined the stamp programme (an active membership, the one of the order''s brand first), queues one takeaway_ready message keyed on the order, expiring an hour after it turned ready; a visitor gets the order screen only; a failure to queue never fails the order''s move';

create trigger orders_takeaway_ready_message
after update of status on public.orders
for each row
when (new.status = 'ready' and old.status is distinct from 'ready' and new.order_type = 'takeaway' and new.customer_login_id is not null)
execute function app.enqueue_takeaway_ready();

revoke all on function app.enqueue_takeaway_ready() from public, anon, authenticated, service_role;
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('customer_message_class', 'customer_message_route_setting', 'customer_template_purposes', 'customer_message_parameters',
        'claim_next_customer_message')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;
