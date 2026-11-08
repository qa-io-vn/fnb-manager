create table public.sale_payloads (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  payload text compression lz4 not null,
  updated_at timestamptz not null default now(),
  primary key (store_id, business_date),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.sale_payloads is 'vendor payloads of the sales of one store and business date, kept by the sync instead of the raw columns of invoices, invoice_lines and invoice_payments';
comment on column public.sale_payloads.payload is 'one JSON record per sale and line: external_id, invoice (the sale payload), lines (payload per line external_id) and payments (payload per sequence_no); a line or payment payload leaves out the fields whose value equals the invoice payload''s';

create index sale_payloads_tenant_id_idx on public.sale_payloads (tenant_id);

alter table public.sale_payloads enable row level security;
revoke all on public.sale_payloads from anon, authenticated;

create function app.store_sale_payloads(p_tenant_id uuid, p_store_id uuid, p_business_date date, p_records text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sale_ids text[];
  earlier_date date;
  remaining text;
begin
  select coalesce(array_agg(record::jsonb ->> 'external_id'), '{}'::text[])
  into sale_ids
  from unnest(p_records) as record;
  if cardinality(sale_ids) = 0 then
    return 0;
  end if;
  if array_position(sale_ids, null) is not null then
    raise exception 'store_sale_payloads needs an external_id on every record' using errcode = '22023';
  end if;
  if cardinality(sale_ids) <> (select count(distinct sale_id) from unnest(sale_ids) as sale_id) then
    raise exception 'store_sale_payloads received the same sale twice' using errcode = '22023';
  end if;

  for earlier_date in
    select distinct i.business_date
    from public.invoices i
    where i.store_id = p_store_id
      and i.external_id = any (sale_ids)
      and i.business_date <> p_business_date
  loop
    select string_agg(kept.entry, E'\n' order by kept.entry::jsonb ->> 'external_id')
    into remaining
    from public.sale_payloads p
    cross join lateral string_to_table(p.payload, E'\n') as kept (entry)
    where p.store_id = p_store_id
      and p.business_date = earlier_date
      and kept.entry::jsonb ->> 'external_id' <> all (sale_ids);
    if remaining is null then
      delete from public.sale_payloads
      where store_id = p_store_id
        and business_date = earlier_date;
    else
      update public.sale_payloads
      set payload = remaining, updated_at = now()
      where store_id = p_store_id
        and business_date = earlier_date;
    end if;
  end loop;

  insert into public.sale_payloads as p (tenant_id, store_id, business_date, payload)
  select p_tenant_id, p_store_id, p_business_date,
    string_agg(fresh.entry, E'\n' order by fresh.entry::jsonb ->> 'external_id')
  from unnest(p_records) as fresh (entry)
  on conflict (store_id, business_date) do update
  set payload = (
      select string_agg(merged.entry, E'\n' order by merged.entry::jsonb ->> 'external_id')
      from (
        select kept.entry
        from string_to_table(p.payload, E'\n') as kept (entry)
        where kept.entry::jsonb ->> 'external_id' <> all (sale_ids)
        union all
        select fresh.entry
        from unnest(p_records) as fresh (entry)
      ) as merged
    ),
    updated_at = now();

  return cardinality(sale_ids);
end;
$$;

comment on function app.store_sale_payloads(uuid, uuid, date, text[]) is 'merges sale records into the payload document of one store and business date: replaces the records of the given sales, keeps the others, and takes the given sales out of the document of the business date their invoice row still carries, so it runs before the invoice rows are written';

revoke all on function app.store_sale_payloads(uuid, uuid, date, text[]) from public;
grant execute on function app.store_sale_payloads(uuid, uuid, date, text[]) to service_role;

do $$
declare
  store_day record;
begin
  for store_day in
    select i.tenant_id, i.store_id, i.business_date
    from public.invoices i
    group by i.tenant_id, i.store_id, i.business_date
    order by i.store_id, i.business_date
  loop
    insert into public.sale_payloads (tenant_id, store_id, business_date, payload)
    select store_day.tenant_id, store_day.store_id, store_day.business_date,
      string_agg(
        jsonb_build_object(
          'external_id', i.external_id,
          'invoice', i.raw,
          'lines', coalesce((
            select jsonb_object_agg(
              l.external_id,
              case
                when jsonb_typeof(i.raw) = 'object' and jsonb_typeof(l.raw) = 'object' then
                  l.raw - coalesce((select array_agg(e.key) from jsonb_each(l.raw) as e where i.raw -> e.key = e.value), '{}'::text[])
                else l.raw
              end
            )
            from public.invoice_lines l
            where l.invoice_id = i.id
          ), '{}'::jsonb),
          'payments', coalesce((
            select jsonb_object_agg(
              p.sequence_no::text,
              case
                when jsonb_typeof(i.raw) = 'object' and jsonb_typeof(p.raw) = 'object' then
                  p.raw - coalesce((select array_agg(e.key) from jsonb_each(p.raw) as e where i.raw -> e.key = e.value), '{}'::text[])
                else p.raw
              end
            )
            from public.invoice_payments p
            where p.invoice_id = i.id
          ), '{}'::jsonb)
        )::text,
        E'\n' order by i.external_id
      )
    from public.invoices i
    where i.store_id = store_day.store_id
      and i.business_date = store_day.business_date;
  end loop;
end;
$$;

update public.invoice_lines set raw = null where raw is not null;
update public.invoice_payments set raw = null where raw is not null;
update public.invoices set raw = null where raw is not null;
