create or replace function app.guard_coupon_terms()
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
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and old.approved_by is not null
    and new.approved_by is null
    and to_jsonb(new) - 'approved_by' = to_jsonb(old) - 'approved_by'
    and not exists (select 1 from auth.users u where u.id = old.approved_by)
  then
    return new;
  end if;

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

comment on function app.guard_coupon_terms() is 'trigger on coupons before app.guard_coupon, for every writer: trims the description and the item lists, refuses a percent_off above the dated discount cap and an amount_off above the cap times its minimum bill (or without one), keeps active equal to status = active (an old writer setting active moves the status), keeps retired final, records the approval (approved_by the owner, or the service role and database owner without one) when a reward leaves draft or an approved reward''s terms change, sends a reward whose terms a manager changes back to draft, refuses approval by anyone but an owner with every store (42501) and refuses an active reward while a store of its scope has no active coupon_rails row (22023); a writer that clears or rewrites approved_by itself gets the approver back, and only the referential SET NULL of approved_by after the approving Auth user was deleted (inside a trigger, nothing else changed, the user gone) passes untouched, so the reward keeps its status and approved_at';

create or replace function app.guard_coupon_rail_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and (
      not exists (select 1 from public.tenants t where t.id = old.tenant_id)
      or not exists (select 1 from public.stores s where s.id = old.store_id)
    )
  then
    return old;
  end if;
  if old.active
    and (tg_op = 'DELETE' or not new.active or new.reward_key is distinct from old.reward_key or new.store_id is distinct from old.store_id)
    and exists (
      select 1
      from public.coupons c
      where c.tenant_id = old.tenant_id
        and c.reward_key = old.reward_key
        and c.active
        and (c.store_ids is null or old.store_id = any (c.store_ids))
    )
  then
    raise exception 'an active reward keeps its e-invoice mapping at every store in its scope: deactivate the reward first' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function app.guard_coupon_rail_reward() is 'trigger before an update or delete of coupon_rail_rewards: refuses (22023) deactivating, deleting or moving the active mapping of a reward that an active coupons row of its store still needs; the cascade of a deleted tenant or store passes (the tenant or the store is already gone), as app.keep_loyalty_ledger lets a deleted tenant''s rows go';
