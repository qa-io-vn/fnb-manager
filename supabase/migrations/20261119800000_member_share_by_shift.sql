alter table public.invoices
  add column has_customer_phone boolean generated always as (customer_phone is not null) stored,
  add column has_customer_identity boolean generated always as (customer_phone is not null or customer_id is not null) stored;

comment on column public.invoices.has_customer_phone is 'whether the invoice carries a customer_phone (a member attached at the till with Thêm khách hàng); stored by the database from customer_phone, so a report counts member invoices without reading the phone itself, also once customer_phone loses its column grant';
comment on column public.invoices.has_customer_identity is 'whether the invoice carries a customer_phone or a customer_id; stored by the database, so a report counts identified invoices without reading either customer column';

create function public.member_share_by_shift(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  business_date date,
  shift_ordinal integer,
  opened_at timestamptz,
  closed_at timestamptz,
  invoices integer,
  member_invoices integer,
  identified_invoices integer,
  member_share numeric,
  identified_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_range_days constant integer := 92;
  returned_rows bigint;
begin
  perform app.require_store_ids('member_share_by_shift', member_share_by_shift.store_ids);
  perform app.require_date_range('member_share_by_shift', member_share_by_shift.from_date, member_share_by_shift.to_date, max_range_days);

  return query
  with visible as (
    select v.store_id as vs_store, v.store_position as vs_position, st.timezone as vs_zone, st.business_day_start_minutes as vs_day_start
    from app.visible_stores(member_share_by_shift.store_ids) v
    join public.stores st on st.id = v.store_id
  ),
  shift_days as (
    select
      sh.store_id as sd_store,
      sh.id as sd_id,
      sh.external_id as sd_external,
      sh.opened_at as sd_opened,
      sh.closed_at as sd_closed,
      ((sh.opened_at at time zone vs.vs_zone) - make_interval(mins => vs.vs_day_start))::date as sd_on
    from public.shifts sh
    join visible vs on vs.vs_store = sh.store_id
    where sh.opened_at >= (member_share_by_shift.from_date - 2)::timestamp at time zone 'UTC'
      and sh.opened_at < (member_share_by_shift.to_date + 3)::timestamp at time zone 'UTC'
  ),
  numbered as materialized (
    select
      sd.*,
      row_number() over (partition by sd.sd_store, sd.sd_on order by sd.sd_opened, sd.sd_external collate "C")::integer as sd_ordinal
    from shift_days sd
    where sd.sd_on between member_share_by_shift.from_date and member_share_by_shift.to_date
  ),
  shift_counts as (
    select
      n.sd_id as sc_shift,
      count(*)::integer as sc_invoices,
      (count(*) filter (where i.has_customer_phone))::integer as sc_members,
      (count(*) filter (where i.has_customer_identity))::integer as sc_identified
    from numbered n
    join public.invoices i on i.store_id = n.sd_store and i.shift_external_id = n.sd_external
    where i.status <> 'voided'
    group by n.sd_id
  ),
  unshifted as (
    select
      i.store_id as us_store,
      i.business_date as us_on,
      count(*)::integer as us_invoices,
      (count(*) filter (where i.has_customer_phone))::integer as us_members,
      (count(*) filter (where i.has_customer_identity))::integer as us_identified
    from public.invoices i
    join visible vs on vs.vs_store = i.store_id
    where i.business_date between member_share_by_shift.from_date and member_share_by_shift.to_date
      and i.status <> 'voided'
      and not exists (
        select 1
        from public.shifts sh
        where sh.store_id = i.store_id
          and sh.external_id = i.shift_external_id
      )
    group by i.store_id, i.business_date
  ),
  counted as (
    select
      n.sd_store as r_store,
      n.sd_on as r_on,
      n.sd_ordinal as r_ordinal,
      n.sd_opened as r_opened,
      n.sd_closed as r_closed,
      coalesce(sc.sc_invoices, 0) as r_invoices,
      coalesce(sc.sc_members, 0) as r_members,
      coalesce(sc.sc_identified, 0) as r_identified
    from numbered n
    left join shift_counts sc on sc.sc_shift = n.sd_id
    union all
    select us.us_store, us.us_on, null::integer, null::timestamptz, null::timestamptz, us.us_invoices, us.us_members, us.us_identified
    from unshifted us
  )
  select
    c.r_store,
    c.r_on,
    c.r_ordinal,
    c.r_opened,
    c.r_closed,
    c.r_invoices,
    c.r_members,
    c.r_identified,
    case when c.r_invoices > 0 then round(c.r_members::numeric / c.r_invoices, 6) end,
    case when c.r_invoices > 0 then round(c.r_identified::numeric / c.r_invoices, 6) end
  from counted c
  join visible vs on vs.vs_store = c.r_store
  order by c.r_on, vs.vs_position, c.r_ordinal nulls last;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('member_share_by_shift', returned_rows);
end;
$$;

comment on function public.member_share_by_shift(uuid[], date, date) is 'the phone-capture KPI of Ca & két tiền (#236, #237, FR-LOY-01): per store and shift of the range, the non-voided invoices, those with a customer_phone (member_invoices) and those with a customer_phone or a customer_id (identified_invoices), and both shares (null without an invoice). A shift belongs to the business date of its opening under the store''s day-start rule and is labelled by shift_ordinal, n of Ca {n}: its place by opening time, then external id, among the store''s shifts of that business date, as app.shift_number numbers it; a shift without invoices comes back with zeros. An invoice counts in the shift its shift_external_id names; an invoice naming no shift of its store counts in one row per store and business date of the invoice whose shift_ordinal, opened_at and closed_at are null (Không rõ ca). Rows come by business date, the order of store_ids, then shift_ordinal with that row last. The counts read the stored flags invoices.has_customer_phone and has_customer_identity, never the customer columns, and no column carries a phone, a customer id, a cashier name or the POS shift label. A report function: security invoker, 0 to 50 stores, at most 92 days and 900 rows (22023 otherwise); the caller''s revenue scope applies through the policies of invoices and shifts, so the publisher gets no row';

revoke all on function public.member_share_by_shift(uuid[], date, date) from public, anon;
grant execute on function public.member_share_by_shift(uuid[], date, date) to authenticated, service_role;
