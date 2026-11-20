create function app.next_resend_number(p_tenant_id uuid, p_base_key text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  stored integer;
  issued integer;
  setting_name text;
begin
  if p_tenant_id is null or p_base_key is null or btrim(p_base_key) = '' or char_length(p_base_key) > 180 then
    raise exception 'next_resend_number needs a tenant and a dedupe key of at most 180 characters' using errcode = '22023';
  end if;
  if p_base_key ~ ':resend:[0-9]+$' then
    raise exception 'next_resend_number needs the key without its resend suffix' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:resend:' || p_tenant_id::text || ':' || p_base_key, 0));
  select coalesce(max(substring(o.dedupe_key from ':resend:([0-9]+)$')::integer), 0) into stored
  from public.outbound_messages o
  where o.tenant_id = p_tenant_id
    and o.dedupe_key is not null
    and starts_with(o.dedupe_key, p_base_key || ':resend:')
    and o.dedupe_key ~ ':resend:[0-9]+$';
  setting_name := 'fnb_resend.n' || md5(p_tenant_id::text || ':' || p_base_key);
  issued := coalesce(nullif(current_setting(setting_name, true), '')::integer, 0);
  issued := greatest(stored, issued) + 1;
  perform set_config(setting_name, issued::text, true);
  return issued;
end;
$$;

comment on function app.next_resend_number(uuid, text) is 'the n of the next resend copy of a message: one more than the highest :resend:<n> stored under the base dedupe key (and than any number this transaction already issued for it), taken under the advisory lock fnb-notify:resend:<tenant>:<key> held to the end of the transaction, so two concurrent resends get 1 and 2; 22023 for a missing key or one that already ends in a resend suffix';

create function public.resend_message(p_message_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  original public.outbound_messages%rowtype;
  base_key text;
  copy_number integer;
  created uuid;
  at_value timestamptz := now();
begin
  select o.* into original from public.outbound_messages o where o.id = p_message_id;
  if not found or not app.has_tenant_role(original.tenant_id, array['owner', 'manager', 'staff', 'viewer', 'publisher']::public.tenant_role[]) then
    raise exception 'resend_message: no such message for this login' using errcode = '42501';
  end if;
  if not app.can_manage_store_scope(original.tenant_id, null) then
    raise exception 'resend_message is for owners and managers with every store' using errcode = '42501';
  end if;
  if original.kind is null or original.kind not in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved') then
    raise exception 'resend_message resends digests and alerts only' using errcode = '22023';
  end if;
  if original.status not in ('uncertain', 'failed') then
    raise exception 'resend_message resends an uncertain or failed message only' using errcode = '22023';
  end if;
  if original.channel_id is null then
    raise exception 'resend_message: the destination was removed' using errcode = '22023';
  end if;
  if original.kind in ('digest', 'digest_correction') and original.body is null then
    raise exception 'resend_message: the text was removed after its retention' using errcode = '22023';
  end if;
  base_key := regexp_replace(original.dedupe_key, ':resend:[0-9]+$', '');
  copy_number := app.next_resend_number(original.tenant_id, base_key);
  created := app.enqueue_message(
    original.tenant_id,
    original.channel_id,
    original.kind,
    original.template_ref,
    base_key || ':resend:' || copy_number::text,
    coalesce(original.params, '{}'::jsonb),
    original.title,
    original.body,
    coalesce(original.severity, 'info'::public.alert_severity),
    original.store_id,
    original.business_date,
    original.digest_id,
    original.alert_event_id,
    null,
    at_value
  );
  update public.outbound_messages o set resend_of = original.id where o.id = created;
  perform app.kick_notify('kick');
  return created;
end;
$$;

comment on function public.resend_message(uuid) is 'owners and managers with every store resend an uncertain or failed digest, correction or alert: a new queued row with resend_of set and the dedupe key <base>:resend:<n> from app.next_resend_number, the original kept unchanged as evidence, and the dispatcher woken; 42501 for any other caller or a message they cannot see, 22023 for another state or kind, a removed destination or a purged digest text';

revoke all on function app.next_resend_number(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resend_message(uuid) from public, anon, service_role;
grant execute on function public.resend_message(uuid) to authenticated;
