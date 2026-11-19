create type public.loyalty_programme_status as enum ('draft', 'active', 'paused', 'ended');
create type public.loyalty_notification_decision as enum ('pending', 'notified', 'below_threshold', 'not_required');

create function app.loyalty_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g');
begin
  if v_phone = '' then
    return null;
  end if;
  if v_phone like '00%' then
    v_phone := '+' || substr(v_phone, 3);
  elsif v_phone ~ '^0[1-9][0-9]{8,9}$' then
    v_phone := '+84' || substr(v_phone, 2);
  elsif v_phone ~ '^84[1-9][0-9]{8,9}$' then
    v_phone := '+' || v_phone;
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  return v_phone;
end;
$$;

comment on function app.loyalty_normalize_phone(text) is 'a phone number in E.164 form, or null when it cannot be read as one: spaces, dots, dashes and brackets dropped, 00 read as +, a national number with a leading 0 and the 84 country prefix without + read as Vietnamese';

create function app.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with metadata as (
    select (select auth.jwt()) -> 'app_metadata' as m
  ),
  claimed as (
    select
      case when m ->> 'customer_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (m ->> 'customer_id')::uuid end as customer_id,
      case when m ->> 'tenant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (m ->> 'tenant_id')::uuid end as tenant_id
    from metadata
    where m ->> 'kind' = 'customer'
  )
  select c.id
  from claimed
  join public.customers c on c.id = claimed.customer_id and c.tenant_id = claimed.tenant_id;
$$;

comment on function app.current_customer_id() is 'the customer of a customer session: the customers.id named by app_metadata.customer_id of a JWT whose app_metadata.kind is customer, when that customer belongs to app_metadata.tenant_id; null for every other session';

create function app.current_customer_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.tenant_id from public.customers c where c.id = app.current_customer_id();
$$;

comment on function app.current_customer_tenant_id() is 'the tenant of a customer session (see app.current_customer_id), null for every other session';

create function app.current_user_loyalty_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  where m.user_id = (select auth.uid())
    and m.role = any (array['owner', 'manager', 'viewer']::public.tenant_role[]);
$$;

comment on function app.current_user_loyalty_tenant_ids() is 'the tenants where the caller reads loyalty data: owners, managers and viewers; staff reach loyalty rows only through functions, the publisher never';

create function app.current_user_loyalty_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  where m.user_id = (select auth.uid())
    and m.role = any (array['owner', 'manager', 'viewer']::public.tenant_role[])
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

comment on function app.current_user_loyalty_store_ids() is 'the stores whose loyalty rows the caller reads: owners, managers and viewers within their store scope';

create function app.current_user_loyalty_manager_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  where m.user_id = (select auth.uid())
    and m.role = any (array['owner', 'manager']::public.tenant_role[])
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

comment on function app.current_user_loyalty_manager_store_ids() is 'the stores the caller manages for loyalty: owners and managers within their store scope';

create table public.loyalty_programmes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date,
  reward_budget_amount numeric(14, 2) not null default 0,
  status public.loyalty_programme_status not null default 'draft',
  stamps_per_card smallint not null default 8,
  stamp_min_bill_amount numeric(14, 2) not null default 50000,
  welcome_stamps smallint not null default 2,
  point_unit_amount numeric(14, 2) not null default 10000,
  points_per_unit smallint not null default 1,
  stamp_validity_months smallint not null default 6,
  points_expiry_months smallint not null default 12,
  earning_invoices_per_phone_per_day smallint not null default 3,
  checkin_window_before_minutes smallint not null default 2,
  checkin_window_after_minutes smallint not null default 15,
  checkin_code_ttl_seconds smallint not null default 120,
  checkin_pending_hours smallint not null default 24,
  receipt_claim_window_hours smallint not null default 72,
  receipt_claims_per_phone_per_day smallint not null default 3,
  excluded_order_sources text[] not null default '{}',
  point_value_amount numeric(14, 2) not null default 500,
  expected_breakage_rate numeric(4, 3) not null default 0.200,
  notification_decision public.loyalty_notification_decision not null default 'pending',
  notification_decided_at timestamptz,
  notification_basis text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

comment on table public.loyalty_programmes is 'one loyalty programme of a tenant with its period, reward budget, mechanic and anti-fraud parameters and the decision on the Department of Industry and Trade notification; every parameter is read at earn time, so a changed row changes the next earn';
comment on column public.loyalty_programmes.excluded_order_sources is 'order sources whose invoices never earn, matched against invoices.source_external_id or invoices.source_name';
comment on column public.loyalty_programmes.point_value_amount is 'value of one point in the tenant currency, used for the value at issue of each ledger row and for the liability';
comment on column public.loyalty_programmes.notification_basis is 'short legal basis of the notification decision; required when the decision is not_required';

create unique index loyalty_programmes_one_active_per_tenant_key
  on public.loyalty_programmes (tenant_id)
  where status = 'active';

create function app.loyalty_programme_problem(p public.loyalty_programmes)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_source text;
begin
  if p.name is null or char_length(btrim(p.name)) not between 1 and 120 or p.name ~ '[[:cntrl:]]' then
    return 'a loyalty programme name holds 1 to 120 characters without control characters';
  end if;
  if p.ends_on is not null and p.ends_on < p.starts_on then
    return 'a loyalty programme ends on or after the day it starts';
  end if;
  if p.reward_budget_amount < 0 then
    return 'reward_budget_amount is 0 or more';
  end if;
  if p.stamps_per_card not between 2 and 20 then
    return 'stamps_per_card is between 2 and 20';
  end if;
  if p.stamp_min_bill_amount not between 0 and 10000000 then
    return 'stamp_min_bill_amount is between 0 and 10,000,000';
  end if;
  if p.welcome_stamps < 0 or p.welcome_stamps >= p.stamps_per_card then
    return 'welcome_stamps is between 0 and one less than stamps_per_card';
  end if;
  if p.point_unit_amount not between 1000 and 1000000 then
    return 'point_unit_amount is between 1,000 and 1,000,000';
  end if;
  if p.points_per_unit not between 0 and 100 then
    return 'points_per_unit is between 0 and 100';
  end if;
  if p.stamp_validity_months not between 1 and 36 then
    return 'stamp_validity_months is between 1 and 36';
  end if;
  if p.points_expiry_months not between 1 and 60 then
    return 'points_expiry_months is between 1 and 60';
  end if;
  if p.earning_invoices_per_phone_per_day not between 1 and 20 then
    return 'earning_invoices_per_phone_per_day is between 1 and 20';
  end if;
  if p.checkin_window_before_minutes not between 0 and 30 then
    return 'checkin_window_before_minutes is between 0 and 30';
  end if;
  if p.checkin_window_after_minutes not between 1 and 120 then
    return 'checkin_window_after_minutes is between 1 and 120';
  end if;
  if p.checkin_code_ttl_seconds not between 30 and 600 then
    return 'checkin_code_ttl_seconds is between 30 and 600';
  end if;
  if p.checkin_pending_hours not between 1 and 168 then
    return 'checkin_pending_hours is between 1 and 168';
  end if;
  if p.receipt_claim_window_hours not between 1 and 720 then
    return 'receipt_claim_window_hours is between 1 and 720';
  end if;
  if p.receipt_claims_per_phone_per_day not between 1 and 20 then
    return 'receipt_claims_per_phone_per_day is between 1 and 20';
  end if;
  if cardinality(p.excluded_order_sources) > 50 then
    return 'excluded_order_sources holds at most 50 sources';
  end if;
  foreach v_source in array p.excluded_order_sources loop
    if v_source is null or char_length(btrim(v_source)) not between 1 and 100 then
      return 'each excluded order source holds 1 to 100 characters';
    end if;
  end loop;
  if p.point_value_amount not between 0 and 1000000 then
    return 'point_value_amount is between 0 and 1,000,000';
  end if;
  if p.expected_breakage_rate not between 0 and 0.9 then
    return 'expected_breakage_rate is between 0 and 0.9';
  end if;
  if p.notification_basis is not null and (char_length(btrim(p.notification_basis)) not between 1 and 500 or p.notification_basis ~ '[[:cntrl:]]') then
    return 'notification_basis holds 1 to 500 characters without control characters';
  end if;
  if p.notification_decision = 'not_required' and p.notification_basis is null then
    return 'a not_required notification decision needs its legal basis in notification_basis';
  end if;
  return null;
end;
$$;

comment on function app.loyalty_programme_problem(public.loyalty_programmes) is 'the first range or consistency rule a programme row breaks, as a message, or null when it keeps every rule; the zod schema loyaltyProgrammeSchema of @fnb/core holds the same ranges';

create function app.guard_loyalty_programme()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problem text;
begin
  new.name := btrim(new.name);
  new.notification_basis := nullif(btrim(new.notification_basis), '');
  new.excluded_order_sources := coalesce((select array_agg(btrim(s) order by o) from unnest(new.excluded_order_sources) with ordinality as u (s, o)), '{}'::text[]);
  if new.notification_decision = 'pending' then
    new.notification_decided_at := null;
  elsif tg_op = 'INSERT' or new.notification_decision is distinct from old.notification_decision then
    new.notification_decided_at := coalesce(new.notification_decided_at, now());
  elsif new.notification_decided_at is null then
    new.notification_decided_at := old.notification_decided_at;
  end if;
  v_problem := app.loyalty_programme_problem(new);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if new.status = 'active' and new.notification_decision = 'pending' then
    raise exception 'a loyalty programme cannot become active while its notification decision is pending' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger loyalty_programmes_guard
before insert or update on public.loyalty_programmes
for each row execute function app.guard_loyalty_programme();
create trigger loyalty_programmes_set_updated_at before update on public.loyalty_programmes for each row execute function app.set_updated_at();
create trigger loyalty_programmes_keep_created_by before update on public.loyalty_programmes for each row execute function app.keep_created_by();
create trigger loyalty_programmes_set_updated_by before insert or update on public.loyalty_programmes for each row execute function app.set_updated_by();

create table public.loyalty_staff_phones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  label text check (label is null or (char_length(label) between 1 and 100 and label !~ '[[:cntrl:]]')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

comment on table public.loyalty_staff_phones is 'the staff-phone exclusion list of a tenant: an invoice or a claim of one of these phones never earns; phones in E.164 form; read and written by owners and managers only, never shown to staff';

create function app.normalize_loyalty_staff_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := app.loyalty_normalize_phone(new.phone);
begin
  if v_phone is null then
    raise exception 'a staff phone is a phone number that reads in E.164 form' using errcode = '22023';
  end if;
  new.phone := v_phone;
  new.label := nullif(btrim(new.label), '');
  return new;
end;
$$;

create trigger loyalty_staff_phones_normalize
before insert or update on public.loyalty_staff_phones
for each row execute function app.normalize_loyalty_staff_phone();
create trigger loyalty_staff_phones_set_updated_at before update on public.loyalty_staff_phones for each row execute function app.set_updated_at();
create trigger loyalty_staff_phones_keep_created_by before update on public.loyalty_staff_phones for each row execute function app.keep_created_by();

alter table public.loyalty_programmes enable row level security;
alter table public.loyalty_staff_phones enable row level security;

create policy loyalty_programmes_select_for_data_members on public.loyalty_programmes
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    or (status <> 'draft' and tenant_id = (select app.current_customer_tenant_id()))
  );
create policy loyalty_programmes_insert_for_unlimited_managers on public.loyalty_programmes
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy loyalty_programmes_update_for_unlimited_managers on public.loyalty_programmes
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));
create policy loyalty_programmes_delete_for_unlimited_managers on public.loyalty_programmes
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[]));

create policy loyalty_staff_phones_select_for_managers on public.loyalty_staff_phones
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy loyalty_staff_phones_insert_for_managers on public.loyalty_staff_phones
  for insert to authenticated
  with check (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy loyalty_staff_phones_update_for_managers on public.loyalty_staff_phones
  for update to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]))
  with check (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy loyalty_staff_phones_delete_for_managers on public.loyalty_staff_phones
  for delete to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.loyalty_programmes, public.loyalty_staff_phones from anon;
grant select, insert, update, delete on public.loyalty_programmes, public.loyalty_staff_phones to authenticated;

revoke all on function app.loyalty_normalize_phone(text) from public, anon;
revoke all on function app.current_customer_id() from public, anon;
revoke all on function app.current_customer_tenant_id() from public, anon;
revoke all on function app.current_user_loyalty_tenant_ids() from public, anon;
revoke all on function app.current_user_loyalty_store_ids() from public, anon;
revoke all on function app.current_user_loyalty_manager_store_ids() from public, anon;
revoke all on function app.loyalty_programme_problem(public.loyalty_programmes) from public, anon;
revoke all on function app.guard_loyalty_programme() from public, anon, authenticated;
revoke all on function app.normalize_loyalty_staff_phone() from public, anon, authenticated;

grant execute on function app.loyalty_normalize_phone(text) to authenticated, service_role;
grant execute on function app.current_customer_id() to authenticated, service_role;
grant execute on function app.current_customer_tenant_id() to authenticated, service_role;
grant execute on function app.current_user_loyalty_tenant_ids() to authenticated, service_role;
grant execute on function app.current_user_loyalty_store_ids() to authenticated, service_role;
grant execute on function app.current_user_loyalty_manager_store_ids() to authenticated, service_role;
grant execute on function app.loyalty_programme_problem(public.loyalty_programmes) to authenticated, service_role;
