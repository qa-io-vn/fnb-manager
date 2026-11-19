alter table public.coupon_rails
  add column callback_store_ref text,
  add column callback_enabled boolean not null default false,
  add constraint coupon_rails_callback_store_ref_check check (
    callback_store_ref is null
    or (char_length(callback_store_ref) between 1 and 100 and callback_store_ref = btrim(callback_store_ref) and callback_store_ref !~ '[[:cntrl:]]')
  ),
  add constraint coupon_rails_callback_store_ref_rail_check check (callback_store_ref is null or rail = 'crm_callback'),
  add constraint coupon_rails_callback_enabled_rail_check check (not callback_enabled or rail = 'crm_callback');

comment on column public.coupon_rails.callback_store_ref is 'crm_callback only: the store as the POS names it in the voucher callback (the store reference the adapter reads from the payload); the callback answers only a store whose active rail row carries it; set again on a new row after a rail switch';
comment on column public.coupon_rails.callback_enabled is 'crm_callback only: whether the voucher callback decides codes for the store; off by default, so a configured store answers disabled (0 dong) until the owner switches it on after the POS vendor has confirmed how the callback behaves (method, timeout, retries, source addresses, result code)';

create unique index coupon_rails_active_callback_store_ref_key
  on public.coupon_rails (tenant_id, callback_store_ref)
  where active_until is null and callback_store_ref is not null;

create table app.voucher_callback_paths (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60 and label = btrim(label) and label !~ '[[:cntrl:]]'),
  path_sha256 text not null unique check (path_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, id),
  check (revoked_at is null or revoked_at >= created_at)
);

create unique index voucher_callback_paths_live_label_key on app.voucher_callback_paths (tenant_id, label) where revoked_at is null;

comment on table app.voucher_callback_paths is 'the secret path segments of the voucher callback (FR-LOY-05, NFR-SEC-13), one or more live ones per tenant: only the SHA-256 of the segment is kept, the segment itself is shown once by app.issue_voucher_callback_path and typed into the POS CRM programme as the last part of the callback URL; a revoked row answers like an unknown path';

revoke all on table app.voucher_callback_paths from public, anon, authenticated, service_role;

create table app.voucher_callback_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  sale_ref text not null check (char_length(sale_ref) between 1 and 100 and sale_ref = btrim(sale_ref) and sale_ref !~ '[[:cntrl:]]'),
  redemption_id uuid,
  discount_amount numeric(14, 0) not null check (discount_amount > 0),
  reward_name text not null check (char_length(reward_name) between 1 and 120),
  answered_at timestamptz not null,
  replays integer not null default 0 check (replays >= 0),
  last_replayed_at timestamptz,
  unique (store_id, sale_ref, redemption_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, redemption_id) references public.redemptions (tenant_id, id) on delete set null (redemption_id)
);

create index voucher_callback_answers_redemption_idx on app.voucher_callback_answers (redemption_id) where redemption_id is not null;
create index voucher_callback_answers_store_sale_idx on app.voucher_callback_answers (store_id, sale_ref);

comment on table app.voucher_callback_answers is 'the binding answers of the voucher callback: one row per store, POS sale reference and redemption that was given a discount, so the same sale always gets the same discount back (replays counted) and the code answers 0 ₫ to any other sale; refusals bind nothing and are only logged; no code value and no member reference is kept';

revoke all on table app.voucher_callback_answers from public, anon, authenticated, service_role;

create table app.voucher_callback_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  outcome text not null check (outcome in (
    'accepted', 'replayed', 'unknown_store', 'disabled', 'wrong_programme', 'unknown_code', 'wrong_store', 'used', 'expired', 'released',
    'wrong_member', 'below_minimum', 'not_applicable'
  )),
  discount_amount numeric(14, 0) not null default 0 check (discount_amount >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  logged_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index voucher_callback_log_tenant_time_idx on app.voucher_callback_log (tenant_id, logged_at desc);

comment on table app.voucher_callback_log is 'one row per voucher callback the database decided (NFR-PRV-01): when, which store (null when the POS store reference is not configured), the outcome code, the discount answered and the latency from the function receiving the call to the decision; never the code value, the sale reference, the lines or the member reference; a wrong path, a refused address and a malformed body write nothing';

revoke all on table app.voucher_callback_log from public, anon, authenticated, service_role;

create function app.issue_voucher_callback_path(p_tenant_id uuid, p_label text default 'pos-crm')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(p_label);
  v_alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  v_segment text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'issue_voucher_callback_path needs an existing tenant' using errcode = '22023';
  end if;
  if v_label is null or char_length(v_label) not between 1 and 60 or v_label ~ '[[:cntrl:]]' then
    raise exception 'a callback path label holds 1 to 60 characters' using errcode = '22023';
  end if;
  update app.voucher_callback_paths k
  set revoked_at = now()
  where k.tenant_id = p_tenant_id and k.label = v_label and k.revoked_at is null;
  v_segment := app.notify_random_code(v_alphabet, 32) || app.notify_random_code(v_alphabet, 11);
  insert into app.voucher_callback_paths (tenant_id, label, path_sha256)
  values (p_tenant_id, v_label, encode(sha256(convert_to(v_segment, 'UTF8')), 'hex'));
  return v_segment;
end;
$$;

comment on function app.issue_voucher_callback_path(uuid, text) is 'draws a new secret path segment of 43 base64url characters (258 random bits) for the tenant''s voucher callback under a label, revokes the live segment of the same label, keeps only its SHA-256 and returns the segment once: the callback URL is <functions URL>/voucher-callback/<segment>; service role only (fnb loyalty callback-path issue)';

create function app.revoke_voucher_callback_path(p_tenant_id uuid, p_label text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update app.voucher_callback_paths k
  set revoked_at = now()
  where k.tenant_id = p_tenant_id and k.label = btrim(p_label) and k.revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function app.revoke_voucher_callback_path(uuid, text) is 'revokes the live callback path segment of a label: the callback then answers 404 to it without a write; returns the number of rows revoked; service role only';

create function app.voucher_callback_lines_valid(p_lines jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_lines) = 'array'
    and jsonb_array_length(p_lines) <= 300
    and not exists (
      select 1
      from jsonb_array_elements(p_lines) e
      where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'item') is distinct from 'string'
        or char_length(btrim(e ->> 'item')) not between 1 and 100
        or jsonb_typeof(e -> 'quantity') is distinct from 'number'
        or jsonb_typeof(e -> 'amount') is distinct from 'number'
        or (e ->> 'quantity')::numeric <= 0
        or (e ->> 'quantity')::numeric > 10000
        or (e ->> 'amount')::numeric < 0
        or (e ->> 'amount')::numeric > 1000000000
    )
    and (select coalesce(sum((e ->> 'amount')::numeric), 0) from jsonb_array_elements(p_lines) e) <= 1000000000;
$$;

comment on function app.voucher_callback_lines_valid(jsonb) is 'whether the canonical bill lines of a voucher callback are well formed: an array of at most 300 objects {item, quantity, amount}, an item reference of 1 to 100 characters, a quantity above 0 and at most 10,000, a net line amount from 0 to 1,000,000,000 dong, and a bill of at most 1,000,000,000 dong';

create function app.answer_voucher_callback(
  p_path_sha256 text,
  p_source_ip inet,
  p_store_ref text,
  p_programme_ref text,
  p_code text,
  p_sale_ref text,
  p_member_phone text,
  p_lines jsonb,
  p_received_at timestamptz default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_country text;
  v_rail public.coupon_rails;
  v_allow cidr[];
  v_code text := upper(btrim(p_code));
  v_sale text := btrim(p_sale_ref);
  v_store uuid;
  v_redemption public.redemptions;
  v_coupon public.coupons;
  v_answer app.voucher_callback_answers;
  v_member_phone text := app.loyalty_normalize_phone(p_member_phone);
  v_owner_phone text;
  v_today date;
  v_bill numeric;
  v_base numeric;
  v_unit numeric;
  v_cap numeric;
  v_outcome text;
  v_discount numeric := 0;
  v_reward text;
begin
  if p_path_sha256 is null or p_path_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unknown_path', 'discount_amount', 0, 'reward_name', null);
  end if;
  select k.tenant_id into v_tenant
  from app.voucher_callback_paths k
  where k.path_sha256 = p_path_sha256 and k.revoked_at is null;
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unknown_path', 'discount_amount', 0, 'reward_name', null);
  end if;
  if p_store_ref is null or char_length(btrim(p_store_ref)) not between 1 and 100
    or v_code is null or char_length(v_code) not between 1 and 64 or v_code ~ '[[:space:][:cntrl:]]'
    or v_sale is null or char_length(v_sale) not between 1 and 100 or v_sale ~ '[[:cntrl:]]'
    or (p_programme_ref is not null and char_length(p_programme_ref) > 100)
    or not app.voucher_callback_lines_valid(p_lines)
  then
    return jsonb_build_object('outcome', 'malformed', 'discount_amount', 0, 'reward_name', null);
  end if;

  select r.* into v_rail
  from public.coupon_rails r
  where r.tenant_id = v_tenant
    and r.active_until is null
    and r.rail = 'crm_callback'
    and r.callback_store_ref = btrim(p_store_ref);
  if v_rail.id is not null then
    v_allow := v_rail.callback_ip_allowlist;
  else
    select coalesce(array_agg(distinct a.network), '{}'::cidr[]) into v_allow
    from public.coupon_rails r
    cross join lateral unnest(r.callback_ip_allowlist) as a (network)
    where r.tenant_id = v_tenant and r.active_until is null and r.rail = 'crm_callback';
  end if;
  if cardinality(v_allow) > 0
    and (p_source_ip is null or not exists (select 1 from unnest(v_allow) as a (network) where p_source_ip <<= a.network))
  then
    return jsonb_build_object('outcome', 'refused_address', 'discount_amount', 0, 'reward_name', null);
  end if;
  v_store := v_rail.store_id;

  if v_rail.id is null then
    v_outcome := 'unknown_store';
  elsif not v_rail.callback_enabled then
    v_outcome := 'disabled';
  elsif nullif(btrim(p_programme_ref), '') is not null
    and cardinality(v_rail.crm_programme_external_ids) > 0
    and not (btrim(p_programme_ref) = any (v_rail.crm_programme_external_ids))
  then
    v_outcome := 'wrong_programme';
  else
    select r.* into v_redemption
    from public.redemptions r
    where r.tenant_id = v_tenant
      and upper(r.code) = v_code
    order by (r.store_id = v_store) desc nulls last, (r.state = 'held') desc, r.held_at desc, r.id
    limit 1
    for update;
    if v_redemption.id is null or v_redemption.rail is distinct from 'crm_callback' then
      v_outcome := 'unknown_code';
    else
      select a.* into v_answer
      from app.voucher_callback_answers a
      where a.redemption_id = v_redemption.id and a.store_id = v_store and a.sale_ref = v_sale;
      if v_answer.id is not null then
        update app.voucher_callback_answers a
        set replays = a.replays + 1, last_replayed_at = p_at
        where a.id = v_answer.id;
        v_outcome := 'replayed';
        v_discount := v_answer.discount_amount;
        v_reward := v_answer.reward_name;
      elsif v_redemption.store_id is distinct from v_store then
        v_outcome := 'wrong_store';
      elsif v_redemption.state = 'confirmed'
        or exists (select 1 from app.voucher_callback_answers a where a.redemption_id = v_redemption.id)
      then
        v_outcome := 'used';
      elsif v_redemption.state in ('released', 'cancelled') then
        v_outcome := 'released';
      elsif v_redemption.hold_expires_at <= p_at then
        v_outcome := 'expired';
      else
        select c.phone into v_owner_phone
        from public.memberships m
        join public.customers c on c.id = m.customer_id and c.tenant_id = m.tenant_id
        where m.id = v_redemption.membership_id;
        select c.* into v_coupon from public.coupons c where c.id = v_redemption.coupon_id;
        select t.country_code into v_country from public.tenants t where t.id = v_tenant;
        v_today := app.store_business_date(v_store, p_at);
        if v_member_phone is not null and app.loyalty_normalize_phone(v_owner_phone) is distinct from v_member_phone then
          v_outcome := 'wrong_member';
        elsif (v_coupon.valid_from is not null and v_today < v_coupon.valid_from)
          or (v_coupon.valid_until is not null and v_today > v_coupon.valid_until)
        then
          v_outcome := 'expired';
        else
          select
            coalesce(sum(l.amount), 0),
            coalesce(sum(l.amount) filter (where l.eligible), 0),
            min(l.amount / l.quantity) filter (where l.eligible and l.amount > 0)
          into v_bill, v_base, v_unit
          from (
            select
              (e ->> 'amount')::numeric as amount,
              (e ->> 'quantity')::numeric as quantity,
              not (btrim(e ->> 'item') = any (v_coupon.excluded_item_external_ids))
                and (v_coupon.reward_item_external_ids is null or btrim(e ->> 'item') = any (v_coupon.reward_item_external_ids)) as eligible
            from jsonb_array_elements(p_lines) e
          ) l;
          if v_coupon.min_bill_amount > 0 and v_bill < v_coupon.min_bill_amount then
            v_outcome := 'below_minimum';
          else
            v_discount := case v_coupon.reward_kind
              when 'percent_off' then round(v_base * v_coupon.reward_percent / 100, 0)
              when 'amount_off' then least(v_coupon.reward_amount, v_base)
              else case when v_coupon.reward_item_external_ids is not null then coalesce(v_unit, 0) else 0 end
            end;
            if v_coupon.reward_kind in ('percent_off', 'amount_off') then
              v_cap := app.promotion_discount_cap(v_country, v_today, v_today);
              if v_cap is not null then
                v_discount := least(v_discount, floor(v_base * v_cap));
              end if;
            end if;
            v_discount := greatest(floor(least(v_discount, v_base)), 0);
            if v_discount <= 0 then
              v_outcome := 'not_applicable';
            else
              v_reward := v_coupon.name;
              insert into app.voucher_callback_answers (tenant_id, store_id, sale_ref, redemption_id, discount_amount, reward_name, answered_at)
              values (v_tenant, v_store, v_sale, v_redemption.id, v_discount, v_reward, p_at);
              update public.redemptions r
              set verified_at = coalesce(r.verified_at, p_at)
              where r.id = v_redemption.id;
              v_outcome := 'accepted';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  if v_outcome not in ('accepted', 'replayed') then
    v_discount := 0;
    v_reward := null;
  end if;
  insert into app.voucher_callback_log (tenant_id, store_id, outcome, discount_amount, latency_ms, logged_at)
  values (
    v_tenant, v_store, v_outcome, v_discount,
    case when p_received_at is not null
      then least(greatest(floor(extract(epoch from (clock_timestamp() - p_received_at)) * 1000), 0), 2147483647)::integer end,
    p_at
  );
  return jsonb_build_object('outcome', v_outcome, 'discount_amount', v_discount, 'reward_name', v_reward);
end;
$$;

comment on function app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz) is 'the decision of the voucher callback (FR-LOY-05) in one call, from canonical values only (no vendor field name): the SHA-256 of the path segment names the tenant (unknown_path otherwise), malformed values answer malformed, the store is the active crm_callback rail whose callback_store_ref is the POS store reference, and a source address outside a non-empty allow-list (that rail''s, or every crm_callback rail''s of the tenant while the store is unknown) answers refused_address; these four write nothing. Then unknown_store, disabled (the rail''s callback_enabled is off, the default), and, with the redemption row locked: a sale already answered for the code gets its first answer back (replayed); otherwise wrong_programme (a programme reference outside the rail''s crm_programme_external_ids), unknown_code (no redemption of the tenant on the crm_callback rail with that code), wrong_store, used (confirmed, or answered for another sale), released, expired (hold or reward dates), wrong_member (a member phone on the bill other than the owner''s), below_minimum (bill under min_bill_amount), not_applicable (nothing to discount), else accepted: the discount is the reward''s percentage (rounded to the dong) or amount of the eligible lines (the reward items, or every line but the excluded items), or one unit of the cheapest reward item for a gift, never above the eligible total nor, for price reductions, the dated discount cap; an accepted answer is stored per store, sale and redemption and marks the redemption verified. Every decision past the path and address checks writes one voucher_callback_log row. Returns {outcome, discount_amount, reward_name}; service role only';

create or replace function app.redemption_confirming_invoice(p_redemption_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_redemption public.redemptions;
  v_before integer;
  v_after integer;
  v_invoice uuid;
begin
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id;
  if v_redemption.id is null or v_redemption.state <> 'held' then
    return null;
  end if;
  if v_redemption.rail = 'pos_payment_discount' then
    if v_redemption.verified_at is null then
      return null;
    end if;
    select p.checkin_window_before_minutes, p.checkin_window_after_minutes into v_before, v_after
    from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id
    where m.id = v_redemption.membership_id;
    select i.id into v_invoice
    from public.invoices i
    where i.tenant_id = v_redemption.tenant_id
      and i.store_id = v_redemption.store_id
      and i.status = 'completed'
      and i.sold_at >= v_redemption.verified_at - make_interval(mins => v_before)
      and i.sold_at <= v_redemption.verified_at + make_interval(mins => v_after)
      and (
        (v_redemption.pos_discount_name is not null and lower(btrim(i.bill_discount_name)) = lower(btrim(v_redemption.pos_discount_name)))
        or (
          v_redemption.pos_discount_name is null
          and v_redemption.pos_free_item_external_id is not null
          and exists (
            select 1 from public.invoice_lines l
            where l.invoice_id = i.id
              and l.line_kind = 'item'
              and l.item_external_id = v_redemption.pos_free_item_external_id
              and l.net_amount = 0
          )
        )
      )
      and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
    order by abs(extract(epoch from i.sold_at - v_redemption.verified_at)), i.external_id collate "C"
    limit 1;
    return v_invoice;
  end if;
  select i.id into v_invoice
  from public.invoices i
  where i.tenant_id = v_redemption.tenant_id
    and (v_redemption.store_id is null or i.store_id = v_redemption.store_id)
    and i.status = 'completed'
    and (
      (i.voucher_code is not null and upper(btrim(i.voucher_code)) = upper(v_redemption.code))
      or (
        v_redemption.rail = 'crm_callback'
        and exists (
          select 1 from app.voucher_callback_answers a
          where a.redemption_id = v_redemption.id
            and a.store_id = i.store_id
            and a.sale_ref = i.external_id
        )
      )
    )
    and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
  order by i.sold_at, i.external_id collate "C"
  limit 1;
  return v_invoice;
end;
$$;

comment on function app.redemption_confirming_invoice(uuid) is 'the synced invoice that confirms a held redemption, or null: on pos_payment_discount, a completed invoice of the store carrying the discount entry name (or the 0-price line of the free item) sold within the programme''s check-in window around the staff verification (checkin_window_before_minutes before to checkin_window_after_minutes after), closest first, and nothing before staff verified the code; on the code rails, a completed invoice of the store carrying the code as its voucher code, and on crm_callback also the completed invoice of the store whose external id is the sale reference the voucher callback answered for the redemption; an invoice that already confirms a redemption never confirms another';

create function app.reconcile_rails(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_invoice uuid;
  v_outcome text;
  v_confirmed integer := 0;
  v_earned integer := 0;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_rails takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  for v_row in
    select r.id
    from public.redemptions r
    where r.tenant_id = p_tenant_id
      and r.state = 'held'
      and r.rail = 'crm_callback'
      and exists (select 1 from app.voucher_callback_answers a where a.redemption_id = r.id)
    order by r.held_at, r.id
  loop
    v_invoice := app.redemption_confirming_invoice(v_row.id);
    continue when v_invoice is null;
    v_outcome := app.confirm_redemption(v_row.id, v_invoice, p_at);
    if v_outcome is not null then
      v_confirmed := v_confirmed + 1;
      if v_outcome = 'earned' then
        v_earned := v_earned + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('callback_confirmed', v_confirmed, 'callback_earned', v_earned);
end;
$$;

comment on function app.reconcile_rails(uuid, date, date, timestamptz) is 'the rail step of the loyalty reconciliation after every sync (at most 63 days), under the tenant''s loyalty lock: confirms the held crm_callback redemptions the voucher callback answered whose sale is now a synced completed invoice of the store (app.redemption_confirming_invoice, then app.confirm_redemption, which earns on path D); idempotent; returns counts only: callback_confirmed, callback_earned';

create or replace function app.reconcile_loyalty(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  v_counts := app.reconcile_loyalty_paths(p_tenant_id, p_from, p_to, p_at);
  if v_counts ? 'skipped' then
    return v_counts;
  end if;
  v_counts := v_counts || app.reconcile_redemptions(p_tenant_id, p_from, p_to, p_at);
  return v_counts || app.reconcile_rails(p_tenant_id, p_from, p_to, p_at);
end;
$$;

comment on function app.reconcile_loyalty(uuid, date, date, timestamptz) is 'the loyalty reconciliation after a sync: app.reconcile_loyalty_paths (paths A to D and the expiry of stale codes, check-ins and claims), then app.reconcile_redemptions (the fallback-rail confirmations and the redemption mismatches), then app.reconcile_rails (the rail step); nothing without an active programme; idempotent; returns counts only; service role and the jobs';

revoke all on function app.issue_voucher_callback_path(uuid, text) from public, anon, authenticated;
revoke all on function app.revoke_voucher_callback_path(uuid, text) from public, anon, authenticated;
revoke all on function app.voucher_callback_lines_valid(jsonb) from public, anon, authenticated;
revoke all on function app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.reconcile_rails(uuid, date, date, timestamptz) from public, anon, authenticated;

grant execute on function app.issue_voucher_callback_path(uuid, text) to service_role;
grant execute on function app.revoke_voucher_callback_path(uuid, text) to service_role;
grant execute on function app.voucher_callback_lines_valid(jsonb) to service_role;
grant execute on function app.answer_voucher_callback(text, inet, text, text, text, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function app.reconcile_rails(uuid, date, date, timestamptz) to service_role;
