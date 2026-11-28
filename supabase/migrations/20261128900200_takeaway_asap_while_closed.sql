-- A fix to 20261128900000_takeaway_slots (found by pgTAP 305 before anything shipped): a takeaway asked "as soon as
-- possible" (no pick-up time) while the store was closed slipped past the ordering state, because the exception for a
-- booking of the next opening compared a missing pick-up time to null. The exception now holds only for a request that
-- carries a pick-up time; everything else is as in that migration.

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
     and not (v_type = 'takeaway' and jsonb_typeof(p_request -> 'pickup_at') is not distinct from 'string'
              and coalesce(v_state ->> 'reason' in ('closed_now', 'last_orders_passed', 'closed_today'), false)) then
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

revoke all on function app.customer_place_order(jsonb, timestamptz) from public, anon, authenticated, service_role;
