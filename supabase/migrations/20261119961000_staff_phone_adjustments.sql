-- G-08: a manual adjustment (and a dispute credit) is refused for the membership of a staff phone, like the earn paths A to D.
-- The staff phone is one on the owner's list or linked to an active roster row (app.loyalty_is_staff_phone).

create or replace function app.staff_request(
  p_store_id uuid,
  p_kind text,
  p_membership_id uuid,
  p_reason text,
  p_stamps integer default 0,
  p_points integer default 0,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_reason text := btrim(p_reason);
  v_stamps integer := coalesce(p_stamps, 0);
  v_points integer := coalesce(p_points, 0);
  v_max_stamps integer;
  v_max_points integer;
  v_request app.loyalty_requests;
  v_entry uuid;
begin
  select s.tenant_id into v_tenant from public.stores s where s.id = p_store_id;
  if v_tenant is null or not app.has_store_scope(v_tenant, p_store_id, array['owner', 'manager', 'staff']::public.tenant_role[]) then
    raise exception 'only an owner, manager or staff member of the store records a loyalty request there' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('adjustment', 'dispute') then
    raise exception 'a loyalty request is an adjustment or a dispute' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id
    where m.id = p_membership_id and m.tenant_id = v_tenant and p.status <> 'draft'
  ) then
    raise exception 'a loyalty request names a membership of the store''s tenant' using errcode = '22023';
  end if;
  if app.loyalty_is_staff_phone(v_tenant, (select c.phone from public.memberships m join public.customers c on c.id = m.customer_id where m.id = p_membership_id)) then
    raise exception 'staff_phone: the membership of a staff phone takes no manual adjustment' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'a loyalty request states its reason in 1 to 200 characters' using errcode = '22023';
  end if;
  if v_stamps not between -20 and 20 or v_points not between -100000 and 100000 then
    raise exception 'an adjustment moves at most 20 stamps and 100,000 points' using errcode = '22023';
  end if;
  if p_kind = 'adjustment' and v_stamps = 0 and v_points = 0 then
    raise exception 'an adjustment moves stamps or points' using errcode = '22023';
  end if;
  if p_kind = 'dispute' and (v_stamps < 0 or v_points < 0) then
    raise exception 'a dispute asks for stamps or points, never takes them' using errcode = '22023';
  end if;
  select t.loyalty_adjust_max_stamps, t.loyalty_adjust_max_points into v_max_stamps, v_max_points
  from public.tenants t where t.id = v_tenant;
  insert into app.loyalty_requests (tenant_id, store_id, membership_id, kind, stamp_delta, point_delta, reason, requested_by, requested_at)
  values (v_tenant, p_store_id, p_membership_id, p_kind, v_stamps, v_points, v_reason, (select auth.uid()), p_at)
  returning * into v_request;
  if p_kind = 'adjustment' and abs(v_stamps) <= v_max_stamps and abs(v_points) <= v_max_points then
    v_entry := app.loyalty_apply_adjustment(p_membership_id, p_store_id, v_stamps, v_points, v_reason, (select auth.uid()), p_at);
    update app.loyalty_requests r
    set status = 'applied', decided_by = (select auth.uid()), decided_at = p_at, entry_id = v_entry
    where r.id = v_request.id
    returning * into v_request;
  end if;
  return jsonb_build_object(
    'request_id', v_request.id,
    'kind', v_request.kind,
    'state', v_request.status,
    'entry_id', v_request.entry_id,
    'requested_at', v_request.requested_at
  );
end;
$$;

comment on function app.staff_request(uuid, text, uuid, text, integer, integer, timestamptz) is 'records a dispute or an adjustment for a member of the store''s tenant as an owner, manager or staff member with the store in scope (42501 otherwise): an adjustment within the tenant''s loyalty_adjust_max_stamps and loyalty_adjust_max_points is applied at once as a ledger adjust row with the reason and the caller as approver (state applied); a larger adjustment and every dispute wait as pending for an owner or manager of the store; 22023 for another kind, a membership of another tenant, a reason outside 1 to 200 characters, more than 20 stamps or 100,000 points, an adjustment that moves nothing or a dispute that takes; returns {request_id, kind, state, entry_id, requested_at}';

comment on function app.staff_request(uuid, text, uuid, text, integer, integer, timestamptz) is 'records a dispute or an adjustment for a member of the store''s tenant as an owner, manager or staff member with the store in scope; refused with 22023 staff_phone for the membership of a staff phone (the owner''s list or an active roster row); an adjustment within the tenant''s limits is applied at once, anything else waits for a decision by someone other than the requester';

create or replace function app.staff_decide_loyalty_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null,
  p_stamps integer default null,
  p_points integer default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request app.loyalty_requests;
  v_reason text := nullif(btrim(p_reason), '');
  v_stamps integer;
  v_points integer;
  v_entry uuid;
begin
  select r.* into v_request from app.loyalty_requests r where r.id = p_request_id for update;
  if v_request.id is null
    or not app.has_store_scope(v_request.tenant_id, v_request.store_id, array['owner', 'manager']::public.tenant_role[])
    or v_request.requested_by is not distinct from (select auth.uid())
  then
    raise exception 'only an owner or manager of the store other than the requester decides a loyalty request' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'the loyalty request is already decided' using errcode = '55000';
  end if;
  if p_decision is null or p_decision not in ('approved', 'refused') then
    raise exception 'a decision is approved or refused' using errcode = '22023';
  end if;
  if v_reason is not null and (char_length(v_reason) > 500 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'a decision''s reason holds at most 500 characters' using errcode = '22023';
  end if;
  if p_decision = 'refused' and v_reason is null then
    raise exception 'a refusal states its reason' using errcode = '22023';
  end if;
  v_stamps := coalesce(p_stamps, v_request.stamp_delta);
  v_points := coalesce(p_points, v_request.point_delta);
  if v_stamps not between -20 and 20 or v_points not between -100000 and 100000 then
    raise exception 'an approval moves at most 20 stamps and 100,000 points' using errcode = '22023';
  end if;
  if p_decision = 'approved' and v_request.kind = 'dispute' and (v_stamps < 0 or v_points < 0) then
    raise exception 'an approved dispute never takes stamps or points' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (v_stamps <> 0 or v_points <> 0) and app.loyalty_is_staff_phone(
    v_request.tenant_id, (select c.phone from public.memberships m join public.customers c on c.id = m.customer_id where m.id = v_request.membership_id)
  ) then
    raise exception 'staff_phone: the membership of a staff phone takes no manual adjustment' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (v_stamps <> 0 or v_points <> 0) then
    v_entry := app.loyalty_apply_adjustment(v_request.membership_id, v_request.store_id, v_stamps, v_points, v_request.reason, (select auth.uid()), p_at);
  end if;
  update app.loyalty_requests r
  set status = p_decision, decided_by = (select auth.uid()), decided_at = p_at, decision_reason = v_reason, entry_id = v_entry
  where r.id = p_request_id
  returning * into v_request;
  return jsonb_build_object(
    'state', v_request.status,
    'refusal', null,
    'request_id', v_request.id,
    'entry_id', v_request.entry_id,
    'decided_at', v_request.decided_at
  );
end;
$$;

comment on function app.staff_decide_loyalty_request(uuid, text, text, integer, integer, timestamptz) is 'approves or refuses a pending loyalty request as an owner or manager of its store who is not the requester (42501 otherwise, also for an unknown request): an approval writes the ledger adjust row with the request''s reason and the caller as approver, with the stamps and points given (the requested ones by default; an approved dispute never takes); a refusal states its reason (22023); a decided request gives 55000; returns {state, refusal (null), request_id, entry_id, decided_at}';

comment on function app.staff_decide_loyalty_request(uuid, text, text, integer, integer, timestamptz) is 'approves or refuses a pending loyalty request as an owner or manager of its store who is not the requester; an approval that would move stamps or points of the membership of a staff phone is refused with 22023 staff_phone (a refusal of the request still works); an approved change becomes a loyalty_ledger adjust row';
