-- G-109, ADR-057: the Zalo Graph answers error -501 to calls from servers outside Vietnam, which is every Supabase
-- Edge region, so zalo-session and zalo-phone send their Graph calls through a relay that runs in Vietnam. A
-- Cloudflare quick tunnel gives the relay a new https address at every start, so the relay announces its address
-- (sealed with the shared relay key, checked by zalo-session) every few minutes; this table keeps the newest one.
-- Only the service role reaches it, through the two functions below.

create table app.zalo_relay (
  singleton boolean primary key default true check (singleton),
  url text not null check (
    char_length(url) <= 200
    and url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  announced_at timestamptz not null
);

comment on table app.zalo_relay is 'the newest address announced by the Zalo Graph relay in Vietnam (ADR-057): one row at most, an https origin on a DNS name and the time the relay sealed the announcement';

alter table app.zalo_relay enable row level security;
revoke all on table app.zalo_relay from public, anon, authenticated;

create function app.zalo_relay_announce(p_url text, p_at timestamptz, p_now timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stored boolean;
begin
  if p_url is null or p_at is null or p_now is null or p_at > p_now + interval '2 minutes' then
    return false;
  end if;
  insert into app.zalo_relay as r (singleton, url, announced_at)
  values (true, p_url, p_at)
  on conflict (singleton) do update
    set url = excluded.url,
        announced_at = excluded.announced_at
    where r.announced_at < excluded.announced_at
  returning true into v_stored;
  return coalesce(v_stored, false);
end;
$$;

comment on function app.zalo_relay_announce(text, timestamptz, timestamptz) is 'stores a relay address announced at p_at unless a newer announcement is kept already or p_at lies more than two minutes after p_now; a malformed address fails the table check (23514)';

create function app.zalo_relay_current(p_now timestamptz, p_max_age interval)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.url
  from app.zalo_relay r
  where r.announced_at > p_now - p_max_age
    and r.announced_at <= p_now + interval '2 minutes';
$$;

comment on function app.zalo_relay_current(timestamptz, interval) is 'the relay address announced within p_max_age before p_now, or null when the relay has gone quiet';

create function public.zalo_relay_announce(p_url text, p_at timestamptz)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select app.zalo_relay_announce(p_url, p_at, now());
$$;

comment on function public.zalo_relay_announce(text, timestamptz) is 'RPC for the zalo-session Edge Function only (service_role), after it opened a sealed relay announcement: app.zalo_relay_announce at the current time';

create function public.zalo_relay_current()
returns text
language sql
stable
set search_path = ''
as $$
  select app.zalo_relay_current(now(), interval '15 minutes');
$$;

comment on function public.zalo_relay_current() is 'RPC for the zalo-session and zalo-phone Edge Functions only (service_role): the relay address announced in the last 15 minutes (the relay announces every 5), or null to call the Zalo Graph directly';

revoke all on function app.zalo_relay_announce(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.zalo_relay_current(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.zalo_relay_announce(text, timestamptz) from public, anon, authenticated;
revoke all on function public.zalo_relay_current() from public, anon, authenticated;

grant execute on function app.zalo_relay_announce(text, timestamptz, timestamptz) to service_role;
grant execute on function app.zalo_relay_current(timestamptz, interval) to service_role;
grant execute on function public.zalo_relay_announce(text, timestamptz) to service_role;
grant execute on function public.zalo_relay_current() to service_role;
