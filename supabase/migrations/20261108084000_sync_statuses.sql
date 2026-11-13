alter type public.pos_account_status add value if not exists 'auth_failed';
alter type public.sync_status add value if not exists 'partial';

comment on type public.pos_account_status is 'active syncs; paused skips the sync; error marks a failing account; auth_failed is set when the POS rejects the login, the incremental schedule skips the account until a run logs in again';
comment on type public.sync_status is 'running until closed; succeeded; partial when a run stopped cleanly before covering every changed day (CPU or wall-time guard, or a store held by another run) and left the rest to the nightly job; failed';
