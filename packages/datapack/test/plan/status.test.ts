import { describe, expect, it } from "vitest";
import {
	KPI_ON_TRACK_SLACK,
	KPI_STATUSES,
	KPI_TOO_EARLY_DAYS,
	type KpiStatus,
	type KpiStatusInput,
	kpiStatus,
} from "../../src/plan/status.js";

const up: KpiStatusInput = {
	baseline: 100,
	target: 120,
	current: 110,
	elapsedDays: 45,
	horizonDays: 90,
	band: { lo: 95, hi: 105 },
};

const down: KpiStatusInput = {
	baseline: 0.05,
	target: 0.04,
	current: 0.045,
	elapsedDays: 45,
	horizonDays: 90,
	band: null,
};

interface Row {
	readonly rule: string;
	readonly input: KpiStatusInput;
	readonly status: KpiStatus;
}

const decisionTable: readonly Row[] = [
	{
		rule: "1 no current value",
		input: { ...up, current: null },
		status: "no_data",
	},
	{
		rule: "1 no current value, even when late",
		input: { ...up, current: null, elapsedDays: 200 },
		status: "no_data",
	},
	{
		rule: "1 a non-finite current value",
		input: { ...up, current: Number.NaN },
		status: "no_data",
	},
	{
		rule: "2 day 0",
		input: { ...up, elapsedDays: 0, current: 130 },
		status: "too_early",
	},
	{
		rule: "2 day 13, the last early day",
		input: { ...up, elapsedDays: KPI_TOO_EARLY_DAYS - 1 },
		status: "too_early",
	},
	{
		rule: "3 day 14 reaches the target exactly (up)",
		input: { ...up, elapsedDays: KPI_TOO_EARLY_DAYS, current: 120 },
		status: "achieved",
	},
	{
		rule: "3 beyond the target (up)",
		input: { ...up, current: 125 },
		status: "achieved",
	},
	{
		rule: "3 reaches the target (down)",
		input: { ...down, current: 0.04 },
		status: "achieved",
	},
	{
		rule: "3 achieved wins over a passed horizon",
		input: { ...up, elapsedDays: 120, current: 121 },
		status: "achieved",
	},
	{
		rule: "4 horizon reached on its last day",
		input: { ...up, elapsedDays: 90, current: 119 },
		status: "missed",
	},
	{
		rule: "4 horizon passed",
		input: { ...up, elapsedDays: 91, current: 101 },
		status: "missed",
	},
	{
		rule: "4 missed wins over off course",
		input: { ...up, elapsedDays: 95, current: 90 },
		status: "missed",
	},
	{
		rule: "5 moved the wrong way (up)",
		input: { ...up, current: 99 },
		status: "off_course",
	},
	{
		rule: "5 moved the wrong way (down)",
		input: { ...down, current: 0.051 },
		status: "off_course",
	},
	{
		rule: "6 exactly at the baseline on day 14 is on track",
		input: { ...up, elapsedDays: 14, current: 100 },
		status: "on_track",
	},
	{
		rule: "6 progress equals elapsed share minus the slack",
		input: { ...up, elapsedDays: 45, current: 105 },
		status: "on_track",
	},
	{
		rule: "6 progress above the pace (down)",
		input: { ...down, current: 0.044 },
		status: "on_track",
	},
	{
		rule: "7 just below the pace",
		input: { ...up, elapsedDays: 45, current: 104.9 },
		status: "behind",
	},
	{
		rule: "7 late in the horizon with little progress",
		input: { ...up, elapsedDays: 81, current: 112 },
		status: "behind",
	},
	{
		rule: "7 behind (down)",
		input: { ...down, elapsedDays: 80, current: 0.0495 },
		status: "behind",
	},
];

describe("kpiStatus, the decision table in rule order", () => {
	it.each(decisionTable)("$rule → $status", ({ input, status }) => {
		expect(kpiStatus(input).status).toBe(status);
	});

	it("reaches every status", () => {
		const reached = new Set(decisionTable.map((row) => row.status));
		expect([...reached].sort()).toEqual([...KPI_STATUSES].sort());
	});

	it("keeps the slack at a quarter of the target move", () => {
		expect(KPI_ON_TRACK_SLACK).toBe(0.25);
		expect(KPI_TOO_EARLY_DAYS).toBe(14);
	});
});

describe("kpiStatus progress", () => {
	it("is the share of the move from baseline to target, in both directions", () => {
		expect(kpiStatus({ ...up, current: 110 }).progress).toBeCloseTo(0.5);
		expect(kpiStatus({ ...down, current: 0.045 }).progress).toBeCloseTo(0.5);
		expect(kpiStatus({ ...up, current: 90 }).progress).toBeCloseTo(-0.5);
	});

	it("is null without a current value", () => {
		expect(kpiStatus({ ...up, current: null }).progress).toBeNull();
	});

	it("caps the elapsed share at 1 for the pace", () => {
		expect(
			kpiStatus({ ...up, elapsedDays: 89, horizonDays: 90, current: 116 })
				.status,
		).toBe("on_track");
	});

	it("treats a target equal to the baseline as reached only when the value equals it", () => {
		const flat = { ...up, target: 100 };
		expect(kpiStatus({ ...flat, current: 100 }).status).toBe("achieved");
		expect(kpiStatus({ ...flat, current: 101 }).status).toBe("behind");
	});
});

describe("kpiStatus band flag", () => {
	it.each([
		{ current: 94.99, within: false },
		{ current: 95, within: true },
		{ current: 100, within: true },
		{ current: 105, within: true },
		{ current: 105.01, within: false },
	])("current $current inside 95–105 is $within", ({ current, within }) => {
		expect(kpiStatus({ ...up, current }).withinBand).toBe(within);
	});

	it("is false without a band or without a current value", () => {
		expect(kpiStatus({ ...up, band: null }).withinBand).toBe(false);
		expect(kpiStatus({ ...up, current: null }).withinBand).toBe(false);
	});

	it("reads a band given high to low", () => {
		expect(
			kpiStatus({ ...up, current: 100, band: { lo: 105, hi: 95 } }).withinBand,
		).toBe(true);
	});

	it("does not change the status", () => {
		const inside = kpiStatus({ ...up, current: 100, elapsedDays: 14 });
		const outside = kpiStatus({
			...up,
			current: 100,
			elapsedDays: 14,
			band: null,
		});
		expect(inside.status).toBe(outside.status);
	});
});
