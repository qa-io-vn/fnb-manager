# Staff Mini App (`@fnb/zalo-staff`)

Purpose and audience: the staff Zalo Mini App of track B, one build per brand from configuration, hidden from Zalo's search and opened by link or QR code (`mini_apps.browsable` false). For developers of the staff screens and for reviewers of Zalo's design rules. Phase 13 (#208) built the scaffold: the four tabs and the sign-in states, tested in a browser with a mocked Zalo SDK and a stand-in session. The staff features come in phase 14 (#215 onward); nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-18

## What it shows

- Four bottom tabs: Trang chủ, Ca làm, Thông báo and Cá nhân ("Home", "Shifts", "Notices", "Me" in English). The first opens first; the other three show a plain state until phase 14 fills them.
- Trang chủ is the shared session screen of `@fnb/zalo-mini`: "Đang kết nối…", then the member's display name, role and stores; or, for a Zalo user not yet paired with a member, the instructions and a 6-digit code entry that reports a refused code; or, when the connection fails, one retry action.
- The language follows Zalo's (Vietnamese, or English when Zalo is set to English).

The screens, routes and tabs are in `src/app.tsx`, the strings in `src/i18n/vi.json` and `src/i18n/en.json`, the tab icons in `src/icons.tsx`. Everything else (the shell, the session, Native Storage, the build) comes from [`@fnb/zalo-mini`](../../packages/zalo-mini/README.md).

## Commands

```sh
pnpm --filter @fnb/zalo-staff dev        # browser mode on http://127.0.0.1:5741 with the mocked SDK and a stand-in session
pnpm --filter @fnb/zalo-staff build      # vite build (Testing stage), then the size budgets
pnpm --filter @fnb/zalo-staff test       # Vitest with jsdom
pnpm --filter @fnb/zalo-staff e2e:install
pnpm --filter @fnb/zalo-staff test:e2e   # Playwright on 5742 (plus E2E_PORT_OFFSET)
```

In browser mode the address chooses the stand-in session: `?session=unpaired` or `?session=failed` shows those states, `&delay=<ms>` holds "Đang kết nối…", and the code `000000` is refused; `?lang=en` sets the mocked Zalo language. The stand-in member is a synthetic manager of two sample stores.

A build for the Zalo runtime needs `VITE_ZALO_RUNTIME=zalo`, `VITE_BRAND_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and the brand's generated `app-config.json` in this folder (gitignored); `deploy-mini-apps.yml` prepares them ([operations.md, 4.17](../../docs/operations.md#417-mini-app-deploys)). The other variables are in [development.md](../../docs/development.md), section 3.

## Tests

| Where | What |
|---|---|
| `src/app.test.tsx` | "Đang kết nối…" then the member's name, role and stores; the unpaired instructions, a refused code and a good one; one retry after a failure; the first of four tabs and the plain states; English; the routes and tabs within the design rules |
| `src/i18n/catalog.test.ts` | every Vietnamese key has an English message with the same placeholders |
| `e2e/session.spec.ts` | the same states in Chromium at 360 × 800 px in the projects `phone-light` and `phone-dark`, each screen through `checkMiniAppScreen` (tabs, 44 px targets, no outbound link or external-open call, no web storage or cookie, axe, no console error) |
| `e2e/budget.spec.ts` | project `budget`: on a throttled phone, the largest contentful paint under 2.5 s and the page load under 1.5 s |

On 2026-11-18: 7 unit tests in 2 files and 11 Playwright tests in 2 files pass. CI's `mini-apps` job also builds the app for two synthetic brands and checks the budgets ([test-plan.md](../../docs/test-plan.md), sections 2.8 and 2.10).
