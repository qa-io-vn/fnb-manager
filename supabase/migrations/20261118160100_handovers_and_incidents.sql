create table public.incident_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null check (char_length(label) between 1 and 60 and label !~ '[[:cntrl:]]'),
  sort_order smallint not null default 50 check (sort_order between 1 and 99),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, key)
);

comment on table public.incident_categories is 'categories of incident and stock-out reports: the Vietnamese defaults as global rows (tenant_id null) and a tenant''s own rows, which override a default of the same key (label, order, active) or add a key; a tenant''s effective list is incident_categories_of; tenant rows written by owners with an unlimited scope';
comment on column public.incident_categories.key is 'the stable key a report stores in incidents.category_key; never changes once written';

insert into public.incident_categories (tenant_id, key, label, sort_order)
values
  (null, 'thiet_bi', 'Thiết bị', 10),
  (null, 've_sinh', 'Vệ sinh', 20),
  (null, 'khach_hang', 'Khách hàng', 30),
  (null, 'nhan_su', 'Nhân sự', 40),
  (null, 'khac', 'Khác', 90);

create table public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  from_shift smallint not null check (from_shift between 1 and 12),
  to_shift smallint not null check (to_shift between 1 and 12),
  note text not null check (char_length(note) between 1 and 2000 and translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (acknowledged_by is null or acknowledged_at is not null),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.shift_handovers is 'handover notes (FR-STF-17): from shift Ca {from_shift} to Ca {to_shift} of a store''s business date, written by created_by and acknowledged by a manager of the store who is not the writer; the writer edits the note until it is acknowledged; the note is free text that no message or log ever carries';
comment on column public.shift_handovers.from_shift is 'n of the label Ca {n}: shifts are numbered by opening order within the business day';

create index shift_handovers_store_date_idx on public.shift_handovers (store_id, business_date);
create index shift_handovers_tenant_date_idx on public.shift_handovers (tenant_id, business_date);
create index shift_handovers_unacknowledged_idx on public.shift_handovers (store_id) where acknowledged_at is null;

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('incident', 'stock_out')),
  category_key text not null check (category_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  description text not null check (char_length(description) between 1 and 1000 and translate(description, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  item_label text check (item_label is null or (char_length(item_label) between 1 and 120 and item_label !~ '[[:cntrl:]]')),
  photo_bucket text,
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 3 and array_position(photo_paths, null) is null),
  photo_removed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'seen', 'resolved')),
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'stock_out') = (item_label is not null)),
  check ((status = 'open') = (acknowledged_at is null)),
  check ((status = 'resolved') = (resolved_at is not null)),
  check (photo_removed_at is null or cardinality(photo_paths) > 0),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.incidents is 'incident and stock-out reports (FR-STF-17) with a category, a free-text description, the item for a stock-out and up to three photos in the store''s brand bucket; open until a manager of the store other than the reporter acknowledges it (seen), then resolved; the reporter edits it only while open; the description is never copied into a message or a log';
comment on column public.incidents.photo_paths is 'object names in photo_bucket, each <tenant>/<store>/incident/<incident id>/<name>.jpg, added after the report exists';
comment on column public.incidents.photo_removed_at is 'the photo-removed marker: when the housekeeping found every photo of the report gone (retention, ops_photo_retention_days)';

create index incidents_store_date_idx on public.incidents (store_id, business_date);
create index incidents_tenant_date_idx on public.incidents (tenant_id, business_date);
create index incidents_store_open_idx on public.incidents (store_id) where status <> 'resolved';
create index incidents_photo_idx on public.incidents (id) where cardinality(photo_paths) > 0 and photo_removed_at is null;

create function app.incident_category_active(p_tenant_id uuid, p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select c.active
    from public.incident_categories c
    where c.key = p_key
      and (c.tenant_id = p_tenant_id or c.tenant_id is null)
    order by c.tenant_id nulls last
    limit 1
  ), false);
$$;

comment on function app.incident_category_active(uuid, text) is 'whether the key is an active category for the tenant: its own row when it has one, else the global default';

create function app.prepare_shift_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.business_date := app.store_business_date(new.store_id, now());
  new.acknowledged_by := null;
  new.acknowledged_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.prepare_shift_handover() is 'trigger before a handover is inserted: the store''s business date now, unacknowledged';

create function app.guard_shift_handover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_id, new.business_date, new.created_by, new.created_at)
     is distinct from (old.id, old.tenant_id, old.store_id, old.business_date, old.created_by, old.created_at) then
    raise exception 'a handover keeps its store, date and writer' using errcode = '55000';
  end if;
  if (new.from_shift, new.to_shift, new.note) is distinct from (old.from_shift, old.to_shift, old.note) then
    if old.acknowledged_at is not null then
      raise exception 'an acknowledged handover can no longer be edited' using errcode = '55000';
    end if;
    if (select auth.uid()) is distinct from old.created_by then
      raise exception 'only the writer edits a handover' using errcode = '42501';
    end if;
  end if;
  if old.acknowledged_at is not null
     and (new.acknowledged_by, new.acknowledged_at) is distinct from (old.acknowledged_by, old.acknowledged_at) then
    raise exception 'an acknowledgement stays' using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function app.guard_shift_handover() is 'trigger before a handover is updated: store, date and writer fixed (55000); the note and the shift labels change only by the writer (42501) while unacknowledged (55000); an acknowledgement is never undone';

create function app.check_incident_photos(p_incident public.incidents)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_path text;
begin
  if cardinality(p_incident.photo_paths) = 0 then
    return;
  end if;
  if p_incident.photo_bucket is null then
    raise exception 'no brand covers this store, so it has no photo bucket' using errcode = '22023';
  end if;
  if cardinality(p_incident.photo_paths) > 3 then
    raise exception 'a report has at most three photos' using errcode = '22023';
  end if;
  if cardinality(p_incident.photo_paths) <> (select count(distinct x.path) from unnest(p_incident.photo_paths) as x (path)) then
    raise exception 'a photo is listed twice' using errcode = '22023';
  end if;
  foreach v_path in array p_incident.photo_paths loop
    if not exists (
      select 1
      from app.ops_photo_object(v_path) p
      where p.tenant_id = p_incident.tenant_id
        and p.store_id = p_incident.store_id
        and p.kind = 'incident'
        and p.parent_id = p_incident.id
    ) then
      raise exception 'a photo path is <tenant>/<store>/incident/<report>/<name>.jpg of this report' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = p_incident.photo_bucket and o.name = v_path) then
      raise exception 'the photo is not in the report''s bucket; upload it first' using errcode = '22023';
    end if;
  end loop;
end;
$$;

comment on function app.check_incident_photos(public.incidents) is 'refuses (22023) a photo list of a report whose store has no bucket, with more than three photos, that names a photo twice, or that names an object outside the report''s path or missing from its bucket';

create function app.prepare_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.occurred_at := coalesce(new.occurred_at, now());
  if new.occurred_at not between now() - interval '7 days' and now() + interval '5 minutes' then
    raise exception 'a report''s time is within the last 7 days' using errcode = '22023';
  end if;
  if not app.incident_category_active(new.tenant_id, new.category_key) then
    raise exception 'the category is not an active category of the tenant' using errcode = '22023';
  end if;
  if cardinality(new.photo_paths) > 0 then
    raise exception 'photos are added once the report exists' using errcode = '22023';
  end if;
  new.business_date := app.store_business_date(new.store_id, new.occurred_at);
  new.photo_bucket := app.ops_photo_bucket(new.tenant_id, new.store_id);
  new.photo_removed_at := null;
  new.status := 'open';
  new.acknowledged_by := null;
  new.acknowledged_at := null;
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.prepare_incident() is 'trigger before a report is inserted: a time within the last 7 days, an active category of the tenant, no photo yet (22023); the business date of that time, the store''s photo bucket, status open';

create function app.guard_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_id, new.kind, new.photo_bucket, new.created_by, new.created_at)
     is distinct from (old.id, old.tenant_id, old.store_id, old.kind, old.photo_bucket, old.created_by, old.created_at) then
    raise exception 'a report keeps its store, kind and reporter' using errcode = '55000';
  end if;
  if (new.occurred_at, new.category_key, new.description, new.item_label, new.photo_paths)
     is distinct from (old.occurred_at, old.category_key, old.description, old.item_label, old.photo_paths) then
    if old.status <> 'open' then
      raise exception 'an acknowledged report can no longer be edited' using errcode = '55000';
    end if;
    if (select auth.uid()) is distinct from old.created_by then
      raise exception 'only the reporter edits a report' using errcode = '42501';
    end if;
    if new.occurred_at not between old.created_at - interval '7 days' and old.created_at + interval '5 minutes' then
      raise exception 'a report''s time is within 7 days before it was written' using errcode = '22023';
    end if;
    if new.category_key is distinct from old.category_key and not app.incident_category_active(new.tenant_id, new.category_key) then
      raise exception 'the category is not an active category of the tenant' using errcode = '22023';
    end if;
    if new.photo_paths is distinct from old.photo_paths then
      perform app.check_incident_photos(new);
      new.photo_removed_at := null;
    end if;
    new.business_date := app.store_business_date(new.store_id, new.occurred_at);
  elsif new.business_date is distinct from old.business_date then
    raise exception 'a report''s date follows its time' using errcode = '55000';
  end if;
  if not (
    new.status = old.status
    or (old.status = 'open' and new.status in ('seen', 'resolved'))
    or (old.status = 'seen' and new.status = 'resolved')
  ) then
    raise exception 'a report goes from open to seen to resolved' using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function app.guard_incident() is 'trigger before a report is updated: store, kind, bucket and reporter fixed (55000); time, category, description, item and photos change only by the reporter (42501) while the report is open (55000), with the same checks as at the start; the status only moves forward';

create trigger incident_categories_set_updated_at before update on public.incident_categories for each row execute function app.set_updated_at();
create trigger incident_categories_keep_created_by before update on public.incident_categories for each row execute function app.keep_created_by();
create trigger incident_categories_set_updated_by before insert or update on public.incident_categories for each row execute function app.set_updated_by();
create trigger shift_handovers_prepare before insert on public.shift_handovers for each row execute function app.prepare_shift_handover();
create trigger shift_handovers_guard before update on public.shift_handovers for each row execute function app.guard_shift_handover();
create trigger shift_handovers_set_updated_at before update on public.shift_handovers for each row execute function app.set_updated_at();
create trigger shift_handovers_keep_created_by before update on public.shift_handovers for each row execute function app.keep_created_by();
create trigger incidents_prepare before insert on public.incidents for each row execute function app.prepare_incident();
create trigger incidents_guard before update on public.incidents for each row execute function app.guard_incident();
create trigger incidents_set_updated_at before update on public.incidents for each row execute function app.set_updated_at();
create trigger incidents_keep_created_by before update on public.incidents for each row execute function app.keep_created_by();

alter table public.incident_categories enable row level security;
alter table public.shift_handovers enable row level security;
alter table public.incidents enable row level security;

create policy incident_categories_select_for_operations on public.incident_categories
  for select to authenticated
  using (tenant_id is null or app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]));
create policy incident_categories_insert_for_owners on public.incident_categories
  for insert to authenticated
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy incident_categories_update_for_owners on public.incident_categories
  for update to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy incident_categories_delete_for_owners on public.incident_categories
  for delete to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy shift_handovers_select_for_operations on public.shift_handovers
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy shift_handovers_insert_own on public.shift_handovers
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy shift_handovers_update_own_or_managed on public.shift_handovers
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy shift_handovers_delete_managed on public.shift_handovers
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

create policy incidents_select_for_operations on public.incidents
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy incidents_insert_own on public.incidents
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy incidents_update_own_or_managed on public.incidents
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy incidents_delete_managed on public.incidents
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

revoke all on public.incident_categories, public.shift_handovers, public.incidents from anon, authenticated;
grant select, insert, delete on public.incident_categories to authenticated;
grant update (label, sort_order, active) on public.incident_categories to authenticated;
grant select on public.shift_handovers, public.incidents to authenticated;
grant insert (tenant_id, store_id, from_shift, to_shift, note) on public.shift_handovers to authenticated;
grant update (from_shift, to_shift, note) on public.shift_handovers to authenticated;
grant insert (tenant_id, store_id, occurred_at, kind, category_key, description, item_label) on public.incidents to authenticated;
grant update (occurred_at, category_key, description, item_label, photo_paths) on public.incidents to authenticated;

create or replace function app.ops_photo_readable(p_bucket_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.ops_photo_object(p_name) p
    join public.checklist_runs r
      on p.kind = 'run'
     and r.id = p.parent_id
     and r.tenant_id = p.tenant_id
     and r.store_id = p.store_id
     and r.photo_bucket = p_bucket_id
    where app.ops_can_manage(r.tenant_id, r.store_id)
       or (r.created_by = (select auth.uid()) and app.ops_can_write_own(r.tenant_id, r.store_id))
  )
  or exists (
    select 1
    from app.ops_photo_object(p_name) p
    join public.incidents i
      on p.kind = 'incident'
     and i.id = p.parent_id
     and i.tenant_id = p.tenant_id
     and i.store_id = p.store_id
     and i.photo_bucket = p_bucket_id
    where app.ops_can_manage(i.tenant_id, i.store_id)
       or (i.created_by = (select auth.uid()) and app.ops_can_write_own(i.tenant_id, i.store_id))
  );
$$;

comment on function app.ops_photo_readable(text, text) is 'storage policy helper: whether the caller may read an operations photo: the path names an existing run or report of that tenant and store whose bucket it is in, and the caller manages the store or is the run''s actor or the reporter still working there; staff never read another member''s photos';

create or replace function app.ops_photo_writable(p_bucket_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.ops_photo_object(p_name) p
    join public.checklist_runs r
      on p.kind = 'run'
     and r.id = p.parent_id
     and r.tenant_id = p.tenant_id
     and r.store_id = p.store_id
     and r.photo_bucket = p_bucket_id
    where r.status = 'open'
      and r.created_by = (select auth.uid())
      and app.ops_can_write_own(r.tenant_id, r.store_id)
  )
  or exists (
    select 1
    from app.ops_photo_object(p_name) p
    join public.incidents i
      on p.kind = 'incident'
     and i.id = p.parent_id
     and i.tenant_id = p.tenant_id
     and i.store_id = p.store_id
     and i.photo_bucket = p_bucket_id
    where i.status = 'open'
      and i.created_by = (select auth.uid())
      and app.ops_can_write_own(i.tenant_id, i.store_id)
  );
$$;

comment on function app.ops_photo_writable(text, text) is 'storage policy helper: whether the caller may upload an operations photo: only into the path of their own open run, or of their own report while it is unacknowledged, in its bucket';

create or replace function app.mark_removed_ops_photos(p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_marked integer;
  v_reports integer;
begin
  update public.checklist_answers a
  set photo_removed_at = p_at
  from public.checklist_runs r
  where r.id = a.run_id
    and a.photo_path is not null
    and a.photo_removed_at is null
    and not exists (
      select 1 from storage.objects o where o.bucket_id = r.photo_bucket and o.name = a.photo_path
    );
  get diagnostics v_marked = row_count;
  update public.incidents i
  set photo_removed_at = p_at
  where cardinality(i.photo_paths) > 0
    and i.photo_removed_at is null
    and not exists (
      select 1 from storage.objects o where o.bucket_id = i.photo_bucket and o.name = any (i.photo_paths)
    );
  get diagnostics v_reports = row_count;
  return v_marked + v_reports;
end;
$$;

comment on function app.mark_removed_ops_photos(timestamptz) is 'housekeeping: sets the photo-removed marker on every answer whose photo object is gone and on every report none of whose photos remains, and returns how many rows it marked; the paths stay';

create function app.acknowledge_handover(p_handover_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.shift_handovers;
begin
  select h.* into v_row
  from public.shift_handovers h
  where h.id = p_handover_id
  for update;
  if not found or not app.ops_can_manage(v_row.tenant_id, v_row.store_id) then
    raise exception 'the handover cannot be acknowledged by this member' using errcode = '42501';
  end if;
  if v_row.created_by = (select auth.uid()) then
    raise exception 'nobody acknowledges their own handover' using errcode = '42501';
  end if;
  if v_row.acknowledged_at is null then
    update public.shift_handovers h
    set acknowledged_by = (select auth.uid()),
        acknowledged_at = now()
    where h.id = v_row.id
    returning h.* into v_row;
  end if;
  return jsonb_build_object('handover_id', v_row.id, 'acknowledged_by', v_row.acknowledged_by, 'acknowledged_at', v_row.acknowledged_at);
end;
$$;

comment on function app.acknowledge_handover(uuid) is 'acknowledges a handover as an owner or manager of its store who did not write it (42501 otherwise); a second call keeps the first acknowledgement';

create function app.acknowledge_incident(p_incident_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.incidents;
begin
  select i.* into v_row
  from public.incidents i
  where i.id = p_incident_id
  for update;
  if not found or not app.ops_can_manage(v_row.tenant_id, v_row.store_id) then
    raise exception 'the report cannot be acknowledged by this member' using errcode = '42501';
  end if;
  if v_row.created_by = (select auth.uid()) then
    raise exception 'nobody acknowledges their own report' using errcode = '42501';
  end if;
  if v_row.status = 'open' then
    update public.incidents i
    set status = 'seen',
        acknowledged_by = (select auth.uid()),
        acknowledged_at = now()
    where i.id = v_row.id
    returning i.* into v_row;
  end if;
  return jsonb_build_object(
    'incident_id', v_row.id, 'status', v_row.status,
    'acknowledged_by', v_row.acknowledged_by, 'acknowledged_at', v_row.acknowledged_at,
    'resolved_by', v_row.resolved_by, 'resolved_at', v_row.resolved_at
  );
end;
$$;

comment on function app.acknowledge_incident(uuid) is 'marks an open report seen as an owner or manager of its store who is not the reporter (42501 otherwise); a seen or resolved report is returned as it is';

create function app.resolve_incident(p_incident_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.incidents;
begin
  select i.* into v_row
  from public.incidents i
  where i.id = p_incident_id
  for update;
  if not found or not app.ops_can_manage(v_row.tenant_id, v_row.store_id) then
    raise exception 'the report cannot be resolved by this member' using errcode = '42501';
  end if;
  if v_row.status = 'open' then
    if v_row.created_by = (select auth.uid()) then
      raise exception 'nobody acknowledges their own report; another manager marks it seen first' using errcode = '42501';
    end if;
    update public.incidents i
    set status = 'resolved',
        acknowledged_by = (select auth.uid()),
        acknowledged_at = now(),
        resolved_by = (select auth.uid()),
        resolved_at = now()
    where i.id = v_row.id
    returning i.* into v_row;
  elsif v_row.status = 'seen' then
    update public.incidents i
    set status = 'resolved',
        resolved_by = (select auth.uid()),
        resolved_at = now()
    where i.id = v_row.id
    returning i.* into v_row;
  end if;
  return jsonb_build_object(
    'incident_id', v_row.id, 'status', v_row.status,
    'acknowledged_by', v_row.acknowledged_by, 'acknowledged_at', v_row.acknowledged_at,
    'resolved_by', v_row.resolved_by, 'resolved_at', v_row.resolved_at
  );
end;
$$;

comment on function app.resolve_incident(uuid) is 'resolves a report as an owner or manager of its store (42501 otherwise): an open one is acknowledged at the same time, which its reporter may not do (42501); a seen one may be resolved by any manager of the store, the reporter included; a resolved report is returned as it is';

create function public.acknowledge_handover(p_handover_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.acknowledge_handover(p_handover_id);
$$;

comment on function public.acknowledge_handover(uuid) is 'RPC: app.acknowledge_handover';

create function public.acknowledge_incident(p_incident_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.acknowledge_incident(p_incident_id);
$$;

comment on function public.acknowledge_incident(uuid) is 'RPC: app.acknowledge_incident';

create function public.resolve_incident(p_incident_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.resolve_incident(p_incident_id);
$$;

comment on function public.resolve_incident(uuid) is 'RPC: app.resolve_incident';

create function public.write_handover(p_store_id uuid, p_from_shift integer, p_to_shift integer, p_note text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_row public.shift_handovers;
begin
  select s.tenant_id into v_tenant_id from public.stores s where s.id = p_store_id;
  if v_tenant_id is null or not app.ops_can_write_own(v_tenant_id, p_store_id) then
    raise exception 'the handover cannot be written at this store by this member' using errcode = '42501';
  end if;
  insert into public.shift_handovers (tenant_id, store_id, from_shift, to_shift, note)
  values (v_tenant_id, p_store_id, p_from_shift, p_to_shift, btrim(p_note))
  returning * into v_row;
  return jsonb_build_object('handover_id', v_row.id, 'business_date', v_row.business_date);
end;
$$;

comment on function public.write_handover(uuid, integer, integer, text) is 'writes a handover note from Ca {p_from_shift} to Ca {p_to_shift} at a store in the caller''s operations scope (42501 otherwise); 23514 for a shift outside 1 to 12 or a note outside 1 to 2000 characters; returns {handover_id, business_date}';

create function public.update_handover(p_handover_id uuid, p_from_shift integer, p_to_shift integer, p_note text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row public.shift_handovers;
begin
  update public.shift_handovers h
  set from_shift = p_from_shift,
      to_shift = p_to_shift,
      note = btrim(p_note)
  where h.id = p_handover_id
  returning h.* into v_row;
  if not found then
    raise exception 'the handover cannot be changed by this member' using errcode = '42501';
  end if;
  return jsonb_build_object('handover_id', v_row.id, 'business_date', v_row.business_date);
end;
$$;

comment on function public.update_handover(uuid, integer, integer, text) is 'replaces the shift labels and the note of the caller''s own handover while it is unacknowledged (55000 after, 42501 for someone else''s)';

create function public.report_incident(
  p_store_id uuid,
  p_kind text,
  p_category_key text,
  p_description text,
  p_item_label text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_row public.incidents;
begin
  select s.tenant_id into v_tenant_id from public.stores s where s.id = p_store_id;
  if v_tenant_id is null or not app.ops_can_write_own(v_tenant_id, p_store_id) then
    raise exception 'the report cannot be written at this store by this member' using errcode = '42501';
  end if;
  insert into public.incidents (tenant_id, store_id, occurred_at, kind, category_key, description, item_label)
  values (v_tenant_id, p_store_id, coalesce(p_occurred_at, now()), p_kind, p_category_key, btrim(p_description), nullif(btrim(p_item_label), ''))
  returning * into v_row;
  return jsonb_build_object(
    'incident_id', v_row.id,
    'business_date', v_row.business_date,
    'status', v_row.status,
    'photo_bucket', v_row.photo_bucket,
    'photo_prefix', case when v_row.photo_bucket is not null then v_row.tenant_id || '/' || v_row.store_id || '/incident/' || v_row.id || '/' end
  );
end;
$$;

comment on function public.report_incident(uuid, text, text, text, text, timestamptz) is 'reports an incident or a stock-out at a store in the caller''s operations scope (42501 otherwise): kind incident or stock_out, an active category key of the tenant, a description and, for a stock-out only, the item (23514 otherwise); returns the id with the bucket and path prefix its photos go to';

create function public.update_incident(p_incident_id uuid, p_category_key text, p_description text, p_item_label text, p_photo_paths text[])
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row public.incidents;
begin
  update public.incidents i
  set category_key = p_category_key,
      description = btrim(p_description),
      item_label = nullif(btrim(p_item_label), ''),
      photo_paths = coalesce(p_photo_paths, '{}'::text[])
  where i.id = p_incident_id
  returning i.* into v_row;
  if not found then
    raise exception 'the report cannot be changed by this member' using errcode = '42501';
  end if;
  return jsonb_build_object('incident_id', v_row.id, 'status', v_row.status, 'photo_paths', to_jsonb(v_row.photo_paths));
end;
$$;

comment on function public.update_incident(uuid, text, text, text, text[]) is 'replaces the category, description, item and photo list of the caller''s own report while it is open (55000 after, 42501 for someone else''s); every photo must already be uploaded into the report''s path (22023)';

create function public.incident_categories_of(p_tenant_id uuid)
returns table (key text, label text, sort_order smallint, active boolean, tenant_row boolean)
language sql
stable
set search_path = ''
as $$
  select e.key, e.label, e.sort_order, e.active, e.tenant_row
  from (
    select distinct on (c.key) c.key, c.label, c.sort_order, c.active, c.tenant_id is not null as tenant_row
    from public.incident_categories c
    where c.tenant_id = p_tenant_id or c.tenant_id is null
    order by c.key, c.tenant_id nulls last
  ) e
  order by e.sort_order, e.key;
$$;

comment on function public.incident_categories_of(uuid) is 'the tenant''s effective categories: its own rows and the global defaults it does not override, active or not, in order; a caller outside the tenant gets the defaults only';

revoke all on function app.incident_category_active(uuid, text) from public, anon, authenticated;
revoke all on function app.prepare_shift_handover() from public, anon, authenticated, service_role;
revoke all on function app.guard_shift_handover() from public, anon, authenticated, service_role;
revoke all on function app.check_incident_photos(public.incidents) from public, anon, authenticated, service_role;
revoke all on function app.prepare_incident() from public, anon, authenticated, service_role;
revoke all on function app.guard_incident() from public, anon, authenticated, service_role;
revoke all on function app.acknowledge_handover(uuid) from public, anon, service_role;
revoke all on function app.acknowledge_incident(uuid) from public, anon, service_role;
revoke all on function app.resolve_incident(uuid) from public, anon, service_role;
revoke all on function public.acknowledge_handover(uuid) from public, anon, service_role;
revoke all on function public.acknowledge_incident(uuid) from public, anon, service_role;
revoke all on function public.resolve_incident(uuid) from public, anon, service_role;
revoke all on function public.write_handover(uuid, integer, integer, text) from public, anon, service_role;
revoke all on function public.update_handover(uuid, integer, integer, text) from public, anon, service_role;
revoke all on function public.report_incident(uuid, text, text, text, text, timestamptz) from public, anon, service_role;
revoke all on function public.update_incident(uuid, text, text, text, text[]) from public, anon, service_role;
revoke all on function public.incident_categories_of(uuid) from public, anon, service_role;

grant execute on function app.acknowledge_handover(uuid) to authenticated;
grant execute on function app.acknowledge_incident(uuid) to authenticated;
grant execute on function app.resolve_incident(uuid) to authenticated;
grant execute on function public.acknowledge_handover(uuid) to authenticated;
grant execute on function public.acknowledge_incident(uuid) to authenticated;
grant execute on function public.resolve_incident(uuid) to authenticated;
grant execute on function public.write_handover(uuid, integer, integer, text) to authenticated;
grant execute on function public.update_handover(uuid, integer, integer, text) to authenticated;
grant execute on function public.report_incident(uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.update_incident(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.incident_categories_of(uuid) to authenticated;
