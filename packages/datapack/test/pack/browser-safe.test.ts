// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(import.meta.dirname, "..", "..", "src");

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sourceFiles(join(directory, entry.name))
			: entry.name.endsWith(".ts")
				? [join(directory, entry.name)]
				: [],
	);
}

const NODE_ONLY = [
	/from\s+["']node:/,
	/from\s+["'](?:fs|path|os|crypto|child_process|url)["']/,
	/from\s+["']postgres["']/,
	/\bprocess\./,
	/\bBuffer\b/,
	/\brequire\(/,
];

describe("@fnb/datapack in a browser", () => {
	it("imports both entry points under jsdom", async () => {
		expect(typeof window).toBe("object");
		const main = await import("../../src/index.js");
		const testing = await import("../../src/testing/index.js");
		expect(main.DATA_PACK_FORMAT).toBe("fnb-datapack");
		expect(typeof main.dataPackSchema.safeParse).toBe("function");
		expect(typeof testing.samplePlan).toBe("function");
	});

	it("uses no Node API and no database driver under src", () => {
		const offenders = sourceFiles(sourceRoot).filter((file) => {
			const text = readFileSync(file, "utf8");
			return NODE_ONLY.some((pattern) => pattern.test(text));
		});
		expect(offenders).toEqual([]);
	});
});
