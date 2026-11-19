alter table public.stores
  add column receipt_numbers_reset public.tran_no_reset_period not null default 'unknown',
  add constraint stores_receipt_numbers_reset_reported check (receipt_numbers_reset in ('daily', 'yearly', 'unknown'));

comment on column public.stores.receipt_numbers_reset is 'how often the POS restarts its receipt numbering as the POS itself reports it (iPOS stores master extra_data.reset_tran_no_period: DAILY, YEARLY), written by every sync: daily, yearly, or unknown when the connector cannot tell; the owner''s tran_no_reset_period overrides it unless unknown (app.receipt_numbers_reset)';

create function app.receipt_numbers_reset(p_owner_setting public.tran_no_reset_period, p_pos_setting public.tran_no_reset_period)
returns public.tran_no_reset_period
language sql
immutable
set search_path = ''
as $$
  select case
    when p_owner_setting is not null and p_owner_setting <> 'unknown' then p_owner_setting
    else coalesce(p_pos_setting, 'unknown')
  end;
$$;

comment on function app.receipt_numbers_reset(public.tran_no_reset_period, public.tran_no_reset_period) is 'the receipt numbering a store follows: the owner''s stores.tran_no_reset_period when the owner set one (not unknown), else what the POS reports in stores.receipt_numbers_reset, else unknown';

create or replace function app.customer_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_app public.zalo_apps;
  v_timezone text;
  v_programme uuid;
begin
  select a.* into v_app from public.zalo_apps a where a.id = v_login.zalo_app_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_login.tenant_id;
  select p.id into v_programme
  from public.loyalty_programmes p
  where p.tenant_id = v_login.tenant_id
    and p.status <> 'draft'
  order by (p.id is not distinct from app.loyalty_active_programme(v_login.tenant_id, (now() at time zone v_timezone)::date)) desc,
    (p.status = 'active') desc, p.starts_on desc, p.id
  limit 1;
  return jsonb_build_object(
    'programme', app.customer_programme(v_programme),
    'oa_id', (select o.external_id from public.oas o where o.brand_id = v_app.brand_id),
    'legal', jsonb_build_object(
      'entity_name', (select t.name from public.tenants t where t.id = v_login.tenant_id),
      'policy_version', (
        select d.version
        from public.legal_documents d
        where d.tenant_id = v_login.tenant_id and d.kind = 'privacy_notice' and d.status = 'published'
        order by d.language <> 'vi', d.language
        limit 1
      ),
      'documents', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'kind', d.kind,
              'language', d.language,
              'version', d.version,
              'title', d.title,
              'body_markdown', d.body_markdown,
              'published_at', d.published_at
            )
            order by d.kind, d.language <> 'vi', d.language
          )
          from public.legal_documents d
          where d.tenant_id = v_login.tenant_id
            and d.status = 'published'
            and d.kind in ('privacy_notice', 'mini_app_terms')
        ),
        '[]'::jsonb
      )
    ),
    'stores', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'code', s.code, 'name', s.name, 'address', nullif(btrim(s.address), ''), 'opening_hours', s.opening_hours,
            'receipt_numbers_reset', app.receipt_numbers_reset(st.tran_no_reset_period, st.receipt_numbers_reset)
          )
          order by s.name, s.code
        )
        from app.customer_app_stores(v_login.zalo_app_id) s
        join public.stores st on st.id = s.store_id
      ),
      '[]'::jsonb
    ),
    'menu', '[]'::jsonb
  );
end;
$$;

comment on function app.customer_home() is 'the browse-first home of the customer Mini App for any customer session, joined or not: the tenant''s programme (the active one, else the latest that is not a draft) as app.customer_programme, the brand''s OA id, the legal block (tenant name, published privacy_notice version, published privacy_notice and mini_app_terms), the brand''s active stores with a link key (address and opening hours null when unknown) and the receipt numbering they follow (app.receipt_numbers_reset: daily, yearly, never or unknown, so the app can check a receipt number against its date), and no menu highlights yet; never a price';

revoke all on function app.receipt_numbers_reset(public.tran_no_reset_period, public.tran_no_reset_period) from public, anon, authenticated, service_role;
