// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { lintPlan } from "../../src/index.js";
import { cleanPlan, lintPack, lintResultsText } from "./support.js";

describe("lintPlan in a browser", () => {
	it("runs under jsdom", () => {
		expect(typeof window).toBe("object");
		expect(typeof document.createElement).toBe("function");
		expect(lintPlan(cleanPlan("en"), lintPack()).ok).toBe(true);
	});

	it("gives the same results as in Node for every fixture", async () => {
		await expect(await lintResultsText()).toMatchFileSnapshot(
			"../fixtures/plans/lint/results.json",
		);
	});
});
