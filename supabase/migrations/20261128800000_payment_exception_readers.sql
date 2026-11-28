-- Quản lý → Tiền chờ xử lý reads from the server what it worked around (ADR-068; counter-app.md section 6, item 10).
-- manager_payment_exceptions gains, without changing its arguments, its refusals or any field it answered:
-- 1. the status `resolved`: the refunded and the dismissed ones in one call, newest first under one limit (the page
--    asked twice and merged);
-- 2. `resolved_by_name` on each exception: the roster's name of whoever resolved it, else the name of their Zalo sign-in
--    in the tenant, so an owner (never on the roster) is named too; null while open or when no name is known;
-- 3. `account` on each exception: which account of the tenant received the money, `scope` `store` (a store's own
--    VietQR account) or `brand` (the brand-wide one, and every Checkout SDK provider), and for a VietQR its bank's name
--    and the last 4 characters of its account number as they were when the money arrived (the provider's change log;
--    the row itself for a provider that was never changed); never the full number, never the payer's.
-- Who reads which exception is unchanged: a store's for its owners and managers, a brand-wide account's money that no
-- store took only for those with every store (ADR-068; widening it is the owner's question).

create or replace function app.manager_payment_exceptions(p_store_id uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only owners and managers of the store read its payment exceptions' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('open', 'refunded', 'dismissed', 'resolved') then
    raise exception 'a status is open, refunded, dismissed or resolved' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'open', (select count(*) from public.payment_exceptions e where e.tenant_id = v_store.tenant_id and e.status = 'open'
      and (e.store_id = v_store.id or (e.store_id is null and app.has_store_scope(e.tenant_id, null, array['owner', 'manager']::public.tenant_role[])))),
    'exceptions', coalesce((select jsonb_agg(x.item order by x.received_at desc, x.id) from (
      select e.id, e.received_at, jsonb_build_object('id', e.id, 'reason', e.reason, 'method', e.method, 'amount', e.amount::bigint,
        'expected_amount', e.expected_amount::bigint, 'reference', e.reference, 'order_id', e.order_id,
        'order_no', (select '#' || lpad(o.order_no::text, 3, '0') from public.orders o where o.id = e.order_id),
        'source', e.source, 'received_at', e.received_at, 'status', e.status, 'resolved_at', e.resolved_at,
        'resolved_by', e.resolved_by, 'resolution_note', e.resolution_note,
        'resolved_by_name', case when e.resolved_by is not null then coalesce(
          (select r.display_name from public.staff_roster r where r.tenant_id = e.tenant_id and r.user_id = e.resolved_by),
          (select i.display_name from public.zalo_identities i
           where i.tenant_id = e.tenant_id and i.user_id = e.resolved_by and i.display_name is not null
           order by i.updated_at desc, i.id limit 1)) end,
        'account', jsonb_build_object(
          'scope', case when p.store_id is null then 'brand' else 'store' end,
          'bank_name', case when p.method = 'vietqr' then nullif(btrim(k.settings ->> 'bank_name'), '') end,
          'account_tail', case when p.method = 'vietqr' then nullif(right(coalesce(k.settings ->> 'account_number', ''), 4), '') end)) as item
      from public.payment_exceptions e
      join public.payment_providers p on p.id = e.provider_id
      cross join lateral (
        select coalesce((select c.after -> 'settings' from public.payment_provider_changes c
          where c.provider_id = p.id and c.changed_at <= e.received_at
          order by c.changed_at desc, c.id desc limit 1), p.settings) as settings
      ) k
      where e.tenant_id = v_store.tenant_id
        and (e.store_id = v_store.id or (e.store_id is null and app.has_store_scope(e.tenant_id, null, array['owner', 'manager']::public.tenant_role[])))
        and (p_status is null or e.status = p_status or (p_status = 'resolved' and e.status <> 'open'))
      order by e.received_at desc, e.id
      limit greatest(least(coalesce(p_limit, 50), 200), 1)) x), '[]'::jsonb));
end;
$$;

comment on function app.manager_payment_exceptions(uuid, text, integer) is 'the manager queue of a store (ADR-068): money the server did not apply, newest first, with the reason, the amount and the one expected, the reference and the order, who resolved it by name (the roster''s, else their Zalo sign-in''s) and which account received it (the store''s own or the brand-wide one, its bank and the last 4 characters of its number as they were then); a status open, refunded, dismissed, resolved (both resolutions) or null for all; exceptions of a brand-wide account for owners and managers of every store; owners and managers of the store';

-- Grants as before: the app function is closed to every API role; owners and managers reach it through
-- public.manager_payment_exceptions (security definer, unchanged), which only authenticated may execute.
revoke all on function app.manager_payment_exceptions(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.manager_payment_exceptions(uuid, text, integer) from public, anon, service_role;
grant execute on function public.manager_payment_exceptions(uuid, text, integer) to authenticated;
