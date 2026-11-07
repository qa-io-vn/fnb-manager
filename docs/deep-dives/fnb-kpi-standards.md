# Deep dive: KPIs and analysis methods for café and tea-shop management

This section fixes the formulas the metric registry (`packages/metrics`), the reports, the data pack and the KPI follow-up all share. Formulas are stated on canonical columns only. "Net" means invoice total after item, bill and voucher discounts; "gross" means before them. Grain names: store-day, store-hour, item-period, shift, customer, cohort.

## 1. Sales, ticket and basket

- **Net sales** = Σ invoice net amount over completed and edited invoices (voided excluded). Grain store-day.
- **Average ticket (AOV)** = net sales ÷ invoice count. Decompose as **items per ticket × average item price**, where items per ticket = Σ item-line quantity ÷ invoices (modifier and package-component lines excluded). A falling ticket is then explained as fewer items or cheaper items, which the insight sentence should state.
- **Attach rate (role R per drink)** = invoices containing at least one line with role R and at least one drink ÷ invoices containing a drink. Roles come from `item_type_roles` (topping, snack). Report per drink base name for combo candidates.
- **Discount rate** = (item + bill + voucher discounts) ÷ gross sales. **Voucher share** = invoices with a voucher ÷ invoices.

## 2. Time productivity

- **Sales per opening hour** = net sales ÷ opening hours; also invoices per opening hour. Grain store-hour, aggregated to hour × weekday.
- **Peak share** = net sales in the top-3 hours ÷ daily net sales; **dead-hour share** = net sales in configured dead hours ÷ daily net sales.
- **RevPASH** (Kimes 1999) = net sales ÷ (seats × service hours). Kalan (2023) advises separating the levers: (sales ÷ hours) ÷ seats. Needs `seat_count` in store settings.
- **Sales per labour hour** = net sales ÷ staff hours (from shifts or the staff app). Vendor ranges exist only for the US and are opinion.

## 3. Menu engineering (Kasavana–Smith, 1982)

Per store and per role over a 28-day window: **menu mix %** = item quantity ÷ total quantity in the role. **Popularity threshold** = 0.70 × (1 ÷ number of items). **Contribution margin** = price − portion cost; **margin threshold** = weighted average CM (Σ CM × quantity ÷ Σ quantity). Classes: Star (both high), Plowhorse (popular, low margin), Puzzle (high margin, unpopular), Dog (neither). Actions: protect and never discount Stars; fix cost or bundle Plowhorses; reposition and describe Puzzles; retire Dogs unless strategic. Below ~10 items the thresholds are unstable; show a provisional badge while costs are missing.

## 4. Promotions and vouchers

- **Same-weekday baseline** = median net sales of the same weekday over the prior 8 weeks, excluding holidays and Tết. **Lift** = (promo-day sales − baseline) ÷ baseline.
- **Difference-in-differences** = (test after − test before) − (control after − control before), with the sister store or the same weekday's non-promo weeks as control. Report gross lift, discount cost and **net lift in ₫**; a lift smaller than the discount cost is a loss.
- **Redemption rate** = coupons redeemed ÷ coupons issued (by issue cohort); **breakage** = 1 − redemption at expiry.

## 5. Cash and shrinkage

- **Cash share** = cash payments ÷ total payments. Track the trend; a falling cash share with constant total is normal, a rising one with falling sales is a signal.
- **Cash variance** = counted drawer − (opening float + cash payments − payouts). Tolerance per store: absolute (default 50,000 ₫) and relative (0.5 % of cash sales), plus a z-score against the store's own 8-week variance distribution. US guidance is ±$2–5 per drawer per shift; log every variance, including overages.
- **Void rate** = voided invoices ÷ invoices (count and ₫); **edit-after-close rate**; **removed-line rate** = removed lines ÷ lines (from C05/C08). Rank by cashier and shift within the store; the 1–2 % vendor heuristic is unverified.

## 6. Customers and loyalty

Computed on identified customers only; report **capture rate** = identified invoices ÷ invoices alongside.

- **Repeat rate** = customers with ≥2 visits in the window ÷ customers with ≥1 visit. **Visit frequency** = visits ÷ active customers per 30 or 90 days.
- **Cohort retention (k)** = customers of acquisition month c active in month c+k ÷ cohort size.
- **RFM** = quintile scores 1–5 for recency (reversed), frequency, monetary; 125 cells grouped into ~8 segments (Champions, Loyal, New, At risk, Lapsed, Hibernating).
- **CLV** = average ticket × visits per year × gross margin × expected lifespan, or monthly margin per customer ÷ monthly churn.
- **Loyalty economics** (IFRS 15 pattern): cost per point = ₫ value per point; **points liability** = outstanding points × value × (1 − expected breakage); revenue on points is released in proportion to redemptions (Example 52: 100,000 sales, 10,000 points, 9,500 expected redeemed → 8,676 deferred; 4,500 redeemed → 4,110 recognised). **Reward cost rate** = rewards redeemed ÷ member revenue. **Incremental revenue** must use matched cohorts or a hold-out, because the best customers join first; frequency uplift = member frequency ÷ matched non-member frequency − 1.

## 7. Daily forecasting

Benchmarks before anything fancier (Hyndman & Athanasopoulos, FPP3 §5.2): **seasonal naïve** ŷ(T+h) = y(T+h−7(k+1)); **weekday profile** = trailing 4-week daily level × weekday index (weekday mean ÷ overall mean, holidays excluded). Track MAE for both and use the better one for month-to-date pace.

## 8. Vietnam context (survey shares, not per-store averages)

- iPOS.vn 2024 (Mar 2025): F&B revenue 688,800 bn ₫ (+16.6 %), 323,010 outlets; 52.3 % of consumers prefer drinks under 35,000 ₫; bands 2023→2024: <20k ₫ 4.3→12.3 %, 21–35k 29.6→40.0 %, 35–50k 47.7→31.5 %, ≥70k 7.3→5.1 %; 3–4 visits/week group 17.4→32.8 %.
- iPOS.vn H1 2024: 41.7 % visit cafés 1–2 times/month, 32.3 % 1–2 times/week; >100,000 ₫ per cup fell 6 %→1.7 %.
- iPOS.vn H1 2025: 299,900 outlets (−7.1 %), 45.3 % raised prices 5–10 %. iPOS.vn 2025 (Apr 2026): 726,500 bn ₫ (+5.5 %), 329,500 outlets, ≥35,000 ₫ drinks 57.58 %.
- Highlands Coffee 2024: 850 Vietnam stores, ~15–16 m ₫ per store per day, same-store sales −3.7 %. Phúc Long 2025: 1,891 bn ₫ (+17 %), like-for-like 22.8 m ₫ per store per day, delivery >31 % of retail revenue; Q3 2026 LFL 24.8 m ₫.
- Food delivery GMV 2025: US$2.1 bn (+19 %), Grab and ShopeeFood ~95 %.

## 9. Recommended registry entries

| id | formula | grain | report |
|---|---|---|---|
| net_sales | Σ net amount, non-voided | store-day | all periodic, Doanh thu |
| invoices | count non-voided | store-day | all periodic |
| avg_ticket | net_sales ÷ invoices | store-day | Ngày, Tháng, Hôm nay |
| items_per_ticket | Σ item qty ÷ invoices | store-day | Ngày, Thực đơn |
| avg_item_price | net item sales ÷ item qty | store-day | Thực đơn |
| attach_rate_{role} | invoices with role and drink ÷ invoices with drink | store-period | Thực đơn, Tháng |
| sales_per_hour, invoices_per_hour | net ÷ opening hours | store-hour | Giờ & ngày |
| peak_share, dead_hour_share | hour subset ÷ day | store-day | Giờ & ngày |
| revpash | net ÷ (seats × hours) | store-day | Giờ & ngày |
| sales_per_labour_hour | net ÷ staff hours | shift | Ca & két tiền |
| menu_mix_pct, item_cm, menu_class | §3 | item-period | Thực đơn |
| discount_rate, voucher_share | §1 | store-day | Khuyến mãi |
| promo_lift, promo_net_lift | §4 | store-day | Khuyến mãi |
| coupon_redemption_rate, coupon_breakage | §4 | issue cohort | Khuyến mãi, Khách hàng |
| cash_share | cash ÷ payments | store-day | Thanh toán |
| cash_variance, cash_variance_z | §5 | shift | Ca & két tiền, Ngày |
| void_rate, edit_rate, removed_line_rate | §5 | shift, cashier | Ca & két tiền |
| capture_rate | identified ÷ invoices | store-day | Chất lượng dữ liệu |
| repeat_rate, visit_frequency_30d | §6 | store-period | Khách hàng |
| cohort_retention_k | §6 | cohort | Khách hàng |
| rfm_segment | quintiles | customer | Khách hàng |
| clv | §6 | customer, segment | Khách hàng |
| points_liability, reward_cost_rate, loyalty_uplift | §6 | tenant-month | Khách hàng (loyalty P&L) |
| forecast_snaive, forecast_weekday_profile, forecast_mae | §7 | store-day | Tháng pace, Hôm nay |
| same_weekday_baseline | 8-week median | store-day | Hôm nay, Ngày, alerts |

## Checklist

- [ ] Registry entries above with vi/en labels, units, direction, source view (phase 7).
- [ ] Same-weekday baseline and weekday-profile forecast views, holiday-excluded (phase 7).
- [ ] Menu matrix with configurable 0.70 factor and provisional mode (phase 10).
- [ ] Cash tolerances and shrinkage rates in settings and views (phases 10–11).
- [ ] Promotion lift with three comparators and net lift (phase 11).
- [ ] Points valuation, breakage, reward cost rate, matched-cohort uplift (phases 17–19).
- [ ] Download iPOS.vn report PDFs to `docs/private/` and re-check the benchmark figures.

## Sources

- Menu engineering formula and actions: https://www.getmeez.com/blog/menu-engineering-matrix (2026-10-21); https://ahlei.servsafebrands.com/resources-overview/news-and-insights/the-power-of-menu-engineering-part-one (2025-04-08); FIU Hospitality Review 19(2): https://digitalcommons.fiu.edu/record/18086/files/V19n22001d.pdf
- RevPASH: https://www.hospitalitynet.org/opinion/4117170.html (2023-07-03)
- Sales per labour hour: https://yourpilla.com/blog/sales-per-labour-hour
- Forecasting benchmarks: https://otexts.com/fpp3/simple-methods.html
- RFM: https://metricgate.com/docs/customer-segmentation-rfm/ (2025-02-06)
- Promotion lift and DiD: https://racklify.com/encyclopedia/how-to-measure-promotional-lift-metrics-models-and-common-pitfalls/
- Cash tolerance and voids: https://lavu.com/how-to-handle-restaurant-cash-handling-policies/ ; https://lavu.com/how-to-handle-restaurant-pos-void-and-comp-tracking/
- Loyalty liability and IFRS 15 Example 52: https://exchangesolutions.com/glossary/points-liability/ ; https://www.pitcher.com.au/insights/accounting-for-customer-incentives-volume-rebates-and-loyalty-programs/ (2026-01-19)
- Loyalty KPIs: https://blog.brandmovers.com/loyalty-kpi-dashboard-13-metrics-formulas-and-benchmarks
- CLV: https://pos.toasttab.com/blog/customer-lifetime-value ; cohort retention: https://www.shopify.com/blog/cohort-retention-analysis
- iPOS.vn 2024 report: https://www.vietnamplus.vn/cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-nam-2024-tai-viet-nam-post1021383.vnp (2025-03-19); https://ipos.vn/en/bao-cao-nganh-fnb-2024/
- iPOS.vn H1 2024: https://www.slideshare.net/slideshow/ipos-vn-bao-cao-th-tr-ng-kinh-doanh-m-th-c-t-i-vi-t-nam-6-thang-d-u-nam-2024-pdf/272163955 (2024-08)
- iPOS.vn H1 2025: https://baodautu.vn/iposvn-ra-mat-bao-cao-thi-truong-kinh-doanh-am-thuc-nua-dau-nam-2025-d408530.html (2025-10-10)
- iPOS.vn 2025: https://ipos.vn/thong-cao-bao-chi-ipos-vn-va-nestle-professional-cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2025/ (2026-04-09)
- Highlands Coffee 2024: https://www.jollibeegroup.com/?p=3365 (2025-03-14); https://cafef.vn/highlands-coffee-hot-bac-tai-thi-truong-viet-voi-quy-mo-ap-dao-moi-doi-thu-thu-12-13-ty-dong-moi-ngay-loi-nhuan-ebitda-vuot-muc-1000-ty-dong-188250325225412604.chn (2025-03-26)
- Phúc Long: https://znews.vn/phuc-long-lai-ky-luc-tu-khi-ve-tay-masan-post1623801.html (2026-01-29); https://vnexpress.net/ky-luc-doanh-thu-cua-phuc-long-sau-khi-ve-tay-masan-5135458.html (2026-10-22)
- Food delivery GMV: https://theinvestor.vn/vietnams-online-food-delivery-market-tops-21-bln-as-foreign-apps-dominate-d18259.html (2026-01)
- Coffee chain counts: https://b-company.jp/vietnam-coffee-shop-market-2025-chain-expansion-local-brands-and-changing-consumer-habits/ (2025-12-23)
