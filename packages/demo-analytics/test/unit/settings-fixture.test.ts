import { isExcludedDay, VIETNAM_HOLIDAYS } from "@fnb/core";
import { addDays } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import type { SeededDataset } from "../parity/harness.js";
import { customHolidayDate } from "../parity/settings-fixture.js";

function window(to: string, days: number): SeededDataset {
	return {
		dataset: { id: "D3" },
		window: { from: addDays(to, 1 - days), to },
	} as unknown as SeededDataset;
}

describe("the custom holiday of the parity settings fixture", () => {
	it("falls on a day no national holiday or Tết covers, whatever the run date", () => {
		for (const to of [
			"2026-09-10",
			"2027-01-09",
			"2027-02-13",
			"2027-02-18",
			"2027-04-24",
			"2027-05-08",
			"2026-11-16",
		]) {
			const seeded = window(to, 14);
			const date = customHolidayDate(seeded);
			expect(isExcludedDay(VIETNAM_HOLIDAYS, date), `${to} gave ${date}`).toBe(
				false,
			);
			expect(date >= seeded.window.from && date <= seeded.window.to).toBe(true);
		}
	});

	it("refuses a window with no free day", () => {
		expect(() => customHolidayDate(window("2027-02-08", 3))).toThrow(
			/no day of D3/,
		);
	});
});
