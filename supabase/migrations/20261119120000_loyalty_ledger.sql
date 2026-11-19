create type public.membership_status as enum ('active', 'suspended', 'closed');
create type public.loyalty_entry_kind as enum ('earn', 'confirm', 'clawback', 'redeem', 'adjust', 'expire');
create type public.stamp_state as enum ('active', 'redeemed', 'expired', 'clawed_back');
create type public.checkin_status as enum ('issued', 'recorded', 'matched', 'queued', 'expired', 'rejected');
create type public.receipt_claim_status as enum ('pending', 'matched', 'queued', 'rejected', 'expired');
create type public.redemption_state as enum ('held', 'confirmed', 'released', 'cancelled');

alter table public.customers add constraint customers_tenant_id_id_key unique (tenant_id, id);

create index invoices_store_date_receipt_idx on public.invoices (store_id, business_date, receipt_no) where receipt_no is not null;
create index invoices_store_voucher_code_idx on public.invoices (store_id, voucher_code) where voucher_code is not null;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  programme_id uuid not null,
  customer_id uuid not null,
  joined_at timestamptz not null default now(),
  channel text not null check (channel in ('mini_app', 'oa_form', 'till', 'staff', 'import')),
  status public.membership_status not null default 'active',
  joined_store_id uuid,
  brand_id uuid,
  zalo_user_id text check (zalo_user_id is null or (char_length(zalo_user_id) between 1 and 64 and zalo_user_id !~ '[[:space:][:cntrl:]]')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (programme_id, customer_id),
  foreign key (tenant_id, programme_id) references public.loyalty_programmes (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, joined_store_id) references public.stores (tenant_id, id) on delete set null (joined_store_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete set null (brand_id),
  check (brand_id is not null or zalo_user_id is null)
);

comment on table public.memberships is 'a customer''s membership of a loyalty programme; the customer row holds the phone, this row only the per-brand Zalo user id of the brand the customer joined through (NFR-PRV-07); balances come from loyalty_ledger through app.loyalty_balance, never from a column here';

create index memberships_customer_idx on public.memberships (tenant_id, customer_id);

create trigger memberships_set_updated_at before update on public.memberships for each row execute function app.set_updated_at();

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  programme_id uuid not null,
  membership_id uuid not null,
  store_id uuid,
  entry_kind public.loyalty_entry_kind not null,
  stamp_delta integer not null default 0,
  point_delta integer not null default 0,
  value_amount numeric(14, 2) not null default 0,
  invoice_id uuid,
  business_date date,
  matched_path text check (matched_path in ('A', 'B', 'C', 'D')),
  pending boolean not null default false,
  source_entry_id uuid references public.loyalty_ledger (id),
  reason text check (reason is null or (char_length(reason) between 1 and 200 and reason !~ '[[:cntrl:]]')),
  approved_by uuid,
  expires_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, programme_id) references public.loyalty_programmes (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  constraint loyalty_ledger_invoice_check check (entry_kind not in ('earn', 'confirm', 'clawback') or invoice_id is not null),
  constraint loyalty_ledger_path_check check ((entry_kind = 'earn') = (matched_path is not null)),
  constraint loyalty_ledger_source_check check (entry_kind not in ('confirm', 'clawback') or source_entry_id is not null),
  constraint loyalty_ledger_reason_required_check check (entry_kind not in ('adjust', 'clawback') or reason is not null),
  constraint loyalty_ledger_pending_check check (not pending or entry_kind in ('earn', 'redeem')),
  constraint loyalty_ledger_sign_check check (
    case entry_kind
      when 'earn' then stamp_delta >= 0 and point_delta >= 0
      when 'confirm' then stamp_delta = 0 and point_delta = 0
      when 'clawback' then stamp_delta <= 0 and point_delta <= 0
      when 'redeem' then stamp_delta <= 0 and point_delta <= 0
      when 'expire' then stamp_delta <= 0 and point_delta <= 0
      else true
    end
  )
);

comment on table public.loyalty_ledger is 'the append-only loyalty ledger: every stamp and point movement of a membership as a row (earn, confirm, clawback, redeem, adjust, expire) with its value at issue; inserts only, a correction is a new row that references the original through source_entry_id; only app.erase_loyalty_membership (the data-subject deletion) removes rows';
comment on column public.loyalty_ledger.value_amount is 'value at issue in the tenant currency: the point delta times the programme''s point_value_amount when the row was written';
comment on column public.loyalty_ledger.matched_path is 'how the invoice of an earn was tied to the membership: A the phone or member on the invoice, B a check-in code, C a receipt claim, D a voucher recipient';
comment on column public.loyalty_ledger.pending is 'an earn or a redemption hold that waits for its confirm row; a pending earn is shown but not spendable, a pending redemption already holds its stamps or points';
comment on column public.loyalty_ledger.expires_at is 'on a crediting row, when its stamps or points expire, fixed at issue from the programme''s validity';

create unique index loyalty_ledger_one_earn_per_invoice_key on public.loyalty_ledger (invoice_id) where entry_kind = 'earn';
create unique index loyalty_ledger_one_clawback_per_entry_key on public.loyalty_ledger (source_entry_id) where entry_kind = 'clawback';
create unique index loyalty_ledger_one_confirm_per_entry_key on public.loyalty_ledger (source_entry_id) where entry_kind = 'confirm';
create index loyalty_ledger_membership_idx on public.loyalty_ledger (membership_id, occurred_at);
create index loyalty_ledger_tenant_idx on public.loyalty_ledger (tenant_id, occurred_at);
create index loyalty_ledger_store_date_idx on public.loyalty_ledger (store_id, business_date) where store_id is not null;
create index loyalty_ledger_source_idx on public.loyalty_ledger (source_entry_id) where source_entry_id is not null;

create function app.keep_loyalty_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'postgres' and current_setting('app.loyalty_erasure', true) = 'on' then
      return old;
    end if;
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;
    end if;
  end if;
  raise exception 'loyalty_ledger is an append-only ledger: a correction is a new row that references the original';
end;
$$;

create function app.refuse_loyalty_ledger_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'loyalty_ledger is an append-only ledger and is never truncated';
end;
$$;

create trigger loyalty_ledger_append_only
before update or delete on public.loyalty_ledger
for each row execute function app.keep_loyalty_ledger();
create trigger loyalty_ledger_no_truncate
before truncate on public.loyalty_ledger
for each statement execute function app.refuse_loyalty_ledger_truncate();

create table public.stamps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  membership_id uuid not null,
  earn_entry_id uuid not null,
  earned_at timestamptz not null,
  expires_at timestamptz not null,
  state public.stamp_state not null default 'active',
  closed_entry_id uuid,
  closed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, earn_entry_id) references public.loyalty_ledger (tenant_id, id),
  foreign key (tenant_id, closed_entry_id) references public.loyalty_ledger (tenant_id, id),
  check ((state = 'active') = (closed_at is null)),
  check (expires_at > earned_at)
);

comment on table public.stamps is 'one row per stamp credited by a ledger row, with its expiry; redemptions use the oldest active stamps first, the nightly expiry and clawbacks close them; a working table beside the ledger, which alone gives the balance';

create index stamps_active_idx on public.stamps (membership_id, expires_at) where state = 'active';
create index stamps_earn_entry_idx on public.stamps (earn_entry_id);

create table public.pending_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  code text not null check (code ~ '^[0-9]{6}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  recorded_at timestamptz,
  recorded_by uuid,
  amount numeric(14, 2) check (amount is null or amount > 0),
  status public.checkin_status not null default 'issued',
  matched_invoice_id uuid,
  matched_entry_id uuid,
  reason text check (reason is null or char_length(reason) between 1 and 200),
  closed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, matched_invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, matched_entry_id) references public.loyalty_ledger (tenant_id, id),
  check (expires_at > created_at),
  check (status in ('issued', 'expired', 'rejected') or recorded_at is not null),
  check (status <> 'matched' or matched_invoice_id is not null)
);

comment on table public.pending_checkins is 'path B: a dynamic check-in code a member shows, valid until expires_at, recorded by staff at a store (recorded_at, optionally the bill amount) and matched by the reconciliation to an invoice of that store within the programme''s window';

create unique index pending_checkins_live_code_key on public.pending_checkins (store_id, code) where status = 'issued';
create index pending_checkins_recorded_idx on public.pending_checkins (store_id, recorded_at) where status = 'recorded';
create unique index pending_checkins_matched_invoice_key on public.pending_checkins (matched_invoice_id) where matched_invoice_id is not null;
create index pending_checkins_membership_idx on public.pending_checkins (membership_id, created_at);

create table public.receipt_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  membership_id uuid not null,
  business_date date not null,
  receipt_no text not null check (char_length(receipt_no) between 1 and 40 and receipt_no !~ '[[:space:][:cntrl:]]'),
  amount numeric(14, 2) not null check (amount > 0),
  status public.receipt_claim_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  invoice_id uuid,
  entry_id uuid,
  reason text check (reason is null or char_length(reason) between 1 and 200),
  closed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, entry_id) references public.loyalty_ledger (tenant_id, id),
  check (expires_at > created_at),
  check (status <> 'matched' or invoice_id is not null)
);

comment on table public.receipt_claims is 'path C: a member''s claim of a receipt by store, business date, receipt number and exact amount, pending until the reconciliation matches it to a synced invoice or its window ends; one matched claim per invoice for ever, one open claim per receipt';

create unique index receipt_claims_one_per_invoice_key on public.receipt_claims (invoice_id) where invoice_id is not null;
create unique index receipt_claims_one_open_per_receipt_key on public.receipt_claims (store_id, business_date, receipt_no) where status in ('pending', 'matched', 'queued');
create index receipt_claims_pending_idx on public.receipt_claims (store_id, business_date, receipt_no) where status = 'pending';
create index receipt_claims_membership_idx on public.receipt_claims (membership_id, created_at);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  programme_id uuid not null,
  reward_key text not null check (reward_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  cost_stamps smallint not null default 0 check (cost_stamps between 0 and 100),
  cost_points integer not null default 0 check (cost_points between 0 and 1000000),
  min_bill_amount numeric(14, 2) not null default 0 check (min_bill_amount >= 0),
  valid_days smallint not null default 30 check (valid_days between 1 and 365),
  hold_hours smallint not null default 24 check (hold_hours between 1 and 168),
  store_ids uuid[] check (store_ids is null or (cardinality(store_ids) between 1 and 50 and array_position(store_ids, null) is null)),
  active boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (programme_id, reward_key),
  foreign key (tenant_id, programme_id) references public.loyalty_programmes (tenant_id, id) on delete cascade,
  check (cost_stamps > 0 or cost_points > 0)
);

comment on table public.coupons is 'the reward catalogue of a programme (completed in phase 18b): what a reward costs in stamps or points, where it is valid and whether it is active; a reward is active only when every store in its scope maps it in coupon_rail_rewards (FR-CMP-11)';
comment on column public.coupons.store_ids is 'the stores where the reward is redeemed; null for every store of the tenant';

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  membership_id uuid not null,
  coupon_id uuid not null,
  coupon_code_id uuid,
  code text not null check (char_length(code) between 1 and 64 and code !~ '[[:space:][:cntrl:]]'),
  state public.redemption_state not null default 'held',
  held_at timestamptz not null default now(),
  hold_expires_at timestamptz not null,
  redeem_entry_id uuid,
  confirmed_invoice_id uuid,
  confirmed_at timestamptz,
  released_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id),
  foreign key (tenant_id, coupon_id) references public.coupons (tenant_id, id),
  foreign key (tenant_id, coupon_code_id) references public.coupon_codes (tenant_id, id),
  foreign key (tenant_id, redeem_entry_id) references public.loyalty_ledger (tenant_id, id),
  foreign key (tenant_id, confirmed_invoice_id) references public.invoices (tenant_id, id),
  check (hold_expires_at > held_at),
  check (state <> 'confirmed' or (confirmed_invoice_id is not null and confirmed_at is not null)),
  check (state not in ('released', 'cancelled') or released_at is not null)
);

comment on table public.redemptions is 'a member''s redemption of a coupon: held with a single-use code until the synced invoice carrying it confirms it, or released when the hold expires';

create unique index redemptions_live_code_key on public.redemptions (store_id, code) where state = 'held';
create unique index redemptions_live_pool_code_key on public.redemptions (coupon_code_id) where coupon_code_id is not null and state in ('held', 'confirmed');
create index redemptions_membership_idx on public.redemptions (membership_id, held_at);

create function app.coupon_unmapped_stores(p_tenant_id uuid, p_reward_key text, p_store_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  from public.stores s
  where s.tenant_id = p_tenant_id
    and (p_store_ids is null or s.id = any (p_store_ids))
    and (p_store_ids is not null or s.active)
    and not exists (
      select 1
      from public.coupon_rail_rewards r
      where r.store_id = s.id
        and r.reward_key = p_reward_key
        and r.active
    );
$$;

comment on function app.coupon_unmapped_stores(uuid, text, uuid[]) is 'the stores of a reward''s scope (the listed stores, or every active store of the tenant for null) without an active coupon_rail_rewards row, which sets the e-invoice display';

create function app.guard_coupon()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing uuid[];
begin
  if new.active then
    v_missing := app.coupon_unmapped_stores(new.tenant_id, new.reward_key, new.store_ids);
    if cardinality(v_missing) > 0 or (new.store_ids is null and not exists (select 1 from public.stores s where s.tenant_id = new.tenant_id and s.active)) then
      raise exception 'a reward is active only when every store in its scope maps it to a POS discount or 0-price line with an e-invoice display (coupon_rail_rewards)' using errcode = '22023';
    end if;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;

create trigger coupons_guard
before insert or update on public.coupons
for each row execute function app.guard_coupon();
create trigger coupons_validate_store_ids before insert or update of tenant_id, store_ids on public.coupons for each row execute function app.validate_zalo_store_ids();
create trigger coupons_set_updated_at before update on public.coupons for each row execute function app.set_updated_at();
create trigger coupons_keep_created_by before update on public.coupons for each row execute function app.keep_created_by();
create trigger coupons_set_updated_by before insert or update on public.coupons for each row execute function app.set_updated_by();

create function app.guard_coupon_rail_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.active
    and (tg_op = 'DELETE' or not new.active or new.reward_key is distinct from old.reward_key or new.store_id is distinct from old.store_id)
    and exists (
      select 1
      from public.coupons c
      where c.tenant_id = old.tenant_id
        and c.reward_key = old.reward_key
        and c.active
        and (c.store_ids is null or old.store_id = any (c.store_ids))
    )
  then
    raise exception 'an active reward keeps its e-invoice mapping at every store in its scope: deactivate the reward first' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger coupon_rail_rewards_keep_active_mapping
before update or delete on public.coupon_rail_rewards
for each row execute function app.guard_coupon_rail_reward();

create function app.current_customer_membership_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.id), '{}'::uuid[])
  from public.memberships m
  where m.customer_id = app.current_customer_id();
$$;

comment on function app.current_customer_membership_ids() is 'the memberships of the customer of a customer session (see app.current_customer_id), empty for every other session';

create function app.loyalty_balance(p_membership_id uuid, p_at timestamptz default null)
returns table (
  membership_id uuid,
  programme_id uuid,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  stamps_per_card smallint,
  cards_completed integer,
  stamps_on_card integer,
  next_stamp_expiry timestamptz,
  points_value_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    select l.*
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and (p_at is null or l.occurred_at <= p_at)
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
      e.stamp_delta,
      e.point_delta,
      exists (select 1 from open_pending o where o.id = e.id or o.id = e.source_entry_id) as is_pending
    from entries e
  ),
  totals as (
    select
      coalesce(sum(s.stamp_delta) filter (where not s.is_pending), 0)::integer as stamps,
      coalesce(sum(s.point_delta) filter (where not s.is_pending), 0)::integer as points,
      coalesce(sum(s.stamp_delta) filter (where s.is_pending), 0)::integer as pending_stamps,
      coalesce(sum(s.point_delta) filter (where s.is_pending), 0)::integer as pending_points
    from split s
  )
  select
    m.id,
    m.programme_id,
    t.stamps,
    t.points,
    t.pending_stamps,
    t.pending_points,
    p.stamps_per_card,
    greatest(t.stamps, 0) / p.stamps_per_card,
    greatest(t.stamps, 0) % p.stamps_per_card,
    (select min(st.expires_at) from public.stamps st where st.membership_id = m.id and st.state = 'active'),
    round(t.points * p.point_value_amount, 2)
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  cross join totals t
  where m.id = p_membership_id;
$$;

comment on function app.loyalty_balance(uuid, timestamptz) is 'the balance of a membership from its ledger rows (up to p_at when given): spendable stamps and points (confirmed earns, adjustments, holds, redemptions, clawbacks and expiries) and pending ones (earns waiting for their confirm row), with the card progress and the points value; no row when the caller cannot read the membership';

create function public.loyalty_balance(p_membership_id uuid)
returns table (
  membership_id uuid,
  programme_id uuid,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  stamps_per_card smallint,
  cards_completed integer,
  stamps_on_card integer,
  next_stamp_expiry timestamptz,
  points_value_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app.loyalty_balance(p_membership_id, null);
$$;

comment on function public.loyalty_balance(uuid) is 'RPC: app.loyalty_balance for a membership the caller reads (a customer session its own, owners, managers and viewers their tenant''s)';

create function app.erase_loyalty_membership(p_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_rows integer;
begin
  if not exists (select 1 from public.memberships m where m.id = p_membership_id) then
    raise exception 'erase_loyalty_membership needs an existing membership' using errcode = '22023';
  end if;
  perform set_config('app.loyalty_erasure', 'on', true);
  delete from public.stamps where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('stamps', v_rows);
  delete from public.redemptions where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('redemptions', v_rows);
  delete from public.receipt_claims where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('receipt_claims', v_rows);
  delete from public.pending_checkins where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('pending_checkins', v_rows);
  delete from public.loyalty_ledger where membership_id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('loyalty_ledger', v_rows);
  delete from public.memberships where id = p_membership_id;
  get diagnostics v_rows = row_count;
  v_counts := v_counts || jsonb_build_object('memberships', v_rows);
  perform set_config('app.loyalty_erasure', 'off', true);
  return v_counts;
end;
$$;

comment on function app.erase_loyalty_membership(uuid) is 'the data-subject deletion of a membership''s loyalty rows: its stamps, redemptions, claims, check-ins, ledger rows and the membership itself, returning the counts; the only way past the append-only rule of loyalty_ledger; service role only';

alter table public.memberships enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.stamps enable row level security;
alter table public.pending_checkins enable row level security;
alter table public.receipt_claims enable row level security;
alter table public.coupons enable row level security;
alter table public.redemptions enable row level security;

create policy customers_select_own_for_customer on public.customers
  for select to authenticated
  using (id = (select app.current_customer_id()));

create policy memberships_select_for_loyalty_readers on public.memberships
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_loyalty_tenant_ids())::uuid[])
    or customer_id = (select app.current_customer_id())
  );

create policy loyalty_ledger_select_for_loyalty_readers on public.loyalty_ledger
  for select to authenticated
  using (
    store_id = any ((select app.current_user_loyalty_store_ids())::uuid[])
    or (store_id is null and tenant_id = any ((select app.current_user_loyalty_tenant_ids())::uuid[]))
    or membership_id = any ((select app.current_customer_membership_ids())::uuid[])
  );

create policy stamps_select_for_loyalty_readers on public.stamps
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_loyalty_tenant_ids())::uuid[])
    or membership_id = any ((select app.current_customer_membership_ids())::uuid[])
  );

create policy pending_checkins_select_for_loyalty_readers on public.pending_checkins
  for select to authenticated
  using (
    store_id = any ((select app.current_user_loyalty_store_ids())::uuid[])
    or membership_id = any ((select app.current_customer_membership_ids())::uuid[])
  );

create policy receipt_claims_select_for_loyalty_readers on public.receipt_claims
  for select to authenticated
  using (
    store_id = any ((select app.current_user_loyalty_store_ids())::uuid[])
    or membership_id = any ((select app.current_customer_membership_ids())::uuid[])
  );

create policy redemptions_select_for_loyalty_readers on public.redemptions
  for select to authenticated
  using (
    store_id = any ((select app.current_user_loyalty_store_ids())::uuid[])
    or (store_id is null and tenant_id = any ((select app.current_user_loyalty_tenant_ids())::uuid[]))
    or membership_id = any ((select app.current_customer_membership_ids())::uuid[])
  );

create policy coupons_select_for_data_members on public.coupons
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    or (active and tenant_id = (select app.current_customer_tenant_id()))
  );
create policy coupons_insert_for_unlimited_managers on public.coupons
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy coupons_update_for_unlimited_managers on public.coupons
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));
create policy coupons_delete_for_unlimited_managers on public.coupons
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.memberships, public.loyalty_ledger, public.stamps, public.pending_checkins, public.receipt_claims, public.coupons, public.redemptions from anon;
revoke insert, update, delete, truncate, references, trigger on public.memberships, public.loyalty_ledger, public.stamps, public.pending_checkins, public.receipt_claims, public.redemptions from authenticated;
grant select on public.memberships, public.loyalty_ledger, public.stamps, public.pending_checkins, public.receipt_claims, public.redemptions to authenticated;
grant select, insert, update, delete on public.coupons to authenticated;

revoke all on function app.keep_loyalty_ledger() from public, anon, authenticated;
revoke all on function app.refuse_loyalty_ledger_truncate() from public, anon, authenticated;
revoke all on function app.coupon_unmapped_stores(uuid, text, uuid[]) from public, anon;
revoke all on function app.guard_coupon() from public, anon, authenticated;
revoke all on function app.guard_coupon_rail_reward() from public, anon, authenticated;
revoke all on function app.current_customer_membership_ids() from public, anon;
revoke all on function app.loyalty_balance(uuid, timestamptz) from public, anon;
revoke all on function public.loyalty_balance(uuid) from public, anon;
revoke all on function app.erase_loyalty_membership(uuid) from public, anon, authenticated;

grant execute on function app.coupon_unmapped_stores(uuid, text, uuid[]) to authenticated, service_role;
grant execute on function app.current_customer_membership_ids() to authenticated, service_role;
grant execute on function app.loyalty_balance(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.loyalty_balance(uuid) to authenticated, service_role;
grant execute on function app.erase_loyalty_membership(uuid) to service_role;
