-- ADR-047, the data part: the credits that have not expired yet move to the end of their anniversary day.
--
-- A credit written before 20261123150000 expires at the moment of its sale (or adjustment, join or
-- confirmation) plus the programme's months. Each one whose expiry is still ahead now moves to the local
-- midnight (the tenant's time zone) that ends the local date of that expiry: later by at most 24 hours,
-- never earlier, so no member loses anything. A credit already at a local midnight (written by the new
-- functions) stays where it is, and so does every credit that already expired, whatever expire rows exist.
--
--   * loyalty_ledger.expires_at of the crediting rows (earn, adjust) and of the confirm rows that carry the
--     points' expiry of a pending earn (ADR-046). The ledger is append-only for every role
--     (app.keep_loyalty_ledger); this one-off correction of the expiry column, which moves no stamp or point,
--     runs with the trigger disabled inside this migration's transaction and enabled again before it commits.
--   * stamps.expires_at of the stamps still active or held by a redemption (a released hold gives them back
--     with their own expiry).
-- Nothing reads now() afterwards: the moment of the migration decides what "not expired yet" means.

alter table public.loyalty_ledger disable trigger loyalty_ledger_append_only;

update public.loyalty_ledger l
set expires_at = (((l.expires_at at time zone t.timezone)::date + 1)::timestamp at time zone t.timezone)
from public.tenants t
where t.id = l.tenant_id
  and l.entry_kind in ('earn', 'adjust', 'confirm')
  and l.expires_at is not null
  and l.expires_at > now()
  and l.expires_at <> ((l.expires_at at time zone t.timezone)::date::timestamp at time zone t.timezone);

alter table public.loyalty_ledger enable trigger loyalty_ledger_append_only;

update public.stamps s
set expires_at = (((s.expires_at at time zone t.timezone)::date + 1)::timestamp at time zone t.timezone)
from public.tenants t
where t.id = s.tenant_id
  and s.state in ('active', 'redeemed')
  and s.expires_at > now()
  and s.expires_at <> ((s.expires_at at time zone t.timezone)::date::timestamp at time zone t.timezone);
