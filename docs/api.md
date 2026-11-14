# Database API

This page is the reference for anyone who builds a client of the FNB Manager database. It covers how to call the database, how sign-in and roles decide what a caller sees, every function in the `public` schema that a signed-in user may execute, the tables and views that PostgREST serves, and the Edge Function endpoints. It is written for a developer taking the work over, for reviewers and testers, and for whoever runs the platform after go-live. The owner needs only [Authentication and roles](#2-authentication-and-roles). Column meanings and computation rules stay in [`schema.md`](schema.md), metric definitions in [`metrics.md`](metrics.md) and the numbered requirements in [`requirements.md`](requirements.md); this page says how to call them.

Last updated 2026-11-12

**Status on 2026-11-12.** The 25 functions on this page and the tables of phases 2, 7, 8 and 9 are verified locally on the Supabase stack (pgTAP, the parity suite and the end-to-end tests). The notification tables of phase 12 are verified locally for step 12a and in build for step 12b. The functions for the Settings → Cảnh báo screen and the Bản tin panel are planned for step 12c. Those of phases 10 and 11 are designed at roadmap level; their detailed design is pending. No cloud project exists yet, so every cloud endpoint below waits for owner ([`go-live.md`](go-live.md)). `pnpm docs:check-api` compares every signature on this page with the database ([section 7](#7-keeping-this-page-current)).

## Contents

1. [How clients call the database](#1-how-clients-call-the-database)
2. [Authentication and roles](#2-authentication-and-roles)
3. [Functions in `public`](#3-functions-in-public)
4. [Tables and views](#4-tables-and-views)
5. [Edge Function endpoints](#5-edge-function-endpoints)
6. [Command line](#6-command-line)
7. [Keeping this page current](#7-keeping-this-page-current)
8. [OpenAPI (Swagger) description](#8-openapi-swagger-description)

## 1. How clients call the database

```mermaid
flowchart LR
  W["Web app<br/>supabase-js"] -- "publishable key<br/>and session token" --> P["PostgREST<br/>/rest/v1"]
  P -- "role authenticated" --> D[("Postgres<br/>schema public with RLS")]
  J["fnb CLI and<br/>GitHub Actions jobs"] -- "DATABASE_URL or<br/>SUPABASE_DB_URL as postgres" --> D
  S["pg_cron and pg_net"] -- "POST ticket" --> E["Edge Function<br/>sync-incremental"]
  E -- "SUPABASE_DB_URL<br/>as postgres" --> D
```

| Endpoint | Path | Local stack (`supabase/config.toml`) |
|---|---|---|
| PostgREST: tables, views, functions | `<SUPABASE_URL>/rest/v1/` | `http://127.0.0.1:54321/rest/v1/` |
| Supabase Auth: sign-in, sessions, password reset | `<SUPABASE_URL>/auth/v1/` | `http://127.0.0.1:54321/auth/v1/` |
| Edge Functions | `<SUPABASE_URL>/functions/v1/<name>` | `http://127.0.0.1:54321/functions/v1/<name>` |
| Postgres, direct | `DATABASE_URL` or `SUPABASE_DB_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (the value in `.env.example`) |

On the cloud project `<SUPABASE_URL>` is `https://<ref>.supabase.co`, and the jobs use the session-pooler string that [`secrets.md`](secrets.md) describes. PostgREST serves the schemas `public` and `graphql_public` only (`[api] schemas`). The schema `app` is not served, so none of its functions can be called through the API, even those that `authenticated` may execute. No client in this repository uses the GraphQL endpoint.

### Calling a function from the browser

The web app creates one client (`apps/web/src/lib/supabase.ts`):

```ts
createClient(url, publishableKey, {
	auth: {
		flowType: "pkce",
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});
```

`supabase.rpc(name, args)` sends `POST /rest/v1/rpc/<name>` with the arguments as one JSON object.

- Pass arguments by their exact names (`store_ids`, `from_date`, …). Leave an argument out to get its default. PostgREST picks the function by its name and the set of argument names; when none matches it answers `PGRST202`.
- Send dates as `"YYYY-MM-DD"`, a `uuid[]` as a JSON array of strings, and an enum as its label (`"month"` for `period_kind`).
- A function that returns `TABLE(…)` gives `data` as an array of row objects. A scalar function gives the bare value: `metric_value` returns a number or `null`.
- Money is `numeric(14,2)` in the tenant's currency. Shares and rates are fractions: `0.25` is 25 %. PostgREST sends `numeric` and `bigint` as JSON numbers; postgres.js returns them as strings. The shared contract accepts both (`numberLike` in `packages/reports/src/contract/values.ts`).

```ts
const { data, error } = await supabase.rpc("period_compare_by_store", {
	store_ids: ["11111111-1111-4111-8111-111111111111"],
	grain: "week",
	anchor: "2026-11-11",
});
```

Tables and views are read with `supabase.from(table).select(columns)` and filters, which sends `GET /rest/v1/<table>?select=…`. Page through them ([the 1,000-row cap](#the-1000-row-cap)).

### The typed client in `@fnb/reports`

`createRpcAnalyticsSource(client, kind)` (`packages/reports/src/source/rpc-source.ts`) wraps any object that has an `rpc(fn, args)` method. For the 16 report functions it:

1. validates the arguments against the zod schemas of `analyticsFunctions` (at most 50 store ids, ISO dates, known grains) and drops `undefined` ones, so defaults apply;
2. calls the function and parses every row;
3. throws `AnalyticsCallError`, whose `code` is the SQLSTATE or PostgREST code, or `invalid_arguments`, `invalid_rows` or `possible_truncation`.

`isArgumentLimitError(error)` is true for `22023`. The web app wraps the supabase-js client (`apps/web/src/data/supabase-analytics-source.ts`). The notification code wraps a Postgres transaction (`packages/notify/src/digest/json-source.ts`). Demo mode uses `createDemoAnalyticsSource` from `@fnb/demo-analytics`, which answers the same calls in the browser with no network call.

### Calling a function as a member from a server

The `fnb` CLI, the GitHub Actions jobs and the Edge Function connect to Postgres as `postgres`, which owns every table and bypasses RLS. When server code needs a member's numbers, as for the daily digest, which is built as its recipient, it switches to that member inside a read-only transaction (`packages/notify/src/postgres/member-snapshot.ts`):

```sql
set local role authenticated;
set local time zone 'UTC';
select set_config('request.jwt.claims', '{"sub": "<member user id>", "role": "authenticated"}', true);
select * from public.hourly_profile('{11111111-1111-4111-8111-111111111111}', '2026-11-11');
```

Inside that transaction `auth.uid()` returns the member, and every policy applies as it does in the browser.

### The 1,000-row cap

`supabase/config.toml` sets `max_rows = 1000` under `[api]`. PostgREST then returns at most 1,000 rows for one request to a table, a view or a function that returns rows, and it cuts without an error. The cloud project has its own "Max rows" setting; keep it at 1,000, because the guard below assumes at least 900.

- **Tables and views:** page through them. The web app reads pages of `PAGE_SIZE = 1000` (`apps/web/src/data/paginate.ts`). It pages the sales tables by keys that survive a re-sync: `id` for `invoices`, (`invoice_id`, `external_id`) for `invoice_lines` and (`invoice_id`, `sequence_no`) for `invoice_payments`. Other tables are paged with `.range()` over a stable order. A short page ends the read.
- **Report functions (phase 9):** those whose result can grow (`period_series`, `item_summary`, `payment_summary`, `promotion_summary`, `shift_review`, `item_lifecycle`) refuse with `22023` a call that would return more than 900 rows (`app.require_report_rows`) and say how many rows it needs, so a result is never cut silently. The others stay far below 900 through their own limits.
- **Phase 8 functions** have no such guard. `hour_weekday_heatmap` returns at most 168 rows (7 weekdays × 24 hours) and the summaries one to four rows, but `cash_variance_flags` over a long range, and `item_velocity` or `menu_matrix` for a large menu, can pass 1,000. Treat 1,000 rows as possibly cut, as `createRpcAnalyticsSource` does (`TRUNCATION_ROW_LIMIT = 1000`, code `possible_truncation`).

### Errors

supabase-js returns `{ data: null, error }`, where `error` has `code`, `message`, `details` and `hint`. A database error carries its SQLSTATE in `code`; PostgREST's own errors carry a `PGRST…` code. PostgREST sets the HTTP status from the code: `22023` and `P0001` give 400; `42501` gives 401 without a session and 403 with one; `23505` and `23503` give 409; `PGRST202` gives 404 ([PostgREST error reference](https://docs.postgrest.org/en/stable/references/errors.html)).

| Code | Meaning | Raised by | What the client does |
|---|---|---|---|
| `22023` | invalid parameter value: an argument breaks a limit; the message names the limit, and the 900-row case adds a hint | the checks of every report function (store count, date range, grain, `weeks`, metric ids, compare range, rows); `metric_value` (unknown metric id, reversed range); `metric_compare` (1 to 25 ids); the validation trigger of `alert_rules` | do not retry; ask for fewer stores or a shorter period, as the web app does with `report.card.overLimit` |
| `P0001` | raise exception: a check written without its own code | `period_compare` (unknown grain); `refresh_my_analytics` (missing or reversed range, more than 92 days); the update trigger of `consent_records` (only `revoked_at` may change, once) | correct the call |
| `42501` | insufficient privilege | any call without a session; `refresh_my_analytics` by someone who is not an owner or manager; an insert or update whose new row fails a policy ("new row violates row-level security policy") | sign in, or check the member's role and store scope |
| `23505`, `23503`, `23514`, `23502` | unique, foreign-key, check or not-null violation | writes to the tables under [Writes through tables](#writes-through-tables) | correct the row |
| `PGRST202` | no function has that name and those argument names | PostgREST | compare the call with the signatures below |

An update or a delete that matches no row the caller may see changes nothing and returns no error. Ask for the changed rows (`.select()` after `.update()`) when the client must know. The `outbound_messages` guard raises `55000`, but only server code writes that table.

## 2. Authentication and roles

### Sign-in

- Supabase Auth with e-mail and password. Sign-up is off (`enable_signup = false`). A login exists only after `fnb tenant add-member --tenant <slug> --email <address> --role <role> [--password <p> | --invite]` creates it, which needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the owner's machine.
- The browser uses the PKCE flow, keeps the session in browser storage and refreshes it. A password reset (`#/quen-mat-khau`) sends an e-mail link that returns to `#/mat-khau-moi`.
- The browser holds only the publishable key (`sb_publishable_…`), which is public by design and grants nothing by itself. The secret key (`sb_secret_…`) bypasses RLS and never reaches a client ([`secrets.md`](secrets.md)).
- A login without a membership reads nothing. The web app then says "Tài khoản này chưa thuộc chủ sở hữu nào. Liên hệ người quản trị để được cấp quyền." (`shell.noMembership`).

### Database roles

| Role | Who uses it | What it reaches |
|---|---|---|
| `anon` | a request without a session | nothing: no privilege on any table or view, and no `EXECUTE` on any function in `public` or `app` |
| `authenticated` | a signed-in login: the web app, or server code acting as a member | `SELECT` on every table and view in `public` except `pos_account_tokens` and `sale_payloads`, and on 20 columns of `notification_channels` only; the writes under [Writes through tables](#writes-through-tables); `EXECUTE` on the 25 functions below; always filtered by RLS |
| `service_role` | the secret key | bypasses RLS; no client reads data with it, and `fnb tenant add-member` uses it only to create logins through the Auth admin API |
| `postgres` | `DATABASE_URL` or `SUPABASE_DB_URL`: the `fnb` CLI, the GitHub Actions jobs, the Edge Function and `pg_cron` | owns every table and function and bypasses RLS; the only role that may run the schedule and notification functions in `app` |

### Tenant roles

A login holds one role per tenant in `tenant_members`, with an optional store scope. `owner`, `manager`, `staff` and `viewer` are the data roles (`app.data_roles()`). `publisher` stays outside them, so a leaked publisher credential reads no sale (ADR-013).

| Role | Reads | Writes from a client |
|---|---|---|
| `owner` | everything of its tenant within its store scope: sales, aggregates, catalogue, sync state, manual inputs, plans and consent records; data-subject requests when its scope is unlimited; alert rules, policies, alert events, digests, destinations and messages ([section 4](#4-tables-and-views)) | manual inputs and plans within its scope; consent records; data-subject requests, `alert_rules` and `channel_policies` when its scope is unlimited; `refresh_my_analytics` |
| `manager` | the same as `owner` | the same as `owner`, except `alert_rules` and `channel_policies`, which it only reads |
| `staff` | sales, aggregates, catalogue, sync state, manual inputs, plans and consent records within its scope; its own destinations and the messages sent to them | nothing |
| `viewer` | the same as `staff` | nothing |
| `publisher` | `tenants`, the `stores` in its scope, `strategy_reports`, `holidays`, `dim_calendar`, `alert_rule_catalog` and the global `channel_policies`; no sale, aggregate, refresh log or live view, and not `tenant_members` | inserts into `strategy_reports` within its scope |

### Store scope

`tenant_members.store_ids` null means every store of the tenant; otherwise the member sees and manages only the listed stores. Store-scoped tables filter on `store_id` and tenant-wide tables on `tenant_id`. A row with a null `store_id` in `item_costs`, `payment_fee_rates`, `strategy_reports` or `alert_rules` applies to the whole tenant: every member who may read the table sees it, and only a member with an unlimited scope may write it. `item_type_roles` and tenant `holidays` also need an unlimited scope. `created_by` defaults to `auth.uid()`, must equal the caller on insert, and is frozen afterwards.

### How RLS shapes function results

- 24 of the 25 functions are `security invoker`: every table they read applies the caller's policies. The `store_ids` a caller passes are a request, not a grant. A store the caller may not read adds nothing, and no error says so.
- The report functions return per-store rows only for stores that the caller sees in `stores`, once each, in the order of their first position in `store_ids`. A publisher, who sees stores but no sale, gets those rows with null totals and no item, payment, promotion or shift row.
- A total is null, not 0, when its range holds no data that the caller may read.
- `refresh_my_analytics` is the only `security definer` function. It checks the caller's role itself.

## 3. Functions in `public`

The schema `public` holds 35 functions. `authenticated` and `service_role` may execute all of them; `anon` may execute none. 34 are `security invoker` and `stable`; `refresh_my_analytics` is `security definer` and `volatile`. All of them set an empty `search_path`. No name is overloaded.

Each entry gives the signature exactly as Postgres prints it (`pg_get_function_arguments` and `pg_get_function_result`), then what calls it today, its status and notes. Column meanings and computation rules are in [`schema.md`](schema.md), sections "Query functions" and "Report functions (phase 9)"; report rules are in [`metrics.md`](metrics.md#report-conventions).

**Who may call.** Any signed-in member may call the 34 invoker functions. The numbers cover only the stores that the caller's data role reads, so a publisher gets nulls or no rows (see [How RLS shapes function results](#how-rls-shapes-function-results)). `refresh_my_analytics` has its own rule.

**Callers named below.**

- **Web reports:** the Ngày, Tuần, Tháng and Năm pages in live mode, through `supabase.rpc()` and `createRpcAnalyticsSource`.
- **Web themes:** the thematic pages under `#/chu-de` in live mode, through `createRpcReportSource`, which serves both the report and the theme registries.
- **Digest:** the daily digest, which `fnb digest` and `fnb notify tick` build by running the Ngày report as the member (`@fnb/notify`; step 12b, in build). It therefore makes every call that Ngày makes.
- **Demo port:** the TypeScript copy in `@fnb/demo-analytics` that demo mode runs in the browser. The parity suite holds it to the SQL.

| Function | Group | Security | Returns | Called today by | Status |
|---|---|---|---|---|---|
| [`same_weekday_baseline`](#publicsame_weekday_baseline) | analytics | invoker, stable | 1 row | SQL: `period_compare`, `period_compare_by_store` | verified locally (phase 8) |
| [`period_summary`](#publicperiod_summary) | analytics | invoker, stable | 1 row | SQL: `metric_value` | verified locally (phase 8) |
| [`weekday_profile_forecast`](#publicweekday_profile_forecast) | analytics | invoker, stable | `numeric` | no caller yet | verified locally (phase 8) |
| [`seasonal_naive_forecast`](#publicseasonal_naive_forecast) | analytics | invoker, stable | `numeric` | no caller yet | verified locally (phase 8) |
| [`hour_weekday_heatmap`](#publichour_weekday_heatmap) | analytics | invoker, stable | up to 168 rows | web theme Giờ & ngày | verified locally (phase 8) |
| [`menu_matrix`](#publicmenu_matrix) | analytics | invoker, stable | rows per item | no caller yet (designed for 10a) | verified locally (phase 8) |
| [`cash_variance_flags`](#publiccash_variance_flags) | analytics | invoker, stable | flagged shifts | no caller yet (designed for 10a, 10b) | verified locally (phase 8) |
| [`store_coverage`](#publicstore_coverage) | reports | invoker, stable | rows per store | web reports, digest | verified locally (phase 9) |
| [`period_compare`](#publicperiod_compare) | reports | invoker, stable | 3 or 4 rows | web reports, digest | verified locally (phase 8) |
| [`period_compare_by_store`](#publicperiod_compare_by_store) | reports | invoker, stable | rows per store and period | web reports, digest | verified locally (phase 9) |
| [`period_series`](#publicperiod_series) | reports | invoker, stable | rows per bucket | web reports, digest, web themes Doanh thu and Thanh toán | verified locally (phase 9) |
| [`daily_baselines`](#publicdaily_baselines) | reports | invoker, stable | rows per date | web reports | verified locally (phase 9) |
| [`hourly_profile`](#publichourly_profile) | reports | invoker, stable | 24 rows | web reports, digest | verified locally (phase 9) |
| [`item_summary`](#publicitem_summary) | reports | invoker, stable | rows per item | web reports, digest | verified locally (phase 9) |
| [`payment_summary`](#publicpayment_summary) | reports | invoker, stable | rows per payment method | web reports, digest, web theme Thanh toán | verified locally (phase 9) |
| [`promotion_summary`](#publicpromotion_summary) | reports | invoker, stable | rows per promotion | web reports, digest | verified locally (phase 9) |
| [`shift_review`](#publicshift_review) | reports | invoker, stable | rows per shift | web reports, digest | verified locally (phase 9) |
| [`store_targets`](#publicstore_targets) | reports | invoker, stable | rows per store | web reports | verified locally (phase 9) |
| [`item_velocity`](#publicitem_velocity) | reports | invoker, stable | rows per item | web reports | verified locally (phase 8) |
| [`month_pace`](#publicmonth_pace) | reports | invoker, stable | 1 row | web reports | verified locally (phase 8) |
| [`forecast_accuracy`](#publicforecast_accuracy) | reports | invoker, stable | 2 rows | web reports | verified locally (phase 8) |
| [`item_lifecycle`](#publicitem_lifecycle) | reports | invoker, stable | rows per item | web reports | verified locally (phase 9) |
| [`metric_value`](#publicmetric_value) | metric_value | invoker, stable | `numeric` | SQL: `metric_compare`; `fnb digest --check-ngay` | verified locally (phase 8) |
| [`metric_compare`](#publicmetric_compare) | metric_value | invoker, stable | rows per metric and period | web reports, digest | verified locally (phase 9) |
| [`refresh_my_analytics`](#publicrefresh_my_analytics) | settings and writes | definer, volatile | `bigint` | no caller yet | verified locally (phase 8) |
| [`analytics_catch_up_status`](#publicanalytics_catch_up_status) | settings and writes | invoker, stable | 0 or 1 row | no caller yet (Settings, phase 10a) | verified locally (phase 10a) |
| [`report_settings_of`](#publicreport_settings_of) | themes | invoker, stable | rows per store | web themes Giờ & ngày, Thực đơn and Thanh toán | verified locally (phase 10a) |
| [`range_totals`](#publicrange_totals) | themes | invoker, stable | rows per range and store | web themes Doanh thu and Thanh toán | verified locally (phase 10a) |
| [`opening_productivity`](#publicopening_productivity) | themes | invoker, stable | rows per store | web theme Giờ & ngày | verified locally (phase 10a) |
| [`hour_profile`](#publichour_profile) | themes | invoker, stable | up to 82 rows | web theme Giờ & ngày | verified locally (phase 10a) |
| [`menu_engineering`](#publicmenu_engineering) | themes | invoker, stable | rows per item | web theme Thực đơn | verified locally (phase 10a) |
| [`item_margins`](#publicitem_margins) | themes | invoker, stable | rows per item | web theme Thực đơn | verified locally (phase 10a) |
| [`item_attach`](#publicitem_attach) | themes | invoker, stable | 1 row, then rows per drink | Thực đơn (attach rates, last 92 days and the 92 before) | verified locally (phase 10a) |
| [`basket_pairs`](#publicbasket_pairs) | themes | invoker, stable | up to 900 pairs | Thực đơn (items sold together, last 92 days, 3 invoices, top 50) | verified locally (phase 10a) |
| [`modifier_summary`](#publicmodifier_summary) | themes | invoker, stable | rows per modifier name | Thực đơn (sugar and ice, with the previous range) | verified locally (phase 10a) |

### 3.1 Analytics

Phase 8 query functions. The theme Giờ & ngày trong tuần reads `hour_weekday_heatmap`; the later thematic reports are planned to read `menu_matrix` and `cash_variance_flags` ([`web-app.md`](web-app.md), "Data access"). They take any number of store ids and have no row guard. Tests: pgTAP `15_analytics_queries.sql`, `16_analytics_menu_and_cash.sql`, `17_analytics_access.sql`.

#### `public.same_weekday_baseline`

```sql
public.same_weekday_baseline(
  store_ids uuid[],
  target_date date,
  weeks integer DEFAULT 8
)
returns TABLE(
  weekday smallint, sample_days integer, baseline_net_amount numeric,
  baseline_invoices numeric, baseline_avg_ticket numeric
)
```

- **Called by:** SQL only. The `baseline` row of `period_compare` and `period_compare_by_store` is this function over 8 weeks.
- **Notes:** one row for the weekday of `target_date`: the medians of the daily net, the daily invoice count and the daily average ticket over the same weekday of the previous `weeks` weeks. Days in `holidays` (public holidays, Tết and the tenant's own days off) are left out, and days without data are skipped. Hôm nay computes its own baseline from fact rows ([`web-app.md`](web-app.md), "Phase 6 decisions").

#### `public.period_summary`

```sql
public.period_summary(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  days_with_data integer, invoices bigint, net_amount numeric,
  gross_amount numeric, discount_amount numeric, paid_amount numeric,
  cash_amount numeric, items_sold numeric, avg_ticket numeric,
  items_per_ticket numeric, avg_item_price numeric, cash_share numeric,
  voucher_share numeric, member_share numeric, identified_share numeric
)
```

- **Called by:** SQL only: `metric_value` reads its sales, ticket, share and capture metrics from it.
- **Notes:** one row of sums and ratios over the stores and dates. Sums are 0 and ratios null when the range has no data.

#### `public.weekday_profile_forecast`

```sql
public.weekday_profile_forecast(
  store_ids uuid[],
  target_date date,
  origin date DEFAULT NULL::date
)
returns numeric
```

- **Called by:** no caller yet. `month_pace` and `forecast_accuracy` compute the same forecast from the same building blocks in `app`.
- **Notes:** the forecast net for `target_date`: the mean daily net of the 28 days ending at the origin, times the weekday index of the 84 days ending there. The origin is `origin`, else `app.analytics_as_of(store_ids)`, and never later than the day before `target_date`. Excluded days (holidays and Tết) are left out; null when none of the 28 days is left.

#### `public.seasonal_naive_forecast`

```sql
public.seasonal_naive_forecast(
  store_ids uuid[],
  target_date date,
  origin date DEFAULT NULL::date
)
returns numeric
```

- **Called by:** no caller yet; `month_pace` and `forecast_accuracy` compute the same values.
- **Notes:** the net of the most recent day with sales on the target's weekday within the 56 days ending at the origin (the same origin rule). Holidays are not left out. Null when there is no such day.

#### `public.hour_weekday_heatmap`

```sql
public.hour_weekday_heatmap(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  weekday smallint, hour_local smallint, days_with_data integer,
  invoices bigint, net_amount numeric, avg_net_amount numeric,
  avg_invoices numeric
)
```

- **Called by:** the web theme Giờ & ngày trong tuần (its heat tables).
- **Notes:** one row per ISO weekday and local hour that has sales in the range. `days_with_data` counts the dates of that weekday with sales, and the averages divide by it, so a weekday without sales does not lower them.

#### `public.menu_matrix`

```sql
public.menu_matrix(
  store_ids uuid[],
  as_of_date date,
  popularity_factor numeric DEFAULT 0.7
)
returns TABLE(
  role item_type_role, item_external_id text, item_name text,
  quantity numeric, net_amount numeric, menu_mix_pct numeric,
  popularity_threshold_pct numeric, avg_unit_price numeric, unit_cost numeric,
  margin_axis numeric, margin_threshold numeric, provisional boolean,
  low_sample boolean, menu_class text
)
```

- **Called by:** no screen; Thực đơn reads `menu_engineering`, which keeps this method and adds the tenant's settings, overrides and costs by date. It is the source of the metric `menu_class`.
- **Notes:** the Kasavana–Smith menu matrix per item-type role over the 28 days ending `as_of_date`. When any item of a role lacks a cost, the whole role is `provisional` and its margin axis is the average price. `low_sample` is true for a role with fewer than 10 items. `menu_class` is star, plowhorse, puzzle or dog ([`metrics.md`](metrics.md)).

#### `public.cash_variance_flags`

```sql
public.cash_variance_flags(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric DEFAULT NULL::numeric,
  rel_threshold numeric DEFAULT NULL::numeric
)
returns TABLE(
  store_id uuid, shift_id uuid, shift_external_id text, business_date date,
  cashier_name text, cash_sales_amount numeric, variance_amount numeric,
  trailing_shifts integer, trailing_mean_variance numeric,
  trailing_stddev_variance numeric, z_score numeric,
  over_abs_threshold boolean, over_rel_threshold boolean,
  over_z_threshold boolean, reasons text[]
)
```

- **Called by:** no screen; the registry source of `cash_variance_zscore`. Thanh toán & tiền mặt and Ca & két tiền read `shift_review`, which returns the same flagged shifts together with the others.
- **Notes:** the shifts whose drawer variance passes one of three rules: more than `abs_threshold` (in the tenant's currency), more than `rel_threshold` × the shift's cash sales (both read from the tenant's report settings when null, 50,000 and 0.005 by default, since phase 10a), or more than 2 standard deviations from the mean of the store's shifts of the trailing 56 days (at least 3 such shifts). The range has no limit, so a long one can pass 1,000 rows.

### 3.2 Reports

The functions behind Ngày, Tuần, Tháng and Năm (ADR-029), called through `supabase.rpc()`; `analyticsFunctionNames` in `@fnb/reports` lists all 16, which include `metric_compare` (section 3.3). The phase 9 functions take 0 to 50 store ids (an empty array returns no rows); those whose result can grow refuse a call that would return more than 900 rows, and the others stay far below it by their own limits. The phase 8 ones among them (`period_compare`, `item_velocity`, `month_pace`, `forecast_accuracy`) have neither check in SQL; the client contract still caps store ids at 50. Report rules: [`metrics.md`, Report conventions](metrics.md#report-conventions) and [`reports/`](reports/ngay.md). Tests: pgTAP `22_report_functions.sql` and `23_report_access.sql`, the parity suite in `packages/demo-analytics/test/parity/`, and the live and demo end-to-end specs.

#### `public.store_coverage`

```sql
public.store_coverage(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  store_id uuid, opened_on date, first_sales_on date, last_sales_on date,
  history_start date, store_as_of_date date, sales_days integer,
  checked_days integer, matched_days integer, unmatched_days integer,
  unchecked_sales_days integer, stale_days integer,
  last_refreshed_at timestamp with time zone
)
```

- **Called by:** web reports (the first call of every report), digest.
- **Notes:** one row per visible store: opening date, first and last sales days, `history_start` (the later of `opened_on` and the first sales day), the store's as-of day, and counts of sales, checked, matched, unmatched, unchecked and stale days, with the tenant's last finished refresh. The reports take the like-for-like rule and the "chưa đối soát" and "đang cập nhật" markers from it. At most 400 days.

#### `public.period_compare`

```sql
public.period_compare(store_ids uuid[], grain text, anchor date)
returns TABLE(
  period text, from_date date, to_date date, days_with_data integer,
  invoices bigint, net_amount numeric, gross_amount numeric,
  discount_amount numeric, avg_ticket numeric, items_per_ticket numeric,
  avg_item_price numeric, cash_share numeric, voucher_share numeric,
  member_share numeric, identified_share numeric
)
```

- **Called by:** web reports, for like-for-like comparisons over the covered stores only (`likeForLikeCalls` in `packages/reports/src/definition.ts`); digest.
- **Notes:** the rows `current`, `previous` and `last_year`, plus `baseline` for `day`. The grain is `day`, `week`, `month` or `year`; another raises `P0001`. Period boundaries: [`metrics.md`, Period comparison](metrics.md#period-comparison). Values are null for a period without data.

#### `public.period_compare_by_store`

```sql
public.period_compare_by_store(store_ids uuid[], grain text, anchor date)
returns TABLE(
  store_id uuid, period text, from_date date, to_date date,
  days_with_data integer, invoices bigint, net_amount numeric,
  gross_amount numeric, item_discount_amount numeric,
  bill_discount_amount numeric, voucher_amount numeric,
  discount_amount numeric, paid_amount numeric, cash_amount numeric,
  items_sold numeric, voucher_invoices bigint, member_invoices bigint,
  identified_invoices bigint, voided_invoices bigint, voided_amount numeric,
  edited_invoices bigint, avg_ticket numeric, items_per_ticket numeric,
  avg_item_price numeric, cash_share numeric, voucher_share numeric,
  member_share numeric, identified_share numeric, discount_rate numeric
)
```

- **Called by:** web reports (all four), digest.
- **Notes:** one block for all stores (`store_id` null), then one block per visible store, each with the rows of `period_compare`. The totals are the 25 columns of `app.period_totals()`. The all-stores block equals `period_compare` on every shared column. Grain as `period_compare`, but another grain raises `22023`.

#### `public.period_series`

```sql
public.period_series(
  store_ids uuid[],
  grain text,
  from_date date,
  to_date date,
  include_stores boolean DEFAULT true
)
returns TABLE(
  store_id uuid, bucket_start date, bucket_end date, iso_year integer,
  iso_week smallint, weekday smallint, calendar_days integer,
  excluded_days integer, tet_days integer, holiday_kind text,
  checked_days integer, matched_days integer, days_with_data integer,
  invoices bigint, net_amount numeric, gross_amount numeric,
  item_discount_amount numeric, bill_discount_amount numeric,
  voucher_amount numeric, discount_amount numeric, paid_amount numeric,
  cash_amount numeric, items_sold numeric, voucher_invoices bigint,
  member_invoices bigint, identified_invoices bigint, voided_invoices bigint,
  voided_amount numeric, edited_invoices bigint, avg_ticket numeric,
  items_per_ticket numeric, avg_item_price numeric, cash_share numeric,
  voucher_share numeric, member_share numeric, identified_share numeric,
  discount_rate numeric
)
```

- **Called by:** web reports (Tuần, Tháng, Năm), digest.
- **Notes:** one row per bucket for all stores (`store_id` null) and, unless `include_stores` is false, per visible store. Grains: `day`, `week` (ISO weeks), `month`, `year`, or `weekday` (seven rows over the whole range). `excluded_days`, `tet_days` and `holiday_kind` describe the calendar; `checked_days` and `matched_days` come from `sync_checks`. At most 1,100 days and 900 rows (buckets × (visible stores + 1)).

#### `public.daily_baselines`

```sql
public.daily_baselines(
  store_ids uuid[],
  from_date date,
  to_date date,
  weeks integer DEFAULT 8
)
returns TABLE(
  business_date date, weekday smallint, sample_days integer,
  baseline_net_amount numeric, baseline_invoices numeric,
  baseline_avg_ticket numeric
)
```

- **Called by:** web reports (Tuần, Tháng).
- **Notes:** the same-weekday baseline of each date in the range, as `same_weekday_baseline` computes it. At most 62 dates; `weeks` from 1 to 26.

#### `public.hourly_profile`

```sql
public.hourly_profile(store_ids uuid[], target_date date, weeks integer DEFAULT 8)
returns TABLE(
  hour_local smallint, current_invoices integer, current_net_amount numeric,
  current_items_sold numeric, sample_days integer, baseline_invoices numeric,
  baseline_net_amount numeric
)
```

- **Called by:** web reports (Ngày), digest.
- **Notes:** 24 rows, one per local hour. Current values are null on every hour when no selected store has sales on the date, and 0 for an hour without sales. The baseline is the median of each hour over the eligible same-weekday days. `weeks` from 1 to 26.

#### `public.item_summary`

```sql
public.item_summary(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date DEFAULT NULL::date,
  compare_to date DEFAULT NULL::date
)
returns TABLE(
  item_external_id text, item_name text, base_name text, size_label text,
  item_type_external_id text, item_type_name text, role item_type_role,
  quantity numeric, net_amount numeric, invoices bigint, days_sold integer,
  net_share numeric, compare_quantity numeric, compare_net_amount numeric,
  compare_net_share numeric, first_sold_on date, last_sold_on date
)
```

- **Called by:** web reports (Ngày top items, Tuần category mix, Tháng Pareto and new items), digest.
- **Notes:** one row per item sold in either range, from `agg_item_daily`, so never a modifier. Since phase 10a `item_type_external_id`, `item_type_name` and `role` are the effective ones: an override in `item_category_overrides` on the POS account of the first requested store that sold the item replaces its POS type from the next statement on. Shares are of the range's item net. The compare columns are null without a compare range and 0 for an item not sold in it; `compare_from` and `compare_to` go together. At most 400 days per range. Ordered by net, then quantity.

#### `public.payment_summary`

```sql
public.payment_summary(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date DEFAULT NULL::date,
  compare_to date DEFAULT NULL::date
)
returns TABLE(
  method_key text, kind payment_kind, payment_method_name text,
  invoices bigint, amount numeric, share numeric, fee_amount numeric,
  fee_estimate_amount numeric, compare_amount numeric, compare_share numeric
)
```

- **Called by:** web reports (Ngày payments, Tháng payment mix), digest.
- **Notes:** one row per payment kind and name; `method_key` joins the two with `|`, so the same method on two POS accounts merges. `fee_amount` is what the POS reported and `fee_estimate_amount` comes from `payment_fee_rates`. Limits as `item_summary`.

#### `public.promotion_summary`

```sql
public.promotion_summary(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  promotion_kind text, promotion_key text, promotion_name text,
  invoices bigint, lines bigint, discount_amount numeric, first_used_on date,
  last_used_on date, days_used integer
)
```

- **Called by:** web reports (Ngày discounts, Tuần promotions, Tháng discount cost), digest.
- **Notes:** one row per promotion; `promotion_kind` is `item`, `bill` or `voucher`, and `lines` is null for bills and vouchers. At most 92 days.

#### `public.shift_review`

```sql
public.shift_review(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric DEFAULT NULL::numeric,
  rel_threshold numeric DEFAULT NULL::numeric
)
returns TABLE(
  store_id uuid, shift_id uuid, shift_external_id text, shift_name text,
  business_date date, cashier_name text, opened_at timestamp with time zone,
  closed_at timestamp with time zone, orders integer, sales_amount numeric,
  cash_sales_amount numeric, opening_float_amount numeric,
  expected_cash_amount numeric, drawer_amount numeric,
  variance_amount numeric, trailing_shifts integer, z_score numeric,
  over_abs_threshold boolean, over_rel_threshold boolean,
  over_z_threshold boolean, flagged boolean, reasons text[]
)
```

- **Called by:** web reports (Ngày shifts, Tháng shift statistics), digest.
- **Notes:** every shift of `agg_shift_cash` in the range, with the cash columns, the trailing z-score, the three threshold flags, `flagged` and `reasons`. Null thresholds read the tenant's report settings of the first visible store (50,000 and 0.005 without a settings row), so Ngày, Tháng and the digest flag what the settings say without passing them; explicit thresholds win, each on its own. A call with stores of two tenants applies the first visible store's thresholds to all of them; the web app never mixes tenants. The flagged rows equal `cash_variance_flags`. At most 92 days.

#### `public.store_targets`

```sql
public.store_targets(store_ids uuid[], period_kind period_kind, period_start date)
returns TABLE(
  store_id uuid, net_target_amount numeric
)
```

- **Called by:** web reports (Tháng).
- **Notes:** the `targets` rows of the visible stores for one period: `period_kind` `month` or `week`, `period_start` its first day.

#### `public.item_velocity`

```sql
public.item_velocity(store_ids uuid[], as_of_date date)
returns TABLE(
  item_external_id text, item_name text, item_type_external_id text,
  item_type_name text, recent_quantity numeric, prior_quantity numeric,
  recent_net_amount numeric, prior_net_amount numeric,
  quantity_change_pct numeric, net_change_pct numeric
)
```

- **Called by:** web reports (Tuần movers, Năm item lifecycle).
- **Notes:** per item, the 28 days ending `as_of_date` against the 28 days before, from `agg_item_daily`.

#### `public.month_pace`

```sql
public.month_pace(store_ids uuid[], month_start date, as_of date DEFAULT NULL::date)
returns TABLE(
  period_start date, as_of_date date, elapsed_days integer,
  remaining_days integer, month_to_date_net_amount numeric,
  month_to_date_invoices bigint, forecast_weekday_profile_net_amount numeric,
  forecast_seasonal_naive_net_amount numeric, target_net_amount numeric
)
```

- **Called by:** web reports (Tháng).
- **Notes:** one row: month to date from `period_start` to `as_of_date`, the two month forecasts (weekday profile and seasonal naïve) and the monthly target. `as_of` defaults to `app.analytics_as_of(store_ids)`, capped at the month end.

#### `public.forecast_accuracy`

```sql
public.forecast_accuracy(store_ids uuid[], as_of_date date, days integer DEFAULT 28)
returns TABLE(
  forecast_id text, sample_days integer, mae numeric, mape numeric
)
```

- **Called by:** web reports (Tháng, to rank the two forecasts).
- **Notes:** two rows, `forecast_seasonal_naive` and `forecast_weekday_profile`, with `sample_days`, `mae` (in the tenant's currency) and `mape`, over the `days` days ending `as_of_date`.

#### `public.item_lifecycle`

```sql
public.item_lifecycle(store_ids uuid[], as_of_date date)
returns TABLE(
  item_external_id text, item_name text, item_type_external_id text,
  item_type_name text, role item_type_role, first_sold_on date,
  last_sold_on date, months_sold integer, quantity_28d numeric,
  quantity_prior_28d numeric, quantity_ytd numeric, quantity_last_ytd numeric,
  net_ytd numeric, net_last_ytd numeric, quantity_lifetime numeric,
  net_lifetime numeric
)
```

- **Called by:** web reports (Năm).
- **Notes:** per item sold up to `as_of_date`: first and last sold, months sold, the 28-day windows, year to date against last year to date, and lifetime totals. A window without sales is null.

### 3.3 metric_value

Values of the metric registry ([`metrics.md`](metrics.md), `packages/metrics`). Tests: pgTAP `18_metric_value.sql` and `22_report_functions.sql`, and the parity suite.

#### `public.metric_value`

```sql
public.metric_value(store_ids uuid[], metric_id text, from_date date, to_date date)
returns numeric
```

- **Called by:** SQL: `metric_compare`, once per metric id and period. `fnb digest --check-ngay` calls it as the member to compare the digest's net revenue with the registry.
- **Notes:** one value of a registry metric over the stores and business dates. Stores and days are summed before any ratio. It computes the 21 metrics of `metricValueIds()`, and a test keeps that list equal to the SQL: `net_revenue`, `gross_revenue`, `invoices`, `avg_ticket`, `items_per_ticket`, `avg_item_price`, `cash_share`, `voucher_invoice_share`, `member_invoice_share`, `discount_rate`, `attach_rate_topping`, `attach_rate_snack`, `size_l_share`, `sales_per_opening_hour`, `invoices_per_opening_hour`, `peak_share_20_21`, `dead_hour_share_17_18`, `void_rate`, `edit_rate`, `removed_line_rate`, `customer_capture_rate`. Another id, or a range that starts after it ends, raises `22023`. Null when the range has no sales or a ratio has no denominator.

#### `public.metric_compare`

```sql
public.metric_compare(store_ids uuid[], metric_ids text[], grain text, anchor date)
returns TABLE(
  metric_id text, period text, from_date date, to_date date, value numeric
)
```

- **Called by:** web reports (Ngày, Tuần, Tháng), digest.
- **Notes:** for each of 1 to 25 metric ids, `metric_value` over the `current`, `previous` and `last_year` periods of `period_compare`, ordered by the position of the id.

### 3.4 Settings and writes

#### `public.refresh_my_analytics`

```sql
public.refresh_my_analytics(p_from date, p_to date, p_tenant uuid DEFAULT NULL::uuid)
returns bigint
```

- **Who may call:** an owner or manager of the tenant, whatever its store scope. Anyone else gets `42501`.
- **Called by:** no caller yet. The sync jobs refresh through `app.refresh_analytics` as `postgres`.
- **Status:** verified locally (phase 8; pgTAP `17_analytics_access.sql`).
- **Notes:** rebuilds the aggregate tables of the tenant for at most 92 days and returns the number of rows written. With `p_tenant` null it refreshes every tenant where the caller is an owner or manager, in tenant id order. Refreshes of one tenant queue behind each other.

#### `public.analytics_catch_up_status`

```sql
public.analytics_catch_up_status(p_tenant_id uuid)
returns TABLE(
  tenant_id uuid, inputs_changed_at timestamp with time zone,
  history_from date, history_to date, pending_from date, pending_to date,
  pending_days integer, can_refresh boolean
)
```

- **Who may call:** any data member of the tenant; anyone else, the publisher included, gets no row.
- **Called by:** no caller yet; Settings will run the catch-up from it (phase 10a).
- **Status:** verified locally (phase 10a; pgTAP `34_theme_access.sql`, `35_mappings_and_catch_up.sql`).
- **Notes:** the days whose refresh-time aggregates may still use mappings or fee rates from before the last change. Every write to `item_type_roles`, `item_category_overrides` or `payment_fee_rates` moves `tenants.analytics_inputs_version` and marks the whole history pending; `pending_from` starts at the tenant's first aggregate date. `pending_days` is 0 and both ends are null when nothing is pending, and also for a tenant without any aggregate yet, whose first refresh empties the range. Every refresh shrinks the range by the days it covers (`app.shrink_analytics_pending`, [`schema.md`](schema.md), "Refresh"). `can_refresh` follows the rule of `refresh_my_analytics`. It reads no refresh history.

#### Writes through tables

Settings are written as rows, not through functions. RLS decides each write.

| Table | Insert | Update | Delete |
|---|---|---|---|
| `item_costs`, `payment_fee_rates`, `targets` | owner or manager whose scope covers the row's store | same | same |
| `item_type_roles` | owner or manager with an unlimited scope | same | same |
| `item_category_overrides` | owner or manager with an unlimited scope | same | same |
| `report_settings` | owner with an unlimited scope | same | same |
| `holidays` | owner or manager with an unlimited scope; tenant rows only, global rows are read-only | same | same |
| `strategy_reports` | owner, manager or publisher whose scope covers the row's store | owner or manager whose scope covers the row's store | same as update |
| `consent_records` | owner or manager of the tenant, any scope; never purpose `notifications` | the same; a trigger lets an update set `revoked_at` once and nothing else | never |
| `data_subject_requests` | owner or manager with an unlimited scope; a trigger fills the deadlines | the same | never |
| `alert_rules` | owner with an unlimited scope; a trigger validates the rule and its parameters (`22023`) | the same | the same |
| `channel_policies` | owner with an unlimited scope, tenant rows only; CHECK constraints keep the legal floors | the same | the same |

Status: the tables, policies and triggers are verified locally (pgTAP `05_write_policies.sql`, `07_write_scope_and_attribution.sql`, `10_payment_fee_rates.sql`, `11_item_type_roles_and_holidays.sql`, `12_consent_and_legal.sql`, `31_notify_access.sql`, `35_mappings_and_catch_up.sql`). Inserts must name the caller as `created_by`, and a trigger sets `updated_by` to the caller on every insert and update of the manual-input tables, `item_category_overrides` and `report_settings`. No screen writes them yet: the Settings screens are designed for phase 10b, Kế hoạch and `fnb publish-plan` (which will insert plans as the publisher) for 11b, and Settings → Cảnh báo after step 12c. `stores` has no client write today (store settings are designed for 10b), and destinations in `notification_channels` are written only by server code ([section 3.5](#35-notifications)).

### 3.5 Notifications

No function in `public` serves notifications today. Phase 12 has put all of its functions in `app`, where only `postgres` may run the dispatcher, digest and linking functions. The only exceptions are the check helpers that policies and constraints call (`alert_rule_params_valid`, `channel_kind_available`, `notify_secret_name_valid`, `facts_are_count_only`, `current_user_channel_ids`). Destinations are linked and removed with `fnb notify link` (from the owner's machine; refused in CI) and `fnb notify unlink`; `fnb digest` queues the digests and `fnb notify tick` sends.

Planned for step 12c: the functions behind Settings → Cảnh báo (destinations and the test button) and the Bản tin panel. They will be `public` functions, and `pnpm docs:check-api` will fail until this section lists them. Until then a client reads the notification tables in [section 4](#4-tables-and-views).

### 3.6 Consent and legal

No function in `public`. A client writes `consent_records` and `data_subject_requests` as tables ([Writes through tables](#writes-through-tables)). The helpers `app.has_active_consent(tenant, subject_type, subject, purpose)` and `app.dsr_deadlines(received, country_code, time_zone, uses_processor)` are `security invoker` and executable by `authenticated`, but they sit in `app`, which the API does not serve; policies, triggers and server code use them. A member's `notifications` consent is recorded in SQL when the member accepts a destination linked with `fnb notify link`, and withdrawn by `fnb notify unlink --tenant <slug> --member <login e-mail> --all`. The browser can never insert or update it (two restrictive policies).

### 3.7 Others

None. `authenticated` may execute 47 functions in `app`, because policies and invoker functions call them as the caller: membership helpers, analytics building blocks, argument checks and calendar checks. The API does not serve `app`, so no client can call them directly. [`schema.md`](schema.md) describes them under "Helpers in schema `app`".

### 3.8 Thematic reports (phase 10)

The functions behind the thematic reports under `#/chu-de/…`, called over a date range rather than a period. Each takes the thresholds of the tenant's `report_settings` row when the caller passes none, so every report and the digest flag the same hours and shifts. Tests: pgTAP `33_theme_functions.sql` and `34_theme_access.sql`, and the parity suite (`theme-revenue-hours.parity.test.ts`).

#### `public.report_settings_of`

```sql
public.report_settings_of(store_ids uuid[])
returns TABLE(
  store_id uuid, tenant_id uuid, has_tenant_row boolean, menu_window_days integer,
  menu_popularity_factor numeric, menu_low_sample_items integer,
  cash_abs_threshold numeric, cash_rel_threshold numeric, z_threshold numeric,
  peak_hours integer, dead_hour_ratio numeric, busy_hour_ratio numeric,
  promo_pre_weeks integer, seat_count integer, opening_hours_known boolean,
  fee_rates_configured boolean, costs_configured boolean, roles_configured boolean
)
```

- **Called by:** the web theme Giờ & ngày trong tuần (its productivity card); the other theme pages as they arrive.
- **Notes:** one row per visible store in the order asked: the tenant's report settings (or the column defaults when the tenant has no row), the fixed z-score threshold 2, the store's seats, and whether opening hours, fee rates, item costs and item-type roles are set. Cards read it to show their thresholds and their "not configured" states. A publisher gets the defaults and false flags.

#### `public.range_totals`

```sql
public.range_totals(store_ids uuid[], from_dates date[], to_dates date[])
returns TABLE(
  range_index smallint, store_id uuid, from_date date, to_date date,
  days_with_data integer, invoices bigint, net_amount numeric, gross_amount numeric,
  item_discount_amount numeric, bill_discount_amount numeric, voucher_amount numeric,
  discount_amount numeric, paid_amount numeric, cash_amount numeric, items_sold numeric,
  voucher_invoices bigint, member_invoices bigint, identified_invoices bigint,
  voided_invoices bigint, voided_amount numeric, edited_invoices bigint,
  avg_ticket numeric, items_per_ticket numeric, avg_item_price numeric,
  cash_share numeric, voucher_share numeric, member_share numeric,
  identified_share numeric, discount_rate numeric
)
```

- **Called by:** the web theme Doanh thu & xu hướng (its totals, comparisons and store shares).
- **Notes:** for each of 1 to 6 ranges (each at most 1,100 days; the lists must have equal lengths), a row for all requested stores (`store_id` null) and one per visible store, with the totals of `period_compare_by_store`. With the ranges of a period it equals that function's non-baseline rows.

#### `public.opening_productivity`

```sql
public.opening_productivity(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  store_id uuid, days_with_sales integer, invoices bigint, net_amount numeric,
  opening_minutes bigint, seat_count integer, seat_minutes bigint,
  sales_per_opening_hour numeric, invoices_per_opening_hour numeric, revpash numeric
)
```

- **Called by:** the web theme Giờ & ngày trong tuần; So sánh cửa hàng later.
- **Notes:** a row for all stores, then one per visible store, over the days with sales (at most 1,100 days). Opening minutes follow `app.opening_minutes`, split and overnight spans included; they are null when any store with sales has no opening hours. RevPASH is net revenue per seat-hour and needs seats on every such store. The two per-hour values equal `metric_value`.

#### `public.hour_profile`

```sql
public.hour_profile(
  store_ids uuid[], from_date date, to_date date,
  peak_hours integer DEFAULT NULL::integer, dead_hour_ratio numeric DEFAULT NULL::numeric,
  busy_hour_ratio numeric DEFAULT NULL::numeric
)
returns TABLE(
  scope text, weekday smallint, hour_local smallint, hour_position smallint,
  days_with_data integer, invoices bigint, net_amount numeric, avg_net_amount numeric,
  avg_invoices numeric, net_share numeric, level text, peak_share numeric,
  dead_share numeric, peak_hours_used integer, dead_hour_ratio_used numeric,
  busy_hour_ratio_used numeric
)
```

- **Called by:** the web theme Giờ & ngày trong tuần.
- **Notes:** hours of the open span (first to last hour with sales, empty hours inside it as zeros) for the scopes `all`, `weekdays` and `weekend`, each followed by a summary row, then one row per ISO weekday. In `all`, the `peak_hours` largest hours are `peak` and hours below `dead_hour_ratio` times the span's mean are `dead`; the weekday groups are `busy` or `quiet` by invoices per day against `busy_hour_ratio` and `dead_hour_ratio`. The `all` summary carries `peak_share` and `dead_share`. Hours are placed from the first store's business-day start. At most 400 days; thresholds outside the table's checks raise `22023`.

#### `public.menu_engineering`

```sql
public.menu_engineering(
  store_ids uuid[], as_of_date date, window_days integer DEFAULT NULL::integer,
  popularity_factor numeric DEFAULT NULL::numeric, low_sample_items integer DEFAULT NULL::integer
)
returns TABLE(
  role item_type_role, role_mapped boolean, item_external_id text, item_name text,
  item_type_external_id text, item_type_name text, category_source text,
  quantity numeric, net_amount numeric, menu_mix_pct numeric, popularity_threshold_pct numeric,
  avg_unit_price numeric, unit_cost numeric, margin_axis numeric, margin_threshold numeric,
  provisional boolean, low_sample boolean, menu_class text, window_from date,
  window_days_used integer, popularity_factor_used numeric, low_sample_items_used integer
)
```

- **Called by:** the web theme Thực đơn; the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/menu`.
- **Notes:** phase 8's `menu_matrix` method over a trailing window ending on `as_of_date` (7 to 91 days), per effective item-type role. Each store's sales take the type and role of its POS account, an override in `item_category_overrides` winning over the POS type (`category_source` is `override`, `pos` or `none`), so an item whose type two accounts map differently appears once per role, as in `menu_matrix`; an item whose type has no role is in `other` with `role_mapped` false. `unit_cost` is the quantity-weighted cost of the item's store-days, each costed with the row in force on its business date (a store row before a tenant-wide row); one store-day without a cost leaves the item without one and its role `provisional`. `low_sample` when the role has fewer items than `low_sample_items_used`. Null arguments take the tenant's report settings; out-of-range arguments raise `22023`. With the default settings, no override and no cost change in the window it equals `menu_matrix` on their shared columns.

#### `public.item_margins`

```sql
public.item_margins(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  item_external_id text, item_name text, base_name text, size_label text,
  item_type_external_id text, item_type_name text, role item_type_role,
  quantity numeric, net_amount numeric, costed_quantity numeric, costed_net_amount numeric,
  cost_amount numeric, unit_cost_latest numeric, margin_amount numeric, margin_rate numeric,
  cost_coverage numeric
)
```

- **Called by:** the web theme Thực đơn; the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/menu`.
- **Notes:** one row per item key of `agg_item_daily`, so never a modifier, with the effective type and role. The cost, margin and margin rate cover the costed store-days only (the cost-by-date rule of `menu_engineering`) and are null for an item without any cost; the type and role are those of the first requested store that sold the item; `cost_coverage` is the costed share of net revenue. `unit_cost_latest` is the cost in force on `to_date` at the first requested store that has one. At most 400 days and 900 rows. Ordered by net.

#### `public.item_attach`

```sql
public.item_attach(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  item_external_id text, item_name text, drink_invoices bigint,
  topping_base_invoices bigint, topping_invoices bigint,
  snack_base_invoices bigint, snack_invoices bigint,
  topping_rate numeric, snack_rate numeric
)
```

- **Called by:** Thực đơn's attach card (`attach`, `attachPrevious`, and the covered stores' `attachCovered` and `attachPreviousCovered`); the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/menu`.
- **Notes:** non-voided invoices of the range, each item line with the role of its effective type on the invoice's POS account. First a summary row (`item_external_id` null) over the invoices with a drink, then one row per drink item over the invoices holding it. Topping and snack rates count only the stores whose POS account maps that role, as `agg_attach_daily` and `metric_value` do; a role no requested account maps gives a null rate. At most 92 days.

#### `public.basket_pairs`

```sql
public.basket_pairs(
  store_ids uuid[], from_date date, to_date date,
  min_pair_invoices integer DEFAULT 3, max_pairs integer DEFAULT 50
)
returns TABLE(
  item_a_external_id text, item_a_name text, item_b_external_id text, item_b_name text,
  pair_invoices integer, invoices_a integer, invoices_b integer, window_invoices integer,
  support_a numeric, support_b numeric, confidence_a_to_b numeric, confidence_b_to_a numeric,
  lift numeric
)
```

- **Called by:** Thực đơn's pairs card; the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/basket-modifiers`.
- **Notes:** the definitions of `agg_basket_pairs_28d` over any range and over the requested stores together: non-voided invoices with an item line (`window_invoices`), the distinct item keys of each invoice (so never a modifier), unordered pairs with `item_a < item_b` in `collate "C"`, kept from `min_pair_invoices` (1 to 50). Supports and confidences to 6 digits, lift to 4 on unrounded supports; names are `max(item_name)` in the range. Ordered by pair invoices, lift and the two keys; the first `max_pairs` (1 to 900). At most 92 days. Over 28 days of one store ending on a refreshed date it equals `agg_basket_pairs_28d` as unordered pairs.

#### `public.modifier_summary`

```sql
public.modifier_summary(
  store_ids uuid[], from_date date, to_date date,
  compare_from date DEFAULT NULL::date, compare_to date DEFAULT NULL::date
)
returns TABLE(modifier_name text, lines bigint, share numeric, compare_lines bigint, compare_share numeric)
```

- **Called by:** Thực đơn's sugar and ice card; the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/basket-modifiers`.
- **Notes:** per modifier name of `agg_modifier_prefs_daily`, the lines and their share of all modifier lines in the range (6 digits), for names seen in either range. The compare columns are null without a compare range and 0 for a name the compare range lacks; `compare_from` and `compare_to` go together. Each range at most 400 days. Ordered by lines, then name. The sugar and ice families are a classification of the names in TypeScript.

## 4. Tables and views

Every table in `public` has RLS enabled, and `anon` holds no privilege on any table or view. `authenticated` reads through the policies below, which [`schema.md`](schema.md#row-level-security) defines exactly. A future table created by a migration starts read-only for `authenticated` and invisible to `anon` (default privileges), but it still needs RLS and its policies: `supabase/tests/03_rls_enabled.sql` fails on a `public` table without RLS and pins the table count and the tables that carry write policies. "Data roles" are `owner`, `manager`, `staff` and `viewer`. "In scope" means a store within the member's store scope.

### Tenancy and access

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `tenants` | one row per owner organisation: name, country, currency, time zone, legal form | every member of the tenant, all five roles | none | web app, through `tenant_members` |
| `tenant_members` | role and store scope of each login in a tenant | data roles: every row of their tenants | none (`fnb tenant add-member`) | web app (the tenant list) |

### POS connectivity

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `pos_accounts` | one row per POS login: connector, account key, label, status (`active`, `paused`, `error`, `auth_failed`), last successful sync | data roles of the tenant | none | none |
| `pos_account_tokens` | cached POS session tokens | nobody (no grant) | none | none |

### Stores and catalogue

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `stores` | store profile: time zone, business-day start, opening hours, seats, opening date, e-invoice status, receipt-number reset, settings | every member, stores in scope | none (store settings designed for 10b) | web app (store picker) |
| `items`, `item_types`, `item_classes`, `units`, `packages`, `customizations`, `sources`, `payment_methods`, `promotions`, `devices` | the POS catalogue, synced per POS account | data roles of the tenant | none | web app reads `payment_methods` |
| `store_items` | per-store price overrides | data roles, stores in scope | none | none |
| `customers` | customers attached to invoices | data roles of the tenant | none | none |

### Sales facts

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `invoices` | one row per POS sale: business date, sale time, status (`completed`, `edited`, `voided`), amounts, discounts, customer | data roles, stores in scope | none | web app (Hôm nay) |
| `invoice_lines` | lines of each invoice: `item`, `modifier`, `service`, `package` or `other` | data roles, stores in scope | none | web app (Hôm nay) |
| `invoice_payments` | tenders of each invoice | data roles, stores in scope | none | web app (Hôm nay) |
| `invoice_events` | voids, edits, removed lines and reissues | data roles, stores in scope | none | none |
| `shifts` | POS shifts: opening float, expected cash, counted drawer, variance | data roles, stores in scope | none | none |
| `sale_payloads` | compressed vendor payloads of one store-day | nobody (no grant) | none | none |

### Sync bookkeeping

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `sync_runs` | one row per sync run: kind, status, range, counts | data roles of the tenant; a run tied to stores only when one of them is in scope | none | web app (freshness badge) |
| `sync_checks` | per store-day reconciliation against the POS control totals (`is_matched`) | data roles, stores in scope | none | web app ("đã đối soát" badge) |

### Manual inputs and plans

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `item_costs` | cost per item, tenant-wide or per store, from a date | data roles; tenant-wide rows and stores in scope | [yes](#writes-through-tables) | none |
| `payment_fee_rates` | fee % and fixed fee per payment method, from a date | data roles; tenant-wide rows and stores in scope | [yes](#writes-through-tables) | none |
| `targets` | net-sales target per store and month or week | data roles, stores in scope | [yes](#writes-through-tables) | none (`store_targets` reads it) |
| `item_type_roles` | the role of each POS item type: `drink`, `topping`, `food`, `snack`, `other` | data roles of the tenant | [yes](#writes-through-tables) | none |
| `item_category_overrides` | an item moved to another POS item type of its account, for reports only | data roles of the tenant | [yes](#writes-through-tables) | none |
| `report_settings` | the tenant's report thresholds (menu window, cash tolerances, peak and quiet hours, promotion pre-period) | data roles of the tenant | [yes](#writes-through-tables) | none (the functions read it) |
| `holidays` | public holidays and Tết days (61 global rows for 2024 to 2028) and the tenant's own days off | global rows: every signed-in user; tenant rows: every member of the tenant | [yes](#writes-through-tables) | web app (Hôm nay's baseline) |
| `strategy_reports` | strategy plans with their data pack and KPI ids | every member, all five roles; tenant-wide rows and stores in scope | [yes](#writes-through-tables) | none (Kế hoạch designed for 11b) |

### Consent and legal

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `consent_records` | append-only consent ledger per subject and purpose | data roles of the tenant | [yes](#writes-through-tables) | none |
| `data_subject_requests` | requests of data subjects, with statutory deadlines | owners and managers with an unlimited scope | [yes](#writes-through-tables) | none |

### Analytics

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `agg_daily_sales`, `agg_hourly_sales`, `agg_item_daily`, `agg_category_daily`, `agg_payment_daily`, `agg_shift_cash`, `agg_size_mix_daily`, `agg_modifier_prefs_daily`, `agg_basket_pairs_28d`, `agg_attach_daily` | aggregates per store-day (per shift for `agg_shift_cash`, per 28-day window for `agg_basket_pairs_28d`), rebuilt by `app.refresh_analytics` | data roles, stores in scope | none | none; the functions read them |
| `analytics_refreshes` | one row per refresh | data roles of the tenant | none | none |
| `dim_calendar` | one row per day from 2023-01-01 to 2030-12-31: ISO week, weekday, month, quarter, weekend | every signed-in user | none | none |
| `v_recent_daily_sales`, `v_recent_hourly_sales` | `security_invoker` views of the recent days, computed live from the fact tables for every store the caller sees | data roles, through the fact tables | none | none (withdrawn from Hôm nay, [`web-app.md`](web-app.md) "Phase 9 decisions") |

### Notifications (phase 12)

Step 12a verified locally; step 12b in build. No screen reads them yet; the Cảnh báo screen and the Bản tin panel are designed for after step 12c.

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `alert_rule_catalog` | the 15 alert and digest rules with defaults and the parameter schema | every signed-in user | none | none |
| `alert_rules` | tenant and store overrides of the catalogue | owners and managers; store rows in scope | [owners](#writes-through-tables) | none |
| `channel_policies` | send rules per channel kind and message class: 27 global defaults and tenant overrides | global rows: every signed-in user; tenant rows: owners and managers | [owners](#writes-through-tables) | none |
| `notification_channels` | destinations: member, kind, provider, label, status and health | owners and managers with an unlimited scope read every destination; every member reads their own; 20 columns only, never the address, secret name or configuration | none (server code only) | none |
| `alert_events` | alert episodes with count-only facts | owners and managers whose scope covers the event's store | none | none |
| `digests` | one daily digest per tenant, business date and store scope, built from the Ngày report | owners and managers whose data stores include every store of the digest | none | none |
| `outbound_messages` | the outbox and the one-year log of every message sent | owners and managers with an unlimited scope or covering the message's store; the recipient of a message to their own destination | none | none |

## 5. Edge Function endpoints

### `sync-incremental`

Verified locally (phase 7); the deploy to the cloud project waits for owner. Engine, schedule and runbook: [`sync.md`](sync.md#edge-function-sync-incremental).

- **URL:** `<SUPABASE_URL>/functions/v1/sync-incremental`; locally `http://127.0.0.1:54321/functions/v1/sync-incremental` while `pnpm exec supabase functions serve --env-file <file>` runs.
- **Method:** `POST`.
- **Authorization:** no API key and no JWT (`verify_jwt = false` under `[functions.sync-incremental]`). The body carries a single-use ticket instead (ADR-028). Once `select app.enable_incremental_sync('<function URL>');` has run, `pg_cron` runs `app.dispatch_incremental_sync()` every 30 minutes by default; it issues one ticket per due store in `app.incremental_sync_tickets` and posts only its id through `pg_net`. An operator issues a manual ticket as `postgres` with `select app.issue_incremental_sync_ticket('<store id>');`. A ticket lives 10 minutes by default (`ticket_lifetime`, 1 minute to 1 hour) and is deleted when it is claimed.
- **Body:** `{"ticket": "<uuid>"}`; add `"wait": true` to wait for the run and get its report.

| Status | Body | When |
|---|---|---|
| 202 | `{"accepted": true}` | the ticket was claimed; the run goes on in the background (`EdgeRuntime.waitUntil`) |
| 200 | the run report | `"wait": true` and the run did not fail |
| 500 | the run report, `"outcome": "failed"` | `"wait": true` and the run failed |
| 400 | `{"error": "the body must be JSON with a ticket id"}` | the body is not JSON, or `ticket` is not a UUID |
| 401 | `{"error": "unknown, used or expired ticket"}` | the claim found no live ticket |
| 405 | `{"error": "send a POST request with a dispatch ticket"}` | any other method |
| 429 | `{"error": "too many tickets are being claimed, retry"}` | 32 claims already wait on this worker (`CLAIM_QUEUE_LIMIT`) |
| 500 | `{"error": "the function is not configured"}` | no database URL, a database URL that would allow plaintext to a remote host, an unreadable `POS_ACCOUNTS_JSON`, or invalid budget variables |
| 503 | `{"error": "the database is unavailable"}` | the claim could not reach the database |

The function checks in this order: method, body, configuration, claim queue, claim. The run report (`outcomeReport` in `packages/runner/src/report.ts`) holds `outcome` (`ran`, `failed` or `skipped`) and a `label` that names the account and store by position, never by name. A skipped run adds `reason` (`store_unknown`, `store_inactive`, `account_paused` or `account_auth_failed`). Any other run adds `minutes_without_sync` and `http_requests`; a failed one adds `stage` (`config`, `connect`, `auth` or `run`) and `error`. A run with a summary adds `status`, `stopped`, `days` (`checked`, `changed`, `synced`, `handed_off`), `connector_calls`, `retries`, `pulled_sales`, `inserted`, `updated`, `voided`, `checks_unmatched`, `refresh`, `stale_days_refreshed`, `duration_ms`, `cpu_estimate_ms` and `flags_warn`. When the run aborts before it reports, the body is `{"outcome": "failed", "stage": "runner", "error": "…"}`. Environment and secrets: [`sync.md`](sync.md#edge-function-sync-incremental) and [`secrets.md`](secrets.md).

### `notify`

Planned for step 12c; the function does not exist yet. Its database side is in place since step 12a (verified locally): `app.notify_tickets` holds single-use tickets on the ADR-028 pattern; `app.post_notify_ticket(p_reason)` posts only `{"ticket": id}` to the function through `pg_net`; `app.claim_notify_ticket(p_ticket)` claims a ticket once; `app.issue_notify_ticket(p_reason)` issues one for a manual run. Only `postgres` may execute them, and no schedule posts tickets yet. Today `fnb notify tick` on GitHub Actions (`notify.yml`, `sync.yml`) does the dispatcher's work. This section will give the route, the body and the responses once the function exists.

## 6. Command line

The `fnb` CLI talks to Postgres directly as `postgres`, not through this API. Its reference is in [`sync.md`, CLI reference](sync.md#cli-reference) and in [the README](../README.md#the-fnb-cli). Both still lack the commands of phase 12 (`digest`, `notify tick`, `notify status`, `notify test`, `notify link`, `notify unlink`, `notify job-failed`). Until they catch up, `pnpm --filter @fnb/jobs fnb -- <command> --help` gives the authoritative usage.

## 7. Keeping this page current

Run the check after every migration that adds, drops or changes a function in `public`, or changes its grants:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm docs:check-api
```

- **What it compares:** every function in `public` that `authenticated` may execute, leaving out extension members and trigger functions. Each needs one fenced `sql` block on this page that starts with `public.<name>(`, and whose arguments with their defaults and whose result equal `pg_get_function_arguments` and `pg_get_function_result`. Whitespace, line breaks and a `public.` prefix on a type do not count. The check also fails on a documented function that no longer exists, that `authenticated` may not execute, or that appears twice.
- **How it reads the catalogue:** with `DATABASE_URL` set, through the workspace's postgres client in a read-only transaction. For a host that is not local it asks for TLS (`sslmode=require`) unless the URL names a stricter mode, and it refuses a URL whose `sslmode` allows plaintext (`disable`, `allow`, `prefer`), as the Edge Function does. Without `DATABASE_URL` it falls back, for local use only, to `docker exec supabase_db_FNB_Managment psql` (the container is named after `project_id` in `supabase/config.toml`), also read-only.
- **Result:** exit 0 when in step; 1 when out of step, with each problem listed and a missing function printed as a block ready to paste; 2 on a usage or connection error. `--list` prints the functions found, and `--doc <file>` checks another file. Pass the database URL only in `DATABASE_URL`: an argument that is not an option is refused without being printed, and credentials inside a printed option, path or error are replaced by `<redacted>`.
- **Other code blocks:** a `sql` block on this page that does not document a signature must not start with `public.`; examples start with `select` or `set`.

CI does not run the check yet.

## 8. OpenAPI (Swagger) description

`docs/api/openapi.json` is PostgREST's own OpenAPI 2.0 (Swagger) description of `/rest/v1` as the role `authenticated` sees it: the functions of section 3 as `/rpc/<name>` and the tables and views of section 4, with their parameters, columns and types (25 functions and 52 tables and views on 2026-11-14). It holds the schema only, never data. It does not describe the Edge Function endpoints (section 5), the auth endpoints (`/auth/v1`) or the row-level security, which this page explains.

| What | Command |
|---|---|
| Browse it in Swagger UI | `pnpm docs:api`, then open `http://127.0.0.1:5290`. "Try it out" is switched off, so the page never calls the database |
| Regenerate it after a migration | `pnpm docs:openapi`, and commit the file in the same change as the migration |
| Check that it matches the database | `pnpm docs:check-openapi`; `pnpm verify` and CI's `database` job run it |

The export runs only against the local stack. It reads the API address, the publishable key and the local signing secret from `supabase status` and nothing else, refuses an address that is not local, signs a five-minute token that carries only the role `authenticated`, and refuses when the migrations applied to the local database differ from `supabase/migrations`, so the description always matches the repository. Keys are sorted and Biome formats the file, so a diff shows real changes only. Swagger UI is loaded from cdnjs at a pinned version.
