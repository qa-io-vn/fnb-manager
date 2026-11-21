-- Two customer_member_code calls in flight together (the screen sends two when it opens) could both miss the
-- 30-second reuse rule and each issue a code; the later one replaced the earlier, and the screen could show the
-- replaced one. The calls of one membership at one store now queue behind a transaction advisory lock, so the
-- second one finds the first one's code and answers it again (G-98).

create or replace function app.customer_member_code(p_store text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_store uuid;
  v_store_code text;
  v_store_name text;
  v_live public.pending_checkins;
  v_code text;
  v_issued timestamptz;
  v_expires timestamptz;
begin
  if v_membership.status <> 'active' then
    raise exception 'the membership is not active' using errcode = '42501';
  end if;
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  if not exists (select 1 from public.loyalty_programmes p where p.id = v_membership.programme_id and p.status = 'active') then
    raise exception 'the programme is not active' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_membership.id::text || ':' || v_store::text, 0));
  select s.code, s.name into v_store_code, v_store_name from app.customer_app_stores(v_login.zalo_app_id) s where s.store_id = v_store;
  select c.* into v_live
  from public.pending_checkins c
  where c.membership_id = v_membership.id
    and c.store_id = v_store
    and c.status = 'issued'
    and c.created_at > p_at - interval '30 seconds'
    and c.created_at <= p_at
    and c.expires_at > p_at + interval '60 seconds'
  order by c.created_at desc
  limit 1;
  if v_live.id is not null then
    v_code := v_live.code;
    v_issued := v_live.created_at;
    v_expires := v_live.expires_at;
  else
    select i.code, p_at, i.expires_at into v_code, v_issued, v_expires
    from app.loyalty_issue_checkin_code(v_membership.id, v_store, p_at) i;
  end if;
  return jsonb_build_object(
    'code', v_code,
    'qr_payload', 'fnb-member:1:' || v_store_code || ':' || v_code,
    'store_code', v_store_code,
    'store_name', v_store_name,
    'issued_at', v_issued,
    'refresh_at', least(v_issued + interval '60 seconds', v_expires),
    'expires_at', v_expires
  );
end;
$$;

comment on function app.customer_member_code(text, timestamptz) is 'the dynamic member code of a joined customer at a store of the app''s brand: a 6-digit check-in code from app.loyalty_issue_checkin_code bound to the store, valid for the programme''s checkin_code_ttl_seconds (120 by default) and to be refreshed after 60 seconds, with the QR payload fnb-member:1:<store link key>:<code>; a call within 30 seconds of the last code answers that code again, also when two calls arrive together (they queue on an advisory lock per membership and store); 42501 for a visitor or an inactive membership, 22023 for a store the app does not offer or a programme that is not active';
