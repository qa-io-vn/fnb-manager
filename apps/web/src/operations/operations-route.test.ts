import { rangeOf } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	isOperationsPage,
	OPERATIONS_MAX_DAYS,
	operationsHref,
	operationsToday,
	parseOperationsSearch,
} from "./operations-route";

const STORES = ["store-1", "store-2"];

describe("the operations address", () => {
	it("opens on the last seven days up to today and writes the range back", () => {
		const parsed = parseOperationsSearch(
			new URLSearchParams(""),
			"2026-11-18",
			STORES,
		);
		expect(parsed.resolved.range).toMatchObject({
			preset: "7d",
			from: "2026-11-12",
			to: "2026-11-18",
		});
		expect(parsed.canonical).toBe("range=7d");
		expect(parsed.normalised).toBe(true);
	});

	it("keeps the page's filters and drops empty ones", () => {
		const parsed = parseOperationsSearch(
			new URLSearchParams("range=28d&kind=stock_out&status=&category=ve_sinh"),
			"2026-11-18",
			STORES,
		);
		expect(parsed.filters).toEqual({ kind: "stock_out", category: "ve_sinh" });
		expect(parsed.canonical).toBe("range=28d&kind=stock_out&category=ve_sinh");
	});

	it("shortens a range longer than 92 days to its last 92 days", () => {
		const parsed = parseOperationsSearch(
			new URLSearchParams("from=2026-01-01&to=2026-11-18"),
			"2026-11-18",
			STORES,
		);
		expect(parsed.resolved.rangeClamped).toBe(true);
		expect(parsed.resolved.range.days).toBe(OPERATIONS_MAX_DAYS);
		expect(parsed.resolved.range.to).toBe("2026-11-18");
	});

	it("reads the stores a link carries, ignores unknown ones and never writes them back", () => {
		const parsed = parseOperationsSearch(
			new URLSearchParams("range=7d&store=store-2,elsewhere"),
			"2026-11-18",
			STORES,
		);
		expect(parsed.storeIds).toEqual(["store-2"]);
		expect(parsed.canonical).toBe("range=7d");
		expect(
			parseOperationsSearch(
				new URLSearchParams("store=elsewhere"),
				"2026-11-18",
				STORES,
			).storeIds,
		).toBeNull();
	});

	it("builds the links of the three pages with a custom range as dates", () => {
		const range = rangeOf("2026-10-02", "2026-10-31", "2026-11-18");
		expect(operationsHref("ket-tien", range)).toBe(
			"/van-hanh/ket-tien?from=2026-10-02&to=2026-10-31",
		);
		expect(operationsHref("su-co", range, { status: "open" })).toBe(
			"/van-hanh/su-co?from=2026-10-02&to=2026-10-31&status=open",
		);
		expect(isOperationsPage("checklist")).toBe(true);
		expect(isOperationsPage("bao-cao")).toBe(false);
	});

	it("takes today as the latest business date of the stores", () => {
		const now = new Date("2026-11-18T18:30:00Z");
		expect(
			operationsToday(
				[
					{ timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 },
					{ timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 300 },
				],
				now,
			),
		).toBe("2026-11-19");
		expect(operationsToday([], now)).toBe("2026-11-18");
	});
});
