import { describe, expect, it } from "vitest";
import {
	clampReasonOf,
	parseReportSearch,
	periodParams,
	reportHref,
	reportSlugs,
} from "./report-route";
import {
	callEnd,
	distinctCalls,
	expandNeeds,
	freshnessOf,
	RECENT_STALE_TIME,
	SETTLED_STALE_TIME,
} from "./use-report";

const AS_OF = "2026-11-03";
const STORES = ["MOCK-S1", "MOCK-S2"];

function parse(kind: Parameters<typeof parseReportSearch>[0], search: string) {
	return parseReportSearch(kind, new URLSearchParams(search), AS_OF, STORES);
}

describe("report routes", () => {
	it("names the slugs and the period parameter of each report", () => {
		expect(reportSlugs).toEqual({
			day: "ngay",
			week: "tuan",
			month: "thang",
			year: "nam",
		});
		expect(periodParams).toEqual({
			day: "date",
			week: "week",
			month: "month",
			year: "year",
		});
	});

	it("reads a deep link and writes the same link back", () => {
		const day = parse("day", "date=2026-11-01&store=MOCK-S2");
		expect(day.period.key).toBe("2026-11-01");
		expect(day.storeIds).toEqual(["MOCK-S2"]);
		expect(day.normalised).toBe(false);
		expect(reportHref("day", day.period, day.storeIds)).toBe(
			"/bao-cao/ngay?date=2026-11-01&store=MOCK-S2",
		);
		for (const [kind, search] of [
			["week", "week=2026-W44"],
			["month", "month=2026-10"],
			["year", "year=2025"],
		] as const) {
			const parsed = parse(kind, search);
			expect(parsed.normalised, search).toBe(false);
			expect(reportHref(kind, parsed.period, null)).toBe(
				`/bao-cao/${reportSlugs[kind]}?${search}`,
			);
		}
	});

	it("falls back to the as-of period, to be written with replace, when the parameter is missing or invalid", () => {
		for (const search of [
			"",
			"date=",
			"date=2026-02-30",
			"date=03/11/2026",
			"date=2019-01-01",
		]) {
			const parsed = parse("day", search);
			expect(parsed.period.key, search).toBe(AS_OF);
			expect(parsed.normalised, search).toBe(true);
			expect(parsed.clampedFromFuture, search).toBe(false);
		}
		expect(parse("week", "week=2026-W54").period.key).toBe("2026-W45");
	});

	it("clamps a future period to the as-of period and says so", () => {
		const today = parse("day", "date=2026-11-04");
		expect(today.period.key).toBe(AS_OF);
		expect(today.clampedFromFuture).toBe(true);
		expect(today.clampReason).toBe("today");
		expect(today.normalised).toBe(false);
		expect(parse("month", "month=2026-12").clampedFromFuture).toBe(true);
	});

	it("tells a period that has not started from the running day, and rewrites its URL", () => {
		for (const [kind, search] of [
			["day", "date=2026-12-25"],
			["week", "week=2026-W46"],
			["month", "month=2026-12"],
			["year", "year=2027"],
		] as const) {
			const parsed = parse(kind, search);
			expect(parsed.clampReason, search).toBe("notStarted");
			expect(parsed.normalised, search).toBe(true);
		}
		expect(clampReasonOf("week", "2026-W45", AS_OF)).toBeNull();
		expect(clampReasonOf("day", "2026-11-04", AS_OF)).toBe("today");
		expect(clampReasonOf("week", "2026-W46", "2026-11-08")).toBe("today");
	});

	it("ignores unknown stores and reads none or all of them as every store", () => {
		expect(
			parse("day", "date=2026-11-03&store=MOCK-S9,MOCK-S1").storeIds,
		).toEqual(["MOCK-S1"]);
		const none = parse("day", "date=2026-11-03&store=MOCK-S9");
		expect(none.storeIds).toBeNull();
		expect(none.normalised).toBe(true);
		const all = parse("day", "date=2026-11-03&store=MOCK-S2,MOCK-S1");
		expect(all.storeIds).toBeNull();
		expect(all.normalised).toBe(true);
		expect(parse("day", "date=2026-11-03").storeIds).toBeNull();
	});

	it("keeps stepping inside the calendar and the as-of day", () => {
		const first = parse("day", "date=2023-01-01");
		expect(first.period.key).toBe("2023-01-01");
	});
});

describe("analytics freshness", () => {
	it("reads the last date of each call shape", () => {
		expect(callEnd({ args: { to_date: "2026-11-03" } })).toBe("2026-11-03");
		expect(callEnd({ args: { anchor: "2026-11-02" } })).toBe("2026-11-02");
		expect(callEnd({ args: { target_date: "2026-11-01" } })).toBe("2026-11-01");
		expect(callEnd({ args: { as_of_date: "2026-10-31" } })).toBe("2026-10-31");
		expect(callEnd({ args: { month_start: "2026-02-01" } })).toBe("2026-02-28");
		expect(callEnd({ args: { period_start: "2026-11-01" } })).toBe(
			"2026-11-01",
		);
	});

	it("keeps settled ranges for 30 minutes and recent ones for 2 with refetch on focus", () => {
		expect(
			freshnessOf({ args: { to_date: "2026-10-31" } }, AS_OF, false),
		).toEqual({
			staleTime: SETTLED_STALE_TIME,
			refetchOnWindowFocus: false,
		});
		expect(
			freshnessOf({ args: { to_date: "2026-11-02" } }, AS_OF, false),
		).toEqual({
			staleTime: RECENT_STALE_TIME,
			refetchOnWindowFocus: true,
		});
		expect(freshnessOf({ args: { anchor: AS_OF } }, AS_OF, true)).toEqual({
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
		});
	});
});

describe("card needs", () => {
	it("expands a prefix wildcard to every planned key with that prefix", () => {
		expect(
			expandNeeds(
				["coverage", "pace.*", "since.*"],
				["coverage", "pace.MOCK-S1", "pace.MOCK-S2", "paceTotal"],
			),
		).toEqual(["coverage", "pace.MOCK-S1", "pace.MOCK-S2"]);
	});
});

describe("distinctCalls", () => {
	it("shares one query between keys that plan the same call", () => {
		const compare = {
			name: "period_compare" as const,
			args: { store_ids: ["MOCK-S1"], grain: "year" as const, anchor: AS_OF },
		};
		const planned = distinctCalls([
			{ key: "compareLfl.previous", ...compare },
			{ key: "compareLfl.last_year", ...compare },
			{
				key: "coverage",
				name: "store_coverage",
				args: { store_ids: ["MOCK-S1"], from_date: AS_OF, to_date: AS_OF },
			},
		]);
		expect(planned.calls.map((call) => call.key)).toEqual([
			"compareLfl.previous",
			"coverage",
		]);
		expect([...planned.indexOf.entries()]).toEqual([
			["compareLfl.previous", 0],
			["compareLfl.last_year", 0],
			["coverage", 1],
		]);
	});
});
