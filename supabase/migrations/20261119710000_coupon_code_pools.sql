create index coupon_codes_store_upper_code_idx on public.coupon_codes (store_id, upper(code));

create function app.import_coupon_codes(
  p_tenant_id uuid,
  p_store_id uuid,
  p_reward_key text,
  p_codes text[],
  p_expires_at timestamptz default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mapping public.coupon_rail_rewards;
  v_received integer := coalesce(cardinality(p_codes), 0);
  v_malformed integer;
  v_duplicates integer;
  v_present integer;
  v_conflicting integer;
  v_inserted integer;
begin
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.tenant_id = p_tenant_id) then
    raise exception 'import_coupon_codes needs a store of the tenant' using errcode = '22023';
  end if;
  select w.* into v_mapping
  from public.coupon_rail_rewards w
  where w.store_id = p_store_id and w.reward_key = p_reward_key;
  if v_mapping.id is null then
    raise exception 'map the reward at the store (coupon_rail_rewards) before importing its codes' using errcode = '22023';
  end if;
  if v_received > 1000 then
    raise exception 'a code pool import holds at most 1,000 codes, as one vendor export does' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= p_at then
    raise exception 'the codes of an import expire after the import' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('coupon_codes:' || p_store_id::text));

  with input as (
    select u.position::integer as position, coalesce(btrim(u.code), '') as code
    from unnest(coalesce(p_codes, '{}'::text[])) with ordinality as u (code, position)
  ),
  judged as (
    select
      i.position,
      i.code,
      case
        when i.code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$' then 'malformed'
        when exists (
          select 1 from input o
          where o.code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$' and upper(o.code) = upper(i.code) and o.position < i.position
        ) then 'duplicate'
        when exists (select 1 from public.coupon_codes k where k.store_id = p_store_id and upper(k.code) = upper(i.code)) then 'present'
        when exists (select 1 from public.coupon_codes k where k.tenant_id = p_tenant_id and upper(k.code) = upper(i.code))
          or exists (select 1 from public.redemptions r where r.tenant_id = p_tenant_id and upper(r.code) = upper(i.code))
          then 'conflicting'
      end as verdict
    from input i
  ),
  inserted as (
    insert into public.coupon_codes (tenant_id, store_id, reward_key, code, crm_programme_external_id, state, imported_at, expires_at)
    select p_tenant_id, p_store_id, p_reward_key, j.code, v_mapping.crm_programme_external_id, 'available', p_at, p_expires_at
    from judged j
    where j.verdict is null
    order by j.position
    returning 1
  )
  select
    (select count(*) from inserted),
    count(*) filter (where j.verdict = 'malformed'),
    count(*) filter (where j.verdict = 'duplicate'),
    count(*) filter (where j.verdict = 'present'),
    count(*) filter (where j.verdict = 'conflicting')
  into v_inserted, v_malformed, v_duplicates, v_present, v_conflicting
  from judged j;
  return jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'malformed', v_malformed,
    'duplicates', v_duplicates,
    'already_present', v_present,
    'conflicting', v_conflicting
  );
end;
$$;

comment on function app.import_coupon_codes(uuid, uuid, text, text[], timestamptz, timestamptz) is 'imports one vendor export of single-use codes (at most 1,000) into the pool of a reward at a store as available, with the CRM programme of the store''s mapping (coupon_rail_rewards, required): a code is 3 to 64 letters, digits, dashes or underscores (else malformed), counted once (a repeat in the import is a duplicate, case ignored), skipped when the store''s pool already holds it (already_present, so a second import changes nothing) or when another pool or a redemption of the tenant uses it (conflicting); refuses an expiry before the import; returns counts only: received, inserted, malformed, duplicates, already_present, conflicting; service role only (fnb loyalty codes import)';

create function app.mark_used_pool_codes(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'mark_used_pool_codes takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  with found as (
    select distinct on (k.id) k.id as code_id, i.id as invoice_id, i.sold_at
    from public.invoices i
    join public.coupon_codes k
      on k.store_id = i.store_id
     and upper(k.code) = upper(btrim(i.voucher_code))
    where i.tenant_id = p_tenant_id
      and i.business_date between p_from and p_to
      and i.voucher_code is not null
      and i.status <> 'voided'
      and k.state <> 'used'
    order by k.id, (i.status = 'completed') desc, i.sold_at, i.external_id collate "C"
  )
  update public.coupon_codes k
  set state = 'used', used_invoice_id = f.invoice_id, used_at = least(f.sold_at, p_at)
  from found f
  where k.id = f.code_id
    and k.state <> 'used';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function app.mark_used_pool_codes(uuid, date, date, timestamptz) is 'the used-code pass after every sync (at most 63 days): a pool code that a non-voided invoice of its store, of a business date in the range, carries as its voucher code (case ignored) becomes used with that invoice (the completed one first, then the earliest) and its sale time, from any other state (available, assigned, quarantined or expired: the till used it); a used code is never touched again, so the pass is idempotent; returns the number of codes marked';

create function app.coupon_code_status(p_tenant_id uuid)
returns table (store_id uuid, store_code text, store_external_id text, reward_key text, state public.coupon_code_state, codes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select k.store_id, s.code, s.external_id, k.reward_key, k.state, count(*)
  from public.coupon_codes k
  join public.stores s on s.id = k.store_id
  where k.tenant_id = p_tenant_id
  group by k.store_id, s.code, s.external_id, k.reward_key, k.state
  order by s.external_id collate "C", k.reward_key collate "C", k.state;
$$;

comment on function app.coupon_code_status(uuid) is 'the pool codes of a tenant counted per store, reward and state; counts only; service role only (fnb loyalty codes status)';

create function app.coupon_codes_in_state(p_tenant_id uuid, p_state public.coupon_code_state)
returns table (store_code text, store_external_id text, reward_key text, code text, crm_programme_external_id text, state_at timestamptz, invoice_external_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.code,
    s.external_id,
    k.reward_key,
    k.code,
    k.crm_programme_external_id,
    case p_state
      when 'used' then k.used_at
      when 'quarantined' then k.quarantined_at
      when 'assigned' then k.assigned_at
      when 'expired' then k.expires_at
      else k.imported_at
    end,
    i.external_id
  from public.coupon_codes k
  join public.stores s on s.id = k.store_id
  left join public.invoices i on i.id = k.used_invoice_id
  where k.tenant_id = p_tenant_id
    and k.state = p_state
  order by s.external_id collate "C", k.reward_key collate "C", k.code collate "C";
$$;

comment on function app.coupon_codes_in_state(uuid, public.coupon_code_state) is 'the pool codes of a tenant in one state, with the store, the reward, the CRM programme, when they reached that state and the invoice that used them, for reconciliation with the vendor; the codes are live values, so the CLI writes them to a file outside the repository and prints counts only; service role only (fnb loyalty codes export)';

create or replace function app.reconcile_rails(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_invoice uuid;
  v_outcome text;
  v_confirmed integer := 0;
  v_earned integer := 0;
  v_used integer;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_rails takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  for v_row in
    select r.id
    from public.redemptions r
    where r.tenant_id = p_tenant_id
      and r.state = 'held'
      and r.rail = 'crm_callback'
      and exists (select 1 from app.voucher_callback_answers a where a.redemption_id = r.id)
    order by r.held_at, r.id
  loop
    v_invoice := app.redemption_confirming_invoice(v_row.id);
    continue when v_invoice is null;
    v_outcome := app.confirm_redemption(v_row.id, v_invoice, p_at);
    if v_outcome is not null then
      v_confirmed := v_confirmed + 1;
      if v_outcome = 'earned' then
        v_earned := v_earned + 1;
      end if;
    end if;
  end loop;
  v_used := app.mark_used_pool_codes(p_tenant_id, p_from, p_to, p_at);
  return jsonb_build_object('callback_confirmed', v_confirmed, 'callback_earned', v_earned, 'pool_codes_used', v_used);
end;
$$;

comment on function app.reconcile_rails(uuid, date, date, timestamptz) is 'the rail step of the loyalty reconciliation after every sync (at most 63 days), under the tenant''s loyalty lock: confirms the held crm_callback redemptions the voucher callback answered whose sale is now a synced completed invoice of the store (app.redemption_confirming_invoice, then app.confirm_redemption, which earns on path D), then runs the used-code pass of the pools (app.mark_used_pool_codes); idempotent; returns counts only: callback_confirmed, callback_earned, pool_codes_used';

revoke all on function app.import_coupon_codes(uuid, uuid, text, text[], timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.mark_used_pool_codes(uuid, date, date, timestamptz) from public, anon, authenticated;
revoke all on function app.coupon_code_status(uuid) from public, anon, authenticated;
revoke all on function app.coupon_codes_in_state(uuid, public.coupon_code_state) from public, anon, authenticated;

grant execute on function app.import_coupon_codes(uuid, uuid, text, text[], timestamptz, timestamptz) to service_role;
grant execute on function app.mark_used_pool_codes(uuid, date, date, timestamptz) to service_role;
grant execute on function app.coupon_code_status(uuid) to service_role;
grant execute on function app.coupon_codes_in_state(uuid, public.coupon_code_state) to service_role;
