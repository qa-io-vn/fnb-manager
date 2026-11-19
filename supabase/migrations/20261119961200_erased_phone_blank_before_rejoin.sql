-- G-05: a customer who joins again starts clean. The erased phone stays remembered, but only for what happened before the new
-- membership: invoices sold before it stay blank however often the sync or the nightly re-pull brings them back, and invoices
-- sold from then on carry the phone again.

alter table app.erased_phones add column blank_before timestamptz;

comment on column app.erased_phones.blank_before is 'null while the customer has not joined again: every invoice with the phone is blanked; once a new membership exists, the invoices sold before its joined_at stay blank and later ones carry the phone';

create or replace function app.blank_erased_invoice_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_phone is not null
    and exists (
      select 1 from app.erased_phones e
      where e.tenant_id = new.tenant_id
        and e.phone_hash = app.phone_hash(new.customer_phone)
        and (e.blank_before is null or new.sold_at < e.blank_before)
    )
  then
    new.customer_phone := null;
    new.customer_name := null;
  end if;
  return new;
end;
$$;

comment on function app.blank_erased_invoice_phone() is 'trigger before an invoice is inserted or its customer_phone changes: blanks customer_phone and customer_name when the phone belongs to an erased customer of the tenant, for every invoice until the customer joins again and for the invoices sold before the new membership after that';

create or replace function app.forget_erased_phone_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app.erased_phones e
  set blank_before = new.joined_at
  from public.customers c
  where c.id = new.customer_id
    and e.tenant_id = new.tenant_id
    and e.phone_hash = app.phone_hash(c.phone)
    and e.blank_before is null;
  return new;
end;
$$;

comment on function app.forget_erased_phone_on_join() is 'trigger after a membership is created: the customer joined again of their own accord, so invoices with the erased phone sold from the membership''s joined_at on carry it again while the older ones stay blank (app.erased_phones.blank_before)';

create function app.erased_phone_erased_again()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.erased_at > old.erased_at then
    new.blank_before := null;
  end if;
  return new;
end;
$$;

comment on function app.erased_phone_erased_again() is 'trigger before an erased phone is erased again (a second data-subject deletion after a re-join): every invoice with the phone is blanked again, so blank_before goes back to null';

create trigger erased_phones_erased_again
before update of erased_at on app.erased_phones
for each row execute function app.erased_phone_erased_again();
