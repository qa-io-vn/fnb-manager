-- The nightly regression pack showed customer-quota-parallel failing in CI ("expected 20 sent, got 21"): the daily ZBS quota of
-- an OA is counted in app.customer_message_route from rows already in status sending, sent, delivered or uncertain, and
-- app.claim_next_customer_message only serialised claimers per subject, so two dispatchers on different subjects both read
-- 19 and both sent. The decision is now taken under a tenant-level advisory lock. Only the added lock differs from the
-- definition of 20261119930000_customer_message_routing.sql.

create or replace function app.claim_next_customer_message(
  p_worker text,
  p_routes text[],
  p_lease interval default interval '2 minutes',
  p_at timestamptz default now(),
  p_tenant_id uuid default null
)
returns table (
  message_id uuid,
  claimed_at timestamptz,
  tenant_id uuid,
  kind text,
  route text,
  attempts smallint,
  oa_id uuid,
  window_kind text,
  template_external_id text,
  template_purpose text,
  template_tag text,
  recipient_kind text,
  recipient text,
  parameters jsonb,
  reader_timezone text
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  max_passes constant integer := 10;
  candidate record;
  verdict record;
  pass integer := 0;
  progressed boolean := true;
  consent uuid;
  template public.zbs_templates%rowtype;
  contact_user text;
  phone text;
begin
  while progressed and pass < max_passes loop
    pass := pass + 1;
    progressed := false;
    for candidate in
      select o.id, o.subject_id, o.tenant_id, o.message_class
      from public.outbound_messages o
      where o.subject_type = 'customer'
        and o.channel_id is null
        and o.status in ('queued', 'held')
        and o.kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back')
        and coalesce(o.not_before, o.created_at) <= p_at
        and (p_tenant_id is null or o.tenant_id = p_tenant_id)
      order by coalesce(o.not_before, o.created_at), o.created_at
      limit 20
      for update of o skip locked
    loop
      continue when candidate.subject_id is not null
        and not pg_try_advisory_xact_lock(hashtextextended('fnb-notify:customer:' || candidate.subject_id::text, 0));
      -- The daily quota of an OA is counted from the rows that are already sending or sent, so two claimers deciding at
      -- once both read the same count and both send: a quota of 20 sent 21. The decision of one tenant is serialised
      -- (the lock is released when the claiming statement commits, and the next claimer then counts the committed
      -- 'sending' row). Different tenants do not wait for each other.
      perform pg_advisory_xact_lock(hashtextextended('fnb-notify:customer-quota:' || candidate.tenant_id::text, 0));
      select * into verdict from app.customer_message_route(candidate.id, p_at);
      continue when verdict.decision is null;
      if verdict.decision = 'cancel' then
        update public.outbound_messages o
        set status = 'cancelled', decision = verdict.reason, hold_reason = null
        where o.id = candidate.id;
        progressed := true;
      elsif verdict.decision = 'hold' then
        update public.outbound_messages o
        set status = 'held', not_before = verdict.release_at, hold_reason = verdict.reason, decision = verdict.reason
        where o.id = candidate.id;
        progressed := progressed or coalesce(verdict.release_at > p_at, false);
      elsif verdict.route = 'in_app' then
        consent := app.customer_consent_record(candidate.tenant_id, candidate.subject_id,
          case when candidate.message_class = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end);
        update public.outbound_messages o
        set status = 'sending', channel = 'mini_app', claimed_at = p_at, lease_until = p_at + p_lease, attempts = o.attempts + 1,
            consent_record_id = coalesce(consent, o.consent_record_id)
        where o.id = candidate.id;
        update public.outbound_messages o
        set status = 'sent', sent_at = p_at, lease_until = null, decision = coalesce(verdict.reason, 'in_app'), hold_reason = null,
            cost_amount = 0, last_error_code = null,
            params = o.params || jsonb_build_object('route', 'in_app')
        where o.id = candidate.id;
        progressed := true;
      else
        continue when not (verdict.route = any (p_routes));
        consent := app.customer_consent_record(candidate.tenant_id, candidate.subject_id,
          case when candidate.message_class = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end);
        template := null;
        if verdict.template_id is not null then
          select z.* into template from public.zbs_templates z where z.id = verdict.template_id;
        end if;
        update public.outbound_messages o
        set status = 'sending',
            channel = case when verdict.route = 'consultation' then 'zalo_oa' else 'zalo_zbs' end,
            claimed_at = p_at,
            lease_until = p_at + p_lease,
            attempts = o.attempts + 1,
            send_started_at = null,
            hold_reason = null,
            decision = 'send',
            last_error_code = null,
            consent_record_id = coalesce(consent, o.consent_record_id),
            template_ref = case when verdict.route = 'template' then 'zbs.' || template.purpose || '.v1' else 'consultation.' || o.kind || '.v1' end,
            params = o.params || jsonb_strip_nulls(jsonb_build_object(
              'route', verdict.route,
              'oa_id', verdict.oa_id::text,
              'window', verdict.window_kind,
              'template_id', template.id::text
            ))
        where o.id = candidate.id;
        contact_user := null;
        select w.oa_user_id into contact_user from app.customer_oa_window(verdict.oa_id, candidate.subject_id) w;
        select c.phone into phone from public.customers c where c.id = candidate.subject_id;
        return query
          select o.id, o.claimed_at, o.tenant_id, o.kind, verdict.route, o.attempts, verdict.oa_id, verdict.window_kind,
                 template.external_id, template.purpose, template.tag,
                 case when contact_user is not null then 'uid' else 'phone' end,
                 coalesce(contact_user, regexp_replace(regexp_replace(phone, '^\+', ''), '^0', '84')),
                 app.customer_message_parameters(o.id),
                 coalesce(t.timezone, 'Asia/Ho_Chi_Minh')
          from public.outbound_messages o
          join public.tenants t on t.id = o.tenant_id
          where o.id = candidate.id;
        return;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function app.claim_next_customer_message(text, text[], interval, timestamptz, uuid) is 'the customer half of the dispatcher: locks due customer messages with skip locked in batches of 20 (at most 10 batches), takes app.customer_message_route under a per-customer advisory lock, cancels and holds on the way, closes in-app messages at once as sent on mini_app at no cost, and returns at most one consultation or template message whose route p_routes names as sending with a lease, with what the adapter needs and never stores: the OA, the template id, purpose and tag, the recipient (the OA user id as uid, else the phone in international digits without a plus sign) and the parameters; a route the dispatcher lacks leaves the message waiting; the send decision of each candidate is taken under a transaction advisory lock of its tenant so two claimers cannot both count the same quota and overshoot it';
