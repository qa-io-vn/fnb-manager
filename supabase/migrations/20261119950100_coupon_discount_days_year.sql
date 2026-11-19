-- Robustness fix found by the security test pack (pgTAP 123_security_input_abuse.sql).
--
-- coupon_discount_days built the year's last day with make_date before item_discount_days checked the year, so a
-- year such as 0 or 2147483647 failed with 22008 (datetime field overflow) instead of the documented 22023. The year
-- is now checked first, with the floor item_discount_days uses (2023) and at most next year, which item_discount_days
-- narrows to the stores' current year as before.

create or replace function public.coupon_discount_days(p_coupon_id uuid, p_calendar_year integer)
returns table (
  item_external_id text,
  item_name text,
  price_discount_days integer,
  line_price_discount_days integer,
  bill_discount_days integer,
  gift_days integer,
  voucher_days integer,
  limit_days integer,
  over_limit boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_coupon public.coupons%rowtype;
  v_country text;
  v_timezone text;
  v_store_ids uuid[];
  v_limit integer;
begin
  if p_calendar_year is null or p_calendar_year < 2023 or p_calendar_year > extract(year from now())::integer + 1 then
    raise exception 'coupon_discount_days needs a calendar_year from 2023 to the current year' using errcode = '22023';
  end if;
  select c.* into v_coupon from public.coupons c where c.id = p_coupon_id;
  if not found then
    raise exception 'coupon_discount_days needs a reward the caller reads' using errcode = '22023';
  end if;
  select t.country_code, t.timezone into v_country, v_timezone from public.tenants t where t.id = v_coupon.tenant_id;
  v_store_ids := coalesce(
    v_coupon.store_ids,
    array(select s.id from public.stores s where s.tenant_id = v_coupon.tenant_id and s.active order by s.id limit 50)
  );
  v_limit := app.promotion_discount_days_limit(
    v_country,
    least(make_date(p_calendar_year, 12, 31), (now() at time zone coalesce(v_timezone, 'UTC'))::date)
  );
  return query
  select
    d.item_external_id,
    d.item_name,
    d.price_discount_days,
    d.line_price_discount_days,
    d.bill_discount_days,
    d.gift_days,
    d.voucher_days,
    v_limit,
    v_limit is not null and d.price_discount_days > v_limit
  from public.item_discount_days(v_store_ids, p_calendar_year) d
  where (v_coupon.reward_item_external_ids is null or d.item_external_id = any (v_coupon.reward_item_external_ids))
    and not (d.item_external_id = any (v_coupon.excluded_item_external_ids))
  order by d.price_discount_days desc, d.item_external_id collate "C";
end;
$$;
