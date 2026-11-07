# Zalo Mini App platform

As of 2026-11-07 · research consolidated and fact-checked

## Purpose

What the project knows about the Zalo Mini App platform before phases 15–18: what a Mini App is, toolchain, console setup, hosting and deploys, test access, KYB and review, permissions, runtime constraints, backend authentication, payments and costs, for Tracks B and C. Figures corrected by the fact-check pass replace older ones, which are marked outdated. Markers: [high] = primary Zalo page; [medium] = supporter answer, console inspection or inference; [low] = third party.

## What is verified

### What a Mini App is and where it runs

- A web app (HTML, CSS, JavaScript; under 10 MB) running inside the Zalo app's webview behind a JavaScript bridge. Zalo hosts the bundle on its CDN and caches it on the device; no front-end hosting is needed. (docs build 2026-11-05) [high]
- Origin https://h5.zdn.vn in a Secure Context: HTTPS with valid certificates only. LocalStorage, SessionStorage and cookies are unsupported; use Native Storage (5 MB) and pass authentication in headers, ideally your own JWT. Your API must return Access-Control-Allow-Origin with exactly one origin, https://h5.zdn.vn, also on the OPTIONS preflight. [high]

### Toolchain

- zmp-cli: init, login (QR scan or developer token), start, deploy. npm on 2026-11-07: zmp-sdk 2.53.4, zmp-ui 1.11.15-2, zmp-cli 4.0.5. The stack is React, Vite and TypeScript. SDKs below 2.44.0 are unsupported since 15/10/2025. [high]
- GitHub Actions CI/CD is officially documented: passive deploy to Testing through a developer-token helper. Access tokens live 60 minutes; refresh tokens live one month and rotate on each use, so a daily job must refresh them. [high]

### Accounts and console

- A Zalo App (developers.zalo.me) holds one or more Mini Apps and encodes user ids per Zalo App; the registering account must have completed eKYC. The Mini App is created in the console under it; changing name, logo, description or category later needs a support ticket. [high]
- Console roles: Administrator, Developer and test user (Người dùng thử nghiệm); test users are invited by phone number and must accept. [medium]

### Hosting, versions, deploys and test access

- Development builds are overwritten on each deploy; Testing builds are numbered, kept permanently, and only they can be submitted for review and published. Quotas: 300 Development and 60 Testing deploys per 30 days. Size: 10 MB per version, 3 MB per file, ES2015. [high]
- Unpublished builds open only for Administrators, Developers and confirmed test users, who can also call every API without permission approval; other users get error -1403. [high]

### Verification (KYB) and review

- KYB is mandatory since 15/10/2025 before the first version is submitted. Via a verified OA of the same business: 3 working days, irreversible, idByOA then returned for every visitor. Via documents (business or household-business registration certificate, legal representative's ID, brand documents): 3–5 working days. [high]
- Version review: 3 working days excluding weekends and holidays (Censorship Policy §9.1); only Administrators submit; one pending version at a time. [high] "Every feature or UI change needs re-review" is an inference from the version model, not a documented rule. [medium]
- Criteria: name and logo match real features, no third-party redirects, no unapproved monetisation, Zalo Design Guidelines, Zalo identity for login, HTTPS APIs, data-protection compliance (Zalo's policy still cites Decree 13/2023, replaced by Law 91/2025 on 1 January 2026 — see `vietnam-legal-requirements.md`). Username/password screens are allowed only for internal apps hidden from the store and opened by deep link or QR. [high]

### Permissions

- Needing Zalo approval: native storage, camera, Zalo QR scanner, shortcut, save image and others; needing Zalo and the user: location and phone number. [high]
- getPhoneNumber shows a consent dialog and returns a single-use token valid 2 minutes; the server exchanges it at graph.zalo.me/v2.0/me/info with the user's access token, the token and the App Secret, never in the Mini App. [high]
- Fact-check nuances: Zalo's approval of the phone permission is confirmed as part of version review (unclear purpose is refused); the console request (Quản lý quyền) and reported long waits are community reports [medium]. "Only after a user action" is a review criterion, not a technical block; the independent-permission flow needs SDK 2.35.0 or later and one brand per Zalo App [high].
- scanQRCode is documented, but a Zalo supporter said in April 2024 the permission is no longer granted; createCameraContext (scope.camera) with a JavaScript decoder is the fallback. [medium]

### Backend authentication

- getAccessToken returns a token without a prompt; it yields only the user id. The server calls graph.zalo.me/v2.0/me with the token and an appsecret_proof (HMAC-SHA256 with the App Secret, required since 01/01/2024), matches or creates the account and issues its own JWT. [high] The token belongs to the Zalo App, so a backend cannot tell which of its Mini Apps it came from. [medium]

### Notifications, payments, governance

- No native push: notifications are OA messages via the shared "Zalo Mini App" OA, the brand OA via idByOA, or ZBS templates by phone. API sending from the brand OA requires Tăng trưởng or Toàn diện on a verified OA. Tin Tư vấn is free and unlimited within 48 hours of the user's last interaction (from 1/1/2026), otherwise 55 ₫ beyond the allowance. [high]
- Checkout SDK is mandatory for any in-app payment (since April 2024) and covers ZaloPay, MoMo, VNPay, bank transfer and COD; the merchant server signs orders and exposes a callback URL. [high]
- Deploy and publish automation APIs are for solution partners only. The Program Agreement (25/09/2026) requires sensitive APIs only after user action, no closing on refusal, user-data processing and storage within Vietnam, and deletion within 24 hours on shutdown. [high]

## Limits and rules

Area | Limit or rule
---|---
Bundle and deploys | 10 MB per version, 3 MB per file; 300 Development and 60 Testing deploys per 30 days
Review and KYB | 3 working days each; one pending version; KYB before first submission
Runtime | Origin h5.zdn.vn, Secure Context, no LocalStorage/SessionStorage/cookies, single-origin CORS
Identity and permissions | Zalo login; one brand per Zalo App; permissions approved with the version review; refusal must not block
Payments and data | Checkout SDK mandatory; data within Vietnam (clause 5.3.3.b)

## Costs

Item | VND
---|---
Zalo App, Mini App id, hosting/CDN, review, listing, KYB | 0 ₫; no platform fee or revenue share documented [medium]
OA Tiêu chuẩn (no API linking) | 1,000,000 ₫/year, VAT included, list of 01/06/2026
OA Tăng trưởng (API linking, 500 Tin Tư vấn outside 48 h and 4 broadcasts per follower per month) | 2,500,000 ₫/year or 1,400,000 ₫/6 months
OA Toàn diện | 6,000,000 ₫/year or 3,400,000 ₫/6 months
Tin Tư vấn outside 48 h beyond allowance | 55 ₫/message
ZBS Template Message, ex-VAT, since 16/03/2026 | OTP and voucher 400 ₫, payment request and all others 300 ₫; the older 200/300 ₫ schedule (still on the public pricing page) is outdated
Checkout SDK | 0 ₫ from Zalo; ZaloPay fee negotiated, reportedly about 1.0–1.2 % [medium]
Zalo Bot API Basic | 0 ₫ (3 bots, 50 users per bot, 3,000 messages/month)

## What it means for this project

- One Zalo App and one OA per brand (single-brand rule): the tea shop and the coffee shop each get their own. A brand's staff and customer Mini Apps share its Zalo App and user ids; cross-brand customer identity is keyed on the phone number. Zalo App, Mini App and OA ids are per-tenant configuration rows.
- The zalo-auth Edge Function exchanges the access token with appsecret_proof, decodes the phone token when granted, matches a tenant member or customer and mints the Supabase session, which the Mini App keeps in Native Storage and sends in headers; Edge Functions echo the single origin https://h5.zdn.vn.
- The staff app uses Zalo identity plus a tenant allowlist, never a password screen; an internal classification (hidden, opened by deep link or QR) suits staff use.
- The phase 16 pilot runs on a Testing build with the manager as Administrator and staff as test users, before any review.
- Zalo hosts the bundle; GitHub Pages serves the web app only. CI deploys with the developer-token helper plus a daily refresh-token job; Testing deploys are reserved for release candidates, and rules and content stay server-side so most changes need no new version.
- Request phone, native storage and camera permissions in the first Testing submission, with an onboarding screen at "join membership" and a refusal path. Do not depend on scanQRCode: prefer the cashier scanning the customer's member code on the POS, or the camera API with a JavaScript decoder.
- A loyalty-only app needs no Checkout SDK; in-app ordering would make it mandatory.
- API-driven OA messaging needs at least Tăng trưởng per brand OA; the free Zalo Bot API tier is a cheaper candidate for staff alerts, and ZBS at 300–400 ₫ the fallback outside the 48-hour window.
- Clause 5.3.3.b (data within Vietnam) conflicts with the Supabase Singapore region; a decision record is needed before submission.
- Keep the Mini App small (no ECharts, nothing above 3 MB per file). Onboarding a new brand takes about two weeks: eKYC, Zalo App, verified OA, Mini App, KYB, first review.

## Checklist

- [ ] Owner completes eKYC; create one Zalo App per brand; store App Secrets only in Edge Function secrets; verify one OA per brand and buy Tăng trưởng when API messaging starts.
- [ ] Create staff and customer Mini Apps under each Zalo App; submit KYB via the verified OA; add the manager as Administrator and pilot staff as test users.
- [ ] Scaffold apps/zalo-staff and apps/zalo-customer with zmp-cli, zmp-sdk 2.53.4+, zmp-ui, Vite, TypeScript.
- [ ] Implement zalo-auth with appsecret_proof and the phone-token exchange; single-origin CORS; Native Storage and header JWTs.
- [ ] Add a GitHub Actions deploy job, refresh-token rotation and a 10 MB/3 MB bundle check.
- [ ] Design contextual permission UX; request phone, storage and camera in the first Testing submission; prototype QR without scanQRCode; write the data-residency decision record.

## Open questions

- Is scanQRCode still withheld in 2026, or obtainable through Quản lý quyền?
- Does Zalo accept a Singapore-hosted backend under clause 5.3.3.b?
- How many test users, Administrators and Developers can a Mini App have?
- Is food service a conditional industry needing a food-safety certificate for KYB?
- Do the owner's brands already hold verified OAs, and should a staff-only Mini App be submitted as internal with search disabled, or in a separate Zalo App?

## Sources

- https://docs.zaloplatforms.com/docs/MA/intro/intro/what-is-miniapp
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/convert-web-app-to-mini-app
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started
- https://docs.zaloplatforms.com/docs/MA/devtools/cli/deploy
- https://registry.npmjs.org/zmp-sdk
- https://miniapp.zaloplatforms.com/blog/setup-ci-cd-for-mini-app
- https://miniapp.zaloplatforms.com/community/2803533029779252036/
- https://miniapp.zaloplatforms.com/documents/zalo-mini-app-censorship-policy/
- https://docs.zaloplatforms.com/docs/MA/intro/censorship-overview
- https://miniforbusiness.zalo.me/blog/zalo-mini-app-trien-khai-co-che-xac-thuc-moi-tu-15-10-2025
- https://miniapp.zaloplatforms.com/blog/thong-bao-huong-dan-xac-thuc-mini-app-qua-zalo-oa/
- https://miniapp.zaloplatforms.com/documents/zalo-mini-app-developer-program-agreement
- https://docs.zaloplatforms.com/docs/MA/intro/request-permission
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getAccessToken
- https://miniapp.zaloplatforms.com/blog/thong-bao-cap-nhat-chinh-sach-nen-tang-zalo-mini-app
- https://docs.zaloplatforms.com/docs/MA/intro/best-practices/authen-user
- https://miniapp.zaloplatforms.com/community/7521689705794070478/
- https://miniapp.zaloplatforms.com/community/787859935950080067/
- https://miniapp.zaloplatforms.com/community/4678184961471234368/
- https://docs.zaloplatforms.com/docs/OA/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan
- https://miniapp.zaloplatforms.com/blog/thong-bao-chinh-sach-checkout-sdk
- https://docs.zaloplatforms.com/docs/MA/openApis/intro
- https://miniapp.zaloplatforms.com/blog/thong-bao-cap-nhat-phien-ban-moi-cho-zalo-mini-app-sdk
- https://miniforbusiness.zalo.me/
- https://zalo.solutions/oa/pricing
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalopay.vn/quy-dinh/bieu-phi-su-dung-dich-vu-trung-gian-thanh-toan-zalopay
- https://bot.zapps.me/
