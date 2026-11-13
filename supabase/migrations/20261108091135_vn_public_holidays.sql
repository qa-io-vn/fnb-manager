insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select null::uuid, 'VN', v.holiday_date::date, v.name, v.kind::public.holiday_kind
from (
  values
    ('2024-01-01', 'New Year''s Day', 'public'),
    ('2024-02-08', 'Tet, 29th of the last lunar month', 'tet'),
    ('2024-02-09', 'Tet, last day of the lunar year', 'tet'),
    ('2024-02-10', 'Tet, day 1', 'tet'),
    ('2024-02-11', 'Tet, day 2', 'tet'),
    ('2024-02-12', 'Tet, day 3', 'tet'),
    ('2024-02-13', 'Tet, day 4', 'tet'),
    ('2024-02-14', 'Tet, day 5', 'tet'),
    ('2024-04-18', 'Hung Kings Commemoration Day', 'public'),
    ('2024-04-30', 'Reunification Day', 'public'),
    ('2024-05-01', 'International Labour Day', 'public'),
    ('2024-09-02', 'National Day', 'public'),
    ('2024-09-03', 'National Day adjacent holiday', 'public'),
    ('2025-01-01', 'New Year''s Day', 'public'),
    ('2025-01-28', 'Tet, last day of the lunar year', 'tet'),
    ('2025-01-29', 'Tet, day 1', 'tet'),
    ('2025-01-30', 'Tet, day 2', 'tet'),
    ('2025-01-31', 'Tet, day 3', 'tet'),
    ('2025-02-01', 'Tet, day 4', 'tet'),
    ('2025-02-02', 'Tet, day 5', 'tet'),
    ('2025-04-07', 'Hung Kings Commemoration Day', 'public'),
    ('2025-04-30', 'Reunification Day', 'public'),
    ('2025-05-01', 'International Labour Day', 'public'),
    ('2025-09-01', 'National Day adjacent holiday', 'public'),
    ('2025-09-02', 'National Day', 'public'),
    ('2026-01-01', 'New Year''s Day', 'public'),
    ('2026-02-16', 'Tet, last day of the lunar year', 'tet'),
    ('2026-02-17', 'Tet, day 1', 'tet'),
    ('2026-02-18', 'Tet, day 2', 'tet'),
    ('2026-02-19', 'Tet, day 3', 'tet'),
    ('2026-02-20', 'Tet, day 4', 'tet'),
    ('2026-02-21', 'Tet, day 5', 'tet'),
    ('2026-04-26', 'Hung Kings Commemoration Day', 'public'),
    ('2026-04-30', 'Reunification Day', 'public'),
    ('2026-05-01', 'International Labour Day', 'public'),
    ('2026-09-01', 'National Day adjacent holiday', 'public'),
    ('2026-09-02', 'National Day', 'public'),
    ('2027-01-01', 'New Year''s Day', 'public'),
    ('2027-02-05', 'Tet, last day of the lunar year', 'tet'),
    ('2027-02-06', 'Tet, day 1', 'tet'),
    ('2027-02-07', 'Tet, day 2', 'tet'),
    ('2027-02-08', 'Tet, day 3', 'tet'),
    ('2027-02-09', 'Tet, day 4', 'tet'),
    ('2027-02-10', 'Tet, day 5', 'tet'),
    ('2027-04-16', 'Hung Kings Commemoration Day', 'public'),
    ('2027-04-30', 'Reunification Day', 'public'),
    ('2027-05-01', 'International Labour Day', 'public'),
    ('2027-09-02', 'National Day', 'public'),
    ('2027-09-03', 'National Day adjacent holiday', 'public'),
    ('2028-01-01', 'New Year''s Day', 'public'),
    ('2028-01-25', 'Tet, last day of the lunar year', 'tet'),
    ('2028-01-26', 'Tet, day 1', 'tet'),
    ('2028-01-27', 'Tet, day 2', 'tet'),
    ('2028-01-28', 'Tet, day 3', 'tet'),
    ('2028-01-29', 'Tet, day 4', 'tet'),
    ('2028-01-30', 'Tet, day 5', 'tet'),
    ('2028-04-04', 'Hung Kings Commemoration Day', 'public'),
    ('2028-04-30', 'Reunification Day', 'public'),
    ('2028-05-01', 'International Labour Day', 'public'),
    ('2028-09-01', 'National Day adjacent holiday', 'public'),
    ('2028-09-02', 'National Day', 'public')
) as v (holiday_date, name, kind)
where not exists (
  select 1
  from public.holidays h
  where h.tenant_id is null
    and h.country_code = 'VN'
    and h.holiday_date = v.holiday_date::date
    and h.name = v.name
);
