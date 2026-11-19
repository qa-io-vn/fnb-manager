import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	importLine,
	isInside,
	MAX_CODES_PER_IMPORT,
	parseCodeCsv,
} from "../../src/commands/loyalty-codes.js";
import { capture } from "../support/capture.js";

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
