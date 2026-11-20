# Database API

This page is the reference for anyone who builds a client of the FNB Manager database. It covers how to call the database, how sign-in and roles decide what a caller sees, every function in the `public` schema that a signed-in user may execute, the tables and views that PostgREST serves, and the Edge Function endpoints. It is written for a developer taking the work over, for reviewers and testers, and for whoever runs the platform after go-live. The owner needs only [Authentication and roles](#2-authentication-and-roles). Column meanings and computation rules stay in [`schema.md`](schema.md), metric definitions in [`metrics.md`](metrics.md) and the numbered requirements in [`requirements.md`](requirements.md); this page says how to call them.

Last updated 2026-11-19

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
| `checklist_runs` (phase 14b) | `tenant_id`, `store_id` and `template_id` only, as the caller, with the store in their operations scope; a trigger fills the rest (`22023` for another store's checklist, `55000` for a retired one) | `status` only, from `open` to `finished`, by the run's actor (`42501` for anyone else, `55000` backwards) | never |
| `checklist_answers` (phase 14b) | never (created with the run) | `done`, `number_value` and `photo_path` only: the run's actor while it is open, a manager of the store at any time; the rules of `save_checklist_answer` | never |
| `shift_handovers` (phase 14b) | `tenant_id`, `store_id`, `from_shift`, `to_shift`, `note`, as the caller, with the store in scope | `from_shift`, `to_shift` and `note`, by the writer until acknowledged | never |
| `incidents` (phase 14b) | `tenant_id`, `store_id`, `occurred_at`, `kind`, `category_key`, `description`, `item_label`, as the caller, with the store in scope | `occurred_at`, `category_key`, `description`, `item_label` and `photo_paths`, by the reporter while the report is open | never |
| `cash_counts` (phase 14b) | `tenant_id`, `store_id`, `counted_amount`, `denominations`, `note` and `replaces_id`, as the caller, with the store in scope; matching and evaluation follow at once | never | never |
| `incident_categories` (phase 14b) | owner with an unlimited scope, tenant rows only, naming themselves as `created_by`; the global defaults are read-only | `label`, `sort_order` and `active` only; a key never changes | the same as insert |
| `approval_requests` (phase 15) | `tenant_id`, `store_id`, `kind_key` and `details` only, as the caller, with the store in their operations scope; a trigger makes it pending (`22023` for a kind that is not active for the tenant) | never; a decision goes through [`decide_request`](#publicdecide_request) | never |
| `approval_request_kinds` (phase 15) | owner with an unlimited scope, tenant rows only, naming themselves as `created_by`; the global defaults are read-only | `label`, `sort_order` and `active` only; a key never changes | the same as insert |

Status: the tables, policies and triggers are verified locally (pgTAP `05_write_policies.sql`, `07_write_scope_and_attribution.sql`, `10_payment_fee_rates.sql`, `11_item_type_roles_and_holidays.sql`, `12_consent_and_legal.sql`, `31_notify_access.sql`, `35_mappings_and_catch_up.sql`). Inserts must name the caller as `created_by`, and a trigger sets `updated_by` to the caller on every insert and update of the manual-input tables, `item_category_overrides`, `report_settings`, `payment_kind_overrides`, `legal_documents` and `holidays`; a member's change of a store or tenant profile column stamps `profile_updated_at` and `profile_updated_by`. The 10b rows are verified by pgTAP `38_settings_writes.sql`. Cài đặt → Ngưỡng báo cáo writes `report_settings` (phase 10a); the other Settings screens are designed for phase 10b, Kế hoạch and `fnb publish-plan` (which will insert plans as the publisher) for 11b, and Settings → Cảnh báo after step 12c. The 10b Settings pages that write the store and tenant profiles (Cửa hàng, #159), the payment-kind overrides (Phân loại, #160) and the legal texts (Pháp lý, #164) are built on these rules. Destinations in `notification_channels` are written only by server code ([section 3.5](#35-notifications)). The Zalo configuration rows are built and tested by pgTAP `42_zalo_config.sql` (#203); no client writes them yet: the brand settings screen belongs to phase 20a, and the `fnb zalo config` command is still to be built.

### 3.5 Notifications

Phase 12 put the dispatcher, digest and linking functions in `app`, where only `postgres` may run them; `authenticated` executes only the check helpers that policies and constraints call (`alert_rule_params_valid`, `channel_kind_available`, `notify_secret_name_valid`, `facts_are_count_only`, `current_user_channel_ids`). Owners link and remove destinations with `fnb notify link` (from the owner's machine; refused in CI) and `fnb notify unlink`; `fnb digest` queues the digests and `fnb notify tick` sends.

Migration `member_notification_settings` (#229) adds five functions with which a member manages their own notifications from the staff app's "Nhận thông báo" screen (Cá nhân). Each is `security definer` with an empty `search_path`, has one signature, is executable by `authenticated` only (not `anon`, not `service_role`), checks the caller with `auth.uid()` and touches the caller's own rows only: no owner or manager links, mutes or stops another member's notifications through them. None returns an address, a chat id, a secret name or a configuration value. The linking rule of phase 12 holds: the app shows the notice `ops-notifications-v1` before it asks for a code, a code becomes a pending destination, and the destination turns active, with the member's `notifications` consent recorded (`method = 'bot_reply'`), only when the member answers the Bot's notice with "ĐỒNG Ý" in the Bot chat (`bot-webhook`, section 5); until then only the link messages reach the member. The functions for Settings → Cảnh báo on the web (#61: the overview, links by e-mail, the test button) are still to come. Callers: the staff app's live client (`apps/zalo-staff/src/team/client.ts`). Tests: pgTAP `100_member_notifications_read.sql` to `104_follow_oa_and_access.sql` and `47_operations_rls.sql`.

#### `public.my_notifications`

```sql
public.my_notifications(p_tenant_id uuid)
returns jsonb
```

- **Status:** built (phase 15, #229).
- **Who may call:** any member of the tenant, for themselves; anyone else, or a caller without a session, gets `42501`. A publisher gets empty lists.
- **Notes:** returns `{"consent", "destinations", "rules", "notice", "bot_name"}`. `consent` is the caller's `notifications` consent: `{"state", "granted_at", "revoked_at", "channel"}` with `state` `active`, `withdrawn` (the latest row was revoked) or `none`. `destinations` are the caller's own destinations, oldest first, each `{"id", "kind", "provider", "label", "address_hint", "status", "enabled", "muted_rules", "linked_at", "last_ok_at", "disabled_reason", "link_stage", "link_expires_at"}`; a pending destination with a live code has `link_stage` `code` (waiting for the code in the Bot chat) or `acceptance` (waiting for "ĐỒNG Ý") and the expiry. `rules` are the catalogue rules `{"rule_key", "category", "delivery"}`, in catalogue order, that the caller's role receives (the tenant row's roles, else the catalogue's, or a store row naming the role) or that one of their destinations already mutes. `notice` is `{"version": "ops-notifications-v1", "text"}`, the phase 12 notice word for word with the tenant's name, Zalo and Zalo Bot. `bot_name` is the display name of the Bot the caller would link (null until a dispatcher read it).

#### `public.start_bot_link`

```sql
public.start_bot_link(p_tenant_id uuid, p_notice_version text)
returns jsonb
```

- **Status:** built (phase 15, #229).
- **Who may call:** a member of the tenant other than a publisher, for themselves; anyone else gets `42501`, as does a member whose Zalo Bot destination the owner removed (`owner_request`). A `p_notice_version` other than `ops-notifications-v1` (the notice the app showed first) gives `22023`; a member whose Zalo Bot is already active or failing gets `23505`; more than 5 starts in an hour give `55000`.
- **Notes:** returns `{"channel_id", "notice_version", "code", "expires_at", "bot_name"}`. Reuses the caller's pending Zalo Bot destination, re-opens one they stopped themselves (as pending, without its old chat id or consent link) or creates one labelled "Zalo Bot" on the Bot the tenant's linked members use (`NOTIFY_ZALO_BOT_TOKEN` when none). The code is `FNB-` plus 8 characters, valid 15 minutes, single use, returned once and stored only as `sha256(secret_name:code)`; a new start replaces the earlier code. The function records no consent; it wakes the dispatcher (`app.kick_notify`), which does nothing while the schedule is off.

#### `public.set_my_muted_rules`

```sql
public.set_my_muted_rules(p_channel_id uuid, p_muted_rules text[])
returns text[]
```

- **Status:** built (phase 15, #229).
- **Who may call:** the member the destination belongs to; anyone else, an unknown destination or a caller without a session gets `42501`. A missing list, a null key, a key outside `alert_rule_catalog` or more than 100 keys give `22023`.
- **Notes:** replaces the destination's `muted_rules` (an empty list unmutes every rule) and returns the list without duplicates in catalogue order. The send decision then cancels a waiting message of a muted rule as `unsubscribed`.

#### `public.stop_my_notifications`

```sql
public.stop_my_notifications(p_tenant_id uuid)
returns integer
```

- **Status:** built (phase 15, #229).
- **Who may call:** any member of the tenant, for themselves; anyone else gets `42501`.
- **Notes:** "Dừng nhận thông báo": in one transaction, `app.withdraw_notifications` revokes the caller's `notifications` consent, cancels the `queued` and `held` messages of every destination of theirs (`decision = 'no_consent'`), deletes destinations still pending a link with their codes, and disables the others as `consent_withdrawn`; a message queued later is cancelled at the next dispatch. Returns the number of messages cancelled (0 when nothing was active). The `staff_ops` consent, the membership, the roster row and the Zalo pairing stay as they were, so the staff app keeps working. To receive messages again the member links again and answers "ĐỒNG Ý".

#### `public.my_follow_oa`

```sql
public.my_follow_oa(p_tenant_id uuid)
returns text
```

- **Status:** built (phase 15, #229).
- **Who may call:** any member of the tenant; anyone else gets `42501`.
- **Notes:** the OA id the staff app passes to the SDK's `followOA`, after its one-line purpose: the OA of the brand whose Zalo App the caller last signed in through (`zalo_identities.updated_at`), else the one OA of the brands meeting the caller's store scope, else null (no OA, or several and no sign-in to choose). Nothing else of `oas` is exposed; the table stays readable by owners and managers only.

### 3.6 Consent and legal

No function in `public`. A client writes `consent_records` and `data_subject_requests` as tables ([Writes through tables](#writes-through-tables)). The helpers `app.has_active_consent(tenant, subject_type, subject, purpose)` and `app.dsr_deadlines(received, country_code, time_zone, uses_processor)` are `security invoker` and executable by `authenticated`, but they sit in `app`, which the API does not serve; policies, triggers and server code use them. A member's `notifications` consent is recorded in SQL when the member accepts a destination linked with `fnb notify link`, and withdrawn by `fnb notify unlink --tenant <slug> --member <login e-mail> --all`, by the member's "DỪNG" in the Bot chat or by `stop_my_notifications` (section 3.5), which also lets the member read it (`my_notifications`). The browser can never insert or update it (two restrictive policies).

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

#### `public.member_share_by_shift`

```sql
public.member_share_by_shift(store_ids uuid[], from_date date, to_date date)
returns TABLE(
  store_id uuid, business_date date, shift_ordinal integer,
  opened_at timestamp with time zone, closed_at timestamp with time zone,
  invoices integer, member_invoices integer, identified_invoices integer,
  member_share numeric, identified_share numeric
)
```

- **Called by:** Ca & két tiền's member share card (#237), over the range and the range before it, at most 92 days each; the demo answers with its port in `@fnb/demo-analytics`.
- **Status:** built (phase 16a, #236; migration `20261119800000_member_share_by_shift`; pgTAP `98_member_share_by_shift.sql`; parity `member-share-by-shift.parity.test.ts`).
- **Who may call:** `authenticated` and `service_role`; `security invoker`, so the policies of `invoices` and `shifts` keep a caller to the stores of their revenue scope (`app.current_user_revenue_store_ids`): a store-limited member gets their stores only, staff only while the tenant's `staff_revenue_visibility` is `all`, the publisher nothing. `anon` cannot execute it.
- **Notes:** the phone-capture KPI (FR-LOY-01). Per store and shift of the range: the non-voided invoices, `member_invoices` (with a `customer_phone`), `identified_invoices` (with a `customer_phone` or a `customer_id`) and both shares to six decimals (null without an invoice). A shift belongs to the business date of its opening under the store's day-start rule, and `shift_ordinal` is the `n` of "Ca n": its place by opening time, then external id, among the store's shifts of that date, as `app.shift_number` numbers it; a shift without invoices comes back with zeros. An invoice counts in the shift its `shift_external_id` names, even when it was sold after midnight; an invoice naming no shift of its store counts in one row per store and business date whose `shift_ordinal`, `opened_at` and `closed_at` are null (Không rõ ca). Rows come by date, then the order of `store_ids`, then `shift_ordinal` with that row last. No column carries a phone, a customer id, a cashier name or the POS shift label. The counts read the stored flags `invoices.has_customer_phone` and `invoices.has_customer_identity`, never the customer columns, so the function keeps working when those columns lose their grant. 0 to 50 stores, at most 92 days; `22023` otherwise, and with the hint to ask for less above 900 rows.

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

Migration `zalo_inbound_events` (#207) adds one function a client may call. Migration `zalo_sign_in` (#205) adds two more to `public`, `zalo_session_app(p_brand_key text, p_tenant_id uuid default null)` and `zalo_session_sign_in(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_binding_code text default null)`, and migration `staff_pairing` (#213) a third, `zalo_session_pair(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_code text default null, p_notice_version text default null, p_notice_shown_at timestamp with time zone default null, p_new_user_id uuid default null)`. Migration `staff_app_texts_and_contact` adds a fourth, `zalo_session_texts(p_zalo_app_id uuid)`, the texts request of `zalo-session`. They are the database half of `zalo-session` and `zalo-phone` (section 5): `security invoker` wrappers of `app.zalo_resolve_app`, `app.zalo_sign_in`, `app.zalo_pair` and `app.zalo_texts` that only `service_role` may execute, so `authenticated` and `anon` get `42501` and no client calls them; they are not part of this page's check. Since #213 `zalo_session_sign_in` answers `notice_required` for a bound person on the staff roster whose `staff_ops` consent is missing or outdated, and every `unpaired` answer carries the tenant's published staff notice. Since `staff_app_texts_and_contact`, the `unpaired` and `notice_required` answers also carry the tenant's staff contact instructions as `contact` when it has some, and a bound answer carries `brand_store_ids`, the ids of the brand's stores in the member's scope in the order of `stores`. `zalo_session_texts` answers the published `privacy_notice` and `mini_app_terms` of the app's tenant in every published language, Vietnamese first, and the contact instructions (`null` when none); past 120 requests per Zalo App within a minute it answers `{"status": "wait", "retry_after": <seconds>}` instead, counted in `app.zalo_texts_requests` (app, window start, count, nothing about the caller). Tests: pgTAP `44_zalo_identity.sql`, `45_zalo_events.sql`, `48_staff_consent.sql`, `49_staff_pairing.sql` and `54_staff_app_texts.sql`.

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
- **Who may call:** an owner or a manager of the tenant, for stores within their scope; a store-limited caller who asks for another store or for every store (`null`) gets `42501`, as does any store outside the caller's scope; nobody grants `owner` through it (`22023`); a store of another tenant gives `23503`.
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

Migrations `staff_notice_consent` (#212) and `staff_pairing` (#213) add five functions a client may call. Each is a `security invoker` wrapper of the `app` function of the same name, which is `security definer` with an empty `search_path` and acts for the caller only: no owner or manager records, changes or revokes a person's `staff_ops` consent, and restrictive policies refuse a `staff_ops` row written to `consent_records` from the browser by any role, as for `notifications`. The staff notice is the tenant's published Vietnamese `legal_documents` row of kind `staff_notice`; a consent names its `version` as `policy_version` and is outdated once another version is published. The pairing itself is the `zalo-session` request of section 5. No client calls these functions yet: Settings → Nhân viên (#214) will issue codes and the staff app (#215) the rest. Migration `staff_app_texts_and_contact` adds a sixth, `set_staff_contact_instructions`, the contact text every staff app of the tenant shows before pairing, and `my_staff_notice` now names a linked phone's hint. Tests: pgTAP `48_staff_consent.sql`, `49_staff_pairing.sql` and `54_staff_app_texts.sql`.

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
- **Notes:** `{"consent": "current" | "outdated" | "missing" | "not_required", "notice": {"version", "title", "body_markdown", "published_at"} | null, "phone_hint"?: "…789"}` for the caller: `not_required` for a member who is not on the staff roster, `outdated` once a newer notice is published. `phone_hint` (`…` and the last three digits) is there only while the caller's roster row holds a phone they linked, so Cá nhân shows it when it opens; never the number. The staff app calls it at each open, since a stored session skips `zalo-session`.

#### `public.link_my_phone`

```sql
public.link_my_phone(p_tenant_id uuid, p_phone text)
returns text
```

- **Status:** built (phase 14a, #213).
- **Who may call:** a paired person on the tenant's roster (an `active` row), for their own row only; anyone else, an owner or manager included, gets `42501`. A number not in international form (`+` and 8 to 15 digits) gives `22023`.
- **Notes:** stores the number that `zalo-phone` decoded for the caller, with `phone_linked_at`, and returns its hint (`…` and the last three digits); `null` removes it. Optional and separate from pairing: nothing else depends on it. `authenticated` never selects `staff_roster.phone`, only `phone_hint`.

#### `public.set_staff_contact_instructions`

```sql
public.set_staff_contact_instructions(p_tenant_id uuid, p_text text)
returns text
```

- **Called by:** no caller yet; the contact field of Cài đặt → Nhân viên is being built.
- **Status:** built (migration `staff_app_texts_and_contact`; pgTAP `54_staff_app_texts.sql`).
- **Who may call:** an owner of the tenant with every store; anyone else, a store-limited owner and managers included, gets `42501`. More than 500 characters (`the staff contact instructions hold at most 500 characters`), a control character other than a line break or a tab (`… are plain text without control characters`) or a link (`… hold no link`) gives `22023` with that message.
- **Notes:** sets `tenants.staff_contact_instructions`, the plain text every brand's staff app shows on the refusal screen and with the texts before pairing, and returns what was stored: line breaks made `\n`, the ends trimmed, and a blank text or `null` stored as `null`, which clears it so the app shows its own fallback. A link is a URL scheme with `//`, a `www.` host, a host name with a path (`zalo.me/…`) or a host name ending in a common top-level domain (`example.vn`); phone numbers, e-mail addresses, times and abbreviations such as `TP.HCM` are accepted, and no other personal-data check is made. A check constraint on the column repeats the rules, and `authenticated` cannot update the column directly. Members read it with the rest of `tenants`. The tenant's profile stamps record who changed it. `zalo-session` answers it as `contact` (section 5).

### 3.13 Checklists and operations photos (phase 14b)

Migration `checklists` (#219) adds eight functions a client may call. The checklist editor (`save_checklist_template`, `set_checklist_template_active`) and `set_ops_photo_retention_days` are `security invoker` wrappers of the `app` function of the same name, which is `security definer` with an empty `search_path` and checks the caller's role itself; no client writes `checklist_templates` or `checklist_items` directly. The run functions run as the caller, so the operations policies of [section 4](#operations-phase-14b) and the triggers of the tables apply to them as to a direct write. Photos go to the Storage API, not through a function: a run's photos are uploaded into its `photo_bucket` under its `photo_prefix` (`<tenant>/<store>/run/<run id>/`) with a name of 1 to 64 of `a-z`, `0-9`, `_` and `-` ending in `.jpg`; the bucket is `ops-<brand key>` of the brand that covers the store, private, at most 1 MiB per object and `image/jpeg` only. Only the run's actor uploads, only while the run is open; the store's owners and managers and the actor read; nobody updates or deletes through the API. A store that no brand covers has no bucket, so its photo items cannot be completed. The housekeeping job removes photos older than the tenant's `ops_photo_retention_days` through the Storage API (`app.expired_ops_photos`, then `app.mark_removed_ops_photos`, both for the service role) and the answers keep `photo_path` with `photo_removed_at`. No client calls these functions yet: the checklist editor (#220) and the staff app (#221) will. Tests: pgTAP `51_checklists.sql` and `47_operations_rls.sql`.

#### `public.save_checklist_template`

```sql
public.save_checklist_template(p_tenant_id uuid, p_store_id uuid, p_shift_phase text, p_title text, p_items jsonb, p_template_id uuid DEFAULT NULL::uuid)
returns jsonb
```

- **Status:** built (phase 14b, #219).
- **Who may call:** an owner or a manager of the store, or, for a tenant-wide checklist (`p_store_id` null), an owner or manager with every store; anyone else gets `42501`. A shift phase other than `opening`, `midshift` or `closing`, a title outside 1 to 120 characters, an item list that is not an array of 1 to 60 objects `{"label", "requires_photo", "number_unit"}` (a label of 1 to 200 characters, a boolean, a unit of 1 to 16 characters or null) gives `22023`, and so does a `p_template_id` that is not a checklist of that tenant, store and phase.
- **Notes:** without `p_template_id` it creates a checklist at version 1; with it, it saves the next version: the title and a new set of items in the given order. Every save is a new version, so a run already started keeps its wording and the next run reads the new one without a redeploy. Returns `{"template_id", "version", "active"}`. The store and phase of a checklist never change: copy it to another store by saving it there without `p_template_id`.

#### `public.set_checklist_template_active`

```sql
public.set_checklist_template_active(p_template_id uuid, p_active boolean)
returns boolean
```

- **Status:** built (phase 14b, #219).
- **Who may call:** as `save_checklist_template`, for the checklist's store; anyone else, or an unknown id, gets `42501`; a null `p_active` gives `22023`.
- **Notes:** retires (`false`) or reactivates (`true`) a checklist without a new version and returns the state. A retired checklist starts no run and is not due; a run already open still finishes.

#### `public.due_checklists`

```sql
public.due_checklists(p_store_id uuid, p_shift_phase text DEFAULT NULL::text)
returns TABLE(template_id uuid, title text, shift_phase text, template_version integer, every_store boolean, items integer, photo_items integer, business_date date, run_id uuid, run_status text, run_started_by uuid, run_started_at timestamp with time zone, run_finished_at timestamp with time zone)
```

- **Status:** built (phase 14b, #219).
- **Who may call:** any member; the rows are those of a store in the caller's operations scope (owners, managers and staff), none otherwise.
- **Notes:** the active checklists of the store, its own and the tenant-wide ones, for one phase or all (opening, midshift, closing order), with the current version's item and photo-item counts, the store's business date (its time zone and day start) and today's run at the store: an open one first, else the latest. The app chooses the phase from the store's opening hours.

#### `public.start_checklist_run`

```sql
public.start_checklist_run(p_template_id uuid, p_store_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #219).
- **Who may call:** an owner, manager or staff member with the store in scope, for an active checklist of that store or a tenant-wide one; otherwise `42501`. A retired checklist gives `55000`; another member's open run of the same checklist at the store today gives `23505`.
- **Notes:** starts a run as the caller, or returns the caller's open run of that checklist for today. The run takes the template's current version, title and phase, the store's business date and its photo bucket, and starts with one open answer per item. Returns the run as `checklist_run_detail` does.

#### `public.checklist_run_detail`

```sql
public.checklist_run_detail(p_run_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #219).
- **Who may call:** any member; `null` for a run the caller cannot read.
- **Notes:** `{"run_id", "tenant_id", "store_id", "template_id", "template_version", "title", "shift_phase", "business_date", "status", "started_by", "started_at", "finished_at", "photo_bucket", "photo_prefix", "items_total", "items_done", "items": [{"answer_id", "item_id", "position", "label", "requires_photo", "number_unit", "done", "number_value", "photo_path", "photo_removed", "answered_by", "answered_at"}]}`, the items in order with the wording of the run's version.

#### `public.save_checklist_answer`

```sql
public.save_checklist_answer(p_answer_id uuid, p_done boolean, p_number_value numeric DEFAULT NULL::numeric, p_photo_path text DEFAULT NULL::text)
returns jsonb
```

- **Status:** built (phase 14b, #219).
- **Who may call:** the run's actor while the run is open, or an owner or manager of the store at any time; anyone else gets `42501`, and staff get `55000` once the run is finished. A photo path outside `<tenant>/<store>/run/<run id>/<name>.jpg` of this run, not uploaded yet, or at a store without a bucket gives `22023`; `done` without the photo or the number the item asks for, or a number for an item without a unit, gives `23514`.
- **Notes:** replaces done, number and photo path together and stamps `answered_by` and `answered_at`; send the current values of the fields that do not change. A manager's change to a finished run is logged in `checklist_corrections`. Returns `{"answer_id", "run_id", "item_id", "done", "number_value", "photo_path", "photo_removed", "answered_by", "answered_at"}`.

#### `public.finish_checklist_run`

```sql
public.finish_checklist_run(p_run_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #219).
- **Who may call:** the run's actor; another member, a manager included, or a run outside the caller's scope gives `42501`.
- **Notes:** finishes the run and stamps `finished_at`; items left undone stay undone and show in `items_done`. A finished run is returned as it is and is read-only for staff from then on. Returns the run as `checklist_run_detail` does.

#### `public.set_ops_photo_retention_days`

```sql
public.set_ops_photo_retention_days(p_tenant_id uuid, p_days integer)
returns integer
```

- **Status:** built (phase 14b, #219).
- **Who may call:** an owner of the tenant with every store; anyone else gets `42501`. A value outside 7 to 730 gives `22023`.
- **Notes:** sets `tenants.ops_photo_retention_days` (90 by default) and returns it: how long checklist and report photos stay in the brand bucket before the housekeeping job removes them.

### 3.14 Handovers, incidents and stock-outs (phase 14b)

Migration `handovers_and_incidents` (#223) adds eight functions a client may call. `acknowledge_handover`, `acknowledge_incident` and `resolve_incident` are `security invoker` wrappers of the `app` function of the same name, which is `security definer` with an empty `search_path`, checks the caller's role and is the only way to change an acknowledgement or a status; the others run as the caller under the operations policies. Shifts are labelled Ca {n}; a handover stores `n` of its from-shift and to-shift. A report's photos follow the rules of section 3.13 under `<tenant>/<store>/incident/<report id>/`: up to three, uploaded by the reporter while the report is open, after `report_incident` returned its id and prefix. Descriptions, items and notes are free text written by staff; the screens remind them not to write personal details, and no message, alert or log line carries them. No client calls these functions yet: the staff app (#224) and the web log (#225) will. Tests: pgTAP `52_incidents_handover.sql` and `47_operations_rls.sql`.

#### `public.write_handover`

```sql
public.write_handover(p_store_id uuid, p_from_shift integer, p_to_shift integer, p_note text)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** an owner, manager or staff member with the store in scope; anyone else gets `42501`. A shift outside 1 to 12, or a note outside 1 to 2,000 characters or with control characters other than line breaks and tabs, gives `23514`.
- **Notes:** writes a handover note from Ca `p_from_shift` to Ca `p_to_shift` on the store's business date and returns `{"handover_id", "business_date"}`.

#### `public.update_handover`

```sql
public.update_handover(p_handover_id uuid, p_from_shift integer, p_to_shift integer, p_note text)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** the writer, while the handover is unacknowledged (`55000` after); anyone else, a manager included, gets `42501`.
- **Notes:** replaces the labels and the note; checks as `write_handover`.

#### `public.acknowledge_handover`

```sql
public.acknowledge_handover(p_handover_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** an owner or a manager of the store who did not write the handover; the writer, staff, anyone outside the store or an unknown id gets `42501`.
- **Notes:** returns `{"handover_id", "acknowledged_by", "acknowledged_at"}`; a second call keeps the first acknowledgement.

#### `public.report_incident`

```sql
public.report_incident(p_store_id uuid, p_kind text, p_category_key text, p_description text, p_item_label text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** an owner, manager or staff member with the store in scope; anyone else gets `42501`. A kind other than `incident` or `stock_out`, an item for an incident or none for a stock-out (1 to 120 characters), or a description outside 1 to 1,000 characters gives `23514`; a category key that is not an active category of the tenant, or a time more than 7 days back or in the future, gives `22023`.
- **Notes:** reports an incident or a stock-out at `p_occurred_at` (now by default) on that time's business date and returns `{"incident_id", "business_date", "status", "photo_bucket", "photo_prefix"}`; the report starts `open`.

#### `public.update_incident`

```sql
public.update_incident(p_incident_id uuid, p_category_key text, p_description text, p_item_label text, p_photo_paths text[])
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** the reporter, while the report is `open` (`55000` once acknowledged); anyone else, a manager included, gets `42501`.
- **Notes:** replaces the category, description, item and photo list, with the checks of `report_incident`; every photo must be an uploaded object of the report's path, at most three and none twice (`22023`). Returns `{"incident_id", "status", "photo_paths"}`. The kind and time stay.

#### `public.acknowledge_incident`

```sql
public.acknowledge_incident(p_incident_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** an owner or a manager of the store who is not the reporter; the reporter, staff, anyone outside the store or an unknown id gets `42501`.
- **Notes:** marks an open report `seen` with `acknowledged_by` and `acknowledged_at`; a seen or resolved report is returned as it is. Returns `{"incident_id", "status", "acknowledged_by", "acknowledged_at", "resolved_by", "resolved_at"}`.

#### `public.resolve_incident`

```sql
public.resolve_incident(p_incident_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #223).
- **Who may call:** an owner or a manager of the store; anyone else gets `42501`. An open report is acknowledged in the same step, which its reporter may not do (`42501`): another manager marks it seen first, and then the reporter may resolve it.
- **Notes:** marks the report `resolved` with `resolved_by` and `resolved_at`; a resolved report is returned as it is. Returns the same object as `acknowledge_incident`.

#### `public.incident_categories_of`

```sql
public.incident_categories_of(p_tenant_id uuid)
returns TABLE(key text, label text, sort_order smallint, active boolean, tenant_row boolean)
```

- **Status:** built (phase 14b, #223).
- **Who may call:** any member; a caller outside the tenant gets the defaults only.
- **Notes:** the tenant's effective categories in order: the Vietnamese defaults (`thiet_bi` Thiết bị, `ve_sinh` Vệ sinh, `khach_hang` Khách hàng, `nhan_su` Nhân sự, `khac` Khác) and the tenant's own rows, which override a default of the same key or add one (`tenant_row`); retired ones come with `active` false for the labels of older reports. Owners with every store write their rows in `incident_categories` directly (section 4).

### 3.15 Cash count at shift close (phase 14b)

Migration `cash_counts` (#222) adds three functions a client may call and the immediate rule `cash_count_variance` (warning, to the store's managers and the owner). `reopen_cash_count` is a `security invoker` wrapper of the `app` function of the same name, which is `security definer` with an empty `search_path` and checks the caller's role itself; the other two run as the caller. A count is matched to the synced shift of its store whose close is nearest to the count, within the rule's `match_window_minutes` (60 by default), and takes that shift's business date; a count saved before the close is synced waits unmatched (chưa khớp ca) and is matched by the refresh of the sync that brings the close. A matched count is compared with the shift's expected cash (opening float plus cash payments) under the tenant's report settings with the rule of Ca & két tiền (`app.cash_variance_test`): absolute and relative tests strictly greater than their thresholds, and the z-score over the store's drawer variances of the 56 business days before. Over a threshold it opens or repeats the shift's episode, with count-only facts (`shift_number`, `over_abs`, `over_rel`, `over_z`, `shortfall`, `recounts`); within, it clears it. No POS shift name or cashier field is stored, returned or sent. No client calls these functions yet: the staff app (#224) and the web page (#225) will. Tests: pgTAP `53_cash_counts.sql`, `26_notify_schema.sql` and `47_operations_rls.sql`.

#### `public.record_cash_count`

```sql
public.record_cash_count(p_store_id uuid, p_counted_amount numeric, p_denominations jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_replaces_id uuid DEFAULT NULL::uuid)
returns jsonb
```

- **Status:** built (phase 14b, #222).
- **Who may call:** an owner, manager or staff member with the store in scope; anyone else gets `42501`. A negative amount, a breakdown that is not `{"<face value>": <whole count>, …}` with 1 to 30 entries or does not add up to the amount, or a note outside 1 to 500 characters gives `23514`. `p_replaces_id` names the reopened count a recount replaces: anything else gives `22023`, and a second recount of it `23505`.
- **Notes:** records the cash counted at a shift close as the caller, matches and evaluates it at once, and returns `{"cash_count_id", "business_date", "counted_at", "status", "matched"}`, never the expected cash or the difference. A recount keeps the shift of the count it replaces. A fresh count whose nearest shift already has a count stays unmatched: one count per shift unless a manager reopens it.

#### `public.reopen_cash_count`

```sql
public.reopen_cash_count(p_cash_count_id uuid)
returns jsonb
```

- **Status:** built (phase 14b, #222).
- **Who may call:** an owner or a manager of the store; anyone else, or an unknown id, gets `42501`.
- **Notes:** reopens an active count, logged on the row (`reopened_by`, `reopened_at`), so one recount may replace it; the shift's open episode stays until the recount is evaluated. Returns `{"cash_count_id", "status", "shift_id", "reopened_by", "reopened_at"}`; a reopened count is returned as it is.

#### `public.cash_count_review`

```sql
public.cash_count_review(store_ids uuid[], from_date date, to_date date)
returns TABLE(store_id uuid, business_date date, shift_id uuid, shift_number integer, opened_at timestamp with time zone, closed_at timestamp with time zone, cash_count_id uuid, counted_amount numeric, counted_by uuid, counted_at timestamp with time zone, recounts integer, expected_cash_amount numeric, drawer_amount numeric, cash_sales_amount numeric, variance_amount numeric, drawer_variance_amount numeric, trailing_shifts integer, z_score numeric, over_abs_threshold boolean, over_rel_threshold boolean, over_z_threshold boolean, reasons text[], state text)
```

- **Status:** built (phase 14b, #222).
- **Who may call:** any member, with the rules of the report functions: at most 50 stores and 92 days (`22023`), at most 900 rows. RLS shapes the result: the shifts come from `agg_shift_cash`, so staff see them only when their tenant's `staff_revenue_visibility` is `all`; the counts come from `cash_counts`, so staff without it see only their own counts, and viewers see the shifts without counts.
- **Notes:** one row per synced shift of the stores and dates (`shift_number` is Ca {n} by opening order within the business day) with its active count, plus every count not matched yet; `variance_amount` is counted minus expected, `drawer_variance_amount` the POS drawer's own variance as in Ca & két tiền, `recounts` the reopenings before the active count. `state` is `no_count` (a shift without a count; Chất lượng dữ liệu flags a closed one), `unmatched` (chưa khớp ca), `recorded` (matched, but the caller may not read the shift's figures or they are not refreshed yet: the staff app shows Đã ghi nhận), `no_reference` (the POS gave no expected cash), `over` or `within`.

### 3.16 Announcements and Đã đọc (phase 15)

Migration `announcements_and_requests` (#227) adds six functions a client may call. `publish_announcement`, `set_announcement_pin` and `mark_announcement_read` are `security invoker` wrappers of the `app` function of the same name, which is `security definer` with an empty `search_path` and checks the caller's role itself; no client writes `announcements`, `announcement_recipients` or `announcement_receipts` directly. The three readers run as the caller under the operations policies of [section 4](#notices-and-requests-phase-15). An announcement names its stores (`null` for every store of the tenant) and its audience among `owner`, `manager` and `staff`; it is read by the members of an audience role whose operations scope meets its stores, and by every owner and manager of those stores whatever the audience. Its recipients are fixed when it is published (every member of an audience role whose scope meets the stores, the author left out), so the read rate keeps its denominator when people join or leave. Publishing queues one `announcement` message per destination of each recipient who holds the `notifications` consent, through `app.enqueue_message`: template `announcement.v1`, count-only parameters (`announcement_id`, `pinned`, `all_stores`, `store_count`) and no title or body, so the message only says that something new waits in the app; the dispatcher of step 12c sends it, and #231 will choose one route per person instead of every destination. Titles and bodies are plain text, never copied into a message, an alert or a log. No client calls these functions yet: the staff app and the web page (#228) will. Tests: pgTAP `55_announcements_requests.sql` and `47_operations_rls.sql`.

#### `public.publish_announcement`

```sql
public.publish_announcement(p_tenant_id uuid, p_title text, p_body text, p_store_ids uuid[] DEFAULT NULL::uuid[], p_audience tenant_role[] DEFAULT ARRAY['manager'::tenant_role, 'staff'::tenant_role], p_pinned_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb
```

- **Status:** built (phase 15, #227).
- **Who may call:** an owner or a manager whose scope holds every store of `p_store_ids`; for every store (`null`), an owner or manager with an unlimited scope. Anyone else, a store of another tenant included, gets `42501`. A store list that is empty, longer than 50 or names a store twice, a title outside 1 to 120 characters, a body outside 1 to 4,000 characters or with control characters other than line breaks and tabs, an audience outside `owner`, `manager` and `staff`, a pin that does not end within the next 365 days, an expiry not within the next 730 days, or a pin past the expiry gives `22023`.
- **Notes:** publishes now and returns `{"announcement_id", "published_at", "recipients", "messages"}`: the number of fixed recipients and of messages queued. The audience defaults to managers and staff. A link-like text in the body is stored as text; the screens show it as text.

#### `public.set_announcement_pin`

```sql
public.set_announcement_pin(p_announcement_id uuid, p_pinned_until timestamp with time zone)
returns jsonb
```

- **Status:** built (phase 15, #227).
- **Who may call:** an owner or a manager whose scope holds every store of the announcement (an unlimited scope for an every-store one); anyone else, or an unknown id, gets `42501`. A pin that does not end within the next 365 days, or ends after the announcement expires, gives `22023`.
- **Notes:** pins the announcement until `p_pinned_until`, or unpins it with `null`; nothing else of a published announcement changes, and no message is sent. Returns `{"announcement_id", "pinned_until", "pinned"}`.

#### `public.announcement_feed`

```sql
public.announcement_feed(p_store_id uuid DEFAULT NULL::uuid, p_include_expired boolean DEFAULT false)
returns TABLE(announcement_id uuid, tenant_id uuid, store_ids uuid[], audience tenant_role[], title text, body text, pinned boolean, pinned_until timestamp with time zone, published_by uuid, published_at timestamp with time zone, expires_at timestamp with time zone, recipient boolean, read_at timestamp with time zone)
```

- **Status:** built (phase 15, #227).
- **Who may call:** any member; the rows are the announcements the caller may read, none for a viewer, the publisher or `anon`.
- **Notes:** the Thông báo list: for one store (its own and the every-store announcements) or all, pinned ones first while their pin lasts, then the newest; expired ones only with `p_include_expired`. `recipient` says whether the caller was among the fixed recipients and `read_at` is the caller's own Đã đọc time (`null` while unread). At most 200 rows. The staff home shows the rows with `pinned`.

#### `public.mark_announcement_read`

```sql
public.mark_announcement_read(p_announcement_id uuid)
returns jsonb
```

- **Status:** built (phase 15, #227).
- **Who may call:** a member who may read the announcement, for themselves only; anyone else, or an unknown id, gets `42501`.
- **Notes:** Đã đọc: records the caller's receipt once; a second tap keeps the first time. Returns `{"announcement_id", "read_at", "recipient"}`; `recipient` is `false` for a member who joined after publication, whose receipt is kept but not counted in the read rate.

#### `public.announcement_read_rate`

```sql
public.announcement_read_rate(p_announcement_id uuid)
returns TABLE(announcement_id uuid, published_at timestamp with time zone, recipients integer, readers integer, readers_within_24h integer, read_rate numeric, read_rate_24h numeric)
```

- **Status:** built (phase 15, #227).
- **Who may call:** an owner or a manager who may read the announcement; staff, members of another tenant and an unknown id get `42501`.
- **Notes:** one row: the fixed recipients the caller may read, how many of them tapped Đã đọc, how many within 24 hours of publication, and both shares (4 decimals, `null` without recipients). An owner or manager reads the recipients whose stores meet their scope, so a store-limited manager gets the rate of their own staff; the owner with every store gets the rate of the 80 % acceptance.

#### `public.announcement_readers`

```sql
public.announcement_readers(p_announcement_id uuid)
returns TABLE(user_id uuid, display_name text, role tenant_role, store_ids uuid[], member boolean, read_at timestamp with time zone)
```

- **Status:** built (phase 15, #227).
- **Who may call:** as `announcement_read_rate`.
- **Notes:** the recipients the caller may read, the unread first: the name from the staff roster or the Zalo identity where the caller may read one, the role and stores at publication, whether the person is still a member, and the read time. A store-limited manager sees only the recipients of their own stores.

Migration `announcement_feed_pages` adds two readers for the web page, which no longer asks for every tenant at once or one read rate per announcement. Both run as the caller under the same policies. `announcement_feed`, `announcement_read_rate` and `announcement_readers` keep their signatures for the staff app. Tests: pgTAP `117_announcement_feed_pages.sql`.

#### `public.announcement_feed_page`

```sql
public.announcement_feed_page(p_tenant_id uuid, p_store_id uuid DEFAULT NULL::uuid, p_include_expired boolean DEFAULT false, p_after_pinned boolean DEFAULT NULL::boolean, p_after_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
returns TABLE(announcement_id uuid, tenant_id uuid, store_ids uuid[], audience tenant_role[], title text, body text, pinned boolean, pinned_until timestamp with time zone, published_by uuid, published_at timestamp with time zone, expires_at timestamp with time zone, recipient boolean, read_at timestamp with time zone)
```

- **Status:** built (migration `announcement_feed_pages`); called by the web Thông báo page (`apps/web/src/operations/supabase-announcements-source.ts`).
- **Who may call:** any member; the rows are those of `announcement_feed`, of `p_tenant_id` only, so a member of two tenants gets the asked one. A caller outside the tenant gets none. A missing tenant, a page size outside 1 to 200, or a cursor that does not name all three keys gives `22023`.
- **Notes:** the rows and order of `announcement_feed`: pinned ones first while their pin lasts, then the newest, then by `announcement_id`. Keyset paging: the next page passes the `pinned`, `published_at` and `announcement_id` of the last row as `p_after_pinned`, `p_after_published_at` and `p_after_id`. A page shorter than `p_limit` is the last. The pin is read at each call, so a pin that ends between two calls can move a row across the cursor. The web reads pages of 200, up to 2,000 rows a tenant, with the expired ones, and filters the stores of the page itself.

#### `public.announcement_read_counts`

```sql
public.announcement_read_counts(p_announcement_ids uuid[])
returns TABLE(announcement_id uuid, published_at timestamp with time zone, recipients integer, readers integer, readers_within_24h integer, read_rate numeric, read_rate_24h numeric)
```

- **Status:** built (migration `announcement_feed_pages`); called by the web Thông báo page.
- **Who may call:** any member. A list missing or longer than 200 ids gives `22023`.
- **Notes:** `announcement_read_rate` for up to 200 announcements in one call. It gives one row per listed announcement the caller may read as an owner or manager of its tenant, with the same counts over the recipients the caller may read. An id the caller may not have the rate of (staff, another tenant, an unknown id) is left out, not refused. The web collects the rates its list asks for in the same tick into one call.

### 3.17 Staff requests and the approval queue (phase 15)

Migration `announcements_and_requests` (#227) adds five functions a client may call. `decide_request` is a `security invoker` wrapper of `app.decide_request`, which is `security definer` with an empty `search_path`, checks the caller's role and is the only way to change a request's status; the others run as the caller under the operations policies. A request belongs to a store, has a kind and plain-text details, and stays `pending` until an owner or manager of the store who is not the requester approves or refuses it (with a reason); a decided request never changes. Staff read their own requests only; owners and managers read those of the stores in their scope. Kinds are the Vietnamese defaults `mua_hang` Mua hàng cho cửa hàng, `chenh_lech_tien` Giải trình chênh lệch tiền, `ngoai_le_checklist` Ngoại lệ checklist and `khac` Khác, overridable per tenant; leave and shift swaps stay with the POS vendor's HR product. Submitting sends no message: managers see the request in their queue. A decision queues one `request_decided` message per destination of the requester who holds the `notifications` consent: template `request_decided.v1`, parameters `request_id`, `decision` and `kind_key`, never the details or the reason. No client calls these functions yet: the staff app (#229) will. Tests: pgTAP `55_announcements_requests.sql` and `47_operations_rls.sql`.

#### `public.submit_request`

```sql
public.submit_request(p_store_id uuid, p_kind_key text, p_details text)
returns jsonb
```

- **Status:** built (phase 15, #227).
- **Who may call:** an owner, manager or staff member with the store in scope; anyone else gets `42501`. A kind that is not an active kind of the tenant gives `22023`; details outside 1 to 1,000 characters, or with control characters other than line breaks and tabs, give `23514`.
- **Notes:** Gửi yêu cầu: returns `{"request_id", "status", "created_at"}` with the status `pending`.

#### `public.approval_request_kinds_of`

```sql
public.approval_request_kinds_of(p_tenant_id uuid)
returns TABLE(key text, label text, sort_order smallint, active boolean, tenant_row boolean)
```

- **Status:** built (phase 15, #227).
- **Who may call:** any member; a caller outside the tenant gets the defaults only.
- **Notes:** the tenant's effective kinds in order: the defaults and the tenant's own rows, which override a default of the same key or add one (`tenant_row`); retired ones come with `active` false for the labels of older requests. Owners with every store write their rows in `approval_request_kinds` directly (section 4).

#### `public.approval_queue`

```sql
public.approval_queue(p_store_id uuid DEFAULT NULL::uuid)
returns TABLE(request_id uuid, tenant_id uuid, store_id uuid, kind_key text, kind_label text, details text, requested_by uuid, requester_name text, requested_at timestamp with time zone)
```

- **Status:** built (phase 15, #227).
- **Who may call:** any member; rows only for the stores the caller manages (owners and managers), none for staff.
- **Notes:** the manager's queue: the pending requests of one store or of every store the caller manages, oldest first, without the caller's own requests, which another manager decides. `requester_name` comes from the roster or the Zalo identity where the caller may read one. The home card counts the rows. At most 500.

#### `public.decide_request`

```sql
public.decide_request(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
returns jsonb
```

- **Status:** built (phase 15, #227).
- **Who may call:** an owner or a manager of the request's store who is not its requester; the requester, staff, anyone outside the store or an unknown id gets `42501`. A decision other than `approved` or `refused`, a refusal without a reason of 1 to 500 characters, or an approval with a reason gives `22023`; a request already decided gives `55000`.
- **Notes:** returns `{"request_id", "status", "decided_by", "decided_at", "refusal_reason", "messages"}`, `messages` being the number of messages queued to the requester.

#### `public.my_requests`

```sql
public.my_requests()
returns TABLE(request_id uuid, tenant_id uuid, store_id uuid, kind_key text, kind_label text, details text, status text, requested_at timestamp with time zone, decided_by uuid, decided_at timestamp with time zone, refusal_reason text)
```

- **Status:** built (phase 15, #227).
- **Who may call:** any member; the caller's own requests only.
- **Notes:** Yêu cầu của tôi: newest first, with the status, the decision time and the reason of a refusal. At most 200.

### 3.18 Staff alert rules and activity monitors (phase 15)

Migration `staff_alert_rules` (#230) adds no function for members. It adds seven catalogue rules (26 in all): `staff_sync_stale` (staff and managers of the store, 6-hour cool-down; it opens while an owner-facing `sync_stale` or `sync_failed` episode of the store, or an `auth_failed` episode of its POS account, is open, and carries no fact at all), `abnormal_voids` (owners and managers; a closed shift of today or yesterday whose void or removed-line rate scores above `z_threshold`, 2 by default, against the store's shifts of the 56 days before, as `shift_adjustments` computes it, with at least `min_events` voids or removed lines), `voucher_spike` (owners and managers; the invoices with a voucher on a day at or above `min_vouchers` and above `ratio` times the same weekday's mean count or share over `weeks` weeks), `checklist_unfinished` (staff and managers of the store; a checklist with no finished run `grace_minutes` after its shift phase ends: opening at the store's first opening, midshift halfway through the day, closing at its last close, so a store without opening hours is not checked), `staff_daily_digest` (staff only; the daily digest in the staff form), `oa_inactive` (owners; from `warn_after_days`, 150 by default, without an OA message to a follower, with a reminder every 7 days) and `mini_app_visits_low` (owners; fewer than `min_visits`, 10 by default, projected over the month from `min_days` into it). Facts are count-only and never hold an amount, a title, a name or a voucher code. `app.evaluate_staff_rules(p_at, p_tenant_id, p_source)` evaluates them all for the postgres connection of the incremental sync (`p_source` `incremental`) and of the nightly job (`nightly`); neither calls it yet. `app.due_staff_digests` and `app.enqueue_staff_digest_message` give the digest builder the staff scopes, built as a staff member so that RLS keeps the figures to the tenant's `staff_revenue_visibility`; the daily digest can never take staff among its roles (`22023`). Visits are counted per Mini App and month in `mini_app_visits` by `public.zalo_session_visit(p_zalo_app_id, p_kind)`, which only the service role may execute, for `zalo-session`; it is not listed above because no member may call it. Migration `job_event_and_package_brand` lets `app.record_job_event` take the workflow key `zalo_tokens` and adds the brand key (`brand`, such as `brand-1`) to the facts of `oa_package_expiring`. Tests: pgTAP `56_staff_rules.sql`, `26_notify_schema.sql` and `31_notify_access.sql`.

### 3.19 Loyalty (phases 16 and 17)

Migrations `loyalty_programmes` (#239), `coupon_rails` (#242, schema only), `loyalty_ledger` (#247), `loyalty_earn` (#248), `loyalty_matching` (#249) and `loyalty_jobs` (#250) add three functions a client may call. Everything else in the loyalty engine is an `app` function for the service role and the jobs ([schema.md](schema.md#loyalty-functions-phase-17), "Loyalty functions"): the earn, confirm, clawback and expiry functions, the reconciliation `app.reconcile_loyalty`, the customer-facing helpers `app.loyalty_join`, `app.loyalty_issue_checkin_code` and `app.loyalty_submit_claim` that a later customer function will wrap, the staff helper `app.loyalty_record_checkin`, the fast-lane requests and the nightly step. Owners and managers with an unlimited scope write `loyalty_programmes`, `coupon_rails`, `coupon_rail_rewards` and `coupons` directly, and owners and managers write `loyalty_staff_phones` ([section 4](#loyalty-phases-16-and-17)). A customer session (a JWT whose `app_metadata` holds `kind` `customer`, `tenant_id` and `customer_id`, the customer belonging to that tenant, signed in as that customer's own login of an active Zalo App and with no `tenant_members` row, since migration `customer_claims_bound_to_login`) reads only its own loyalty rows. No client calls these functions yet. Tests: pgTAP `60_loyalty_programmes.sql` to `65_loyalty_jobs.sql`.

#### `public.loyalty_balance`

```sql
public.loyalty_balance(p_membership_id uuid)
returns TABLE(membership_id uuid, programme_id uuid, stamps integer, points integer, pending_stamps integer, pending_points integer, stamps_per_card smallint, cards_completed integer, stamps_on_card integer, next_stamp_expiry timestamp with time zone, points_value_amount numeric)
```

- **Status:** built (phase 17a, #247).
- **Who may call:** anyone signed in; `security invoker`, so the row comes back only for a membership the caller reads: a customer session its own memberships, owners, managers and viewers every membership of their tenants. Staff, the publisher and anyone else get no row.
- **Notes:** the balance is computed from `loyalty_ledger`, never stored. `stamps` and `points` are spendable: confirmed earns, adjustments (the welcome stamps), redemption holds and redemptions, clawbacks and expiries; they may be negative after a clawback of a redeemed earn. `pending_stamps` and `pending_points` are earns waiting for their confirm row. `cards_completed` and `stamps_on_card` divide the spendable stamps by the programme's `stamps_per_card`; `next_stamp_expiry` is the earliest expiry of an active stamp; `points_value_amount` is the points times the programme's `point_value_amount`. Pending check-ins and receipt claims (paths B and C, shown as waiting for confirmation) are rows of `pending_checkins` and `receipt_claims` the session reads directly.

#### `public.loyalty_rail_flags`

```sql
public.loyalty_rail_flags(p_store_ids uuid[])
returns TABLE(store_id uuid, rail coupon_rail, active_from timestamp with time zone, e_invoice_status e_invoice_status, flagged boolean)
```

- **Status:** built (phase 16b, #242); the data-quality page does not show it yet.
- **Who may call:** anyone signed in; `security invoker`, so only the stores whose rails the caller reads (data roles, stores in scope).
- **Notes:** the active rail of each given store that has one, with the store's `e_invoice_status`; `flagged` is true when the store does not issue cash-register e-invoices (`e_invoice_status` other than `configured`), the FR-CMP-10 flag for Chất lượng dữ liệu.

#### `public.resolve_loyalty_queue_item`

```sql
public.resolve_loyalty_queue_item(p_item_id uuid, p_choice uuid, p_reason text)
returns jsonb
```

- **Status:** built (phase 17a, #249); the queue page is #253.
- **Who may call:** an owner or a manager whose scope holds the item's store; anyone else, or an unknown item, gets `42501`. A closed item, a reason outside 1 to 200 characters or with a control character, or a `p_choice` that is not one of the item's `candidate_invoice_ids` gives `22023`.
- **Notes:** `p_choice` earns the chosen invoice for the member on the item's path (`B` or `C`) with the caller as `approved_by`, the anti-fraud rules applied as for any earn, and closes the check-in or claim as `matched` (or `rejected` with the refusal reason); `null` dismisses the item and rejects the check-in or claim with reason `dismissed`. Returns `{"state", "entry_id", "refusal"}`.

### 3.20 Customer Mini App: session, join, wallet and claims (phase 18a)

Migrations `customer_session` (#261) and `customer_wallet` (#264) add the functions of the customer Mini App; `customer_app_answers` refuses a join without an open programme as an answer, names the programme's status on the home and reads a released reward hold as reversed in the wallet; `customer_deletion_request_state` adds the deletion request to the wallet and the deadlines to its answer, and `store_receipt_numbers_reset` gives each store of the home its receipt numbering. The wire shapes are those of `packages/zalo-mini/src/loyalty/contract.ts` and [apps/zalo-customer/README.md](../apps/zalo-customer/README.md#the-loyalty-contract).

**The customer session.** The customer branch of `zalo-session` (section 5) calls two RPCs that only `service_role` may execute, so they are not part of this page's check:
- `zalo_customer_sign_in(p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text default null, p_new_user_id uuid default null)` answers the customer login of a Zalo user of an active Zalo App. With no login it answers `{"status": "login_needed"}`. The function then creates a login with `app_metadata` `{"kind": "customer", "tenant_id", "customer_id": null}` and calls again with its id. That login must have no `tenant_members` row, no staff Zalo identity and no other customer login (`22023` otherwise), and the first binding wins a race. The answer is `{"status": "customer", "user_id", "tenant_id", "customer_id", "display_name"}`: `customer_id` is null until the customer has joined, and `display_name` is the customer's name, else the Zalo name.
- `customer_join(p_user_id uuid, p_zalo_app_id uuid, p_zalo_user_id text, p_display_name text, p_phone text, p_loyalty_consent boolean, p_marketing_consent boolean, p_policy_version text, p_screen_version text, p_shown_at timestamp with time zone, p_store_code text, p_channel text)` takes the phone that `zalo-phone`'s exchange decoded.
  - **Refusals:** `{"status": "refused", "reason"}` with `consent_required` (no loyalty consent), `policy_outdated` (not a published `privacy_notice` version of the tenant), `unknown_store` (not a link key of the app's brand), `no_programme` (no active programme covers the tenant's today: none, paused, ended, or a period not started or over) or `phone_in_use` (another Zalo user of the brand joined with that phone). A refusal writes nothing; `zalo-session` answers `no_programme` with 409.
  - **On success:**
    - It finds or creates the customer by its E.164 phone (`loyalty_normalize_phone`), keeping the Zalo name only when the customer has none.
    - It enrols the customer in the active programme through `app.loyalty_join`, with the welcome stamps; a staff phone gets none.
    - It records the `loyalty` consent and, only when its toggle was ticked, the `marketing` consent. Each record has the channel `mini_app` and the evidence `{"screen_version", "shown_at", "accepted_at", "channel", "zalo_app_id", "store_id", "toggle", "ticked"}`, and the loyalty record also holds `"marketing_ticked"`.
    - It answers `{"status": "joined", "customer_id", "membership_id", "welcome_stamps", "already_member"}`.
  - **Bad input:** a malformed phone, version or time, a login of another Zalo user, or a channel other than `mini_app` gives `22023`.
- The login rows live in `app.customer_logins` ([schema.md](schema.md)), which no API role reads. `zalo-session` then sets `app_metadata` `{"kind": "customer", "tenant_id", "customer_id"}`: exactly the claims `app.current_customer_id()` reads for RLS.

**Who may call the six RPCs below.**
- They are `security definer` functions that take no time argument, executable by `authenticated` only.
- Each checks for a customer session itself: a JWT whose `app_metadata.kind` is `customer` and whose `tenant_id` is the tenant of a login of `app.customer_logins` of an active Zalo App, with no `tenant_members` row.
- Every other caller gets `42501`, staff and owners included.
- `customer_home` also answers a visitor, whose `customer_id` is null. The other five need a joined customer whose `app_metadata.customer_id` is the login's customer, and answer a visitor with `42501`, which the app reads as "not a member".
- A store is named by its link key: `stores.code`, else `external_id`, 1 to 64 of `A-Z a-z 0-9 . _ -`, compared exactly, among the active stores of the app's brand.

#### `public.customer_home`

```sql
public.customer_home()
returns jsonb
```

- **Status:** built (phase 18a, #261, #262); called by `apps/zalo-customer`.
- **Who may call:** any customer session, joined or not (browse first, FR-LOY-17).
- **Notes:**
  - `{"programme", "oa_id", "legal", "stores", "menu"}`.
  - The programme is the tenant's active one, else the latest that is not a draft, or null when the tenant has none. It gives the facts of `loyalty_programmes`: `name`, `status` (`active`, `paused` or `ended` as stored, so a paused programme does not look open; the app also checks the period), `starts_on`, `ends_on`, `stamps_per_card`, `welcome_stamps`, `stamp_validity_months`, `points_enabled`, `points_expiry_months`, `receipt_claims_per_day` and `receipt_claim_window_hours`.
  - `reward_summary` lists the active rewards, else it is null. `summary`, `stamp_rule`, `points_rule` and `retention_months` are null, so the app words them, and `tiers` is empty: the programme holds none of these yet.
  - `oa_id` is the brand's OA id.
  - `legal` is `{"entity_name"`: the tenant's name, `"policy_version"`: the published Vietnamese privacy notice version, `"documents"}`: the published `privacy_notice` and `mini_app_terms` in every language.
  - `stores` are the brand's active stores with their link key, name, address and opening hours; the address and hours are null when unknown.
  - Each store also has `receipt_numbers_reset`: `daily`, `yearly`, `never` or `unknown`. It is the owner's `stores.tran_no_reset_period` when set, else what the POS reports in `stores.receipt_numbers_reset`. For `daily` the claim form warns, without blocking, when a receipt number does not start with the chosen date's day of month.
  - `menu` is empty until the highlights have a source. No amount or price is ever returned.

#### `public.customer_wallet`

```sql
public.customer_wallet()
returns jsonb
```

- **Status:** built (phase 18a, #264); called by `apps/zalo-customer`.
- **Who may call:** a joined customer session.
- **Notes:** the wallet from the ledger, as of the call.
  - `card`: the FR-CMP-19 content: `programme_name`, `display_name`, `phone_masked` (`•••• ••• ` and the last three digits), `member_since` and `purchases`, the confirmed earns not reversed.
  - `stamp_cards`: one card from `loyalty_balance`: `stamps_on_card`, `stamps_per_card`, `pending_stamps` and the day of `next_stamp_expiry`.
  - `points`: the spendable `balance`, `pending` and `expiring`, the points that expire on the next expiry day, oldest first.
  - `tier` is null.
  - `marketing_consent`: whether the active `marketing` consent exists.
  - `history`: the latest 100 ledger rows other than confirm rows.
    - `kind` is `welcome`, `earn`, `redeem`, `adjust`, `expire` or `reversal`.
    - `state` is `pending` (an earn or a reward hold without its confirm), `confirmed` (a reward hold once the synced invoice confirmed it: Đã dùng), or `reversed` (an earn a clawback points at, or a reward hold that the `redemption_released` adjustment gave back: Đã hoàn lại).
    - Each row also has the ledger `reason`, `store_name`, the invoice's `receipt_no` and `matched_path`: `phone`, `member_code`, `receipt_claim`, `voucher`, `welcome` or `manual`, and null for a redeem row and for the `redemption_released` adjustment, which the app words "Hoàn lại quà chưa dùng".
  - `claims`: the latest 50 receipt claims with `state` and `reason` as `receipt_claims` stores them.
  - `claims_today` (every submission of the business day, refused ones included) and `claims_per_day`.
  - `deletion_request`: the customer's deletion request as `customer_request_deletion` answers it. It is the open one (`received` or `in_progress`), else the latest whatever its status (a `rejected` one, so the app can offer a new request), else null. The app reads it after a restart.

#### `public.customer_member_code`

```sql
public.customer_member_code(p_store text)
returns jsonb
```

- **Status:** built (phase 18a, #264, with the issuer of #255); called by `apps/zalo-customer`.
- **Who may call:** a joined customer session whose membership is active (`42501` otherwise). A link key the app does not offer, or a programme that is not active, gives `22023`.
- **Notes:**
  - It returns `{"code", "qr_payload", "store_code", "store_name", "issued_at", "refresh_at", "expires_at"}`.
  - `code` is a 6-digit check-in code from `app.loyalty_issue_checkin_code`, bound to the store and valid for the programme's `checkin_code_ttl_seconds` (120 by default). `refresh_at` is 60 seconds after issue, and `qr_payload` is `fnb-member:1:<link key>:<code>`.
  - A new code replaces the member's previous live code at the store; a call within 30 seconds of the last code answers that code again.
  - The code is a random server-side token checked at the till against `pending_checkins`, not a signed token.

#### `public.customer_submit_claim`

```sql
public.customer_submit_claim(p_store text, p_receipt_no text, p_amount numeric, p_business_date date DEFAULT NULL::date)
returns jsonb
```

- **Status:** built (phase 18a, #264); called by `apps/zalo-customer`.
- **Who may call:** a joined customer session.
- **Bad input:** a link key the app does not offer, a receipt number outside 1 to 40 characters or with a space or control character, or an amount not above 0 or above 100,000,000 gives `22023`.
- **Notes:**
  - "Nhận điểm từ hóa đơn" through `app.loyalty_submit_claim`; the business date defaults to the store's today.
  - It returns `{"claim_id", "state", "reason", "claims_left_today"}`, with `state` `pending`, `matched`, `queued`, `rejected` or `expired` as stored.
  - A synced receipt is matched at once. Otherwise the claim waits and a fast-lane run is requested; that is a row in `app.loyalty_fast_lane_runs` only, never a POS call, which only `fnb loyalty fast-lane` with `LOYALTY_FAST_LANE=on` runs.
  - Refusals are answers, not errors, with the ledger's reason. Among them is `daily_cap`: the programme's `receipt_claims_per_phone_per_day` (3) submissions in a business day, refused ones counted.

#### `public.customer_stop_marketing`

```sql
public.customer_stop_marketing()
returns jsonb
```

- **Status:** built (phase 18a, #261); called by `apps/zalo-customer`.
- **Who may call:** a joined customer session.
- **Notes:** "Dừng nhận tin": sets `revoked_at` on the customer's active `marketing` consent at once (none to revoke is not an error) and answers `{"marketing_consent": false, "stopped_at"}`. The loyalty consent stays. No promotional message passes the consent check afterwards.

#### `public.customer_request_deletion`

```sql
public.customer_request_deletion()
returns jsonb
```

- **Status:** built (phase 18a, #263); called by `apps/zalo-customer`.
- **Who may call:** a joined customer session.
- **Notes:** records a `data_subject_requests` row: subject `customer`, type `deletion`, contact `mini_app`, deadlines filled by the ledger's trigger. It answers `{"request_id", "status", "requested_at", "first_response_due_at", "completion_due_at"}`, the two deadlines as the trigger filled them (2 working days; 20 days, 30 with a processor). An open (`received` or `in_progress`) deletion request of the customer is answered again instead of a second one. An owner carries the deletion out with [`dsr_delete`](#publicdsr_delete).

Tests: pgTAP `66_customer_join.sql`, `67_customer_wallet.sql`, `93_customer_app_answers.sql`, `115_customer_deletion_state.sql` and `116_store_receipt_numbers.sql`.

### 3.21 Staff loyalty tools (phase 17b)

Migration `staff_loyalty` (#255) adds the functions behind "Ghi nhận khách", the member lookup, loyalty requests and the manager queue, with the names and shapes of `apps/zalo-staff/src/loyalty/contract.ts`.
- They are `security definer` functions without a time argument, executable by `authenticated` only.
- Each checks the caller's store itself: an owner, manager or staff member whose scope holds the store, through `app.has_store_scope`. Everyone else, a customer session included, gets `42501`, and nothing outside the caller's store is answered.
- A staff phone never earns. That is a phone on `loyalty_staff_phones`, or the linked phone of an active `staff_roster` row.
- The adjustment threshold is `tenants.loyalty_adjust_max_stamps` (1 by default) and `loyalty_adjust_max_points` (0 by default).
- The redemption check (`staff_verify_redemption`) is in section 3.22.

#### `public.staff_record_checkin`

```sql
public.staff_record_checkin(p_store_id uuid, p_phone text DEFAULT NULL::text, p_code text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric)
returns jsonb
```

- **Status:** built (phase 17b, #255); the screen is #256.
- **Who may call:** an owner, manager or staff member with the store in scope (`42501` otherwise).
- **Bad input:** both or neither of phone and code, a code that is neither 6 digits nor such a payload, or an amount not above 0 or above 100,000,000 gives `22023`.
- **Notes:**
  - "Ghi nhận khách" (path B) takes either a phone or a code.
    - A phone means the member of the tenant's active programme with that phone; a fresh check-in code is issued for it.
    - A code is the customer's live member code, or its QR payload `fnb-member:1:<link key>:<code>`.
  - It records the check-in through `app.loyalty_record_checkin`, with the caller as recorder and the optional bill amount. A synced invoice matches at once; otherwise a fast-lane run is requested (a row only).
  - A recording answers `{"state", "refusal": null, "checkin_id", "recorded_at", "confirm_by", "member", "stamps_earned", "points_earned"}`:
    - `state` is `pending`, `matched` or `queued`.
    - `confirm_by` is 10 minutes after a recording that waits.
    - `member` is `{"membership_id", "phone_masked", "display_name", "stamps", "stamps_per_card", "points"}`, with the spendable balance.
  - A refusal answers `{"state": "refused", "refusal", "text_key": "checkin.refusal.<refusal>", "checkin_id"}`. The refusals are:
    - `invalid_phone`, `not_member` and `staff_phone`;
    - `code_unknown`, `code_expired`, `code_used` and `wrong_store` (the code or the payload belongs to another store);
    - `no_programme`, `membership_inactive` and `already_recorded` (the member was recorded at the store within the programme's check-in window);
    - for a check-in matched at once but refused by the ledger, the earn refusal, with `daily_cap` as `daily_limit`.

#### `public.staff_member_lookup`

```sql
public.staff_member_lookup(p_store_id uuid, p_phone text DEFAULT NULL::text, p_membership_id uuid DEFAULT NULL::uuid)
returns jsonb
```

- **Status:** built (phase 17b, #255); the screen is #257.
- **Who may call:** an owner, manager or staff member with the store in scope (`42501` otherwise). Both or neither of phone and membership give `22023`.
- **Notes:**
  - It answers `{"found": true, "store_name", "business_date", "card", "today", "adjust_limit_stamps", "adjust_limit_points"}`.
  - `card` is `{"membership_id", "phone_masked", "display_name", "member_since", "status", "tier_name"}`, with `tier_name` null, plus the balance from `loyalty_balance`: `stamps` (spendable), `stamps_per_card`, `stamps_on_card`, `cards_completed`, `stamps_pending`, `points` and `points_pending`.
  - `today` lists the check-ins, earns, open receipt claims and manual adjustments of the member at this store on its business day. Each is `{"at", "path", "state", "stamps", "points", "receipt_no"}`, with `path` `phone`, `member_code`, `receipt_claim`, `voucher` or `manual` and `state` `pending`, `confirmed`, `queued` or `rejected`.
  - A phone that does not read, a staff phone, no membership in the active programme or a membership of another tenant answer `{"found": false}`. The lookup never says whether a non-member is a customer and never shows the full phone.

#### `public.staff_request`

```sql
public.staff_request(p_store_id uuid, p_kind text, p_membership_id uuid, p_reason text, p_stamps integer DEFAULT 0, p_points integer DEFAULT 0)
returns jsonb
```

- **Status:** built (phase 17b, #255); the screens are #257 and #258.
- **Who may call:** an owner, manager or staff member with the store in scope (`42501` otherwise).
- **Bad input:** another kind, a membership outside the store's tenant, a reason outside 1 to 200 characters, more than 20 stamps or 100,000 points, an adjustment that moves nothing, or a dispute that takes stamps or points gives `22023`.
- **Notes:**
  - `p_kind` is `adjustment` or `dispute`. It returns `{"request_id", "kind", "state", "entry_id", "requested_at"}`.
  - An adjustment within both thresholds is applied at once: state `applied`, a ledger `adjust` row with the reason and the caller as `approved_by`.
    - Added stamps get `stamps` rows with the programme's validity.
    - Removed stamps close the oldest active ones as `clawed_back`.
    - Added points expire after `points_expiry_months`.
  - A larger adjustment and every dispute stay `pending` for an owner or manager of the store.

#### `public.staff_decide_loyalty_request`

```sql
public.staff_decide_loyalty_request(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL::text, p_stamps integer DEFAULT NULL::integer, p_points integer DEFAULT NULL::integer)
returns jsonb
```

- **Status:** built (phase 17b, #255); the manager queue is #258.
- **Who may call:** an owner or manager of the request's store who is not the requester. Anyone else, or an unknown request, gets `42501`.
- **Bad input:** a decision other than `approved` or `refused`, a refusal without a reason, a reason over 500 characters, amounts beyond 20 stamps or 100,000 points, or an approved dispute that takes gives `22023`. A decided request gives `55000`.
- **Notes:** an approval writes the ledger `adjust` row with the request's reason and the caller as `approved_by`, using `p_stamps` and `p_points` when given (the requested amounts otherwise). It returns `{"state", "refusal": null, "request_id", "entry_id", "decided_at"}`.

#### `public.staff_loyalty_queue`

```sql
public.staff_loyalty_queue(p_store_id uuid DEFAULT NULL::uuid)
returns jsonb
```

- **Status:** built (phase 17b, #255); the manager queue is #258.
- **Who may call:** any signed-in member; only an owner or manager with the store in scope gets items, everyone else an empty list.
- **Notes:**
  - It lists, for one store or all, oldest first and at most 200:
    - the pending disputes and adjustments the caller may decide (never the caller's own);
    - the open match items of `loyalty_queue`.
  - Each item is `{"id", "kind", "store_id", "created_at", "phone_masked", "requested_by_name", "reason", "stamps", "points", "match"}`, with `kind` `adjustment`, `dispute` or `match`; the requester's name comes from the roster, else the Zalo display name.
  - `match` is `{"path", "recorded_at", "amount", "receipt_no", "candidates"}`, where `path` is `member_code` or `receipt_claim` and each candidate is `{"invoice_id", "receipt_no", "sold_at", "amount"}`.
  - A match is resolved with `resolve_loyalty_queue_item` (section 3.19), a request with `staff_decide_loyalty_request`.

#### `public.staff_my_loyalty_requests`

```sql
public.staff_my_loyalty_requests()
returns jsonb
```

- **Status:** built (phase 17b, #255); the screen is #257.
- **Who may call:** any signed-in member; it lists the caller's own requests at stores still in scope.
- **Notes:** newest first, at most 200, each `{"id", "kind", "created_at", "phone_masked", "reason", "stamps", "points", "state", "decided_at", "decision_reason", "store_name"}`.

#### `public.set_loyalty_adjust_limits`

```sql
public.set_loyalty_adjust_limits(p_tenant_id uuid, p_max_stamps integer, p_max_points integer)
returns jsonb
```

- **Status:** built (phase 17b, #255); no screen yet.
- **Who may call:** an owner with every store (`42501` otherwise). Limits outside 0 to 20 stamps or 0 to 100,000 points give `22023`.
- **Notes:** sets `tenants.loyalty_adjust_max_stamps` and `loyalty_adjust_max_points` and answers `{"max_stamps", "max_points"}`.

Tests: pgTAP `68_staff_loyalty.sql`.

### 3.22 Rewards and redemptions (phase 18b)

Migrations `coupon_catalogue` (#269), `redemption_flow` (#271) and `redemption_reconciliation` (#273) complete the reward catalogue and add the redemption lifecycle: a member redeems a reward in the customer Mini App, staff verify the code at the till, the cashier applies it at the POS, and the synced invoice confirms it.
- The customer and staff RPCs are `security definer` functions without a time argument, executable by `authenticated` only, like those of 3.20 and 3.21. The customer ones take the session from `app.customer_session()` (`42501` for a visitor, an unjoined customer and every other caller) and name a store by its customer store code (`22023` for a store the app does not offer).
- The rail of the store decides the code. `pos_payment_discount` (the fallback, without CRM) generates an 8-character code without look-alike characters, and staff are told the POS payment discount entry to apply (Chiết khấu thanh toán). `crm_code_pool` hands out the store's oldest available pool code; `crm_callback` generates a code for the voucher callback (#243) to validate.
- A hold is a pending `redeem` row of the ledger: the stamps and points are held at once. A synced invoice confirms it after every sync (`app.reconcile_loyalty`): the code as the invoice's voucher code on the code rails; on the fallback rail, the discount entry name (or the 0-price line of the free item) on an invoice of the store sold within the programme's check-in window around the staff verification. The nightly step releases a hold unused after `hold_hours` (24 by default) with a reversing ledger row that gives everything back, and quarantines its pool code.
- Rewards are described by kind, percentage and item names; the customer functions never return an amount (FR-LOY-17).
- Refusals are answered, not raised, with a reason key. Customer reasons: `membership_inactive`, `store_unavailable`, `programme_inactive`, `coupon_unavailable`, `rail_not_ready`, `already_held`, `member_limit_reached`, `insufficient_stamps`, `insufficient_points`, `no_code_available`. Staff refusals use the staff app's names and come with `text_key` `redeem.refusal.<refusal>`: `unknown`, `wrong_store`, `used`, `expired`, `released`.
- The redemption mismatches (a code verified at the till without an invoice after `grace_hours`, an invoice carrying a reward discount without a redemption, an invoice discount that differs from the reward) are listed in `loyalty_queue` on path `D` for [`resolve_loyalty_queue_item`](#publicresolve_loyalty_queue_item) to dismiss, and open the store-scoped alert rule `redemption_mismatch` with count-only facts.

Tests: pgTAP `70_coupons.sql`, `71_redemptions.sql`, `72_redemption_reconciliation.sql`, `93_customer_app_answers.sql` (the wallet's reading of a released or confirmed hold) and `94_coupon_guard_cascades.sql` (migration `coupon_guard_cascades`: deleting an approving Auth user sets `coupons.approved_by` null, and deleting a tenant or store cascades past an active reward's mapping, while a direct delete of that mapping is still refused).

#### `public.customer_coupons`

```sql
public.customer_coupons(p_store text DEFAULT NULL::text)
returns TABLE(coupon_id uuid, reward_key text, name text, description text, reward_kind coupon_reward_kind, reward_percent numeric, reward_item_names text[], cost_stamps smallint, cost_points integer, store_codes text[], valid_from date, valid_until date, hold_hours smallint, per_member_limit smallint, redeemed integer, live_redemption_id uuid, affordable boolean, stamps_short integer, points_short integer, available boolean, unavailable_reason text)
```

- **Status:** built (phase 18b, #271); the wallet screens are #272.
- **Who may call:** a joined customer session (`42501` otherwise). A store the app does not offer gives `22023`.
- **Notes:** Đổi quà: the active rewards of the member's programme valid today, at one store (`p_store`) or at every store of the app (`null`). `store_codes` is null for a reward of every store. `affordable` compares the costs with the spendable stamps and points (confirmed, not held, not expired), with `stamps_short` and `points_short` missing. `available` is true when the reward can be redeemed now; otherwise `unavailable_reason` says why: `membership_inactive`, `already_held` (`live_redemption_id` is that hold), `member_limit_reached` (`redeemed` holds and confirmed redemptions against `per_member_limit`), `rail_not_ready` (the store's rail cannot carry it), `insufficient_stamps` or `insufficient_points`. Cheapest first.

#### `public.customer_redeem`

```sql
public.customer_redeem(p_coupon uuid, p_store text)
returns jsonb
```

- **Status:** built (phase 18b, #271); the wallet screens are #272.
- **Who may call:** a joined customer session (`42501` otherwise). A store the app does not offer gives `22023`; a reward that does not exist is refused as `coupon_unavailable` and changes nothing.
- **Notes:** Đổi quà: holds the reward for the member at the store. A hold answers `{"redemption_id", "state": "held", "refusal": null, "code", "qr_payload", "rail", "coupon_id", "store_id", "store_code", "store_name", "held_at", "hold_expires_at", "seconds_left", "stamps_spent", "points_spent", "stamps", "points"}`, `stamps` and `points` being the spendable balance after the hold and `qr_payload` `fnb-redeem:1:<code>` for the staff app to scan. A refusal answers `{"redemption_id": null, "state": null, "refusal", "store_code", "store_name", "stamps", "points"}` with one of the customer reasons above, and changes nothing.

#### `public.customer_vouchers`

```sql
public.customer_vouchers()
returns TABLE(redemption_id uuid, coupon_id uuid, coupon_name text, reward_kind coupon_reward_kind, reward_percent numeric, store_code text, store_name text, code text, qr_payload text, state redemption_state, display_state text, held_at timestamp with time zone, hold_expires_at timestamp with time zone, seconds_left integer, verified boolean, confirmed_at timestamp with time zone, released_at timestamp with time zone, stamps_spent integer, points_spent integer)
```

- **Status:** built (phase 18b, #271); the wallet screens are #272.
- **Who may call:** a joined customer session (`42501` otherwise); the customer's own redemptions only.
- **Notes:** Ví voucher: the held redemptions first, then the others of the last 90 days, newest first, at most 100. `display_state` is `held` (the code and `qr_payload` are given and `seconds_left` counts down), `expired` (the hold ended and the nightly release is pending; no code), `used` (Đã dùng: confirmed by the synced invoice), `returned` (Đã hoàn lại: released with the stamps and points given back) or `cancelled`. `verified` is true once staff checked the code at the till.

#### `public.staff_verify_redemption`

```sql
public.staff_verify_redemption(p_store_id uuid, p_code text)
returns jsonb
```

- **Status:** built (phase 18b, #271); the staff app's Kiểm tra ưu đãi screen (#257) calls it.
- **Who may call:** an owner, manager or staff member whose scope holds `p_store_id`, the store the app has selected; anyone else, a customer session, a viewer and the publisher included, gets `42501`. A code that is not 1 to 64 characters without spaces, or its QR payload `fnb-redeem:1:<code>`, gives `22023`.
- **Notes:** checks a reward code typed or scanned at the till. A held, unexpired redemption of that store is marked verified (the first time) and stays held until the synced invoice confirms it. The answer is `{"state": "verified", "refusal": null, "text_key": "redeem.valid", "first_verification", "redemption_id", "reward_name", "reward_kind", "reward_percent", "rail", "pos_discount_name", "pos_free_item_external_id", "voucher_code", "min_bill_amount", "hold_until", "confirm_by", "verified_at", "phone_masked"}`. On `pos_payment_discount`, `pos_discount_name` is the POS payment discount entry to apply (or the 0-price item's name when the mapping uses a free line) and `confirm_by` the end of the programme's check-in window after the verification, by which the sale should be rung; on the CRM rails, `voucher_code` is the code to type. `min_bill_amount` is null without a minimum. The phone shows its last three digits only.
- **Refusals** are answered, never raised: `{"state": "refused", "refusal", "reason", "text_key", "used_at", "used_store_name", "expired_at"}`.
  - `unknown`: no such code in the tenant.
  - `wrong_store`: the code belongs to another store; nothing more is said.
  - `used`: confirmed by an invoice (`used_at` the confirmation), or already verified by someone else, or by the same person longer ago than the check-in window (15 minutes by default; `reason` `already_verified`, `used_at` the verification), so a code is not applied twice on the fallback rail.
  - `expired`: the hold ended (`expired_at`).
  - `released`: the hold was given back, or cancelled.

#### `public.coupon_discount_days`

```sql
public.coupon_discount_days(p_coupon_id uuid, p_calendar_year integer)
returns TABLE(item_external_id text, item_name text, price_discount_days integer, line_price_discount_days integer, bill_discount_days integer, gift_days integer, voucher_days integer, limit_days integer, over_limit boolean)
```

- **Status:** built (phase 18b, #269); the editor is #270.
- **Who may call:** anyone signed in; `security invoker`, so a reward the caller does not read gives `22023`, as does a year before 2023 or after next year (migration `coupon_discount_days_year`), and the counts follow the caller's revenue access as `item_discount_days` does.
- **Notes:** information only (FR-CMP-12): the discount days of the calendar year of the items the reward discounts (its reward items, or every item but the excluded ones), from [`item_discount_days`](#publicitem_discount_days) over the reward's stores (every active store, at most 50, for a reward of every store). `limit_days` is the dated discount-days limit in force at the year's end or today, whichever is earlier (120 to 25 June 2026, then null while Decree 239/2026 is reported to repeal it); `over_limit` is never true without a limit and never blocks a save.

#### `public.redemption_summary`

```sql
public.redemption_summary(store_ids uuid[], from_date date, to_date date)
returns TABLE(store_id uuid, coupon_id uuid, reward_key text, coupon_name text, reward_kind coupon_reward_kind, redemptions bigint, held bigint, confirmed bigint, released bigint, stamps_redeemed bigint, points_redeemed bigint, reward_cost_amount numeric, member_invoices bigint, confirmed_share numeric)
```

- **Status:** built (phase 18b, #273); the web card is #274.
- **Who may call:** anyone signed in; a report function (`security invoker`), so owners, managers and viewers get the stores in their scope and staff and the publisher no row.
- **Notes:** for Khuyến mãi & giảm giá: per store and reward, the redemptions held on the business days of the range (the store's business date of the hold) with how many are still `held`, `confirmed` and `released`, the stamps and points the confirmed ones spent, `reward_cost_amount` (the payment discount of the confirming invoice on the fallback rail, its voucher amount on the code rails), the store's `member_invoices` of the range (invoices that earned and were not clawed back) and `confirmed_share` of them (null without member invoices). 0 to 50 stores, at most 92 days and 900 rows, else `22023`.

### 3.23 Customer phones and the Khách hàng section (#253, NFR-PRV)

Migrations `customer_phone_privacy`, `loyalty_member_reads` and `loyalty_shift_anomalies` keep a customer's full phone in the database. No API role may select `customers.phone` any more (a column grant: `authenticated` selects every other column of `customers`, the policies are unchanged), so a PostgREST read of that column or an embed `customers(phone)` answers `42501` for everyone, owners included. The web section Khách hàng reads members, balances and shift counts through the functions below instead of raw rows; the phone is masked in the database as the staff and customer apps show it (`•••• ••• 234`, four and three dots and the last three digits), and only an owner's phone lookup answers with the full phone. The service role keeps the whole table. Tests: pgTAP `80_customer_phone_privacy.sql` and `81_loyalty_shift_anomalies.sql`, and the live Playwright spec `loyalty-pages.spec.ts`, which also checks that no Data API answer to a viewer holds a full phone.

**The balance of a store-limited caller.** `loyalty_members_page` and `loyalty_member_lookup` compute the balance as [`loyalty_balance`](#publicloyalty_balance) does (spendable stamps and points; pending ones are earns waiting for their confirm row), over the ledger rows at the stores in the caller's loyalty scope and the rows without a store (welcome stamps given off-store, adjustments made off-store). An owner, or a manager or viewer of every store, gets the member's whole balance. A manager or viewer limited to some stores gets what the member earned, redeemed, was adjusted, clawed back and lost to expiry at those stores, plus the store-less rows: it may be less than the whole balance, as the page's note says. `last_visit` is the latest business date of an earn among the same rows.

#### `public.loyalty_members_page`

```sql
public.loyalty_members_page(p_store_ids uuid[] DEFAULT NULL::uuid[], p_after text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_search text DEFAULT NULL::text)
returns TABLE(membership_id uuid, tenant_id uuid, programme_id uuid, phone_masked text, joined_at timestamp with time zone, status membership_status, channel text, stamps integer, points integer, pending_stamps integer, pending_points integer, last_visit date, page_key text)
```

- **Status:** built (#253); the web's Khách hàng → Thành viên list and the member page call it.
- **Who may call:** owners, managers and viewers (`security definer` with an explicit check through `app.current_user_loyalty_tenant_ids()` and `app.current_user_loyalty_store_ids()`); staff, the publisher, a customer session and a login of no tenant get `42501`.
- **Notes:** the memberships of the tenants of `p_store_ids` (the web passes the tenant's stores in scope; `null` means every store in the caller's loyalty scope, so every tenant where it reads loyalty), newest first by `joined_at` then membership id. Stores outside the caller's scope are ignored, so a store of another tenant gives no row. Membership is tenant-wide: a store-limited manager lists every member of the tenant, and its balances are scoped as above. Keyset paging: pass the `page_key` of the last row as `p_after` for the next page; `p_limit` is 1 to 1,000 (the web asks for 101 to know whether a next page exists). `p_search` narrows to one membership id, or to the members whose phone ends in 1 to 3 digits, the digits the masked phone already shows. A limit outside 1 to 1,000, a `p_after` that is not a `page_key`, or any other search text gives `22023`. No column holds a full phone.

#### `public.loyalty_member_lookup`

```sql
public.loyalty_member_lookup(p_phone text)
returns TABLE(membership_id uuid, tenant_id uuid, programme_id uuid, phone_full text, phone_masked text, joined_at timestamp with time zone, status membership_status, channel text, stamps integer, points integer, pending_stamps integer, pending_points integer, last_visit date)
```

- **Status:** built (#253); the lookup of Khách hàng → Thành viên calls it.
- **Who may call:** owners, managers and viewers; everyone else gets `42501`. Through PostgREST only by POST, so the phone travels in the request body: a GET, which would put the phone in the URL, is refused with `PT405` (HTTP 405) before anything is read.
- **Notes:** the memberships, in every tenant where the caller reads loyalty, of the customer whose phone reads as `p_phone` in E.164 form whatever form the till stored (spaces, dots, a leading 0 or 84 are accepted), newest first, at most 100; nothing for a text that is not a phone or a phone no member has. `phone_full` is the E.164 phone for an owner of the membership's tenant and null for everyone else, so an owner who is a viewer elsewhere gets the other tenant's row masked; `phone_masked` is always given. The web keeps the rows of the selected tenant and never puts the phone in the address, the title or the console. The balance is scoped as above.

#### `public.loyalty_shift_anomalies`

```sql
public.loyalty_shift_anomalies(p_store_ids uuid[], p_from date, p_to date)
returns TABLE(store_id uuid, business_date date, shift_number integer, earns integer, refusals jsonb, refusals_total integer, adjustments integer, checkins_without_invoice integer)
```

- **Status:** built (#253); Khách hàng → Bất thường theo ca calls it.
- **Who may call:** anyone signed in; a report function (`security invoker`), so owners, managers and viewers get the stores in their loyalty scope and staff and the publisher no row.
- **Notes:** per store, business date and shift: `shift_number` is the n of Ca {n}, the shift's place by opening time (then external id) among the store's shifts of that business date, as `app.shift_number` numbers it, null for events outside every shift. `earns` counts the earn rows, `refusals` the refusals by reason (`{"daily_cap": 1}`, only the reasons that occurred) with `refusals_total`, `adjustments` the manual adjustments (adjust rows whose reason is not `welcome`) and `checkins_without_invoice` the check-ins recorded without a matched invoice and not queued. An earn or a refusal belongs to the shift its invoice names, else to the shift open when the invoice was sold; an adjustment or a check-in to the shift open at that moment; a row takes the business date of its shift, else its own. Only shifts with an event come back. Never a cashier name, the POS shift label or its external id. 0 to 50 stores and at most 92 days, else `22023`; the web asks in groups of 50 stores.

#### `public.phone_masked`

```sql
public.phone_masked(p_membership memberships)
returns text
```

- **Status:** built (#253); the reconciliation queue embeds it as `membership:memberships(phone_masked)`.
- **Who may call:** anyone signed in; `security definer`, it answers only for a membership the caller reads (owners, managers and viewers of its tenant, a customer session its own) and null otherwise.
- **Notes:** a computed column of `memberships` for PostgREST (`select=id,phone_masked`): the member's phone masked as above, null without a phone. It looks the membership up again by id, so a row passed through `/rpc/phone_masked` reveals nothing the caller could not read.

### 3.24 Data-subject requests (phase 17a)

Migration `data_subject_deletion` (#252) carries out a customer's deletion request; migrations `data_subject_tooling` and `data_subject_deletion_preview` add the look-up, export, correction, deletion preview and the due-soon queue, which the pages of Khách hàng → Tra cứu dữ liệu and Yêu cầu về dữ liệu (#254) call. Their callers are owners and managers with every store; no customer session reaches them. Rules and the log are in [schema.md](schema.md#data-subject-deletion).

#### `public.dsr_delete`

```sql
public.dsr_delete(p_request_id uuid)
returns jsonb
```

- **Status:** built (phase 17a, #252); no caller yet (the owner runs it in the SQL editor, operations 4.15; the web page is #254).
- **Who may call:** an owner with an unlimited scope of the request's tenant; everyone else, managers included, gets `42501`. `anon` and `service_role` may not execute it.
- **Notes:** takes a `deletion` request of subject `customer` that names the customer, as [`customer_request_deletion`](#publiccustomer_request_deletion) records it (`22023` for any other type, a staff subject, a request without a subject and a rejected request). In one transaction it removes the customer's memberships with their ledger rows, stamps, claims, check-ins, redemptions (a held pool code is quarantined), queue items, refusals and loyalty requests, the consent records, the Mini App logins with their Auth users and the `customers` row, and redacts the customer's message rows; it is the only way past the append-only rules of `loyalty_ledger` and `consent_records`. It completes the request and answers `{"request_id", "action": "deletion", "status": "completed", "already_done", "acted_at", "counts", "first_response_due_at", "completion_due_at", "responded_on_time", "completed_on_time"}`, where `counts` gives the rows per table; the same object is logged in `data_subject_request_actions`. A second call answers the logged action with `already_done` true and deletes nothing. Invoices keep the customer fields the POS sent until the POS is corrected and the days are synced again.

Tests: pgTAP `91_data_subject_deletion.sql`.

#### `public.dsr_lookup`

```sql
public.dsr_lookup(p_phone text)
returns TABLE(customer_id uuid, tenant_id uuid, name text, phone_masked text, first_seen_at timestamp with time zone, memberships integer, ledger_entries integer, stamp_total integer, point_total integer, consents jsonb, messages integer, open_requests integer)
```

- **Status:** built (#252); the lookup of Khách hàng → Tra cứu dữ liệu calls it.
- **Who may call:** owners and managers with every store; a store-limited manager, staff, viewers, the publisher and every customer session get `42501`. Through PostgREST only by POST, so the phone travels in the request body: a GET is refused with `PT405`. `anon` and `service_role` may not execute it.
- **Notes:** the customers of the caller's tenants whose phone reads as `p_phone` in any written form, newest first, at most 20, nothing for a text that is not a phone. Each row is a summary: the masked phone (never the full one, even for an owner), the memberships, the ledger entry count and the stamp and point totals, the consent rows per purpose (`id`, `purpose`, `channel`, `policy_version`, `granted_at`, `revoked_at`, `active`), the message count and the open requests. `customer_id` is what a request is attached to.

Tests: pgTAP `161_data_subject_tooling.sql`, `120_security_function_matrix.sql`; Playwright `e2e/live/privacy-requests.spec.ts`.

#### `public.dsr_export`

```sql
public.dsr_export(p_request_id uuid)
returns jsonb
```

- **Status:** built (#252); the export action of Yêu cầu về dữ liệu calls it and hands the JSON over as a private download.
- **Who may call:** owners and managers with every store of the request's tenant; everyone else, and an unknown or foreign request id, gets `42501` (so ids cannot be probed). `22023` for a request about staff, naming no customer, rejected, or whose customer is gone.
- **Notes:** every row of the request's customer and of nothing else: `request`, `customer`, `invoices` (the customer fields only), `memberships`, `loyalty_ledger`, `stamps`, `receipt_claims`, `redemptions`, `consent_records`, `messages` (the log row, not the text) and `counts` equal to the array lengths. The full phone is in the file for an owner and masked for a manager, in the customer and the invoices. A received request moves to `in_progress`, which stamps the first response.

Tests: pgTAP `161_data_subject_tooling.sql`; vitest `privacy/export-shape.test.ts`.

#### `public.dsr_correct`

```sql
public.dsr_correct(p_request_id uuid, p_field text, p_value text)
returns jsonb
```

- **Status:** built (#252).
- **Who may call:** owners and managers with every store of the request's tenant; `42501` for everyone else.
- **Notes:** corrects the customer's `name` in our copy on a `correction` request and answers `{request_id, field, changed, status}` without the value. `22023` for another request type, a completed or rejected request, any field but `name` (the phone and the sales data are corrected in the POS first and the days synced again), and a name that is empty, over 120 characters or holds control characters. A received request moves to `in_progress`.

Tests: pgTAP `161_data_subject_tooling.sql`.

#### `public.dsr_deletion_preview`

```sql
public.dsr_deletion_preview(p_request_id uuid)
returns jsonb
```

- **Status:** built (#252); the confirmation of the delete action lists these counts.
- **Who may call:** owners and managers with every store of the request's tenant (a manager sees the counts but cannot delete); `42501` for everyone else; `22023` as for `dsr_export`.
- **Notes:** the counts `dsr_delete` would remove or redact (`memberships`, `loyalty_ledger`, `stamps`, `redemptions`, `receipt_claims`, `consent_records`, `outbound_messages`, `invoices_unlinked`). It changes nothing, not even the request's status.

Tests: pgTAP `162_data_subject_deletion_preview.sql`.

#### `public.dsr_due_soon`

```sql
public.dsr_due_soon(p_days integer DEFAULT 3)
returns TABLE(request_id uuid, tenant_id uuid, request_type dsr_type, status dsr_status, received_at timestamp with time zone, first_response_due_at timestamp with time zone, completion_due_at timestamp with time zone, responded_at timestamp with time zone, first_response_state text, completion_state text)
```

- **Status:** built (#252); the banner of Yêu cầu về dữ liệu calls it.
- **Who may call:** owners and managers with every store; `42501` for everyone else; `22023` for `p_days` outside 0 to 30 or null.
- **Notes:** the open (`received` or `in_progress`) requests of the caller's tenants whose first response (until `responded_at` is set) or completion deadline is overdue or within `p_days` days, soonest first. Each deadline has a state: `done` (a first response already given), `overdue`, `due_soon` or `on_track`. No contact and no subject in the rows. The alert rule `dsr_due_soon` (owners and managers, `days` 1 to 10, default 3, one tenant-level episode with the overdue and due-soon counts, cool-down 24 hours) is evaluated by `app.evaluate_dsr_due_soon(tenant, at)`, which the runner does not call yet (docs/test-gaps.md).

Tests: pgTAP `161_data_subject_tooling.sql`; vitest `privacy/request-deadline.test.ts`.

### 3.25 Customer metrics (phase 17a)

Migration `customer_metrics` (#251). The three functions are reports (`security invoker`) that return aggregates only: no phone, name or customer id. They are for owners, managers and viewers (`42501` for staff, the publisher and customer sessions), take 1 to 50 stores (`22023` otherwise) and read the stores in the caller's loyalty scope. Metric definitions are in [metrics.md](metrics.md#customers-and-loyalty).

#### `public.customer_metrics`

```sql
public.customer_metrics(p_store_ids uuid[], p_from date, p_to date)
returns TABLE(invoices integer, identified_invoices integer, customer_capture_rate numeric, customers integer, repeat_customers integer, repeat_rate numeric, active_customers_30d integer, visit_frequency_30d numeric, active_customers_90d integer, visit_frequency_90d numeric, outstanding_points integer, loyalty_liability numeric, breakage_rate numeric, member_revenue numeric, rewards_redeemed_value numeric, reward_cost_rate numeric, member_customers integer, comparison_customers integer, member_visit_frequency numeric, comparison_visit_frequency numeric, member_frequency_uplift numeric, uplift_comparison text)
```

- **Status:** built (#251); the cards of Khách hàng → Thành viên call it for the last 30 days.
- **Notes:** one row over 1 to 366 business dates (`22023` otherwise). `customer_capture_rate` (non-voided invoices with a phone or a customer id over all non-voided invoices) comes with every customer figure. A visit is a customer-day, so two invoices on one day are one visit. `repeat_rate` is the customers with at least two visit days over the customers with one; `visit_frequency_30d` and `_90d` are visit days per active customer over the 30 and 90 days ending on `p_to`. `loyalty_liability` is the spendable outstanding points (pending earns without their confirm row left out) times the programme's point value times one minus its expected breakage; `breakage_rate` the expired points over the points of cohorts already past their expiry; `reward_cost_rate` the confirmed redeem value of the range over the net revenue of member invoices. These three read the ledger rows of the requested stores and the rows without a store. `member_frequency_uplift` is the visit frequency of members (joined before the range) over that of identified non-members of the same stores, minus one, with `member_customers`, `comparison_customers` and the comparison group named in `uplift_comparison` (`identified_non_members`: not matched on tenure and not a hold-out); null below 10 customers in a group. A figure whose input is not measured is null, never 0. `customer_ltv` needs costs and is not computed here.

Tests: pgTAP `163_customer_metrics.sql` (hand calculations), `120_security_function_matrix.sql`; Playwright `e2e/live/customer-metrics.spec.ts`.

#### `public.cohort_retention`

```sql
public.cohort_retention(p_store_ids uuid[], p_first_month date, p_months integer, p_as_of date)
returns TABLE(cohort_month date, month_offset integer, cohort_size integer, retained integer, retention numeric)
```

- **Status:** built (#251).
- **Notes:** 1 to 12 cohort months from the month of `p_first_month` (`22023` otherwise). A cohort is the identified customers first seen in that month who have a non-voided invoice at the requested stores. Per cohort and month offset 0 to 12, never past the month of `p_as_of`: the cohort size, the customers who bought in cohort month plus offset and their share, null for an empty cohort.

Tests: pgTAP `163_customer_metrics.sql`.

#### `public.rfm_quintiles`

```sql
public.rfm_quintiles(p_store_ids uuid[], p_as_of date)
returns TABLE(segment text, customers integer, share numeric)
```

- **Status:** built (#251).
- **Notes:** the identified customers of the 365 days ending on `p_as_of`, scored by quintile on recency (reversed), frequency (visit days) and ranked with the customer id as tie-break, grouped into `champions` (R and F at least 4), `loyal` (at least 3), `new` (R at least 4, F 1), `promising` (R at least 3), `at_risk` (F at least 3), `hibernating` (F 2) and `lost`; the number of customers and their share per segment, none for an empty segment.

Tests: pgTAP `163_customer_metrics.sql`.

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
| `customers` | customers attached to invoices and loyalty members | data roles of the tenant, every column but `phone` (column grant); no API role selects `phone`, which reaches screens masked or through an owner's [`loyalty_member_lookup`](#publicloyalty_member_lookup) | none | none |

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
| `data_subject_request_actions` | what was done for a request (a deletion's counts per table), logged against both deadlines | owners and managers with an unlimited scope | none ([`dsr_delete`](#publicdsr_delete)) | none |

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
| `alert_rule_catalog` | the 26 alert and digest rules with defaults and the parameter schema, `zalo_webhook_unverified` (#207), `zalo_token_failed` and `oa_package_expiring` (#206), `cash_count_variance` (#222) and the seven staff rules and monitors of phase 15 (#230) included | every signed-in user | none | none |
| `alert_rules` | tenant and store overrides of the catalogue | owners and managers; store rows in scope | [owners](#writes-through-tables) | none |
| `channel_policies` | send rules per channel kind and message class: 27 global defaults and tenant overrides | global rows: every signed-in user; tenant rows: owners and managers | [owners](#writes-through-tables) | none |
| `notification_channels` | destinations: member, kind, provider, label, status and health | owners and managers with an unlimited scope read every destination; every member reads their own; 20 columns only, never the address, secret name or configuration | none directly: server code, and the member's own Zalo Bot link, muted rules and stop through the functions of section 3.5 (#229) | none (the staff app reads its own through `my_notifications`) |
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
| `zalo_tokens` | the OA and Mini App developer token pairs of a brand | nobody (no grant, no policy) | none (written as `postgres` by `zalo-oauth` and `fnb zalo oa` and `zmp`, #206) | none |
| `oa_menus` | a brand's OA chat menu: 1 to 5 buttons (join, points, vouchers, open the Mini App; a Mini App deep link or the join keyword), the welcome, the join replies and the texts of the `request_user_info` form, and the state the last `fnb zalo oa-menu apply` pushed (#276) | owners and managers of the tenant | [owners with an unlimited scope](#writes-through-tables), the configured columns only; the applied state is written by the CLI as `postgres` | none |
| `oa_users` | an OA user of a brand's OA: the follow state, the welcome and form sends, the customer they enrolled as through the form; the OA user id only (#277) | nobody (no grant, no policy) | none (`oa-webhook` writes it as `postgres`) | none |
| `oa_events` | the OA webhook's event log: event id, OA, event name, OA user id, times, signature outcome and customer step outcome, never a text; kept 90 days | nobody (no grant, no policy); owners read the day counts through [`oa_event_counts`](#publicoa_event_counts) | none (`oa-webhook` writes it as `postgres`, #207) | none |
| `mini_app_visits` | visits per Mini App and month in the tenant's zone, a count only: no person, device or location (#230) | owners and managers of the tenant | none (`zalo-session` counts through `zalo_session_visit` as the service role) | none |

### Operations (phase 14b)

Built (migrations `checklists`, `handovers_and_incidents` and `cash_counts`; pgTAP `51_checklists.sql`, `52_incidents_handover.sql`, `53_cash_counts.sql` and `47_operations_rls.sql`; #219, #223, #222). Every table but `incident_categories` carries the operations template: read by owners, managers and staff with the store in scope (a tenant-wide checklist by every owner, manager and staff member of the tenant), insert of the caller's own rows, update of their own rows or of any row of a store they manage, delete by managers; viewers, the publisher and `anon` read none of them. Table privileges narrow the writes to the columns of [Writes through tables](#writes-through-tables), and no client deletes an operations row. Photos live in the private Storage buckets `ops-<brand key>`, not in a table ([section 3.13](#313-checklists-and-operations-photos-phase-14b)).

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `checklist_templates` | a checklist of a store, or of every store of the tenant (`store_id` null), and shift phase: title, `active`, current `version` | the operations scope | none ([`save_checklist_template`](#publicsave_checklist_template), [`set_checklist_template_active`](#publicset_checklist_template_active)) | none |
| `checklist_items` | the items of one version in order: label, `requires_photo`, `number_unit`; immutable | the same | none | none |
| `checklist_runs` | one run by its actor (`created_by`): version, title and phase as started, business date, photo bucket, start and finish | the operations scope | [the actor](#writes-through-tables) | none |
| `checklist_answers` | one row per item of a run: done, number, photo path, photo-removed marker, last actor and time | the same | [the actor, managers](#writes-through-tables) | none |
| `checklist_corrections` | the log of answers changed after a run finished: values before and after, who, when | the same | none (trigger) | none |
| `shift_handovers` | a note from Ca {n} to Ca {m} on a business date, its writer and acknowledgement | the same | [the writer](#writes-through-tables) | none |
| `incidents` | incident and stock-out reports: time, business date, kind, category key, description, item, up to three photo paths, status (`open`, `seen`, `resolved`) with who and when | the same | [the reporter](#writes-through-tables) | none |
| `incident_categories` | the five Vietnamese default categories (global rows) and a tenant's overrides and additions | global rows: every signed-in user; tenant rows: owners, managers and staff of the tenant | [owners with an unlimited scope](#writes-through-tables) | none |
| `cash_counts` | the cash counted at a shift close: amount, breakdown, note, counter, time, matched shift (`shift_id`), business date, `active` or `reopened` with who and when, the count it replaces | owners and managers of the store; staff their own counts, and every count of their stores when the tenant's `staff_revenue_visibility` is `all` | [the counter](#writes-through-tables) | none |

### Notices and requests (phase 15)

Built (migration `announcements_and_requests`; pgTAP `55_announcements_requests.sql` and `47_operations_rls.sql`; #227). Every table but `approval_request_kinds` carries the four operations policies; a row naming several stores (`store_ids`, `null` for every store) is in scope when one of them is, and is written or managed only by a member whose scope holds all of them (`app.ops_can_write_own_stores`, `app.ops_can_manage_stores`). No client inserts, updates or deletes an announcement, a recipient or a receipt: the functions of [section 3.16](#316-announcements-and-đã-đọc-phase-15) do.

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `announcements` | a title and body in plain text, its stores (`store_ids`), audience roles, `pinned_until`, `published_at`, `expires_at` and author | members of an audience role whose scope meets its stores; owners and managers of those stores whatever the audience | none ([`publish_announcement`](#publicpublish_announcement), [`set_announcement_pin`](#publicset_announcement_pin)) | none |
| `announcement_recipients` | the members it was published to, fixed at publication, with their role and the stores they received it at | each recipient their own rows; owners and managers whose scope meets the recipient's stores | none | none |
| `announcement_receipts` | Đã đọc: one receipt per reader (`created_by`) and announcement, with `read_at` | each reader their own; owners and managers whose scope meets the reader's stores | none ([`mark_announcement_read`](#publicmark_announcement_read)) | none |
| `approval_request_kinds` | the four Vietnamese default kinds (global rows) and a tenant's overrides and additions | global rows: every signed-in user; tenant rows: owners, managers and staff of the tenant | [owners with an unlimited scope](#writes-through-tables) | none |
| `approval_requests` | a request to the managers of a store: kind key, details, requester, status (`pending`, `approved`, `refused`), who decided and when, the reason of a refusal | the requester; owners and managers of the store | [the requester](#writes-through-tables) | none |

### Loyalty (phases 16 and 17)

Built locally (migrations `loyalty_programmes` to `loyalty_jobs`, pgTAP `60` to `65`; #239, #242, #247 to #250); empty until a programme is configured. Customer data is read by owners, managers and viewers only: staff reach loyalty rows through the functions of phase 17b, the publisher and `anon` read nothing. A customer session reads its own rows where the table says so. Columns and rules are in [schema.md](schema.md#loyalty-configuration-phase-16).

| Relation | Purpose | Who reads | Client writes | Read by a client today |
|---|---|---|---|---|
| `loyalty_programmes` | a programme: period, reward budget, status, the mechanic and anti-fraud parameters, the notification decision | data roles of the tenant; a customer session its tenant's programmes that are not drafts | owners and managers with an unlimited scope; `active` is refused while the decision is `pending` | none |
| `loyalty_staff_phones` | the staff phones that never earn, in E.164 form | owners and managers of the tenant | owners and managers of the tenant | none |
| `coupon_rails` | the rail of each store (`crm_code_pool`, `crm_callback`, `pos_payment_discount`) with its history; on `crm_callback` also the POS store reference and the switch of the [voucher callback](#voucher-callback) | data roles, stores in scope | owners and managers with an unlimited scope; switching inserts a row | none |
| `coupon_rail_rewards` | the POS side of each reward per store and its e-invoice display | data roles, stores in scope | owners and managers with an unlimited scope | none |
| `coupon_codes` | single-use POS codes of a reward per store and their state | owners and managers, stores in scope | none | none |
| `memberships` | a customer's membership of a programme, with the per-brand Zalo user id only; the computed column [`phone_masked`](#publicphone_masked) gives the masked phone | owners, managers and viewers of the tenant; a customer session its own | none (`app.loyalty_join`) | web app (the queue embeds `phone_masked`; the list goes through [`loyalty_members_page`](#publicloyalty_members_page)) |
| `loyalty_ledger` | the append-only ledger: earn, confirm, clawback, redeem, adjust, expire, with the value at issue and the matched path | owners, managers and viewers, stores in scope (rows without a store: the tenant); a customer session its own | none | none |
| `stamps` | one row per stamp with its expiry and state | owners, managers and viewers of the tenant; a customer session its own | none | none |
| `pending_checkins` | path B check-in codes, their recording by staff and their match | owners, managers and viewers, stores in scope; a customer session its own | none | none |
| `receipt_claims` | path C receipt claims and their outcome with its reason | owners, managers and viewers, stores in scope; a customer session its own | none | none |
| `coupons` | the reward catalogue (completed in 18b); active only when every store in scope maps it | data roles of the tenant; a customer session its tenant's active rewards | owners and managers with an unlimited scope | none |
| `redemptions` | holds and confirmations of rewards | owners, managers and viewers, stores in scope; a customer session its own | none | none |
| `loyalty_refusals` | why an invoice did not earn, for the shift anomaly report | owners, managers and viewers, stores in scope | none | none |
| `loyalty_queue` | check-ins and claims with two candidate invoices, waiting for a manager | owners and managers, stores in scope | none ([`resolve_loyalty_queue_item`](#publicresolve_loyalty_queue_item)) | none |
| `loyalty_liability_daily` | the nightly points liability, breakage and deferred revenue per programme and day | owners, managers and viewers of the tenant | none | none |

## 5. Edge Function endpoints

### Shared rules of the Zalo functions

Built in `supabase/functions/_shared` (`cors.ts`, `http.ts`; 30 Deno tests in `cors.test.ts` and `http.test.ts`, #204). The five Zalo functions below are built on `serveFunction` and enabled in `supabase/config.toml`: `zalo-session` with `verify_jwt = false`, `zalo-phone` with `verify_jwt = true`, `oa-webhook`, `bot-webhook` and `zalo-oauth` (#206) with `verify_jwt = false`. None is deployed yet; they run on the local stack and against a mock of Zalo (`@fnb/zalo/testing`). Each follows these rules, and its own section gives its body and codes.

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

Built against the mock (#205, with the staff notice and pairing of #212 and #213, and the texts and contact instructions of #215; Deno 32 tests in `handler.test.ts`, `pairing.test.ts` and `texts.test.ts`, and the gated integration suite of `@fnb/zalo`). The Mini Apps' session client (`@fnb/zalo-mini`, #208) reads every answer below; the answers of #205 are unchanged except that `member` gained `tenant_id` and `store_ids`, `unpaired` may carry `notice`, `reason`, `retry_after` and `contact`, and `notice_required` may carry `contact`.

- **URL:** `<SUPABASE_URL>/functions/v1/zalo-session`. **Method:** `POST`; `OPTIONS` answers the preflight of a Mini App origin.
- **Authorization:** none at the gateway (`verify_jwt = false`); the Zalo access token in the body is the credential.
- **Body:** `{"access_token": "<the Mini App's Zalo access token>", "brand": "brand-1"}` plus at most one of these steps:
  - `"binding_code": "123456"`: a member binds the Zalo account once with a code of `fnb zalo bind` (#205);
  - `"pairing_code": "123456", "notice": {"version": "<the staff notice version shown>", "shown_at": "<ISO time it was shown>"}`: a person on the staff roster, after reading and accepting the staff notice, pairs with the code a manager issued (`issue_pairing_code`, section 3.12); a binding code is accepted here too;
  - `"notice": {…}` alone: a paired person accepts a newly published notice.

  `binding_code` and `pairing_code` together are refused.

  The texts request is `{"brand": "brand-1", "texts": true}` and nothing else: no access token, no code, no notice. The staff app sends it before pairing, for Privacy and Terms (`texts()` of `@fnb/zalo-mini`).
- **What it does:** finds the brand's Zalo App through `zalo_session_app` (one app, `active`), reads the App secret named by `zalo_apps.secret_name`, and asks the Zalo Graph `GET /v2.0/me?fields=id,name` with the access token and its app-secret proof (HMAC-SHA256 of the access token keyed with the App secret), 10 seconds at most. `zalo_session_sign_in` then answers `bound` for a Zalo user id already bound to a current member of the app's tenant, binds it first when a valid binding code comes with it, and answers `unpaired` otherwise; a request with `pairing_code` or `notice` goes to `zalo_session_pair` instead. Before any session for a person on the staff roster, the `staff_ops` consent must be current: otherwise the answer is `notice_required`, unless the acceptance sent along records it. A valid pairing code, with the published notice accepted, records the consent, creates or updates the membership with exactly the roster role and stores, binds the Zalo identity of this app and makes the roster row `active`. At a person's first pairing the roster row has no login yet: the database answers `login_needed`, the function creates a login without password through the Auth admin API (`staff-<uuid>@zalo-staff.invalid`, an address that can never receive mail) and pairs again with it; a login it then does not need is deleted. A person paired in one brand's app pairs again in another brand's app of the tenant with a new code and keeps the same login and roster row. For `bound` the function reads the member's login e-mail through the Auth admin API and mints a session for that login (ADR-037). A texts request reads no App secret and calls no Graph: it finds the app as above and answers `zalo_session_texts`, the published `privacy_notice` and `mini_app_terms` of the app's tenant in every published language and the tenant's contact instructions (`set_staff_contact_instructions`, section 3.12), and nothing else; past 120 texts requests per Zalo App within a minute it answers 429 until the minute is over. The texts request carries no identity to count against, so the limit counts per app, as the code limits count per app and per tenant, and a burst only holds back the texts.

| Status | Body | When |
|---|---|---|
| 200 | `{"status": "bound", "access_token", "refresh_token", "expires_at", "member": {"display_name", "role", "stores", "store_ids", "tenant_id"}}` | the Zalo identity is bound to a member, now or before; `stores` are the names of the brand's stores within the member's scope, by name, and `store_ids` their ids in the same order; `display_name` the Zalo name or "Thành viên", `tenant_id` the tenant that the functions of section 3.12 take |
| 200 | `{"status": "unpaired", "reason"?, "retry_after"?, "notice"?, "contact"?}` | no binding and no code; a wrong, expired, used or burnt code; or a bound login that no longer exists. `notice` is the tenant's published staff notice, `{"version", "title", "body_markdown", "published_at"}`, when there is one; `contact` the tenant's contact instructions, plain text of at most 500 characters, when the owner set some. A pairing request adds `reason`: `code_refused` for any refused code, never saying whether it was wrong, expired, used, burnt or a code of a roster row that cannot pair; `wait` with `retry_after` in seconds when the identity must wait after five wrong codes; `notice_outdated` when the notice accepted is not the published one, and the code was then not checked |
| 200 | `{"status": "notice_required", "notice"?, "contact"?}` | a bound person on the staff roster whose `staff_ops` consent is missing or names an older notice; no session until the notice is accepted. Without `notice`, no staff notice is published; `contact` as for `unpaired` |
| 200 | `{"status": "texts", "documents": [{"kind", "language", "version", "title", "body_markdown", "published_at"}], "contact"}` | a texts request: `kind` is `privacy_notice` or `mini_app_terms`, `language` `vi` or `en`, privacy first and Vietnamese first; `documents` is empty and `contact` is `null` when the tenant has published or set none |
| 400 | `invalid_access_token` | the token is missing, empty or over 4,096 characters |
| 400 | `invalid_brand` | `brand` is not a brand key (`brand-<n>`, `n` from 1 to 999) |
| 400 | `invalid_binding_code` | `binding_code` is present but not six digits |
| 400 | `invalid_pairing_code` | `pairing_code` is present but not six digits, or comes with `binding_code` |
| 400 | `invalid_notice` | `notice` is not `{"version", "shown_at"}` with a legal-document version and a readable time |
| 400 | `invalid_texts` | `texts` is present but not `true`, or comes with anything but `brand` |
| 400 | `invalid_json`, `invalid_body` | the shared body errors |
| 401 | `zalo_token_refused` | the Graph answered an error for the token or its proof |
| 403 | `app_disabled` | the brand's Zalo App is `disabled` |
| 404 | `unknown_brand` | no Zalo App is configured for the brand key |
| 429 | `too_many_requests` | a texts request past 120 within a minute for the brand's Zalo App; `Retry-After` gives the seconds until the minute is over |
| 500 | `not_configured` | the App secret is not set; `SUPABASE_URL` or the service key is missing; the brand key names Zalo Apps of two tenants and `ZALO_TENANT_ID` does not choose; an invalid `ZALO_INTEGRATION`, `ZALO_TENANT_ID` or `ZALO_GRAPH_BASE_URL`; or, with `ZALO_INTEGRATION=1`, a tenant that is not a `zalo-it-` fixture |
| 500 | `session_unavailable` | the bound login has no e-mail to mint a session for |
| 502 | `zalo_unavailable` | the Graph did not answer in time, or answered something unreadable |
| 503 | `backend_unavailable` | PostgREST or Supabase Auth did not answer, refused, or answered something unreadable; also when creating a staff login failed, and nothing was paired then |

Pairing codes come from `issue_pairing_code` (section 3.12): six digits, valid 10 minutes, stored only as a hash salted by the tenant. A wrong code counts against every live pairing code of the tenant and every live binding code of the app (five tolerated, the sixth burns them) and against the Zalo identity, which waits 15 minutes after its fifth wrong code; the identity is kept only as a hash. Log lines name the outcome only (`unpaired: the pairing code was refused`, `notice required: …`, `session minted: staff, 1 stores, identity bound, login created`, `texts: 3 documents, contact set`), never the code, a token, the Zalo id, the login, its e-mail or the contact text.

Binding codes come from `fnb zalo bind` (section 6): six digits, valid 10 minutes, stored only as a hash. A wrong code counts against every live code of the brand's Zalo App; five wrong attempts are tolerated and the sixth burns them all, so guessing gains nothing ([`security.md`](security.md), section 4.3).

### `zalo-phone`

Built against the mock (#205; Deno 9 tests in `handler.test.ts`, and the gated integration suite). `pnpm zalo:dev` runs it unmodified under Deno with `ZALO_LOCAL_DEV=1` on loopback, next to `zalo-session`, and the staff app reaches it at `/supabase/functions/v1/zalo-phone` through the dev server's proxy in every mode, behind the access guard with `--lan` and `--tunnel`; the mock Zalo graph there answers the mock SDK's phone token with a synthetic number, every time.

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

Built against fake Zalo events and a mock of the OA Open API (#207, #276, #277; Deno 33 tests in `handler.test.ts`, `customer.test.ts` and `signature.test.ts`, and the gated integration suite `integration.test.ts`, which also runs a follow, the join keyword, a form answer and its replay against the local database and the mock OA). It connects to Postgres as `postgres` with `FNB_DB_URL` or the injected `SUPABASE_DB_URL`, like `sync-incremental`, and sends no CORS header to any origin.

- **URL:** `<SUPABASE_URL>/functions/v1/oa-webhook`, set as the webhook URL in the Zalo developer console (#210). **Method:** `POST`.
- **Authorization:** none at the gateway (`verify_jwt = false`); the event is signed. `X-ZEvent-Signature` (64 hex digits, optionally after `mac=`) must equal SHA-256 of the app id, the body, the event's `timestamp` and the OA secret key (`ZALO_OA_SECRET_<BRAND>`, named by `oas.secret_name`), concatenated. The body is tried as received and re-serialised without spaces, and the outcome is `raw`, `compact`, `mismatch` or `missing`.
- **Body:** a Zalo OA event of at most 65,536 bytes. The function reads `app_id`, `event_name`, the OA id (`oa_id`, else the sender or the recipient by the event's direction), the OA user id (the follower, sender or recipient), `timestamp` in milliseconds and `message.msg_id`; it never keeps the message text or any other field. The event id, the key that drops a second delivery, is SHA-256 of the app id, OA id, event name, user id, timestamp and message id. For the customer step it also reads, in memory only, the exact keyword of a `user_send_text` (`#join`, nothing else) and, of a `user_submit_info`, `info.phone` (read in E.164 form) and `info.name`; the form's birth date, gender and address are dropped, and none of it is logged.
- **What it does:** finds the OA by the app id and the OA id (`app.oa_webhook_target`), checks the signature, and lets `app.receive_oa_event` decide against the OA's current `webhook_mode`: a matching signature is stored; a mismatch or a missing signature is stored with its outcome in `observe` mode (the default) and refused in `enforce` mode, where only the day's `refused` count moves. It answers within 1.5 seconds: when the database is slower it answers 200 and stores after the answer. The follow-up runs after the answer: a follow, a message or a menu tap that sends a message moves `last_interaction_at` of that OA user's `zalo_oa` destinations forward, an unfollow disables them (`blocked_by_user`), and the day's unverified calls above `max_per_day` raise `zalo_webhook_unverified`. Then the customer step (`app.oa_customer_step`, phase 19a; [schema.md](schema.md#oa-menus-oa-users-and-the-no-app-enrolment-phase-19a)) runs once per stored event and only for a verified signature:
  - **Follow:** one welcome per follow, at most one a day, while the event is under 48 hours old, as a consultation message (Tin Tư vấn) with the brand's `oa_menus.welcome_text` and menu buttons.
  - **The join keyword** (a tap on the menu's join button, which Zalo delivers as the user's message and which opens the 48-hour window): Zalo's `request_user_info` form, at most one every two minutes, or `member_text` for an OA user already enrolled as a member.
  - **A form answer:** the no-app enrolment (`app.oa_form_enrol`): the customer found or created by its E.164 phone, a membership with channel `oa_form`, the `loyalty` consent with the form as evidence, the OA user tied to the customer. Never a `marketing` consent. Inside the window it answers `joined_text`, which says how to opt in to promotions from the Mini App; outside it, nothing.
  - **Sending:** each reply goes to `POST https://openapi.zalo.me/v3.0/oa/message/cs` with the brand's OA access token (`app.oa_access_token`: the stored `oa` pair, a `tang_truong` or `toan_dien` package), and is logged in `outbound_messages` as `oa_<kind>.v1` without its text (`app.record_oa_reply`). The function sends only with `ZALO_OA_MESSAGES=1`; otherwise every due reply is logged `cancelled` (`messages_off`), as is a reply without a token (`no_token`). A refusal by Zalo is logged `failed` with `zalo_m<code>` (for example `zalo_m230` outside the API's 7-day window), and a lost answer `uncertain`; nothing is retried. With `ZALO_INTEGRATION=1` or `ZALO_LOCAL_DEV=1` the OA API must be a loopback mock (`ZALO_OA_API_BASE_URL`), and only the tenant of `ZALO_TENANT_ID` is answered. No promotional message is ever sent from here.

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

### `zalo-oauth`

Built against a mock of Zalo's OAuth server (#206; Deno 11 tests in `handler.test.ts`, and the gated integration suite `packages/zalo/test/integration/token-jobs.test.ts`, which runs the handler and its Postgres adapter against the local stack). It connects to Postgres as `postgres` with `FNB_DB_URL` or the injected `SUPABASE_DB_URL`, like `oa-webhook`, sends no CORS header to any origin, and adds `referrer-policy: no-referrer` to the callback's answers, because the callback URL carries the code.

- **URL:** `<SUPABASE_URL>/functions/v1/zalo-oauth`, registered as the callback URL of each brand's Zalo App (#210). **Methods:** `GET` (the OA permission callback) and `POST` (a scheduled ticket).
- **Authorization:** none at the gateway (`verify_jwt = false`). A callback is accepted only with the `state` of a pending authorisation started by `fnb zalo oa authorize`; a ticket only when it is live in `app.zalo_token_tickets` (ADR-028).
- **Callback (`GET`):** `?code=<code>&state=<state>&oa_id=<OA id>`, each given at most once. The function claims the pending row by the state's SHA-256 (`app.claim_oa_authorization`; single use, 10 minutes), checks that `oa_id`, when present, is the brand's OA, reads the App secret named by `zalo_apps.secret_name` (`ZALO_APP_SECRET_<BRAND>`), exchanges the code once with the PKCE verifier at `POST https://oauth.zaloapp.com/v4/oa/access_token` (`secret_key` header; `app_id`, `code`, `grant_type=authorization_code`, `code_verifier`) and stores the pair in `zalo_tokens` (`app.save_zalo_tokens`), which also resolves an open `zalo_token_failed` episode of the brand's OA pair.
- **Ticket (`POST`):** `{"ticket": "<uuid>"}`, at most 1,024 bytes. Once `select app.enable_zalo_token_jobs('<function URL>');` has run, `pg_cron` runs `app.dispatch_zalo_tokens()` hourly at minute 41: it checks the OA package expiries and issues one ticket per stored pair past its refresh age (11 hours for the OA pair, 20 hours for the developer pair) that has none waiting. The function claims the ticket (`app.claim_zalo_token_ticket`) before anything else and refreshes that pair as `fnb zalo oa refresh` does, under the same lock, raising alerts with the source `scheduler`. An operator issues a manual ticket as `postgres` with `select app.issue_zalo_token_ticket('<brand id>', 'oa');`.

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true, "brand": "brand-1"}` | callback: the pair is stored |
| 400 | `invalid_state`, `expired_state` | callback: no pending authorisation has this state (wrong, used or purged), or its 10 minutes are over; the row is deleted either way |
| 400 | `invalid_code`, `wrong_oa`, `invalid_callback`, `declined` | callback: no usable code, an `oa_id` of another OA, a parameter given twice, or `error` without a code |
| 502 | `refused` with `zalo_error`, `unanswered` | callback: Zalo refused the code, or did not answer in 10 seconds |
| 200 | `{"outcome": "refreshed", "version": n}`, `{"outcome": "fresh", "version": n, "age_seconds": s}`, `{"outcome": "missing"}` | ticket: refreshed, younger than its refresh age, or no pair stored (or the brand left the jobs) |
| 502 | `{"outcome": "refused", "zalo_error": n, "alert": "opened"}`, `{"outcome": "uncertain", "failure": "timeout", "alert": "none"}` | ticket: Zalo refused the refresh, or its answer was lost; a lost answer is never retried with the same refresh token |
| 500 | `{"outcome": "not_configured", "alert": "opened"}` | ticket: the App secret is not set |
| 400 | `invalid_ticket`, `invalid_json` | the ticket is not a UUID, or the body is not a JSON object |
| 401 | `invalid_ticket` | the claim found no live ticket, or (with `ZALO_INTEGRATION=1`) the ticket's tenant is not the fixture named by `ZALO_TENANT_ID` |
| 405 | `method_not_allowed` | neither `GET` nor `POST` |
| 500 | `not_configured` | the database URL is missing or would allow plaintext, or `ZALO_OAUTH_BASE_URL` is set outside an integration run |

Its log lines hold outcomes and Zalo error codes only; the code, the state, the tokens and the App secret are added to the redactor before anything is logged. **Open until #210:** the exact answer and error shapes of Zalo's OAuth endpoints and the path, credentials and answer of the developer-token refresh (built against `POST https://oauth.zaloapp.com/v4/access_token` with the brand's App secret) are confirmed on the real accounts.

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

### `voucher-callback`

Built locally against synthetic payloads (#243; Deno 12 tests in `handler.test.ts`, the gated integration suite `integration.test.ts` with `VOUCHER_CALLBACK_INTEGRATION=1` and `DATABASE_URL` of the local stack, and pgTAP `95_voucher_callback.sql`). It is the restaurant-hosted validation callback of an iPOS CRM multi-use e-voucher programme (rail 2, `crm_callback`): the POS posts the code a cashier typed and the bill lines, and the function answers the discount. It connects to Postgres as `postgres` like `oa-webhook` and sends no CORS header. **It is shipped switched off:** every store answers `disabled` (0 ₫) until its `coupon_rails` row has `callback_enabled = true`, which the plan leaves until the iPOS hotline has answered questions 6 to 8 of [the integration design](deep-dives/ipos-loyalty-integration-design.md#questions-for-the-ipos-hotline).

- **URL:** `<SUPABASE_URL>/functions/v1/voucher-callback/<path segment>`. The segment is 43 base64url characters drawn by `fnb loyalty callback-path issue --tenant <slug>` (`app.issue_voucher_callback_path`), shown once and kept only as its SHA-256 in `app.voucher_callback_paths`; it names the tenant. **Method:** `POST`.
- **Authorization:** none at the gateway (`verify_jwt = false`); iPOS documents no authentication, so the secret path is the credential. A path that is not exactly one well-formed segment after the function name gets 404 before the body is read and without a database call; a well-formed segment of no tenant gets 404 after one read-only lookup. The optional source allow-list is `coupon_rails.callback_ip_allowlist` of the store (of every `crm_callback` rail of the tenant while the store is unknown), checked against the first `x-forwarded-for` address.
- **Body (vendor payload, field names verified on huongdan.ipos.vn, 2024-06-10; everything else assumed):** a JSON object of at most 65,536 bytes with `Pos_Parent`, `Pos_Id`, `Coupon_Code`, `Membership_Id`, `Sale_Tran_Id`, `Created_At`, `Code`, `Date_Start`, `Date_End` and `Voucher_Order_Line[]` (`Item_Type_Id`, `Item_Id`, `Description`, `Quantity`, `Amount`, `Pr_Key`, `Price_Sale`, `Discount`, `Detail_State`, `Package_Id`). The adapter `@fnb/connector-ipos/voucher-callback` (version `ipos-crm-callback.fields-2024-06-10.semantics-assumed.1`) reads it into canonical values; no vendor field name reaches the handler or the database (ADR-004). **Assumptions, to be confirmed by the hotline:** the method is `POST` with a JSON body; `Pos_Id` is the store's `fb_store_id`, which equals the `pos_id` of its synced invoices, and is configured as `coupon_rails.callback_store_ref`; `Sale_Tran_Id` is the sale's `tran_id`, so the synced invoice whose external id it is confirms the redemption; `Coupon_Code` is the code the cashier typed, which only works if the POS forwards a customer-specific code at all; `Membership_Id` is a phone when it reads as one; a line's net value is `Amount` − `Discount`, `Amount` being at most `Price_Sale` × `Quantity`; `Code`, `Created_At`, `Date_Start` and `Date_End` are not used.
- **Checks before the database:** `Coupon_Code` 1 to 64 characters without spaces, `Pos_Id` and `Sale_Tran_Id` 1 to 100 characters, at most 300 lines, each with an item, a quantity above 0 and at most 10,000, a non-negative amount at most `Price_Sale` × `Quantity` + 1 ₫, a line discount at most its amount, a unit price at most 100,000,000 ₫ and a bill at most 1,000,000,000 ₫.
- **Decision:** one call of `app.answer_voucher_callback` (service role only) within a 2,500 ms budget, documented in [schema.md](schema.md#voucher-callback-phase-16b). An accepted answer is kept per store, sale and redemption, so the same `Sale_Tran_Id` always gets the first discount back; the code then answers 0 ₫ with "Mã đã được sử dụng" to any other sale. A refusal binds nothing: the cashier may correct the bill and type the code again under the same sale.
- **Answer (assumed shape):** the posted object echoed with `Discount_Amount` (whole dong) and `Discount_Description` added. The vendor's sample also shows a result `Code`, whose accept and refuse values are undocumented; the function echoes the posted `Code` unchanged until the hotline names them.

| Status | `Discount_Amount`, `Discount_Description` | When |
|---|---|---|
| 200 | the discount, the reward's name | accepted, or a replay of the same sale |
| 200 | 0, a Vietnamese reason | `disabled`, `unknown_store` (no active callback rail carries the store reference), `wrong_programme`, `unknown_code`, `wrong_store`, `used` ("Mã đã được sử dụng"), `expired`, `released`, `wrong_member`, `below_minimum`, `not_applicable`, or `busy` when the database did not answer within the budget (a retry of the same sale then gets the answer the database stored) |
| 400 | 0, "Yêu cầu không hợp lệ" | not JSON, or a field missing or of the wrong type |
| 403 | 0, "Địa chỉ gọi không được phép" | the source address is outside a non-empty allow-list |
| 404 | `{"error": "not_found"}` | a wrong path |
| 405 | `method_not_allowed` | any method but `POST` on a valid path |
| 413 | `body_too_large` | more than 65,536 bytes |
| 422 | 0, "Số tiền trên hóa đơn không hợp lệ" | an amount out of the ranges above |
| 500 | `internal_error`, `not_configured` | the database failed, or no database URL |

The wrong path, a malformed body, an amount out of range and a refused address write nothing; every other decision writes one `app.voucher_callback_log` row (time, store, outcome, discount, latency). Log lines carry the outcome, whether a discount was given and the duration; the path segment, the code, the sale reference and a member phone are added to the redactor first.

### `notify`

Planned for step 12c; the function does not exist yet. Its database side is in place since step 12a (verified locally): `app.notify_tickets` holds single-use tickets on the ADR-028 pattern; `app.post_notify_ticket(p_reason)` posts only `{"ticket": id}` to the function through `pg_net`; `app.claim_notify_ticket(p_ticket)` claims a ticket once; `app.issue_notify_ticket(p_reason)` issues one for a manual run. Only `postgres` may execute them, and no schedule posts tickets yet. Today `fnb notify tick` on GitHub Actions (`notify.yml`, `sync.yml`) does the dispatcher's work. This section will give the route, the body and the responses once the function exists.

## 6. Command line

The `fnb` CLI talks to Postgres directly as `postgres`, not through this API. Its reference is in [`sync.md`, CLI reference](sync.md#cli-reference) and in [the README](../README.md#the-fnb-cli). Both still lack the commands of phase 12 (`digest`, `notify tick`, `notify status`, `notify test`, `notify link`, `notify unlink`, `notify job-failed`). Until they catch up, `pnpm --filter @fnb/jobs fnb -- <command> --help` gives the authoritative usage. The Zalo commands of phase 13 (#205) are `fnb zalo config set --tenant <slug> (--file <brand.json> | --brand <key> …)`, which writes a brand's Zalo App, OA and Mini App rows from flags or from a JSON file kept outside the repository (secret columns take a `ZALO_` name, never a value; a re-run with the same values changes nothing, different values for a stored row are refused), `fnb zalo config show --tenant <slug>` (with `CI` set, brands are numbered and only their states printed), and `fnb zalo bind --tenant <slug> --member <login e-mail> --brand <key>`, which prints a member's one-time binding code (refused in CI; a publisher login cannot be bound). The token jobs of #206 add five: `fnb zalo oa authorize --tenant <slug> --brand <key> [--redirect-uri <zalo-oauth URL>]` keeps a PKCE verifier and the state's hash for 10 minutes and prints the OA permission URL (refused in CI; the callback is `zalo-oauth`, by default `<SUPABASE_URL>/functions/v1/zalo-oauth`); `fnb zalo oa refresh [--tenant <slug>] [--brand <key>]` refreshes every OA pair older than 11 hours under its single-row lock, so a concurrent run reports the pair fresh and exits 0, and raises `oa_package_expiring` 30 and 7 days before a package ends; `fnb zalo zmp rotate [--tenant <slug>] [--brand <key>] [--force]` rotates every Mini App developer pair older than 20 hours; `ZALO_ZMP_REFRESH_TOKEN=<token> fnb zalo zmp seed --tenant <slug> --brand <key>` stores a brand's first developer pair by rotating that token once; `fnb zalo status [--tenant <slug>]` prints per brand the token ages, refreshes since stored, next refresh, package expiry, webhook mode and open `zalo_token_failed` episodes (numbered with `CI` set). The OA menu of #276 adds two: `fnb zalo oa-menu set --tenant <slug> --brand <key> [--file <menu.json>] [--form-image-url <https URL>]` writes the brand's menu, welcome and join texts (defaults for anything the file leaves out; the file kept outside the repository), and `fnb zalo oa-menu apply --tenant <slug> [--brand <key>] [--dry-run]` prints per brand the buttons and the diff against the menu applied last, and without `--dry-run` pushes a changed menu through the OA Open API with the brand's OA token and records it once Zalo accepts it (numbered, without labels or links, with `CI` set). Each reads the brand's App secret from `ZALO_APP_SECRET_<BRAND>`, registers every `ZALO_` secret value with `::add-mask::` first on GitHub Actions, never prints a token, and exits 1 when a brand's refresh failed, which also raises `zalo_token_failed`. `fnb datapack`, which reads the report functions as a member inside one snapshot, is described in [strategy.md, section 8](strategy.md#8-building-and-checking-a-pack-from-the-command-line). The rail commands of phase 16b (#243, #244) are `fnb loyalty codes import|status|export` and `fnb loyalty callback-path issue|revoke`, listed in [sync.md, CLI reference](sync.md#cli-reference).

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
