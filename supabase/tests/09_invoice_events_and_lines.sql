begin;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-owner@example.com');

insert into public.tenants (id, slug, name)
values ('99999999-9999-4999-8999-999999999999', 'other-tenant', 'Other Tenant');

insert into public.tenant_members (tenant_id, user_id, role)
values ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner');

select is((select count(*) from public.invoice_events where tenant_id = '11111111-1111-4111-8111-111111111111'), 3::bigint, 'seed holds three invoice events');
select is((select count(distinct kind) from public.invoice_events where tenant_id = '11111111-1111-4111-8111-111111111111'), 3::bigint, 'seed events cover three kinds');

select is(
  (select count(*) from public.invoice_events ev join public.invoices inv on inv.id = ev.invoice_id where ev.kind = 'voided' and inv.status <> 'voided'),
  0::bigint,
  'every invoice with a voided event has status voided'
);

select is(
  (select count(*) from public.invoices where status = 'voided' and tenant_id = '11111111-1111-4111-8111-111111111111'),
  1::bigint,
  'exactly one seeded invoice is voided'
);

select is(
  (select count(*) from public.invoice_events ev join public.invoices inv on inv.id = ev.invoice_id where ev.kind in ('edited', 'line_removed') and inv.status <> 'edited'),
  0::bigint,
  'invoices with an edit or line removal carry status edited'
);

select is(
  (select count(*) from public.invoice_events ev join public.invoices inv on inv.id = ev.invoice_id where ev.invoice_external_id <> inv.external_id or ev.store_id <> inv.store_id),
  0::bigint,
  'events name the external id and store of the invoice they point at'
);

select is(
  (select count(*) from public.invoice_lines where line_kind = 'modifier' and parent_line_external_id is null),
  0::bigint,
  'every modifier line has a parent line'
);

select cmp_ok((select count(*) from public.invoice_lines where line_kind = 'modifier'), '>', 0::bigint, 'seed holds modifier lines');

select is(
  (select count(*) from public.invoice_lines where line_kind = 'item' and parent_line_external_id is not null),
  0::bigint,
  'no item line has a parent line'
);

select is(
  (
    select count(*)
    from public.invoice_lines m
    where m.parent_line_external_id is not null
      and not exists (
        select 1 from public.invoice_lines p
        where p.invoice_id = m.invoice_id and p.external_id = m.parent_line_external_id and p.line_kind = 'item'
      )
  ),
  0::bigint,
  'every parent line is an item line of the same invoice'
);

select throws_ok(
  $$ insert into public.invoice_events (tenant_id, store_id, invoice_external_id, kind, occurred_at, source)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'tran-x', 'voided', now(), 'test') $$,
  '23503',
  null,
  'service-level writes cannot pair a tenant with a store it does not own'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select is((select count(*) from public.invoice_events), 3::bigint, 'demo owner reads the demo invoice events');

select throws_ok(
  $$ insert into public.invoice_events (tenant_id, store_id, invoice_external_id, kind, occurred_at, source)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'tran-forged', 'voided', now(), 'test') $$,
  '42501',
  null,
  'authenticated owner cannot insert invoice events'
);

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.invoice_events), 0::bigint, 'other owner reads no demo invoice event');

select * from finish();
rollback;
