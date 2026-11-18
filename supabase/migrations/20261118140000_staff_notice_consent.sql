create function app.published_staff_notice(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', d.version,
    'title', d.title,
    'body_markdown', d.body_markdown,
    'published_at', d.published_at
  )
  from public.legal_documents d
  where d.tenant_id = p_tenant_id
    and d.kind = 'staff_notice'
    and d.language = 'vi'
    and d.status = 'published';
$$;

comment on function app.published_staff_notice(uuid) is 'the staff notice a person reads before pairing: the published Vietnamese staff_notice of the tenant as {version, title, body_markdown, published_at}, or null when none is published';

create function app.staff_ops_consent_state(p_tenant_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.policy_version is null then 'missing'
    when n.version is null or c.policy_version = n.version then 'current'
    else 'outdated'
  end
  from (select 1) as anchor
  left join lateral (
    select r.policy_version
    from public.consent_records r
    where r.tenant_id = p_tenant_id
      and r.subject_type = 'staff'
      and r.subject_id = p_user_id
      and r.purpose = 'staff_ops'
      and r.revoked_at is null
  ) as c on true
  left join lateral (
    select d.version
    from public.legal_documents d
    where d.tenant_id = p_tenant_id
      and d.kind = 'staff_notice'
      and d.language = 'vi'
      and d.status = 'published'
  ) as n on true;
$$;

comment on function app.staff_ops_consent_state(uuid, uuid) is 'the person''s staff_ops consent in the tenant: missing (no active row), outdated (the active row names a version other than the published staff notice) or current (it names the published version, or no notice is published)';

create function app.staff_notice_acceptance_valid(p_tenant_id uuid, p_notice_version text, p_notice_shown_at timestamptz, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_notice_version is not null
    and p_notice_shown_at is not null
    and p_at is not null
    and exists (
      select 1
      from public.legal_documents d
      where d.tenant_id = p_tenant_id
        and d.kind = 'staff_notice'
        and d.language = 'vi'
        and d.status = 'published'
        and d.version = p_notice_version
        and p_notice_shown_at >= d.published_at - interval '5 minutes'
        and p_notice_shown_at <= p_at + interval '5 minutes'
    );
$$;

comment on function app.staff_notice_acceptance_valid(uuid, text, timestamptz, timestamptz) is 'whether an acceptance names the published staff notice and a showing time between its publication and the acceptance, five minutes of clock skew allowed on each side';

create function app.record_staff_ops_consent(
  p_tenant_id uuid,
  p_user_id uuid,
  p_notice_version text,
  p_notice_shown_at timestamptz,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_active public.consent_records;
  v_id uuid;
begin
  if p_tenant_id is null or p_user_id is null then
    raise exception 'a staff_ops consent needs a tenant and a person' using errcode = '22023';
  end if;
  if not app.staff_notice_acceptance_valid(p_tenant_id, p_notice_version, p_notice_shown_at, p_at) then
    raise exception 'the accepted staff notice is not the published one, or was not shown before the acceptance' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff_ops:' || p_tenant_id::text || ':' || p_user_id::text, 0));
  select c.* into v_active
  from public.consent_records c
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'staff'
    and c.subject_id = p_user_id
    and c.purpose = 'staff_ops'
    and c.revoked_at is null
  for update;
  if found then
    if v_active.policy_version = p_notice_version then
      return v_active.id;
    end if;
    update public.consent_records c
    set revoked_at = greatest(p_at, c.granted_at)
    where c.id = v_active.id;
  end if;
  insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
  values (
    p_tenant_id, 'staff', p_user_id, 'staff_ops', p_notice_version, 'mini_app', p_at,
    jsonb_build_object(
      'method', 'accept_button',
      'notice_version', p_notice_version,
      'notice_channel', 'mini_app',
      'notice_shown_at', p_notice_shown_at,
      'accepted_at', p_at
    )
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.record_staff_ops_consent(uuid, uuid, text, timestamptz, timestamptz) is 'records the person''s own acceptance of the published staff notice as their staff_ops consent (channel mini_app, policy_version the notice version, evidence method, notice_version, notice_channel, notice_shown_at and accepted_at, never a Zalo id, phone or device detail); the same version already active is kept, an outdated one is closed at the new acceptance; reached only from the pairing step and the person''s own session';

create function app.revoke_staff_ops_consent(p_tenant_id uuid, p_user_id uuid, p_at timestamptz default now())
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revoked integer;
begin
  update public.consent_records c
  set revoked_at = greatest(p_at, c.granted_at)
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'staff'
    and c.subject_id = p_user_id
    and c.purpose = 'staff_ops'
    and c.revoked_at is null;
  get diagnostics v_revoked = row_count;
  delete from public.zalo_identities i
  where i.tenant_id = p_tenant_id
    and i.user_id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  return v_revoked > 0;
end;
$$;

comment on function app.revoke_staff_ops_consent(uuid, uuid, timestamptz) is 'the effects of a staff_ops withdrawal: the active consent revoked, the person''s Zalo identities in the tenant unpaired and every Auth session of the login ended; the notifications consent, the membership and the roster row stay; returns whether a consent was active';

create function app.accept_staff_notice(p_tenant_id uuid, p_notice_version text, p_notice_shown_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not exists (
    select 1
    from public.staff_roster r
    join public.tenant_members m on m.tenant_id = r.tenant_id and m.user_id = r.user_id
    where r.tenant_id = p_tenant_id
      and r.user_id = v_user
      and r.status = 'active'
  ) then
    raise exception 'only a paired person on the staff roster accepts the staff notice for themselves' using errcode = '42501';
  end if;
  return app.record_staff_ops_consent(p_tenant_id, v_user, p_notice_version, p_notice_shown_at, now());
end;
$$;

comment on function app.accept_staff_notice(uuid, text, timestamptz) is 'the signed-in person''s own acceptance of the published staff notice from the staff app (a new version after pairing): records their staff_ops consent through app.record_staff_ops_consent; only for a paired person on the roster of the tenant';

create function app.withdraw_staff_ops_consent(p_tenant_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not exists (
    select 1
    from public.staff_roster r
    where r.tenant_id = p_tenant_id
      and r.user_id = v_user
  ) then
    raise exception 'only a person on the staff roster withdraws their own staff_ops consent' using errcode = '42501';
  end if;
  return app.revoke_staff_ops_consent(p_tenant_id, v_user, now());
end;
$$;

comment on function app.withdraw_staff_ops_consent(uuid) is 'the signed-in person withdraws their own staff_ops consent in the tenant: revoked, their Zalo identities there unpaired and their sessions ended, so the staff app needs a new pairing; the notifications consent is left as it is (Law 91/2025 Art. 9)';

create function app.my_staff_notice(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = v_user
  ) then
    raise exception 'only a member of the tenant reads their staff notice state' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'consent',
    case
      when not exists (select 1 from public.staff_roster r where r.tenant_id = p_tenant_id and r.user_id = v_user) then 'not_required'
      else app.staff_ops_consent_state(p_tenant_id, v_user)
    end,
    'notice',
    app.published_staff_notice(p_tenant_id)
  );
end;
$$;

comment on function app.my_staff_notice(uuid) is 'the signed-in member''s staff notice state in the tenant: consent current, outdated, missing, or not_required for a member who is not on the staff roster, and the published notice (null when none)';

create function public.accept_staff_notice(p_tenant_id uuid, p_notice_version text, p_notice_shown_at timestamptz)
returns uuid
language sql
volatile
set search_path = ''
as $$
  select app.accept_staff_notice(p_tenant_id, p_notice_version, p_notice_shown_at);
$$;

comment on function public.accept_staff_notice(uuid, text, timestamptz) is 'RPC: app.accept_staff_notice';

create function public.withdraw_staff_ops_consent(p_tenant_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select app.withdraw_staff_ops_consent(p_tenant_id);
$$;

comment on function public.withdraw_staff_ops_consent(uuid) is 'RPC: app.withdraw_staff_ops_consent';

create function public.my_staff_notice(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app.my_staff_notice(p_tenant_id);
$$;

comment on function public.my_staff_notice(uuid) is 'RPC: app.my_staff_notice';

create policy consent_records_staff_ops_not_inserted_from_browser on public.consent_records
  as restrictive
  for insert to authenticated
  with check (purpose <> 'staff_ops');

create policy consent_records_staff_ops_not_updated_from_browser on public.consent_records
  as restrictive
  for update to authenticated
  using (purpose <> 'staff_ops')
  with check (purpose <> 'staff_ops');

comment on type public.consent_purpose is 'what a consent record allows: loyalty for the membership programme, marketing for advertising messages, staff_ops for shift operations in the staff app, notifications for the daily digests and operational alerts a member receives on their own destinations; a notifications row is recorded only at the member''s own acceptance of the notice ops-notifications-v1, a staff_ops row only at the person''s own acceptance of the published staff notice (app.record_staff_ops_consent), and neither from the browser';

revoke all on function app.published_staff_notice(uuid) from public, anon, authenticated, service_role;
revoke all on function app.staff_ops_consent_state(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.staff_notice_acceptance_valid(uuid, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.record_staff_ops_consent(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.revoke_staff_ops_consent(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.accept_staff_notice(uuid, text, timestamptz) from public, anon, service_role;
revoke all on function app.withdraw_staff_ops_consent(uuid) from public, anon, service_role;
revoke all on function app.my_staff_notice(uuid) from public, anon, service_role;
revoke all on function public.accept_staff_notice(uuid, text, timestamptz) from public, anon, service_role;
revoke all on function public.withdraw_staff_ops_consent(uuid) from public, anon, service_role;
revoke all on function public.my_staff_notice(uuid) from public, anon, service_role;

grant execute on function app.accept_staff_notice(uuid, text, timestamptz) to authenticated;
grant execute on function app.withdraw_staff_ops_consent(uuid) to authenticated;
grant execute on function app.my_staff_notice(uuid) to authenticated;
grant execute on function public.accept_staff_notice(uuid, text, timestamptz) to authenticated;
grant execute on function public.withdraw_staff_ops_consent(uuid) to authenticated;
grant execute on function public.my_staff_notice(uuid) to authenticated;
