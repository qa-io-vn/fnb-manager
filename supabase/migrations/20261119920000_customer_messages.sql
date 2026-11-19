do $$
declare
  current_kinds text[];
  wanted text[];
begin
  select array_agg(m.kind order by m.position)
  into current_kinds
  from (
    select distinct on (x.match[1]) x.match[1] as kind, x.position
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') with ordinality as x (match, position)
    where c.conrelid = 'public.outbound_messages'::regclass
      and c.conname = 'outbound_messages_kind_check'
    order by x.match[1], x.position
  ) m;
  wanted := coalesce(current_kinds, '{}'::text[]);
  wanted := wanted || array(
    select k
    from unnest(array['points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back']) with ordinality as n (k, position)
    where not (k = any (wanted))
    order by n.position
  );
  execute 'alter table public.outbound_messages drop constraint if exists outbound_messages_kind_check';
  execute format(
    'alter table public.outbound_messages add constraint outbound_messages_kind_check check (kind is null or kind in (%s))',
    (select string_agg(quote_literal(k), ', ' order by n.position) from unnest(wanted) with ordinality as n (k, position))
  );
end;
$$;

alter table public.outbound_messages drop constraint outbound_messages_queue_shape;
alter table public.outbound_messages
  add constraint outbound_messages_queue_shape check (
    kind is null
    or (
      message_class is not null
      and dedupe_key is not null
      and (
        channel_id is not null
        or status in ('sending', 'sent', 'delivered', 'failed', 'cancelled', 'uncertain')
        or (subject_type = 'customer' and kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back'))
      )
    )
  );

alter table public.outbound_messages
  add constraint outbound_messages_customer_shape check (
    kind is null
    or kind not in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder', 'birthday', 'win_back')
    or (
      subject_type = 'customer'
      and channel_id is null
      and channel in ('mini_app', 'zalo_oa', 'zalo_zbs')
      and title is null
      and body is null
      and (recipient_ref = 'redacted' or recipient_ref ~ '^membership:[0-9a-f-]{36}$')
    )
  );

comment on constraint outbound_messages_customer_shape on public.outbound_messages is 'a customer message (points_confirmed, coupon_issued, voucher_expiring, expiry_reminder, birthday, win_back) has a customer subject, no destination row, the channel mini_app, zalo_oa or zalo_zbs, an opaque membership:<id> recipient and never a title or body: personal parameters are resolved at send time and never stored (NFR-PRV-02)';

create index outbound_messages_customer_activity_idx
  on public.outbound_messages (tenant_id, subject_id, channel, (coalesce(sent_at, claimed_at)))
  where subject_type = 'customer' and channel_id is null and status in ('sending', 'sent', 'delivered', 'uncertain');

create index outbound_messages_customer_due_idx
  on public.outbound_messages ((coalesce(not_before, created_at)))
  where subject_type = 'customer' and channel_id is null and status in ('queued', 'held');

create index oa_events_oa_user_idx on public.oa_events (oa_id, oa_user_id, occurred_at desc) where oa_user_id is not null;

create table app.customer_message_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  points_route text not null default 'free' check (points_route in ('off', 'in_app', 'free', 'template')),
  coupon_route text not null default 'template' check (coupon_route in ('off', 'in_app', 'free', 'template')),
  voucher_expiring_route text not null default 'template' check (voucher_expiring_route in ('off', 'in_app', 'free', 'template')),
  expiry_route text not null default 'template' check (expiry_route in ('off', 'in_app', 'free', 'template')),
  voucher_expiring_hours smallint not null default 24 check (voucher_expiring_hours between 1 and 168),
  expiry_reminder_days smallint not null default 7 check (expiry_reminder_days between 1 and 60),
  promotions_enabled boolean not null default false,
  win_back_days smallint not null default 45 check (win_back_days between 14 and 365),
  free_window_hours smallint not null default 48 check (free_window_hours between 1 and 48),
  out_of_window_monthly_quota integer not null default 0 check (out_of_window_monthly_quota between 0 and 100000),
  zbs_enabled boolean not null default false,
  zbs_daily_quota integer not null default 1000 check (zbs_daily_quota between 1 and 1000000),
  reminders_scanned_on date,
  updated_at timestamptz not null default now()
);

comment on table app.customer_message_settings is 'per tenant, how loyalty events reach customers (FR-NOT-39, ADR-018): off by default; each event''s route is off, in_app (the wallet only), free (the free OA consultation message inside the window, else in-app) or template (consultation inside the window, else a paid ZBS template); birthday and win-back only with promotions_enabled; ZBS only with zbs_enabled and an approved template; written by the CLI as postgres, read by no API role';
comment on column app.customer_message_settings.free_window_hours is 'hours after the customer''s last OA interaction in which a consultation message is free (48 since 1 January 2026)';
comment on column app.customer_message_settings.out_of_window_monthly_quota is 'consultation messages per OA and tenant-local month allowed after the free window and inside the API''s 7-day window (the package''s out-of-window allowance); 0 sends a template instead';
comment on column app.customer_message_settings.zbs_daily_quota is 'template messages per OA and tenant-local day before the next one waits for the next day, at or below the ZBS daily quota tier';
comment on column app.customer_message_settings.reminders_scanned_on is 'the tenant-local day of the last expiry and win-back scan, so it runs once a day';

create table app.customer_oa_contacts (
  tenant_id uuid not null,
  oa_id uuid not null,
  customer_id uuid not null,
  oa_user_id text not null check (oa_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  linked_at timestamptz not null default now(),
  primary key (oa_id, customer_id),
  unique (oa_id, oa_user_id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);

create index customer_oa_contacts_customer_idx on app.customer_oa_contacts (tenant_id, customer_id);

comment on table app.customer_oa_contacts is 'the OA user id (the follower id the OA sees, never the Mini App''s per-app id) of a customer, per OA; written by app.link_customer_oa_user when the OA enrolment or a webhook event ties the two together; deleted with the customer; read by no API role';

create function app.customer_message_class(p_kind text)
returns public.message_class
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('points_confirmed', 'coupon_issued', 'voucher_expiring', 'expiry_reminder') then 'transactional'::public.message_class
    when p_kind in ('birthday', 'win_back') then 'advertising'::public.message_class
  end;
$$;

comment on function app.customer_message_class(text) is 'the message class of a customer message kind: transactional for points_confirmed, coupon_issued, voucher_expiring and expiry_reminder, advertising for birthday and win_back, null for any other kind';

create function app.customer_message_route_setting(p_tenant_id uuid, p_kind text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.tenant_id is null or not s.enabled then 'off'
    when p_kind = 'points_confirmed' then s.points_route
    when p_kind = 'coupon_issued' then s.coupon_route
    when p_kind = 'voucher_expiring' then s.voucher_expiring_route
    when p_kind = 'expiry_reminder' then s.expiry_route
    when p_kind in ('birthday', 'win_back') then case when s.promotions_enabled then 'template' else 'off' end
    else 'off'
  end
  from (select p_tenant_id as tenant_id) t
  left join app.customer_message_settings s on s.tenant_id = t.tenant_id;
$$;

comment on function app.customer_message_route_setting(uuid, text) is 'how far a customer message kind may go for the tenant: off (no message), in_app, free or template; off when messaging is not enabled, and birthday and win_back are template only with promotions_enabled';

create function app.customer_message_oa(p_tenant_id uuid, p_membership_id uuid, p_store_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select o.id from public.memberships m join public.oas o on o.tenant_id = m.tenant_id and o.brand_id = m.brand_id
     where m.id = p_membership_id and m.tenant_id = p_tenant_id),
    (select o.id from public.brands b join public.oas o on o.tenant_id = b.tenant_id and o.brand_id = b.id
     where b.tenant_id = p_tenant_id and p_store_id is not null and p_store_id = any (b.store_ids)
     order by b.brand_key limit 1),
    (select min(o.id::text)::uuid from public.oas o where o.tenant_id = p_tenant_id having count(*) = 1)
  );
$$;

comment on function app.customer_message_oa(uuid, uuid, uuid) is 'the OA that speaks for a customer message: the OA of the brand the member joined through, else of the brand covering the event''s store, else the tenant''s only OA; null when none applies';

create function app.link_customer_oa_user(p_oa_id uuid, p_oa_user_id text, p_customer_id uuid, p_at timestamptz default now())
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  target public.oas%rowtype;
  existing app.customer_oa_contacts%rowtype;
begin
  if p_oa_user_id is null or p_oa_user_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'link_customer_oa_user needs an OA user id of 1 to 64 letters, digits, _ or -' using errcode = '22023';
  end if;
  select o.* into target from public.oas o where o.id = p_oa_id;
  if not found then
    raise exception 'link_customer_oa_user needs a configured OA' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = target.tenant_id) then
    raise exception 'link_customer_oa_user needs a customer of the OA''s tenant' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:customer-oa:' || p_oa_id::text, 0));
  select c.* into existing from app.customer_oa_contacts c where c.oa_id = p_oa_id and c.customer_id = p_customer_id;
  if found and existing.oa_user_id = p_oa_user_id then
    return 'unchanged';
  end if;
  delete from app.customer_oa_contacts c
  where c.oa_id = p_oa_id
    and c.oa_user_id = p_oa_user_id
    and c.customer_id <> p_customer_id;
  insert into app.customer_oa_contacts (tenant_id, oa_id, customer_id, oa_user_id, linked_at)
  values (target.tenant_id, p_oa_id, p_customer_id, p_oa_user_id, coalesce(p_at, now()))
  on conflict (oa_id, customer_id) do update
    set oa_user_id = excluded.oa_user_id, linked_at = excluded.linked_at;
  return case when existing.customer_id is null then 'linked' else 'moved' end;
end;
$$;

comment on function app.link_customer_oa_user(uuid, text, uuid, timestamptz) is 'ties a customer to their OA user id on one OA (the OA enrolment after user_submit_info, or any event that names both): linked for a new tie, moved when the customer had another OA user id, unchanged otherwise; an OA user id tied to another customer of the OA moves to this one; 22023 for a malformed id, an unknown OA or a customer of another tenant';

create function app.customer_consent_record(p_tenant_id uuid, p_customer_id uuid, p_purpose public.consent_purpose)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
  from public.consent_records c
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'customer'
    and c.subject_id = p_customer_id
    and c.purpose = p_purpose
    and c.revoked_at is null
  order by c.granted_at desc
  limit 1;
$$;

comment on function app.customer_consent_record(uuid, uuid, public.consent_purpose) is 'the customer''s active consent record of a purpose, or null';

create function app.enqueue_customer_message(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_kind text,
  p_event_key text,
  p_params jsonb default '{}'::jsonb,
  p_store_id uuid default null,
  p_expires_at timestamptz default null,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  message_class public.message_class := app.customer_message_class(p_kind);
  member public.memberships%rowtype;
  loyalty_consent uuid;
  marketing_consent uuid;
  created_at_value timestamptz := coalesce(p_at, now());
  expires_value timestamptz;
  params_value jsonb;
  dedupe text;
  created uuid;
begin
  if message_class is null then
    raise exception 'enqueue_customer_message needs a customer message kind: points_confirmed, coupon_issued, voucher_expiring, expiry_reminder, birthday or win_back' using errcode = '22023';
  end if;
  if p_event_key is null or p_event_key !~ '^[a-z0-9][a-z0-9_:.-]{0,119}$' then
    raise exception 'enqueue_customer_message needs an event key of lower-case letters, digits, _, :, . or -' using errcode = '22023';
  end if;
  params_value := coalesce(p_params, '{}'::jsonb) || jsonb_build_object('membership_id', p_membership_id::text);
  if not app.facts_are_count_only(params_value) then
    raise exception 'enqueue_customer_message takes count-only parameters: numbers, booleans and short lower-case tokens' using errcode = '22023';
  end if;
  if app.customer_message_route_setting(p_tenant_id, p_kind) = 'off' then
    return null;
  end if;
  select m.* into member
  from public.memberships m
  where m.id = p_membership_id
    and m.tenant_id = p_tenant_id;
  if not found or member.status <> 'active' then
    return null;
  end if;
  if not exists (select 1 from public.customers c where c.id = member.customer_id and c.tenant_id = p_tenant_id) then
    return null;
  end if;
  loyalty_consent := app.customer_consent_record(p_tenant_id, member.customer_id, 'loyalty');
  if loyalty_consent is null then
    return null;
  end if;
  if message_class = 'advertising' then
    marketing_consent := app.customer_consent_record(p_tenant_id, member.customer_id, 'marketing');
    if marketing_consent is null then
      return null;
    end if;
  end if;
  expires_value := least(
    created_at_value + case p_kind
      when 'points_confirmed' then interval '24 hours'
      when 'coupon_issued' then interval '24 hours'
      when 'voucher_expiring' then interval '24 hours'
      when 'expiry_reminder' then interval '72 hours'
      when 'birthday' then interval '24 hours'
      else interval '72 hours'
    end,
    coalesce(p_expires_at, 'infinity'::timestamptz)
  );
  if expires_value <= created_at_value then
    return null;
  end if;
  dedupe := 'customer:' || p_kind || ':' || p_event_key;
  insert into public.outbound_messages (
    tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, consent_record_id, status,
    created_at, kind, message_class, store_id, dedupe_key, params, expires_at
  )
  values (
    p_tenant_id,
    'mini_app',
    'membership:' || member.id::text,
    'customer',
    member.customer_id,
    case when message_class = 'advertising' then 'marketing'::public.consent_purpose else 'loyalty'::public.consent_purpose end,
    'customer.' || p_kind || '.v1',
    coalesce(marketing_consent, loyalty_consent),
    'queued',
    created_at_value,
    p_kind,
    message_class,
    case when p_store_id is not null and exists (select 1 from public.stores s where s.id = p_store_id and s.tenant_id = p_tenant_id) then p_store_id end,
    dedupe,
    params_value,
    expires_value
  )
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into created;
  if created is null then
    select o.id into created
    from public.outbound_messages o
    where o.tenant_id = p_tenant_id
      and o.dedupe_key = dedupe;
    return created;
  end if;
  perform app.kick_notify('kick');
  return created;
end;
$$;

comment on function app.enqueue_customer_message(uuid, uuid, text, text, jsonb, uuid, timestamptz, timestamptz) is 'the one insert path of customer messages (FR-NOT-40, NFR-PRV-02): one queued row per kind and event key (dedupe key customer:<kind>:<event key>), starting on the in-app channel mini_app with the opaque recipient membership:<id>, the customer as subject, the loyalty consent (marketing for birthday and win_back) as reference, count-only parameters plus membership_id and no title or body; expires after 24 hours (72 for expiry_reminder and win_back) or at p_expires_at when sooner; returns null and writes nothing when the tenant''s route for the kind is off, the membership is missing or not active, the customer is gone, the loyalty consent is not active, or for birthday and win_back the marketing consent is not active; a repeated event returns the first id; 22023 for an unknown kind, a malformed event key or parameters that are not count-only';

create function app.enqueue_points_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  earn public.loyalty_ledger%rowtype;
begin
  if not exists (select 1 from app.customer_message_settings s where s.tenant_id = new.tenant_id and s.enabled) then
    return null;
  end if;
  if new.entry_kind = 'earn' and not new.pending then
    earn := new;
  elsif new.entry_kind = 'confirm' then
    select l.* into earn
    from public.loyalty_ledger l
    where l.id = new.source_entry_id
      and l.entry_kind = 'earn'
      and l.pending;
    if not found then
      return null;
    end if;
  else
    return null;
  end if;
  if earn.stamp_delta <= 0 and earn.point_delta <= 0 then
    return null;
  end if;
  begin
    perform app.enqueue_customer_message(
      earn.tenant_id,
      earn.membership_id,
      'points_confirmed',
      earn.id::text,
      jsonb_build_object('entry_id', earn.id::text, 'points', earn.point_delta, 'stamps', earn.stamp_delta),
      earn.store_id,
      null,
      new.created_at
    );
  exception when others then
    raise warning 'customer message for a confirmed earn was not queued (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.enqueue_points_confirmation() is 'trigger after insert on loyalty_ledger: a confirmed earn (an earn that is not pending, or the confirm row of a pending earn) that credited stamps or points queues one points_confirmed message keyed on the earn; a failure to queue never fails the earn';

create trigger loyalty_ledger_enqueue_points_confirmation
after insert on public.loyalty_ledger
for each row
when (new.entry_kind in ('earn', 'confirm'))
execute function app.enqueue_points_confirmation();

create function app.enqueue_coupon_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  spent_points integer := 0;
  spent_stamps integer := 0;
begin
  if new.state <> 'held' or not exists (select 1 from app.customer_message_settings s where s.tenant_id = new.tenant_id and s.enabled) then
    return null;
  end if;
  if new.redeem_entry_id is not null then
    select -l.point_delta, -l.stamp_delta into spent_points, spent_stamps
    from public.loyalty_ledger l
    where l.id = new.redeem_entry_id;
  end if;
  begin
    perform app.enqueue_customer_message(
      new.tenant_id,
      new.membership_id,
      'coupon_issued',
      new.id::text,
      jsonb_build_object('redemption_id', new.id::text, 'points', coalesce(spent_points, 0), 'stamps', coalesce(spent_stamps, 0)),
      new.store_id,
      new.hold_expires_at,
      new.held_at
    );
  exception when others then
    raise warning 'customer message for a coupon hold was not queued (%)', sqlstate;
  end;
  return null;
end;
$$;

comment on function app.enqueue_coupon_issued() is 'trigger after insert on redemptions: a held redemption queues one coupon_issued message keyed on the redemption, expiring with the hold; a failure to queue never fails the hold';

create trigger redemptions_enqueue_coupon_issued
after insert on public.redemptions
for each row
when (new.state = 'held')
execute function app.enqueue_coupon_issued();

create function app.enqueue_customer_reminders(p_at timestamptz default now(), p_tenant_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  setting record;
  hold record;
  member record;
  local_day date;
  expiring_points integer;
  expiring_stamps integer;
  first_expiry timestamptz;
  voucher_count integer := 0;
  expiry_count integer := 0;
  win_back_count integer := 0;
  queued uuid;
begin
  for setting in
    select s.*, coalesce(t.timezone, 'Asia/Ho_Chi_Minh') as zone
    from app.customer_message_settings s
    join public.tenants t on t.id = s.tenant_id
    where s.enabled
      and (p_tenant_id is null or s.tenant_id = p_tenant_id)
  loop
    if setting.voucher_expiring_route <> 'off' then
      for hold in
        select d.id, d.membership_id, d.store_id, d.hold_expires_at
        from public.redemptions d
        where d.tenant_id = setting.tenant_id
          and d.state = 'held'
          and d.hold_expires_at > p_at
          and d.hold_expires_at <= p_at + make_interval(hours => setting.voucher_expiring_hours)
          and d.hold_expires_at - d.held_at > make_interval(hours => setting.voucher_expiring_hours)
          and not exists (
            select 1 from public.outbound_messages o
            where o.tenant_id = d.tenant_id
              and o.dedupe_key = 'customer:voucher_expiring:' || d.id::text
          )
      loop
        queued := app.enqueue_customer_message(
          setting.tenant_id, hold.membership_id, 'voucher_expiring', hold.id::text,
          jsonb_build_object('redemption_id', hold.id::text),
          hold.store_id, hold.hold_expires_at, p_at
        );
        voucher_count := voucher_count + case when queued is null then 0 else 1 end;
      end loop;
    end if;
    local_day := (p_at at time zone setting.zone)::date;
    if setting.reminders_scanned_on is not distinct from local_day then
      continue;
    end if;
    update app.customer_message_settings s set reminders_scanned_on = local_day, updated_at = p_at where s.tenant_id = setting.tenant_id;
    if setting.expiry_route <> 'off' then
      for member in
        select m.id, m.joined_store_id
        from public.memberships m
        where m.tenant_id = setting.tenant_id
          and m.status = 'active'
          and exists (
            select 1 from public.consent_records c
            where c.tenant_id = m.tenant_id and c.subject_type = 'customer' and c.subject_id = m.customer_id
              and c.purpose = 'loyalty' and c.revoked_at is null
          )
      loop
        expiring_points := greatest(
          app.loyalty_expiring_points(member.id, p_at + make_interval(days => setting.expiry_reminder_days))
            - app.loyalty_expiring_points(member.id, p_at),
          0
        );
        select count(*)::integer, min(st.expires_at) into expiring_stamps, first_expiry
        from public.stamps st
        where st.membership_id = member.id
          and st.state = 'active'
          and st.expires_at > p_at
          and st.expires_at <= p_at + make_interval(days => setting.expiry_reminder_days);
        if expiring_points > 0 then
          first_expiry := least(
            first_expiry,
            (select min(l.expires_at)
             from public.loyalty_ledger l
             where l.membership_id = member.id
               and l.point_delta > 0
               and l.entry_kind in ('earn', 'adjust')
               and l.reason is distinct from 'redemption_released'
               and l.expires_at > p_at
               and l.expires_at <= p_at + make_interval(days => setting.expiry_reminder_days))
          );
        end if;
        if (expiring_points > 0 or expiring_stamps > 0) and first_expiry is not null then
          queued := app.enqueue_customer_message(
            setting.tenant_id, member.id, 'expiry_reminder',
            member.id::text || ':' || to_char((first_expiry at time zone setting.zone)::date, 'YYYY-MM-DD'),
            jsonb_build_object(
              'points', expiring_points,
              'stamps', expiring_stamps,
              'expires_on', to_char((first_expiry at time zone setting.zone)::date, 'YYYY-MM-DD')
            ),
            member.joined_store_id, first_expiry, p_at
          );
          expiry_count := expiry_count + case when queued is null then 0 else 1 end;
        end if;
      end loop;
    end if;
    if setting.promotions_enabled then
      for member in
        select m.id, m.joined_store_id
        from public.memberships m
        where m.tenant_id = setting.tenant_id
          and m.status = 'active'
          and m.joined_at <= p_at - make_interval(days => setting.win_back_days)
          and not exists (
            select 1 from public.loyalty_ledger l
            where l.membership_id = m.id
              and l.entry_kind = 'earn'
              and l.occurred_at > p_at - make_interval(days => setting.win_back_days)
          )
          and exists (
            select 1 from public.consent_records c
            where c.tenant_id = m.tenant_id and c.subject_type = 'customer' and c.subject_id = m.customer_id
              and c.purpose = 'marketing' and c.revoked_at is null
          )
      loop
        queued := app.enqueue_customer_message(
          setting.tenant_id, member.id, 'win_back',
          member.id::text || ':' || to_char(local_day, 'YYYY-MM'),
          jsonb_build_object('inactive_days', setting.win_back_days),
          member.joined_store_id, null, p_at
        );
        win_back_count := win_back_count + case when queued is null then 0 else 1 end;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('voucher_expiring', voucher_count, 'expiry_reminder', expiry_count, 'win_back', win_back_count);
end;
$$;

comment on function app.enqueue_customer_reminders(timestamptz, uuid) is 'the scheduled customer messages of tenants with messaging enabled, idempotent through the dedupe keys: on every call a voucher_expiring message for each held redemption whose hold ends within voucher_expiring_hours (only for holds longer than that lead, so a short hold gets the coupon_issued message alone); once per tenant-local day an expiry_reminder per active member with loyalty consent whose points or stamps expire within expiry_reminder_days (keyed on the member and the day of the first expiry) and, with promotions_enabled, a win_back per member with marketing consent and no earn for win_back_days (keyed on the member and the month); returns the count-only numbers queued';

revoke all on table app.customer_message_settings from public, anon, authenticated, service_role;
revoke all on table app.customer_oa_contacts from public, anon, authenticated, service_role;
revoke all on function app.customer_message_class(text) from public, anon, authenticated, service_role;
revoke all on function app.customer_message_route_setting(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.customer_message_oa(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.link_customer_oa_user(uuid, text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_consent_record(uuid, uuid, public.consent_purpose) from public, anon, authenticated, service_role;
revoke all on function app.enqueue_customer_message(uuid, uuid, text, text, jsonb, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.enqueue_points_confirmation() from public, anon, authenticated, service_role;
revoke all on function app.enqueue_coupon_issued() from public, anon, authenticated, service_role;
revoke all on function app.enqueue_customer_reminders(timestamptz, uuid) from public, anon, authenticated, service_role;
