-- Online payment for native orders (ADR-062, ADR-067, ADR-068; native-till.md section 6): the providers a brand or
-- store switches on (the Checkout SDK for e-wallets, a dynamic VietQR watched by a bank-notification service), each
-- online attempt's reference and provider details, the one settlement every verified notification and re-query goes
-- through, the manager queue for money that cannot be applied (late, partial, duplicate, unknown), and the minute job
-- that expires attempts and wakes the payments-job Edge Function. Secrets stay in Edge Function secrets; rows name
-- them. Nothing here trusts a client: the attempt's amount is the order's total, and only a verified notification of
-- that exact amount, in time, for an unpaid order, pays it.

-- 1. Helpers ------------------------------------------------------------------------------------------------------

create function app.checkout_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid end;
$$;

comment on function app.checkout_uuid(text) is 'a text as a uuid, or null when it is not one (request fields are checked, never cast blindly)';

create function app.payment_secret_name_valid(p_name text, p_prefix text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text;
begin
  if p_name is null or p_prefix is null or p_name !~ '^(ZALO|PAYMENT)_[A-Z0-9_]{1,60}$'
     or not starts_with(p_name, p_prefix) or char_length(p_name) <= char_length(p_prefix) then
    return false;
  end if;
  foreach v_segment in array string_to_array(p_name, '_') loop
    if v_segment = '' or char_length(v_segment) > 16 or (v_segment ~ '[0-9]' and char_length(v_segment) > 8) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.payment_secret_name_valid(text, text) is 'whether a provider row may name this function secret: a ZALO_ or PAYMENT_ name with its column''s prefix (ZALO_CHECKOUT_KEY_ for the Checkout SDK, PAYMENT_BANK_ for a bank service), and no segment shaped like a value (longer than 16 characters, or longer than 8 with a digit), so a pasted key is refused';

create function app.payment_provider_valid(p_method text, p_adapter text, p_secret_name text, p_settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case
    when p_method = 'zalo_checkout' then
      p_adapter = 'zalo_checkout'
      and app.payment_secret_name_valid(p_secret_name, 'ZALO_CHECKOUT_KEY_')
      and jsonb_typeof(p_settings) = 'object'
      and (select coalesce(bool_and(k in ('wallet_method')), true) from jsonb_object_keys(p_settings) k)
      and (p_settings -> 'wallet_method' is null or jsonb_typeof(p_settings -> 'wallet_method') = 'null'
        or p_settings ->> 'wallet_method' in ('ZALOPAY', 'MOMO', 'VNPAY', 'ATM', 'CC', 'PAYME_CC', 'PAYME_ATM'))
    when p_method = 'vietqr' then
      p_adapter in ('sepay', 'mock')
      and app.payment_secret_name_valid(p_secret_name, 'PAYMENT_BANK_')
      and jsonb_typeof(p_settings) = 'object'
      and (select coalesce(bool_and(k in ('bank_bin', 'bank_name', 'account_number', 'account_name', 'reference_prefix')), true)
           from jsonb_object_keys(p_settings) k)
      and coalesce(p_settings ->> 'bank_bin', '') ~ '^[0-9]{6}$'
      and coalesce(p_settings ->> 'account_number', '') ~ '^[0-9A-Za-z]{1,19}$'
      and coalesce(p_settings ->> 'account_name', '') ~ '^[A-Z0-9 .-]{1,50}$'
      and char_length(btrim(coalesce(p_settings ->> 'bank_name', ''))) between 1 and 40
      and coalesce(p_settings ->> 'bank_name', '') !~ '[[:cntrl:]]'
      and coalesce(p_settings ->> 'reference_prefix', '') ~ '^[A-Z]{2,4}$'
    else false
  end, false);
$$;

comment on function app.payment_provider_valid(text, text, text, jsonb) is 'whether a provider row is complete: the Checkout SDK with its ZALO_CHECKOUT_KEY_ secret and an optional forced wallet; a VietQR with a bank adapter (sepay, mock), its PAYMENT_BANK_ secret, the bank BIN, the bank''s name, the account number, the account name as banks print it (capitals without accents) and a reference prefix of 2 to 4 capitals; no other setting';

create function app.user_has_store_scope(p_user_id uuid, p_tenant_id uuid, p_store_id uuid, p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.tenant_members m
    join public.stores s on s.tenant_id = m.tenant_id and s.id = p_store_id
    where m.tenant_id = p_tenant_id
      and m.user_id = p_user_id
      and m.role = any (p_roles)
      and (m.store_ids is null or p_store_id = any (m.store_ids))
  );
$$;

comment on function app.user_has_store_scope(uuid, uuid, uuid, public.tenant_role[]) is 'app.has_store_scope for a user the payment functions name after verifying the session (they run as the service role, without auth.uid())';

-- 2. Providers ----------------------------------------------------------------------------------------------------

create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  store_id uuid,
  method text not null check (method in ('zalo_checkout', 'vietqr')),
  adapter text not null check (adapter in ('zalo_checkout', 'sepay', 'mock')),
  mode text not null default 'off' check (mode in ('off', 'sandbox', 'live')),
  secret_name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (method <> 'zalo_checkout' or store_id is null),
  check (adapter <> 'mock' or mode <> 'live'),
  check (app.payment_provider_valid(method, adapter, secret_name, settings))
);

create unique index payment_providers_scope_key on public.payment_providers (brand_id, method, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index payment_providers_tenant_idx on public.payment_providers (tenant_id);
create index payment_providers_store_idx on public.payment_providers (store_id) where store_id is not null;

comment on table public.payment_providers is 'the online payment providers a brand (or one of its stores, for a VietQR account of its own) switched on (ADR-067): the method, the adapter, the mode (off, sandbox, live), the name of the Edge Function secret holding its key (never the key) and its public settings; the most specific row decides; written only by checkout_set_provider (an owner with every store of the brand), read by its owners and managers';
comment on column public.payment_providers.secret_name is 'the Edge Function secret with the key: ZALO_CHECKOUT_KEY_<BRAND> (the Checkout SDK private key) or PAYMENT_BANK_<NAME> (the bank service''s webhook key)';
comment on column public.payment_providers.settings is 'public settings: wallet_method for the Checkout SDK; bank_bin, bank_name, account_number, account_name and reference_prefix for a VietQR (shown to customers on the QR anyway)';

create table public.payment_provider_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider_id uuid not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null,
  before jsonb,
  after jsonb not null,
  foreign key (tenant_id, provider_id) references public.payment_providers (tenant_id, id) on delete cascade
);

create index payment_provider_changes_provider_idx on public.payment_provider_changes (provider_id, id);
create index payment_provider_changes_tenant_idx on public.payment_provider_changes (tenant_id);

comment on table public.payment_provider_changes is 'the append-only log of every provider change with who, when, before and after (a changed bank account redirects customers'' money, so every change is kept); no role changes or deletes a row';

create function app.payment_provider_changes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the provider change log is append-only' using errcode = '42501';
end;
$$;

create trigger payment_provider_changes_append_only before update or delete on public.payment_provider_changes
  for each row execute function app.payment_provider_changes_append_only();

alter table public.payment_providers enable row level security;
alter table public.payment_provider_changes enable row level security;
create policy payment_providers_select on public.payment_providers
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy payment_provider_changes_select on public.payment_provider_changes
  for select to authenticated
  using (exists (select 1 from public.payment_providers p where p.id = provider_id
    and app.has_store_scope(p.tenant_id, p.store_id, array['owner', 'manager']::public.tenant_role[])));
revoke all on public.payment_providers, public.payment_provider_changes from anon, authenticated;
grant select on public.payment_providers, public.payment_provider_changes to authenticated;

create function app.payment_provider_for(p_brand_id uuid, p_store_id uuid, p_method text)
returns public.payment_providers
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from (
    select p.*
    from public.payment_providers p
    join public.brands b on b.id = p.brand_id
    where p.brand_id = p_brand_id
      and p.method = p_method
      and p_store_id = any (b.store_ids)
      and (p.store_id = p_store_id or p.store_id is null)
    order by (p.store_id is not null) desc
    limit 1
  ) r
  where r.mode <> 'off';
$$;

comment on function app.payment_provider_for(uuid, uuid, text) is 'the provider a store of a brand uses for a method: the most specific row (the store''s, else the brand''s), and only while its mode is not off';

create function app.payment_online_methods(p_store_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.method order by m.sort), '{}'::text[])
  from (values ('zalo_checkout', 1), ('vietqr', 2)) as m (method, sort)
  where exists (
    select 1 from public.brands b
    where p_store_id = any (b.store_ids)
      and (app.payment_provider_for(b.id, p_store_id, m.method)).id is not null
  );
$$;

comment on function app.payment_online_methods(uuid) is 'the online methods whose provider is on for a store';

create function app.payment_methods_for_store(p_store_id uuid, p_current text[], p_exact boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(array(
    select m from unnest(array['counter', 'zalo_checkout', 'vietqr']) with ordinality as x (m, n)
    where (m = 'counter' and 'counter' = any (coalesce(p_current, array['counter'])))
       or m = any (app.payment_online_methods(p_store_id))
       or (not p_exact and m = any (coalesce(p_current, '{}'::text[])))
    order by n
  ), '{}'::text[]), array['counter']);
$$;

comment on function app.payment_methods_for_store(uuid, text[], boolean) is 'a store''s payment methods: counter as it was set, and each online method whose provider is on; exact drops an online method whose provider is off (a provider change), otherwise the ones already set are kept (a new settings row)';

create function app.store_ordering_payment_methods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.payment_methods := app.payment_methods_for_store(new.store_id, new.payment_methods, false);
  return new;
end;
$$;

create trigger store_ordering_settings_payment_methods before insert on public.store_ordering_settings
  for each row execute function app.store_ordering_payment_methods();

comment on function app.store_ordering_payment_methods() is 'a new store settings row offers the online methods whose providers are already on';

create function app.payment_methods_sync(p_brand_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.store_ordering_settings s
  set payment_methods = app.payment_methods_for_store(s.store_id, s.payment_methods, true)
  from public.brands b
  where b.id = p_brand_id and s.store_id = any (b.store_ids)
    and s.payment_methods is distinct from app.payment_methods_for_store(s.store_id, s.payment_methods, true);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.payment_methods_sync(uuid) is 'sets the payment methods of every store of a brand from its providers; answers how many stores changed';

create function app.payment_provider_json(p_provider public.payment_providers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_provider.id is null then null else jsonb_build_object(
    'id', p_provider.id, 'brand_id', p_provider.brand_id, 'store_id', p_provider.store_id, 'method', p_provider.method,
    'adapter', p_provider.adapter, 'mode', p_provider.mode, 'secret_name', p_provider.secret_name, 'settings', p_provider.settings,
    'app_id', case when p_provider.method = 'zalo_checkout' then (
      select a.external_id from public.mini_apps a where a.brand_id = p_provider.brand_id and a.kind = 'customer') end)
  end;
$$;

comment on function app.payment_provider_json(public.payment_providers) is 'a provider as the payment functions read it: the row and, for the Checkout SDK, the customer Mini App''s id';

create function app.checkout_set_provider(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_brand public.brands;
  v_store_id uuid;
  v_method text;
  v_adapter text;
  v_mode text;
  v_secret text;
  v_settings jsonb;
  v_before public.payment_providers;
  v_after public.payment_providers;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'a provider is a JSON object' using errcode = '22023';
  end if;
  select b.* into v_brand from public.brands b where b.id = app.checkout_uuid(p_request ->> 'brand');
  if v_brand.id is null or v_uid is null
     or not app.brand_in_scope(v_brand.tenant_id, v_brand.id, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store of the brand sets its payment providers' using errcode = '42501';
  end if;
  v_store_id := app.checkout_uuid(p_request ->> 'store');
  if p_request ->> 'store' is not null and (v_store_id is null or not v_store_id = any (v_brand.store_ids)) then
    raise exception 'the store must be one of the brand''s' using errcode = '22023';
  end if;
  v_method := p_request ->> 'method';
  v_adapter := coalesce(p_request ->> 'adapter', case when v_method = 'zalo_checkout' then 'zalo_checkout' end);
  v_mode := p_request ->> 'mode';
  v_secret := p_request ->> 'secret_name';
  v_settings := coalesce(p_request -> 'settings', '{}'::jsonb);
  if v_method is null or v_method not in ('zalo_checkout', 'vietqr') or v_mode is null or v_mode not in ('off', 'sandbox', 'live')
     or (v_method = 'zalo_checkout' and v_store_id is not null) or (v_adapter = 'mock' and v_mode = 'live')
     or not app.payment_provider_valid(v_method, v_adapter, v_secret, v_settings) then
    raise exception 'a provider names its method, adapter, mode (off, sandbox, live), its secret''s name and complete settings; the Checkout SDK is per brand; a mock never runs live' using errcode = '22023';
  end if;
  select p.* into v_before from public.payment_providers p
  where p.brand_id = v_brand.id and p.method = v_method and p.store_id is not distinct from v_store_id
  for update;
  if v_before.id is null then
    insert into public.payment_providers (tenant_id, brand_id, store_id, method, adapter, mode, secret_name, settings, created_by, created_at, updated_by, updated_at)
    values (v_brand.tenant_id, v_brand.id, v_store_id, v_method, v_adapter, v_mode, v_secret, v_settings, v_uid, p_at, v_uid, p_at)
    returning * into v_after;
  elsif (v_before.adapter, v_before.mode, v_before.secret_name, v_before.settings) is not distinct from (v_adapter, v_mode, v_secret, v_settings) then
    return jsonb_build_object('state', 'unchanged', 'provider', app.payment_provider_json(v_before),
      'webhook_path', case when v_method = 'vietqr' then 'bank-webhook/' || v_before.id end);
  else
    update public.payment_providers p
    set adapter = v_adapter, mode = v_mode, secret_name = v_secret, settings = v_settings, updated_by = v_uid, updated_at = p_at
    where p.id = v_before.id
    returning * into v_after;
  end if;
  insert into public.payment_provider_changes (tenant_id, provider_id, changed_by, changed_at, before, after)
  values (v_after.tenant_id, v_after.id, v_uid, p_at,
    case when v_before.id is not null then to_jsonb(v_before) - array['created_by', 'created_at', 'updated_by', 'updated_at'] end,
    to_jsonb(v_after) - array['created_by', 'created_at', 'updated_by', 'updated_at']);
  perform app.payment_methods_sync(v_brand.id);
  return jsonb_build_object('state', 'saved', 'provider', app.payment_provider_json(v_after),
    'webhook_path', case when v_method = 'vietqr' then 'bank-webhook/' || v_after.id end);
end;
$$;

comment on function app.checkout_set_provider(jsonb, timestamptz) is 'an owner with every store of the brand switches a provider on (sandbox, live) or off and sets its adapter, secret name and settings: the Checkout SDK per brand, a VietQR per brand or per store; every change is logged with before and after, and the stores'' payment methods follow at once; answers the row and, for a VietQR, the bank-webhook path to give the bank service';

create function app.counter_payment_methods(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only staff of the store read its payment methods' using errcode = '42501';
  end if;
  return jsonb_build_object('methods', to_jsonb(app.payment_online_methods(v_store.id)),
    'vietqr_mode', (select p.mode from public.brands b, app.payment_provider_for(b.id, v_store.id, 'vietqr') p
      where v_store.id = any (b.store_ids) and p.id is not null limit 1));
end;
$$;

comment on function app.counter_payment_methods(uuid) is 'the online methods the counter may take at a store (VietQR for a walk-in), whether or not the store takes orders in the app; staff, managers and owners of the store';

-- 3. Attempts, exceptions and the job ----------------------------------------------------------------------------

create table app.payment_attempts (
  payment_id uuid primary key references public.order_payments (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  provider_id uuid not null references public.payment_providers (id) on delete restrict,
  adapter text not null,
  mode text not null check (mode in ('sandbox', 'live')),
  reference text not null unique check (reference ~ '^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$'),
  actor text not null check (actor in ('customer', 'staff')),
  started_by uuid,
  expires_at timestamptz not null,
  platform_order_id text check (platform_order_id is null or platform_order_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  platform_reported_at timestamptz,
  platform_report_attempts integer not null default 0 check (platform_report_attempts between 0 and 100),
  platform_report_error text check (platform_report_error is null or (char_length(platform_report_error) between 1 and 200 and platform_report_error !~ '[[:cntrl:]]')),
  requery_count integer not null default 0 check (requery_count >= 0),
  last_requery_at timestamptz,
  created_at timestamptz not null
);

create index payment_attempts_order_idx on app.payment_attempts (order_id);
create index payment_attempts_platform_idx on app.payment_attempts (platform_order_id) where platform_order_id is not null;

comment on table app.payment_attempts is 'the provider side of each online attempt of order_payments (ADR-067): the provider row it uses, its reference (the VietQR transfer purpose, the Checkout extradata), when it expires, Zalo''s order id once the app links it, the report to Zalo of a bank-transfer popup, and the re-query count; closed to every API role';

create table app.refund_attempts (
  refund_id uuid primary key references public.order_refunds (id) on delete cascade,
  provider_refund_id text check (provider_refund_id is null or provider_refund_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  attempts integer not null default 0 check (attempts between 0 and 100),
  last_error text check (last_error is null or (char_length(last_error) between 1 and 200 and last_error !~ '[[:cntrl:]]')),
  next_at timestamptz not null,
  updated_at timestamptz not null
);

comment on table app.refund_attempts is 'the provider side of each online refund the job sends: the provider''s refund id, how many times it was sent or asked, the last error and when to try again; closed to every API role';

create table public.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  provider_id uuid not null references public.payment_providers (id) on delete cascade,
  method text not null check (method in ('zalo_checkout', 'vietqr')),
  provider_ref text not null check (char_length(provider_ref) between 1 and 100 and provider_ref !~ '[[:cntrl:][:space:]]'),
  amount numeric(14, 2) not null check (amount >= 0 and amount = trunc(amount)),
  expected_amount numeric(14, 2),
  reason text not null check (reason in ('amount_differs', 'late', 'duplicate', 'unknown_reference')),
  reference text check (reference is null or reference ~ '^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$'),
  payment_id uuid references public.order_payments (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  source text not null check (source in ('webhook', 'requery')),
  received_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'refunded', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or (char_length(resolution_note) between 1 and 200 and resolution_note !~ '[[:cntrl:]]')),
  unique (provider_id, provider_ref),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check ((status = 'open') = (resolved_at is null)),
  check (status = 'open' or resolution_note is not null)
);

create index payment_exceptions_open_idx on public.payment_exceptions (tenant_id, store_id, received_at) where status = 'open';
create index payment_exceptions_order_idx on public.payment_exceptions (order_id) where order_id is not null;

comment on table public.payment_exceptions is 'money a verified provider reported that the server did not apply to an order (ADR-068): a partial or larger transfer, money after the attempt expired or the order was cancelled, a second payment of a paid order, a reference nobody issued; never auto-confirmed; a manager hands it back and resolves it with a note; holds no payer name or account';

alter table public.payment_exceptions enable row level security;
create policy payment_exceptions_select on public.payment_exceptions
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
revoke all on public.payment_exceptions from anon, authenticated;
grant select on public.payment_exceptions to authenticated;

create table app.checkout_job_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text check (function_url is null or function_url ~ '^https?://[^[:space:]]+$'),
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 150000),
  ticket_lifetime interval not null default interval '5 minutes' check (ticket_lifetime between interval '1 minute' and interval '1 hour'),
  updated_at timestamptz not null default now()
);

insert into app.checkout_job_settings default values;

create table app.checkout_job_tickets (
  ticket uuid primary key default gen_random_uuid(),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  request_id bigint
);

comment on table app.checkout_job_settings is 'single row of the payment minute job (ADR-068): whether it wakes the payments-job function and at which URL; the expiry of attempts runs whenever the job is scheduled';
comment on table app.checkout_job_tickets is 'single-use tickets the minute job posts by id to payments-job, which claims one before it does anything';

revoke all on table app.payment_attempts, app.refund_attempts, app.checkout_job_settings, app.checkout_job_tickets
  from public, anon, authenticated, service_role;

create function app.checkout_new_reference(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_reference text;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]{2,4}$' then
    raise exception 'a reference prefix is 2 to 4 capital letters' using errcode = '22023';
  end if;
  for v_try in 1..5 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_reference := p_prefix;
    for v_index in 0..7 loop
      v_reference := v_reference || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
    end loop;
    if not exists (select 1 from app.payment_attempts a where a.reference = v_reference) then
      return v_reference;
    end if;
  end loop;
  raise exception 'no free payment reference' using errcode = '23505';
end;
$$;

comment on function app.checkout_new_reference(text) is 'a new attempt reference: the prefix and 8 characters of 2-9 and A-Z without I and O, 40 random bits, unused so far';

-- 4. Opening an attempt ------------------------------------------------------------------------------------------

create function app.checkout_attempt_json(p_payment_id uuid, p_replayed boolean, p_resumed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', 'pending', 'refusal', null, 'replayed', p_replayed, 'resumed', p_resumed,
    'payment', jsonb_build_object('id', p.id, 'order_id', p.order_id, 'method', p.method, 'amount', p.amount::bigint,
      'reference', a.reference, 'expires_at', a.expires_at, 'mode', a.mode, 'platform_order_id', a.platform_order_id),
    'provider', app.payment_provider_json(v),
    'order', jsonb_build_object(
      'store_name', s.name,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(l.size_id, l.id)::text, 'amount', l.line_total::bigint) order by l.line_no)
        from public.order_lines l where l.order_id = p.order_id), '[]'::jsonb)))
  from public.order_payments p
  join app.payment_attempts a on a.payment_id = p.id
  join public.payment_providers v on v.id = a.provider_id
  join public.stores s on s.id = p.store_id
  where p.id = p_payment_id;
$$;

comment on function app.checkout_attempt_json(uuid, boolean, boolean) is 'an attempt as checkout-order needs it: the payment, its reference and expiry, the provider row (with its secret''s name, never a secret) and the order''s store name and lines';

create function app.checkout_begin(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.checkout_uuid(p_request ->> 'user_id');
  v_order_id uuid := app.checkout_uuid(p_request ->> 'order_id');
  v_method text := p_request ->> 'method';
  v_key text := p_request ->> 'idempotency_key';
  v_for text := coalesce(p_request ->> 'for', 'customer');
  v_order public.orders;
  v_provider public.payment_providers;
  v_payment public.order_payments;
  v_start jsonb;
  v_expires timestamptz;
  v_window integer;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' or v_user is null or v_order_id is null
     or v_method is null or v_method not in ('zalo_checkout', 'vietqr') or v_for not in ('customer', 'counter')
     or (v_for = 'counter' and v_method <> 'vietqr') or v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'an attempt names the user, the order, zalo_checkout or vietqr (vietqr at the counter), for customer or counter, and an idempotency key of 8 to 100 URL-safe characters' using errcode = '22023';
  end if;
  if v_for = 'customer' then
    select o.* into v_order from public.orders o join app.customer_logins l on l.id = o.customer_login_id
    where o.id = v_order_id and l.user_id = v_user for update of o;
  else
    select o.* into v_order from public.orders o where o.id = v_order_id for update;
    if v_order.id is not null and not app.user_has_store_scope(v_user, v_order.tenant_id, v_order.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
      v_order := null;
    end if;
  end if;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order', 'replayed', false, 'payment', null);
  end if;
  select p.* into v_payment from public.order_payments p
  join app.payment_attempts a on a.payment_id = p.id
  where p.order_id = v_order.id and p.idempotency_key = v_key;
  if v_payment.id is not null then
    if v_payment.status <> 'pending' then
      return jsonb_build_object('state', 'refused', 'refusal', case v_payment.status when 'succeeded' then 'already_paid' else 'not_pending' end,
        'replayed', true, 'payment', null);
    end if;
    return app.checkout_attempt_json(v_payment.id, true, false);
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('state', 'refused', 'refusal', 'order_cancelled', 'replayed', false, 'payment', null);
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_paid', 'replayed', false, 'payment', null);
  end if;
  if v_for = 'counter' and (v_order.status not in ('accepted', 'preparing', 'ready', 'serving') or v_order.payment_status <> 'unpaid') then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_payable', 'replayed', false, 'payment', null);
  end if;
  v_provider := app.payment_provider_for(v_order.brand_id, v_order.store_id, v_method);
  if v_provider.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'provider_off', 'replayed', false, 'payment', null);
  end if;
  select p.* into v_payment from public.order_payments p
  join app.payment_attempts a on a.payment_id = p.id
  where p.order_id = v_order.id and p.status = 'pending' and p.method = v_method and a.expires_at > p_at
  order by p.requested_at desc, p.id
  limit 1;
  if v_payment.id is not null then
    return app.checkout_attempt_json(v_payment.id, true, true);
  end if;
  if v_for = 'customer' then
    v_start := app.checkout_payment_start(v_user, v_order.id, v_method, v_key, p_at);
    if v_start ->> 'state' is distinct from 'pending' then
      return jsonb_build_object('state', 'refused', 'refusal', coalesce(v_start ->> 'refusal', 'not_payable'), 'replayed', false, 'payment', null);
    end if;
    select p.* into v_payment from public.order_payments p where p.id = (v_start ->> 'payment_id')::uuid;
    v_expires := v_order.payment_due_at;
  else
    if v_order.status not in ('accepted', 'preparing', 'ready', 'serving') or v_order.payment_status <> 'unpaid' then
      return jsonb_build_object('state', 'refused', 'refusal', 'not_payable', 'replayed', false, 'payment', null);
    end if;
    if (select count(*) from public.order_payments p where p.order_id = v_order.id and p.status = 'failed') >= 3 then
      return jsonb_build_object('state', 'refused', 'refusal', 'too_many_attempts', 'replayed', false, 'payment', null);
    end if;
    -- an attempt past its expiry that the minute job has not failed yet does not hold the next one up
    if exists (select 1 from public.order_payments p join app.payment_attempts a on a.payment_id = p.id
               where p.order_id = v_order.id and p.status = 'pending' and a.expires_at > p_at) then
      return jsonb_build_object('state', 'refused', 'refusal', 'attempt_pending', 'replayed', false, 'payment', null);
    end if;
    insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, provider, idempotency_key, recorded_by, requested_at)
    values (v_order.tenant_id, v_order.store_id, v_order.id, 'vietqr', v_order.total, 'pending', 'vietqr', v_key, v_user, p_at)
    returning * into v_payment;
    perform app.order_event(v_order, 'payment', 'payment_started', 'unpaid', 'unpaid', 'staff', v_user, 'vietqr', null, v_order.total, p_at);
    select s.payment_window_minutes into v_window from public.store_ordering_settings s where s.store_id = v_order.store_id;
    v_expires := p_at + make_interval(mins => coalesce(v_window, 15));
  end if;
  insert into app.payment_attempts (payment_id, tenant_id, store_id, order_id, provider_id, adapter, mode, reference, actor, started_by, expires_at, created_at)
  values (v_payment.id, v_order.tenant_id, v_order.store_id, v_order.id, v_provider.id, v_provider.adapter, v_provider.mode,
    app.checkout_new_reference(case when v_method = 'zalo_checkout' then 'ZC' else v_provider.settings ->> 'reference_prefix' end),
    case when v_for = 'customer' then 'customer' else 'staff' end, v_user, coalesce(v_expires, p_at + interval '15 minutes'), p_at);
  return app.checkout_attempt_json(v_payment.id, false, false);
end;
$$;

comment on function app.checkout_begin(jsonb, timestamptz) is 'the server-only start of an online attempt, for checkout-order after it verified the session (ADR-067): a customer''s own order awaiting its online payment, or (for counter) a VietQR for an accepted unpaid order of a store the staff member works at; the same idempotency key answers the same attempt (replayed), a pending attempt of the method is resumed under a new key (the same reference), a new one gets a fresh reference and expires with the order''s payment window (the store''s window at the counter); refusals unknown_order, order_cancelled, already_paid, provider_off, not_awaiting_payment, method_differs, too_many_attempts, attempt_pending, not_payable, not_pending; answers the payment, the provider row and the order''s lines, never a secret';

create function app.checkout_link(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.checkout_uuid(p_request ->> 'user_id');
  v_order_id uuid := app.checkout_uuid(p_request ->> 'order_id');
  v_payment_id uuid := app.checkout_uuid(p_request ->> 'payment_id');
  v_platform text := p_request ->> 'platform_order_id';
  v_for text := coalesce(p_request ->> 'for', 'customer');
  v_order public.orders;
  v_payment public.order_payments;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' or v_user is null or v_order_id is null or v_payment_id is null
     or v_platform is null or v_platform !~ '^[A-Za-z0-9_-]{1,64}$' or v_for not in ('customer', 'counter') then
    raise exception 'a link names the user, the order, the payment and Zalo''s order id (1 to 64 URL-safe characters)' using errcode = '22023';
  end if;
  if v_for = 'customer' then
    select o.* into v_order from public.orders o join app.customer_logins l on l.id = o.customer_login_id
    where o.id = v_order_id and l.user_id = v_user;
  else
    select o.* into v_order from public.orders o where o.id = v_order_id;
    if v_order.id is not null and not app.user_has_store_scope(v_user, v_order.tenant_id, v_order.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
      v_order := null;
    end if;
  end if;
  select p.* into v_payment from public.order_payments p join app.payment_attempts a on a.payment_id = p.id
  where p.id = v_payment_id and p.order_id = v_order.id
  for update of p;
  if v_order.id is null or v_payment.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_payment');
  end if;
  if v_payment.status <> 'pending' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_pending');
  end if;
  update app.payment_attempts a set platform_order_id = v_platform where a.payment_id = v_payment.id;
  return jsonb_build_object('state', 'linked', 'refusal', null);
end;
$$;

comment on function app.checkout_link(jsonb, timestamptz) is 'the server-only link of Zalo''s order id (createOrder, or the bank-transfer popup) to a pending attempt of the caller''s order, so a lost callback can be asked about and a paid transfer reported to Zalo; a later link replaces an earlier one while the attempt is pending; unknown_payment, not_pending';

create function app.checkout_provider(p_provider_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.payment_provider_json(p) from public.payment_providers p where p.id = p_provider_id;
$$;

comment on function app.checkout_provider(uuid) is 'a provider row by its id for bank-webhook (the id is the last part of the URL the bank service posts to), off ones included so money that arrives after a switch-off is still recorded; null when unknown';

create function app.checkout_app_provider(p_app_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then max(app.payment_provider_json(p)::text)::jsonb end
  from public.mini_apps a
  join public.payment_providers p on p.brand_id = a.brand_id and p.method = 'zalo_checkout' and p.store_id is null
  where a.kind = 'customer' and a.external_id = p_app_id;
$$;

comment on function app.checkout_app_provider(text) is 'the Checkout SDK provider of the brand whose customer Mini App has this id, for checkout-webhook to choose the key; null when none or ambiguous';

-- 5. Settling: every verified notification and re-query -------------------------------------------------------------

create function app.checkout_exception(p_provider public.payment_providers, p_ref text, p_amount numeric, p_reason text, p_payment public.order_payments,
  p_attempt app.payment_attempts, p_reference text, p_source text, p_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_order public.orders;
begin
  insert into public.payment_exceptions (tenant_id, store_id, provider_id, method, provider_ref, amount, expected_amount, reason, reference,
    payment_id, order_id, source, received_at)
  values (p_provider.tenant_id, coalesce(p_attempt.store_id, p_provider.store_id), p_provider.id, p_provider.method, p_ref, p_amount,
    p_payment.amount, p_reason, coalesce(p_attempt.reference, p_reference), p_payment.id, p_payment.order_id, p_source, p_at)
  on conflict (provider_id, provider_ref) do nothing
  returning id into v_id;
  if v_id is not null and p_payment.order_id is not null then
    select o.* into v_order from public.orders o where o.id = p_payment.order_id;
    perform app.order_event(v_order, 'payment', 'payment_exception', null, v_order.payment_status::text, 'provider', null, p_reason, null, p_amount, p_at);
  end if;
  return jsonb_build_object('outcome', 'exception', 'reason', p_reason, 'exception_id', v_id, 'payment_id', p_payment.id, 'order_id', p_payment.order_id);
end;
$$;

comment on function app.checkout_exception(public.payment_providers, text, numeric, text, public.order_payments, app.payment_attempts, text, text, timestamptz) is 'records money that cannot be applied in the manager queue (once per provider and transaction) with an event on its order when there is one';

create function app.checkout_settle(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider public.payment_providers;
  v_ref text := p_request ->> 'provider_ref';
  v_reference text := p_request ->> 'reference';
  v_platform text := p_request ->> 'platform_order_id';
  v_payment_id uuid := app.checkout_uuid(p_request ->> 'payment_id');
  v_source text := coalesce(p_request ->> 'source', 'webhook');
  v_amount numeric;
  v_success boolean;
  v_reason text := left(nullif(btrim(regexp_replace(coalesce(p_request ->> 'reason', ''), '[[:cntrl:]]', ' ', 'g')), ''), 200);
  v_candidates text[];
  v_payment public.order_payments;
  v_attempt app.payment_attempts;
  v_order public.orders;
  v_exception public.payment_exceptions;
  v_matches integer;
  v_confirm jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or v_ref is null or char_length(v_ref) not between 1 and 100 or v_ref ~ '[[:cntrl:][:space:]]'
     or jsonb_typeof(p_request -> 'amount') is distinct from 'number' or jsonb_typeof(p_request -> 'success') is distinct from 'boolean'
     or v_source not in ('webhook', 'requery')
     or (v_reference is not null and v_reference !~ '^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$')
     or (v_platform is not null and v_platform !~ '^[A-Za-z0-9_-]{1,64}$')
     or (p_request ? 'candidates' and jsonb_typeof(p_request -> 'candidates') is distinct from 'array') then
    raise exception 'a settlement names the provider, its transaction id, the amount, the outcome and the source' using errcode = '22023';
  end if;
  v_amount := (p_request ->> 'amount')::numeric;
  v_success := (p_request ->> 'success')::boolean;
  if v_amount < 0 or v_amount <> trunc(v_amount) or v_amount > 100000000 then
    raise exception 'an amount is a whole number of dong' using errcode = '22023';
  end if;
  select coalesce(array_agg(c), '{}') into v_candidates
  from (select jsonb_array_elements_text(coalesce(p_request -> 'candidates', '[]'::jsonb)) c limit 5) x
  where c ~ '^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$';
  select p.* into v_provider from public.payment_providers p where p.id = app.checkout_uuid(p_request ->> 'provider_id');
  if v_provider.id is null then
    raise exception 'unknown provider' using errcode = '22023';
  end if;
  -- one transaction id is settled once, even when the provider posts it twice at the same instant
  perform pg_advisory_xact_lock(hashtextextended('checkout:' || v_provider.method || ':' || v_ref, 0));
  select p.* into v_payment from public.order_payments p where p.provider = v_provider.method and p.provider_ref = v_ref;
  if v_payment.id is not null then
    return jsonb_build_object('outcome', 'replayed', 'state', v_payment.status, 'payment_id', v_payment.id, 'order_id', v_payment.order_id);
  end if;
  select e.* into v_exception from public.payment_exceptions e where e.provider_id = v_provider.id and e.provider_ref = v_ref;
  if v_exception.id is not null then
    return jsonb_build_object('outcome', 'replayed', 'state', 'exception', 'reason', v_exception.reason, 'exception_id', v_exception.id);
  end if;
  if v_payment_id is not null then
    select a.* into v_attempt from app.payment_attempts a where a.payment_id = v_payment_id;
  elsif v_reference is not null then
    select a.* into v_attempt from app.payment_attempts a where a.reference = v_reference;
  elsif cardinality(v_candidates) > 0 then
    select count(*) into v_matches from app.payment_attempts a where a.reference = any (v_candidates) and a.provider_id = v_provider.id;
    if v_matches = 1 then
      select a.* into v_attempt from app.payment_attempts a where a.reference = any (v_candidates) and a.provider_id = v_provider.id;
    end if;
  end if;
  if v_attempt.payment_id is null or v_attempt.provider_id <> v_provider.id then
    if not v_success or (v_provider.method = 'vietqr' and v_reference is null and cardinality(v_candidates) = 0) then
      return jsonb_build_object('outcome', 'ignored');
    end if;
    return app.checkout_exception(v_provider, v_ref, v_amount, 'unknown_reference', null, null,
      coalesce(v_reference, v_candidates[1]), v_source, p_at);
  end if;
  select p.* into v_payment from public.order_payments p where p.id = v_attempt.payment_id for update;
  select o.* into v_order from public.orders o where o.id = v_payment.order_id for update;
  if v_platform is not null and v_attempt.platform_order_id is null and v_payment.status = 'pending' then
    update app.payment_attempts a set platform_order_id = v_platform where a.payment_id = v_attempt.payment_id;
  end if;
  if not v_success then
    if v_payment.status <> 'pending' then
      return jsonb_build_object('outcome', 'ignored', 'payment_id', v_payment.id);
    end if;
    v_confirm := app.checkout_payment_confirm(v_provider.method, v_ref, v_payment.id, v_amount, false, v_reason, p_at);
    return jsonb_build_object('outcome', 'failed', 'payment_id', v_payment.id, 'order_id', v_payment.order_id);
  end if;
  if v_amount <> v_payment.amount then
    return app.checkout_exception(v_provider, v_ref, v_amount, 'amount_differs', v_payment, v_attempt, null, v_source, p_at);
  end if;
  if v_payment.status <> 'pending' then
    return app.checkout_exception(v_provider, v_ref, v_amount, case when v_payment.status = 'succeeded' then 'duplicate' else 'late' end,
      v_payment, v_attempt, null, v_source, p_at);
  end if;
  if v_provider.method = 'vietqr' and (v_order.status = 'cancelled' or v_order.payment_status <> 'unpaid' or p_at > v_attempt.expires_at) then
    return app.checkout_exception(v_provider, v_ref, v_amount, case when v_order.payment_status <> 'unpaid' then 'duplicate' else 'late' end,
      v_payment, v_attempt, null, v_source, p_at);
  end if;
  v_confirm := app.checkout_payment_confirm(v_provider.method, v_ref, v_payment.id, v_amount, true, null, p_at);
  return jsonb_build_object('outcome', case when v_confirm ->> 'state' = 'succeeded' then 'confirmed' else 'refused' end,
    'refusal', v_confirm ->> 'refusal', 'refund_due', coalesce((v_confirm ->> 'refund_due')::boolean, false),
    'payment_id', v_payment.id, 'order_id', v_payment.order_id, 'order_status', v_confirm ->> 'order_status');
end;
$$;

comment on function app.checkout_settle(jsonb, timestamptz) is 'the one settlement of verified provider news (ADR-068), for the webhooks and the re-query job: serialised and unique per provider transaction (a repeat answers replayed); finds the attempt by the job''s payment id, the exact reference, or exactly one of the transfer''s candidates under the same provider; a failure fails a pending attempt; money of the exact amount for a pending attempt pays the order through checkout_payment_confirm (a wallet payment of a cancelled or paid order becomes a due refund the job sends back); everything else (another amount, an expired or settled attempt, a VietQR after the window or for a paid or cancelled order, a reference nobody issued) goes to the manager queue and is never applied; a transfer without any reference is ignored';

-- 6. The manager queue --------------------------------------------------------------------------------------------

create function app.manager_payment_exceptions(p_store_id uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only owners and managers of the store read its payment exceptions' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('open', 'refunded', 'dismissed') then
    raise exception 'a status is open, refunded or dismissed' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'open', (select count(*) from public.payment_exceptions e where e.tenant_id = v_store.tenant_id and e.status = 'open'
      and (e.store_id = v_store.id or (e.store_id is null and app.has_store_scope(e.tenant_id, null, array['owner', 'manager']::public.tenant_role[])))),
    'exceptions', coalesce((select jsonb_agg(x.item order by x.received_at desc, x.id) from (
      select e.id, e.received_at, jsonb_build_object('id', e.id, 'reason', e.reason, 'method', e.method, 'amount', e.amount::bigint,
        'expected_amount', e.expected_amount::bigint, 'reference', e.reference, 'order_id', e.order_id,
        'order_no', (select '#' || lpad(o.order_no::text, 3, '0') from public.orders o where o.id = e.order_id),
        'source', e.source, 'received_at', e.received_at, 'status', e.status, 'resolved_at', e.resolved_at,
        'resolved_by', e.resolved_by, 'resolution_note', e.resolution_note) as item
      from public.payment_exceptions e
      where e.tenant_id = v_store.tenant_id
        and (e.store_id = v_store.id or (e.store_id is null and app.has_store_scope(e.tenant_id, null, array['owner', 'manager']::public.tenant_role[])))
        and (p_status is null or e.status = p_status)
      order by e.received_at desc, e.id
      limit greatest(least(coalesce(p_limit, 50), 200), 1)) x), '[]'::jsonb));
end;
$$;

comment on function app.manager_payment_exceptions(uuid, text, integer) is 'the manager queue of a store (ADR-068): money the server did not apply, newest first, with the reason, the amount and the one expected, the reference and the order; exceptions of a brand-wide account for owners and managers of every store; owners and managers of the store';

create function app.manager_resolve_payment_exception(p_exception_id uuid, p_resolution text, p_note text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exception public.payment_exceptions;
  v_uid uuid := (select auth.uid());
  v_note text := nullif(btrim(p_note), '');
  v_order public.orders;
begin
  select e.* into v_exception from public.payment_exceptions e where e.id = p_exception_id for update;
  if v_exception.id is null or v_uid is null
     or not app.has_store_scope(v_exception.tenant_id, v_exception.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only owners and managers of the store resolve its payment exceptions' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('refunded', 'dismissed') or v_note is null or char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]' then
    raise exception 'a resolution is refunded or dismissed with a note of 1 to 200 characters on one line' using errcode = '22023';
  end if;
  if v_exception.status <> 'open' then
    return jsonb_build_object('state', v_exception.status, 'replayed', v_exception.status = p_resolution,
      'refusal', case when v_exception.status <> p_resolution then 'already_resolved' end);
  end if;
  update public.payment_exceptions e set status = p_resolution, resolved_by = v_uid, resolved_at = p_at, resolution_note = v_note
  where e.id = v_exception.id;
  if v_exception.order_id is not null then
    select o.* into v_order from public.orders o where o.id = v_exception.order_id;
    perform app.order_event(v_order, 'payment', 'payment_exception_' || p_resolution, null, v_order.payment_status::text, 'staff', v_uid,
      v_exception.reason, v_note, v_exception.amount, p_at);
  end if;
  return jsonb_build_object('state', p_resolution, 'replayed', false, 'refusal', null);
end;
$$;

comment on function app.manager_resolve_payment_exception(uuid, text, text, timestamptz) is 'an owner or manager of the store closes an exception: refunded (the money was handed back outside the app, by bank transfer or in cash) or dismissed (not the store''s to return, a test), with a note; logged on the order with who and the amount; a second resolution answers the first';

-- 7. The job: expiry, re-queries, refunds, reports to Zalo ------------------------------------------------------------

create function app.checkout_expire_attempts(p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_order public.orders;
  v_count integer := 0;
begin
  for v_row in
    select p.id, p.order_id, p.method, p.amount,
      case when p.method = 'zalo_checkout' and a.platform_order_id is not null then 'unresolved' else 'expired' end as reason
    from public.order_payments p
    join app.payment_attempts a on a.payment_id = p.id
    join public.orders o on o.id = p.order_id
    where p.status = 'pending'
      and case
        when p.method = 'vietqr' then o.status = 'cancelled' or o.payment_status <> 'unpaid' or a.expires_at <= p_at
        when a.platform_order_id is null then a.expires_at + interval '30 minutes' <= p_at
        else a.expires_at + interval '24 hours' <= p_at
      end
    order by p.requested_at
    limit 500
    for update of p skip locked
  loop
    update public.order_payments p set status = 'failed', settled_at = p_at, failure_reason = v_row.reason where p.id = v_row.id;
    select o.* into v_order from public.orders o where o.id = v_row.order_id;
    perform app.order_event(v_order, 'payment', 'payment_failed', 'unpaid', v_order.payment_status::text, 'system', null, v_row.reason, null, v_row.amount, p_at);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function app.checkout_expire_attempts(timestamptz) is 'fails the attempts nobody will settle: a VietQR once its order is cancelled or paid otherwise or its window passed; a Checkout attempt 30 minutes after its window without Zalo''s order id (nothing to ask), 24 hours after with one (unresolved); money arriving afterwards goes to the manager queue';

create function app.checkout_work_where(p_kind text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'requery' then exists (
      select 1 from public.order_payments p join app.payment_attempts a on a.payment_id = p.id
      where p.status = 'pending' and (a.platform_order_id is not null or a.adapter = 'mock')
        and p.requested_at <= p_at - interval '3 minutes'
        and (a.last_requery_at is null or a.last_requery_at <= p_at - case when p.requested_at > p_at - interval '1 hour' then interval '3 minutes' else interval '1 hour' end))
    when 'refunds' then exists (
      select 1 from public.order_refunds r join public.orders o on o.id = r.order_id
      left join app.refund_attempts x on x.refund_id = r.id
      where r.method = 'zalo_checkout' and ((r.status = 'due' and o.status = 'cancelled') or r.status = 'pending')
        and (x.refund_id is null or x.next_at <= p_at) and coalesce(x.attempts, 0) < 20)
    when 'reports' then exists (
      select 1 from public.order_payments p join app.payment_attempts a on a.payment_id = p.id
      where p.method = 'vietqr' and p.status = 'succeeded' and a.platform_order_id is not null and a.platform_reported_at is null
        and a.platform_report_attempts < 5)
    else false
  end;
$$;

comment on function app.checkout_work_where(text, timestamptz) is 'whether the payments job has work of a kind now: attempts to ask about again, online refunds to send or follow, bank-transfer popups to report to Zalo';

create function app.checkout_job_work(p_limit integer default 20, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 20), 100), 1);
  v_refund record;
  v_order public.orders;
begin
  for v_refund in
    select r.id from public.order_refunds r join public.orders o on o.id = r.order_id
    where r.method = 'zalo_checkout' and r.status = 'due' and o.status = 'cancelled'
    order by r.requested_at limit v_limit
    for update of r skip locked
  loop
    update public.order_refunds r set status = 'pending' where r.id = v_refund.id;
    select o.* into v_order from public.orders o join public.order_refunds r on r.order_id = o.id where r.id = v_refund.id;
    v_order := app.order_settle_payment_status(v_order.id, p_at);
    perform app.order_event(v_order, 'payment', 'refund_requested', null, v_order.payment_status::text, 'system', null, 'zalo_checkout', null,
      (select r.amount from public.order_refunds r where r.id = v_refund.id), p_at);
  end loop;
  return jsonb_build_object(
    'requery', coalesce((select jsonb_agg(x.item) from (
      select jsonb_build_object('payment_id', p.id, 'reference', a.reference, 'amount', p.amount::bigint, 'platform_order_id', a.platform_order_id,
        'provider', app.payment_provider_json(v)) as item
      from public.order_payments p join app.payment_attempts a on a.payment_id = p.id join public.payment_providers v on v.id = a.provider_id
      where p.status = 'pending' and (a.platform_order_id is not null or a.adapter = 'mock')
        and p.requested_at <= p_at - interval '3 minutes'
        and (a.last_requery_at is null or a.last_requery_at <= p_at - case when p.requested_at > p_at - interval '1 hour' then interval '3 minutes' else interval '1 hour' end)
      order by a.last_requery_at nulls first, p.requested_at limit v_limit) x), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(x.item) from (
      select jsonb_build_object('refund_id', r.id, 'amount', r.amount::bigint, 'provider_ref', p.provider_ref, 'provider_refund_id', x.provider_refund_id,
        'description', left('Hoàn tiền ' || s.name, 100), 'provider', app.payment_provider_json(v)) as item
      from public.order_refunds r
      join public.order_payments p on p.id = r.payment_id
      join app.payment_attempts a on a.payment_id = p.id
      join public.payment_providers v on v.id = a.provider_id
      join public.stores s on s.id = r.store_id
      left join app.refund_attempts x on x.refund_id = r.id
      where r.method = 'zalo_checkout' and r.status = 'pending' and p.provider_ref is not null
        and (x.refund_id is null or x.next_at <= p_at) and coalesce(x.attempts, 0) < 20
      order by r.requested_at limit v_limit) x), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(x.item) from (
      select jsonb_build_object('payment_id', p.id, 'platform_order_id', a.platform_order_id,
        'provider', app.payment_provider_json(app.payment_provider_for(o.brand_id, o.store_id, 'zalo_checkout'))) as item
      from public.order_payments p join app.payment_attempts a on a.payment_id = p.id join public.orders o on o.id = p.order_id
      where p.method = 'vietqr' and p.status = 'succeeded' and a.platform_order_id is not null and a.platform_reported_at is null
        and a.platform_report_attempts < 5
      order by p.settled_at limit v_limit) x), '[]'::jsonb));
end;
$$;

comment on function app.checkout_job_work(integer, timestamptz) is 'the payments job''s work list: moves the due wallet refunds of cancelled orders to pending (logged as the system''s request), then answers the attempts to ask the provider about again (Zalo''s order linked, from 3 minutes old, every 3 minutes for an hour, then hourly), the wallet refunds to send or follow (with the payment''s transaction id), and the paid bank-transfer popups to report to Zalo (with the brand''s Checkout provider for the key); each with its provider row';

create function app.checkout_job_note(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := p_request ->> 'kind';
  v_payment_id uuid := app.checkout_uuid(p_request ->> 'payment_id');
  v_refund_id uuid := app.checkout_uuid(p_request ->> 'refund_id');
  v_error text := left(nullif(btrim(regexp_replace(coalesce(p_request ->> 'error', ''), '[[:cntrl:]]', ' ', 'g')), ''), 200);
  v_refund_ref text := p_request ->> 'provider_refund_id';
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' or v_kind is null or v_kind not in ('requery', 'refund', 'report')
     or (v_kind in ('requery', 'report') and v_payment_id is null) or (v_kind = 'refund' and v_refund_id is null)
     or (v_refund_ref is not null and v_refund_ref !~ '^[A-Za-z0-9_.:-]{1,64}$') then
    raise exception 'a note names requery or report with the payment, or refund with the refund' using errcode = '22023';
  end if;
  if v_kind = 'requery' then
    update app.payment_attempts a set requery_count = a.requery_count + 1, last_requery_at = p_at where a.payment_id = v_payment_id;
  elsif v_kind = 'report' then
    update app.payment_attempts a
    set platform_reported_at = case when (p_request ->> 'ok')::boolean then p_at end,
        platform_report_attempts = a.platform_report_attempts + 1,
        platform_report_error = case when not coalesce((p_request ->> 'ok')::boolean, false) then coalesce(v_error, 'refused') end
    where a.payment_id = v_payment_id and a.platform_reported_at is null;
  else
    insert into app.refund_attempts as x (refund_id, provider_refund_id, attempts, last_error, next_at, updated_at)
    values (v_refund_id, v_refund_ref, 1, v_error, p_at + interval '5 minutes', p_at)
    on conflict (refund_id) do update
    set provider_refund_id = coalesce(excluded.provider_refund_id, x.provider_refund_id),
        attempts = x.attempts + 1,
        last_error = excluded.last_error,
        next_at = p_at + least(interval '5 minutes' * (x.attempts + 1), interval '2 hours'),
        updated_at = p_at;
  end if;
  return jsonb_build_object('state', 'noted');
end;
$$;

comment on function app.checkout_job_note(jsonb, timestamptz) is 'the payments job notes what it did: a re-query asked (counted, and not asked again for 3 minutes, an hour once the attempt is old), a refund sent or followed (the provider''s refund id, the error, and the next try after 5 minutes times the tries, at most 2 hours, 20 tries), a report to Zalo done or failed (5 tries)';

create function app.checkout_job_claim(p_ticket uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    delete from app.checkout_job_tickets t where t.ticket = p_ticket and t.expires_at > now() returning 1
  )
  select exists (select 1 from claimed);
$$;

comment on function app.checkout_job_claim(uuid) is 'claims a ticket of the minute job once: true and deleted, false when unknown, used or expired';

create function app.checkout_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings app.checkout_job_settings;
  v_expired integer;
  v_ticket uuid;
  v_request bigint;
begin
  v_expired := app.checkout_expire_attempts(p_at);
  delete from app.checkout_job_tickets t where t.expires_at <= now();
  select s.* into v_settings from app.checkout_job_settings s;
  if not coalesce(v_settings.enabled, false) or v_settings.function_url is null
     or exists (select 1 from app.checkout_job_tickets)
     or not (app.checkout_work_where('requery', p_at) or app.checkout_work_where('refunds', p_at) or app.checkout_work_where('reports', p_at)) then
    return jsonb_build_object('expired', v_expired, 'dispatched', 0);
  end if;
  insert into app.checkout_job_tickets (issued_at, expires_at) values (now(), now() + v_settings.ticket_lifetime) returning ticket into v_ticket;
  select net.http_post(
    url := v_settings.function_url,
    body := jsonb_build_object('ticket', v_ticket),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := v_settings.request_timeout_ms
  ) into v_request;
  update app.checkout_job_tickets t set request_id = v_request where t.ticket = v_ticket;
  return jsonb_build_object('expired', v_expired, 'dispatched', 1);
end;
$$;

comment on function app.checkout_tick(timestamptz) is 'the minute job checkout-tick: expires attempts, then, while the job is enabled with the payments-job URL and work is waiting, posts one ticket at a time to the function through pg_net';

create function app.enable_checkout_jobs(p_function_url text default null, p_schedule text default '* * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_function_url is not null and p_function_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'enable_checkout_jobs needs the http(s) URL of the payments-job function, or null for the expiry alone' using errcode = '22023';
  end if;
  if p_schedule is null or btrim(p_schedule) = '' then
    raise exception 'enable_checkout_jobs needs a cron schedule' using errcode = '22023';
  end if;
  update app.checkout_job_settings set enabled = p_function_url is not null, function_url = p_function_url, updated_at = now();
  return cron.schedule('checkout-tick', p_schedule, 'select app.checkout_tick(now())');
end;
$$;

create function app.disable_checkout_jobs()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.checkout_job_settings set enabled = false, updated_at = now();
  if exists (select 1 from cron.job j where j.jobname = 'checkout-tick') then
    perform cron.unschedule('checkout-tick');
  end if;
end;
$$;

comment on function app.enable_checkout_jobs(text, text) is 'schedules the pg_cron job checkout-tick (every minute by default) and, with the payments-job URL, lets it wake the function; the migration leaves it off';
comment on function app.disable_checkout_jobs() is 'removes the pg_cron job checkout-tick and stops waking the function';

-- 8. Public wrappers and grants ----------------------------------------------------------------------------------

create function public.checkout_set_provider(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_set_provider(p_request, now()); $$;
comment on function public.checkout_set_provider(jsonb) is 'RPC for owners: app.checkout_set_provider at the current time';

create function public.counter_payment_methods(p_store uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.counter_payment_methods(p_store); $$;
comment on function public.counter_payment_methods(uuid) is 'RPC for the counter web app: app.counter_payment_methods';

create function public.manager_payment_exceptions(p_store uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_payment_exceptions(p_store, p_status, p_limit); $$;
comment on function public.manager_payment_exceptions(uuid, text, integer) is 'RPC for owners and managers: app.manager_payment_exceptions';

create function public.manager_resolve_payment_exception(p_exception uuid, p_resolution text, p_note text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_resolve_payment_exception(p_exception, p_resolution, p_note, now()); $$;
comment on function public.manager_resolve_payment_exception(uuid, text, text) is 'RPC for owners and managers: app.manager_resolve_payment_exception at the current time';

create function public.checkout_begin(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_begin(p_request, now()); $$;
comment on function public.checkout_begin(jsonb) is 'RPC for checkout-order only (service_role): app.checkout_begin at the current time';

create function public.checkout_link(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_link(p_request, now()); $$;
comment on function public.checkout_link(jsonb) is 'RPC for checkout-order only (service_role): app.checkout_link at the current time';

create function public.checkout_provider(p_provider uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.checkout_provider(p_provider); $$;
comment on function public.checkout_provider(uuid) is 'RPC for bank-webhook only (service_role): app.checkout_provider';

create function public.checkout_app_provider(p_app_id text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.checkout_app_provider(p_app_id); $$;
comment on function public.checkout_app_provider(text) is 'RPC for checkout-webhook only (service_role): app.checkout_app_provider';

create function public.checkout_settle(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_settle(p_request, now()); $$;
comment on function public.checkout_settle(jsonb) is 'RPC for the payment webhooks and payments-job only (service_role): app.checkout_settle at the current time';

create function public.checkout_job_claim(p_ticket uuid)
returns boolean language sql volatile security definer set search_path = ''
as $$ select app.checkout_job_claim(p_ticket); $$;
comment on function public.checkout_job_claim(uuid) is 'RPC for payments-job only (service_role): app.checkout_job_claim';

create function public.checkout_job_work(p_limit integer default 20)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_job_work(p_limit, now()); $$;
comment on function public.checkout_job_work(integer) is 'RPC for payments-job only (service_role): app.checkout_job_work at the current time';

create function public.checkout_job_note(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.checkout_job_note(p_request, now()); $$;
comment on function public.checkout_job_note(jsonb) is 'RPC for payments-job only (service_role): app.checkout_job_note at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('checkout_uuid', 'payment_secret_name_valid', 'payment_provider_valid', 'user_has_store_scope', 'payment_provider_for',
        'payment_online_methods', 'payment_methods_for_store', 'store_ordering_payment_methods', 'payment_methods_sync', 'payment_provider_json',
        'checkout_set_provider', 'counter_payment_methods', 'checkout_new_reference', 'checkout_attempt_json', 'checkout_begin', 'checkout_link',
        'checkout_provider', 'checkout_app_provider', 'checkout_exception', 'checkout_settle', 'manager_payment_exceptions',
        'manager_resolve_payment_exception', 'checkout_expire_attempts', 'checkout_work_where', 'checkout_job_work', 'checkout_job_note',
        'checkout_job_claim', 'checkout_tick', 'enable_checkout_jobs', 'disable_checkout_jobs', 'payment_provider_changes_append_only')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.checkout_set_provider(jsonb), public.counter_payment_methods(uuid),
  public.manager_payment_exceptions(uuid, text, integer), public.manager_resolve_payment_exception(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.checkout_set_provider(jsonb), public.counter_payment_methods(uuid),
  public.manager_payment_exceptions(uuid, text, integer), public.manager_resolve_payment_exception(uuid, text, text)
  to authenticated;
revoke all on function public.checkout_begin(jsonb), public.checkout_link(jsonb), public.checkout_provider(uuid), public.checkout_app_provider(text),
  public.checkout_settle(jsonb), public.checkout_job_claim(uuid), public.checkout_job_work(integer), public.checkout_job_note(jsonb)
  from public, anon, authenticated;
grant execute on function public.checkout_begin(jsonb), public.checkout_link(jsonb), public.checkout_provider(uuid), public.checkout_app_provider(text),
  public.checkout_settle(jsonb), public.checkout_job_claim(uuid), public.checkout_job_work(integer), public.checkout_job_note(jsonb)
  to service_role;
