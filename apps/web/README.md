# Web app (`@fnb/web`)

Vite + React + TypeScript single-page app for managers, deployed to GitHub Pages. The contract is `docs/web-app.md`; metric definitions are in `docs/metrics.md`.

## Modes

- **Live** — when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are both non-empty at build time. Users sign in with e-mail and password (PKCE flow, persisted session) and every number is read as the signed-in user through row-level security.
- **Demo** — when either value is empty (the Pages build before the repository variables exist). There is no login; a fixed demo tenant with the stores of `@fnb/connector-mock` is generated in the browser from a fixed seed, anchored to today in Asia/Ho_Chi_Minh. A live build also offers "Xem bản demo" on the login page for the browser session. The demo module and the generator load through a dynamic import and never call the network; a demo build adds a `modulepreload` link for that module to `index.html`, so it downloads alongside the entry chunk.

## Commands

```sh
pnpm --filter @fnb/web dev          # serves against the values in apps/web/.env.local (copy .env.example)
pnpm --filter @fnb/web build        # vite build, then the bundle and size checks below
pnpm --filter @fnb/web test         # Vitest with jsdom
pnpm --filter @fnb/web test:e2e     # Playwright: live project on :5191 (local stack), demo project on :5192, pages project on :5193
pnpm --filter @fnb/web e2e:install  # once: the Chromium build Playwright needs
pnpm --filter @fnb/web icons:render # redraws the PNG icons and favicon.ico from public/favicon.svg
```

`VITE_BASE_PATH` sets the base path (default `/`); routing uses the hash (`#/…`), so no `404.html` is needed. The build writes `dist/version.json`; the app compares it on window focus and offers "Có phiên bản mới — tải lại". The pages project builds the demo under `/fnb-manager/` into `node_modules/.cache/pages-demo`, serves it with `vite preview` and checks that the favicon, touch icon, manifest and manifest icons resolve under that base path.

## Icons, manifest and print

`public/favicon.svg` is the only drawn icon. After changing it, run `icons:render` and commit the regenerated `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`; the script uses the Chromium that Playwright installs and adds no dependency. `public/manifest.webmanifest` uses relative `start_url` and `scope`, so it works under any base path, and takes its colours from the `--surface` token (checked by `src/shell/install-assets.test.ts`). There is no service worker. The print stylesheet at the end of `src/styles.css` prints A4 pages black on white without navigation, banners or buttons.

## Lighthouse

Lighthouse is not a dependency. Measure the Pages demo the way `deploy-web.yml` builds it, with the mobile defaults and Playwright's Chromium, then rebuild the default `dist`:

```sh
VITE_BASE_PATH=/fnb-manager/ VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= pnpm --filter @fnb/web build
VITE_BASE_PATH=/fnb-manager/ pnpm --filter @fnb/web preview      # serves http://localhost:4173/fnb-manager/
CHROME_PATH="$(cd apps/web && node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath())")" \
  pnpm dlx lighthouse@13.5.0 http://localhost:4173/fnb-manager/ --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new"
pnpm --filter @fnb/web build
```

The phase 6 targets are performance ≥ 85 and accessibility ≥ 90. SEO stays low on purpose: the app sends `noindex`.

## Build checks

Both run after every `build` and can be run alone on an existing `dist`.

- `scripts/check-bundle.mjs` scans every text file in `dist` for e-mail addresses, UUIDs that are not synthetic (`aaaaaaaa-…` style or nil), JWTs, `sb_secret_` keys and 32-hex strings, and fails on any hit without printing the value. In a live build the publishable key and the Supabase URL used for that build (read with Vite's `loadEnv`, so environment variables win over `.env.local`) are allowed by exact match only.
- `scripts/check-size.mjs` reads `dist/.vite/manifest.json` and fails when the JavaScript outside the lazily loaded ECharts and demo chunks exceeds 400 kB gzipped. supabase-js loads through a dynamic import only in a configured build; the check still counts it as initial JS. zod is part of the initial JS in every build, because `@fnb/core` creates its schemas when the module loads.

## Layout of `src`

| Folder | Content |
|---|---|
| `data/` | `RowSource` interface, the Supabase implementation (lazily loaded; sales tables paged by keys that survive a re-sync, small tables with `.range()` and a stable order) and the provider |
| `demo/` | The demo `RowSource` (dynamically imported) |
| `metrics/` | The one metrics module for Hôm nay (`today.ts`), sentence templates selection, verification and the registry |
| `components/report-card/` | `ReportCard` and its parts; ECharts is lazy-loaded from `echarts-view.tsx`; `table-scroller.tsx` keeps wide tables scrolling inside their card |
| `shell/`, `auth/`, `pages/`, `state/` | Layout, sign-in screens, routes and preferences |
| `i18n/` | `vi.json`, `en.json` and `t()`; a test fails on missing keys and on JSX text that bypasses `t()` |
