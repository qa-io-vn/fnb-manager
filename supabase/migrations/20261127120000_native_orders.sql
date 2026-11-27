-- The native till, step 3 (ADR-061, native-till.md section 5): orders, their lines and append-only events, the fixed
-- lifecycle with a separate payment status, idempotent placement priced only in SQL, order numbers per store and
-- business day, the counter's queue and actions, the customer's order reads and cancellation, prank blocks, the
-- server-only payment seam and the minute job (created off).

-- 1. Types, tables and sequences ---------------------------------------------------------------------------------

create type public.order_status as enum ('awaiting_payment', 'accepted', 'preparing', 'ready', 'serving', 'completed', 'cancelled');
create type public.order_payment_status as enum ('unpaid', 'paid', 'refund_pending', 'refunded', 'partially_refunded');

comment on type public.order_status is 'the fixed lifecycle of a native order (ADR-061): awaiting_payment -> accepted -> preparing -> ready (takeaway) or serving (table) -> completed; cancelled only from awaiting_payment or accepted';
comment on type public.order_payment_status is 'the money of an order, moved apart from its lifecycle: paid only by the counter''s record or a verified online confirmation';

create sequence app.order_change_seq;
comment on sequence app.order_change_seq is 'the change cursor of the counter board: every order change takes the next value';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  store_id uuid not null,
  source text not null check (source in ('app', 'counter')),
  customer_login_id uuid references app.customer_logins (id) on delete set null,
  order_type text not null check (order_type in ('table', 'takeaway')),
  table_id uuid,
  table_label text check (table_label is null or char_length(table_label) between 1 and 20),
  pickup_at timestamptz,
  business_date date not null,
  order_no integer check (order_no between 1 and 100000),
  status public.order_status not null,
  payment_status public.order_payment_status not null default 'unpaid',
  payment_method text not null check (payment_method in ('counter', 'zalo_checkout', 'vietqr')),
  version integer not null default 1 check (version >= 1),
  change_seq bigint not null default nextval('app.order_change_seq'),
  subtotal numeric(14, 2) not null check (app.native_price_valid(subtotal, 0, 100000000)),
  discount_amount numeric(14, 2) not null default 0 check (app.native_price_valid(discount_amount, 0, 100000000)),
  total numeric(14, 2) not null check (app.native_price_valid(total, 0, 100000000)),
  note text check (note is null or (char_length(note) between 1 and 200 and note !~ '[[:cntrl:]]')),
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  menu_version bigint not null default 0,
  placed_at timestamptz not null,
  payment_due_at timestamptz,
  accepted_at timestamptz,
  preparing_at timestamptz,
  done_at timestamptz,
  completed_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_actor text check (cancel_actor in ('customer', 'staff', 'system')),
  cancel_reason text,
  cancel_note text check (cancel_note is null or (char_length(cancel_note) between 1 and 200 and cancel_note !~ '[[:cntrl:]]')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, table_id) references public.store_tables (tenant_id, id) on delete set null (table_id),
  constraint orders_totals_check check (total = subtotal - discount_amount),
  constraint orders_table_check check (order_type <> 'table' or table_label is not null),
  constraint orders_number_check check (
    (status = 'awaiting_payment' and order_no is null)
    or (status = 'cancelled')
    or (status not in ('awaiting_payment', 'cancelled') and order_no is not null)
  ),
  constraint orders_cancel_check check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null and cancel_actor is not null)),
  constraint orders_completed_paid_check check (status <> 'completed' or payment_status in ('paid', 'refund_pending', 'refunded', 'partially_refunded'))
);

create unique index orders_number_key on public.orders (store_id, business_date, order_no) where order_no is not null;
create unique index orders_customer_request_key on public.orders (customer_login_id, request_id) where customer_login_id is not null and source = 'app';
create unique index orders_counter_request_key on public.orders (created_by, request_id) where source = 'counter';
create index orders_board_idx on public.orders (store_id, change_seq);
create index orders_open_idx on public.orders (store_id, status) where status not in ('completed', 'cancelled');
create index orders_customer_idx on public.orders (customer_login_id, placed_at desc) where customer_login_id is not null;
create index orders_payment_due_idx on public.orders (payment_due_at) where status = 'awaiting_payment';
create index orders_table_idx on public.orders (table_id) where table_id is not null;
create index orders_tenant_idx on public.orders (tenant_id);

comment on table public.orders is 'a native order (ADR-061): its store, brand, type and table, the customer login or the staff member who keyed it, the fixed lifecycle (status) and the money (payment_status) apart, the totals computed in SQL, the idempotency key and hash, the number of the store''s business day, and the times and actors of every step; written only by security definer functions';
comment on column public.orders.order_no is 'the number of the order in its store and business day, given when it is accepted (never to an unpaid online attempt), counted without gaps under a row lock';
comment on column public.orders.version is 'moves by one at every change; a counter action names the version it saw';
comment on column public.orders.change_seq is 'the next value of app.order_change_seq at every change, the counter board''s cursor';

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  line_no smallint not null check (line_no between 1 and 30),
  item_id uuid references public.menu_items (id) on delete set null,
  size_id uuid references public.menu_item_sizes (id) on delete set null,
  item_name text not null,
  size_label text,
  quantity integer not null check (quantity between 1 and 20),
  unit_price numeric(14, 2) not null check (app.native_price_valid(unit_price, 1, 100000000)),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  options_amount numeric(14, 2) not null default 0 check (app.native_price_valid(options_amount, 0, 10000000)),
  line_total numeric(14, 2) not null,
  counts_for_stamps boolean not null,
  note text check (note is null or (char_length(note) between 1 and 100 and note !~ '[[:cntrl:]]')),
  unique (order_id, line_no),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  constraint order_lines_line_total_check check (line_total = quantity * (unit_price + options_amount))
);

create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_tenant_idx on public.order_lines (tenant_id);

comment on table public.order_lines is 'the lines of an order with the names and prices they were sold at (the size price as unit_price, the options as [{group_id, group, option_id, name, price}]); a later menu change never alters them';

create table public.order_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('status', 'payment')),
  action text not null check (action ~ '^[a-z_]{1,40}$'),
  from_state text,
  to_state text,
  actor_kind text not null check (actor_kind in ('customer', 'staff', 'system', 'provider')),
  actor_user_id uuid,
  reason_code text check (reason_code is null or reason_code ~ '^[a-z_]{1,40}$'),
  reason_text text check (reason_text is null or (char_length(reason_text) between 1 and 200 and reason_text !~ '[[:cntrl:]]')),
  amount numeric(14, 2),
  occurred_at timestamptz not null,
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade
);

create index order_events_order_idx on public.order_events (order_id, id);
create index order_events_tenant_idx on public.order_events (tenant_id);

comment on table public.order_events is 'the append-only log of every order: each lifecycle and payment step with its actor (customer, staff with the user, system, provider), reason and amount; every cancellation and refund is here with who, when and how much; no role changes or deletes a row';

create table app.order_counters (
  store_id uuid not null references public.stores (id) on delete cascade,
  business_date date not null,
  last_no integer not null check (last_no >= 1),
  primary key (store_id, business_date)
);

comment on table app.order_counters is 'the last order number of each store and business day, taken under its row lock; no API role reads it';
alter table app.order_counters enable row level security;
revoke all on table app.order_counters from public, anon, authenticated, service_role;

create table public.customer_order_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  blocked_until timestamptz not null,
  reason text not null check (reason in ('suspected_prank')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index customer_order_blocks_login_idx on public.customer_order_blocks (customer_login_id, blocked_until desc);
create index customer_order_blocks_tenant_idx on public.customer_order_blocks (tenant_id);

comment on table public.customer_order_blocks is 'a customer login barred from ordering at the tenant until blocked_until, made by three suspected_prank cancellations within 7 days; owners and managers of the store lift it by deleting the row';

-- 2. Guards ---------------------------------------------------------------------------------------------------------

create function app.keep_order_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.tenants t where t.id = old.tenant_id)
    or not exists (select 1 from public.orders o where o.id = old.order_id)
  ) then
    return old;
  end if;
  raise exception 'order_events is an append-only log' using errcode = '42501';
end;
$$;

create function app.refuse_order_events_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_events is an append-only log and is never truncated' using errcode = '42501';
end;
$$;

comment on function app.keep_order_events() is 'trigger refusing every update and delete of the order events for every role; only the deletion of the order''s tenant (or the order, which no function does) removes rows';

create trigger order_events_append_only before update or delete on public.order_events for each row execute function app.keep_order_events();
create trigger order_events_no_truncate before truncate on public.order_events for each statement execute function app.refuse_order_events_truncate();
create trigger orders_set_updated_at before update on public.orders for each row execute function app.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_events enable row level security;
alter table public.customer_order_blocks enable row level security;

create policy orders_select on public.orders
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy order_lines_select on public.order_lines
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy order_events_select on public.order_events
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy customer_order_blocks_select on public.customer_order_blocks
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy customer_order_blocks_delete on public.customer_order_blocks
  for delete to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.orders, public.order_lines, public.order_events, public.customer_order_blocks from anon, authenticated;
grant select on public.orders, public.order_lines, public.order_events to authenticated;
grant select, delete on public.customer_order_blocks to authenticated;

-- 3. Limits ---------------------------------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values ('customer_place_order', 'calls', 20, 200, interval '15 minutes', interval '15 minutes');

-- 4. Helpers: shape, pricing, numbers, JSON ------------------------------------------------------------------------

create function app.order_text_ok(p_value jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null or jsonb_typeof(p_value) = 'null' or (
    jsonb_typeof(p_value) = 'string'
    and char_length(btrim(p_value #>> '{}')) <= p_max
    and (p_value #>> '{}') !~ '[[:cntrl:]]'
    and (p_value #>> '{}') !~ '[‎‏‪-‮⁦-⁩]'
  );
$$;

comment on function app.order_text_ok(jsonb, integer) is 'whether a note of an order request is absent, null, or a string of at most p_max characters once trimmed, without a control character or a bidirectional override';

create function app.order_note(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'string' then nullif(btrim(p_value #>> '{}'), '') end;
$$;

comment on function app.order_note(jsonb) is 'a note of an order request trimmed, null when absent or empty';

create function app.order_lines_valid(p_lines jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_lines) = 'array'
    and jsonb_array_length(p_lines) between 1 and 30
    and not exists (
      select 1
      from jsonb_array_elements(p_lines) as l (line)
      where jsonb_typeof(l.line) <> 'object'
        or exists (select 1 from jsonb_object_keys(l.line) as k where k not in ('size', 'qty', 'options', 'note'))
        or jsonb_typeof(l.line -> 'size') is distinct from 'string'
        or (l.line ->> 'size') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(l.line -> 'qty') is distinct from 'number'
        or (l.line ->> 'qty')::numeric <> trunc((l.line ->> 'qty')::numeric)
        or (l.line ->> 'qty')::numeric not between 1 and 20
        or (l.line ? 'options' and jsonb_typeof(l.line -> 'options') not in ('array', 'null'))
        or (jsonb_typeof(l.line -> 'options') = 'array' and (
          jsonb_array_length(l.line -> 'options') > 10
          or exists (
            select 1 from jsonb_array_elements(l.line -> 'options') as o (opt)
            where jsonb_typeof(o.opt) <> 'string' or (o.opt #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
          or jsonb_array_length(l.line -> 'options') <> (select count(distinct lower(o.opt #>> '{}')) from jsonb_array_elements(l.line -> 'options') as o (opt))
        ))
        or not app.order_text_ok(l.line -> 'note', 100)
    ),
    false
  );
$$;

comment on function app.order_lines_valid(jsonb) is 'the shape of an order''s lines: 1 to 30 objects with only size (a UUID), qty (a whole number 1 to 20), options (at most 10 option UUIDs, none twice) and note (at most 100 characters, no control character)';

create function app.order_price_lines(p_store_id uuid, p_brand_id uuid, p_order_type text, p_lines jsonb, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_no integer := 0;
  v_row record;
  v_unavailable uuid[] := '{}'::uuid[];
  v_bad_lines integer[] := '{}'::integer[];
  v_out jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_options jsonb;
  v_options_amount numeric;
  v_qty integer;
begin
  for v_line in select l.line from jsonb_array_elements(p_lines) with ordinality as l (line, n) order by l.n loop
    v_no := v_no + 1;
    select r.* into v_row
    from app.menu_rows(p_store_id, p_brand_id, p_at) r
    where r.size_id = (v_line ->> 'size')::uuid;
    if v_row.size_id is null or not v_row.available or not (p_order_type = any (v_row.order_types)) then
      v_unavailable := v_unavailable || coalesce(v_row.item_id, (v_line ->> 'size')::uuid);
      continue;
    end if;
    with chosen as (
      select o.id as option_id, o.name, o.price_delta, o.sort_order, g.id as group_id, g.name as group_name, g.sort_order as group_sort
      from jsonb_array_elements_text(coalesce(nullif(v_line -> 'options', 'null'::jsonb), '[]'::jsonb)) as x (id)
      left join public.menu_options o on o.id = x.id::uuid and o.active and o.brand_id = p_brand_id
      left join public.menu_option_groups g on g.id = o.group_id
      left join public.menu_item_option_groups l on l.group_id = g.id and l.item_id = v_row.item_id
      where true
    )
    select
      case
        when exists (select 1 from chosen c where c.option_id is null)
          or exists (
            select 1 from jsonb_array_elements_text(coalesce(nullif(v_line -> 'options', 'null'::jsonb), '[]'::jsonb)) as x (id)
            where not exists (
              select 1 from public.menu_options o
              join public.menu_item_option_groups l on l.group_id = o.group_id and l.item_id = v_row.item_id
              where o.id = x.id::uuid and o.active
            )
          )
          or exists (
            select 1 from public.menu_item_option_groups l
            join public.menu_option_groups g on g.id = l.group_id
            where l.item_id = v_row.item_id
              and (select count(*) from chosen c where c.group_id = g.id) not between g.min_select and g.max_select
          )
        then null
        else coalesce((
          select jsonb_agg(jsonb_build_object('group_id', c.group_id, 'group', c.group_name, 'option_id', c.option_id, 'name', c.name, 'price', c.price_delta::bigint)
            order by c.group_sort, c.group_name, c.sort_order, c.name, c.option_id)
          from chosen c
        ), '[]'::jsonb)
      end,
      coalesce((select sum(c.price_delta) from chosen c), 0)
    into v_options, v_options_amount;
    if v_options is null then
      v_bad_lines := v_bad_lines || v_no;
      continue;
    end if;
    v_qty := (v_line ->> 'qty')::integer;
    v_subtotal := v_subtotal + v_qty * (v_row.price + v_options_amount);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_no,
      'item_id', v_row.item_id,
      'size_id', v_row.size_id,
      'item_name', v_row.item_name,
      'size_label', v_row.size_label,
      'quantity', v_qty,
      'unit_price', v_row.price::bigint,
      'options', v_options,
      'options_amount', v_options_amount::bigint,
      'line_total', (v_qty * (v_row.price + v_options_amount))::bigint,
      'counts_for_stamps', v_row.counts_for_stamps,
      'note', app.order_note(v_line -> 'note')
    ));
  end loop;
  if cardinality(v_unavailable) > 0 then
    return jsonb_build_object('ok', false, 'refusal', 'item_unavailable', 'unavailable_items', to_jsonb(v_unavailable));
  end if;
  if cardinality(v_bad_lines) > 0 then
    return jsonb_build_object('ok', false, 'refusal', 'option_invalid', 'lines', to_jsonb(v_bad_lines));
  end if;
  return jsonb_build_object('ok', true, 'lines', v_out, 'subtotal', v_subtotal::bigint);
end;
$$;

comment on function app.order_price_lines(uuid, uuid, text, jsonb, timestamptz) is 'prices the lines of an order from the menu as it is at the store now (app.menu_rows): each size available and offered for the type, each option active in a group the item offers, every group''s count within its limits; answers the priced lines (the size price, the options with their amounts, the line total) and the subtotal, or item_unavailable with the items, or option_invalid with the line numbers. The only place an order is priced; no price is ever taken from a client';

create function app.next_order_no(p_store_id uuid, p_business_date date)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.order_counters as c (store_id, business_date, last_no)
  values (p_store_id, p_business_date, 1)
  on conflict (store_id, business_date) do update set last_no = c.last_no + 1
  returning c.last_no;
$$;

comment on function app.next_order_no(uuid, date) is 'the next order number of a store''s business day, taken under the counter row''s lock, so numbers have no gap among accepted orders and restart each business day';

create function app.order_display_no(p_order_no integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_order_no is not null then '#' || case when p_order_no < 1000 then lpad(p_order_no::text, 3, '0') else p_order_no::text end end;
$$;

comment on function app.order_display_no(integer) is 'an order number as staff call it out: # and three digits, more from 1,000';

create function app.order_lines_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no', l.line_no, 'item_id', l.item_id, 'size_id', l.size_id, 'item_name', l.item_name, 'size_label', l.size_label,
    'quantity', l.quantity, 'unit_price', l.unit_price::bigint, 'options', l.options, 'options_amount', l.options_amount::bigint,
    'line_total', l.line_total::bigint, 'counts_for_stamps', l.counts_for_stamps, 'note', l.note
  ) order by l.line_no), '[]'::jsonb)
  from public.order_lines l
  where l.order_id = p_order_id;
$$;

create function app.order_json(p_order public.orders, p_for text, p_at timestamptz)
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
    'late', p_for = 'counter' and p_order.status in ('accepted', 'preparing') and p_order.accepted_at <= p_at - make_interval(mins => coalesce(
      (select s.late_order_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10)),
    'lines', app.order_lines_json(p_order.id)
  );
$$;

comment on function app.order_lines_json(uuid) is 'the lines of an order as the answers show them';
comment on function app.order_json(public.orders, text, timestamptz) is 'an order as an answer shows it: for the counter (p_for counter) with the table id and the late flag (accepted or preparing for longer than the store''s late_order_minutes since acceptance), for the customer without staff identities';

create function app.order_timeline(p_order_id uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', e.kind, 'action', e.action, 'from', e.from_state, 'to', e.to_state, 'actor', e.actor_kind,
    'actor_user_id', case when p_for = 'counter' then e.actor_user_id end,
    'reason_code', e.reason_code, 'reason_text', case when p_for = 'counter' then e.reason_text end,
    'amount', e.amount::bigint, 'at', e.occurred_at
  ) order by e.id), '[]'::jsonb)
  from public.order_events e
  where e.order_id = p_order_id;
$$;

comment on function app.order_timeline(uuid, text) is 'the events of an order in order, with the staff member and the free text for the counter only';

create function app.order_event(p_order public.orders, p_kind text, p_action text, p_from text, p_to text, p_actor_kind text, p_actor uuid,
  p_reason_code text, p_reason_text text, p_amount numeric, p_at timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.order_events (tenant_id, store_id, order_id, kind, action, from_state, to_state, actor_kind, actor_user_id, reason_code, reason_text, amount, occurred_at)
  values (p_order.tenant_id, p_order.store_id, p_order.id, p_kind, p_action, p_from, p_to, p_actor_kind, p_actor, p_reason_code, p_reason_text, p_amount, p_at);
$$;

comment on function app.order_event(public.orders, text, text, text, text, text, uuid, text, text, numeric, timestamptz) is 'appends one event to an order''s log';

create function app.order_open_statuses()
returns public.order_status[]
language sql
immutable
set search_path = ''
as $$
  select array['awaiting_payment', 'accepted', 'preparing', 'ready', 'serving']::public.order_status[];
$$;

create or replace function app.ordering_waiting_orders(p_store_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.orders o where o.store_id = p_store_id and o.status = 'accepted';
$$;

create or replace function app.table_open_orders(p_table_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.orders o where o.table_id = p_table_id and o.status in ('accepted', 'preparing', 'ready', 'serving');
$$;

comment on function app.ordering_waiting_orders(uuid) is 'the accepted orders of a store not yet started, for the busy reason of app.ordering_state';
comment on function app.table_open_orders(uuid) is 'the accepted, preparing, ready or serving orders of a table, for the table map';

-- 5. Transitions --------------------------------------------------------------------------------------------------

create function app.order_move(p_order public.orders, p_to public.order_status, p_action text, p_actor_kind text, p_actor uuid,
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
      cancel_note = case when p_to = 'cancelled' then p_reason_text end,
      payment_status = case when p_to = 'cancelled' and o.payment_status = 'paid' then 'refund_pending'::public.order_payment_status else o.payment_status end
  where o.id = p_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'status', p_action, p_order.status::text, p_to::text, p_actor_kind, p_actor, p_reason_code, p_reason_text,
    case when p_to = 'cancelled' and p_order.payment_status = 'paid' then p_order.total end, p_at);
  if p_to = 'cancelled' and p_order.payment_status = 'paid' then
    perform app.order_event(v_order, 'payment', 'refund_due', 'paid', 'refund_pending', p_actor_kind, p_actor, p_reason_code, null, p_order.total, p_at);
  end if;
  return v_order;
end;
$$;

comment on function app.order_move(public.orders, public.order_status, text, text, uuid, text, text, timestamptz) is 'the one writer of an order''s lifecycle: moves it, gives it its number when it is accepted, moves its version and change cursor, stamps the step''s time and, for a cancellation, who, why and the refund now due on a paid order; writes the event (and the refund-due event with the amount); callers check that the transition is in the lifecycle';

create function app.order_payment_succeeded(p_order_id uuid, p_amount numeric, p_actor_kind text, p_actor uuid, p_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
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
  update public.orders o
  set payment_status = 'paid', paid_at = p_at, version = o.version + 1, change_seq = nextval('app.order_change_seq')
  where o.id = v_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'payment', 'paid', 'unpaid', 'paid', p_actor_kind, p_actor, null, null, p_amount, p_at);
  if v_order.status = 'awaiting_payment' then
    v_order := app.order_move(v_order, 'accepted', 'payment_confirmed', p_actor_kind, p_actor, null, null, p_at);
  end if;
  return jsonb_build_object('state', 'paid', 'replayed', false, 'order_id', v_order.id, 'status', v_order.status, 'order_no', v_order.order_no);
end;
$$;

comment on function app.order_payment_succeeded(uuid, numeric, text, uuid, timestamptz) is 'the payment seam (ADR-061, ADR-062): marks an unpaid order paid when the amount equals its total, writes the payment event and, for an order awaiting an online payment, accepts it with its number (T3); a paid order answers paid again (replayed), a cancelled one order_cancelled, another amount amount_differs; called only by the counter''s payment record and the server''s verified provider confirmation (step 4), never by a client';

create function app.order_cancel_reasons()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['customer_request', 'item_unavailable', 'store_busy', 'closing_soon', 'payment_not_received', 'suspected_prank', 'other']::text[];
$$;

comment on function app.order_cancel_reasons() is 'the reason codes of a staff cancellation; other needs a text';

create function app.order_block_if_pranks(p_order public.orders, p_at timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_order.customer_login_id is null
     or (select count(*) from public.orders o
         where o.tenant_id = p_order.tenant_id and o.customer_login_id = p_order.customer_login_id
           and o.cancel_reason = 'suspected_prank' and o.cancelled_at > p_at - interval '7 days') < 3
     or exists (select 1 from public.customer_order_blocks b where b.customer_login_id = p_order.customer_login_id and b.blocked_until > p_at)
  then
    return false;
  end if;
  insert into public.customer_order_blocks (tenant_id, store_id, customer_login_id, blocked_until, reason, created_at)
  values (p_order.tenant_id, p_order.store_id, p_order.customer_login_id, p_at + interval '7 days', 'suspected_prank', p_at);
  return true;
end;
$$;

comment on function app.order_block_if_pranks(public.orders, timestamptz) is 'blocks a customer login from ordering at the tenant for 7 days once three of its orders were cancelled as suspected_prank within 7 days';

-- 6. Placement -----------------------------------------------------------------------------------------------------

create function app.order_request_shape(p_request jsonb, p_counter boolean)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed text[] := case when p_counter
    then array['request_id', 'type', 'table_id', 'lines', 'note', 'expected_total']
    else array['request_id', 'store', 'type', 'table_token', 'pickup_at', 'lines', 'note', 'payment', 'expected_total', 'menu_version'] end;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'an order request is a JSON object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_request) as k where k <> all (v_allowed)) then
    raise exception 'an order request holds only %', array_to_string(v_allowed, ', ') using errcode = '22023';
  end if;
  if jsonb_typeof(p_request -> 'request_id') is distinct from 'string'
     or (p_request ->> 'request_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'request_id is a UUID' using errcode = '22023';
  end if;
  if (p_request ->> 'type') is null or (p_request ->> 'type') not in ('table', 'takeaway') then
    raise exception 'type is table or takeaway' using errcode = '22023';
  end if;
  if not app.order_lines_valid(p_request -> 'lines') then
    raise exception 'lines are 1 to 30 lines of size, qty 1 to 20, at most 10 distinct options and a note of at most 100 characters' using errcode = '22023';
  end if;
  if not app.order_text_ok(p_request -> 'note', 200) then
    raise exception 'an order note has at most 200 characters without a control character' using errcode = '22023';
  end if;
  if p_request ? 'expected_total' and jsonb_typeof(p_request -> 'expected_total') <> 'null' and (
       jsonb_typeof(p_request -> 'expected_total') <> 'number'
       or (p_request ->> 'expected_total')::numeric <> trunc((p_request ->> 'expected_total')::numeric)
       or (p_request ->> 'expected_total')::numeric not between 0 and 100000000) then
    raise exception 'expected_total is a whole number of dong' using errcode = '22023';
  end if;
  if p_counter then
    if p_request ? 'table_id' and jsonb_typeof(p_request -> 'table_id') <> 'null'
       and (jsonb_typeof(p_request -> 'table_id') <> 'string' or (p_request ->> 'table_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'table_id is a UUID' using errcode = '22023';
    end if;
    return;
  end if;
  if jsonb_typeof(p_request -> 'store') is distinct from 'string' then
    raise exception 'store is the store link key' using errcode = '22023';
  end if;
  if not (p_request ? 'expected_total') or jsonb_typeof(p_request -> 'expected_total') = 'null' then
    raise exception 'expected_total is the total the app showed' using errcode = '22023';
  end if;
  if (p_request ->> 'payment') is null or (p_request ->> 'payment') not in ('counter', 'zalo_checkout', 'vietqr') then
    raise exception 'payment is counter, zalo_checkout or vietqr' using errcode = '22023';
  end if;
  if p_request ? 'table_token' and jsonb_typeof(p_request -> 'table_token') not in ('string', 'null') then
    raise exception 'table_token is a string' using errcode = '22023';
  end if;
  if p_request ? 'menu_version' and jsonb_typeof(p_request -> 'menu_version') not in ('number', 'null') then
    raise exception 'menu_version is a number' using errcode = '22023';
  end if;
  if p_request ? 'pickup_at' and jsonb_typeof(p_request -> 'pickup_at') <> 'null' then
    if jsonb_typeof(p_request -> 'pickup_at') <> 'string' or (p_request ->> 'pickup_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'pickup_at is an ISO 8601 instant with its offset' using errcode = '22023';
    end if;
  end if;
end;
$$;

comment on function app.order_request_shape(jsonb, boolean) is 'the shape check of an order request, before anything is read: only the known keys (an unknown key, __proto__ included, is refused), a UUID request_id, the type, the lines, the notes, a whole expected_total, and for the customer the store key, the payment method, the table token, the menu version and an ISO pickup time; 22023 for any break';

create function app.order_place_answer(p_order public.orders, p_replayed boolean, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', case when p_order.status = 'awaiting_payment' then 'awaiting_payment' when p_order.status = 'cancelled' then 'cancelled' else 'placed' end,
    'refusal', null,
    'replayed', p_replayed,
    'order', app.order_json(p_order, 'customer', p_at)
  );
$$;

create function app.order_refused(p_refusal text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('state', 'refused', 'refusal', p_refusal, 'replayed', false, 'order', null) || coalesce(p_extra, '{}'::jsonb);
$$;

comment on function app.order_place_answer(public.orders, boolean, timestamptz) is 'the answer of a placement: placed (accepted, numbered), awaiting_payment or, for a replay of a cancelled one, cancelled, with the order';
comment on function app.order_refused(text, jsonb) is 'a placement refused as data, with its reason and details';

create function app.customer_place_order(p_request jsonb, p_at timestamptz default now())
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
  v_priced jsonb;
  v_total numeric;
  v_order public.orders;
  v_status public.order_status;
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
  if not (v_state ->> 'accepting')::boolean then
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
      if v_pickup < p_at + make_interval(mins => v_settings.prep_minutes)
         or not exists (select 1 from app.ordering_span_at(v_store.id, v_pickup))
         or app.store_business_date(v_store.id, v_pickup) <> app.store_business_date(v_store.id, p_at) then
        return app.order_refused('pickup_time_invalid');
      end if;
    end if;
  end if;
  if not (v_payment = any (v_settings.payment_methods)) or (v_type = 'takeaway' and v_payment = 'counter') then
    return app.order_refused('payment_not_allowed');
  end if;

  v_priced := app.order_price_lines(v_store.id, v_ctx.brand_id, v_type, p_request -> 'lines', p_at);
  if not (v_priced ->> 'ok')::boolean then
    return app.order_refused(v_priced ->> 'refusal', v_priced - 'ok' - 'refusal' || jsonb_build_object('menu_version', app.menu_version(v_ctx.brand_id)));
  end if;
  v_total := (v_priced ->> 'subtotal')::numeric;
  if v_total > v_settings.max_order_amount then
    return app.order_refused('amount_over_limit', jsonb_build_object('total', v_total::bigint, 'max_order_amount', v_settings.max_order_amount::bigint));
  end if;
  if v_total <> (p_request ->> 'expected_total')::numeric then
    return app.order_refused('price_changed', jsonb_build_object('total', v_total::bigint, 'menu_version', app.menu_version(v_ctx.brand_id), 'lines', v_priced -> 'lines'));
  end if;

  v_status := case when v_payment = 'counter' then 'accepted' else 'awaiting_payment' end;
  insert into public.orders (tenant_id, brand_id, store_id, source, customer_login_id, order_type, table_id, table_label, pickup_at, business_date,
    order_no, status, payment_status, payment_method, subtotal, discount_amount, total, note, request_id, request_hash, menu_version,
    placed_at, payment_due_at, accepted_at)
  values (v_store.tenant_id, v_ctx.brand_id, v_store.id, 'app', v_login.id, v_type, (v_table ->> 'table_id')::uuid, v_table ->> 'label', v_pickup,
    app.store_business_date(v_store.id, p_at),
    case when v_status = 'accepted' then app.next_order_no(v_store.id, app.store_business_date(v_store.id, p_at)) end,
    v_status, 'unpaid', v_payment, v_total, 0, v_total, app.order_note(p_request -> 'note'), v_request_id, v_hash,
    coalesce((p_request ->> 'menu_version')::bigint, app.menu_version(v_ctx.brand_id)),
    p_at, case when v_status = 'awaiting_payment' then p_at + make_interval(mins => v_settings.payment_window_minutes) end,
    case when v_status = 'accepted' then p_at end)
  returning * into v_order;
  insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_id, size_id, item_name, size_label, quantity, unit_price, options,
    options_amount, line_total, counts_for_stamps, note)
  select v_order.tenant_id, v_order.store_id, v_order.id, (l ->> 'line_no')::smallint, (l ->> 'item_id')::uuid, (l ->> 'size_id')::uuid, l ->> 'item_name',
    l ->> 'size_label', (l ->> 'quantity')::integer, (l ->> 'unit_price')::numeric, l -> 'options', (l ->> 'options_amount')::numeric,
    (l ->> 'line_total')::numeric, (l ->> 'counts_for_stamps')::boolean, l ->> 'note'
  from jsonb_array_elements(v_priced -> 'lines') as x (l);
  perform app.order_event(v_order, 'status', 'placed', null, v_status::text, 'customer', v_login.user_id, null, null, v_order.total, p_at);
  return app.order_place_answer(v_order, false, p_at);
end;
$$;

comment on function app.customer_place_order(jsonb, timestamptz) is 'the customer''s order (native-till.md 5.3), writing nothing until every check passes: the shape (22023), the session (42501), the replay (the same request_id answers the first order, replayed true; another request under it request_conflict; parallel calls serialised by an advisory lock), the store of the brand (22023), the ordering state''s reason, blocked, rate_limited (20 calls of a customer and 200 of a store in 15 minutes), too_many_open_orders (3), the table token (table_unknown) or the pickup time, payment_not_allowed (takeaway is prepaid online), item_unavailable or option_invalid, amount_over_limit, price_changed with the total; then the order with its priced lines and its first event: accepted with its number and payment unpaid for the counter, awaiting_payment until payment_due_at for an online method';

create function app.customer_check_cart(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_store public.stores;
  v_priced jsonb;
begin
  perform app.order_request_shape(p_request || jsonb_build_object('request_id', '00000000-0000-0000-0000-000000000000', 'payment', coalesce(p_request ->> 'payment', 'counter'), 'expected_total', coalesce(p_request -> 'expected_total', '0'::jsonb)), false);
  select c.* into v_ctx from app.customer_menu_store(p_request ->> 'store') c;
  select s.* into v_store from public.stores s where s.id = v_ctx.store_id;
  v_priced := app.order_price_lines(v_store.id, v_ctx.brand_id, p_request ->> 'type', p_request -> 'lines', p_at);
  return jsonb_build_object(
    'state', case when (v_priced ->> 'ok')::boolean then 'ok' else 'refused' end,
    'refusal', v_priced ->> 'refusal',
    'unavailable_items', coalesce(v_priced -> 'unavailable_items', '[]'::jsonb),
    'bad_lines', case when v_priced ->> 'refusal' = 'option_invalid' then v_priced -> 'lines' else '[]'::jsonb end,
    'lines', case when (v_priced ->> 'ok')::boolean then v_priced -> 'lines' else '[]'::jsonb end,
    'total', (v_priced ->> 'subtotal')::bigint,
    'menu_version', app.menu_version(v_ctx.brand_id),
    'ordering', app.ordering_state(v_store.id, p_request ->> 'type', p_at)
  );
end;
$$;

comment on function app.customer_check_cart(jsonb, timestamptz) is 'prices a basket without writing anything, for the confirmation step: the lines and the total the server would charge, or the items that went unavailable and the lines with invalid options, the menu version and the ordering state; the same request shape as customer_place_order (request_id, payment and expected_total optional)';

create function app.counter_create_order(p_store_id uuid, p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_uid uuid := (select auth.uid());
  v_request_id uuid;
  v_hash text;
  v_existing public.orders;
  v_type text := p_request ->> 'type';
  v_table public.store_tables;
  v_brand uuid;
  v_priced jsonb;
  v_total numeric;
  v_order public.orders;
begin
  perform app.order_request_shape(p_request, true);
  if not exists (select 1 from public.store_ordering_settings o where o.store_id = v_store.id and o.till_mode = 'native') then
    return app.order_refused('not_native');
  end if;
  v_request_id := (p_request ->> 'request_id')::uuid;
  v_hash := app.sha256_hex(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended('fnb-order-request:' || v_uid::text || ':' || v_request_id::text, 0));
  select o.* into v_existing from public.orders o where o.created_by = v_uid and o.request_id = v_request_id and o.source = 'counter';
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash or v_existing.store_id <> v_store.id then
      return app.order_refused('request_conflict');
    end if;
    return jsonb_build_object('state', 'placed', 'refusal', null, 'replayed', true, 'order', app.order_json(v_existing, 'counter', p_at));
  end if;
  if v_type = 'table' then
    select t.* into v_table from public.store_tables t
    where t.id = (p_request ->> 'table_id')::uuid and t.store_id = v_store.id and t.active;
    if v_table.id is null then
      return app.order_refused('table_unknown');
    end if;
  elsif jsonb_typeof(p_request -> 'table_id') = 'string' then
    return app.order_refused('table_not_for_takeaway');
  end if;
  select i.brand_id into v_brand
  from public.menu_item_sizes z join public.menu_items i on i.id = z.item_id
  where z.id = ((p_request -> 'lines' -> 0) ->> 'size')::uuid;
  if v_brand is null or not (v_brand = any (app.menu_brand_ids_of_store(v_store.id))) then
    return app.order_refused('item_unavailable', jsonb_build_object('unavailable_items', jsonb_build_array((p_request -> 'lines' -> 0) ->> 'size')));
  end if;
  v_priced := app.order_price_lines(v_store.id, v_brand, v_type, p_request -> 'lines', p_at);
  if not (v_priced ->> 'ok')::boolean then
    return app.order_refused(v_priced ->> 'refusal', v_priced - 'ok' - 'refusal');
  end if;
  v_total := (v_priced ->> 'subtotal')::numeric;
  if p_request ? 'expected_total' and jsonb_typeof(p_request -> 'expected_total') = 'number' and v_total <> (p_request ->> 'expected_total')::numeric then
    return app.order_refused('price_changed', jsonb_build_object('total', v_total::bigint, 'lines', v_priced -> 'lines'));
  end if;
  insert into public.orders (tenant_id, brand_id, store_id, source, order_type, table_id, table_label, business_date, order_no, status, payment_status,
    payment_method, subtotal, discount_amount, total, note, request_id, request_hash, menu_version, placed_at, accepted_at, created_by)
  values (v_store.tenant_id, v_brand, v_store.id, 'counter', v_type, v_table.id, v_table.label, app.store_business_date(v_store.id, p_at),
    app.next_order_no(v_store.id, app.store_business_date(v_store.id, p_at)), 'accepted', 'unpaid', 'counter', v_total, 0, v_total,
    app.order_note(p_request -> 'note'), v_request_id, v_hash, app.menu_version(v_brand), p_at, p_at, v_uid)
  returning * into v_order;
  insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_id, size_id, item_name, size_label, quantity, unit_price, options,
    options_amount, line_total, counts_for_stamps, note)
  select v_order.tenant_id, v_order.store_id, v_order.id, (l ->> 'line_no')::smallint, (l ->> 'item_id')::uuid, (l ->> 'size_id')::uuid, l ->> 'item_name',
    l ->> 'size_label', (l ->> 'quantity')::integer, (l ->> 'unit_price')::numeric, l -> 'options', (l ->> 'options_amount')::numeric,
    (l ->> 'line_total')::numeric, (l ->> 'counts_for_stamps')::boolean, l ->> 'note'
  from jsonb_array_elements(v_priced -> 'lines') as x (l);
  perform app.order_event(v_order, 'status', 'placed', null, 'accepted', 'staff', v_uid, null, null, v_order.total, p_at);
  return jsonb_build_object('state', 'placed', 'refusal', null, 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_create_order(uuid, jsonb, timestamptz) is 'an order keyed at the counter for a customer without the app (native-till.md 5.3): {request_id, type, table_id for a table order, lines, note, expected_total optional}; priced from the menu as for the app, accepted at once with its number, payment unpaid, paid at the counter; idempotent per staff member and request_id; owners, managers and staff of a native store';

-- 7. The counter's queue and actions -------------------------------------------------------------------------------

create function app.counter_board(p_store_id uuid, p_cursor bigint default 0, p_at timestamptz default now())
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

comment on function app.counter_board(uuid, bigint, timestamptz) is 'the counter''s queue (native-till.md 5.4), polled every 2 seconds: the ordering state, the counts per state, the orders changed since the cursor among the open ones and the business day''s closed ones (never one still awaiting its online payment; at most 200, oldest change first) with their lines and the late flag, the open table calls, and the new cursor; records the caller''s presence; owners, managers and staff of the store only';

create function app.counter_order(p_order_id uuid, p_at timestamptz default now())
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
  return app.order_json(v_order, 'counter', p_at) || jsonb_build_object('timeline', app.order_timeline(v_order.id, 'counter'));
end;
$$;

comment on function app.counter_order(uuid, timestamptz) is 'an order''s detail for the counter: lines, options, notes, the three states and the timeline with who did what; owners, managers and staff of its store (42501 otherwise, the same for an unknown order)';

create function app.counter_order_act(p_order_id uuid, p_action text, p_expected_version integer, p_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_uid uuid := (select auth.uid());
  v_target public.order_status;
  v_code text;
  v_text text;
  v_blocked boolean := false;
begin
  if p_action is null or p_action not in ('start', 'done', 'complete', 'cancel') then
    raise exception 'an action is start, done, complete or cancel' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'an action names the version of the order it saw' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null or v_uid is null
     or not app.has_store_scope(v_order.tenant_id, v_order.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only staff of the order''s store act on it' using errcode = '42501';
  end if;
  if p_action = 'cancel' then
    v_code := split_part(coalesce(p_reason, ''), ':', 1);
    v_text := nullif(btrim(substring(coalesce(p_reason, '') from position(':' in coalesce(p_reason, '')) + 1)), '');
    if position(':' in coalesce(p_reason, '')) = 0 then
      v_text := null;
    end if;
    if not (v_code = any (app.order_cancel_reasons())) or (v_code = 'other' and v_text is null)
       or (v_text is not null and (char_length(v_text) > 200 or v_text ~ '[[:cntrl:]]')) then
      raise exception 'a cancellation names its reason (%), other with a text: other:<text>', array_to_string(app.order_cancel_reasons(), ', ') using errcode = '22023';
    end if;
  end if;
  v_target := case p_action
    when 'start' then 'preparing'
    when 'done' then case v_order.order_type when 'takeaway' then 'ready' else 'serving' end
    when 'complete' then 'completed'
    when 'cancel' then 'cancelled'
  end;
  if v_order.status = v_target then
    return jsonb_build_object('state', 'ok', 'refusal', null, 'replayed', true, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.version <> p_expected_version then
    return jsonb_build_object('state', 'conflict', 'refusal', 'conflict', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if not (
    (p_action = 'start' and v_order.status = 'accepted')
    or (p_action = 'done' and v_order.status = 'preparing')
    or (p_action = 'complete' and v_order.status in ('ready', 'serving'))
    or (p_action = 'cancel' and v_order.status in ('awaiting_payment', 'accepted'))
  ) then
    return jsonb_build_object('state', 'refused', 'refusal', case v_order.status
        when 'cancelled' then 'already_cancelled' when 'completed' then 'already_completed' else 'not_allowed' end,
      'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if (p_action = 'complete' and v_order.payment_status <> 'paid')
     or (p_action = 'start' and v_order.order_type = 'takeaway' and v_order.payment_status <> 'paid') then
    return jsonb_build_object('state', 'refused', 'refusal', 'payment_required', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  v_order := app.order_move(v_order, v_target, p_action, 'staff', v_uid, v_code, v_text, p_at);
  if p_action = 'cancel' and v_code = 'suspected_prank' then
    v_blocked := app.order_block_if_pranks(v_order, p_at);
  end if;
  return jsonb_build_object('state', 'ok', 'refusal', null, 'replayed', false, 'customer_blocked', v_blocked, 'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_order_act(uuid, text, integer, text, timestamptz) is 'the counter''s lifecycle actions (ADR-061): start (accepted -> preparing; a takeaway order must be paid), done (preparing -> ready for takeaway, serving for a table), complete (ready or serving -> completed, only when paid), cancel (awaiting_payment or accepted -> cancelled with a reason code, other:<text> for other; a paid order''s refund becomes due). The same target again is a replay; a version other than the one the order has is conflict with the current order; anything else is refused as data (not_allowed, already_cancelled, already_completed, payment_required) and changes nothing. Three suspected_prank cancellations of a customer in 7 days block it for 7 days. Owners, managers and staff of the store (42501 otherwise, the same for an unknown order)';

-- 8. The customer's orders ------------------------------------------------------------------------------------------

create function app.customer_cancel_order(p_order_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_order public.orders;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id and o.customer_login_id = v_login.id for update;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order', 'order', null);
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'refusal', null, 'replayed', true, 'order', app.order_json(v_order, 'customer', p_at));
  end if;
  if not (v_order.status = 'awaiting_payment' or (v_order.status = 'accepted' and v_order.payment_status = 'unpaid')) then
    return jsonb_build_object('state', 'refused', 'refusal', case when v_order.status = 'accepted' then 'contact_store' else 'not_allowed' end,
      'order', app.order_json(v_order, 'customer', p_at));
  end if;
  v_order := app.order_move(v_order, 'cancelled', 'cancel', 'customer', v_login.user_id, 'customer_cancelled', null, p_at);
  return jsonb_build_object('state', 'cancelled', 'refusal', null, 'replayed', false, 'order', app.order_json(v_order, 'customer', p_at));
end;
$$;

comment on function app.customer_cancel_order(uuid, timestamptz) is 'the customer cancels their own order while it awaits its online payment, or is accepted and still unpaid; a paid accepted order answers contact_store, a started one not_allowed, a cancelled one is a replay; another login''s order answers exactly as an unknown id (unknown_order)';

create function app.customer_order(p_order_id uuid, p_at timestamptz default now())
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
    'order', app.order_json(v_order, 'customer', p_at) || jsonb_build_object('timeline', app.order_timeline(v_order.id, 'customer')));
end;
$$;

comment on function app.customer_order(uuid, timestamptz) is 'the customer''s order screen (polled every 3 seconds while open): the order with its lines, the three states, the times and the timeline without staff identities; another login''s order answers exactly as an unknown id';

create function app.customer_orders(p_before timestamptz default null, p_at timestamptz default now())
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

comment on function app.customer_orders(timestamptz, timestamptz) is 'the customer''s own orders, newest first, 20 a page (next_before for the next page)';

-- 9. The minute job ------------------------------------------------------------------------------------------------

create function app.ordering_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_cancelled integer := 0;
  v_pruned integer;
begin
  for v_order in
    select o.* from public.orders o
    where o.status = 'awaiting_payment' and o.payment_due_at <= p_at
    order by o.payment_due_at
    limit 500
    for update skip locked
  loop
    perform app.order_move(v_order, 'cancelled', 'payment_timeout', 'system', null, 'payment_timeout', null, p_at);
    v_cancelled := v_cancelled + 1;
  end loop;
  delete from app.ordering_presence p where p.seen_at < p_at - interval '1 day';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('payment_timeouts', v_cancelled, 'presence_pruned', v_pruned);
end;
$$;

comment on function app.ordering_tick(timestamptz) is 'the minute job of the native till: cancels the orders whose online payment window passed (payment_timeout, nothing charged, no number taken) and prunes counter presence older than a day; touches only due rows; answers counts';

create function app.enable_ordering_tick(p_schedule text default '* * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  return cron.schedule('ordering-tick', p_schedule, 'select app.ordering_tick(now())');
end;
$$;

create function app.disable_ordering_tick()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'ordering-tick') then
    perform cron.unschedule('ordering-tick');
  end if;
end;
$$;

comment on function app.enable_ordering_tick(text) is 'schedules the pg_cron job ordering-tick (every minute by default); the migration leaves it off';
comment on function app.disable_ordering_tick() is 'removes the pg_cron job ordering-tick';

-- 10. The till mode with open orders -------------------------------------------------------------------------------

create or replace function app.set_store_till_mode(p_store_id uuid, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_settings public.store_ordering_settings;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store changes a store''s till mode' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('ipos', 'native') then
    raise exception 'a till mode is ipos or native' using errcode = '22023';
  end if;
  if p_mode = 'ipos' and exists (select 1 from public.orders o where o.store_id = v_store.id and o.status = any (app.order_open_statuses())) then
    raise exception 'the store still has open orders; finish or cancel them first' using errcode = '22023';
  end if;
  insert into public.store_ordering_settings as o (store_id, tenant_id, till_mode, created_by, updated_by)
  values (v_store.id, v_store.tenant_id, p_mode, (select auth.uid()), (select auth.uid()))
  on conflict (store_id) do update set till_mode = excluded.till_mode
  returning o.* into v_settings;
  return jsonb_build_object('store_id', v_store.id, 'till_mode', v_settings.till_mode, 'ordering_enabled', v_settings.ordering_enabled);
end;
$$;

comment on function app.set_store_till_mode(uuid, text) is 'switches a store between ipos (the POS is the till) and native (this platform is the till), creating its settings row when needed; back to ipos only without open orders (22023); an owner with every store only (42501), 22023 for another mode';

-- 11. Public wrappers and grants -----------------------------------------------------------------------------------

create function public.customer_place_order(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_place_order(p_request, now()); $$;
comment on function public.customer_place_order(jsonb) is 'RPC for the customer Mini App: app.customer_place_order at the current time';

create function public.customer_check_cart(p_request jsonb)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_check_cart(p_request, now()); $$;
comment on function public.customer_check_cart(jsonb) is 'RPC for the customer Mini App: app.customer_check_cart at the current time';

create function public.customer_cancel_order(p_order uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_cancel_order(p_order, now()); $$;
comment on function public.customer_cancel_order(uuid) is 'RPC for the customer Mini App: app.customer_cancel_order at the current time';

create function public.customer_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_order(p_order, now()); $$;
comment on function public.customer_order(uuid) is 'RPC for the customer Mini App: app.customer_order at the current time';

create function public.customer_orders(p_before timestamptz default null)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_orders(p_before, now()); $$;
comment on function public.customer_orders(timestamptz) is 'RPC for the customer Mini App: app.customer_orders at the current time';

create function public.counter_board(p_store uuid, p_cursor bigint default 0)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_board(p_store, p_cursor, now()); $$;
comment on function public.counter_board(uuid, bigint) is 'RPC for the counter web app: app.counter_board at the current time';

create function public.counter_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.counter_order(p_order, now()); $$;
comment on function public.counter_order(uuid) is 'RPC for the counter web app: app.counter_order at the current time';

create function public.counter_order_act(p_order uuid, p_action text, p_expected_version integer, p_reason text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_order_act(p_order, p_action, p_expected_version, p_reason, now()); $$;
comment on function public.counter_order_act(uuid, text, integer, text) is 'RPC for the counter web app: app.counter_order_act at the current time';

create function public.counter_create_order(p_store uuid, p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_create_order(p_store, p_request, now()); $$;
comment on function public.counter_create_order(uuid, jsonb) is 'RPC for the counter web app: app.counter_create_order at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('keep_order_events', 'refuse_order_events_truncate', 'order_text_ok', 'order_note', 'order_lines_valid', 'order_price_lines',
        'next_order_no', 'order_display_no', 'order_lines_json', 'order_json', 'order_timeline', 'order_event', 'order_open_statuses',
        'ordering_waiting_orders', 'table_open_orders', 'order_move', 'order_payment_succeeded', 'order_cancel_reasons', 'order_block_if_pranks',
        'order_request_shape', 'order_place_answer', 'order_refused', 'customer_place_order', 'customer_check_cart', 'counter_create_order',
        'counter_board', 'counter_order', 'counter_order_act', 'customer_cancel_order', 'customer_order', 'customer_orders', 'ordering_tick',
        'enable_ordering_tick', 'disable_ordering_tick', 'set_store_till_mode')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on sequence app.order_change_seq from public, anon, authenticated, service_role;

revoke all on function public.customer_place_order(jsonb), public.customer_check_cart(jsonb), public.customer_cancel_order(uuid),
  public.customer_order(uuid), public.customer_orders(timestamptz), public.counter_board(uuid, bigint), public.counter_order(uuid),
  public.counter_order_act(uuid, text, integer, text), public.counter_create_order(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.customer_place_order(jsonb), public.customer_check_cart(jsonb), public.customer_cancel_order(uuid),
  public.customer_order(uuid), public.customer_orders(timestamptz), public.counter_board(uuid, bigint), public.counter_order(uuid),
  public.counter_order_act(uuid, text, integer, text), public.counter_create_order(uuid, jsonb)
  to authenticated;
