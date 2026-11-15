create type public.pos_feature_status as enum ('unknown', 'enabled', 'disabled');

create type public.legal_document_kind as enum (
  'privacy_notice',
  'data_protection_rules',
  'mini_app_terms',
  'staff_notice',
  'loyalty_consent_text',
  'marketing_consent_text'
);

create type public.legal_document_status as enum ('draft', 'published', 'retired');

alter table public.stores
  add column member_capture_status public.pos_feature_status not null default 'unknown',
  add column profile_updated_at timestamptz,
  add column profile_updated_by uuid references auth.users (id) on delete set null;

comment on column public.stores.member_capture_status is 'whether the POS member feature is switched on, entered by the owner';
comment on column public.stores.profile_updated_at is 'when a member last changed a profile column; the sync never stamps it';

alter table public.tenants
  add column default_language text not null default 'vi' check (default_language in ('vi', 'en')),
  add column profile_updated_at timestamptz,
  add column profile_updated_by uuid references auth.users (id) on delete set null;

comment on column public.tenants.default_language is 'the web app''s first language for a member without a stored preference';

alter table public.payment_methods
  add column pos_kind public.payment_kind not null default 'other';

comment on column public.payment_methods.pos_kind is 'the kind the sync classified; kind holds the effective kind after an override';

alter table public.holidays
  add column created_by uuid default auth.uid() references auth.users (id) on delete set null,
  add column updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  add column updated_at timestamptz not null default now();

create table public.payment_kind_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  payment_method_external_id text not null,
  kind public.payment_kind not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (pos_account_id, payment_method_external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade,
  foreign key (pos_account_id, payment_method_external_id) references public.payment_methods (pos_account_id, external_id) on delete cascade
);

comment on table public.payment_kind_overrides is 'a tenant''s payment kind for a POS payment method; payment_methods.kind follows it and pos_kind keeps the POS value';

create index payment_kind_overrides_tenant_id_idx on public.payment_kind_overrides (tenant_id);

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.legal_document_kind not null,
  language text not null default 'vi' check (language in ('vi', 'en')),
  version text not null check (version ~ '^[a-z0-9][a-z0-9.-]{0,39}$'),
  title text not null check (char_length(title) between 1 and 200),
  body_markdown text not null check (char_length(body_markdown) between 1 and 100000),
  status public.legal_document_status not null default 'draft',
  published_at timestamptz,
  retired_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, language, version),
  constraint legal_documents_status_dates check (
    (status = 'draft' and published_at is null and retired_at is null)
    or (status = 'published' and published_at is not null and retired_at is null)
    or (status = 'retired' and published_at is not null and retired_at is not null)
  )
);

comment on table public.legal_documents is 'versioned legal texts of a tenant; a published or retired version never changes';
comment on column public.legal_documents.version is 'the label consent records store as policy_version';

create unique index legal_documents_one_published_key
  on public.legal_documents (tenant_id, kind, language)
  where status = 'published';

update public.payment_methods set pos_kind = kind;

create function app.apply_payment_kind_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.pos_kind := new.kind;
    return new;
  end if;
  if coalesce(current_setting('app.payment_kind_override_write', true), 'off') <> 'on' then
    new.pos_kind := new.kind;
  end if;
  new.kind := coalesce(
    (
      select o.kind
      from public.payment_kind_overrides o
      where o.pos_account_id = new.pos_account_id
        and o.payment_method_external_id = new.external_id
    ),
    new.pos_kind
  );
  return new;
end;
$$;

create trigger payment_methods_apply_kind_override
before insert or update of kind on public.payment_methods
for each row execute function app.apply_payment_kind_override();

create function app.apply_payment_kind_overrides_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := case tg_op when 'DELETE' then old.pos_account_id else new.pos_account_id end;
  v_method text := case tg_op when 'DELETE' then old.payment_method_external_id else new.payment_method_external_id end;
begin
  perform set_config('app.payment_kind_override_write', 'on', true);
  update public.payment_methods
  set kind = pos_kind
  where pos_account_id = v_account
    and external_id = v_method;
  if tg_op = 'UPDATE'
     and (old.pos_account_id, old.payment_method_external_id) is distinct from (new.pos_account_id, new.payment_method_external_id) then
    update public.payment_methods
    set kind = pos_kind
    where pos_account_id = old.pos_account_id
      and external_id = old.payment_method_external_id;
  end if;
  perform set_config('app.payment_kind_override_write', 'off', true);
  return null;
end;
$$;

create trigger payment_kind_overrides_apply
after insert or update or delete on public.payment_kind_overrides
for each row execute function app.apply_payment_kind_overrides_row();

create trigger payment_kind_overrides_set_updated_at
before update on public.payment_kind_overrides
for each row execute function app.set_updated_at();

create trigger payment_kind_overrides_keep_created_by
before update on public.payment_kind_overrides
for each row execute function app.keep_created_by();

create trigger payment_kind_overrides_set_updated_by
before insert or update on public.payment_kind_overrides
for each row execute function app.set_updated_by();

create trigger payment_kind_overrides_touch_analytics_inputs
after insert or update or delete on public.payment_kind_overrides
for each row execute function app.touch_analytics_inputs();

create function app.stamp_store_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return new;
  end if;
  if new.opening_hours is distinct from old.opening_hours
     and not app.has_store_scope(new.tenant_id, new.id, array['owner']::public.tenant_role[]) then
    raise exception 'opening hours are changed by an owner of the store'
      using errcode = '42501';
  end if;
  if new.code is distinct from old.code
     and new.code is not null
     and exists (
       select 1
       from public.stores s
       where s.tenant_id = new.tenant_id
         and s.id <> new.id
         and upper(btrim(s.code)) = upper(btrim(new.code))
     ) then
    raise exception 'duplicate key value violates unique constraint "stores_code_unique_in_tenant"'
      using errcode = '23505', constraint = 'stores_code_unique_in_tenant';
  end if;
  if (new.code, new.opening_hours, new.seat_count, new.opened_on, new.e_invoice_status, new.tran_no_reset_period, new.member_capture_status)
     is distinct from (old.code, old.opening_hours, old.seat_count, old.opened_on, old.e_invoice_status, old.tran_no_reset_period, old.member_capture_status) then
    new.profile_updated_at := now();
    new.profile_updated_by := v_user;
  end if;
  return new;
end;
$$;

create trigger stores_stamp_profile
before update on public.stores
for each row execute function app.stamp_store_profile();

create function app.stamp_tenant_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.legal_form, new.default_language) is distinct from (old.legal_form, old.default_language) then
    new.profile_updated_at := now();
    new.profile_updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger tenants_stamp_profile
before update on public.tenants
for each row execute function app.stamp_tenant_profile();

create function app.freeze_legal_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.title, new.body_markdown, new.version, new.kind, new.language, new.tenant_id)
       is distinct from (old.title, old.body_markdown, old.version, old.kind, old.language, old.tenant_id) then
    raise exception 'a published legal document is frozen'
      using errcode = '55000';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status = 'published')
       or (old.status = 'published' and new.status = 'retired')
     ) then
    raise exception 'a legal document moves only from draft to published to retired'
      using errcode = '55000';
  end if;
  if old.status <> 'draft' and new.published_at is distinct from old.published_at then
    raise exception 'a legal document keeps its publication date'
      using errcode = '55000';
  end if;
  if old.status = 'retired' and new.retired_at is distinct from old.retired_at then
    raise exception 'a legal document keeps its retirement date'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger legal_documents_freeze
before update on public.legal_documents
for each row execute function app.freeze_legal_document();

create trigger legal_documents_set_updated_at
before update on public.legal_documents
for each row execute function app.set_updated_at();

create trigger legal_documents_keep_created_by
before update on public.legal_documents
for each row execute function app.keep_created_by();

create trigger legal_documents_set_updated_by
before insert or update on public.legal_documents
for each row execute function app.set_updated_by();

create trigger holidays_set_updated_at
before update on public.holidays
for each row execute function app.set_updated_at();

create trigger holidays_keep_created_by
before update on public.holidays
for each row execute function app.keep_created_by();

create trigger holidays_set_updated_by
before insert or update on public.holidays
for each row execute function app.set_updated_by();

create function public.publish_legal_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.legal_documents%rowtype;
begin
  select d.* into v_document
  from public.legal_documents d
  where d.id = p_document_id
  for update;
  if not found
     or not app.has_store_scope(v_document.tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'the legal document cannot be published by this member'
      using errcode = '42501';
  end if;
  if v_document.status <> 'draft' then
    raise exception 'only a draft legal document can be published'
      using errcode = '22023';
  end if;
  perform 1
  from public.legal_documents d
  where d.tenant_id = v_document.tenant_id
    and d.kind = v_document.kind
    and d.language = v_document.language
  for update;
  update public.legal_documents
  set status = 'retired', retired_at = now()
  where tenant_id = v_document.tenant_id
    and kind = v_document.kind
    and language = v_document.language
    and status = 'published';
  update public.legal_documents
  set status = 'published', published_at = now()
  where id = v_document.id;
  return v_document.id;
end;
$$;

create function public.retire_legal_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.legal_documents%rowtype;
begin
  select d.* into v_document
  from public.legal_documents d
  where d.id = p_document_id
  for update;
  if not found
     or not app.has_store_scope(v_document.tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'the legal document cannot be retired by this member'
      using errcode = '42501';
  end if;
  if v_document.status <> 'published' then
    raise exception 'only a published legal document can be retired'
      using errcode = '22023';
  end if;
  update public.legal_documents
  set status = 'retired', retired_at = now()
  where id = v_document.id;
  return v_document.id;
end;
$$;

alter table public.payment_kind_overrides enable row level security;
alter table public.legal_documents enable row level security;

create policy stores_update_for_scope_managers on public.stores
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, id))
  with check (app.can_manage_store_scope(tenant_id, id));

create policy tenants_update_for_unlimited_owners on public.tenants
  for update to authenticated
  using (app.has_store_scope(id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(id, null, array['owner']::public.tenant_role[]));

drop policy holidays_insert_for_tenant_managers on public.holidays;

create policy holidays_insert_for_tenant_managers on public.holidays
  for insert to authenticated
  with check (
    tenant_id is not null
    and app.can_manage_store_scope(tenant_id, null)
    and created_by = (select auth.uid())
  );

create policy payment_kind_overrides_select_for_data_members on public.payment_kind_overrides
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy payment_kind_overrides_insert_for_tenant_managers on public.payment_kind_overrides
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, null)
    and created_by = (select auth.uid())
  );

create policy payment_kind_overrides_update_for_tenant_managers on public.payment_kind_overrides
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, null))
  with check (app.can_manage_store_scope(tenant_id, null));

create policy payment_kind_overrides_delete_for_tenant_managers on public.payment_kind_overrides
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, null));

create policy legal_documents_select_for_data_members on public.legal_documents
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy legal_documents_insert_drafts_for_unlimited_owners on public.legal_documents
  for insert to authenticated
  with check (
    app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[])
    and created_by = (select auth.uid())
    and status = 'draft'
    and published_at is null
    and retired_at is null
  );

create policy legal_documents_update_for_unlimited_owners on public.legal_documents
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy legal_documents_delete_drafts_for_unlimited_owners on public.legal_documents
  for delete to authenticated
  using (
    app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[])
    and status = 'draft'
  );

grant update (code, opening_hours, seat_count, opened_on, e_invoice_status, tran_no_reset_period, member_capture_status)
  on public.stores to authenticated;
grant update (legal_form, default_language) on public.tenants to authenticated;
grant select, insert, update, delete on public.payment_kind_overrides to authenticated;
grant select, insert, delete on public.legal_documents to authenticated;
grant update (title, body_markdown, version) on public.legal_documents to authenticated;

revoke all on function app.apply_payment_kind_override() from public, anon, authenticated, service_role;
revoke all on function app.apply_payment_kind_overrides_row() from public, anon, authenticated, service_role;
revoke all on function app.stamp_store_profile() from public, anon, authenticated, service_role;
revoke all on function app.stamp_tenant_profile() from public, anon, authenticated, service_role;
revoke all on function app.freeze_legal_document() from public, anon, authenticated, service_role;
revoke all on function public.publish_legal_document(uuid) from public, anon, service_role;
revoke all on function public.retire_legal_document(uuid) from public, anon, service_role;

grant execute on function public.publish_legal_document(uuid) to authenticated;
grant execute on function public.retire_legal_document(uuid) to authenticated;
