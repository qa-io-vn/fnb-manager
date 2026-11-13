import {
	coverageCall,
	coverageModel,
	dayReport,
	runReport,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { createDemoAnalyticsSource } from "../../src/index.js";
import {
	SMOKE_NOW,
	STORE_SELECTIONS,
	smokeContext,
	unknownKeys,
} from "./report-keys.js";

describe("Ngày on the demo engine", () => {
	for (const stores of STORE_SELECTIONS) {
		it(`builds every visible card for ${stores.join(" + ")}`, async () => {
			const source = createDemoAnalyticsSource({
				now: () => SMOKE_NOW,
				validateRows: true,
			});
			const context = smokeContext("day", stores);
			const cards = await runReport(dayReport, context, source);
			const coverage = coverageModel(
				await source.call("store_coverage", coverageCall(context).args),
				context,
			);
			const visible = dayReport.cards.filter((card) =>
				card.visible({ context, coverage }),
			);
			expect(coverage.rows.map((row) => row.store_id)).toEqual([...stores]);
			expect(cards.map((card) => card.id)).toEqual(
				visible.map((card) => card.id),
			);
			expect(
				cards.every((card) => card.markers.verification === "sample"),
			).toBe(true);
			expect(unknownKeys(cards, "report.day.")).toEqual([]);
		});
	}
});
