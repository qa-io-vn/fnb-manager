-- #253, NFR-PRV: a customer's full phone never reaches a browser through the Data API. Screens show the
-- masked form (four and three dots and the last three digits); only an owner's phone lookup
-- (public.loyalty_member_lookup) answers with the full phone.

revoke select on public.customers from authenticated;
grant select (id, tenant_id, external_id, name, first_seen_at, last_seen_at) on public.customers to authenticated;

comment on column public.customers.phone is 'phone number as captured at the till, E.164 for a loyalty customer; no API role selects it (column grant, #253): screens read memberships.phone_masked, loyalty_members_page and loyalty_member_lookup, and only an owner''s lookup answers with the full phone';

create function public.phone_masked(p_membership public.memberships)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.loyalty_masked_phone(c.phone)
  from public.memberships m
  join public.customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id
  where m.id = p_membership.id
    and c.phone is not null
    and (
      m.tenant_id = any (app.current_user_loyalty_tenant_ids())
      or m.customer_id = app.current_customer_id()
    );
$$;

comment on function public.phone_masked(public.memberships) is 'computed column memberships.phone_masked for PostgREST (select=phone_masked, or memberships(phone_masked) in an embed): the member''s phone as the apps show it, four and three dots and the last three digits; null without a phone and for a membership the caller does not read (owners, managers and viewers of its tenant, a customer session its own). The membership is looked up again by id, so a row passed through /rpc reveals nothing more';

revoke all on function public.phone_masked(public.memberships) from public, anon, service_role;
grant execute on function public.phone_masked(public.memberships) to authenticated;
