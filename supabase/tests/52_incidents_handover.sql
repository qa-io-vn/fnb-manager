begin;
select plan(77);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000005201'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000005202'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000005201'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000005202'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000005201'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000005202'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000005203'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005201'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000005202'::uuid as owner_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005203'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005204'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005205'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000005206'::uuid as staff_x1b,
  'eeeeeeee-eeee-4eee-8eee-000000005207'::uuid as staff_xall,
  'eeeeeeee-eeee-4eee-8eee-000000005208'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000005209'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000005210'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000005211'::uuid as staff_y1,
  'eeeeeeee-eeee-4eee-8eee-000000005212'::uuid as no_member;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'incidents-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[
  fx.owner_x, fx.owner_x1, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.staff_x1b, fx.staff_xall, fx.viewer_x, fx.publisher_x,
  fx.owner_y, fx.staff_y1, fx.no_member
]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'incidents-pgtap-x', 'Incidents pgTAP X' from fx
union all
select tenant_y, 'incidents-pgtap-y', 'Incidents pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'incidents-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'incidents-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select store_x1, tenant_x, account_x, 'incidents-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_x2, tenant_x, account_x, 'incidents-x2', 'Synthetic store X2', 'Asia/Ho_Chi_Minh', 300 from fx
union all
select store_y1, tenant_y, account_y, 'incidents-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh', 0 from fx;

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

insert into public.brands (tenant_id, brand_key, display_name, store_ids)
select tenant_x, 'brand-1', 'Synthetic brand X', array[store_x1, store_x2] from fx
union all
select tenant_y, 'brand-1', 'Synthetic brand Y', array[store_y1] from fx;

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

create temp table ids (label text primary key, id uuid);

create function pg_temp.id(p_label text)
returns uuid
language sql
as $$
  select i.id from ids i where i.label = p_label;
$$;

create function pg_temp.photo(p_label text, p_name text)
returns text
language sql
security definer
as $$
  select i.tenant_id || '/' || i.store_id || '/incident/' || i.id || '/' || p_name
  from public.incidents i
  where i.id = pg_temp.id(p_label);
$$;

create function pg_temp.upload_as(p_user uuid, p_bucket text, p_name text)
returns text
language sql
as $$
  select pg_temp.outcome_as(p_user, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', p_bucket, p_name, p_user));
$$;

grant select on fx, ids to authenticated, anon;

insert into ids
select 'h1', (pg_temp.value_as(fx.staff_x1, format('select public.write_handover(%L, 1, 2, %L)::text', fx.store_x1, E'Máy pha cà phê kêu to.\nĐã báo quản lý.'))::jsonb ->> 'handover_id')::uuid from fx
union all
select 'h_manager', (pg_temp.value_as(fx.manager_x1, format('select public.write_handover(%L, 2, 3, %L)::text', fx.store_x1, 'Hết sữa tươi lúc 15 giờ.'))::jsonb ->> 'handover_id')::uuid from fx
union all
select 'h_y', (pg_temp.value_as(fx.staff_y1, format('select public.write_handover(%L, 1, 2, %L)::text', fx.store_y1, 'Bình thường.'))::jsonb ->> 'handover_id')::uuid from fx
union all
select 'i1', (pg_temp.value_as(fx.staff_x1, format('select public.report_incident(%L, %L, %L, %L)::text', fx.store_x1, 'incident', 'thiet_bi', 'Máy in hóa đơn kẹt giấy.'))::jsonb ->> 'incident_id')::uuid from fx
union all
select 'i_stock', (pg_temp.value_as(fx.staff_x1b, format('select public.report_incident(%L, %L, %L, %L, %L)::text', fx.store_x1, 'stock_out', 'khac', 'Hết hàng từ 14 giờ.', 'Trân châu đen'))::jsonb ->> 'incident_id')::uuid from fx
union all
select 'i_manager', (pg_temp.value_as(fx.manager_x1, format('select public.report_incident(%L, %L, %L, %L)::text', fx.store_x1, 'incident', 've_sinh', 'Bồn rửa bị tắc.'))::jsonb ->> 'incident_id')::uuid from fx
union all
select 'i_x2', (pg_temp.value_as(fx.staff_xall, format('select public.report_incident(%L, %L, %L, %L)::text', fx.store_x2, 'incident', 'nhan_su', 'Thiếu một người ca chiều.'))::jsonb ->> 'incident_id')::uuid from fx
union all
select 'i_y', (pg_temp.value_as(fx.staff_y1, format('select public.report_incident(%L, %L, %L, %L)::text', fx.store_y1, 'incident', 'thiet_bi', 'Tủ mát hỏng.'))::jsonb ->> 'incident_id')::uuid from fx;

select is(
  (select array_agg(c.relname::text || ':' || c.relrowsecurity order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('incident_categories', 'incidents', 'shift_handovers')),
  array['incident_categories:true', 'incidents:true', 'shift_handovers:true'],
  'the three tables exist with RLS enabled'
);
select is((select count(*)::integer from ids where id is not null), 8, 'the fixture wrote three handovers and five reports through the RPCs');
select is(
  (select array_agg(c.key || ':' || c.label || ':' || c.sort_order order by c.sort_order) from public.incident_categories c where c.tenant_id is null),
  array['thiet_bi:Thiết bị:10', 've_sinh:Vệ sinh:20', 'khach_hang:Khách hàng:30', 'nhan_su:Nhân sự:40', 'khac:Khác:90'],
  'the five Vietnamese default categories are global rows'
);
select is(
  (select h.from_shift || '>' || h.to_shift || ':' || (h.business_date = app.store_business_date(h.store_id, now())) || ':' || (h.created_by = fx.staff_x1) || ':' || (h.acknowledged_at is null) || ':' || (h.note like E'%\n%')
   from public.shift_handovers h, fx where h.id = pg_temp.id('h1')),
  '1>2:true:true:true:true',
  'a handover records Ca 1 to Ca 2, the store''s business date, its writer and a multi-line note, unacknowledged'
);
select is(
  (select i.kind || ':' || i.category_key || ':' || i.status || ':' || coalesce(i.item_label, '-') || ':' || i.photo_bucket || ':' || (i.occurred_at = now()) || ':' || (i.business_date = app.store_business_date(i.store_id, now()))
   from public.incidents i where i.id = pg_temp.id('i_stock')),
  'stock_out:khac:open:Trân châu đen:ops-brand-1:true:true',
  'a stock-out records its kind, category, item, bucket, time and business date and starts open'
);

set local role authenticated;

select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.incident_categories (tenant_id, key, label, sort_order) values (%L, %L, %L, 90), (%L, %L, %L, 50)', (select tenant_x from fx), 'khac', 'Khác (ghi rõ)', (select tenant_x from fx), 'bep', 'Bếp')),
  'rows:2',
  'an owner of every store overrides a default and adds a category'
);
select is(
  pg_temp.outcome_as((select owner_x from fx), format('insert into public.incident_categories (tenant_id, key, label, sort_order, active) values (%L, %L, %L, 30, false)', (select tenant_x from fx), 'khach_hang', 'Khách hàng')),
  'rows:1',
  'and retires one'
);
select is(
  array[
    pg_temp.outcome_as((select owner_x1 from fx), format('insert into public.incident_categories (tenant_id, key, label) values (%L, %L, %L)', (select tenant_x from fx), 'quay', 'Quầy')),
    pg_temp.outcome_as((select manager_xall from fx), format('insert into public.incident_categories (tenant_id, key, label) values (%L, %L, %L)', (select tenant_x from fx), 'quay', 'Quầy')),
    pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.incident_categories (tenant_id, key, label) values (%L, %L, %L)', (select tenant_x from fx), 'quay', 'Quầy')),
    pg_temp.outcome_as((select owner_y from fx), format('insert into public.incident_categories (tenant_id, key, label) values (%L, %L, %L)', (select tenant_x from fx), 'quay', 'Quầy')),
    pg_temp.outcome_as((select owner_x from fx), format('insert into public.incident_categories (tenant_id, key, label) values (null, %L, %L)', 'quay', 'Quầy'))
  ],
  array['42501', '42501', '42501', '42501', '42501'],
  'a store-limited owner, a manager, staff and another tenant''s owner write no category, and nobody writes a global one'
);
select is(
  array[
    pg_temp.outcome_as((select owner_x from fx), format('update public.incident_categories set key = %L where tenant_id = %L and key = %L', 'kitchen', (select tenant_x from fx), 'bep')),
    pg_temp.outcome_as((select owner_x from fx), format('update public.incident_categories set label = %L where tenant_id is null and key = %L', 'Máy', 'thiet_bi')),
    pg_temp.outcome_as((select owner_x from fx), format('update public.incident_categories set label = %L where tenant_id = %L and key = %L', 'Bếp và quầy', (select tenant_x from fx), 'bep'))
  ],
  array['42501', 'rows:0', 'rows:1'],
  'a key never changes, a global row is never edited, an own label is'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select array_agg(c.key || %L || c.label || %L || c.active || %L || c.tenant_row order by c.sort_order, c.key)::text from public.incident_categories_of(%L) c', ':', ':', ':', (select tenant_x from fx))),
  '{"thiet_bi:Thiết bị:true:false","ve_sinh:Vệ sinh:true:false","khach_hang:Khách hàng:false:true","nhan_su:Nhân sự:true:false","bep:Bếp và quầy:true:true","khac:Khác (ghi rõ):true:true"}',
  'staff read the tenant''s effective list: the defaults with its override, its retired one and its own category'
);
select is(
  pg_temp.value_as((select staff_y1 from fx), format('select array_agg(c.key || %L || c.tenant_row order by c.sort_order)::text from public.incident_categories_of(%L) c', ':', (select tenant_x from fx))),
  '{thiet_bi:false,ve_sinh:false,khach_hang:false,nhan_su:false,khac:false}',
  'another tenant''s member sees only the defaults: categories are per tenant'
);
select is(
  array[pg_temp.seen_as((select staff_x1 from fx), 'incident_categories'), pg_temp.seen_as((select viewer_x from fx), 'incident_categories'), pg_temp.seen_as((select owner_y from fx), 'incident_categories')],
  array[3, 0, 0],
  'tenant rows are read by the tenant''s owners, managers and staff only'
);

select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'stock_out', 'khac', 'Hết hàng.')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Hỏng.', 'Ly nhựa')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'complaint', 'khac', 'Khách phàn nàn.'))
  ],
  array['error:23514', 'error:23514', 'error:23514'],
  'a stock-out names its item, an incident names none, and the kind is incident or stock_out'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khach_hang', 'Khách quên đồ.')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'unknown_key', 'Khác.')),
    pg_temp.value_as((select staff_y1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_y1 from fx), 'incident', 'bep', 'Bếp.'))
  ],
  array['error:22023', 'error:22023', 'error:22023'],
  'a retired category, an unknown one and another tenant''s own category are refused'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L) ->> %L', (select store_x1 from fx), 'incident', 'bep', 'Bếp nóng.', 'status')),
  'open',
  'the tenant''s own category is accepted'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L, null, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Cũ.', now() - interval '8 days')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L, null, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Tương lai.', now() + interval '1 hour')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khac', '   '))
  ],
  array['error:22023', 'error:22023', 'error:23514'],
  'a time more than 7 days back or in the future and an empty description are refused'
);
select is(
  pg_temp.value_as((select staff_xall from fx), format('select (public.report_incident(%L, %L, %L, %L, null, %L) ->> %L)::date = %L::date', (select store_x2 from fx), 'incident', 'khac', 'Hôm qua, 04:30.',
    (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 day' + interval '4 hours 30 minutes') at time zone 'Asia/Ho_Chi_Minh', 'business_date',
    (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2)),
  'true',
  'a report of an earlier time takes that time''s business date under the store''s day start'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x2 from fx), 'incident', 'khac', 'Ngoài phạm vi.')),
    pg_temp.value_as((select viewer_x from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Người xem.')),
    pg_temp.value_as((select publisher_x from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Nhà phát hành.')),
    pg_temp.value_as((select staff_y1 from fx), format('select public.report_incident(%L, %L, %L, %L)::text', (select store_x1 from fx), 'incident', 'khac', 'Tenant khác.'))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'nobody reports at a store outside their operations scope'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.incidents (tenant_id, store_id, kind, category_key, description, status) values (%L, %L, %L, %L, %L, %L)', (select tenant_x from fx), (select store_x1 from fx), 'incident', 'khac', 'x', 'resolved')),
  '42501',
  'a client cannot insert a report with a status'
);

select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('i1', 'printer-1.jpg')), 'rows:1', 'the reporter uploads a photo into the open report''s path');
select is(pg_temp.upload_as((select staff_x1b from fx), 'ops-brand-1', pg_temp.photo('i1', 'other.jpg')), '42501', 'another staff member cannot upload into it');
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-2', pg_temp.photo('i1', 'printer-2.jpg')), '42501', 'nor can the reporter into another bucket');
select is(pg_temp.upload_as((select staff_y1 from fx), 'ops-brand-1', pg_temp.photo('i_y', 'fridge-1.jpg')), 'rows:1', 'the other tenant''s reporter uploads into their report in the shared bucket');
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, %L)::text', pg_temp.id('i1'), 'thiet_bi', 'Máy in hóa đơn kẹt giấy.', array[pg_temp.photo('i1', 'missing.jpg')])),
  'error:22023',
  'a report cannot name a photo that was not uploaded'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, %L)::text', pg_temp.id('i1'), 'thiet_bi', 'x', array[pg_temp.photo('i_y', 'fridge-1.jpg')])),
    pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, %L)::text', pg_temp.id('i1'), 'thiet_bi', 'x', array[pg_temp.photo('i1', 'printer-1.jpg'), pg_temp.photo('i1', 'printer-1.jpg')])),
    pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, %L)::text', pg_temp.id('i1'), 'thiet_bi', 'x', array['a', 'b', 'c', 'd']))
  ],
  array['error:22023', 'error:22023', 'error:22023'],
  'nor another report''s photo, the same photo twice or more than three'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, %L) ->> %L', pg_temp.id('i1'), 'thiet_bi', 'Máy in hóa đơn kẹt giấy, đã thử khởi động lại.', array[pg_temp.photo('i1', 'printer-1.jpg')], 'photo_paths')),
  '["' || pg_temp.photo('i1', 'printer-1.jpg') || '"]',
  'the reporter attaches the uploaded photo and edits the description while the report is open'
);
select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.update_incident(%L, %L, %L, null, null)::text', pg_temp.id('i1'), 'khac', 'Sửa của người khác.')),
  'error:42501',
  'another staff member cannot edit the report'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.update_incident(%L, %L, %L, null, null)::text', pg_temp.id('i1'), 'khac', 'Quản lý sửa.')),
  'error:42501',
  'nor can a manager: a report is the reporter''s words'
);
select is(pg_temp.photos_as((select staff_x1 from fx)), 1, 'the reporter reads their photo');
select is(pg_temp.photos_as((select staff_x1b from fx)), 0, 'another staff member of the store does not');
select is(
  array[pg_temp.photos_as((select manager_x1 from fx)), pg_temp.photos_as((select owner_x from fx)), pg_temp.photos_as((select staff_xall from fx))],
  array[1, 1, 0],
  'managers and owners of the store read it; staff of every store do not'
);
select is(
  array[pg_temp.photos_as((select viewer_x from fx)), pg_temp.photos_as((select owner_y from fx)), pg_temp.photos_as((select staff_y1 from fx)), pg_temp.photos_as((select no_member from fx))],
  array[0, 1, 1, 0],
  'viewers and logins without membership read none; the other tenant reads only its own photo in the shared bucket'
);

select is(
  array[
    pg_temp.value_as((select staff_x1b from fx), format('select public.acknowledge_incident(%L)::text', pg_temp.id('i1'))),
    pg_temp.value_as((select staff_x1 from fx), format('select public.acknowledge_incident(%L)::text', pg_temp.id('i1'))),
    pg_temp.value_as((select owner_y from fx), format('select public.acknowledge_incident(%L)::text', pg_temp.id('i1'))),
    pg_temp.value_as((select viewer_x from fx), format('select public.acknowledge_incident(%L)::text', pg_temp.id('i1')))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'staff, the reporter, another tenant''s owner and a viewer acknowledge nothing'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.acknowledge_incident(%L)::text', pg_temp.id('i_x2'))),
  'error:42501',
  'a manager of another store does not acknowledge it'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select (d ->> %L) || %L || ((d ->> %L)::uuid = %L) || %L || ((d ->> %L)::timestamptz = now()) from public.acknowledge_incident(%L) d', 'status', ':', 'acknowledged_by', (select manager_x1 from fx), ':', 'acknowledged_at', pg_temp.id('i1'))),
  'seen:true:true',
  'a manager of the store acknowledges the report: seen, by whom and when'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select (public.acknowledge_incident(%L) ->> %L)::uuid = %L', pg_temp.id('i1'), 'acknowledged_by', (select manager_x1 from fx))),
  'true',
  'a second acknowledgement keeps the first'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.update_incident(%L, %L, %L, null, null)::text', pg_temp.id('i1'), 'khac', 'Sửa sau khi đã xem.')),
  'error:55000',
  'the reporter can no longer edit an acknowledged report'
);
select is(pg_temp.upload_as((select staff_x1 from fx), 'ops-brand-1', pg_temp.photo('i1', 'printer-3.jpg')), '42501', 'nor add photos to it');
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('update public.incidents set status = %L where id = %L', 'resolved', pg_temp.id('i1'))),
  '42501',
  'no client writes a status directly'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.resolve_incident(%L)::text', pg_temp.id('i1'))),
  'error:42501',
  'staff resolve nothing'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select (d ->> %L) || %L || ((d ->> %L)::uuid = %L) || %L || ((d ->> %L)::uuid = %L) from public.resolve_incident(%L) d', 'status', ':', 'resolved_by', (select manager_x1 from fx), ':', 'acknowledged_by', (select manager_x1 from fx), pg_temp.id('i1'))),
  'resolved:true:true',
  'a manager resolves the seen report'
);
select is(
  array[
    pg_temp.value_as((select manager_xall from fx), format('select public.resolve_incident(%L) ->> %L', pg_temp.id('i1'), 'status')),
    pg_temp.value_as((select manager_xall from fx), format('select public.acknowledge_incident(%L) ->> %L', pg_temp.id('i1'), 'status'))
  ],
  array['resolved', 'resolved'],
  'a resolved report is returned as it is'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.resolve_incident(%L)::text', pg_temp.id('i_manager'))),
  'error:42501',
  'a manager cannot resolve their own open report, which would acknowledge it'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select (d ->> %L) || %L || ((d ->> %L)::uuid = %L) from public.resolve_incident(%L) d', 'status', ':', 'acknowledged_by', (select manager_xall from fx), pg_temp.id('i_stock'))),
  'resolved:true',
  'another manager resolves an open report and acknowledges it in the same step'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select public.acknowledge_incident(%L) ->> %L', pg_temp.id('i_manager'), 'status')),
  'seen',
  'once another manager acknowledged the manager''s own report'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.resolve_incident(%L) ->> %L', pg_temp.id('i_manager'), 'status')),
  'resolved',
  'its reporter may resolve it'
);
select is(
  pg_temp.value_as((select owner_x from fx), format('select string_agg(i.kind || %L || i.status || %L || (i.acknowledged_at is not null), %L order by i.created_at, i.kind) from public.incidents i where i.store_id = %L and i.status <> %L', ':', ':', ',', (select store_x1 from fx), 'open')),
  'incident:resolved:true,incident:resolved:true,stock_out:resolved:true',
  'acknowledged reports appear in the incident log of the store with their state'
);

select is(
  pg_temp.value_as((select staff_x1b from fx), format('select public.update_handover(%L, 1, 2, %L)::text', pg_temp.id('h1'), 'Người khác sửa.')),
  'error:42501',
  'another staff member cannot edit a handover'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select public.update_handover(%L, 1, 2, %L)::text', pg_temp.id('h1'), 'Quản lý sửa.')),
  'error:42501',
  'nor can a manager'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.update_handover(%L, 1, 3, %L) ->> %L', pg_temp.id('h1'), 'Máy pha cà phê kêu to, đã gọi kỹ thuật.', 'handover_id')),
  pg_temp.id('h1')::text,
  'the writer edits the handover while it is unacknowledged'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.write_handover(%L, 0, 1, %L)::text', (select store_x1 from fx), 'x')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.write_handover(%L, 1, 13, %L)::text', (select store_x1 from fx), 'x')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.write_handover(%L, 1, 2, %L)::text', (select store_x1 from fx), '  ')),
    pg_temp.value_as((select staff_x1 from fx), format('select public.write_handover(%L, 1, 2, %L)::text', (select store_x1 from fx), 'bell' || chr(7)))
  ],
  array['error:23514', 'error:23514', 'error:23514', 'error:23514'],
  'shift labels run from Ca 1 to Ca 12 and a note has 1 to 2000 characters without control characters'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.write_handover(%L, 1, 2, %L)::text', (select store_x2 from fx), 'x')),
    pg_temp.value_as((select viewer_x from fx), format('select public.write_handover(%L, 1, 2, %L)::text', (select store_x1 from fx), 'x')),
    pg_temp.value_as((select staff_y1 from fx), format('select public.write_handover(%L, 1, 2, %L)::text', (select store_x1 from fx), 'x'))
  ],
  array['error:42501', 'error:42501', 'error:42501'],
  'nobody writes a handover at a store outside their operations scope'
);
select is(
  pg_temp.outcome_as((select staff_x1 from fx), format('insert into public.shift_handovers (tenant_id, store_id, from_shift, to_shift, note, acknowledged_at) values (%L, %L, 1, 2, %L, now())', (select tenant_x from fx), (select store_x1 from fx), 'x')),
  '42501',
  'a client cannot write an acknowledgement into a handover'
);
select is(
  array[
    pg_temp.value_as((select staff_x1 from fx), format('select public.acknowledge_handover(%L)::text', pg_temp.id('h1'))),
    pg_temp.value_as((select staff_x1b from fx), format('select public.acknowledge_handover(%L)::text', pg_temp.id('h1'))),
    pg_temp.value_as((select owner_y from fx), format('select public.acknowledge_handover(%L)::text', pg_temp.id('h1'))),
    pg_temp.value_as((select manager_x1 from fx), format('select public.acknowledge_handover(%L)::text', pg_temp.id('h_manager')))
  ],
  array['error:42501', 'error:42501', 'error:42501', 'error:42501'],
  'the writer, other staff, another tenant''s owner and a manager on their own handover acknowledge nothing'
);
select is(
  pg_temp.value_as((select manager_x1 from fx), format('select ((d ->> %L)::uuid = %L) || %L || ((d ->> %L)::timestamptz = now()) from public.acknowledge_handover(%L) d', 'acknowledged_by', (select manager_x1 from fx), ':', 'acknowledged_at', pg_temp.id('h1'))),
  'true:true',
  'a manager of the store acknowledges the handover'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select ((public.acknowledge_handover(%L) ->> %L)::uuid = %L)::text', pg_temp.id('h1'), 'acknowledged_by', (select manager_x1 from fx))),
  'true',
  'a second acknowledgement keeps the first'
);
select is(
  pg_temp.value_as((select manager_xall from fx), format('select ((public.acknowledge_handover(%L) ->> %L)::uuid = %L)::text', pg_temp.id('h_manager'), 'acknowledged_by', (select manager_xall from fx))),
  'true',
  'another manager acknowledges the manager''s handover'
);
select is(
  pg_temp.value_as((select staff_x1 from fx), format('select public.update_handover(%L, 1, 2, %L)::text', pg_temp.id('h1'), 'Sửa sau khi đã xem.')),
  'error:55000',
  'an acknowledged handover can no longer be edited'
);
select is(
  pg_temp.outcome_as((select manager_x1 from fx), format('update public.shift_handovers set acknowledged_at = null where id = %L', pg_temp.id('h1'))),
  '42501',
  'no client clears an acknowledgement'
);

select is(pg_temp.seen_as((select owner_x from fx), 'incidents'), 6, 'reports: an owner of every store reads every report of the tenant');
select is(
  array[pg_temp.seen_as((select owner_x1 from fx), 'incidents'), pg_temp.seen_as((select manager_x1 from fx), 'incidents'), pg_temp.seen_as((select staff_x1 from fx), 'incidents'), pg_temp.seen_as((select staff_xall from fx), 'incidents')],
  array[4, 4, 4, 6],
  'store-limited members read their store''s reports, staff of every store all of them'
);
select is(
  array[pg_temp.seen_as((select viewer_x from fx), 'incidents'), pg_temp.seen_as((select publisher_x from fx), 'incidents'), pg_temp.seen_as((select no_member from fx), 'incidents')],
  array[0, 0, 0],
  'a viewer, the publisher and a login without membership read no report'
);
select is(
  array[pg_temp.seen_as((select owner_y from fx), 'incidents'), pg_temp.seen_as((select staff_y1 from fx), 'incidents')],
  array[1, 1],
  'no report read crosses tenants'
);
select is(
  array[pg_temp.seen_as((select owner_x from fx), 'shift_handovers'), pg_temp.seen_as((select manager_x1 from fx), 'shift_handovers'), pg_temp.seen_as((select staff_x1b from fx), 'shift_handovers'), pg_temp.seen_as((select viewer_x from fx), 'shift_handovers'), pg_temp.seen_as((select staff_y1 from fx), 'shift_handovers')],
  array[2, 2, 2, 0, 1],
  'handovers follow the same scope'
);

reset role;

select is(
  (select count(*)::integer from public.outbound_messages o, fx where o.tenant_id in (fx.tenant_x, fx.tenant_y))
    + (select count(*)::integer from public.alert_events e, fx where e.tenant_id in (fx.tenant_x, fx.tenant_y)),
  0,
  'reports, handovers and acknowledgements send no message and open no alert'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.prosrc ~ '(description|\.note\M|item_label)'
     and p.prosrc ~ '(outbound_messages|raise_alert|enqueue_message|enqueue_alert_messages|record_job_event|raise notice|raise log)'),
  0,
  'no function that touches a report''s text writes a message, an alert or a log line'
);
select is(
  (select count(*)::integer from pg_constraint c where c.conrelid = 'public.alert_events'::regclass and c.conname = 'alert_events_facts_check'),
  1,
  'and alert facts stay count-only by constraint'
);
select throws_ok(
  format($q$ update public.incidents set status = 'open' where id = %L $q$, pg_temp.id('i1')),
  '55000', null,
  'a report''s status never moves back, even for the database owner'
);
update storage.objects o set created_at = now() - interval '100 days' where o.name = pg_temp.photo('i1', 'printer-1.jpg');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects o using app.expired_ops_photos() e where o.bucket_id = e.bucket_id and o.name = e.name and o.name like (select tenant_x from fx) || '/%';
select set_config('storage.allow_delete_query', 'false', true);
select set_config('request.jwt.claims', '', true);
select is(app.mark_removed_ops_photos('2026-11-18 03:00:00+00'), 1, 'past the retention the report''s photo is removed and the report is marked');
select is(
  (select (i.photo_removed_at = '2026-11-18 03:00:00+00') || ':' || cardinality(i.photo_paths) || ':' || i.status from public.incidents i where i.id = pg_temp.id('i1')),
  'true:1:resolved',
  'the report keeps its path, its state and the photo-removed marker'
);
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname in ('acknowledge_handover', 'acknowledge_incident', 'resolve_incident')),
  array['acknowledge_handover:true', 'acknowledge_incident:true', 'resolve_incident:true'],
  'acknowledging and resolving run as definer, checking the role themselves'
);
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('acknowledge_handover', 'acknowledge_incident', 'resolve_incident', 'write_handover', 'update_handover', 'report_incident', 'update_incident', 'incident_categories_of')),
  array['acknowledge_handover:false', 'acknowledge_incident:false', 'incident_categories_of:false', 'report_incident:false', 'resolve_incident:false',
        'update_handover:false', 'update_incident:false', 'write_handover:false'],
  'every RPC in public runs as the caller'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'app')
     and p.proname in ('acknowledge_handover', 'acknowledge_incident', 'resolve_incident', 'write_handover', 'update_handover', 'report_incident', 'update_incident',
                       'incident_categories_of', 'incident_category_active', 'prepare_incident', 'guard_incident', 'prepare_shift_handover', 'guard_shift_handover', 'check_incident_photos')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
  0,
  'none of them is executable by public or anon'
);

set local role anon;
select throws_ok('select count(*) from public.incidents', '42501', null, 'anon reads no report');
select throws_ok('select count(*) from public.shift_handovers', '42501', null, 'anon reads no handover');
select throws_ok('select count(*) from public.incident_categories', '42501', null, 'anon reads no category');
select throws_ok($q$ select public.report_incident('ffffffff-ffff-4fff-8fff-000000005201', 'incident', 'khac', 'x') $q$, '42501', null, 'anon reports nothing');
reset role;

select * from finish();
rollback;
