-- Defect D-1 (acceptance criterion 6; ADR-071): a refund handed back on a later business day than its order's is its
-- own negative document of the refund's business day, so the earlier day never changes. Its status is the new value
-- refund: the reports sum its amounts (a deduction from the day's net revenue) and never count it as an invoice, a
-- sale or a visit. The value is added in a migration of its own: a new enum value cannot be used in the transaction
-- that adds it, and the next migration's SQL functions name it.

alter type public.invoice_status add value if not exists 'refund';

comment on type public.invoice_status is 'an invoice''s state: completed, edited (changed after the sale, its amounts are the edited ones), voided (left out of every sum and count) or refund (a native refund handed back on a later business day than its order''s: a document of negative amounts on the refund''s business day, in the sums and never counted as an invoice, ADR-071)';
