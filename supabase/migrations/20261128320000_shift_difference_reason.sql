-- The cashier's own reason for a cash difference (Q02 frame 2, counter-app.md section 6 decision 1): when the blind
-- count at "Ra ca" differs, the person who counted gives one of four reasons (wrong change, an order not recorded,
-- petty cash paid out, cause unknown) with a note, by counting again with them; the answer says when a reason is
-- still missing. The manager still confirms the difference with their own note, never on their own shift; a recount
-- that matches closes the shift and clears the reason. The manager PIN at the counter (decision D3) is left for later:
-- the confirmation stays on the manager's own signed-in device.

alter table public.staff_shifts
  add column difference_reason text check (difference_reason in ('wrong_change', 'unrecorded_order', 'petty_cash', 'unknown')),
  add column difference_note text check (difference_note is null or app.native_text_valid(difference_note, 200)),
  add column difference_reason_at timestamptz,
  add constraint staff_shifts_difference_reason_fields_check check (
    (difference_reason is null) = (difference_note is null)
    and (difference_reason is null) = (difference_reason_at is null)
    and (difference_reason is null or (status <> 'open' and cash_difference <> 0))
  );

comment on column public.staff_shifts.difference_reason is 'the counting person''s reason for a cash difference (Q02): wrong_change (Trả nhầm tiền thừa), unrecorded_order (Quên ghi đơn), petty_cash (Chi tiền lặt vặt) or unknown (Chưa rõ nguyên nhân); set only by staff_clock_out on a shift whose count differs, cleared when a recount matches';
comment on column public.staff_shifts.difference_note is 'the counting person''s note with the reason (1 to 200 characters on one line)';
comment on column public.staff_shifts.difference_reason_at is 'when the person gave the reason';

create or replace function app.shift_json(p_shift public.staff_shifts, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_shift.id,
    'store_id', p_shift.store_id,
    'business_date', p_shift.business_date,
    'clock_in_at', p_shift.clock_in_at,
    'clock_out_at', p_shift.clock_out_at,
    'hours', case when p_shift.clock_out_at is not null then round(extract(epoch from p_shift.clock_out_at - p_shift.clock_in_at) / 3600, 2) end,
    'opening_cash', p_shift.opening_cash::bigint,
    'counted_cash', p_shift.counted_cash::bigint,
    'status', p_shift.status,
    'closed_at', p_shift.closed_at,
    'close_note', p_shift.close_note,
    'difference_reason', p_shift.difference_reason,
    'difference_note', p_shift.difference_note,
    'version', p_shift.version
  ) || case when p_shift.status <> 'open' or p_for = 'manager' then jsonb_build_object(
    'expected_cash', p_shift.expected_cash::bigint,
    'cash_difference', p_shift.cash_difference::bigint
  ) else '{}'::jsonb end
  || case when p_for = 'manager' then jsonb_build_object(
    'user_id', p_shift.user_id,
    'name', (select r.display_name from public.staff_roster r where r.tenant_id = p_shift.tenant_id and r.user_id = p_shift.user_id),
    'closed_by', p_shift.closed_by
  ) else '{}'::jsonb end;
$$;

comment on function app.shift_json(public.staff_shifts, text) is 'a shift as its person sees it (the expected cash only once they counted: the count is blind) or as a manager sees it (with who, their roster name and who closed it); both with the counting person''s reason and note for a difference';

drop function public.staff_clock_out(numeric);
drop function app.staff_clock_out(numeric, timestamptz);

create function app.staff_clock_out(p_counted_cash numeric, p_at timestamptz default now(), p_reason text default null, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_shift public.staff_shifts;
  v_until timestamptz;
  v_expected numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or not exists (select 1 from public.tenant_members m where m.user_id = v_uid) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_counted_cash is null or not app.native_price_valid(p_counted_cash, 0, 100000000) then
    raise exception 'the counted cash is a whole number of dong' using errcode = '22023';
  end if;
  if v_reason is not null and v_reason not in ('wrong_change', 'unrecorded_order', 'petty_cash', 'unknown') then
    raise exception 'a reason is wrong_change, unrecorded_order, petty_cash or unknown' using errcode = '22023';
  end if;
  if (v_reason is null) <> (v_note is null) or (v_note is not null and not app.native_text_valid(v_note, 200)) then
    raise exception 'a reason comes with a note of 1 to 200 characters on one line' using errcode = '22023';
  end if;
  select s.* into v_shift from public.staff_shifts s where s.user_id = v_uid and s.status <> 'closed' for update;
  if v_shift.id is null then
    return jsonb_build_object('state', 'refused', 'refusal', 'not_clocked_in', 'shift', null);
  end if;
  if not app.has_store_scope(v_shift.tenant_id, v_shift.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'no longer a member of the shift''s store' using errcode = '42501';
  end if;
  v_until := coalesce(v_shift.clock_out_at, greatest(p_at, v_shift.clock_in_at + interval '1 second'));
  v_expected := v_shift.opening_cash + app.shift_cash_flow(v_shift, v_until);
  update public.staff_shifts s
  set clock_out_at = v_until,
      expected_cash = v_expected,
      counted_cash = p_counted_cash,
      cash_difference = p_counted_cash - v_expected,
      status = case when p_counted_cash = v_expected then 'closed' else 'awaiting_confirmation' end,
      closed_at = case when p_counted_cash = v_expected then p_at end,
      difference_reason = case when p_counted_cash = v_expected then null else coalesce(v_reason, s.difference_reason) end,
      difference_note = case when p_counted_cash = v_expected then null else coalesce(v_note, s.difference_note) end,
      difference_reason_at = case when p_counted_cash = v_expected then null
        when v_reason is not null then p_at else s.difference_reason_at end,
      version = s.version + 1
  where s.id = v_shift.id
  returning * into v_shift;
  return jsonb_build_object('state', v_shift.status, 'refusal', null,
    'reason_required', v_shift.status = 'awaiting_confirmation' and v_shift.difference_reason is null,
    'shift', app.shift_json(v_shift, 'staff'));
end;
$$;

comment on function app.staff_clock_out(numeric, timestamptz, text, text) is '"Ra ca": the person''s blind count of the drawer, compared with the opening cash plus the cash they took during the shift; equal closes the shift (and clears a reason given before), a difference leaves it awaiting a manager''s confirmation with reason_required true until the person gives a reason (wrong_change, unrecorded_order, petty_cash, unknown) and a note by counting again with them (the clock-out time stays the first one; a recount recomputes the difference and closes the shift when it matches); not_clocked_in without a shift; 22023 for a malformed count, reason or note; 42501 for anyone who is not a member';

create function public.staff_clock_out(p_counted_cash numeric, p_reason text default null, p_note text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.staff_clock_out(p_counted_cash, now(), p_reason, p_note); $$;
comment on function public.staff_clock_out(numeric, text, text) is 'RPC for the counter web app ("Ra ca", Q02): app.staff_clock_out at the current time, with the person''s reason and note for a difference';

revoke all on function app.staff_clock_out(numeric, timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.staff_clock_out(numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.staff_clock_out(numeric, text, text) to authenticated;
