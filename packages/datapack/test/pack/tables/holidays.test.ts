import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource } from "../support/sources.js";

describe("the calendar table", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		built = await buildWith(
			overriddenSource(demoSource(), {
				holiday_calendar: (rows) => [
					{
						holiday_date: "2027-01-01",
						name: "Ngày riêng của quán",
						kind: "custom",
					},
					...rows,
					{
						holiday_date: "2027-01-01",
						name: "New Year's Day",
						kind: "public",
					},
					{ holiday_date: "2027-02-06", name: "Khai trương", kind: "custom" },
					{ holiday_date: "2026-12-24", name: "Giáng sinh", kind: "custom" },
				],
			}),
			demoRequest(),
		);
	});

	it("merges the holidays of one date into one row", () => {
		const rows = built.pack.tables.calendar?.rows ?? {};
		expect(rows["ALL/2027-01-01"]).toEqual([
			"New Year's Day; Ngày riêng của quán",
			"public",
			"fri",
			51,
		]);
		expect(rows["ALL/2027-02-06"]).toEqual([
			"Khai trương; Tet, day 1",
			"tet",
			"sat",
			87,
		]);
		expect(rows["ALL/2026-12-24"]).toEqual(["Giáng sinh", "custom", "thu", 43]);
		expect(Object.keys(rows)).toHaveLength(7);
	});

	it("covers the plan horizon", () => {
		const { horizon } = built.pack.calendar;
		expect(built.pack.tables.calendar?.window).toBe("horizon");
		for (const key of Object.keys(built.pack.tables.calendar?.rows ?? {})) {
			const date = key.slice(4);
			expect(date >= horizon.from && date <= horizon.to).toBe(true);
		}
	});
});
