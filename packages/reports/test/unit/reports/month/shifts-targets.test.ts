import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/index.js";
import {
	buildShiftStatsCard,
	buildTargetProgressCard,
	monthKeys,
	shiftGroups,
} from "../../../../src/reports/month/index.js";
import {
	accuracyRows,
	monthInput,
	paceRow,
	STORE_A,
	STORE_B,
	shiftRow,
	youngAtPreviousMonth,
} from "./fixtures.js";

describe("Tháng shift statistics", () => {
	const shifts = [
		shiftRow("1", { flagged: true, variance_amount: -80_000 }),
		shiftRow("2", {
			flagged: true,
			variance_amount: 60_000,
			shift_name: "Ca tối",
		}),
		shiftRow("3", {
			flagged: true,
			variance_amount: -70_000,
			shift_name: "Ca tối",
			cashier_name: "Minh",
		}),
		shiftRow("4", { variance_amount: 10_000, store_id: STORE_B }),
		shiftRow("5", { variance_amount: null, store_id: STORE_B }),
	];

	it("counts flagged shifts against the same days of last month", () => {
		const card = buildShiftStatsCard(
			monthInput({
				shifts,
				shiftsPrevious: [shiftRow("p1", { flagged: true }), shiftRow("p2")],
			}),
		);
		expect(card.headline).toMatchObject({ value: 3, unit: "count" });
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 5,
		});
		expect(card.comparisons[0]).toMatchObject({
			kind: "previous",
			current: 3,
			reference: 1,
			change: 2,
			basis: "all_stores",
		});
		expect(card.narrative[0]).toMatchObject({
			key: monthKeys.shifts.main,
			values: {
				cashier: { kind: "text", value: "Lan" },
				cashierFlags: { kind: "count", value: 2 },
				shift: { kind: "text", value: "Ca tối" },
				shiftFlags: { kind: "count", value: 2 },
			},
		});
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
		expect(card.markers.stale).toBe(false);
	});

	it("sums the variance per cashier and shift", () => {
		const groups = shiftGroups(shifts, { byStore: false, bySlot: true });
		expect(groups[0]).toMatchObject({
			cashier: "Lan",
			shift: "Ca sáng",
			shifts: 3,
			flagged: 1,
			totalVariance: 90_000,
			meanVariance: 45_000,
			largestShortage: -80_000,
			largestOverage: 10_000,
		});
		const cashiers = shiftGroups(shifts, { byStore: false, bySlot: false });
		expect(cashiers.map((group) => [group.cashier, group.flagged])).toEqual([
			["Lan", 2],
			["Minh", 1],
		]);
	});

	it("keeps the comparison to the stores that had last month", () => {
		const card = buildShiftStatsCard(
			monthInput({
				coverage: youngAtPreviousMonth(),
				shifts,
				shiftsPrevious: [shiftRow("p1", { flagged: true })],
			}),
		);
		expect(card.comparisons[0]).toMatchObject({
			basis: "like_for_like",
			current: 3,
			reference: 1,
			coveredStores: 1,
		});
		expect(card.comparisons[0]?.label.key).toBe(reportKeys.compare.likeForLike);
	});

	it("explains a month without shifts", () => {
		const card = buildShiftStatsCard(monthInput({ shifts: [] }));
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(monthKeys.shifts.noShifts);
		expect(card.narrative[0]?.key).toBe(monthKeys.shifts.noData);
		expect(card.chart).toBeNull();
	});

	it("says when no shift went over the thresholds", () => {
		const card = buildShiftStatsCard(
			monthInput({ stores: [STORE_A], shifts: [shiftRow("1"), shiftRow("2")] }),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative[0]?.key).toBe(monthKeys.shifts.none);
		expect(card.tables[0]?.columns[0]?.key).toBe("cashier");
	});
});

describe("Tháng target progress", () => {
	it("shows the progress, the daily need and each forecast against the target", () => {
		const card = buildTargetProgressCard(
			monthInput({
				stores: [STORE_A],
				targets: [{ store_id: STORE_A, net_target_amount: 60_000_000 }],
				accuracy: accuracyRows(700_000, 800_000),
			}),
		);
		expect(card.headline).toMatchObject({ value: 0.083333, unit: "fraction" });
		expect(card.comparisons.map((entry) => entry.label.key)).toEqual([
			monthKeys.target.forecastWeekdayProfile,
			monthKeys.target.forecastSeasonalNaive,
		]);
		expect(card.comparisons.every((entry) => entry.unit === "money")).toBe(
			true,
		);
		expect(card.comparisons[0]?.change).toBeCloseTo(-1 / 6, 10);
		expect(card.narrative[0]).toMatchObject({
			key: monthKeys.target.main,
			values: {
				needed: { kind: "money", value: 2_037_037.04 },
				days: { kind: "count", value: 27 },
			},
		});
		expect(card.narrative[1]?.key).toBe(monthKeys.target.forecastClause);
		expect(card.chart?.markLines[0]?.value).toBe(50_000_000);
		expect(card.tables[0]?.rows[0]?.cells).toMatchObject({
			target: 60_000_000,
			monthToDate: 5_000_000,
			forecast: 50_000_000,
		});
		expect(card.notice).toBeNull();
	});

	it("leaves the headline empty and names the stores without a target", () => {
		const card = buildTargetProgressCard(
			monthInput({
				targets: [{ store_id: STORE_A, net_target_amount: 60_000_000 }],
				storePace: {
					[STORE_A]: paceRow({ month_to_date_net_amount: 3_000_000 }),
					[STORE_B]: paceRow({ month_to_date_net_amount: 2_000_000 }),
				},
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.comparisons).toEqual([]);
		expect(card.chart).toBeNull();
		expect(card.notice).toEqual({
			tone: "warning",
			part: {
				key: monthKeys.target.missing,
				values: { stores: { kind: "text", value: "Store 2" } },
			},
			action: "settings_targets",
		});
		expect(card.narrative[0]?.key).toBe(monthKeys.target.notSet);
		const rows = card.tables[0]?.rows ?? [];
		expect(rows[0]?.cells).toMatchObject({ progress: 0.05, state: null });
		expect(rows[1]?.cells).toMatchObject({
			target: null,
			progress: null,
			state: monthKeys.target.storeMissing,
		});
	});

	it("reports only the final progress of a complete month", () => {
		const card = buildTargetProgressCard(
			monthInput({
				date: "2026-10-31",
				stores: [STORE_A],
				targets: [{ store_id: STORE_A, net_target_amount: 100_000_000 }],
				pace: [
					paceRow({
						period_start: "2026-10-01",
						as_of_date: "2026-10-31",
						remaining_days: 0,
						month_to_date_net_amount: 104_000_000,
						forecast_weekday_profile_net_amount: 104_000_000,
						forecast_seasonal_naive_net_amount: 104_000_000,
					}),
				],
			}),
		);
		expect(card.headline.value).toBe(1.04);
		expect(card.comparisons).toEqual([]);
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			monthKeys.target.final,
		]);
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"store",
			"target",
			"monthToDate",
			"progress",
		]);
		expect(card.chart?.markLines).toEqual([]);
	});

	it("says the target is already reached in a running month", () => {
		const card = buildTargetProgressCard(
			monthInput({
				stores: [STORE_A],
				targets: [{ store_id: STORE_A, net_target_amount: 4_000_000 }],
			}),
		);
		expect(card.headline.value).toBe(1.25);
		expect(card.narrative[0]?.key).toBe(monthKeys.target.reached);
	});
});
