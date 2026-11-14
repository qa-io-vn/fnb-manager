create temp table seed_constants as
select
  '11111111-1111-4111-8111-111111111111'::uuid as tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as dev_user_id,
  'dev@example.com'::text as dev_user_email,
  'dev-password-123'::text as dev_user_password,
  '00000000-0000-0000-0000-000000000000'::uuid as auth_instance_id,
  'Asia/Ho_Chi_Minh'::text as store_timezone,
  1500000::numeric as opening_float_amount;

create temp table seed_stores as
select *
from (
  values
    ('22222222-2222-4222-8222-000000000001'::uuid, '33333333-3333-4333-8333-000000000001'::uuid, 'TEA', 'Demo Tea House', '1 Demo Street, Demo City', 'store-ext-001', 'demo-tea-account', 'company-ext-001', 'brand-ext-001', 'Demo Tea House POS',
      '{"mon": [["07:00", "22:30"]], "tue": [["07:00", "22:30"]], "wed": [["07:00", "22:30"]], "thu": [["07:00", "22:30"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]], "sun": [["07:30", "22:30"]]}'::jsonb,
      24, 'configured'::public.e_invoice_status, 'daily'::public.tran_no_reset_period),
    ('22222222-2222-4222-8222-000000000002'::uuid, '33333333-3333-4333-8333-000000000002'::uuid, 'COF', 'Demo Coffee Bar', '2 Demo Avenue, Demo City', 'store-ext-002', 'demo-coffee-account', 'company-ext-002', 'brand-ext-002', 'Demo Coffee Bar POS',
      '{"mon": [["06:30", "22:00"]], "tue": [["06:30", "22:00"]], "wed": [["06:30", "22:00"]], "thu": [["06:30", "22:00"]], "fri": [["06:30", "22:30"]], "sat": [["07:00", "22:30"]], "sun": [["07:00", "22:00"]]}'::jsonb,
      18, 'not_configured'::public.e_invoice_status, 'yearly'::public.tran_no_reset_period)
) as s (store_id, pos_account_id, code, name, address, store_external_id, account_key, external_company_id, external_brand_id, account_display_name, opening_hours, seat_count, e_invoice_status, tran_no_reset_period);

create temp table seed_item_types as
select *
from (
  values
    ('type-01', 'Milk Tea', 'class-01'),
    ('type-02', 'Fruit Tea', 'class-01'),
    ('type-03', 'Coffee', 'class-01'),
    ('type-04', 'Snacks', 'class-02')
) as t (external_id, name, item_class_external_id);

create temp table seed_item_classes as
select *
from (
  values
    ('class-01', 'Drinks'),
    ('class-02', 'Food')
) as c (external_id, name);

create temp table seed_items as
select *
from (
  values
    (1, 'item-01', 'Classic Milk Tea (M)', 'Classic Milk Tea', 'M', 'type-01', 'class-01', 40000),
    (2, 'item-02', 'Classic Milk Tea (L)', 'Classic Milk Tea', 'L', 'type-01', 'class-01', 50000),
    (3, 'item-03', 'Oolong Milk Tea (M)', 'Oolong Milk Tea', 'M', 'type-01', 'class-01', 45000),
    (4, 'item-04', 'Oolong Milk Tea (L)', 'Oolong Milk Tea', 'L', 'type-01', 'class-01', 55000),
    (5, 'item-05', 'Peach Tea (M)', 'Peach Tea', 'M', 'type-02', 'class-01', 40000),
    (6, 'item-06', 'Peach Tea (L)', 'Peach Tea', 'L', 'type-02', 'class-01', 50000),
    (7, 'item-07', 'Lemon Tea (M)', 'Lemon Tea', 'M', 'type-02', 'class-01', 35000),
    (8, 'item-08', 'Lemon Tea (L)', 'Lemon Tea', 'L', 'type-02', 'class-01', 45000),
    (9, 'item-09', 'Black Coffee (M)', 'Black Coffee', 'M', 'type-03', 'class-01', 30000),
    (10, 'item-10', 'Black Coffee (L)', 'Black Coffee', 'L', 'type-03', 'class-01', 35000),
    (11, 'item-11', 'Milk Coffee (M)', 'Milk Coffee', 'M', 'type-03', 'class-01', 35000),
    (12, 'item-12', 'Milk Coffee (L)', 'Milk Coffee', 'L', 'type-03', 'class-01', 40000),
    (13, 'item-13', 'Sunflower Seeds', 'Sunflower Seeds', null, 'type-04', 'class-02', 15000),
    (14, 'item-14', 'Butter Cookie', 'Butter Cookie', null, 'type-04', 'class-02', 20000),
    (15, 'item-15', 'Potato Chips', 'Potato Chips', null, 'type-04', 'class-02', 20000)
) as i (item_no, external_id, name, base_name, size_label, item_type_external_id, item_class_external_id, list_price);

create temp table seed_customizations as
select *
from (
  values
    (1, 'mod-01', '0% Sugar'),
    (2, 'mod-02', '50% Ice'),
    (3, 'mod-03', 'Less Tea')
) as m (modifier_no, external_id, name);

create temp table seed_payment_methods as
select *
from (
  values
    (1, 'pm-01', 'Cash', 'cash'::public.payment_kind),
    (2, 'pm-02', 'QR Wallet', 'ewallet'::public.payment_kind),
    (3, 'pm-03', 'Bank Transfer', 'bank_transfer'::public.payment_kind)
) as p (method_no, external_id, name, kind);

create temp table seed_units as
select *
from (
  values
    ('unit-01', 'Cup'),
    ('unit-02', 'Pack')
) as u (external_id, name);

create temp table seed_sources as
select *
from (
  values
    ('src-01', 'Dine-in', 'OTS'),
    ('src-02', 'Takeaway', 'TA')
) as s (external_id, name, sale_type);

create temp table seed_customers as
select
  c.tenant_id,
  n as customer_no,
  '09000000' || lpad(n::text, 2, '0') as phone,
  'Demo Customer ' || n as name
from seed_constants c
cross join generate_series(1, 5) as n;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  is_sso_user, is_anonymous
)
select
  auth_instance_id, dev_user_id, 'authenticated', 'authenticated', dev_user_email,
  extensions.crypt(dev_user_password, extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', '', '', false, false
from seed_constants;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), dev_user_id, dev_user_id::text, 'email',
  jsonb_build_object('sub', dev_user_id::text, 'email', dev_user_email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from seed_constants;

insert into public.tenants (id, slug, name, country_code, currency_code, timezone, legal_form)
select tenant_id, 'demo-fnb', 'Demo F&B', 'VN', 'VND', store_timezone, 'household_business'
from seed_constants;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_id, dev_user_id, 'owner', null
from seed_constants;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name, external_company_id, external_brand_id, status, last_synced_at)
select s.pos_account_id, c.tenant_id, 'ipos-fabi', s.account_key, s.account_display_name, s.external_company_id, s.external_brand_id, 'active', now()
from seed_stores s
cross join seed_constants c;

insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, address, timezone, business_day_start_minutes, opening_hours, seat_count, opened_on, e_invoice_status, tran_no_reset_period, settings, raw)
select
  s.store_id, c.tenant_id, s.pos_account_id, s.store_external_id, s.code, s.name, s.address, c.store_timezone,
  0,
  s.opening_hours,
  s.seat_count,
  current_date - 400,
  s.e_invoice_status,
  s.tran_no_reset_period,
  '{"incremental_sync": false}'::jsonb,
  jsonb_build_object('store_uid', s.store_external_id, 'store_name', s.name)
from seed_stores s
cross join seed_constants c;

insert into public.item_classes (tenant_id, pos_account_id, external_id, name, raw)
select c.tenant_id, s.pos_account_id, ic.external_id, ic.name, jsonb_build_object('item_class_uid', ic.external_id)
from seed_stores s
cross join seed_constants c
cross join seed_item_classes ic;

insert into public.item_types (tenant_id, pos_account_id, external_id, name, raw)
select c.tenant_id, s.pos_account_id, it.external_id, it.name, jsonb_build_object('item_type_uid', it.external_id, 'item_class_uid', it.item_class_external_id)
from seed_stores s
cross join seed_constants c
cross join seed_item_types it;

insert into public.units (tenant_id, pos_account_id, external_id, name, raw)
select c.tenant_id, s.pos_account_id, u.external_id, u.name, jsonb_build_object('unit_uid', u.external_id)
from seed_stores s
cross join seed_constants c
cross join seed_units u;

insert into public.items (tenant_id, pos_account_id, external_id, name, base_name, size_label, item_type_external_id, item_class_external_id, unit_external_id, unit_name, list_price, takeaway_price, is_modifier, raw)
select
  c.tenant_id, s.pos_account_id, i.external_id, i.name, i.base_name, i.size_label,
  i.item_type_external_id, i.item_class_external_id,
  case when i.item_class_external_id = 'class-01' then 'unit-01' else 'unit-02' end,
  case when i.item_class_external_id = 'class-01' then 'Cup' else 'Pack' end,
  i.list_price, i.list_price, false,
  jsonb_build_object('item_id', i.external_id, 'item_name', i.name, 'price', i.list_price)
from seed_stores s
cross join seed_constants c
cross join seed_items i;

insert into public.store_items (tenant_id, store_id, item_external_id, list_price, takeaway_price, raw)
select c.tenant_id, s.store_id, i.external_id, i.list_price, i.list_price, jsonb_build_object('item_id', i.external_id, 'store_uid', s.store_external_id)
from seed_stores s
cross join seed_constants c
cross join seed_items i;

insert into public.packages (tenant_id, pos_account_id, external_id, name, list_price, raw)
select c.tenant_id, s.pos_account_id, 'pkg-01', 'Milk Tea + Cookie Combo', 55000, jsonb_build_object('package_id', 'pkg-01')
from seed_stores s
cross join seed_constants c;

insert into public.devices (tenant_id, pos_account_id, external_id, code, name, store_external_id, store_id, raw)
select c.tenant_id, s.pos_account_id, 'device-ext-' || s.code, 'POS-01', s.name || ' Counter', s.store_external_id, s.store_id, jsonb_build_object('device_code', 'POS-01')
from seed_stores s
cross join seed_constants c;

insert into public.customizations (tenant_id, pos_account_id, external_id, name, raw)
select c.tenant_id, s.pos_account_id, m.external_id, m.name, jsonb_build_object('customization_id', m.external_id)
from seed_stores s
cross join seed_constants c
cross join seed_customizations m;

insert into public.sources (tenant_id, pos_account_id, external_id, name, raw)
select c.tenant_id, s.pos_account_id, src.external_id, src.name, jsonb_build_object('source_id', src.external_id)
from seed_stores s
cross join seed_constants c
cross join seed_sources src;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind, raw)
select c.tenant_id, s.pos_account_id, pm.external_id, pm.name, pm.kind, jsonb_build_object('payment_method_id', pm.external_id)
from seed_stores s
cross join seed_constants c
cross join seed_payment_methods pm;

insert into public.promotions (tenant_id, pos_account_id, external_id, name, starts_at, ends_at, raw)
select c.tenant_id, s.pos_account_id, 'promo-01', 'Happy Hour 10%', now() - interval '30 days', now() + interval '30 days', jsonb_build_object('promotion_id', 'promo-01')
from seed_stores s
cross join seed_constants c;

insert into public.customers (tenant_id, phone, name)
select tenant_id, phone, name
from seed_customers;

create temp table seed_invoice_plan as
select
  c.tenant_id,
  s.store_id,
  s.pos_account_id,
  s.code,
  (current_date - d)::date as business_date,
  d as day_no,
  n as seq_no,
  'tran-' || s.code || '-' || to_char(current_date - d, 'YYYYMMDD') || '-' || lpad(n::text, 3, '0') as external_id,
  s.code || to_char(current_date - d, 'YYMMDD') || lpad(n::text, 3, '0') as receipt_no,
  8 + ((n * 5) % 14) as sold_hour,
  (n * 13) % 60 as sold_minute,
  1 + (n % 3) as item_line_count,
  (n % 4 = 0) as has_modifier_line,
  (n % 10 = 0) as has_bill_discount,
  (n = 25) as has_voucher,
  (n % 3) + 1 as payment_method_no,
  (n % 8 = 0) as is_takeaway,
  case when n % 5 = 0 then ((n / 5 + d) % 5) + 1 end as customer_no,
  'Card ' || ((n % 12) + 1) as table_name
from seed_stores s
cross join seed_constants c
cross join generate_series(1, 7) as d
cross join generate_series(1, 25) as n;

create temp table seed_invoice_times as
select
  p.*,
  case when p.sold_hour < 12 then 1 when p.sold_hour < 17 then 2 else 3 end as shift_no,
  ((p.business_date + make_time(p.sold_hour, p.sold_minute, 0)) at time zone c.store_timezone) as sold_at
from seed_invoice_plan p
cross join seed_constants c;

create temp table seed_line_plan as
select
  t.store_id,
  t.external_id as invoice_external_id,
  k as line_no,
  null::int as parent_line_no,
  'item'::public.line_kind as line_kind,
  i.external_id as item_external_id,
  i.name as item_name,
  i.base_name,
  i.size_label,
  i.item_type_external_id,
  it.name as item_type_name,
  ic.external_id as item_class_external_id,
  ic.name as item_class_name,
  case when ic.external_id = 'class-01' then 'unit-01' else 'unit-02' end as unit_external_id,
  case when ic.external_id = 'class-01' then 'Cup' else 'Pack' end as unit_name,
  ((t.seq_no + k) % 2 + 1)::numeric as quantity,
  i.list_price::numeric as unit_price
from seed_invoice_times t
cross join lateral generate_series(1, t.item_line_count) as k
join seed_items i on i.item_no = ((t.seq_no * 5 + t.day_no * 3 + k * 7) % 15) + 1
join seed_item_types it on it.external_id = i.item_type_external_id
join seed_item_classes ic on ic.external_id = i.item_class_external_id
union all
select
  t.store_id,
  t.external_id,
  t.item_line_count + 1,
  t.item_line_count,
  'modifier'::public.line_kind,
  m.external_id,
  m.name,
  m.name,
  null,
  null,
  'UnCategory',
  null,
  null,
  null,
  null,
  1,
  0
from seed_invoice_times t
join seed_customizations m on m.modifier_no = ((t.seq_no / 4 + t.day_no) % 3) + 1
where t.has_modifier_line;

create temp table seed_invoice_totals as
select
  t.*,
  sum(l.quantity * l.unit_price) as gross_amount,
  case when t.has_bill_discount then round(sum(l.quantity * l.unit_price) * 0.10, -3) else 0 end as bill_discount_amount,
  case when t.has_voucher then 10000 else 0 end as voucher_amount
from seed_invoice_times t
join seed_line_plan l on l.store_id = t.store_id and l.invoice_external_id = t.external_id
group by t.tenant_id, t.store_id, t.pos_account_id, t.code, t.business_date, t.day_no, t.seq_no, t.external_id, t.receipt_no,
  t.sold_hour, t.sold_minute, t.item_line_count, t.has_modifier_line, t.has_bill_discount, t.has_voucher,
  t.payment_method_no, t.is_takeaway, t.customer_no, t.table_name, t.shift_no, t.sold_at;

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, opened_at, closed_at,
  table_name, area_name, sale_type, source_external_id, source_name, employee_external_id, employee_name,
  shift_external_id, device_code, guest_count, customer_id, customer_phone, customer_name,
  gross_amount, item_discount_amount, bill_discount_amount, bill_discount_name,
  voucher_code, voucher_name, voucher_amount, net_amount, paid_amount,
  primary_payment_method_external_id, primary_payment_method_name, status, raw, synced_at
)
select
  t.tenant_id, t.store_id, t.pos_account_id, t.external_id, t.receipt_no, t.sold_at, t.business_date,
  t.sold_at - interval '2 minutes', t.sold_at,
  t.table_name, 'Main Floor',
  src.sale_type, src.external_id, src.name,
  'emp-01', 'Demo Cashier',
  'shift-' || t.code || '-' || to_char(t.business_date, 'YYYYMMDD') || '-' || t.shift_no,
  'POS-01',
  0,
  cu.id, cu.phone, cu.name,
  t.gross_amount, 0, t.bill_discount_amount,
  case when t.has_bill_discount then 'Happy Hour 10%' end,
  case when t.has_voucher then 'DEMO10K' end,
  case when t.has_voucher then 'Demo voucher 10k' end,
  t.voucher_amount,
  t.gross_amount - t.bill_discount_amount - t.voucher_amount,
  t.gross_amount - t.bill_discount_amount - t.voucher_amount,
  pm.external_id, pm.name,
  'completed',
  jsonb_build_object('tran_id', t.external_id, 'tran_no', t.receipt_no, 'synthetic', true),
  now()
from seed_invoice_totals t
join seed_sources src on src.sale_type = case when t.is_takeaway then 'TA' else 'OTS' end
join seed_payment_methods pm on pm.method_no = t.payment_method_no
left join seed_customers sc on sc.customer_no = t.customer_no
left join public.customers cu on cu.tenant_id = t.tenant_id and cu.phone = sc.phone;

insert into public.invoice_lines (
  tenant_id, store_id, invoice_id, external_id, parent_line_external_id, line_kind, item_external_id, item_name, base_name, size_label,
  item_type_external_id, item_type_name, item_class_external_id, item_class_name, unit_external_id, unit_name,
  quantity, list_unit_price, unit_price,
  gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name, raw
)
select
  inv.tenant_id, inv.store_id, inv.id,
  inv.external_id || '-' || lpad(l.line_no::text, 2, '0'),
  case when l.parent_line_no is not null then inv.external_id || '-' || lpad(l.parent_line_no::text, 2, '0') end,
  l.line_kind, l.item_external_id, l.item_name, l.base_name, l.size_label,
  l.item_type_external_id, l.item_type_name, l.item_class_external_id, l.item_class_name, l.unit_external_id, l.unit_name,
  l.quantity, l.unit_price, l.unit_price,
  l.quantity * l.unit_price, 0, l.quantity * l.unit_price,
  case when inv.bill_discount_amount > 0 then 'promo-01' end,
  case when inv.bill_discount_amount > 0 then 'Happy Hour 10%' end,
  jsonb_build_object('item_id', l.item_external_id, 'synthetic', true)
from seed_line_plan l
join public.invoices inv on inv.store_id = l.store_id and inv.external_id = l.invoice_external_id;

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, payment_method_name, amount, fee_amount, reference_no, raw)
select
  inv.tenant_id, inv.store_id, inv.id, 1, inv.business_date,
  inv.primary_payment_method_external_id, inv.primary_payment_method_name,
  inv.paid_amount, 0,
  case when inv.primary_payment_method_external_id = 'pm-01' then null else 'ref-' || inv.receipt_no end,
  jsonb_build_object('tran_id', inv.external_id, 'synthetic', true)
from public.invoices inv
join seed_constants c on c.tenant_id = inv.tenant_id;

insert into public.sale_payloads (tenant_id, store_id, business_date, payload)
select
  inv.tenant_id, inv.store_id, inv.business_date,
  string_agg(
    jsonb_build_object(
      'external_id', inv.external_id,
      'invoice', inv.raw,
      'lines', coalesce((
        select jsonb_object_agg(
          l.external_id,
          l.raw - coalesce((select array_agg(e.key) from jsonb_each(l.raw) as e where inv.raw -> e.key = e.value), '{}'::text[])
        )
        from public.invoice_lines l
        where l.invoice_id = inv.id
      ), '{}'::jsonb),
      'payments', coalesce((
        select jsonb_object_agg(
          pay.sequence_no::text,
          pay.raw - coalesce((select array_agg(e.key) from jsonb_each(pay.raw) as e where inv.raw -> e.key = e.value), '{}'::text[])
        )
        from public.invoice_payments pay
        where pay.invoice_id = inv.id
      ), '{}'::jsonb)
    )::text,
    E'\n' order by inv.external_id
  )
from public.invoices inv
join seed_constants c on c.tenant_id = inv.tenant_id
group by inv.tenant_id, inv.store_id, inv.business_date;

update public.invoice_lines l
set raw = null
from seed_constants c
where l.tenant_id = c.tenant_id;

update public.invoice_payments pay
set raw = null
from seed_constants c
where pay.tenant_id = c.tenant_id;

update public.invoices inv
set raw = null
from seed_constants c
where inv.tenant_id = c.tenant_id;

create temp table seed_invoice_event_plan as
select *
from (
  values
    ('TEA', 2, 7, 'voided'::public.invoice_event_kind, 'resync_diff', 'Customer cancelled after payment', interval '25 minutes'),
    ('COF', 3, 11, 'edited'::public.invoice_event_kind, 'pos_report', 'Payment method corrected by cashier', interval '40 minutes'),
    ('TEA', 1, 3, 'line_removed'::public.invoice_event_kind, 'resync_diff', 'Item removed before close', interval '10 minutes')
) as e (store_code, day_no, seq_no, kind, source, reason, delay_after_sale);

insert into public.invoice_events (tenant_id, store_id, invoice_id, invoice_external_id, kind, occurred_at, amount, reason, source, raw)
select
  inv.tenant_id, inv.store_id, inv.id, inv.external_id, e.kind,
  inv.sold_at + e.delay_after_sale,
  case e.kind
    when 'voided' then inv.net_amount
    when 'line_removed' then (select l.net_amount from public.invoice_lines l where l.invoice_id = inv.id and l.line_kind = 'item' order by l.external_id limit 1)
    else 0
  end,
  e.reason, e.source,
  jsonb_build_object('tran_id', inv.external_id, 'synthetic', true)
from seed_invoice_event_plan e
join seed_stores s on s.code = e.store_code
join public.invoices inv
  on inv.store_id = s.store_id
  and inv.external_id = 'tran-' || s.code || '-' || to_char(current_date - e.day_no, 'YYYYMMDD') || '-' || lpad(e.seq_no::text, 3, '0');

update public.invoices inv
set status = case when ev.kind = 'voided' then 'voided'::public.invoice_status else 'edited'::public.invoice_status end
from public.invoice_events ev
where ev.invoice_id = inv.id;

create temp table seed_shift_plan as
select
  c.tenant_id,
  s.store_id,
  s.code,
  (current_date - d)::date as business_date,
  d as day_no,
  k as shift_no,
  'shift-' || s.code || '-' || to_char(current_date - d, 'YYYYMMDD') || '-' || k as external_id,
  ((current_date - d) + make_time(case k when 1 then 7 when 2 then 12 else 17 end, 0, 0)) at time zone c.store_timezone as opened_at,
  ((current_date - d) + make_time(case k when 1 then 12 when 2 then 17 else 23 end, 0, 0)) at time zone c.store_timezone as closed_at,
  case when k = 3 and d % 3 = 0 then -20000 when k = 1 and d % 4 = 0 then 10000 else 0 end as drawer_variance,
  (k = 2 and d = 5) as changed_after_close
from seed_stores s
cross join seed_constants c
cross join generate_series(1, 7) as d
cross join generate_series(1, 3) as k;

insert into public.shifts (
  tenant_id, store_id, external_id, name, cashier_external_id, cashier_name, opened_at, closed_at,
  sales_amount, orders_count, opening_float_amount, expected_cash_amount, cash_drawer_amount,
  changed_after_close, status, device_code, raw
)
with shift_cash as (
  select
    inv.store_id,
    inv.shift_external_id,
    sum(pay.amount) as cash_received_amount
  from public.invoice_payments pay
  join public.invoices inv on inv.id = pay.invoice_id
  join public.payment_methods pm on pm.pos_account_id = inv.pos_account_id and pm.external_id = pay.payment_method_external_id
  where pm.kind = 'cash'
  group by inv.store_id, inv.shift_external_id
),
shift_sales as (
  select
    inv.store_id,
    inv.shift_external_id,
    sum(inv.net_amount) as sales_amount,
    count(*)::int as orders_count
  from public.invoices inv
  group by inv.store_id, inv.shift_external_id
)
select
  sp.tenant_id, sp.store_id, sp.external_id, 'Shift ' || sp.shift_no, 'emp-01', 'Demo Cashier', sp.opened_at, sp.closed_at,
  coalesce(ss.sales_amount, 0),
  coalesce(ss.orders_count, 0),
  c.opening_float_amount,
  c.opening_float_amount + coalesce(sc.cash_received_amount, 0),
  c.opening_float_amount + coalesce(sc.cash_received_amount, 0) + sp.drawer_variance,
  sp.changed_after_close, 'closed', 'POS-01',
  jsonb_build_object('shift_id', sp.external_id, 'synthetic', true)
from seed_shift_plan sp
cross join seed_constants c
left join shift_sales ss on ss.store_id = sp.store_id and ss.shift_external_id = sp.external_id
left join shift_cash sc on sc.store_id = sp.store_id and sc.shift_external_id = sp.external_id;

insert into public.sync_checks (tenant_id, store_id, business_date, source_invoice_count, source_net_amount, local_invoice_count, local_net_amount, is_matched, checked_at)
select
  inv.tenant_id, inv.store_id, inv.business_date,
  count(*)::int,
  sum(inv.net_amount) + case when s.code = 'COF' and inv.business_date = current_date - 1 then 50000 else 0 end,
  count(*)::int,
  sum(inv.net_amount),
  not (s.code = 'COF' and inv.business_date = current_date - 1),
  now()
from public.invoices inv
join seed_stores s on s.store_id = inv.store_id
group by inv.tenant_id, inv.store_id, inv.business_date, s.code;

insert into public.sync_runs (tenant_id, pos_account_id, kind, range_start, range_end, started_at, finished_at, status, rows_upserted, triggered_by)
select
  c.tenant_id, s.pos_account_id, 'backfill'::public.sync_kind, current_date - 7, current_date - 1,
  now() - interval '1 day', now() - interval '1 day' + interval '3 minutes', 'succeeded'::public.sync_status,
  jsonb_build_object('invoices', 175, 'invoice_lines', 392, 'invoice_payments', 175, 'shifts', 21),
  'seed'
from seed_stores s
cross join seed_constants c
union all
select
  c.tenant_id, s.pos_account_id, 'incremental'::public.sync_kind, current_date - 3, current_date - 1,
  now() - interval '30 minutes', now() - interval '29 minutes', 'succeeded'::public.sync_status,
  jsonb_build_object('invoices', 75, 'invoice_lines', 168, 'invoice_payments', 75, 'shifts', 9),
  'schedule'
from seed_stores s
cross join seed_constants c;

insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount, created_by)
select c.tenant_id, s.store_id, 'month', date_trunc('month', current_date)::date, 250000000, c.dev_user_id
from seed_stores s
cross join seed_constants c;

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from, created_by)
select c.tenant_id, null, i.external_id, round(i.list_price * 0.3, -3), current_date - 30, c.dev_user_id
from seed_items i
cross join seed_constants c;

insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, fixed_fee_amount, effective_from, created_by)
select c.tenant_id, null, pm.external_id, 1.100, 0, current_date - 30, c.dev_user_id
from seed_payment_methods pm
cross join seed_constants c
where pm.kind = 'ewallet';

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role, created_by)
select
  c.tenant_id, s.pos_account_id, it.external_id,
  case it.item_class_external_id when 'class-01' then 'drink'::public.item_type_role else 'snack'::public.item_type_role end,
  c.dev_user_id
from seed_stores s
cross join seed_constants c
cross join seed_item_types it;

create temp table seed_consent_plan as
select *
from (
  values
    (1, 'loyalty'::public.consent_purpose, 'till', false),
    (2, 'loyalty'::public.consent_purpose, 'till', false),
    (3, 'loyalty'::public.consent_purpose, 'mini_app', false),
    (4, 'loyalty'::public.consent_purpose, 'mini_app', false),
    (5, 'loyalty'::public.consent_purpose, 'oa_form', false),
    (1, 'marketing'::public.consent_purpose, 'mini_app', false),
    (2, 'marketing'::public.consent_purpose, 'oa_form', false),
    (3, 'marketing'::public.consent_purpose, 'mini_app', true)
) as p (customer_no, purpose, channel, is_revoked);

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, revoked_at, evidence)
select
  cu.tenant_id, 'customer'::public.consent_subject, cu.id, p.purpose, 'privacy-policy-2026-01', p.channel,
  now() - interval '20 days' + make_interval(days => p.customer_no),
  case when p.is_revoked then now() - interval '5 days' end,
  jsonb_build_object('method', 'checkbox', 'synthetic', true)
from seed_consent_plan p
join seed_customers sc on sc.customer_no = p.customer_no
join public.customers cu on cu.tenant_id = sc.tenant_id and cu.phone = sc.phone;

insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
select c.tenant_id, 'staff'::public.consent_subject, c.dev_user_id, 'staff_ops'::public.consent_purpose, 'staff-privacy-notice-2026-01', 'web', now() - interval '30 days', jsonb_build_object('method', 'signed_notice', 'synthetic', true)
from seed_constants c;

insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at, status, handled_by, notes)
select
  cu.tenant_id, 'customer'::public.consent_subject, cu.id, 'synthetic-contact-' || sc.customer_no, 'access'::public.dsr_type,
  now() - interval '1 day', 'in_progress'::public.dsr_status, c.dev_user_id, 'Demo request: customer asked for a copy of the data held'
from seed_constants c
join seed_customers sc on sc.customer_no = 4
join public.customers cu on cu.tenant_id = sc.tenant_id and cu.phone = sc.phone;

insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, consent_record_id, sent_at, status, provider_message_id, cost_amount, raw)
select
  cr.tenant_id, 'zalo_oa', encode(extensions.digest(cu.phone, 'sha256'), 'hex'), 'customer'::public.consent_subject, cu.id, 'marketing'::public.consent_purpose, 'tpl-promo-weekend',
  cr.id, now() - interval '3 days', 'delivered', 'synthetic-msg-001', 55, jsonb_build_object('synthetic', true)
from public.consent_records cr
join public.customers cu on cu.id = cr.subject_id
join seed_customers sc on sc.tenant_id = cu.tenant_id and sc.phone = cu.phone
where cr.purpose = 'marketing' and cr.revoked_at is null and sc.customer_no = 1
union all
select
  cr.tenant_id, 'mini_app', encode(extensions.digest(cu.phone, 'sha256'), 'hex'), 'customer'::public.consent_subject, cu.id, 'loyalty'::public.consent_purpose, 'tpl-points-earned',
  cr.id, now() - interval '2 days', 'delivered', null, null, jsonb_build_object('synthetic', true)
from public.consent_records cr
join public.customers cu on cu.id = cr.subject_id
join seed_customers sc on sc.tenant_id = cu.tenant_id and sc.phone = cu.phone
where cr.purpose = 'loyalty' and cr.revoked_at is null and sc.customer_no = 2;

insert into public.report_settings (tenant_id)
select tenant_id from seed_constants;

insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
select c.tenant_id, s.pos_account_id, 'item-15', 'type-03'
from seed_stores s
cross join seed_constants c
where s.code = 'TEA';

select app.refresh_analytics(c.tenant_id, current_date - 7, current_date)
from seed_constants c;
