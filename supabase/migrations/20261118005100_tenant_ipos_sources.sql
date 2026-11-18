create table app.tenant_ipos_sources (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  source text not null check (source in ('api', 'snapshot')),
  recorded_at timestamptz not null default now()
);

comment on table app.tenant_ipos_sources is 'where the iPOS data of a tenant comes from: api once a run with IPOS_REAL_API=on wrote into it, snapshot once a run with IPOS_REAL_API=off replayed the local iPOS snapshot into it; the runners refuse to write the other kind, so replayed data never mixes with real data';

revoke all on table app.tenant_ipos_sources from public, anon, authenticated, service_role;

insert into app.tenant_ipos_sources (tenant_id, source)
select distinct a.tenant_id, 'api'
from public.pos_accounts a
where a.connector = 'ipos-fabi'
on conflict (tenant_id) do nothing;

create function app.claim_ipos_source(p_tenant_id uuid, p_source text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recorded text;
begin
  if p_source is null or p_source not in ('api', 'snapshot') then
    raise exception 'claim_ipos_source takes api or snapshot' using errcode = '22023';
  end if;
  insert into app.tenant_ipos_sources (tenant_id, source)
  values (p_tenant_id, p_source)
  on conflict (tenant_id) do nothing;
  select s.source into recorded
  from app.tenant_ipos_sources s
  where s.tenant_id = p_tenant_id;
  return recorded;
end;
$$;

comment on function app.claim_ipos_source(uuid, text) is 'records the iPOS source of a tenant on its first write and returns the recorded source, which the caller compares with its own before it writes anything';

revoke all on function app.claim_ipos_source(uuid, text) from public, anon, authenticated, service_role;
