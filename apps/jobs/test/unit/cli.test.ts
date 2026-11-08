import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const MOCK_ACCOUNTS = JSON.stringify([{ key: "demo", connector: "mock" }]);

async function run(argv: string[], env: Record<string, string> = {}) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

describe("fnb", () => {
	it("prints the command list for --help and exits 2 without a command", async () => {
		const help = await run(["--", "--help"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("sync window");
		expect(help.stdout).toContain("doctor");
		expect((await run([])).code).toBe(2);
	});

	it("prints per-command help", async () => {
		const result = await run(["sync", "window", "--help"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("--from YYYY-MM-DD --to YYYY-MM-DD");
		expect((await run(["help", "tenant", "add-member"])).stdout).toContain(
			"--role owner|manager|staff|viewer|publisher",
		);
	});

	it("rejects unknown commands and options with exit code 2", async () => {
		expect((await run(["unknown"])).code).toBe(2);
		const unknownOption = await run(["status", "--nope"]);
		expect(unknownOption.code).toBe(2);
		expect(unknownOption.stderr).toContain("Usage: fnb status");
		expect((await run(["sync"])).code).toBe(2);
	});

	it("validates the window before touching the database", async () => {
		const result = await run(
			[
				"sync",
				"window",
				"--account",
				"demo",
				"--from",
				"2026-11-05",
				"--to",
				"2026-11-01",
			],
			{
				POS_ACCOUNTS_JSON: MOCK_ACCOUNTS,
			},
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("--from must not be after --to");
		const badKind = await run([
			"sync",
			"window",
			"--account",
			"demo",
			"--from",
			"2026-11-01",
			"--to",
			"2026-11-01",
			"--kind",
			"weekly",
		]);
		expect(badKind.stderr).toContain(
			"--kind must be one of backfill, nightly, incremental, manual",
		);
	});

	it("refuses to print a secret entry in CI", async () => {
		const result = await run(
			["onboard", "--tenant", "t", "--account", "demo", "--print-secret-entry"],
			{
				CI: "true",
				POS_ACCOUNTS_JSON: MOCK_ACCOUNTS,
			},
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("refused in CI");
	});

	it("masks credentials before any other output on GitHub Actions", async () => {
		const result = await run(["--help"], {
			GITHUB_ACTIONS: "true",
			POS_ACCOUNTS_JSON: JSON.stringify([
				{
					key: "shop",
					connector: "ipos-fabi",
					email: "owner@example.com",
					password: "p4ss-word",
				},
			]),
			IPOS_APP_KEY: "f".repeat(32),
		});
		const lines = result.stdout.split("\n");
		expect(
			lines.slice(0, 3).every((line) => line.startsWith("::add-mask::")),
		).toBe(true);
		expect(lines.slice(0, 3)).toEqual(
			expect.arrayContaining([
				"::add-mask::p4ss-word",
				"::add-mask::owner@example.com",
			]),
		);
	});

	it("names no account in CI when the key or number is unknown", async () => {
		const accounts = JSON.stringify([
			{ key: "shopname-real", connector: "mock" },
		]);
		const window = ["--from", "2026-11-01", "--to", "2026-11-01"];
		const byKey = await run(
			["sync", "window", "--account", "shopname-typo", ...window],
			{ CI: "true", POS_ACCOUNTS_JSON: accounts },
		);
		expect(byKey.code).toBe(1);
		expect(byKey.stderr).toContain("no POS_ACCOUNTS_JSON entry has that key");
		expect(`${byKey.stdout}${byKey.stderr}`).not.toContain("shopname");
		const byNumber = await run(
			["sync", "window", "--account-number", "2", ...window],
			{ CI: "true", POS_ACCOUNTS_JSON: accounts },
		);
		expect(byNumber.code).toBe(2);
		expect(byNumber.stderr).toContain("beyond the 1 POS_ACCOUNTS_JSON entries");
		const both = await run(
			["sync", "window", "--account-number", "1", "--all-accounts", ...window],
			{ POS_ACCOUNTS_JSON: accounts },
		);
		expect(both.stderr).toContain("pass only one of");
	});

	it("reports a missing database URL as a configuration error", async () => {
		const result = await run(["status"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("configuration: set DATABASE_URL");
	});
});
