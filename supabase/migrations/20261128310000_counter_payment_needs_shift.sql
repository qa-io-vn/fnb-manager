-- Cash and card are taken at the counter only by a person on shift there (Q01, Q02; counter-app.md section 3): the
-- drawer a clock-out counts is the cash its person recorded during the shift, so a payment recorded by someone who is
-- not clocked in at the store would land in no drawer and every count would be off. counter_record_payment now answers
-- shift_required (a coded refusal, nothing written) when the caller has no open shift at the order's store, and a
-- trigger refuses any staff-recorded cash or card payment row without one, so a later version of the function cannot
-- skip the rule. Card follows cash: the design records it at the counter like cash (Q01-I8, "tested like cash").

create function app.counter_shift_open(p_store_id uuid, p_user_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1 from public.staff_shifts s
    where s.store_id = p_store_id and s.user_id = p_user_id and s.status = 'open' and s.clock_in_at <= p_at
  );
$$;

comment on function app.counter_shift_open(uuid, uuid, timestamptz) is 'whether a person has an open shift at a store that began by an instant: the condition for taking cash or card at its counter';

create function app.order_payments_need_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method in ('cash', 'card') and new.recorded_by is not null
     and not app.counter_shift_open(new.store_id, new.recorded_by, coalesce(new.settled_at, new.requested_at)) then
    raise exception 'cash and card are recorded only by a person on shift at the store' using errcode = '42501', hint = 'shift_required';
  end if;
  return new;
end;
$$;

comment on function app.order_payments_need_shift() is 'trigger before insert on order_payments: a cash or card payment recorded by a person needs that person''s open shift at the store (42501, hint shift_required); rows without a recorder (fixtures, migrations) are not checked';

create trigger order_payments_need_shift
before insert on public.order_payments
for each row execute function app.order_payments_need_shift();

create or replace function app.counter_record_payment(p_order_id uuid, p_method text, p_amount numeric, p_expected_version integer, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders := app.order_for_counter(p_order_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_uid uuid := (select auth.uid());
  v_payment public.order_payments;
  v_answer jsonb;
begin
  if p_method is null or p_method not in ('cash', 'card') then
    raise exception 'the counter records cash or card' using errcode = '22023';
  end if;
  if p_amount is null or not app.native_price_valid(p_amount, 1, 100000000) then
    raise exception 'an amount is a whole number of dong' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'a payment names the version of the order it saw' using errcode = '22023';
  end if;
  if v_order.payment_status = 'paid' then
    select p.* into v_payment from public.order_payments p
    where p.order_id = v_order.id and p.status = 'succeeded' and p.method = p_method and p.amount = p_amount;
    return jsonb_build_object('state', case when v_payment.id is null then 'refused' else 'paid' end,
      'refusal', case when v_payment.id is null then 'already_paid' end, 'replayed', v_payment.id is not null,
      'payment_id', v_payment.id, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('state', 'refused', 'refusal', 'order_cancelled', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.payment_status <> 'unpaid' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_payable', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.version <> p_expected_version then
    return jsonb_build_object('state', 'conflict', 'refusal', 'conflict', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if p_amount <> v_order.total then
    return jsonb_build_object('state', 'refused', 'refusal', 'amount_differs', 'replayed', false, 'total', v_order.total::bigint,
      'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if not app.counter_shift_open(v_order.store_id, v_uid, p_at) then
    return jsonb_build_object('state', 'refused', 'refusal', 'shift_required', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, recorded_by, requested_at, settled_at)
  values (v_order.tenant_id, v_order.store_id, v_order.id, p_method, p_amount, 'succeeded', v_uid, p_at, p_at)
  returning * into v_payment;
  v_answer := app.order_payment_succeeded(v_order.id, p_amount, 'staff', v_uid, p_at);
  select o.* into v_order from public.orders o where o.id = v_order.id;
  return jsonb_build_object('state', 'paid', 'refusal', null, 'replayed', false, 'payment_id', v_payment.id, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_record_payment(uuid, text, numeric, integer, timestamptz) is '"Đã thu": staff record a cash or card payment of an order''s full total (ADR-061: a counter order is completed only after it), with the version they saw; an order paid the same way again is a replay, another payment already_paid, a cancelled order order_cancelled, another amount amount_differs, a moved order conflict, and a caller without an open shift at the order''s store shift_required (nothing written: the cash would land in no drawer); accepts an order still waiting for its online payment when the customer pays at the counter instead; owners, managers and staff of the store';

revoke all on function app.counter_shift_open(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.order_payments_need_shift() from public, anon, authenticated, service_role;
