-- Hardening of app.revise_digest after an independent review: (1) a correction went to every destination handed over,
-- also to a member who had since lost the role or the stores (the original send filters them): the destination is checked
-- again with the conditions of app.due_digests (app.digest_destination_current); (2) a call carrying an instant older than
-- the last revision could put an older model back: it changes nothing now. The comment of the original migration wrongly
-- said the caller is the service role; it is the postgres role (the connection string of the Edge Function and the CLI),
-- as for the sibling digest functions.

create function app.digest_destination_current(p_tenant_id uuid, p_store_ids uuid[], p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The same conditions app.due_digests applies when it picks the destinations of a digest, evaluated now.
  select exists (
    select 1
    from public.notification_channels c
    join public.tenant_members m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
    cross join lateral app.effective_alert_rule(c.tenant_id, null, 'daily_digest') r
    where c.id = p_channel_id
      and c.tenant_id = p_tenant_id
      and c.user_id is not null
      and c.kind <> 'webhook'
      and c.enabled
      and c.status in ('active', 'failing')
      and not ('daily_digest' = any (c.muted_rules))
      and r.enabled
      and m.role = any (r.roles)
      and (
        select array_agg(s.id order by s.id::text)
        from public.stores s
        where s.tenant_id = c.tenant_id
          and s.active
          and (m.store_ids is null or s.id = any (m.store_ids))
          and (c.store_ids is null or s.id = any (c.store_ids))
      ) is not distinct from (select array_agg(x order by x::text) from unnest(p_store_ids) as x)
  );
$$;

comment on function app.digest_destination_current(uuid, uuid[], uuid) is 'whether a destination would still be chosen for a digest of these stores by app.due_digests right now: enabled, active or failing, a member destination, not muted for daily_digest, the member in a role of the daily_digest rule, and the stores of the member and the destination, the active ones, exactly the digest''s stores; used by app.revise_digest so a correction never reaches someone who lost the role or the stores';

revoke all on function app.digest_destination_current(uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function app.revise_digest(
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

  -- a writer that carries an older instant than the last revision must not put an older model back
  if digest.revised_at is not null and p_at < digest.revised_at then
    return 0;
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
      if jsonb_typeof(entry -> 'correction') = 'object'
        and (entry ->> 'channel_id') is not null
        and app.digest_destination_current(digest.tenant_id, digest.store_ids, (entry ->> 'channel_id')::uuid)
      then
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

comment on function app.revise_digest(uuid, jsonb, text, jsonb, timestamptz) is 'stores the rebuilt model of a built digest: an unchanged fingerprint only records the revision instant; a changed one replaces the model and fingerprint and, the first time and only when a correction was rendered for a destination, queues one digest_correction per destination (revision 1) and sets revision to 1, a digest that already had its one correction is replaced silently; entries is an array of {channel_id, digest, correction} where correction is null for a change that deserves none; returns the corrections queued (G-70); a destination that the daily_digest rule would not select today (disabled, muted, its member no longer in a rule role, or its scope no longer the digest''s stores) gets no correction, and a call carrying an instant older than the last revision changes nothing';
