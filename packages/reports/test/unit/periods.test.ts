import { describe, expect, it } from "vitest";
import {
	FIRST_CALENDAR_DATE,
	isoWeekOf,
	isoWeeksInYear,
	mondayOfIsoWeek,
	parsePeriodKey,
	periodContaining,
	stepPeriod,
	switchKind,
} from "../../src/index.js";

const AS_OF = "2026-11-03";

describe("ISO weeks", () => {
	it.each([
		["2026-12-28", 2026, 53],
		["2027-01-03", 2026, 53],
		["2027-01-04", 2027, 1],
		["2024-12-30", 2025, 1],
		["2025-12-28", 2025, 52],
		["2026-01-01", 2026, 1],
		["2021-01-03", 2020, 53],
	])("%s is in ISO week %i-W%i", (date, isoYear, isoWeek) => {
		expect(isoWeekOf(date)).toEqual({ isoYear, isoWeek });
	});

	it("counts 53 weeks in 2026 and 2020 and 52 in 2025", () => {
		expect(isoWeeksInYear(2026)).toBe(53);
		expect(isoWeeksInYear(2020)).toBe(53);
		expect(isoWeeksInYear(2025)).toBe(52);
	});

	it("finds the Monday of a week", () => {
		expect(mondayOfIsoWeek(2026, 1)).toBe("2025-12-29");
		expect(mondayOfIsoWeek(2026, 53)).toBe("2026-12-28");
		expect(mondayOfIsoWeek(2025, 1)).toBe("2024-12-30");
	});
});

describe("periodContaining", () => {
	it("builds a day", () => {
		expect(periodContaining("day", "2026-11-01", AS_OF)).toEqual({
			kind: "day",
			key: "2026-11-01",
			from: "2026-11-01",
			to: "2026-11-01",
			end: "2026-11-01",
			asOf: AS_OF,
			complete: true,
			elapsedDays: 1,
			totalDays: 1,
		});
	});

	it("builds a week to date", () => {
		const week = periodContaining("week", AS_OF, AS_OF);
		expect(week).toMatchObject({
			key: "2026-W45",
			from: "2026-11-02",
			to: "2026-11-08",
			end: AS_OF,
			complete: false,
			elapsedDays: 2,
			totalDays: 7,
		});
	});

	it("builds a complete month and a year to date", () => {
		expect(periodContaining("month", "2026-02-10", AS_OF)).toMatchObject({
			key: "2026-02",
			from: "2026-02-01",
			to: "2026-02-28",
			complete: true,
			elapsedDays: 28,
			totalDays: 28,
		});
		expect(periodContaining("year", AS_OF, AS_OF)).toMatchObject({
			key: "2026",
			from: "2026-01-01",
			to: "2026-12-31",
			end: AS_OF,
			complete: false,
			elapsedDays: 307,
			totalDays: 365,
		});
	});

	it("labels the week of a year boundary with the ISO year", () => {
		expect(periodContaining("week", "2027-01-02", "2027-02-01").key).toBe(
			"2026-W53",
		);
	});
});

describe("parsePeriodKey", () => {
	it("parses each kind", () => {
		expect(parsePeriodKey("day", "2026-11-01", AS_OF)?.from).toBe("2026-11-01");
		expect(parsePeriodKey("week", "2026-W44", AS_OF)?.from).toBe("2026-10-26");
		expect(parsePeriodKey("month", "2026-10", AS_OF)?.to).toBe("2026-10-31");
		expect(parsePeriodKey("year", "2025", AS_OF)?.to).toBe("2025-12-31");
	});

	it.each([
		["day", "2026-02-30"],
		["day", "2026-1-01"],
		["week", "2025-W53"],
		["week", "2026-W00"],
		["month", "2026-13"],
		["year", "26"],
		["day", "2022-12-31"],
		["year", "2022"],
	] as const)("rejects %s key %s", (kind, key) => {
		expect(parsePeriodKey(kind, key, AS_OF)).toBeNull();
	});

	it("returns the period of the as-of day for a future key", () => {
		expect(parsePeriodKey("day", "2026-11-04", AS_OF)?.key).toBe(AS_OF);
		expect(parsePeriodKey("month", "2027-01", AS_OF)?.key).toBe("2026-11");
	});

	it("accepts the first calendar date", () => {
		expect(parsePeriodKey("day", FIRST_CALENDAR_DATE, AS_OF)).not.toBeNull();
	});
});

describe("stepPeriod and switchKind", () => {
	it("steps across the ISO year boundary and back", () => {
		const first = parsePeriodKey("week", "2026-W01", AS_OF);
		if (first === null) throw new Error("week did not parse");
		const previous = stepPeriod(first, -1);
		expect(previous?.key).toBe("2025-W52");
		expect(previous && stepPeriod(previous, 1)?.key).toBe("2026-W01");
	});

	it("stops at the as-of period and before the first calendar date", () => {
		expect(stepPeriod(periodContaining("day", AS_OF, AS_OF), 1)).toBeNull();
		expect(stepPeriod(periodContaining("month", AS_OF, AS_OF), 1)).toBeNull();
		expect(
			stepPeriod(periodContaining("day", FIRST_CALENDAR_DATE, AS_OF), -1),
		).toBeNull();
	});

	it("switches to the period of another kind that contains the end", () => {
		const month = periodContaining("month", "2026-10-15", AS_OF);
		expect(switchKind(month, "week").key).toBe("2026-W44");
		expect(switchKind(month, "day").key).toBe("2026-10-31");
		expect(
			switchKind(periodContaining("year", AS_OF, AS_OF), "month").key,
		).toBe("2026-11");
	});
});
