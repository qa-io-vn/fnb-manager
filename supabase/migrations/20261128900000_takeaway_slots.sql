-- Takeaway with a chosen pick-up time (C17 "Chọn giờ lấy món", the owner's phase 2; ADR-072, native-till.md section
-- 19): the store's slot length and per-slot limit beside its preparation time, the slots of the one day a customer may
-- book computed on the server clock in the store's time zone, the slot re-validated when the order is placed (also
-- while the store is closed, for the next opening), the place held by the order while its payment is open (10 minutes)
-- and freed when that window passes, two customers taking the last place leaving one winner, the customer's change of
-- pick-up time while the payment is open, and the counter seeing a paid order as scheduled until its preparation
-- should start (the pick-up less the preparation time).

-- 1. Settings ---------------------------------------------------------------------------------------------------------

alter table public.store_ordering_settings
  add column takeaway_slot_minutes integer not null default 15 check (takeaway_slot_minutes in (5, 10, 15, 20, 30, 60)),
  add column takeaway_slot_limit integer not null default 6 check (takeaway_slot_limit between 1 and 100);

comment on column public.store_ordering_settings.takeaway_slot_minutes is 'the length of a takeaway pick-up slot in minutes (5, 10, 15, 20, 30 or 60, a divisor of an hour so slots start on the clock: 15 by default, 07:00, 07:15 …); the last pick-up of an opening span is its closing less one slot';
comment on column public.store_ordering_settings.takeaway_slot_limit is 'how many takeaway orders one pick-up slot takes (1 to 100, 6 by default): an order holds its place from its placement while its payment is open, and for good once paid';

grant insert (takeaway_slot_minutes, takeaway_slot_limit), update (takeaway_slot_minutes, takeaway_slot_limit)
  on public.store_ordering_settings to authenticated;

create index orders_takeaway_slot_idx on public.orders (store_id, pickup_at)
  where order_type = 'takeaway' and pickup_at is not null and status <> 'cancelled';

-- 2. The rate limit of a change of pick-up time --------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website', 'staff_clock_in', 'counter_member_lookup',
  'customer_stamp_code', 'customer_invoice_request', 'customer_change_pickup'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values ('customer_change_pickup', 'calls', 10, 200, interval '15 minutes', interval '15 minutes');

-- 3. Slots ----------------------------------------------------------------------------------------------------------

create function app.takeaway_hold_minutes()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 10;
$$;

comment on function app.takeaway_hold_minutes() is 'how long an unpaid takeaway order with a pick-up time holds its place: 10 minutes, as the payment screen''s "đơn giữ 10 phút" (C11), or the store''s payment window when that is shorter';

create function app.takeaway_slot_starts(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns table (business_date date, start_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select st.timezone, st.business_day_start_minutes, st.opening_hours, coalesce(o.takeaway_slot_minutes, 15) as slot
    from public.stores st
    left join public.store_ordering_settings o on o.store_id = st.id
    where st.id = p_store_id
  ),
  spans as (
    select s.timezone, s.slot, sp.opens_at, sp.closes_at,
      ((sp.opens_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date as business_date
    from s
    cross join lateral app.opening_spans(s.opening_hours, s.timezone, s.business_day_start_minutes, p_from, p_to) sp
  ),
  open_spans as (
    select sp.*
    from spans sp
    where not exists (
      select 1 from public.ordering_closures c
      where c.store_id = p_store_id and sp.business_date between c.starts_on and c.ends_on
    )
  )
  select distinct sp.business_date, g.local_start at time zone sp.timezone
  from open_spans sp
  cross join lateral (
    select date_trunc('hour', sp.opens_at at time zone sp.timezone) + make_interval(mins => (ceil(
      extract(epoch from (sp.opens_at at time zone sp.timezone) - date_trunc('hour', sp.opens_at at time zone sp.timezone)) / 60.0 / sp.slot
    ) * sp.slot)::integer) as first_local
  ) f
  cross join lateral generate_series(f.first_local, (sp.closes_at at time zone sp.timezone) - make_interval(mins => sp.slot), make_interval(mins => sp.slot)) as g (local_start)
  where g.local_start at time zone sp.timezone >= p_from
    and g.local_start at time zone sp.timezone < p_to
  order by 2;
$$;

comment on function app.takeaway_slot_starts(uuid, timestamptz, timestamptz) is 'the takeaway pick-up slots of a store whose start lies in [p_from, p_to), with the business date of their opening span: every takeaway_slot_minutes on the store''s clock (from the hour, so a 15-minute slot starts at :00, :15, :30 or :45) from the first such start at or after the span opens to the last one a whole slot before it closes (closing 23:00: last pick-up 22:45); a business date covered by an ordering closure has none';

create function app.takeaway_slot_taken(p_store_id uuid, p_start timestamptz, p_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.orders o
  where o.store_id = p_store_id
    and o.order_type = 'takeaway'
    and o.pickup_at = p_start
    and (o.status in ('accepted', 'preparing', 'ready', 'completed') or (o.status = 'awaiting_payment' and o.payment_due_at > p_at));
$$;

comment on function app.takeaway_slot_taken(uuid, timestamptz, timestamptz) is 'the places a takeaway slot has given at an instant: its paid orders (accepted, preparing, ready or completed) and the unpaid ones still inside their payment window (the hold); a cancelled order or a hold whose window passed gives its place back';

create function app.takeaway_offer(p_store_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := app.ordering_state(p_store_id, 'takeaway', p_at);
  v_accepting boolean := coalesce((v_state ->> 'accepting')::boolean, false);
  v_prep integer;
  v_earliest timestamptz;
  v_first record;
begin
  if not v_accepting and coalesce(v_state ->> 'reason', 'ordering_off') not in ('closed_now', 'last_orders_passed', 'closed_today') then
    return jsonb_build_object('refusal', coalesce(v_state ->> 'reason', 'ordering_off'), 'accepting', false, 'earliest', null, 'business_date', null, 'ordering', v_state);
  end if;
  select coalesce(s.prep_minutes, 10) into v_prep from public.store_ordering_settings s where s.store_id = p_store_id;
  v_earliest := p_at + make_interval(mins => coalesce(v_prep, 10));
  if not v_accepting then
    if v_state ->> 'opens_at' is null then
      return jsonb_build_object('refusal', 'no_slots', 'accepting', false, 'earliest', null, 'business_date', null, 'ordering', v_state);
    end if;
    v_earliest := greatest(v_earliest, (v_state ->> 'opens_at')::timestamptz);
  end if;
  select s.business_date, s.start_at into v_first
  from app.takeaway_slot_starts(p_store_id, v_earliest, v_earliest + interval '8 days') s
  order by s.start_at
  limit 1;
  if v_first.start_at is null then
    return jsonb_build_object('refusal', 'no_slots', 'accepting', v_accepting, 'earliest', v_earliest, 'business_date', null, 'ordering', v_state);
  end if;
  return jsonb_build_object('refusal', null, 'accepting', v_accepting, 'earliest', v_earliest,
    'business_date', to_char(v_first.business_date, 'YYYY-MM-DD'), 'ordering', v_state);
end;
$$;

comment on function app.takeaway_offer(uuid, timestamptz) is 'the one day a customer may book a takeaway pick-up on, from the server clock: while the store takes takeaway orders, the business date of the first slot at or after now plus the preparation time (today until its last slot passes, then the next opening); while it is closed (closed_now, last_orders_passed, closed_today), the business date of the first slot from the next opening (not before now plus the preparation time); refusal the ordering reason for any other state (ordering_off, hours_unknown, paused, no_staff_online, busy) or no_slots when no slot opens within 8 days; with accepting, the earliest bookable start and the ordering state';

create function app.takeaway_slots(p_store_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_offer jsonb := app.takeaway_offer(p_store_id, p_at);
  v_settings public.store_ordering_settings;
  v_date date := (v_offer ->> 'business_date')::date;
  v_earliest timestamptz := (v_offer ->> 'earliest')::timestamptz;
  v_slots jsonb;
  v_opens timestamptz;
  v_closes timestamptz;
  v_last timestamptz;
begin
  select o.* into v_settings from public.store_ordering_settings o where o.store_id = p_store_id;
  if v_offer ->> 'refusal' is not null then
    return jsonb_build_object('state', 'refused', 'refusal', v_offer ->> 'refusal', 'now', p_at, 'date', null, 'pre_order', false,
      'asap_at', null, 'opens_at', null, 'closes_at', null, 'last_pickup_at', null,
      'prep_minutes', coalesce(v_settings.prep_minutes, 10), 'slot_minutes', coalesce(v_settings.takeaway_slot_minutes, 15),
      'slots', '[]'::jsonb, 'ordering', v_offer -> 'ordering');
  end if;
  with day_slots as (
    select s.start_at
    from app.takeaway_slot_starts(p_store_id, v_earliest - interval '1 day', v_earliest + interval '9 days') s
    where s.business_date = v_date
  ),
  taken as (
    select o.pickup_at, count(*)::integer as n
    from public.orders o
    where o.store_id = p_store_id
      and o.order_type = 'takeaway'
      and o.pickup_at in (select d.start_at from day_slots d)
      and (o.status in ('accepted', 'preparing', 'ready', 'completed') or (o.status = 'awaiting_payment' and o.payment_due_at > p_at))
    group by o.pickup_at
  )
  select jsonb_agg(jsonb_build_object(
      'start', d.start_at,
      'available', d.start_at >= v_earliest and coalesce(t.n, 0) < v_settings.takeaway_slot_limit,
      'reason', case when d.start_at < v_earliest then 'passed' when coalesce(t.n, 0) >= v_settings.takeaway_slot_limit then 'full' end
    ) order by d.start_at),
    max(d.start_at)
  into v_slots, v_last
  from day_slots d
  left join taken t on t.pickup_at = d.start_at;
  select min(sp.opens_at), max(sp.closes_at) into v_opens, v_closes
  from public.stores st
  cross join lateral app.opening_spans(st.opening_hours, st.timezone, st.business_day_start_minutes, v_earliest - interval '1 day', v_earliest + interval '9 days') sp
  where st.id = p_store_id
    and ((sp.opens_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date = v_date;
  return jsonb_build_object(
    'state', 'ok',
    'refusal', null,
    'now', p_at,
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'pre_order', not (v_offer ->> 'accepting')::boolean,
    'asap_at', case when (v_offer ->> 'accepting')::boolean then p_at + make_interval(mins => v_settings.prep_minutes) end,
    'opens_at', v_opens,
    'closes_at', v_closes,
    'last_pickup_at', v_last,
    'prep_minutes', v_settings.prep_minutes,
    'slot_minutes', v_settings.takeaway_slot_minutes,
    'slots', coalesce(v_slots, '[]'::jsonb),
    'ordering', v_offer -> 'ordering'
  );
end;
$$;

comment on function app.takeaway_slots(uuid, timestamptz) is 'C17''s slots of a store at an instant (the server clock, the store''s zone): the day takeaway_offer chooses, every slot of that business date with available and the reason it is not (passed: before the earliest bookable start; full: the slot''s limit reached by paid orders and live holds), the first opening and last closing of the day, the last pick-up, pre_order when the store is closed and the slots are from its next opening, asap_at (now plus the preparation time, "Càng sớm có thể") only while the store takes takeaway orders now, the preparation and slot minutes and the ordering state; refused with the reason when no slot can be booked';

create function app.takeaway_slot_refusal(p_store_id uuid, p_pickup timestamptz, p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_offer jsonb := app.takeaway_offer(p_store_id, p_at);
  v_settings public.store_ordering_settings;
  v_store public.stores;
  v_local timestamp;
  v_slot record;
begin
  select o.* into v_settings from public.store_ordering_settings o where o.store_id = p_store_id;
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if p_pickup is null then
    return 'pickup_time_invalid';
  end if;
  if p_pickup < p_at + make_interval(mins => coalesce(v_settings.prep_minutes, 10)) then
    return 'slot_passed';
  end if;
  if v_offer ->> 'refusal' is not null then
    return case when v_offer ->> 'refusal' = 'no_slots' then 'closed' else v_offer ->> 'refusal' end;
  end if;
  if not (v_offer ->> 'accepting')::boolean and p_pickup < (v_offer ->> 'earliest')::timestamptz then
    return 'closed';
  end if;
  v_local := p_pickup at time zone v_store.timezone;
  if date_trunc('minute', v_local) <> v_local or extract(minute from v_local)::integer % v_settings.takeaway_slot_minutes <> 0 then
    return 'pickup_time_invalid';
  end if;
  select s.business_date, s.start_at into v_slot
  from app.takeaway_slot_starts(p_store_id, p_pickup, p_pickup + interval '1 second') s
  where s.start_at = p_pickup;
  if v_slot.start_at is null then
    return 'closed';
  end if;
  if v_slot.business_date <> (v_offer ->> 'business_date')::date then
    return 'pickup_time_invalid';
  end if;
  if app.takeaway_slot_taken(p_store_id, p_pickup, p_at) >= v_settings.takeaway_slot_limit then
    return 'slot_full';
  end if;
  return null;
end;
$$;

comment on function app.takeaway_slot_refusal(uuid, timestamptz, timestamptz) is 'why a pick-up time cannot be booked now, null when it can, first match wins: slot_passed (before now plus the preparation time: the time passed or is too close), the ordering reason when the store takes no takeaway order at all (closed when no slot opens within 8 days), closed (before the next opening while the store is closed, outside its opening spans or on a closed date), pickup_time_invalid (not a slot start on the store''s clock, or a day other than the one offered), slot_full (the slot''s limit reached by paid orders and live holds); the client''s clock and its idea of a free slot play no part';

-- 4. Preparation start, the counter's "scheduled" and the busy count --------------------------------------------------

create function app.order_start_at(p_order public.orders)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_order.order_type = 'takeaway' and p_order.pickup_at is not null
    then p_order.pickup_at - make_interval(mins => coalesce((select s.prep_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10))
  end;
$$;

comment on function app.order_start_at(public.orders) is 'when a takeaway order with a pick-up time should start being made: the pick-up less the store''s preparation minutes; null for any other order';

create function app.ordering_waiting_orders(p_store_id uuid, p_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.orders o
  where o.store_id = p_store_id
    and o.status = 'accepted'
    and coalesce(app.order_start_at(o) <= p_at, true);
$$;

comment on function app.ordering_waiting_orders(uuid, timestamptz) is 'the accepted orders of a store not yet started whose preparation is due (a takeaway booked for later does not count until its start), for the busy reason of app.ordering_state';

create or replace function app.ordering_waiting_orders(p_store_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select app.ordering_waiting_orders(p_store_id, now());
$$;

comment on function app.ordering_waiting_orders(uuid) is 'app.ordering_waiting_orders at the current time';

create or replace function app.ordering_state(p_store_id uuid, p_order_type text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_settings public.store_ordering_settings;
  v_closure public.ordering_closures;
  v_opens timestamptz;
  v_closes timestamptz;
  v_last timestamptz;
  v_reason text;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  select o.* into v_settings from public.store_ordering_settings o where o.store_id = p_store_id;
  if v_store.id is not null and coalesce(app.opening_hours_known(v_store.opening_hours), false) then
    select sp.opens_at, sp.closes_at into v_opens, v_closes from app.ordering_span_at(p_store_id, p_at) sp;
    v_last := v_closes - make_interval(mins => coalesce(v_settings.last_order_minutes, 0));
  end if;
  if v_store.id is not null then
    select c.* into v_closure
    from public.ordering_closures c
    where c.store_id = p_store_id
      and app.store_business_date(p_store_id, p_at) between c.starts_on and c.ends_on
    order by c.ends_on desc, c.id
    limit 1;
  end if;

  if v_store.id is null or v_settings.store_id is null or v_settings.till_mode <> 'native' or not v_settings.ordering_enabled
     or (p_order_type is not null and not (p_order_type = any (v_settings.order_types)))
  then
    v_reason := 'ordering_off';
  elsif not coalesce(app.opening_hours_known(v_store.opening_hours), false) then
    v_reason := 'hours_unknown';
  elsif v_closure.id is not null then
    v_reason := 'closed_today';
  elsif v_settings.paused_until > p_at then
    v_reason := 'paused';
  elsif v_opens is null then
    v_reason := 'closed_now';
  elsif p_at >= v_last then
    v_reason := 'last_orders_passed';
  elsif v_settings.staff_presence_required and not app.ordering_staff_present(p_store_id, p_at) then
    v_reason := 'no_staff_online';
  elsif app.ordering_waiting_orders(p_store_id, p_at) >= v_settings.max_waiting_orders then
    v_reason := 'busy';
  end if;
  return jsonb_build_object(
    'accepting', v_reason is null,
    'reason', v_reason,
    'till_mode', coalesce(v_settings.till_mode, 'ipos'),
    'order_types', coalesce(to_jsonb(case when v_settings.ordering_enabled and v_settings.till_mode = 'native' then v_settings.order_types end), '[]'::jsonb),
    'payment_methods', coalesce(to_jsonb(case when v_settings.ordering_enabled and v_settings.till_mode = 'native' then v_settings.payment_methods end), '[]'::jsonb),
    'opens_at', case when v_reason in ('closed_now', 'last_orders_passed', 'closed_today') then app.ordering_next_opening(p_store_id, greatest(p_at, coalesce(v_closes, p_at))) end,
    'closes_at', v_closes,
    'last_order_at', v_last,
    'paused_until', case when v_settings.paused_until > p_at then v_settings.paused_until end,
    'closure_reason', v_closure.reason,
    'closure_ends_on', v_closure.ends_on
  );
end;
$$;

comment on function app.ordering_state(uuid, text, timestamptz) is 'whether a store takes orders of a type (any type when null) at an instant, with the first reason that holds it (native-till.md section 2): ordering_off (no settings, not native, not enabled or the type not offered), hours_unknown, closed_today (a closure covers the business date; its reason), paused, closed_now (opens_at), last_orders_passed (from closing less last_order_minutes), no_staff_online (presence required and no counter poll in 180 seconds), busy (accepted orders not started and due, a takeaway booked for later excluded, reach max_waiting_orders); accepting when none holds';

create or replace function app.order_json(p_order public.orders, p_for text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'order_no', p_order.order_no,
    'display_no', app.order_display_no(p_order.order_no),
    'business_date', to_char(p_order.business_date, 'YYYY-MM-DD'),
    'source', p_order.source,
    'type', p_order.order_type,
    'table', case when p_order.table_label is not null then jsonb_build_object('id', case when p_for = 'counter' then p_order.table_id end, 'label', p_order.table_label) end,
    'pickup_at', p_order.pickup_at,
    'start_at', app.order_start_at(p_order),
    'scheduled', p_order.status = 'accepted' and coalesce(app.order_start_at(p_order) > p_at, false),
    'status', p_order.status,
    'payment_status', p_order.payment_status,
    'payment_method', p_order.payment_method,
    'version', p_order.version,
    'subtotal', p_order.subtotal::bigint,
    'discount_amount', p_order.discount_amount::bigint,
    'total', p_order.total::bigint,
    'note', p_order.note,
    'placed_at', p_order.placed_at,
    'payment_due_at', p_order.payment_due_at,
    'accepted_at', p_order.accepted_at,
    'preparing_at', p_order.preparing_at,
    'done_at', p_order.done_at,
    'completed_at', p_order.completed_at,
    'paid_at', p_order.paid_at,
    'cancelled_at', p_order.cancelled_at,
    'cancel_reason', p_order.cancel_reason,
    'ready_estimate_at', app.order_ready_estimate(p_order),
    'member_attached', case when p_for = 'counter' then p_order.member_login_id is not null end,
    'late', p_for = 'counter' and p_order.status in ('accepted', 'preparing')
      and greatest(p_order.accepted_at, coalesce(app.order_start_at(p_order), p_order.accepted_at)) <= p_at - make_interval(mins => coalesce(
        (select s.late_order_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10)),
    'lines', app.order_lines_json(p_order.id)
  );
$$;

comment on function app.order_json(public.orders, text, timestamptz) is 'an order as an answer shows it: for the counter (p_for counter) with the table id and the late flag (accepted or preparing for longer than the store''s late_order_minutes since acceptance, or since its preparation start for a takeaway booked for later), for the customer without staff identities; both with ready_estimate_at (app.order_ready_estimate), start_at (a takeaway with a pick-up time: when its preparation should start) and scheduled (accepted and its start still ahead: the counter shows "hẹn HH:MM" until then); for the counter whether a member''s stamp card is attached (member_attached)';

create or replace function app.counter_board(p_store_id uuid, p_cursor bigint default 0, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_today date := app.store_business_date(p_store_id, p_at);
  v_cursor bigint := greatest(coalesce(p_cursor, 0), 0);
begin
  insert into app.ordering_presence as p (store_id, user_id, seen_at)
  values (v_store.id, (select auth.uid()), p_at)
  on conflict (store_id, user_id) do update set seen_at = greatest(p.seen_at, excluded.seen_at);
  return jsonb_build_object(
    'store_id', v_store.id,
    'business_date', to_char(v_today, 'YYYY-MM-DD'),
    'ordering', app.ordering_state(v_store.id, null, p_at),
    'cursor', greatest(v_cursor, coalesce((select max(o.change_seq) from public.orders o where o.store_id = v_store.id), 0)),
    'counts', (
      select jsonb_build_object(
        'accepted', count(*) filter (where o.status = 'accepted'),
        'scheduled', count(*) filter (where o.status = 'accepted' and coalesce(app.order_start_at(o) > p_at, false)),
        'preparing', count(*) filter (where o.status = 'preparing'),
        'ready', count(*) filter (where o.status = 'ready'),
        'serving', count(*) filter (where o.status = 'serving'),
        'unpaid', count(*) filter (where o.payment_status = 'unpaid' and o.status in ('accepted', 'preparing', 'ready', 'serving')),
        'completed_today', count(*) filter (where o.status = 'completed' and o.business_date = v_today),
        'cancelled_today', count(*) filter (where o.status = 'cancelled' and o.business_date = v_today and o.order_no is not null)
      )
      from public.orders o
      where o.store_id = v_store.id
        and (o.status in ('accepted', 'preparing', 'ready', 'serving') or o.business_date = v_today)
    ),
    'orders', coalesce((
      select jsonb_agg(app.order_json(o, 'counter', p_at) order by o.change_seq)
      from (
        select o.* from public.orders o
        where o.store_id = v_store.id
          and o.change_seq > v_cursor
          and o.status <> 'awaiting_payment'
          and not (o.status = 'cancelled' and o.order_no is null)
          and (o.status in ('accepted', 'preparing', 'ready', 'serving') or o.business_date = v_today)
        order by o.change_seq
        limit 200
      ) o
    ), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'table_id', c.table_id, 'label', t.label, 'area', t.area, 'called_at', c.created_at) order by c.created_at)
      from public.table_calls c join public.store_tables t on t.id = c.table_id
      where c.store_id = v_store.id and c.acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.counter_board(uuid, bigint, timestamptz) is 'the counter''s queue (native-till.md 5.4), polled every 2 seconds: the ordering state, the counts per state (scheduled: accepted takeaway orders whose preparation start is still ahead, counted in accepted too), the orders changed since the cursor among the open ones and the business day''s closed ones (never one still awaiting its online payment, so a takeaway enters the queue only once paid; at most 200, oldest change first) with their lines, start_at, scheduled and the late flag, the open table calls, and the new cursor; records the caller''s presence; owners, managers and staff of the store only';

create or replace function app.customer_orders(p_before timestamptz default null, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.placed_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select o.id, o.placed_at, jsonb_build_object(
      'id', o.id, 'display_no', app.order_display_no(o.order_no), 'store_name', s.name, 'type', o.order_type, 'table_label', o.table_label,
      'status', o.status, 'payment_status', o.payment_status, 'total', o.total::bigint, 'placed_at', o.placed_at, 'pickup_at', o.pickup_at,
      'ready_estimate_at', app.order_ready_estimate(o),
      'items', (select coalesce(sum(l.quantity), 0) from public.order_lines l where l.order_id = o.id)
    ) as j
    from public.orders o join public.stores s on s.id = o.store_id
    where o.customer_login_id = v_login.id
      and (p_before is null or o.placed_at < p_before)
    order by o.placed_at desc, o.id desc
    limit 20
  ) x;
  return jsonb_build_object('orders', v_rows,
    'next_before', case when jsonb_array_length(v_rows) = 20 then (v_rows -> 19 ->> 'placed_at') end);
end;
$$;

comment on function app.customer_orders(timestamptz, timestamptz) is 'the customer''s own orders, newest first, 20 a page (next_before for the next page), each with its pick-up time and ready_estimate_at';

-- 5. Placement: the slot re-validated, held while the payment is open, and booked for the next opening while closed --

create or replace function app.customer_place_order(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_login app.customer_logins;
  v_store public.stores;
  v_settings public.store_ordering_settings;
  v_request_id uuid;
  v_hash text;
  v_existing public.orders;
  v_state jsonb;
  v_locked timestamptz;
  v_table jsonb := null;
  v_type text := p_request ->> 'type';
  v_payment text := p_request ->> 'payment';
  v_pickup timestamptz;
  v_slot_refusal text;
  v_priced jsonb;
  v_total numeric;
  v_order public.orders;
  v_status public.order_status;
  v_reward public.stamp_rewards;
  v_discount numeric := 0;
begin
  perform app.order_request_shape(p_request, false);
  v_login := app.customer_session();
  v_request_id := (p_request ->> 'request_id')::uuid;
  v_hash := app.sha256_hex(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended('fnb-order-request:' || v_login.id::text || ':' || v_request_id::text, 0));
  select o.* into v_existing from public.orders o where o.customer_login_id = v_login.id and o.request_id = v_request_id and o.source = 'app';
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash then
      return app.order_refused('request_conflict');
    end if;
    return app.order_place_answer(v_existing, true, p_at);
  end if;

  select c.* into v_ctx from app.customer_menu_store(p_request ->> 'store') c;
  select s.* into v_store from public.stores s where s.id = v_ctx.store_id;
  select o.* into v_settings from public.store_ordering_settings o where o.store_id = v_store.id;
  v_state := app.ordering_state(v_store.id, v_type, p_at);
  -- a closed store still books a takeaway for a time from its next opening (the slot check below decides the time)
  if not (v_state ->> 'accepting')::boolean
     and not (v_type = 'takeaway' and jsonb_typeof(p_request -> 'pickup_at') = 'string'
              and v_state ->> 'reason' in ('closed_now', 'last_orders_passed', 'closed_today')) then
    return app.order_refused(v_state ->> 'reason', jsonb_build_object('ordering', v_state));
  end if;
  if exists (select 1 from public.customer_order_blocks b where b.customer_login_id = v_login.id and b.tenant_id = v_store.tenant_id and b.blocked_until > p_at) then
    return app.order_refused('blocked');
  end if;
  v_locked := app.code_attempt_gate('customer_place_order', v_store.tenant_id, v_store.id, v_login.user_id, p_at);
  if v_locked is not null then
    return app.order_refused('rate_limited', jsonb_build_object('retry_at', v_locked));
  end if;
  perform app.code_attempt_record('customer_place_order', v_store.tenant_id, v_store.id, v_login.user_id, p_at);
  if (select count(*) from public.orders o
      where o.customer_login_id = v_login.id and o.status = any (app.order_open_statuses())
        and not (o.status = 'awaiting_payment' and o.payment_due_at <= p_at)) >= 3 then
    return app.order_refused('too_many_open_orders');
  end if;

  if v_type = 'table' then
    if jsonb_typeof(p_request -> 'table_token') is distinct from 'string' then
      return app.order_refused('table_unknown');
    end if;
    v_table := app.table_from_token(v_store.tenant_id, v_store.id, p_request ->> 'table_token', v_login.user_id, p_at);
    if v_table ->> 'state' <> 'ok' then
      return app.order_refused(v_table ->> 'refusal', case when v_table ? 'retry_at' then jsonb_build_object('retry_at', v_table -> 'retry_at') else '{}'::jsonb end);
    end if;
    if jsonb_typeof(p_request -> 'pickup_at') = 'string' then
      return app.order_refused('pickup_time_invalid');
    end if;
  else
    if jsonb_typeof(p_request -> 'table_token') = 'string' then
      return app.order_refused('table_not_for_takeaway');
    end if;
    if jsonb_typeof(p_request -> 'pickup_at') = 'string' then
      v_pickup := (p_request ->> 'pickup_at')::timestamptz;
    end if;
  end if;
  if not (v_payment = any (v_settings.payment_methods)) or (v_type = 'takeaway' and v_payment = 'counter') then
    return app.order_refused('payment_not_allowed');
  end if;
  if v_pickup is not null then
    -- one placement per slot at a time: the second of two customers taking the last place counts the first's order
    perform pg_advisory_xact_lock(hashtextextended('fnb-takeaway-slot:' || v_store.id::text || ':' || extract(epoch from v_pickup)::text, 0));
    v_slot_refusal := app.takeaway_slot_refusal(v_store.id, v_pickup, p_at);
    if v_slot_refusal is not null then
      return app.order_refused(v_slot_refusal, jsonb_build_object('pickup_at', v_pickup));
    end if;
  end if;

  v_priced := app.order_price_lines(v_store.id, v_ctx.brand_id, v_type, p_request -> 'lines', p_at);
  if not (v_priced ->> 'ok')::boolean then
    return app.order_refused(v_priced ->> 'refusal', v_priced - 'ok' - 'refusal' || jsonb_build_object('menu_version', app.menu_version(v_ctx.brand_id)));
  end if;
  v_total := (v_priced ->> 'subtotal')::numeric;
  if jsonb_typeof(p_request -> 'use_reward') = 'boolean' and (p_request ->> 'use_reward')::boolean then
    select r.* into v_reward
    from public.stamp_rewards r
    join public.stamp_cards c on c.id = r.card_id
    where c.brand_id = v_ctx.brand_id and c.customer_login_id = v_login.id and r.status = 'available'
    order by r.issued_at, r.id
    limit 1
    for update of r;
    if v_reward.id is null then
      return app.order_refused('no_reward');
    end if;
    select min((l ->> 'unit_price')::numeric) into v_discount
    from jsonb_array_elements(v_priced -> 'lines') as x (l)
    where (l ->> 'counts_for_stamps')::boolean;
    if v_discount is null then
      return app.order_refused('reward_not_applicable');
    end if;
    v_total := v_total - v_discount;
  end if;
  if v_total > v_settings.max_order_amount then
    return app.order_refused('amount_over_limit', jsonb_build_object('total', v_total::bigint, 'max_order_amount', v_settings.max_order_amount::bigint));
  end if;
  if v_total <> (p_request ->> 'expected_total')::numeric then
    return app.order_refused('price_changed', jsonb_build_object('total', v_total::bigint, 'discount_amount', v_discount::bigint, 'menu_version', app.menu_version(v_ctx.brand_id), 'lines', v_priced -> 'lines'));
  end if;

  v_status := case when v_payment = 'counter' or v_total = 0 then 'accepted' else 'awaiting_payment' end;
  insert into public.orders (tenant_id, brand_id, store_id, source, customer_login_id, order_type, table_id, table_label, pickup_at, business_date,
    order_no, status, payment_status, payment_method, subtotal, discount_amount, total, note, request_id, request_hash, menu_version,
    placed_at, payment_due_at, accepted_at, paid_at)
  values (v_store.tenant_id, v_ctx.brand_id, v_store.id, 'app', v_login.id, v_type, (v_table ->> 'table_id')::uuid, v_table ->> 'label', v_pickup,
    app.store_business_date(v_store.id, coalesce(v_pickup, p_at)),
    case when v_status = 'accepted' then app.next_order_no(v_store.id, app.store_business_date(v_store.id, coalesce(v_pickup, p_at))) end,
    v_status, case when v_total = 0 then 'paid' else 'unpaid' end::public.order_payment_status, v_payment, (v_priced ->> 'subtotal')::numeric, v_discount, v_total, app.order_note(p_request -> 'note'), v_request_id, v_hash,
    coalesce((p_request ->> 'menu_version')::bigint, app.menu_version(v_ctx.brand_id)),
    p_at,
    case when v_status = 'awaiting_payment' then p_at + make_interval(mins => case when v_pickup is not null
      then least(v_settings.payment_window_minutes, app.takeaway_hold_minutes()) else v_settings.payment_window_minutes end) end,
    case when v_status = 'accepted' then p_at end, case when v_total = 0 then p_at end)
  returning * into v_order;
  insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_id, size_id, item_name, size_label, quantity, unit_price, options,
    options_amount, line_total, counts_for_stamps, note)
  select v_order.tenant_id, v_order.store_id, v_order.id, (l ->> 'line_no')::smallint, (l ->> 'item_id')::uuid, (l ->> 'size_id')::uuid, l ->> 'item_name',
    l ->> 'size_label', (l ->> 'quantity')::integer, (l ->> 'unit_price')::numeric, l -> 'options', (l ->> 'options_amount')::numeric,
    (l ->> 'line_total')::numeric, (l ->> 'counts_for_stamps')::boolean, l ->> 'note'
  from jsonb_array_elements(v_priced -> 'lines') as x (l);
  perform app.order_event(v_order, 'status', 'placed', null, v_status::text, 'customer', v_login.user_id, null, null, v_order.total, p_at);
  if v_reward.id is not null then
    update public.stamp_rewards r set status = 'used', used_order_id = v_order.id, used_at = p_at where r.id = v_reward.id;
    perform app.stamp_entry(v_reward.card_id, 'reward_used', 0, v_order.id, v_reward.id, 'customer', v_login.user_id, null, p_at);
  end if;
  if v_order.total = 0 then
    perform app.order_event(v_order, 'payment', 'paid', 'unpaid', 'paid', 'customer', v_login.user_id, 'reward', null, 0, p_at);
  end if;
  return app.order_place_answer(v_order, false, p_at);
end;
$$;

comment on function app.customer_place_order(jsonb, timestamptz) is 'the customer''s order (native-till.md 5.3 and 19), writing nothing until every check passes: the shape (22023), the session (42501), the replay (the same request_id answers the first order, replayed true; another request under it request_conflict; parallel calls serialised by an advisory lock), the store of the brand (22023), the ordering state''s reason (a takeaway with a pick-up time also while the store is closed: closed_now, last_orders_passed, closed_today), blocked, rate_limited (20 calls of a customer and 200 of a store in 15 minutes), too_many_open_orders (3), the table token (table_unknown) or a pick-up time on a table order (pickup_time_invalid), payment_not_allowed (takeaway is prepaid online), the takeaway slot under a lock per slot (app.takeaway_slot_refusal: slot_passed, closed, pickup_time_invalid, slot_full, with the pickup_at asked), item_unavailable or option_invalid, with use_reward the customer''s oldest stamp reward (no_reward, reward_not_applicable without a drink) taken off as the cheapest drink''s size price, amount_over_limit, price_changed with the total; then the order with its priced lines and its first event, the reward marked used: accepted with its number and payment unpaid for the counter, awaiting_payment until payment_due_at for an online method (a takeaway with a pick-up time holds its place 10 minutes, or the store''s window when shorter); a takeaway with a pick-up time belongs to the business date of the pick-up; an order the reward makes free (total 0) is accepted and paid at once, logged as paid by reward';

-- 6. A new pick-up time while the payment is open ("Giờ lấy đã qua. Chọn giờ khác.") -------------------------------

create function app.customer_change_pickup(p_order_id uuid, p_pickup_at timestamptz, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_order public.orders;
  v_locked timestamptz;
  v_refusal text;
begin
  if p_order_id is null or p_pickup_at is null then
    raise exception 'a change names the order and the new pick-up time' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id and o.customer_login_id = v_login.id for update;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order', 'replayed', false, 'order', null);
  end if;
  if v_order.pickup_at = p_pickup_at and v_order.status = 'awaiting_payment' then
    return jsonb_build_object('state', 'changed', 'refusal', null, 'replayed', true, 'order', app.order_json(v_order, 'customer', p_at));
  end if;
  if v_order.order_type <> 'takeaway' or v_order.status <> 'awaiting_payment' or v_order.payment_due_at <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_changeable', 'replayed', false, 'order', app.order_json(v_order, 'customer', p_at));
  end if;
  v_locked := app.code_attempt_gate('customer_change_pickup', v_order.tenant_id, v_order.store_id, v_login.user_id, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'replayed', false, 'order', null);
  end if;
  perform app.code_attempt_record('customer_change_pickup', v_order.tenant_id, v_order.store_id, v_login.user_id, p_at);
  perform pg_advisory_xact_lock(hashtextextended('fnb-takeaway-slot:' || v_order.store_id::text || ':' || extract(epoch from p_pickup_at)::text, 0));
  v_refusal := app.takeaway_slot_refusal(v_order.store_id, p_pickup_at, p_at);
  if v_refusal is not null then
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal, 'replayed', false, 'pickup_at', p_pickup_at, 'order', app.order_json(v_order, 'customer', p_at));
  end if;
  update public.orders o
  set pickup_at = p_pickup_at,
      business_date = app.store_business_date(o.store_id, p_pickup_at),
      version = o.version + 1,
      change_seq = nextval('app.order_change_seq')
  where o.id = v_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'status', 'pickup_changed', 'awaiting_payment', 'awaiting_payment', 'customer', v_login.user_id, null, null, null, p_at);
  return jsonb_build_object('state', 'changed', 'refusal', null, 'replayed', false, 'order', app.order_json(v_order, 'customer', p_at));
end;
$$;

comment on function app.customer_change_pickup(uuid, timestamptz, timestamptz) is 'the customer moves their own takeaway order to another pick-up slot while its payment is open (C17 after "Giờ lấy đã qua"): the order found by its id and the session together (another customer''s order answers unknown_order, as an unknown id), the same time again a replay, not_changeable for a table order, one already paid or cancelled or whose hold passed, rate_limited (10 changes of a customer and 200 of a store in 15 minutes), the new slot checked as at placement under its lock (slot_passed, closed, pickup_time_invalid, slot_full); the hold keeps its end (payment_due_at), the order moves to the business date of the new time and logs pickup_changed; 42501 without a customer session';

-- 7. Public wrappers and grants -------------------------------------------------------------------------------------

create function public.customer_takeaway_slots(p_store_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
begin
  select c.* into v_ctx from app.customer_menu_store(p_store_code) c;
  return app.takeaway_slots(v_ctx.store_id, now());
end;
$$;
comment on function public.customer_takeaway_slots(text) is 'RPC for the customer Mini App (C17): the takeaway pick-up slots of a store of the app''s brand (app.takeaway_slots) at the server''s current time; 42501 without a customer session, 22023 for a store that is not the brand''s';

create function public.customer_change_pickup(p_order uuid, p_pickup_at timestamptz)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_change_pickup(p_order, p_pickup_at, now()); $$;
comment on function public.customer_change_pickup(uuid, timestamptz) is 'RPC for the customer Mini App (C17): app.customer_change_pickup at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('takeaway_hold_minutes', 'takeaway_slot_starts', 'takeaway_slot_taken', 'takeaway_offer', 'takeaway_slots',
        'takeaway_slot_refusal', 'order_start_at', 'ordering_waiting_orders', 'ordering_state', 'order_json', 'counter_board', 'customer_orders',
        'customer_place_order', 'customer_change_pickup')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_takeaway_slots(text), public.customer_change_pickup(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.customer_takeaway_slots(text), public.customer_change_pickup(uuid, timestamptz) to authenticated;
