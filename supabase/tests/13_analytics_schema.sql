begin;
select plan(72);

select has_table('public', 'dim_calendar', 'dim_calendar table exists');
select has_table('public', 'agg_daily_sales', 'agg_daily_sales table exists');
select has_table('public', 'agg_hourly_sales', 'agg_hourly_sales table exists');
select has_table('public', 'agg_item_daily', 'agg_item_daily table exists');
select has_table('public', 'agg_category_daily', 'agg_category_daily table exists');
select has_table('public', 'agg_payment_daily', 'agg_payment_daily table exists');
select has_table('public', 'agg_shift_cash', 'agg_shift_cash table exists');
select has_table('public', 'agg_size_mix_daily', 'agg_size_mix_daily table exists');
select has_table('public', 'agg_modifier_prefs_daily', 'agg_modifier_prefs_daily table exists');
select has_table('public', 'agg_basket_pairs_28d', 'agg_basket_pairs_28d table exists');
select has_table('public', 'agg_attach_daily', 'agg_attach_daily table exists');
select has_table('public', 'analytics_refreshes', 'analytics_refreshes table exists');
select has_view('public', 'v_recent_daily_sales', 'v_recent_daily_sales view exists');
select has_view('public', 'v_recent_hourly_sales', 'v_recent_hourly_sales view exists');

select col_is_pk('public', 'dim_calendar', 'calendar_date', 'dim_calendar pk is calendar_date');
select col_is_pk('public', 'agg_daily_sales', array['store_id', 'business_date'], 'agg_daily_sales pk is (store_id, business_date)');
select col_is_pk('public', 'agg_hourly_sales', array['store_id', 'business_date', 'hour_local'], 'agg_hourly_sales pk is (store_id, business_date, hour_local)');
select col_is_pk('public', 'agg_item_daily', array['store_id', 'business_date', 'item_external_id'], 'agg_item_daily pk is (store_id, business_date, item_external_id)');
select col_is_pk('public', 'agg_shift_cash', array['store_id', 'shift_id'], 'agg_shift_cash pk is (store_id, shift_id)');
select col_is_pk('public', 'agg_basket_pairs_28d', array['store_id', 'as_of_date', 'item_a_external_id', 'item_b_external_id'], 'agg_basket_pairs_28d pk covers the pair');
select col_is_pk('public', 'agg_attach_daily', array['store_id', 'business_date'], 'agg_attach_daily pk is (store_id, business_date)');

select fk_ok('public', 'agg_daily_sales', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'agg_daily_sales store foreign key carries tenant_id');
select fk_ok('public', 'agg_hourly_sales', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'agg_hourly_sales store foreign key carries tenant_id');
select fk_ok('public', 'agg_item_daily', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'agg_item_daily store foreign key carries tenant_id');
select fk_ok('public', 'agg_shift_cash', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'agg_shift_cash store foreign key carries tenant_id');
select fk_ok('public', 'agg_shift_cash', array['shift_id'], 'public', 'shifts', array['id'], 'agg_shift_cash references the shift');
select fk_ok('public', 'agg_basket_pairs_28d', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'agg_basket_pairs_28d store foreign key carries tenant_id');

select col_type_is('public', 'agg_daily_sales', 'net_amount', 'numeric(14,2)', 'agg_daily_sales.net_amount is numeric(14,2)');
select col_type_is('public', 'agg_daily_sales', 'items_sold', 'numeric(12,3)', 'agg_daily_sales.items_sold is numeric(12,3)');
select col_type_is('public', 'agg_category_daily', 'role', 'item_type_role', 'agg_category_daily.role uses the enum');
select col_type_is('public', 'agg_payment_daily', 'kind', 'payment_kind', 'agg_payment_daily.kind uses the enum');
select col_type_is('public', 'agg_daily_sales', 'identified_invoices', 'integer', 'agg_daily_sales.identified_invoices counts invoices with a phone or a customer id');
select col_type_is('public', 'agg_daily_sales', 'voided_amount', 'numeric(14,2)', 'agg_daily_sales.voided_amount is numeric(14,2)');
select col_is_null('public', 'agg_attach_daily', 'attach_rate_topping', 'agg_attach_daily.attach_rate_topping may be null when unmeasured');

select has_function('app', 'is_holiday', array['uuid', 'text', 'date'], 'app.is_holiday exists');
select has_function('app', 'tet_window', array['uuid', 'text', 'date'], 'app.tet_window exists');
select has_function('app', 'is_excluded_day', array['uuid[]', 'date'], 'app.is_excluded_day exists');
select has_function('app', 'refresh_analytics', array['uuid', 'date', 'date'], 'app.refresh_analytics exists');
select has_function('app', 'sales_invoices', array['uuid', 'date', 'date', 'uuid[]'], 'app.sales_invoices takes a tenant, a range and optional stores');
select has_function('app', 'daily_sales_facts', array['uuid', 'date', 'date', 'uuid[]'], 'app.daily_sales_facts takes a tenant, a range and optional stores');
select has_function('app', 'hourly_sales_facts', array['uuid', 'date', 'date', 'uuid[]'], 'app.hourly_sales_facts takes a tenant, a range and optional stores');
select has_function('app', 'daily_sales', array['uuid[]', 'date', 'date'], 'app.daily_sales exists');
select has_function('app', 'daily_net_series', array['uuid[]', 'date', 'date'], 'app.daily_net_series exists');
select has_function('app', 'analytics_live_from', 'app.analytics_live_from exists');
select has_function('app', 'analytics_as_of', array['uuid[]', 'timestamp with time zone'], 'app.analytics_as_of takes stores and an instant');
select has_function('public', 'refresh_my_analytics', array['date', 'date', 'uuid'], 'public.refresh_my_analytics exists');
select has_function('public', 'same_weekday_baseline', array['uuid[]', 'date', 'integer'], 'public.same_weekday_baseline exists');
select has_function('public', 'period_summary', array['uuid[]', 'date', 'date'], 'public.period_summary exists');
select has_function('public', 'period_compare', array['uuid[]', 'text', 'date'], 'public.period_compare exists');
select has_function('public', 'weekday_profile_forecast', array['uuid[]', 'date', 'date'], 'public.weekday_profile_forecast takes stores, a target and an origin');
select has_function('public', 'seasonal_naive_forecast', array['uuid[]', 'date', 'date'], 'public.seasonal_naive_forecast takes stores, a target and an origin');
select has_function('public', 'month_pace', array['uuid[]', 'date', 'date'], 'public.month_pace takes stores, a month and an as-of date');
select has_function('public', 'forecast_accuracy', array['uuid[]', 'date', 'integer'], 'public.forecast_accuracy exists');
select has_function('public', 'hour_weekday_heatmap', array['uuid[]', 'date', 'date'], 'public.hour_weekday_heatmap exists');
select has_function('public', 'item_velocity', array['uuid[]', 'date'], 'public.item_velocity exists');
select has_function('public', 'menu_matrix', array['uuid[]', 'date', 'numeric'], 'public.menu_matrix exists');
select has_function('public', 'cash_variance_flags', array['uuid[]', 'date', 'date', 'numeric', 'numeric'], 'public.cash_variance_flags exists');

select is((select count(*) from public.dim_calendar), 2922::bigint, 'dim_calendar covers 2023-01-01 to 2030-12-31');
select is((select weekday from public.dim_calendar where calendar_date = '2026-11-07'), 6::smallint, '2026-11-07 is a Saturday, weekday 6');
select is((select (iso_year, iso_week) from public.dim_calendar where calendar_date = '2024-12-30'), (2025, 1::smallint), '2024-12-30 belongs to ISO week 1 of 2025');
select is((select (month_start, quarter, is_weekend) from public.dim_calendar where calendar_date = '2026-11-08'), ('2026-11-01'::date, 4::smallint, true), 'month start, quarter and weekend flag are derived');

select is(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.v_recent_daily_sales'::regclass),
  true,
  'v_recent_daily_sales runs with the privileges of the invoker'
);
select is(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.v_recent_hourly_sales'::regclass),
  true,
  'v_recent_hourly_sales runs with the privileges of the invoker'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'agg\_%'),
  10,
  'every aggregate table has exactly one policy'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'agg\_%' and cmd <> 'SELECT'),
  0,
  'aggregate tables have no write policy'
);
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'refresh_analytics'),
  true,
  'app.refresh_analytics is security definer'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('same_weekday_baseline', 'period_summary', 'period_compare', 'weekday_profile_forecast', 'seasonal_naive_forecast', 'month_pace', 'forecast_accuracy', 'hour_weekday_heatmap', 'item_velocity', 'menu_matrix', 'cash_variance_flags')
      and (p.prosecdef or p.provolatile <> 's')
  ),
  0,
  'every query function is security invoker and stable'
);
select is(has_function_privilege('authenticated', 'app.refresh_analytics(uuid, date, date)', 'execute'), false, 'authenticated cannot execute app.refresh_analytics');
select is(has_function_privilege('service_role', 'app.refresh_analytics(uuid, date, date)', 'execute'), true, 'service_role can execute app.refresh_analytics');
select is(has_function_privilege('anon', 'public.forecast_accuracy(uuid[], date, integer)', 'execute'), false, 'anon cannot execute forecast_accuracy');
select is(has_function_privilege('authenticated', 'public.month_pace(uuid[], date, date)', 'execute'), true, 'authenticated can execute month_pace');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('weekday_profile_forecast', 'seasonal_naive_forecast', 'month_pace')),
  3,
  'each forecast function has a single signature'
);

select * from finish();
rollback;
