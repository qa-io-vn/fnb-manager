# Loyalty programme design for tea and coffee shops on Zalo

As of 2026-11-07 · supports roadmap phases 17–19 (Track C)

## Purpose

This document fixes the loyalty mechanics for the owner's brands before any loyalty code is written: how Vietnamese chains run points, stamps and vouchers, what Zalo loyalty vendors charge, which earning and redemption paths work with read-only iPOS Fabi access, which anti-fraud controls apply, what the programme costs, and which KPIs show whether it works. Figures corrected by the fact-check pass are used, with the older figure marked outdated.

## What is verified

Markers: [high] primary source read directly; [medium] secondary or caveated; [low] vendor-reported.

### How the chains run it

- Highlands Coffee (policy updated 2026-08-24): 1 DRIP per 10,000 ₫ actually paid; a parallel stamp card gives a free small drink for 9 stamps, one per transaction of at least 50,000 ₫; DRIPS expire after 12 months of inactivity; tiers at 3,000,000 ₫ and 10,000,000 ₫ a year; one account per phone and device; clawback on refunds. [high] The member QR went dynamic in 2026 "for better security". [medium]
- Phúc Long (terms read 2026-11-07): 10,000 ₫ = 1 point, 100 points = a free size-M drink, points live 1 year; VIP (400 points and 4,000,000 ₫) gets 10 % off, Diamond 15 %; barcode shown before the transaction, screenshots and phone read-out refused. Phúc Long Rewards launched on a Zalo Mini App on 2025-11-05 with a free drink for joining. [high]
- The Coffee House: 6 BEAN per 10,000 ₫, tiers at 100/200/500/3,000 BEAN. [medium, 2026-04-02] Katinat: four voucher-based tiers, rates unpublished. [medium] Hồng Trà Ngô Gia: "Mua 8 tặng 1" stamps on a Zalo Mini App linked to PosApp; Zalo reports 65 % of buyers returning (not causal). [medium, 2026-09-10]

### iPOS hooks

- Fabi Thêm khách hàng: the cashier attaches a member by phone before payment; points are credited on the paid amount when the bill prints. With mã tích điểm the customer generates a code or QR in the brand's Zalo OA chat for the cashier to enter. Both need the iPOS CRM module; the pages date from 2020–2021. [high, age caveat]
- iPOS CRM e-vouchers are typed on the Tổng tiền screen and become Đã sử dụng the moment they are entered, even if no invoice prints; a voucher with a named recipient attaches that member. [high, 2024-06-10] The CRM voucher-validation callback posts coupon code, membership id, sale transaction id and line items to a URL the restaurant hosts and expects a discount amount back; iPOS builds it for 1,000,000 ₫ per programme. [high]

### Behavioural and economic evidence

- Goal gradient (Kivetz, Urminsky, Zheng 2006): in a real café buy-N-get-one programme customers bought faster as they neared the free coffee. [high]
- Endowed progress (Nunes and Drèze 2006): a 10-stamp card pre-stamped with 2 was completed by 34 % versus 19 % for an 8-stamp card needing the same 8 purchases; the effect vanished without a reason for the head start. [high]
- Cards paying out within 2–4 weeks were completed 11.4 % of the time versus 4.0 % for 8–16 weeks (FaveCard). [low] Breakage: Dutch Bros reported about 16 % of 2021 points expiring; benchmarks call 5–30 % healthy and 40–50 % a sign of unattractive rewards. [medium]
- Fraud: iPOS lists point manipulation among cashier tricks; a 2026 press case describes under-keyed orders and misused promo codes, caught because revenue fell while footfall held. SoftWorld refreshes the member QR every 30–60 seconds and credits one invoice once. [medium]

## Limits and rules

- Identification at the till is the binding constraint: every chain mechanic and iPOS flow needs the member attached before the bill prints. Wallet-linked auto-earning is not available to a two-store merchant. [high]
- iPOS has no write API and no read API for members or points; voucher codes are typed, not scanned. A CRM code can read Đã sử dụng yet appear on no final invoice, so redemption must be reconciled against synced invoices. [high]
- With one shared cashier login per store, per-cashier attribution is impossible, so controls rest on customer-generated codes, one earn per transaction id and shift-level anomaly reports. [medium]
- Zalo: discount codes sent by ZBS must use the Voucher template; birthday templates must reference public terms; promotional (Tag 3) messages are capped at 1 per user per day and 30 per month. [high]
- Law: the promotions decree as amended by Decree 128/2024 still requires notifying the provincial Department of Industry and Trade of a customer loyalty programme at least 3 working days before launch unless the programme's total gift value stays under 100,000,000 ₫; price discounts are capped at 50 % and 120 discount-days per item per year; lucky draws need registration. A 2026 decree (239/2026) is reported to have changed promotion rules again — verify the current text before launch (see `vietnam-legal-requirements.md`). The Personal Data Protection Law 91/2025 (effective 2026-01-01) requires explicit, per-purpose consent for phone numbers; household businesses and micro-enterprises are exempt from the impact-assessment and cross-border dossiers. [medium]

## Costs

| Item | Amount |
|---|---|
| Zalo Mini App hosting, review, listing | 0 ₫ |
| Zalo OA package Tăng trưởng (required for any API use) | 2,500,000 ₫/year per OA, VAT included |
| Tin Tư vấn outside the 48-hour window beyond the 500 included | 55 ₫/message |
| ZBS voucher or authentication template | 400 ₫/message ex-VAT since 2026-03-16 (300 ₫ on the pricing page is outdated) |
| ZBS other templates (points earned, reminders) | 300 ₫/message ex-VAT (200 ₫ is outdated) |
| iPOS CRM subscription | unpublished, quote only |
| PosApp counter loyalty / Loyalty Mini App / Sales and Loyalty Mini App | 220,000 / 400,000 / 500,000 ₫ per month per store ex-tax, plus 3,000,000 ₫ setup |
| miniapp.vn Tinh Gọn / Performance | 500,000 / 1,500,000 ₫ per month VAT included, 12-month minimum |
| CNV CDP Starter / Pro; Panda Loyalty plans; agency one-off builds (Abenla, GapOne) | 10,800,000 / 30,000,000 ₫ per year; 5,000,000–25,000,000 ₫ per year; 5,000,000–20,000,000 ₫ |

Give-back from the chain rules (inference): 1 point per 10,000 ₫ with a free M-size drink at 100 points is about 5–6.5 % of member revenue at retail; a free drink after 8–9 bills of at least 50,000 ₫ is about 8–10 %, a third of that at cost of goods. Vendor SaaS at 400,000–1,500,000 ₫ per month per store is the benchmark to beat; no vendor documents a Fabi integration.

## What it means for this project

1. Supabase is the system of record for members, stamps, points, coupons and the ledger; iPOS is only the rail that puts a phone on the invoice and consumes codes. The synced invoice is the sole proof of purchase: every ledger row references a transaction id and the ledger is append-only.
2. Four earning paths, in order of precision: (A) phone attached at the till through Thêm khách hàng, confirmed by the synced invoice (needs iPOS CRM); (B) a dynamic 6-digit check-in code from the customer Mini App, valid 2 minutes, matched to an invoice at the same store within a short window, ambiguous matches queued for the manager; (C) receipt claim by bill number and amount within 72 hours, one claim per transaction ever, no cashier action; (D) voucher recipient.
3. Three redemption rails per store: a pool of single-use CRM codes; the CRM callback answered by an Edge Function, idempotent on the sale transaction id; or, without CRM, Fabi Chiết khấu thanh toán entries applied after staff verify the customer's code in the staff Mini App. All are confirmed by the synced invoice; unused holds expire after 24 hours.
4. Headline mechanic: a stamp card, tích 8 tặng 1, one stamp per invoice of at least 50,000 ₫, the first card pre-filled with 2 stamps for a stated reason ("quà chào mừng"), 6-month stamp validity, plus 1 point per 10,000 ₫ for tier and birthday perks with 12-month rolling expiry. Stamps are legible at a glance and carry the strongest café evidence (goal gradient); the reasoned head start is the endowed-progress design that doubled completion; a regular reaches the first reward within 2–4 weeks; give-back sits in the Highlands band.
5. Anti-fraud as configuration: one earn per transaction id, minimum bill, daily cap per phone, staff phones and delivery-channel invoices excluded, clawback on voided or edited invoices with negative balances allowed, dynamic codes so screenshots are useless, manager approval for adjustments, shift-level anomaly reports.
6. Messaging: confirmations in-app and on the Fabi receipt; free Tin Tư vấn inside the 48-hour window; paid ZBS only for the Voucher template, expiry reminders and 30-day win-back, budgeted at 400 ₫. Programme terms go on a public page (account binding, exclusions, clawback, expiry, data purpose), and every parameter is a tenant row, never code.

## Checklist

- [ ] Confirm the legal entity behind each brand (OA documents, KYB, data-protection exemptions).
- [ ] Ask iPOS for the CRM quote; check in the Fabi CMS whether CRM is initialised.
- [ ] Attach a test member at the till; verify whether the sales API exposes the phone or membership id.
- [ ] Individual Fabi login per cashier; cashier script for Thêm khách hàng.
- [ ] Approve mechanics: 8 stamps at 50,000 ₫ minimum, 2 welcome stamps, 6-month stamps, 1 point per 10,000 ₫, 12-month points.
- [ ] Choose the redemption rail per store; create the matching CRM programmes or Fabi discount entries.
- [ ] Publish programme terms and privacy notice; draft the Voucher, reminder and win-back ZBS templates.
- [ ] KPIs: member-attached invoice share per shift, members joined and active (30 days), stamps issued, redemption rate, days to first reward, repeat rate of member phones, member versus non-member frequency and ticket, give-back % (reward cost over member revenue), outstanding liability, breakage, disputes over 48 hours, fraud flags.

## Open questions

- iPOS CRM price for two stores, and whether CRM is required for Thêm khách hàng, the callback and points on receipts.
- Whether the sales API exposes the customer phone or membership id once attached, and whether it is masked; whether the callback carries any authentication; whether Fabi's check-in field accepts a 2-minute code issued by this project instead of a CRM mã tích điểm.
- Whether the Mini App scanQRCode permission is granted for loyalty use; which ZBS prices apply to a new OA and whether a send by uidByOA is a free OA message.
- Exact text of Decree 239/2026.
- No repeat-visit or breakage benchmark exists for single-store Vietnamese tea or coffee shops; the owner's baseline comes first.

## Sources

- https://www.highlandscoffee.com.vn/vn/chinh-sach-chuong-trinh-thanh-vien-highlandsdi.html
- https://phuclong.com.vn/hoi-vien/dieu-khoan-va-dieu-kien-chuong-trinh-hoi-vien
- https://phuclong.com.vn/khuyen-mai/ra-mat-phuc-long-rewards---tich-diem-doi-qua-ngay-20251105100638
- https://voucherthecoffeehouse.chanhtuoi.com/Blog/tich-diem-bean-the-coffee-house/
- https://mba.katinat.vn/download-mobile-app-katinat
- https://miniapp.zaloplatforms.com/blog/tu-hang-cho-den-65-khach-quay-lai-cach-hong-tra-ngo-gia-bien-moi-don-hang-thanh-ly-do-cho-lan-mua-tiep-theo-2
- https://posapp.vn/phan-mem-tich-diem-khach
- https://miniapp.vn/
- https://cnv.vn/chi-phi-xay-dung-zalo-mini-app/
- https://oazbs.vn/zalo-miniapp/
- https://gapone.vn/bang-gia-zalo-mini-app/
- https://pandaloyalty.com/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/tich-diem-bang-so-dien-thoai/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/nha-hang-tu-xay-dung-he-thong-kiem-tra-ma-voucher/
- https://ipos.vn/thong-bao-dieu-chinh-gia-thue-bao-ipos-fabi/
- https://ipos.vn/nhan-vien-gian-lan-quan-cafe/
- https://dantri.com.vn/du-lich/hanh-xu-cua-nu-chu-quan-ca-phe-khi-phat-hien-nhan-vien-bien-thu-20261027150039287.htm
- https://softworldvietnam.com/thiet-ke-app-loyalty-tich-diem-dot-pha-doanh-thu-cung-softworld/
- https://www.momo.vn/tin-tuc/thong-bao/thong-bao-ngung-tu-dong-tich-diem-thanh-vien-7-7467
- https://zalo.solutions/oa/pricing
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalo.solutions/news/quy-dinh-chung-khi-kiem-duyet-mau-tin-zns/xdygqtrjjm97k28rsh07wr72
- https://zalo.solutions/blog/co-che-danh-gia-chat-luong-va-quyen-loi-gui-zns/qsuhj60o4oteiy7rnrf0ohpe
- https://api.crossref.org/works/10.1509/jmkr.43.1.39
- https://www.researchgate.net/publication/23547282_The_Endowed_Progress_Effect_How_Artificial_Advancement_Increases_Effort
- https://www.favecard.co/en/blog/coffee-shop-loyalty-program/
- https://investors.dutchbros.com/news-releases/news-release-details/dutch-bros-inc-reports-fourth-quarter-and-fiscal-year-2022
- https://www.voucherify.io/glossary/loyalty-breakage
- https://kpmg.com/vn/vi/insights/2026/07/decree-239-on-sales-promotion.html
- https://www.taichinhkhoinghiep.vn/luat-bao-ve-du-lieu-ca-nhan-91-2025-qh15-ho-kinh-doanh-doanh-nghiep-nho-can-lam-gi/?print=print
