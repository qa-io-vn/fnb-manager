-- A customer's own data (C19; personal-data law 91/2025/QH15 and decree 356/2025, docs/deep-dives/vietnam-legal-
-- requirements.md section 1): a customer who never joined with a phone deletes their Zalo login themselves, at once,
-- and every customer downloads a copy of what the platform holds about their login.
--
-- Deleting (customer_delete_account): refused while an order of theirs is still open or owes them a refund (the store
-- must be able to serve and pay it back); a joined customer goes through customer_request_deletion, whose
-- data-subject request an owner carries out with dsr_delete (the phone programme's ledger and invoices need that
-- path). Otherwise, in one transaction: the stamp card with its rewards and ledger, the member codes, the requests
-- (they carry the contact typed), the order blocks and the login with its Auth user and sessions are deleted; the
-- orders, their lines, payments, refunds, events and the store's invoices stay as the money records the law keeps,
-- without the customer link and without the free-text notes the customer typed; a counter order the card was attached
-- to loses the link; the staff calls lose it too. What is kept to prove the deletion is a keyed hash of the Zalo user
-- id, the time and the counts (app.customer_login_erasures), never a name, phone or id in the clear.
--
-- Exporting (customer_export_data): one JSON of the login, the joined customer's profile, memberships and consent
-- records when there are any, the stamp card with its whole ledger, every order with its lines and money, the
-- requests with the contact typed, the staff calls and the order blocks; each export is recorded with its counts
-- only (ADR-054: no server keeps the content).

-- 1. Records ---------------------------------------------------------------------------------------------------------

create table app.customer_login_erasures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  login_hash text not null check (login_hash ~ '^[0-9a-f]{64}$'),
  erased_at timestamptz not null,
  counts jsonb not null check (jsonb_typeof(counts) = 'object')
);

create index customer_login_erasures_tenant_idx on app.customer_login_erasures (tenant_id, erased_at desc);

comment on table app.customer_login_erasures is 'the proof that a customer deleted their Zalo login (C19): an HMAC-SHA-256 of the Zalo App and user id under the tenant''s key, when, and how many rows of each kind went or lost their link; no personal data; read by no API role';

create table app.customer_data_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_login_id uuid not null references app.customer_logins (id) on delete cascade,
  exported_at timestamptz not null,
  counts jsonb not null check (jsonb_typeof(counts) = 'object')
);

create index customer_data_exports_login_idx on app.customer_data_exports (customer_login_id, exported_at desc);
create index customer_data_exports_tenant_idx on app.customer_data_exports (tenant_id);

comment on table app.customer_data_exports is 'each copy of their data a customer downloaded (C19 "Tải bản sao dữ liệu"): when and the counts, never the content (ADR-054); removed with the login';

alter table app.customer_login_erasures enable row level security;
alter table app.customer_data_exports enable row level security;
revoke all on table app.customer_login_erasures, app.customer_data_exports from public, anon, authenticated, service_role;

-- 2. Deleting --------------------------------------------------------------------------------------------------------

create function app.customer_login_hash(p_login app.customer_logins)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to('erased-login:' || p_login.zalo_app_id::text || ':' || p_login.zalo_user_id, 'UTF8'),
    app.table_qr_key(p_login.tenant_id), 'sha256'), 'hex');
$$;

comment on function app.customer_login_hash(app.customer_logins) is 'the keyed hash that proves a login was deleted: HMAC-SHA-256 of the Zalo App and user id under the tenant''s secret key, with a purpose label, so the record cannot be turned back into the Zalo id without the key';

create function app.customer_delete_account(p_confirm boolean, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_open integer;
  v_refunds integer;
  v_counts jsonb;
  v_rows integer;
begin
  if p_confirm is distinct from true then
    raise exception 'deleting the account needs the customer''s confirmation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-customer-login:' || v_login.id::text, 0));
  if v_login.customer_id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'member_request', 'deleted', false);
  end if;
  select count(*) filter (where o.status = any (app.order_open_statuses())),
         count(*) filter (where o.payment_status = 'refund_pending' or exists (
           select 1 from public.order_refunds r where r.order_id = o.id and r.status in ('due', 'pending', 'failed')))
  into v_open, v_refunds
  from public.orders o where o.customer_login_id = v_login.id;
  if v_open > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'open_orders', 'deleted', false, 'orders', v_open);
  end if;
  if v_refunds > 0 then
    return jsonb_build_object('state', 'refused', 'refusal', 'refund_pending', 'deleted', false, 'orders', v_refunds);
  end if;

  update public.order_lines l set note = null
  where l.note is not null and l.order_id in (select o.id from public.orders o where o.customer_login_id = v_login.id);
  get diagnostics v_rows = row_count;
  v_counts := jsonb_build_object('line_notes_cleared', v_rows);
  update public.orders o set note = null where o.customer_login_id = v_login.id and o.note is not null;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('order_notes_cleared', v_rows);
  v_counts := v_counts || jsonb_build_object(
    'orders_unlinked', (select count(*) from public.orders o where o.customer_login_id = v_login.id),
    'attached_orders_unlinked', (select count(*) from public.orders o where o.member_login_id = v_login.id),
    'staff_calls_unlinked', (select count(*) from public.table_calls c where c.customer_login_id = v_login.id),
    'stamp_cards', (select count(*) from public.stamp_cards c where c.customer_login_id = v_login.id),
    'stamp_entries', (select count(*) from public.stamp_entries e join public.stamp_cards c on c.id = e.card_id where c.customer_login_id = v_login.id),
    'stamp_rewards', (select count(*) from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id where c.customer_login_id = v_login.id),
    'member_codes', (select count(*) from app.stamp_member_codes m where m.customer_login_id = v_login.id),
    'requests', (select count(*) from public.store_requests r where r.customer_login_id = v_login.id),
    'order_blocks', (select count(*) from public.customer_order_blocks b where b.customer_login_id = v_login.id)
  );

  insert into app.customer_login_erasures (tenant_id, login_hash, erased_at, counts)
  values (v_login.tenant_id, app.customer_login_hash(v_login), p_at, v_counts);

  delete from app.customer_logins l where l.id = v_login.id;
  delete from auth.users u
  where u.id = v_login.user_id
    and not exists (select 1 from public.tenant_members m where m.user_id = u.id)
    and not exists (select 1 from public.zalo_identities z where z.user_id = u.id)
    and not exists (select 1 from app.customer_logins l where l.user_id = u.id);
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_rows);

  return jsonb_build_object('state', 'deleted', 'refusal', null, 'deleted', true, 'deleted_at', p_at, 'counts', v_counts);
end;
$$;

comment on function app.customer_delete_account(boolean, timestamptz) is 'C19 "Xóa tài khoản" for a customer who never joined with a phone, with p_confirm true (22023 otherwise): refused while an order of theirs is open (open_orders) or owes a refund (refund_pending), and for a joined customer (member_request: customer_request_deletion is their path); otherwise deletes the stamp card with its rewards and ledger, the member codes, the requests, the order blocks, the login and its Auth user with every session, clears the notes the customer typed on their orders, unlinks their orders, the counter orders attached to their card and their staff calls (the money records stay), records the deletion as a keyed hash with the counts in app.customer_login_erasures, and answers the counts; 42501 without a customer session (so a second call after the deletion is refused)';

-- 3. Exporting -------------------------------------------------------------------------------------------------------

create function app.customer_export_data(p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_brand uuid;
  v_out jsonb;
  v_counts jsonb;
begin
  select a.brand_id into v_brand from public.zalo_apps a where a.id = v_login.zalo_app_id;
  v_out := jsonb_build_object(
    'generated_at', p_at,
    'login', jsonb_build_object(
      'zalo_user_id', v_login.zalo_user_id,
      'brand', (select b.display_name from public.brands b where b.id = v_brand),
      'created_at', v_login.created_at,
      'joined', v_login.customer_id is not null
    ),
    'customer', (
      select jsonb_build_object('name', c.name, 'phone', c.phone, 'first_seen_at', c.first_seen_at, 'last_seen_at', c.last_seen_at)
      from public.customers c where c.id = v_login.customer_id and c.tenant_id = v_login.tenant_id
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('programme', p.name, 'status', m.status, 'joined_at', m.joined_at, 'channel', m.channel) order by m.joined_at, m.id)
      from public.memberships m join public.loyalty_programmes p on p.id = m.programme_id
      where m.customer_id = v_login.customer_id and m.tenant_id = v_login.tenant_id
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', r.purpose, 'policy_version', r.policy_version, 'channel', r.channel, 'granted_at', r.granted_at,
        'revoked_at', r.revoked_at) order by r.granted_at, r.id)
      from public.consent_records r
      where r.tenant_id = v_login.tenant_id and r.subject_type = 'customer' and r.subject_id = v_login.customer_id
    ), '[]'::jsonb),
    'stamp_card', (
      select jsonb_build_object(
        'stamps', c.stamps, 'total_earned', c.total_earned, 'created_at', c.created_at,
        'rewards', coalesce((select jsonb_agg(jsonb_build_object('status', r.status, 'stamps', r.stamps, 'issued_at', r.issued_at, 'used_at', r.used_at, 'voided_at', r.voided_at)
          order by r.issued_at, r.id) from public.stamp_rewards r where r.card_id = c.id), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'delta', e.delta, 'balance_after', e.balance_after, 'at', e.occurred_at,
          'order_no', app.order_display_no(o.order_no)) order by e.id)
          from public.stamp_entries e left join public.orders o on o.id = e.order_id where e.card_id = c.id), '[]'::jsonb)
      )
      from public.stamp_cards c where c.customer_login_id = v_login.id and c.brand_id = v_brand
    ),
    'orders', coalesce((
      select jsonb_agg(app.order_json(o, 'customer', p_at) || jsonb_build_object(
        'store_name', (select s.name from public.stores s where s.id = o.store_id),
        'money', app.order_money_json(o.id, 'customer')) order by o.placed_at, o.id)
      from public.orders o where o.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'attached_orders', coalesce((
      select jsonb_agg(jsonb_build_object('order_no', app.order_display_no(o.order_no), 'business_date', o.business_date,
        'store_name', (select s.name from public.stores s where s.id = o.store_id), 'status', o.status, 'total', o.total::bigint,
        'attached_at', o.member_attached_at) order by o.member_attached_at, o.id)
      from public.orders o where o.member_login_id = v_login.id
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(app.request_json(r, 'customer', p_at) || jsonb_build_object('contact_phone', r.contact_phone) order by r.created_at, r.id)
      from public.store_requests r where r.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'staff_calls', coalesce((
      select jsonb_agg(jsonb_build_object('store_name', s.name, 'table', t.label, 'created_at', c.created_at, 'acknowledged_at', c.acknowledged_at)
        order by c.created_at, c.id)
      from public.table_calls c join public.stores s on s.id = c.store_id left join public.store_tables t on t.id = c.table_id
      where c.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'order_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('reason', b.reason, 'created_at', b.created_at, 'blocked_until', b.blocked_until) order by b.created_at, b.id)
      from public.customer_order_blocks b where b.customer_login_id = v_login.id
    ), '[]'::jsonb),
    'deletion_request', case when v_login.customer_id is not null then app.customer_deletion_request(v_login.tenant_id, v_login.customer_id, p_at) end,
    'not_kept', jsonb_build_array('location', 'contacts', 'zalo_messages', 'card_numbers')
  );
  v_counts := jsonb_build_object(
    'orders', jsonb_array_length(v_out -> 'orders'),
    'attached_orders', jsonb_array_length(v_out -> 'attached_orders'),
    'requests', jsonb_array_length(v_out -> 'requests'),
    'staff_calls', jsonb_array_length(v_out -> 'staff_calls'),
    'stamp_entries', coalesce(jsonb_array_length(v_out -> 'stamp_card' -> 'entries'), 0),
    'memberships', jsonb_array_length(v_out -> 'memberships'),
    'consents', jsonb_array_length(v_out -> 'consents')
  );
  insert into app.customer_data_exports (tenant_id, customer_login_id, exported_at, counts) values (v_login.tenant_id, v_login.id, p_at, v_counts);
  return v_out || jsonb_build_object('counts', v_counts);
end;
$$;

comment on function app.customer_export_data(timestamptz) is 'C19 "Tải bản sao dữ liệu": everything the platform holds about the caller''s customer login as one JSON (the login and its Zalo user id, the joined customer''s name, phone and dates, memberships and consent records, the stamp card with every reward and ledger entry, every order with its lines and money as the customer sees them, the counter orders attached to the card, the requests with the contact typed, the staff calls, the order blocks, an open deletion request, and what is never kept), nothing of anyone else; each export recorded with its counts only; 42501 without a customer session';

-- 4. Public wrappers and grants -------------------------------------------------------------------------------------

create function public.customer_delete_account(p_confirm boolean)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_delete_account(p_confirm, now()); $$;
comment on function public.customer_delete_account(boolean) is 'RPC for the customer Mini App (C19): app.customer_delete_account at the current time';

create function public.customer_export_data()
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.customer_export_data(now()); $$;
comment on function public.customer_export_data() is 'RPC for the customer Mini App (C19): app.customer_export_data at the current time';

revoke all on function app.customer_login_hash(app.customer_logins), app.customer_delete_account(boolean, timestamptz), app.customer_export_data(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.customer_delete_account(boolean), public.customer_export_data() from public, anon, authenticated, service_role;
grant execute on function public.customer_delete_account(boolean), public.customer_export_data() to authenticated;
