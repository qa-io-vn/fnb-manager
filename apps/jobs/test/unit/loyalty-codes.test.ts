import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	importLine,
	isInside,
	MAX_CODES_PER_IMPORT,
	parseCodeCsv,
} from "../../src/commands/loyalty-codes.js";
import { capture } from "../support/capture.js";
import { fakeSql, tenantRows } from "../support/fake-services.js";
import {
	ECHOING_ERRORS,
	expectNoIdentifiers,
	identifierFindings,
	PATH_SEGMENT,
	PHONES,
	POOL_CODES,
	ZALO_USER_ID,
} from "../support/identifiers.js";
import { runFakeCli } from "../support/run-fake-cli.js";

vi.mock("../../src/services.js", async () => {
	const { FakeServices } = await import("../support/fake-services.js");
	return { Services: FakeServices };
});

const directory = mkdtempSync(join(tmpdir(), "fnb-loyalty-codes-"));

afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
});

function codes(count: number, prefix = "SYN"): string[] {
	return Array.from(
		{ length: count },
		(_, index) => `${prefix}${String(index + 1).padStart(5, "0")}`,
	);
}

async function fnb(argv: readonly string[], env: Record<string, string> = {}) {
	const out = capture();
	const code = await runCli(argv, env, {
		streams: out.streams,
		loadEnvFile: false,
	});
	return { code, stdout: out.stdout(), stderr: out.stderr() };
}

describe("parseCodeCsv", () => {
	it("reads the first column, skips a header and a byte-order mark, and counts refusals", () => {
		const parsed = parseCodeCsv(
			'﻿Mã voucher,Hạn dùng\r\nSYN00001,2026-12-31\r\n"SYN00002",x\r\nsyn00001\r\nbad code\r\n\r\nX\r\nSYN00003;y\nSYN-00004\tz\n',
		);
		expect(parsed).toEqual({
			codes: ["SYN00001", "SYN00002", "SYN00003", "SYN-00004"],
			rows: 7,
			header: true,
			malformed: 2,
			duplicates: 1,
		});
	});

	it("keeps a first row that is already a code", () => {
		expect(parseCodeCsv("SYN00001\nSYN00002\n")).toMatchObject({
			header: false,
			rows: 2,
			codes: ["SYN00001", "SYN00002"],
		});
		expect(parseCodeCsv("")).toMatchObject({
			header: false,
			rows: 0,
			codes: [],
		});
	});

	it("deduplicates without regard to case", () => {
		expect(parseCodeCsv("abc123\nABC123\nAbC123\n")).toMatchObject({
			codes: ["abc123"],
			duplicates: 2,
		});
	});
});

describe("the import line", () => {
	it("prints counts only", () => {
		const file = parseCodeCsv(`code\n${codes(3).join("\n")}\nbad code\n`);
		const line = importLine(file, {
			received: 3,
			inserted: 2,
			malformed: 0,
			duplicates: 0,
			already_present: 1,
			conflicting: 0,
		});
		expect(line).toBe(
			"codes import: 4 row(s) read after a header; 1 malformed and 0 duplicate row(s) refused; 2 inserted, 1 already in the pool, 0 used by another pool or redemption, 0 refused by the database",
		);
		expect(line).not.toMatch(/SYN0000/);
	});
});

describe("fnb loyalty codes", () => {
	it("refuses to import with CI set", async () => {
		const file = join(directory, "ci.csv");
		writeFileSync(file, codes(2).join("\n"));
		const result = await fnb(
			[
				"loyalty",
				"codes",
				"import",
				"--tenant",
				"it-loyalty-x",
				"--store",
				"S1",
				"--reward",
				"free-drink",
				"--file",
				file,
			],
			{ CI: "true" },
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("not in CI");
		expect(result.stdout + result.stderr).not.toMatch(/SYN0000/);
	});

	it("refuses an export with CI set and the callback path in CI", async () => {
		const exported = await fnb(
			[
				"loyalty",
				"codes",
				"export",
				"--tenant",
				"it-loyalty-x",
				"--state",
				"used",
				"--out",
				join(directory, "out.csv"),
			],
			{ CI: "true" },
		);
		expect(exported.code).toBe(2);
		const path = await fnb(
			["loyalty", "callback-path", "issue", "--tenant", "it-loyalty-x"],
			{ CI: "true" },
		);
		expect(path.code).toBe(2);
		expect(path.stderr).toContain("not in CI");
	});

	it("refuses a file above one vendor export before touching the database", async () => {
		const file = join(directory, "too-many.csv");
		writeFileSync(file, codes(MAX_CODES_PER_IMPORT + 1).join("\n"));
		const result = await fnb([
			"loyalty",
			"codes",
			"import",
			"--tenant",
			"it-loyalty-x",
			"--store",
			"S1",
			"--reward",
			"free-drink",
			"--file",
			file,
		]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(`holds ${MAX_CODES_PER_IMPORT + 1} codes`);
	});

	it("refuses a reward key that is not one and a file that is not UTF-8", async () => {
		const file = join(directory, "latin1.csv");
		writeFileSync(file, Buffer.from([0x53, 0x59, 0x4e, 0xe9, 0x0a]));
		const badReward = await fnb([
			"loyalty",
			"codes",
			"import",
			"--tenant",
			"t",
			"--store",
			"S1",
			"--reward",
			"Free Drink",
			"--file",
			file,
		]);
		expect(badReward.code).toBe(2);
		const latin = await fnb([
			"loyalty",
			"codes",
			"import",
			"--tenant",
			"t",
			"--store",
			"S1",
			"--reward",
			"free-drink",
			"--file",
			file,
		]);
		expect(latin.code).toBe(2);
		expect(latin.stderr).toContain("CSV UTF-8");
	});

	it("refuses an export path inside the repository", async () => {
		const result = await fnb([
			"loyalty",
			"codes",
			"export",
			"--tenant",
			"t",
			"--state",
			"used",
			"--out",
			"codes-used.csv",
		]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("outside the repository");
		expect(isInside("/repo", "/repo/docs/x.csv")).toBe(true);
		expect(isInside("/repo", "/elsewhere/x.csv")).toBe(false);
	});
});

// G-24 (security, component). The callback path is the one secret this command
// draws: 43 characters that open the voucher callback of a tenant. Technique: error
// guessing and equivalence partitioning of the CI signal (CI, GitHub Actions, none).
// The fake database answers an issue with a real-looking segment, so a refusal that
// is lifted would print it; every line of stdout, stderr and the job summary is
// then checked for the shapes of a phone, a pool code, a 43-character segment and a
// Zalo user id.
describe("fnb loyalty callback-path prints no identifier with CI set (G-24)", () => {
	function database(queries: string[] = []) {
		const sql = fakeSql([
			(query) => {
				queries.push(query);
				return undefined;
			},
			tenantRows(),
			(query) =>
				query.includes("issue_voucher_callback_path")
					? [{ segment: PATH_SEGMENT }]
					: undefined,
			(query) =>
				query.includes("revoke_voucher_callback_path")
					? [{ revoked: 1 }]
					: undefined,
		]);
		return { sql, queries };
	}

	const issue = ["loyalty", "callback-path", "issue", "--tenant", "fixture-a"];
	const revoke = [
		"loyalty",
		"callback-path",
		"revoke",
		"--tenant",
		"fixture-a",
		"--label",
		"pos-crm",
	];

	it.each([
		["CI", { CI: "1" }],
		["GitHub Actions", { GITHUB_ACTIONS: "true" }],
	])(
		"refuses to issue a path under %s before it asks the database anything",
		async (_signal, env) => {
			const queries: string[] = [];
			const { sql } = database(queries);
			const result = await runFakeCli(issue, { sql }, { env });
			expect(result.code).toBe(2);
			expect(result.stderr).toContain("not in CI");
			expect(result.stdout).toBe("");
			expect(queries).toEqual([]);
			expectNoIdentifiers(result);
		},
	);

	it("control: without CI the same command prints the segment once, and the harness sees it", async () => {
		const { sql } = database();
		const result = await runFakeCli(issue, { sql });
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`/voucher-callback/${PATH_SEGMENT}`);
		expect(identifierFindings("stdout", result.stdout)).toContain(
			"stdout line 2: path segment",
		);
	});

	it.each([
		["a segment", PATH_SEGMENT],
		["a phone", PHONES[0] ?? ""],
		["a Zalo user id", ZALO_USER_ID],
	])(
		"refuses an issue under CI with %s as its label, without asking the database",
		async (_kind, label) => {
			const queries: string[] = [];
			const { sql } = database(queries);
			const result = await runFakeCli(
				[...issue, "--label", label],
				{ sql },
				{ env: { CI: "1" } },
			);
			expect(result.code).toBe(2);
			expect(queries).toEqual([]);
			expectNoIdentifiers(result);
		},
	);

	it("revokes under CI and prints the count only", async () => {
		const { sql } = database();
		const result = await runFakeCli(revoke, { sql }, { env: { CI: "1" } });
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("callback path: 1 revoked\n");
		expect(result.stderr).toBe("");
		expectNoIdentifiers(result);
	});

	it("does not repeat a label or a tenant that is a segment, a phone, a code or a Zalo user id", async () => {
		const hostile = [
			PATH_SEGMENT,
			PHONES[2] ?? "",
			POOL_CODES[0] ?? "",
			ZALO_USER_ID,
		];
		for (const value of hostile) {
			const label = await runFakeCli(
				[...revoke.slice(0, -1), value],
				database(),
				{ env: { CI: "1" } },
			);
			expect(label.code).toBe(0);
			expect(label.stdout).toBe("callback path: 1 revoked\n");
			expectNoIdentifiers(label);
			const unknownTenant = await runFakeCli(
				[
					"loyalty",
					"callback-path",
					"revoke",
					"--tenant",
					value,
					"--label",
					"x",
				],
				{ sql: fakeSql([tenantRows([])]) },
				{ env: { CI: "1" } },
			);
			expect(unknownTenant.code).toBe(1);
			expect(unknownTenant.stderr).toContain("no tenant with that slug");
			expectNoIdentifiers(unknownTenant);
		}
	});

	it.each(ECHOING_ERRORS)(
		"keeps a %s out of the output when the database fails the revoke with it",
		async (_kind, message) => {
			const sql = fakeSql([
				tenantRows(),
				(query) => {
					if (query.includes("revoke_voucher_callback_path")) {
						throw new Error(message);
					}
					return undefined;
				},
			]);
			const result = await runFakeCli(revoke, { sql }, { env: { CI: "1" } });
			expect(result.code).toBe(1);
			expect(result.stderr).toContain(
				"fnb loyalty callback-path revoke failed",
			);
			expectNoIdentifiers(result);
		},
	);
});
