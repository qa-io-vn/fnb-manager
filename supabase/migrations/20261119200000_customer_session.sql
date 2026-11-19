create table app.customer_logins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  zalo_app_id uuid not null,
  zalo_user_id text not null check (zalo_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zalo_app_id, zalo_user_id),
  unique (user_id),
  foreign key (tenant_id, zalo_app_id) references public.zalo_apps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete set null (customer_id)
);

create index customer_logins_customer_idx on app.customer_logins (customer_id) where customer_id is not null;

comment on table app.customer_logins is 'the Auth login of a customer of the customer Mini App: one login per Zalo App and Zalo user id, never a login with a tenant_members row and never the staff login of zalo_identities; customer_id is set when the customer joins with a phone number; nothing else from Zalo is kept here (NFR-PRV-07); written only by zalo_customer_sign_in and customer_join';
comment on column app.customer_logins.customer_id is 'the customers row the login joined as, null for a visitor who has not joined';

create trigger customer_logins_set_updated_at before update on app.customer_logins for each row execute function app.set_updated_at();

revoke all on table app.customer_logins from public, anon, authenticated, service_role;

create function app.customer_store_code(p_code text, p_external_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(p_code) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then btrim(p_code)
    when btrim(p_external_id) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then btrim(p_external_id)
  end;
$$;

comment on function app.customer_store_code(text, text) is 'the link key the customer Mini App names a store by: the store''s code when it reads as 1 to 64 of A-Z, a-z, 0-9, ., _ and - starting with a letter or digit, else its POS external id under the same rule, else null (the store is not offered to customers); compared exactly';

create function app.customer_app_stores(p_zalo_app_id uuid)
returns table (store_id uuid, code text, name text, address text, opening_hours jsonb, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, app.customer_store_code(s.code, s.external_id), s.name, s.address, s.opening_hours, s.timezone
  from public.zalo_apps a
  join public.brands b on b.id = a.brand_id and b.tenant_id = a.tenant_id
  join public.stores s on s.tenant_id = b.tenant_id and s.id = any (b.store_ids)
  where a.id = p_zalo_app_id
    and s.active
    and app.customer_store_code(s.code, s.external_id) is not null;
$$;

comment on function app.customer_app_stores(uuid) is 'the active stores of the brand of a Zalo App that have a customer store code (app.customer_store_code)';

create function app.customer_app_store(p_zalo_app_id uuid, p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(s.store_id))[1] end
  from app.customer_app_stores(p_zalo_app_id) s
  where s.code = btrim(p_code);
$$;

comment on function app.customer_app_store(uuid, text) is 'the store of the Zalo App''s brand named by a customer store code, or null when no store or more than one carries it';

create function app.customer_session()
returns app.customer_logins
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := (select auth.jwt()) -> 'app_metadata';
  v_login app.customer_logins;
begin
  if v_metadata ->> 'kind' is distinct from 'customer' then
    raise exception 'a customer session is required' using errcode = '42501';
  end if;
  select l.* into v_login
  from app.customer_logins l
  join public.zalo_apps a on a.id = l.zalo_app_id and a.tenant_id = l.tenant_id
  where l.user_id = (select auth.uid())
    and a.status = 'active'
    and l.tenant_id::text = lower(v_metadata ->> 'tenant_id');
  if v_login.id is null or exists (select 1 from public.tenant_members m where m.user_id = v_login.user_id) then
    raise exception 'a customer session is required' using errcode = '42501';
  end if;
  return v_login;
end;
$$;

comment on function app.customer_session() is 'the customer login of the caller: a JWT whose app_metadata.kind is customer, whose app_metadata.tenant_id is the login''s tenant, signed in as a login of app.customer_logins of an active Zalo App and without a tenant_members row; 42501 for every other caller';

create function app.customer_session_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
begin
  if v_login.customer_id is null or v_login.customer_id is distinct from app.current_customer_id() then
    raise exception 'the customer has not joined' using errcode = '42501';
  end if;
  return v_login.customer_id;
end;
$$;

comment on function app.customer_session_customer() is 'the customer of a customer session that has joined: the login''s customer_id, which must also be the app_metadata.customer_id app.current_customer_id reads; 42501 for a visitor and every other caller';

create function app.customer_session_membership()
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid := app.customer_session_customer();
  v_membership public.memberships;
begin
  select m.* into v_membership
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.customer_id = v_customer
    and p.status <> 'draft'
  order by (p.status = 'active') desc, m.joined_at desc, m.id
  limit 1;
  if v_membership.id is null then
    raise exception 'the customer has no membership' using errcode = '42501';
  end if;
  return v_membership;
end;
$$;

comment on function app.customer_session_membership() is 'the membership a customer session acts on: of an active programme first, else the newest of a programme that is not a draft; 42501 when the customer has none';

create function app.customer_programme(p_programme_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'starts_on', to_char(p.starts_on, 'YYYY-MM-DD'),
    'ends_on', to_char(p.ends_on, 'YYYY-MM-DD'),
    'stamps_per_card', p.stamps_per_card,
    'welcome_stamps', p.welcome_stamps,
    'stamp_validity_months', p.stamp_validity_months,
    'points_enabled', p.points_per_unit > 0,
    'points_expiry_months', p.points_expiry_months,
    'receipt_claims_per_day', p.receipt_claims_per_phone_per_day,
    'receipt_claim_window_hours', p.receipt_claim_window_hours,
    'summary', null,
    'stamp_rule', null,
    'points_rule', null,
    'reward_summary', (
      select string_agg(
        format('%s: %s', case when c.cost_stamps > 0 then c.cost_stamps || ' dấu' else c.cost_points || ' điểm' end, c.name),
        '; ' order by c.cost_stamps, c.cost_points, c.name
      )
      from public.coupons c
      where c.programme_id = p.id and c.active
    ),
    'retention_months', null,
    'tiers', '[]'::jsonb
  )
  from public.loyalty_programmes p
  where p.id = p_programme_id;
$$;

comment on function app.customer_programme(uuid) is 'the programme as the customer Mini App reads it: name, period, stamps per card, welcome stamps, stamp validity, whether points are earned and their expiry, the receipt-claim limit and window, the active rewards as the reward summary (null without any), and null for the owner''s own texts, the retention and an empty tier list, which the programme does not hold yet; no amount or price';

create function app.customer_record_consent(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_purpose public.consent_purpose,
  p_policy_version text,
  p_evidence jsonb,
  p_at timestamptz
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
  select c.* into v_active
  from public.consent_records c
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'customer'
    and c.subject_id = p_customer_id
    and c.purpose = p_purpose
    and c.revoked_at is null
  for update;
  if v_active.id is not null and v_active.policy_version = p_policy_version then
    return v_active.id;
  end if;
  if v_active.id is not null then
    update public.consent_records c set revoked_at = greatest(p_at, c.granted_at) where c.id = v_active.id;
  end if;
  insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
  values (p_tenant_id, 'customer', p_customer_id, p_purpose, p_policy_version, 'mini_app', p_at, p_evidence)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.customer_record_consent(uuid, uuid, public.consent_purpose, text, jsonb, timestamptz) is 'records a customer''s consent for a purpose given in the Mini App: keeps an active record of the same policy version, otherwise revokes the active one and inserts a new record with its evidence; returns the active record';

create function app.zalo_customer_sign_in(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_new_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app public.zalo_apps;
  v_login app.customer_logins;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_customer uuid;
  v_name text;
begin
  select a.* into v_app from public.zalo_apps a where a.id = p_zalo_app_id;
  if v_app.id is null then
    raise exception 'unknown Zalo App' using errcode = '22023';
  end if;
  if v_app.status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_zalo_user_id is null or p_zalo_user_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'the Zalo user id is malformed' using errcode = '22023';
  end if;
  if v_display_name is not null and (char_length(v_display_name) > 100 or v_display_name ~ '[[:cntrl:]]') then
    v_display_name := null;
  end if;
  select l.* into v_login
  from app.customer_logins l
  where l.zalo_app_id = p_zalo_app_id and l.zalo_user_id = p_zalo_user_id;
  if v_login.id is null then
    if p_new_user_id is null then
      return jsonb_build_object('status', 'login_needed');
    end if;
    if not exists (select 1 from auth.users u where u.id = p_new_user_id and u.raw_app_meta_data ->> 'kind' = 'customer')
      or exists (select 1 from public.tenant_members m where m.user_id = p_new_user_id)
      or exists (select 1 from public.zalo_identities i where i.user_id = p_new_user_id)
      or exists (select 1 from app.customer_logins l where l.user_id = p_new_user_id)
    then
      raise exception 'the new login is not an unused customer login' using errcode = '22023';
    end if;
    insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
    values (v_app.tenant_id, p_zalo_app_id, p_zalo_user_id, p_new_user_id)
    on conflict (zalo_app_id, zalo_user_id) do nothing;
    select l.* into v_login
    from app.customer_logins l
    where l.zalo_app_id = p_zalo_app_id and l.zalo_user_id = p_zalo_user_id;
  end if;
  select c.id, nullif(btrim(c.name), '') into v_customer, v_name
  from public.customers c
  where c.id = v_login.customer_id
    and exists (select 1 from public.memberships m where m.customer_id = c.id);
  return jsonb_build_object(
    'status', 'customer',
    'user_id', v_login.user_id,
    'tenant_id', v_login.tenant_id,
    'customer_id', v_customer,
    'display_name', coalesce(v_name, v_display_name)
  );
end;
$$;

comment on function app.zalo_customer_sign_in(uuid, text, text, uuid) is 'the database half of the customer branch of zalo-session: the customer login of a Zalo user of an active Zalo App, its tenant and, once joined, its customer; without one it answers login_needed, and with p_new_user_id (a login created with app_metadata.kind customer, no tenant_members row, no staff Zalo identity and no other customer login) it binds that login first, the first binding winning a race';

create function app.customer_join(
  p_user_id uuid,
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text,
  p_phone text,
  p_loyalty_consent boolean,
  p_marketing_consent boolean,
  p_policy_version text,
  p_screen_version text,
  p_shown_at timestamptz,
  p_store_code text,
  p_channel text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins;
  v_app public.zalo_apps;
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_display_name text := nullif(btrim(p_display_name), '');
  v_store uuid;
  v_existing uuid;
  v_customer uuid;
  v_programme uuid;
  v_timezone text;
  v_already boolean;
  v_membership uuid;
  v_welcome integer := 0;
  v_evidence jsonb;
begin
  select l.* into v_login
  from app.customer_logins l
  where l.user_id = p_user_id and l.zalo_app_id = p_zalo_app_id and l.zalo_user_id = p_zalo_user_id
  for update;
  if v_login.id is null then
    raise exception 'the login is not the customer login of this Zalo user' using errcode = '22023';
  end if;
  select a.* into v_app from public.zalo_apps a where a.id = p_zalo_app_id;
  if v_app.status <> 'active' then
    raise exception 'the Zalo App is disabled' using errcode = '22023';
  end if;
  if p_channel is distinct from 'mini_app' then
    raise exception 'a customer joins through the channel mini_app' using errcode = '22023';
  end if;
  if p_marketing_consent is null or p_at is null then
    raise exception 'a join states the marketing toggle and its time' using errcode = '22023';
  end if;
  if p_screen_version is null or p_screen_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
    or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9.-]{0,39}$'
  then
    raise exception 'the screen and policy versions are 1 to 40 of a-z, 0-9, . and -' using errcode = '22023';
  end if;
  if p_shown_at is null or p_shown_at > p_at + interval '5 minutes' then
    raise exception 'the purpose screen was shown before the join' using errcode = '22023';
  end if;
  if p_loyalty_consent is not true then
    return jsonb_build_object('status', 'refused', 'reason', 'consent_required');
  end if;
  if not exists (
    select 1 from public.legal_documents d
    where d.tenant_id = v_login.tenant_id
      and d.kind = 'privacy_notice'
      and d.status = 'published'
      and d.version = p_policy_version
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'policy_outdated');
  end if;
  if p_store_code is not null then
    v_store := app.customer_app_store(p_zalo_app_id, p_store_code);
    if v_store is null then
      return jsonb_build_object('status', 'refused', 'reason', 'unknown_store');
    end if;
  end if;
  if v_phone is null then
    raise exception 'the phone number does not read in E.164 form' using errcode = '22023';
  end if;
  if v_display_name is not null and (char_length(v_display_name) > 100 or v_display_name ~ '[[:cntrl:]]') then
    v_display_name := null;
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = v_login.tenant_id;
  v_programme := app.loyalty_active_programme(v_login.tenant_id, (p_at at time zone v_timezone)::date);
  if v_programme is null then
    raise exception 'the tenant has no active loyalty programme to join' using errcode = '22023';
  end if;

  select c.id into v_existing
  from public.customers c
  where c.tenant_id = v_login.tenant_id
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by (c.phone = v_phone) desc, c.first_seen_at, c.id
  limit 1;
  if v_existing is not null and (
    exists (
      select 1 from app.customer_logins l
      where l.zalo_app_id = p_zalo_app_id and l.customer_id = v_existing and l.user_id <> p_user_id
    )
    or exists (
      select 1 from public.memberships m
      where m.customer_id = v_existing
        and m.brand_id = v_app.brand_id
        and m.zalo_user_id is not null
        and m.zalo_user_id <> p_zalo_user_id
    )
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'phone_in_use');
  end if;

  v_customer := app.loyalty_customer_for_phone(v_login.tenant_id, v_phone, p_at);
  update public.customers c
  set name = coalesce(nullif(btrim(c.name), ''), v_display_name),
      last_seen_at = greatest(c.last_seen_at, p_at)
  where c.id = v_customer;
  if v_login.customer_id is not null and v_login.customer_id <> v_customer then
    update public.memberships m
    set zalo_user_id = null
    where m.customer_id = v_login.customer_id
      and m.brand_id = v_app.brand_id
      and m.zalo_user_id = p_zalo_user_id;
  end if;

  v_already := exists (select 1 from public.memberships m where m.programme_id = v_programme and m.customer_id = v_customer);
  v_membership := app.loyalty_join(v_login.tenant_id, v_customer, 'mini_app', v_store, v_app.brand_id, p_zalo_user_id, p_at);
  if not v_already then
    select coalesce(sum(l.stamp_delta), 0)::integer into v_welcome
    from public.loyalty_ledger l
    where l.membership_id = v_membership
      and l.entry_kind = 'adjust'
      and l.reason = 'welcome'
      and l.approved_by is null;
  end if;

  v_evidence := jsonb_build_object(
    'screen_version', p_screen_version,
    'shown_at', p_shown_at,
    'accepted_at', p_at,
    'channel', 'mini_app',
    'zalo_app_id', p_zalo_app_id,
    'store_id', v_store
  );
  perform app.customer_record_consent(
    v_login.tenant_id, v_customer, 'loyalty', p_policy_version,
    v_evidence || jsonb_build_object('toggle', 'loyalty', 'ticked', true, 'marketing_ticked', p_marketing_consent),
    p_at
  );
  if p_marketing_consent then
    perform app.customer_record_consent(
      v_login.tenant_id, v_customer, 'marketing', p_policy_version,
      v_evidence || jsonb_build_object('toggle', 'marketing', 'ticked', true),
      p_at
    );
  end if;

  update app.customer_logins l set customer_id = v_customer where l.id = v_login.id;
  return jsonb_build_object(
    'status', 'joined',
    'customer_id', v_customer,
    'membership_id', v_membership,
    'welcome_stamps', v_welcome,
    'already_member', v_already
  );
end;
$$;

comment on function app.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text, timestamptz) is 'the join of the customer Mini App after zalo-phone decoded the phone token: refuses consent_required (no loyalty consent), policy_outdated (not a published privacy_notice version of the tenant), unknown_store and phone_in_use (the phone''s customer belongs to another Zalo user of the brand); otherwise finds or creates the customer by its E.164 phone (the Zalo display name kept when the customer has no name), enrols it in the active programme through app.loyalty_join with the welcome stamps, records the loyalty consent and, only when its toggle was ticked, the marketing consent, each with its evidence, and binds the customer to the login; 22023 for malformed input or no active programme';

create function app.customer_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_app public.zalo_apps;
  v_timezone text;
  v_programme uuid;
begin
  select a.* into v_app from public.zalo_apps a where a.id = v_login.zalo_app_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_login.tenant_id;
  select p.id into v_programme
  from public.loyalty_programmes p
  where p.tenant_id = v_login.tenant_id
    and p.status <> 'draft'
  order by (p.id is not distinct from app.loyalty_active_programme(v_login.tenant_id, (now() at time zone v_timezone)::date)) desc,
    (p.status = 'active') desc, p.starts_on desc, p.id
  limit 1;
  return jsonb_build_object(
    'programme', app.customer_programme(v_programme),
    'oa_id', (select o.external_id from public.oas o where o.brand_id = v_app.brand_id),
    'legal', jsonb_build_object(
      'entity_name', (select t.name from public.tenants t where t.id = v_login.tenant_id),
      'policy_version', (
        select d.version
        from public.legal_documents d
        where d.tenant_id = v_login.tenant_id and d.kind = 'privacy_notice' and d.status = 'published'
        order by d.language <> 'vi', d.language
        limit 1
      ),
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
          where d.tenant_id = v_login.tenant_id
            and d.status = 'published'
            and d.kind in ('privacy_notice', 'mini_app_terms')
        ),
        '[]'::jsonb
      )
    ),
    'stores', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('code', s.code, 'name', s.name, 'address', nullif(btrim(s.address), ''), 'opening_hours', s.opening_hours)
          order by s.name, s.code
        )
        from app.customer_app_stores(v_login.zalo_app_id) s
      ),
      '[]'::jsonb
    ),
    'menu', '[]'::jsonb
  );
end;
$$;

comment on function app.customer_home() is 'the browse-first home of the customer Mini App for any customer session, joined or not: the tenant''s programme (the active one, else the latest that is not a draft) as app.customer_programme, the brand''s OA id, the legal block (tenant name, published privacy_notice version, published privacy_notice and mini_app_terms), the brand''s active stores with a link key (address and opening hours null when unknown), and no menu highlights yet; never a price';

create function app.customer_stop_marketing(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_customer uuid := app.customer_session_customer();
begin
  update public.consent_records c
  set revoked_at = greatest(p_at, c.granted_at)
  where c.tenant_id = v_login.tenant_id
    and c.subject_type = 'customer'
    and c.subject_id = v_customer
    and c.purpose = 'marketing'
    and c.revoked_at is null;
  return jsonb_build_object('marketing_consent', false, 'stopped_at', p_at);
end;
$$;

comment on function app.customer_stop_marketing(timestamptz) is 'Dừng nhận tin: revokes the joined customer''s active marketing consent at once (nothing to revoke is not an error) and answers marketing_consent false with the time; 42501 for a visitor and every other caller';

create function app.customer_request_deletion(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_customer uuid := app.customer_session_customer();
  v_request public.data_subject_requests;
begin
  select r.* into v_request
  from public.data_subject_requests r
  where r.tenant_id = v_login.tenant_id
    and r.subject_type = 'customer'
    and r.subject_id = v_customer
    and r.request_type = 'deletion'
    and r.status in ('received', 'in_progress')
  order by r.received_at desc
  limit 1;
  if v_request.id is null then
    insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
    values (v_login.tenant_id, 'customer', v_customer, 'mini_app', 'deletion', p_at)
    returning * into v_request;
  end if;
  return jsonb_build_object('request_id', v_request.id, 'status', v_request.status, 'requested_at', v_request.received_at);
end;
$$;

comment on function app.customer_request_deletion(timestamptz) is 'records the joined customer''s request to delete their data in data_subject_requests (subject customer, contact mini_app, deadlines filled by the ledger''s trigger); an open deletion request of the customer is answered again instead of a second one; 42501 for a visitor and every other caller';

create function public.zalo_customer_sign_in(
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text default null,
  p_new_user_id uuid default null
)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.zalo_customer_sign_in(p_zalo_app_id, p_zalo_user_id, p_display_name, p_new_user_id);
$$;

comment on function public.zalo_customer_sign_in(uuid, text, text, uuid) is 'RPC for the zalo-session Edge Function only (service_role): app.zalo_customer_sign_in';

create function public.customer_join(
  p_user_id uuid,
  p_zalo_app_id uuid,
  p_zalo_user_id text,
  p_display_name text,
  p_phone text,
  p_loyalty_consent boolean,
  p_marketing_consent boolean,
  p_policy_version text,
  p_screen_version text,
  p_shown_at timestamptz,
  p_store_code text,
  p_channel text
)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.customer_join(
    p_user_id, p_zalo_app_id, p_zalo_user_id, p_display_name, p_phone, p_loyalty_consent, p_marketing_consent,
    p_policy_version, p_screen_version, p_shown_at, p_store_code, p_channel, now()
  );
$$;

comment on function public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text) is 'RPC for the zalo-session Edge Function only (service_role): app.customer_join at the current time';

create function public.customer_home()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.customer_home();
$$;

comment on function public.customer_home() is 'RPC for the customer Mini App: app.customer_home';

create function public.customer_stop_marketing()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.customer_stop_marketing(now());
$$;

comment on function public.customer_stop_marketing() is 'RPC for the customer Mini App: app.customer_stop_marketing at the current time';

create function public.customer_request_deletion()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.customer_request_deletion(now());
$$;

comment on function public.customer_request_deletion() is 'RPC for the customer Mini App: app.customer_request_deletion at the current time';

revoke all on function app.customer_store_code(text, text) from public, anon, authenticated, service_role;
revoke all on function app.customer_app_stores(uuid) from public, anon, authenticated, service_role;
revoke all on function app.customer_app_store(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.customer_session() from public, anon, authenticated, service_role;
revoke all on function app.customer_session_customer() from public, anon, authenticated, service_role;
revoke all on function app.customer_session_membership() from public, anon, authenticated, service_role;
revoke all on function app.customer_programme(uuid) from public, anon, authenticated, service_role;
revoke all on function app.customer_record_consent(uuid, uuid, public.consent_purpose, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.zalo_customer_sign_in(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function app.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text, timestamptz) from public, anon, authenticated;
revoke all on function app.customer_home() from public, anon, authenticated, service_role;
revoke all on function app.customer_stop_marketing(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_request_deletion(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.zalo_customer_sign_in(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.customer_home() from public, anon, service_role;
revoke all on function public.customer_stop_marketing() from public, anon, service_role;
revoke all on function public.customer_request_deletion() from public, anon, service_role;

grant execute on function app.zalo_customer_sign_in(uuid, text, text, uuid) to service_role;
grant execute on function app.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text, timestamptz) to service_role;
grant execute on function public.zalo_customer_sign_in(uuid, text, text, uuid) to service_role;
grant execute on function public.customer_join(uuid, uuid, text, text, text, boolean, boolean, text, text, timestamptz, text, text) to service_role;
grant execute on function public.customer_home() to authenticated;
grant execute on function public.customer_stop_marketing() to authenticated;
grant execute on function public.customer_request_deletion() to authenticated;
