create or replace function app.keep_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 and new.created_by is null then
    return new;
  end if;
  new.created_by := old.created_by;
  return new;
end;
$$;

create or replace function app.stamp_store_profile()
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
  if new.code is distinct from old.code and new.code is not null then
    perform pg_advisory_xact_lock(hashtextextended('stores_code:' || new.tenant_id::text, 0));
    if exists (
      select 1
      from public.stores s
      where s.tenant_id = new.tenant_id
        and s.id <> new.id
        and upper(btrim(s.code)) = upper(btrim(new.code))
    ) then
      raise exception 'duplicate key value violates unique constraint "stores_code_unique_in_tenant"'
        using errcode = '23505', constraint = 'stores_code_unique_in_tenant';
    end if;
  end if;
  if (new.code, new.opening_hours, new.seat_count, new.opened_on, new.e_invoice_status, new.tran_no_reset_period, new.member_capture_status)
     is distinct from (old.code, old.opening_hours, old.seat_count, old.opened_on, old.e_invoice_status, old.tran_no_reset_period, old.member_capture_status) then
    new.profile_updated_at := now();
    new.profile_updated_by := v_user;
  end if;
  return new;
end;
$$;

create or replace function public.publish_legal_document(p_document_id uuid)
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
  where d.id = p_document_id;
  if not found
     or not app.has_store_scope(v_document.tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'the legal document cannot be published by this member'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('legal_documents:' || v_document.tenant_id::text || ':' || v_document.kind::text || ':' || v_document.language, 0)
  );
  select d.* into v_document
  from public.legal_documents d
  where d.id = p_document_id
  for update;
  if not found then
    raise exception 'the legal document cannot be published by this member'
      using errcode = '42501';
  end if;
  if v_document.status <> 'draft' then
    raise exception 'only a draft legal document can be published'
      using errcode = '22023';
  end if;
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

create or replace function public.retire_legal_document(p_document_id uuid)
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
  where d.id = p_document_id;
  if not found
     or not app.has_store_scope(v_document.tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'the legal document cannot be retired by this member'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('legal_documents:' || v_document.tenant_id::text || ':' || v_document.kind::text || ':' || v_document.language, 0)
  );
  select d.* into v_document
  from public.legal_documents d
  where d.id = p_document_id
  for update;
  if not found then
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
