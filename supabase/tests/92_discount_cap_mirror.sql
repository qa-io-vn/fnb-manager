begin;
select plan(4);

create temp table fixture as
select $cap${"rules":[{"countryCode":"VN","validFrom":"2018-05-22","validTo":"2025-06-30","maxDiscountRate":0.5},{"countryCode":"VN","validFrom":"2025-07-01","validTo":null,"maxDiscountRate":0.5}],"cases":[{"countryCode":"VN","from":null,"to":null,"cap":0.5},{"countryCode":"VN","from":"2018-05-22","to":"2018-05-22","cap":0.5},{"countryCode":"VN","from":"2018-05-21","to":"2018-05-21","cap":null},{"countryCode":"VN","from":"2018-05-22","to":null,"cap":0.5},{"countryCode":"VN","from":null,"to":"2018-05-21","cap":null},{"countryCode":"VN","from":null,"to":"2018-05-22","cap":0.5},{"countryCode":"VN","from":"2018-05-21","to":"2025-07-01","cap":0.5},{"countryCode":"VN","from":"2025-06-30","to":"2025-06-30","cap":0.5},{"countryCode":"VN","from":"2025-07-01","to":"2025-07-01","cap":0.5},{"countryCode":"VN","from":"2025-07-01","to":null,"cap":0.5},{"countryCode":"VN","from":null,"to":"2025-06-30","cap":0.5},{"countryCode":"VN","from":"2018-05-22","to":"2025-06-30","cap":0.5},{"countryCode":"VN","from":null,"to":"2025-07-01","cap":0.5},{"countryCode":"VN","from":"2025-06-30","to":"2025-07-02","cap":0.5},{"countryCode":" vn ","from":"2018-05-22","to":"2018-05-22","cap":0.5},{"countryCode":"ZZ","from":null,"to":null,"cap":null}]}$cap$::jsonb as doc;

select ok(
  (select jsonb_array_length(doc -> 'rules') > 0 and jsonb_array_length(doc -> 'cases') > jsonb_array_length(doc -> 'rules') from fixture),
  'the fixture of @fnb/core holds the dated discount_cap rules and the ranges around them'
);

select is_empty(
  $$
    select c ->> 'countryCode', c ->> 'from', c ->> 'to', c ->> 'cap', app.promotion_discount_cap(c ->> 'countryCode', (c ->> 'from')::date, (c ->> 'to')::date)
    from fixture cross join lateral jsonb_array_elements(doc -> 'cases') c
    where app.promotion_discount_cap(c ->> 'countryCode', (c ->> 'from')::date, (c ->> 'to')::date) is distinct from (c ->> 'cap')::numeric
  $$,
  'app.promotion_discount_cap gives the cap of promotionDiscountCap in @fnb/core for every range of the fixture'
);

select is_empty(
  $$
    select r ->> 'countryCode', r ->> 'validFrom'
    from fixture cross join lateral jsonb_array_elements(doc -> 'rules') r
    where app.promotion_discount_cap(r ->> 'countryCode', (r ->> 'validFrom')::date, coalesce((r ->> 'validTo')::date, (r ->> 'validFrom')::date)) is distinct from (r ->> 'maxDiscountRate')::numeric
  $$,
  'every dated discount_cap rule of @fnb/core has its rate in the SQL mirror over its whole validity'
);

select is(
  app.promotion_discount_cap('ZZ', null, null),
  null,
  'a country without rules has no cap'
);

select * from finish();
rollback;
