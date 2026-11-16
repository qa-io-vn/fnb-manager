alter table public.item_costs
  add constraint item_costs_amount_whole_dong
  check (cost_amount >= 0 and cost_amount <= 100000000 and cost_amount = trunc(cost_amount));

comment on constraint item_costs_amount_whole_dong on public.item_costs is 'a cost is a whole number of đồng from 0 to 100,000,000, as the Giá vốn page and the cost CSV import enforce';
