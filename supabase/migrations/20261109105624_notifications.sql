create type public.channel_kind as enum ('zalo_bot', 'email', 'telegram', 'webhook', 'zalo_oa', 'zalo_gmf', 'zalo_zbs', 'mini_app', 'sms');
create type public.message_class as enum ('operational', 'transactional', 'advertising');
create type public.alert_severity as enum ('info', 'warning', 'critical');

comment on type public.channel_kind is 'where a message can go: zalo_bot, email, telegram and webhook have adapters; zalo_oa, zalo_gmf, zalo_zbs, mini_app and sms are declared so their policies exist as data, and every message to them is cancelled as unavailable until a later phase builds them';
comment on type public.message_class is 'operational messages (digests and alerts to the owner and managers) are not advertising; transactional and advertising messages to customers arrive in phases 17 to 19 and are refused by the send decision until then';
comment on type public.alert_severity is 'info, warning or critical; a critical operational alert may break the send window and the daily cap only where the policy sets critical_bypass';

create function app.channel_kind_available(p_kind public.channel_kind)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('zalo_bot', 'email', 'telegram', 'webhook');
$$;

comment on function app.channel_kind_available(public.channel_kind) is 'whether a dispatcher has an adapter for the kind; phase 13 replaces it to add zalo_oa and zalo_gmf';

create function app.notify_secret_name_valid(p_kind public.channel_kind, p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_name ~ '^NOTIFY_[A-Z0-9_]{1,60}$', false)
    and case p_kind
      when 'zalo_bot' then p_name ~ '^NOTIFY_ZALO_BOT_TOKEN(_[A-Z0-9]{1,20})?$'
      when 'telegram' then p_name ~ '^NOTIFY_TELEGRAM_BOT_TOKEN(_[A-Z0-9]{1,20})?$'
      when 'email' then p_name ~ '^NOTIFY_EMAIL_API_KEY(_[A-Z0-9]{1,20})?$'
      when 'webhook' then p_name ~ '^NOTIFY_WEBHOOK_SECRET(_[A-Z0-9]{1,20})?$'
      else true
    end;
$$;

comment on function app.notify_secret_name_valid(public.channel_kind, text) is 'whether a destination may name this environment variable as its credential: a NOTIFY_ name with the prefix of its kind, so a row can never point a dispatcher at another secret';

create function app.facts_are_count_only(p_facts jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry record;
begin
  if p_facts is null then
    return true;
  end if;
  if jsonb_typeof(p_facts) <> 'object' or (select count(*) from jsonb_object_keys(p_facts)) > 24 then
    return false;
  end if;
  for entry in select e.key, e.value from jsonb_each(p_facts) as e loop
    if entry.key !~ '^[a-z][a-z0-9_]{0,40}$' then
      return false;
    end if;
    if jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null') then
      return false;
    end if;
    if jsonb_typeof(entry.value) = 'string' and (entry.value #>> '{}') !~ '^[a-z0-9_:.-]{1,40}$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.facts_are_count_only(jsonb) is 'whether a jsonb object holds only numbers, booleans, nulls and short lower-case tokens (rule keys, stages, UUIDs, ISO dates) under at most 24 snake_case keys, so no error text, name, address or URL can reach an alert row or message parameters';

create table public.alert_rule_catalog (
  rule_key text primary key check (rule_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  category text not null check (category in ('digest', 'business', 'data_quality', 'sync', 'operations', 'channel')),
  delivery text not null check (delivery in ('digest', 'immediate')),
  default_enabled boolean not null,
  default_severity public.alert_severity not null,
  default_roles public.tenant_role[] not null check (cardinality(default_roles) between 1 and 4 and not ('publisher' = any (default_roles))),
  default_params jsonb not null check (jsonb_typeof(default_params) = 'object'),
  params_schema jsonb not null check (jsonb_typeof(params_schema) = 'object'),
  default_cooldown interval not null check (default_cooldown between interval '0' and interval '7 days'),
  remind_every interval check (remind_every is null or remind_every >= interval '1 hour'),
  notify_on_resolve boolean not null,
  store_scoped boolean not null,
  sort_order integer not null unique
);

comment on table public.alert_rule_catalog is 'the global, read-only list of alert and digest rules with their defaults and the parameter schema browser writes to alert_rules are validated against; a tenant works with no alert_rules row at all';
comment on column public.alert_rule_catalog.params_schema is 'per parameter {"type": "number" | "integer" | "boolean" | "time" | "enum", "min", "max", "values"}; app.alert_rule_params_valid checks alert_rules.params against it';
comment on column public.alert_rule_catalog.delivery is 'digest rules become lines of the daily digest; immediate rules open alert_events episodes and send alerts';

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('daily_digest', 'digest', 'digest', true, 'info', array['owner', 'manager']::public.tenant_role[],
    '{"deadline_local": "06:30", "settle_grace_minutes": 30, "skip_closed_days": true, "corrections": true}',
    '{"deadline_local": {"type": "time"}, "settle_grace_minutes": {"type": "integer", "min": 0, "max": 240}, "skip_closed_days": {"type": "boolean"}, "corrections": {"type": "boolean"}}',
    interval '0', null, false, false, 10),
  ('revenue_below_baseline', 'business', 'digest', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"ratio": 0.75, "min_sample_days": 4}',
    '{"ratio": {"type": "number", "min": 0.1, "max": 0.99}, "min_sample_days": {"type": "integer", "min": 1, "max": 8}}',
    interval '0', null, false, true, 20),
  ('ticket_drop', 'business', 'digest', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"drop": 0.10, "reference": "baseline", "min_invoices": 20, "min_sample_days": 4}',
    '{"drop": {"type": "number", "min": 0.01, "max": 0.9}, "reference": {"type": "enum", "values": ["baseline", "previous"]}, "min_invoices": {"type": "integer", "min": 1, "max": 1000}, "min_sample_days": {"type": "integer", "min": 1, "max": 8}}',
    interval '0', null, false, true, 30),
  ('drawer_variance', 'business', 'digest', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"max_lines": 3}',
    '{"max_lines": {"type": "integer", "min": 1, "max": 10}}',
    interval '0', null, false, true, 40),
  ('unverified_day', 'data_quality', 'digest', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{}', '{}',
    interval '0', null, false, true, 50),
  ('zero_sales_day', 'business', 'digest', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{}', '{}',
    interval '0', null, false, true, 60),
  ('zero_sales_open', 'business', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"min_open_minutes": 120, "fresh_sync_minutes": 45, "min_history_days": 28, "skip_holidays": true}',
    '{"min_open_minutes": {"type": "integer", "min": 30, "max": 720}, "fresh_sync_minutes": {"type": "integer", "min": 15, "max": 120}, "min_history_days": {"type": "integer", "min": 0, "max": 365}, "skip_holidays": {"type": "boolean"}}',
    interval '24 hours', null, false, true, 70),
  ('sync_failed', 'sync', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"min_consecutive_incremental": 2}',
    '{"min_consecutive_incremental": {"type": "integer", "min": 1, "max": 10}}',
    interval '6 hours', null, false, true, 80),
  ('auth_failed', 'sync', 'immediate', true, 'critical', array['owner']::public.tenant_role[],
    '{}', '{}',
    interval '1 hour', null, true, false, 90),
  ('sync_stale', 'sync', 'immediate', true, 'critical', array['owner']::public.tenant_role[],
    '{"threshold_minutes": 90}',
    '{"threshold_minutes": {"type": "integer", "min": 90, "max": 1440}}',
    interval '2 hours', interval '24 hours', true, true, 100),
  ('sync_dispatch_failed', 'sync', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"min_occurrences": 2}',
    '{"min_occurrences": {"type": "integer", "min": 1, "max": 20}}',
    interval '6 hours', null, false, true, 110),
  ('nightly_missing', 'operations', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"hours": 30}',
    '{"hours": {"type": "integer", "min": 26, "max": 96}}',
    interval '24 hours', null, true, false, 120),
  ('job_failed', 'operations', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{}', '{}',
    interval '12 hours', null, false, false, 130),
  ('channel_failed', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{}', '{}',
    interval '24 hours', null, false, false, 140),
  ('digest_failed', 'operations', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{}', '{}',
    interval '24 hours', null, false, false, 150);

create function app.alert_rule_params_valid(p_rule_key text, p_params jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  schema_doc jsonb;
  entry record;
  spec jsonb;
  value_type text;
  number_value numeric;
begin
  if p_params is null then
    return true;
  end if;
  if jsonb_typeof(p_params) <> 'object' then
    return false;
  end if;
  select c.params_schema into schema_doc
  from public.alert_rule_catalog c
  where c.rule_key = p_rule_key;
  if not found then
    return false;
  end if;
  for entry in select e.key, e.value from jsonb_each(p_params) as e loop
    spec := schema_doc -> entry.key;
    if spec is null or jsonb_typeof(spec) <> 'object' then
      return false;
    end if;
    value_type := spec ->> 'type';
    if value_type in ('number', 'integer') then
      if jsonb_typeof(entry.value) <> 'number' then
        return false;
      end if;
      number_value := (entry.value #>> '{}')::numeric;
      if value_type = 'integer' and number_value <> trunc(number_value) then
        return false;
      end if;
      if spec ? 'min' and number_value < (spec ->> 'min')::numeric then
        return false;
      end if;
      if spec ? 'max' and number_value > (spec ->> 'max')::numeric then
        return false;
      end if;
    elsif value_type = 'boolean' then
      if jsonb_typeof(entry.value) <> 'boolean' then
        return false;
      end if;
    elsif value_type = 'time' then
      if jsonb_typeof(entry.value) <> 'string' or (entry.value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return false;
      end if;
    elsif value_type = 'enum' then
      if jsonb_typeof(entry.value) <> 'string' or not coalesce((spec -> 'values') ? (entry.value #>> '{}'), false) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.alert_rule_params_valid(text, jsonb) is 'whether every key of p_params is a parameter of the rule''s params_schema and its value has that parameter''s type and range; executable by authenticated because the invoker validation trigger on alert_rules calls it as the browser''s role';

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid,
  rule_key text not null references public.alert_rule_catalog (rule_key),
  enabled boolean,
  severity public.alert_severity,
  roles public.tenant_role[] check (roles is null or (cardinality(roles) between 1 and 4 and not ('publisher' = any (roles)))),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  cooldown interval check (cooldown is null or cooldown between interval '0' and interval '7 days'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, store_id, rule_key),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

comment on table public.alert_rules is 'tenant and store overrides of alert_rule_catalog; a null column inherits, params merge key by key over the catalogue defaults, and a store row overrides the tenant row for that store; browser writes only by owners with an unlimited scope';
comment on column public.alert_rules.store_id is 'null for the tenant row; a store row is accepted only for a rule whose catalogue row is store_scoped';

create index alert_rules_tenant_rule_idx on public.alert_rules (tenant_id, rule_key);

create table public.channel_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  channel_kind public.channel_kind not null,
  message_class public.message_class not null,
  allowed boolean not null default true,
  window_start time,
  window_end time,
  max_per_day smallint check (max_per_day is null or max_per_day between 1 and 1000),
  cap_window text not null default 'local_day' check (cap_window in ('local_day', 'rolling_24h')),
  max_per_month smallint check (max_per_month is null or max_per_month between 1 and 10000),
  critical_bypass boolean not null default false,
  label text check (label is null or label in ('[QC]', '[AD]')),
  label_position text check (label_position is null or label_position in ('subject', 'text', 'template')),
  opt_out_text text check (opt_out_text is null or char_length(opt_out_text) between 10 and 300),
  sender_info_required boolean not null default false,
  consent_purpose public.consent_purpose,
  requires_consent boolean not null default true,
  interaction_window interval check (interaction_window is null or interaction_window between interval '1 hour' and interval '365 days'),
  api_send_allowed boolean not null default true,
  source_note text not null check (char_length(source_note) between 3 and 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, channel_kind, message_class),
  check ((window_start is null) = (window_end is null)),
  check (window_start is null or window_start <> window_end),
  check (not requires_consent or consent_purpose is not null),
  check (message_class <> 'operational' or consent_purpose is null or consent_purpose = 'notifications'),
  check (message_class <> 'transactional' or consent_purpose = 'loyalty'),
  check (message_class <> 'advertising' or consent_purpose = 'marketing'),
  constraint channel_policies_advertising_floor check (
    message_class <> 'advertising' or not allowed or coalesce(
      requires_consent
      and max_per_day between 1 and 3
      and cap_window = 'rolling_24h'
      and window_start >= time '07:00'
      and window_end <= time '22:00'
      and window_start < window_end
      and not critical_bypass
      and opt_out_text is not null
      and (label is not null or label_position = 'template'),
      false
    )
  ),
  constraint channel_policies_advertising_email check (
    message_class <> 'advertising' or channel_kind <> 'email' or not allowed or coalesce(
      label is not null and label_position = 'subject' and sender_info_required and opt_out_text like '%{hotline}%',
      false
    )
  ),
  constraint channel_policies_internal_kinds check (
    channel_kind not in ('zalo_bot', 'telegram', 'webhook', 'zalo_gmf') or message_class = 'operational' or not allowed
  )
);

comment on table public.channel_policies is 'send rules per channel kind and message class: global defaults (tenant_id null) and tenant overrides; the Decree 91/2020 advertising floor and the internal-only channel rule are CHECK constraints, so no writer can store a policy below them';
comment on column public.channel_policies.window_end is 'end of the allowed sending hours in the reader''s zone; 24:00 is the end of the day and an end at or before the start crosses midnight';
comment on column public.channel_policies.cap_window is 'local_day counts per local day of the reader; rolling_24h counts the last 24 hours (Decree 91/2020 Art. 13(5) for advertising)';
comment on column public.channel_policies.critical_bypass is 'a critical operational alert ignores the window and the daily cap; refused for advertising by the floor';

insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, max_per_month, label, label_position, opt_out_text, sender_info_required, consent_purpose, requires_consent, interaction_window, api_send_allowed, source_note)
values
  (null, 'zalo_bot', 'operational', true, '06:00', '24:00', 20, 'local_day', null, null, null, 'Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.', false, 'notifications', true, null, true, 'tin vận hành nội bộ, không phải quảng cáo (Nghị định 91/2020 Điều 3(1)); giờ yên tĩnh 00:00–06:00'),
  (null, 'telegram', 'operational', true, '06:00', '24:00', 20, 'local_day', null, null, null, 'Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.', false, 'notifications', true, null, true, 'tin vận hành nội bộ, không phải quảng cáo (Nghị định 91/2020 Điều 3(1)); giờ yên tĩnh 00:00–06:00'),
  (null, 'email', 'operational', true, '06:00', '24:00', 20, 'local_day', null, null, null, 'Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.', false, 'notifications', true, null, true, 'tin vận hành nội bộ, không phải quảng cáo (Nghị định 91/2020 Điều 3(1)); giờ yên tĩnh 00:00–06:00'),
  (null, 'webhook', 'operational', true, null, null, 200, 'local_day', null, null, null, null, false, null, false, null, true, 'máy nhận của chủ cửa hàng, chỉ cảnh báo, không có dữ liệu cá nhân'),
  (null, 'zalo_gmf', 'operational', true, null, null, 50, 'local_day', null, null, null, null, false, null, false, null, true, 'tin nhóm, giai đoạn 15; kênh chưa có'),
  (null, 'zalo_oa', 'operational', true, null, null, 20, 'local_day', null, null, null, 'Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.', false, 'notifications', true, interval '7 days', true, 'tư vấn qua OA trong 7 ngày kể từ lần tương tác cuối; kênh chưa có'),
  (null, 'mini_app', 'operational', true, null, null, null, 'local_day', null, null, null, null, false, 'notifications', true, null, true, 'hộp thư trong ứng dụng, giai đoạn 15; kênh chưa có'),
  (null, 'sms', 'operational', false, null, null, null, 'local_day', null, null, null, null, false, null, false, null, true, 'tin nội bộ gửi qua Zalo Bot, e-mail, Telegram hoặc webhook'),
  (null, 'zalo_zbs', 'operational', false, null, null, null, 'local_day', null, null, null, null, false, null, false, null, true, 'tin nội bộ gửi qua Zalo Bot, e-mail, Telegram hoặc webhook'),
  (null, 'zalo_bot', 'transactional', false, null, null, null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'telegram', 'transactional', false, null, null, null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'webhook', 'transactional', false, null, null, null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'zalo_gmf', 'transactional', false, null, null, null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'email', 'transactional', true, '07:00', '22:00', 5, 'local_day', null, null, null, 'Bạn nhận thư này vì đã đăng ký thành viên; tắt trong cài đặt thành viên.', false, 'loyalty', true, null, true, 'tin giao dịch cho thành viên, giai đoạn 17'),
  (null, 'sms', 'transactional', true, '07:00', '22:00', 5, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'tin giao dịch qua SMS; kênh chưa có'),
  (null, 'zalo_oa', 'transactional', true, '07:00', '22:00', null, 'local_day', null, null, null, null, false, 'loyalty', true, interval '7 days', true, 'tư vấn qua API chỉ trong 7 ngày kể từ lần tương tác cuối; kênh chưa có'),
  (null, 'zalo_zbs', 'transactional', true, '06:00', '22:00', null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'khung giờ gửi tin mẫu ZBS; kênh chưa có'),
  (null, 'mini_app', 'transactional', true, null, null, null, 'local_day', null, null, null, null, false, 'loyalty', true, null, true, 'tin trong ứng dụng; kênh chưa có'),
  (null, 'zalo_bot', 'advertising', false, null, null, null, 'local_day', null, null, null, null, false, 'marketing', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'telegram', 'advertising', false, null, null, null, 'local_day', null, null, null, null, false, 'marketing', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'webhook', 'advertising', false, null, null, null, 'local_day', null, null, null, null, false, 'marketing', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'zalo_gmf', 'advertising', false, null, null, null, 'local_day', null, null, null, null, false, 'marketing', true, null, true, 'chỉ dùng cho tin nội bộ (ADR-018)'),
  (null, 'email', 'advertising', true, '07:00', '22:00', 3, 'rolling_24h', null, '[QC]', 'subject', 'Bạn có quyền từ chối nhận tất cả quảng cáo từ chúng tôi: bấm Hủy đăng ký, trả lời thư này với nội dung TU CHOI, hoặc gọi {hotline}.', true, 'marketing', true, null, true, 'Nghị định 91/2020 Điều 13(5), 18, 19, 20(1)–(4): từ chối qua web, e-mail và điện thoại; {hotline} lấy từ thông tin người gửi (giai đoạn 19); khung 07:00–22:00 chặt hơn nghị định, vốn không quy định giờ cho e-mail'),
  (null, 'sms', 'advertising', true, '07:00', '22:00', 3, 'rolling_24h', null, '[QC]', 'text', 'Soạn TC gửi tổng đài để từ chối nhận quảng cáo.', false, 'marketing', true, null, true, 'Nghị định 91/2020 Điều 13(5), 13(6), 15, 16; cần tên định danh đã đăng ký (Điều 13(8)) trước khi giai đoạn 19 bật'),
  (null, 'zalo_zbs', 'advertising', true, '07:00', '22:00', 1, 'rolling_24h', 30, null, 'template', 'Bỏ quan tâm OA hoặc chặn tin để ngừng nhận.', false, 'marketing', true, null, true, 'giới hạn Tag 3 của ZBS; giờ theo mức chặt hơn giữa Zalo và dự thảo nghị định'),
  (null, 'zalo_oa', 'advertising', true, '07:00', '20:00', 1, 'rolling_24h', 30, null, 'template', 'Bỏ quan tâm OA để ngừng nhận tin.', false, 'marketing', true, null, false, 'tin quảng bá OA chỉ gửi từ trang quản lý OA, không qua API'),
  (null, 'mini_app', 'advertising', true, '07:00', '22:00', 3, 'rolling_24h', null, '[QC]', 'text', 'Tắt nhận ưu đãi trong Cài đặt của Mini App.', false, 'marketing', true, null, true, 'ưu đãi trong Mini App, giai đoạn 19');

create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.channel_kind not null,
  provider text not null check (provider in ('zalo_bot', 'telegram', 'brevo', 'resend', 'hmac_webhook', 'zalo_oa', 'zalo_gmf', 'zalo_zbs', 'mini_app', 'sms')),
  label text not null check (char_length(label) between 1 and 60),
  user_id uuid,
  address text check (address is null or char_length(address) between 1 and 320),
  address_hint text check (address_hint is null or char_length(address_hint) <= 40),
  secret_name text not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 4096),
  timezone text,
  status text not null default 'pending' check (status in ('pending', 'active', 'failing', 'disabled')),
  enabled boolean not null default true,
  store_ids uuid[] check (store_ids is null or cardinality(store_ids) between 1 and 50),
  muted_rules text[] not null default '{}',
  consent_record_id uuid references public.consent_records (id) on delete set null,
  linked_at timestamptz,
  last_ok_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  last_error_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  disabled_reason text check (disabled_reason is null or disabled_reason in ('blocked_by_user', 'member_request', 'owner_request', 'consent_withdrawn')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references public.tenant_members (tenant_id, user_id) on delete cascade,
  check (app.notify_secret_name_valid(kind, secret_name)),
  check (kind in ('webhook', 'zalo_gmf') or user_id is not null),
  check (kind <> 'webhook' or (user_id is null and provider = 'hmac_webhook' and coalesce(config ->> 'url' ~ '^https://[^[:space:]/@?#]+(/[^[:space:]?#]*)?$', false))),
  check (kind <> 'zalo_bot' or provider = 'zalo_bot'),
  check (kind <> 'telegram' or provider = 'telegram'),
  check (kind <> 'email' or provider in ('brevo', 'resend')),
  check (kind not in ('zalo_bot', 'telegram') or status = 'pending' or address is not null),
  check (status <> 'active' or linked_at is not null),
  check ((status = 'disabled') = (disabled_reason is not null))
);

create unique index notification_channels_member_kind_key
  on public.notification_channels (tenant_id, user_id, kind, secret_name) where user_id is not null;
create unique index notification_channels_address_key
  on public.notification_channels (tenant_id, kind, secret_name, address) where address is not null;
create index notification_channels_tenant_status_idx on public.notification_channels (tenant_id, status);
create index notification_channels_user_id_idx on public.notification_channels (user_id) where user_id is not null;

comment on table public.notification_channels is 'destinations: one row per place a message can go, the member it belongs to (deleted with the member), the provider and the name of the secret holding its credential; written only by service-side code and security definer functions, and address, secret_name and config are not selectable by authenticated';
comment on column public.notification_channels.address is 'the Zalo Bot or Telegram chat id, learnt only from the member''s own message to the bot; null for e-mail, which sends to the member''s login address, and for a webhook, whose URL is config.url';
comment on column public.notification_channels.address_hint is 'what the screens show instead of the address, for example …3f7a or n…@example.com';
comment on column public.notification_channels.secret_name is 'the environment variable holding the credential (never its value), for example NOTIFY_ZALO_BOT_TOKEN';
comment on column public.notification_channels.config is 'non-secret settings: from_email and from_name for e-mail, url for a webhook (set only by the CLI; no user information, query or fragment)';
comment on column public.notification_channels.timezone is 'the reader''s zone for the send window and the daily cap; null means the tenant''s timezone';
comment on column public.notification_channels.store_ids is 'an optional narrowing of the member''s own store scope, never a widening';
comment on column public.notification_channels.muted_rules is 'catalogue rule keys this destination does not want, for example daily_digest on e-mail while alerts still arrive there';

create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  rule_key text not null references public.alert_rule_catalog (rule_key),
  dedupe_key text not null check (char_length(dedupe_key) <= 200),
  store_id uuid,
  pos_account_id uuid,
  channel_id uuid,
  business_date date,
  severity public.alert_severity not null,
  state text not null default 'open' check (state in ('open', 'resolved')),
  opened_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('cleared', 'recovered', 'instant', 'schedule_disabled', 'day_ended', 'superseded')),
  occurrences integer not null default 1 check (occurrences > 0),
  folded_occurrences integer not null default 0 check (folded_occurrences >= 0),
  last_notified_at timestamptz,
  notifications integer not null default 0 check (notifications >= 0),
  suppressed_reason text check (suppressed_reason is null or suppressed_reason in ('cool_down', 'no_destination', 'root_cause_open')),
  source text not null check (source in ('incremental', 'nightly', 'cli', 'scheduler', 'notify', 'actions')),
  facts jsonb not null default '{}'::jsonb check (app.facts_are_count_only(facts)),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_id) references public.notification_channels (tenant_id, id) on delete cascade,
  check ((state = 'resolved') = (resolved_at is not null)),
  check ((state = 'resolved') = (resolution is not null))
);

create unique index alert_events_one_open_key on public.alert_events (tenant_id, dedupe_key) where state = 'open';
create index alert_events_tenant_opened_idx on public.alert_events (tenant_id, opened_at desc);
create index alert_events_key_notified_idx on public.alert_events (tenant_id, dedupe_key, last_notified_at desc);
create index alert_events_open_account_idx on public.alert_events (pos_account_id) where state = 'open';

comment on table public.alert_events is 'alert episodes: one open row per dedupe key, with occurrences, root-cause folding, the cool-down kept as last_notified_at and the resolution; instant rules open and resolve in one statement; facts are count-only';

create table public.digests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  business_date date not null,
  scope_key text not null check (scope_key ~ '^[0-9a-f]{32}$'),
  store_ids uuid[] not null check (cardinality(store_ids) between 1 and 50),
  all_stores boolean not null,
  state text not null check (state in ('built', 'failed')),
  trigger text check (trigger is null or trigger in ('settled', 'deadline', 'manual')),
  data_state text check (data_state is null or data_state in ('verified', 'unverified', 'unmatched', 'partial', 'no_data')),
  model jsonb,
  model_version smallint,
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  revision smallint not null default 0 check (revision between 0 and 1),
  built_as uuid references auth.users (id) on delete set null,
  built_at timestamptz,
  revised_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, business_date, scope_key),
  check (state <> 'built' or (model is not null and model_version is not null and fingerprint is not null and built_at is not null and trigger is not null and data_state is not null))
);

comment on table public.digests is 'one daily digest per tenant, business date and scope (md5 of the sorted store ids): the versioned model built from the Ngày report as its recipient, with no customer, cashier or member data; a failed build keeps a failed row with its back-off';
comment on column public.digests.scope_key is 'md5 of the scope''s store ids, sorted and joined by commas; members with the same store set share one row';

alter table public.outbound_messages
  alter column sent_at drop not null,
  alter column sent_at drop default,
  add column created_at timestamptz not null default now(),
  add column kind text,
  add column message_class public.message_class,
  add column channel_id uuid,
  add column store_id uuid,
  add column digest_id uuid,
  add column alert_event_id uuid references public.alert_events (id) on delete set null,
  add column business_date date,
  add column severity public.alert_severity,
  add column dedupe_key text,
  add column params jsonb,
  add column title text,
  add column body text,
  add column body_sha256 text,
  add column decision text,
  add column hold_reason text,
  add column not_before timestamptz,
  add column expires_at timestamptz,
  add column attempts smallint not null default 0,
  add column claimed_at timestamptz,
  add column lease_until timestamptz,
  add column send_started_at timestamptz,
  add column last_error_code text,
  add column resend_of uuid references public.outbound_messages (id) on delete set null;

alter table public.outbound_messages
  add constraint outbound_messages_status_check check (status in ('queued', 'held', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'uncertain')),
  add constraint outbound_messages_kind_check check (kind is null or kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved', 'test', 'link_code', 'link_notice', 'link_confirmation')),
  add constraint outbound_messages_queue_shape check (kind is null or (message_class is not null and dedupe_key is not null and (channel_id is not null or status in ('sending', 'sent', 'delivered', 'failed', 'cancelled', 'uncertain')))),
  add constraint outbound_messages_dedupe_key_length check (dedupe_key is null or char_length(dedupe_key) <= 200),
  add constraint outbound_messages_params_count_only check (app.facts_are_count_only(params)),
  add constraint outbound_messages_title_length check (title is null or char_length(title) <= 200),
  add constraint outbound_messages_body_length check (body is null or char_length(body) <= 8000),
  add constraint outbound_messages_body_sha256_shape check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint outbound_messages_attempts_range check (attempts between 0 and 10),
  add constraint outbound_messages_error_code_shape check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  add constraint outbound_messages_sending_shape check (status <> 'sending' or (claimed_at is not null and lease_until is not null)),
  add constraint outbound_messages_sent_shape check (status not in ('sent', 'delivered') or sent_at is not null),
  add foreign key (tenant_id, channel_id) references public.notification_channels (tenant_id, id) on delete set null (channel_id),
  add foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete set null (store_id),
  add foreign key (tenant_id, digest_id) references public.digests (tenant_id, id) on delete set null (digest_id);

create unique index outbound_messages_dedupe_key on public.outbound_messages (tenant_id, dedupe_key) where dedupe_key is not null;
create index outbound_messages_due_idx on public.outbound_messages ((coalesce(not_before, created_at))) where status in ('queued', 'held');
create index outbound_messages_lease_idx on public.outbound_messages (lease_until) where status = 'sending';
create index outbound_messages_channel_activity_idx on public.outbound_messages (channel_id, (coalesce(sent_at, claimed_at))) where channel_id is not null and status in ('sending', 'sent', 'delivered', 'uncertain');
create index outbound_messages_tenant_created_idx on public.outbound_messages (tenant_id, created_at desc);
create index outbound_messages_digest_idx on public.outbound_messages (digest_id) where digest_id is not null;
create index outbound_messages_alert_event_idx on public.outbound_messages (alert_event_id) where alert_event_id is not null;
create index outbound_messages_resend_of_idx on public.outbound_messages (resend_of) where resend_of is not null;

comment on table public.outbound_messages is 'the outbox and the one-year log of every outbound message: rows with a kind are queue rows whose status follows the state machine enforced by outbound_messages_guard; rows without a kind are log rows of phase 2 and later customer channels';
comment on column public.outbound_messages.sent_at is 'when the provider accepted the message; null while it waits or when it was never sent';
comment on column public.outbound_messages.kind is 'digest, digest_correction, alert, alert_reminder, alert_resolved, test, link_code, link_notice or link_confirmation; null on log rows outside the outbox';
comment on column public.outbound_messages.decision is 'the last send decision: send, the hold reason, or the cancel reason (expired, no_dispatcher_secret, resolved_before_send, destination_inactive, destination_removed, unavailable, class_not_enabled, no_policy, not_allowed, manual_only, no_consent, unsubscribed)';
comment on column public.outbound_messages.params is 'count-only template parameters (app.facts_are_count_only); kept after the body is purged';
comment on column public.outbound_messages.body is 'the rendered text, stored before the first attempt and reused on every retry; set to null after body_retention_days';
comment on column public.outbound_messages.not_before is 'when a queued or held message may be claimed next: the release time of a hold or the back-off of a retry';
comment on column public.outbound_messages.send_started_at is 'set right before the provider call, so lease recovery can tell a message never sent from one whose outcome is unknown';

create table app.notification_link_codes (
  channel_id uuid primary key references public.notification_channels (id) on delete cascade,
  purpose text not null check (purpose in ('bot_link', 'bot_consent', 'email_confirm')),
  code_sha256 text not null unique check (code_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  notice_sent_at timestamptz
);

comment on table app.notification_link_codes is 'pending link codes and acceptances, stored only as hashes: sha256(secret_name:CODE) for a bot code, sha256(channel_id:code) for an e-mail code, sha256(secret_name:chat id) for a bot acceptance waiting 24 hours for the member''s reply; notice_sent_at records when the notice reached the member';

create table app.bot_poll_state (
  secret_name text primary key check (secret_name ~ '^NOTIFY_[A-Z0-9_]{1,60}$'),
  kind public.channel_kind not null check (kind in ('zalo_bot', 'telegram')),
  bot_name text check (bot_name is null or char_length(bot_name) <= 80),
  last_update_id bigint,
  polled_at timestamptz,
  poller text check (poller is null or poller ~ '^[a-z0-9:_-]{1,60}$'),
  poll_lease_until timestamptz
);

comment on table app.bot_poll_state is 'per bot token name: the Telegram offset, the bot''s display name from getMe, and the polling lease that keeps one getUpdates consumer per token; no update content is kept';

create table app.notify_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text check (function_url is null or function_url ~ '^https?://[^[:space:]]+$'),
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 150000),
  ticket_lifetime interval not null default interval '10 minutes' check (ticket_lifetime between interval '1 minute' and interval '1 hour'),
  app_base_url text check (app_base_url is null or app_base_url ~ '^https://[^[:space:]]+/$' or app_base_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/$'),
  retention_days integer not null default 400 check (retention_days between 366 and 1100),
  body_retention_days integer not null default 90 check (body_retention_days between 31 and 400),
  last_tick_at timestamptz,
  last_tick_summary jsonb not null default '{}'::jsonb,
  last_dispatch_at timestamptz,
  last_dispatcher_secrets text[] not null default '{}',
  dispatcher_secrets jsonb not null default '{}'::jsonb check (jsonb_typeof(dispatcher_secrets) = 'object'),
  tickets_expired_unclaimed integer not null default 0 check (tickets_expired_unclaimed >= 0),
  last_ticket_expired_at timestamptz,
  last_housekeeping_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into app.notify_settings default values;

comment on table app.notify_settings is 'single row of the notification dispatcher: the pg_cron schedule state and function URL (disabled until app.enable_notify), the app link base, retention, the last tick and dispatch, and the NOTIFY_ secret names (never values) each runtime reported';

create table app.notify_tickets (
  ticket uuid primary key default gen_random_uuid(),
  reason text not null check (reason in ('schedule', 'kick', 'continue', 'manual')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  request_id bigint
);

create index notify_tickets_expires_at_idx on app.notify_tickets (expires_at);
create index notify_tickets_issued_at_idx on app.notify_tickets (issued_at desc);

comment on table app.notify_tickets is 'single-use tickets for the notify Edge Function (ADR-028): the tick posts only a ticket id, the function claims it before it opens any connection of its own, and an unclaimed ticket expires';

revoke all on table app.notification_link_codes, app.bot_poll_state, app.notify_settings, app.notify_tickets
  from public, anon, authenticated, service_role;

create function app.validate_alert_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  scoped boolean;
  refused text;
begin
  select c.store_scoped into scoped
  from public.alert_rule_catalog c
  where c.rule_key = new.rule_key;
  if not found then
    raise exception 'alert_rules.rule_key % is not a catalogue rule', new.rule_key using errcode = '22023';
  end if;
  if not app.alert_rule_params_valid(new.rule_key, new.params) then
    select string_agg(e.key, ', ' order by e.key) into refused
    from jsonb_each(new.params) as e
    where not app.alert_rule_params_valid(new.rule_key, jsonb_build_object(e.key, e.value));
    raise exception 'alert_rules.params of % refused: %', new.rule_key, coalesce(refused, 'params')
      using errcode = '22023';
  end if;
  if new.store_id is not null and not scoped then
    raise exception 'alert_rules: rule % is not store scoped, so it takes no store row', new.rule_key using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function app.validate_alert_rule() is 'trigger on alert_rules, run as the writer: refuses parameters outside the catalogue schema and a store row for a rule that is not store scoped, with 22023';

create function app.validate_notification_channel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null then
    begin
      perform now() at time zone new.timezone;
    exception when others then
      raise exception 'notification_channels.timezone is not a known time zone' using errcode = '22023';
    end;
  end if;
  if new.store_ids is not null and exists (
    select 1
    from unnest(new.store_ids) as s (store_id)
    where not exists (
      select 1 from public.stores st where st.id = s.store_id and st.tenant_id = new.tenant_id
    )
  ) then
    raise exception 'notification_channels.store_ids holds a store outside the tenant' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(new.muted_rules) as r (rule_key)
    where not exists (select 1 from public.alert_rule_catalog c where c.rule_key = r.rule_key)
  ) then
    raise exception 'notification_channels.muted_rules holds a key that is not a catalogue rule' using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function app.validate_notification_channel() is 'trigger on notification_channels: refuses an unknown IANA zone, a store outside the tenant in store_ids and a muted rule that is not a catalogue key, with 22023';

create function app.cancel_destination_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.outbound_messages o
  set status = 'cancelled', decision = 'destination_removed'
  where o.channel_id = old.id
    and o.status in ('queued', 'held');
  return old;
end;
$$;

comment on function app.cancel_destination_messages() is 'trigger before a destination is deleted: cancels its queued and held messages as destination_removed, so the foreign key never leaves a waiting message without a destination; a message being sent is left to app.finish_send and the lease recovery';

create function app.guard_outbound_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  nullable_keys constant text[] := array['title', 'body', 'params', 'dedupe_key', 'subject_id', 'channel_id', 'store_id', 'digest_id', 'alert_event_id', 'consent_record_id', 'resend_of'];
  transition_keys constant text[] := array['status', 'sent_at', 'provider_message_id', 'last_error_code'];
  old_row jsonb;
  new_row jsonb;
  key text;
begin
  if old.kind is null then
    return new;
  end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at then
    raise exception 'outbound_messages: id, tenant_id, kind and created_at of a queue row never change' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'queued' and new.status in ('held', 'sending', 'cancelled'))
    or (old.status = 'held' and new.status in ('queued', 'sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'queued', 'failed', 'uncertain', 'cancelled'))
    or (old.status = 'sent' and new.status in ('delivered', 'failed'))
    or (old.status = 'uncertain' and new.status in ('sent', 'failed'))
  ) then
    raise exception 'outbound_messages: status % cannot become %', old.status, new.status using errcode = '55000';
  end if;
  if old.status = 'sending' and new.status = 'cancelled' and new.channel_id is not null then
    raise exception 'outbound_messages: a message being sent is cancelled only when its destination vanished' using errcode = '55000';
  end if;
  if old.status in ('sent', 'delivered', 'failed', 'cancelled', 'uncertain') then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    if (old_row - nullable_keys - transition_keys - 'recipient_ref'::text) <> (new_row - nullable_keys - transition_keys - 'recipient_ref'::text) then
      raise exception 'outbound_messages: a finished message is frozen' using errcode = '55000';
    end if;
    foreach key in array nullable_keys loop
      if new_row -> key <> 'null'::jsonb and new_row -> key is distinct from old_row -> key then
        raise exception 'outbound_messages: % of a finished message may only be cleared', key using errcode = '55000';
      end if;
    end loop;
    if new.recipient_ref is distinct from old.recipient_ref and new.recipient_ref <> 'redacted' then
      raise exception 'outbound_messages: recipient_ref of a finished message may only be redacted' using errcode = '55000';
    end if;
    if new.status = old.status and (
      new.sent_at is distinct from old.sent_at
      or new.provider_message_id is distinct from old.provider_message_id
      or new.last_error_code is distinct from old.last_error_code
    ) then
      raise exception 'outbound_messages: sent_at, provider_message_id and last_error_code change only with an allowed status change' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.guard_outbound_message() is 'trigger before an update of outbound_messages: enforces the queue state machine (queued to held, sending or cancelled; held to queued, sending or cancelled; sending to sent, queued, failed, uncertain, or cancelled once the destination vanished; sent to delivered or failed; uncertain to sent or failed) and freezes finished rows except clearing bodies and references, redaction and the foreign keys; raises 55000; rows without a kind are not queue rows and are left alone';

create function app.current_user_channel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
  from public.notification_channels c
  where c.user_id = (select auth.uid());
$$;

comment on function app.current_user_channel_ids() is 'ids of the signed-in member''s own destinations, for the read policy of outbound_messages';

create trigger alert_rules_validate
before insert or update on public.alert_rules
for each row execute function app.validate_alert_rule();

create trigger alert_rules_set_updated_at
before update on public.alert_rules
for each row execute function app.set_updated_at();

create trigger alert_rules_keep_created_by
before update on public.alert_rules
for each row execute function app.keep_created_by();

create trigger channel_policies_set_updated_at
before update on public.channel_policies
for each row execute function app.set_updated_at();

create trigger channel_policies_keep_created_by
before update on public.channel_policies
for each row execute function app.keep_created_by();

create trigger notification_channels_validate
before insert or update on public.notification_channels
for each row execute function app.validate_notification_channel();

create trigger notification_channels_cancel_open_messages
before delete on public.notification_channels
for each row execute function app.cancel_destination_messages();

create trigger notification_channels_set_updated_at
before update on public.notification_channels
for each row execute function app.set_updated_at();

create trigger notification_channels_keep_created_by
before update on public.notification_channels
for each row execute function app.keep_created_by();

create trigger digests_set_updated_at
before update on public.digests
for each row execute function app.set_updated_at();

create trigger outbound_messages_guard
before update on public.outbound_messages
for each row execute function app.guard_outbound_message();

revoke all on function app.channel_kind_available(public.channel_kind) from public;
revoke all on function app.notify_secret_name_valid(public.channel_kind, text) from public;
revoke all on function app.facts_are_count_only(jsonb) from public;
revoke all on function app.alert_rule_params_valid(text, jsonb) from public;
revoke all on function app.validate_alert_rule() from public;
revoke all on function app.validate_notification_channel() from public;
revoke all on function app.cancel_destination_messages() from public;
revoke all on function app.guard_outbound_message() from public;
revoke all on function app.current_user_channel_ids() from public;

grant execute on function app.channel_kind_available(public.channel_kind) to authenticated, service_role;
grant execute on function app.notify_secret_name_valid(public.channel_kind, text) to authenticated, service_role;
grant execute on function app.facts_are_count_only(jsonb) to authenticated, service_role;
grant execute on function app.current_user_channel_ids() to authenticated, service_role;

alter table public.alert_rule_catalog enable row level security;
alter table public.alert_rules enable row level security;
alter table public.channel_policies enable row level security;
alter table public.notification_channels enable row level security;
alter table public.alert_events enable row level security;
alter table public.digests enable row level security;

create policy alert_rule_catalog_select_for_authenticated on public.alert_rule_catalog
  for select to authenticated using (true);

create policy alert_rules_select_for_managers on public.alert_rules
  for select to authenticated
  using (
    app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[])
    and (store_id is null or store_id = any ((select app.current_user_data_store_ids())::uuid[]))
  );
create policy alert_rules_insert_for_owners on public.alert_rules
  for insert to authenticated
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy alert_rules_update_for_owners on public.alert_rules
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy alert_rules_delete_for_owners on public.alert_rules
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy channel_policies_select_for_managers on public.channel_policies
  for select to authenticated
  using (tenant_id is null or app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));
create policy channel_policies_insert_for_owners on public.channel_policies
  for insert to authenticated
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]) and created_by = (select auth.uid()));
create policy channel_policies_update_for_owners on public.channel_policies
  for update to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));
create policy channel_policies_delete_for_owners on public.channel_policies
  for delete to authenticated
  using (tenant_id is not null and app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy notification_channels_select_for_managers_or_member on public.notification_channels
  for select to authenticated
  using (
    app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[])
    or user_id = (select auth.uid())
  );

create policy alert_events_select_for_scope_managers on public.alert_events
  for select to authenticated
  using (app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]));

create policy digests_select_for_managers_of_every_store on public.digests
  for select to authenticated
  using (
    app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[])
    and store_ids <@ (select app.current_user_data_store_ids())::uuid[]
  );

drop policy outbound_messages_select_for_tenant_managers on public.outbound_messages;
create policy outbound_messages_select_for_managers_or_recipient on public.outbound_messages
  for select to authenticated
  using (
    app.has_store_scope(tenant_id, null, array['owner', 'manager']::public.tenant_role[])
    or (store_id is not null and app.has_store_scope(tenant_id, store_id, array['owner', 'manager']::public.tenant_role[]))
    or (channel_id is not null and channel_id = any ((select app.current_user_channel_ids())::uuid[]))
  );

grant insert, update, delete on public.alert_rules, public.channel_policies to authenticated;
grant execute on function app.alert_rule_params_valid(text, jsonb) to authenticated, service_role;

create policy consent_records_notifications_not_inserted_from_browser on public.consent_records
  as restrictive
  for insert to authenticated
  with check (purpose <> 'notifications');
create policy consent_records_notifications_not_updated_from_browser on public.consent_records
  as restrictive
  for update to authenticated
  using (purpose <> 'notifications')
  with check (purpose <> 'notifications');

revoke select on public.notification_channels from authenticated;
grant select (id, tenant_id, kind, provider, label, user_id, address_hint, timezone, status, enabled, store_ids, muted_rules,
  linked_at, last_ok_at, last_error_code, last_error_at, consecutive_failures, disabled_reason, created_at, updated_at)
  on public.notification_channels to authenticated;
