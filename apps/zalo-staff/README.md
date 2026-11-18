# Staff Mini App (`@fnb/zalo-staff`)

Purpose and audience: the staff Zalo Mini App of track B, one build per brand from configuration, hidden from Zalo's search and opened by link or QR code (`mini_apps.browsable` false). For developers of the staff screens and for reviewers of Zalo's design rules. Phase 13 (#208) built the scaffold: the four tabs and the sign-in states, tested in a browser with a mocked Zalo SDK and a stand-in session. Phase 14 adds the entry (#215: onboarding, the staff notice, pairing, "từ chối", Privacy and Terms) and the home (#217); nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-18

## What it shows

- Until the person is signed in, the entry (#215, `src/onboarding/`) replaces the whole app, without the bottom tabs:
  - **Onboarding**, on a first open and before any Zalo identity call: an internal staff tool, why a Zalo login is needed, what is kept (the Zalo id and display name; the phone only if linked later), one primary action "Tiếp tục", and "Quyền riêng tư" and "Điều khoản sử dụng" as popups. A person with a stored session, even an expired one, skips it.
  - **The staff notice** from `zalo-session`'s unpaired answer: "Đồng ý" leads to pairing (the acceptance is recorded by the pairing request itself), "Từ chối" to the refusal screen. With no published notice, a plain screen says to tell the manager.
  - **Pairing**: a 6-digit numeric field (numeric keypad, one-time-code autofill); "Ghép nối" shows its loading state at once; a wrong, used or expired code gets one message ("Mã không đúng hoặc đã hết hạn…"); after too many attempts, a countdown of the wait with the button disabled; a notice published meanwhile is shown again and the code is kept; success shows "Ghép nối thành công" for 1.5 s and opens Trang chủ.
  - **"Từ chối"**: stays usable, shows the tenant's contact instructions as plain text when the session answer carries them (otherwise "hãy hỏi trực tiếp quản lý cửa hàng"), and "Xem lại thông báo" leads back.
  - **A newer notice for a paired person**: `zalo-session`'s notice_required answer, or, with a stored fresh session, `my_staff_notice` at every open; the notice comes before anything else and "Đồng ý" calls `accept_staff_notice`. A session the API refuses (401 or 403, for example after a deactivation) is dropped and the app starts again at the notice instead of showing an error.
- Four bottom tabs once signed in: Trang chủ, Ca làm, Thông báo and Cá nhân ("Home", "Shifts", "Notices", "Me" in English). The first opens first; Ca làm and Thông báo show a plain state until phases 14b and 15 fill them.
- Cá nhân (`src/profile/`): the name and role; for a person on the staff roster, "Liên kết số điện thoại" (a purpose screen first, then Zalo's permission prompt; a refusal returns to the tab with nothing changed; success decodes the number with `zalo-phone` and stores it with `link_my_phone`) and "Rút lại đồng ý" (a confirmation popup, then `withdraw_staff_ops_consent`; the stored session is dropped and the app is back at the notice); for everyone, "Quyền riêng tư" and "Điều khoản sử dụng" as popups.
- Privacy and Terms are the tenant's published `privacy_notice` and `mini_app_terms` (in the app's language, else Vietnamese), titled with the document's own title and shown as plain text: links in the text render as words and phone numbers are not tappable (`format-detection` is off). Signed in, they are read through the Data API under RLS; before pairing, from `zalo-session`'s texts request, which the server does not answer yet (the popup then says the text cannot be loaded).
- Signed in, Trang chủ is the role-scoped home (#217, `src/home/`): the greeting and role; the store, one of the brand's stores in the member's scope (a picker when there are several); the freshness stamp of the tenant's latest successful sync ("Cập nhật lúc HH:mm", with the date when it is from an earlier day, "Chưa đồng bộ", or "Chưa rõ lúc cập nhật"); then the cards the role allows:

  | Who | Cards |
  |---|---|
  | owner, manager (and viewer) | today's net revenue ("tr ₫" headline, the exact amount on tap) and invoices, yesterday's reconciliation ("Đã đối soát" or "Chưa đối soát"), the store's opening hours today |
  | staff, `staff_revenue_visibility` = `all` | the same as a manager |
  | staff, `store_totals` | today's net revenue and invoices, opening hours |
  | staff, `none` | opening hours only |

  Today's figures come from `today_store_totals()`, which counts non-voided invoices of each store's business day as Hôm nay does; yesterday's state from `sync_checks`; the stamp from `sync_runs`; all through the member's session under RLS. A day without invoices shows "Chưa có dữ liệu", never 0. The figures reload every 5 minutes and when the app comes back to the foreground.
- The language follows Zalo's (Vietnamese, or English when Zalo is set to English).

The screens, routes and tabs are in `src/app.tsx`, the entry in `src/onboarding/` (the states in `model.ts`, the screens in `screens.tsx`, the gate in `entry-gate.tsx`, the Data API and `zalo-phone` calls in `account.ts`), the popups' texts in `src/legal/`, Cá nhân in `src/profile/`, the home in `src/home/` (cards in `home-screen.tsx`, the role and level rules in `model.ts`, the Data API reads in `source.ts`, the stand-in figures in `sample.ts`), the strings in `src/i18n/vi.json` and `src/i18n/en.json`, the tab icons in `src/icons.tsx`. Everything else (the shell, the session, the popups and result modal, Native Storage, the Data API client, the build) comes from [`@fnb/zalo-mini`](../../packages/zalo-mini/README.md).

Where the home reads its data: in the Zalo runtime from `VITE_SUPABASE_URL`; with `pnpm zalo:dev` (every mode) from the dev server's `/supabase` path, which Vite proxies to the local API; in stand-in browser mode from fixed sample figures.

## Commands

```sh
pnpm --filter @fnb/zalo-staff dev        # browser mode on http://127.0.0.1:5741 with the mocked SDK and a stand-in session
pnpm --filter @fnb/zalo-staff build      # vite build (Testing stage), then the size budgets
pnpm --filter @fnb/zalo-staff test       # Vitest with jsdom
pnpm --filter @fnb/zalo-staff e2e:install
pnpm --filter @fnb/zalo-staff test:e2e   # Playwright on 5742 (plus E2E_PORT_OFFSET)
```

In browser mode the address chooses the stand-in session: `?session=unpaired` is a first open (onboarding, the notice, pairing), `?session=notice` a paired person asked for the notice again, `?session=failed` a lost connection; `&delay=<ms>` holds every session answer; the code `000000` is refused, `999999` answers the 15-minute wait and any other code pairs; `&notice=changed` publishes a newer notice while the person pairs; `?consent=outdated|missing|not_required` sets a stored session's notice state (owners default to `not_required`, off the roster); `?phone=refused` refuses Zalo's phone prompt; `?lang=en` sets the mocked Zalo language. The stand-in member is a synthetic manager of two sample stores; `?role=owner` or `?role=staff` (one store) changes the role, `?revenue=all|store_totals|none` sets the staff revenue level of the sample tenant (default `all`), and `&dataDelay=<ms>` holds the home's loading state and the Cá nhân calls.

A build for the Zalo runtime needs `VITE_ZALO_RUNTIME=zalo`, `VITE_BRAND_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and the brand's generated `app-config.json` in this folder (gitignored); `deploy-mini-apps.yml` prepares them ([operations.md, 4.17](../../docs/operations.md#417-mini-app-deploys)). The other variables are in [development.md](../../docs/development.md), section 3.

## Tests

| Where | What |
|---|---|
| `src/app.test.tsx` | "Đang kết nối…" then the member's name, role, store picker and freshness stamp; an unpaired person sees only the entry until a good code pairs them; one retry after a failure; the first of four tabs and the plain states; English; the routes and tabs within the design rules |
| `src/onboarding/model.test.ts` | the entry's states: new, notice, pairing, refused, paired, notice outdated (while pairing and after it), waiting after attempts, withdrawn |
| `src/onboarding/entry-gate.test.tsx` | onboarding before any Zalo call with one primary action and no tabs; Privacy and Terms popups; refusal with the contact and back; a refused code and the wait; success with loading at once, the 1.5 s result modal and the home; a newer notice while pairing (code kept) and after it (notice_required and `my_staff_notice`); a refused session back to the start; no notice; English |
| `src/onboarding/account.test.ts` | `my_staff_notice`, `accept_staff_notice`, `withdraw_staff_ops_consent`, `zalo-phone` then `link_my_phone`, the published texts under RLS, the stand-in |
| `src/profile/profile-screen.test.tsx` | Cá nhân on the roster and off it; the phone's purpose screen before Zalo's prompt, a refusal that changes nothing, success and failure; Privacy and Terms popups and a retry; withdrawal with its confirmation |
| `src/legal/markdown.test.tsx` | the texts' headings, paragraphs and lists; links and phone numbers as plain words; the language fallback |
| `src/home/home-screen.test.tsx` | the cards for owner, manager and staff × `all`, `store_totals` and `none`; the "tr ₫" headline and the exact amount on tap; the store picker; "Chưa có dữ liệu" instead of zeros; the four freshness stamps; loading feedback, one retry, a failed refresh that keeps the figures, a new sign-in when the API refuses an expired session, a dropped session when it refuses a fresh one; English |
| `src/home/source.test.ts` | the Data API reads per role and level (staff with `none` never call `today_store_totals` or read `sync_checks`), brand stores only, the database's business day, unreadable rows refused, the freshness stamp's messages |
| `src/home/model.test.ts`, `src/home/format.test.ts` | the access matrix, business days and opening hours; amounts, dates and times formatted as the web app does |
| `src/i18n/catalog.test.ts` | every Vietnamese key has an English message with the same placeholders; the registry's spelling (hóa, hủy, tùy) |
| `e2e/session.spec.ts` | the same states in Chromium at 360 × 800 px in the projects `phone-light` and `phone-dark`, each screen through `checkMiniAppScreen` (tabs, 44 px targets, no outbound link or external-open call, no web storage or cookie, axe, no console error) |
| `e2e/onboarding.spec.ts` | in `phone-light` and `phone-dark`: the first open, Privacy and Terms popups, the notice, "từ chối" and back, a wrong code and the wait, pairing success to the home, a newer notice while and after pairing, withdrawal, the phone link's purpose screen and refusal, English; every screen through `checkMiniAppScreen` plus one primary action, loading feedback within 300 ms and the result modal closing after 1.5 s (`e2e/entry-checks.ts`) |
| `e2e/home.spec.ts` | in `phone-light` and `phone-dark`: a manager's cards, the exact amount on tap and the store picker; staff with `store_totals`, `none` and `all`; loading feedback; English; each through `checkMiniAppScreen` |
| `e2e/local.spec.ts`, `e2e/phone.spec.ts` | with `ZALO_LOCAL_DEV=1` and the local stack: `pnpm zalo:dev` (Chromium) and `pnpm zalo:dev --lan` (WebKit as an iPhone 14) sign in, and the home's stamp, today's figures and yesterday's state are compared with `sync_runs`, the Hôm nay sum of non-voided invoices and `sync_checks` read through the same session; and a real pairing on a `zalo-it-` fixture tenant the test creates and deletes (`e2e/pairing-fixture.ts`, `e2e/pairing-flow.ts`): no `zalo-session` call before "Tiếp tục", the published notice, "từ chối" and back, a refused code, a notice published meanwhile, pairing with a code the owner issued, the roster row, membership, identity and consent checked in the database, the home, Privacy and Terms from the Data API, and withdrawal; only counts and booleans are reported |
| `e2e/budget.spec.ts` | project `budget`: on a throttled phone, the largest contentful paint under 2.5 s and the page load under 1.5 s |

On 2026-11-18: 99 unit tests in 11 files and 41 Playwright tests in 4 files pass, plus the fixture pairing of the local and the iPhone spec against the local stack. CI's `mini-apps` job also builds the app for two synthetic brands and checks the budgets ([test-plan.md](../../docs/test-plan.md), sections 2.8 and 2.10).
