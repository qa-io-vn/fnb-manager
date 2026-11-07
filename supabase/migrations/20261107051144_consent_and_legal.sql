create type public.consent_subject as enum ('customer', 'staff');
create type public.consent_purpose as enum ('loyalty', 'marketing', 'staff_ops');
create type public.dsr_type as enum ('access', 'correction', 'deletion', 'export', 'objection', 'withdraw_consent');
create type public.dsr_status as enum ('received', 'in_progress', 'completed', 'rejected');

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject_type public.consent_subject not null,
  subject_id uuid not null,
  purpose public.consent_purpose not null,
  policy_version text not null,
  channel text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz check (revoked_at is null or revoked_at >= granted_at),
  evidence jsonb,
  created_at timestamptz not null default now()
);

comment on column public.consent_records.subject_id is 'customers.id when subject_type is customer, tenant_members.user_id when subject_type is staff; no foreign key so the record outlives the subject row';
comment on column public.consent_records.channel is 'where the consent was captured, for example mini_app, oa_form, till or web';

create index consent_records_subject_purpose_idx
  on public.consent_records (tenant_id, subject_type, subject_id, purpose);
create unique index consent_records_one_active_per_subject_purpose_key
  on public.consent_records (tenant_id, subject_type, subject_id, purpose)
  where revoked_at is null;

create or replace function app.keep_consent_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.subject_type is distinct from old.subject_type
    or new.subject_id is distinct from old.subject_id
    or new.purpose is distinct from old.purpose
    or new.policy_version is distinct from old.policy_version
    or new.channel is distinct from old.channel
    or new.granted_at is distinct from old.granted_at
    or new.evidence is distinct from old.evidence
    or new.created_at is distinct from old.created_at
  then
    raise exception 'consent_records is an append-only ledger: only revoked_at may change';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'consent_records revocation is final: revoked_at cannot be cleared or moved once set';
  end if;
  if new.revoked_at is not null and new.revoked_at < new.granted_at then
    raise exception 'consent_records revocation cannot precede the grant';
  end if;
  return new;
end;
$$;

revoke all on function app.keep_consent_grant() from public;

create trigger consent_records_keep_grant
before update on public.consent_records
for each row execute function app.keep_consent_grant();

create or replace function app.has_active_consent(tenant uuid, subject_type public.consent_subject, subject uuid, purpose public.consent_purpose)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.consent_records c
    where c.tenant_id = has_active_consent.tenant
      and c.subject_type = has_active_consent.subject_type
      and c.subject_id = has_active_consent.subject
      and c.purpose = has_active_consent.purpose
      and c.revoked_at is null
  );
$$;

create or replace function app.dsr_deadlines(received timestamptz, country_code text, time_zone text, uses_processor boolean)
returns table (first_response_due_at timestamptz, completion_due_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  scan_window_days constant integer := 120;
  days_to_second_working_day integer;
begin
  with received_day as (
    select (dsr_deadlines.received at time zone dsr_deadlines.time_zone)::date as local_date
  ),
  following_days as (
    select r.local_date + n as calendar_day, n as days_after
    from received_day r
    cross join generate_series(1, scan_window_days) as n
  ),
  working_days as (
    select d.days_after, row_number() over (order by d.calendar_day) as working_day_no
    from following_days d
    where extract(isodow from d.calendar_day) < 6
      and not exists (
        select 1
        from public.holidays h
        where h.tenant_id is null
          and h.country_code = dsr_deadlines.country_code
          and h.holiday_date = d.calendar_day
      )
  )
  select w.days_after
  into days_to_second_working_day
  from working_days w
  where w.working_day_no = 2;
  if days_to_second_working_day is null then
    raise exception 'dsr_deadlines found no second working day for country % within % days after %', dsr_deadlines.country_code, scan_window_days, dsr_deadlines.received;
  end if;
  first_response_due_at := dsr_deadlines.received + make_interval(days => days_to_second_working_day);
  completion_due_at := dsr_deadlines.received + make_interval(days => case when dsr_deadlines.uses_processor then 30 else 20 end);
  return next;
end;
$$;

revoke all on function app.has_active_consent(uuid, public.consent_subject, uuid, public.consent_purpose) from public;
revoke all on function app.dsr_deadlines(timestamptz, text, text, boolean) from public;
grant execute on function app.has_active_consent(uuid, public.consent_subject, uuid, public.consent_purpose) to authenticated, service_role;
grant execute on function app.dsr_deadlines(timestamptz, text, text, boolean) to authenticated, service_role;

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject_type public.consent_subject not null,
  subject_id uuid,
  contact text not null,
  request_type public.dsr_type not null,
  received_at timestamptz not null default now(),
  uses_processor boolean not null default false,
  first_response_due_at timestamptz not null,
  completion_due_at timestamptz not null,
  status public.dsr_status not null default 'received',
  handled_by uuid references auth.users (id) on delete set null,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.data_subject_requests.uses_processor is 'true when a processor handles the data for this request, which extends the completion deadline from 20 to 30 calendar days';

create index data_subject_requests_tenant_status_due_idx
  on public.data_subject_requests (tenant_id, status, completion_due_at);

create or replace function app.fill_dsr_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant_country_code text;
  tenant_time_zone text;
  computed record;
begin
  if new.first_response_due_at is not null and new.completion_due_at is not null then
    return new;
  end if;
  select t.country_code, t.timezone
  into tenant_country_code, tenant_time_zone
  from public.tenants t
  where t.id = new.tenant_id;
  select *
  into computed
  from app.dsr_deadlines(new.received_at, tenant_country_code, tenant_time_zone, new.uses_processor);
  new.first_response_due_at := coalesce(new.first_response_due_at, computed.first_response_due_at);
  new.completion_due_at := coalesce(new.completion_due_at, computed.completion_due_at);
  return new;
end;
$$;

revoke all on function app.fill_dsr_deadlines() from public;

create trigger data_subject_requests_fill_deadlines
before insert on public.data_subject_requests
for each row execute function app.fill_dsr_deadlines();

create trigger data_subject_requests_set_updated_at
before update on public.data_subject_requests
for each row execute function app.set_updated_at();

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null,
  recipient_ref text not null,
  subject_type public.consent_subject,
  subject_id uuid,
  purpose public.consent_purpose,
  template_ref text,
  consent_record_id uuid references public.consent_records (id) on delete set null,
  sent_at timestamptz not null default now(),
  status text not null,
  provider_message_id text,
  cost_amount numeric(14, 2),
  raw jsonb
);

comment on column public.outbound_messages.recipient_ref is 'opaque reference to the recipient such as a hashed phone or a platform user id, never the raw phone number';

create index outbound_messages_tenant_sent_at_idx on public.outbound_messages (tenant_id, sent_at);
create index outbound_messages_tenant_subject_idx on public.outbound_messages (tenant_id, subject_type, subject_id);
