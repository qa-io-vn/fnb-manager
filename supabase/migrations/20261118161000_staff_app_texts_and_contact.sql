create function app.text_holds_link(p_text text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_text ~* '[a-z][a-z0-9+.-]*://'
    or p_text ~* '(^|[^[:alnum:]_.-])www\.[[:alnum:]-]'
    or p_text ~ '[[:alnum:]-]\.[a-z]{2,}/'
    or p_text ~* '(^|[^@[:alnum:]_.-])[[:alnum:]-]+(\.[[:alnum:]-]+)*\.(com|net|org|vn|me|io|co|info|biz|app|dev|link|page|site|online|shop|store)\M';
$$;

comment on function app.text_holds_link(text) is 'whether a plain text holds a link: a URL scheme followed by //, a www. host, a host name with a lower-case top-level domain followed by a path (zalo.me/…), or a host name ending in a common top-level domain (example.com, example.vn); the domain of an e-mail address, a phone number and dotted numbers or abbreviations (TP.HCM) are not links';

alter table public.tenants
  add column staff_contact_instructions text
    constraint tenants_staff_contact_instructions_plain check (
      staff_contact_instructions is null
      or (
        char_length(staff_contact_instructions) between 1 and 500
        and staff_contact_instructions = btrim(staff_contact_instructions, E' \n\t')
        and translate(staff_contact_instructions, E'\n\t', '') !~ '[[:cntrl:]]'
        and not app.text_holds_link(staff_contact_instructions)
      )
    );

comment on column public.tenants.staff_contact_instructions is 'the contact instructions every brand''s staff app shows before pairing and on its refusal screen (zalo-session answers them as contact): plain text of 1 to 500 characters, line breaks allowed, no other control character and no link; null shows the app''s own fallback; written by an owner with an unlimited scope through set_staff_contact_instructions';

create function app.staff_contact_instructions(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.staff_contact_instructions from public.tenants t where t.id = p_tenant_id;
$$;

comment on function app.staff_contact_instructions(uuid) is 'the tenant''s staff contact instructions, or null when none are set';

create function app.set_staff_contact_instructions(p_tenant_id uuid, p_text text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(replace(replace(p_text, E'\r\n', E'\n'), E'\r', E'\n'), E' \n\t'), '');
begin
  if not app.has_store_scope(p_tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store sets the staff contact instructions' using errcode = '42501';
  end if;
  if v_text is not null and char_length(v_text) > 500 then
    raise exception 'the staff contact instructions hold at most 500 characters' using errcode = '22023';
  end if;
  if v_text is not null and translate(v_text, E'\n\t', '') ~ '[[:cntrl:]]' then
    raise exception 'the staff contact instructions are plain text without control characters' using errcode = '22023';
  end if;
  if v_text is not null and app.text_holds_link(v_text) then
    raise exception 'the staff contact instructions hold no link' using errcode = '22023';
  end if;
  update public.tenants t
  set staff_contact_instructions = v_text,
      profile_updated_at = now(),
      profile_updated_by = (select auth.uid())
  where t.id = p_tenant_id;
  return v_text;
end;
$$;

comment on function app.set_staff_contact_instructions(uuid, text) is 'sets tenants.staff_contact_instructions as an owner with an unlimited scope and returns what was stored: line breaks made \n, the ends trimmed, an empty text stored as null; more than 500 characters, a control character other than a line break or tab, or a link gives 22023; stamps the tenant profile';

create function public.set_staff_contact_instructions(p_tenant_id uuid, p_text text)
returns text
language sql
volatile
set search_path = ''
as $$
  select app.set_staff_contact_instructions(p_tenant_id, p_text);
$$;

comment on function public.set_staff_contact_instructions(uuid, text) is 'RPC: app.set_staff_contact_instructions';

create or replace function app.zalo_unpaired(p_tenant_id uuid, p_reason text default null, p_retry_after integer default null)
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
    'notice', app.published_staff_notice(p_tenant_id),
    'contact', app.staff_contact_instructions(p_tenant_id)
  ));
$$;

comment on function app.zalo_unpaired(uuid, text, integer) is 'the unpaired answer of the sign-in functions: the tenant''s published staff notice and its staff contact instructions when there are, and for a pairing request the reason (code_refused for a wrong, expired, used or burnt code, never saying which; wait with retry_after seconds; notice_outdated when the accepted notice is not the published one)';

create or replace function app.staff_ops_gate(
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
    'notice', app.published_staff_notice(p_tenant_id),
    'contact', app.staff_contact_instructions(p_tenant_id)
  ));
end;
$$;

comment on function app.staff_ops_gate(uuid, uuid, text, timestamptz, timestamptz) is 'the consent check of a sign-in: null when the login is not on the tenant''s staff roster or its staff_ops consent is current, or when a valid acceptance of the published notice comes with the request (the consent is then recorded); otherwise the notice_required answer with the notice and the staff contact instructions';

create or replace function app.zalo_member_profile(p_zalo_app_id uuid, p_user_id uuid)
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
    'stores', coalesce(s.names, '[]'::jsonb),
    'brand_store_ids', coalesce(s.ids, '[]'::jsonb)
  )
  from public.zalo_apps a
  join public.brands b on b.id = a.brand_id and b.tenant_id = a.tenant_id
  join public.tenant_members m on m.tenant_id = a.tenant_id and m.user_id = p_user_id
  cross join lateral (
    select
      jsonb_agg(st.name order by st.name, st.id) as names,
      jsonb_agg(st.id order by st.name, st.id) as ids
    from public.stores st
    where st.tenant_id = m.tenant_id
      and st.id = any (b.store_ids)
      and (m.store_ids is null or st.id = any (m.store_ids))
  ) as s
  where a.id = p_zalo_app_id;
$$;

comment on function app.zalo_member_profile(uuid, uuid) is 'the membership a Mini App session shows: role, store scope (store_ids, null for every store), and the brand''s stores in that scope as names (stores) and ids (brand_store_ids) in the same order, by name; null when the login is no longer a member of the app''s tenant';

create or replace function app.my_staff_notice(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hint text;
begin
  if v_user is null or not exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = v_user
  ) then
    raise exception 'only a member of the tenant reads their staff notice state' using errcode = '42501';
  end if;
  select r.phone_hint into v_hint
  from public.staff_roster r
  where r.tenant_id = p_tenant_id
    and r.user_id = v_user;
  return jsonb_build_object(
    'consent',
    case
      when not exists (select 1 from public.staff_roster r where r.tenant_id = p_tenant_id and r.user_id = v_user) then 'not_required'
      else app.staff_ops_consent_state(p_tenant_id, v_user)
    end,
    'notice',
    app.published_staff_notice(p_tenant_id)
  ) || case when v_hint is null then '{}'::jsonb else jsonb_build_object('phone_hint', v_hint) end;
end;
$$;

comment on function app.my_staff_notice(uuid) is 'the signed-in member''s staff notice state in the tenant: consent current, outdated, missing, or not_required for a member who is not on the staff roster, the published notice (null when none) and, once the person linked a phone, phone_hint (… and its last three digits)';

create table app.zalo_texts_requests (
  zalo_app_id uuid primary key references public.zalo_apps (id) on delete cascade,
  window_started_at timestamptz not null,
  requests integer not null check (requests >= 1)
);

comment on table app.zalo_texts_requests is 'the rate limit of zalo-session''s texts request, which needs no Zalo identity: requests per Zalo App in the current one-minute window; past 120 the app''s texts answer wait until the window ends; no caller detail is kept';

revoke all on table app.zalo_texts_requests from public, anon, authenticated, service_role;

create function app.zalo_texts(p_zalo_app_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app public.zalo_apps;
  v_started timestamptz;
  v_requests integer;
begin
  select a.* into v_app from public.zalo_apps a where a.id = p_zalo_app_id;
  if not found then
    raise exception 'unknown Zalo App' using errcode = '22023';
  end if;
  if v_app.status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_at is null then
    raise exception 'a texts request needs its time' using errcode = '22023';
  end if;
  insert into app.zalo_texts_requests as r (zalo_app_id, window_started_at, requests)
  values (p_zalo_app_id, p_at, 1)
  on conflict (zalo_app_id) do update
    set window_started_at = case
          when r.window_started_at > excluded.window_started_at
            or r.window_started_at <= excluded.window_started_at - interval '1 minute'
            then excluded.window_started_at
          else r.window_started_at
        end,
        requests = case
          when r.window_started_at > excluded.window_started_at
            or r.window_started_at <= excluded.window_started_at - interval '1 minute'
            then 1
          else least(r.requests + 1, 1000000)
        end
  returning r.window_started_at, r.requests into v_started, v_requests;
  if v_requests > 120 then
    return jsonb_build_object(
      'status', 'wait',
      'retry_after', greatest(1, ceil(extract(epoch from v_started + interval '1 minute' - p_at))::integer)
    );
  end if;
  return jsonb_build_object(
    'status', 'texts',
    'documents', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'kind', d.kind,
            'language', d.language,
            'version', d.version,
            'title', d.title,
            'body_markdown', d.body_markdown,
            'published_at', d.published_at
          )
          order by d.kind, d.language <> 'vi', d.language
        )
        from public.legal_documents d
        where d.tenant_id = v_app.tenant_id
          and d.status = 'published'
          and d.kind in ('privacy_notice', 'mini_app_terms')
      ),
      '[]'::jsonb
    ),
    'contact', app.staff_contact_instructions(v_app.tenant_id)
  );
end;
$$;

comment on function app.zalo_texts(uuid, timestamptz) is 'the database half of zalo-session''s texts request, before any pairing: the published privacy_notice and mini_app_terms of the app''s tenant in every published language ({kind, language, version, title, body_markdown, published_at}, privacy first, Vietnamese first) and the tenant''s staff contact instructions (null when none), nothing else; past 120 requests per app in a minute the answer is wait with retry_after seconds';

create function public.zalo_session_texts(p_zalo_app_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.zalo_texts(p_zalo_app_id, now());
$$;

comment on function public.zalo_session_texts(uuid) is 'RPC for the zalo-session Edge Function only (service_role): app.zalo_texts at the current time';

revoke all on function app.text_holds_link(text) from public, anon, authenticated, service_role;
revoke all on function app.staff_contact_instructions(uuid) from public, anon, authenticated, service_role;
revoke all on function app.set_staff_contact_instructions(uuid, text) from public, anon, service_role;
revoke all on function public.set_staff_contact_instructions(uuid, text) from public, anon, service_role;
revoke all on function app.zalo_texts(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.zalo_session_texts(uuid) from public, anon, authenticated;

grant execute on function app.text_holds_link(text) to authenticated, service_role;
grant execute on function app.set_staff_contact_instructions(uuid, text) to authenticated;
grant execute on function public.set_staff_contact_instructions(uuid, text) to authenticated;
grant execute on function app.zalo_texts(uuid, timestamptz) to service_role;
grant execute on function public.zalo_session_texts(uuid) to service_role;
