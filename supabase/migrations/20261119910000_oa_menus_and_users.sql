create function app.oa_text_valid(p_text text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(p_text) between 1 and p_max
      and p_text !~ '^[[:space:]]'
      and p_text !~ '[[:space:]]$'
      and p_text !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]'
      and p_text !~* '(https?://|www\.|zalo\.me)'
      and regexp_replace(p_text, '[[:space:].()+-]', '', 'g') !~ '[0-9]{8,}',
    false
  );
$$;

comment on function app.oa_text_valid(text, integer) is 'whether a text the OA sends or shows is 1 to p_max characters, without leading or trailing space, without control characters other than a line break, without a link (http, www, zalo.me) and without a phone number (8 digits or more once spaces, dots, brackets, + and - are dropped); buttons carry the only links, as Mini App deep links';

create function app.oa_menu_buttons_valid(p_buttons jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_button jsonb;
  v_actions text[] := '{}';
  v_action text;
begin
  if p_buttons is null or jsonb_typeof(p_buttons) <> 'array' or jsonb_array_length(p_buttons) not between 1 and 5 then
    return false;
  end if;
  for v_button in select b.value from jsonb_array_elements(p_buttons) as b (value) loop
    if jsonb_typeof(v_button) is distinct from 'object'
      or (select array_agg(k.key order by k.key) from jsonb_object_keys(v_button) as k (key)) is distinct from array['action', 'label', 'target']
      or jsonb_typeof(v_button -> 'action') is distinct from 'string'
      or jsonb_typeof(v_button -> 'label') is distinct from 'string'
      or jsonb_typeof(v_button -> 'target') is distinct from 'string'
    then
      return false;
    end if;
    v_action := v_button ->> 'action';
    if v_action not in ('join', 'points', 'vouchers', 'open_app')
      or v_action = any (v_actions)
      or (v_button ->> 'target') not in ('mini_app', 'query')
      or ((v_button ->> 'target') = 'query' and v_action <> 'join')
      or not app.oa_text_valid(v_button ->> 'label', 30)
      or (v_button ->> 'label') ~ '[[:cntrl:]]'
    then
      return false;
    end if;
    v_actions := v_actions || v_action;
  end loop;
  return true;
end;
$$;

comment on function app.oa_menu_buttons_valid(jsonb) is 'whether an OA menu is 1 to 5 buttons, each exactly {action, label, target}: action join, points, vouchers or open_app, each at most once; target mini_app (a deep link into the brand''s customer Mini App) or query (an OA keyword, for join only); label 1 to 30 characters on one line under app.oa_text_valid; no other link is possible';

create table public.oa_menus (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  buttons jsonb not null check (app.oa_menu_buttons_valid(buttons)),
  welcome_enabled boolean not null default true,
  welcome_text text not null check (app.oa_text_valid(welcome_text, 2000)),
  joined_text text not null check (app.oa_text_valid(joined_text, 2000)),
  member_text text not null check (app.oa_text_valid(member_text, 2000)),
  form_title text not null check (app.oa_text_valid(form_title, 100)),
  form_subtitle text not null check (app.oa_text_valid(form_subtitle, 500)),
  form_image_url text check (form_image_url is null or (char_length(form_image_url) <= 500 and form_image_url ~ '^https://[^[:space:]]+$')),
  applied_buttons jsonb,
  applied_sha256 text check (applied_sha256 is null or applied_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (oa_id),
  unique (tenant_id, id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade,
  constraint oa_menus_join_form_image check (form_image_url is not null or not buttons @> '[{"action": "join", "target": "query"}]'::jsonb),
  constraint oa_menus_applied_shape check (
    (applied_buttons is null) = (applied_sha256 is null) and (applied_sha256 is null) = (applied_at is null)
    and (applied_buttons is null or jsonb_typeof(applied_buttons) = 'array')
  )
);

comment on table public.oa_menus is 'the chat menu and the messages of a brand''s OA, one row per OA and so per brand: the buttons (join, points, vouchers, open the Mini App; a Mini App deep link or the join keyword, nothing else), the welcome sent once per follow, the texts of the join replies and the request_user_info form; fnb zalo oa-menu apply pushes the buttons and keeps what it pushed in applied_*';
comment on column public.oa_menus.buttons is 'the configured buttons, checked by app.oa_menu_buttons_valid; rendered to Zalo buttons with the brand''s customer Mini App id';
comment on column public.oa_menus.welcome_text is 'the consultation message a follow earns, sent once per follow with the menu buttons; never promotional';
comment on column public.oa_menus.joined_text is 'the reply after an enrolment through the OA form, inside the interaction window: says the customer is a member and how to opt in to promotions from the Mini App, which the form never implies';
comment on column public.oa_menus.member_text is 'the reply to the join keyword of an OA user already linked to a member';
comment on column public.oa_menus.form_image_url is 'the https image Zalo requires in the request_user_info form; needed when join is an OA keyword';
comment on column public.oa_menus.applied_buttons is 'the Zalo buttons the last fnb zalo oa-menu apply pushed, the base of the next dry run''s diff; written only by app.record_oa_menu_applied';

create trigger oa_menus_set_updated_at before update on public.oa_menus for each row execute function app.set_updated_at();
create trigger oa_menus_keep_created_by before update on public.oa_menus for each row execute function app.keep_created_by();
create trigger oa_menus_set_updated_by before insert or update on public.oa_menus for each row execute function app.set_updated_by();

alter table public.oa_menus enable row level security;

create policy oa_menus_select_for_managers on public.oa_menus
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy oa_menus_insert_for_owners on public.oa_menus
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy oa_menus_update_for_owners on public.oa_menus
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy oa_menus_delete_for_owners on public.oa_menus
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

revoke all on public.oa_menus from anon, authenticated;
grant select, delete on public.oa_menus to authenticated;
grant insert (tenant_id, oa_id, buttons, welcome_enabled, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
  on public.oa_menus to authenticated;
grant update (buttons, welcome_enabled, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url)
  on public.oa_menus to authenticated;

create table public.oa_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  oa_user_id text not null check (oa_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  customer_id uuid,
  enrolled_at timestamptz,
  following boolean not null default false,
  followed_at timestamptz,
  unfollowed_at timestamptz,
  welcomed_at timestamptz,
  form_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (oa_id, oa_user_id),
  unique (tenant_id, id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade,
  constraint oa_users_enrolment_shape check ((customer_id is null) = (enrolled_at is null))
);

create index oa_users_tenant_idx on public.oa_users (tenant_id);
create unique index oa_users_one_user_per_customer_key on public.oa_users (oa_id, customer_id) where customer_id is not null;

comment on table public.oa_users is 'an OA user of a brand''s OA as oa-webhook saw it in verified events: whether they follow, when the welcome of their follow and the last request_user_info form were sent (which keeps both to one), and the customer they enrolled as through the OA form, the OA counterpart of memberships.zalo_user_id of the Mini App; the OA user id only, never a name, phone or message (NFR-PRV-07); deleted with that customer, so a data-subject deletion takes it along; the messaging tie of the outbox lives in app.customer_oa_contacts (app.link_customer_oa_user) and the interaction window is read from oa_events; no API role reads it';
comment on column public.oa_users.oa_user_id is 'the user id the OA''s events carry, scoped to the OA; not the per-app user id of the Mini App';
comment on column public.oa_users.customer_id is 'the customer this OA user enrolled as through the request_user_info form (app.oa_form_enrol), at most one OA user per customer and OA; a later submission of another phone moves it';
comment on column public.oa_users.welcomed_at is 'when the welcome of the current follow was claimed; one welcome per follow and at most one a day';
comment on column public.oa_users.form_sent_at is 'when the last request_user_info form was claimed for this OA user; a join tap within two minutes of it sends no second form';

create trigger oa_users_set_updated_at before update on public.oa_users for each row execute function app.set_updated_at();

alter table public.oa_users enable row level security;
revoke all on public.oa_users from anon, authenticated;

alter table public.oa_events
  add column customer_step text check (customer_step is null or customer_step ~ '^[a-z][a-z_]{0,39}$'),
  add column customer_step_at timestamptz,
  add constraint oa_events_customer_step_shape check ((customer_step is null) = (customer_step_at is null));

comment on column public.oa_events.customer_step is 'the outcome of app.oa_customer_step for this event (welcome, form, member, joined, joined_quiet, refused_<reason>, outside_window, unverified, ignored, …), set once, which keeps every customer step to one run per event';

create function app.oa_last_interaction(p_oa_id uuid, p_oa_user_id text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(e.occurred_at)
  from public.oa_events e
  where e.oa_id = p_oa_id
    and e.oa_user_id = p_oa_user_id
    and e.signature in ('raw', 'compact')
    and e.event_name ~ '^user_send_[a-z0-9_]+$';
$$;

comment on function app.oa_last_interaction(uuid, text) is 'the latest verified user_send_ event of an OA user on an OA (a message, or a tap on a keyword button, which Zalo delivers as the user''s message), the start of the 48-hour consultation window; a follow alone does not open it, it earns the welcome; null without one in the 90 days oa_events keeps';

create function app.track_oa_user(p_event public.oa_events)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_event.oa_user_id is null or p_event.signature not in ('raw', 'compact') then
    return;
  end if;
  if p_event.event_name = 'follow' then
    insert into public.oa_users as u (tenant_id, oa_id, oa_user_id, following, followed_at)
    values (p_event.tenant_id, p_event.oa_id, p_event.oa_user_id, true, p_event.occurred_at)
    on conflict (oa_id, oa_user_id) do update
    set following = case when u.unfollowed_at is null or u.unfollowed_at <= excluded.followed_at then true else u.following end,
        followed_at = greatest(u.followed_at, excluded.followed_at);
  elsif p_event.event_name = 'unfollow' then
    insert into public.oa_users as u (tenant_id, oa_id, oa_user_id, following, unfollowed_at)
    values (p_event.tenant_id, p_event.oa_id, p_event.oa_user_id, false, p_event.occurred_at)
    on conflict (oa_id, oa_user_id) do update
    set following = case when u.followed_at is null or u.followed_at <= excluded.unfollowed_at then false else u.following end,
        unfollowed_at = greatest(u.unfollowed_at, excluded.unfollowed_at);
  end if;
end;
$$;

comment on function app.track_oa_user(public.oa_events) is 'keeps the follow state of public.oa_users in step with one verified OA event (signature raw or compact; an unverified event changes nothing): follow and unfollow move it by event time, so a late delivery of an older event does not undo a newer one';

create or replace function app.apply_oa_event(p_event_row uuid, p_at timestamptz)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  event public.oa_events%rowtype;
begin
  update public.oa_events e
  set processed_at = p_at
  where e.id = p_event_row
    and e.processed_at is null
  returning e.* into event;
  if not found then
    return 'already_processed';
  end if;
  if event.oa_user_id is null then
    return 'no_user';
  end if;
  perform app.track_oa_user(event);
  if app.oa_event_is_interaction(event.event_name) then
    update public.notification_channels c
    set last_interaction_at = event.occurred_at
    where c.tenant_id = event.tenant_id
      and c.kind = 'zalo_oa'
      and c.address = event.oa_user_id
      and (c.last_interaction_at is null or c.last_interaction_at < event.occurred_at);
    return 'interaction';
  end if;
  if event.event_name = 'unfollow' then
    update public.notification_channels c
    set status = 'disabled', disabled_reason = 'blocked_by_user'
    where c.tenant_id = event.tenant_id
      and c.kind = 'zalo_oa'
      and c.address = event.oa_user_id
      and c.status <> 'disabled';
    return 'unfollow';
  end if;
  return 'ignored';
end;
$$;

comment on function app.apply_oa_event(uuid, timestamptz) is 'the follow-up of one stored OA event, run once (processed_at): keeps the follow state of public.oa_users in step (app.track_oa_user, verified events only); an interaction (app.oa_event_is_interaction) moves last_interaction_at of the tenant''s zalo_oa destinations of that OA user forward to the event time; an unfollow disables them as blocked_by_user; any other event changes nothing there; returns interaction, unfollow, ignored, no_user or already_processed';

create function app.oa_customer_mini_app(p_oa_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select m.external_id
  from public.oas o
  join public.mini_apps m on m.tenant_id = o.tenant_id and m.brand_id = o.brand_id and m.kind = 'customer'
  where o.id = p_oa_id;
$$;

comment on function app.oa_customer_mini_app(uuid) is 'the Mini App id of the customer Mini App of the OA''s brand, the target of the menu''s deep links, or null when the brand has none';

create function app.oa_access_token(p_oa_id uuid, p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select t.access_token
  from public.oas o
  join public.zalo_tokens t on t.tenant_id = o.tenant_id and t.brand_id = o.brand_id and t.kind = 'oa'
  where o.id = p_oa_id
    and o.package_tier in ('tang_truong', 'toan_dien')
    and t.access_expires_at > p_at + interval '1 minute';
$$;

comment on function app.oa_access_token(uuid, timestamptz) is 'the OA access token with which the OA Open API is called for this OA: the brand''s stored oa pair while its access token is valid for more than a minute and the OA''s package includes the Open API (tang_truong or toan_dien); null otherwise, and the caller sends nothing';

create function app.set_oa_menu(
  p_tenant_id uuid,
  p_brand_key text,
  p_buttons jsonb,
  p_welcome_enabled boolean,
  p_welcome_text text,
  p_joined_text text,
  p_member_text text,
  p_form_title text,
  p_form_subtitle text,
  p_form_image_url text
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_oa uuid;
  v_menu public.oa_menus;
begin
  select o.id into v_oa
  from public.oas o
  join public.brands b on b.id = o.brand_id and b.tenant_id = o.tenant_id
  where o.tenant_id = p_tenant_id and b.brand_key = p_brand_key;
  if v_oa is null then
    raise exception 'the brand has no OA in this tenant' using errcode = '22023';
  end if;
  select m.* into v_menu from public.oa_menus m where m.oa_id = v_oa for update;
  if v_menu.id is null then
    insert into public.oa_menus (tenant_id, oa_id, buttons, welcome_enabled, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url, created_by, updated_by)
    values (p_tenant_id, v_oa, p_buttons, p_welcome_enabled, p_welcome_text, p_joined_text, p_member_text, p_form_title, p_form_subtitle, p_form_image_url, null, null);
    return 'created';
  end if;
  if v_menu.buttons = p_buttons
    and v_menu.welcome_enabled = p_welcome_enabled
    and v_menu.welcome_text = p_welcome_text
    and v_menu.joined_text = p_joined_text
    and v_menu.member_text = p_member_text
    and v_menu.form_title = p_form_title
    and v_menu.form_subtitle = p_form_subtitle
    and v_menu.form_image_url is not distinct from p_form_image_url
  then
    return 'unchanged';
  end if;
  update public.oa_menus m
  set buttons = p_buttons,
      welcome_enabled = p_welcome_enabled,
      welcome_text = p_welcome_text,
      joined_text = p_joined_text,
      member_text = p_member_text,
      form_title = p_form_title,
      form_subtitle = p_form_subtitle,
      form_image_url = p_form_image_url
  where m.id = v_menu.id;
  return 'updated';
end;
$$;

comment on function app.set_oa_menu(uuid, text, jsonb, boolean, text, text, text, text, text, text) is 'fnb zalo oa-menu set: creates or replaces the menu row of the brand''s OA with the given buttons and texts (the table''s checks apply); returns created, updated or unchanged; 22023 when the brand has no OA in the tenant; the applied state is left as it is, so the next dry run shows the change';

create function app.oa_menu_source(p_tenant_id uuid, p_brand_key text)
returns table (
  menu_id uuid,
  oa_id uuid,
  package_tier text,
  buttons jsonb,
  applied_buttons jsonb,
  applied_sha256 text,
  applied_at timestamptz,
  mini_app_id text
)
language sql
stable
set search_path = ''
as $$
  select m.id, o.id, o.package_tier, m.buttons, m.applied_buttons, m.applied_sha256, m.applied_at, app.oa_customer_mini_app(o.id)
  from public.oas o
  join public.brands b on b.id = o.brand_id and b.tenant_id = o.tenant_id
  left join public.oa_menus m on m.oa_id = o.id
  where o.tenant_id = p_tenant_id and b.brand_key = p_brand_key;
$$;

comment on function app.oa_menu_source(uuid, text) is 'what fnb zalo oa-menu apply reads for a brand: its OA, the package, the configured buttons (null without a menu row), the buttons last applied with their digest and time, and the customer Mini App id the deep links point to';

create function app.record_oa_menu_applied(p_menu_id uuid, p_buttons jsonb, p_sha256 text, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_buttons is null or jsonb_typeof(p_buttons) <> 'array' or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_at is null then
    raise exception 'record_oa_menu_applied needs the applied buttons, their sha256 and an instant' using errcode = '22023';
  end if;
  update public.oa_menus m
  set applied_buttons = p_buttons, applied_sha256 = p_sha256, applied_at = p_at
  where m.id = p_menu_id;
  if not found then
    raise exception 'record_oa_menu_applied needs an existing menu' using errcode = '22023';
  end if;
end;
$$;

comment on function app.record_oa_menu_applied(uuid, jsonb, text, timestamptz) is 'keeps the Zalo buttons fnb zalo oa-menu apply pushed after Zalo accepted them, with their digest and time; 22023 for a missing menu or a malformed digest';

create function app.record_oa_reply(
  p_oa_user_row uuid,
  p_customer_id uuid,
  p_kind text,
  p_status text,
  p_error_code text,
  p_provider_message_id text,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('welcome', 'form', 'member', 'joined')
    or p_status is null or p_status not in ('sent', 'failed', 'uncertain', 'cancelled')
    or p_at is null
  then
    raise exception 'record_oa_reply needs welcome, form, member or joined, a sent, failed, uncertain or cancelled outcome and an instant' using errcode = '22023';
  end if;
  insert into public.outbound_messages (
    tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, provider_message_id, last_error_code, created_at
  )
  select u.tenant_id, 'zalo_oa', 'oa_user:' || u.id::text,
    case when c.id is not null then 'customer'::public.consent_subject end, c.id,
    'loyalty', 'oa_' || p_kind || '.v1',
    case when p_status = 'sent' then p_at end, p_status, left(p_provider_message_id, 200), p_error_code, p_at
  from public.oa_users u
  left join public.customers c on c.id = p_customer_id and c.tenant_id = u.tenant_id
  where u.id = p_oa_user_row
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.record_oa_reply(uuid, uuid, text, text, text, text, timestamptz) is 'logs one consultation message oa-webhook sent straight to an OA user outside the outbox (welcome, form, member, joined) as an outbound_messages row with the opaque recipient oa_user:<id>, the customer as subject when the reply concerns one of the OA user''s tenant, purpose loyalty, the template and the outcome (cancelled when sending is switched off), never the text; null for an unknown OA user';

revoke all on function app.oa_text_valid(text, integer) from public, anon;
revoke all on function app.oa_menu_buttons_valid(jsonb) from public, anon;
revoke all on function app.oa_last_interaction(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.track_oa_user(public.oa_events) from public, anon, authenticated, service_role;
revoke all on function app.apply_oa_event(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.oa_customer_mini_app(uuid) from public, anon, authenticated, service_role;
revoke all on function app.oa_access_token(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.set_oa_menu(uuid, text, jsonb, boolean, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function app.oa_menu_source(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.record_oa_menu_applied(uuid, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.record_oa_reply(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function app.oa_text_valid(text, integer) to authenticated, service_role;
grant execute on function app.oa_menu_buttons_valid(jsonb) to authenticated, service_role;
