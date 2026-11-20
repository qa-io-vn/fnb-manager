import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AGREED_REPORTS_EXPORTS = [
	"AnalyticsArgs",
	"AnalyticsCallError",
	"AnalyticsFunctionName",
	"AnalyticsRow",
	"AnalyticsSource",
	"CardModel",
	"Comparison",
	"IsoDate",
	"ReportContext",
	"ReportStore",
	"RpcClient",
	"addDays",
	"analyticsFunctionNames",
	"argumentNames",
	"asOfDate",
	"createRpcAnalyticsSource",
	"dayReport",
	"isAnalyticsFunctionName",
	"maxDate",
	"periodContaining",
	"relativeChange",
	"runReport",
] as const;

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@fnb\/reports"/g;

function typescriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return typescriptFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

function reportsImportsOf(source: string): string[] {
	return [...source.matchAll(IMPORT)].flatMap((match) =>
		(match[1] ?? "")
			.split(",")
			.map((part) =>
				part
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0]
					?.trim(),
			)
			.filter((name): name is string => name !== undefined && name !== ""),
	);
}

describe("the @fnb/reports exports that notify may use", () => {
	it("finds every name of an import list, type-only and renamed ones included", () => {
		expect(
			reportsImportsOf(
				'import { type IsoDate, addDays as plus, dayReport } from "@fnb/reports";',
			),
		).toEqual(["IsoDate", "addDays", "dayReport"]);
		expect(
			reportsImportsOf('import type { CardModel } from "@fnb/reports";'),
		).toEqual(["CardModel"]);
		expect(reportsImportsOf('import { x } from "@fnb/core";')).toEqual([]);
	});

	it("keeps packages/notify and the notify commands of apps/jobs inside the agreed list", () => {
		const commands = join(repoRoot, "apps", "jobs", "src", "commands");
		const files = [
			...typescriptFiles(join(repoRoot, "packages", "notify", "src")),
			...readdirSync(commands)
				.filter((name) => /^(notify|digest)/.test(name) && name.endsWith(".ts"))
				.map((name) => join(commands, name)),
		];
		expect(files.length).toBeGreaterThan(10);
		const agreed = new Set<string>(AGREED_REPORTS_EXPORTS);
		const outside = files.flatMap((file) =>
			reportsImportsOf(readFileSync(file, "utf8"))
				.filter((name) => !agreed.has(name))
				.map((name) => `${name} in ${file.slice(repoRoot.length + 1)}`),
		);
		expect(outside).toEqual([]);
	});
});
