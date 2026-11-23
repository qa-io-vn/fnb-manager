-- ADR-046 (1), G-102: a manual adjustment never takes a stamp or point balance below zero.
--
-- app.loyalty_apply_adjustment reads the spendable balance of the membership at the moment of the
-- adjustment (app.loyalty_balance: confirmed earns, adjustments, holds, redemptions, clawbacks and
-- expiries; an earn still waiting for its confirm row is not spendable) and refuses with 22023 a
-- negative part that is larger than it, writing nothing. A positive part is never refused, even on a
-- balance that an older row left below zero. Removed stamps close the oldest active stamps the balance
-- counts, never one of an earn still waiting for its confirm row. Everything else is as in
-- 20261119220000_staff_loyalty.

create or replace function app.loyalty_apply_adjustment(
  p_membership_id uuid,
  p_store_id uuid,
  p_stamps integer,
  p_points integer,
  p_reason text,
  p_approved_by uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_balance record;
  v_entry uuid;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'loyalty_apply_adjustment needs an existing membership' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  if coalesce(p_stamps, 0) < 0 or coalesce(p_points, 0) < 0 then
    select b.stamps, b.points into v_balance from app.loyalty_balance(p_membership_id, p_at) b;
    if (coalesce(p_stamps, 0) < 0 and coalesce(v_balance.stamps, 0) + p_stamps < 0)
      or (coalesce(p_points, 0) < 0 and coalesce(v_balance.points, 0) + p_points < 0)
    then
      raise exception 'an adjustment never takes a balance below zero: % stamps and % points are spendable',
        coalesce(v_balance.stamps, 0), coalesce(v_balance.points, 0)
        using errcode = '22023';
    end if;
  end if;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    reason, approved_by, expires_at, occurred_at
  )
  values (
    v_membership.tenant_id, v_programme.id, p_membership_id, p_store_id, 'adjust', coalesce(p_stamps, 0), coalesce(p_points, 0),
    round(coalesce(p_points, 0) * v_programme.point_value_amount, 2), p_reason, p_approved_by,
    case when p_points > 0 then p_at + make_interval(months => v_programme.points_expiry_months) end, p_at
  )
  returning id into v_entry;
  if p_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_membership.tenant_id, p_membership_id, v_entry, p_at, p_at + make_interval(months => v_programme.stamp_validity_months)
    from generate_series(1, p_stamps);
  elsif p_stamps < 0 then
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (
      select a.id
      from public.stamps a
      where a.membership_id = p_membership_id
        and a.state = 'active'
        and not exists (
          select 1
          from public.loyalty_ledger e
          where e.id = a.earn_entry_id
            and e.pending
            and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
        )
      order by a.expires_at, a.id
      limit -p_stamps
    );
  end if;
  return v_entry;
end;
$$;

comment on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) is 'writes a manual adjustment as a loyalty_ledger adjust row with its reason and approver (points valued at the programme''s point_value_amount and expiring after points_expiry_months); added stamps get stamps rows expiring after stamp_validity_months, removed ones close the oldest active stamps the balance counts (never one of an earn still waiting for its confirm row) as clawed_back; refuses with 22023, writing nothing, a negative part larger than the spendable balance of that kind at the moment (ADR-046: a balance never goes below zero) and an unknown membership; returns the ledger row; internal';
