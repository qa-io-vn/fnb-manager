-- "Đối chiếu" for the cashier after the count (Q02 frame 1): the opening cash, the cash sales, the cash refunds, the
-- paid-outs, what the drawer should hold, what was counted and the difference, and beside them what is not in the
-- drawer (card at the counter, VietQR, the Zalo wallet). The count stays blind: the person of a shift reads it only once
-- their count is recorded (the shift is no longer open); before that the answer is count_required with the shift as the
-- person sees it, without the expected cash. Owners and managers of the store read it for any shift of another person
-- at any time, an open one included (the figures so far), as manager_shifts already shows them the expected cash; their
-- own shift follows the person's rule, so a manager on shift counts blind too.

create function app.staff_shift_reconciliation(p_shift_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shift public.staff_shifts;
  v_own boolean;
  v_manager boolean;
  v_until timestamptz;
  v_sales record;
  v_refunds record;
  v_card record;
  v_card_refunds record;
  v_online jsonb;
begin
  if p_shift_id is null then
    raise exception 'a shift id' using errcode = '22023';
  end if;
  select s.* into v_shift from public.staff_shifts s where s.id = p_shift_id;
  v_own := v_uid is not null and v_shift.user_id = v_uid;
  v_manager := v_uid is not null and v_shift.id is not null
    and app.has_store_scope(v_shift.tenant_id, v_shift.store_id, array['owner', 'manager']::public.tenant_role[]);
  if v_shift.id is null
     or not (v_manager or (v_own and app.has_store_scope(v_shift.tenant_id, v_shift.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]))) then
    raise exception 'only the shift''s person or an owner or manager of its store reads its reconciliation' using errcode = '42501';
  end if;
  if v_own and v_shift.status = 'open' then
    return jsonb_build_object('state', 'refused', 'refusal', 'count_required', 'shift', app.shift_json(v_shift, 'staff'), 'reconciliation', null);
  end if;
  v_until := coalesce(v_shift.clock_out_at, greatest(p_at, v_shift.clock_in_at));
  select count(distinct p.order_id) as orders, coalesce(sum(p.amount), 0) as total into v_sales
  from public.order_payments p
  where p.store_id = v_shift.store_id and p.method = 'cash' and p.status = 'succeeded' and p.recorded_by = v_shift.user_id
    and p.settled_at >= v_shift.clock_in_at and p.settled_at < v_until;
  select count(distinct r.order_id) as orders, coalesce(sum(r.amount), 0) as total into v_refunds
  from public.order_refunds r
  where r.store_id = v_shift.store_id and r.method = 'cash' and r.status = 'succeeded' and r.recorded_by = v_shift.user_id
    and r.settled_at >= v_shift.clock_in_at and r.settled_at < v_until;
  select count(distinct p.order_id) as orders, coalesce(sum(p.amount), 0) as total into v_card
  from public.order_payments p
  where p.store_id = v_shift.store_id and p.method = 'card' and p.status = 'succeeded' and p.recorded_by = v_shift.user_id
    and p.settled_at >= v_shift.clock_in_at and p.settled_at < v_until;
  select count(distinct r.order_id) as orders, coalesce(sum(r.amount), 0) as total into v_card_refunds
  from public.order_refunds r
  where r.store_id = v_shift.store_id and r.method = 'card' and r.status = 'succeeded' and r.recorded_by = v_shift.user_id
    and r.settled_at >= v_shift.clock_in_at and r.settled_at < v_until;
  select jsonb_object_agg(m.method, jsonb_build_object('count', coalesce(x.orders, 0), 'total', coalesce(x.total, 0)::bigint)) into v_online
  from (values ('vietqr'), ('zalo_checkout')) as m (method)
  left join (
    select p.method, count(distinct p.order_id) as orders, sum(p.amount) as total
    from public.order_payments p
    where p.store_id = v_shift.store_id and p.method in ('vietqr', 'zalo_checkout') and p.status = 'succeeded'
      and p.settled_at >= v_shift.clock_in_at and p.settled_at < v_until
    group by p.method
  ) x on x.method = m.method;
  return jsonb_build_object(
    'state', 'ok',
    'refusal', null,
    'shift', app.shift_json(v_shift, case when v_manager and not v_own then 'manager' else 'staff' end),
    'reconciliation', jsonb_build_object(
      'from', v_shift.clock_in_at,
      'until', v_until,
      'counted', v_shift.status <> 'open',
      'opening_cash', v_shift.opening_cash::bigint,
      'cash_sales', jsonb_build_object('count', v_sales.orders, 'total', v_sales.total::bigint),
      'cash_refunds', jsonb_build_object('count', v_refunds.orders, 'total', v_refunds.total::bigint),
      'paid_outs', jsonb_build_object('count', 0, 'total', 0),
      'expected_cash', case when v_shift.status <> 'open' then v_shift.expected_cash
        else v_shift.opening_cash + v_sales.total - v_refunds.total end::bigint,
      'counted_cash', v_shift.counted_cash::bigint,
      'cash_difference', v_shift.cash_difference::bigint,
      'matched', case when v_shift.status <> 'open' then v_shift.cash_difference = 0 end,
      'not_in_drawer', jsonb_build_object(
        'card', jsonb_build_object('count', v_card.orders, 'total', v_card.total::bigint),
        'card_refunds', jsonb_build_object('count', v_card_refunds.orders, 'total', v_card_refunds.total::bigint),
        'vietqr', v_online -> 'vietqr',
        'zalo_checkout', v_online -> 'zalo_checkout'
      )
    )
  );
end;
$$;

comment on function app.staff_shift_reconciliation(uuid, timestamptz) is 'Q02 "Đối chiếu" of a shift: the opening cash, the cash sales and cash refunds the person recorded during the shift (orders and totals; voided payments left out), the paid-outs (none are recorded yet: always 0), the expected cash, the count and the difference, and what is not in the drawer (the card payments and card refunds the person recorded, the store''s VietQR and Zalo wallet payments settled during the shift). The person of the shift reads it only once their count is recorded (count_required while the shift is open, with the shift as they see it and no expected cash: the count stays blind), also when they are an owner or manager; owners and managers of the store read any other person''s shift at any time (an open one up to now, not counted). 42501 for anyone else and for an unknown shift; 22023 without an id';

create function public.staff_shift_reconciliation(p_shift uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.staff_shift_reconciliation(p_shift, now()); $$;
comment on function public.staff_shift_reconciliation(uuid) is 'RPC for the counter web app (Q02 "Đối chiếu") and the manager app: app.staff_shift_reconciliation at the current time';

revoke all on function app.staff_shift_reconciliation(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.staff_shift_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.staff_shift_reconciliation(uuid) to authenticated;
