begin;
select plan(24);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000011701'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000011702'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000011701'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000011702'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000011701'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000011702'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000011711'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000011701'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000011702'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000011703'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000011704'::uuid as staff_x2,
  'eeeeeeee-eeee-4eee-8eee-000000011705'::uuid as owner_y,
  '77777777-7777-4777-8777-000000011701'::uuid as a1,
  '77777777-7777-4777-8777-000000011702'::uuid as a2,
  '77777777-7777-4777-8777-000000011703'::uuid as a3,
  '77777777-7777-4777-8777-000000011704'::uuid as a4,
  '77777777-7777-4777-8777-000000011705'::uuid as a5,
  '77777777-7777-4777-8777-000000011711'::uuid as y1,
  now() as t0;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'feed-pages-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_x, fx.manager_x1, fx.staff_x1, fx.staff_x2, fx.owner_y]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'feed-pages-pgtap-x', 'Feed pages pgTAP X' from fx
union all
select tenant_y, 'feed-pages-pgtap-y', 'Feed pages pgTAP Y' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'feed-pages-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'feed-pages-y', 'Synthetic account Y' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_x1, tenant_x, account_x, 'fp-x1', 'Synthetic store X1' from fx
union all
select store_x2, tenant_x, account_x, 'fp-x2', 'Synthetic store X2' from fx
union all
select store_y1, tenant_y, account_y, 'fp-y1', 'Synthetic store Y1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_x, 'owner', null::uuid[]), (fx.manager_x1, 'manager', array[fx.store_x1]),
         (fx.staff_x1, 'staff', array[fx.store_x1]), (fx.staff_x2, 'staff', array[fx.store_x2])
) as m (user_id, role, store_ids)
union all
select tenant_y, owner_x, 'owner', null from fx
union all
select tenant_y, owner_y, 'owner', null from fx;

insert into public.announcements (id, tenant_id, store_ids, title, body, pinned_until, published_at, expires_at, created_by, updated_by)
select a1, tenant_x, null::uuid[], 'A1', 'Every store, three days ago.', null::timestamptz, t0 - interval '3 days', null::timestamptz, owner_x, owner_x from fx
union all
select a2, tenant_x, array[store_x1], 'A2', 'Store X1, pinned.', t0 + interval '1 day', t0 - interval '2 days', null, owner_x, owner_x from fx
union all
select a3, tenant_x, array[store_x2], 'A3', 'Store X2, yesterday.', null, t0 - interval '1 day', null, owner_x, owner_x from fx
union all
select a4, tenant_x, null, 'A4', 'Every store, expired.', null, t0 - interval '2 hours', t0 - interval '1 minute', owner_x, owner_x from fx
union all
select a5, tenant_x, null, 'A5', 'Every store, same time as A4.', null, t0 - interval '2 hours', null, owner_x, owner_x from fx
union all
select y1, tenant_y, null, 'Y1', 'The other tenant.', null, t0 - interval '1 hour', null, owner_y, owner_y from fx;

insert into public.announcement_recipients (tenant_id, announcement_id, user_id, role, store_ids, created_by)
select tenant_x, a1, manager_x1, 'manager'::public.tenant_role, array[store_x1], owner_x from fx
union all
select tenant_x, a1, staff_x1, 'staff', array[store_x1], owner_x from fx
union all
select tenant_x, a1, staff_x2, 'staff', array[store_x2], owner_x from fx
union all
select tenant_x, a3, staff_x2, 'staff', array[store_x2], owner_x from fx;
insert into public.announcement_receipts (tenant_id, announcement_id, store_ids, read_at, created_by)
select tenant_x, a1, array[store_x1], t0 - interval '3 days' + interval '1 hour', staff_x1 from fx
union all
select tenant_x, a1, array[store_x1], t0 - interval '3 days' + interval '30 hours', manager_x1 from fx;

grant select on fx to authenticated;

create function pg_temp.label(p_id uuid)
returns text
language sql
as $$
  select case p_id when fx.a1 then 'a1' when fx.a2 then 'a2' when fx.a3 then 'a3' when fx.a4 then 'a4' when fx.a5 then 'a5' when fx.y1 then 'y1' else 'other' end
  from fx;
$$;

create function pg_temp.page_as(
  p_user uuid, p_tenant uuid, p_store uuid default null, p_expired boolean default true,
  p_pinned boolean default null, p_published timestamptz default null, p_after uuid default null, p_limit integer default 50
)
returns text
language plpgsql
as $$
declare
  v_labels text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(pg_temp.label(f.announcement_id) || case when f.pinned then '*' else '' end, ',' order by f.ordinality), '-')
  into v_labels
  from public.announcement_feed_page(p_tenant, p_store, p_expired, p_pinned, p_published, p_after, p_limit) with ordinality as f;
  return v_labels;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.walk_as(p_user uuid, p_tenant uuid, p_limit integer)
returns text
language plpgsql
as $$
declare
  v_pages text[] := array[]::text[];
  v_page text;
  v_row record;
  v_pinned boolean;
  v_published timestamptz;
  v_after uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  for i in 1..10 loop
    v_page := null;
    for v_row in
      select f.announcement_id, f.pinned, f.published_at
      from public.announcement_feed_page(p_tenant, null, true, v_pinned, v_published, v_after, p_limit) f
    loop
      v_page := coalesce(v_page || ',', '') || pg_temp.label(v_row.announcement_id);
      v_pinned := v_row.pinned;
      v_published := v_row.published_at;
      v_after := v_row.announcement_id;
    end loop;
    exit when v_page is null;
    v_pages := v_pages || v_page;
  end loop;
  return array_to_string(v_pages, ' | ');
end;
$$;

create function pg_temp.counts_as(p_user uuid, p_ids uuid[])
returns text
language plpgsql
as $$
declare
  v_rows text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(
    concat_ws(':', pg_temp.label(c.announcement_id), c.recipients, c.readers, c.readers_within_24h, coalesce(c.read_rate::text, 'null'), coalesce(c.read_rate_24h::text, 'null')),
    ',' order by pg_temp.label(c.announcement_id)), '-')
  into v_rows
  from public.announcement_read_counts(p_ids) c;
  return v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.rate_as(p_user uuid, p_id uuid)
returns text
language plpgsql
as $$
declare
  v_row text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select concat_ws(':', pg_temp.label(r.announcement_id), r.recipients, r.readers, r.readers_within_24h, coalesce(r.read_rate::text, 'null'), coalesce(r.read_rate_24h::text, 'null'))
  into v_row
  from public.announcement_read_rate(p_id) r;
  return v_row;
exception when others then
  return sqlstate;
end;
$$;

set local role authenticated;

select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx)), 'a2*,a4,a5,a3,a1', 'the feed of one tenant: pinned first, then the newest, ties by id, expired ones when asked');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), p_expired => false), 'a2*,a5,a3,a1', 'and without the expired ones by default');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_y from fx)), 'y1', 'a member of two tenants gets the asked tenant only');
select is(
  (select count(*)::integer from (select set_config('request.jwt.claims', json_build_object('sub', (select owner_x from fx), 'role', 'authenticated')::text, true)) s, public.announcement_feed(null, true)),
  6,
  'while the old feed still answers every tenant for the staff app'
);
select is(pg_temp.page_as((select owner_y from fx), (select tenant_x from fx)), '-', 'a caller outside the tenant gets nothing');
select is(pg_temp.page_as((select manager_x1 from fx), (select tenant_x from fx)), 'a2*,a4,a5,a1', 'a store-limited manager gets the stores of the scope and the every-store ones');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), (select store_x2 from fx)), 'a4,a5,a3,a1', 'one store: its own and the every-store announcements');

select is(pg_temp.walk_as((select owner_x from fx), (select tenant_x from fx), 2), 'a2,a4 | a5,a3 | a1', 'pages of two follow each other without a gap or a repeat');
select is(pg_temp.walk_as((select owner_x from fx), (select tenant_x from fx), 1), 'a2 | a4 | a5 | a3 | a1', 'pages of one cross the pinned rows and the tie on published_at');
select is(pg_temp.walk_as((select owner_x from fx), (select tenant_x from fx), 200), 'a2,a4,a5,a3,a1', 'a page of 200 holds them all');
select is(
  pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), p_pinned => true, p_published => (select t0 - interval '2 days' from fx), p_after => (select a2 from fx)),
  'a4,a5,a3,a1',
  'the page after the last pinned row starts with the newest unpinned one'
);

select is(pg_temp.page_as((select owner_x from fx), null), '22023', 'the tenant is required');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), p_limit => 0), '22023', 'a page holds at least one row');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), p_limit => 201), '22023', 'and at most 200');
select is(pg_temp.page_as((select owner_x from fx), (select tenant_x from fx), p_after => (select a1 from fx)), '22023', 'a cursor names all three keys of the last row');

select is(
  pg_temp.counts_as((select owner_x from fx), (select array[a1, a2, a3, y1, '77777777-7777-4777-8777-000000011799'::uuid] from fx)),
  'a1:3:2:1:0.6667:0.3333,a2:0:0:0:null:null,a3:1:0:0:0.0000:0.0000,y1:0:0:0:null:null',
  'one row per announcement the owner may read, across both tenants; an unknown id is left out'
);
select is(
  pg_temp.counts_as((select owner_x from fx), (select array[a1] from fx)),
  pg_temp.rate_as((select owner_x from fx), (select a1 from fx)),
  'the counts are those of announcement_read_rate'
);
select is(
  pg_temp.counts_as((select manager_x1 from fx), (select array[a1, a3] from fx)),
  'a1:2:2:1:1.0000:0.5000',
  'a store-limited manager counts the recipients of the scope and does not get an announcement outside it'
);
select is(
  pg_temp.counts_as((select manager_x1 from fx), (select array[a1] from fx)),
  pg_temp.rate_as((select manager_x1 from fx), (select a1 from fx)),
  'as announcement_read_rate does for the manager'
);
select is(pg_temp.counts_as((select staff_x1 from fx), (select array[a1] from fx)), '-', 'staff get no counts, without an error');
select is(pg_temp.counts_as((select owner_y from fx), (select array[a1, y1] from fx)), 'y1:0:0:0:null:null', 'another tenant''s owner gets their own announcements only');
select is(pg_temp.counts_as((select owner_x from fx), array[]::uuid[]), '-', 'an empty list answers nothing');
select is(pg_temp.counts_as((select owner_x from fx), null), '22023', 'a list is required');
select is(
  pg_temp.counts_as((select owner_x from fx), (select array_agg(gen_random_uuid()) from generate_series(1, 201))),
  '22023',
  'at most 200 ids'
);

reset role;

select * from finish();
rollback;
