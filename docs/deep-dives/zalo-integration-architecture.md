# Zalo integration architecture: two Mini Apps, one OA, a Supabase backend

Deep dive · as of 2026-11-07 · supports roadmap phases 15–19

## Purpose

This document fixes the technical shape of the Zalo side of FNB Manager: server-side verification of Mini App users, phone-token decoding, mapping Zalo identities to Supabase Auth sessions with role claims, OA webhook and token handling, the message outbox, Edge Function tiers, CORS, QR deep links, CI deployment, templates and data residency. It lives in the public repository and carries no shop identifiers. Where a fact-check corrected a figure, the corrected one is used and the older one is marked outdated.

## What is verified

Confidence: **H** = stated on an official Zalo or Supabase page; **M** = official but ambiguous, or a reputable third party; **L** = inference or unverified.

### Mini App identity (as of 2026-11-05)

- getAccessToken needs no consent since SDK 2.35.0 but then exposes only the user id. **H**
- Server verification: GET graph.zalo.me/v2.0/me with headers access_token and `appsecret_proof`, an HMAC-SHA256 of the token keyed with the Zalo App secret, mandatory since 01/01/2024. The returned id is unique per user **per Zalo App**. **H**
- getUserInfo adds `idByOA` only when the Mini App is OA-verified or the user follows the linked OA. **H**
- The token's lifetime is undocumented; Social API user tokens live 1 hour. **M**

### Phone number (as of 2026-11-05)

- getPhoneNumber yields a single-use token that expires after 2 minutes. The server calls GET graph.zalo.me/v2.0/me/info with headers access_token, code and secret_key; error 119 means already used. **H**
- The permission needs Zalo approval (reviewed with the next version) plus user consent; unclear consent flows are rejected under policy 3.3.4. **H**

### Runtime and hosting (as of 2026-11-05, fact-check group 2)

- Origin https://h5.zdn.vn, Secure Context; LocalStorage, SessionStorage and cookies unsupported; use an Authorization header and Native Storage. **H**
- Access-Control-Allow-Origin must name https://h5.zdn.vn, also on OPTIONS, and may hold only **one** origin, so the server echoes the request origin (some devices send zbrowser://h5.zdn.vn). **H**
- Bundle 10 MB per version, 3 MB per file. **H**
- API Domain configuration declares HTTPS domains; docs frame it as monitoring, community says undeclared domains fail. **M**
- `zmp deploy` uploads the bundle (Development overwritten, Testing numbered); `zmp login` accepts a pasted developer token for CI. zmp-sdk 2.53.4, zmp-cli 4.0.5. **H**

### OA tokens, webhooks, rate limits (as of 2026-11-07, group 1)

- OAuth v4: access token 25 hours; refresh token 3 months and **single-use**, a refresh invalidating the old pair; PKCE required. **H**
- Webhook URL must be an HTTPS domain answered with HTTP 200 within 2 seconds. Zalo retries **only** on connection failure (30 s to 1 h, five attempts), then disables the webhook. **H**
- X-ZEvent-Signature = sha256(appId + data + timeStamp + OA secret key), keyed with the **OA secret key**, not the App secret. The exact bytes of `data` are unspecified; community reports mismatches. **H** formula, **M** bytes.
- Limits: 4,000 requests/minute per app; per OA 100/min on Tăng trưởng, 2,000/min on Toàn diện; error -32. **H**
- Open API linking requires a verified OA on Tăng trưởng or Toàn diện per the FAQ, although the table shows "1 authorised app" for Cơ bản. **H** with ambiguity.

### Messaging windows and prices (as of 2026-11-07, groups 3 and 4)

- Tin Tư vấn are free and unlimited within 48 hours of a user interaction since 01/01/2026, possible up to 7 days, 55 VND beyond the package allowance. Qualifying interactions: follow, message, call, profile buttons, oa.query menu. Opening a Mini App does **not** qualify. **H**
- ZBS Template Messages cost 300 VND for most templates and 400 VND for OTP and voucher templates (ex-VAT) since 16/03/2026; the 200/300 VND figures still on the public pricing page are **outdated**. Tag 3 promotional sends: 1 per user per day, 30 per month. **H**
- Zalo Bot Basic plan is free (3 bots, 50 users per bot, 3,000 messages/month), webhook authenticated by X-Bot-Api-Secret-Token. **H**

### Supabase (as of 2026-11-07)

- Edge Functions: 256 MB memory; wall clock 150 s Free, 400 s paid; 2 s CPU per request; 100 functions and 100 secrets. **H**
- Free: 500,000 invocations/month, 500 MB database, **paused after 1 week of inactivity**. Pro: US$25/month, 2 million invocations, no pausing. **H**
- EdgeRuntime.waitUntil continues work after the response is sent. **H**
- Functions verify the Supabase JWT by default; webhooks need verify_jwt off and the provider signature checked inside. **H**
- Third-party auth accepts only asymmetric OIDC JWTs with a discovery URL, and signing keys cannot be exported, so a Zalo login must become a session through Supabase Auth itself. The Custom Access Token hook adds claims. **H**
- Singapore is an available region; Vietnam is not. **H**

### QR and deep links (as of 2026-11-05)

- Format https://zalo.me/s/{miniAppId}/?key=value; query parameters are the reliable carrier. getRouteParams reads them on load; the OpenApp event delivers them to a backgrounded app. **H**
- scanQRCode exists, but a 2024 support answer says the permission is rarely granted. **M**
- Scanning an OA-verified F&B Mini App's QR with the Zalo camera grants OA-message benefits. **H**

### Templates and residency

- Zalo-MiniApp on GitHub: zaui-coffee (React, zmp-ui, mock JSON, membership screen) and zmp-blank-templates, licensed for non-commercial evaluation only; no Mini App plus Supabase example exists (as of 2026-10-29). **H**
- The synthesis cites Developer Program Agreement 5.3.3.b as requiring processing and storage within Vietnam; no fact-check re-read the clause. **L**

## Limits and rules

1. Phone tokens live 2 minutes and burn on first use: forward immediately, decode exactly once.
2. The App secret and OA secret key stay in Edge Function secrets; the bundle is public.
3. Exactly one process rotates the OA refresh token; a concurrent refresh logs the app out.
4. Webhooks acknowledge first (200 within 2 s), verify on the raw body, deduplicate on event id, then process via waitUntil. Slow or non-200 answers are **not** retried.
5. CORS reflects one origin per response, including preflight.
6. API traffic needs Tăng trưởng; on expiry the OA drops to Cơ bản and webhooks stop silently (error -224).
7. No LocalStorage: supabase-js needs a Native Storage or in-memory adapter.
8. Phone and camera permissions ride on version reviews (3 working days); verification precedes the first review.
9. The Mini App Open API needs a server IP allow-list that Edge Functions and GitHub Actions cannot offer.

## Costs

| Item | Amount (VND) | Unit |
|---|---|---|
| OA Tăng trưởng (Open API, 100 req/min, 500 out-of-window Tin Tư vấn) | 2,500,000/year or 1,400,000/6 months, incl. 10% VAT | per OA |
| OA Toàn diện | 6,000,000/year or 3,400,000/6 months, incl. VAT | per OA |
| Tin Tư vấn outside 48 h, beyond allowance | 55 | per message |
| ZBS Template Message (OTP and voucher: 400) | 300, ex-VAT | per delivered message |
| Zalo Bot Basic; Mini App hosting and review | 0 | per month |
| Supabase Free / Pro | 0 / about 650,000 (US$25, approximate) | per month |

## What it means for this project

**Identity bridge.** One Zalo App per brand holds both Mini Apps so the per-app user id is shared. The `zalo-auth` Edge Function verifies the token with appsecret_proof, upserts the Zalo id on `staff_profiles` or `customers`, and decodes a phone token only when a flow asks for it. The phone in international format is the join key to synced iPOS invoices.

**Session minting.** Since Supabase cannot trust an externally signed token, the bridge creates or finds an Auth user through the admin API and returns a genuine session; the Custom Access Token hook adds tenant, store scope and role so RLS reads claims instead of joining membership tables. Staff pair with a manager-issued code, never a password.

**Data path.** Mini Apps call PostgREST directly with the Authorization header and a Native Storage adapter; anything needing a secret stays in Edge Functions.

**OA token job.** The token pair lives in one service-role-only row; a GitHub Actions job refreshes about every 12 hours under a row lock and alerts on -216, -220 and -224, leaving margin for the cron delay measured by the phase 1 probe.

**Webhook receiver.** `zalo-oa-webhook` runs with JWT verification off, stores the raw event, verifies the signature with the OA secret key, acknowledges, then processes. The first live events run in observe mode before the check fails closed.

**Outbox and quota.** Every outbound message passes through an outbox: in-app first; Tin Tư vấn only when the quota endpoint shows an interaction within 48 hours; ZBS only for configured events at 300–400 VND; Tag 3 caps enforced locally; Zalo Bot as the free staff fallback; 100 requests per minute per OA respected.

**Tier.** The 30-minute sync keeps a Free project awake during the pilot, but a paused project drops webhooks, which Zalo then disables. Move to Pro before the customer app is published.

**QR.** Standees and receipts carry https://zalo.me/s/{miniAppId}/?store={store-code}&src=counter; the app reads getRouteParams on load and OpenApp on warm start. Store codes are configuration.

**CI.** `zmp deploy` runs in GitHub Actions with the developer token as a secret: Development builds on push, Testing builds on tag; one codebase serves both brands with theme and copy from configuration.

**Residency.** Until clause 5.3.3 is read, store the minimum Zalo-derived data with explicit consent and keep a Vietnam-hosted Postgres as the fallback.

## Checklist

- [ ] One Zalo App per brand, both Mini Apps under it; secrets in Edge Function secrets.
- [ ] `zalo-auth`: appsecret_proof check, phone decode within 2 minutes, Auth user upsert, claims via the hook.
- [ ] Native Storage adapter for supabase-js; lint that no LocalStorage call remains.
- [ ] Single-origin CORS reflection for both h5.zdn.vn origins on every function, including OPTIONS.
- [ ] Declare the Supabase domain in the API Domain list; test on a real device.
- [ ] `zalo-oa-webhook`: verify_jwt off, raw-body log, signature check, 200 within 2 s, waitUntil, idempotency.
- [ ] OA token pair in one locked row; refresh every 12 hours; alerts on -216, -220, -224.
- [ ] Outbox with quota checks, 300/400 VND ZBS budget, Zalo Bot fallback.
- [ ] `zmp deploy` in CI with a token secret; bundles under 10 MB.
- [ ] Request phone (customer app) and camera (staff app) permissions in the first Testing submission.
- [ ] Per-store QR deep links with query parameters; Supabase Pro decision before launch.
- [ ] Read Developer Program Agreement 5.3.3 and record the residency decision in `docs/decisions.md`.

## Open questions

1. Lifetime of the Mini App access token: re-fetch before every server call?
2. Does Zalo block fetch to undeclared API domains, or is the list monitoring only?
3. Exact byte serialisation of `data` and the timestamp source in X-ZEvent-Signature.
4. Can a Cơ bản OA authorise one app for webhooks, or is Tăng trưởng the true minimum?
5. Does Supabase accept an imported signing key, and do anonymous users count toward MAU?
6. Is scanQRCode obtainable for an F&B loyalty app, or must the staff app decode QR codes itself?
7. Does the Vietnam processing clause accept a Singapore-hosted database with consent?
8. Can a Zalo Bot message staff before they message it, and what are the 429 thresholds?
9. Is one household-business registration enough to verify one OA and two Mini Apps?

## Sources

- https://docs.zaloplatforms.com/docs/MA/intro/best-practices/authen-user
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getAccessToken
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getUserInfo
- https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber
- https://miniapp.zaloplatforms.com/blog/thong-bao-thay-doi-luong-truy-xuat-thong-tin-nguoi-dung-tren-zalo-mini-app
- https://docs.zaloplatforms.com/docs/MA/intro/request-permission
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues
- https://docs.zaloplatforms.com/docs/MA/intro/getting-started/convert-web-app-to-mini-app
- https://docs.zaloplatforms.com/docs/MA/intro/best-practices/call-restful-api
- https://docs.zaloplatforms.com/docs/MA/openApis/partner/apis/apiDomain
- https://docs.zaloplatforms.com/docs/MA/devtools/cli/deploy
- https://docs.zaloplatforms.com/docs/MA/intro/intro/entry-point-access
- https://docs.zaloplatforms.com/docs/MA/api/events
- https://docs.zaloplatforms.com/docs/MA/openApis/partner/apis/qrCodeShortLink
- https://docs.zaloplatforms.com/docs/MA/tin-mini-app/send-message-oa-to-user
- https://docs.zaloplatforms.com/docs/MA/openApis/open/intergration-process
- https://docs.zaloplatforms.com/docs/OA/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new
- https://docs.zaloplatforms.com/docs/OA/webhook/tong-quan
- https://docs.zaloplatforms.com/docs/OA/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan
- https://docs.zaloplatforms.com/docs/OA/phu-luc/gioi-han-toc-do-api
- https://docs.zaloplatforms.com/docs/OA/phu-luc/ma-loi
- https://docs.zaloplatforms.com/docs/OA/phu-luc/cac-tuong-tac-cua-nguoi-dung-voi-oa
- https://docs.zaloplatforms.com/docs/OA/tin-nhan/quan-ly-tin-nhan/kiem-tra-han-muc-gui-tin-nhan
- https://zalo.solutions/oa/pricing
- https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- https://zalo.solutions/blog/co-che-danh-gia-chat-luong-va-quyen-loi-gui-zns/qsuhj60o4oteiy7rnrf0ohpe
- https://bot.zapps.me/
- https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/pricing
- https://supabase.com/blog/persistent-storage-for-faster-edge-functions
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/auth/third-party/overview
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- https://supabase.com/docs/guides/platform/regions
- https://github.com/orgs/Zalo-MiniApp/repositories
- https://registry.npmjs.org/zmp-sdk/latest
