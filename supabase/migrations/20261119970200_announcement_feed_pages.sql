create function public.announcement_feed_page(
  p_tenant_id uuid,
  p_store_id uuid default null,
  p_include_expired boolean default false,
  p_after_pinned boolean default null,
  p_after_published_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  announcement_id uuid,
  tenant_id uuid,
  store_ids uuid[],
  audience public.tenant_role[],
  title text,
  body text,
  pinned boolean,
  pinned_until timestamptz,
  published_by uuid,
  published_at timestamptz,
  expires_at timestamptz,
  recipient boolean,
  read_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_tenant_id is null then
    raise exception 'the announcement feed names its tenant' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'a page of announcements holds 1 to 200 rows' using errcode = '22023';
  end if;
  if num_nulls(p_after_pinned, p_after_published_at, p_after_id) not in (0, 3) then
    raise exception 'a page cursor names pinned, published_at and id of the last row together, or nothing' using errcode = '22023';
  end if;
  return query
  with feed as (
    select
      a.id,
      a.tenant_id,
      a.store_ids,
      a.audience,
      a.title,
      a.body,
      coalesce(a.pinned_until > now(), false) as is_pinned,
      a.pinned_until,
      a.created_by,
      a.published_at,
      a.expires_at
    from public.announcements a
    where a.tenant_id = p_tenant_id
      and (p_store_id is null or a.store_ids is null or p_store_id = any (a.store_ids))
      and (coalesce(p_include_expired, false) or a.expires_at is null or a.expires_at > now())
  )
  select
    f.id,
    f.tenant_id,
    f.store_ids,
    f.audience,
    f.title,
    f.body,
    f.is_pinned,
    f.pinned_until,
    f.created_by,
    f.published_at,
    f.expires_at,
    exists (select 1 from public.announcement_recipients r where r.announcement_id = f.id and r.user_id = (select auth.uid())),
    (select c.read_at from public.announcement_receipts c where c.announcement_id = f.id and c.created_by = (select auth.uid()))
  from feed f
  where p_after_id is null
     or (p_after_pinned and not f.is_pinned)
     or (f.is_pinned = p_after_pinned and f.published_at < p_after_published_at)
     or (f.is_pinned = p_after_pinned and f.published_at = p_after_published_at and f.id > p_after_id)
  order by f.is_pinned desc, f.published_at desc, f.id
  limit p_limit;
end;
$$;

comment on function public.announcement_feed_page(uuid, uuid, boolean, boolean, timestamptz, uuid, integer) is 'the announcements of one tenant the caller may read, a page at a time (keyset paging), in the order of announcement_feed: pinned ones first while their pin lasts, then the newest, then by id; for one store (its own and the every-store ones) or all; expired ones only when asked; the next page starts after the pinned, published_at and announcement_id of the last row (all three or none); 1 to 200 rows a page, 50 by default; 22023 for a missing tenant, a bad page size or a partial cursor; announcement_feed (every tenant, at most 200 rows) stays for the staff app';

create function public.announcement_read_counts(p_announcement_ids uuid[])
returns table (
  announcement_id uuid,
  published_at timestamptz,
  recipients integer,
  readers integer,
  readers_within_24h integer,
  read_rate numeric,
  read_rate_24h numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_announcement_ids is null or cardinality(p_announcement_ids) > 200 then
    raise exception 'the read counts take a list of at most 200 announcement ids' using errcode = '22023';
  end if;
  return query
  select
    a.id,
    a.published_at,
    k.recipient_count,
    k.reader_count,
    k.early_count,
    case when k.recipient_count > 0 then round(k.reader_count::numeric / k.recipient_count, 4) end,
    case when k.recipient_count > 0 then round(k.early_count::numeric / k.recipient_count, 4) end
  from public.announcements a
  cross join lateral (
    select
      count(*)::integer as recipient_count,
      (count(c.id))::integer as reader_count,
      (count(c.id) filter (where c.read_at <= a.published_at + interval '24 hours'))::integer as early_count
    from public.announcement_recipients r
    left join public.announcement_receipts c on c.announcement_id = r.announcement_id and c.created_by = r.user_id
    where r.announcement_id = a.id
  ) k
  where a.id = any (p_announcement_ids)
    and app.has_tenant_role(a.tenant_id, array['owner', 'manager']::public.tenant_role[])
  order by a.published_at desc, a.id;
end;
$$;

comment on function public.announcement_read_counts(uuid[]) is 'announcement_read_rate for up to 200 announcements in one call: one row per listed announcement the caller may read as an owner or manager of its tenant, with the same counts over the recipients the caller may read; an id the caller may not read the rate of (staff, another tenant, unknown) is left out rather than refused; 22023 for no list or more than 200 ids';

revoke all on function public.announcement_feed_page(uuid, uuid, boolean, boolean, timestamptz, uuid, integer) from public, anon, service_role;
revoke all on function public.announcement_read_counts(uuid[]) from public, anon, service_role;
grant execute on function public.announcement_feed_page(uuid, uuid, boolean, boolean, timestamptz, uuid, integer) to authenticated;
grant execute on function public.announcement_read_counts(uuid[]) to authenticated;
