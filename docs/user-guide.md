# User guide

Purpose and audience: what the FNB Manager app shows and how to read it, for the owner and the store managers. The app speaks Vietnamese by default; this guide is in English and quotes the Vietnamese labels exactly as the app shows them, with the app's own English label in brackets where it helps. It describes the app as built and verified on 2026-11-15, Xuất dữ liệu, Cài đặt → Nhân viên and the first screen of the staff app on Zalo as built on 2026-11-18, and Cài đặt → Checklist, the Vận hành pages, Cài đặt → Khách hàng thân thiết and the Khách hàng pages as built on 2026-11-19; parts that are designed or planned say so.

The screenshots come from the demo, so they show the sample stores "Cửa hàng mẫu 1" and "Cửa hàng mẫu 2" and generated numbers, never a real shop. They are taken on 4 November 2026 at 12:30 in Vietnam, in Vietnamese unless a caption says otherwise, and are retaken whenever a screen changes (`pnpm --filter @fnb/web docs:screenshots`).

Last updated 2026-11-19

## What the app is for

FNB Manager reads the sales from the shop's POS, checks every day against the POS's own daily totals, and turns the numbers into plain reports: how today is going, and how each day, week, month and year compares with the usual. It runs in the browser of a phone or a computer. Every number comes from the POS; nothing is typed in by hand yet.

```mermaid
flowchart LR
  pos["POS"] --> sync["Sync: pulls sales and checks each day against the POS daily totals"]
  sync --> db[("Database")]
  db --> app["FNB Manager in the browser"]
```

## Where to open it

| Where | Address | Numbers | State on 2026-11-12 |
|---|---|---|---|
| The local app on the build machine | `http://localhost:5173` while the app runs there | real, as fresh as the last sync run on that machine | verified locally |
| The cloud app | the project's GitHub Pages address, `https://<owner>.github.io/fnb-manager/` | real, synced automatically | waits for the owner's go-live steps |
| The demo | the same Pages address until go-live; afterwards "Xem bản demo" on the login page | sample numbers, no login | see "The demo" below |

**Now.** Until the cloud project exists, the app with real numbers runs only on the build machine. Whoever looks after that machine starts the database and the app ([development.md](development.md)), runs the sync, and creates your login. No schedule runs there: the numbers are as fresh as the last sync that was run.

**After go-live.** The owner creates the cloud project, the GitHub secrets and the e-mail sender step by step ([go-live.md](go-live.md)). The real app then lives at the Pages address behind a login. The owner adds members with the `fnb` command-line tool, either with an invitation e-mail or with a password set for them; nobody can sign up alone. A nightly sync at 03:23 covers the last 14 business days, and once the owner switches it on, a sync every 30 minutes keeps each open store current.

## Signing in

| Screen | What to do |
|---|---|
| **Đăng nhập** (Sign in) | Enter "E-mail" and "Mật khẩu", then press "Đăng nhập". A wrong pair shows "E-mail hoặc mật khẩu không đúng." |
| **Quên mật khẩu?** (Forgot your password?) | Enter the e-mail you were registered with and press "Gửi liên kết". The answer is the same whether or not the address exists. |
| **Mật khẩu mới** (New password) | Opens from the link in the e-mail. The new password needs at least 8 characters; press "Lưu mật khẩu", then "Vào ứng dụng". An old or used link shows "Liên kết đặt lại không còn hiệu lực. Hãy yêu cầu liên kết mới." |

- The browser keeps you signed in. "Đăng xuất" (Sign out) in the top bar ends the session.
- "Tài khoản này chưa thuộc chủ sở hữu nào…" means the login exists but has no access yet; ask the owner to add you.
- On the local app, reset e-mails do not reach a real inbox: they land in the local mail catcher of the build machine (`http://127.0.0.1:54324`). On the cloud app they need the e-mail sender the owner sets up at go-live.

| Đăng nhập (Sign in) | Quên mật khẩu? (Forgot your password?) |
|---|---|
| ![The sign-in screen on a phone: E-mail and Mật khẩu fields, the Đăng nhập button and the Quên mật khẩu? link](user-guide/sign-in-phone.png) | ![The forgotten-password screen on a phone: an E-mail field and the Gửi liên kết button](user-guide/forgot-password-phone.png) |

## Finding your way

The navigation sits at the bottom on a phone and on the left on a wide screen.

| Label | English | Opens | State on 2026-11-15 |
|---|---|---|---|
| Hôm nay | Today | today and yesterday | verified locally |
| Báo cáo | Reports | Ngày, Tuần, Tháng, Năm | verified locally |
| Chủ đề | Topics | thematic reports: Doanh thu & xu hướng, Giờ & ngày trong tuần, Thực đơn, Thanh toán & tiền mặt, Khuyến mãi & giảm giá, Ca & két tiền, So sánh cửa hàng | the first four verified locally; Khuyến mãi & giảm giá, Ca & két tiền and So sánh cửa hàng built |
| Kế hoạch | Plans | saved strategy plans | "Sắp có" |
| Cài đặt | Settings | Cửa hàng (the business and store profiles), Dữ liệu nhập tay (item costs and their CSV import, monthly targets and payment fees), Phân loại (item-type roles, item categories and payment kinds), Ngày lễ (the national holidays and your own days off), Ngưỡng báo cáo (the report thresholds and this device's CSV format), Pháp lý (the legal texts and their versions), for owners and managers Nhân viên (the staff of the Zalo staff app) and Checklist (the shift checklists of the staff app), and Khách hàng thân thiết (the loyalty programme and its rewards); the other settings pages say which phase brings them | Phân loại and Ngưỡng báo cáo verified locally; Cửa hàng, Dữ liệu nhập tay, Ngày lễ, Pháp lý and Nhân viên built; Checklist and Khách hàng thân thiết built on 2026-11-19; the other pages planned |

- A page that is not built yet says "Sắp có" and names the roadmap phase that brings it ("Dự kiến ở giai đoạn … của lộ trình.").
- Xuất dữ liệu (Exports) has no item in the navigation yet; [Xuất dữ liệu](#xuất-dữ-liệu-exports) below says how to open it.
- Vận hành (shift operations) and Khách hàng (loyalty members) have no item in the navigation either; [Vận hành](#vận-hành-shift-operations) and [Khách hàng](#khách-hàng-members-ledger-queue-and-shift-activity) below say how to open them.
- The top bar holds the language switch (**VI** / **EN**), "Đăng xuất", the store choice and the freshness badge. On a phone the store choice folds into one summary button; tap it to open.
- **VI** is the default. **EN** switches every label, sentence and number format to English. The browser remembers the choice.
- When a new version is published, a prompt says "Có phiên bản mới — tải lại"; tap it to reload.
- The app can be added to a phone's home screen (as "FNB Manager", or "FNB" where space is short) and then opens without the browser bar. It does not work offline.
- The app follows the light or dark setting of the phone or computer.

![Hôm nay on a computer: the navigation on the left, the language switch and store choice in the top bar, the demo banner above the cards](user-guide/today-computer.png)

| On a phone, the controls fold into one summary button | Tapped open | Dark setting |
|---|---|---|
| ![Hôm nay on a phone with the navigation at the bottom](user-guide/today-phone.png) | ![The phone's summary button opened, showing the store choice and the language switch](user-guide/controls-phone.png) | ![Hôm nay on a phone in the dark colour scheme](user-guide/today-dark-phone.png) |

![Hôm nay in English after pressing EN](user-guide/today-english.png)

## Choosing stores

- The "Cửa hàng" button shows "Tất cả" (All), one store's name, or "{n} cửa hàng".
- Open it and tick "Tất cả" or the stores you want. At least one store always stays selected.
- With several stores, every figure is the sum of the stores before any ratio is taken. The average ticket of two stores is their total net revenue divided by their total invoices, not the average of two averages.
- You see only the stores your role covers. If your login belongs to more than one business, a "Chủ sở hữu" (Owner) list appears to switch between them.
- The browser remembers the choice, and report links carry it.

![The open store choice on a computer, with "Tất cả" and the two sample stores ticked](user-guide/store-choice.png)

## Hôm nay (Today)

Hôm nay has two sections, each with a badge that says whether the day is reconciled (see "Data freshness" below).

| Section | Cards |
|---|---|
| "Hôm nay đến {time} · {date}" (today until now) | Doanh thu thuần, Số hóa đơn, Giá trị trung bình mỗi hóa đơn, Doanh thu theo giờ, Top 5 món hôm nay, Thanh toán hôm nay |
| "Hôm qua · {date}" (yesterday) | Doanh thu thuần, Số hóa đơn, Giá trị trung bình mỗi hóa đơn |

- **Doanh thu thuần** (Net revenue): the total of the invoices that were not voided, after item, bill and voucher discounts. **Số hóa đơn** (Invoices) counts those invoices. **Giá trị trung bình mỗi hóa đơn** (Average ticket) is net revenue divided by invoices.
- Each of these compares with **mức nền cùng thứ** (the same-weekday baseline): the median of the same weekday over the previous 8 weeks, with public holidays, Tết days and your own days off (Cài đặt → Ngày lễ) left out. For today it counts only up to the same time of day ("so với mức nền cùng thứ đến 10:15"), so a morning is never compared with a whole day. Without enough history the chip reads "chưa có mức nền cùng thứ".
- **Doanh thu theo giờ** (Revenue by hour): today's net revenue hour by hour against the usual curve, with the peak hour.
- **Top 5 món hôm nay** (Top 5 items today): the best sellers so far, with quantity and share of item revenue.
- **Thanh toán hôm nay** (Payments today): the amount per payment method, and **tiền mặt cần đếm** (cash to count): the total taken in cash today, not counting the opening float.
- With several stores, Doanh thu thuần adds a chart by store, and each table lists the stores.
- The page reads the database again every 5 minutes and when you come back to the tab; the numbers themselves change only after a sync.

## The reports: Ngày, Tuần, Tháng and Năm

"Báo cáo" opens Ngày. The four tabs at the top switch between **Ngày** (Day), **Tuần** (Week), **Tháng** (Month) and **Năm** (Year); the new tab opens the period that contains the last day you were looking at.

### Choosing the period

- "‹" (Kỳ trước, previous period) and "›" (Kỳ sau, next period) step one period. "Chọn ngày" (Pick a date) jumps to the period that contains a date; it moves once the date is complete, when you press Enter, leave the field or stop typing for a moment.
- Ngày is one business day; Tuần the ISO week, Monday to Sunday; Tháng the calendar month; Năm the calendar year. A running week, month or year shows "đến hết ngày {date}" (up to and including).
- Reports stop at the last complete business day. Today belongs to Hôm nay: a link to today, or to a week, month or year that starts today, shows the latest complete period with "Ngày hôm nay chưa kết thúc; báo cáo dừng ở ngày …" and a link "Xem Hôm nay". A later period shows the latest one with "Kỳ này chưa bắt đầu; đang hiển thị kỳ gần nhất đến hết ngày …".
- Dates go back to 1 January 2023.

![The four report tabs and the period navigator: Kỳ trước, the period label, Kỳ sau and Chọn ngày](user-guide/period-navigator.png)

### Reading a card

Every report is a stack of cards, and every card has the same parts.

| Part | What it shows |
|---|---|
| Headline | the main number. Large amounts read "tr ₫" (million) or "tỷ ₫" (billion); hold the mouse pointer over the number for the exact amount, which screen readers announce as "Giá trị chính xác …". The CSV always holds exact amounts |
| Comparison chips | the change against each reference ("so với …"), with ▲ or ▼. Green when the change is good for that metric, red when it is bad (for the discount rate, lower is better), grey for a metric that is neither, such as the cash share. Shares and rates change in percentage points ("+1,2 điểm %"); everything else changes in per cent |
| Change line | for net revenue and the average ticket, how the change splits into its parts: "Chênh lệch {total} …: số hóa đơn … · số món mỗi hóa đơn … · giá trung bình mỗi món …". The parts add up exactly to the difference shown |
| Sentence | one plain sentence written from the numbers by fixed templates; it names what moved the number most (a store, an hour, a weekday, an item, a category, a payment method) |
| Chart and table | the detail. Column headers sort the table; a wide table scrolls inside its card with the first column fixed |
| "Tải CSV" (Download CSV) | the rows of the table, as shown |
| "Giải thích chỉ số" (About these numbers) | the formula, the level of detail and the conventions of each metric on the card |
| Markers | "chưa đối soát" (not reconciled), "đang cập nhật" (updating), "tạm tính" (provisional), "dữ liệu mẫu" (sample data), "Đang tải…" (loading) |

![The Doanh thu thuần card of Ngày: the headline, three comparison chips, the change line, the sentence, the chart by store, the table with Tải CSV, and Giải thích chỉ số](user-guide/card-anatomy.png)

When a comparison has no number, the chip says why: "chưa có dữ liệu năm trước" (the stores have no data from last year), "cửa hàng mới, chưa đủ 4 tuần" (a new store, not 4 weeks yet), "đang tích lũy dữ liệu" (still collecting data), "chưa có số để so sánh" (nothing to compare with), "chưa thiết lập" (not set up).

### "Cùng cửa hàng": comparing like with like

When only some of the selected stores have sales history back to the reference period, the comparison uses only those stores and says so: "so với cùng thứ năm trước · cùng cửa hàng (1/2)" means the comparison with the same weekday last year covers one of the two selected stores. The sentence then names both figures: "Mức so sánh chỉ tính 1/2 cửa hàng có đủ dữ liệu: … so với …". A store that opened later shows "chưa có dữ liệu năm trước" (or "kỳ trước") in its own row instead of a change. The same-weekday baseline is never like for like. In the card above, the third chip compares with last year using "cùng cửa hàng (1/2)": the young sample store has no sales from last year.

### The sentences

Every sentence is filled in from the numbers by a fixed Vietnamese template (with an English twin); nothing is written by a model or by hand. A sentence has up to three parts:

- **The main comparison**, for example "Ngày {day}, doanh thu thuần cao hơn mức nền cùng thứ {delta}." Very small changes read "ngang" (level). Without a reference it gives the value and says why nothing is compared ("chưa đủ dữ liệu 8 tuần trước để so sánh").
- **What moved it most**: "{store} tạo khác biệt lớn nhất (…)", or "Riêng … đi ngược chiều (…)" when one part went against the overall change.
- **Where the change came from**: "Phần lớn do số hóa đơn (…)", or "… số món mỗi hóa đơn" or "… giá trung bình mỗi món". When the card compares with the baseline but splits the change against the day before, the sentence names that reference: "Chênh lệch … so với hôm trước phần lớn do …".

Every template, with its English meaning, is listed for the owner's wording review in [reports/cau-van-bao-cao.md](reports/cau-van-bao-cao.md).

### Ngày (Báo cáo ngày, Daily report)

| Card | What it shows | Compared with |
|---|---|---|
| Doanh thu thuần | the day's net revenue | the same-weekday baseline ("so với mức nền ({k}/8 tuần)" while fewer than 8 weeks exist), the day before, the same weekday last year |
| Số hóa đơn | invoices | the same three |
| Giá trị trung bình mỗi hóa đơn | the average ticket, with items per ticket and average item price | the same three |
| Theo giờ so với thường lệ (By hour against usual) | the peak hour and every hour against the usual curve of that weekday | the 20:00 to 22:00 share against the day before |
| 5 món bán chạy (Top 5 items) | the five best sellers: quantity, net revenue, share | the day before |
| Thanh toán và tiền mặt cần đếm (Payments and cash to count) | cash to count and each payment method | the cash share against the day before |
| Ca và chênh lệch két (Shifts and drawer variance) | shifts whose drawer differs from the expected cash by more than 50,000 ₫, by more than 0.5 % of the cash sales, or unusually against earlier shifts. Shifts are numbered "Ca 1", "Ca 2" by their opening time in each store and day; a cashier the POS records by an e-mail address shows as "chưa rõ thu ngân" | none |
| Giảm giá và voucher (Discounts and vouchers) | discount cost (item, bill, voucher), its share of gross revenue, and each promotion | the day before; the discount rate also against last year |
| Hóa đơn có số điện thoại thành viên (Invoices with a member phone number) | the share of invoices that carry a member's phone number | the day before |

More detail: [reports/ngay.md](reports/ngay.md).

![The top of Ngày on a computer](user-guide/report-ngay.png)

![The Ca và chênh lệch két card of Ngày: shifts numbered Ca 1 to Ca 3 for each sample store, with the cashier, opening and closing times and the drawer variance](user-guide/card-shifts.png)

### Tuần (Báo cáo tuần, Weekly report)

| Card | What it shows | Compared with |
|---|---|---|
| Doanh thu tuần (Weekly revenue) | net revenue of the week | last week over the same elapsed days, the average of the 4 weeks before ("so với trung bình {n} tuần"; a week with Tết days is left out), the same week last year |
| Hóa đơn tuần (Weekly invoices) | invoices | the same three |
| Giá trị hóa đơn tuần (Weekly average ticket) | the average ticket | the same three |
| Đường theo ngày trong tuần (Curve across the week) | each day's net revenue and share of the week; the strongest day | last week and the 4-week average of each weekday |
| Món tăng, món giảm (Rising and falling items) | the last 28 days against the 28 before: up to 5 rising, 5 falling and 3 new items, each with at least 10 units | needs 8 weeks of history |
| Cơ cấu nhóm món (Category mix) | each category's share of item revenue; items without a category show as "Chưa phân loại" | last week, in percentage points |
| Khuyến mãi đã chạy (Promotions run) | the week's discount cost by promotion and the share of invoices with a voucher | last week |
| Ngày tốt nhất và kém nhất (Best and worst days) | the best and the worst day against each day's 8-week same-weekday median; a holiday is pointed out | none |

More detail: [reports/tuan.md](reports/tuan.md).

![The top of Tuần on a computer](user-guide/report-tuan.png)

### Tháng (Báo cáo tháng, Monthly report)

| Card | What it shows | Compared with |
|---|---|---|
| Doanh thu tháng đến nay và nhịp tháng (Month to date and monthly pace) | net revenue of the month so far and where the month should end by two forecasts, "dự báo theo đặc trưng ngày trong tuần" and "dự báo mùa vụ đơn giản"; the one with the smaller error over the last 28 days comes first; the monthly target in the table when every selected store has one | the same days of last month and of last year; each forecast against the whole of last month |
| Xu hướng theo ngày (Day-by-day trend) | each day against its usual level; holidays in grey, Tết shaded, "Đóng cửa" for a checked day without sales | the same-weekday baseline |
| Pareto món (đường 80 %) (Item Pareto) | how many items make 80 % of item revenue | the same days of last month |
| Cơ cấu size (Size mix) | the share of size L among the drinks sold by size | last month and last year |
| Tỷ lệ kèm topping và đồ ăn nhẹ (Topping and snack attach rates) | how many drink invoices also carry a topping or a snack; until the item roles are set it says "Chưa gán vai trò món." | last month and last year |
| Món mới (New items) | items first sold this month and their rank | none |
| Cơ cấu thanh toán (Payment mix) | the cash share and the other payment kinds; estimated fees where fee rates exist | last month and last year |
| Chi phí giảm giá (Discount cost) | item, bill and voucher discounts and the costliest promotion | last month and last year |
| Thống kê ca (Shift statistics) | shifts over the drawer thresholds, by cashier and shift | the same days of last month |
| Tiến độ mục tiêu (Target progress) | the month so far divided by the monthly targets, and what is still needed per remaining day; without a target it says "Chưa đặt mục tiêu tháng cho …" | each forecast against the target |

More detail: [reports/thang.md](reports/thang.md).

![The top of Tháng on a computer](user-guide/report-thang.png)

### Năm (Báo cáo năm, Yearly report)

| Card | What it shows | Compared with |
|---|---|---|
| Doanh thu tháng × năm (Revenue by month and year) | a heat table of every month of this year and the two years before, with year totals; the peak month | last year's peak month |
| Tăng trưởng (Growth) | each month against the same month last year; month on month; the last 3 months against the 3 before | the same month last year |
| Mùa vụ và Tết (Seasonality and Tết) | the seasonality index of the last 12 complete months, the Tết dip of this year and last year, and the share of each weekday | none |
| Xu hướng giá trị hóa đơn (Ticket trend) | the average ticket year to date and per month, with items per ticket and average item price | last year |
| Vòng đời món (Item lifecycle) | items by stage: Mới, Tăng, Giảm, Ngừng bán, Ổn định | none |
| So với năm trước (Against last year) | net revenue year to date | the same elapsed days of last year |
| Từ ngày khai trương (Since opening) | for a store that opened during the last year, its average daily net revenue week by week since opening | its first week; shown only while a selected store is that young |

More detail: [reports/nam.md](reports/nam.md).

![The top of Năm on a computer](user-guide/report-nam.png)

### Links to a given day, week, month or year

The address of a report names its period and, when not every store is selected, the stores. Copy it to share or bookmark exactly that view:

| Report | Address after the app's address |
|---|---|
| Ngày | `#/bao-cao/ngay?date=2026-11-07` |
| Tuần | `#/bao-cao/tuan?week=2026-W45` |
| Tháng | `#/bao-cao/thang?month=2026-10` |
| Năm | `#/bao-cao/nam?year=2026` |

Choose the stores first; the link then ends with `&store=…`. Opening such a link also sets your store choice.

### Printing

Use the browser's own print command (Ctrl+P or ⌘P on a computer, Share then Print on a phone). The app prints on A4 portrait, black on white, one card per row, without the navigation, banners and buttons, and starts with a line that names the report, the period, the stores and the last day included. "Giải thích chỉ số" prints only when it is open.

![The top of a printed Ngày: the summary line, then the cards black on white without navigation or buttons](user-guide/report-print.png)

### CSV downloads

"Tải CSV" under a table downloads exactly the rows shown, in UTF-8 with a byte-order mark so that Excel shows the Vietnamese letters correctly. Values are separated by commas and decimals use a point; amounts are plain numbers without thousands separators, and percentage columns are marked "(%)". An Excel set to Vietnamese regional settings may put such a row in one column, because it expects semicolons and a decimal comma (`12,5`). If that happens, switch this device to the semicolon format on Cài đặt → Ngưỡng báo cáo, under "Thiết bị này" ([below](#thiết-bị-này-this-device)); each phone or computer keeps its own choice. A card with two tables offers "Tải CSV: {table}" for each. Report files are named `<report>-<card>-<period>.csv`, for example `ngay-net-revenue-2026-11-07.csv`.

## The thematic reports ("Chủ đề")

"Chủ đề" in the navigation opens reports that look at one subject over any range of days instead of a calendar period. All eight are built: **Doanh thu & xu hướng**, **Giờ & ngày trong tuần**, **Thực đơn**, **Thanh toán & tiền mặt**, **Khuyến mãi & giảm giá**, **Ca & két tiền**, **So sánh cửa hàng** and **Chất lượng dữ liệu**, and every tab keeps the range and the stores you chose.

![Doanh thu & xu hướng on a computer: the theme tabs, the range presets and dates, then the Doanh thu thuần, Xu hướng doanh thu and Số hóa đơn cards](user-guide/theme-doanh-thu.png)

### Choosing the range

- **Presets:** 7 ngày, 4 tuần (the default), 13 tuần, 52 tuần, Tháng này, Tháng trước, Năm nay. Each ends at the last complete day, as the reports do.
- **‹ and ›** move the range back or forward by its own length, or by a month or a year for the month and year presets. › stops at the last complete day.
- **Từ ngày and Đến ngày** pick any range from 1 January 2023, at most 400 days (92 days on Ca & két tiền).
- The line under the presets says what is shown and what it is compared with: "07/10/2026 – 03/11/2026 · 28 ngày · so với 4 tuần trước". Every card also compares with the same weeks last year ("so với cùng kỳ năm trước"), except 52 tuần and Năm nay, whose range before is already last year.
- The app remembers the last preset on this device, and keeps the range and the stores when you switch between the thematic reports.
- A range longer than 400 days (92 on Ca & két tiền) is shortened to its last 400 (or 92) days, and an end after the last complete day is moved back to it; a line above the cards says so while that range is shown.

![The range picker: the seven presets, the ‹ and › buttons, the range line and the two dates](user-guide/theme-range-picker.png)

### Doanh thu & xu hướng (Revenue and trend)

| Card | What it shows | Compared with |
|---|---|---|
| Doanh thu thuần (Net revenue) | net revenue of the range, with the store that moved most or the split into invoices, items per ticket and item price | the range before; the same weeks last year |
| Xu hướng doanh thu (Revenue trend) | revenue per day (or per week for ranges over 92 days) with a 7-day (or 4-week) moving average; Tết is shaded | last year's moving average |
| Số hóa đơn (Invoices) | invoices of the range | as net revenue |
| Giá trị trung bình mỗi hóa đơn (Average ticket) | the average ticket with items per ticket and average item price | as net revenue |
| Theo tháng (By month), from 56 days | each month's revenue and the best month | the same month last year, on the same stores |
| Tỷ trọng từng cửa hàng (Share of each store), two or more stores | each store's share of revenue | the share in the range before, in points |

More detail: [reports/doanh-thu.md](reports/doanh-thu.md).

### Giờ & ngày trong tuần (Hours and weekdays)

| Card | What it shows |
|---|---|
| Bản đồ nhiệt giờ × thứ (Hour × weekday heat map) | two tables, revenue and invoices per day for every hour from the first to the last with sales, quiet hours in between included (rows), and weekday (columns T2 to CN), darker for higher; the best and the quietest cell |
| Giờ cao điểm và thấp điểm (Peak and quiet hours) | the hours that sell most (3 by default) and their share of revenue, and the quiet hours; compared with the range before in points |
| Theo thứ trong tuần (By weekday) | revenue per day for each weekday, the best and weakest, and the weekday that changed most |
| Doanh thu mỗi giờ mở cửa và mỗi ghế (Revenue per opening hour and per seat) | revenue and invoices per opening hour, and revenue per seat-hour (RevPASH) where the seat count is entered |
| Gợi ý khung ca (Suggested shift windows) | runs of busy and slow hours on weekdays and at the weekend, from invoices per hour; it does not count staff |

Revenue per opening hour needs the store's opening hours and RevPASH its seat count. Until they are entered, the card shows "—" and a link "Nhập giờ mở cửa và số ghế" to the store settings, which arrive with the settings pages. In the demo the young store has neither, so you can see that state.

![The heat map card of Giờ & ngày for one store over 4 weeks: hours down the side, T2 to CN across, darker cells for busier hours](user-guide/theme-gio-ngay-heatmap.png)

More detail: [reports/gio-ngay.md](reports/gio-ngay.md).

### Thực đơn (Menu)

Thực đơn shows which items carry the menu. **Ma trận thực đơn** classes every item within its group (drinks, toppings, snacks) and store, over the menu window that ends on the range's last day (28 days unless Settings says otherwise): *Ngôi sao* sells well and earns more than its group's average, *Ngựa kéo cày* sells well but earns less, *Câu đố* earns well but sells little, *Chó* does neither. The number at the top is the stars among the drinks; the bars show each group's mix of classes, and the table lists the items with their class first, the stars of the drinks at the top, with each item's share of the group's quantity, its price and its cost. It opens on the first 20 items: **Xem tất cả n dòng** shows the rest, a click on a column heading sorts every item, and the CSV and the printed page hold them all. Below it, one row per group gives the popularity line, how many items fall in each class and the stars' share of the group's revenue. While a group still has an item without a cost, it is classed on price and marked "tạm tính".

![The Thực đơn matrix for one store over 4 weeks: 30 stars among 75 drinks, each group's class mix as stacked shares, the first 20 rows of the item table and the class counts per group](user-guide/theme-thuc-don-matrix.png)

**Biên lợi nhuận món** shows the gross margin of the items that have a cost, with their cost, margin and the share of their revenue the cost covers. Items without a cost are left out, so the card lists only the items you have costed. In the demo no item has a cost yet, so the card asks you to enter costs and links to **Nhập giá vốn** in Settings ([Dữ liệu nhập tay](#dữ-liệu-nhập-tay-manual-data)).

![The margins card of the demo: no item has a cost yet, with the link to enter costs](user-guide/theme-thuc-don-margins.png)

![The margins card after costs were entered for three demo items: their margin rate and the three items alone in the table](user-guide/theme-thuc-don-margins-costed.png)

**Món tăng, món giảm** compares each item's quantity with the range before: the five that rose and fell most among items that sold at least 10 in the range before (a rising item also at least 10 in this one), and the best-selling new items. When a store has no sales in the range before, it says so instead of guessing.

![The movers card: the top riser's change at the top, then the rising, falling and new items with both ranges' quantities](user-guide/theme-thuc-don-movers.png)

**Cơ cấu nhóm món** shows each category's share of item revenue and how it moved. An item without a category is listed as **Chưa phân loại**, and the card links to **Phân loại món** in Settings so you can give it one.

![The category mix card: the largest category's share, the shares against the range before, and the uncategorised item with its Settings link](user-guide/theme-thuc-don-category-mix.png)

**Cơ cấu size** is the share of size L among drinks sold by size, against the range before in points, with the L share of each drink.

![The size mix card: the L share with its change in points and the L share per drink](user-guide/theme-thuc-don-size-mix.png)

**Tỷ lệ kèm topping và đồ ăn nhẹ** is how many invoices with a drink also have a topping or a snack, over the last 92 days of the range at most (the subtitle says how many), against as many days before. It names the drink most often taken with a topping. A rate shows "—" with a link to Settings until an item type of the selected stores carries the topping or snack role, and both do until one carries the drink role.

![The attach card: the topping rate with both chips, the snack rate in the caption and the rates per drink](user-guide/theme-thuc-don-attach.png)

**Món hay bán cùng nhau** lists the pairs of items found together on at least 3 invoices over the same window, with how often one comes with the other and the lift (above 1 means more often than chance): candidates for a combo.

![The pairs card: the top pair's invoices and the 20 pairs most often sold together](user-guide/theme-thuc-don-pairs.png)

**Đường và đá** shows which sugar and ice levels customers choose, each as a share of its kind against the range before. Other options are listed apart under **Khác**.

![The sugar and ice card: the most chosen sugar level, the sugar and ice levels with their shares and changes](user-guide/theme-thuc-don-preferences.png)

More detail: [reports/thuc-don.md](reports/thuc-don.md).

### Thanh toán & tiền mặt (Payments and cash)

Thanh toán shows how customers pay. **Cơ cấu thanh toán theo loại** gives the share of cash in the money taken, against the range before and the same range last year in points, then each kind (cash, bank transfer, e-wallet, card…) and each payment method with its share. The bars put the range before beside this one, so a shift from cash to e-wallets shows at a glance. Apart from cash, the sentence names the kind whose share moved most.

![The payment mix card: the cash share with its two chips, the kinds with their previous shares and the stacked kind shares](user-guide/theme-thanh-toan-mix.png)

**Xu hướng tỷ trọng tiền mặt** follows the cash share day by day (week by week beyond 35 days), with the cash taken as bars and its share as a line. When, over the range, the cash share rises while revenue per day falls, the card says so: a sign worth checking against the cash counted in each shift.

![The cash trend card: the last day's cash share against the first, with cash per day and its share](user-guide/theme-thanh-toan-cash-trend.png)

**Tiền mặt dự kiến và đếm được theo ca** checks every shift of the last 92 days of the range at most: the cash expected in the drawer against the cash counted, and how many shifts went over your thresholds (an amount, a share of cash sales and an unusual size for the store). The thresholds are written under the sentence and come from Settings. Shifts read "Ca 1", "Ca 2"… in the order they opened that day; a cashier's e-mail address never shows. A cash payout made during a shift is not synced from the POS, so it reads as a shortage.

![The drawer card: flagged shifts, the largest variance, the thresholds and the shifts with the largest variance first](user-guide/theme-thanh-toan-drawer.png)

**Phí thanh toán ước tính** estimates what card and e-wallet payments cost in fees, at the rate you enter for each payment method, beside the fee the POS reported. Until a rate is entered the card shows "—" and links to Settings.

![The fee card of the demo: no fee rate yet, with the link to enter one](user-guide/theme-thanh-toan-fees.png)

More detail: [reports/thanh-toan.md](reports/thanh-toan.md).

### Khuyến mãi & giảm giá (Promotions and discounts)

Khuyến mãi shows what your promotions cost, whether one of them paid for itself, and how they stand against the promotion rules.

**Chi phí giảm giá** adds up the item discounts, bill discounts and vouchers of the range, with their share of gross revenue ("2,0% doanh thu gộp"). Its chips compare the cost, then the rate in points, with the range before and the same range last year. The sentence names the promotion that cost most; the first table lists every promotion with its invoices, discount, share of the cost and the first and last day it was used, and the second splits the cost into items, bills and vouchers for this range and the one before. The bars stack the three by day, or by week beyond 35 days.

![The discount cost card: the cost with its share of gross revenue, the cost and rate chips, the promotions and the components](user-guide/theme-khuyen-mai-cost.png)

**Voucher** gives the share of invoices that used a voucher, against the range before and last year in points, names the voucher used on the most invoices and lists every voucher.

![The voucher card: the share of invoices with a voucher, its two chips and the vouchers used](user-guide/theme-khuyen-mai-vouchers.png)

**Hiệu quả khuyến mãi** asks whether one promotion brought in more than it gave away, over the last 92 days of the range at most. Choose the promotion in **Chương trình** (the costliest comes first) and what to compare with in **So với**:

- **Cùng thứ các tuần trước**: the same weekday over the 8 weeks before, at the same stores (the default);
- **Các tuần trước chương trình**: the weeks before the first day of the promotion, as many as Cài đặt → Ngưỡng báo cáo says (4 by default);
- **Cửa hàng không chạy chương trình**: a store you selected that did not run it. When every selected store ran it, as with a single store, this choice is greyed out and the reason is written under it.

The card then shows the net result in big type, "+" for a gain and "−" for a loss, with the extra gross revenue and the discount cost beside it: net = extra revenue − discount cost. The general trend, measured on days without the promotion, is taken out first, so a busy month does not count as the promotion's doing. A promotion that runs every day leaves no such days: the card then shows "—" with the reason and what to try (a range with days without the promotion, or a store that did not run it when one is selected), never a simple before-and-after figure. The table lists every day, promotion days first, with the expected revenue next to the real one.

| | |
|---|---|
| ![The lift card of a bill discount measured against the weeks before: a net loss in big type, the extra gross revenue and the discount cost under it, the trend sentence, the bars of gross revenue and the days](user-guide/theme-khuyen-mai-lift.png) | ![The lift card of a voucher that ran every day: a dash, the reason and what to try, and the greyed-out store comparison with its reason](user-guide/theme-khuyen-mai-lift-dash.png) |

Your choices are in the address (`&promo=…&cmp=prior_weeks`), so a link opens the same comparison.

The next three cards check your promotions against the Vietnamese promotion rules that apply on each date. They inform; they never say you broke a rule, and each legal sentence names the decree or circular and its article, the date the rules were last checked (12/11/2026) and that it is not legal advice.

**Danh mục khuyến mãi** counts the promotions used in the range and lists every promotion, voucher and named bill discount with whether it is in the POS catalogue, whether it is switched on, when it was last used and its days and discount over the last 365 days. It names how many catalogue promotions that are still switched on have not been used for more than 90 days, which you may switch off in the POS. When the name of a promotion holds a word of a lucky draw ("bốc thăm", "quay số", "trúng thưởng", "lucky draw" and the like, also written without tone marks), a yellow note reminds you that a promotion with an element of chance must be registered with the Sở Công Thương, or with the Bộ Công Thương when it runs in several provinces, and that Decree 239/2026/NĐ-CP is reported to have changed this procedure. In the demo, the catalogue promotion "Vòng quay may mắn" shows the note.

![The catalogue card: the promotions used in the range, the catalogue promotions not used for 90 days, the lucky-draw note for the demo's "Vòng quay may mắn" and the list with catalogue, status, last use, days and discount over 365 days](user-guide/theme-khuyen-mai-catalogue.png)

**Mức giảm tối đa** counts the item and bill discounts that took more than 50 % off the price before the promotion at least once (the cap of Circular 39/2025/TT-BCT, Article 4; a range across 1 July 2025 names Decree 81/2018/NĐ-CP, Article 7, too, with the dates of each). A free item ("món tặng") and a fully free invoice ("hóa đơn miễn phí") are never counted as over the cap: they are named apart with their dates for you to check against the rules of the programme. Vouchers are another form of promotion and are listed apart too, in their own sentence and table, when one took more than 50 % off the rest of an invoice. The first table ends with a row for whole invoices, vouchers included. A note says that state-run concentrated promotion programmes allow up to 100 %; their dates are not in the data, so every day is checked against 50 %.

**Số ngày giảm giá bán trong năm** counts, for each item, the days of this year on which it was sold at a discount, on its line or through a bill discount; gift and voucher days are shown beside them, never added. The old limit of 120 such days per item and year (Decree 81/2018/NĐ-CP, Article 10) is reported repealed from 26/06/2026 by Decree 239/2026/NĐ-CP, which is still being checked: for a range ending after 25/06/2026 the count is marked "chỉ để theo dõi" (for information only), and an item is named as over 120 days only for the days up to 25/06/2026.

| | |
|---|---|
| ![The maximum discount card: the cap with its circular and check date, no item or bill discount over it, the vouchers listed apart, the note on state-run programmes and the table ending with whole invoices](user-guide/theme-khuyen-mai-rule-cap.png) | ![The discount days card: the item with the most discount days marked for information only, the reported repeal, the days up to 25/06/2026 and the items with their line, bill, gift and voucher days](user-guide/theme-khuyen-mai-rule-days.png) |

**Ưu đãi thành viên đã đổi** (built on 2026-11-19) shows the rewards your loyalty members exchanged for stamps or points ([Khách hàng thân thiết](#khách-hàng-thân-thiết-loyalty-programme) below), over the last 92 days of the range at most. The big number is **Chi phí ưu đãi**: the discount given on the invoices that used a reward, with a chip against the same number of days just before. The sentences say how many rewards were exchanged and how many were used on an invoice at what cost, which reward was exchanged most, and how the rewards used compare with the invoices of members who earned stamps or points ("Lượt đã dùng bằng … số hóa đơn có thành viên tích điểm"). The bars show the exchanges per reward, and the table lists each reward and store with its kind, **Lượt đổi**, **Đã dùng**, **Đang giữ**, **Đã hoàn lại**, the stamps and points exchanged and the cost, with "Tải CSV". Only rewards used on a synced invoice cost anything: a code still held, or returned because it was not used in time, costs nothing, and a free item rung up as a 0 ₫ line has no discount amount. In the demo the card says "Chưa có dữ liệu ưu đãi thành viên: bản demo không có chương trình khách hàng thân thiết." This card has no screenshot yet.

More detail: [reports/khuyen-mai.md](reports/khuyen-mai.md).

### Ca & két tiền (Shifts and cash drawer)

Ca & két tiền looks at each shift of the range, at most the last 92 days: a longer range is shortened to its last 92 days, and the tabs from another theme open it on those days. Shifts read "Ca 1", "Ca 2"… in the order they opened that day in their store; the POS shift name and a cashier's e-mail address never show, on screen, in print or in a CSV file, and a cashier entered as an e-mail address reads "chưa rõ thu ngân".

**Doanh thu và hóa đơn theo ca** gives the average net revenue of a shift and names the shift of the day ("Ca 1", "Ca 2"…) that sells most and least on average. The table lists every shift, newest first, with its cashier, opening and closing time, invoices and net revenue; the bars show the last 40 shifts.

![The sales per shift card: the average per shift, the strongest and weakest shift, the bars of the latest shifts and the newest shifts](user-guide/theme-ca-ket-tien-sales.png)

**Chênh lệch két** is Thanh toán's drawer check over the whole range: the shifts over your cash thresholds, the largest variance and the thresholds in force, every shift's expected and counted cash, and a second table per cashier with the shifts, how many went over the drawer thresholds, the total and average variance counted without its sign ("tuyệt đối") and the largest shortage and overage.

![The drawer variance card: flagged shifts, the thresholds, the shifts with the largest variance first and the table per cashier](user-guide/theme-ca-ket-tien-drawer.png)

**Hủy, xóa món và sửa sau khi đóng ca** compares each shift's voids and removed lines with the store's own shifts of the 56 days before, as z-scores, and marks a shift only when a rate is higher than usual or an invoice was changed after the shift closed; the bars show the shifts marked for a rate. The sentence names the shift most worth a look and why; the table ranks the shifts by their higher z-score, then by edits after the close. A z-score compares a shift with earlier shifts; it is not a judgement of the person on the shift. A z-score needs 3 earlier shifts of the store whose rates differ; without them (a new store, or a store that has never removed a line) the cell reads "—" and the card says why.

![The adjustments card: shifts worth a look, the reason, the z-scores against the threshold line and the ranked shifts](user-guide/theme-ca-ket-tien-adjustments.png)

**Theo thu ngân** puts the same shifts side by side per cashier, to show where a pattern repeats across shifts: for each cashier the shifts, net revenue, shifts over your drawer thresholds, total drawer variance counted without its sign, voids, removed lines and edits after the close. The headline counts the shifts over the drawer thresholds of the cashier with the most, and the sentence names that cashier; when several share the most, the card names nobody. A cashier entered as an e-mail address, or not entered at all, reads "chưa rõ thu ngân": those shifts keep their row in the table, but that row is never named as the cashier with the most, and the sentence says how many shifts it holds. It is a prompt to look again, not a conclusion about a person, and the card says so. When every shift of a store carries the same cashier login, as when all cashiers share one POS login, the card shows no ranking and says that figures per cashier need each cashier's own POS login. When the logins differ but none has a display name (each is an e-mail address or empty), it shows no ranking either and asks you to give each cashier login a display name in the POS.

![The cashier card: the shifts over the drawer thresholds of the cashier with the most, the sentence naming that cashier, the caution and the table per cashier](user-guide/theme-ca-ket-tien-cashiers.png)

**Số đếm két trên ứng dụng** (built on 2026-11-19) puts the cash your staff counted at shift close in the Zalo staff app beside the POS. The big number is the shifts whose count is off from the expected cash by more than your cash thresholds, under the line "… ca đã đóng có số đếm"; the sentence adds how many closed shifts have no count yet. The table shows the first 10 shifts with the counted cash, the expected cash, the POS drawer and the difference (all of them in the CSV), and "Xem lịch sử két tiền" opens [Vận hành → Két tiền](#két-tiền-cash-counts) on the same days. Only owners and managers see the figures; other members read "Mục này chỉ dành cho chủ và quản lý.", and the demo, which has no staff app, says "Mục này cần ứng dụng nhân viên; bản demo không có nên chưa có số liệu." This card has no screenshot yet.

More detail: [reports/ca-ket-tien.md](reports/ca-ket-tien.md).

### So sánh cửa hàng (Store comparison)

So sánh puts two or more stores side by side. Choose them in the store picker ("Tất cả" or several stores); with one store, every card says "Chọn ít nhất hai cửa hàng để so sánh."

**Chỉ số theo cửa hàng** gives the share of revenue of the store that sells most, then one row per store with the same figures: revenue and its change against the range before, invoices, average ticket and its change, items per ticket, average item price, cash share, discount rate, invoices with a voucher, the share of invoices with an identified customer, revenue per opening hour and per seat-hour. The last row, **Tất cả cửa hàng**, is the stores added together: revenue and invoices are the sum of the rows above, and the averages and shares are worked out from those sums, not averaged. The sentence names the widest gap in average ticket and in items per ticket, or says the stores are about even. Revenue per opening hour shows "chưa thiết lập" for a store whose opening hours are not entered, and revenue per seat-hour for a store without opening hours or a seat count; the card links to the store settings. A store that opened after the range before began reads "chưa có dữ liệu kỳ trước" in the change columns; the all-stores row then compares only the stores that were open in both ranges, says so in its name ("cùng cửa hàng"), and the sentence gives how many of the stores that is. In any figure column, a cell with words instead of a number sorts after the numbers.

![The store figures card: the leading store's share, the bars of each store's revenue for the range before and this one, and the table with one row per store and the all-stores row](user-guide/theme-so-sanh-kpis.png)

**Cùng ngày, so sánh dáng** compares the shape of the stores' days rather than their size: each day's revenue of a store is divided by that store's own average day over the range, so 1 is an ordinary day for that store whatever its size. The lines show each store's index (five colours, then the same colours dashed from the sixth store on) and the card names the day the stores went most apart, with the gap between the highest and the lowest index that day as the number at the top. Ranges over 92 days, or many stores, are compared by week (or month) instead, per day with sales so a short week is not read as a weak one.

![The same-day card: the day the two stores went most apart, a line per store around the dashed line at 1, and each store's revenue and index per day](user-guide/theme-so-sanh-same-day.png)

**Từ ngày khai trương** lines the stores up on their own opening: week 1 of each store is its first seven days, whatever the date. It compares up to 26 weeks, as many as the youngest store has complete, with each week's average revenue per day with sales (as Năm does for a young store), and says how far the youngest store reached against an older store in the same week of its life, using the latest week in which neither store had a Tết day: Tết weeks are marked "có ngày Tết" in the table, and the sentence says when it had to step back from them. This card does not follow the chosen range. A store with less than one complete week is left blank ("—") and named under the sentence; several such stores are named together.

![The since-opening card: the young store's latest complete week, a line per store from week 1, and each store's weeks with their average per day](user-guide/theme-so-sanh-since-opening.png)

More detail: [reports/so-sanh.md](reports/so-sanh.md).

### Chất lượng dữ liệu (Data quality)

Chất lượng dữ liệu lists what is missing or wrong in your data, so that every other report gets more complete over time. Each card counts one kind of finding, and every finding says where to fix it, in the column "Cách sửa": "Sửa trong POS: …" when the fix belongs in the POS, the Settings page and tab when it belongs in the app, or running the sync again for a day. The link under the card's note opens that Settings page. The page itself changes nothing, and it shows counts only, never a customer.

**Hóa đơn điện tử, đánh số hóa đơn và hồ sơ cửa hàng** names every store whose e-invoice status is not recorded as "Đã đăng ký" in Cài đặt → Cửa hàng, with the hint to register cash-register e-invoices in the POS and the link "Ghi trạng thái hóa đơn điện tử" to record the status once it is done. A store not yet recorded reads "Chưa rõ" and is flagged too. The same card flags a receipt numbering that is not recorded or that the data contradicts, a member feature switched off (switch it on in the POS, then record it), and missing opening hours, seats or opening date; "Mở hồ sơ cửa hàng" opens Cài đặt → Cửa hàng for those, and the second table shows each store's profile at a glance.

![The compliance card of the demo: Cửa hàng mẫu 2 flagged for e-invoicing, its other findings with how to fix them, and the profile of both stores](user-guide/theme-chat-luong-compliance.png)

**Món chưa có nhóm, nhóm chưa có vai trò** lists the items sold without a category, with their share of item revenue, and the categories with sales but no role. "Phân loại món" opens Cài đặt → Phân loại → Nhóm của món, where the same items are listed under Chưa phân loại; once you choose a category there, the item is gone from this card the next time you open it. "Gán vai trò món" opens the roles.

![The uncategorised card of the demo: one item without a category, its share of item revenue and the link to choose its category](user-guide/theme-chat-luong-uncategorised.png)

**Ngày chưa đối soát** lists the store-days that do not match the POS totals or were not checked, the same rule as the "chưa đối soát" badge, with the hint to run the sync again for that day. Over long ranges the days are grouped by week or month. **Món chưa có giá vốn** gives the share of item revenue that had a cost on the day it was sold, the same figure as on Thực đơn, and the 20 best sellers that still have no cost, with the link to enter costs. **Phương thức thanh toán chưa phân loại** lists the payment methods the POS counts as "Khác" and that you have not classified, with the link to Loại thanh toán (a method you set to "Khác" yourself is not listed), and any method missing from the POS catalogue. **Dòng tùy chọn** shows how many sold lines are sugar, ice or free-topping choices, which never count as items, and how many catalogue modifiers were sold as items (normally 0). **Định danh khách và đồng ý** gives the share of invoices that carry a phone number or a customer id and, once invoices are linked to customers of the customer list, how many of them agreed to loyalty, with the reminder to use "Thêm khách hàng" at payment. Until then, while invoices carry phone numbers only, the card says so instead of showing a 0 % coverage.

![The verification card of the demo: two store-days not verified, each with its state and the hint to run the sync again](user-guide/theme-chat-luong-verification.png)

Two cards, built on 2026-11-19, look at what your staff record in the Zalo staff app, over the last 92 days of the range at most (the card says so when the range is longer). **Ca đã đóng chưa đếm két** lists the shifts closed on the POS without a cash count in the app, with the date, store, shift, closing time and the POS drawer; "Xem lịch sử két tiền" opens Vận hành → Két tiền. **Checklist bị bỏ** lists the checklists that were due and never finished, with the date, store, part of the shift and checklist, the rule for when a checklist is due (see [Vận hành → Checklist](#checklist-compliance)), and "Xem tuân thủ checklist". As on Ca & két tiền, only owners and managers see them, and the demo explains that it has no staff app. These cards have no screenshot yet.

More detail: [reports/chat-luong.md](reports/chat-luong.md).

### Links, printing and CSV

The address names the range (`#/chu-de/gio-ngay?range=28d`, or `?from=2026-10-08&to=2026-11-06`) and, when not every store is selected, the stores (`&store=…`). Two dates that make up a preset open as that preset, so the address then reads `range=…`. Printing and "Tải CSV" work as on the reports; theme files are named `<theme>-<card>-<from>_<to>.csv`, for example `doanh-thu-net_revenue-2026-10-07_2026-11-03.csv`.

## Cài đặt (Settings)

"Cài đặt" in the navigation opens the settings. The page names sit in a row under the heading on a phone and stand as a column on the left on a wide screen. Nine pages are open today, **Cửa hàng**, **Dữ liệu nhập tay** (item costs, monthly targets and payment fees), **Phân loại** (item-type roles, item categories and payment kinds), **Ngày lễ**, **Ngưỡng báo cáo**, **Pháp lý**, **Nhân viên** and **Checklist**, which only owners and managers find in the list ([Nhân viên và ứng dụng Zalo](#nhân-viên-và-ứng-dụng-zalo-staff-and-the-zalo-staff-app) below), and **Khách hàng thân thiết** ([Khách hàng thân thiết](#khách-hàng-thân-thiết-loyalty-programme) below). **Cảnh báo** (alerts) and **Bản tin** (the daily digest) are already in the list: each says what it will hold and that it comes with phase 12.

### Cửa hàng (Stores)

![Cửa hàng on a computer: one store's block with the facts from the POS marked "lấy từ POS", its code, opening date, opening hours, seats, e-invoice status, receipt numbering and member features, and its save bar](user-guide/settings-cua-hang.png)

Settings open on this page. It holds the facts of your business and of each store that the reports, alerts and compliance checks rely on.

- **Doanh nghiệp** (Business): the **Loại hình pháp lý** (household business, micro-enterprise, small enterprise, other enterprise, or not yet known), which decides whether storing customer data on servers abroad needs a dossier, and the **Ngôn ngữ mặc định** (Tiếng Việt or English). A member who has never pressed VI or EN on a device opens the app in the default language; once they press it, that device keeps their choice. If you have never pressed VI or EN yourself, saving English as the default switches your own screen to English at once; press VI to keep Vietnamese on your device. Only an owner who sees every store can change this block.
- **One block per store you can see.** The name, address, time zone and the hour the business day starts are marked "lấy từ POS": they come from the POS and cannot be changed here. You can set:
  - **Mã cửa hàng**: up to 12 characters, different from the other stores' codes; it appears in labels and in the cost CSV. Leave it empty for no code.
  - **Ngày khai trương**: lines up comparisons since opening.
  - **Giờ mở cửa**: per weekday, closed or up to three spans (a store whose hours were never entered says so above the days, which all start as closed); a span closing at or before its opening runs past midnight, and "Chép sang các ngày khác" copies a day. Saving the hours changes Giờ & ngày, the opening-hour figures of Hôm nay, when the sync runs during the day and when the digest is sent. Only an owner of the store can change them; a manager sees them with a note saying why.
  - **Số ghế**: RevPASH (revenue per seat per hour) appears on Giờ & ngày once it is set.
  - **Hóa đơn điện tử** (not known, not registered, registered, turned off), **Đánh số hóa đơn** (every day, every year, never, not known) and **Tính năng thành viên trên POS** (not known, on, off). Under Đánh số hóa đơn the page says what the receipt numbers of the last months suggest, once at least 20 days have numeric receipt numbers; "Dùng gợi ý" fills it in when they restart every day. The demo's receipt numbers are not plain numbers, so the demo shows no suggestion.
- Each block has its own save bar: **Lưu** saves only what you changed in that block, and the line under it says when it last changed and who changed it ("Bạn", or the role). A code another store already uses is refused with "Không lưu được: mã này đã dùng cho một cửa hàng khác của chuỗi.", and an unfinished time span keeps Lưu unavailable.
- Owners and managers of a store can change its block; other members see every value with a note saying why not. In the demo a change lasts until the page is reloaded.

### Dữ liệu nhập tay (Manual data)

![Giá vốn on a computer: the scope locked while a cost is typed, a search for "matcha", one item with today's cost, its share of the price and its history of two costs, and the next item with a new cost dated 01/01/2023; the box for the CSV template and import sits above the search](user-guide/settings-gia-von.png)

This page holds what the POS does not know. It has three tabs: **Giá vốn** (item costs), **Mục tiêu** (monthly targets) and **Phí thanh toán** (payment fees).

**Giá vốn** is what one item sold costs you. Thực đơn uses it for the margin of each item and for the menu matrix; an item without a cost is still classed on its price and marked "tạm tính".

- **Áp dụng cho**: "Tất cả cửa hàng" sets one cost for every store; choosing a store sets that store's own cost, which it uses instead of the shared one from its date. A store that has no cost of its own shows the shared one, marked "theo Tất cả cửa hàng". You can switch only once your changes are saved or cancelled.
- **The list** starts with the items sold over the last 90 days, best sellers first, then the rest of the menu (toppings and other options are never listed). Each item shows its size, category, list price and 90-day revenue, today's cost with the date it started and its share of the price, and who saved it last. **Tìm món** finds an item by name, size, code or category, with or without Vietnamese marks; **Xem thêm 25 món** shows more.
- **Entering a cost**: type it in **Giá vốn mới** (whole đồng; "18000" becomes "18.000" when you leave the field) and check **Áp dụng từ ngày**:
  - an item's very first cost starts on **01/01/2023** and covers the whole sales history ("Áp dụng cho toàn bộ lịch sử bán."), so Thực đơn shows its margin for any range at once;
  - a later change starts **today** ("Từ ngày này trở đi; các ngày trước giữ giá vốn cũ."): the days before keep the earlier cost, so past margins do not move;
  - a store's own cost for an item that already has a cost for all stores also starts **today** ("… các ngày trước giữ giá vốn chung."). If you pick an earlier date, the page warns that the store's cost replaces the shared one on those past days too ("… kể cả các ngày đã qua.");
  - when a later cost exists, the line under the date says the last day your cost covers ("… đến hết 31/05/2026 …");
  - picking a date that already has a cost replaces that cost ("Thay giá vốn đang có từ đúng ngày này.").
- **Lưu** saves every cost you typed together, or none of them. A negative cost, a fraction of a đồng ("Nhập số tiền chẵn đồng, không có phần lẻ."), more than 100.000.000 ₫ or a changed date without a cost keeps Lưu unavailable; nothing is rounded for you. An item you are changing stays on the list even when the search would hide it, and you can switch **Áp dụng cho** only once the changes are saved or cancelled.
- **Lịch sử giá vốn** lists an item's costs in the chosen scope, newest first, with the one in force marked "đang áp dụng"; **Xóa** removes one, and the days it covered go back to the earlier cost. If the connection drops, the page says it could not delete and offers **Thử lại**.
- After a save, the next Thực đơn you open uses the new costs, even if you go back to a page you had open before.

![The cost CSV import on a computer: the preview of a file with the date-order choice, the counts of rows to save, unchanged and to fix, and each row with its store, cost, date and outcome: two to save, a fraction of a đồng refused, a cost above the price saved with a warning and an unknown item code](user-guide/settings-gia-von-import.png)

- **Many costs at once from a spreadsheet** (box **Nhập giá vốn bằng tệp CSV**):
  - **Tải mẫu** downloads the items of the chosen scope as a CSV file, in the format chosen for this device under Ngưỡng báo cáo (commas, or semicolons for an Excel set to Vietnamese). It opens in Excel with the Vietnamese names intact. The columns are `ma_mon` (item code), `ten_mon` and `size` (for your reading only), `ma_cua_hang` (the store code, empty for all stores), `gia_von` (today's cost, empty when the item has none) and `tu_ngay` (the date it applies from).
  - Fill in `gia_von` in whole đồng ("25000", "25.000" and "25,000" all work; "8333,33" is refused, never rounded). Leave `tu_ngay` empty for an item's very first cost, which then covers the whole history from 01/01/2023; an item that already has a cost needs a date. Leave `ma_cua_hang` empty to use the scope chosen on the page (the preview names it), or write a store's code (Cài đặt → Cửa hàng); a row is accepted only for an item the page lists in that scope. Leave a row's cost and date empty to skip it.
  - **Nhập từ CSV** opens a preview before anything is saved: each row with its store, cost and date as the app reads them, and what will happen ("Sẽ lưu.", or why not). Rows identical to the costs already saved are only counted. A cost above the list price is saved with a warning. If the file's dates could be day first or month first ("03/04/2026"), choose **Thứ tự ngày** and the dates are read again.
  - **Lưu n dòng** saves all the good rows together, or none: if the save fails, nothing is saved and the preview stays: after a lost connection you can try again, and when an amount is refused you fix the file and import it again. One file holds at most 2,000 rows to save; split a bigger one. Rows marked to fix are not saved; correct them in the spreadsheet and import the file again.
- Owners and managers can enter costs for their stores; the costs for all stores need an owner or manager who sees every store. A manager of one store sees the shared costs read-only and enters their store's own. Other members read every cost with a note saying why not. In the demo a cost lasts until the page is reloaded.

#### Setting a monthly target

![Mục tiêu on a computer: Cửa hàng mẫu 2 chosen, six months from August 2026 to January 2027, November marked "tháng này" with its saved target, who saved it, and this month's pace: the net revenue so far and both forecasts, each with its share of the target, and the link to the monthly report](user-guide/settings-muc-tieu.png)

**Mục tiêu** is the net revenue you aim for in a month, per store. Tháng compares the month so far and both forecasts with it on its **Tiến độ mục tiêu** card.

- **Cửa hàng**: choose the store. A manager of one store opens on it. You can switch only once your changes are saved or cancelled.
- **The months** run from three months back to two months ahead; the current one is marked "tháng này". Each shows its target ("Mục tiêu: 210.000.000 ₫") or "Chưa đặt mục tiêu." and who saved it last. Type the amount in **Mục tiêu doanh thu thuần** (whole đồng; "210000000" becomes "210.000.000" when you leave the field) and press **Lưu**; you can change several months at once.
- **Tiến độ tháng này**, under the current month, shows the net revenue up to yesterday and where the two forecasts say the month will end, each with its share of the target. **Xem tiến độ trong Báo cáo tháng** opens Tháng for that month and store, where the card shows the progress, how much is still needed each remaining day and both forecasts against the target.
- 0, a fraction of a đồng and more than 999.999.999.999 ₫ keep Lưu unavailable. A saved target cannot be removed, only replaced by a new amount. Weekly targets are not set here.
- Owners and managers set targets for their stores; other members read them with a note saying why not. In the demo a target lasts until the page is reloaded.

#### Payment fees

![Phí thanh toán on a computer: the methods grouped under Tiền mặt, Ví điện tử and Chuyển khoản; the e-wallet with today's fee of 1,1% from 01/01/2023, who saved it, its history and the date of its next rate set to today; the bank transfer with a new rate typed and its date 01/01/2023](user-guide/settings-phi.png)

**Phí thanh toán** is what each payment method costs you: a percentage of the amount and, if your provider charges one, a fixed fee per payment. Thanh toán & tiền mặt uses it for **Phí thanh toán ước tính**.

- **Áp dụng cho**: "Tất cả cửa hàng" sets one fee for every store; choosing a store sets its own fee, used instead of the shared one from its date, as for item costs.
- **The methods** come from your POS, grouped by kind (Tiền mặt, Ví điện tử, Chuyển khoản, Thẻ, Voucher, Khác). Each shows today's fee with the date it started.
- **Entering a fee**: type **Tỷ lệ phí mới** (for example "1,1" for 1,1 %), and **Phí cố định mỗi lần** if there is one, then check **Áp dụng từ ngày**: a method's first fee starts on **01/01/2023** and covers the whole sales history; a later change starts **today** and leaves the earlier days at the earlier fee; a store's own first fee for a method that already has a fee for all stores also starts **today**, and picking an earlier date warns that it replaces the shared fee on those past days too; the line under the date says which days the fee covers.
- A fee above 20 %, more than three decimals, or a fixed fee above 100.000 ₫ keeps Lưu unavailable.
- After **Lưu** the page says "Ước tính phí của các ngày đã qua sẽ được tính lại theo mức phí này." Fee estimates are worked out when the figures are refreshed, so the line at the top ("Số liệu đang cập nhật theo thay đổi cài đặt …") shows the update running; when it says it has finished, Thanh toán shows the new estimates. In the demo they change at once.
- **Lịch sử phí** lists a method's fees in the chosen scope, newest first, with the one in force marked "đang áp dụng".
- Who may change fees is the same as for item costs.

More detail: [manual-data.md](manual-data.md).

### Phân loại (Classification)

![Phân loại on a computer: the item types of the POS account with their roles and 28-day sales, a suggestion next to an unassigned type, and the save bar](user-guide/settings-phan-loai.png)

Each item type of the POS (the categories the POS sorts its items into, such as "Trà sữa" or "Topping") needs a **role**: Đồ uống, Đồ ăn, Đồ ăn nhẹ, Topping or Khác. The reports use the roles to measure how often a drink comes with a topping or a snack (the attach rates on Tháng and Thực đơn), and the menu matrix compares each item only with the others of its role. A type without a role reads **Chưa gán**, and the attach-rate cards say so with a link here ("Gán vai trò món").

- The **Vai trò nhóm món** tab lists the item types under the name of their POS account, each with how many of its items sold over the last 28 days (an item sold in several sizes counts once) and its share of the business's item revenue, so the types that matter come to mind first. If you change a role on another phone meanwhile, the page takes it and keeps what you are changing.
- An unassigned type whose name says what it is shows a suggestion ("Gợi ý: Topping"). **Áp dụng gợi ý cho … nhóm chưa gán** fills every suggestion in at once; nothing is saved until you press **Lưu**, so check them first.
- Choosing **Chưa gán** takes a role away. Lưu saves only the types you changed; Hủy thay đổi goes back to the saved roles.
- Owners and managers who see every store can change the roles; everyone else sees them with a note saying why not.
- Attach rates are worked out from the stored daily numbers, so after a save the line "Số liệu đang cập nhật theo thay đổi cài đặt" appears on the thematic reports and in Cài đặt while those days are recalculated ([Data freshness](#data-freshness-and-the-verified-badge)); it starts by itself for owners and managers. Labels such as the role of an item follow at once.
- The **Nhóm của món** tab puts an item into an item type when the POS has none for it, or has one the POS catalogue lacks. **Chưa phân loại** lists the items sold like that over the last 90 days, best sellers first. These are the same items Thực đơn counts as "Chưa phân loại", an item the POS sent without a code included. Each row says what the POS gives it ("Trên POS: chưa có nhóm"). An item can only go to an item type of its own POS account; there are no categories of the app's own, and the POS stays the best place to fix a category for good. Below them, **Đã chọn nhóm tại đây** lists the items you have already moved, with who saved them last, and **Tìm món** searches every item by name, size, item code or type; you can type without Vietnamese marks ("banh flan" finds "Bánh flan"). Choosing **Theo POS** removes your choice and the item counts in its POS type again. After **Lưu** the item leaves Chưa phân loại, and the next report you open, Thực đơn's category mix included, shows it in its new type; the attach rates follow once the days are recalculated (the line above).

  ![Nhóm của món on a computer: the uncategorised demo item, then a search for "banh" with the matching items and what the POS gives each](user-guide/settings-nhom-mon.png)

- The **Loại thanh toán** tab lists each payment method of the POS with the kind the POS gives it, your choice and the kind in effect ("Trên POS: Khác · Đang tính là: Ví điện tử"). Choose the right kind when the POS has it wrong, or **Theo POS** to go back to the POS's kind. The cash figures and the payment mix follow once the days are recalculated. The expected cash in the drawer of past shifts changes only after those days are synced again, and the tab says so.

  ![Loại thanh toán on a computer: the note on past shifts' expected cash, then each payment method of the demo's POS account with the kind the POS gives it and the kind in effect](user-guide/settings-loai-thanh-toan.png)

- The same people may save these two tabs as the roles; everyone else reads them with the same note.

### Ngày lễ (Holidays)

![Ngày lễ on a computer: the year, one day off of the business with who saved it and its Xóa button, the form to add another, then the national days of 2026 with their kind](user-guide/settings-ngay-le.png)

The reports compare a day with the same weekday of the 8 weeks before ("mức nền cùng thứ") and forecast from past days. A holiday, or a day the shop was closed or unusually busy, would pull those numbers off, so such days are left out. This page shows which days that are.

- **Năm** chooses the year, from 2024 to 2030; the page opens on the current year.
- **Ngày nghỉ riêng** (your own days off): days that count for your business only, such as a day closed for repairs or a local festival. Add one with its date and a name of up to 80 characters, then **Thêm**; **Xóa** removes it. The line under each day says when it was saved and who saved it ("Bạn", or the role). The same date cannot hold two days off with the same name.
- The next report you open leaves such a day out. On Ngày, for example, the chip "so với mức nền cùng thứ" turns into "so với mức nền (7/8 tuần)" when one of the 8 weeks is a day off; deleting the day brings the week back.
- **Ngày lễ quốc gia** (national holidays) lists the public holidays and the Tết days of the year, each marked "Ngày lễ" or "Tết". They come with the app and cannot be changed here. The national calendar comes with the app for 2024 to 2028 only, because the days that follow the lunar calendar (Tết, Giỗ Tổ Hùng Vương) are worked out year by year, so 2029 and 2030 show no national days yet; your own days off of those years still count.
- Owners and managers who see every store can add and remove days off; everyone else sees both lists with a note saying why not. In the demo a change lasts until the page is reloaded.

### Ngưỡng báo cáo (Report thresholds)

![Cài đặt on a computer: the page names on the left, then the Thực đơn, Tiền mặt, Giờ and Khuyến mãi thresholds with their defaults, the save bar and the choice kept on this device](user-guide/settings-bao-cao.png)

The reports decide what to flag from nine thresholds. They belong to the whole business, not to one store, and every report reads the same values: saving here changes Ngày, Tháng, the thematic reports and the daily digest together, and the page says so.

| Group | Threshold | What it changes | Default | Allowed |
|---|---|---|---|---|
| Thực đơn | Số ngày xét thực đơn | how many of the latest days the menu matrix classes items over | 28 ngày | 7 to 91 |
| Thực đơn | Ngưỡng bán chạy | an item is popular when its share of the quantity sold reaches this much of an even split among the items of its role | 70 % | 10 to 100 % |
| Thực đơn | Số món tối thiểu mỗi vai trò | a role with fewer items is classed for reference only | 10 món | 2 to 50 |
| Tiền mặt | Chênh lệch két theo số tiền | a shift is flagged when its drawer variance exceeds this amount | 50.000 ₫ | 0 ₫ or more, whole đồng |
| Tiền mặt | Chênh lệch két theo tỷ lệ | a shift is flagged when its drawer variance exceeds this share of the shift's cash sales | 0,5 % | 0 to 10 % |
| Giờ | Số giờ cao điểm | how many of the best-selling hours count as peak hours | 3 giờ | 1 to 6 |
| Giờ | Ngưỡng giờ thấp điểm | an hour selling below this share of the average hour is a quiet hour | 50 % | 10 to 90 % |
| Giờ | Ngưỡng giờ đông | an hour with invoices at or above this share of the average hour is busy; busy hours in a row form the suggested shift windows | 125 % | 105 to 300 % |
| Khuyến mãi | Số tuần trước khuyến mãi | how many weeks before the first promotion day Hiệu quả khuyến mãi compares with, when it compares with the weeks before or with a store that did not run it | 4 tuần | 2 to 8 |

- A shift is flagged when it passes any of three rules. The third, the z-score of the variance, is fixed at 2 and shown for reference. If most shifts are flagged for small differences, raise the two cash thresholds; lower them to watch the drawer more closely.
- Each field shows its default under it. A value outside its range is refused as soon as you leave the field, with the allowed range in words, and "Lưu" stays unavailable until it is corrected. An amount may be typed as `80000`, `80.000` or `80,000`: all three are 80.000 ₫, since đồng have no fraction. A percentage takes a comma or a point as its decimal mark.
- Changes wait in the bar at the foot of the page, which counts them: **Lưu** saves only what you changed, so a value someone else saved meanwhile is kept, and **Hủy thay đổi** goes back to the saved values. After a save the line under the fields says when the thresholds last changed and who changed them: "Bạn" for yourself, otherwise the role (chủ, quản lý), never a name.
- **Khôi phục mặc định** fills every field with its default; press Lưu to apply it. When a save leaves every threshold at its default, the business has no thresholds of its own any more, and the line reads "Đang dùng giá trị mặc định."
- Only an owner who sees every store can change the thresholds, because they also decide which of a manager's shifts are flagged. Everyone else sees the values with a note saying why they cannot be changed, and no save bar.
- In the demo a change lasts until the page is reloaded.

#### Thiết bị này (This device)

| | |
|---|---|
| ![The Thiết bị này box on a phone, with the two CSV formats](user-guide/settings-thiet-bi-phone.png) | The box under the thresholds holds a choice that belongs to the phone or computer in your hand, and any member may make it: the format of the files that "Tải CSV" writes. |

- **Dấu phẩy (mặc định)**: commas between values and a decimal point. Google Sheets, Numbers, LibreOffice and an Excel set to English read it.
- **Dấu chấm phẩy cho Excel cài đặt vùng Việt Nam**: semicolons and a decimal comma (`12,5`). Choose it when Excel puts a whole row in one column.
- The choice takes effect at once, for every table of the reports and the thematic reports, and stays on this device after a reload. Both formats keep the byte-order mark, so Vietnamese letters show correctly.

### Pháp lý (Legal texts)

![Pháp lý on a computer: the Thông báo bảo mật section with the Vietnamese draft, its status, its version label and its buttons, and the empty English list](user-guide/settings-phap-ly.png)

This page keeps the business's legal texts as numbered versions. A version that is published can never be changed or deleted, so every consent a customer or staff member gives later points at the exact text they saw. The app writes no legal wording: you write the texts, or have them written, and publish them here when they are ready.

- **Six kinds of text**, each with a list in Tiếng Việt and one in Tiếng Anh: Thông báo bảo mật (privacy notice), Quy định bảo vệ thông tin (information-protection rules), Điều khoản Mini App (Mini App terms), Thông báo cho nhân viên (staff notice), Nội dung đồng ý tích điểm (loyalty consent text) and Nội dung đồng ý nhận tin quảng cáo (marketing consent text). The Mini Apps show these texts. The Vietnamese **Thông báo cho nhân viên** is the first in use: the staff app shows the published version before anyone pairs, and nobody can pair while none is published ([Nhân viên và ứng dụng Zalo](#nhân-viên-và-ứng-dụng-zalo-staff-and-the-zalo-staff-app)); the other texts are kept here until their phases.
- Each list starts with the version in force ("Đang áp dụng: …, công bố …"), then the drafts, then the versions no longer in force, newest first. Every version shows its **Mã phiên bản ghi khi đồng ý**, the label each consent will record, and the dates it was published and retired. **Xem nội dung** shows a version's text.
- In the demo, the Vietnamese privacy notice starts as a draft made of the skeleton's headings.

#### Publishing the privacy notice

1. Under Thông báo bảo mật, Tiếng Việt, press **Tạo bản nháp** (or **Sửa** on a draft that is already there).

   ![The draft editor on a computer: the title, the version label with its suggestion, "Tạo bản nháp từ khung" with what the skeleton holds, the Soạn and Xem trước buttons, the text box with the six headings, and Lưu bản nháp](user-guide/settings-phap-ly-editor.png)

2. Give it a **Tiêu đề** (title) and keep or change the **Mã phiên bản**. The page suggests the kind and the month, such as `privacy-notice-2026-11`, with `.2` added when that label is taken. A label holds lower-case letters without accents, digits, dots and hyphens, at most 40 characters, and differs from the other versions of that text.
3. Write the text in **Nội dung (Markdown)**: `##` starts a heading, `-` a list item, and `**…**` makes words bold. **Tạo bản nháp từ khung** fills an empty box with six headings to write under: purpose, data collected, retention, people's rights and how to use them, contact, and the processors and foreign hosting involved. It adds no legal wording. **Xem trước** shows the text as it will read; **Soạn** goes back to writing.
4. Press **Lưu bản nháp**. A draft can be edited, saved again or deleted (**Xóa bản nháp**) as often as you like.
5. Press **Công bố** on the draft. The page asks first, because a published text is final, and names the version in force that publishing retires at the same time:

   ![The confirmation under a draft: publishing makes the text final, with the Công bố and Quay lại buttons](user-guide/settings-phap-ly-confirm.png)

   Press **Công bố** again to publish, or **Quay lại** to keep the draft. The publication date comes from the database's clock, not from your device.
6. To change a published text, create a new version and publish it. **Ngừng áp dụng** withdraws the version in force without a replacement, after the same kind of question; a retired version cannot be put back in force.

- Only an owner who sees every store can write, publish or retire texts. Everyone else reads the page with a note saying so, and sees no button except Xem nội dung.
- If the text was published or withdrawn meanwhile on another device or tab, the page says so instead of acting twice and shows the list as it now stands.
- At the foot of the page, **Mục liên quan** names what comes later (the customer consents and personal-data requests, phase 17a) and leads to the **Loại hình pháp lý** on Cửa hàng.
- In the demo a change lasts until the page is reloaded.

## Nhân viên và ứng dụng Zalo (Staff and the Zalo staff app)

The staff app is a Zalo Mini App for your staff and managers: they open it inside Zalo, on their own phone, from a QR code at their store. On Cài đặt → **Nhân viên** you decide who may use it, in which role and for which stores, and you give each person a one-time code to pair their Zalo account. The page and the database behind it were built on 2026-11-18. The staff app itself has its first screen (Trang chủ) and runs in a browser for now: it reaches Zalo only once the owner's Zalo accounts exist and the app has been checked on a phone (#218). This section has no screenshots yet.

### Cài đặt → Nhân viên

- **Who sees it.** Owners and managers. Staff, viewers and other accounts do not find Nhân viên in the settings list; if they open its address they read "Trang Nhân viên chỉ dành cho chủ và quản lý." and nothing else.
- **Danh sách nhân viên** (the roster) lists one card per person: the name, **Vai trò** (Nhân viên or Quản lý), **Cửa hàng** (the stores, or "Tất cả cửa hàng"), **Trạng thái**, **Ghép nối** and **Số điện thoại**, with the line saying when the card last changed and who changed it. The statuses are **Chờ ghép nối** (added, not yet paired), **Đang hoạt động** (paired and using the app) and **Đã ngừng từ …** (deactivated). **Ghép nối** reads "Đã ghép nối ngày …" or "Chưa ghép nối"; a person who withdrew their agreement in the app reads "Đang hoạt động" but "Chưa ghép nối" until they pair again. The phone shows only its last digits ("…678"), and only once the person has linked it themselves; until then it reads "Chưa liên kết". Deactivated people come last.
- **Adding a person.** Press **Thêm nhân viên**, type the **Tên hiển thị** (the name you and their colleagues know them by, at most 100 characters), choose the **Vai trò** and tick the **Cửa hàng làm việc**, then press **Thêm**. A **Quản lý** may add, edit and deactivate staff in their own stores. An owner or manager who sees every store may also tick "Tất cả cửa hàng, cả cửa hàng mở sau này"; a manager of some stores is offered only those, and never "every store" or the owner role. The new card waits as "Chờ ghép nối".
- **Editing.** **Sửa** on a card opens the same form. A change of role or stores applies at once, also to a person already using the app.
- **Deactivating.** When someone leaves, press **Ngừng** on their card. The page asks first: "Ngừng quyền của …? Người này bị đăng xuất khỏi ứng dụng nhân viên ngay; muốn dùng lại phải được mở lại và ghép nối lại." Press **Ngừng quyền** to confirm, or **Quay lại**. From then on the person has no access: they are signed out of the staff app at once, their pairing, phone and any code you gave them are removed, and the card reads "Đã ngừng từ …". Their earlier agreements stay recorded as evidence.
- **Reactivating.** **Mở lại** on a deactivated card puts the person back to "Chờ ghép nối" ("Đã mở lại …; người này cần ghép nối lại."). They get access again only by pairing with a new code.
- **People outside your stores.** A manager of some stores sees the people of those stores only. A card that also covers a store outside your stores shows "Người này làm ở cửa hàng ngoài phạm vi của bạn nên bạn chỉ xem được." and no buttons.

### Pairing a person with the staff app

1. **Publish the staff notice first.** On Cài đặt → Pháp lý, publish the Vietnamese **Thông báo cho nhân viên**: the text that tells staff what the app keeps about them and why. The staff app shows it before anyone pairs, and pairing is refused while no version is published. When you publish a new version later, people already paired are asked to accept it again ("Đồng ý") the next time they open the app.
2. **Give them the app.** **Ứng dụng nhân viên trên Zalo**, further down the page, shows one QR code per store: scanning it with Zalo opens the staff app for that store. A store needs a **Mã cửa hàng** on Cài đặt → Cửa hàng before it has a QR code, and the business needs its staff Mini App set up (the page says so when either is missing). **In mã QR** prints the codes to put up at the till or in the back office. The codes are drawn on your own screen; nothing is sent anywhere to make them.
3. **Create their code.** Press **Tạo mã ghép nối** on the person's card. The six-digit code appears once, in large figures, with "Còn hiệu lực" counting down from 10 minutes, and **Chép mã** to copy it. Hand it over in person or read it out. The page keeps it nowhere: close the panel or let it run out ("Mã đã hết hạn…") and it is gone. Creating a new code replaces the previous one, so only the latest works. A code is used once; a deactivated person, or a card linked to an owner's, viewer's or reporting account, gets no code ("Không tạo được mã: …").
4. **What the person does.** They scan the QR code with Zalo, read the staff notice and press **Đồng ý**, then type the six digits. Their Zalo account is then paired with their card: the card reads "Đang hoạt động" and "Đã ghép nối ngày …", and the app opens on their stores. They never get a password. A wrong, used or expired code gets the same answer, without saying which; after five wrong codes in 15 minutes that Zalo account must wait 15 minutes. **Not yet in the app:** the screens that show the notice before pairing and take the six-digit code come with the next piece of work (#215); the database and the sign-in function already accept them. Until then the app's "Tài khoản chưa được liên kết" screen takes only the older "Mã liên kết" that whoever runs the system creates with `fnb zalo bind`.
5. **Withdrawing.** Only the person can withdraw their agreement to the staff notice; owners and managers cannot do it for them. They are then signed out and need a new code to pair again. Their agreement to receive the digest and alerts is not touched.

### Lời nhắn liên hệ (the contact note)

**Lời nhắn liên hệ trên ứng dụng nhân viên**, below the QR codes on Cài đặt → Nhân viên, is the note the staff app shows before a person pairs and whenever they cannot get in: write whom to see or how to reach you to get a pairing code. Left empty, the app shows its own default note ("Chưa có lời nhắn; ứng dụng đang hiện lời nhắn mặc định."). One note serves the staff app of every brand of the business.

- Plain text, line breaks allowed, at most 500 characters; the counter under the box shows "Đã nhập …/500 ký tự". A link is refused ("Lời nhắn không được chứa đường link; ghi tên người hoặc số điện thoại thay vào."): write a name or a phone number instead.
- Press **Lưu** on the bar "Lưu lời nhắn liên hệ".
- Only an owner who sees every store can change it. Managers, and an owner of some stores, read it with "Chỉ chủ quán quản lý tất cả cửa hàng sửa lời nhắn này."

### What staff see of revenue

**Doanh thu nhân viên được xem**, at the foot of Cài đặt → Nhân viên, decides what people with the role Nhân viên see of the sales. It applies to every staff member of the business; owners, managers and viewers always see what their role allows.

| Choice | What staff see in the staff app |
|---|---|
| **Toàn bộ doanh thu của cửa hàng mình** (the default) | Everything a manager of their stores sees: today's net revenue and invoices, and whether yesterday matched the POS |
| **Chỉ tổng hôm nay** | Today's net revenue and number of invoices of their stores, nothing else |
| **Không xem doanh thu** | No figure at all; the app does not even ask for one |

Only an owner who sees every store can change it: choose and press **Lưu** on the bar "Lưu mức doanh thu nhân viên được xem". An owner of some stores sees the choice in force with a note saying why it cannot be changed; managers do not see this part. The database applies the choice to every sales figure and report a staff login can reach, not only to the app's screen.

### Cài đặt → Checklist

**Checklist** (`#/cai-dat/checklist`) holds the checklists your staff tick off in the staff app: one for opening (**Mở ca**), one for the middle of the shift (**Giữa ca**) and one for closing (**Đóng ca**), for one store or for every store ("Mọi cửa hàng"). The page was built on 2026-11-19; staff work through the checklists in the app's **Ca làm** tab, and [Vận hành](#vận-hành-shift-operations) shows what they did. This section has no screenshots yet.

- **Who sees it.** Owners and managers, as for Nhân viên; anyone else who opens the address reads "Trang Checklist chỉ dành cho chủ và quản lý." A manager edits the checklists of their own stores; a checklist for every store, or for a store outside their stores, shows "Checklist này thuộc cửa hàng ngoài phạm vi của bạn hoặc dùng cho mọi cửa hàng; chỉ chủ hoặc quản lý của tất cả cửa hàng sửa được." and no button.
- **Danh sách checklist** groups the checklists by store, each with its part of the shift, **Phiên bản …**, **Đang dùng** or **Đã ngừng dùng**, how many items and how many need a photo.
- **Creating one.** Press **Tạo checklist**, choose the **Cửa hàng** and the **Ca** (Mở ca, Giữa ca or Đóng ca), give it a **Tên checklist** (at most 120 characters), and list the items in the order staff do them. Each item has its text (at most 200 characters) and two ticks: **Cần ảnh** (staff must take a photo) and **Có số đo** (staff type a number, such as a fridge temperature, with its unit, for example °C or phần). Move items up or down, delete them, or add more with **Thêm mục**; a checklist holds 1 to 60 items. On an empty checklist, **Tạo từ khung** fills in the usual steps of that part of the shift (opening on the POS and counting the float, cleaning, reporting incidents, counting waste, the handover note, closing on the POS and counting the drawer); read the wording before you use it. The store and the part of the shift cannot be changed afterwards.
- **Changing one.** **Sửa** opens the same form; **Lưu phiên bản mới** saves a new version ("Đã lưu phiên bản … của …; áp dụng từ lần làm tiếp theo."). The staff app uses it from the next time the checklist is started, without an app update; a checklist already started, and every past one, keeps the words of its own version.
- **Ngừng dùng** stops a checklist: it is no longer due ("… checklist này không còn đến hạn."). **Dùng lại** brings it back.
- **Sao chép** copies a checklist to another store, as a new checklist with the same part of the shift, name and items.
- **In the demo** the page says that the demo has no staff app and so no checklists.

### The staff app's home (Trang chủ)

What a person sees after pairing, on the first of the four tabs (Trang chủ, Ca làm, Thông báo, Cá nhân; Thông báo stays empty until phase 15):

- "Xin chào, …" with their role, and **Cửa hàng**: their store, or a choice when they work in several stores of the brand.
- "Cập nhật lúc HH:mm" (with the date when it was an earlier day): when your business's last sync succeeded. "Chưa đồng bộ" means no sync has succeeded yet.
- **Hôm nay đến … · …**: **Doanh thu thuần** (net revenue, shortened like "12,5 tr ₫"; tap it for the exact amount) and **Số hóa đơn**, counted as Hôm nay in the web app counts them; then **Hôm qua · …** with "Đã đối soát" or "Chưa đối soát". Owners and managers see all three; staff see what [the choice above](#what-staff-see-of-revenue) allows.
- **Việc hôm nay · …**: the store's opening hours today, "Hôm nay cửa hàng nghỉ", or "Chưa có giờ mở cửa". Everyone sees this.
- A figure without sales yet reads "Chưa có dữ liệu", never 0. The numbers refresh every 5 minutes and when the app comes back to the front.

Since the shift work of phase 14b, **Việc hôm nay** also shows the checklist that is due and the shift close of the chosen store and opens them in **Ca làm**, the second tab, where staff do the checklists, count the cash at close, write the handover note and report incidents and items that ran out. [Vận hành](#vận-hành-shift-operations) shows you what they recorded.

### Trying the staff app on this computer or a phone

Before the Zalo accounts exist, whoever runs the system can open the staff app in a browser against the real sign-in and the business's real numbers on the build machine, signed in as a pretend Zalo user. This is a tool for trying the app, not how staff will use it. It needs the local database running, the login of the member to try it as (`FNB_MEMBER_EMAIL` in `.env`, or `--member <e-mail>`), and the brand's Zalo settings stored with pretend ids that start with `mock-` ([development.md](development.md) has the setup).

- **On this computer:** `pnpm zalo:dev`, then open the address it prints (`http://127.0.0.1:5741/`). It names the brand, the member's role and their number of stores. The first run pairs the pretend user with the member by itself.
- **On a phone on the same Wi-Fi:** `pnpm zalo:dev --lan`. It prints a link and a QR code to scan with the phone's camera. If the phone cannot connect, allow TCP port 5741 on private networks in the computer's firewall.
- **On a phone anywhere, for example an iPhone on mobile data:** `pnpm zalo:dev --tunnel`. It prints a public https link and a QR code through a Cloudflare quick tunnel and stops by itself after 4 hours (`--tunnel-hours`, at most 12). It works on a Windows computer only; the first time it downloads Cloudflare's program and checks it.
- **Stopping:** Ctrl+C, or type q and press Enter.

**Keep the link to yourself.** Whoever opens a `--lan` or `--tunnel` link is signed in as that member, with their role, their stores and the real figures. With `--tunnel` that means anyone on the internet who gets the link, until it stops. Do not post it in a group chat or a ticket. Each link carries a key that is new every time the tool starts: without it the app answers only "403 Forbidden", and once opened the browser keeps the key and drops it from the address bar. Stop the tool as soon as you are done.

## Vận hành (Shift operations)

Vận hành shows what your staff recorded in the Zalo staff app during their shifts: the checklists, the cash counted at shift close, and the incidents, items that ran out and handover notes. It was built on 2026-11-19 and tried on a test business; it fills up once your staff use the staff app. This section has no screenshots yet.

- **Opening it.** The page has no item in the navigation yet. The links "Xem lịch sử két tiền" and "Xem tuân thủ checklist" on the cards of Ca & két tiền and Chất lượng dữ liệu lead here, or add `#/van-hanh` after the app's address (`http://localhost:5173/#/van-hanh` on the local app). It has three tabs: **Checklist** (`#/van-hanh/checklist`, the first), **Két tiền** (`#/van-hanh/ket-tien`) and **Sự cố & bàn giao** (`#/van-hanh/su-co`).
- **Who can use it.** Owners and managers, for the stores they see. Anyone else reads "Trang Vận hành chỉ dành cho chủ và quản lý."
- **Stores and days.** The stores are the ones chosen in the top bar. The range picker works as on the thematic reports, with the last 7 days at first and at most 92 days, but here the days run up to today ("… ngày, tính cả hôm nay"), so this morning's shift is already there. The address keeps the days, the stores and the filters, so a link opens the same view.
- **Shifts** read "Ca 1", "Ca 2"… as on Ca & két tiền.
- **Printing and CSV.** Every table has "Tải CSV" (files named `van-hanh-checklist-<from>_<to>.csv`, `van-hanh-ket-tien-…` and `van-hanh-su-co-…`). Printing from the browser keeps the tables and adds a line naming the page, the days, the stores and the print date; the filters and the buttons are left out.
- **In the demo** the page says that the demo has no staff app, so there is nothing to show.

### Checklist (compliance)

**Tuân thủ checklist** gives, as its big number, the share of the checklists that were due and got finished, on time or late (**Tỷ lệ checklist xong**). The sentence counts those finished on time, late and missed; today's checklists still in progress or not yet due are named apart and do not count yet. The table has one row per checklist, store, day and part of the shift, with its **Trạng thái**:

| Trạng thái | Meaning |
|---|---|
| **Xong** | finished before its deadline |
| **Xong muộn** | finished after its deadline |
| **Đang làm** | started today, not finished yet |
| **Chưa đến hạn** | today's, and its deadline has not passed |
| **Bị bỏ** | a past day without a finished round, or today's after its deadline |

The deadline comes from the opening hours on Cài đặt → Cửa hàng: an opening checklist is due by opening time, a mid-shift one by the middle of the opening hours, a closing one within 60 minutes after closing time. In a store without opening hours, finishing during the day counts as on time. A checklist you stopped using counts only on the days someone did it. The row also shows the items done, the photos, who did it, when it started and finished, the deadline and any change made after it was finished. When the chosen stores have no checklist, the card says so and links to Cài đặt → Checklist ("Soạn checklist ở Cài đặt").

**Chi tiết từng lần làm** lists every round in the range. **Xem chi tiết** opens one: each item with its answer, its number and who answered when, in the words of the version that was used that day, and the changes made after it was finished ("… sửa mục … lúc …"). Photos load only when you open a round ("Ảnh chỉ tải khi mở."), straight from the app's private storage. A photo is kept 90 days by default; after that the item reads "Ảnh đã xóa theo thời hạn lưu."

### Két tiền (cash counts)

**Số đếm két theo ca** puts the cash counted in the staff app at each shift close beside the POS: the big number is the shifts whose count is off from the expected cash by more than your cash thresholds, the same thresholds and rule as Ca & két tiền ("… ca đã đóng có số đếm" under it), and the sentence adds the closed shifts without a count. Each row shows **Đếm trên ứng dụng**, **Tiền mặt dự kiến** (the opening float plus the cash taken), **Két POS** (what the cashier typed in the POS at close), **Chênh lệch đếm** (the count minus the expected cash), which threshold it went over, who counted, when, and how often the count was reopened. A row reads **Trong ngưỡng**, **Vượt ngưỡng**, **Chưa đếm**, or **POS không có số dự kiến**. A count made before its POS shift was synced reads "Chưa khớp ca"; the next sync matches it.

**Mở lại để đếm lại**, below the table, lets an owner or a manager of that store reopen one count, so that staff count that shift again. Choose the count, press **Mở lại**, then **Mở lại số đếm** to confirm (or **Quay lại**). Who reopened it and when is recorded.

### Sự cố & bàn giao (incidents and handovers)

**Sự cố, hết hàng và bàn giao ca** lists what staff reported: **Sự cố** (incidents), **Hết hàng** (items that ran out) and **Bàn giao ca** (handover notes, "Ca 1 → Ca 2: …"), with who reported each, its photos and who saw or handled it. The big number is **Mục chưa xem**, the reports no owner or manager has marked as seen. Narrow the list with **Loại**, **Danh mục** and **Trạng thái** (**Chưa xem**, **Đã xem**, **Đã xử lý**). The text is written by your staff: the page reminds you not to copy it into messages or elsewhere.

- **Cần xem hoặc xử lý** lists what is waiting: **Đánh dấu đã xem** on a report, then **Đã xử lý** once an incident or a missing item is dealt with; a handover note only needs to be seen. Only an owner or manager of the store can do this, and never on a report they wrote themselves.
- **Xem ảnh (…)** shows a report's photos, loaded only when you ask; **Ẩn ảnh** hides them again.

## Khách hàng thân thiết (Loyalty programme)

Your customers join your loyalty programme in a Zalo Mini App, collect stamps (**dấu**) and points (**điểm**) on their purchases, and exchange them for rewards (**ưu đãi**) at the till. On the web you set up the programme and its rewards on Cài đặt → **Khách hàng thân thiết**, follow the members on the **Khách hàng** pages, and see the cost of the rewards on Khuyến mãi & giảm giá. All of it, with the customers' Mini App and the staff app's loyalty screens, was built on 2026-11-19 and tried on a test business with made-up customers. No real customer can join yet: the launch waits for your decisions (whether the programme must be notified to the Sở Công Thương, the programme's values, the staff phone list and the legal reading of the texts), your Zalo accounts, the reward setup on the POS and a trial at the till. This section has no screenshots yet.

**How a purchase reaches a member.** The cashier rings up the sale on the POS as usual. After each sync, the app matches the invoice to a member in one of four ways, which the ledger shows as **Cách khớp**:

| Cách khớp | How |
|---|---|
| **A · Số điện thoại trên hóa đơn** | the cashier entered the member's phone on the POS invoice |
| **B · Mã check-in** | staff recorded the member at the till in the staff app ("Ghi nhận khách"), by the member's 6-digit code or phone, shortly before or after the sale (2 minutes before to 15 minutes after by default) |
| **C · Khách gửi hóa đơn** | the member sent the bill number, amount and date from the Mini App, within the claim window (72 hours by default) |
| **D · Mã quà trên hóa đơn** | the invoice carries the code of a reward the member exchanged |

An invoice earns once, within the programme's limits (invoices per phone per day, excluded order sources; a bill under the stamp minimum earns points but no stamp), and a staff phone never earns. When a check-in or a sent bill fits two invoices, the app does not choose: the case waits in the [Hàng chờ đối soát](#khách-hàng-members-ledger-queue-and-shift-activity) for you. A voided or edited invoice later takes its stamps and points back ("Thu hồi").

### Cài đặt → Khách hàng thân thiết: Chương trình

The page has two tabs, **Chương trình** (the programme, `?tab=chuong-trinh`, the first) and **Ưu đãi** (the rewards, `?tab=uu-dai`). Every member can open it; only an owner or a manager who sees every store can change it. A manager of some stores reads "Bạn quản lý một số cửa hàng nên chỉ xem được chương trình…", other roles "Bạn chỉ xem được chương trình…". A change applies from the next stamp or point earned.

- **Creating it.** **Tạo chương trình** opens an empty form with the platform's values filled in; each field's hint says its default ("Mặc định: …"). Only one programme runs at a time: **Tạo chương trình mới** appears once every earlier programme has ended, and "Đã có một chương trình khác đang chạy…" means you must pause or end the running one first. With several programmes, **Chương trình đang xem** chooses which one to read.
- **Thông tin chương trình**: **Tên chương trình** (1 to 120 characters, shown to customers), **Ngân sách quà tặng** (the total value of the rewards you plan, used for the notification threshold), **Ngày bắt đầu** and **Ngày kết thúc** (empty when open-ended).
- **Trạng thái**: **Bản nháp** (nothing is earned), **Đang chạy** (synced invoices earn), **Tạm dừng** and **Đã kết thúc** (earning stops).
- **Tích dấu**: **Số dấu đầy một thẻ** (8 by default), **Hóa đơn tối thiểu để có dấu** (50.000 ₫; a smaller bill earns only points), **Dấu tặng khi tham gia** (2; fewer than a full card, and never to a staff phone) and **Hạn của mỗi dấu** (6 months).
- **Tích điểm**: **Số tiền cho mỗi lần cộng điểm** (10.000 ₫ after discounts) and **Điểm cho mỗi khoản tiền** (1; 0 switches points off, leaving stamps only), with **Hạn của điểm** (12 months; the oldest points expire first).
- **Giới hạn chống gian lận**: invoices that earn per phone per day (3), receipts a member may send per day (3), and **Nguồn đơn không tích điểm**, one POS order source per line (such as orders from a delivery app), at most 50.
- **Mã check-in và gửi hóa đơn**: how many minutes before and after a check-in an invoice still matches (2 and 15), how long a member code is valid (120 seconds), how long a check-in waits for its invoice (24 hours) and how long after a purchase a member may send the bill (72 hours).
- **Giá trị điểm và dự phòng**: **Giá trị một điểm** (500 ₫) and **Tỷ lệ điểm dự kiến không dùng** (20 %, 0 to 90 %), used to value the points given out and the points still owed.

Each field is checked before anything is sent and again by the database; a value the database refuses shows its message next to the field. Press **Lưu** on the save bar.

**The launch hold.** A promotion programme must be notified to the Sở Công Thương at least 3 working days before it starts, unless its rewards are worth less than 100 million đồng in total. Under **Quyết định thông báo Sở Công Thương**, record your **Quyết định**:

| Quyết định | Meaning |
|---|---|
| **Chưa quyết định** | the programme is held and cannot run (the starting point) |
| **Đã thông báo Sở Công Thương** | you sent the notification before launch; write the date it was sent |
| **Dưới ngưỡng thông báo** | the rewards are worth less than 100 million đồng in total, so no notification is needed |
| **Không phải thông báo** | another legal basis applies; **Căn cứ** is then required |

**Ngày quyết định** is the day you sent the notification or recorded the decision (the day you save, when left empty). While the decision is **Chưa quyết định**, the page says "Đang giữ chưa ra mắt…" and choosing **Đang chạy** saves nothing: "Chưa thể chuyển sang Đang chạy khi quyết định thông báo còn chờ. Ghi quyết định trước; chưa có gì được lưu." Once a decision is recorded the line reads "Đã ghi quyết định thông báo; chương trình có thể chuyển sang Đang chạy." A link leads to the texts on Cài đặt → Pháp lý. The app records your decision; it does not decide for you.

**Số điện thoại nhân viên.** Below the programme, owners and managers see the list of staff phones whose invoices and sent bills never earn. Phones are always shown hidden, with their last three digits only. An owner or manager who sees every store adds a number (a mobile number such as `0900000123`) with an optional **Ghi chú** such as the person's position (at most 100 characters, never their name) and presses **Thêm số**, or removes one with **Xóa**. A phone that a person on the staff roster (Cài đặt → Nhân viên) linked in the staff app never earns either while they are active, whether or not it is on this list. Other members do not see the list.

At the foot of the tab, "Xem thành viên, sổ điểm và hàng chờ đối soát" opens the [Khách hàng](#khách-hàng-members-ledger-queue-and-shift-activity) pages.

In the demo the tab shows a sample programme, read-only.

### Ưu đãi (rewards)

The **Ưu đãi** tab (`#/cai-dat/khach-hang-than-thiet?tab=uu-dai`) is the reward catalogue: what a member can get for their stamps or points. It needs a programme first ("Chưa có chương trình khách hàng thân thiết…"). **Thêm ưu đãi** opens the form; each reward in the list shows its status and its cost in stamps or points.

- **Ưu đãi**: **Tên ưu đãi** (shown to customers), **Mã ưu đãi** (lower-case letters without accents, digits and hyphens, at most 64 characters; it ties the reward to its discount on the POS), the programme and an optional **Mô tả**.
- **Loại phần thưởng**: **Tặng món** (a free item: choose at least one **Món được tặng**), **Giảm theo phần trăm** (on the whole bill, or on the **Món được áp dụng** you choose), **Giảm một số tiền** (from a minimum bill) or **Lên size hoặc thêm topping**. There is no cash, top-up or prepaid-wallet kind. **Món không áp dụng** lists items the reward never discounts.
- **The 50 % cap.** A percentage may take at most the cap of the promotion rules off the price ("Tối đa … giá được giảm", with the circular named), the same 50 % as Khuyến mãi's **Mức giảm tối đa** card; an amount at most that share of the **Hóa đơn tối thiểu**, which is therefore required for **Giảm một số tiền**. The form checks this before saving and the database checks it again; a reward over the cap is not saved. A free item and an upgrade are gifts, not price cuts, so the cap does not apply to them.
- **Giá đổi**: **Số dấu**, **Số điểm** or both (at least one above 0), and **Hóa đơn tối thiểu** (0 when not needed).
- **Thời hạn**: **Áp dụng từ ngày** and **Áp dụng đến ngày** (empty for at once and for no end), **Hạn dùng sau khi đổi** (30 days by default), **Thời gian giữ mã** (24 hours by default: a code not used in that time gives the stamps and points back) and **Số lần mỗi khách** (empty for no limit).
- **Cửa hàng áp dụng**: **Mọi cửa hàng đang mở** or the stores you choose.
- **Số ngày giảm giá năm …** shows, for information only, how many days this year the reward's items were already sold at a discount; it never blocks a save.

**From draft to the till.** A new reward is a **Bản nháp**. Only an owner who sees every store approves it (**Duyệt**); it then reads **Đã duyệt** with who approved it and when. **Kích hoạt** makes it **Đang áp dụng**, so members can exchange it; **Tạm ngưng** puts it back to Đã duyệt. Activation needs every chosen store to be ready: the page shows, per store, the way rewards reach its till (**Chiết khấu thanh toán trên POS**, **Mã từ kho mã CRM** or **Mã kiểm tra qua CRM**) and what the reward is tied to there ("Chiết khấu: …", "Món 0 đồng: …"), and names the stores that are not ready ("Chưa có kênh ưu đãi", "Chưa gắn với chiết khấu trên POS"). There is no page to set up a store's channel yet; it is set up for the till trials.

- When a manager changes the terms of an approved or active reward, it goes back to Bản nháp and waits for the owner again ("Bạn đang đổi điều kiện của một ưu đãi đã duyệt…"). When the owner changes them, the reward is approved again on the new terms.
- **Ngừng hẳn** retires a reward for good, after a question ("Ngừng hẳn ưu đãi này? Khách sẽ không đổi được nữa và không thể mở lại."): **Ngừng hẳn ưu đãi** confirms, **Giữ lại** keeps it. A retired reward cannot be reopened; create a new one instead.
- Owners and managers who see every store write drafts; other members read the catalogue with the reason.
- In the demo the tab shows a sample catalogue, read-only.

**At the till.** A member chooses a reward in the Mini App and gets a single-use code with its QR in their voucher wallet. Staff check the code in the staff app, which says what to do (the POS discount to choose, or the code to type) or why it cannot be used (already used, expired, another store). The synced invoice then marks it used; a code not used within the hold time gives the stamps and points back. **Ưu đãi thành viên đã đổi** on [Khuyến mãi & giảm giá](#khuyến-mãi--giảm-giá-promotions-and-discounts) adds up the exchanges and their cost.

### Khách hàng (members, ledger, queue and shift activity)

The Khách hàng pages show your members and their stamps and points. They have no item in the navigation yet: open them with "Xem thành viên, sổ điểm và hàng chờ đối soát" on Cài đặt → Khách hàng thân thiết, or add `#/khach-hang` after the app's address. Owners, managers and viewers can open them; anyone else reads "Trang này chỉ dành cho chủ, quản lý và người xem số liệu." The demo has no members and says so. Phones are always hidden ("••• •••" and the last three digits).

- **Thành viên** (`#/khach-hang/thanh-vien`) lists the members, newest first, 100 at a time (**Xem thêm** loads more), with the hidden phone, **Ngày tham gia**, **Trạng thái** (**Đang hoạt động**, **Tạm khóa**, **Đã đóng**), **Dấu**, **Điểm**, **Chờ xác nhận** and **Lần ghé gần nhất**, and "Tải CSV". A manager of some stores sees the stamps and points earned in those stores only, which can be less than the member's real balance. **Tra cứu theo số điện thoại** finds a member by their phone and opens their ledger; for an owner the result shows the whole number, to check with the customer, and the number never goes into the page's address. A place is kept at the top for the customer metric cards that come later.
- **A member's ledger** (**Sổ điểm**, opened from the list) shows their stamps, points, what is still waiting for confirmation and their last visit, then one line for every stamp or point added or taken away: **Tích**, **Xác nhận**, **Thu hồi**, **Đổi quà**, **Điều chỉnh**, **Hết hạn**, with the amounts, the value, **Cách khớp**, the invoice ("Số … · …"), the store, the reason and the state (**Chờ xác nhận**, **Đã xác nhận**, **Đã thu hồi**). A mistake is corrected by a new line; the old one stays.
- **Hàng chờ đối soát** (`#/khach-hang/doi-soat`) holds the cases the app would not decide alone: a check-in or a sent bill that fits two or more invoices ("Hai hóa đơn gần như nhau", "Trùng số hóa đơn và số tiền"). Each case shows the store, the time, the member, what was recorded and the invoices that fit. Choose the right invoice and press **Tích cho hóa đơn đã chọn**, or **Bỏ qua**; either way write the reason (**Lý do xử lý**, at most 200 characters, for example that the customer showed a paper bill). **Đã xử lý gần đây** lists the cases decided lately. Only owners and managers see the queue; viewers read "Chỉ chủ và quản lý cửa hàng xem và xử lý hàng chờ đối soát."
- **Bất thường theo ca** (`#/khach-hang/bat-thuong`) counts, for each shift ("Ca 1", "Ca 2"…) of the stores chosen in the top bar, the earns (**Lượt tích**), the refusals by reason (such as **Số điện thoại nhân viên**, **Vượt số hóa đơn mỗi ngày** or **Hóa đơn đã được tích**), the manual adjustments and the check-ins that matched no invoice. The shifts with something to look at (**Tín hiệu cần xem**) come first; a bill below the stamp minimum is not counted as one. The days are chosen as on Vận hành (the last 7 days at first, at most 92, up to today), with "Tải CSV".

Staff record customers, check reward codes, look up a member's card and ask for adjustments in the staff app; managers decide those requests there too. The web pages read what they did.

## Xuất dữ liệu (Exports)

This page has two tabs. **Gói dữ liệu cho AI** (AI data pack) builds one file of your stores' summary figures for your own AI assistant to write a business plan from; the next section explains it. **Xuất dữ liệu** (Export data) takes your sales data out of the app as files: the invoices, their lines, the payments, the shifts and the daily summary, month by month, in one ZIP file. Every exported file is checked against the database before you download it, so what you open in Excel or a script is exactly what the app holds. Both tabs were built on 2026-11-18; the exports were also checked on real data that day, and the owner's check in Excel is still to come. [exports.md](exports.md) describes the files and the check in full, [strategy.md](strategy.md) the data pack.

- **Opening it.** The page has no item in the navigation yet. Add `#/xuat-du-lieu` after the app's address, for example `http://localhost:5173/#/xuat-du-lieu` on the local app: it opens on **Gói dữ liệu cho AI**. `#/xuat-du-lieu?tab=xuat` opens **Xuất dữ liệu** directly.
- **Who can use it.** Owners and managers. Staff and viewers read "Chỉ chủ quán và quản lý xuất được dữ liệu." Every pack and every file holds only figures and rows you can already see in the app.
- **In the demo** the pack tab builds a sample pack from the demo's numbers, and the export tab says "Bản demo không có dữ liệu hóa đơn thật để xuất." and links to the pack tab. This section has no screenshots yet.

### Gói dữ liệu cho AI (AI data pack)

The data pack is one file of summary figures for the stores you choose: weekly and monthly totals, the busy and quiet hours, the best-selling items, categories and sizes, items bought together, sugar and ice choices, the payment and discount mix, shifts by time of day, this month's pace, the coming holidays, and the KPIs of the last four weeks with their comparisons. It holds no invoice, no customer or staff name and no phone number. It also carries the instructions (the prompt) that ask an AI assistant to write a business plan from it in a fixed form, with every number it takes from the pack marked with where it came from, so the app can check the plan later. The app sends the pack nowhere: you download or copy it and give it to the assistant you use yourself.

| Field | What to do |
|---|---|
| **Cửa hàng** | The stores chosen in the top bar, at most ten. To change them, choose again in the top bar. |
| **Dữ liệu đến hết ngày** | The last day of figures in the pack. The last day with complete figures is chosen at first; an earlier day is allowed, a later one is not. |
| **Kỳ kế hoạch** | How far ahead the plan looks: 30 ngày, 90 ngày (chosen at first), 6 tháng or 12 tháng. |
| **Trọng tâm** | Optional, up to 280 characters: what the plan should put first. The four suggestions under it, such as "Tăng giá trị trung bình mỗi hóa đơn", fill it with one tap. |
| **Ghi chú của chủ quán** | Optional, up to 1,000 characters: what the figures do not show, such as a renovation or new opening hours. This phone or computer remembers the note for your business. Do not write people's names or phone numbers: a focus or note that holds an e-mail address, a phone number or a long run of digits is refused. |
| **Ngôn ngữ kế hoạch** | The language the plan is to be written in, Tiếng Việt or Tiếng Anh; the app's language at first. |

1. Press **Tạo gói**. "Đang tạo gói 12/38" counts the figures read so far; **Dừng** stops at once, and no file is made.
2. "Gói dữ liệu đã sẵn sàng" then shows the pack's size ("khoảng … / 30.000 token": the assistant's measure of text, and the pack always stays within 30,000), its id (**Mã gói**), the stores, the last day, the plan period and language, and the tables with their rows. If the pack had to be shortened to fit, a line lists what was left out, for example "bỏ bảng số hóa đơn theo giờ".
3. If the pack cannot be built, a message says why and what to do, with an error code and **Thử lại**: choose fewer stores when the pack is too large, wait about a minute when a sync was running ("Số liệu thay đổi trong lúc tạo gói…"), or fix on the POS an item name that looks like a phone number.

**Dữ liệu còn thiếu** (Missing data) lists what the plan would be better with, the most important first, each with its impact ("Mức ảnh hưởng: cao", "vừa" or "thấp"). Where you can fill a gap yourself, its line links to the settings page for it: opening hours and seat counts on Cài đặt › Cửa hàng, item-type roles on Cài đặt › Phân loại, item costs, payment fees and the monthly target on Cài đặt › Dữ liệu nhập tay. The other gaps only say how things stand: a new store with fewer than 28 days of figures, less than a year of history (so no comparison with last year), days not yet matched with the POS, figures still being refreshed, and what the app does not record yet, such as customers and staff hours. The pack tells the assistant about every gap, so the plan can allow for it; fill in what you can and build the pack again for a closer plan. "Gói không thiếu dữ liệu đầu vào nào." means nothing is missing.

Taking the pack to your assistant, in the three steps the page lists:

1. **Tải gói dữ liệu cho AI** downloads the file `goi-du-lieu_<day>_<stores>_<8 characters>.json`. Or press **Sao chép gói + prompt** to copy the instructions and the pack as one text ("Đã sao chép lời nhắc và gói dữ liệu…"). On a phone that can share files, **Chia sẻ** sends the file to another app.
2. Open your AI assistant. Attach the file with its paperclip or + button and send it, or paste the copied text into the chat and send it. The file already holds the instructions, so nothing else needs to be typed.
3. When the assistant has written the plan (ten sections, five to seven initiatives, KPIs with targets), copy its whole answer and paste it into **Dán kế hoạch** (`#/ke-hoach/dan`), then press **Kiểm tra**. The plan is checked on your phone or computer against the pack it names at its top: the app finds that pack among the packs kept here, or asks you to attach the pack file you downloaded. It lists every problem with its line, so you can send the list back to the assistant and paste its corrected answer. **Lưu kế hoạch** comes in a later step of the roadmap.

- **When copying is not allowed.** Some browsers refuse to copy on their own. A box "Sao chép thủ công" then opens with the text already selected: on a computer press Ctrl+C (or ⌘+C), on a phone hold your finger on the text and choose Copy. **Tải văn bản này** downloads the same text as a file instead.
- **https or this computer only.** The browser builds a pack only when the app is opened over https, or on the computer that runs it (`localhost`). Elsewhere the tab says "Trình duyệt chỉ tạo được gói dữ liệu khi ứng dụng mở qua https hoặc trên chính máy này (localhost)."
- **On this phone or computer.** The app keeps your last five packs here for up to 14 days, so that a plan pasted back can be checked against its pack, and removes them when you sign out. The owner's note stays until you empty it.
- **In the demo** the summary says "Nguồn số liệu: dữ liệu mẫu của bản demo" and "Gói mẫu chỉ để thử trợ lý: kế hoạch viết từ gói này không lưu được.": a sample pack is for trying out an assistant, and a plan written from it is never saved.
- Whoever runs the system can build the same pack on their computer with `fnb datapack` ([strategy.md](strategy.md#8-building-and-checking-a-pack-from-the-command-line)).

### Choosing what to export

| Field | What to do |
|---|---|
| **Cửa hàng** | The stores chosen in the top bar are ticked; tick or untick others. |
| **Từ tháng**, **Đến tháng** | The first and the last month, from the month your stores' history starts to the current month; the last complete month is chosen at first. At most 12 months at a time ("Tối đa 12 tháng mỗi lần xuất"). The running month holds figures up to the day the hint under the months names, the same last day as the reports. |
| **Bảng dữ liệu** | All five are ticked: Hóa đơn (invoices), Dòng hóa đơn (invoice lines), Thanh toán (payments), Ca (shifts) and Tổng hợp ngày (daily summary: each day's totals for the chosen stores together and for each store, as the reports compute them). |
| **Định dạng tệp** | **CSV** in this device's format (commas, or semicolons with a decimal comma; the link next to it leads to Cài đặt › Ngưỡng báo cáo, where **Thiết bị này** changes it), or **JSON**, which keeps every code exactly as the database holds it. |
| **Kèm thông tin cá nhân** | Unticked. See the next section. |

1. Press **Ước tính** to see the rows of each month and store and the estimated transfer ("Ước tính khoảng … MB dữ liệu truyền tải (gói Free: 5 GB mỗi tháng)"). A line also says how much this phone or computer has already exported this month.
2. Press **Xuất dữ liệu**. Above 100 MB the page asks "Lần xuất này ước tính hơn 100 MB. Vẫn xuất?": **Vẫn xuất** goes on, **Thôi** goes back.
3. The progress names each month, store and table with the rows read so far ("Tháng 10/2026 · S1 · Dòng hóa đơn 6.000/8.914"). **Dừng** stops at once, and no file is made.
4. At the end, **Tải fnb-xuat-du-lieu_….zip** downloads the archive, with one line for each month and store:
   - "Đã đối chiếu với cơ sở dữ liệu: … — khớp": its files equal the database.
   - "Dữ liệu thay đổi trong lúc xuất; thử lại sau ít phút": a sync wrote new sales while that month was being read. Its files are in the archive but not checked; export that month again a few minutes later.
   - "… — không khớp với cơ sở dữ liệu; hãy báo lỗi này": this should never happen; tell whoever runs the system.
   - "Tổng hợp ngày khớp hóa đơn", or "Tổng hợp ngày chưa khớp, cần làm mới số liệu phân tích" when the daily totals have not caught up with the latest sales yet; the other files stay checked.

   "Đã nhận … MB (chưa nén)" says how much data the export transferred, counted generously, so the real figure is at most that. **Xuất lần khác** starts again.

### The personal-data box

**Kèm thông tin cá nhân** (Include personal data) adds the columns that name or reach a person: customers' names and phone numbers, the names of employees and cashiers, the shift name (on real data the till can put a cashier's login e-mail there), voucher codes, notes on lines and payment references. Without it these columns are not even read from the database.

- Only an owner, or a manager who sees every store, is offered the box. A manager limited to some stores never sees it.
- It starts unticked every time and applies to that one export only.
- Tick it only when you need those columns, and keep such an archive private: `doc-truoc.txt` and `manifest.json` then say that the files hold personal data.

### What the archive holds

- `doc-truoc.txt` ("read first"): in Vietnamese, what each column means, the CSV format used, how to open the files in Excel, one check line for each month and store, and how much data was transferred.
- `manifest.json`: every file with its rows, its size and its fingerprints, and whether it was checked; for scripts and for checking the archive later.
- A folder per month (`2026-10/`) with the daily summary `tong-hop-ngay.csv` and a folder per store (`S1/`, `S2/`…) holding `hoa-don`, `dong-hoa-don`, `thanh-toan` and `ca`. Paths name the stores by their labels S1, S2…; inside, the files give each store's name.

Column headings are the database's own column names (`business_date`, `net_amount`…), so scripts can rely on them, and `doc-truoc.txt` explains each one. Times appear twice where it helps: as stored, and in the store's local time (`sold_at_local`, written `YYYY-MM-DD HH:MM:SS`), which Excel reads as a date and time.

### Opening the files in Excel

- Double-click a CSV file: the Vietnamese letters show correctly. If every value lands in one column, choose the semicolon format under Cài đặt › Ngưỡng báo cáo › Thiết bị này and export again.
- Excel turns a column of digits into numbers and drops leading zeros, so a receipt number such as `0012` loses its zeros when the file is double-clicked. To keep them, open the file with **Data › From Text/CSV**, choose **Transform Data** and set `receipt_no` and the code columns (`id`, the `…external_id` columns and the `…_code` columns) to **Text** before loading, or choose "Do not detect data types". In Excel for Microsoft 365 or Excel 2024, File › Options › Data › Automatic Data Conversion can also switch off the removal of leading zeros.
- The JSON files keep every code exactly and suit a script better than Excel.

## Data freshness and the verified badge

- **The freshness badge** in the top bar shows when the last sync for your business succeeded: "cập nhật lúc {time}" today, "cập nhật lúc {time} ngày {date}" on an earlier day, "chưa đồng bộ" if no sync has succeeded yet, and "chưa rõ lúc cập nhật" if the app could not read it. It checks again every 5 minutes. A sale rung up after that time appears after the next sync.
- **The verified badge** on each Hôm nay section reads "đã đối soát" (reconciled) when every selected store's day has been checked against the POS's own daily totals and matched: the same number of invoices, and net revenue within the larger of 1,000 ₫ and 0.05 %. Otherwise it reads "chưa đối soát" (not reconciled): the day has not been checked yet, or it did not match.
- **On report cards**, "chưa đối soát" means that at least one selected store has a day in the period without a matched check. "đang cập nhật" means the item, payment or shift summaries of a recent day are still catching up with the latest sales. "tạm tính" means an input the metric needs is missing, such as item costs or seat counts.
- **After a change to a mapping** (an item type's role, an item's category, a payment kind or a fee rate), the numbers that depend on it are recalculated day by day, newest first. The roles, item categories and payment kinds on Cài đặt → Phân loại and the fee rates on Cài đặt → Dữ liệu nhập tay are the changes you can make yourself. Until every past day is done, each thematic report and settings page shows a line saying when the change was made and how many days are left ("Số liệu đang cập nhật theo thay đổi cài đặt lúc … ngày …: còn … ngày."), and the cards that depend on the change carry "đang cập nhật" while their range still holds one of those days. An owner or a manager can press **Cập nhật ngay** on that line: the app then works through the days, at most 92 at a time, and keeps going while you move between pages; it says "Đã cập nhật xong số liệu theo thay đổi cài đặt." when it is done, or why it stopped ("Thử lại" carries on). Other members see the line with "Chủ hoặc quản lý có thể cập nhật ngay." and no button, and their numbers follow as soon as the days are done. The demo recalculates at once, so it never shows the line.
- A past day that stays "chưa đối soát": tell whoever runs the system. They sync that day again; if it still does not match, they compare it with the POS report.

## The demo

The demo shows the app with sample numbers and no login.

| | Demo | Real app |
|---|---|---|
| Login | none | e-mail and password |
| Banner | "Bản demo: đây là số liệu mẫu, không phải của một cửa hàng thật." on every screen, in Vietnamese and English | none |
| Stores | "Cửa hàng mẫu 1", open since 2 December 2024, with monthly targets, and "Cửa hàng mẫu 2", a young store that opened about two months before the current month | your stores |
| Numbers | generated in your browser from a fixed seed and anchored to today in Vietnam time, so they move with the calendar; nothing is sent over the network | your POS sales |
| Badges | "dữ liệu mẫu" (sample data) | freshness time; "đã đối soát" or "chưa đối soát" |
| Reports | the same screens and the same calculations: a copy of the database functions that tests keep equal to them | computed in the database |

- The young store shows the states a new store goes through: no data from last year, a baseline still building, and the "Từ ngày khai trương" card.
- The first screen can take a few seconds while the browser generates the sample days.
- The demo has no staff app and no loyalty members. Cài đặt → Checklist, the Vận hành pages, the Khách hàng pages, and the staff-app cards of Ca & két tiền and Chất lượng dữ liệu say so instead of showing figures; Khuyến mãi's **Ưu đãi thành viên đã đổi** says there is no member reward data yet. Cài đặt → Khách hàng thân thiết shows a sample programme and a sample reward catalogue, read-only.
- Before go-live the project's Pages address serves the demo. It is rebuilt from each published version; since 2026-11-13 it includes the four reports.

![The demo banner](user-guide/demo-banner.png)
- After go-live the Pages address serves the real app. "Xem bản demo" on the login page opens the demo for that browser session, and "Thoát bản demo" in the top bar returns to the login page.

## What is coming next

No dates are promised here; [roadmap.md](roadmap.md) holds the plan and [status.md](status.md) the progress. A page that is not built yet looks like this:

![The Kế hoạch page saying Sắp có and naming the roadmap phase that brings it](user-guide/coming-soon.png)

- **The daily digest and alerts** (phase 12; the first part is verified locally, the second is being built). The digest ("Bản tin") is a short message in a Zalo Bot chat or by e-mail, built once every store has closed its day, or at a morning deadline (06:30 by default) if one has not: yesterday's Ngày numbers (net revenue, invoices, average ticket, payments, hours, top items), with a line when something looks off, such as revenue well below the usual level, a falling average ticket, a drawer variance, a day that did not reconcile or a day without sales. Alerts arrive on their own when the sync fails, a POS login stops working, the data goes stale or a scheduled job fails. By default the digest goes to owners and managers and the alerts about the sync and the jobs to the owner. Messages respect each channel's allowed hours. A settings page "Cài đặt → Cảnh báo" with a test button and a Bản tin panel in the app are designed; more channels come later.
  - **Stopping the Zalo Bot messages.** Whoever runs the system links your Zalo chat to the Bot with a one-time code, and you accept by replying "ĐỒNG Ý". To stop, reply "DỪNG" in that chat (or "DUNG"; upper or lower case does not matter). The Bot then confirms once: "Đã dừng: bạn sẽ không nhận bản tin và cảnh báo qua Zalo này nữa. Muốn nhận lại, hãy nhờ chủ cửa hàng tạo mã liên kết mới." Your agreement to receive the messages is withdrawn, the messages still waiting for you are cancelled, and you stop receiving the digest and alerts everywhere, by e-mail too; to receive them again, ask the owner for a new link code. The reply is built and works once the Bot receives its messages through the new webhook (phase 13, not live yet).
- **More settings and manual data** ("Cài đặt", phase 10): Cửa hàng (the store profile, opening hours and seat counts), Dữ liệu nhập tay (item costs, monthly targets and payment fees), Phân loại (item-type roles, item categories and payment kinds), Ngày lễ (your own days off), Ngưỡng báo cáo and Pháp lý (the legal texts) are open (see above). Target progress waits for a monthly target. The links "Gán vai trò món" and "Đặt mục tiêu tháng" on the report cards lead to these settings; until a page exists it says which phase brings it.
- **Saved plans** ("Kế hoạch", phase 11b; the data pack, the plan check of "Dán kế hoạch" and the exports are open, see [Xuất dữ liệu](#xuất-dữ-liệu-exports)): saving a checked plan and keeping it in "Kế hoạch", where its KPIs are followed with live values.
- **The Zalo staff app** (phase 14): the roster, the pairing codes, the staff notice and the home screen are built and tried in a browser ([above](#nhân-viên-và-ứng-dụng-zalo-staff-and-the-zalo-staff-app)), and so is the shift work of phase 14b: checklists with photos, the cash count at close, handover notes and incidents in the app's Ca làm tab, Cài đặt → Checklist and the [Vận hành](#vận-hành-shift-operations) pages on the web. Opening it inside Zalo waits for the owner's Zalo accounts and a check on a real phone, and the shift work waits for a full day's trial at one store.
- **The loyalty programme** (phases 16 to 18): the programme and reward settings, the Khách hàng pages, the reward card on Khuyến mãi, the customers' Mini App and the staff app's loyalty screens are built and tried on a test business ([Khách hàng thân thiết](#khách-hàng-thân-thiết-loyalty-programme)). Launching it waits for your decisions (the notification decision, the programme's values, the staff phones and the legal reading of the texts), your Zalo accounts, the reward setup on the POS and the trials at the till. The customer metric cards, the members' share of invoices per shift on Ca & két tiền, and the pages for customers' consents and personal-data requests come later ([roadmap.md](roadmap.md)).

## Words you will see

| Vietnamese | English in the app | Meaning |
|---|---|---|
| Doanh thu thuần | Net revenue | invoices not voided, after every discount |
| Doanh thu gộp | Gross revenue | the same invoices before discounts |
| Hóa đơn | Invoices | invoices not voided |
| Giá trị trung bình mỗi hóa đơn | Average ticket | net revenue ÷ invoices |
| Mức nền cùng thứ | Same-weekday baseline | median of the same weekday over 8 weeks, holidays and Tết left out |
| Hôm trước, tuần trước, tháng trước, năm trước | The day before, last week, last month, last year | the previous period; while the current one is still running, over the same number of days |
| Cùng cửa hàng ({k}/{n}) | Same stores | the comparison covers only the stores with enough history |
| Điểm % | pts | percentage points |
| Đã đối soát, chưa đối soát | Reconciled, not reconciled | matched, or not yet matched, against the POS daily totals |
| Đang cập nhật | Updating | summaries still catching up with the latest sales |
| Tạm tính | Provisional | an input the metric needs is missing |
| Dữ liệu mẫu | Sample data | the demo |
| Tiền mặt cần đếm | Cash to count | cash taken in the day, before the opening float |
| Chênh lệch két | Variance | drawer count against expected cash |
| Kỳ trước, kỳ sau, chọn ngày | Previous period, next period, pick a date | the period navigator |
| Tải CSV | Download CSV | the table as a file |
| Giải thích chỉ số | About these numbers | the definitions behind a card |
| Sắp có | Coming soon | a page that is not built yet |
| Lưu, Hủy thay đổi | Save, Discard changes | the bar at the foot of a settings page: save the pending changes, or go back to the saved values |
| Khôi phục mặc định | Restore defaults | put a settings page back to the platform's default values; nothing changes until you press Lưu |
| Nghỉ cả ngày | Closed all day | a weekday without opening hours |
| Ngưỡng báo cáo | Report thresholds | the settings page for what the reports flag |
| Mặc định | Default | the platform's value, used until the business saves its own |
| Thiết bị này | This device | a choice kept on this phone or computer only |
| Vai trò nhóm món, Chưa gán | Item-type role, Not assigned | the part an item type plays in the reports (Đồ uống, Đồ ăn, Đồ ăn nhẹ, Topping, Khác), or none yet |
| Gợi ý | Suggested | a role the app reads from an item type's name; saved only when you press Lưu |
| Cập nhật ngay | Refresh now | recalculate the days still waiting after a mapping change |
| Giá vốn, Áp dụng từ ngày | Item cost, Applies from | what one item sold costs you, and the first day that cost counts |
| Tất cả cửa hàng, theo Tất cả cửa hàng | All stores, from All stores | a cost shared by every store, and a store using that shared cost because it has none of its own |
| Xuất dữ liệu | Export data | take the sales data out as files, each checked against the database |
| Gói dữ liệu cho AI | AI data pack | one file of summary figures with the instructions for your own AI assistant to write a business plan; no invoice or personal data |
| Lời nhắc (prompt) | Instructions | the text inside the pack that tells the assistant how to write the plan |
| Mã gói | Pack id | the pack's fingerprint: the same figures always give the same id, and a plan names the pack it was written from by it |
| Danh sách nhân viên | Staff roster | the people who may use the Zalo staff app, with their role and stores |
| Chờ ghép nối, Đang hoạt động, Đã ngừng | Waiting to pair, Active, Deactivated | a person's status on the roster |
| Ghép nối, Mã ghép nối | Pairing, Pairing code | linking a person's Zalo account to their card once, with the six-digit code you create for them, valid 10 minutes |
| Thông báo cho nhân viên | Staff notice | the text staff read and accept before pairing; published on Cài đặt → Pháp lý |
| Doanh thu nhân viên được xem | What staff see of revenue | everything for their stores, only today's totals, or nothing |
| Checklist mở ca, giữa ca, đóng ca | Opening, mid-shift and closing checklist | the list of tasks staff tick off in the staff app; edited on Cài đặt → Checklist |
| Xong, Xong muộn, Bị bỏ | Done, Done late, Missed | a checklist finished before its deadline, after it, or never |
| Số đếm két, Chênh lệch đếm | Cash count, Count difference | the cash staff counted at shift close in the app, and that count minus the expected cash |
| Mục chưa xem | Unseen items | incidents, missing items and handover notes no owner or manager has marked as seen |
| Dấu, Điểm | Stamps, Points | what a member collects on a purchase: one stamp per bill from the minimum, points per amount spent |
| Ưu đãi | Reward | what a member gets for their stamps or points: a free item, a percentage or an amount off, or an upgrade |
| Kênh ưu đãi | Reward channel | how a reward reaches a store's till: a POS payment discount or a CRM voucher code |
| Cách khớp A, B, C, D | Matched by A, B, C, D | how an invoice was tied to a member: phone on the invoice, check-in by staff, a bill the member sent, a reward code on the invoice |
| Sổ điểm | Ledger | every stamp and point a member got or gave back, one line each; a mistake is corrected by a new line |
| Hàng chờ đối soát | Reconciliation queue | the cases the app would not match alone, waiting for an owner or manager |
| Đang giữ chưa ra mắt | Launch hold | the programme cannot run until the notification decision is recorded |

| Kèm thông tin cá nhân | Include personal data | add the columns that name or reach a person to one export |
| Đã đối chiếu với cơ sở dữ liệu: … — khớp | Checked against the database: … — matched | an exported month's files equal the database |
