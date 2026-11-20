create function public.dsr_deletion_preview(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.data_subject_requests;
  v_customer public.customers;
begin
  v_request := app.dsr_request_for_caller(p_request_id, 'dsr_deletion_preview');
  select c.* into v_customer from public.customers c where c.id = v_request.subject_id and c.tenant_id = v_request.tenant_id;
  if v_customer.id is null then
    raise exception 'the customer of this request no longer exists' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'memberships', (select count(*) from public.memberships m where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id),
    'loyalty_ledger', (select count(*) from public.loyalty_ledger l join public.memberships m on m.id = l.membership_id where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id),
    'stamps', (select count(*) from public.stamps s join public.memberships m on m.id = s.membership_id where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id),
    'redemptions', (select count(*) from public.redemptions r join public.memberships m on m.id = r.membership_id where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id),
    'receipt_claims', (select count(*) from public.receipt_claims q join public.memberships m on m.id = q.membership_id where m.tenant_id = v_request.tenant_id and m.customer_id = v_customer.id),
    'consent_records', (select count(*) from public.consent_records k where k.tenant_id = v_request.tenant_id and k.subject_type = 'customer' and k.subject_id = v_customer.id),
    'outbound_messages', (select count(*) from public.outbound_messages o where o.tenant_id = v_request.tenant_id and o.subject_type = 'customer' and o.subject_id = v_customer.id),
    'invoices_unlinked', (select count(*) from public.invoices i where i.tenant_id = v_request.tenant_id and i.customer_id = v_customer.id)
  );
end;
$$;

comment on function public.dsr_deletion_preview(uuid) is 'RPC for owners and managers with every store (42501 for every other caller): the counts per table that dsr_delete would remove or redact for the customer of a data-subject request of their tenant (memberships, ledger rows, stamps, redemptions, claims, consent records, messages, linked invoices), so the confirmation lists them first; changes nothing; 22023 for a request about staff, naming no customer, rejected or whose customer is gone';

revoke all on function public.dsr_deletion_preview(uuid) from public, anon, service_role;
grant execute on function public.dsr_deletion_preview(uuid) to authenticated;
