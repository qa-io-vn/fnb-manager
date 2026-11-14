#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1"
started_at=$(date +%s)
current_step=""

report_failure() {
	echo ""
	echo "verify: FAILED at step \"${current_step}\""
}
trap report_failure ERR

step() {
	current_step="$1"
	shift
	local step_started
	step_started=$(date +%s)
	echo ""
	echo "==> ${current_step}"
	"$@"
	echo "    ok (${current_step}, $(($(date +%s) - step_started)) s)"
}

require_local_stack() {
	if ! pnpm exec supabase status -o env 2>/dev/null | grep -q '^API_URL='; then
		echo "The local Supabase stack is not running: start it with 'pnpm db:start' (never 'supabase db reset' on the build machine)."
		return 1
	fi
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "'$1' is required by CI and missing on this machine."
		return 1
	fi
}

deno_check_edge_function() {
	(cd supabase/functions/sync-incremental && deno check index.ts)
}

gitleaks_history() {
	docker run --rm -v "$PWD:/repo" "$GITLEAKS_IMAGE" git /repo --redact --exit-code 1 --no-banner
}

step "Lint" pnpm lint
step "Type-check" pnpm typecheck
step "Unit tests with the PGlite parity suite" pnpm test
step "Edge Function import map is current" node scripts/function-imports.mjs --check
step "Deno is installed" require_command deno
step "Edge Function type-check" deno_check_edge_function
step "API documentation matches the database functions" pnpm docs:check-api
step "Local stack is running" require_local_stack
step "pgTAP database tests" pnpm exec supabase test db
step "Web build with the bundle and size checks" pnpm --filter @fnb/web build
step "Web end-to-end tests (live, demo, pages)" pnpm --filter @fnb/web test:e2e
step "Docker is available for gitleaks" require_command docker
step "Secret scan of the git history" gitleaks_history
step "Public-safety scan" node scripts/check-public-safe.mjs

trap - ERR
echo ""
echo "verify: all steps green in $(($(date +%s) - started_at)) s"
