# Zalo Official Account and messaging

Written 2026-11-07 from Zalo's official pages and a fact-check pass. Confidence: [high] primary source; [medium] sources disagree or partly inferred; [low] third-party only.

## Purpose

Phases 15 to 19 depend on a Zalo Official Account (OA). This note records what Zalo requires to create and verify an OA, which package unlocks the Open API, what each message type may do and cost, how the Open API and ZBS Template Messages behave, and whether the Zalo Bot API can be a free staff-alert channel.

## What is verified (as of 2026-11-07)

### Creating and verifying an OA

- Only a personally verified Zalo account on a +84 number can create an OA. Businesses and household businesses (hộ kinh doanh) with a registration certificate get an "OA xác thực"; anyone else gets a "Hồ sơ quảng cáo", which can only run ads. [high]
- Dossier: the certificate, all pages, sealed, or a "Công văn xác thực" on Zalo's template (not for hộ kinh doanh); the representative's name and CCCD must match exactly. Submit within 14 days of creation; review takes "thường 2-3 ngày làm việc"; a rejection must be resubmitted within 14 days or the OA is locked permanently. [high]
- "Nhà hàng & Quán" category: an OA named after a brand rather than the registered entity needs one extra business element, such as a food-safety certificate, two shop-sign photos or a delivery-app storefront screenshot. [high]

### Packages (price list effective 01/06/2026)

- Four packages replaced Dùng thử / Nâng cao / Premium: Cơ bản (free default), Tiêu chuẩn, Tăng trưởng, Toàn diện; legacy packages cannot be renewed. [high]
- "Tích hợp Zalo Open API" exists only on Tăng trưởng and Toàn diện; the FAQ says linking any application needs one of them. The benefit table lists one app for lower tiers too; the FAQ is operative. [medium]
- Tăng trưởng: 15 staff seats, 3 apps, 100 API requests/minute, 500 Tin Tư vấn outside the 48-hour window per month, 1 GMF-100 group, 4 free broadcasts per follower per month. Toàn diện: 100 seats, unlimited apps, 2,000 requests/minute, 2,000 out-of-window messages, 3 GMF-100 groups. [high]
- Buying needs a verified OA linked to a funded ZBS Account; packages are non-refundable; expiry reverts to Cơ bản. [high]

### Message types

- Tin Tư vấn: a window opens on a qualifying interaction (message to the OA or its GMF group, call, comment, chatbot, Menu/CTA tap); following the OA only earns a welcome message. Since 1/1/2026 messages are free and unlimited within 48 hours of the last interaction; the old "8 free per 48 hours" rule is outdated. The API may send only within 7 days (error -230), OA Manager within 365 days; outside 48 hours each message costs 55 VND after the allowance. [high]
- Tin Giao dịch by UID (165 VND) and personal Tin Truyền thông were discontinued on 01/03/2026 in favour of ZBS Template Message; 165 VND is outdated. [high]
- Broadcast: followers only, at most 1 per user per day and 30 per month, 4 free per follower per month on paid tiers; developer docs say 6:00–21:59, the OA Manager guide 6:00–19:59. [medium]
- GMF (Quản lý nhóm): an OA-owned group of 10/50/100/1000 members on paid packages. The OA posts 24/24 via API; invitees must follow the OA or have interacted within 7 days. [high]

### OA Open API

- OAuth v4 with PKCE (S256): authorization code valid 10 minutes, single-use; access token 25 hours; refresh token 3 months and single-use, returning a new pair. [high]
- Webhooks: HTTPS domain, HTTP 200 within 2 seconds. Retries only when Zalo cannot open a connection, at 30 s, 5 min, 15 min, 30 min, 1 h; a slow or non-200 answer is not retried. Persistent failure disables the webhook and unsubscribes the app. [high]
- X-ZEvent-Signature = SHA-256 of appId + body + timestamp + OA secret key; encoding is undocumented and mismatches are reported. [medium]
- Phone numbers come only from the user: a "request_user_info" template answered by the "user_submit_info" webhook. [high]
- Rate limit per OA: 100 requests/minute on Tăng trưởng, 2,000 on Toàn diện (error -32). [high]

### ZBS Template Message (formerly ZNS)

- Live 01/01/2026: one template service for Tag 1 Transaction, Tag 2 Customer care (including "tích điểm") and Tag 3 Promotion, sent by phone or UID. [high]
- Prerequisites: a ZBS Account whose tax code and representative are checked against the National Business Registration Portal, a verified OA on Tăng trưởng or Toàn diện (error -135), an authorised app, a prepaid balance and an approved template (review 2–3 working days; immutable once approved). [high]
- Caps: Tag 3 at most 1 per user per day and 30 per month per OA, in the inbox only for followers, otherwise "Business Box"; Tag 1 and 2 have no per-user cap. Daily quota tiers 1,000 / 5,000 / 20,000 (default) / 50,000 / unlimited; a report rate above 2 % of the daily quota drops a tier. [high]
- Prices rose on 16/03/2026 (new templates) and 24/03/2026 (existing ones). The 200/300 VND table still on the public pricing page is outdated; see Costs. [high]
- Billing: phone-route messages are charged only when delivered within 15 s (OTP) or 7,200 s (others); UID sends are charged on processing. [high]
- Content rules: Vietnamese with diacritics, links and phone numbers only in CTA buttons, the Voucher layout for any discount code, recipients who have transacted with the business. [high]

### Zalo Bot API

- Basic plan free: 3 bots, 50 users per bot, 3,000 messages per month, 3 group chats (Beta); Pro at 129,000 VND/month is "Sắp ra mắt". Webhooks carry X-Bot-Api-Secret-Token; HTTPS recommended. [high] Polling and webhook are reportedly exclusive. [low]

## Limits and rules

- No API, webhook or ZBS sending without a verified OA on Tăng trưởng or Toàn diện.
- Reaching a person depends on them: free within 48 hours of an interaction, API-reachable within 7 days, promotions 1/day and 30/month, inbox only for followers.
- Webhook receivers must acknowledge within 2 seconds and cannot rely on retries; the single-use refresh token must be stored atomically.

## Costs

All amounts in VND. OA packages include 10 % VAT; ZBS prices exclude VAT.

- OA creation, verification and Cơ bản: 0.
- Tiêu chuẩn: 1,000,000 per year.
- Tăng trưởng: 1,400,000 per 6 months or 2,500,000 per year.
- Toàn diện: 3,400,000 per 6 months or 6,000,000 per year.
- Tin Tư vấn outside 48 hours, beyond the allowance: 55 per message.
- Extra GMF-10 / 50 / 100 / 1000 group: 25,000 / 55,000 / 75,000 / 300,000 per group per month; OA messages into groups 0 until 31/12/2026.
- ZBS by phone, per delivered message: OTP and Voucher templates 400 (outdated: 300); payment-request and bus-ticket templates 300; all other templates 300 (outdated: 200).
- ZBS by UID: subsidised below the phone price, unpublished, per processed message.
- CTA buttons, per button: default 0; Zalo-ecosystem link first 0 then 100; own website 100; phone call 200; other business's site or Mini App 500; own app 600; other app 1,000; app download 3,000.
- Image module 300, response button 100, call-permission request 400, per message.
- ZBS Account top-up: minimum 50,000 per top-up, non-refundable.
- Zalo Bot API Basic: 0 for 3,000 messages per month.

Example: 1,000 custom Tag 2 messages by phone cost about 300,000.

## What it means for this project

1. Budget floor: one Tăng trưởng package per OA (2,500,000 VND/year) plus a ZBS balance. Separate OAs for the tea shop and the coffee shop double cost and paperwork; one OA per legal entity is the cheaper default, to decide with the owner.
2. Webhooks need an always-on endpoint: the `zalo-oa-webhook` Edge Function verifies the signature, stores the event and returns 200 at once; GitHub Actions refreshes the token daily.
3. Staff channel: the included GMF-100 group is the only free any-hour room. Each shift starts with an interaction (menu tap or check-in) that opens the 48-hour 1:1 window. The free Zalo Bot API covers manager alerts without an OA package (`zalo_bot` channel, phase 14).
4. Loyalty: phones come from an explicit share (request_user_info form, or Fabi's "Thêm khách hàng" at the till) mapped to the Zalo user id in Supabase. Points and receipts go as Tag 1/2 templates by UID; coupons as Voucher templates (1/day, 30/month). Keep customers following the OA so promotions reach the inbox.
5. Roadmap cost rows must use 300/400 VND, not 200/300, and drop the 165 VND message.
6. OA id, app id, tier, template ids and GMF group id are per-tenant rows; secrets live in Edge Function secrets (ADR-006).

## Checklist

- [ ] Owner: gather the sealed certificate, CCCD details and one business element per brand; create the OA and submit the dossier within 14 days.
- [ ] Owner: create the ZBS Account under the same entity, top up at least 50,000 VND, buy Tăng trưởng.
- [ ] Create the Developer app, authorise it from the OA, implement PKCE and an atomic refresh-token store refreshed daily.
- [ ] Deploy the webhook Edge Function and test the signature against a live event.
- [ ] Create the GMF-100 staff group and a Zalo Bot for manager alerts.
- [ ] Draft Tag 1/2 templates (points earned, receipt claimed) and one Voucher template; allow 2–3 working days each.
- [ ] Show quota tier, report rate and balance in Settings → Cảnh báo; update the roadmap cost table.

## Open questions

- Subsidised UID price per template type (visible only inside the ZBS Account).
- Whether Tag 1/2 messages by UID need a recent interaction.
- Whether a free Cơ bản OA can hold one authorised app for webhook-only use.
- Broadcast end hour: 21:59 or 19:59.
- Whether moderation approves internal staff-notice templates under the "transacted with the business" rule.
- Content of the 04/11/2026 oa.zalo.me notice on an updated verification process.
- Whether free GMF messages extend past 31/12/2026; whether the welcome message can carry the request_user_info form.

## Sources

- OA creation: https://oa.zalo.me/home/documents/guides/khoi-tao-zalo-official-account_61
- Verification: https://oa.zalo.me/home/documents/guides/huong-dan-xac-thuc_70, https://oa.zalo.me/home/documents/policy/xac-thuc-tai-khoan, https://oa.zalo.me/home/documents/policy/dang-ky-va-su-dung-tai-khoan-zalo-official-account-doanh-nghiep
- Restaurant category: https://oa.zalo.me/home/documents/guides/nha-hang-quan_385780332127799588
- Packages: https://oa.zalo.me/home/resources/news/162026-zalo-official-account-trien-khai-4-goi-dich-vu-moi-toi-uu-hieu-suat-theo-nhu-cau-doanh-nghiep-_109742821673880689, https://zalo.solutions/oa/pricing
- Message overview: https://oa.zalo.me/home/documents/guides/tong-quan-cac-loai-tin-nhan-tren-zalo-official-account-_3651713298729094511
- Tin Tư vấn: https://oa.zalo.me/home/documents/guides/tin-tu-van, https://docs.zaloplatforms.com/docs/OA/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan, https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099
- Tin Giao dịch: https://docs.zaloplatforms.com/docs/OA/tin-nhan/tin-giao-dich/gui-tin-giao-dich
- Broadcast: https://docs.zaloplatforms.com/docs/OA/tin-nhan/tin-truyen-thong/dieu-kien-gui-tin-truyen-thong, https://oa.zalo.me/home/documents/guides/cau-hoi-thuong-gap-tin-broadcast
- GMF: https://oa.zalo.me/home/documents/guides/quan-ly-nhom-gmf_1954166378348758227, https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/tin-nhan/condition
- OAuth, permissions: https://docs.zaloplatforms.com/docs/OA/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new, https://docs.zaloplatforms.com/docs/OA/bat-dau/gioi-thieu-official-account-api-va-cac-nhom-quyen
- Webhooks, signature: https://docs.zaloplatforms.com/docs/OA/webhook/tong-quan, https://docs.zaloplatforms.com/docs/OA/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan, https://docs.zaloplatforms.com/docs/OA/webhook/quan-ly/su-kien-nguoi-dung-dong-y-chia-se-thong-tin
- Phone capture, user detail: https://docs.zaloplatforms.com/docs/OA/tin-nhan/tin-tu-van/gui-tin-tu-van-theo-mau-yeu-cau-thong-tin-nguoi-dung, https://docs.zaloplatforms.com/docs/OA/quan-ly/quan-ly-thong-tin-nguoi-dung/truy-xuat-chi-tiet-nguoi-dung
- Rate limits, errors: https://docs.zaloplatforms.com/docs/OA/phu-luc/gioi-han-toc-do-api, https://docs.zaloplatforms.com/docs/OA/phu-luc/ma-loi
- ZBS launch, price increase, outdated public table: https://zalo.solutions/news/thong-bao-ra-mat-zbs-template-message-giai-phap-tin-nhan-doanh-nghiep-theo-mau/cp1zx4bq8mzhhszgz0br1ocd, https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli, https://zalo.solutions/business-message/pricing
- ZBS guidelines: https://zalo.solutions/business-message/guidelines/en/intro, https://zalo.solutions/business-message/guidelines/en/huong-dan-tao-zbs-template-message, https://zalo.solutions/business-message/guidelines/en/quy-dinh-chung-khi-kiem-duyet-mau-zbs-template-message, https://zalo.solutions/business-message/guidelines/en/co-che-danh-gia-chat-luong-va-quyen-loi-gui-zbs-template-message, https://zalo.solutions/business-message/guidelines/en/co-che-tinh-gia-cua-mau-tin-nhan-zbs, https://zalo.solutions/business-message/guidelines/en/gui-api
- ZBS quality, terms, errors: https://zalo.solutions/blog/co-che-danh-gia-chat-luong-va-quyen-loi-gui-zns/qsuhj60o4oteiy7rnrf0ohpe, https://zalo.solutions/terms, https://docs.zaloplatforms.com/docs/ZBS/bang-ma-loi
- ZBS Account: https://oa.zalo.me/home/documents/guides/huong-dan-tao-zbs-account, https://oa.zalo.me/home/documents/guides/huong-dan-nap-tien-vao-zbs-account
- Zalo Bot API: https://bot.zapps.me/, https://bot.zapps.me/docs/webhook/
- Fabi member attach: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/tich-diem-bang-so-dien-thoai/
