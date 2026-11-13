alter table app.incremental_sync_tickets
  add column source text not null default 'schedule' check (source in ('schedule', 'manual'));

comment on column app.incremental_sync_tickets.source is 'schedule for tickets of app.dispatch_incremental_sync, manual for tickets of app.issue_incremental_sync_ticket; the Edge Function records it as sync_runs.triggered_by';

drop function app.claim_incremental_sync_ticket(uuid);

create function app.claim_incremental_sync_ticket(p_ticket uuid)
returns table (tenant_id uuid, store_id uuid, due_at timestamptz, source text)
language sql
volatile
set search_path = ''
as $$
  delete from app.incremental_sync_tickets t
  where t.ticket = p_ticket
    and t.expires_at > now()
  returning t.tenant_id, t.store_id, t.due_at, t.source;
$$;

comment on function app.claim_incremental_sync_ticket(uuid) is 'claims a dispatch ticket once: returns its store and source and deletes it, or returns nothing when the ticket is unknown, used or expired';

create function app.issue_incremental_sync_ticket(p_store_id uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  issued uuid;
begin
  insert into app.incremental_sync_tickets (tenant_id, store_id, due_at, expires_at, source)
  select s.tenant_id, s.id, now(), now() + coalesce((select c.ticket_lifetime from app.incremental_sync_settings c), interval '10 minutes'), 'manual'
  from public.stores s
  where s.id = p_store_id
  returning ticket into issued;
  if issued is null then
    raise exception 'issue_incremental_sync_ticket needs the id of an existing store' using errcode = '22023';
  end if;
  return issued;
end;
$$;

comment on function app.issue_incremental_sync_ticket(uuid) is 'issues one manual ticket for a store, whether or not the schedule is enabled, so an operator can post it to the Edge Function and run that store now';

revoke all on function app.claim_incremental_sync_ticket(uuid) from public;
revoke all on function app.issue_incremental_sync_ticket(uuid) from public;
