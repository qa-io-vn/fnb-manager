-- The native till, step 1 (ADR-060, docs/deep-dives/native-till.md sections 2 and 3): the per-store till mode and
-- ordering settings, the menu a native brand owns (categories, items, sizes with prices, option groups), the
-- append-only price log, per-store availability, the POS option groups the master-data run stores (the source of the
-- one-time import), the menu-photos bucket, the ordering state and the menu reads of the customer app and the counter.

-- 1. Validation helpers ----------------------------------------------------------------------------------------------

create function app.native_text_valid(p_text text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(char_length(p_text) between 1 and p_max and p_text = btrim(p_text) and p_text !~ '[[:cntrl:]]', false);
$$;

comment on function app.native_text_valid(text, integer) is 'a menu or settings text: 1 to p_max characters, no leading or trailing space, no control character (so one line)';

create function app.native_description_valid(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is null or (
    app.native_text_valid(p_text, 200)
    and p_text !~* '(https?://|www\.|[a-z0-9-]+\.(com|vn|net|org|me|io)(\M|/))'
    and p_text !~ '(\+?[0-9][ .-]?){9,}'
  );
$$;

comment on function app.native_description_valid(text) is 'a menu item description: null, or 1 to 200 characters on one line without a link (http, www or a domain) or a phone number (nine digits or more with spaces, dots or dashes between them), as Zalo''s review asks';

create function app.native_set_valid(p_values text[], p_allowed text[], p_min integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    cardinality(p_values) between p_min and cardinality(p_allowed)
      and p_values <@ p_allowed
      and array_position(p_values, null) is null
      and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as v),
    false
  );
$$;

comment on function app.native_set_valid(text[], text[], integer) is 'a set of codes: at least p_min of the allowed codes, each at most once';

create function app.native_price_valid(p_price numeric, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_price between p_min and p_max and p_price = trunc(p_price), false);
$$;

comment on function app.native_price_valid(numeric, numeric, numeric) is 'a whole number of dong between two bounds (VND has no fraction)';

create function app.native_restricted_guess(p_name text, p_type_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    lower(coalesce(p_name, '') || ' ' || coalesce(p_type_name, ''))
      ~ '\m(bia|beer|rượu|ruou|wine|vang đỏ|vang trắng|whisky|whiskey|vodka|soju|sake|cocktail|champagne|tequila|cider|gin|rum|brandy|cognac|alcohol|đồ uống có cồn)\M',
    false
  );
$$;

comment on function app.native_restricted_guess(text, text) is 'whether a POS item looks like alcohol or beer by its name or item type, which Zalo restricts; the import marks such items restricted and hidden, and the owner corrects the guess';

-- 2. The POS option groups (written by the master-data run; the import's source) -------------------------------------

create table public.item_option_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  external_id text not null,
  name text not null,
  min_select integer not null default 0 check (min_select between 0 and 20),
  max_select integer not null default 1 check (max_select between 1 and 20),
  active boolean not null default true,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (pos_account_id, external_id),
  check (max_select >= min_select),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade
);

create index item_option_groups_tenant_idx on public.item_option_groups (tenant_id);

create table public.item_option_group_options (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  group_external_id text not null,
  item_external_id text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (pos_account_id, group_external_id, item_external_id),
  foreign key (pos_account_id, group_external_id) references public.item_option_groups (pos_account_id, external_id) on delete cascade
);

create index item_option_group_options_tenant_idx on public.item_option_group_options (tenant_id);

create table public.item_option_group_targets (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  group_external_id text not null,
  item_external_id text not null,
  primary key (pos_account_id, group_external_id, item_external_id),
  foreign key (pos_account_id, group_external_id) references public.item_option_groups (pos_account_id, external_id) on delete cascade
);

create index item_option_group_targets_tenant_idx on public.item_option_group_targets (tenant_id);

comment on table public.item_option_groups is 'the POS option groups (iPOS customizations, one per customization and position) with their limits, written by the master-data run like the other catalogue tables; read by the one-time import of a native menu (ADR-060)';
comment on table public.item_option_group_options is 'the option items of a POS option group, by POS item id, in order; rewritten by every master-data run that maps option groups';
comment on table public.item_option_group_targets is 'the POS items a POS option group applies to; rewritten by every master-data run that maps option groups';

alter table public.item_option_groups enable row level security;
alter table public.item_option_group_options enable row level security;
alter table public.item_option_group_targets enable row level security;

create policy item_option_groups_select_for_data_members on public.item_option_groups
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));
create policy item_option_group_options_select_for_data_members on public.item_option_group_options
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));
create policy item_option_group_targets_select_for_data_members on public.item_option_group_targets
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

revoke all on public.item_option_groups, public.item_option_group_options, public.item_option_group_targets from anon, authenticated;
grant select on public.item_option_groups, public.item_option_group_options, public.item_option_group_targets to authenticated;

-- 3. Store settings, closures and presence -------------------------------------------------------------------------

create table public.store_ordering_settings (
  store_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  till_mode text not null default 'ipos' check (till_mode in ('ipos', 'native')),
  ordering_enabled boolean not null default false,
  order_types text[] not null default array['table']::text[] check (app.native_set_valid(order_types, array['table', 'takeaway'], 1)),
  payment_methods text[] not null default array['counter']::text[] check (app.native_set_valid(payment_methods, array['counter', 'zalo_checkout', 'vietqr'], 1)),
  payment_window_minutes integer not null default 15 check (payment_window_minutes between 5 and 60),
  late_order_minutes integer not null default 10 check (late_order_minutes between 1 and 120),
  prep_minutes integer not null default 10 check (prep_minutes between 0 and 120),
  last_order_minutes integer not null default 0 check (last_order_minutes between 0 and 120),
  max_order_amount numeric(14, 2) not null default 2000000 check (app.native_price_valid(max_order_amount, 50000, 20000000)),
  max_waiting_orders integer not null default 30 check (max_waiting_orders between 3 and 200),
  staff_presence_required boolean not null default true,
  paused_until timestamptz,
  paused_reason text check (paused_reason is null or app.native_text_valid(paused_reason, 80)),
  paused_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index store_ordering_settings_tenant_idx on public.store_ordering_settings (tenant_id);

comment on table public.store_ordering_settings is 'one row per store that has till or ordering settings (native-till.md section 2); a store without a row is an ipos store that takes no order';
comment on column public.store_ordering_settings.till_mode is 'ipos (the POS is the till, the default) or native (orders, payments and the menu live in this platform); written only through set_store_till_mode by an owner with every store';
comment on column public.store_ordering_settings.payment_methods is 'the ways a customer may pay: counter, and zalo_checkout and vietqr once their providers are configured (not writable from a client before that)';
comment on column public.store_ordering_settings.payment_window_minutes is 'an order waiting for an online payment is cancelled after this many minutes';
comment on column public.store_ordering_settings.late_order_minutes is 'an accepted or preparing order older than this is late on the counter screen';
comment on column public.store_ordering_settings.max_waiting_orders is 'accepted orders not yet started at which the store answers busy';

create table public.ordering_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  reason text not null check (app.native_text_valid(reason, 80)),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  constraint ordering_closures_span_check check (ends_on >= starts_on and ends_on - starts_on <= 61)
);

create index ordering_closures_store_idx on public.ordering_closures (store_id, starts_on, ends_on);
create index ordering_closures_tenant_idx on public.ordering_closures (tenant_id);

comment on table public.ordering_closures is 'business dates on which a store takes no order (a holiday, works): at most 62 days a row, with the reason customers are shown';

create table app.ordering_presence (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seen_at timestamptz not null,
  primary key (store_id, user_id)
);

create index ordering_presence_seen_idx on app.ordering_presence (store_id, seen_at desc);

comment on table app.ordering_presence is 'the last poll of each counter device per store (counter_board); a store takes no order without a fresh poll when staff presence is required; no API role reads it';

alter table app.ordering_presence enable row level security;
revoke all on table app.ordering_presence from public, anon, authenticated, service_role;

-- 4. The owned menu -----------------------------------------------------------------------------------------------

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  name text not null check (app.native_text_valid(name, 40)),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  visible boolean not null default true,
  source_item_type_external_id text check (source_item_type_external_id is null or char_length(source_item_type_external_id) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

create index menu_categories_tenant_idx on public.menu_categories (tenant_id);

comment on table public.menu_categories is 'the categories of a native brand''s menu, in order; hidden ones hide their items';

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  category_id uuid not null,
  name text not null check (app.native_text_valid(name, 60)),
  description text check (app.native_description_valid(description)),
  photo_path text,
  labels text[] not null default '{}'::text[] check (app.native_set_valid(labels, array['best_seller', 'new'], 0)),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  visible boolean not null default true,
  restricted boolean not null default false,
  counts_for_stamps boolean not null default true,
  order_types text[] not null default array['table', 'takeaway']::text[] check (app.native_set_valid(order_types, array['table', 'takeaway'], 1)),
  source_pos_account_id uuid,
  source_item_external_id text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  foreign key (brand_id, category_id) references public.menu_categories (brand_id, id) on delete restrict,
  constraint menu_items_visible_check check (not (visible and restricted)),
  constraint menu_items_photo_path_check check (
    photo_path is null
    or photo_path ~ ('^' || tenant_id::text || '/' || brand_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$')
  )
);

create index menu_items_tenant_idx on public.menu_items (tenant_id);
create index menu_items_category_idx on public.menu_items (category_id);

comment on table public.menu_items is 'an item of a native brand''s menu (ADR-060): name, description, photo, labels, order, whether it is on sale (visible), restricted (alcohol: never visible), whether it counts for stamps (a drink) and the order types it is offered for; its prices are its sizes';
comment on column public.menu_items.photo_path is 'the photo in the public bucket menu-photos: <tenant>/<brand>/<uuid>.webp|jpg|png, its thumbnail beside it as <uuid>-thumb.<ext>';
comment on column public.menu_items.source_item_external_id is 'the POS item the one-time import made this item from, for reference only; nothing keeps them in step';

create table public.menu_item_sizes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  item_id uuid not null,
  label text check (label is null or app.native_text_valid(label, 20)),
  price numeric(14, 2) not null check (app.native_price_valid(price, 1, 100000000)),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  is_default boolean not null default false,
  active boolean not null default true,
  source_item_external_id text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, id),
  foreign key (brand_id, item_id) references public.menu_items (brand_id, id) on delete cascade
);

create unique index menu_item_sizes_label_key on public.menu_item_sizes (item_id, lower(coalesce(label, '')));
create unique index menu_item_sizes_default_key on public.menu_item_sizes (item_id) where is_default;
create index menu_item_sizes_tenant_idx on public.menu_item_sizes (tenant_id);

comment on table public.menu_item_sizes is 'the sizes of a menu item, each with its full price in whole dong (a single-size item has one row without a label); every price insert and change is logged in menu_price_changes';

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  name text not null check (app.native_text_valid(name, 40)),
  min_select integer not null default 0 check (min_select between 0 and 20),
  max_select integer not null default 1 check (max_select between 1 and 20),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  source_external_id text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  check (max_select >= min_select)
);

create index menu_option_groups_tenant_idx on public.menu_option_groups (tenant_id);

comment on table public.menu_option_groups is 'an option group of a native brand (ice, sweetness, toppings) with how many options a customer picks (min_select to max_select), shared by the items it is linked to';

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  group_id uuid not null,
  name text not null check (app.native_text_valid(name, 40)),
  price_delta numeric(14, 2) not null default 0 check (app.native_price_valid(price_delta, 0, 1000000)),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  is_default boolean not null default false,
  active boolean not null default true,
  source_item_external_id text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (brand_id, id),
  foreign key (brand_id, group_id) references public.menu_option_groups (brand_id, id) on delete cascade
);

create unique index menu_options_name_key on public.menu_options (group_id, lower(name));
create index menu_options_tenant_idx on public.menu_options (tenant_id);

comment on table public.menu_options is 'an option of a group with the amount it adds in whole dong (0 to 1,000,000); price changes are logged';

create table public.menu_item_option_groups (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  item_id uuid not null,
  group_id uuid not null,
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  primary key (item_id, group_id),
  foreign key (brand_id, item_id) references public.menu_items (brand_id, id) on delete cascade,
  foreign key (brand_id, group_id) references public.menu_option_groups (brand_id, id) on delete cascade
);

create index menu_item_option_groups_group_idx on public.menu_item_option_groups (group_id);
create index menu_item_option_groups_tenant_idx on public.menu_item_option_groups (tenant_id);

comment on table public.menu_item_option_groups is 'which option groups an item offers, in order; item and group of one brand';

create table public.menu_store_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  item_id uuid not null references public.menu_items (id) on delete cascade,
  offered boolean not null default true,
  sold_out_until timestamptz,
  sold_out_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (store_id, item_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index menu_store_items_tenant_idx on public.menu_store_items (tenant_id);
create index menu_store_items_item_idx on public.menu_store_items (item_id);

comment on table public.menu_store_items is 'per-store availability of a menu item: whether the store offers it at all, and sold out until an instant (switched by staff at the counter; the item disappears from the customer menu at once); a missing row means offered and available';

create table public.menu_price_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  item_id uuid,
  size_id uuid,
  option_id uuid,
  subject_name text not null,
  old_price numeric(14, 2),
  new_price numeric(14, 2) not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  check (num_nonnulls(size_id, option_id) = 1)
);

create index menu_price_changes_brand_idx on public.menu_price_changes (brand_id, changed_at desc);
create index menu_price_changes_tenant_idx on public.menu_price_changes (tenant_id);

comment on table public.menu_price_changes is 'the append-only log of every menu price set or changed (a size''s price or an option''s amount): before, after, who and when, with the item and size or option name as they were; written by triggers, never by a client; kept when the item is deleted';

create table public.menu_imports (
  brand_id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  pos_account_id uuid not null,
  imported_by uuid references auth.users (id) on delete set null,
  imported_at timestamptz not null default now(),
  counts jsonb not null,
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.menu_imports is 'the one-time import of a brand''s menu from the POS catalogue of one of its stores (ADR-060): who, when and the counts; a brand imports once';

create table app.menu_versions (
  brand_id uuid primary key,
  tenant_id uuid not null,
  version bigint not null default 1 check (version >= 1),
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table app.menu_versions is 'the version of each brand''s menu, moved by every menu, availability and settings change; the customer app polls it (customer_menu_version) to drop a sold-out item within seconds; no API role reads it';

alter table app.menu_versions enable row level security;
revoke all on table app.menu_versions from public, anon, authenticated, service_role;

-- 5. Scope, guards, versions and the price log ------------------------------------------------------------------

create function app.brand_in_scope(p_tenant_id uuid, p_brand_id uuid, p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brands b
    join public.tenant_members m on m.tenant_id = b.tenant_id
    where b.id = p_brand_id
      and b.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
      and (m.store_ids is null or b.store_ids <@ m.store_ids)
  );
$$;

comment on function app.brand_in_scope(uuid, uuid, public.tenant_role[]) is 'whether the caller holds one of the roles in the brand''s tenant with every store of the brand in scope: the rule for writing a native brand''s menu';

create function app.bump_menu_versions(p_brand_ids uuid[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.menu_versions as v (brand_id, tenant_id, version, changed_at)
  select b.id, b.tenant_id, 1, now()
  from public.brands b
  where b.id = any (p_brand_ids)
  order by b.id
  on conflict (brand_id) do update
  set version = v.version + 1,
      changed_at = excluded.changed_at;
$$;

comment on function app.bump_menu_versions(uuid[]) is 'moves the menu version of each brand by one (a first change stores 1)';

create function app.menu_version(p_brand_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.version from app.menu_versions v where v.brand_id = p_brand_id), 0);
$$;

comment on function app.menu_version(uuid) is 'the brand''s menu version, 0 before any change';

create function app.menu_brand_ids_of_store(p_store_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.id order by b.id), '{}'::uuid[]) from public.brands b where p_store_id = any (b.store_ids);
$$;

comment on function app.menu_brand_ids_of_store(uuid) is 'the brands covering a store';

create function app.menu_version_by_brand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.bump_menu_versions(array[coalesce(new.brand_id, old.brand_id)]::uuid[]);
  return null;
end;
$$;

create function app.menu_version_by_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.bump_menu_versions(app.menu_brand_ids_of_store(coalesce(new.store_id, old.store_id)));
  return null;
end;
$$;

comment on function app.menu_version_by_brand() is 'trigger after a change of a brand menu row: moves the brand''s menu version';
comment on function app.menu_version_by_store() is 'trigger after a change of a store''s availability, settings or closures: moves the menu version of every brand covering the store';

create function app.menu_keys_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) ->> 'tenant_id') is distinct from (to_jsonb(old) ->> 'tenant_id')
     or (to_jsonb(new) ->> 'brand_id') is distinct from (to_jsonb(old) ->> 'brand_id')
     or (to_jsonb(new) ->> 'store_id') is distinct from (to_jsonb(old) ->> 'store_id')
     or (to_jsonb(new) ->> 'item_id') is distinct from (to_jsonb(old) ->> 'item_id')
     or (to_jsonb(new) ->> 'group_id') is distinct from (to_jsonb(old) ->> 'group_id')
  then
    raise exception '% keeps its tenant, brand, store, item and group', tg_table_name using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function app.menu_keys_fixed() is 'trigger before a menu or ordering row is updated: its tenant, brand, store, item and group never change (move by adding a row)';

create function app.menu_store_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.menu_items i
    join public.brands b on b.id = i.brand_id
    where i.id = new.item_id
      and i.tenant_id = new.tenant_id
      and new.store_id = any (b.store_ids)
  ) then
    raise exception 'the item is not on the menu of a brand covering the store' using errcode = '23503';
  end if;
  return new;
end;
$$;

comment on function app.menu_store_items_guard() is 'trigger before a store availability row is written: the item belongs to a brand that covers the store (23503)';

create function app.log_menu_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_table_name = 'menu_item_sizes' then
    if tg_op = 'UPDATE' and new.price = old.price then
      return null;
    end if;
    select i.name || coalesce(' (' || new.label || ')', '') into v_name from public.menu_items i where i.id = new.item_id;
    insert into public.menu_price_changes (tenant_id, brand_id, item_id, size_id, subject_name, old_price, new_price, changed_by)
    values (new.tenant_id, new.brand_id, new.item_id, new.id, coalesce(v_name, '?'), case when tg_op = 'UPDATE' then old.price end, new.price, (select auth.uid()));
  else
    if tg_op = 'UPDATE' and new.price_delta = old.price_delta then
      return null;
    end if;
    select g.name || ': ' || new.name into v_name from public.menu_option_groups g where g.id = new.group_id;
    insert into public.menu_price_changes (tenant_id, brand_id, option_id, subject_name, old_price, new_price, changed_by)
    values (new.tenant_id, new.brand_id, new.id, coalesce(v_name, new.name), case when tg_op = 'UPDATE' then old.price_delta end, new.price_delta, (select auth.uid()));
  end if;
  return null;
end;
$$;

comment on function app.log_menu_price() is 'trigger after a size price or an option amount is inserted or changed: writes the price log row with the old and new amount, who (auth.uid()) and when; an update that keeps the price writes nothing';

create function app.keep_menu_price_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.tenants t where t.id = old.tenant_id)
    or not exists (select 1 from public.brands b where b.id = old.brand_id)
  ) then
    return old;
  end if;
  raise exception 'menu_price_changes is an append-only log' using errcode = '42501';
end;
$$;

create function app.refuse_menu_price_changes_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'menu_price_changes is an append-only log and is never truncated' using errcode = '42501';
end;
$$;

comment on function app.keep_menu_price_changes() is 'trigger refusing every update and delete of the price log, for every role; only the deletion of the whole tenant or brand removes rows';

create trigger menu_categories_set_updated_at before update on public.menu_categories for each row execute function app.set_updated_at();
create trigger menu_categories_keep_created_by before update on public.menu_categories for each row execute function app.keep_created_by();
create trigger menu_categories_set_updated_by before insert or update on public.menu_categories for each row execute function app.set_updated_by();
create trigger menu_categories_keys before update on public.menu_categories for each row execute function app.menu_keys_fixed();
create trigger menu_categories_version after insert or update or delete on public.menu_categories for each row execute function app.menu_version_by_brand();

create trigger menu_items_set_updated_at before update on public.menu_items for each row execute function app.set_updated_at();
create trigger menu_items_keep_created_by before update on public.menu_items for each row execute function app.keep_created_by();
create trigger menu_items_set_updated_by before insert or update on public.menu_items for each row execute function app.set_updated_by();
create trigger menu_items_keys before update on public.menu_items for each row execute function app.menu_keys_fixed();
create trigger menu_items_version after insert or update or delete on public.menu_items for each row execute function app.menu_version_by_brand();

create trigger menu_item_sizes_set_updated_at before update on public.menu_item_sizes for each row execute function app.set_updated_at();
create trigger menu_item_sizes_keep_created_by before update on public.menu_item_sizes for each row execute function app.keep_created_by();
create trigger menu_item_sizes_set_updated_by before insert or update on public.menu_item_sizes for each row execute function app.set_updated_by();
create trigger menu_item_sizes_keys before update on public.menu_item_sizes for each row execute function app.menu_keys_fixed();
create trigger menu_item_sizes_version after insert or update or delete on public.menu_item_sizes for each row execute function app.menu_version_by_brand();
create trigger menu_item_sizes_price_log after insert or update of price on public.menu_item_sizes for each row execute function app.log_menu_price();

create trigger menu_option_groups_set_updated_at before update on public.menu_option_groups for each row execute function app.set_updated_at();
create trigger menu_option_groups_keep_created_by before update on public.menu_option_groups for each row execute function app.keep_created_by();
create trigger menu_option_groups_set_updated_by before insert or update on public.menu_option_groups for each row execute function app.set_updated_by();
create trigger menu_option_groups_keys before update on public.menu_option_groups for each row execute function app.menu_keys_fixed();
create trigger menu_option_groups_version after insert or update or delete on public.menu_option_groups for each row execute function app.menu_version_by_brand();

create trigger menu_options_set_updated_at before update on public.menu_options for each row execute function app.set_updated_at();
create trigger menu_options_keep_created_by before update on public.menu_options for each row execute function app.keep_created_by();
create trigger menu_options_set_updated_by before insert or update on public.menu_options for each row execute function app.set_updated_by();
create trigger menu_options_keys before update on public.menu_options for each row execute function app.menu_keys_fixed();
create trigger menu_options_version after insert or update or delete on public.menu_options for each row execute function app.menu_version_by_brand();
create trigger menu_options_price_log after insert or update of price_delta on public.menu_options for each row execute function app.log_menu_price();

create trigger menu_item_option_groups_keys before update on public.menu_item_option_groups for each row execute function app.menu_keys_fixed();
create trigger menu_item_option_groups_version after insert or update or delete on public.menu_item_option_groups for each row execute function app.menu_version_by_brand();

create trigger menu_store_items_guard before insert or update on public.menu_store_items for each row execute function app.menu_store_items_guard();
create trigger menu_store_items_set_updated_at before update on public.menu_store_items for each row execute function app.set_updated_at();
create trigger menu_store_items_keep_created_by before update on public.menu_store_items for each row execute function app.keep_created_by();
create trigger menu_store_items_set_updated_by before insert or update on public.menu_store_items for each row execute function app.set_updated_by();
create trigger menu_store_items_keys before update on public.menu_store_items for each row execute function app.menu_keys_fixed();
create trigger menu_store_items_version after insert or update or delete on public.menu_store_items for each row execute function app.menu_version_by_store();

create trigger menu_price_changes_append_only before update or delete on public.menu_price_changes for each row execute function app.keep_menu_price_changes();
create trigger menu_price_changes_no_truncate before truncate on public.menu_price_changes for each statement execute function app.refuse_menu_price_changes_truncate();

create trigger store_ordering_settings_set_updated_at before update on public.store_ordering_settings for each row execute function app.set_updated_at();
create trigger store_ordering_settings_keep_created_by before update on public.store_ordering_settings for each row execute function app.keep_created_by();
create trigger store_ordering_settings_set_updated_by before insert or update on public.store_ordering_settings for each row execute function app.set_updated_by();
create trigger store_ordering_settings_keys before update on public.store_ordering_settings for each row execute function app.menu_keys_fixed();
create trigger store_ordering_settings_version after insert or update or delete on public.store_ordering_settings for each row execute function app.menu_version_by_store();

create trigger ordering_closures_set_updated_at before update on public.ordering_closures for each row execute function app.set_updated_at();
create trigger ordering_closures_keep_created_by before update on public.ordering_closures for each row execute function app.keep_created_by();
create trigger ordering_closures_set_updated_by before insert or update on public.ordering_closures for each row execute function app.set_updated_by();
create trigger ordering_closures_keys before update on public.ordering_closures for each row execute function app.menu_keys_fixed();
create trigger ordering_closures_version after insert or update or delete on public.ordering_closures for each row execute function app.menu_version_by_store();

-- 6. Row level security and grants -----------------------------------------------------------------------------

alter table public.store_ordering_settings enable row level security;
alter table public.ordering_closures enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_item_sizes enable row level security;
alter table public.menu_option_groups enable row level security;
alter table public.menu_options enable row level security;
alter table public.menu_item_option_groups enable row level security;
alter table public.menu_store_items enable row level security;
alter table public.menu_price_changes enable row level security;
alter table public.menu_imports enable row level security;

create policy store_ordering_settings_select on public.store_ordering_settings
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy store_ordering_settings_insert on public.store_ordering_settings
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy store_ordering_settings_update on public.store_ordering_settings
  for update to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

create policy ordering_closures_select on public.ordering_closures
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy ordering_closures_insert on public.ordering_closures
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy ordering_closures_update on public.ordering_closures
  for update to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy ordering_closures_delete on public.ordering_closures
  for delete to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['menu_categories', 'menu_items', 'menu_item_sizes', 'menu_option_groups', 'menu_options', 'menu_item_option_groups'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.has_tenant_role(tenant_id, array[''owner'', ''manager'', ''viewer'']::public.tenant_role[]))',
      v_table || '_select', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.brand_in_scope(tenant_id, brand_id, array[''owner'', ''manager'']::public.tenant_role[]))',
      v_table || '_insert', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.brand_in_scope(tenant_id, brand_id, array[''owner'', ''manager'']::public.tenant_role[])) with check (app.brand_in_scope(tenant_id, brand_id, array[''owner'', ''manager'']::public.tenant_role[]))',
      v_table || '_update', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app.brand_in_scope(tenant_id, brand_id, array[''owner'', ''manager'']::public.tenant_role[]))',
      v_table || '_delete', v_table);
  end loop;
end;
$$;

create policy menu_store_items_select on public.menu_store_items
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy menu_store_items_insert on public.menu_store_items
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy menu_store_items_update on public.menu_store_items
  for update to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy menu_store_items_delete on public.menu_store_items
  for delete to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

create policy menu_price_changes_select on public.menu_price_changes
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy menu_imports_select on public.menu_imports
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));

revoke all on public.store_ordering_settings, public.ordering_closures, public.menu_categories, public.menu_items, public.menu_item_sizes,
  public.menu_option_groups, public.menu_options, public.menu_item_option_groups, public.menu_store_items, public.menu_price_changes, public.menu_imports
  from anon, authenticated;
grant select on public.store_ordering_settings, public.ordering_closures, public.menu_categories, public.menu_items, public.menu_item_sizes,
  public.menu_option_groups, public.menu_options, public.menu_item_option_groups, public.menu_store_items, public.menu_price_changes, public.menu_imports
  to authenticated;
grant insert (store_id, tenant_id, ordering_enabled, order_types, payment_window_minutes, late_order_minutes, prep_minutes, last_order_minutes, max_order_amount, max_waiting_orders, staff_presence_required)
  on public.store_ordering_settings to authenticated;
grant update (ordering_enabled, order_types, payment_window_minutes, late_order_minutes, prep_minutes, last_order_minutes, max_order_amount, max_waiting_orders, staff_presence_required)
  on public.store_ordering_settings to authenticated;
grant insert, update, delete on public.ordering_closures to authenticated;
grant insert (tenant_id, brand_id, name, sort_order, visible), update (name, sort_order, visible), delete on public.menu_categories to authenticated;
grant insert (tenant_id, brand_id, category_id, name, description, photo_path, labels, sort_order, visible, restricted, counts_for_stamps, order_types),
  update (category_id, name, description, photo_path, labels, sort_order, visible, restricted, counts_for_stamps, order_types), delete
  on public.menu_items to authenticated;
grant insert (tenant_id, brand_id, item_id, label, price, sort_order, is_default, active), update (label, price, sort_order, is_default, active), delete
  on public.menu_item_sizes to authenticated;
grant insert (tenant_id, brand_id, name, min_select, max_select, sort_order), update (name, min_select, max_select, sort_order), delete
  on public.menu_option_groups to authenticated;
grant insert (tenant_id, brand_id, group_id, name, price_delta, sort_order, is_default, active), update (name, price_delta, sort_order, is_default, active), delete
  on public.menu_options to authenticated;
grant insert (tenant_id, brand_id, item_id, group_id, sort_order), update (sort_order), delete on public.menu_item_option_groups to authenticated;
grant insert (tenant_id, store_id, item_id, offered, sold_out_until), update (offered, sold_out_until), delete on public.menu_store_items to authenticated;

-- 7. The menu-photos bucket ---------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', true, 307200, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public = true,
    file_size_limit = 307200,
    allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

create function app.menu_photo_writable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from regexp_match(
      p_name,
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-thumb)?\.(webp|jpg|png)$'
    ) as m
    where m is not null
      and app.brand_in_scope(m[1]::uuid, m[2]::uuid, array['owner', 'manager']::public.tenant_role[])
  );
$$;

comment on function app.menu_photo_writable(text) is 'storage policy helper: a menu photo path <tenant>/<brand>/<uuid>[-thumb].webp|jpg|png whose brand the caller may edit (an owner or manager with every store of the brand)';

create policy menu_photos_select_writers on storage.objects
  for select to authenticated
  using (bucket_id = 'menu-photos' and app.menu_photo_writable(name));
create policy menu_photos_insert_writers on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-photos' and app.menu_photo_writable(name));
create policy menu_photos_update_writers on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-photos' and app.menu_photo_writable(name))
  with check (bucket_id = 'menu-photos' and app.menu_photo_writable(name));
create policy menu_photos_delete_writers on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-photos' and app.menu_photo_writable(name));

-- 8. The ordering state and the menu rows ----------------------------------------------------------------------

create function app.ordering_span_at(p_store_id uuid, p_at timestamptz)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.opens_at, o.closes_at
  from public.stores s
  cross join lateral app.opening_spans(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at, p_at + interval '1 second') o
  where s.id = p_store_id
    and o.opens_at <= p_at
    and o.closes_at > p_at
  order by o.closes_at desc
  limit 1;
$$;

comment on function app.ordering_span_at(uuid, timestamptz) is 'the store''s opening span holding an instant (its time zone and business-day start), or no row';

create function app.ordering_next_opening(p_store_id uuid, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(o.opens_at)
  from public.stores s
  cross join lateral app.opening_spans(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at, p_at + interval '8 days') o
  where s.id = p_store_id
    and o.opens_at > p_at;
$$;

comment on function app.ordering_next_opening(uuid, timestamptz) is 'the next opening of a store after an instant, within 8 days, or null';

create function app.ordering_staff_present(p_store_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.ordering_presence p
    where p.store_id = p_store_id
      and p.seen_at <= p_at
      and p.seen_at > p_at - interval '180 seconds'
  );
$$;

comment on function app.ordering_staff_present(uuid, timestamptz) is 'whether a counter device polled the store less than 180 seconds before the instant (179 s fresh, 180 s stale)';

create function app.ordering_waiting_orders(p_store_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select 0;
$$;

comment on function app.ordering_waiting_orders(uuid) is 'the accepted orders of a store not yet started, for the busy reason; 0 until the orders arrive (step 3 replaces it)';

create function app.ordering_state(p_store_id uuid, p_order_type text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_settings public.store_ordering_settings;
  v_closure public.ordering_closures;
  v_opens timestamptz;
  v_closes timestamptz;
  v_last timestamptz;
  v_reason text;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  select o.* into v_settings from public.store_ordering_settings o where o.store_id = p_store_id;
  if v_store.id is not null and coalesce(app.opening_hours_known(v_store.opening_hours), false) then
    select sp.opens_at, sp.closes_at into v_opens, v_closes from app.ordering_span_at(p_store_id, p_at) sp;
    v_last := v_closes - make_interval(mins => coalesce(v_settings.last_order_minutes, 0));
  end if;
  if v_store.id is not null then
    select c.* into v_closure
    from public.ordering_closures c
    where c.store_id = p_store_id
      and app.store_business_date(p_store_id, p_at) between c.starts_on and c.ends_on
    order by c.ends_on desc, c.id
    limit 1;
  end if;

  if v_store.id is null or v_settings.store_id is null or v_settings.till_mode <> 'native' or not v_settings.ordering_enabled
     or (p_order_type is not null and not (p_order_type = any (v_settings.order_types)))
  then
    v_reason := 'ordering_off';
  elsif not coalesce(app.opening_hours_known(v_store.opening_hours), false) then
    v_reason := 'hours_unknown';
  elsif v_closure.id is not null then
    v_reason := 'closed_today';
  elsif v_settings.paused_until > p_at then
    v_reason := 'paused';
  elsif v_opens is null then
    v_reason := 'closed_now';
  elsif p_at >= v_last then
    v_reason := 'last_orders_passed';
  elsif v_settings.staff_presence_required and not app.ordering_staff_present(p_store_id, p_at) then
    v_reason := 'no_staff_online';
  elsif app.ordering_waiting_orders(p_store_id) >= v_settings.max_waiting_orders then
    v_reason := 'busy';
  end if;
  return jsonb_build_object(
    'accepting', v_reason is null,
    'reason', v_reason,
    'till_mode', coalesce(v_settings.till_mode, 'ipos'),
    'order_types', coalesce(to_jsonb(case when v_settings.ordering_enabled and v_settings.till_mode = 'native' then v_settings.order_types end), '[]'::jsonb),
    'payment_methods', coalesce(to_jsonb(case when v_settings.ordering_enabled and v_settings.till_mode = 'native' then v_settings.payment_methods end), '[]'::jsonb),
    'opens_at', case when v_reason in ('closed_now', 'last_orders_passed', 'closed_today') then app.ordering_next_opening(p_store_id, greatest(p_at, coalesce(v_closes, p_at))) end,
    'closes_at', v_closes,
    'last_order_at', v_last,
    'paused_until', case when v_settings.paused_until > p_at then v_settings.paused_until end,
    'closure_reason', v_closure.reason,
    'closure_ends_on', v_closure.ends_on
  );
end;
$$;

comment on function app.ordering_state(uuid, text, timestamptz) is 'whether a store takes orders of a type (any type when null) at an instant, with the first reason that holds it (native-till.md section 2): ordering_off (no settings, not native, not enabled or the type not offered), hours_unknown, closed_today (a closure covers the business date; its reason), paused, closed_now (opens_at), last_orders_passed (from closing less last_order_minutes), no_staff_online (presence required and no counter poll in 180 seconds), busy (accepted orders not started reach max_waiting_orders); accepting when none holds';

create function app.menu_rows(p_store_id uuid, p_brand_id uuid, p_at timestamptz)
returns table (
  item_id uuid,
  category_id uuid,
  category_name text,
  category_sort integer,
  item_name text,
  description text,
  photo_path text,
  labels text[],
  item_sort integer,
  order_types text[],
  counts_for_stamps boolean,
  size_id uuid,
  size_label text,
  size_sort integer,
  is_default boolean,
  price numeric,
  shown boolean,
  available boolean,
  sold_out_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, c.id, c.name, c.sort_order, i.name, i.description, i.photo_path, i.labels, i.sort_order,
    array(
      select t from unnest(i.order_types) as t
      where t = any (coalesce((select o.order_types from public.store_ordering_settings o where o.store_id = p_store_id), array['table']::text[]))
      order by array_position(array['table', 'takeaway'], t)
    ),
    i.counts_for_stamps,
    z.id, z.label, z.sort_order, z.is_default, z.price,
    i.visible and c.visible and not i.restricted and z.active,
    i.visible and c.visible and not i.restricted and z.active
      and coalesce(si.offered, true)
      and not coalesce(si.sold_out_until > p_at, false),
    case when si.sold_out_until > p_at then si.sold_out_until end
  from public.menu_items i
  join public.menu_categories c on c.id = i.category_id and c.brand_id = i.brand_id
  join public.menu_item_sizes z on z.item_id = i.id and z.brand_id = i.brand_id
  join public.brands b on b.id = i.brand_id
  left join public.menu_store_items si on si.store_id = p_store_id and si.item_id = i.id
  where i.brand_id = p_brand_id
    and p_store_id = any (b.store_ids);
$$;

comment on function app.menu_rows(uuid, uuid, timestamptz) is 'one row per size of every item of a brand at one of its stores: shown when the item is on sale in a visible category, not restricted and the size active; available when it is shown, offered at the store and not sold out at the instant; with the item''s order types within the store''s. customer_menu, the cart check and customer_place_order read the same rows';

-- 9. The customer menu, its version, the counter menu and the settings functions --------------------------------

create function app.menu_option_groups_json(p_brand_id uuid, p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'min_select', g.min_select,
      'max_select', g.max_select,
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta', o.price_delta::bigint, 'is_default', o.is_default)
          order by o.sort_order, o.name, o.id)
        from public.menu_options o
        where o.group_id = g.id and o.active
      ), '[]'::jsonb)
    )
    order by g.sort_order, g.name, g.id
  ), '[]'::jsonb)
  from public.menu_option_groups g
  where g.brand_id = p_brand_id
    and exists (select 1 from public.menu_item_option_groups l where l.group_id = g.id and l.item_id = any (p_item_ids));
$$;

comment on function app.menu_option_groups_json(uuid, uuid[]) is 'the option groups linked to any of the items, with their active options and amounts, as the menus answer them';

create function app.customer_menu_store(p_store_code text)
returns table (login app.customer_logins, store_id uuid, brand_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_store uuid;
begin
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store_code);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  return query select v_login, v_store, (select a.brand_id from public.zalo_apps a where a.id = v_login.zalo_app_id);
end;
$$;

comment on function app.customer_menu_store(text) is 'the customer session, and the store its app''s brand names by a store code with that brand; 42501 without a session, 22023 for a store that is not the brand''s';

create function app.customer_menu(p_store_code text, p_order_type text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_store record;
  v_items uuid[];
  v_native boolean;
begin
  if p_order_type is not null and p_order_type not in ('table', 'takeaway') then
    raise exception 'an order type is table or takeaway' using errcode = '22023';
  end if;
  select c.* into v_ctx from app.customer_menu_store(p_store_code) c;
  select s.code, s.name, s.address, s.opening_hours into v_store
  from app.customer_app_stores((v_ctx.login).zalo_app_id) s where s.store_id = v_ctx.store_id;
  v_native := exists (select 1 from public.store_ordering_settings o where o.store_id = v_ctx.store_id and o.till_mode = 'native');
  select coalesce(array_agg(distinct r.item_id), '{}'::uuid[]) into v_items
  from app.menu_rows(v_ctx.store_id, v_ctx.brand_id, p_at) r
  where v_native and r.available and (p_order_type is null or p_order_type = any (r.order_types)) and cardinality(r.order_types) > 0;
  return jsonb_build_object(
    'store', jsonb_build_object('code', v_store.code, 'name', v_store.name, 'address', nullif(btrim(v_store.address), ''), 'opening_hours', v_store.opening_hours),
    'order_type', p_order_type,
    'ordering', app.ordering_state(v_ctx.store_id, p_order_type, p_at),
    'menu_version', app.menu_version(v_ctx.brand_id),
    'currency', 'VND',
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.category_id, 'name', c.category_name, 'items', c.items) order by c.category_sort, c.category_name, c.category_id)
      from (
        select it.category_id, it.category_name, it.category_sort,
          jsonb_agg(
            jsonb_build_object(
              'id', it.item_id, 'name', it.item_name, 'description', it.description, 'photo_path', it.photo_path,
              'labels', to_jsonb(it.labels), 'order_types', to_jsonb(it.order_types), 'counts_for_stamps', it.counts_for_stamps,
              'sizes', it.sizes,
              'option_group_ids', coalesce((
                select jsonb_agg(l.group_id order by l.sort_order, l.group_id) from public.menu_item_option_groups l where l.item_id = it.item_id
              ), '[]'::jsonb)
            )
            order by it.item_sort, it.item_name, it.item_id
          ) as items
        from (
          select r.item_id, r.category_id, r.category_name, r.category_sort, r.item_name, r.description, r.photo_path, r.labels, r.item_sort,
            r.order_types, r.counts_for_stamps,
            jsonb_agg(jsonb_build_object('id', r.size_id, 'label', r.size_label, 'price', r.price::bigint, 'is_default', r.is_default)
              order by r.size_sort, r.price, r.size_id) as sizes
          from app.menu_rows(v_ctx.store_id, v_ctx.brand_id, p_at) r
          where r.item_id = any (v_items) and r.available
          group by r.item_id, r.category_id, r.category_name, r.category_sort, r.item_name, r.description, r.photo_path, r.labels, r.item_sort,
            r.order_types, r.counts_for_stamps
        ) it
        group by it.category_id, it.category_name, it.category_sort
      ) c
    ), '[]'::jsonb),
    'option_groups', app.menu_option_groups_json(v_ctx.brand_id, v_items),
    'unavailable_items', coalesce((
      select jsonb_agg(distinct r.item_id) from app.menu_rows(v_ctx.store_id, v_ctx.brand_id, p_at) r
      where v_native and r.shown and not (r.item_id = any (v_items))
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.customer_menu(text, text, timestamptz) is 'the menu of a native store of the customer session''s brand (native-till.md 3.4): the store, its ordering state for the type (any when null), the menu version, the visible categories with their available items (sizes with prices, labels, photo, option group ids), the option groups, and unavailable_items (items on sale but sold out, not offered at the store or not offered for the type, left out so a basket can warn); an ipos store answers no items. 22023 for a malformed type or a store not of the brand; 42501 without a customer session';

create function app.customer_menu_version(p_store_code text, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
begin
  select c.* into v_ctx from app.customer_menu_store(p_store_code) c;
  return jsonb_build_object(
    'menu_version', app.menu_version(v_ctx.brand_id),
    'ordering', app.ordering_state(v_ctx.store_id, null, p_at),
    'unavailable_items', coalesce((
      select jsonb_agg(distinct r.item_id) from app.menu_rows(v_ctx.store_id, v_ctx.brand_id, p_at) r
      where r.shown and not r.available
        and exists (select 1 from public.store_ordering_settings o where o.store_id = v_ctx.store_id and o.till_mode = 'native')
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.customer_menu_version(text, timestamptz) is 'the cheap poll of the customer app (every 3 seconds while the menu or the basket is open): the menu version, the ordering state and the items on sale that are sold out or not offered at the store, so an item switched off at the counter disappears within 5 seconds';

create function app.counter_store(p_store_id uuid, p_roles public.tenant_role[])
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or (select auth.uid()) is null or not app.has_store_scope(v_store.tenant_id, v_store.id, p_roles) then
    raise exception 'only a member of the store with an allowed role acts there' using errcode = '42501';
  end if;
  return v_store;
end;
$$;

comment on function app.counter_store(uuid, public.tenant_role[]) is 'the store of a counter function when the caller holds one of the roles with the store in scope; 42501 otherwise, the same for a store that does not exist';

create function app.store_business_day_end(p_store_id uuid, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((app.store_business_date(s.id, p_at) + 1)::timestamp + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone
  from public.stores s
  where s.id = p_store_id;
$$;

comment on function app.store_business_day_end(uuid, timestamptz) is 'the instant the store''s business day holding p_at ends (the next day''s start)';

create function app.counter_menu(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_items uuid[];
begin
  select coalesce(array_agg(distinct r.item_id), '{}'::uuid[]) into v_items
  from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
  cross join lateral app.menu_rows(v_store.id, b.brand_id, p_at) r
  where r.shown;
  return jsonb_build_object(
    'store_id', v_store.id,
    'business_date', to_char(app.store_business_date(v_store.id, p_at), 'YYYY-MM-DD'),
    'day_ends_at', app.store_business_day_end(v_store.id, p_at),
    'ordering', app.ordering_state(v_store.id, null, p_at),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.item_id, 'brand_id', x.brand_id, 'category', x.category_name, 'name', x.item_name, 'order_types', to_jsonb(x.order_types),
          'available', x.available, 'sold_out_until', x.sold_out_until, 'sizes', x.sizes,
          'option_group_ids', coalesce((select jsonb_agg(l.group_id order by l.sort_order, l.group_id) from public.menu_item_option_groups l where l.item_id = x.item_id), '[]'::jsonb)
        )
        order by x.category_sort, x.category_name, x.item_sort, x.item_name, x.item_id
      )
      from (
        select r.item_id, b.brand_id, r.category_name, r.category_sort, r.item_name, r.item_sort, r.order_types,
          bool_or(r.available) as available, max(r.sold_out_until) as sold_out_until,
          jsonb_agg(jsonb_build_object('id', r.size_id, 'label', r.size_label, 'price', r.price::bigint, 'is_default', r.is_default) order by r.size_sort, r.price, r.size_id) as sizes
        from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
        cross join lateral app.menu_rows(v_store.id, b.brand_id, p_at) r
        where r.shown
        group by r.item_id, b.brand_id, r.category_name, r.category_sort, r.item_name, r.item_sort, r.order_types
      ) x
    ), '[]'::jsonb),
    'option_groups', coalesce((
      select jsonb_agg(g) from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
      cross join lateral jsonb_array_elements(app.menu_option_groups_json(b.brand_id, v_items)) g
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.counter_menu(uuid, timestamptz) is 'the counter''s menu of a store (native-till.md 3.4): every item on sale of the brands covering the store with its sizes and prices, whether it is available now and until when it is sold out, and the option groups; for the counter''s order form and the sold-out switches; owners, managers and staff of the store only';

create function app.counter_set_sold_out(p_store_id uuid, p_item_id uuid, p_sold_out boolean, p_until timestamptz default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_until timestamptz;
  v_row public.menu_store_items;
begin
  if p_item_id is null or p_sold_out is null then
    raise exception 'counter_set_sold_out names an item and whether it is sold out' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.menu_items i join public.brands b on b.id = i.brand_id
    where i.id = p_item_id and i.tenant_id = v_store.tenant_id and v_store.id = any (b.store_ids)
  ) then
    raise exception 'the item is not on the menu of the store' using errcode = '22023';
  end if;
  if p_sold_out then
    v_until := coalesce(p_until, app.store_business_day_end(v_store.id, p_at));
    if v_until <= p_at or v_until > p_at + interval '7 days' then
      raise exception 'an item is sold out until a time within the next 7 days' using errcode = '22023';
    end if;
  elsif p_until is not null then
    raise exception 'an item made available again takes no time' using errcode = '22023';
  end if;
  insert into public.menu_store_items as o (tenant_id, store_id, item_id, sold_out_until, sold_out_by, created_by, updated_by)
  values (v_store.tenant_id, v_store.id, p_item_id, v_until, case when p_sold_out then (select auth.uid()) end, (select auth.uid()), (select auth.uid()))
  on conflict (store_id, item_id) do update
  set sold_out_until = excluded.sold_out_until,
      sold_out_by = excluded.sold_out_by
  returning o.* into v_row;
  return jsonb_build_object(
    'item_id', p_item_id,
    'sold_out', v_row.sold_out_until is not null,
    'sold_out_until', v_row.sold_out_until,
    'menu_version', app.menu_version((select i.brand_id from public.menu_items i where i.id = p_item_id))
  );
end;
$$;

comment on function app.counter_set_sold_out(uuid, uuid, boolean, timestamptz, timestamptz) is 'the counter''s sold-out switch of an item at a store: sold out until the end of the business day by default or a chosen time within 7 days, or available again; it moves the menu version, so customer menus drop the item at their next poll and an order with it is refused item_unavailable; owners, managers and staff of the store (42501 otherwise); 22023 for an item not on the store''s menu or a time outside the bounds';

create function app.counter_set_pause(p_store_id uuid, p_minutes integer, p_reason text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
  v_manager boolean := app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]);
  v_reason text := nullif(btrim(p_reason), '');
  v_settings public.store_ordering_settings;
begin
  if p_minutes is null or p_minutes < 0 or p_minutes > 1440 then
    raise exception 'a pause lasts 0 to 1,440 minutes (0 resumes)' using errcode = '22023';
  end if;
  if p_minutes > 60 and not v_manager then
    raise exception 'staff pause ordering for 60 minutes at most; a longer pause needs a manager' using errcode = '42501';
  end if;
  if v_reason is not null and not app.native_text_valid(v_reason, 80) then
    raise exception 'a pause reason has 1 to 80 characters on one line' using errcode = '22023';
  end if;
  update public.store_ordering_settings o
  set paused_until = case when p_minutes = 0 then null else p_at + make_interval(mins => p_minutes) end,
      paused_reason = case when p_minutes = 0 then null else v_reason end,
      paused_by = case when p_minutes = 0 then null else (select auth.uid()) end
  where o.store_id = v_store.id
  returning o.* into v_settings;
  if v_settings.store_id is null then
    raise exception 'the store has no ordering settings to pause' using errcode = '22023';
  end if;
  return jsonb_build_object('paused_until', v_settings.paused_until, 'paused_reason', v_settings.paused_reason, 'ordering', app.ordering_state(v_store.id, null, p_at));
end;
$$;

comment on function app.counter_set_pause(uuid, integer, text, timestamptz) is 'holds new orders at a store for p_minutes with an optional reason (1 to 80 characters), 0 resumes: staff up to 60 minutes (42501 beyond), owners and managers up to 1,440 (22023 beyond or below 0); orders already in the queue are unaffected; 22023 for a store without settings';

create function app.set_store_till_mode(p_store_id uuid, p_mode text)
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
  insert into public.store_ordering_settings as o (store_id, tenant_id, till_mode, created_by, updated_by)
  values (v_store.id, v_store.tenant_id, p_mode, (select auth.uid()), (select auth.uid()))
  on conflict (store_id) do update set till_mode = excluded.till_mode
  returning o.* into v_settings;
  return jsonb_build_object('store_id', v_store.id, 'till_mode', v_settings.till_mode, 'ordering_enabled', v_settings.ordering_enabled);
end;
$$;

comment on function app.set_store_till_mode(uuid, text) is 'switches a store between ipos (the POS is the till) and native (this platform is the till), creating its settings row when needed; an owner with every store only (42501), 22023 for another mode';

-- 10. The one-time import from the POS catalogue -------------------------------------------------------------------

create function app.import_menu_from_pos(p_brand_id uuid, p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_brand public.brands;
  v_store public.stores;
  v_counts jsonb;
begin
  select b.* into v_brand from public.brands b where b.id = p_brand_id;
  if v_brand.id is null or not app.brand_in_scope(v_brand.tenant_id, v_brand.id, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store of the brand imports its menu' using errcode = '42501';
  end if;
  select s.* into v_store from public.stores s where s.id = p_store_id and s.tenant_id = v_brand.tenant_id and s.id = any (v_brand.store_ids);
  if v_store.id is null then
    raise exception 'the store is not a store of the brand' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-menu-import:' || v_brand.id::text, 0));
  if exists (select 1 from public.menu_imports m where m.brand_id = v_brand.id) then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_imported');
  end if;
  if exists (select 1 from public.menu_items i where i.brand_id = v_brand.id) then
    return jsonb_build_object('state', 'refused', 'refusal', 'menu_not_empty');
  end if;

  -- The POS items that become sizes: active, not modifiers, chargeable, and not an option of a POS option group.
  create temp table import_sizes on commit drop as
  select
    i.external_id,
    coalesce(nullif(btrim(i.base_name), ''), i.name) as base_name,
    nullif(btrim(i.size_label), '') as size_label,
    coalesce(i.item_type_external_id, '') as type_source,
    t.name as type_name,
    coalesce(si.list_price, i.list_price) as price,
    app.native_restricted_guess(i.name, t.name) as restricted
  from public.items i
  left join public.item_types t on t.pos_account_id = i.pos_account_id and t.external_id = i.item_type_external_id
  left join public.store_items si on si.store_id = v_store.id and si.tenant_id = i.tenant_id and si.item_external_id = i.external_id
  where i.pos_account_id = v_store.pos_account_id
    and i.tenant_id = v_brand.tenant_id
    and i.active
    and not i.is_modifier
    and coalesce(si.active, true)
    and app.native_price_valid(coalesce(si.list_price, i.list_price), 1, 100000000)
    and not exists (
      select 1 from public.item_option_group_options o
      join public.item_option_groups g on g.pos_account_id = o.pos_account_id and g.external_id = o.group_external_id and g.active
      where o.pos_account_id = i.pos_account_id and o.item_external_id = i.external_id
    );

  insert into public.menu_categories (tenant_id, brand_id, name, sort_order, source_item_type_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, x.name, (10 * row_number() over (order by x.name, x.type_source))::integer, x.type_source, (select auth.uid()), (select auth.uid())
  from (
    select s.type_source, btrim(left(min(coalesce(nullif(btrim(regexp_replace(s.type_name, '[[:cntrl:]]', ' ', 'g')), ''), 'Khác')), 40)) as name
    from import_sizes s group by s.type_source
  ) x;

  insert into public.menu_items (tenant_id, brand_id, category_id, name, sort_order, visible, restricted, source_pos_account_id, source_item_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, c.id, btrim(left(regexp_replace(g.base_name, '[[:cntrl:]]', ' ', 'g'), 60)),
    least(10 * row_number() over (partition by c.id order by g.base_name), 100000)::integer,
    not g.restricted, g.restricted, v_store.pos_account_id, g.first_external_id, (select auth.uid()), (select auth.uid())
  from (
    select s.type_source, s.base_name, bool_or(s.restricted) as restricted, min(s.external_id) as first_external_id
    from import_sizes s group by s.type_source, s.base_name
  ) g
  join public.menu_categories c on c.brand_id = v_brand.id and c.source_item_type_external_id = g.type_source;

  insert into public.menu_item_sizes (tenant_id, brand_id, item_id, label, price, sort_order, is_default, source_item_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, x.item_id, x.label, x.price, (10 * x.position)::integer, x.position = 1, x.external_id, (select auth.uid()), (select auth.uid())
  from (
    select i.id as item_id, case when count(*) over (partition by i.id) > 1 then btrim(left(s.size_label, 20)) end as label, s.price, s.external_id,
      row_number() over (partition by i.id order by s.price, s.size_label nulls first, s.external_id) as position
    from (
      select distinct on (s.type_source, s.base_name, lower(coalesce(s.size_label, ''))) s.*
      from import_sizes s
      order by s.type_source, s.base_name, lower(coalesce(s.size_label, '')), s.external_id
    ) s
    join public.menu_categories c on c.brand_id = v_brand.id and c.source_item_type_external_id = s.type_source
    join public.menu_items i on i.brand_id = v_brand.id and i.category_id = c.id and i.name = btrim(left(regexp_replace(s.base_name, '[[:cntrl:]]', ' ', 'g'), 60))
  ) x;

  -- The POS option groups that target an imported item become option groups, their option items options.
  insert into public.menu_option_groups (tenant_id, brand_id, name, min_select, max_select, sort_order, source_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, btrim(left(regexp_replace(g.name, '[[:cntrl:]]', ' ', 'g'), 40)), g.min_select, g.max_select,
    (10 * row_number() over (order by g.name, g.external_id))::integer, g.external_id, (select auth.uid()), (select auth.uid())
  from public.item_option_groups g
  where g.pos_account_id = v_store.pos_account_id
    and g.active
    and nullif(btrim(g.name), '') is not null
    and exists (
      select 1 from public.item_option_group_targets t
      join public.menu_item_sizes z on z.brand_id = v_brand.id and z.source_item_external_id = t.item_external_id
      where t.pos_account_id = g.pos_account_id and t.group_external_id = g.external_id
    );

  insert into public.menu_options (tenant_id, brand_id, group_id, name, price_delta, sort_order, source_item_external_id, created_by, updated_by)
  select distinct on (mg.id, lower(btrim(left(regexp_replace(i.name, '[[:cntrl:]]', ' ', 'g'), 40))))
    v_brand.tenant_id, v_brand.id, mg.id, btrim(left(regexp_replace(i.name, '[[:cntrl:]]', ' ', 'g'), 40)),
    case when app.native_price_valid(coalesce(si.list_price, i.list_price, 0), 0, 1000000) then coalesce(si.list_price, i.list_price, 0) else 0 end,
    least(10 * (o.sort_order + 1), 100000), i.external_id, (select auth.uid()), (select auth.uid())
  from public.menu_option_groups mg
  join public.item_option_group_options o on o.pos_account_id = v_store.pos_account_id and o.group_external_id = mg.source_external_id
  join public.items i on i.pos_account_id = o.pos_account_id and i.external_id = o.item_external_id
  left join public.store_items si on si.store_id = v_store.id and si.tenant_id = i.tenant_id and si.item_external_id = i.external_id
  where mg.brand_id = v_brand.id
    and nullif(btrim(i.name), '') is not null
  order by mg.id, lower(btrim(left(regexp_replace(i.name, '[[:cntrl:]]', ' ', 'g'), 40))), o.sort_order, i.external_id;

  insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id, sort_order)
  select distinct v_brand.tenant_id, v_brand.id, z.item_id, mg.id, mg.sort_order
  from public.menu_option_groups mg
  join public.item_option_group_targets t on t.pos_account_id = v_store.pos_account_id and t.group_external_id = mg.source_external_id
  join public.menu_item_sizes z on z.brand_id = v_brand.id and z.source_item_external_id = t.item_external_id
  where mg.brand_id = v_brand.id
  on conflict (item_id, group_id) do nothing;

  v_counts := jsonb_build_object(
    'categories', (select count(*) from public.menu_categories c where c.brand_id = v_brand.id),
    'items', (select count(*) from public.menu_items i where i.brand_id = v_brand.id),
    'sizes', (select count(*) from public.menu_item_sizes z where z.brand_id = v_brand.id),
    'restricted', (select count(*) from public.menu_items i where i.brand_id = v_brand.id and i.restricted),
    'option_groups', (select count(*) from public.menu_option_groups g where g.brand_id = v_brand.id),
    'options', (select count(*) from public.menu_options o where o.brand_id = v_brand.id)
  );
  insert into public.menu_imports (brand_id, tenant_id, store_id, pos_account_id, imported_by, imported_at, counts)
  values (v_brand.id, v_brand.tenant_id, v_store.id, v_store.pos_account_id, (select auth.uid()), p_at, v_counts);
  drop table import_sizes;
  return jsonb_build_object('state', 'imported', 'counts', v_counts, 'menu_version', app.menu_version(v_brand.id));
end;
$$;

comment on function app.import_menu_from_pos(uuid, uuid, timestamptz) is 'the one-time import of a brand''s menu from the POS catalogue of one of its stores (ADR-060): a category per POS item type, an item per POS base name with a size per POS size priced at the store''s list price else the item''s, the POS option groups targeting those items as option groups whose options cost their POS item''s price, alcohol and beer restricted and hidden, the rest visible; records menu_imports and answers the counts; refused as data (already_imported, menu_not_empty); an owner with every store of the brand only (42501), 22023 for a store not of the brand';

-- 11. Public wrappers and grants -----------------------------------------------------------------------------------

create function public.customer_menu(p_store_code text, p_order_type text default null)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_menu(p_store_code, p_order_type, now()); $$;
comment on function public.customer_menu(text, text) is 'RPC for the customer Mini App: app.customer_menu at the current time';

create function public.customer_menu_version(p_store_code text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.customer_menu_version(p_store_code, now()); $$;
comment on function public.customer_menu_version(text) is 'RPC for the customer Mini App: app.customer_menu_version at the current time';

create function public.counter_menu(p_store uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.counter_menu(p_store, now()); $$;
comment on function public.counter_menu(uuid) is 'RPC for the counter web app: app.counter_menu at the current time';

create function public.counter_set_sold_out(p_store uuid, p_item uuid, p_sold_out boolean, p_until timestamptz default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_set_sold_out(p_store, p_item, p_sold_out, p_until, now()); $$;
comment on function public.counter_set_sold_out(uuid, uuid, boolean, timestamptz) is 'RPC for the counter web app: app.counter_set_sold_out at the current time';

create function public.counter_set_pause(p_store uuid, p_minutes integer, p_reason text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_set_pause(p_store, p_minutes, p_reason, now()); $$;
comment on function public.counter_set_pause(uuid, integer, text) is 'RPC for the counter web app: app.counter_set_pause at the current time';

create function public.set_store_till_mode(p_store uuid, p_mode text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.set_store_till_mode(p_store, p_mode); $$;
comment on function public.set_store_till_mode(uuid, text) is 'RPC for the owner: app.set_store_till_mode';

create function public.import_menu_from_pos(p_brand uuid, p_store uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.import_menu_from_pos(p_brand, p_store, now()); $$;
comment on function public.import_menu_from_pos(uuid, uuid) is 'RPC for the owner: app.import_menu_from_pos at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in (
        'native_text_valid', 'native_description_valid', 'native_set_valid', 'native_price_valid', 'native_restricted_guess',
        'bump_menu_versions', 'menu_version', 'menu_brand_ids_of_store', 'menu_version_by_brand', 'menu_version_by_store', 'menu_keys_fixed',
        'menu_store_items_guard', 'log_menu_price', 'keep_menu_price_changes', 'refuse_menu_price_changes_truncate',
        'ordering_span_at', 'ordering_next_opening', 'ordering_staff_present', 'ordering_waiting_orders', 'ordering_state', 'menu_rows',
        'menu_option_groups_json', 'customer_menu_store', 'customer_menu', 'customer_menu_version', 'counter_store', 'store_business_day_end',
        'counter_menu', 'counter_set_sold_out', 'counter_set_pause', 'set_store_till_mode', 'import_menu_from_pos'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function app.brand_in_scope(uuid, uuid, public.tenant_role[]) from public, anon;
revoke all on function app.menu_photo_writable(text) from public, anon;
grant execute on function app.brand_in_scope(uuid, uuid, public.tenant_role[]) to authenticated;
grant execute on function app.menu_photo_writable(text) to authenticated;
grant execute on function app.native_text_valid(text, integer), app.native_description_valid(text), app.native_set_valid(text[], text[], integer),
  app.native_price_valid(numeric, numeric, numeric) to authenticated, service_role;

revoke all on function public.customer_menu(text, text), public.customer_menu_version(text), public.counter_menu(uuid),
  public.counter_set_sold_out(uuid, uuid, boolean, timestamptz), public.counter_set_pause(uuid, integer, text),
  public.set_store_till_mode(uuid, text), public.import_menu_from_pos(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.customer_menu(text, text), public.customer_menu_version(text), public.counter_menu(uuid),
  public.counter_set_sold_out(uuid, uuid, boolean, timestamptz), public.counter_set_pause(uuid, integer, text),
  public.set_store_till_mode(uuid, text), public.import_menu_from_pos(uuid, uuid)
  to authenticated;
