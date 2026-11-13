# Câu văn báo cáo — bảng duyệt câu chữ

Owner review of the wording of the periodic reports Ngày, Tuần, Tháng and Năm (roadmap phase 9, open question Q9). It lists every Vietnamese template the four reports use (679 entries, 249 of them with placeholders), with its English meaning and the placeholders it fills in. It holds templates only: no store, item or person names and no figures.

The source of truth is the message files in `apps/web/src/i18n/messages/`: `reports.vi.json` (shared by the four reports) and `report-day`, `report-week`, `report-month`, `report-year` (`.vi.json` and `.en.json`). This sheet is a copy of them for reading; when a file changes, the file wins. Metric names and explanations ("Giải thích chỉ số") live in `metrics.vi.json` and are reviewed with the metric registry, not here.

## How to review

- Each row is one message key. "Tiếng Việt" is exactly what the reports show; "English" is the English interface text, which is also the meaning the Vietnamese must carry.
- Words in braces, such as `{day}` or `{delta}`, are placeholders filled in when the card is built. Keep each placeholder of a row when rewording it; it may move within the sentence. Every placeholder of the Vietnamese text must also be in the English text and the other way round (a test checks it).
- Mark only the rows you want changed and write the wording you want. The key column tells a builder which entry to change; nothing else has to change for a new wording.
- A row whose name ends in `.up`, `.down`, `.flat`, `.noReference` or `.noData` is one of the five forms of the same main clause (see "How a card's text is built").

## Spelling

Decided by the owner: the reports, like the metric registry, write "hóa đơn", "hủy" and "tùy" (the tone mark on the first vowel of "oa" and "uy"), never "hoá", "huỷ" or "tuỳ". A test fails when a Vietnamese message file uses the other spelling.

## How a card's text is built

- **Headline and caption.** The headline is one number; the caption under it (keys ending in `.caption`) says what the number is or when it is from.
- **Comparison chips.** Each chip pairs a change with a label from `report.compare.*` ("so với hôm trước"). A chip that cannot compare shows a state from `report.unavailable.*` instead ("chưa có dữ liệu năm trước"). When only some stores have enough history, the label gains "· cùng cửa hàng (k/N)" (`report.compare.likeForLike`).
- **Sentence.** At most three parts, in this order:
  1. a **main clause** comparing the headline with one reference, in one of five forms: `.up` (higher), `.down` (lower), `.flat` (a change under 0,5 %, "ngang"), `.noReference` (nothing to compare with) and `.noData` (no sales);
  2. a **note** where one applies: a young store ("{store} mở từ {date}, chưa có dữ liệu năm trước") or the like-for-like figures (`report.clause.coverage.*`);
  3. a **driver clause** naming the store, hour, weekday, day, month, item, category, promotion, payment method or cashier that made the largest difference (`report.clause.driver.*`); its `…Against` form, "Riêng … đi ngược chiều", is used only after an `.up` or `.down` clause, when the largest contribution went the other way; when no driver applies, a **decomposition clause** saying what the change mostly came from (`report.clause.decomposition.*`, or `report.clause.decompositionReference.*` when it is measured against another reference than the main clause, as on Ngày, which compares with the baseline but decomposes against the day before).
- **Decomposition line.** Under the chips of the net revenue and average ticket cards: "Chênh lệch {total} {against}: số hóa đơn … · số món mỗi hóa đơn … · giá trung bình mỗi món …" (`report.decomposition.*`); the parts add up exactly to the total.
- **Notices.** A card that cannot show a number explains why (keys containing `notice`, `none`, `no…`, and `report.unavailable.*`), sometimes with a link to Settings (`report.action.*`).
- **Tables.** Column names come from `report.table.*` and each report's `.table.*` keys; period rows from `report.periodRow.*`.

## How values are written

| Value | Written as |
| --- | --- |
| Money under 1 million | in full: `914.500 ₫` |
| Money from 1 million | one decimal with "tr": `6,9 tr ₫`; from 1 billion with "tỷ": `1,2 tỷ ₫` |
| Money in the decomposition line | always in full: `+1.538.000 ₫` |
| A change after "cao hơn" or "thấp hơn" | a percentage without a sign: `3,8%` |
| A change in brackets after a driver | signed: `+914.500 ₫`, `+2,1 tr ₫`, `-7,8%` |
| A share or rate | a percentage with one decimal: `10,2%` |
| A change of a share or rate | percentage points: `+1,2 điểm %` (`report.value.points`) |
| A date | `08/11/2026` |
| A weekday | `Thứ Hai` … `Chủ Nhật` |
| A month | `11/2026` |
| An ISO week | `tuần 45/2026` (`report.value.isoWeek`) |
| An hour | `20:00` |
| A count | a whole number: `13` |

## Placeholders

The common placeholders; every other one is named after what it holds, and the English column shows it in context.

| Placeholder | Holds |
| --- | --- |
| `{day}`, `{date}`, `{end}`, `{from}`, `{to}`, `{best}`, `{worst}`, `{bestDate}`, `{worstDate}` | a date |
| `{weekday}`, `{bestWeekday}`, `{worstWeekday}` | a weekday |
| `{month}`, `{currentMonth}`, `{otherMonth}`, `{lowMonth}` | a month |
| `{year}`, `{lastYear}` | a year |
| `{week}` | an ISO week number |
| `{period}` | the report's period in words, such as `tuần 45/2026` |
| `{hour}` | an hour of the day |
| `{value}`, `{current}`, `{reference}`, `{currentValue}`, `{amount}`, `{target}`, `{needed}`, `{variance}` | an amount or a figure, written for its unit |
| `{delta}`, `{bestDelta}`, `{worstDelta}`, `{riseDelta}`, `{fallDelta}`, `{riserChange}`, `{fallerChange}`, `{dip}`, `{lastDip}` | a change, as a percentage or an amount |
| `{points}` | the size of a change of a share, in percentage points, without a sign |
| `{share}`, `{rate}`, `{progress}` | a share, a rate or a progress, as a percentage |
| `{total}` | the total of the decomposition line, or the number of stores or items a count is out of |
| `{invoices}`, `{items}`, `{price}`, `{effect}` | the parts of the decomposition: invoices, items per ticket, average item price, and the largest part |
| `{against}` | the reference of the decomposition line, such as "so với hôm trước" |
| `{label}` | a comparison label of `report.compare.*` |
| `{covered}` | how many of the selected stores have enough history for the comparison |
| `{count}`, `{days}`, `{weeks}`, `{quantity}`, `{rank}`, `{minimum}` | a number of shifts, items, days, weeks, units sold, a rank or the minimum quantity rule |
| `{store}`, `{stores}` | a store name from the POS, or the stores of the selection |
| `{item}`, `{riser}`, `{faller}` | an item name from the POS |
| `{category}`, `{promotion}`, `{payment}`, `{method}`, `{cashier}`, `{shift}` | a category, promotion, payment method, cashier or shift name from the POS |
| `{kind}` | a payment or promotion kind of this sheet (`report.paymentKind.*`, `report.promotionKind.*`) |
| `{holiday}` | a holiday kind of this sheet (`report.holiday.*`) |
| `{reasons}` | the shift reasons of this sheet (`report.shiftReasons.*`), joined |
| `{report}` | the report's title |
| `{new}`, `{growing}`, `{declining}`, `{discontinued}`, `{steady}` | the number of items in each lifecycle stage |
| `{index}`, `{lowIndex}` | a seasonality index, such as `1,12` |

## Points the review may settle

- Percent sign spacing: most figures read `3,8%`, while a few fixed texts write `80 %` (the Pareto line).
- "điểm %" for percentage points, against "điểm phần trăm".
- "mức nền cùng thứ" for the same-weekday baseline (median of the same weekday over the previous 8 weeks).
- "đi ngược chiều" for a contribution against the trend.
- "đang cập nhật" (`report.marker.stale`) for item, payment and shift figures whose aggregates are catching up.

## Dùng chung cho cả bốn báo cáo · Shared by all four reports (`reports.vi.json`, 191 mục)

### Thẻ chọn báo cáo · report tabs (`report.tabs.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.tabs.label` | Loại báo cáo | Report type | — |
| `report.tabs.day` | Ngày | Day | — |
| `report.tabs.week` | Tuần | Week | — |
| `report.tabs.month` | Tháng | Month | — |
| `report.tabs.year` | Năm | Year | — |

### Thanh chọn kỳ · period navigator (`report.navigator.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.navigator.label` | Kỳ báo cáo | Report period | — |
| `report.navigator.previous` | Kỳ trước | Previous period | — |
| `report.navigator.next` | Kỳ sau | Next period | — |
| `report.navigator.pick` | Chọn ngày | Pick a date | — |

### Nhãn kỳ báo cáo · period labels (`report.period.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.period.day` | {weekday}, {date} | {weekday}, {date} | `{weekday}` `{date}` |
| `report.period.week` | Tuần {week} · {from}–{to} | Week {week} · {from}–{to} | `{week}` `{from}` `{to}` |
| `report.period.month` | Tháng {month} | Month {month} | `{month}` |
| `report.period.year` | Năm {year} | Year {year} | `{year}` |
| `report.period.through` | đến hết ngày {date} | up to and including {date} | `{date}` |

### Thông báo đầu trang · page notices (`report.page.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.page.todayClamped` | Ngày hôm nay chưa kết thúc; báo cáo dừng ở ngày {date}. | Today is not over yet; the report stops at {date}. | `{date}` |
| `report.page.notStarted` | Kỳ này chưa bắt đầu; đang hiển thị kỳ gần nhất đến hết ngày {date}. | That period has not started; showing the latest period up to {date}. | `{date}` |

### Dòng tóm tắt khi in · printed summary line (`report.print.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.print.summary` | {report} · {period} · {stores} · đến hết ngày {date} | {report} · {period} · {stores} · up to and including {date} | `{report}` `{period}` `{stores}` `{date}` |

### Thẻ lỗi · card errors (`report.card.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.card.error` | Không tải được thẻ này. | This card could not be loaded. | — |
| `report.card.overLimit` | Thẻ này vượt giới hạn dữ liệu của một lần tải; hãy chọn ít cửa hàng hơn hoặc một kỳ ngắn hơn. | This card needs more data than one load allows; choose fewer stores or a shorter period. | — |

### Nhãn so sánh (chip) · comparison chips (`report.compare.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.compare.previous.day` | so với hôm trước | vs the day before | — |
| `report.compare.previous.week` | so với tuần trước | vs last week | — |
| `report.compare.previous.month` | so với tháng trước | vs last month | — |
| `report.compare.previous.year` | so với năm trước | vs last year | — |
| `report.compare.lastYear.day` | so với cùng thứ năm trước | vs the same weekday last year | — |
| `report.compare.lastYear.week` | so với cùng tuần năm trước | vs the same week last year | — |
| `report.compare.lastYear.month` | so với cùng tháng năm trước | vs the same month last year | — |
| `report.compare.lastYear.year` | so với năm trước | vs last year | — |
| `report.compare.baseline` | so với mức nền cùng thứ | vs the same-weekday baseline | — |
| `report.compare.baselinePartial` | so với mức nền ({days}/8 tuần) | vs the baseline ({days}/8 weeks) | `{days}` |
| `report.compare.average4Weeks` | so với trung bình {weeks} tuần | vs the {weeks}-week average | `{weeks}` |
| `report.compare.forecast.weekdayProfile` | dự báo theo đặc trưng ngày trong tuần | weekday-profile forecast | — |
| `report.compare.forecast.seasonalNaive` | dự báo mùa vụ đơn giản | seasonal-naïve forecast | — |
| `report.compare.target` | so với mục tiêu | vs the target | — |
| `report.compare.likeForLike` | {label} · cùng cửa hàng ({covered}/{total}) | {label} · same stores ({covered}/{total}) | `{label}` `{covered}` `{total}` |

### Dòng phân tách chênh lệch dưới chip · decomposition line (`report.decomposition.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.decomposition.net` | Chênh lệch {total} {against}: số hóa đơn {invoices} · số món mỗi hóa đơn {items} · giá trung bình mỗi món {price} | Difference {total} {against}: invoices {invoices} · items per ticket {items} · average item price {price} | `{total}` `{against}` `{invoices}` `{items}` `{price}` |
| `report.decomposition.ticket` | Chênh lệch {total} {against}: số món mỗi hóa đơn {items} · giá trung bình mỗi món {price} | Difference {total} {against}: items per ticket {items} · average item price {price} | `{total}` `{against}` `{items}` `{price}` |

### Mệnh đề tác nhân: ai, cái gì tạo khác biệt · driver clauses (`report.clause.driver.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.clause.driver.store` | {store} tạo khác biệt lớn nhất ({delta}). | {store} made the largest difference ({delta}). | `{store}` `{delta}` |
| `report.clause.driver.storeAgainst` | Riêng {store} đi ngược chiều ({delta}). | {store} moved the other way ({delta}). | `{store}` `{delta}` |
| `report.clause.driver.hour` | Khác biệt lớn nhất lúc {hour} ({delta} so với thường lệ). | The largest difference was at {hour} ({delta} against usual). | `{hour}` `{delta}` |
| `report.clause.driver.hourAgainst` | Riêng lúc {hour} đi ngược chiều ({delta} so với thường lệ). | At {hour} the change went the other way ({delta} against usual). | `{hour}` `{delta}` |
| `report.clause.driver.weekday` | {weekday} tạo khác biệt lớn nhất ({delta}). | {weekday} made the largest difference ({delta}). | `{weekday}` `{delta}` |
| `report.clause.driver.weekdayAgainst` | Riêng {weekday} đi ngược chiều ({delta}). | {weekday} moved the other way ({delta}). | `{weekday}` `{delta}` |
| `report.clause.driver.day` | Ngày {day} tạo khác biệt lớn nhất ({delta}). | {day} made the largest difference ({delta}). | `{day}` `{delta}` |
| `report.clause.driver.dayAgainst` | Riêng ngày {day} đi ngược chiều ({delta}). | {day} moved the other way ({delta}). | `{day}` `{delta}` |
| `report.clause.driver.month` | Tháng {month} tạo khác biệt lớn nhất ({delta}). | {month} made the largest difference ({delta}). | `{month}` `{delta}` |
| `report.clause.driver.monthAgainst` | Riêng tháng {month} đi ngược chiều ({delta}). | {month} moved the other way ({delta}). | `{month}` `{delta}` |
| `report.clause.driver.item` | {item} thay đổi nhiều nhất ({delta}). | {item} changed the most ({delta}). | `{item}` `{delta}` |
| `report.clause.driver.itemAgainst` | Riêng {item} đi ngược chiều ({delta}). | {item} moved the other way ({delta}). | `{item}` `{delta}` |
| `report.clause.driver.category` | Nhóm {category} thay đổi nhiều nhất ({delta}). | The {category} category changed the most ({delta}). | `{category}` `{delta}` |
| `report.clause.driver.categoryAgainst` | Riêng nhóm {category} đi ngược chiều ({delta}). | The {category} category moved the other way ({delta}). | `{category}` `{delta}` |
| `report.clause.driver.promotion` | {promotion} thay đổi nhiều nhất ({delta}). | {promotion} changed the most ({delta}). | `{promotion}` `{delta}` |
| `report.clause.driver.promotionAgainst` | Riêng {promotion} đi ngược chiều ({delta}). | {promotion} moved the other way ({delta}). | `{promotion}` `{delta}` |
| `report.clause.driver.payment` | {payment} thay đổi nhiều nhất ({delta}). | {payment} changed the most ({delta}). | `{payment}` `{delta}` |
| `report.clause.driver.paymentAgainst` | Riêng {payment} đi ngược chiều ({delta}). | {payment} moved the other way ({delta}). | `{payment}` `{delta}` |
| `report.clause.driver.cashier` | {cashier} tạo khác biệt lớn nhất ({delta}). | {cashier} made the largest difference ({delta}). | `{cashier}` `{delta}` |
| `report.clause.driver.cashierAgainst` | Riêng {cashier} đi ngược chiều ({delta}). | {cashier} moved the other way ({delta}). | `{cashier}` `{delta}` |
| `report.clause.driver.storeHighestTicket` | {store} có giá trị trung bình mỗi hóa đơn cao nhất ({value}). | {store} has the highest average ticket ({value}). | `{store}` `{value}` |

### Mệnh đề phân tách: chênh lệch phần lớn do đâu · decomposition clauses (`report.clause.decomposition.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.clause.decomposition.invoices` | Phần lớn do số hóa đơn ({effect}). | Mostly from the number of invoices ({effect}). | `{effect}` |
| `report.clause.decomposition.items_per_ticket` | Phần lớn do số món mỗi hóa đơn ({effect}). | Mostly from items per ticket ({effect}). | `{effect}` |
| `report.clause.decomposition.avg_item_price` | Phần lớn do giá trung bình mỗi món ({effect}). | Mostly from the average item price ({effect}). | `{effect}` |

### Mệnh đề phân tách so với mốc khác · decomposition clauses naming their reference (`report.clause.decompositionReference.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.clause.decompositionReference.invoices` | Chênh lệch {total} {against} phần lớn do số hóa đơn ({effect}). | The {total} difference {against} comes mostly from the number of invoices ({effect}). | `{total}` `{against}` `{effect}` |
| `report.clause.decompositionReference.items_per_ticket` | Chênh lệch {total} {against} phần lớn do số món mỗi hóa đơn ({effect}). | The {total} difference {against} comes mostly from items per ticket ({effect}). | `{total}` `{against}` `{effect}` |
| `report.clause.decompositionReference.avg_item_price` | Chênh lệch {total} {against} phần lớn do giá trung bình mỗi món ({effect}). | The {total} difference {against} comes mostly from the average item price ({effect}). | `{total}` `{against}` `{effect}` |

### Mệnh đề cùng cửa hàng · like-for-like clauses (`report.clause.coverage.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.clause.coverage.youngStore` | {store} mở từ {date}, chưa có dữ liệu năm trước. | {store} opened on {date} and has no data from last year yet. | `{store}` `{date}` |
| `report.clause.coverage.likeForLike` | Tính trên các cửa hàng có đủ dữ liệu ({covered}/{total}). | Computed over the stores with enough history ({covered}/{total}). | `{covered}` `{total}` |
| `report.clause.coverage.likeForLikeValues` | Mức so sánh chỉ tính {covered}/{total} cửa hàng có đủ dữ liệu: {current} so với {reference}. | The comparison covers only the {covered} of {total} stores with enough history: {current} against {reference}. | `{covered}` `{total}` `{current}` `{reference}` |

### Mệnh đề Tết · Tết clause (`report.clause.tet.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.clause.tet.shift` | Tết rơi vào {month} năm nay nhưng {otherMonth} năm trước. | Tết falls in {month} this year but in {otherMonth} last year. | `{month}` `{otherMonth}` |

### Nhãn trên thẻ · card markers (`report.marker.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.marker.stale` | đang cập nhật | updating | — |

### Định dạng giá trị · value formats (`report.value.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.value.points` | {value} điểm % | {value} pts | `{value}` |
| `report.value.isoWeek` | tuần {week}/{year} | week {week}/{year} | `{week}` `{year}` |

### Loại ngày lễ · holiday kinds (`report.holiday.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.holiday.tet` | Tết | Tết | — |
| `report.holiday.public` | Ngày lễ | Public holiday | — |
| `report.holiday.custom` | Ngày nghỉ riêng | Own day off | — |

### Liên kết hành động trong thông báo · actions in notices (`report.action.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.action.settings_roles` | Gán vai trò món | Assign item roles | — |
| `report.action.settings_targets` | Đặt mục tiêu tháng | Set monthly targets | — |
| `report.action.today` | Xem Hôm nay | Open Today | — |

### Tên cột bảng · table columns (`report.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.table.store` | Cửa hàng | Store | — |
| `report.table.period` | Kỳ | Period | — |
| `report.table.date` | Ngày | Date | — |
| `report.table.weekday` | Thứ | Weekday | — |
| `report.table.month` | Tháng | Month | — |
| `report.table.hour` | Giờ | Hour | — |
| `report.table.item` | Món | Item | — |
| `report.table.category` | Nhóm món | Category | — |
| `report.table.quantity` | Số lượng | Quantity | — |
| `report.table.netAmount` | Doanh thu thuần | Net revenue | — |
| `report.table.invoices` | Hóa đơn | Invoices | — |
| `report.table.avgTicket` | TB mỗi hóa đơn | Average ticket | — |
| `report.table.itemsPerTicket` | Số món mỗi hóa đơn | Items per ticket | — |
| `report.table.avgItemPrice` | Giá TB mỗi món | Average item price | — |
| `report.table.share` | Tỷ trọng | Share | — |
| `report.table.change` | Chênh lệch | Change | — |
| `report.table.changePoints` | Chênh lệch (điểm %) | Change (pts) | — |
| `report.table.baseline` | Mức nền | Baseline | — |
| `report.table.previous` | Kỳ trước | Previous period | — |
| `report.table.lastYear` | Năm trước | Last year | — |
| `report.table.state` | Trạng thái | Status | — |
| `report.table.current` | Kỳ này | This period | — |
| `report.table.difference` | Chênh lệch | Difference | — |
| `report.table.baselineInvoices` | Hóa đơn mức nền | Baseline invoices | — |
| `report.table.method` | Phương thức | Method | — |
| `report.table.paymentKind` | Loại | Kind | — |
| `report.table.amount` | Số tiền | Amount | — |
| `report.table.cashier` | Thu ngân | Cashier | — |
| `report.table.shift` | Ca | Shift | — |
| `report.table.openedAt` | Mở ca | Opened | — |
| `report.table.closedAt` | Đóng ca | Closed | — |
| `report.table.cashSales` | Tiền mặt thu | Cash sales | — |
| `report.table.expectedCash` | Tiền mặt dự kiến | Expected cash | — |
| `report.table.drawer` | Tiền trong két | Drawer | — |
| `report.table.variance` | Chênh lệch két | Variance | — |
| `report.table.zScore` | Điểm z | z-score | — |
| `report.table.reasons` | Lý do | Reasons | — |
| `report.table.promotion` | Khuyến mãi | Promotion | — |
| `report.table.promotionKind` | Loại giảm giá | Discount type | — |
| `report.table.discount` | Số tiền giảm | Discount | — |
| `report.table.costShare` | Tỷ trọng chi phí | Share of cost | — |
| `report.table.component` | Thành phần | Component | — |
| `report.table.memberInvoices` | Hóa đơn có thành viên | Member invoices | — |
| `report.table.memberShare` | Tỷ lệ có thành viên | Member share | — |
| `report.table.captureRate` | Tỷ lệ định danh khách | Capture rate | — |
| `report.table.role` | Vai trò | Role | — |
| `report.table.from` | Từ ngày | From | — |
| `report.table.to` | Đến ngày | To | — |
| `report.table.days` | Số ngày | Days | — |

### Loại thanh toán · payment kinds (`report.paymentKind.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.paymentKind.cash` | Tiền mặt | Cash | — |
| `report.paymentKind.card` | Thẻ | Card | — |
| `report.paymentKind.bank_transfer` | Chuyển khoản | Bank transfer | — |
| `report.paymentKind.ewallet` | Ví điện tử | E-wallet | — |
| `report.paymentKind.voucher` | Voucher | Voucher | — |
| `report.paymentKind.other` | Khác | Other | — |

### Loại khuyến mãi · promotion kinds (`report.promotionKind.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.promotionKind.item` | Giảm giá món | Item discount | — |
| `report.promotionKind.bill` | Giảm giá hóa đơn | Bill discount | — |
| `report.promotionKind.voucher` | Voucher | Voucher | — |

### Lý do cảnh báo ca · shift variance reasons (`report.shiftReasons.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.shiftReasons.absolute` | vượt ngưỡng tuyệt đối | over the absolute threshold | — |
| `report.shiftReasons.relative` | vượt ngưỡng tương đối | over the relative threshold | — |
| `report.shiftReasons.z_score` | bất thường so với các ca trước | unusual against earlier shifts | — |
| `report.shiftReasons.absolute_relative` | vượt cả ngưỡng tuyệt đối và tương đối | over the absolute and the relative threshold | — |
| `report.shiftReasons.absolute_z_score` | vượt ngưỡng tuyệt đối và bất thường so với các ca trước | over the absolute threshold and unusual against earlier shifts | — |
| `report.shiftReasons.relative_z_score` | vượt ngưỡng tương đối và bất thường so với các ca trước | over the relative threshold and unusual against earlier shifts | — |
| `report.shiftReasons.absolute_relative_z_score` | vượt cả hai ngưỡng và bất thường so với các ca trước | over both thresholds and unusual against earlier shifts | — |

### Vai trò món · item roles (`report.role.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.role.drink` | Đồ uống | Drink | — |
| `report.role.topping` | Topping | Topping | — |
| `report.role.food` | Đồ ăn | Food | — |
| `report.role.snack` | Đồ ăn nhẹ | Snack | — |
| `report.role.other` | Khác | Other | — |
| `report.role.unmapped` | Chưa gán vai trò | No role yet | — |

### Nhãn khác · other labels (`report.label.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.label.unknownCashier` | chưa rõ thu ngân | unknown cashier | — |
| `report.label.unnamed` | không tên | unnamed | — |
| `report.label.uncategorised` | Chưa phân loại | Uncategorised | — |

### Tên dòng theo kỳ trong bảng · period rows (`report.periodRow.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.periodRow.current` | Kỳ này | This period | — |
| `report.periodRow.previous` | Kỳ trước | Previous period | — |
| `report.periodRow.lastYear` | Năm trước | Last year | — |
| `report.periodRow.baseline` | Mức nền | Baseline | — |
| `report.periodRow.average4Weeks` | Trung bình 4 tuần | 4-week average | — |

### Trạng thái không so sánh được và thông báo · unavailable states and notices (`report.unavailable.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.unavailable.no_data.previous` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_data.last_year` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_data.baseline` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_data.average_4_weeks` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_data.forecast` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_data.target` | chưa có dữ liệu | no data yet | — |
| `report.unavailable.no_reference.previous` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.no_reference.last_year` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.no_reference.baseline` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.no_reference.average_4_weeks` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.no_reference.forecast` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.no_reference.target` | chưa có số để so sánh | nothing to compare with yet | — |
| `report.unavailable.not_measured.previous` | chưa đo được | not measured | — |
| `report.unavailable.not_measured.last_year` | chưa đo được | not measured | — |
| `report.unavailable.not_measured.baseline` | chưa đo được | not measured | — |
| `report.unavailable.not_measured.average_4_weeks` | chưa đo được | not measured | — |
| `report.unavailable.not_measured.forecast` | chưa đo được | not measured | — |
| `report.unavailable.not_measured.target` | chưa đo được | not measured | — |
| `report.unavailable.not_configured.previous` | chưa thiết lập | not set up | — |
| `report.unavailable.not_configured.last_year` | chưa thiết lập | not set up | — |
| `report.unavailable.not_configured.baseline` | chưa thiết lập | not set up | — |
| `report.unavailable.not_configured.average_4_weeks` | chưa thiết lập | not set up | — |
| `report.unavailable.not_configured.forecast` | chưa thiết lập | not set up | — |
| `report.unavailable.not_configured.target` | chưa thiết lập | not set up | — |
| `report.unavailable.store_too_young.previous` | chưa có dữ liệu kỳ trước | no data for the previous period yet | — |
| `report.unavailable.store_too_young.last_year` | chưa có dữ liệu năm trước | no data from last year yet | — |
| `report.unavailable.store_too_young.baseline` | cửa hàng mới, chưa có mức nền | new store, no baseline yet | — |
| `report.unavailable.store_too_young.average_4_weeks` | cửa hàng mới, chưa đủ 4 tuần | new store, not 4 weeks yet | — |
| `report.unavailable.store_too_young.forecast` | cửa hàng mới, chưa dự báo được | new store, no forecast yet | — |
| `report.unavailable.store_too_young.target` | cửa hàng mới, chưa có mục tiêu | new store, no target yet | — |
| `report.unavailable.building_baseline.previous` | đang tích lũy dữ liệu | still collecting data | — |
| `report.unavailable.building_baseline.last_year` | đang tích lũy dữ liệu | still collecting data | — |
| `report.unavailable.building_baseline.baseline` | đang tích lũy mức nền | building the baseline | — |
| `report.unavailable.building_baseline.average_4_weeks` | đang tích lũy dữ liệu 4 tuần | collecting 4 weeks of data | — |
| `report.unavailable.building_baseline.forecast` | đang tích lũy dữ liệu dự báo | collecting data for the forecast | — |
| `report.unavailable.building_baseline.target` | đang tích lũy dữ liệu | still collecting data | — |

## Ngày · Daily report (`report-day.vi.json`, 88 mục)

### Tiêu đề và trạng thái trống · title and empty state (`report.day.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.title` | Báo cáo ngày | Daily report | — |
| `report.day.noDataNotice` | Chưa có số liệu bán hàng trong ngày này. | No sales recorded on this day. | — |

### Thẻ «Doanh thu thuần» (`report.day.net.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.net.title` | Doanh thu thuần | Net revenue | — |
| `report.day.net.up` | Ngày {day}, doanh thu thuần cao hơn mức nền cùng thứ {delta}. | On {day}, net revenue was {delta} above the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.net.down` | Ngày {day}, doanh thu thuần thấp hơn mức nền cùng thứ {delta}. | On {day}, net revenue was {delta} below the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.net.flat` | Ngày {day}, doanh thu thuần ngang mức nền cùng thứ. | On {day}, net revenue was level with the same-weekday baseline. | `{day}` |
| `report.day.net.noReference` | Ngày {day}, doanh thu thuần đạt {value}; chưa đủ dữ liệu 8 tuần trước để so sánh. | On {day}, net revenue was {value}; the previous 8 weeks do not have enough data to compare. | `{day}` `{value}` |
| `report.day.net.noData` | Ngày {day} chưa có hóa đơn nào. | {day} has no invoices. | `{day}` |
| `report.day.net.chart` | Doanh thu thuần theo cửa hàng so với mức nền | Net revenue by store against the baseline | — |
| `report.day.net.table` | Doanh thu thuần theo cửa hàng | Net revenue by store | — |

### Thẻ «Số hóa đơn» (`report.day.invoices.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.invoices.title` | Số hóa đơn | Invoices | — |
| `report.day.invoices.up` | Ngày {day}, số hóa đơn cao hơn mức nền cùng thứ {delta}. | On {day}, invoices were {delta} above the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.invoices.down` | Ngày {day}, số hóa đơn thấp hơn mức nền cùng thứ {delta}. | On {day}, invoices were {delta} below the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.invoices.flat` | Ngày {day}, số hóa đơn ngang mức nền cùng thứ. | On {day}, invoices were level with the same-weekday baseline. | `{day}` |
| `report.day.invoices.noReference` | Ngày {day} có {value} hóa đơn; chưa đủ dữ liệu 8 tuần trước để so sánh. | On {day} there were {value} invoices; the previous 8 weeks do not have enough data to compare. | `{day}` `{value}` |
| `report.day.invoices.noData` | Ngày {day} chưa có hóa đơn nào. | {day} has no invoices. | `{day}` |
| `report.day.invoices.chart` | Số hóa đơn theo cửa hàng so với mức nền | Invoices by store against the baseline | — |
| `report.day.invoices.table` | Số hóa đơn theo cửa hàng | Invoices by store | — |

### Thẻ «Giá trị trung bình mỗi hóa đơn» (`report.day.avgTicket.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.avgTicket.title` | Giá trị trung bình mỗi hóa đơn | Average ticket | — |
| `report.day.avgTicket.up` | Ngày {day}, giá trị trung bình mỗi hóa đơn cao hơn mức nền cùng thứ {delta}. | On {day}, the average ticket was {delta} above the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.avgTicket.down` | Ngày {day}, giá trị trung bình mỗi hóa đơn thấp hơn mức nền cùng thứ {delta}. | On {day}, the average ticket was {delta} below the same-weekday baseline. | `{day}` `{delta}` |
| `report.day.avgTicket.flat` | Ngày {day}, giá trị trung bình mỗi hóa đơn ngang mức nền cùng thứ. | On {day}, the average ticket was level with the same-weekday baseline. | `{day}` |
| `report.day.avgTicket.noReference` | Ngày {day}, giá trị trung bình mỗi hóa đơn là {value}; chưa đủ dữ liệu 8 tuần trước để so sánh. | On {day}, the average ticket was {value}; the previous 8 weeks do not have enough data to compare. | `{day}` `{value}` |
| `report.day.avgTicket.noData` | Ngày {day} chưa có hóa đơn nào nên chưa có giá trị trung bình. | {day} has no invoices, so there is no average ticket. | `{day}` |
| `report.day.avgTicket.table` | Giá trị hóa đơn, số món và giá món | Ticket, items per ticket and item price | — |

### Thẻ «Theo giờ so với thường lệ» (`report.day.hourly.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.hourly.title` | Theo giờ so với thường lệ | By hour against usual | — |
| `report.day.hourly.caption` | lúc {hour} | at {hour} | `{hour}` |
| `report.day.hourly.peak` | Cao điểm lúc {hour} với {value}; khung 20–22 giờ chiếm {share} doanh thu. | The peak was at {hour} with {value}; 20:00–22:00 brought {share} of the revenue. | `{hour}` `{value}` `{share}` |
| `report.day.hourly.peakWithoutShare` | Cao điểm lúc {hour} với {value}. | The peak was at {hour} with {value}. | `{hour}` `{value}` |
| `report.day.hourly.noData` | Ngày {day} chưa có doanh thu để vẽ theo giờ. | {day} has no revenue to plot by hour. | `{day}` |
| `report.day.hourly.shareCompare` | khung 20–22 giờ so với hôm trước | 20:00–22:00 share vs the day before | — |
| `report.day.hourly.noBaseline` | Chưa có mức nền theo giờ: cần dữ liệu của cùng thứ trong 8 tuần trước. | No hourly baseline yet: it needs data from the same weekday in the previous 8 weeks. | — |
| `report.day.hourly.chart` | Doanh thu thuần theo giờ so với thường lệ | Net revenue by hour against usual | — |
| `report.day.hourly.table` | Doanh thu theo giờ | Revenue by hour | — |

### Thẻ «5 món bán chạy» (`report.day.items.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.items.title` | 5 món bán chạy | Top 5 items | — |
| `report.day.items.caption` | {item} | {item} | `{item}` |
| `report.day.items.leader` | {item} bán chạy nhất với {quantity} phần, chiếm {share} doanh thu món. | {item} sold best with {quantity} sold, {share} of item revenue. | `{item}` `{quantity}` `{share}` |
| `report.day.items.mover` | So với hôm trước, {item} thay đổi doanh thu nhiều nhất ({delta}). | Against the day before, {item} changed its revenue the most ({delta}). | `{item}` `{delta}` |
| `report.day.items.noData` | Ngày {day} chưa bán món nào. | No items were sold on {day}. | `{day}` |
| `report.day.items.chart` | Doanh thu 5 món bán chạy so với hôm trước | Revenue of the top 5 items against the day before | — |
| `report.day.items.table` | 5 món bán chạy | Top 5 items | — |

### Thẻ «Thanh toán và tiền mặt cần đếm» (`report.day.payments.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.payments.title` | Thanh toán và tiền mặt cần đếm | Payments and cash to count | — |
| `report.day.payments.caption` | tiền mặt cần đếm | cash to count | — |
| `report.day.payments.leader` | {kind} chiếm nhiều nhất: {share} số tiền thu. | {kind} took the most: {share} of the money received. | `{kind}` `{share}` |
| `report.day.payments.cash` | Tiền mặt cần đếm: {amount}. | Cash to count: {amount}. | `{amount}` |
| `report.day.payments.noData` | Ngày {day} chưa có khoản thanh toán nào. | {day} has no payments. | `{day}` |
| `report.day.payments.shareCompare` | tỷ trọng tiền mặt so với hôm trước | cash share vs the day before | — |
| `report.day.payments.chart` | Cơ cấu thanh toán theo loại, hôm trước và ngày này | Payment mix by kind, the day before and this day | — |
| `report.day.payments.table` | Thanh toán theo phương thức | Payments by method | — |

### Thẻ «Ca và chênh lệch két» (`report.day.shifts.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.shifts.title` | Ca và chênh lệch két | Shifts and drawer variance | — |
| `report.day.shifts.caption` | trên {count} ca | of {count} shifts | `{count}` |
| `report.day.shifts.none` | Không ca nào lệch két vượt ngưỡng trong {count} ca. | None of the {count} shifts had a drawer variance over the thresholds. | `{count}` |
| `report.day.shifts.largest` | {count} ca lệch két vượt ngưỡng; lớn nhất là {shift} ({cashier}): {variance}, {reasons}. | {count} shifts were over the thresholds; the largest was {shift} ({cashier}): {variance}, {reasons}. | `{count}` `{shift}` `{cashier}` `{variance}` `{reasons}` |
| `report.day.shifts.noData` | Ngày {day} không có ca nào. | {day} has no shifts. | `{day}` |
| `report.day.shifts.noShifts` | Chưa có ca nào trong ngày; kiểm tra thu ngân có mở và đóng ca trên POS không. | No shifts on this day; check that cashiers open and close shifts on the POS. | — |
| `report.day.shifts.chart` | Chênh lệch két theo ca | Drawer variance by shift | — |
| `report.day.shifts.over` | Thừa tiền | Over | — |
| `report.day.shifts.short` | Thiếu tiền | Short | — |
| `report.day.shifts.table` | Các ca trong ngày | Shifts of the day | — |

### Thẻ «Giảm giá và voucher» (`report.day.discounts.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.discounts.title` | Giảm giá và voucher | Discounts and vouchers | — |
| `report.day.discounts.caption` | {rate} doanh thu gộp | {rate} of gross revenue | `{rate}` |
| `report.day.discounts.up` | Ngày {day}, chi phí giảm giá là {value}, cao hơn hôm trước {delta}. | On {day}, discounts cost {value}, {delta} more than the day before. | `{day}` `{value}` `{delta}` |
| `report.day.discounts.down` | Ngày {day}, chi phí giảm giá là {value}, thấp hơn hôm trước {delta}. | On {day}, discounts cost {value}, {delta} less than the day before. | `{day}` `{value}` `{delta}` |
| `report.day.discounts.flat` | Ngày {day}, chi phí giảm giá là {value}, ngang hôm trước. | On {day}, discounts cost {value}, level with the day before. | `{day}` `{value}` |
| `report.day.discounts.noReference` | Ngày {day}, chi phí giảm giá là {value}; hôm trước không có số để so sánh. | On {day}, discounts cost {value}; there is nothing from the day before to compare with. | `{day}` `{value}` |
| `report.day.discounts.noData` | Ngày {day} chưa có hóa đơn nào. | {day} has no invoices. | `{day}` |
| `report.day.discounts.none` | Ngày {day} không có giảm giá hay voucher nào. | {day} had no discounts or vouchers. | `{day}` |
| `report.day.discounts.largestPromotion` | Lớn nhất là {promotion}: {amount}. | The largest was {promotion}: {amount}. | `{promotion}` `{amount}` |
| `report.day.discounts.largestPromotionUnnamed` | Lớn nhất là một khoản không tên thuộc loại {kind}: {amount}. | The largest was an unnamed {kind}: {amount}. | `{kind}` `{amount}` |
| `report.day.discounts.rateComparePrevious` | tỷ lệ giảm giá so với hôm trước | discount rate vs the day before | — |
| `report.day.discounts.rateCompareLastYear` | tỷ lệ giảm giá so với cùng thứ năm trước | discount rate vs the same weekday last year | — |
| `report.day.discounts.chart` | Giảm giá món, hóa đơn và voucher | Item, bill and voucher discounts | — |
| `report.day.discounts.table` | Khuyến mãi đã dùng | Promotions used | — |
| `report.day.discounts.componentsTable` | Thành phần giảm giá | Discount components | — |

### Thẻ «Hóa đơn có số điện thoại thành viên» (`report.day.members.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.members.title` | Hóa đơn có số điện thoại thành viên | Invoices with a member phone number | — |
| `report.day.members.up` | Ngày {day}, {value} hóa đơn có số điện thoại thành viên, cao hơn hôm trước. | On {day}, {value} of invoices had a member phone number, more than the day before. | `{day}` `{value}` |
| `report.day.members.down` | Ngày {day}, {value} hóa đơn có số điện thoại thành viên, thấp hơn hôm trước. | On {day}, {value} of invoices had a member phone number, fewer than the day before. | `{day}` `{value}` |
| `report.day.members.flat` | Ngày {day}, {value} hóa đơn có số điện thoại thành viên, ngang hôm trước. | On {day}, {value} of invoices had a member phone number, level with the day before. | `{day}` `{value}` |
| `report.day.members.noReference` | Ngày {day}, {value} hóa đơn có số điện thoại thành viên. | On {day}, {value} of invoices had a member phone number. | `{day}` `{value}` |
| `report.day.members.noData` | Ngày {day} chưa có hóa đơn nào. | {day} has no invoices. | `{day}` |
| `report.day.members.zero` | Chưa hóa đơn nào có số điện thoại thành viên; nhắc thu ngân hỏi số khi thanh toán. | No invoice had a member phone number yet; remind cashiers to ask for it at payment. | — |
| `report.day.members.lowestStore` | {store} có tỷ lệ thấp nhất ({share}). | {store} has the lowest share ({share}). | `{store}` `{share}` |
| `report.day.members.table` | Hóa đơn có thành viên theo cửa hàng | Member invoices by store | — |

### Tên cột bảng · table columns (`report.day.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.day.table.previousDay` | Hôm trước | Day before | — |
| `report.day.table.lastYearDay` | Cùng thứ năm trước | Same weekday last year | — |
| `report.day.table.changeBaseline` | So với mức nền | vs baseline | — |
| `report.day.table.changePrevious` | So với hôm trước | vs day before | — |
| `report.day.table.changeLastYear` | So với năm trước | vs last year | — |

## Tuần · Weekly report (`report-week.vi.json`, 112 mục)

### Tiêu đề và trạng thái trống · title and empty state (`report.week.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.title` | Báo cáo tuần | Weekly report | — |
| `report.week.partial` | đến hết {end} | through {end} | `{end}` |
| `report.week.noDataNotice` | Chưa có số liệu bán hàng trong tuần này. | No sales recorded in this week yet. | — |

### Nhãn so sánh (chip) · comparison chips (`report.week.compare.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.compare.average4WeeksLikeForLike` | so với trung bình {weeks} tuần · cùng cửa hàng ({covered}/{total}) | vs the {weeks}-week average · same stores ({covered}/{total}) | `{weeks}` `{covered}` `{total}` |

### Tên dòng theo kỳ trong bảng · period rows (`report.week.periodRow.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.periodRow.current` | Tuần này | This week | — |
| `report.week.periodRow.previous` | Tuần trước | Last week | — |
| `report.week.periodRow.average4Weeks` | Trung bình 4 tuần | 4-week average | — |
| `report.week.periodRow.average4WeeksLikeForLike` | Trung bình 4 tuần · cùng cửa hàng | 4-week average · same stores | — |
| `report.week.periodRow.lastYear` | Cùng tuần năm trước | Same week last year | — |

### Thẻ «Doanh thu tuần» (`report.week.net.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.net.title` | Doanh thu tuần | Weekly revenue | — |
| `report.week.net.up` | Doanh thu thuần {period} cao hơn tuần trước {delta}. | Net revenue in {period} was {delta} above last week. | `{period}` `{delta}` |
| `report.week.net.down` | Doanh thu thuần {period} thấp hơn tuần trước {delta}. | Net revenue in {period} was {delta} below last week. | `{period}` `{delta}` |
| `report.week.net.flat` | Doanh thu thuần {period} ngang tuần trước. | Net revenue in {period} was level with last week. | `{period}` |
| `report.week.net.noReference` | Doanh thu thuần {period} đạt {value}; chưa có tuần trước để so sánh. | Net revenue in {period} was {value}; there is no last week to compare with yet. | `{period}` `{value}` |
| `report.week.net.noData` | Chưa có hóa đơn nào trong {period}. | There are no invoices in {period} yet. | `{period}` |
| `report.week.net.chart` | Doanh thu thuần tuần này, tuần trước, trung bình 4 tuần và cùng tuần năm trước | Net revenue this week, last week, the 4-week average and the same week last year | — |
| `report.week.net.storeTable` | Doanh thu thuần theo cửa hàng | Net revenue by store | — |
| `report.week.net.periodTable` | Doanh thu thuần theo kỳ | Net revenue by period | — |

### Thẻ «Hóa đơn tuần» (`report.week.invoices.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.invoices.title` | Hóa đơn tuần | Weekly invoices | — |
| `report.week.invoices.up` | Số hóa đơn {period} cao hơn tuần trước {delta}. | Invoices in {period} were {delta} above last week. | `{period}` `{delta}` |
| `report.week.invoices.down` | Số hóa đơn {period} thấp hơn tuần trước {delta}. | Invoices in {period} were {delta} below last week. | `{period}` `{delta}` |
| `report.week.invoices.flat` | Số hóa đơn {period} ngang tuần trước. | Invoices in {period} were level with last week. | `{period}` |
| `report.week.invoices.noReference` | Có {value} hóa đơn trong {period}; chưa có tuần trước để so sánh. | There were {value} invoices in {period}; there is no last week to compare with yet. | `{value}` `{period}` |
| `report.week.invoices.noData` | Chưa có hóa đơn nào trong {period}. | There are no invoices in {period} yet. | `{period}` |
| `report.week.invoices.chart` | Số hóa đơn tuần này, tuần trước, trung bình 4 tuần và cùng tuần năm trước | Invoices this week, last week, the 4-week average and the same week last year | — |
| `report.week.invoices.storeTable` | Số hóa đơn theo cửa hàng | Invoices by store | — |
| `report.week.invoices.periodTable` | Số hóa đơn theo kỳ | Invoices by period | — |

### Thẻ «Giá trị hóa đơn tuần» (`report.week.avgTicket.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.avgTicket.title` | Giá trị hóa đơn tuần | Weekly average ticket | — |
| `report.week.avgTicket.up` | Giá trị trung bình mỗi hóa đơn {period} cao hơn tuần trước {delta}. | The average ticket in {period} was {delta} above last week. | `{period}` `{delta}` |
| `report.week.avgTicket.down` | Giá trị trung bình mỗi hóa đơn {period} thấp hơn tuần trước {delta}. | The average ticket in {period} was {delta} below last week. | `{period}` `{delta}` |
| `report.week.avgTicket.flat` | Giá trị trung bình mỗi hóa đơn {period} ngang tuần trước. | The average ticket in {period} was level with last week. | `{period}` |
| `report.week.avgTicket.noReference` | Giá trị trung bình mỗi hóa đơn {period} là {value}; chưa có tuần trước để so sánh. | The average ticket in {period} was {value}; there is no last week to compare with yet. | `{period}` `{value}` |
| `report.week.avgTicket.noData` | Chưa có hóa đơn nào trong {period} nên chưa có giá trị trung bình. | There are no invoices in {period} yet, so there is no average ticket. | `{period}` |
| `report.week.avgTicket.table` | Giá trị hóa đơn, số món và giá món theo kỳ | Average ticket, items per ticket and item price by period | — |

### Thẻ «Đường theo ngày trong tuần» (`report.week.curve.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.curve.title` | Đường theo ngày trong tuần | Curve across the week | — |
| `report.week.curve.caption` | {weekday}, {date} | {weekday}, {date} | `{weekday}` `{date}` |
| `report.week.curve.main` | {weekday} mạnh nhất tuần với {value}, chiếm {share} doanh thu tuần. | {weekday} was the strongest day of the week with {value}, {share} of the week's revenue. | `{weekday}` `{value}` `{share}` |
| `report.week.curve.noData` | Chưa có doanh thu nào trong {period}. | There is no revenue in {period} yet. | `{period}` |
| `report.week.curve.driver` | {weekday} lệch nhiều nhất so với trung bình 4 tuần cùng thứ ({delta}). | {weekday} moved furthest from its 4-week same-weekday average ({delta}). | `{weekday}` `{delta}` |
| `report.week.curve.chart` | Doanh thu thuần từng ngày so với tuần trước và trung bình 4 tuần cùng thứ | Net revenue by day against last week and the 4-week same-weekday average | — |
| `report.week.curve.table` | Doanh thu theo ngày trong tuần | Revenue by day of the week | — |
| `report.week.curve.averageSeries` | TB 4 tuần | 4-week avg | — |
| `report.week.curve.averageSeriesLikeForLike` | TB 4 tuần · cùng cửa hàng | 4-week avg · same stores | — |

### Thẻ «Món tăng, món giảm» (`report.week.movers.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.movers.title` | Món tăng, món giảm | Rising and falling items | — |
| `report.week.movers.window` | 28 ngày đến {end} so với 28 ngày trước | 28 days to {end} against the 28 days before | `{end}` |
| `report.week.movers.caption` | {item} | {item} | `{item}` |
| `report.week.movers.captionLikeForLike` | {item} · cùng cửa hàng ({covered}/{total}) | {item} · same stores ({covered}/{total}) | `{item}` `{covered}` `{total}` |
| `report.week.movers.main` | {riser} tăng mạnh nhất ({riserChange} số lượng); {faller} giảm mạnh nhất ({fallerChange}). | {riser} rose the most ({riserChange} in quantity); {faller} fell the most ({fallerChange}). | `{riser}` `{riserChange}` `{faller}` `{fallerChange}` |
| `report.week.movers.risersOnly` | {riser} tăng mạnh nhất ({riserChange} số lượng); không món nào giảm đáng kể. | {riser} rose the most ({riserChange} in quantity); nothing fell noticeably. | `{riser}` `{riserChange}` |
| `report.week.movers.fallersOnly` | Không món nào tăng đáng kể; {faller} giảm mạnh nhất ({fallerChange} số lượng). | Nothing rose noticeably; {faller} fell the most ({fallerChange} in quantity). | `{faller}` `{fallerChange}` |
| `report.week.movers.none` | Chưa món nào bán từ {minimum} phần ở cả hai giai đoạn để so sánh. | No item sold {minimum} units in both periods to compare yet. | `{minimum}` |
| `report.week.movers.newItem` | Món mới bán chạy nhất: {item} ({quantity} phần). | Best-selling new item: {item} ({quantity} units). | `{item}` `{quantity}` |
| `report.week.movers.buildingBaseline` | Cần 8 tuần dữ liệu để so 28 ngày gần nhất với 28 ngày trước đó. | It takes 8 weeks of data to compare the last 28 days with the 28 days before. | — |
| `report.week.movers.buildingBaselineSentence` | Cửa hàng chưa đủ 56 ngày dữ liệu nên chưa xếp được món tăng, món giảm. | The stores do not have 56 days of data yet, so items cannot be ranked as rising or falling. | — |
| `report.week.movers.noRiser` | Chưa có món nào tăng mà bán từ {minimum} phần ở cả hai giai đoạn. | No item rose while selling {minimum} units in both periods. | `{minimum}` |
| `report.week.movers.table` | Món tăng, món giảm và món mới trong 28 ngày | Rising, falling and new items over 28 days | — |
| `report.week.movers.group.up` | Tăng | Rising | — |
| `report.week.movers.group.down` | Giảm | Falling | — |
| `report.week.movers.group.new` | Mới | New | — |

### Thẻ «Cơ cấu nhóm món» (`report.week.categories.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.categories.title` | Cơ cấu nhóm món | Category mix | — |
| `report.week.categories.caption` | {category} | {category} | `{category}` |
| `report.week.categories.main` | Nhóm {category} chiếm tỷ trọng lớn nhất: {share} doanh thu món. | The {category} category had the largest share: {share} of item revenue. | `{category}` `{share}` |
| `report.week.categories.noData` | Chưa bán món nào trong {period}. | No items were sold in {period} yet. | `{period}` |
| `report.week.categories.chart` | Tỷ trọng doanh thu theo nhóm món, tuần này và tuần trước | Revenue share by category, this week and last week | — |
| `report.week.categories.table` | Doanh thu theo nhóm món | Revenue by category | — |

### Thẻ «Khuyến mãi đã chạy» (`report.week.promotions.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.promotions.title` | Khuyến mãi đã chạy | Promotions run | — |
| `report.week.promotions.caption` | {rate} doanh thu gộp | {rate} of gross revenue | `{rate}` |
| `report.week.promotions.up` | Chi phí giảm giá {period} là {value}, cao hơn tuần trước {delta}. | Discounts in {period} cost {value}, {delta} more than last week. | `{period}` `{value}` `{delta}` |
| `report.week.promotions.down` | Chi phí giảm giá {period} là {value}, thấp hơn tuần trước {delta}. | Discounts in {period} cost {value}, {delta} less than last week. | `{period}` `{value}` `{delta}` |
| `report.week.promotions.flat` | Chi phí giảm giá {period} là {value}, ngang tuần trước. | Discounts in {period} cost {value}, level with last week. | `{period}` `{value}` |
| `report.week.promotions.noReference` | Chi phí giảm giá {period} là {value}; chưa có tuần trước để so sánh. | Discounts in {period} cost {value}; there is no last week to compare with yet. | `{period}` `{value}` |
| `report.week.promotions.noData` | Chưa có hóa đơn nào trong {period}. | There are no invoices in {period} yet. | `{period}` |
| `report.week.promotions.none` | Tuần này không chạy khuyến mãi. | No promotion ran this week. | — |
| `report.week.promotions.largest` | Tốn nhiều nhất là {promotion}: {amount}. | The costliest was {promotion}: {amount}. | `{promotion}` `{amount}` |
| `report.week.promotions.largestUnnamed` | Tốn nhiều nhất là một khoản không tên thuộc loại {kind}: {amount}. | The costliest was an unnamed {kind}: {amount}. | `{kind}` `{amount}` |
| `report.week.promotions.voucherShare` | {share} hóa đơn có dùng voucher. | {share} of invoices used a voucher. | `{share}` |
| `report.week.promotions.series.item` | Món | Item | — |
| `report.week.promotions.series.bill` | Hóa đơn | Bill | — |
| `report.week.promotions.series.voucher` | Voucher | Voucher | — |
| `report.week.promotions.rateComparePrevious` | tỷ lệ giảm giá so với tuần trước | discount rate vs last week | — |
| `report.week.promotions.chart` | Giảm giá món, hóa đơn và voucher, tuần trước và tuần này | Item, bill and voucher discounts, last week and this week | — |
| `report.week.promotions.table` | Khuyến mãi trong tuần | Promotions this week | — |

### Thẻ «Ngày tốt nhất và kém nhất» (`report.week.days.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.days.title` | Ngày tốt nhất và kém nhất | Best and worst days | — |
| `report.week.days.caption` | {weekday}, {date} | {weekday}, {date} | `{weekday}` `{date}` |
| `report.week.days.main` | Tốt nhất là {bestWeekday} {bestDate} ({bestDeviation} so với mức nền); kém nhất là {worstWeekday} {worstDate} ({worstDeviation}). | The best day was {bestWeekday} {bestDate} ({bestDeviation} against the baseline); the worst was {worstWeekday} {worstDate} ({worstDeviation}). | `{bestWeekday}` `{bestDate}` `{bestDeviation}` `{worstWeekday}` `{worstDate}` `{worstDeviation}` |
| `report.week.days.holiday` | Lưu ý: {weekday} {date} là {holiday}. | Note: {weekday} {date} is marked as {holiday}. | `{weekday}` `{date}` `{holiday}` |
| `report.week.days.tooFew` | Cần ít nhất {minimum} ngày có mức nền cùng thứ để chọn ngày tốt nhất và kém nhất. | It takes at least {minimum} days with a same-weekday baseline to pick the best and worst days. | `{minimum}` |
| `report.week.days.tooFewSentence` | Mới có {count} ngày trong {period} so được với mức nền cùng thứ. | Only {count} days in {period} can be compared with the same-weekday baseline so far. | `{count}` `{period}` |
| `report.week.days.chart` | Chênh lệch doanh thu từng ngày so với mức nền cùng thứ | Each day's revenue against the same-weekday baseline | — |
| `report.week.days.above` | Cao hơn mức nền | Above the baseline | — |
| `report.week.days.below` | Thấp hơn mức nền | Below the baseline | — |
| `report.week.days.table` | Doanh thu từng ngày so với mức nền 8 tuần | Revenue by day against the 8-week baseline | — |

### Tên cột bảng · table columns (`report.week.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.week.table.lastWeek` | Tuần trước | Last week | — |
| `report.week.table.changeLastWeek` | So với tuần trước | Vs last week | — |
| `report.week.table.average4Weeks` | TB 4 tuần | 4-week avg | — |
| `report.week.table.changeAverage4Weeks` | So với TB 4 tuần | Vs 4-week avg | — |
| `report.week.table.lastYear` | Cùng tuần năm trước | Same week last year | — |
| `report.week.table.changeLastYear` | So với năm trước | Vs last year | — |
| `report.week.table.weekdayAverage` | TB 4 tuần cùng thứ | 4-week same-weekday avg | — |
| `report.week.table.weekdayAverageLikeForLike` | TB 4 tuần cùng thứ (cùng cửa hàng) | 4-week same-weekday avg (same stores) | — |
| `report.week.table.changeWeekdayAverage` | So với TB cùng thứ | Vs same-weekday avg | — |
| `report.week.table.shareOfWeek` | Tỷ trọng trong tuần | Share of week | — |
| `report.week.table.recentQuantity` | SL 28 ngày gần nhất | Qty last 28 days | — |
| `report.week.table.priorQuantity` | SL 28 ngày trước | Qty 28 days before | — |
| `report.week.table.quantityChange` | Thay đổi SL | Qty change | — |
| `report.week.table.recentNet` | Doanh thu 28 ngày | Revenue 28 days | — |
| `report.week.table.group` | Nhóm | Group | — |
| `report.week.table.lastWeekShare` | Tỷ trọng tuần trước | Share last week | — |
| `report.week.table.lastWeekDiscount` | Giảm giá tuần trước | Discount last week | — |
| `report.week.table.daysUsed` | Số ngày dùng | Days used | — |
| `report.week.table.deviation` | Lệch so với mức nền | Vs baseline | — |
| `report.week.table.holiday` | Ngày lễ | Holiday | — |

## Tháng · Monthly report (`report-month.vi.json`, 161 mục)

### Tiêu đề và trạng thái trống · title and empty state (`report.month.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.title` | Báo cáo tháng | Monthly report | — |
| `report.month.noDataNotice` | Chưa có số liệu bán hàng trong tháng này. | No sales recorded in this month yet. | — |

### Thẻ «Doanh thu tháng đến nay và nhịp tháng» (`report.month.pace.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.pace.title` | Doanh thu tháng đến nay và nhịp tháng | Month to date and monthly pace | — |
| `report.month.pace.up` | Tháng {month} đến hết ngày {end}, doanh thu thuần đạt {value}, cao hơn cùng kỳ tháng trước {delta}. | In {month} up to {end}, net revenue reached {value}, {delta} above the same days of last month. | `{month}` `{end}` `{value}` `{delta}` |
| `report.month.pace.down` | Tháng {month} đến hết ngày {end}, doanh thu thuần đạt {value}, thấp hơn cùng kỳ tháng trước {delta}. | In {month} up to {end}, net revenue reached {value}, {delta} below the same days of last month. | `{month}` `{end}` `{value}` `{delta}` |
| `report.month.pace.flat` | Tháng {month} đến hết ngày {end}, doanh thu thuần đạt {value}, ngang cùng kỳ tháng trước. | In {month} up to {end}, net revenue reached {value}, level with the same days of last month. | `{month}` `{end}` `{value}` |
| `report.month.pace.noReference` | Tháng {month} đến hết ngày {end}, doanh thu thuần đạt {value}; tháng trước chưa có số để so sánh. | In {month} up to {end}, net revenue reached {value}; last month has no figure to compare with. | `{month}` `{end}` `{value}` |
| `report.month.pace.noData` | Tháng {month} chưa có hóa đơn nào. | {month} has no invoices yet. | `{month}` |
| `report.month.pace.closed` | Tháng {month} khép lại với doanh thu thuần {value}. | {month} closed with net revenue of {value}. | `{month}` `{value}` |
| `report.month.pace.closedUp` | Cao hơn tháng trước {delta}. | That is {delta} above last month. | `{delta}` |
| `report.month.pace.closedDown` | Thấp hơn tháng trước {delta}. | That is {delta} below last month. | `{delta}` |
| `report.month.pace.closedFlat` | Ngang tháng trước. | That is level with last month. | — |
| `report.month.pace.forecast` | Cả tháng dự kiến đạt {value} ({delta} so với cả tháng trước), theo {method}. | The whole month is heading for {value} ({delta} against the whole of last month), by the {method}. | `{value}` `{delta}` `{method}` |
| `report.month.pace.forecastOnly` | Cả tháng dự kiến đạt {value}, theo {method}. | The whole month is heading for {value}, by the {method}. | `{value}` `{method}` |
| `report.month.pace.noForecast` | Chưa đủ dữ liệu của những tuần gần đây để dự báo cả tháng. | The recent weeks do not have enough data to forecast the whole month. | — |
| `report.month.pace.chart` | Doanh thu thuần lũy kế theo ngày, các mức dự báo và mục tiêu | Cumulative net revenue by day, the forecasts and the target | — |
| `report.month.pace.cumulative` | Doanh thu lũy kế | Cumulative revenue | — |
| `report.month.pace.targetLine` | mục tiêu | target | — |
| `report.month.pace.table` | Tháng này so với tháng trước, năm trước, dự báo và mục tiêu | This month against last month, last year, the forecasts and the target | — |
| `report.month.pace.row.monthToDate` | Tháng này | This month | — |
| `report.month.pace.row.previousSameDays` | Cùng kỳ tháng trước | Same days of last month | — |
| `report.month.pace.row.lastYearSameDays` | Cùng kỳ năm trước | Same days last year | — |
| `report.month.pace.row.previousMonth` | Cả tháng trước | The whole of last month | — |
| `report.month.pace.row.forecastWeekdayProfile` | Dự báo theo đặc trưng ngày trong tuần | Weekday-profile forecast | — |
| `report.month.pace.row.forecastSeasonalNaive` | Dự báo mùa vụ đơn giản | Seasonal-naïve forecast | — |
| `report.month.pace.row.target` | Mục tiêu tháng | Monthly target | — |

### Thẻ «Xu hướng theo ngày» (`report.month.days.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.days.title` | Xu hướng theo ngày | Day-by-day trend | — |
| `report.month.days.main` | Ngày tốt nhất của tháng {month} là {best} ({bestDelta} so với mức nền), kém nhất là {worst} ({worstDelta}). | The best day of {month} was {best} ({bestDelta} against the baseline), the weakest {worst} ({worstDelta}). | `{month}` `{best}` `{bestDelta}` `{worst}` `{worstDelta}` |
| `report.month.days.average` | Tháng {month} bình quân {value} mỗi ngày có bán trên {days} ngày; chưa đủ mức nền để so từng ngày. | {month} averaged {value} per trading day over {days} days; there is not enough baseline to compare each day. | `{month}` `{value}` `{days}` |
| `report.month.days.noData` | Tháng {month} chưa có ngày nào có hóa đơn. | {month} has no day with invoices yet. | `{month}` |
| `report.month.days.holidayNote` | Lưu ý ngày {day} ({holiday}) không phải ngày bình thường. | Note that {day} ({holiday}) was not an ordinary day. | `{day}` `{holiday}` |
| `report.month.days.closed` | Đóng cửa | Closed | — |
| `report.month.days.chart` | Doanh thu thuần theo ngày so với mức nền cùng thứ | Net revenue by day against the same-weekday baseline | — |
| `report.month.days.regularDays` | Ngày thường | Ordinary days | — |
| `report.month.days.holidayDays` | Ngày lễ, Tết | Holidays and Tết | — |
| `report.month.days.table` | Doanh thu từng ngày trong tháng | Revenue for each day of the month | — |

### Thẻ «Pareto món (đường 80 %)» (`report.month.pareto.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.pareto.title` | Pareto món (đường 80 %) | Item Pareto (80 % line) | — |
| `report.month.pareto.caption` | món tạo 80 % doanh thu món | items make 80 % of item revenue | — |
| `report.month.pareto.main` | Tháng {month}, {count} trên {total} món tạo 80 % doanh thu món; {item} dẫn đầu với {share}. | In {month}, {count} of {total} items made 80 % of item revenue; {item} led with {share}. | `{month}` `{count}` `{total}` `{item}` `{share}` |
| `report.month.pareto.previous` | Cùng kỳ tháng trước cần {count} trên {total} món. | The same days of last month needed {count} of {total} items. | `{count}` `{total}` |
| `report.month.pareto.previousLikeForLike` | Tính trên {covered}/{stores} cửa hàng có đủ dữ liệu, tháng này cần {current} món, cùng kỳ tháng trước cần {count} món. | Over the {covered} of {stores} stores with enough history, this month needed {current} items and the same days of last month {count}. | `{covered}` `{stores}` `{current}` `{count}` |
| `report.month.pareto.noData` | Tháng {month} chưa bán món nào. | No items were sold in {month}. | `{month}` |
| `report.month.pareto.chart` | Doanh thu 20 món dẫn đầu và tỷ trọng lũy kế | Revenue of the top 20 items and the cumulative share | — |
| `report.month.pareto.line` | ngưỡng | threshold | — |
| `report.month.pareto.otherItems` | Các món còn lại | All other items | — |
| `report.month.pareto.table` | Món theo doanh thu và tỷ trọng lũy kế | Items by revenue with the cumulative share | — |

### Thẻ «Cơ cấu size» (`report.month.size.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.size.title` | Cơ cấu size | Size mix | — |
| `report.month.size.up` | Tháng {month}, size L chiếm {value} lượng món bán theo size, cao hơn cùng kỳ tháng trước {points} điểm %. | In {month}, size L made {value} of the quantity sold by size, {points} points above the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.size.down` | Tháng {month}, size L chiếm {value} lượng món bán theo size, thấp hơn cùng kỳ tháng trước {points} điểm %. | In {month}, size L made {value} of the quantity sold by size, {points} points below the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.size.flat` | Tháng {month}, size L chiếm {value} lượng món bán theo size, ngang cùng kỳ tháng trước. | In {month}, size L made {value} of the quantity sold by size, level with the same days of last month. | `{month}` `{value}` |
| `report.month.size.noReference` | Tháng {month}, size L chiếm {value} lượng món bán theo size. | In {month}, size L made {value} of the quantity sold by size. | `{month}` `{value}` |
| `report.month.size.noData` | Tháng {month} chưa đo được tỷ trọng size L. | The size L share of {month} is not measured. | `{month}` |
| `report.month.size.notMeasured` | Chưa có món bán theo size. | No items are sold by size. | — |
| `report.month.size.chart` | Tỷ trọng size L của 10 đồ uống bán nhiều nhất | Size L share of the 10 best-selling drinks | — |
| `report.month.size.table` | Size L theo đồ uống | Size L by drink | — |

### Thẻ «Tỷ lệ kèm topping và đồ ăn nhẹ» (`report.month.attach.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.attach.title` | Tỷ lệ kèm topping và đồ ăn nhẹ | Topping and snack attach rates | — |
| `report.month.attach.caption` | kèm đồ ăn nhẹ {value} | snack attached {value} | `{value}` |
| `report.month.attach.up` | Tháng {month}, {value} hóa đơn có đồ uống được kèm topping, cao hơn cùng kỳ tháng trước {points} điểm %. | In {month}, {value} of invoices with a drink added a topping, {points} points above the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.attach.down` | Tháng {month}, {value} hóa đơn có đồ uống được kèm topping, thấp hơn cùng kỳ tháng trước {points} điểm %. | In {month}, {value} of invoices with a drink added a topping, {points} points below the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.attach.flat` | Tháng {month}, {value} hóa đơn có đồ uống được kèm topping, ngang cùng kỳ tháng trước. | In {month}, {value} of invoices with a drink added a topping, level with the same days of last month. | `{month}` `{value}` |
| `report.month.attach.noReference` | Tháng {month}, {value} hóa đơn có đồ uống được kèm topping. | In {month}, {value} of invoices with a drink added a topping. | `{month}` `{value}` |
| `report.month.attach.noData` | Tháng {month} chưa đo được tỷ lệ kèm topping. | The topping attach rate of {month} is not measured. | `{month}` |
| `report.month.attach.notConfigured` | Chưa gán vai trò món. | Item roles are not assigned yet. | — |
| `report.month.attach.toppingNotConfigured` | Chưa có nhóm món nào mang vai trò topping. | No item type carries the topping role yet. | — |
| `report.month.attach.mover` | {rate} thay đổi nhiều hơn ({delta}). | {rate} moved more ({delta}). | `{rate}` `{delta}` |
| `report.month.attach.topping` | Kèm topping | Topping attached | — |
| `report.month.attach.snack` | Kèm đồ ăn nhẹ | Snack attached | — |
| `report.month.attach.toppingPrevious` | kèm topping so với tháng trước | topping vs last month | — |
| `report.month.attach.toppingLastYear` | kèm topping so với cùng tháng năm trước | topping vs the same month last year | — |
| `report.month.attach.snackPrevious` | kèm đồ ăn nhẹ so với tháng trước | snack vs last month | — |
| `report.month.attach.snackLastYear` | kèm đồ ăn nhẹ so với cùng tháng năm trước | snack vs the same month last year | — |
| `report.month.attach.chart` | Tỷ lệ kèm tháng này, cùng kỳ tháng trước và năm trước | Attach rates this month, the same days of last month and last year | — |
| `report.month.attach.table` | Tỷ lệ kèm topping và đồ ăn nhẹ | Topping and snack attach rates | — |

### Thẻ «Món mới» (`report.month.newItems.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.newItems.title` | Món mới | New items | — |
| `report.month.newItems.caption` | {item} | {item} | `{item}` |
| `report.month.newItems.main` | Tháng {month} có {count} món mới; {item} bán tốt nhất, đứng thứ {rank}/{total} theo doanh thu món. | {month} has {count} new items; {item} sold best and ranks {rank} of {total} by item revenue. | `{month}` `{count}` `{item}` `{rank}` `{total}` |
| `report.month.newItems.none` | Tháng {month} chưa có món mới nào. | {month} has no new items. | `{month}` |
| `report.month.newItems.tooYoung` | Cửa hàng mới mở: chưa xác định món mới. | New store: new items cannot be told apart yet. | — |
| `report.month.newItems.unknown` | Tháng {month} chưa xác định được món mới vì cửa hàng chưa có dữ liệu tháng trước. | New items of {month} cannot be told apart because the store has no data from last month. | `{month}` |
| `report.month.newItems.table` | Món bán lần đầu trong tháng | Items first sold this month | — |

### Thẻ «Cơ cấu thanh toán» (`report.month.payments.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.payments.title` | Cơ cấu thanh toán | Payment mix | — |
| `report.month.payments.up` | Tháng {month}, tiền mặt chiếm {value} số tiền thu, cao hơn cùng kỳ tháng trước {points} điểm %. | In {month}, cash made {value} of the money received, {points} points above the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.payments.down` | Tháng {month}, tiền mặt chiếm {value} số tiền thu, thấp hơn cùng kỳ tháng trước {points} điểm %. | In {month}, cash made {value} of the money received, {points} points below the same days of last month. | `{month}` `{value}` `{points}` |
| `report.month.payments.flat` | Tháng {month}, tiền mặt chiếm {value} số tiền thu, ngang cùng kỳ tháng trước. | In {month}, cash made {value} of the money received, level with the same days of last month. | `{month}` `{value}` |
| `report.month.payments.noReference` | Tháng {month}, tiền mặt chiếm {value} số tiền thu. | In {month}, cash made {value} of the money received. | `{month}` `{value}` |
| `report.month.payments.noData` | Tháng {month} chưa có khoản thanh toán nào. | {month} has no payments yet. | `{month}` |
| `report.month.payments.sharePrevious` | tỷ trọng tiền mặt so với tháng trước | cash share vs last month | — |
| `report.month.payments.shareLastYear` | tỷ trọng tiền mặt so với cùng tháng năm trước | cash share vs the same month last year | — |
| `report.month.payments.otherMover` | Ngoài tiền mặt, {payment} thay đổi tỷ trọng nhiều nhất ({delta}). | Besides cash, {payment} changed its share the most ({delta}). | `{payment}` `{delta}` |
| `report.month.payments.chart` | Cơ cấu thanh toán theo loại, cùng kỳ tháng trước và tháng này | Payment mix by kind, the same days of last month and this month | — |
| `report.month.payments.table` | Thanh toán theo phương thức | Payments by method | — |

### Thẻ «Chi phí giảm giá» (`report.month.discounts.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.discounts.title` | Chi phí giảm giá | Discount cost | — |
| `report.month.discounts.caption` | {rate} doanh thu gộp | {rate} of gross revenue | `{rate}` |
| `report.month.discounts.up` | Tháng {month}, chi phí giảm giá là {value}, cao hơn cùng kỳ tháng trước {delta}. | In {month}, discounts cost {value}, {delta} more than the same days of last month. | `{month}` `{value}` `{delta}` |
| `report.month.discounts.down` | Tháng {month}, chi phí giảm giá là {value}, thấp hơn cùng kỳ tháng trước {delta}. | In {month}, discounts cost {value}, {delta} less than the same days of last month. | `{month}` `{value}` `{delta}` |
| `report.month.discounts.flat` | Tháng {month}, chi phí giảm giá là {value}, ngang cùng kỳ tháng trước. | In {month}, discounts cost {value}, level with the same days of last month. | `{month}` `{value}` |
| `report.month.discounts.noReference` | Tháng {month}, chi phí giảm giá là {value}; tháng trước chưa có số để so sánh. | In {month}, discounts cost {value}; last month has no figure to compare with. | `{month}` `{value}` |
| `report.month.discounts.noData` | Tháng {month} chưa có hóa đơn nào. | {month} has no invoices yet. | `{month}` |
| `report.month.discounts.none` | Tháng {month} không có giảm giá hay voucher nào. | {month} had no discounts or vouchers. | `{month}` |
| `report.month.discounts.largestPromotion` | Lớn nhất là {promotion}: {amount}, {share} chi phí giảm giá. | The largest was {promotion}: {amount}, {share} of the discount cost. | `{promotion}` `{amount}` `{share}` |
| `report.month.discounts.largestPromotionUnnamed` | Lớn nhất là một khoản không tên thuộc loại {kind}: {amount}, {share} chi phí giảm giá. | The largest was an unnamed {kind}: {amount}, {share} of the discount cost. | `{kind}` `{amount}` `{share}` |
| `report.month.discounts.ratePrevious` | tỷ lệ giảm giá so với tháng trước | discount rate vs last month | — |
| `report.month.discounts.chart` | Giảm giá món, hóa đơn và voucher: năm trước, tháng trước và tháng này | Item, bill and voucher discounts: last year, last month and this month | — |
| `report.month.discounts.table` | Khuyến mãi đã dùng trong tháng | Promotions used this month | — |
| `report.month.discounts.componentsTable` | Thành phần giảm giá | Discount components | — |

### Thẻ «Thống kê ca» (`report.month.shifts.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.shifts.title` | Thống kê ca | Shift statistics | — |
| `report.month.shifts.caption` | trên {count} ca | of {count} shifts | `{count}` |
| `report.month.shifts.main` | Tháng {month} có {count} trên {total} ca lệch két vượt ngưỡng; thu ngân lệch nhiều nhất là {cashier} ({cashierFlags} ca), ca làm lệch nhiều nhất là {shift} ({shiftFlags} ca). | In {month}, {count} of {total} shifts had a drawer variance over the thresholds; the cashier with the most was {cashier} ({cashierFlags}), the shift with the most {shift} ({shiftFlags}). | `{month}` `{count}` `{total}` `{cashier}` `{cashierFlags}` `{shift}` `{shiftFlags}` |
| `report.month.shifts.none` | Tháng {month} không ca nào lệch két vượt ngưỡng trong {count} ca. | In {month}, none of the {count} shifts had a drawer variance over the thresholds. | `{month}` `{count}` |
| `report.month.shifts.noData` | Tháng {month} không có ca nào. | {month} has no shifts. | `{month}` |
| `report.month.shifts.noShifts` | Chưa có ca nào trong tháng; kiểm tra thu ngân có mở và đóng ca trên POS không. | No shifts this month; check that cashiers open and close shifts on the POS. | — |
| `report.month.shifts.chart` | Ca lệch két vượt ngưỡng theo thu ngân | Shifts over the thresholds by cashier | — |
| `report.month.shifts.flaggedSeries` | Ca vượt ngưỡng | Shifts over the thresholds | — |
| `report.month.shifts.table` | Ca theo thu ngân và ca làm | Shifts by cashier and shift | — |

### Thẻ «Tiến độ mục tiêu» (`report.month.target.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.target.title` | Tiến độ mục tiêu | Target progress | — |
| `report.month.target.caption` | mục tiêu {target} | target {target} | `{target}` |
| `report.month.target.main` | Đã đạt {progress} mục tiêu tháng {month}; cần thêm {needed} mỗi ngày trong {days} ngày còn lại. | {progress} of the {month} target is reached; {needed} a day is needed over the {days} days left. | `{progress}` `{month}` `{needed}` `{days}` |
| `report.month.target.reached` | Đã đạt {progress} mục tiêu tháng {month} ({value} trên {target}). | {progress} of the {month} target is reached ({value} of {target}). | `{progress}` `{month}` `{value}` `{target}` |
| `report.month.target.final` | Tháng {month} đạt {progress} mục tiêu ({value} trên {target}). | {month} reached {progress} of its target ({value} of {target}). | `{month}` `{progress}` `{value}` `{target}` |
| `report.month.target.notSet` | Chưa tính được tiến độ tháng {month} vì chưa đủ mục tiêu của các cửa hàng đã chọn. | Progress for {month} cannot be worked out until every selected store has a target. | `{month}` |
| `report.month.target.missing` | Chưa đặt mục tiêu tháng cho {stores}. | No monthly target is set for {stores}. | `{stores}` |
| `report.month.target.storeMissing` | chưa đặt mục tiêu | no target set | — |
| `report.month.target.forecastClause` | Cả tháng dự kiến đạt {value}, {delta} so với mục tiêu, theo {method}. | The whole month is heading for {value}, {delta} against the target, by the {method}. | `{value}` `{delta}` `{method}` |
| `report.month.target.forecastWeekdayProfile` | dự báo theo đặc trưng ngày trong tuần so với mục tiêu | weekday-profile forecast vs the target | — |
| `report.month.target.forecastSeasonalNaive` | dự báo mùa vụ đơn giản so với mục tiêu | seasonal-naïve forecast vs the target | — |
| `report.month.target.chart` | Doanh thu tháng đến nay so với mục tiêu | Month to date against the target | — |
| `report.month.target.monthToDate` | Tháng đến nay | Month to date | — |
| `report.month.target.target` | Mục tiêu | Target | — |
| `report.month.target.table` | Mục tiêu theo cửa hàng | Targets by store | — |

### Tên cột bảng · table columns (`report.month.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.month.table.mae` | Sai số TB (MAE) | Mean error (MAE) | — |
| `report.month.table.mape` | Sai số % (MAPE) | Mean % error (MAPE) | — |
| `report.month.table.sampleDays` | Số ngày chấm | Days scored | — |
| `report.month.table.rank` | Hạng | Rank | — |
| `report.month.table.cumulativeShare` | Tỷ trọng lũy kế | Cumulative share | — |
| `report.month.table.previousMonthNet` | Cùng kỳ tháng trước | Same days of last month | — |
| `report.month.table.deviation` | So với mức nền | Against the baseline | — |
| `report.month.table.holiday` | Ngày lễ | Holiday | — |
| `report.month.table.drink` | Đồ uống | Drink | — |
| `report.month.table.largeQuantity` | Số lượng size L | Size L quantity | — |
| `report.month.table.sizedQuantity` | Số lượng có size | Quantity with a size | — |
| `report.month.table.largeShare` | Tỷ trọng size L | Size L share | — |
| `report.month.table.previousMonthShare` | Tỷ trọng cùng kỳ tháng trước | Share in the same days of last month | — |
| `report.month.table.changePoints` | Chênh lệch (điểm %) | Change (points) | — |
| `report.month.table.metric` | Chỉ số | Metric | — |
| `report.month.table.thisMonth` | Tháng này | This month | — |
| `report.month.table.previousMonth` | Cùng kỳ tháng trước | Same days of last month | — |
| `report.month.table.lastYearMonth` | Cùng kỳ năm trước | Same days last year | — |
| `report.month.table.firstSold` | Bán lần đầu | First sold | — |
| `report.month.table.feeEstimate` | Phí ước tính | Estimated fee | — |
| `report.month.table.daysUsed` | Số ngày dùng | Days used | — |
| `report.month.table.shifts` | Số ca | Shifts | — |
| `report.month.table.flagged` | Ca vượt ngưỡng | Over the thresholds | — |
| `report.month.table.totalVariance` | Tổng lệch két | Total drawer variance | — |
| `report.month.table.meanVariance` | Lệch két TB mỗi ca | Mean variance per shift | — |
| `report.month.table.largestShortage` | Thiếu nhiều nhất | Largest shortage | — |
| `report.month.table.largestOverage` | Thừa nhiều nhất | Largest overage | — |
| `report.month.table.target` | Mục tiêu | Target | — |
| `report.month.table.monthToDate` | Tháng đến nay | Month to date | — |
| `report.month.table.progress` | Tiến độ | Progress | — |
| `report.month.table.forecast` | Dự báo cả tháng | Whole-month forecast | — |
| `report.month.table.vsTarget` | Dự báo so với mục tiêu | Forecast against the target | — |

## Năm · Yearly report (`report-year.vi.json`, 127 mục)

### Tiêu đề và trạng thái trống · title and empty state (`report.year.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.title` | Báo cáo năm | Yearly report | — |
| `report.year.noSales` | Cửa hàng đang chọn chưa có doanh thu trong năm {year}. | The selected stores have no sales in {year}. | `{year}` |

### Tên cột bảng · table columns (`report.year.table.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.table.year` | Năm | Year | — |
| `report.year.table.total` | Cả năm | Full year | — |
| `report.year.table.lastYearNet` | Cùng tháng năm trước | Same month last year | — |
| `report.year.table.yoy` | So với cùng tháng năm trước | vs the same month last year | — |
| `report.year.table.mom` | So với tháng trước | vs the month before | — |
| `report.year.table.threeMonths` | 3 tháng so với 3 tháng trước | 3 months vs the 3 before | — |
| `report.year.table.avgDailyNet` | TB mỗi ngày | Average per day | — |
| `report.year.table.index` | Chỉ số mùa vụ | Seasonality index | — |
| `report.year.table.lastYearTicket` | TB mỗi hóa đơn năm trước | Last year's average ticket | — |
| `report.year.table.changeLastYear` | So với năm trước | vs last year | — |
| `report.year.table.itemsEffect` | Phần do số món | From items per ticket | — |
| `report.year.table.priceEffect` | Phần do giá món | From item price | — |
| `report.year.table.stage` | Giai đoạn | Stage | — |
| `report.year.table.firstSold` | Bán lần đầu | First sold | — |
| `report.year.table.lastSold` | Bán lần cuối | Last sold | — |
| `report.year.table.quantityYtd` | SL từ đầu năm | Qty year to date | — |
| `report.year.table.quantityLastYtd` | SL cùng kỳ năm trước | Qty same period last year | — |
| `report.year.table.netYtd` | Doanh thu từ đầu năm | Net year to date | — |
| `report.year.table.lastYtd` | Cùng kỳ năm trước | Same period last year | — |
| `report.year.table.week` | Tuần thứ | Week | — |
| `report.year.table.daysWithData` | Ngày có bán | Days with sales | — |
| `report.year.table.changeFirstWeek` | So với tuần đầu | vs the first week | — |
| `report.year.table.likeForLike` | cùng cửa hàng | same stores | — |
| `report.year.table.coveredNet` | Doanh thu, cùng cửa hàng | Net revenue, same stores | — |
| `report.year.table.coveredLastYearNet` | Cùng tháng năm trước, cùng cửa hàng | Same month last year, same stores | — |
| `report.year.table.coveredTicket` | TB mỗi hóa đơn, cùng cửa hàng | Average ticket, same stores | — |

### Thẻ «Doanh thu tháng × năm» (`report.year.matrix.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.matrix.title` | Doanh thu tháng × năm | Revenue by month and year | — |
| `report.year.matrix.caption` | {month} | {month} | `{month}` |
| `report.year.matrix.captionPartial` | {month}, chưa hết tháng | {month}, month not over | `{month}` |
| `report.year.matrix.peak` | Tháng cao nhất năm {year} là {month} với {value}. | The best month of {year} was {month} with {value}. | `{year}` `{month}` `{value}` |
| `report.year.matrix.peakPartial` | Năm {year} chưa có tháng nào trọn vẹn; {month} đến nay đạt {value}. | {year} has no complete month yet; {month} has {value} so far. | `{year}` `{month}` `{value}` |
| `report.year.matrix.noData` | Năm {year} chưa có doanh thu. | {year} has no revenue yet. | `{year}` |
| `report.year.matrix.lastYearUp` | Tháng cao nhất năm {lastYear} là {month} với {value}; năm nay cao hơn {delta}. | The best month of {lastYear} was {month} with {value}; this year's best is {delta} higher. | `{lastYear}` `{month}` `{value}` `{delta}` |
| `report.year.matrix.lastYearDown` | Tháng cao nhất năm {lastYear} là {month} với {value}; năm nay thấp hơn {delta}. | The best month of {lastYear} was {month} with {value}; this year's best is {delta} lower. | `{lastYear}` `{month}` `{value}` `{delta}` |
| `report.year.matrix.lastYearFlat` | Tháng cao nhất năm {lastYear} là {month} với {value}, ngang năm nay. | The best month of {lastYear} was {month} with {value}, level with this year. | `{lastYear}` `{month}` `{value}` |
| `report.year.matrix.lastYearNone` | Năm {lastYear} chưa có dữ liệu để so sánh. | {lastYear} has no data to compare. | `{lastYear}` |
| `report.year.matrix.lastYearUpLikeForLike` | Tính trên {covered}/{total} cửa hàng có đủ dữ liệu, tháng cao nhất năm {lastYear} là {month} với {value}; năm nay {currentMonth} đạt {currentValue}, cao hơn {delta}. | Over the {covered} of {total} stores with enough history, the best month of {lastYear} was {month} with {value}; this year {currentMonth} reached {currentValue}, {delta} higher. | `{covered}` `{total}` `{lastYear}` `{month}` `{value}` `{currentMonth}` `{currentValue}` `{delta}` |
| `report.year.matrix.lastYearDownLikeForLike` | Tính trên {covered}/{total} cửa hàng có đủ dữ liệu, tháng cao nhất năm {lastYear} là {month} với {value}; năm nay {currentMonth} đạt {currentValue}, thấp hơn {delta}. | Over the {covered} of {total} stores with enough history, the best month of {lastYear} was {month} with {value}; this year {currentMonth} reached {currentValue}, {delta} lower. | `{covered}` `{total}` `{lastYear}` `{month}` `{value}` `{currentMonth}` `{currentValue}` `{delta}` |
| `report.year.matrix.lastYearFlatLikeForLike` | Tính trên {covered}/{total} cửa hàng có đủ dữ liệu, tháng cao nhất năm {lastYear} là {month} với {value}; năm nay {currentMonth} đạt {currentValue}, ngang năm trước. | Over the {covered} of {total} stores with enough history, the best month of {lastYear} was {month} with {value}; this year {currentMonth} reached {currentValue}, level with last year. | `{covered}` `{total}` `{lastYear}` `{month}` `{value}` `{currentMonth}` `{currentValue}` |
| `report.year.matrix.table` | Doanh thu thuần theo tháng | Net revenue by month | — |
| `report.year.matrix.partial` | Doanh thu thuần theo tháng; tháng cuối chưa kết thúc | Net revenue by month; the last month is not over | — |

### Thẻ «Tăng trưởng» (`report.year.growth.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.growth.title` | Tăng trưởng | Growth | — |
| `report.year.growth.caption` | {month} so với cùng tháng năm trước | {month} vs the same month last year | `{month}` |
| `report.year.growth.main` | So với cùng tháng năm trước, {rise} tăng mạnh nhất ({riseDelta}) và {fall} giảm nhiều nhất ({fallDelta}). | Against the same month last year, {rise} rose most ({riseDelta}) and {fall} fell most ({fallDelta}). | `{rise}` `{riseDelta}` `{fall}` `{fallDelta}` |
| `report.year.growth.onlyRise` | Không tháng nào giảm rõ rệt so với cùng tháng năm trước; {rise} tăng mạnh nhất ({riseDelta}). | No month fell noticeably against the same month last year; {rise} rose most ({riseDelta}). | `{rise}` `{riseDelta}` |
| `report.year.growth.onlyFall` | Không tháng nào tăng rõ rệt so với cùng tháng năm trước; {fall} giảm nhiều nhất ({fallDelta}). | No month rose noticeably against the same month last year; {fall} fell most ({fallDelta}). | `{fall}` `{fallDelta}` |
| `report.year.growth.flat` | Các tháng đều ngang cùng tháng năm trước. | Every month was level with the same month last year. | — |
| `report.year.growth.noReference` | Chưa có tháng nào so được với cùng tháng năm trước. | No month can be compared with the same month last year yet. | — |
| `report.year.growth.noData` | Năm {year} chưa có tháng nào trọn vẹn. | {year} has no complete month yet. | `{year}` |
| `report.year.growth.noCompleteMonth` | Tăng trưởng tính trên tháng trọn vẹn; năm {year} chưa có tháng nào kết thúc. | Growth uses complete months; no month of {year} has ended yet. | `{year}` |
| `report.year.growth.rise` | Tăng | Up | — |
| `report.year.growth.fall` | Giảm | Down | — |
| `report.year.growth.chart` | Tăng trưởng từng tháng so với cùng tháng năm trước | Monthly growth against the same month last year | — |
| `report.year.growth.table` | Tăng trưởng theo tháng | Growth by month | — |

### Thẻ «Mùa vụ và Tết» (`report.year.seasonality.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.seasonality.title` | Mùa vụ và Tết | Seasonality and Tết | — |
| `report.year.seasonality.caption` | cao điểm {month} | peak {month} | `{month}` |
| `report.year.seasonality.main` | Cao điểm mùa vụ là {month} với chỉ số {index}; thấp nhất là {lowMonth} ({lowIndex}). | The seasonal peak is {month} with an index of {index}; the low is {lowMonth} ({lowIndex}). | `{month}` `{index}` `{lowMonth}` `{lowIndex}` |
| `report.year.seasonality.tooShort` | Chỉ số mùa vụ cần 12 tháng trọn vẹn của cùng cửa hàng; dữ liệu hiện chưa đủ 12 tháng. | The seasonality index needs 12 complete months of the same stores; the data does not cover 12 months yet. | — |
| `report.year.seasonality.tooShortSentence` | Chưa đủ 12 tháng dữ liệu để tính chỉ số mùa vụ. | There are not 12 months of data yet for the seasonality index. | — |
| `report.year.seasonality.tetBoth` | Doanh thu tuần Tết {year} thay đổi {dip} so với 4 tuần trước đó; năm {lastYear}: {lastDip}. | Revenue in the Tết week of {year} changed {dip} against the 4 weeks before; in {lastYear}: {lastDip}. | `{year}` `{dip}` `{lastYear}` `{lastDip}` |
| `report.year.seasonality.tetThisYear` | Doanh thu tuần Tết {year} thay đổi {dip} so với 4 tuần trước đó. | Revenue in the Tết week of {year} changed {dip} against the 4 weeks before. | `{year}` `{dip}` |
| `report.year.seasonality.tetLastYear` | Doanh thu tuần Tết {lastYear} thay đổi {lastDip} so với 4 tuần trước đó. | Revenue in the Tết week of {lastYear} changed {lastDip} against the 4 weeks before. | `{lastYear}` `{lastDip}` |
| `report.year.seasonality.tet` | Tết {year} | Tết {year} | `{year}` |
| `report.year.seasonality.series` | {year} | {year} | `{year}` |
| `report.year.seasonality.chart` | Doanh thu thuần theo tuần ISO, năm nay và năm trước | Net revenue by ISO week, this year and last year | — |
| `report.year.seasonality.table` | Chỉ số mùa vụ 12 tháng gần nhất | Seasonality index of the last 12 months | — |
| `report.year.seasonality.tableLikeForLike` | Chỉ số mùa vụ 12 tháng gần nhất, các cửa hàng có đủ 12 tháng | Seasonality index of the last 12 months, stores with 12 months | — |
| `report.year.seasonality.weekdayTable` | Doanh thu theo thứ trong năm | Revenue by weekday this year | — |

### Thẻ «Xu hướng giá trị hóa đơn» (`report.year.ticket.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.ticket.title` | Xu hướng giá trị hóa đơn | Ticket trend | — |
| `report.year.ticket.up` | Từ đầu năm {year}, giá trị trung bình mỗi hóa đơn là {value}, cao hơn cùng kỳ năm trước {delta}. | Year to date in {year}, the average ticket is {value}, {delta} above the same period last year. | `{year}` `{value}` `{delta}` |
| `report.year.ticket.down` | Từ đầu năm {year}, giá trị trung bình mỗi hóa đơn là {value}, thấp hơn cùng kỳ năm trước {delta}. | Year to date in {year}, the average ticket is {value}, {delta} below the same period last year. | `{year}` `{value}` `{delta}` |
| `report.year.ticket.flat` | Từ đầu năm {year}, giá trị trung bình mỗi hóa đơn là {value}, ngang cùng kỳ năm trước. | Year to date in {year}, the average ticket is {value}, level with the same period last year. | `{year}` `{value}` |
| `report.year.ticket.noReference` | Từ đầu năm {year}, giá trị trung bình mỗi hóa đơn là {value}; chưa có số cùng kỳ năm trước để so sánh. | Year to date in {year}, the average ticket is {value}; there is no same period last year to compare. | `{year}` `{value}` |
| `report.year.ticket.noData` | Năm {year} chưa có hóa đơn nào. | {year} has no invoices yet. | `{year}` |
| `report.year.ticket.series` | {year} | {year} | `{year}` |
| `report.year.ticket.chart` | Giá trị trung bình mỗi hóa đơn theo tháng, năm nay và năm trước | Average ticket by month, this year and last year | — |
| `report.year.ticket.table` | Giá trị hóa đơn theo tháng | Ticket by month | — |

### Thẻ «Vòng đời món» (`report.year.lifecycle.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.lifecycle.title` | Vòng đời món | Item lifecycle | — |
| `report.year.lifecycle.caption` | món mới nổi bật: {item} | top new item: {item} | `{item}` |
| `report.year.lifecycle.main` | Năm {year}: {new} món mới, {growing} món tăng, {declining} món giảm, {discontinued} món ngừng bán và {steady} món ổn định. | {year}: {new} new, {growing} growing, {declining} declining, {discontinued} discontinued and {steady} steady items. | `{year}` `{new}` `{growing}` `{declining}` `{discontinued}` `{steady}` |
| `report.year.lifecycle.mainYoung` | Năm {year}: {new} món mới và {discontinued} món ngừng bán. | {year}: {new} new and {discontinued} discontinued items. | `{year}` `{new}` `{discontinued}` |
| `report.year.lifecycle.noData` | Năm {year} chưa bán món nào. | No items were sold in {year}. | `{year}` |
| `report.year.lifecycle.topNew` | Món mới bán tốt nhất là {item} với {value}. | The best new item is {item} with {value}. | `{item}` `{value}` |
| `report.year.lifecycle.topDiscontinued` | Món ngừng bán lớn nhất là {item}, bán lần cuối ngày {date}. | The largest discontinued item is {item}, last sold on {date}. | `{item}` `{date}` |
| `report.year.lifecycle.tooYoung` | {store} mở từ {date}, chưa có năm trước để so nên chỉ phân loại món mới và món ngừng bán. | {store} opened on {date}; without a last year to compare, items are only sorted into new and discontinued. | `{store}` `{date}` |
| `report.year.lifecycle.chart` | Số món theo giai đoạn | Items by stage | — |
| `report.year.lifecycle.chartSeries` | Số món | Items | — |
| `report.year.lifecycle.table` | Giai đoạn của từng món | Stage of each item | — |
| `report.year.lifecycle.tableLikeForLike` | Giai đoạn của từng món, tính trên cùng cửa hàng | Stage of each item, same stores | — |
| `report.year.lifecycle.status.new` | Mới | New | — |
| `report.year.lifecycle.status.growing` | Tăng | Growing | — |
| `report.year.lifecycle.status.declining` | Giảm | Declining | — |
| `report.year.lifecycle.status.discontinued` | Ngừng bán | Discontinued | — |
| `report.year.lifecycle.status.steady` | Ổn định | Steady | — |

### Thẻ «So với năm trước» (`report.year.yearOverYear.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.yearOverYear.title` | So với năm trước | Against last year | — |
| `report.year.yearOverYear.up` | Từ đầu năm {year}, doanh thu thuần đạt {value}, cao hơn cùng kỳ năm trước {delta}. | Year to date in {year}, net revenue is {value}, {delta} above the same period last year. | `{year}` `{value}` `{delta}` |
| `report.year.yearOverYear.down` | Từ đầu năm {year}, doanh thu thuần đạt {value}, thấp hơn cùng kỳ năm trước {delta}. | Year to date in {year}, net revenue is {value}, {delta} below the same period last year. | `{year}` `{value}` `{delta}` |
| `report.year.yearOverYear.flat` | Từ đầu năm {year}, doanh thu thuần đạt {value}, ngang cùng kỳ năm trước. | Year to date in {year}, net revenue is {value}, level with the same period last year. | `{year}` `{value}` |
| `report.year.yearOverYear.noReference` | Từ đầu năm {year}, doanh thu thuần đạt {value}; chưa có số cùng kỳ năm trước để so sánh. | Year to date in {year}, net revenue is {value}; there is no same period last year to compare. | `{year}` `{value}` |
| `report.year.yearOverYear.noData` | Năm {year} chưa có hóa đơn nào. | {year} has no invoices yet. | `{year}` |
| `report.year.yearOverYear.chart` | Doanh thu từ đầu năm so với cùng kỳ năm trước, theo cửa hàng | Net revenue to date against the same period last year, by store | — |
| `report.year.yearOverYear.table` | Doanh thu từ đầu năm theo cửa hàng | Net revenue to date by store | — |
| `report.year.yearOverYear.periodTable` | Từ đầu năm so với cùng kỳ năm trước | Year to date against the same period last year | — |

### Thẻ «Từ ngày khai trương» (`report.year.since.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.since.title` | Từ ngày khai trương | Since opening | — |
| `report.year.since.caption` | tuần thứ {week} kể từ khai trương | week {week} since opening | `{week}` |
| `report.year.since.main` | {store}: tuần thứ {week} trung bình {value} mỗi ngày, {delta} so với tuần đầu. | {store}: week {week} averaged {value} a day, {delta} against the first week. | `{store}` `{week}` `{value}` `{delta}` |
| `report.year.since.latest` | {store}: tuần thứ {week} trung bình {value} mỗi ngày. | {store}: week {week} averaged {value} a day. | `{store}` `{week}` `{value}` |
| `report.year.since.firstWeek` | {store} vừa qua tuần đầu, trung bình {value} mỗi ngày. | {store} has completed its first week, averaging {value} a day. | `{store}` `{value}` |
| `report.year.since.tooEarly` | {store} mở từ {date}, chưa trọn tuần đầu. | {store} opened on {date} and has not completed a week yet. | `{store}` `{date}` |
| `report.year.since.notice` | {store} chưa có dữ liệu năm trước, nên được theo dõi theo từng tuần kể từ ngày khai trương. | {store} has no data from last year, so it is followed week by week since opening. | `{store}` |
| `report.year.since.series` | {store} | {store} | `{store}` |
| `report.year.since.chart` | Doanh thu trung bình mỗi ngày theo tuần kể từ khai trương | Average daily net by week since opening | — |
| `report.year.since.table` | Từng tuần kể từ khai trương | Weeks since opening | — |

### Tên tháng ngắn · short month names (`report.year.month.*`)

| Khóa · key | Tiếng Việt | English | Chỗ điền · placeholders |
| --- | --- | --- | --- |
| `report.year.month.1` | T1 | Jan | — |
| `report.year.month.2` | T2 | Feb | — |
| `report.year.month.3` | T3 | Mar | — |
| `report.year.month.4` | T4 | Apr | — |
| `report.year.month.5` | T5 | May | — |
| `report.year.month.6` | T6 | Jun | — |
| `report.year.month.7` | T7 | Jul | — |
| `report.year.month.8` | T8 | Aug | — |
| `report.year.month.9` | T9 | Sep | — |
| `report.year.month.10` | T10 | Oct | — |
| `report.year.month.11` | T11 | Nov | — |
| `report.year.month.12` | T12 | Dec | — |
