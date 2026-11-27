-- The native till, step 4 (ADR-061, ADR-062, native-till.md section 6): payment and refund records. The counter records
-- cash and card payments (required before completion), undoes its own within 10 minutes, and records refunds; every
-- payment, void and refund is an event with who, when and how much. Online payments (Checkout SDK, dynamic VietQR) have
-- server-only seams: an attempt is opened for the customer's own order, and only a verified provider confirmation moves
-- it; refunds of online payments are settled the same way. Hooks for stamps (step 5) and sales facts (step 6).

-- 1. Tables --------------------------------------------------------------------------------------------------------

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  method text not null check (method in ('cash', 'card', 'zalo_checkout', 'vietqr')),
  amount numeric(14, 2) not null check (app.native_price_valid(amount, 1, 100000000)),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'voided')),
  provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_ref text check (provider_ref is null or (char_length(provider_ref) between 1 and 100 and provider_ref !~ '[[:cntrl:][:space:]]')),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  recorded_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null,
  settled_at timestamptz,
  failure_reason text check (failure_reason is null or (char_length(failure_reason) between 1 and 200 and failure_reason !~ '[[:cntrl:]]')),
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  void_reason text check (void_reason is null or (char_length(void_reason) between 1 and 200 and void_reason !~ '[[:cntrl:]]')),
  unique (tenant_id, id),
  unique (provider, provider_ref),
  unique (order_id, idempotency_key),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check ((method in ('cash', 'card')) = (provider is null)),
  check ((status = 'voided') = (voided_at is not null)),
  check (status = 'pending' or settled_at is not null)
);

create index order_payments_order_idx on public.order_payments (order_id);
create index order_payments_pending_idx on public.order_payments (requested_at) where status = 'pending';
create index order_payments_store_idx on public.order_payments (store_id, settled_at);
create index order_payments_tenant_idx on public.order_payments (tenant_id);

comment on table public.order_payments is 'every payment of a native order (ADR-062): cash and card recorded by staff at the counter (succeeded at once), online attempts (zalo_checkout, vietqr) pending until the server''s verified provider confirmation; a counter payment voided within 10 minutes by its recorder or later by a manager; written only by security definer functions';
comment on column public.order_payments.provider_ref is 'the provider''s transaction id, unique per provider, so a repeated notification answers its first outcome';

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  payment_id uuid,
  method text not null check (method in ('cash', 'card', 'zalo_checkout', 'vietqr')),
  amount numeric(14, 2) not null check (app.native_price_valid(amount, 1, 100000000)),
  status text not null check (status in ('due', 'pending', 'succeeded', 'failed')),
  reason text not null check (char_length(reason) between 1 and 200 and reason !~ '[[:cntrl:]]'),
  provider_ref text check (provider_ref is null or (char_length(provider_ref) between 1 and 100 and provider_ref !~ '[[:cntrl:][:space:]]')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null,
  recorded_by uuid references auth.users (id) on delete set null,
  settled_at timestamptz,
  unique (tenant_id, id),
  unique (method, provider_ref),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_id) references public.order_payments (tenant_id, id) on delete set null (payment_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (status not in ('succeeded', 'failed') or settled_at is not null)
);

create index order_refunds_order_idx on public.order_refunds (order_id);
create index order_refunds_open_idx on public.order_refunds (status) where status in ('due', 'pending');
create index order_refunds_store_idx on public.order_refunds (store_id, settled_at);
create index order_refunds_tenant_idx on public.order_refunds (tenant_id);

comment on table public.order_refunds is 'every refund of a native order with its amount, reason, who asked and who recorded it (ADR-061: every cancel and refund is logged): due when a paid order is cancelled, succeeded at once for cash and card handed back at the counter, pending for an online payment until the provider''s confirmation';

alter table public.order_payments enable row level security;
alter table public.order_refunds enable row level security;
create policy order_payments_select on public.order_payments
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy order_refunds_select on public.order_refunds
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
revoke all on public.order_payments, public.order_refunds from anon, authenticated;
grant select on public.order_payments, public.order_refunds to authenticated;

-- 2. Money helpers and hooks --------------------------------------------------------------------------------------

create function app.order_money(p_order_id uuid)
returns table (paid numeric, refunded numeric, refund_open numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(p.amount) from public.order_payments p where p.order_id = p_order_id and p.status = 'succeeded'), 0),
    coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = p_order_id and r.status = 'succeeded'), 0),
    coalesce((select sum(r.amount) from public.order_refunds r where r.order_id = p_order_id and r.status in ('due', 'pending', 'failed')), 0);
$$;

comment on function app.order_money(uuid) is 'an order''s money: what succeeded payments brought in, what succeeded refunds gave back, and what refunds are still owed (due, pending, or failed at the provider and waiting for a manager)';

create function app.order_settle_payment_status(p_order_id uuid, p_at timestamptz)
returns public.orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_money record;
  v_status public.order_payment_status;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  select m.* into v_money from app.order_money(p_order_id) m;
  v_status := case
    when v_money.paid = 0 then 'unpaid'
    when v_money.refunded >= v_money.paid then 'refunded'
    when v_money.refund_open > 0 then 'refund_pending'
    when v_money.refunded > 0 then 'partially_refunded'
    else 'paid'
  end;
  if v_status is distinct from v_order.payment_status then
    update public.orders o
    set payment_status = v_status, version = o.version + 1, change_seq = nextval('app.order_change_seq')
    where o.id = v_order.id
    returning o.* into v_order;
  end if;
  return v_order;
end;
$$;

comment on function app.order_settle_payment_status(uuid, timestamptz) is 'sets an order''s payment status from its money: unpaid without a succeeded payment, refunded once refunds cover the payments, refund_pending while a refund is due or pending, partially_refunded after a partial refund, else paid; moves the version and the change cursor when it changes';

create function app.order_after_completion(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

create function app.order_after_refund(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

comment on function app.order_after_completion(public.orders, timestamptz) is 'the hook run when an order is completed (paid by then): stamps (step 5) and the sales facts (step 6) replace it';
comment on function app.order_after_refund(public.orders, timestamptz) is 'the hook run after a refund succeeds: stamps are taken back (step 5) and the invoice adjusted (step 6)';

-- 3. The lifecycle writer gains the refund due and the completion hook ----------------------------------------------

create or replace function app.order_move(p_order public.orders, p_to public.order_status, p_action text, p_actor_kind text, p_actor uuid,
  p_reason_code text, p_reason_text text, p_at timestamptz)
returns public.orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_no integer := p_order.order_no;
  v_payment public.order_payments;
  v_money record;
begin
  if p_to = 'accepted' and v_no is null then
    v_no := app.next_order_no(p_order.store_id, p_order.business_date);
  end if;
  update public.orders o
  set status = p_to,
      order_no = v_no,
      version = o.version + 1,
      change_seq = nextval('app.order_change_seq'),
      accepted_at = case when p_to = 'accepted' then p_at else o.accepted_at end,
      preparing_at = case when p_to = 'preparing' then p_at else o.preparing_at end,
      done_at = case when p_to in ('ready', 'serving') then p_at else o.done_at end,
      completed_at = case when p_to = 'completed' then p_at else o.completed_at end,
      payment_due_at = case when p_to = 'awaiting_payment' then o.payment_due_at end,
      cancelled_at = case when p_to = 'cancelled' then p_at end,
      cancelled_by = case when p_to = 'cancelled' then p_actor end,
      cancel_actor = case when p_to = 'cancelled' then p_actor_kind end,
      cancel_reason = case when p_to = 'cancelled' then p_reason_code end,
      cancel_note = case when p_to = 'cancelled' then p_reason_text end
  where o.id = p_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'status', p_action, p_order.status::text, p_to::text, p_actor_kind, p_actor, p_reason_code, p_reason_text,
    case when p_to = 'cancelled' and p_order.payment_status = 'paid' then p_order.total end, p_at);
  if p_to = 'cancelled' and p_order.payment_status = 'paid' then
    select m.* into v_money from app.order_money(v_order.id) m;
    select p.* into v_payment from public.order_payments p where p.order_id = v_order.id and p.status = 'succeeded' order by p.settled_at desc, p.id limit 1;
    if v_money.paid - v_money.refunded - v_money.refund_open > 0 then
      insert into public.order_refunds (tenant_id, store_id, order_id, payment_id, method, amount, status, reason, requested_by, requested_at)
      values (v_order.tenant_id, v_order.store_id, v_order.id, v_payment.id, coalesce(v_payment.method, 'cash'),
        v_money.paid - v_money.refunded - v_money.refund_open, 'due', 'order cancelled: ' || coalesce(p_reason_code, 'cancelled'), p_actor, p_at);
    end if;
    v_order := app.order_settle_payment_status(v_order.id, p_at);
    perform app.order_event(v_order, 'payment', 'refund_due', 'paid', v_order.payment_status::text, p_actor_kind, p_actor, p_reason_code, null,
      v_money.paid - v_money.refunded - v_money.refund_open, p_at);
  end if;
  if p_to = 'completed' then
    perform app.order_after_completion(v_order, p_at);
  end if;
  return v_order;
end;
$$;

comment on function app.order_move(public.orders, public.order_status, text, text, uuid, text, text, timestamptz) is 'the one writer of an order''s lifecycle: moves it, gives it its number when it is accepted, moves its version and change cursor, stamps the step''s time; a cancellation records who and why and, for a paid order, opens a due refund of what was paid (with its event and amount); a completion runs the completion hook (stamps, sales facts); callers check that the transition is in the lifecycle';

create or replace function app.order_payment_succeeded(p_order_id uuid, p_amount numeric, p_actor_kind text, p_actor uuid, p_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_method text;
begin
  if p_actor_kind is null or p_actor_kind not in ('staff', 'provider') then
    raise exception 'a payment is recorded by staff or confirmed by a provider' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order' using errcode = '22023';
  end if;
  if v_order.payment_status <> 'unpaid' then
    return jsonb_build_object('state', case when v_order.payment_status = 'paid' then 'paid' else 'refused' end,
      'refusal', case when v_order.payment_status <> 'paid' then 'not_payable' end, 'replayed', v_order.payment_status = 'paid',
      'order_id', v_order.id, 'status', v_order.status);
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('state', 'refused', 'refusal', 'order_cancelled', 'order_id', v_order.id, 'status', v_order.status);
  end if;
  if p_amount is null or p_amount <> v_order.total then
    return jsonb_build_object('state', 'refused', 'refusal', 'amount_differs', 'order_id', v_order.id, 'status', v_order.status);
  end if;
  select p.method into v_method from public.order_payments p
  where p.order_id = v_order.id and p.status = 'succeeded' and p.amount = p_amount
  order by p.settled_at desc, p.id limit 1;
  if v_method is null then
    raise exception 'no succeeded payment of the order backs this amount' using errcode = '22023';
  end if;
  update public.orders o
  set payment_status = 'paid', paid_at = p_at, version = o.version + 1, change_seq = nextval('app.order_change_seq')
  where o.id = v_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'payment', 'paid', 'unpaid', 'paid', p_actor_kind, p_actor, v_method, null, p_amount, p_at);
  if v_order.status = 'awaiting_payment' then
    v_order := app.order_move(v_order, 'accepted', 'payment_confirmed', p_actor_kind, p_actor, null, null, p_at);
  end if;
  return jsonb_build_object('state', 'paid', 'replayed', false, 'order_id', v_order.id, 'status', v_order.status, 'order_no', v_order.order_no);
end;
$$;

comment on function app.order_payment_succeeded(uuid, numeric, text, uuid, timestamptz) is 'the payment seam (ADR-061, ADR-062): marks an unpaid order paid when the amount equals its total and a succeeded payment record of that amount backs it (22023 otherwise: nothing is ever paid without a record), writes the payment event with the method and, for an order awaiting an online payment, accepts it with its number (T3); a paid order answers paid again (replayed), a cancelled one order_cancelled, another amount amount_differs; called only by counter_record_payment and checkout_payment_confirm, never by a client';

-- 4. The counter: record, void, refund ---------------------------------------------------------------------------

create function app.order_for_counter(p_order_id uuid, p_roles public.tenant_role[])
returns public.orders
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null or (select auth.uid()) is null or not app.has_store_scope(v_order.tenant_id, v_order.store_id, p_roles) then
    raise exception 'only a member of the order''s store with an allowed role acts on it' using errcode = '42501';
  end if;
  return v_order;
end;
$$;

comment on function app.order_for_counter(uuid, public.tenant_role[]) is 'locks an order for a counter action when the caller holds one of the roles with its store in scope; 42501 otherwise, the same for an unknown order';

create function app.counter_record_payment(p_order_id uuid, p_method text, p_amount numeric, p_expected_version integer, p_at timestamptz default now())
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
  insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, recorded_by, requested_at, settled_at)
  values (v_order.tenant_id, v_order.store_id, v_order.id, p_method, p_amount, 'succeeded', v_uid, p_at, p_at)
  returning * into v_payment;
  v_answer := app.order_payment_succeeded(v_order.id, p_amount, 'staff', v_uid, p_at);
  select o.* into v_order from public.orders o where o.id = v_order.id;
  return jsonb_build_object('state', 'paid', 'refusal', null, 'replayed', false, 'payment_id', v_payment.id, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_record_payment(uuid, text, numeric, integer, timestamptz) is '"Đã thu": staff record a cash or card payment of an order''s full total (ADR-061: a counter order is completed only after it), with the version they saw; an order paid the same way again is a replay, another payment already_paid, a cancelled order order_cancelled, another amount amount_differs, a moved order conflict; accepts an order still waiting for its online payment when the customer pays at the counter instead; owners, managers and staff of the store';

create function app.counter_void_payment(p_payment_id uuid, p_reason text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments;
  v_order public.orders;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_manager boolean;
begin
  select p.* into v_payment from public.order_payments p where p.id = p_payment_id;
  if v_payment.id is null then
    raise exception 'only a member of the payment''s store acts on it' using errcode = '42501';
  end if;
  v_order := app.order_for_counter(v_payment.order_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  select p.* into v_payment from public.order_payments p where p.id = p_payment_id for update;
  v_manager := app.has_store_scope(v_order.tenant_id, v_order.store_id, array['owner', 'manager']::public.tenant_role[]);
  if v_reason is null or char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'undoing a payment needs a reason of 1 to 200 characters on one line' using errcode = '22023';
  end if;
  if v_payment.status = 'voided' then
    return jsonb_build_object('state', 'voided', 'refusal', null, 'replayed', true, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_payment.status <> 'succeeded' or v_payment.method not in ('cash', 'card') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_voidable', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.status = 'completed' then
    return jsonb_build_object('state', 'refused', 'refusal', 'order_completed', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if exists (select 1 from public.order_refunds r where r.order_id = v_order.id and r.status <> 'failed') then
    return jsonb_build_object('state', 'refused', 'refusal', 'has_refunds', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if not v_manager and (v_payment.recorded_by is distinct from v_uid or p_at >= v_payment.settled_at + interval '10 minutes') then
    return jsonb_build_object('state', 'refused', 'refusal', 'manager_required', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  update public.order_payments p set status = 'voided', voided_by = v_uid, voided_at = p_at, void_reason = v_reason where p.id = v_payment.id;
  update public.orders o set paid_at = null where o.id = v_order.id;
  v_order := app.order_settle_payment_status(v_order.id, p_at);
  perform app.order_event(v_order, 'payment', 'payment_voided', 'paid', v_order.payment_status::text, 'staff', v_uid, v_payment.method, v_reason, v_payment.amount, p_at);
  return jsonb_build_object('state', 'voided', 'refusal', null, 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_void_payment(uuid, text, timestamptz) is 'undoes a cash or card payment recorded by mistake, with a reason: by the staff member who recorded it within 10 minutes (9:59 yes, 10:00 manager_required), by a manager or owner of the store later; never after completion (order_completed: refund instead) or once a refund exists (has_refunds); the order is unpaid again; logged with who, why and the amount';

create function app.counter_refund(p_order_id uuid, p_amount numeric, p_reason text, p_at timestamptz default now())
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
  if v_due.id is not null and p_amount = v_due.amount then
    update public.order_refunds r
    set status = case when v_payment.method in ('cash', 'card') or v_due.status = 'failed' then 'succeeded' else 'pending' end,
        method = case when v_due.status = 'failed' then 'cash' else r.method end,
        recorded_by = v_uid,
        settled_at = case when v_payment.method in ('cash', 'card') or v_due.status = 'failed' then p_at end,
        reason = left(r.reason || '; ' || v_reason, 200)
    where r.id = v_due.id
    returning r.* into v_refund;
  else
    insert into public.order_refunds (tenant_id, store_id, order_id, payment_id, method, amount, status, reason, requested_by, requested_at, recorded_by, settled_at)
    values (v_order.tenant_id, v_order.store_id, v_order.id, v_payment.id, v_payment.method, p_amount,
      case when v_payment.method in ('cash', 'card') then 'succeeded' else 'pending' end, v_reason, v_uid, p_at, v_uid,
      case when v_payment.method in ('cash', 'card') then p_at end)
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

comment on function app.counter_refund(uuid, numeric, text, timestamptz) is 'records a refund of an order with its reason: the due refund of a cancelled paid order, in full, by any staff member of the store; any other refund (a completed order, a partial amount, an online refund the provider failed, then handed back in cash) by a manager or owner (manager_required otherwise); at most what was paid less earlier refunds (amount_over_refundable). Cash and card are handed back at once (succeeded); an online payment''s refund is pending until the provider confirms (checkout_refund_confirm). Every refund is an order_refunds row and an event with who, when and how much; a succeeded one runs the refund hook (stamps back, invoice adjusted)';

-- 5. Online seams: service role only ------------------------------------------------------------------------------

create function app.checkout_payment_start(p_user_id uuid, p_order_id uuid, p_method text, p_idempotency_key text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_payment public.order_payments;
begin
  if p_user_id is null or p_order_id is null or p_method is null or p_method not in ('zalo_checkout', 'vietqr')
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'an online payment names the customer, the order, zalo_checkout or vietqr and an idempotency key of 8 to 100 URL-safe characters' using errcode = '22023';
  end if;
  select o.* into v_order
  from public.orders o
  join app.customer_logins l on l.id = o.customer_login_id
  where o.id = p_order_id and l.user_id = p_user_id
  for update of o;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order');
  end if;
  select p.* into v_payment from public.order_payments p where p.order_id = v_order.id and p.idempotency_key = p_idempotency_key;
  if v_payment.id is not null then
    return jsonb_build_object('state', v_payment.status, 'replayed', true, 'payment_id', v_payment.id, 'amount', v_payment.amount::bigint, 'order_id', v_order.id);
  end if;
  if v_order.status <> 'awaiting_payment' or v_order.payment_due_at <= p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_awaiting_payment', 'status', v_order.status);
  end if;
  if v_order.payment_method <> p_method then
    return jsonb_build_object('state', 'refused', 'refusal', 'method_differs');
  end if;
  if (select count(*) from public.order_payments p where p.order_id = v_order.id and p.status = 'failed') >= 3 then
    return jsonb_build_object('state', 'refused', 'refusal', 'too_many_attempts');
  end if;
  if exists (select 1 from public.order_payments p where p.order_id = v_order.id and p.status = 'pending') then
    return jsonb_build_object('state', 'refused', 'refusal', 'attempt_pending');
  end if;
  insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, provider, idempotency_key, requested_at)
  values (v_order.tenant_id, v_order.store_id, v_order.id, p_method, v_order.total, 'pending', p_method, p_idempotency_key, p_at)
  returning * into v_payment;
  perform app.order_event(v_order, 'payment', 'payment_started', 'unpaid', 'unpaid', 'customer', p_user_id, p_method, null, v_order.total, p_at);
  return jsonb_build_object('state', 'pending', 'replayed', false, 'payment_id', v_payment.id, 'amount', v_payment.amount::bigint,
    'order_id', v_order.id, 'store_id', v_order.store_id, 'payment_due_at', v_order.payment_due_at);
end;
$$;

comment on function app.checkout_payment_start(uuid, uuid, text, text, timestamptz) is 'the server-only start of an online payment (ADR-062), for the Edge Function that verified the customer''s session: a pending attempt of the full total for the customer''s own order still awaiting payment by the method it chose; the same idempotency key answers the same attempt; one pending attempt at a time and at most three failed; answers what the provider request needs, never a secret';

create function app.checkout_payment_confirm(p_provider text, p_provider_ref text, p_payment_id uuid, p_amount numeric, p_success boolean, p_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments;
  v_order public.orders;
  v_seam jsonb;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,30}$' or p_provider_ref is null or char_length(p_provider_ref) not between 1 and 100
     or p_provider_ref ~ '[[:cntrl:][:space:]]' or p_payment_id is null or p_success is null then
    raise exception 'a confirmation names the provider, its transaction id, the payment and the outcome' using errcode = '22023';
  end if;
  select p.* into v_payment from public.order_payments p where p.provider = p_provider and p.provider_ref = p_provider_ref;
  if v_payment.id is not null then
    return jsonb_build_object('state', v_payment.status, 'replayed', true, 'payment_id', v_payment.id);
  end if;
  select p.* into v_payment from public.order_payments p where p.id = p_payment_id for update;
  if v_payment.id is null or v_payment.provider is distinct from p_provider then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_payment', 'replayed', false);
  end if;
  if v_payment.status <> 'pending' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_pending', 'replayed', false, 'payment_id', v_payment.id);
  end if;
  select o.* into v_order from public.orders o where o.id = v_payment.order_id for update;
  if not p_success then
    update public.order_payments p set status = 'failed', provider_ref = p_provider_ref, settled_at = p_at,
      failure_reason = left(coalesce(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), ''), 'failed'), 200)
    where p.id = v_payment.id;
    perform app.order_event(v_order, 'payment', 'payment_failed', 'unpaid', 'unpaid', 'provider', null, v_payment.method, null, v_payment.amount, p_at);
    return jsonb_build_object('state', 'failed', 'replayed', false, 'payment_id', v_payment.id);
  end if;
  if p_amount is null or p_amount <> v_payment.amount then
    update public.order_payments p set status = 'failed', provider_ref = p_provider_ref, settled_at = p_at, failure_reason = 'amount_differs'
    where p.id = v_payment.id;
    perform app.order_event(v_order, 'payment', 'payment_failed', 'unpaid', 'unpaid', 'provider', null, 'amount_differs', null, p_amount, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', 'amount_differs', 'replayed', false, 'payment_id', v_payment.id);
  end if;
  update public.order_payments p set status = 'succeeded', provider_ref = p_provider_ref, settled_at = p_at where p.id = v_payment.id;
  if v_order.status = 'cancelled' or v_order.payment_status <> 'unpaid' then
    insert into public.order_refunds (tenant_id, store_id, order_id, payment_id, method, amount, status, reason, requested_at)
    values (v_order.tenant_id, v_order.store_id, v_order.id, v_payment.id, v_payment.method, v_payment.amount, 'due',
      case when v_order.status = 'cancelled' then 'paid after the order was cancelled' else 'paid twice' end, p_at);
    v_order := app.order_settle_payment_status(v_order.id, p_at);
    perform app.order_event(v_order, 'payment', 'paid_to_refund', null, v_order.payment_status::text, 'provider', null, v_payment.method, null, v_payment.amount, p_at);
    return jsonb_build_object('state', 'succeeded', 'replayed', false, 'payment_id', v_payment.id, 'refund_due', true);
  end if;
  v_seam := app.order_payment_succeeded(v_order.id, v_payment.amount, 'provider', null, p_at);
  return jsonb_build_object('state', 'succeeded', 'replayed', false, 'payment_id', v_payment.id, 'refund_due', false,
    'order_status', v_seam ->> 'status', 'order_no', v_seam -> 'order_no');
end;
$$;

comment on function app.checkout_payment_confirm(text, text, uuid, numeric, boolean, text, timestamptz) is 'the server-only confirmation of an online payment, called by a webhook after it verified the provider''s signature (or by the re-query job): unique on the provider''s transaction id (a repeat answers its first outcome); only a pending attempt of that provider moves; a failure or another amount fails it; a success marks the order paid and accepts it (T3); money arriving for a cancelled or already paid order is kept as a due refund; never callable by a client';

create function app.checkout_payments_pending(p_older_than interval default interval '20 minutes', p_limit integer default 50, p_at timestamptz default now())
returns table (payment_id uuid, provider text, order_id uuid, amount numeric, requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.provider, p.order_id, p.amount, p.requested_at
  from public.order_payments p
  where p.status = 'pending' and p.requested_at <= p_at - p_older_than
  order by p.requested_at, p.id
  limit greatest(least(coalesce(p_limit, 50), 500), 1);
$$;

comment on function app.checkout_payments_pending(interval, integer, timestamptz) is 'the online attempts still without a result after p_older_than, oldest first, for the job that asks the provider again (a lost notification never leaves an order hanging)';

create function app.checkout_refund_confirm(p_refund_id uuid, p_success boolean, p_provider_ref text, p_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund public.order_refunds;
  v_order public.orders;
begin
  if p_refund_id is null or p_success is null or (p_provider_ref is not null and (char_length(p_provider_ref) not between 1 and 100 or p_provider_ref ~ '[[:cntrl:][:space:]]')) then
    raise exception 'a refund confirmation names the refund, the outcome and the provider''s reference' using errcode = '22023';
  end if;
  select r.* into v_refund from public.order_refunds r where r.id = p_refund_id for update;
  if v_refund.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_refund');
  end if;
  if v_refund.status in ('succeeded', 'failed') then
    return jsonb_build_object('state', v_refund.status, 'replayed', true);
  end if;
  if v_refund.method not in ('zalo_checkout', 'vietqr') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_online');
  end if;
  update public.order_refunds r set status = case when p_success then 'succeeded' else 'failed' end, provider_ref = p_provider_ref, settled_at = p_at
  where r.id = v_refund.id returning r.* into v_refund;
  v_order := app.order_settle_payment_status(v_refund.order_id, p_at);
  perform app.order_event(v_order, 'payment', case when p_success then 'refunded' else 'refund_failed' end, null, v_order.payment_status::text,
    'provider', null, v_refund.method, case when not p_success then left(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), ''), 200) end,
    v_refund.amount, p_at);
  if p_success then
    perform app.order_after_refund(v_order, p_at);
  end if;
  return jsonb_build_object('state', v_refund.status, 'replayed', false, 'order_payment_status', v_order.payment_status);
end;
$$;

comment on function app.checkout_refund_confirm(uuid, boolean, text, text, timestamptz) is 'the server-only settlement of an online refund by the provider''s answer: succeeded or failed (a failed refund stays visible to the manager), the order''s payment status settled and the event logged; a settled refund is a replay';

-- 6. Money in the answers -------------------------------------------------------------------------------------------

create function app.order_money_json(p_order_id uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paid', m.paid::bigint, 'refunded', m.refunded::bigint, 'refund_open', m.refund_open::bigint,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount::bigint, 'status', p.status,
        'settled_at', p.settled_at, 'recorded_by', case when p_for = 'counter' then p.recorded_by end) order by p.requested_at, p.id)
      from public.order_payments p where p.order_id = p_order_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'method', r.method, 'amount', r.amount::bigint, 'status', r.status,
        'reason', case when p_for = 'counter' then r.reason end, 'requested_at', r.requested_at, 'settled_at', r.settled_at,
        'recorded_by', case when p_for = 'counter' then r.recorded_by end) order by r.requested_at, r.id)
      from public.order_refunds r where r.order_id = p_order_id), '[]'::jsonb)
  )
  from app.order_money(p_order_id) m;
$$;

comment on function app.order_money_json(uuid, text) is 'an order''s payments and refunds as the answers show them: the amounts, methods, states and times, with who recorded them and the reason for the counter only';

create or replace function app.counter_order(p_order_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_order.tenant_id, v_order.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only staff of the order''s store read it' using errcode = '42501';
  end if;
  return app.order_json(v_order, 'counter', p_at) || jsonb_build_object('timeline', app.order_timeline(v_order.id, 'counter'), 'money', app.order_money_json(v_order.id, 'counter'));
end;
$$;

create or replace function app.customer_order(p_order_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_order public.orders;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id and o.customer_login_id = v_login.id;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order', 'order', null);
  end if;
  return jsonb_build_object('state', 'ok', 'refusal', null,
    'order', app.order_json(v_order, 'customer', p_at) || jsonb_build_object('timeline', app.order_timeline(v_order.id, 'customer'), 'money', app.order_money_json(v_order.id, 'customer')));
end;
$$;

-- 7. Public wrappers and grants ----------------------------------------------------------------------------------

create function public.counter_record_payment(p_order uuid, p_method text, p_amount numeric, p_expected_version integer)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_record_payment(p_order, p_method, p_amount, p_expected_version, now()); $$;
comment on function public.counter_record_payment(uuid, text, numeric, integer) is 'RPC for the counter web app: app.counter_record_payment at the current time';

create function public.counter_void_payment(p_payment uuid, p_reason text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_void_payment(p_payment, p_reason, now()); $$;
comment on function public.counter_void_payment(uuid, text) is 'RPC for the counter web app: app.counter_void_payment at the current time';

create function public.counter_refund(p_order uuid, p_amount numeric, p_reason text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_refund(p_order, p_amount, p_reason, now()); $$;
comment on function public.counter_refund(uuid, numeric, text) is 'RPC for the counter web app: app.counter_refund at the current time';

create function public.checkout_payment_start(p_user uuid, p_order uuid, p_method text, p_idempotency_key text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_payment_start(p_user, p_order, p_method, p_idempotency_key, now()); $$;
comment on function public.checkout_payment_start(uuid, uuid, text, text) is 'RPC for the payment Edge Functions only (service_role): app.checkout_payment_start at the current time';

create function public.checkout_payment_confirm(p_provider text, p_provider_ref text, p_payment uuid, p_amount numeric, p_success boolean, p_reason text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_payment_confirm(p_provider, p_provider_ref, p_payment, p_amount, p_success, p_reason, now()); $$;
comment on function public.checkout_payment_confirm(text, text, uuid, numeric, boolean, text) is 'RPC for the payment webhooks and the re-query job only (service_role): app.checkout_payment_confirm at the current time';

create function public.checkout_payments_pending(p_older_than_minutes integer default 20, p_limit integer default 50)
returns table (payment_id uuid, provider text, order_id uuid, amount numeric, requested_at timestamptz)
language sql stable security definer set search_path = ''
as $$ select * from app.checkout_payments_pending(make_interval(mins => greatest(coalesce(p_older_than_minutes, 20), 1)), p_limit, now()); $$;
comment on function public.checkout_payments_pending(integer, integer) is 'RPC for the re-query job only (service_role): app.checkout_payments_pending';

create function public.checkout_refund_confirm(p_refund uuid, p_success boolean, p_provider_ref text, p_reason text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_refund_confirm(p_refund, p_success, p_provider_ref, p_reason, now()); $$;
comment on function public.checkout_refund_confirm(uuid, boolean, text, text) is 'RPC for the refund job only (service_role): app.checkout_refund_confirm at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('order_money', 'order_settle_payment_status', 'order_after_completion', 'order_after_refund', 'order_move',
        'order_payment_succeeded', 'order_for_counter', 'counter_record_payment', 'counter_void_payment', 'counter_refund',
        'checkout_payment_start', 'checkout_payment_confirm', 'checkout_payments_pending', 'checkout_refund_confirm', 'order_money_json',
        'counter_order', 'customer_order')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.counter_record_payment(uuid, text, numeric, integer), public.counter_void_payment(uuid, text),
  public.counter_refund(uuid, numeric, text) from public, anon, service_role;
grant execute on function public.counter_record_payment(uuid, text, numeric, integer), public.counter_void_payment(uuid, text),
  public.counter_refund(uuid, numeric, text) to authenticated;
revoke all on function public.checkout_payment_start(uuid, uuid, text, text), public.checkout_payment_confirm(text, text, uuid, numeric, boolean, text),
  public.checkout_payments_pending(integer, integer), public.checkout_refund_confirm(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.checkout_payment_start(uuid, uuid, text, text), public.checkout_payment_confirm(text, text, uuid, numeric, boolean, text),
  public.checkout_payments_pending(integer, integer), public.checkout_refund_confirm(uuid, boolean, text, text) to service_role;
