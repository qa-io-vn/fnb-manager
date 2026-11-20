create function app.identified_metric_scope(p_store_ids uuid[], p_from date, p_to date)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid[];
begin
  if cardinality(app.current_user_loyalty_tenant_ids()) = 0 then
    raise exception using errcode = '42501', message = 'the customer metrics are for owners, managers and viewers';
  end if;
  if p_store_ids is null or cardinality(p_store_ids) not between 1 and 50 then
    raise exception 'the customer metrics take 1 to 50 stores' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'the customer metrics take a range of 1 to 366 days' using errcode = '22023';
  end if;
  select coalesce(array_agg(s), '{}'::uuid[]) into v_scope
  from unnest(p_store_ids) s
  where s = any (app.current_user_loyalty_store_ids());
  return v_scope;
end;
$$;

comment on function app.identified_metric_scope(uuid[], date, date) is 'checks the arguments of the customer metric functions (42501 unless the caller reads loyalty data as an owner, manager or viewer; 22023 for no store, more than 50 stores or a range outside 1 to 366 days) and returns the requested stores the caller may read';

create function public.customer_metrics(p_store_ids uuid[], p_from date, p_to date)
returns table (
  invoices integer,
  identified_invoices integer,
  customer_capture_rate numeric,
  customers integer,
  repeat_customers integer,
  repeat_rate numeric,
  active_customers_30d integer,
  visit_frequency_30d numeric,
  active_customers_90d integer,
  visit_frequency_90d numeric,
  outstanding_points integer,
  loyalty_liability numeric,
  breakage_rate numeric,
  member_revenue numeric,
  rewards_redeemed_value numeric,
  reward_cost_rate numeric,
  member_customers integer,
  comparison_customers integer,
  member_visit_frequency numeric,
  comparison_visit_frequency numeric,
  member_frequency_uplift numeric,
  uplift_comparison text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  min_group constant integer := 10;
  v_scope uuid[] := app.identified_metric_scope(p_store_ids, p_from, p_to);
  v_total integer;
  v_identified integer;
  v_visits integer;
begin
  select
    count(*)::integer,
    (count(*) filter (where i.has_customer_identity))::integer
  into v_total, v_identified
  from public.invoices i
  where i.store_id = any (v_scope)
    and i.business_date between p_from and p_to
    and i.status <> 'voided';
  invoices := v_total;
  identified_invoices := v_identified;
  customer_capture_rate := case when v_total > 0 then round(v_identified::numeric / v_total, 4) end;

  with visits as (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope)
      and i.customer_id is not null
      and i.business_date between p_from and p_to
      and i.status <> 'voided'
  ),
  per_customer as (
    select customer_id, count(*) as days from visits group by customer_id
  )
  select count(*)::integer, (count(*) filter (where days >= 2))::integer
  into customers, repeat_customers
  from per_customer;
  repeat_rate := case when customers > 0 then round(repeat_customers::numeric / customers, 4) end;

  select count(distinct v.customer_id)::integer, count(*)::integer
  into active_customers_30d, v_visits
  from (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope) and i.customer_id is not null and i.status <> 'voided'
      and i.business_date between p_to - 29 and p_to
  ) v;
  visit_frequency_30d := case when active_customers_30d > 0 then round(v_visits::numeric / active_customers_30d, 4) end;

  select count(distinct v.customer_id)::integer, count(*)::integer
  into active_customers_90d, v_visits
  from (
    select distinct i.customer_id, i.business_date
    from public.invoices i
    where i.store_id = any (v_scope) and i.customer_id is not null and i.status <> 'voided'
      and i.business_date between p_to - 89 and p_to
  ) v;
  visit_frequency_90d := case when active_customers_90d > 0 then round(v_visits::numeric / active_customers_90d, 4) end;

  select
    case when count(p.id) = 0 then null else coalesce(sum(b.points), 0)::integer end,
    case when count(p.id) = 0 then null else round(coalesce(sum(b.points * p.point_value_amount * (1 - p.expected_breakage_rate)), 0), 2) end,
    case when coalesce(sum(b.matured), 0) > 0 then round(coalesce(sum(b.expired), 0)::numeric / sum(b.matured), 4) end,
    case when count(p.id) = 0 then null else round(coalesce(sum(b.redeemed_value), 0), 2) end
  into outstanding_points, loyalty_liability, breakage_rate, rewards_redeemed_value
  from public.loyalty_programmes p
  join public.tenants t on t.id = p.tenant_id
  left join lateral (
    select
      sum(l.point_delta) filter (
        where not (l.entry_kind = 'earn' and l.pending and not exists (select 1 from public.loyalty_ledger c where c.source_entry_id = l.id and c.entry_kind = 'confirm'))
      ) as points,
      sum(l.point_delta) filter (where l.entry_kind = 'earn' and l.expires_at is not null and l.expires_at < ((p_to + 1)::timestamp at time zone t.timezone)) as matured,
      - sum(l.point_delta) filter (where l.entry_kind = 'expire') as expired,
      - sum(l.value_amount) filter (
        where l.entry_kind = 'redeem'
          and l.occurred_at >= (p_from::timestamp at time zone t.timezone)
          and l.occurred_at < ((p_to + 1)::timestamp at time zone t.timezone)
          and (not l.pending or exists (select 1 from public.loyalty_ledger c where c.source_entry_id = l.id and c.entry_kind = 'confirm'))
      ) as redeemed_value
    from public.loyalty_ledger l
    where l.programme_id = p.id
      and l.occurred_at < ((p_to + 1)::timestamp at time zone t.timezone)
      and (l.store_id is null or l.store_id = any (v_scope))
  ) b on true
  where p.tenant_id in (select s.tenant_id from public.stores s where s.id = any (v_scope));

  select coalesce(sum(i.net_amount), 0) into member_revenue
  from public.invoices i
  where i.store_id = any (v_scope)
    and i.business_date between p_from and p_to
    and i.status <> 'voided'
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = i.tenant_id and m.customer_id = i.customer_id and m.joined_at < ((p_to + 1)::timestamp at time zone 'UTC')
    );
  reward_cost_rate := case
    when rewards_redeemed_value is not null and member_revenue > 0 then round(rewards_redeemed_value / member_revenue, 4)
  end;

  with visits as (
    select distinct i.customer_id, i.business_date, i.tenant_id
    from public.invoices i
    where i.store_id = any (v_scope)
      and i.customer_id is not null
      and i.business_date between p_from and p_to
      and i.status <> 'voided'
  ),
  grouped as (
    select
      v.customer_id,
      count(*) as days,
      exists (
        select 1 from public.memberships m
        where m.tenant_id = v.tenant_id and m.customer_id = v.customer_id and m.joined_at < ((p_from)::timestamp at time zone 'UTC')
      ) as member
    from visits v
    group by v.customer_id, v.tenant_id
  )
  select
    (count(*) filter (where member))::integer,
    (count(*) filter (where not member))::integer,
    round(avg(days) filter (where member), 4),
    round(avg(days) filter (where not member), 4)
  into member_customers, comparison_customers, member_visit_frequency, comparison_visit_frequency
  from grouped;
  uplift_comparison := 'identified_non_members';
  if member_customers >= min_group and comparison_customers >= min_group and comparison_visit_frequency > 0 then
    member_frequency_uplift := round(member_visit_frequency / comparison_visit_frequency - 1, 4);
  else
    member_frequency_uplift := null;
  end if;

  return next;
end;
$$;

comment on function public.customer_metrics(uuid[], date, date) is 'the customer and loyalty metrics of docs/metrics.md over 1 to 50 stores and 1 to 366 business dates, as one row of aggregates read as the caller (42501 unless an owner, manager or viewer; 22023 for a bad store list or range): invoices and customer_capture_rate beside every customer figure; customers, repeat_customers and repeat_rate over customer-days of non-voided invoices with a customer_id; visit frequency (customer-days per active customer) over the 30 and 90 days ending on p_to; the loyalty liability (spendable outstanding points x point value x (1 - expected breakage)), the breakage rate (expired points over points of cohorts already past their expiry) and the reward cost rate (confirmed redeem value of the range over net revenue of member invoices) over the ledger rows of the requested stores and rows without a store; and the member frequency uplift against the identified non-members of the same stores, with the comparison group named in uplift_comparison and both sizes given, null below 10 customers in a group. A figure whose input is not measured is null, never 0. No phone, name or customer id leaves the function. customer_ltv needs costs and is not computed here';

create function public.cohort_retention(p_store_ids uuid[], p_first_month date, p_months integer, p_as_of date)
returns table (
  cohort_month date,
  month_offset integer,
  cohort_size integer,
  retained integer,
  retention numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_scope uuid[] := app.identified_metric_scope(p_store_ids, coalesce(p_first_month, p_as_of), coalesce(p_as_of, p_first_month));
  v_first date := date_trunc('month', p_first_month)::date;
begin
  if p_first_month is null or p_as_of is null or p_months is null or p_months not between 1 and 12 then
    raise exception 'cohort_retention takes 1 to 12 cohort months and an as-of date' using errcode = '22023';
  end if;
  return query
  with cohorts as (
    select m.cohort_month
    from generate_series(0, p_months - 1) g
    cross join lateral (select (v_first + make_interval(months => g))::date as cohort_month) m
    where m.cohort_month <= p_as_of
  ),
  tenants_in_scope as (
    select distinct s.tenant_id, t.timezone from public.stores s join public.tenants t on t.id = s.tenant_id where s.id = any (v_scope)
  ),
  seen as (
    select c.id as customer_id, date_trunc('month', c.first_seen_at at time zone ts.timezone)::date as cohort_month
    from public.customers c
    join tenants_in_scope ts on ts.tenant_id = c.tenant_id
    where exists (
      select 1 from public.invoices i
      where i.customer_id = c.id and i.store_id = any (v_scope) and i.status <> 'voided'
    )
  ),
  activity as (
    select distinct i.customer_id, date_trunc('month', i.business_date)::date as active_month
    from public.invoices i
    where i.store_id = any (v_scope) and i.customer_id is not null and i.status <> 'voided'
  ),
  offsets as (
    select c.cohort_month, o as month_offset, (c.cohort_month + make_interval(months => o))::date as active_month
    from cohorts c
    cross join generate_series(0, 12) o
    where (c.cohort_month + make_interval(months => o))::date <= date_trunc('month', p_as_of)::date
  )
  select
    o.cohort_month,
    o.month_offset,
    (select count(*)::integer from seen s where s.cohort_month = o.cohort_month),
    (select count(*)::integer from seen s join activity a on a.customer_id = s.customer_id and a.active_month = o.active_month where s.cohort_month = o.cohort_month),
    case
      when (select count(*) from seen s where s.cohort_month = o.cohort_month) = 0 then null
      else round(
        (select count(*) from seen s join activity a on a.customer_id = s.customer_id and a.active_month = o.active_month where s.cohort_month = o.cohort_month)::numeric
        / (select count(*) from seen s where s.cohort_month = o.cohort_month), 4)
    end
  from offsets o
  order by o.cohort_month, o.month_offset;
end;
$$;

comment on function public.cohort_retention(uuid[], date, integer, date) is 'cohort retention of the customers first seen in each of 1 to 12 months from the month of p_first_month: per cohort month and month offset (0 to 12, never past the month of p_as_of) the cohort size, the customers of the cohort who bought in cohort month + offset at the requested stores and their share (null for an empty cohort); only identified customers with a non-voided invoice at the requested stores belong to a cohort; for owners, managers and viewers (42501 otherwise), counts only';

create function public.rfm_quintiles(p_store_ids uuid[], p_as_of date)
returns table (
  segment text,
  customers integer,
  share numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_scope uuid[] := app.identified_metric_scope(p_store_ids, p_as_of - 364, p_as_of);
begin
  return query
  with per_customer as (
    select
      i.customer_id,
      p_as_of - max(i.business_date) as recency,
      count(distinct i.business_date) as frequency,
      sum(i.net_amount) as monetary
    from public.invoices i
    where i.store_id = any (v_scope)
      and i.customer_id is not null
      and i.status <> 'voided'
      and i.business_date between p_as_of - 364 and p_as_of
    group by i.customer_id
  ),
  scored as (
    select
      customer_id,
      ntile(5) over (order by recency desc, customer_id) as r,
      ntile(5) over (order by frequency, customer_id) as f
    from per_customer
  ),
  named as (
    select
      case
        when r >= 4 and f >= 4 then 'champions'
        when r >= 3 and f >= 3 then 'loyal'
        when r >= 4 and f = 1 then 'new'
        when r >= 3 then 'promising'
        when f >= 3 then 'at_risk'
        when f = 2 then 'hibernating'
        else 'lost'
      end as segment
    from scored
  ),
  total as (select count(*) as n from named)
  select
    n.segment,
    count(*)::integer,
    round(count(*)::numeric / (select n from total), 4)
  from named n
  group by n.segment
  order by count(*) desc, n.segment;
end;
$$;

comment on function public.rfm_quintiles(uuid[], date) is 'the RFM segments of the identified customers of the requested stores over the 365 days ending on p_as_of: recency (reversed), frequency (customer-days) and the quintile score of each, grouped into champions, loyal, new, promising, at_risk, hibernating and lost, as the number of customers and their share per segment (a segment with no customer has no row); counts only, no customer id, for owners, managers and viewers (42501 otherwise)';

revoke all on function app.identified_metric_scope(uuid[], date, date) from public, anon, service_role;
grant execute on function app.identified_metric_scope(uuid[], date, date) to authenticated;
revoke all on function public.customer_metrics(uuid[], date, date) from public, anon, service_role;
revoke all on function public.cohort_retention(uuid[], date, integer, date) from public, anon, service_role;
revoke all on function public.rfm_quintiles(uuid[], date) from public, anon, service_role;
grant execute on function public.customer_metrics(uuid[], date, date) to authenticated;
grant execute on function public.cohort_retention(uuid[], date, integer, date) to authenticated;
grant execute on function public.rfm_quintiles(uuid[], date) to authenticated;
