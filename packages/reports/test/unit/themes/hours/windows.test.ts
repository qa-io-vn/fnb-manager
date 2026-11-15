import { describe, expect, it } from "vitest";
import {
	hourRows,
	levelWindows,
	summaryRow,
	weekdayRows,
	windowText,
} from "../../../../src/themes/hours/support.js";
import {
	dayProfile,
	profileRow,
	profileSummary,
	weekdayRow,
} from "./support.js";

function shape(rows: Parameters<typeof levelWindows>[0]) {
	return levelWindows(rows).map((window) => [
		window.level,
		window.fromHour,
		window.toHour,
		window.hours.length,
	]);
}

describe("the Giờ & ngày hour rows", () => {
	it("keeps one scope's hours in day order, past midnight, without the summary row", () => {
		const summary = profileSummary("all", { peak_share: 0.4 });
		const rows = [
			profileRow({ hour_local: 0, hour_position: 18 }),
			profileRow({ hour_local: 22, hour_position: 16 }),
			summary,
			profileRow({ hour_local: 6, hour_position: 0 }),
			profileRow({ scope: "weekdays", hour_local: 7, hour_position: 1 }),
			profileRow({ hour_local: 23, hour_position: 17 }),
		];
		expect(hourRows(rows, "all").map((row) => row.hour_local)).toEqual([
			6, 22, 23, 0,
		]);
		expect(hourRows(rows, "weekdays").map((row) => row.hour_local)).toEqual([
			7,
		]);
		expect(hourRows(rows, "weekend")).toEqual([]);
		expect(summaryRow(rows, "all")).toBe(summary);
		expect(summaryRow(rows, "weekend")).toBeUndefined();
	});

	it("orders the weekday rows Monday to Sunday and ignores other scopes", () => {
		const rows = [
			weekdayRow(7, 6_000_000),
			weekdayRow(1, 4_000_000),
			profileSummary("all"),
			profileRow({ hour_local: 9 }),
			weekdayRow(3, 5_000_000),
		];
		expect(weekdayRows(rows).map((row) => row.weekday)).toEqual([1, 3, 7]);
	});
});

describe("the Giờ & ngày level windows", () => {
	it("merges consecutive hours of one level and wraps the end past midnight", () => {
		const rows = dayProfile(
			"weekdays",
			21,
			[
				{ level: "busy" },
				{ level: "busy" },
				{ level: "busy" },
				{ level: "busy" },
				{ level: "quiet" },
			],
			15,
		);
		expect(shape(rows)).toEqual([
			["busy", 21, 1, 4],
			["quiet", 1, 2, 1],
		]);
		const first = levelWindows(rows)[0];
		expect(first === undefined ? null : windowText(first)).toBe("21:00–01:00");
	});

	it("merges tied hours of the same level but splits a run at a missing position or an hour without a level", () => {
		const rows = [
			profileRow({
				scope: "weekdays",
				hour_local: 8,
				hour_position: 2,
				level: "busy",
				avg_invoices: 18,
			}),
			profileRow({
				scope: "weekdays",
				hour_local: 9,
				hour_position: 3,
				level: "busy",
				avg_invoices: 18,
			}),
			profileRow({
				scope: "weekdays",
				hour_local: 11,
				hour_position: 5,
				level: "busy",
			}),
			profileRow({
				scope: "weekdays",
				hour_local: 12,
				hour_position: 6,
				level: null,
			}),
			profileRow({
				scope: "weekdays",
				hour_local: 13,
				hour_position: 7,
				level: "busy",
			}),
		];
		expect(shape(rows)).toEqual([
			["busy", 8, 10, 2],
			["busy", 11, 12, 1],
			["busy", 13, 14, 1],
		]);
	});

	it("gives a flat day a single window", () => {
		const rows = dayProfile(
			"weekend",
			8,
			Array.from({ length: 6 }, () => ({ level: "normal" as const })),
		);
		expect(shape(rows)).toEqual([["normal", 8, 14, 6]]);
	});

	it("keeps the two peaks of a two-peak day apart", () => {
		const rows = dayProfile("all", 7, [
			{ level: "normal" },
			{ level: "peak" },
			{ level: "peak" },
			{ level: "normal" },
			{ level: "normal" },
			{ level: "peak" },
			{ level: "peak" },
			{ level: "normal" },
		]);
		expect(shape(rows)).toEqual([
			["normal", 7, 8, 1],
			["peak", 8, 10, 2],
			["normal", 10, 12, 2],
			["peak", 12, 14, 2],
			["normal", 14, 15, 1],
		]);
		expect(windowText({ fromHour: 8, toHour: 10 })).toBe("08:00–10:00");
	});

	it("finds no window without hours", () => {
		expect(levelWindows([])).toEqual([]);
	});
});
