begin;
select plan(7);

insert into public.pos_account_tokens (pos_account_id, token, expires_at)
values ('33333333-3333-4333-8333-000000000001', 'synthetic-token', now() + interval '7 days');

set local role anon;

select throws_ok('select count(*) from public.invoices', '42501', null, 'anon cannot read invoices');
select throws_ok('select count(*) from public.tenants', '42501', null, 'anon cannot read tenants');
select throws_ok('select count(*) from public.stores', '42501', null, 'anon cannot read stores');
select throws_ok('select count(*) from public.pos_account_tokens', '42501', null, 'anon cannot read pos_account_tokens');
select throws_ok('select app.current_user_tenant_ids()', '42501', null, 'anon cannot call app helpers');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select throws_ok('select count(*) from public.pos_account_tokens', '42501', null, 'authenticated owner cannot read pos_account_tokens');
select throws_ok(
  $$ update public.pos_account_tokens set token = 'x' where pos_account_id = '33333333-3333-4333-8333-000000000001' $$,
  '42501',
  null,
  'authenticated owner cannot write pos_account_tokens'
);

select * from finish();
rollback;
