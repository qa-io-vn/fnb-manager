import { randomUUID } from "node:crypto";
import { createMockConnector } from "@fnb/connector-mock";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { findAuthUserId } from "../../src/admin/tenants.js";
import { runCli } from "../../src/cli.js";
import { Services } from "../../src/services.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET_KEY =
	process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESET_GRACE_MS = 45_000;
const WINDOW = { fromDate: "2026-10-26", toDate: "2026-11-01" };
const SALES_TABLES = [
	"invoices",
	"invoice_lines",
	"invoice_payments",
	"invoice_events",
	"shifts",
	"sync_checks",
] as const;

interface Scenario {
	slug: string;
	accountKey: string;
	env: Record<string, string>;
}

function scenario(): Scenario {
	const suffix = randomUUID().slice(0, 8);
	const accountKey = `it-mock-${suffix}`;
	return {
		slug: `it-sync-${suffix}`,
		accountKey,
		env: {
			DATABASE_URL: DATABASE_URL ?? "",
			POS_ACCOUNTS_JSON: JSON.stringify([
				{ key: accountKey, connector: "mock", seed: 11 },
			]),
			...(SUPABASE_URL ? { SUPABASE_URL } : {}),
			...(SECRET_KEY ? { SUPABASE_SECRET_KEY: SECRET_KEY } : {}),
		},
	};
}

async function fnb(
	argv: string[],
	env: Record<string, string>,
): Promise<string> {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	if (code !== 0) {
		throw new Error(`fnb ${argv.join(" ")} exited ${code}: ${io.stderr()}`);
	}
	return io.stdout();
}

async function fnbResult(
	argv: string[],
	env: Record<string, string>,
): Promise<{ code: number; text: string }> {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	const text = `${io.stdout()}${io.stderr()}`
		.split("\n")
		.filter((line) => !line.startsWith("::add-mask::"))
		.join("\n");
	return { code, text };
}

async function expectCiOutputWithoutNames(run: Scenario): Promise<void> {
	const hiddenKey = `${run.accountKey}-hidden`;
	const env = {
		...run.env,
		CI: "true",
		GITHUB_ACTIONS: "true",
		POS_ACCOUNTS_JSON: JSON.stringify([
			{ key: run.accountKey, connector: "mock", seed: 11 },
			{ key: hiddenKey, connector: "mock" },
		]),
	};
	const sync = await fnbResult(
		[
			"sync",
			"window",
			"--all-accounts",
			"--from",
			WINDOW.fromDate,
			"--to",
			WINDOW.toDate,
			"--dry-run",
		],
		env,
	);
	expect(sync.code).toBe(1);
	expect(sync.text).toContain("account 1: manual (dry run)");
	expect(sync.text).toContain("account 2: this account is not onboarded");
	const single = await fnbResult(
		[
			"sync",
			"window",
			"--account-number",
			"2",
			"--from",
			WINDOW.fromDate,
			"--to",
			WINDOW.toDate,
		],
		env,
	);
	expect(single.code).toBe(2);
	const status = await fnbResult(["status", "--tenant", run.slug], env);
	expect(status.code).toBe(0);
	expect(status.text).toContain("account 1");
	const tenant = await fnbResult(
		["tenant", "create", "--name", "Integration tenant", "--slug", run.slug],
		env,
	);
	expect(tenant.text).toContain("tenant unchanged: the tenant");
	for (const output of [sync.text, single.text, status.text, tenant.text]) {
		expect(output).not.toContain(run.accountKey);
		expect(output).not.toContain(run.slug);
	}
}

async function tableFingerprints(
	sql: Sql,
	tenantId: string,
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const table of SALES_TABLES) {
		const [row] = await sql<{ rows: number; digest: string }[]>`
			select count(*)::int as rows, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as digest
			from ${sql.unsafe(`public.${table}`)} t
			where t.tenant_id = ${tenantId}
		`;
		result[table] = `${row?.rows ?? 0}:${row?.digest ?? ""}`;
	}
	return result;
}

async function expectedTotals() {
	const connector = createMockConnector();
	await connector.authenticate({ seed: 11 });
	const [store] = await connector.discoverStores();
	if (!store) {
		throw new Error("mock connector discovered no store");
	}
	return connector.fetchControlTotals(store, WINDOW);
}

async function withRetryAfterReset(work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		console.warn(
			`local-stack scenario failed once, retrying after a possible reset: ${String(error)}`,
		);
		await new Promise((resolve) => setTimeout(resolve, RESET_GRACE_MS));
		await work();
	}
}

async function syncScenario(): Promise<void> {
	const run = scenario();
	const sql = createPostgresClient(run.env.DATABASE_URL ?? "", {
		maxConnections: 2,
	});
	try {
		await fnb(
			["tenant", "create", "--name", "Integration tenant", "--slug", run.slug],
			run.env,
		);
		await fnb(
			["onboard", "--tenant", run.slug, "--account", run.accountKey],
			run.env,
		);
		await fnb(
			[
				"sync",
				"window",
				"--account",
				run.accountKey,
				"--from",
				WINDOW.fromDate,
				"--to",
				WINDOW.toDate,
				"--kind",
				"backfill",
			],
			run.env,
		);
		const [tenant] = await sql<
			{ id: string }[]
		>`select id from public.tenants where slug = ${run.slug}`;
		if (!tenant) {
			throw new Error("tenant was not created");
		}
		const perDay = await sql<{ business_date: string; invoices: number }[]>`
			select business_date::text as business_date, count(*)::int as invoices
			from public.invoices
			where tenant_id = ${tenant.id} and status <> 'voided'
			group by business_date
			order by business_date
		`;
		const totals = await expectedTotals();
		expect(perDay).toEqual(
			totals.map((total) => ({
				business_date: total.businessDate,
				invoices: total.invoiceCount,
			})),
		);
		const checks = await sql<{ is_matched: boolean }[]>`
			select is_matched from public.sync_checks where tenant_id = ${tenant.id}
		`;
		expect(checks).toHaveLength(7);
		expect(checks.every((check) => check.is_matched)).toBe(true);
		const [events] = await sql<{ count: number }[]>`
			select count(*)::int as count from public.invoice_events where tenant_id = ${tenant.id}
		`;
		expect(events?.count ?? 0).toBeGreaterThan(0);

		const before = await tableFingerprints(sql, tenant.id);
		const rerun = await fnb(
			[
				"sync",
				"window",
				"--account",
				run.accountKey,
				"--from",
				WINDOW.fromDate,
				"--to",
				WINDOW.toDate,
				"--kind",
				"nightly",
			],
			run.env,
		);
		expect(rerun).toContain("rows written: nothing");
		expect(await tableFingerprints(sql, tenant.id)).toEqual(before);
		const runs = await sql<{ kind: string; status: string }[]>`
			select kind::text as kind, status::text as status from public.sync_runs
			where tenant_id = ${tenant.id} order by started_at
		`;
		expect(runs).toEqual([
			{ kind: "master_data", status: "succeeded" },
			{ kind: "backfill", status: "succeeded" },
			{ kind: "nightly", status: "succeeded" },
		]);
		await expectCiOutputWithoutNames(run);
		expect(await tableFingerprints(sql, tenant.id)).toEqual(before);
	} finally {
		await sql`delete from public.tenants where slug = ${run.slug}`;
		await sql.end({ timeout: 5 });
	}
}

async function memberScenario(): Promise<void> {
	const run = scenario();
	const email = `${run.slug}@example.com`;
	const services = new Services(run.env);
	const { sql } = services.db();
	try {
		await fnb(
			["tenant", "create", "--name", "Member tenant", "--slug", run.slug],
			run.env,
		);
		const env = { ...run.env, FNB_MEMBER_PASSWORD: `pw-${randomUUID()}` };
		const first = await fnb(
			[
				"tenant",
				"add-member",
				"--tenant",
				run.slug,
				"--email",
				email,
				"--role",
				"viewer",
			],
			env,
		);
		expect(first).toContain("login created");
		expect(first).toContain("membership created");
		const second = await fnb(
			[
				"tenant",
				"add-member",
				"--tenant",
				run.slug,
				"--email",
				email,
				"--role",
				"viewer",
			],
			env,
		);
		expect(second).toContain("membership unchanged");
		const third = await fnb(
			[
				"tenant",
				"add-member",
				"--tenant",
				run.slug,
				"--email",
				email,
				"--role",
				"manager",
			],
			run.env,
		);
		expect(third).toContain("membership updated");
	} finally {
		const userId = await findAuthUserId(sql, email);
		if (userId) {
			await services.supabaseAdmin().auth.admin.deleteUser(userId);
		}
		await sql`delete from public.tenants where slug = ${run.slug}`;
		await services.close();
	}
}

describe.skipIf(!DATABASE_URL)("local Supabase stack", () => {
	it("onboards a mock account, reconciles a week and re-runs without changes", async () => {
		await withRetryAfterReset(syncScenario);
	}, 180_000);

	it.skipIf(!SUPABASE_URL || !SECRET_KEY)(
		"creates a login and a membership idempotently",
		async () => {
			await withRetryAfterReset(memberScenario);
		},
		180_000,
	);
});
