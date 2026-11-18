begin;
select plan(132);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005101'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000005102'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000005101'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000005102'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000005101'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000005102'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000005103'::uuid as store_x3,
  'ffffffff-ffff-4fff-8fff-000000005104'::uuid as store_y1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005101'::uuid as brand_x1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005102'::uuid as brand_x2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000005103'::uuid as brand_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005101'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000005102'::uuid as owner_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005103'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005104'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005105'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005106'::uuid as staff_x1b,
  'eeeeeeee-eeee-4eee-8eee-000000005107'::uuid as staff_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005108'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000005109'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000005110'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000005111'::uuid as staff_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005112'::uuid as no_member;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'checklists-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[
  fx.owner_x, fx.owner_x1, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.staff_x1b, fx.staff_xall, fx.viewer_x, fx.publisher_x,
  fx.owner_y, fx.staff_y1, fx.no_member
]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'checklists-pgtap-x', 'Checklists pgTAP X' from fx
union all
select tenant_y, 'checklists-pgtap-y', 'Checklists pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'checklists-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'checklists-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select store_x1, tenant_x, account_x, 'checklists-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_x2, tenant_x, account_x, 'checklists-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh', 300 from fx
union all
select store_x3, tenant_x, account_x, 'checklists-x3', 'Synthetic store X3', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_y1, tenant_y, account_y, 'checklists-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh', 0 from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.owner_x1, 'owner', array[fx.store_x1]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_x1b, 'staff', array[fx.store_x1]),
    (fx.staff_xall, 'staff', null::uuid[]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', array[fx.store_x1])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_y, 'owner', null::uuid[]),
    (fx.staff_y1, 'staff', array[fx.store_y1])
) as m (user_id, role, store_ids);

insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_x1, tenant_x, 'brand-1', 'Synthetic brand X1', array[store_x1] from fx
union all
select brand_x2, tenant_x, 'brand-2', 'Synthetic brand X2', array[store_x2] from fx
union all
select brand_y1, tenant_y, 'brand-1', 'Synthetic brand Y1', array[store_y1] from fx;

create function pg_temp.claims(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.value_as(p_user uuid, p_query text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_query into v_value;
  return v_value;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create temp table tpl (label text primary key, id uuid);
create temp table runs (label text primary key, id uuid);

create function pg_temp.tpl(p_label text)
returns uuid
language sql
as $$
  select t.id from tpl t where t.label = p_label;
$$;

create function pg_temp.run(p_label text)
returns uuid
language sql
as $$
  select r.id from runs r where r.label = p_label;
$$;

create function pg_temp.answer(p_run text, p_position integer)
returns uuid
language sql
security definer
as $$
  select a.id
  from public.checklist_answers a
  join public.checklist_items i on i.id = a.item_id
  where a.run_id = pg_temp.run(p_run) and i.position = p_position;
$$;

create function pg_temp.photo(p_run text, p_name text)
returns text
language sql
security definer
as $$
  select r.tenant_id || '/' || r.store_id || '/run/' || r.id || '/' || p_name
  from public.checklist_runs r
  where r.id = pg_temp.run(p_run);
$$;

create function pg_temp.upload_as(p_user uuid, p_bucket text, p_name text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_user, format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (%L, %L, %L, %L)', p_bucket, p_name, p_user, '{"size": 2048, "mimetype": "image/jpeg"}'));
$$;

create function pg_temp.seen_as(p_user uuid, p_table text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute format('select count(*) from public.%I t where t.tenant_id in (select tenant_x from fx union all select tenant_y from fx)', p_table) into v_count;
  return v_count;
end;
$$;

create function pg_temp.photos_as(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select count(*) into v_count
  from storage.objects o
  where left(o.bucket_id, 4) = 'ops-'
    and (o.name like (select tenant_x from fx)::text || '/%' or o.name like (select tenant_y from fx)::text || '/%');
  return v_count;
end;
$$;

grant select on fx, tpl, runs to authenticated, anon;

insert into tpl
select 'x1_open', (pg_temp.value_as(fx.manager_x1, format(
  $q$ select public.save_checklist_template(%L, %L, 'opening', 'Mở ca', '[{"label": "Bật máy POS"}, {"label": "Ảnh quầy sạch", "requires_photo": true}, {"label": "Nhiệt độ tủ mát", "number_unit": "°C"}]')::text $q$,
  fx.tenant_x, fx.store_x1))::jsonb ->> 'template_id')::uuid
from fx
union all
select 'all_close', (pg_temp.value_as(fx.owner_x, format(
  $q$ select public.save_checklist_template(%L, null, 'closing', 'Đóng ca', '[{"label": "Kết ca trên POS"}]')::text $q$,
  fx.tenant_x))::jsonb ->> 'template_id')::uuid
from fx
union all
select 'x2_mid', (pg_temp.value_as(fx.manager_xall, format(
  $q$ select public.save_checklist_template(%L, %L, 'midshift', 'Giữa ca', '[{"label": "Lau bàn", "requires_photo": true}]')::text $q$,
  fx.tenant_x, fx.store_x2))::jsonb ->> 'template_id')::uuid
from fx
union all
select 'x3_open', (pg_temp.value_as(fx.owner_x, format(
  $q$ select public.save_checklist_template(%L, %L, 'opening', 'Mở ca X3', '[{"label": "Ảnh cửa", "requires_photo": true}]')::text $q$,
  fx.tenant_x, fx.store_x3))::jsonb ->> 'template_id')::uuid
from fx
union all
select 'y1_open', (pg_temp.value_as(fx.owner_y, format(
  $q$ select public.save_checklist_template(%L, %L, 'opening', 'Mở ca Y', '[{"label": "Ảnh cửa", "requires_photo": true}]')::text $q$,
  fx.tenant_y, fx.store_y1))::jsonb ->> 'template_id')::uuid
from fx;

insert into runs
select 'x1_a', (pg_temp.value_as(fx.staff_x1, format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), fx.store_x1))::jsonb ->> 'run_id')::uuid from fx
union all
select 'x1_b', (pg_temp.value_as(fx.staff_x1b, format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('all_close'), fx.store_x1))::jsonb ->> 'run_id')::uuid from fx
union all
select 'x2', (pg_temp.value_as(fx.staff_xall, format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x2_mid'), fx.store_x2))::jsonb ->> 'run_id')::uuid from fx
union all
select 'x3', (pg_temp.value_as(fx.staff_xall, format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x3_open'), fx.store_x3))::jsonb ->> 'run_id')::uuid from fx
union all
select 'y1', (pg_temp.value_as(fx.staff_y1, format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('y1_open'), fx.store_y1))::jsonb ->> 'run_id')::uuid from fx;

select is(
  (select array_agg(c.relname::text || ':' || c.relrowsecurity order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('checklist_templates', 'checklist_items', 'checklist_runs', 'checklist_answers', 'checklist_corrections')),
  array['checklist_answers:true', 'checklist_corrections:true', 'checklist_items:true', 'checklist_runs:true', 'checklist_templates:true'],
  'the five checklist tables exist with RLS enabled'
);
select is(
  (select count(*)::integer from tpl where id is not null) || ':' || (select count(*)::integer from runs where id is not null),
  '5:5',
  'the fixture saved five checklists and started five runs through the RPCs'
);
select is(
  (select array_agg(b.id || ':' || b.public || ':' || b.file_size_limit || ':' || array_to_string(b.allowed_mime_types, ',') order by b.id) from storage.buckets b where b.id in ('ops-brand-1', 'ops-brand-2')),
  array['ops-brand-1:false:1048576:image/jpeg', 'ops-brand-2:false:1048576:image/jpeg'],
  'every brand has a private bucket ops-<brand key> of at most 1 MiB per object, JPEG only'
);
update storage.buckets set public = true, file_size_limit = 52428800, allowed_mime_types = null where id = 'ops-brand-2';
update public.brands set display_name = 'Synthetic brand X2 renamed', brand_key = 'brand-2' where id = (select brand_x2 from fx);
select is(
  (select b.public || ':' || b.file_size_limit || ':' || array_to_string(b.allowed_mime_types, ',') from storage.buckets b where b.id = 'ops-brand-2'),
  'false:1048576:image/jpeg',
  'writing a brand''s key resets its bucket to private, 1 MiB and JPEG'
);
select throws_ok($q$ select app.ensure_ops_photo_bucket('public-photos') $q$, '22023', null, 'only ops-brand-<n> buckets are created');
select is(
  (select array_agg(p.policyname::text || ':' || p.cmd || ':' || array_to_string(p.roles, ',') order by p.policyname) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'ops_photos_%'),
  array['ops_photos_insert_own:INSERT:authenticated', 'ops_photos_select_in_scope:SELECT:authenticated'],
  'storage.objects carries one read and one upload policy for operations photos, for authenticated only: no update, no delete'
);
select is(
  (select count(*)::integer from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('UPDATE', 'DELETE', 'ALL') and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%ops-%'),
  0,
  'no policy lets a member replace or delete an operations photo'
);
select is(
  app.ops_photo_bucket((select tenant_x from fx), (select store_x1 from fx)) || ',' || app.ops_photo_bucket((select tenant_x from fx), (select store_x2 from fx)) || ','
    || coalesce(app.ops_photo_bucket((select tenant_x from fx), (select store_x3 from fx)), '-') || ',' || app.ops_photo_bucket((select tenant_y from fx), (select store_y1 from fx)) || ','
    || coalesce(app.ops_photo_bucket((select tenant_x from fx), (select store_y1 from fx)), '-'),
  'ops-brand-1,ops-brand-2,-,ops-brand-1,-',
  'a store''s bucket is its brand''s; a store without a brand has none; brand keys are per tenant, so two tenants share ops-brand-1 and their paths keep them apart'
);
select is(
  (select count(*)::integer from app.ops_photo_object('dddddddd-dddd-4ddd-8ddd-000000005101/ffffffff-ffff-4fff-8fff-000000005101/run/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/proof-1.jpg'))
    || ':' || (select count(*)::integer from app.ops_photo_object('dddddddd-dddd-4ddd-8ddd-000000005101/ffffffff-ffff-4fff-8fff-000000005101/run/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/proof.png'))
    || ':' || (select count(*)::integer from app.ops_photo_object('dddddddd-dddd-4ddd-8ddd-000000005101/ffffffff-ffff-4fff-8fff-000000005101/run/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/../x.jpg'))
    || ':' || (select count(*)::integer from app.ops_photo_object('DDDDDDDD-DDDD-4DDD-8DDD-000000005101/ffffffff-ffff-4fff-8fff-000000005101/run/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg'))
    || ':' || (select count(*)::integer from app.ops_photo_object('dddddddd-dddd-4ddd-8ddd-000000005101/ffffffff-ffff-4fff-8fff-000000005101/shift/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg')),
  '1:0:0:0:0',
  'a photo path is <tenant>/<store>/run|incident/<id>/<name>.jpg in lower case; another extension, a dotted segment, upper case or another kind is not one'
);
select is(
  (select array_agg(i.position || ':' || i.label || ':' || i.requires_photo || ':' || coalesce(i.number_unit, '-') || ':' || i.template_version order by i.position)
   from public.checklist_items i where i.template_id = pg_temp.tpl('x1_open')),
  array['1:Bật máy POS:false:-:1', '2:Ảnh quầy sạch:true:-:1', '3:Nhiệt độ tủ mát:false:°C:1'],
  'a saved checklist is rows: its items in order with the photo and number options, version 1'
);
select is(
  (select t.version || ':' || t.active || ':' || coalesce(t.store_id::text, 'every store') || ':' || (t.created_by = fx.manager_x1) || ':' || (t.updated_by = fx.manager_x1)
   from public.checklist_templates t, fx where t.id = pg_temp.tpl('x1_open')),
  '1:true:ffffffff-ffff-4fff-8fff-000000005101:true:true',
  'the template records its version, state, store and who wrote it'
);
select is(
  (select r.template_version || ':' || r.title || ':' || r.shift_phase || ':' || r.status || ':' || coalesce(r.photo_bucket, '-') || ':' || (r.created_by = fx.staff_x1)
     || ':' || (r.business_date = app.store_business_date(r.store_id, now())) || ':' || (r.started_at = now()) || ':' || (r.finished_at is null)
   from public.checklist_runs r, fx where r.id = pg_temp.run('x1_a')),
  '1:Mở ca:opening:open:ops-brand-1:true:true:true:true',
  'a run records the version, title and phase it started with, the actor, the store''s business date, the bucket and the start'
);
select is(
  (select array_agg(i.position || ':' || a.done || ':' || (a.created_by = fx.staff_x1) || ':' || (a.answered_at is null) order by i.position)
   from public.checklist_answers a join public.checklist_items i on i.id = a.item_id, fx where a.run_id = pg_temp.run('x1_a')),
  array['1:false:true:true', '2:false:true:true', '3:false:true:true'],
  'a run starts with one open answer per item, owned by its actor'
);
select is(
  (select coalesce(r.photo_bucket, '-') from public.checklist_runs r where r.id = pg_temp.run('x3')),
  '-',
  'a run at a store without a brand has no photo bucket'
);
select is(
  app.store_business_date((select store_x2 from fx), '2026-11-18 21:59:00+00') || ',' || app.store_business_date((select store_x2 from fx), '2026-11-18 22:00:00+00')
    || ',' || app.store_business_date((select store_x1 from fx), '2026-11-18 16:59:00+00') || ',' || app.store_business_date((select store_x1 from fx), '2026-11-18 17:00:00+00'),
  '2026-11-18,2026-11-19,2026-11-18,2026-11-19',
  'the business date follows each store''s time zone and day start: 04:59 local belongs to the previous day where the day starts at 05:00, 00:00 local to the new day where it starts at midnight'
);
select is(
  (select r.business_date = ((now() at time zone 'Asia/Ho_Chi_Minh') - interval '300 minutes')::date from public.checklist_runs r where r.id = pg_temp.run('x2')),
  true,
  'a run at a store whose day starts at 05:00 takes that store''s business date'
);

set local role authenticated;

select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.start_checklist_run(%L, %L) ->> %L', pg_temp.tpl('x1_open'), (select store_x1 from fx), 'run_id')),
  pg_temp.run('x1_a')::text,
  'starting a checklist the actor already has open today returns that run'
);
select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x1 from fx))),
  'error:23505',
  'another member cannot open the same checklist at the same store while it is open today'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x2_mid'), (select store_x2 from fx))),
  'error:42501',
  'staff cannot start a checklist at a store outside their scope'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x2 from fx))),
  'error:42501',
  'a store''s own checklist cannot be run at another store'
);
select is(
  array[
    pg_temp.value_as((select staff_y1 from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x1 from fx))),
    pg_temp.value_as((select viewer_x from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x1 from fx))),
    pg_temp.value_as((select publisher_x from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x1 from fx))),
    pg_temp.value_as((select no_member from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('x1_open'), (select store_x1 from fx)))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'another tenant''s staff, a viewer, the publisher and a login without membership start nothing'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select (public.start_checklist_run(%L, %L) ->> %L) is not null', pg_temp.tpl('all_close'), (select store_x1 from fx), 'run_id')),
  'error:23505',
  'a tenant-wide checklist is open at a store at most once at a time'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select public.start_checklist_run(%L, %L) ->> %L', pg_temp.tpl('all_close'), (select store_x2 from fx), 'template_version')),
  '1',
  'a tenant-wide checklist runs at every store of the tenant'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.checklist_runs (tenant_id, store_id, template_id, template_version) values (%L, %L, %L, 7)', (select tenant_x from fx), (select store_x1 from fx), pg_temp.tpl('all_close'))),
  '42501',
  'a client cannot write the version, title, date or status of a run'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.checklist_runs (tenant_id, store_id, template_id) values (%L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), pg_temp.tpl('x2_mid'))),
  '22023',
  'a direct insert of a run of another store''s checklist is refused'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.checklist_runs (tenant_id, store_id, template_id) values (%L, %L, %L)', (select tenant_x from fx), (select store_x2 from fx), pg_temp.tpl('all_close'))),
  '42501',
  'a direct insert at a store outside the caller''s scope is refused by the policy'
);

select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'Staff list', '[{"label": "x"}]')),
  'error:42501',
  'staff cannot create a checklist'
);
select is(
  array[
    pg_temp.value_as((select viewer_x from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'V', '[{"label": "x"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x2 from fx), 'opening', 'M', '[{"label": "x"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, null, %L, %L, %L)::text', (select tenant_x from fx), 'opening', 'M', '[{"label": "x"}]')),
    pg_temp.value_as((select owner_x1 from fx), format('select public.save_checklist_template(%L, null, %L, %L, %L)::text', (select tenant_x from fx), 'opening', 'M', '[{"label": "x"}]')),
    pg_temp.value_as((select owner_y from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'Y', '[{"label": "x"}]')),
    pg_temp.value_as((select owner_y from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_y from fx), (select store_x1 from fx), 'opening', 'Y', '[{"label": "x"}]'))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'a viewer, a manager outside the store, a store-limited member for every store and another tenant''s owner edit no checklist'
);
select is(
  array[
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'lunch', 'T', '[{"label": "x"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', '  ', '[{"label": "x"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '[]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', (select jsonb_agg(jsonb_build_object('label', 'item ' || g)) from generate_series(1, 61) g))),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '[{"label": "x", "points": 3}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '[{"label": ""}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '[{"label": "x", "requires_photo": "yes"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '[{"label": "x", "number_unit": "a unit far too long"}]')),
    pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'T', '{"label": "x"}'))
  ],
  array['error:22023', 'error:22023', 'error:22023', 'error:22023', 'error:22023', 'error:22023', 'error:22023', 'error:22023', 'error:22023'],
  'an unknown phase, an empty title, no item or more than 60, an unknown item field, an empty label, a non-boolean photo flag, a long unit or a non-array is refused'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('insert into public.checklist_templates (tenant_id, store_id, shift_phase, title) values (%L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'Direct')),
  '42501',
  'no client writes checklist_templates directly, a manager included'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('update public.checklist_items set label = %L where template_id = %L', 'changed', pg_temp.tpl('x1_open'))),
  '42501',
  'no client writes checklist_items directly'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x2 from fx), 'opening', 'Moved', '[{"label": "x"}]', pg_temp.tpl('x1_open'))),
  'error:42501',
  'a manager cannot save a template under a store outside their scope'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x2 from fx), 'opening', 'Moved', '[{"label": "x"}]', pg_temp.tpl('x1_open'))),
  'error:22023',
  'a template keeps its store and phase: a save naming another store is refused'
);
select is(
  pg_temp.value_as((select owner_y from fx), format('select public.save_checklist_template(%L, %L, %L, %L, %L, %L)::text', (select tenant_y from fx), (select store_y1 from fx), 'opening', 'Taken', '[{"label": "x"}]', pg_temp.tpl('x1_open'))),
  'error:22023',
  'another tenant''s template id is refused the same way'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format(
    'select public.save_checklist_template(%L, %L, %L, %L, %L, %L)::text', (select tenant_x from fx), (select store_x1 from fx), 'opening', 'Mở ca (mới)',
    '[{"label": "Bật máy POS và máy in"}, {"label": "Ảnh quầy sạch", "requires_photo": true}, {"label": "Nhiệt độ tủ mát", "number_unit": "°C"}, {"label": "Kiểm tra tủ đông", "number_unit": "°C"}]',
    pg_temp.tpl('x1_open'))),
  '{"active": true, "version": 2, "template_id": "' || pg_temp.tpl('x1_open') || '"}',
  'saving a changed checklist creates version 2 of the same template'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.checklist_run_detail(%L) -> %L -> 0 ->> %L', pg_temp.run('x1_a'), 'items', 'label')),
  'Bật máy POS',
  'the open run keeps the wording of version 1'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.checklist_run_detail(%L) ->> %L', pg_temp.run('x1_a'), 'title') ) || ':'
    || pg_temp.value_as((select staff_x1 from fx), format('select public.checklist_run_detail(%L) ->> %L', pg_temp.run('x1_a'), 'items_total') ),
  'Mở ca:3',
  'and its title and its three items'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select array_agg(d.template_version || %L || d.title || %L || d.items || %L || d.photo_items || %L || coalesce(d.run_status, %L) order by d.title)::text from public.due_checklists(%L, %L) d', ':', ':', ':', ':', '-', (select store_x1 from fx), 'opening')),
  '{"2:Mở ca (mới):4:1:open"}',
  'due_checklists shows the store''s opening checklist at version 2 with today''s open run'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select array_agg(d.title || %L || d.every_store order by d.every_store)::text from public.due_checklists(%L) d', ':', (select store_x1 from fx))),
  '{"Mở ca (mới):false","Đóng ca:true"}',
  'without a phase it lists the store''s own and the tenant-wide checklists'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select count(*)::text from public.due_checklists(%L)', (select store_x2 from fx))),
    pg_temp.value_as((select viewer_x from fx), format('select count(*)::text from public.due_checklists(%L)', (select store_x1 from fx))),
    pg_temp.value_as((select staff_y1 from fx), format('select count(*)::text from public.due_checklists(%L)', (select store_x1 from fx)))
  ],
  array['0', '0', '0'],
  'due_checklists gives nothing for a store outside the caller''s operations scope'
);

select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true) ->> %L', pg_temp.answer('x1_a', 1), 'done')),
  'true',
  'the actor ticks an item that needs nothing more'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select a.answered_by = %L and a.answered_at = now() from public.checklist_answers a where a.id = %L', (select staff_x1 from fx), pg_temp.answer('x1_a', 1))),
  'true',
  'the answer records its actor and time'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true)::text', pg_temp.answer('x1_a', 2))),
  'error:23514',
  'an item that needs a photo cannot be completed without one'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true)::text', pg_temp.answer('x1_a', 3))),
    pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, false, 4.5)::text', pg_temp.answer('x1_a', 1))),
    pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true, 3.5) ->> %L', pg_temp.answer('x1_a', 3), 'number_value'))
  ],
  array['error:23514', 'error:23514', '3.500'],
  'an item with a unit needs its number, an item without one takes none, and the number is stored'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('update public.checklist_answers set photo_removed_at = now() where id = %L', pg_temp.answer('x1_a', 1))),
  '42501',
  'no member sets the photo-removed marker'
);
select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.save_checklist_answer(%L, true)::text', pg_temp.answer('x1_a', 1))),
  'error:42501',
  'another staff member of the store cannot answer the actor''s run'
);
select is(
  pg_temp.value_as((select staff_y1 from fx), format('select public.save_checklist_answer(%L, true)::text', pg_temp.answer('x1_a', 1))),
  'error:42501',
  'nor can another tenant''s staff'
);

select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('x1_a', 'counter-1.jpg')), 'rows:1', 'the actor uploads into their own open run''s path in the store''s bucket');
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-2', pg_temp.photo('x1_a', 'counter-2.jpg')), '42501', 'but not into another brand''s bucket');
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-2', pg_temp.photo('x2', 'table-1.jpg')), '42501', 'nor into another store''s run');
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('x1_b', 'close-1.jpg')), '42501', 'nor into another staff member''s run of the same store');
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('y1', 'door-1.jpg')), '42501', 'nor into another tenant''s run in the shared bucket');
select is(
  array[
    pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('x1_a', 'counter.png')),
    pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', replace(pg_temp.photo('x1_a', 'x.jpg'), '/run/', '/runs/')),
    pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', (select tenant_x from fx) || '/' || (select store_x1 from fx) || '/counter.jpg')
  ],
  array['42501', '42501', '42501'],
  'a name outside the photo path pattern is refused'
);
select is(pg_temp.upload_as((select manager_x1 from fx), 'ops-brand-1', pg_temp.photo('x1_a', 'manager-1.jpg')), '42501', 'a manager cannot upload into a staff member''s run');
select is(pg_temp.upload_as((select staff_xall from fx), 'ops-brand-2', pg_temp.photo('x2', 'table-1.jpg')), 'rows:1', 'staff of every store upload into their run at the second store''s bucket');
select is(pg_temp.upload_as((select staff_y1 from fx), 'ops-brand-1', pg_temp.photo('y1', 'door-1.jpg')), 'rows:1', 'the other tenant''s staff upload into their own run in the shared bucket');
select is(pg_temp.upload_as((select staff_x1b from fx), 'ops-brand-1', pg_temp.photo('x1_b', 'close-1.jpg')), 'rows:1', 'the second staff member uploads into their own run');

select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true, null, %L)::text', pg_temp.answer('x1_a', 2), pg_temp.photo('x1_a', 'missing.jpg'))),
  'error:22023',
  'an answer cannot name a photo that was never uploaded'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true, null, %L)::text', pg_temp.answer('x1_a', 2), pg_temp.photo('x1_b', 'close-1.jpg'))),
  'error:22023',
  'nor another run''s photo'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, true, null, %L) ->> %L', pg_temp.answer('x1_a', 2), pg_temp.photo('x1_a', 'counter-1.jpg'), 'done')),
  'true',
  'with its photo uploaded the item is completed'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select public.save_checklist_answer(%L, false, null, %L)::text', pg_temp.answer('x3', 1), (select tenant_x from fx) || '/' || (select store_x3 from fx) || '/run/' || pg_temp.run('x3') || '/a.jpg')),
  'error:22023',
  'at a store without a brand no photo can be attached, so its photo items stay open'
);

select is(pg_temp.photos_as((select staff_x1 from fx)), 1, 'the actor reads their own photo');
select is(pg_temp.photos_as((select staff_x1b from fx)), 1, 'another staff member reads only their own photo, never the actor''s');
select is(pg_temp.photos_as((select manager_x1 from fx)), 2, 'a manager of the store reads the store''s photos');
select is(pg_temp.photos_as((select owner_x1 from fx)), 2, 'so does a store-limited owner of it');
select is(pg_temp.photos_as((select manager_xall from fx)), 3, 'a manager of every store reads every store''s photos of the tenant');
select is(pg_temp.photos_as((select staff_xall from fx)), 1, 'staff of every store read only their own photos');
select is(
  array[pg_temp.photos_as((select viewer_x from fx)), pg_temp.photos_as((select publisher_x from fx)), pg_temp.photos_as((select no_member from fx))],
  array[0, 0, 0],
  'a viewer, the publisher and a login without membership read no photo'
);
select is(pg_temp.photos_as((select owner_y from fx)), 1, 'the other tenant''s owner reads only their tenant''s photo in the shared bucket');
select is(pg_temp.photos_as((select staff_y1 from fx)), 1, 'and their staff only their own');
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('update storage.objects set name = %L where name = %L', pg_temp.photo('x1_a', 'renamed.jpg'), pg_temp.photo('x1_a', 'counter-1.jpg'))),
  'rows:0',
  'nobody updates an operations photo, the uploader included'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('delete from storage.objects where name = %L', pg_temp.photo('x1_a', 'counter-1.jpg'))),
  '42501',
  'and no member deletes one'
);

select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.finish_checklist_run(%L)::text', pg_temp.run('x1_a'))),
  'error:42501',
  'another staff member cannot finish the actor''s run'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.finish_checklist_run(%L)::text', pg_temp.run('x1_a'))),
  'error:42501',
  'nor can a manager: only the actor finishes a run'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select (d ->> %L) || %L || (d ->> %L) || %L || (d ->> %L) || %L || ((d ->> %L)::timestamptz = now()) from public.finish_checklist_run(%L) d', 'status', ':', 'items_done', '/', 'items_total', ':', 'finished_at', pg_temp.run('x1_a'))),
  'finished:3/3:true',
  'the actor finishes the run: the finish time is recorded'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.finish_checklist_run(%L) ->> %L', pg_temp.run('x1_a'), 'status')),
  'finished',
  'finishing it again returns it unchanged'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.save_checklist_answer(%L, false)::text', pg_temp.answer('x1_a', 1))),
  'error:55000',
  'a finished run is read-only for staff'
);
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('x1_a', 'late.jpg')), '42501', 'and takes no more photos');
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('update public.checklist_runs set status = %L where id = %L', 'open', pg_temp.run('x1_a'))),
  '55000',
  'a finished run never reopens'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select count(*)::text from public.checklist_corrections where run_id = %L', pg_temp.run('x1_a'))),
  '0',
  'answering while the run was open logged no correction'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_answer(%L, true, 4.0) ->> %L', pg_temp.answer('x1_a', 3), 'number_value')),
  '4.000',
  'a manager of the store corrects an answer after the run finished'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select c.old_values::text || %L || c.new_values::text || %L || (c.created_by = %L) || %L || (c.created_at = now()) from public.checklist_corrections c where c.run_id = %L', ' > ', ':', (select manager_x1 from fx), ':', pg_temp.run('x1_a'))),
  '{"done": true, "photo_path": null, "number_value": 3.500} > {"done": true, "photo_path": null, "number_value": 4.000}:true:true',
  'the correction is logged with the values before and after, the corrector and the time, and staff of the store read it'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select (a.answered_by = %L)::text from public.checklist_answers a where a.id = %L', (select manager_x1 from fx), pg_temp.answer('x1_a', 3))),
  'true',
  'the corrected answer names the manager as its last actor'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select public.save_checklist_answer(%L, false) ->> %L', pg_temp.answer('x2', 1), 'done')),
  'false',
  'a manager may also change an answer of an open run, which is not a correction'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select count(*)::text from public.checklist_corrections where run_id = %L', pg_temp.run('x2'))),
  '0',
  'so nothing is logged for it'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.save_checklist_answer(%L, true, 4.0)::text', pg_temp.answer('x2', 1))),
  'error:42501',
  'a manager of another store corrects nothing there'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.start_checklist_run(%L, %L) ->> %L', pg_temp.tpl('x1_open'), (select store_x1 from fx), 'template_version')),
  '2',
  'the next run at the store reads version 2 without any redeploy'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select string_agg(i ->> %L, %L order by (i ->> %L)::integer) from jsonb_array_elements(public.checklist_run_detail((select r.id from public.checklist_runs r where r.template_id = %L and r.status = %L and r.store_id = %L)) -> %L) i', 'label', '|', 'position', pg_temp.tpl('x1_open'), 'open', (select store_x1 from fx), 'items')),
  'Bật máy POS và máy in|Ảnh quầy sạch|Nhiệt độ tủ mát|Kiểm tra tủ đông',
  'with the changed and added items'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select string_agg(i ->> %L, %L order by (i ->> %L)::integer) from jsonb_array_elements(public.checklist_run_detail(%L) -> %L) i', 'label', '|', 'position', pg_temp.run('x1_a'), 'items')),
  'Bật máy POS|Ảnh quầy sạch|Nhiệt độ tủ mát',
  'while the finished run still reads version 1'
);

select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.set_checklist_template_active(%L, false)::text', pg_temp.tpl('all_close'))),
  'error:42501',
  'staff cannot retire a checklist'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.set_checklist_template_active(%L, false)::text', pg_temp.tpl('all_close'))),
  'error:42501',
  'a store-limited manager cannot retire a tenant-wide checklist'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select public.set_checklist_template_active(%L, false)::text', pg_temp.tpl('all_close'))),
  'false',
  'a manager of every store retires it'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select public.start_checklist_run(%L, %L)::text', pg_temp.tpl('all_close'), (select store_x3 from fx))),
  'error:55000',
  'a retired checklist starts no run'
);
select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.finish_checklist_run(%L) ->> %L', pg_temp.run('x1_b'), 'status')),
  'finished',
  'a run already open still finishes'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select count(*)::text from public.due_checklists(%L, %L)', (select store_x1 from fx), 'closing')),
  '0',
  'and the retired checklist is no longer due'
);
select is(
  (select t.version from public.checklist_templates t where t.id = pg_temp.tpl('all_close')),
  1,
  'retiring is not a new version'
);

select is(pg_temp.seen_as((select owner_x from fx), 'checklist_runs'), 6, 'runs: an owner of every store reads every run of the tenant');
select is(pg_temp.seen_as((select owner_x1 from fx), 'checklist_runs'), 3, 'a store-limited owner reads the runs of their store');
select is(pg_temp.seen_as((select manager_x1 from fx), 'checklist_runs'), 3, 'a manager of one store reads that store''s runs');
select is(pg_temp.seen_as((select staff_x1 from fx), 'checklist_runs'), 3, 'staff read the runs of their store, others'' included');
select is(pg_temp.seen_as((select staff_xall from fx), 'checklist_runs'), 6, 'staff of every store read every store''s runs');
select is(
  array[pg_temp.seen_as((select viewer_x from fx), 'checklist_runs'), pg_temp.seen_as((select publisher_x from fx), 'checklist_runs'), pg_temp.seen_as((select no_member from fx), 'checklist_runs')],
  array[0, 0, 0],
  'a viewer, the publisher and a login without membership read no run'
);
select is(
  array[pg_temp.seen_as((select owner_y from fx), 'checklist_runs'), pg_temp.seen_as((select staff_y1 from fx), 'checklist_runs')],
  array[1, 1],
  'no read crosses tenants'
);
select is(
  array[pg_temp.seen_as((select staff_x1 from fx), 'checklist_answers'), pg_temp.seen_as((select manager_xall from fx), 'checklist_answers'), pg_temp.seen_as((select viewer_x from fx), 'checklist_answers'), pg_temp.seen_as((select staff_y1 from fx), 'checklist_answers')],
  array[8, 11, 0, 1],
  'answers follow the same scope'
);
select is(
  array[pg_temp.seen_as((select staff_x1 from fx), 'checklist_templates'), pg_temp.seen_as((select staff_x1 from fx), 'checklist_items'), pg_temp.seen_as((select manager_xall from fx), 'checklist_templates'), pg_temp.seen_as((select viewer_x from fx), 'checklist_templates'), pg_temp.seen_as((select staff_y1 from fx), 'checklist_templates')],
  array[2, 8, 4, 0, 1],
  'templates and items: staff read their stores'' and the tenant-wide ones, all versions; viewers none; no other tenant''s'
);
select is(
  array[pg_temp.seen_as((select manager_x1 from fx), 'checklist_corrections'), pg_temp.seen_as((select staff_xall from fx), 'checklist_corrections'), pg_temp.seen_as((select viewer_x from fx), 'checklist_corrections'), pg_temp.seen_as((select owner_y from fx), 'checklist_corrections')],
  array[1, 1, 0, 0],
  'the correction log follows the store scope'
);

select is(
  pg_temp.value_as((select owner_x1 from fx), format('select public.set_ops_photo_retention_days(%L, 30)::text', (select tenant_x from fx))),
  'error:42501',
  'a store-limited owner cannot set the photo retention'
);
select is(
  array[
    pg_temp.value_as((select manager_xall from fx), format('select public.set_ops_photo_retention_days(%L, 30)::text', (select tenant_x from fx))),
    pg_temp.value_as((select staff_xall from fx), format('select public.set_ops_photo_retention_days(%L, 30)::text', (select tenant_x from fx))),
    pg_temp.value_as((select owner_y from fx), format('select public.set_ops_photo_retention_days(%L, 30)::text', (select tenant_x from fx)))
  ],
  array['error:42501', 'error:42501', 'error:42501'],
  'nor can a manager, staff or another tenant''s owner'
);
select is(
  array[
    pg_temp.value_as((select owner_x from fx), format('select public.set_ops_photo_retention_days(%L, 6)::text', (select tenant_x from fx))),
    pg_temp.value_as((select owner_x from fx), format('select public.set_ops_photo_retention_days(%L, null)::text', (select tenant_x from fx)))
  ],
  array['error:22023', 'error:22023'],
  'the retention is 7 to 730 days'
);
select is(
  pg_temp.value_as((select owner_x from fx), format('select public.set_ops_photo_retention_days(%L, 30)::text', (select tenant_x from fx))),
  '30',
  'an owner of every store sets 30 days'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select app.expired_ops_photos()::text')),
  'error:42501',
  'members cannot list expired photos'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select app.mark_removed_ops_photos()::text')),
  'error:42501',
  'nor run the marking'
);

reset role;

select is(
  (select array_agg(t.ops_photo_retention_days order by t.slug) from public.tenants t, fx where t.id in (fx.tenant_x, fx.tenant_y)),
  array[30, 90]::smallint[],
  'the tenant keeps 30 days, the other the default of 90'
);
update storage.objects o
set created_at = now() - interval '40 days'
where o.name in (pg_temp.photo('x1_a', 'counter-1.jpg'), pg_temp.photo('y1', 'door-1.jpg'));
update storage.objects o
set created_at = now() - interval '10 days'
where o.name = pg_temp.photo('x2', 'table-1.jpg');
select is(
  (select array_agg(e.bucket_id || ':' || (e.name = pg_temp.photo('x1_a', 'counter-1.jpg'))) from app.expired_ops_photos() e where e.name like '%' || (select tenant_x from fx) || '%' or e.name like '%' || (select tenant_y from fx) || '%'),
  array['ops-brand-1:true'],
  'a 40-day-old photo is past a 30-day retention; one of 10 days and the other tenant''s 40-day-old one under 90 days are kept'
);
select is(
  (select count(*)::integer from app.expired_ops_photos(now() + interval '81 days') e where e.name like (select tenant_x from fx) || '/%' or e.name like (select tenant_y from fx) || '/%'),
  4,
  'later every photo of both tenants expires'
);
select is(app.mark_removed_ops_photos(), 0, 'nothing is marked while the objects exist');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects o using app.expired_ops_photos() e where o.bucket_id = e.bucket_id and o.name = e.name and (o.name like (select tenant_x from fx) || '/%' or o.name like (select tenant_y from fx) || '/%');
select set_config('storage.allow_delete_query', 'false', true);
select set_config('request.jwt.claims', '', true);
select is(app.mark_removed_ops_photos('2026-11-18 03:00:00+00'), 1, 'after the Storage API removed it the housekeeping marks one answer');
select is(
  (select a.done || ':' || (a.photo_path = pg_temp.photo('x1_a', 'counter-1.jpg')) || ':' || (a.photo_removed_at = '2026-11-18 03:00:00+00') from public.checklist_answers a where a.id = pg_temp.answer('x1_a', 2)),
  'true:true:true',
  'the answer stays done and keeps its path with the photo-removed marker'
);
select is(
  (select (public.checklist_run_detail(pg_temp.run('x1_a')) -> 'items' -> 1 ->> 'photo_removed')),
  'true',
  'the run detail shows the photo as removed'
);
select is(app.mark_removed_ops_photos(), 0, 'a second pass marks nothing more');
select is(
  (select array_agg(s.bucket_id || ':' || (s.objects > 0) order by s.bucket_id) from app.ops_photo_storage() s where s.bucket_id in ('ops-brand-1', 'ops-brand-2')),
  array['ops-brand-1:true', 'ops-brand-2:true'],
  'ops_photo_storage reports objects and bytes per bucket'
);
select ok(
  has_function_privilege('service_role', 'app.expired_ops_photos(timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'app.mark_removed_ops_photos(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'app.ops_photo_storage()', 'execute')
  and not has_function_privilege('authenticated', 'app.ops_photo_storage()', 'execute'),
  'the housekeeping functions belong to the service role'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'app')
     and p.proname in ('save_checklist_template', 'set_checklist_template_active', 'set_ops_photo_retention_days', 'checklist_run_detail', 'start_checklist_run',
                       'save_checklist_answer', 'finish_checklist_run', 'due_checklists', 'ops_photo_readable', 'ops_photo_writable', 'expired_ops_photos',
                       'mark_removed_ops_photos', 'ops_photo_storage', 'ops_photo_bucket', 'ops_photo_object', 'ensure_ops_photo_bucket', 'store_business_date')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
  0,
  'none of the checklist functions is executable by public or anon'
);
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('checklist_run_detail', 'start_checklist_run', 'save_checklist_answer', 'finish_checklist_run', 'due_checklists',
                                               'save_checklist_template', 'set_checklist_template_active', 'set_ops_photo_retention_days')),
  array['checklist_run_detail:false', 'due_checklists:false', 'finish_checklist_run:false', 'save_checklist_answer:false', 'save_checklist_template:false',
        'set_checklist_template_active:false', 'set_ops_photo_retention_days:false', 'start_checklist_run:false'],
  'every RPC in public runs as the caller, so RLS applies'
);
select is(
  (select string_agg(c.table_name || '.' || c.privilege_type || '(' || c.cols || ')', ', ' order by c.table_name, c.privilege_type)
   from (
     select table_name::text, privilege_type::text, string_agg(column_name::text, ',' order by column_name) as cols
     from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public' and table_name in ('checklist_runs', 'checklist_answers') and privilege_type in ('INSERT', 'UPDATE')
     group by table_name, privilege_type
   ) c),
  'checklist_answers.UPDATE(done,number_value,photo_path), checklist_runs.INSERT(store_id,template_id,tenant_id), checklist_runs.UPDATE(status)',
  'a client inserts a run by store and template, finishes it through its status and writes only done, number and photo of an answer'
);
select throws_ok(
  $q$ update public.checklist_items set label = 'changed by the database owner' where template_id = pg_temp.tpl('x1_open') and template_version = 1 and position = 1 $q$,
  '55000', null, 'a written item never changes, even for the database owner: a change is a new version'
);

select lives_ok(
  format($q$ delete from public.stores where id = %L $q$, (select store_x1 from fx)),
  'a store with checklists, runs, answers and corrections can still be deleted'
);
select is(
  (select count(*)::integer from public.checklist_runs r, fx where r.store_id = fx.store_x1)
    + (select count(*)::integer from public.checklist_templates t, fx where t.store_id = fx.store_x1)
    + (select count(*)::integer from public.checklist_corrections c, fx where c.store_id = fx.store_x1),
  0,
  'and its operations rows go with it, while the tenant-wide checklist stays'
);

set local role anon;
select throws_ok('select count(*) from public.checklist_runs', '42501', null, 'anon reads no checklist table');
select throws_ok($q$ select public.start_checklist_run('dddddddd-dddd-4ddd-8ddd-000000005101', 'ffffffff-ffff-4fff-8fff-000000005101') $q$, '42501', null, 'anon calls no checklist function');
select is((select count(*)::integer from storage.objects o where left(o.bucket_id, 4) = 'ops-'), 0, 'anon reads no operations photo');
select throws_ok(
  $q$ insert into storage.objects (bucket_id, name) values ('ops-brand-1', 'dddddddd-dddd-4ddd-8ddd-000000005101/ffffffff-ffff-4fff-8fff-000000005101/run/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg') $q$,
  '42501', null, 'anon uploads nothing'
);
reset role;

select * from finish();
rollback;
