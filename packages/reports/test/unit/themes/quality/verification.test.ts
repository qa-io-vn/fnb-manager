import { describe, expect, it } from "vitest";
import type { IsoDate } from "../../../../src/contract/values.js";
import { addDays } from "../../../../src/period/dates.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import { buildVerificationCard } from "../../../../src/themes/quality/cards/verification.js";
import { qualityTheme } from "../../../../src/themes/quality/definition.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import {
	daysGrain,
	qualityCalls,
} from "../../../../src/themes/quality/support.js";
import {
	type RangeSeriesGrain,
	rangeOf,
	SERIES_ROW_LIMIT,
} from "../../../../src/themes/range.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { THEME_AS_OF, themeContext } from "../fixtures.js";
import { type CoverageRow, cardInput, dayRow } from "./support.js";

const STORE_C = "55555555-5555-4555-8555-555555555555";

function dayNumber(date: IsoDate): number {
	return (
		Date.UTC(
			Number(date.slice(0, 4)),
			Number(date.slice(5, 7)) - 1,
			Number(date.slice(8, 10)),
		) / 86_400_000
	);
}

function isoWeekday(date: IsoDate): number {
	return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function bucketCount(grain: RangeSeriesGrain, from: IsoDate, to: IsoDate) {
	switch (grain) {
		case "day":
			return dayNumber(to) - dayNumber(from) + 1;
		case "week":
			return (
				(dayNumber(to) -
					isoWeekday(to) -
					(dayNumber(from) - isoWeekday(from))) /
					7 +
				1
			);
		case "month":
			return (
				Number(to.slice(0, 4)) * 12 +
				Number(to.slice(5, 7)) -
				(Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) +
				1
			);
	}
}

function contextOver(days: number, storeIds: readonly string[]): ThemeContext {
	const base = themeContext("28d", storeIds);
	return {
		...base,
		range: rangeOf(addDays(THEME_AS_OF, -(days - 1)), THEME_AS_OF, THEME_AS_OF),
	};
}

function card(
	context: ThemeContext,
	days: readonly unknown[],
	coverage: readonly CoverageRow[],
) {
	return buildVerificationCard(
		cardInput(context, { [qualityCalls.days]: days }, coverage),
	);
}

describe("the Chất lượng dữ liệu days call", () => {
	it("plans its six calls and asks for every store's days, daily while the rows fit", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const days = qualityTheme
			.primaryCalls(context)
			.find((call) => call.key === qualityCalls.days);
		expect(days?.name).toBe("period_series");
		expect(days?.args).toEqual({
			store_ids: [STORE_A, STORE_B],
			grain: "day",
			from_date: context.range.from,
			to_date: context.range.to,
			include_stores: true,
		});
		expect(
			qualityTheme.primaryCalls(context).map((call) => [call.key, call.name]),
		).toEqual([
			["coverage", "store_coverage"],
			["days", "period_series"],
			["items", "data_quality_items"],
			["summary", "data_quality_summary"],
			["payments", "data_quality_payments"],
			["margins", "item_margins"],
		]);
	});

	it("turns weekly at 301 days for 2 stores and 226 days for 3, and never needs more than 900 rows up to 400 days", () => {
		const two = [STORE_A, STORE_B];
		const three = [STORE_A, STORE_B, STORE_C];
		expect(daysGrain(contextOver(300, two))).toBe("day");
		expect(daysGrain(contextOver(301, two))).toBe("week");
		expect(daysGrain(contextOver(225, three))).toBe("day");
		expect(daysGrain(contextOver(226, three))).toBe("week");
		for (const stores of [[STORE_A], two, three]) {
			for (const days of [7, 28, 91, 225, 226, 300, 301, 364, 400]) {
				const context = contextOver(days, stores);
				const grain = daysGrain(context);
				const rows =
					bucketCount(grain, context.range.from, context.range.to) *
					(stores.length + 1);
				expect(
					rows,
					`${stores.length} stores, ${days} days`,
				).toBeLessThanOrEqual(SERIES_ROW_LIMIT);
			}
		}
	});
});

describe("the Chất lượng dữ liệu verification card", () => {
	it("counts the unverified store-days from the coverage and lists each day with its state and the sync hint, leaving out a day without invoices as the coverage does", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const model = card(
			context,
			[
				dayRow(null, "2026-10-20", { checked_days: 1, matched_days: 0 }),
				dayRow(STORE_A, "2026-10-20", { checked_days: 1, matched_days: 0 }),
				dayRow(STORE_B, "2026-10-21", { checked_days: 0, matched_days: 0 }),
				dayRow(STORE_B, "2026-10-22", {
					checked_days: 0,
					matched_days: 0,
					invoices: 0,
				}),
				dayRow(STORE_A, "2026-10-23"),
			],
			[
				coverageRow(STORE_A, { unmatched_days: 1 }),
				coverageRow(STORE_B, { unchecked_sales_days: 1 }),
			],
		);
		expect(model.headline.value).toBe(2);
		expect(model.narrative).toEqual([
			{
				key: qualityKeys.verification.main,
				values: {
					range: expect.anything(),
					count: { kind: "count", value: 2 },
					notMatched: { kind: "count", value: 1 },
					notChecked: { kind: "count", value: 1 },
				},
			},
		]);
		expect(model.tables[0]?.columns.map((column) => column.key)).toEqual([
			"store",
			"date",
			"state",
			"fix",
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 2",
				date: "2026-10-21",
				state: qualityKeys.state.notChecked,
				fix: qualityKeys.fix.syncDay,
			},
			{
				store: "Store 1",
				date: "2026-10-20",
				state: qualityKeys.state.notMatched,
				fix: qualityKeys.fix.syncDay,
			},
		]);
		expect(model.notice?.part.key).toBe(qualityKeys.verification.notice);
		expect(model.markers.verification).toBe("unverified");
	});

	it("adds the days still updating per store with the wait hint, apart from the unverified count", () => {
		const context = themeContext("28d", [STORE_A]);
		const model = card(
			context,
			[dayRow(STORE_A, "2026-10-20")],
			[coverageRow(STORE_A, { stale_days: 2 })],
		);
		expect(model.headline.value).toBe(0);
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.verification.none,
			qualityKeys.verification.updating,
		]);
		expect(model.narrative[1]?.values.count).toEqual({
			kind: "count",
			value: 2,
		});
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				date: null,
				state: qualityKeys.state.updating,
				fix: qualityKeys.fix.waitRefresh,
			},
		]);
		expect(model.notice).toBeNull();
	});

	it("shows week buckets with their first and last day and the number of days over long ranges", () => {
		const context = contextOver(364, [STORE_A, STORE_B]);
		expect(daysGrain(context)).toBe("week");
		const model = card(
			context,
			[
				dayRow(STORE_A, "2026-10-19", {
					bucket_end: "2026-10-25",
					calendar_days: 7,
					days_with_data: 7,
					checked_days: 5,
					matched_days: 4,
				}),
			],
			[
				coverageRow(STORE_A, { unmatched_days: 1, unchecked_sales_days: 2 }),
				coverageRow(STORE_B),
			],
		);
		expect(model.headline.value).toBe(3);
		expect(model.tables[0]?.columns.map((column) => column.key)).toEqual([
			"store",
			"from",
			"to",
			"days",
			"state",
			"fix",
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				from: "2026-10-19",
				to: "2026-10-25",
				days: 1,
				state: qualityKeys.state.notMatched,
				fix: qualityKeys.fix.syncDays,
			},
			{
				store: "Store 1",
				from: "2026-10-19",
				to: "2026-10-25",
				days: 2,
				state: qualityKeys.state.notChecked,
				fix: qualityKeys.fix.syncDays,
			},
		]);
	});

	it("says plainly that the range has no day with sales instead of calling every day verified", () => {
		const model = card(
			themeContext("28d", [STORE_A]),
			[dayRow(STORE_A, "2026-10-20", { invoices: 0, checked_days: 0 })],
			[
				coverageRow(STORE_A, {
					sales_days: 0,
					checked_days: 0,
					matched_days: 0,
				}),
			],
		);
		expect(model.headline.value).toBeNull();
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.verification.noData,
		]);
		expect(model.tables).toEqual([]);
	});

	it("says every day is verified, with no table", () => {
		const model = card(
			themeContext("28d", [STORE_A]),
			[dayRow(STORE_A, "2026-10-20")],
			[coverageRow(STORE_A)],
		);
		expect(model.headline.value).toBe(0);
		expect(model.narrative[0]?.key).toBe(qualityKeys.verification.none);
		expect(model.tables).toEqual([]);
		expect(model.markers.verification).toBe("verified");
	});
});
