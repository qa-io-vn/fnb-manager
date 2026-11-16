alter table public.payment_fee_rates
  add constraint payment_fee_rates_within_limits
  check (
    fee_pct >= 0 and fee_pct <= 20
    and fixed_fee_amount >= 0 and fixed_fee_amount <= 100000
    and fixed_fee_amount = trunc(fixed_fee_amount)
  );

comment on constraint payment_fee_rates_within_limits on public.payment_fee_rates is 'a fee rate is 0 to 20 per cent and a fixed fee is a whole number of đồng from 0 to 100,000, as the Phí thanh toán tab enforces';

alter table public.targets
  add constraint targets_amount_whole_dong
  check (net_target_amount >= 1 and net_target_amount = trunc(net_target_amount));

comment on constraint targets_amount_whole_dong on public.targets is 'a target is a whole number of đồng of at least 1, as the Mục tiêu tab enforces';
