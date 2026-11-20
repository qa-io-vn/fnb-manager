# Glossary

This page explains the words that the app, the reports and the technical documents use: the Vietnamese terms of the interface with their English meaning and the code ids behind them, the domain terms of shop analytics, and the technical terms of the platform. It is for the owner, who reads the app in Vietnamese and these documents in English, for a developer taking the work over, for reviewers and testers, and for whoever runs the platform after go-live. The terms come from the i18n message files (`apps/web/src/i18n/messages/`), the metric registry ([`metrics.md`](metrics.md), `packages/metrics`), the report cards (`@fnb/reports`) and the code; where a document and the code differ, the code wins.

Last updated 2026-11-19

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
| Chủ đề · Báo cáo chủ đề | Topics · Thematic reports | route `#/chu-de/*`; `nav.topics`; links carry `range=<preset>` or `from=YYYY-MM-DD&to=YYYY-MM-DD`, and `store=<id>,<id>` | one subject over any range of days; four built (10a), four more in 10b ([below](#thematic-reports-phase-10)) |
| Kế hoạch | Plans | route `#/ke-hoach/*`; `nav.plans` | saved strategy plans, KPI follow-up and the paste box; designed (phase 11b) |
| Vận hành: Checklist · Két tiền · Sự cố & bàn giao | Operations: checklists · cash drawer · incidents and handovers | routes `#/van-hanh/checklist`, `#/van-hanh/ket-tien`, `#/van-hanh/su-co` (`#/van-hanh` opens Checklist); `operations.*` | what the staff app recorded per store, day and shift: checklist compliance, the app's cash counts beside the POS drawer, and the incident and handover log; owners and managers only; built (14b, #225); no navigation item |
| Khách hàng: Thành viên · Hàng chờ đối soát · Bất thường theo ca | Customers: members · reconciliation queue · shift anomalies | routes `#/khach-hang/thanh-vien`, `#/khach-hang/thanh-vien/:membershipId`, `#/khach-hang/doi-soat`, `#/khach-hang/bat-thuong` (`#/khach-hang` opens Thành viên); `loyalty.*` | the loyalty members with masked phones and their ledgers, the cases a manager decides, and earns and refusals per shift; owners, managers and viewers; live data only, the demo explains it; built (17a, #253); no navigation item. Not the planned customer report `customers` |
| Cài đặt | Settings | route `#/cai-dat/*` (`#/cai-dat` opens Cửa hàng); `nav.settings` | in build: the layout, the settings source, Ngưỡng báo cáo, the roles tab of Phân loại and the catch-up line are built (10a); the other pages in 10b and 12; Nhân viên built in 14a (#214) and Checklist in 14b (#220), both for owners and managers only; Khách hàng thân thiết built in 16a and 18b (#240, #270) |
| Xuất dữ liệu | Exports | route `#/xuat-du-lieu`, tabs `?tab=goi` and `?tab=xuat`; `exports.*` | two tabs: "Gói dữ liệu cho AI" (the aggregate [data pack](#data-pack), the default tab, built in the browser and downloaded or copied with its prompt; built in 11a, #142) and "Xuất dữ liệu" (CSV or JSON files of invoices, lines, payments, shifts and the daily summary by month, each proven equal to the database; built in 11a, [exports.md](exports.md)); owners and managers only; no navigation item |
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
| Tải CSV | Download CSV | `reportCard.downloadCsv` | UTF-8 with a byte-order mark, so Excel shows the diacritics; comma-separated, or semicolon-separated with a decimal comma on a device set to that format |
| Cập nhật ngay | Refresh now | `settings.catchUp.start`; banner `settings.catchUp.*` | the action on the catch-up line of a theme or settings page: recalculate the days still pending after a mapping change (owners and managers) |
| Thiết bị này | This device | `preferences.csvDialect`; `settings.thresholds.device.*` | a choice kept in the browser of one phone or computer: comma (the default) or semicolon CSV downloads |
| Sắp có | Coming soon | `placeholder.coming` | a screen of a later phase |
| Có phiên bản mới — tải lại | A new version is available — reload | `shell.newVersion` | |

### Thematic reports (phase 10)

Names from `reportNames`; routes from [`web-app.md`](web-app.md).

| Vietnamese | English | Report id | Route | Phase |
|---|---|---|---|---|
| Doanh thu & xu hướng | Revenue and trends | `revenue` | `#/chu-de/doanh-thu` | 10a, built |
| Giờ & ngày trong tuần | Hours and weekdays | `hours` | `#/chu-de/gio-ngay` | 10a, built |
| Thực đơn | Menu | `menu` | `#/chu-de/thuc-don` | 10a, built |
| Thanh toán & tiền mặt | Payments and cash | `payments` | `#/chu-de/thanh-toan` | 10a, built |
| Khuyến mãi & giảm giá | Promotions and discounts | `promotions` | `#/chu-de/khuyen-mai` | 10b |
| Ca & két tiền | Shifts and cash drawer | `shifts` | `#/chu-de/ca-ket-tien` | 10b |
| So sánh cửa hàng | Store comparison | `stores` | `#/chu-de/so-sanh` | 10b, built |
| Chất lượng dữ liệu | Data quality | `data_quality` | `#/chu-de/chat-luong` | 10b |
| Khách hàng | Customers | `customers` | none yet | needs customer identity (Track C, phases 16 to 19) |

`reportNames` also holds `data_pack` (the aggregate data pack for the owner's own assistant, phase 11a) and `alerts` (digests and alerts, phase 12), which are not screens.

### Settings screens (phase 10)

| Vietnamese (from `placeholder.settings.body`) | English | Planned route | Phase |
|---|---|---|---|
| Hồ sơ cửa hàng | Store profile | `#/cai-dat/cua-hang` | 10b |
| Dữ liệu nhập tay (giá vốn, mục tiêu, phí thanh toán) | Manual data (costs, targets, fee rates) | `#/cai-dat/du-lieu-nhap-tay` | 10b |
| Phân loại món | Item roles and category mapping | `#/cai-dat/phan-loai`; `settings.mapping.*` | the roles tab built (10a); category mapping and payment kinds 10b |
| Ngưỡng báo cáo | Report thresholds | `#/cai-dat/bao-cao`; `settings.thresholds.*` | built (10a): the menu, cash and hour thresholds of `report_settings`, and "Thiết bị này", the device's CSV format |
| Ngày lễ | Holidays | `#/cai-dat/ngay-le` | 10b |
| Cảnh báo | Alerts: destinations, rules and a test button | `#/cai-dat/canh-bao` | after step 12c |
| Pháp lý | Legal texts (the consent view comes in phase 17a) | `#/cai-dat/phap-ly` | 10b |
| Nhân viên | Staff: the roster, pairing codes, the staff app's QR code per store and the staff revenue level | `#/cai-dat/nhan-vien`; `settings.staff.*` | built (14a, #214); listed for owners and managers only ([below](#staff-and-the-staff-app-phase-14a)); the owner's contact note for staff added in 14b |
| Checklist | Checklists: the opening, mid-shift and closing checklists of each store | `#/cai-dat/checklist`; `settings.checklists.*` | built (14b, #220); listed for owners and managers only ([below](#shift-operations-phase-14b)) |
| Khách hàng thân thiết | Loyalty programme: tabs Chương trình (`?tab=chuong-trinh`) and Ưu đãi (`?tab=uu-dai`) | `#/cai-dat/khach-hang-than-thiet`; `settings.loyalty.*`, `settings.rewards.*` | built (16a #240, 18b #270) ([below](#loyalty-phases-16-to-18)) |

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
| mức giảm tối đa · vượt mức | maximum discount · over the cap | card `rule_cap`; display series `over_cap_promotions`; rule `discount_cap` of `promotionRules` | an item or bill discount strictly between the cap in force on its day (50 %) and the whole amount before it; vouchers are listed apart |
| món tặng · hóa đơn miễn phí | gift line · free invoice | `theme.promotions.ruleCap.gift`, `.freeInvoice`; `full_discount_rows` of `promotion_compliance` | a line or an invoice discounted in full; counted apart and never over the cap |
| ngày giảm giá bán · chỉ để theo dõi | price-discount day · for information only | metric `discount_days`; card `rule_days`; rule `discount_days` | a day the item sold below its price on its line or under a bill discount below 100 %; gift and voucher days are not price-discount days. "Chỉ để theo dõi" marks the count after the 120-day limit's reported repeal on 26 June 2026 |
| chương trình may rủi | lucky draw | rule `lucky_draw_registration`; `theme.promotions.catalogue.luckyDraw` | a promotion with an element of chance, which needs registration; found by keywords in promotion names |

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
| giờ cao điểm · giờ thấp điểm · giờ đông · giờ vắng | peak hour · dead hour · busy hour · quiet hour | `theme.hours.level.*`; metrics `peak_share_top_hours`, `dead_hour_share`, and the fixed-window `peak_share_20_21` and `dead_hour_share_17_18` | Giờ & ngày finds them with the thresholds of Ngưỡng báo cáo (see [hour profile](#hour-profile)); Ngày's hourly card shows the share of daily net in the fixed local hours 20–21 (`peak_share_20_21`), and `dead_hour_share_17_18` keeps the fixed hours 17–18 |
| chênh lệch · điểm % | difference, change · percentage points | `report.value.points` | a share or rate is compared in percentage points |
| tr · tỷ | million · billion | `money.million`, `money.billion` | compact money; English shows M and B |

### Data status

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| đã đối soát · chưa đối soát | reconciled · not reconciled | `badge.verified`, `badge.unverified` | every selected store-day matches the POS [control totals](#control-totals) (`sync_checks.is_matched`), or not |
| tạm tính | provisional | `reportCard.provisional` | an input is missing (costs, seats or customer identity), so the figure is incomplete |
| Số liệu đang cập nhật theo thay đổi cài đặt lúc … | The numbers are catching up with the settings change of … | `settings.catchUp.*` | the [catch-up](#catch-up) line of the thematic reports and Settings: past days are still being recalculated after a role, category or fee-rate change (payment kinds join in 10b) |
| đang cập nhật | updating | `report.marker.stale` | a recent day's item, payment or shift aggregates still lag its live totals (`store_coverage.stale_days`); on a thematic card, also while the range holds a day the [catch-up](#catch-up) has not redone yet |
| dữ liệu mẫu | sample data | `badge.sample` | demo numbers |
| chưa đồng bộ · cập nhật lúc | not synced yet · updated at | `badge.neverSynced`, `badge.updatedAt` | the freshness badge: the latest successful sync run |
| chưa có dữ liệu năm trước · cửa hàng mới | no data from last year yet · new store | `report.unavailable.store_too_young.*` | the store opened after the reference period started |
| chưa đo được · chưa thiết lập · đang tích lũy dữ liệu | not measured · not set up · still collecting data | `report.unavailable.*` | why a comparison, or a figure's cell such as So sánh's RevPASH without seats, has no value; never shown as 0 |

### Digests and alerts (phase 12)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| Bản tin ngày | daily digest | table `digests`; `fnb digest` | the short daily summary built from the Ngày report and sent to a chat or e-mail; in build (step 12b) |
| Cảnh báo vận hành | operational alert | tables `alert_events`, `alert_rule_catalog` | its own message about a problem that needs action soon, such as a refused POS login, a failed or stale sync, a failed job or a failing channel; business warnings such as low revenue are lines of the digest instead; in build (step 12b) |
| Cài đặt → Cảnh báo | Settings → Alerts | route `#/cai-dat/canh-bao` | the planned screen for destinations, alert rules and a test message; designed (after step 12c) |
| Mã liên kết | link code | `FNB-` plus 8 characters (`app.issue_link_code`) | the one-time code a member sends to the Zalo Bot to link their chat, valid 15 minutes; verified locally (step 12a) |
| Mã xác nhận | confirmation code | 6 digits; `app.confirm_email_link` | the code e-mailed to a member's login address to link it, valid 15 minutes; the member hands it back, and five wrong codes remove the pending destination; in build (step 12b) |
| ĐỒNG Ý | I agree | the reply a member sends | accepts a linked chat and records the member's consent to notifications |
| DỪNG | stop | the reply a member sends (also "DUNG", any case) | in a linked Zalo Bot chat: withdraws the member's consent to notifications, cancels their waiting messages, disables all their destinations (e-mail included) and confirms once; handled by `bot-webhook` once the bot is in webhook mode (#207, built) |
| Mã liên kết (in a Mini App) | binding code | 6 digits; `fnb zalo bind`, `app.zalo_binding_codes` | the code a member enters once in a Mini App, then "Liên kết", to bind their Zalo account; see [Binding code](#binding-code) (#205, built). Staff on the roster pair with a [pairing code](#pairing-code) instead (14a) |

### Staff and the staff app (phase 14a)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| Danh sách nhân viên | Staff roster | table `staff_roster`; `settings.staff.roster.*` | the people of a tenant who may use the staff app, each with a display name, a role (Nhân viên or Quản lý), stores and a status; kept on Cài đặt → Nhân viên by owners and managers within their stores (#211, #214, built) |
| Chờ ghép nối · Đang hoạt động · Đã ngừng | Waiting to pair · Active · Deactivated | `staff_roster.status` `invited`, `active`, `inactive` | a person added but not yet paired; paired, with a membership of the roster's role and stores; deactivated, with no membership, no Zalo identity in the tenant and no session left |
| Ghép nối · Đã ghép nối · Chưa ghép nối | Pairing · Paired · Not paired | `settings.staff.pairing.*` | linking a person's Zalo account to their row on the roster, once, with a [pairing code](#pairing-code) after they accept the staff notice. On the web page "paired" means an active row whose login still has a Zalo identity in the tenant, so a person who withdrew their staff consent reads "Chưa ghép nối" |
| Mã ghép nối · Tạo mã ghép nối | Pairing code · Create a pairing code | `issue_pairing_code`; `app.staff_pairing_codes` | the one-time six-digit code an owner or manager creates for one person on the roster and hands over; valid 10 minutes, shown once ([Pairing code](#pairing-code)) |
| Thông báo cho nhân viên · Đồng ý | Staff notice · I agree | `legal_documents` kind `staff_notice`; consent purpose `staff_ops` | the tenant's published Vietnamese notice on how staff data is used; accepting it records the person's `staff_ops` consent, which only they can give or withdraw (#212, built) |
| Doanh thu nhân viên được xem | What staff see of revenue | `tenants.staff_revenue_visibility`; `settings.staff.revenue.*` | the [staff revenue visibility](#staff-revenue-visibility): "Toàn bộ doanh thu của cửa hàng mình" (`all`, the default), "Chỉ tổng hôm nay" (`store_totals`) or "Không xem doanh thu" (`none`); set by an owner with every store |
| Ứng dụng nhân viên trên Zalo · In mã QR | Staff app on Zalo · Print the QR codes | `settings.staff.app.*` | the section of Cài đặt → Nhân viên with each store's QR code of the staff Mini App (`zalo.me/s/<Mini App id>/?store=<store code>`), drawn in the browser |
| Trang chủ | Home | staff app route `/`; `tab.home` | the staff app's first tab: the greeting and role, the store, today's figures as the role and the revenue level allow, today's opening hours and the freshness stamp (#217, built) |
| Cập nhật lúc · Chưa đồng bộ | Updated at · Not synced yet | `home.freshness.*` | the staff home's stamp of the tenant's latest successful sync |

### Shift operations (phase 14b)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| checklist mở ca · giữa ca · đóng ca | opening · mid-shift · closing checklist | `checklist_templates.shift_phase` `opening`, `midshift`, `closing`; `operations.phase.*` | the steps a store's staff tick off in the staff app; written on Cài đặt → Checklist for one store or every store. Each save is a new version that applies from the next run, and a run keeps the wording it was done with |
| Đang dùng · Đã ngừng dùng | In use · Taken out of use | `checklist_templates.active`; `settings.checklists.active`, `.retired` | a checklist the staff app offers, or one kept only for its past runs ("Dùng lại" puts it back) |
| Xong · Xong muộn · Đang làm · Chưa đến hạn · Bị bỏ | done · done late · in progress · not due yet · missed | `ComplianceStatus` `done`, `late`, `inProgress`, `due`, `missing`; `operations.compliance.*` | a checklist's status on a day, by the deadline from the store's opening hours ([metrics.md](metrics.md#checklist-status-rule)) |
| Tỷ lệ checklist xong · Checklist bị bỏ | checklists done · missed checklists | display series `checklist_compliance`, `checklists_missing` | done and done late ÷ every decided checklist; the missed ones |
| Số đếm két · Đếm trên ứng dụng · Két POS · Chênh lệch đếm | cash count · counted in the app · POS drawer · count difference | `cash_count_review`; `operations.column.*` | the cash a staff member counted at the close in the staff app, beside what the cashier typed on the POS and the expected cash; the difference is the count less the expected cash |
| Chưa đếm · Chưa khớp ca · Vượt ngưỡng · Trong ngưỡng · POS không có số dự kiến | no count · not matched to a shift · over a threshold · within the thresholds · no expected cash from the POS | `cash_count_review.state` `no_count`, `unmatched`, `over`, `within`, `no_reference` (and `recorded` for a reader not allowed the figures); `operations.cashState.*` | a shift's count state; a count waits "Chưa khớp ca" until its shift is synced |
| Ca đếm két vượt ngưỡng · Ca đã đóng chưa đếm két | cash counts over a threshold · closed shifts without a count | display series `cash_count_flags`, `shifts_without_count` | see [metrics.md](metrics.md#display-series) |
| Mở lại để đếm lại | Reopen for a recount | `operations.reopen.*` | an owner or manager of the store reopens a count so staff count that shift again; who and when are recorded |
| Sự cố · Hết hàng · Bàn giao ca | incident · stock-out · shift handover | `incidents.kind` `incident`, `stock_out`; `shift_handovers`; `operations.kind.*` | what staff report in the staff app, and the note one shift leaves the next |
| Chưa xem · Đã xem · Đã xử lý | not seen · seen · resolved | `operations.status.*`; display series `open_reports` | a report's state: an owner or manager of the store marks it seen or resolved, never the person who wrote it |
| Lời nhắn liên hệ trên ứng dụng nhân viên | Contact note in the staff app | `set_staff_contact_instructions`; `settings.staff.contact.*` | the owner's note telling staff whom to contact, on Cài đặt → Nhân viên: plain text and line breaks, at most 500 characters, no link; without one the app shows its default note; an owner with every store writes it |

### Loyalty (phases 16 to 18)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| Khách hàng thân thiết · chương trình | loyalty programme | table `loyalty_programmes`; `settings.loyalty.*` | a tenant's programme: name, period, reward budget, status and every value of the mechanic, read when each earn is written ([metrics.md](metrics.md#loyalty-counting)) |
| Bản nháp · Đang chạy · Tạm dừng · Đã kết thúc | draft · active · paused · ended | `loyalty_programmes.status` | only an active programme earns |
| Đang giữ chưa ra mắt · quyết định thông báo | launch hold · notification decision | `notification_decision` `pending`, `notified`, `below_threshold`, `not_required`; `settings.loyalty.hold.*`, `.decision.*` | while the decision on notifying the provincial Department of Industry and Trade is pending, the programme cannot become active; `not_required` needs its legal basis |
| thành viên · thẻ thành viên | member · member card | table `memberships` | a customer's membership of the programme; the phone stays on the customer row and no API role reads it |
| dấu | stamp | `loyalty_ledger.stamp_delta`; table `stamps`; `loyalty.column.stamps` | one per invoice that reaches the minimum bill; a full card (8 by default) is exchanged for a reward; each stamp has its own expiry |
| điểm | point | `loyalty_ledger.point_delta`; `loyalty.column.points` | earned per whole unit of the net amount (1 per 10,000 by default), worth the point value; expire first in first out |
| dấu chào mừng | welcome stamps | `welcome_stamps`; ledger `adjust` row with reason `welcome` | the stamps a new member gets once on joining (2 by default); none for a staff phone |
| sổ điểm | ledger | table `loyalty_ledger`; `loyalty.ledger.*` | the append-only rows of every stamp and point movement: Tích (`earn`), Xác nhận (`confirm`), Thu hồi (`clawback`), Đổi quà (`redeem`), Điều chỉnh (`adjust`), Hết hạn (`expire`); a correction is a new row |
| Đang chờ xác nhận · Đã xác nhận · Đã thu hồi (web) · Đã hoàn lại (customer app) | waiting for confirmation · confirmed · reversed | `loyalty.entryState.*`; customer app `wallet.state.*` | an entry or check-in still waiting for its synced invoice; confirmed by it; reversed by a clawback |
| cách khớp A · B · C · D | matched path A · B · C · D | `loyalty_ledger.matched_path`; `loyalty.path.*` | how an earn's invoice was tied to the member: A the phone on the invoice, B a check-in code staff recorded, C a receipt the member sent, D the reward code on the invoice |
| Ghi nhận khách | record a customer (check-in) | `staff_record_checkin`; table `pending_checkins`; staff app `checkin.*` | the staff app records a member at the till by phone or member code (path B); it waits "đang chờ xác nhận" until the synced invoice matches |
| Mã thành viên | member code | `customer_member_code`; QR `fnb-member:1:<store>:<code>` | the customer app's 6-digit code and QR for one store, refreshed every 60 seconds and valid 2 minutes |
| Nhận điểm từ hóa đơn | receipt claim | `customer_submit_claim`; table `receipt_claims` | a member sends the store, receipt number, net amount and date of a purchase (path C); matched to a synced invoice while the claim window lasts (72 hours by default), at most 3 a day by default |
| Hàng chờ đối soát · Hàng chờ thành viên | reconciliation queue · member queue | table `loyalty_queue`; `resolve_loyalty_queue_item`; `staff_loyalty_queue` | the cases a manager decides: a check-in or claim that fits two invoices equally, and in the staff app also disputes and adjustments above the tenant's limits |
| số điện thoại nhân viên | staff phones | table `loyalty_staff_phones`; refusal `excluded_phone` | the owner's exclusion list; with the phones of active roster staff, they never earn on any path |
| lý do từ chối | refusal reason | table `loyalty_refusals`; `loyalty.refusal.*` | why an invoice did not earn: below the minimum bill (points only), daily cap, staff phone, excluded order source, already earned, invoice not completed, programme or membership not active |
| ưu đãi · Danh mục ưu đãi | reward · reward catalogue | table `coupons`; `settings.rewards.*` | what a member exchanges stamps or points for: Tặng món, Giảm theo phần trăm, Giảm một số tiền, Lên size hoặc thêm topping (`reward_kind`), never cash; draft, approved, active or retired, approved by an owner with every store |
| Đổi quà · Ví voucher | redeem · voucher wallet | `customer_redeem`, `customer_vouchers` | the customer app's redemption and the list of the member's codes |
| giữ · Đang giữ · Đã dùng · Đã hoàn lại · Đã hủy | hold · held · used · given back · cancelled | `redemptions.state` `held`, `confirmed`, `released`, `cancelled`; `voucher.state.*` | a redemption holds its stamps or points under a single-use code (24 hours by default); a synced invoice carrying it makes it used, and an unused hold is released by the nightly step with the stamps and points given back |
| Kiểm tra ưu đãi | check a reward code | `staff_verify_redemption`; staff app `redeem.*` | the staff app checks a code at its store and answers with what to do on the POS, or why not (unknown, other store, used, expired, released) |
| kênh ưu đãi | rail | table `coupon_rails` `pos_payment_discount`, `crm_code_pool`, `crm_callback`; `settings.rewards.rails.*` | how a store's rewards reach the till: a POS payment discount entry by name (or a 0-price item), single-use codes from a CRM pool, or codes checked through the CRM; a reward can be active only where every store of its scope has a rail and a mapping (`coupon_rail_rewards`) |
| Chi phí ưu đãi thành viên | member reward cost | display series `reward_cost`; `redemption_summary` | the discount of the invoices that used a reward, on Khuyến mãi & giảm giá |
| Dừng nhận tin · Rời chương trình | stop messages · leave the programme | `customer_stop_marketing`, `customer_request_deletion` | the member withdraws the marketing consent, or asks for deletion; an owner with every store carries out the request with `dsr_delete` |

### Exports (phase 11a)

| Vietnamese | English | Code id | Meaning |
|---|---|---|---|
| Kèm thông tin cá nhân | Include personal data | `exports.form.personal` | the box that adds customer names and phone numbers, employee, cashier and shift names, voucher codes, line notes and payment references to one export; unticked every time, and offered only to an owner or a manager who sees every store |
| Ước tính | Estimate | `exports.form.estimate` | the transfer an export will cause, from the database's row counts, against the Free plan's 5 GB a month |
| Đã đối chiếu với cơ sở dữ liệu: … — khớp | Checked against the database: … — matched | `exports.result.verified` | a store-month whose files equal the database's counts, sums and fingerprints (`export_control_totals`) |
| Dữ liệu thay đổi trong lúc xuất | Data changed during the export | `exports.result.changed` | a sync wrote to that store-month while it was read; its files are kept but not verified, and a later export gives verified files |
| Tổng hợp ngày | Daily summary | `exports.table.daily_summary` | the file of each day's totals, for all chosen stores together and for each store, as the reports compute them |

## 4. Metric labels

The 55 metrics of the registry, with the labels the app shows ([`metrics.md`](metrics.md) holds the formulas). "Status" says whether the data exists: `needs costs` waits for item costs, `needs seats` for seat counts, and `needs customer identity` for the loyalty phases.

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
| Tỷ trọng giờ thấp điểm | Quiet-hour share | `dead_hour_share` | time | available now |
| Tỷ trọng giờ cao điểm | Peak-hour share (top hours) | `peak_share_top_hours` | time | available now |
| Mức nền cùng ngày trong tuần | Same-weekday baseline | `same_weekday_baseline` | baselines | available now |
| Dự báo theo đặc trưng ngày trong tuần | Weekday-profile forecast | `forecast_weekday_profile` | baselines | available now |
| Dự báo mùa vụ đơn giản | Seasonal-naïve forecast | `forecast_seasonal_naive` | baselines | available now |
| Sai số dự báo tuyệt đối trung bình | Forecast mean absolute error | `forecast_mae` | baselines | available now |
| Tốc độ bán món | Item velocity | `item_velocity` | menu | available now |
| Phân loại thực đơn | Menu class (Kasavana–Smith) | `menu_class` | menu | needs costs |
| Tỷ trọng doanh thu món có giá vốn | Costed share of item revenue | `cost_coverage` | menu | available now |
| Biên lợi nhuận gộp món | Item gross margin rate | `gross_margin_rate` | menu | needs costs |
| Chênh lệch tiền mặt | Cash variance | `cash_variance` | cash | available now |
| Điểm z chênh lệch tiền mặt | Cash variance z-score | `cash_variance_zscore` | cash | available now |
| Tỷ lệ hủy hóa đơn | Void rate | `void_rate` | cash | available now |
| Tỷ lệ sửa hóa đơn | Edit rate | `edit_rate` | cash | available now |
| Tỷ lệ dòng bị xóa | Removed-line rate | `removed_line_rate` | cash | available now |
| Sửa sau khi đóng ca | Edits after close | `edits_after_close` | cash | available now |
| Phí thanh toán ước tính | Estimated payment fees | `payment_fee_estimate` | cash | available now |
| Điểm z tỷ lệ xóa món | Removed-line rate z-score | `removed_line_rate_zscore` | cash | available now |
| Tỷ lệ hủy theo ca | Shift void rate | `shift_void_rate` | cash | available now |
| Điểm z tỷ lệ hủy theo ca | Shift void rate z-score | `shift_void_rate_zscore` | cash | available now |
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
| Số ngày giảm giá bán trong năm | Discount days in the year | `discount_days` | promotions | available now |
| Doanh thu gộp tăng thêm nhờ khuyến mãi | Promotion gross lift | `promo_lift` | promotions | available now |
| Lãi ròng từ khuyến mãi | Promotion net lift | `promo_net_lift` | promotions | available now |
| Tỷ lệ khách định danh có đồng ý tích điểm | Consent coverage of identified customers | `consent_coverage` | quality | needs customer identity |
| Tỷ trọng dòng tùy chọn | Modifier line share | `modifier_line_share` | quality | available now |

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
| Chỉ số ngày của cửa hàng | Store day index | `store_day_index` |
| Chênh lệch chỉ số giữa các cửa hàng | Gap between the stores' indices | `store_day_gap` |
| Khuyến mãi được dùng | Promotions used | `promotions_used` |
| Khuyến mãi giảm quá mức tối đa | Promotions over the maximum discount | `over_cap_promotions` |

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

### Hour profile

What `hour_profile` returns for a range: each hour's revenue and invoices in total and per day, its share, and its level, from the first to the last hour with sales counted from the business-day start. Over all days the levels are "cao điểm" (peak: the top hours, 3 by default) and "thấp điểm" (dead: below half the average hour); per day group they are "đông" (busy) and "vắng" (quiet). The thresholds come from Ngưỡng báo cáo. Giờ & ngày reads it, and the registry ids `peak_share_top_hours` and `dead_hour_share` take their values from it.

### Items per ticket

Items sold ÷ invoices, counting lines of kind `item` only. Vietnamese: số món mỗi hóa đơn. Metric `items_per_ticket`.

### Like-for-like

A comparison over the same stores on both sides. A store counts for a reference period when its history starts on or before that period's first day; when only some stores count, the report compares those stores only and says so: "cùng cửa hàng (k/N)" ([`metrics.md`](metrics.md#coverage-and-like-for-like)).

### Menu engineering

The Kasavana–Smith matrix: each item of a role is popular or not (its share of the role's quantity against 0.7 ÷ the number of items) and high or low margin (its contribution margin, or its price while costs are missing, against the role's quantity-weighted mean). Classes: star (popular, high), plowhorse (popular, low), puzzle (not popular, high), dog. Phase 8's function `menu_matrix` holds the metric `menu_class`; Thực đơn (built, phase 10a) reads `menu_engineering`, which applies the tenant's window, popularity factor and low-sample rule from Ngưỡng báo cáo and costs each day with the cost in force on that day.

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

### Access-token hook

A Postgres function that Supabase Auth calls every time it issues an access token, to add claims of its own. Here it is `app.custom_access_token_claims` (#205), registered under `[auth.hook.custom_access_token]` in `supabase/config.toml` and executable by Supabase Auth's role only: it adds `memberships`, one `{tenant_id, role, store_ids}` per tenant of the login (`store_ids` null for every store), to the web app's tokens and the Mini Apps' alike. Row-level security does not trust the claim and keeps reading `tenant_members`. The local stack loads it at its next start; the cloud project registers it at go-live (#210) ([`api.md`](api.md#2-authentication-and-roles)).

### Aggregate refresh

`app.refresh_analytics(tenant, from, to)` rebuilds the `agg_*` tables of a tenant for a date range from the sales rows; the sync jobs call it, and an owner or manager may call `refresh_my_analytics`. Days from yesterday on are read live, so a report never waits for a refresh ([`schema.md`](schema.md#hot-and-cold-rule)).

### Alert episode

One open row in `alert_events` per rule and subject (a dedupe key such as the store or the account), however often the problem recurs: it counts the occurrences, keeps the cool-down in `last_notified_at`, sends reminders at the rule's `remind_every`, and records how and when it was resolved. Its facts are counts only. The rules and their defaults are in `alert_rule_catalog`. In build (step 12b).

### As-of day

The last complete business day of the selected stores: the earliest store-local business date of now, minus one. Reports end there; Hôm nay owns the running day.

### Binding code

The one-time, six-digit code that ties a member's Zalo account to their existing login for one brand's Mini Apps (#205). `fnb zalo bind --tenant <slug> --member <login e-mail> --brand <key>` prints it; the member enters it once in the Mini App, and from then on `zalo-session` signs that Zalo account in as the member. It is valid 10 minutes and stored only as a hash; a wrong code counts against every live code of the brand's Zalo App, and the sixth wrong attempt burns them. A publisher login cannot be bound. Since 14a, people on the staff roster pair with a [pairing code](#pairing-code) that an owner or manager creates on the web instead; binding codes stay for members outside the roster, such as an owner, and for `pnpm zalo:dev`, whose first run binds its mock user with one. Not to be confused with the Zalo Bot's link code (`FNB-…`), which links a chat for notifications ([`security.md`](security.md), section 4.3).

### Capability

A feature a [connector](#connector) declares, such as `shifts` or `controlTotals`; the sync uses only what is declared ([`connectors.md`](connectors.md)).

### Catch-up

The recalculation of past days after a mapping change. Labels such as an item's role follow a change at once, but numbers the refresh derived from it (attach rates, category and payment aggregates, fee estimates) follow only once those days are refreshed again. Every write to a role, a category override or a fee rate marks the tenant's whole history pending (payment-kind overrides join in 10b); `analytics_catch_up_status` reports what is left, and the app refreshes it 92 days at a time, newest first, while the thematic reports and Settings show the catch-up line (ADR-036).

### Conformance suite

The shared tests every connector must pass (`@fnb/connector-core/conformance`); the mock and iPOS Fabi connectors pass it.

### Connector

The adapter between one POS vendor and the canonical model (`PosConnector`). Today `ipos-fabi` and `mock`.

### CSV format

The two ways a table downloads: comma-separated with decimal points (the default), or semicolon-separated with decimal commas for an Excel set to Vietnamese. Both are UTF-8 with a byte-order mark; each phone or computer keeps its own choice ("Thiết bị này" on Ngưỡng báo cáo).

### Data pack

The versioned, aggregate-only JSON file that the owner gives to their own assistant to draft a store plan (ADR-003): store profile, weekly and monthly totals, heatmap, items, mixes and other figures from the metric registry, with the strategy prompt; no row-level or personal data. Buttons "Tải gói dữ liệu cho AI" and "Sao chép gói + prompt", and `fnb datapack`. One canonical text per pack, identified by its `pack_id`, a SHA-256 of that text without its timestamp, so the same data always gives the same pack ([strategy.md](strategy.md)). The browser reads `pack_fence`, a hash of what moves the pack's numbers, before and after its report calls and builds again when it moved; `fnb datapack` reads inside one read-only snapshot as a member and needs no fence. "Sao chép gói + prompt" copies the chat bundle: the prompt, then the pack in one fence. The format, the content, strategy prompt 1.0.0, the buttons and the command are built (phase 11a, #130, #131, #134, #137, #142).

### Data roles

`owner`, `manager`, `staff` and `viewer`: the tenant roles that read sales. `publisher` is outside them ([`api.md`](api.md#tenant-roles)). What `staff` read of revenue follows the tenant's [staff revenue visibility](#staff-revenue-visibility) (every revenue row of their stores by default).

### Dead-man's switch

The check that a store is still being synced: when a watched store passes 90 minutes of opening time without a successful sync (`app.sync_gap_minutes`), the `sync_stale` alert is raised. Every incremental run and every scheduler tick checks it, and the nightly run checks the previous day ([`sync.md`](sync.md#notifier-and-dead-mans-switch)). Verified locally (phase 7).

### Demo mode

The web app built without `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY`: no login, two sample stores (`MOCK-S1`, `MOCK-S2`) generated in the browser from a fixed seed, reports run by the TypeScript port of the SQL, and a banner: "Bản demo: đây là số liệu mẫu, không phải của một cửa hàng thật." A configured build offers it on the login page ("Xem bản demo").

### Digest

The daily summary message for a member: the Ngày report built as that member and reduced to a few cards. It is built once every store has settled the day, and at the latest at the deadline (06:30 local time by default), then queued in the outbox. Vietnamese: bản tin ngày. In build (step 12b).

### Edge Function

A small Deno program that Supabase hosts and runs on request. `sync-incremental` (`supabase/functions/sync-incremental`) is built and verified locally; `notify` is planned for step 12c; the four Zalo functions of phase 13, `zalo-session` and `zalo-phone` (#205) and `oa-webhook` and `bot-webhook` (#207), are built against a mock of Zalo, enabled in `supabase/config.toml` and not deployed, and share the CORS, error and logging helpers of `supabase/functions/_shared` ([`api.md`](api.md#5-edge-function-endpoints)).

### Fixture tenant

A tenant that a test builds for itself, so its counts never depend on the real tenant or the seed. Notification tests use slugs that start with `notify-it-` and synthetic `_IT` secret names, and the Zalo tests slugs that start with `zalo-it-` (the pgTAP files `zalo-it-pgtap-…`; with `ZALO_INTEGRATION=1` the Zalo functions serve no other tenant); pgTAP files run in a rolled-back transaction, and integration runs delete fixture tenants older than an hour.

### Hot and cold rule

Business days before yesterday are read from the aggregate tables; yesterday and today are computed live from the sales rows, so today is right after every sync.

### i18n key

The name of a user-facing text, such as `nav.today`; every key exists in Vietnamese and English (`apps/web/src/i18n/messages/<area>.vi.json` and `.en.json`).

### Mini App

A web app that runs inside the Zalo phone app on zmp-sdk and zmp-ui, served from `https://h5.zdn.vn`, without LocalStorage or cookies. Phase 13 built two scaffolds, the staff app (`apps/zalo-staff`, hidden from search) and the customer app (`apps/zalo-customer`, listed), each built per brand from its `app-config.json`; until the owner's Zalo accounts exist they run in a browser with a mocked Zalo SDK ([development.md](development.md), section 6), and the staff app also runs with `pnpm zalo:dev` against the real `zalo-session` on the local stack, signed in as a [mock](#mock-id) Zalo user. Since 14a the staff app's Trang chủ shows the home of #217.

### Mock id

An id that starts with `mock-`, used where a real Zalo id will go before the owner's Zalo accounts exist: the brand's Zalo App, OA and Mini App ids stored with `fnb zalo config set`, and the Zalo user ids of the mock Zalo Graph (`--mock-user mock-…`, default `mock-user-1`; 1 to 59 letters, digits, `_` or `-` after the prefix). `pnpm zalo:dev` serves only a brand whose Zalo App id is a mock id, and `pnpm zalo:dev forget` removes a brand's Zalo rows and identities only when every one of them is a mock id, so the real ids can be stored afterwards ([development.md](development.md), [operations.md](operations.md)).

### Outbox

`outbound_messages`: the queue of every digest and alert message and its one-year log. Every send decision (consent, allowed hours, limits) is taken in SQL when a dispatcher claims a message. Verified locally (step 12a).

### Pairing code

Vietnamese: mã ghép nối. The one-time, six-digit code that pairs a person on the staff roster with their Zalo account in the staff app (#213). An owner or manager whose stores cover the person creates it on Cài đặt → Nhân viên ("Tạo mã ghép nối", `issue_pairing_code`); it is shown once, valid 10 minutes, one per person, works in every brand's staff app of the tenant and is stored only as a hash with the tenant. The person enters it after accepting the staff notice; `zalo-session` then links the Zalo identity, gives the person a login if they have none (an address on the reserved `.invalid` domain, no password), creates their membership from the roster's role and stores and marks the row active. A wrong, used, expired or deactivated code gets the same answer; five wrong codes within 15 minutes make that Zalo account wait 15 minutes, and the sixth wrong code in the tenant burns its live codes. A code never pairs a login that is already an owner, viewer or publisher. Built and tested locally; the staff app's screen that takes the code is #215, in progress. Compare [binding code](#binding-code).

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

### Plan lint

`lintPlan` in `@fnb/datapack`: the check that a plan written by the owner's assistant has the `fnb-plan/1` front matter, the ten sections, five to seven initiatives with their seven fields and a number from the pack cited in each initiative, all against the exact pack it was written from, named by its `pack_id`. Each problem is a code with a level, such as `section_missing:7` or `kpi_unknown:net_sales`; only a plan without errors is to be stored, while warnings are shown. The paste box "Dán kế hoạch" and `fnb publish-plan --check` run the same lint ([strategy.md](strategy.md)). Built (phase 11a, #135; the paste box and the check, #143 and #138); publishing a plan comes in 11b.

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

### Staff revenue visibility

`tenants.staff_revenue_visibility`, "Doanh thu nhân viên được xem" on Cài đặt → Nhân viên: what members with the role `staff` may read of revenue (FR-STF-13). `all`, the default chosen by the owner: every revenue row of their stores, as a manager of those stores reads them; `store_totals`: only today's net revenue and invoice count of their stores, through `today_store_totals`; `none`: no revenue row, report or figure at all. Owners, managers and viewers are not affected. Only an owner with every store sets it (`set_staff_revenue_visibility`). The staff app's home follows it, and makes no revenue call at `none` (#211, #214, #217, built).

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

## Phase 11 terms

**Pack id.** The sha256 of a data pack's canonical text without `pack_id` and `generated_at`; equal ids mean equal packs ([strategy.md](strategy.md), section 2.5). Kế hoạch shows "Mã gói khớp" when the stored pack still hashes to its id.

**Citation.** `[[table:row:column]]` in a plan: a reference to one cell of the pack, checked against the number written before it and shown in Kế hoạch as a chip with the cell's value.

**Trackable KPI.** One of the 18 metric ids that `metric_value` computes, that are current and that KPI follow-up can measure over 28-day windows (`app.trackable_metric_ids()`, `trackableMetricIds()`).

**Normal range.** A KPI's band `lo` to `hi` from the pack's recent 28-day windows; a current value inside it is "trong dao động thường".

**Publisher.** The `publisher` member of ADR-013: publishes plans through `publish_strategy_plan` and reads no plan, pack or sale.
