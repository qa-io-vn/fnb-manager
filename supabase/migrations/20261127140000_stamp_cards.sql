-- The native till, step 5 (ADR-061, native-till.md section 10): the stamp card on the customer's Zalo account. One
-- stamp per drink when an order completes, no phone needed; a reward (a free drink) for every stamps_per_reward
-- stamps (9 by default); the reward taken off a later order at placement and given back if that order is cancelled;
-- a refund takes back the order's stamps in proportion to the money refunded, voiding an unused reward when needed.
-- The existing loyalty ledger is keyed by a phone membership and a synced invoice with its own earn rules, so the
-- native card is its own small ledger keyed by brand and customer login (a deviation recorded in the design).

-- 1. Settings, cards, rewards and the ledger ----------------------------------------------------------------------

create table public.stamp_card_settings (
  brand_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  enabled boolean not null default true,
  stamps_per_reward integer not null default 9 check (stamps_per_reward between 2 and 30),
  reward_name text not null default 'Ly miễn phí' check (app.native_text_valid(reward_name, 60)),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, brand_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table public.stamp_card_settings is 'a brand''s native stamp card: on or off, how many stamps make a reward (9 by default: the 10th drink free) and the reward''s name; a brand without a row uses the defaults';

create table public.stamp_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  stamps integer not null default 0 check (stamps >= 0),
  total_earned integer not null default 0 check (total_earned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, customer_login_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table public.stamp_cards is 'the stamp card of a customer''s Zalo account at a brand (no phone needed): the stamps toward the next reward and all stamps ever earned; written only by the ledger functions; removed with the login';

create table public.stamp_rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  card_id uuid not null,
  status text not null check (status in ('available', 'used', 'void')),
  stamps integer not null check (stamps between 2 and 30),
  issued_at timestamptz not null,
  issued_order_id uuid,
  used_order_id uuid,
  used_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or (char_length(void_reason) between 1 and 200 and void_reason !~ '[[:cntrl:]]')),
  unique (tenant_id, id),
  foreign key (tenant_id, card_id) references public.stamp_cards (tenant_id, id) on delete cascade,
  check ((status = 'used') = (used_order_id is not null and used_at is not null)),
  check ((status = 'void') = (voided_at is not null))
);

create index stamp_rewards_card_idx on public.stamp_rewards (card_id, status, issued_at);
create unique index stamp_rewards_used_order_key on public.stamp_rewards (used_order_id) where used_order_id is not null;
create index stamp_rewards_tenant_idx on public.stamp_rewards (tenant_id);

comment on table public.stamp_rewards is 'the rewards of a stamp card (a free drink) with the stamps they took: available, used on an order (at most one per order), or void when a refund took back the stamps that made it';

create table public.stamp_entries (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  card_id uuid not null,
  order_id uuid,
  reward_id uuid,
  kind text not null check (kind in ('order_earned', 'order_reversed', 'reward_issued', 'reward_used', 'reward_returned', 'reward_voided')),
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  actor_kind text not null check (actor_kind in ('customer', 'staff', 'system', 'provider')),
  actor_user_id uuid,
  note text check (note is null or (char_length(note) between 1 and 200 and note !~ '[[:cntrl:]]')),
  occurred_at timestamptz not null,
  foreign key (tenant_id, card_id) references public.stamp_cards (tenant_id, id) on delete cascade,
  check (kind <> 'order_earned' or (delta > 0 and order_id is not null)),
  check (kind <> 'order_reversed' or (delta <= 0 and order_id is not null)),
  check (kind not in ('reward_issued', 'reward_used', 'reward_returned', 'reward_voided') or reward_id is not null)
);

create unique index stamp_entries_earned_key on public.stamp_entries (order_id) where kind = 'order_earned';
create index stamp_entries_card_idx on public.stamp_entries (card_id, id);
create index stamp_entries_order_idx on public.stamp_entries (order_id) where order_id is not null;
create index stamp_entries_tenant_idx on public.stamp_entries (tenant_id);

comment on table public.stamp_entries is 'the append-only ledger of the stamp cards: stamps earned by a completed order (once per order), taken back by a refund, spent on a reward, and the rewards used, returned and voided, each with the balance after it and who caused it; no role changes or deletes a row';

create function app.keep_stamp_entries()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.tenants t where t.id = old.tenant_id)
    or not exists (select 1 from public.stamp_cards c where c.id = old.card_id)
  ) then
    return old;
  end if;
  raise exception 'stamp_entries is an append-only ledger' using errcode = '42501';
end;
$$;

comment on function app.keep_stamp_entries() is 'trigger refusing every update and delete of the stamp ledger; only the deletion of the card (with the customer''s login) or the tenant removes rows';

create trigger stamp_entries_append_only before update or delete on public.stamp_entries for each row execute function app.keep_stamp_entries();
create trigger stamp_entries_no_truncate before truncate on public.stamp_entries for each statement execute function app.refuse_order_events_truncate();
create trigger stamp_cards_set_updated_at before update on public.stamp_cards for each row execute function app.set_updated_at();
create trigger stamp_card_settings_set_updated_at before update on public.stamp_card_settings for each row execute function app.set_updated_at();
create trigger stamp_card_settings_keep_created_by before update on public.stamp_card_settings for each row execute function app.keep_created_by();
create trigger stamp_card_settings_set_updated_by before insert or update on public.stamp_card_settings for each row execute function app.set_updated_by();
create trigger stamp_card_settings_keys before update on public.stamp_card_settings for each row execute function app.menu_keys_fixed();

alter table public.stamp_card_settings enable row level security;
alter table public.stamp_cards enable row level security;
alter table public.stamp_rewards enable row level security;
alter table public.stamp_entries enable row level security;

create policy stamp_card_settings_select on public.stamp_card_settings
  for select to authenticated using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy stamp_card_settings_insert on public.stamp_card_settings
  for insert to authenticated with check (app.brand_in_scope(tenant_id, brand_id, array['owner', 'manager']::public.tenant_role[]));
create policy stamp_card_settings_update on public.stamp_card_settings
  for update to authenticated
  using (app.brand_in_scope(tenant_id, brand_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.brand_in_scope(tenant_id, brand_id, array['owner', 'manager']::public.tenant_role[]));
create policy stamp_cards_select on public.stamp_cards
  for select to authenticated using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy stamp_rewards_select on public.stamp_rewards
  for select to authenticated using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy stamp_entries_select on public.stamp_entries
  for select to authenticated using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));

revoke all on public.stamp_card_settings, public.stamp_cards, public.stamp_rewards, public.stamp_entries from anon, authenticated;
grant select on public.stamp_card_settings, public.stamp_cards, public.stamp_rewards, public.stamp_entries to authenticated;
grant insert (brand_id, tenant_id, enabled, stamps_per_reward, reward_name), update (enabled, stamps_per_reward, reward_name)
  on public.stamp_card_settings to authenticated;

-- 2. The ledger functions -------------------------------------------------------------------------------------------

create function app.stamp_settings(p_brand_id uuid)
returns table (enabled boolean, stamps_per_reward integer, reward_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.enabled, true), coalesce(s.stamps_per_reward, 9), coalesce(s.reward_name, 'Ly miễn phí')
  from (select 1) as one
  left join public.stamp_card_settings s on s.brand_id = p_brand_id;
$$;

comment on function app.stamp_settings(uuid) is 'a brand''s stamp card settings, the defaults (on, 9 stamps, Ly miễn phí) without a row';

create function app.stamp_card_for(p_tenant_id uuid, p_brand_id uuid, p_login_id uuid)
returns public.stamp_cards
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_card public.stamp_cards;
begin
  insert into public.stamp_cards (tenant_id, brand_id, customer_login_id) values (p_tenant_id, p_brand_id, p_login_id)
  on conflict (brand_id, customer_login_id) do nothing;
  select c.* into strict v_card from public.stamp_cards c where c.brand_id = p_brand_id and c.customer_login_id = p_login_id for update;
  return v_card;
end;
$$;

comment on function app.stamp_card_for(uuid, uuid, uuid) is 'the stamp card of a customer login at a brand, created on first use and locked for the caller''s transaction';

create function app.stamp_entry(p_card_id uuid, p_kind text, p_delta integer, p_order_id uuid, p_reward_id uuid, p_actor_kind text, p_actor uuid,
  p_note text, p_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_card public.stamp_cards;
begin
  update public.stamp_cards c
  set stamps = c.stamps + p_delta,
      total_earned = c.total_earned + case when p_kind = 'order_earned' then p_delta else 0 end
  where c.id = p_card_id
  returning c.* into v_card;
  insert into public.stamp_entries (tenant_id, brand_id, card_id, order_id, reward_id, kind, delta, balance_after, actor_kind, actor_user_id, note, occurred_at)
  values (v_card.tenant_id, v_card.brand_id, v_card.id, p_order_id, p_reward_id, p_kind, p_delta, v_card.stamps, p_actor_kind, p_actor, p_note, p_at);
  return v_card.stamps;
end;
$$;

comment on function app.stamp_entry(uuid, text, integer, uuid, uuid, text, uuid, text, timestamptz) is 'the one writer of the stamp ledger: moves the card''s balance (and its lifetime total for an earn) and appends the entry with the balance after it';

create function app.stamps_on_completion(p_order public.orders, p_at timestamptz)
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
begin
  if p_order.customer_login_id is null then
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
  v_card := app.stamp_card_for(p_order.tenant_id, p_order.brand_id, p_order.customer_login_id);
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

comment on function app.stamps_on_completion(public.orders, timestamptz) is 'the stamps of a completed order of a customer''s Zalo account: one per drink (the quantity of its lines that count for stamps, less the free drink of a used reward), once per order; every full card of stamps_per_reward becomes an available reward';

create function app.stamps_on_refund(p_order public.orders, p_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_earned integer;
  v_reversed integer;
  v_money record;
  v_target integer;
  v_need integer;
  v_card public.stamp_cards;
  v_reward public.stamp_rewards;
  v_take integer;
  v_card_id uuid;
begin
  select e.delta, e.card_id into v_earned, v_card_id from public.stamp_entries e where e.order_id = p_order.id and e.kind = 'order_earned';
  if v_earned is null then
    return 0;
  end if;
  select m.* into v_money from app.order_money(p_order.id) m;
  if v_money.paid <= 0 then
    return 0;
  end if;
  v_target := least(v_earned, round(v_earned * v_money.refunded / v_money.paid)::integer);
  select coalesce(-sum(e.delta), 0)::integer into v_reversed from public.stamp_entries e where e.order_id = p_order.id and e.kind = 'order_reversed';
  v_need := v_target - v_reversed;
  if v_need <= 0 then
    return 0;
  end if;
  select c.* into v_card from public.stamp_cards c where c.id = v_card_id for update;
  while v_card.stamps < v_need loop
    select r.* into v_reward from public.stamp_rewards r
    where r.card_id = v_card.id and r.status = 'available'
    order by r.issued_at desc, r.id desc limit 1 for update;
    exit when v_reward.id is null;
    update public.stamp_rewards r set status = 'void', voided_at = p_at, void_reason = 'order refunded' where r.id = v_reward.id;
    perform app.stamp_entry(v_card.id, 'reward_voided', v_reward.stamps, p_order.id, v_reward.id, 'system', null, null, p_at);
    select c.* into v_card from public.stamp_cards c where c.id = v_card.id;
    v_reward := null;
  end loop;
  v_take := least(v_need, v_card.stamps);
  perform app.stamp_entry(v_card.id, 'order_reversed', -v_take, p_order.id, null, 'system', null,
    case when v_take < v_need then 'shortfall ' || (v_need - v_take) end, p_at);
  return v_take;
end;
$$;

comment on function app.stamps_on_refund(public.orders, timestamptz) is 'takes back the stamps of a refunded order in proportion to the money refunded (rounded to the nearest stamp, half up; all of them for a full refund), voiding the newest unused rewards when the balance is short; a reward already used cannot be taken back, so what is still missing is noted as a shortfall for the manager';

create function app.stamps_on_cancel(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reward public.stamp_rewards;
begin
  for v_reward in select r.* from public.stamp_rewards r where r.used_order_id = p_order.id and r.status = 'used' for update loop
    update public.stamp_rewards r set status = 'available', used_order_id = null, used_at = null where r.id = v_reward.id;
    perform app.stamp_entry(v_reward.card_id, 'reward_returned', 0, p_order.id, v_reward.id, 'system', null, null, p_at);
  end loop;
end;
$$;

comment on function app.stamps_on_cancel(public.orders, timestamptz) is 'gives back the reward a cancelled order had used';

create or replace function app.order_after_completion(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.stamps_on_completion(p_order, p_at);
end;
$$;

create or replace function app.order_after_refund(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.stamps_on_refund(p_order, p_at);
end;
$$;

create function app.order_after_cancel(p_order public.orders, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.stamps_on_cancel(p_order, p_at);
end;
$$;

comment on function app.order_after_completion(public.orders, timestamptz) is 'the hook run when an order is completed: its stamps (step 5); the sales facts are added in step 6';
comment on function app.order_after_refund(public.orders, timestamptz) is 'the hook run after a refund succeeds: the order''s stamps are taken back (step 5); the invoice is adjusted in step 6';
comment on function app.order_after_cancel(public.orders, timestamptz) is 'the hook run when an order is cancelled: a reward it used is given back';

-- 3. The customer's card ----------------------------------------------------------------------------------------

create function app.customer_stamp_card(p_at timestamptz default now())
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
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.customer_stamp_card(timestamptz) is 'the customer''s stamp card at the brand of the app: stamps toward the next reward, how many make one, the available rewards and the last 20 entries; an empty card before the first stamp; 42501 without a customer session';

-- 5. Orders: the reward at placement, returned on cancellation -------------------------------------------------

create or replace function app.order_request_shape(p_request jsonb, p_counter boolean)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed text[] := case when p_counter
    then array['request_id', 'type', 'table_id', 'lines', 'note', 'expected_total']
    else array['request_id', 'store', 'type', 'table_token', 'pickup_at', 'lines', 'note', 'payment', 'expected_total', 'menu_version', 'use_reward'] end;
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
  if p_request ? 'use_reward' and jsonb_typeof(p_request -> 'use_reward') not in ('boolean', 'null') then
    raise exception 'use_reward is true or false' using errcode = '22023';
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

create or replace function app.customer_check_cart(p_request jsonb, p_at timestamptz default now())
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
  v_login app.customer_logins;
  v_discount numeric := 0;
  v_reward text;
begin
  perform app.order_request_shape(p_request || jsonb_build_object('request_id', '00000000-0000-0000-0000-000000000000', 'payment', coalesce(p_request ->> 'payment', 'counter'), 'expected_total', coalesce(p_request -> 'expected_total', '0'::jsonb)), false);
  select c.* into v_ctx from app.customer_menu_store(p_request ->> 'store') c;
  select s.* into v_store from public.stores s where s.id = v_ctx.store_id;
  v_priced := app.order_price_lines(v_store.id, v_ctx.brand_id, p_request ->> 'type', p_request -> 'lines', p_at);
  if (v_priced ->> 'ok')::boolean and jsonb_typeof(p_request -> 'use_reward') = 'boolean' and (p_request ->> 'use_reward')::boolean then
    begin
      v_login := app.customer_session();
    exception when insufficient_privilege then
      v_login := null;
    end;
    if not exists (select 1 from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id
                   where c.brand_id = v_ctx.brand_id and c.customer_login_id = v_login.id and r.status = 'available') then
      v_reward := 'no_reward';
    else
      select min((l ->> 'unit_price')::numeric) into v_discount
      from jsonb_array_elements(v_priced -> 'lines') as x (l)
      where (l ->> 'counts_for_stamps')::boolean;
      v_reward := case when v_discount is null then 'reward_not_applicable' else 'applied' end;
      v_discount := coalesce(v_discount, 0);
    end if;
  end if;
  return jsonb_build_object(
    'state', case when (v_priced ->> 'ok')::boolean then 'ok' else 'refused' end,
    'refusal', v_priced ->> 'refusal',
    'unavailable_items', coalesce(v_priced -> 'unavailable_items', '[]'::jsonb),
    'bad_lines', case when v_priced ->> 'refusal' = 'option_invalid' then v_priced -> 'lines' else '[]'::jsonb end,
    'lines', case when (v_priced ->> 'ok')::boolean then v_priced -> 'lines' else '[]'::jsonb end,
    'subtotal', (v_priced ->> 'subtotal')::bigint,
    'discount_amount', v_discount::bigint,
    'total', ((v_priced ->> 'subtotal')::numeric - v_discount)::bigint,
    'reward', v_reward,
    'menu_version', app.menu_version(v_ctx.brand_id),
    'ordering', app.ordering_state(v_store.id, p_request ->> 'type', p_at)
  );
end;
$$;

comment on function app.customer_check_cart(jsonb, timestamptz) is 'prices a basket without writing anything, for the confirmation step: the lines, the subtotal, with use_reward the discount of the customer''s stamp reward (reward applied, no_reward, reward_not_applicable) and the total the server would charge, or the items that went unavailable and the lines with invalid options, the menu version and the ordering state; the same request shape as customer_place_order (request_id, payment and expected_total optional)';

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
    app.store_business_date(v_store.id, p_at),
    case when v_status = 'accepted' then app.next_order_no(v_store.id, app.store_business_date(v_store.id, p_at)) end,
    v_status, case when v_total = 0 then 'paid' else 'unpaid' end::public.order_payment_status, v_payment, (v_priced ->> 'subtotal')::numeric, v_discount, v_total, app.order_note(p_request -> 'note'), v_request_id, v_hash,
    coalesce((p_request ->> 'menu_version')::bigint, app.menu_version(v_ctx.brand_id)),
    p_at, case when v_status = 'awaiting_payment' then p_at + make_interval(mins => v_settings.payment_window_minutes) end,
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

comment on function app.customer_place_order(jsonb, timestamptz) is 'the customer''s order (native-till.md 5.3), writing nothing until every check passes: the shape (22023), the session (42501), the replay (the same request_id answers the first order, replayed true; another request under it request_conflict; parallel calls serialised by an advisory lock), the store of the brand (22023), the ordering state''s reason, blocked, rate_limited (20 calls of a customer and 200 of a store in 15 minutes), too_many_open_orders (3), the table token (table_unknown) or the pickup time, payment_not_allowed (takeaway is prepaid online), item_unavailable or option_invalid, with use_reward the customer''s oldest stamp reward (no_reward, reward_not_applicable without a drink) taken off as the cheapest drink''s size price, amount_over_limit, price_changed with the total; then the order with its priced lines and its first event, the reward marked used: accepted with its number and payment unpaid for the counter, awaiting_payment until payment_due_at for an online method; an order the reward makes free (total 0) is accepted and paid at once, logged as paid by reward';

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
    case when p_to = 'cancelled' and p_order.payment_status = 'paid' and p_order.total > 0 then p_order.total end, p_at);
  if p_to = 'cancelled' and p_order.payment_status = 'paid' and p_order.total = 0 then
    v_order := app.order_settle_payment_status(v_order.id, p_at);
  elsif p_to = 'cancelled' and p_order.payment_status = 'paid' then
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
  if p_to = 'cancelled' then
    perform app.order_after_cancel(v_order, p_at);
  end if;
  if p_to = 'completed' then
    perform app.order_after_completion(v_order, p_at);
  end if;
  return v_order;
end;
$$;

-- 6. Public wrappers and grants ----------------------------------------------------------------------------------

create function public.customer_stamp_card()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_stamp_card(now()); $$;
comment on function public.customer_stamp_card() is 'RPC for the customer Mini App: app.customer_stamp_card at the current time';

comment on function app.order_move(public.orders, public.order_status, text, text, uuid, text, text, timestamptz) is 'the one writer of an order''s lifecycle: moves it, gives it its number when it is accepted, moves its version and change cursor, stamps the step''s time; a cancellation records who and why, gives back a stamp reward the order used and, for a paid order, opens a due refund of what was paid (with its event and amount; a free order has nothing to hand back and becomes unpaid); a completion runs the completion hook (stamps, sales facts); callers check that the transition is in the lifecycle';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('keep_stamp_entries', 'stamp_settings', 'stamp_card_for', 'stamp_entry', 'stamps_on_completion', 'stamps_on_refund',
        'stamps_on_cancel', 'order_after_completion', 'order_after_refund', 'order_after_cancel', 'customer_stamp_card', 'order_request_shape',
        'customer_place_order', 'customer_check_cart', 'order_move')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_stamp_card() from public, anon, service_role;
grant execute on function public.customer_stamp_card() to authenticated;
