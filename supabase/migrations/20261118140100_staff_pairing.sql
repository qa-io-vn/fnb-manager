create table app.staff_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  roster_id uuid not null,
  code_sha256 text not null check (code_sha256 ~ '^[0-9a-f]{64}$'),
  issued_by uuid references auth.users (id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  unique (roster_id),
  unique (tenant_id, code_sha256),
  foreign key (tenant_id, roster_id) references public.staff_roster (tenant_id, id) on delete cascade
);

comment on table app.staff_pairing_codes is 'one-time 6-digit pairing codes that owners and managers issue for a roster row (app.issue_pairing_code): one live code per row, stored only as sha256(tenant_id:code), valid 10 minutes in every brand app of the tenant; a wrong code counts against every live code of the tenant and the sixth wrong attempt burns them';
comment on column app.staff_pairing_codes.failed_attempts is 'wrong codes sent in the tenant''s apps while this code was live; at 5 the next wrong attempt deletes the row';

revoke all on table app.staff_pairing_codes from public, anon, authenticated, service_role;

create table app.staff_pairing_attempts (
  zalo_app_id uuid not null references public.zalo_apps (id) on delete cascade,
  identity_sha256 text not null check (identity_sha256 ~ '^[0-9a-f]{64}$'),
  failed_attempts smallint not null check (failed_attempts between 1 and 5),
  last_failed_at timestamptz not null,
  locked_until timestamptz,
  primary key (zalo_app_id, identity_sha256),
  check (locked_until is null or (failed_attempts = 5 and locked_until > last_failed_at))
);

comment on table app.staff_pairing_attempts is 'wrong pairing codes per Zalo identity, keyed by sha256(zalo_app_id:zalo_user_id) so no Zalo user id is kept for a person who never paired: the fifth wrong code within 15 minutes makes the identity wait 15 minutes; a row goes once it is stale or the identity pairs';

revoke all on table app.staff_pairing_attempts from public, anon, authenticated, service_role;

create function app.staff_pairing_code_hash(p_tenant_id uuid, p_code text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select app.sha256_hex(p_tenant_id::text || ':' || p_code);
$$;

comment on function app.staff_pairing_code_hash(uuid, text) is 'the stored form of a pairing code: sha256 of the tenant id and the code';

create function app.issue_pairing_code(p_roster_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.staff_roster;
  v_at timestamptz := now();
  v_code text;
  v_tries integer := 0;
begin
  select r.* into v_row
  from public.staff_roster r
  where r.id = p_roster_id
  for update;
  if not found or not app.can_manage_staff(v_row.tenant_id, v_row.store_ids) then
    raise exception 'the roster entry cannot be changed by this member' using errcode = '42501';
  end if;
  if v_row.status = 'inactive' then
    raise exception 'an inactive roster entry gets no pairing code; reactivate it first' using errcode = '22023';
  end if;
  if v_row.user_id is not null and exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = v_row.tenant_id
      and m.user_id = v_row.user_id
      and m.role not in ('staff', 'manager')
  ) then
    raise exception 'the roster entry belongs to a login that is an owner, viewer or publisher of the tenant' using errcode = '22023';
  end if;
  delete from app.staff_pairing_codes c
  where c.roster_id = v_row.id
     or (c.tenant_id = v_row.tenant_id and c.expires_at <= v_at);
  loop
    v_code := app.notify_random_code('0123456789', 6);
    begin
      insert into app.staff_pairing_codes (tenant_id, roster_id, code_sha256, issued_by, issued_at, expires_at)
      values (v_row.tenant_id, v_row.id, app.staff_pairing_code_hash(v_row.tenant_id, v_code), (select auth.uid()), v_at, v_at + interval '10 minutes');
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

comment on function app.issue_pairing_code(uuid) is 'issues the one-time 6-digit pairing code of a roster row that is not inactive, for an owner or manager whose scope holds every store of the row, and returns it once; a new code replaces the row''s previous one';

create function app.drop_pairing_codes_of_inactive_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.staff_pairing_codes c where c.roster_id = new.id;
  return new;
end;
$$;

comment on function app.drop_pairing_codes_of_inactive_staff() is 'trigger after a roster row becomes inactive: its live pairing code is deleted';

create trigger staff_roster_drop_pairing_codes
after update of status on public.staff_roster
for each row
when (new.status = 'inactive' and old.status is distinct from 'inactive')
execute function app.drop_pairing_codes_of_inactive_staff();

create function app.zalo_unpaired(p_tenant_id uuid, p_reason text default null, p_retry_after integer default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', 'unpaired',
    'reason', p_reason,
    'retry_after', p_retry_after,
    'notice', app.published_staff_notice(p_tenant_id)
  ));
$$;

comment on function app.zalo_unpaired(uuid, text, integer) is 'the unpaired answer of the sign-in functions: the tenant''s published staff notice when there is one, and for a pairing request the reason (code_refused for a wrong, expired, used or burnt code, never saying which; wait with retry_after seconds; notice_outdated when the accepted notice is not the published one)';

create function app.staff_ops_gate(
  p_tenant_id uuid,
  p_user_id uuid,
  p_notice_version text default null,
  p_notice_shown_at timestamptz default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_roster r
    where r.tenant_id = p_tenant_id
      and r.user_id = p_user_id
  ) then
    return null;
  end if;
  if app.staff_ops_consent_state(p_tenant_id, p_user_id) = 'current' then
    return null;
  end if;
  if app.staff_notice_acceptance_valid(p_tenant_id, p_notice_version, p_notice_shown_at, p_at) then
    perform app.record_staff_ops_consent(p_tenant_id, p_user_id, p_notice_version, p_notice_shown_at, p_at);
    return null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'notice_required',
    'notice', app.published_staff_notice(p_tenant_id)
  ));
end;
$$;

comment on function app.staff_ops_gate(uuid, uuid, text, timestamptz, timestamptz) is 'the consent check of a sign-in: null when the login is not on the tenant''s staff roster or its staff_ops consent is current, or when a valid acceptance of the published notice comes with the request (the consent is then recorded); otherwise the notice_required answer with the notice';

create or replace function app.zalo_sign_in(
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
  v_tenant_id uuid;
  v_identity public.zalo_identities;
  v_profile jsonb;
  v_gate jsonb;
  v_code app.zalo_binding_codes;
  v_display_name text := nullif(btrim(p_display_name), '');
begin
  select a.status, a.tenant_id into v_status, v_tenant_id from public.zalo_apps a where a.id = p_zalo_app_id;
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
      v_gate := app.staff_ops_gate(v_tenant_id, v_identity.user_id, null, null, p_at);
      if v_gate is not null then
        return v_gate;
      end if;
      return v_profile || jsonb_build_object('display_name', v_identity.display_name);
    end if;
  end if;

  if p_binding_code is null then
    return app.zalo_unpaired(v_tenant_id);
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
    return app.zalo_unpaired(v_tenant_id);
  end if;

  delete from app.zalo_binding_codes c where c.id = v_code.id;
  insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
  values (v_code.tenant_id, p_zalo_app_id, p_zalo_user_id, v_code.user_id, v_display_name)
  on conflict (zalo_app_id, zalo_user_id) do update
    set tenant_id = excluded.tenant_id,
        user_id = excluded.user_id,
        display_name = coalesce(excluded.display_name, public.zalo_identities.display_name)
  returning * into v_identity;
  v_gate := app.staff_ops_gate(v_tenant_id, v_identity.user_id, null, null, p_at);
  if v_gate is not null then
    return v_gate;
  end if;
  v_profile := app.zalo_member_profile(p_zalo_app_id, v_identity.user_id);
  return v_profile || jsonb_build_object('display_name', v_identity.display_name);
end;
$$;

comment on function app.zalo_sign_in(uuid, text, text, text, timestamptz) is 'the database half of zalo-session without a pairing step: a Zalo user id already bound to a current member answers bound with the profile, or notice_required for a person on the staff roster whose staff_ops consent is missing or outdated; otherwise a valid binding code binds the identity once, and anything else answers unpaired (with the published staff notice) without saying why';

create function app.staff_login_is_fresh(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id)
    and not exists (select 1 from public.tenant_members m where m.user_id = p_user_id)
    and not exists (select 1 from public.staff_roster r where r.user_id = p_user_id)
    and not exists (select 1 from public.zalo_identities i where i.user_id = p_user_id);
$$;

comment on function app.staff_login_is_fresh(uuid) is 'whether an Auth user exists and belongs to nobody yet: no membership, roster row or Zalo identity in any tenant; only such a login is given to a roster row at its first pairing';

create function app.zalo_pair(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_code text default null,
  p_notice_version text default null,
  p_notice_shown_at timestamptz default null,
  p_new_user_id uuid default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app public.zalo_apps;
  v_identity public.zalo_identities;
  v_profile jsonb;
  v_gate jsonb;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_identity_hash text;
  v_attempt app.staff_pairing_attempts;
  v_pairing app.staff_pairing_codes;
  v_binding app.zalo_binding_codes;
  v_roster public.staff_roster;
  v_user uuid;
  v_failures smallint;
begin
  select a.* into v_app from public.zalo_apps a where a.id = p_zalo_app_id;
  if not found then
    raise exception 'unknown Zalo App' using errcode = '22023';
  end if;
  if v_app.status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_zalo_user_id is null or p_zalo_user_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'the Zalo user id is malformed' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^[0-9]{6}$' then
    raise exception 'a pairing code has six digits' using errcode = '22023';
  end if;
  if p_notice_version is not null and p_notice_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$' then
    raise exception 'a notice version is a legal document version' using errcode = '22023';
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
      v_gate := app.staff_ops_gate(v_app.tenant_id, v_identity.user_id, p_notice_version, p_notice_shown_at, p_at);
      if v_gate is not null then
        return v_gate;
      end if;
      return v_profile || jsonb_build_object('display_name', v_identity.display_name);
    end if;
  end if;

  if p_code is null then
    return app.zalo_unpaired(v_app.tenant_id);
  end if;

  v_identity_hash := app.sha256_hex(p_zalo_app_id::text || ':' || p_zalo_user_id);
  delete from app.staff_pairing_attempts t
  where t.zalo_app_id = p_zalo_app_id
    and coalesce(t.locked_until, t.last_failed_at + interval '15 minutes') <= p_at;
  select * into v_attempt
  from app.staff_pairing_attempts t
  where t.zalo_app_id = p_zalo_app_id and t.identity_sha256 = v_identity_hash
  for update;
  if found and v_attempt.locked_until is not null then
    return app.zalo_unpaired(v_app.tenant_id, 'wait', ceil(extract(epoch from v_attempt.locked_until - p_at))::integer);
  end if;

  if not app.staff_notice_acceptance_valid(v_app.tenant_id, p_notice_version, p_notice_shown_at, p_at) then
    return app.zalo_unpaired(v_app.tenant_id, 'notice_outdated');
  end if;

  delete from app.staff_pairing_codes c
  where c.tenant_id = v_app.tenant_id and c.expires_at <= p_at;
  select * into v_pairing
  from app.staff_pairing_codes c
  where c.tenant_id = v_app.tenant_id
    and c.code_sha256 = app.staff_pairing_code_hash(v_app.tenant_id, p_code)
  for update;
  if found then
    select r.* into v_roster
    from public.staff_roster r
    where r.tenant_id = v_pairing.tenant_id and r.id = v_pairing.roster_id
    for update;
    if v_roster.status = 'inactive' or exists (
      select 1
      from public.tenant_members m
      where m.tenant_id = v_roster.tenant_id
        and m.user_id = v_roster.user_id
        and m.role not in ('staff', 'manager')
    ) then
      delete from app.staff_pairing_codes c where c.id = v_pairing.id;
      v_pairing := null;
    end if;
  end if;

  if v_pairing.id is not null then
    v_user := v_roster.user_id;
    if v_user is null then
      if p_new_user_id is null then
        return jsonb_build_object('status', 'login_needed');
      end if;
      if not app.staff_login_is_fresh(p_new_user_id) then
        raise exception 'the login offered for a first pairing already belongs to someone' using errcode = '22023';
      end if;
      v_user := p_new_user_id;
      update public.staff_roster r set user_id = v_user where r.id = v_roster.id;
    end if;
    perform app.record_staff_ops_consent(v_roster.tenant_id, v_user, p_notice_version, p_notice_shown_at, p_at);
    insert into public.tenant_members (tenant_id, user_id, role, store_ids)
    values (v_roster.tenant_id, v_user, v_roster.role, v_roster.store_ids)
    on conflict (tenant_id, user_id) do update
      set role = excluded.role,
          store_ids = excluded.store_ids;
    insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
    values (v_roster.tenant_id, p_zalo_app_id, p_zalo_user_id, v_user, v_display_name)
    on conflict (zalo_app_id, zalo_user_id) do update
      set tenant_id = excluded.tenant_id,
          user_id = excluded.user_id,
          display_name = coalesce(excluded.display_name, public.zalo_identities.display_name)
    returning * into v_identity;
    update public.staff_roster r
    set status = 'active', paired_at = p_at
    where r.id = v_roster.id;
    delete from app.staff_pairing_codes c where c.id = v_pairing.id;
    delete from app.staff_pairing_attempts t
    where t.zalo_app_id = p_zalo_app_id and t.identity_sha256 = v_identity_hash;
    return app.zalo_member_profile(p_zalo_app_id, v_user) || jsonb_build_object('display_name', v_identity.display_name);
  end if;

  delete from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id and c.expires_at <= p_at;
  select * into v_binding
  from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id
    and c.code_sha256 = app.zalo_binding_code_hash(p_zalo_app_id, p_code)
    and c.expires_at > p_at
  for update;
  if found then
    delete from app.zalo_binding_codes c where c.id = v_binding.id;
    insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
    values (v_binding.tenant_id, p_zalo_app_id, p_zalo_user_id, v_binding.user_id, v_display_name)
    on conflict (zalo_app_id, zalo_user_id) do update
      set tenant_id = excluded.tenant_id,
          user_id = excluded.user_id,
          display_name = coalesce(excluded.display_name, public.zalo_identities.display_name)
    returning * into v_identity;
    delete from app.staff_pairing_attempts t
    where t.zalo_app_id = p_zalo_app_id and t.identity_sha256 = v_identity_hash;
    v_gate := app.staff_ops_gate(v_app.tenant_id, v_identity.user_id, p_notice_version, p_notice_shown_at, p_at);
    if v_gate is not null then
      return v_gate;
    end if;
    return app.zalo_member_profile(p_zalo_app_id, v_identity.user_id) || jsonb_build_object('display_name', v_identity.display_name);
  end if;

  delete from app.staff_pairing_codes c
  where c.tenant_id = v_app.tenant_id and c.failed_attempts >= 5;
  update app.staff_pairing_codes c
  set failed_attempts = c.failed_attempts + 1
  where c.tenant_id = v_app.tenant_id;
  delete from app.zalo_binding_codes c
  where c.zalo_app_id = p_zalo_app_id and c.failed_attempts >= 5;
  update app.zalo_binding_codes c
  set failed_attempts = c.failed_attempts + 1
  where c.zalo_app_id = p_zalo_app_id;
  insert into app.staff_pairing_attempts as t (zalo_app_id, identity_sha256, failed_attempts, last_failed_at)
  values (p_zalo_app_id, v_identity_hash, 1, p_at)
  on conflict (zalo_app_id, identity_sha256) do update
    set failed_attempts = t.failed_attempts + 1,
        last_failed_at = excluded.last_failed_at,
        locked_until = case when t.failed_attempts + 1 >= 5 then excluded.last_failed_at + interval '15 minutes' end
  returning t.failed_attempts into v_failures;
  if v_failures >= 5 then
    return app.zalo_unpaired(v_app.tenant_id, 'wait', 900);
  end if;
  return app.zalo_unpaired(v_app.tenant_id, 'code_refused');
end;
$$;

comment on function app.zalo_pair(uuid, text, text, text, text, timestamptz, uuid, timestamptz) is 'the database half of zalo-session''s pairing step, after the person read the staff notice: a bound identity signs in, recording the acceptance when its staff_ops consent is missing or outdated; a valid pairing code of a roster row that is not inactive (or a phase 13 binding code) records the staff_ops consent, creates or updates the membership with the roster role and stores, binds the Zalo identity, sets the row active and answers bound; a row without a login answers login_needed until zalo-session passes a fresh login; a wrong code counts against every live code of the tenant and against the identity, which waits 15 minutes after its fifth; refusals never say whether a roster row exists';

create function app.link_my_phone(p_tenant_id uuid, p_phone text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_phone text := nullif(btrim(p_phone), '');
  v_hint text;
begin
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'a phone number is linked in international form' using errcode = '22023';
  end if;
  update public.staff_roster r
  set phone = v_phone,
      phone_linked_at = case when v_phone is null then null else now() end
  where r.tenant_id = p_tenant_id
    and r.user_id = v_user
    and r.status = 'active'
    and v_user is not null
  returning r.phone_hint into v_hint;
  if not found then
    raise exception 'only a paired person on the staff roster links their own phone' using errcode = '42501';
  end if;
  return v_hint;
end;
$$;

comment on function app.link_my_phone(uuid, text) is 'the signed-in person stores the phone number zalo-phone decoded for them on their own active roster row of the tenant (international form) and gets its hint back; null removes it; nobody else can write it';

create function public.issue_pairing_code(p_roster_id uuid)
returns text
language sql
volatile
set search_path = ''
as $$
  select app.issue_pairing_code(p_roster_id);
$$;

comment on function public.issue_pairing_code(uuid) is 'RPC: app.issue_pairing_code';

create function public.link_my_phone(p_tenant_id uuid, p_phone text)
returns text
language sql
volatile
set search_path = ''
as $$
  select app.link_my_phone(p_tenant_id, p_phone);
$$;

comment on function public.link_my_phone(uuid, text) is 'RPC: app.link_my_phone';

create function public.zalo_session_pair(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_code text default null,
  p_notice_version text default null,
  p_notice_shown_at timestamptz default null,
  p_new_user_id uuid default null
)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.zalo_pair(p_zalo_app_id, p_zalo_user_id, p_display_name, p_code, p_notice_version, p_notice_shown_at, p_new_user_id, now());
$$;

comment on function public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid) is 'RPC for the zalo-session Edge Function only (service_role): app.zalo_pair at the current time';

revoke all on function app.staff_pairing_code_hash(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.issue_pairing_code(uuid) from public, anon, service_role;
revoke all on function app.drop_pairing_codes_of_inactive_staff() from public, anon, authenticated, service_role;
revoke all on function app.zalo_unpaired(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function app.staff_ops_gate(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_login_is_fresh(uuid) from public, anon, authenticated, service_role;
revoke all on function app.zalo_pair(uuid, text, text, text, text, timestamptz, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.link_my_phone(uuid, text) from public, anon, service_role;
revoke all on function public.issue_pairing_code(uuid) from public, anon, service_role;
revoke all on function public.link_my_phone(uuid, text) from public, anon, service_role;
revoke all on function public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;

grant execute on function app.issue_pairing_code(uuid) to authenticated;
grant execute on function app.link_my_phone(uuid, text) to authenticated;
grant execute on function app.zalo_pair(uuid, text, text, text, text, timestamptz, uuid, timestamptz) to service_role;
grant execute on function public.issue_pairing_code(uuid) to authenticated;
grant execute on function public.link_my_phone(uuid, text) to authenticated;
grant execute on function public.zalo_session_pair(uuid, text, text, text, text, timestamptz, uuid) to service_role;
