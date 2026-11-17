import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildGoldenPack, demoSource } from "./support/demo.js";

const run = promisify(execFile);
const packageRoot = join(import.meta.dirname, "..", "..");
const script = join(import.meta.dirname, "support", "print-golden.ts");

const ENVIRONMENTS = [
	{ TZ: "UTC", LANG: "C", offset: 0 },
	{ TZ: "Asia/Ho_Chi_Minh", LANG: "vi_VN.UTF-8", offset: -420 },
	{ TZ: "America/Los_Angeles", LANG: "tr_TR.UTF-8", offset: 480 },
] as const;

interface ChildReport {
	readonly timeZone: string;
	readonly offset: number;
	readonly lang: string | null;
	readonly sha256: string;
}

async function buildIn(
	environment: (typeof ENVIRONMENTS)[number],
): Promise<ChildReport> {
	const { stdout } = await run(process.execPath, ["--import", "tsx", script], {
		cwd: packageRoot,
		env: {
			...process.env,
			TZ: environment.TZ,
			LANG: environment.LANG,
			LC_ALL: environment.LANG,
		},
		maxBuffer: 1024 * 1024,
	});
	return JSON.parse(stdout) as ChildReport;
}

describe("the pack and its environment", () => {
	it("gives the same bytes under three process time zones and two LANG values", async () => {
		const expected = createHash("sha256")
			.update((await buildGoldenPack(demoSource())).text)
			.digest("hex");
		const reports = await Promise.all(ENVIRONMENTS.map(buildIn));
		reports.forEach((report, index) => {
			const environment = ENVIRONMENTS[index];
			expect(report.offset).toBe(environment?.offset);
			expect(report.lang).toBe(environment?.LANG);
			expect(report.sha256).toBe(expected);
		});
		expect(new Set(reports.map((report) => report.lang)).size).toBeGreaterThan(
			1,
		);
	});
});
