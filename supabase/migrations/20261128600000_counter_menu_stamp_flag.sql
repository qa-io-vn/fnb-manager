-- The counter's menu says which items earn a stamp (Q01: "Đơn xong thì 3 dấu vào thẻ"). An order earns one stamp per
-- unit of its lines that count for stamps (order_lines.counts_for_stamps, copied from menu_items.counts_for_stamps at
-- placement); the customer menu already carries the item's flag, the counter menu did not, so the counter ticket could
-- not say how many stamps an order keyed for a member will earn. counter_menu now answers counts_for_stamps on every
-- item and, per brand of the store, whether its stamp card is on and how many stamps make a reward. The answer only
-- gains fields: every existing field keeps its name, type and order.

create or replace function app.counter_menu(p_store_id uuid, p_at timestamptz default now())
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
          'option_group_ids', coalesce((select jsonb_agg(l.group_id order by l.sort_order, l.group_id) from public.menu_item_option_groups l where l.item_id = x.item_id), '[]'::jsonb),
          'counts_for_stamps', x.counts_for_stamps
        )
        order by x.category_sort, x.category_name, x.item_sort, x.item_name, x.item_id
      )
      from (
        select r.item_id, b.brand_id, r.category_name, r.category_sort, r.item_name, r.item_sort, r.order_types, r.counts_for_stamps,
          bool_or(r.available) as available, max(r.sold_out_until) as sold_out_until,
          jsonb_agg(jsonb_build_object('id', r.size_id, 'label', r.size_label, 'price', r.price::bigint, 'is_default', r.is_default) order by r.size_sort, r.price, r.size_id) as sizes
        from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
        cross join lateral app.menu_rows(v_store.id, b.brand_id, p_at) r
        where r.shown
        group by r.item_id, b.brand_id, r.category_name, r.category_sort, r.item_name, r.item_sort, r.order_types, r.counts_for_stamps
      ) x
    ), '[]'::jsonb),
    'option_groups', coalesce((
      select jsonb_agg(g) from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
      cross join lateral jsonb_array_elements(app.menu_option_groups_json(b.brand_id, v_items)) g
    ), '[]'::jsonb),
    'stamp_cards', coalesce((
      select jsonb_agg(jsonb_build_object('brand_id', b.brand_id, 'enabled', s.enabled, 'stamps_per_reward', s.stamps_per_reward) order by b.brand_id)
      from unnest(app.menu_brand_ids_of_store(v_store.id)) as b (brand_id)
      cross join lateral app.stamp_settings(b.brand_id) s
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.counter_menu(uuid, timestamptz) is 'the counter''s menu of a store (native-till.md 3.4): every item on sale of the brands covering the store with its sizes and prices, whether it is available now and until when it is sold out, whether it earns a stamp (counts_for_stamps: one stamp per unit when an order of a member completes), the option groups, and per brand whether its stamp card is on and how many stamps make a reward; for the counter''s order form, its ticket and the sold-out switches; owners, managers and staff of the store only';

revoke all on function app.counter_menu(uuid, timestamptz) from public, anon, authenticated, service_role;
