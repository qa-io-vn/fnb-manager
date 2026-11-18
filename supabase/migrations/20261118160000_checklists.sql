alter table public.tenants
  add column ops_photo_retention_days smallint not null default 90 check (ops_photo_retention_days between 7 and 730);

comment on column public.tenants.ops_photo_retention_days is 'days an operations photo (checklist proof, incident report) is kept in the brand bucket before the housekeeping job removes it; the rows keep a photo-removed marker; written by an owner with an unlimited scope through set_ops_photo_retention_days';

create function app.store_business_date(p_store_id uuid, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select ((p_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date
  from public.stores s
  where s.id = p_store_id;
$$;

comment on function app.store_business_date(uuid, timestamptz) is 'the business date of an instant at a store under ADR-007: the store''s local time less its day start; null for a store the caller cannot read';

create function app.ops_photo_bucket(p_tenant_id uuid, p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'ops-' || b.brand_key
  from public.brands b
  where b.tenant_id = p_tenant_id
    and p_store_id = any (b.store_ids)
  order by char_length(b.brand_key), b.brand_key
  limit 1;
$$;

comment on function app.ops_photo_bucket(uuid, uuid) is 'the private photo bucket of the store: ops-<brand key> of the tenant''s brand that covers the store (the lowest key when several do); null when no brand covers the store, so no photo can be stored there';

create function app.ops_photo_object(p_name text)
returns table (tenant_id uuid, store_id uuid, kind text, parent_id uuid)
language sql
immutable
set search_path = ''
as $$
  select m[1]::uuid, m[2]::uuid, m[3], m[4]::uuid
  from regexp_match(
    p_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(run|incident)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[a-z0-9][a-z0-9_-]{0,63}\.jpe?g$'
  ) as m
  where m is not null;
$$;

comment on function app.ops_photo_object(text) is 'parses an operations photo path <tenant>/<store>/run|incident/<run or incident id>/<name>.jpg (lower-case UUIDs, a name of 1 to 64 of a-z, 0-9, _ and -); no row for any other name';

create function app.ensure_ops_photo_bucket(p_bucket_id text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_bucket_id is null or p_bucket_id !~ '^ops-brand-[1-9][0-9]{0,2}$' then
    raise exception 'an operations photo bucket is ops-<brand key>' using errcode = '22023';
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (p_bucket_id, p_bucket_id, false, 1048576, array['image/jpeg'])
  on conflict (id) do update
  set public = false,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg'];
  return p_bucket_id;
end;
$$;

comment on function app.ensure_ops_photo_bucket(text) is 'creates or resets the private photo bucket ops-<brand key>: not public, at most 1 MiB per object, image/jpeg only; brand keys are per tenant, so brand-1 of two tenants share one bucket and the tenant id that starts every path keeps them apart';

create function app.create_brand_photo_bucket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.ensure_ops_photo_bucket('ops-' || new.brand_key);
  return null;
end;
$$;

comment on function app.create_brand_photo_bucket() is 'trigger after a brand is added or renamed: ensures its photo bucket ops-<brand key>; a bucket is never deleted with its brand, so older photos stay readable';

create trigger brands_create_photo_bucket
after insert or update of brand_key on public.brands
for each row execute function app.create_brand_photo_bucket();

select app.ensure_ops_photo_bucket(k.bucket_id)
from (select distinct 'ops-' || b.brand_key as bucket_id from public.brands b) k;

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  shift_phase text not null check (shift_phase in ('opening', 'midshift', 'closing')),
  title text not null check (char_length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  active boolean not null default true,
  version integer not null default 1 check (version between 1 and 100000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.checklist_templates is 'checklists defined as data (FR-STF-15): one row per checklist of a store, or of every store of the tenant when store_id is null, and shift phase; version is the current version, whose items a new run reads; written only through save_checklist_template and set_checklist_template_active';
comment on column public.checklist_templates.store_id is 'the store the checklist belongs to; null for every store of the tenant, which only a member with an unlimited scope edits';
comment on column public.checklist_templates.version is 'the current version: every save_checklist_template call adds one and writes a new set of checklist_items, so earlier runs keep the wording of their version';

create index checklist_templates_tenant_phase_idx on public.checklist_templates (tenant_id, shift_phase);
create index checklist_templates_store_id_idx on public.checklist_templates (store_id) where store_id is not null;

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid,
  template_id uuid not null,
  template_version integer not null check (template_version >= 1),
  position smallint not null check (position between 1 and 60),
  label text not null check (char_length(label) between 1 and 200 and label !~ '[[:cntrl:]]'),
  requires_photo boolean not null default false,
  number_unit text check (number_unit is null or (char_length(number_unit) between 1 and 16 and number_unit !~ '[[:cntrl:]]')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, template_version, position),
  unique (tenant_id, id),
  foreign key (tenant_id, template_id) references public.checklist_templates (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.checklist_items is 'the items of one version of a checklist template, in order; immutable: a change is a new version written by save_checklist_template';
comment on column public.checklist_items.store_id is 'the template''s store_id, copied so that the read policy needs no join';
comment on column public.checklist_items.requires_photo is 'the item cannot be marked done without a photo in the run''s path of the brand bucket';
comment on column public.checklist_items.number_unit is 'when set, the item asks for a number in this unit (for example °C) and cannot be marked done without one';

create table public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  template_id uuid not null,
  template_version integer not null,
  title text not null,
  shift_phase text not null check (shift_phase in ('opening', 'midshift', 'closing')),
  business_date date not null,
  photo_bucket text,
  status text not null default 'open' check (status in ('open', 'finished')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'finished') = (finished_at is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id) references public.checklist_templates (tenant_id, id)
);

comment on table public.checklist_runs is 'one run of a checklist at a store by one member (the actor, created_by): the template version, title and shift phase as they were at the start, the business date under the store''s day start, the photo bucket and the start and finish times; a finished run is read-only for staff';
comment on column public.checklist_runs.photo_bucket is 'the brand bucket the run''s photos go to (app.ops_photo_bucket at the start); null when no brand covers the store';
comment on column public.checklist_runs.business_date is 'the store''s business date at the start (ADR-007: local time less the day start)';

create unique index checklist_runs_one_open_key on public.checklist_runs (store_id, template_id, business_date) where status = 'open';
create index checklist_runs_store_date_idx on public.checklist_runs (store_id, business_date);
create index checklist_runs_tenant_date_idx on public.checklist_runs (tenant_id, business_date);
create index checklist_runs_template_idx on public.checklist_runs (template_id, template_version);

create table public.checklist_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid not null,
  run_id uuid not null,
  item_id uuid not null,
  done boolean not null default false,
  number_value numeric(12, 3),
  photo_path text,
  photo_removed_at timestamptz,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (photo_removed_at is null or photo_path is not null),
  unique (run_id, item_id),
  foreign key (tenant_id, run_id) references public.checklist_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.checklist_items (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.checklist_answers is 'one row per item of a run, created with the run (created_by is the run''s actor); done, number_value and photo_path are written by the actor while the run is open and by managers of the store at any time, each write stamping answered_by and answered_at; a manager''s change after the run finished is logged in checklist_corrections';
comment on column public.checklist_answers.photo_path is 'the object name in the run''s photo_bucket, <tenant>/<store>/run/<run id>/<name>.jpg; kept after the photo is removed';
comment on column public.checklist_answers.photo_removed_at is 'the photo-removed marker: when the housekeeping found the object gone (retention, ops_photo_retention_days)';

create index checklist_answers_run_idx on public.checklist_answers (run_id);
create index checklist_answers_item_idx on public.checklist_answers (item_id);
create index checklist_answers_photo_idx on public.checklist_answers (run_id) where photo_path is not null and photo_removed_at is null;

create table public.checklist_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid not null,
  run_id uuid not null,
  answer_id uuid not null,
  item_id uuid not null,
  old_values jsonb not null check (jsonb_typeof(old_values) = 'object'),
  new_values jsonb not null check (jsonb_typeof(new_values) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.checklist_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (answer_id) references public.checklist_answers (id) on delete cascade
);

comment on table public.checklist_corrections is 'the correction log: one row per change to an answer of a finished run, with the corrector (created_by), the time and done, number_value and photo_path before and after; written only by trigger';

create index checklist_corrections_run_idx on public.checklist_corrections (run_id);
create index checklist_corrections_tenant_created_idx on public.checklist_corrections (tenant_id, created_at desc);

create function app.refuse_checklist_item_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'checklist items are immutable; save a new template version' using errcode = '55000';
end;
$$;

comment on function app.refuse_checklist_item_change() is 'trigger before an update of checklist_items: refused (55000), so a version once written keeps its wording';

create function app.prepare_checklist_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.checklist_templates;
begin
  select t.* into v_template
  from public.checklist_templates t
  where t.id = new.template_id
    and t.tenant_id = new.tenant_id;
  if not found or (v_template.store_id is not null and v_template.store_id <> new.store_id) then
    raise exception 'the checklist is not one of this store' using errcode = '22023';
  end if;
  if not v_template.active then
    raise exception 'the checklist is retired' using errcode = '55000';
  end if;
  new.template_version := v_template.version;
  new.title := v_template.title;
  new.shift_phase := v_template.shift_phase;
  new.business_date := app.store_business_date(new.store_id, now());
  new.photo_bucket := app.ops_photo_bucket(new.tenant_id, new.store_id);
  new.status := 'open';
  new.started_at := now();
  new.finished_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.prepare_checklist_run() is 'trigger before a checklist run is inserted: the template must be active and the store''s own or every store''s (22023, 55000); the run takes the template''s current version, title and shift phase, the store''s business date and photo bucket, status open and the start time, whatever the client sent';

create function app.create_checklist_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.checklist_answers (tenant_id, store_id, run_id, item_id, created_by)
  select new.tenant_id, new.store_id, new.id, i.id, new.created_by
  from public.checklist_items i
  where i.template_id = new.template_id
    and i.template_version = new.template_version
  order by i.position;
  return null;
end;
$$;

comment on function app.create_checklist_answers() is 'trigger after a checklist run is inserted: one open answer per item of the run''s version, owned by the run''s actor';

create function app.guard_checklist_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_id, new.template_id, new.template_version, new.title, new.shift_phase, new.business_date,
      new.photo_bucket, new.started_at, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.store_id, old.template_id, old.template_version, old.title, old.shift_phase, old.business_date,
      old.photo_bucket, old.started_at, old.created_at) then
    raise exception 'a checklist run keeps its store, template, version, date and start' using errcode = '55000';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'open' and new.status = 'finished') then
      raise exception 'a finished checklist run stays finished' using errcode = '55000';
    end if;
    if (select auth.uid()) is distinct from old.created_by then
      raise exception 'only the member who started the run finishes it' using errcode = '42501';
    end if;
    new.finished_at := now();
  else
    new.finished_at := old.finished_at;
  end if;
  return new;
end;
$$;

comment on function app.guard_checklist_run() is 'trigger before a checklist run is updated: everything but the status is fixed (55000); the status only goes from open to finished, by the run''s actor (42501), which stamps finished_at';

create function app.guard_checklist_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.checklist_runs;
  v_item public.checklist_items;
  v_actor uuid := (select auth.uid());
begin
  if (new.id, new.tenant_id, new.store_id, new.run_id, new.item_id, new.created_at)
     is distinct from (old.id, old.tenant_id, old.store_id, old.run_id, old.item_id, old.created_at) then
    raise exception 'an answer keeps its run and item' using errcode = '55000';
  end if;
  if (new.done, new.number_value, new.photo_path) is not distinct from (old.done, old.number_value, old.photo_path) then
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
    return new;
  end if;
  if v_actor is null then
    raise exception 'answers are written by members' using errcode = '42501';
  end if;
  select r.* into v_run from public.checklist_runs r where r.id = old.run_id;
  select i.* into v_item from public.checklist_items i where i.id = old.item_id;
  if not app.ops_can_manage(v_run.tenant_id, v_run.store_id) then
    if v_run.status <> 'open' then
      raise exception 'a finished checklist run is read-only for staff' using errcode = '55000';
    end if;
    if v_actor is distinct from v_run.created_by or not app.ops_can_write_own(v_run.tenant_id, v_run.store_id) then
      raise exception 'only the member who started the run answers it' using errcode = '42501';
    end if;
  end if;
  if new.photo_path is distinct from old.photo_path then
    if new.photo_path is not null then
      if v_run.photo_bucket is null then
        raise exception 'no brand covers this store, so it has no photo bucket' using errcode = '22023';
      end if;
      if not exists (
        select 1
        from app.ops_photo_object(new.photo_path) p
        where p.tenant_id = v_run.tenant_id
          and p.store_id = v_run.store_id
          and p.kind = 'run'
          and p.parent_id = v_run.id
      ) then
        raise exception 'a photo path is <tenant>/<store>/run/<run>/<name>.jpg of this run' using errcode = '22023';
      end if;
      if not exists (
        select 1 from storage.objects o where o.bucket_id = v_run.photo_bucket and o.name = new.photo_path
      ) then
        raise exception 'the photo is not in the run''s bucket; upload it first' using errcode = '22023';
      end if;
    end if;
    new.photo_removed_at := null;
  else
    new.photo_removed_at := old.photo_removed_at;
  end if;
  if new.number_value is not null and v_item.number_unit is null then
    raise exception 'this item takes no number' using errcode = '23514';
  end if;
  if new.done and v_item.requires_photo and new.photo_path is null then
    raise exception 'this item needs a photo before it is done' using errcode = '23514';
  end if;
  if new.done and v_item.number_unit is not null and new.number_value is null then
    raise exception 'this item needs a number before it is done' using errcode = '23514';
  end if;
  new.answered_by := v_actor;
  new.answered_at := now();
  return new;
end;
$$;

comment on function app.guard_checklist_answer() is 'trigger before an answer is updated: run and item fixed (55000); a change of done, number_value or photo_path needs a member (42501): the run''s actor while the run is open, or a manager of the store at any time; staff never change a finished run (55000); a photo must be an object of the run''s path in its bucket (22023), a number only for an item with a unit, and done needs the photo or the number the item asks for (23514); the change stamps answered_by and answered_at and clears the photo-removed marker of a new photo; members hold no privilege on that marker, which only the housekeeping sets';

create function app.log_checklist_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.done, new.number_value, new.photo_path) is not distinct from (old.done, old.number_value, old.photo_path) then
    return null;
  end if;
  if exists (select 1 from public.checklist_runs r where r.id = new.run_id and r.status = 'finished') then
    insert into public.checklist_corrections (tenant_id, store_id, run_id, answer_id, item_id, old_values, new_values, created_by)
    values (
      new.tenant_id, new.store_id, new.run_id, new.id, new.item_id,
      jsonb_build_object('done', old.done, 'number_value', old.number_value, 'photo_path', old.photo_path),
      jsonb_build_object('done', new.done, 'number_value', new.number_value, 'photo_path', new.photo_path),
      (select auth.uid())
    );
  end if;
  return null;
end;
$$;

comment on function app.log_checklist_correction() is 'trigger after an answer is updated: a change of done, number_value or photo_path on a finished run is logged in checklist_corrections with the corrector and the values before and after';

create trigger checklist_templates_set_updated_at before update on public.checklist_templates for each row execute function app.set_updated_at();
create trigger checklist_templates_keep_created_by before update on public.checklist_templates for each row execute function app.keep_created_by();
create trigger checklist_templates_set_updated_by before insert or update on public.checklist_templates for each row execute function app.set_updated_by();
create trigger checklist_items_refuse_update before update on public.checklist_items for each row execute function app.refuse_checklist_item_change();
create trigger checklist_runs_prepare before insert on public.checklist_runs for each row execute function app.prepare_checklist_run();
create trigger checklist_runs_create_answers after insert on public.checklist_runs for each row execute function app.create_checklist_answers();
create trigger checklist_runs_guard before update on public.checklist_runs for each row execute function app.guard_checklist_run();
create trigger checklist_runs_set_updated_at before update on public.checklist_runs for each row execute function app.set_updated_at();
create trigger checklist_runs_keep_created_by before update on public.checklist_runs for each row execute function app.keep_created_by();
create trigger checklist_answers_guard before update on public.checklist_answers for each row execute function app.guard_checklist_answer();
create trigger checklist_answers_set_updated_at before update on public.checklist_answers for each row execute function app.set_updated_at();
create trigger checklist_answers_keep_created_by before update on public.checklist_answers for each row execute function app.keep_created_by();
create trigger checklist_answers_log_correction after update on public.checklist_answers for each row execute function app.log_checklist_correction();

alter table public.checklist_templates enable row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_runs enable row level security;
alter table public.checklist_answers enable row level security;
alter table public.checklist_corrections enable row level security;

create policy checklist_templates_select_for_operations on public.checklist_templates
  for select to authenticated
  using (
    store_id = any ((select app.current_user_ops_store_ids())::uuid[])
    or (store_id is null and app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
  );
create policy checklist_templates_insert_own on public.checklist_templates
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy checklist_templates_update_own_or_managed on public.checklist_templates
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy checklist_templates_delete_managed on public.checklist_templates
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

create policy checklist_items_select_for_operations on public.checklist_items
  for select to authenticated
  using (
    store_id = any ((select app.current_user_ops_store_ids())::uuid[])
    or (store_id is null and app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
  );
create policy checklist_items_insert_own on public.checklist_items
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy checklist_items_update_own_or_managed on public.checklist_items
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy checklist_items_delete_managed on public.checklist_items
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

create policy checklist_runs_select_for_operations on public.checklist_runs
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy checklist_runs_insert_own on public.checklist_runs
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy checklist_runs_update_own_or_managed on public.checklist_runs
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy checklist_runs_delete_managed on public.checklist_runs
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

create policy checklist_answers_select_for_operations on public.checklist_answers
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy checklist_answers_insert_own on public.checklist_answers
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy checklist_answers_update_own_or_managed on public.checklist_answers
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy checklist_answers_delete_managed on public.checklist_answers
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

create policy checklist_corrections_select_for_operations on public.checklist_corrections
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy checklist_corrections_insert_own on public.checklist_corrections
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy checklist_corrections_update_own_or_managed on public.checklist_corrections
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy checklist_corrections_delete_managed on public.checklist_corrections
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

revoke all on public.checklist_templates, public.checklist_items, public.checklist_runs, public.checklist_answers, public.checklist_corrections from anon, authenticated;
grant select on public.checklist_templates, public.checklist_items, public.checklist_runs, public.checklist_answers, public.checklist_corrections to authenticated;
grant insert (tenant_id, store_id, template_id) on public.checklist_runs to authenticated;
grant update (status) on public.checklist_runs to authenticated;
grant update (done, number_value, photo_path) on public.checklist_answers to authenticated;

create function app.ops_photo_readable(p_bucket_id text, p_name text)
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
  );
$$;

comment on function app.ops_photo_readable(text, text) is 'storage policy helper: whether the caller may read an operations photo: the path names an existing run of that tenant and store whose bucket it is in, and the caller manages the store or is the run''s actor still working there; staff never read another member''s photos';

create function app.ops_photo_writable(p_bucket_id text, p_name text)
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
  );
$$;

comment on function app.ops_photo_writable(text, text) is 'storage policy helper: whether the caller may upload an operations photo: only into the path of their own open run, in the run''s bucket';

create policy ops_photos_select_in_scope on storage.objects
  for select to authenticated
  using (left(bucket_id, 4) = 'ops-' and app.ops_photo_readable(bucket_id, name));
create policy ops_photos_insert_own on storage.objects
  for insert to authenticated
  with check (left(bucket_id, 4) = 'ops-' and app.ops_photo_writable(bucket_id, name));

create function app.save_checklist_template(p_tenant_id uuid, p_store_id uuid, p_shift_phase text, p_title text, p_items jsonb, p_template_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title);
  v_template public.checklist_templates;
  v_item jsonb;
  v_label text;
begin
  if not app.ops_can_manage(p_tenant_id, p_store_id) then
    raise exception 'only an owner or a manager of the store edits its checklists' using errcode = '42501';
  end if;
  if p_shift_phase is null or p_shift_phase not in ('opening', 'midshift', 'closing') then
    raise exception 'a shift phase is opening, midshift or closing' using errcode = '22023';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 120 or v_title ~ '[[:cntrl:]]' then
    raise exception 'a checklist title has 1 to 120 characters' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 60 then
    raise exception 'a checklist has 1 to 60 items' using errcode = '22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) as k (key) where k.key not in ('label', 'requires_photo', 'number_unit')) then
      raise exception 'an item is {"label", "requires_photo", "number_unit"}' using errcode = '22023';
    end if;
    v_label := btrim(v_item ->> 'label');
    if jsonb_typeof(v_item -> 'label') is distinct from 'string' or char_length(v_label) not between 1 and 200 or v_label ~ '[[:cntrl:]]' then
      raise exception 'an item label has 1 to 200 characters' using errcode = '22023';
    end if;
    if v_item ? 'requires_photo' and jsonb_typeof(v_item -> 'requires_photo') <> 'boolean' then
      raise exception 'requires_photo is true or false' using errcode = '22023';
    end if;
    if v_item ? 'number_unit' and jsonb_typeof(v_item -> 'number_unit') <> 'null'
       and (jsonb_typeof(v_item -> 'number_unit') <> 'string'
            or char_length(btrim(v_item ->> 'number_unit')) not between 1 and 16
            or (v_item ->> 'number_unit') ~ '[[:cntrl:]]') then
      raise exception 'a number unit has 1 to 16 characters' using errcode = '22023';
    end if;
  end loop;
  if p_template_id is null then
    insert into public.checklist_templates (tenant_id, store_id, shift_phase, title, version, created_by)
    values (p_tenant_id, p_store_id, p_shift_phase, v_title, 1, (select auth.uid()))
    returning * into v_template;
  else
    select t.* into v_template
    from public.checklist_templates t
    where t.id = p_template_id
    for update;
    if not found or v_template.tenant_id <> p_tenant_id or v_template.store_id is distinct from p_store_id or v_template.shift_phase <> p_shift_phase then
      raise exception 'the template is not a checklist of this store and shift phase' using errcode = '22023';
    end if;
    update public.checklist_templates t
    set version = t.version + 1,
        title = v_title
    where t.id = v_template.id
    returning * into v_template;
  end if;
  insert into public.checklist_items (tenant_id, store_id, template_id, template_version, position, label, requires_photo, number_unit, created_by)
  select
    v_template.tenant_id,
    v_template.store_id,
    v_template.id,
    v_template.version,
    e.position::smallint,
    btrim(e.value ->> 'label'),
    coalesce((e.value ->> 'requires_photo')::boolean, false),
    nullif(btrim(e.value ->> 'number_unit'), ''),
    (select auth.uid())
  from jsonb_array_elements(p_items) with ordinality as e (value, position);
  return jsonb_build_object('template_id', v_template.id, 'version', v_template.version, 'active', v_template.active);
end;
$$;

comment on function app.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) is 'creates a checklist (p_template_id null, version 1) or saves a new version of one, as an owner or manager of the store (every store when p_store_id is null): the title and the items, an array of 1 to 60 {"label", "requires_photo", "number_unit"} in order; the store and phase of an existing template never change; runs already started keep their version; returns {template_id, version, active}';

create function app.set_checklist_template_active(p_template_id uuid, p_active boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_template public.checklist_templates;
begin
  select t.* into v_template
  from public.checklist_templates t
  where t.id = p_template_id
  for update;
  if not found or not app.ops_can_manage(v_template.tenant_id, v_template.store_id) then
    raise exception 'the checklist cannot be changed by this member' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'active is true or false' using errcode = '22023';
  end if;
  update public.checklist_templates t
  set active = p_active
  where t.id = v_template.id
    and t.active is distinct from p_active;
  return p_active;
end;
$$;

comment on function app.set_checklist_template_active(uuid, boolean) is 'activates or retires a checklist as an owner or manager of its store (every store for a tenant-wide one) without a new version; a retired checklist starts no run, and open runs can still be finished';

create function app.set_ops_photo_retention_days(p_tenant_id uuid, p_days integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.has_store_scope(p_tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store sets the photo retention' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 7 and 730 then
    raise exception 'the photo retention is 7 to 730 days' using errcode = '22023';
  end if;
  update public.tenants t
  set ops_photo_retention_days = p_days
  where t.id = p_tenant_id;
  return p_days;
end;
$$;

comment on function app.set_ops_photo_retention_days(uuid, integer) is 'sets tenants.ops_photo_retention_days (7 to 730) as an owner with an unlimited scope and returns it';

create function app.expired_ops_photos(p_at timestamptz default now(), p_limit integer default 500)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  left join lateral app.ops_photo_object(o.name) p on true
  left join public.tenants t on t.id = p.tenant_id
  where left(o.bucket_id, 4) = 'ops-'
    and o.created_at < p_at - make_interval(days => coalesce(t.ops_photo_retention_days, 90)::integer)
  order by o.created_at, o.bucket_id, o.name
  limit greatest(least(coalesce(p_limit, 500), 1000), 1);
$$;

comment on function app.expired_ops_photos(timestamptz, integer) is 'housekeeping: up to p_limit (at most 1000) objects of the ops- buckets older than their tenant''s ops_photo_retention_days (90 for a path naming no tenant), oldest first; the job removes them through the Storage API, which also deletes the files, and then calls app.mark_removed_ops_photos';

create function app.mark_removed_ops_photos(p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_marked integer;
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
  return v_marked;
end;
$$;

comment on function app.mark_removed_ops_photos(timestamptz) is 'housekeeping: sets the photo-removed marker on every answer whose photo object is gone from its bucket and returns how many rows it marked; the path stays';

create function app.ops_photo_storage()
returns table (bucket_id text, objects bigint, bytes bigint, oldest_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, count(*), coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint, min(o.created_at)
  from storage.objects o
  where left(o.bucket_id, 4) = 'ops-'
  group by o.bucket_id
  order by o.bucket_id;
$$;

comment on function app.ops_photo_storage() is 'the documented storage query: objects, bytes and the oldest upload per operations bucket, so photo growth is watched against the Free plan';

create function public.save_checklist_template(p_tenant_id uuid, p_store_id uuid, p_shift_phase text, p_title text, p_items jsonb, p_template_id uuid default null)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.save_checklist_template(p_tenant_id, p_store_id, p_shift_phase, p_title, p_items, p_template_id);
$$;

comment on function public.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) is 'RPC: app.save_checklist_template';

create function public.set_checklist_template_active(p_template_id uuid, p_active boolean)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select app.set_checklist_template_active(p_template_id, p_active);
$$;

comment on function public.set_checklist_template_active(uuid, boolean) is 'RPC: app.set_checklist_template_active';

create function public.set_ops_photo_retention_days(p_tenant_id uuid, p_days integer)
returns integer
language sql
volatile
set search_path = ''
as $$
  select app.set_ops_photo_retention_days(p_tenant_id, p_days);
$$;

comment on function public.set_ops_photo_retention_days(uuid, integer) is 'RPC: app.set_ops_photo_retention_days';

create function public.checklist_run_detail(p_run_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'run_id', r.id,
    'tenant_id', r.tenant_id,
    'store_id', r.store_id,
    'template_id', r.template_id,
    'template_version', r.template_version,
    'title', r.title,
    'shift_phase', r.shift_phase,
    'business_date', r.business_date,
    'status', r.status,
    'started_by', r.created_by,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'photo_bucket', r.photo_bucket,
    'photo_prefix', case when r.photo_bucket is not null then r.tenant_id || '/' || r.store_id || '/run/' || r.id || '/' end,
    'items_total', (select count(*) from public.checklist_answers a where a.run_id = r.id),
    'items_done', (select count(*) from public.checklist_answers a where a.run_id = r.id and a.done),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'answer_id', a.id,
        'item_id', i.id,
        'position', i.position,
        'label', i.label,
        'requires_photo', i.requires_photo,
        'number_unit', i.number_unit,
        'done', a.done,
        'number_value', a.number_value,
        'photo_path', a.photo_path,
        'photo_removed', a.photo_removed_at is not null,
        'answered_by', a.answered_by,
        'answered_at', a.answered_at
      ) order by i.position)
      from public.checklist_answers a
      join public.checklist_items i on i.id = a.item_id
      where a.run_id = r.id
    ), '[]'::jsonb)
  )
  from public.checklist_runs r
  where r.id = p_run_id;
$$;

comment on function public.checklist_run_detail(uuid) is 'a checklist run the caller may read with its items in order, the wording of the run''s version, and each answer; null for a run the caller cannot read';

create function public.start_checklist_run(p_template_id uuid, p_store_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_template public.checklist_templates;
  v_run_id uuid;
begin
  select t.* into v_template
  from public.checklist_templates t
  where t.id = p_template_id;
  if not found or (v_template.store_id is not null and v_template.store_id is distinct from p_store_id)
     or not app.ops_can_write_own(v_template.tenant_id, p_store_id) then
    raise exception 'the checklist cannot be started at this store by this member' using errcode = '42501';
  end if;
  if not v_template.active then
    raise exception 'the checklist is retired' using errcode = '55000';
  end if;
  select r.id into v_run_id
  from public.checklist_runs r
  where r.template_id = p_template_id
    and r.store_id = p_store_id
    and r.status = 'open'
    and r.created_by = (select auth.uid())
    and r.business_date = app.store_business_date(p_store_id, now());
  if v_run_id is null then
    begin
      insert into public.checklist_runs (tenant_id, store_id, template_id)
      values (v_template.tenant_id, p_store_id, p_template_id)
      returning id into v_run_id;
    exception when unique_violation then
      raise exception 'another member has this checklist open at this store today' using errcode = '23505';
    end;
  end if;
  return public.checklist_run_detail(v_run_id);
end;
$$;

comment on function public.start_checklist_run(uuid, uuid) is 'starts a run of an active checklist at a store in the caller''s operations scope, or returns the caller''s open run of it for today; the run reads the template''s current version; 42501 outside scope, 55000 for a retired checklist, 23505 while another member has it open today';

create function public.save_checklist_answer(p_answer_id uuid, p_done boolean, p_number_value numeric default null, p_photo_path text default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_answer public.checklist_answers;
begin
  update public.checklist_answers a
  set done = coalesce(p_done, false),
      number_value = p_number_value,
      photo_path = p_photo_path
  where a.id = p_answer_id
  returning a.* into v_answer;
  if not found then
    raise exception 'the answer cannot be changed by this member' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'answer_id', v_answer.id,
    'run_id', v_answer.run_id,
    'item_id', v_answer.item_id,
    'done', v_answer.done,
    'number_value', v_answer.number_value,
    'photo_path', v_answer.photo_path,
    'photo_removed', v_answer.photo_removed_at is not null,
    'answered_by', v_answer.answered_by,
    'answered_at', v_answer.answered_at
  );
end;
$$;

comment on function public.save_checklist_answer(uuid, boolean, numeric, text) is 'replaces done, number and photo path of one answer as the run''s actor while the run is open, or as a manager of the store at any time (logged once the run is finished); the photo must already be uploaded into the run''s path; returns the answer';

create function public.finish_checklist_run(p_run_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.checklist_runs r
  set status = 'finished'
  where r.id = p_run_id
    and r.status = 'open';
  if not found then
    select r.status into v_status from public.checklist_runs r where r.id = p_run_id;
    if v_status is distinct from 'finished' then
      raise exception 'the run cannot be finished by this member' using errcode = '42501';
    end if;
  end if;
  return public.checklist_run_detail(p_run_id);
end;
$$;

comment on function public.finish_checklist_run(uuid) is 'finishes the caller''s own open run, stamping finished_at, and returns it; items left undone stay undone and count in items_done; a finished run is returned as it is; 42501 for another member''s run or one outside the caller''s scope';

create function public.due_checklists(p_store_id uuid, p_shift_phase text default null)
returns table (
  template_id uuid,
  title text,
  shift_phase text,
  template_version integer,
  every_store boolean,
  items integer,
  photo_items integer,
  business_date date,
  run_id uuid,
  run_status text,
  run_started_by uuid,
  run_started_at timestamptz,
  run_finished_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    t.id,
    t.title,
    t.shift_phase,
    t.version,
    t.store_id is null,
    i.items,
    i.photo_items,
    d.business_date,
    r.id,
    r.status,
    r.created_by,
    r.started_at,
    r.finished_at
  from public.stores s
  cross join lateral (
    select ((now() at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date as business_date
  ) d
  join public.checklist_templates t
    on t.tenant_id = s.tenant_id
   and (t.store_id is null or t.store_id = s.id)
   and t.active
   and (p_shift_phase is null or t.shift_phase = p_shift_phase)
  cross join lateral (
    select count(*)::integer as items, (count(*) filter (where ci.requires_photo))::integer as photo_items
    from public.checklist_items ci
    where ci.template_id = t.id
      and ci.template_version = t.version
  ) i
  left join lateral (
    select cr.id, cr.status, cr.created_by, cr.started_at, cr.finished_at
    from public.checklist_runs cr
    where cr.template_id = t.id
      and cr.store_id = s.id
      and cr.business_date = d.business_date
    order by cr.status = 'open' desc, cr.started_at desc, cr.id
    limit 1
  ) r on true
  where s.id = p_store_id
    and app.ops_can_read(s.tenant_id, s.id)
  order by array_position(array['opening', 'midshift', 'closing'], t.shift_phase), t.title, t.id;
$$;

comment on function public.due_checklists(uuid, text) is 'the active checklists of a store in the caller''s operations scope, its own and the tenant-wide ones, for one shift phase or all, with the current version''s item counts and today''s run (an open one first, else the latest) under the store''s business date';

revoke all on function app.store_business_date(uuid, timestamptz) from public, anon;
revoke all on function app.ops_photo_bucket(uuid, uuid) from public, anon, authenticated;
revoke all on function app.ops_photo_object(text) from public, anon, authenticated;
revoke all on function app.ensure_ops_photo_bucket(text) from public, anon, authenticated, service_role;
revoke all on function app.create_brand_photo_bucket() from public, anon, authenticated, service_role;
revoke all on function app.refuse_checklist_item_change() from public, anon, authenticated, service_role;
revoke all on function app.prepare_checklist_run() from public, anon, authenticated, service_role;
revoke all on function app.create_checklist_answers() from public, anon, authenticated, service_role;
revoke all on function app.guard_checklist_run() from public, anon, authenticated, service_role;
revoke all on function app.guard_checklist_answer() from public, anon, authenticated, service_role;
revoke all on function app.log_checklist_correction() from public, anon, authenticated, service_role;
revoke all on function app.ops_photo_readable(text, text) from public, anon;
revoke all on function app.ops_photo_writable(text, text) from public, anon;
revoke all on function app.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) from public, anon, service_role;
revoke all on function app.set_checklist_template_active(uuid, boolean) from public, anon, service_role;
revoke all on function app.set_ops_photo_retention_days(uuid, integer) from public, anon, service_role;
revoke all on function app.expired_ops_photos(timestamptz, integer) from public, anon, authenticated;
revoke all on function app.mark_removed_ops_photos(timestamptz) from public, anon, authenticated;
revoke all on function app.ops_photo_storage() from public, anon, authenticated;
revoke all on function public.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) from public, anon, service_role;
revoke all on function public.set_checklist_template_active(uuid, boolean) from public, anon, service_role;
revoke all on function public.set_ops_photo_retention_days(uuid, integer) from public, anon, service_role;
revoke all on function public.checklist_run_detail(uuid) from public, anon, service_role;
revoke all on function public.start_checklist_run(uuid, uuid) from public, anon, service_role;
revoke all on function public.save_checklist_answer(uuid, boolean, numeric, text) from public, anon, service_role;
revoke all on function public.finish_checklist_run(uuid) from public, anon, service_role;
revoke all on function public.due_checklists(uuid, text) from public, anon, service_role;

grant execute on function app.store_business_date(uuid, timestamptz) to authenticated, service_role;
grant execute on function app.ops_photo_readable(text, text) to authenticated;
grant execute on function app.ops_photo_writable(text, text) to authenticated;
grant execute on function app.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) to authenticated;
grant execute on function app.set_checklist_template_active(uuid, boolean) to authenticated;
grant execute on function app.set_ops_photo_retention_days(uuid, integer) to authenticated;
grant execute on function app.expired_ops_photos(timestamptz, integer) to service_role;
grant execute on function app.mark_removed_ops_photos(timestamptz) to service_role;
grant execute on function app.ops_photo_storage() to service_role;
grant execute on function public.save_checklist_template(uuid, uuid, text, text, jsonb, uuid) to authenticated;
grant execute on function public.set_checklist_template_active(uuid, boolean) to authenticated;
grant execute on function public.set_ops_photo_retention_days(uuid, integer) to authenticated;
grant execute on function public.checklist_run_detail(uuid) to authenticated;
grant execute on function public.start_checklist_run(uuid, uuid) to authenticated;
grant execute on function public.save_checklist_answer(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.finish_checklist_run(uuid) to authenticated;
grant execute on function public.due_checklists(uuid, text) to authenticated;
