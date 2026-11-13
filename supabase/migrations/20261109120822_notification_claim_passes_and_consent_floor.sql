create or replace function app.claim_next_message(
  p_worker text,
  p_secret_names text[],
  p_lease interval default interval '2 minutes',
  p_at timestamptz default now(),
  p_tenant_id uuid default null
)
returns table (
  message_id uuid,
  claimed_at timestamptz,
  tenant_id uuid,
  kind text,
  template_ref text,
  params jsonb,
  title text,
  body text,
  severity public.alert_severity,
  attempts smallint,
  business_date date,
  channel_id uuid,
  channel_kind public.channel_kind,
  provider text,
  secret_name text,
  address text,
  config jsonb,
  channel_label text,
  reader_timezone text,
  tenant_name text,
  currency_code text,
  store_name text,
  account_name text,
  rule_key text
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
begin
  while progressed and pass < max_passes loop
    pass := pass + 1;
    progressed := false;
    for candidate in
      select o.id, o.channel_id
      from public.outbound_messages o
      join public.notification_channels c on c.id = o.channel_id
      where o.status in ('queued', 'held')
        and o.kind is not null
        and coalesce(o.not_before, o.created_at) <= p_at
        and c.secret_name = any (p_secret_names)
        and (p_tenant_id is null or o.tenant_id = p_tenant_id)
      order by case when o.severity = 'critical' then 0 else 1 end, coalesce(o.not_before, o.created_at), o.created_at
      limit 20
      for update of o skip locked
    loop
      continue when not pg_try_advisory_xact_lock(hashtextextended('fnb-notify:channel:' || candidate.channel_id::text, 0));
      select * into verdict from app.message_decision(candidate.id, p_at);
      continue when verdict.decision is null;
      if verdict.decision = 'hold' then
        update public.outbound_messages o
        set status = 'held', not_before = verdict.release_at, hold_reason = verdict.reason, decision = verdict.reason
        where o.id = candidate.id;
        progressed := progressed or coalesce(verdict.release_at > p_at, false);
      elsif verdict.decision = 'cancel' then
        update public.outbound_messages o
        set status = 'cancelled', decision = verdict.reason
        where o.id = candidate.id;
        progressed := true;
      else
        update public.outbound_messages o
        set status = 'sending', claimed_at = p_at, lease_until = p_at + p_lease, attempts = o.attempts + 1,
            send_started_at = null, hold_reason = null, decision = 'send', last_error_code = null
        where o.id = candidate.id;
        return query
          select o.id, o.claimed_at, o.tenant_id, o.kind, o.template_ref, o.params, o.title, o.body, o.severity, o.attempts, o.business_date,
                 c.id, c.kind, c.provider, c.secret_name,
                 case when c.kind = 'email' then coalesce(c.address, u.email::text) else c.address end,
                 c.config, c.label, coalesce(c.timezone, t.timezone), t.name, t.currency_code, s.name, a.display_name, e.rule_key
          from public.outbound_messages o
          join public.notification_channels c on c.id = o.channel_id
          join public.tenants t on t.id = o.tenant_id
          left join auth.users u on u.id = c.user_id
          left join public.stores s on s.id = o.store_id
          left join public.alert_events e on e.id = o.alert_event_id
          left join public.pos_accounts a on a.id = e.pos_account_id
          where o.id = candidate.id;
        return;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function app.claim_next_message(text, text[], interval, timestamptz, uuid) is 'claims at most one due message whose destination''s secret name the dispatcher holds: due rows are locked with skip locked in batches of 20, the decision is re-taken under a per-destination advisory lock, held and cancelled rows are updated on the way, and the first message the decision sends becomes sending with a lease and is returned with what the renderer and the adapter need, the member''s login e-mail included for e-mail destinations; a batch that only held rows until later or cancelled them is followed by the next batch, at most 10 batches per call, so a due message behind 20 held or cancelled ones is still claimed in the same call';

revoke all on function app.claim_next_message(text, text[], interval, timestamptz, uuid) from public;

alter table public.channel_policies
  add constraint channel_policies_member_consent check (
    message_class <> 'operational'
    or channel_kind in ('webhook', 'zalo_gmf')
    or not allowed
    or coalesce(requires_consent and consent_purpose = 'notifications', false)
  );

comment on constraint channel_policies_member_consent on public.channel_policies is 'the consent floor of member destinations: an allowed operational policy for any kind whose destination belongs to a member (every kind except webhook and zalo_gmf) requires the member''s notifications consent, so no override, from the browser or the service role, can switch off the consent check of the send decision';
