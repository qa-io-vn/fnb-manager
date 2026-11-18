# Staff Mini App (`@fnb/zalo-staff`)

Purpose and audience: the staff Zalo Mini App of track B, one build per brand from configuration, hidden from Zalo's search and opened by link or QR code (`mini_apps.browsable` false). For developers of the staff screens and for reviewers of Zalo's design rules. Phase 13 (#208) built the scaffold: the four tabs and the sign-in states, tested in a browser with a mocked Zalo SDK and a stand-in session. The staff features come in phase 14 (#215 onward); nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-18

## What it shows

- Four bottom tabs: Trang chủ, Ca làm, Thông báo and Cá nhân ("Home", "Shifts", "Notices", "Me" in English). The first opens first; the other three show a plain state until phase 14 fills them.
- Until the member is signed in, Trang chủ is the shared session screen of `@fnb/zalo-mini`: "Đang kết nối…"; or, for a Zalo user not yet paired with a member, the pairing steps; or, when the connection fails, one retry action.
- Signed in, Trang chủ is the role-scoped home (#217, `src/home/`): the greeting and role; the store, one of the brand's stores in the member's scope (a picker when there are several); the freshness stamp of the tenant's latest successful sync ("Cập nhật lúc HH:mm", with the date when it is from an earlier day, "Chưa đồng bộ", or "Chưa rõ lúc cập nhật"); then the cards the role allows:

  | Who | Cards |
  |---|---|
  | owner, manager (and viewer) | today's net revenue ("tr ₫" headline, the exact amount on tap) and invoices, yesterday's reconciliation ("Đã đối soát" or "Chưa đối soát"), the store's opening hours today |
  | staff, `staff_revenue_visibility` = `all` | the same as a manager |
  | staff, `store_totals` | today's net revenue and invoices, opening hours |
  | staff, `none` | opening hours only |

  Today's figures come from `today_store_totals()`, which counts non-voided invoices of each store's business day as Hôm nay does; yesterday's state from `sync_checks`; the stamp from `sync_runs`; all through the member's session under RLS. A day without invoices shows "Chưa có dữ liệu", never 0. The figures reload every 5 minutes and when the app comes back to the foreground.
- The language follows Zalo's (Vietnamese, or English when Zalo is set to English).

The screens, routes and tabs are in `src/app.tsx`, the home in `src/home/` (cards in `home-screen.tsx`, the role and level rules in `model.ts`, the Data API reads in `source.ts`, the stand-in figures in `sample.ts`), the strings in `src/i18n/vi.json` and `src/i18n/en.json`, the tab icons in `src/icons.tsx`. Everything else (the shell, the session, Native Storage, the Data API client, the build) comes from [`@fnb/zalo-mini`](../../packages/zalo-mini/README.md).

Where the home reads its data: in the Zalo runtime from `VITE_SUPABASE_URL`; with `pnpm zalo:dev` (every mode) from the dev server's `/supabase` path, which Vite proxies to the local API; in stand-in browser mode from fixed sample figures.

## Commands

```sh
pnpm --filter @fnb/zalo-staff dev        # browser mode on http://127.0.0.1:5741 with the mocked SDK and a stand-in session
pnpm --filter @fnb/zalo-staff build      # vite build (Testing stage), then the size budgets
pnpm --filter @fnb/zalo-staff test       # Vitest with jsdom
pnpm --filter @fnb/zalo-staff e2e:install
pnpm --filter @fnb/zalo-staff test:e2e   # Playwright on 5742 (plus E2E_PORT_OFFSET)
```

In browser mode the address chooses the stand-in session: `?session=unpaired` or `?session=failed` shows those states, `&delay=<ms>` holds "Đang kết nối…", and the code `000000` is refused; `?lang=en` sets the mocked Zalo language. The stand-in member is a synthetic manager of two sample stores; `?role=owner` or `?role=staff` (one store) changes the role, `?revenue=all|store_totals|none` sets the staff revenue level of the sample tenant (default `all`), and `&dataDelay=<ms>` holds the home's loading state.

A build for the Zalo runtime needs `VITE_ZALO_RUNTIME=zalo`, `VITE_BRAND_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and the brand's generated `app-config.json` in this folder (gitignored); `deploy-mini-apps.yml` prepares them ([operations.md, 4.17](../../docs/operations.md#417-mini-app-deploys)). The other variables are in [development.md](../../docs/development.md), section 3.

## Tests

| Where | What |
|---|---|
| `src/app.test.tsx` | "Đang kết nối…" then the member's name, role, store picker and freshness stamp; the unpaired instructions, a refused code and a good one; one retry after a failure; the first of four tabs and the plain states; English; the routes and tabs within the design rules |
| `src/home/home-screen.test.tsx` | the cards for owner, manager and staff × `all`, `store_totals` and `none`; the "tr ₫" headline and the exact amount on tap; the store picker; "Chưa có dữ liệu" instead of zeros; the four freshness stamps; loading feedback, one retry, a failed refresh that keeps the figures, a new sign-in when the API refuses an expired session; English |
| `src/home/source.test.ts` | the Data API reads per role and level (staff with `none` never call `today_store_totals` or read `sync_checks`), brand stores only, the database's business day, unreadable rows refused, the freshness stamp's messages |
| `src/home/model.test.ts`, `src/home/format.test.ts` | the access matrix, business days and opening hours; amounts, dates and times formatted as the web app does |
| `src/i18n/catalog.test.ts` | every Vietnamese key has an English message with the same placeholders |
| `e2e/session.spec.ts` | the same states in Chromium at 360 × 800 px in the projects `phone-light` and `phone-dark`, each screen through `checkMiniAppScreen` (tabs, 44 px targets, no outbound link or external-open call, no web storage or cookie, axe, no console error) |
| `e2e/home.spec.ts` | in `phone-light` and `phone-dark`: a manager's cards, the exact amount on tap and the store picker; staff with `store_totals`, `none` and `all`; loading feedback; English; each through `checkMiniAppScreen` |
| `e2e/local.spec.ts`, `e2e/phone.spec.ts` | with `ZALO_LOCAL_DEV=1` and the local stack: `pnpm zalo:dev` (Chromium) and `pnpm zalo:dev --lan` (WebKit as an iPhone 14) sign in, and the home's stamp, today's figures and yesterday's state are compared with `sync_runs`, the Hôm nay sum of non-voided invoices and `sync_checks` read through the same session; only counts and booleans are reported |
| `e2e/budget.spec.ts` | project `budget`: on a throttled phone, the largest contentful paint under 2.5 s and the page load under 1.5 s |

On 2026-11-18: 54 unit tests in 6 files and 23 Playwright tests in 3 files pass, plus the local and the iPhone spec against the local stack. CI's `mini-apps` job also builds the app for two synthetic brands and checks the budgets ([test-plan.md](../../docs/test-plan.md), sections 2.8 and 2.10).
