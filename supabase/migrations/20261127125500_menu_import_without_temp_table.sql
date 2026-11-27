-- The one-time POS menu import without a temporary table (ADR-060).
--
-- app.import_menu_from_pos built its POS size rows into a temporary table, which the plpgsql lint of the security
-- workflow cannot see ("relation import_sizes does not exist"), so the lint failed. The same rows now come from a
-- set-returning helper that each step of the import reads; the import's behaviour is unchanged: same rows, same
-- order of inserts, same refusals and the same answer.

create function app.native_import_size_rows(p_tenant_id uuid, p_store_id uuid, p_pos_account_id uuid)
returns table (
  external_id text,
  base_name text,
  size_label text,
  type_source text,
  type_name text,
  price numeric,
  restricted boolean
)
language sql
stable
set search_path = ''
as $$
  -- The POS items that become sizes: active, not modifiers, chargeable, and not an option of a POS option group.
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
  left join public.store_items si on si.store_id = p_store_id and si.tenant_id = i.tenant_id and si.item_external_id = i.external_id
  where i.pos_account_id = p_pos_account_id
    and i.tenant_id = p_tenant_id
    and i.active
    and not i.is_modifier
    and coalesce(si.active, true)
    and app.native_price_valid(coalesce(si.list_price, i.list_price), 1, 100000000)
    and not exists (
      select 1 from public.item_option_group_options o
      join public.item_option_groups g on g.pos_account_id = o.pos_account_id and g.external_id = o.group_external_id and g.active
      where o.pos_account_id = i.pos_account_id and o.item_external_id = i.external_id
    )
$$;

comment on function app.native_import_size_rows(uuid, uuid, uuid) is 'the POS items of one store that the one-time menu import turns into sizes (active, not modifiers, priced between 1 and 100,000,000 dong, not an option of a POS option group), with their base name, size label, item type, the store''s list price else the item''s, and whether the name or type looks like alcohol or beer; read only by app.import_menu_from_pos (ADR-060)';

revoke all on function app.native_import_size_rows(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app.import_menu_from_pos(p_brand_id uuid, p_store_id uuid, p_at timestamptz default now())
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

  insert into public.menu_categories (tenant_id, brand_id, name, sort_order, source_item_type_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, x.name, (10 * row_number() over (order by x.name, x.type_source))::integer, x.type_source, (select auth.uid()), (select auth.uid())
  from (
    select s.type_source, btrim(left(min(coalesce(nullif(btrim(regexp_replace(s.type_name, '[[:cntrl:]]', ' ', 'g')), ''), 'Khác')), 40)) as name
    from app.native_import_size_rows(v_brand.tenant_id, v_store.id, v_store.pos_account_id) s group by s.type_source
  ) x;

  insert into public.menu_items (tenant_id, brand_id, category_id, name, sort_order, visible, restricted, source_pos_account_id, source_item_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, c.id, btrim(left(regexp_replace(g.base_name, '[[:cntrl:]]', ' ', 'g'), 60)),
    least(10 * row_number() over (partition by c.id order by g.base_name), 100000)::integer,
    not g.restricted, g.restricted, v_store.pos_account_id, g.first_external_id, (select auth.uid()), (select auth.uid())
  from (
    select s.type_source, s.base_name, bool_or(s.restricted) as restricted, min(s.external_id) as first_external_id
    from app.native_import_size_rows(v_brand.tenant_id, v_store.id, v_store.pos_account_id) s group by s.type_source, s.base_name
  ) g
  join public.menu_categories c on c.brand_id = v_brand.id and c.source_item_type_external_id = g.type_source;

  insert into public.menu_item_sizes (tenant_id, brand_id, item_id, label, price, sort_order, is_default, source_item_external_id, created_by, updated_by)
  select v_brand.tenant_id, v_brand.id, x.item_id, x.label, x.price, (10 * x.position)::integer, x.position = 1, x.external_id, (select auth.uid()), (select auth.uid())
  from (
    select i.id as item_id, case when count(*) over (partition by i.id) > 1 then btrim(left(s.size_label, 20)) end as label, s.price, s.external_id,
      row_number() over (partition by i.id order by s.price, s.size_label nulls first, s.external_id) as position
    from (
      select distinct on (s.type_source, s.base_name, lower(coalesce(s.size_label, ''))) s.*
      from app.native_import_size_rows(v_brand.tenant_id, v_store.id, v_store.pos_account_id) s
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
  return jsonb_build_object('state', 'imported', 'counts', v_counts, 'menu_version', app.menu_version(v_brand.id));
end;
$$;
