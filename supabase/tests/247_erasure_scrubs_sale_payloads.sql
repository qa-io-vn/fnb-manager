-- G-47 (a). ISTQB techniques: equivalence partitioning of the records of a payload document (a sale of the erased customer
-- by phone, one linked by customer id only, another customer's sale whose note names the phone, an unrelated sale whose id
-- holds the same digits, another tenant), boundary values of how a phone is written (separators, prefixes, digit runs),
-- state transition (erased, synced again, joined again, erased twice) and a privilege check. Synthetic phones and names only.
begin;
select plan(26);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- a synthetic phone in E.164, built from its subscriber digits
create function pg_temp.vn(p_subscriber text)
returns text
language sql
immutable
as $$
  select '+84' || p_subscriber;
$$;

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024701'::uuid as tenant_d,
  'dddddddd-dddd-4ddd-8ddd-000000024702'::uuid as tenant_o,
  'dddddddd-dddd-4ddd-8ddd-000000024703'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000024701'::uuid as account_d,
  'cccccccc-cccc-4ccc-8ccc-000000024702'::uuid as account_o,
  'cccccccc-cccc-4ccc-8ccc-000000024703'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000024701'::uuid as store_d1,
  'ffffffff-ffff-4fff-8fff-000000024702'::uuid as store_d2,
  'ffffffff-ffff-4fff-8fff-000000024703'::uuid as store_o,
  'ffffffff-ffff-4fff-8fff-000000024704'::uuid as store_b,
  '0900024701'::text as phone,
  pg_temp.vn('900024701') as phone_e164;

insert into public.tenants (id, slug, name, country_code)
select tenant_d, 'scrub-payloads-pgtap', 'Scrub payloads pgTAP', 'VN' from fx
union all select tenant_o, 'scrub-payloads-other-pgtap', 'Scrub payloads other pgTAP', 'VN' from fx
union all select tenant_b, 'scrub-payloads-backfill-pgtap', 'Scrub payloads backfill pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_d, tenant_d, 'mock', 'scrub-d', 'Synthetic account' from fx
union all select account_o, tenant_o, 'mock', 'scrub-o', 'Synthetic account' from fx
union all select account_b, tenant_b, 'mock', 'scrub-b', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_d1, tenant_d, account_d, 'scrub-1', 'scrub-1', 'Synthetic store 1' from fx
union all select store_d2, tenant_d, account_d, 'scrub-2', 'scrub-2', 'Synthetic store 2' from fx
union all select store_o, tenant_o, account_o, 'scrub-9', 'scrub-9', 'Synthetic other store' from fx
union all select store_b, tenant_b, account_b, 'scrub-b', 'scrub-b', 'Synthetic backfill store' from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
select tenant_d, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_x', app.loyalty_customer_for_phone(tenant_d, phone, '2026-11-01 01:00+00') from fx;
update public.customers set name = 'Synthetic X' where id = (select id from ids where name = 'customer_x');

-- one invoice row and one payload record per sale; the record is written first, as the sync does
create function pg_temp.sale(p_tenant uuid, p_store uuid, p_account uuid, p_external text, p_sold timestamptz, p_phone text, p_name text, p_customer uuid, p_record jsonb)
returns void
language plpgsql
as $$
declare
  v_date date := app.store_business_date(p_store, p_sold);
begin
  perform app.store_sale_payloads(p_tenant, p_store, v_date, array[(jsonb_build_object('external_id', p_external) || p_record)::text]);
  insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_name, customer_id)
  values (p_tenant, p_store, p_account, p_external, p_sold, v_date, 45000, 45000, 45000, p_phone, p_name, p_customer)
  on conflict (store_id, external_id) do update
  set customer_phone = excluded.customer_phone, customer_name = excluded.customer_name, sold_at = excluded.sold_at, business_date = excluded.business_date;
end;
$$;

create function pg_temp.entry(p_store uuid, p_external text)
returns text
language sql
as $$
  select e.entry
  from public.sale_payloads p
  cross join lateral string_to_table(p.payload, E'\n') as e (entry)
  where p.store_id = p_store and e.entry::jsonb ->> 'external_id' = p_external;
$$;

create function pg_temp.rec(p_store uuid, p_external text)
returns jsonb
language sql
as $$
  select pg_temp.entry(p_store, p_external)::jsonb;
$$;

-- every string of the tenant's payload documents that holds the phone
create function pg_temp.phone_strings(p_tenant uuid, p_phone text)
returns integer
language sql
as $$
  select count(*)::integer
  from public.sale_payloads p
  cross join lateral string_to_table(p.payload, E'\n') as e (entry)
  cross join lateral jsonb_path_query(e.entry::jsonb, 'strict $.** ? (@.type() == "string")') as s (value)
  where p.tenant_id = p_tenant and app.text_holds_phone(s.value #>> '{}', p_phone);
$$;

-- S-1: the customer's sale by phone, with the phone on a payment and the e-invoice buyer on a line
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-1', '2026-11-10 03:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-1', 'customer_phone', phone, 'customer_name', 'Synthetic X', 'sale_note', 'ít đá', 'table_name', 'B1', 'total_amount', 45000),
  'lines', jsonb_build_object('S-1-L1', jsonb_build_object('item_name', 'Trà đào', 'inv_buyeremail', 'synthetic@example.com', 'inv_buyertaxcode', '0100000001')),
  'payments', jsonb_build_object('1', jsonb_build_object('customer_phone', phone, 'amount', 45000))
)) from fx;
-- S-2: linked to the customer by id only; the POS customer fields name them without the phone
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-2', '2026-11-10 04:00+00', null, null, (select id from ids where name = 'customer_x'), jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-2', 'customer_name', 'Synthetic X', 'customer_id', 'POS-77', 'total_amount', 45000),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
-- S-3: another customer's sale at the second store whose note names the phone with separators
select pg_temp.sale(tenant_d, store_d2, account_d, 'S-3', '2026-11-11 03:00+00', '0900024702', 'Synthetic Y', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-3', 'customer_phone', '0900024702', 'customer_name', 'Synthetic Y', 'sale_note', 'gọi hộ 0900 024 701', 'total_amount', 45000),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
-- S-4: unrelated, an id that holds the phone's digits inside a longer number
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-4', '2026-11-10 05:00+00', null, null, null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', '17090002470199', 'sale_note', 'bàn 0900', 'total_amount', 45000),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
-- O-1: the same phone in another tenant
select pg_temp.sale(tenant_o, store_o, account_o, 'O-1', '2026-11-10 03:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'O-1', 'customer_phone', phone, 'customer_name', 'Synthetic X'),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;

create temp table before as
select p.store_id, p.business_date, p.payload from public.sale_payloads p
where p.tenant_id in (select tenant_d from fx union all select tenant_o from fx);

with request as (
  insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
  select fx.tenant_d, 'customer', (select id from ids where name = 'customer_x'), 'synthetic-contact', 'deletion', '2026-11-19 01:00+00'
  from fx
  returning id
)
insert into ids
select 'request', id from request;

create temp table answers as
select app.dsr_erase_customer((select id from ids where name = 'request'), null, '2026-11-20 02:00+00') as answer;

select is(
  (select (answer -> 'counts' ->> 'sale_records_scrubbed')::int from answers),
  3,
  'the erasure counts three scrubbed records: the sale by phone, the sale linked by id and the note that names the phone'
);
select is(
  (select jsonb_build_array(r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}', r #> '{payments,1,customer_phone}',
     r #> '{lines,S-1-L1,inv_buyeremail}', r #> '{lines,S-1-L1,inv_buyertaxcode}') from (select pg_temp.rec(store_d1, 'S-1') as r from fx) s),
  '[null, null, null, null, null]'::jsonb,
  'the sale by phone loses its customer fields on the invoice, the payment and the e-invoice buyer of the line'
);
select is(
  (select jsonb_build_array(r ->> 'external_id', r #> '{invoice,tran_id}', r #> '{invoice,sale_note}', r #> '{invoice,table_name}', r #> '{invoice,total_amount}',
     r #> '{lines,S-1-L1,item_name}', r #> '{payments,1,amount}') from (select pg_temp.rec(store_d1, 'S-1') as r from fx) s),
  '["S-1", "S-1", "ít đá", "B1", 45000, "Trà đào", 45000]'::jsonb,
  'everything else of that sale is kept: ids, the note without the phone, the table, the amounts and the item'
);
select is(
  (select jsonb_build_array(r #> '{invoice,customer_name}', r #> '{invoice,customer_id}', r #> '{invoice,tran_id}') from (select pg_temp.rec(store_d1, 'S-2') as r from fx) s),
  '[null, null, "S-2"]'::jsonb,
  'a sale linked to the customer by id only loses the POS customer name and id too'
);
select is(
  (select jsonb_build_array(r #> '{invoice,sale_note}', r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}') from (select pg_temp.rec(store_d2, 'S-3') as r from fx) s),
  '[null, "0900024702", "Synthetic Y"]'::jsonb,
  'another customer''s sale loses only the note that names the erased phone, at another store of the tenant'
);
select is(
  (select pg_temp.entry(store_d1, 'S-4') from fx),
  (select e.entry from before b cross join lateral string_to_table(b.payload, E'\n') as e (entry) where e.entry::jsonb ->> 'external_id' = 'S-4'),
  'an unrelated sale whose id holds the same digits is kept byte for byte'
);
select is(
  (select p.payload from public.sale_payloads p, fx where p.store_id = fx.store_o),
  (select b.payload from before b, fx where b.store_id = fx.store_o),
  'the same phone in another tenant''s payloads is not touched'
);
select is(
  (select pg_temp.phone_strings(tenant_d, phone_e164) from fx),
  0,
  'no string in the tenant''s payload documents holds the erased phone any more'
);
select is(
  (select array_agg(e.entry::jsonb ->> 'external_id' order by p.store_id, p.business_date, e.ord)
   from public.sale_payloads p cross join lateral string_to_table(p.payload, E'\n') with ordinality as e (entry, ord), fx where p.tenant_id = fx.tenant_d),
  (select array_agg(e.entry::jsonb ->> 'external_id' order by b.store_id, b.business_date, e.ord)
   from before b cross join lateral string_to_table(b.payload, E'\n') with ordinality as e (entry, ord), fx where b.store_id in (fx.store_d1, fx.store_d2)),
  'the documents keep every record, in their order'
);
select is(
  (select jsonb_build_array(customer_phone, customer_name) from public.invoices i, fx where i.store_id = fx.store_d2 and i.external_id = 'S-3'),
  '["0900024702", "Synthetic Y"]'::jsonb,
  'the other customer''s invoice row keeps its own phone and name'
);

-- a later sync brings the phone back on the old sale and on a new one: both records are scrubbed on arrival
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-1', '2026-11-10 03:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-1', 'customer_phone', phone, 'customer_name', 'Synthetic X', 'total_amount', 50000),
  'lines', jsonb_build_object('S-1-L1', jsonb_build_object('item_name', 'Trà đào', 'inv_buyerdisplayname', 'Synthetic X')),
  'payments', jsonb_build_object('1', jsonb_build_object('customer_phone', phone, 'amount', 50000))
)) from fx;
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-5', '2026-11-20 05:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-5', 'customer_phone', phone, 'customer_name', 'Synthetic X', 'total_amount', 45000),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select is(
  (select jsonb_build_array(r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}', r #> '{payments,1,customer_phone}', r #> '{lines,S-1-L1,inv_buyerdisplayname}', r #> '{invoice,total_amount}')
   from (select pg_temp.rec(store_d1, 'S-1') as r from fx) s),
  '[null, null, null, null, 50000]'::jsonb,
  'the re-pulled sale is scrubbed on arrival and keeps its new amount'
);
select is(
  (select jsonb_build_array(r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}') from (select pg_temp.rec(store_d1, 'S-5') as r from fx) s),
  '[null, null]'::jsonb,
  'a new sale with the erased phone is scrubbed on arrival'
);
select is(
  (select count(*)::int from public.invoices i, fx where i.tenant_id = fx.tenant_d and i.customer_phone is not null and i.external_id in ('S-1', 'S-5')),
  0,
  'and both invoice rows stay blank'
);
select is(
  (select pg_temp.phone_strings(tenant_d, phone_e164) from fx),
  0,
  'after the re-pull no string of the tenant''s payloads holds the phone'
);

-- the same phone joins again: a sale after the new membership keeps the phone, a re-pulled older sale stays scrubbed
insert into ids
select 'customer_x2', app.loyalty_customer_for_phone(tenant_d, phone, '2026-11-21 02:00+00') from fx;
select app.loyalty_join(tenant_d, (select id from ids where name = 'customer_x2'), 'mini_app', store_d1, null, null, '2026-11-21 02:00+00') from fx;
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-6', '2026-11-21 05:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-6', 'customer_phone', phone, 'customer_name', 'Synthetic X'),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select pg_temp.sale(tenant_d, store_d1, account_d, 'S-1', '2026-11-10 03:00+00', phone, 'Synthetic X', null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'S-1', 'customer_phone', phone, 'customer_name', 'Synthetic X', 'total_amount', 50000),
  'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select is(
  (select jsonb_build_array(r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}') from (select pg_temp.rec(store_d1, 'S-6') as r from fx) s),
  (select jsonb_build_array(phone, 'Synthetic X') from fx),
  'after a re-join, a sale sold from the new membership on keeps the phone in its payload'
);
select is(
  (select jsonb_build_array(r #> '{invoice,customer_phone}', r #> '{invoice,customer_name}') from (select pg_temp.rec(store_d1, 'S-1') as r from fx) s),
  '[null, null]'::jsonb,
  'a sale sold before the re-join is still scrubbed when it is re-pulled'
);

-- a second call of the same request changes nothing
create temp table before_second as
select p.store_id, p.business_date, p.payload from public.sale_payloads p, fx where p.tenant_id = fx.tenant_d;
select is(
  (select (app.dsr_erase_customer((select id from ids where name = 'request'), null, '2026-11-22 02:00+00') ->> 'already_done')::boolean),
  true,
  'a second call answers already_done'
);
select is(
  (select count(*)::int from public.sale_payloads p join before_second b using (store_id, business_date) where p.payload <> b.payload),
  0,
  'and scrubs nothing more'
);

-- how a phone can be written (boundaries)
select is(
  array(select app.phones_in_text('0900024701')),
  array[pg_temp.vn('900024701')],
  'a national number is read'
);
select ok(
  array(select app.phones_in_text('gọi 0900 024 701, 0900.024.702 hoặc (090) 0024-703')) @> array[pg_temp.vn('900024701'), pg_temp.vn('900024702'), pg_temp.vn('900024703')],
  'a phone with spaces, dots, dashes or brackets between its groups is read'
);
select ok(
  array(select app.phones_in_text('84900024701 / +84 900 024 702')) @> array[pg_temp.vn('900024701'), pg_temp.vn('900024702')],
  'a phone with the country prefix, with or without the plus, is read'
);
select is(
  array(select p from app.phones_in_text('0900024701 2 ly') as p where p = pg_temp.vn('900024701')),
  array[pg_temp.vn('900024701')],
  'a phone followed by another number is still read'
);
select is(
  array(select p from app.phones_in_text('17090002470199 · 0900   024701 · 090002470') as p where p = pg_temp.vn('900024701')),
  '{}'::text[],
  'a longer digit run, three separators in a row and a digit short are not the phone'
);

-- the backfill for customers erased before the migration, known only by the hash of their phone
insert into app.erased_phones (tenant_id, phone_hash, erased_at, blank_before)
select tenant_b, app.phone_hash('0900024709'), timestamptz '2026-11-15 00:00+00', null::timestamptz from fx
union all
select tenant_b, app.phone_hash('0900024708'), timestamptz '2026-11-15 00:00+00', timestamptz '2026-11-16 00:00+00' from fx;
select pg_temp.sale(tenant_b, store_b, account_b, 'B-1', '2026-11-12 03:00+00', null, null, null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'B-1', 'customer_phone', '0900024709', 'customer_name', 'Synthetic Z'), 'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select pg_temp.sale(tenant_b, store_b, account_b, 'B-2', '2026-11-12 04:00+00', null, null, null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'B-2', 'customer_phone', '0900024707', 'customer_name', 'Synthetic W', 'sale_note', 'nhắn 0900.024.709'), 'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select pg_temp.sale(tenant_b, store_b, account_b, 'B-3', '2026-11-17 03:00+00', null, null, null, jsonb_build_object(
  'invoice', jsonb_build_object('tran_id', 'B-3', 'customer_phone', '0900024708', 'customer_name', 'Synthetic V'), 'lines', '{}'::jsonb, 'payments', '{}'::jsonb
)) from fx;
select is(
  (select app.scrub_erased_phones_from_sale_payloads(tenant_b) from fx),
  2,
  'the backfill scrubs the two records that hold a phone erased before it, by its hash'
);
select is(
  (select jsonb_build_array(
     (select r #> '{invoice,customer_phone}' from (select pg_temp.rec(store_b, 'B-1') as r from fx) s),
     (select r #> '{invoice,customer_name}' from (select pg_temp.rec(store_b, 'B-1') as r from fx) s),
     (select r #> '{invoice,sale_note}' from (select pg_temp.rec(store_b, 'B-2') as r from fx) s),
     (select r #> '{invoice,customer_name}' from (select pg_temp.rec(store_b, 'B-2') as r from fx) s),
     (select r #> '{invoice,customer_phone}' from (select pg_temp.rec(store_b, 'B-3') as r from fx) s)
   )),
  '[null, null, null, "Synthetic W", "0900024708"]'::jsonb,
  'it blanks the customer fields that held the phone and the note that named it, and keeps a sale sold after a re-join'
);

select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) as r (role)
   cross join unnest(array[
     'app.phones_in_text(text)', 'app.text_holds_phone(text, text)', 'app.scrub_payload_value(jsonb, text, boolean)',
     'app.sale_record_customer_holds_phone(jsonb, text)', 'app.scrub_sale_record(jsonb, text, boolean)',
     'app.scrub_sale_payload_records(uuid, date, text[], text)', 'app.scrub_phone_from_sale_payloads(uuid, text)',
     'app.scrub_erased_phones_from_sale_payloads(uuid)'
   ]) as f (signature)
   where has_function_privilege(r.role, f.signature, 'execute')),
  0,
  'no API role can run the scrub functions'
);

select * from finish();
rollback;
