# Database API

This page is the reference for anyone who builds a client of the FNB Manager database. It covers how to call the database, how sign-in and roles decide what a caller sees, every function in the `public` schema that a signed-in user may execute, the tables and views that PostgREST serves, and the Edge Function endpoints. It is written for a developer taking the work over, for reviewers and testers, and for whoever runs the platform after go-live. The owner needs only [Authentication and roles](#2-authentication-and-roles). Column meanings and computation rules stay in [`schema.md`](schema.md), metric definitions in [`metrics.md`](metrics.md) and the numbered requirements in [`requirements.md`](requirements.md); this page says how to call them.

Last updated 2026-11-18

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
  M["Mini Apps<br/>(phase 13)"] -- "Zalo access token" --> Z["Edge Functions<br/>zalo-session, zalo-phone"]
  Z -- "secret key: two RPCs<br/>and the Auth admin API" --> P
  O["Zalo OA and Bot"] -- "signed events" --> W2["Edge Functions<br/>oa-webhook, bot-webhook"]
  W2 -- "SUPABASE_DB_URL<br/>as postgres" --> D
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

To call report functions in such a transaction, `@fnb/reports` exports `createJsonRpcClient(queryable)` (`packages/reports/src/source/json-rpc-client.ts`), an `rpc(fn, args)` client for any object with an `unsafe(query, params)` method, such as a postgres.js transaction. It accepts every function of `analyticsFunctions` and `themeFunctions`, binds each argument by name with its type from `ARGUMENT_SQL_TYPES` (arrays as quoted array literals), and runs one statement that returns the rows as JSON produced by Postgres, in the function's order: `select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) as rows from public.<fn>(<arg> => $1::<type>, …) with ordinality as r`. An unknown function or argument answers `invalid_call` without touching the database; a database error keeps its SQLSTATE, and its message only for `22023`. `createRpcReportSource(createJsonRpcClient(transaction), "postgres")` then gives the same `ReportSource` the browser uses. `fnb datapack` (#137) reads the whole data pack that way: `withReportSnapshot(sql, memberUserId, run)` in `apps/jobs/src/datapack/snapshot.ts` opens one `repeatable read read only` transaction, switches to the member as above (the claims from `memberClaims` of `@fnb/notify/postgres`) and hands `run` that source, so every report call of the pack sees one snapshot and the same rows the member's browser would ([strategy.md, section 8](strategy.md#8-building-and-checking-a-pack-from-the-command-line)). Phase 12's digest keeps its own client for the report registry.

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
- **The `memberships` claim.** Every access token Supabase Auth issues, in the browser or a Mini App, carries a claim `memberships` added by the access-token hook `app.custom_access_token_claims` (migration `zalo_sign_in`, registered under `[auth.hook.custom_access_token]` in `supabase/config.toml`, #205): one entry `{"tenant_id", "role", "store_ids"}` per tenant the login belongs to, in tenant order, `store_ids` null for every store of the tenant, and an empty list for a login without a membership. The hook keeps every other claim and replaces a `memberships` claim the request already carried. The claim is for clients to read their role without a query; row-level security never trusts it and still reads `tenant_members`, so a membership changed after the token was issued applies to the next query, and the claim follows when the token is refreshed. The local stack picks the hook up at its next start; the cloud project registers it at go-live (#210, [`go-live.md`](go-live.md)).
- **Mini App sessions.** A Mini App has no password: it posts the Zalo access token to `zalo-session` (section 5), which answers with a session of the member's existing login once that Zalo identity is bound to it, minted through the Auth admin API (ADR-037). The session is a normal Supabase session with the same claims and policies as the web app's.

### Database roles

| Role | Who uses it | What it reaches |
|---|---|---|
| `anon` | a request without a session | nothing: no privilege on any table or view, and no `EXECUTE` on any function in `public` or `app` |
| `authenticated` | a signed-in login: the web app, a Mini App, or server code acting as a member | `SELECT` on every table and view in `public` except `pos_account_tokens`, `zalo_tokens`, `oa_events` and `sale_payloads`, and on 20 columns of `notification_channels` only; the writes under [Writes through tables](#writes-through-tables); `EXECUTE` on the 52 functions of section 3; always filtered by RLS |
| `service_role` | the secret key | bypasses RLS; no client holds it. `fnb tenant add-member` uses it to create logins through the Auth admin API, and the Edge Functions `zalo-session` and `zalo-phone` (#205) use it for exactly three RPCs that only `service_role` may execute, `zalo_session_app`, `zalo_session_sign_in` and `zalo_session_pair` (section 3.10), for the Auth admin API (a bound member's e-mail, the magic-link token that mints the session, ADR-037, and at a roster person's first pairing the login it creates, #213) and to check a caller's session |
| `postgres` | `DATABASE_URL` or `SUPABASE_DB_URL`: the `fnb` CLI, the GitHub Actions jobs, the Edge Functions `sync-incremental`, `oa-webhook` and `bot-webhook`, and `pg_cron` | owns every table and function and bypasses RLS; the only role that may run the schedule, notification and webhook functions in `app` |
| `supabase_auth_admin` | Supabase Auth itself | executes the access-token hook `app.custom_access_token_claims` (with `USAGE` on schema `app`), nothing else of this project; no API role may execute the hook |

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

- 48 of the 52 functions are `security invoker`: every table they read applies the caller's policies. The `store_ids` a caller passes are a request, not a grant. A store the caller may not read adds nothing, and no error says so.
- The report functions return per-store rows only for stores that the caller sees in `stores`, once each, in the order of their first position in `store_ids`. A publisher, who sees stores but no sale, gets those rows with null totals and no item, payment, promotion or shift row.
- A total is null, not 0, when its range holds no data that the caller may read.
- `refresh_my_analytics`, `publish_legal_document`, `retire_legal_document` and `oa_event_counts` are `security definer`. Each checks the caller's role itself.

## 3. Functions in `public`

The schema `public` holds 66 functions. `authenticated` may execute 63 of them, all but the three RPCs of the Zalo sign-in (`zalo_session_app`, `zalo_session_sign_in`, `zalo_session_pair`), which only `service_role` may execute (section 3.10); `service_role` may execute every one but the two legal-text functions, `oa_event_counts` and the eleven functions of sections 3.11 and 3.12, which act only for a signed-in member; `anon` may execute none. Of the 63, 50 are `security invoker` and `stable` (`today_store_totals` and `my_staff_notice` among them); the five roster and staff-revenue writers of section 3.11 and the four writers of section 3.12 are `security invoker` and `volatile` wrappers of `security definer` functions in `app`; `refresh_my_analytics`, `publish_legal_document` and `retire_legal_document` are `security definer` and `volatile`, and `oa_event_counts` is `security definer` and `stable`. All of them set an empty `search_path`. No name is overloaded.

Each entry gives the signature exactly as Postgres prints it (`pg_get_function_arguments` and `pg_get_function_result`), then what calls it today, its status and notes. Column meanings and computation rules are in [`schema.md`](schema.md), sections "Query functions" and "Report functions (phase 9)"; report rules are in [`metrics.md`](metrics.md#report-conventions).

**Who may call.** Any signed-in member may call the 49 stable invoker functions. The numbers cover only the stores that the caller's data role reads, so a publisher gets nulls or no rows (see [How RLS shapes function results](#how-rls-shapes-function-results)); staff read revenue only as their tenant's `staff_revenue_visibility` allows (section 3.11). `refresh_my_analytics`, the two legal-text functions, `oa_event_counts` and the functions of sections 3.11 and 3.12 have their own rules.

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
| [`store_coverage`](#publicstore_coverage) | reports | invoker, stable | rows per store | web reports and themes, digest | verified locally (phase 9) |
| [`period_compare`](#publicperiod_compare) | reports | invoker, stable | 3 or 4 rows | web reports, digest | verified locally (phase 8) |
| [`period_compare_by_store`](#publicperiod_compare_by_store) | reports | invoker, stable | rows per store and period | web reports, digest | verified locally (phase 9) |
| [`period_series`](#publicperiod_series) | reports | invoker, stable | rows per bucket | web reports, digest, web themes Doanh thu, Thanh toán, Khuyến mãi and Chất lượng dữ liệu | verified locally (phase 9) |
| [`daily_baselines`](#publicdaily_baselines) | reports | invoker, stable | rows per date | web reports | verified locally (phase 9) |
| [`hourly_profile`](#publichourly_profile) | reports | invoker, stable | 24 rows | web reports, digest | verified locally (phase 9) |
| [`item_summary`](#publicitem_summary) | reports | invoker, stable | rows per item | web reports, digest | verified locally (phase 9) |
| [`payment_summary`](#publicpayment_summary) | reports | invoker, stable | rows per payment method | web reports, digest, web theme Thanh toán | verified locally (phase 9) |
| [`promotion_summary`](#publicpromotion_summary) | reports | invoker, stable | rows per promotion | web reports, digest, web theme Khuyến mãi | verified locally (phase 9) |
| [`shift_review`](#publicshift_review) | reports | invoker, stable | rows per shift | web reports, digest, web themes Thanh toán and Ca & két tiền | verified locally (phase 9) |
| [`store_targets`](#publicstore_targets) | reports | invoker, stable | rows per store | web reports | verified locally (phase 9) |
| [`item_velocity`](#publicitem_velocity) | reports | invoker, stable | rows per item | web reports | verified locally (phase 8) |
| [`month_pace`](#publicmonth_pace) | reports | invoker, stable | 1 row | web reports | verified locally (phase 8) |
| [`forecast_accuracy`](#publicforecast_accuracy) | reports | invoker, stable | 2 rows | web reports | verified locally (phase 8) |
| [`item_lifecycle`](#publicitem_lifecycle) | reports | invoker, stable | rows per item | web reports | verified locally (phase 9) |
| [`metric_value`](#publicmetric_value) | metric_value | invoker, stable | `numeric` | SQL: `metric_compare`; `fnb digest --check-ngay` | verified locally (phase 8) |
| [`metric_compare`](#publicmetric_compare) | metric_value | invoker, stable | rows per metric and period | web reports, digest | verified locally (phase 9) |
| [`refresh_my_analytics`](#publicrefresh_my_analytics) | settings and writes | definer, volatile | `bigint` | the web catch-up runner through the settings source (`refreshChunk`, the newest 92 pending days at a time) | verified locally (phase 8) |
| [`publish_legal_document`](#publicpublish_legal_document) | settings and writes | definer, volatile | `uuid` | the Pháp lý settings page (#164) | built (phase 10b) |
| [`retire_legal_document`](#publicretire_legal_document) | settings and writes | definer, volatile | `uuid` | the Pháp lý settings page (#164) | built (phase 10b) |
| [`analytics_catch_up_status`](#publicanalytics_catch_up_status) | settings and writes | invoker, stable | 0 or 1 row | the web catch-up banner and runner through the settings source (`catchUpStatus`), on every theme and settings page | verified locally (phase 10a) |
| [`report_settings_of`](#publicreport_settings_of) | themes | invoker, stable | rows per store | web themes Giờ & ngày, Thực đơn, Thanh toán, Khuyến mãi and Ca & két tiền | verified locally (phase 10a) |
| [`range_totals`](#publicrange_totals) | themes | invoker, stable | rows per range and store | web themes Doanh thu, Thanh toán and Khuyến mãi | verified locally (phase 10a) |
| [`opening_productivity`](#publicopening_productivity) | themes | invoker, stable | rows per store | web theme Giờ & ngày | verified locally (phase 10a) |
| [`hour_profile`](#publichour_profile) | themes | invoker, stable | up to 82 rows | web theme Giờ & ngày | verified locally (phase 10a) |
| [`menu_engineering`](#publicmenu_engineering) | themes | invoker, stable | rows per item | web theme Thực đơn | verified locally (phase 10a) |
| [`item_margins`](#publicitem_margins) | themes | invoker, stable | rows per item | web themes Thực đơn and Chất lượng dữ liệu | verified locally (phase 10a) |
| [`item_attach`](#publicitem_attach) | themes | invoker, stable | 1 row, then rows per drink | Thực đơn (attach rates, last 92 days and the 92 before) | verified locally (phase 10a) |
| [`basket_pairs`](#publicbasket_pairs) | themes | invoker, stable | up to 900 pairs | Thực đơn (items sold together, last 92 days, 3 invoices, top 50) | verified locally (phase 10a) |
| [`modifier_summary`](#publicmodifier_summary) | themes | invoker, stable | rows per modifier name | Thực đơn (sugar and ice, with the previous range) | verified locally (phase 10a) |
| [`promotion_days`](#publicpromotion_days) | themes | invoker, stable | rows per store, date and promotion | no caller yet; the demo port (#190) | built (phase 10b) |
| [`promotion_catalogue`](#publicpromotion_catalogue) | themes | invoker, stable | rows per promotion | no caller yet (Khuyến mãi, #153) | built (phase 10b) |
| [`promotion_lift`](#publicpromotion_lift) | themes | invoker, stable | a row per day, then a summary | web theme Khuyến mãi (its lift card) | built (phase 10b) |
| [`promotion_compliance`](#publicpromotion_compliance) | themes | invoker, stable | rows per promotion, then the invoice total | no caller yet (Khuyến mãi, #153) | built (phase 10b) |
| [`item_discount_days`](#publicitem_discount_days) | themes | invoker, stable | rows per item | no caller yet (Khuyến mãi, #153) | built (phase 10b) |
| [`shift_adjustments`](#publicshift_adjustments) | themes | invoker, stable | rows per shift | web theme Ca & két tiền | built (phase 10b) |
| [`data_quality_items`](#publicdata_quality_items) | themes | invoker, stable | rows per item | web theme Chất lượng dữ liệu (#158), Cài đặt → Phân loại → Nhóm của món (#160) | built (phase 10b) |
| [`data_quality_summary`](#publicdata_quality_summary) | themes | invoker, stable | a row for all stores, then one per store | web theme Chất lượng dữ liệu (#158), Cài đặt → Cửa hàng's receipt suggestion (#159) | built (phase 10b) |
| [`data_quality_payments`](#publicdata_quality_payments) | themes | invoker, stable | rows per payment method | web theme Chất lượng dữ liệu (#158) | built (phase 10b) |
| [`store_profiles`](#publicstore_profiles) | data pack | invoker, stable | rows per store | the data pack builder's first call (`packCalls`, #134), in the pack tab (#142) and `fnb datapack` (#137); the exports' store labels (#139) | built (phase 11a) |
| [`metric_windows`](#publicmetric_windows) | data pack | invoker, stable | up to 300 rows | the data pack's KPI table (`packCalls`, #134), in the pack tab and `fnb datapack` | built (phase 11a) |
| [`holiday_calendar`](#publicholiday_calendar) | data pack | invoker, stable | rows per date and name | the data pack's calendar of the horizon (`packCalls`, #134), in the pack tab and `fnb datapack` | built (phase 11a) |
| [`pack_fence`](#publicpack_fence) | data pack | invoker, stable | `text` | the pack tab's build in the browser, before and after its report calls (#142) | built (phase 11a) |
| [`export_control_totals`](#publicexport_control_totals) | exports | invoker, stable | rows per store | the export proof of Xuất dữ liệu (#139 to #141) | built (phase 11a) |
| [`oa_event_counts`](#publicoa_event_counts) | Zalo | definer, stable | rows per OA, day and signature outcome | no caller yet (the OA webhook's health for owners) | built (phase 13, #207) |

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

- **Called by:** web reports (Ngày discounts, Tuần promotions, Tháng discount cost), digest, the web theme Khuyến mãi (the range for its discount and voucher cards, and the last 92 days of the range for the lift card's promotion picker, one call when they are the same days).
- **Notes:** one row per promotion; `promotion_kind` is `item`, `bill` or `voucher`, and `lines` is null for bills and vouchers. At most 400 days (92 until migration `promotion_and_shift_functions` of phase 10b).

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

- **Called by:** web reports (Ngày shifts, Tháng shift statistics), digest, Thanh toán's drawer card (the last 92 days of the range, thresholds left to the tenant's settings), Ca & két tiền's sales and drawer cards (the range, at most 92 days, thresholds left to the tenant's settings). The demo port reads the same settings for thresholds a call leaves out, held by `demo-analytics:parity/shift-review` with the default and a tenant's thresholds.
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
- **Called by:** the web settings source's `refreshChunk` (`apps/web/src/settings/supabase-settings-source.ts`), one call per chunk of the pending catch-up, newest days first (`[max(pending_from, pending_to − 91), pending_to]`), driven by the catch-up runner (`apps/web/src/settings/catch-up/`); the sync jobs refresh through `app.refresh_analytics` as `postgres`.
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
- **Called by:** the web settings source's `catchUpStatus` (`apps/web/src/settings/supabase-settings-source.ts`), for the catch-up banner and runner on every theme and settings page: when the page mounts, after each settings save and once a minute while a day up to today is pending.
- **Status:** verified locally (phase 10a; pgTAP `34_theme_access.sql`, `35_mappings_and_catch_up.sql`).
- **Notes:** the days whose refresh-time aggregates may still use mappings or fee rates from before the last change. Every write to `item_type_roles`, `item_category_overrides` or `payment_fee_rates` moves `tenants.analytics_inputs_version` and marks the whole history pending; `pending_from` starts at the tenant's first aggregate date. `pending_days` is 0 and both ends are null when nothing is pending, and also for a tenant without any aggregate yet, whose first refresh empties the range. Every refresh shrinks the range by the days it covers (`app.shrink_analytics_pending`, [`schema.md`](schema.md), "Refresh"). `can_refresh` follows the rule of `refresh_my_analytics`. It reads no refresh history.

#### `public.publish_legal_document`

```sql
public.publish_legal_document(p_document_id uuid)
returns uuid
```

- **Who may call:** an owner with an unlimited scope of the document's tenant. Anyone else, and an id the caller cannot see, gets `42501`, so ids cannot be probed; a document that is not a draft gives `22023`.
- **Called by:** the Pháp lý settings page (#164), through "Công bố" after a confirmation; a `22023` answer there says the version was already published or withdrawn elsewhere.
- **Status:** built (phase 10b; pgTAP `38_settings_writes.sql`).
- **Notes:** checks the caller before taking any lock, then serialises publications of the same kind and language with a transaction lock, retires the version that is published, publishes this draft and returns its id, all in one call, with dates from the database's clock. A published or retired text never changes again (`55000`).

#### `public.retire_legal_document`

```sql
public.retire_legal_document(p_document_id uuid)
returns uuid
```

- **Who may call:** as `publish_legal_document`; a document that is not published gives `22023`.
- **Called by:** the Pháp lý settings page (#164), through "Ngừng áp dụng" after a confirmation; a `22023` answer there says the version was already published or withdrawn elsewhere.
- **Status:** built (phase 10b; pgTAP `38_settings_writes.sql`).
- **Notes:** retires the published version with the database's clock and returns its id; the kind and language then have no published version until another is published.

#### Writes through tables

Settings are written as rows, not through functions. RLS decides each write. The web app writes `item_type_roles` and `report_settings` through its settings source, one upsert per save on the table's unique key (`(pos_account_id, item_type_external_id)` and `tenant_id`). Cài đặt → Ngưỡng báo cáo saves `report_settings` this way, sending only the columns the owner changed and asking for the row back (`Prefer: return=representation`), so a value another device saved meanwhile, or a column this page does not show, is never overwritten from a stale screen. When the returned row then holds the default in every column, the source deletes it (`delete … where tenant_id = …` and every column still equals its default, so a value saved in between is kept), and the tenant reads the column defaults again; a failure of that delete alone leaves a row of default values and does not fail the save. Cài đặt → Phân loại writes `item_type_roles`: one upsert of the assigned rows, then for a role set back to "Chưa gán" a delete per POS account (`delete … where tenant_id, pos_account_id and item_type_external_id in (…)` with the deleted rows returned); when fewer rows came back than were asked for, a re-read tells a row that was already gone from one that row-level security kept, which is reported as refused.

| Table | Insert | Update | Delete |
|---|---|---|---|
| `item_costs`, `payment_fee_rates`, `targets` | owner or manager whose scope covers the row's store | same | same |
| `item_type_roles` | owner or manager with an unlimited scope | same | same |
| `item_category_overrides` | owner or manager with an unlimited scope | same | same |
| `report_settings` | owner with an unlimited scope | same | same |
| `holidays` | owner or manager with an unlimited scope, naming themselves as `created_by`; tenant rows only, global rows are read-only | same | same |
| `stores` | never | the seven profile columns only (`code`, `opening_hours`, `seat_count`, `opened_on`, `e_invoice_status`, `tran_no_reset_period`, `member_capture_status`): owner or manager whose scope covers the store; `opening_hours` an owner of that store only (`42501`); a code another store of the tenant holds, compared trimmed and upper-cased, gives `23505` naming `stores_code_unique_in_tenant`; any other column gives `42501` | never |
| `tenants` | never | `legal_form` and `default_language` only: owner with an unlimited scope; any other column gives `42501` | never |
| `payment_kind_overrides` | owner or manager with an unlimited scope; `payment_methods.kind` follows at once and `pos_kind` keeps the POS value | same | same; deleting restores the POS kind |
| `legal_documents` | owner with an unlimited scope, drafts only (a row marked published or carrying a date gives `42501`) | `title`, `body_markdown` and `version` only, of drafts (`55000` once published) | drafts only |
| `strategy_reports` | owner, manager or publisher whose scope covers the row's store | owner or manager whose scope covers the row's store | same as update |
| `consent_records` | owner or manager of the tenant, any scope; never purpose `notifications` or `staff_ops`, which only the person's own path records ([section 3.12](#312-staff-notice-consent-and-pairing-phase-14a)) | the same; a trigger lets an update set `revoked_at` once and nothing else | never |
| `data_subject_requests` | owner or manager with an unlimited scope; a trigger fills the deadlines | the same | never |
| `alert_rules` | owner with an unlimited scope; a trigger validates the rule and its parameters (`22023`) | the same | the same |
| `channel_policies` | owner with an unlimited scope, tenant rows only; CHECK constraints keep the legal floors | the same | the same |
| `brands`, `zalo_apps`, `oas`, `mini_apps`, `zbs_templates`, `gmf_groups` | owner with an unlimited scope, naming themselves as `created_by`; a secret column takes only a `ZALO_` name with its column's prefix and a Mini App title must follow Zalo's naming rules (`23514`); a store of another tenant in `store_ids` gives `23503` | the same | the same; deleting a brand removes everything under it |

Status: the tables, policies and triggers are verified locally (pgTAP `05_write_policies.sql`, `07_write_scope_and_attribution.sql`, `10_payment_fee_rates.sql`, `11_item_type_roles_and_holidays.sql`, `12_consent_and_legal.sql`, `31_notify_access.sql`, `35_mappings_and_catch_up.sql`). Inserts must name the caller as `created_by`, and a trigger sets `updated_by` to the caller on every insert and update of the manual-input tables, `item_category_overrides`, `report_settings`, `payment_kind_overrides`, `legal_documents` and `holidays`; a member's change of a store or tenant profile column stamps `profile_updated_at` and `profile_updated_by`. The 10b rows are verified by pgTAP `38_settings_writes.sql`. Cài đặt → Ngưỡng báo cáo writes `report_settings` (phase 10a); the other Settings screens are designed for phase 10b, Kế hoạch and `fnb publish-plan` (which will insert plans as the publisher) for 11b, and Settings → Cảnh báo after step 12c. The 10b Settings pages that write the store and tenant profiles (Cửa hàng, #159), the payment-kind overrides (Phân loại, #160) and the legal texts (Pháp lý, #164) are built on these rules. Destinations in `notification_channels` are written only by server code ([section 3.5](#35-notifications)). The Zalo configuration rows are built and tested by pgTAP `42_zalo_config.sql` (#203); no client writes them yet: the brand settings screen belongs to phase 20a, and the `fnb zalo config` command is still to be built.

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


#### `public.promotion_days`

```sql
public.promotion_days(
  store_ids uuid[], from_date date, to_date date,
  kind_filter text DEFAULT NULL::text, key_filter text DEFAULT NULL::text
)
returns TABLE(
  store_id uuid, business_date date, promotion_kind text, promotion_key text,
  promotion_name text, invoices bigint, lines bigint, discount_amount numeric
)
```

- **Called by:** nothing on a screen yet; the demo port (#190). Khuyến mãi's lift card (#191) reads `promotion_lift`, which finds the promotion days itself.
- **Status:** built (phase 10b; pgTAP `36_promotion_functions.sql`).
- **Notes:** per store, date and promotion, optionally one kind or one kind and key (a key without a kind gives `22023`). `promotion_name` is the POS name, else the key; `lines` is null for bills and vouchers. Summed over dates and stores it equals `promotion_summary`. At most 400 days and 900 rows; ordered by date, store position, kind and key.

#### `public.promotion_catalogue`

```sql
public.promotion_catalogue(store_ids uuid[], as_of_date date)
returns TABLE(
  promotion_kind text, promotion_key text, promotion_name text,
  in_catalogue boolean, catalogue_active boolean,
  starts_at timestamp with time zone, ends_at timestamp with time zone,
  first_used_on date, last_used_on date, days_used_365 integer,
  invoices_365 bigint, discount_365 numeric
)
```

- **Called by:** nothing yet; Khuyến mãi's catalogue card (#153).
- **Status:** built (phase 10b; pgTAP `36_promotion_functions.sql`).
- **Notes:** the `promotions` rows of the stores' POS accounts (kind `item`) together with every key used at the stores up to the as-of day, of any kind. First and last use are all-time; the `_365` columns cover the 365 days ending on the as-of day and are 0 for a promotion not used in them. Ordered by last use, newest first, the never-used last. At most 900 rows.

#### `public.promotion_lift`

```sql
public.promotion_lift(
  store_ids uuid[], promotion_kind text, promotion_key text,
  from_date date, to_date date, comparator text,
  pre_weeks integer DEFAULT NULL::integer
)
returns TABLE(
  business_date date, promo_day boolean, control_day boolean,
  test_gross_amount numeric, test_net_amount numeric, test_invoices bigint,
  discount_amount numeric, reference_gross_amount numeric, reference_days integer,
  counterfactual_gross_amount numeric, gross_lift_amount numeric,
  test_store_count integer, control_store_count integer, promo_days integer,
  measured_days integer, control_days integer, trend_adjustment_amount numeric,
  net_lift_amount numeric, lift_rate numeric, flags text[]
)
```

- **Called by:** the web theme Khuyến mãi's lift card (#191), once its 92-day promotions and `report_settings_of` have answered, for the chosen promotion and comparator over the last 92 days of the range, with `pre_weeks` set to the tenant's `promo_pre_weeks` from `report_settings_of`, so a saved change gives a new call; the demo port in `@fnb/demo-analytics`, held to it by `demo-analytics:parity/promotion-lift`.
- **Status:** built (phase 10b; pgTAP `36_promotion_functions.sql`).
- **Notes:** difference-in-differences on gross revenue for one promotion over at most 92 days, against `baseline` (the median of the same weekday in the 8 weeks before, at least 3 dates), `prior_weeks` (the mean of the weekday in the `pre_weeks` before the first promotion day, the tenant's 4 when null) or `sister_store` (the requested stores that did not run it). Baseline and prior weeks subtract the mean trend of at least 7 control days. One row per day of the window, then a summary row (`business_date` null) with the counts, `gross_lift_amount`, the discount and `net_lift_amount` of the measured days, `lift_rate` and the `flags` (`no_test_store`, `few_promo_days`, `few_control_days`, `few_reference_days`, `unmeasured_days`, `no_control_store`, `control_differs_in_size`, `excluded_days_in_window`, `other_promotions`). A wrong kind, comparator or `pre_weeks` outside 2 to 8 gives `22023`. Definitions in [`schema.md`](schema.md), "Thematic report functions (phase 10)".

#### `public.promotion_compliance`

```sql
public.promotion_compliance(
  store_ids uuid[], from_date date, to_date date, cap_rate numeric DEFAULT 0.5
)
returns TABLE(
  promotion_kind text, promotion_key text, promotion_name text,
  checked_rows bigint, max_partial_rate numeric, over_cap_rows bigint,
  over_cap_discount_amount numeric, first_over_cap_on date, last_over_cap_on date,
  full_discount_rows bigint, full_discount_amount numeric,
  first_full_discount_on date, last_full_discount_on date
)
```

- **Called by:** nothing yet; Khuyến mãi's cap card (#153), with the cap of `@fnb/core`'s promotion rules.
- **Status:** built (phase 10b; pgTAP `36_promotion_functions.sql`).
- **Notes:** per promotion, the discounted lines (items) or invoices (bills, vouchers): a row whose discount covers its whole base is full (a gift, a free invoice) and never over the cap; a partial row is over the cap when its rate exceeds `cap_rate` (above 0, at most 1). The last row, kind `invoice_total`, checks each invoice's partial discounts over its base without its free lines. Ordered by rows over the cap, then kind and key. At most 400 days.

#### `public.item_discount_days`

```sql
public.item_discount_days(
  store_ids uuid[], calendar_year integer, as_of_date date DEFAULT NULL::date
)
returns TABLE(
  item_external_id text, item_name text, price_discount_days integer,
  line_price_discount_days integer, bill_discount_days integer,
  gift_days integer, voucher_days integer,
  first_price_discount_on date, last_price_discount_on date
)
```

- **Called by:** nothing yet; Khuyến mãi's discount-days card (#153).
- **Status:** built (phase 10b; pgTAP `36_promotion_functions.sql`).
- **Notes:** per item discounted in the calendar year up to the as-of day (the stores' as-of day when null): the days its price was discounted on the line or by a partial bill discount, those two apart, and the gift and voucher days apart, counted over the stores together. `calendar_year` from 2023 to the current year. At most 900 rows.

#### `public.shift_adjustments`

```sql
public.shift_adjustments(
  store_ids uuid[], from_date date, to_date date, z_threshold numeric DEFAULT NULL::numeric
)
returns TABLE(
  store_id uuid, shift_id uuid, shift_external_id text, shift_name text,
  business_date date, cashier_name text, opened_at timestamp with time zone,
  closed_at timestamp with time zone, orders bigint, item_lines bigint,
  voids integer, void_amount numeric, edits integer, removed_lines integer,
  removed_amount numeric, edits_after_close integer, changed_after_close boolean,
  void_rate numeric, removed_line_rate numeric, trailing_shifts integer,
  void_z_score numeric, removed_z_score numeric, flagged boolean, reasons text[]
)
```

- **Called by:** Ca & két tiền's adjustments card (the range, at most 92 days, the z threshold left to the tenant's settings).
- **Status:** built (phase 10b; pgTAP `37_shift_and_quality_functions.sql`).
- **Notes:** per shift of `agg_shift_cash` in the range: its orders and item lines, its voids, edits and removed lines (an event goes to the shift of its invoice, else to the shift whose window holds its time), edits after the shift closed, and the void and removed-line rates scored one-sided against the store's shifts of the 56 days before (at least 3). `flagged` when a score is above the threshold (the tenant's 2 when null) or an edit came after the close; `reasons` lists `voids`, `removed_lines`, `after_close`. At most 92 days.

#### `public.data_quality_items`

```sql
public.data_quality_items(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  item_external_id text, item_name text, pos_account_id uuid,
  pos_type_external_id text, pos_type_name text, override_type_external_id text,
  item_type_external_id text, item_type_name text, type_known boolean,
  role item_type_role, cost_known boolean, catalogue_modifier boolean,
  quantity numeric, net_amount numeric, net_share numeric
)
```

- **Called by:** nothing yet; Chất lượng dữ liệu (#157, #158).
- **Status:** built (phase 10b; pgTAP `37_shift_and_quality_functions.sql`, `39_theme_access_b.sql`).
- **Notes:** per item key sold in the range (`agg_item_daily`): the POS type, the override, the effective type and whether it exists in the account's catalogue, the role (null when unmapped), whether a cost is in force on the last day, whether the catalogue marks the item as a modifier although it sold as an item line, and its share of net sales. Ordered by net sales. At most 400 days and 900 rows.

#### `public.data_quality_summary`

```sql
public.data_quality_summary(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  store_id uuid, invoices bigint, item_lines bigint, modifier_lines bigint,
  modifier_line_share numeric, catalogue_modifier_lines bigint,
  identified_invoices bigint, capture_rate numeric, identified_customers bigint,
  loyalty_consents bigint, marketing_consents bigint, consent_coverage numeric,
  unattributed_events bigint, e_invoice_status e_invoice_status,
  tran_no_reset_period tran_no_reset_period, member_capture_status pos_feature_status,
  opening_hours_known boolean, seat_count integer, opened_on date,
  receipt_days integer, receipt_restarts_daily boolean
)
```

- **Called by:** nothing yet; Chất lượng dữ liệu (#157, #158).
- **Status:** built (phase 10b; pgTAP `37_shift_and_quality_functions.sql`, `39_theme_access_b.sql`).
- **Notes:** a row for all stores (`store_id` null, the store columns null), then one per visible store in the order asked. Lines of the non-voided invoices (items, modifiers, items the catalogue calls modifiers), identified invoices and the capture rate, identified customers with their active loyalty and marketing consents, adjustment events no shift claims, the store's e-invoicing, receipt numbering, member feature, opening hours, seats and opening date, and over the 120 days up to the last day the days with numeric receipts and whether 90 % of them start at 3 or below (null with fewer than 20 such days). At most 400 days.

#### `public.data_quality_payments`

```sql
public.data_quality_payments(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  pos_account_id uuid, payment_method_external_id text, payment_method_name text,
  kind payment_kind, pos_kind payment_kind, override_kind payment_kind,
  in_catalogue boolean, invoices bigint, amount numeric
)
```

- **Called by:** nothing yet; Chất lượng dữ liệu (#157, #158).
- **Status:** built (phase 10b; pgTAP `37_shift_and_quality_functions.sql`, `39_theme_access_b.sql`).
- **Notes:** every payment method of the stores' POS accounts and every method id paid in the range (`agg_payment_daily`, `unknown` included): the effective kind, the POS kind, the tenant's override, whether the catalogue knows the id, and the invoices and amount paid (null for a method not paid). Ordered by amount, unpaid last. At most 400 days.

### 3.9 Data pack and exports (phase 11)

Migration `pack_and_export_functions` adds the functions behind the AI data pack and the proof of an export. The first three join the theme registry of `@fnb/reports` (`themeFunctions`) and have demo ports; `pack_fence` and `export_control_totals` are called with `supabase.rpc()` directly. Tests: pgTAP `40_pack_functions.sql` and `41_export_totals.sql`, and the parity suite (`store-profiles`, `metric-windows` and `holiday-calendar.parity.test.ts`).

#### `public.store_profiles`

```sql
public.store_profiles(store_ids uuid[])
returns TABLE(
  store_id uuid, tenant_id uuid, label text, name text, timezone text,
  business_day_start_minutes integer, opened_on date, opening_hours jsonb,
  seat_count integer, e_invoice_status e_invoice_status, currency_code text,
  country_code text
)
```

- **Called by:** the data pack builder of `@fnb/datapack` (#134), as its first call: labels, currency, country and the default as-of day; it runs in the pack tab (#142) and in `fnb datapack` (#137). The browser export reads its store labels from it too (#139).
- **Status:** built (phase 11a; pgTAP `40_pack_functions.sql`; parity `store-profiles.parity.test.ts`).
- **Notes:** one row per visible store in the order asked. `label` is `S<n>`, the store's rank among the tenant's stores the caller can see, by `first_seen_at` then `id`; an inactive store keeps its place, so for an owner a label means the same store in every pack. No address, store code or POS id. A publisher reads the profiles, as it reads `stores`.

#### `public.metric_windows`

```sql
public.metric_windows(store_ids uuid[], metric_ids text[], from_dates date[], to_dates date[])
returns TABLE(range_index smallint, from_date date, to_date date, metric_id text, value numeric)
```

- **Called by:** the data pack's KPI table (#134: one call per scope, the 18 trackable ids over the eleven KPI windows); the KPI follow-up of plans comes in phase 11b.
- **Status:** built (phase 11a; pgTAP `40_pack_functions.sql`; parity `metric-windows.parity.test.ts`).
- **Notes:** `metric_value` of the stores together for 1 to 25 ids over 1 to 12 ranges of at most 400 days each, ordered by range (1-based `range_index`), then id in the order asked. `22023` names the limit for too many ids or ranges, lists of different lengths, a reversed or too long range; an id that `metric_value` does not compute raises its own `22023`. An empty store list returns no row, before any id is checked.

#### `public.holiday_calendar`

```sql
public.holiday_calendar(store_ids uuid[], from_date date, to_date date)
returns TABLE(holiday_date date, name text, kind holiday_kind)
```

- **Called by:** the data pack's calendar of the horizon (#134).
- **Status:** built (phase 11a; pgTAP `40_pack_functions.sql`; parity `holiday-calendar.parity.test.ts`).
- **Notes:** the global holidays of the visible stores' tenant countries and those tenants' own holidays of the same country, once per date, name and kind, ordered by date, then name in byte order (`collate "C"`), then kind. At most 400 days. Nothing for stores the caller cannot see.

#### `public.pack_fence`

```sql
public.pack_fence(store_ids uuid[])
returns text
```

- **Called by:** the pack tab of Xuất dữ liệu (#142, `packFence` in `apps/web/src/datapack/browser-pack.ts`, through `supabase.rpc()`): `buildDataPack` (#134) reads the fence before and after its report calls and builds again when the two differ, up to three times, then fails with `pack_data_changed`. `fnb datapack` needs no fence, since it reads inside one read-only snapshot, and the demo passes none.
- **Status:** built (phase 11a; pgTAP `40_pack_functions.sql`).
- **Notes:** a lowercase hex SHA-256 over what moves the pack's numbers for the visible stores: the refresh log, `synced_at` of invoices of the last live days, sync checks, the tenants' analytics-input version and stamp, item costs, targets, tenant holidays, report settings and the store profiles. It is not part of the pack.

#### `public.export_control_totals`

```sql
public.export_control_totals(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  store_id uuid, invoices bigint, voided_invoices bigint, sales_net_amount numeric,
  invoice_fingerprint text, lines bigint, line_net_amount numeric, line_fingerprint text,
  payments bigint, payment_amount numeric, payment_fingerprint text, shifts bigint,
  shift_sales_amount numeric, shift_fingerprint text
)
```

- **Called by:** the browser export of Xuất dữ liệu (#139 to #141), which proves each file against it.
- **Status:** built (phase 11a; pgTAP `41_export_totals.sql`).
- **Notes:** per visible store over at most 92 days: counts, sums and SHA-256 fingerprints of invoices, lines (by their invoice's business date), payments (by their own business date) and shifts (by the business date of `opened_at` in the store's zone after the day start). [`schema.md`](schema.md#data-pack-and-export-functions-phase-11) gives the canonical lines. A publisher gets zero counts, zero sums and the fingerprint of the empty text.

### 3.10 Zalo (phase 13)

Migration `zalo_inbound_events` (#207) adds one function a client may call. Migration `zalo_sign_in` (#205) adds two more to `public`, `zalo_session_app(p_brand_key text, p_tenant_id uuid default null)` and `zalo_session_sign_in(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_binding_code text default null)`, and migration `staff_pairing` (#213) a third, `zalo_session_pair(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_code text default null, p_notice_version text default null, p_notice_shown_at timestamp with time zone default null, p_new_user_id uuid default null)`. They are the database half of `zalo-session` and `zalo-phone` (section 5): `security invoker` wrappers of `app.zalo_resolve_app`, `app.zalo_sign_in` and `app.zalo_pair` that only `service_role` may execute, so `authenticated` and `anon` get `42501` and no client calls them; they are not part of this page's check. Since #213 `zalo_session_sign_in` answers `notice_required` for a bound person on the staff roster whose `staff_ops` consent is missing or outdated, and every `unpaired` answer carries the tenant's published staff notice. Tests: pgTAP `44_zalo_identity.sql`, `45_zalo_events.sql`, `48_staff_consent.sql` and `49_staff_pairing.sql`.

#### `public.oa_event_counts`

```sql
public.oa_event_counts(p_tenant_id uuid, p_from date, p_to date)
returns TABLE(oa_id uuid, day date, signature text, events integer)
```

- **Called by:** no caller yet; a view of the OA webhook's health for owners is planned with the Zalo settings.
- **Status:** built (phase 13, #207; pgTAP `45_zalo_events.sql`).
- **Who may call:** an owner of the tenant, whatever the store scope; anyone else, a manager included, gets `42501`. It is `security definer` because the counts sit in `app.oa_event_days`, which no API role reads.
- **Notes:** the count-only facts of the tenant's OA webhook from `p_from` to `p_to`, at most 400 days (`22023` beyond, or for a reversed or missing bound): per OA, tenant-local day and signature outcome (`raw`, `compact`, `mismatch`, `missing`, or `refused` for a call refused in enforce mode), the number of events, ordered by day, OA and outcome. Never an event, a user id or a text. The counts outlive the 90 days for which `oa_events` keeps the events.

### 3.11 Staff roster and staff revenue (phase 14a)

Migrations `staff_roster` (#211) and `operations_rls` (#216) add six functions a client may call. Each is a `security invoker` wrapper of the `app` function of the same name, which is `security definer` with an empty `search_path` and checks the caller's role itself; the roster functions write `staff_roster` and the matching `tenant_members` row, which no client writes directly. No client calls them yet: Settings → Nhân viên (#214) and the staff app (#215, #217) will. Tests: pgTAP `46_staff_roster.sql` and `47_operations_rls.sql`.

#### `public.add_staff`

```sql
public.add_staff(p_tenant_id uuid, p_display_name text, p_role tenant_role, p_store_ids uuid[])
returns uuid
```

- **Status:** built (phase 14a, #211).
- **Who may call:** an owner or a manager of the tenant, for stores within their scope; a store-limited caller cannot grant another store or every store (`22023`), nobody grants `owner` through it (`22023`), a store outside the caller's scope gives `42501` and a store of another tenant `23503`.
- **Notes:** adds a person as `invited` with role `staff` or `manager` and their stores (`null` means every store) and returns the roster id; pairing with the staff app (#213) makes the row `active` and creates the membership.

#### `public.update_staff`

```sql
public.update_staff(p_roster_id uuid, p_display_name text, p_role tenant_role, p_store_ids uuid[])
returns void
```

- **Status:** built (phase 14a, #211).
- **Who may call:** as `add_staff`, for a row whose every store is in the caller's scope.
- **Notes:** changes the name, role and stores; on an active row the membership follows at once.

#### `public.deactivate_staff`

```sql
public.deactivate_staff(p_roster_id uuid)
returns void
```

- **Status:** built (phase 14a, #211).
- **Who may call:** as `update_staff`.
- **Notes:** marks the row `inactive` and removes the membership, the person's notification destinations and binding codes, their Zalo identities in the tenant and their Auth sessions and refresh tokens; the phone is cleared. Calling it twice does nothing more. Removing a membership by any other path also deactivates the roster row.

#### `public.reactivate_staff`

```sql
public.reactivate_staff(p_roster_id uuid)
returns void
```

- **Status:** built (phase 14a, #211).
- **Who may call:** as `update_staff`.
- **Notes:** returns an inactive row to `invited`, so access needs a new pairing. Calling it twice does nothing more.

#### `public.set_staff_revenue_visibility`

```sql
public.set_staff_revenue_visibility(p_tenant_id uuid, p_visibility text)
returns text
```

- **Status:** built (phase 14a, #216).
- **Who may call:** an owner of the tenant with every store; anyone else gets `42501`. An unknown or missing level gives `22023`.
- **Notes:** sets `tenants.staff_revenue_visibility` and returns it: `all` (the default: staff read every revenue row of their stores, as a manager of those stores does), `store_totals` (staff read no revenue row, only today's totals through `today_store_totals`) or `none` (staff read no revenue at all; report functions and `metric_value` return nothing for them). Owners, managers and viewers are not affected. The tenant's profile stamps record who changed it.

#### `public.today_store_totals`

```sql
public.today_store_totals()
returns TABLE(store_id uuid, business_date date, net_amount numeric, invoices bigint)
```

- **Status:** built (phase 14a, #216).
- **Who may call:** any member; data roles get the stores in their scope, staff only when their tenant's level is `store_totals` or `all`, a publisher or a login without membership nothing.
- **Notes:** today's net revenue and invoice count of each store, voided invoices left out as Hôm nay counts them, by each store's own business date.

### 3.12 Staff notice, consent and pairing (phase 14a)

Migrations `staff_notice_consent` (#212) and `staff_pairing` (#213) add five functions a client may call. Each is a `security invoker` wrapper of the `app` function of the same name, which is `security definer` with an empty `search_path` and acts for the caller only: no owner or manager records, changes or revokes a person's `staff_ops` consent, and restrictive policies refuse a `staff_ops` row written to `consent_records` from the browser by any role, as for `notifications`. The staff notice is the tenant's published Vietnamese `legal_documents` row of kind `staff_notice`; a consent names its `version` as `policy_version` and is outdated once another version is published. The pairing itself is the `zalo-session` request of section 5. No client calls these functions yet: Settings → Nhân viên (#214) will issue codes and the staff app (#215) the rest. Tests: pgTAP `48_staff_consent.sql` and `49_staff_pairing.sql`.

#### `public.issue_pairing_code`

```sql
public.issue_pairing_code(p_roster_id uuid)
returns text
```

- **Status:** built (phase 14a, #213).
- **Who may call:** an owner or a manager of the tenant whose scope holds every store of the roster row, as for `update_staff`; anyone else, or an unknown row, gets `42501`. An `inactive` row gives `22023` (reactivate it first), and so does a row bound to a login that is an owner, viewer or publisher of the tenant.
- **Notes:** returns a 6-digit pairing code once, valid 10 minutes in every brand app of the tenant. Only `sha256(tenant_id:code)` is stored, in `app.staff_pairing_codes`, which no API role reads; a new code replaces the row's previous one, and deactivating the row deletes it. A wrong code sent to `zalo-session` counts against every live code of the tenant (five tolerated, the sixth burns them) and against the Zalo identity, which waits 15 minutes after its fifth wrong code in a row.

#### `public.accept_staff_notice`

```sql
public.accept_staff_notice(p_tenant_id uuid, p_notice_version text, p_notice_shown_at timestamp with time zone)
returns uuid
```

- **Status:** built (phase 14a, #212).
- **Who may call:** a paired person on the tenant's roster (an `active` row and its membership), for themselves; anyone else gets `42501`. A version that is not the published one, or a showing time before its publication or after the call (five minutes of clock skew allowed), gives `22023`.
- **Notes:** records the caller's `staff_ops` consent and returns its id: channel `mini_app`, `policy_version` the notice version, evidence `method` (`accept_button`), `notice_version`, `notice_channel` (`mini_app`), `notice_shown_at` and `accepted_at`, and nothing that identifies the person or the phone. The same version already active is kept; an outdated one is closed at this acceptance. For a new notice version while the staff app holds a session; the first consent is recorded by the pairing step of `zalo-session`.

#### `public.withdraw_staff_ops_consent`

```sql
public.withdraw_staff_ops_consent(p_tenant_id uuid)
returns boolean
```

- **Status:** built (phase 14a, #212).
- **Who may call:** a person on the tenant's roster, for themselves; anyone else gets `42501`.
- **Notes:** revokes the caller's `staff_ops` consent, unpairs their Zalo identities in the tenant and ends every Auth session of their login, so the next `zalo-session` call answers `unpaired` and a new pairing code is needed. The `notifications` consent, the membership and the roster row stay as they were, and withdrawing `notifications` leaves `staff_ops` as it was. Returns whether a consent was active; calling it again changes nothing more. An access token minted before stays valid until it expires (at most an hour).

#### `public.my_staff_notice`

```sql
public.my_staff_notice(p_tenant_id uuid)
returns jsonb
```

- **Status:** built (phase 14a, #212).
- **Who may call:** any member of the tenant; anyone else gets `42501`.
- **Notes:** `{"consent": "current" | "outdated" | "missing" | "not_required", "notice": {"version", "title", "body_markdown", "published_at"} | null}` for the caller: `not_required` for a member who is not on the staff roster, `outdated` once a newer notice is published. The staff app calls it at each open, since a stored session skips `zalo-session`.

#### `public.link_my_phone`

```sql
public.link_my_phone(p_tenant_id uuid, p_phone text)
returns text
```

- **Status:** built (phase 14a, #213).
- **Who may call:** a paired person on the tenant's roster (an `active` row), for their own row only; anyone else, an owner or manager included, gets `42501`. A number not in international form (`+` and 8 to 15 digits) gives `22023`.
- **Notes:** stores the number that `zalo-phone` decoded for the caller, with `phone_linked_at`, and returns its hint (`…` and the last three digits); `null` removes it. Optional and separate from pairing: nothing else depends on it. `authenticated` never selects `staff_roster.phone`, only `phone_hint`.

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
| `consent_records` | append-only consent ledger per subject and purpose | data roles of the tenant | [yes](#writes-through-tables), except `notifications` and `staff_ops` | none |
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
| `alert_rule_catalog` | the 16 alert and digest rules with defaults and the parameter schema, `zalo_webhook_unverified` included (#207) | every signed-in user | none | none |
| `alert_rules` | tenant and store overrides of the catalogue | owners and managers; store rows in scope | [owners](#writes-through-tables) | none |
| `channel_policies` | send rules per channel kind and message class: 27 global defaults and tenant overrides | global rows: every signed-in user; tenant rows: owners and managers | [owners](#writes-through-tables) | none |
| `notification_channels` | destinations: member, kind, provider, label, status and health | owners and managers with an unlimited scope read every destination; every member reads their own; 20 columns only, never the address, secret name or configuration | none (server code only) | none |
| `alert_events` | alert episodes with count-only facts | owners and managers whose scope covers the event's store | none | none |
| `digests` | one daily digest per tenant, business date and store scope, built from the Ngày report | owners and managers whose data stores include every store of the digest | none | none |
| `outbound_messages` | the outbox and the one-year log of every message sent | owners and managers with an unlimited scope or covering the message's store; the recipient of a message to their own destination | none | none |

### Zalo configuration (phase 13)

Built (migration `zalo_configuration`, pgTAP `42_zalo_config.sql`, #203); every table is empty until the owner's Zalo accounts exist (#8). Owners and managers of the tenant read the configuration whatever their store scope; staff, viewers, the publisher and `anon` read none of it. Columns and checks: [`schema.md`](schema.md), "Zalo configuration".

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `brands` | one row per brand: the neutral key (`brand-1`), the display name, the stores it covers | owners and managers of the tenant | [owners with an unlimited scope](#writes-through-tables) | none |
| `zalo_apps` | the brand's Zalo App: its id, the name of its secret (`ZALO_APP_SECRET_<BRAND>`), `active` or `disabled` | the same | the same | none |
| `oas` | the brand's Official Account: its id, package tier and expiry, verification, the name of its secret (`ZALO_OA_SECRET_<BRAND>`), the webhook mode (`observe` or `enforce`) | the same | the same | none |
| `mini_apps` | the brand's staff and customer Mini Apps: id, `browsable`, title, header titles and colours, the inputs of `app-config.json` | the same | the same | none |
| `zbs_templates` | ZBS templates of an OA: id, tag, purpose, approval state | the same | the same | none |
| `gmf_groups` | the OA's staff groups and the stores each serves | the same | the same | none |
| `zalo_identities` | a Zalo user id per Zalo App bound to an Auth user, with the display name only | the same | none (`zalo-session` writes it through `zalo_session_sign_in` when a binding code is used, #205, and through `zalo_session_pair` at a pairing, #213; `withdraw_staff_ops_consent` and `deactivate_staff` delete the person's rows) | none |
| `zalo_tokens` | the OA and Mini App developer token pairs of a brand | nobody (no grant, no policy) | none (the token jobs, #206) | none |
| `oa_events` | the OA webhook's event log: event id, OA, event name, OA user id, times and signature outcome, never a text; kept 90 days | nobody (no grant, no policy); owners read the day counts through [`oa_event_counts`](#publicoa_event_counts) | none (`oa-webhook` writes it as `postgres`, #207) | none |

## 5. Edge Function endpoints

### Shared rules of the Zalo functions

Built in `supabase/functions/_shared` (`cors.ts`, `http.ts`; 30 Deno tests in `cors.test.ts` and `http.test.ts`, #204). The four Zalo functions below are built on `serveFunction` and enabled in `supabase/config.toml`: `zalo-session` with `verify_jwt = false`, `zalo-phone` with `verify_jwt = true`, `oa-webhook` and `bot-webhook` with `verify_jwt = false`. None is deployed yet; they run on the local stack and against a mock of Zalo (`@fnb/zalo/testing`). Each follows these rules, and its own section gives its body and codes.

- **CORS.** The answer names exactly one origin, and only a Mini App origin: when the request's `Origin` is `https://h5.zdn.vn` or `zbrowser://h5.zdn.vn`, the response carries `Access-Control-Allow-Origin` with that origin; any other origin, or none, gets no `Access-Control-*` header at all. Every response carries `Vary: Origin`, added to any `Vary` the handler set. Any CORS header a handler set itself is replaced, and no `Access-Control-Allow-Credentials` is sent.
- **Preflight.** `OPTIONS` never reaches the handler: it answers 204 with no body; for a Mini App origin it adds `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info` and `Access-Control-Max-Age: 600`. The recipe to check it locally is in [`development.md`](development.md), section 6.
- **Request id.** Every other response carries `x-request-id`, a fresh UUID per request, which also starts each of the function's log lines (`<name> <request id>: …`). Quote it when reporting a failure.
- **Responses.** JSON with `content-type: application/json; charset=utf-8` and `cache-control: no-store`.
- **Errors.** The body is `{"error": "<code>", "request_id": "<id>"}`; a code is a lowercase word (`^[a-z][a-z0-9_]{0,40}$`, otherwise sent as `request_refused`). The shared codes:

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_body` | the body is not valid UTF-8 |
| 400 | `invalid_json` | the body is not a JSON object |
| 405 | `method_not_allowed` | the function does not take this method |
| 413 | `body_too_large` | the body is over the function's limit, 16,384 bytes by default, by its `Content-Length` or while it is read |
| 500 | `not_configured` | a function secret is missing or empty; the answer does not name it, the log names the secret but never a value |
| 500 | `internal_error` | anything unexpected; the log line carries the redacted error |

- **Secrets and logs.** A function reads a secret only by its name through the request context. Every log line passes the redactor, which knows the values of the `ZALO_` secret variables (all but `ZALO_INTEGRATION`, `ZALO_TENANT_ID` and the `_BASE_URL` overrides), the Supabase keys and JWT secret, the database URLs with their user and password, and every secret the function read; line breaks become spaces. `zalo-session` and `zalo-phone` also add every token, code, Zalo user id, display name, e-mail and phone number of the request to the redactor before they log, and the log lines of all four hold outcomes and counts only.

**Open until #210.** These functions are built against a mock of Zalo, because the owner's Zalo accounts do not exist yet (#8). The device check #210 confirms on a real phone and the real accounts: the Graph's real error codes (only 119, a phone token already used, is assumed by number), the exact bytes and header form Zalo signs for `X-ZEvent-Signature`, the event names of menu and button taps, the body shape and token format of the Zalo Bot's webhook, and the domain verification of the function URLs in the Zalo console. Until then the sections below describe what the code accepts, not what Zalo has been seen to send.

### `zalo-session`

Built against the mock (#205, with the staff notice and pairing of #212 and #213; Deno 25 tests in `handler.test.ts` and `pairing.test.ts`, and the gated integration suite of `@fnb/zalo`). The Mini Apps' session client (`@fnb/zalo-mini`, #208) reads every answer below; the answers of #205 are unchanged except that `member` gained `tenant_id` and `unpaired` may carry `notice`, `reason` and `retry_after`.

- **URL:** `<SUPABASE_URL>/functions/v1/zalo-session`. **Method:** `POST`; `OPTIONS` answers the preflight of a Mini App origin.
- **Authorization:** none at the gateway (`verify_jwt = false`); the Zalo access token in the body is the credential.
- **Body:** `{"access_token": "<the Mini App's Zalo access token>", "brand": "brand-1"}` plus at most one of these steps:
  - `"binding_code": "123456"`: a member binds the Zalo account once with a code of `fnb zalo bind` (#205);
  - `"pairing_code": "123456", "notice": {"version": "<the staff notice version shown>", "shown_at": "<ISO time it was shown>"}`: a person on the staff roster, after reading and accepting the staff notice, pairs with the code a manager issued (`issue_pairing_code`, section 3.12); a binding code is accepted here too;
  - `"notice": {…}` alone: a paired person accepts a newly published notice.

  `binding_code` and `pairing_code` together are refused.
- **What it does:** finds the brand's Zalo App through `zalo_session_app` (one app, `active`), reads the App secret named by `zalo_apps.secret_name`, and asks the Zalo Graph `GET /v2.0/me?fields=id,name` with the access token and its app-secret proof (HMAC-SHA256 of the access token keyed with the App secret), 10 seconds at most. `zalo_session_sign_in` then answers `bound` for a Zalo user id already bound to a current member of the app's tenant, binds it first when a valid binding code comes with it, and answers `unpaired` otherwise; a request with `pairing_code` or `notice` goes to `zalo_session_pair` instead. Before any session for a person on the staff roster, the `staff_ops` consent must be current: otherwise the answer is `notice_required`, unless the acceptance sent along records it. A valid pairing code, with the published notice accepted, records the consent, creates or updates the membership with exactly the roster role and stores, binds the Zalo identity of this app and makes the roster row `active`. At a person's first pairing the roster row has no login yet: the database answers `login_needed`, the function creates a login without password through the Auth admin API (`staff-<uuid>@zalo-staff.invalid`, an address that can never receive mail) and pairs again with it; a login it then does not need is deleted. A person paired in one brand's app pairs again in another brand's app of the tenant with a new code and keeps the same login and roster row. For `bound` the function reads the member's login e-mail through the Auth admin API and mints a session for that login (ADR-037).

| Status | Body | When |
|---|---|---|
| 200 | `{"status": "bound", "access_token", "refresh_token", "expires_at", "member": {"display_name", "role", "stores", "tenant_id"}}` | the Zalo identity is bound to a member, now or before; `stores` are the names of the brand's stores within the member's scope, `display_name` the Zalo name or "Thành viên", `tenant_id` the tenant that the functions of section 3.12 take |
| 200 | `{"status": "unpaired", "reason"?, "retry_after"?, "notice"?}` | no binding and no code; a wrong, expired, used or burnt code; or a bound login that no longer exists. `notice` is the tenant's published staff notice, `{"version", "title", "body_markdown", "published_at"}`, when there is one. A pairing request adds `reason`: `code_refused` for any refused code, never saying whether it was wrong, expired, used, burnt or a code of a roster row that cannot pair; `wait` with `retry_after` in seconds when the identity must wait after five wrong codes; `notice_outdated` when the notice accepted is not the published one, and the code was then not checked |
| 200 | `{"status": "notice_required", "notice"?}` | a bound person on the staff roster whose `staff_ops` consent is missing or names an older notice; no session until the notice is accepted. Without `notice`, no staff notice is published |
| 400 | `invalid_access_token` | the token is missing, empty or over 4,096 characters |
| 400 | `invalid_brand` | `brand` is not a brand key (`brand-<n>`, `n` from 1 to 999) |
| 400 | `invalid_binding_code` | `binding_code` is present but not six digits |
| 400 | `invalid_pairing_code` | `pairing_code` is present but not six digits, or comes with `binding_code` |
| 400 | `invalid_notice` | `notice` is not `{"version", "shown_at"}` with a legal-document version and a readable time |
| 400 | `invalid_json`, `invalid_body` | the shared body errors |
| 401 | `zalo_token_refused` | the Graph answered an error for the token or its proof |
| 403 | `app_disabled` | the brand's Zalo App is `disabled` |
| 404 | `unknown_brand` | no Zalo App is configured for the brand key |
| 500 | `not_configured` | the App secret is not set; `SUPABASE_URL` or the service key is missing; the brand key names Zalo Apps of two tenants and `ZALO_TENANT_ID` does not choose; an invalid `ZALO_INTEGRATION`, `ZALO_TENANT_ID` or `ZALO_GRAPH_BASE_URL`; or, with `ZALO_INTEGRATION=1`, a tenant that is not a `zalo-it-` fixture |
| 500 | `session_unavailable` | the bound login has no e-mail to mint a session for |
| 502 | `zalo_unavailable` | the Graph did not answer in time, or answered something unreadable |
| 503 | `backend_unavailable` | PostgREST or Supabase Auth did not answer, refused, or answered something unreadable; also when creating a staff login failed, and nothing was paired then |

Pairing codes come from `issue_pairing_code` (section 3.12): six digits, valid 10 minutes, stored only as a hash salted by the tenant. A wrong code counts against every live pairing code of the tenant and every live binding code of the app (five tolerated, the sixth burns them) and against the Zalo identity, which waits 15 minutes after its fifth wrong code; the identity is kept only as a hash. Log lines name the outcome only (`unpaired: the pairing code was refused`, `notice required: …`, `session minted: staff, 1 stores, identity bound, login created`), never the code, a token, the Zalo id, the login or its e-mail.

Binding codes come from `fnb zalo bind` (section 6): six digits, valid 10 minutes, stored only as a hash. A wrong code counts against every live code of the brand's Zalo App; five wrong attempts are tolerated and the sixth burns them all, so guessing gains nothing ([`security.md`](security.md), section 4.3).

### `zalo-phone`

Built against the mock (#205; Deno 7 tests in `handler.test.ts`, and the gated integration suite).

- **URL:** `<SUPABASE_URL>/functions/v1/zalo-phone`. **Method:** `POST`.
- **Authorization:** `Authorization: Bearer <the caller's Supabase session>`; the gateway verifies it (`verify_jwt = true`) and the function checks it again with Supabase Auth.
- **Body:** `{"brand": "brand-1", "access_token": "<Zalo access token>", "phone_token": "<the token of the phone-number consent>", "mode": "number"}`. `mode` is `number` (the default) or `probe`; in `probe` mode `phone_token` may be null, when the member declined, and `consent_error_code` may carry the SDK's error number.
- **What it does:** exchanges the phone token once, within its two-minute life, at the Graph `GET /v2.0/me/info` with the access token and the App secret, and answers the number in international form (`+84…`). It stores nothing; the number goes only to the caller. The probe mode (the phone-consent probe screen of a Development build, #208 and #210) answers whether the consent and the exchange succeeded and the error number, never the number, and logs counts only.

| Status | Body | When |
|---|---|---|
| 200 | `{"phone_number": "+84…"}` | `number` mode, the token exchanged |
| 200 | `{"probe": {"consent": true or false, "exchange": "ok", "refused", "unavailable" or "skipped", "error_code": <number or null>}}` | `probe` mode |
| 400 | `invalid_brand`, `invalid_access_token`, `invalid_phone_token`, `invalid_mode`, `invalid_consent_error_code` | a malformed field; `consent_error_code` only in `probe` mode |
| 401 | `session_required` | no bearer session, or one Supabase Auth does not accept |
| 403, 404 | `app_disabled`, `unknown_brand` | as for `zalo-session` |
| 409 | `phone_token_used` | the Graph says the token was already used (error 119) |
| 422 | `phone_token_refused` | any other Graph error: expired, invalid, or a proof that fails |
| 500 | `not_configured` | as for `zalo-session` |
| 502 | `zalo_unavailable` | the Graph did not answer; the token may be spent |
| 503 | `backend_unavailable` | Supabase did not answer |

### `oa-webhook`

Built against fake Zalo events (#207; Deno 24 tests in `handler.test.ts` and `signature.test.ts`, and the gated integration suite `integration.test.ts`). It connects to Postgres as `postgres` with `FNB_DB_URL` or the injected `SUPABASE_DB_URL`, like `sync-incremental`, and sends no CORS header to any origin.

- **URL:** `<SUPABASE_URL>/functions/v1/oa-webhook`, set as the webhook URL in the Zalo developer console (#210). **Method:** `POST`.
- **Authorization:** none at the gateway (`verify_jwt = false`); the event is signed. `X-ZEvent-Signature` (64 hex digits, optionally after `mac=`) must equal SHA-256 of the app id, the body, the event's `timestamp` and the OA secret key (`ZALO_OA_SECRET_<BRAND>`, named by `oas.secret_name`), concatenated. The body is tried as received and re-serialised without spaces, and the outcome is `raw`, `compact`, `mismatch` or `missing`.
- **Body:** a Zalo OA event of at most 65,536 bytes. The function reads `app_id`, `event_name`, the OA id (`oa_id`, else the sender or the recipient by the event's direction), the OA user id (the follower, sender or recipient), `timestamp` in milliseconds and `message.msg_id`; it never keeps the message text or any other field. The event id, the key that drops a second delivery, is SHA-256 of the app id, OA id, event name, user id, timestamp and message id.
- **What it does:** finds the OA by the app id and the OA id (`app.oa_webhook_target`), checks the signature, and lets `app.receive_oa_event` decide against the OA's current `webhook_mode`: a matching signature is stored; a mismatch or a missing signature is stored with its outcome in `observe` mode (the default) and refused in `enforce` mode, where only the day's `refused` count moves. It answers within 1.5 seconds: when the database is slower it answers 200 and stores after the answer. The follow-up runs after the answer: a follow, a message or a menu tap that sends a message moves `last_interaction_at` of that OA user's `zalo_oa` destinations forward, an unfollow disables them (`blocked_by_user`), and the day's unverified calls above `max_per_day` raise `zalo_webhook_unverified`.

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | stored, a duplicate, a body without an app id, OA id or event name, an OA that no row (or more than one tenant's rows) matches, which stores nothing, or an answer sent before the store finished |
| 401 | `invalid_signature` | `enforce` mode and the signature is missing or wrong |
| 400 | `invalid_json`, `invalid_body` | the body is not a JSON object in UTF-8 |
| 405 | `method_not_allowed` | not `POST` |
| 413 | `body_too_large` | over 65,536 bytes |
| 500 | `not_configured` | the OA secret is not set, or the database URL is missing or would allow plaintext |

Zalo retries only failed connections and disables a webhook that keeps failing, so the function answers 200 to everything it cannot use and keeps its work after the answer ([`operations.md`](operations.md), "Zalo disabled the webhook, or signatures do not match").

### `bot-webhook`

Built against fake Bot updates (#207; Deno 12 tests in `handler.test.ts`, and the gated integration suite). It connects to Postgres as `postgres` like `oa-webhook`.

- **URL:** `<SUPABASE_URL>/functions/v1/bot-webhook`. **Method:** `POST`.
- **Authorization:** none at the gateway (`verify_jwt = false`). `X-Bot-Api-Secret-Token` (8 to 256 letters, digits, `_` or `-`) must hash, by SHA-256, to the secret of a Zalo Bot in webhook mode (`app.bot_poll_state.webhook_secret_sha256`); the token itself is never stored. The header is checked before the body is read.
- **Body:** the Bot's update, or a `result` holding updates, at most 65,536 bytes; at most 20 updates are read per call.
- **What it does:** answers 200 at once and handles the text updates after the answer, as the phase 12 poller does: a link code completes a pending link (`app.complete_channel_link`); "ĐỒNG Ý" accepts it and records the member's consent (`app.accept_channel_link`); "DỪNG" or "DUNG" (any case, surrounding punctuation ignored) from a linked chat withdraws the member's `notifications` consent, cancels their waiting messages and disables all their destinations of the tenant, e-mail included (`app.stop_bot_chat`), and sends one confirmation, logged in `outbound_messages` as `stop_confirmation.v1` without its text. Anything else is dropped and never stored.

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | updates accepted, or none to handle |
| 401 | `invalid_secret_token` | the header is missing, malformed, or matches no bot in webhook mode |
| 400, 405, 413 | the shared codes | as for `oa-webhook` |
| 500 | `not_configured` | no database URL, or one that would allow plaintext |

A bot is in webhook mode once `app.set_bot_webhook(<secret name>, <SHA-256 of the secret token>, now())` has stored the token's hash; from then on the poller's lease (`app.take_poll_lease`) is refused for it, because Zalo treats polling and a webhook as exclusive. Only `postgres` may run that function, and no `fnb` command calls the Bot's `setWebhook` yet, so every bot is still polled by `fnb notify tick` until an operator sets both. A missing Bot token secret leaves a stop recorded without its confirmation.

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

The `fnb` CLI talks to Postgres directly as `postgres`, not through this API. Its reference is in [`sync.md`, CLI reference](sync.md#cli-reference) and in [the README](../README.md#the-fnb-cli). Both still lack the commands of phase 12 (`digest`, `notify tick`, `notify status`, `notify test`, `notify link`, `notify unlink`, `notify job-failed`). Until they catch up, `pnpm --filter @fnb/jobs fnb -- <command> --help` gives the authoritative usage. The Zalo commands of phase 13 (#205) are `fnb zalo config set --tenant <slug> (--file <brand.json> | --brand <key> …)`, which writes a brand's Zalo App, OA and Mini App rows from flags or from a JSON file kept outside the repository (secret columns take a `ZALO_` name, never a value; a re-run with the same values changes nothing, different values for a stored row are refused), `fnb zalo config show --tenant <slug>` (with `CI` set, brands are numbered and only their states printed), and `fnb zalo bind --tenant <slug> --member <login e-mail> --brand <key>`, which prints a member's one-time binding code (refused in CI; a publisher login cannot be bound). `fnb datapack`, which reads the report functions as a member inside one snapshot, is described in [strategy.md, section 8](strategy.md#8-building-and-checking-a-pack-from-the-command-line).

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

`docs/api/openapi.json` is PostgREST's own OpenAPI 2.0 (Swagger) description of `/rest/v1` as the role `authenticated` sees it: the functions of section 3 as `/rpc/<name>` and the tables and views of section 4, with their parameters, columns and types (52 functions and 63 tables and views on 2026-11-18, after the seven Zalo tables that `authenticated` can read and `oa_event_counts`). It holds the schema only, never data. It does not describe the Edge Function endpoints (section 5), the auth endpoints (`/auth/v1`) or the row-level security, which this page explains.

| What | Command |
|---|---|
| Browse it in Swagger UI | `pnpm docs:api`, then open `http://127.0.0.1:5290`. "Try it out" is switched off, so the page never calls the database |
| Regenerate it after a migration | `pnpm docs:openapi`, and commit the file in the same change as the migration |
| Check that it matches the database | `pnpm docs:check-openapi`; `pnpm verify` and CI's `database` job run it |

The export runs only against the local stack. It reads the API address, the publishable key and the local signing secret from `supabase status` and nothing else, refuses an address that is not local, signs a five-minute token that carries only the role `authenticated`, and refuses when the migrations applied to the local database differ from `supabase/migrations`, so the description always matches the repository. Keys are sorted and Biome formats the file, so a diff shows real changes only. Swagger UI is loaded from cdnjs at a pinned version.
