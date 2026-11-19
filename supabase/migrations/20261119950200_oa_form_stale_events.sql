-- Security fix found by the security test pack (pgTAP 125_security_rate_limits.sql, "stale signed events").
--
-- The OA webhook drops a second delivery of an event by its id, but event ids are kept only 90 days and Zalo's
-- signature covers the event's own timestamp without any freshness rule. A signed user_submit_info event replayed
-- after its id was purged (or ever, once the OA event log is cleared) enrolled the phone again and recorded a loyalty
-- consent from a form answer of long ago, also for a customer erased on request in the meantime. A form answer now
-- enrols only while its event is under 48 hours old, the age the welcome already observes; an older one is refused
-- as stale and writes nothing.

create or replace function app.oa_form_enrol(p_event_row uuid, p_phone text, p_name text, p_at timestamptz)
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
  if v_event.occurred_at < p_at - interval '48 hours' then
    return jsonb_build_object('status', 'refused', 'reason', 'stale');
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
