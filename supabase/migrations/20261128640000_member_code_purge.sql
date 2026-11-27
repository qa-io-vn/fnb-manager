-- Expired member codes are purged (C20; migration stamp_member_codes): until now a customer's codes were removed only
-- when the same customer issued a new one, so the codes of a customer who never came back stayed. The hourly pg_cron job
-- stamp-codes-purge deletes the codes that expired more than a day ago, the same horizon customer_stamp_code uses for
-- the customer's own. The guess-limit bookkeeping does not depend on these rows: misses and locks live in
-- app.code_attempts, which the purge leaves alone, and a purged code was already dead (expired), so looking it up is
-- the same miss as before. Like the bill deadlines, the job is pure SQL and runs from the migration on.

create index stamp_member_codes_expires_idx on app.stamp_member_codes (expires_at);

create function app.purge_stamp_member_codes(p_at timestamptz default now(), p_limit integer default 20000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purged integer;
begin
  if p_at is null or p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'a purge needs an instant and a limit of 1 to 100000' using errcode = '22023';
  end if;
  delete from app.stamp_member_codes c
  where c.id in (
    select x.id from app.stamp_member_codes x
    where x.expires_at < p_at - interval '1 day'
    order by x.expires_at
    limit p_limit
  );
  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;

comment on function app.purge_stamp_member_codes(timestamptz, integer) is 'the body of the pg_cron job stamp-codes-purge (hourly): deletes up to p_limit member codes that expired more than a day before p_at (expired exactly a day ago stays until the next run), oldest first; live, revoked-but-recent and just-expired codes stay; misses and locks in app.code_attempts are untouched; answers how many it deleted; no API role may run it';

revoke all on function app.purge_stamp_member_codes(timestamptz, integer) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('stamp-codes-purge', '17 * * * *', 'select app.purge_stamp_member_codes(now())');
  end if;
end;
$$;
