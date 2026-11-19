import { describe, expect, it } from "vitest";
import type { OpeningHours } from "../settings/validation";
import {
	type ComplianceStore,
	complianceRows,
	complianceSummary,
	openingWindow,
	phaseDeadline,
	statusOfRuns,
} from "./compliance";
import type { ChecklistRun, ChecklistTemplate, ShiftPhase } from "./source";

const EVERY_DAY: OpeningHours = {
	mon: [["07:00", "22:00"]],
	tue: [["07:00", "22:00"]],
	wed: [["07:00", "22:00"]],
	thu: [["07:00", "22:00"]],
	fri: [["07:00", "22:00"]],
	sat: [["07:00", "22:00"]],
	sun: [["07:00", "22:00"]],
};

const STORE_1: ComplianceStore = {
	id: "store-1",
	name: "Cửa hàng 1",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	openingHours: EVERY_DAY,
};

const STORE_2: ComplianceStore = {
	...STORE_1,
	id: "store-2",
	name: "Cửa hàng 2",
	openingHours: null,
};

function template(
	id: string,
	phase: ShiftPhase,
	storeId: string | null,
	overrides: Partial<ChecklistTemplate> = {},
): ChecklistTemplate {
	return {
		id,
		storeId,
		phase,
		title: `Checklist ${id}`,
		active: true,
		version: 1,
		items: [],
		createdAt: "2026-11-01T01:00:00Z",
		audit: null,
		...overrides,
	};
}

let runCount = 0;

function run(
	templateId: string,
	storeId: string,
	businessDate: string,
	overrides: Partial<ChecklistRun> = {},
): ChecklistRun {
	runCount += 1;
	return {
		id: `run-${runCount}`,
		storeId,
		templateId,
		templateVersion: 1,
		title: `Checklist ${templateId}`,
		phase: "opening",
		businessDate,
		status: "finished",
		startedAt: `${businessDate}T00:00:00Z`,
		finishedAt: `${businessDate}T00:10:00Z`,
		startedBy: "user-1",
		itemsTotal: 4,
		itemsDone: 4,
		photos: 1,
		photosRemoved: 0,
		corrections: 0,
		...overrides,
	};
}

const NOW = new Date("2026-11-18T05:00:00Z");

describe("checklist deadlines from the opening hours", () => {
	it("puts the opening checklist at opening time, mid-shift at the middle and closing an hour after closing", () => {
		expect(phaseDeadline(STORE_1, "2026-11-17", "opening")?.toISOString()).toBe(
			"2026-11-17T00:00:00.000Z",
		);
		expect(
			phaseDeadline(STORE_1, "2026-11-17", "midshift")?.toISOString(),
		).toBe("2026-11-17T07:30:00.000Z");
		expect(phaseDeadline(STORE_1, "2026-11-17", "closing")?.toISOString()).toBe(
			"2026-11-17T16:00:00.000Z",
		);
	});

	it("reads a span past midnight as closing on the next day", () => {
		const late: ComplianceStore = {
			...STORE_1,
			openingHours: { tue: [["16:00", "01:00"]] },
		};
		expect(openingWindow(late.openingHours, "2026-11-17")).toEqual({
			open: 960,
			close: 1500,
		});
		expect(phaseDeadline(late, "2026-11-17", "closing")?.toISOString()).toBe(
			"2026-11-17T19:00:00.000Z",
		);
	});

	it("takes the first opening and the last closing of several spans", () => {
		expect(
			openingWindow(
				{
					tue: [
						["06:30", "11:00"],
						["16:00", "23:30"],
					],
				},
				"2026-11-17",
			),
		).toEqual({ open: 390, close: 1410 });
	});

	it("has no deadline without opening hours or on a closed day", () => {
		expect(phaseDeadline(STORE_2, "2026-11-17", "opening")).toBeNull();
		expect(
			phaseDeadline(
				{ ...STORE_1, openingHours: { mon: [["07:00", "22:00"]] } },
				"2026-11-17",
				"opening",
			),
		).toBeNull();
	});
});

describe("the status of one checklist on one day", () => {
	const deadline = new Date("2026-11-18T00:00:00Z");

	it("is done when a run finished by the deadline, late after it", () => {
		expect(
			statusOfRuns(
				[
					run("a", "store-1", "2026-11-18", {
						finishedAt: "2026-11-17T23:50:00Z",
					}),
				],
				deadline,
				true,
				NOW,
			),
		).toBe("done");
		expect(
			statusOfRuns(
				[
					run("a", "store-1", "2026-11-18", {
						finishedAt: "2026-11-18T00:05:00Z",
					}),
				],
				deadline,
				true,
				NOW,
			),
		).toBe("late");
	});

	it("takes the first finished run when the checklist ran twice", () => {
		expect(
			statusOfRuns(
				[
					run("a", "store-1", "2026-11-18", {
						finishedAt: "2026-11-18T02:00:00Z",
					}),
					run("a", "store-1", "2026-11-18", {
						finishedAt: "2026-11-17T23:30:00Z",
					}),
				],
				deadline,
				true,
				NOW,
			),
		).toBe("done");
	});

	it("counts a finished run as done when there is no deadline", () => {
		expect(
			statusOfRuns(
				[
					run("a", "store-2", "2026-11-17", {
						finishedAt: "2026-11-17T20:00:00Z",
					}),
				],
				null,
				false,
				NOW,
			),
		).toBe("done");
	});

	it("is missing on a past day without a finished run, even with an open one", () => {
		expect(statusOfRuns([], deadline, false, NOW)).toBe("missing");
		expect(
			statusOfRuns(
				[
					run("a", "store-1", "2026-11-17", {
						status: "open",
						finishedAt: null,
					}),
				],
				deadline,
				false,
				NOW,
			),
		).toBe("missing");
	});

	it("is in progress today while a run is open, due before the deadline and missing after it", () => {
		expect(
			statusOfRuns(
				[
					run("a", "store-1", "2026-11-18", {
						status: "open",
						finishedAt: null,
					}),
				],
				deadline,
				true,
				NOW,
			),
		).toBe("inProgress");
		expect(statusOfRuns([], new Date("2026-11-18T07:30:00Z"), true, NOW)).toBe(
			"due",
		);
		expect(statusOfRuns([], deadline, true, NOW)).toBe("missing");
		expect(statusOfRuns([], null, true, NOW)).toBe("due");
	});
});

describe("compliance rows per store, day and checklist", () => {
	const templates = [
		template("open-all", "opening", null),
		template("close-1", "closing", "store-1"),
		template("mid-2", "midshift", "store-2"),
	];

	it("applies a tenant-wide checklist to every store and a store's own to that store only", () => {
		const rows = complianceRows({
			stores: [STORE_1, STORE_2],
			templates,
			runs: [],
			from: "2026-11-17",
			to: "2026-11-17",
			now: NOW,
		});
		expect(rows.map((row) => [row.storeId, row.templateId])).toEqual([
			["store-1", "open-all"],
			["store-1", "close-1"],
			["store-2", "open-all"],
			["store-2", "mid-2"],
		]);
		expect(rows.every((row) => row.status === "missing")).toBe(true);
	});

	it("lists the days newest first and stops at each store's today", () => {
		const rows = complianceRows({
			stores: [STORE_1],
			templates: [template("open-all", "opening", null)],
			runs: [],
			from: "2026-11-17",
			to: "2026-11-19",
			now: NOW,
		});
		expect(rows.map((row) => row.businessDate)).toEqual([
			"2026-11-18",
			"2026-11-17",
		]);
		expect(rows[0]?.status).toBe("missing");
	});

	it("leaves out a checklist before the day it was created and a retired one without a run", () => {
		const rows = complianceRows({
			stores: [STORE_1],
			templates: [
				template("new", "opening", "store-1", {
					createdAt: "2026-11-17T10:00:00Z",
				}),
				template("retired", "closing", "store-1", { active: false }),
			],
			runs: [
				run("retired", "store-1", "2026-11-15", {
					phase: "closing",
					finishedAt: "2026-11-15T15:00:00Z",
				}),
			],
			from: "2026-11-15",
			to: "2026-11-17",
			now: NOW,
		});
		expect(
			rows.map((row) => [row.businessDate, row.templateId, row.status]),
		).toEqual([
			["2026-11-17", "new", "missing"],
			["2026-11-15", "retired", "done"],
		]);
	});

	it("keeps a run whose checklist the member cannot read, with the run's title and phase", () => {
		const rows = complianceRows({
			stores: [STORE_1],
			templates: [],
			runs: [
				run("gone", "store-1", "2026-11-17", {
					title: "Checklist cũ",
					phase: "midshift",
					finishedAt: "2026-11-17T09:00:00Z",
				}),
			],
			from: "2026-11-17",
			to: "2026-11-17",
			now: NOW,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			title: "Checklist cũ",
			phase: "midshift",
			status: "late",
			runs: 1,
		});
	});

	it("summarises done, late and missed into a rate of the checklists that were due", () => {
		const rows = complianceRows({
			stores: [STORE_1],
			templates: [
				template("open", "opening", "store-1"),
				template("mid", "midshift", "store-1"),
				template("close", "closing", "store-1"),
			],
			runs: [
				run("open", "store-1", "2026-11-17", {
					finishedAt: "2026-11-16T23:55:00Z",
				}),
				run("mid", "store-1", "2026-11-17", {
					phase: "midshift",
					finishedAt: "2026-11-17T08:00:00Z",
				}),
				run("open", "store-1", "2026-11-18", {
					status: "open",
					finishedAt: null,
				}),
			],
			from: "2026-11-17",
			to: "2026-11-18",
			now: NOW,
		});
		const summary = complianceSummary(rows);
		expect(summary).toEqual({
			done: 1,
			late: 1,
			missing: 1,
			inProgress: 1,
			due: 2,
			decided: 3,
			rate: 2 / 3,
		});
		expect(complianceSummary([]).rate).toBeNull();
	});
});
