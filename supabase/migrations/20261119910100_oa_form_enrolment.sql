create function app.oa_record_loyalty_consent(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_policy_version text,
  p_evidence jsonb,
  p_at timestamptz
)
returns table (consent_id uuid, created boolean)
language plpgsql
volatile
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
    and c.purpose = 'loyalty'
    and c.revoked_at is null
  for update;
  if v_active.id is not null and v_active.policy_version = p_policy_version then
    return query select v_active.id, false;
    return;
  end if;
  if v_active.id is not null then
    update public.consent_records c set revoked_at = greatest(p_at, c.granted_at) where c.id = v_active.id;
  end if;
  insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
  values (p_tenant_id, 'customer', p_customer_id, 'loyalty', p_policy_version, 'oa_form', p_at, p_evidence)
  returning id into v_id;
  return query select v_id, true;
end;
$$;

comment on function app.oa_record_loyalty_consent(uuid, uuid, text, jsonb, timestamptz) is 'records the loyalty consent a customer gave in the OA''s request_user_info form (channel oa_form): keeps an active loyalty record of the same policy version whatever its channel, otherwise revokes the active one and inserts the new record with its evidence; never a marketing record; returns the active record and whether it was created';

create function app.oa_form_enrol(p_event_row uuid, p_phone text, p_name text, p_at timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_event public.oa_events;
  v_oa public.oas;
  v_menu public.oa_menus;
  v_form_sent_at timestamptz;
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_name text := nullif(btrim(p_name), '');
  v_timezone text;
  v_programme uuid;
  v_policy text;
  v_existing uuid;
  v_customer uuid;
  v_already boolean;
  v_membership uuid;
  v_consent record;
  v_link text;
  v_evidence jsonb;
begin
  if p_at is null then
    raise exception 'oa_form_enrol needs an instant' using errcode = '22023';
  end if;
  select e.* into v_event from public.oa_events e where e.id = p_event_row;
  if v_event.id is null or v_event.event_name <> 'user_submit_info' or v_event.oa_user_id is null then
    raise exception 'oa_form_enrol needs a stored user_submit_info event of an OA user' using errcode = '22023';
  end if;
  if v_event.signature not in ('raw', 'compact') then
    return jsonb_build_object('status', 'refused', 'reason', 'unverified');
  end if;
  select o.* into v_oa from public.oas o where o.id = v_event.oa_id;
  if v_phone is null then
    return jsonb_build_object('status', 'refused', 'reason', 'phone_invalid');
  end if;
  if v_name is not null and (char_length(v_name) > 100 or v_name ~ '[[:cntrl:]]') then
    v_name := null;
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = v_oa.tenant_id;
  v_programme := app.loyalty_active_programme(v_oa.tenant_id, (p_at at time zone v_timezone)::date);
  if v_programme is null then
    return jsonb_build_object('status', 'refused', 'reason', 'no_programme');
  end if;
  select d.version into v_policy
  from public.legal_documents d
  where d.tenant_id = v_oa.tenant_id
    and d.kind = 'privacy_notice'
    and d.status = 'published'
  order by (d.language = 'vi') desc, d.published_at desc, d.version
  limit 1;
  if v_policy is null then
    return jsonb_build_object('status', 'refused', 'reason', 'policy_missing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:customer-oa:' || v_oa.id::text, 0));
  select c.id into v_existing
  from public.customers c
  where c.tenant_id = v_oa.tenant_id
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by (c.phone = v_phone) desc, c.first_seen_at, c.id
  limit 1;
  if v_existing is not null and (
    exists (
      select 1 from public.oa_users u
      where u.oa_id = v_oa.id and u.customer_id = v_existing and u.oa_user_id <> v_event.oa_user_id
    )
    or exists (
      select 1 from app.customer_oa_contacts k
      where k.oa_id = v_oa.id and k.customer_id = v_existing and k.oa_user_id <> v_event.oa_user_id
    )
  ) then
    return jsonb_build_object('status', 'refused', 'reason', 'phone_in_use');
  end if;

  v_customer := app.loyalty_customer_for_phone(v_oa.tenant_id, v_phone, p_at);
  update public.customers c
  set name = coalesce(nullif(btrim(c.name), ''), v_name),
      last_seen_at = greatest(c.last_seen_at, p_at)
  where c.id = v_customer;
  v_already := exists (select 1 from public.memberships m where m.programme_id = v_programme and m.customer_id = v_customer);
  v_membership := app.loyalty_join(v_oa.tenant_id, v_customer, 'oa_form', null, v_oa.brand_id, null, p_at);

  select m.* into v_menu from public.oa_menus m where m.oa_id = v_oa.id;
  select u.form_sent_at into v_form_sent_at from public.oa_users u where u.oa_id = v_oa.id and u.oa_user_id = v_event.oa_user_id;
  v_evidence := jsonb_build_object(
    'channel', 'oa_form',
    'oa_id', v_oa.id,
    'event_id', v_event.event_id,
    'submitted_at', v_event.occurred_at,
    'received_at', v_event.received_at,
    'accepted_at', p_at,
    'form_sent_at', v_form_sent_at,
    'form_title', v_menu.form_title,
    'form_subtitle', v_menu.form_subtitle,
    'shared_fields', case when v_name is null then '["phone"]'::jsonb else '["name", "phone"]'::jsonb end,
    'phone_source', 'user_submitted',
    'marketing', 'not_asked'
  );
  select r.consent_id, r.created into v_consent
  from app.oa_record_loyalty_consent(v_oa.tenant_id, v_customer, v_policy, v_evidence, p_at) r;
  insert into public.oa_users as u (tenant_id, oa_id, oa_user_id, customer_id, enrolled_at)
  values (v_oa.tenant_id, v_oa.id, v_event.oa_user_id, v_customer, p_at)
  on conflict (oa_id, oa_user_id) do update
  set customer_id = excluded.customer_id,
      enrolled_at = case when u.customer_id = excluded.customer_id then u.enrolled_at else excluded.enrolled_at end;
  v_link := app.link_customer_oa_user(v_oa.id, v_event.oa_user_id, v_customer, p_at);
  return jsonb_build_object(
    'status', 'joined',
    'customer_id', v_customer,
    'membership_id', v_membership,
    'already_member', v_already,
    'consent_record_id', v_consent.consent_id,
    'consent_created', v_consent.created,
    'link', v_link
  );
end;
$$;

comment on function app.oa_form_enrol(uuid, text, text, timestamptz) is 'the no-app enrolment (FR-LOY-25) from a verified user_submit_info event: refuses unverified, phone_invalid (no E.164 reading), no_programme, policy_missing (no published privacy notice) and phone_in_use (the phone''s customer enrolled as, or is tied to, another OA user of this OA); otherwise finds or creates the customer by its E.164 phone through app.loyalty_customer_for_phone (the form''s name kept only when the customer has none), enrols it with channel oa_form through app.loyalty_join under the OA''s brand, records the loyalty consent with the form as evidence (app.oa_record_loyalty_consent; never a marketing consent, which the form does not ask) and records the OA user as enrolled as the customer (public.oa_users.customer_id) and ties them for the outbox through app.link_customer_oa_user; a second submission of the same phone changes nothing; dob, gender and address of the form are never passed in';

create function app.oa_customer_step(p_event_row uuid, p_input jsonb, p_at timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_event public.oa_events;
  v_menu public.oa_menus;
  v_user public.oa_users;
  v_customer uuid;
  v_last timestamptz;
  v_outcome text;
  v_reply jsonb;
  v_enrol jsonb;
  v_kind text := p_input ->> 'kind';
begin
  if p_at is null then
    raise exception 'oa_customer_step needs an instant' using errcode = '22023';
  end if;
  select e.* into v_event from public.oa_events e where e.id = p_event_row for update;
  if v_event.id is null then
    return jsonb_build_object('step', 'unknown_event');
  end if;
  if v_event.customer_step is not null then
    return jsonb_build_object('step', 'already_done', 'previous', v_event.customer_step);
  end if;

  if v_event.signature not in ('raw', 'compact') then
    v_outcome := 'unverified';
  elsif v_event.oa_user_id is null then
    v_outcome := 'no_user';
  elsif v_event.event_name not in ('follow', 'user_send_text', 'user_submit_info')
    or (v_event.event_name = 'user_send_text' and (v_kind is distinct from 'keyword' or p_input ->> 'action' is distinct from 'join'))
    or (v_event.event_name = 'user_submit_info' and v_kind is distinct from 'form')
  then
    v_outcome := 'ignored';
  else
    select m.* into v_menu from public.oa_menus m where m.oa_id = v_event.oa_id;
    insert into public.oa_users (tenant_id, oa_id, oa_user_id)
    values (v_event.tenant_id, v_event.oa_id, v_event.oa_user_id)
    on conflict (oa_id, oa_user_id) do nothing;
    select u.* into v_user from public.oa_users u where u.oa_id = v_event.oa_id and u.oa_user_id = v_event.oa_user_id for update;
    v_customer := coalesce(
      v_user.customer_id,
      (select k.customer_id from app.customer_oa_contacts k where k.oa_id = v_event.oa_id and k.oa_user_id = v_event.oa_user_id)
    );
    v_last := app.oa_last_interaction(v_event.oa_id, v_event.oa_user_id);

    if v_event.event_name = 'follow' then
      if v_menu.id is null or not v_menu.welcome_enabled then
        v_outcome := 'no_welcome';
      elsif not v_user.following then
        v_outcome := 'not_following';
      elsif v_event.occurred_at < p_at - interval '48 hours' then
        v_outcome := 'stale';
      elsif v_user.welcomed_at is not null and (
        v_user.unfollowed_at is null
        or v_user.welcomed_at >= v_user.unfollowed_at
        or v_user.welcomed_at > p_at - interval '24 hours'
      ) then
        v_outcome := 'already_welcomed';
      else
        update public.oa_users u set welcomed_at = p_at where u.id = v_user.id;
        v_outcome := 'welcome';
        v_reply := jsonb_build_object('kind', 'welcome', 'text', v_menu.welcome_text);
      end if;
    elsif v_event.event_name = 'user_send_text' then
      if v_menu.id is null then
        v_outcome := 'no_menu';
      elsif v_last is null or v_last < p_at - interval '48 hours' then
        v_outcome := 'outside_window';
      elsif v_customer is not null and exists (select 1 from public.memberships m where m.customer_id = v_customer) then
        v_outcome := 'member';
        v_reply := jsonb_build_object('kind', 'member', 'text', v_menu.member_text);
      elsif v_menu.form_image_url is null then
        v_outcome := 'no_form';
      elsif v_user.form_sent_at is not null and v_user.form_sent_at > p_at - interval '2 minutes' then
        v_outcome := 'form_recent';
      else
        update public.oa_users u set form_sent_at = p_at where u.id = v_user.id;
        v_outcome := 'form';
        v_reply := jsonb_build_object(
          'kind', 'form',
          'title', v_menu.form_title,
          'subtitle', v_menu.form_subtitle,
          'image_url', v_menu.form_image_url
        );
      end if;
    else
      v_enrol := app.oa_form_enrol(p_event_row, p_input ->> 'phone', p_input ->> 'name', p_at);
      if v_enrol ->> 'status' = 'joined' then
        v_customer := (v_enrol ->> 'customer_id')::uuid;
        if v_menu.id is not null and v_last is not null and v_last >= p_at - interval '48 hours' then
          v_outcome := 'joined';
          v_reply := jsonb_build_object('kind', 'joined', 'text', v_menu.joined_text);
        else
          v_outcome := 'joined_quiet';
        end if;
      else
        v_outcome := 'refused_' || (v_enrol ->> 'reason');
      end if;
    end if;
  end if;

  update public.oa_events e set customer_step = v_outcome, customer_step_at = p_at where e.id = p_event_row;
  return jsonb_build_object(
    'step', v_outcome,
    'oa_user_row', v_user.id,
    'recipient', v_event.oa_user_id,
    'customer_id', v_customer,
    'reply', case when v_reply is null then null else v_reply || jsonb_build_object(
      'buttons', v_menu.buttons,
      'mini_app_id', app.oa_customer_mini_app(v_event.oa_id)
    ) end
  );
end;
$$;

comment on function app.oa_customer_step(uuid, jsonb, timestamptz) is 'the customer side of one stored OA event, run once per event (oa_events.customer_step) and only for a verified signature; p_input is what oa-webhook read from the body and keeps only in memory ({kind: none}, {kind: keyword, action}, {kind: form, phone, name}). A follow earns one welcome per follow, at most one a day, while the event is under 48 hours old; the join keyword (a message inside the window) answers the member text to an OA user tied to a member and otherwise the request_user_info form, at most one every two minutes; a form answer enrols through app.oa_form_enrol and answers the joined text only inside the 48-hour window (app.oa_last_interaction); every other event is ignored. Returns the outcome, the OA user row, the recipient, the customer and, when a consultation message is due, the reply (its kind and texts, the menu buttons and the customer Mini App id); never a promotional message';

revoke all on function app.oa_record_loyalty_consent(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.oa_form_enrol(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.oa_customer_step(uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
