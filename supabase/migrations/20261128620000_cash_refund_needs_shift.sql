-- Cash handed back at the counter needs an open shift there, as cash taken does (migration counter_payment_needs_shift;
-- Q02, Q03-I3): the drawer a clock-out counts is the cash its person recorded less the cash they handed back during the
-- shift, so a cash refund recorded by someone who is not clocked in at the store would leave every count off.
-- counter_refund now answers shift_required (a coded refusal, nothing written) when the refund would be settled in cash
-- and the caller has no open shift at the order's store; a trigger refuses any other writer of such a row. Only cash is
-- gated: a card refund is handed back on the terminal and an online refund goes back through the provider, neither
-- touches the drawer. A refund is settled in cash when the order was paid in cash, or when a manager settles in cash an
-- online refund the provider failed.

create function app.order_refunds_need_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method = 'cash' and new.status = 'succeeded' and new.recorded_by is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'succeeded' or old.method is distinct from 'cash' or old.recorded_by is distinct from new.recorded_by)
     and not app.counter_shift_open(new.store_id, new.recorded_by, coalesce(new.settled_at, new.requested_at)) then
    raise exception 'cash is handed back only by a person on shift at the store' using errcode = '42501', hint = 'shift_required';
  end if;
  return new;
end;
$$;

comment on function app.order_refunds_need_shift() is 'trigger before insert or update on order_refunds: a refund that becomes a succeeded cash refund recorded by a person needs that person''s open shift at the store when it is settled (42501, hint shift_required); rows without a recorder (fixtures, migrations, a deleted user) and rows already settled in cash are not checked';

create trigger order_refunds_need_shift
before insert or update on public.order_refunds
for each row execute function app.order_refunds_need_shift();

create or replace function app.counter_refund(p_order_id uuid, p_amount numeric, p_reason text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders := app.order_for_counter(p_order_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_uid uuid := (select auth.uid());
  v_manager boolean := app.has_store_scope(v_order.tenant_id, v_order.store_id, array['owner', 'manager']::public.tenant_role[]);
  v_reason text := nullif(btrim(p_reason), '');
  v_money record;
  v_due public.order_refunds;
  v_payment public.order_payments;
  v_refund public.order_refunds;
  v_refundable numeric;
  v_settles_due boolean;
  v_method text;
  v_succeeds boolean;
begin
  if p_amount is null or not app.native_price_valid(p_amount, 1, 100000000) then
    raise exception 'a refund is a whole number of dong' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a refund needs a reason of 1 to 200 characters on one line' using errcode = '22023';
  end if;
  if v_order.payment_status not in ('paid', 'refund_pending', 'partially_refunded') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_refundable', 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  select m.* into v_money from app.order_money(v_order.id) m;
  select r.* into v_due from public.order_refunds r where r.order_id = v_order.id and r.status in ('due', 'failed') order by (r.status = 'due') desc, r.requested_at, r.id limit 1 for update;
  v_refundable := v_money.paid - v_money.refunded - (v_money.refund_open - coalesce(v_due.amount, 0));
  if p_amount > v_refundable then
    return jsonb_build_object('state', 'refused', 'refusal', 'amount_over_refundable', 'refundable', v_refundable::bigint, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if not v_manager and (v_due.id is null or p_amount <> v_due.amount or v_due.status = 'failed') then
    return jsonb_build_object('state', 'refused', 'refusal', 'manager_required', 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  select p.* into v_payment from public.order_payments p
  where p.order_id = v_order.id and p.status = 'succeeded'
  order by (p.id = v_due.payment_id) desc, p.settled_at desc, p.id
  limit 1;
  v_settles_due := v_due.id is not null and p_amount = v_due.amount;
  v_method := case when v_settles_due and v_due.status = 'failed' then 'cash' when v_settles_due then v_due.method else v_payment.method end;
  v_succeeds := v_payment.method in ('cash', 'card') or (v_settles_due and v_due.status = 'failed');
  if v_method = 'cash' and v_succeeds and not app.counter_shift_open(v_order.store_id, v_uid, p_at) then
    return jsonb_build_object('state', 'refused', 'refusal', 'shift_required', 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_settles_due then
    update public.order_refunds r
    set status = case when v_succeeds then 'succeeded' else 'pending' end,
        method = v_method,
        recorded_by = v_uid,
        settled_at = case when v_succeeds then p_at end,
        reason = left(r.reason || '; ' || v_reason, 200)
    where r.id = v_due.id
    returning r.* into v_refund;
  else
    insert into public.order_refunds (tenant_id, store_id, order_id, payment_id, method, amount, status, reason, requested_by, requested_at, recorded_by, settled_at)
    values (v_order.tenant_id, v_order.store_id, v_order.id, v_payment.id, v_payment.method, p_amount,
      case when v_succeeds then 'succeeded' else 'pending' end, v_reason, v_uid, p_at, v_uid,
      case when v_succeeds then p_at end)
    returning * into v_refund;
  end if;
  v_order := app.order_settle_payment_status(v_order.id, p_at);
  perform app.order_event(v_order, 'payment', case when v_refund.status = 'succeeded' then 'refunded' else 'refund_requested' end,
    null, v_order.payment_status::text, 'staff', v_uid, v_refund.method, v_reason, v_refund.amount, p_at);
  if v_refund.status = 'succeeded' then
    perform app.order_after_refund(v_order, p_at);
  end if;
  return jsonb_build_object('state', v_refund.status, 'refusal', null, 'refund_id', v_refund.id, 'amount', v_refund.amount::bigint,
    'method', v_refund.method, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_refund(uuid, numeric, text, timestamptz) is 'records a refund of an order with its reason: the due refund of a cancelled paid order, in full, by any staff member of the store; any other refund (a completed order, a partial amount, an online refund the provider failed, then handed back in cash) by a manager or owner (manager_required otherwise); at most what was paid less earlier refunds (amount_over_refundable). A refund settled in cash needs the caller''s open shift at the order''s store (shift_required otherwise, after the order''s own refusals, nothing written: the cash leaves a counted drawer); card and online refunds do not. Cash and card are handed back at once (succeeded); an online payment''s refund is pending until the provider confirms (checkout_refund_confirm). Every refund is an order_refunds row and an event with who, when and how much; a succeeded one runs the refund hook (stamps back, invoice adjusted)';

revoke all on function app.counter_refund(uuid, numeric, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.order_refunds_need_shift() from public, anon, authenticated, service_role;
