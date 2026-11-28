-- C12 "Thông báo" (`/thong-bao`; the owner's plan, phase 2: "Hộp thông báo (C12)"; GA-063 to GA-066; ADR-073): the
-- customer's notifications inbox, its marketing switch and its retention.
--
-- The inbox is written by the events that already exist, never by a parallel pipeline: an order's append-only event
-- log (public.order_events: ready or brought to the table, paid, cancelled by the shop, refunded), the stamp card's
-- append-only ledger (public.stamp_entries: stamps added, a card complete) and the customer outbox when a promotion is
-- delivered (birthday, win_back). The same order trigger queues the paid Zalo messages the plan asks for, so the item in
-- the app and the ZBS message come from one event and one decision table: an order that turned ready or was brought to
-- the table, a payment and the stamps are in the app only (no cost; table orders never get a Zalo message, and the
-- takeaway's ZBS stays with its own trigger, migration takeaway_ready_message); a cancellation by the shop of an order
-- that was paid queues order_cancelled five minutes later, which a refund in that time replaces; a refund other than
-- cash handed back at the counter queues order_refunded with the amount and the day (migration
-- order_cancel_refund_messages). Promotions reach the inbox only for a customer who gave the marketing consent.
--
-- The customer reads their own items (20 a page, newest first, filtered by orders or offers), the unread count for the
-- bell, and marks items read (some, or all). "Nhận tin ưu đãi qua Zalo" records the marketing consent with its evidence
-- (who, when, the privacy notice's version and the opt-in text's version); stopping is the existing
-- customer_stop_marketing. Items are kept 90 days (purged hourly), go with the login when the account is deleted
-- (C19, dsr_delete) and are part of the customer's copy of their data and of the owner's DSR export.

-- 1. Rate limits of the two writes ------------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website', 'staff_clock_in', 'counter_member_lookup',
  'customer_stamp_code', 'customer_invoice_request', 'customer_change_pickup', 'customer_inbox_read', 'customer_marketing'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('customer_inbox_read', 'calls', 120, 10000, interval '15 minutes', interval '15 minutes'),
  ('customer_marketing', 'calls', 10, 1000, interval '15 minutes', interval '15 minutes');

-- 2. The inbox --------------------------------------------------------------------------------------------------------

create table app.customer_inbox (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  kind text not null check (kind in ('order_ready', 'order_receipt', 'order_cancelled', 'order_refunded', 'stamp', 'reward', 'offer')),
  topic text not null generated always as (
    case when kind in ('order_ready', 'order_receipt', 'order_cancelled', 'order_refunded') then 'orders' else 'offers' end
  ) stored,
  order_id uuid,
  params jsonb not null default '{}'::jsonb check (app.facts_are_count_only(params)),
  title text check (title is null or (char_length(title) between 1 and 80 and title !~ '[[:cntrl:]]')),
  line text check (line is null or (char_length(line) between 1 and 160 and line !~ '[[:cntrl:]]')),
  dedupe_key text not null check (dedupe_key ~ '^[a-z0-9][a-z0-9_:.-]{0,119}$'),
  created_at timestamptz not null,
  read_at timestamptz,
  unique (customer_login_id, dedupe_key),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  check (kind = 'offer' or (title is null and line is null)),
  check (kind not like 'order\_%' or order_id is not null),
  check (read_at is null or read_at >= created_at - interval '1 minute')
);

create index customer_inbox_login_idx on app.customer_inbox (customer_login_id, seq desc);
create index customer_inbox_unread_idx on app.customer_inbox (customer_login_id) where read_at is null;
create index customer_inbox_created_idx on app.customer_inbox (created_at);
create index customer_inbox_tenant_idx on app.customer_inbox (tenant_id);
create index customer_inbox_order_idx on app.customer_inbox (order_id) where order_id is not null;

comment on table app.customer_inbox is 'C12 "Thông báo": the notifications of a customer''s Zalo login, written only by the triggers on order events, stamp entries and delivered promotions and by app.customer_inbox_offer; one item per login and event (dedupe_key); count-only parameters (the order''s items, table and totals are read from the order when the item is shown, never copied); campaign text only on an offer; read_at set by the customer; kept 90 days (app.purge_customer_inbox), deleted with the login; read by no API role';
comment on column app.customer_inbox.seq is 'the order items were written in, newest highest: the page cursor of customer_inbox';
comment on column app.customer_inbox.topic is 'the filter an item belongs to: orders for the order kinds, offers for stamps, rewards and promotions';
comment on column app.customer_inbox.params is 'count-only facts of the event (amounts, stamps, a cancel reason code, a payment method code, the promotion kind)';

alter table app.customer_inbox enable row level security;
revoke all on table app.customer_inbox from public, anon, authenticated, service_role;

create function app.customer_inbox_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '90 days';
$$;

comment on function app.customer_inbox_retention() is 'how long an inbox item is shown and kept: 90 days (GA-063)';

-- 3. The writers ------------------------------------------------------------------------------------------------------

create function app.customer_inbox_add(
  p_tenant_id uuid,
  p_login_id uuid,
  p_kind text,
  p_dedupe_key text,
  p_params jsonb,
  p_order_id uuid,
  p_title text,
  p_line text,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from app.customer_logins l where l.id = p_login_id and l.tenant_id = p_tenant_id) then
    return null;
  end if;
  insert into app.customer_inbox (tenant_id, customer_login_id, kind, order_id, params, title, line, dedupe_key, created_at)
  values (p_tenant_id, p_login_id, p_kind, p_order_id, coalesce(jsonb_strip_nulls(p_params), '{}'::jsonb), p_title, p_line, p_dedupe_key, coalesce(p_at, now()))
  on conflict (customer_login_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.customer_inbox_add(uuid, uuid, text, text, jsonb, uuid, text, text, timestamptz) is 'the one insert path of the inbox: one item per login and dedupe key (a repeated event writes nothing and answers null), only for a login of the tenant';

create function app.customer_order_membership(p_order public.orders)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from app.customer_logins l
  join public.memberships m on m.tenant_id = l.tenant_id and m.customer_id = l.customer_id and m.status = 'active'
  where l.id = p_order.customer_login_id
  order by (m.brand_id is not distinct from p_order.brand_id) desc, m.joined_at, m.id
  limit 1;
$$;

comment on function app.customer_order_membership(public.orders) is 'the active membership a paid Zalo message about an order goes to: the order''s login joined with a phone, the membership of the order''s brand first; null for a visitor';

create function app.customer_order_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_member uuid;
  v_message uuid;
  v_due numeric;
  v_day date;
begin
  if new.kind not in ('status', 'payment') then
    return null;
  end if;
  select o.* into v_order from public.orders o where o.id = new.order_id;
  if v_order.id is null or v_order.customer_login_id is null then
    return null;
  end if;
  begin
    if new.kind = 'status' and new.to_state in ('ready', 'serving') and new.from_state is distinct from new.to_state then
      perform app.customer_inbox_add(v_order.tenant_id, v_order.customer_login_id, 'order_ready', 'order:' || v_order.id::text || ':ready',
        jsonb_build_object('order_type', v_order.order_type), v_order.id, null, null, new.occurred_at);
    elsif new.kind = 'status' and new.to_state = 'cancelled' and new.actor_kind <> 'customer' then
      v_due := case when coalesce(new.amount, 0) > 0 then new.amount end;
      perform app.customer_inbox_add(v_order.tenant_id, v_order.customer_login_id, 'order_cancelled', 'order:' || v_order.id::text || ':cancelled',
        jsonb_build_object('reason', v_order.cancel_reason, 'refund_due', v_due::bigint, 'by', new.actor_kind), v_order.id, null, null, new.occurred_at);
      if v_due is not null then
        v_member := app.customer_order_membership(v_order);
        if v_member is not null then
          v_message := app.enqueue_customer_message(v_order.tenant_id, v_member, 'order_cancelled', 'order:' || v_order.id::text,
            jsonb_build_object('order_id', v_order.id::text, 'amount', v_due::bigint), v_order.store_id, null, new.occurred_at);
          update public.outbound_messages o
          set not_before = new.occurred_at + interval '5 minutes'
          where o.id = v_message and o.status = 'queued' and o.not_before is null;
        end if;
      end if;
    elsif new.kind = 'payment' and new.action = 'paid' and coalesce(new.amount, 0) > 0 then
      perform app.customer_inbox_add(v_order.tenant_id, v_order.customer_login_id, 'order_receipt', 'order:' || v_order.id::text || ':paid',
        jsonb_build_object('amount', new.amount::bigint, 'method', new.reason_code), v_order.id, null, null, new.occurred_at);
    elsif new.kind = 'payment' and new.action = 'payment_voided' then
      delete from app.customer_inbox i
      where i.customer_login_id = v_order.customer_login_id and i.dedupe_key = 'order:' || v_order.id::text || ':paid';
    elsif new.kind = 'payment' and new.action = 'refunded' and coalesce(new.amount, 0) > 0 then
      v_day := (new.occurred_at at time zone coalesce((select s.timezone from public.stores s where s.id = v_order.store_id), 'Asia/Ho_Chi_Minh'))::date;
      perform app.customer_inbox_add(v_order.tenant_id, v_order.customer_login_id, 'order_refunded', 'order:' || v_order.id::text || ':refund:' || new.id::text,
        jsonb_build_object('amount', new.amount::bigint, 'method', new.reason_code, 'refunded_on', to_char(v_day, 'YYYY-MM-DD')),
        v_order.id, null, null, new.occurred_at);
      update public.outbound_messages o
      set status = 'cancelled', decision = 'superseded', hold_reason = null
      where o.tenant_id = v_order.tenant_id
        and o.dedupe_key = 'customer:order_cancelled:order:' || v_order.id::text
        and o.status in ('queued', 'held');
      if new.reason_code is distinct from 'cash' then
        v_member := app.customer_order_membership(v_order);
        if v_member is not null then
          perform app.enqueue_customer_message(v_order.tenant_id, v_member, 'order_refunded', 'order:' || v_order.id::text || ':' || new.id::text,
            jsonb_build_object('order_id', v_order.id::text, 'amount', new.amount::bigint, 'refunded_on', to_char(v_day, 'YYYY-MM-DD')),
            v_order.store_id, null, new.occurred_at);
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'the customer''s notice of an order event was not written (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.customer_order_notices() is 'trigger after an order event of a customer''s Zalo order, the decision table of the owner''s plan: ready (takeaway) or serving (table) writes order_ready in the app only; a payment above 0 writes order_receipt (withdrawn when the payment is voided); a cancellation by the shop or the system writes order_cancelled with the reason and, for a paid order, the refund due, and queues the paid message order_cancelled for a member five minutes on; a refund writes order_refunded with the amount, the method and the day, replaces an order_cancelled message not sent yet (superseded), and queues order_refunded for a member unless it was cash handed back at the counter; the customer''s own cancellation writes nothing; a failure never fails the order''s move';

create trigger order_events_customer_notices
after insert on public.order_events
for each row execute function app.customer_order_notices();

create function app.customer_stamp_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login uuid;
  v_per integer;
begin
  if new.kind <> 'order_earned' or new.delta <= 0 then
    return null;
  end if;
  begin
    select c.customer_login_id into v_login from public.stamp_cards c where c.id = new.card_id;
    select s.stamps_per_reward into v_per from app.stamp_settings(new.brand_id) s;
    if new.balance_after >= v_per then
      perform app.customer_inbox_add(new.tenant_id, v_login, 'reward', 'stamp:' || new.id::text,
        jsonb_build_object('added', new.delta, 'rewards', new.balance_after / v_per, 'stamps', new.balance_after % v_per, 'per', v_per),
        null, null, null, new.occurred_at);
    else
      perform app.customer_inbox_add(new.tenant_id, v_login, 'stamp', 'stamp:' || new.id::text,
        jsonb_build_object('added', new.delta, 'stamps', new.balance_after, 'left', v_per - new.balance_after, 'per', v_per),
        null, null, null, new.occurred_at);
    end if;
  exception when others then
    raise warning 'the customer''s notice of stamps was not written (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.customer_stamp_notices() is 'trigger after a stamp entry ("Cộng dấu, đủ 9 dấu → Hộp thông báo trong app C12 → Không tốn phí"): stamps earned by an order write stamp (added, stamps, left to the next reward), or reward when they complete a card (added, rewards, stamps left on the new card); in the app only; a failure never fails the order';

create trigger stamp_entries_customer_notices
after insert on public.stamp_entries
for each row execute function app.customer_stamp_notices();

create function app.customer_offer_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login uuid;
begin
  begin
    for v_login in
      select l.id from app.customer_logins l where l.tenant_id = new.tenant_id and l.customer_id = new.subject_id
    loop
      perform app.customer_inbox_add(new.tenant_id, v_login, 'offer', 'message:' || new.id::text,
        jsonb_build_object('offer', new.kind, 'inactive_days', new.params -> 'inactive_days'), null, null, null, coalesce(new.sent_at, now()));
    end loop;
  exception when others then
    raise warning 'the customer''s notice of a promotion was not written (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.customer_offer_notices() is 'trigger after a promotion of the customer outbox (birthday, win_back: advertising, sent only with the marketing consent and within the caps) is delivered, in the app or on Zalo: an offer item for each Zalo login of the customer';

create trigger outbound_messages_customer_offer_notices
after update of status on public.outbound_messages
for each row
when (new.subject_type = 'customer' and new.kind in ('birthday', 'win_back') and new.status = 'sent' and old.status is distinct from 'sent')
execute function app.customer_offer_notices();

create function app.customer_inbox_offer(
  p_tenant_id uuid,
  p_login_id uuid,
  p_offer_key text,
  p_title text,
  p_line text,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins;
  v_title text := nullif(btrim(p_title), '');
  v_line text := nullif(btrim(p_line), '');
begin
  if p_offer_key is null or p_offer_key !~ '^[a-z0-9][a-z0-9_:.-]{0,80}$' then
    raise exception 'an offer is named by a key of lower-case letters, digits, _, :, . or -' using errcode = '22023';
  end if;
  if v_title is null or char_length(v_title) > 80 or v_title ~ '[[:cntrl:]]'
    or v_line is null or char_length(v_line) > 160 or v_line ~ '[[:cntrl:]]'
  then
    raise exception 'an offer has a title of 1 to 80 and a line of 1 to 160 characters on one line' using errcode = '22023';
  end if;
  select l.* into v_login from app.customer_logins l where l.id = p_login_id and l.tenant_id = p_tenant_id;
  if v_login.id is null or v_login.customer_id is null
    or app.customer_consent_record(p_tenant_id, v_login.customer_id, 'marketing') is null
  then
    return null;
  end if;
  return app.customer_inbox_add(p_tenant_id, p_login_id, 'offer', 'offer:' || p_offer_key, jsonb_build_object('offer', 'campaign'),
    null, v_title, v_line, p_at);
end;
$$;

comment on function app.customer_inbox_offer(uuid, uuid, text, text, text, timestamptz) is 'the inbox side of a campaign (GA-066, for the offers of C13 and S13 when they are built): one offer item with the campaign''s title and line for a login of the tenant whose customer gave the marketing consent; null and nothing written for a visitor or without the consent; a repeated key writes nothing; 22023 for a malformed key or text; no API role may call it';

-- 4. What the customer reads -------------------------------------------------------------------------------------------

create function app.customer_inbox_item_json(p_item app.customer_inbox)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id,
    'cursor', p_item.seq,
    'kind', p_item.kind,
    'topic', p_item.topic,
    'created_at', p_item.created_at,
    'read_at', p_item.read_at,
    'target', case
      when p_item.topic = 'orders' then 'order'
      when p_item.kind in ('stamp', 'reward') then 'stamps'
      else 'offers'
    end,
    'order_id', p_item.order_id,
    'order', (
      select jsonb_build_object(
        'display_no', app.order_display_no(o.order_no),
        'type', o.order_type,
        'table_label', o.table_label,
        'status', o.status,
        'payment_status', o.payment_status,
        'total', o.total::bigint,
        'pickup_at', o.pickup_at,
        'cancel_reason', o.cancel_reason,
        'first_item', (select l.item_name from public.order_lines l where l.order_id = o.id order by l.line_no limit 1),
        'items', (select coalesce(sum(l.quantity), 0)::integer from public.order_lines l where l.order_id = o.id)
      )
      from public.orders o
      where o.id = p_item.order_id and o.customer_login_id = p_item.customer_login_id
    ),
    'reward_name', case when p_item.kind in ('stamp', 'reward') then (
      select s.reward_name
      from app.customer_logins l
      join public.zalo_apps a on a.id = l.zalo_app_id
      cross join lateral app.stamp_settings(a.brand_id) s
      where l.id = p_item.customer_login_id
    ) end,
    'params', p_item.params,
    'title', p_item.title,
    'line', p_item.line
  );
$$;

comment on function app.customer_inbox_item_json(app.customer_inbox) is 'an inbox item as the customer sees it: its kind, filter, times, where it leads (order: C06; stamps: C07; offers), the order''s number, type, table, state, total, first item and item count read now from the customer''s own order, the brand''s reward name for stamps, the count-only parameters and an offer''s campaign text';

create function app.customer_inbox_marketing(p_login app.customer_logins)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'member', p_login.customer_id is not null,
    'consent', p_login.customer_id is not null and app.customer_consent_record(p_login.tenant_id, p_login.customer_id, 'marketing') is not null,
    'weekly_cap', coalesce((app.effective_channel_policy(p_login.tenant_id, 'zalo_zbs', 'advertising')).max_per_week, 2)
  );
$$;

comment on function app.customer_inbox_marketing(app.customer_logins) is 'the state of "Nhận tin ưu đãi qua Zalo" for a login: whether it joined with a phone (member; only a member can give the consent), whether the marketing consent is active, and the weekly cap the policy in force applies (2)';

create function app.customer_inbox(p_filter text default 'all', p_before bigint default null, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_rows app.customer_inbox[];
  v_items jsonb;
begin
  if p_filter is null or p_filter not in ('all', 'orders', 'offers') then
    raise exception 'the inbox filter is all, orders or offers' using errcode = '22023';
  end if;
  if p_before is not null and p_before < 1 then
    raise exception 'the inbox cursor is a positive number' using errcode = '22023';
  end if;
  select coalesce(array_agg(t.item order by (t.item).seq desc), '{}') into v_rows
  from (
    select x as item from app.customer_inbox x
    where x.customer_login_id = v_login.id
      and x.tenant_id = v_login.tenant_id
      and x.created_at > p_at - app.customer_inbox_retention()
      and (p_filter = 'all' or x.topic = p_filter)
      and (p_before is null or x.seq < p_before)
    order by x.seq desc
    limit 21
  ) t;
  select coalesce(jsonb_agg(app.customer_inbox_item_json(r) order by r.seq desc), '[]'::jsonb) into v_items
  from unnest(v_rows[1:20]) r;
  return jsonb_build_object(
    'filter', p_filter,
    'items', v_items,
    'next_before', case when cardinality(v_rows) > 20 then (v_rows[20]).seq end,
    'unread', (
      select count(*)::integer from app.customer_inbox x
      where x.customer_login_id = v_login.id and x.read_at is null and x.created_at > p_at - app.customer_inbox_retention()
    ),
    'unread_by_topic', jsonb_build_object(
      'orders', (select count(*)::integer from app.customer_inbox x
        where x.customer_login_id = v_login.id and x.read_at is null and x.topic = 'orders' and x.created_at > p_at - app.customer_inbox_retention()),
      'offers', (select count(*)::integer from app.customer_inbox x
        where x.customer_login_id = v_login.id and x.read_at is null and x.topic = 'offers' and x.created_at > p_at - app.customer_inbox_retention())
    ),
    'marketing', app.customer_inbox_marketing(v_login)
  );
end;
$$;

comment on function app.customer_inbox(text, bigint, timestamptz) is 'C12: the caller''s own inbox, newest first, 20 a page (next_before is the cursor of the next page, null on the last), filtered by all, orders or offers, items older than 90 days left out; with the unread count of every item and per filter, and the marketing switch''s state; 22023 for another filter or a cursor below 1; 42501 without a customer session';

create function app.customer_inbox_unread(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
begin
  return jsonb_build_object(
    'unread', (
      select count(*)::integer from app.customer_inbox x
      where x.customer_login_id = v_login.id and x.read_at is null and x.created_at > p_at - app.customer_inbox_retention()
    )
  );
end;
$$;

comment on function app.customer_inbox_unread(timestamptz) is 'the bell''s badge: how many of the caller''s inbox items of the last 90 days are unread; 42501 without a customer session';

create function app.customer_inbox_read(p_ids uuid[], p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_locked timestamptz;
  v_marked integer;
  v_unread integer;
begin
  if p_ids is not null and (cardinality(p_ids) not between 1 and 100 or array_position(p_ids, null) is not null) then
    raise exception 'mark 1 to 100 items read, or every item with null' using errcode = '22023';
  end if;
  v_locked := app.code_attempt_gate('customer_inbox_read', v_login.tenant_id, null, v_login.user_id, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'marked', 0);
  end if;
  perform app.code_attempt_record('customer_inbox_read', v_login.tenant_id, null, v_login.user_id, p_at);
  update app.customer_inbox x
  set read_at = p_at
  where x.customer_login_id = v_login.id
    and x.read_at is null
    and x.created_at > p_at - app.customer_inbox_retention()
    and (p_ids is null or x.id = any (p_ids));
  get diagnostics v_marked = row_count;
  select count(*)::integer into v_unread from app.customer_inbox x
  where x.customer_login_id = v_login.id and x.read_at is null and x.created_at > p_at - app.customer_inbox_retention();
  return jsonb_build_object('state', 'read', 'refusal', null, 'marked', v_marked, 'unread', v_unread);
end;
$$;

comment on function app.customer_inbox_read(uuid[], timestamptz) is 'marks the caller''s own unread inbox items read at p_at: the ones named (1 to 100 ids; an id of another customer or an item already read changes nothing and is not counted), or every unread item with null; answers how many changed and how many stay unread; rate_limited with retry_at after 120 calls of a customer (10,000 of a tenant) in 15 minutes; 22023 for an empty, null-holding or longer list; 42501 without a customer session';

create function app.customer_start_marketing(p_policy_version text, p_screen_version text, p_shown_at timestamptz, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_customer uuid := app.customer_session_customer();
  v_locked timestamptz;
  v_before uuid;
  v_after uuid;
  v_consent public.consent_records;
begin
  if p_screen_version is null or p_screen_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
    or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
  then
    raise exception 'the screen and policy versions are 1 to 40 of a-z, 0-9, . and -' using errcode = '22023';
  end if;
  if p_shown_at is null or p_shown_at > p_at + interval '5 minutes' or p_shown_at < p_at - interval '1 day' then
    raise exception 'the opt-in text was shown before the answer, within a day' using errcode = '22023';
  end if;
  v_locked := app.code_attempt_gate('customer_marketing', v_login.tenant_id, null, v_login.user_id, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'marketing_consent',
      app.customer_consent_record(v_login.tenant_id, v_customer, 'marketing') is not null);
  end if;
  perform app.code_attempt_record('customer_marketing', v_login.tenant_id, null, v_login.user_id, p_at);
  if not exists (
    select 1 from public.legal_documents d
    where d.tenant_id = v_login.tenant_id and d.kind = 'privacy_notice' and d.status = 'published' and d.version = p_policy_version
  ) then
    return jsonb_build_object('state', 'refused', 'refusal', 'policy_outdated', 'marketing_consent',
      app.customer_consent_record(v_login.tenant_id, v_customer, 'marketing') is not null);
  end if;
  v_before := app.customer_consent_record(v_login.tenant_id, v_customer, 'marketing');
  v_after := app.customer_record_consent(v_login.tenant_id, v_customer, 'marketing', p_policy_version,
    jsonb_build_object(
      'screen_version', p_screen_version,
      'shown_at', p_shown_at,
      'accepted_at', p_at,
      'channel', 'mini_app',
      'zalo_app_id', v_login.zalo_app_id,
      'toggle', 'marketing',
      'ticked', true,
      'source', 'inbox_switch',
      'weekly_cap', (app.customer_inbox_marketing(v_login) ->> 'weekly_cap')::integer
    ),
    p_at);
  select c.* into v_consent from public.consent_records c where c.id = v_after;
  return jsonb_build_object('state', 'started', 'refusal', null, 'marketing_consent', true, 'started_at', v_consent.granted_at,
    'replayed', v_before is not distinct from v_after);
end;
$$;

comment on function app.customer_start_marketing(text, text, timestamptz, timestamptz) is 'C12 "Nhận tin ưu đãi qua Zalo" turned on after the confirm sheet: records the joined customer''s marketing consent (app.customer_record_consent) with its evidence: who (the customer and the Zalo App), when (shown_at, accepted_at), the privacy notice''s version, the opt-in text''s version (screen_version), the channel and the weekly cap promised; an active consent of the same version is a replay (no new record), another version replaces it; refused policy_outdated for a version the tenant has not published, rate_limited after 10 calls of a customer (1,000 of a tenant) in 15 minutes; 22023 for malformed versions or a shown_at more than 5 minutes after the answer or a day before it; 42501 for a visitor (only a member can consent) and every other caller';

-- 5. Retention --------------------------------------------------------------------------------------------------------

create function app.purge_customer_inbox(p_at timestamptz default now(), p_limit integer default 20000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purged integer;
begin
  if p_at is null or p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'a purge needs an instant and a limit of 1 to 100000' using errcode = '22023';
  end if;
  delete from app.customer_inbox i
  where i.id in (
    select x.id from app.customer_inbox x
    where x.created_at <= p_at - app.customer_inbox_retention()
    order by x.created_at
    limit p_limit
  );
  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;

comment on function app.purge_customer_inbox(timestamptz, integer) is 'the body of the pg_cron job customer-inbox-purge (hourly): deletes up to p_limit inbox items written 90 days or more before p_at, oldest first (the readers already leave them out); answers how many it deleted; no API role may run it';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('customer-inbox-purge', '29 * * * *', 'select app.purge_customer_inbox(now())');
  end if;
end;
$$;

-- 6. The customer's copy of their data and the deletion of their account (C19), the owner's DSR export -------------------

create or replace function app.customer_delete_account(p_confirm boolean, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_open integer;
  v_refunds integer;
  v_counts jsonb;
  v_rows integer;
begin
  if p_confirm is distinct from true then
    raise exception 'deleting the account needs the customer''s confirmation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-customer-login:' || v_login.id::text, 0));
  if v_login.customer_id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'member_request', 'deleted', false);
  end if;
  select count(*) filter (where o.status = any (app.order_open_statuses())),
         count(*) filter (where o.payment_status = 'refund_pending' or exists (
           select 1 from public.order_refunds r where r.order_id = o.id and r.status in ('due', 'pending', 'failed')))
  into v_open, v_refunds
  from public.orders o where o.customer_login_id = v_login.id;
  if v_open > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'open_orders', 'deleted', false, 'orders', v_open);
  end if;
  if v_refunds > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'refund_pending', 'deleted', false, 'orders', v_refunds);
  end if;

  update public.order_lines l set note = null
  where l.note is not null and l.order_id in (select o.id from public.orders o where o.customer_login_id = v_login.id);
  get diagnostics v_rows = row_count;
  v_counts := jsonb_build_object('line_notes_cleared', v_rows);
  update public.orders o set note = null where o.customer_login_id = v_login.id and o.note is not null;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('order_notes_cleared', v_rows);
  v_counts := v_counts || jsonb_build_object(
    'orders_unlinked', (select count(*) from public.orders o where o.customer_login_id = v_login.id),
    'attached_orders_unlinked', (select count(*) from public.orders o where o.member_login_id = v_login.id),
    'staff_calls_unlinked', (select count(*) from public.table_calls c where c.customer_login_id = v_login.id),
    'stamp_cards', (select count(*) from public.stamp_cards c where c.customer_login_id = v_login.id),
    'stamp_entries', (select count(*) from public.stamp_entries e join public.stamp_cards c on c.id = e.card_id where c.customer_login_id = v_login.id),
    'stamp_rewards', (select count(*) from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id where c.customer_login_id = v_login.id),
    'member_codes', (select count(*) from app.stamp_member_codes m where m.customer_login_id = v_login.id),
    'requests', (select count(*) from public.store_requests r where r.customer_login_id = v_login.id),
    'order_blocks', (select count(*) from public.customer_order_blocks b where b.customer_login_id = v_login.id),
    'saved_companies', (select count(*) from public.saved_companies c where c.customer_login_id = v_login.id),
    'invoice_requests_unlinked', (select count(*) from public.invoice_requests r where r.customer_login_id = v_login.id),
    'inbox_items', (select count(*) from app.customer_inbox i where i.customer_login_id = v_login.id)
  );

  insert into app.customer_login_erasures (tenant_id, login_hash, erased_at, counts)
  values (v_login.tenant_id, app.customer_login_hash(v_login), p_at, v_counts);

  delete from app.customer_logins l where l.id = v_login.id;
  delete from auth.users u
  where u.id = v_login.user_id
    and not exists (select 1 from public.tenant_members m where m.user_id = u.id)
    and not exists (select 1 from public.zalo_identities z where z.user_id = u.id)
    and not exists (select 1 from app.customer_logins l where l.user_id = u.id);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_rows);

  return jsonb_build_object('state', 'deleted', 'refusal', null, 'deleted', true, 'deleted_at', p_at, 'counts', v_counts);
end;
$$;

comment on function app.customer_delete_account(boolean, timestamptz) is 'C19 "Xóa tài khoản" for a customer who never joined with a phone, with p_confirm true (22023 otherwise): refused while an order of theirs is open (open_orders) or owes a refund (refund_pending), and for a joined customer (member_request: customer_request_deletion is their path); otherwise deletes the stamp card with its rewards and ledger, the member codes, the requests, the order blocks, the saved companies, the inbox, the login and its Auth user with every session, clears the notes the customer typed on their orders, unlinks their orders, the counter orders attached to their card, their staff calls and their company invoice requests (the money records and the invoices'' buyer data stay for the legal period), records the deletion as a keyed hash with the counts in app.customer_login_erasures, and answers the counts; 42501 without a customer session (so a second call after the deletion is refused)';

create or replace function app.customer_export_data(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_brand uuid;
  v_out jsonb;
  v_counts jsonb;
begin
  select a.brand_id into v_brand from public.zalo_apps a where a.id = v_login.zalo_app_id;
  v_out := jsonb_build_object(
    'generated_at', p_at,
    'login', jsonb_build_object(
      'zalo_user_id', v_login.zalo_user_id,
      'brand', (select b.display_name from public.brands b where b.id = v_brand),
      'created_at', v_login.created_at,
      'joined', v_login.customer_id is not null
    ),
    'customer', (
      select jsonb_build_object('name', c.name, 'phone', c.phone, 'first_seen_at', c.first_seen_at, 'last_seen_at', c.last_seen_at)
      from public.customers c where c.id = v_login.customer_id and c.tenant_id = v_login.tenant_id
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('programme', p.name, 'status', m.status, 'joined_at', m.joined_at, 'channel', m.channel) order by m.joined_at, m.id)
      from public.memberships m join public.loyalty_programmes p on p.id = m.programme_id
      where m.customer_id = v_login.customer_id and m.tenant_id = v_login.tenant_id
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', r.purpose, 'policy_version', r.policy_version, 'channel', r.channel, 'granted_at', r.granted_at,
        'revoked_at', r.revoked_at) order by r.granted_at, r.id)
      from public.consent_records r
      where r.tenant_id = v_login.tenant_id and r.subject_type = 'customer' and r.subject_id = v_login.customer_id
    ), '[]'::jsonb),
    'stamp_card', (
      select jsonb_build_object(
        'stamps', c.stamps, 'total_earned', c.total_earned, 'created_at', c.created_at,
        'rewards', coalesce((select jsonb_agg(jsonb_build_object('status', r.status, 'stamps', r.stamps, 'issued_at', r.issued_at, 'used_at', r.used_at, 'voided_at', r.voided_at)
          order by r.issued_at, r.id) from public.stamp_rewards r where r.card_id = c.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'delta', e.delta, 'balance_after', e.balance_after, 'at', e.occurred_at,
          'order_no', app.order_display_no(o.order_no)) order by e.id)
          from public.stamp_entries e left join public.orders o on o.id = e.order_id where e.card_id = c.id), '[]'::jsonb)
      )
      from public.stamp_cards c where c.customer_login_id = v_login.id and c.brand_id = v_brand
    ),
    'orders', coalesce((
      select jsonb_agg(app.order_json(o, 'customer', p_at) || jsonb_build_object(
        'store_name', (select s.name from public.stores s where s.id = o.store_id),
        'money', app.order_money_json(o.id, 'customer')) order by o.placed_at, o.id)
      from public.orders o where o.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'attached_orders', coalesce((
      select jsonb_agg(jsonb_build_object('order_no', app.order_display_no(o.order_no), 'business_date', o.business_date,
        'store_name', (select s.name from public.stores s where s.id = o.store_id), 'status', o.status, 'total', o.total::bigint,
        'attached_at', o.member_attached_at) order by o.member_attached_at, o.id)
      from public.orders o where o.member_login_id = v_login.id
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(app.request_json(r, 'customer', p_at) || jsonb_build_object('contact_phone', r.contact_phone) order by r.created_at, r.id)
      from public.store_requests r where r.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'invoice_requests', coalesce((
      select jsonb_agg(app.invoice_request_json(r) order by r.requested_at, r.id)
      from public.invoice_requests r where r.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'saved_companies', coalesce((
      select jsonb_agg(app.customer_saved_company_json(c) order by c.created_at, c.id)
      from public.saved_companies c where c.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'staff_calls', coalesce((
      select jsonb_agg(jsonb_build_object('store_name', s.name, 'table', t.label, 'created_at', c.created_at, 'acknowledged_at', c.acknowledged_at)
        order by c.created_at, c.id)
      from public.table_calls c join public.stores s on s.id = c.store_id left join public.store_tables t on t.id = c.table_id
      where c.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'order_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('reason', b.reason, 'created_at', b.created_at, 'blocked_until', b.blocked_until) order by b.created_at, b.id)
      from public.customer_order_blocks b where b.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'inbox', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'created_at', i.created_at, 'read_at', i.read_at, 'params', i.params,
        'title', i.title, 'line', i.line, 'order_no', app.order_display_no(o.order_no)) order by i.seq)
      from app.customer_inbox i left join public.orders o on o.id = i.order_id
      where i.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'deletion_request', case when v_login.customer_id is not null then app.customer_deletion_request(v_login.tenant_id, v_login.customer_id, p_at) end,
    'not_kept', jsonb_build_array('location', 'contacts', 'zalo_messages', 'card_numbers')
  );
  v_counts := jsonb_build_object(
    'orders', jsonb_array_length(v_out -> 'orders'),
    'attached_orders', jsonb_array_length(v_out -> 'attached_orders'),
    'requests', jsonb_array_length(v_out -> 'requests'),
    'invoice_requests', jsonb_array_length(v_out -> 'invoice_requests'),
    'saved_companies', jsonb_array_length(v_out -> 'saved_companies'),
    'staff_calls', jsonb_array_length(v_out -> 'staff_calls'),
    'stamp_entries', coalesce(jsonb_array_length(v_out -> 'stamp_card' -> 'entries'), 0),
    'memberships', jsonb_array_length(v_out -> 'memberships'),
    'consents', jsonb_array_length(v_out -> 'consents'),
    'inbox', jsonb_array_length(v_out -> 'inbox')
  );
  insert into app.customer_data_exports (tenant_id, customer_login_id, exported_at, counts) values (v_login.tenant_id, v_login.id, p_at, v_counts);
  return v_out || jsonb_build_object('counts', v_counts);
end;
$$;

comment on function app.customer_export_data(timestamptz) is 'C19 "Tải bản sao dữ liệu": everything the platform holds about the caller''s customer login as one JSON (the login and its Zalo user id, the joined customer''s name, phone and dates, memberships and consent records, the stamp card with every reward and ledger entry, every order with its lines and money as the customer sees them, the counter orders attached to the card, the requests with the contact typed, the company invoice requests and the saved companies, the staff calls, the order blocks, the inbox (C12) with what was read and when, an open deletion request, and what is never kept), nothing of anyone else; each export recorded with its counts only; 42501 without a customer session';

create or replace function public.dsr_export(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
  v_customer public.customers;
  v_owner boolean;
  v_invoices jsonb;
  v_memberships jsonb;
  v_ledger jsonb;
  v_stamps jsonb;
  v_claims jsonb;
  v_redemptions jsonb;
  v_consents jsonb;
  v_messages jsonb;
  v_inbox jsonb;
  v_counts jsonb;
  v_at timestamptz := now();
begin
  v_request := app.dsr_request_for_caller(p_request_id, 'dsr_export');
  select c.* into v_customer from public.customers c where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id;
  if v_customer.id is null then
    raise exception 'the customer of this request no longer exists' using errcode = '22023';
  end if;
  v_owner := app.has_store_scope(v_request.tenant_id, null, array['owner']::public.tenant_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'external_id', i.external_id, 'sold_at', i.sold_at, 'business_date', i.business_date, 'net_amount', i.net_amount,
    'customer_name', i.customer_name,
    'customer_phone', case when v_owner then i.customer_phone else app.loyalty_masked_phone(i.customer_phone) end
  ) order by i.sold_at, i.id), '[]'::jsonb) into v_invoices
  from public.invoices i
  where i.tenant_id = v_request.tenant_id
    and (i.customer_id = v_customer.id or (v_customer.phone is not null and app.loyalty_normalize_phone(i.customer_phone) = v_customer.phone));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'programme_id', m.programme_id, 'joined_at', m.joined_at, 'channel', m.channel, 'status', m.status
  ) order by m.joined_at, m.id), '[]'::jsonb) into v_memberships
  from public.memberships m
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'membership_id', l.membership_id, 'entry_kind', l.entry_kind, 'stamp_delta', l.stamp_delta, 'point_delta', l.point_delta,
    'value_amount', l.value_amount, 'invoice_id', l.invoice_id, 'business_date', l.business_date, 'pending', l.pending,
    'reason', l.reason, 'occurred_at', l.occurred_at, 'expires_at', l.expires_at
  ) order by l.occurred_at, l.id), '[]'::jsonb) into v_ledger
  from public.loyalty_ledger l
  join public.memberships m on m.id = l.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'membership_id', s.membership_id, 'earned_at', s.earned_at, 'expires_at', s.expires_at, 'state', s.state, 'closed_at', s.closed_at
  ) order by s.earned_at, s.id), '[]'::jsonb) into v_stamps
  from public.stamps s
  join public.memberships m on m.id = s.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'membership_id', q.membership_id, 'store_id', q.store_id, 'business_date', q.business_date, 'receipt_no', q.receipt_no,
    'amount', q.amount, 'status', q.status, 'created_at', q.created_at, 'closed_at', q.closed_at
  ) order by q.created_at, q.id), '[]'::jsonb) into v_claims
  from public.receipt_claims q
  join public.memberships m on m.id = q.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'membership_id', r.membership_id, 'coupon_id', r.coupon_id, 'code', r.code, 'state', r.state,
    'held_at', r.held_at, 'confirmed_at', r.confirmed_at, 'released_at', r.released_at
  ) order by r.held_at, r.id), '[]'::jsonb) into v_redemptions
  from public.redemptions r
  join public.memberships m on m.id = r.membership_id
  where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'purpose', k.purpose, 'channel', k.channel, 'policy_version', k.policy_version,
    'granted_at', k.granted_at, 'revoked_at', k.revoked_at
  ) order by k.granted_at, k.id), '[]'::jsonb) into v_consents
  from public.consent_records k
  where k.tenant_id = v_request.tenant_id and k.subject_type = 'customer' and k.subject_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'channel', o.channel, 'purpose', o.purpose, 'template_ref', o.template_ref, 'sent_at', o.sent_at, 'status', o.status
  ) order by o.sent_at, o.id), '[]'::jsonb) into v_messages
  from public.outbound_messages o
  where o.tenant_id = v_request.tenant_id and o.subject_type = 'customer' and o.subject_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'kind', x.kind, 'created_at', x.created_at, 'read_at', x.read_at, 'params', x.params, 'title', x.title, 'line', x.line,
    'order_id', x.order_id
  ) order by x.created_at, x.seq), '[]'::jsonb) into v_inbox
  from app.customer_inbox x
  join app.customer_logins l on l.id = x.customer_login_id
  where l.tenant_id = v_request.tenant_id and l.customer_id = v_customer.id;
  if v_request.status = 'received' then
    update public.data_subject_requests r set status = 'in_progress' where r.id = v_request.id;
  end if;

  v_counts := jsonb_build_object(
    'invoices', jsonb_array_length(v_invoices), 'memberships', jsonb_array_length(v_memberships),
    'loyalty_ledger', jsonb_array_length(v_ledger), 'stamps', jsonb_array_length(v_stamps),
    'receipt_claims', jsonb_array_length(v_claims), 'redemptions', jsonb_array_length(v_redemptions),
    'consent_records', jsonb_array_length(v_consents), 'messages', jsonb_array_length(v_messages),
    'inbox', jsonb_array_length(v_inbox)
  );
  -- ADR-054: who made a copy and when, with the counts only; the copy itself is never stored
  insert into public.data_subject_request_actions (
    tenant_id, request_id, action, acted_by, acted_at, counts, first_response_due_at, completion_due_at, responded_on_time, completed_on_time
  )
  values (
    v_request.tenant_id, v_request.id, 'export', (select auth.uid()), v_at, v_counts, v_request.first_response_due_at, v_request.completion_due_at,
    coalesce(v_request.responded_at, v_at) <= v_request.first_response_due_at, v_at <= v_request.completion_due_at
  );
  return jsonb_build_object(
    'request', jsonb_build_object('id', v_request.id, 'request_type', v_request.request_type, 'received_at', v_request.received_at),
    'exported_at', v_at,
    'customer', jsonb_build_object(
      'id', v_customer.id, 'name', v_customer.name,
      'phone', case when v_owner then v_customer.phone else app.loyalty_masked_phone(v_customer.phone) end,
      'first_seen_at', v_customer.first_seen_at, 'last_seen_at', v_customer.last_seen_at
    ),
    'invoices', v_invoices,
    'memberships', v_memberships,
    'loyalty_ledger', v_ledger,
    'stamps', v_stamps,
    'receipt_claims', v_claims,
    'redemptions', v_redemptions,
    'consent_records', v_consents,
    'messages', v_messages,
    'inbox', v_inbox,
    'counts', v_counts
  );
end;
$$;

comment on function public.dsr_export(uuid) is 'RPC for owners and managers with every store (42501 for every other caller, a customer session included): every row of the customer of a data-subject request of their tenant as one JSON (the customer, the customer fields of invoices, memberships, ledger, stamps, claims, redemptions, consent records, message log rows and the inbox items of the customer''s Zalo logins, with the counts) and nothing of another customer or tenant; the full phone only for an owner, masked for a manager; moves a received request to in_progress and records an export action in data_subject_request_actions (the caller, the moment, the counts; never the content, ADR-054) at every answer; 22023 for a request about staff, naming no customer, rejected or whose customer is gone';

-- 7. Public wrappers and grants -------------------------------------------------------------------------------------

create function public.customer_inbox(p_filter text default 'all', p_before bigint default null)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_inbox(p_filter, p_before, now()); $$;
comment on function public.customer_inbox(text, bigint) is 'RPC for the customer Mini App (C12): app.customer_inbox at the current time';

create function public.customer_inbox_unread()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_inbox_unread(now()); $$;
comment on function public.customer_inbox_unread() is 'RPC for the customer Mini App (C01''s bell): app.customer_inbox_unread at the current time';

create function public.customer_inbox_read(p_ids uuid[] default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_inbox_read(p_ids, now()); $$;
comment on function public.customer_inbox_read(uuid[]) is 'RPC for the customer Mini App (C12): app.customer_inbox_read at the current time';

create function public.customer_start_marketing(p_policy_version text, p_screen_version text, p_shown_at timestamptz)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_start_marketing(p_policy_version, p_screen_version, p_shown_at, now()); $$;
comment on function public.customer_start_marketing(text, text, timestamptz) is 'RPC for the customer Mini App (C12 "Nhận tin ưu đãi qua Zalo"): app.customer_start_marketing at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('customer_inbox_retention', 'customer_inbox_add', 'customer_order_membership', 'customer_order_notices', 'customer_stamp_notices',
        'customer_offer_notices', 'customer_inbox_offer', 'customer_inbox_item_json', 'customer_inbox_marketing', 'customer_inbox', 'customer_inbox_unread',
        'customer_inbox_read', 'customer_start_marketing', 'purge_customer_inbox', 'customer_delete_account', 'customer_export_data')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_inbox(text, bigint), public.customer_inbox_unread(), public.customer_inbox_read(uuid[]),
  public.customer_start_marketing(text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.customer_inbox(text, bigint), public.customer_inbox_unread(), public.customer_inbox_read(uuid[]),
  public.customer_start_marketing(text, text, timestamptz) to authenticated;
