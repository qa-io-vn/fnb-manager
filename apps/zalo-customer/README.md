# Customer Mini App (`@fnb/zalo-customer`)

Purpose and audience: the customer Zalo Mini App of track C, one build per brand from configuration and listed in Zalo's search (`mini_apps.browsable` true). For developers of the customer screens, for the backend work behind the loyalty functions it calls, and for reviewers of Zalo's design rules. Phase 13 (#208) built the scaffold; phase 18a (#261 to #265) adds the loyalty app: browse first, join with the phone number after a purpose screen, a wallet with stamps and points, a dynamic member code and receipt claims; phase 18b (#272) adds the voucher wallet: rewards redeemed with stamps or points, a single-use code with its countdown, "Đã dùng" after the till and "Đã hoàn lại" for an unused hold. It runs on its demo data, and with `pnpm zalo:dev --app customer --live` on the customer functions of the local stack (proven end to end in `e2e/loyalty-local.spec.ts`). Nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-19 (live functions, closed joining, voucher wallet, the server's answers for closed joining and returned holds, a synthetic staff login)

## What it shows

Three bottom tabs: **Trang chủ**, **Thẻ thành viên** and **Tài khoản** ("Home", "Member card", "Account"). Nothing asks for a permission at launch: the app signs in with the Zalo user id alone (a visitor session) and everything below works without a phone number.

- **Trang chủ** (`src/home/`): the programme (name, summary, reward, stamp and point rules, welcome stamps), "Tham gia thành viên" as the one primary action (or "Xem thẻ thành viên" for a member) and "Nhận điểm từ hóa đơn"; the stores with today's opening hours; the menu highlights, each marked "Xem tại quầy" and never with a price; "Chính sách bảo mật" and "Điều khoản sử dụng".
- **When joining is closed** (`src/home/join-actions.tsx`, `joinBlock` in `src/home/model.ts`): without an open programme (none at all, `paused`, `ended`, or a period that does not cover today) or without a published privacy notice (`legal.policy_version` null), browsing stays usable and "Tham gia thành viên" and "Nhận điểm từ hóa đơn" are disabled everywhere (home, store page, card tab, account tab) with one sentence saying why, in Vietnamese and English; with no programme at all the home shows "Chương trình thành viên" and "Quán chưa mở chương trình thành viên." The join screen opened anyway says "Chưa tham gia được" with the reason and never asks for the phone. A join refused with `no_programme`, or one that fails while the programme closed, reloads the home and words it.
- **Store page** (`/cua-hang/:code`): address, the week's opening hours with today in bold, the menu served there, and the member code or joining. A store link `?store=<code>&src=<qr|standee|receipt>` opens it: read with `getRouteParams` on load and from the `OpenApp` event when Zalo brings the app back with a new link (`src/data/store-link.tsx`). The linked or last opened store is the one the member code and the claim form start with.
- **Privacy and Terms** (`src/legal/`): in-app popups titled "Chính sách bảo mật Mini App <Tên>" and "Điều khoản sử dụng Mini App <Tên>" (the name is the Mini App title from `app-config.json`), naming the legal entity and the version and date of the tenant's published text. Links in the text render as words.
- **Joining** (`src/join/`), from "Tham gia thành viên" or, for a visitor, "Nhận điểm từ hóa đơn" (the only two actions that lead to the phone number):
  1. a purpose screen: what is collected (the Zalo phone number, display name and user id, and purchases), why, how long (the programme's retention), who processes it, a link to the Privacy popup, "Tiếp tục" or "Để sau";
  2. a consent screen: the loyalty consent (required, unticked), a separate marketing switch (never pre-ticked), the policy version; "Tham gia" stays disabled until the loyalty consent is ticked;
  3. "Tham gia" asks Zalo for the phone number (`getPhoneNumber`) and sends its token with both consents, the policy version, the screen version (`join-1`), the store and the time the consent screen was shown to `zalo-session` in one request;
  4. a welcome page with the welcome stamps and the follow-OA step ("Quan tâm", `followOA` with the brand's Official Account), then the card, or the claim form when the person came to claim.

  Declining the purpose, cancelling the consent or refusing Zalo's phone prompt returns to Trang chủ with a short explanation; nothing is sent or stored, and browsing stays usable. An expired phone token asks again; a changed policy reloads the text.
- **Thẻ thành viên** (`src/wallet/`): the member card the law asks for (programme name, display name, masked phone, member since, number of purchases), a stamps ring per card (confirmed, then pending stamps dashed), points with the pending and the next expiry, the tier and the points to the next one, the receipts sent with their state, and the history with "Đang chờ xác nhận", "Đã xác nhận" or "Đã hoàn lại" and how each earn was matched (phone number, member code, receipt, voucher, welcome). A visitor sees the programme and "Tham gia thành viên".
- **Mã thành viên** (`/ma-thanh-vien`): a store picker (the linked store preselected), the QR code (`uqr`) and the 6-digit code, "Mã đổi sau {n} giây" and "Dùng được đến HH:mm:ss". The code is fetched again at its refresh time (60 seconds) and lasts 2 minutes; when it cannot be refreshed the old one stays until it expires, then "Mã đã hết hạn" with "Lấy mã mới".
- **Nhận điểm từ hóa đơn** (`/nhan-diem`, `src/claim/`): store, receipt number, the total (numeric keypad, grouped digits) and the date (today, yesterday or the day before), the claims left today; problems show after the first try; the result is pending ("Đang chờ xác nhận"), matched or refused with its reason; no more than 3 a day.
- **Đổi quà** (`/doi-qua`, `src/wallet/vouchers.tsx`, reached from Thẻ thành viên): the store picker (the linked store preselected) and the rewards valid there, each described by its kind and items ("Tặng …", "Giảm …%", "Nâng cỡ miễn phí", "Giảm trực tiếp trên hóa đơn") and never by an amount, with its cost in stamps or points, the stores it is limited to, and either "Bạn đủ dấu và điểm để đổi quà này." or why not ("Cần thêm 2 dấu để đổi.", already held, limit reached, the store's rail not ready, a suspended card). "Đổi quà" opens a confirmation with the cost, the store and the hold ("Mã được giữ cho bạn trong 24 giờ …"); "Xác nhận đổi" calls `customer_redeem` and opens the code; a refusal is worded per reason. A held reward offers "Xem mã" instead.
- **Ví voucher** (`/vi-voucher`, `/voucher/:id`): the redemptions, held first: "Đang giữ" with the time left, "Hết thời gian giữ" (the stamps go back tonight), "Đã dùng" with the time, "Đã hoàn lại" with what went back, "Đã hủy". A held code shows its QR (`fnb-redeem:1:<code>`), the code, "Còn HH:MM:SS", "Dùng được đến …", the instruction to show it to the cashier and, once staff checked it, a note; it reloads when the app returns to the foreground, every 30 seconds while held and when the hold ends.
- **Tài khoản** (`src/settings/`): the member's name and masked phone; "Dừng nhận tin" with a confirmation (stops promotions at once, stamps and points unchanged); "Rời chương trình" with a confirmation, which opens a deletion request for the owner (#252); Privacy and Terms. In a Development build only, the phone-consent probe of phase 13 sits at the bottom (`src/probe/`, marker `phone-probe`, refused in a Testing build).
- The session lives in Native Storage under `fnb.customer-session` (`@fnb/zalo-mini`); no LocalStorage, SessionStorage, IndexedDB or cookie. The language follows Zalo's.

## The loyalty contract

The wire shapes live in one module, `@fnb/zalo-mini/loyalty` (`packages/zalo-mini/src/loyalty/contract.ts`): the function names (`CUSTOMER_FUNCTIONS`), the argument builders, a reader per answer that refuses anything malformed, and the constants (`MEMBER_CODE_REFRESH_SECONDS` 60, `MEMBER_CODE_VALID_SECONDS` 120, `MAX_CLAIMS_PER_DAY` 3, `CLAIM_WINDOW_DAYS` 3, the code, store, receipt and version patterns). `createRestLoyaltyClient(rest)` calls them through the Data API with the customer's session. Snake case is the wire; the readers return camel case.

### The customer session: `zalo-session` with `kind: "customer"`

`POST /functions/v1/zalo-session` with the publishable key:

```json
{ "kind": "customer", "access_token": "<Zalo access token>", "brand": "brand-1" }
```

and, to join, the same with:

```json
"join": {
  "phone_token": "<getPhoneNumber token>",
  "loyalty_consent": true,
  "marketing_consent": false,
  "policy_version": "privacy-1",
  "screen_version": "join-1",
  "store": "mau-1",
  "shown_at": "2026-11-19T03:00:00.000Z"
}
```

The answer (200):

```json
{
  "status": "customer",
  "access_token": "…", "refresh_token": "…", "expires_at": 1795000000,
  "customer": { "tenant_id": "<uuid>", "customer_id": "<uuid or null>", "display_name": "<Zalo name or null>" },
  "joined": { "membership_id": "<uuid>", "welcome_stamps": 1, "already_member": false }
}
```

`joined` comes only with a join. Refusals are `{error, request_id}`: 400 `invalid_kind`, `invalid_join`, `invalid_phone_token`, `loyalty_consent_required`; 401 `zalo_token_refused`; 404 `unknown_store`; 409 `policy_outdated`, `phone_token_used`, `phone_in_use`, `no_programme` (no open programme to join; nothing is written); 422 `phone_token_refused` (an expired or unknown token); 502 `zalo_unavailable`; 503 `backend_unavailable`.

What the function does (`supabase/functions/zalo-session/customer.ts`): checks the Zalo token with the graph's `me`; calls `zalo_customer_sign_in`; on `login_needed` creates a login `customer-<uuid>@zalo-customer.invalid` through the Auth admin API with `app_metadata` `{kind: "customer", tenant_id, customer_id: null}` and calls again with its id; for a join, exchanges the phone token once with the graph (`me/info`, the same exchange as `zalo-phone`), normalises it to E.164 and calls `customer_join`; then sets `app_metadata` to `{kind: "customer", tenant_id, customer_id}` (so RLS can read `auth.jwt() -> 'app_metadata'`) and mints the session. The phone, tokens, ids and names are redacted from its logs.

### Functions the server provides

| Function | Called by | Arguments | Answer |
|---|---|---|---|
| `zalo_customer_sign_in` | `zalo-session`, service role only | `p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text, p_new_user_id uuid` | `{status: "login_needed"}` when the Zalo user has no customer login and `p_new_user_id` is null; otherwise records the identity (a customer identity, separate from a staff one) and answers `{status: "customer", user_id, tenant_id, customer_id \| null, display_name}` |
| `customer_join` | `zalo-session`, service role only | `p_user_id uuid, p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text, p_phone text (E.164), p_loyalty_consent boolean, p_marketing_consent boolean, p_policy_version text, p_screen_version text, p_shown_at timestamptz, p_store_code text \| null, p_channel text ('mini_app')` | `{status: "joined", customer_id, membership_id, welcome_stamps, already_member}` or `{status: "refused", reason}` with `consent_required`, `policy_outdated`, `unknown_store`, `no_programme` (no active programme covers today: none, paused, ended or outside its period) or `phone_in_use`; consent rows: `loyalty` always, `marketing` only when ticked, each with the evidence |
| `customer_home()` | a visitor or member session | none | `{programme: null \| {name, status (active \| paused \| ended; the app still reads an answer without it), starts_on, ends_on \| null, stamps_per_card, welcome_stamps, stamp_validity_months, points_enabled, points_expiry_months, receipt_claims_per_day, receipt_claim_window_hours, summary \| null, stamp_rule \| null, points_rule \| null, reward_summary \| null, retention_months \| null, tiers: [{code, name, min_points}]}, oa_id \| null, legal: {entity_name \| null, policy_version \| null, documents: [{kind: privacy_notice \| mini_app_terms, language, version, title, body_markdown, published_at}]}, stores: [{code, name, address \| null, opening_hours: {mon: [["07:00","22:00"]], …} \| null}], menu: [{id, name, description \| null, category \| null, store_codes \| null}]}`. The programme facts are the `loyalty_programmes` columns of the active programme (`points_enabled` is `points_per_unit > 0`); the owner's texts are optional and the app words the rules itself when they are null; `tiers` may be empty. A store's `code` is its link key (`stores.code`, else `external_id`, at most 64 of `A-Z a-z 0-9 . _ -`). No personal, revenue or price column; refused to `anon` |
| `customer_wallet()` | a member session | none | `{card: {programme_name, display_name, phone_masked, member_since, purchases}, stamp_cards: [{id, name, stamps, stamps_per_card, pending, expires_on \| null}], points: {balance, pending, expiring: {points, on} \| null}, tier: {code, name, next_name \| null, points_to_next \| null} \| null, marketing_consent, history: [{id, at, kind, state, stamps, points, reason \| null, store_name \| null, receipt_no \| null, matched_path \| null}], claims: [{id, store_name, receipt_no, business_date, submitted_at, state: pending \| matched \| queued \| rejected \| expired, reason \| null}], claims_today, claims_per_day}`. `stamp_cards` is one card from `loyalty_balance` (`stamps_on_card`, `stamps_per_card`, `pending_stamps`, the date of `next_stamp_expiry`). History from `loyalty_ledger`, confirm rows folded into their earn: `kind` is `welcome` (an adjust with reason `welcome`), `earn`, `redeem`, `adjust` (any other adjust), `expire` or `reversal` (a clawback); `state` is `pending` (an earn or a reward hold without its confirm), `confirmed` (a reward hold too, once the till's invoice confirmed it), or `reversed` (an earn a clawback points at, or a reward hold given back by the `redemption_released` adjustment); `matched_path` is `phone` (A), `member_code` (B), `receipt_claim` (C), `voucher` (D), `welcome` or `manual`, and null for a redeem row and for the `redemption_released` adjustment (worded "Hoàn lại quà chưa dùng"). `claims_today` counts every claim of the business day, refused ones too, as `loyalty_submit_claim` does |
| `customer_member_code(p_store text)` | a member session | the store's link key | `{code (6 digits), store_code, store_name, expires_at, issued_at?, refresh_at?, qr_payload?}` from `loyalty_issue_checkin_code` (valid `checkin_code_ttl_seconds`, 120 by default); the app fills `issued_at` as expiry − 120 s, `refresh_at` as issue + 60 s and the QR payload as the code when they are left out; an unknown store is refused with `22023` |
| `customer_submit_claim(p_store text, p_receipt_no text, p_amount numeric, p_business_date date)` | a member session | the claim (receipt 1 to 40 characters without spaces) | `{claim_id \| null, state: pending \| matched \| queued \| rejected, reason \| null, claims_left_today}` from `loyalty_submit_claim`; a refusal is an answer with its reason, not an error. Reasons the app words: `outside_window`, `daily_cap`, `already_claimed`, `amount_mismatch`, `already_earned`, `invoice_not_completed`, `no_matching_invoice`, `dismissed`, `below_minimum`, `excluded_phone`, `excluded_source`, `programme_inactive`, `membership_inactive` (`CLAIM_REASONS`); any other snake-case reason is shown as a general refusal. A malformed store, receipt or amount is refused with `22023` |
| `customer_stop_marketing()` | a member session | none | `{marketing_consent: false, stopped_at}`; revokes the active marketing consent at once |
| `customer_request_deletion()` | a member session | none | `{request_id, status: received \| in_progress \| completed \| rejected, requested_at}`, a `data_subject_requests` row of type `deletion` (`{state: "open"}` is also read, as `received`) |
| `customer_coupons(p_store text default null)` | a member session | a store's link key, or null for every store | rows of `{coupon_id, reward_key, name, description, reward_kind (free_item \| percent_off \| amount_off \| free_upgrade), reward_percent, reward_item_names, cost_stamps, cost_points, store_codes, valid_from, valid_until, hold_hours, per_member_limit, redeemed, live_redemption_id, affordable, stamps_short, points_short, available, unavailable_reason}` (`readRewards`); no amount ever |
| `customer_redeem(p_coupon uuid, p_store text)` | a member session | the reward and the store | a hold `{redemption_id, state: held, code, qr_payload, rail, coupon_id, store_code, store_name, held_at, hold_expires_at, seconds_left, stamps_spent, points_spent, stamps, points}` or `{state: null, refusal, stamps, points}` (`readRedeemResult`; refusals `REDEEM_REFUSALS`, any other snake-case reason worded generally); `22023` for a bad reward or store |
| `customer_vouchers()` | a member session | none | rows of `{redemption_id, coupon_id, coupon_name, reward_kind, reward_percent, store_code, store_name, code, qr_payload, state, display_state (held \| expired \| used \| returned \| cancelled), held_at, hold_expires_at, seconds_left, verified, confirmed_at, released_at, stamps_spent, points_spent}` (`readVouchers`); the code only while held |

A session without a customer (a visitor) is refused by the member functions with SQLSTATE `42501`, which the app reads as "not a member"; a 401 starts a new session. Dates are `YYYY-MM-DD`, times ISO 8601.

## Demo data and the data source

`src/data/source.ts` picks the source the way the staff app does: with the stand-in data endpoint (plain browser mode and `pnpm zalo:dev --app customer`), a deterministic demo world (`src/demo/world.ts`, fixtures in `src/demo/fixtures.ts`) that answers the session request and every function above at the wire level, so the same readers and REST client run as in production; with a Supabase endpoint (`--live`, or the Zalo runtime), the Data API through `createRestLoyaltyClient`. The demo world has two synthetic stores (`mau-1`, `mau-2`), four rewards (a free coffee for 3 stamps, a cookie for 50 points once per member, 10 % off for 150 points at `mau-1`, a size upgrade for 5 stamps) held for 24 hours with the codes of the fallback rail, four menu highlights, a placeholder privacy and terms text, a programme of 10 stamps, 1 welcome stamp, a 72-hour claim window and 3 claims a day, and two synced receipts that a claim matches at once (`1001` at `mau-1` for 85000 today, `2002` at `mau-2` for 42000 yesterday); any other receipt stays pending. Claims follow `loyalty_submit_claim`: leading zeros ignored, every submission counting toward the day's 3, and the refusals `outside_window`, `daily_cap`, `already_claimed` and `amount_mismatch`.

Address switches in browser mode: `?member=1` starts as a member with a history (3 of 10 stamps, one pending, a reversed earn, 105 points); `&marketing=1` with the promotion consent; `&vouchers=1` adds a used and a returned voucher (55 points left); `?privacy=none` has no published privacy notice and `?programme=none|paused|ended` no open programme (joining disabled); `?claims=<n>` with n claims already sent today; `?phone=refused` refuses Zalo's phone prompt; `?follow=refused` refuses following the OA; `?session=failed` loses the connection; `&dataDelay=<ms>` holds every answer; `?store=<code>&src=qr` is a store link; `?lang=en` sets the mocked Zalo language.

## Commands

```sh
pnpm --filter @fnb/zalo-customer dev        # browser mode on http://127.0.0.1:5751, Development stage
pnpm --filter @fnb/zalo-customer build      # vite build (Testing stage), then the size budgets
pnpm --filter @fnb/zalo-customer test       # Vitest with jsdom
pnpm --filter @fnb/zalo-customer test:e2e   # Playwright on 5752 (plus E2E_PORT_OFFSET)
ZALO_LOCAL_DEV=1 pnpm --filter @fnb/zalo-customer test:e2e:local   # the loyalty loop on loyalty-sim, local stack required
```

### Open it locally and on the iPhone: `pnpm zalo:dev --app customer`

```sh
pnpm zalo:dev --app customer                 # http://127.0.0.1:5751/ on this PC, demo data, no database or .env needed
pnpm zalo:dev --app customer --lan           # a link with a one-time key on this PC's Wi-Fi address, and its QR code
pnpm zalo:dev --app customer --tunnel        # a public https link (Cloudflare quick tunnel) with a one-time key, and its QR code
pnpm zalo:dev --app customer --live          # against the local stack: mock Zalo graph, zalo-session and zalo-phone under Deno, the customer functions
```

On the iPhone: start `--tunnel` (or `--lan` on the same Wi-Fi), scan the printed QR code with the camera or open the printed link in Safari. The key in the link is exchanged once for a cookie and dropped from the address; any request without it gets 403. Append the switches above to the address after the first open (for example `&member=1` or `?store=mau-1&src=qr`). The tunnel stops after `--tunnel-hours` (default 4) or on Ctrl+C. `--port` changes the port; `--live` takes `--tenant` (default `loyalty-sim`), `--brand`, `--mock-user`, `--mock-name` and `--mock-phone 0900000xxx` (the synthetic number the mock phone permission answers, 0900000789 by default; give each mock user its own) like the staff loop and needs no binding code: the mock user is a customer and joins with the mock phone token. Another tenant needs its brand's mock Zalo rows first (`fnb zalo config set`).

### The full local trial on the simulated till (`loyalty-sim`)

The synthetic tenant `loyalty-sim` (stores `sim-1` and `sim-2`, an active synthetic programme, published privacy and terms texts) is the one the simulated till accepts; `live-local` has no approved programme and is never used here.

1. `pnpm loyalty:sale -- --setup --tenant loyalty-sim` once, if the tenant is missing.
2. `pnpm zalo:dev --app customer --live` (add `--tunnel` for the iPhone). `--live` targets `loyalty-sim` by default and, on the first run, seeds a synthetic `brand-1` into it: the brand over its stores, a mock Zalo App (`mock-sim-app-1`), OA and the staff and customer Mini Apps (`packages/zalo/src/local-dev/seed.ts`). Only a synthetic tenant (`loyalty-sim` or `zalo-it-…`) is ever seeded; `pnpm zalo:dev forget --tenant loyalty-sim` removes the rows again.
3. In the app: "Tham gia thành viên", tick the loyalty consent, "Tham gia" (the mock phone token joins as 0900000789), and see the welcome stamps on Thẻ thành viên.
4. Ring a sale: `pnpm loyalty:sale -- --tenant loyalty-sim --amount 60000`. It prints the store, business date, receipt number and amount.
5. In the app: "Nhận điểm từ hóa đơn", pick that store, type the receipt number and 60000, keep the date, "Gửi hóa đơn". A synced receipt matches at once; otherwise the claim shows "Đang chờ xác nhận" until the reconciliation.
6. Thẻ thành viên shows the stamp and points with "Qua hóa đơn bạn gửi". For path A instead, `pnpm loyalty:sale -- --tenant loyalty-sim --amount 60000 --phone 0900000789` credits the member without a claim.
7. Path B with the staff app: open "Mã thành viên tại cửa hàng này" on `sim-1`'s page; in another terminal, once, `pnpm zalo:dev setup-staff` (below) for a manager login of `loyalty-sim`, then the command it prints, `pnpm zalo:dev --tenant loyalty-sim --member loyalty-sim-manager@example.com --mock-user mock-sim-manager-1`, "Ghi nhận khách" with the 6-digit code, then `pnpm loyalty:sale -- --tenant loyalty-sim --amount 60000 --store sim-1` within 15 minutes: the wallet shows the earn with "Qua mã thành viên".
8. Rewards: with an active reward and a `pos_payment_discount` rail at `sim-1` (the web's reward settings, or the seeding of `e2e/loyalty-fixture.ts`), "Đổi quà" on Thẻ thành viên, confirm, show the code; the staff app's "Kiểm tra ưu đãi" names the POS discount entry; `pnpm loyalty:sale -- --tenant loyalty-sim --amount 60000 --store sim-1 --discount-name "<that entry>"` confirms it and Ví voucher shows "Đã dùng".

### A staff login for `loyalty-sim`: `pnpm zalo:dev setup-staff`

`loyalty-sim` has no member logins of its own, so the staff app has nobody to open as. `pnpm zalo:dev setup-staff` (`packages/zalo/src/local-dev/staff-setup.ts`, and `seedSyntheticManager` in `seed.ts`) makes one on the local stack and is safe to run again:

- it refuses every tenant but a synthetic one (`loyalty-sim`, the default, or `zalo-it-…`; never `live-local`), a tenant registered as fed by the real iPOS API, and a `SUPABASE_URL` or `DATABASE_URL` that is not on 127.0.0.1;
- it seeds the synthetic `brand-1` first when the tenant has none (as `--app customer --live` does), because the staff loop needs it;
- it creates the Auth login `loyalty-sim-manager@example.com` with a generated password and makes it a `manager` of every active store (`sim-1` and `sim-2`); a rerun keeps the login and its password and only puts the membership back to manager of every active store;
- it adds no `staff_roster` row: a member who is not on the roster signs in after the loop's one-time binding code without the staff notice, as the managers of the local Playwright spec do.

It prints the password only when it creates the login, or with `--new-password`, which sets a new one:

```text
zalo:dev setup-staff: loyalty-sim on the local stack
  brand-1: already seeded
  manager login: loyalty-sim-manager@example.com, manager of Synthetic store 1 and Synthetic store 2 (created)
  password: <24 random characters>
    shown once: it is kept nowhere but as a hash in the local stack's auth.users; it also signs in to the web app on the local stack
  no staff roster row: a member who is not on the roster signs in after the one-time binding code, without the staff notice
open the staff app as this manager:
  pnpm zalo:dev --tenant loyalty-sim --member loyalty-sim-manager@example.com --mock-user mock-sim-manager-1
```

The password is written to no file. The staff loop needs only the e-mail; the password is for the web app, and `setup-staff --new-password` replaces a lost one. `--tenant` and `--brand` pick another synthetic tenant or brand.

To remove a trial customer, use the data-subject deletion (`dsr_delete`, or `app.dsr_erase_customer` as the database owner), as `e2e/loyalty-fixture.ts` does; consent records refuse any other delete.

A build for the Zalo runtime needs `VITE_ZALO_RUNTIME=zalo`, `VITE_BRAND_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and the brand's generated `app-config.json` in this folder (gitignored), as for the staff app ([apps/zalo-staff/README.md](../zalo-staff/README.md)).

## Tests

| Where | What |
|---|---|
| `src/app.test.tsx` | the home first of three tabs within the design rules; a visitor's card tab asks to join with no permission call; a lost connection; English; the customer configuration |
| `src/home/home.test.tsx` | store links from route parameters and from the `OpenApp` event; programme, stores and menu without permission; every menu item "Xem tại quầy" and no price on the page; a deep link to a store page, a warm start with a new link, a store that no longer exists; the popups' titles; the price detector |
| `src/legal/legal-popups.test.tsx` | the popup titles with the Mini App's name, the document per language, the legal entity and version in English, links as words |
| `src/join/join-flow.test.tsx` | consents unticked and the loyalty consent required; the purpose before any phone call; joining with the welcome stamp, the request's fields and the follow-OA step; the marketing consent only when ticked, with the linked store; declining the purpose, refusing the phone and cancelling the consent store nothing; an expired phone token; a visitor's claim through joining |
| `src/wallet/member-qr.test.tsx` | the 60-second refresh and the 2-minute expiry, the countdown, a refresh that fails until the code expires and "Lấy mã mới", the store picker, the QR drawing |
| `src/wallet/wallet.test.tsx` | the stamps ring; the card content, stamps, points, tier, expiry and history states; "Dừng nhận tin" with its confirmation and "Rời chương trình"; a visitor's account tab |
| `src/home/join-closed.test.tsx` | the join rule (open programme and published privacy notice); without a privacy notice and without a programme (none, paused, ended): browsing usable, both actions disabled with the reason on home, store page and card tab, English, the closed join screen with no phone prompt, the `no_programme` refusal worded |
| `src/wallet/vouchers.test.tsx` | reward kinds and costs without a price, the missing stamps or points, every refusal, the countdown; the catalogue of a store with its affordability, the confirmation with the cost and hold, the code, QR and countdown; a held code kept until the hold ends; used and returned vouchers and the returned hold in the history |
| `src/claim/claim-form.test.tsx` | the form's rules and cleaning; problems after a first try; a pending claim in the wallet; a matched claim and the duplicate's reason; the last claim of the day; sending disabled at the limit |
| `src/demo/world.test.ts` | the demo source through the real session client and REST client: visitor and member answers, the join and its refusals, codes per store and minute, claims and the daily limit, marketing and deletion |
| `src/i18n/catalog.test.ts` | every Vietnamese key has an English message with the same placeholders; the registry's spelling; no price in any message; the ticket's wording |
| `src/probe/probe.test.tsx` | the Development-only phone-consent probe |
| `e2e/browse.spec.ts` | in `phone-light` and `phone-dark` at 360 × 800 px: the home with only `getAccessToken` called and only `fnb.customer-session` in Native Storage, a store's QR link, the Privacy and Terms popups, every visitor screen, a lost connection, English |
| `e2e/join.spec.ts` | refusing the phone permission and browsing on; browse → join (unticked consents) → follow OA → wallet → receipt claim pending; the marketing consent stopped with "Dừng nhận tin"; a visitor's claim through joining |
| `e2e/wallet.spec.ts` | with a fixed clock: the wallet states; the member code bound to the linked store and refreshed after 60 seconds; a claim validated, matched and the day's limit |
| `e2e/budget.spec.ts` | project `budget`: the paint budget on a throttled phone |
| `e2e/loyalty-local.spec.ts` | with `ZALO_LOCAL_DEV=1` and the local stack (`playwright.local.config.ts`, project `local`, skipped otherwise, so CI's demo runs are unaffected), on `loyalty-sim` through `pnpm zalo:dev`: a customer browses, joins through the purpose screen with the mock phone consent, a `loyalty:sale` receipt is claimed and confirmed (path C); the staff app records the customer's member code at `sim-1`, refuses the same member again (`already_recorded`), a sale in the window earns it and the wallet shows "Qua mã thành viên" (path B); a staff adjustment, a reward redeemed at `sim-1`, verified in the staff app (POS discount entry), the till rings that entry and Ví voucher shows "Đã dùng", a second check is "Mã đã được sử dụng". Every synthetic customer (data-subject deletion), staff login and reward is removed afterwards; the till invoices stay (`e2e/loyalty-fixture.ts`) |

Every Playwright screen goes through `checkCustomerScreen` (`e2e/customer-checks.ts`): `@fnb/zalo-mini`'s design checks (at most 4 tabs, 44 px targets, no outbound link or external-open call, no LocalStorage, SessionStorage or cookie, axe, no console error), plus a price scan of every element's text and no IndexedDB.

On 2026-11-19: 73 unit tests in 12 files and 33 Playwright tests in 4 files pass, and the 3 local-stack tests of `e2e/loyalty-local.spec.ts` pass on `loyalty-sim`.

## What the server still owes

The functions above are live (migrations `20261119200000` to `20261119220000`, `20261119310000` and `20261119600000`) and the app reads their answers field by field. The three open points of 2026-11-19 are closed by migration `20261119600000_customer_app_answers` and `zalo-session` (pgTAP `93_customer_app_answers.sql`, Deno `customer.test.ts`):

- `customer_join` answers `{status: refused, reason: no_programme}` when no active programme covers the tenant's today, and `zalo-session` maps it to 409 `no_programme`, which the app words.
- `customer_home` returns `programme.status` (active, paused, ended), or `programme: null` without a programme, so a paused or ended programme no longer looks open.
- `customer_wallet` reads the `redeem` row of a released hold as `reversed` (and of a used voucher as `confirmed`) and gives the `redemption_released` adjustment no path; the demo world answers the same.
