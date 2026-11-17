import { describe, expect, it } from "vitest";
import {
	type HistoryPort,
	historyFloor,
	isOpenWindow,
	latestBusinessDate,
	type MonthSync,
	type MonthWindow,
	monthEnd,
	monthWindow,
	nextMonth,
	previousMonth,
	refreshWindows,
	syncedSpan,
	type WalkOptions,
	walkHistory,
	walkTotals,
} from "../../src/commands/history-walk.js";

const TODAY = "2026-11-17";

interface FakeMonth {
	sales: number;
	synced?: boolean;
	fails?: boolean;
	throws?: boolean;
}

class FakeHistory implements HistoryPort {
	readonly synced: string[] = [];
	readonly checked: string[] = [];
	private readonly months: Record<string, FakeMonth>;

	constructor(months: Record<string, FakeMonth>) {
		this.months = months;
	}

	private month(window: MonthWindow): FakeMonth {
		return this.months[window.month] ?? { sales: 0 };
	}

	async isSynced(window: MonthWindow): Promise<boolean> {
		this.checked.push(window.month);
		return this.month(window).synced === true;
	}

	async storedSales(window: MonthWindow): Promise<number> {
		return this.month(window).sales;
	}

	async sync(window: MonthWindow): Promise<MonthSync> {
		this.synced.push(`${window.fromDate}..${window.toDate}`);
		const month = this.month(window);
		if (month.throws) {
			throw new Error("POS login refused");
		}
		return month.fails
			? { succeeded: false, sales: 3, error: "call budget exhausted" }
			: { succeeded: true, sales: month.sales, error: null };
	}
}

function months(
	from: string,
	to: string,
	month: FakeMonth,
): Record<string, FakeMonth> {
	const result: Record<string, FakeMonth> = {};
	for (let cursor = from; cursor <= to; cursor = nextMonth(cursor)) {
		result[cursor] = { ...month };
	}
	return result;
}

function options(overrides: Partial<WalkOptions> = {}): WalkOptions {
	return {
		today: TODAY,
		openedOn: null,
		stopAfterEmpty: 2,
		maxMonths: 120,
		...overrides,
	};
}

describe("month windows", () => {
	it("steps across year ends and leap days", () => {
		expect(previousMonth("2026-01")).toBe("2025-12");
		expect(previousMonth("2026-11")).toBe("2026-10");
		expect(nextMonth("2025-12")).toBe("2026-01");
		expect(monthEnd("2024-02")).toBe("2024-02-29");
		expect(monthEnd("2025-02")).toBe("2025-02-28");
		expect(monthEnd("2026-12")).toBe("2026-12-31");
	});

	it("clips the current month to today and keeps past months whole", () => {
		expect(monthWindow("2026-11", TODAY)).toEqual({
			month: "2026-11",
			fromDate: "2026-11-01",
			toDate: TODAY,
		});
		expect(monthWindow("2026-10", TODAY)).toEqual({
			month: "2026-10",
			fromDate: "2026-10-01",
			toDate: "2026-10-31",
		});
		expect(isOpenWindow(monthWindow("2026-11", TODAY), TODAY)).toBe(true);
		expect(isOpenWindow(monthWindow("2026-10", TODAY), TODAY)).toBe(false);
	});

	it("takes today from the store whose business date is latest", () => {
		const now = new Date("2026-11-17T20:30:00Z");
		const stores = [
			{
				timezone: "Asia/Ho_Chi_Minh",
				business_day_start_minutes: 240,
				opened_on: null,
			},
			{
				timezone: "Asia/Ho_Chi_Minh",
				business_day_start_minutes: 0,
				opened_on: null,
			},
		];
		expect(latestBusinessDate(stores.slice(0, 1), now)).toBe("2026-11-17");
		expect(latestBusinessDate(stores, now)).toBe("2026-11-18");
		expect(() => latestBusinessDate([], now)).toThrow(RangeError);
	});

	it("knows the history floor only when every store has an opening date", () => {
		const store = (opened_on: string | null) => ({
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 0,
			opened_on,
		});
		expect(historyFloor([store("2024-03-05"), store("2023-07-01")])).toBe(
			"2023-07-01",
		);
		expect(historyFloor([store("2024-03-05"), store(null)])).toBeNull();
		expect(historyFloor([])).toBeNull();
	});
});

describe("walkHistory", () => {
	it("loads month by month from the current month and stops after two empty months", async () => {
		const port = new FakeHistory(months("2025-06", "2026-11", { sales: 40 }));
		const result = await walkHistory(port, options());
		expect(result.stop).toBe("empty_months");
		expect(result.months.map((month) => month.window.month)).toEqual([
			"2026-11",
			"2026-10",
			"2026-09",
			"2026-08",
			"2026-07",
			"2026-06",
			"2026-05",
			"2026-04",
			"2026-03",
			"2026-02",
			"2026-01",
			"2025-12",
			"2025-11",
			"2025-10",
			"2025-09",
			"2025-08",
			"2025-07",
			"2025-06",
			"2025-05",
			"2025-04",
		]);
		expect(result.months.every((month) => month.action === "synced")).toBe(
			true,
		);
		expect(port.synced[0]).toBe("2026-11-01..2026-11-17");
		expect(port.synced[1]).toBe("2026-10-01..2026-10-31");
		expect(port.checked).not.toContain("2026-11");
		expect(walkTotals(result)).toEqual({
			synced: 20,
			skipped: 0,
			failed: 0,
			withSales: 18,
			oldestWithSales: "2025-06",
		});
	});

	it("skips months already loaded, reloads the current month and resumes where it stopped", async () => {
		const history = {
			...months("2025-06", "2026-11", { sales: 40 }),
			...months("2026-03", "2026-10", { sales: 40, synced: true }),
		};
		const port = new FakeHistory(history);
		const result = await walkHistory(port, options());
		expect(result.stop).toBe("empty_months");
		const actions = Object.fromEntries(
			result.months.map((month) => [month.window.month, month.action]),
		);
		expect(actions["2026-11"]).toBe("synced");
		expect(actions["2026-10"]).toBe("skipped");
		expect(actions["2026-03"]).toBe("skipped");
		expect(actions["2026-02"]).toBe("synced");
		expect(port.synced).not.toContain("2026-10-01..2026-10-31");
		expect(port.synced).toContain("2026-02-01..2026-02-28");
		expect(walkTotals(result).skipped).toBe(8);
	});

	it("re-running a complete load pulls only the current month", async () => {
		const history = {
			...months("2025-04", "2026-11", { sales: 40, synced: true }),
			"2025-05": { sales: 0, synced: true },
			"2025-04": { sales: 0, synced: true },
		};
		const port = new FakeHistory(history);
		const result = await walkHistory(port, options());
		expect(result.stop).toBe("empty_months");
		expect(port.synced).toEqual(["2026-11-01..2026-11-17"]);
		expect(result.months.at(-1)?.window.month).toBe("2025-04");
	});

	it("walks past a single month without sales", async () => {
		const history = {
			...months("2025-01", "2026-11", { sales: 40 }),
			"2026-02": { sales: 0 },
		};
		const result = await walkHistory(new FakeHistory(history), options());
		expect(result.stop).toBe("empty_months");
		expect(result.months.at(-1)?.window.month).toBe("2024-11");
		expect(walkTotals(result).oldestWithSales).toBe("2025-01");
	});

	it("honours a shorter empty-month rule", async () => {
		const port = new FakeHistory(months("2026-09", "2026-11", { sales: 5 }));
		const result = await walkHistory(port, options({ stopAfterEmpty: 1 }));
		expect(result.stop).toBe("empty_months");
		expect(result.months.map((month) => month.window.month)).toEqual([
			"2026-11",
			"2026-10",
			"2026-09",
			"2026-08",
		]);
	});

	it("stops at a failed month and keeps what came before", async () => {
		const history = {
			...months("2025-01", "2026-11", { sales: 40 }),
			"2026-08": { sales: 40, fails: true },
		};
		const port = new FakeHistory(history);
		const result = await walkHistory(port, options());
		expect(result.stop).toBe("failed");
		expect(result.months.map((month) => month.action)).toEqual([
			"synced",
			"synced",
			"synced",
			"failed",
		]);
		expect(result.months.at(-1)?.error).toBe("call budget exhausted");
		expect(port.synced).toHaveLength(4);
	});

	it("turns a thrown error into a failed month", async () => {
		const port = new FakeHistory({ "2026-11": { sales: 1, throws: true } });
		const seen: string[] = [];
		const result = await walkHistory(
			port,
			options({ onMonth: (month) => seen.push(month.action) }),
		);
		expect(result.stop).toBe("failed");
		expect(result.months[0]).toMatchObject({
			action: "failed",
			sales: null,
			error: "POS login refused",
		});
		expect(seen).toEqual(["failed"]);
	});

	it("stops at the month limit", async () => {
		const port = new FakeHistory(months("2020-01", "2026-11", { sales: 9 }));
		const result = await walkHistory(port, options({ maxMonths: 3 }));
		expect(result.stop).toBe("max_months");
		expect(result.months).toHaveLength(3);
	});

	it("stops before the month that ends before every store opened", async () => {
		const port = new FakeHistory(months("2020-01", "2026-11", { sales: 9 }));
		const result = await walkHistory(port, options({ openedOn: "2026-09-15" }));
		expect(result.stop).toBe("before_opening");
		expect(result.months.map((month) => month.window.month)).toEqual([
			"2026-11",
			"2026-10",
			"2026-09",
		]);
		expect(port.synced).not.toContain("2026-08-01..2026-08-31");
	});
});

describe("refresh after the walk", () => {
	it("refreshes the span loaded in this run month by month, oldest first", async () => {
		const first = await walkHistory(
			new FakeHistory({
				...months("2026-07", "2026-11", { sales: 4 }),
				...months("2026-08", "2026-10", { sales: 4, synced: true }),
			}),
			options({ maxMonths: 5 }),
		);
		const second = await walkHistory(
			new FakeHistory(months("2026-10", "2026-11", { sales: 4 })),
			options({ maxMonths: 2 }),
		);
		const span = syncedSpan([first, second]);
		expect(span).toEqual({ fromDate: "2026-07-01", toDate: TODAY });
		expect(refreshWindows(span ?? { fromDate: "", toDate: "" })).toEqual([
			{ month: "2026-07", fromDate: "2026-07-01", toDate: "2026-07-31" },
			{ month: "2026-08", fromDate: "2026-08-01", toDate: "2026-08-31" },
			{ month: "2026-09", fromDate: "2026-09-01", toDate: "2026-09-30" },
			{ month: "2026-10", fromDate: "2026-10-01", toDate: "2026-10-31" },
			{ month: "2026-11", fromDate: "2026-11-01", toDate: TODAY },
		]);
	});

	it("clips the first and last chunk to the span and refreshes nothing when nothing loaded", () => {
		expect(
			refreshWindows({ fromDate: "2026-10-20", toDate: "2026-11-03" }),
		).toEqual([
			{ month: "2026-10", fromDate: "2026-10-20", toDate: "2026-10-31" },
			{ month: "2026-11", fromDate: "2026-11-01", toDate: "2026-11-03" },
		]);
		expect(syncedSpan([])).toBeNull();
		expect(
			syncedSpan([
				{
					stop: "empty_months",
					months: [
						{
							window: monthWindow("2026-10", TODAY),
							action: "skipped",
							sales: 0,
							error: null,
						},
					],
				},
			]),
		).toBeNull();
	});
});
