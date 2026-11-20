do $$
begin
  if exists (select 1 from public.strategy_reports) then
    raise exception 'strategy_plans: strategy_reports already holds rows; move them out before applying this migration';
  end if;
end;
$$;

alter table public.strategy_reports
  add column store_ids uuid[] not null,
  add column plan_format text not null,
  add column prompt_version text not null,
  add column pack_id text not null,
  add column pack_schema_version text not null,
  add column as_of_date date not null,
  add column content_sha256 text not null,
  add column lint jsonb not null,
  add column archived_at timestamptz,
  alter column kpis set not null,
  alter column data_pack set not null;

alter table public.strategy_reports
  add constraint strategy_reports_plan_check check (
    plan_format = 'fnb-plan/1'
    and cardinality(store_ids) between 1 and 10
    and array_position(store_ids, null) is null
    and (
      (cardinality(store_ids) = 1 and store_id = store_ids[1])
      or (cardinality(store_ids) > 1 and store_id is null)
    )
    and horizon in ('30d', '90d', '180d', '12m')
    and language in ('vi', 'en')
    and char_length(title) between 1 and 120
    and octet_length(content_markdown) between 1 and 200000
    and octet_length(data_pack::text) <= 2000000
    and jsonb_typeof(data_pack) = 'object'
    and jsonb_typeof(kpis) = 'object'
    and jsonb_typeof(lint) = 'object'
    and content_sha256 ~ '^[0-9a-f]{64}$'
    and pack_id ~ '^[0-9a-f]{64}$'
    and prompt_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    and pack_schema_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  );

create unique index strategy_reports_tenant_content_sha256_key on public.strategy_reports (tenant_id, content_sha256);
create index strategy_reports_store_ids_idx on public.strategy_reports using gin (store_ids);
create index strategy_reports_tenant_created_at_id_idx on public.strategy_reports (tenant_id, created_at desc, id desc);

comment on column public.strategy_reports.store_ids is 'the 1 to 10 stores of one tenant the plan covers; store_id equals the one store of a single-store plan and is null otherwise';
comment on column public.strategy_reports.content_sha256 is 'sha256 of the normalised plan text as UTF-8; a repeat publish of the same text returns the stored plan';
comment on column public.strategy_reports.lint is 'the lint summary and warning codes the publishing client recorded; screens re-run the lint against data_pack';
comment on column public.strategy_reports.archived_at is 'set when an owner or manager archives the plan; archived plans are listed only on request';

drop trigger strategy_reports_keep_created_by on public.strategy_reports;

create function app.keep_plan_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['title', 'archived_at', 'updated_at', 'created_by'])
       is distinct from (to_jsonb(old) - array['title', 'archived_at', 'updated_at', 'created_by'])
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'plan_immutable' using errcode = '42501', detail = 'a plan''s content and attribution never change; only its title and archived_at do';
  end if;
  return new;
end;
$$;

revoke all on function app.keep_plan_content() from public, anon, authenticated;

create trigger strategy_reports_keep_content
before update on public.strategy_reports
for each row execute function app.keep_plan_content();

create function app.trackable_metric_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'net_revenue', 'gross_revenue', 'invoices', 'avg_ticket', 'items_per_ticket', 'avg_item_price',
    'cash_share', 'voucher_invoice_share', 'member_invoice_share', 'discount_rate',
    'attach_rate_topping', 'attach_rate_snack', 'size_l_share', 'sales_per_opening_hour',
    'invoices_per_opening_hour', 'edit_rate', 'removed_line_rate', 'customer_capture_rate'
  ]::text[];
$$;

create function app.plan_section_titles(language text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case plan_section_titles.language
    when 'vi' then array[
      'Tóm tắt tình hình', 'Điểm mạnh và điểm yếu', 'Sáng kiến ưu tiên', 'Kế hoạch 30/60/90 ngày', 'Thực đơn',
      'Giờ mở cửa và nhân sự', 'Lịch khuyến mãi', 'Rủi ro', 'Dữ liệu cần thu thập', 'Giả định'
    ]::text[]
    when 'en' then array[
      'Situation summary', 'Strengths and weaknesses', 'Priority initiatives', '30/60/90-day plan', 'Menu',
      'Opening hours and staffing', 'Promotion calendar', 'Risks', 'Data to collect', 'Assumptions'
    ]::text[]
  end;
$$;

create function app.plan_fold(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(
      lower(plan_fold.value),
      'ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ',
      'àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ'
    ),
    '\s+', ' ', 'g'
  ));
$$;

create function app.can_manage_stores(tenant_id uuid, store_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(can_manage_stores.store_ids), 0) > 0
    and not exists (
      select 1
      from unnest(can_manage_stores.store_ids) as s(store_id)
      where s.store_id is null
         or not app.has_store_scope(can_manage_stores.tenant_id, s.store_id, array['owner', 'manager']::public.tenant_role[])
    );
$$;

create function app.can_publish_stores(tenant_id uuid, store_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(can_publish_stores.store_ids), 0) > 0
    and not exists (
      select 1
      from unnest(can_publish_stores.store_ids) as s(store_id)
      where s.store_id is null
         or not app.has_store_scope(can_publish_stores.tenant_id, s.store_id, array['owner', 'manager', 'publisher']::public.tenant_role[])
    );
$$;

create function app.plan_front_matter(content text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_end integer;
  v_inside text;
  v_value jsonb;
begin
  if plan_front_matter.content is null or left(plan_front_matter.content, 4) <> E'---\n' then
    return null;
  end if;
  v_end := position(E'\n---\n' in substr(plan_front_matter.content, 4));
  if v_end = 0 then
    return null;
  end if;
  v_inside := substr(plan_front_matter.content, 5, v_end - 1);
  begin
    v_value := v_inside::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(v_value) <> 'object' then
    return null;
  end if;
  return v_value;
end;
$$;

create function app.plan_body(content text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when left(plan_body.content, 4) = E'---\n' and position(E'\n---\n' in substr(plan_body.content, 4)) > 0
      then substr(plan_body.content, 3 + position(E'\n---\n' in substr(plan_body.content, 4)) + 5)
    else plan_body.content
  end;
$$;

create function app.plan_structure_errors(content text, language text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_titles text[];
  v_line text;
  v_heading text[];
  v_text text;
  v_match text[];
  v_level integer;
  v_number integer;
  v_seen integer[] := '{}';
  v_initiatives integer := 0;
  v_last integer := 0;
  v_order_broken boolean := false;
  v_section integer;
begin
  if plan_structure_errors.content is null
     or plan_structure_errors.content = ''
     or not (plan_structure_errors.content is nfc normalized)
     or position(E'\r' in plan_structure_errors.content) > 0
     or left(plan_structure_errors.content, 1) = U&'\FEFF'
     or plan_structure_errors.content ~ E'[ \t]\n'
     or right(plan_structure_errors.content, 1) <> E'\n'
     or plan_structure_errors.content ~ E'\n\n$'
     or plan_structure_errors.content ~ E'^\\s' then
    return array['content_not_normalized'];
  end if;
  if app.plan_front_matter(plan_structure_errors.content) is null then
    return array['front_matter_missing'];
  end if;
  select array_agg(app.plan_fold(t) order by o)
  into v_titles
  from unnest(app.plan_section_titles('vi') || app.plan_section_titles('en')) with ordinality as x(t, o);
  for v_line in
    select l from regexp_split_to_table(app.plan_body(plan_structure_errors.content), E'\n') as l
  loop
    v_heading := regexp_match(v_line, '^ {0,3}(#{1,6})(?:[ \t]+(.*))?$');
    if v_heading is null then
      continue;
    end if;
    v_level := char_length(v_heading[1]);
    if v_level > 3 then
      continue;
    end if;
    v_text := btrim(regexp_replace(coalesce(v_heading[2], ''), '[ \t]+#+[ \t]*$', ''));
    if v_level = 3 then
      if app.plan_fold(v_text) ~ '^(\*\*|__)?\s*(sáng kiến|initiative)\s+[0-9]{1,2}([^0-9]|$)' then
        v_initiatives := v_initiatives + 1;
      end if;
      continue;
    end if;
    v_match := regexp_match(v_text, '^(\*\*|__)(.*)\1$');
    if v_match is not null then
      v_text := btrim(v_match[2]);
    end if;
    v_match := regexp_match(v_text, '^([0-9]{1,2})(?:[.):]|\s*[–—-])?\s+(.*)$');
    if v_match is not null then
      v_text := btrim(v_match[2]);
      v_match := regexp_match(v_text, '^(\*\*|__)(.*)\1$');
      if v_match is not null then
        v_text := btrim(v_match[2]);
      end if;
    end if;
    v_text := regexp_replace(app.plan_fold(v_text), '\s*[:：]$', '');
    v_number := array_position(v_titles, v_text);
    if v_number is null then
      continue;
    end if;
    v_section := ((v_number - 1) % 10) + 1;
    if v_section = any (v_seen) then
      v_errors := v_errors || ('section_extra:' || v_section);
      continue;
    end if;
    if v_section < v_last then
      v_order_broken := true;
    end if;
    v_last := v_section;
    v_seen := v_seen || v_section;
  end loop;
  for v_section in 1..10 loop
    if not (v_section = any (v_seen)) then
      v_errors := v_errors || ('section_missing:' || v_section);
    end if;
  end loop;
  if v_order_broken then
    v_errors := v_errors || 'section_order'::text;
  end if;
  if v_initiatives not between 5 and 7 then
    v_errors := v_errors || ('initiatives_count:' || v_initiatives);
  end if;
  return v_errors;
end;
$$;

create function app.plan_kpi_errors(kpis jsonb, store_ids uuid[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_count integer;
  v_id text;
  v_entry jsonb;
  v_kpi_stores uuid[];
  v_initiative jsonb;
  v_valid boolean;
begin
  if plan_kpi_errors.kpis is null or jsonb_typeof(plan_kpi_errors.kpis) <> 'object' then
    return array['kpi_entry_invalid'];
  end if;
  select count(*) into v_count from jsonb_object_keys(plan_kpi_errors.kpis);
  if v_count not between 1 and 8 then
    v_errors := v_errors || ('kpis_count:' || v_count);
  end if;
  for v_id, v_entry in
    select key, value from jsonb_each(plan_kpi_errors.kpis) order by key
  loop
    if not (v_id = any (app.trackable_metric_ids())) then
      v_errors := v_errors || ('kpi_unknown:' || v_id);
      continue;
    end if;
    v_valid := coalesce(jsonb_typeof(v_entry) = 'object'
      and jsonb_typeof(v_entry -> 'baseline') = 'number'
      and jsonb_typeof(v_entry -> 'target') = 'number'
      and jsonb_typeof(v_entry -> 'scope') = 'string'
      and (v_entry ->> 'scope') ~ '^(ALL|S[0-9]{1,2})$'
      and jsonb_typeof(v_entry -> 'store_ids') = 'array'
      and jsonb_array_length(v_entry -> 'store_ids') between 1 and 10
      and jsonb_typeof(v_entry -> 'due_on') = 'string'
      and (v_entry ->> 'due_on') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (v_entry -> 'window_days') = '28'::jsonb
      and jsonb_typeof(v_entry -> 'initiatives') = 'array'
      and jsonb_array_length(v_entry -> 'initiatives') between 1 and 7
      and coalesce(jsonb_typeof(v_entry -> 'lo'), 'null') in ('number', 'null')
      and coalesce(jsonb_typeof(v_entry -> 'hi'), 'null') in ('number', 'null'), false);
    if v_valid then
      for v_initiative in select value from jsonb_array_elements(v_entry -> 'initiatives') loop
        if jsonb_typeof(v_initiative) <> 'number' or (v_initiative #>> '{}') !~ '^[1-7]$' then
          v_valid := false;
        end if;
      end loop;
    end if;
    if v_valid then
      begin
        select array_agg(value::uuid) into v_kpi_stores from jsonb_array_elements_text(v_entry -> 'store_ids');
        perform (v_entry ->> 'due_on')::date;
      exception when others then
        v_valid := false;
      end;
    end if;
    if not v_valid then
      v_errors := v_errors || ('kpi_entry_invalid:' || v_id);
      continue;
    end if;
    if (v_entry ->> 'target')::numeric = (v_entry ->> 'baseline')::numeric then
      v_errors := v_errors || ('kpi_target_equals_baseline:' || v_id);
    end if;
    if not (v_kpi_stores <@ coalesce(plan_kpi_errors.store_ids, '{}')) then
      v_errors := v_errors || ('kpi_scope_outside_plan:' || v_id);
    end if;
  end loop;
  return v_errors;
end;
$$;

create function app.plan_pack_errors(
  content text,
  title text,
  horizon text,
  language text,
  as_of_date date,
  pack_id text,
  prompt_version text,
  store_ids uuid[],
  kpis jsonb,
  data_pack jsonb
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_front jsonb;
  v_pack_stores uuid[];
  v_w28 integer;
  v_id text;
  v_entry jsonb;
  v_row jsonb;
  v_scope_stores uuid[];
  v_kpi_stores uuid[];
begin
  v_front := app.plan_front_matter(plan_pack_errors.content);
  if v_front is null then
    return array['front_matter_missing'];
  end if;
  if (v_front ->> 'format') is distinct from 'fnb-plan/1' then
    v_errors := v_errors || 'front_matter_mismatch:format'::text;
  end if;
  if (v_front ->> 'pack') is distinct from plan_pack_errors.pack_id then
    v_errors := v_errors || 'front_matter_mismatch:pack'::text;
  end if;
  if (v_front ->> 'title') is distinct from plan_pack_errors.title then
    v_errors := v_errors || 'front_matter_mismatch:title'::text;
  end if;
  if (v_front ->> 'horizon') is distinct from plan_pack_errors.horizon then
    v_errors := v_errors || 'front_matter_mismatch:horizon'::text;
  end if;
  if (v_front ->> 'language') is distinct from plan_pack_errors.language then
    v_errors := v_errors || 'front_matter_mismatch:language'::text;
  end if;
  if jsonb_typeof(v_front -> 'kpis') is distinct from 'object'
     or jsonb_typeof(plan_pack_errors.kpis) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(v_front -> 'kpis') as k)
          is distinct from (select array_agg(k order by k) from jsonb_object_keys(plan_pack_errors.kpis) as k)
     or exists (
       select 1
       from jsonb_each(plan_pack_errors.kpis) as e(key, value)
       where (v_front -> 'kpis' -> e.key -> 'target') is distinct from (e.value -> 'target')
     ) then
    v_errors := v_errors || 'front_matter_mismatch:kpis'::text;
  end if;
  if plan_pack_errors.data_pack is null or jsonb_typeof(plan_pack_errors.data_pack) <> 'object' then
    return v_errors || 'plan_pack_mismatch:pack'::text;
  end if;
  if (plan_pack_errors.data_pack ->> 'pack_id') is distinct from plan_pack_errors.pack_id then
    v_errors := v_errors || 'plan_pack_mismatch:pack_id'::text;
  end if;
  if (plan_pack_errors.data_pack -> 'sample') is distinct from 'false'::jsonb then
    v_errors := v_errors || 'plan_pack_mismatch:sample'::text;
  end if;
  if coalesce(plan_pack_errors.data_pack ->> 'schema_version', '') !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    v_errors := v_errors || 'plan_pack_mismatch:schema_version'::text;
  end if;
  if (plan_pack_errors.data_pack -> 'prompt' ->> 'version') is distinct from plan_pack_errors.prompt_version then
    v_errors := v_errors || 'plan_pack_mismatch:prompt_version'::text;
  end if;
  if (plan_pack_errors.data_pack -> 'request' ->> 'as_of') is distinct from plan_pack_errors.as_of_date::text then
    v_errors := v_errors || 'plan_pack_mismatch:as_of'::text;
  end if;
  if (plan_pack_errors.data_pack -> 'request' ->> 'horizon') is distinct from plan_pack_errors.horizon then
    v_errors := v_errors || 'plan_pack_mismatch:horizon'::text;
  end if;
  begin
    select array_agg((s ->> 'id')::uuid order by (s ->> 'id')::uuid)
    into v_pack_stores
    from jsonb_array_elements(plan_pack_errors.data_pack -> 'request' -> 'stores') as s;
  exception when others then
    v_pack_stores := null;
  end;
  if v_pack_stores is null
     or v_pack_stores is distinct from (select array_agg(s order by s) from unnest(plan_pack_errors.store_ids) as s) then
    return v_errors || 'plan_pack_mismatch:stores'::text;
  end if;
  select o::integer - 1
  into v_w28
  from jsonb_array_elements(plan_pack_errors.data_pack -> 'tables' -> 'kpi' -> 'columns') with ordinality as c(col, o)
  where c.col ->> 'name' = 'w28';
  if v_w28 is null or jsonb_typeof(plan_pack_errors.kpis) <> 'object' then
    return v_errors || 'plan_pack_mismatch:kpi'::text;
  end if;
  for v_id, v_entry in
    select key, value from jsonb_each(plan_pack_errors.kpis) order by key
  loop
    v_row := plan_pack_errors.data_pack -> 'tables' -> 'kpi' -> 'rows' -> ((v_entry ->> 'scope') || '/' || v_id);
    if v_row is null and cardinality(plan_pack_errors.store_ids) = 1 and (v_entry ->> 'scope') = 'S1' then
      v_row := plan_pack_errors.data_pack -> 'tables' -> 'kpi' -> 'rows' -> ('ALL/' || v_id);
    end if;
    begin
      select array_agg((s ->> 'id')::uuid order by (s ->> 'id')::uuid)
      into v_scope_stores
      from jsonb_array_elements(plan_pack_errors.data_pack -> 'request' -> 'stores') as s
      where (v_entry ->> 'scope') = 'ALL' or s ->> 'label' = (v_entry ->> 'scope');
      select array_agg(value::uuid order by value::uuid)
      into v_kpi_stores
      from jsonb_array_elements_text(v_entry -> 'store_ids');
      if v_row is null
         or jsonb_typeof(v_row -> v_w28) is distinct from 'number'
         or (v_row ->> v_w28)::numeric is distinct from (v_entry ->> 'baseline')::numeric
         or v_scope_stores is distinct from v_kpi_stores then
        v_errors := v_errors || ('plan_pack_mismatch:kpi:' || v_id);
      end if;
    exception when others then
      v_errors := v_errors || ('plan_pack_mismatch:kpi:' || v_id);
    end;
  end loop;
  return v_errors;
end;
$$;

create function public.publish_strategy_plan(
  p_store_ids uuid[],
  p_title text,
  p_content_markdown text,
  p_kpis jsonb,
  p_horizon text,
  p_language text,
  p_as_of_date date,
  p_pack_id text,
  p_prompt_version text,
  p_data_pack jsonb,
  p_lint jsonb,
  p_generated_via public.strategy_source
)
returns table (plan_id uuid, already_published boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_stores uuid[];
  v_tenants uuid[];
  v_found integer;
  v_tenant uuid;
  v_errors text[];
  v_sha text;
  v_existing uuid;
  v_recent integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'plan_scope_denied' using errcode = '42501', detail = 'publishing needs a signed-in member';
  end if;
  select array_agg(distinct s order by s) into v_stores from unnest(p_store_ids) as s where s is not null;
  if p_store_ids is null
     or cardinality(p_store_ids) not between 1 and 10
     or array_position(p_store_ids, null) is not null
     or cardinality(v_stores) <> cardinality(p_store_ids) then
    raise exception 'plan_rejected' using errcode = '22023', detail = 'plan_stores_invalid';
  end if;
  select count(*)::integer, array_agg(distinct st.tenant_id)
  into v_found, v_tenants
  from public.stores st
  where st.id = any (v_stores);
  if v_found <> cardinality(v_stores) or cardinality(v_tenants) <> 1 then
    raise exception 'plan_rejected' using errcode = '22023', detail = 'plan_stores_invalid';
  end if;
  v_tenant := v_tenants[1];
  if not app.can_publish_stores(v_tenant, v_stores) then
    raise exception 'plan_scope_denied' using errcode = '42501', detail = 'the caller may not publish for these stores';
  end if;
  v_errors := app.plan_structure_errors(p_content_markdown, p_language);
  if not ('content_not_normalized' = any (v_errors) or 'front_matter_missing' = any (v_errors)) then
    v_errors := v_errors
      || app.plan_kpi_errors(p_kpis, v_stores)
      || app.plan_pack_errors(p_content_markdown, p_title, p_horizon, p_language, p_as_of_date, p_pack_id, p_prompt_version, v_stores, p_kpis, p_data_pack);
  end if;
  if p_lint is null or jsonb_typeof(p_lint) <> 'object' then
    v_errors := v_errors || 'lint_invalid'::text;
  end if;
  if p_title is null or char_length(p_title) not between 1 and 120 then
    v_errors := v_errors || 'title_invalid'::text;
  end if;
  if octet_length(coalesce(p_content_markdown, '')) > 200000 then
    v_errors := v_errors || 'content_too_large'::text;
  end if;
  if cardinality(v_errors) > 0 then
    raise exception 'plan_rejected' using errcode = '22023', detail = array_to_string(v_errors, ', ');
  end if;
  v_sha := encode(sha256(convert_to(p_content_markdown, 'UTF8')), 'hex');
  select r.id into v_existing
  from public.strategy_reports r
  where r.tenant_id = v_tenant and r.content_sha256 = v_sha;
  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;
  select count(*)::integer into v_recent
  from public.strategy_reports r
  where r.tenant_id = v_tenant and r.created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'plan_rejected' using errcode = '22023', detail = 'plan_rate_limited';
  end if;
  begin
    insert into public.strategy_reports (
      tenant_id, store_id, store_ids, horizon, language, generated_via, title, content_markdown,
      data_pack, kpis, created_by, plan_format, prompt_version, pack_id, pack_schema_version,
      as_of_date, content_sha256, lint
    )
    values (
      v_tenant,
      case when cardinality(v_stores) = 1 then v_stores[1] end,
      v_stores, p_horizon, p_language, p_generated_via, p_title, p_content_markdown,
      p_data_pack, p_kpis, v_user, 'fnb-plan/1', p_prompt_version, p_pack_id, p_data_pack ->> 'schema_version',
      p_as_of_date, v_sha, p_lint
    )
    returning id into v_id;
  exception when unique_violation then
    select r.id into v_existing
    from public.strategy_reports r
    where r.tenant_id = v_tenant and r.content_sha256 = v_sha;
    return query select v_existing, true;
    return;
  end;
  return query select v_id, false;
end;
$$;

comment on function public.publish_strategy_plan(uuid[], text, text, jsonb, text, text, date, text, text, jsonb, jsonb, public.strategy_source) is 'the only way a strategy plan is stored (FR-STR-03, FR-STR-04): validates scope (42501 plan_scope_denied), the stores (22023 plan_rejected, detail plan_stores_invalid), the text, the KPIs and the pack (22023 plan_rejected, the codes in detail) and the rate of 20 plans in 24 hours per tenant (plan_rate_limited); stores the plan with its full pack and created_by = the caller; idempotent on the content hash (the stored id with already_published true)';

drop policy strategy_reports_select_for_store_readers on public.strategy_reports;
drop policy strategy_reports_insert_for_scope_publishers on public.strategy_reports;
drop policy strategy_reports_update_for_scope_managers on public.strategy_reports;
drop policy strategy_reports_delete_for_scope_managers on public.strategy_reports;

create policy strategy_reports_select_for_data_readers on public.strategy_reports
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    and store_ids <@ (select app.current_user_data_store_ids())::uuid[]
  );

create policy strategy_reports_update_for_full_scope_managers on public.strategy_reports
  for update to authenticated
  using (app.can_manage_stores(tenant_id, store_ids))
  with check (app.can_manage_stores(tenant_id, store_ids));

create policy strategy_reports_delete_for_full_scope_managers on public.strategy_reports
  for delete to authenticated
  using (app.can_manage_stores(tenant_id, store_ids));

revoke insert on public.strategy_reports from authenticated;

revoke all on function app.trackable_metric_ids() from public, anon, authenticated;
revoke all on function app.plan_section_titles(text) from public, anon, authenticated;
revoke all on function app.plan_fold(text) from public, anon, authenticated;
revoke all on function app.plan_front_matter(text) from public, anon, authenticated;
revoke all on function app.plan_body(text) from public, anon, authenticated;
revoke all on function app.plan_structure_errors(text, text) from public, anon, authenticated;
revoke all on function app.plan_kpi_errors(jsonb, uuid[]) from public, anon, authenticated;
revoke all on function app.plan_pack_errors(text, text, text, text, date, text, text, uuid[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.can_manage_stores(uuid, uuid[]) from public, anon;
revoke all on function app.can_publish_stores(uuid, uuid[]) from public, anon;
grant execute on function app.can_manage_stores(uuid, uuid[]) to authenticated;
grant execute on function app.can_publish_stores(uuid, uuid[]) to authenticated;
revoke all on function public.publish_strategy_plan(uuid[], text, text, jsonb, text, text, date, text, text, jsonb, jsonb, public.strategy_source) from public, anon;
grant execute on function public.publish_strategy_plan(uuid[], text, text, jsonb, text, text, date, text, text, jsonb, jsonb, public.strategy_source) to authenticated;
