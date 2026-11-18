import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	bootstrapOptions,
	DEFAULT_TENANT_SLUG,
	monthLine,
	stopText,
} from "../../src/commands/bootstrap.js";
import { monthWindow } from "../../src/commands/history-walk.js";
import { UsageError } from "../../src/context.js";
import { capture } from "../support/capture.js";

const MOCK_ACCOUNTS = JSON.stringify([
	{ key: "account-1", connector: "mock", seed: 1 },
]);
const LOCAL_API = "http://127.0.0.1:54321";
const UNREACHABLE_DB =
	"postgresql://postgres:never-printed-pw@127.0.0.1:1/postgres";

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

describe("fnb bootstrap", () => {
	it("is listed and documents its options", async () => {
		expect((await run(["--help"])).stdout).toContain("bootstrap");
		const help = await run(["bootstrap", "--help"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("--max-months <n>");
		expect(help.stdout).toContain("--stop-after-empty <n>");
		expect(help.stdout).toContain("never overwritten");
	});

	it("rejects bad options before touching the database", async () => {
		const env = {
			POS_ACCOUNTS_JSON: MOCK_ACCOUNTS,
			DATABASE_URL: UNREACHABLE_DB,
		};
		const months = await run(["bootstrap", "--max-months", "0"], env);
		expect(months.code).toBe(2);
		expect(months.stderr).toContain("--max-months must be a whole number");
		expect((await run(["bootstrap", "--tenant", "Not A Slug"], env)).code).toBe(
			2,
		);
		const email = await run(["bootstrap", "--email", "nobody"], env);
		expect(email.code).toBe(2);
		expect(email.stderr).toContain("not an e-mail address");
		const none = await run(["bootstrap"], { DATABASE_URL: UNREACHABLE_DB });
		expect(none.code).toBe(2);
		expect(none.stderr).toContain("POS_ACCOUNTS_JSON lists no accounts");
	});

	it("refuses a database and an API on different backends before connecting", async () => {
		const result = await run(["bootstrap"], {
			CI: "1",
			POS_ACCOUNTS_JSON: MOCK_ACCOUNTS,
			SUPABASE_DB_URL: UNREACHABLE_DB,
			SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toContain(
			"target: database from SUPABASE_DB_URL (the local stack), API from SUPABASE_URL (a remote project)",
		);
		expect(result.stderr).toContain(
			"the web app would not see the loaded data",
		);
		expect(result.stderr).not.toContain("cannot reach the database");
		expect(`${result.stdout}${result.stderr}`).not.toContain(
			"never-printed-pw",
		);
	});

	it("stops with a hint when the database cannot be reached, without printing the password", async () => {
		const result = await run(["bootstrap"], {
			CI: "1",
			POS_ACCOUNTS_JSON: MOCK_ACCOUNTS,
			DATABASE_URL: UNREACHABLE_DB,
			SUPABASE_URL: LOCAL_API,
		});
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("database: cannot reach the database");
		expect(result.stderr).toContain("pnpm db:start");
		expect(`${result.stdout}${result.stderr}`).not.toContain(
			"never-printed-pw",
		);
		expect(`${result.stdout}${result.stderr}`).not.toContain("account-1");
	}, 30_000);
});

describe("bootstrap options", () => {
	it("defaults to the live tenant and reads the owner e-mail from the environment", () => {
		expect(bootstrapOptions({ env: {} }, {})).toEqual({
			slug: DEFAULT_TENANT_SLUG,
			name: DEFAULT_TENANT_SLUG,
			email: null,
			maxMonths: 120,
			stopAfterEmpty: 2,
		});
		expect(
			bootstrapOptions(
				{
					env: {
						LIVE_TENANT: "live-other",
						FNB_MEMBER_EMAIL: " owner@example.com ",
					},
				},
				{ name: "Shop", "max-months": "36", "stop-after-empty": "3" },
			),
		).toEqual({
			slug: "live-other",
			name: "Shop",
			email: "owner@example.com",
			maxMonths: 36,
			stopAfterEmpty: 3,
		});
		expect(
			bootstrapOptions(
				{ env: { FNB_MEMBER_EMAIL: "env@example.com" } },
				{ tenant: "live-local", email: "flag@example.com" },
			).email,
		).toBe("flag@example.com");
		expect(() =>
			bootstrapOptions({ env: {} }, { "stop-after-empty": "two" }),
		).toThrow(UsageError);
	});

	it("targets mock-local with IPOS_REAL_API=off unless --tenant names another tenant", () => {
		const off = { env: { IPOS_REAL_API: "off", LIVE_TENANT: "live-local" } };
		expect(bootstrapOptions(off, {}).slug).toBe("mock-local");
		expect(bootstrapOptions(off, { tenant: "mock-other" }).slug).toBe(
			"mock-other",
		);
		expect(
			bootstrapOptions(
				{ env: { IPOS_REAL_API: "on", LIVE_TENANT: "live-local" } },
				{},
			).slug,
		).toBe("live-local");
	});

	it("describes each month and stop in counts only", () => {
		const options = bootstrapOptions({ env: {} }, {});
		const window = monthWindow("2026-10", "2026-11-17");
		expect(
			monthLine("account 1", {
				window,
				action: "skipped",
				sales: 812,
				error: null,
			}),
		).toBe("account 1 2026-10: already loaded, skipped (812 sales stored)");
		expect(
			monthLine("account 1", {
				window,
				action: "synced",
				sales: 0,
				error: null,
			}),
		).toBe("account 1 2026-10: loaded, 0 sales");
		expect(
			monthLine("account 1", {
				window,
				action: "failed",
				sales: null,
				error: "call budget exhausted",
			}),
		).toBe("account 1 2026-10: failed (call budget exhausted)");
		expect(stopText("empty_months", options)).toBe("2 month(s) without sales");
		expect(stopText("max_months", options)).toBe("--max-months 120");
		expect(stopText("before_opening", options)).toBe("stores' opening date");
		expect(stopText("failed", options)).toBe("failed month");
	});
});
