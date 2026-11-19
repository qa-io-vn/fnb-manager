# Câu văn chủ đề và cài đặt — bảng duyệt câu chữ

Owner review of the wording of the four thematic reports of phase 10a (Doanh thu & xu hướng, Giờ & ngày trong tuần, Thực đơn, Thanh toán & tiền mặt), of Khuyến mãi & giảm giá, Ca & két tiền, So sánh cửa hàng and Chất lượng dữ liệu of phase 10b and of the 10a Settings pages (the shared layout and form controls, Ngưỡng báo cáo with its 10b promotion field, Phân loại and the catch-up banner), with the two 10b tabs of Phân loại (Nhóm của món and Loại thanh toán) and the placeholders of the phase 12 pages Cảnh báo and Bản tin. It lists every Vietnamese template these pages use (947 entries, 303 of them with placeholders), with its English meaning and the placeholders it fills in. It holds templates only: no store, item or person names and no figures. The periodic reports Ngày, Tuần, Tháng and Năm have their own sheet, [cau-van-bao-cao.md](cau-van-bao-cao.md), which also holds the shared `report.*` keys the thematic cards reuse (comparison chips, markers, value formats, payment kinds, roles and the Settings links of `report.action.*`).

The source of truth is the message files in `apps/web/src/i18n/messages/`: `themes`, `theme-revenue`, `theme-hours`, `theme-menu`, `theme-payments`, `theme-promotions`, `theme-shifts`, `theme-stores`, `theme-quality`, `settings`, `settings-thresholds` and `settings-mapping` (`.vi.json` and `.en.json`). This sheet is a copy of them for reading; when a file changes, the file wins, and a unit test (`apps/web/src/i18n/wording-sheets.test.ts`) fails until the sheet lists every key of those files with its exact Vietnamese and English text. Metric names and explanations live in `metrics.vi.json` and are reviewed with the metric registry.

## How to review

- Each row is one message key. "Tiếng Việt" is exactly what the pages show; "English" is the English interface text, which is also the meaning the Vietnamese must carry.
- Words in braces, such as `{range}` or `{share}`, are placeholders filled in when the card is built. Keep each placeholder of a row when rewording it; it may move within the sentence.
- Mark only the rows you want changed and write the wording you want. The key column tells a builder which entry to change.
- The spelling rule of the report sheet applies here too: "hóa đơn", "hủy", "tùy", with the tone mark on the first vowel of "oa" and "uy"; a test fails when a message file breaks it.

## How a thematic card's text is built

The thematic cards are built like the periodic ones (see the report sheet): a headline with its caption, comparison chips, a sentence of at most three parts (a main clause, a note, a driver), notices with a Settings link where one helps, and tables whose column names come from each theme's `.table.*` keys. What differs:

- **Ranges instead of periods.** A card speaks of the chosen range (`{range}`, its first and last day) and compares it with the range of equal length just before ("so với {weeks} tuần trước", `theme.compare.previousWeeks`) and with the same weekdays a year earlier (`theme.compare.lastYear`); calendar presets reuse the period labels of the report sheet.
- **Heat tables.** Giờ & ngày shows hours down and weekdays across, headed "T2" to "CN" (`theme.weekday.short.*`), with an average column kept outside the five shades; the legend is `theme.heat.legend`.
- **Updating.** While the numbers catch up with a settings change (a mapping or a fee rate), every theme and settings page shows the catch-up line (`settings.catchUp.*`), and a card whose range holds a pending day carries "đang cập nhật" (`report.marker.stale` of the report sheet).
- **Settings pages.** Every threshold explains itself in a hint and shows its default (`settings.thresholds.default`); a value outside its limits is refused with a message of `settings.validation.*`; a save bar counts the unsaved changes; and a page a member may not change says why (`settings.readOnly.*`).

## Placeholders

Every placeholder of this sheet, how many templates use it and the first key in this sheet that does; the English column of that key shows what it holds.

| Placeholder | Templates | First key |
| --- | --- | --- |
| `{a}` | 2 | `theme.menu.pairs.caption` |
| `{abs}` | 1 | `theme.payments.drawer.thresholds` |
| `{amount}` | 5 | `theme.promotions.discountCost.largest` |
| `{article}` | 1 | `theme.promotions.rules.basisOne` |
| `{articles}` | 1 | `theme.promotions.rules.basisMany` |
| `{b}` | 2 | `theme.menu.pairs.caption` |
| `{basis}` | 6 | `theme.promotions.catalogue.luckyDraw` |
| `{best}` | 3 | `theme.hours.heatmap.main` |
| `{bestCount}` | 1 | `theme.shifts.sales.main` |
| `{bestDay}` | 1 | `theme.hours.heatmap.main` |
| `{bestHour}` | 1 | `theme.hours.heatmap.main` |
| `{bestValue}` | 2 | `theme.hours.weekday.main` |
| `{bucket}` | 7 | `theme.payments.trend.down` |
| `{cap}` | 7 | `theme.promotions.ruleCap.caption` |
| `{cashier}` | 2 | `theme.shifts.adjustments.main` |
| `{category}` | 2 | `theme.menu.categoryMix.caption` |
| `{checked}` | 5 | `theme.promotions.catalogue.luckyDraw` |
| `{cost}` | 3 | `theme.promotions.lift.caption` |
| `{count}` | 41 | `theme.menu.preferences.otherOnly` |
| `{coverage}` | 2 | `theme.quality.costs.coverage` |
| `{covered}` | 2 | `theme.menu.movers.captionLikeForLike` |
| `{customers}` | 1 | `theme.quality.customers.coverage` |
| `{date}` | 13 | `theme.page.todayClamped` |
| `{dates}` | 7 | `theme.promotions.ruleCap.freeInvoices` |
| `{day}` | 5 | `settings.hours.addSpanTo` |
| `{days}` | 29 | `theme.range.summary` |
| `{dead}` | 1 | `theme.hours.peakDead.main` |
| `{deadShare}` | 1 | `theme.hours.peakDead.main` |
| `{definition}` | 1 | `theme.promotions.lift.subtitle` |
| `{delta}` | 18 | `theme.revenue.net.down` |
| `{digits}` | 1 | `settings.validation.decimals` |
| `{drinks}` | 2 | `theme.menu.matrix.stars` |
| `{factor}` | 1 | `theme.menu.matrix.subtitle` |
| `{faller}` | 2 | `theme.menu.movers.fallersOnly` |
| `{fallerChange}` | 2 | `theme.menu.movers.fallersOnly` |
| `{fee}` | 1 | `theme.payments.fees.costliest` |
| `{first}` | 6 | `theme.payments.trend.down` |
| `{flagged}` | 2 | `theme.shifts.cashiers.main` |
| `{freeDates}` | 1 | `theme.promotions.ruleCap.giftsAndFree` |
| `{from}` | 5 | `theme.range.span` |
| `{gap}` | 3 | `theme.hours.weekday.main` |
| `{giftDates}` | 1 | `theme.promotions.ruleCap.giftsAndFree` |
| `{gross}` | 3 | `theme.promotions.lift.caption` |
| `{group}` | 1 | `theme.hours.shiftWindows.mainOne` |
| `{high}` | 3 | `theme.stores.kpis.items` |
| `{highIndex}` | 1 | `theme.stores.sameDay.main` |
| `{hour}` | 1 | `theme.hours.heatmap.caption` |
| `{hours}` | 1 | `theme.hours.peakDead.window` |
| `{ice}` | 2 | `theme.menu.preferences.iceOnly` |
| `{iceShare}` | 2 | `theme.menu.preferences.iceOnly` |
| `{instrument}` | 2 | `theme.promotions.rules.basisMany` |
| `{invoices}` | 4 | `theme.menu.pairs.main` |
| `{item}` | 7 | `theme.menu.movers.caption` |
| `{items}` | 3 | `theme.menu.margins.rate` |
| `{keyword}` | 2 | `theme.promotions.catalogue.luckyDrawMatch` |
| `{kind}` | 4 | `theme.promotions.discountCost.largestUnnamed` |
| `{last}` | 1 | `theme.promotions.rules.basisMany` |
| `{level}` | 1 | `theme.menu.preferences.caption` |
| `{lift}` | 1 | `theme.menu.pairs.main` |
| `{limit}` | 4 | `theme.promotions.ruleDays.limit` |
| `{low}` | 3 | `theme.stores.kpis.items` |
| `{lowIndex}` | 1 | `theme.stores.sameDay.main` |
| `{matches}` | 1 | `theme.promotions.catalogue.luckyDraw` |
| `{max}` | 4 | `settings.validation.atMost` |
| `{measured}` | 1 | `theme.shifts.adjustments.none` |
| `{method}` | 1 | `theme.payments.fees.costliest` |
| `{min}` | 3 | `settings.validation.atLeast` |
| `{minimum}` | 5 | `theme.menu.matrix.lowSample` |
| `{month}` | 4 | `theme.revenue.byMonth.caption` |
| `{n}` | 3 | `settings.hours.close` |
| `{name}` | 2 | `theme.promotions.lift.option` |
| `{net}` | 2 | `theme.promotions.lift.gain` |
| `{notChecked}` | 1 | `theme.quality.verification.main` |
| `{notMatched}` | 1 | `theme.quality.verification.main` |
| `{number}` | 2 | `theme.promotions.rules.instrument.circular` |
| `{other}` | 1 | `theme.stores.sinceOpening.main` |
| `{others}` | 1 | `theme.promotions.catalogue.luckyDrawMore` |
| `{page}` | 1 | `settings.placeholder.body` |
| `{payment}` | 1 | `theme.payments.mix.otherMover` |
| `{peak}` | 2 | `theme.hours.peakDead.main` |
| `{peakShare}` | 2 | `theme.hours.peakDead.main` |
| `{phase}` | 1 | `settings.placeholder.body` |
| `{points}` | 12 | `theme.revenue.trend.caption` |
| `{pos}` | 1 | `settings.mapping.kinds.state` |
| `{promotion}` | 7 | `theme.promotions.discountCost.largest` |
| `{quantity}` | 1 | `theme.menu.movers.newItem` |
| `{quiet}` | 1 | `theme.hours.heatmap.main` |
| `{quietDay}` | 1 | `theme.hours.heatmap.main` |
| `{quietHour}` | 1 | `theme.hours.heatmap.main` |
| `{range}` | 104 | `theme.print.summary` |
| `{rate}` | 8 | `theme.menu.margins.rate` |
| `{reasons}` | 1 | `theme.shifts.adjustments.main` |
| `{reference}` | 26 | `theme.range.summary` |
| `{rel}` | 1 | `theme.payments.drawer.thresholds` |
| `{report}` | 1 | `theme.print.summary` |
| `{rest}` | 1 | `theme.promotions.rules.basisList` |
| `{riser}` | 2 | `theme.menu.movers.main` |
| `{riserChange}` | 2 | `theme.menu.movers.main` |
| `{role}` | 2 | `settings.audit.byRole` |
| `{rows}` | 2 | `theme.promotions.ruleCap.gifts` |
| `{seats}` | 1 | `theme.hours.productivity.revpash` |
| `{share}` | 14 | `theme.revenue.storeShare.main` |
| `{shift}` | 3 | `theme.payments.drawer.shiftOn` |
| `{shifts}` | 1 | `theme.shifts.cashiers.main` |
| `{shown}` | 1 | `settings.mapping.categories.search.more` |
| `{size}` | 1 | `settings.mapping.categories.withSize` |
| `{stars}` | 2 | `theme.menu.matrix.stars` |
| `{store}` | 10 | `theme.revenue.storeShare.caption` |
| `{stores}` | 2 | `theme.print.summary` |
| `{sugar}` | 2 | `theme.menu.preferences.main` |
| `{sugarShare}` | 2 | `theme.menu.preferences.main` |
| `{time}` | 2 | `settings.audit.when` |
| `{to}` | 5 | `theme.range.span` |
| `{total}` | 3 | `theme.menu.movers.captionLikeForLike` |
| `{type}` | 3 | `settings.mapping.categories.onPos` |
| `{value}` | 53 | `theme.revenue.net.down` |
| `{voucher}` | 1 | `theme.promotions.vouchers.top` |
| `{week}` | 4 | `theme.stores.sinceOpening.caption` |
| `{weekday}` | 3 | `theme.hours.heatmap.caption` |
| `{weekdays}` | 1 | `theme.hours.shiftWindows.main` |
| `{weekend}` | 1 | `theme.hours.shiftWindows.main` |
| `{weeks}` | 5 | `theme.compare.previousWeeks` |
| `{when}` | 3 | `settings.audit.at` |
| `{window}` | 1 | `theme.hours.shiftWindows.mainOne` |
| `{worst}` | 2 | `theme.hours.weekday.main` |
| `{worstCount}` | 1 | `theme.shifts.sales.main` |
| `{worstValue}` | 1 | `theme.shifts.sales.main` |
| `{year}` | 4 | `theme.promotions.ruleDays.caption` |
| `{z}` | 1 | `theme.payments.drawer.thresholds` |

## Points the review may settle

- "Gợi ý khung ca" for the suggested shift windows, with the reminder that they rest on invoices per hour, not on staff productivity (`theme.hours.shiftWindows.basis`).
- The five hour levels "cao điểm", "thấp điểm", "đông", "vắng" and "bình thường" (`theme.hours.level.*`), which the thresholds of Ngưỡng báo cáo decide.
- "tạm tính" in the menu matrix while costs are missing (`theme.menu.matrix.provisionalCell`).
- "Thiết bị này" for the per-device CSV format, and the wording of its two choices (`settings.thresholds.device.*`).
- "đáng xem lại" for the shifts Ca & két tiền flags, and the caution that a z-score compares a shift with earlier shifts and is no verdict on a person (`theme.shifts.adjustments.main`, `theme.shifts.adjustments.basis`).
- The lift words "lãi ròng" and "lỗ ròng" for the net lift, "doanh thu gộp tăng thêm" for the gross lift, and "đối chứng" for what each comparator compares with (`theme.promotions.lift.*`); the headline always comes with the gross lift and the discount cost in its caption.
- So sánh cửa hàng: the store-day index read as "bằng … lần mức trung bình của mình" (`theme.stores.sameDay.main`), the like-for-like all-stores row "Tất cả cửa hàng (so với kỳ trước: cùng cửa hàng)" (`theme.stores.kpis.allStoresLikeForLike`), and the sentence that skips the Tết weeks (`theme.stores.sinceOpening.tetSkipped`).
- How the card "Theo thu ngân" speaks of people: it names a cashier only when one named cashier alone has the most shifts over the drawer thresholds, never the "chưa rõ thu ngân" row, always adds that figures per cashier are a prompt to look again and no conclusion about a person, asks for individual POS logins when a store's shifts all carry one login, and asks for display names when the logins differ but none has one (`theme.shifts.cashiers.main`, `.tied`, `.unnamed`, `.caution`, `.single`, `.singlePerStore`, `.logins`, `.unnamedAll`, `.displayNames`).
- On Chất lượng dữ liệu, the "Sửa trong POS: …" hints (`theme.quality.fix.pos.*`), the legal line of the e-invoice notice (`theme.quality.compliance.eInvoiceNotice`), "Chưa rõ" for an e-invoice status not yet recorded (the word Cài đặt → Cửa hàng uses), and "danh sách khách hàng" for the customers an invoice is linked to, as against an invoice that only carries a phone number (`theme.quality.customers.*`).
- The legal wording of the rule cards of Khuyến mãi: "được cho là đã bãi bỏ … còn đang được kiểm tra" for the reported repeal of the 120-day limit by Nghị định 239/2026/NĐ-CP, "chỉ để theo dõi" for the count after it, "món tặng" and "hóa đơn miễn phí" for full discounts and "Voucher được ghi riêng" for vouchers, all kept apart from the cap, "chương trình khuyến mại tập trung do cơ quan nhà nước tổ chức" for the 100 % exception, "chương trình may rủi" for lucky draws with the reported change of procedure by Nghị định 239/2026/NĐ-CP, and the closing "Đối chiếu với quy định đến ngày {checked}; không thay cho tư vấn pháp lý." (`theme.promotions.ruleDays.*`, `theme.promotions.ruleCap.*`, `theme.promotions.catalogue.luckyDraw`). The final wording of the repeal sentence follows the legal read (#50).

## Dùng chung cho các chủ đề · Shared by the thematic reports (`themes.vi.json`, 39 mục)

### Thẻ chọn chủ đề · theme tabs (`theme.tabs.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.tabs.label` | Báo cáo theo chủ đề | Thematic reports | — |

### Thanh chọn khoảng ngày · range picker (`theme.range.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.range.from` | Từ ngày | From | — |
| `theme.range.label` | Khoảng ngày | Date range | — |
| `theme.range.nextStep` | Khoảng sau | Next range | — |
| `theme.range.preset.28d` | 4 tuần | 4 weeks | — |
| `theme.range.preset.364d` | 52 tuần | 52 weeks | — |
| `theme.range.preset.7d` | 7 ngày | 7 days | — |
| `theme.range.preset.91d` | 13 tuần | 13 weeks | — |
| `theme.range.preset.last_month` | Tháng trước | Last month | — |
| `theme.range.preset.this_month` | Tháng này | This month | — |
| `theme.range.preset.this_year` | Năm nay | This year | — |
| `theme.range.previousStep` | Khoảng trước | Previous range | — |
| `theme.range.span` | {from} – {to} | {from} – {to} | `{from}` `{to}` |
| `theme.range.summary` | {from} – {to} · {days} ngày · {reference} | {from} – {to} · {days} days · {reference} | `{from}` `{to}` `{days}` `{reference}` |
| `theme.range.to` | Đến ngày | To | — |

### Nhãn so sánh (chip) · comparison chips (`theme.compare.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.compare.lastYear` | so với cùng kỳ năm trước | vs the same weeks last year | — |
| `theme.compare.previousDays` | so với {days} ngày trước | vs the previous {days} days | `{days}` |
| `theme.compare.previousWeeks` | so với {weeks} tuần trước | vs the previous {weeks} weeks | `{weeks}` |

### Phụ đề thẻ · card subtitles (`theme.subtitle.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.subtitle.lastDays` | {days} ngày cuối kỳ | Last {days} days of the range | `{days}` |

### Thông báo đầu trang · page notices (`theme.page.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.page.invalidRange` | Khoảng ngày trong đường dẫn không hợp lệ nên đang hiện khoảng mặc định. | The dates in the link are not valid, so the default range is shown. | — |
| `theme.page.noStores` | Chọn ít nhất một cửa hàng để xem báo cáo. | Choose at least one store to see the report. | — |
| `theme.page.rangeClamped` | Chủ đề này xem tối đa {days} ngày nên chỉ hiện {days} ngày cuối. | This report covers at most {days} days, so it shows the last {days}. | `{days}` |
| `theme.page.todayClamped` | Ngày cuối được đổi thành {date}, ngày đã kết thúc gần nhất. | The end date was moved to {date}, the last day that has ended. | `{date}` |

### Dòng tóm tắt khi in · printed summary line (`theme.print.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.print.summary` | {report} · {range} · {stores} · đến hết ngày {date} | {report} · {range} · {stores} · through {date} | `{report}` `{range}` `{stores}` `{date}` |

### Bảng nhiệt · heat tables (`theme.heat.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.heat.legend` | Màu đậm hơn: cao hơn, chia 5 mức | Darker means higher, in 5 levels | — |

### Thứ trong tuần · weekdays (`theme.weekday.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.weekday.long.1` | Thứ Hai | Monday | — |
| `theme.weekday.long.2` | Thứ Ba | Tuesday | — |
| `theme.weekday.long.3` | Thứ Tư | Wednesday | — |
| `theme.weekday.long.4` | Thứ Năm | Thursday | — |
| `theme.weekday.long.5` | Thứ Sáu | Friday | — |
| `theme.weekday.long.6` | Thứ Bảy | Saturday | — |
| `theme.weekday.long.7` | Chủ Nhật | Sunday | — |
| `theme.weekday.short.1` | T2 | Mon | — |
| `theme.weekday.short.2` | T3 | Tue | — |
| `theme.weekday.short.3` | T4 | Wed | — |
| `theme.weekday.short.4` | T5 | Thu | — |
| `theme.weekday.short.5` | T6 | Fri | — |
| `theme.weekday.short.6` | T7 | Sat | — |
| `theme.weekday.short.7` | CN | Sun | — |

## Doanh thu & xu hướng · Revenue and trend (`theme-revenue.vi.json`, 73 mục)

### Tiêu đề · title (`theme.revenue.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.title` | Doanh thu & xu hướng | Revenue and trend | — |

### Thẻ «Doanh thu thuần» (`theme.revenue.net.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.net.chart` | Doanh thu thuần theo cửa hàng, kỳ này và kỳ trước | Net revenue by store, this range and the previous one | — |
| `theme.revenue.net.down` | Doanh thu thuần {range} là {value}, thấp hơn {delta} {reference}. | Net revenue for {range} was {value}, down {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.revenue.net.flat` | Doanh thu thuần {range} là {value}, gần như không đổi {reference}. | Net revenue for {range} was {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.revenue.net.noData` | Chưa có số liệu bán hàng trong {range}. | No sales were recorded in {range}. | `{range}` |
| `theme.revenue.net.noReference` | Doanh thu thuần {range} là {value}; chưa có kỳ trước để so sánh. | Net revenue for {range} was {value}; there is no earlier range to compare with. | `{range}` `{value}` |
| `theme.revenue.net.periodTable` | Doanh thu thuần theo kỳ | Net revenue by range | — |
| `theme.revenue.net.storeTable` | Doanh thu thuần theo cửa hàng | Net revenue by store | — |
| `theme.revenue.net.title` | Doanh thu thuần | Net revenue | — |
| `theme.revenue.net.up` | Doanh thu thuần {range} là {value}, cao hơn {delta} {reference}. | Net revenue for {range} was {value}, up {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Thẻ «Xu hướng doanh thu» (`theme.revenue.trend.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.trend.caption` | Trung bình mỗi ngày có bán · đường trung bình {points} điểm | Mean per day with sales · {points}-point moving average | `{points}` |
| `theme.revenue.trend.chart` | Doanh thu và trung bình trượt | Revenue and moving average | — |
| `theme.revenue.trend.falling` | Trung bình trượt {range} giảm {delta}, từ {from} xuống {to}. | The moving average over {range} fell {delta}, from {from} to {to}. | `{range}` `{delta}` `{from}` `{to}` |
| `theme.revenue.trend.lastYearAverage` | Trung bình trượt năm trước | Last year's moving average | — |
| `theme.revenue.trend.movingAverage` | Trung bình trượt | Moving average | — |
| `theme.revenue.trend.netSeries` | Doanh thu thuần | Net revenue | — |
| `theme.revenue.trend.noData` | Chưa đủ số liệu để vẽ xu hướng {range}. | There is not enough data to draw the trend for {range}. | `{range}` |
| `theme.revenue.trend.rising` | Trung bình trượt {range} tăng {delta}, từ {from} lên {to}. | The moving average over {range} rose {delta}, from {from} to {to}. | `{range}` `{delta}` `{from}` `{to}` |
| `theme.revenue.trend.short` | Khoảng ngày có ít hơn {points} điểm nên chưa có đường trung bình trượt. | The range has fewer than {points} points, so there is no moving average yet. | `{points}` |
| `theme.revenue.trend.steady` | Trung bình trượt {range} gần như không đổi, quanh {to}. | The moving average over {range} held steady at about {to}. | `{range}` `{to}` |
| `theme.revenue.trend.table` | Doanh thu và trung bình trượt | Revenue and moving average | — |
| `theme.revenue.trend.tetNote` | Vùng tô màu là Tết; doanh thu những ngày này không phản ánh xu hướng. | The shaded span is Tết; sales on those days do not reflect the trend. | — |
| `theme.revenue.trend.title` | Xu hướng doanh thu | Revenue trend | — |

### Thẻ «Số hóa đơn» (`theme.revenue.invoices.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.invoices.chart` | Số hóa đơn theo cửa hàng, kỳ này và kỳ trước | Invoices by store, this range and the previous one | — |
| `theme.revenue.invoices.down` | Số hóa đơn {range} là {value}, ít hơn {delta} {reference}. | Invoices for {range} was {value}, down {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.revenue.invoices.flat` | Số hóa đơn {range} là {value}, gần như không đổi {reference}. | Invoices for {range} was {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.revenue.invoices.noData` | Chưa có số liệu bán hàng trong {range}. | No sales were recorded in {range}. | `{range}` |
| `theme.revenue.invoices.noReference` | Số hóa đơn {range} là {value}; chưa có kỳ trước để so sánh. | Invoices for {range} was {value}; there is no earlier range to compare with. | `{range}` `{value}` |
| `theme.revenue.invoices.periodTable` | Số hóa đơn theo kỳ | Invoices by range | — |
| `theme.revenue.invoices.storeTable` | Số hóa đơn theo cửa hàng | Invoices by store | — |
| `theme.revenue.invoices.title` | Số hóa đơn | Invoices | — |
| `theme.revenue.invoices.up` | Số hóa đơn {range} là {value}, nhiều hơn {delta} {reference}. | Invoices for {range} was {value}, up {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Thẻ «Giá trị trung bình mỗi hóa đơn» (`theme.revenue.avgTicket.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.avgTicket.chart` | Giá trị trung bình mỗi hóa đơn theo cửa hàng, kỳ này và kỳ trước | Average ticket by store, this range and the previous one | — |
| `theme.revenue.avgTicket.down` | Giá trị trung bình mỗi hóa đơn {range} là {value}, thấp hơn {delta} {reference}. | Average ticket for {range} was {value}, down {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.revenue.avgTicket.flat` | Giá trị trung bình mỗi hóa đơn {range} là {value}, gần như không đổi {reference}. | Average ticket for {range} was {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.revenue.avgTicket.noData` | Chưa có số liệu bán hàng trong {range}. | No sales were recorded in {range}. | `{range}` |
| `theme.revenue.avgTicket.noReference` | Giá trị trung bình mỗi hóa đơn {range} là {value}; chưa có kỳ trước để so sánh. | Average ticket for {range} was {value}; there is no earlier range to compare with. | `{range}` `{value}` |
| `theme.revenue.avgTicket.periodTable` | Giá trị trung bình mỗi hóa đơn theo kỳ | Average ticket by range | — |
| `theme.revenue.avgTicket.storeTable` | Giá trị trung bình mỗi hóa đơn theo cửa hàng | Average ticket by store | — |
| `theme.revenue.avgTicket.table` | Thành phần giá trị hóa đơn theo kỳ | What makes up the ticket, by range | — |
| `theme.revenue.avgTicket.title` | Giá trị trung bình mỗi hóa đơn | Average ticket | — |
| `theme.revenue.avgTicket.up` | Giá trị trung bình mỗi hóa đơn {range} là {value}, cao hơn {delta} {reference}. | Average ticket for {range} was {value}, up {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Thẻ «Theo tháng» (`theme.revenue.byMonth.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.byMonth.caption` | Tháng {month} | Month {month} | `{month}` |
| `theme.revenue.byMonth.chart` | Doanh thu theo tháng, năm nay và năm trước | Revenue by month, this year and last year | — |
| `theme.revenue.byMonth.lastYear` | Năm trước | Last year | — |
| `theme.revenue.byMonth.likeForLike` | Cùng cửa hàng | Same stores | — |
| `theme.revenue.byMonth.main` | Tháng cao nhất trong {range} là {month} với {value}, {delta} so với cùng tháng năm trước. | The best month in {range} was {month} with {value}, {delta} on the same month last year. | `{range}` `{month}` `{value}` `{delta}` |
| `theme.revenue.byMonth.noData` | Chưa có số liệu theo tháng trong {range}. | There are no monthly figures in {range}. | `{range}` |
| `theme.revenue.byMonth.noLastYear` | Tháng cao nhất trong {range} là {month} với {value}; chưa có cùng tháng năm trước để so sánh. | The best month in {range} was {month} with {value}; there is no same month last year to compare with. | `{range}` `{month}` `{value}` |
| `theme.revenue.byMonth.table` | Doanh thu theo tháng | Revenue by month | — |
| `theme.revenue.byMonth.thisYear` | Năm nay | This year | — |
| `theme.revenue.byMonth.title` | Theo tháng | By month | — |

### Thẻ «Tỷ trọng từng cửa hàng» (`theme.revenue.storeShare.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.storeShare.caption` | {store} | {store} | `{store}` |
| `theme.revenue.storeShare.chart` | Tỷ trọng doanh thu, kỳ trước và kỳ này | Share of revenue, previous range and this range | — |
| `theme.revenue.storeShare.current` | Kỳ này | This range | — |
| `theme.revenue.storeShare.main` | {store} chiếm {share} doanh thu {range}, thay đổi {delta} so với kỳ trước. | {store} made {share} of revenue in {range}, a change of {delta} on the previous range. | `{store}` `{share}` `{range}` `{delta}` |
| `theme.revenue.storeShare.noData` | Chưa có số liệu để chia tỷ trọng {range}. | There are no figures to split for {range}. | `{range}` |
| `theme.revenue.storeShare.previous` | Kỳ trước | Previous range | — |
| `theme.revenue.storeShare.storeSeries` | {store} | {store} | `{store}` |
| `theme.revenue.storeShare.table` | Tỷ trọng doanh thu theo cửa hàng | Share of revenue by store | — |
| `theme.revenue.storeShare.title` | Tỷ trọng từng cửa hàng | Share of each store | — |

### Tên dòng theo kỳ trong bảng · period rows (`theme.revenue.periodRow.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.periodRow.current` | Kỳ này | This range | — |
| `theme.revenue.periodRow.lastYear` | Cùng kỳ năm trước | Same weeks last year | — |
| `theme.revenue.periodRow.previous` | Kỳ trước | Previous range | — |

### Tên cột bảng · table columns (`theme.revenue.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.revenue.table.changeLastYear` | So với năm trước | Change on last year | — |
| `theme.revenue.table.changePoints` | Chênh lệch tỷ trọng | Change in share | — |
| `theme.revenue.table.changePrevious` | So với kỳ trước | Change on previous | — |
| `theme.revenue.table.lastYear` | Cùng kỳ năm trước | Same weeks last year | — |
| `theme.revenue.table.month` | Tháng | Month | — |
| `theme.revenue.table.previous` | Kỳ trước | Previous range | — |
| `theme.revenue.table.previousShare` | Tỷ trọng kỳ trước | Previous share | — |
| `theme.revenue.table.share` | Tỷ trọng | Share | — |
| `theme.revenue.table.week` | Tuần bắt đầu | Week starting | — |

## Giờ & ngày trong tuần · Hours and weekdays (`theme-hours.vi.json`, 73 mục)

### Tiêu đề · title (`theme.hours.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.title` | Giờ & ngày trong tuần | Hours and weekdays | — |

### Thẻ «Bản đồ nhiệt giờ × thứ» (`theme.hours.heatmap.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.heatmap.caption` | {weekday}, {hour} | {weekday}, {hour} | `{weekday}` `{hour}` |
| `theme.hours.heatmap.invoicesTable` | Số hóa đơn trung bình mỗi ngày theo giờ và thứ | Mean invoices per day by hour and weekday | — |
| `theme.hours.heatmap.main` | Trong {range}, ô bán tốt nhất là {bestDay} lúc {bestHour} với {best} mỗi ngày; ô vắng nhất có bán là {quietDay} lúc {quietHour} với {quiet}. | In {range} the best cell was {bestDay} at {bestHour} with {best} a day; the quietest cell with sales was {quietDay} at {quietHour} with {quiet}. | `{range}` `{bestDay}` `{bestHour}` `{best}` `{quietDay}` `{quietHour}` `{quiet}` |
| `theme.hours.heatmap.netTable` | Doanh thu trung bình mỗi ngày theo giờ và thứ | Mean revenue per day by hour and weekday | — |
| `theme.hours.heatmap.noData` | Chưa có số liệu theo giờ trong {range}. | There are no hourly figures in {range}. | `{range}` |
| `theme.hours.heatmap.thin` | Có thứ trong tuần mới có dưới {days} ngày số liệu; các ô của thứ đó chưa đáng tin. | A weekday has fewer than {days} days of data; its cells are not yet reliable. | `{days}` |
| `theme.hours.heatmap.title` | Bản đồ nhiệt giờ × thứ | Hour × weekday heat map | — |

### Thẻ «Giờ cao điểm và thấp điểm» (`theme.hours.peakDead.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.peakDead.chart` | Doanh thu trung bình mỗi ngày theo giờ | Mean revenue per day by hour | — |
| `theme.hours.peakDead.main` | Giờ cao điểm {range}: {peak}, chiếm {peakShare} doanh thu; giờ thấp điểm: {dead}, chiếm {deadShare}. | Peak hours in {range}: {peak}, with {peakShare} of revenue; quiet hours: {dead}, with {deadShare}. | `{range}` `{peak}` `{peakShare}` `{dead}` `{deadShare}` |
| `theme.hours.peakDead.noData` | Chưa có số liệu theo giờ trong {range}. | There are no hourly figures in {range}. | `{range}` |
| `theme.hours.peakDead.noDead` | Giờ cao điểm {range}: {peak}, chiếm {peakShare} doanh thu; không có giờ thấp điểm. | Peak hours in {range}: {peak}, with {peakShare} of revenue; no hour is quiet. | `{range}` `{peak}` `{peakShare}` |
| `theme.hours.peakDead.previous` | Kỳ trước | Previous range | — |
| `theme.hours.peakDead.table` | Doanh thu theo giờ | Revenue by hour | — |
| `theme.hours.peakDead.title` | Giờ cao điểm và thấp điểm | Peak and quiet hours | — |
| `theme.hours.peakDead.window` | Tỷ trọng của {hours} giờ cao nhất | Share of the {hours} best hours | `{hours}` |

### Thẻ «Theo thứ trong tuần» (`theme.hours.weekday.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.weekday.caption` | {weekday} | {weekday} | `{weekday}` |
| `theme.hours.weekday.chart` | Doanh thu trung bình mỗi ngày theo thứ | Mean revenue per day by weekday | — |
| `theme.hours.weekday.driver` | {weekday} thay đổi nhiều nhất so với kỳ trước: {delta}. | {weekday} changed most on the previous range: {delta}. | `{weekday}` `{delta}` |
| `theme.hours.weekday.main` | {best} bán tốt nhất {range} với {bestValue} mỗi ngày, cao hơn {gap} so với {worst}. | {best} sold best in {range} with {bestValue} a day, {gap} more than {worst}. | `{best}` `{range}` `{bestValue}` `{gap}` `{worst}` |
| `theme.hours.weekday.noData` | Chưa có số liệu theo thứ trong {range}. | There are no weekday figures in {range}. | `{range}` |
| `theme.hours.weekday.table` | Doanh thu trung bình theo thứ | Mean revenue by weekday | — |
| `theme.hours.weekday.title` | Theo thứ trong tuần | By weekday | — |

### Thẻ «Doanh thu mỗi giờ mở cửa và mỗi ghế» (`theme.hours.productivity.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.productivity.current` | Kỳ này | This range | — |
| `theme.hours.productivity.down` | Doanh thu mỗi giờ mở cửa {range} là {value}, thấp hơn {delta} {reference}. | Revenue per opening hour in {range} was {value}, down {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.hours.productivity.flat` | Doanh thu mỗi giờ mở cửa {range} là {value}, gần như không đổi {reference}. | Revenue per opening hour in {range} was {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.hours.productivity.missingHours` | Doanh thu mỗi giờ mở cửa {range} chưa tính được. | Revenue per opening hour for {range} cannot be computed yet. | `{range}` |
| `theme.hours.productivity.noData` | Chưa có số liệu để tính doanh thu mỗi giờ mở cửa {range}. | There is no data to compute revenue per opening hour in {range}. | `{range}` |
| `theme.hours.productivity.noHours` | Chưa nhập giờ mở cửa cho cửa hàng có bán nên chưa tính được doanh thu mỗi giờ. | Opening hours are missing for a store with sales, so revenue per hour cannot be computed. | — |
| `theme.hours.productivity.noReference` | Doanh thu mỗi giờ mở cửa {range} là {value}. | Revenue per opening hour in {range} was {value}. | `{range}` `{value}` |
| `theme.hours.productivity.noSeats` | chưa có số ghế | no seat count | — |
| `theme.hours.productivity.periodTable` | Doanh thu mỗi giờ mở cửa theo kỳ | Revenue per opening hour by range | — |
| `theme.hours.productivity.previous` | Kỳ trước | Previous range | — |
| `theme.hours.productivity.revpash` | Doanh thu mỗi ghế mỗi giờ (RevPASH) là {value} với {seats} ghế. | Revenue per available seat-hour (RevPASH) was {value} with {seats} seats. | `{value}` `{seats}` |
| `theme.hours.productivity.storeTable` | Doanh thu mỗi giờ mở cửa theo cửa hàng | Revenue per opening hour by store | — |
| `theme.hours.productivity.title` | Doanh thu mỗi giờ mở cửa và mỗi ghế | Revenue per opening hour and per seat | — |
| `theme.hours.productivity.up` | Doanh thu mỗi giờ mở cửa {range} là {value}, cao hơn {delta} {reference}. | Revenue per opening hour in {range} was {value}, up {delta} {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Thẻ «Gợi ý khung ca» (`theme.hours.shiftWindows.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.shiftWindows.basis` | Dựa trên số hóa đơn mỗi giờ; chưa tính năng suất nhân viên. | Based on invoices per hour; staff productivity is not counted. | — |
| `theme.hours.shiftWindows.main` | Khung đông nhất {range}: {weekdays} từ Thứ Hai đến Thứ Sáu và {weekend} vào cuối tuần. | Busiest windows in {range}: {weekdays} on weekdays and {weekend} at the weekend. | `{range}` `{weekdays}` `{weekend}` |
| `theme.hours.shiftWindows.mainOne` | Khung đông nhất {range}: {window}, {group}. | Busiest window in {range}: {window}, {group}. | `{range}` `{window}` `{group}` |
| `theme.hours.shiftWindows.none` | Không có khung giờ đông rõ rệt trong {range}. | No hour stands out as busy in {range}. | `{range}` |
| `theme.hours.shiftWindows.short` | Cần ít nhất {days} ngày để gợi ý khung ca đáng tin. | At least {days} days are needed for reliable shift windows. | `{days}` |
| `theme.hours.shiftWindows.table` | Khung giờ theo nhóm ngày | Hour windows by day group | — |
| `theme.hours.shiftWindows.title` | Gợi ý khung ca | Suggested shift windows | — |
| `theme.hours.shiftWindows.window` | Số khung giờ đông | Busy windows | — |

### Mức giờ · hour levels (`theme.hours.level.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.level.busy` | đông | busy | — |
| `theme.hours.level.dead` | thấp điểm | quiet | — |
| `theme.hours.level.normal` | bình thường | normal | — |
| `theme.hours.level.peak` | cao điểm | peak | — |
| `theme.hours.level.quiet` | vắng | slow | — |

### Nhóm ngày · day groups (`theme.hours.dayGroup.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.dayGroup.weekdays` | Thứ Hai đến Thứ Sáu | Monday to Friday | — |
| `theme.hours.dayGroup.weekend` | Thứ Bảy và Chủ Nhật | Saturday and Sunday | — |

### Tên cột bảng · table columns (`theme.hours.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.hours.table.average` | Trung bình | Average | — |
| `theme.hours.table.change` | Thay đổi | Change | — |
| `theme.hours.table.dayGroup` | Nhóm ngày | Day group | — |
| `theme.hours.table.from` | Từ | From | — |
| `theme.hours.table.hour` | Giờ | Hour | — |
| `theme.hours.table.invoicesPerHour` | Hóa đơn mỗi giờ | Invoices per hour | — |
| `theme.hours.table.level` | Mức | Level | — |
| `theme.hours.table.maxInvoices` | Hóa đơn trung bình cao nhất | Highest mean invoices | — |
| `theme.hours.table.maxNet` | Doanh thu trung bình cao nhất | Highest mean revenue | — |
| `theme.hours.table.meanInvoices` | Hóa đơn trung bình mỗi ngày | Mean invoices per day | — |
| `theme.hours.table.meanNet` | Doanh thu trung bình mỗi ngày | Mean revenue per day | — |
| `theme.hours.table.minInvoices` | Hóa đơn trung bình thấp nhất | Lowest mean invoices | — |
| `theme.hours.table.minNet` | Doanh thu trung bình thấp nhất | Lowest mean revenue | — |
| `theme.hours.table.netPerHour` | Doanh thu mỗi giờ | Revenue per hour | — |
| `theme.hours.table.openHours` | Giờ mở cửa | Opening hours | — |
| `theme.hours.table.previousMean` | Trung bình kỳ trước | Previous mean | — |
| `theme.hours.table.revpash` | Doanh thu mỗi ghế mỗi giờ | RevPASH | — |
| `theme.hours.table.seats` | Số ghế | Seats | — |
| `theme.hours.table.share` | Tỷ trọng | Share | — |
| `theme.hours.table.to` | Đến | To | — |
| `theme.hours.table.weekday` | Thứ | Weekday | — |

## Thực đơn · Menu (`theme-menu.vi.json`, 130 mục)

### Tiêu đề · title (`theme.menu.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.title` | Thực đơn | Menu | — |

### Thẻ «Ma trận thực đơn» (`theme.menu.matrix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.matrix.chart` | Tỷ lệ món theo xếp loại trong từng vai trò | Share of items by class in each role | — |
| `theme.menu.matrix.classTable` | Số món theo xếp loại và ngưỡng phổ biến của từng vai trò | Items by class and the popularity line of each role | — |
| `theme.menu.matrix.itemsTable` | Xếp loại từng món theo vai trò | Class of each item by role | — |
| `theme.menu.matrix.lowSample` | Vai trò có ít hơn {minimum} món nên xếp loại chỉ để tham khảo. | A role with fewer than {minimum} items is classed for reference only. | `{minimum}` |
| `theme.menu.matrix.noData` | Chưa có món bán ra trong {days} ngày đến cuối kỳ. | No item sold in the {days} days to the end of the range. | `{days}` |
| `theme.menu.matrix.noRoles` | Gán vai trò cho loại món (đồ uống, topping, đồ ăn, đồ ăn nhẹ) để xếp loại thực đơn. | Give item types a role (drink, topping, food, snack) to class the menu. | — |
| `theme.menu.matrix.noStars` | Chưa có đồ uống nào bán ra trong {days} ngày đến cuối kỳ để xếp loại. | No drink sold in the {days} days to the end of the range to classify. | `{days}` |
| `theme.menu.matrix.provisional` | Vai trò còn món chưa có giá vốn được xếp tạm theo giá bán. | A role with an item still lacking a cost is classed on price for now. | — |
| `theme.menu.matrix.provisionalCell` | tạm tính | provisional | — |
| `theme.menu.matrix.stars` | {stars} trong {drinks} món đồ uống là ngôi sao: bán chạy và lãi từ mức chung của nhóm trở lên. | {stars} of {drinks} drinks are stars: popular and at or above their group's margin line. | `{stars}` `{drinks}` |
| `theme.menu.matrix.starsStores` | Mỗi cửa hàng xếp loại riêng; cộng lại, {stars} trong {drinks} lượt xếp loại đồ uống là ngôi sao. | Each store is classed on its own; together, {stars} of {drinks} drink classifications are stars. | `{stars}` `{drinks}` |
| `theme.menu.matrix.subtitle` | {days} ngày đến cuối kỳ, hệ số phổ biến {factor} | {days} days to the end of the range, popularity factor {factor} | `{days}` `{factor}` |
| `theme.menu.matrix.title` | Ma trận thực đơn | Menu matrix | — |
| `theme.menu.matrix.unmapped` | Chưa xếp loại được vì chưa gán vai trò cho loại món nào. | Nothing can be classed yet because no item type has a role. | — |

### Thẻ «Biên lợi nhuận món» (`theme.menu.margins.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.margins.noCost` | Chưa có món nào có giá vốn trong kỳ. | No item has a cost in the range. | — |
| `theme.menu.margins.noCostNotice` | Nhập giá vốn để xem biên lợi nhuận của từng món. | Enter item costs to see each item's margin. | — |
| `theme.menu.margins.noData` | Chưa có món bán ra trong {range}. | No item sold in {range}. | `{range}` |
| `theme.menu.margins.partial` | Giá vốn mới bao phủ {share} doanh thu của các món có giá vốn, vì có món chỉ có giá vốn từ giữa kỳ. | Costs cover {share} of the revenue of the costed items, because some costs start mid-range. | `{share}` |
| `theme.menu.margins.rate` | Biên lợi nhuận gộp của {items} món có giá vốn là {rate}; các món này chiếm {share} doanh thu món. | The gross margin of the {items} items with a cost is {rate}; they bring {share} of item revenue. | `{items}` `{rate}` `{share}` |
| `theme.menu.margins.table` | Biên lợi nhuận các món có giá vốn | Margins of the items with a cost | — |
| `theme.menu.margins.title` | Biên lợi nhuận món | Item margins | — |

### Thẻ «Món tăng, món giảm» (`theme.menu.movers.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.movers.caption` | {item} | {item} | `{item}` |
| `theme.menu.movers.captionLikeForLike` | {item} · cùng cửa hàng ({covered}/{total}) | {item} · same stores ({covered}/{total}) | `{item}` `{covered}` `{total}` |
| `theme.menu.movers.fallersOnly` | Không món nào tăng đáng kể; {faller} giảm mạnh nhất ({fallerChange} số lượng). | No item rose noticeably; {faller} fell most ({fallerChange} in quantity). | `{faller}` `{fallerChange}` |
| `theme.menu.movers.group.down` | Giảm | Falling | — |
| `theme.menu.movers.group.new` | Mới | New | — |
| `theme.menu.movers.group.up` | Tăng | Rising | — |
| `theme.menu.movers.main` | {riser} tăng mạnh nhất ({riserChange} số lượng); {faller} giảm mạnh nhất ({fallerChange}). | {riser} rose most ({riserChange} in quantity); {faller} fell most ({fallerChange}). | `{riser}` `{riserChange}` `{faller}` `{fallerChange}` |
| `theme.menu.movers.newItem` | Món mới bán chạy nhất: {item} ({quantity} phần). | Best-selling new item: {item} ({quantity} sold). | `{item}` `{quantity}` |
| `theme.menu.movers.noPrevious` | Chưa có số liệu kỳ trước ({range}) để so sánh. | There is no data for the previous period ({range}) to compare with. | `{range}` |
| `theme.menu.movers.noPreviousSentence` | Cửa hàng chưa có số liệu kỳ trước nên chưa xếp được món tăng, món giảm. | The store has no data for the previous period, so rising and falling items cannot be ranked yet. | — |
| `theme.menu.movers.noRiser` | Chưa có món nào tăng mà bán từ {minimum} phần ở cả hai kỳ. | No item rose while selling at least {minimum} in both periods. | `{minimum}` |
| `theme.menu.movers.none` | Không món nào bán từ {minimum} phần ở kỳ trước mà tăng hay giảm số lượng. | No item that sold at least {minimum} in the previous period rose or fell in quantity. | `{minimum}` |
| `theme.menu.movers.risersOnly` | {riser} tăng mạnh nhất ({riserChange} số lượng); không món nào giảm đáng kể. | {riser} rose most ({riserChange} in quantity); no item fell noticeably. | `{riser}` `{riserChange}` |
| `theme.menu.movers.table` | Món tăng, món giảm và món mới so với kỳ trước | Rising, falling and new items against the previous period | — |
| `theme.menu.movers.title` | Món tăng, món giảm | Rising and falling items | — |

### Thẻ «Cơ cấu nhóm món» (`theme.menu.categoryMix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.categoryMix.caption` | {category} | {category} | `{category}` |
| `theme.menu.categoryMix.chart` | Tỷ trọng doanh thu theo nhóm món, kỳ này và kỳ trước | Share of item revenue by category, this period and the previous one | — |
| `theme.menu.categoryMix.main` | Nhóm {category} chiếm tỷ trọng lớn nhất: {share} doanh thu món. | {category} has the largest share: {share} of item revenue. | `{category}` `{share}` |
| `theme.menu.categoryMix.noData` | Chưa bán món nào trong {range}. | No items sold in {range}. | `{range}` |
| `theme.menu.categoryMix.table` | Doanh thu theo nhóm món | Revenue by category | — |
| `theme.menu.categoryMix.title` | Cơ cấu nhóm món | Category mix | — |
| `theme.menu.categoryMix.uncategorised` | {items} món chưa có nhóm nên nằm trong mục Chưa phân loại. | {items} items have no category, so they sit under Uncategorised. | `{items}` |

### Thẻ «Cơ cấu size» (`theme.menu.sizeMix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.sizeMix.chart` | Tỷ trọng size L của 10 đồ uống bán nhiều nhất, kỳ này và kỳ trước | Size L share of the 10 best-selling drinks, this period and the previous one | — |
| `theme.menu.sizeMix.down` | Size L chiếm {value} lượng món bán theo size, thấp hơn kỳ trước {points} điểm %. | Size L is {value} of the quantity sold by size, {points} points below the previous period. | `{value}` `{points}` |
| `theme.menu.sizeMix.flat` | Size L chiếm {value} lượng món bán theo size, ngang kỳ trước. | Size L is {value} of the quantity sold by size, level with the previous period. | `{value}` |
| `theme.menu.sizeMix.noData` | Chưa đo được tỷ trọng size L trong {range}. | The size L share could not be measured in {range}. | `{range}` |
| `theme.menu.sizeMix.noReference` | Size L chiếm {value} lượng món bán theo size. | Size L is {value} of the quantity sold by size. | `{value}` |
| `theme.menu.sizeMix.none` | Chưa có món bán theo size. | No item is sold by size yet. | — |
| `theme.menu.sizeMix.table` | Size L theo đồ uống | Size L by drink | — |
| `theme.menu.sizeMix.title` | Cơ cấu size | Size mix | — |
| `theme.menu.sizeMix.up` | Size L chiếm {value} lượng món bán theo size, cao hơn kỳ trước {points} điểm %. | Size L is {value} of the quantity sold by size, {points} points above the previous period. | `{value}` `{points}` |

### Thẻ «Tỷ lệ kèm topping và đồ ăn nhẹ» (`theme.menu.attach.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.attach.caption` | kèm đồ ăn nhẹ {value} | with a snack {value} | `{value}` |
| `theme.menu.attach.chart` | Tỷ lệ kèm topping của 10 đồ uống bán nhiều nhất | Topping attach rate of the 10 best-selling drinks | — |
| `theme.menu.attach.down` | {value} hóa đơn có đồ uống được kèm topping, thấp hơn {days} ngày trước đó {points} điểm %. | {value} of invoices with a drink add a topping, {points} points below the {days} days before. | `{value}` `{days}` `{points}` |
| `theme.menu.attach.flat` | {value} hóa đơn có đồ uống được kèm topping, ngang {days} ngày trước đó. | {value} of invoices with a drink add a topping, level with the {days} days before. | `{value}` `{days}` |
| `theme.menu.attach.noData` | Chưa đo được tỷ lệ kèm topping trong {days} ngày cuối kỳ. | The topping attach rate could not be measured in the last {days} days of the range. | `{days}` |
| `theme.menu.attach.noDrinkRole` | Chưa gán vai trò đồ uống cho nhóm món nào nên chưa tính được tỷ lệ kèm. | No item type has the drink role yet, so attach rates cannot be measured. | — |
| `theme.menu.attach.noReference` | {value} hóa đơn có đồ uống được kèm topping. | {value} of invoices with a drink add a topping. | `{value}` |
| `theme.menu.attach.noRoles` | Chưa gán vai trò topping và đồ ăn nhẹ cho nhóm món nào. | No item type has the topping or snack role yet. | — |
| `theme.menu.attach.noSnackRole` | Chưa tính được tỷ lệ kèm đồ ăn nhẹ: cần gán vai trò đồ ăn nhẹ cho nhóm món của cửa hàng đã chọn. | The snack attach rate needs the snack role on an item type of the selected stores. | — |
| `theme.menu.attach.noToppingRole` | Chưa tính được tỷ lệ kèm topping: cần gán vai trò topping cho nhóm món của cửa hàng đã chọn. | The topping attach rate needs the topping role on an item type of the selected stores. | — |
| `theme.menu.attach.snackPrevious` | kèm đồ ăn nhẹ so với {days} ngày trước đó | snack attach against the {days} days before | `{days}` |
| `theme.menu.attach.table` | Tỷ lệ kèm theo từng đồ uống | Attach rates by drink | — |
| `theme.menu.attach.title` | Tỷ lệ kèm topping và đồ ăn nhẹ | Topping and snack attach rates | — |
| `theme.menu.attach.topDrink` | {item} được kèm topping nhiều nhất: {rate} hóa đơn có món này. | {item} gets a topping most often: on {rate} of its invoices. | `{item}` `{rate}` |
| `theme.menu.attach.toppingPrevious` | kèm topping so với {days} ngày trước đó | topping attach against the {days} days before | `{days}` |
| `theme.menu.attach.up` | {value} hóa đơn có đồ uống được kèm topping, cao hơn {days} ngày trước đó {points} điểm %. | {value} of invoices with a drink add a topping, {points} points above the {days} days before. | `{value}` `{days}` `{points}` |

### Thẻ «Món hay bán cùng nhau» (`theme.menu.pairs.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.pairs.caption` | {a} + {b} | {a} + {b} | `{a}` `{b}` |
| `theme.menu.pairs.main` | {a} và {b} hay được mua cùng nhau nhất: {invoices} hóa đơn, độ nâng {lift}; đáng thử làm combo. | {a} and {b} are bought together most: {invoices} invoices, lift {lift}; worth trying as a combo. | `{a}` `{b}` `{invoices}` `{lift}` |
| `theme.menu.pairs.minimum` | Một cặp món cần có mặt cùng nhau trên ít nhất {minimum} hóa đơn. | A pair needs at least {minimum} invoices holding both items. | `{minimum}` |
| `theme.menu.pairs.none` | Chưa có cặp món nào cùng có trên từ {minimum} hóa đơn trong {days} ngày cuối kỳ. | No pair of items shared at least {minimum} invoices in the last {days} days of the range. | `{minimum}` `{days}` |
| `theme.menu.pairs.table` | 20 cặp món hay bán cùng nhau nhất | The 20 pairs most often sold together | — |
| `theme.menu.pairs.title` | Món hay bán cùng nhau | Items sold together | — |

### Thẻ «Đường và đá» (`theme.menu.preferences.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.preferences.caption` | {level} | {level} | `{level}` |
| `theme.menu.preferences.chart` | Tỷ lệ chọn từng mức đường và đá, kỳ này và kỳ trước | Share of each sugar and ice level, this period and the previous one | — |
| `theme.menu.preferences.iceOnly` | Khách chọn {ice} nhiều nhất trong các mức đá ({iceShare}). | Customers choose {ice} most among ice levels ({iceShare}). | `{ice}` `{iceShare}` |
| `theme.menu.preferences.iceTable` | Mức đá | Ice levels | — |
| `theme.menu.preferences.main` | Khách chọn {sugar} nhiều nhất trong các mức đường ({sugarShare}) và {ice} nhiều nhất trong các mức đá ({iceShare}). | Customers choose {sugar} most among sugar levels ({sugarShare}) and {ice} most among ice levels ({iceShare}). | `{sugar}` `{sugarShare}` `{ice}` `{iceShare}` |
| `theme.menu.preferences.noData` | Chưa có tùy chọn món nào trong {range}. | No item options were chosen in {range}. | `{range}` |
| `theme.menu.preferences.none` | Chưa ghi nhận tùy chọn đường, đá nào trong kỳ. | No sugar or ice option was recorded in the range. | — |
| `theme.menu.preferences.otherOnly` | Chưa có tùy chọn đường hay đá; có {count} tùy chọn khác. | No sugar or ice option yet; {count} other options were chosen. | `{count}` |
| `theme.menu.preferences.sugarOnly` | Khách chọn {sugar} nhiều nhất trong các mức đường ({sugarShare}). | Customers choose {sugar} most among sugar levels ({sugarShare}). | `{sugar}` `{sugarShare}` |
| `theme.menu.preferences.sugarTable` | Mức đường và các tùy chọn khác | Sugar levels and other options | — |
| `theme.menu.preferences.title` | Đường và đá | Sugar and ice | — |

### Nhóm của ma trận thực đơn · menu matrix classes (`theme.menu.class.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.class.dog` | Chó | Dog | — |
| `theme.menu.class.plowhorse` | Ngựa kéo cày | Plowhorse | — |
| `theme.menu.class.puzzle` | Câu đố | Puzzle | — |
| `theme.menu.class.star` | Ngôi sao | Star | — |

### Nhóm tùy chọn · modifier families (`theme.menu.family.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.family.ice` | Đá | Ice | — |
| `theme.menu.family.other` | Khác | Other | — |
| `theme.menu.family.sugar` | Đường | Sugar | — |

### Tên cột bảng · table columns (`theme.menu.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.menu.table.avgPrice` | Giá bán bình quân | Average price | — |
| `theme.menu.table.class` | Xếp loại | Class | — |
| `theme.menu.table.confidenceAB` | Có món 1 thì có món 2 | Item 1 then item 2 | — |
| `theme.menu.table.confidenceBA` | Có món 2 thì có món 1 | Item 2 then item 1 | — |
| `theme.menu.table.cost` | Giá vốn | Cost | — |
| `theme.menu.table.costedNet` | Doanh thu có giá vốn | Costed revenue | — |
| `theme.menu.table.costedQuantity` | Số lượng có giá vốn | Costed quantity | — |
| `theme.menu.table.coverage` | Độ phủ giá vốn | Cost coverage | — |
| `theme.menu.table.drink` | Đồ uống | Drink | — |
| `theme.menu.table.drinkInvoices` | Hóa đơn có món | Invoices with the drink | — |
| `theme.menu.table.family` | Loại | Kind | — |
| `theme.menu.table.familyShare` | Tỷ lệ trong loại | Share within kind | — |
| `theme.menu.table.group` | Xu hướng | Trend | — |
| `theme.menu.table.itemA` | Món 1 | Item 1 | — |
| `theme.menu.table.itemB` | Món 2 | Item 2 | — |
| `theme.menu.table.largeQuantity` | Số lượng size L | Size L quantity | — |
| `theme.menu.table.largeShare` | Tỷ trọng size L | Size L share | — |
| `theme.menu.table.level` | Tùy chọn | Option | — |
| `theme.menu.table.lift` | Độ nâng | Lift | — |
| `theme.menu.table.lines` | Lượt chọn | Times chosen | — |
| `theme.menu.table.margin` | Lãi gộp | Gross margin | — |
| `theme.menu.table.marginAxis` | Lãi mỗi món | Margin per item | — |
| `theme.menu.table.marginRate` | Biên lợi nhuận | Margin rate | — |
| `theme.menu.table.mix` | % số lượng trong nhóm | % of the group's quantity | — |
| `theme.menu.table.pairInvoices` | Hóa đơn có cả hai | Invoices with both | — |
| `theme.menu.table.previousShare` | Tỷ trọng kỳ trước | Previous share | — |
| `theme.menu.table.priorQuantity` | Số lượng kỳ trước | Quantity previous period | — |
| `theme.menu.table.quantityChange` | Thay đổi số lượng | Quantity change | — |
| `theme.menu.table.recentNet` | Doanh thu kỳ này | Revenue this period | — |
| `theme.menu.table.recentQuantity` | Số lượng kỳ này | Quantity this period | — |
| `theme.menu.table.role` | Vai trò | Role | — |
| `theme.menu.table.sizedQuantity` | Số lượng có size | Sized quantity | — |
| `theme.menu.table.snackRate` | Kèm đồ ăn nhẹ | With a snack | — |
| `theme.menu.table.starShare` | Doanh thu từ ngôi sao | Revenue from stars | — |
| `theme.menu.table.threshold` | Ngưỡng phổ biến (%) | Popularity line (%) | — |
| `theme.menu.table.toppingRate` | Kèm topping | With a topping | — |
| `theme.menu.table.unitCost` | Giá vốn mỗi món | Unit cost | — |

## Thanh toán & tiền mặt · Payments and cash (`theme-payments.vi.json`, 52 mục)

### Tiêu đề · title (`theme.payments.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.title` | Thanh toán & tiền mặt | Payments and cash | — |

### Thẻ «Cơ cấu thanh toán theo loại» (`theme.payments.mix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.mix.chart` | Cơ cấu thanh toán theo loại, kỳ trước và kỳ này | Payment mix by kind, previous period and this one | — |
| `theme.payments.mix.down` | Trong {range}, tiền mặt chiếm {value} số tiền thu, giảm {points} điểm % {reference}. | In {range}, cash is {value} of the money taken, down {points} points {reference}. | `{range}` `{value}` `{points}` `{reference}` |
| `theme.payments.mix.flat` | Trong {range}, tiền mặt chiếm {value} số tiền thu, gần như không đổi {reference}. | In {range}, cash is {value} of the money taken, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.payments.mix.kindsTable` | Thanh toán theo loại | Payments by kind | — |
| `theme.payments.mix.methodsTable` | Thanh toán theo phương thức | Payments by method | — |
| `theme.payments.mix.noData` | Chưa có khoản thanh toán nào trong {range}. | No payment was taken in {range}. | `{range}` |
| `theme.payments.mix.noReference` | Trong {range}, tiền mặt chiếm {value} số tiền thu. | In {range}, cash is {value} of the money taken. | `{range}` `{value}` |
| `theme.payments.mix.otherMover` | Ngoài tiền mặt, {payment} thay đổi tỷ trọng nhiều nhất ({delta}). | Apart from cash, {payment} moved most ({delta}). | `{payment}` `{delta}` |
| `theme.payments.mix.title` | Cơ cấu thanh toán theo loại | Payment mix by kind | — |
| `theme.payments.mix.up` | Trong {range}, tiền mặt chiếm {value} số tiền thu, tăng {points} điểm % {reference}. | In {range}, cash is {value} of the money taken, up {points} points {reference}. | `{range}` `{value}` `{points}` `{reference}` |

### Thẻ «Xu hướng tỷ trọng tiền mặt» (`theme.payments.trend.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.trend.chart` | Tiền mặt (cột) và tỷ trọng tiền mặt (đường) | Cash (bars) and cash share (line) | — |
| `theme.payments.trend.dayBucket` | ngày {date} | {date} | `{date}` |
| `theme.payments.trend.down` | Tiền mặt chiếm {value} số tiền thu {bucket}, thấp hơn {first} {points} điểm %. | Cash is {value} of the money taken on {bucket}, {points} points below {first}. | `{value}` `{bucket}` `{first}` `{points}` |
| `theme.payments.trend.firstBucket` | so với {bucket} | against {bucket} | `{bucket}` |
| `theme.payments.trend.flat` | Tiền mặt chiếm {value} số tiền thu {bucket}, ngang {first}. | Cash is {value} of the money taken on {bucket}, level with {first}. | `{value}` `{bucket}` `{first}` |
| `theme.payments.trend.noData` | Chưa có khoản thanh toán nào trong {range}. | No payment was taken in {range}. | `{range}` |
| `theme.payments.trend.noReference` | Tiền mặt chiếm {value} số tiền thu {bucket}. | Cash is {value} of the money taken on {bucket}. | `{value}` `{bucket}` |
| `theme.payments.trend.signal` | Những tuần gần đây, tỷ trọng tiền mặt tăng trong khi doanh thu mỗi ngày giảm so với những tuần trước đó: nên đối chiếu tiền mặt từng ca. | In the recent weeks the cash share rose while revenue per day fell against the weeks before: worth checking the cash of each shift. | — |
| `theme.payments.trend.storesJoined` | Có cửa hàng bắt đầu có số liệu sau {first} nên không so đầu kỳ với cuối kỳ. | A store has data only after {first}, so the start and the end of the range are not compared. | `{first}` |
| `theme.payments.trend.table` | Doanh thu và tiền mặt theo thời gian | Revenue and cash over time | — |
| `theme.payments.trend.title` | Xu hướng tỷ trọng tiền mặt | Cash share trend | — |
| `theme.payments.trend.up` | Tiền mặt chiếm {value} số tiền thu {bucket}, cao hơn {first} {points} điểm %. | Cash is {value} of the money taken on {bucket}, {points} points above {first}. | `{value}` `{bucket}` `{first}` `{points}` |
| `theme.payments.trend.weekBucket` | tuần từ {date} | the week from {date} | `{date}` |

### Thẻ «Tiền mặt dự kiến và đếm được theo ca» (`theme.payments.drawer.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.drawer.caption` | trên {count} ca | of {count} shifts | `{count}` |
| `theme.payments.drawer.chart` | Chênh lệch két của các ca lệch nhiều nhất | Drawer variance of the shifts furthest off | — |
| `theme.payments.drawer.noData` | Chưa có ca nào trong {days} ngày cuối kỳ. | No shift in the last {days} days of the range. | `{days}` |
| `theme.payments.drawer.noShifts` | Chưa có ca nào; kiểm tra thu ngân có mở và đóng ca trên POS không. | No shift yet; check that cashiers open and close shifts on the POS. | — |
| `theme.payments.drawer.shiftOn` | {shift} ngày {date} | {shift} on {date} | `{shift}` `{date}` |
| `theme.payments.drawer.shiftOnAt` | {shift} ngày {date} ở {store} | {shift} on {date} at {store} | `{shift}` `{date}` `{store}` |
| `theme.payments.drawer.table` | Các ca, chênh lệch lớn nhất trước | Shifts, largest variance first | — |
| `theme.payments.drawer.thresholds` | Ngưỡng: {abs} · {rel} tiền mặt bán · z trên {z}. | Thresholds: {abs} · {rel} of cash sales · z above {z}. | `{abs}` `{rel}` `{z}` |
| `theme.payments.drawer.title` | Tiền mặt dự kiến và đếm được theo ca | Expected and counted cash per shift | — |

### Thẻ «Phí thanh toán ước tính» (`theme.payments.fees.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.fees.caption` | {rate} doanh thu không dùng tiền mặt | {rate} of non-cash revenue | `{rate}` |
| `theme.payments.fees.costliest` | {method} tốn phí nhiều nhất: {fee}, {share} tổng phí ước tính. | {method} costs the most in fees: {fee}, {share} of the estimated fees. | `{method}` `{fee}` `{share}` |
| `theme.payments.fees.down` | Phí thanh toán ước tính trong {range} là {value}, thấp hơn {delta} {reference}. | Estimated payment fees in {range} are {value}, {delta} lower {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.payments.fees.flat` | Phí thanh toán ước tính trong {range} là {value}, gần như không đổi {reference}. | Estimated payment fees in {range} are {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.payments.fees.noData` | Chưa có khoản thanh toán nào trong {range}. | No payment was taken in {range}. | `{range}` |
| `theme.payments.fees.noReference` | Phí thanh toán ước tính trong {range} là {value}. | Estimated payment fees in {range} are {value}. | `{range}` `{value}` |
| `theme.payments.fees.notConfigured` | Chưa nhập tỷ lệ phí thanh toán nên chưa ước tính được phí. | No payment fee rate has been entered, so fees cannot be estimated yet. | — |
| `theme.payments.fees.notConfiguredNotice` | Nhập tỷ lệ phí của từng phương thức để ước tính phí thanh toán. | Enter the fee rate of each payment method to estimate payment fees. | — |
| `theme.payments.fees.table` | Phí theo phương thức thanh toán | Fees by payment method | — |
| `theme.payments.fees.title` | Phí thanh toán ước tính | Estimated payment fees | — |
| `theme.payments.fees.up` | Phí thanh toán ước tính trong {range} là {value}, cao hơn {delta} {reference}. | Estimated payment fees in {range} are {value}, {delta} higher {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Tên cột bảng · table columns (`theme.payments.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.payments.table.cashAmount` | Tiền mặt | Cash | — |
| `theme.payments.table.cashShare` | Tỷ trọng tiền mặt | Cash share | — |
| `theme.payments.table.day` | Ngày | Day | — |
| `theme.payments.table.effectiveRate` | Tỷ lệ phí thực tế | Effective fee rate | — |
| `theme.payments.table.feeEstimate` | Phí ước tính | Estimated fee | — |
| `theme.payments.table.posFee` | Phí POS ghi nhận | Fee reported by the POS | — |
| `theme.payments.table.previousShare` | Tỷ trọng kỳ trước | Previous share | — |
| `theme.payments.table.weekFrom` | Tuần từ | Week from | — |

## Khuyến mãi & giảm giá · Promotions and discounts (`theme-promotions.vi.json`, 171 mục)

### Tiêu đề · title (`theme.promotions.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.title` | Khuyến mãi & giảm giá | Promotions & discounts | — |

### Thẻ «Chi phí giảm giá» (`theme.promotions.discountCost.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.discountCost.caption` | {rate} doanh thu gộp | {rate} of gross revenue | `{rate}` |
| `theme.promotions.discountCost.chartDay` | Giảm giá món, hóa đơn và voucher theo ngày | Item, bill and voucher discounts by day | — |
| `theme.promotions.discountCost.chartWeek` | Giảm giá món, hóa đơn và voucher theo tuần | Item, bill and voucher discounts by week | — |
| `theme.promotions.discountCost.componentsTable` | Thành phần giảm giá, kỳ này và kỳ trước | Discount components, this range and the one before | — |
| `theme.promotions.discountCost.down` | Chi phí giảm giá trong {range} là {value}, thấp hơn {delta} {reference}. | Discounts in {range} cost {value}, {delta} less {reference}. | `{range}` `{value}` `{delta}` `{reference}` |
| `theme.promotions.discountCost.flat` | Chi phí giảm giá trong {range} là {value}, gần như không đổi {reference}. | Discounts in {range} cost {value}, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.promotions.discountCost.largest` | Lớn nhất là {promotion}: {amount}, {share} chi phí giảm giá. | The largest was {promotion}: {amount}, {share} of the discount cost. | `{promotion}` `{amount}` `{share}` |
| `theme.promotions.discountCost.largestUnnamed` | {kind} không tên tốn nhiều nhất: {amount}, {share} chi phí giảm giá. | {kind} without a name cost the most: {amount}, {share} of the discount cost. | `{kind}` `{amount}` `{share}` |
| `theme.promotions.discountCost.noData` | Chưa có hóa đơn nào trong {range}. | There are no invoices in {range} yet. | `{range}` |
| `theme.promotions.discountCost.noReference` | Chi phí giảm giá trong {range} là {value}. | Discounts in {range} cost {value}. | `{range}` `{value}` |
| `theme.promotions.discountCost.none` | Không có giảm giá hay voucher nào trong {range}. | There were no discounts or vouchers in {range}. | `{range}` |
| `theme.promotions.discountCost.rateCompare` | tỷ lệ giảm giá {reference} | discount rate {reference} | `{reference}` |
| `theme.promotions.discountCost.table` | Khuyến mãi đã dùng trong khoảng ngày | Promotions used in the range | — |
| `theme.promotions.discountCost.title` | Chi phí giảm giá | Discount cost | — |
| `theme.promotions.discountCost.up` | Chi phí giảm giá trong {range} là {value}, cao hơn {delta} {reference}. | Discounts in {range} cost {value}, {delta} more {reference}. | `{range}` `{value}` `{delta}` `{reference}` |

### Thẻ «Voucher» (`theme.promotions.vouchers.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.vouchers.down` | Trong {range}, {value} hóa đơn có dùng voucher, giảm {points} điểm % {reference}. | In {range}, {value} of invoices used a voucher, down {points} points {reference}. | `{range}` `{value}` `{points}` `{reference}` |
| `theme.promotions.vouchers.flat` | Trong {range}, {value} hóa đơn có dùng voucher, gần như không đổi {reference}. | In {range}, {value} of invoices used a voucher, about the same {reference}. | `{range}` `{value}` `{reference}` |
| `theme.promotions.vouchers.noData` | Chưa có hóa đơn nào trong {range}. | There are no invoices in {range} yet. | `{range}` |
| `theme.promotions.vouchers.noReference` | Trong {range}, {value} hóa đơn có dùng voucher. | In {range}, {value} of invoices used a voucher. | `{range}` `{value}` |
| `theme.promotions.vouchers.none` | Không hóa đơn nào dùng voucher trong {range}. | No invoice used a voucher in {range}. | `{range}` |
| `theme.promotions.vouchers.table` | Voucher đã dùng | Vouchers used | — |
| `theme.promotions.vouchers.title` | Voucher | Voucher | — |
| `theme.promotions.vouchers.top` | Dùng nhiều nhất là {voucher}: {invoices} hóa đơn, giảm {amount}. | The most used was {voucher}: {invoices} invoices, {amount} off. | `{voucher}` `{invoices}` `{amount}` |
| `theme.promotions.vouchers.topUnnamed` | Dùng nhiều nhất là một voucher không tên: {invoices} hóa đơn, giảm {amount}. | The most used was an unnamed voucher: {invoices} invoices, {amount} off. | `{invoices}` `{amount}` |
| `theme.promotions.vouchers.up` | Trong {range}, {value} hóa đơn có dùng voucher, tăng {points} điểm % {reference}. | In {range}, {value} of invoices used a voucher, up {points} points {reference}. | `{range}` `{value}` `{points}` `{reference}` |

### Thẻ «Hiệu quả khuyến mãi» (`theme.promotions.lift.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.lift.caption` | Doanh thu gộp tăng thêm {gross} · chi phí giảm giá {cost} | Gross lift {gross} · discount cost {cost} | `{gross}` `{cost}` |
| `theme.promotions.lift.chart` | Doanh thu gộp ngày khuyến mãi (cột) và mức dự kiến nếu không khuyến mãi (đường) | Gross revenue on promotion days (bars) and the level expected without the promotion (line) | — |
| `theme.promotions.lift.gain` | {promotion} lãi ròng {net} trong {days} ngày khuyến mãi đo được: doanh thu gộp tăng thêm {gross}, chi phí giảm giá {cost}. | {promotion} earned {net} net over {days} measured promotion days: a gross lift of {gross} against a discount cost of {cost}. | `{promotion}` `{net}` `{days}` `{gross}` `{cost}` |
| `theme.promotions.lift.loss` | {promotion} lỗ ròng {net} trong {days} ngày khuyến mãi đo được: doanh thu gộp tăng thêm {gross}, chi phí giảm giá {cost}. | {promotion} lost {net} net over {days} measured promotion days: a gross lift of {gross} against a discount cost of {cost}. | `{promotion}` `{net}` `{days}` `{gross}` `{cost}` |
| `theme.promotions.lift.no` | Không | No | — |
| `theme.promotions.lift.none` | Không có khuyến mãi nào trong {days} ngày cuối kỳ nên chưa có gì để đo. | No promotion ran in the last {days} days of the range, so there is nothing to measure. | `{days}` |
| `theme.promotions.lift.noneNotice` | Hiệu quả được đo trên những ngày cuối kỳ; hãy chọn khoảng ngày có chạy khuyến mãi. | The lift is measured on the last days of the range; choose a range in which a promotion ran. | — |
| `theme.promotions.lift.notMeasured` | Chưa đo được hiệu quả của {promotion} trong {days} ngày cuối kỳ. | The lift of {promotion} could not be measured in the last {days} days of the range. | `{promotion}` `{days}` |
| `theme.promotions.lift.subtitle` | {promotion} · {days} ngày cuối kỳ · {definition} | {promotion} · last {days} days of the range · {definition} | `{promotion}` `{days}` `{definition}` |
| `theme.promotions.lift.table` | Từng ngày, ngày khuyến mãi trước | Day by day, promotion days first | — |
| `theme.promotions.lift.title` | Hiệu quả khuyến mãi | Promotion lift | — |
| `theme.promotions.lift.trend` | Đã trừ xu hướng chung {amount} mỗi ngày, đo trên {days} ngày không khuyến mãi. | The general trend of {amount} a day, measured on {days} days without the promotion, is taken out. | `{amount}` `{days}` |
| `theme.promotions.lift.yes` | Có | Yes | — |

### Chọn chương trình và đối chứng · promotion and comparator pickers (`theme.promotions.lift.promotion`, `.option*`, `.comparator*`, `.noControl`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.lift.comparator.baseline` | Cùng thứ các tuần trước | The same weekday in earlier weeks | — |
| `theme.promotions.lift.comparator.prior_weeks` | Các tuần trước chương trình | The weeks before the promotion | — |
| `theme.promotions.lift.comparator.sister_store` | Cửa hàng không chạy chương trình | A store that did not run it | — |
| `theme.promotions.lift.comparatorLabel` | So với | Compared with | — |
| `theme.promotions.lift.noControl` | Mọi cửa hàng đang chọn đều chạy chương trình này nên không có cửa hàng để so sánh. | Every chosen store ran this promotion, so there is no store to compare with. | — |
| `theme.promotions.lift.option` | {name} ({kind}) | {name} ({kind}) | `{name}` `{kind}` |
| `theme.promotions.lift.optionUnnamed` | {kind} không tên | {kind}, unnamed | `{kind}` |
| `theme.promotions.lift.promotion` | Chương trình | Promotion | — |

### Đối chứng của từng cách so · what each comparator compares with (`theme.promotions.lift.definition.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.lift.definition.baseline` | đối chứng: cùng thứ trong {weeks} tuần trước của chính cửa hàng | control: the same weekday in the {weeks} weeks before, at the same stores | `{weeks}` |
| `theme.promotions.lift.definition.prior_weeks` | đối chứng: {weeks} tuần trước ngày khuyến mãi đầu tiên | control: the {weeks} weeks before the first promotion day | `{weeks}` |
| `theme.promotions.lift.definition.sister_store` | đối chứng: cửa hàng không chạy chương trình, so với {weeks} tuần trước của chính nó | control: stores that did not run it, against their own {weeks} weeks before | `{weeks}` |

### Lưu ý của phép đo · lift flags (`theme.promotions.lift.flag.*`, and the advice variants `.flagNoStore.*` and `.flagDaily.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.lift.flag.control_differs_in_size` | Doanh thu của cửa hàng đối chứng chênh hơn gấp đôi cửa hàng chạy chương trình nên phép so sánh kém tin cậy. | The control stores' revenue differs from the promoting stores' by more than a factor of two, so the comparison is less reliable. | — |
| `theme.promotions.lift.flag.excluded_days_in_window` | Có ngày lễ hoặc Tết trong kỳ đo; những ngày đó không dùng làm mốc so sánh. | The measured days include a holiday or Tết; those days are not used as a reference. | — |
| `theme.promotions.lift.flag.few_control_days` | Chưa đủ 7 ngày không khuyến mãi để tách hiệu quả khỏi xu hướng; thử so với cửa hàng không chạy chương trình hoặc chọn khoảng có ngày không khuyến mãi. | There are fewer than 7 days without the promotion to separate its effect from the trend; try comparing with a store that did not run it or choose a range with days without the promotion. | — |
| `theme.promotions.lift.flag.few_promo_days` | Chương trình chạy chưa tới 3 ngày nên kết quả chưa chắc chắn. | The promotion ran on fewer than 3 days, so the result is uncertain. | — |
| `theme.promotions.lift.flag.few_reference_days` | Có ngày khuyến mãi thiếu ngày cùng thứ trước đó để làm mốc nên chưa đo được. | Some promotion days lack earlier days of the same weekday to compare with, so they are not measured. | — |
| `theme.promotions.lift.flag.no_control_store` | Không có cửa hàng nào không chạy chương trình để so sánh; hãy so với các tuần trước chương trình. | No store went without the promotion to compare with; compare with the weeks before the promotion instead. | — |
| `theme.promotions.lift.flag.no_test_store` | Không cửa hàng nào đang chọn dùng chương trình này trong kỳ đo; hãy chọn cửa hàng hoặc khoảng ngày khác. | None of the chosen stores used this promotion in the measured days; choose other stores or another range. | — |
| `theme.promotions.lift.flag.other_promotions` | Trong các ngày khuyến mãi còn có chương trình khác nên phần tăng thêm không chỉ do chương trình này. | Other promotions also ran on the promotion days, so the lift is not due to this promotion alone. | — |
| `theme.promotions.lift.flag.unmeasured_days` | Có ngày khuyến mãi chưa đo được nên không tính vào kết quả. | Some promotion days could not be measured and are left out of the result. | — |
| `theme.promotions.lift.flagDaily.no_control_store` | Không có cửa hàng nào không chạy chương trình để so sánh, và chương trình chạy gần như mỗi ngày nên so với các tuần trước cũng chưa tách được hiệu quả; hãy chọn khoảng ngày có những ngày không chạy chương trình này. | No store went without the promotion to compare with, and it ran almost every day, so the weeks before cannot separate its effect either; choose a range that includes days without this promotion. | — |
| `theme.promotions.lift.flagNoStore.few_control_days` | Chưa đủ 7 ngày không khuyến mãi để tách hiệu quả khỏi xu hướng; hãy chọn khoảng ngày có những ngày không chạy chương trình này. | There are fewer than 7 days without the promotion to separate its effect from the trend; choose a range that includes days without this promotion. | — |

### Thẻ «Danh mục khuyến mãi» (`theme.promotions.catalogue.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.catalogue.active` | Đang bật | On | — |
| `theme.promotions.catalogue.allRecent` | Mọi chương trình đang bật trong danh mục POS đều được dùng trong {days} ngày tính đến {date}. | Every active promotion in the POS catalogue was used in the {days} days up to {date}. | `{days}` `{date}` |
| `theme.promotions.catalogue.caption` | khuyến mãi được dùng trong khoảng ngày | promotions used in the range | — |
| `theme.promotions.catalogue.inactive` | Đã tắt | Off | — |
| `theme.promotions.catalogue.listed` | Có | Yes | — |
| `theme.promotions.catalogue.luckyDraw` | Tên của {matches} có từ thường gặp ở chương trình may rủi. Theo {basis}, chương trình khuyến mại mang tính may rủi phải đăng ký với Sở Công Thương nếu chạy trong một tỉnh, hoặc với Bộ Công Thương nếu chạy ở nhiều tỉnh; Nghị định 239/2026/NĐ-CP được cho là đã thay đổi thủ tục này (cách chứng kiến xác định người trúng thưởng và hồ sơ đăng ký). Đối chiếu với quy định đến ngày {checked}; không thay cho tư vấn pháp lý. | The name of {matches} holds a word common in lucky draws. Under {basis}, a promotion with an element of chance must be registered with the provincial Department of Industry and Trade when it runs in one province, or with the Ministry of Industry and Trade when it runs in several; Decree 239/2026/NĐ-CP is reported to have changed this procedure (how winners are witnessed and the registration dossier). Checked against the rules as of {checked}; not legal advice. | `{matches}` `{basis}` `{checked}` |
| `theme.promotions.catalogue.luckyDrawMatch` | {promotion} (“{keyword}”) | {promotion} (“{keyword}”) | `{promotion}` `{keyword}` |
| `theme.promotions.catalogue.luckyDrawMore` | {first} và {others} chương trình khác | {first} and {others} other promotions | `{first}` `{others}` |
| `theme.promotions.catalogue.luckyDrawPossible` | {promotion} (có thể là “{keyword}”, tên viết không dấu) | {promotion} (possibly “{keyword}”, written without tone marks) | `{promotion}` `{keyword}` |
| `theme.promotions.catalogue.noCatalogue` | Danh mục POS chưa có chương trình khuyến mãi nào đang bật. | The POS catalogue has no active promotion. | — |
| `theme.promotions.catalogue.none` | Không có khuyến mãi nào được dùng trong {range}. | No promotion was used in {range}. | `{range}` |
| `theme.promotions.catalogue.stale` | {count} chương trình đang bật trong danh mục POS không được dùng hơn {days} ngày tính đến {date}; nếu không còn chạy, có thể tắt trên POS cho danh mục gọn hơn. | {count} active promotions in the POS catalogue have not been used for more than {days} days up to {date}; if they no longer run, switching them off in the POS keeps the catalogue tidy. | `{count}` `{days}` `{date}` |
| `theme.promotions.catalogue.table` | Khuyến mãi đã dùng và danh mục POS | Promotions used and the POS catalogue | — |
| `theme.promotions.catalogue.title` | Danh mục khuyến mãi | Promotion catalogue | — |
| `theme.promotions.catalogue.unlisted` | Không | No | — |
| `theme.promotions.catalogue.used` | Trong {range} có {count} khuyến mãi được dùng. | {count} promotions were used in {range}. | `{range}` `{count}` |

### Thẻ «Mức giảm tối đa» (`theme.promotions.ruleCap.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.ruleCap.caption` | giảm giá món hoặc hóa đơn có lần giảm quá {cap} | item or bill discounts with a discount over {cap} | `{cap}` |
| `theme.promotions.ruleCap.concentrated` | Theo {basis}, chương trình khuyến mại tập trung do cơ quan nhà nước tổ chức được giảm đến {rate}; ngày của các chương trình này không có trong dữ liệu nên mọi ngày đều được đối chiếu với mức {cap}. Đối chiếu với quy định đến ngày {checked}; không thay cho tư vấn pháp lý. | Under {basis}, state-run concentrated promotion programmes allow up to {rate} off; their dates are not in the data, so every day is checked against {cap}. Checked against the rules as of {checked}; not legal advice. | `{basis}` `{rate}` `{cap}` `{checked}` |
| `theme.promotions.ruleCap.freeInvoice` | Hóa đơn miễn phí | Free invoice | — |
| `theme.promotions.ruleCap.freeInvoices` | {count} hóa đơn miễn phí (giảm toàn bộ hóa đơn) trong {dates} được tính riêng, không tính là vượt mức; thường là mời khách hoặc nhân viên, hãy kiểm tra lại với thể lệ chương trình. | {count} free invoices (the whole invoice off) in {dates} are counted apart, not as over the cap; they are usually on the house for guests or staff, so check them against the programme's rules. | `{count}` `{dates}` |
| `theme.promotions.ruleCap.gift` | Món tặng | Gift | — |
| `theme.promotions.ruleCap.gifts` | {rows} dòng món tặng (giảm toàn bộ giá món) trong {dates} được tính riêng, không tính là vượt mức; hãy đối chiếu với thể lệ chương trình. | {rows} gift lines (the whole item price off) in {dates} are counted apart, not as over the cap; check them against the programme's rules. | `{rows}` `{dates}` |
| `theme.promotions.ruleCap.giftsAndFree` | {rows} dòng món tặng (giảm toàn bộ giá món) trong {giftDates} và {count} hóa đơn miễn phí (giảm toàn bộ hóa đơn) trong {freeDates} được tính riêng, không tính là vượt mức; hóa đơn miễn phí thường là mời khách hoặc nhân viên, hãy đối chiếu cả hai với thể lệ chương trình. | {rows} gift lines (the whole item price off) in {giftDates} and {count} free invoices (the whole invoice off) in {freeDates} are counted apart, not as over the cap; free invoices are usually on the house for guests or staff, so check both against the programme's rules. | `{rows}` `{giftDates}` `{count}` `{freeDates}` |
| `theme.promotions.ruleCap.invoiceTotal` | Cả hóa đơn (gồm voucher) | Whole invoice (vouchers included) | — |
| `theme.promotions.ruleCap.noDiscount` | Không có giảm giá nào trong {range} để đối chiếu. | There was no discount in {range} to check. | `{range}` |
| `theme.promotions.ruleCap.noRule` | Không có mức giảm tối đa nào áp dụng cho {range}. | No maximum discount applies to {range}. | `{range}` |
| `theme.promotions.ruleCap.none` | Không có giảm giá món hay giảm giá hóa đơn nào quá {cap} trong {range}. | No item or bill discount took more than {cap} off in {range}. | `{cap}` `{range}` |
| `theme.promotions.ruleCap.over` | {count} chương trình giảm giá món hoặc hóa đơn có lần giảm quá {cap} trong {range}, cao nhất {rate}. | {count} item or bill discounts took more than {cap} off at least once in {range}, up to {rate}. | `{count}` `{cap}` `{range}` `{rate}` |
| `theme.promotions.ruleCap.overInvoices` | Không chương trình giảm giá món hay hóa đơn nào giảm quá {cap} trong {range}, nhưng {invoices} hóa đơn có tổng mức giảm quá {cap}, cao nhất {rate}. | No item or bill discount took more than {cap} off in {range}, but {invoices} invoices had more than {cap} off in total, up to {rate}. | `{cap}` `{range}` `{invoices}` `{rate}` |
| `theme.promotions.ruleCap.subtitle` | Tối đa {cap} giá ngay trước khuyến mãi ({basis}); đối chiếu với quy định đến ngày {checked}, không thay cho tư vấn pháp lý. | At most {cap} of the price just before the promotion ({basis}); checked against the rules as of {checked}, not legal advice. | `{cap}` `{basis}` `{checked}` |
| `theme.promotions.ruleCap.table` | Giảm giá món và hóa đơn, cả hóa đơn ở dòng cuối | Item and bill discounts, whole invoices last | — |
| `theme.promotions.ruleCap.title` | Mức giảm tối đa | Maximum discount | — |
| `theme.promotions.ruleCap.voucherTable` | Voucher, ghi riêng ngoài mức giảm tối đa | Vouchers, listed apart from the maximum discount | — |
| `theme.promotions.ruleCap.vouchers` | Voucher được ghi riêng, không tính vào mức giảm này: {count} lần dùng voucher trừ hơn {cap} giá trị còn lại của hóa đơn trong {dates}; voucher là hình thức khuyến mại khác, hãy đối chiếu với thể lệ chương trình. | Vouchers are listed apart and not counted against this cap: {count} voucher uses took more than {cap} off the rest of the invoice in {dates}; a voucher is another form of promotion, so check them against the programme's rules. | `{count}` `{cap}` `{dates}` |

### Thẻ «Số ngày giảm giá bán trong năm» (`theme.promotions.ruleDays.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.ruleDays.basis` | Chỉ đếm ngày giảm giá bán, trên dòng món hoặc qua giảm giá hóa đơn; ngày tặng món và ngày dùng voucher là hình thức khuyến mại khác nên được ghi riêng, không cộng vào. | Only price-discount days count, on the item line or through a bill discount; gift days and voucher days are other forms of promotion, so they are shown apart and never added. | — |
| `theme.promotions.ruleDays.caption` | {item} · năm {year} | {item} · {year} | `{item}` `{year}` |
| `theme.promotions.ruleDays.captionInfo` | {item} · năm {year} · chỉ để theo dõi | {item} · {year} · for information only | `{item}` `{year}` |
| `theme.promotions.ruleDays.captionYear` | năm {year} | {year} | `{year}` |
| `theme.promotions.ruleDays.captionYearInfo` | năm {year} · chỉ để theo dõi | {year} · for information only | `{year}` |
| `theme.promotions.ruleDays.limit` | Theo {basis}, mỗi món được giảm giá bán không quá {limit} ngày trong một năm. Đối chiếu với quy định đến ngày {checked}; không thay cho tư vấn pháp lý. | Under {basis}, an item may be sold at a discount on at most {limit} days a year. Checked against the rules as of {checked}; not legal advice. | `{basis}` `{limit}` `{checked}` |
| `theme.promotions.ruleDays.noRule` | Không có giới hạn số ngày giảm giá bán nào áp dụng; số ngày được đếm để theo dõi. | No limit on discount days applies; the days are counted for tracking. | — |
| `theme.promotions.ruleDays.none` | Không món nào được giảm giá bán trong {dates}. | No item was sold at a discount in {dates}. | `{dates}` |
| `theme.promotions.ruleDays.noneOver` | Không món nào có hơn {limit} ngày giảm giá bán trong {dates}, khi giới hạn còn áp dụng. | No item had more than {limit} discount days in {dates}, while the limit applied. | `{limit}` `{dates}` |
| `theme.promotions.ruleDays.over` | {count} món có hơn {limit} ngày giảm giá bán trong {dates}, khi giới hạn còn áp dụng; nhiều nhất là {item} với {days} ngày. | {count} items had more than {limit} discount days in {dates}, while the limit applied; the most was {item} with {days} days. | `{count}` `{limit}` `{dates}` `{item}` `{days}` |
| `theme.promotions.ruleDays.repealed` | Giới hạn {limit} ngày giảm giá bán mỗi món mỗi năm ({basis}) được cho là đã bãi bỏ từ {from} theo Nghị định 239/2026/NĐ-CP; thông tin này còn đang được kiểm tra, nên số ngày vẫn được đếm để theo dõi. Đối chiếu với quy định đến ngày {checked}; không thay cho tư vấn pháp lý. | The limit of {limit} discount days per item a year ({basis}) is reported repealed from {from} by Decree 239/2026/NĐ-CP; this is still being checked, so the days are still counted for tracking. Checked against the rules as of {checked}; not legal advice. | `{limit}` `{basis}` `{from}` `{checked}` |
| `theme.promotions.ruleDays.table` | Món có nhiều ngày giảm giá bán nhất trong năm | Items with the most discount days in the year | — |
| `theme.promotions.ruleDays.title` | Số ngày giảm giá bán trong năm | Discount days in the year | — |

### Căn cứ pháp lý · legal basis of the rule cards (`theme.promotions.rules.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.rules.basisDuring` | {basis} ({dates}) | {basis} ({dates}) | `{basis}` `{dates}` |
| `theme.promotions.rules.basisList` | {first}; {rest} | {first}; {rest} | `{first}` `{rest}` |
| `theme.promotions.rules.basisMany` | {instrument}, Điều {articles} và {last} | {instrument}, Articles {articles} and {last} | `{instrument}` `{articles}` `{last}` |
| `theme.promotions.rules.basisOne` | {instrument}, Điều {article} | {instrument}, Article {article} | `{instrument}` `{article}` |
| `theme.promotions.rules.instrument.circular` | Thông tư {number} | Circular {number} | `{number}` |
| `theme.promotions.rules.instrument.decree` | Nghị định {number} | Decree {number} | `{number}` |

### Tên cột bảng · table columns (`theme.promotions.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.table.aboveCapRows` | Lần trừ hơn mức tối đa | Uses above the maximum | — |
| `theme.promotions.table.active` | Trạng thái trên POS | Status in the POS | — |
| `theme.promotions.table.billDays` | Trong đó qua giảm giá hóa đơn | Of which by a bill discount | — |
| `theme.promotions.table.checkedRows` | Số lần đối chiếu | Checked | — |
| `theme.promotions.table.controlDay` | Ngày đối chứng | Control day | — |
| `theme.promotions.table.counterfactual` | Dự kiến nếu không khuyến mãi | Expected without the promotion | — |
| `theme.promotions.table.daysUsed365` | Số ngày dùng trong 365 ngày | Days used in 365 days | — |
| `theme.promotions.table.discount365` | Giảm giá trong 365 ngày | Discount in 365 days | — |
| `theme.promotions.table.firstAbove` | Trên mức lần đầu | First above the maximum | — |
| `theme.promotions.table.firstFull` | Giảm toàn bộ lần đầu | First full discount | — |
| `theme.promotions.table.firstOver` | Vượt mức lần đầu | First over the cap | — |
| `theme.promotions.table.firstPriceDiscount` | Giảm giá bán lần đầu | First discount day | — |
| `theme.promotions.table.firstUsed` | Dùng lần đầu | First used | — |
| `theme.promotions.table.fullKind` | Giảm toàn bộ | Fully discounted | — |
| `theme.promotions.table.fullRows` | Số lần giảm toàn bộ | Full discounts | — |
| `theme.promotions.table.giftDays` | Ngày tặng món | Gift days | — |
| `theme.promotions.table.gross` | Doanh thu gộp | Gross revenue | — |
| `theme.promotions.table.inCatalogue` | Trong danh mục POS | In the POS catalogue | — |
| `theme.promotions.table.invoiceShare` | Tỷ lệ hóa đơn | Share of invoices | — |
| `theme.promotions.table.lastAbove` | Trên mức lần cuối | Last above the maximum | — |
| `theme.promotions.table.lastFull` | Giảm toàn bộ lần cuối | Last full discount | — |
| `theme.promotions.table.lastOver` | Vượt mức lần cuối | Last over the cap | — |
| `theme.promotions.table.lastPriceDiscount` | Giảm giá bán lần cuối | Last discount day | — |
| `theme.promotions.table.lastUsed` | Dùng lần cuối | Last used | — |
| `theme.promotions.table.lift` | Tăng thêm | Lift | — |
| `theme.promotions.table.lineDays` | Trong đó trên dòng món | Of which on the line | — |
| `theme.promotions.table.maxPartialRate` | Mức giảm một phần cao nhất | Largest partial discount | — |
| `theme.promotions.table.overCapRows` | Lần vượt mức | Over the cap | — |
| `theme.promotions.table.priceDays` | Ngày giảm giá bán | Discount days | — |
| `theme.promotions.table.promotionDay` | Ngày khuyến mãi | Promotion day | — |
| `theme.promotions.table.reference` | Mốc so sánh | Reference | — |
| `theme.promotions.table.voucher` | Voucher | Voucher | — |
| `theme.promotions.table.voucherDays` | Ngày dùng voucher | Voucher days | — |

### Thẻ «Ưu đãi thành viên đã đổi» (`theme.promotions.redemptions.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.promotions.redemptions.chart` | Lượt đổi theo ưu đãi | Redemptions by reward | — |
| `theme.promotions.redemptions.confirmed` | Đã dùng | Used | — |
| `theme.promotions.redemptions.confirmedShare` | Đã dùng / hóa đơn thành viên | Used / member invoices | — |
| `theme.promotions.redemptions.cost` | Chi phí ưu đãi | Reward cost | — |
| `theme.promotions.redemptions.demo` | Chưa có dữ liệu ưu đãi thành viên: bản demo không có chương trình khách hàng thân thiết. | No member reward data: the demo has no loyalty programme. | — |
| `theme.promotions.redemptions.held` | Đang giữ | Held | — |
| `theme.promotions.redemptions.kind` | Loại | Type | — |
| `theme.promotions.redemptions.main` | Trong {range}, khách đổi {redemptions} lượt ưu đãi; {confirmed} lượt đã dùng trên hóa đơn với chi phí {cost}. | In {range}, members redeemed {redemptions} rewards; {confirmed} were used on an invoice, costing {cost}. | `{range}` `{redemptions}` `{confirmed}` `{cost}` |
| `theme.promotions.redemptions.memberInvoices` | Hóa đơn có thành viên | Member invoices | — |
| `theme.promotions.redemptions.noMembers` | Chưa có hóa đơn nào của thành viên được tích điểm trong kỳ. | No member invoice earned in the range. | — |
| `theme.promotions.redemptions.none` | Chưa có lượt đổi ưu đãi nào trong {range}. | No reward was redeemed in {range}. | `{range}` |
| `theme.promotions.redemptions.points` | Điểm đã đổi | Points redeemed | — |
| `theme.promotions.redemptions.redemptions` | Lượt đổi | Redemptions | — |
| `theme.promotions.redemptions.released` | Đã hoàn lại | Given back | — |
| `theme.promotions.redemptions.reward` | Ưu đãi | Reward | — |
| `theme.promotions.redemptions.rewardKind.amount_off` | Giảm một số tiền | Amount off | — |
| `theme.promotions.redemptions.rewardKind.free_item` | Tặng món | Free item | — |
| `theme.promotions.redemptions.rewardKind.free_upgrade` | Lên size hoặc thêm topping | Free upgrade or topping | — |
| `theme.promotions.redemptions.rewardKind.percent_off` | Giảm theo phần trăm | Percentage off | — |
| `theme.promotions.redemptions.share` | Lượt đã dùng bằng {share} số hóa đơn có thành viên tích điểm ({confirmed} trên {invoices} hóa đơn). | Rewards used equal {share} of the invoices that earned for a member ({confirmed} of {invoices} invoices). | `{share}` `{confirmed}` `{invoices}` |
| `theme.promotions.redemptions.stamps` | Dấu đã đổi | Stamps redeemed | — |
| `theme.promotions.redemptions.table` | Lượt đổi theo ưu đãi và cửa hàng | Redemptions by reward and store | — |
| `theme.promotions.redemptions.title` | Ưu đãi thành viên đã đổi | Member rewards redeemed | — |
| `theme.promotions.redemptions.top` | Được đổi nhiều nhất là {reward} ({kind}): {redemptions} lượt. | The most redeemed was {reward} ({kind}): {redemptions} redemptions. | `{reward}` `{kind}` `{redemptions}` |

## Ca & két tiền · Shifts and cash drawer (`theme-shifts.vi.json`, 56 mục)

### Tiêu đề và thông báo chung · title and shared notices (`theme.shifts.title`, `theme.shifts.noData`, `theme.shifts.noShifts`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.noData` | Chưa có ca nào trong {range}. | No shift in {range}. | `{range}` |
| `theme.shifts.noShifts` | Chưa có ca nào; kiểm tra thu ngân có mở và đóng ca trên POS không. | No shift yet; check that cashiers open and close shifts on the POS. | — |
| `theme.shifts.title` | Ca & két tiền | Shifts and cash drawer | — |

### Thẻ «Doanh thu và hóa đơn theo ca» (`theme.shifts.sales.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.sales.average` | Trong {range}, mỗi ca bán trung bình {value}, trên {count} ca. | In {range}, a shift took {value} on average, over {count} shifts. | `{range}` `{value}` `{count}` |
| `theme.shifts.sales.caption` | trung bình mỗi ca, trên {count} ca | average per shift, over {count} shifts | `{count}` |
| `theme.shifts.sales.chart` | Doanh thu thuần của các ca gần nhất | Net revenue of the latest shifts | — |
| `theme.shifts.sales.main` | Trong {range}, mỗi ca bán trung bình {value}; {best} cao nhất ({bestValue} mỗi ca, {bestCount} ca), {worst} thấp nhất ({worstValue} mỗi ca, {worstCount} ca). | In {range}, a shift took {value} on average; {best} took the most ({bestValue} a shift, {bestCount} shifts) and {worst} the least ({worstValue} a shift, {worstCount} shifts). | `{range}` `{value}` `{best}` `{bestValue}` `{bestCount}` `{worst}` `{worstValue}` `{worstCount}` |
| `theme.shifts.sales.series` | Doanh thu thuần | Net revenue | — |
| `theme.shifts.sales.table` | Các ca, mới nhất trước | Shifts, newest first | — |
| `theme.shifts.sales.title` | Doanh thu và hóa đơn theo ca | Sales and invoices per shift | — |

### Thẻ «Chênh lệch két» (`theme.shifts.drawer.*`)

The card's sentences, thresholds line, shift labels and first table are those of Thanh toán's drawer card (`report.shifts.*` in the report sheet, `theme.payments.drawer.*` above); only the title and the table per cashier are its own.

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.drawer.cashierTable` | Lệch két theo thu ngân | Drawer variance by cashier | — |
| `theme.shifts.drawer.title` | Chênh lệch két | Drawer variance | — |

### Thẻ «Hủy, xóa món và sửa sau khi đóng ca» (`theme.shifts.adjustments.*`)

The headline caption "trên {count} ca" and the shift labels "Ca n ngày …" are Thanh toán's (`theme.payments.drawer.caption`, `theme.payments.drawer.shiftOn`, `theme.payments.drawer.shiftOnAt`).

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.adjustments.basis` | So với các ca của chính cửa hàng trong {days} ngày trước, tỷ lệ hủy và xóa món chỉ được đánh dấu khi cao hơn thường lệ; mọi lần sửa sau khi đóng ca đều được đánh dấu. Điểm z so một ca với các ca trước, không phải kết luận về một người. | Against the store's own shifts of the {days} days before, void and removed-line rates are flagged only when higher than usual; every edit after the close is flagged. A z-score compares a shift with earlier shifts and is not a judgement of a person. | `{days}` |
| `theme.shifts.adjustments.chart` | Điểm z cao hơn của các ca được đánh dấu | Higher z-score of the flagged shifts | — |
| `theme.shifts.adjustments.main` | {count} ca đáng xem lại; đứng đầu là {shift} ({cashier}): {reasons}. | {count} shifts are worth a second look; first is {shift} ({cashier}): {reasons}. | `{count}` `{shift}` `{cashier}` `{reasons}` |
| `theme.shifts.adjustments.none` | Trong {measured} ca so được với các ca trước, không ca nào hủy hay xóa món nhiều hơn thường lệ; trong cả {count} ca, không ca nào bị sửa sau khi đóng ca. | Of the {measured} shifts that could be compared with earlier shifts, none had more voids or removed lines than usual; of all {count} shifts, none was edited after its close. | `{measured}` `{count}` |
| `theme.shifts.adjustments.series` | Điểm z cao hơn | Higher z-score | — |
| `theme.shifts.adjustments.table` | Các ca, điểm z cao nhất trước | Shifts, highest z-score first | — |
| `theme.shifts.adjustments.threshold` | Ngưỡng z | z threshold | — |
| `theme.shifts.adjustments.title` | Hủy, xóa món và sửa sau khi đóng ca | Voids, removed lines and edits after close | — |
| `theme.shifts.adjustments.unmeasured` | Chưa so được ca nào trong {count} ca với các ca trước nên chưa biết ca nào hủy hay xóa món nhiều hơn thường lệ; không ca nào bị sửa sau khi đóng ca. | None of the {count} shifts could be compared with earlier shifts yet, so it is not known whether any had more voids or removed lines than usual; none was edited after its close. | `{count}` |
| `theme.shifts.adjustments.unscored` | Điểm z hiện dấu — khi ca chưa có đủ {count} ca trước đó của cửa hàng, hoặc khi các ca trước có cùng một tỷ lệ (chẳng hạn chưa từng xóa món) nên chưa có gì để so. | A z-score shows — when a shift has fewer than {count} earlier shifts of the store, or when the earlier shifts all have the same rate (for instance no removed line at all), so there is nothing to compare with. | `{count}` |

### Thẻ «Theo thu ngân» (`theme.shifts.cashiers.*`)

The table's column names are the shared ones of `theme.shifts.table.*` below and the report sheet's "Thu ngân" and "Doanh thu thuần"; a cashier entered as an e-mail address, or left empty, reads "chưa rõ thu ngân" (`report.label.unknownCashier`). "Ca lệch két vượt ngưỡng" (`theme.shifts.table.flagged`) heads the same column in this card and in the drawer card's table per cashier.

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.cashiers.caption` | ca lệch két vượt ngưỡng, nhiều nhất trong {count} thu ngân | shifts over the drawer thresholds, the most of {count} cashiers | `{count}` |
| `theme.shifts.cashiers.caution` | Điểm z so một ca với các ca trước của cửa hàng; số liệu theo thu ngân là gợi ý để xem lại, không phải kết luận về một người. | A z-score compares a shift with the store's earlier shifts; figures per cashier are a prompt to look again, not a conclusion about a person. | — |
| `theme.shifts.cashiers.displayNames` | Đặt tên hiển thị cho từng tài khoản thu ngân trong POS để xem số liệu theo từng người. | Give each cashier login a display name in the POS to see figures per cashier. | — |
| `theme.shifts.cashiers.logins` | Muốn xem số liệu theo từng thu ngân, mỗi thu ngân cần đăng nhập POS bằng tài khoản riêng. | For figures per cashier, each cashier needs their own POS login. | — |
| `theme.shifts.cashiers.main` | Thu ngân có nhiều ca lệch két vượt ngưỡng nhất là {cashier}: {flagged} trên {shifts} ca. | The cashier with the most shifts over the drawer thresholds is {cashier}: {flagged} of {shifts} shifts. | `{cashier}` `{flagged}` `{shifts}` |
| `theme.shifts.cashiers.none` | Trong {range}, không ca nào của {count} thu ngân lệch két vượt ngưỡng. | In {range}, no shift of the {count} cashiers went over the drawer thresholds. | `{range}` `{count}` |
| `theme.shifts.cashiers.single` | Trong {range}, cả {count} ca đều ghi cùng một tài khoản thu ngân nên chưa so được giữa các thu ngân. | In {range}, all {count} shifts carry the same cashier login, so cashiers cannot be compared. | `{range}` `{count}` |
| `theme.shifts.cashiers.singlePerStore` | Trong {range}, mỗi cửa hàng ghi mọi ca dưới một tài khoản thu ngân duy nhất ({count} ca) nên chưa so được giữa các thu ngân. | In {range}, each store carries all its shifts under a single cashier login ({count} shifts), so cashiers cannot be compared. | `{range}` `{count}` |
| `theme.shifts.cashiers.table` | Các thu ngân, nhiều ca lệch két vượt ngưỡng nhất trước | Cashiers, most shifts over the drawer thresholds first | — |
| `theme.shifts.cashiers.tied` | Nhiều thu ngân cùng có nhiều ca lệch két vượt ngưỡng nhất, mỗi thu ngân {flagged} ca. | Several cashiers share the most shifts over the drawer thresholds, {flagged} each. | `{flagged}` |
| `theme.shifts.cashiers.title` | Theo thu ngân | By cashier | — |
| `theme.shifts.cashiers.unnamed` | {count} ca chưa rõ thu ngân nằm trong bảng nhưng không được xếp hạng. | {count} shifts with an unknown cashier are in the table but not ranked. | `{count}` |
| `theme.shifts.cashiers.unnamedAll` | Trong {range}, thu ngân của cả {count} ca đều không có tên hiển thị (để trống hoặc là địa chỉ e-mail) nên chưa phân biệt được từng người. | In {range}, the cashiers of all {count} shifts have no display name (empty or an e-mail address), so they cannot be told apart. | `{range}` `{count}` |

### Lý do đánh dấu ca · reasons a shift is flagged (`theme.shifts.reasons.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.reasons.after_close` | có sửa sau khi đóng ca | edited after the close | — |
| `theme.shifts.reasons.removed_lines` | xóa món nhiều hơn thường lệ | more removed lines than usual | — |
| `theme.shifts.reasons.removed_lines_after_close` | xóa món nhiều hơn thường lệ và có sửa sau khi đóng ca | more removed lines than usual and edited after the close | — |
| `theme.shifts.reasons.voids` | hủy nhiều hơn thường lệ | more voids than usual | — |
| `theme.shifts.reasons.voids_after_close` | hủy nhiều hơn thường lệ và có sửa sau khi đóng ca | more voids than usual and edited after the close | — |
| `theme.shifts.reasons.voids_removed_lines` | hủy và xóa món nhiều hơn thường lệ | more voids and removed lines than usual | — |
| `theme.shifts.reasons.voids_removed_lines_after_close` | hủy và xóa món nhiều hơn thường lệ, có sửa sau khi đóng ca | more voids and removed lines than usual, and edited after the close | — |

### Tên cột bảng · table columns (`theme.shifts.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.shifts.table.edits` | Số lần sửa | Edits | — |
| `theme.shifts.table.editsAfterClose` | Sửa sau khi đóng ca | Edits after close | — |
| `theme.shifts.table.flagged` | Ca lệch két vượt ngưỡng | Over the drawer thresholds | — |
| `theme.shifts.table.largestOverage` | Thừa nhiều nhất | Largest overage | — |
| `theme.shifts.table.largestShortage` | Thiếu nhiều nhất | Largest shortage | — |
| `theme.shifts.table.meanVariance` | Lệch két TB mỗi ca (tuyệt đối) | Mean variance per shift (absolute) | — |
| `theme.shifts.table.removedLines` | Món bị xóa | Removed lines | — |
| `theme.shifts.table.removedRate` | Tỷ lệ xóa món | Removed-line rate | — |
| `theme.shifts.table.removedZ` | Điểm z xóa món | Removed-line z-score | — |
| `theme.shifts.table.shifts` | Số ca | Shifts | — |
| `theme.shifts.table.totalVariance` | Tổng lệch két (tuyệt đối) | Total drawer variance (absolute) | — |
| `theme.shifts.table.voidRate` | Tỷ lệ hủy | Void rate | — |
| `theme.shifts.table.voidZ` | Điểm z hủy | Void z-score | — |
| `theme.shifts.table.voids` | Số lần hủy | Voids | — |

## So sánh cửa hàng · Store comparison (`theme-stores.vi.json`, 53 mục)

### Tiêu đề · title (`theme.stores.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.title` | So sánh cửa hàng | Store comparison | — |

### Dùng chung trong chủ đề · shared by the cards (`theme.stores.needTwo`, `theme.stores.storeSeries`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.needTwo` | Chọn ít nhất hai cửa hàng để so sánh. | Choose at least two stores to compare. | — |
| `theme.stores.storeSeries` | {store} | {store} | `{store}` |

### Thẻ «Chỉ số theo cửa hàng» (`theme.stores.kpis.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.kpis.allStores` | Tất cả cửa hàng | All stores | — |
| `theme.stores.kpis.allStoresLikeForLike` | Tất cả cửa hàng (so với kỳ trước: cùng cửa hàng) | All stores (change: same stores) | — |
| `theme.stores.kpis.caption` | {store} dẫn đầu doanh thu thuần | {store} leads on net revenue | `{store}` |
| `theme.stores.kpis.chart` | Doanh thu thuần theo cửa hàng, kỳ trước và kỳ này | Net revenue by store, previous period and this one | — |
| `theme.stores.kpis.items` | Số món mỗi hóa đơn ở {high} cao hơn {low} {gap}. | Items per ticket at {high} are {gap} above {low}. | `{high}` `{low}` `{gap}` |
| `theme.stores.kpis.itemsEven` | Số món mỗi hóa đơn ở các cửa hàng gần như bằng nhau. | Items per ticket are about the same at every store. | — |
| `theme.stores.kpis.likeForLike` | Dòng Tất cả cửa hàng so với kỳ trước chỉ tính cùng cửa hàng ({covered}/{total}): những cửa hàng đã có số liệu từ đầu kỳ trước. | The all-stores change against the previous period counts the same stores only ({covered}/{total}): those with data from the start of the previous period. | `{covered}` `{total}` |
| `theme.stores.kpis.main` | Trong {range}, giá trị trung bình mỗi hóa đơn ở {high} cao hơn {low} {gap}. | In {range}, the average ticket at {high} is {gap} above {low}. | `{range}` `{high}` `{low}` `{gap}` |
| `theme.stores.kpis.mainEven` | Trong {range}, giá trị trung bình mỗi hóa đơn ở các cửa hàng gần như bằng nhau. | In {range}, the average ticket is about the same at every store. | `{range}` |
| `theme.stores.kpis.noData` | Chưa có doanh thu nào trong {range}. | No sales in {range}. | `{range}` |
| `theme.stores.kpis.noGap` | Trong {range}, chưa có hai cửa hàng cùng có hóa đơn để so sánh. | In {range}, fewer than two stores have invoices to compare. | `{range}` |
| `theme.stores.kpis.notConfiguredNotice` | Nhập giờ mở cửa và số ghế của từng cửa hàng để so sánh doanh thu mỗi giờ mở cửa và mỗi ghế. | Enter each store's opening hours and seats to compare revenue per opening hour and per seat. | — |
| `theme.stores.kpis.table` | Chỉ số của từng cửa hàng và của tất cả cửa hàng | Figures of each store and of all stores | — |
| `theme.stores.kpis.title` | Chỉ số theo cửa hàng | Figures by store | — |

### Thẻ «Cùng ngày, so sánh dáng» (`theme.stores.sameDay.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.sameDay.average` | Mức trung bình của cửa hàng | The store's average | — |
| `theme.stores.sameDay.caption` | chênh lệch chỉ số giữa các cửa hàng, lớn nhất {bucket} | gap between the stores' indices, widest {bucket} | `{bucket}` |
| `theme.stores.sameDay.chart` | Chỉ số của từng cửa hàng (1 là mức trung bình của cửa hàng đó) | Each store's index (1 is that store's average) | — |
| `theme.stores.sameDay.dayBucket` | ngày {date} | on {date} | `{date}` |
| `theme.stores.sameDay.main` | Các cửa hàng lệch nhau nhiều nhất {bucket}: {high} bán bằng {highIndex} lần mức trung bình của mình, {low} bằng {lowIndex} lần. | The stores were furthest apart {bucket}: {high} sold {highIndex} times its own average, {low} {lowIndex} times. | `{bucket}` `{high}` `{highIndex}` `{low}` `{lowIndex}` |
| `theme.stores.sameDay.monthBucket` | tháng {month} | in {month} | `{month}` |
| `theme.stores.sameDay.noData` | Chưa có doanh thu nào trong {range}. | No sales in {range}. | `{range}` |
| `theme.stores.sameDay.noOverlap` | Trong {range}, chưa có lúc nào hai cửa hàng cùng có doanh thu để so sánh. | In {range}, no two stores have sales at the same time to compare. | `{range}` |
| `theme.stores.sameDay.table` | Doanh thu và chỉ số so với mức trung bình của từng cửa hàng | Net revenue and index against each store's own average | — |
| `theme.stores.sameDay.title` | Cùng ngày, so sánh dáng | Same days, shape compared | — |
| `theme.stores.sameDay.weekBucket` | tuần từ {date} | in the week from {date} | `{date}` |

### Thẻ «Từ ngày khai trương» (`theme.stores.sinceOpening.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.sinceOpening.caption` | tuần thứ {week} của {store} | week {week} at {store} | `{week}` `{store}` |
| `theme.stores.sinceOpening.chart` | Doanh thu trung bình mỗi ngày, tuần thứ k sau khai trương | Average daily net revenue in week k after opening | — |
| `theme.stores.sinceOpening.main` | Tuần thứ {week} sau khai trương: {store} đạt {share} so với {other} cùng tuần. | Week {week} after opening: {store} reached {share} of {other} in the same week. | `{week}` `{store}` `{share}` `{other}` |
| `theme.stores.sinceOpening.noData` | Chưa cửa hàng nào đủ một tuần trọn vẹn kể từ khai trương. | No store has a complete week since opening yet. | — |
| `theme.stores.sinceOpening.single` | Tuần thứ {week} sau khai trương, {store} bán trung bình {value} mỗi ngày. | In week {week} after opening, {store} sold {value} a day on average. | `{week}` `{store}` `{value}` |
| `theme.stores.sinceOpening.subtitle` | {weeks} tuần đầu sau khai trương của mỗi cửa hàng | each store's first {weeks} weeks after opening | `{weeks}` |
| `theme.stores.sinceOpening.table` | Doanh thu trung bình mỗi ngày theo tuần kể từ khai trương | Average daily net revenue by week since opening | — |
| `theme.stores.sinceOpening.tetSkipped` | Các tuần sau tuần thứ {week} có ngày Tết ở một trong hai cửa hàng nên không dùng để so sánh. | The weeks after week {week} hold Tết days at one of the two stores, so they are not used for the comparison. | `{week}` |
| `theme.stores.sinceOpening.tetWeek` | có ngày Tết | has Tết days | — |
| `theme.stores.sinceOpening.title` | Từ ngày khai trương | Since opening | — |
| `theme.stores.sinceOpening.tooYoung` | {store} có số liệu từ {date}, chưa đủ một tuần trọn vẹn nên để trống. | {store} has data from {date} only, less than a complete week, so it is left blank. | `{store}` `{date}` |
| `theme.stores.sinceOpening.tooYoungMany` | {stores} chưa đủ một tuần trọn vẹn kể từ khi có số liệu nên để trống. | {stores} have less than a complete week of data, so they are left blank. | `{stores}` |

### Tên cột bảng · table columns (`theme.stores.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.stores.table.avgPerDay` | TB mỗi ngày | Average per day | — |
| `theme.stores.table.cashShare` | Tỷ trọng tiền mặt | Cash share | — |
| `theme.stores.table.daysWithData` | Ngày có bán | Days with sales | — |
| `theme.stores.table.discountRate` | Tỷ lệ giảm giá | Discount rate | — |
| `theme.stores.table.index` | Chỉ số so với trung bình | Index against the average | — |
| `theme.stores.table.netChange` | Doanh thu so với kỳ trước | Net revenue against the previous period | — |
| `theme.stores.table.revpash` | Doanh thu mỗi ghế mỗi giờ | Revenue per seat-hour | — |
| `theme.stores.table.salesPerHour` | Doanh thu mỗi giờ mở cửa | Revenue per opening hour | — |
| `theme.stores.table.tet` | Tết | Tết | — |
| `theme.stores.table.ticketChange` | TB mỗi hóa đơn so với kỳ trước | Average ticket against the previous period | — |
| `theme.stores.table.voucherShare` | Hóa đơn dùng voucher | Invoices with a voucher | — |
| `theme.stores.table.week` | Tuần thứ | Week | — |
| `theme.stores.table.weekFrom` | Tuần từ | Week from | — |

## Chất lượng dữ liệu · Data quality (`theme-quality.vi.json`, 129 mục)

### Tiêu đề · title (`theme.quality.title`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.title` | Chất lượng dữ liệu | Data quality | — |

### Thẻ «Hóa đơn điện tử, đánh số hóa đơn và hồ sơ cửa hàng» (`theme.quality.compliance.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.compliance.eInvoice` | Hóa đơn điện tử chưa ở trạng thái Đã đăng ký tại {count} cửa hàng. | E-invoices are not recorded as Registered at {count} stores. | `{count}` |
| `theme.quality.compliance.eInvoiceNotice` | Sửa trong POS: đăng ký hóa đơn điện tử khởi tạo từ máy tính tiền (bắt buộc với hộ kinh doanh ăn uống có doanh thu từ 1 tỷ đồng mỗi năm), rồi ghi trạng thái trong ứng dụng. | Fix in the POS: register cash-register e-invoices (required for food and drink household businesses with revenue of 1 billion VND a year or more), then record the status in the app. | — |
| `theme.quality.compliance.findingsTable` | Việc cần làm theo cửa hàng | To do by store | — |
| `theme.quality.compliance.main` | {count} trên {total} cửa hàng còn việc cần làm về hóa đơn điện tử, đánh số hóa đơn hoặc hồ sơ cửa hàng. | {count} of {total} stores have something to do about e-invoices, receipt numbering or the store profile. | `{count}` `{total}` |
| `theme.quality.compliance.memberNotice` | Sửa trong POS: bật tính năng thành viên ở cửa hàng đang tắt, rồi ghi lại trạng thái và các mục còn thiếu trong hồ sơ cửa hàng. | Fix in the POS: switch the member feature on where it is off, then record its status and anything else missing in the store profile. | — |
| `theme.quality.compliance.none` | Mọi cửa hàng đã ghi đủ hóa đơn điện tử, đánh số hóa đơn và hồ sơ. | Every store has its e-invoices, receipt numbering and profile recorded. | — |
| `theme.quality.compliance.storeNotice` | Ghi những mục còn thiếu trong hồ sơ cửa hàng. | Record what is missing in the store profile. | — |
| `theme.quality.compliance.storesTable` | Hồ sơ cửa hàng | Store profile | — |
| `theme.quality.compliance.title` | Hóa đơn điện tử, đánh số hóa đơn và hồ sơ cửa hàng | E-invoices, receipt numbering and store profile | — |

### Thẻ «Món chưa có nhóm, nhóm chưa có vai trò» (`theme.quality.uncategorised.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.uncategorised.bothNotice` | Sửa trong POS: gán nhóm cho món, hoặc chọn nhóm ngay trong ứng dụng; rồi gán vai trò cho nhóm món chưa có. | Fix in the POS: give the items a category, or choose it here in the app; then give a role to the categories without one. | — |
| `theme.quality.uncategorised.itemsNotice` | Sửa trong POS: gán nhóm cho món; hoặc chọn nhóm cho món ngay trong ứng dụng. | Fix in the POS: give the item a category; or choose its category here in the app. | — |
| `theme.quality.uncategorised.itemsTable` | Món chưa có nhóm | Items without a category | — |
| `theme.quality.uncategorised.main` | {count} món bán trong {range} chưa có nhóm, chiếm {share} doanh thu món. | {count} items sold in {range} have no category, {share} of item revenue. | `{count}` `{range}` `{share}` |
| `theme.quality.uncategorised.noData` | Chưa có món nào được bán trong {range}. | No item was sold in {range}. | `{range}` |
| `theme.quality.uncategorised.none` | Mọi món bán trong {range} đều đã có nhóm. | Every item sold in {range} has a category. | `{range}` |
| `theme.quality.uncategorised.roles` | {count} nhóm món có bán chưa có vai trò, chiếm {share} doanh thu món. | {count} item categories with sales have no role, {share} of item revenue. | `{count}` `{share}` |
| `theme.quality.uncategorised.rolesNone` | Mọi nhóm món có bán đều đã có vai trò. | Every item category with sales has a role. | — |
| `theme.quality.uncategorised.rolesNotice` | Gán vai trò cho nhóm món để tính được tỷ lệ kèm topping và đồ ăn nhẹ. | Give the categories a role so that the topping and snack attach rates can be worked out. | — |
| `theme.quality.uncategorised.title` | Món chưa có nhóm, nhóm chưa có vai trò | Items without a category, categories without a role | — |
| `theme.quality.uncategorised.typesTable` | Nhóm món chưa có vai trò | Item categories without a role | — |

### Thẻ «Món chưa có giá vốn» (`theme.quality.costs.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.costs.coverage` | Doanh thu món của các ngày đã có giá vốn chiếm {coverage} doanh thu món trong {range}. | Item revenue of the days that had a cost is {coverage} of item revenue in {range}. | `{coverage}` `{range}` |
| `theme.quality.costs.main` | Đến ngày cuối kỳ, {count} món đã bán vẫn chưa có giá vốn, chiếm {share} doanh thu món. | On the last day of the range, {count} items sold still have no cost, {share} of item revenue. | `{count}` `{share}` |
| `theme.quality.costs.noData` | Chưa có món nào được bán trong {range}. | No item was sold in {range}. | `{range}` |
| `theme.quality.costs.none` | Đến ngày cuối kỳ, mọi món đã bán đều có giá vốn. | On the last day of the range, every item sold has a cost. | — |
| `theme.quality.costs.notice` | Biên lợi nhuận chỉ tính trên doanh thu của các ngày đã có giá vốn; nhập giá vốn còn thiếu, kèm ngày bắt đầu áp dụng. | Margins count only the revenue of the days that had a cost; enter the missing costs with the date they apply from. | — |
| `theme.quality.costs.table` | Các món doanh thu cao nhất chưa có giá vốn (tối đa 20) | Best-selling items without a cost (at most 20) | — |
| `theme.quality.costs.title` | Món chưa có giá vốn | Items without a cost | — |

### Thẻ «Ngày chưa đối soát» (`theme.quality.verification.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.verification.main` | Trong {range} còn {count} ngày bán chưa đối soát, tính riêng từng cửa hàng: {notMatched} ngày chưa khớp với POS, {notChecked} ngày chưa kiểm tra. | {range} has {count} store-days not verified yet: {notMatched} do not match the POS, {notChecked} are not checked. | `{range}` `{count}` `{notMatched}` `{notChecked}` |
| `theme.quality.verification.noData` | Chưa có ngày bán nào trong {range}. | No day with sales in {range}. | `{range}` |
| `theme.quality.verification.none` | Mọi ngày bán trong {range} đều đã đối soát. | Every day with sales in {range} is verified. | `{range}` |
| `theme.quality.verification.notice` | Chạy lại đồng bộ cho từng ngày còn lại (fnb sync window, ngày bắt đầu và ngày kết thúc đều là ngày đó); ngày ấy sẽ được đối soát lại. | Run the sync again for each remaining day (fnb sync window, with that day as both start and end); the day is then verified again. | — |
| `theme.quality.verification.table` | Ngày chưa đối soát theo cửa hàng | Unverified days by store | — |
| `theme.quality.verification.title` | Ngày chưa đối soát | Days not verified | — |
| `theme.quality.verification.updating` | Số liệu của {count} ngày đang cập nhật. | The figures of {count} days are being updated. | `{count}` |

### Thẻ «Phương thức thanh toán chưa phân loại» (`theme.quality.payments.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.payments.main` | {count} phương thức dùng trong {range} đang tính là Khác, chiếm {share} số tiền thanh toán. | {count} methods used in {range} count as Other, {share} of the money paid. | `{count}` `{range}` `{share}` |
| `theme.quality.payments.noData` | Chưa có thanh toán nào trong {range}. | No payment in {range}. | `{range}` |
| `theme.quality.payments.none` | Mọi phương thức dùng trong {range} đều đã có loại. | Every method used in {range} has a kind. | `{range}` |
| `theme.quality.payments.notInCatalogue` | {count} phương thức chưa có trong danh mục POS đã đồng bộ. | {count} methods are missing from the synced POS catalogue. | `{count}` |
| `theme.quality.payments.notice` | Chọn loại cho các phương thức đang tính là Khác để Thanh toán & tiền mặt chia đúng. | Choose a kind for the methods counted as Other so that Payments and cash splits them correctly. | — |
| `theme.quality.payments.table` | Phương thức cần phân loại hoặc đồng bộ lại | Methods to classify or sync again | — |
| `theme.quality.payments.title` | Phương thức thanh toán chưa phân loại | Payment methods without a kind | — |

### Thẻ «Dòng tùy chọn (đường, đá, topping miễn phí)» (`theme.quality.modifiers.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.modifiers.catalogue` | {count} dòng là tùy chọn trong danh mục nhưng được bán như món. | {count} lines are catalogue modifiers sold as items. | `{count}` |
| `theme.quality.modifiers.catalogueNone` | Không có tùy chọn nào trong danh mục được bán như món. | No catalogue modifier was sold as an item. | — |
| `theme.quality.modifiers.main` | Dòng tùy chọn chiếm {share} số dòng bán trong {range}; dòng tùy chọn không bao giờ được tính là món. | Modifier lines are {share} of the lines sold in {range}; a modifier line never counts as an item. | `{share}` `{range}` |
| `theme.quality.modifiers.noData` | Chưa có dòng bán nào trong {range}. | No line was sold in {range}. | `{range}` |
| `theme.quality.modifiers.table` | Dòng món và dòng tùy chọn theo cửa hàng | Item and modifier lines by store | — |
| `theme.quality.modifiers.title` | Dòng tùy chọn (đường, đá, topping miễn phí) | Modifier lines (sugar, ice, free toppings) | — |

### Thẻ «Định danh khách và đồng ý» (`theme.quality.customers.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.customers.coverage` | {coverage} trong {customers} khách của danh sách khách hàng mua trong kỳ đã đồng ý tích điểm. | {coverage} of the {customers} customers of the customer list who bought in the range agreed to loyalty. | `{coverage}` `{customers}` |
| `theme.quality.customers.featureNotice` | Sửa trong POS: bật tính năng thành viên ở cửa hàng đang tắt, rồi nhắc thu ngân dùng bước Thêm khách hàng khi thanh toán. | Fix in the POS: switch the member feature on where it is off, then remind cashiers to use the Add customer step at payment. | — |
| `theme.quality.customers.main` | {rate} hóa đơn trong {range} có số điện thoại hoặc mã khách. | {rate} of the invoices in {range} carry a phone number or a customer id. | `{rate}` `{range}` |
| `theme.quality.customers.noData` | Chưa có hóa đơn nào trong {range}. | No invoice in {range}. | `{range}` |
| `theme.quality.customers.noIdentified` | Chưa hóa đơn nào gắn với khách trong danh sách khách hàng (hóa đơn mới chỉ có số điện thoại), nên chưa tính được tỷ lệ đồng ý. | No invoice is linked to a customer of the customer list yet (the invoices carry phone numbers only), so consent coverage cannot be worked out. | — |
| `theme.quality.customers.notice` | Sửa trong POS: nhắc thu ngân dùng bước Thêm khách hàng khi thanh toán. | Fix in the POS: remind cashiers to use the Add customer step at payment. | — |
| `theme.quality.customers.table` | Định danh khách theo cửa hàng (chỉ có số đếm) | Customer identity by store (counts only) | — |
| `theme.quality.customers.title` | Định danh khách và đồng ý | Customer identity and consent | — |

### Cách sửa · how to fix (`theme.quality.fix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.fix.pos.category` | Sửa trong POS: gán nhóm cho món, hoặc chọn nhóm ở Cài đặt → Phân loại | Fix in the POS: give the item a category, or choose one in Settings → Classification | — |
| `theme.quality.fix.pos.eInvoice` | Sửa trong POS: đăng ký hóa đơn điện tử khởi tạo từ máy tính tiền, rồi ghi trạng thái ở Cài đặt → Cửa hàng | Fix in the POS: register cash-register e-invoices, then record the status in Settings → Stores | — |
| `theme.quality.fix.pos.member` | Sửa trong POS: dùng Thêm khách hàng khi thanh toán | Fix in the POS: use Add customer at payment | — |
| `theme.quality.fix.pos.memberFeature` | Sửa trong POS: bật tính năng thành viên | Fix in the POS: switch the member feature on | — |
| `theme.quality.fix.pos.memberFeatureRecord` | Sửa trong POS: bật tính năng thành viên, rồi ghi lại ở Cài đặt → Cửa hàng | Fix in the POS: switch the member feature on, then record it in Settings → Stores | — |
| `theme.quality.fix.pos.modifier` | Sửa trong POS: bán tùy chọn kèm món, không bán như một món riêng | Fix in the POS: sell the modifier with an item, not as an item of its own | — |
| `theme.quality.fix.settings.cost` | Nhập giá vốn ở Cài đặt → Dữ liệu nhập tay → Giá vốn | Enter the cost in Settings → Manual data → Costs | — |
| `theme.quality.fix.settings.eInvoice` | Kiểm tra trong POS, rồi ghi trạng thái ở Cài đặt → Cửa hàng | Check in the POS, then record the status in Settings → Stores | — |
| `theme.quality.fix.settings.hours` | Nhập giờ mở cửa ở Cài đặt → Cửa hàng | Enter the opening hours in Settings → Stores | — |
| `theme.quality.fix.settings.openedOn` | Nhập ngày khai trương ở Cài đặt → Cửa hàng | Enter the opening date in Settings → Stores | — |
| `theme.quality.fix.settings.paymentKind` | Chọn loại ở Cài đặt → Phân loại → Loại thanh toán | Choose the kind in Settings → Classification → Payment kinds | — |
| `theme.quality.fix.settings.receipts` | Ghi cách đánh số hóa đơn ở Cài đặt → Cửa hàng | Record the receipt numbering in Settings → Stores | — |
| `theme.quality.fix.settings.role` | Gán vai trò ở Cài đặt → Phân loại → Vai trò nhóm món | Assign a role in Settings → Classification → Item-type roles | — |
| `theme.quality.fix.settings.seats` | Nhập số ghế ở Cài đặt → Cửa hàng | Enter the seats in Settings → Stores | — |
| `theme.quality.fix.syncDay` | Chạy lại đồng bộ cho ngày này (fnb sync window) | Run the sync again for this day (fnb sync window) | — |
| `theme.quality.fix.syncDays` | Chạy lại đồng bộ cho các ngày này (fnb sync window) | Run the sync again for these days (fnb sync window) | — |
| `theme.quality.fix.syncMaster` | Chạy lại đồng bộ danh mục POS (fnb sync master) | Run the POS catalogue sync again (fnb sync master) | — |
| `theme.quality.fix.waitRefresh` | Chờ lần làm mới số liệu tiếp theo | Wait for the next refresh of the figures | — |

### Việc cần làm của cửa hàng · store findings (`theme.quality.finding.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.finding.eInvoice.disabled` | Hóa đơn điện tử đã tắt | E-invoices turned off | — |
| `theme.quality.finding.eInvoice.not_configured` | Chưa đăng ký hóa đơn điện tử | E-invoices not registered | — |
| `theme.quality.finding.eInvoice.unknown` | Chưa ghi trạng thái hóa đơn điện tử | E-invoice status not recorded | — |
| `theme.quality.finding.hours` | Chưa có giờ mở cửa | No opening hours | — |
| `theme.quality.finding.memberDisabled` | Tính năng thành viên trên POS đang tắt | Member feature on the POS is off | — |
| `theme.quality.finding.openedOn` | Chưa có ngày khai trương | No opening date | — |
| `theme.quality.finding.receipts.mismatch` | Cách đánh số hóa đơn đã ghi khác với dữ liệu | Recorded receipt numbering differs from the data | — |
| `theme.quality.finding.receipts.unknown` | Chưa ghi cách đánh số hóa đơn | Receipt numbering not recorded | — |
| `theme.quality.finding.seats` | Chưa có số ghế | No seat count | — |

### Trạng thái ngày · day states (`theme.quality.state.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.state.notChecked` | Chưa kiểm tra | Not checked | — |
| `theme.quality.state.notMatched` | Chưa khớp | Not matched | — |
| `theme.quality.state.updating` | Đang cập nhật | Updating | — |

### Hóa đơn điện tử · e-invoice status (`theme.quality.eInvoice.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.eInvoice.configured` | Đã đăng ký | Registered | — |
| `theme.quality.eInvoice.disabled` | Đã tắt | Turned off | — |
| `theme.quality.eInvoice.not_configured` | Chưa đăng ký | Not registered | — |
| `theme.quality.eInvoice.unknown` | Chưa rõ | Not known | — |

### Đánh số hóa đơn · receipt numbering (`theme.quality.receipts.*`, `theme.quality.receiptsData.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.receipts.daily` | Hằng ngày | Every day | — |
| `theme.quality.receipts.never` | Không đánh lại | Never | — |
| `theme.quality.receipts.unknown` | Chưa rõ | Not known | — |
| `theme.quality.receipts.yearly` | Hằng năm | Every year | — |
| `theme.quality.receiptsData.daily` | Bắt đầu lại mỗi ngày | Starts again every day | — |
| `theme.quality.receiptsData.notDaily` | Không bắt đầu lại mỗi ngày | Does not start again every day | — |
| `theme.quality.receiptsData.unknown` | Chưa đủ dữ liệu | Not enough data | — |

### Tính năng thành viên · member feature (`theme.quality.member.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.member.disabled` | Đang tắt | Off | — |
| `theme.quality.member.enabled` | Đang bật | On | — |
| `theme.quality.member.unknown` | Chưa rõ | Not known | — |

### Giá trị trong bảng · table values (`theme.quality.value.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.value.entered` | Đã nhập | Entered | — |
| `theme.quality.value.missing` | Chưa nhập | Missing | — |
| `theme.quality.value.no` | Không | No | — |
| `theme.quality.value.yes` | Có | Yes | — |

### Tên cột bảng · table columns (`theme.quality.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `theme.quality.table.catalogueModifiers` | Tùy chọn bán như món | Catalogue modifiers sold as items | — |
| `theme.quality.table.consentCoverage` | Tỷ lệ đồng ý tích điểm | Consent coverage | — |
| `theme.quality.table.eInvoice` | Hóa đơn điện tử | E-invoices | — |
| `theme.quality.table.finding` | Việc cần làm | To do | — |
| `theme.quality.table.fix` | Cách sửa | How to fix | — |
| `theme.quality.table.identifiedCustomers` | Khách trong danh sách khách hàng | Customers in the customer list | — |
| `theme.quality.table.identifiedInvoices` | Hóa đơn có SĐT hoặc mã khách | Invoices with a phone or customer id | — |
| `theme.quality.table.inCatalogue` | Có trong danh mục | In the catalogue | — |
| `theme.quality.table.itemLines` | Dòng món | Item lines | — |
| `theme.quality.table.itemShare` | Tỷ trọng doanh thu món | Share of item revenue | — |
| `theme.quality.table.items` | Số món | Items | — |
| `theme.quality.table.kind` | Đang tính là | Counted as | — |
| `theme.quality.table.loyaltyConsents` | Đồng ý tích điểm | Loyalty consents | — |
| `theme.quality.table.marketingConsents` | Đồng ý nhận tin | Marketing consents | — |
| `theme.quality.table.member` | Tính năng thành viên | Member feature | — |
| `theme.quality.table.modifierLines` | Dòng tùy chọn | Modifier lines | — |
| `theme.quality.table.modifierShare` | Tỷ trọng dòng tùy chọn | Modifier line share | — |
| `theme.quality.table.openedOn` | Ngày khai trương | Opening date | — |
| `theme.quality.table.openingHours` | Giờ mở cửa | Opening hours | — |
| `theme.quality.table.overrideKind` | Loại chọn trong Cài đặt | Kind set in Settings | — |
| `theme.quality.table.posKind` | Loại trên POS | POS kind | — |
| `theme.quality.table.posType` | Nhóm trên POS | POS category | — |
| `theme.quality.table.receipts` | Đánh số hóa đơn đã ghi | Receipt numbering recorded | — |
| `theme.quality.table.receiptsData` | Đánh số theo dữ liệu | Numbering in the data | — |
| `theme.quality.table.seats` | Số ghế | Seats | — |

## Cài đặt: phần dùng chung · Settings, shared parts (`settings.vi.json`, 94 mục)

### Chung · general (`settings.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.cancel` | Hủy thay đổi | Discard changes | — |
| `settings.demoNote` | Bản demo: thay đổi chỉ giữ trong phiên này; tải lại trang là về như cũ. | Demo: changes last only for this session; reloading the page undoes them. | — |
| `settings.nav` | Trang cài đặt | Settings pages | — |
| `settings.restoreDefaults` | Khôi phục mặc định | Restore defaults | — |
| `settings.save` | Lưu | Save | — |
| `settings.saved` | Đã lưu. | Saved. | — |
| `settings.saving` | Đang lưu… | Saving… | — |
| `settings.title` | Cài đặt | Settings | — |

### Tên trang cài đặt · settings pages (`settings.page.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.page.classification` | Phân loại | Classification | — |
| `settings.page.holidays` | Ngày lễ | Holidays | — |
| `settings.page.legal` | Pháp lý | Legal | — |
| `settings.page.manualData` | Dữ liệu nhập tay | Manual data | — |
| `settings.page.store` | Cửa hàng | Stores | — |
| `settings.page.thresholds` | Ngưỡng báo cáo | Report thresholds | — |

### Trang chưa mở · pages not built yet (`settings.placeholder.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.placeholder.body` | Trang {page} có ở giai đoạn {phase} của lộ trình. | The {page} page comes in phase {phase} of the roadmap. | `{page}` `{phase}` |
| `settings.placeholder.title` | Trang này đang được xây dựng | This page is being built | — |

### Trang dành chỗ cho giai đoạn 12 · slots for phase 12 (`settings.alerts.*`, `settings.digests.*`)

The two pages phase 12 fills: their name in the settings menu and the line their placeholder shows. Phase 12 moves these keys into message files of its own.

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.alerts.slot` | Nơi nhận cảnh báo qua Zalo Bot hoặc e-mail, nút gửi thử và các quy tắc cảnh báo của từng cửa hàng. | Where alerts go, by Zalo Bot or e-mail, a test button and the alert rules of each store. | — |
| `settings.alerts.title` | Cảnh báo | Alerts | — |
| `settings.digests.slot` | Các bản tin hằng ngày đã gửi, để xem lại ngay trong ứng dụng, và nơi nhận của từng bản tin. | The daily digests sent, to read again in the app, and where each one went. | — |
| `settings.digests.title` | Bản tin | Digests | — |

### Thông báo chỉ xem · read-only notices (`settings.readOnly.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.readOnly.notMember` | Tài khoản này không thuộc doanh nghiệp đang xem nên chỉ xem được. | This login is not a member of the business on screen, so you can only read. | — |
| `settings.readOnly.ownerOnly` | Ngưỡng báo cáo áp dụng cho cả quản lý nên chỉ chủ xem được tất cả cửa hàng mới sửa được. | Report thresholds also govern managers, so only an owner who sees all stores can change them. | — |
| `settings.readOnly.role` | Chỉ chủ và quản lý xem được tất cả cửa hàng mới sửa được mục này; bạn đang xem ở chế độ chỉ đọc. | Only owners and managers who see all stores can change this; you are reading it. | — |
| `settings.readOnly.scope` | Mục này áp dụng cho mọi cửa hàng nên chỉ chủ hoặc quản lý xem được tất cả cửa hàng mới sửa được. | This applies to every store, so only an owner or manager who sees all stores can change it. | — |
| `settings.readOnly.unavailable` | Chưa đọc được quyền sửa của bạn; tải lại trang để thử lại. | Your permissions could not be read; reload the page to try again. | — |
| `settings.readOnly.unknown` | Đang kiểm tra quyền sửa của bạn… | Checking whether you can change this… | — |

### Vai trò thành viên · member roles (`settings.role.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.role.manager` | quản lý | a manager | — |
| `settings.role.owner` | chủ | the owner | — |
| `settings.role.publisher` | tài khoản đăng báo cáo | the report publisher | — |
| `settings.role.staff` | nhân viên | a staff member | — |
| `settings.role.viewer` | người xem | a viewer | — |

### Thanh lưu · save bar (`settings.saveBar.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.saveBar.invalid` | Sửa các ô đang báo lỗi rồi lưu. | Fix the fields marked with an error, then save. | — |
| `settings.saveBar.label` | Lưu thay đổi | Save changes | — |
| `settings.saveBar.none` | Chưa có thay đổi. | No changes. | — |
| `settings.saveBar.pendingMany` | {count} thay đổi chưa lưu | {count} unsaved changes | `{count}` |
| `settings.saveBar.pendingOne` | {count} thay đổi chưa lưu | {count} unsaved change | `{count}` |

### Dòng lưu lần cuối · audit line (`settings.audit.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.audit.at` | Sửa lần cuối {when}. | Last changed on {when}. | `{when}` |
| `settings.audit.byRole` | Sửa lần cuối {when}, bởi {role}. | Last changed on {when} by {role}. | `{when}` `{role}` |
| `settings.audit.byYou` | Bạn sửa lần cuối {when}. | You last changed this on {when}. | `{when}` |
| `settings.audit.never` | Chưa lưu lần nào. | Not saved yet. | — |
| `settings.audit.when` | {date} lúc {time} | {date} at {time} | `{date}` `{time}` |

### Lỗi khi lưu · save errors (`settings.error.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.error.duplicate` | Không lưu được: đã có một dòng như vậy. | Not saved: such a row already exists. | — |
| `settings.error.forbidden` | Không lưu được: tài khoản của bạn không có quyền sửa mục này. | Not saved: your login is not allowed to change this. | — |
| `settings.error.frozen` | Không lưu được: dữ liệu này đã khóa, không sửa được nữa. | Not saved: this data is locked and can no longer change. | — |
| `settings.error.invalid` | Không lưu được: có giá trị nằm ngoài khoảng cho phép. | Not saved: a value is outside the allowed range. | — |
| `settings.error.network` | Không lưu được vì mất kết nối; kiểm tra mạng rồi thử lại. | Not saved because the connection dropped; check the network and try again. | — |

### Kiểm tra dữ liệu nhập · validation messages (`settings.validation.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.validation.atLeast` | Nhập giá trị từ {min} trở lên. | Enter {min} or more. | `{min}` |
| `settings.validation.atMost` | Nhập giá trị không quá {max}. | Enter {max} or less. | `{max}` |
| `settings.validation.choice` | Chọn một mục trong danh sách. | Choose one of the options. | — |
| `settings.validation.date` | Chọn một ngày hợp lệ. | Choose a valid date. | — |
| `settings.validation.dateRange` | Chọn ngày từ {min} đến {max}. | Choose a date from {min} to {max}. | `{min}` `{max}` |
| `settings.validation.decimals` | Chỉ nhập tối đa {digits} chữ số sau dấu phẩy. | Use at most {digits} decimal places. | `{digits}` |
| `settings.validation.integer` | Nhập số nguyên, không có phần lẻ. | Enter a whole number, without a fraction. | — |
| `settings.validation.number` | Nhập một con số. | Enter a number. | — |
| `settings.validation.openingHours` | Giờ mở cửa chưa đúng dạng; kiểm tra lại từng khung giờ. | The opening hours are not in the expected shape; check each span. | — |
| `settings.validation.range` | Nhập giá trị từ {min} đến {max}. | Enter a value from {min} to {max}. | `{min}` `{max}` |
| `settings.validation.required` | Ô này không được để trống. | This field cannot be empty. | — |
| `settings.validation.textLength` | Nhập tối đa {max} ký tự. | Use at most {max} characters. | `{max}` |
| `settings.validation.time` | Nhập giờ dạng giờ:phút, ví dụ 07:00. | Enter a time as hours:minutes, for example 07:00. | — |
| `settings.validation.wholeMoney` | Nhập số tiền chẵn đồng, không có phần lẻ. | Enter a whole amount, without a fraction. | — |

### Thứ · weekdays (`settings.weekday.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.weekday.fri` | Thứ Sáu | Friday | — |
| `settings.weekday.mon` | Thứ Hai | Monday | — |
| `settings.weekday.sat` | Thứ Bảy | Saturday | — |
| `settings.weekday.sun` | Chủ Nhật | Sunday | — |
| `settings.weekday.thu` | Thứ Năm | Thursday | — |
| `settings.weekday.tue` | Thứ Ba | Tuesday | — |
| `settings.weekday.wed` | Thứ Tư | Wednesday | — |

### Giờ mở cửa · opening-hours editor (`settings.hours.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.hours.addSpan` | Thêm khung giờ | Add a span | — |
| `settings.hours.addSpanTo` | Thêm khung giờ cho {day} | Add a span to {day} | `{day}` |
| `settings.hours.close` | giờ đóng khung {n} | closes, span {n} | `{n}` |
| `settings.hours.closed` | Nghỉ cả ngày | Closed all day | — |
| `settings.hours.closedOn` | {day}, nghỉ cả ngày | {day}, closed all day | `{day}` |
| `settings.hours.copied` | Đã chép giờ của {day} sang các ngày khác. | Copied the hours of {day} to the other days. | `{day}` |
| `settings.hours.copy` | Chép sang các ngày khác | Copy to the other days | — |
| `settings.hours.copyFrom` | {day}: chép sang các ngày khác | {day}: copy to the other days | `{day}` |
| `settings.hours.maxSpans` | Tối đa {count} khung mỗi ngày. | Up to {count} spans a day. | `{count}` |
| `settings.hours.open` | giờ mở khung {n} | opens, span {n} | `{n}` |
| `settings.hours.overnight` | Đóng sau nửa đêm, vào ngày hôm sau. | Closes after midnight, on the next day. | — |
| `settings.hours.remove` | Xóa | Remove | — |
| `settings.hours.removeSpan` | Xóa khung {n} của {day} | Remove span {n} of {day} | `{n}` `{day}` |

### Cập nhật số liệu sau khi đổi cài đặt · catch-up banner (`settings.catchUp.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.catchUp.dismiss` | Đóng | Close | — |
| `settings.catchUp.done` | Đã cập nhật xong số liệu theo thay đổi cài đặt. | The numbers have caught up with the settings change. | — |
| `settings.catchUp.failed.forbidden` | Chưa cập nhật xong: tài khoản của bạn không có quyền cập nhật số liệu. | The refresh stopped: your account may not refresh the numbers. | — |
| `settings.catchUp.failed.network` | Chưa cập nhật xong vì mất kết nối; kiểm tra mạng rồi thử lại. | The refresh stopped because the connection was lost; check the network and try again. | — |
| `settings.catchUp.failed.other` | Chưa cập nhật xong vì có lỗi; thử lại sau ít phút. | The refresh stopped on an error; try again in a few minutes. | — |
| `settings.catchUp.failed.stalled` | Chưa cập nhật xong: số ngày còn lại không giảm; thử lại sau ít phút. | The refresh stopped: the days left did not go down; try again in a few minutes. | — |
| `settings.catchUp.finishing` | Số liệu đang cập nhật theo thay đổi cài đặt. | The numbers are catching up with a settings change. | — |
| `settings.catchUp.label` | Cập nhật số liệu theo thay đổi cài đặt | Catching up with a settings change | — |
| `settings.catchUp.pending` | Số liệu đang cập nhật theo thay đổi cài đặt: còn {days} ngày. | The numbers are catching up with a settings change. Days left: {days}. | `{days}` |
| `settings.catchUp.pendingSince` | Số liệu đang cập nhật theo thay đổi cài đặt lúc {time} ngày {date}: còn {days} ngày. | The numbers are catching up with the settings change of {date} at {time}. Days left: {days}. | `{time}` `{date}` `{days}` |
| `settings.catchUp.retry` | Thử lại | Try again | — |
| `settings.catchUp.running` | Đang cập nhật… | Refreshing… | — |
| `settings.catchUp.start` | Cập nhật ngay | Refresh now | — |
| `settings.catchUp.waitForOwner` | Chủ hoặc quản lý có thể cập nhật ngay. | An owner or a manager can refresh now. | — |

## Cài đặt → Ngưỡng báo cáo · Settings, report thresholds (`settings-thresholds.vi.json`, 36 mục)

### Trang và các nhóm ngưỡng · page and threshold groups (`settings.thresholds.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.thresholds.busyHourRatio.hint` | Giờ có số hóa đơn từ mức này so với giờ trung bình trở lên là giờ đông; các giờ đông liền nhau thành khung giờ gợi ý. | An hour with invoices at or above this share of the average hour is busy; busy hours in a row form the suggested shift windows. | — |
| `settings.thresholds.busyHourRatio.label` | Ngưỡng giờ đông | Busy-hour threshold | — |
| `settings.thresholds.cash.zFixed` | Điểm z của chênh lệch két cố định ở mức {value}, không đổi được ở đây. | The z-score of the drawer variance is fixed at {value} and cannot be changed here. | `{value}` |
| `settings.thresholds.cashAbsThreshold.hint` | Ca bị đánh dấu khi chênh lệch két vượt số tiền này. | A shift is flagged when its drawer variance exceeds this amount. | — |
| `settings.thresholds.cashAbsThreshold.label` | Chênh lệch két theo số tiền | Drawer variance by amount | — |
| `settings.thresholds.cashRelThreshold.hint` | Ca bị đánh dấu khi chênh lệch két vượt tỷ lệ này của tiền mặt bán trong ca. | A shift is flagged when its drawer variance exceeds this share of the shift's cash sales. | — |
| `settings.thresholds.cashRelThreshold.label` | Chênh lệch két theo tỷ lệ | Drawer variance by share | — |
| `settings.thresholds.deadHourRatio.hint` | Giờ bán dưới mức này so với giờ trung bình là giờ thấp điểm. | An hour selling below this share of the average hour is a quiet hour. | — |
| `settings.thresholds.deadHourRatio.label` | Ngưỡng giờ thấp điểm | Quiet-hour threshold | — |
| `settings.thresholds.default` | Mặc định: {value}. | Default: {value}. | `{value}` |
| `settings.thresholds.group.cash` | Tiền mặt | Cash | — |
| `settings.thresholds.group.hours` | Giờ | Hours | — |
| `settings.thresholds.group.menu` | Thực đơn | Menu | — |
| `settings.thresholds.group.promotions` | Khuyến mãi | Promotions | — |
| `settings.thresholds.menuLowSampleItems.hint` | Vai trò có ít món hơn thì xếp loại chỉ để tham khảo. | A role with fewer items is classed for reference only. | — |
| `settings.thresholds.menuLowSampleItems.label` | Số món tối thiểu mỗi vai trò | Fewest items per role | — |
| `settings.thresholds.menuPopularityFactor.hint` | Món là bán chạy khi tỷ trọng số bán đạt ít nhất mức này so với phần chia đều giữa các món cùng vai trò. | An item is popular when its share of the quantity sold reaches at least this much of an even split among the items of its role. | — |
| `settings.thresholds.menuPopularityFactor.label` | Ngưỡng bán chạy | Popularity threshold | — |
| `settings.thresholds.menuWindowDays.hint` | Ma trận thực đơn xếp loại món theo số ngày gần nhất này. | The menu matrix classes items over this many latest days. | — |
| `settings.thresholds.menuWindowDays.label` | Số ngày xét thực đơn | Menu window | — |
| `settings.thresholds.note` | Lưu ở đây là đổi cùng lúc báo cáo Ngày, Tháng, các báo cáo chủ đề và bản tin ngày, vì tất cả cùng đọc các ngưỡng này. | Saving here changes the Daily and Monthly reports, the thematic reports and the daily digest together, because they all read these thresholds. | — |
| `settings.thresholds.peakHours.hint` | Số giờ bán nhiều nhất được tính là giờ cao điểm. | This many best-selling hours count as peak hours. | — |
| `settings.thresholds.peakHours.label` | Số giờ cao điểm | Peak hours counted | — |
| `settings.thresholds.promoPreWeeks.hint` | Hiệu quả khuyến mãi so với cùng thứ trong số tuần này trước ngày khuyến mãi đầu tiên, khi so với các tuần trước hoặc với cửa hàng không chạy chương trình. | The promotion lift compares with the same weekday in this many weeks before the first promotion day, when compared with the weeks before or with a store that did not run it. | — |
| `settings.thresholds.promoPreWeeks.label` | Số tuần trước khuyến mãi | Weeks before a promotion | — |
| `settings.thresholds.unit.days` | ngày | days | — |
| `settings.thresholds.unit.hours` | giờ | hours | — |
| `settings.thresholds.unit.items` | món | items | — |
| `settings.thresholds.unit.weeks` | tuần | weeks | — |
| `settings.thresholds.usingDefaults` | Đang dùng giá trị mặc định. | Using the default values. | — |

### Thiết bị này: định dạng CSV · this device's CSV format (`settings.thresholds.device.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.thresholds.device.csv` | Định dạng tệp CSV khi tải bảng | CSV format for table downloads | — |
| `settings.thresholds.device.csv.comma` | Dấu phẩy (mặc định) | Comma (default) | — |
| `settings.thresholds.device.csv.semicolon` | Dấu chấm phẩy cho Excel cài đặt vùng Việt Nam | Semicolon for Excel set to Vietnamese regional settings | — |
| `settings.thresholds.device.csv.semicolonHint` | Chọn dấu chấm phẩy khi Excel dồn cả dòng vào một cột: tệp sẽ dùng dấu chấm phẩy và dấu phẩy thập phân. | Choose the semicolon when Excel puts a whole row in one column: the files then use semicolons and a decimal comma. | — |
| `settings.thresholds.device.hint` | Lựa chọn dưới đây chỉ áp dụng cho thiết bị này và ai cũng chọn được. | The choice below applies to this device only, and any member may make it. | — |
| `settings.thresholds.device.title` | Thiết bị này | This device | — |

## Cài đặt → Phân loại · Settings, classification (`settings-mapping.vi.json`, 41 mục)

### Thẻ phân loại · classification tabs (`settings.mapping.tab*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.mapping.tab.categories` | Nhóm của món | Item categories | — |
| `settings.mapping.tab.paymentKinds` | Loại thanh toán | Payment kinds | — |
| `settings.mapping.tab.roles` | Vai trò nhóm món | Item-type roles | — |
| `settings.mapping.tabs.label` | Các phần của trang Phân loại | Parts of the Classification page | — |

### Dùng chung · shared (`settings.mapping.followPos`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.mapping.followPos` | Theo POS | As in the POS | — |

### Vai trò nhóm món · item-type roles (`settings.mapping.roles.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.mapping.roles.applied` | Đã điền gợi ý vào các nhóm chưa gán; bấm Lưu để giữ. | Suggestions filled in for the unassigned types; press Save to keep them. | — |
| `settings.mapping.roles.applyMany` | Áp dụng gợi ý cho {count} nhóm chưa gán | Apply the suggestions to {count} unassigned types | `{count}` |
| `settings.mapping.roles.applyOne` | Áp dụng gợi ý cho {count} nhóm chưa gán | Apply the suggestion to {count} unassigned type | `{count}` |
| `settings.mapping.roles.empty` | Chưa có nhóm món nào; nhóm món đến từ POS sau lần đồng bộ đầu tiên. | No item types yet; they come from the POS after the first sync. | — |
| `settings.mapping.roles.intro` | Mỗi nhóm món trên POS cần một vai trò, để báo cáo tính được tỷ lệ kèm topping và đồ ăn nhẹ, và để ma trận thực đơn so mỗi món với các món cùng vai trò. | Each POS item type needs a role, so that the reports can measure the topping and snack attach rates and the menu matrix compares each item with the others of its role. | — |
| `settings.mapping.roles.none` | Chưa gán | Not assigned | — |
| `settings.mapping.roles.suggestion` | Gợi ý: {role} | Suggested: {role} | `{role}` |
| `settings.mapping.roles.usage` | {items} món đã bán · {share} doanh thu món trong 28 ngày | {items} items sold · {share} of item revenue over 28 days | `{items}` `{share}` |
| `settings.mapping.roles.usageNone` | Không bán món nào trong 28 ngày | Nothing sold over 28 days | — |
| `settings.mapping.roles.usageUnavailable` | Chưa đọc được số bán 28 ngày. | The 28-day sales could not be read. | — |

### Nhóm của món · item categories (`settings.mapping.categories.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.mapping.categories.empty` | Chưa có món nào; món đến từ POS sau lần đồng bộ đầu tiên. | No items yet; they come from the POS after the first sync. | — |
| `settings.mapping.categories.inactive` | Đã ngừng bán trên POS | No longer sold in the POS | — |
| `settings.mapping.categories.intro` | Mỗi món được tính vào nhóm món của nó trên POS. Khi POS thiếu nhóm hoặc xếp sai, hãy chọn ở đây một nhóm của cùng tài khoản POS; "Theo POS" dùng lại nhóm trên POS. | Each item counts in its item type in the POS. When the POS lacks a type or has the wrong one, choose a type of the same POS account here; "As in the POS" goes back to the POS's type. | — |
| `settings.mapping.categories.notInCatalogue` | Không có trong danh mục POS | Not in the POS catalogue | — |
| `settings.mapping.categories.onPos` | Trên POS: {type} | In the POS: {type} | `{type}` |
| `settings.mapping.categories.overridden.hint` | Các món này tính theo nhóm chọn ở đây thay cho nhóm trên POS; chọn "Theo POS" để bỏ. | These items count in the type chosen here instead of the POS's; choose "As in the POS" to undo it. | — |
| `settings.mapping.categories.overridden.title` | Đã chọn nhóm tại đây ({count}) | Type chosen here ({count}) | `{count}` |
| `settings.mapping.categories.posNone` | chưa có nhóm | no type | — |
| `settings.mapping.categories.posUnknown` | nhóm {type}, không có trong danh mục | type {type}, not in the catalogue | `{type}` |
| `settings.mapping.categories.search.found` | Số món khớp: {count}. | Matching items: {count}. | `{count}` |
| `settings.mapping.categories.search.hint` | Tìm theo tên, cỡ, mã món hoặc nhóm trong {count} món. | Search by name, size, item code or type among {count} items. | `{count}` |
| `settings.mapping.categories.search.label` | Tìm món | Find an item | — |
| `settings.mapping.categories.search.more` | Đang hiện {shown} trong {count} món khớp; gõ thêm để thu hẹp. | Showing {shown} of {count} matching items; type more to narrow the search. | `{shown}` `{count}` |
| `settings.mapping.categories.search.none` | Không có món nào khớp. | No item matches. | — |
| `settings.mapping.categories.search.title` | Tất cả món | All items | — |
| `settings.mapping.categories.typeGone` | {type} (không còn trên POS) | {type} (no longer in the POS) | `{type}` |
| `settings.mapping.categories.uncategorised.failed` | Chưa đọc được các món đã bán trong 90 ngày qua. | The items sold over the last 90 days could not be read. | — |
| `settings.mapping.categories.uncategorised.hint` | Món đã bán trong 90 ngày qua mà POS chưa gán nhóm, hoặc gán một nhóm không có trong danh mục POS; món bán nhiều đứng trước. | Items sold over the last 90 days that the POS gave no type, or a type its catalogue does not have; the best sellers come first. | — |
| `settings.mapping.categories.uncategorised.label` | Chưa phân loại | Uncategorised | — |
| `settings.mapping.categories.uncategorised.none` | Món nào bán trong 90 ngày qua cũng đã có nhóm. | Every item sold over the last 90 days has a type. | — |
| `settings.mapping.categories.uncategorised.title` | Chưa phân loại ({count}) | Uncategorised ({count}) | `{count}` |
| `settings.mapping.categories.withSize` | {name} (cỡ {size}) | {name} (size {size}) | `{name}` `{size}` |

### Loại thanh toán · payment kinds (`settings.mapping.kinds.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `settings.mapping.kinds.drawerNote` | Tiền mặt dự kiến trong két của các ca đã qua chỉ đổi theo loại mới sau khi đồng bộ lại những ngày đó. | The expected cash in the drawer of past shifts follows the new kind only after those days are synced again. | — |
| `settings.mapping.kinds.empty` | Chưa có phương thức thanh toán nào; chúng đến từ POS sau lần đồng bộ đầu tiên. | No payment methods yet; they come from the POS after the first sync. | — |
| `settings.mapping.kinds.intro` | Mỗi phương thức thanh toán được tính theo loại mà POS gán cho nó. Nếu POS xếp sai, hãy chọn loại đúng ở đây; "Theo POS" dùng lại loại trên POS. | Each payment method counts under the kind the POS gives it. If the POS has it wrong, choose the right kind here; "As in the POS" goes back to the POS's kind. | — |
| `settings.mapping.kinds.state` | Trên POS: {pos} · Đang tính là: {kind} | In the POS: {pos} · Counted as: {kind} | `{pos}` `{kind}` |
