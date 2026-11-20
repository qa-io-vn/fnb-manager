import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	checkFirstLoad,
	checkSizes,
	FORBIDDEN_PACKAGES,
	findForbiddenPackages,
	listFiles,
	MAX_FILE_BYTES,
	MAX_FIRST_LOAD_JS_BYTES,
	MAX_VERSION_BYTES,
} from "../../scripts/check-budget.mjs";
import {
	MAX_LCP_MS,
	MAX_LOAD_MS,
	paintBudgetProblems,
} from "../../src/testing/paint-budget";

const packageRoot = join(import.meta.dirname, "..", "..");
const repoRoot = join(packageRoot, "..", "..");
const script = join(packageRoot, "scripts", "check-budget.mjs");
const workspace = mkdtempSync(join(tmpdir(), "fnb-mini-budget-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function writeSized(path: string, bytes: number): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.alloc(bytes, 97));
}

function writeManifest(directory: string, manifest: object): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
}

function fixtureApp(name: string, extraDependency?: string): string {
	const app = join(workspace, name);
	writeManifest(app, {
		name: `fixture-${name}`,
		dependencies: { "chart-wrapper": "1.0.0", react: "1.0.0" },
		devDependencies: { echarts: "1.0.0" },
	});
	writeManifest(join(app, "node_modules", "react"), { name: "react" });
	writeManifest(join(app, "node_modules", "chart-wrapper"), {
		name: "chart-wrapper",
		dependencies: extraDependency ? { [extraDependency]: "1.0.0" } : {},
	});
	if (extraDependency) {
		writeManifest(join(app, "node_modules", extraDependency), {
			name: extraDependency,
		});
	}
	return app;
}

function runCli(args: readonly string[]): { status: number; output: string } {
	try {
		const output = execFileSync(process.execPath, [script, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { status: 0, output };
	} catch (error) {
		const failure = error as { status: number; stdout: string; stderr: string };
		return { status: failure.status, output: failure.stdout + failure.stderr };
	}
}

describe("size budgets", () => {
	it("are Zalo's 10 MB per version and 3 MB per file", () => {
		expect(MAX_VERSION_BYTES).toBe(10_000_000);
		expect(MAX_FILE_BYTES).toBe(3_000_000);
	});

	it("pass a small build", () => {
		const dist = join(workspace, "small");
		writeSized(join(dist, "index.html"), 500);
		writeSized(join(dist, "assets", "index.module.js"), 290_000);
		const files = listFiles(dist);
		expect(files.map((file) => file.path)).toEqual([
			"assets/index.module.js",
			"index.html",
		]);
		expect(checkSizes(files).problems).toEqual([]);
	});

	it("fail a file over 3 MB", () => {
		const dist = join(workspace, "big-file");
		writeSized(join(dist, "assets", "huge.module.js"), MAX_FILE_BYTES + 1);
		expect(checkSizes(listFiles(dist)).problems).toEqual([
			"assets/huge.module.js is 3.00 MB, over the 3.00 MB per-file budget",
		]);
	});

	it("fail a version over 10 MB made of files under 3 MB", () => {
		const dist = join(workspace, "big-version");
		for (const index of [1, 2, 3, 4]) {
			writeSized(join(dist, "assets", `part-${index}.module.js`), 2_900_000);
		}
		const result = checkSizes(listFiles(dist));
		expect(result.totalBytes).toBe(11_600_000);
		expect(result.problems).toEqual([
			"the version is 11.60 MB, over the 10.00 MB budget",
		]);
	});

	it("fail an empty build", () => {
		expect(checkSizes([]).problems).toEqual(["the build folder is empty"]);
	});
});

describe("first-load script budget", () => {
	function build(name: string, sizes: Record<string, number>, listed: object) {
		const dist = join(workspace, name, "dist");
		mkdirSync(dist, { recursive: true });
		for (const [file, bytes] of Object.entries(sizes)) {
			writeSized(join(dist, "assets", file), bytes);
		}
		writeFileSync(join(dist, "app-config.json"), JSON.stringify(listed));
		return dist;
	}

	it("is 500 kB of script for the entry chunks and what they import", () => {
		expect(MAX_FIRST_LOAD_JS_BYTES).toBe(500_000);
	});

	it("counts the entry and its static imports, not the screens loaded on demand", () => {
		const dist = build(
			"first-load-ok",
			{ "entry.js": 150_000, "vendor.js": 320_000, "screen.js": 900_000 },
			{ listSyncJS: ["assets/entry.js"], listAsyncJS: ["assets/vendor.js"] },
		);
		expect(checkFirstLoad(dist)).toEqual({ bytes: 470_000, problems: [] });
	});

	it("fails a single bundle that holds every screen", () => {
		const dist = build(
			"first-load-heavy",
			{ "index.js": 664_000 },
			{ listSyncJS: ["assets/index.js"], listAsyncJS: [] },
		);
		expect(checkFirstLoad(dist).problems).toEqual([
			"the first screen loads 664 kB of script, over the 500 kB budget; load screens that are not the home screen on demand",
		]);
	});

	it("fails a listed script that is missing from the build", () => {
		const dist = build(
			"first-load-gone",
			{},
			{
				listSyncJS: ["assets/gone.js"],
				listAsyncJS: [],
			},
		);
		expect(checkFirstLoad(dist).problems).toEqual([
			"assets/gone.js is listed as a first-load script but is not in the build",
		]);
	});

	it("skips a folder without app-config.json", () => {
		expect(checkFirstLoad(join(workspace, "no-config"))).toEqual({
			bytes: 0,
			problems: [],
		});
	});

	it("makes the command exit 1 and name the budget", () => {
		const app = fixtureApp("cli-first-load");
		const dist = join(app, "dist");
		writeSized(join(dist, "assets", "index.js"), 600_000);
		writeFileSync(
			join(dist, "app-config.json"),
			JSON.stringify({ listSyncJS: ["assets/index.js"], listAsyncJS: [] }),
		);
		const result = runCli(["--app", app, "--dist", "dist"]);
		expect(result.status).toBe(1);
		expect(result.output).toContain("the first screen loads 600 kB of script");
	});
});

describe("forbidden packages", () => {
	it("are ECharts and its renderer", () => {
		expect(FORBIDDEN_PACKAGES).toEqual(["echarts", "zrender"]);
	});

	it("are found anywhere in the runtime dependency graph", () => {
		expect(
			findForbiddenPackages(fixtureApp("with-echarts", "echarts")),
		).toEqual(["fixture-with-echarts > chart-wrapper > echarts"]);
	});

	it("ignore development dependencies of the app", () => {
		expect(findForbiddenPackages(fixtureApp("clean"))).toEqual([]);
	});

	it.each(["zalo-staff", "zalo-customer"])("are absent from %s", (app) => {
		expect(findForbiddenPackages(join(repoRoot, "apps", app))).toEqual([]);
	});

	it("are present in the web app, so the check can see them", () => {
		expect(findForbiddenPackages(join(repoRoot, "apps", "web"))).toContain(
			"@fnb/web > echarts",
		);
	});
});

describe("budget command", () => {
	it("exits 0 for a build within budget", () => {
		const app = fixtureApp("cli-ok");
		writeSized(join(app, "dist", "index.html"), 400);
		const result = runCli(["--app", app, "--dist", "dist"]);
		expect(result.status).toBe(0);
		expect(result.output).toContain("budget: dist: 1 files");
	});

	it("exits 1 for a throwaway build over budget or with ECharts", () => {
		const app = fixtureApp("cli-fail", "echarts");
		writeSized(
			join(app, "dist", "assets", "huge.module.js"),
			MAX_FILE_BYTES + 1,
		);
		const result = runCli(["--app", app, "--dist", "dist"]);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			"a forbidden package is in the dependency graph: fixture-cli-fail > chart-wrapper > echarts",
		);
		expect(result.output).toContain("over the 3.00 MB per-file budget");
	});

	it("exits 1 when the build folder is missing", () => {
		const result = runCli([
			"--app",
			fixtureApp("cli-missing"),
			"--dist",
			"dist",
		]);
		expect(result.status).toBe(1);
		expect(result.output).toContain("dist does not exist; build first");
	});
});

describe("paint budget", () => {
	it("is an LCP under 2.5 s and a page load under 1.5 s", () => {
		expect(MAX_LCP_MS).toBe(2500);
		expect(MAX_LOAD_MS).toBe(1500);
		expect(paintBudgetProblems({ lcpMs: 1400, loadMs: 1100 })).toEqual([]);
	});

	it("fails a throwaway measurement over budget or missing", () => {
		expect(paintBudgetProblems({ lcpMs: 2500, loadMs: 1600 })).toEqual([
			"largest contentful paint took 2500 ms, budget under 2500 ms",
			"the page load took 1600 ms, budget under 1500 ms",
		]);
		expect(paintBudgetProblems({ lcpMs: Number.NaN, loadMs: 0 })).toEqual([
			"no largest contentful paint was recorded",
			"no page load was recorded",
		]);
	});
});
