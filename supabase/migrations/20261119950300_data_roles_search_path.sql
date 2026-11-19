-- Security hardening found by the security workflow (.github/workflows/security.yml, Supabase's security advisors).
--
-- app.data_roles was the one function without a pinned search_path (request R-T01, docs/security.md 4.2), the only
-- warning of `supabase db advisors --type security`. Its body already names public.tenant_role, so an empty
-- search_path changes nothing it does; the workflow now fails on any new warning.

create or replace function app.data_roles()
returns public.tenant_role[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'manager', 'staff', 'viewer']::public.tenant_role[];
$$;
