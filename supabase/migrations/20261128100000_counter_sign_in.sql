-- The counter web app (ADR-064, ADR-066): signing in with Zalo's web login. The counter-session Edge Function
-- verifies the person with Zalo (OAuth v4 with PKCE, through the relay of ADR-057) and maps the Zalo identity to a
-- member with the same database functions as the staff Mini App (zalo_session_sign_in and zalo_session_pair), so a
-- person who is not an active member of the roster gets no session (acceptance criterion 5). What is new here:
--
-- 1. counter_session_app: the brand's Zalo App with its public id (the authorise address needs it), for the function.
-- 2. app.blocked_signins: everyone Zalo verified but the roster refused, so a manager sees "people blocked at sign-in"
--    (screen M02) and can add them; written only by the function (service role), read and answered by owners and
--    managers through manager_blocked_signins, manager_dismiss_blocked_signin and manager_approve_blocked_signin.
--    Approving adds the person to the roster (app.add_staff, with its rules) and issues the one-time pairing code
--    they type at their next sign-in, the existing first-time path of the staff Mini App.

-- 1. The brand's Zalo App for the function -----------------------------------------------------------------------------

create function app.counter_session_app(p_brand_key text, p_tenant_id uuid default null)
returns table (tenant_id uuid, tenant_slug text, zalo_app_id uuid, external_id text, secret_name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.tenant_id, r.tenant_slug, r.zalo_app_id, a.external_id, r.secret_name, r.status
  from app.zalo_resolve_app(p_brand_key, p_tenant_id) r
  join public.zalo_apps a on a.id = r.zalo_app_id;
$$;

comment on function app.counter_session_app(text, uuid) is 'the Zalo App of a brand key as app.zalo_resolve_app answers it, with its public Zalo App id (external_id) that the web login''s authorise address and token exchange name; at most two rows, so a key shared by two tenants shows as ambiguous';

create function public.counter_session_app(p_brand_key text, p_tenant_id uuid default null)
returns table (tenant_id uuid, tenant_slug text, zalo_app_id uuid, external_id text, secret_name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.counter_session_app(p_brand_key, p_tenant_id);
$$;

comment on function public.counter_session_app(text, uuid) is 'RPC for the counter-session Edge Function only (service_role): app.counter_session_app';

-- 2. People blocked at sign-in -----------------------------------------------------------------------------------------

create table app.blocked_signins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  zalo_app_id uuid not null references public.zalo_apps (id) on delete cascade,
  zalo_user_id text not null check (zalo_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  display_name text check (display_name is null or (char_length(display_name) between 1 and 100 and display_name !~ '[[:cntrl:]]')),
  device text check (device is null or (char_length(device) between 1 and 60 and device !~ '[[:cntrl:]]')),
  attempts integer not null default 1 check (attempts between 1 and 1000000),
  first_at timestamptz not null,
  last_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'approved')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  roster_id uuid references public.staff_roster (id) on delete set null,
  version integer not null default 1 check (version >= 1),
  unique (zalo_app_id, zalo_user_id),
  check (last_at >= first_at),
  check ((status = 'pending') = (decided_at is null))
);

create index blocked_signins_tenant_idx on app.blocked_signins (tenant_id, status, last_at desc);

comment on table app.blocked_signins is 'people Zalo verified at the counter web app''s sign-in whom the roster refused (acceptance criterion 5): one row per Zalo identity with the Zalo name, a short device line, how often and when; pending until a manager dismisses it or adds the person (approved, with the roster row); a new attempt after a decision opens it again; written only by app.counter_record_blocked_signin, read and answered through the manager functions; no API role reads the table';

create function app.counter_record_blocked_signin(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_device text default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_name text := nullif(btrim(p_display_name), '');
  v_device text := nullif(btrim(p_device), '');
  v_row app.blocked_signins;
begin
  select a.tenant_id into v_tenant_id from public.zalo_apps a where a.id = p_zalo_app_id;
  if not found then
    raise exception 'unknown Zalo App' using errcode = '22023';
  end if;
  if p_zalo_user_id is null or p_zalo_user_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'the Zalo user id is malformed' using errcode = '22023';
  end if;
  if v_name is not null and (char_length(v_name) > 100 or v_name ~ '[[:cntrl:]]') then
    v_name := null;
  end if;
  if v_device is not null and (char_length(v_device) > 60 or v_device ~ '[[:cntrl:]]') then
    v_device := null;
  end if;
  -- a person who is bound to a member of the tenant is not blocked (a pairing answer can still be unpaired for them)
  if exists (
    select 1
    from public.zalo_identities i
    join public.tenant_members m on m.user_id = i.user_id and m.tenant_id = i.tenant_id
    where i.zalo_app_id = p_zalo_app_id and i.zalo_user_id = p_zalo_user_id
  ) then
    return jsonb_build_object('recorded', false);
  end if;

  -- old rows go after 30 days; a tenant keeps at most 200 rows, so a flood of new identities cannot grow it
  delete from app.blocked_signins b where b.tenant_id = v_tenant_id and b.last_at < p_at - interval '30 days';

  select * into v_row from app.blocked_signins b
  where b.zalo_app_id = p_zalo_app_id and b.zalo_user_id = p_zalo_user_id
  for update;
  if found then
    update app.blocked_signins b
    set attempts = least(b.attempts + 1, 1000000),
        last_at = greatest(b.last_at, p_at),
        display_name = coalesce(v_name, b.display_name),
        device = coalesce(v_device, b.device),
        status = 'pending',
        decided_by = null,
        decided_at = null,
        version = b.version + 1
    where b.id = v_row.id;
    return jsonb_build_object('recorded', true);
  end if;
  if (select count(*) from app.blocked_signins b where b.tenant_id = v_tenant_id) >= 200 then
    return jsonb_build_object('recorded', false);
  end if;
  insert into app.blocked_signins (tenant_id, zalo_app_id, zalo_user_id, display_name, device, first_at, last_at)
  values (v_tenant_id, p_zalo_app_id, p_zalo_user_id, v_name, v_device, p_at, p_at);
  return jsonb_build_object('recorded', true);
end;
$$;

comment on function app.counter_record_blocked_signin(uuid, text, text, text, timestamptz) is 'records a Zalo identity the roster refused at the counter''s sign-in (one row per identity, counting attempts; a decided row opens again); nothing for an identity bound to a member of the tenant; rows older than 30 days are removed and a tenant keeps at most 200; for the counter-session Edge Function only';

create function public.counter_record_blocked_signin(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_device text default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.counter_record_blocked_signin(p_zalo_app_id, p_zalo_user_id, p_display_name, p_device, now());
$$;

comment on function public.counter_record_blocked_signin(uuid, text, text, text) is 'RPC for the counter-session Edge Function only (service_role): app.counter_record_blocked_signin at the current time';

create function app.blocked_signin_json(p_row app.blocked_signins)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'display_name', p_row.display_name,
    'device', p_row.device,
    'attempts', p_row.attempts,
    'first_at', p_row.first_at,
    'last_at', p_row.last_at,
    'status', p_row.status,
    'decided_at', p_row.decided_at,
    'roster_id', p_row.roster_id,
    'version', p_row.version
  );
$$;

comment on function app.blocked_signin_json(app.blocked_signins) is 'a blocked sign-in as the manager screens see it: never the Zalo user id';

create function app.manager_blocked_signins(p_tenant_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only an owner or a manager of the tenant reads blocked sign-ins' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(app.blocked_signin_json(b) order by b.last_at desc, b.id)
      from app.blocked_signins b
      where b.tenant_id = p_tenant_id
        and b.status = 'pending'
        and b.last_at >= p_at - interval '7 days'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.manager_blocked_signins(uuid, timestamptz) is 'the pending blocked sign-ins of the tenant from the last 7 days, newest first (screen M02: "people blocked at sign-in"), for its owners and managers; 42501 for anyone else';

create function app.manager_dismiss_blocked_signin(p_request uuid, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row app.blocked_signins;
begin
  select * into v_row from app.blocked_signins b where b.id = p_request for update;
  if not found or not app.has_tenant_role(v_row.tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only an owner or a manager of the tenant answers a blocked sign-in' using errcode = '42501';
  end if;
  if v_row.status = 'dismissed' then
    return jsonb_build_object('state', 'dismissed', 'replayed', true, 'request', app.blocked_signin_json(v_row));
  end if;
  if v_row.version <> p_expected_version then
    return jsonb_build_object('state', 'conflict', 'replayed', false, 'request', app.blocked_signin_json(v_row));
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_pending', 'replayed', false, 'request', app.blocked_signin_json(v_row));
  end if;
  update app.blocked_signins b
  set status = 'dismissed', decided_by = (select auth.uid()), decided_at = now(), version = b.version + 1
  where b.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('state', 'dismissed', 'replayed', false, 'request', app.blocked_signin_json(v_row));
end;
$$;

comment on function app.manager_dismiss_blocked_signin(uuid, integer) is 'an owner or manager of the tenant turns a blocked sign-in down ("Từ chối"): dismissed with who and when; a repeat is a replay, another version a conflict; 42501 for anyone else and for an unknown id alike';

create function app.manager_approve_blocked_signin(
  p_request uuid,
  p_expected_version integer,
  p_display_name text,
  p_role public.tenant_role,
  p_store_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row app.blocked_signins;
  v_roster uuid;
  v_code text;
begin
  select * into v_row from app.blocked_signins b where b.id = p_request for update;
  if not found or not app.has_tenant_role(v_row.tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only an owner or a manager of the tenant answers a blocked sign-in' using errcode = '42501';
  end if;
  if v_row.version <> p_expected_version then
    return jsonb_build_object('state', 'conflict', 'request', app.blocked_signin_json(v_row));
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_pending', 'request', app.blocked_signin_json(v_row));
  end if;
  -- app.add_staff checks the caller's role and store scope and the name, and refuses an owner role
  v_roster := app.add_staff(v_row.tenant_id, p_display_name, p_role, p_store_ids);
  v_code := app.issue_pairing_code(v_roster);
  update app.blocked_signins b
  set status = 'approved', decided_by = (select auth.uid()), decided_at = now(), roster_id = v_roster, version = b.version + 1
  where b.id = v_row.id
  returning * into v_row;
  return jsonb_build_object(
    'state', 'approved',
    'request', app.blocked_signin_json(v_row),
    'roster_id', v_roster,
    'pairing_code', v_code,
    'pairing_code_minutes', 10
  );
end;
$$;

comment on function app.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[]) is 'an owner or manager of the tenant adds a blocked person to the roster ("Thêm vào danh sách") through app.add_staff (its role, name and store rules) and gets the one-time pairing code the person types at their next sign-in (valid 10 minutes, issue_pairing_code); the row is approved with the roster row; another version is a conflict, a decided row not_pending';

create function public.manager_blocked_signins(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.manager_blocked_signins(p_tenant, now());
$$;

comment on function public.manager_blocked_signins(uuid) is 'RPC: app.manager_blocked_signins at the current time';

create function public.manager_dismiss_blocked_signin(p_request uuid, p_expected_version integer)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.manager_dismiss_blocked_signin(p_request, p_expected_version);
$$;

comment on function public.manager_dismiss_blocked_signin(uuid, integer) is 'RPC: app.manager_dismiss_blocked_signin';

create function public.manager_approve_blocked_signin(
  p_request uuid,
  p_expected_version integer,
  p_display_name text,
  p_role public.tenant_role,
  p_store_ids uuid[]
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.manager_approve_blocked_signin(p_request, p_expected_version, p_display_name, p_role, p_store_ids);
$$;

comment on function public.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[]) is 'RPC: app.manager_approve_blocked_signin';

-- 3. Privileges ------------------------------------------------------------------------------------------------------
-- The app functions are reached only through the public wrappers (security definer, as the native till's are).

revoke all on table app.blocked_signins from public, anon, authenticated, service_role;
revoke all on function app.counter_session_app(text, uuid) from public, anon, authenticated, service_role;
revoke all on function app.counter_record_blocked_signin(uuid, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.blocked_signin_json(app.blocked_signins) from public, anon, authenticated, service_role;
revoke all on function app.manager_blocked_signins(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.manager_dismiss_blocked_signin(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function app.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[]) from public, anon, authenticated, service_role;

revoke all on function public.counter_session_app(text, uuid), public.counter_record_blocked_signin(uuid, text, text, text),
  public.manager_blocked_signins(uuid), public.manager_dismiss_blocked_signin(uuid, integer),
  public.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.counter_session_app(text, uuid), public.counter_record_blocked_signin(uuid, text, text, text) to service_role;
grant execute on function public.manager_blocked_signins(uuid), public.manager_dismiss_blocked_signin(uuid, integer),
  public.manager_approve_blocked_signin(uuid, integer, text, public.tenant_role, uuid[]) to authenticated;
