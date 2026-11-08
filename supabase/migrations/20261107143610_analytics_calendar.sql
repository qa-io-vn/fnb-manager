create table public.dim_calendar (
  calendar_date date primary key,
  iso_year integer not null,
  iso_week smallint not null,
  weekday smallint not null check (weekday between 1 and 7),
  month_start date not null,
  quarter smallint not null check (quarter between 1 and 4),
  is_weekend boolean not null
);

comment on column public.dim_calendar.weekday is 'ISO weekday, 1 is Monday and 7 is Sunday';

insert into public.dim_calendar (calendar_date, iso_year, iso_week, weekday, month_start, quarter, is_weekend)
select
  d::date,
  extract(isoyear from d)::integer,
  extract(week from d)::smallint,
  extract(isodow from d)::smallint,
  date_trunc('month', d)::date,
  extract(quarter from d)::smallint,
  extract(isodow from d) in (6, 7)
from generate_series('2023-01-01'::date, '2030-12-31'::date, interval '1 day') as d;

create index dim_calendar_iso_year_week_idx on public.dim_calendar (iso_year, iso_week);
create index dim_calendar_month_start_idx on public.dim_calendar (month_start);

alter table public.dim_calendar enable row level security;

create policy dim_calendar_select_for_authenticated on public.dim_calendar
  for select to authenticated
  using (true);

create or replace function app.is_holiday(tenant_id uuid, country_code text, d date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.holidays h
    where h.country_code = is_holiday.country_code
      and h.holiday_date = is_holiday.d
      and (h.tenant_id is null or h.tenant_id = is_holiday.tenant_id)
  );
$$;

create or replace function app.tet_window(tenant_id uuid, country_code text, d date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.holidays first_day
    join public.holidays last_day
      on last_day.country_code = first_day.country_code
      and last_day.kind = 'tet'
      and (last_day.tenant_id is null or last_day.tenant_id = tet_window.tenant_id)
      and last_day.holiday_date between first_day.holiday_date and first_day.holiday_date + 14
    where first_day.country_code = tet_window.country_code
      and first_day.kind = 'tet'
      and (first_day.tenant_id is null or first_day.tenant_id = tet_window.tenant_id)
      and tet_window.d between first_day.holiday_date and last_day.holiday_date
  );
$$;

create or replace function app.is_excluded_day(store_ids uuid[], d date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.tenants t on t.id = s.tenant_id
    where s.id = any (is_excluded_day.store_ids)
      and (
        app.is_holiday(t.id, t.country_code, is_excluded_day.d)
        or app.tet_window(t.id, t.country_code, is_excluded_day.d)
      )
  );
$$;

revoke all on function app.is_holiday(uuid, text, date) from public;
revoke all on function app.tet_window(uuid, text, date) from public;
revoke all on function app.is_excluded_day(uuid[], date) from public;
grant execute on function app.is_holiday(uuid, text, date) to authenticated, service_role;
grant execute on function app.tet_window(uuid, text, date) to authenticated, service_role;
grant execute on function app.is_excluded_day(uuid[], date) to authenticated, service_role;
