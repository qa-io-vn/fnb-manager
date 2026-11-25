begin;
select plan(26);

-- Structure and privileges (ADR-057): one row at most, row level security on, no client role may touch it.
select has_table('app', 'zalo_relay', 'app.zalo_relay exists');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'app.zalo_relay'::regclass),
  'row level security is on for app.zalo_relay'
);
select ok(
  not has_table_privilege('authenticated', 'app.zalo_relay', 'select')
  and not has_table_privilege('anon', 'app.zalo_relay', 'select')
  and not has_table_privilege('authenticated', 'app.zalo_relay', 'insert'),
  'authenticated and anon have no table privilege on app.zalo_relay'
);
select ok(
  not has_function_privilege('authenticated', 'public.zalo_relay_announce(text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.zalo_relay_announce(text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.zalo_relay_current()', 'execute')
  and not has_function_privilege('anon', 'public.zalo_relay_current()', 'execute'),
  'only the service role may execute the relay RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.zalo_relay_announce(text, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.zalo_relay_current()', 'execute'),
  'the service role may execute both relay RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'app.zalo_relay_announce(text, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.zalo_relay_current(timestamptz, interval)', 'execute'),
  'authenticated may not execute the app halves either'
);

set local role authenticated;
select throws_ok(
  $$select public.zalo_relay_announce('https://evil-relay.trycloudflare.com', now())$$,
  '42501', null, 'a signed-in client cannot announce a relay'
);
select throws_ok('select public.zalo_relay_current()', '42501', null, 'a signed-in client cannot read the relay address');
reset role;

set local role anon;
select throws_ok(
  $$select public.zalo_relay_announce('https://evil-relay.trycloudflare.com', now())$$,
  '42501', null, 'anon cannot announce a relay'
);
reset role;

-- Nothing announced yet: the functions call the Graph directly.
select is(public.zalo_relay_current(), null, 'no relay address before any announcement');

-- Equivalence classes of addresses: an https origin on a DNS name passes; everything else fails the table check.
select ok(
  app.zalo_relay_announce('https://quiet-river-1234.trycloudflare.com', now() - interval '1 minute', now()),
  'a quick tunnel address is stored'
);
select is(public.zalo_relay_current(), 'https://quiet-river-1234.trycloudflare.com', 'the stored address is current');
select throws_ok(
  $$select app.zalo_relay_announce('http://plain.example.com', now(), now())$$,
  '23514', null, 'a plain http address is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://127.0.0.1', now(), now())$$,
  '23514', null, 'an IP address is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://localhost', now(), now())$$,
  '23514', null, 'a single-label host is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://relay.example.com:8443', now(), now())$$,
  '23514', null, 'an address with a port is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://relay.example.com/relay', now(), now())$$,
  '23514', null, 'an address with a path is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://user@example.com', now(), now())$$,
  '23514', null, 'an address with credentials is refused'
);
select throws_ok(
  $$select app.zalo_relay_announce('https://Relay.Example.com', now(), now())$$,
  '23514', null, 'an upper-case address is refused (the function lower-cases nothing)'
);
select throws_ok(
  format('select app.zalo_relay_announce(%L, now(), now())', 'https://' || repeat('a', 190) || '.example.com'),
  '23514', null, 'an address longer than 200 characters is refused'
);

-- Ordering: an older announcement never replaces a newer one; a newer one does.
select ok(
  not app.zalo_relay_announce('https://older-relay.trycloudflare.com', now() - interval '10 minutes', now()),
  'an older announcement is not stored'
);
select is(public.zalo_relay_current(), 'https://quiet-river-1234.trycloudflare.com', 'the newer address is kept');
select ok(
  app.zalo_relay_announce('https://newer-relay.trycloudflare.com', now(), now()),
  'a newer announcement replaces the address'
);
select ok(
  not app.zalo_relay_announce('https://future-relay.trycloudflare.com', now() + interval '3 minutes', now()),
  'an announcement dated more than two minutes ahead is not stored'
);

-- Boundaries of freshness: 15 minutes for the RPC.
select is(
  app.zalo_relay_current(now() + interval '14 minutes', interval '15 minutes'),
  'https://newer-relay.trycloudflare.com',
  'an address announced 14 minutes ago is current'
);
select is(
  app.zalo_relay_current(now() + interval '16 minutes', interval '15 minutes'),
  null,
  'an address announced 16 minutes ago has gone quiet'
);

select * from finish();
rollback;
