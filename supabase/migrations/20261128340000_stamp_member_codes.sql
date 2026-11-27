-- The member code of the Zalo account's stamp card (C20) and the counter's scan (Q01): a customer without the phone
-- programme shows a short-lived code (a QR of a random 128-bit token and an 8-digit number with a Luhn check digit to
-- read aloud, both valid 10 minutes, a new one replacing the last); the counter looks the code up (the customer's
-- shortened name, when they joined with a phone, and their stamps; nothing else) and attaches the customer to a counter
-- order, whose drinks then earn stamps on that card when it completes, once. Guesses count against the person and the
-- store (5 and 20 misses in 15 minutes); only the SHA-256 of a code is kept; a code works only at stores of its brand
-- and only while it lives, so a screenshot dies with it. Every attach is an order event, and the customer sees the
-- orders attached to their card, so a misuse shows.

-- 1. Codes ------------------------------------------------------------------------------------------------------

create table app.stamp_member_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  number_sha256 text not null check (number_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  check (expires_at > issued_at),
  check (revoked_at is null or revoked_at >= issued_at)
);

create index stamp_member_codes_number_idx on app.stamp_member_codes (brand_id, number_sha256);
create index stamp_member_codes_login_idx on app.stamp_member_codes (customer_login_id, brand_id, issued_at desc);
create index stamp_member_codes_tenant_idx on app.stamp_member_codes (tenant_id);

comment on table app.stamp_member_codes is 'the member codes of the stamp cards (C20): per brand and customer login, the SHA-256 of the QR token and of the 8-digit number, when issued, when it expires (10 minutes) and when a newer code revoked it; no code is kept in the clear; read and written only by the member-code functions; removed with the login';

alter table app.stamp_member_codes enable row level security;
revoke all on table app.stamp_member_codes from public, anon, authenticated, service_role;

-- 2. Attaching a member to an order ---------------------------------------------------------------------------------

alter table public.orders
  add column member_login_id uuid references app.customer_logins (id) on delete set null,
  add column member_attached_at timestamptz,
  add column member_attached_by uuid references auth.users (id) on delete set null,
  add constraint orders_member_check check (member_login_id is null or (customer_login_id is null and source = 'counter'));

create index orders_member_login_idx on public.orders (member_login_id) where member_login_id is not null;

comment on column public.orders.member_login_id is 'the stamp card holder the counter attached to a counter order by their member code (C20, Q01): the order''s drinks earn stamps on that card when it completes; set only by counter_attach_member, cleared when the login is deleted; never an owner of the order (the customer cannot read, cancel or pay it)';
comment on column public.orders.member_attached_at is 'when the counter attached the member';
comment on column public.orders.member_attached_by is 'who attached the member';

alter table public.order_events drop constraint order_events_kind_check;
alter table public.order_events add constraint order_events_kind_check check (kind in ('status', 'payment', 'member'));

-- 3. Limits ---------------------------------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website', 'staff_clock_in',
  'counter_member_lookup', 'customer_stamp_code'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('counter_member_lookup', 'misses', 5, 20, interval '15 minutes', interval '15 minutes'),
  ('customer_stamp_code', 'calls', 30, 10000, interval '15 minutes', interval '15 minutes');

-- 4. Helpers --------------------------------------------------------------------------------------------------------

create function app.luhn_check_digit(p_digits text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((10 - (sum(case when x.j % 2 = 1 then case when x.d * 2 > 9 then x.d * 2 - 9 else x.d * 2 end else x.d end) % 10)) % 10)::integer
  from (
    select substr(p_digits, char_length(p_digits) - g.j + 1, 1)::integer as d, g.j
    from generate_series(1, char_length(p_digits)) as g (j)
  ) x
  where p_digits ~ '^[0-9]{1,30}$';
$$;

comment on function app.luhn_check_digit(text) is 'the Luhn check digit of a string of digits (null for anything else): the 8th digit of a member number, so a mistyped digit is caught before any lookup';

create function app.stamp_code_hash(p_kind text, p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to('stamp-' || p_kind || ':' || p_value, 'UTF8'), 'sha256'), 'hex');
$$;

comment on function app.stamp_code_hash(text, text) is 'the SHA-256 kept for a member code''s token (kind token) or number (kind number), with the kind in the hashed text so a token never matches a number';

create function app.stamp_code_parse(p_code text)
returns table (kind text, value text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_digits text;
begin
  if v_code ~ '^fnb-stamp:1:[A-Za-z0-9_-]{22}$' then
    return query select 'token'::text, substr(v_code, 13);
    return;
  end if;
  if v_code ~ '^[A-Za-z0-9_-]{22}$' and v_code !~ '^[0-9]+$' then
    return query select 'token'::text, v_code;
    return;
  end if;
  v_digits := regexp_replace(v_code, '[ .-]', '', 'g');
  if v_digits ~ '^[0-9]{8}$' and char_length(v_code) <= 12 then
    return query select 'number'::text, v_digits;
    return;
  end if;
  raise exception 'a member code is its QR (fnb-stamp:1:<token>) or its 8 digits' using errcode = '22023';
end;
$$;

comment on function app.stamp_code_parse(text) is 'reads what the counter scanned or typed: the QR payload fnb-stamp:1:<22 characters> or the bare token (kind token), or 8 digits with optional spaces, dots or dashes (kind number); 22023 for anything else';

create function app.stamp_code_mistyped(p_code text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parsed record;
begin
  select p.* into v_parsed from app.stamp_code_parse(p_code) p;
  return v_parsed.kind = 'number' and app.luhn_check_digit(left(v_parsed.value, 7)) <> right(v_parsed.value, 1)::integer;
end;
$$;

comment on function app.stamp_code_mistyped(text) is 'whether a typed member number fails its Luhn check digit (a slip of the cashier''s finger): answered code_mistyped and not counted as a guess, since no number that fails the check can match a code; 22023 for a malformed code';

create function app.stamp_code_find(p_tenant_id uuid, p_store_id uuid, p_code text, p_at timestamptz)
returns app.stamp_member_codes
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parsed record;
  v_code app.stamp_member_codes;
begin
  select p.* into v_parsed from app.stamp_code_parse(p_code) p;
  if v_parsed.kind = 'number' and app.luhn_check_digit(left(v_parsed.value, 7)) <> right(v_parsed.value, 1)::integer then
    return null;
  end if;
  select c.* into v_code
  from app.stamp_member_codes c
  join public.brands b on b.id = c.brand_id and b.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant_id
    and p_store_id = any (b.store_ids)
    and c.revoked_at is null
    and c.issued_at <= p_at
    and c.expires_at > p_at
    and case when v_parsed.kind = 'token' then c.token_sha256 = app.stamp_code_hash('token', v_parsed.value)
             else c.number_sha256 = app.stamp_code_hash('number', v_parsed.value) end
  order by c.issued_at desc
  limit 1;
  return v_code;
end;
$$;

comment on function app.stamp_code_find(uuid, uuid, text, timestamptz) is 'the live member code (not revoked, not expired) a scanned or typed code names, among the codes of the brands that hold the store in its tenant; null for a number whose check digit is wrong, an unknown, expired or revoked code and a code of another brand or tenant; 22023 for a malformed code';

create function app.stamp_member_summary(p_code app.stamp_member_codes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', (
      select nullif(left(regexp_replace(btrim(c.name), '^.*\s', ''), 20), '')
      from app.customer_logins l join public.customers c on c.id = l.customer_id and c.tenant_id = l.tenant_id
      where l.id = p_code.customer_login_id
    ),
    'stamps', coalesce((select sc.stamps from public.stamp_cards sc where sc.brand_id = p_code.brand_id and sc.customer_login_id = p_code.customer_login_id), 0),
    'stamps_per_reward', (select s.stamps_per_reward from app.stamp_settings(p_code.brand_id) s),
    'rewards_available', (
      select count(*)::integer from public.stamp_rewards r join public.stamp_cards sc on sc.id = r.card_id
      where sc.brand_id = p_code.brand_id and sc.customer_login_id = p_code.customer_login_id and r.status = 'available'
    ),
    'code_expires_at', p_code.expires_at
  );
$$;

comment on function app.stamp_member_summary(app.stamp_member_codes) is 'what the counter sees of a member code''s holder: the last word of the name of a customer who joined with a phone (at most 20 characters; null for a Zalo account without one), the stamps toward the next reward, how many make one, the rewards waiting and when the code expires; never a phone, an id or a full name';

-- 5. The customer's code --------------------------------------------------------------------------------------------

create function app.customer_stamp_code(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_brand uuid;
  v_settings record;
  v_locked timestamptz;
  v_token text;
  v_number text;
  v_tries integer := 0;
  v_code app.stamp_member_codes;
begin
  select a.brand_id into v_brand from public.zalo_apps a where a.id = v_login.zalo_app_id and a.tenant_id = v_login.tenant_id;
  select s.* into v_settings from app.stamp_settings(v_brand) s;
  if v_brand is null or not v_settings.enabled then
    return jsonb_build_object('state', 'refused', 'refusal', 'stamps_off', 'code', null);
  end if;
  v_locked := app.code_attempt_gate('customer_stamp_code', v_login.tenant_id, null, v_login.user_id, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'code', null);
  end if;
  perform app.code_attempt_record('customer_stamp_code', v_login.tenant_id, null, v_login.user_id, p_at);
  perform pg_advisory_xact_lock(hashtextextended('fnb-stamp-code:' || v_brand::text, 0));
  loop
    v_tries := v_tries + 1;
    v_number := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 10000000)::text, 7, '0');
    v_number := v_number || app.luhn_check_digit(v_number)::text;
    exit when not exists (
      select 1 from app.stamp_member_codes c
      where c.brand_id = v_brand and c.number_sha256 = app.stamp_code_hash('number', v_number) and c.revoked_at is null and c.expires_at > p_at
    );
    if v_tries >= 10 then
      raise exception 'no free member number' using errcode = '55000';
    end if;
  end loop;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');
  update app.stamp_member_codes c
  set revoked_at = p_at
  where c.customer_login_id = v_login.id and c.brand_id = v_brand and c.revoked_at is null and c.expires_at > p_at;
  delete from app.stamp_member_codes c
  where c.customer_login_id = v_login.id and c.expires_at < p_at - interval '1 day';
  insert into app.stamp_member_codes (tenant_id, brand_id, customer_login_id, token_sha256, number_sha256, issued_at, expires_at)
  values (v_login.tenant_id, v_brand, v_login.id, app.stamp_code_hash('token', v_token), app.stamp_code_hash('number', v_number), p_at, p_at + interval '10 minutes')
  returning * into v_code;
  return jsonb_build_object(
    'state', 'issued',
    'refusal', null,
    'code', jsonb_build_object(
      'qr_payload', 'fnb-stamp:1:' || v_token,
      'number', v_number,
      'display_number', left(v_number, 4) || ' ' || right(v_number, 4),
      'issued_at', v_code.issued_at,
      'refresh_at', v_code.issued_at + interval '9 minutes',
      'expires_at', v_code.expires_at
    )
  );
end;
$$;

comment on function app.customer_stamp_code(timestamptz) is 'C20 "Mã thành viên" for the customer''s Zalo account: a new member code of the app''s brand (the QR payload fnb-stamp:1:<128-bit token>, an 8-digit number with a Luhn check digit, valid 10 minutes, to refresh after 9), which revokes the customer''s earlier live code; only the hashes are kept; stamps_off when the brand''s stamp card is off; rate_limited after 30 codes in 15 minutes; 42501 without a customer session';

-- 6. The counter's lookup and attach --------------------------------------------------------------------------------

create function app.counter_member_lookup(p_store_id uuid, p_code text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_uid uuid := (select auth.uid());
  v_locked timestamptz;
  v_code app.stamp_member_codes;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_uid is null or v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only staff of the store look up a member' using errcode = '42501';
  end if;
  perform app.stamp_code_parse(p_code);
  if not exists (select 1 from public.store_ordering_settings o where o.store_id = v_store.id and o.till_mode = 'native') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_native', 'member', null);
  end if;
  if app.stamp_code_mistyped(p_code) then
    return jsonb_build_object('state', 'refused', 'refusal', 'code_mistyped', 'member', null);
  end if;
  v_locked := app.code_attempt_gate('counter_member_lookup', v_store.tenant_id, v_store.id, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'member', null);
  end if;
  v_code := app.stamp_code_find(v_store.tenant_id, v_store.id, p_code, p_at);
  if v_code.id is null then
    perform app.code_attempt_record('counter_member_lookup', v_store.tenant_id, v_store.id, v_uid, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', 'code_unknown', 'member', null);
  end if;
  return jsonb_build_object('state', 'found', 'refusal', null, 'member', app.stamp_member_summary(v_code));
end;
$$;

comment on function app.counter_member_lookup(uuid, text, timestamptz) is 'Q01 "Quét mã thành viên": staff, managers and owners of a native store (42501 otherwise; not_native for an ipos store) read who a scanned or typed member code belongs to: the shortened name, the stamps and the rewards waiting (app.stamp_member_summary), nothing else; code_mistyped for a number whose check digit is wrong (not counted), code_unknown for an unknown, expired or revoked code or one of another brand, each a miss against the person and the store (5 and 20 in 15 minutes, then rate_limited); 22023 for a malformed code';

create or replace function app.stamps_on_completion(p_order public.orders, p_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings record;
  v_card public.stamp_cards;
  v_stamps integer;
  v_reward uuid;
  v_login uuid := coalesce(p_order.customer_login_id, p_order.member_login_id);
begin
  if v_login is null then
    return 0;
  end if;
  select s.* into v_settings from app.stamp_settings(p_order.brand_id) s;
  if not v_settings.enabled or exists (select 1 from public.stamp_entries e where e.order_id = p_order.id and e.kind = 'order_earned') then
    return 0;
  end if;
  select coalesce(sum(l.quantity) filter (where l.counts_for_stamps), 0)::integer into v_stamps from public.order_lines l where l.order_id = p_order.id;
  if exists (select 1 from public.stamp_rewards r where r.used_order_id = p_order.id) then
    v_stamps := v_stamps - 1;
  end if;
  if v_stamps <= 0 then
    return 0;
  end if;
  v_card := app.stamp_card_for(p_order.tenant_id, p_order.brand_id, v_login);
  perform app.stamp_entry(v_card.id, 'order_earned', v_stamps, p_order.id, null, 'system', null, null, p_at);
  loop
    select c.* into v_card from public.stamp_cards c where c.id = v_card.id;
    exit when v_card.stamps < v_settings.stamps_per_reward;
    insert into public.stamp_rewards (tenant_id, brand_id, card_id, status, stamps, issued_at, issued_order_id)
    values (v_card.tenant_id, v_card.brand_id, v_card.id, 'available', v_settings.stamps_per_reward, p_at, p_order.id)
    returning id into v_reward;
    perform app.stamp_entry(v_card.id, 'reward_issued', -v_settings.stamps_per_reward, p_order.id, v_reward, 'system', null, null, p_at);
  end loop;
  return v_stamps;
end;
$$;

comment on function app.stamps_on_completion(public.orders, timestamptz) is 'the stamps of a completed order of a customer''s Zalo account, or of a counter order the counter attached a member to: one per drink (the quantity of its lines that count for stamps, less the free drink of a used reward), once per order; every full card of stamps_per_reward becomes an available reward';

create function app.counter_attach_member(p_order_id uuid, p_code text, p_expected_version integer, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders := app.order_for_counter(p_order_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_uid uuid := (select auth.uid());
  v_locked timestamptz;
  v_code app.stamp_member_codes;
  v_drinks integer;
  v_earned integer := 0;
begin
  perform app.stamp_code_parse(p_code);
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'an attach names the version of the order it saw' using errcode = '22023';
  end if;
  if v_order.source <> 'counter' or v_order.customer_login_id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'has_customer', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if app.stamp_code_mistyped(p_code) then
    return jsonb_build_object('state', 'refused', 'refusal', 'code_mistyped', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  v_locked := app.code_attempt_gate('counter_member_lookup', v_order.tenant_id, v_order.store_id, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  v_code := app.stamp_code_find(v_order.tenant_id, v_order.store_id, p_code, p_at);
  if v_code.id is null or v_code.brand_id <> v_order.brand_id then
    perform app.code_attempt_record('counter_member_lookup', v_order.tenant_id, v_order.store_id, v_uid, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', 'code_unknown', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.member_login_id is not null then
    return jsonb_build_object('state', case when v_order.member_login_id = v_code.customer_login_id then 'attached' else 'refused' end,
      'refusal', case when v_order.member_login_id <> v_code.customer_login_id then 'already_attached' end,
      'replayed', v_order.member_login_id = v_code.customer_login_id, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.version <> p_expected_version then
    return jsonb_build_object('state', 'conflict', 'refusal', 'conflict', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.status = 'cancelled' or v_order.payment_status in ('refund_pending', 'refunded', 'partially_refunded') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_attachable', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if v_order.status = 'completed' and v_order.completed_at < p_at - interval '30 minutes' then
    return jsonb_build_object('state', 'refused', 'refusal', 'too_late', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  if not (select s.enabled from app.stamp_settings(v_order.brand_id) s) then
    return jsonb_build_object('state', 'refused', 'refusal', 'stamps_off', 'replayed', false, 'order', app.order_json(v_order, 'counter', p_at));
  end if;
  update public.orders o
  set member_login_id = v_code.customer_login_id, member_attached_at = p_at, member_attached_by = v_uid,
      version = o.version + 1, change_seq = nextval('app.order_change_seq')
  where o.id = v_order.id
  returning o.* into v_order;
  perform app.order_event(v_order, 'member', 'member_attached', null, null, 'staff', v_uid, null, null, null, p_at);
  if v_order.status = 'completed' then
    v_earned := app.stamps_on_completion(v_order, p_at);
  end if;
  select coalesce(sum(l.quantity) filter (where l.counts_for_stamps), 0)::integer into v_drinks from public.order_lines l where l.order_id = v_order.id;
  return jsonb_build_object('state', 'attached', 'refusal', null, 'replayed', false,
    'stamps', case when v_order.status = 'completed' then v_earned else v_drinks end,
    'stamps_earned_now', v_order.status = 'completed',
    'member', app.stamp_member_summary(v_code),
    'order', app.order_json(v_order, 'counter', p_at));
end;
$$;

comment on function app.counter_attach_member(uuid, text, integer, timestamptz) is 'Q01 "Gắn vào đơn": staff, managers and owners of the order''s store (42501 otherwise, the same for an unknown order) attach the holder of a live member code of the order''s brand to a counter order, with the version they saw, so its drinks earn stamps on that card when it completes (at once when it was completed in the last 30 minutes); has_customer for an app order, code_mistyped (not counted), code_unknown (a miss, as for the lookup; rate_limited after 5 and 20), already_attached for another holder (the same holder is a replay), conflict, not_attachable for a cancelled or refunded order, too_late 30 minutes after completion, stamps_off; writes a member event with who attached it';

-- The counter sees whether a member is attached to an order.

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
    'member_attached', case when p_for = 'counter' then p_order.member_login_id is not null end,
    'late', p_for = 'counter' and p_order.status in ('accepted', 'preparing') and p_order.accepted_at <= p_at - make_interval(mins => coalesce(
      (select s.late_order_minutes from public.store_ordering_settings s where s.store_id = p_order.store_id), 10)),
    'lines', app.order_lines_json(p_order.id)
  );
$$;

comment on function app.order_json(public.orders, text, timestamptz) is 'an order as an answer shows it: for the counter (p_for counter) with the table id and the late flag (accepted or preparing for longer than the store''s late_order_minutes since acceptance), for the customer without staff identities; both with ready_estimate_at (app.order_ready_estimate); for the counter whether a member''s stamp card is attached (member_attached)';

-- 7. The customer sees the orders attached to their card ------------------------------------------------------------

create or replace function app.customer_stamp_card(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_brand uuid;
  v_settings record;
  v_card public.stamp_cards;
begin
  select a.brand_id into v_brand from public.zalo_apps a where a.id = v_login.zalo_app_id;
  select s.* into v_settings from app.stamp_settings(v_brand) s;
  select c.* into v_card from public.stamp_cards c where c.brand_id = v_brand and c.customer_login_id = v_login.id;
  return jsonb_build_object(
    'enabled', v_settings.enabled,
    'stamps', coalesce(v_card.stamps, 0),
    'stamps_per_reward', v_settings.stamps_per_reward,
    'reward_name', v_settings.reward_name,
    'total_earned', coalesce(v_card.total_earned, 0),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'issued_at', r.issued_at) order by r.issued_at, r.id)
      from public.stamp_rewards r where r.card_id = v_card.id and r.status = 'available'
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'delta', e.delta, 'balance_after', e.balance_after, 'at', e.occurred_at,
        'order_no', app.order_display_no(o.order_no)) order by e.id desc)
      from (select e.* from public.stamp_entries e where e.card_id = v_card.id order by e.id desc limit 20) e
      left join public.orders o on o.id = e.order_id
    ), '[]'::jsonb),
    'attached', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_no', app.order_display_no(o.order_no),
        'store_name', s.name,
        'status', o.status,
        'attached_at', o.member_attached_at,
        'stamps', coalesce((select sum(l.quantity) filter (where l.counts_for_stamps) from public.order_lines l where l.order_id = o.id), 0)
      ) order by o.member_attached_at desc, o.id)
      from public.orders o join public.stores s on s.id = o.store_id
      where o.member_login_id = v_login.id and o.brand_id = v_brand and o.member_attached_at > p_at - interval '7 days'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.customer_stamp_card(timestamptz) is 'the customer''s stamp card at the app''s brand: on or off, the stamps toward the next reward, how many make one, the reward''s name, all stamps earned, the available rewards, the last 20 ledger entries with order numbers, and the counter orders attached to the card in the last 7 days (C20 frame 5: the number, the store, the state and the drinks that earn on completion; a misuse shows here); 42501 without a customer session';

-- 8. Public wrappers and grants -------------------------------------------------------------------------------------

create function public.customer_stamp_code()
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_stamp_code(now()); $$;
comment on function public.customer_stamp_code() is 'RPC for the customer Mini App (C20): app.customer_stamp_code at the current time';

create function public.counter_member_lookup(p_store uuid, p_code text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_member_lookup(p_store, p_code, now()); $$;
comment on function public.counter_member_lookup(uuid, text) is 'RPC for the counter web app (Q01): app.counter_member_lookup at the current time';

create function public.counter_attach_member(p_order uuid, p_code text, p_expected_version integer)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_attach_member(p_order, p_code, p_expected_version, now()); $$;
comment on function public.counter_attach_member(uuid, text, integer) is 'RPC for the counter web app (Q01): app.counter_attach_member at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('luhn_check_digit', 'stamp_code_hash', 'stamp_code_parse', 'stamp_code_mistyped', 'stamp_code_find', 'stamp_member_summary', 'customer_stamp_code',
        'counter_member_lookup', 'counter_attach_member')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_stamp_code(), public.counter_member_lookup(uuid, text), public.counter_attach_member(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.customer_stamp_code(), public.counter_member_lookup(uuid, text), public.counter_attach_member(uuid, text, integer) to authenticated;
