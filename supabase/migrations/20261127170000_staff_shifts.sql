-- The native till, step 8 (native-till.md section 12): shifts at the counter. A staff member clocks in by scanning the
-- store's counter QR code (proof of being at the counter), with the opening cash; clocking out takes a blind count of
-- the drawer, compared with what the counter recorded during the shift (the opening cash, plus the cash payments the
-- person recorded, less the cash they handed back); a difference keeps the shift open for a manager's confirmation
-- (acceptance criterion: a shift with a cash difference cannot be closed without a manager). Monthly worked days follow
-- the recorded clock-in and clock-out times against a standard of 28 (acceptance criterion 7), and a store's day
-- reconciles the app's revenue with the provider-confirmed payments, the card payments and the counted cash
-- (acceptance criterion 6). The POS's own shifts and cash counts (phase 14b) are untouched: they describe the POS till.

-- 1. Settings -------------------------------------------------------------------------------------------------------

alter table public.store_ordering_settings
  add column counter_qr_version integer not null default 1 check (counter_qr_version >= 1),
  add column standard_day_hours numeric(4, 2) not null default 8 check (standard_day_hours between 1 and 16),
  add column standard_month_days integer not null default 28 check (standard_month_days between 20 and 31);

comment on column public.store_ordering_settings.counter_qr_version is 'the version of the store''s counter QR code staff scan to clock in; moved only by manager_counter_qr with rotate, which retires the printed code';
comment on column public.store_ordering_settings.standard_day_hours is 'the hours that make one worked day (8 by default): a business day''s recorded hours over this, at most 1';
comment on column public.store_ordering_settings.standard_month_days is 'the worked days of a full month (28 by default, the S11 standard) the monthly days are read against';

grant insert (standard_day_hours, standard_month_days), update (standard_day_hours, standard_month_days) on public.store_ordering_settings to authenticated;

-- 2. Shifts ---------------------------------------------------------------------------------------------------------

create table public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  business_date date not null,
  clock_in_at timestamptz not null,
  opening_cash numeric(14, 2) not null default 0 check (app.native_price_valid(opening_cash, 0, 100000000)),
  clock_out_at timestamptz,
  expected_cash numeric(14, 2),
  counted_cash numeric(14, 2) check (counted_cash is null or app.native_price_valid(counted_cash, 0, 100000000)),
  cash_difference numeric(14, 2),
  status text not null default 'open' check (status in ('open', 'awaiting_confirmation', 'closed')),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  close_note text check (close_note is null or app.native_text_valid(close_note, 200)),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  check (clock_out_at is null or clock_out_at > clock_in_at),
  check ((status = 'open') = (clock_out_at is null)),
  check (status = 'open' or (expected_cash is not null and counted_cash is not null and cash_difference = counted_cash - expected_cash)),
  check (status <> 'awaiting_confirmation' or cash_difference <> 0),
  check ((status = 'closed') = (closed_at is not null)),
  check (status <> 'closed' or cash_difference = 0 or (closed_by is not null and close_note is not null))
);

create unique index staff_shifts_one_open_key on public.staff_shifts (user_id) where status <> 'closed';
create index staff_shifts_store_date_idx on public.staff_shifts (store_id, business_date);
create index staff_shifts_user_date_idx on public.staff_shifts (user_id, business_date);
create index staff_shifts_tenant_idx on public.staff_shifts (tenant_id);

comment on table public.staff_shifts is 'the shifts worked at a native store''s counter: clocked in with the counter QR code and the opening cash, clocked out with a blind count of the drawer compared with the cash the person recorded during the shift; a difference waits for a manager''s confirmation (closed_by, close_note); a forgotten clock-out is closed by a manager; at most one shift per person that is not closed; read by the store''s owners and managers and by the person; written only by the shift functions';

create trigger staff_shifts_set_updated_at before update on public.staff_shifts for each row execute function app.set_updated_at();

alter table public.staff_shifts enable row level security;

create policy staff_shifts_select on public.staff_shifts
  for select to authenticated
  using (user_id = (select auth.uid()) or app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.staff_shifts from anon, authenticated;
grant select on public.staff_shifts to authenticated;

alter table app.code_attempt_policies drop constraint code_attempt_policies_endpoint_check;
alter table app.code_attempt_policies add constraint code_attempt_policies_endpoint_check check (endpoint in (
  'staff_verify_redemption', 'staff_member_lookup', 'loyalty_member_lookup', 'customer_redeem', 'staff_submit_bill', 'customer_counter_claim',
  'customer_table', 'customer_call_staff', 'customer_place_order', 'request_app', 'request_website', 'staff_clock_in'
));
insert into app.code_attempt_policies (endpoint, counts, caller_max, scope_max, window_length, lockout)
values ('staff_clock_in', 'misses', 5, 20, interval '15 minutes', interval '15 minutes');

-- 3. Helpers --------------------------------------------------------------------------------------------------------

create function app.counter_qr_token(p_tenant_id uuid, p_store_id uuid, p_version integer)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select rtrim(translate(encode(substring(
    extensions.hmac(convert_to('counter:' || p_store_id::text || ':' || p_version::text, 'UTF8'), app.table_qr_key(p_tenant_id), 'sha256')
    from 1 for 16), 'base64'), '+/', '-_'), '=');
$$;

comment on function app.counter_qr_token(uuid, uuid, integer) is 'the counter QR token of a store and version: base64url of the first 16 bytes of HMAC-SHA-256(tenant key, ''counter:'' || store || '':'' || version), 22 characters; never equal to a table''s token, which signs ''table:''';

create function app.shift_settings(p_store_id uuid)
returns table (counter_qr_version integer, standard_day_hours numeric, standard_month_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(o.counter_qr_version, 1), coalesce(o.standard_day_hours, 8), coalesce(o.standard_month_days, 28)
  from (select 1) as one
  left join public.store_ordering_settings o on o.store_id = p_store_id;
$$;

comment on function app.shift_settings(uuid) is 'a store''s counter QR version, hours per worked day and days of a full month, with the defaults 1, 8 and 28 without a settings row';

create function app.shift_cash_flow(p_shift public.staff_shifts, p_until timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(p.amount) from public.order_payments p
      where p.store_id = p_shift.store_id and p.method = 'cash' and p.status = 'succeeded' and p.recorded_by = p_shift.user_id
        and p.settled_at >= p_shift.clock_in_at and p.settled_at < p_until), 0)
    - coalesce((select sum(r.amount) from public.order_refunds r
      where r.store_id = p_shift.store_id and r.method = 'cash' and r.status = 'succeeded' and r.recorded_by = p_shift.user_id
        and r.settled_at >= p_shift.clock_in_at and r.settled_at < p_until), 0);
$$;

comment on function app.shift_cash_flow(public.staff_shifts, timestamptz) is 'the cash a person took at the counter during a shift up to an instant: the cash payments they recorded (voided ones excluded) less the cash refunds they handed back';

create function app.shift_json(p_shift public.staff_shifts, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_shift.id,
    'store_id', p_shift.store_id,
    'business_date', p_shift.business_date,
    'clock_in_at', p_shift.clock_in_at,
    'clock_out_at', p_shift.clock_out_at,
    'hours', case when p_shift.clock_out_at is not null then round(extract(epoch from p_shift.clock_out_at - p_shift.clock_in_at) / 3600, 2) end,
    'opening_cash', p_shift.opening_cash::bigint,
    'counted_cash', p_shift.counted_cash::bigint,
    'status', p_shift.status,
    'closed_at', p_shift.closed_at,
    'close_note', p_shift.close_note,
    'version', p_shift.version
  ) || case when p_shift.status <> 'open' or p_for = 'manager' then jsonb_build_object(
    'expected_cash', p_shift.expected_cash::bigint,
    'cash_difference', p_shift.cash_difference::bigint
  ) else '{}'::jsonb end
  || case when p_for = 'manager' then jsonb_build_object(
    'user_id', p_shift.user_id,
    'name', (select r.display_name from public.staff_roster r where r.tenant_id = p_shift.tenant_id and r.user_id = p_shift.user_id),
    'closed_by', p_shift.closed_by
  ) else '{}'::jsonb end;
$$;

comment on function app.shift_json(public.staff_shifts, text) is 'a shift as its person sees it (the expected cash only once they counted: the count is blind) or as a manager sees it (with who, their roster name and who closed it)';

create function app.shift_for_manager(p_shift_id uuid)
returns public.staff_shifts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shift public.staff_shifts;
begin
  select s.* into v_shift from public.staff_shifts s where s.id = p_shift_id for update;
  if v_shift.id is null or not app.has_store_scope(v_shift.tenant_id, v_shift.store_id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the shift''s store' using errcode = '42501';
  end if;
  return v_shift;
end;
$$;

comment on function app.shift_for_manager(uuid) is 'a shift locked for an owner or manager of its store; 42501 otherwise, the same for an unknown id';

-- 4. Clocking in and out --------------------------------------------------------------------------------------------

create function app.staff_clock_in(p_store_id uuid, p_counter_token text, p_opening_cash numeric default 0, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store public.stores;
  v_open public.staff_shifts;
  v_locked timestamptz;
  v_shift public.staff_shifts;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_uid is null or v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'not a member of the store' using errcode = '42501';
  end if;
  if p_counter_token is null or p_counter_token !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'a counter token is 1 to 64 of A-Z, a-z, 0-9, _ and -' using errcode = '22023';
  end if;
  if p_opening_cash is null or not app.native_price_valid(p_opening_cash, 0, 100000000) then
    raise exception 'the opening cash is a whole number of dong' using errcode = '22023';
  end if;
  select s.* into v_open from public.staff_shifts s where s.user_id = v_uid and s.status <> 'closed';
  if v_open.id is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'already_clocked_in', 'shift', app.shift_json(v_open, 'staff'));
  end if;
  v_locked := app.code_attempt_gate('staff_clock_in', v_store.tenant_id, v_store.id, v_uid, p_at);
  if v_locked is not null then
    return jsonb_build_object('state', 'refused', 'refusal', 'rate_limited', 'retry_at', v_locked, 'shift', null);
  end if;
  if p_counter_token <> app.counter_qr_token(v_store.tenant_id, v_store.id, (select x.counter_qr_version from app.shift_settings(v_store.id) x)) then
    perform app.code_attempt_record('staff_clock_in', v_store.tenant_id, v_store.id, v_uid, p_at);
    return jsonb_build_object('state', 'refused', 'refusal', 'counter_qr_invalid', 'shift', null);
  end if;
  insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
  values (v_store.tenant_id, v_store.id, v_uid, app.store_business_date(v_store.id, p_at), p_at, p_opening_cash)
  returning * into v_shift;
  return jsonb_build_object('state', 'clocked_in', 'refusal', null, 'shift', app.shift_json(v_shift, 'staff'));
end;
$$;

comment on function app.staff_clock_in(uuid, text, numeric, timestamptz) is '"Vào ca": a member of the store (owner, manager or staff in scope; 42501 otherwise) clocks in with the store''s current counter QR token (counter_qr_invalid otherwise, which counts against the person and the store: 5 and 20 misses in 15 minutes, then rate_limited) and the opening cash; already_clocked_in while a shift of theirs is not closed; the shift takes the business date of the clock-in';

create function app.staff_clock_out(p_counted_cash numeric, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shift public.staff_shifts;
  v_until timestamptz;
  v_expected numeric;
begin
  if v_uid is null or not exists (select 1 from public.tenant_members m where m.user_id = v_uid) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_counted_cash is null or not app.native_price_valid(p_counted_cash, 0, 100000000) then
    raise exception 'the counted cash is a whole number of dong' using errcode = '22023';
  end if;
  select s.* into v_shift from public.staff_shifts s where s.user_id = v_uid and s.status <> 'closed' for update;
  if v_shift.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_clocked_in', 'shift', null);
  end if;
  if not app.has_store_scope(v_shift.tenant_id, v_shift.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'no longer a member of the shift''s store' using errcode = '42501';
  end if;
  v_until := coalesce(v_shift.clock_out_at, greatest(p_at, v_shift.clock_in_at + interval '1 second'));
  v_expected := v_shift.opening_cash + app.shift_cash_flow(v_shift, v_until);
  update public.staff_shifts s
  set clock_out_at = v_until,
      expected_cash = v_expected,
      counted_cash = p_counted_cash,
      cash_difference = p_counted_cash - v_expected,
      status = case when p_counted_cash = v_expected then 'closed' else 'awaiting_confirmation' end,
      closed_at = case when p_counted_cash = v_expected then p_at end,
      version = s.version + 1
  where s.id = v_shift.id
  returning * into v_shift;
  return jsonb_build_object('state', v_shift.status, 'refusal', null, 'shift', app.shift_json(v_shift, 'staff'));
end;
$$;

comment on function app.staff_clock_out(numeric, timestamptz) is '"Ra ca": the person''s blind count of the drawer, compared with the opening cash plus the cash they took during the shift; equal closes the shift, a difference leaves it awaiting a manager''s confirmation (the clock-out time stays the first one; counting again while it waits recomputes the difference and closes it when it matches); not_clocked_in without a shift; 42501 for anyone who is not a member';

-- 5. The manager's side -----------------------------------------------------------------------------------------

create function app.manager_counter_qr(p_store_id uuid, p_rotate boolean default false, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_version integer;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if coalesce(p_rotate, false) then
    insert into public.store_ordering_settings (store_id, tenant_id, counter_qr_version) values (v_store.id, v_store.tenant_id, 2)
    on conflict (store_id) do update set counter_qr_version = public.store_ordering_settings.counter_qr_version + 1;
  end if;
  select x.counter_qr_version into v_version from app.shift_settings(v_store.id) x;
  return jsonb_build_object('store_id', v_store.id, 'version', v_version, 'token', app.counter_qr_token(v_store.tenant_id, v_store.id, v_version), 'rotated', coalesce(p_rotate, false));
end;
$$;

comment on function app.manager_counter_qr(uuid, boolean, timestamptz) is 'the counter QR token of a store for printing, for its owners and managers (42501 otherwise); with rotate the version moves on and the printed code stops working';

create function app.manager_confirm_shift(p_shift_id uuid, p_note text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shift public.staff_shifts := app.shift_for_manager(p_shift_id);
begin
  if v_shift.status = 'closed' then
    return jsonb_build_object('state', 'closed', 'refusal', null, 'replayed', true, 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  if p_note is null or not app.native_text_valid(p_note, 200) then
    raise exception 'confirming a cash difference needs a note of 1 to 200 characters' using errcode = '22023';
  end if;
  if v_shift.status <> 'awaiting_confirmation' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_awaiting_confirmation', 'replayed', false, 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  if v_shift.user_id = (select auth.uid()) then
    return jsonb_build_object('state', 'refused', 'refusal', 'own_shift', 'replayed', false, 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  update public.staff_shifts s
  set status = 'closed', closed_by = (select auth.uid()), closed_at = p_at, close_note = p_note, version = s.version + 1
  where s.id = v_shift.id
  returning * into v_shift;
  return jsonb_build_object('state', 'closed', 'refusal', null, 'replayed', false, 'shift', app.shift_json(v_shift, 'manager'));
end;
$$;

comment on function app.manager_confirm_shift(uuid, text, timestamptz) is 'an owner or manager of the store confirms the cash difference of a shift awaiting confirmation with a note (1 to 200 characters), which closes it with who and when; nobody confirms their own shift (own_shift); not_awaiting_confirmation for an open shift; a closed shift answers as a replay';

create function app.manager_close_shift(p_shift_id uuid, p_clock_out_at timestamptz, p_counted_cash numeric, p_note text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shift public.staff_shifts := app.shift_for_manager(p_shift_id);
  v_expected numeric;
begin
  if p_note is null or not app.native_text_valid(p_note, 200) then
    raise exception 'closing a forgotten shift needs a note of 1 to 200 characters' using errcode = '22023';
  end if;
  if p_counted_cash is null or not app.native_price_valid(p_counted_cash, 0, 100000000) then
    raise exception 'the counted cash is a whole number of dong' using errcode = '22023';
  end if;
  if v_shift.status <> 'open' then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_open', 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  if v_shift.user_id = (select auth.uid()) then
    return jsonb_build_object('state', 'refused', 'refusal', 'own_shift', 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  if p_clock_out_at is null or p_clock_out_at <= v_shift.clock_in_at or p_clock_out_at > p_at then
    return jsonb_build_object('state', 'refused', 'refusal', 'clock_out_invalid', 'shift', app.shift_json(v_shift, 'manager'));
  end if;
  v_expected := v_shift.opening_cash + app.shift_cash_flow(v_shift, p_clock_out_at);
  update public.staff_shifts s
  set clock_out_at = p_clock_out_at, expected_cash = v_expected, counted_cash = p_counted_cash, cash_difference = p_counted_cash - v_expected,
      status = 'closed', closed_by = (select auth.uid()), closed_at = p_at, close_note = p_note, version = s.version + 1
  where s.id = v_shift.id
  returning * into v_shift;
  return jsonb_build_object('state', 'closed', 'refusal', null, 'shift', app.shift_json(v_shift, 'manager'));
end;
$$;

comment on function app.manager_close_shift(uuid, timestamptz, numeric, text, timestamptz) is 'an owner or manager of the store closes a shift whose person forgot to clock out (not_open otherwise; never their own), with the clock-out time (after the clock-in, not in the future: clock_out_invalid), the cash counted and a note; the shift is closed with who closed it';

create function app.manager_shifts(p_store_id uuid, p_from date, p_to date, p_at timestamptz default now())
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
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 62 then
    raise exception 'a range of business dates of at most 63 days' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(app.shift_json(s, 'manager') order by s.business_date desc, s.clock_in_at desc)
      from public.staff_shifts s where s.store_id = v_store.id and s.business_date between p_from and p_to
    ), '[]'::jsonb),
    'open', (select count(*) from public.staff_shifts s where s.store_id = v_store.id and s.status = 'open'),
    'awaiting_confirmation', (select count(*) from public.staff_shifts s where s.store_id = v_store.id and s.status = 'awaiting_confirmation')
  );
end;
$$;

comment on function app.manager_shifts(uuid, date, date, timestamptz) is 'the shifts of a store between two business dates (at most 63 days) for its owners and managers, newest first, with the counts of shifts still open and awaiting confirmation at the store';

-- 6. Worked days ----------------------------------------------------------------------------------------------------

create function app.worked_days_rows(p_store_id uuid, p_month date, p_user uuid)
returns table (user_id uuid, business_date date, hours numeric, days numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.business_date,
    round(sum(extract(epoch from s.clock_out_at - s.clock_in_at)) / 3600, 2),
    least(1.00, round(sum(extract(epoch from s.clock_out_at - s.clock_in_at)) / 3600 / (select x.standard_day_hours from app.shift_settings(p_store_id) x), 2))
  from public.staff_shifts s
  where s.store_id = p_store_id
    and s.clock_out_at is not null
    and s.business_date >= date_trunc('month', p_month)::date
    and s.business_date < (date_trunc('month', p_month) + interval '1 month')::date
    and (p_user is null or s.user_id = p_user)
  group by s.user_id, s.business_date;
$$;

comment on function app.worked_days_rows(uuid, date, uuid) is 'per person and business date of a month at a store: the hours between the recorded clock-in and clock-out of their shifts (open shifts have none yet) and the worked day they make, the hours over the store''s hours per day, at most 1, to two decimals';

create function app.worked_days_json(p_store_id uuid, p_month date, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'month', to_char(date_trunc('month', p_month), 'YYYY-MM'),
    'standard_days', (select x.standard_month_days from app.shift_settings(p_store_id) x),
    'standard_day_hours', (select x.standard_day_hours from app.shift_settings(p_store_id) x),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'name', (select r.display_name from public.staff_roster r join public.stores st on st.tenant_id = r.tenant_id where st.id = p_store_id and r.user_id = p.user_id),
        'hours', p.hours,
        'worked_days', p.days,
        'days', p.list,
        'open_shifts', (select count(*) from public.staff_shifts s where s.store_id = p_store_id and s.user_id = p.user_id and s.status = 'open'
          and s.business_date >= date_trunc('month', p_month)::date and s.business_date < (date_trunc('month', p_month) + interval '1 month')::date)
      ) order by p.user_id)
      from (
        select w.user_id, sum(w.hours) as hours, sum(w.days) as days,
          jsonb_agg(jsonb_build_object('date', w.business_date, 'hours', w.hours, 'days', w.days) order by w.business_date) as list
        from app.worked_days_rows(p_store_id, p_month, p_user) w
        group by w.user_id
      ) p
    ), '[]'::jsonb)
  );
$$;

comment on function app.worked_days_json(uuid, date, uuid) is 'the month''s worked days at a store (S11), per person: the hours, the worked days with each date''s, the shifts still open (not counted until closed) and the standard of the month';

create function app.manager_worked_days(p_store_id uuid, p_month date, p_at timestamptz default now())
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
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'a month is a date in it' using errcode = '22023';
  end if;
  return app.worked_days_json(v_store.id, p_month, null);
end;
$$;

comment on function app.manager_worked_days(uuid, date, timestamptz) is 'the worked days of every person at a store for the month of a date, for its owners and managers (42501 otherwise)';

create function app.staff_my_shift(p_month date default null, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shift public.staff_shifts;
begin
  if v_uid is null or not exists (select 1 from public.tenant_members m where m.user_id = v_uid) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select s.* into v_shift from public.staff_shifts s where s.user_id = v_uid and s.status <> 'closed';
  return jsonb_build_object(
    'shift', case when v_shift.id is not null then app.shift_json(v_shift, 'staff') end,
    'recent', coalesce((
      select jsonb_agg(app.shift_json(s, 'staff') order by s.clock_in_at desc)
      from (select s.* from public.staff_shifts s where s.user_id = v_uid order by s.clock_in_at desc limit 10) s
    ), '[]'::jsonb),
    'months', coalesce((
      select jsonb_agg(app.worked_days_json(x.store_id, coalesce(p_month, (p_at at time zone 'Asia/Ho_Chi_Minh')::date), v_uid) || jsonb_build_object('store_id', x.store_id) order by x.store_id)
      from (select distinct s.store_id from public.staff_shifts s where s.user_id = v_uid
        and s.business_date >= date_trunc('month', coalesce(p_month, (p_at at time zone 'Asia/Ho_Chi_Minh')::date))::date
        and s.business_date < (date_trunc('month', coalesce(p_month, (p_at at time zone 'Asia/Ho_Chi_Minh')::date)) + interval '1 month')::date) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.staff_my_shift(date, timestamptz) is 'a member''s own shift that is not closed (without the expected cash while open: the count is blind), their last 10 shifts and their worked days of a month (this month by default) per store';

-- 7. The day's reconciliation (acceptance criterion 6) ----------------------------------------------------------

create function app.manager_day_reconciliation(p_store_id uuid, p_date date, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_revenue numeric;
  v_methods jsonb;
  v_online numeric;
  v_card numeric;
  v_cash_invoiced numeric;
  v_expected numeric;
  v_counted numeric;
  v_open integer;
  v_awaiting integer;
  v_unfinished numeric;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager']::public.tenant_role[]) then
    raise exception 'not an owner or manager of the store' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'a business date' using errcode = '22023';
  end if;
  select coalesce(sum(i.net_amount), 0) into v_revenue
  from public.invoices i join public.pos_accounts a on a.id = i.pos_account_id and a.connector = 'native'
  where i.store_id = v_store.id and i.business_date = p_date and i.status <> 'voided';
  select coalesce(jsonb_object_agg(x.method, x.amount), '{}'::jsonb) into v_methods
  from (
    select p.payment_method_external_id as method, sum(p.amount)::bigint as amount
    from public.invoice_payments p
    join public.invoices i on i.id = p.invoice_id
    join public.pos_accounts a on a.id = i.pos_account_id and a.connector = 'native'
    where i.store_id = v_store.id and i.business_date = p_date and i.status <> 'voided'
    group by p.payment_method_external_id
  ) x;
  v_card := coalesce((v_methods ->> 'card')::numeric, 0);
  v_cash_invoiced := coalesce((v_methods ->> 'cash')::numeric, 0);
  select coalesce(sum(p.amount), 0)
    - coalesce((select sum(r.amount) from public.order_refunds r join public.orders o2 on o2.id = r.order_id
        where o2.store_id = v_store.id and o2.business_date = p_date and o2.status = 'completed' and r.status = 'succeeded'
          and r.method in ('zalo_checkout', 'vietqr')), 0)
  into v_online
  from public.order_payments p join public.orders o on o.id = p.order_id
  where o.store_id = v_store.id and o.business_date = p_date and o.status = 'completed'
    and p.method in ('zalo_checkout', 'vietqr') and p.status = 'succeeded' and p.provider_ref is not null;
  select coalesce(sum(s.expected_cash - s.opening_cash), 0), coalesce(sum(s.counted_cash - s.opening_cash), 0),
    count(*) filter (where s.status = 'open'), count(*) filter (where s.status = 'awaiting_confirmation')
  into v_expected, v_counted, v_open, v_awaiting
  from public.staff_shifts s where s.store_id = v_store.id and s.business_date = p_date;
  v_expected := coalesce(v_expected, 0);
  v_counted := coalesce(v_counted, 0);
  select coalesce(sum(p.amount), 0) into v_unfinished
  from public.order_payments p join public.orders o on o.id = p.order_id
  where o.store_id = v_store.id and o.business_date = p_date and o.status not in ('completed', 'cancelled') and p.status = 'succeeded';
  return jsonb_build_object(
    'store_id', v_store.id,
    'business_date', p_date,
    'revenue', v_revenue::bigint,
    'by_method', v_methods,
    'online_confirmed', v_online::bigint,
    'card', v_card::bigint,
    'cash', jsonb_build_object('invoiced', v_cash_invoiced::bigint, 'expected', v_expected::bigint, 'counted', v_counted::bigint,
      'difference', (v_counted - v_expected)::bigint),
    'shifts_open', v_open,
    'shifts_awaiting_confirmation', v_awaiting,
    'paid_not_completed', v_unfinished::bigint,
    'difference', (v_revenue - v_online - v_card - v_counted)::bigint,
    'matched', v_revenue = v_online + v_card + v_counted and v_open = 0 and v_awaiting = 0
  );
end;
$$;

comment on function app.manager_day_reconciliation(uuid, date, timestamptz) is 'acceptance criterion 6 for a native store''s business day, for its owners and managers: the revenue of its native invoices, their payments by method, the online payments the provider confirmed (less confirmed online refunds), the card payments, and the cash the shifts of the day counted against what the counter recorded (opening cash left out); matched when the revenue equals the confirmed online payments, the card payments and the counted cash, and every shift of the day is closed; paid_not_completed explains cash taken for orders not completed yet';

-- 8. Public wrappers and grants ---------------------------------------------------------------------------------

create function public.staff_clock_in(p_store uuid, p_counter_token text, p_opening_cash numeric default 0)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.staff_clock_in(p_store, p_counter_token, p_opening_cash, now()); $$;
comment on function public.staff_clock_in(uuid, text, numeric) is 'RPC for the counter web app ("Vào ca"): app.staff_clock_in at the current time';

create function public.staff_clock_out(p_counted_cash numeric)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.staff_clock_out(p_counted_cash, now()); $$;
comment on function public.staff_clock_out(numeric) is 'RPC for the counter web app ("Ra ca"): app.staff_clock_out at the current time';

create function public.staff_my_shift(p_month date default null)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.staff_my_shift(p_month, now()); $$;
comment on function public.staff_my_shift(date) is 'RPC for the counter web app: app.staff_my_shift at the current time';

create function public.manager_counter_qr(p_store uuid, p_rotate boolean default false)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_counter_qr(p_store, p_rotate, now()); $$;
comment on function public.manager_counter_qr(uuid, boolean) is 'RPC for the manager app: app.manager_counter_qr at the current time';

create function public.manager_confirm_shift(p_shift uuid, p_note text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_confirm_shift(p_shift, p_note, now()); $$;
comment on function public.manager_confirm_shift(uuid, text) is 'RPC for the manager app: app.manager_confirm_shift at the current time';

create function public.manager_close_shift(p_shift uuid, p_clock_out_at timestamptz, p_counted_cash numeric, p_note text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.manager_close_shift(p_shift, p_clock_out_at, p_counted_cash, p_note, now()); $$;
comment on function public.manager_close_shift(uuid, timestamptz, numeric, text) is 'RPC for the manager app: app.manager_close_shift at the current time';

create function public.manager_shifts(p_store uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_shifts(p_store, p_from, p_to, now()); $$;
comment on function public.manager_shifts(uuid, date, date) is 'RPC for the manager app: app.manager_shifts at the current time';

create function public.manager_worked_days(p_store uuid, p_month date)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_worked_days(p_store, p_month, now()); $$;
comment on function public.manager_worked_days(uuid, date) is 'RPC for the manager app (S11): app.manager_worked_days at the current time';

create function public.manager_day_reconciliation(p_store uuid, p_date date)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.manager_day_reconciliation(p_store, p_date, now()); $$;
comment on function public.manager_day_reconciliation(uuid, date) is 'RPC for the manager app: app.manager_day_reconciliation at the current time';

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('counter_qr_token', 'shift_settings', 'shift_cash_flow', 'shift_json', 'shift_for_manager', 'staff_clock_in', 'staff_clock_out',
        'manager_counter_qr', 'manager_confirm_shift', 'manager_close_shift', 'manager_shifts', 'worked_days_rows', 'worked_days_json',
        'manager_worked_days', 'staff_my_shift', 'manager_day_reconciliation')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end;
$$;

revoke all on function public.staff_clock_in(uuid, text, numeric), public.staff_clock_out(numeric), public.staff_my_shift(date),
  public.manager_counter_qr(uuid, boolean), public.manager_confirm_shift(uuid, text), public.manager_close_shift(uuid, timestamptz, numeric, text),
  public.manager_shifts(uuid, date, date), public.manager_worked_days(uuid, date), public.manager_day_reconciliation(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_clock_in(uuid, text, numeric), public.staff_clock_out(numeric), public.staff_my_shift(date),
  public.manager_counter_qr(uuid, boolean), public.manager_confirm_shift(uuid, text), public.manager_close_shift(uuid, timestamptz, numeric, text),
  public.manager_shifts(uuid, date, date), public.manager_worked_days(uuid, date), public.manager_day_reconciliation(uuid, date)
  to authenticated;
