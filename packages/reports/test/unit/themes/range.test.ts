import { describe, expect, it } from "vitest";
import {
	canStepRange,
	customRange,
	MAX_THEME_RANGE_DAYS,
	moveRangeToLimit,
	NAMED_PRESETS,
	rangeOf,
	rangeOfPreset,
	rangeSearch,
	resolveRange,
	SHIFT_THEME_RANGE_DAYS,
	seriesGrain,
	stepRange,
} from "../../../src/themes/range.js";

const AS_OF = "2026-11-06";
const LIMITS = { defaultPreset: "28d" as const, maxDays: MAX_THEME_RANGE_DAYS };

describe("rangeOfPreset", () => {
	it("lays out the rolling presets with the range just before and the same weekdays 52 weeks earlier", () => {
		expect(rangeOfPreset("7d", AS_OF)).toEqual({
			preset: "7d",
			key: "2026-10-31_2026-11-06",
			from: "2026-10-31",
			to: AS_OF,
			asOf: AS_OF,
			days: 7,
			previous: { from: "2026-10-24", to: "2026-10-30" },
			lastYear: { from: "2025-11-01", to: "2025-11-07" },
		});
		const fourWeeks = rangeOfPreset("28d", AS_OF);
		expect(fourWeeks).toMatchObject({
			from: "2026-10-10",
			days: 28,
			previous: { from: "2026-09-12", to: "2026-10-09" },
			lastYear: { from: "2025-10-11", to: "2025-11-07" },
		});
		expect(rangeOfPreset("91d", AS_OF)).toMatchObject({
			from: "2026-08-08",
			days: 91,
			previous: { from: "2026-05-09", to: "2026-08-07" },
		});
	});

	it("gives 52 weeks a single reference, because the 364 days before are also last year", () => {
		const range = rangeOfPreset("364d", AS_OF);
		expect(range).toMatchObject({
			from: "2025-11-08",
			days: 364,
			previous: { from: "2024-11-09", to: "2025-11-07" },
			lastYear: null,
		});
	});

	it("uses the period rules for this month: the same elapsed days, clipped to the shorter month", () => {
		expect(rangeOfPreset("this_month", "2026-03-31")).toMatchObject({
			from: "2026-03-01",
			to: "2026-03-31",
			days: 31,
			previous: { from: "2026-02-01", to: "2026-02-28" },
			lastYear: { from: "2025-03-01", to: "2025-03-31" },
		});
		expect(rangeOfPreset("this_month", "2028-02-29")).toMatchObject({
			previous: { from: "2028-01-01", to: "2028-01-29" },
			lastYear: { from: "2027-02-01", to: "2027-02-28" },
		});
	});

	it("takes the whole previous month for last month, against the month before and the same month a year earlier", () => {
		expect(rangeOfPreset("last_month", "2026-03-01")).toMatchObject({
			from: "2026-02-01",
			to: "2026-02-28",
			days: 28,
			previous: { from: "2026-01-01", to: "2026-01-31" },
			lastYear: { from: "2025-02-01", to: "2025-02-28" },
		});
		expect(rangeOfPreset("last_month", "2029-03-15")).toMatchObject({
			lastYear: { from: "2028-02-01", to: "2028-02-29" },
		});
	});

	it("compares this year with the same elapsed days of last year, as one chip", () => {
		expect(rangeOfPreset("this_year", "2028-12-31")).toMatchObject({
			from: "2028-01-01",
			days: 366,
			previous: { from: "2027-01-01", to: "2027-12-31" },
			lastYear: null,
		});
	});

	it("keys every range by its dates", () => {
		for (const preset of NAMED_PRESETS) {
			const range = rangeOfPreset(preset, AS_OF);
			expect(range.key).toBe(`${range.from}_${range.to}`);
		}
	});
});

describe("customRange and rangeOf", () => {
	it("compares a custom range with the same number of days just before and 364 days earlier", () => {
		expect(customRange("2026-10-08", "2026-11-06", AS_OF)).toMatchObject({
			preset: "custom",
			days: 30,
			previous: { from: "2026-09-08", to: "2026-10-07" },
			lastYear: { from: "2025-10-09", to: "2025-11-07" },
		});
	});

	it("names a range after the preset it equals", () => {
		expect(rangeOf("2026-10-10", AS_OF, AS_OF).preset).toBe("28d");
		expect(rangeOf("2026-10-01", "2026-10-31", AS_OF).preset).toBe(
			"last_month",
		);
		expect(rangeOf("2026-10-01", "2026-10-30", AS_OF).preset).toBe("custom");
	});

	it("counts ranges across ISO week 53 and a leap day by their dates", () => {
		expect(customRange("2026-12-28", "2027-01-03", "2027-01-10").days).toBe(7);
		expect(customRange("2028-02-28", "2028-03-01", "2028-03-10").days).toBe(3);
	});
});

describe("resolveRange", () => {
	it("falls back to the default preset without parameters", () => {
		expect(resolveRange({}, AS_OF, LIMITS)).toMatchObject({
			range: { preset: "28d" },
			rangeClamped: false,
			todayClamped: false,
			invalid: false,
		});
	});

	it("reads a preset and a custom pair, and round-trips both through the search parameters", () => {
		const preset = resolveRange({ preset: "91d" }, AS_OF, LIMITS).range;
		expect(rangeSearch(preset)).toEqual({ range: "91d" });
		const custom = resolveRange(
			{ from: "2026-10-08", to: "2026-11-06" },
			AS_OF,
			LIMITS,
		).range;
		expect(rangeSearch(custom)).toEqual({
			from: "2026-10-08",
			to: "2026-11-06",
		});
		expect(
			resolveRange({ preset: rangeSearch(preset).range ?? null }, AS_OF, LIMITS)
				.range,
		).toEqual(preset);
		expect(resolveRange(rangeSearch(custom), AS_OF, LIMITS).range).toEqual(
			custom,
		);
	});

	it("keeps the last days of a range longer than the theme allows", () => {
		const long = resolveRange(
			{ from: "2025-01-01", to: "2026-11-06" },
			AS_OF,
			LIMITS,
		);
		expect(long.rangeClamped).toBe(true);
		expect(long.range.days).toBe(MAX_THEME_RANGE_DAYS);
		expect(long.range.to).toBe(AS_OF);
		const shifts = resolveRange({ preset: "364d" }, AS_OF, {
			defaultPreset: "28d",
			maxDays: SHIFT_THEME_RANGE_DAYS,
		});
		expect(shifts).toMatchObject({
			rangeClamped: true,
			range: { preset: "custom", days: SHIFT_THEME_RANGE_DAYS, to: AS_OF },
		});
	});

	it("clamps an end after the as-of day and says so", () => {
		expect(
			resolveRange({ from: "2026-10-20", to: "2026-11-30" }, AS_OF, LIMITS),
		).toMatchObject({
			todayClamped: true,
			range: { from: "2026-10-20", to: AS_OF },
		});
	});

	it.each([
		[{ preset: "30d" }],
		[{ from: "2022-12-31", to: "2023-01-10" }],
		[{ from: "2026-11-01", to: "2026-10-01" }],
		[{ from: "2026-02-30", to: "2026-03-10" }],
		[{ from: "2026-11-01" }],
		[{ from: "2026-11-10", to: "2026-11-20" }],
	])("replaces %j with the default preset", (request) => {
		expect(resolveRange(request, AS_OF, LIMITS)).toMatchObject({
			invalid: true,
			range: { preset: "28d" },
		});
	});
});

describe("stepRange", () => {
	it("moves a rolling range by its length and back to the preset", () => {
		const back = stepRange(rangeOfPreset("28d", AS_OF), -1);
		expect(back).toMatchObject({
			preset: "custom",
			from: "2026-09-12",
			to: "2026-10-09",
		});
		expect(stepRange(back, 1).preset).toBe("28d");
	});

	it("moves calendar presets by a month or a year, clipped at the as-of day", () => {
		const lastMonth = stepRange(rangeOfPreset("this_month", AS_OF), -1);
		expect(lastMonth).toMatchObject({
			preset: "last_month",
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(stepRange(lastMonth, -1)).toMatchObject({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(stepRange(lastMonth, 1).preset).toBe("this_month");
		expect(stepRange(rangeOfPreset("this_year", AS_OF), -1)).toMatchObject({
			from: "2025-01-01",
			to: "2025-12-31",
		});
	});

	it("disables next at the as-of day and previous before the first calendar date", () => {
		const current = rangeOfPreset("7d", AS_OF);
		expect(canStepRange(current, 1)).toBe(false);
		expect(stepRange(current, 1)).toBe(current);
		const first = customRange("2023-01-01", "2023-01-07", AS_OF);
		expect(canStepRange(first, -1)).toBe(false);
	});

	it("keeps the last days when moving to a theme with a shorter maximum", () => {
		const year = rangeOfPreset("364d", AS_OF);
		expect(moveRangeToLimit(year, SHIFT_THEME_RANGE_DAYS)).toMatchObject({
			days: SHIFT_THEME_RANGE_DAYS,
			to: AS_OF,
		});
		const week = rangeOfPreset("7d", AS_OF);
		expect(moveRangeToLimit(week, SHIFT_THEME_RANGE_DAYS)).toBe(week);
	});
});

describe("seriesGrain", () => {
	it("keeps days while days times the stores and the total fit 900 rows", () => {
		expect(seriesGrain(225, 3, true, "day")).toBe("day");
		expect(seriesGrain(226, 3, true, "day")).toBe("week");
		expect(seriesGrain(400, 2, true, "day")).toBe("week");
		expect(seriesGrain(300, 2, true, "day")).toBe("day");
	});

	it("moves to months when weeks would exceed the limit", () => {
		expect(seriesGrain(400, 9, true, "day")).toBe("week");
		expect(seriesGrain(400, 50, true, "day")).toBe("month");
	});

	it("never goes finer than asked and ignores stores without store rows", () => {
		expect(seriesGrain(28, 50, false, "week")).toBe("week");
		expect(seriesGrain(400, 50, false, "day")).toBe("day");
	});
});
