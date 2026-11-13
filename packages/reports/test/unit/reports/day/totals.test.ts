import { describe, expect, it } from "vitest";
import {
	type CardModel,
	reportKeys,
	unavailableKey,
} from "../../../../src/index.js";
import {
	buildTotalsCard,
	dayKeys,
	invoicesSpec,
	netRevenueSpec,
} from "../../../../src/reports/day/index.js";
import { compareRow, coverageRow } from "../../fixtures.js";
import {
	BASELINE_ONLY,
	block,
	DAY,
	dayInput,
	EMPTY_TOTALS,
	hourProfile,
	LAST_YEAR_DAY,
	PREVIOUS_DAY,
	STORE_A,
	STORE_B,
	youngCoverage,
} from "./fixtures.js";

function chip(card: CardModel, kind: string) {
	return card.comparisons.find((entry) => entry.kind === kind);
}

describe("Ngày net revenue and invoices", () => {
	it("reads the all-stores rows and compares with the baseline, the day before and last year", () => {
		const card = buildTotalsCard(netRevenueSpec, dayInput());
		expect(card.headline).toEqual({
			value: 5_000_000,
			unit: "money",
			caption: null,
		});
		expect(card.comparisons.map((entry) => entry.kind)).toEqual([
			"baseline",
			"previous",
			"last_year",
		]);
		expect(chip(card, "baseline")?.reference).toBe(4_800_000);
		expect(chip(card, "previous")?.change).toBeCloseTo(0.25, 10);
		expect(chip(card, "last_year")?.basis).toBe("all_stores");
		expect(card.narrative[0]?.key).toBe(dayKeys.net.up);
		expect(card.narrative[0]?.values.day).toEqual({ kind: "date", value: DAY });
		expect(card.markers).toEqual({
			provisional: false,
			stale: false,
			verification: "verified",
		});
		expect(card.csvName).toBe("ngay-net-revenue-2026-11-03");
	});

	it("tabulates every store with its references and names the store that moved most", () => {
		const compare = [
			...block(null, { current: { net_amount: 9_000_000 } }),
			...block(STORE_A, {
				current: { net_amount: 6_000_000 },
				baseline: { ...BASELINE_ONLY, net_amount: 4_000_000 },
			}),
			...block(STORE_B, {
				current: { net_amount: 3_000_000 },
				baseline: { ...BASELINE_ONLY, net_amount: 3_500_000 },
			}),
		];
		const card = buildTotalsCard(netRevenueSpec, dayInput({ compare }));
		const table = card.tables[0];
		expect(table?.columns.map((column) => column.key)).toEqual([
			"store",
			"value",
			"baseline",
			"changeBaseline",
			"previous",
			"changePrevious",
			"lastYear",
			"changeLastYear",
		]);
		expect(table?.rows.map((row) => [row.id, row.cells.value])).toEqual([
			[STORE_A, 6_000_000],
			[STORE_B, 3_000_000],
		]);
		expect(table?.rows[0]?.cells.changeBaseline).toBeCloseTo(0.5, 10);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[6_000_000, 3_000_000],
			[4_000_000, 3_500_000],
		]);
		const driver = card.narrative.at(-1);
		expect(driver?.key).toBe(reportKeys.clause.driver.store);
		expect(driver?.values.store).toEqual({ kind: "text", value: "Store 1" });
		expect(driver?.values.delta).toEqual({
			kind: "moneySigned",
			value: 2_000_000,
		});
	});

	it("uses the period rows for one store and the hours for its driver", () => {
		const card = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				stores: [STORE_A],
				hourly: hourProfile({
					9: [900_000, 400_000],
					20: [1_000_000, 900_000],
				}),
			}),
		);
		expect(card.chart).toBeNull();
		expect(card.tables[0]?.rows.map((row) => row.cells.period)).toEqual([
			reportKeys.periodRow.current,
			reportKeys.periodRow.previous,
			reportKeys.periodRow.baseline,
			reportKeys.periodRow.lastYear,
		]);
		const driver = card.narrative.at(-1);
		expect(driver?.key).toBe(reportKeys.clause.driver.hour);
		expect(driver?.values.hour).toEqual({ kind: "hour", value: 9 });
	});

	it("compares last year like for like when one store is young, and says so", () => {
		const card = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				coverage: youngCoverage(),
				compareLfl: {
					last_year: [
						compareRow("current", DAY, DAY, { net_amount: 3_300_000 }),
						compareRow("last_year", LAST_YEAR_DAY, LAST_YEAR_DAY, {
							net_amount: 3_000_000,
						}),
					],
				},
			}),
		);
		const lastYear = chip(card, "last_year");
		expect(lastYear?.basis).toBe("like_for_like");
		expect(lastYear?.coveredStores).toBe(1);
		expect(lastYear?.totalStores).toBe(2);
		expect(lastYear?.change).toBeCloseTo(0.1, 10);
		expect(lastYear?.label.key).toBe(reportKeys.compare.likeForLike);
		expect(card.narrative[1]?.key).toBe(reportKeys.clause.coverage.youngStore);
		expect(card.narrative[1]?.values.date).toEqual({
			kind: "date",
			value: "2026-08-31",
		});
		const youngRow = card.tables[0]?.rows.find((row) => row.id === STORE_B);
		expect(youngRow?.cells.state).toBe(
			unavailableKey("store_too_young", "last_year"),
		);
	});

	it("shows the young state when no selected store has last year's history", () => {
		const card = buildTotalsCard(
			invoicesSpec,
			dayInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-08-31" })],
				compare: [
					...block(null, { last_year: EMPTY_TOTALS }),
					...block(STORE_B, { last_year: EMPTY_TOTALS }),
				],
			}),
		);
		const lastYear = chip(card, "last_year");
		expect(lastYear?.unavailable).toBe("store_too_young");
		expect(lastYear?.change).toBeNull();
		expect(card.tables[0]?.rows.at(-1)?.cells).toMatchObject({
			value: null,
			state: unavailableKey("store_too_young", "last_year"),
		});
		expect(card.headline.unit).toBe("count");
	});

	it("labels a baseline built from 3 of 8 weeks", () => {
		const card = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				compare: [
					...block(null, { baseline: { ...BASELINE_ONLY, days_with_data: 3 } }),
					...block(STORE_A),
					...block(STORE_B),
				],
			}),
		);
		const baseline = chip(card, "baseline");
		expect(baseline?.sampleDays).toBe(3);
		expect(baseline?.label).toEqual({
			key: reportKeys.compare.baselinePartial,
			values: { days: { kind: "count", value: 3 } },
		});
	});

	it("says there is no data on a day without invoices", () => {
		const card = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				stores: [STORE_A],
				compare: [
					...block(null, { current: EMPTY_TOTALS }),
					...block(STORE_A, { current: EMPTY_TOTALS }),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toHaveLength(1);
		expect(card.narrative[0]?.key).toBe(dayKeys.net.noData);
		expect(chip(card, "previous")?.unavailable).toBe("no_data");
	});

	it("decomposes net revenue against the day before, falling back to last year", () => {
		const card = buildTotalsCard(netRevenueSpec, dayInput());
		expect(card.decomposition?.against).toBe("previous");
		expect(card.decomposition?.basis).toBe("all_stores");
		const withoutPrevious = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				compare: [
					...block(null, { previous: EMPTY_TOTALS }),
					...block(STORE_A, { previous: EMPTY_TOTALS }),
					...block(STORE_B, { previous: EMPTY_TOTALS }),
				],
			}),
		);
		expect(withoutPrevious.decomposition?.against).toBe("last_year");
		expect(buildTotalsCard(invoicesSpec, dayInput()).decomposition).toBeNull();
	});

	it("decomposes like for like from the covered stores' own rows", () => {
		const compare = [
			...block(null, {
				current: { net_amount: 9_000_000, invoices: 180, items_sold: 300 },
			}),
			...block(STORE_A, {
				current: { net_amount: 6_000_000, invoices: 120, items_sold: 200 },
				previous: {
					...EMPTY_TOTALS,
					days_with_data: 1,
					net_amount: 5_000_000,
					invoices: 100,
					items_sold: 150,
				},
			}),
			...block(STORE_B, { previous: EMPTY_TOTALS }),
		];
		const card = buildTotalsCard(
			netRevenueSpec,
			dayInput({
				compare,
				coverage: [
					coverageRow(STORE_A, { history_start: "2024-12-02" }),
					coverageRow(STORE_B, { history_start: DAY }),
				],
				compareLfl: {
					previous: [
						compareRow("current", DAY, DAY, {
							net_amount: 6_000_000,
							invoices: 120,
						}),
						compareRow("previous", PREVIOUS_DAY, PREVIOUS_DAY, {
							net_amount: 5_000_000,
							invoices: 100,
						}),
					],
				},
			}),
		);
		expect(chip(card, "previous")?.basis).toBe("like_for_like");
		expect(card.decomposition?.basis).toBe("like_for_like");
		expect(card.decomposition?.total).toBe(1_000_000);
		const parts = card.decomposition?.parts ?? [];
		expect(parts.reduce((total, entry) => total + entry.effect, 0)).toBe(
			1_000_000,
		);
		expect(parts[0]).toMatchObject({ factor: "invoices", from: 100, to: 120 });
	});
});
