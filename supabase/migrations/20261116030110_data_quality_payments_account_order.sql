create or replace function public.data_quality_payments(store_ids uuid[], from_date date, to_date date)
returns table (
  pos_account_id uuid,
  payment_method_external_id text,
  payment_method_name text,
  kind public.payment_kind,
  pos_kind public.payment_kind,
  override_kind public.payment_kind,
  in_catalogue boolean,
  invoices bigint,
  amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  returned_rows bigint;
begin
  perform app.require_store_ids('data_quality_payments', data_quality_payments.store_ids);
  perform app.require_date_range('data_quality_payments', data_quality_payments.from_date, data_quality_payments.to_date, max_range_days);

  return query
  with visible as (
    select s.id as v_store, s.pos_account_id as v_account, v.store_position as v_position
    from app.visible_stores(data_quality_payments.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  accounts as (
    select vs.v_account as a_account, min(vs.v_position) as a_position
    from visible vs
    group by vs.v_account
  ),
  paid as (
    select
      vs.v_account as p_account,
      a.payment_method_external_id as p_method,
      max(a.payment_method_name) as p_name,
      max(a.kind::text)::public.payment_kind as p_kind,
      sum(a.invoices)::bigint as p_invoices,
      sum(a.amount) as p_amount
    from public.agg_payment_daily a
    join visible vs on vs.v_store = a.store_id
    where a.business_date between data_quality_payments.from_date and data_quality_payments.to_date
    group by vs.v_account, a.payment_method_external_id
  ),
  catalogue as (
    select m.pos_account_id as m_account, m.external_id as m_method, m.name as m_name, m.kind as m_kind, m.pos_kind as m_pos_kind
    from public.payment_methods m
    where m.pos_account_id in (select vs.v_account from visible vs)
  )
  select
    coalesce(c.m_account, p.p_account),
    coalesce(c.m_method, p.p_method),
    coalesce(c.m_name, p.p_name),
    coalesce(c.m_kind, p.p_kind, 'other'::public.payment_kind),
    c.m_pos_kind,
    o.kind,
    c.m_method is not null,
    p.p_invoices,
    p.p_amount
  from catalogue c
  full join paid p on p.p_account = c.m_account and p.p_method = c.m_method
  join accounts ac on ac.a_account = coalesce(c.m_account, p.p_account)
  left join public.payment_kind_overrides o
    on o.pos_account_id = coalesce(c.m_account, p.p_account)
    and o.payment_method_external_id = coalesce(c.m_method, p.p_method)
  order by p.p_amount desc nulls last, coalesce(c.m_name, p.p_name) collate "C", coalesce(c.m_method, p.p_method) collate "C", ac.a_position;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('data_quality_payments', returned_rows);
end;
$$;
