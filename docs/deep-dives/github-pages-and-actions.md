## GitHub Pages and GitHub Actions: hosting and compute layer

Research date: 2026-11-07. Verified facts cite official documentation; inferences are marked.

### What GitHub Pages is, and is not

GitHub Pages serves static files from a Fastly-backed CDN (`server: GitHub.com`, `via: 1.1 varnish`, edge region `southeastasia` when fetched from Vietnam). On the Free plan Pages is available for **public repositories only**; Pro and Team add Pages from private repositories, but the published site is still public. Access-controlled sites exist only for organizations on GitHub Enterprise Cloud. For this project that confirms the roadmap's assumption: the repository is public, the site is public, and all security lives in Supabase Auth and RLS. The bundle may legitimately contain the Supabase URL and anon key; it must contain nothing else.

Limits (docs, 2026-11-07): published site at most **1 GB**, source repository recommended under **1 GB**, soft bandwidth cap **100 GB/month**, soft cap of **10 builds/hour** that **does not apply** when you publish with a custom GitHub Actions workflow, and a **10-minute** deployment timeout. One project site per repository, served at `https://<owner>.github.io/<repo>/`. The Pages terms forbid hosting "an online business, e-commerce site" or "commercial software as a service" and discourage sensitive transactions; an owner's internal dashboard is fine, a hosted multi-tenant product for strangers would not be.

### Deploying with Actions

Set Settings → Pages → Source to **GitHub Actions**. The workflow is `actions/configure-pages@v6` → build → `actions/upload-pages-artifact@v5` (one gzip of one tar, under 10 GB, officially 1 GB, no symlinks, default retention 1 day) → `actions/deploy-pages@v5` in a job with `permissions: pages: write, id-token: write`, `needs: build` and `environment: github-pages`. `configure-pages` exposes `base_path` (for example `/fnb-manager`), which is the cleanest source for Vite's `base`; its auto-configuration covers only Next, Nuxt, Gatsby and SvelteKit, not Vite. Jekyll is only part of the "deploy from a branch" path; an artifact is deployed as-is (inference from the docs), but an empty `.nojekyll` in `public/` is a free safeguard for underscore-prefixed files. With a custom workflow no `CNAME` file is created or needed; custom domains are configured in Settings, with a `CNAME` record to `<owner>.github.io` for subdomains or the four `185.199.108–111.153` A records and `2606:50c0:8000–8003::153` AAAA records for an apex, a Let's Encrypt certificate issued automatically, and an "Enforce HTTPS" switch.

### SPA routing, base path and headers

Pages has no rewrites: a fresh load of `/bao-cao/thang` returns a real **HTTP 404** (verified with curl). Two options:

1. **Hash routing** (`/#/bao-cao/thang`): zero server involvement, works on any base path. Caveat: supabase-js defaults to `flowType: 'implicit'`, which returns tokens in the URL fragment; set `flowType: 'pkce'` (returns `?code=`) or process the fragment before the router mounts.
2. **404.html redirect** (rafgraph pattern): `404.html` encodes the path into a query string, `index.html` restores it with `history.replaceState`; for a project site set `pathSegmentsToKeep = 1` and the router `basename` to `/<repo>`. Google no longer follows these redirects, which is irrelevant for an authenticated app.

Vite needs `base: '/<repo>/'` for a project site and `'/'` for a custom domain or `<owner>.github.io` repository; drive it from one environment variable so a fork can change it without touching code. Response headers are fixed: `Cache-Control: max-age=600` on everything (GitHub Support has confirmed it cannot be changed), no site-defined CSP, HSTS or X-Frame-Options. Fingerprinted Vite assets are safe; `index.html` can be up to 10 minutes stale after a deploy, so add a `version.json` check and a reload prompt.

### GitHub Actions: cost and capacity

Standard runners on **public repositories are free** and run on **4 vCPU / 16 GB RAM** Ubuntu 24.04 (private repos get 2 vCPU / 8 GB). Since January 2026 the included allowance for private repos is expressed in money: **$12/month on Free** (Linux 2-core at **$0.006/min**, i.e. about 2,000 minutes, matching the pricing page), $18 on Pro/Team, $300 on Enterprise Cloud, with 500 MB / 1 GB / 2 GB / 50 GB artifact storage and a **10 GB cache per repository** (entries unused for 7 days are evicted). Other limits: 6-hour job maximum, `timeout-minutes` default 360, 20 concurrent jobs on Free, 90-day default artifact/log retention (1–90 days configurable on public repos). The Actions terms bar use "as part of a serverless application" and "any other activity unrelated to the production, testing, deployment, or publication of the software project". A twice-hourly POS sync owned by the repository's own code is defensible but grey; keep it short and keep Supabase pg_cron plus Edge Functions as the documented fallback.

### Scheduled workflows

Cron has five POSIX fields, no `@daily` shortcuts, runs in **UTC by default**, and since the late-March 2026 update accepts `timezone: "Asia/Ho_Chi_Minh"` beside the expression. The shortest interval is **5 minutes**; the workflow must be on the default branch. GitHub warns that schedules "can be delayed during periods of high loads", that "high load times include the start of every hour", and that under sufficient load "some queued jobs may be dropped". Community discussion #156282 (April 2025–October 2026) reports 20–40-minute delays as normal, multi-hour delays and skipped runs through 2026. Consequences: schedule at odd minutes (`7,37`), make every run idempotent over a re-pull window so a missed run self-heals, show freshness in the UI, and alert when the last success is older than 90 minutes. On public repositories scheduled workflows are **disabled after 60 days without repository activity** (and in forks); re-enable with `gh workflow enable sync.yml`. What counts as activity is undefined in the docs; the owner's regular commits are the practical keep-alive, with a monthly heartbeat step as insurance.

### Dispatch, concurrency, secrets, caching, summaries

`workflow_dispatch` allows up to **25 inputs** (types `boolean`, `choice`, `number`, `environment`, `string`; 65,535-character payload), enough for store, from, to and dry-run on the backfill workflow. A `concurrency` group admits one running and one pending run; a newer queued run replaces the pending one, which is exactly the behaviour a cron sync wants (`cancel-in-progress: false`). Secrets: **100 per repository, 100 per environment, 1,000 per organization, 48 KB each**; environments (and their protection rules) are free on public repos. GitHub's hardening guide says to **never store structured data such as JSON as one secret** because redaction only matches the whole value, so fields of `POS_ACCOUNTS_JSON` would print unmasked. Keep the JSON contract for portability but `::add-mask::` every credential field as the first step, or store one secret per account and assemble the JSON in the workflow. For pnpm use `pnpm/action-setup@v6` with `cache: true` (keyed on `pnpm-lock.yaml`) or `actions/setup-node@v7` with `cache: pnpm` after pnpm is installed. Write a Markdown job summary to `$GITHUB_STEP_SUMMARY` (1 MiB per step, 20 per job) with rows synced and reconciliation status per store-day, emit `::warning`/`::error` annotations, and add an `if: failure()` step that calls the Notifier; GitHub's own failure emails go only to the person who last edited the cron line.

### Alternatives if limits bite

**Cloudflare Pages** (Free): 500 builds/month, one concurrent build, 20,000 files, 25 MiB per file, **unlimited static requests and bandwidth**, a `_headers` file for `Cache-Control`/CSP, and Workers Static Assets' `not_found_handling = "single-page-application"`; it can consume the same Actions build. **Netlify** moved new accounts to 300 credits/month (15 credits per deploy, 10 per GB), which is tight for daily deploys; legacy accounts keep 100 GB / 300 build minutes.

### Checklist for this project

- Pages source = GitHub Actions; configure-pages@v6 → upload-pages-artifact@v5 → deploy-pages@v5; `.nojekyll` in `public/`.
- One env var drives Vite `base` and router basename; choose hash routing + `flowType: 'pkce'`, or the 404.html pattern with `pathSegmentsToKeep = 1`.
- Bundle lint for UUIDs/emails/keys; `version.json` stale-bundle prompt (max-age=600).
- `sync.yml`: off-peak minutes, `timezone: Asia/Ho_Chi_Minh`, per-store concurrency group, `timeout-minutes`, dispatch inputs, `add-mask` of every credential field, job summary, `if: failure()` alert.
- Cron-probe from phase 1; freshness alert at 90 minutes; keep-alive and `gh workflow enable` in the runbook.
- Decision record: Actions-terms grey area with Supabase cron and Cloudflare Pages as fallbacks.

### Sources

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- https://github.com/pricing
- https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
- https://github.com/actions/configure-pages · https://github.com/actions/upload-pages-artifact · https://github.com/actions/deploy-pages
- https://vite.dev/guide/static-deploy
- https://github.com/rafgraph/spa-github-pages
- https://webapps.stackexchange.com/questions/119286/caching-assets-in-website-served-from-github-pages
- https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
- https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- https://github.blog/changelog/2026-03-26-github-actions-late-march-2026-updates
- https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow
- https://github.com/orgs/community/discussions/156282
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs
- https://docs.github.com/en/actions/reference/security/secrets
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
- https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows
- https://github.com/pnpm/action-setup · https://github.com/actions/setup-node
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
- https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/notifications-for-workflow-runs
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
- https://developers.cloudflare.com/pages/platform/limits/ · https://developers.cloudflare.com/pages/functions/pricing/ · https://developers.cloudflare.com/pages/configuration/headers/ · https://developers.cloudflare.com/workers/static-assets/
- https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans/
- https://supabase.com/docs/guides/auth/sessions/implicit-flow · https://supabase.com/docs/guides/auth/sessions/pkce-flow · https://supabase.com/docs/guides/auth/redirect-urls · https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts
