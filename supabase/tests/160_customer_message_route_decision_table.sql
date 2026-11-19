-- Test design: decision table testing (ISTQB 4.2.3) of app.customer_message_route.
-- Conditions: loyalty consent (2) x marketing consent (2) x consultation window (open, stale, none: 3)
-- x per-customer cap (reached, not: 2) x OA quota (reached, not: 2) x sending hours (inside, outside: 2),
-- for a transactional kind (coupon_issued) and an advertising kind (win_back): 192 cells, each with its exact route.
-- Also equivalence classes of enqueue: a message is never queued without the consents it needs (FR-CMP-02).
-- FR-NOT-39, FR-CMP-02, FR-CMP-16; test-gaps G-31/G-32 (consent and messaging rules), risk PR-08.
begin;
select plan(31);

create temp table fx as
select
  gen_random_uuid() as tenant_t, gen_random_uuid() as account_t, gen_random_uuid() as store_1,
  gen_random_uuid() as brand_t, gen_random_uuid() as oa_t, gen_random_uuid() as programme_t,
  ((((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1) + time '12:00') at time zone 'Asia/Ho_Chi_Minh') as noon;

insert into public.tenants (id, slug, name, country_code) select tenant_t, 'route-table-t', 'Route table T', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_t, tenant_t, 'mock', 'route-table-t', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_1, tenant_t, account_t, 'rt-1', 'Synthetic store' from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_t, tenant_t, 'brand-1', 'Synthetic brand', array[store_1] from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_t, tenant_t, brand_t, 'synthetic-rt-oa', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_t, tenant_t, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled) select tenant_t, true, true, true from fx;
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select fx.tenant_t, fx.oa_t, v.ext, v.tag, v.purpose, 'approved'
from fx cross join lateral (values
  ('syn-rt-voucher', 'transaction', 'voucher'),
  ('syn-rt-coupon', 'customer_care', 'coupon_issued'),
  ('syn-rt-winback', 'promotion', 'win_back')
) as v (ext, tag, purpose);
-- the transactional template path has no default per-user cap: the tenant adds one a day
insert into public.channel_policies (tenant_id, channel_kind, message_class, allowed, window_start, window_end, max_per_day, cap_window, label_position, consent_purpose, requires_consent, source_note)
select tenant_t, 'zalo_zbs', 'transactional', true, '06:00', '22:00', 1, 'local_day', null, 'loyalty', true, 'synthetic cap of one a day' from fx;

-- one customer per combination of consent, window and cap
create temp table cells as
select row_number() over (order by l desc, mk desc, w, c desc)::integer as n, l, mk, w, c,
  gen_random_uuid() as customer_id, gen_random_uuid() as member_id
from (values (true), (false)) a (l)
cross join (values (true), (false)) b (mk)
cross join (values ('open'), ('stale'), ('none')) d (w)
cross join (values (true), (false)) e (c);

insert into public.customers (id, tenant_id, phone, name)
select customer_id, (select tenant_t from fx), '0900000' || (200 + n)::text, null from cells;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_id, (select tenant_t from fx), (select programme_t from fx), customer_id, 'mini_app', now() - interval '10 days', (select brand_t from fx) from cells;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select (select tenant_t from fx), 'customer'::public.consent_subject, c.customer_id, p.purpose::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '10 days'
from cells c cross join (values ('loyalty'), ('marketing')) p (purpose);

create function pg_temp.enqueue(p_member uuid, p_kind text)
returns uuid
language sql
as $$
  select app.enqueue_customer_message((select tenant_t from fx), p_member, p_kind, 'rt-' || p_kind || '-' || p_member::text, '{"points": 4}'::jsonb, (select store_1 from fx), null, (select noon from fx));
$$;

create temp table msgs as
select c.n, k.kind, pg_temp.enqueue(c.member_id, k.kind) as id
from cells c cross join (values ('coupon_issued'), ('win_back')) k (kind);

select is((select count(*)::integer from msgs where id is not null), 48, 'while both consents hold, every cell queues its two messages');

-- consents are withdrawn after queueing; enqueue itself refuses without them (checked at the end)
update public.consent_records r set revoked_at = (select noon from fx) - interval '1 minute'
from cells c
where r.subject_id = c.customer_id and r.purpose = 'loyalty' and not c.l;
update public.consent_records r set revoked_at = (select noon from fx) - interval '1 minute'
from cells c
where r.subject_id = c.customer_id and r.purpose = 'marketing' and not c.mk;

-- consultation window: a message to the OA two hours ago, or ten days ago (past the API's 7 days)
select app.link_customer_oa_user((select oa_t from fx), 'syn-rt-user-' || n::text, customer_id) from cells where w in ('open', 'stale');
insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
select (select tenant_t from fx), (select oa_t from fx), encode(sha256(convert_to('rt' || n::text, 'UTF8')), 'hex'), 'user_send_text', 'syn-rt-user-' || n::text,
  (select noon from fx) - case w when 'open' then interval '2 hours' else interval '10 days' end,
  (select noon from fx) - case w when 'open' then interval '2 hours' else interval '10 days' end, 'raw'
from cells where w in ('open', 'stale');

-- per-customer cap: one template already sent today in each class
insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, status, kind, message_class, dedupe_key, params, created_at, claimed_at, sent_at, expires_at)
select (select tenant_t from fx), 'zalo_zbs', 'membership:' || c.member_id::text, 'customer', c.customer_id, 'sent', k.kind, app.customer_message_class(k.kind),
  'customer:' || k.kind || ':cap-' || c.n::text, jsonb_build_object('membership_id', c.member_id::text, 'oa_id', (select oa_t from fx)::text),
  (select noon from fx) - interval '2 hours', (select noon from fx) - interval '2 hours', (select noon from fx) - interval '2 hours', (select noon from fx) + interval '22 hours'
from cells c cross join (values ('points_confirmed'), ('birthday')) k (kind)
where c.c;

create function pg_temp.at_hours(p_inside boolean)
returns timestamptz
language sql
as $$
  select case when p_inside then (select noon from fx) else (select noon from fx) + interval '11 hours' end;
$$;

-- evaluate every cell: quota not reached (1000) and reached (exactly the template rows sent today)
create temp table grid (n integer, kind text, quota_full boolean, inside boolean, actual text, release_at timestamptz);
do $$
declare
  q boolean;
  h boolean;
  sent integer := (select count(*) from public.outbound_messages where channel = 'zalo_zbs' and tenant_id = (select tenant_t from fx));
begin
  foreach q in array array[false, true] loop
    update app.customer_message_settings set zbs_daily_quota = case when q then sent else 1000 end where tenant_id = (select tenant_t from fx);
    foreach h in array array[true, false] loop
      insert into grid
      select m.n, m.kind, q, h, row(r.decision, r.route, r.reason, r.window_kind)::text, r.release_at
      from msgs m
      cross join lateral app.customer_message_route(m.id, pg_temp.at_hours(h)) r
      where m.id is not null;
    end loop;
  end loop;
end $$;

select is((select count(*)::integer from grid), 192, 'the table has 192 cells: 24 customers x 2 kinds x quota x hours');
select is((select count(distinct (n, kind, quota_full, inside))::integer from grid), 192, 'no cell is evaluated twice or skipped');

-- the decision table, written out as rules (first match wins), evaluated back to back against the function
create function pg_temp.expected(p_kind text, l boolean, mk boolean, w text, c boolean, q boolean, h boolean)
returns text
language sql
immutable
as $$
  select case
    when not l then '(cancel,,no_consent,)'
    when p_kind = 'win_back' and not mk then '(cancel,,no_marketing_consent,)'
    when p_kind = 'coupon_issued' and w = 'open' and not h then '(hold,consultation,outside_hours,free)'
    when p_kind = 'coupon_issued' and w = 'open' then '(send,consultation,,free)'
    when not h then '(hold,template,outside_hours,)'
    when c then '(hold,template,daily_cap,)'
    when q then '(hold,template,zbs_quota,)'
    else '(send,template,,)'
  end;
$$;

select is(
  (select count(*)::integer from grid g join cells c using (n) where g.actual is distinct from pg_temp.expected(g.kind, c.l, c.mk, c.w, c.c, g.quota_full, g.inside)),
  0,
  'every one of the 192 cells gets the route the decision table gives'
);

create function pg_temp.cell(p_kind text, l boolean, mk boolean, w text, c boolean, q boolean, h boolean)
returns text
language sql
as $$
  select g.actual from grid g join cells x using (n)
  where g.kind = p_kind and x.l = $2 and x.mk = $3 and x.w = $4 and x.c = $5 and g.quota_full = $6 and g.inside = $7;
$$;

-- literal rows of the table (so the oracle above is itself checked), one per distinct outcome
select is(pg_temp.cell('coupon_issued', true, true, 'open', false, false, true), '(send,consultation,,free)', 'rule: open window, inside hours: the free consultation message');
select is(pg_temp.cell('coupon_issued', true, true, 'open', true, true, true), '(send,consultation,,free)', 'rule: caps and quota do not bind a consultation message');
select is(pg_temp.cell('coupon_issued', true, true, 'open', false, false, false), '(hold,consultation,outside_hours,free)', 'rule: open window, outside hours: held for the OA hours');
select is(pg_temp.cell('coupon_issued', true, true, 'stale', false, false, true), '(send,template,,)', 'rule: stale window, nothing binding: the ZBS template');
select is(pg_temp.cell('coupon_issued', true, true, 'none', false, false, true), '(send,template,,)', 'rule: no OA conversation, nothing binding: the ZBS template');
select is(pg_temp.cell('coupon_issued', true, false, 'none', false, false, true), '(send,template,,)', 'rule: marketing consent is not needed for a transactional message');
select is(pg_temp.cell('coupon_issued', true, true, 'stale', true, false, true), '(hold,template,daily_cap,)', 'rule: the per-customer cap holds a template');
select is(pg_temp.cell('coupon_issued', true, true, 'stale', false, true, true), '(hold,template,zbs_quota,)', 'rule: the OA quota holds a template');
select is(pg_temp.cell('coupon_issued', true, true, 'stale', true, true, true), '(hold,template,daily_cap,)', 'rule: cap before quota when both bind');
select is(pg_temp.cell('coupon_issued', true, true, 'stale', true, true, false), '(hold,template,outside_hours,)', 'rule: hours before cap and quota');
select is(pg_temp.cell('win_back', true, true, 'open', false, false, true), '(send,template,,)', 'rule: a promotion never goes as a consultation message, even in an open window');
select is(pg_temp.cell('win_back', true, true, 'none', true, false, true), '(hold,template,daily_cap,)', 'rule: a second promotion within 24 hours waits');
select is(pg_temp.cell('win_back', true, false, 'none', false, false, true), '(cancel,,no_marketing_consent,)', 'rule: no marketing consent cancels a promotion');
select is(pg_temp.cell('win_back', false, true, 'open', false, false, true), '(cancel,,no_consent,)', 'rule: no loyalty consent cancels, whatever the marketing consent');
select is(pg_temp.cell('coupon_issued', false, false, 'open', false, true, false), '(cancel,,no_consent,)', 'rule: consent before every other condition');

-- release instants of the holds
select is(
  (select min(release_at) from grid g join cells c using (n) where g.kind = 'coupon_issued' and c.l and c.w = 'open' and not g.inside),
  (((select noon from fx) at time zone 'Asia/Ho_Chi_Minh')::date + 1 + time '07:00') at time zone 'Asia/Ho_Chi_Minh',
  'an outside-hours consultation message is released at 07:00 the next local day'
);
select is(
  (select min(release_at) from grid g join cells c using (n) where g.kind = 'coupon_issued' and c.l and c.w = 'none' and not g.inside and not c.c),
  (((select noon from fx) at time zone 'Asia/Ho_Chi_Minh')::date + 1 + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
  'an outside-hours template is released at 06:00 the next local day'
);
select is(
  (select min(release_at) from grid g join cells c using (n) where g.kind = 'win_back' and c.l and c.mk and g.inside and c.c and not g.quota_full),
  (select noon from fx) + interval '22 hours',
  'a capped promotion is released when the first message is 24 hours old'
);
select is(
  (select min(release_at) from grid g join cells c using (n) where g.kind = 'coupon_issued' and c.l and c.w = 'none' and g.inside and g.quota_full and not c.c),
  (((select noon from fx) at time zone 'Asia/Ho_Chi_Minh')::date + 1 + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
  'a message held by the quota is released at the template hours of the next day'
);

-- invariants over the whole grid
select is((select count(*)::integer from grid g where actual like '(hold%' and (release_at is null or release_at <= pg_temp.at_hours(g.inside))), 0, 'every hold has a release instant in the future');
select is((select count(*)::integer from grid g where actual like '(send,template%' and not g.inside), 0, 'no template is sent outside the sending hours');
select is((select count(*)::integer from grid g join cells c using (n) where actual like '(send,template%' and c.c), 0, 'no template is sent past the per-customer cap');
select is((select count(*)::integer from grid g where actual like '(send,template%' and g.quota_full), 0, 'no template is sent once the OA quota is reached');
select is((select count(*)::integer from grid g join cells c using (n) where actual like '(send%' and (not c.l or (g.kind = 'win_back' and not c.mk))), 0, 'nothing is sent without the consent it needs');

-- enqueue refuses without the consent (equivalence classes: loyalty withdrawn, marketing absent, marketing not needed)
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_id from cells where not l limit 1), 'coupon_issued', 'rt-late', '{"points": 1}'::jsonb, null, null, (select noon from fx)),
  null,
  'a message for a customer whose loyalty consent is withdrawn is not queued'
);
select is(
  app.enqueue_customer_message((select tenant_t from fx), (select member_id from cells where l and not mk limit 1), 'win_back', 'rt-late', '{"points": 1}'::jsonb, null, null, (select noon from fx)),
  null,
  'a promotion for a customer without marketing consent is not queued'
);
select isnt(
  app.enqueue_customer_message((select tenant_t from fx), (select member_id from cells where l and not mk limit 1), 'coupon_issued', 'rt-late', '{"points": 1}'::jsonb, null, null, (select noon from fx)),
  null,
  'a transactional message for the same customer is queued'
);

select * from finish();
rollback;
