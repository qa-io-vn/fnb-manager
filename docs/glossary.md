# Glossary

This page explains the words that the app, the reports and the technical documents use: the Vietnamese terms of the interface with their English meaning and the code ids behind them, the domain terms of shop analytics, and the technical terms of the platform. It is for the owner, who reads the app in Vietnamese and these documents in English, for a developer taking the work over, for reviewers and testers, and for whoever runs the platform after go-live. The terms come from the i18n message files (`apps/web/src/i18n/messages/`), the metric registry ([`metrics.md`](metrics.md), `packages/metrics`), the report cards (`@fnb/reports`) and the code; where a document and the code differ, the code wins.

Last updated 2026-11-12

**How to read the code ids.** A route is a hash URL of the web app (`#/bao-cao/ngay`). A key such as `nav.today` is an i18n key in `apps/web/src/i18n/messages/`. A report id (`day`) comes from `reportNames` in `packages/metrics/src/vocabulary.ts`. A card id (`top_items`) is the id of a report card in `@fnb/reports`. A metric id (`avg_ticket`) is a registry metric; a display series id (`cash_to_count`) is a series that only the web app names (`displaySeries` in `apps/web/src/metrics/registry.ts`). Status words are the six that [requirements.md, section 1.5](requirements.md#15-conventions) defines: verified locally, built, in build, designed, planned, waits for owner ([section 7](#status-words)).

## Contents

1. [Screens and navigation](#1-screens-and-navigation)
2. [Report cards](#2-report-cards)
3. [Words in the app](#3-words-in-the-app)
4. [Metric labels](#4-metric-labels)
5. [Domain terms](#5-domain-terms)
6. [Technical terms](#6-technical-terms)
7. [Programme terms](#7-programme-terms)

## 1. Screens and navigation

| Vietnamese | English | Code id | Notes |
|---|---|---|---|
| Hôm nay | Today | route `#/`; `nav.today`; report id `today` | the running business day so far and yesterday, computed from the sales rows; verified locally (phase 6) |
| Báo cáo | Reports | route `#/bao-cao`; `nav.reports` | opens Ngày |
| Báo cáo theo kỳ | Periodic reports | `placeholder.reports.title` | Ngày, Tuần, Tháng and Năm together |
| Ngày · Báo cáo ngày | Day · Daily report | route `#/bao-cao/ngay?date=YYYY-MM-DD`; report id `day`; `report.day.title` | one business day; opens on yesterday; verified locally (phase 9) |
| Tuần · Báo cáo tuần | Week · Weekly report | route `#/bao-cao/tuan?week=YYYY-Www`; report id `week` | an ISO week, Monday to Sunday; verified locally (phase 9) |
| Tháng · Báo cáo tháng | Month · Monthly report | route `#/bao-cao/thang?month=YYYY-MM`; report id `month` | a calendar month; verified locally (phase 9) |
| Năm · Báo cáo năm | Year · Yearly report | route `#/bao-cao/nam?year=YYYY`; report id `year` | a calendar year; verified locally (phase 9) |
| Chủ đề · Báo cáo chủ đề | Topics · Thematic reports | route `#/chu-de/*`; `nav.topics` | a placeholder today; designed (phase 10) |
| Kế hoạch | Plans | route `#/ke-hoach/*`; `nav.plans` | saved strategy plans, KPI follow-up and the paste box; designed (phase 11b) |
| Cài đặt | Settings | route `#/cai-dat/*`; `nav.settings` | designed (phases 10b and 12) |
| Xuất dữ liệu | Exports | route `#/xuat-du-lieu` | CSV exports and the aggregate data pack; no navigation item; designed (phase 11a) |
| Đăng nhập | Sign in | route `#/dang-nhap`; `auth.login.title` | |
| Quên mật khẩu? · Đặt lại mật khẩu | Forgot your password? · Reset password | route `#/quen-mat-khau`; `auth.forgot`, `auth.reset.title` | the reset e-mail links back to `#/mat-khau-moi` |
| Mật khẩu mới | New password | route `#/mat-khau-moi`; `auth.newPassword.title` | |
| Đăng xuất | Sign out | `auth.signOut` | |
| Bản demo · Xem bản demo · Thoát bản demo | Demo · View the demo · Leave the demo | `demo.*`; session key `fnb.demo-session` | see [demo mode](#demo-mode) |
| Chủ sở hữu | Owner (the tenant picker) | `shell.tenant` | the [tenant](#tenant) whose data is shown |
| Cửa hàng · Tất cả | Store, stores · All | `shell.stores`, `shell.stores.all`; link parameter `store=<id>,<id>` | the store selection |
| Kỳ · Tùy chọn | Period · Custom | `period.label`, `period.custom` | the period picker |
| Kỳ báo cáo · Kỳ trước · Kỳ sau | Report period · Previous period · Next period | `report.navigator.*` | the period navigator of a report |
| Giải thích chỉ số | About these numbers | `reportCard.explain` | a card's panel with Công thức (formula), Mức chi tiết (grain) and Quy ước (convention) |
| Tải CSV | Download CSV | `reportCard.downloadCsv` | UTF-8 with a byte-order mark, so Excel shows the diacritics |
| Sắp có | Coming soon | `placeholder.coming` | a screen of a later phase |
| Có phiên bản mới — tải lại | A new version is available — reload | `shell.newVersion` | |

### Thematic reports (designed, phase 10)

Names from `reportNames`; routes from [`web-app.md`](web-app.md).

| Vietnamese | English | Report id | Planned route | Phase |
|---|---|---|---|---|
| Doanh thu & xu hướng | Revenue and trends | `revenue` | `#/chu-de/doanh-thu` | 10a |
| Giờ & ngày trong tuần | Hours and weekdays | `hours` | `#/chu-de/gio-ngay` | 10a |
| Thực đơn | Menu | `menu` | `#/chu-de/thuc-don` | 10a |
| Thanh toán & tiền mặt | Payments and cash | `payments` | `#/chu-de/thanh-toan` | 10a |
| Khuyến mãi & giảm giá | Promotions and discounts | `promotions` | `#/chu-de/khuyen-mai` | 10b |
| Ca & két tiền | Shifts and cash drawer | `shifts` | `#/chu-de/ca-ket-tien` | 10b |
| So sánh cửa hàng | Store comparison | none | `#/chu-de/so-sanh` | 10b |
| Chất lượng dữ liệu | Data quality | `data_quality` | `#/chu-de/chat-luong` | 10b |
| Khách hàng | Customers | `customers` | none yet | needs customer identity (Track C, phases 16 to 19) |

`reportNames` also holds `data_pack` (the aggregate data pack for the owner's own assistant, phase 11a) and `alerts` (digests and alerts, phase 12), which are not screens.

### Settings screens (designed)

| Vietnamese (from `placeholder.settings.body`) | English | Planned route | Phase |
|---|---|---|---|
| Hồ sơ cửa hàng | Store profile | `#/cai-dat/cua-hang` | 10b |
| Dữ liệu nhập tay (giá vốn, mục tiêu, phí thanh toán) | Manual data (costs, targets, fee rates) | `#/cai-dat/du-lieu-nhap-tay` | 10b |
| Phân loại món | Item roles and category mapping | `#/cai-dat/phan-loai` | 10b |
| Ngày lễ | Holidays | `#/cai-dat/ngay-le` | 10b |
| Cảnh báo | Alerts: destinations, rules and a test button | `#/cai-dat/canh-bao` | after step 12c |
| Pháp lý | Legal texts (the consent view comes in phase 17a) | `#/cai-dat/phap-ly` | 10b |

## 2. Report cards

Each card has an id in `@fnb/reports` and a title key `report.<report>.<name>.title`. Card rules: [`reports/ngay.md`](reports/ngay.md), [`reports/tuan.md`](reports/tuan.md), [`reports/thang.md`](reports/thang.md), [`reports/nam.md`](reports/nam.md); every Vietnamese sentence of the four reports, with its English meaning, is in [`reports/cau-van-bao-cao.md`](reports/cau-van-bao-cao.md).

### Ngày (`day`, 9 cards)

| Card id | Vietnamese title | English title |
|---|---|---|
| `net_revenue` | Doanh thu thuần | Net revenue |
| `invoices` | Số hóa đơn | Invoices |
| `avg_ticket` | Giá trị trung bình mỗi hóa đơn | Average ticket |
| `hourly` | Theo giờ so với thường lệ | By hour against usual |
| `top_items` | 5 món bán chạy | Top 5 items |
| `payments` | Thanh toán và tiền mặt cần đếm | Payments and cash to count |
| `shifts` | Ca và chênh lệch két | Shifts and drawer variance |
| `discounts` | Giảm giá và voucher | Discounts and vouchers |
| `members` | Hóa đơn có số điện thoại thành viên | Invoices with a member phone number |

### Tuần (`week`, 8 cards)

| Card id | Vietnamese title | English title |
|---|---|---|
| `net_revenue` | Doanh thu tuần | Weekly revenue |
| `invoices` | Hóa đơn tuần | Weekly invoices |
| `avg_ticket` | Giá trị hóa đơn tuần | Weekly average ticket |
| `weekday_curve` | Đường theo ngày trong tuần | Curve across the week |
| `movers` | Món tăng, món giảm | Rising and falling items |
| `category_mix` | Cơ cấu nhóm món | Category mix |
| `promotions` | Khuyến mãi đã chạy | Promotions run |
| `best_worst_days` | Ngày tốt nhất và kém nhất | Best and worst days |

### Tháng (`month`, 10 cards)

| Card id | Vietnamese title | English title |
|---|---|---|
| `month_pace` | Doanh thu tháng đến nay và nhịp tháng | Month to date and monthly pace |
| `daily_trend` | Xu hướng theo ngày | Day-by-day trend |
| `pareto` | Pareto món (đường 80 %) | Item Pareto (80 % line) |
| `size_mix` | Cơ cấu size | Size mix |
| `attach_rate` | Tỷ lệ kèm topping và đồ ăn nhẹ | Topping and snack attach rates |
| `new_items` | Món mới | New items |
| `payment_mix` | Cơ cấu thanh toán | Payment mix |
| `discount_cost` | Chi phí giảm giá | Discount cost |
| `shift_stats` | Thống kê ca | Shift statistics |
| `target_progress` | Tiến độ mục tiêu | Target progress |

### Năm (`year`, 7 cards)

| Card id | Vietnamese title | English title |
|---|---|---|
| `month_matrix` | Doanh thu tháng × năm | Revenue by month and year |
| `growth` | Tăng trưởng | Growth |
| `seasonality` | Mùa vụ và Tết | Seasonality and Tết |
| `ticket_trend` | Xu hướng giá trị hóa đơn | Ticket trend |
| `item_lifecycle` | Vòng đời món | Item lifecycle |
| `year_over_year` | So với năm trước | Against last year |
| `since_opening` | Từ ngày khai trương | Since opening |

## 3. Words in the app

### Sales and items

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| hóa đơn · số hóa đơn | invoice, ticket · invoices | table `invoices`; metric `invoices` | the POS receipt of one sale; a voided one does not count as a sale |
| doanh thu thuần | net revenue | metric `net_revenue` | sales after item, bill, extra and voucher discounts |
| doanh thu gộp | gross revenue | metric `gross_revenue` | sales before those discounts |
| giá trị trung bình mỗi hóa đơn · TB mỗi hóa đơn | average ticket | metric `avg_ticket` | net revenue ÷ invoices |
| số món mỗi hóa đơn | items per ticket | metric `items_per_ticket` | items sold ÷ invoices |
| giá trung bình mỗi món · giá TB mỗi món | average item price | metric `avg_item_price` | net revenue ÷ items sold |
| món · món mới · 5 món bán chạy | item · new item · top 5 items | `agg_item_daily`; card `top_items` | an item line of kind `item`; modifiers are never items |
| nhóm món · Chưa phân loại | category · Uncategorised | POS item type (`item_types`) | the POS's own grouping of the menu |
| vai trò món · Gán vai trò món | item role · Assign item roles | enum `item_type_role`; table `item_type_roles`; `report.action.settings_roles` | what an item type is for the reports: see the next row |
| Đồ uống · Topping · Đồ ăn · Đồ ăn nhẹ · Khác · Chưa gán vai trò | drink · topping · food · snack · other · no role yet | `drink`, `topping`, `food`, `snack`, `other` | the five roles; an unmapped role leaves the attach rates unmeasured, not zero |
| size · cơ cấu size · tỷ trọng size L | size · size mix · size L share | `size_label`; card `size_mix`; metric `size_l_share` | the size read from the item name, such as "(L)" |
| tỷ lệ kèm topping · tỷ lệ kèm đồ ăn nhẹ | topping attach rate · snack attach rate | metrics `attach_rate_topping`, `attach_rate_snack` | see [attach rate](#attach-rate) |
| thành viên · hóa đơn có số điện thoại thành viên | member · invoice with a member phone number | metric `member_invoice_share` | an invoice that carries a customer phone number |
| định danh khách · tỷ lệ định danh khách | customer capture · capture rate | metric `customer_capture_rate` | an invoice with a customer phone number or a customer id |
| hủy hóa đơn · sửa hóa đơn · dòng bị xóa | voided invoice · edited invoice · removed line | metrics `void_rate`, `edit_rate`, `removed_line_rate`; table `invoice_events` | adjustments the sync detects |

### Payments, shifts and cash

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| thanh toán · phương thức · loại | payment · method · kind | tables `invoice_payments`, `payment_methods` | the tenders of an invoice and how they are classified |
| Tiền mặt · Thẻ · Chuyển khoản · Ví điện tử · Voucher · Khác | cash · card · bank transfer · e-wallet · voucher · other | enum `payment_kind`: `cash`, `card`, `bank_transfer`, `ewallet`, `voucher`, `other` | the payment kinds |
| tỷ trọng tiền mặt | cash share | metric `cash_share` | cash tenders ÷ all tenders |
| tiền mặt cần đếm | cash to count | display series `cash_to_count` | the day's cash tenders, without the opening float |
| ca · mở ca · đóng ca | shift · opened · closed | table `shifts` | a cashier's POS shift |
| thu ngân · chưa rõ thu ngân | cashier · unknown cashier | `cashier_name` | |
| két · két tiền · tiền trong két | cash drawer · drawer · counted drawer | `drawer_amount` | the cash counted in the drawer at the end of a shift |
| quỹ đầu ca | opening float | `opening_float_amount` | the cash in the drawer when the shift opens |
| tiền mặt dự kiến | expected cash | `expected_cash_amount` | opening float plus the shift's cash tenders |
| chênh lệch két · chênh lệch tiền mặt | drawer variance · cash variance | metric `cash_variance` | counted drawer − expected cash |
| điểm z · bất thường so với các ca trước | z-score · unusual against earlier shifts | metric `cash_variance_zscore` | see [z-score](#z-score) |
| vượt ngưỡng tuyệt đối · vượt ngưỡng tương đối | over the absolute threshold · over the relative threshold | `over_abs_threshold`, `over_rel_threshold` | defaults 50,000 in the tenant's currency and 0.5 % of the shift's cash sales |
| Ca lệch két vượt ngưỡng | flagged shifts | display series `flagged_shifts` | shifts over any of the three thresholds |
| khuyến mãi · giảm giá món · giảm giá hóa đơn · voucher | promotion · item discount · bill discount · voucher | `promotion_kind`: `item`, `bill`, `voucher` | |
| tỷ lệ giảm giá · chi phí giảm giá | discount rate · discount cost | metric `discount_rate`; display series `discount_cost` | all discounts ÷ gross revenue; the discount amount itself |

### Comparisons and time

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| kỳ này · kỳ trước · năm trước | this period · previous period · last year | `report.periodRow.*`; rows `current`, `previous`, `last_year` of `period_compare` | the compared periods cover the same elapsed days |
| so với hôm trước | against the day before | `report.compare.previous.day` | Ngày's first comparison |
| so với cùng thứ năm trước | against the same weekday last year | `report.compare.lastYear.day` | the day 364 days earlier, so the weekday matches |
| cùng kỳ tháng trước | the same days of last month | Tháng sentences | the same elapsed days of the previous month |
| mức nền · mức nền cùng thứ | baseline · same-weekday baseline | metric `same_weekday_baseline`; row `baseline` | see [baseline](#baseline) |
| thường lệ · so với thường lệ | usual · against usual | card `hourly` | the hourly baseline of Ngày |
| trung bình 4 tuần | 4-week average | `report.periodRow.average4Weeks` | Tuần's reference: the same elapsed days of the four weeks before, Tết weeks skipped |
| cùng cửa hàng (k/N) | same stores (k of N) | `report.compare.likeForLike` | see [like-for-like](#like-for-like) |
| nhịp tháng · doanh thu tháng đến nay | monthly pace · month to date | card `month_pace`; function `month_pace` | the month so far and where it is heading |
| dự báo theo đặc trưng ngày trong tuần | weekday-profile forecast | metric `forecast_weekday_profile` | level of the last 28 days × the weekday's index |
| dự báo mùa vụ đơn giản | seasonal-naïve forecast | metric `forecast_seasonal_naive` | the latest same-weekday day with sales |
| mục tiêu · tiến độ mục tiêu · Đặt mục tiêu tháng | target · target progress · set monthly targets | table `targets`; card and display series `target_progress`; `report.action.settings_targets` | a net-sales target per store and month or week |
| mùa vụ · chỉ số mùa vụ | seasonality · seasonality index | card `seasonality`; display series `seasonality_index` | see [seasonality](#seasonality) |
| Tết · ngày lễ · ngày nghỉ riêng | Tết · public holiday · own day off | `holiday_kind`: `tet`, `public`, `custom` | days left out of baselines; see [Tết](#tết) |
| vòng đời món: Mới · Tăng · Ổn định · Giảm · Ngừng bán | item lifecycle: new · growing · steady · declining · discontinued | card `item_lifecycle`; display series `item_lifecycle_count` | rules in [`metrics.md`](metrics.md#item-lifecycle-statuses-năm) |
| từ ngày khai trương | since opening | card `since_opening`; display series `since_opening_net` | weekly averages of a young store since it opened |
| giờ cao điểm · giờ thấp điểm | peak hour · dead hour | metrics `peak_share_20_21`, `dead_hour_share_17_18` | the share of daily net in local hours 20–21 and 17–18 |
| chênh lệch · điểm % | difference, change · percentage points | `report.value.points` | a share or rate is compared in percentage points |
| tr · tỷ | million · billion | `money.million`, `money.billion` | compact money; English shows M and B |

### Data status

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| đã đối soát · chưa đối soát | reconciled · not reconciled | `badge.verified`, `badge.unverified` | every selected store-day matches the POS [control totals](#control-totals) (`sync_checks.is_matched`), or not |
| tạm tính | provisional | `reportCard.provisional` | an input is missing (costs, seats or customer identity), so the figure is incomplete |
| đang cập nhật | updating | `report.marker.stale` | a recent day's item, payment or shift aggregates still lag its live totals (`store_coverage.stale_days`) |
| dữ liệu mẫu | sample data | `badge.sample` | demo numbers |
| chưa đồng bộ · cập nhật lúc | not synced yet · updated at | `badge.neverSynced`, `badge.updatedAt` | the freshness badge: the latest successful sync run |
| chưa có dữ liệu năm trước · cửa hàng mới | no data from last year yet · new store | `report.unavailable.store_too_young.*` | the store opened after the reference period started |
| chưa đo được · chưa thiết lập · đang tích lũy dữ liệu | not measured · not set up · still collecting data | `report.unavailable.*` | why a comparison has no value; never shown as 0 |

### Digests and alerts (phase 12)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| Bản tin ngày | daily digest | table `digests`; `fnb digest` | the short daily summary built from the Ngày report and sent to a chat or e-mail; in build (step 12b) |
| Cảnh báo vận hành | operational alert | tables `alert_events`, `alert_rule_catalog` | its own message about a problem that needs action soon, such as a refused POS login, a failed or stale sync, a failed job or a failing channel; business warnings such as low revenue are lines of the digest instead; in build (step 12b) |
| Cài đặt → Cảnh báo | Settings → Alerts | route `#/cai-dat/canh-bao` | the planned screen for destinations, alert rules and a test message; designed (after step 12c) |
| Mã liên kết | link code | `FNB-` plus 8 characters (`app.issue_link_code`) | the one-time code a member sends to the Zalo Bot to link their chat, valid 15 minutes; verified locally (step 12a) |
| Mã xác nhận | confirmation code | 6 digits; `app.confirm_email_link` | the code e-mailed to a member's login address to link it, valid 15 minutes; the member hands it back, and five wrong codes remove the pending destination; in build (step 12b) |
| ĐỒNG Ý | I agree | the reply a member sends | accepts a linked chat and records the member's consent to notifications |

## 4. Metric labels

The 41 metrics of the registry, with the labels the app shows ([`metrics.md`](metrics.md) holds the formulas). "Status" says whether the data exists: `needs costs` waits for item costs, `needs seats` for seat counts, and `needs customer identity` for the loyalty phases.

| Vietnamese | English | Metric id | Group | Status |
|---|---|---|---|---|
| Doanh thu thuần | Net revenue | `net_revenue` | sales | available now |
| Doanh thu gộp | Gross revenue | `gross_revenue` | sales | available now |
| Số hóa đơn | Invoices | `invoices` | sales | available now |
| Giá trị trung bình mỗi hóa đơn | Average ticket | `avg_ticket` | sales | available now |
| Số món mỗi hóa đơn | Items per ticket | `items_per_ticket` | sales | available now |
| Giá trung bình mỗi món | Average item price | `avg_item_price` | sales | available now |
| Tỷ trọng tiền mặt | Cash share | `cash_share` | sales | available now |
| Tỷ lệ hóa đơn dùng voucher | Voucher invoice share | `voucher_invoice_share` | sales | available now |
| Tỷ lệ hóa đơn có thành viên | Member invoice share | `member_invoice_share` | sales | available now |
| Tỷ lệ giảm giá | Discount rate | `discount_rate` | sales | available now |
| Tỷ lệ kèm topping | Topping attach rate | `attach_rate_topping` | sales | available now |
| Tỷ lệ kèm đồ ăn nhẹ | Snack attach rate | `attach_rate_snack` | sales | available now |
| Tỷ trọng size L | Size L share | `size_l_share` | sales | available now |
| Doanh thu mỗi giờ mở cửa | Sales per opening hour | `sales_per_opening_hour` | time | available now |
| Hóa đơn mỗi giờ mở cửa | Invoices per opening hour | `invoices_per_opening_hour` | time | available now |
| Doanh thu mỗi ghế mỗi giờ | Revenue per available seat hour | `revpash` | time | needs seats |
| Tỷ trọng giờ cao điểm 20–21h | Peak-hour share (20:00–21:59) | `peak_share_20_21` | time | available now |
| Tỷ trọng giờ thấp điểm 17–18h | Dead-hour share (17:00–18:59) | `dead_hour_share_17_18` | time | available now |
| Tỷ trọng theo ngày trong tuần | Weekday share (one value per ISO weekday 1–7) | `weekday_share` | time | available now |
| Mức nền cùng ngày trong tuần | Same-weekday baseline | `same_weekday_baseline` | baselines | available now |
| Dự báo theo đặc trưng ngày trong tuần | Weekday-profile forecast | `forecast_weekday_profile` | baselines | available now |
| Dự báo mùa vụ đơn giản | Seasonal-naïve forecast | `forecast_seasonal_naive` | baselines | available now |
| Sai số dự báo tuyệt đối trung bình | Forecast mean absolute error | `forecast_mae` | baselines | available now |
| Tốc độ bán món | Item velocity | `item_velocity` | menu | available now |
| Phân loại thực đơn | Menu class (Kasavana–Smith) | `menu_class` | menu | needs costs |
| Chênh lệch tiền mặt | Cash variance | `cash_variance` | cash | available now |
| Điểm z chênh lệch tiền mặt | Cash variance z-score | `cash_variance_zscore` | cash | available now |
| Tỷ lệ hủy hóa đơn | Void rate | `void_rate` | cash | available now |
| Tỷ lệ sửa hóa đơn | Edit rate | `edit_rate` | cash | available now |
| Tỷ lệ dòng bị xóa | Removed-line rate | `removed_line_rate` | cash | available now |
| Tỷ lệ hóa đơn định danh khách | Customer capture rate | `customer_capture_rate` | customers | available now |
| Tỷ lệ khách quay lại | Repeat rate | `repeat_rate` | customers | needs customer identity |
| Tần suất ghé 30 ngày | Visit frequency, 30 days | `visit_frequency_30d` | customers | needs customer identity |
| Tần suất ghé 90 ngày | Visit frequency, 90 days | `visit_frequency_90d` | customers | needs customer identity |
| Giữ chân theo nhóm tháng | Cohort retention | `cohort_retention` | customers | needs customer identity |
| Phân khúc RFM | RFM quintiles | `rfm_quintiles` | customers | needs customer identity |
| Giá trị vòng đời khách hàng | Customer lifetime value | `customer_ltv` | customers | needs customer identity and costs |
| Nợ điểm thưởng | Loyalty points liability | `loyalty_liability` | customers | needs customer identity |
| Tỷ lệ điểm hết hạn không dùng | Breakage rate | `breakage_rate` | customers | needs customer identity |
| Tỷ lệ chi phí thưởng | Reward cost rate | `reward_cost_rate` | customers | needs customer identity |
| Mức tăng tần suất của thành viên | Member frequency uplift | `member_frequency_uplift` | customers | needs customer identity |

Display series that only the web app names (`displaySeries`):

| Vietnamese | English | Display series id |
|---|---|---|
| Doanh thu thuần theo giờ | Net revenue by hour | `hourly_net` |
| Doanh thu món | Item revenue | `item_net` |
| Tiền mặt cần đếm | Cash to count | `cash_to_count` |
| Chi phí giảm giá | Discount cost | `discount_cost` |
| Ca lệch két vượt ngưỡng | Flagged shifts | `flagged_shifts` |
| Doanh thu theo ngày trong tuần | Net revenue by weekday | `weekday_net` |
| Tỷ trọng doanh thu theo nhóm món | Category share of item revenue | `category_net_share` |
| Doanh thu thuần theo ngày | Daily net revenue | `daily_net` |
| Số món tạo 80 % doanh thu món | Items making 80 % of item revenue | `item_pareto_count` |
| Số món mới | New items | `new_item_count` |
| Tiến độ mục tiêu | Target progress | `target_progress` |
| Doanh thu tháng theo năm | Monthly net revenue by year | `month_year_net` |
| Chỉ số mùa vụ | Seasonality index | `seasonality_index` |
| Số món theo vòng đời | Items by lifecycle status | `item_lifecycle_count` |
| Doanh thu từ ngày khai trương | Net revenue since opening | `since_opening_net` |

## 5. Domain terms

### Attach rate

The share of invoices with a drink that also hold a topping (or a snack): `topping_invoices` ÷ `drink_invoices`. It needs the item roles; an unmapped role makes it null, not 0. Vietnamese: tỷ lệ kèm. Metrics `attach_rate_topping`, `attach_rate_snack`.

### Average item price

Net revenue ÷ items sold, so that average ticket = items per ticket × average item price exactly. Vietnamese: giá trung bình mỗi món. Metric `avg_item_price`.

### Baseline

The median of the same weekday over the previous 8 weeks, with holidays, Tết and the tenant's own days off left out and days without data skipped. A median is never like-for-like and is never decomposed. Vietnamese: mức nền cùng thứ. Metric `same_weekday_baseline`.

### Business day

The day a sale belongs to: the store-local time of the sale minus the store's day start (`business_day_start_minutes`), as a date. With a 05:00 day start, a sale at 00:30 belongs to the previous day. Every report counts business days ([`schema.md`](schema.md#business-date)).

### Business date

The same as [business day](#business-day): the date a sale belongs to. Columns and arguments call it `business_date`.

### Control totals

The POS's own count and net of the non-voided sales of one store and business date. The sync compares them with what it stored and writes the result to `sync_checks` (`source_*` against `local_*`, `is_matched`). Vietnamese: đối soát (reconciliation).

### Decomposition

The split of a revenue change into the parts due to invoices, items per ticket and average item price; the parts add up exactly to the total ([`metrics.md`](metrics.md#decomposition)). Vietnamese sentences: "Phần lớn do …".

### Difference-in-differences

A way to measure promotion lift: (test after − test before) − (control after − control before), with the same-weekday baseline, a sister store or earlier weeks without the promotion as the control. Designed for Khuyến mãi & giảm giá (phase 10b) ([`deep-dives/fnb-kpi-standards.md`](deep-dives/fnb-kpi-standards.md)).

### Items per ticket

Items sold ÷ invoices, counting lines of kind `item` only. Vietnamese: số món mỗi hóa đơn. Metric `items_per_ticket`.

### Like-for-like

A comparison over the same stores on both sides. A store counts for a reference period when its history starts on or before that period's first day; when only some stores count, the report compares those stores only and says so: "cùng cửa hàng (k/N)" ([`metrics.md`](metrics.md#coverage-and-like-for-like)).

### Menu engineering

The Kasavana–Smith matrix: each item of a role is popular or not (its share of the role's quantity against 0.7 ÷ the number of items) and high or low margin (its contribution margin, or its price while costs are missing, against the role's quantity-weighted mean). Classes: star (popular, high), plowhorse (popular, low), puzzle (not popular, high), dog. Function `menu_matrix`, metric `menu_class`; designed for Thực đơn (phase 10a).

### Modifier

A line that changes an item, such as a sugar or ice level, usually at zero price. Modifiers are never counted as items (`line_kind` `modifier`).

### Pareto

The fewest items, ranked by revenue, that together make 80 % of item revenue. Card `pareto` of Tháng; display series `item_pareto_count`.

### RevPASH

Revenue per available seat hour: net revenue ÷ (seats × opening hours). It needs the seat count in the store profile. Vietnamese: doanh thu mỗi ghế mỗi giờ. Metric `revpash` (status `needs seats`).

### Seasonality

The pattern of the year. The seasonality index of a month is its average daily net ÷ the mean of the 12 months' averages; Năm also shows the Tết dip, the net of the Tết week against the four weeks before ([`metrics.md`](metrics.md#seasonality-index-năm)). Vietnamese: mùa vụ.

### Store-day

One store on one business day: the unit that the sync replaces in one step and checks against the control totals.

### Tết

The Lunar New Year. The `holidays` rows of kind `tet` mark every day of its window (61 global rows of public holidays and Tết for 2024 to 2028); days between two Tết rows at most 14 days apart count as Tết too (`app.tet_window`). Tết days are left out of baselines, and Tuần's 4-week average skips a week that holds one.

### Ticket

The sale an invoice records. "Average ticket" (giá trị trung bình mỗi hóa đơn) is net revenue ÷ invoices.

### Verified day

A day whose numbers match the POS: every store-day the screen shows has a `sync_checks` row with `is_matched` true, so the count equals the POS count and the net is within tolerance of the POS net ([control totals](#control-totals)). The app shows "đã đối soát"; one unmatched or unchecked store-day makes it "chưa đối soát". Verified locally (phases 6, 7 and 9; FR-DQ-05).

### Z-score

How unusual a shift's drawer variance is: (variance − the mean of the store's shifts in the trailing 56 days) ÷ their standard deviation. It needs 3 earlier shifts; when it is more than 2 in either direction, the shift is flagged. Vietnamese: điểm z. Metric `cash_variance_zscore`.

## 6. Technical terms

### Aggregate refresh

`app.refresh_analytics(tenant, from, to)` rebuilds the `agg_*` tables of a tenant for a date range from the sales rows; the sync jobs call it, and an owner or manager may call `refresh_my_analytics`. Days from yesterday on are read live, so a report never waits for a refresh ([`schema.md`](schema.md#hot-and-cold-rule)).

### Alert episode

One open row in `alert_events` per rule and subject (a dedupe key such as the store or the account), however often the problem recurs: it counts the occurrences, keeps the cool-down in `last_notified_at`, sends reminders at the rule's `remind_every`, and records how and when it was resolved. Its facts are counts only. The rules and their defaults are in `alert_rule_catalog`. In build (step 12b).

### As-of day

The last complete business day of the selected stores: the earliest store-local business date of now, minus one. Reports end there; Hôm nay owns the running day.

### Capability

A feature a [connector](#connector) declares, such as `shifts` or `controlTotals`; the sync uses only what is declared ([`connectors.md`](connectors.md)).

### Conformance suite

The shared tests every connector must pass (`@fnb/connector-core/conformance`); the mock and iPOS Fabi connectors pass it.

### Connector

The adapter between one POS vendor and the canonical model (`PosConnector`). Today `ipos-fabi` and `mock`.

### Data pack

The versioned, aggregate-only JSON file that the owner gives to their own assistant to draft a store plan (ADR-003): store profile, weekly and monthly totals, heatmap, items, mixes and other figures from the metric registry, with the strategy prompt; no row-level or personal data. Buttons "Tải gói dữ liệu cho AI" and "Sao chép gói + prompt", and `fnb datapack`. Designed (phase 11a; detailed design pending).

### Data roles

`owner`, `manager`, `staff` and `viewer`: the tenant roles that read sales. `publisher` is outside them ([`api.md`](api.md#tenant-roles)).

### Dead-man's switch

The check that a store is still being synced: when a watched store passes 90 minutes of opening time without a successful sync (`app.sync_gap_minutes`), the `sync_stale` alert is raised. Every incremental run and every scheduler tick checks it, and the nightly run checks the previous day ([`sync.md`](sync.md#notifier-and-dead-mans-switch)). Verified locally (phase 7).

### Demo mode

The web app built without `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY`: no login, two sample stores (`MOCK-S1`, `MOCK-S2`) generated in the browser from a fixed seed, reports run by the TypeScript port of the SQL, and a banner: "Bản demo: đây là số liệu mẫu, không phải của một cửa hàng thật." A configured build offers it on the login page ("Xem bản demo").

### Digest

The daily summary message for a member: the Ngày report built as that member and reduced to a few cards. It is built once every store has settled the day, and at the latest at the deadline (06:30 local time by default), then queued in the outbox. Vietnamese: bản tin ngày. In build (step 12b).

### Edge Function

A small Deno program that Supabase hosts and runs on request. `sync-incremental` (`supabase/functions/sync-incremental`) is built and verified locally; `notify` is planned for step 12c ([`api.md`](api.md#5-edge-function-endpoints)).

### Fixture tenant

A tenant that a test builds for itself, so its counts never depend on the real tenant or the seed. Notification tests use slugs that start with `notify-it-` and synthetic `_IT` secret names; pgTAP files run in a rolled-back transaction, and integration runs delete fixture tenants older than an hour.

### Hot and cold rule

Business days before yesterday are read from the aggregate tables; yesterday and today are computed live from the sales rows, so today is right after every sync.

### i18n key

The name of a user-facing text, such as `nav.today`; every key exists in Vietnamese and English (`apps/web/src/i18n/messages/<area>.vi.json` and `.en.json`).

### Outbox

`outbound_messages`: the queue of every digest and alert message and its one-year log. Every send decision (consent, allowed hours, limits) is taken in SQL when a dispatcher claims a message. Verified locally (step 12a).

### Parity test

The suite in `packages/demo-analytics/test/parity/` that applies the real migrations in PGlite (and on the Postgres stack in CI), loads the same generated days and compares every row and value of the TypeScript port with the SQL functions (ADR-029).

### pg_cron

A Postgres extension that runs scheduled jobs inside the database. The job `sync-incremental` runs every 30 minutes once `app.enable_incremental_sync` is called; no job is scheduled on the local stack today. A notification schedule is planned for step 12c.

### pg_net

A Postgres extension that sends HTTP requests from SQL, after the transaction commits. The scheduler posts its tickets to the Edge Function through it.

### pgTAP

The SQL test framework of the database tests in `supabase/tests/`, run with `pnpm exec supabase test db`.

### PGlite

Postgres compiled to WebAssembly; the parity suite runs the migrations in it on every test run.

### PostgREST

The Supabase service that turns the tables, views and functions of the `public` schema into HTTP endpoints, running each request as `anon` or `authenticated` ([`api.md`](api.md)).

### Publishable key and secret key

The two Supabase API keys. The publishable key (`sb_publishable_…`) is public and only identifies the project; the secret key (`sb_secret_…`) bypasses RLS and stays on the owner's machine and in GitHub secrets ([`secrets.md`](secrets.md)).

### Publisher

The tenant role `publisher`: a service identity for publishing strategy plans, kept outside the [data roles](#data-roles) so that a leaked publisher login reads no sale (ADR-013). It reads its tenant, the stores in its scope, plans, holidays, the calendar and the global alert-rule catalogue and channel-policy defaults, and inserts plans; it reads no sale, aggregate, refresh log or live view. The role is verified locally; `fnb publish-plan`, which signs in as it, is designed (phase 11b).

### RLS

Row-level security: Postgres policies that decide, per role and store scope, which rows a signed-in user may read or write. Every table in `public` has it ([`schema.md`](schema.md#row-level-security)).

### RPC

Remote procedure call: here, a Postgres function called over HTTP, `POST /rest/v1/rpc/<name>`, which supabase-js sends with `supabase.rpc()`. The periodic reports take every number from such calls ([`api.md`](api.md#3-functions-in-public)).

### Security invoker and security definer

A `security invoker` function runs as its caller, so RLS applies to it; a `security definer` function runs as its owner and must check the caller itself. 24 of the 25 functions in `public` are invoker.

### Seed

`supabase/seed.sql`: the synthetic data that `pnpm db:reset` loads after the migrations. It holds the tenant `demo-fnb` with the stores `TEA` (Demo Tea House) and `COF` (Demo Coffee Bar), a development login and seven business days of sales. A reset wipes everything else, so it is never run on a machine that holds real data.

### Store scope

The stores a member may see and manage: `tenant_members.store_ids`, where null means every store of the tenant.

### Tenant

One owner organisation and everything that belongs to it: stores, POS accounts, members and data (`tenants`). Vietnamese in the app: Chủ sở hữu.

### Ticket (dispatch ticket)

A random single-use id that the database issues before it calls an Edge Function, instead of an API key (ADR-028). The function claims it once, before any other work; it expires after 10 minutes by default. Not to be confused with a sales [ticket](#ticket).

## 7. Programme terms

### Decision gates

The owner's decisions at fixed points of the roadmap (section 6): G1 the cloud project, SMTP and secrets before the cloud steps of phase 5; G2 the POS CRM rail or the fallback rail at the end of phase 16a; G3 the cross-border transfer dossier or the exemption before phase 19b; G4 Supabase Pro before phase 19b, or earlier at about 400 MB, a second owner or mandatory daily backups; G5 a monthly scheduled strategy run (default: by hand); G6 the scheduler of the incremental sync (decided: `pg_cron` with the Edge Function, ADR-020).

### Owner check

An acceptance check only the owner can do: comparing results with the POS reports or private figures, or acting in an account only the owner holds. The results stay in `docs/private/` ([test-plan.md](test-plan.md#11-owner-acceptance-checks)).

### Status words

The six states every requirement and component carries ([requirements.md, section 1.5](requirements.md#15-conventions)): **verified locally** (built and passed an independent verification on the local stack and in the commands CI runs), **built** (in the repository, not yet verified as a whole), **in build** (step 12b, being integrated and verified now), **designed** (specified, not built; phases 10 and 11 are designed at roadmap level), **planned** (in the roadmap, not designed in detail, not started) and **waits for owner** (built or ready, but its acceptance needs an owner action).

### Track Z

The owner's paperwork beside the build: the legal form, the Zalo accounts and their verification, e-invoicing, the POS CRM questions, the privacy notice and the legal read ([roadmap.md](roadmap.md), section 5). Its lead times cannot be shortened by building faster, and Tracks B and C start only when it allows. Tracks A to D are the build tracks: A platform and analytics (phases 1 to 12), B Zalo for managers and staff (13 to 15), C Zalo customer loyalty (16 to 19), D portability, hardening and launch (20).
