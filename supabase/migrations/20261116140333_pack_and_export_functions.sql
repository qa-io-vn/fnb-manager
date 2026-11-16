create function public.store_profiles(store_ids uuid[])
returns table (
  store_id uuid,
  tenant_id uuid,
  label text,
  name text,
  timezone text,
  business_day_start_minutes integer,
  opened_on date,
  opening_hours jsonb,
  seat_count integer,
  e_invoice_status public.e_invoice_status,
  currency_code text,
  country_code text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform app.require_store_ids('store_profiles', store_profiles.store_ids);
  return query
  with requested as (
    select v.store_id as requested_id, v.store_position
    from app.visible_stores(store_profiles.store_ids) v
  ),
  ranked as (
    select s.id as ranked_id,
           'S' || row_number() over (partition by s.tenant_id order by s.first_seen_at, s.id) as store_label
    from public.stores s
    where s.tenant_id in (
      select s2.tenant_id
      from public.stores s2
      join requested q on q.requested_id = s2.id
    )
  )
  select s.id, s.tenant_id, k.store_label, s.name, s.timezone, s.business_day_start_minutes, s.opened_on,
         s.opening_hours, s.seat_count, s.e_invoice_status, t.currency_code, t.country_code
  from requested q
  join public.stores s on s.id = q.requested_id
  join ranked k on k.ranked_id = s.id
  join public.tenants t on t.id = s.tenant_id
  order by q.store_position;
end;
$$;

create function public.metric_windows(store_ids uuid[], metric_ids text[], from_dates date[], to_dates date[])
returns table (range_index smallint, from_date date, to_date date, metric_id text, value numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_metric_ids constant integer := 25;
  max_ranges constant integer := 12;
  max_days constant integer := 400;
  range_count integer;
begin
  perform app.require_store_ids('metric_windows', metric_windows.store_ids);
  if metric_windows.metric_ids is null
    or cardinality(metric_windows.metric_ids) not between 1 and max_metric_ids
    or array_position(metric_windows.metric_ids, null) is not null then
    raise exception using
      errcode = '22023',
      message = format('metric_windows needs 1 to %s metric ids', max_metric_ids);
  end if;
  range_count := coalesce(cardinality(metric_windows.from_dates), 0);
  if range_count not between 1 and max_ranges
    or coalesce(cardinality(metric_windows.to_dates), 0) <> range_count then
    raise exception using
      errcode = '22023',
      message = format('metric_windows needs 1 to %s ranges and as many to_dates as from_dates', max_ranges);
  end if;
  for position_index in 1 .. range_count loop
    perform app.require_date_range(
      'metric_windows',
      metric_windows.from_dates[position_index],
      metric_windows.to_dates[position_index],
      max_days
    );
  end loop;
  if cardinality(metric_windows.store_ids) = 0 then
    return;
  end if;
  return query
  select r.range_position::smallint, r.range_from, r.range_to, m.requested_id,
         public.metric_value(metric_windows.store_ids, m.requested_id, r.range_from, r.range_to)
  from unnest(metric_windows.from_dates, metric_windows.to_dates) with ordinality as r (range_from, range_to, range_position)
  cross join unnest(metric_windows.metric_ids) with ordinality as m (requested_id, id_position)
  order by r.range_position, m.id_position;
end;
$$;

create function public.holiday_calendar(store_ids uuid[], from_date date, to_date date)
returns table (holiday_date date, name text, kind public.holiday_kind)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  returned_rows bigint;
begin
  perform app.require_store_ids('holiday_calendar', holiday_calendar.store_ids);
  perform app.require_date_range('holiday_calendar', holiday_calendar.from_date, holiday_calendar.to_date, 400);
  return query
  select q.on_date, q.title, q.day_kind
  from (
    select distinct h.holiday_date as on_date, h.name as title, h.kind as day_kind
    from (
      select distinct s.tenant_id as owner_tenant, t.country_code as owner_country
      from app.visible_stores(holiday_calendar.store_ids) v
      join public.stores s on s.id = v.store_id
      join public.tenants t on t.id = s.tenant_id
    ) o
    join public.holidays h
      on h.country_code = o.owner_country
      and (h.tenant_id is null or h.tenant_id = o.owner_tenant)
    where h.holiday_date between holiday_calendar.from_date and holiday_calendar.to_date
  ) q
  order by q.on_date, q.title collate "C", q.day_kind;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('holiday_calendar', returned_rows);
end;
$$;

create function public.pack_fence(store_ids uuid[])
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  chosen uuid[];
  owners uuid[];
  signature text;
begin
  perform app.require_store_ids('pack_fence', pack_fence.store_ids);
  select coalesce(array_agg(v.store_id order by v.store_id), '{}')
  into chosen
  from app.visible_stores(pack_fence.store_ids) v;
  select coalesce(array_agg(distinct s.tenant_id), '{}')
  into owners
  from public.stores s
  where s.id = any (chosen);
  signature := concat_ws('|',
    (select count(*)::text || ':' || coalesce(max(r.finished_at)::text, '-') from public.analytics_refreshes r where r.tenant_id = any (owners)),
    (select coalesce(max(i.synced_at)::text, '-') from public.invoices i where i.store_id = any (chosen) and i.business_date >= app.analytics_live_from() - 3),
    (select coalesce(max(k.checked_at)::text, '-') from public.sync_checks k where k.store_id = any (chosen)),
    (select coalesce(string_agg(t.analytics_inputs_version::text || ':' || coalesce(t.analytics_inputs_changed_at::text, '-') || ':' || t.country_code || ':' || t.currency_code, ',' order by t.id), '-') from public.tenants t where t.id = any (owners)),
    (select count(*)::text || ':' || coalesce(max(x.updated_at)::text, '-') from public.item_costs x where x.tenant_id = any (owners)),
    (select count(*)::text || ':' || coalesce(max(x.updated_at)::text, '-') from public.targets x where x.store_id = any (chosen)),
    (select count(*)::text || ':' || coalesce(max(x.updated_at)::text, '-') from public.holidays x where x.tenant_id = any (owners)),
    (select coalesce(max(x.updated_at)::text, '-') from public.report_settings x where x.tenant_id = any (owners)),
    (select coalesce(string_agg(md5(row(s.name, s.timezone, s.business_day_start_minutes, s.opening_hours, s.seat_count, s.opened_on, s.e_invoice_status, s.active)::text), ',' order by s.id), '-') from public.stores s where s.id = any (chosen))
  );
  return encode(sha256(convert_to(signature, 'UTF8')), 'hex');
end;
$$;

create function app.minor_units(amount numeric, scale integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select (minor_units.amount * power(10::numeric, minor_units.scale))::bigint::text;
$$;

create function app.fingerprint(lines text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(fingerprint.lines, ''), 'UTF8')), 'hex');
$$;

create function public.export_control_totals(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  invoices bigint,
  voided_invoices bigint,
  sales_net_amount numeric,
  invoice_fingerprint text,
  lines bigint,
  line_net_amount numeric,
  line_fingerprint text,
  payments bigint,
  payment_amount numeric,
  payment_fingerprint text,
  shifts bigint,
  shift_sales_amount numeric,
  shift_fingerprint text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform app.require_store_ids('export_control_totals', export_control_totals.store_ids);
  perform app.require_date_range('export_control_totals', export_control_totals.from_date, export_control_totals.to_date, 92);
  return query
  select v.store_id,
         inv.invoice_count, inv.voided_count, inv.sales_net, inv.digest,
         ln.line_count, ln.line_net, ln.digest,
         py.payment_count, py.payment_total, py.digest,
         sh.shift_count, sh.shift_sales, sh.digest
  from app.visible_stores(export_control_totals.store_ids) v
  join public.stores st on st.id = v.store_id
  cross join lateral (
    select count(*) as invoice_count,
           count(*) filter (where i.status = 'voided') as voided_count,
           coalesce(sum(i.net_amount) filter (where i.status <> 'voided'), 0) as sales_net,
           app.fingerprint(string_agg(
             concat_ws('|', i.id::text, i.status::text, app.minor_units(i.net_amount, 2), app.minor_units(i.gross_amount, 2), app.minor_units(i.paid_amount, 2), i.business_date::text),
             E'\n' order by i.id
           )) as digest
    from public.invoices i
    where i.store_id = v.store_id
      and i.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) inv
  cross join lateral (
    select count(*) as line_count,
           coalesce(sum(l.net_amount), 0) as line_net,
           app.fingerprint(string_agg(
             concat_ws('|', l.invoice_id::text, l.external_id, l.line_kind::text, app.minor_units(l.quantity, 3), app.minor_units(l.net_amount, 2)),
             E'\n' order by l.invoice_id, l.external_id collate "C"
           )) as digest
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    where i.store_id = v.store_id
      and i.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) ln
  cross join lateral (
    select count(*) as payment_count,
           coalesce(sum(p.amount), 0) as payment_total,
           app.fingerprint(string_agg(
             concat_ws('|', p.invoice_id::text, p.sequence_no::text, app.minor_units(p.amount, 2)),
             E'\n' order by p.invoice_id, p.sequence_no
           )) as digest
    from public.invoice_payments p
    where p.store_id = v.store_id
      and p.business_date between export_control_totals.from_date and export_control_totals.to_date
  ) py
  cross join lateral (
    select count(*) as shift_count,
           coalesce(sum(s.sales_amount), 0) as shift_sales,
           app.fingerprint(string_agg(
             concat_ws('|', s.id::text, app.minor_units(s.sales_amount, 2), coalesce(app.minor_units(s.cash_variance_amount, 2), '')),
             E'\n' order by s.id
           )) as digest
    from public.shifts s
    where s.store_id = v.store_id
      and ((s.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date
          between export_control_totals.from_date and export_control_totals.to_date
  ) sh
  order by v.store_position;
end;
$$;

revoke all on function public.store_profiles(uuid[]) from public, anon;
revoke all on function public.metric_windows(uuid[], text[], date[], date[]) from public, anon;
revoke all on function public.holiday_calendar(uuid[], date, date) from public, anon;
revoke all on function public.pack_fence(uuid[]) from public, anon;
revoke all on function public.export_control_totals(uuid[], date, date) from public, anon;
revoke all on function app.minor_units(numeric, integer) from public;
revoke all on function app.fingerprint(text) from public;
grant execute on function public.store_profiles(uuid[]) to authenticated, service_role;
grant execute on function public.metric_windows(uuid[], text[], date[], date[]) to authenticated, service_role;
grant execute on function public.holiday_calendar(uuid[], date, date) to authenticated, service_role;
grant execute on function public.pack_fence(uuid[]) to authenticated, service_role;
grant execute on function public.export_control_totals(uuid[], date, date) to authenticated, service_role;
grant execute on function app.minor_units(numeric, integer) to authenticated, service_role;
grant execute on function app.fingerprint(text) to authenticated, service_role;

comment on function public.store_profiles(uuid[]) is 'one row per visible store in the order asked: the stable label S<n> (rank among the tenant''s stores the caller can see, by first_seen_at then id, inactive stores keeping their place), zone, business-day start, opening date and hours, seats, e-invoicing, and the tenant''s currency and country; no address, code or POS id';
comment on function public.metric_windows(uuid[], text[], date[], date[]) is 'metric_value for 1 to 25 metric ids over 1 to 12 ranges of at most 400 days, the stores together, ordered by range then id; no rows for an empty store list; an id metric_value does not compute raises its 22023';
comment on function public.holiday_calendar(uuid[], date, date) is 'the global holidays of the visible stores'' tenant countries and the tenants'' own holidays between two dates (at most 400 days), one row per date, name and kind, ordered by date then name (collate "C")';
comment on function public.pack_fence(uuid[]) is 'a SHA-256 over the signals that move the data pack''s numbers for the visible stores (refreshes, recent synced invoices, sync checks, analytics inputs, costs, targets, tenant holidays, report settings, store profiles); the browser builds a pack between two equal fences';
comment on function app.minor_units(numeric, integer) is 'an amount scaled to an integer of minor units as text (2 for money, 3 for quantities), the form the export fingerprints use';
comment on function app.fingerprint(text) is 'the lowercase hex SHA-256 of a text in UTF-8, the empty text for null';
comment on function public.export_control_totals(uuid[], date, date) is 'per visible store over at most 92 days: counts, sums and SHA-256 fingerprints over canonical lines of invoices, invoice lines (by the invoice''s business date), payments (by their own business date) and shifts (by the business date of opened_at in the store''s zone after the day start), so an export proves it equals the tables';
