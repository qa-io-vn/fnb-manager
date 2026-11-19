# iPOS loyalty integration design: connecting points and coupons to real purchases

Research date 2026-11-07; findings, integration plan and hotline questions added 2026-11-19. Decisions in ADR-016.

## Purpose

This document explains how a stamp, point or coupon in our ledger is tied to an invoice really paid at a Fabi till. It covers:

- four ways to do this, the chosen hybrid and its no-contract fallback;
- the identity model, the earning paths and the coupon rails;
- the anti-fraud controls, the decision gate and the per-shop configuration that keeps the design portable;
- since 2026-11-19, an offline audit of the real POS payloads, the public-documentation findings, a ranked integration plan and the questions for the iPOS hotline.

## What is verified

Markers: [high] primary source; [medium] old or indirect; [low] inference.

### Identity at the till

- Fabi has no public write API and no documented way to attach a customer or credit points from outside (huongdan.ipos.vn, 2026-11-07; re-checked 2026-11-19) [high].
- A cashier attaches a member on the item screen with "Thêm khách hàng" by phone; after printing, the member syncs to iPOS CRM (iPOS help, updated 2021-12-24) [high].
- Two flows are documented only for the discontinued POS PC ("Hội viên" → token): the check-in-code variant (a "mã tích điểm" from the OA chat, entered in the Hội viên token field), and the automatic credit on the paid amount after printing. Both are on 2020–2021 pages [medium].
- Fabi CMS 3.1.9 offers "Không checkin bằng SĐT" (check-in by a digit string or name) and multi-voucher per order. The invoice option "Bảo mật thông tin khách hàng" masks the phone on the printed bill (CMS manual, 2026-11-07) [high]. The FABi feature table lists the same group as rows 2.1.13 and 2.2.18 (2025-03-28) [high]. Whether posapi masks the phone is unknown [low].

### Coupons at the till

- Entering a CRM e-voucher code flips it to "Đã sử dụng" immediately, even before printing; the code is bound to one table; a voucher with a named recipient attaches that member and earns points (iPOS help, updated 2024-06-10) [high].
- Correction to "locks the order": a 2021 troubleshooting page says items cannot change while a voucher is applied; removing it to edit burns a single-use code. A code can therefore read "Đã sử dụng" yet appear on no final invoice [high].
- iPOS documents a restaurant-hosted voucher-validation callback. On a multi-use programme the POS posts Pos_Parent, Pos_Id, Coupon_Code, Membership_Id, Sale_Tran_Id and the order lines, and expects Discount_Amount back (updated 2024-06-10). No authentication, timeout or reversal hook is documented [high].
- E-voucher programmes export unique single-use codes to Excel, at most 1,000 per run (2024-06-10) [high]. Without CRM, Fabi CMS 5.5 "Chiết khấu thanh toán" gives whole-bill discounts selectable at payment (2026-11-07) [high].

### Identity on the Zalo side

- The Mini App phone permission returns a single-use token valid 2 minutes, exchanged server-side with the app secret. The request must follow a user action with a stated purpose (Zalo docs, updated 2026-11-05) [high].
- Zalo user ids differ per Zalo App and per OA, so the phone is the only cross-brand key [high].

### Market reference

- Highlands: 1 DRIP per 10,000 ₫ paid, a free drink per 9 stamps on bills of at least 50,000 ₫, 12-month expiry, one account per phone and device, clawback on refunds (policy updated 2026-08-24) [high].
- No loyalty SaaS vendor documents a Fabi link that moves points or vouchers (2026-11-07; re-checked 2026-11-19) [medium].

## Findings 2026-11-19

### Offline field audit (brand-1, store S1)

Method: the local snapshot of one account was read offline (one brand, one store). It holds 3,538 invoices, 8,196 lines and 3,539 payment rows over 50 business days (2026-09-29 to 2026-11-18), plus the master data. No API call was made. The scripts printed counts and shapes only. Detail per JSON path: `docs/connectors/ipos-fabi.md` ("Loyalty fields") and, privately, `docs/private/ipos/loyalty-fields.md`.

- **Identity: none on any invoice.** Results by field:
  - `customer_phone` and `customer_name` are empty on 3,538 of 3,538 invoices, 8,196 of 8,196 lines and 3,539 of 3,539 payments.
  - `customer_id` (payments only) is empty on all 3,539.
  - The e-invoice buyer fields, including the buyer phone `sdtnmua`, are empty on every line.
  - No membership id, member code, points or check-in field exists anywhere in the sale, line or payment payloads.
  - Path A can only ever read `customer_phone` (or `customer_id`). Whether either fills once a member is attached is still unverified.
- **Check-in strings: no field.** 26 sale notes and 601 item notes exist; none contains a run of four or more digits. Cashiers do not type phones or codes anywhere.
- **CRM footprint.**
  - The sources master holds `CRM`, `ZALO` and `FACEBOOK` (3 of 7 sources), the sources that connecting iPOS CRM creates. No invoice uses them.
  - All 4 promotions in the master are flagged `partner_auto_gen`.
  - The five member and voucher toggles on the store record are all off (0 of 5): member search, multi-voucher, member vouchers, points-for-voucher and check-in by phone.
  - This agrees with the owner's report that CRM is initialised but idle [medium].
- **Vouchers reach the synced invoice reliably.**
  - 385 invoices (10.9 %) carry a `voucher_code`. There are two distinct 5–6-character codes, reused 374 and 11 times, so they are multi-use codes.
  - Every one of the 385 comes with a promotion line whose promotion is in the master.
  - The discount lands either on the lines (374 invoices) or as `discount_extra_amount` with the promotion's name in `discount_extra_name` (11 invoices); `voucher_amount_paid` is 0 everywhere.
  - Reading [medium]: these are CRM e-voucher programmes whose names are synced into Fabi (FABi feature 3.11), and the programme's "Loại hạch toán" decides where the discount lands.
  - No unique single-use code has been observed yet.
- **Receipt numbers support path C.**
  - `tran_no` is 6 digits: the day of month plus a 4-digit daily sequence that starts at 0001 or near it.
  - It steps by 1 (2 gaps in 3,488 steps) and is unique per store and day (0 repeats); 812 numbers recur on other days.
  - The store record's `reset_tran_no_period` says daily, but the connector does not map it; `stores.tran_no_reset_period` is set by hand.
- **E-invoice: off.** Every e-invoice field on invoices and lines is empty, and the store's e-invoice connector settings are off or empty.
- **POS id.** Every invoice's `pos_id` equals the store's 6-digit `fb_store_id`; this is probably the `Pos_Id` the CRM callback sends [low].

### Public documentation research

Status: **verified** = read on the vendor's own help page on 2026-11-19; **vendor marketing** = product-page claim; **third party** = another company's notes; **unknown** = not found or not reachable. The page date shown is the article's own "Updated on" date.

| Topic | Finding | Status | Source, page date |
|---|---|---|---|
| Validation callback | Request: Pos_Parent, Pos_Id, Coupon_Code, Membership_Id, Sale_Tran_Id, Created_At, Code, Date_Start, Date_End and Voucher_Order_Line[] (Item_Type_Id, Item_Id, Description, Quantity, Amount, Pr_Key, Price_Sale, Discount, Detail_State, Package_Id). Response: the same plus `code`, Discount_Amount, Discount_Description. Configured with "Setup link callback vào chương trình" (screenshot only; the owner reports the field as `callback_url`). Only multi-use programmes are mentioned. HTTP method, authentication, timeout, retry, reversal and the meaning of `Code` (1 in the request, 4 in the response sample) are not stated. The printed response sample is not valid JSON. iPOS builds it for 1,000,000 ₫ per programme | verified; details unknown | huongdan.ipos.vn …/nha-hang-tu-xay-dung-he-thong-kiem-tra-ma-voucher/, 2024-06-10 |
| E-voucher types and export | Purposes: one multi-use code typed by the admin; one-time codes per customer; "XUẤT DANH SÁCH VOUCHER" (at most 1,000 codes per run, repeatable, optional prefix, expiry, list sent to an e-mail address, Excel); points-for-voucher; partner channels through iPOS Hub. Importing the restaurant's own unique codes is not stated. Accounting types: "Phiếu giảm giá / Phiếu thanh toán", "Chiết khấu trên tổng hóa đơn", "Giảm giá trên từng món", "Thay đổi giá món được tặng về 0đ" | verified | …/tao-e-voucher/, …/phat-hanh-e-voucher/, …/phat-hanh-e-voucher-tren-kenh-doi-tac/, all 2024-06-10 |
| Applying a code | "Tổng tiền" → "?" → code → Enter → OK. The code reads "Đã sử dụng" at once, even unprinted. It must be re-entered after edits and cannot move to another table. A named voucher attaches the member, who earns points | verified (the page does not name FABi) | …/ap-dung-ma-voucher/, 2024-06-10 |
| "Thêm khách hàng" on FABi | Phone → OK for a new number → name, birthday, gender → "Thêm"; member data syncs to CRM after printing | verified | …/dang-ky-thanh-vien-tai-may-pos-ban-hang/, 2021-12-24 |
| Points by phone and by check-in code | Credited after printing on the amount paid. The check-in code comes from the brand's OA or Fanpage chat ("Cá nhân" → "Lấy mã tích điểm") and is scanned or typed into the POS PC token field. Code format, validity and whether foreign strings are accepted are not stated | verified for POS PC only; FABi unknown | …/tich-diem-bang-so-dien-thoai/, 2021-12-24; …/thu-thap-hanh-vi-khach-hang/, 2020-08-07 |
| Zalo OA ↔ CRM | The OA is authorised to iPOS's app from the CRM settings. Auto-created OA messages; OA menu commands `#checkin`, `#exchange_point`, `#avairable_voucher`, `#getpoint`, `#booking`, `#orderonline`, `#orderonline_select_pos`, `#getlistpos`; registration by following the OA and sending a form. No Zalo Mini App, and no mapping of Zalo user ids to members, is documented | verified, old | …/ket-noi-zalo/, 2020-08-06; …/dang-ky-thanh-vien-qua-zalo/, 2020-08-06 |
| ZBS through CRM | The brand's own Zalo app (App ID, secret, OA tokens) is entered in CRM. 27 template parameters, including customer_phone, membership_point, tran_id, total_amount, bill_point and voucher_code. Who pays and which events trigger a send are not stated | verified | ZCA guide pages I, II and IV, 2026-02-24 and 2026-04-28 |
| CRM settings and reports | "Không tích điểm cho hóa đơn có nguồn từ" (exclude sources from points). Points rounding. A default member discount policy keyed by tier code. Points-for-voucher only on Zalo and Facebook. "Bảng kê hóa đơn" lists bills with member points or vouchers, including member information, and exports to Excel | verified, old | …/cai-dat-khac/, 2020-08-07; …/tao-voucher-doi-diem/, …/tao-chiet-khau-mac-dinh/, …/bao-cao/bang-ke-hoa-don/, 2020-08-06 |
| FABi features | 1.1.6 "Thanh toán khi khách hàng là hội viên"; 1.1.7 E-Voucher payment; 2.1.13 voucher and member utilities; 2.1.19 cashier discounts; 2.2.3 the receipt can show Voucher Gift, QR code and bank code; 2.2.18 show or hide the customer phone on the bill; 3.11 sync promotion names from CRM; 7.1 connection to iPOS CRM; English 4.1 multiple promotions per bill | verified (feature list) | …/tinh-nang-phan-mem-fabi/, 2025-03-28 |
| Receipt placeholders `{tran_no}`, `{customer_phone}`, `{customer_point}`; "Chiết khấu thanh toán"; "Bảo mật thông tin khách hàng" | Recorded from the Fabi CMS manual and the owner on 2026-11-07. Not re-checked: fabi-docs.ipos.vn refused connections on 2026-11-19. Whether a custom QR with our own URL can be printed is unknown | unknown today | fabi-docs.ipos.vn, unreachable 2026-11-19 |
| Partner or developer API | No developer portal, API reference, webhook list or API product on ipos.vn or the help site; partner access goes through iPOS sales or support | verified (absence) | ipos.vn/en/san-pham/, huongdan.ipos.vn, 2026-11-19 |
| iPOS DW – PARTNERS | Per-brand grant of a token, a brand code (`BRAND-…`, the same form as our login's `brand_id`) and a store code. Invoice webhook to a registered URL: 5 retries 30 s apart; a deleted invoice is resent with `datastate` 2; an edit creates a new `sale_id` with `origin_sale_id`. A `get-sales` pull by update time. Fields seen: sale_id, datastate, brand_id, store_id, date_last/hour_last/minute_last, sale_detail (item_id, quantity); the older Event 11 format has pos_parent, pos_id, tran_id. No customer, member or voucher field seen | third party | github.com/volekhanh123/beeftown-stock/pull/120 and /pull/121, 2026-10-27 |
| Foodbook Hub | After a contract, the brand enters ID Token, Token Value and Call Back URL at partner.foodbook.vn. Orders flow both ways; customers are pushed into iPOS (add, edit) and come back from orders; products flow one way; points and vouchers are not synced | third party | huongdan.cnvloyalty.com …/ket-noi-ipos, undated |
| CRM event webhooks | After an e-mail to iPOS support, iPOS sends a brand's events to a partner URL. Fields used: last store, points of the last order. A toggle syncs CRM promotions | third party | ladipage-vietnam.gitbook.io …/tich-hop-ipos, undated |
| CRM marketing claims | "Tích điểm tự động qua số điện thoại hoặc mã thành viên", "Đăng ký, theo dõi doanh nghiệp trên Zalo OA", vouchers on POS, WebOrder and "kênh đối tác có liên kết". No price; quote by form | vendor marketing | ipos.vn CRM product pages, undated |
| Product line | New POS PC sales stopped from 16/11/2026; all POS PC sales and maintenance stop from 01/01/2027; FoodHub admin moves into the FABi CMS from 25/11/2026. The check-in-code pages describe POS PC | verified | ipos.vn notices, 2026-11-17 |

## Limits and rules

- CRM points accrue only if the member is attached before the bill prints: identification at the till is the binding constraint.
- The callback must protect itself: secret URL path, idempotency on Sale_Tran_Id, amount sanity checks, IP allow-list.
- The synced invoice stream (30-minute incremental, nightly 14-day re-pull) is the only authoritative purchase record. Every ledger row references an invoice, the ledger is append-only, and a redemption is confirmed only when CRM status and the synced invoice agree.
- CRM's Zalo flows are documented on 2020-era pages; re-test on the shops' Fabi build. Zalo-derived data stays minimal and consented (ADR-019).
- A voucher's value is never read from `voucher_amount_paid`; confirmation keys are `voucher_code`, the line `promotion_*` fields and `discount_extra_name` (audit 2026-11-19).
- Answering G2 needs no extra iPOS API call: one test member attached at the till and the next scheduled sync show whether the phone arrives.

## Costs

| Item | Amount | Unit | Note |
|---|---|---|---|
| iPOS CRM subscription | quote only | per month | the owner reports CRM is already initialised at no charge; the audit agrees (CRM sources present). Price once used: open commercial question |
| Single-use code export | 100 ₫ | per code, at most 1,000 per export | owner-reported; not on any public page |
| Callback built by iPOS | 1,000,000 ₫ | one-off per programme | avoided; we build it |
| iPOS DW partner feed, Foodbook Hub, CRM event webhook | quote only | — | not published |
| ZBS voucher template | 400 ₫ | per delivered message, ex-VAT | since 16/03/2026; the 300 ₫ figure is outdated |
| ZBS other templates | 300 ₫ | per delivered message, ex-VAT | the 200 ₫ figure is outdated |
| OA Tăng trưởng package | 2,500,000 ₫ | per OA per year incl. VAT | required for any Open API use |

## What it means for this project

### Integration plan (ranked by what works, 2026-11-19)

**1. Works today, no owner action (built).**
- **Earning paths.**
  - Path C, receipt claims: bill number and amount within 72 hours, with the store taken from the QR deep link.
  - Path B, staff member codes: the Staff Mini App records the customer's dynamic code, matched to an unclaimed invoice at the store within −2/+15 minutes.
- **What we build.** Nothing new is required. Small improvements, owned by the code agents:
  - the claim form checks that the bill number's first two digits match the chosen day, and proposes the date from them;
  - the connector maps `reset_tran_no_period` into `stores.tran_no_reset_period`.
- **What the owner does.** Nothing; QR standees help.
- **Cost.** 0 ₫, and no iPOS calls beyond the normal sync and the bounded fast lane.
- **Risk.**
  - Earns show "đang chờ xác nhận" for 5–30 minutes.
  - Capture depends on customer effort and staff discipline.
  - Someone could claim another person's receipt; this is limited by the amount match, one claim per invoice, the daily cap and the shift anomaly report.
  - Redemption needs at least the one-time setup in option 2.

**2. With a cashier habit (path A) and a one-time CMS setup.**
- **The habit.** The cashier taps "Thêm khách hàng" and types the phone before printing.
- **Redemption without CRM programmes (Rail 3).** One "Chiết khấu thanh toán" entry per reward; its name lands in `discount_extra_name` → `bill_discount_name`, which is already mapped.
- **What we build.** Nothing for the happy path: path A already reads `invoices.customer_phone`. If the phone arrives masked, it is unusable as a key and the store falls back to paths B and C.
- **What the owner does.**
  - Brief cashiers, run the one-week capture trial and attach one test member at S1.
  - Create one discount entry per reward (minutes, free).
  - Keep the CRM points policy neutral and the OA unconnected to CRM.
- **Cost.** 0 ₫; about 10 seconds of cashier time per bill.
- **Risk.**
  - The phone may never reach posapi (0 of 3,538 so far, with no field for a member id), and the "ẩn hiện số điện thoại" option may mask it.
  - Cashier compliance is 0 % today.
  - The phone also lands in iPOS CRM, so the consent text must name iPOS as a processor.
  - Rail 3 has no POS-side double-use guard; our system prevents reuse.

**3. With the iPOS CRM rails.** CRM appears initialised; this needs programmes, not a new module.
- **Rail 1, code pool.**
  - Build: the pool import into `coupon_codes`. Confirmation needs no connector change, because codes typed at the till already land in `voucher_code` (385 of 385, each with its promotion line).
  - Owner: one "Xuất danh sách voucher" programme per reward, with an accounting type that shows on the bill ("Chiết khấu trên tổng hóa đơn" or "Giảm giá trên từng món"); forward the export e-mail.
  - Cost: about 100 ₫ per code (owner-reported).
  - Risk:
    - a code is burned on entry, or when removed to edit the bill;
    - one voucher per bill while multi-voucher is off;
    - codes must be stocked ahead;
    - a unique code's behaviour in `voucher_code` is not yet observed.
- **Rail 2, validation callback.**
  - Build: the `voucher-callback` Edge Function with a secret path, idempotency on Sale_Tran_Id, amount checks and a fast answer.
  - Owner: one multi-use programme per reward with our link; obtain the egress IPs.
  - Cost: 0 ₫ (iPOS would charge 1,000,000 ₫ per programme).
  - Risk: highest unknowns.
    - If the POS forwards only the programme's own fixed code, our per-customer codes cannot be checked. The callback then adds identity only through Membership_Id, which needs path A.
    - Authentication, timeout, retry, reversal and the meaning of the result `Code` are undocumented.
    - The pages date from the CRM 2.1 era.
    - Upside: the only real-time hook, and the only rail that refuses a second use at the till.
- **Path D, voucher recipient.** Only relevant if CRM messaging is used: low priority.

**4. With partner APIs or webhooks.** No public API exists; three partner channels are known from third parties.
- **iPOS DW – PARTNERS.** A real-time invoice webhook plus a pull.
  - Build: a receiver that triggers the fast-lane sync or maps the payload.
  - Owner: request the grant from iPOS.
  - Cost: quote.
  - Risk: unofficial documentation; no customer or voucher field seen. It speeds up confirmation and cuts posapi calls, but does not solve identity.
- **Foodbook Hub.** It could push our members into iPOS so that "Thêm khách hàng" finds them, but it writes into iPOS (against our "no writing into Fabi" rule), needs a contract and syncs no points or vouchers. Not recommended.
- **CRM event webhooks.** They could report "member earned points at store X" in real time, but only for members attached at the till (option 2). Payload unknown.

**Recommended path.**
1. Run options 1 and 2 now. Earning goes through C and B; the cashier-habit trial and one test member settle the phone question with no extra API calls; Rail 3 entries make the first rewards redeemable at 0 ₫.
2. Call the hotline (questions below).
3. If the code-export fee is acceptable, make Rail 1 the CRM rail for single-use rewards: the audit already proves its confirmation path.
4. Build Rail 2 only after iPOS confirms that customer-specific codes reach the callback, and gives a timeout and egress IPs.
5. Treat the DW webhook as an optional sync accelerator, adopted if free or cheap.

### Four options compared

| Option | iPOS dependency | Cost to iPOS | Verdict |
|---|---|---|---|
| 1. CRM native (CRM points, OA chat commands) | very high | CRM quote; 55 ₫ per CRM-sent Zalo message (2020) | no code, but 2020 chat UX, no read API, locked to iPOS |
| 2. Own ledger on synced data, no CRM | low, read-only posapi | 0 ₫ | portable, but earns wait for the sync, matching is heuristic, coupons procedural |
| 3. Hybrid: our ledger, CRM as the till rail (chosen) | medium, standard subscription | CRM quote | phone on invoice ends heuristics; POS consumes codes; rail swappable |
| 4. Vendor Zalo loyalty SaaS | high if purchases are linked | 6–30 million ₫ per brand per year | no vendor connects points to Fabi; data sits with the vendor |

### The hybrid and its fallback

Supabase is the system of record. If the quote is acceptable, iPOS CRM does only what it uniquely does at the till: it puts a phone or our check-in code on the invoice and consumes coupon codes. Its own points policy is set neutral. If CRM is declined, the same ledger runs on staff-verified check-ins, receipt claims and Fabi discount entries at lower precision.

### Ground truth and identity

The join key is the phone in E.164 form. It comes from the customer's Zalo consent in the Customer Mini App, from the OA request-user-info form, or from the cashier typing it into "Thêm khách hàng". Zalo App and OA user ids are kept per brand for messaging. Staff are Zalo ids with store scope, and their phones never earn.

### Four earning paths, in precision order

Reconciliation runs after every sync and records the matched path.

- **A. Phone on the invoice** (CRM rail): a confirmed earn is written directly. The audit shows `customer_phone` (and, on payments, `customer_id`) is the only field that can carry it.
- **B. Dynamic check-in code**: the Mini App shows a 6-digit code refreshed every 60 seconds, valid 2 minutes, store-aware. The cashier types it as the Fabi check-in string (then path A applies), or staff record it in the Staff Mini App. It is matched to an unclaimed synced invoice at the same store within −2/+15 minutes, closest amount first; two candidates within tolerance go to the manager queue. No posapi field carries a check-in string, so only the staff-recorded variant is proven.
- **C. Receipt claim**: the customer enters bill number and amount within 72 hours. The match is on store (from the QR deep link), bill number and exact amount; one claim per invoice ever, at most 3 per phone per day. It needs no cashier action: the universal fallback. The bill number is unique per store and day (audit 2026-11-19).
- **D. Voucher recipient**: a CRM voucher issued to a named member attaches that member; the code on the invoice confirms the redemption and earns on the remainder.

Latency: B and C earns show as "đang chờ xác nhận". A fast-lane sync lands most confirmations in 5–10 minutes: an Edge Function triggers a workflow run, at most one per 5 minutes per store, pulling the last 60 minutes. The nightly re-pull turns edits and voids into clawbacks, leaving a negative balance where a reward was already redeemed.

### Three coupon rails, selected per store

- **Rail 1, CRM code pool**: one single-use export programme per reward, codes imported into our table. Redemption assigns a code with a countdown and holds the stamps; the invoice carrying the code confirms it. No invoice within 24 hours releases the hold and quarantines the code.
- **Rail 2, CRM validation callback**: a multi-use programme pointing at our Edge Function. We validate ownership and conditions against the posted lines, return the discount, and mark the coupon redeemed idempotently on Sale_Tran_Id. The same id gets the same answer; a different id for a used code gets 0 ₫ with a clear description.
- **Rail 3, Fabi payment discount** (no CRM): one "Chiết khấu thanh toán" entry per reward. Staff verify the code in the Staff Mini App, the cashier applies the discount, and a synced invoice at that store within 15 minutes carrying that name confirms it. Double use is prevented by our system, not the POS.

### Anti-fraud controls

- One earn per invoice; earning on net paid only; a minimum bill for a stamp.
- A daily cap of 3 earning invoices per phone; delivery-channel invoices excluded.
- Receipt claims need bill number, amount and store.
- Staff phones blacklisted and individual cashier logins required.
- Manual adjustments logged, larger ones manager-approved.
- Clawback on voids and edits; shift-level anomaly reports; public terms.

### Deliberately not relied on

- No writing of orders or members into Fabi.
- CRM's points engine is not the ledger.
- The 2020 OA chat commands are not a customer surface.
- Wallet-linked auto-earning (MoMo, ZaloPay) is not used.
- Partner feeds (iPOS DW, Foodbook Hub) are optional accelerators.
- Mini App ordering is out of scope.

### Decision gate after the phone-capture week

Gate G2 closes phase 16a. CRM is the rail if the CRM quote is acceptable and a test member attached at the till appears in the synced invoice as `customer_phone` (or `customer_id`), the only candidate fields per the audit. Otherwise the fallback applies. Ledger and Mini Apps are unchanged either way.

### Portable by configuration

- A brand row holds its Zalo App, OA and ZBS account.
- A store row holds its iPOS store id, POS ids (the 6-digit `fb_store_id` is the likely callback `Pos_Id`) and QR parameters.
- A programme row holds the points rate, stamp rules, expiry and caps.
- A coupon-rail row per store names the rail and the vendor-side programme or discount ids.
- Another POS swaps the connector and the rail; the ledger and apps stay.

## Checklist

- [x] Offline audit of the posapi fields for identity, check-in, vouchers, discounts, receipt numbers and e-invoice (2026-11-19, S1 snapshot, no API calls).
- [ ] Brief cashiers on "Thêm khách hàng"; measure member-attached invoices per shift for one week.
- [ ] Put the hotline questions below to iPOS; record the answers privately and the decisions here.
- [ ] Attach a test member at the till; after the next scheduled sync, record whether `customer_phone` or `customer_id` filled and whether the phone is masked.
- [ ] Record the G2 decision; set the coupon-rail row per store.
- [ ] If CRM: neutral points policy, digit-string check-in and multi-voucher on, one export pool per reward, one multi-use programme pointing at our callback (secret path, Sale_Tran_Id idempotency, amount checks); prove a second use is refused; redeem one unique code and confirm it lands in `voucher_code`.
- [ ] If fallback, or for the first rewards anyway: one "Chiết khấu thanh toán" entry per reward, names mapped; confirm the name lands in `discount_extra_name`.
- [ ] Connector: map `reset_tran_no_period` to `stores.tran_no_reset_period`. Claim form: check the bill number's day-of-month prefix.
- [ ] Verify the fast lane confirms 9 of 10 staff check-ins within 10 minutes; load the staff phone blacklist; approve thresholds; publish programme terms.

## Questions for the iPOS hotline

For the owner to ask the iPOS hotline (1900 4766), in this order. Each question is in Vietnamese, followed by an English gloss.

1. **Tình trạng CRM.** "Thương hiệu của tôi đã được khởi tạo iPOS CRM chưa, đang dùng gói nào? Nếu bắt đầu dùng (gắn khách vào hóa đơn, tạo chương trình voucher) thì phí hàng tháng cho 1–2 cửa hàng là bao nhiêu? Có phí nào khác không?"
   *Is CRM initialised for my brand, and on which plan? What does it cost per month for 1–2 stores once we use it, and are there other fees?*
2. **Số điện thoại trên hóa đơn.** "Khi thu ngân bấm 'Thêm khách hàng' trên FABi, số điện thoại, tên và mã thành viên có được ghi vào hóa đơn trong báo cáo bán hàng của FABi CMS (các trường customer_phone, customer_name, customer_id) không? Số điện thoại có bị che không? Cài đặt 'ẩn hiện số điện thoại khách hàng trên hóa đơn' có ảnh hưởng đến dữ liệu báo cáo không?"
   *When the cashier attaches a customer, do the phone, name and member id appear on the invoice in the Fabi CMS sales report? Is the phone masked there, and does the "show or hide customer phone" option affect the report data?*
3. **"Thêm khách hàng" có cần CRM không?** "Không bật CRM thì có dùng được 'Thêm khách hàng' không? Bật thì CRM có tự cộng điểm và tự gửi tin Zalo/SMS cho khách không? Tắt những việc đó thế nào?"
   *Does "Thêm khách hàng" work without CRM? With CRM, does it award its own points and send Zalo/SMS messages automatically, and how do we turn that off?*
4. **Mã check-in.** "Ô nhập mã check-in hoặc mã tích điểm trên FABi có nhận một chuỗi 6 chữ số do hệ thống của chúng tôi cấp (hiệu lực 2 phút) không, hay chỉ nhận mã do iPOS CRM cấp? Chuỗi đó có lưu lại trên hóa đơn không?"
   *Does the FABi check-in field accept a 6-digit code issued by our system, or only CRM-issued codes? Is the string stored on the invoice?*
5. **Ý nghĩa các cài đặt cửa hàng.** "Xin giải thích các cài đặt: tìm kiếm hội viên bằng tên, checkin bằng số điện thoại, sử dụng nhiều voucher, xem voucher của hội viên, đổi điểm lấy voucher. Bật chúng có tốn phí không?"
   *What do the store settings for member search by name, check-in by phone, multiple vouchers, member vouchers and points-for-vouchers do, and do they cost anything?*
6. **Callback và mã riêng của khách.** "Với chương trình 'mã sử dụng nhiều lần' có link callback: khi thu ngân nhập một mã riêng của khách do ứng dụng của chúng tôi cấp (có tiền tố cố định), POS có gửi mã đó đến callback để chúng tôi kiểm tra không, hay chỉ nhận đúng mã của chương trình?"
   *If a cashier types a customer-specific code issued by our app (with a fixed prefix), does the POS forward it to the callback, or does it only accept the programme's own code?*
7. **Kỹ thuật của callback.** "iPOS gọi callback bằng phương thức nào (POST JSON?), chờ tối đa bao nhiêu giây, có gọi lại khi lỗi không, có khóa bí mật hoặc chữ ký không, và gọi từ những địa chỉ IP nào? Trường 'Code' trong phản hồi mang giá trị nào để chấp nhận hoặc từ chối? Khi gỡ voucher hoặc hủy hóa đơn, iPOS có báo cho callback không? FABi bản hiện tại còn hỗ trợ callback không? Xin tài liệu mẫu mới nhất."
   *Method, timeout, retries, authentication and source IPs of the callback; which `Code` values mean accept or refuse; is a removed voucher or a cancelled bill reported; is it still supported on current FABi; please send the latest sample.*
8. **Sale_Tran_Id.** "Sale_Tran_Id gửi trong callback có trùng với mã hóa đơn (tran_id) trong báo cáo bán hàng FABi không?"
   *Is the callback's Sale_Tran_Id the same as the invoice tran_id in the Fabi sales report?*
9. **Mã dùng một lần.** "Có nhập được danh sách mã dùng một lần do chúng tôi tự tạo vào chương trình CRM không, hay chỉ xuất mã do iPOS tạo? Phí xuất mã là bao nhiêu một mã, giới hạn mỗi lần là bao nhiêu? Mã đã 'Đã sử dụng' nhưng hóa đơn bị hủy hoặc gỡ voucher thì có khôi phục được không?"
   *Can we import our own single-use codes, or only export iPOS-generated ones? What is the export fee and the per-run limit? Can a code burned on a cancelled bill be restored?*
10. **Chương trình khuyến mãi hiện có.** "Các chương trình khuyến mãi trong FABi CMS có cờ partner_auto_gen: có phải do CRM đồng bộ sang không? Ai tạo, và xem hoặc sửa trong CRM ở đâu?"
    *Are the promotions flagged partner_auto_gen in the Fabi CMS synced from CRM, who created them, and where are they managed?*
11. **Hạch toán và hóa đơn điện tử.** "Với mỗi 'Loại hạch toán' của voucher, giảm giá hiện thế nào trên hóa đơn điện tử xuất từ máy tính tiền? Loại nào làm trường voucher_amount_paid có giá trị?"
    *How does each voucher accounting type appear on a cash-register e-invoice, and which one fills voucher_amount_paid?*
12. **Mẫu hóa đơn in.** "Mẫu hóa đơn tùy chỉnh có in được số hóa đơn {tran_no}, {customer_phone}, {customer_point} không? Có in được một mã QR chứa đường link của chúng tôi kèm số hóa đơn không?"
    *Can the custom receipt print {tran_no}, {customer_phone} and {customer_point}, and a QR code holding our own link with the bill number?*
13. **API và webhook cho đối tác.** "iPOS có cấp quyền 'iPOS DW – PARTNERS' (webhook hóa đơn và API get-sales) cho thương hiệu tự phát triển không? Điều kiện, chi phí và thời gian cấp thế nào? Dữ liệu hóa đơn có số điện thoại, mã thành viên, mã voucher và số hóa đơn in (tran_no) không? Webhook có xác thực không? Có API tra cứu hội viên, cộng điểm hoặc phát hành voucher không?"
    *Will iPOS grant the DW partner webhook and pull API to a brand building its own app? Terms, cost, lead time; does the payload include phone, member id, voucher code and receipt number; is the webhook authenticated; is there any API for member lookup, points or voucher issue?*
14. **Dữ liệu dùng chung.** "Nếu cửa hàng thuộc thương hiệu nhượng quyền, hội viên, hạng và điểm CRM có dùng chung với cửa hàng khác không? Kết nối Zalo OA với CRM có tính phí tin nhắn không, có liên kết được với Zalo Mini App không?"
    *For a franchised brand, are CRM members, tiers and points shared with other franchisees? Does connecting the OA to CRM incur message fees, and can CRM link to a Zalo Mini App?*

## Open questions

Changes on 2026-11-19 are marked.

- **Narrowed:** does posapi fill `customer_phone` (or `customer_id` on payments) once a member is attached, and is it masked? The audit found no other field: no membership id, member code or check-in string exists in the payload (hotline Q2; test member).
- **Changed:** CRM appears initialised (CRM sources and CRM-synced promotions are present). The open part is the price once used, the code-export fee, and whether "Thêm khách hàng" needs CRM (hotline Q1, Q3, Q9).
- **Extended:** does the callback carry authentication, from which IPs, with what timeout and reversal behaviour; does the POS forward customer-specific codes to it; does Sale_Tran_Id equal `tran_id` (hotline Q6–Q8)?
- **Unchanged:** does the Fabi check-in digit string accept our dynamic codes, or only CRM-issued ones? Added: what the store's check-in-by-phone and member toggles do (hotline Q4–Q5).
- **New:** are the `partner_auto_gen` promotions CRM programmes, and does a unique single-use code land in `voucher_code` like the multi-use ones (hotline Q10; first export test)?
- **New:** can the receipt print our own QR link, and are `{tran_no}`, `{customer_phone}` and `{customer_point}` still available? The manual host was unreachable on 2026-11-19 (hotline Q12).
- **New:** will iPOS grant the DW partner feed, on what terms, and does it carry customer or voucher fields (hotline Q13)?
- **Closed:** do vouchers typed at the till reach the synced invoice? Yes, in `voucher_code`, always with a promotion line (385 of 385); never in `voucher_amount_paid`.
- **Closed:** is the receipt number a safe claim key? Yes per store and business day on S1, with a day-of-month prefix.

## Sources

- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-ca-nhan-khach-hang/dang-ky-thanh-vien-tai-may-pos-ban-hang/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-ca-nhan-khach-hang/dang-ky-thanh-vien-qua-zalo/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/tich-diem-bang-so-dien-thoai/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/
- https://huongdan.ipos.vn/docs/htkt-khac-phuc-loi-phan-mem/ban-hang/khong-the-goi-them-mon-khi-da-su-dung-voucher-giam-gia/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/nha-hang-tu-xay-dung-he-thong-kiem-tra-ma-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/tao-e-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher-tren-kenh-doi-tac/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/ket-noi-zalo/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/kich-ban-cskh/tao-kich-ban-ap-dung-ma-tich-diem/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/thanh-vien/cai-dat-khac/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/thanh-vien/tao-voucher-doi-diem/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/thanh-vien/tao-chiet-khau-mac-dinh/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/bao-cao/voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/bao-cao/bang-ke-hoa-don/
- https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-ipos-crm/
- https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-fabi/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-pos-fabi/
- https://huongdan.ipos.vn/docs/huong-dan-khai-bao-ket-noi-tai-khoan-zalo-cloud-account-zca-va-tao-template-zns-cho-crm-ipos-vn/iv-danh-sach-tham-so-zbs-template/
- https://fabi-docs.ipos.vn/ (read 2026-11-07; unreachable 2026-11-19)
- https://huongdan.ipos.vn/
- https://ipos.vn/en/san-pham/
- https://ipos.vn/en/phan-mem-crm-quan-ly-khach-hang-ipos-crm/
- https://ipos.vn/en/san-pham/phan-mem-cham-soc-khach-hang-ipos-crm/
- https://ipos.vn/thong-bao-ngung-phat-trien-phan-mem-ipos-pos-pc-va-chuong-trinh-ho-tro-chuyen-sang-ipos-fabi/
- https://ipos.vn/foodhub-cap-nhat-moi-quan-ly-tap-trung-ngay-tren-fabi-cms/
- https://ipos.vn/thong-bao-ve-viec-tang-phi-khi-gui-tin-nhan-tu-ipos-crm-qua-kenh-zalo/
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalo.solutions/oa/pricing
- https://www.highlandscoffee.com.vn/vn/chinh-sach-chuong-trinh-thanh-vien-highlandsdi.html
- https://huongdan.cnvloyalty.com/tinh-nang/cau-hinh/cong-ket-noi-du-lieu/ket-noi-ipos
- https://ladipage-vietnam.gitbook.io/v5-ladiflow/tich-hop/huong-dan-tich-hop/tich-hop-ipos.md
- https://github.com/volekhanh123/beeftown-stock/pull/120
- https://github.com/volekhanh123/beeftown-stock/pull/121
