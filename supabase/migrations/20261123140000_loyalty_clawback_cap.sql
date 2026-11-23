-- ADR-046 (2), G-102: a clawback takes back at most what the member still has.
--
-- A clawback of an earn (a voided or edited invoice, a reversed bill) wrote the opposite deltas of the
-- earn whatever had happened since, so a member who had spent or lost the credit went below zero: a
-- clawback after a redemption, after a manual debit or after the earn had expired left -1 stamp and
-- -6 points. Now one writer, app.loyalty_write_clawback, used by app.loyalty_clawback and app.bill_reverse:
--   * an earn still waiting for its confirm row is taken back whole: it was never spendable and never
--     expires while pending, so the pending balance always holds it;
--   * a confirmed earn is taken back up to the member's spendable balance of each kind at that moment
--     (app.loyalty_balance), and an earn that already expired (its stamps' expiry, or the points' expiry of
--     the earn or of its confirm row, is on or before the moment) takes back nothing of that kind: what is
--     left of it is nothing, the rest was spent or expired;
--   * the part that cannot be taken is a write-off the programme absorbs, written on the clawback row as
--     "<reason>; short by <n> stamp(s) and <n> point(s)" (the reason is cut so the whole stays within the
--     200 characters of the column), and app.loyalty_nightly counts it (written_off_stamps,
--     written_off_points) for the clawbacks it writes;
--   * the stamps taken are closed as clawed_back: the earn's own active stamps first, then the member's
--     oldest other spendable stamps, so the stamps rows follow the ledger.
-- The membership row is locked while the balance is read and the row written. Everything else of
-- app.loyalty_clawback (20261119130000), app.bill_reverse (20261120510000) and app.loyalty_nightly_steps
-- (20261119150000, renamed in 20261119310000) is as it was.

create or replace function app.loyalty_write_clawback(p_earn_id uuid, p_reason text, p_approved_by uuid, p_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_earn public.loyalty_ledger;
  v_confirm public.loyalty_ledger;
  v_reason text := btrim(p_reason);
  v_waiting boolean;
  v_balance record;
  v_stamps integer;
  v_points integer;
  v_short_stamps integer;
  v_short_points integer;
  v_suffix text;
  v_entry uuid;
begin
  select l.* into v_earn from public.loyalty_ledger l where l.id = p_earn_id and l.entry_kind = 'earn';
  if v_earn.id is null then
    raise exception 'a clawback reverses an earn' using errcode = '22023';
  end if;
  if v_reason is null or v_reason = '' then
    raise exception 'a clawback states its reason' using errcode = '22023';
  end if;
  perform 1 from public.memberships m where m.id = v_earn.membership_id for update;
  if exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = p_earn_id) then
    return null;
  end if;
  select l.* into v_confirm from public.loyalty_ledger l where l.entry_kind = 'confirm' and l.source_entry_id = p_earn_id;
  v_waiting := v_earn.pending and v_confirm.id is null;
  if v_waiting then
    v_stamps := v_earn.stamp_delta;
    v_points := v_earn.point_delta;
  else
    select b.stamps, b.points into v_balance from app.loyalty_balance(v_earn.membership_id, p_at) b;
    v_stamps := least(v_earn.stamp_delta, greatest(coalesce(v_balance.stamps, 0), 0));
    v_points := least(v_earn.point_delta, greatest(coalesce(v_balance.points, 0), 0));
    if exists (select 1 from public.stamps s where s.earn_entry_id = p_earn_id)
      and not exists (select 1 from public.stamps s where s.earn_entry_id = p_earn_id and s.expires_at > p_at)
    then
      v_stamps := 0;
    end if;
    if coalesce(case when v_earn.pending then v_confirm.expires_at end, v_earn.expires_at) <= p_at then
      v_points := 0;
    end if;
  end if;
  v_short_stamps := v_earn.stamp_delta - v_stamps;
  v_short_points := v_earn.point_delta - v_points;
  if v_short_stamps > 0 or v_short_points > 0 then
    v_suffix := '; short by ' || concat_ws(' and ',
      case when v_short_stamps = 1 then '1 stamp' when v_short_stamps > 1 then v_short_stamps || ' stamps' end,
      case when v_short_points = 1 then '1 point' when v_short_points > 1 then v_short_points || ' points' end
    );
    v_reason := left(v_reason, 200 - char_length(v_suffix)) || v_suffix;
  end if;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    invoice_id, business_date, source_entry_id, bill_id, reason, approved_by, occurred_at
  )
  values (
    v_earn.tenant_id, v_earn.programme_id, v_earn.membership_id, v_earn.store_id, 'clawback', -v_stamps, -v_points,
    case when v_earn.point_delta > 0 then -round(v_earn.value_amount * v_points / v_earn.point_delta, 2) else 0 end,
    v_earn.invoice_id, v_earn.business_date, v_earn.id, v_earn.bill_id, v_reason, p_approved_by, p_at
  )
  on conflict (source_entry_id) where entry_kind = 'clawback' do nothing
  returning id into v_entry;
  if v_entry is not null and v_stamps > 0 then
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (
      select a.id
      from public.stamps a
      where a.membership_id = v_earn.membership_id
        and a.state = 'active'
        and (
          a.earn_entry_id = v_earn.id
          or (
            not v_waiting
            and a.expires_at > p_at
            and not exists (
              select 1
              from public.loyalty_ledger e
              where e.id = a.earn_entry_id
                and e.pending
                and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
            )
          )
        )
      order by (a.earn_entry_id = v_earn.id) desc, a.expires_at, a.id
      limit v_stamps
    );
  end if;
  return v_entry;
end;
$$;

comment on function app.loyalty_write_clawback(uuid, text, uuid, timestamptz) is 'writes the clawback row of an earn (ADR-046): an earn still waiting for its confirm row whole, a confirmed one up to the member''s spendable balance of each kind at the moment and nothing of a kind that already expired; the part not taken is a write-off written on the row''s reason as "short by n"; closes the stamps taken (the earn''s own first, then the oldest spendable ones); null when the earn is already reversed; 22023 for a row that is not an earn or a missing reason; internal';

create or replace function app.loyalty_clawback(p_invoice_id uuid, p_reason text default null, p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
  v_reason text;
  v_earn uuid;
  v_count integer := 0;
begin
  select i.status into v_status from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'loyalty_clawback needs an existing invoice' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason), ''), case when v_status in ('voided', 'edited') then 'invoice_' || v_status::text end);
  if v_reason is null then
    raise exception 'a clawback of a completed invoice states its reason' using errcode = '22023';
  end if;
  for v_earn in
    select l.id
    from public.loyalty_ledger l
    where l.invoice_id = p_invoice_id
      and l.entry_kind = 'earn'
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
    order by l.occurred_at, l.id
  loop
    if app.loyalty_write_clawback(v_earn, v_reason, null, p_at) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function app.loyalty_clawback(uuid, text, timestamptz) is 'reverses every earn of an invoice not yet reversed with a clawback row (app.loyalty_write_clawback, ADR-046): a pending earn whole, a confirmed one up to the member''s spendable balance and nothing of what already expired, the part not taken written on the row as "short by n", so a balance never goes below zero; the reason defaults to invoice_voided or invoice_edited; returns the rows written; service role only';

create or replace function app.bill_reverse(p_bill_id uuid, p_reason text, p_actor uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.bill_captures;
  v_earn public.loyalty_ledger;
  v_count integer;
begin
  select b.* into v_bill from public.bill_captures b where b.id = p_bill_id for update;
  if v_bill.state in ('reversed', 'rejected', 'expired') then
    return;
  end if;
  select l.* into v_earn from public.loyalty_ledger l where l.bill_id = p_bill_id and l.entry_kind = 'earn';
  if v_earn.id is not null and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = v_earn.id) then
    perform app.loyalty_write_clawback(v_earn.id, 'bill_' || p_reason, p_actor, p_at);
  end if;
  if v_earn.id is null and p_reason = 'manager_rejected' then
    update public.bill_captures b
    set state = 'rejected', queue_reason = null, decided_by = p_actor, decided_at = p_at, decision_reason = coalesce(b.decision_reason, 'rejected')
    where b.id = p_bill_id;
    perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_rejected', p_bill_id, v_bill.membership_id, v_bill.total, '{}'::jsonb, p_at);
    return;
  end if;
  update public.bill_captures b
  set state = 'reversed', queue_reason = null, reversed_at = p_at, reversal_reason = p_reason,
      decided_by = coalesce(p_actor, b.decided_by), decided_at = coalesce(b.decided_at, p_at)
  where b.id = p_bill_id;
  perform app.loyalty_audit(v_bill.tenant_id, v_bill.store_id, p_actor, 'bill_reversed', p_bill_id, v_bill.membership_id, v_bill.total,
    jsonb_build_object('reason', p_reason, 'earned', v_earn.id is not null), p_at);
  if p_reason in ('disputed', 'timed_out', 'audit_failed', 'manager_reversed') then
    select count(*) into v_count
    from public.bill_captures b
    where b.store_id = v_bill.store_id and b.business_date = v_bill.business_date and b.reversal_reason = p_reason;
    perform app.loyalty_staff_alert(v_bill.tenant_id, v_bill.store_id,
      case p_reason when 'manager_reversed' then 'reversal' else p_reason end,
      v_bill.store_id::text || coalesce(':' || v_bill.captured_by::text, ''),
      jsonb_build_object('count_today', v_count), p_at);
  end if;
end;
$$;

comment on function app.bill_reverse(uuid, text, uuid, timestamptz) is 'reverses a bill (state -> reversed with reason disputed, timed_out, manager_rejected, manager_reversed or audit_failed): a clawback row (reason bill_<reason>) of its earn through app.loyalty_write_clawback (ADR-046: a pending earn whole, a confirmed one up to the member''s spendable balance, the part not taken written on the row as "short by n", so the balance never goes below zero) with the stamps it takes clawed back; a bill without an earn rejected by a manager becomes rejected; audited; a dispute, a timeout, an audit failure or a manager reversal raises loyalty_staff_anomaly for the store and the staff member with the day''s count; internal';

create or replace function app.loyalty_nightly_steps(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_invoices uuid[] := '{}'::uuid[];
  v_clawbacks integer := 0;
  v_short_stamps bigint := 0;
  v_short_points bigint := 0;
  v_expired jsonb;
  v_programme uuid;
  v_liability integer := 0;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'loyalty_nightly needs an existing tenant' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  for v_invoice in
    select distinct l.invoice_id
    from public.loyalty_ledger l
    join public.invoices i on i.id = l.invoice_id
    where l.tenant_id = p_tenant_id
      and l.entry_kind = 'earn'
      and i.status in ('voided', 'edited')
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
  loop
    v_clawbacks := v_clawbacks + app.loyalty_clawback(v_invoice, null, p_as_of);
    v_invoices := v_invoices || v_invoice;
  end loop;
  -- the write-off of the clawbacks just written: what each earn gave less what its clawback took back
  select coalesce(sum(e.stamp_delta + c.stamp_delta), 0), coalesce(sum(e.point_delta + c.point_delta), 0)
  into v_short_stamps, v_short_points
  from public.loyalty_ledger c
  join public.loyalty_ledger e on e.id = c.source_entry_id
  where c.entry_kind = 'clawback'
    and c.invoice_id = any (v_invoices)
    and c.occurred_at = p_as_of;
  v_expired := app.loyalty_expire(p_tenant_id, p_as_of);
  for v_programme in
    select p.id from public.loyalty_programmes p
    where p.tenant_id = p_tenant_id and p.status in ('active', 'paused')
    order by p.id
  loop
    perform app.loyalty_liability(v_programme, p_as_of);
    v_liability := v_liability + 1;
  end loop;
  return jsonb_build_object(
    'clawbacks', v_clawbacks,
    'written_off_stamps', v_short_stamps,
    'written_off_points', v_short_points,
    'expired_memberships', (v_expired ->> 'memberships')::integer,
    'expired_stamps', (v_expired ->> 'stamps')::integer,
    'expired_points', (v_expired ->> 'points')::integer,
    'liability_rows', v_liability
  );
end;
$$;

comment on function app.loyalty_nightly_steps(uuid, timestamptz) is 'the phase 17 part of the nightly loyalty step, called by app.loyalty_nightly after the redemption release: claws back the earns of invoices the re-pull marked voided or edited (capped at what the member has, ADR-046) and counts the write-off of those clawbacks, expires stamps and points, and stores the liability of each active or paused programme; idempotent for a moment; counts only';

comment on function app.loyalty_nightly(uuid, timestamptz) is 'the nightly loyalty step of a tenant after the nightly sync: first the 24-hour release of expired redemption holds (app.release_redemption_holds), then app.loyalty_nightly_steps (clawbacks of voided or edited invoices, stamp and point expiry, so a returned stamp past its expiry expires the same night, and the liability); idempotent for a moment; counts only: clawbacks, written_off_stamps and written_off_points (what those clawbacks could not take back, ADR-046), expired_memberships, expired_stamps, expired_points, liability_rows, released_holds, late_confirmed_holds, quarantined_codes';

revoke all on function app.loyalty_write_clawback(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.loyalty_write_clawback(uuid, text, uuid, timestamptz) to service_role;
