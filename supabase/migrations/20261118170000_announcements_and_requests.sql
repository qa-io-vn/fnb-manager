alter table public.outbound_messages drop constraint outbound_messages_kind_check;
alter table public.outbound_messages
  add constraint outbound_messages_kind_check check (kind is null or kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved', 'test', 'link_code', 'link_notice', 'link_confirmation', 'announcement', 'request_decided'));

comment on column public.outbound_messages.kind is 'digest, digest_correction, alert, alert_reminder, alert_resolved, test, link_code, link_notice, link_confirmation, announcement (a new announcement waits in the staff app) or request_decided (a request of the member was approved or refused); null on log rows outside the outbox';

create function app.ops_can_write_own_stores(tenant_id uuid, store_ids uuid[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when ops_can_write_own_stores.store_ids is null then app.ops_can_write_own(ops_can_write_own_stores.tenant_id, null)
    else cardinality(ops_can_write_own_stores.store_ids) > 0
      and not exists (
        select 1
        from unnest(ops_can_write_own_stores.store_ids) as s (id)
        where not app.ops_can_write_own(ops_can_write_own_stores.tenant_id, s.id)
      )
  end;
$$;

comment on function app.ops_can_write_own_stores(uuid, uuid[]) is 'operations RLS for rows that name several stores: app.ops_can_write_own holds for every store of the list; a null list (every store) needs an unlimited scope';

create function app.ops_can_manage_stores(tenant_id uuid, store_ids uuid[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when ops_can_manage_stores.store_ids is null then app.ops_can_manage(ops_can_manage_stores.tenant_id, null)
    else cardinality(ops_can_manage_stores.store_ids) > 0
      and not exists (
        select 1
        from unnest(ops_can_manage_stores.store_ids) as s (id)
        where not app.ops_can_manage(ops_can_manage_stores.tenant_id, s.id)
      )
  end;
$$;

comment on function app.ops_can_manage_stores(uuid, uuid[]) is 'operations RLS for rows that name several stores: app.ops_can_manage holds for every store of the list; a null list (every store) needs an owner or manager with an unlimited scope';

create function app.store_scope_overlap(p_left uuid[], p_right uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_left is null then p_right
    when p_right is null then p_left
    else array(select l.id from unnest(p_left) as l (id) where l.id = any (p_right) order by l.id)
  end;
$$;

comment on function app.store_scope_overlap(uuid[], uuid[]) is 'the stores two scopes share, where null means every store: the other list when one is null, null when both are, else the common stores (an empty array when none)';

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_ids uuid[] check (store_ids is null or (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null)),
  audience public.tenant_role[] not null default array['manager', 'staff']::public.tenant_role[]
    check (cardinality(audience) between 1 and 3 and audience <@ array['owner', 'manager', 'staff']::public.tenant_role[]),
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  body text not null check (char_length(body) between 1 and 4000 and translate(body, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  pinned_until timestamptz,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at is null or expires_at > published_at),
  check (pinned_until is null or pinned_until > published_at),
  check (pinned_until is null or expires_at is null or pinned_until <= expires_at)
);

comment on table public.announcements is 'announcements (FR-STF-19): a plain-text title and body published by an owner or manager to the members of the audience roles in the store scope, written only through publish_announcement; pinned while pinned_until lies ahead, hidden from the feed after expires_at; the title and body never enter a message, an alert or a log';
comment on column public.announcements.store_ids is 'the stores the announcement is for; null for every store of the tenant, which only a member with an unlimited scope publishes';
comment on column public.announcements.audience is 'the roles it is published to, among owner, manager and staff; owners and managers of its stores read it whatever the audience';
comment on column public.announcements.pinned_until is 'the announcement stays first in the feed and on the staff home until this instant; null when not pinned; changed through set_announcement_pin';
comment on column public.announcements.created_by is 'the author';

create index announcements_tenant_published_idx on public.announcements (tenant_id, published_at desc);

create table public.announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  announcement_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.tenant_role not null check (role in ('owner', 'manager', 'staff')),
  store_ids uuid[] check (store_ids is null or (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null)),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (announcement_id, user_id),
  unique (tenant_id, id),
  foreign key (tenant_id, announcement_id) references public.announcements (tenant_id, id) on delete cascade
);

comment on table public.announcement_recipients is 'the members an announcement was published to, fixed at publication so the read rate keeps its denominator: every owner, manager or staff member of an audience role whose store scope meets the announcement''s, the author left out; kept when the member later leaves; written only by publish_announcement';
comment on column public.announcement_recipients.role is 'the member''s role at publication';
comment on column public.announcement_recipients.store_ids is 'the stores at which the member received it: the member''s store scope at publication within the announcement''s (null when both are every store); owners and managers whose scope meets it read the row';
comment on column public.announcement_recipients.created_by is 'the author who published it';

create index announcement_recipients_user_idx on public.announcement_recipients (user_id);

create table public.announcement_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  announcement_id uuid not null,
  store_ids uuid[] check (store_ids is null or (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null)),
  read_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (announcement_id, created_by),
  unique (tenant_id, id),
  foreign key (tenant_id, announcement_id) references public.announcements (tenant_id, id) on delete cascade
);

comment on table public.announcement_receipts is 'Đã đọc: one receipt per reader (created_by) and announcement, written only by the reader through mark_announcement_read; the first tap is kept, so read_at never moves';
comment on column public.announcement_receipts.store_ids is 'the reader''s recipient store_ids, or for a reader who was not a recipient their scope within the announcement''s';
comment on column public.announcement_receipts.created_by is 'the reader';

create index announcement_receipts_reader_idx on public.announcement_receipts (created_by);

create table public.approval_request_kinds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null check (char_length(label) between 1 and 60 and label !~ '[[:cntrl:]]'),
  sort_order smallint not null default 50 check (sort_order between 1 and 99),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, key)
);

comment on table public.approval_request_kinds is 'kinds of staff requests: the Vietnamese defaults as global rows (tenant_id null) and a tenant''s own rows, which override a default of the same key (label, order, active) or add a key; leave and shift swaps stay with the POS vendor''s HR product and have no default; a tenant''s effective list is approval_request_kinds_of; tenant rows written by owners with an unlimited scope';
comment on column public.approval_request_kinds.key is 'the stable key a request stores in approval_requests.kind_key; never changes once written';

insert into public.approval_request_kinds (tenant_id, key, label, sort_order)
values
  (null, 'mua_hang', 'Mua hàng cho cửa hàng', 10),
  (null, 'chenh_lech_tien', 'Giải trình chênh lệch tiền', 20),
  (null, 'ngoai_le_checklist', 'Ngoại lệ checklist', 30),
  (null, 'khac', 'Khác', 90);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  kind_key text not null check (kind_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  details text not null check (char_length(details) between 1 and 1000 and translate(details, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  refusal_reason text check (refusal_reason is null or (char_length(refusal_reason) between 1 and 500 and translate(refusal_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (decided_by is null or decided_at is not null),
  check ((status = 'refused') = (refusal_reason is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.approval_requests is 'staff requests to the managers of a store (FR-STF-20): a kind, plain-text details and the requester (created_by); pending until an owner or manager of the store other than the requester approves or refuses it through decide_request, with a reason on refusal; a decided request never changes; details and reason never enter a message, an alert or a log';
comment on column public.approval_requests.refusal_reason is 'the reason given with a refusal, shown to the requester; set exactly when the status is refused';

create index approval_requests_pending_idx on public.approval_requests (store_id, created_at) where status = 'pending';
create index approval_requests_tenant_created_idx on public.approval_requests (tenant_id, created_at desc);
create index approval_requests_requester_idx on public.approval_requests (created_by, created_at desc);

create function app.approval_request_kind_active(p_tenant_id uuid, p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select k.active
    from public.approval_request_kinds k
    where k.key = p_key
      and (k.tenant_id = p_tenant_id or k.tenant_id is null)
    order by k.tenant_id nulls last
    limit 1
  ), false);
$$;

comment on function app.approval_request_kind_active(uuid, text) is 'whether the key is an active request kind for the tenant: its own row when it has one, else the global default';

create function app.announcement_visible(p_tenant_id uuid, p_store_ids uuid[], p_audience public.tenant_role[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select (
      p_store_ids && app.current_user_ops_store_ids()
      or (p_store_ids is null and app.has_tenant_role(p_tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
    )
    and (
      app.has_tenant_role(p_tenant_id, array['owner', 'manager']::public.tenant_role[])
      or app.has_tenant_role(p_tenant_id, p_audience)
    );
$$;

comment on function app.announcement_visible(uuid, uuid[], public.tenant_role[]) is 'the read rule of announcements for the caller, as its select policy: one of its stores in the caller''s operations scope (every owner, manager and staff member of the tenant for an announcement to every store), and the caller an owner or manager of the tenant or of an audience role';

create function app.refuse_announcement_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are written by the announcement functions only', tg_table_name using errcode = '55000';
end;
$$;

comment on function app.refuse_announcement_row_change() is 'trigger before an update of announcement_recipients or announcement_receipts: refused (55000), so the recipients stay as published and a receipt keeps its first read time';

create function app.guard_announcement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_ids, new.audience, new.title, new.body, new.published_at, new.expires_at, new.created_by, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.store_ids, old.audience, old.title, old.body, old.published_at, old.expires_at, old.created_by, old.created_at) then
    raise exception 'a published announcement keeps its stores, audience, text and times; only its pin changes' using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function app.guard_announcement() is 'trigger before an announcement is updated: everything but pinned_until is fixed (55000)';

create function app.prepare_approval_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.approval_request_kind_active(new.tenant_id, new.kind_key) then
    raise exception 'the kind is not an active request kind of the tenant' using errcode = '22023';
  end if;
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.refusal_reason := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.prepare_approval_request() is 'trigger before a request is inserted: an active kind of the tenant (22023); pending and undecided whatever the client sent';

create function app.guard_approval_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_id, new.kind_key, new.details, new.created_by, new.created_at)
     is distinct from (old.id, old.tenant_id, old.store_id, old.kind_key, old.details, old.created_by, old.created_at) then
    raise exception 'a request keeps its store, kind, details and requester' using errcode = '55000';
  end if;
  if old.status <> 'pending' and (new.status, new.decided_by, new.decided_at, new.refusal_reason) is distinct from (old.status, old.decided_by, old.decided_at, old.refusal_reason) then
    raise exception 'a decided request stays as decided' using errcode = '55000';
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
    if new.decided_by is null or new.decided_by is not distinct from old.created_by then
      raise exception 'nobody decides their own request' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.guard_approval_request() is 'trigger before a request is updated: store, kind, details and requester fixed and a decided request frozen (55000); a decision names a decider who is not the requester (42501)';

create trigger announcements_guard before update on public.announcements for each row execute function app.guard_announcement();
create trigger announcements_set_updated_at before update on public.announcements for each row execute function app.set_updated_at();
create trigger announcements_keep_created_by before update on public.announcements for each row execute function app.keep_created_by();
create trigger announcements_set_updated_by before insert or update on public.announcements for each row execute function app.set_updated_by();
create trigger announcements_validate_store_ids before insert or update of tenant_id, store_ids on public.announcements for each row execute function app.validate_zalo_store_ids();
create trigger announcement_recipients_refuse_update before update on public.announcement_recipients for each row execute function app.refuse_announcement_row_change();
create trigger announcement_receipts_refuse_update before update on public.announcement_receipts for each row execute function app.refuse_announcement_row_change();
create trigger approval_request_kinds_set_updated_at before update on public.approval_request_kinds for each row execute function app.set_updated_at();
create trigger approval_request_kinds_keep_created_by before update on public.approval_request_kinds for each row execute function app.keep_created_by();
create trigger approval_request_kinds_set_updated_by before insert or update on public.approval_request_kinds for each row execute function app.set_updated_by();
create trigger approval_requests_prepare before insert on public.approval_requests for each row execute function app.prepare_approval_request();
create trigger approval_requests_guard before update on public.approval_requests for each row execute function app.guard_approval_request();
create trigger approval_requests_set_updated_at before update on public.approval_requests for each row execute function app.set_updated_at();
create trigger approval_requests_keep_created_by before update on public.approval_requests for each row execute function app.keep_created_by();

comment on function app.validate_zalo_store_ids() is 'trigger on brands, gmf_groups, staff_roster and announcements: refuses a store listed twice (22023) and a store that is not a store of the row''s tenant (23503), the array form of the tenant-consistent foreign key';

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.announcement_receipts enable row level security;
alter table public.approval_request_kinds enable row level security;
alter table public.approval_requests enable row level security;

create policy announcements_select_for_operations on public.announcements
  for select to authenticated
  using (
    (
      store_ids && (select app.current_user_ops_store_ids())::uuid[]
      or (store_ids is null and app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
    )
    and (
      app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[])
      or app.has_tenant_role(tenant_id, audience)
    )
  );
create policy announcements_insert_own on public.announcements
  for insert to authenticated
  with check (app.ops_can_write_own_stores(tenant_id, store_ids) and created_by = (select auth.uid()));
create policy announcements_update_own_or_managed on public.announcements
  for update to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)))
  with check (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)));
create policy announcements_delete_managed on public.announcements
  for delete to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids));

create policy announcement_recipients_select_for_operations on public.announcement_recipients
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
    or (
      app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[])
      and (store_ids is null or store_ids && (select app.current_user_ops_store_ids())::uuid[])
    )
  );
create policy announcement_recipients_insert_own on public.announcement_recipients
  for insert to authenticated
  with check (app.ops_can_write_own_stores(tenant_id, store_ids) and created_by = (select auth.uid()));
create policy announcement_recipients_update_own_or_managed on public.announcement_recipients
  for update to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)))
  with check (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)));
create policy announcement_recipients_delete_managed on public.announcement_recipients
  for delete to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids));

create policy announcement_receipts_select_for_operations on public.announcement_receipts
  for select to authenticated
  using (
    (created_by = (select auth.uid()) and app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]))
    or (
      app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[])
      and (store_ids is null or store_ids && (select app.current_user_ops_store_ids())::uuid[])
    )
  );
create policy announcement_receipts_insert_own on public.announcement_receipts
  for insert to authenticated
  with check (app.ops_can_write_own_stores(tenant_id, store_ids) and created_by = (select auth.uid()));
create policy announcement_receipts_update_own_or_managed on public.announcement_receipts
  for update to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)))
  with check (app.ops_can_manage_stores(tenant_id, store_ids) or (created_by = (select auth.uid()) and app.ops_can_write_own_stores(tenant_id, store_ids)));
create policy announcement_receipts_delete_managed on public.announcement_receipts
  for delete to authenticated
  using (app.ops_can_manage_stores(tenant_id, store_ids));

create policy approval_request_kinds_select_for_operations on public.approval_request_kinds
  for select to authenticated
  using (tenant_id is null or app.has_tenant_role(tenant_id, array['owner', 'manager', 'staff']::public.tenant_role[]));
create policy approval_request_kinds_insert_for_owners on public.approval_request_kinds
  for insert to authenticated
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy approval_request_kinds_update_for_owners on public.approval_request_kinds
  for update to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy approval_request_kinds_delete_for_owners on public.approval_request_kinds
  for delete to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy approval_requests_select_for_operations on public.approval_requests
  for select to authenticated
  using (
    store_id = any ((select app.current_user_ops_store_ids())::uuid[])
    and (created_by = (select auth.uid()) or app.ops_can_manage(tenant_id, store_id))
  );
create policy approval_requests_insert_own on public.approval_requests
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy approval_requests_update_own_or_managed on public.approval_requests
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy approval_requests_delete_managed on public.approval_requests
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

revoke all on public.announcements, public.announcement_recipients, public.announcement_receipts, public.approval_request_kinds, public.approval_requests from anon, authenticated;
grant select on public.announcements, public.announcement_recipients, public.announcement_receipts, public.approval_requests to authenticated;
grant select, insert, delete on public.approval_request_kinds to authenticated;
grant update (label, sort_order, active) on public.approval_request_kinds to authenticated;
grant insert (tenant_id, store_id, kind_key, details) on public.approval_requests to authenticated;

create function app.member_destinations(p_tenant_id uuid, p_user_id uuid, p_store_ids uuid[])
returns table (channel_id uuid)
language sql
stable
set search_path = ''
as $$
  select c.id
  from public.notification_channels c
  where c.tenant_id = p_tenant_id
    and c.user_id = p_user_id
    and c.kind <> 'webhook'
    and c.enabled
    and c.status in ('active', 'failing')
    and (c.store_ids is null or p_store_ids is null or c.store_ids && p_store_ids)
    and app.has_active_consent(p_tenant_id, 'staff', p_user_id, 'notifications')
  order by c.created_at, c.id;
$$;

comment on function app.member_destinations(uuid, uuid, uuid[]) is 'the destinations an operational message to one member goes to until #231 chooses one route: every active or failing, enabled destination of the member whose store narrowing meets the stores (null for every store), and none while the member has no active notifications consent';

create function app.enqueue_member_message(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_key text,
  p_params jsonb,
  p_store_ids uuid[],
  p_expires_at timestamptz,
  p_at timestamptz
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  queued integer := 0;
begin
  if p_kind is null or p_kind not in ('announcement', 'request_decided') then
    raise exception 'enqueue_member_message needs the kind announcement or request_decided' using errcode = '22023';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_:.-]{1,150}$' or not app.facts_are_count_only(p_params) or p_at is null then
    raise exception 'enqueue_member_message needs a key of lower-case tokens, count-only parameters and an instant' using errcode = '22023';
  end if;
  for target in
    select d.channel_id from app.member_destinations(p_tenant_id, p_user_id, p_store_ids) d
  loop
    continue when exists (
      select 1
      from public.outbound_messages o
      where o.tenant_id = p_tenant_id
        and o.dedupe_key = p_key || ':' || target.channel_id::text
    );
    perform app.enqueue_message(
      p_tenant_id,
      target.channel_id,
      p_kind,
      p_kind || '.v1',
      p_key || ':' || target.channel_id::text,
      p_params,
      null,
      null,
      'info',
      case when cardinality(p_store_ids) = 1 then p_store_ids[1] end,
      null,
      null,
      null,
      coalesce(least(p_expires_at, p_at + interval '24 hours'), p_at + interval '24 hours'),
      p_at
    );
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

comment on function app.enqueue_member_message(uuid, uuid, text, text, jsonb, uuid[], timestamptz, timestamptz) is 'queues one operational message of the kind announcement or request_decided to each destination of app.member_destinations: template <kind>.v1, dedupe key <p_key>:<destination>, count-only parameters and no title or body, so the message only says that something waits in the staff app; the store of a one-store scope; expiring after 24 hours or at p_expires_at when sooner; a destination that already has the key is skipped; returns the number queued';

create function app.publish_announcement(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_store_ids uuid[] default null,
  p_audience public.tenant_role[] default array['manager', 'staff']::public.tenant_role[],
  p_pinned_until timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title);
  v_body text := btrim(p_body, E' \n\r\t');
  v_store_ids uuid[];
  v_audience public.tenant_role[];
  v_row public.announcements;
  v_recipient record;
  v_recipients integer := 0;
  v_messages integer := 0;
begin
  if p_store_ids is not null then
    if cardinality(p_store_ids) not between 1 and 50 or array_position(p_store_ids, null) is not null
       or cardinality(p_store_ids) <> (select count(distinct s.id) from unnest(p_store_ids) as s (id)) then
      raise exception 'an announcement names 1 to 50 distinct stores, or null for every store' using errcode = '22023';
    end if;
    select array_agg(s.id order by s.id) into v_store_ids from unnest(p_store_ids) as s (id);
  end if;
  if not app.ops_can_manage_stores(p_tenant_id, v_store_ids) then
    raise exception 'only an owner or a manager of every store of the announcement publishes it' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 120 or v_title ~ '[[:cntrl:]]' then
    raise exception 'an announcement title has 1 to 120 characters' using errcode = '22023';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 4000 or translate(v_body, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception 'an announcement body is plain text of 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_audience is null or cardinality(p_audience) = 0 or array_position(p_audience, null) is not null
     or not (p_audience <@ array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'the audience is one or more of owner, manager and staff' using errcode = '22023';
  end if;
  select array_agg(r.role order by r.role) into v_audience from (select distinct a.role from unnest(p_audience) as a (role)) r;
  if p_pinned_until is not null and (p_pinned_until <= now() or p_pinned_until > now() + interval '365 days') then
    raise exception 'a pin ends within the next 365 days' using errcode = '22023';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '730 days') then
    raise exception 'an announcement expires within the next 730 days' using errcode = '22023';
  end if;
  if p_pinned_until is not null and p_expires_at is not null and p_pinned_until > p_expires_at then
    raise exception 'a pin ends no later than the announcement expires' using errcode = '22023';
  end if;
  insert into public.announcements (tenant_id, store_ids, audience, title, body, pinned_until, published_at, expires_at, created_by, updated_by)
  values (p_tenant_id, v_store_ids, v_audience, v_title, v_body, p_pinned_until, now(), p_expires_at, (select auth.uid()), (select auth.uid()))
  returning * into v_row;
  insert into public.announcement_recipients (tenant_id, announcement_id, user_id, role, store_ids, created_by)
  select v_row.tenant_id, v_row.id, m.user_id, m.role, app.store_scope_overlap(m.store_ids, v_row.store_ids), (select auth.uid())
  from public.tenant_members m
  where m.tenant_id = v_row.tenant_id
    and m.role = any (v_row.audience)
    and m.user_id <> (select auth.uid())
    and (m.store_ids is null or v_row.store_ids is null or m.store_ids && v_row.store_ids);
  get diagnostics v_recipients = row_count;
  for v_recipient in
    select r.user_id, r.store_ids
    from public.announcement_recipients r
    where r.announcement_id = v_row.id
    order by r.user_id
  loop
    v_messages := v_messages + app.enqueue_member_message(
      v_row.tenant_id,
      v_recipient.user_id,
      'announcement',
      'announcement:' || v_row.id::text,
      jsonb_build_object(
        'announcement_id', v_row.id::text,
        'pinned', v_row.pinned_until is not null,
        'all_stores', v_row.store_ids is null,
        'store_count', cardinality(v_row.store_ids)
      ),
      v_recipient.store_ids,
      v_row.expires_at,
      v_row.published_at
    );
  end loop;
  if v_messages > 0 then
    perform app.kick_notify('kick');
  end if;
  return jsonb_build_object(
    'announcement_id', v_row.id,
    'published_at', v_row.published_at,
    'recipients', v_recipients,
    'messages', v_messages
  );
end;
$$;

comment on function app.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) is 'publishes an announcement as an owner or manager of every store it names (every store needs an unlimited scope; 42501 otherwise): a plain-text title and body, the audience roles, an optional pin end within 365 days and expiry within 730 days (22023 otherwise); fixes its recipients (every owner, manager or staff member of an audience role whose scope meets the stores, the author left out) and queues one announcement message per recipient destination with count-only parameters and no text; returns {announcement_id, published_at, recipients, messages}';

create function app.set_announcement_pin(p_announcement_id uuid, p_pinned_until timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.announcements;
begin
  select a.* into v_row
  from public.announcements a
  where a.id = p_announcement_id
  for update;
  if not found or not app.ops_can_manage_stores(v_row.tenant_id, v_row.store_ids) then
    raise exception 'the announcement cannot be pinned by this member' using errcode = '42501';
  end if;
  if p_pinned_until is not null and (p_pinned_until <= now() or p_pinned_until > now() + interval '365 days') then
    raise exception 'a pin ends within the next 365 days' using errcode = '22023';
  end if;
  if p_pinned_until is not null and v_row.expires_at is not null and p_pinned_until > v_row.expires_at then
    raise exception 'a pin ends no later than the announcement expires' using errcode = '22023';
  end if;
  update public.announcements a
  set pinned_until = p_pinned_until,
      updated_by = (select auth.uid())
  where a.id = v_row.id
  returning a.* into v_row;
  return jsonb_build_object(
    'announcement_id', v_row.id,
    'pinned_until', v_row.pinned_until,
    'pinned', coalesce(v_row.pinned_until > now(), false)
  );
end;
$$;

comment on function app.set_announcement_pin(uuid, timestamptz) is 'pins an announcement until p_pinned_until (within 365 days and not after its expiry, 22023 otherwise) or unpins it with null, as an owner or manager of every store it names (42501 otherwise); no message is sent; returns {announcement_id, pinned_until, pinned}';

create function app.mark_announcement_read(p_announcement_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.announcements;
  v_reader uuid := (select auth.uid());
  v_scope uuid[];
  v_recipient boolean;
  v_read_at timestamptz;
begin
  select a.* into v_row from public.announcements a where a.id = p_announcement_id;
  if not found or v_reader is null or not app.announcement_visible(v_row.tenant_id, v_row.store_ids, v_row.audience) then
    raise exception 'the announcement cannot be read by this member' using errcode = '42501';
  end if;
  select r.store_ids, true into v_scope, v_recipient
  from public.announcement_recipients r
  where r.announcement_id = v_row.id
    and r.user_id = v_reader;
  if not found then
    v_recipient := false;
    select app.store_scope_overlap(m.store_ids, v_row.store_ids) into v_scope
    from public.tenant_members m
    where m.tenant_id = v_row.tenant_id
      and m.user_id = v_reader;
    if not found or cardinality(v_scope) = 0 then
      raise exception 'the announcement cannot be read by this member' using errcode = '42501';
    end if;
  end if;
  insert into public.announcement_receipts (tenant_id, announcement_id, store_ids, read_at, created_by)
  values (v_row.tenant_id, v_row.id, v_scope, now(), v_reader)
  on conflict (announcement_id, created_by) do nothing;
  select c.read_at into v_read_at
  from public.announcement_receipts c
  where c.announcement_id = v_row.id
    and c.created_by = v_reader;
  return jsonb_build_object('announcement_id', v_row.id, 'read_at', v_read_at, 'recipient', v_recipient);
end;
$$;

comment on function app.mark_announcement_read(uuid) is 'Đã đọc: records the caller''s own receipt of an announcement the caller may read (42501 otherwise); a second tap keeps the first read time; returns {announcement_id, read_at, recipient}, recipient false for a member who joined after publication, whose receipt is kept but not counted in the read rate';

create function app.decide_request(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.approval_requests;
  v_reason text := nullif(btrim(p_reason, E' \n\r\t'), '');
  v_messages integer := 0;
begin
  select r.* into v_row
  from public.approval_requests r
  where r.id = p_request_id
  for update;
  if not found or not app.ops_can_manage(v_row.tenant_id, v_row.store_id) then
    raise exception 'the request cannot be decided by this member' using errcode = '42501';
  end if;
  if v_row.created_by = (select auth.uid()) then
    raise exception 'nobody decides their own request' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'refused') then
    raise exception 'a decision is approved or refused' using errcode = '22023';
  end if;
  if p_decision = 'refused' and (v_reason is null or char_length(v_reason) > 500 or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]') then
    raise exception 'a refusal needs a reason of 1 to 500 characters' using errcode = '22023';
  end if;
  if p_decision = 'approved' and v_reason is not null then
    raise exception 'a reason goes only with a refusal' using errcode = '22023';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'the request is already decided' using errcode = '55000';
  end if;
  update public.approval_requests r
  set status = p_decision,
      decided_by = (select auth.uid()),
      decided_at = now(),
      refusal_reason = case when p_decision = 'refused' then v_reason end
  where r.id = v_row.id
  returning r.* into v_row;
  if v_row.created_by is not null then
    v_messages := app.enqueue_member_message(
      v_row.tenant_id,
      v_row.created_by,
      'request_decided',
      'request:' || v_row.id::text,
      jsonb_build_object('request_id', v_row.id::text, 'decision', v_row.status, 'kind_key', v_row.kind_key),
      array[v_row.store_id],
      null,
      v_row.decided_at
    );
    if v_messages > 0 then
      perform app.kick_notify('kick');
    end if;
  end if;
  return jsonb_build_object(
    'request_id', v_row.id,
    'status', v_row.status,
    'decided_by', v_row.decided_by,
    'decided_at', v_row.decided_at,
    'refusal_reason', v_row.refusal_reason,
    'messages', v_messages
  );
end;
$$;

comment on function app.decide_request(uuid, text, text) is 'approves or refuses a pending request as an owner or manager of its store who is not the requester (42501 otherwise): approved without a reason, refused with a reason of 1 to 500 characters (22023 otherwise); a decided request gives 55000; queues one request_decided message per destination of the requester with count-only parameters (request id, decision, kind key) and never the details or the reason; returns {request_id, status, decided_by, decided_at, refusal_reason, messages}';

create function public.publish_announcement(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_store_ids uuid[] default null,
  p_audience public.tenant_role[] default array['manager', 'staff']::public.tenant_role[],
  p_pinned_until timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.publish_announcement(p_tenant_id, p_title, p_body, p_store_ids, p_audience, p_pinned_until, p_expires_at);
$$;

comment on function public.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) is 'RPC: app.publish_announcement';

create function public.set_announcement_pin(p_announcement_id uuid, p_pinned_until timestamptz)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.set_announcement_pin(p_announcement_id, p_pinned_until);
$$;

comment on function public.set_announcement_pin(uuid, timestamptz) is 'RPC: app.set_announcement_pin';

create function public.mark_announcement_read(p_announcement_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.mark_announcement_read(p_announcement_id);
$$;

comment on function public.mark_announcement_read(uuid) is 'RPC: app.mark_announcement_read';

create function public.decide_request(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.decide_request(p_request_id, p_decision, p_reason);
$$;

comment on function public.decide_request(uuid, text, text) is 'RPC: app.decide_request';

create function public.announcement_feed(p_store_id uuid default null, p_include_expired boolean default false)
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
language sql
stable
set search_path = ''
as $$
  select
    a.id,
    a.tenant_id,
    a.store_ids,
    a.audience,
    a.title,
    a.body,
    coalesce(a.pinned_until > now(), false),
    a.pinned_until,
    a.created_by,
    a.published_at,
    a.expires_at,
    exists (select 1 from public.announcement_recipients r where r.announcement_id = a.id and r.user_id = (select auth.uid())),
    (select c.read_at from public.announcement_receipts c where c.announcement_id = a.id and c.created_by = (select auth.uid()))
  from public.announcements a
  where (p_store_id is null or a.store_ids is null or p_store_id = any (a.store_ids))
    and (coalesce(p_include_expired, false) or a.expires_at is null or a.expires_at > now())
  order by coalesce(a.pinned_until > now(), false) desc, a.published_at desc, a.id
  limit 200;
$$;

comment on function public.announcement_feed(uuid, boolean) is 'the announcements the caller may read, for one store (its own and the every-store ones) or all: pinned ones first while their pin lasts, then the newest; expired ones only when asked; with whether the caller is a recipient and the caller''s own read time; at most 200 rows';

create function public.announcement_read_rate(p_announcement_id uuid)
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
declare
  v_row public.announcements;
begin
  select a.* into v_row from public.announcements a where a.id = p_announcement_id;
  if not found or not app.has_tenant_role(v_row.tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'the read rate is for owners and managers of the announcement''s stores' using errcode = '42501';
  end if;
  return query
  with counted as (
    select
      count(*)::integer as recipient_count,
      (count(c.id))::integer as reader_count,
      (count(c.id) filter (where c.read_at <= v_row.published_at + interval '24 hours'))::integer as early_count
    from public.announcement_recipients r
    left join public.announcement_receipts c on c.announcement_id = r.announcement_id and c.created_by = r.user_id
    where r.announcement_id = v_row.id
  )
  select
    v_row.id,
    v_row.published_at,
    k.recipient_count,
    k.reader_count,
    k.early_count,
    case when k.recipient_count > 0 then round(k.reader_count::numeric / k.recipient_count, 4) end,
    case when k.recipient_count > 0 then round(k.early_count::numeric / k.recipient_count, 4) end
  from counted k;
end;
$$;

comment on function public.announcement_read_rate(uuid) is 'the read rate of an announcement over its fixed recipients that the caller may read (an owner or manager reads the recipients whose stores meet the caller''s scope, so a store-limited manager gets the rate of their own staff): recipients, readers, readers within 24 hours of publication and both shares; a reader who was not a recipient is not counted; 42501 for staff, for a member outside the tenant and for an announcement the caller cannot read';

create function public.announcement_readers(p_announcement_id uuid)
returns table (
  user_id uuid,
  display_name text,
  role public.tenant_role,
  store_ids uuid[],
  member boolean,
  read_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row public.announcements;
begin
  select a.* into v_row from public.announcements a where a.id = p_announcement_id;
  if not found or not app.has_tenant_role(v_row.tenant_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'the readers are listed for owners and managers of the announcement''s stores' using errcode = '42501';
  end if;
  return query
  select
    r.user_id,
    coalesce(
      (select sr.display_name from public.staff_roster sr where sr.tenant_id = r.tenant_id and sr.user_id = r.user_id),
      (select max(zi.display_name) from public.zalo_identities zi where zi.tenant_id = r.tenant_id and zi.user_id = r.user_id)
    ),
    r.role,
    r.store_ids,
    exists (select 1 from public.tenant_members m where m.tenant_id = r.tenant_id and m.user_id = r.user_id),
    c.read_at
  from public.announcement_recipients r
  left join public.announcement_receipts c on c.announcement_id = r.announcement_id and c.created_by = r.user_id
  where r.announcement_id = v_row.id
  order by c.read_at is not null, r.role, r.user_id;
end;
$$;

comment on function public.announcement_readers(uuid) is 'the recipients of an announcement the caller may read with their read time (null while unread, listed first), the display name from the roster or the Zalo identity when the caller may read it, the role and stores at publication and whether the person is still a member; a store-limited manager gets the recipients of their own stores only; 42501 for staff, for a member outside the tenant and for an announcement the caller cannot read';

create function public.submit_request(p_store_id uuid, p_kind_key text, p_details text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_row public.approval_requests;
begin
  select s.tenant_id into v_tenant_id from public.stores s where s.id = p_store_id;
  if v_tenant_id is null or not app.ops_can_write_own(v_tenant_id, p_store_id) then
    raise exception 'the request cannot be sent at this store by this member' using errcode = '42501';
  end if;
  insert into public.approval_requests (tenant_id, store_id, kind_key, details)
  values (v_tenant_id, p_store_id, p_kind_key, coalesce(btrim(p_details, E' \n\r\t'), ''))
  returning * into v_row;
  return jsonb_build_object('request_id', v_row.id, 'status', v_row.status, 'created_at', v_row.created_at);
end;
$$;

comment on function public.submit_request(uuid, text, text) is 'sends a request to the managers of a store in the caller''s operations scope (42501 otherwise): an active request kind of the tenant (22023 otherwise) and plain-text details of 1 to 1000 characters (23514 otherwise); returns {request_id, status, created_at}; no message is sent, the managers see it in their queue';

create function public.approval_request_kinds_of(p_tenant_id uuid)
returns table (key text, label text, sort_order smallint, active boolean, tenant_row boolean)
language sql
stable
set search_path = ''
as $$
  select e.key, e.label, e.sort_order, e.active, e.tenant_row
  from (
    select distinct on (k.key) k.key, k.label, k.sort_order, k.active, k.tenant_id is not null as tenant_row
    from public.approval_request_kinds k
    where k.tenant_id = p_tenant_id or k.tenant_id is null
    order by k.key, k.tenant_id nulls last
  ) e
  order by e.sort_order, e.key;
$$;

comment on function public.approval_request_kinds_of(uuid) is 'the tenant''s effective request kinds: its own rows and the global defaults it does not override, active or not, in order; a caller outside the tenant gets the defaults only';

create function public.approval_queue(p_store_id uuid default null)
returns table (
  request_id uuid,
  tenant_id uuid,
  store_id uuid,
  kind_key text,
  kind_label text,
  details text,
  requested_by uuid,
  requester_name text,
  requested_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    r.id,
    r.tenant_id,
    r.store_id,
    r.kind_key,
    (select k.label from public.approval_request_kinds_of(r.tenant_id) k where k.key = r.kind_key),
    r.details,
    r.created_by,
    coalesce(
      (select sr.display_name from public.staff_roster sr where sr.tenant_id = r.tenant_id and sr.user_id = r.created_by),
      (select max(zi.display_name) from public.zalo_identities zi where zi.tenant_id = r.tenant_id and zi.user_id = r.created_by)
    ),
    r.created_at
  from public.approval_requests r
  where r.status = 'pending'
    and (p_store_id is null or r.store_id = p_store_id)
    and app.ops_can_manage(r.tenant_id, r.store_id)
    and r.created_by is distinct from (select auth.uid())
  order by r.created_at, r.id
  limit 500;
$$;

comment on function public.approval_queue(uuid) is 'the manager''s queue: the pending requests of the stores the caller manages (one store or all), oldest first, without the caller''s own requests, which another manager decides; with the kind label and the requester''s name when the caller may read it; the home card counts its rows; at most 500';

create function public.my_requests()
returns table (
  request_id uuid,
  tenant_id uuid,
  store_id uuid,
  kind_key text,
  kind_label text,
  details text,
  status text,
  requested_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  refusal_reason text
)
language sql
stable
set search_path = ''
as $$
  select
    r.id,
    r.tenant_id,
    r.store_id,
    r.kind_key,
    (select k.label from public.approval_request_kinds_of(r.tenant_id) k where k.key = r.kind_key),
    r.details,
    r.status,
    r.created_at,
    r.decided_by,
    r.decided_at,
    r.refusal_reason
  from public.approval_requests r
  where r.created_by = (select auth.uid())
  order by r.created_at desc, r.id
  limit 200;
$$;

comment on function public.my_requests() is 'Yêu cầu của tôi: the caller''s own requests, newest first, with the state, the decision time and the reason of a refusal; at most 200';

revoke all on function app.ops_can_write_own_stores(uuid, uuid[]) from public, anon;
revoke all on function app.ops_can_manage_stores(uuid, uuid[]) from public, anon;
revoke all on function app.store_scope_overlap(uuid[], uuid[]) from public, anon;
revoke all on function app.approval_request_kind_active(uuid, text) from public, anon, authenticated;
revoke all on function app.announcement_visible(uuid, uuid[], public.tenant_role[]) from public, anon, authenticated;
revoke all on function app.refuse_announcement_row_change() from public, anon, authenticated, service_role;
revoke all on function app.guard_announcement() from public, anon, authenticated, service_role;
revoke all on function app.prepare_approval_request() from public, anon, authenticated, service_role;
revoke all on function app.guard_approval_request() from public, anon, authenticated, service_role;
revoke all on function app.member_destinations(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function app.enqueue_member_message(uuid, uuid, text, text, jsonb, uuid[], timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) from public, anon, service_role;
revoke all on function app.set_announcement_pin(uuid, timestamptz) from public, anon, service_role;
revoke all on function app.mark_announcement_read(uuid) from public, anon, service_role;
revoke all on function app.decide_request(uuid, text, text) from public, anon, service_role;
revoke all on function public.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) from public, anon, service_role;
revoke all on function public.set_announcement_pin(uuid, timestamptz) from public, anon, service_role;
revoke all on function public.mark_announcement_read(uuid) from public, anon, service_role;
revoke all on function public.decide_request(uuid, text, text) from public, anon, service_role;
revoke all on function public.announcement_feed(uuid, boolean) from public, anon, service_role;
revoke all on function public.announcement_read_rate(uuid) from public, anon, service_role;
revoke all on function public.announcement_readers(uuid) from public, anon, service_role;
revoke all on function public.submit_request(uuid, text, text) from public, anon, service_role;
revoke all on function public.approval_request_kinds_of(uuid) from public, anon, service_role;
revoke all on function public.approval_queue(uuid) from public, anon, service_role;
revoke all on function public.my_requests() from public, anon, service_role;

grant execute on function app.ops_can_write_own_stores(uuid, uuid[]) to authenticated;
grant execute on function app.ops_can_manage_stores(uuid, uuid[]) to authenticated;
grant execute on function app.store_scope_overlap(uuid[], uuid[]) to authenticated;
grant execute on function app.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) to authenticated;
grant execute on function app.set_announcement_pin(uuid, timestamptz) to authenticated;
grant execute on function app.mark_announcement_read(uuid) to authenticated;
grant execute on function app.decide_request(uuid, text, text) to authenticated;
grant execute on function public.publish_announcement(uuid, text, text, uuid[], public.tenant_role[], timestamptz, timestamptz) to authenticated;
grant execute on function public.set_announcement_pin(uuid, timestamptz) to authenticated;
grant execute on function public.mark_announcement_read(uuid) to authenticated;
grant execute on function public.decide_request(uuid, text, text) to authenticated;
grant execute on function public.announcement_feed(uuid, boolean) to authenticated;
grant execute on function public.announcement_read_rate(uuid) to authenticated;
grant execute on function public.announcement_readers(uuid) to authenticated;
grant execute on function public.submit_request(uuid, text, text) to authenticated;
grant execute on function public.approval_request_kinds_of(uuid) to authenticated;
grant execute on function public.approval_queue(uuid) to authenticated;
grant execute on function public.my_requests() to authenticated;
