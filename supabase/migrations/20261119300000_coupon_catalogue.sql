create type public.coupon_reward_kind as enum ('free_item', 'percent_off', 'amount_off', 'free_upgrade');
create type public.coupon_status as enum ('draft', 'approved', 'active', 'retired');

alter table public.coupons
  add column reward_kind public.coupon_reward_kind not null default 'free_item',
  add column reward_percent numeric(5, 2),
  add column reward_amount numeric(14, 2),
  add column reward_item_external_ids text[],
  add column excluded_item_external_ids text[] not null default '{}',
  add column description text,
  add column valid_from date,
  add column valid_until date,
  add column per_member_limit smallint,
  add column status public.coupon_status not null default 'draft',
  add column approved_by uuid references auth.users (id) on delete set null,
  add column approved_at timestamptz,
  add constraint coupons_reward_percent_check check (reward_percent is null or (reward_percent > 0 and reward_percent <= 100)),
  add constraint coupons_reward_amount_check check (reward_amount is null or (reward_amount > 0 and reward_amount <= 100000000)),
  add constraint coupons_reward_terms_check check (
    case reward_kind
      when 'percent_off' then reward_percent is not null and reward_amount is null
      when 'amount_off' then reward_amount is not null and reward_percent is null
      else reward_percent is null and reward_amount is null
    end
  ),
  add constraint coupons_reward_items_check check (
    reward_item_external_ids is null
    or (cardinality(reward_item_external_ids) between 1 and 50 and array_position(reward_item_external_ids, null) is null)
  ),
  add constraint coupons_excluded_items_check check (
    cardinality(excluded_item_external_ids) <= 100 and array_position(excluded_item_external_ids, null) is null
  ),
  add constraint coupons_description_check check (
    description is null or (char_length(description) between 1 and 500 and translate(description, E'\n', '') !~ '[[:cntrl:]]')
  ),
  add constraint coupons_validity_check check (valid_from is null or valid_until is null or valid_until >= valid_from),
  add constraint coupons_per_member_limit_check check (per_member_limit is null or per_member_limit between 1 and 100);

comment on column public.coupons.reward_kind is 'what the reward gives: free_item (an item free, a gift), percent_off (reward_percent off the bill or the reward items), amount_off (reward_amount off a bill of at least min_bill_amount) or free_upgrade (a larger size or an extra, a gift); no cash-like kind (payout, stored value, top-up) exists (FR-CMP-13)';
comment on column public.coupons.reward_percent is 'the percentage of a percent_off reward, at most the dated discount cap (FR-CMP-12)';
comment on column public.coupons.reward_amount is 'the amount of an amount_off reward, at most the dated discount cap times min_bill_amount, the price it reduces (FR-CMP-12)';
comment on column public.coupons.reward_item_external_ids is 'the POS items (external ids) the reward gives or discounts; null for the whole bill';
comment on column public.coupons.excluded_item_external_ids is 'POS items (external ids) the reward never discounts';
comment on column public.coupons.valid_from is 'first business day the reward may be redeemed (fixed dates); null for no start';
comment on column public.coupons.valid_until is 'last business day the reward may be redeemed (fixed dates); null for no end; valid_days still bounds each hold after issue';
comment on column public.coupons.per_member_limit is 'how many held or confirmed redemptions one membership may have of this reward; null for no limit';
comment on column public.coupons.status is 'draft, approved (by an owner), active (in the catalogue; active mirrors it) or retired (final)';
comment on column public.coupons.approved_by is 'the owner who approved the reward''s current terms; null when the service role or the database owner approved it';

update public.coupons
set status = case when active then 'active'::public.coupon_status else 'draft'::public.coupon_status end,
    approved_at = case when active then updated_at end
where status = 'draft';

alter table public.coupons
  add constraint coupons_status_active_check check (active = (status = 'active')),
  add constraint coupons_approval_check check (status not in ('approved', 'active') or approved_at is not null);

create function app.promotion_discount_cap(p_country_code text, p_from date, p_to date)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select min(r.max_discount_rate)
  from (
    values
      ('VN', date '2018-05-22', date '2025-06-30', 0.5::numeric),
      ('VN', date '2025-07-01', null::date, 0.5::numeric)
  ) as r (country_code, valid_from, valid_to, max_discount_rate)
  where r.country_code = upper(btrim(p_country_code))
    and r.valid_from <= coalesce(p_to, 'infinity'::date)
    and coalesce(r.valid_to, 'infinity'::date) >= coalesce(p_from, '-infinity'::date);
$$;

comment on function app.promotion_discount_cap(text, date, date) is 'the lowest maximum discount rate of the dated discount_cap rules of a country in force on any day from p_from to p_to (null ends are open); null when no rule applies; mirrors the discount_cap rules of promotionRules in @fnb/core (Decree 81/2018 Article 7 to 30 June 2025, Circular 39/2025/TT-BCT Article 4 from 1 July 2025), so a change there needs a migration here';

create function app.promotion_discount_days_limit(p_country_code text, p_on date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select min(r.max_days)
  from (
    values ('VN', date '2018-05-22', date '2026-06-25', 120)
  ) as r (country_code, valid_from, valid_to, max_days)
  where r.country_code = upper(btrim(p_country_code))
    and r.valid_from <= p_on
    and coalesce(r.valid_to, 'infinity'::date) >= p_on;
$$;

comment on function app.promotion_discount_days_limit(text, date) is 'the discount-days limit per item and year of the dated discount_days rule of a country in force on a day, or null when none is (Decree 239/2026 is reported to repeal it from 26 June 2026); mirrors promotionRules in @fnb/core; information only, it never blocks a save';

create function app.coupon_stores_without_rail(p_tenant_id uuid, p_store_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  from public.stores s
  where s.tenant_id = p_tenant_id
    and (p_store_ids is null or s.id = any (p_store_ids))
    and (p_store_ids is not null or s.active)
    and not exists (
      select 1 from public.coupon_rails r
      where r.store_id = s.id
        and r.active_until is null
    );
$$;

comment on function app.coupon_stores_without_rail(uuid, uuid[]) is 'the stores of a reward''s scope (the listed stores, or every active store of the tenant for null) without an active coupon_rails row';

create function app.guard_coupon_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_country text;
  v_timezone text;
  v_today date;
  v_cap numeric;
  v_item text;
  v_terms_changed boolean := false;
begin
  new.description := nullif(btrim(new.description), '');
  new.reward_item_external_ids := case when new.reward_item_external_ids is null then null
    else (select array_agg(btrim(i) order by o) from unnest(new.reward_item_external_ids) with ordinality as u (i, o)) end;
  new.excluded_item_external_ids := coalesce((select array_agg(btrim(i) order by o) from unnest(new.excluded_item_external_ids) with ordinality as u (i, o)), '{}'::text[]);
  foreach v_item in array coalesce(new.reward_item_external_ids, '{}'::text[]) || new.excluded_item_external_ids loop
    if v_item is null or char_length(v_item) not between 1 and 100 or v_item ~ '[[:cntrl:]]' then
      raise exception 'each reward or excluded item is a POS item external id of 1 to 100 characters' using errcode = '22023';
    end if;
  end loop;
  if new.reward_item_external_ids is not null and new.reward_item_external_ids && new.excluded_item_external_ids then
    raise exception 'an item is either a reward item or an excluded item' using errcode = '22023';
  end if;

  select t.country_code, t.timezone into v_country, v_timezone from public.tenants t where t.id = new.tenant_id;
  v_today := (now() at time zone coalesce(v_timezone, 'UTC'))::date;
  if new.reward_kind in ('percent_off', 'amount_off') then
    v_cap := app.promotion_discount_cap(v_country, coalesce(new.valid_from, v_today), new.valid_until);
    if v_cap is not null and new.reward_kind = 'percent_off' and new.reward_percent > v_cap * 100 then
      raise exception 'a price-reducing reward gives at most % %% off the price it reduces (FR-CMP-12)', round(v_cap * 100) using errcode = '22023';
    end if;
    if v_cap is not null and new.reward_kind = 'amount_off' then
      if new.min_bill_amount <= 0 then
        raise exception 'an amount-off reward names the minimum bill it reduces, so the discount cap can be checked (FR-CMP-12)' using errcode = '22023';
      end if;
      if new.reward_amount > v_cap * new.min_bill_amount then
        raise exception 'an amount-off reward gives at most % %% of its minimum bill (FR-CMP-12)', round(v_cap * 100) using errcode = '22023';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'retired' then
      raise exception 'a new reward starts as a draft, approved or active' using errcode = '22023';
    end if;
    if new.active and new.status = 'draft' then
      new.status := 'active';
    end if;
  else
    if old.status = 'retired' and new.status is distinct from 'retired' then
      raise exception 'a retired reward stays retired: create a new one' using errcode = '22023';
    end if;
    if new.status is not distinct from old.status and new.active is distinct from old.active then
      new.status := case when new.active then 'active'::public.coupon_status
        when old.status = 'active' then 'approved'::public.coupon_status
        else old.status end;
    end if;
    v_terms_changed := (new.programme_id, new.reward_key, new.reward_kind, new.reward_percent, new.reward_amount, new.reward_item_external_ids,
        new.excluded_item_external_ids, new.cost_stamps, new.cost_points, new.min_bill_amount, new.valid_days, new.hold_hours,
        new.valid_from, new.valid_until, new.per_member_limit)
      is distinct from (old.programme_id, old.reward_key, old.reward_kind, old.reward_percent, old.reward_amount, old.reward_item_external_ids,
        old.excluded_item_external_ids, old.cost_stamps, old.cost_points, old.min_bill_amount, old.valid_days, old.hold_hours,
        old.valid_from, old.valid_until, old.per_member_limit);
    if v_terms_changed and old.status in ('approved', 'active') and new.status = old.status
      and v_uid is not null and not app.has_store_scope(new.tenant_id, null, array['owner']::public.tenant_role[])
    then
      new.status := 'draft';
    end if;
  end if;

  if new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  elsif new.status in ('approved', 'active')
    and (tg_op = 'INSERT' or old.status not in ('approved', 'active') or v_terms_changed or old.approved_at is null)
  then
    if v_uid is not null then
      if not app.has_store_scope(new.tenant_id, null, array['owner']::public.tenant_role[]) then
        raise exception 'only an owner with every store approves a reward' using errcode = '42501';
      end if;
      new.approved_by := v_uid;
      new.approved_at := now();
    else
      new.approved_at := coalesce(new.approved_at, now());
    end if;
  elsif tg_op = 'UPDATE' then
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  new.active := new.status = 'active';

  if new.active and cardinality(app.coupon_stores_without_rail(new.tenant_id, new.store_ids)) > 0 then
    raise exception 'a reward is active only when every store in its scope has a coupon rail (coupon_rails)' using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function app.guard_coupon_terms() is 'trigger on coupons before app.guard_coupon, for every writer: trims the description and the item lists, refuses a percent_off above the dated discount cap and an amount_off above the cap times its minimum bill (or without one), keeps active equal to status = active (an old writer setting active moves the status), keeps retired final, records the approval (approved_by the owner, or the service role and database owner without one) when a reward leaves draft or an approved reward''s terms change, sends a reward whose terms a manager changes back to draft, refuses approval by anyone but an owner with every store (42501) and refuses an active reward while a store of its scope has no active coupon_rails row (22023)';

create trigger coupons_check_terms
before insert or update on public.coupons
for each row execute function app.guard_coupon_terms();

create function public.coupon_discount_days(p_coupon_id uuid, p_calendar_year integer)
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

comment on function public.coupon_discount_days(uuid, integer) is 'information only (FR-CMP-12): the discount days of a calendar year of the items a reward discounts (its reward items, or every item but the excluded ones), from item_discount_days over the reward''s stores (every active store for a tenant-wide reward, at most 50), with the dated discount-days limit in force at the year''s end or today and whether an item is over it; never blocks a save; as the caller';

revoke all on function app.promotion_discount_cap(text, date, date) from public, anon;
revoke all on function app.promotion_discount_days_limit(text, date) from public, anon;
revoke all on function app.coupon_stores_without_rail(uuid, uuid[]) from public, anon, authenticated;
revoke all on function app.guard_coupon_terms() from public, anon, authenticated;
revoke all on function public.coupon_discount_days(uuid, integer) from public, anon;

grant execute on function app.promotion_discount_cap(text, date, date) to authenticated, service_role;
grant execute on function app.promotion_discount_days_limit(text, date) to authenticated, service_role;
grant execute on function app.coupon_stores_without_rail(uuid, uuid[]) to service_role;
grant execute on function public.coupon_discount_days(uuid, integer) to authenticated, service_role;
