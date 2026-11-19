-- The functions of the erased-phone memory are trigger and internal functions: no API role runs them.
revoke all on function app.phone_hash(text) from public, anon, authenticated, service_role;
revoke all on function app.blank_erased_invoice_phone() from public, anon, authenticated, service_role;
revoke all on function app.forget_erased_phone_on_join() from public, anon, authenticated, service_role;
revoke all on function app.erased_phone_erased_again() from public, anon, authenticated, service_role;
