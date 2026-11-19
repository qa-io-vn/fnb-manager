-- #253, NFR-PRV: the owner's web section Khách hàng reads members through two functions that mask the
-- phone in the database and compute the balance there, instead of reading customers.phone and summing
-- ledger rows in the browser.

create index memberships_tenant_joined_idx on public.memberships (tenant_id, joined_at desc, id desc);

create function app.loyalty_store_balance(p_membership_id uuid, p_store_ids uuid[])
returns table (
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  last_visit date
)
language sql
stable
set search_path = ''
as $$
  with entries as (
    select l.id, l.entry_kind, l.stamp_delta, l.point_delta, l.pending, l.source_entry_id, l.business_date
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and (p_store_ids is null or l.store_id is null or l.store_id = any (p_store_ids))
  ),
  open_pending as (
    select e.id
    from entries e
    where e.pending
      and e.entry_kind = 'earn'
      and not exists (select 1 from entries c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
  ),
  split as (
    select
      e.entry_kind,
      e.stamp_delta,
      e.point_delta,
      e.business_date,
      exists (select 1 from open_pending o where o.id = e.id or o.id = e.source_entry_id) as is_pending
    from entries e
  )
  select
    coalesce(sum(s.stamp_delta) filter (where not s.is_pending), 0)::integer,
    coalesce(sum(s.point_delta) filter (where not s.is_pending), 0)::integer,
    coalesce(sum(s.stamp_delta) filter (where s.is_pending), 0)::integer,
    coalesce(sum(s.point_delta) filter (where s.is_pending), 0)::integer,
    max(s.business_date) filter (where s.entry_kind = 'earn')
  from split s;
$$;

comment on function app.loyalty_store_balance(uuid, uuid[]) is 'the balance of a membership as app.loyalty_balance computes it (spendable stamps and points, pending ones waiting for their confirm row) over the ledger rows at p_store_ids and the rows without a store (welcome stamps, adjustments made off-store), every row when p_store_ids is null, with last_visit the latest business date of an earn among them; for loyalty_members_page and loyalty_member_lookup, which run as the owner, so it reads every row it is given; no API role executes it';

create function public.loyalty_members_page(
  p_store_ids uuid[] default null,
  p_after text default null,
  p_limit integer default 100,
  p_search text default null
)
returns table (
  membership_id uuid,
  tenant_id uuid,
  programme_id uuid,
  phone_masked text,
  joined_at timestamptz,
  status public.membership_status,
  channel text,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  last_visit date,
  page_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_limit constant integer := 1000;
  v_tenants uuid[] := app.current_user_loyalty_tenant_ids();
  v_scope uuid[] := app.current_user_loyalty_store_ids();
  v_stores uuid[];
  v_member_tenants uuid[];
  v_after_at timestamptz;
  v_after_id uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_search_id uuid;
  v_search_tail text;
begin
  if cardinality(v_tenants) = 0 then
    raise exception using errcode = '42501', message = 'loyalty_members_page is for owners, managers and viewers';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > max_limit then
    raise exception using errcode = '22023', message = format('loyalty_members_page needs p_limit from 1 to %s', max_limit);
  end if;
  if p_after is not null then
    begin
      if p_after !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023';
      end if;
      v_after_at := split_part(p_after, '~', 1)::timestamptz;
      v_after_id := split_part(p_after, '~', 2)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'loyalty_members_page needs p_after to be the page_key of a row it returned';
    end;
  end if;
  if v_search is not null then
    if v_search ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_search_id := v_search::uuid;
    elsif v_search ~ '^[0-9]{1,3}$' then
      v_search_tail := v_search;
    else
      raise exception using errcode = '22023', message = 'loyalty_members_page searches by a membership id or by the last 1 to 3 digits of the phone, the digits a masked phone shows';
    end if;
  end if;

  if p_store_ids is null then
    v_stores := v_scope;
    v_member_tenants := v_tenants;
  else
    select coalesce(array_agg(s.id), '{}'::uuid[]), coalesce(array_agg(distinct s.tenant_id), '{}'::uuid[])
    into v_stores, v_member_tenants
    from public.stores s
    where s.id = any (p_store_ids)
      and s.id = any (v_scope);
  end if;

  return query
  with page as (
    select m.id, m.tenant_id, m.programme_id, m.customer_id, m.joined_at, m.status, m.channel
    from public.memberships m
    where m.tenant_id = any (v_member_tenants)
      and (v_after_at is null or (m.joined_at, m.id) < (v_after_at, v_after_id))
      and (v_search_id is null or m.id = v_search_id)
      and (
        v_search_tail is null
        or exists (
          select 1
          from public.customers c
          where c.id = m.customer_id
            and right(c.phone, char_length(v_search_tail)) = v_search_tail
        )
      )
    order by m.joined_at desc, m.id desc
    limit p_limit
  )
  select
    p.id,
    p.tenant_id,
    p.programme_id,
    case when c.phone is null then null else app.loyalty_masked_phone(c.phone) end,
    p.joined_at,
    p.status,
    p.channel,
    b.stamps,
    b.points,
    b.pending_stamps,
    b.pending_points,
    b.last_visit,
    to_char(p.joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '~' || p.id::text
  from page p
  join public.customers c on c.id = p.customer_id
  cross join lateral app.loyalty_store_balance(p.id, v_stores) b
  order by p.joined_at desc, p.id desc;
end;
$$;

comment on function public.loyalty_members_page(uuid[], text, integer, text) is 'the members list of the web section Khách hàng (#253) for owners, managers and viewers (42501 for everyone else): the memberships of the tenants of p_store_ids (every store in the caller''s loyalty scope when null; stores outside it are ignored), newest first by joined_at then id, at most p_limit rows (1 to 1,000, else 22023) after p_after, the page_key of the last row of the previous page (keyset paging; anything else is 22023). p_search narrows to one membership id or to the members whose phone ends in 1 to 3 digits, the digits the masked phone shows (anything else is 22023). The phone is masked (four and three dots and the last three digits), never full. The balance follows app.loyalty_balance over the ledger rows at the given stores in scope and the rows without a store: an owner or a manager or viewer of every store sees the whole balance; a manager or viewer limited to some stores sees the stamps and points earned, redeemed, adjusted, clawed back and expired at those stores plus the welcome stamps and off-store adjustments, which may be less than the member''s whole balance; last_visit is the latest business date of an earn among the same rows';

create function public.loyalty_member_lookup(p_phone text)
returns table (
  membership_id uuid,
  tenant_id uuid,
  programme_id uuid,
  phone_full text,
  phone_masked text,
  joined_at timestamptz,
  status public.membership_status,
  channel text,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  last_visit date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_rows constant integer := 100;
  v_tenants uuid[] := app.current_user_loyalty_tenant_ids();
  v_scope uuid[] := app.current_user_loyalty_store_ids();
  v_phone text := app.loyalty_normalize_phone(p_phone);
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if v_method not in ('', 'POST') then
    raise sqlstate 'PT405' using message = 'loyalty_member_lookup takes the phone in a POST body, never in a URL';
  end if;
  if cardinality(v_tenants) = 0 then
    raise exception using errcode = '42501', message = 'loyalty_member_lookup is for owners, managers and viewers';
  end if;
  if v_phone is null then
    return;
  end if;

  return query
  select
    m.id,
    m.tenant_id,
    m.programme_id,
    case when app.has_tenant_role(m.tenant_id, array['owner']::public.tenant_role[]) then v_phone end,
    app.loyalty_masked_phone(c.phone),
    m.joined_at,
    m.status,
    m.channel,
    b.stamps,
    b.points,
    b.pending_stamps,
    b.pending_points,
    b.last_visit
  from public.customers c
  join public.memberships m on m.customer_id = c.id and m.tenant_id = c.tenant_id
  cross join lateral app.loyalty_store_balance(m.id, v_scope) b
  where c.tenant_id = any (v_tenants)
    and c.phone is not null
    and (c.phone = v_phone or app.loyalty_normalize_phone(c.phone) = v_phone)
  order by m.joined_at desc, m.id desc
  limit max_rows;
end;
$$;

comment on function public.loyalty_member_lookup(text) is 'the phone lookup of the web section Khách hàng (#253) for owners, managers and viewers (42501 for everyone else): the memberships, in the tenants where the caller reads loyalty, of the customer whose phone reads as p_phone in E.164 form whatever form the till stored, newest first, at most 100; nothing for a phone that does not read or that no member has. phone_full is the E.164 phone for an owner of the membership''s tenant and null for everyone else; phone_masked is always the masked form. The balance is scoped as in loyalty_members_page (the caller''s loyalty stores and the rows without a store). Through PostgREST it answers POST only (the phone travels in the request body); a GET, which would carry the phone in the URL, is refused with PT405 (HTTP 405) before anything is read';

revoke all on function app.loyalty_store_balance(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_members_page(uuid[], text, integer, text) from public, anon, service_role;
revoke all on function public.loyalty_member_lookup(text) from public, anon, service_role;

grant execute on function public.loyalty_members_page(uuid[], text, integer, text) to authenticated;
grant execute on function public.loyalty_member_lookup(text) to authenticated;
