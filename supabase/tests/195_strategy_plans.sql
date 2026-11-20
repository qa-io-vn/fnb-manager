begin;
select plan(84);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_id,
  'b1b1b1b1-0000-4000-8000-000000000001'::uuid as manager_all_id,
  'b1b1b1b1-0000-4000-8000-000000000002'::uuid as manager_tea_id,
  'b1b1b1b1-0000-4000-8000-000000000003'::uuid as staff_id,
  'b1b1b1b1-0000-4000-8000-000000000004'::uuid as viewer_id,
  'b1b1b1b1-0000-4000-8000-000000000005'::uuid as publisher_id,
  'b1b1b1b1-0000-4000-8000-000000000006'::uuid as other_owner_id,
  'b1b1b1b1-0000-4000-8000-0000000000a1'::uuid as other_tenant_id,
  'b1b1b1b1-0000-4000-8000-0000000000a2'::uuid as other_pos_account_id,
  'b1b1b1b1-0000-4000-8000-0000000000a3'::uuid as other_store_id;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (values
  (f.manager_all_id, 'plans-manager-all@example.com'),
  (f.manager_tea_id, 'plans-manager-tea@example.com'),
  (f.staff_id, 'plans-staff@example.com'),
  (f.viewer_id, 'plans-viewer@example.com'),
  (f.publisher_id, 'plans-publisher@example.com'),
  (f.other_owner_id, 'plans-other-owner@example.com')
) as u(id, email);

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_id, manager_all_id, 'manager'::public.tenant_role, null::uuid[] from fixture
union all select tenant_id, manager_tea_id, 'manager', array[tea_id] from fixture
union all select tenant_id, staff_id, 'staff', null from fixture
union all select tenant_id, viewer_id, 'viewer', null from fixture
union all select tenant_id, publisher_id, 'publisher', null from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'plans-other-tenant', 'Plans Other Tenant' from fixture;
insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'mock', 'plans-other-account', 'Other POS' from fixture;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'plans-store-x', 'Store X' from fixture;

create function pg_temp.plan_text(p_front jsonb, p_sections integer[], p_initiatives integer, p_language text default 'vi')
returns text
language plpgsql
as $$
declare
  v_text text := E'---\n' || jsonb_pretty(p_front) || E'\n---\n\n# ' || (p_front ->> 'title') || E'\n\n';
  v_titles text[] := app.plan_section_titles(p_language);
  v_section integer;
  v_initiative integer;
begin
  foreach v_section in array p_sections loop
    v_text := v_text || '## ' || v_section || '. ' || v_titles[v_section] || E'\n\nNội dung của mục.\n\n';
    if v_section = 3 then
      for v_initiative in 1..p_initiatives loop
        v_text := v_text || '### Sáng kiến ' || v_initiative || ': Việc số ' || v_initiative
          || E'\n\n- **Căn cứ:** một con số.\n- **KPI:** avg_ticket\n\n';
      end loop;
    end if;
  end loop;
  return rtrim(v_text, E'\n') || E'\n';
end;
$$;

create function pg_temp.front(p_pack text, p_title text, p_kpis jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object('format', 'fnb-plan/1', 'pack', p_pack, 'title', p_title, 'horizon', '90d', 'language', 'vi', 'kpis', p_kpis);
$$;

create function pg_temp.pack(p_pack text, p_stores jsonb, p_rows jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'pack_id', p_pack,
    'sample', false,
    'schema_version', '1.0.0',
    'prompt', jsonb_build_object('version', '1.0.0'),
    'request', jsonb_build_object('as_of', '2026-11-11', 'horizon', '90d', 'stores', p_stores),
    'tables', jsonb_build_object('kpi', jsonb_build_object(
      'columns', '[{"name": "metric", "unit": "id"}, {"name": "w28", "unit": "money"}]'::jsonb,
      'rows', p_rows
    ))
  );
$$;

create function pg_temp.stored_kpi(p_scope text, p_stores uuid[], p_baseline numeric, p_target numeric)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'scope', p_scope, 'store_ids', to_jsonb(p_stores), 'baseline', p_baseline, 'target', p_target,
    'lo', null, 'hi', null, 'initiatives', '[1, 4]'::jsonb, 'due_on', '2027-02-09', 'window_days', 28
  );
$$;

create temp table plans (
  name text primary key,
  store_ids uuid[] not null,
  title text not null,
  content text not null,
  kpis jsonb not null,
  pack_id text not null,
  pack jsonb not null
);

with base as (
  select f.tea_id, f.coffee_id, f.other_store_id,
    repeat('a', 64) as pack_two,
    repeat('b', 64) as pack_tea,
    jsonb_build_array(jsonb_build_object('id', f.tea_id, 'label', 'S1'), jsonb_build_object('id', f.coffee_id, 'label', 'S2')) as two_stores,
    jsonb_build_array(jsonb_build_object('id', f.tea_id, 'label', 'S1')) as tea_store,
    '{"ALL/avg_ticket": ["avg_ticket", 91401.96], "S1/avg_ticket": ["avg_ticket", 88000], "ALL/discount_rate": ["discount_rate", 0.0205]}'::jsonb as rows_two,
    '{"ALL/avg_ticket": ["avg_ticket", 88000]}'::jsonb as rows_tea,
    '{"avg_ticket": {"scope": "ALL", "baseline": 91401.96, "target": 95972, "initiatives": [1, 4]}}'::jsonb as front_kpis
  from fixture f
)
insert into plans
select 'owner', array[tea_id, coffee_id], 'Kế hoạch của chủ',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Kế hoạch của chủ', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'manager', array[coffee_id, tea_id], 'Kế hoạch của quản lý',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Kế hoạch của quản lý', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 6),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'publisher', array[tea_id, coffee_id], 'Kế hoạch từ máy tính',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Kế hoạch từ máy tính', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 7),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'tea', array[tea_id], 'Kế hoạch quán trà',
  pg_temp.plan_text(pg_temp.front(pack_tea, 'Kế hoạch quán trà', '{"avg_ticket": {"scope": "S1", "target": 90000, "initiatives": [1]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('S1', array[tea_id], 88000, 90000)),
  pack_tea, pg_temp.pack(pack_tea, tea_store, rows_tea)
from base
union all
select 'missing7', array[tea_id, coffee_id], 'Thiếu mục bảy',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Thiếu mục bảy', front_kpis), array[1,2,3,4,5,6,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'order', array[tea_id, coffee_id], 'Sai thứ tự',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Sai thứ tự', front_kpis), array[1,2,3,5,4,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'extra', array[tea_id, coffee_id], 'Mục lặp lại',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Mục lặp lại', front_kpis), array[1,2,3,4,5,6,7,8,9,10,8], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'four', array[tea_id, coffee_id], 'Bốn sáng kiến',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Bốn sáng kiến', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 4),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'net_sales', array[tea_id, coffee_id], 'KPI lạ',
  pg_temp.plan_text(pg_temp.front(pack_two, 'KPI lạ', '{"net_sales": {"scope": "ALL", "target": 1, "initiatives": [1]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('net_sales', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 2, 1)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'cash_variance', array[tea_id, coffee_id], 'KPI không theo dõi được',
  pg_temp.plan_text(pg_temp.front(pack_two, 'KPI không theo dõi được', '{"cash_variance": {"scope": "ALL", "target": 1, "initiatives": [1]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('cash_variance', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 2, 1)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'entry', array[tea_id, coffee_id], 'KPI hỏng',
  pg_temp.plan_text(pg_temp.front(pack_two, 'KPI hỏng', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972) - 'window_days'),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'flat', array[tea_id, coffee_id], 'Mục tiêu bằng mức nền',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Mục tiêu bằng mức nền', '{"avg_ticket": {"scope": "ALL", "target": 91401.96, "initiatives": [1, 4]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 91401.96)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'outside', array[tea_id], 'Phạm vi ngoài kế hoạch',
  pg_temp.plan_text(pg_temp.front(pack_tea, 'Phạm vi ngoài kế hoạch', '{"avg_ticket": {"scope": "S1", "target": 90000, "initiatives": [1]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('S1', array[tea_id, coffee_id], 88000, 90000)),
  pack_tea, pg_temp.pack(pack_tea, tea_store, rows_tea)
from base
union all
select 'crlf', array[tea_id, coffee_id], 'Xuống dòng kiểu cũ',
  replace(pg_temp.plan_text(pg_temp.front(pack_two, 'Xuống dòng kiểu cũ', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5), E'\n', E'\r\n'),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'nfd', array[tea_id, coffee_id], 'Chưa chuẩn hóa',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Chưa chuẩn hóa', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5) || '',
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'no_front', array[tea_id, coffee_id], 'Không có phần đầu',
  substr(pg_temp.plan_text(pg_temp.front(pack_two, 'Không có phần đầu', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5), 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'other_pack', array[tea_id, coffee_id], 'Gói khác',
  pg_temp.plan_text(pg_temp.front(repeat('c', 64), 'Gói khác', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'pack_stores', array[tea_id, coffee_id], 'Gói một cửa hàng',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Gói một cửa hàng', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, tea_store, rows_two)
from base
union all
select 'mixed', array[tea_id, other_store_id], 'Hai doanh nghiệp',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Hai doanh nghiệp', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, other_store_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'foreign', array[other_store_id], 'Cửa hàng người khác',
  pg_temp.plan_text(pg_temp.front(pack_tea, 'Cửa hàng người khác', '{"avg_ticket": {"scope": "S1", "target": 90000, "initiatives": [1]}}'::jsonb), array[1,2,3,4,5,6,7,8,9,10], 5),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('S1', array[other_store_id], 88000, 90000)),
  pack_tea, pg_temp.pack(pack_tea, jsonb_build_array(jsonb_build_object('id', other_store_id, 'label', 'S1')), rows_tea)
from base
union all
select 'eleven', array(select gen_random_uuid() from generate_series(1, 11)), 'Mười một cửa hàng',
  pg_temp.plan_text(pg_temp.front(pack_two, 'Mười một cửa hàng', front_kpis), array[1,2,3,4,5,6,7,8,9,10], 5),
  '{}'::jsonb, pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base
union all
select 'english', array[tea_id, coffee_id], 'An English plan',
  pg_temp.plan_text(pg_temp.front(pack_two, 'An English plan', front_kpis) || '{"language": "en"}'::jsonb, array[1,2,3,4,5,6,7,8,9,10], 5, 'en'),
  jsonb_build_object('avg_ticket', pg_temp.stored_kpi('ALL', array[tea_id, coffee_id], 91401.96, 95972)),
  pack_two, pg_temp.pack(pack_two, two_stores, rows_two)
from base;

update plans set content = normalize(content, nfd) where name = 'nfd';

grant select on fixture, plans to authenticated, anon;

create function pg_temp.publish(p_name text, p_via public.strategy_source default 'pasted', p_language text default 'vi')
returns table (plan_id uuid, already_published boolean)
language sql
as $$
  select r.plan_id, r.already_published
  from plans p
  cross join lateral public.publish_strategy_plan(
    p.store_ids, p.title, p.content, p.kpis, '90d', p_language, '2026-11-11'::date, p.pack_id, '1.0.0', p.pack,
    '{"summary": {"initiatives": 5}, "warnings": []}'::jsonb, p_via
  ) r
  where p.name = p_name;
$$;

create function pg_temp.outcome(p_name text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_detail text;
  v_message text;
begin
  perform pg_temp.publish(p_name);
  return 'published';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_message = message_text;
  return v_state || ' ' || v_message || ' ' || coalesce(v_detail, '');
end;
$$;

create function pg_temp.as_user(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create temp table published (name text primary key, plan_id uuid, already_published boolean);
grant all on published to authenticated;

select has_column('public', 'strategy_reports', c, 'strategy_reports has ' || c)
from unnest(array['store_ids', 'plan_format', 'prompt_version', 'pack_id', 'pack_schema_version', 'as_of_date', 'content_sha256', 'lint', 'archived_at']) as c;
select col_not_null('public', 'strategy_reports', 'kpis', 'kpis is not null');
select col_not_null('public', 'strategy_reports', 'data_pack', 'data_pack is not null');
select ok(exists (select 1 from pg_constraint where conname = 'strategy_reports_plan_check' and conrelid = 'public.strategy_reports'::regclass), 'the plan check constraint exists');
select has_index('public', 'strategy_reports', 'strategy_reports_tenant_content_sha256_key', 'unique index on tenant and content hash');
select has_index('public', 'strategy_reports', 'strategy_reports_store_ids_idx', 'GIN index on store_ids');
select has_trigger('public', 'strategy_reports', 'strategy_reports_keep_content', 'the content trigger is in place');
select hasnt_trigger('public', 'strategy_reports', 'strategy_reports_keep_created_by', 'the old attribution trigger is gone from strategy_reports');
select ok(not has_table_privilege('authenticated', 'public.strategy_reports', 'insert'), 'authenticated has no INSERT on strategy_reports');
select ok(not has_function_privilege('anon', 'public.publish_strategy_plan(uuid[], text, text, jsonb, text, text, date, text, text, jsonb, jsonb, public.strategy_source)', 'execute'), 'anon cannot execute publish_strategy_plan');
select ok(has_function_privilege('authenticated', 'public.publish_strategy_plan(uuid[], text, text, jsonb, text, text, date, text, text, jsonb, jsonb, public.strategy_source)', 'execute'), 'authenticated executes publish_strategy_plan');
select ok(not has_function_privilege('authenticated', 'app.plan_structure_errors(text, text)', 'execute') and not has_function_privilege('authenticated', 'app.trackable_metric_ids()', 'execute'), 'validators and constants are not executable by authenticated');
select is(cardinality(app.trackable_metric_ids()), 18, 'eighteen trackable metric ids');
select is(
  (select array_agg(regexp_replace(l, '^## [0-9]+\. ', '') order by o)
   from regexp_split_to_table((select content from plans where name = 'owner'), E'\n') with ordinality as x(l, o)
   where l ~ '^## '),
  app.plan_section_titles('vi'),
  'plan_section_titles(vi) are the headings of the fixture plan'
);
select is((app.plan_section_titles('en'))[7], 'Promotion calendar', 'plan_section_titles(en) names section 7');
select is(app.plan_structure_errors((select content from plans where name = 'owner'), 'vi'), '{}'::text[], 'the owner fixture plan has a clean structure');
select is(app.plan_structure_errors(E'\n' || (select content from plans where name = 'owner'), 'vi'), array['content_not_normalized'], 'a leading blank line gives content_not_normalized');
select is(app.plan_structure_errors(replace((select content from plans where name = 'owner'), '## 7. Lịch khuyến mãi', '## **7) LỊCH KHUYẾN MÃI:**'), 'vi'), '{}'::text[], 'a section heading in capitals, bold, with a parenthesis and a colon is recognised');

set local role authenticated;

select pg_temp.as_user(owner_id) from fixture;
insert into published select 'owner', * from pg_temp.publish('owner');
select is((select already_published from published where name = 'owner'), false, 'an owner publishes a pasted two-store plan');
select results_eq(
  $$ select plan_id, already_published from pg_temp.publish('owner') $$,
  $$ select plan_id, true from published where name = 'owner' $$,
  'publishing identical content again returns the first plan with already_published'
);
select is(pg_temp.outcome('missing7'), '22023 plan_rejected section_missing:7', 'a plan missing section 7 is rejected with section_missing:7 only');
select matches(pg_temp.outcome('order'), '^22023 plan_rejected .*section_order', 'sections out of order give section_order');
select matches(pg_temp.outcome('extra'), '^22023 plan_rejected .*section_extra:8', 'a repeated section gives section_extra');
select matches(pg_temp.outcome('four'), '^22023 plan_rejected .*initiatives_count:4', 'four initiatives give initiatives_count:4');
select matches(pg_temp.outcome('net_sales'), '^22023 plan_rejected .*kpi_unknown:net_sales', 'an unknown KPI id gives kpi_unknown:net_sales');
select matches(pg_temp.outcome('cash_variance'), '^22023 plan_rejected .*kpi_unknown:cash_variance', 'an untrackable KPI id gives kpi_unknown:cash_variance');
select matches(pg_temp.outcome('entry'), '^22023 plan_rejected .*kpi_entry_invalid:avg_ticket', 'a KPI entry without window_days gives kpi_entry_invalid');
select matches(pg_temp.outcome('flat'), '^22023 plan_rejected .*kpi_target_equals_baseline:avg_ticket', 'a target equal to the baseline gives kpi_target_equals_baseline');
select matches(pg_temp.outcome('outside'), '^22023 plan_rejected .*kpi_scope_outside_plan:avg_ticket', 'a KPI over a store outside the plan gives kpi_scope_outside_plan');
select is(pg_temp.outcome('crlf'), '22023 plan_rejected content_not_normalized', 'CRLF line ends give content_not_normalized');
select is(pg_temp.outcome('nfd'), '22023 plan_rejected content_not_normalized', 'decomposed text gives content_not_normalized');
select is(pg_temp.outcome('no_front'), '22023 plan_rejected front_matter_missing', 'a text without front matter gives front_matter_missing');
select matches(pg_temp.outcome('other_pack'), '^22023 plan_rejected .*front_matter_mismatch:pack', 'front matter naming another pack gives front_matter_mismatch:pack');
select matches(pg_temp.outcome('pack_stores'), '^22023 plan_rejected .*plan_pack_mismatch:stores', 'a pack of other stores gives plan_pack_mismatch:stores');
select is(pg_temp.outcome('mixed'), '22023 plan_rejected plan_stores_invalid', 'stores of two tenants give plan_stores_invalid');
select is(pg_temp.outcome('eleven'), '22023 plan_rejected plan_stores_invalid', 'eleven stores give plan_stores_invalid');
select matches(pg_temp.outcome('foreign'), '^42501 plan_scope_denied', 'another tenant''s store gives 42501');
select matches(pg_temp.outcome('english'), '^22023 plan_rejected .*front_matter_mismatch:language', 'a language that differs from the front matter gives front_matter_mismatch:language');
select lives_ok($$ select * from pg_temp.publish('english', 'pasted', 'en') $$, 'an English plan with English headings publishes');

select pg_temp.as_user(manager_all_id) from fixture;
insert into published select 'manager', * from pg_temp.publish('manager');
select is((select already_published from published where name = 'manager'), false, 'a manager with every store in scope publishes');

select pg_temp.as_user(manager_tea_id) from fixture;
select is(pg_temp.outcome('manager'), '42501 plan_scope_denied the caller may not publish for these stores', 'a manager limited to one store cannot publish a two-store plan');
insert into published select 'tea', * from pg_temp.publish('tea');
select is((select already_published from published where name = 'tea'), false, 'a manager limited to one store publishes a plan for that store');

select pg_temp.as_user(publisher_id) from fixture;
insert into published select 'publisher', * from pg_temp.publish('publisher', 'skill');
select is((select already_published from published where name = 'publisher'), false, 'the publisher publishes a skill plan');
select is((select count(*) from public.strategy_reports), 0::bigint, 'the publisher reads no plan');
select throws_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, store_ids, horizon, language, generated_via, title, content_markdown, data_pack, kpis, plan_format, prompt_version, pack_id, pack_schema_version, as_of_date, content_sha256, lint)
     select tenant_id, null, array[tea_id, coffee_id], '90d', 'vi', 'skill', 'Planted', 'x', '{}', '{}', 'fnb-plan/1', '1.0.0', repeat('a', 64), '1.0.0', '2026-11-11', repeat('d', 64), '{}' from fixture $$,
  '42501',
  null,
  'the publisher cannot insert directly'
);
update public.strategy_reports set title = 'Renamed by the publisher';
delete from public.strategy_reports;

select pg_temp.as_user(staff_id) from fixture;
select is((select count(*) from public.strategy_reports), 5::bigint, 'staff with every store sees all five plans');
select pg_temp.as_user(viewer_id) from fixture;
select is((select count(*) from public.strategy_reports), 5::bigint, 'a viewer with every store sees all five plans');
select pg_temp.as_user(manager_tea_id) from fixture;
select results_eq(
  $$ select id from public.strategy_reports $$,
  $$ select plan_id from published where name = 'tea' $$,
  'a manager limited to one store sees that store''s one-store plan and no two-store plan'
);
update public.strategy_reports set title = 'Renamed by the tea manager' where id = (select plan_id from published where name = 'owner');
select pg_temp.as_user(other_owner_id) from fixture;
select is((select count(*) from public.strategy_reports), 0::bigint, 'an owner of another tenant sees no plan');

select pg_temp.as_user(owner_id) from fixture;
select is((select count(*) from public.strategy_reports), 5::bigint, 'the owner sees all five plans');
select is(
  (select title from public.strategy_reports where id = (select plan_id from published where name = 'publisher')),
  'Kế hoạch từ máy tính',
  'the publisher''s update changed nothing'
);
select is(
  (select title from public.strategy_reports where id = (select plan_id from published where name = 'owner')),
  'Kế hoạch của chủ',
  'a manager limited to one store cannot rename a two-store plan'
);
select is(
  (select created_by from public.strategy_reports where id = (select plan_id from published where name = 'publisher')),
  (select publisher_id from fixture),
  'created_by names the publisher who called'
);
select is(
  (select created_by from public.strategy_reports where id = (select plan_id from published where name = 'manager')),
  (select manager_all_id from fixture),
  'created_by names the manager who called'
);
select is(
  (select generated_via::text from public.strategy_reports where id = (select plan_id from published where name = 'owner')),
  'pasted',
  'the owner''s plan is stored as pasted'
);
select is(
  (select content_sha256 from public.strategy_reports where id = (select plan_id from published where name = 'owner')),
  encode(sha256(convert_to((select content from plans where name = 'owner'), 'UTF8')), 'hex'),
  'content_sha256 is the sha256 of the text'
);
select is(
  (select data_pack from public.strategy_reports where id = (select plan_id from published where name = 'owner')),
  (select pack from plans where name = 'owner'),
  'the full pack is stored beside the plan'
);
select is(
  (select store_id from public.strategy_reports where id = (select plan_id from published where name = 'tea')),
  (select tea_id from fixture),
  'a single-store plan keeps store_id equal to its store'
);
select throws_ok(
  $$ update public.strategy_reports set content_markdown = content_markdown || 'x' where id = (select plan_id from published where name = 'owner') $$,
  '42501',
  'plan_immutable',
  'changing a plan''s content fails with plan_immutable'
);
select throws_ok(
  $$ update public.strategy_reports set kpis = '{}' where id = (select plan_id from published where name = 'owner') $$,
  '42501',
  'plan_immutable',
  'changing a plan''s KPIs fails with plan_immutable'
);
select throws_ok(
  $$ update public.strategy_reports set created_by = (select viewer_id from fixture) where id = (select plan_id from published where name = 'owner') $$,
  '42501',
  'plan_immutable',
  'pointing created_by at someone else fails with plan_immutable'
);
select lives_ok(
  $$ update public.strategy_reports set title = 'Kế hoạch đã đổi tên' where id = (select plan_id from published where name = 'owner') $$,
  'an owner renames a plan'
);
select lives_ok(
  $$ update public.strategy_reports set archived_at = now() where id = (select plan_id from published where name = 'owner') $$,
  'an owner archives a plan'
);
select is(
  (select title || '|' || (archived_at is not null)::text from public.strategy_reports where id = (select plan_id from published where name = 'owner')),
  'Kế hoạch đã đổi tên|true',
  'the rename and the archive are saved'
);

select pg_temp.as_user(viewer_id) from fixture;
delete from public.strategy_reports;
select is((select count(*) from public.strategy_reports), 5::bigint, 'a viewer deletes nothing');

reset role;
select lives_ok(
  $$ delete from auth.users where id = (select publisher_id from fixture) $$,
  'deleting the publisher''s auth user works'
);
select is(
  (select created_by from public.strategy_reports where id = (select plan_id from published where name = 'publisher')),
  null,
  'the plan of the deleted publisher stays with an empty created_by'
);
select is(
  (select count(*) from public.strategy_reports where id = (select plan_id from published where name = 'publisher')),
  1::bigint,
  'the plan of the deleted publisher is kept'
);

set local role anon;
select throws_ok($$ select count(*) from public.strategy_reports $$, '42501', null, 'anon is refused');
select throws_ok($$ select * from pg_temp.publish('owner') $$, '42501', null, 'anon cannot publish');

set local role authenticated;
select pg_temp.as_user(manager_all_id) from fixture;
select lives_ok(
  $$ delete from public.strategy_reports where id = (select plan_id from published where name = 'manager') $$,
  'a manager with every store in scope deletes a plan'
);
select pg_temp.as_user(owner_id) from fixture;
select lives_ok(
  $$ delete from public.strategy_reports where id = (select plan_id from published where name = 'tea') $$,
  'an owner deletes a plan'
);
select is((select count(*) from public.strategy_reports), 3::bigint, 'three plans remain after the deletes');

reset role;
insert into public.strategy_reports (
  tenant_id, store_id, store_ids, horizon, language, generated_via, title, content_markdown, data_pack, kpis,
  plan_format, prompt_version, pack_id, pack_schema_version, as_of_date, content_sha256, lint
)
select r.tenant_id, r.store_id, r.store_ids, r.horizon, r.language, r.generated_via, r.title || ' ' || g, r.content_markdown, r.data_pack, r.kpis,
  r.plan_format, r.prompt_version, r.pack_id, r.pack_schema_version, r.as_of_date, encode(sha256(convert_to(g::text, 'UTF8')), 'hex'), r.lint
from public.strategy_reports r
cross join generate_series(1, 18) as g
where r.id = (select plan_id from published where name = 'owner');

set local role authenticated;
select pg_temp.as_user(owner_id) from fixture;
select is(pg_temp.outcome('manager'), '22023 plan_rejected plan_rate_limited', 'a twenty-first plan within 24 hours gives plan_rate_limited');
select results_eq(
  $$ select plan_id, already_published from pg_temp.publish('owner') $$,
  $$ select plan_id, true from published where name = 'owner' $$,
  'a repeat publish is answered even at the rate limit'
);

reset role;
select is(
  (select count(*) from public.strategy_reports where title in ('Thiếu mục bảy', 'KPI lạ', 'Sai thứ tự', 'Hai doanh nghiệp', 'Cửa hàng người khác')),
  0::bigint,
  'no rejected plan was inserted'
);

select * from finish();
rollback;
