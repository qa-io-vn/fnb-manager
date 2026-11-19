-- Security hardening found by the security test pack (pgTAP 122_security_session_spoofing.sql).
--
-- The row-level security of a customer session went through app.current_customer_id(), which trusted the JWT's
-- app_metadata alone: any session whose claims said kind customer, a tenant and one of its customers read that
-- customer's memberships, ledger, stamps, check-ins, claims, redemptions and customers row, whoever had signed in.
-- The customer RPCs (app.customer_session) already insisted on the login: a row of app.customer_logins for auth.uid(),
-- of that tenant, of an active Zalo App, bound to that customer and without a tenant_members row. RLS now insists on
-- the same, so a claim naming another customer or tenant, a customer claim on a member's login, and the session of a
-- Zalo App the owner disabled (whose refresh token would otherwise keep minting tokens that read rows) read nothing.

create or replace function app.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with metadata as (
    select (select auth.jwt()) -> 'app_metadata' as m
  ),
  claimed as (
    select
      case when m ->> 'customer_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (m ->> 'customer_id')::uuid end as customer_id,
      case when m ->> 'tenant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (m ->> 'tenant_id')::uuid end as tenant_id
    from metadata
    where m ->> 'kind' = 'customer'
  )
  select c.id
  from claimed
  join public.customers c on c.id = claimed.customer_id and c.tenant_id = claimed.tenant_id
  where exists (
      select 1
      from app.customer_logins l
      join public.zalo_apps a on a.id = l.zalo_app_id and a.tenant_id = l.tenant_id
      where l.user_id = (select auth.uid())
        and l.tenant_id = c.tenant_id
        and l.customer_id = c.id
        and a.status = 'active'
    )
    and not exists (select 1 from public.tenant_members m where m.user_id = (select auth.uid()));
$$;

comment on function app.current_customer_id() is 'the customer of a customer session: the customers.id named by app_metadata.customer_id of a JWT whose app_metadata.kind is customer, when that customer belongs to app_metadata.tenant_id and the signed-in login is that customer''s login in app.customer_logins, of an active Zalo App, without a tenant_members row; null for every other session';
