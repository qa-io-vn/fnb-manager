create table app.zalo_binding_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  zalo_app_id uuid not null,
  user_id uuid not null,
  code_sha256 text not null check (code_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  unique (zalo_app_id, user_id),
  unique (zalo_app_id, code_sha256),
  foreign key (tenant_id, zalo_app_id) references public.zalo_apps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade
);

create index zalo_binding_codes_member_idx on app.zalo_binding_codes (tenant_id, user_id);

comment on table app.zalo_binding_codes is 'one-time 6-digit codes that bind a Zalo identity to an existing member (fnb zalo bind): one live code per member and Zalo App, stored only as sha256(zalo_app_id:code), valid 10 minutes; a wrong code counts against every live code of the app and the sixth wrong attempt burns them';
comment on column app.zalo_binding_codes.failed_attempts is 'wrong codes sent to the app while this code was live; at 5 the next wrong attempt deletes the row';

revoke all on table app.zalo_binding_codes from public, anon, authenticated, service_role;

create function app.zalo_binding_code_hash(p_zalo_app_id uuid, p_code text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select app.sha256_hex(p_zalo_app_id::text || ':' || p_code);
$$;

comment on function app.zalo_binding_code_hash(uuid, text) is 'the stored form of a binding code: sha256 of the Zalo App id and the code';

create function app.issue_zalo_binding_code(p_tenant_id uuid, p_user_id uuid, p_zalo_app_id uuid, p_at timestamptz default now())
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_role public.tenant_role;
  v_code text;
  v_tries integer := 0;
begin
  select a.status into v_status
  from public.zalo_apps a
  where a.id = p_zalo_app_id and a.tenant_id = p_tenant_id;
  if not found then
    raise exception 'the Zalo App is not an app of this tenant' using errcode = '22023';
  end if;
  if v_status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  select m.role into v_role
  from public.tenant_members m
  where m.tenant_id = p_tenant_id and m.user_id = p_user_id;
  if not found then
    raise exception 'the login is not a member of this tenant' using errcode = '22023';
  end if;
  if v_role = 'publisher' then
    raise exception 'a publisher login cannot be bound to a Zalo account' using errcode = '22023';
  end if;
  delete from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id
    and (c.user_id = p_user_id or c.expires_at <= p_at);
  loop
    v_code := app.notify_random_code('0123456789', 6);
    begin
      insert into app.zalo_binding_codes (tenant_id, zalo_app_id, user_id, code_sha256, issued_at, expires_at)
      values (p_tenant_id, p_zalo_app_id, p_user_id, app.zalo_binding_code_hash(p_zalo_app_id, v_code), p_at, p_at + interval '10 minutes');
      return v_code;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 20 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

comment on function app.issue_zalo_binding_code(uuid, uuid, uuid, timestamptz) is 'issues the one-time 6-digit binding code of a member (not a publisher) for an active Zalo App of the tenant and returns it once; a new code replaces the member''s previous one';

create function app.zalo_member_profile(p_zalo_app_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'bound',
    'user_id', m.user_id,
    'tenant_id', m.tenant_id,
    'role', m.role,
    'store_ids', to_jsonb(m.store_ids),
    'stores', coalesce(
      (
        select jsonb_agg(s.name order by s.name, s.id)
        from public.stores s
        where s.tenant_id = m.tenant_id
          and s.id = any (b.store_ids)
          and (m.store_ids is null or s.id = any (m.store_ids))
      ),
      '[]'::jsonb
    )
  )
  from public.zalo_apps a
  join public.brands b on b.id = a.brand_id and b.tenant_id = a.tenant_id
  join public.tenant_members m on m.tenant_id = a.tenant_id and m.user_id = p_user_id
  where a.id = p_zalo_app_id;
$$;

comment on function app.zalo_member_profile(uuid, uuid) is 'the membership a Mini App session shows: role, store scope and the names of the brand''s stores in that scope; null when the login is no longer a member of the app''s tenant';

create function app.zalo_resolve_app(p_brand_key text, p_tenant_id uuid default null)
returns table (tenant_id uuid, tenant_slug text, zalo_app_id uuid, secret_name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.tenant_id, t.slug, a.id, a.secret_name, a.status
  from public.brands b
  join public.zalo_apps a on a.brand_id = b.id and a.tenant_id = b.tenant_id
  join public.tenants t on t.id = b.tenant_id
  where b.brand_key = p_brand_key
    and (p_tenant_id is null or b.tenant_id = p_tenant_id)
  order by a.tenant_id
  limit 2;
$$;

comment on function app.zalo_resolve_app(text, uuid) is 'the Zalo App of a brand key, optionally within one tenant: its tenant, the name of its App secret and its status; at most two rows, so a key shared by two tenants shows as ambiguous';

create function app.zalo_sign_in(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_binding_code text default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_identity public.zalo_identities;
  v_profile jsonb;
  v_code app.zalo_binding_codes;
  v_display_name text := nullif(btrim(p_display_name), '');
begin
  select a.status into v_status from public.zalo_apps a where a.id = p_zalo_app_id;
  if not found then
    raise exception 'unknown Zalo App' using errcode = '22023';
  end if;
  if v_status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_zalo_user_id is null or p_zalo_user_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'the Zalo user id is malformed' using errcode = '22023';
  end if;
  if p_binding_code is not null and p_binding_code !~ '^[0-9]{6}$' then
    raise exception 'a binding code has six digits' using errcode = '22023';
  end if;
  if v_display_name is not null and (char_length(v_display_name) > 100 or v_display_name ~ '[[:cntrl:]]') then
    v_display_name := null;
  end if;

  select * into v_identity
  from public.zalo_identities i
  where i.zalo_app_id = p_zalo_app_id and i.zalo_user_id = p_zalo_user_id
  for update;
  if found then
    v_profile := app.zalo_member_profile(p_zalo_app_id, v_identity.user_id);
    if v_profile is not null then
      if v_display_name is not null and v_display_name is distinct from v_identity.display_name then
        update public.zalo_identities i
        set display_name = v_display_name
        where i.id = v_identity.id
        returning * into v_identity;
      end if;
      return v_profile || jsonb_build_object('display_name', v_identity.display_name);
    end if;
  end if;

  if p_binding_code is null then
    return jsonb_build_object('status', 'unpaired');
  end if;

  delete from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id and c.expires_at <= p_at;

  select * into v_code
  from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id
    and c.code_sha256 = app.zalo_binding_code_hash(p_zalo_app_id, p_binding_code)
    and c.expires_at > p_at
  for update;
  if not found then
    delete from app.zalo_binding_codes c
    where c.zalo_app_id = p_zalo_app_id and c.failed_attempts >= 5;
    update app.zalo_binding_codes c
    set failed_attempts = c.failed_attempts + 1
    where c.zalo_app_id = p_zalo_app_id;
    return jsonb_build_object('status', 'unpaired');
  end if;

  delete from app.zalo_binding_codes c where c.id = v_code.id;
  insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
  values (v_code.tenant_id, p_zalo_app_id, p_zalo_user_id, v_code.user_id, v_display_name)
  on conflict (zalo_app_id, zalo_user_id) do update
    set tenant_id = excluded.tenant_id,
        user_id = excluded.user_id,
        display_name = coalesce(excluded.display_name, public.zalo_identities.display_name)
  returning * into v_identity;
  v_profile := app.zalo_member_profile(p_zalo_app_id, v_identity.user_id);
  return v_profile || jsonb_build_object('display_name', v_identity.display_name);
end;
$$;

comment on function app.zalo_sign_in(uuid, text, text, text, timestamptz) is 'the database half of zalo-session: a Zalo user id already bound to a current member answers bound with the profile; otherwise a valid binding code binds the identity once, and anything else answers unpaired without saying why';

create function public.zalo_session_app(p_brand_key text, p_tenant_id uuid default null)
returns table (tenant_id uuid, tenant_slug text, zalo_app_id uuid, secret_name text, status text)
language sql
stable
set search_path = ''
as $$
  select * from app.zalo_resolve_app(p_brand_key, p_tenant_id);
$$;

comment on function public.zalo_session_app(text, uuid) is 'RPC for the zalo-session and zalo-phone Edge Functions only (service_role): app.zalo_resolve_app';

create function public.zalo_session_sign_in(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_binding_code text default null
)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.zalo_sign_in(p_zalo_app_id, p_zalo_user_id, p_display_name, p_binding_code, now());
$$;

comment on function public.zalo_session_sign_in(uuid, text, text, text) is 'RPC for the zalo-session Edge Function only (service_role): app.zalo_sign_in at the current time';

create function app.custom_access_token_claims(event jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'claims',
    coalesce(event -> 'claims', '{}'::jsonb) || jsonb_build_object(
      'memberships',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('tenant_id', m.tenant_id, 'role', m.role, 'store_ids', to_jsonb(m.store_ids))
            order by m.tenant_id
          )
          from public.tenant_members m
          where m.user_id = case
            when (event ->> 'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (event ->> 'user_id')::uuid
          end
        ),
        '[]'::jsonb
      )
    )
  );
$$;

comment on function app.custom_access_token_claims(jsonb) is 'Supabase Auth custom access-token hook: keeps every claim and sets memberships to the login''s tenant, role and store scope (store_ids null for every store), one entry per tenant; RLS still reads tenant_members';

grant usage on schema app to supabase_auth_admin;

revoke all on function app.zalo_binding_code_hash(uuid, text) from public, anon, authenticated;
revoke all on function app.issue_zalo_binding_code(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.zalo_member_profile(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.zalo_resolve_app(text, uuid) from public, anon, authenticated;
revoke all on function app.zalo_sign_in(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zalo_session_app(text, uuid) from public, anon, authenticated;
revoke all on function public.zalo_session_sign_in(uuid, text, text, text) from public, anon, authenticated;
revoke all on function app.custom_access_token_claims(jsonb) from public, anon, authenticated, service_role;

grant execute on function app.zalo_resolve_app(text, uuid) to service_role;
grant execute on function app.zalo_sign_in(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.zalo_session_app(text, uuid) to service_role;
grant execute on function public.zalo_session_sign_in(uuid, text, text, text) to service_role;
grant execute on function app.custom_access_token_claims(jsonb) to supabase_auth_admin;
