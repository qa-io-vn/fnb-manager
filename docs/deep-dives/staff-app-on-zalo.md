# Staff app on Zalo

Deep dive for Track B of the roadmap (phases 15–16): an internal Zalo Mini App for one manager and about ten staff across the owner's two shops. It records what Zalo and the Vietnamese market verifiably allow as of November 2026 and turns that into design decisions, the operations worth digitising, what to leave to iPOS HRM, and the recommended MVP. Facts come from the research and synthesis files, cross-checked against the fact-check verdicts; corrected figures replace outdated ones and say so. Confidence: [high] primary Zalo or vendor page; [medium] official community answer or reseller page.

## What is verified

### Distribution and classification

- Only numbered Testing builds in Quản lý phiên bản can be submitted for review and released. (2026-11-05, high)
- Owner verification (KYB) is mandatory since 15/10/2025: via a verified OA (about 3 working days) or documents (3–5 working days); each version review takes up to 3 working days. (2026-11-05, high)
- "Every UI change needs re-review" is an inference from the version model, not a documented rule; plan for it. (medium)
- Unpublished apps are usable by people holding Admin, Developer or Tester roles. (2024-12, Supporter answer, medium)
- Internal classification is requested by a reviewer note in "Bước 3. Mô tả version"; an approved Internal app opens only by deep link or QR and is hidden from search and the Mini App Store. (2024-07, Supporter answer, medium; a support practice, not a documented setting)
- The Censorship Policy allows internal apps to show a login screen if it explains why first. A released app needs at least 10 visits per month; names may not contain "App" or "Zalo"; logos with QR codes or phone numbers are rejected; login-gated apps must give the reviewer test credentials. (2026-11-07, high)

### Identity and sign-in

- From SDK 2.35.0, getAccessToken returns a token without a consent dialog; it yields only the user id, stable across all Mini Apps under the same Zalo App. (2026-11-05, high)
- Phone number: a one-time token valid 2 minutes, exchanged server-side; needs Zalo approval plus user consent, and test-stage apps get no private-data access, so a Tester pilot must identify staff by Zalo user id. (2026-11-05, high)
- Account linking must be a separate step after login; no non-Zalo social logins. (DPA 2026-09-25, high)
- Mini Apps run on https://h5.zdn.vn without LocalStorage or cookies; sessions go in Native Storage with a JWT header; the API must return exactly one Access-Control-Allow-Origin. (2026-11-05, high)
- Precedent: KiotViet Nhân viên opens from a link or QR; a new device needs manager approval or a 5-minute confirmation code from the staff record. (2026-07, high)

### Push channels

- Zalo Bot, Basic plan: 3 bots, 50 users per bot, 3,000 messages per month; Pro at 129,000 ₫/month is "Sắp ra mắt"; group support is still in internal testing. (2026-11-07, high)
- OA GMF group: fully manageable through the Open API, including sending text, images, files and mentions; OA-to-group messages free until 31/12/2026, member messages always free; one GMF-100 included in Tăng trưởng; groups are disbanded 45 days after an unrenewed expiry. (2026-11-07, high)
- OA Tin Tư vấn via API: only to users who interacted with the OA within 7 days; from 1/1/2026 free and unlimited inside 48 h of the last interaction, then 55 ₫ each beyond the package allowance. The 2023 rule of 8 free messages per window is outdated. (effective 2026-01-01, high)
- ZBS Template Messages to staff are allowed when marked "Thông báo nội bộ" (employees count as a prior relationship per reseller guidance); no links or phone numbers in the body; approval 2–3 working days; sending 06:00–22:00. (2026-10, high / medium)
- Any Open API use requires a verified OA on Tăng trưởng or Toàn diện; the comparison table lists "1 authorised app" even for Cơ bản, but the FAQ wording is the operative rule. (2026-11-07, high)

### What Vietnamese products already do

- iPOS HRM: Wi-Fi and Face ID attendance, shift registration with approval, leave and swap requests, payroll and payslips, tasks with optional photo proof, internal news; sales points synced from Fabi. (2026, high)
- Tanca, ACheckin and 1Office F&B cover attendance, rostering, approvals and payroll; none mention a Zalo Mini App or OA integration; market price 20,000–70,000 ₫ per employee per month. (2025-12, medium)
- iPOS's published shift checklist (open the shift in the POS, hygiene, incidents, wasted-food tally, handover, close the shift) is a ready content template. (2022, high)
- Alternatives: Telegram is free but Vietnam's May 2025 blocking order was never publicly withdrawn; web push cannot reach the Zalo webview; SMS brandname costs about 750 ₫ per message plus registration. (medium)

## Limits and rules

- Verification chain: OA verification (registration certificate, legal representative's ID, dossier within 14 days of creating the OA, 2–3 working days) → Mini App verification → first review; budget 2–3 calendar weeks. Name, logo and category changes afterwards need a support ticket.
- Zalo Bot: about 100 messages per day across bots; whether a bot can message a user who never messaged it is unconfirmed, so each staff member must message the bot once.
- OA 1:1 messages: the 7-day gate and 48-hour free window apply per staff member; whether a GMF post reliably reopens the window is unconfirmed, and the GMF fee after 31/12/2026 is unpublished.
- DPA data rules: consent before collecting personal data (Zalo's text cites Decree 13/2023, which the Personal Data Protection Law 91/2025 replaced on 1 January 2026 — see `vietnam-legal-requirements.md`), storage and processing within Vietnam, logs kept at least 12 months.

## Costs

| Item | Cost (VND) |
|---|---|
| Mini App hosting, review, publishing, verification | 0 ₫ |
| OA Cơ bản (no API, no GMF, no broadcast quota) | 0 ₫ |
| OA Tăng trưởng (API, 1 GMF-100, 500 out-of-window Tin Tư vấn per month) | 2,500,000 ₫/year or 1,400,000 ₫/6 months, VAT incl. (≈208,000 ₫/month), per OA |
| Tin Tư vấn outside 48 h, beyond allowance | 55 ₫ per message |
| OA message into its GMF group | 0 ₫ until 31/12/2026 |
| Extra GMF-10 / GMF-50 / GMF-100 group | 25,000 / 55,000 / 75,000 ₫ per month |
| Zalo Bot Basic / Pro | 0 ₫ / 129,000 ₫ per month (Pro not yet purchasable) |
| ZBS "Thông báo nội bộ" (custom template) | 300 ₫ per delivered message ex-VAT since 16/03/2026; the 200 ₫ figure still on the public pricing page is outdated. Voucher and OTP 400 ₫ |
| iPOS HRM, HR 10 plan | 150,000 ₫ per month (HR 4 80,000; HR 20 200,000) |

For ten staff, alerts through the Zalo Bot and the included GMF group cost nothing; the Tăng trưởng package is shared with Track C.

## What it means for this project

1. **Pilot unpublished, publish Internal.** Build with the manager and staff as Testers (no review per iteration), then submit one Testing version with a reviewer note asking for Internal classification plus test credentials; distribute by QR and deep link.
2. **Sign-in by Zalo identity plus pairing code.** An Edge Function verifies the Zalo user id and issues a Supabase session with role and store claims enforced by RLS. The first device is paired with a 6-digit manager-issued code valid 10 minutes. Phone linking is optional and separate, never a login requirement, so the staff app needs no phone permission and works in test stage. Sessions live in Native Storage.
3. **Roles and store scope** remain rows in tenant_members; whether staff may see revenue is the owner's call.
4. **Channel order:** in-app → GMF group (free, API) → Zalo Bot 1:1 (free) → OA Tin Tư vấn (free inside 48 h, 55 ₫ after) → ZBS Thông báo nội bộ (300 ₫) only when someone must be reached who has not interacted recently. Deep-link buttons keep the window open. The phase-14 Notifier gains Zalo Bot, GMF and OA channels and falls back when the OA window is closed without sending a paid message.
5. **Operational content is data.** Checklist templates, announcements and thresholds are Supabase rows, so routine changes need no new version (configuration over code).
6. **Digitise where our data gives an edge:** opening and closing checklists with photo proof in Supabase Storage; cash count at shift close against the synced Fabi drawer total, feeding Ca & két tiền; handover notes; incident and stock-out reports; announcements with Đã đọc receipts; a manager approval queue. **Leave to iPOS HRM:** attendance, rostering, leave and shift-swap requests, payroll. Phase 16 lists leave, shift-swap and a schedule view; defer them unless the owner declines HRM.
7. **Shared build with Track C.** The staff app later becomes the loyalty counter tool (check-in, redemption verification), so request the camera permission in the first submission and keep both Mini Apps under one Zalo App per brand.
8. **Data residency** is the main compliance risk: store only Zalo id, display name, role and store, show consent text, and get a legal read before publishing.

## Checklist

- Owner: confirm whether the two shops are one legal entity; gather the registration certificate and representative ID; create and verify the OA within 14 days; buy Tăng trưởng; create the Zalo App and Staff Mini App; add the developer and all staff as Testers.
- Owner: staff list with role and store; revenue visibility decision; checklist items and cash-variance threshold; individual Fabi cashier logins; every staff member follows the OA, joins the GMF group and messages the Zalo Bot once.
- Dev: Edge Functions for session exchange and the Bot and OA webhooks with single-origin CORS; pairing-code flow and onboarding screen; roster admin page; RLS tests for role × store.
- Dev: checklists, cash counts, handover, incidents, announcements and read receipts as tenant rows; photo buckets per tenant; outbox with channel fallback; alerts on Bot quota and OA package expiry.
- Dev: first Testing submission with camera permission, Internal note and test credentials; weekly release batches afterwards.
- Pilot: one full day across three shifts at one shop, then the one-week phase-16 acceptance; runbook for OA package renewal, GMF expiry, Bot message count and review cadence.

## Open questions

- Is the Internal classification still granted in 2026 for a login-gated staff app, and do server-driven content changes count as feature changes requiring re-review?
- Does Supabase in Singapore satisfy the DPA clause on storage and processing within Vietnam?
- Can a Zalo Bot message a staff member before they message it, and when do group support and the Pro plan leave Beta?
- Does a GMF post reliably reopen the 48-hour window, and what will OA-to-GMF messages cost after 31/12/2026?
- Are the two shops one legal entity (one OA) or two, and does iPOS HRM's photo-proof task feature cover checklists well enough to skip building them?

## Sources

- https://docs.zaloplatforms.com/docs/MA/devtools/cli/deploy
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started
- https://miniapp.zaloplatforms.com/documents/zalo-mini-app-developer-program-agreement
- https://miniapp.zaloplatforms.com/documents/zalo-mini-app-developer-program-agreement/mini-app-verification/
- https://miniapp.zaloplatforms.com/documents/zalo-mini-app-censorship-policy
- https://miniapp.zaloplatforms.com/community/3453187171715984960/xet-duyet-mini-app
- https://miniapp.zaloplatforms.com/community/8677443552320518592/zalopay-requires-a-zalo-mini-that-has-already-passed-the-review-process-for-payment-integration-we-are-facing-obstacles-in-carrying-out-the-payment-testing-and-integration
- https://miniapp.zaloplatforms.com/community/3918755029356460494/thong-tin-ve-viec-cap-quyen-cho-app-o-trang-thai-developer
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getAccessToken
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/convert-web-app-to-mini-app
- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/hotel-nhan-vien/zalo-mini-app-kiotviet-nhan-vien/
- https://bot.zapps.me/
- https://bot.zapps.me/docs/webhook/
- https://bot.zapps.me/docs/build-bot-interaction-with-group/
- https://oa.zalo.me/home/documents/guides/quan-ly-nhom-gmf_1954166378348758227
- https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/tin-nhan/mention_uid
- https://oa.zalo.me/home/documents/guides/tong-quan-cac-loai-tin-nhan-tren-zalo-official-account-_3651713298729094511
- https://docs.zaloplatforms.com/docs/OA/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan
- https://zalo.solutions/oa/pricing
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalo.solutions/business-message/guidelines/quy-dinh-chung-khi-kiem-duyet-mau-zbs-template-message
- https://helpcenter.esms.vn/thong-tin-dich-vu/tra-cuu-thong-tin-ho-so/zalo/zalo-notification-service-zns/quy-dinh-gui-tin-nhan-zns
- https://oa.zalo.me/home/documents/guides/huong-dan-xac-thuc_70
- https://ipos.vn/ipos-hrm/
- https://ipos.vn/checklist-cong-viec-phuc-vu-nha-hang-theo-ca/
- https://fnbvietnam.vn/top-5-phan-mem-quan-ly-nhan-su/
- https://vietnamspot.ru/en/blog/vietnam-telegram-block
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://tingting.im/bang-gia-dich-vu-sms-brandname/
