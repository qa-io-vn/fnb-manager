create function app.zalo_secret_name_valid(p_name text, p_prefix text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text;
begin
  if p_name is null
     or p_prefix is null
     or p_name !~ '^ZALO_[A-Z0-9_]{1,60}$'
     or not starts_with(p_name, p_prefix)
     or char_length(p_name) <= char_length(p_prefix) then
    return false;
  end if;
  foreach v_segment in array string_to_array(p_name, '_') loop
    if v_segment = ''
       or char_length(v_segment) > 16
       or (v_segment ~ '[0-9]' and char_length(v_segment) > 8) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.zalo_secret_name_valid(text, text) is 'whether a configuration row may name this function secret: a ZALO_ name with the prefix of its column, and no segment shaped like a value (longer than 16 characters, or longer than 8 with a digit), so a pasted secret, token, JWT, URL or numeric id is refused';

create function app.mini_app_title_valid(p_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(p_title) between 3 and 50
      and p_title = btrim(p_title)
      and p_title !~ '[[:cntrl:]]'
      and not (p_title = upper(p_title) and p_title <> lower(p_title))
      and p_title !~* 'zalo'
      and p_title !~* '\mapps?\M'
      and p_title !~ 'Apps?\M',
    false
  );
$$;

comment on function app.mini_app_title_valid(text) is 'Zalo''s naming rules for a Mini App title (ADR-022): 3 to 50 characters, not all capitals, and without "Zalo", "App" or "Mini App"';

create function app.validate_zalo_store_ids()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if cardinality(new.store_ids) <> (select count(distinct s.store_id) from unnest(new.store_ids) as s (store_id)) then
    raise exception '%.store_ids lists a store twice', tg_table_name using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(new.store_ids) as s (store_id)
    where not exists (
      select 1 from public.stores st where st.id = s.store_id and st.tenant_id = new.tenant_id
    )
  ) then
    raise exception '%.store_ids holds a store outside the tenant', tg_table_name using errcode = '23503';
  end if;
  return new;
end;
$$;

comment on function app.validate_zalo_store_ids() is 'trigger on brands and gmf_groups: refuses a store listed twice (22023) and a store that is not a store of the row''s tenant (23503), the array form of the tenant-consistent foreign key';

create function app.bump_zalo_token_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.bump_zalo_token_version() is 'trigger on zalo_tokens: every update moves the version by one, so a refresh that read an older version can tell its row was rewritten';

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_key text not null check (brand_key ~ '^brand-[1-9][0-9]{0,2}$'),
  display_name text not null check (char_length(display_name) between 1 and 80 and display_name !~ '[[:cntrl:]]'),
  store_ids uuid[] not null check (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, brand_key),
  unique (tenant_id, id)
);

comment on table public.brands is 'one row per brand of a tenant: the neutral key used in secret names, flags and logs (brand-1), the display name and the stores the brand covers; every Zalo row hangs off it';
comment on column public.brands.store_ids is 'the stores of the tenant the brand covers, checked by app.validate_zalo_store_ids';

create table public.zalo_apps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  secret_name text not null check (app.zalo_secret_name_valid(secret_name, 'ZALO_APP_SECRET_')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (brand_id),
  unique (tenant_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table public.zalo_apps is 'the Zalo App of a brand (ADR-017: one per brand, holding both Mini Apps): its id and the name of the function secret holding its App secret, never the secret';
comment on column public.zalo_apps.external_id is 'the Zalo App id from developers.zalo.me';
comment on column public.zalo_apps.secret_name is 'the Edge Function secret holding the App secret, ZALO_APP_SECRET_<BRAND>';
comment on column public.zalo_apps.status is 'active, or disabled to refuse every Mini App sign-in of the brand';

create table public.oas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  package_tier text not null default 'co_ban' check (package_tier in ('co_ban', 'tieu_chuan', 'tang_truong', 'toan_dien')),
  package_expires_on date,
  verified boolean not null default false,
  secret_name text not null check (app.zalo_secret_name_valid(secret_name, 'ZALO_OA_SECRET_')),
  webhook_mode text not null default 'observe' check (webhook_mode in ('observe', 'enforce')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (brand_id),
  unique (tenant_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table public.oas is 'the Official Account of a brand (ADR-017): its id, package and expiry, verification, the name of the secret holding its OA secret key and the webhook signature mode';
comment on column public.oas.external_id is 'the OA id';
comment on column public.oas.package_tier is 'co_ban (Cơ bản), tieu_chuan (Tiêu chuẩn), tang_truong (Tăng trưởng) or toan_dien (Toàn diện); the Open API needs tang_truong or toan_dien';
comment on column public.oas.secret_name is 'the Edge Function secret holding the OA secret key that signs webhooks, ZALO_OA_SECRET_<BRAND>';
comment on column public.oas.webhook_mode is 'observe records a signature mismatch and accepts the event; enforce refuses it';

create table public.mini_apps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  kind text not null check (kind in ('staff', 'customer')),
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  browsable boolean not null,
  title text not null check (app.mini_app_title_valid(title)),
  header_title_vi text not null check (char_length(header_title_vi) between 1 and 50 and header_title_vi !~ '[[:cntrl:]]'),
  header_title_en text not null check (char_length(header_title_en) between 1 and 50 and header_title_en !~ '[[:cntrl:]]'),
  header_color_light text not null check (header_color_light ~ '^#[0-9A-Fa-f]{6}$'),
  header_color_dark text not null check (header_color_dark ~ '^#[0-9A-Fa-f]{6}$'),
  text_color_light text not null check (text_color_light in ('black', 'white')),
  text_color_dark text not null check (text_color_dark in ('black', 'white')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (brand_id, kind),
  unique (tenant_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade,
  check (browsable = (kind = 'customer'))
);

comment on table public.mini_apps is 'the staff and customer Mini Apps of a brand: the Mini App id, whether it is listed, and the inputs of its app-config.json';
comment on column public.mini_apps.external_id is 'the Mini App id';
comment on column public.mini_apps.browsable is 'false for the staff app (hidden, opened by link or QR), true for the customer app';
comment on column public.mini_apps.title is 'the Mini App title, checked by app.mini_app_title_valid';
comment on column public.mini_apps.text_color_light is 'header title and icon colour in light mode; Zalo allows only black or white';

create table public.zbs_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  tag text not null check (tag in ('transaction', 'customer_care', 'promotion')),
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{0,40}$'),
  approval_state text not null default 'draft' check (approval_state in ('draft', 'pending_review', 'approved', 'rejected', 'disabled')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (oa_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade
);

comment on table public.zbs_templates is 'ZBS template messages of an OA: the template id, its tag (1 transaction, 2 customer care, 3 promotion), what it is for and its approval state; rows arrive in phase 19a';

create table public.gmf_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  store_ids uuid[] not null check (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null),
  purpose text not null default 'staff' check (purpose = 'staff'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (oa_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade
);

comment on table public.gmf_groups is 'the OA''s staff groups (Quản lý nhóm): the group id and the stores it serves';

create table public.zalo_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  zalo_app_id uuid not null,
  zalo_user_id text not null check (zalo_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text check (display_name is null or (char_length(display_name) between 1 and 100 and display_name !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zalo_app_id, zalo_user_id),
  foreign key (tenant_id, zalo_app_id) references public.zalo_apps (tenant_id, id) on delete cascade
);

create index zalo_identities_user_id_idx on public.zalo_identities (user_id);
create index zalo_identities_tenant_id_idx on public.zalo_identities (tenant_id);

comment on table public.zalo_identities is 'a Zalo user id, unique per Zalo App, bound to an Auth user, with the display name only: no phone, avatar or location (NFR-PRV-07); written by the sign-in function as service_role';

create table public.zalo_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand_id uuid not null,
  kind text not null check (kind in ('oa', 'developer')),
  access_token text not null check (char_length(access_token) between 1 and 4096),
  access_expires_at timestamptz not null,
  refresh_token text not null check (char_length(refresh_token) between 1 and 4096),
  refresh_expires_at timestamptz,
  refreshed_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

comment on table public.zalo_tokens is 'rotating token cache, service role only (no policy, no grant to an API role): the OA access and refresh token pair and the Mini App developer token pair of a brand; the refresh tokens are single-use, so they live here and not in function secrets (ADR-006)';
comment on column public.zalo_tokens.kind is 'oa: the OA token pair (access 25 hours, refresh 3 months); developer: the zmp developer token pair (access about 60 minutes, refresh one month)';
comment on column public.zalo_tokens.version is 'moved by every update (app.bump_zalo_token_version), read under the single-row lock of the refresh jobs';

create trigger brands_set_updated_at before update on public.brands for each row execute function app.set_updated_at();
create trigger brands_keep_created_by before update on public.brands for each row execute function app.keep_created_by();
create trigger brands_set_updated_by before insert or update on public.brands for each row execute function app.set_updated_by();
create trigger brands_validate_store_ids before insert or update of tenant_id, store_ids on public.brands for each row execute function app.validate_zalo_store_ids();

create trigger zalo_apps_set_updated_at before update on public.zalo_apps for each row execute function app.set_updated_at();
create trigger zalo_apps_keep_created_by before update on public.zalo_apps for each row execute function app.keep_created_by();
create trigger zalo_apps_set_updated_by before insert or update on public.zalo_apps for each row execute function app.set_updated_by();

create trigger oas_set_updated_at before update on public.oas for each row execute function app.set_updated_at();
create trigger oas_keep_created_by before update on public.oas for each row execute function app.keep_created_by();
create trigger oas_set_updated_by before insert or update on public.oas for each row execute function app.set_updated_by();

create trigger mini_apps_set_updated_at before update on public.mini_apps for each row execute function app.set_updated_at();
create trigger mini_apps_keep_created_by before update on public.mini_apps for each row execute function app.keep_created_by();
create trigger mini_apps_set_updated_by before insert or update on public.mini_apps for each row execute function app.set_updated_by();

create trigger zbs_templates_set_updated_at before update on public.zbs_templates for each row execute function app.set_updated_at();
create trigger zbs_templates_keep_created_by before update on public.zbs_templates for each row execute function app.keep_created_by();
create trigger zbs_templates_set_updated_by before insert or update on public.zbs_templates for each row execute function app.set_updated_by();

create trigger gmf_groups_set_updated_at before update on public.gmf_groups for each row execute function app.set_updated_at();
create trigger gmf_groups_keep_created_by before update on public.gmf_groups for each row execute function app.keep_created_by();
create trigger gmf_groups_set_updated_by before insert or update on public.gmf_groups for each row execute function app.set_updated_by();
create trigger gmf_groups_validate_store_ids before insert or update of tenant_id, store_ids on public.gmf_groups for each row execute function app.validate_zalo_store_ids();

create trigger zalo_identities_set_updated_at before update on public.zalo_identities for each row execute function app.set_updated_at();

create trigger zalo_tokens_bump_version before update on public.zalo_tokens for each row execute function app.bump_zalo_token_version();

alter table public.brands enable row level security;
alter table public.zalo_apps enable row level security;
alter table public.oas enable row level security;
alter table public.mini_apps enable row level security;
alter table public.zbs_templates enable row level security;
alter table public.gmf_groups enable row level security;
alter table public.zalo_identities enable row level security;
alter table public.zalo_tokens enable row level security;

create policy brands_select_for_managers on public.brands
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy brands_insert_for_owners on public.brands
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy brands_update_for_owners on public.brands
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy brands_delete_for_owners on public.brands
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy zalo_apps_select_for_managers on public.zalo_apps
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy zalo_apps_insert_for_owners on public.zalo_apps
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy zalo_apps_update_for_owners on public.zalo_apps
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy zalo_apps_delete_for_owners on public.zalo_apps
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy oas_select_for_managers on public.oas
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy oas_insert_for_owners on public.oas
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy oas_update_for_owners on public.oas
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy oas_delete_for_owners on public.oas
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy mini_apps_select_for_managers on public.mini_apps
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy mini_apps_insert_for_owners on public.mini_apps
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy mini_apps_update_for_owners on public.mini_apps
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy mini_apps_delete_for_owners on public.mini_apps
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy zbs_templates_select_for_managers on public.zbs_templates
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy zbs_templates_insert_for_owners on public.zbs_templates
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy zbs_templates_update_for_owners on public.zbs_templates
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy zbs_templates_delete_for_owners on public.zbs_templates
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy gmf_groups_select_for_managers on public.gmf_groups
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy gmf_groups_insert_for_owners on public.gmf_groups
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy gmf_groups_update_for_owners on public.gmf_groups
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy gmf_groups_delete_for_owners on public.gmf_groups
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy zalo_identities_select_for_managers on public.zalo_identities
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.zalo_tokens from anon, authenticated;
grant insert, update, delete on public.brands, public.zalo_apps, public.oas, public.mini_apps, public.zbs_templates, public.gmf_groups to authenticated;

revoke all on function app.zalo_secret_name_valid(text, text) from public, anon;
revoke all on function app.mini_app_title_valid(text) from public, anon;
revoke all on function app.validate_zalo_store_ids() from public, anon, authenticated;
revoke all on function app.bump_zalo_token_version() from public, anon, authenticated;

grant execute on function app.zalo_secret_name_valid(text, text) to authenticated, service_role;
grant execute on function app.mini_app_title_valid(text) to authenticated, service_role;
