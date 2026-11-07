# iPOS loyalty integration design: connecting points and coupons to real purchases

Research date 2026-11-07. Decisions in ADR-016.

## Purpose

This document explains how a stamp, point or coupon in our ledger is tied to an invoice really paid at a Fabi till. It compares four ways to do this, explains the chosen hybrid and its no-contract fallback, and fixes the identity model, the earning paths, the coupon rails, the anti-fraud controls, the decision gate and the per-shop configuration that keeps the design portable.

## What is verified

Markers: [high] primary source; [medium] old or indirect; [low] inference.

### Identity at the till

- Fabi has no public write API and no documented way to attach a customer or credit points from outside (huongdan.ipos.vn, 2026-11-07) [high].
- A cashier attaches a member on the item screen with "Thêm khách hàng" by phone; after printing, the member syncs to iPOS CRM (iPOS help, updated 2021-12-24) [high]. The check-in-code variant (a "mã tích điểm" from the OA chat entered in the Hội viên token field) and the automatic credit on the paid amount after printing are on 2020–2021 pages [medium].
- Fabi CMS 3.1.9 offers "Không checkin bằng SĐT" (check-in by a digit string or name) and multi-voucher per order; the invoice option "Bảo mật thông tin khách hàng" masks the phone on the printed bill (CMS manual, 2026-11-07) [high]; whether posapi masks it is unknown [low].

### Coupons at the till

- Entering a CRM e-voucher code flips it to "Đã sử dụng" immediately, even before printing; the code is bound to one table; a voucher with a named recipient attaches that member and earns points (iPOS help, updated 2024-06-10) [high].
- Correction to "locks the order": a 2021 troubleshooting page says items cannot change while a voucher is applied; removing it to edit burns a single-use code. A code can therefore read "Đã sử dụng" yet appear on no final invoice [high].
- iPOS documents a restaurant-hosted voucher-validation callback: on a multi-use programme the POS posts Pos_Parent, Pos_Id, Coupon_Code, Membership_Id, Sale_Tran_Id and the order lines and expects Discount_Amount back (updated 2024-06-10). No authentication, timeout or reversal hook is documented [high].
- E-voucher programmes export unique single-use codes to Excel, at most 1,000 per run (2024-06-10) [high]. Without CRM, Fabi CMS 5.5 "Chiết khấu thanh toán" gives whole-bill discounts selectable at payment (2026-11-07) [high].

### Identity on the Zalo side

- The Mini App phone permission returns a single-use token valid 2 minutes, exchanged server-side with the app secret; the request must follow a user action with a stated purpose (Zalo docs, updated 2026-11-05) [high]. Zalo user ids differ per Zalo App and per OA, so the phone is the only cross-brand key [high].

### Market reference

- Highlands: 1 DRIP per 10,000 ₫ paid, a free drink per 9 stamps on bills of at least 50,000 ₫, 12-month expiry, one account per phone and device, clawback on refunds (policy updated 2026-08-24) [high].
- No loyalty SaaS vendor documents a Fabi link that moves points or vouchers (2026-11-07) [medium].

## Limits and rules

- CRM points accrue only if the member is attached before the bill prints: identification at the till is the binding constraint.
- The callback must protect itself: secret URL path, idempotency on Sale_Tran_Id, amount sanity checks, IP allow-list.
- The synced invoice stream (30-minute incremental, nightly 14-day re-pull) is the only authoritative purchase record; every ledger row references an invoice, the ledger is append-only, and a redemption is confirmed only when CRM status and the synced invoice agree.
- CRM's Zalo flows are documented on 2020-era pages; re-test on the shops' Fabi build. Zalo-derived data stays minimal and consented (ADR-019).

## Costs

| Item | Amount | Unit | Note |
|---|---|---|---|
| iPOS CRM subscription | quote only | per month | open commercial question |
| Callback built by iPOS | 1,000,000 ₫ | one-off per programme | avoided; we build it |
| ZBS voucher template | 400 ₫ | per delivered message, ex-VAT | since 16/03/2026; the 300 ₫ figure is outdated |
| ZBS other templates | 300 ₫ | per delivered message, ex-VAT | the 200 ₫ figure is outdated |
| OA Tăng trưởng package | 2,500,000 ₫ | per OA per year incl. VAT | required for any Open API use |

## What it means for this project

### Four options compared

| Option | iPOS dependency | Cost to iPOS | Verdict |
|---|---|---|---|
| 1. CRM native (CRM points, OA chat commands) | very high | CRM quote; 55 ₫ per CRM-sent Zalo message (2020) | no code, but 2020 chat UX, no read API, locked to iPOS |
| 2. Own ledger on synced data, no CRM | low, read-only posapi | 0 ₫ | portable, but earns wait for the sync, matching is heuristic, coupons procedural |
| 3. Hybrid: our ledger, CRM as the till rail (chosen) | medium, standard subscription | CRM quote | phone on invoice ends heuristics; POS consumes codes; rail swappable |
| 4. Vendor Zalo loyalty SaaS | high if purchases are linked | 6–30 million ₫ per brand per year | no vendor connects points to Fabi; data sits with the vendor |

### The hybrid and its fallback

Supabase is the system of record. iPOS CRM, if the quote is acceptable, does only what it uniquely does at the till: it puts a phone or our check-in code on the invoice and consumes coupon codes; its own points policy is set neutral. If CRM is declined, the same ledger runs on staff-verified check-ins, receipt claims and Fabi discount entries at lower precision.

### Ground truth and identity

The join key is the phone in E.164 form, from the customer's Zalo consent in the Customer Mini App, the OA request-user-info form, or the cashier typing it into "Thêm khách hàng". Zalo App and OA user ids are kept per brand for messaging. Staff are Zalo ids with store scope whose phones never earn.

### Four earning paths, in precision order

Reconciliation runs after every sync and records the matched path.

- **A. Phone on the invoice** (CRM rail): a confirmed earn is written directly.
- **B. Dynamic check-in code**: the Mini App shows a 6-digit code refreshed every 60 seconds, valid 2 minutes, store-aware. The cashier types it as the Fabi check-in string (then path A applies) or staff record it in the Staff Mini App. Matched to an unclaimed synced invoice at the same store within −2/+15 minutes, closest amount first; two candidates within tolerance go to the manager queue.
- **C. Receipt claim**: the customer enters bill number and amount within 72 hours; match on store (from the QR deep link), bill number and exact amount; one claim per invoice ever, at most 3 per phone per day. Needs no cashier action: the universal fallback.
- **D. Voucher recipient**: a CRM voucher issued to a named member attaches that member; the code on the invoice confirms the redemption and earns on the remainder.

Latency: B and C earns show as "đang chờ xác nhận". A fast-lane sync (an Edge Function triggers a workflow run, at most one per 5 minutes per store, pulling the last 60 minutes) lands most confirmations in 5–10 minutes. The nightly re-pull turns edits and voids into clawbacks, leaving a negative balance where a reward was already redeemed.

### Three coupon rails, selected per store

- **Rail 1, CRM code pool**: one single-use export programme per reward, codes imported into our table. Redemption assigns a code with a countdown and holds the stamps; the invoice carrying the code confirms it. No invoice within 24 hours releases the hold and quarantines the code.
- **Rail 2, CRM validation callback**: a multi-use programme pointing at our Edge Function. We validate ownership and conditions against the posted lines, return the discount, and mark the coupon redeemed idempotently on Sale_Tran_Id: the same id gets the same answer; a different id for a used code gets 0 ₫ with a clear description.
- **Rail 3, Fabi payment discount** (no CRM): one "Chiết khấu thanh toán" entry per reward. Staff verify the code in the Staff Mini App, the cashier applies the discount, and a synced invoice at that store within 15 minutes carrying that name confirms it. Double-use is prevented by our system, not the POS.

### Anti-fraud controls

One earn per invoice; earning on net paid only; minimum bill for a stamp; daily cap of 3 earning invoices per phone; delivery-channel invoices excluded; receipt claims need bill number, amount and store; staff phones blacklisted and individual cashier logins required; manual adjustments logged, larger ones manager-approved; clawback on voids and edits; shift-level anomaly reports; public terms.

### Deliberately not relied on

No writing of orders or members into Fabi. CRM's points engine is not the ledger. The 2020 OA chat commands are not a customer surface. Wallet-linked auto-earning (MoMo, ZaloPay) is not used. Partner feeds (iPOS DW, Foodbook Hub) are optional accelerators. Mini App ordering is out of scope.

### Decision gate after the phone-capture week

Gate G2 closes phase 16a. If the CRM quote is acceptable and a test member attached at the till appears as a phone or membership field in the synced invoice, CRM is the rail; otherwise the fallback. Ledger and Mini Apps are unchanged either way.

### Portable by configuration

A brand row holds its Zalo App, OA and ZBS account; a store row its iPOS store id, POS ids and QR parameters; a programme row the points rate, stamp rules, expiry and caps; a coupon-rail row per store names the rail and the vendor-side programme or discount ids. Another POS swaps the connector and the rail; the ledger and apps stay.

## Checklist

- [ ] Brief cashiers on "Thêm khách hàng"; measure member-attached invoices per shift for one week.
- [ ] Confirm in the Fabi CMS whether CRM is initialised; request the CRM quote and callback egress IPs from the iPOS hotline.
- [ ] Attach a test member at the till; record the posapi field names for phone, membership, voucher and discount, and any masking.
- [ ] Record the G2 decision; set the coupon-rail row per store.
- [ ] If CRM: neutral points policy, digit-string check-in and multi-voucher on, one export pool per reward, one multi-use programme pointing at our callback (secret path, Sale_Tran_Id idempotency, amount checks); prove a second use is refused.
- [ ] If fallback: one "Chiết khấu thanh toán" entry per reward, names mapped.
- [ ] Verify the fast lane confirms 9 of 10 staff check-ins within 10 minutes; load the staff phone blacklist; approve thresholds; publish programme terms.

## Open questions

- Does the posapi sale payload expose phone, membership id or check-in code once a member is attached, and is it masked?
- CRM price for a two-store brand; is CRM required for "Thêm khách hàng" and for the callback?
- Does the callback carry any authentication, and from which IPs does the POS call it?
- Does the Fabi check-in digit string accept our dynamic codes, or only CRM-issued ones?

## Sources

- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-ca-nhan-khach-hang/dang-ky-thanh-vien-tai-may-pos-ban-hang/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/tich-diem-bang-so-dien-thoai/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/
- https://huongdan.ipos.vn/docs/htkt-khac-phuc-loi-phan-mem/ban-hang/khong-the-goi-them-mon-khi-da-su-dung-voucher-giam-gia/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/nha-hang-tu-xay-dung-he-thong-kiem-tra-ma-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/tao-e-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher/
- https://fabi-docs.ipos.vn/
- https://huongdan.ipos.vn/
- https://ipos.vn/en/phan-mem-crm-quan-ly-khach-hang-ipos-crm/
- https://ipos.vn/thong-bao-ve-viec-tang-phi-khi-gui-tin-nhan-tu-ipos-crm-qua-kenh-zalo/
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalo.solutions/oa/pricing
- https://www.highlandscoffee.com.vn/vn/chinh-sach-chuong-trinh-thanh-vien-highlandsdi.html
- https://huongdan.cnvloyalty.com/tinh-nang/cau-hinh/cong-ket-noi-du-lieu/ket-noi-ipos
- https://github.com/volekhanh123/beeftown-stock/pull/120
