# Web app specification (apps/web)

Scope: roadmap phases 6 (foundation and "Hôm nay"), 9 (periodic reports), 10 (thematic reports, settings), 11 (exports, data pack, Kế hoạch). This document is the contract the builders implement; `docs/metrics.md` defines every number shown, `docs/schema.md` the tables and functions read.

## Stack and constraints

- Vite + React + TypeScript, deployed to GitHub Pages by `.github/workflows/deploy-web.yml` (the workflow builds `apps/web` when `apps/web/package.json` exists; `VITE_BASE_PATH` comes from the Pages configuration, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from repository variables).
- Routing: hash router (`#/…`) so a project-site base path and the fixed Pages 404 behaviour never matter; supabase-js configured with `flowType: 'pkce'` so auth redirects do not collide with the hash (ADR-023). Password-reset and invite links must be tested on the deployed path.
- Data access: supabase-js only, as the signed-in user; row-level security carries the protection, so the bundle may contain the publishable key and nothing else. Reads go to the phase 8 functions and aggregate tables; writes only to the manual-data tables, consent/data-subject tooling and `strategy_reports`. Lists paginate with a stable order under the 1,000-row API default.
- State: tenant (from membership; a selector appears only when the user belongs to several), selected stores (multi-select with "Tất cả"), period (ngày / tuần / tháng / năm / tuỳ chọn), language (vi default, en), persisted in `localStorage` as conveniences only.
- Formatting through `Intl` with the tenant's locale and currency: VND shows no decimals and large values use a compact "tr ₫" / "tỷ ₫" headline form with the exact value in a tooltip; dates `dd/MM/yyyy`; weekdays in Vietnamese; percentages one decimal. No currency or locale string is hard-coded.
- Internationalisation: `src/i18n/vi.json` and `src/i18n/en.json` with a completeness test (every key in both; every user-visible string through `t()`); report sentences and metric explanations are templates in these files, not code.
- Performance: initial JS ≤ 400 kB gzipped excluding the lazily loaded ECharts chunk; Lighthouse mobile performance ≥ 85, accessibility ≥ 90; axe with no serious violations; WCAG 2.1 AA contrast; 16 px side gutters; no horizontal scroll at 360 px.
- Freshness: `version.json` written at build time; the app compares it on focus and shows "Có phiên bản mới — tải lại" because Pages caches `index.html` for ten minutes.
- No comments in code; descriptive names and small components instead.

## Routes

| Hash route | Screen | Phase |
|---|---|---|
| `#/dang-nhap` | Login (email + password), password reset request | 6 |
| `#/` | Hôm nay — today per store vs the same-weekday median baseline, freshness and verified badges | 6 |
| `#/bao-cao/ngay`, `#/bao-cao/tuan`, `#/bao-cao/thang`, `#/bao-cao/nam` | Periodic reports | 9 |
| `#/chu-de/doanh-thu`, `#/chu-de/gio-ngay`, `#/chu-de/thuc-don`, `#/chu-de/thanh-toan` | Thematic reports I | 10a |
| `#/chu-de/khuyen-mai`, `#/chu-de/ca-ket-tien`, `#/chu-de/so-sanh`, `#/chu-de/chat-luong` | Thematic reports II | 10b |
| `#/cai-dat/cua-hang`, `#/cai-dat/du-lieu-nhap-tay`, `#/cai-dat/phan-loai`, `#/cai-dat/ngay-le`, `#/cai-dat/canh-bao`, `#/cai-dat/phap-ly` | Settings: store profile, manual data (costs, targets, fee rates), item-type roles and category mapping, holidays, alerts, legal texts and consent | 10b, 12 |
| `#/xuat-du-lieu` | Exports and the AI data pack | 11a |
| `#/ke-hoach`, `#/ke-hoach/:id` | Saved strategy plans, KPI follow-up, paste box | 11b |

Deep links carry store, period and date in the query part of the hash (`#/bao-cao/thang?store=…&month=2026-10`).

## Layout

Mobile first. A top bar with the tenant and store selector, period picker and language toggle; a bottom navigation on phones (Hôm nay, Báo cáo, Chủ đề, Kế hoạch, Cài đặt) and a side rail on wider screens. Every report page is a vertical stack of report cards.

## ReportCard contract

Every report is built from one component with these parts, in this order:

1. **Headline** — one metric from the registry, formatted compactly, with the exact value on hover.
2. **Comparison chips** — vs previous period and, when history exists, vs same period last year or the same-weekday baseline; colour follows the metric's `direction` from the registry (higher-is-better green when up).
3. **Sentence** — one plain-language explanation generated from a template in the i18n file with driver attribution (which weekday, category or item moved the number most), rendered from the data, never from a model.
4. **Chart** — ECharts, lazy-loaded, with the accessible table underneath as the fallback.
5. **Table** — sortable, with a CSV download (UTF-8 with BOM) of exactly the rows shown.
6. **Giải thích chỉ số** — collapsed definitions from the registry (formula, grain, convention, what is missing when provisional).

Cards show a `provisional` marker when the registry says an input is missing (no costs, no seats, no customer identity) and a `chưa đối soát` marker when the underlying days are not verified.

## Data access

| Need | Source |
|---|---|
| Today and day comparisons | `v_recent_daily_sales`, `v_recent_hourly_sales`, `same_weekday_baseline` |
| Period reports | `period_compare`, `period_summary`, `month_pace`, aggregate tables for charts |
| Hours and weekdays | `hour_weekday_heatmap`, `agg_hourly_sales` |
| Menu | `agg_item_daily`, `item_velocity`, `menu_matrix`, `agg_size_mix_daily`, `agg_attach_daily`, `agg_basket_pairs_28d`, `agg_modifier_prefs_daily` |
| Payments and cash | `agg_payment_daily`, `agg_shift_cash`, `cash_variance_flags` |
| Promotions | `agg_daily_sales` discount columns, `promotions` |
| Data quality | `items`, `item_type_roles`, `sync_checks`, `stores` compliance fields |
| Freshness and verification | `sync_runs`, `sync_checks` |
| Settings writes | `item_costs`, `targets`, `payment_fee_rates`, `item_type_roles`, `holidays`, `stores`, `notification_channels`, `alert_rules`, `consent_records`, `data_subject_requests` |
| Plans | `strategy_reports` |

Queries run with the signed-in session; the app never holds a service key.

## Local development

`pnpm db:start` then `pnpm db:reset` seeds a demo tenant with two stores and a development login (`dev@example.com`, password constant at the top of `supabase/seed.sql`). `pnpm --filter @fnb/web dev` serves the app against the local stack using the values in `apps/web/.env.local` (copied from `apps/web/.env.example`, filled from `pnpm db:status`); Playwright smoke tests use the same login.

## Testing

- Vitest + Testing Library for `ReportCard`, the period picker, formatters, the sentence generator and the i18n completeness check.
- Playwright: login, store switch, language toggle, "Hôm nay" render and one spec per report page against the seeded local stack; axe checks on every page.
- A bundle check fails the build when `dist` contains an e-mail address, a UUID that is not synthetic or a secret-shaped string.

## Acceptance (phase 6)

The Pages URL loads and login works on a phone · no session returns zero rows from every view · the language toggle covers every string · Lighthouse and axe thresholds met · "Hôm nay" equals the POS overview for the same day on the live tenant · a password reset completes on the deployed site.

## Phase 6 decisions

Points the specification leaves open, as built in phase 6:

- **Row source.** Hôm nay reads the fact tables (`invoices`, `invoice_lines`, `invoice_payments`, `payment_methods`, `holidays`, `sync_runs`, `sync_checks`) through one `RowSource` interface and computes every number client-side in one metrics module (`src/metrics/today.ts`), because the phase 8 SQL layer was still changing. Phase 9 switches the Supabase implementation to `v_recent_daily_sales`, `v_recent_hourly_sales` and `same_weekday_baseline` without touching the screens. The demo is the second implementation.
- **Paging the sales tables.** The sync deletes and re-inserts the lines and tenders of every upserted invoice, so their `id` changes on each run. Invoices, lines and tenders are therefore read with keyset pagination on keys that survive a re-sync — `id` for `invoices`, (`invoice_id`, `external_id`) for `invoice_lines`, (`invoice_id`, `sequence_no`) for `invoice_payments` — and rows are de-duplicated by that key, so a sync committing between two page requests neither drops nor doubles a row.
- **Baseline for an unfinished day.** Today's cards compare the sales so far with the same-weekday median of the previous 8 weeks **up to the same time of the business day** ("so với mức nền cùng thứ đến 10:15"); yesterday compares whole days. The hourly baseline curve is always the whole-day median per hour. With several stores the days are summed per date before the median, and the average-ticket baseline is the median of the daily averages, matching `same_weekday_baseline()`.
- **Hour axis.** Hours come from `sold_at` in the store time zone and the axis starts at the hour of the first selected store's `business_day_start_minutes`, so a 00:30 sale under a 05:00 day start appears at the end of its business day. Today's curve ends at the current hour; later hours have no value (a gap in the chart, "—" in the table) instead of zero.
- **Badges.** The freshness badge sits in the top bar and uses the latest `sync_runs` row with status `succeeded` for the tenant. The verified badge sits on each day section of Hôm nay (today, yesterday) and reads "đã đối soát" only when every selected store-day of that section has a matched `sync_checks` row; cards repeat "chưa đối soát" as their marker. In demo mode both badges read "dữ liệu mẫu".
- **Period picker.** Shown on every route whose period is selectable; hidden on Hôm nay, whose days are fixed. The stored period keeps its kind and custom range, but a day, week, month or year anchor chosen on an earlier day moves to today when the app loads.
- **Top bar on phones.** Below 1024 px the store, tenant and period controls fold into one summary button ("Tất cả · Ngày 08/11/2026") that opens them, so the sticky bar stays short; from 1024 px they are always shown. The demo banner sits inside the sticky bar (a one-line form on phones) so it stays visible at every scroll position, and the new-version prompt is a toast above the bottom navigation on every screen, sign-in screens included.
- **Page titles and focus.** Every screen sets the document title to "<screen> · FNB Manager" in the current language and moves focus to its heading after an in-app navigation.
- **Compact money.** The number uses the tenant locale; the unit word comes from the interface language (`tr` / `tỷ` in Vietnamese, `M` / `B` in English).
- **Auth routes.** `#/dang-nhap` (login), `#/quen-mat-khau` (reset request; the e-mail link returns to `#/mat-khau-moi`), `#/mat-khau-moi` (new password after the recovery link).
- **Demo mode.** A build without `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` starts in demo mode: no login, a fixed VND demo tenant with the two stores of `@fnb/connector-mock`, rows generated in the browser from seed 20261108 for today (cut at the current time), yesterday and the eight same-weekday dates before each, a persistent bilingual banner. A configured build offers "Xem bản demo" on the login page for the browser session, with "Thoát bản demo" in the top bar. Each generated store-day is cached and produced in its own task, so the generator never blocks the main thread for long; a demo build preloads the demo module from `index.html`.
- **Icons and install.** `public/favicon.svg` (a bar chart on the accent colour, no shop name) is the only drawn source; `scripts/render-icons.mjs` renders `favicon.ico` (16, 32 and 48 px), `apple-touch-icon.png` (180 px) and the manifest icons (192 and 512 px, plus a maskable 512 px with the glyph inside the safe zone) with Playwright's Chromium, and the PNGs are committed. `manifest.webmanifest` names the app "FNB Manager" (short name "FNB"), opens standalone, and keeps `start_url` and `scope` relative to the manifest, so the same file works at `/` and under the Pages base path. Theme and background colours are the light `--surface` token, and `index.html` sets `theme-color` per colour scheme; a unit test keeps these in step with `styles.css`. There is no service worker.
- **Print.** A4 portrait with 12 mm margins. The colour tokens switch to black on white whatever the screen scheme; the navigation, the demo banner, the new-version prompt, buttons, form controls and closed "Giải thích chỉ số" panels are not printed; the store and period summary prints as a line of text; report grids print one card per row and a card is not split across pages when it fits on one. Charts keep their on-screen size and redraw with a print palette (black text, grey grid lines) for the duration of the print.
- **Tables on phones.** A report-card table that is wider than its card scrolls inside the card, never the page. The first column stays pinned while the rest scrolls, a fade with a chevron on the right edge shows that more columns follow and disappears at the last column, and the sort buttons stay reachable by keyboard. Playwright checks at 360 px that the last column of every table can be brought into view and that the page itself never scrolls sideways.
