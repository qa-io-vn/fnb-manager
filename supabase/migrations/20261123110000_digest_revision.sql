-- G-70, the SQL half of digest corrections (#60). The TypeScript half (packages/notify, `fnb digest --revise`) was ported
-- first and calls two functions that did not exist: app.digests_to_revise and app.revise_digest.
--
-- Rules, from docs/notifications.md section 5 ("one correction at most, never for item-only changes after the nightly
-- reconciliation"):
--
-- app.digests_to_revise(p_at, p_tenant_id): the built digests whose figures may have changed since they were built or last
--   revised. A digest is a candidate when a successful nightly, reconciliation or backfill run of its tenant, covering its
--   business date, finished after it was built (or last revised) and by p_at, and its business date is within the last
--   three local days. Incremental runs and master-data runs never make a digest a candidate (they run every few minutes).
--   A digest that was revised is a candidate again only when a later run finished.
--
-- app.revise_digest(p_digest_id, p_model, p_fingerprint, p_entries, p_at): the caller rebuilt the digest as its builder and
--   hands over the new model, its fingerprint and, per destination, the rendered text and the rendered correction (null when
--   the change is not worth a correction: only items moved, or nothing the owner reads). An unchanged fingerprint stores the
--   revision instant and queues nothing. A changed one replaces the model and the fingerprint; the first time, and only if a
--   correction was rendered for a destination, it queues one digest_correction per destination (revision 1, expiring after
--   24 hours, idempotent by the dedupe key digest:<id>:<destination>:r1) and sets revision to 1. A digest that already had its
--   one correction is replaced silently. Returns the number of corrections queued.
--
-- Both are closed to every API role; the Edge Function and the CLI call them as the service role.

create function app.digests_to_revise(p_at timestamptz default now(), p_tenant_id uuid default null)
returns table (digest_id uuid, tenant_id uuid, business_date date, scope_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.tenant_id, d.business_date, d.scope_key
  from public.digests d
  join public.tenants t on t.id = d.tenant_id
  where d.state = 'built'
    and d.built_as is not null
    and d.model is not null
    and d.fingerprint is not null
    and (p_tenant_id is null or d.tenant_id = p_tenant_id)
    and d.business_date >= (p_at at time zone t.timezone)::date - 3
    and exists (
      select 1
      from public.sync_runs r
      where r.tenant_id = d.tenant_id
        and r.status = 'succeeded'
        and r.kind in ('nightly', 'reconciliation', 'backfill')
        and r.finished_at is not null
        and r.finished_at > coalesce(d.revised_at, d.built_at)
        and r.finished_at <= p_at
        and (r.range_start is null or r.range_end is null or d.business_date between r.range_start and r.range_end)
    )
  order by d.tenant_id, d.business_date, d.scope_key;
$$;

comment on function app.digests_to_revise(timestamptz, uuid) is 'the built digests (of one tenant, or every tenant) whose figures may have changed since they were built or last revised: a successful nightly, reconciliation or backfill run of the tenant covering the business date finished after that and by p_at, and the business date is within the last three local days; incremental and master-data runs never count; returns rows of digest_id, tenant_id, business_date and scope_key (at least two columns, so a caller reading each row as a record, as the notify package does, gets an object) in tenant, date and scope order (G-70)';

create function app.revise_digest(
  p_digest_id uuid,
  p_model jsonb,
  p_fingerprint text,
  p_entries jsonb,
  p_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  digest public.digests%rowtype;
  entry jsonb;
  queued integer := 0;
begin
  if p_model is null or jsonb_typeof(p_model) <> 'object' then
    raise exception 'revise_digest needs a model object' using errcode = '22023';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'revise_digest needs a SHA-256 hex fingerprint' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or p_at is null then
    raise exception 'revise_digest needs the entries as an array and an instant' using errcode = '22023';
  end if;
  select d.* into digest from public.digests d where d.id = p_digest_id for update;
  if not found or digest.state <> 'built' then
    raise exception 'revise_digest needs a built digest' using errcode = '22023';
  end if;

  if p_fingerprint is not distinct from digest.fingerprint then
    update public.digests d set revised_at = p_at, updated_at = p_at where d.id = digest.id;
    return 0;
  end if;

  update public.digests d
  set model = p_model, fingerprint = p_fingerprint, revised_at = p_at, updated_at = p_at
  where d.id = digest.id;

  if digest.revision = 0 then
    for entry in select e from jsonb_array_elements(p_entries) as e loop
      if jsonb_typeof(entry -> 'correction') = 'object' and (entry ->> 'channel_id') is not null then
        perform app.enqueue_digest_message(
          digest.id,
          (entry ->> 'channel_id')::uuid,
          1,
          'digest_correction',
          entry -> 'correction' ->> 'title',
          entry -> 'correction' ->> 'body',
          p_at
        );
        queued := queued + 1;
      end if;
    end loop;
    if queued > 0 then
      update public.digests d set revision = 1 where d.id = digest.id;
    end if;
  end if;
  return queued;
end;
$$;

comment on function app.revise_digest(uuid, jsonb, text, jsonb, timestamptz) is 'stores the rebuilt model of a built digest: an unchanged fingerprint only records the revision instant; a changed one replaces the model and fingerprint and, the first time and only when a correction was rendered for a destination, queues one digest_correction per destination (revision 1) and sets revision to 1, a digest that already had its one correction is replaced silently; entries is an array of {channel_id, digest, correction} where correction is null for a change that deserves none; returns the corrections queued (G-70)';

revoke all on function app.digests_to_revise(timestamptz, uuid) from public, anon, authenticated;
revoke all on function app.revise_digest(uuid, jsonb, text, jsonb, timestamptz) from public, anon, authenticated;
