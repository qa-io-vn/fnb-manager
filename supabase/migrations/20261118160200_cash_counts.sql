insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('cash_count_variance', 'business', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"match_window_minutes": 60}',
    '{"match_window_minutes": {"type": "integer", "min": 15, "max": 360}}',
    interval '0', null, false, true, 190);

alter table public.alert_events drop constraint alert_events_source_check;
alter table public.alert_events
  add constraint alert_events_source_check check (source in ('incremental', 'nightly', 'cli', 'scheduler', 'notify', 'actions', 'webhook', 'operations'));

create function app.cash_denominations_valid(p_denominations jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry record;
begin
  if p_denominations is null then
    return true;
  end if;
  if jsonb_typeof(p_denominations) <> 'object' or (select count(*) from jsonb_object_keys(p_denominations)) not between 1 and 30 then
    return false;
  end if;
  for entry in select e.key, e.value from jsonb_each(p_denominations) as e loop
    if entry.key !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' or entry.key::numeric <= 0 then
      return false;
    end if;
    if jsonb_typeof(entry.value) <> 'number' or (entry.value #>> '{}')::numeric <> trunc((entry.value #>> '{}')::numeric)
       or (entry.value #>> '{}')::numeric not between 0 and 100000 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.cash_denominations_valid(jsonb) is 'whether a denomination breakdown is an object of 1 to 30 entries, each a positive face value as text (for example "500000" or "0.25") and a whole number of notes or coins from 0 to 100000';

create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  business_date date not null,
  shift_id uuid references public.shifts (id) on delete set null,
  counted_amount numeric(14, 2) not null check (counted_amount >= 0 and counted_amount < 1000000000000),
  denominations jsonb check (app.cash_denominations_valid(denominations)),
  note text check (note is null or (char_length(note) between 1 and 500 and translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]')),
  counted_at timestamptz not null default now(),
  anchor_at timestamptz not null,
  replaces_id uuid references public.cash_counts (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'reopened')),
  reopened_by uuid references auth.users (id) on delete set null,
  reopened_at timestamptz,
  matched_at timestamptz,
  evaluated_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'reopened') = (reopened_at is not null)),
  check (shift_id is null or matched_at is not null),
  unique (tenant_id, id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.cash_counts is 'the cash counted at shift close (FR-STF-16): the counted amount with an optional denomination breakdown, the counter (created_by) and the time; matched to the synced shift of the store whose close is nearest to the count, else waiting as chưa khớp ca; one active count per shift: a manager reopens a count (logged on the row) and the recount replaces it for the same shift; no POS shift name or cashier field is ever copied here';
comment on column public.cash_counts.business_date is 'the store''s business date at the count, then the matched shift''s business date (its opening under the store''s day start, as agg_shift_cash)';
comment on column public.cash_counts.anchor_at is 'the time matched against shift closes: counted_at for a first count, the replaced count''s anchor_at for a recount';
comment on column public.cash_counts.shift_id is 'the synced public.shifts row the count belongs to once matched (app.match_cash_counts), set by the database only';
comment on column public.cash_counts.evaluated_at is 'when the count was compared with the shift''s expected cash under the tenant''s thresholds (app.evaluate_cash_count); null while unmatched or while the shift''s figures are missing';

create unique index cash_counts_one_active_per_shift on public.cash_counts (shift_id) where status = 'active' and shift_id is not null;
create unique index cash_counts_one_replacement on public.cash_counts (replaces_id) where replaces_id is not null;
create index cash_counts_pending_idx on public.cash_counts (store_id) where status = 'active' and evaluated_at is null;
create index cash_counts_store_date_idx on public.cash_counts (store_id, business_date);
create index cash_counts_tenant_date_idx on public.cash_counts (tenant_id, business_date);
create index cash_counts_shift_idx on public.cash_counts (shift_id) where shift_id is not null;

create function app.shift_number(p_shift_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select nullif(count(x.id), 0)::integer
  from public.shifts s
  join public.stores st on st.id = s.store_id
  join public.shifts x
    on x.store_id = s.store_id
   and ((x.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date
     = ((s.opened_at at time zone st.timezone) - make_interval(mins => st.business_day_start_minutes))::date
   and (x.opened_at < s.opened_at or (x.opened_at = s.opened_at and x.external_id collate "C" <= s.external_id collate "C"))
  where s.id = p_shift_id;
$$;

comment on function app.shift_number(uuid) is 'n of the label Ca {n}: the shift''s place by opening time (then external id) among the shifts of its store and business date; null for a shift the caller cannot read; the POS shift name and cashier are never used';

create function app.cash_variance_test(
  p_store_id uuid,
  p_business_date date,
  p_variance numeric,
  p_cash_sales numeric,
  p_abs_threshold numeric,
  p_rel_threshold numeric
)
returns table (
  trailing_shifts integer,
  trailing_mean_variance numeric,
  trailing_stddev_variance numeric,
  z_score numeric,
  over_abs_threshold boolean,
  over_rel_threshold boolean,
  over_z_threshold boolean,
  reasons text[]
)
language sql
stable
set search_path = ''
as $$
  with history as (
    select
      count(*)::integer as trailing_shifts,
      round(avg(t.variance_amount), 2) as trailing_mean_variance,
      round(stddev_samp(t.variance_amount), 2) as trailing_stddev_variance
    from public.agg_shift_cash t
    where t.store_id = p_store_id
      and t.business_date between p_business_date - 56 and p_business_date - 1
      and t.variance_amount is not null
  ),
  scored as (
    select
      h.*,
      case
        when h.trailing_shifts >= 3 and h.trailing_stddev_variance > 0
        then round((p_variance - h.trailing_mean_variance) / h.trailing_stddev_variance, 3)
      end as z_score
    from history h
  ),
  flagged as (
    select
      sc.*,
      abs(p_variance) > p_abs_threshold as over_abs_threshold,
      p_cash_sales > 0 and abs(p_variance) > p_rel_threshold * p_cash_sales as over_rel_threshold,
      coalesce(abs(sc.z_score) > 2, false) as over_z_threshold
    from scored sc
  )
  select
    f.trailing_shifts,
    f.trailing_mean_variance,
    f.trailing_stddev_variance,
    f.z_score,
    f.over_abs_threshold,
    f.over_rel_threshold,
    f.over_z_threshold,
    array_remove(array[
      case when f.over_abs_threshold then 'absolute' end,
      case when f.over_rel_threshold then 'relative' end,
      case when f.over_z_threshold then 'z_score' end
    ], null)
  from flagged f;
$$;

comment on function app.cash_variance_test(uuid, date, numeric, numeric, numeric, numeric) is 'the phase 8 drawer-variance rule of app.shift_variance_scores applied to any variance of a store''s shift: absolute (strictly greater than the threshold), relative to the shift''s cash sales (strictly greater, only when there are cash sales) and the z-score over the store''s drawer variances of the 56 business days before (at least 3 shifts and a positive deviation, |z| > 2); security invoker, so the history is what the caller may read, as in Ca & két tiền';

create function app.match_cash_counts(p_store_id uuid, p_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_window interval;
  v_count record;
  v_shift record;
  v_matched integer := 0;
begin
  select s.tenant_id into v_tenant_id from public.stores s where s.id = p_store_id;
  if v_tenant_id is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-cash-counts:' || p_store_id::text, 0));
  select make_interval(mins => coalesce((r.params ->> 'match_window_minutes')::integer, 60)) into v_window
  from app.effective_alert_rule(v_tenant_id, p_store_id, 'cash_count_variance') r;
  v_window := coalesce(v_window, interval '60 minutes');
  for v_count in
    select c.id, c.anchor_at
    from public.cash_counts c
    where c.store_id = p_store_id
      and c.status = 'active'
      and c.shift_id is null
    order by c.anchor_at, c.id
    for update of c
  loop
    select sh.id, sh.opened_at into v_shift
    from public.shifts sh
    where sh.store_id = p_store_id
      and sh.closed_at is not null
      and sh.opened_at <= v_count.anchor_at
      and sh.closed_at between v_count.anchor_at - v_window and v_count.anchor_at + v_window
    order by abs(extract(epoch from sh.closed_at - v_count.anchor_at)), sh.closed_at desc, sh.id
    limit 1;
    continue when not found;
    continue when exists (
      select 1 from public.cash_counts o where o.shift_id = v_shift.id
    );
    update public.cash_counts c
    set shift_id = v_shift.id,
        matched_at = p_at,
        business_date = app.store_business_date(p_store_id, v_shift.opened_at)
    where c.id = v_count.id;
    v_matched := v_matched + 1;
  end loop;
  return v_matched;
end;
$$;

comment on function app.match_cash_counts(uuid, timestamptz) is 'matches the store''s active unmatched counts, oldest first, each to the closed shift of the store that opened before the count and whose close is nearest to the count''s anchor within the cash_count_variance rule''s match_window_minutes (60 by default); when that nearest shift already has a count, active or reopened, the count stays unmatched (a shift is counted again only by a recount that replaces its reopened count); the count takes the shift''s business date; serialised per store; returns the number matched';

create function app.evaluate_cash_count(p_cash_count_id uuid, p_at timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count public.cash_counts;
  v_shift public.agg_shift_cash;
  v_abs numeric;
  v_rel numeric;
  v_variance numeric;
  v_test record;
  v_recounts integer;
begin
  select c.* into v_count from public.cash_counts c where c.id = p_cash_count_id;
  if not found or v_count.status <> 'active' then
    return 'skipped';
  end if;
  if v_count.shift_id is null then
    return 'unmatched';
  end if;
  select a.* into v_shift from public.agg_shift_cash a where a.shift_id = v_count.shift_id;
  if not found or v_shift.expected_cash_amount is null then
    return 'pending';
  end if;
  select coalesce(max(r.cash_abs_threshold), 50000), coalesce(max(r.cash_rel_threshold), 0.0050)
  into v_abs, v_rel
  from public.report_settings r
  where r.tenant_id = v_count.tenant_id;
  v_variance := v_count.counted_amount - v_shift.expected_cash_amount;
  select t.* into v_test
  from app.cash_variance_test(v_count.store_id, v_shift.business_date, v_variance, v_shift.cash_sales_amount, v_abs, v_rel) t;
  update public.cash_counts c set evaluated_at = p_at where c.id = v_count.id;
  if v_test.over_abs_threshold or v_test.over_rel_threshold or v_test.over_z_threshold then
    select count(*)::integer into v_recounts
    from public.cash_counts o
    where o.store_id = v_count.store_id
      and o.anchor_at = v_count.anchor_at
      and o.status = 'reopened';
    perform app.raise_alert(
      v_count.tenant_id,
      'cash_count_variance',
      'shift:' || v_count.shift_id::text,
      'operations',
      p_at,
      v_count.store_id,
      null,
      null,
      v_shift.business_date,
      jsonb_build_object(
        'shift_number', app.shift_number(v_count.shift_id),
        'over_abs', v_test.over_abs_threshold,
        'over_rel', v_test.over_rel_threshold,
        'over_z', v_test.over_z_threshold,
        'shortfall', v_variance < 0,
        'recounts', v_recounts
      ),
      null,
      false
    );
    return 'over';
  end if;
  update public.alert_events e
  set state = 'resolved',
      resolved_at = p_at,
      resolution = 'cleared'
  where e.tenant_id = v_count.tenant_id
    and e.dedupe_key = 'cash_count_variance:shift:' || v_count.shift_id::text
    and e.state = 'open';
  return 'within';
end;
$$;

comment on function app.evaluate_cash_count(uuid, timestamptz) is 'compares an active matched count with its shift''s expected cash (agg_shift_cash.expected_cash_amount: opening float plus cash payments) under the tenant''s report_settings thresholds and the rule of app.cash_variance_test; over: raise_alert cash_count_variance with the subject shift:<shift id>, so a second count of the shift reuses the open episode, and count-only facts (shift_number, over_abs, over_rel, over_z, shortfall, recounts: no amount, no name); within: resolves the shift''s open episode as cleared; returns skipped, unmatched, pending (no figures yet, evaluated at a later refresh), over or within';

create function app.process_cash_counts(p_store_id uuid, p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_evaluated integer := 0;
  v_outcome text;
begin
  perform app.match_cash_counts(p_store_id, p_at);
  for v_id in
    select c.id
    from public.cash_counts c
    where c.store_id = p_store_id
      and c.status = 'active'
      and c.shift_id is not null
      and c.evaluated_at is null
    order by c.anchor_at, c.id
  loop
    v_outcome := app.evaluate_cash_count(v_id, p_at);
    if v_outcome in ('over', 'within') then
      v_evaluated := v_evaluated + 1;
    end if;
  end loop;
  return v_evaluated;
end;
$$;

comment on function app.process_cash_counts(uuid, timestamptz) is 'matches the store''s waiting counts and evaluates every matched count not yet evaluated; run when a count is saved and after each analytics refresh that writes the store''s shifts; returns the number evaluated';

create function app.prepare_cash_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replaced public.cash_counts;
begin
  if not app.cash_denominations_valid(new.denominations) then
    raise exception 'a breakdown is {"<face value>": <whole count>, ...} with 1 to 30 entries' using errcode = '23514';
  end if;
  if new.denominations is not null
     and (select coalesce(sum(e.key::numeric * (e.value #>> '{}')::numeric), 0) from jsonb_each(new.denominations) as e) <> new.counted_amount then
    raise exception 'the denominations do not add up to the counted amount' using errcode = '23514';
  end if;
  new.counted_at := now();
  new.created_at := now();
  new.updated_at := now();
  new.status := 'active';
  new.reopened_by := null;
  new.reopened_at := null;
  new.evaluated_at := null;
  if new.replaces_id is not null then
    select c.* into v_replaced
    from public.cash_counts c
    where c.id = new.replaces_id
    for update;
    if not found or v_replaced.tenant_id <> new.tenant_id or v_replaced.store_id <> new.store_id or v_replaced.status <> 'reopened' then
      raise exception 'a recount replaces a reopened count of the same store' using errcode = '22023';
    end if;
    new.shift_id := v_replaced.shift_id;
    new.matched_at := case when v_replaced.shift_id is not null then now() end;
    new.business_date := v_replaced.business_date;
    new.anchor_at := v_replaced.anchor_at;
  else
    new.shift_id := null;
    new.matched_at := null;
    new.anchor_at := now();
    new.business_date := app.store_business_date(new.store_id, now());
  end if;
  return new;
end;
$$;

comment on function app.prepare_cash_count() is 'trigger before a count is inserted: the denominations add up to the amount (23514); the count time is now; a recount must replace a reopened count of the same store (22023) and takes its shift, business date and anchor; a first count anchors at now under the store''s business date';

create function app.after_cash_count_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.process_cash_counts(new.store_id, now());
  return null;
end;
$$;

comment on function app.after_cash_count_insert() is 'trigger after a count is inserted: matches and evaluates the store''s waiting counts at once, so a count of a shift already synced alerts in the same request';

create function app.guard_cash_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.store_id, new.counted_amount, new.denominations, new.note, new.counted_at, new.anchor_at,
      new.replaces_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.store_id, old.counted_amount, old.denominations, old.note, old.counted_at, old.anchor_at,
      old.replaces_id, old.created_by, old.created_at) then
    raise exception 'a count never changes; a manager reopens it and the store counts again' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (old.status = 'active' and new.status = 'reopened') then
    raise exception 'a reopened count stays reopened' using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function app.guard_cash_count() is 'trigger before a count is updated: the amount, breakdown, note, times, replacement and counter never change and the status only goes from active to reopened (55000); matching and evaluation set shift_id, matched_at, business_date and evaluated_at';

create function app.process_cash_counts_after_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  for v_store_id in
    select distinct n.store_id
    from refreshed n
    where exists (
      select 1 from public.cash_counts c where c.store_id = n.store_id and c.status = 'active' and c.evaluated_at is null
    )
  loop
    perform app.process_cash_counts(v_store_id, now());
  end loop;
  return null;
end;
$$;

comment on function app.process_cash_counts_after_refresh() is 'trigger after agg_shift_cash rows are written by an analytics refresh (each incremental and nightly sync): processes the waiting counts of every store the statement wrote, so a count saved before its shift''s close was synced is matched and evaluated in that sync''s cycle';

create trigger cash_counts_prepare before insert on public.cash_counts for each row execute function app.prepare_cash_count();
create trigger cash_counts_process after insert on public.cash_counts for each row execute function app.after_cash_count_insert();
create trigger cash_counts_guard before update on public.cash_counts for each row execute function app.guard_cash_count();
create trigger cash_counts_set_updated_at before update on public.cash_counts for each row execute function app.set_updated_at();
create trigger cash_counts_keep_created_by before update on public.cash_counts for each row execute function app.keep_created_by();
create trigger agg_shift_cash_process_cash_counts
after insert on public.agg_shift_cash
referencing new table as refreshed
for each statement execute function app.process_cash_counts_after_refresh();

alter table public.cash_counts enable row level security;

create policy cash_counts_select_for_operations on public.cash_counts
  for select to authenticated
  using (
    store_id = any ((select app.current_user_ops_store_ids())::uuid[])
    and (created_by = (select auth.uid()) or store_id = any ((select app.current_user_revenue_store_ids())::uuid[]))
  );
create policy cash_counts_insert_own on public.cash_counts
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy cash_counts_update_own_or_managed on public.cash_counts
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy cash_counts_delete_managed on public.cash_counts
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

revoke all on public.cash_counts from anon, authenticated;
grant select on public.cash_counts to authenticated;
grant insert (tenant_id, store_id, counted_amount, denominations, note, replaces_id) on public.cash_counts to authenticated;

create function app.reopen_cash_count(p_cash_count_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.cash_counts;
begin
  select c.* into v_row
  from public.cash_counts c
  where c.id = p_cash_count_id
  for update;
  if not found or not app.ops_can_manage(v_row.tenant_id, v_row.store_id) then
    raise exception 'the count cannot be reopened by this member' using errcode = '42501';
  end if;
  if v_row.status = 'active' then
    update public.cash_counts c
    set status = 'reopened',
        reopened_by = (select auth.uid()),
        reopened_at = now()
    where c.id = v_row.id
    returning c.* into v_row;
  end if;
  return jsonb_build_object(
    'cash_count_id', v_row.id, 'status', v_row.status, 'shift_id', v_row.shift_id,
    'reopened_by', v_row.reopened_by, 'reopened_at', v_row.reopened_at
  );
end;
$$;

comment on function app.reopen_cash_count(uuid) is 'reopens an active count as an owner or manager of its store (42501 otherwise), logging who and when on the row: the shift is free for one recount, which names this count in replaces_id; the shift''s open alert episode stays until the recount is evaluated; a reopened count is returned as it is';

create function public.reopen_cash_count(p_cash_count_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select app.reopen_cash_count(p_cash_count_id);
$$;

comment on function public.reopen_cash_count(uuid) is 'RPC: app.reopen_cash_count';

create function public.record_cash_count(
  p_store_id uuid,
  p_counted_amount numeric,
  p_denominations jsonb default null,
  p_note text default null,
  p_replaces_id uuid default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
  v_row public.cash_counts;
begin
  select s.tenant_id into v_tenant_id from public.stores s where s.id = p_store_id;
  if v_tenant_id is null or not app.ops_can_write_own(v_tenant_id, p_store_id) then
    raise exception 'the count cannot be recorded at this store by this member' using errcode = '42501';
  end if;
  begin
    insert into public.cash_counts (tenant_id, store_id, counted_amount, denominations, note, replaces_id)
    values (v_tenant_id, p_store_id, p_counted_amount, p_denominations, nullif(btrim(p_note), ''), p_replaces_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'the reopened count already has its recount' using errcode = '23505';
  end;
  select c.* into v_row from public.cash_counts c where c.id = v_id;
  return jsonb_build_object(
    'cash_count_id', v_row.id,
    'business_date', v_row.business_date,
    'counted_at', v_row.counted_at,
    'status', v_row.status,
    'matched', v_row.shift_id is not null
  );
end;
$$;

comment on function public.record_cash_count(uuid, numeric, jsonb, text, uuid) is 'records the cash counted at a shift close at a store in the caller''s operations scope (42501 otherwise), with an optional breakdown that must add up (23514) and a note; p_replaces_id names the reopened count a recount replaces (22023 when it is not one, 23505 when it already has a recount); the count is matched and evaluated at once; returns {cash_count_id, business_date, counted_at, status, matched} and never the expected cash or the difference';

create function public.cash_count_review(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  business_date date,
  shift_id uuid,
  shift_number integer,
  opened_at timestamptz,
  closed_at timestamptz,
  cash_count_id uuid,
  counted_amount numeric,
  counted_by uuid,
  counted_at timestamptz,
  recounts integer,
  expected_cash_amount numeric,
  drawer_amount numeric,
  cash_sales_amount numeric,
  variance_amount numeric,
  drawer_variance_amount numeric,
  trailing_shifts integer,
  z_score numeric,
  over_abs_threshold boolean,
  over_rel_threshold boolean,
  over_z_threshold boolean,
  reasons text[],
  state text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  returned_rows bigint;
begin
  perform app.require_store_ids('cash_count_review', cash_count_review.store_ids);
  perform app.require_date_range('cash_count_review', cash_count_review.from_date, cash_count_review.to_date, max_range_days);

  return query
  with settings as (
    select r.store_id, r.cash_abs_threshold, r.cash_rel_threshold
    from app.store_report_settings(cash_count_review.store_ids) with ordinality as r (
      store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
      cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
      promo_pre_weeks, settings_position
    )
  ),
  shift_rows as (
    select
      a.store_id, a.business_date, a.shift_id, a.opened_at, a.closed_at, a.cash_sales_amount, a.expected_cash_amount,
      a.drawer_amount, a.variance_amount,
      row_number() over (partition by a.store_id, a.business_date order by a.opened_at, a.shift_external_id collate "C")::integer as shift_number
    from public.agg_shift_cash a
    where a.store_id = any (cash_count_review.store_ids)
      and a.business_date between cash_count_review.from_date and cash_count_review.to_date
  ),
  counts as (
    select
      c.*,
      (select count(*)::integer from public.cash_counts o where o.store_id = c.store_id and o.anchor_at = c.anchor_at and o.status = 'reopened') as recounts
    from public.cash_counts c
    where c.store_id = any (cash_count_review.store_ids)
      and c.status = 'active'
      and c.business_date between cash_count_review.from_date and cash_count_review.to_date
  ),
  joined as (
    select
      coalesce(s.store_id, c.store_id) as store_id,
      coalesce(s.business_date, c.business_date) as business_date,
      coalesce(s.shift_id, c.shift_id) as shift_id,
      s.shift_number,
      s.opened_at,
      s.closed_at,
      c.id as cash_count_id,
      c.counted_amount,
      c.created_by as counted_by,
      c.counted_at,
      c.recounts,
      s.expected_cash_amount,
      s.drawer_amount,
      s.cash_sales_amount,
      case when c.id is not null and s.shift_id is not null then c.counted_amount - s.expected_cash_amount end as variance_amount,
      s.variance_amount as drawer_variance_amount,
      s.shift_id is not null as shift_visible
    from shift_rows s
    full join counts c on c.shift_id = s.shift_id
  )
  select
    j.store_id,
    j.business_date,
    j.shift_id,
    j.shift_number,
    j.opened_at,
    j.closed_at,
    j.cash_count_id,
    j.counted_amount,
    j.counted_by,
    j.counted_at,
    j.recounts,
    j.expected_cash_amount,
    j.drawer_amount,
    j.cash_sales_amount,
    j.variance_amount,
    j.drawer_variance_amount,
    t.trailing_shifts,
    t.z_score,
    coalesce(t.over_abs_threshold, false),
    coalesce(t.over_rel_threshold, false),
    coalesce(t.over_z_threshold, false),
    coalesce(t.reasons, '{}'::text[]),
    case
      when j.cash_count_id is null then 'no_count'
      when j.shift_id is null then 'unmatched'
      when not j.shift_visible then 'recorded'
      when j.variance_amount is null then 'no_reference'
      when t.over_abs_threshold or t.over_rel_threshold or t.over_z_threshold then 'over'
      else 'within'
    end
  from joined j
  left join settings st on st.store_id = j.store_id
  left join lateral app.cash_variance_test(
    j.store_id, j.business_date, j.variance_amount, j.cash_sales_amount, st.cash_abs_threshold, st.cash_rel_threshold
  ) t on j.variance_amount is not null
  order by j.business_date, j.store_id, j.opened_at nulls last, j.counted_at nulls last, j.cash_count_id;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('cash_count_review', returned_rows);
end;
$$;

comment on function public.cash_count_review(uuid[], date, date) is 'the counted cash per shift for #224 and #225: every synced shift of the stores and dates the caller may read (Ca {n} by opening order, never the POS name or cashier) with its active count, plus counts not matched yet; the expected cash, POS drawer, cash sales, the difference counted minus expected and the flags of the rule of Ca & két tiền under the tenant''s thresholds; state no_count, unmatched, recorded (the caller may not read the shift''s figures, as staff without revenue visibility all), no_reference, over or within; at most 92 days and 900 rows';

revoke all on function app.cash_denominations_valid(jsonb) from public, anon;
revoke all on function app.shift_number(uuid) from public, anon;
revoke all on function app.cash_variance_test(uuid, date, numeric, numeric, numeric, numeric) from public, anon;
revoke all on function app.match_cash_counts(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.evaluate_cash_count(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.process_cash_counts(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.prepare_cash_count() from public, anon, authenticated, service_role;
revoke all on function app.after_cash_count_insert() from public, anon, authenticated, service_role;
revoke all on function app.guard_cash_count() from public, anon, authenticated, service_role;
revoke all on function app.process_cash_counts_after_refresh() from public, anon, authenticated, service_role;
revoke all on function app.reopen_cash_count(uuid) from public, anon, service_role;
revoke all on function public.reopen_cash_count(uuid) from public, anon, service_role;
revoke all on function public.record_cash_count(uuid, numeric, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.cash_count_review(uuid[], date, date) from public, anon;

grant execute on function app.cash_denominations_valid(jsonb) to authenticated, service_role;
grant execute on function app.shift_number(uuid) to authenticated, service_role;
grant execute on function app.cash_variance_test(uuid, date, numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function app.process_cash_counts(uuid, timestamptz) to service_role;
grant execute on function app.reopen_cash_count(uuid) to authenticated;
grant execute on function public.reopen_cash_count(uuid) to authenticated;
grant execute on function public.record_cash_count(uuid, numeric, jsonb, text, uuid) to authenticated;
grant execute on function public.cash_count_review(uuid[], date, date) to authenticated, service_role;
