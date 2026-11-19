begin;
select plan(35);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000010501'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000010502'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000010501'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000010502'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000010501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000010502'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000010503'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010501'::uuid as brand_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010502'::uuid as brand_a2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000010503'::uuid as brand_b1,
  '77777777-7777-4777-8777-000000010501'::uuid as oa_a1,
  '77777777-7777-4777-8777-000000010502'::uuid as oa_a2,
  '77777777-7777-4777-8777-000000010503'::uuid as oa_b1,
  'eeeeeeee-eeee-4eee-8eee-000000010501'::uuid as owner_a,
  'eeeeeeee-eeee-4eee-8eee-000000010502'::uuid as manager_a,
  'eeeeeeee-eeee-4eee-8eee-000000010503'::uuid as staff_a,
  'eeeeeeee-eeee-4eee-8eee-000000010504'::uuid as owner_b;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'oa-menus-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_a), (fx.manager_a), (fx.staff_a), (fx.owner_b)) as u (id);
insert into public.tenants (id, slug, name)
select tenant_a, 'oa-menus-a-pgtap', 'OA menus pgTAP' from fx
union all
select tenant_b, 'oa-menus-b-pgtap', 'OA menus other pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'oa-menus-a', 'Synthetic account' from fx
union all
select account_b, tenant_b, 'mock', 'oa-menus-b', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a1, tenant_a, account_a, 'oam-ext-1', 'Synthetic store 1' from fx
union all
select store_a2, tenant_a, account_a, 'oam-ext-2', 'Synthetic store 2' from fx
union all
select store_b1, tenant_b, account_b, 'oam-ext-9', 'Synthetic store 9' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_a, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_a, manager_a, 'manager', null from fx
union all
select tenant_a, staff_a, 'staff', array[store_a1] from fx
union all
select tenant_b, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a1, tenant_a, 'brand-1', 'Synthetic brand 1', array[store_a1] from fx
union all
select brand_a2, tenant_a, 'brand-2', 'Synthetic brand 2', array[store_a2] from fx
union all
select brand_b1, tenant_b, 'brand-1', 'Synthetic other brand', array[store_b1] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, secret_name)
select oa_a1, tenant_a, brand_a1, 'synthetic-oa-105-1', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx
union all
select oa_a2, tenant_a, brand_a2, 'synthetic-oa-105-2', 'co_ban', 'ZALO_OA_SECRET_BRAND_2' from fx
union all
select oa_b1, tenant_b, brand_b1, 'synthetic-oa-105-9', 'tang_truong', 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a1, 'customer', 'synthetic-mini-105', true, 'Thẻ thành viên', 'Thành viên', 'Members', '#123456', '#000000', 'white', 'white' from fx;

create temp table menu_input as
select
  '[{"action": "join", "label": "Tham gia thành viên", "target": "query"},
    {"action": "points", "label": "Điểm của tôi", "target": "mini_app"},
    {"action": "open_app", "label": "Mở ứng dụng", "target": "mini_app"}]'::jsonb as buttons,
  'Cảm ơn bạn đã quan tâm.' as welcome,
  'Bạn đã là thành viên. Bật nhận tin trong ứng dụng nếu muốn.' as joined,
  'Bạn đã là thành viên.' as member,
  'Tham gia thành viên' as title,
  'Chia sẻ tên và số điện thoại để tích dấu.' as subtitle,
  'https://example.com/brand-logo.png' as image;
grant select on fx, menu_input to authenticated, anon;

create function pg_temp.as_user(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_statement into v_value;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.as_anon(p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('role', 'anon', true);
  execute p_statement into v_value;
  perform set_config('role', 'postgres', true);
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute p_statement into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create function pg_temp.insert_menu(p_oa uuid, p_tenant uuid, p_buttons text, p_welcome text, p_image text)
returns text
language sql
as $$
  select format(
    'with i as (insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
      select %L::uuid, %L::uuid, %L::jsonb, %L, m.joined, m.member, m.title, m.subtitle, %L from menu_input m returning 1) select count(*)::text from i',
    p_tenant, p_oa, p_buttons, p_welcome, p_image
  );
$$;

select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a1 from fx), (select tenant_a from fx), (select buttons::text from menu_input), (select welcome from menu_input), (select image from menu_input))),
  '1',
  'an owner configures the menu of a brand''s OA'
);
select is(
  (select concat_ws(':', created_by = (select owner_a from fx), updated_by = (select owner_a from fx), applied_at is null) from public.oa_menus where oa_id = (select oa_a1 from fx)),
  't:t:t',
  'the row records its author and has not been applied'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a1 from fx), (select tenant_a from fx), (select buttons::text from menu_input), (select welcome from menu_input), (select image from menu_input))),
  'error:23505',
  'one menu per OA, and so per brand'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_b1 from fx), (select tenant_b from fx), (select buttons::text from menu_input), (select welcome from menu_input), (select image from menu_input))),
  'error:42501',
  'an owner cannot configure the OA of another tenant'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_b1 from fx), (select tenant_a from fx), (select buttons::text from menu_input), (select welcome from menu_input), (select image from menu_input))),
  'error:23503',
  'nor attach a menu of the tenant to an OA of another tenant'
);
select is(
  pg_temp.as_user((select manager_a from fx), 'select count(*)::text from public.oa_menus'),
  '1',
  'a manager reads the menu'
);
select is(
  pg_temp.as_user((select manager_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), (select buttons::text from menu_input), (select welcome from menu_input), (select image from menu_input))),
  'error:42501',
  'a manager cannot configure a menu'
);
select is(
  pg_temp.as_user((select manager_a from fx), format('with u as (update public.oa_menus set welcome_text = %L returning 1) select count(*)::text from u', 'Xin chào')),
  '0',
  'a manager''s update touches no row'
);
select is(
  pg_temp.as_user((select staff_a from fx), 'select count(*)::text from public.oa_menus'),
  '0',
  'staff do not see the menu'
);
select is(
  pg_temp.as_user((select owner_b from fx), 'select count(*)::text from public.oa_menus'),
  '0',
  'the owner of another tenant does not see it'
);
select is(
  pg_temp.as_anon('select count(*)::text from public.oa_menus'),
  'error:42501',
  'anon cannot read menus'
);
select is(
  pg_temp.as_user((select owner_a from fx), format('with u as (update public.oa_menus set welcome_text = %L returning 1) select count(*)::text from u', 'Chào mừng bạn.')),
  '1',
  'an owner edits the texts'
);
select is(
  pg_temp.as_user((select owner_a from fx), format('update public.oa_menus set applied_sha256 = %L, applied_at = now(), applied_buttons = %L::jsonb returning 1', repeat('a', 64), '[]')),
  'error:42501',
  'the applied state is not writable through the API'
);

select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[{"action": "points", "label": "Điểm", "target": "query"}]', 'Xin chào.', null)),
  'error:23514',
  'only the join button may be an OA keyword'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[{"action": "open_app", "label": "Gọi 0900 000 105", "target": "mini_app"}]', 'Xin chào.', null)),
  'error:23514',
  'a label carries no phone number'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[{"action": "open_app", "label": "Mở", "target": "mini_app", "url": "https://example.com"}]', 'Xin chào.', null)),
  'error:23514',
  'a button carries no field of its own, so no other link'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[{"action": "points", "label": "A", "target": "mini_app"}, {"action": "points", "label": "B", "target": "mini_app"}]', 'Xin chào.', null)),
  'error:23514',
  'an action appears once'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[]', 'Xin chào.', null)),
  'error:23514',
  'a menu has at least one button'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), (select buttons::text from menu_input), 'Xin chào.', null)),
  'error:23514',
  'a join keyword sends Zalo''s form, which needs its image'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), (select buttons::text from menu_input), 'Xin chào.', 'http://example.com/logo.png')),
  'error:23514',
  'the form image is an https address'
);
select is(
  pg_temp.as_user((select owner_a from fx), pg_temp.insert_menu((select oa_a2 from fx), (select tenant_a from fx), '[{"action": "open_app", "label": "Mở", "target": "mini_app"}]', 'Xem https://example.com nhé.', null)),
  'error:23514',
  'the welcome carries no link'
);
select is(
  (select concat_ws(':',
    app.oa_text_valid('Dòng một' || chr(10) || 'Dòng hai', 100),
    app.oa_text_valid('Liên hệ 090.000.0105', 100),
    app.oa_text_valid('Ghé www.example.com', 100),
    app.oa_text_valid(' Có khoảng trắng', 100),
    app.oa_text_valid('Chuông' || chr(7), 100),
    app.oa_text_valid(repeat('x', 31), 30))),
  't:f:f:f:f:f',
  'texts keep a line break and refuse phone numbers, links, outer spaces, control characters and excess length'
);

select is(
  app.set_oa_menu((select tenant_a from fx), 'brand-2', '[{"action": "open_app", "label": "Mở ứng dụng", "target": "mini_app"}]', false, 'Xin chào.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên.', 'Tham gia', 'Chia sẻ tên.', null),
  'created',
  'set_oa_menu creates the menu of a brand without one'
);
select is(
  app.set_oa_menu((select tenant_a from fx), 'brand-2', '[{"action": "open_app", "label": "Mở ứng dụng", "target": "mini_app"}]', false, 'Xin chào.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên.', 'Tham gia', 'Chia sẻ tên.', null),
  'unchanged',
  'the same values change nothing'
);
select is(
  app.set_oa_menu((select tenant_a from fx), 'brand-2', '[{"action": "open_app", "label": "Mở thẻ", "target": "mini_app"}]', false, 'Xin chào.', 'Bạn đã là thành viên.', 'Bạn đã là thành viên.', 'Tham gia', 'Chia sẻ tên.', null),
  'updated',
  'new values replace the menu'
);
select is(
  pg_temp.outcome($$ select app.set_oa_menu((select tenant_a from fx), 'brand-9', '[{"action": "open_app", "label": "Mở", "target": "mini_app"}]', true, 'a', 'b', 'c', 'd', 'e', null) $$),
  'error:22023',
  'a brand without an OA in the tenant is refused'
);
select is(
  pg_temp.outcome($$ select app.set_oa_menu((select tenant_a from fx), 'brand-2', '[{"action": "join", "label": "Tham gia", "target": "query"}]', true, 'a', 'b', 'c', 'd', 'e', null) $$),
  'error:23514',
  'set_oa_menu goes through the table''s checks'
);

select is(
  (select concat_ws(':', s.mini_app_id, s.package_tier, jsonb_array_length(s.buttons), s.applied_buttons is null)
   from app.oa_menu_source((select tenant_a from fx), 'brand-1') s),
  'synthetic-mini-105:tang_truong:3:t',
  'the source of the apply names the customer Mini App, the package and the configured buttons'
);
select is(
  (select concat_ws(':', coalesce(s.mini_app_id, 'none'), s.package_tier) from app.oa_menu_source((select tenant_a from fx), 'brand-2') s),
  'none:co_ban',
  'a brand without a customer Mini App has no deep-link target'
);
select is(
  (select count(*)::integer from app.oa_menu_source((select tenant_b from fx), 'brand-2')),
  0,
  'the source never crosses tenants'
);
select lives_ok(
  format($$ select app.record_oa_menu_applied(%L::uuid, '[{"title": "Mở", "type": "oa.open.url", "payload": {"url": "https://zalo.me/s/x/?src=oa"}}]', %L, now()) $$,
    (select id from public.oa_menus where oa_id = (select oa_a1 from fx)), repeat('b', 64)),
  'the applied buttons are recorded'
);
select is(
  (select concat_ws(':', applied_sha256 = repeat('b', 64), jsonb_array_length(applied_buttons), applied_at is not null) from public.oa_menus where oa_id = (select oa_a1 from fx)),
  't:1:t',
  'with their digest and time'
);
select is(
  pg_temp.outcome(format($$ select app.record_oa_menu_applied(%L::uuid, '[]', 'not-a-digest', now()) $$, (select id from public.oa_menus where oa_id = (select oa_a1 from fx)))),
  'error:22023',
  'a malformed digest is refused'
);

select is(
  pg_temp.as_user((select owner_a from fx), $$ select app.set_oa_menu('00000000-0000-0000-0000-000000000000', 'brand-1', '[]', true, 'a', 'b', 'c', 'd', 'e', null) $$),
  'error:42501',
  'the menu functions are closed to API roles'
);
select ok(
  not has_function_privilege('service_role', 'app.record_oa_menu_applied(uuid, jsonb, text, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'app.oa_access_token(uuid, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.oa_access_token(uuid, timestamptz)', 'execute'),
  'neither the API roles nor service_role reach the applied state or the OA token'
);

select * from finish();
rollback;
