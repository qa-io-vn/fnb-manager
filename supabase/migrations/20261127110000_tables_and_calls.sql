-- The native till, step 2 (ADR-060 and ADR-058 section 4, native-till.md section 4): a store's tables with signed QR
-- codes (a 128-bit HMAC token per table and version, keyed per tenant, stored only as its SHA-256), the customer's
-- table lookup and "Gọi nhân viên" calls with the counter's acknowledgement ("Tới ngay"), and the guessing limits.

-- 1. Keys and tokens -----------------------------------------------------------------------------------------------

create table app.table_qr_keys (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  key bytea not null check (octet_length(key) = 32),
  created_at timestamptz not null default now()
);

comment on table app.table_qr_keys is 'one random 32-byte key per tenant that signs its table QR tokens (the ADR-052 pattern): created at the tenant''s first table, restored with the database, readable by no API role';

alter table app.table_qr_keys enable row level security;
revoke all on table app.table_qr_keys from public, anon, authenticated, service_role;

create function app.table_qr_key(p_tenant_id uuid)
returns bytea
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key bytea;
begin
  insert into app.table_qr_keys (tenant_id, key) values (p_tenant_id, extensions.gen_random_bytes(32))
  on conflict (tenant_id) do nothing;
  select k.key into strict v_key from app.table_qr_keys k where k.tenant_id = p_tenant_id;
  return v_key;
end;
$$;

comment on function app.table_qr_key(uuid) is 'the tenant''s table QR key, created on first use (the first insert wins a race)';

create function app.table_qr_token(p_tenant_id uuid, p_table_id uuid, p_version integer)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select rtrim(translate(encode(substring(
    extensions.hmac(convert_to('table:' || p_table_id::text || ':' || p_version::text, 'UTF8'), app.table_qr_key(p_tenant_id), 'sha256')
    from 1 for 16), 'base64'), '+/', '-_'), '=');
$$;

comment on function app.table_qr_token(uuid, uuid, integer) is 'the QR token of a table and version: base64url of the first 16 bytes of HMAC-SHA-256(tenant key, ''table:'' || id || '':'' || version), 22 characters';

create function app.table_qr_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

comment on function app.table_qr_hash(text) is 'the SHA-256 of a table token as stored in store_tables.qr_token_sha256';

-- 2. Tables --------------------------------------------------------------------------------------------------------

create table public.store_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  label text not null check (app.native_text_valid(label, 20)),
  area text check (area is null or app.native_text_valid(area, 40)),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  active boolean not null default true,
  qr_version integer not null default 1 check (qr_version between 1 and 1000000),
  qr_token_sha256 text not null check (qr_token_sha256 ~ '^[0-9a-f]{64}$'),
  qr_issued_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (qr_token_sha256),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create unique index store_tables_label_key on public.store_tables (store_id, lower(label)) where active;
create index store_tables_tenant_idx on public.store_tables (tenant_id);

comment on table public.store_tables is 'the tables of a store with the names the owner chose (label, unique among the active tables case-insensitively) and their area; the QR columns are written only by the trigger: qr_version moves on rotation and on reactivation, and only the SHA-256 of the current token is kept';
comment on column public.store_tables.qr_token_sha256 is 'SHA-256 of the table''s current QR token; selectable by no API role';

create function app.store_tables_qr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.store_id is distinct from old.store_id or new.id is distinct from old.id then
      raise exception 'a table keeps its store' using errcode = '22023';
    end if;
    if new.active and not old.active then
      new.qr_version := greatest(new.qr_version, old.qr_version + 1);
    end if;
    if new.qr_version < old.qr_version then
      raise exception 'a table''s QR version never goes back' using errcode = '22023';
    end if;
    if new.qr_version = old.qr_version then
      new.qr_token_sha256 := old.qr_token_sha256;
      new.qr_issued_at := old.qr_issued_at;
      return new;
    end if;
  else
    new.qr_version := 1;
  end if;
  new.qr_token_sha256 := app.table_qr_hash(app.table_qr_token(new.tenant_id, new.id, new.qr_version));
  new.qr_issued_at := now();
  return new;
end;
$$;

comment on function app.store_tables_qr() is 'trigger before a table is written: issues the token hash of version 1 on insert and of each new version (a rotation, or a deactivated table made active again, which never revives a printed card); refuses a move to another store and a version going back';

create trigger store_tables_qr before insert or update on public.store_tables for each row execute function app.store_tables_qr();
create trigger store_tables_set_updated_at before update on public.store_tables for each row execute function app.set_updated_at();
create trigger store_tables_keep_created_by before update on public.store_tables for each row execute function app.keep_created_by();
create trigger store_tables_set_updated_by before insert or update on public.store_tables for each row execute function app.set_updated_by();

alter table public.store_tables enable row level security;

create policy store_tables_select on public.store_tables
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
create policy store_tables_insert on public.store_tables
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy store_tables_update on public.store_tables
  for update to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));
create policy store_tables_delete on public.store_tables
  for delete to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.store_tables from anon, authenticated;
grant select (id, tenant_id, store_id, label, area, sort_order, active, qr_version, qr_issued_at, created_by, created_at, updated_by, updated_at)
  on public.store_tables to authenticated;
grant insert (tenant_id, store_id, label, area, sort_order, active), update (label, area, sort_order, active), delete
  on public.store_tables to authenticated;

-- 3. Staff calls -------------------------------------------------------------------------------------------------

create table public.table_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  table_id uuid not null,
  customer_login_id uuid references app.customer_logins (id) on delete set null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, table_id) references public.store_tables (tenant_id, id) on delete cascade,
  check (acknowledged_by is null or acknowledged_at is not null),
  check (acknowledged_at is null or acknowledged_at >= created_at)
);

create unique index table_calls_open_key on public.table_calls (table_id) where acknowledged_at is null;
create index table_calls_store_idx on public.table_calls (store_id, created_at desc);
create index table_calls_tenant_idx on public.table_calls (tenant_id);

comment on table public.table_calls is '"Gọi nhân viên" calls of a table: at most one open call per table, closed by the counter''s "Tới ngay" with who and when; written only by customer_call_staff and counter_ack_call';

alter table public.table_calls enable row level security;
create policy table_calls_select on public.table_calls
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager', 'viewer']::public.tenant_role[]));
revoke all on public.table_calls from anon, authenticated;
grant select on public.table_calls to authenticated;

-- 4. Guessing and call limits -----------------------------------------------------------------------------------

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values
  ('customer_table', 'misses', 10, 50, interval '15 minutes', interval '15 minutes'),
  ('customer_call_staff', 'calls', 6, 120, interval '15 minutes', interval '15 minutes');

-- 5. Functions -------------------------------------------------------------------------------------------------

create function app.table_from_token(p_tenant_id uuid, p_store_id uuid, p_token text, p_caller uuid, p_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_locked timestamptz;
  v_table public.store_tables;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'a table token is 1 to 64 of A-Z, a-z, 0-9, _ and -' using errcode = '22023';
  end if;
  v_locked := app.code_attempt_gate('customer_table', p_tenant_id, p_store_id, p_caller, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked);
  end if;
  select t.* into v_table
  from public.store_tables t
  where t.qr_token_sha256 = app.table_qr_hash(p_token)
    and t.store_id = p_store_id
    and t.tenant_id = p_tenant_id
    and t.active;
  if v_table.id is null then
    perform app.code_attempt_record('customer_table', p_tenant_id, p_store_id, p_caller, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', 'table_unknown');
  end if;
  return jsonb_build_object('state', 'ok', 'table_id', v_table.id, 'label', v_table.label, 'area', v_table.area);
end;
$$;

comment on function app.table_from_token(uuid, uuid, text, uuid, timestamptz) is 'resolves a table token at a store for a caller: the active table whose current token hashes to it, or the refusal table_unknown for any miss (unknown, rotated, inactive or another store''s token), which counts against the caller and the store (customer_table: 10 and 50 in 15 minutes, then a 15-minute lock answered rate_limited with retry_at and the code_guessing_lockout alert); 22023 for a malformed token';

create function app.customer_table(p_store_code text, p_table_token text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_tenant uuid;
  v_found jsonb;
begin
  select c.* into v_ctx from app.customer_menu_store(p_store_code) c;
  select s.tenant_id into v_tenant from public.stores s where s.id = v_ctx.store_id;
  v_found := app.table_from_token(v_tenant, v_ctx.store_id, p_table_token, (v_ctx.login).user_id, p_at);
  if v_found ->> 'state' <> 'ok' then
    return v_found;
  end if;
  return jsonb_build_object('state', 'ok', 'table', jsonb_build_object('label', v_found ->> 'label', 'area', v_found ->> 'area'));
end;
$$;

comment on function app.customer_table(text, text, timestamptz) is 'the table a scanned QR names at a store of the session''s brand (native-till.md section 4): {state: ok, table: {label, area}}, or refused with table_unknown (every miss alike) or rate_limited; 22023 for a malformed token or a store not of the brand';

create function app.customer_call_staff(p_store_code text, p_table_token text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_tenant uuid;
  v_found jsonb;
  v_locked timestamptz;
  v_call public.table_calls;
  v_new boolean := false;
begin
  select c.* into v_ctx from app.customer_menu_store(p_store_code) c;
  select s.tenant_id into v_tenant from public.stores s where s.id = v_ctx.store_id;
  v_found := app.table_from_token(v_tenant, v_ctx.store_id, p_table_token, (v_ctx.login).user_id, p_at);
  if v_found ->> 'state' <> 'ok' then
    return v_found;
  end if;
  select c.* into v_call from public.table_calls c where c.table_id = (v_found ->> 'table_id')::uuid and c.acknowledged_at is null;
  if v_call.id is null then
    v_locked := app.code_attempt_gate('customer_call_staff', v_tenant, v_ctx.store_id, (v_ctx.login).user_id, p_at);
    if v_locked is not null then
      return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked);
    end if;
    perform app.code_attempt_record('customer_call_staff', v_tenant, v_ctx.store_id, (v_ctx.login).user_id, p_at);
    insert into public.table_calls (tenant_id, store_id, table_id, customer_login_id, created_at)
    values (v_tenant, v_ctx.store_id, (v_found ->> 'table_id')::uuid, (v_ctx.login).id, p_at)
    on conflict (table_id) where acknowledged_at is null do nothing
    returning * into v_call;
    v_new := v_call.id is not null;
    if v_call.id is null then
      select c.* into v_call from public.table_calls c where c.table_id = (v_found ->> 'table_id')::uuid and c.acknowledged_at is null;
    end if;
  end if;
  return jsonb_build_object('state', 'calling', 'called_at', v_call.created_at, 'replayed', not v_new);
end;
$$;

comment on function app.customer_call_staff(text, text, timestamptz) is '"Gọi nhân viên" from a table: opens the table''s call, or answers the call already open (replayed true; one open call per table); a new call counts against the customer and the store (6 and 120 in 15 minutes, then rate_limited); the table is resolved from its token as customer_table does';

create function app.table_link(p_store_id uuid, p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'https://zalo.me/s/' || m.external_id || '/?store=' || app.customer_store_code(s.code, s.external_id) || '&src=table&t=' || p_token
  from public.stores s
  join lateral (
    select ma.external_id
    from public.brands b
    join public.mini_apps ma on ma.brand_id = b.id and ma.kind = 'customer'
    where b.tenant_id = s.tenant_id and s.id = any (b.store_ids)
    order by char_length(b.brand_key), b.brand_key
    limit 1
  ) m on true
  where s.id = p_store_id
    and app.customer_store_code(s.code, s.external_id) is not null
    and p_token is not null;
$$;

comment on function app.table_link(uuid, text) is 'the link a table QR carries: the customer Mini App of the brand covering the store (the lowest brand key), the store link key, src=table and the token; null without a customer Mini App or a store link key';

create function app.table_qr_links(p_store_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager']::public.tenant_role[]);
  v_app text;
begin
  select ma.external_id into v_app
  from public.brands b join public.mini_apps ma on ma.brand_id = b.id and ma.kind = 'customer'
  where b.tenant_id = v_store.tenant_id and v_store.id = any (b.store_ids)
  order by char_length(b.brand_key), b.brand_key limit 1;
  return jsonb_build_object(
    'store_code', app.customer_store_code(v_store.code, v_store.external_id),
    'mini_app_id', v_app,
    'missing', case when v_app is null then 'customer_mini_app' when app.customer_store_code(v_store.code, v_store.external_id) is null then 'store_code' end,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'area', t.area, 'sort_order', t.sort_order, 'active', t.active, 'qr_version', t.qr_version,
        'token', case when t.active then x.token end,
        'link', case when t.active then app.table_link(v_store.id, x.token) end
      ) order by t.sort_order, t.label, t.id)
      from public.store_tables t
      cross join lateral (select app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token) x
      where t.store_id = v_store.id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.table_qr_links(uuid) is 'the printable QR links of a store''s tables, recomputed from the tenant key (only hashes are stored): {store_code, mini_app_id, missing, tables: [{id, label, area, sort_order, active, qr_version, token, link}]}, token and link null for an inactive table; owners and managers of the store only';

create function app.rotate_table_qr(p_table_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table public.store_tables;
  v_token text;
begin
  select t.* into v_table from public.store_tables t where t.id = p_table_id;
  if v_table.id is null or not app.has_store_scope(v_table.tenant_id, v_table.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'only an owner or manager of the table''s store rotates its QR code' using errcode = '42501';
  end if;
  if not v_table.active then
    raise exception 'an inactive table has no QR code to rotate' using errcode = '22023';
  end if;
  update public.store_tables t set qr_version = t.qr_version + 1 where t.id = v_table.id returning t.* into v_table;
  v_token := app.table_qr_token(v_table.tenant_id, v_table.id, v_table.qr_version);
  return jsonb_build_object('id', v_table.id, 'qr_version', v_table.qr_version, 'token', v_token, 'link', app.table_link(v_table.store_id, v_token));
end;
$$;

comment on function app.rotate_table_qr(uuid) is 'kills a table''s printed QR code at once by moving its version, and answers the new token and link to print; owners and managers of the store (42501 otherwise, the same for an unknown table), 22023 for an inactive table';

create function app.counter_table_map(p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores := app.counter_store(p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
begin
  return jsonb_build_object(
    'store_id', v_store.id,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'area', t.area, 'sort_order', t.sort_order,
        'call', (select jsonb_build_object('id', c.id, 'called_at', c.created_at, 'waiting_seconds', greatest(floor(extract(epoch from p_at - c.created_at)), 0)::integer)
                 from public.table_calls c where c.table_id = t.id and c.acknowledged_at is null),
        'open_orders', app.table_open_orders(t.id)
      ) order by t.area nulls first, t.sort_order, t.label, t.id)
      from public.store_tables t
      where t.store_id = v_store.id and t.active
    ), '[]'::jsonb)
  );
end;
$$;

create function app.table_open_orders(p_table_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select 0;
$$;

comment on function app.table_open_orders(uuid) is 'the open orders of a table, for the table map; 0 until the orders arrive (step 3 replaces it)';
comment on function app.counter_table_map(uuid, timestamptz) is 'the counter''s table map: every active table of the store with its area, its open call (when and how long it waits) and its open orders; owners, managers and staff of the store only';

create function app.counter_ack_call(p_call_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_call public.table_calls;
  v_replayed boolean := false;
begin
  select c.* into v_call from public.table_calls c where c.id = p_call_id for update;
  if v_call.id is null or (select auth.uid()) is null
     or not app.has_store_scope(v_call.tenant_id, v_call.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only staff of the call''s store answer it' using errcode = '42501';
  end if;
  if v_call.acknowledged_at is null then
    update public.table_calls c set acknowledged_at = greatest(p_at, c.created_at), acknowledged_by = (select auth.uid())
    where c.id = v_call.id returning c.* into v_call;
  else
    v_replayed := true;
  end if;
  return jsonb_build_object('state', 'acknowledged', 'acknowledged_at', v_call.acknowledged_at, 'acknowledged_by', v_call.acknowledged_by, 'replayed', v_replayed);
end;
$$;

comment on function app.counter_ack_call(uuid, timestamptz) is '"Tới ngay": closes a table call with who and when; a call already answered is a replay; owners, managers and staff of the store only (42501 otherwise, the same for an unknown call)';

create function public.customer_table(p_store_code text, p_table_token text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_table(p_store_code, p_table_token, now()); $$;
comment on function public.customer_table(text, text) is 'RPC for the customer Mini App: app.customer_table at the current time';

create function public.customer_call_staff(p_store_code text, p_table_token text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_call_staff(p_store_code, p_table_token, now()); $$;
comment on function public.customer_call_staff(text, text) is 'RPC for the customer Mini App: app.customer_call_staff at the current time';

create function public.table_qr_links(p_store uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.table_qr_links(p_store); $$;
comment on function public.table_qr_links(uuid) is 'RPC for the managers'' table page: app.table_qr_links';

create function public.rotate_table_qr(p_table uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.rotate_table_qr(p_table); $$;
comment on function public.rotate_table_qr(uuid) is 'RPC for the managers'' table page: app.rotate_table_qr';

create function public.counter_table_map(p_store uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.counter_table_map(p_store, now()); $$;
comment on function public.counter_table_map(uuid) is 'RPC for the counter web app: app.counter_table_map at the current time';

create function public.counter_ack_call(p_call uuid)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.counter_ack_call(p_call, now()); $$;
comment on function public.counter_ack_call(uuid) is 'RPC for the counter web app: app.counter_ack_call at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('table_qr_key', 'table_qr_token', 'table_qr_hash', 'store_tables_qr', 'table_from_token', 'customer_table',
        'customer_call_staff', 'table_link', 'table_qr_links', 'rotate_table_qr', 'counter_table_map', 'table_open_orders', 'counter_ack_call')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.customer_table(text, text), public.customer_call_staff(text, text), public.table_qr_links(uuid),
  public.rotate_table_qr(uuid), public.counter_table_map(uuid), public.counter_ack_call(uuid)
  from public, anon, service_role;
grant execute on function public.customer_table(text, text), public.customer_call_staff(text, text), public.table_qr_links(uuid),
  public.rotate_table_qr(uuid), public.counter_table_map(uuid), public.counter_ack_call(uuid)
  to authenticated;
