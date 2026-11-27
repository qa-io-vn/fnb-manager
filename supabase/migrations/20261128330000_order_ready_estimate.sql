-- When an order should be ready (C06, Q01; the customer app's and the counter's order screens): an accepted order is
-- ready the store's preparation minutes (store_ordering_settings.prep_minutes, 0 to 120, 10 by default: the same
-- preparation time that sets the earliest takeaway pick-up) after it was accepted, and not before its pick-up time; once
-- staff start it, the estimate is recomputed from the start. An order waiting for its payment, ready, being served,
-- completed or cancelled has none (null). The estimate is computed when an answer is built, so a changed setting
-- applies at once and nothing is stored.

create function app.order_ready_estimate(p_order public.orders)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_order.status = 'accepted' and p_order.accepted_at is not null
      then greatest(p_order.accepted_at + make_interval(mins => m.prep), coalesce(p_order.pickup_at, '-infinity'::timestamptz))
    when p_order.status = 'preparing' and p_order.preparing_at is not null
      then p_order.preparing_at + make_interval(mins => m.prep)
  end
  from (
    select coalesce((select s.prep_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10) as prep
  ) m;
$$;

comment on function app.order_ready_estimate(public.orders) is 'when an order should be ready: accepted, the acceptance plus the store''s prep_minutes and not before the pick-up time; preparing, the start plus prep_minutes (recomputed when staff start it); null in every other state';

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
    'late', p_for = 'counter' and p_order.status in ('accepted', 'preparing') and p_order.accepted_at <= p_at - make_interval(mins => coalesce(
      (select s.late_order_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10)),
    'lines', app.order_lines_json(p_order.id)
  );
$$;

comment on function app.order_json(public.orders, text, timestamptz) is 'an order as an answer shows it: for the counter (p_for counter) with the table id and the late flag (accepted or preparing for longer than the store''s late_order_minutes since acceptance), for the customer without staff identities; both with ready_estimate_at (app.order_ready_estimate)';

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
      'status', o.status, 'payment_status', o.payment_status, 'total', o.total::bigint, 'placed_at', o.placed_at,
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

comment on function app.customer_orders(timestamptz, timestamptz) is 'the customer''s own orders, newest first, 20 a page (next_before for the next page), each with ready_estimate_at';

comment on column public.store_ordering_settings.prep_minutes is 'the store''s preparation time in minutes (0 to 120, 10 by default): the earliest takeaway pick-up after placement, and the time after acceptance (or after staff start it) at which an order is estimated ready (ready_estimate_at)';

revoke all on function app.order_ready_estimate(public.orders) from public, anon, authenticated, service_role;
