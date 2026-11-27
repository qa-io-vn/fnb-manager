-- E-invoices for native orders (ADR-063, ADR-069; native-till.md section 17): the provider a brand (or one of its
-- stores, when it is a household business of its own) switches on, one e-invoice record per paid order issued
-- "from a cash register" by the server, the corrections a refund or an undone payment needs, the company invoice a
-- customer asks for in the app (C18) or the cashier keys at the counter (Q01) with the customer's saved companies,
-- the counter's pill and the managers' list of failing invoices with an alert, and the minute job that wakes the
-- einvoice-job Edge Function. Secrets stay in Edge Function secrets; rows name them. The provider is not chosen yet:
-- the only adapter is the mock (refused live).
--
-- One rule keeps the provider's books equal to the order's money: a sale or a company invoice is issued for what the
-- order holds when the job takes it (paid less refunded), and a correction (an adjustment, or a cancellation when
-- nothing is left) is computed when the job takes it, as the difference between what the order holds and what the
-- provider holds. A refund, a second refund, an undone payment and a new payment therefore never double count, in
-- whatever order they arrive. A record that never reached the provider is cancelled here without a call.

-- 1. Helpers ------------------------------------------------------------------------------------------------------

create function app.einvoice_tax_code(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(p_value, ' ') ~ '^[0-9]{13}$' then left(btrim(p_value, ' '), 10) || '-' || right(btrim(p_value, ' '), 3)
    when btrim(p_value, ' ') ~ '^[0-9]{10}(-[0-9]{3})?$' then btrim(p_value, ' ')
  end;
$$;

comment on function app.einvoice_tax_code(text) is 'a Vietnamese tax code as invoices print it, or null: 10 digits, or 10 digits, a hyphen and 3 (a branch), after trimming the spaces around it; 13 bare digits gain their hyphen; anything else (letters, spaces inside, 9, 11 or 12 digits) is null';

create function app.einvoice_text_valid(p_value text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value is not null and p_max is not null and char_length(p_value) between 1 and p_max and p_value = btrim(p_value)
    and p_value ~ '[^[:space:]]' and p_value !~ '[[:cntrl:]<>{}]', false);
$$;

comment on function app.einvoice_text_valid(text, integer) is 'whether a company name or address can go on an invoice: 1 to p_max characters (Vietnamese letters included), trimmed, on one line, without control characters and without < > { } (markup and template braces have no place in a company''s name and are refused, not escaped)';

create function app.einvoice_email_valid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value is not null and char_length(p_value) <= 254 and char_length(split_part(p_value, '@', 1)) <= 64
    and p_value ~ '^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$', false);
$$;

comment on function app.einvoice_email_valid(text) is 'whether an address can receive the company invoice: at most 254 characters, a local part of at most 64 letters, digits and . _ % + - (no leading, trailing or double dot), a domain of labels and a final label of 2 to 24 letters (no trailing dot); nothing that could break a mail header';

create function app.einvoice_secret_name_valid(p_name text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text;
begin
  if p_name is null or p_name !~ '^EINVOICE_KEY_[A-Z0-9_]{1,40}$' then
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

comment on function app.einvoice_secret_name_valid(text) is 'whether a provider row may name this function secret: EINVOICE_KEY_ and a name, with no segment shaped like a value (longer than 16 characters, or longer than 8 with a digit), so a pasted key is refused';

create function app.einvoice_settings_valid(p_settings jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p_settings) k where k not in ('seller_tax_code', 'template', 'series', 'vat_rate')) then
    return false;
  end if;
  return coalesce(
    jsonb_typeof(p_settings -> 'seller_tax_code') = 'string'
    and app.einvoice_tax_code(p_settings ->> 'seller_tax_code') = p_settings ->> 'seller_tax_code'
    and jsonb_typeof(p_settings -> 'template') = 'string' and p_settings ->> 'template' in ('1', '2')
    and jsonb_typeof(p_settings -> 'series') = 'string' and p_settings ->> 'series' ~ '^[CK][0-9]{2}M[A-Z0-9]{2}$'
    and jsonb_typeof(p_settings -> 'vat_rate') = 'string'
    and case p_settings ->> 'template' when '2' then p_settings ->> 'vat_rate' = 'none' else p_settings ->> 'vat_rate' in ('0', '5', '8', '10') end,
    false);
end;
$$;

comment on function app.einvoice_settings_valid(jsonb) is 'whether a provider''s public settings are complete: the seller''s tax code, the template (1 a VAT invoice, 2 a sales invoice of a household business) and the six-character series of an invoice made from a cash register (C or K, the year, M, two characters), and the VAT rate (none for a sales invoice, 0, 5, 8 or 10 for a VAT invoice); no other setting';

create function app.einvoice_provider_valid(p_adapter text, p_secret_name text, p_settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_adapter = 'mock' and app.einvoice_secret_name_valid(p_secret_name) and app.einvoice_settings_valid(p_settings), false);
$$;

comment on function app.einvoice_provider_valid(text, text, jsonb) is 'whether a provider row is complete: an adapter the einvoice-job function runs (the mock until a provider is chosen; a real adapter adds its name here with its migration), its EINVOICE_KEY_ secret''s name and complete settings';

create function app.einvoice_error_classes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['timeout', 'unavailable', 'rate_limited', 'rejected_auth', 'not_configured', 'unknown', 'rejected_data', 'rejected_duplicate', 'unsupported'];
$$;

create function app.einvoice_retryable(p_class text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_class in ('timeout', 'unavailable', 'rate_limited', 'rejected_auth', 'not_configured', 'unknown'), false);
$$;

comment on function app.einvoice_error_classes() is 'the error classes the job may report, which name what went wrong and never the data: the first six are retried with back-off (the provider or its key may recover), the last three need a person';
comment on function app.einvoice_retryable(text) is 'whether an error class is retried with back-off (timeout, unavailable, rate_limited, rejected_auth, not_configured, unknown) or needs a person at once (rejected_data, rejected_duplicate, unsupported)';

create function app.current_customer_login_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from app.customer_logins l
  join public.zalo_apps a on a.id = l.zalo_app_id and a.tenant_id = l.tenant_id
  where l.user_id = (select auth.uid())
    and (select auth.jwt()) -> 'app_metadata' ->> 'kind' = 'customer'
    and l.tenant_id::text = lower((select auth.jwt()) -> 'app_metadata' ->> 'tenant_id')
    and a.status = 'active'
    and not exists (select 1 from public.tenant_members m where m.user_id = l.user_id);
$$;

comment on function app.current_customer_login_id() is 'the customer login of a customer session (the rule of app.customer_session) or null for every other caller, for the row-level security of the customer''s own saved companies';

-- 2. Providers ----------------------------------------------------------------------------------------------------

create table public.einvoice_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  store_id uuid,
  adapter text not null check (adapter in ('mock')),
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
  check (adapter <> 'mock' or mode <> 'live'),
  check (app.einvoice_provider_valid(adapter, secret_name, settings))
);

create unique index einvoice_providers_scope_key on public.einvoice_providers (brand_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index einvoice_providers_tenant_idx on public.einvoice_providers (tenant_id);
create index einvoice_providers_store_idx on public.einvoice_providers (store_id) where store_id is not null;

comment on table public.einvoice_providers is 'the e-invoice provider a brand (or one of its stores, when it invoices under a tax code of its own) switched on (ADR-069): the adapter, the mode (off, sandbox, live), the name of the Edge Function secret with its key (never the key) and the seller''s public settings; the most specific row decides; written only by einvoice_set_provider (an owner with every store of the brand), read by its owners and managers';
comment on column public.einvoice_providers.secret_name is 'the Edge Function secret with the provider''s credentials: EINVOICE_KEY_<NAME>';
comment on column public.einvoice_providers.settings is 'public settings: seller_tax_code, template (1 or 2), series (an invoice made from a cash register: the fourth character is M) and vat_rate (none for a sales invoice)';

create table public.einvoice_provider_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider_id uuid not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null,
  before jsonb,
  after jsonb not null,
  foreign key (tenant_id, provider_id) references public.einvoice_providers (tenant_id, id) on delete cascade
);

create index einvoice_provider_changes_provider_idx on public.einvoice_provider_changes (provider_id, id);
create index einvoice_provider_changes_tenant_idx on public.einvoice_provider_changes (tenant_id);

comment on table public.einvoice_provider_changes is 'the append-only log of every e-invoice provider change with who, when, before and after (a changed seller tax code or series changes every invoice that follows); no role changes or deletes a row';

create function app.einvoice_provider_changes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.tenants t where t.id = old.tenant_id)
    or not exists (select 1 from public.einvoice_providers p where p.id = old.provider_id)
  ) then
    return old;
  end if;
  raise exception 'the e-invoice provider change log is append-only' using errcode = '42501';
end;
$$;

comment on function app.einvoice_provider_changes_append_only() is 'trigger refusing every update and delete of the provider change log for every role; only the deletion of the tenant or of the provider row itself removes rows';

create trigger einvoice_provider_changes_append_only before update or delete on public.einvoice_provider_changes
  for each row execute function app.einvoice_provider_changes_append_only();

-- 3. The store's window, invoices, requests and saved companies ---------------------------------------------------

alter table public.store_ordering_settings
  add column company_invoice_days integer not null default 7 check (company_invoice_days between 1 and 30);
comment on column public.store_ordering_settings.company_invoice_days is 'a customer may ask for a company invoice (C18) until this many days after the payment, counted in the store''s local dates: day 7 yes, day 8 no by default';
grant insert (company_invoice_days), update (company_invoice_days) on public.store_ordering_settings to authenticated;

create table public.e_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  provider_id uuid not null,
  kind text not null check (kind in ('sale', 'replacement', 'adjustment', 'cancellation')),
  state text not null default 'queued' check (state in ('queued', 'issuing', 'issued', 'failed', 'replaced', 'adjusted', 'cancelled')),
  reason text not null check (reason in ('paid', 'company_invoice', 'refund', 'payment_voided')),
  original_id uuid references public.e_invoices (id) on delete set null,
  request_id uuid,
  action text check (action is null or action in ('issue', 'replace', 'adjust', 'cancel')),
  mode text check (mode is null or mode in ('sandbox', 'live')),
  amount numeric(14, 2) check (amount is null or (amount = trunc(amount) and amount between -100000000 and 100000000)),
  provider_ref text check (provider_ref is null or (char_length(provider_ref) between 1 and 100 and provider_ref !~ '[[:cntrl:][:space:]]')),
  invoice_no text check (invoice_no is null or invoice_no ~ '^[0-9A-Za-z/-]{1,30}$'),
  invoice_series text check (invoice_series is null or invoice_series ~ '^[0-9A-Z/-]{1,20}$'),
  lookup_code text check (lookup_code is null or lookup_code ~ '^[0-9A-Za-z_-]{1,64}$'),
  lookup_url text check (lookup_url is null or (char_length(lookup_url) <= 300 and lookup_url ~ '^https://[^[:space:][:cntrl:]"<>]+$')),
  tax_authority_code text check (tax_authority_code is null or tax_authority_code ~ '^[0-9A-Za-z-]{1,40}$'),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  round_attempts integer not null default 0 check (round_attempts between 0 and 100),
  last_error_class text check (last_error_class is null or last_error_class = any (app.einvoice_error_classes())),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  gave_up_at timestamptz,
  claim_token uuid,
  claimed_until timestamptz,
  queued_at timestamptz not null,
  issued_at timestamptz,
  settled_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason in ('order_unpaid', 'nothing_to_invoice', 'nothing_to_change')),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, provider_id) references public.einvoice_providers (tenant_id, id) on delete cascade,
  check ((kind = 'replacement') = (request_id is not null)),
  check (kind in ('sale', 'replacement') or state not in ('replaced', 'adjusted')),
  check (state not in ('issued', 'replaced', 'adjusted') or (provider_ref is not null and issued_at is not null and amount is not null)),
  check ((state = 'issuing') = (claim_token is not null and claimed_until is not null)),
  check (state <> 'failed' or last_error_class is not null),
  check (gave_up_at is null or state = 'failed'),
  check (state <> 'failed' or ((next_attempt_at is null) = (gave_up_at is not null))),
  check (cancel_reason is null or state = 'cancelled')
);

create unique index e_invoices_sale_key on public.e_invoices (order_id) where kind = 'sale' and state not in ('cancelled', 'replaced');
create unique index e_invoices_replacement_key on public.e_invoices (order_id) where kind = 'replacement' and state <> 'cancelled';
create unique index e_invoices_correction_key on public.e_invoices (order_id) where kind in ('adjustment', 'cancellation') and state = 'queued';
create unique index e_invoices_provider_ref_key on public.e_invoices (provider_id, provider_ref) where provider_ref is not null;
create index e_invoices_work_idx on public.e_invoices (state, next_attempt_at) where state in ('queued', 'issuing', 'failed');
create index e_invoices_order_idx on public.e_invoices (order_id);
create index e_invoices_store_idx on public.e_invoices (store_id, state);
create index e_invoices_original_idx on public.e_invoices (original_id) where original_id is not null;
create index e_invoices_tenant_idx on public.e_invoices (tenant_id);
create index e_invoices_provider_idx on public.e_invoices (provider_id);

comment on table public.e_invoices is 'the e-invoices of native orders (ADR-069), one row per document the provider is asked to make: the sale invoice of a paid order made from a cash register, the company invoice that replaces it (C18), and the adjustment or cancellation a refund or an undone payment needs. State: queued -> issuing -> issued | failed (retried with back-off, then given up for a person) ; a sale becomes replaced or adjusted, any document cancelled. Holds the provider''s reference, number, lookup code and URL, the tax authority''s code, the attempts and the last error class, never the buyer''s data (that stays on invoice_requests); written only by security definer functions';
comment on column public.e_invoices.amount is 'for a sale or a company invoice its total, what the order held when the job took it (the provider''s figure once issued); for a correction the change it made, negative for a refund';
comment on column public.e_invoices.original_id is 'the document a company invoice replaced, or an adjustment or cancellation acted on, set when the job takes it';
comment on column public.e_invoices.attempts is 'every attempt ever made; an attempt after the first asks the provider for the document by its id before making it again, so a lost answer never makes a second invoice';
comment on column public.e_invoices.round_attempts is 'the attempts since the last manager retry, which drive the back-off (1, 2, 4 … minutes, at most an hour) and the give-up after 10';

create table public.invoice_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  order_id uuid not null,
  source text not null check (source in ('app', 'counter')),
  customer_login_id uuid references app.customer_logins (id) on delete set null,
  requested_by uuid references auth.users (id) on delete set null,
  client_request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  tax_code text not null check (app.einvoice_tax_code(tax_code) is not distinct from tax_code),
  company_name text not null check (app.einvoice_text_valid(company_name, 200)),
  address text not null check (app.einvoice_text_valid(address, 300)),
  email text not null check (app.einvoice_email_valid(email)),
  status text not null default 'received' check (status in ('received', 'issuing', 'issued', 'emailed', 'failed', 'cancelled')),
  einvoice_id uuid,
  email_attempts integer not null default 0 check (email_attempts between 0 and 100),
  email_error_class text check (email_error_class is null or email_error_class in ('timeout', 'unavailable', 'rejected', 'no_mailer', 'unknown')),
  email_next_at timestamptz,
  email_claimed_until timestamptz,
  requested_at timestamptz not null,
  issued_at timestamptz,
  emailed_at timestamptz,
  closed_at timestamptz,
  unique (tenant_id, id),
  unique (order_id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, einvoice_id) references public.e_invoices (tenant_id, id) on delete set null (einvoice_id),
  check (source = 'counter' or requested_by is null),
  check (status <> 'emailed' or emailed_at is not null)
);

alter table public.e_invoices add constraint e_invoices_request_fkey
  foreign key (tenant_id, request_id) references public.invoice_requests (tenant_id, id) on delete cascade;

create index invoice_requests_store_idx on public.invoice_requests (store_id, status);
create index invoice_requests_login_idx on public.invoice_requests (customer_login_id) where customer_login_id is not null;
create index invoice_requests_email_idx on public.invoice_requests (email_next_at) where status = 'issued' and emailed_at is null;
create index invoice_requests_tenant_idx on public.invoice_requests (tenant_id);
create index invoice_requests_einvoice_idx on public.invoice_requests (einvoice_id) where einvoice_id is not null;
create index e_invoices_request_idx on public.e_invoices (request_id) where request_id is not null;

comment on table public.invoice_requests is 'a company invoice asked for an order (C18 in the app, Q01 at the counter): one per order, the buyer''s tax code, name, address and email as the invoice needs them (kept with the invoice for the legal period, without the customer link once the login is deleted), the status received -> issuing -> issued -> emailed | failed | cancelled, and the email''s attempts; written only by security definer functions; read by the store''s owners and managers';

create table public.saved_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  tax_code text not null check (app.einvoice_tax_code(tax_code) is not distinct from tax_code),
  company_name text not null check (app.einvoice_text_valid(company_name, 200)),
  address text not null check (app.einvoice_text_valid(address, 300)),
  email text not null check (app.einvoice_email_valid(email)),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (customer_login_id, tax_code)
);

create index saved_companies_tenant_idx on public.saved_companies (tenant_id);

comment on table public.saved_companies is 'the companies a customer saved for their next company invoice ("Lưu công ty này cho lần sau", C18): at most 10 per login, readable only by that customer (row-level security), written only by customer_request_invoice and customer_delete_saved_company, deleted with the login (customer_delete_account)';

alter table public.einvoice_providers enable row level security;
alter table public.einvoice_provider_changes enable row level security;
alter table public.e_invoices enable row level security;
alter table public.invoice_requests enable row level security;
alter table public.saved_companies enable row level security;

create policy einvoice_providers_select on public.einvoice_providers
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy einvoice_provider_changes_select on public.einvoice_provider_changes
  for select to authenticated
  using (exists (select 1 from public.einvoice_providers p where p.id = provider_id
    and app.has_store_scope(p.tenant_id, p.store_id, array['owner', 'manager']::public.tenant_role[])));
create policy e_invoices_select on public.e_invoices
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy invoice_requests_select on public.invoice_requests
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy saved_companies_select on public.saved_companies
  for select to authenticated
  using (customer_login_id = (select app.current_customer_login_id()));

revoke all on public.einvoice_providers, public.einvoice_provider_changes, public.e_invoices, public.invoice_requests, public.saved_companies
  from anon, authenticated;
grant select on public.einvoice_providers, public.einvoice_provider_changes, public.e_invoices, public.invoice_requests, public.saved_companies
  to authenticated;

-- 4. Limits and the alert -----------------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website', 'staff_clock_in',
  'counter_member_lookup', 'customer_stamp_code', 'customer_invoice_request'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values ('customer_invoice_request', 'calls', 10, 1000, interval '1 hour', interval '1 hour');

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('einvoice_failed', 'operations', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{}', '{}', interval '1 hour', null, false, true, 290);

-- 5. Provider configuration ---------------------------------------------------------------------------------------

create function app.einvoice_provider_for(p_brand_id uuid, p_store_id uuid)
returns public.einvoice_providers
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from (
    select p.*
    from public.einvoice_providers p
    join public.brands b on b.id = p.brand_id
    where p.brand_id = p_brand_id
      and p_store_id = any (b.store_ids)
      and (p.store_id = p_store_id or p.store_id is null)
    order by (p.store_id is not null) desc
    limit 1
  ) r
  where r.mode <> 'off';
$$;

comment on function app.einvoice_provider_for(uuid, uuid) is 'the e-invoice provider a store of a brand uses: the most specific row (the store''s, else the brand''s), and only while its mode is not off; null means e-invoicing is off at the store';

create function app.einvoice_provider_json(p_provider public.einvoice_providers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_provider.id is null then null else jsonb_build_object(
    'id', p_provider.id, 'brand_id', p_provider.brand_id, 'store_id', p_provider.store_id, 'adapter', p_provider.adapter,
    'mode', p_provider.mode, 'secret_name', p_provider.secret_name, 'settings', p_provider.settings)
  end;
$$;

comment on function app.einvoice_provider_json(public.einvoice_providers) is 'a provider row as the job and the owner read it (its secret''s name, never a secret)';

create function app.einvoice_set_provider(p_request jsonb, p_at timestamptz default now())
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
  v_adapter text;
  v_mode text;
  v_secret text;
  v_settings jsonb;
  v_before public.einvoice_providers;
  v_after public.einvoice_providers;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'a provider is a JSON object' using errcode = '22023';
  end if;
  select b.* into v_brand from public.brands b where b.id = app.checkout_uuid(p_request ->> 'brand');
  if v_brand.id is null or v_uid is null
     or not app.brand_in_scope(v_brand.tenant_id, v_brand.id, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store of the brand sets its e-invoice provider' using errcode = '42501';
  end if;
  v_store_id := app.checkout_uuid(p_request ->> 'store');
  if p_request ->> 'store' is not null and (v_store_id is null or not v_store_id = any (v_brand.store_ids)) then
    raise exception 'the store must be one of the brand''s' using errcode = '22023';
  end if;
  v_adapter := coalesce(p_request ->> 'adapter', 'mock');
  v_mode := p_request ->> 'mode';
  v_secret := p_request ->> 'secret_name';
  v_settings := coalesce(p_request -> 'settings', '{}'::jsonb);
  if v_mode is null or v_mode not in ('off', 'sandbox', 'live') or (v_adapter = 'mock' and v_mode = 'live')
     or not app.einvoice_provider_valid(v_adapter, v_secret, v_settings) then
    raise exception 'a provider names its adapter, mode (off, sandbox, live), its secret''s name (EINVOICE_KEY_...) and complete settings; a mock never runs live' using errcode = '22023';
  end if;
  select p.* into v_before from public.einvoice_providers p
  where p.brand_id = v_brand.id and p.store_id is not distinct from v_store_id
  for update;
  if v_before.id is null then
    insert into public.einvoice_providers (tenant_id, brand_id, store_id, adapter, mode, secret_name, settings, created_by, created_at, updated_by, updated_at)
    values (v_brand.tenant_id, v_brand.id, v_store_id, v_adapter, v_mode, v_secret, v_settings, v_uid, p_at, v_uid, p_at)
    returning * into v_after;
  elsif (v_before.adapter, v_before.mode, v_before.secret_name, v_before.settings) is not distinct from (v_adapter, v_mode, v_secret, v_settings) then
    return jsonb_build_object('state', 'unchanged', 'provider', app.einvoice_provider_json(v_before));
  else
    update public.einvoice_providers p
    set adapter = v_adapter, mode = v_mode, secret_name = v_secret, settings = v_settings, updated_by = v_uid, updated_at = p_at
    where p.id = v_before.id
    returning * into v_after;
  end if;
  insert into public.einvoice_provider_changes (tenant_id, provider_id, changed_by, changed_at, before, after)
  values (v_after.tenant_id, v_after.id, v_uid, p_at,
    case when v_before.id is not null then to_jsonb(v_before) - array['created_by', 'created_at', 'updated_by', 'updated_at'] end,
    to_jsonb(v_after) - array['created_by', 'created_at', 'updated_by', 'updated_at']);
  return jsonb_build_object('state', 'saved', 'provider', app.einvoice_provider_json(v_after));
end;
$$;

comment on function app.einvoice_set_provider(jsonb, timestamptz) is 'an owner with every store of the brand switches the e-invoice provider on (sandbox, live) or off and sets its adapter, secret name and seller settings, per brand or per store; every change is logged with before and after; paid orders are queued only while a provider is on, and what was queued waits while it is off';

-- 6. Money and documents ------------------------------------------------------------------------------------------

create function app.einvoice_order_net(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select m.paid - m.refunded from app.order_money(p_order_id) m;
$$;

comment on function app.einvoice_order_net(uuid) is 'what an order holds: its succeeded payments less its succeeded refunds (a refund still due or pending changes nothing until it succeeds)';

create function app.einvoice_live(p_order_id uuid)
returns public.e_invoices
language sql
stable
security definer
set search_path = ''
as $$
  select e.* from public.e_invoices e
  where e.order_id = p_order_id and e.kind in ('sale', 'replacement') and e.state in ('issued', 'adjusted')
  order by (e.kind = 'replacement') desc, e.issued_at desc, e.id
  limit 1;
$$;

comment on function app.einvoice_live(uuid) is 'the invoice of an order the provider holds as valid now: the company invoice once issued, else the sale invoice, issued or adjusted; null when none';

create function app.einvoice_provider_amount(p_invoice public.e_invoices)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p_invoice.amount + coalesce((select sum(c.amount) from public.e_invoices c
    where c.original_id = p_invoice.id and c.kind in ('adjustment', 'cancellation') and c.state = 'issued'), 0);
$$;

comment on function app.einvoice_provider_amount(public.e_invoices) is 'what the provider holds for a sale or company invoice: its total and every issued correction that acted on it';

create function app.einvoice_backoff(p_round_attempts integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select least(interval '1 minute' * power(2, greatest(coalesce(p_round_attempts, 1), 1) - 1), interval '1 hour');
$$;

comment on function app.einvoice_backoff(integer) is 'the wait before the next attempt after the n-th failed one of a round: 1, 2, 4, 8, 16, 32 minutes, then an hour';

create function app.einvoice_reconcile(p_order_id uuid, p_reason text, p_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_net numeric;
  v_doc record;
  v_live public.e_invoices;
  v_sent public.e_invoices;
  v_in_flight boolean;
  v_correction public.e_invoices;
  v_provider public.einvoice_providers;
begin
  perform pg_advisory_xact_lock(hashtextextended('fnb-einvoice:' || p_order_id::text, 0));
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if v_order.id is null then
    return;
  end if;
  v_net := app.einvoice_order_net(v_order.id);
  if v_net <= 0 then
    -- what never reached the provider is not owed any more
    for v_doc in
      select e.id, e.request_id from public.e_invoices e
      where e.order_id = v_order.id and e.kind in ('sale', 'replacement') and e.state in ('queued', 'failed') and e.attempts = 0
      for update
    loop
      update public.e_invoices e
      set state = 'cancelled', cancel_reason = 'order_unpaid', settled_at = p_at, next_attempt_at = null, gave_up_at = null
      where e.id = v_doc.id;
      if v_doc.request_id is not null then
        update public.invoice_requests r set status = 'cancelled', closed_at = p_at
        where r.id = v_doc.request_id and r.status in ('received', 'issuing', 'failed');
      end if;
    end loop;
  end if;
  -- a sale or company invoice that is, or may be, at the provider
  select e.* into v_sent from public.e_invoices e
  where e.order_id = v_order.id and e.kind in ('sale', 'replacement')
    and (e.state in ('issuing', 'issued', 'adjusted') or (e.state in ('queued', 'failed') and e.attempts > 0))
  order by e.queued_at desc, e.id
  limit 1;
  if v_sent.id is not null then
    v_live := app.einvoice_live(v_order.id);
    v_in_flight := exists (select 1 from public.e_invoices e
      where e.order_id = v_order.id and e.kind in ('sale', 'replacement')
        and (e.state = 'issuing' or (e.state in ('queued', 'failed') and e.attempts > 0)));
    if v_in_flight or v_live.id is null or app.einvoice_provider_amount(v_live) <> v_net then
      select e.* into v_correction from public.e_invoices e
      where e.order_id = v_order.id and e.kind in ('adjustment', 'cancellation') and e.state = 'queued'
      for update;
      if v_correction.id is not null then
        update public.e_invoices e set kind = case when v_net <= 0 then 'cancellation' else 'adjustment' end where e.id = v_correction.id;
      else
        insert into public.e_invoices (tenant_id, store_id, order_id, provider_id, kind, state, reason, queued_at)
        values (v_order.tenant_id, v_order.store_id, v_order.id, coalesce(v_live.provider_id, v_sent.provider_id),
          case when v_net <= 0 then 'cancellation' else 'adjustment' end, 'queued',
          case when p_reason in ('refund', 'payment_voided') then p_reason else 'refund' end, p_at);
      end if;
    end if;
    return;
  end if;
  if v_net > 0 and v_order.status <> 'cancelled' and v_order.payment_status in ('paid', 'partially_refunded')
     and not exists (select 1 from public.e_invoices e where e.order_id = v_order.id and e.kind = 'sale' and e.state not in ('cancelled', 'replaced')) then
    v_provider := app.einvoice_provider_for(v_order.brand_id, v_order.store_id);
    if v_provider.id is not null then
      insert into public.e_invoices (tenant_id, store_id, order_id, provider_id, kind, state, reason, queued_at)
      values (v_order.tenant_id, v_order.store_id, v_order.id, v_provider.id, 'sale', 'queued', 'paid', p_at);
    end if;
  end if;
end;
$$;

comment on function app.einvoice_reconcile(uuid, text, timestamptz) is 'keeps an order''s e-invoices in step with its money, after every payment, refund, undone payment and job result (serialised per order): a paid order of a store whose provider is on gets its sale invoice queued; when nothing is held any more, documents that never reached the provider are cancelled here (and their company request); when a document is or may be at the provider and what it holds may differ from what the order holds, one correction is queued (an adjustment, or a cancellation when nothing is left), whose amount the job computes when it takes it';

create function app.einvoice_after_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.einvoice_reconcile(new.id, case when new.payment_status = 'unpaid' then 'payment_voided' else 'refund' end, now());
  return null;
end;
$$;

create function app.einvoice_after_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'succeeded' then
    return null;
  end if;
  perform app.einvoice_reconcile(new.order_id, 'refund', now());
  return null;
end;
$$;

comment on function app.einvoice_after_order() is 'trigger: an order''s payment status moved (paid, refunded, unpaid again), so its e-invoices are reconciled';
comment on function app.einvoice_after_refund() is 'trigger: a refund succeeded (a second partial refund leaves the payment status as it was), so the order''s e-invoices are reconciled';

create trigger orders_einvoice after update of payment_status on public.orders
  for each row when (old.payment_status is distinct from new.payment_status) execute function app.einvoice_after_order();
create trigger order_refunds_einvoice after insert or update of status on public.order_refunds
  for each row when (new.status = 'succeeded') execute function app.einvoice_after_refund();

-- 7. Reading: the pill, the request, the window -------------------------------------------------------------------

create function app.einvoice_doc_json(p_invoice public.e_invoices)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_invoice.id is null then null else jsonb_build_object(
    'id', p_invoice.id, 'kind', p_invoice.kind, 'state', p_invoice.state, 'mode', p_invoice.mode,
    'invoice_no', p_invoice.invoice_no, 'series', p_invoice.invoice_series, 'lookup_code', p_invoice.lookup_code,
    'lookup_url', p_invoice.lookup_url, 'tax_authority_code', p_invoice.tax_authority_code,
    'amount', p_invoice.amount::bigint, 'issued_at', p_invoice.issued_at)
  end;
$$;

create function app.einvoice_pill(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_live public.e_invoices;
  v_head public.e_invoices;
  v_state text;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  v_live := app.einvoice_live(p_order_id);
  select e.* into v_head from public.e_invoices e
  where e.order_id = p_order_id and e.kind in ('sale', 'replacement') and e.state in ('queued', 'issuing', 'failed')
  order by e.queued_at desc, e.id
  limit 1;
  v_state := case
    when v_live.id is not null then 'issued'
    when v_head.id is not null and v_head.state = 'failed' and v_head.next_attempt_at is null then 'failed'
    when v_head.id is not null and v_head.state = 'failed' then 'retrying'
    when v_head.id is not null then 'pending'
    when exists (select 1 from public.e_invoices e where e.order_id = p_order_id and e.kind in ('sale', 'replacement')) then 'cancelled'
    when (app.einvoice_provider_for(v_order.brand_id, v_order.store_id)).id is null then 'off'
    else 'none'
  end;
  return jsonb_build_object(
    'state', v_state,
    'invoice', app.einvoice_doc_json(coalesce(v_live, v_head)),
    'replacing', v_live.id is not null and v_head.id is not null and v_head.kind = 'replacement',
    'corrections_pending', (select count(*) from public.e_invoices e
      where e.order_id = p_order_id and e.kind in ('adjustment', 'cancellation') and e.state in ('queued', 'issuing', 'failed'))::integer,
    'attempts', coalesce(v_head.attempts, 0),
    'next_attempt_at', v_head.next_attempt_at);
end;
$$;

comment on function app.einvoice_doc_json(public.e_invoices) is 'an e-invoice as the readers show it: its kind, state, mode, number, series, lookup code and URL, the tax authority''s code, the amount and when it was issued';
comment on function app.einvoice_pill(uuid) is 'the e-invoice state of an order for the counter''s pill (Q01) and the customer: issued ("Đã xuất": the provider holds a valid invoice), pending ("Đang xuất…"), retrying ("Chưa xuất được. Hệ thống tự thử lại, đơn vẫn hoàn tất."), failed (given up, a manager retries), cancelled, off (no provider) or none (nothing to invoice); with the invoice, whether a company invoice is replacing it and how many corrections wait';

create function app.invoice_request_json(p_request public.invoice_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_request.id is null then null else jsonb_build_object(
    'id', p_request.id, 'order_id', p_request.order_id, 'source', p_request.source, 'status', p_request.status,
    'tax_code', p_request.tax_code, 'company_name', p_request.company_name, 'address', p_request.address, 'email', p_request.email,
    'requested_at', p_request.requested_at, 'issued_at', p_request.issued_at, 'emailed_at', p_request.emailed_at,
    'invoice', (select app.einvoice_doc_json(e) from public.e_invoices e where e.id = p_request.einvoice_id and e.state in ('issued', 'adjusted', 'cancelled')))
  end;
$$;

comment on function app.invoice_request_json(public.invoice_requests) is 'a company invoice request as its customer, the counter and the managers read it: the buyer''s data, the status and, once issued, the company invoice';

create function app.einvoice_window(p_order public.orders)
returns table (window_days integer, paid_day date, last_day date, zone text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.days, (p_order.paid_at at time zone w.tz)::date, (p_order.paid_at at time zone w.tz)::date + w.days, w.tz
  from (
    select coalesce((select s.company_invoice_days from public.store_ordering_settings s where s.store_id = p_order.store_id), 7) as days,
      coalesce((select st.timezone from public.stores st where st.id = p_order.store_id), 'Asia/Ho_Chi_Minh') as tz
  ) w;
$$;

comment on function app.einvoice_window(public.orders) is 'the company invoice window of a paid order: the store''s company_invoice_days (7 by default) after the local date of the payment; the last day is still inside';

create function app.einvoice_request_refusal(p_order public.orders, p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window record;
begin
  if exists (select 1 from public.invoice_requests r where r.order_id = p_order.id) then
    return 'already_requested';
  end if;
  if (app.einvoice_provider_for(p_order.brand_id, p_order.store_id)).id is null then
    return 'einvoice_off';
  end if;
  if p_order.payment_status = 'unpaid' or p_order.paid_at is null then
    return 'not_paid';
  end if;
  if p_order.payment_status <> 'paid' or p_order.status = 'cancelled' then
    return 'refunded';
  end if;
  if app.einvoice_order_net(p_order.id) <= 0 then
    return 'nothing_to_invoice';
  end if;
  select w.* into v_window from app.einvoice_window(p_order) w;
  if (p_at at time zone v_window.zone)::date > v_window.last_day then
    return 'window_passed';
  end if;
  return null;
end;
$$;

comment on function app.einvoice_request_refusal(public.orders, timestamptz) is 'why a company invoice cannot be asked for an order now, in this order (a decision table): already_requested (one per order), einvoice_off (no provider on at the store), not_paid, refunded (any refund, due, pending or done, or a cancelled order), nothing_to_invoice (an order a reward made free), window_passed (after the last day of the window); null when it can';

create function app.einvoice_company_input(p_company jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tax text;
  v_name text;
  v_address text;
  v_email text;
  v_fields text[] := '{}'::text[];
begin
  if p_company is null or jsonb_typeof(p_company) <> 'object' then
    return jsonb_build_object('fields', jsonb_build_array('tax_code', 'company_name', 'address', 'email'));
  end if;
  if jsonb_typeof(p_company -> 'tax_code') = 'string' then
    v_tax := app.einvoice_tax_code(p_company ->> 'tax_code');
  end if;
  if jsonb_typeof(p_company -> 'company_name') = 'string' then
    v_name := btrim(p_company ->> 'company_name', ' ');
  end if;
  if jsonb_typeof(p_company -> 'address') = 'string' then
    v_address := btrim(p_company ->> 'address', ' ');
  end if;
  if jsonb_typeof(p_company -> 'email') = 'string' then
    v_email := btrim(p_company ->> 'email', ' ');
  end if;
  if v_tax is null then
    v_fields := array_append(v_fields, 'tax_code');
  end if;
  if not app.einvoice_text_valid(v_name, 200) then
    v_fields := array_append(v_fields, 'company_name');
  end if;
  if not app.einvoice_text_valid(v_address, 300) then
    v_fields := array_append(v_fields, 'address');
  end if;
  if not app.einvoice_email_valid(v_email) then
    v_fields := array_append(v_fields, 'email');
  end if;
  if cardinality(v_fields) > 0 then
    return jsonb_build_object('fields', to_jsonb(v_fields));
  end if;
  return jsonb_build_object('fields', '[]'::jsonb, 'tax_code', v_tax, 'company_name', v_name, 'address', v_address, 'email', v_email);
end;
$$;

comment on function app.einvoice_company_input(jsonb) is 'checks a company as a client sent it, never trusting the client''s own check: the tax code normalised (app.einvoice_tax_code), the name (1 to 200) and address (1 to 300) trimmed, on one line, without control characters or < > { }, the email (app.einvoice_email_valid); answers the fields in error, or none and the clean values';

create function app.einvoice_request_hash(p_order_id uuid, p_company jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object('order', p_order_id, 'tax_code', p_company ->> 'tax_code',
    'company_name', p_company ->> 'company_name', 'address', p_company ->> 'address', 'email', p_company ->> 'email')::text, 'UTF8'), 'sha256'), 'hex');
$$;

comment on function app.einvoice_request_hash(uuid, jsonb) is 'the SHA-256 of a request''s order and cleaned company, which tells a replay of the same request from another request under the same id';

create function app.einvoice_create_request(p_order public.orders, p_source text, p_login_id uuid, p_user uuid, p_client_request_id uuid,
  p_company jsonb, p_at timestamptz)
returns public.invoice_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.invoice_requests;
  v_invoice public.e_invoices;
  v_provider public.einvoice_providers := app.einvoice_provider_for(p_order.brand_id, p_order.store_id);
begin
  insert into public.invoice_requests (tenant_id, store_id, order_id, source, customer_login_id, requested_by, client_request_id, request_hash,
    tax_code, company_name, address, email, status, requested_at)
  values (p_order.tenant_id, p_order.store_id, p_order.id, p_source, p_login_id, p_user, p_client_request_id,
    app.einvoice_request_hash(p_order.id, p_company), p_company ->> 'tax_code', p_company ->> 'company_name', p_company ->> 'address',
    p_company ->> 'email', 'received', p_at)
  returning * into v_request;
  insert into public.e_invoices (tenant_id, store_id, order_id, provider_id, kind, state, reason, request_id, queued_at)
  values (p_order.tenant_id, p_order.store_id, p_order.id, v_provider.id, 'replacement', 'queued', 'company_invoice', v_request.id, p_at)
  returning * into v_invoice;
  update public.invoice_requests r set einvoice_id = v_invoice.id where r.id = v_request.id returning r.* into v_request;
  return v_request;
end;
$$;

comment on function app.einvoice_create_request(public.orders, text, uuid, uuid, uuid, jsonb, timestamptz) is 'records a company invoice request that passed every check and queues the company invoice that will replace the order''s sale invoice';

-- 8. The customer (C18) -------------------------------------------------------------------------------------------

create function app.customer_invoice_status(p_order_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_order public.orders;
  v_window record;
  v_request public.invoice_requests;
  v_refusal text;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id and o.customer_login_id = v_login.id;
  if v_order.id is null then
    return jsonb_build_object('order_id', p_order_id, 'eligible', false, 'refusal', 'unknown_order', 'request', null, 'einvoice', null);
  end if;
  select r.* into v_request from public.invoice_requests r where r.order_id = v_order.id;
  v_refusal := app.einvoice_request_refusal(v_order, p_at);
  select w.* into v_window from app.einvoice_window(v_order) w;
  return jsonb_build_object(
    'order_id', v_order.id, 'display_no', app.order_display_no(v_order.order_no), 'paid_at', v_order.paid_at,
    'total', app.einvoice_order_net(v_order.id)::bigint,
    'eligible', v_refusal is null, 'refusal', v_refusal,
    'window_days', v_window.window_days, 'last_day', case when v_order.paid_at is not null then to_char(v_window.last_day, 'YYYY-MM-DD') end,
    'request', app.invoice_request_json(v_request),
    'einvoice', app.einvoice_pill(v_order.id));
end;
$$;

comment on function app.customer_invoice_status(uuid, timestamptz) is 'C18 and C14: whether the caller may ask for a company invoice for their own order now (eligible, or the refusal of app.einvoice_request_refusal), the last day of the window, the request already made and the order''s e-invoice; another customer''s order or an unknown id answers the same unknown_order; 42501 without a customer session';

create function app.customer_saved_company_json(p_company public.saved_companies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p_company.id, 'tax_code', p_company.tax_code, 'company_name', p_company.company_name,
    'address', p_company.address, 'email', p_company.email, 'updated_at', p_company.updated_at);
$$;

create function app.customer_request_invoice(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_locked timestamptz;
  v_client_id uuid;
  v_order_id uuid;
  v_saved_id uuid;
  v_order public.orders;
  v_existing public.invoice_requests;
  v_refusal text;
  v_company jsonb;
  v_saved public.saved_companies;
  v_request public.invoice_requests;
  v_save boolean;
  v_kept boolean := false;
  v_window record;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'an invoice request is a JSON object' using errcode = '22023';
  end if;
  v_client_id := app.checkout_uuid(p_request ->> 'request_id');
  v_order_id := app.checkout_uuid(p_request ->> 'order');
  v_saved_id := app.checkout_uuid(p_request ->> 'saved_company');
  if v_client_id is null or v_order_id is null
     or (p_request ? 'saved_company' and v_saved_id is null)
     or (p_request ? 'save' and jsonb_typeof(p_request -> 'save') <> 'boolean')
     or (v_saved_id is null) = (p_request -> 'company' is null) then
    raise exception 'an invoice request names its request id, the order, and either a company or a saved company' using errcode = '22023';
  end if;
  v_save := coalesce((p_request ->> 'save')::boolean, false);
  v_locked := app.code_attempt_gate('customer_invoice_request', v_login.tenant_id, null, v_login.user_id, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'request', null);
  end if;
  perform app.code_attempt_record('customer_invoice_request', v_login.tenant_id, null, v_login.user_id, p_at);
  select o.* into v_order from public.orders o where o.id = v_order_id and o.customer_login_id = v_login.id for update;
  if v_order.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_order', 'request', null);
  end if;
  if v_saved_id is not null then
    select c.* into v_saved from public.saved_companies c where c.id = v_saved_id and c.customer_login_id = v_login.id;
    if v_saved.id is null then
      return jsonb_build_object('state', 'refused', 'refusal', 'unknown_company', 'request', null);
    end if;
    v_company := jsonb_build_object('fields', '[]'::jsonb, 'tax_code', v_saved.tax_code, 'company_name', v_saved.company_name,
      'address', v_saved.address, 'email', v_saved.email);
  else
    v_company := app.einvoice_company_input(p_request -> 'company');
  end if;
  select r.* into v_existing from public.invoice_requests r where r.order_id = v_order.id;
  if v_existing.id is not null and v_existing.client_request_id = v_client_id then
    if jsonb_array_length(v_company -> 'fields') = 0 and v_existing.request_hash = app.einvoice_request_hash(v_order.id, v_company) then
      return jsonb_build_object('state', 'received', 'refusal', null, 'replayed', true, 'request', app.invoice_request_json(v_existing), 'saved', null);
    end if;
    return jsonb_build_object('state', 'refused', 'refusal', 'request_conflict', 'request', null);
  end if;
  v_refusal := app.einvoice_request_refusal(v_order, p_at);
  if v_refusal is not null then
    select w.* into v_window from app.einvoice_window(v_order) w;
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal,
      'last_day', case when v_order.paid_at is not null then to_char(v_window.last_day, 'YYYY-MM-DD') end,
      'request', case when v_refusal = 'already_requested' then app.invoice_request_json(v_existing) end);
  end if;
  if jsonb_array_length(v_company -> 'fields') > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'invalid', 'fields', v_company -> 'fields', 'request', null);
  end if;
  v_request := app.einvoice_create_request(v_order, 'app', v_login.id, null, v_client_id, v_company, p_at);
  if v_save then
    if exists (select 1 from public.saved_companies c where c.customer_login_id = v_login.id and c.tax_code = v_company ->> 'tax_code')
       or (select count(*) from public.saved_companies c where c.customer_login_id = v_login.id) < 10 then
      insert into public.saved_companies as c (tenant_id, customer_login_id, tax_code, company_name, address, email, created_at, updated_at)
      values (v_login.tenant_id, v_login.id, v_company ->> 'tax_code', v_company ->> 'company_name', v_company ->> 'address', v_company ->> 'email', p_at, p_at)
      on conflict (customer_login_id, tax_code) do update
      set company_name = excluded.company_name, address = excluded.address, email = excluded.email, updated_at = excluded.updated_at;
      v_kept := true;
    end if;
  end if;
  return jsonb_build_object('state', 'received', 'refusal', null, 'replayed', false, 'request', app.invoice_request_json(v_request), 'saved', v_kept);
end;
$$;

comment on function app.customer_request_invoice(jsonb, timestamptz) is 'C18 "Xin hóa đơn công ty": the caller asks for a company invoice for their own order with a company (tax_code, company_name, address, email) or one of their saved companies, optionally saving it (at most 10; saved answers whether it was kept). In order: 22023 for a malformed request; rate_limited (10 calls an hour per customer, 1,000 per tenant); unknown_order (another customer''s order or an unknown id alike); unknown_company; the same request id again answers the first request (replayed) or request_conflict when its content differs; the refusals of app.einvoice_request_refusal (already_requested with the request, einvoice_off, not_paid, refunded, nothing_to_invoice, window_passed with the last day); invalid with the fields in error; then the request is received and the company invoice that replaces the sale invoice is queued. 42501 without a customer session';

create function app.customer_saved_companies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
begin
  return jsonb_build_object('companies', coalesce((
    select jsonb_agg(app.customer_saved_company_json(c) order by c.updated_at desc, c.id)
    from public.saved_companies c where c.customer_login_id = v_login.id), '[]'::jsonb));
end;
$$;

comment on function app.customer_saved_companies() is 'C18: the caller''s saved companies, the most recently used first; 42501 without a customer session';

create function app.customer_delete_saved_company(p_company_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_rows integer;
begin
  delete from public.saved_companies c where c.id = p_company_id and c.customer_login_id = v_login.id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'unknown_company');
  end if;
  return jsonb_build_object('state', 'deleted', 'refusal', null);
end;
$$;

comment on function app.customer_delete_saved_company(uuid) is 'C18 and C19 ("Xóa được ở mục Dữ liệu của bạn"): deletes one of the caller''s saved companies; another customer''s or an unknown id answers unknown_company; 42501 without a customer session';

-- 9. The counter (Q01) --------------------------------------------------------------------------------------------

create function app.counter_request_invoice(p_order_id uuid, p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders := app.order_for_counter(p_order_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_uid uuid := (select auth.uid());
  v_client_id uuid;
  v_company jsonb;
  v_existing public.invoice_requests;
  v_refusal text;
  v_request public.invoice_requests;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'an invoice request is a JSON object' using errcode = '22023';
  end if;
  v_client_id := app.checkout_uuid(p_request ->> 'request_id');
  if v_client_id is null or p_request -> 'company' is null then
    raise exception 'an invoice request names its request id and the company' using errcode = '22023';
  end if;
  if v_order.source <> 'counter' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_counter_order', 'request', null);
  end if;
  v_company := app.einvoice_company_input(p_request -> 'company');
  select r.* into v_existing from public.invoice_requests r where r.order_id = v_order.id;
  if v_existing.id is not null and v_existing.client_request_id = v_client_id then
    if jsonb_array_length(v_company -> 'fields') = 0 and v_existing.request_hash = app.einvoice_request_hash(v_order.id, v_company) then
      return jsonb_build_object('state', 'received', 'refusal', null, 'replayed', true, 'request', app.invoice_request_json(v_existing));
    end if;
    return jsonb_build_object('state', 'refused', 'refusal', 'request_conflict', 'request', null);
  end if;
  v_refusal := app.einvoice_request_refusal(v_order, p_at);
  if v_refusal is not null then
    return jsonb_build_object('state', 'refused', 'refusal', v_refusal,
      'request', case when v_refusal = 'already_requested' then app.invoice_request_json(v_existing) end);
  end if;
  if jsonb_array_length(v_company -> 'fields') > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'invalid', 'fields', v_company -> 'fields', 'request', null);
  end if;
  v_request := app.einvoice_create_request(v_order, 'counter', null, v_uid, v_client_id, v_company, p_at);
  return jsonb_build_object('state', 'received', 'refusal', null, 'replayed', false, 'request', app.invoice_request_json(v_request));
end;
$$;

comment on function app.counter_request_invoice(uuid, jsonb, timestamptz) is 'Q01''s company invoice row: staff, managers and owners of the store key a company (the same fields and checks as C18) for a counter order (not_counter_order for an order of the app, which its customer asks for in the app); idempotent per request id (replayed, request_conflict); the refusals of app.einvoice_request_refusal; invalid with the fields; 42501 for anyone else and for an unknown order';

create function app.counter_order_einvoice(p_order_id uuid)
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
    raise exception 'only a member of the order''s store reads its e-invoice' using errcode = '42501';
  end if;
  return app.einvoice_pill(v_order.id) || jsonb_build_object('order_id', v_order.id,
    'request', (select app.invoice_request_json(r) from public.invoice_requests r where r.order_id = v_order.id));
end;
$$;

comment on function app.counter_order_einvoice(uuid) is 'the counter''s e-invoice pill of one order (Q01 frame 6, the queue card): app.einvoice_pill and the company invoice request; staff, managers and owners of the store, 42501 for anyone else and for an unknown order';

-- 10. The managers ------------------------------------------------------------------------------------------------

create function app.manager_einvoices(p_store_id uuid, p_filter text default 'failing', p_limit integer default 50)
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
    raise exception 'only owners and managers of the store read its e-invoices' using errcode = '42501';
  end if;
  if p_filter is null or p_filter not in ('failing', 'pending', 'all') then
    raise exception 'a filter is failing, pending or all' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'failing', (select count(*) from public.e_invoices e where e.store_id = v_store.id and e.state = 'failed')::integer,
    'gave_up', (select count(*) from public.e_invoices e where e.store_id = v_store.id and e.state = 'failed' and e.gave_up_at is not null)::integer,
    'pending', (select count(*) from public.e_invoices e where e.store_id = v_store.id and e.state in ('queued', 'issuing'))::integer,
    'emails_failing', (select count(*) from public.invoice_requests r where r.store_id = v_store.id and r.status = 'issued'
      and r.emailed_at is null and r.email_attempts > 0)::integer,
    'invoices', coalesce((select jsonb_agg(x.item order by x.sort_at desc, x.id) from (
      select e.id, coalesce(e.last_attempt_at, e.queued_at) as sort_at, app.einvoice_doc_json(e) || jsonb_build_object(
        'order_id', e.order_id, 'display_no', app.order_display_no(o.order_no), 'business_date', to_char(o.business_date, 'YYYY-MM-DD'),
        'reason', e.reason, 'attempts', e.attempts, 'last_error_class', e.last_error_class, 'last_attempt_at', e.last_attempt_at,
        'next_attempt_at', e.next_attempt_at, 'gave_up_at', e.gave_up_at, 'queued_at', e.queued_at,
        'request_status', (select r.status from public.invoice_requests r where r.id = e.request_id)) as item
      from public.e_invoices e join public.orders o on o.id = e.order_id
      where e.store_id = v_store.id
        and case p_filter when 'failing' then e.state = 'failed' when 'pending' then e.state in ('queued', 'issuing') else true end
      order by coalesce(e.last_attempt_at, e.queued_at) desc, e.id
      limit greatest(least(coalesce(p_limit, 50), 200), 1)) x), '[]'::jsonb));
end;
$$;

comment on function app.manager_einvoices(uuid, text, integer) is 'the managers'' list of a store''s e-invoices (ADR-069): failing (retrying or given up) by default, pending, or all, newest attempt first, with the counts of failing, given-up and pending invoices and of company invoice emails that failed; error classes only, never a buyer''s data; owners and managers of the store';

create function app.manager_retry_einvoice(p_invoice_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invoice public.e_invoices;
begin
  select e.* into v_invoice from public.e_invoices e where e.id = p_invoice_id for update;
  if v_invoice.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_invoice.tenant_id, v_invoice.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only owners and managers of the store retry its e-invoices' using errcode = '42501';
  end if;
  if v_invoice.state <> 'failed' then
    return jsonb_build_object('state', v_invoice.state, 'refusal', 'not_failed');
  end if;
  update public.e_invoices e
  set state = 'queued', round_attempts = 0, next_attempt_at = null, gave_up_at = null, queued_at = least(e.queued_at, p_at)
  where e.id = v_invoice.id;
  if v_invoice.request_id is not null then
    update public.invoice_requests r set status = 'received', closed_at = null where r.id = v_invoice.request_id and r.status = 'failed';
  end if;
  return jsonb_build_object('state', 'queued', 'refusal', null);
end;
$$;

comment on function app.manager_retry_einvoice(uuid, timestamptz) is 'an owner or manager of the store sends a failed e-invoice again now (after the key or the data was fixed): queued with a fresh round of 10 attempts; the next attempt still asks the provider first, so nothing is made twice; not_failed for any other state';

-- 11. The job -----------------------------------------------------------------------------------------------------

create table app.einvoice_job_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text check (function_url is null or function_url ~ '^https?://[^[:space:]]+$'),
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 150000),
  ticket_lifetime interval not null default interval '5 minutes' check (ticket_lifetime between interval '1 minute' and interval '1 hour'),
  updated_at timestamptz not null default now()
);

insert into app.einvoice_job_settings default values;

create table app.einvoice_job_tickets (
  ticket uuid primary key default gen_random_uuid(),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  request_id bigint
);

comment on table app.einvoice_job_settings is 'single row of the e-invoice minute job (ADR-069): whether it wakes the einvoice-job function and at which URL';
comment on table app.einvoice_job_tickets is 'single-use tickets the minute job posts by id to einvoice-job, which claims one before it does anything';

alter table app.einvoice_job_settings enable row level security;
alter table app.einvoice_job_tickets enable row level security;
revoke all on table app.einvoice_job_settings, app.einvoice_job_tickets from public, anon, authenticated, service_role;

create function app.einvoice_ready(p_invoice public.e_invoices, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (p_invoice.state = 'queued' or (p_invoice.state = 'failed' and p_invoice.next_attempt_at <= p_at)
      or (p_invoice.state = 'issuing' and p_invoice.claimed_until <= p_at))
    and exists (select 1 from public.einvoice_providers p where p.id = p_invoice.provider_id and p.mode <> 'off')
    and case p_invoice.kind
      when 'sale' then not exists (select 1 from public.orders o, app.order_money(o.id) m
        where o.id = p_invoice.order_id and o.status = 'cancelled' and m.refund_open > 0)
      when 'replacement' then p_invoice.attempts > 0 or exists (select 1 from public.e_invoices s
        where s.order_id = p_invoice.order_id and s.kind = 'sale' and s.state in ('issued', 'adjusted'))
      else not exists (select 1 from public.e_invoices d
        where d.order_id = p_invoice.order_id and d.id <> p_invoice.id
          and ((d.kind in ('sale', 'replacement') and (d.state in ('queued', 'issuing') or (d.state = 'failed' and d.next_attempt_at is not null)))
            or (d.kind in ('adjustment', 'cancellation') and d.state in ('issuing', 'failed') and d.queued_at <= p_invoice.queued_at)))
    end, false);
$$;

comment on function app.einvoice_ready(public.e_invoices, timestamptz) is 'whether the job may take a document now: queued, due again or with a lapsed claim, at a provider that is on; a sale invoice not while its order is cancelled and its refund is still owed (the refund will settle it); a company invoice once its sale invoice is issued (or when an earlier attempt may have reached the provider); a correction once nothing else of its order is on its way, oldest first';

create function app.einvoice_work_where(p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.e_invoices e
    where e.state in ('queued', 'failed', 'issuing') and app.einvoice_ready(e, p_at)
  ) or exists (
    select 1 from public.invoice_requests r
    where r.status = 'issued' and r.emailed_at is null and r.email_attempts < 5
      and (r.email_next_at is null or r.email_next_at <= p_at) and (r.email_claimed_until is null or r.email_claimed_until <= p_at)
  );
$$;

comment on function app.einvoice_work_where(timestamptz) is 'whether the e-invoice job has work now: a document queued, due again, or whose claim lapsed (at a provider that is on), or a company invoice email to send';

create function app.einvoice_lines_json(p_order public.orders, p_amount numeric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_agg(x.line order by x.n) from (
    select l.line_no as n, jsonb_build_object(
      'name', left(l.item_name || coalesce(' ' || l.size_label, '') || coalesce(' (' || (
        select string_agg(o ->> 'name', ', ' order by ord) from jsonb_array_elements(l.options) with ordinality as t (o, ord)) || ')', ''), 200),
      'quantity', l.quantity, 'unit_price', (l.unit_price + l.options_amount)::bigint, 'amount', l.line_total::bigint) as line
    from public.order_lines l where l.order_id = p_order.id
    union all
    select 1000, jsonb_build_object('name', 'Chiết khấu', 'quantity', 1, 'unit_price', -p_order.discount_amount::bigint, 'amount', -p_order.discount_amount::bigint)
    where p_order.discount_amount > 0
    union all
    select 1001, jsonb_build_object('name', 'Giảm trừ đã hoàn tiền', 'quantity', 1, 'unit_price', (p_amount - p_order.total)::bigint, 'amount', (p_amount - p_order.total)::bigint)
    where p_amount < p_order.total
  ) x), '[]'::jsonb);
$$;

comment on function app.einvoice_lines_json(public.orders, numeric) is 'the lines of an order''s sale or company invoice: one per order line (the item, size and options it was sold with, the unit price with the options), a discount line for a reward, and a line for what was already refunded, so the lines add up to the amount';

create function app.einvoice_job_item(p_invoice public.e_invoices, p_order public.orders, p_original public.e_invoices, p_provider public.einvoice_providers,
  p_query_first boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_id', p_invoice.id, 'claim', p_invoice.claim_token, 'kind', p_invoice.kind, 'action', p_invoice.action, 'reason', p_invoice.reason,
    'query_first', p_query_first, 'amount', p_invoice.amount::bigint, 'currency', 'VND',
    'sold_at', coalesce(p_order.paid_at, p_invoice.queued_at),
    'order', jsonb_build_object('id', p_order.id, 'display_no', app.order_display_no(p_order.order_no),
      'business_date', to_char(p_order.business_date, 'YYYY-MM-DD'), 'store_name', (select s.name from public.stores s where s.id = p_order.store_id)),
    'lines', case when p_invoice.kind in ('sale', 'replacement') then app.einvoice_lines_json(p_order, p_invoice.amount) else '[]'::jsonb end,
    'payment_methods', coalesce((select jsonb_agg(distinct p.method) from public.order_payments p where p.order_id = p_order.id and p.status = 'succeeded'), '[]'::jsonb),
    'buyer', (select jsonb_build_object('tax_code', r.tax_code, 'company_name', r.company_name, 'address', r.address, 'email', r.email)
      from public.invoice_requests r where r.id = p_invoice.request_id),
    'original', case when p_original.id is not null then jsonb_build_object('invoice_id', p_original.id, 'provider_ref', p_original.provider_ref,
      'invoice_no', p_original.invoice_no, 'series', p_original.invoice_series, 'issued_at', p_original.issued_at,
      'amount', app.einvoice_provider_amount(p_original)::bigint) end,
    'provider', app.einvoice_provider_json(p_provider));
$$;

comment on function app.einvoice_job_item(public.e_invoices, public.orders, public.e_invoices, public.einvoice_providers, boolean) is 'one document as the job sends it: its claim, kind and action, whether to ask the provider first, the amount, the order''s number, date and store, the lines and payment methods (sale and company invoices), the buyer of a company invoice, the original document of a replacement or correction, and the provider row';

create function app.einvoice_job_work(p_limit integer default 10, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 10), 50), 1);
  v_row record;
  v_invoice public.e_invoices;
  v_order public.orders;
  v_original public.e_invoices;
  v_provider public.einvoice_providers;
  v_net numeric;
  v_amount numeric;
  v_action text;
  v_query_first boolean;
  v_items jsonb := '[]'::jsonb;
  v_emails jsonb := '[]'::jsonb;
  v_request record;
begin
  for v_row in
    select e.id
    from public.e_invoices e
    where e.state in ('queued', 'failed', 'issuing') and app.einvoice_ready(e, p_at)
    order by case e.kind when 'sale' then 0 when 'replacement' then 1 else 2 end, e.queued_at, e.id
    limit v_limit
    for update of e skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('fnb-einvoice:' || (select e.order_id from public.e_invoices e where e.id = v_row.id)::text, 0));
    select e.* into v_invoice from public.e_invoices e where e.id = v_row.id;
    select o.* into v_order from public.orders o where o.id = v_invoice.order_id;
    select p.* into v_provider from public.einvoice_providers p where p.id = v_invoice.provider_id;
    v_net := app.einvoice_order_net(v_order.id);
    v_query_first := v_invoice.attempts > 0;
    v_original := null;
    if v_invoice.kind = 'sale' then
      v_action := 'issue';
      v_amount := greatest(v_net, 0);
    elsif v_invoice.kind = 'replacement' then
      v_action := 'replace';
      v_amount := greatest(v_net, 0);
      select e.* into v_original from public.e_invoices e
      where e.order_id = v_order.id and e.kind = 'sale' and e.state in ('issued', 'adjusted')
      order by e.issued_at desc, e.id limit 1;
      if v_original.id is null and v_invoice.original_id is not null then
        select e.* into v_original from public.e_invoices e where e.id = v_invoice.original_id;
      end if;
    else
      if v_invoice.original_id is not null and v_query_first then
        select e.* into v_original from public.e_invoices e where e.id = v_invoice.original_id;
      else
        v_original := app.einvoice_live(v_order.id);
      end if;
      if v_original.id is null then
        v_amount := 0;
        v_action := 'adjust';
      else
        v_amount := v_net - app.einvoice_provider_amount(v_original);
        v_action := case when v_net <= 0 then 'cancel' else 'adjust' end;
      end if;
    end if;
    -- nothing to send and nothing that may already be at the provider: settled here, without a call
    if not v_query_first and (v_amount = 0 and v_invoice.kind in ('adjustment', 'cancellation') or v_amount <= 0 and v_invoice.kind in ('sale', 'replacement')) then
      update public.e_invoices e
      set state = 'cancelled', settled_at = p_at, next_attempt_at = null, gave_up_at = null, claim_token = null, claimed_until = null,
          cancel_reason = case when e.kind in ('sale', 'replacement') then 'nothing_to_invoice' else 'nothing_to_change' end
      where e.id = v_invoice.id;
      if v_invoice.request_id is not null then
        update public.invoice_requests r set status = 'cancelled', closed_at = p_at where r.id = v_invoice.request_id and r.status in ('received', 'issuing', 'failed');
      end if;
      continue;
    end if;
    update public.e_invoices e
    set state = 'issuing', claim_token = gen_random_uuid(), claimed_until = p_at + interval '5 minutes',
        attempts = e.attempts + 1, round_attempts = e.round_attempts + 1, last_attempt_at = p_at, next_attempt_at = null, gave_up_at = null,
        action = v_action, amount = v_amount, mode = v_provider.mode::text, original_id = coalesce(v_original.id, e.original_id)
    where e.id = v_invoice.id
    returning e.* into v_invoice;
    if v_invoice.request_id is not null then
      update public.invoice_requests r set status = 'issuing' where r.id = v_invoice.request_id and r.status in ('received', 'failed');
    end if;
    v_items := v_items || jsonb_build_array(app.einvoice_job_item(v_invoice, v_order, v_original, v_provider, v_query_first));
  end loop;
  for v_request in
    select r.id from public.invoice_requests r
    where r.status = 'issued' and r.emailed_at is null and r.email_attempts < 5
      and (r.email_next_at is null or r.email_next_at <= p_at) and (r.email_claimed_until is null or r.email_claimed_until <= p_at)
    order by r.issued_at, r.id
    limit v_limit
    for update of r skip locked
  loop
    update public.invoice_requests r set email_claimed_until = p_at + interval '5 minutes' where r.id = v_request.id;
    v_emails := v_emails || jsonb_build_array((
      select jsonb_build_object('request_id', r.id, 'to', r.email, 'company_name', r.company_name, 'tax_code', r.tax_code,
        'order_display_no', app.order_display_no(o.order_no), 'store_name', s.name,
        'invoice', app.einvoice_doc_json(e))
      from public.invoice_requests r
      join public.orders o on o.id = r.order_id
      join public.stores s on s.id = r.store_id
      left join public.e_invoices e on e.id = r.einvoice_id
      where r.id = v_request.id));
  end loop;
  return jsonb_build_object('invoices', v_items, 'emails', v_emails);
end;
$$;

comment on function app.einvoice_job_work(integer, timestamptz) is 'the e-invoice job''s work list (ADR-069): takes up to p_limit documents (at most 50) whose provider is on, sale invoices first, a company invoice once its sale invoice is issued, a correction once nothing of its order is on its way; each is claimed for 5 minutes under a fresh claim (a second run skips it; a lapsed claim is taken again), counted as an attempt, and its amount fixed now: a sale or company invoice for what the order holds, a correction for the difference with what the provider holds (cancel when nothing is left); a document with nothing to send that never reached the provider is settled here without a call; an attempt after the first asks the provider first. Then up to p_limit company invoice emails to send (claimed for 5 minutes, 5 tries)';

create function app.einvoice_job_result(p_request jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(p_request ->> 'kind', 'invoice');
  v_id uuid;
  v_claim uuid;
  v_outcome text := p_request ->> 'outcome';
  v_class text;
  v_invoice public.e_invoices;
  v_amount numeric;
  v_ref text := p_request ->> 'provider_ref';
  v_action text := p_request ->> 'action';
  v_given_up boolean;
  v_failing integer;
  v_request public.invoice_requests;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' or v_kind not in ('invoice', 'email') then
    raise exception 'a result is a JSON object of kind invoice or email' using errcode = '22023';
  end if;
  if v_kind = 'email' then
    v_id := app.checkout_uuid(p_request ->> 'request_id');
    v_class := p_request ->> 'error_class';
    if v_id is null or jsonb_typeof(p_request -> 'ok') is distinct from 'boolean'
       or (not (p_request ->> 'ok')::boolean and (v_class is null or v_class not in ('timeout', 'unavailable', 'rejected', 'no_mailer', 'unknown'))) then
      raise exception 'an email result names the request, ok and, when not ok, its error class' using errcode = '22023';
    end if;
    select r.* into v_request from public.invoice_requests r where r.id = v_id for update;
    if v_request.id is null or v_request.status <> 'issued' or v_request.emailed_at is not null then
      return jsonb_build_object('state', 'stale');
    end if;
    if (p_request ->> 'ok')::boolean then
      update public.invoice_requests r set status = 'emailed', emailed_at = p_at, email_claimed_until = null, email_attempts = r.email_attempts + 1,
        email_error_class = null where r.id = v_id;
      return jsonb_build_object('state', 'emailed');
    end if;
    update public.invoice_requests r
    set email_attempts = r.email_attempts + 1, email_error_class = v_class, email_claimed_until = null,
        email_next_at = p_at + app.einvoice_backoff(r.email_attempts + 1) * 5
    where r.id = v_id;
    return jsonb_build_object('state', 'email_failed');
  end if;

  v_id := app.checkout_uuid(p_request ->> 'invoice_id');
  v_claim := app.checkout_uuid(p_request ->> 'claim');
  if v_id is null or v_claim is null or v_outcome is null or v_outcome not in ('issued', 'failed', 'not_found') then
    raise exception 'an invoice result names the invoice, its claim and the outcome (issued, failed, not_found)' using errcode = '22023';
  end if;
  select e.* into v_invoice from public.e_invoices e where e.id = v_id;
  if v_invoice.id is null then
    raise exception 'unknown e-invoice' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-einvoice:' || v_invoice.order_id::text, 0));
  select e.* into v_invoice from public.e_invoices e where e.id = v_id for update;
  if v_invoice.state <> 'issuing' or v_invoice.claim_token is distinct from v_claim then
    return jsonb_build_object('state', 'stale', 'current', v_invoice.state);
  end if;

  if v_outcome = 'issued' then
    if v_ref is null or char_length(v_ref) not between 1 and 100 or v_ref ~ '[[:cntrl:][:space:]]'
       or (p_request ? 'amount' and (jsonb_typeof(p_request -> 'amount') <> 'number' or (p_request ->> 'amount')::numeric <> trunc((p_request ->> 'amount')::numeric)))
       or (p_request ? 'emailed' and jsonb_typeof(p_request -> 'emailed') <> 'boolean')
       or (v_action is not null and v_action <> v_invoice.action
         and not (v_invoice.kind in ('adjustment', 'cancellation') and v_action in ('adjust', 'cancel'))) then
      raise exception 'an issued result names the provider''s reference, and the amount and action when given' using errcode = '22023';
    end if;
    v_amount := coalesce((p_request ->> 'amount')::numeric, v_invoice.amount);
    update public.e_invoices e
    set state = 'issued', claim_token = null, claimed_until = null, last_error_class = null, next_attempt_at = null,
        provider_ref = v_ref, amount = v_amount, action = coalesce(v_action, e.action),
        invoice_no = nullif(p_request ->> 'invoice_no', ''), invoice_series = nullif(p_request ->> 'series', ''),
        lookup_code = nullif(p_request ->> 'lookup_code', ''), lookup_url = nullif(p_request ->> 'lookup_url', ''),
        tax_authority_code = nullif(p_request ->> 'tax_authority_code', ''), issued_at = p_at, settled_at = p_at
    where e.id = v_invoice.id
    returning e.* into v_invoice;
    if v_invoice.kind = 'replacement' then
      update public.e_invoices e set state = 'replaced', settled_at = p_at
      where e.id = v_invoice.original_id and e.kind = 'sale' and e.state in ('issued', 'adjusted');
      update public.invoice_requests r
      set status = case when coalesce((p_request ->> 'emailed')::boolean, false) then 'emailed' else 'issued' end, issued_at = p_at, email_next_at = null,
          emailed_at = case when coalesce((p_request ->> 'emailed')::boolean, false) then p_at end
      where r.id = v_invoice.request_id and r.status in ('received', 'issuing', 'failed');
    elsif v_invoice.kind in ('adjustment', 'cancellation') and v_invoice.original_id is not null then
      update public.e_invoices e
      set state = case when v_invoice.action = 'cancel' then 'cancelled' else 'adjusted' end, settled_at = p_at
      where e.id = v_invoice.original_id and e.state in ('issued', 'adjusted');
    end if;
  elsif v_outcome = 'not_found' then
    if v_invoice.attempts < 2 or v_invoice.amount <> 0 and v_invoice.kind in ('adjustment', 'cancellation') or v_invoice.amount > 0 and v_invoice.kind in ('sale', 'replacement') then
      raise exception 'not_found settles only a document asked about again with nothing left to send' using errcode = '22023';
    end if;
    update public.e_invoices e
    set state = 'cancelled', claim_token = null, claimed_until = null, settled_at = p_at, next_attempt_at = null,
        cancel_reason = case when e.kind in ('sale', 'replacement') then 'nothing_to_invoice' else 'nothing_to_change' end
    where e.id = v_invoice.id
    returning e.* into v_invoice;
    if v_invoice.request_id is not null then
      update public.invoice_requests r set status = 'cancelled', closed_at = p_at where r.id = v_invoice.request_id and r.status in ('received', 'issuing', 'failed');
    end if;
  else
    v_class := coalesce(p_request ->> 'error_class', 'unknown');
    if not v_class = any (app.einvoice_error_classes()) then
      v_class := 'unknown';
    end if;
    v_given_up := not app.einvoice_retryable(v_class) or v_invoice.round_attempts >= 10;
    update public.e_invoices e
    set state = 'failed', claim_token = null, claimed_until = null, last_error_class = v_class,
        next_attempt_at = case when v_given_up then null else p_at + app.einvoice_backoff(e.round_attempts) end,
        gave_up_at = case when v_given_up then p_at end
    where e.id = v_invoice.id
    returning e.* into v_invoice;
    if v_given_up then
      if v_invoice.request_id is not null then
        update public.invoice_requests r set status = 'failed' where r.id = v_invoice.request_id and r.status in ('received', 'issuing');
      end if;
      select count(*) into v_failing from public.e_invoices e where e.store_id = v_invoice.store_id and e.state = 'failed' and e.gave_up_at is not null;
      perform * from app.raise_alert(v_invoice.tenant_id, 'einvoice_failed', 'store:' || v_invoice.store_id::text, 'operations', p_at,
        v_invoice.store_id, null, null, null, jsonb_build_object('failing', v_failing, 'attempts', v_invoice.attempts), null, true);
    end if;
    return jsonb_build_object('state', v_invoice.state, 'next_attempt_at', v_invoice.next_attempt_at, 'gave_up', v_invoice.gave_up_at is not null);
  end if;
  -- what the provider holds changed: a refund that came meanwhile needs its correction, an unpaid order its cancellation
  perform app.einvoice_reconcile(v_invoice.order_id, 'refund', p_at);
  return jsonb_build_object('state', v_invoice.state, 'next_attempt_at', v_invoice.next_attempt_at, 'gave_up', v_invoice.gave_up_at is not null);
end;
$$;

comment on function app.einvoice_job_result(jsonb, timestamptz) is 'the e-invoice job reports one outcome under the claim it was given (a lapsed or another claim answers stale and changes nothing, so two runs never record twice): issued with the provider''s reference, number, series, lookup code and URL, tax authority code and amount (a company invoice replaces its sale invoice, a correction adjusts or cancels its original, the request is issued, or emailed when the provider sent the email itself); not_found for a document asked about again that the provider never made and that has nothing left to send (cancelled); failed with an error class (retried after 1, 2, 4 … minutes, at most an hour, 10 times; given up at once for rejected_data, rejected_duplicate and unsupported, which raises einvoice_failed to owners and managers with count-only facts). Kind email: a company invoice email sent (emailed) or not (5 tries). An issued or not_found outcome reconciles the order';

create function app.einvoice_job_claim(p_ticket uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    delete from app.einvoice_job_tickets t where t.ticket = p_ticket and t.expires_at > now() returning 1
  )
  select exists (select 1 from claimed);
$$;

comment on function app.einvoice_job_claim(uuid) is 'claims a ticket of the e-invoice minute job once: true and deleted, false when unknown, used or expired';

create function app.einvoice_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings app.einvoice_job_settings;
  v_ticket uuid;
  v_request bigint;
begin
  delete from app.einvoice_job_tickets t where t.expires_at <= now();
  select s.* into v_settings from app.einvoice_job_settings s;
  if not coalesce(v_settings.enabled, false) or v_settings.function_url is null
     or exists (select 1 from app.einvoice_job_tickets)
     or not app.einvoice_work_where(p_at) then
    return jsonb_build_object('dispatched', 0);
  end if;
  insert into app.einvoice_job_tickets (issued_at, expires_at) values (now(), now() + v_settings.ticket_lifetime) returning ticket into v_ticket;
  select net.http_post(
    url := v_settings.function_url,
    body := jsonb_build_object('ticket', v_ticket),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := v_settings.request_timeout_ms
  ) into v_request;
  update app.einvoice_job_tickets t set request_id = v_request where t.ticket = v_ticket;
  return jsonb_build_object('dispatched', 1);
end;
$$;

comment on function app.einvoice_tick(timestamptz) is 'the minute job einvoice-tick: while the job is enabled with the einvoice-job URL and work is waiting, posts one ticket at a time to the function through pg_net';

create function app.enable_einvoice_jobs(p_function_url text, p_schedule text default '* * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_function_url is null or p_function_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'enable_einvoice_jobs needs the http(s) URL of the einvoice-job function' using errcode = '22023';
  end if;
  if p_schedule is null or btrim(p_schedule) = '' then
    raise exception 'enable_einvoice_jobs needs a cron schedule' using errcode = '22023';
  end if;
  update app.einvoice_job_settings set enabled = true, function_url = p_function_url, updated_at = now();
  return cron.schedule('einvoice-tick', p_schedule, 'select app.einvoice_tick(now())');
end;
$$;

create function app.disable_einvoice_jobs()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.einvoice_job_settings set enabled = false, updated_at = now();
  if exists (select 1 from cron.job j where j.jobname = 'einvoice-tick') then
    perform cron.unschedule('einvoice-tick');
  end if;
end;
$$;

comment on function app.enable_einvoice_jobs(text, text) is 'schedules the pg_cron job einvoice-tick (every minute by default) and lets it wake the einvoice-job function at that URL; the migration leaves it off';
comment on function app.disable_einvoice_jobs() is 'removes the pg_cron job einvoice-tick and stops waking the function';

-- 12. A customer's own data: the saved companies go with the login, the requests stay with their invoices ------------

create or replace function app.customer_delete_account(p_confirm boolean, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_open integer;
  v_refunds integer;
  v_counts jsonb;
  v_rows integer;
begin
  if p_confirm is distinct from true then
    raise exception 'deleting the account needs the customer''s confirmation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-customer-login:' || v_login.id::text, 0));
  if v_login.customer_id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'member_request', 'deleted', false);
  end if;
  select count(*) filter (where o.status = any (app.order_open_statuses())),
         count(*) filter (where o.payment_status = 'refund_pending' or exists (
           select 1 from public.order_refunds r where r.order_id = o.id and r.status in ('due', 'pending', 'failed')))
  into v_open, v_refunds
  from public.orders o where o.customer_login_id = v_login.id;
  if v_open > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'open_orders', 'deleted', false, 'orders', v_open);
  end if;
  if v_refunds > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'refund_pending', 'deleted', false, 'orders', v_refunds);
  end if;

  update public.order_lines l set note = null
  where l.note is not null and l.order_id in (select o.id from public.orders o where o.customer_login_id = v_login.id);
  get diagnostics v_rows = row_count;
  v_counts := jsonb_build_object('line_notes_cleared', v_rows);
  update public.orders o set note = null where o.customer_login_id = v_login.id and o.note is not null;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('order_notes_cleared', v_rows);
  v_counts := v_counts || jsonb_build_object(
    'orders_unlinked', (select count(*) from public.orders o where o.customer_login_id = v_login.id),
    'attached_orders_unlinked', (select count(*) from public.orders o where o.member_login_id = v_login.id),
    'staff_calls_unlinked', (select count(*) from public.table_calls c where c.customer_login_id = v_login.id),
    'stamp_cards', (select count(*) from public.stamp_cards c where c.customer_login_id = v_login.id),
    'stamp_entries', (select count(*) from public.stamp_entries e join public.stamp_cards c on c.id = e.card_id where c.customer_login_id = v_login.id),
    'stamp_rewards', (select count(*) from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id where c.customer_login_id = v_login.id),
    'member_codes', (select count(*) from app.stamp_member_codes m where m.customer_login_id = v_login.id),
    'requests', (select count(*) from public.store_requests r where r.customer_login_id = v_login.id),
    'order_blocks', (select count(*) from public.customer_order_blocks b where b.customer_login_id = v_login.id),
    'saved_companies', (select count(*) from public.saved_companies c where c.customer_login_id = v_login.id),
    'invoice_requests_unlinked', (select count(*) from public.invoice_requests r where r.customer_login_id = v_login.id)
  );

  insert into app.customer_login_erasures (tenant_id, login_hash, erased_at, counts)
  values (v_login.tenant_id, app.customer_login_hash(v_login), p_at, v_counts);

  delete from app.customer_logins l where l.id = v_login.id;
  delete from auth.users u
  where u.id = v_login.user_id
    and not exists (select 1 from public.tenant_members m where m.user_id = u.id)
    and not exists (select 1 from public.zalo_identities z where z.user_id = u.id)
    and not exists (select 1 from app.customer_logins l where l.user_id = u.id);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_rows);

  return jsonb_build_object('state', 'deleted', 'refusal', null, 'deleted', true, 'deleted_at', p_at, 'counts', v_counts);
end;
$$;

comment on function app.customer_delete_account(boolean, timestamptz) is 'C19 "Xóa tài khoản" for a customer who never joined with a phone, with p_confirm true (22023 otherwise): refused while an order of theirs is open (open_orders) or owes a refund (refund_pending), and for a joined customer (member_request: customer_request_deletion is their path); otherwise deletes the stamp card with its rewards and ledger, the member codes, the requests, the order blocks, the saved companies, the login and its Auth user with every session, clears the notes the customer typed on their orders, unlinks their orders, the counter orders attached to their card, their staff calls and their company invoice requests (the money records and the invoices'' buyer data stay for the legal period), records the deletion as a keyed hash with the counts in app.customer_login_erasures, and answers the counts; 42501 without a customer session (so a second call after the deletion is refused)';

create or replace function app.customer_export_data(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_brand uuid;
  v_out jsonb;
  v_counts jsonb;
begin
  select a.brand_id into v_brand from public.zalo_apps a where a.id = v_login.zalo_app_id;
  v_out := jsonb_build_object(
    'generated_at', p_at,
    'login', jsonb_build_object(
      'zalo_user_id', v_login.zalo_user_id,
      'brand', (select b.display_name from public.brands b where b.id = v_brand),
      'created_at', v_login.created_at,
      'joined', v_login.customer_id is not null
    ),
    'customer', (
      select jsonb_build_object('name', c.name, 'phone', c.phone, 'first_seen_at', c.first_seen_at, 'last_seen_at', c.last_seen_at)
      from public.customers c where c.id = v_login.customer_id and c.tenant_id = v_login.tenant_id
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('programme', p.name, 'status', m.status, 'joined_at', m.joined_at, 'channel', m.channel) order by m.joined_at, m.id)
      from public.memberships m join public.loyalty_programmes p on p.id = m.programme_id
      where m.customer_id = v_login.customer_id and m.tenant_id = v_login.tenant_id
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', r.purpose, 'policy_version', r.policy_version, 'channel', r.channel, 'granted_at', r.granted_at,
        'revoked_at', r.revoked_at) order by r.granted_at, r.id)
      from public.consent_records r
      where r.tenant_id = v_login.tenant_id and r.subject_type = 'customer' and r.subject_id = v_login.customer_id
    ), '[]'::jsonb),
    'stamp_card', (
      select jsonb_build_object(
        'stamps', c.stamps, 'total_earned', c.total_earned, 'created_at', c.created_at,
        'rewards', coalesce((select jsonb_agg(jsonb_build_object('status', r.status, 'stamps', r.stamps, 'issued_at', r.issued_at, 'used_at', r.used_at, 'voided_at', r.voided_at)
          order by r.issued_at, r.id) from public.stamp_rewards r where r.card_id = c.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'delta', e.delta, 'balance_after', e.balance_after, 'at', e.occurred_at,
          'order_no', app.order_display_no(o.order_no)) order by e.id)
          from public.stamp_entries e left join public.orders o on o.id = e.order_id where e.card_id = c.id), '[]'::jsonb)
      )
      from public.stamp_cards c where c.customer_login_id = v_login.id and c.brand_id = v_brand
    ),
    'orders', coalesce((
      select jsonb_agg(app.order_json(o, 'customer', p_at) || jsonb_build_object(
        'store_name', (select s.name from public.stores s where s.id = o.store_id),
        'money', app.order_money_json(o.id, 'customer')) order by o.placed_at, o.id)
      from public.orders o where o.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'attached_orders', coalesce((
      select jsonb_agg(jsonb_build_object('order_no', app.order_display_no(o.order_no), 'business_date', o.business_date,
        'store_name', (select s.name from public.stores s where s.id = o.store_id), 'status', o.status, 'total', o.total::bigint,
        'attached_at', o.member_attached_at) order by o.member_attached_at, o.id)
      from public.orders o where o.member_login_id = v_login.id
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(app.request_json(r, 'customer', p_at) || jsonb_build_object('contact_phone', r.contact_phone) order by r.created_at, r.id)
      from public.store_requests r where r.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'invoice_requests', coalesce((
      select jsonb_agg(app.invoice_request_json(r) order by r.requested_at, r.id)
      from public.invoice_requests r where r.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'saved_companies', coalesce((
      select jsonb_agg(app.customer_saved_company_json(c) order by c.created_at, c.id)
      from public.saved_companies c where c.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'staff_calls', coalesce((
      select jsonb_agg(jsonb_build_object('store_name', s.name, 'table', t.label, 'created_at', c.created_at, 'acknowledged_at', c.acknowledged_at)
        order by c.created_at, c.id)
      from public.table_calls c join public.stores s on s.id = c.store_id left join public.store_tables t on t.id = c.table_id
      where c.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'order_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('reason', b.reason, 'created_at', b.created_at, 'blocked_until', b.blocked_until) order by b.created_at, b.id)
      from public.customer_order_blocks b where b.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'deletion_request', case when v_login.customer_id is not null then app.customer_deletion_request(v_login.tenant_id, v_login.customer_id, p_at) end,
    'not_kept', jsonb_build_array('location', 'contacts', 'zalo_messages', 'card_numbers')
  );
  v_counts := jsonb_build_object(
    'orders', jsonb_array_length(v_out -> 'orders'),
    'attached_orders', jsonb_array_length(v_out -> 'attached_orders'),
    'requests', jsonb_array_length(v_out -> 'requests'),
    'invoice_requests', jsonb_array_length(v_out -> 'invoice_requests'),
    'saved_companies', jsonb_array_length(v_out -> 'saved_companies'),
    'staff_calls', jsonb_array_length(v_out -> 'staff_calls'),
    'stamp_entries', coalesce(jsonb_array_length(v_out -> 'stamp_card' -> 'entries'), 0),
    'memberships', jsonb_array_length(v_out -> 'memberships'),
    'consents', jsonb_array_length(v_out -> 'consents')
  );
  insert into app.customer_data_exports (tenant_id, customer_login_id, exported_at, counts) values (v_login.tenant_id, v_login.id, p_at, v_counts);
  return v_out || jsonb_build_object('counts', v_counts);
end;
$$;

comment on function app.customer_export_data(timestamptz) is 'C19 "Tải bản sao dữ liệu": everything the platform holds about the caller''s customer login as one JSON (the login and its Zalo user id, the joined customer''s name, phone and dates, memberships and consent records, the stamp card with every reward and ledger entry, every order with its lines and money as the customer sees them, the counter orders attached to the card, the requests with the contact typed, the company invoice requests and the saved companies, the staff calls, the order blocks, an open deletion request, and what is never kept), nothing of anyone else; each export recorded with its counts only; 42501 without a customer session';

-- 13. Public wrappers and grants ----------------------------------------------------------------------------------

create function public.einvoice_set_provider(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.einvoice_set_provider(p_request, now()); $$;
comment on function public.einvoice_set_provider(jsonb) is 'RPC for owners: app.einvoice_set_provider at the current time';

create function public.customer_invoice_status(p_order uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_invoice_status(p_order, now()); $$;
comment on function public.customer_invoice_status(uuid) is 'RPC for the customer Mini App (C18, C14): app.customer_invoice_status at the current time';

create function public.customer_request_invoice(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_request_invoice(p_request, now()); $$;
comment on function public.customer_request_invoice(jsonb) is 'RPC for the customer Mini App (C18): app.customer_request_invoice at the current time';

create function public.customer_saved_companies()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_saved_companies(); $$;
comment on function public.customer_saved_companies() is 'RPC for the customer Mini App (C18): app.customer_saved_companies';

create function public.customer_delete_saved_company(p_company uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_delete_saved_company(p_company); $$;
comment on function public.customer_delete_saved_company(uuid) is 'RPC for the customer Mini App (C18, C19): app.customer_delete_saved_company';

create function public.counter_request_invoice(p_order uuid, p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_request_invoice(p_order, p_request, now()); $$;
comment on function public.counter_request_invoice(uuid, jsonb) is 'RPC for the counter web app (Q01): app.counter_request_invoice at the current time';

create function public.counter_order_einvoice(p_order uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.counter_order_einvoice(p_order); $$;
comment on function public.counter_order_einvoice(uuid) is 'RPC for the counter web app (Q01): app.counter_order_einvoice';

create function public.manager_einvoices(p_store uuid, p_filter text default 'failing', p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_einvoices(p_store, p_filter, p_limit); $$;
comment on function public.manager_einvoices(uuid, text, integer) is 'RPC for owners and managers: app.manager_einvoices';

create function public.manager_retry_einvoice(p_invoice uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_retry_einvoice(p_invoice, now()); $$;
comment on function public.manager_retry_einvoice(uuid) is 'RPC for owners and managers: app.manager_retry_einvoice at the current time';

create function public.einvoice_job_claim(p_ticket uuid)
returns boolean language sql volatile security definer set search_path = ''
as $$ select app.einvoice_job_claim(p_ticket); $$;
comment on function public.einvoice_job_claim(uuid) is 'RPC for einvoice-job only (service_role): app.einvoice_job_claim';

create function public.einvoice_job_work(p_limit integer default 10)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.einvoice_job_work(p_limit, now()); $$;
comment on function public.einvoice_job_work(integer) is 'RPC for einvoice-job only (service_role): app.einvoice_job_work at the current time';

create function public.einvoice_job_result(p_request jsonb)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.einvoice_job_result(p_request, now()); $$;
comment on function public.einvoice_job_result(jsonb) is 'RPC for einvoice-job only (service_role): app.einvoice_job_result at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('einvoice_tax_code', 'einvoice_text_valid', 'einvoice_email_valid', 'einvoice_secret_name_valid', 'einvoice_settings_valid',
        'einvoice_provider_valid', 'einvoice_error_classes', 'einvoice_retryable', 'einvoice_provider_changes_append_only',
        'einvoice_provider_for', 'einvoice_provider_json', 'einvoice_set_provider', 'einvoice_order_net', 'einvoice_live', 'einvoice_provider_amount',
        'einvoice_backoff', 'einvoice_reconcile', 'einvoice_after_order', 'einvoice_after_refund', 'einvoice_doc_json', 'einvoice_pill',
        'invoice_request_json', 'einvoice_window', 'einvoice_request_refusal', 'einvoice_company_input', 'einvoice_request_hash',
        'einvoice_create_request', 'customer_invoice_status', 'customer_saved_company_json', 'customer_request_invoice', 'customer_saved_companies',
        'customer_delete_saved_company', 'counter_request_invoice', 'counter_order_einvoice', 'manager_einvoices', 'manager_retry_einvoice',
        'einvoice_ready', 'einvoice_work_where', 'einvoice_lines_json', 'einvoice_job_item', 'einvoice_job_work', 'einvoice_job_result', 'einvoice_job_claim',
        'einvoice_tick', 'enable_einvoice_jobs', 'disable_einvoice_jobs')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function app.current_customer_login_id() from public, anon, service_role;
grant execute on function app.current_customer_login_id() to authenticated;

revoke all on function public.einvoice_set_provider(jsonb), public.customer_invoice_status(uuid), public.customer_request_invoice(jsonb),
  public.customer_saved_companies(), public.customer_delete_saved_company(uuid), public.counter_request_invoice(uuid, jsonb),
  public.counter_order_einvoice(uuid), public.manager_einvoices(uuid, text, integer), public.manager_retry_einvoice(uuid)
  from public, anon, service_role;
grant execute on function public.einvoice_set_provider(jsonb), public.customer_invoice_status(uuid), public.customer_request_invoice(jsonb),
  public.customer_saved_companies(), public.customer_delete_saved_company(uuid), public.counter_request_invoice(uuid, jsonb),
  public.counter_order_einvoice(uuid), public.manager_einvoices(uuid, text, integer), public.manager_retry_einvoice(uuid)
  to authenticated;
revoke all on function public.einvoice_job_claim(uuid), public.einvoice_job_work(integer), public.einvoice_job_result(jsonb)
  from public, anon, authenticated;
grant execute on function public.einvoice_job_claim(uuid), public.einvoice_job_work(integer), public.einvoice_job_result(jsonb)
  to service_role;
