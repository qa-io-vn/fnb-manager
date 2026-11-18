# `@fnb/zalo-mini`

Purpose and audience: what the two Zalo Mini Apps share, so that each app holds only its screens: the Native Storage adapter, the session client behind a small interface with a local stand-in, the Vietnamese and English translator, the React shell on zmp-ui, `app-config.json` per brand with its command line, the Vite plugin that builds for the browser or for the Zalo runtime, the size budgets, the mocked Zalo SDK and the Playwright design checks. For developers of the Mini Apps ([apps/zalo-staff](../../apps/zalo-staff/README.md), [apps/zalo-customer](../../apps/zalo-customer/README.md)) and for reviewers of Zalo's rules (ADR-022). Phase 13 (#208): built and tested in a browser; nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-18

## Entry points

| Import | Holds |
|---|---|
| `@fnb/zalo-mini` | The translator (`createTranslator`, `languageFrom`, `catalogParity`, `mergeCatalogs`); the session types (`SessionClient`, `SessionState`, `MemberProfile`, `MEMBER_ROLES`); `createZaloSessionClient`, which posts the Zalo access token, the brand key and an optional 6-digit binding code (`BINDING_CODE_PATTERN`) to `zalo-session` with the publishable key and keeps the answer in Native Storage under `fnb.session` while it is fresh (60 s of margin); `createStandInSessionClient` with the scenarios `bound`, `unpaired` and `failed`; `authorizationHeaders`; the storage adapters `fromZmpNativeStorage`, `createMemoryStorage` and `supabaseAuthOptions` (supabase-js on Native Storage, no session in the URL) |
| `@fnb/zalo-mini/react` | `bootMiniApp`, which picks the real session client for a Zalo build and the stand-in in the browser; the shell `MiniApp` on zmp-ui's `ZMPRouter` with memory routing, at most four bottom tabs and, in the browser only, a stand-in of the header that Zalo draws from `app-config.json` (`MAX_TABS`, `shellProblems`); `SessionScreen` ("Đang kết nối…", the member's name, role and stores, the unpaired state with its code entry, a failure with one retry); `PlainState`; `useI18n`, `useSession`, `useColorScheme`; `withSharedMessages` |
| `@fnb/zalo-mini/app-config` | `buildAppConfig` from a `mini_apps` row, `validateMiniAppRow` (Zalo's title rules, `#RRGGBB` colours, `black` or `white` text, a contrast of at least 4.5:1 between each header colour and its text colour), `readAppConfig`, `differingFields` and `unconfiguredDifferences` |
| `@fnb/zalo-mini/vite` | `miniApp({ kind, appRoot, developmentOnlyMarkers })`, the build plugin below |
| `@fnb/zalo-mini/testing/mock-sdk` | A mocked `zmp-sdk` for browser mode: Native Storage in memory, a synthetic access token and phone token, the system language from `?lang=`, and every external-open call (`openWebview`, `openOutApp` and the others) recorded instead of run (`mockSdkCalls`) |
| `@fnb/zalo-mini/testing/design-checks` | `watchMiniAppPage(page)` before the page opens, then `checkMiniAppScreen(page)`: at most 4 bottom tabs, every target at least 44 × 44 CSS px, no outbound link, no external-open SDK call, no LocalStorage, SessionStorage or cookie, no serious or critical axe violation, no console error; `MINI_APP_VIEWPORT` (360 × 800) |
| `@fnb/zalo-mini/testing/paint-budget` | `throttleLikeAMidRangePhone` (4 × CPU slowdown, 150 ms latency, about 1.6 Mbit/s down, cache off), `measurePaint` and `paintBudgetProblems`: largest contentful paint under 2,500 ms and page load under 1,500 ms |
| `@fnb/zalo-mini/styles.css` | Maps zmp-ui's light and dark `--zaui-*` variables onto the design tokens; bottom-navigation items at least 48 px tall |

`zmp-sdk` 2.53.3 and `zmp-ui` 1.11.15-2 are pinned exactly. The session answer the client reads (`status` `bound` with `access_token`, `refresh_token`, `expires_at` in seconds and `member` with `display_name`, `role` and `stores`, or `status` `unpaired`) is exactly what `zalo-session` answers since #205 ([docs/api.md](../../docs/api.md#zalo-session)); its refusals are `{error, request_id}` with a fixed status per code.

## The build plugin

`miniApp()` in an app's `vite.config.ts` reads these variables:

| Variable | Values |
|---|---|
| `VITE_ZALO_RUNTIME` | `browser` (default): `zmp-sdk` is replaced by the mocked SDK and the session by the stand-in. `zalo`: the real SDK and `zalo-session`; needs `VITE_BRAND_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and a generated `app-config.json` |
| `VITE_MINI_APP_STAGE` | `development` (the dev server's default) or `testing` (a build's default). A Testing build fails when its output still contains one of the app's `developmentOnlyMarkers` |
| `VITE_BRAND_KEY` | the brand key; `brand-1` in a browser build without one |
| `MINI_APP_CONFIG` | the `app-config.json` to build from, `app-config.json` in the app's folder by default; a browser build without it uses the synthetic `brand-1` of `config/synthetic-brands.json` |

Every build targets ES2015, names its scripts `assets/<name>.<hash>.module.js`, sets the page title from `app-config.json`, refuses `echarts` and `zrender`, and writes `dist/app-config.json` with the app section and the lists of CSS, entry and preloaded scripts that Zalo loads.

## Commands

| What | Command |
|---|---|
| Tests | `pnpm --filter @fnb/zalo-mini test` (73 tests in 9 files on 2026-11-18) |
| Types | `pnpm --filter @fnb/zalo-mini typecheck` |
| One brand's `app-config.json` | `pnpm --filter @fnb/zalo-mini app-config --config <file> --brand <key> --app <staff or customer> --out <path>` |
| The configured Mini Apps | `pnpm --filter @fnb/zalo-mini app-config --config <file> --list` prints `<brand> <kind>` per row |
| Two generated files differ only where configured | `pnpm --filter @fnb/zalo-mini app-config --compare <first> <second>` |
| Size budgets of a build | `node packages/zalo-mini/scripts/check-budget.mjs --app <app folder> [--dist <folder>]…`: at most 3 MB a file and 10 MB a version (decimal megabytes), and no `echarts` or `zrender` anywhere in the app's runtime dependency graph |

The `app-config` command exits 0, 1 on an invalid configuration and 2 on a usage error. Its configuration file is `{"mini_apps": [...]}` with the columns of the `mini_apps` rows and a `brand_key` ([schema.md](../../docs/schema.md), "Zalo configuration"); `config/synthetic-brands.json` holds two synthetic brands, the only ones CI uses. Generated files are gitignored. Reading the rows from the database for a deploy is the job of `fnb zalo app-config`, which is not built yet.

## Tests

| File | Proves |
|---|---|
| `test/unit/app-config.test.ts` | the generated file per brand, the title, colour and contrast rules, the list and the comparison |
| `test/unit/vite-plugin.test.ts` | the variables and their defaults, the mocked SDK in the browser, the synthetic configuration, the refused imports, a Development-only marker failing a Testing build, the deployed `app-config.json` |
| `test/unit/budget.test.ts` | the per-file and per-version limits, an empty or missing build, a forbidden package found anywhere in the runtime dependency graph, each with a throwaway fixture, and the paint budget's limits |
| `test/unit/session-client.test.ts`, `native-storage.test.ts` | binding, unpaired and refused answers, a rejected code, a stored session reused while fresh and minted again after it expires, network and Zalo failures; the storage adapters |
| `test/unit/no-web-storage.test.ts` | no LocalStorage, SessionStorage, IndexedDB or cookie in any shipped file of the package and both apps |
| `test/unit/mock-sdk.test.ts`, `shell.test.tsx`, `i18n.test.ts` | the recorded calls; the tab rules; the translator and the parity of the shared catalogues |

## Who uses it

`apps/zalo-staff` and `apps/zalo-customer`; CI's `mini-apps` job and `deploy-mini-apps.yml` call its budget check and, in CI, its `app-config` command. [development.md](../../docs/development.md), section 6, has the recipe "Add a Mini App screen".
